import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useMatchHost, clearHostSnapshot, saveHostSnapshot, removeFighterFromBracket, rekeyFighterInBracket } from '../hooks/useMatchHost.js';
import { useMatchClient } from '../hooks/useMatchClient.js';
import { useSingleRoomTab } from '../hooks/useSingleRoomTab.js';
import { CHARACTERS } from '../data/characters.js';
import { DEFAULT_SIMPLE_STRATEGY } from '../data/promptTemplates.js';
import { charById, loadProfile, isProfileReady, usableStrategies, makeStrategy } from '../data/designData.js';
import Icon from '../components/design/Icons.jsx';
import { Modal, SlotSprite } from '../components/design/DesignKit.jsx';
import NeedSetupPrompt from '../components/design/NeedSetupPrompt.jsx';
import Arena from '../components/Arena.jsx';
import DuelLobby, { DuelStarting, DuelResult } from '../components/DuelLobby.jsx';
import BracketView from '../components/BracketView.jsx';
import ChampionView from '../components/ChampionView.jsx';
import MobileLobby from '../components/mobile/MobileLobby.jsx';
import MobileBracket from '../components/mobile/MobileBracket.jsx';
import { useIsPortrait } from '../hooks/useIsPortrait.js';
import { unlockAudio } from '../engine/soundEngine.js';
import { forgetJoinerId } from '../engine/peerEngine.js';
import { startScoredMatch, submitScore } from '../lib/leaderboard.js';
import { buildMatchSummary } from '../engine/scoring.js';

const TOTAL_SEATS = 16;
const AUTO_START_SECONDS = 15 * 60; // 15:00 fallback until the host's shared deadline arrives

// Router state (isHost / mode / tournamentName) is set when navigating in from the
// home page — but a full page REFRESH drops it, and a second tab opened from a
// pasted link never had it. We stash it per-room in sessionStorage on first entry
// and restore it on a reload, so a refresh doesn't silently turn the host into a
// joiner (or lose the 1v1-vs-tournament mode). sessionStorage is per-tab on
// purpose: a refresh restores your role, while a brand-new tab resolves fresh
// (defaulting to joiner), which avoids two tabs both claiming to be the host.
const roomKey = (code) => `pk.room.${code}`;

function readRoomEntry(code, state) {
  const norm = (s) => ({
    isHost: s?.isHost === true,
    mode: s?.mode ?? null,
    tournamentName: s?.tournamentName ?? null,
  });
  if (state && (state.isHost !== undefined || state.mode !== undefined)) return norm(state);
  try {
    const saved = JSON.parse(sessionStorage.getItem(roomKey(code)) || 'null');
    if (saved) return norm(saved);
  } catch { /* ignore */ }
  return { isHost: false, mode: null, tournamentName: null };
}

// Forget a room on deliberate leave / close so a later re-entry starts clean.
function clearRoomSession(code) {
  try { sessionStorage.removeItem(roomKey(code)); } catch { /* ignore */ }
  forgetJoinerId(code);
  clearHostSnapshot(code);
}

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
  myPeerId,
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
      navigator.share({ title: 'Join my Combato lobby', url })
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
        <header className="game-bar">
          <span className="game-bar-brand">COMBAT<b>O</b></span>
          <span className="game-bar-div" />
          <span className="game-bar-mode">TOURNAMENT</span>
          <span className="game-bar-spacer" />
          <button className="hdr-btn hdr-btn-danger" onClick={onLeave}>
            <Icon name="close" size={12} />{isHost ? 'CANCEL LOBBY' : 'LEAVE'}
          </button>
        </header>

        {/* The eyebrow that used to carry this is gone (who hosts / who we wait
            on is redundant with the seats and the timer) — but a dead peer
            connection isn't, so it keeps a line of its own. */}
        {!connected && (
          <div className={`room-conn ${error ? 'is-error' : ''}`} role="status">
            <span className="dot" />{error || 'Connecting…'}
          </div>
        )}

        <div className="lobby-wrap">

          <div className="lobby-meta">
            <div>
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
            {/* Primary action only — leaving the lobby lives in the header bar. */}
            <div className="timer-cta">
              {isHost ? (
                <button className="btn" onClick={onStart} disabled={!canStart}
                        style={!canStart ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}>
                  <Icon name="play" size={14} />&nbsp;{startLabel}
                </button>
              ) : (
                <button
                  className={iAmReady ? 'btn btn-cyan' : 'btn'}
                  onClick={() => onToggleReady?.(!iAmReady)}
                >
                  <Icon name={iAmReady ? 'close' : 'play'} size={14} />
                  &nbsp;{iAmReady ? 'CANCEL READY' : 'CLICK TO READY'}
                </button>
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
  // URL with the message (".../room/7XEZAQ Join my Combato lobby" → the
  // ":code" param becomes "7XEZAQ Join my Combato lobby"). Room codes are
  // always [A-Z0-9], so keep only the first alphanumeric run — this fixes the
  // routing AND keeps the re-shared inviteLink clean (matchCode derives from it).
  const { code: rawCode } = useParams();
  const code = (rawCode || '').match(/[A-Za-z0-9]+/)?.[0] ?? '';
  const location = useLocation();
  const navigate = useNavigate();

  // Resolve role/mode once, preferring live router state and falling back to the
  // per-room sessionStorage snapshot after a refresh (see readRoomEntry).
  const [roomEntry] = useState(() => readRoomEntry(code, location.state));
  // A joiner can be PROMOTED to host if the original host leaves (failover), and
  // a host can be STEPPED DOWN if a better host exists (split-brain). So the
  // effective host role is dynamic — not just the role we entered with.
  //
  // Migration is two-phase: 'detach' first tears our client channel down, THEN
  // 'host' subscribes as host — never two channels on the same room topic at once
  // (Supabase can't handle that, and it strands the other joiners).
  const [migration, setMigration] = useState('none'); // 'none' | 'host'
  const [steppedDown, setSteppedDown] = useState(false);
  const migratingRef = useRef(false);
  const adoptedPeerRef = useRef(null); // the client peer promoted in place to host
  const isHost = (roomEntry.isHost || migration === 'host') && !steppedDown;
  const tournamentName = roomEntry.tournamentName;
  // '1v1' duels get a lighter lobby + auto-skip the bracket preview. A joiner
  // arriving via a shared link has no state, so fall back to the mode the host
  // broadcasts in the lobby state (resolved below once lobbyState is available).
  const stateMode = roomEntry.mode;
  const isPortrait = useIsPortrait();

  // Persist authoritative router state so a later refresh can restore it.
  useEffect(() => {
    if (location.state && (location.state.isHost !== undefined || location.state.mode !== undefined)) {
      try { sessionStorage.setItem(roomKey(code), JSON.stringify(roomEntry)); } catch { /* ignore */ }
    }
  }, [code, roomEntry, location.state]);

  // Snapshot the profile on first render so the lobby header is stable.
  const [profile] = useState(() => loadProfile());

  // A visitor landing on a shared /room/:code link may not have a fighter +
  // strategy yet. Gate them with a setup prompt before connecting to the room.
  const needsSetup = !isProfileReady(profile);

  // One active tab per room, per browser. A second tab resolves to 'duplicate'
  // and never connects (avoids a ghost host member / double joiner). 'checking'
  // for ~350ms on mount, then 'active' | 'duplicate' | 'released'. A duplicate
  // may 'Continue here' to seize the room, but only when the holder is a joiner
  // (peerRole) — taking over a host would orphan the room.
  const { status: tabStatus, peerRole: tabPeerRole, takeOver } = useSingleRoomTab(code, isHost ? 'host' : 'joiner');
  const canConnect = !needsSetup && tabStatus === 'active';

  // On promotion the host ADOPTS the client's peer (reuses its working channel).
  const host   = useMatchHost(isHost && canConnect ? code : null, { tournamentName, mode: stateMode, adoptPeer: adoptedPeerRef.current });
  const client = useMatchClient(!isHost && canConnect ? code : null);

  const lobby           = isHost ? host : client;
  const myConfig        = lobby.myConfig;
  const updateMyConfig  = lobby.updateMyConfig;
  const lobbyState      = lobby.lobbyState;
  const phase           = lobbyState?.phase || 'lobby';
  const bracket         = lobbyState?.bracket;
  const nextMatchStartsAt = lobbyState?.nextMatchStartsAt;
  const champion        = lobbyState?.champion ?? null;
  const myPeerId        = lobby.myPeerId;
  const mode            = stateMode || lobbyState?.mode;
  const is1v1           = mode === '1v1';

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

  // ── Host failover ────────────────────────────────────────────────────────────
  // If the original host leaves for good, the elected successor (smallest
  // remaining peerId — every client agrees) promotes ITSELF: seed the host
  // snapshot from our last lobby state (forfeiting the departed host and adopting
  // the host id == room code), then flip our role. useMatchHost then rehydrates
  // from that seed and re-broadcasts; the other joiners reconnect to us.
  useEffect(() => {
    if (roomEntry.isHost || steppedDown || migratingRef.current) return;    // already host / stepped down / migrating
    if (!client.hostGone || client.successorId !== client.myPeerId) return;  // not the elected successor
    const last = client.lobbyState;
    const myId = client.myPeerId;
    if (!last || !myId) return;
    migratingRef.current = true;

    let bracket = last.bracket || null;
    if (bracket) {
      bracket = removeFighterFromBracket(bracket, code);    // departed host forfeits
      bracket = rekeyFighterInBracket(bracket, myId, code); // I adopt the host id
    }
    // If the forfeit finished the tournament (e.g. a 1v1 the host abandoned), land
    // on the champion screen rather than an empty bracket-preview.
    const phase = bracket && !bracket.pointer && bracket.champion ? 'champion' : last.phase;
    const seed = {
      ...last,
      matchCode: code,
      phase,
      bracket,
      champion: bracket?.champion ?? last.champion ?? null,
      fighters: (last.fighters || [])
        .filter(f => f.peerId !== code)                                            // drop old host
        .map(f => (f.peerId === myId ? { ...f, peerId: code, isHost: true } : f)), // I take its seat
      hostEpoch: (last.hostEpoch || 0) + 1,
    };
    saveHostSnapshot(code, seed);
    seededRef.current = false; // re-seed my (host) fighter config after the role flip
    adoptedPeerRef.current = client.releasePeer(); // hand our peer to the host hook
    setMigration('host');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomEntry.isHost, steppedDown, client.hostGone, client.successorId, client.myPeerId, client.lobbyState, code]);

  // Split-brain resolution: our host peer detected a BETTER host (we returned
  // after being replaced, or a rare double-promotion). Step down — stop hosting,
  // forget the host role so a refresh won't reclaim it, and rejoin as a client.
  useEffect(() => {
    if (!host.hostConflict || steppedDown) return;
    clearHostSnapshot(code);
    try { sessionStorage.setItem(roomKey(code), JSON.stringify({ ...roomEntry, isHost: false })); } catch { /* ignore */ }
    migratingRef.current = false;
    seededRef.current = false; // re-seed my fighter config now that I'm a client again
    setMigration('none');
    setSteppedDown(true);
  }, [host.hostConflict]); // eslint-disable-line

  // Style hook for design tokens (matches HomePage/CharSelectPage).
  useEffect(() => {
    document.body.classList.add('pk-design');
    return () => document.body.classList.remove('pk-design');
  }, []);

  // Joiner: navigate home when host closes the room
  useEffect(() => {
    if (!isHost && client.roomClosed) { clearRoomSession(code); navigate('/'); }
  }, [client.roomClosed]); // eslint-disable-line

  // 1v1 has a single match, so the 20s bracket-preview countdown is just dead
  // time — the host fires the match the instant the bracket is built. The
  // START DUEL click already unlocked audio, so the Arena mounts with sound.
  // Exception: when RESUMING after a host refresh, wait out `resumeGraceUntil`
  // so the opponent has time to reconnect and catch the re-run's FIGHT_START.
  useEffect(() => {
    if (isHost && is1v1 && phase === 'bracket-preview' && bracket) {
      const grace = lobbyState?.resumeGraceUntil;
      const wait = grace ? grace - Date.now() : 0;
      if (wait > 0) {
        const t = setTimeout(() => host.startNextMatch(), wait);
        return () => clearTimeout(t);
      }
      host.startNextMatch();
    }
  }, [isHost, is1v1, phase, bracket]); // eslint-disable-line

  // ── PvP leaderboard scoring ─────────────────────────────────────────────────
  // Each FIGHTER (not spectators) submits their OWN result. When a match I'm in
  // starts, fetch a signed match token; on fight end, submit. Host and joiner
  // both run this; only the host also advances the bracket.
  const scoreMode = is1v1 ? '1v1' : 'tournament';
  const matchTokenRef = useRef(null);
  const matchStartAtRef = useRef(0);
  const matchSideRef = useRef(null);
  const scoredKeyRef = useRef(null);

  useEffect(() => {
    if (phase !== 'fighting') { scoredKeyRef.current = null; matchSideRef.current = null; return; }
    const a = isHost ? host.currentMatch?.fA : client.matchFighters?.find(f => f.role === 'A');
    const b = isHost ? host.currentMatch?.fB : client.matchFighters?.find(f => f.role === 'B');
    const side = isHost
      ? (a?.peerId === myPeerId ? 'A' : b?.peerId === myPeerId ? 'B' : null)
      : (client.matchRole === 'A' || client.matchRole === 'B' ? client.matchRole : null);
    if (!side || !a || !b) return;
    // Stable per-match dedup id (same on host + joiner, survives a re-run) so a
    // reconnect / host refresh can't double-post this match to the leaderboard.
    const dedupId = (isHost ? host.currentMatch?.matchId : client.matchId) || `${a.peerId}|${b.peerId}`;
    const key = `${a.peerId}|${b.peerId}`;
    if (scoredKeyRef.current === key) return; // already armed for this match
    scoredKeyRef.current = key;
    matchSideRef.current = side;
    matchTokenRef.current = null;
    matchStartAtRef.current = Date.now();
    startScoredMatch(scoreMode, dedupId).then((t) => { matchTokenRef.current = t; });
  }, [phase, isHost, host.currentMatch, client.matchFighters, client.matchId, client.matchRole, myPeerId, scoreMode]);

  function handleFightEnd(result) {
    // Submit my own score if I fought in this match (best-effort).
    const token = matchTokenRef.current;
    const side = matchSideRef.current;
    if (token && side && result) {
      const summary = buildMatchSummary(result, {
        mode: scoreMode,
        playerSide: side,
        durationMs: Date.now() - matchStartAtRef.current,
      });
      submitScore(token, summary);
      matchTokenRef.current = null; // one submission per match
    }
    // Only the host drives the bracket forward.
    if (isHost) setTimeout(() => host.advanceMatch(result?.winner || null), 2000);
  }

  function handleCloseRoom() {
    clearRoomSession(code);
    host.closeRoom();
    navigate('/');
  }

  // ── Duplicate-tab gate ─────────────────────────────────────────────────────
  // This room is already open in another tab/window of this browser. Don't
  // connect (would create a ghost host member / double joiner). Offer to move the
  // session here, but ONLY when the holder is a joiner — seizing a host would
  // orphan the room (its live bracket lives in that tab's sessionStorage).
  if (tabStatus === 'duplicate') {
    const canTakeOver = tabPeerRole === 'joiner' && !isHost;
    return (
      <div className="bg-arena">
        <Modal open onClose={() => navigate('/')}>
          <div className="dup-tab">
            <h3 className="dup-tab-title">Already open in another tab</h3>
            <p className="dup-tab-body">
              This room is open in another tab or window of this browser.
              {canTakeOver
                ? ' Continue here to move your session to this tab.'
                : ' Continue there — opening it twice would join you to the match twice.'}
            </p>
            <div className="dup-tab-actions">
              {canTakeOver && <button className="btn" onClick={takeOver}>Continue here</button>}
              <button className={canTakeOver ? 'btn btn-ghost' : 'btn'} onClick={() => navigate('/')}>
                Back to home
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // Superseded: another tab took over this room (see takeOver). We've stopped
  // participating; point the player at the tab that now holds the session.
  if (tabStatus === 'released') {
    return (
      <div className="bg-arena">
        <Modal open onClose={() => navigate('/')}>
          <div className="dup-tab">
            <h3 className="dup-tab-title">Moved to another tab</h3>
            <p className="dup-tab-body">
              You continued this room in another tab, so this one has left the match.
            </p>
            <button className="btn" onClick={() => navigate('/')}>Back to home</button>
          </div>
        </Modal>
      </div>
    );
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
          resumeState={!isHost ? client.matchResume : undefined}
          strategies={myStrategies}
          activeStrategyIndex={myConfig?.activeStrategyIndex ?? 0}
          onSelectStrategy={(i) => updateMyConfig({ activeStrategyIndex: i })}
        />
        {spectatorBar}
      </>
    );
  }

  // ── 1v1 duel: skip the bracket preview ────────────────────────────────────
  // The host auto-fires the match (effect above); this is the brief splash both
  // players see in between rather than the tournament tree.
  if (is1v1 && phase === 'bracket-preview') {
    return <>{<DuelStarting />}{spectatorBar}</>;
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
    // 1v1 gets a from-your-POV Victory/Defeat screen with a rematch, instead of
    // the neutral tournament champion reveal.
    if (is1v1) {
      return (
        <>
          <DuelResult
            champion={champion}
            myPeerId={myPeerId}
            isHost={isHost}
            onRematch={isHost ? host.closeTournament : undefined}
            onLeave={isHost ? handleCloseRoom : () => { clearRoomSession(code); navigate('/'); }}
          />
          {spectatorBar}
        </>
      );
    }
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

  // ── Connecting loader ──────────────────────────────────────────────────────
  // A joiner arriving via a pasted /room/:code link carries no router state, so
  // the room's mode (1v1 vs tournament) is unknown until the host's first
  // lobbyState lands. Rendering the lobby now would flash the tournament layout
  // and then swap to the duel room once mode:'1v1' arrives. Show a loader instead
  // until the mode resolves (or the connection errors out).
  if (!isHost && !stateMode && !lobbyState) {
    return (
      <RoomLoading
        error={lobby.error}
        onBack={() => { clearRoomSession(code); navigate('/'); }}
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
    onStart: () => { unlockAudio(); host.startTournament(fightConfig); },
    onLeave: isHost ? handleCloseRoom : () => { clearRoomSession(code); navigate('/'); },
    onToggleReady: isHost ? undefined : (next) => { unlockAudio(); client.updateMyConfig({ ready: next }); },
  };

  // 1v1 uses the same simplified duel lobby on desktop and mobile — it's already
  // a compact face-off that reflows for narrow screens.
  const lobbyEl = is1v1
    ? <DuelLobby {...lobbyProps} />
    : isPortrait ? <MobileLobby {...lobbyProps} /> : <LobbyView {...lobbyProps} />;
  return <>{lobbyEl}{spectatorBar}</>;
}

// ── Connecting loader ───────────────────────────────────────────────────────
// Shown to a joiner while the room mode is still unknown (see the render gate).
// Doubles as the failure screen once the connection watchdog reports an error.
function RoomLoading({ error, onBack }) {
  return (
    <div className="bg-arena">
      <div className="room-loading">
        {error ? (
          <>
            <div className="room-loading-icon"><Icon name="close" size={22} /></div>
            <div className="room-loading-title">Couldn’t join the room</div>
            <div className="room-loading-sub">{error}</div>
            <button className="btn" onClick={onBack}>
              <Icon name="back" size={13} />&nbsp;BACK TO HOME
            </button>
          </>
        ) : (
          <>
            <div className="room-loading-spinner" aria-hidden="true" />
            <div className="room-loading-title">Entering the room</div>
            <div className="room-loading-sub">Connecting to the match…</div>
          </>
        )}
      </div>
    </div>
  );
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
