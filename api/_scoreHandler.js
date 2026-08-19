// Framework-agnostic core for the leaderboard write path. Reused by the Vercel
// entrypoints (api/match-start.js, api/score.js) and the Vite dev middleware, so
// local dev and prod run identical logic.
//
// Anti-abuse (Layers A + B, no bot daily cap):
//   B  — every score must present a signed match token from /api/match-start,
//        redeemable once, only after a realistic elapsed time.
//   A  — server RECOMPUTES points (ignores any client value), bounds inputs,
//        dedups via the token nonce, and rate-limits submissions per user.
// The mode is taken from the SIGNED token, not the client, so a bot match can't
// be re-labelled as a tournament.
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { pointsFor, isScoredMode, SCORING } from '../src/engine/scoring.js';
import { signMatchToken, verifyMatchToken, randomNonce } from './_matchToken.js';

const MIN_MATCH_MS = 3000;                  // reject "instant" wins — a real match takes seconds
const MATCH_TOKEN_TTL_MS = 30 * 60 * 1000;  // token must be redeemed within 30 min
const MAX_SUBMITS_PER_MIN = 6;              // per-user submission cap (burst guard)

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function config(env) {
  return {
    url: env.SUPABASE_URL || env.COMBATO_SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || env.COMBATO_SUPABASE_SERVICE_ROLE_KEY,
    tokenSecret: env.MATCH_TOKEN_SECRET,
  };
}

function supabaseAdmin(env) {
  const { url, serviceKey } = config(env);
  if (!url || !serviceKey) throw httpError(503, 'Supabase server env not configured');
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function adminClient(env) {
  const { tokenSecret } = config(env);
  if (!tokenSecret) throw httpError(503, 'MATCH_TOKEN_SECRET not configured');
  return { admin: supabaseAdmin(env), tokenSecret };
}

// Validate the caller's Supabase session (guest or Google) → the auth user.
async function requireUser(admin, authToken) {
  if (!authToken) throw httpError(401, 'missing auth token');
  const { data, error } = await admin.auth.getUser(authToken);
  if (error || !data?.user) throw httpError(401, 'invalid session');
  return data.user;
}

function clampInt(n, lo, hi) {
  n = Math.round(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

// POST /api/match-start  { mode }  →  { matchToken }
export async function handleMatchStart({ authToken, body }, env = process.env) {
  const { admin, tokenSecret } = adminClient(env);
  const user = await requireUser(admin, authToken);

  const mode = body?.mode;
  if (!isScoredMode(mode)) throw httpError(400, 'invalid mode');

  const payload = { uid: user.id, mode, iat: Date.now(), nonce: randomNonce() };
  return { matchToken: signMatchToken(payload, tokenSecret) };
}

// POST /api/score  { matchToken, won, hpRemaining, ko, durationMs }  →  { ok, points }
export async function handleSubmitScore({ authToken, body }, env = process.env) {
  const { admin, tokenSecret } = adminClient(env);
  const user = await requireUser(admin, authToken);

  // Layer B: verify the signed match token.
  let payload;
  try { payload = verifyMatchToken(body?.matchToken, tokenSecret); }
  catch { throw httpError(400, 'invalid match token'); }
  if (payload.uid !== user.id) throw httpError(403, 'match token belongs to another user');

  const elapsed = Date.now() - Number(payload.iat || 0);
  if (!Number.isFinite(elapsed) || elapsed < MIN_MATCH_MS) throw httpError(400, 'match too short');
  if (elapsed > MATCH_TOKEN_TTL_MS) throw httpError(400, 'match token expired');

  // Layer A: per-user submission rate cap (burst guard against pre-minted tokens).
  const sinceIso = new Date(Date.now() - 60_000).toISOString();
  const { count, error: countErr } = await admin
    .from('match_results')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', sinceIso);
  if (countErr) throw httpError(500, 'rate check failed');
  if ((count ?? 0) >= MAX_SUBMITS_PER_MIN) throw httpError(429, 'too many submissions, slow down');

  // Mode comes from the SIGNED token, never the client. Points are RECOMPUTED
  // server-side — any client-sent "points" is ignored.
  const summary = {
    mode: payload.mode,
    won: Boolean(body?.won),
    hpRemaining: body?.hpRemaining,
    ko: Boolean(body?.ko),
    durationMs: body?.durationMs,
  };
  const points = pointsFor(summary);

  const { error: insErr } = await admin.from('match_results').insert({
    user_id: user.id,
    mode: summary.mode,
    points,
    hp_remaining: clampInt(summary.hpRemaining, 0, 100),
    won: summary.won,
    ko: summary.ko,
    duration_ms: clampInt(summary.durationMs, 0, SCORING.timeLimitMs),
    match_nonce: payload.nonce,
  });
  if (insErr) {
    // UNIQUE(user_id, match_nonce) violation → this token was already redeemed.
    if (insErr.code === '23505') throw httpError(409, 'match already submitted');
    throw httpError(500, 'insert failed');
  }

  return { ok: true, points };
}

// POST /api/delete-account — deletes the caller's account, but ONLY if it's an
// anonymous (guest) account. Used when a guest upgrades to a Google account that
// already exists: the throwaway guest is discarded.
export async function handleDeleteAccount({ authToken }, env = process.env) {
  const admin = supabaseAdmin(env);
  const user = await requireUser(admin, authToken);
  if (!user.is_anonymous) throw httpError(403, 'only guest accounts can be deleted here');
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw httpError(500, 'delete failed');
  return { ok: true };
}
