import { useEffect, useRef, useState } from 'react';
import Icon from '../design/Icons.jsx';
import { charById } from '../../data/designData.js';
import { CHARACTERS } from '../../data/characters.js';

// Ported from the design package (tournament.jsx, "MobileBracket"):
// /tmp/pk-design/pk/project/tournament.jsx:691-806. The bracket shape comes
// from useMatchHost / useMatchClient (see BracketView.jsx for the same
// shape: { size, rounds: [{ label, matches: [{ matchId, fA, fB, winner,
// status, isBye }] }], pointer, champion }).

function MobMatch({ match, label, isLive, isCurrent, isFinal }) {
  const status = match.isBye
    ? 'bye'
    : match.status === 'complete'
      ? 'done'
      : isCurrent
        ? (isLive ? 'live' : 'next')
        : 'tbd';

  function row(side) {
    const f = side === 'a' ? match.fA : match.fB;
    const otherSideWon =
      match.status === 'complete' &&
      match.winner &&
      f &&
      match.winner.peerId !== f.peerId;
    const thisWon =
      match.status === 'complete' &&
      match.winner &&
      f &&
      match.winner.peerId === f.peerId;

    if (!f) {
      return (
        <div className="mob-match-row tbd">
          <div className="mob-match-portrait" />
          <span className="seed">·</span>
          <span className="name">TBD</span>
          <span className="score">–</span>
        </div>
      );
    }

    const designChar = f.character ? charById(f.character) : null;
    const engineChar = f.character ? CHARACTERS[f.character] : null;
    const charName = designChar?.name || engineChar?.name || '?';

    return (
      <div className={`mob-match-row ${thisWon ? 'win' : ''} ${otherSideWon ? 'lose' : ''}`}>
        <div className="mob-match-portrait">
          {designChar?.thumb && <img src={designChar.thumb} alt={charName} draggable="false" />}
        </div>
        <span className="seed">{f.seed ?? ''}</span>
        <span className="name">{f.name || charName}</span>
        <span className="score">{thisWon ? '★' : '–'}</span>
      </div>
    );
  }

  const headerLabel =
    status === 'live' ? <><span>{label}</span><span className="live-pip">LIVE</span></>
    : status === 'next' ? <><span>{label}</span><span>UP NEXT</span></>
    : status === 'done' ? <><span>{label}</span><span>FINAL</span></>
    : status === 'bye' ? <><span>{label}</span><span>BYE</span></>
    : <><span>{label}</span><span>{isFinal ? 'CHAMPION · TBD' : 'SCHEDULED'}</span></>;

  return (
    <div className={`mob-match ${status} ${isFinal ? 'mob-final-card' : ''}`}>
      <div className="mob-match-h">{headerLabel}</div>
      {row('a')}
      {row('b')}
    </div>
  );
}

export default function MobileBracket({ bracket, nextMatchStartsAt, isHost, onStartNow }) {
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, (nextMatchStartsAt || Date.now()) - Date.now())
  );
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setRemainingMs(Math.max(0, (nextMatchStartsAt || Date.now()) - Date.now()));
    const id = setInterval(() => {
      const rem = Math.max(0, (nextMatchStartsAt || Date.now()) - Date.now());
      setRemainingMs(rem);
      if (rem === 0 && isHost && onStartNow && !firedRef.current) {
        firedRef.current = true;
        onStartNow();
      }
    }, 200);
    return () => clearInterval(id);
  }, [nextMatchStartsAt, isHost, onStartNow]);

  if (!bracket) return null;

  const { rounds, pointer } = bracket;
  const currentRoundIdx = pointer?.roundIndex ?? 0;

  const [roundIdx, setRoundIdx] = useState(currentRoundIdx);
  useEffect(() => { setRoundIdx(currentRoundIdx); }, [currentRoundIdx]);

  const currentRound = rounds[roundIdx] || rounds[0];
  const isLiveRound = roundIdx === currentRoundIdx;
  const currentMatchIdx = pointer?.matchIndex ?? 0;

  const totalSec = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');

  const upNextMatch = rounds[currentRoundIdx]?.matches[currentMatchIdx];
  const upNextLabel = upNextMatch
    ? `${rounds[currentRoundIdx].label} · ${(upNextMatch.fA?.name || '?')} vs ${(upNextMatch.fB?.name || '?')}`
    : 'Bracket loading…';

  return (
    <div className="mob-page">
      <div className="mob-topbar">
        <div className="mob-brand">
          <span className="dot" />
          <span>COMBAT<span className="kk">O</span></span>
        </div>
        <div className="mob-actions">
          <span className="tag green" style={{ fontSize: 8, padding: '2px 6px' }}>
            <Icon name="live" size={6} />&nbsp;BRACKET
          </span>
        </div>
      </div>

      <div className="mob-body">
        <div className="mob-head">
          <div className="mob-eyebrow">
            <span className="dot" />Round {currentRoundIdx + 1} of {rounds.length} · Live
          </div>
          <h1 className="mob-title">
            Tournament<br/><span className="accent">Bracket</span>
          </h1>
        </div>

        <div className="mob-trophy">
          <div className="ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M7 4h10v4a5 5 0 1 1-10 0V4Z" fill="rgba(255,216,74,0.18)" />
              <path d="M5 6H3v2a3 3 0 0 0 3 3" />
              <path d="M19 6h2v2a3 3 0 0 1-3 3" />
              <path d="M9 17h6v3H9zM10 20h4v1H10z" fill="rgba(255,216,74,0.2)" />
            </svg>
          </div>
          <div className="meta">
            <div className="lbl">Next match in</div>
            <div className="digits">{mm}<span className="sep">:</span>{ss}</div>
            <div className="desc">{upNextLabel}</div>
          </div>
          {isHost && (
            <div className="start">
              <button
                className="btn btn-sm"
                onClick={() => { firedRef.current = true; onStartNow?.(); }}
              >
                <Icon name="play" size={12} />&nbsp;START
              </button>
            </div>
          )}
        </div>

        <div className="mob-rounds">
          {rounds.map((r, i) => (
            <button
              key={i}
              className={`mob-round ${roundIdx === i ? 'active' : ''}`}
              onClick={() => setRoundIdx(i)}
            >
              {r.label}
              <span className="num">{r.matches.length}</span>
            </button>
          ))}
        </div>

        <div className="mob-matches">
          {currentRound?.matches.map((m, i) => (
            <MobMatch
              key={m.matchId || i}
              match={m}
              label={`${currentRound.label.toUpperCase()} · MATCH ${i + 1}`}
              isLive={isLiveRound && i === currentMatchIdx}
              isCurrent={isLiveRound && i === currentMatchIdx}
              isFinal={roundIdx === rounds.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
