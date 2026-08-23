# Combato — Architecture

_How the app is put together: the frontend, the Supabase + Vercel backend, and
the peer-to-peer multiplayer with its reconnect / host-failover machinery._

---

## 1. Overview

Combato is a **frontend-only** React app that talks to two backends:

- **Supabase** — Postgres + Auth + Realtime (accounts, leaderboard, multiplayer transport).
- **Vercel serverless functions** (`api/*`) — the validated write path (LLM proxy, scoring).

There is **no dedicated game server**. Combat runs client-side; online play is
**host-authoritative** over a Supabase Realtime channel.

```
                        ┌───────────────────────── Supabase ─────────────────────────┐
                        │  Auth (Google + anon guest)   Postgres        Realtime       │
                        │        │  issues JWT           (profiles,      (room:<code>   │
                        │        │                        match_results)  channels)     │
   ┌── Client (browser / Capacitor WebView) ──┐          ▲                 ▲            │
   │  React 19 + Vite + Pixi.js               │          │ read board      │ PvP        │
   │   • auth / profile                       │──anon────┘ (RPC)           │ transport  │
   │   • fight engine (client-side)           │                            │            │
   │   • Realtime transport (peerEngine)      │◄───────────────────────────┘            │
   └───────────┬──────────────────────────────┘                                        │
               │ JWT                                                                    │
     ┌─────────▼──────── Vercel functions (api/*) ───────┐                             │
     │  /api/ai          LLM proxy (JWT-gated)            │                             │
     │  /api/match-start issues signed match token        │──service-role──► Postgres  │
     │  /api/score       recompute + dedup + insert score │                             │
     │  /api/ping        daily keep-warm cron             │                             │
     └────────────────────────────────────────────────────┘─────────────────────────────┘
```

**Reads** (leaderboard) go straight to Supabase with the public anon key.
**Writes** (scores) go through Vercel functions with the service-role key, so the
client can never insert a score directly.

---

## 2. Frontend

- **React 19 + Vite + Pixi.js**, deployed on Vercel; wrapped in **Capacitor** for
  Android. Landscape-locked (OS + runtime + `<LandscapeGate>`).
- **Entry flow** (`src/App.jsx`): `SignInScreen` (Google / guest) → `FighterNamePrompt`
  (name step) → routes. A handle in `localStorage` gates the game.
- **Combat** is fully client-side: `src/engine/fightEngine.js` `runFight()` is an
  `async` loop that collects a batch of moves (from the AI or, in PvP, from each
  fighter), resolves them with `resolveActions()`, and emits events (`batch_start`,
  `action_result`, `ko`, …). The renderer (`src/hooks/useFightRenderer.js`, `Arena.jsx`)
  turns those events into the animated fight.

---

## 3. Auth

`src/lib/supabase.js` (singleton client) + `src/lib/auth.js`:

- **Guest** — `signInAnonymously()`. Every guest gets a stable `user_id`, so guests
  appear on the leaderboard.
- **Google** — web OAuth redirect (`signInWithOAuth`). _Native (Capacitor) Google
  sign-in still needs the ID-token plugin — see `RELEASE_PLAN.md`._
- **Guest → Google linking** — an anonymous user uses `linkIdentity`; if that Google
  account already exists, the throwaway guest is deleted (`/api/delete-account`,
  guest-only) and we sign into the existing account.

Session persists across reloads (localStorage); every request carries a Supabase JWT.

---

## 4. Data + leaderboard

Schema: `supabase/migrations/0001_init.sql`.

- **`profiles`** — `user_id` (PK) + display `handle`. Readable by all; writable only
  to its own row (RLS `auth.uid() = user_id`).
- **`match_results`** — append-only scoring ledger. **No client access** (RLS: service
  role only). `UNIQUE(user_id, match_nonce)` backs dedup.
- **`get_leaderboard(period)`** — `SECURITY DEFINER` RPC summing points per user over
  a daily / weekly window. The client reads it directly with the anon key
  (`src/lib/leaderboard.js` → `fetchLeaderboard`).

---

## 5. Scoring + anti-cheat

Combat is not server-reproducible, so the goal is to stop **casual** cheating cheaply,
not a determined reverse-engineer. Two layers:

- **Layer A** — `/api/score` **recomputes** points server-side (`src/engine/scoring.js`,
  shared by client preview and server), bounds inputs, rate-limits, and dedups.
- **Layer B** — a **match-token handshake**: `/api/match-start` issues an HMAC-signed,
  single-use token (`api/_matchToken.js`) carrying the user, mode, and a start
  timestamp; `/api/score` requires it and rejects tokens that are too new / expired /
  belonging to another user.

**Idempotent nonce.** For PvP, the client passes a deterministic `matchId`
(`<bracketId>:<matchSlot>`) to `/api/match-start`; the server uses it as the
`match_nonce`. So a reconnect, a host mid-fight re-run, or a duplicate submit collapses
on `UNIQUE(user_id, match_nonce)` — one row per fighter per match. Bot matches omit the
id (random nonce; each is genuinely new).

`/api/ai` is **JWT-gated** (guests count) so the LLM proxy isn't an open bill.

---

## 6. Multiplayer transport (Supabase Realtime)

`src/engine/peerEngine.js` is a thin **PeerJS-shaped shim over a Supabase Realtime
channel** (it replaced PeerJS/STUN, which failed on mobile NAT). One channel per room:
`room:<code>`.

**Model — host-authoritative:**
- The **host** runs the tournament (bracket, match orchestration, `runFight`, move
  collection). `useMatchHost.js`.
- **Joiners** are effectively spectators of the host's simulation; they compute their
  own fighter's moves on request. `useMatchClient.js`.
- `RoomPage.jsx` wires the two together and owns the room UI.

**Addressing:**
- Messages are addressed envelopes `{ from, to, data }` broadcast on the channel
  (event `msg`), filtered by `to`. `to: null` = channel-wide (everyone).
- The **host's wire address is always the room `<code>`** — joiners send to `code`.
  Crucially, this address is **decoupled from the peer's presence key** (its own id):
  for a normal host they're equal, but a *promoted* joiner keeps its own id while its
  address becomes `code`. That decoupling (`peer._addr()`) is what lets failover reuse
  an existing channel (see §8).
- **Presence** (`peerId` per client) tracks who's in the room and drives the election
  candidate list.

**Message types:** `JOIN` / `JOIN_ACK`, `LOBBY_UPDATE`, `UPDATE_FIGHTER`,
`FIGHT_START`, `FIGHT_EVENT`, `REQUEST_MOVES` / `SUBMIT_MOVES`, `ROOM_CLOSED`, plus the
`host` heartbeat (below).

---

## 7. Resilience — reconnect, multi-tab, refresh

All of this is transparent recovery layered on the transport.

- **Stable joiner identity** — a joiner's transport id is stored per-room in
  `localStorage` (`pk.peerId.<code>`), so a **refresh or a second tab** rejoins the
  **same seat** (the host recognizes the id already on its roster) instead of spawning
  a duplicate.
- **Role/mode persistence** — `RoomPage` stashes `{ isHost, mode }` per room in
  `sessionStorage` (`pk.room.<code>`); a refresh (which drops router state) restores it,
  so a host reload doesn't become a joiner.
- **Multi-tab presence** — the host only drops a fighter on presence `leave` when the
  **last** meta for that peer is gone, so closing one of several tabs doesn't evict a
  player.
- **Single active tab** — `useSingleRoomTab.js` uses a `BroadcastChannel` so a second
  tab of the same browser is guarded (with a joiner-only "Continue here" takeover)
  rather than duplicating the player.
- **Network blip** — on channel re-`SUBSCRIBED`, presence is re-tracked and the joiner
  re-`JOIN`s automatically; an alive-in-bracket player rejoins as a fighter.
- **Host refresh** — the host snapshots its authoritative `lobbyState` per-room in
  `sessionStorage` (`pk.hostState.<code>`) on every change; on remount it rehydrates
  (`resumeFromSnapshot`) and re-broadcasts. A snapshot taken **mid-fight** rewinds to
  that match's `bracket-preview` and re-runs it (a live sim can't resume in place).
- **Mid-fight rejoin catch-up** — when a *joiner* reconnects during a live fight, the
  host re-sends `FIGHT_START` with a **state snapshot** (`hp/meter/status` + elapsed
  time); the spectator Arena `SEEK`s straight to "now" and plays forward, timer synced.

---

## 8. Host failover (tournament survives the host leaving)

The headline feature: if the host **leaves for good**, a remaining player takes over
and the tournament continues. Everything below is P2P — no server referee.

### Host heartbeat (the reliable signal)
Presence-key reuse is unreliable across a handoff, so host liveness/identity rides an
explicit broadcast instead. The host emits a `host` beat every **1.5s**:
`{ hostId: <addr = code>, hostEpoch, instanceId }`.

- **Joiners** — every beat resets a **5s gone-watchdog** and, if the beat comes from a
  **different `instanceId`** than the one they're joined to (a new host took over),
  triggers a re-`JOIN`. This is presence-independent, so it works even when a `leave`
  never fires.
- **Hosts** — a beat from another host that **outranks** them (higher `hostEpoch`, or
  equal epoch + smaller `instanceId` as a tiebreak) makes them **step down**.

### Election + in-place promotion
1. **Detect** — the host's beats stop; after the 5s grace every joiner independently
   **elects** the smallest remaining `peerId` (from presence) as successor.
2. **Promote in place** — the elected joiner (`RoomPage`) builds a seed from its last
   `lobbyState`:
   - `removeFighterFromBracket(code)` — the departed host **forfeits** (bye/forfeit
     cascade advances its opponent);
   - `rekeyFighterInBracket(myId → code)` — it **adopts the host address**;
   - bumps `hostEpoch`, writes the host snapshot, then **hands its peer to the host
     hook** (`releasePeer()` → `useMatchHost` `adoptPeer` → `peer.becomeHost(code, epoch)`).

   `becomeHost` upgrades the peer to host **on its existing, already-working channel** —
   no destroy/recreate on the same room topic (which was the bug that stranded other
   joiners: a recreated channel could send but not reliably receive).
3. **Resync** — the new host rehydrates the seed and re-broadcasts the lobby
   **channel-wide** (`broadcastAll`, plus a 3s re-broadcast in non-fight phases). Other
   joiners re-`JOIN` off the new host's beat and converge on the new roster.

### Mid-fight
The in-progress fight is aborted; `resumeFromSnapshot` rewinds it to `bracket-preview`
and the current match **re-runs** (tournament: 20s countdown; 1v1: ~4s grace). If the
host was one of the two current fighters, that match **forfeits** to its opponent
instead. Scoring stays correct via the idempotent nonce (§5).

### Split-brain
If the old host **returns** after being replaced (or a rare double-promotion happens),
both are hosts briefly. They hear each other's beats and the **lower-ranked one steps
down** (via `hostConflict` → `RoomPage` clears its host role and rejoins as a client /
spectator). Exactly one host survives.

```
Host leaves ─► beats stop ─► (5s) every joiner elects smallest peerId
                                         │
                    ┌────────────────────┴───────────────────┐
              elected joiner                            other joiners
              becomeHost() in place                     hear new instanceId in beat
              forfeit old host, re-key self             ─► re-JOIN new host
              rehydrate + broadcastAll lobby            ─► converge on new roster
                                         │
                            current match re-runs / forfeits
```

---

## 9. Key files

| Area | Files |
|---|---|
| Auth / client | `src/lib/supabase.js`, `src/lib/auth.js`, `src/lib/profiles.js` |
| Leaderboard | `src/lib/leaderboard.js`, `src/components/Leaderboard.jsx`, `supabase/migrations/0001_init.sql` |
| Scoring / anti-cheat | `src/engine/scoring.js`, `api/match-start.js`, `api/score.js`, `api/_scoreHandler.js`, `api/_matchToken.js` |
| LLM proxy | `api/ai.js`, `api/_handler.js`, `src/engine/prompts.js` |
| Combat | `src/engine/fightEngine.js`, `src/hooks/useFightRenderer.js`, `src/components/Arena.jsx` |
| Transport | `src/engine/peerEngine.js` |
| Multiplayer logic | `src/hooks/useMatchHost.js`, `src/hooks/useMatchClient.js`, `src/pages/RoomPage.jsx` |
| Tab guard | `src/hooks/useSingleRoomTab.js` |
| Native | `android/`, `capacitor.config.json`, `MOBILE_BUILD.md` |

See `RELEASE_PLAN.md` for status and the pre-Android-release checklist.
