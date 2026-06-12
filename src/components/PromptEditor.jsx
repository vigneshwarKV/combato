import { DEFAULT_PROMPT, CHARACTER_OPTIONS, getCharacterTemplate, ADVANCED_VARIABLES } from '../data/promptTemplates.js';
import { CHARACTERS } from '../data/characters.js';

const BASE_ACTION_RULES = [
  { action: 'idle',       damage: '0',       note: 'Stand still — no damage, no meter change' },
  { action: 'jump',       damage: '0',       note: 'Evades hit; still hittable by shoot + super_move; +3 meter on evade' },
  { action: 'hit',         damage: '10 dmg', note: 'Close-range (HIGH line); +10 meter on hit; missed by jump/slide; blocked by defend_high (rush/projectile hits are LOW → defend_low)' },
  { action: 'shoot',       damage: '8 dmg',  note: 'Projectile (LOW line); +8 meter on hit; missed by jump; blocked by defend_low' },
  { action: 'slide',       damage: '0',      note: 'Low tackle (LOW line); evades hit; caught by fast shoot; blocked by defend_low; +5 meter' },
  { action: 'defend_high', damage: '0',      note: 'HIGH guard — blocks regular hit + AIRBORNE supers; +7 meter on block' },
  { action: 'defend_low',  damage: '0',      note: 'LOW guard — blocks shoot, slide, rush/projectile hits + GROUNDED supers; +7 meter on block' },
  { action: 'super_move',  damage: 'varies', note: 'Your character special — blocked by the matching guard (airborne→defend_high, grounded→defend_low); only usable when charged' },
];

const TEMPLATE_VARS = ADVANCED_VARIABLES.map(v => ({ variable: v.token, description: v.desc }));

/**
 * Controlled prompt editor — no DB calls. All values passed as props.
 *
 * Props:
 *   name, prompt, character  — controlled values
 *   onChange(field, value)   — called on any change
 *   disabled                 — lock all inputs
 *   n                        — actions per turn (display only)
 */
export default function PromptEditor({ prompt, character, onChange, disabled, n = 3 }) {
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
              <span className="section-label mb-0.5">super_move</span>
              {currentChar.ultimates.slice(0, 1).map(u => (
                <div key={u.key} className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--neon-gold)' }}>super_move</span>
                  <span> · </span>
                  <span style={{ color: 'var(--neon-red)' }}>{u.damage} dmg</span>
                  {u.heals && <span style={{ color: '#22cc66' }}> + heal {u.heals}</span>}
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
    </div>
  );
}
