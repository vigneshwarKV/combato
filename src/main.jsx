import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './styles/animations.css'
import './styles/wrestling.css'
import App from './App.jsx'
import { setMusicTrack } from './engine/soundEngine.js'

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

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
