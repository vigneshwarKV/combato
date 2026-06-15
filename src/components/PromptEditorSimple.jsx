import { DEFAULT_SIMPLE_STRATEGY } from '../data/promptTemplates.js';

// Simple mode: the player writes ONLY a strategy. engine/prompts.js wraps it
// with the rules, fighter info and live state automatically. onChange gets the text.
export default function PromptEditorSimple({ strategy, onChange, disabled }) {
  return (
    <div className="flex flex-col gap-3">
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
