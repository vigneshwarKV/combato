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
  // Arriving from the How-to-Play tour: pre-fill 3 example strategies and scroll
  // straight to the strategy section.
  const guide = params.get('guide') === '1';
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
    const base = { ...p, charId: p.charId || CHARS.find(c => !c.locked)?.id || null };
    // From the tour: seed three named example strategies, unless the player has
    // already written some of their own.
    if (guide && usableStrategies(base.strategies).length === 0) {
      return {
        ...base,
        strategies: [
          { name: 'Strategy 1', text: 'Rush in with hits and shoots to pressure them.' },
          { name: 'Strategy 2', text: 'Block high and low, then punish their whiffs.' },
          { name: 'Strategy 3', text: 'Read their pattern and counter, defend when low.' },
        ],
        activeStrategyIndex: 0,
      };
    }
    return withStrategyPrefill(base);
  });

  // Guided coach-mark tour on the guided path: name → fighter → strategies.
  const nameRef = useRef(null);
  const fighterRef = useRef(null);
  const strategyRef = useRef(null);
  const [guideStep, setGuideStep] = useState(guide ? 0 : null);

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
            <div ref={nameRef}>
              <label className="field-label">DISPLAY NAME</label>
              <input
                className="input setup-name-input"
                value={draft.handle || ''}
                onChange={e => setHandle(e.target.value.slice(0, 24))}
                placeholder="Your fighter name"
                maxLength={24}
              />
            </div>

            <div ref={fighterRef}>
              <div className="field-label" style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>CHARACTER</span>
                <span className="field-hint">
                  <Icon name="info" size={12} />&nbsp;Tap&nbsp;<b style={{ color: 'var(--gold)' }}>i</b>&nbsp;for details
                </span>
              </div>
              <div style={{ marginTop: 8 }}>
                <FighterPicker value={draft.charId} onChange={setCharId} />
              </div>
            </div>
          </SetupCard>

          <div ref={strategyRef}>
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

      {guideStep !== null && (() => {
        const guideSteps = [
          { ref: nameRef, title: 'Name your fighter', body: 'Type a display name to fight under.', can: nameReady, next: 'Next' },
          { ref: fighterRef, title: 'Pick your fighter', body: 'Choose the character you’ll play as.', can: fighterReady, next: 'Next' },
          { ref: strategyRef, title: 'Set your strategies', body: 'Tweak your game plans, then you’re ready.', can: canSave, next: 'Done' },
        ];
        const g = guideSteps[guideStep];
        return (
          <GuideCoach
            targetRef={g.ref}
            step={guideStep}
            total={guideSteps.length}
            title={g.title}
            body={g.body}
            nextLabel={g.next}
            canAdvance={g.can}
            onSkip={() => setGuideStep(null)}
            onNext={() => {
              if (guideStep < guideSteps.length - 1) setGuideStep(guideStep + 1);
              else { setGuideStep(null); save(); }
            }}
          />
        );
      })()}

    </div>
  );
}

// How far below the viewport top the target is scrolled, leaving room for the
// tooltip above it.
const GUIDE_TOP_MARGIN = 210;

// Coach-mark overlay: dims everything except the target element (four blocker
// panels around it, so only the hole is interactive), draws a highlight ring,
// and shows a step tooltip. Tracks the target's live position via rAF so it
// stays aligned through scrolling / layout shifts.
function GuideCoach({ targetRef, step, total, title, body, nextLabel, canAdvance, onNext, onSkip }) {
  const [rect, setRect] = useState(null);

  // Bring the target into view when the step changes — leave a top margin so the
  // tooltip (placed above the target) is on-screen, without over-scrolling.
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - GUIDE_TOP_MARGIN;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }, [targetRef, step]);

  // Keep the spotlight locked to the target every frame while active.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = targetRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetRef]);

  if (!rect) return null;
  const pad = 8;
  const hole = {
    top: Math.max(0, rect.top - pad),
    left: Math.max(0, rect.left - pad),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
  const vw = window.innerWidth;
  const tipW = Math.min(340, vw - 24);
  const tipLeft = Math.min(Math.max(hole.left, 12), vw - tipW - 12);
  // Sit the tooltip ABOVE the target (in the top margin left by the scroll);
  // fall back to below if the target is too near the top to fit above.
  const above = hole.top >= 168;
  const tipStyle = above
    ? { top: hole.top - 12, left: tipLeft, transform: 'translateY(-100%)' }
    : { top: hole.top + hole.height + 12, left: tipLeft };

  return (
    <div className="guide-coach">
      <div className="guide-dim" style={{ top: 0, left: 0, width: '100%', height: hole.top }} />
      <div className="guide-dim" style={{ top: hole.top + hole.height, left: 0, width: '100%', bottom: 0 }} />
      <div className="guide-dim" style={{ top: hole.top, left: 0, width: hole.left, height: hole.height }} />
      <div className="guide-dim" style={{ top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
      <div className="guide-ring" style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }} />
      <div className="guide-tip" style={{ ...tipStyle, width: tipW }}>
        <div className="guide-tip-step">Step {step + 1} of {total}</div>
        <div className="guide-tip-title">{title}</div>
        <div className="guide-tip-body">{body}</div>
        <div className="guide-tip-actions">
          <button className="guide-tip-skip" onClick={onSkip}>Skip</button>
          <button
            className="btn btn-sm"
            onClick={onNext}
            disabled={!canAdvance}
            style={!canAdvance ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {nextLabel}
          </button>
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
