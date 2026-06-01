import { CHARACTERS, METER } from '../data/characters.js';

// ─────────────────────────────────────────────────────────────────────────────
// StatusBars — "Arcade Skew" (Design C1) HUD bars.
//
// Same props { fighter, hp, meter, status, side } and the same behaviour
// (low-HP red state, side-A/B mirroring, status badges) as the previous
// texture-based version. Only the visuals changed — chunky black-outlined
// skewed parallelograms with italic display numerals.
//
// Fonts (Anton + Barlow Condensed) are self-injected once on load, so no change
// to index.html is required.
// ─────────────────────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('pk-arcade-fonts')) {
  const link = document.createElement('link');
  link.id = 'pk-arcade-fonts';
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:ital,wght@0,700;0,800;1,800&display=swap';
  document.head.appendChild(link);
}

const INK = '#120a04';
const HP_GREEN = 'linear-gradient(180deg, #7dff3a, #36a814)';
const HP_RED = 'linear-gradient(180deg, #ff6b5a, #c2261a)';
const METER_GOLD = 'linear-gradient(180deg, #ffcf3a, #f08a00)';

// Responsive sizing — every dimension scales with viewport HEIGHT (the limiting
// axis in landscape) via clamp(min, Xvh, max). On desktop the `max` wins and the
// HUD looks identical to the fixed-px design; on a short landscape phone the vh
// term shrinks it automatically. This works on real devices because the Arena
// renders the HUD overlay at true viewport size (only the fighter canvas is
// CSS-scaled) — so these clamps are the actual fix, not just a mock trick.
const R = {
  name:   'clamp(15px, 4.2vh, 32px)',
  char:   'clamp(8px, 1.7vh, 13px)',
  hpBar:  'clamp(13px, 3.6vh, 28px)',
  mtBar:  'clamp(7px, 1.9vh, 15px)',
  hpNum:  'clamp(12px, 2.9vh, 22px)',
  hpUnit: 'clamp(8px, 1.6vh, 12px)',
  mtNum:  'clamp(9px, 1.7vh, 13px)',
  mtBig:  'clamp(10px, 2vh, 15px)',
  gap:    'clamp(2px, 0.9vh, 7px)',
  border: 'clamp(2px, 0.4vh, 3px)',
  shadow: 'clamp(2px, 0.5vh, 4px)',
  stroke: 'clamp(1px, 0.22vh, 1.6px)',
  badge:  'clamp(9px, 1.7vh, 13px)',
};

const STATUS_ICON = {
  burn:   { emoji: '🔥', color: '#f97316' },
  freeze: { emoji: '❄️', color: '#38bdf8' },
  poison: { emoji: '☠️', color: '#84cc16' },
  stun:   { emoji: '⚡', color: '#facc15' },
};

function Bar({ value, max, side, kind }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const isB = side === 'B';
  const isHp = kind === 'hp';
  const low = isHp && pct < 30;
  const fill = isHp ? (low ? HP_RED : HP_GREEN) : METER_GOLD;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: isHp ? R.hpBar : R.mtBar,
        transform: isB ? 'skewX(16deg)' : 'skewX(-16deg)',
        background: '#15100a',
        border: `${R.border} solid ${INK}`,
        boxShadow: `${R.shadow} ${R.shadow} 0 rgba(0,0,0,.3)`,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: isB ? 'auto' : 0,
          right: isB ? 0 : 'auto',
          width: `${pct}%`,
          background: fill,
          transition: 'width 300ms ease',
        }}
      >
        {/* gloss highlight */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: '46%',
            background: 'linear-gradient(180deg, rgba(255,255,255,.42), rgba(255,255,255,0))',
          }}
        />
      </div>
    </div>
  );
}

function StatusBadges({ status, side }) {
  if (!status || status.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 6, flexDirection: side === 'B' ? 'row-reverse' : 'row' }}>
      {status.map((s, i) => {
        const icon = STATUS_ICON[s.type] || { emoji: '?', color: '#888' };
        return (
          <span
            key={`${s.type}-${i}`}
            title={`${s.type} (${s.duration} turns left)`}
            style={{
              fontSize: R.badge,
              fontFamily: '"Barlow Condensed", sans-serif',
              fontWeight: 800,
              padding: '1px 7px',
              transform: side === 'B' ? 'skewX(8deg)' : 'skewX(-8deg)',
              background: `${icon.color}33`,
              border: `2px solid ${icon.color}`,
              color: '#fff',
              lineHeight: 1.3,
            }}
          >
            {icon.emoji} {s.duration}
          </span>
        );
      })}
    </div>
  );
}

export default function StatusBars({ fighter, hp, meter, status, side }) {
  const characterName = fighter.character ? CHARACTERS[fighter.character]?.name : null;
  const isB = side === 'B';
  const low = hp < 30;

  const nameStyle = {
    fontFamily: '"Anton", sans-serif',
    fontStyle: 'italic',
    fontSize: R.name,
    lineHeight: 1,
    letterSpacing: 1,
    color: '#fff',
    WebkitTextStroke: `${R.stroke} ${INK}`,
    textShadow: `3px 3px 0 rgba(0,0,0,.3), 0 0 14px ${fighter.color}66`,
    transform: 'skewX(-8deg)',
    whiteSpace: 'nowrap',
  };
  const charStyle = {
    fontFamily: '"Barlow Condensed", sans-serif',
    fontWeight: 800,
    fontStyle: 'italic',
    fontSize: R.char,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: fighter.color,
    textShadow: '0 1px 2px rgba(0,0,0,.6)',
    whiteSpace: 'nowrap',
  };
  const hpNumStyle = {
    fontFamily: '"Anton", sans-serif',
    fontStyle: 'italic',
    fontSize: R.hpNum,
    lineHeight: 1,
    color: low ? '#ff7a6b' : '#fff',
    WebkitTextStroke: `1px ${INK}`,
  };
  const meterNumStyle = {
    fontFamily: '"Barlow Condensed", sans-serif',
    fontWeight: 800,
    fontStyle: 'italic',
    fontSize: R.mtNum,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#ffcf3a',
    textShadow: '0 1px 2px rgba(0,0,0,.6)',
  };
  const rowReverse = { flexDirection: isB ? 'row-reverse' : 'row' };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isB ? 'flex-end' : 'flex-start',
        gap: R.gap,
        width: 'min(42vw, 380px)',
        padding: '0 6px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', width: '100%',
                    justifyContent: 'space-between', ...rowReverse }}>
        <span style={nameStyle}>{fighter.name}</span>
        {characterName && <span style={charStyle}>{characterName.toUpperCase()}</span>}
      </div>

      <Bar value={hp} max={100} side={side} kind="hp" />
      <span style={{ ...hpNumStyle, alignSelf: isB ? 'flex-end' : 'flex-start' }}>
        {hp}<span style={{ fontSize: R.hpUnit, opacity: 0.85 }}> HP</span>
      </span>

      <Bar value={meter} max={METER.MAX} side={side} kind="meter" />
      <span style={{ ...meterNumStyle, alignSelf: isB ? 'flex-end' : 'flex-start' }}>
        SUPER <b style={{ fontSize: R.mtBig }}>{meter}</b>/{METER.MAX}
      </span>

      <StatusBadges status={status} side={side} />
    </div>
  );
}
