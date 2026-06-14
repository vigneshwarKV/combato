import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHARACTER_LIST } from '../data/characters.js';
import { getCharacterTemplate, DEFAULT_SIMPLE_STRATEGY } from '../data/promptTemplates.js';
import PromptEditorSimple from '../components/PromptEditorSimple.jsx';
import PromptEditorAdvanced from '../components/PromptEditorAdvanced.jsx';
import CharacterPreview from '../components/CharacterPreview.jsx';
import Arena from '../components/Arena.jsx';
import { loadProfile, isProfileReady, UNLOCKED_IDS } from '../data/designData.js';
import { unlockAudio } from '../engine/soundEngine.js';

const ARCHETYPE_GLYPH = { tank: 'T', striker: 'S', mage: 'M', acrobat: 'A', ranger: 'R' };

const BOT_NAMES = [
  'THE MACHINE', 'IRON KOMBATANT', 'CIRCUIT BREAKER',
  'NULL POINTER', 'BYTE CRUSHER', 'STACK OVERFLOW',
];

// After a bot match ends, how long the winner's celebration plays before we
// auto-return to the home screen.
const POST_FIGHT_CELEBRATION_MS = 5000;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// The bot opponent never uses the AI proxy — `randomOnly` makes the engine
// play random moves for it every turn, regardless of any API key. Only the
// player's character calls the managed LLM.
// Bot only fields unlocked (playable) characters — never a locked one.
const UNLOCKED_CHARACTERS = CHARACTER_LIST.filter(c => UNLOCKED_IDS.has(c.id));

function buildBotFighter() {
  const char = pickRandom(UNLOCKED_CHARACTERS);
  return {
    id: 'bot',
    name: pickRandom(BOT_NAMES),
    character: char.id,
    randomOnly: true,
  };
}

function buildFighterFromProfile(profile) {
  if (!isProfileReady(profile)) return null;
  const promptMode = profile.strategyMode === 'advanced' ? 'advanced' : 'simple';
  const prompt = promptMode === 'advanced'
    ? profile.strategyAdvanced
    : profile.strategySimple;
  return {
    id: `player-${Date.now()}`,
    name: profile.handle || 'YOU',
    character: profile.charId,
    promptMode,
    prompt,
  };
}

// ── Stat stars ────────────────────────────────────────────────────────────────

function StatStars({ label, value, tone, max = 5 }) {
  return (
    <span className={`tile-stat tile-stat-${tone}`}>
      <span className="tile-stat-label">{label}</span>
      <span className="tile-stat-pips">{'★'.repeat(value)}{'☆'.repeat(Math.max(0, max - value))}</span>
    </span>
  );
}

// ── Character grid ────────────────────────────────────────────────────────────

function CharGrid({ selected, onSelect }) {
  const [hoveredId, setHoveredId] = useState(null);
  const timerRef = useRef(null);
  const animatingId = hoveredId || selected;

  function scheduleHover(e, id) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setHoveredId(id), 150);
  }
  function clearHover(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setHoveredId(null), 80);
  }

  return (
    <div className="char-grid-large">
      {CHARACTER_LIST.map(char => {
        const isSelected = selected === char.id;
        const stats = char.stats ?? { attack: 3, defense: 3 };
        return (
          <div
            key={char.id}
            className={`char-card-large ${isSelected ? 'selected' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(char.id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(char.id); }}
            onPointerEnter={e => scheduleHover(e, char.id)}
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
                  mode={animatingId === char.id ? 'actions' : 'idle'}
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Setup Screen ─────────────────────────────────────────────────────────────

function SetupScreen({ onFight }) {
  const [name, setName] = useState('');
  const [character, setCharacter] = useState('');
  const [mode, setMode] = useState('simple'); // 'simple' | 'advanced'
  const [strategy, setStrategy] = useState('');
  const [prompt, setPrompt] = useState('');
  const [nameError, setNameError] = useState('');
  const [charError, setCharError] = useState('');

  function handleCharacterSelect(charId) {
    setCharacter(charId);
    setCharError('');
    // Seed the advanced editor with the default template once a character exists.
    if (!prompt) setPrompt(getCharacterTemplate(charId));
  }

  function handleFight() {
    let ok = true;
    if (!name.trim()) { setNameError('Enter your fighter name'); ok = false; }
    if (!character) { setCharError('Pick a character'); ok = false; }
    if (!ok) return;

    // This click is a user gesture — unlock audio now so the fight that mounts
    // right after has a live AudioContext (and the theme starts).
    unlockAudio();

    onFight({
      id: `player-${Date.now()}`,
      name: name.trim(),
      character,
      promptMode: mode,
      prompt: mode === 'advanced'
        ? (prompt || getCharacterTemplate(character))
        : (strategy.trim() || DEFAULT_SIMPLE_STRATEGY),
    });
  }

  return (
    <div className="min-h-screen arena-bg flex flex-col items-center overflow-y-auto px-4 py-8">
      <div className="crowd-strip" />

      <div className="relative z-10 w-full max-w-2xl flex flex-col gap-6">

        {/* Header */}
        <div className="text-center">
          <div className="logo-text" style={{ fontSize: '2.2rem' }}>Fight the Machine</div>
          <div className="logo-sub mt-1">Choose your fighter · Write your strategy · Battle the bot</div>
        </div>

        <div className="w-full h-px" style={{ background: 'linear-gradient(90deg, transparent, #c8a20066, #c8a200, #c8a20066, transparent)' }} />

        {/* Fighter name */}
        <section className="arena-panel" style={{ padding: '1rem', borderRadius: 6 }}>
          <label className="section-label">Your Fighter Name</label>
          <input
            className="arena-input mt-2"
            style={{ fontFamily: 'var(--font-arena)', letterSpacing: '0.08em', fontSize: '1.05rem' }}
            placeholder="Enter your name"
            value={name}
            onChange={e => { setName(e.target.value); setNameError(''); }}
            maxLength={24}
          />
          {nameError && <p className="text-xs mt-1" style={{ color: 'var(--neon-red)' }}>{nameError}</p>}
        </section>

        {/* Character picker */}
        <section className="arena-panel" style={{ padding: '1rem', borderRadius: 6 }}>
          <label className="section-label">Choose Your Character</label>
          {charError && <p className="text-xs mt-1 mb-2" style={{ color: 'var(--neon-red)' }}>{charError}</p>}
          <div className="mt-2">
            <CharGrid selected={character} onSelect={handleCharacterSelect} />
          </div>
        </section>

        {/* Strategy */}
        <section className="arena-panel" style={{ padding: '1rem', borderRadius: 6 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
            <label className="section-label">Strategy</label>
            <div className="flex gap-1">
              {[['simple', 'Simple'], ['advanced', 'Advanced']].map(([key, label]) => (
                <button key={key} type="button" onClick={() => setMode(key)}
                  className={`provider-tab ${mode === key ? 'active' : ''}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'simple' ? (
            <PromptEditorSimple strategy={strategy} onChange={setStrategy} />
          ) : (
            <PromptEditorAdvanced prompt={prompt} onChange={setPrompt} />
          )}
        </section>

        {/* Fight button */}
        <button
          className="btn-arena text-2xl py-4"
          style={{ borderColor: 'var(--neon-blue)', color: 'var(--neon-blue)' }}
          onClick={handleFight}
        >
          FIGHT!
        </button>

      </div>
    </div>
  );
}

// ── Main BotMatchPage ─────────────────────────────────────────────────────────

export default function BotMatchPage() {
  const navigate = useNavigate();
  const [playerFighter, setPlayerFighter] = useState(() => buildFighterFromProfile(loadProfile()));
  const [botFighter] = useState(buildBotFighter);

  // After the match ends, let the winner's celebration play for a beat, then
  // return to the home screen automatically. Cleared on unmount (and if the
  // player taps Home first) so we never navigate twice.
  const homeTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(homeTimerRef.current), []);
  const handleFightEnd = useCallback(() => {
    clearTimeout(homeTimerRef.current);
    homeTimerRef.current = setTimeout(() => navigate('/'), POST_FIGHT_CELEBRATION_MS);
  }, [navigate]);

  if (!playerFighter) {
    return <SetupScreen onFight={setPlayerFighter} />;
  }

  return (
    <Arena
      fighterA={playerFighter}
      fighterB={botFighter}
      fightConfig={{ n: 3 }}
      onFightEnd={handleFightEnd}
      mode="host"
      randomBackground
      onHome={() => navigate('/')}
    />
  );
}
