import { useState, useCallback } from 'react';
import ArenaStage from '../components/ArenaStage.jsx';
import ArenaBackground from '../components/ArenaBackground.jsx';
import { CHARACTERS } from '../data/characters.js';

const CHARACTER_LIST = Object.values(CHARACTERS);

function actionLabel(key, character) {
  if (key.startsWith('ultimate_')) {
    const u = character.ultimates?.find(u => u.key === key);
    return u ? u.name : key.replace('ultimate_', '').replace(/_/g, ' ');
  }
  return key.replace(/_/g, ' ');
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

function FighterPanel({ side, charId, onCharChange, onAction, activeAction }) {
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
            active={activeAction === key}
            isUltimate={false}
            onClick={() => onAction(key)}
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
              active={activeAction === key}
              isUltimate
              onClick={() => onAction(key)}
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
  const [activeA, setActiveA] = useState('idle');
  const [activeB, setActiveB] = useState('idle');

  const fireA = useCallback((key) => {
    setAnimClassA(`anim-${key}`);
    setAnimKeyA(k => k + 1);
    setActiveA(key);
  }, []);

  const fireB = useCallback((key) => {
    setAnimClassB(`anim-${key}`);
    setAnimKeyB(k => k + 1);
    setActiveB(key);
  }, []);

  const bgSeed = `${charAId}-${charBId}`;

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
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
              width={1100}
              height={520}
            />
          </div>
        </ArenaBackground>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        flexShrink: 0,
        borderTop: '2px solid rgba(255,215,0,0.2)',
        maxHeight: 140,
        overflow: 'auto',
      }}>
        <FighterPanel
          side="A"
          charId={charAId}
          onCharChange={id => { setCharAId(id); fireA('idle'); }}
          onAction={fireA}
          activeAction={activeA}
        />
        <div style={{ width: 1, background: 'rgba(255,215,0,0.15)', flexShrink: 0 }} />
        <FighterPanel
          side="B"
          charId={charBId}
          onCharChange={id => { setCharBId(id); fireB('idle'); }}
          onAction={fireB}
          activeAction={activeB}
        />
      </div>
    </div>
  );
}
