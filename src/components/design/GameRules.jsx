import { useEffect } from 'react';
import { MAX_STRATEGIES } from '../../data/designData.js';
import { PLAYER_MOVE_TOKENS, MOVES_PER_TURN } from '../../engine/prompts.js';
import { FIGHT_TIME_LIMIT_MS } from '../../engine/fightEngine.js';

// The match clock, in words, straight from the engine — the rules state it, and
// it's been retuned before (currently 90s, not a round 2 minutes).
function fightTimeLimitLabel() {
  const total = Math.round(FIGHT_TIME_LIMIT_MS / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (!mins) return `${secs} seconds`;
  return secs ? `${mins} min ${secs} sec` : `${mins} minute${mins > 1 ? 's' : ''}`;
}

// One list, so the markers come from the index and the numbering can't drift as
// rules are added. The plan count, the move vocabulary and the clock are read
// from their source rather than typed out.
function rules() {
  return [
    { body: <>This is a 1 vs 1 duel fight battle.</> },
    { body: <>You have to set the strategy, and your fighter reacts accordingly.</> },
    { body: <>You can set up to {MAX_STRATEGIES} strategies, and switch between them mid-fight.</> },
    { body: <>A strategy runs for {MOVES_PER_TURN} moves. Switch mid-batch and it waits — it takes over only after those {MOVES_PER_TURN}.</> },
    { body: <>You can use valid moves: <code>{PLAYER_MOVE_TOKENS.map(m => m.replace(/_/g, ' ')).join(', ')}</code></> },
    { body: <>While building a strategy you can use live data — your and your opponent’s health, super meter, past moves and more.</> },
    { body: <>Each hit reduces your opponent’s health bar.</> },
    { body: <>Every fighter has different damage and strengths — check <b>Fighter collection</b>.</> },
    { body: <>Each hit or block builds your super meter. Fire the <code>super move</code> and the meter drops to zero.</> },
    { body: <>If your super move gets blocked, your own HP drops.</> },
    { body: <>{fightTimeLimitLabel()} is the time limit.</> },
  ];
}

// The rules of a match. One implementation behind every entry point (home
// header, setup header), so the rules can never disagree with themselves.
// Backdrop click, × and Escape all close.
export default function GameRules({ onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="su-modal-backdrop su-rules-bd pk-design" onClick={onClose}>
      <div className="su-rules" onClick={e => e.stopPropagation()} role="dialog" aria-label="Game rules">
        <div className="su-rules-head">
          <h2>Game rules</h2>
          <button className="su-rules-x" onClick={onClose} aria-label="Close">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="su-rules-body">
          <ol className="su-rules-list">
            {rules().map((r, i) => (
              <li key={i}>
                <span className="n">{i + 1}</span>
                <p>{r.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
