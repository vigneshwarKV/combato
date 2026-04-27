import { useState } from 'react';
import { CHARACTER_TEMPLATES } from '../data/promptTemplates.js';

const VARIABLE_TOOLTIPS = {
  '{N}': 'Number of moves per turn',
  '{hp}': 'Current HP values for both fighters',
  '{meter}': 'Your super meter (0–100)',
  '{moveset}': 'Your character\'s full abilities and Ultimates',
  '{opponent_moveset}': 'Opponent\'s abilities and Ultimates',
  '{previous_actions}': 'Last turn\'s moves and outcomes',
  '{game_rules}': 'Full game rules injected automatically',
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

function buildPromptFromStrategy(character, strategy) {
  const template = CHARACTER_TEMPLATES[character];
  if (!template) {
    return strategy
      ? `STRATEGY:\n${strategy}\n\nReturn ONLY a JSON array of exactly {N} action strings.\n{game_rules}`
      : `Return ONLY a JSON array of exactly {N} action strings.\n{game_rules}`;
  }
  // Inject the user's strategy into the template by replacing the STRATEGY: section
  const strategySection = strategy
    ? `STRATEGY:\n${strategy}`
    : template.match(/STRATEGY:[^]*?(?=\n\nCurrent state|\n\nReturn|$)/)?.[0] || 'STRATEGY:\n- Use your abilities wisely';
  return template.replace(/STRATEGY:[^]*?(?=\n\nCurrent state|\n\nReturn|$)/, strategySection);
}

export default function PromptEditorSimple({ character, strategy, onChange, disabled }) {
  function handleStrategyChange(e) {
    const newStrategy = e.target.value;
    const fullPrompt = buildPromptFromStrategy(character, newStrategy);
    onChange(newStrategy, fullPrompt);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="section-label mb-1">Auto-injected variables</div>
        <div className="flex flex-wrap gap-1">
          {Object.keys(VARIABLE_TOOLTIPS).map(v => (
            <VarChip key={v} variable={v} />
          ))}
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          These are automatically filled in — just write your strategy below.
        </p>
      </div>

      <div className="arena-divider" />

      <div className="flex flex-col gap-1">
        <label className="section-label">Your Strategy</label>
        <textarea
          className="arena-input arena-textarea"
          style={{ minHeight: 120 }}
          placeholder={`Describe how your fighter should play...\n\nExample:\n- Spam ranged attacks to build meter\n- Save Ultimate for when opponent is below 40 HP\n- Dodge when meter is full`}
          value={strategy}
          onChange={handleStrategyChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export { buildPromptFromStrategy };
