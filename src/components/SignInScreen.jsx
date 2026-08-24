import GoogleLogo from './GoogleLogo.jsx';
import HomeArena from './design/HomeArena.jsx';

// Full-page sign-in (first screen). Shows the brand + the two sign-in routes
// only. The fighter name is collected on the NEXT step (FighterNamePrompt) for
// BOTH routes — so the name the player types is always the name we display.
//
// The animated home characters render behind this via the gate container in
// App.jsx; this component is just the centred stack, with no backdrop/close.
export default function SignInScreen({ onGoogle, onGuest }) {
  return (
    <div className="signin-stack">
      <div className="signin-brand">
        <h1 className="signin-wordmark">COMBAT<span className="kk">O</span></h1>
        <p className="signin-tagline">The AI wrestling arena. Build strategy and unleash your bot.</p>
      </div>

      <div className="signin-arena"><HomeArena /></div>

      <div className="signin-controls">
        <div className="signin-eyebrow">SIGN IN TO CONTINUE</div>

        <div className="signin-buttons">
          <button type="button" className="signin-btn signin-google" onClick={onGoogle}>
            <GoogleLogo /> Sign in with Google
          </button>
          <button type="button" className="signin-btn signin-guest" onClick={onGuest}>
            Play as guest
          </button>
        </div>

        <p className="signin-legal">
          By continuing, you agree to our{' '}
          <a href="/terms.html" target="_blank" rel="noreferrer">Terms of Service</a> and{' '}
          <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
