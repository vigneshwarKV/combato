import { useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import RoomPage from './pages/RoomPage.jsx';
import DevPage from './pages/DevPage.jsx';
import BotMatchPage from './pages/BotMatchPage.jsx';
import CharSelectPage from './pages/CharSelectPage.jsx';
import { LandscapeGate } from './components/LandscapeGate.jsx';
import GlDebugOverlay from './components/GlDebugOverlay.jsx';
import FighterNamePrompt from './components/FighterNamePrompt.jsx';
import { loadProfile, saveProfile } from './data/designData.js';

export default function App() {
  // First run has no stored name, and /setup no longer collects one — so the
  // fighter-name prompt is the entry gate. The page behind it stays mounted and
  // renders normally; the prompt just sits on top until a name exists.
  const [handle, setHandle] = useState(() => loadProfile().handle);
  const { pathname } = useLocation();
  // /dev is the render-diagnostics harness. It never uses the name and is
  // usually opened in a clean browser profile, so it skips the gate.
  const needsName = !handle && pathname !== '/dev';

  function signIn(name) {
    saveProfile({ ...loadProfile(), handle: name });
    setHandle(name);
  }

  return (
    <LandscapeGate>
      <GlDebugOverlay />
      {/* Every page snapshots the profile with loadProfile() at mount (there's
          no provider), so a page mounted behind the gate holds the empty name.
          Keying the routes on the handle remounts them once the name lands —
          the topbar picks it up, and a deep-linked /room joins under the real
          name instead of ''. HomeArena is already mount/unmount-safe (the
          how-to-play tour toggles it the same way). */}
      <Routes key={handle ? 'named' : 'anon'}>
        <Route path="/" element={<HomePage />} />
        <Route path="/setup" element={<CharSelectPage />} />
        <Route path="/room/:code" element={<RoomPage />} />
        <Route path="/bot" element={<BotMatchPage />} />
        <Route path="/dev" element={<DevPage />} />
      </Routes>
      {needsName && <FighterNamePrompt onSignIn={signIn} />}
    </LandscapeGate>
  );
}
