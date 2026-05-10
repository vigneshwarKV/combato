import { useState, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import ArenaStage from '../components/ArenaStage.jsx';
import ArenaBackground from '../components/ArenaBackground.jsx';
import { CHARACTERS, METER } from '../data/characters.js';
import { resolveActions, validActionsForCharacter } from '../engine/damageEngine.js';
import { computeAttackTiming } from '../engine/animResolution.js';

const CHARACTER_LIST = Object.values(CHARACTERS);

function actionLabel(key, character) {
  if (key.startsWith('ultimate_')) {
    const u = character.ultimates?.find(u => u.key === key);
    return u ? u.name : key.replace('ultimate_', '').replace(/_/g, ' ');
  }
  return key.replace(/_/g, ' ');
}

function summariseOutcome({ actionA, actionB, damageToA, damageToB, events }) {
  const clash = events?.find(e => e.type === 'clash');
  if (clash) return `CLASH (${clash.kind})${clash.damage ? ` — ${clash.damage} dmg each` : ''}`;
  const blocked = events?.filter(e => e.type === 'blocked') ?? [];
  const missed = events?.filter(e => e.type === 'miss') ?? [];
  const parts = [];
  if (damageToB > 0) parts.push(`A→B ${damageToB}`);
  if (damageToA > 0) parts.push(`B→A ${damageToA}`);
  for (const b of blocked) parts.push(`${b.defender} blocked ${b.kind}`);
  for (const m of missed) parts.push(`${m.attacker} miss (${m.reason})`);
  if (parts.length === 0) parts.push(`${actionA} vs ${actionB} — no contact`);
  return parts.join(' · ');
}

function ActionButton({ label, active, isUltimate, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 10px',
        fontSize: 11,
        fontFamily: 'var(--font-arena)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        border: `1px solid ${isUltimate ? '#a855f7' : active ? 'var(--neon-gold)' : 'rgba(255,215,0,0.3)'}`,
        background: active
          ? (isUltimate ? 'rgba(168,85,247,0.3)' : 'rgba(255,215,0,0.2)')
          : 'rgba(0,0,0,0.4)',
        color: isUltimate ? '#c084fc' : active ? 'var(--neon-gold)' : 'rgba(255,215,0,0.7)',
        cursor: 'pointer',
        borderRadius: 3,
        transition: 'all 0.1s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function FighterPanel({ side, charId, onCharChange, onSelect, selectedAction }) {
  const character = CHARACTERS[charId];
  if (!character) return null;

  const baseKeys = Object.keys(character.animations).filter(k => !k.startsWith('ultimate_'));
  const ultimateKeys = Object.keys(character.animations).filter(k => k.startsWith('ultimate_'));

  return (
    <div style={{
      flex: 1,
      padding: '8px 12px',
      borderTop: '1px solid rgba(255,215,0,0.15)',
      background: 'rgba(8,0,13,0.9)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
    }}>
      {/* Character selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--neon-gold)', fontFamily: 'var(--font-arena)', opacity: 0.7 }}>
          FIGHTER {side}
        </span>
        <select
          value={charId}
          onChange={e => onCharChange(e.target.value)}
          style={{
            background: 'rgba(0,0,0,0.6)',
            color: 'var(--neon-gold)',
            border: '1px solid rgba(255,215,0,0.4)',
            borderRadius: 3,
            padding: '2px 6px',
            fontSize: 11,
            fontFamily: 'var(--font-arena)',
            cursor: 'pointer',
          }}
        >
          {CHARACTER_LIST.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
          {character.renderMode}
        </span>
      </div>

      {/* Base action buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {baseKeys.map(key => (
          <ActionButton
            key={key}
            label={actionLabel(key, character)}
            active={selectedAction === key}
            isUltimate={false}
            onClick={() => onSelect(key)}
          />
        ))}
      </div>

      {/* Ultimate buttons */}
      {ultimateKeys.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {ultimateKeys.map(key => (
            <ActionButton
              key={key}
              label={actionLabel(key, character)}
              active={selectedAction === key}
              isUltimate
              onClick={() => onSelect(key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DevPage() {
  const [charAId, setCharAId] = useState('monkey');
  const [charBId, setCharBId] = useState('boyPlat');

  const [animClassA, setAnimClassA] = useState('anim-idle');
  const [animClassB, setAnimClassB] = useState('anim-idle');
  const [animKeyA, setAnimKeyA] = useState(0);
  const [animKeyB, setAnimKeyB] = useState(0);
  const [selectedA, setSelectedA] = useState('idle');
  const [selectedB, setSelectedB] = useState('idle');
  const [lastOutcome, setLastOutcome] = useState(null);
  const [isLooping, setIsLooping] = useState(false);
  // All scheduled timers for the current sequence (reactions + clears). Any
  // re-fire or character change cancels every pending entry so animations
  // never cross-fade from a previous sequence.
  const timersRef = useRef([]);
  const cancelTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };
  const schedule = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  };
  // Random-loop drivers. loopRef gates the next tick (so cancel takes effect
  // even if a tick was already queued); loopTimerRef holds the pending tick.
  const loopRef = useRef(false);
  const loopTimerRef = useRef(null);

  // Run a chosen pair of actions through the real fight engine so DevPage
  // exhibits the same clash matrix, mid-action hurt/death reactions, and
  // per-fighter idle reset as an actual fight. Meter is pinned at MAX so
  // ultimates fire. Returns the cycle duration so a caller (random loop) can
  // chain the next action when the current one finishes.
  const fireWith = useCallback((actA, actB) => {
    cancelTimers();

    const result = resolveActions(
      actA, actB,
      charAId, charBId,
      METER.MAX, METER.MAX,
      [], [],
    );
    const charA = CHARACTERS[charAId];
    const charB = CHARACTERS[charBId];
    const timing = computeAttackTiming(result, charA, charB);

    // t=0: both fighters play their initial anim (idle if launch is deferred).
    setAnimClassA(`anim-${timing.initialAnimA}`);
    setAnimKeyA(k => k + 1);
    setAnimClassB(`anim-${timing.initialAnimB}`);
    setAnimKeyB(k => k + 1);
    setLastOutcome({
      actionA: result.actualActionA,
      actionB: result.actualActionB,
      damageToA: result.damageToA,
      damageToB: result.damageToB,
      events: result.events,
    });

    // t=launchAt: deferred launches (jumper synced to slow projectile arrival).
    if (timing.launchAnimA) {
      schedule(() => {
        setAnimClassA(`anim-${timing.launchAnimA}`);
        setAnimKeyA(k => k + 1);
      }, timing.launchAtA);
    }
    if (timing.launchAnimB) {
      schedule(() => {
        setAnimClassB(`anim-${timing.launchAnimB}`);
        setAnimKeyB(k => k + 1);
      }, timing.launchAtB);
    }
    // t=reactionAt*: victims swap to hurt/death (only when they took damage).
    // For projectile-hit-vs-jumper this is deferred to the jumper's landing.
    // flushSync forces React to commit the animClass change (and run
    // ArenaStage's useEffect to cancel any pending projectile timers) before
    // returning to the event loop — required when a same-tick projectile
    // spawn timer would otherwise fire first (e.g., monkey throw 320ms vs
    // slide impact 320ms).
    if (timing.reactionA) {
      schedule(() => {
        flushSync(() => {
          setAnimClassA(`anim-${timing.reactionA}`);
          setAnimKeyA(k => k + 1);
        });
      }, timing.reactionAtA);
    }
    if (timing.reactionB) {
      schedule(() => {
        flushSync(() => {
          setAnimClassB(`anim-${timing.reactionB}`);
          setAnimKeyB(k => k + 1);
        });
      }, timing.reactionAtB);
    }
    // t=clear: each fighter back to idle independently.
    schedule(() => {
      setAnimClassA('anim-idle');
      setAnimKeyA(k => k + 1);
    }, timing.clearA);
    schedule(() => {
      setAnimClassB('anim-idle');
      setAnimKeyB(k => k + 1);
    }, timing.clearB);

    return Math.max(timing.clearA, timing.clearB);
  }, [charAId, charBId]);

  const fireBoth = useCallback(() => {
    fireWith(selectedA, selectedB);
  }, [fireWith, selectedA, selectedB]);

  const stopRandomLoop = useCallback(() => {
    loopRef.current = false;
    if (loopTimerRef.current) {
      clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    setIsLooping(false);
  }, []);

  const startRandomLoop = useCallback(() => {
    if (loopRef.current) return;
    loopRef.current = true;
    setIsLooping(true);
    const pick = (charId) => {
      const opts = validActionsForCharacter(charId).filter(a => a !== 'none' && a !== 'idle');
      return opts[Math.floor(Math.random() * opts.length)];
    };
    const tick = () => {
      if (!loopRef.current) return;
      const a = pick(charAId);
      const b = pick(charBId);
      setSelectedA(a);
      setSelectedB(b);
      const cycleMs = fireWith(a, b);
      // Buffer between cycles so a viewer can register the outcome before the
      // next sequence begins.
      loopTimerRef.current = setTimeout(tick, cycleMs + 400);
    };
    tick();
  }, [fireWith, charAId, charBId]);

  const resetA = useCallback((id) => {
    stopRandomLoop();
    cancelTimers();
    setCharAId(id);
    setSelectedA('idle');
    setAnimClassA('anim-idle');
    setAnimKeyA(k => k + 1);
    setLastOutcome(null);
  }, [stopRandomLoop]);

  const resetB = useCallback((id) => {
    stopRandomLoop();
    cancelTimers();
    setCharBId(id);
    setSelectedB('idle');
    setAnimClassB('anim-idle');
    setAnimKeyB(k => k + 1);
    setLastOutcome(null);
  }, [stopRandomLoop]);

  const bgSeed = `${charAId}-${charBId}`;

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflowX: 'hidden',
      backgroundColor: 'var(--arena-bg)',
    }}>
      {/* Top bar */}
      <div style={{
        padding: '6px 16px',
        background: 'rgba(8,0,13,0.95)',
        borderBottom: '1px solid rgba(255,215,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: 'var(--font-arena)',
          color: 'var(--neon-gold)',
          fontSize: 12,
          letterSpacing: '0.2em',
          opacity: 0.6,
        }}>
          DEV MODE
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
          — select characters and trigger actions below
        </span>
      </div>

      {/* Arena */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
        <ArenaBackground seed={bgSeed} parallax>
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingBottom: '4vh',
            zIndex: 10,
          }}>
            <ArenaStage
              characterAId={charAId}
              characterBId={charBId}
              animClassA={animClassA}
              animClassB={animClassB}
              animKeyA={animKeyA}
              animKeyB={animKeyB}
              plannedActionA={selectedA}
              plannedActionB={selectedB}
              width={1100}
              height={700}
            />
          </div>
        </ArenaBackground>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        flexShrink: 0,
        borderTop: '2px solid rgba(255,215,0,0.2)',
        maxHeight: 180,
        overflow: 'auto',
      }}>
        <FighterPanel
          side="A"
          charId={charAId}
          onCharChange={resetA}
          onSelect={setSelectedA}
          selectedAction={selectedA}
        />
        <div style={{ width: 1, background: 'rgba(255,215,0,0.15)', flexShrink: 0 }} />
        <FighterPanel
          side="B"
          charId={charBId}
          onCharChange={resetB}
          onSelect={setSelectedB}
          selectedAction={selectedB}
        />
      </div>

      {/* Attack bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '10px 16px',
        background: 'rgba(8,0,13,0.95)',
        borderTop: '1px solid rgba(255,215,0,0.2)',
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: 'var(--font-arena)',
          fontSize: 11,
          color: 'rgba(255,215,0,0.7)',
          letterSpacing: '0.1em',
        }}>
          A: <span style={{ color: 'var(--neon-gold)' }}>{actionLabel(selectedA, CHARACTERS[charAId])}</span>
        </span>
        {lastOutcome && (
          <span style={{
            fontFamily: 'monospace', fontSize: 10,
            color: 'rgba(255,255,255,0.55)',
            padding: '2px 8px',
            border: '1px solid rgba(255,215,0,0.2)',
            borderRadius: 3,
            whiteSpace: 'nowrap',
          }}>
            {summariseOutcome(lastOutcome)}
          </span>
        )}
        <button
          onClick={fireBoth}
          disabled={isLooping}
          style={{
            padding: '8px 28px',
            fontFamily: 'var(--font-arena)',
            fontSize: 14,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            border: '2px solid #ef4444',
            background: 'linear-gradient(180deg, rgba(239,68,68,0.3), rgba(127,29,29,0.5))',
            color: '#fecaca',
            cursor: isLooping ? 'not-allowed' : 'pointer',
            opacity: isLooping ? 0.4 : 1,
            borderRadius: 4,
            boxShadow: '0 0 12px rgba(239,68,68,0.5)',
            fontWeight: 'bold',
          }}
        >
          ⚔ Attack
        </button>
        <button
          onClick={isLooping ? stopRandomLoop : startRandomLoop}
          style={{
            padding: '8px 22px',
            fontFamily: 'var(--font-arena)',
            fontSize: 13,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            border: `2px solid ${isLooping ? '#fbbf24' : '#a855f7'}`,
            background: isLooping
              ? 'linear-gradient(180deg, rgba(251,191,36,0.3), rgba(120,53,15,0.5))'
              : 'linear-gradient(180deg, rgba(168,85,247,0.3), rgba(76,29,149,0.5))',
            color: isLooping ? '#fde68a' : '#e9d5ff',
            cursor: 'pointer',
            borderRadius: 4,
            boxShadow: isLooping
              ? '0 0 12px rgba(251,191,36,0.5)'
              : '0 0 12px rgba(168,85,247,0.5)',
            fontWeight: 'bold',
          }}
        >
          {isLooping ? '■ Cancel' : '🎲 Random Attack'}
        </button>
        <span style={{
          fontFamily: 'var(--font-arena)',
          fontSize: 11,
          color: 'rgba(255,215,0,0.7)',
          letterSpacing: '0.1em',
        }}>
          B: <span style={{ color: 'var(--neon-gold)' }}>{actionLabel(selectedB, CHARACTERS[charBId])}</span>
        </span>
      </div>
    </div>
  );
}
