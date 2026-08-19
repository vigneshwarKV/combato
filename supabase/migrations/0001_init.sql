-- Combato — initial backend schema
-- =================================
-- Two tables + one function power the whole leaderboard:
--   profiles       — one row per player (display handle for the board)
--   match_results  — append-only ledger; one row per scored match
--   get_leaderboard(period) — top-N summed points for a daily/weekly window
--
-- Trust model (see RELEASE_PLAN / plan file):
--   • Clients NEVER write match_results directly. Only the service-role key
--     (used by /api/score after it validates + recomputes points) can insert.
--   • Clients read the board only through get_leaderboard() — the raw ledger is
--     not client-readable.
--   • profiles is the one thing a client writes, and only its own row.
--
-- Apply this in the Supabase SQL editor (or `supabase db push`).


-- ── profiles ─────────────────────────────────────────────────────────────────
-- Display identity for the leaderboard. Game data (charId, strategies) stays in
-- localStorage; only the handle needs to live server-side so other players can
-- see who is on the board. One row per auth user (Google OR anonymous guest).
create table if not exists public.profiles (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  handle     text        not null check (char_length(handle) between 1 and 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ── match_results ────────────────────────────────────────────────────────────
-- Append-only scoring ledger. Every scored match is one row; daily/weekly boards
-- are just SUM(points) over a created_at window (see get_leaderboard). Keeping
-- raw rows (instead of a running total) also gives us match history for free.
--
-- `match_nonce` is a per-match id the client generates; UNIQUE(user_id, nonce)
-- makes re-submitting the same match a no-op (dedup / anti double-count).
create table if not exists public.match_results (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  mode         text        not null check (mode in ('bot', '1v1', 'tournament')),
  points       integer     not null check (points >= 0),
  hp_remaining integer     not null check (hp_remaining between 0 and 100),
  won          boolean     not null,
  ko           boolean     not null default false,
  duration_ms  integer     not null check (duration_ms >= 0),
  match_nonce  text        not null,
  created_at   timestamptz not null default now(),
  unique (user_id, match_nonce)
);

-- Windowed leaderboard reads scan by time; per-user history scans by user+time.
create index if not exists match_results_created_at_idx
  on public.match_results (created_at desc);
create index if not exists match_results_user_created_idx
  on public.match_results (user_id, created_at desc);


-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.profiles      enable row level security;
alter table public.match_results enable row level security;

-- profiles: any signed-in user may read handles (to render the board); a user
-- may insert/update ONLY their own row.
create policy "profiles readable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- match_results: intentionally NO policies for clients. With RLS enabled and no
-- policy, every client read/write is denied. Only the service role (which
-- bypasses RLS) can insert, from /api/score. Clients read via get_leaderboard().


-- ── get_leaderboard(period) ──────────────────────────────────────────────────
-- Returns the top-N players by summed points inside the daily or weekly window.
-- SECURITY DEFINER so it can read the locked-down ledger; search_path is pinned
-- to public to keep that safe. Windows use the DB clock (UTC) — a day/week rolls
-- over at 00:00 UTC. (Timezone can be parameterised later if needed.)
create or replace function public.get_leaderboard(
  period  text default 'daily',
  limit_n integer default 100
)
returns table (rank bigint, user_id uuid, handle text, score bigint)
language sql
stable
security definer
set search_path = public
as $$
  with windowed as (
    select mr.user_id, sum(mr.points)::bigint as score
    from public.match_results mr
    where mr.created_at >= case
        when period = 'weekly' then date_trunc('week', now())
        else                        date_trunc('day',  now())
      end
    group by mr.user_id
  )
  select
    row_number() over (order by w.score desc, coalesce(p.handle, 'UNNAMED') asc) as rank,
    w.user_id,
    coalesce(p.handle, 'UNNAMED') as handle,
    w.score
  from windowed w
  left join public.profiles p on p.user_id = w.user_id
  order by w.score desc, handle asc
  limit greatest(1, least(limit_n, 200));
$$;

-- Guests (anonymous) and signed-in users can both read the board.
grant execute on function public.get_leaderboard(text, integer) to anon, authenticated;
