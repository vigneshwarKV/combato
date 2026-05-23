import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useMatchHost } from '../hooks/useMatchHost.js';
import { useMatchClient } from '../hooks/useMatchClient.js';
import { CHARACTERS } from '../data/characters.js';
import { getCharacterTemplate, DEFAULT_PROMPT } from '../data/promptTemplates.js';
import { charById, loadProfile } from '../data/designData.js';
import Icon from '../components/design/Icons.jsx';
import Arena from '../components/Arena.jsx';
import BracketView from '../components/BracketView.jsx';
import ChampionView from '../components/ChampionView.jsx';
import MobileLobby from '../components/mobile/MobileLobby.jsx';
import MobileBracket from '../components/mobile/MobileBracket.jsx';
import { useIsPortrait } from '../hooks/useIsPortrait.js';

const TOTAL_SEATS = 16;
const AUTO_START_SECONDS = 5 * 60; // 5:00 lobby countdown

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
  const rank = designChar?.rank || '—';
  const ready = fighter.isHost || fighter.ready === true;
  const classes = ['slot'];
  if (fighter.isHost) classes.push('host');
  if (isMe) classes.push('me');

  return (
    <div className={classes.join(' ')}>
      <div className="slot-portrait">
        {designChar?.thumb && <img src={designChar.thumb} alt={charName} draggable="false" />}
      </div>
      <div className="slot-body">
        <div className="slot-name">{fighter.name || 'Unnamed'}</div>
        <div className="slot-char">{charName.toUpperCase()}{isMe ? ' · YOU' : ''}</div>
        <div className={`slot-ready ${ready ? '' : 'pend'}`}>
          <span className="dotg" />{ready ? 'READY' : 'NOT READY'}
        </div>
      </div>
      <div className="slot-stat">
        <div className="slot-rank">{rank}</div>
        <div className="slot-rank-lbl">RANK</div>
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
  const [secondsLeft, setSecondsLeft] = useState(AUTO_START_SECONDS);

  // Visual auto-start countdown — always ticks while the lobby is open.
  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft(s => (s > 0 ? s - 1 : AUTO_START_SECONDS));
    }, 1000);
    return () => clearInterval(id);
  }, []);

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
      navigator.share({ title: 'Prompt Kombat — Tournament', text: 'Join my Prompt Kombat lobby', url })
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
                    <Icon name={iAmReady ? 'check' : 'play'} size={14} />
                    &nbsp;{iAmReady ? 'READY' : 'CLICK TO READY'}
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
  const { code } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isHost = location.state?.isHost === true;
  const tournamentName = location.state?.tournamentName;
  const isPortrait = useIsPortrait();

  const host   = useMatchHost(isHost ? code : null, { tournamentName });
  const client = useMatchClient(!isHost ? code : null);

  const lobby           = isHost ? host : client;
  const myConfig        = lobby.myConfig;
  const updateMyConfig  = lobby.updateMyConfig;
  const lobbyState      = lobby.lobbyState;
  const phase           = lobbyState?.phase || 'lobby';
  const bracket         = lobbyState?.bracket;
  const nextMatchStartsAt = lobbyState?.nextMatchStartsAt;
  const champion        = lobbyState?.champion ?? null;
  const myPeerId        = lobby.myPeerId;

  // Snapshot the profile on first render so the lobby header is stable.
  const [profile] = useState(() => loadProfile());

  // Auto-populate myConfig from the profile saved in /setup. Characters &
  // strategy are already chosen there — no setup UI on this page.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (!myConfig) return;
    const want = {};
    if (!myConfig.name && profile.handle) want.name = profile.handle;
    if (!myConfig.character && profile.charId) want.character = profile.charId;
    if (!myConfig.prompt && profile.charId) {
      const baseStrategy = profile.strategyMode === 'advanced'
        ? profile.strategyAdvanced
        : profile.strategySimple;
      const template = getCharacterTemplate(profile.charId) || DEFAULT_PROMPT;
      want.prompt = baseStrategy ? `${baseStrategy}\n\n${template}` : template;
      want.strategy = baseStrategy || '';
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

  const currentMatch  = isHost ? host.currentMatch : null;
  const matchFighters = !isHost ? client.matchFighters : null;
  const fightConfig   = { n: 3, maxBatches: 20 };

  // ── Bracket preview phase ────────────────────────────────────────────────
  if (phase === 'bracket-preview' && bracket) {
    if (isPortrait) {
      return (
        <MobileBracket
          bracket={bracket}
          nextMatchStartsAt={nextMatchStartsAt || Date.now()}
          isHost={isHost}
          onStartNow={isHost ? host.startNextMatch : undefined}
        />
      );
    }
    return (
      <BracketView
        bracket={bracket}
        nextMatchStartsAt={nextMatchStartsAt || Date.now()}
        isHost={isHost}
        onStartNow={isHost ? host.startNextMatch : undefined}
      />
    );
  }

  // ── Fighting phase ───────────────────────────────────────────────────────
  if (phase === 'fighting' && (currentMatch || matchFighters)) {
    const rawA = isHost ? currentMatch?.fA : matchFighters?.find(f => f.role === 'A');
    const rawB = isHost ? currentMatch?.fB : matchFighters?.find(f => f.role === 'B');
    const hostPeerId = isHost ? host.lobbyState?.fighters?.find(f => f.isHost)?.peerId : null;

    const inject = (f) => {
      if (!f) return f;
      if (isHost && f.peerId === hostPeerId) {
        return { ...f, prompt: host.myConfig.prompt, apiKey: host.myConfig.apiKey, provider: host.myConfig.provider, model: host.myConfig.model };
      }
      return { ...f, prompt: '', apiKey: '', provider: 'groq' };
    };

    const fighterA = inject(rawA);
    const fighterB = inject(rawB);

    return (
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
      />
    );
  }

  // ── Champion phase ───────────────────────────────────────────────────────
  if (phase === 'champion') {
    return (
      <ChampionView
        champion={champion}
        isHost={isHost}
        onBackToLobby={isHost ? host.closeTournament : undefined}
        onCloseRoom={isHost ? handleCloseRoom : undefined}
      />
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
    onStart: () => host.startTournament(fightConfig),
    onLeave: isHost ? handleCloseRoom : () => navigate('/'),
    onToggleReady: isHost ? undefined : (next) => client.updateMyConfig({ ready: next }),
  };

  if (isPortrait) return <MobileLobby {...lobbyProps} />;
  return <LobbyView {...lobbyProps} />;
}
