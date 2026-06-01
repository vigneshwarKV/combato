import { useState } from 'react';
import { DEFAULT_SIMPLE_STRATEGY } from '../data/promptTemplates.js';

// Variables the engine fills in automatically around the player's strategy in
// Simple mode (matches the wrapper in engine/prompts.js).
const VARIABLE_TOOLTIPS = {
  '{game_rules}': 'Full game rules — injected automatically',
  '{self_info}': 'Your fighter: story, archetype, super_move effect',
  '{opponent_info}': "Opponent's story and super_move effect",
  '{self_hp}': 'Your current HP',
  '{opponent_hp}': "Opponent's current HP",
  '{self_super_move_is_available}': 'Whether your super_move is charged (true/false)',
  '{action_history}': 'Every move so far this game',
};

function VarChip({ variable }) {
  const [hover, setHover] = useState(false);
  return (
    <span
      className="var-chip"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {variable}
      {hover && (
        <span className="var-chip-tooltip">{VARIABLE_TOOLTIPS[variable] || variable}</span>
      )}
    </span>
  );
}

// Simple mode: the player writes ONLY a strategy. engine/prompts.js wraps it
// with the rules, fighter info and live state. onChange receives the raw text.
export default function PromptEditorSimple({ strategy, onChange, disabled }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="section-label mb-1">Auto-injected for you</div>
        <div className="flex flex-wrap gap-1">
          {Object.keys(VARIABLE_TOOLTIPS).map(v => (
            <VarChip key={v} variable={v} />
          ))}
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Rules, your fighter, the opponent and live state are added automatically — just write your strategy.
        </p>
      </div>

      <div className="arena-divider" />

      <div className="flex flex-col gap-1">
        <label className="section-label">Your Strategy</label>
        <textarea
          className="arena-input arena-textarea"
          style={{ minHeight: 120 }}
          placeholder={`Describe how your fighter should play...\n\nExample:\n${DEFAULT_SIMPLE_STRATEGY}`}
          value={strategy}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
