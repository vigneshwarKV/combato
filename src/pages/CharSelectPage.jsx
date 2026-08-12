import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../components/design/Icons.jsx';
import CharacterPreview from '../components/CharacterPreview.jsx';
import { CharSprite, MovesTable } from '../components/design/DesignKit.jsx';
import AssetPreloadModal from '../components/AssetPreloadModal.jsx';
import PlanEditor from '../components/design/PlanEditor.jsx';
import {
  CHARS,
  loadProfile, saveProfile, charById, isProfileReady,
  randomSimpleStrategy, makeStrategy, defaultStrategies, strategyLabel,
  MAX_STRATEGIES,
} from '../data/designData.js';
import { CHARACTERS } from '../data/characters.js';
import { FIGHT_TIME_LIMIT_MS } from '../engine/fightEngine.js';
import { preloadAll, isPreloaded } from '../engine/assetPreloader.js';

// Only the unlocked fighters can be stepped through in the carousel; the roster
// gallery still lists the locked ones (rendered disabled).
const PLAYABLE = CHARS.filter(c => !c.locked);

// The match clock, in words, straight from the engine — the rules popup states
// it, and it's been retuned before (currently 90s, not the round 2 minutes).
function fightTimeLimitLabel() {
  const total = Math.round(FIGHT_TIME_LIMIT_MS / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (!mins) return `${secs} seconds`;
  return secs ? `${mins} min ${secs} sec` : `${mins} minute${mins > 1 ? 's' : ''}`;
}

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

  // No strategy prefill here any more: loadProfile() guarantees three filled
  // plans (Attack / Defend / Adapt), and a default that matches its slot's name
  // beats the random sample that used to be dropped into PLAN 1 — the "example"
  // button below is still there for players who want a random one.
  const [draft, setDraft] = useState(() => {
    const p = loadProfile();
    // Always open on plan 1 — it's the plan the match starts on, and the green
    // pill says so. Landing on whichever plan was edited last made the green
    // move around for no reason the player could see.
    return { ...p, charId: p.charId || PLAYABLE[0]?.id || null, activeStrategyIndex: 0 };
  });

  // null | 'detail' (expanded fighter) | 'switch' (roster gallery)
  const [picker, setPicker] = useState(null);
  // Plan pill being dragged in the switcher bar (see moveStrategy).
  const [dragIdx, setDragIdx] = useState(null);
  // Kept out of `picker` so opening the rules can't disturb a fighter modal.
  const [rulesOpen, setRulesOpen] = useState(false);
  const touchX = useRef(null);

  // Baseline of the loadout as it was loaded, captured once — so `dirty` reflects
  // only the player's own edits.
  const [initialSnapshot] = useState(() => loadoutSnapshot(draft));
  const [leavePrompt, setLeavePrompt] = useState(false);

  useEffect(() => {
    document.body.classList.add('pk-design');
    return () => document.body.classList.remove('pk-design');
  }, []);

  // Visiting setup is enough to count as set up — the gate no longer waits for
  // SAVE. loadProfile() already hands back three filled plans, and the carousel
  // opens on a real fighter, so the only thing a never-saved profile is missing
  // is charId: commit exactly the loadout that's on screen (same fallback as the
  // `draft` initializer above) on arrival. Before this, a player who browsed
  // setup and went back still hit "Set up your fighter first" on home.
  // Mount only — everything after this is the SAVE button's job.
  useEffect(() => {
    const p = loadProfile();
    if (isProfileReady(p)) return;
    saveProfile({
      ...p,
      charId: p.charId || PLAYABLE[0]?.id || null,
      handle: (p.handle || '').trim(),
    });
  }, []);

  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return;
      // Rules sit above the fighter modals, so they close first.
      if (rulesOpen) setRulesOpen(false);
      else if (picker) setPicker(null);
      else if (leavePrompt) setLeavePrompt(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker, leavePrompt, rulesOpen]);

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

  const draftStrategies = Array.isArray(draft.strategies) && draft.strategies.length > 0
    ? draft.strategies
    : defaultStrategies();
  // A blank plan is caught here rather than filtered out at fight time: saving
  // one used to leave a tab in setup with no matching arena button and no
  // explanation. Either write something in it or delete the tab (✕).
  const emptyPlanIdx = draftStrategies.findIndex(p => !(p?.text || '').trim());
  const canSave = fighterReady && !preload.active && emptyPlanIdx < 0;
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
      const list = (Array.isArray(d.strategies) && d.strategies.length > 0 ? d.strategies : defaultStrategies()).slice();
      list[index] = { ...list[index], ...patch };
      return { ...d, strategies: list };
    });
  }
  function addStrategy() {
    setDraft(d => {
      const list = (Array.isArray(d.strategies) ? d.strategies : []).slice();
      if (list.length >= MAX_STRATEGIES) return d;
      // makeStrategy() carries the slot's default text, so an added plan lands
      // ready to fight rather than as another empty tab.
      list.push(makeStrategy(list.length));
      return { ...d, strategies: list, activeStrategyIndex: list.length - 1 };
    });
  }
  // Reorder is a live swap during dragover, so the bar shows the result as you
  // move. activeStrategyIndex follows the plan, not the slot.
  function moveStrategy(from, to) {
    if (from === null || from === to) return;
    setDraft(d => {
      const list = (Array.isArray(d.strategies) ? d.strategies : defaultStrategies()).slice();
      if (from >= list.length || to >= list.length) return d;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      let act = d.activeStrategyIndex ?? 0;
      if (act === from) act = to;
      else if (from < act && to >= act) act -= 1;
      else if (from > act && to <= act) act += 1;
      return { ...d, strategies: list, activeStrategyIndex: act };
    });
    setDragIdx(to);
  }
  // Deleting a plan drops the slot for good — migrateStrategies() never pads a
  // short playbook back up, and cleanedProfile() persists whatever is left.
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

  // Build the persisted profile from the draft. Whatever plans are on screen are
  // what gets stored — no pruning: dropping a plan is the ✕ button's job, and a
  // silent prune of the untouched ones sent a player who edited only PLAN 1 back
  // to a single tab. usableStrategies() is the safety net at fight time.
  // handle is collected elsewhere now — pass through.
  function cleanedProfile() {
    const strategies = draftStrategies;
    // The match always starts on plan 1. In here activeStrategyIndex only means
    // "the plan being edited", and persisting THAT quietly changed which plan a
    // fight opened with (see BotMatchPage / RoomPage, which read it as the
    // starting strategy). Switching after that is the arena switcher's job.
    return { ...draft, handle: (draft.handle || '').trim(), strategies, activeStrategyIndex: 0 };
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
    if (!canSave) return;
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
          <span>COMBAT<span className="kk">O</span></span>
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
          <div className="su-plan-title">
            <span>YOUR GAME PLAN</span>
            {/* Reference, not an action — quiet until hover, so it never
                competes with the plan bar under it. */}
            <button className="su-rules-btn" onClick={() => setRulesOpen(true)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M9.6 9.2a2.5 2.5 0 1 1 3.2 2.4c-.5.2-.8.7-.8 1.2v.6" />
                <path d="M12 17h.01" />
              </svg>
              game rules
            </button>
          </div>

          {/* The same control the player taps mid-fight (see Arena's
              StrategySwitcher): one pill per plan, named, green for the one the
              match starts on. Setup is where you fill these in, so nothing has
              to be re-learned when the fight starts. Drag to reorder — the fight
              bar shows the same order. */}
          <div className="su-plan-bar">
            {draftStrategies.map((p, i) => (
              <button
                key={i}
                className={`su-plan-pill ${i === activeIdx ? 'is-on' : ''}`}
                onClick={() => setActiveStrategy(i)}
                title={p?.text || ''}
                aria-pressed={i === activeIdx}
                draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragIdx(i); }}
                onDragOver={e => { e.preventDefault(); moveStrategy(dragIdx, i); }}
                onDrop={e => { e.preventDefault(); setDragIdx(null); }}
                onDragEnd={() => setDragIdx(null)}
              >
                <span className="su-plan-pill-n">{i + 1}</span>
                <span className="su-plan-pill-t">{strategyLabel(p, i)}</span>
              </button>
            ))}
            {draftStrategies.length < MAX_STRATEGIES && (
              <button className="su-plan-add" onClick={addStrategy} aria-label="Add another plan">
                <Icon name="plus" size={15} />
              </button>
            )}
          </div>

          {/* Same editor the tutorial hands the player (see PlanEditor). The
              last remaining plan can't be deleted — a playbook needs one. */}
          <PlanEditor
            name={activePlan.name}
            onNameChange={v => updateStrategy(activeIdx, { name: v })}
            text={activePlan.text}
            onTextChange={v => updateStrategy(activeIdx, { text: v })}
            onExample={() => fillExample(activeIdx)}
            onDelete={draftStrategies.length > 1 ? () => removeStrategy(activeIdx) : undefined}
            label={`Strategy ${activeIdx + 1}`}
          />
        </div>
      </div>

      <div className="su-foot">
        {!canSave && !savedFlash && (
          <span className={`su-foot-hint f-mono ${!preload.active && fighterReady ? 'is-warn' : ''}`}>
            {preload.active
              ? 'Loading fighters…'
              : !fighterReady
                ? 'Pick a fighter to continue'
                // Tapping the hint jumps to the offending tab — the empty plan
                // isn't necessarily the one on screen.
                : <button className="su-foot-jump" onClick={() => setActiveStrategy(emptyPlanIdx)}>
                    PLAN {emptyPlanIdx + 1} needs a strategy
                  </button>}
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

      {/* ── Game rules ──────────────────────────────────────────── */}
      {rulesOpen && (
        <div className="su-modal-backdrop su-rules-bd" onClick={() => setRulesOpen(false)}>
          <div className="su-rules" onClick={e => e.stopPropagation()} role="dialog" aria-label="Game rules">
            <div className="su-rules-head">
              <h2>Game rules</h2>
              <button className="su-rules-x" onClick={() => setRulesOpen(false)} aria-label="Close">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="su-rules-body">
              <ol className="su-rules-list">
                <li><span className="n">1</span><p>This is a 1 vs 1 duel fight battle.</p></li>
                <li><span className="n">2</span><p>Each fighter sets a strategy and your fighter reacts accordingly.</p></li>
                <li><span className="n">3</span><p>Each hit reduces your opponent’s health bar.</p></li>
                <li><span className="n">4</span><p>Each hit or block builds your super meter. Fire the <code>super move</code> and the meter drops to zero.</p></li>
                <li className="is-warn"><span className="n">5</span><p>If your super move gets blocked, your own HP drops.</p></li>
                {/* Read off the engine's clock rather than typed out — the
                    limit has moved before, and a wrong rule is worse than none. */}
                <li><span className="n">6</span><p>{fightTimeLimitLabel()} is the time limit.</p></li>
              </ol>
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
            <p className="su-confirm-body">
              {canSave
                ? 'You have unsaved changes to your loadout.'
                : emptyPlanIdx >= 0
                  ? `PLAN ${emptyPlanIdx + 1} is empty — write a strategy in it or delete the tab before saving.`
                  : 'Pick a fighter before saving.'}
            </p>
            <div className="su-confirm-actions">
              <button className="btn btn-sm btn-ghost" onClick={discardAndLeave}>
                {canSave ? 'CANCEL' : 'LEAVE ANYWAY'}
              </button>
              <button className="btn btn-sm btn-cyan su-save" onClick={saveAndLeave} disabled={!canSave}>
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
