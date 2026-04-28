import { DEFAULT_PROMPT, CHARACTER_OPTIONS, getCharacterTemplate } from '../data/promptTemplates.js';
import { CHARACTERS, METER } from '../data/characters.js';

const PROVIDER_DEFAULTS = {
  groq:      { label: 'Groq',      placeholder: 'llama-3.3-70b-versatile' },
  openai:    { label: 'OpenAI',    placeholder: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic', placeholder: 'claude-sonnet-4-20250514' },
};

const BASE_ACTION_RULES = [
  { action: 'idle',   damage: '0',       note: 'Stand still — no damage, no meter change' },
  { action: 'jump',   damage: '0',       note: 'Evades hit; still hittable by shoot + ultimates; +3 meter on evade' },
  { action: 'hit',    damage: '10 dmg',  note: 'Close-range; +10 meter on hit; missed by jump/slide; blocked by defend' },
  { action: 'shoot',  damage: '8 dmg',   note: 'Projectile; +8 meter on hit; missed by slide; blocked by defend (hits jumpers)' },
  { action: 'slide',  damage: '0',       note: 'Evades hit AND shoot; half damage from ultimates; +5 meter' },
  { action: 'defend', damage: '0',       note: 'Blocks ALL hit + shoot; ultimates pierce full damage; +7 meter on block' },
];

const TEMPLATE_VARS = [
  { variable: '{N}',                description: 'Number of actions to return per turn.' },
  { variable: '{previous_actions}', description: 'Last batch moves as JSON [{Me, Opponent}].' },
  { variable: '{hp}',               description: 'Current HP for both fighters.' },
  { variable: '{meter}',            description: `Your current meter / ${METER.MAX}.` },
  { variable: '{moveset}',          description: "Your character's base actions + Ultimates." },
  { variable: '{opponent_moveset}', description: "Opponent's character and Ultimates." },
  { variable: '{game_rules}',       description: 'Full game rules text.' },
];

/**
 * Controlled prompt editor — no DB calls. All values passed as props.
 *
 * Props:
 *   name, prompt, character, provider, apiKey, model  — controlled values
 *   onChange(field, value)                             — called on any change
 *   disabled                                           — lock all inputs
 *   n                                                  — actions per turn (display only)
 */
export default function PromptEditor({ prompt, character, provider, apiKey, model, onChange, disabled, n = 3 }) {
  const currentChar = character ? CHARACTERS[character] : null;

  function handleCharacterChange(newCharId) {
    onChange('character', newCharId);
    if (!prompt || prompt === DEFAULT_PROMPT || Object.values(CHARACTER_OPTIONS).some(c => getCharacterTemplate(c.id) === prompt)) {
      onChange('prompt', getCharacterTemplate(newCharId) || DEFAULT_PROMPT);
    }
  }

  function handleLoadTemplate() {
    if (character) onChange('prompt', getCharacterTemplate(character) || DEFAULT_PROMPT);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Character select */}
      <div className="flex flex-col gap-1">
        <label className="section-label">Character</label>
        <select
          value={character || ''}
          onChange={e => handleCharacterChange(e.target.value)}
          disabled={disabled}
          className="arena-input arena-select"
        >
          <option value="">— pick a character —</option>
          {CHARACTER_OPTIONS.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.archetype})
            </option>
          ))}
        </select>
        {currentChar && (
          <div className="arena-panel p-3 mt-1 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-arena text-sm" style={{ color: 'var(--neon-gold)' }}>{currentChar.name}</span>
              <button
                onClick={handleLoadTemplate}
                disabled={disabled}
                className="btn-arena btn-arena-sm btn-arena-ghost"
              >
                Reset template
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{currentChar.description}</p>
            <div className="flex flex-col gap-0.5">
              <span className="section-label mb-0.5">Ultimates</span>
              {currentChar.ultimates.map(u => (
                <div key={u.key} className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--neon-gold)' }}>{u.name}</span>
                  <span> · cost </span>
                  <span style={{ color: 'var(--neon-blue, #00bfff)' }}>{u.meterCost}</span>
                  <span> · </span>
                  <span style={{ color: 'var(--neon-red)' }}>{u.damage} dmg</span>
                  {u.statusApplied && <span style={{ color: '#22cc66' }}> + {u.statusApplied}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Base action reference */}
      <details className="arena-panel overflow-hidden">
        <summary className="px-3 py-2 section-label cursor-pointer select-none hover:text-current">
          Base Action Reference
        </summary>
        <table className="w-full text-xs border-t" style={{ borderColor: 'var(--arena-panel-border)' }}>
          <tbody>
            {BASE_ACTION_RULES.map(r => (
              <tr key={r.action} className="border-b" style={{ borderColor: 'var(--arena-panel-border)' }}>
                <td className="px-3 py-1.5 font-mono font-bold w-16" style={{ color: 'var(--neon-gold)' }}>{r.action}</td>
                <td className="px-3 py-1.5 w-20" style={{ color: 'var(--neon-red)' }}>{r.damage}</td>
                <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)' }}>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {/* Template variables */}
      <details className="arena-panel overflow-hidden">
        <summary className="px-3 py-2 section-label cursor-pointer select-none">
          Template Variables
        </summary>
        <div className="divide-y" style={{ borderColor: 'var(--arena-panel-border)' }}>
          {TEMPLATE_VARS.map(v => (
            <div key={v.variable} className="px-3 py-2 flex items-start gap-3">
              <code className="text-sm font-mono shrink-0" style={{ color: '#22cc66' }}>{v.variable}</code>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{v.description}</span>
            </div>
          ))}
        </div>
      </details>

      {/* Strategy prompt textarea */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="section-label">Strategy Prompt</label>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>returns {n} action{n !== 1 ? 's' : ''} per turn</span>
        </div>
        <textarea
          className="arena-input arena-textarea"
          style={{ minHeight: 180 }}
          value={prompt || ''}
          onChange={e => onChange('prompt', e.target.value)}
          disabled={disabled}
          spellCheck={false}
        />
      </div>

      {/* Provider */}
      <div className="flex flex-col gap-1">
        <label className="section-label">AI Provider</label>
        <div className="flex gap-1">
          {Object.entries(PROVIDER_DEFAULTS).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => onChange('provider', key)}
              disabled={disabled}
              className={`provider-tab ${provider === key ? 'active' : ''}`}
            >
              {cfg.label}
              {key === 'groq' && <span className="ml-1 text-xs opacity-60">(free)</span>}
            </button>
          ))}
        </div>
      </div>

      {/* API Key */}
      <div className="flex flex-col gap-1">
        <label className="section-label">API Key</label>
        <input
          type="password"
          className="arena-input"
          placeholder={`Your ${PROVIDER_DEFAULTS[provider]?.label || ''} API key`}
          value={apiKey || ''}
          onChange={e => onChange('apiKey', e.target.value)}
          disabled={disabled}
          autoComplete="off"
        />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Your key never leaves your browser.
        </p>
      </div>

      {/* Model */}
      <div className="flex flex-col gap-1">
        <label className="section-label">Model <span style={{ color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
        <input
          type="text"
          className="arena-input font-mono text-sm"
          placeholder={PROVIDER_DEFAULTS[provider]?.placeholder}
          value={model || ''}
          onChange={e => onChange('model', e.target.value)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
