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

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
