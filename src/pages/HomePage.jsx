import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../components/design/Icons.jsx';
import { Modal } from '../components/design/DesignKit.jsx';
import NeedSetupPrompt from '../components/design/NeedSetupPrompt.jsx';
import HomeArena from '../components/design/HomeArena.jsx';
import HowToPlay from '../components/HowToPlay.jsx';
import MobileHome from '../components/mobile/MobileHome.jsx';
import { useIsPortrait } from '../hooks/useIsPortrait.js';
import { PUBLIC_TOURNAMENTS, loadProfile, isProfileReady } from '../data/designData.js';
import { generateMatchCode } from '../engine/peerEngine.js';
import { unlockAudio } from '../engine/soundEngine.js';

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isPortrait = useIsPortrait();
  const [profile, setProfile] = useState(() => loadProfile());
  // Returning from /setup with ?intent=1v1|tournament means the player came to
  // start a duel / tournament but had to set up a fighter first — reopen that
  // action now that they're ready. Derived at mount; the effect below strips the
  // param so a refresh or back-nav doesn't reopen it.
  const initialIntent = new URLSearchParams(location.search).get('intent');
  const [show1v1, setShow1v1] = useState(() => initialIntent === '1v1' && isProfileReady(loadProfile()));
  const [showTournament, setShowTournament] = useState(() => initialIntent === 'tournament' && isProfileReady(loadProfile()));
  const [showNeedSetup, setShowNeedSetup] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  // First-ever play attempt shows the How-to-Play tour instead of the usual
  // flow. Once seen (via any play button or the top-bar button) it's never
  // auto-shown again. Persisted so it only happens once per browser.
  const [seenHowTo, setSeenHowTo] = useState(() => {
    try { return localStorage.getItem('pk.seenHowTo') === '1'; } catch { return false; }
  });
  // Where to send the player after they finish setup, captured when an action
  // is gated (e.g. '/bot', or '/?intent=1v1' to reopen the duel modal).
  const [needSetupReturn, setNeedSetupReturn] = useState('/');

  // Re-read profile when returning from /setup (storage event for cross-tab,
  // focus event for same-tab navigation).
  useEffect(() => {
    const refresh = () => setProfile(loadProfile());
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  // Drop the ?intent param once consumed so a refresh / back-nav doesn't
  // reopen the modal. The modal open-state was already derived at mount above.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('intent')) {
      navigate('/', { replace: true });
    }
  }, [location.search, navigate]);

  useEffect(() => {
    document.body.classList.add('pk-design');
    return () => document.body.classList.remove('pk-design');
  }, []);

  const ready = isProfileReady(profile);

  function gate(action, returnTo = '/') {
    if (!ready) {
      setNeedSetupReturn(returnTo);
      setShowNeedSetup(true);
    } else {
      action();
    }
  }

  function doHost(tournamentName) {
    const code = generateMatchCode();
    navigate(`/room/${code}`, { state: { isHost: true, tournamentName } });
  }

  function doJoin(code) {
    navigate(`/room/${code}`, { state: { isHost: false } });
  }

  // 1v1 duel — a lightweight 2-player room (mode: '1v1'). Creating one drops
  // the host straight into the duel lobby with a code to share; joining goes to
  // the same room as the opponent.
  function do1v1Create() {
    unlockAudio();
    const code = generateMatchCode();
    navigate(`/room/${code}`, { state: { isHost: true, mode: '1v1', tournamentName: '1v1 Duel' } });
  }

  function do1v1Join(code) {
    unlockAudio();
    navigate(`/room/${code}`, { state: { isHost: false, mode: '1v1' } });
  }

  // Opening the tour is a user gesture — unlock audio here so the theme can
  // start when HowToPlay mounts (and stops when it closes).
  function markHowToSeen() {
    try { localStorage.setItem('pk.seenHowTo', '1'); } catch { /* ignore */ }
    setSeenHowTo(true);
  }

  // Any viewing counts as "seen" — whether opened from the How to Play button or
  // auto-shown on a first play attempt — so it's never auto-shown again.
  function openHowTo() {
    unlockAudio();
    markHowToSeen();
    setShowHowTo(true);
  }

  // A play click: auto-show the tour only if it's NEVER been seen; otherwise go
  // straight to the normal gate (setup prompt or the action).
  function playIntent(action, returnTo) {
    if (!seenHowTo) {
      openHowTo();
      return;
    }
    gate(action, returnTo);
  }

  // Rendered in both the portrait and desktop layouts. Mounts the tour only
  // while open (it spins up a PIXI stage), and offers next-step CTAs at the end.
  const howToEl = showHowTo && (
    <HowToPlay
      onClose={() => setShowHowTo(false)}
      onSetup={() => { setShowHowTo(false); navigate('/setup?guide=1'); }}
    />
  );

  // The three action modals live in one place and render in both layouts.
  const modalsEl = (
    <>
      <Modal open={show1v1} onClose={() => setShow1v1(false)} width={520}>
        <Play1v1Modal
          onCreate={() => { setShow1v1(false); do1v1Create(); }}
          onJoin={(code) => { setShow1v1(false); do1v1Join(code); }}
        />
      </Modal>
      <Modal open={showTournament} onClose={() => setShowTournament(false)} width={680}>
        <TournamentModal
          onHost={(name) => { setShowTournament(false); doHost(name); }}
          onJoin={(code) => { setShowTournament(false); doJoin(code); }}
        />
      </Modal>
      <Modal open={showNeedSetup} onClose={() => setShowNeedSetup(false)}>
        <NeedSetupPrompt
          onClose={() => setShowNeedSetup(false)}
          onChoose={() => { setShowNeedSetup(false); navigate(`/setup?returnTo=${encodeURIComponent(needSetupReturn)}`); }}
        />
      </Modal>
    </>
  );

  const onQuick      = () => playIntent(() => navigate('/bot'), '/bot');
  const on1v1        = () => playIntent(() => setShow1v1(true), '/?intent=1v1');
  const onTournament = () => playIntent(() => setShowTournament(true), '/?intent=tournament');

  if (isPortrait) {
    return (
      <>
        <MobileHome
          profile={profile}
          onQuick={onQuick}
          on1v1={on1v1}
          onTournament={onTournament}
          onSettings={() => navigate('/setup')}
          onHowTo={openHowTo}
          showArena={!showHowTo}
        />
        {modalsEl}
        {howToEl}
      </>
    );
  }

  return (
    <div className="bg-arena">
      <div className="spotlight-left" />
      <div className="spotlight-right" />

      <div className="topbar">
        <div className="topbar-brand" onClick={() => navigate('/')}>
          <span className="dot" />
          <span>PROMPT <span className="kk">K</span>OMBAT</span>
        </div>
        <div className="topbar-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={openHowTo}>
          <Icon name="play" size={13} />&nbsp;HOW TO PLAY
        </button>
        <button className="icon-btn" onClick={() => navigate('/setup')} aria-label="Settings">
          <Icon name="gear" />
        </button>
        <div className="topbar-user" onClick={() => navigate('/setup')}>
          <div className="avatar">{(profile.handle || '?')[0]}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="name">{profile.handle}</div>
            <div className="lvl">{profile.wins}W</div>
          </div>
        </div>
      </div>

      <div className="home-hero">
        <div style={{ textAlign: 'center' }}>
          <h1 className="wordmark">PROMPT&nbsp;<span className="kk">K</span>OMBAT</h1>
          <p className="wordmark-sub">The AI wrestling arena. Write the strategy. Watch the bots fight.</p>
        </div>

        {/* Only one heavy PIXI stage at a time — pause the home fight while the
            tour is open so its WebGL context can't get dropped (which left the
            home animation blank on return). Remounts fresh when the tour closes. */}
        {!showHowTo && <HomeArena />}

        <div className="action-row">
          <Action
            tone="gold" title="Quick Match"
            icon={<Icon name="bot" size={26} />}
            desc="Solo skirmish against a random AI fighter."
            cta="Quick fight"
            onClick={onQuick}
          />
          <Action
            tone="red" title="Play 1 vs 1"
            icon={<Icon name="swords" size={26} />}
            desc="Duel a friend head-to-head."
            cta="Start a duel"
            onClick={on1v1}
          />
          <Action
            tone="ink" title="Tournament"
            icon={<Icon name="trophy" size={26} />}
            desc="Host a 2–16 player bracket or join one already running."
            cta="Host or join"
            onClick={onTournament}
          />
        </div>
      </div>

      {modalsEl}
      {howToEl}

    </div>
  );
}

function Action({ tone, title, icon, desc, cta, onClick }) {
  return (
    <div className={`action ${tone}`} onClick={onClick} role="button" tabIndex={0}
         onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}>
      <div className="action-head">
        <div className="action-title">{title}</div>
        <div className="action-icon">{icon}</div>
      </div>
      <div className="action-desc">{desc}</div>
      <div className="action-cta">
        <span>{cta}</span>
        <Icon name="arrow" size={14} />
      </div>
    </div>
  );
}

// ── Play 1v1 ────────────────────────────────────────────────────────────────
// Two clear, equal paths behind a Create / Join toggle. Create hosts a room and
// hands back a code to share; Join enters a friend's code. Kept deliberately
// minimal — a duel is meant to be the fastest way to fight another person.

function Play1v1Modal({ onCreate, onJoin }) {
  const [side, setSide] = useState('create');
  const [code, setCode] = useState('');
  const canJoin = code.length >= 3;
  return (
    <>
      <h2 style={{ color: 'var(--red)' }}>Play 1v1</h2>
      <p>Duel a friend head-to-head — one match, winner takes all.</p>

      <div className="tabs">
        <button className={`tab ${side === 'create' ? 'active' : ''}`} onClick={() => setSide('create')}>Create</button>
        <button className={`tab ${side === 'join' ? 'active' : ''}`} onClick={() => setSide('join')}>Join</button>
      </div>

      {side === 'create' ? (
        <div className="duel-panel">
          <div className="duel-hero"><Icon name="swords" size={30} /></div>
          <div className="duel-panel-title">Create a duel</div>
          <p className="duel-panel-desc">
            You'll get a 6-character code. Share it with a friend — the fight
            starts the moment they join.
          </p>
          <button className="btn btn-red duel-cta" onClick={onCreate}>
            CREATE DUEL&nbsp;<Icon name="arrow" size={15} />
          </button>
        </div>
      ) : (
        <div className="duel-panel">
          <div className="duel-hero"><Icon name="enter" size={30} /></div>
          <div className="duel-panel-title">Join a duel</div>
          <p className="duel-panel-desc">Enter the code your friend shared with you.</p>
          <input
            className="code-input"
            placeholder="A 4 K 9 P 2"
            value={code}
            autoFocus
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            onKeyDown={e => { if (e.key === 'Enter' && canJoin) onJoin(code); }}
            maxLength={8}
          />
          <button
            className="btn btn-red duel-cta"
            onClick={() => canJoin && onJoin(code)}
            disabled={!canJoin}
            style={!canJoin ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
          >JOIN DUEL&nbsp;<Icon name="arrow" size={15} /></button>
        </div>
      )}
    </>
  );
}

// ── Tournament (host + join combined) ────────────────────────────────────────

function TournamentModal({ onHost, onJoin }) {
  const [side, setSide] = useState('join');
  return (
    <>
      <h2>Tournament</h2>
      <p>Host a bracket for 2–16 fighters, or join one that's already running.</p>
      <div className="tabs">
        <button className={`tab ${side === 'join' ? 'active' : ''}`} onClick={() => setSide('join')}>Join</button>
        <button className={`tab ${side === 'host' ? 'active' : ''}`} onClick={() => setSide('host')}>Host</button>
      </div>
      {side === 'join' ? <JoinPanel onJoin={onJoin} /> : <HostPanel onHost={onHost} />}
    </>
  );
}

function JoinPanel({ onJoin }) {
  const [tab, setTab] = useState('private');
  return (
    <div>
      <div className="tabs" style={{ marginTop: 0 }}>
        <button className={`tab ${tab === 'private' ? 'active' : ''}`} onClick={() => setTab('private')}>Private</button>
        <button className={`tab ${tab === 'public' ? 'active' : ''}`} onClick={() => setTab('public')}>Public</button>
      </div>
      {tab === 'private' ? <JoinPrivateTab onJoin={onJoin} /> : <JoinPublicTab onJoin={onJoin} />}
    </div>
  );
}

function JoinPrivateTab({ onJoin }) {
  const [code, setCode] = useState('');
  const disabled = code.length < 3;
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 10 }}>
        Six-character room code from the host.
      </div>
      <input
        className="code-input"
        placeholder="A 4 K 9 P 2"
        value={code}
        autoFocus
        onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
        onKeyDown={e => { if (e.key === 'Enter' && !disabled) onJoin(code); }}
        maxLength={8}
      />
      <button
        className="btn btn-solid"
        onClick={() => onJoin(code)}
        disabled={disabled}
        style={{ marginTop: 14, width: '100%' }}
      >ENTER THE RING</button>
    </div>
  );
}

function JoinPublicTab({ onJoin }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto', paddingRight: 4 }}>
      {PUBLIC_TOURNAMENTS.map(t => (
        <div key={t.id} style={{
          display: 'grid', gridTemplateColumns: '12px 1fr auto auto', gap: 12, alignItems: 'center',
          padding: '12px 14px', border: '1px solid var(--line)', background: 'rgba(13,9,23,0.6)',
          cursor: 'pointer', transition: 'border-color 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
          onClick={() => onJoin(t.id.toUpperCase())}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: t.live ? 'var(--red)' : 'var(--ink-dim)',
            boxShadow: t.live ? '0 0 6px var(--red)' : 'none',
          }} />
          <div>
            <div className="f-display" style={{ fontSize: 17, color: 'var(--ink)', letterSpacing: '0.04em' }}>{t.name}</div>
            <div className="f-mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{t.mode}</div>
          </div>
          <span className="f-mono" style={{ fontSize: 13, color: 'var(--ink)', letterSpacing: '0.06em' }}>
            {t.players}/{t.max}
          </span>
          <span className="tag gold">JOIN&nbsp;<Icon name="arrow" size={10} /></span>
        </div>
      ))}
    </div>
  );
}

function HostPanel({ onHost }) {
  const [size, setSize] = useState(8);
  const [visibility, setVisibility] = useState('private');
  const [tournamentName, setTournamentName] = useState('Friday Night Smackdown');
  const clamp = n => Math.max(2, Math.min(16, Math.round(n || 0)));
  const trimmedName = tournamentName.trim();
  const canHost = trimmedName.length > 0;
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Field label="Tournament Name">
          <input
            type="text"
            className="input"
            value={tournamentName}
            onChange={e => setTournamentName(e.target.value.slice(0, 40))}
            placeholder="Friday Night Smackdown"
            maxLength={40}
            style={{
              fontFamily: 'var(--f-display)', fontSize: 18,
              letterSpacing: '0.04em', color: 'var(--gold)',
            }}
          />
        </Field>
        <Field label="Max Players (2 – 16)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <input
              type="range" min={2} max={16} step={1}
              value={size}
              onChange={e => setSize(parseInt(e.target.value, 10))}
              style={{ flex: 1, accentColor: 'var(--gold)' }}
            />
            <input
              type="number" min={2} max={16}
              value={size}
              onChange={e => setSize(clamp(parseInt(e.target.value, 10)))}
              className="input"
              style={{
                width: 72, textAlign: 'center',
                fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.04em',
                color: 'var(--gold)',
              }}
            />
          </div>
        </Field>

        <Field label="Visibility">
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`mode-tab ${visibility === 'private' ? 'active' : ''}`}
              style={{ borderLeft: '1px solid var(--line)', flex: 1 }}
              onClick={() => setVisibility('private')}>PRIVATE</button>
            <button
              className={`mode-tab ${visibility === 'public' ? 'active' : ''}`}
              style={{ borderLeft: '1px solid var(--line)', flex: 1 }}
              onClick={() => setVisibility('public')}>PUBLIC</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 6, lineHeight: 1.5 }}>
            {visibility === 'private'
              ? 'Only players with the room code can join.'
              : 'Listed on the public tournament board. Anyone can join.'}
          </div>
        </Field>
      </div>

      <button
        className="btn btn-red"
        onClick={() => canHost && onHost(trimmedName)}
        disabled={!canHost}
        style={{ width: '100%', marginTop: 22, opacity: canHost ? 1 : 0.45, cursor: canHost ? 'pointer' : 'not-allowed' }}
      >OPEN LOBBY</button>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}
