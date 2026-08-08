import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../components/design/Icons.jsx';
import CharacterPreview from '../components/CharacterPreview.jsx';
import { CharSprite, MovesTable } from '../components/design/DesignKit.jsx';
import AssetPreloadModal from '../components/AssetPreloadModal.jsx';
import {
  CHARS,
  loadProfile, saveProfile, charById,
  randomSimpleStrategy, makeStrategy, strategyLabel,
  MAX_STRATEGIES,
} from '../data/designData.js';
import { CHARACTERS } from '../data/characters.js';
import { preloadAll, isPreloaded } from '../engine/assetPreloader.js';

// Only the unlocked fighters can be stepped through in the carousel; the roster
// gallery still lists the locked ones (rendered disabled).
const PLAYABLE = CHARS.filter(c => !c.locked);

// Stable fingerprint of the editable loadout (fighter + strategy name/text), so
// we can tell whether the player actually changed anything before leaving.
function loadoutSnapshot(d) {
  return JSON.stringify({
    charId: d.charId || null,
    strategies: (Array.isArray(d.strategies) ? d.strategies : []).map(s => ({ name: s.name || '', text: s.text || '' })),
  });
}

// Three player-facing bars, mapped from the engine ratings (0–100). Hex colours
// (not CSS vars) so the glow `${color}66` suffix is valid.
function statBars(char) {
  const s = char.stats || {};
  return [
    { label: 'POWER',   value: s.atk ?? 0, color: '#ff3a4f' },
    { label: 'DEFENCE', value: s.def ?? 0, color: '#4ad7ff' },
    { label: 'METER',   value: s.spm ?? 0, color: '#ffd84a' },
  ];
}

function guardChip(char) {
  const by = k => (char.moves || []).find(m => m.key === k) || {};
  return '▾' + (by('defend_high').throwbackDmg ?? by('defend_low').throwbackDmg ?? 0);
}

// Idle sprite for a stage. Mirrors CharDetail's renderer split: spine fighters
// play their live idle through PIXI; PNG fighters loop idle frames through the
// lightweight <img> swapper; anything without assets falls back to a monogram.
function FighterStage({ char }) {
  const engine = CHARACTERS[char.id];
  if (engine?.renderMode === 'spine') {
    return (
      <div className="char-detail-spine">
        <CharacterPreview characterId={char.id} width={260} height={220} mode="idle" />
      </div>
    );
  }
  if (char.thumb) return <CharSprite char={char} active={false} />;
  return <span className="su-fcard-initial">{char.name[0]}</span>;
}

function StatBars({ char }) {
  return (
    <div className="su-bars">
      {statBars(char).map(b => (
        <div className="su-bar" key={b.label}>
          <span className="su-bar-label">{b.label}</span>
          <span className="su-bar-track">
            <span className="su-bar-fill" style={{ width: `${b.value}%`, background: b.color, boxShadow: `0 0 6px ${b.color}66` }} />
          </span>
          <span className="su-bar-val">{b.value}</span>
        </div>
      ))}
    </div>
  );
}

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
    const base = { ...p, charId: p.charId || PLAYABLE[0]?.id || null };
    return withStrategyPrefill(base);
  });

  // null | 'detail' (expanded fighter) | 'switch' (roster gallery)
  const [picker, setPicker] = useState(null);
  const touchX = useRef(null);

  // Baseline of the initial (post-prefill) loadout, captured once — so `dirty`
  // reflects only the player's own edits, not the random first-strategy prefill.
  const [initialSnapshot] = useState(() => loadoutSnapshot(draft));
  const [leavePrompt, setLeavePrompt] = useState(false);

  useEffect(() => {
    document.body.classList.add('pk-design');
    return () => document.body.classList.remove('pk-design');
  }, []);

  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if (picker) setPicker(null);
      else if (leavePrompt) setLeavePrompt(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker, leavePrompt]);

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

  function startPreload() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
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

  function runPreload() {
    setPreload({ active: true, status: 'loading', done: 0, total: 0 });
    startPreload();
  }

  function continuePreloadAnyway() {
    abortRef.current?.abort();
    setPreload({ active: false, status: 'done', done: 0, total: 0 });
  }

  useEffect(() => {
    if (!isPreloaded()) startPreload();
    return () => abortRef.current?.abort();
  }, []);

  const fighter = charById(draft.charId) || PLAYABLE[0];
  const fighterReady = !!fighter && !fighter.locked;
  const canSave = fighterReady && !preload.active;

  const draftStrategies = Array.isArray(draft.strategies) && draft.strategies.length > 0
    ? draft.strategies
    : [makeStrategy(0)];
  const activeIdx = Math.min(draft.activeStrategyIndex ?? 0, draftStrategies.length - 1);
  const activePlan = draftStrategies[activeIdx] || makeStrategy(0);
  const dirty = loadoutSnapshot(draft) !== initialSnapshot;

  function setCharId(id) {
    const c = charById(id);
    if (!c || c.locked) return;
    setDraft(d => ({ ...d, charId: id }));
  }

  function step(dir) {
    const i = PLAYABLE.findIndex(c => c.id === draft.charId);
    const n = ((i < 0 ? 0 : i) + dir + PLAYABLE.length) % PLAYABLE.length;
    setCharId(PLAYABLE[n].id);
  }

  function setActiveStrategy(i) {
    setDraft(d => ({ ...d, activeStrategyIndex: i }));
  }
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
      return { ...d, strategies: list, activeStrategyIndex: list.length - 1 };
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
  function fillExample(index) {
    const cur = draftStrategies[index]?.text || '';
    let sample = randomSimpleStrategy();
    for (let k = 0; k < 4 && sample === cur; k++) sample = randomSimpleStrategy();
    updateStrategy(index, { text: sample });
  }

  // Build the persisted profile from the draft: drop empty strategy slots and
  // clamp the active index. handle is collected elsewhere now — pass through.
  function cleanedProfile() {
    const kept = draftStrategies.filter(s => (s.text || '').trim().length > 0);
    const strategies = kept.length > 0 ? kept : [draftStrategies[0]];
    const activeStrategyIndex = Math.min(draft.activeStrategyIndex ?? 0, strategies.length - 1);
    return { ...draft, handle: (draft.handle || '').trim(), strategies, activeStrategyIndex };
  }

  function save() {
    if (!canSave || savedFlash) return;
    saveProfile(cleanedProfile());
    setSavedFlash(true);
    setTimeout(() => navigate(returnTo), 750);
  }

  // Leaving via HOME: warn only when there are unsaved edits.
  function goHome() {
    if (dirty && !savedFlash) setLeavePrompt(true);
    else navigate('/');
  }
  function saveAndLeave() {
    saveProfile(cleanedProfile());
    navigate('/');
  }
  function discardAndLeave() {
    navigate('/');
  }

  return (
    <div className="bg-arena su-page">
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

      <div className="topbar su-topbar">
        <div className="topbar-brand" onClick={goHome}>
          <span>PROMPT <span className="kk">K</span>OMBAT</span>
        </div>
        <div className="topbar-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={goHome}>
          <Icon name="back" size={12} />&nbsp;HOME
        </button>
      </div>

      <div className="su-main">
        {/* ── Fighter carousel ──────────────────────────────────── */}
        <div className="su-fighter-col">
          <div
            className="su-carousel"
            onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              if (touchX.current == null) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              touchX.current = null;
              if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
            }}
          >
            <button className="su-arrow" onClick={() => step(-1)} aria-label="Previous fighter">
              <Icon name="back" size={16} />
            </button>

            <div className="su-fcard">
              <span className="su-fcard-strip" />
              <div className="su-fcard-stage">
                <FighterStage key={fighter.id} char={fighter} />
                <button className="su-fcard-expand" onClick={() => setPicker('detail')} aria-label="Expand fighter details">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>
                </button>
              </div>
              <div className="su-fcard-foot">
                <div className="su-fcard-name">{fighter.name}</div>
                <StatBars char={fighter} />
              </div>
            </div>

            <button className="su-arrow" onClick={() => step(1)} aria-label="Next fighter">
              <Icon name="arrow" size={16} />
            </button>
          </div>

          <button className="su-roster-btn" onClick={() => setPicker('switch')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="7" height="7" /><rect x="14" y="4" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
            FIGHTER COLLECTION
          </button>
        </div>

        {/* ── Game plan ─────────────────────────────────────────── */}
        <div className="su-plan-col">
          <div className="su-plan-title">YOUR GAME PLAN</div>

          <div className="su-plan-tabs">
            {draftStrategies.map((p, i) => (
              <div key={i} className={`su-tab ${i === activeIdx ? 'is-active' : ''}`}>
                <button className="su-tab-btn" onClick={() => setActiveStrategy(i)}>PLAN {i + 1}</button>
                {draftStrategies.length > 1 && (
                  <button className="su-tab-x" onClick={() => removeStrategy(i)} aria-label="Delete this plan">
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            ))}
            {draftStrategies.length < MAX_STRATEGIES && (
              <button className="su-tab-add" onClick={addStrategy} aria-label="Add another plan">
                <Icon name="plus" size={15} />
              </button>
            )}
          </div>

          <div className="su-plan-editor">
            <div className="su-plan-nrow">
              <label className="su-plan-nlabel">STRATEGY NAME</label>
              <input
                className="su-plan-name"
                value={activePlan.name || ''}
                onChange={e => updateStrategy(activeIdx, { name: e.target.value.slice(0, 20) })}
                placeholder={strategyLabel(activePlan, activeIdx)}
                maxLength={20}
                aria-label={`Strategy ${activeIdx + 1} name`}
              />
            </div>
            <div className="su-plan-textwrap">
              <textarea
                className="su-plan-text"
                value={activePlan.text || ''}
                onChange={e => updateStrategy(activeIdx, { text: e.target.value.slice(0, 240) })}
                placeholder="e.g. Defend until my meter is full, then land a super move."
              />
              <button className="su-plan-example" onClick={() => fillExample(activeIdx)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 4l3 3-3 3M20 7h-4a3 3 0 0 0-3 3" /><path d="M7 20l-3-3 3-3M4 17h4a3 3 0 0 0 3-3" /></svg>
                example
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="su-foot">
        {!canSave && !savedFlash && (
          <span className="su-foot-hint f-mono">
            {preload.active ? 'Loading fighters…' : 'Pick a fighter to continue'}
          </span>
        )}
        <div className="su-foot-spacer" />
        <button
          className={`btn btn-sm btn-cyan su-save ${savedFlash ? 'btn-saved' : ''}`}
          onClick={save}
          disabled={!canSave || savedFlash}
        >
          <Icon name="check" size={13} />&nbsp;{savedFlash ? 'SAVED' : 'SAVE & FIGHT'}
        </button>
      </div>

      {/* ── Expanded fighter detail ─────────────────────────────── */}
      {picker === 'detail' && (
        <div className="su-modal-backdrop" onClick={() => setPicker(null)}>
          <div className="su-modal su-modal--detail" onClick={e => e.stopPropagation()}>
            <div className="su-modal-head">
              <div className="su-modal-title">{fighter.name}</div>
              <div className="topbar-spacer" />
              <button className="su-modal-x" onClick={() => setPicker(null)} aria-label="Close">
                <Icon name="close" size={17} />
              </button>
            </div>
            <div className="su-detail-body">
              <div className="su-detail-moves">
                <MovesTable char={fighter} fill />
                <p className="su-detail-note">
                  Numbers are damage dealt. <span className="su-guard-chip">{guardChip(fighter)}</span> = what an attacker
                  loses on your guard. <span className="su-super-word">Super move</span> fires at 100 meter.
                </p>
              </div>
              <div className="su-detail-side">
                <div className="su-fcard su-fcard--static">
                  <span className="su-fcard-strip" />
                  <div className="su-fcard-stage">
                    <FighterStage key={fighter.id} char={fighter} />
                  </div>
                  <div className="su-fcard-foot">
                    <div className="su-fcard-name">{fighter.name}</div>
                    <StatBars char={fighter} />
                  </div>
                </div>
                <button className="su-modal-close-btn" onClick={() => setPicker(null)}>CLOSE</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Roster gallery ──────────────────────────────────────── */}
      {picker === 'switch' && (
        <RosterGallery
          initialId={draft.charId}
          onConfirm={id => { setCharId(id); setPicker(null); }}
          onClose={() => setPicker(null)}
        />
      )}

      {/* ── Unsaved-changes prompt on HOME ──────────────────────── */}
      {leavePrompt && (
        <div className="su-confirm-backdrop" onClick={() => setLeavePrompt(false)}>
          <div className="su-confirm" onClick={e => e.stopPropagation()} role="dialog" aria-label="Unsaved changes">
            <div className="su-confirm-title">Save your changes?</div>
            <p className="su-confirm-body">You have unsaved changes to your loadout.</p>
            <div className="su-confirm-actions">
              <button className="btn btn-sm btn-ghost" onClick={discardAndLeave}>CANCEL</button>
              <button className="btn btn-sm btn-cyan su-save" onClick={saveAndLeave}>
                <Icon name="check" size={13} />&nbsp;SAVE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Roster gallery overlay. The chosen fighter is provisional — held in local
// state and only committed to the draft via onConfirm ("FIGHT AS …"). Closing
// (X / backdrop / Esc) unmounts this and discards the provisional pick, so a
// stray tap on another fighter never sticks unless the player confirms it.
function RosterGallery({ initialId, onConfirm, onClose }) {
  const [pick, setPick] = useState(initialId);
  const sel = charById(pick) || charById(initialId) || PLAYABLE[0];
  return (
    <div className="su-modal-backdrop" onClick={onClose}>
      <div className="su-modal su-modal--gallery" onClick={e => e.stopPropagation()}>
        <div className="su-modal-head">
          <div className="su-modal-title">Choose your fighter</div>
          <div className="topbar-spacer" />
          <button className="su-modal-x" onClick={onClose} aria-label="Close">
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="su-gallery-body">
          <div className="su-gallery-grid-wrap">
            <div className="su-gallery-grid">
              {CHARS.map(c => {
                const on = c.id === sel.id;
                return (
                  <button
                    key={c.id}
                    className={`su-gtile ${on ? 'is-sel' : ''} ${c.locked ? 'is-locked' : ''}`}
                    onClick={() => { if (!c.locked) setPick(c.id); }}
                  >
                    <div className="su-gtile-stage">
                      <FighterStage char={c} />
                    </div>
                    <div className="su-gtile-foot">
                      <div className="su-gtile-name">{c.name}</div>
                      <div className="su-gtile-bars">
                        {statBars(c).map(b => (
                          <div className="su-gbar" key={b.label}>
                            <span className="su-gbar-label">{b.label}</span>
                            <span className="su-gbar-track">
                              <span className="su-gbar-fill" style={{ width: `${b.value}%`, background: b.color }} />
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {c.locked && (
                      <span className="su-gtile-lock"><Icon name="lock" size={19} /></span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="su-gallery-side">
            <div className="su-gallery-side-head">
              MOVES · <span className="su-super-word" style={{ color: 'var(--cyan)' }}>{sel.name}</span>
            </div>
            <div className="su-gallery-side-body">
              <MovesTable char={sel} />
            </div>
            <div className="su-gallery-side-foot">
              <button className="su-gallery-confirm" onClick={() => onConfirm(sel.id)}>
                FIGHT AS {sel.name.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
