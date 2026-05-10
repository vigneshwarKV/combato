import { CHARACTERS } from '../data/characters.js';

// Map action keys to display names. Ultimates are looked up by character.
// hurt/death/celebrate are reaction patterns (the engine drives those via
// animClass, not via the planned-action stream) and must NEVER render as a
// label — see REACTION_KEYS below.
const BASE_LABELS = {
  idle:    { text: 'IDLE',    color: '#94a3b8' },
  jump:    { text: 'JUMP',    color: '#60a5fa' },
  hit:     { text: 'HIT',     color: '#fb923c' },
  shoot:   { text: 'SHOOT',   color: '#a78bfa' },
  slide:   { text: 'SLIDE',   color: '#22d3ee' },
  defend:  { text: 'DEFEND',  color: '#fbbf24' },
  none:    { text: '—',       color: '#475569' },
};

const REACTION_KEYS = new Set(['hurt', 'death', 'celebrate']);

function labelFor(action, characterId) {
  if (!action) return null;
  if (REACTION_KEYS.has(action)) return null;
  const base = BASE_LABELS[action];
  if (base) return base;
  if (action.startsWith('ultimate_') && characterId) {
    const char = CHARACTERS[characterId];
    const ult = char?.ultimates?.find(u => u.key === action);
    if (ult) return { text: ult.name.toUpperCase(), color: '#f472b6' };
  }
  return { text: action.toUpperCase(), color: '#cbd5e1' };
}

export default function ActionLabel({ action, characterId, side }) {
  const label = labelFor(action, characterId);
  if (!label || label.text === 'IDLE') return <div style={{ height: 28 }} />;

  return (
    <div
      key={`${action}-${Date.now()}`}
      style={{
        height: 28,
        padding: '4px 12px',
        borderRadius: 14,
        background: `${label.color}33`,
        border: `1.5px solid ${label.color}`,
        color: label.color,
        fontSize: 13,
        fontWeight: 900,
        letterSpacing: 1.5,
        whiteSpace: 'nowrap',
        textShadow: `0 0 8px ${label.color}aa`,
        animation: 'label-pop 280ms ease-out',
        textAlign: 'center',
        textTransform: 'uppercase',
      }}
    >
      {label.text}
    </div>
  );
}
