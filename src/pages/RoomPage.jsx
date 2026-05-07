import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useMatchHost } from '../hooks/useMatchHost.js';
import { useMatchClient } from '../hooks/useMatchClient.js';
import { CHARACTER_LIST, CHARACTERS, BASE_DAMAGE } from '../data/characters.js';
import { getCharacterTemplate, DEFAULT_PROMPT } from '../data/promptTemplates.js';
import PromptEditor from '../components/PromptEditor.jsx';
import PromptEditorSimple from '../components/PromptEditorSimple.jsx';
import Arena from '../components/Arena.jsx';
import BracketView from '../components/BracketView.jsx';
import ChampionView from '../components/ChampionView.jsx';
import CharImage from '../components/CharImage.jsx';
import CharacterPreview from '../components/CharacterPreview.jsx';

// First letter of archetype, used as a small corner badge on each tile.
const ARCHETYPE_GLYPH = { tank: 'T', striker: 'S', mage: 'M', acrobat: 'A', ranger: 'R' };

function StatStars({ label, value, tone, max = 5 }) {
  return (
    <span className={`tile-stat tile-stat-${tone}`} aria-label={`${label} ${value} of ${max}`}>
      <span className="tile-stat-label">{label}</span>
      <span className="tile-stat-pips">
        {'★'.repeat(value)}{'☆'.repeat(Math.max(0, max - value))}
      </span>
    </span>
  );
}

// ── Stats panel — per-action damage + ultimate breakdown (used in modal) ─────

function CharacterStatPanel({ char }) {
  const stats = char.stats ?? { attack: 3, defense: 3 };
  return (
    <div className="char-stat-panel">
      <div className="char-stat-panel-stars">
        <StatStars label="ATK" tone="atk" value={stats.attack} />
        <StatStars label="DEF" tone="def" value={stats.defense} />
      </div>
      <div className="char-stat-panel-section">
        <div className="char-stat-panel-heading">DAMAGE</div>
        <div className="char-stat-panel-rows">
          <div className="char-stat-panel-row"><span>HIT</span><span>{BASE_DAMAGE.hit}</span></div>
          <div className="char-stat-panel-row"><span>SHOOT</span><span>{BASE_DAMAGE.shoot}</span></div>
          <div className="char-stat-panel-row"><span>SLIDE</span><span>{BASE_DAMAGE.slide}</span></div>
        </div>
      </div>
      <div className="char-stat-panel-section">
        <div className="char-stat-panel-heading">ULTIMATES</div>
        {char.ultimates.map(u => (
          <div key={u.key} className="char-stat-panel-ult">
            <div className="char-stat-panel-ult-head">
              <span className="char-stat-panel-ult-name">{u.name}</span>
              <span className="tag-meter">{u.meterCost}m</span>
            </div>
            <div className="char-stat-panel-ult-tags">
              {u.damage > 0 && <span className="tag-dmg">{u.damage} dmg</span>}
              {u.statusApplied && <span className="tag-status">+{u.statusApplied}</span>}
              {u.heals && <span className="tag-status">heal {u.heals}</span>}
              {u.selfDamage && <span className="tag-warn">self-{u.selfDamage}</span>}
              {u.unblockable && <span className="tag-warn">unblockable</span>}
              {u.reflectsNext && <span className="tag-status">reflect</span>}
              {u.gainMeter && <span className="tag-meter">+{u.gainMeter}m back</span>}
              {u.hits > 1 && <span className="tag-mute">×{u.hits} hits</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Character info modal ─────────────────────────────────────────────────────

const FALLBACK_LORE_BY_ARCHETYPE = {
  tank:    'Slow but unkillable. Trades movement speed for raw damage absorption — every hit lands harder when it does.',
  striker: 'A close-range brawler. Fast hits, glass jaw — wins by closing the gap before the opponent gets their bearings.',
  mage:    'Aerial caster. Rains projectiles from above; weak in the clinch but devastating at range.',
  acrobat: 'Mobility specialist. Lives off jumps and slides — hard to pin down, but can\'t hold a line.',
  ranger:  'Ranged precision. Picks targets from afar. Crits scale with distance kept.',
};

function CharacterInfoModal({ char, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    // Lock body scroll while modal is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!char) return null;
  const lore = char.lore || FALLBACK_LORE_BY_ARCHETYPE[char.archetype] || char.description;

  return (
    <div className="char-modal-backdrop" onClick={onClose}>
      <div className="char-modal arena-panel" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="char-modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="char-modal-body">
          <div className="char-modal-story">
            <div className="char-modal-name">{char.name}</div>
            <div className="char-modal-archetype">{char.archetype}</div>
            <p className="char-modal-lore">{lore}</p>
            <p className="char-modal-desc">{char.description}</p>
          </div>
          <div className="char-modal-stats">
            <CharacterStatPanel char={char} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Character picker grid ─────────────────────────────────────────────────────

function CharacterPicker({ selected, onSelect }) {
  // Two interactions per tile:
  //   - hover (desktop) or selection drives the in-tile PIXI preview
  //   - chevron button opens an info modal (story + stats) — does not select
  const [hoveredId, setHoveredId] = useState(null);
  const [infoCharId, setInfoCharId] = useState(null);
  const hoverTimerRef = useRef(null);
  const animatingId = hoveredId || selected;

  function scheduleHover(e, id) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoveredId(id), 150);
  }
  function clearHover(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHoveredId(null), 80);
  }

  function openInfo(e, id) {
    e.stopPropagation();
    setInfoCharId(id);
  }

  useEffect(() => () => clearTimeout(hoverTimerRef.current), []);

  return (
    <>
      <div className="char-grid-large">
        {CHARACTER_LIST.map(char => {
          const isSelected = selected === char.id;
          const isAnimating = animatingId === char.id;
          const stats = char.stats ?? { attack: 3, defense: 3 };
          return (
            <div
              key={char.id}
              className={`char-card-large ${isSelected ? 'selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(char.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(char.id); }}
              onPointerEnter={(e) => scheduleHover(e, char.id)}
              onPointerLeave={clearHover}
              aria-label={char.name}
            >
              <span className="char-card-badge">{ARCHETYPE_GLYPH[char.archetype] ?? '?'}</span>
              <div className="char-card-img-wrap">
                <div className="char-card-preview-overlay">
                  <CharacterPreview
                    characterId={char.id}
                    width={200}
                    height={170}
                    mode={isAnimating ? 'actions' : 'idle'}
                  />
                </div>
              </div>
              <div className="char-card-strip">
                <div className="char-card-strip-text">
                  <span className="char-card-name">{char.name}</span>
                  <div className="char-card-stars">
                    <StatStars label="ATK" tone="atk" value={stats.attack} />
                    <StatStars label="DEF" tone="def" value={stats.defense} />
                  </div>
                </div>
                <button
                  type="button"
                  className="char-card-info-btn"
                  onClick={(e) => openInfo(e, char.id)}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={`More about ${char.name}`}
                >
                  ›
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {infoCharId && (
        <CharacterInfoModal char={CHARACTERS[infoCharId]} onClose={() => setInfoCharId(null)} />
      )}
    </>
  );
}

// ── Fighter roster card ───────────────────────────────────────────────────────

function FighterCard({ fighter, isMe }) {
  const char = fighter.character ? CHARACTERS[fighter.character] : null;
  return (
    <div className={`fighter-card ${fighter.isHost ? 'is-host' : ''}`}>
      <div className="fighter-avatar" style={{ overflow: 'hidden' }}>
        {char ? <CharImage char={char} size={34} /> : (
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-arena)' }}>?</span>
        )}
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-sm truncate" style={{ fontFamily: 'var(--font-arena)', letterSpacing: '0.04em', color: 'var(--neon-gold)' }}>
          {fighter.name || 'Unnamed'}
          {fighter.isHost && <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>HOST</span>}
          {isMe && <span className="ml-2 text-xs" style={{ color: '#00bfff' }}>YOU</span>}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{char ? char.name : 'No character'}</span>
      </div>
      {fighter.character && <span className="ready-badge ml-auto flex-shrink-0">Ready</span>}
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy', sm = false }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <button className={`btn-arena ${sm ? 'btn-arena-sm' : ''} btn-arena-ghost`} onClick={handleCopy}>
      {copied ? '✓ Copied!' : label}
    </button>
  );
}

// ── Lobby view ────────────────────────────────────────────────────────────────

function LobbyView({ matchCode, isHost, lobbyState, myConfig, updateMyConfig, onStartTournament, inviteLink, connected, error }) {
  const [promptMode, setPromptMode] = useState('simple');
  const [savedAdvancedPrompt, setSavedAdvancedPrompt] = useState('');
  const [mobileTab, setMobileTab] = useState('setup');
  const fighters = lobbyState?.fighters || [];

  useEffect(() => {
    if (myConfig.character && !myConfig.prompt) {
      updateMyConfig({ prompt: getCharacterTemplate(myConfig.character) || DEFAULT_PROMPT });
    }
  }, [myConfig.character]); // eslint-disable-line

  function handleCharacterSelect(charId) {
    updateMyConfig({ character: charId, prompt: getCharacterTemplate(charId) || DEFAULT_PROMPT, strategy: '' });
  }

  function handleModeSwitch(mode) {
    if (mode === 'simple' && promptMode === 'advanced') setSavedAdvancedPrompt(myConfig.prompt);
    setPromptMode(mode);
  }

  const canStart = isHost && fighters.length >= 2;

  return (
    <div className="room-page arena-bg">

      {/* ── Header ── */}
      <header className="room-header arena-panel">
        <div className="flex items-center gap-3">
          <span className="section-label">Room</span>
          <span className="match-code room-code-display">{matchCode}</span>
          <CopyButton text={matchCode} label="Copy" sm />
        </div>
        <div className="flex items-center gap-3 room-header-right">
          {isHost && inviteLink && <CopyButton text={inviteLink} label="Share Link" sm />}
          {!connected && (
            <span className="text-xs font-arena uppercase tracking-wider" style={{ color: 'var(--neon-red)' }}>
              {error || 'Connecting…'}
            </span>
          )}
        </div>
      </header>

      {/* ── Mobile tab bar ── */}
      <div className="mobile-tab-bar">
        <button className={`mobile-tab-btn ${mobileTab === 'setup' ? 'active' : ''}`} onClick={() => setMobileTab('setup')}>
          Setup
        </button>
        <button className={`mobile-tab-btn ${mobileTab === 'room' ? 'active' : ''}`} onClick={() => setMobileTab('room')}>
          Room {fighters.length > 0 && `(${fighters.length})`}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="room-body">

        {/* Setup column */}
        <main className={`room-setup ${mobileTab === 'room' ? 'mobile-hidden' : ''}`}>

          <section className="room-section">
            <label className="section-label">Your Fighter Name</label>
            <input
              className="arena-input mt-2"
              style={{ fontFamily: 'var(--font-arena)', letterSpacing: '0.08em', fontSize: '1.05rem' }}
              placeholder="Enter your name"
              value={myConfig.name}
              onChange={e => updateMyConfig({ name: e.target.value })}
              maxLength={24}
            />
          </section>

          <section className="room-section">
            <label className="section-label">Choose Character</label>
            <div className="mt-2">
              <CharacterPicker selected={myConfig.character} onSelect={handleCharacterSelect} />
            </div>
          </section>

          <div className="arena-divider" />

          <section className="room-section">
            <div className="flex items-center justify-between gap-3 mb-3">
              <label className="section-label">Strategy</label>
              <div className="mode-toggle">
                <button className={`mode-toggle-btn ${promptMode === 'simple' ? 'active' : ''}`} onClick={() => handleModeSwitch('simple')}>Simple</button>
                <button className={`mode-toggle-btn ${promptMode === 'advanced' ? 'active' : ''}`} onClick={() => handleModeSwitch('advanced')}>Advanced</button>
              </div>
            </div>

            {promptMode === 'simple' ? (
              <PromptEditorSimple character={myConfig.character} strategy={myConfig.strategy}
                onChange={(strategy, fullPrompt) => updateMyConfig({ strategy, prompt: fullPrompt })} />
            ) : (
              <PromptEditor prompt={myConfig.prompt || savedAdvancedPrompt || ''} character={myConfig.character}
                provider={myConfig.provider} apiKey={myConfig.apiKey} model={myConfig.model}
                onChange={(field, value) => updateMyConfig({ [field]: value })} n={3} />
            )}

            {promptMode === 'simple' && (
              <>
                <div className="arena-divider mt-4" />
                <div className="flex flex-col gap-3 mt-3">
                  <div className="flex flex-col gap-1">
                    <label className="section-label">AI Provider</label>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {[['groq','Groq'], ['openai','OpenAI'], ['anthropic','Anthropic']].map(([key, label]) => (
                        <button key={key} onClick={() => updateMyConfig({ provider: key })}
                          className={`provider-tab ${myConfig.provider === key ? 'active' : ''}`}>
                          {label}{key === 'groq' && <span className="ml-1 text-xs opacity-60">(free)</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="section-label">API Key</label>
                    <input type="password" className="arena-input mt-1"
                      placeholder="Leave blank for random moves (testing)"
                      value={myConfig.apiKey}
                      onChange={e => updateMyConfig({ apiKey: e.target.value })}
                      autoComplete="off" />
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      No key? Random moves will be used. Your key never leaves your browser.
                    </p>
                  </div>
                </div>
              </>
            )}
          </section>
        </main>

        {/* Sidebar */}
        <aside className={`room-sidebar arena-panel ${mobileTab === 'setup' ? 'mobile-hidden' : ''}`}>
          <div className="section-label mb-3">Fighters ({fighters.length})</div>
          <div className="flex flex-col gap-2">
            {fighters.map(f => (
              <FighterCard key={f.peerId} fighter={f} isMe={isHost ? f.isHost : false} />
            ))}
            {fighters.length === 0 && (
              <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>Waiting for fighters to join…</p>
            )}
          </div>

          <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--arena-panel-border)' }}>
            {isHost ? (
              <>
                {!canStart && (
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Need at least 2 fighters to start.</p>
                )}
                <button className="btn-arena" style={{ width: '100%', display: 'block' }}
                  onClick={onStartTournament} disabled={!canStart}>
                  Start Tournament
                </button>
              </>
            ) : (
              <p className="text-xs text-center font-arena uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                Waiting for host to start…
              </p>
            )}
          </div>
        </aside>
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

  const host   = useMatchHost(isHost ? code : null);
  const client = useMatchClient(!isHost ? code : null);

  const lobby          = isHost ? host : client;
  const myConfig       = lobby.myConfig;
  const updateMyConfig = lobby.updateMyConfig;
  const lobbyState     = lobby.lobbyState;
  const phase          = lobbyState?.phase || 'lobby';
  const bracket        = lobbyState?.bracket;
  const nextMatchStartsAt = lobbyState?.nextMatchStartsAt;
  const champion       = lobbyState?.champion ?? null;

  // Joiner: navigate home when host closes the room
  useEffect(() => {
    if (!isHost && client.roomClosed) navigate('/');
  }, [client.roomClosed]); // eslint-disable-line

  function handleFightEnd(result) {
    if (!isHost) return; // joiner just waits for phase broadcast
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
    const myPeerId = isHost ? host.lobbyState?.fighters?.find(f => f.isHost)?.peerId : null;

    const inject = (f) => {
      if (!f) return f;
      if (isHost && f.peerId === myPeerId) {
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
  return (
    <LobbyView
      matchCode={code}
      isHost={isHost}
      lobbyState={lobbyState}
      myConfig={myConfig}
      updateMyConfig={updateMyConfig}
      onStartTournament={() => host.startTournament(fightConfig)}
      inviteLink={isHost ? host.inviteLink : ''}
      connected={lobby.connected}
      error={lobby.error}
    />
  );
}
