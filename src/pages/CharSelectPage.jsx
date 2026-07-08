import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../components/design/Icons.jsx';
import { CharTile, CharDetail, MovesPanel } from '../components/design/DesignKit.jsx';
import AssetPreloadModal from '../components/AssetPreloadModal.jsx';
import {
  CHARS, BASE_MOVES,
  loadProfile, saveProfile, charById,
  randomSimpleStrategy, makeStrategy, usableStrategies, strategyLabel,
  MAX_STRATEGIES,
} from '../data/designData.js';
import { CHARACTERS } from '../data/characters.js';
import { preloadAll, isPreloaded } from '../engine/assetPreloader.js';

export default function CharSelectPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  // Where to send the player after saving. Defaults home; a relative path can be
  // passed (e.g. ?returnTo=/room/A4K9P2) so setup can round-trip back to a room.
  const rawReturn = params.get('returnTo');
  const returnTo = rawReturn && rawReturn.startsWith('/') ? rawReturn : '/';
  const [savedFlash, setSavedFlash] = useState(false);

  // Ensure the first strategy slot is never blank: prefill it with a random
  // suggestion so the editor always shows an example. Only touches the in-memory
  // draft — it is persisted exclusively when the player clicks Save.
  function withStrategyPrefill(profile) {
    const strategies = Array.isArray(profile.strategies) && profile.strategies.length > 0
      ? profile.strategies
      : [makeStrategy(0)];
    const first = strategies[0];
    if (!first.text || !first.text.trim()) {
      return {
        ...profile,
        strategies: [{ ...first, text: randomSimpleStrategy() }, ...strategies.slice(1)],
      };
    }
    return { ...profile, strategies };
  }

  const [draft, setDraft] = useState(() => {
    const p = loadProfile();
    return withStrategyPrefill({
      ...p,
      charId: p.charId || CHARS.find(c => !c.locked)?.id || null,
    });
  });

  useEffect(() => {
    document.body.classList.add('pk-design');
    return () => document.body.classList.remove('pk-design');
  }, []);

  // ── Mandatory one-time asset preload ──────────────────────────────────────
  // Opening setup is the gate: we download every playable fighter, sound and
  // effect up front so battles never stutter while assets stream in. Runs once
  // per page-load (the Service Worker keeps the bytes across reloads), shows a
  // blocking progress modal, and offers retry / continue-anyway on failure.
  const [preload, setPreload] = useState(() =>
    isPreloaded()
      ? { active: false, status: 'done', done: 0, total: 0 }
      : { active: true, status: 'loading', done: 0, total: 0 },
  );
  const abortRef = useRef(null);

  // Kick off the async preload. State updates happen only in async callbacks
  // (onProgress / then / catch), never synchronously — the synchronous
  // "loading" reset lives in runPreload (the retry handler) instead.
  function startPreload() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // Only the playable (unlocked) roster — locked fighters can never enter a fight.
    const fightChars = CHARS.filter(c => !c.locked).map(c => CHARACTERS[c.id]).filter(Boolean);
    preloadAll({
      characters: fightChars,
      signal: controller.signal,
      onProgress: (done, total) => setPreload(p => (p.status === 'loading' ? { ...p, done, total } : p)),
    })
      .then(() => setPreload({ active: false, status: 'done', done: 1, total: 1 }))
      .catch(err => {
        if (err?.name === 'AbortError') return;
        setPreload(p => ({ ...p, status: 'error' }));
      });
  }

  // Retry handler (event-driven): reset to loading, then restart.
  function runPreload() {
    setPreload({ active: true, status: 'loading', done: 0, total: 0 });
    startPreload();
  }

  function continuePreloadAnyway() {
    abortRef.current?.abort();
    setPreload({ active: false, status: 'done', done: 0, total: 0 });
  }

  useEffect(() => {
    // Initial state is already 'loading' when not preloaded, so just start the
    // work here — no synchronous setState in the effect body.
    if (!isPreloaded()) startPreload();
    return () => abortRef.current?.abort();
  }, []);

  const fighter = draft.charId ? charById(draft.charId) : null;
  const fighterReady = !!fighter && !fighter.locked;
  const nameReady = (draft.handle || '').trim().length > 0;
  const draftStrategies = Array.isArray(draft.strategies) && draft.strategies.length > 0
    ? draft.strategies
    : [makeStrategy(0)];
  const strategyReady = usableStrategies(draftStrategies).length > 0;
  const canSave = fighterReady && nameReady && !preload.active;

  function save() {
    if (!canSave || savedFlash) return;
    // Drop empty trailing slots and clamp the active index into range.
    const kept = draftStrategies.filter(s => (s.text || '').trim().length > 0);
    const strategies = kept.length > 0 ? kept : [draftStrategies[0]];
    const activeStrategyIndex = Math.min(draft.activeStrategyIndex ?? 0, strategies.length - 1);
    const cleaned = {
      ...draft,
      handle: (draft.handle || '').trim(),
      strategies,
      activeStrategyIndex,
    };
    saveProfile(cleaned);
    setSavedFlash(true);
    setTimeout(() => navigate(returnTo), 750);
  }

  function setHandle(h)  { setDraft(d => ({ ...d, handle: h })); }
  function setCharId(id) { setDraft(d => ({ ...d, charId: id })); }

  function updateStrategy(index, patch) {
    setDraft(d => {
      const list = (Array.isArray(d.strategies) && d.strategies.length > 0 ? d.strategies : [makeStrategy(0)]).slice();
      list[index] = { ...list[index], ...patch };
      return { ...d, strategies: list };
    });
  }
  function addStrategy() {
    setDraft(d => {
      const list = (Array.isArray(d.strategies) ? d.strategies : []).slice();
      if (list.length >= MAX_STRATEGIES) return d;
      list.push(makeStrategy(list.length));
      return { ...d, strategies: list };
    });
  }
  function removeStrategy(index) {
    setDraft(d => {
      const list = (Array.isArray(d.strategies) ? d.strategies : []).slice();
      if (list.length <= 1) return d;
      list.splice(index, 1);
      const active = Math.min(d.activeStrategyIndex ?? 0, list.length - 1);
      return { ...d, strategies: list, activeStrategyIndex: active };
    });
  }

  return (
    <div className="bg-arena">
      {preload.active && (
        <AssetPreloadModal
          done={preload.done}
          total={preload.total}
          status={preload.status}
          onRetry={runPreload}
          onContinue={continuePreloadAnyway}
        />
      )}
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
        <div className="setup-head">
          <div>
            <div className="eyebrow">FIGHTER SETUP</div>
            <h1 className="setup-title">Build Your Loadout</h1>
            <p className="setup-sub">Name your fighter, pick a character, and write the strategies your AI plays with.</p>
          </div>
        </div>

        {/* Everything on one view: identity on the left, strategies on the right. */}
        <div className="setup-grid">
          <SetupCard n={1} title="Your Fighter" done={fighterReady && nameReady}>
            <label className="field-label">DISPLAY NAME</label>
            <input
              className="input setup-name-input"
              value={draft.handle || ''}
              onChange={e => setHandle(e.target.value.slice(0, 24))}
              placeholder="Your fighter name"
              maxLength={24}
            />

            <div className="field-label" style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>CHARACTER</span>
              <span className="field-hint">
                <Icon name="info" size={12} />&nbsp;Tap&nbsp;<b style={{ color: 'var(--gold)' }}>i</b>&nbsp;for details
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              <FighterPicker value={draft.charId} onChange={setCharId} />
            </div>
          </SetupCard>

          <SetupCard
            n={2}
            title="Your Strategies"
            done={strategyReady}
            headerAside={
              <span className="setup-card-badge">
                {usableStrategies(draftStrategies).length}/{MAX_STRATEGIES}
              </span>
            }
          >
            <StrategyEditor
              strategies={draftStrategies}
              onUpdate={updateStrategy}
              onAdd={addStrategy}
              onRemove={removeStrategy}
            />
          </SetupCard>
        </div>

        <div className="setup-foot">
          <div className="setup-foot-status">
            {!savedFlash && !canSave && (
              <span className="f-mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                {!nameReady ? 'Enter your name to continue'
                  : !fighterReady ? 'Pick a fighter to continue'
                  : 'Finishing up…'}
              </span>
            )}
            {!savedFlash && canSave && !strategyReady && (
              <span className="f-mono" style={{ fontSize: 11.5, color: 'var(--ink-mute)' }}>
                Tip: add a strategy so your AI has a game plan
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => navigate('/')}>CANCEL</button>
            <button
              className={`btn btn-sm ${savedFlash ? 'btn-saved' : ''}`}
              onClick={save}
              disabled={!canSave || savedFlash}
            >
              <Icon name="check" size={14} />&nbsp;{savedFlash ? 'SAVED' : 'SAVE & CONTINUE'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}

// A titled section card with a numbered badge that turns into a check when the
// section is complete — gives the single-view setup clear at-a-glance progress.
function SetupCard({ n, title, done, headerAside, children }) {
  return (
    <section className="setup-card">
      <div className="setup-card-head">
        <span className={`setup-card-num ${done ? 'done' : ''}`}>
          {done ? <Icon name="check" size={14} /> : n}
        </span>
        <span className="setup-card-title">{title}</span>
        {headerAside && <span style={{ marginLeft: 'auto' }}>{headerAside}</span>}
      </div>
      {children}
    </section>
  );
}

// ── Fighter picker ─────────────────────────────────────────────────────
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
          <div className="char-preview-cols">
            <CharDetail char={previewChar} />
            <MovesPanel char={previewChar} moves={BASE_MOVES} />
          </div>
          <button
            className="btn char-preview-pick"
            onClick={() => { onChange(previewChar.id); setPreviewId(null); }}
          >
            <Icon name="check" size={14} />&nbsp;PICK {previewChar.name.toUpperCase()}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Strategy editor ─────────────────────────────────────────────────
// Up to MAX_STRATEGIES plain-language strategies. Each gets a short name and a
// body. During a fight the player switches between them from the arena — the
// selected one drives the next batch of moves.

function StrategyEditor({ strategies, onUpdate, onAdd, onRemove }) {
  return (
    <div>
      <p style={{ margin: '0 0 6px', fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
        Write up to {MAX_STRATEGIES} strategies and switch between them mid-fight. Your pick auto-applies every 3 moves.
      </p>
      <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
        Valid moves: <span style={{ color: 'var(--gold)' }}>hit, shoot, slide, jump, defend high, defend low, super move</span>
      </p>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
        Can react to both fighters’ <span style={{ color: 'var(--gold)' }}>HP, super meter, recent moves, and each move’s damage</span>
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {strategies.map((s, i) => (
          <StrategySlot
            key={i}
            index={i}
            strategy={s}
            canRemove={strategies.length > 1}
            onUpdate={patch => onUpdate(i, patch)}
            onRemove={() => onRemove(i)}
          />
        ))}
      </div>

      {strategies.length < MAX_STRATEGIES && (
        <button
          type="button"
          className="setup-add-strategy"
          onClick={onAdd}
        >
          <span className="setup-add-plus">+</span> ADD ANOTHER STRATEGY
        </button>
      )}
    </div>
  );
}

function StrategySlot({ index, strategy, canRemove, onUpdate, onRemove }) {
  const text = strategy.text || '';
  return (
    <div className="strat-slot">
      <div className="strat-slot-head">
        <span className="strat-num">{index + 1}</span>
        <input
          className="strat-name"
          value={strategy.name || ''}
          onChange={e => onUpdate({ name: e.target.value.slice(0, 20) })}
          placeholder={strategyLabel(strategy, index)}
          maxLength={20}
          aria-label={`Strategy ${index + 1} name`}
        />
        {canRemove && (
          <button
            type="button"
            className="strat-remove"
            onClick={onRemove}
            aria-label={`Remove strategy ${index + 1}`}
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>

      <textarea
        className="strat-textarea"
        value={text}
        onChange={e => onUpdate({ text: e.target.value })}
        placeholder="e.g. Defend until my meter is full, then land a super move."
        rows={3}
      />
    </div>
  );
}
