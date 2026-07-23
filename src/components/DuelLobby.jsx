import { useState } from 'react';
import Icon from './design/Icons.jsx';
import { charById } from '../data/designData.js';
import { CHARACTERS } from '../data/characters.js';
import { SlotSprite } from './design/DesignKit.jsx';

// A stripped-down two-seat lobby for the "Play 1v1" flow. Mechanically a 1v1 is
// just a 2-player tournament (single final → champion), but the tournament
// lobby's 16-seat grid + 15:00 timer is heavy for a quick duel. This shows the
// two fighters face-to-face, the shareable code, and a single start/ready
// action — nothing else. Wired to the same lobby state + handlers RoomPage
// passes to LobbyView / MobileLobby.

function FighterCard({ fighter, isMe }) {
  if (!fighter) {
    return (
      <div className="duel-fighter waiting">
        <div className="duel-portrait" />
        <div className="duel-role">Opponent</div>
        <div className="duel-name muted">Waiting…</div>
        <div className="duel-ready pend"><span className="pulse" />NOT HERE YET</div>
      </div>
    );
  }
  const designChar = fighter.character ? charById(fighter.character) : null;
  const ready = fighter.isHost || fighter.ready === true;

  return (
    <div className={`duel-fighter ${isMe ? 'me' : 'opp'}`}>
      <div className="duel-portrait">
        <SlotSprite char={designChar} width={120} height={150} />
      </div>
      <div className="duel-role">{isMe ? 'You' : 'Opponent'}</div>
      <div className="duel-name">{fighter.name || 'Unnamed'}</div>
      <div className={`duel-ready ${ready ? 'on' : 'pend'}`}>
        <span className={ready ? 'dot-on' : 'pulse'} />{ready ? 'READY' : 'NOT READY'}
      </div>
    </div>
  );
}

// Duel result — replaces the tournament "CHAMPION" screen for 1v1. Framed from
// the local player's point of view (Victory / Defeat) rather than a neutral
// champion reveal, and offers a one-tap rematch (host) or leave.
export function DuelResult({ champion, myPeerId, isHost, onRematch, onLeave }) {
  const won = !!champion && champion.peerId === myPeerId;
  const designChar = champion?.character ? charById(champion.character) : null;
  const engineChar = champion?.character ? CHARACTERS[champion.character] : null;
  const charName = designChar?.name || engineChar?.name || '';

  const outcome = !champion ? 'draw' : won ? 'win' : 'lose';
  const title = !champion ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
  const sub = !champion
    ? 'Both fighters fell'
    : won ? 'You won the duel' : `${champion.name} takes the duel`;

  return (
    <div className="bg-arena">
      <div className="spotlight-left" />
      <div className="spotlight-right" />
      <div className="tour-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className={`duel-result ${outcome}`}>
          <div className="duel-result-eyebrow">1v1 Duel</div>
          <h1 className="duel-result-title">{title}</h1>
          <div className="duel-result-sub">{sub}</div>

          {champion && (
            <div className="duel-result-fighter">
              <div className="duel-result-glow" />
              <div className="duel-result-portrait">
                <SlotSprite char={designChar} width={200} height={220} />
              </div>
              <div className="duel-result-name">{champion.name}</div>
              {charName && <div className="duel-result-char">{charName.toUpperCase()}</div>}
            </div>
          )}

          <div className="duel-result-actions">
            {onRematch && (
              <button className="btn btn-red" onClick={onRematch}>
                <Icon name="swords" size={14} />&nbsp;REMATCH
              </button>
            )}
            <button className={onRematch ? 'btn btn-ghost' : 'btn'} onClick={onLeave}>
              <Icon name="back" size={13} />&nbsp;LEAVE
            </button>
          </div>
          {!isHost && (
            <div className="duel-result-hint">Sit tight for a rematch, or leave the room.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Brief interstitial shown to both players once the host starts — the fight
// mounts a beat later. Keeps the 1v1 flow from flashing the tournament bracket.
export function DuelStarting() {
  return (
    <div className="bg-arena">
      <div className="spotlight-left" />
      <div className="spotlight-right" />
      <div className="tour-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="eyebrow" style={{ justifyContent: 'center', display: 'flex' }}>Get ready</div>
          <h1 className="lobby-title" style={{ fontSize: 52 }}>
            The duel is <span className="accent">starting</span>
          </h1>
        </div>
      </div>
    </div>
  );
}

export default function DuelLobby({
  matchCode, isHost, lobbyState,
  inviteLink, connected, error,
  myPeerId,
  onStart, onLeave, onToggleReady,
}) {
  const fighters = lobbyState?.fighters || [];
  const me = fighters.find(f => f.peerId === myPeerId)
    || (isHost ? fighters.find(f => f.isHost) : null);
  const opponent = fighters.find(f => f.peerId !== me?.peerId) || null;
  const iAmReady = !!me?.ready || (isHost && !!me);
  const opponentReady = !!opponent && (opponent.isHost || opponent.ready === true);
  const canStart = isHost && !!opponent && opponentReady;

  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  function copyCode() {
    try {
      navigator.clipboard?.writeText(matchCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  function shareLink() {
    const url = inviteLink || (typeof window !== 'undefined' ? `${window.location.origin}/room/${matchCode}` : matchCode);
    const flash = () => {
      setShared(true);
      setTimeout(() => setShared(false), 1500);
    };
    if (navigator.share) {
      // Message goes in `title`, NOT `text` — some share targets append `text`
      // onto the URL, which corrupts the /room/:code path.
      navigator.share({ title: 'Fight me in a Prompt Kombat 1v1', url }).then(flash).catch(() => {});
    } else {
      navigator.clipboard?.writeText(url);
      flash();
    }
  }

  const statusText = !connected
    ? (error || 'Connecting…')
    : isHost
      ? (opponent ? 'Opponent joined — start when ready' : 'Share the code to invite your opponent')
      : opponent?.name
        ? `Facing ${opponent.name} · tap ready`
        : 'Joined the duel · tap ready';

  const hostStartLabel = !opponent
    ? 'WAITING FOR OPPONENT'
    : !opponentReady
      ? 'WAITING FOR READY'
      : 'START DUEL';

  return (
    <div className="bg-arena">
      <div className="spotlight-left" />
      <div className="spotlight-right" />

      <div className="tour-page">
        <div className="lobby-wrap" style={{ justifyContent: 'center', maxWidth: 900 }}>

          <div className="duel-head">
            <div className="eyebrow"><span className="dot" />{statusText}</div>
            <h1 className="lobby-title">1v1 <span className="accent">Duel</span></h1>
          </div>

          <div className="duel-vs">
            <FighterCard fighter={me} isMe />
            <div className="duel-mid">VS</div>
            <FighterCard fighter={opponent} />
          </div>

          <div className="duel-foot">
            <div className="code-box">
              <div className="lbl">{isHost ? 'Share this code' : 'Room code'}</div>
              <div className="code">
                {matchCode}
                <div className="code-actions">
                  <button className="copy-btn" title={copied ? 'Copied!' : 'Copy code'} onClick={copyCode}>
                    <Icon name={copied ? 'check' : 'copy'} size={14} />
                  </button>
                  <button className="copy-btn" title={shared ? 'Link copied!' : 'Share invite link'} onClick={shareLink}>
                    <Icon name={shared ? 'check' : 'share'} size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div className="duel-actions">
              {isHost ? (
                <>
                  <button className="btn btn-red" onClick={onStart} disabled={!canStart}
                          style={!canStart ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                    <Icon name="play" size={14} />&nbsp;{hostStartLabel}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={onLeave}>
                    <Icon name="close" size={12} />&nbsp;CANCEL
                  </button>
                </>
              ) : (
                <>
                  <button className={iAmReady ? 'btn btn-cyan' : 'btn'} onClick={() => onToggleReady?.(!iAmReady)}>
                    <Icon name={iAmReady ? 'close' : 'play'} size={14} />
                    &nbsp;{iAmReady ? 'CANCEL READY' : "I'M READY"}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={onLeave}>
                    <Icon name="back" size={12} />&nbsp;LEAVE
                  </button>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
