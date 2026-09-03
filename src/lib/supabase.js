// Single Supabase client for the whole app (browser + Capacitor WebView).
// Auth (guest + Google) and leaderboard READS go through this. Leaderboard
// WRITES deliberately do NOT — those go to /api/score, so the public anon key
// can never insert a score directly (see the plan's anti-cheat model).
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// The app must stay playable even when Supabase isn't configured (bot mode,
// how-to-play, etc. don't need it). Callers check this before touching auth or
// the leaderboard, so a missing key degrades gracefully instead of throwing.
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — auth + leaderboard disabled. ' +
    'Add them to .env and restart the dev server.'
  );
}

// Fallbacks keep createClient from throwing on empty strings when unconfigured;
// any real call is still gated behind isSupabaseConfigured.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: {
    persistSession: true,       // keep the session across reloads (localStorage)
    autoRefreshToken: true,
    detectSessionInUrl: true,   // completes the Google OAuth redirect when the browser returns (web flow)
  },
});

// Snapshot any OAuth error the redirect came back with, BEFORE detectSessionInUrl
// (async) strips it from the URL. Used to distinguish a cancelled Google sign-in
// from an "identity already exists" link collision (see auth.resolveGoogleAuthReturn).
export const authReturnError = (() => {
  if (typeof window === 'undefined') return null;
  const grab = (s) => { try { return new URLSearchParams(s.replace(/^[#?]/, '')); } catch { return new URLSearchParams(); } };
  const h = grab(window.location.hash);
  const q = grab(window.location.search);
  return h.get('error_code') || q.get('error_code') || h.get('error') || q.get('error') || null;
})();
