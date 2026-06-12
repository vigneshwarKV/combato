// Speed Streak action callout — ported from the "Action Callouts" design
// (action-colour treatment, small size). Action-only (no fighter name),
// rendered on each fighter's OUTER side with motion streaks trailing toward
// the screen edge and the verb skewed toward the fighter. Pure live text +
// CSS, so any action word styles on the fly.
//
// Colors mirror the design's ACTION_META palette. Ultimates are looked up by
// character and share the OVERDRIVE pink. hurt/death/celebrate are reaction
// patterns (the engine drives those via animClass, not the planned-action
// stream) and must NEVER render as a label — see REACTION_KEYS below.
const BASE_LABELS = {
  jump:   { text: 'JUMP',   color: '#5ab4ff' },
  hit:    { text: 'HIT',    color: '#ff7a33' },
  shoot:  { text: 'SHOOT',  color: '#a78bfa' },
  slide:  { text: 'SLIDE',  color: '#28d3e8' },
  defend_high: { text: 'GUARD HIGH', color: '#ffc23a' },
  defend_low:  { text: 'GUARD LOW',  color: '#ffd76a' },
};

const ULTIMATE_COLOR = '#ff5fae'; // OVERDRIVE pink
const INK = '#0c0c10';            // dark stroke / drop shadow

const REACTION_KEYS = new Set(['hurt', 'death', 'celebrate']);
const SILENT_KEYS = new Set(['idle', 'none']);

function labelFor(action) {
  if (!action) return null;
  if (REACTION_KEYS.has(action) || SILENT_KEYS.has(action)) return null;
  const base = BASE_LABELS[action];
  if (base) return base;
  // Every character's special renders as the generic SUPERMOVE (the fancy
  // per-character ultimate name is never shown — see prompts.js super_move).
  if (action.startsWith('ultimate_')) {
    return { text: 'SUPERMOVE', color: ULTIMATE_COLOR };
  }
  return { text: action.toUpperCase(), color: '#cbd5e1' };
}

// Speed Streak verb. `side` ("A" left / "B" right) drives the skew direction
// and text alignment; the three motion streaks always sit BEFORE the first
// letter on both sides. No entrance/pulse animation — the callout renders
// statically for as long as the action is held (fixes the multi-blink).
export default function ActionLabel({ action, side, size = 28, streaks = true, struck = false }) {
  const label = labelFor(action);
  if (!label) return null;

  const isA = side === 'A';
  // A struck label (e.g. a super_move wasted on an empty meter) renders muted
  // grey with a line-through so it reads as "attempted but didn't execute".
  const color = struck ? '#8a8f9c' : label.color;
  const strokeW = Math.max(1.5, size * 0.05);
  const drop = Math.max(2, size * 0.075);

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: isA ? 'flex-start' : 'flex-end' }}>
      {/* motion streaks — always before the first character on both sides */}
      {streaks && (
        <div style={{
          position: 'absolute', top: '46%', left: -size * 0.18,
          transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column',
          gap: size * 0.13, alignItems: 'flex-start', pointerEvents: 'none',
        }}>
          {[1.7, 1.05, 1.35].map((mult, i) => (
            <div key={i} style={{
              width: size * mult, height: Math.max(2.5, size * 0.085), background: color,
              borderRadius: 99, boxShadow: `0 0 ${size * 0.22}px ${color}`,
            }} />
          ))}
        </div>
      )}
      {/* the verb */}
      <div style={{
        fontFamily: '"Anton", sans-serif', fontStyle: 'italic', fontSize: size, lineHeight: 0.9,
        letterSpacing: 1, color, whiteSpace: 'nowrap', zIndex: 2,
        // Same forward lean on both sides (left previously used -8deg, which
        // cancelled the italic and read as upright).
        transform: 'skewX(8deg)',
        WebkitTextStroke: `${strokeW}px ${INK}`,
        textShadow: `${drop}px ${drop}px 0 ${INK}, 0 0 ${size * 0.55}px ${color}`,
        textDecoration: struck ? 'line-through' : 'none',
        textDecorationThickness: struck ? `${Math.max(2, size * 0.08)}px` : undefined,
        opacity: struck ? 0.85 : 1,
      }}>{label.text}</div>
    </div>
  );
}
