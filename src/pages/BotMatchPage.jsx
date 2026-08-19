import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHARACTER_LIST } from '../data/characters.js';
import { DEFAULT_SIMPLE_STRATEGY } from '../data/promptTemplates.js';
import CharacterPreview from '../components/CharacterPreview.jsx';
import Arena from '../components/Arena.jsx';
import {
  loadProfile, isProfileReady, UNLOCKED_IDS,
  usableStrategies, makeStrategy, defaultStrategies, strategyLabel, MAX_STRATEGIES,
} from '../data/designData.js';
import { unlockAudio } from '../engine/soundEngine.js';
import { startScoredMatch, submitScore } from '../lib/leaderboard.js';
import { buildMatchSummary } from '../engine/scoring.js';

const ARCHETYPE_GLYPH = { tank: 'T', striker: 'S', mage: 'M', acrobat: 'A', ranger: 'R' };

// Human-style handles so a quick match reads like you're up against another
// player, not a bot. (The opponent is still engine-driven — see randomOnly.)
const BOT_NAMES = [
  'RedViper', 'K.O.King', 'NightOwl', 'ShadowJab', 'BlazeFury',
  'IronMike92', 'QuickHands', 'GhostStep', 'ThunderClap', 'MadDog',
  'ComboQueen', 'SoloWolf', 'ApexRyu', 'NovaStrike', 'xToxicx',
  'FrostByte', 'RiptideRex', 'ZenMaster', 'JabsMcGee', 'LowBlow',
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

// A ready-to-fight player descriptor built from the saved profile (or the inline
// SetupScreen). Holds the strategy playbook; the live active strategy is tracked
// in BotMatchPage state.
function playerFromProfile(profile) {
  if (!isProfileReady(profile)) return null;
  const strategies = usableStrategies(profile.strategies);
  return {
    id: `player-${Date.now()}`,
    name: profile.handle || 'YOU',
    character: profile.charId,
    strategies: strategies.length ? strategies : [makeStrategy(0, DEFAULT_SIMPLE_STRATEGY)],
    activeStrategyIndex: Math.min(profile.activeStrategyIndex ?? 0, Math.max(0, strategies.length - 1)),
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

// ── Strategy list (inline setup) ───────────────────────────────────────────────

function StrategyListEditor({ strategies, onUpdate, onAdd, onRemove }) {
  return (
    <div className="flex flex-col gap-3">
      {strategies.map((s, i) => (
        <div key={i} style={{
          border: '1px solid var(--arena-panel-border)', borderRadius: 6, padding: '0.75rem',
        }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <span className="section-label" style={{ color: 'var(--neon-gold)' }}>#{i + 1}</span>
            <input
              className="arena-input"
              value={s.name || ''}
              onChange={e => onUpdate(i, { name: e.target.value.slice(0, 20) })}
              placeholder={strategyLabel(s, i)}
              maxLength={20}
              style={{ flex: 1 }}
            />
            {strategies.length > 1 && (
              <button
                type="button"
                className="provider-tab"
                onClick={() => onRemove(i)}
                aria-label={`Remove strategy ${i + 1}`}
              >
                ✕
              </button>
            )}
          </div>
          <textarea
            className="arena-input arena-textarea"
            style={{ minHeight: 90 }}
            value={s.text || ''}
            onChange={e => onUpdate(i, { text: e.target.value })}
            placeholder={`Describe how your fighter should play...\n\nExample:\n${DEFAULT_SIMPLE_STRATEGY}`}
          />
        </div>
      ))}
      {strategies.length < MAX_STRATEGIES && (
        <button type="button" className="provider-tab" onClick={onAdd} style={{ alignSelf: 'flex-start' }}>
          + Add strategy ({strategies.length}/{MAX_STRATEGIES})
        </button>
      )}
    </div>
  );
}

// ── Setup Screen ─────────────────────────────────────────────────────────────

function SetupScreen({ onFight }) {
  const [name, setName] = useState('');
  const [character, setCharacter] = useState('');
  const [strategies, setStrategies] = useState(defaultStrategies);
  const [nameError, setNameError] = useState('');
  const [charError, setCharError] = useState('');

  function handleCharacterSelect(charId) {
    setCharacter(charId);
    setCharError('');
  }

  function updateStrategy(i, patch) {
    setStrategies(list => list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addStrategy() {
    setStrategies(list => (list.length >= MAX_STRATEGIES ? list : [...list, makeStrategy(list.length)]));
  }
  function removeStrategy(i) {
    setStrategies(list => (list.length <= 1 ? list : list.filter((_, idx) => idx !== i)));
  }

  function handleFight() {
    let ok = true;
    if (!name.trim()) { setNameError('Enter your fighter name'); ok = false; }
    if (!character) { setCharError('Pick a character'); ok = false; }
    if (!ok) return;

    // This click is a user gesture — unlock audio now so the fight that mounts
    // right after has a live AudioContext (and the theme starts).
    unlockAudio();

    const kept = usableStrategies(strategies);
    const finalStrategies = kept.length ? kept : [makeStrategy(0, DEFAULT_SIMPLE_STRATEGY)];

    onFight({
      id: `player-${Date.now()}`,
      name: name.trim(),
      character,
      strategies: finalStrategies,
      activeStrategyIndex: 0,
    });
  }

  return (
    <div className="min-h-screen arena-bg flex flex-col items-center overflow-y-auto px-4 py-8">
      <div className="crowd-strip" />

      <div className="relative z-10 w-full max-w-2xl flex flex-col gap-6">

        {/* Header */}
        <div className="text-center">
          <div className="logo-text" style={{ fontSize: '2.2rem' }}>Fight the Machine</div>
          <div className="logo-sub mt-1">Choose your fighter · Write your strategies · Battle the bot</div>
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

        {/* Strategies */}
        <section className="arena-panel" style={{ padding: '1rem', borderRadius: 6 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
            <label className="section-label">Strategies</label>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Switch between them mid-fight</span>
          </div>
          <StrategyListEditor
            strategies={strategies}
            onUpdate={updateStrategy}
            onAdd={addStrategy}
            onRemove={removeStrategy}
          />
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
  const [player, setPlayer] = useState(() => playerFromProfile(loadProfile()));
  const [botFighter] = useState(buildBotFighter);

  // Live-selected strategy index + a ref the fight engine reads each batch.
  const [activeIdx, setActiveIdx] = useState(() => player?.activeStrategyIndex ?? 0);
  const promptRef = useRef(player?.strategies?.[player?.activeStrategyIndex ?? 0]?.text || '');

  // Keep the engine-facing prompt ref pointed at the active strategy.
  useEffect(() => {
    if (player) promptRef.current = player.strategies[activeIdx]?.text || '';
  }, [player, activeIdx]);

  const selectStrategy = useCallback((i) => {
    setActiveIdx(i);
    setPlayer(p => {
      if (p) promptRef.current = p.strategies[i]?.text || '';
      return p;
    });
  }, []);

  // Reads the live active-strategy text. Defined as a stable callback (a ref may
  // be read from a callback, not during render) so the fight engine can call it
  // at the start of each batch — a mid-fight switch takes effect on the next 3
  // moves. See fightEngine.resolveFighter.
  const getPrompt = useCallback(() => promptRef.current, []);

  // Engine fighter object — stable across strategy switches.
  const playerFighter = useMemo(() => {
    if (!player) return null;
    return {
      id: player.id,
      name: player.name,
      character: player.character,
      promptMode: 'simple',
      prompt: player.strategies[player.activeStrategyIndex ?? 0]?.text || '',
      getPrompt,
    };
  }, [player, getPrompt]);

  // After the match ends, let the winner's celebration play for a beat, then
  // return to the home screen automatically. Cleared on unmount (and if the
  // player taps Home first) so we never navigate twice.
  const homeTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(homeTimerRef.current), []);

  // Scored-match handshake (Layer B). When the fight screen mounts, ask the
  // server for a signed match token; it's presented when submitting the score so
  // the server knows this maps to a real, timed match. Best-effort — a null token
  // just means the score won't record (signed out / offline).
  const matchTokenRef = useRef(null);
  const matchStartAtRef = useRef(0);
  useEffect(() => {
    if (!playerFighter) return;
    matchStartAtRef.current = Date.now();
    let cancelled = false;
    startScoredMatch('bot').then((t) => { if (!cancelled) matchTokenRef.current = t; });
    return () => { cancelled = true; };
  }, [playerFighter]);

  const handleFightEnd = useCallback((result) => {
    // Submit for leaderboard points (best-effort; the player is side A vs the bot).
    const token = matchTokenRef.current;
    if (token && result) {
      const summary = buildMatchSummary(result, {
        mode: 'bot',
        playerSide: 'A',
        durationMs: Date.now() - matchStartAtRef.current,
      });
      submitScore(token, summary);
      matchTokenRef.current = null; // one submission per match
    }
    clearTimeout(homeTimerRef.current);
    homeTimerRef.current = setTimeout(() => navigate('/'), POST_FIGHT_CELEBRATION_MS);
  }, [navigate]);

  if (!playerFighter) {
    return <SetupScreen onFight={setPlayer} />;
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
      strategies={player.strategies}
      activeStrategyIndex={activeIdx}
      onSelectStrategy={selectStrategy}
    />
  );
}
