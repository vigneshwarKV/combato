import { useState } from 'react';
import { ADVANCED_VARIABLES } from '../data/promptTemplates.js';

// Reference UI for the {variables} an advanced prompt can use. Pass `onInsert`
// to make each token clickable (drops it into the editor at the cursor); omit it
// for a read-only list (Simple mode — "here's what your AI sees each turn").
// Single source of truth is ADVANCED_VARIABLES in data/promptTemplates.js.
export default function VariableGuide({ onInsert }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {ADVANCED_VARIABLES.map(v => (
        <VariableCard key={v.token} v={v} onInsert={onInsert} />
      ))}
    </div>
  );
}

function VariableCard({ v, onInsert }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      border: '1px solid rgba(176, 82, 255, 0.22)',
      background: 'rgba(176, 82, 255, 0.04)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 9px', flexWrap: 'wrap',
      }}>
        {onInsert ? (
          <button
            type="button"
            className="var-chip"
            onClick={() => onInsert(v.token)}
            title="Insert at cursor"
          >
            {v.token}
          </button>
        ) : (
          <span className="var-chip" style={{ cursor: 'default' }}>{v.token}</span>
        )}
        <span style={{
          flex: 1, minWidth: 150, fontSize: 12,
          color: 'var(--ink-soft, #b9abd6)', lineHeight: 1.45,
        }}>
          {v.use}
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
            fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.04em',
            color: 'var(--plasma)', whiteSpace: 'nowrap',
          }}
        >
          {open ? 'HIDE ▲' : "WHAT'S INSIDE ▼"}
        </button>
      </div>
      {open && (
        <pre style={{
          margin: 0, padding: '9px 11px',
          borderTop: '1px solid rgba(176, 82, 255, 0.18)',
          fontFamily: 'var(--f-mono)', fontSize: 11, lineHeight: 1.5,
          color: 'var(--ink-soft, #b9abd6)', whiteSpace: 'pre-wrap',
          maxHeight: 300, overflow: 'auto',
        }}>{v.inside}</pre>
      )}
    </div>
  );
}
