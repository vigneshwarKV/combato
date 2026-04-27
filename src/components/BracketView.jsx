import { useState, useEffect, useRef } from 'react';
import { CHARACTERS } from '../data/characters.js';
import CharImage from './CharImage.jsx';

const MATCH_W = 210;
const CONNECTOR_W = 48;
const SLOT_H = 96;
const MATCH_H = 76;

function BracketMatchBox({ match, isCurrent }) {
  const charA = match.fA?.character ? CHARACTERS[match.fA.character] : null;
  const charB = match.fB?.character ? CHARACTERS[match.fB.character] : null;

  if (match.isBye) {
    const f = match.fA || match.fB;
    const char = f?.character ? CHARACTERS[f.character] : null;
    return (
      <div className="bracket-match-box bracket-match-bye">
        <div className="bracket-match-bye-badge">BYE</div>
        <div className="bracket-fighter-row bracket-fighter-winner">
          <div className="bracket-fighter-avatar">
            <CharImage char={char} size={26} />
          </div>
          <span className="bracket-fighter-name">{f?.name || '?'}</span>
          <span className="bracket-fighter-advance">→</span>
        </div>
      </div>
    );
  }

  if (!match.fA && !match.fB) {
    return (
      <div className="bracket-match-box bracket-match-empty">
        <div className="bracket-fighter-row bracket-fighter-tbd"><span>TBD</span></div>
        <div className="bracket-match-divider" />
        <div className="bracket-fighter-row bracket-fighter-tbd"><span>TBD</span></div>
      </div>
    );
  }

  const aWon = match.status === 'complete' && match.winner?.peerId === match.fA?.peerId;
  const bWon = match.status === 'complete' && match.winner?.peerId === match.fB?.peerId;

  return (
    <div className={`bracket-match-box ${isCurrent ? 'bracket-match-current' : ''} ${match.status === 'complete' ? 'bracket-match-done' : ''}`}>
      <div className={`bracket-fighter-row ${aWon ? 'bracket-fighter-winner' : ''} ${bWon ? 'bracket-fighter-loser' : ''}`}>
        <div className="bracket-fighter-avatar">
          <CharImage char={charA} size={26} />
        </div>
        <span className="bracket-fighter-name">{match.fA?.name || <em className="bracket-tbd">TBD</em>}</span>
        {aWon && <span className="bracket-fighter-crown">★</span>}
      </div>
      <div className="bracket-match-divider" />
      <div className={`bracket-fighter-row ${bWon ? 'bracket-fighter-winner' : ''} ${aWon ? 'bracket-fighter-loser' : ''}`}>
        <div className="bracket-fighter-avatar">
          <CharImage char={charB} size={26} />
        </div>
        <span className="bracket-fighter-name">{match.fB?.name || <em className="bracket-tbd">TBD</em>}</span>
        {bWon && <span className="bracket-fighter-crown">★</span>}
      </div>
    </div>
  );
}

function BracketLines({ rounds, bracketSize }) {
  const n = bracketSize;
  const lines = [];

  rounds.forEach((round, ri) => {
    if (ri === rounds.length - 1) return;
    const matchSlots = n / round.matches.length;

    for (let mi = 0; mi < round.matches.length; mi += 2) {
      const yA = (mi + 0.5) * matchSlots * SLOT_H;
      const yB = (mi + 1.5) * matchSlots * SLOT_H;
      const yMid = (yA + yB) / 2;

      const rightX = ri * (MATCH_W + CONNECTOR_W) + MATCH_W;
      const midX = rightX + CONNECTOR_W / 2;
      const nextLeftX = (ri + 1) * (MATCH_W + CONNECTOR_W);

      lines.push(
        <line key={`${ri}-${mi}-ha`} x1={rightX} y1={yA} x2={midX} y2={yA} />,
        <line key={`${ri}-${mi}-hb`} x1={rightX} y1={yB} x2={midX} y2={yB} />,
        <line key={`${ri}-${mi}-v`}  x1={midX}   y1={yA} x2={midX} y2={yB} />,
        <line key={`${ri}-${mi}-hn`} x1={midX}   y1={yMid} x2={nextLeftX} y2={yMid} />,
      );
    }
  });

  const svgW = rounds.length * (MATCH_W + CONNECTOR_W) + CONNECTOR_W;
  const svgH = n * SLOT_H;

  return (
    <svg
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
      width={svgW} height={svgH}
    >
      <g stroke="rgba(255,215,0,0.45)" strokeWidth="2" fill="none">
        {lines}
      </g>
    </svg>
  );
}

function CountdownPill({ remainingMs, totalMs }) {
  const pct = Math.max(0, Math.min(1, remainingMs / totalMs));
  const secs = Math.ceil(remainingMs / 1000);
  const circumference = 2 * Math.PI * 18;
  const dashOffset = circumference * (1 - pct);

  return (
    <div className="countdown-pill">
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="18" fill="none" stroke="var(--arena-panel-border)" strokeWidth="3" />
        <circle
          cx="22" cy="22" r="18" fill="none"
          stroke={secs <= 5 ? 'var(--neon-red)' : 'var(--neon-gold)'}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 22 22)"
          style={{ transition: 'stroke-dashoffset 0.1s linear, stroke 0.3s' }}
        />
        <text x="22" y="27" textAnchor="middle"
          style={{ fontFamily: 'var(--font-arena)', fontSize: 13, fill: secs <= 5 ? 'var(--neon-red)' : 'var(--neon-gold)' }}>
          {secs}
        </text>
      </svg>
    </div>
  );
}

export default function BracketView({ bracket, nextMatchStartsAt, isHost, onStartNow }) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, nextMatchStartsAt - Date.now()));
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setRemainingMs(Math.max(0, nextMatchStartsAt - Date.now()));

    const id = setInterval(() => {
      const rem = Math.max(0, nextMatchStartsAt - Date.now());
      setRemainingMs(rem);
      if (rem === 0 && isHost && !firedRef.current) {
        firedRef.current = true;
        onStartNow();
      }
    }, 100);

    return () => clearInterval(id);
  }, [nextMatchStartsAt, isHost, onStartNow]);

  if (!bracket) return null;

  const { rounds, pointer, champion } = bracket;
  const n = bracket.size;

  const currentMatchId = pointer
    ? rounds[pointer.roundIndex]?.matches[pointer.matchIndex]?.matchId
    : null;

  const totalHeight = n * SLOT_H;
  const treeWidth = rounds.length * (MATCH_W + CONNECTOR_W) + CONNECTOR_W / 2 + 90;

  return (
    <div className="bracket-stage">
      {/* Banner */}
      <div className="bracket-banner">
        <h1 className="bracket-title">TOURNAMENT BRACKET</h1>
        <div className="bracket-banner-right">
          {remainingMs > 0 && (
            <div className="bracket-countdown-wrap">
              <CountdownPill remainingMs={remainingMs} totalMs={20000} />
              <span className="bracket-countdown-label">next match</span>
            </div>
          )}
          {isHost && (
            <button className="btn-arena btn-arena-sm" onClick={() => { firedRef.current = true; onStartNow(); }}>
              Start Match Now
            </button>
          )}
        </div>
      </div>

      {/* Round labels row */}
      <div className="bracket-labels-row" style={{ width: treeWidth }}>
        {rounds.map((round, ri) => (
          <div
            key={ri}
            className="bracket-round-label"
            style={{ left: ri * (MATCH_W + CONNECTOR_W), width: MATCH_W }}
          >
            {round.label}
          </div>
        ))}
      </div>

      {/* Scrollable bracket tree */}
      <div className="bracket-scroll-wrap">
        <div className="bracket-tree" style={{ width: treeWidth, height: totalHeight }}>
          <BracketLines rounds={rounds} bracketSize={n} />

          {rounds.map((round, ri) => {
            const matchSlots = n / round.matches.length;
            return round.matches.map((match, mi) => {
              const centerY = (mi + 0.5) * matchSlots * SLOT_H;
              const top = Math.round(centerY - MATCH_H / 2);
              const left = ri * (MATCH_W + CONNECTOR_W);
              return (
                <div
                  key={match.matchId}
                  style={{ position: 'absolute', top, left, width: MATCH_W }}
                >
                  <BracketMatchBox match={match} isCurrent={match.matchId === currentMatchId} />
                </div>
              );
            });
          })}

          {/* Trophy — vertically centered, to the right of the final match */}
          <div
            className="bracket-trophy-slot"
            style={{
              position: 'absolute',
              left: rounds.length * (MATCH_W + CONNECTOR_W) + CONNECTOR_W / 2,
              top: totalHeight / 2,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="bracket-trophy-icon">🏆</div>
            <div className="bracket-trophy-name">{champion?.name ?? '???'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
