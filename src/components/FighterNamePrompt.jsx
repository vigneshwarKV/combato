import { useState } from 'react';

// Second step of the entry flow: collect the fighter name. Sign-in (guest or
// Google) already happened on the previous screen, so this card only asks for a
// name — no Google button here. The name entered is the handle shown everywhere;
// it can be changed later in the profile.
export default function FighterNamePrompt({ onSignIn }) {
  const [name, setName] = useState('');
  const clean = name.trim();

  function submit(e) {
    e.preventDefault();
    if (clean) onSignIn(clean);
  }

  return (
    <div className="modal-backdrop fname-backdrop">
      {/* <form> gives Enter-to-submit for free. */}
      <form className="fname-card" onSubmit={submit}>
        <div className="fname-label">ENTER YOUR FIGHTER NAME</div>
        <div className="fname-field">
          {/* maxLength keeps the typed name on one line at 44px Bebas. */}
          <input
            className="fname-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="UNNAMED"
            maxLength={16}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            aria-label="Fighter name"
          />
          <span className="fname-rule" />
        </div>
        <button type="submit" className="btn fname-submit" disabled={!clean}>
          Continue
        </button>
      </form>
    </div>
  );
}
