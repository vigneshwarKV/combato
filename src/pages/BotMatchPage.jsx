import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHARACTER_LIST } from '../data/characters.js';
import { getCharacterTemplate, DEFAULT_PROMPT } from '../data/promptTemplates.js';
import { buildPromptFromStrategy } from '../components/PromptEditorSimple.jsx';
import PromptEditorSimple from '../components/PromptEditorSimple.jsx';
import CharacterPreview from '../components/CharacterPreview.jsx';
import Arena from '../components/Arena.jsx';

const ARCHETYPE_GLYPH = { tank: 'T', striker: 'S', mage: 'M', acrobat: 'A', ranger: 'R' };

const BOT_NAMES = [
  'THE MACHINE', 'IRON KOMBATANT', 'CIRCUIT BREAKER',
  'NULL POINTER', 'BYTE CRUSHER', 'STACK OVERFLOW',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildBotFighter() {
  const char = pickRandom(CHARACTER_LIST);
  return {
    id: 'bot',
    name: pickRandom(BOT_NAMES),
    character: char.id,
    prompt: '',
    apiKey: '',
    provider: 'groq',
    model: '',
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
  const [strategy, setStrategy] = useState('');
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('groq');
  const [apiKey, setApiKey] = useState('');
  const [nameError, setNameError] = useState('');
  const [charError, setCharError] = useState('');

  function handleCharacterSelect(charId) {
    setCharacter(charId);
    setCharError('');
    setPrompt(getCharacterTemplate(charId) || DEFAULT_PROMPT);
    setStrategy('');
  }

  function handleStrategyChange(newStrategy, fullPrompt) {
    setStrategy(newStrategy);
    setPrompt(fullPrompt);
  }

  function handleFight() {
    let ok = true;
    if (!name.trim()) { setNameError('Enter your fighter name'); ok = false; }
    if (!character) { setCharError('Pick a character'); ok = false; }
    if (!ok) return;

    const finalPrompt = prompt || buildPromptFromStrategy(character, strategy);
    onFight({
      id: `player-${Date.now()}`,
      name: name.trim(),
      character,
      prompt: finalPrompt,
      provider,
      apiKey,
      model: '',
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

        {/* Strategy + API */}
        <section className="arena-panel" style={{ padding: '1rem', borderRadius: 6 }}>
          <label className="section-label" style={{ display: 'block', marginBottom: '0.75rem' }}>Strategy</label>
          <PromptEditorSimple
            character={character}
            strategy={strategy}
            onChange={handleStrategyChange}
          />

          <div className="arena-divider" style={{ marginTop: '1rem' }} />

          <div className="flex flex-col gap-3 mt-3">
            <div className="flex flex-col gap-1">
              <label className="section-label">AI Provider</label>
              <div className="flex gap-1 mt-1 flex-wrap">
                {[['groq', 'Groq'], ['openai', 'OpenAI'], ['anthropic', 'Anthropic']].map(([key, label]) => (
                  <button key={key} onClick={() => setProvider(key)}
                    className={`provider-tab ${provider === key ? 'active' : ''}`}>
                    {label}{key === 'groq' && <span className="ml-1 text-xs opacity-60">(free)</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="section-label">API Key</label>
              <input
                type="password"
                className="arena-input mt-1"
                placeholder="Leave blank for random moves (testing)"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                No key? Random moves will be used. Your key never leaves your browser.
              </p>
            </div>
          </div>
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
  const [playerFighter, setPlayerFighter] = useState(null);
  const [botFighter] = useState(buildBotFighter);

  if (!playerFighter) {
    return <SetupScreen onFight={setPlayerFighter} />;
  }

  return (
    <div className="relative">
      <button
        onClick={() => navigate('/')}
        className="btn-arena btn-arena-sm btn-arena-ghost"
        style={{ position: 'fixed', top: 12, left: 12, zIndex: 100 }}
      >
        ← Home
      </button>
      <Arena
        fighterA={playerFighter}
        fighterB={botFighter}
        fightConfig={{ n: 3, maxBatches: 20 }}
        onFightEnd={() => {}}
        mode="host"
      />
    </div>
  );
}
