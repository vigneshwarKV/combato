import { useState } from 'react';
import Icon from './design/Icons.jsx';
import { charById } from '../data/designData.js';
import { CHARACTERS } from '../data/characters.js';
import { SlotSprite } from './design/DesignKit.jsx';
import { useShortLandscape } from '../hooks/useIsPortrait.js';

// A stripped-down two-seat lobby for the "Play 1v1" flow. Mechanically a 1v1 is
// just a 2-player tournament (single final → champion), but the tournament
// lobby's 16-seat grid + 15:00 timer is heavy for a quick duel. This shows the
// two fighters face-to-face, the shareable code, and a single start/ready
// action — nothing else. Wired to the same lobby state + handlers RoomPage
// passes to LobbyView / MobileLobby.

// A seat is a fixed three-row panel — head (role + character), portrait, foot
// (ring name + ready chip). Fixed rows mean the two cards line up regardless of
// how long either ring name is.
function FighterCard({ fighter, isMe, sprite }) {
  // `me` is null for the first frame or two after a joiner connects, before the
  // host's lobbyState lands.
  if (!fighter) {
    return (
      <div className="duel-seat duel-seat-empty">
        <div className="duel-waiting-label">TAKING YOUR SEAT</div>
      </div>
    );
  }
  const designChar = fighter.character ? charById(fighter.character) : null;
  const ready = fighter.isHost || fighter.ready === true;

  return (
    <div className={`duel-seat ${isMe ? 'me' : 'opp'} ${ready ? 'is-ready' : ''}`}>
      <div className="duel-seat-head">
        <span className="duel-role">
          {isMe
            ? (fighter.isHost ? 'YOU · HOST' : 'YOU')
            : (fighter.isHost ? 'OPPONENT · HOST' : 'OPPONENT')}
        </span>
        <span className="duel-char">{(designChar?.name || '').toUpperCase()}</span>
      </div>
      <div className="duel-portrait">
        <SlotSprite char={designChar} width={sprite.w} height={sprite.h} />
      </div>
      <div className="duel-seat-foot">
        <span className="duel-name">{fighter.name || 'Unnamed'}</span>
        <span className={`duel-ready ${ready ? 'on' : 'pend'}`}>
          <span className={ready ? 'dot-on' : 'pulse'} />{ready ? 'READY' : 'NOT READY'}
        </span>
      </div>
    </div>
  );
}

// The empty second seat. The room code lives here rather than in the footer,
// because the code is *how this seat gets filled* — and it should vanish the
// moment the opponent arrives, which it does for free.
function WaitingSeat({ matchCode, copied, shared, onCopy, onShare }) {
  return (
    <div className="duel-seat duel-seat-empty">
      <div className="duel-waiting-label">WAITING FOR OPPONENT</div>
      <div className="code-box duel-code">
        <div className="lbl">Share this code</div>
        <div className="code">
          {matchCode}
          <div className="code-actions">
            <button className="copy-btn" onClick={onCopy} title={copied ? 'Copied!' : 'Copy code'}>
              <Icon name={copied ? 'check' : 'copy'} size={14} />
            </button>
            <button className="copy-btn" onClick={onShare} title={shared ? 'Link copied!' : 'Share invite link'}>
              <Icon name={shared ? 'check' : 'share'} size={14} />
            </button>
          </div>
        </div>
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

  const shortLandscape = useShortLandscape();
  const sprite = shortLandscape ? { w: 130, h: 145 } : { w: 200, h: 220 };

  const outcome = !champion ? 'draw' : won ? 'win' : 'lose';
  const title = !champion ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
  const sub = !champion
    ? 'Both fighters fell'
    : won ? 'You won the duel' : `${champion.name} takes the duel`;

  return (
    <div className="bg-arena duel-page">
      <div className="tour-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className={`duel-result ${outcome}`}>
          <div className="duel-result-eyebrow">1v1 Duel</div>
          <h1 className="duel-result-title">{title}</h1>
          <div className="duel-result-sub">{sub}</div>

          {champion && (
            <div className="duel-result-fighter">
              <div className="duel-result-glow" />
              <div className="duel-result-portrait">
                <SlotSprite char={designChar} width={sprite.w} height={sprite.h} />
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
    <div className="bg-arena duel-page">
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

  // Spine fighters render into a fixed-size Pixi canvas, so CSS can't shrink
  // them with the rest of the card — pick the box here instead.
  const shortLandscape = useShortLandscape();
  const sprite = shortLandscape ? { w: 72, h: 92 } : { w: 120, h: 150 };

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
      navigator.share({ title: 'Fight me in a Combato 1v1', url }).then(flash).catch(() => {});
    } else {
      navigator.clipboard?.writeText(url);
      flash();
    }
  }

  // The bar is controls only, so the old status line is gone: the seats already
  // say who is here, who hosts and who is ready. What the seats CAN'T say is
  // that the peer connection never came up — that keeps a line, in the room
  // body rather than the bar.
  const connText = !connected ? (error || 'Connecting…') : '';

  return (
    <div className="bg-arena duel-page duel-page-lobby">
      <div className="duel-room">
        <header className="game-bar">
          <span className="game-bar-brand">COMBAT<b>O</b></span>
          <span className="game-bar-div" />
          <span className="game-bar-mode">1V1 DUEL</span>
          <span className="game-bar-spacer" />
          <button className="hdr-btn hdr-btn-danger" onClick={onLeave}>
            <Icon name="close" size={12} />{isHost ? 'CANCEL DUEL' : 'LEAVE'}
          </button>
        </header>

        {connText && (
          <div className={`room-conn ${error ? 'is-error' : ''}`} role="status">
            <span className="dot" />{connText}
          </div>
        )}

        <div className="duel-vs">
          <FighterCard fighter={me} isMe sprite={sprite} />
          <div className="duel-mid"><i /><span>VS</span><i /></div>
          {opponent
            ? <FighterCard fighter={opponent} sprite={sprite} />
            : <WaitingSeat matchCode={matchCode} copied={copied} shared={shared}
                           onCopy={copyCode} onShare={shareLink} />}
        </div>

        <footer className="duel-foot">
          {/* The code only reappears down here once the waiting seat that held it
              has been replaced by the opponent. */}
          {opponent && (
            <span className="duel-room-code">ROOM <b>{matchCode}</b></span>
          )}
          <span className="game-bar-spacer" />
          {isHost ? (
            // Label stays put — `disabled` already communicates the wait, and a
            // CTA that renames itself three times reads as a bug.
            <button className="btn" onClick={onStart} disabled={!canStart}>
              <Icon name="play" size={14} />&nbsp;START DUEL
            </button>
          ) : (
            <button className={iAmReady ? 'btn btn-ghost' : 'btn btn-cyan'}
                    onClick={() => onToggleReady?.(!iAmReady)}>
              <Icon name="check" size={14} />
              &nbsp;{iAmReady ? 'CANCEL READY' : "I'M READY"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
