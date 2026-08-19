import { useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import RoomPage from './pages/RoomPage.jsx';
import DevPage from './pages/DevPage.jsx';
import BotMatchPage from './pages/BotMatchPage.jsx';
import CharSelectPage from './pages/CharSelectPage.jsx';
import { LandscapeGate } from './components/LandscapeGate.jsx';
import GlDebugOverlay from './components/GlDebugOverlay.jsx';
import FighterNamePrompt from './components/FighterNamePrompt.jsx';
import SignInScreen from './components/SignInScreen.jsx';
import { backgroundUrlForSeed } from './components/ArenaBackground.jsx';
import { warmPreFightAssets } from './engine/assetPreloader.js';
import { loadProfile, saveProfile } from './data/designData.js';
import { signInAsGuest, signInWithGoogle, onAuthChange, resolveGoogleAuthReturn } from './lib/auth.js';
import { upsertHandle, getMyHandle } from './lib/profiles.js';

// The how-to-play tour is a fixed turtle-vs-beast matchup, so its background is
// deterministic — resolve the one image rather than warming all seven.
const HOW_TO_PLAY_BACKGROUND = backgroundUrlForSeed('turtle-beast');

export default function App() {
  // Entry flow has two gated states before the game: the SIGN-IN screen (no
  // session yet) and the NAME step (signed in, no fighter name). Both sit over
  // the animated home characters. Once a handle exists the routes render.
  const [handle, setHandle] = useState(() => loadProfile().handle);
  const { pathname } = useLocation();
  // /dev is the render-diagnostics harness. It never uses the name and is
  // usually opened in a clean browser profile, so it skips the gate.
  const needsName = !handle && pathname !== '/dev';

  const [authUser, setAuthUser] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);

  // Warm the home arena + how-to-play cast the moment the app boots, so their
  // first defend / ultimate isn't the thing that downloads the art. Deliberately
  // NOT blocking (the full roster is ~90 MB) — this subset is a few MB.
  useEffect(() => {
    warmPreFightAssets({ backgrounds: [HOW_TO_PLAY_BACKGROUND] });
  }, []);

  // Resolve a guest→Google link redirect: convert the guest in place, or (if that
  // Google account already exists) discard the guest and sign into the real one.
  useEffect(() => {
    resolveGoogleAuthReturn().catch((e) => console.warn('[auth] link resolve failed:', e?.message ?? e));
  }, []);

  // Track the Supabase session (drives which gate screen shows) and reconcile the
  // handle. A RETURNING user's server handle is restored so they skip the name
  // step; NEW users (guest OR first-time Google) fall through with no handle, so
  // the name step asks for one — the typed name is always what we display.
  useEffect(() => {
    let cancelled = false;
    // Resolve BOTH the session and the handle before deciding what the gate
    // shows. A returning user has a server handle but maybe no local one (e.g.
    // after sign-out) — restore it BEFORE marking auth resolved, so the name
    // prompt never flashes for someone who already has a name.
    async function reconcile(user) {
      if (cancelled) return;
      setAuthUser(user);
      if (!user) { setAuthResolved(true); return; }
      const stored = loadProfile().handle;
      if (stored) { upsertHandle(stored).catch(() => {}); setAuthResolved(true); return; }
      const existing = await getMyHandle().catch(() => null);
      if (cancelled) return;
      if (existing) { saveProfile({ ...loadProfile(), handle: existing }); setHandle(existing); }
      setAuthResolved(true); // only now is it known whether a name is needed
    }
    const unsub = onAuthChange(reconcile);
    return () => { cancelled = true; unsub(); };
  }, []);

  // Name step submit: a session already exists (guest or Google) from the sign-in
  // screen — ensure one, then record the handle for the leaderboard.
  function signIn(name) {
    saveProfile({ ...loadProfile(), handle: name });
    setHandle(name);
    signInAsGuest().catch(() => {}).finally(() => upsertHandle(name).catch(() => {}));
  }

  // Sign-in screen actions.
  function signInGoogle() {
    signInWithGoogle().catch((e) => console.warn('[auth] Google sign-in failed:', e?.message ?? e));
  }
  function playAsGuest() {
    signInAsGuest().catch((e) => console.warn('[auth] guest sign-in failed:', e?.message ?? e));
  }

  if (needsName) {
    return (
      <LandscapeGate>
        <GlDebugOverlay />
        <div className="gate-root">
          {/* Arena scrim behind the gate. The live home characters render IN the
              sign-in flow (SignInScreen) so they centre + size like the home hero.
              The routes (and their own HomeArena) aren't mounted until a handle
              exists, so only one arena runs at a time. */}
          <div className="gate-scrim" />
          {!authResolved
            ? null
            : authUser
              ? <FighterNamePrompt onSignIn={signIn} />
              : <SignInScreen onGoogle={signInGoogle} onGuest={playAsGuest} />}
        </div>
      </LandscapeGate>
    );
  }

  return (
    <LandscapeGate>
      <GlDebugOverlay />
      <Routes key={handle ? 'named' : 'anon'}>
        <Route path="/" element={<HomePage />} />
        <Route path="/setup" element={<CharSelectPage />} />
        <Route path="/room/:code" element={<RoomPage />} />
        <Route path="/bot" element={<BotMatchPage />} />
        <Route path="/dev" element={<DevPage />} />
      </Routes>
    </LandscapeGate>
  );
}
