import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './styles/animations.css'
import './styles/wrestling.css'
import App from './App.jsx'
import { startBackgroundMusic } from './engine/soundEngine.js'

// Always-on game theme — registered here (fetched immediately, started on the
// first user gesture per the browser autoplay policy) so it loops across every
// page for the whole session.
startBackgroundMusic('/assets/sound/game_theme.mp3', { gain: 0.25, loop: true })

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
