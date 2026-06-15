import { useRef } from 'react';
import VariableGuide from './VariableGuide.jsx';

// Advanced mode: the player authors the ENTIRE prompt. The VariableGuide lists
// every {token} (click to insert at the cursor, expand to see the data it
// becomes). engine/prompts.js substitutes them at fight time.
export default function PromptEditorAdvanced({ prompt, onChange, disabled }) {
  const taRef = useRef(null);

  function insertVariable(token) {
    const ta = taRef.current;
    if (!ta) {
      onChange(`${prompt}${token}`);
      return;
    }
    const start = ta.selectionStart ?? prompt.length;
    const end = ta.selectionEnd ?? prompt.length;
    const next = prompt.slice(0, start) + token + prompt.slice(end);
    onChange(next);
    // Restore caret just after the inserted token.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + token.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="section-label">Full Prompt</label>
        <textarea
          ref={taRef}
          className="arena-input arena-textarea"
          style={{ minHeight: 260, fontFamily: 'monospace', fontSize: '0.85rem' }}
          value={prompt}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          spellCheck={false}
        />
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          End with: return ONLY a JSON array of exactly 3 moves, e.g. ["hit", "defend_high", "super_move"].
        </p>
      </div>

      <div className="arena-divider" />

      <div className="flex flex-col gap-1">
        <div className="section-label mb-1">Runtime variables</div>
        <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
          Click a token to drop it at your cursor; expand “what’s inside” to see the data it becomes.
        </p>
        <VariableGuide onInsert={disabled ? undefined : insertVariable} />
      </div>
    </div>
  );
}
