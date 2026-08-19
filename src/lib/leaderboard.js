// Client side of the leaderboard. WRITES (start + submit) go through our server
// endpoints so the anon key can never insert a score directly; READS hit Supabase
// directly via the public get_leaderboard RPC. All best-effort — never block play.
import { supabase, isSupabaseConfigured } from './supabase.js';
import { getAccessToken } from './auth.js';

// Same base-URL convention as engine/prompts.js: empty for web/PWA (same-origin),
// the deployed backend URL for native builds.
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const MATCH_START_ENDPOINT = `${API_BASE}/api/match-start`;
const SCORE_ENDPOINT = `${API_BASE}/api/score`;

// Begin a scored match → returns a signed match token to present at submit time,
// or null when not signed in / offline (scoring simply won't record).
export async function startScoredMatch(mode) {
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(MATCH_START_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.matchToken ?? null;
  } catch {
    return null;
  }
}

// Submit a finished match. summary = { won, hpRemaining, ko, durationMs } (mode
// is taken from the signed token server-side). Returns { ok, points } or null.
export async function submitScore(matchToken, summary) {
  if (!matchToken) return null;
  const token = await getAccessToken();
  if (!token) return null;
  try {
    const res = await fetch(SCORE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ matchToken, ...summary }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      console.warn('[leaderboard] score rejected:', res.status, error);
      return null;
    }
    return await res.json(); // { ok, points }
  } catch (e) {
    console.warn('[leaderboard] score submit failed:', e?.message ?? e);
    return null;
  }
}

// Read the leaderboard for a window ('daily' | 'weekly'). Direct Supabase RPC
// (public read via the get_leaderboard SECURITY DEFINER function) — no server
// round-trip. Returns rows [{ rank, user_id, handle, score }].
export async function fetchLeaderboard(period = 'daily') {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc('get_leaderboard', { period });
  if (error) {
    console.warn('[leaderboard] fetch failed:', error.message);
    return [];
  }
  return data ?? [];
}
