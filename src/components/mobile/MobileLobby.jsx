import { useEffect, useState } from 'react';
import Icon from '../design/Icons.jsx';
import { charById } from '../../data/designData.js';
import { CHARACTERS } from '../../data/characters.js';
import { SlotSprite } from '../design/DesignKit.jsx';

// Ported from the design package (tournament.jsx, "MobileLobby"):
// /tmp/pk-design/pk/project/tournament.jsx:573-688. Wired to the real lobby
// state + handlers passed in from RoomPage. Mirrors the desktop LobbyView's
// props signature.

const TOTAL_SEATS = 16;
const AUTO_START_SECONDS = 15 * 60; // 15:00 fallback until the host's shared deadline arrives

function MobSlot({ fighter, idx, isMe }) {
  if (!fighter) {
    return (
      <div className="mob-slot empty">
        <div className="mob-slot-portrait" />
        <div>
          <div className="mob-slot-name">Seat {String(idx + 1).padStart(2, '0')}</div>
          <div className="mob-slot-char">WAITING…</div>
        </div>
      </div>
    );
  }
  const designChar = fighter.character ? charById(fighter.character) : null;
  const engineChar = fighter.character ? CHARACTERS[fighter.character] : null;
  const charName = designChar?.name || engineChar?.name || '—';
  const ready = fighter.isHost || fighter.ready === true;

  const classes = ['mob-slot'];
  if (fighter.isHost) classes.push('host');
  if (isMe) classes.push('me');

  return (
    <div className={classes.join(' ')}>
      <div className="mob-slot-portrait">
        <SlotSprite char={designChar} width={46} height={62} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="mob-slot-name">{fighter.name || 'Unnamed'}</div>
        <div className="mob-slot-char">{charName.toUpperCase()}{isMe ? ' · YOU' : ''}</div>
        <div className="mob-slot-foot">
          <span className={`ready ${ready ? '' : 'pend'}`}>● {ready ? 'READY' : 'NOT READY'}</span>
        </div>
      </div>
    </div>
  );
}

function splitTitle(name) {
  const parts = (name || 'Tournament').trim().split(/\s+/);
  const last = parts.pop() || 'Tournament';
  return { head: parts.join(' '), tail: last };
}

export default function MobileLobby({
  matchCode, isHost, lobbyState,
  inviteLink, connected, error,
  myPeerId, profile,
  onStart, onLeave, onToggleReady,
}) {
  const fighters = lobbyState?.fighters || [];
  const slots = Array.from({ length: TOTAL_SEATS }).map((_, i) => fighters[i] || null);
  const readyCount = fighters.filter(f => f.isHost || f.ready).length;
  const seatsOpen = TOTAL_SEATS - fighters.length;
  const myFighter = fighters.find(f => f.peerId === myPeerId);
  const iAmReady = !!myFighter?.ready;
  const allJoinersReady = fighters.filter(f => !f.isHost).every(f => f.ready);
  const { head: titleHead, tail: titleTail } = splitTitle(lobbyState?.tournamentName);

  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  // Anchored to the host's broadcast `autoStartAt` so every joiner shows the
  // same remaining time. Falls back to a local 15:00 until it arrives.
  const autoStartAt = lobbyState?.autoStartAt;
  const [secondsLeft, setSecondsLeft] = useState(() =>
    autoStartAt ? Math.max(0, Math.round((autoStartAt - Date.now()) / 1000)) : AUTO_START_SECONDS
  );

  useEffect(() => {
    const tick = () => setSecondsLeft(
      autoStartAt ? Math.max(0, Math.round((autoStartAt - Date.now()) / 1000)) : AUTO_START_SECONDS
    );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [autoStartAt]);

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
      // Message in `title`, not `text` — some share targets append `text` onto
      // the URL and corrupt the /room/:code path. Keep `url` clean.
      navigator.share({ title: 'Join my Prompt Kombat lobby', url })
        .then(flash)
        .catch(() => {});
    } else {
      navigator.clipboard?.writeText(url);
      flash();
    }
  }

  const canStart = isHost && fighters.length >= 2 && allJoinersReady;
  const startLabel = fighters.length < 2
    ? 'WAITING…'
    : !allJoinersReady
      ? 'WAITING FOR READY'
      : 'START NOW';
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="mob-page">
      <div className="mob-body">
        <div className="mob-head">
          <div className="mob-eyebrow">
            <span className="dot" />
            {!connected
              ? (error || 'CONNECTING…')
              : isHost
                ? 'Your lobby · Open'
                : `Joined as ${profile?.handle} · Waiting for host`}
          </div>
          <h1 className="mob-title">
            {titleHead && <>{titleHead}<br/></>}<span className="accent">{titleTail}</span>
          </h1>
        </div>

        <div className="mob-code">
          <div>
            <div className="lbl">{isHost ? 'Share code' : 'Room code'}</div>
            <div className="code">{matchCode}</div>
          </div>
          <div className="mob-code-actions">
            <button className="copy-btn" title={copied ? 'Copied!' : 'Copy code'} onClick={copyCode}>
              <Icon name={copied ? 'check' : 'copy'} size={16} />
            </button>
            <button
              className="copy-btn"
              title={shared ? 'Link copied!' : 'Share invite link'}
              onClick={shareLink}
            >
              <Icon name={shared ? 'check' : 'share'} size={16} />
            </button>
          </div>
        </div>

        <div className="mob-timer">
          <span className="lead">
            {fighters.length < 2 ? 'Waiting for fighters' : 'Match starts in'}
          </span>
          <div className="digits">
            {mm}<span className="sep">:</span>{ss}
          </div>
          <div className="hint">
            <span className="pulse" />
            {readyCount}/{fighters.length} ready · {seatsOpen} seats open
          </div>
          <div className="actions">
            {isHost ? (
              <>
                <button
                  className="btn"
                  onClick={onStart}
                  disabled={!canStart}
                  style={!canStart ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                >
                  <Icon name="play" size={14} />&nbsp;{startLabel}
                </button>
                <button className="btn btn-ghost icon-only" onClick={onLeave} title="Cancel lobby">
                  <Icon name="close" size={16} />
                </button>
              </>
            ) : (
              <>
                <button
                  className={iAmReady ? 'btn btn-cyan' : 'btn'}
                  onClick={() => onToggleReady?.(!iAmReady)}
                >
                  <Icon name={iAmReady ? 'close' : 'play'} size={14} />
                  &nbsp;{iAmReady ? 'CANCEL READY' : 'CLICK TO READY'}
                </button>
                <button className="btn btn-ghost icon-only" onClick={onLeave} title="Leave lobby">
                  <Icon name="back" size={16} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mob-roster-head">
          <h3>Roster</h3>
          <div className="count"><b>{fighters.length}</b> / {TOTAL_SEATS} joined</div>
        </div>
        <div className="mob-roster">
          {slots.map((f, i) => (
            <MobSlot
              key={f?.peerId || `empty-${i}`}
              fighter={f}
              idx={i}
              isMe={!!f && f.peerId === myPeerId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
