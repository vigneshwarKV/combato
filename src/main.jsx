import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as PIXI from 'pixi.js'
import { applyPixiPatches } from './engine/pixiPatches.js'
import './index.css'
import './styles/animations.css'
import './styles/wrestling.css'
import App from './App.jsx'
import { setMusicTrack } from './engine/soundEngine.js'
import { initNative } from './native/index.js'
import { initGlDebug } from './engine/glDebug.js'

// Backported pixi.js 8.14 fix for module-global batch-pool corruption. MUST run
// before any PIXI.Application is constructed. See ARENA_RENDER_DEBUG.md §0.1.
applyPixiPatches()

// Capacitor native shell: lock landscape + hide status bar/splash. No-op on web.
initNative()

// Register the game theme (fetches the bytes; no playback yet). The looping
// music only plays DURING a fight — the Arena starts it when a match begins and
// stops it when the match ends. A top-bar toggle lets the user turn it on/off.
setMusicTrack('/assets/sound/game_theme.mp3', { gain: 0.25 })

// Cache-first Service Worker for /assets (see public/sw.js): keeps the preloaded
// fight assets across page reloads so a reload re-warms from cache, not network.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* SW optional — ignore */ })
  })
}

// Arena render diagnostics — inert unless ?debug=gl (see src/engine/glDebug.js).
initGlDebug(PIXI)

// StrictMode's double-mount is the fastest way to force the unmount-during-
// async-init races in ArenaStage/CharacterPreview, which is exactly the window
// where a half-loaded Spine sprite gets stranded on the global ticker. Behind a
// flag for now so it can be toggled per-tab while reproducing: ?strict=1.
const strict = new URLSearchParams(window.location.search).get('strict') === '1'

const tree = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

createRoot(document.getElementById('root')).render(
  strict ? <StrictMode>{tree}</StrictMode> : tree
)
