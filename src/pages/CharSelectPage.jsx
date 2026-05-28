import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../components/design/Icons.jsx';
import { CharTile, CharDetail, MovesPanel } from '../components/design/DesignKit.jsx';
import {
  CHARS, BASE_MOVES, STRAT_VARS,
  loadProfile, saveProfile, charById,
} from '../data/designData.js';

export default function CharSelectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryTab = new URLSearchParams(location.search).get('tab');
  const initialTab = (location.state?.tab === 'strategy' || queryTab === 'strategy') ? 'strategy' : 'fighter';
  const [tab, setTab] = useState(initialTab);
  const [savedFlash, setSavedFlash] = useState(false);
  const [draft, setDraft] = useState(() => {
    const p = loadProfile();
    return {
      ...p,
      charId: p.charId || CHARS.find(c => !c.locked)?.id || null,
    };
  });

  useEffect(() => {
    document.body.classList.add('pk-design');
    return () => document.body.classList.remove('pk-design');
  }, []);

  const fighter = draft.charId ? charById(draft.charId) : null;
  const fighterReady = !!fighter && !fighter.locked;
  const strategyText = draft.strategyMode === 'advanced' ? draft.strategyAdvanced : draft.strategySimple;
  const strategyReady = strategyText.trim().length > 8;
  const canSave = fighterReady;

  function save() {
    if (!canSave || savedFlash) return;
    saveProfile(draft);
    setSavedFlash(true);
    const strategyEmpty = strategyText.trim().length === 0;
    const jumpToStrategy = tab === 'fighter' && strategyEmpty;
    setTimeout(() => {
      if (jumpToStrategy) {
        setSavedFlash(false);
        setTab('strategy');
      } else {
        navigate('/');
      }
    }, 750);
  }

  function setCharId(id) { setDraft(d => ({ ...d, charId: id })); }
  function setMode(m)    { setDraft(d => ({ ...d, strategyMode: m })); }
  function setSimple(s)  { setDraft(d => ({ ...d, strategySimple:   typeof s === 'function' ? s(d.strategySimple)   : s })); }
  function setAdv(s)     { setDraft(d => ({ ...d, strategyAdvanced: typeof s === 'function' ? s(d.strategyAdvanced) : s })); }

  return (
    <div className="bg-arena">
      <div className="spotlight-left" />
      <div className="spotlight-right" />

      <div className="topbar">
        <div className="topbar-brand" onClick={() => navigate('/')}>
          <span className="dot" />
          <span>PROMPT <span className="kk">K</span>OMBAT</span>
        </div>
        <div className="topbar-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
          <Icon name="back" size={12} />&nbsp;HOME
        </button>
      </div>

      <div className="setup-body">
        <div style={{ marginBottom: 4 }}>
          <div className="eyebrow">FIGHTER SETUP</div>
          <h1 className="f-display" style={{
            fontSize: 36, letterSpacing: '0.04em', color: 'var(--gold)',
            margin: '6px 0 4px', textTransform: 'uppercase', lineHeight: 1,
          }}>Build Your Loadout</h1>
          <p style={{ color: 'var(--ink-soft)', margin: 0, fontSize: 13 }}>
            Pick a character and write the strategy your AI will fight with.
          </p>
        </div>

        <div className="settings-tabs">
          <TabButton n="01" label="Fighter"  active={tab === 'fighter'}  ready={fighterReady}  onClick={() => setTab('fighter')} />
          <TabButton n="02" label="Strategy" active={tab === 'strategy'} ready={strategyReady} onClick={() => setTab('strategy')} />
        </div>

        {tab === 'fighter' && (
          <FighterPicker value={draft.charId} onChange={setCharId} />
        )}
        {tab === 'strategy' && (
          <StrategyEditor
            mode={draft.strategyMode} setMode={setMode}
            simple={draft.strategySimple} setSimple={setSimple}
            advanced={draft.strategyAdvanced} setAdvanced={setAdv}
          />
        )}

        <div className="setup-foot">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginLeft: 'auto' }}>
            {!fighterReady && !savedFlash && (
              <span className="f-mono" style={{ fontSize: 11, color: 'var(--ink-mute)' }}>
                Pick a fighter
              </span>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => navigate('/')}>CANCEL</button>
            <button
              className={`btn btn-sm ${savedFlash ? 'btn-saved' : ''}`}
              onClick={save}
              disabled={!canSave || savedFlash}
            >
              <Icon name="check" size={14} />&nbsp;{savedFlash ? 'SAVED' : 'SAVE'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

function TabButton({ n, label, active, ready, onClick }) {
  return (
    <button className={`settings-tab ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="num">{n}</span>
      <span>{label}</span>
      {ready && <span className="check"><Icon name="check" size={10} /></span>}
    </button>
  );
}

// ── Fighter tab ─────────────────────────────────────────────────────
function FighterPicker({ value, onChange }) {
  const [previewId, setPreviewId] = useState(null);
  const previewChar = previewId ? charById(previewId) : null;

  return (
    <div className="fighter-picker-grid-col">
      <div className="char-grid-mini">
        {CHARS.map(c => (
          <CharTile
            key={c.id}
            char={c}
            selected={value === c.id}
            onSelect={onChange}
            onInfo={setPreviewId}
          />
        ))}
      </div>

      {previewChar && (
        <div className="char-preview-overlay" role="dialog" aria-label="Fighter details">
          <button className="char-preview-back" onClick={() => setPreviewId(null)}>
            <Icon name="back" size={16} />&nbsp;BACK
          </button>
          <CharDetail char={previewChar} />
          <MovesPanel char={previewChar} moves={BASE_MOVES} />
          <button
            className="btn"
            style={{ marginTop: 12, width: '100%' }}
            onClick={() => { onChange(previewChar.id); setPreviewId(null); }}
          >
            <Icon name="check" size={14} />&nbsp;PICK {previewChar.name.toUpperCase()}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Strategy tab ────────────────────────────────────────────────────
function StrategyEditor({ mode, setMode, simple, setSimple, advanced, setAdvanced }) {
  const text = mode === 'simple' ? simple : advanced;
  const setText = mode === 'simple' ? setSimple : setAdvanced;

  function insertVar(v) {
    setAdvanced(prev => prev + ' ' + v);
  }

  const lineCount = text.split('\n').length;

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
        marginBottom: 8, gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">STRATEGY MODE</div>
          <div className="f-display" style={{
            fontSize: 22, letterSpacing: '0.04em', color: 'var(--ink)', marginTop: 2,
          }}>Battle Prompt</div>
        </div>
        <div className="mode-tabs">
          <button className={`mode-tab ${mode === 'simple' ? 'active' : ''}`} onClick={() => setMode('simple')}>Simple</button>
          <button className={`mode-tab ${mode === 'advanced' ? 'active' : ''}`} onClick={() => setMode('advanced')}>Advanced</button>
        </div>
      </div>

      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
        {mode === 'simple'
          ? 'Plain English. Tell the AI how to fight — the prompt builds itself.'
          : 'Full prompt access. Drop in {variables} to react to live state.'}
      </p>

      <div className="editor-wrap">
        <div className="editor-gutter">
          {Array.from({ length: Math.max(lineCount, 6) }).map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <textarea
          className="editor"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={mode === 'simple' ? 'Tell your AI how to fight…' : 'Write a full prompt. Use {variables} for live state…'}
          rows={Math.max(lineCount, 6)}
        />
      </div>

      {mode === 'advanced' && (
        <>
          <div className="eyebrow" style={{ marginTop: 12, marginBottom: 6 }}>RUNTIME VARIABLES</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STRAT_VARS.map(v => (
              <span key={v.v} className="var-chip" onClick={() => insertVar(v.v)} title={v.desc}>
                {v.v}
              </span>
            ))}
          </div>
        </>
      )}

      <div style={{
        marginTop: 10, fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-mute)',
      }}>
        <span>{text.length} chars · {lineCount} lines</span>
      </div>
    </div>
  );
}
