// Auth helpers over the Supabase client: guest (anonymous) sign-in, Google
// sign-in, and guest→Google upgrade (link the guest, or discard it if that
// Google account already exists).
import { supabase, isSupabaseConfigured, authReturnError } from './supabase.js';
import { loadProfile, saveProfile } from '../data/designData.js';

const GOOGLE_LINK_FLAG = 'pk.googleLinkAttempt';

// Play as Guest: creates an anonymous Supabase user with a stable user_id, so a
// guest can still earn points and appear on the leaderboard. The session is
// persisted, so a returning guest keeps the same identity until they clear
// storage or upgrade to Google.
//
// Requires "Allow anonymous sign-ins" enabled in the Supabase dashboard
// (Authentication → Sign In / Providers → Anonymous). Best-effort: returns null
// when Supabase isn't configured rather than throwing.
export async function signInAsGuest() {
  if (!isSupabaseConfigured) return null;

  // Reuse an existing session instead of spawning a fresh anonymous user each run.
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}

// Continue with Google (web redirect flow). For a signed-in GUEST this LINKS
// Google to the anonymous user, so the same user_id (and its points) is kept.
// For everyone else it's a normal sign-in. The link outcome is resolved on
// return by resolveGoogleAuthReturn(). Native Android will use an ID-token path.
export async function signInWithGoogle(redirectTo) {
  if (!isSupabaseConfigured) return;
  const options = { redirectTo: redirectTo ?? window.location.origin };
  const { data: { session } } = await supabase.auth.getSession();

  if (session?.user?.is_anonymous) {
    try { localStorage.setItem(GOOGLE_LINK_FLAG, '1'); } catch { /* ignore */ }
    const { error } = await supabase.auth.linkIdentity({ provider: 'google', options });
    if (error) {
      try { localStorage.removeItem(GOOGLE_LINK_FLAG); } catch { /* ignore */ }
      throw error;
    }
    return; // browser redirects to Google
  }

  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options });
  if (error) throw error;
}

// Resolve the outcome of a guest→Google link redirect. Call once on app load:
//  • linked     → the guest IS now the Google user (points + handle preserved)
//  • cancelled  → user backed out at Google; stay a guest
//  • collision  → that Google account already exists → delete the throwaway
//                 guest and sign into the existing account instead
export async function resolveGoogleAuthReturn(redirectTo) {
  if (!isSupabaseConfigured) return;
  let attempted = false;
  try { attempted = localStorage.getItem(GOOGLE_LINK_FLAG) === '1'; } catch { /* ignore */ }
  if (!attempted) return;
  try { localStorage.removeItem(GOOGLE_LINK_FLAG); } catch { /* ignore */ }

  const err = (authReturnError || '').toLowerCase();
  if (err.includes('access_denied') || err.includes('cancel')) return; // user backed out

  // Authoritative: if we are no longer anonymous, the link succeeded.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.is_anonymous) return;
  if (!err) return; // still a guest but no error signal — leave as-is

  // Non-cancel error + still a guest ⇒ the Google identity belongs to another
  // account. Discard the throwaway guest and sign into the real account.
  await deleteGuestAccount().catch(() => {});
  try { saveProfile({ ...loadProfile(), handle: '' }); } catch { /* ignore */ } // let the real account's handle take over
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google', options: { redirectTo: redirectTo ?? window.location.origin },
  });
  if (error) console.warn('[auth] fallback Google sign-in failed:', error.message);
}

// Delete the current (guest) account server-side. Best-effort; the endpoint only
// deletes anonymous accounts.
export async function deleteGuestAccount() {
  const token = await getAccessToken();
  if (!token) return;
  const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
  try {
    await fetch(`${base}/api/delete-account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* ignore */ }
}

// Sign out (guest or Google). Clears the persisted session.
export async function signOut() {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
}

// The currently signed-in user (guest or Google), or null.
export async function getCurrentUser() {
  if (!isSupabaseConfigured) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

// The current session's access token (JWT), or null. Sent as a Bearer header on
// calls to our own API (/api/ai, /api/match-start, /api/score) so the server can
// verify who is calling.
export async function getAccessToken() {
  if (!isSupabaseConfigured) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// Subscribe to sign-in/out changes. Returns an unsubscribe fn.
export function onAuthChange(cb) {
  if (!isSupabaseConfigured) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}
