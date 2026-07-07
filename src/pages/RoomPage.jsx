import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useMatchHost } from '../hooks/useMatchHost.js';
import { useMatchClient } from '../hooks/useMatchClient.js';
import { CHARACTERS } from '../data/characters.js';
import { DEFAULT_SIMPLE_STRATEGY } from '../data/promptTemplates.js';
import { charById, loadProfile, isProfileReady, usableStrategies, makeStrategy } from '../data/designData.js';
import Icon from '../components/design/Icons.jsx';
import { Modal, SlotSprite } from '../components/design/DesignKit.jsx';
import NeedSetupPrompt from '../components/design/NeedSetupPrompt.jsx';
import Arena from '../components/Arena.jsx';
import BracketView from '../components/BracketView.jsx';
import ChampionView from '../components/ChampionView.jsx';
import MobileLobby from '../components/mobile/MobileLobby.jsx';
import MobileBracket from '../components/mobile/MobileBracket.jsx';
import { useIsPortrait } from '../hooks/useIsPortrait.js';
import { unlockAudio } from '../engine/soundEngine.js';

const TOTAL_SEATS = 16;
const AUTO_START_SECONDS = 15 * 60; // 15:00 fallback until the host's shared deadline arrives

// ── Player slot ───────────────────────────────────────────────────────────────

function PlayerSlot({ fighter, idx, isMe }) {
  if (!fighter) {
    return (
      <div className="slot empty">
        <div className="slot-portrait" />
        <div className="slot-body">
          <div className="slot-empty-lbl">Waiting…</div>
          <div className="slot-empty-num">SEAT {String(idx + 1).padStart(2, '0')}</div>
        </div>
      </div>
    );
  }
  const designChar = fighter.character ? charById(fighter.character) : null;
  const engineChar = fighter.character ? CHARACTERS[fighter.character] : null;
  const charName = designChar?.name || engineChar?.name || 'No fighter';
  const ready = fighter.isHost || fighter.ready === true;
  const classes = ['slot'];
  if (fighter.isHost) classes.push('host');
  if (isMe) classes.push('me');

  return (
    <div className={classes.join(' ')}>
      <div className="slot-portrait">
        <SlotSprite char={designChar} width={56} height={76} />
      </div>
      <div className="slot-body">
        <div className="slot-name">{fighter.name || 'Unnamed'}</div>
        <div className="slot-char">{charName.toUpperCase()}{isMe ? ' · YOU' : ''}</div>
        <div className={`slot-ready ${ready ? '' : 'pend'}`}>
          <span className="dotg" />{ready ? 'READY' : 'NOT READY'}
        </div>
      </div>
    </div>
  );
}

// ── Countdown clock ───────────────────────────────────────────────────────────

function Clock({ seconds }) {
  const safe = Math.max(0, seconds);
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return (
    <div className="timer-digits">
      {String(mm).padStart(2, '0')}
      <span className="sep">:</span>
      {String(ss).padStart(2, '0')}
    </div>
  );
}

// ── Lobby view (tournament design, real peer state) ──────────────────────────

function splitTitle(name) {
  const parts = (name || 'Tournament').trim().split(/\s+/);
  const last = parts.pop() || 'Tournament';
  return { head: parts.join(' '), tail: last };
}

function LobbyView({
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

  const hostFighter = fighters.find(f => f.isHost);
  const hostHandle = hostFighter?.name || (isHost ? profile.handle : '—');

  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  // Lobby countdown — anchored to the host's broadcast `autoStartAt` so every
  // joiner shows the SAME remaining time (not a fresh local 15:00 each). Falls
  // back to a local 15:00 until that timestamp lands.
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
      // Message goes in `title`, NOT `text` — some share targets append `text`
      // onto the URL, which corrupts the /room/:code path. `url` stays clean.
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

  return (
    <div className="bg-arena">
      <div className="spotlight-left" />
      <div className="spotlight-right" />

      <div className="tour-page">
        <div className="lobby-wrap">

          <div className="lobby-meta">
            <div>
              <div className="eyebrow">
                <span className="dot" />
                {!connected
                  ? (error || 'Connecting…')
                  : isHost
                    ? 'Your lobby · Open for joiners'
                    : `Joined as ${profile.handle} · Waiting for host`}
              </div>
              <h1 className="lobby-title">
                {titleHead && <>{titleHead} </>}<span className="accent">{titleTail}</span>
              </h1>
            </div>
            <div className="code-box">
              <div className="lbl">{isHost ? 'Share this code' : 'Room code'}</div>
              <div className="code">
                {matchCode}
                <div className="code-actions">
                  <button
                    className="copy-btn"
                    title={copied ? 'Copied!' : 'Copy code'}
                    aria-label={copied ? 'Code copied' : 'Copy code'}
                    onClick={copyCode}
                  >
                    <Icon name={copied ? 'check' : 'copy'} size={14} />
                  </button>
                  <button
                    className="copy-btn"
                    title={shared ? 'Link copied!' : 'Share invite link'}
                    aria-label={shared ? 'Link copied' : 'Share invite link'}
                    onClick={shareLink}
                  >
                    <Icon name={shared ? 'check' : 'share'} size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="timer-hero">
            <div className="timer-block">
              <Clock seconds={secondsLeft} />
              <div className="timer-meta">
                <span className="lead">{fighters.length < 2 ? 'Waiting for fighters' : 'Match starts in'}</span>
                <span className="title">Round 1 begins</span>
                <span className="hint">
                  <span className="pulse" />
                  {readyCount}/{fighters.length || 0} ready · {seatsOpen} seats open
                </span>
              </div>
            </div>
            <div className="timer-cta">
              {isHost ? (
                <>
                  <button className="btn" onClick={onStart} disabled={!canStart}
                          style={!canStart ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                    <Icon name="play" size={14} />&nbsp;{startLabel}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={onLeave}>
                    <Icon name="close" size={12} />&nbsp;CANCEL LOBBY
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
                  <button className="btn btn-sm btn-ghost" onClick={onLeave}>
                    <Icon name="back" size={12} />&nbsp;LEAVE LOBBY
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="slots-head">
            <h3>Roster</h3>
            <div className="count"><b>{fighters.length}</b> / {TOTAL_SEATS} joined</div>
          </div>
          <div className="slot-grid">
            {slots.map((f, i) => (
              <PlayerSlot
                key={f?.peerId || `empty-${i}`}
                fighter={f}
                idx={i}
                isMe={!!f && f.peerId === myPeerId}
              />
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Main RoomPage ─────────────────────────────────────────────────────────────

export default function RoomPage() {
  // A shared link can pick up trailing invite text when a share target merges the
  // URL with the message (".../room/7XEZAQ Join my Prompt Kombat lobby" → the
  // ":code" param becomes "7XEZAQ Join my Prompt Kombat lobby"). Room codes are
  // always [A-Z0-9], so keep only the first alphanumeric run — this fixes the
  // routing AND keeps the re-shared inviteLink clean (matchCode derives from it).
  const { code: rawCode } = useParams();
  const code = (rawCode || '').match(/[A-Za-z0-9]+/)?.[0] ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const isHost = location.state?.isHost === true;
  const tournamentName = location.state?.tournamentName;
  const isPortrait = useIsPortrait();

  // Snapshot the profile on first render so the lobby header is stable.
  const [profile] = useState(() => loadProfile());

  // A visitor landing on a shared /room/:code link may not have a fighter +
  // strategy yet. Gate them with a setup prompt before connecting to the room.
  const needsSetup = !isProfileReady(profile);

  const host   = useMatchHost(isHost && !needsSetup ? code : null, { tournamentName });
  const client = useMatchClient(!isHost && !needsSetup ? code : null);

  const lobby           = isHost ? host : client;
  const myConfig        = lobby.myConfig;
  const updateMyConfig  = lobby.updateMyConfig;
  const lobbyState      = lobby.lobbyState;
  const phase           = lobbyState?.phase || 'lobby';
  const bracket         = lobbyState?.bracket;
  const nextMatchStartsAt = lobbyState?.nextMatchStartsAt;
  const champion        = lobbyState?.champion ?? null;
  const myPeerId        = lobby.myPeerId;

  // A late joiner who connected after the tournament started watches as a
  // spectator until it ends, then may opt into the roster.
  const spectating = !isHost && !!lobby.isSpectator;
  // Joining the roster is only offered once the tournament is over.
  const canJoinNow = spectating && (phase === 'champion' || phase === 'lobby');

  // Auto-populate myConfig from the profile saved in /setup. Characters &
  // strategy are already chosen there — no setup UI on this page.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (!myConfig) return;
    const want = {};
    if (!myConfig.name && profile.handle) want.name = profile.handle;
    if (!myConfig.character && profile.charId) want.character = profile.charId;
    if ((!myConfig.strategies || myConfig.strategies.length === 0) && profile.charId) {
      const strategies = usableStrategies(profile.strategies);
      want.strategies = strategies.length ? strategies : [makeStrategy(0, DEFAULT_SIMPLE_STRATEGY)];
      want.activeStrategyIndex = Math.min(profile.activeStrategyIndex ?? 0, Math.max(0, want.strategies.length - 1));
    }
    if (Object.keys(want).length > 0) {
      updateMyConfig(want);
      seededRef.current = true;
    } else if (myConfig.name && myConfig.character) {
      seededRef.current = true;
    }
  }, [myConfig, profile, updateMyConfig]);

  // Style hook for design tokens (matches HomePage/CharSelectPage).
  useEffect(() => {
    document.body.classList.add('pk-design');
    return () => document.body.classList.remove('pk-design');
  }, []);

  // Joiner: navigate home when host closes the room
  useEffect(() => {
    if (!isHost && client.roomClosed) navigate('/');
  }, [client.roomClosed]); // eslint-disable-line

  function handleFightEnd(result) {
    if (!isHost) return;
    setTimeout(() => host.advanceMatch(result?.winner || null), 2000);
  }

  function handleCloseRoom() {
    host.closeRoom();
    navigate('/');
  }

  // ── Setup gate ─────────────────────────────────────────────────────────────
  // New user with no fighter/strategy: prompt them to set up first. "Open
  // settings" round-trips through /setup and redirects back here; "Not now"
  // sends them home. We render this before any room UI and skip the peer
  // connection entirely (see the null code passed to the hooks above).
  if (needsSetup) {
    const returnTo = encodeURIComponent(`/room/${code}`);
    return (
      <div className="bg-arena">
        <div className="spotlight-left" />
        <div className="spotlight-right" />
        <Modal open onClose={() => navigate('/')}>
          <NeedSetupPrompt
            onClose={() => navigate('/')}
            onChoose={() => navigate(`/setup?returnTo=${returnTo}`)}
          />
        </Modal>
      </div>
    );
  }

  const currentMatch  = isHost ? host.currentMatch : null;
  const matchFighters = !isHost ? client.matchFighters : null;
  const fightConfig   = { n: 3 };

  // The tournament fight auto-starts from the bracket countdown timer, NOT a
  // click — so unlike the bot match it never has a user gesture at fight time
  // to unlock audio. Unlock on every tournament gesture (host force-starting a
  // match) so the AudioContext is live + freshly resumed when the Arena mounts
  // and starts the theme. Without this the background music stays silent.
  const startNextMatch = isHost ? () => { unlockAudio(); host.startNextMatch(); } : undefined;

  // Spectating overlay — shown for late joiners across every phase. Surfaces a
  // JOIN action once the tournament ends (champion) or returns to lobby.
  const spectatorBar = spectating
    ? <SpectatorBar canJoin={canJoinNow} onJoin={() => { unlockAudio(); client.joinAsFighter(); }} />
    : null;

  // ── Fighting phase ───────────────────────────────────────────────────────
  // Late joiners stay on the tournament tree for the whole tournament rather
  // than the live Arena, so they're never dropped into a match mid-stream.
  if (phase === 'fighting' && !spectating && (currentMatch || matchFighters)) {
    const rawA = isHost ? currentMatch?.fA : matchFighters?.find(f => f.role === 'A');
    const rawB = isHost ? currentMatch?.fB : matchFighters?.find(f => f.role === 'B');

    // Move computation happens locally per player (host.getMoves / client
    // REQUEST_MOVES), so the injected prompt is unused here — just normalize the
    // mode for the renderer.
    const inject = (f) => (f ? { ...f, promptMode: 'simple' } : f);

    const fighterA = inject(rawA);
    const fighterB = inject(rawB);

    // Live strategy switcher — shown only when the LOCAL player is one of the two
    // fighters in this match (not a spectator). Switching updates myConfig, which
    // the local move computation reads fresh for the next batch.
    const iAmFighting = isHost
      ? !!(rawA?.peerId === myPeerId || rawB?.peerId === myPeerId)
      : (client.matchRole === 'A' || client.matchRole === 'B');
    const myStrategies = iAmFighting ? (myConfig?.strategies || []) : undefined;

    return (
      <>
        <Arena
          fighterA={fighterA}
          fighterB={fighterB}
          fightConfig={{
            ...fightConfig,
            getMoves: isHost ? host.getMoves : undefined,
            onBroadcastEvent: isHost ? host.broadcastFightEvent : undefined,
          }}
          onFightEnd={handleFightEnd}
          mode={isHost ? 'host' : 'spectator'}
          fightEvents={!isHost ? client.fightEvents : undefined}
          strategies={myStrategies}
          activeStrategyIndex={myConfig?.activeStrategyIndex ?? 0}
          onSelectStrategy={(i) => updateMyConfig({ activeStrategyIndex: i })}
        />
        {spectatorBar}
      </>
    );
  }

  // ── Bracket phase ─────────────────────────────────────────────────────────
  // Covers bracket-preview between matches, plus the whole tournament for a
  // spectator — late joiners watch the tree update live rather than the Arena.
  if ((phase === 'bracket-preview' || phase === 'fighting') && bracket) {
    const bracketEl = isPortrait ? (
      <MobileBracket
        bracket={bracket}
        nextMatchStartsAt={nextMatchStartsAt || Date.now()}
        isHost={isHost}
        onStartNow={startNextMatch}
      />
    ) : (
      <BracketView
        bracket={bracket}
        nextMatchStartsAt={nextMatchStartsAt || Date.now()}
        isHost={isHost}
        onStartNow={startNextMatch}
      />
    );
    return <>{bracketEl}{spectatorBar}</>;
  }

  // ── Champion phase ───────────────────────────────────────────────────────
  if (phase === 'champion') {
    return (
      <>
        <ChampionView
          champion={champion}
          isHost={isHost}
          onBackToLobby={isHost ? host.closeTournament : undefined}
          onCloseRoom={isHost ? handleCloseRoom : undefined}
        />
        {spectatorBar}
      </>
    );
  }

  // ── Lobby phase ──────────────────────────────────────────────────────────
  const lobbyProps = {
    matchCode: code,
    isHost,
    lobbyState,
    inviteLink: isHost ? host.inviteLink : '',
    connected: lobby.connected,
    error: lobby.error,
    myPeerId,
    profile,
    onStart: () => { unlockAudio(); host.startTournament(fightConfig); },
    onLeave: isHost ? handleCloseRoom : () => navigate('/'),
    onToggleReady: isHost ? undefined : (next) => { unlockAudio(); client.updateMyConfig({ ready: next }); },
  };

  const lobbyEl = isPortrait ? <MobileLobby {...lobbyProps} /> : <LobbyView {...lobbyProps} />;
  return <>{lobbyEl}{spectatorBar}</>;
}

// ── Spectator overlay ─────────────────────────────────────────────────────────

function SpectatorBar({ canJoin, onJoin }) {
  return (
    <div style={{
      position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)',
      zIndex: 60, display: 'flex', alignItems: 'center', gap: 14,
      padding: '10px 16px', borderRadius: 999,
      background: 'rgba(13,9,23,0.92)', border: '1px solid var(--line)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--f-mono)', fontSize: 12, letterSpacing: '0.08em', color: 'var(--ink-soft)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 8px var(--gold)' }} />
        SPECTATING
      </span>
      {canJoin ? (
        <button className="btn btn-sm" onClick={onJoin}>
          <Icon name="enter" size={14} />&nbsp;JOIN THE RING
        </button>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Tournament in progress…</span>
      )}
    </div>
  );
}
