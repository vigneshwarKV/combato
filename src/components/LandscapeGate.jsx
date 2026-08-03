import { useIsPortrait } from '../hooks/useIsPortrait.js';
import Icon from './design/Icons.jsx';

// App-wide landscape enforcement for the WEB / PWA build.
//
// Native apps (Capacitor) are hard-locked to landscape by the OS, so this
// overlay never appears there. On the web we can't force the device to rotate,
// so whenever a phone is held in portrait we cover the whole app with a
// "rotate your device" prompt — the game is landscape-only everywhere.
//
// Crucially, `children` stay MOUNTED behind the overlay. Rotating a phone
// mid-match must not unmount the Arena and tear down the live P2P connection —
// so we overlay, we never swap the tree out.
export function LandscapeGate({ children }) {
  const isPortrait = useIsPortrait();
  return (
    <>
      {children}
      {isPortrait && (
        <div className="landscape-gate" role="alertdialog" aria-label="Rotate your device">
          <Icon name="rotate" size={72} />
          <div className="lg-title">Rotate your device</div>
          <p className="lg-sub">Prompt Kombat plays in landscape. Turn your phone sideways to continue.</p>
        </div>
      )}
    </>
  );
}
