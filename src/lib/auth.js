// Auth helpers over the Supabase client: guest (anonymous) sign-in, Google
// sign-in, and guest→Google upgrade (link the guest, or discard it if that
// Google account already exists).
import { Capacitor } from '@capacitor/core';
import { supabase, isSupabaseConfigured, authReturnError } from './supabase.js';
import { loadProfile, saveProfile } from '../data/designData.js';

const GOOGLE_LINK_FLAG = 'pk.googleLinkAttempt';
// OAuth 2.0 *Web* client ID (…apps.googleusercontent.com). It's the audience
// Supabase verifies on the Google ID token, so the NATIVE picker must mint the
// token for this same client. Public (VITE_) — an OAuth client ID is not a secret.
const GOOGLE_WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID;

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

// Native (Capacitor) Google sign-in. The web OAuth *redirect* flow can't
// complete inside capacitor://localhost, so on device we open the platform's
// native Google account picker (Android Credential Manager) to get a Google ID
// token, then exchange it for a Supabase session via signInWithIdToken().
//
// Unlike the web flow's linkIdentity(), an ID-token sign-in signs the user in AS
// the Google account — it does NOT preserve a guest's user_id. So a guest who
// upgrades here switches to their Google account and starts fresh on the board
// (their guest points are left behind). Accepted v1 behaviour; a server-side
// migration could carry them over later.
let socialLoginInited = false;
async function signInWithGoogleNative() {
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new Error('VITE_GOOGLE_WEB_CLIENT_ID is not set — native Google sign-in is unavailable.');
  }
  // Dynamic import so the plugin's bridge code splits into its own chunk and
  // never loads in the web/PWA build (mirrors src/native/index.js).
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  if (!socialLoginInited) {
    await SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID } });
    socialLoginInited = true;
  }
  const res = await SocialLogin.login({ provider: 'google', options: { scopes: ['email', 'profile'] } });
  const idToken = res?.result?.idToken;
  if (!idToken) throw new Error('Google sign-in returned no ID token.');
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
}

// Continue with Google. On NATIVE this uses the ID-token account picker above;
// on the WEB it's the redirect flow — for a signed-in GUEST that LINKS Google to
// the anonymous user, so the same user_id (and its points) is kept. For everyone
// else it's a normal sign-in. The web link outcome is resolved on return by
// resolveGoogleAuthReturn().
export async function signInWithGoogle(redirectTo) {
  if (!isSupabaseConfigured) return;
  if (Capacitor.isNativePlatform()) return signInWithGoogleNative();
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
  // Native: also drop the platform Google credential, so the next sign-in shows
  // the account picker instead of silently reusing the last account.
  if (Capacitor.isNativePlatform()) {
    try {
      const { SocialLogin } = await import('@capgo/capacitor-social-login');
      await SocialLogin.logout({ provider: 'google' });
    } catch { /* ignore — plugin optional / not signed in via Google */ }
  }
  await supabase.auth.signOut();
}

// The currently signed-in user (guest or Google), or null.
export async function getCurrentUser() {
  if (!isSupabaseConfigured) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

// The current session's access token (JWT), or null. Sent as a Bearer header on
// calls to our own API (/api/moves, /api/match-start, /api/score) so the server can
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
