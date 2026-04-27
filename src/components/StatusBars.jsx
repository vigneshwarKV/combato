import { CHARACTERS, METER } from '../data/characters.js';

// Bar 3 texture set — clean fantasy look, fits the arena aesthetic.
const BAR_STYLE = 3;
const BAR_BASE = `/assets/bars/Textures/Bar%20${BAR_STYLE}/LoadingBar_${BAR_STYLE}`;
const BAR_BG = `${BAR_BASE}_Background.png`;
const BAR_GREEN = `${BAR_BASE}_Fill_Green.png`;
const BAR_RED = `${BAR_BASE}_Fill_Red.png`;
const BAR_YELLOW = `${BAR_BASE}_Fill_Yellow.png`;

const STATUS_ICON = {
  burn:   { emoji: '🔥', color: '#f97316' },
  freeze: { emoji: '❄️', color: '#38bdf8' },
  poison: { emoji: '☠️', color: '#84cc16' },
  stun:   { emoji: '⚡', color: '#facc15' },
};

function Bar({ value, max, fillSrc, side }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 28,
        backgroundImage: `url(${BAR_BG})`,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0, bottom: 0,
          left: side === 'B' ? 'auto' : 0,
          right: side === 'B' ? 0 : 'auto',
          width: `${pct}%`,
          backgroundImage: `url(${fillSrc})`,
          backgroundSize: 'auto 100%',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: side === 'B' ? 'right center' : 'left center',
          transition: 'width 300ms ease',
        }}
      />
    </div>
  );
}

function StatusBadges({ status }) {
  if (!status || status.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
      {status.map((s, i) => {
        const icon = STATUS_ICON[s.type] || { emoji: '?', color: '#888' };
        return (
          <span
            key={`${s.type}-${i}`}
            title={`${s.type} (${s.duration} turns left)`}
            style={{
              fontSize: 14,
              padding: '1px 6px',
              borderRadius: 10,
              background: `${icon.color}33`,
              border: `1px solid ${icon.color}aa`,
              color: '#fff',
              lineHeight: 1,
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
  const hpBarSrc = hp < 30 ? BAR_RED : BAR_GREEN;
  const align = side === 'B' ? 'flex-end' : 'flex-start';
  const textAlign = side === 'B' ? 'right' : 'left';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: align,
        gap: 4,
        width: 'min(40vw, 360px)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', width: '100%',
                    flexDirection: side === 'B' ? 'row-reverse' : 'row', justifyContent: 'space-between' }}>
        <span
          style={{
            color: fighter.color,
            fontWeight: 900,
            fontSize: 18,
            textShadow: `0 0 12px ${fighter.color}aa`,
            textAlign,
          }}
        >
          {fighter.name}
        </span>
        {characterName && (
          <span style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 1 }}>
            {characterName.toUpperCase()}
          </span>
        )}
      </div>

      <Bar value={hp} max={100} fillSrc={hpBarSrc} side={side} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexDirection: side === 'B' ? 'row-reverse' : 'row', width: '100%' }}>
        <span style={{ color: hp < 30 ? '#ef4444' : '#e5e7eb', fontWeight: 800, fontSize: 14, minWidth: 32, textAlign }}>
          {hp} HP
        </span>
      </div>

      <Bar value={meter} max={METER.MAX} fillSrc={BAR_YELLOW} side={side} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexDirection: side === 'B' ? 'row-reverse' : 'row', width: '100%' }}>
        <span style={{ color: '#fde047', fontWeight: 700, fontSize: 12, minWidth: 56, textAlign }}>
          ⚡ {meter}/{METER.MAX}
        </span>
      </div>

      <StatusBadges status={status} />
    </div>
  );
}
