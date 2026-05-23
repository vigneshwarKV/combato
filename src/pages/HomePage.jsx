import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/design/Icons.jsx';
import { Modal } from '../components/design/DesignKit.jsx';
import HomeArena from '../components/design/HomeArena.jsx';
import MobileHome from '../components/mobile/MobileHome.jsx';
import { useIsPortrait } from '../hooks/useIsPortrait.js';
import { PUBLIC_TOURNAMENTS, loadProfile, isProfileReady } from '../data/designData.js';
import { generateMatchCode } from '../engine/peerEngine.js';

export default function HomePage() {
  const navigate = useNavigate();
  const isPortrait = useIsPortrait();
  const [profile, setProfile] = useState(() => loadProfile());
  const [showJoin, setShowJoin] = useState(false);
  const [showHost, setShowHost] = useState(false);
  const [showNeedSetup, setShowNeedSetup] = useState(false);

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

  useEffect(() => {
    document.body.classList.add('pk-design');
    return () => document.body.classList.remove('pk-design');
  }, []);

  const ready = isProfileReady(profile);

  function gate(action) {
    if (!ready) {
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

  if (isPortrait) {
    return (
      <>
        <MobileHome
          profile={profile}
          onQuick={() => gate(() => navigate('/bot'))}
          onHost={() => gate(() => setShowHost(true))}
          onJoin={() => gate(() => setShowJoin(true))}
          onSettings={() => navigate('/setup')}
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
            onChoose={() => { setShowNeedSetup(false); navigate('/setup'); }}
          />
        </Modal>
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
        <button className="icon-btn" onClick={() => navigate('/setup')} aria-label="Settings">
          <Icon name="gear" />
        </button>
        <div className="topbar-user" onClick={() => navigate('/setup')}>
          <div className="avatar">{(profile.handle || '?')[0]}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="name">{profile.handle}</div>
            <div className="lvl">Rank {profile.rank} · {profile.wins}W</div>
          </div>
        </div>
      </div>

      <div className="home-hero">
        <div style={{ textAlign: 'center' }}>
          <h1 className="wordmark">PROMPT&nbsp;<span className="kk">K</span>OMBAT</h1>
          <p className="wordmark-sub">The AI wrestling arena. Write the strategy. Watch the bots fight.</p>
        </div>

        <HomeArena />

        <div className="action-row">
          <Action
            tone="gold" title="Play vs Bot"
            icon={<Icon name="bot" size={26} />}
            desc="Solo skirmish vs a random AI fighter."
            cta="Quick fight"
            onClick={() => gate(() => navigate('/bot'))}
          />
          <Action
            tone="red" title="Host Tournament"
            icon={<Icon name="trophy" size={26} />}
            desc="Open a 4 / 8 / 16 player bracket. You set the rules."
            cta="Open lobby"
            onClick={() => gate(() => setShowHost(true))}
          />
          <Action
            tone="ink" title="Join Tournament"
            icon={<Icon name="enter" size={26} />}
            desc="Enter a private room code or drop into a public bracket."
            cta="Find a match"
            onClick={() => gate(() => setShowJoin(true))}
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
          onChoose={() => { setShowNeedSetup(false); navigate('/setup'); }}
        />
      </Modal>

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
        className="btn"
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
            <div className="f-mono" style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{t.mode} · Rank {t.rank}</div>
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

function NeedSetupPrompt({ onClose, onChoose }) {
  return (
    <>
      <h2>Set up your fighter first</h2>
      <p>You need to pick a character and write a strategy before stepping into the ring.</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>NOT NOW</button>
        <button className="btn" onClick={onChoose} style={{ flex: 1 }}>
          <Icon name="sparkle" size={14} />&nbsp;OPEN SETTINGS
        </button>
      </div>
    </>
  );
}
