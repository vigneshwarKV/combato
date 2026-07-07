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
  // Returning from /setup with ?intent=host|join means the player came to
  // host/join but had to set up a fighter first — reopen that action now that
  // they're ready. Derived at mount; the effect below strips the param so a
  // refresh or back-nav doesn't reopen it.
  const initialIntent = new URLSearchParams(location.search).get('intent');
  const [showJoin, setShowJoin] = useState(() => initialIntent === 'join' && isProfileReady(loadProfile()));
  const [showHost, setShowHost] = useState(() => initialIntent === 'host' && isProfileReady(loadProfile()));
  const [showNeedSetup, setShowNeedSetup] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  // First-ever play attempt shows the How-to-Play tour instead of the usual
  // flow. Persisted so it only happens once per browser.
  const [seenHowTo, setSeenHowTo] = useState(() => {
    try { return localStorage.getItem('pk.seenHowTo') === '1'; } catch { return false; }
  });
  // Where to send the player after they finish setup, captured when an action
  // is gated (e.g. '/bot', or '/?intent=host' to reopen the host modal).
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

  // Opening the tour is a user gesture — unlock audio here so the theme can
  // start when HowToPlay mounts (and stops when it closes).
  function openHowTo() {
    unlockAudio();
    setShowHowTo(true);
  }

  // A play/host/join click: first time ever, play the tour instead; afterwards
  // fall through to the normal gate (setup prompt or the action itself).
  function playIntent(action, returnTo) {
    if (!seenHowTo) {
      try { localStorage.setItem('pk.seenHowTo', '1'); } catch { /* ignore */ }
      setSeenHowTo(true);
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
      onSetup={() => { setShowHowTo(false); navigate('/setup'); }}
      onPlay={() => { setShowHowTo(false); playIntent(() => navigate('/bot'), '/bot'); }}
    />
  );

  if (isPortrait) {
    return (
      <>
        <MobileHome
          profile={profile}
          onQuick={() => playIntent(() => navigate('/bot'), '/bot')}
          onHost={() => playIntent(() => setShowHost(true), '/?intent=host')}
          onJoin={() => playIntent(() => setShowJoin(true), '/?intent=join')}
          onSettings={() => navigate('/setup')}
          onHowTo={openHowTo}
          showArena={!showHowTo}
        />
        <Modal open={showJoin} onClose={() => setShowJoin(false)} width={680}>
          <JoinTournamentModal
            onClose={() => setShowJoin(false)}
            onJoin={(code) => { setShowJoin(false); doJoin(code); }}
          />
        </Modal>
        <Modal open={showHost} onClose={() => setShowHost(false)}>
          <HostTournamentForm
            onClose={() => setShowHost(false)}
            onHost={(name) => { setShowHost(false); doHost(name); }}
          />
        </Modal>
        <Modal open={showNeedSetup} onClose={() => setShowNeedSetup(false)}>
          <NeedSetupPrompt
            onClose={() => setShowNeedSetup(false)}
            onChoose={() => { setShowNeedSetup(false); navigate(`/setup?returnTo=${encodeURIComponent(needSetupReturn)}`); }}
          />
        </Modal>
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
            tone="gold" title="Play vs Bot"
            icon={<Icon name="bot" size={26} />}
            desc="Solo skirmish vs a random AI fighter."
            cta="Quick fight"
            onClick={() => playIntent(() => navigate('/bot'), '/bot')}
          />
          <Action
            tone="red" title="Host Tournament"
            icon={<Icon name="trophy" size={26} />}
            desc="Open a 4 / 8 / 16 player bracket. You set the rules."
            cta="Open lobby"
            onClick={() => playIntent(() => setShowHost(true), '/?intent=host')}
          />
          <Action
            tone="ink" title="Join Tournament"
            icon={<Icon name="enter" size={26} />}
            desc="Enter a private room code or drop into a public bracket."
            cta="Find a match"
            onClick={() => playIntent(() => setShowJoin(true), '/?intent=join')}
          />
        </div>
      </div>

      <Modal open={showJoin} onClose={() => setShowJoin(false)} width={680}>
        <JoinTournamentModal
          onClose={() => setShowJoin(false)}
          onJoin={(code) => { setShowJoin(false); doJoin(code); }}
        />
      </Modal>

      <Modal open={showHost} onClose={() => setShowHost(false)}>
        <HostTournamentForm
          onClose={() => setShowHost(false)}
          onHost={() => { setShowHost(false); doHost(); }}
        />
      </Modal>

      <Modal open={showNeedSetup} onClose={() => setShowNeedSetup(false)}>
        <NeedSetupPrompt
          onClose={() => setShowNeedSetup(false)}
          onChoose={() => { setShowNeedSetup(false); navigate(`/setup?returnTo=${encodeURIComponent(needSetupReturn)}`); }}
        />
      </Modal>

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

function JoinTournamentModal({ onClose, onJoin }) {
  const [tab, setTab] = useState('private');
  return (
    <>
      <h2>Join a Tournament</h2>
      <p>Drop into a friend's bracket or a public lobby running right now.</p>
      <div className="tabs">
        <button className={`tab ${tab === 'private' ? 'active' : ''}`} onClick={() => setTab('private')}>Private</button>
        <button className={`tab ${tab === 'public' ? 'active' : ''}`} onClick={() => setTab('public')}>Public</button>
      </div>
      {tab === 'private' ? <JoinPrivateTab onJoin={onJoin} /> : <JoinPublicTab onJoin={onJoin} />}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>CLOSE</button>
      </div>
    </>
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

function HostTournamentForm({ onClose, onHost }) {
  const [size, setSize] = useState(8);
  const [visibility, setVisibility] = useState('private');
  const [tournamentName, setTournamentName] = useState('Friday Night Smackdown');
  const clamp = n => Math.max(2, Math.min(16, Math.round(n || 0)));
  const trimmedName = tournamentName.trim();
  const canHost = trimmedName.length > 0;
  return (
    <>
      <h2 style={{ color: 'var(--red)' }}>Open The Cage</h2>
      <p>Configure your bracket. You'll get a 6-character code to share with players.</p>

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

      <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>CANCEL</button>
        <button
          className="btn btn-red"
          onClick={() => canHost && onHost(trimmedName)}
          disabled={!canHost}
          style={{ flex: 1, opacity: canHost ? 1 : 0.45, cursor: canHost ? 'pointer' : 'not-allowed' }}
        >OPEN LOBBY</button>
      </div>
    </>
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

