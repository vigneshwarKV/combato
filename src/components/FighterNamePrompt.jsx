import { useState } from 'react';

// The entry gate. Shown when no fighter name is stored — /setup no longer
// collects one, so this is the only place a name gets created.
//
// One ask, two controls: a name field and SIGN IN. There is deliberately no
// close button and no dismiss — there is nothing to dismiss to.
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
          Sign in
        </button>
      </form>
    </div>
  );
}
