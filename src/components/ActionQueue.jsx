const ACTION_ICONS = {
  punch: '👊',
  kick: '🦵',
  jump: '↑',
  crouch: '↓',
  defend_high: '🛡',
  defend_low: '🛡',
  supermove: '⚡',
  none: '💤'
};

const ACTION_COLORS = {
  punch: '#f97316',
  kick: '#a855f7',
  jump: '#3b82f6',
  crouch: '#10b981',
  defend_high: '#6b7280',
  defend_low: '#6b7280',
  supermove: '#ef4444',
  none: '#4b5563'
};

function TileState({ action, state, outcome }) {
  const icon = ACTION_ICONS[action] || '?';
  const color = ACTION_COLORS[action] || '#888';

  const baseStyle = {
    border: `2px solid ${color}`,
    transition: 'all 0.15s ease'
  };

  let className = 'relative flex flex-col items-center justify-center rounded-lg text-xs font-bold ';
  let style = { ...baseStyle, width: '52px', height: '52px' };

  if (state === 'active') {
    className += 'tile-active scale-110 ';
    style = { ...style, backgroundColor: color + '33', borderColor: color, boxShadow: `0 0 8px ${color}88` };
  } else if (state === 'completed') {
    className += 'opacity-50 ';
    style = { ...style, backgroundColor: 'transparent' };
  } else {
    // upcoming
    className += 'opacity-40 ';
    style = { ...style, backgroundColor: 'transparent', borderStyle: 'dashed' };
  }

  return (
    <div className={className} style={style}>
      <span style={{ fontSize: '18px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '9px', color: state === 'upcoming' ? '#888' : color, marginTop: '2px' }}>
        {action?.toUpperCase()}
      </span>
      {state === 'completed' && outcome && (
        <span className="absolute -top-1 -right-1 text-xs">
          {outcome.damageDealt > 0 ? '💥' : outcome.blocked ? '🛡' : '•'}
        </span>
      )}
    </div>
  );
}

export default function ActionQueue({ movesA = [], movesB = [], currentIndex = -1, completedTurns = [], fighterAColor, fighterBColor, fighterAName, fighterBName }) {
  if (!movesA.length && !movesB.length) {
    return (
      <div className="bg-gray-800 rounded-xl p-3 text-center text-gray-500 text-sm">
        Waiting for next batch...
      </div>
    );
  }

  const getTileState = (index) => {
    if (index < currentIndex) return 'completed';
    if (index === currentIndex) return 'active';
    return 'upcoming';
  };

  const getOutcome = (index, side) => {
    const turn = completedTurns[index];
    if (!turn) return null;
    const isDefend = (a) => a === 'defend_low' || a === 'defend_high';
    if (side === 'A') return { damageDealt: turn.damageToB, blocked: turn.damageToA === 0 && !isDefend(turn.actionB) };
    return { damageDealt: turn.damageToA, blocked: turn.damageToB === 0 && !isDefend(turn.actionA) };
  };

  return (
    <div className="bg-gray-800 rounded-xl p-3 space-y-2">
      {/* Fighter A row */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold w-14 text-right truncate" style={{ color: fighterAColor || '#818cf8' }}>
          {fighterAName || 'A'}
        </span>
        <div className="flex gap-1 flex-wrap">
          {movesA.map((action, i) => (
            <TileState
              key={i}
              action={action}
              state={getTileState(i)}
              outcome={getOutcome(i, 'A')}
            />
          ))}
        </div>
      </div>

      {/* Fighter B row */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold w-14 text-right truncate" style={{ color: fighterBColor || '#f472b6' }}>
          {fighterBName || 'B'}
        </span>
        <div className="flex gap-1 flex-wrap">
          {movesB.map((action, i) => (
            <TileState
              key={i}
              action={action}
              state={getTileState(i)}
              outcome={getOutcome(i, 'B')}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
