import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ArenaBackground from './ArenaBackground.jsx';
import ArenaStage from './ArenaStage.jsx';
import StatusBars from './StatusBars.jsx';
import ActionLabel from './ActionLabel.jsx';
import { StrategySwitcher } from './Arena.jsx';
import Icon from './design/Icons.jsx';
import PlanEditor from './design/PlanEditor.jsx';
import {
  loadProfile, saveProfile, defaultStrategies, makeStrategy,
} from '../data/designData.js';
import { resolveSuperMove } from '../engine/prompts.js';
import { resolveActions } from '../engine/damageEngine.js';
import { computeAttackTiming } from '../engine/animResolution.js';
import { barCommitAt } from '../hooks/useFightRenderer.js';
import { CHARACTERS, METER } from '../data/characters.js';
import { startMusic, stopMusic } from '../engine/soundEngine.js';
import { planCombatSounds, playCombatPlan, preloadCombatClips, playWinnerSound } from '../engine/combatSounds.js';

// ─────────────────────────────────────────────────────────────────────────────
// HowToPlay — an auto-playing tour that runs ON the real fight components
// (ArenaStage / StatusBars / ArenaBackground / ActionLabel / StrategySwitcher),
// so it always mirrors the actual fight screen. It's just the arena frame — no
// navigation chrome. Move names use the in-fight ActionLabel; the HP / super /
// strategy explanations appear as small callouts pinned inside the scene.
//
// The flow is the declarative STEPS list (buildSteps). Edit it to change the
// tour — camera framing, what plays, and the in-scene note per step.
// ─────────────────────────────────────────────────────────────────────────────

const DESIGN_W = 1100;
const DESIGN_H = 720;

// When the bottom strategy switcher is on screen (practice + strategy steps),
// lift the fighters AND the arena together by this much so the switcher never
// covers them — shifting both keeps the fighters standing on the ground.
const SWITCHER_LIFT = 84;

// Named camera framings, in design coordinates: {cx, cy, z} = focus point + zoom.
const CAMERAS = {
  full:      { cx: 550, cy: 360, z: 1.0 },
  duel:      { cx: 550, cy: 430, z: 1.2 },
  fighterA:  { cx: 460, cy: 500, z: 1.7 },
  superView: { cx: 470, cy: 470, z: 1.32 },  // gentler zoom — the super flies around
  healthB:   { cx: 845, cy: 80,  z: 1.95 },
  meterA:    { cx: 255, cy: 112, z: 2.05 },
  strategy:  { cx: 550, cy: 645, z: 1.8 },
};

// Keep the camera view fully inside the scene so a zoom never reveals empty
// space past the edges (which is what left the black band below the fighters).
function framedCamera(cam) {
  const vw = DESIGN_W / cam.z;
  const vh = DESIGN_H / cam.z;
  const cx = vw >= DESIGN_W ? DESIGN_W / 2 : Math.min(Math.max(cam.cx, vw / 2), DESIGN_W - vw / 2);
  const cy = vh >= DESIGN_H ? DESIGN_H / 2 : Math.min(Math.max(cam.cy, vh / 2), DESIGN_H - vh / 2);
  return { cx, cy, z: cam.z };
}

const DEMO_STRATEGIES = [
  { name: 'Attack', text: 'Rush in with hits and shoots to pressure them.' },
  { name: 'Defend', text: 'Block high and low, then punish their whiffs.' },
  { name: 'Adapt',  text: 'Read their pattern and counter each move.' },
];

// Auto-play a list of moves back-to-back within ONE step: each move plays, then
// a short idle resets the pose before the next. Returns a tour `timeline` so a
// single step demonstrates every valid move (one Next tap, not one per move).
function buildMoveTimeline(moves, { start = 400, hold = 1050, gap = 1550 } = {}) {
  const tl = [];
  moves.forEach((m, i) => {
    const t0 = start + i * gap;
    tl.push({ at: t0, patch: { animA: m } });
    tl.push({ at: t0 + hold, patch: { animA: 'idle' } });
  });
  return tl;
}

// Build the ordered tour. Four steps only: what the game is, the move
// vocabulary, the plan switcher, and writing a plan. Everything the fight can
// demonstrate on its own (simultaneous turns, HP, meter, the super) was cut
// from here and moved into the fight that follows — players were quitting a
// long slideshow without the one idea that matters, which is that a plan is
// plain English the fighter reads.
//   enter    — scene fields applied on entering the step (animA/animB replay)
//   timeline — [{ at: ms, patch }] scheduled after enter
//   note     — in-scene callout { text, x, y, arrow } (design coords)
function buildSteps() {
  return [
    // 1 — what this is, and whose job the moves are.
    {
      camera: 'duel',
      enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0, meterB: 0 },
      note: { text: 'This is a 1-on-1 duel fight match\nBuild strategies to win', x: 550, y: 225, arrow: 'none' },
    },
    // 2 — the vocabulary, one step, brisk: hit → jump → shoot → slide →
    // block high → block low. The in-fight ActionLabel names each as it plays;
    // the opponent is hidden (soloA) so the full lunge / slide reads clearly.
    {
      camera: 'fighterA',
      soloA: true,
      enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0 },
      note: { text: 'These are the valid moves in a fight', x: 460, y: 350, arrow: 'none' },
      timeline: buildMoveTimeline(
        ['hit', 'jump', 'shoot', 'slide', 'defend_high', 'defend_low'],
        { start: 300, hold: 780, gap: 1050 },
      ),
    },
    // 3 — the switcher: how many plans, AND a live switch, in one sequence.
    {
      camera: 'duel',
      showSwitcher: true,
      enter: { selIdx: 0, effIdx: 0, pending: false, prog: 0 },
      note: { text: 'You can set up to 3 strategies.\nCan switch strategies mid-fight.', x: 550, y: 590, arrow: 'down' },
      timeline: [
        { at: 900,  patch: { selIdx: 1, pending: true, prog: 0.05 } },
        { at: 1600, patch: { prog: 0.45 } },
        { at: 2300, patch: { prog: 0.85 } },
        { at: 3000, patch: { effIdx: 1, selIdx: 1, pending: false, prog: 1 } },
      ],
    },
    // 4 — write one. The bar lifts and the real game-plan editor grows under
    // it, so the control they just learned is the control they'll see in
    // Settings. Next is hidden here: SAVE advances (see handlePlanSave).
    {
      camera: 'duel',
      showSwitcher: true,
      showPlanPanel: true,
      enter: { animA: 'idle', animB: 'idle', selIdx: 0, effIdx: 0, pending: false, prog: 0 },
    },
  ];
}

// The fight the tour hands over to — a real mini-match, not a sample round the
// player has to opt into. Each `turn` is resolved by the actual engine
// (resolveActions) and animated with the real timing (computeAttackTiming), so
// hits, blocks, dodges, HP and meter are all authentic. It plays in batches of
// 3: ATTACK opens (and carries the simultaneous-turns / HP lesson), the player
// is asked for DEFEND (blocks fill the meter), then ADAPT, and the super
// finishes it. The mechanics are explained HERE, as they happen, rather than as
// scripted slides before the fight.
//
// Beat types:
//   reset  — reset HP/meter/scene
//   turn   — one exchange {a,b} run through the engine; `prog` fills the loader.
//            `holdBars` keeps the HP/meter bars where they are so a later beat
//            can drop them on cue (the reaction still plays on impact)
//   note   — in-scene callout; `text: null` clears it. Holds for `hold` ms.
//            `cam` pushes in on what it describes; `bars` commits whatever a
//            `holdBars` turn deferred, `barsAt` ms after the note appears
//   gate   — pause: player must tap strategy `want`; `hint` pulses + shows a cue
//   switch — the queued strategy takes over (turns green)
//   super  — the finisher: fills the meter, fires the super, KOs the rival
//   win    — show the win CTA
function buildPractice() {
  const T = 1 / 3;
  return [
    { type: 'reset' },
    // ── Batch 1 · ATTACK ──
    // Say it before it happens, so the player knows what to watch for in the
    // very first exchange.
    { type: 'note', text: 'Both fighters act at the same time', x: 550, y: 235, arrow: 'none', hold: 2200 },
    // A melee hit against their jump: the jump dodges shots but NOT a hit, which
    // knocks them out of the air — so the opening exchange lands. `holdBars`
    // keeps the health bar full through it: they see the rival recoil, then the
    // bar drops below, after the camera has pushed in on it.
    { type: 'turn', a: 'hit', b: 'jump', prog: T, holdBars: true },
    { type: 'note', text: 'Each hit reduces your opponent’s health bar', x: 845, y: 100, arrow: 'up', cam: 'healthB', bars: true, barsAt: 950, hold: 3200 },
    // The rest of the batch plays the saved plan in order: slide, then shoot.
    { type: 'turn', a: 'slide', b: 'jump',  prog: 2 * T },       // dodged → beast gains meter
    { type: 'turn', a: 'shoot', b: 'slide', prog: 1 },           // shot beats a slide → beast hurt
    { type: 'gate', want: 1, hint: 1 },                          // after 3 moves → tap DEFEND
    { type: 'switch', want: 1 },
    // ── Batch 2 · DEFEND ── (blocks & dodges build the meter)
    { type: 'turn', a: 'defend_low', b: 'shoot', prog: T },
    // "hit or block" covers both sides of the rule: landing an attack AND
    // defending successfully charge the meter; only taking damage gives
    // nothing. See GAME_RULES in prompts.js.
    { type: 'note', text: 'Each hit or block builds your super meter', x: 255, y: 88, arrow: 'up', cam: 'meterA', hold: 2600 },
    { type: 'turn', a: 'defend_high', b: 'hit',   prog: 2 * T },
    { type: 'turn', a: 'jump',        b: 'slide', prog: 1 },
    { type: 'gate', want: 2, hint: 2 },                          // after 3 moves → tap ADAPT
    { type: 'switch', want: 2 },
    // ── Batch 3 · ADAPT ──
    { type: 'turn', a: 'shoot', b: 'slide', prog: T },           // beats a slide → beast hurt
    { type: 'turn', a: 'hit',   b: 'jump',  prog: 2 * T, meterFull: true }, // meter → full
    { type: 'note', text: 'Meter full — now the super move', x: 255, y: 88, arrow: 'up', cam: 'meterA', hold: 2000 },
    { type: 'super' },                                           // full meter → super → KO
    { type: 'win' },
  ];
}

const INITIAL_SCENE = {
  animA: 'idle', animB: 'idle', keyA: 0, keyB: 0,
  hpA: 100, hpB: 100, meterA: 0, meterB: 0,
  selIdx: 0, effIdx: 0, pending: false, prog: 0, movesLeft: 0,
  // Timeline-drivable within a step: active camera, note visibility, note text.
  cam: null, showNote: true, noteText: null,
  // In-fight callout (practice `note` beats) — the tour's own notes come from
  // the step, not from here.
  note: null,
};

// What the tour types into the box for the player, one character at a time.
// It's an instruction, not a plan — so SAVE stays locked until a real plan
// replaces it (via `example` or by writing over it).
const TYPED_HINT = 'You need to write a strategy here in plain English. Your character will react accordingly. See Game rules for building strategy. Click on example for now';
// Nothing types until the panel has finished sliding up: 1.1s of movement (the
// .htp-plan rise / .htp-switcher lift in design.css — keep these in step) plus
// a beat to settle. Typing under a moving box reads as two things at once.
const TYPE_START_MS = 1250;
// Retyping after the example tap needs no such wait — just a beat to register
// that the box was cleared.
const TYPE_RETYPE_MS = 320;
const TYPE_CHAR_MS = 42;
// Fixed, not a random sample: it's the plan the fight that follows actually
// plays (hits, slides, shoots, then the super), so what the player saves and
// what they watch line up.
const TOUR_EXAMPLE_PLAN = 'Hit, slide and shoot continuously and use super move when available';

// The game-plan editor, mid-tour — the SAME PlanEditor the setup page renders,
// not a lookalike, because the step's point is "this is the screen where you
// write it". Three beats: the hint types itself into the box, a "Press here"
// cue on `example`, then one on SAVE & FIGHT once the example has typed itself
// in too. The box is display-only here (see PlanEditor's readOnly) — tapping it
// on a phone opened the keyboard over the whole tutorial.
function HtpPlanPanel({ onSave }) {
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(true);   // something is typing itself in
  const [filled, setFilled] = useState(false);  // a REAL plan is in the box now
  const timersRef = useRef([]);
  const cancelRef = useRef(false);

  // Type `full` into the box a character at a time, clearing whatever is there
  // first. Used for both the hint and the example, so the example arrives the
  // same way the hint did — written, not pasted.
  // Nothing here runs synchronously: the box is cleared by the first scheduled
  // callback, not by the caller, so this is safe to kick off from an effect.
  function typeInto(full, { startMs, onDone } = {}) {
    cancelRef.current = false;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    let i = 0;
    const tick = () => {
      if (cancelRef.current) return;
      i += 1;
      setText(full.slice(0, i));
      if (i < full.length) timersRef.current.push(setTimeout(tick, TYPE_CHAR_MS));
      else { setTyping(false); onDone?.(); }
    };
    const begin = () => {
      if (cancelRef.current) return;
      setTyping(true);
      setText('');       // clear whatever is there, then write the new one
      tick();
    };
    timersRef.current.push(setTimeout(begin, startMs ?? TYPE_RETYPE_MS));
  }

  useEffect(() => {
    typeInto(TYPED_HINT, { startMs: TYPE_START_MS });
    return () => { cancelRef.current = true; timersRef.current.forEach(clearTimeout); };
  }, []);

  // SAVE only lights up once the example has finished landing in the box.
  const handleExample = () => typeInto(TOUR_EXAMPLE_PLAN, { onDone: () => setFilled(true) });

  const ready = filled && text.trim().length > 0;
  return (
    <div className="htp-plan pk-design">
      <PlanEditor
        name="ATTACK"
        /* A trailing block while typing: a read-only textarea shows no caret of
           its own, and a real character follows the text instead of sitting at
           a fixed offset the way an overlaid one would. */
        text={typing ? `${text}▌` : text}
        onTextChange={() => {}}
        onExample={handleExample}
        exampleCue={!typing && !ready}
        readOnly
        textPlaceholder=""
      />
      <div className="htp-plan-foot">
        <button
          className="btn btn-sm btn-cyan su-save htp-plan-save"
          onClick={() => onSave(text.trim())}
          disabled={!ready}
        >
          <Icon name="check" size={13} />&nbsp;SAVE &amp; FIGHT
        </button>
        {ready && (
          <span className="plan-cue plan-cue--save">
            <span className="plan-cue-text">Press here</span>
            <span className="plan-cue-arrow">▼</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default function HowToPlay({ onClose, onSetup }) {
  const profile = useMemo(() => loadProfile(), []);
  // Fixed demo cast so the tour looks the same for everyone: Iron Turtle (left)
  // vs Beast (right).
  const heroId = 'turtle';
  const foeId = 'beast';

  const steps = useMemo(() => buildSteps(), []);
  const practice = useMemo(() => buildPractice(), []);

  const fighterA = { name: profile.handle || 'YOU', character: heroId, color: '#ffd84a' };
  const fighterB = { name: 'RIVAL', character: foeId, color: '#ff5670' };

  const [phase, setPhase] = useState('tour');      // 'tour' | 'practice'
  const [stepIndex, setStepIndex] = useState(0);
  const [practiceIdx, setPracticeIdx] = useState(0);
  const [awaitSel, setAwaitSel] = useState(null);  // strategy index the player must tap
  const [hintIndex, setHintIndex] = useState(null);
  const [won, setWon] = useState(false);
  const [stageReady, setStageReady] = useState(false);
  const [portrait, setPortrait] = useState(false);   // rotate-your-phone gate
  const [actionDone, setActionDone] = useState(false); // step's action finished → blink Next
  const [sc, setSc] = useState(INITIAL_SCENE);

  const step = steps[stepIndex];
  const beat = practice[practiceIdx];
  const inPractice = phase === 'practice';

  // Guards deferred SFX so nothing plays after the tour closes.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    // The walkthrough tour is silent — background music only kicks in for the
    // interactive sample round (see startPractice). Preload clips so it's ready.
    preloadCombatClips();
    return () => { aliveRef.current = false; stopMusic(); };
  }, []);

  // The tour is designed for landscape — gate portrait phones with a rotate hint.
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (max-width: 900px)');
    const onChange = () => setPortrait(mq.matches);
    mq.addEventListener('change', onChange);
    onChange();
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function applyPatch(patch) {
    setSc(prev => {
      const next = { ...prev, ...patch };
      if ('animA' in patch && patch.animA !== prev.animA) next.keyA = prev.keyA + 1;
      if ('animB' in patch && patch.animB !== prev.animB) next.keyB = prev.keyB + 1;
      return next;
    });
  }
  // Anim setters that ALWAYS replay (bump the key) — used by the engine-driven
  // practice turns where the same anim can recur turn to turn.
  const setAnimA = (a) => setSc(p => ({ ...p, animA: a, keyA: p.keyA + 1 }));
  const setAnimB = (b) => setSc(p => ({ ...p, animB: b, keyB: p.keyB + 1 }));
  const setAnims = (a, b) => setSc(p => ({ ...p, animA: a, animB: b, keyA: p.keyA + 1, keyB: p.keyB + 1 }));

  // Running fight state for practice — feeds the engine each turn (bars are
  // committed into `sc` at the real impact time; this ref holds the truth).
  const fightRef = useRef({ hpA: 100, hpB: 100, meterA: 0, meterB: 0 });

  // Resolve ONE practice exchange through the real engine and schedule the same
  // anim swaps + bar commit a live fight uses. Returns the turn's total length.
  function runTurn(actA, actB, { koB = false, meterFull = false, holdBars = false, timers } = {}) {
    const st = fightRef.current;
    const result = resolveActions(actA, actB, heroId, foeId, st.meterA, st.meterB);
    const charA = CHARACTERS[heroId], charB = CHARACTERS[foeId];
    const timing = computeAttackTiming(result, charA, charB);
    const newHpA = Math.max(0, st.hpA - result.damageToA);
    const newHpB = koB ? 0 : Math.max(0, st.hpB - result.damageToB);
    // Scripted top-off so the demo reaches a full meter for the super.
    const newMeterA = meterFull ? METER.MAX : result.newMeterA;
    const koAA = newHpA <= 0;
    const koBB = newHpB <= 0;
    const t = (fn, ms) => timers.push(setTimeout(fn, ms));

    setAnims(timing.initialAnimA, timing.initialAnimB);
    // Combat SFX — same planner the live fight uses (gunshots, impacts, clangs).
    playCombatPlan(
      planCombatSounds({
        events: result.events,
        actionA: result.actualActionA, actionB: result.actualActionB,
        charAId: heroId, charBId: foeId,
        charA, charB, timing,
      }),
      () => aliveRef.current,
    );
    if (timing.launchAnimA) t(() => setAnimA(timing.launchAnimA), timing.launchAtA);
    if (timing.launchAnimB) t(() => setAnimB(timing.launchAnimB), timing.launchAtB);
    if (timing.reactionA) t(() => setAnimA(koAA ? 'death' : timing.reactionA), timing.reactionAtA);
    if (timing.reactionB) t(() => setAnimB(koBB ? 'death' : timing.reactionB), timing.reactionAtB);
    // Commit HP / meter bars when the hit visually lands — unless the script is
    // holding them for a later beat (see `holdBars`), in which case fightRef
    // still carries the real values and a `bars` note commits them on cue.
    if (!holdBars) {
      t(() => setSc(p => ({ ...p, hpA: newHpA, hpB: newHpB, meterA: newMeterA, meterB: result.newMeterB })), barCommitAt(timing));
    }
    if (!koAA) t(() => setAnimA('idle'), timing.clearA);
    if (!koBB) t(() => setAnimB('idle'), timing.clearB);

    fightRef.current = { hpA: newHpA, hpB: newHpB, meterA: newMeterA, meterB: result.newMeterB };
    return Math.max(timing.clearA, timing.clearB);
  }

  // ── Tour driver ────────────────────────────────────────────────────────────
  const timersRef = useRef([]);
  useEffect(() => {
    if (inPractice) return;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    // Reset the per-step camera, note visibility (hidden if the step delays it),
    // and note-text override, then apply the step's enter scene.
    applyPatch({ cam: step.camera, showNote: !step.delayNote, noteText: null, ...(step.enter || {}) });
    // Next stays calm while the step's action plays, then blinks once it has
    // finished — cueing the player that they can advance.
    setActionDone(false);
    if (stageReady) {
      const tl = step.timeline || [];
      tl.forEach(({ at, patch }) => {
        timersRef.current.push(setTimeout(() => applyPatch(patch), at));
      });
      const lastAt = tl.reduce((m, t) => Math.max(m, t.at), 0);
      timersRef.current.push(setTimeout(() => setActionDone(true), lastAt + 300));
    }
    return () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepIndex, stageReady]);

  // ── Manual step navigation (Prev / Next) ───────────────────────────────────
  // The tour no longer auto-plays: the player steps through it one action at a
  // time. Each step's enter/timeline still replays on arrival (see the driver
  // effect above), so a step's little animation plays whenever it's shown.
  const atFirst = stepIndex === 0;
  const atLast = stepIndex === steps.length - 1;
  function goNext() {
    // The last step ends in SAVE, not in a Next — there's no "end of tour" card
    // any more, the fight just begins (see handlePlanSave).
    if (!atLast) setStepIndex(i => i + 1);
  }
  function goPrev() {
    if (!atFirst) setStepIndex(i => i - 1);
  }
  // Left / right arrow keys drive the tour; ignored during the fight.
  useEffect(() => {
    if (inPractice) return;
    const onKey = (e) => {
      // Not while typing a plan — arrows belong to the caret, not the tour.
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepIndex]);

  // ── Practice driver ──────────────────────────────────────────────────────
  const practiceTimersRef = useRef([]);
  useEffect(() => {
    if (!inPractice || !stageReady || !beat) return;
    practiceTimersRef.current.forEach(clearTimeout);
    practiceTimersRef.current = [];
    const timers = practiceTimersRef.current;
    const advance = (ms) => timers.push(setTimeout(() => setPracticeIdx(i => i + 1), ms));

    if (beat.type !== 'gate') { setAwaitSel(null); setHintIndex(null); }

    switch (beat.type) {
      case 'reset':
        fightRef.current = { hpA: 100, hpB: 100, meterA: 0, meterB: 0 };
        applyPatch({ animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0, meterB: 0, selIdx: 0, effIdx: 0, pending: false, prog: 0, cam: null, note: null });
        advance(1100);
        break;
      case 'note':
        // The lesson lands ON the thing it describes, while it's still on
        // screen — and `cam` pushes in on it (the HP bar, the meter) the way
        // the old scripted steps did. `text: null` clears; a gate clears it too.
        applyPatch({
          note: beat.text ? { text: beat.text, x: beat.x, y: beat.y, arrow: beat.arrow || 'none' } : null,
          cam: beat.cam ?? null,
        });
        // Bars a `holdBars` turn deferred land here — after the camera move has
        // settled, so the drop happens while the note is explaining it rather
        // than off-screen during the exchange.
        if (beat.bars) {
          timers.push(setTimeout(
            () => setSc(p => ({ ...p, ...fightRef.current })),
            beat.barsAt ?? 900,
          ));
        }
        advance(beat.hold ?? 1800);
        break;
      case 'turn': {
        // Always fight in the wide shot: a zoom set by the previous note beat
        // pulls back before two fighters move — and its note goes with it. A
        // callout that outlived its zoom just sat over the next exchange.
        applyPatch({ cam: null, note: null });
        if (beat.prog != null) setSc(p => ({ ...p, prog: beat.prog }));
        const dur = runTurn(beat.a, beat.b, { timers, meterFull: beat.meterFull, holdBars: beat.holdBars });
        advance(dur + 350);
        break;
      }
      case 'super': {
        // Meter is full going into the finisher; the super KOs the rival.
        fightRef.current = { ...fightRef.current, meterA: METER.MAX };
        setSc(p => ({ ...p, meterA: METER.MAX, prog: 0, cam: null, note: null }));
        const dur = runTurn(resolveSuperMove(heroId), 'idle', { koB: true, timers });
        advance(dur + 900);
        break;
      }
      case 'gate':
        // Nothing competes with the "press here" cue while we wait on a tap —
        // and the switcher is stage chrome, so we need the wide shot to see the
        // fighters behind it.
        applyPatch({ note: null, cam: null });
        setAwaitSel(beat.want);
        setHintIndex(beat.hint ?? beat.want);
        break;
      case 'switch':
        applyPatch({ effIdx: beat.want, selIdx: beat.want, pending: false, prog: 0 });
        advance(650);
        break;
      case 'win':
        // Winner celebrates (rival stays down); show the CTA a beat later so the
        // celebration is visible first.
        setAnimA('celebrate');
        playWinnerSound();
        timers.push(setTimeout(() => setWon(true), 1300));
        break;
      default:
        break;
    }
    return () => { practiceTimersRef.current.forEach(clearTimeout); practiceTimersRef.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, practiceIdx, stageReady]);

  function startPractice() {
    startMusic();   // background theme starts only once the fight begins
    fightRef.current = { hpA: 100, hpB: 100, meterA: 0, meterB: 0 };
    setSc({ ...INITIAL_SCENE });
    setWon(false);
    setAwaitSel(null);
    setHintIndex(null);
    setPracticeIdx(0);
    setPhase('practice');
  }

  // SAVE on the plan step. The plan is persisted for real — the player leaves
  // the tutorial with their first plan written, not with a button that only
  // pretended. It doesn't wrongly mark them set up: isProfileReady also needs a
  // charId, which is still unset, so home still routes them to /setup to pick a
  // fighter. Then the fight starts immediately.
  function handlePlanSave(text) {
    if (!text) return;
    try {
      const p = loadProfile();
      const list = (Array.isArray(p.strategies) && p.strategies.length ? p.strategies : defaultStrategies()).slice();
      list[0] = { ...(list[0] || makeStrategy(0)), text };
      saveProfile({ ...p, strategies: list });
    } catch { /* a failed write must not block the tutorial */ }
    startPractice();
  }
  // Switcher taps: in practice, only the gated strategy responds. Tapping it
  // queues the switch (orange/pending); the switch itself lands after the batch.
  function handleSelect(i) {
    if (inPractice) {
      if (awaitSel !== null && i === awaitSel) {
        setAwaitSel(null);
        setHintIndex(null);
        applyPatch({ selIdx: i, pending: true });
        setPracticeIdx(x => x + 1);
      }
      return;
    }
    applyPatch({ selIdx: i, pending: i !== sc.effIdx });
  }

  // Fit the design-space scene into the frame.
  const frameRef = useRef(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) setFrameSize({ w, h });
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, []);
  const fit = frameSize.w > 0 ? Math.min(frameSize.w / DESIGN_W, frameSize.h / DESIGN_H) : 1;

  // Measure the note card so its projected anchor can be clamped fully inside
  // the stage — a high-zoom step must never push it off-screen / under the header.
  // Observe (don't measure once): a single mount-time read happens before the
  // display font loads, so it's laid out in the fallback and mis-measured — or
  // never re-fires and stays at the default. A ResizeObserver also re-measures
  // when the step text length or the viewport (rotation) changes.
  const [noteSize, setNoteSize] = useState({ w: 320, h: 64 });
  const noteElRef = useRef(null);
  const noteRoRef = useRef(null);
  const noteRef = useCallback((el) => {
    if (noteElRef.current === el) return;
    noteRoRef.current?.disconnect();
    noteRoRef.current = null;
    noteElRef.current = el;
    if (!el) return;
    const read = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      setNoteSize(s => (s.w === w && s.h === h) ? s : { w, h });
    };
    noteRoRef.current = new ResizeObserver(read);
    noteRoRef.current.observe(el);
    read();
  }, []);

  // Both phases drive the camera the same way: sc.cam (set by a tour timeline
  // or a fight `note` beat) wins, falling back to the step's base framing —
  // 'full' during the fight, which every turn/gate resets to.
  const camName = sc.cam || (inPractice ? 'full' : step.camera);
  const cam = framedCamera(CAMERAS[camName] || CAMERAS.full);
  const camTx = DESIGN_W / 2 - cam.z * cam.cx;
  const camTy = DESIGN_H / 2 - cam.z * cam.cy;

  // In the fight the callouts come from `note` beats; in the tour they come
  // from the step. Switcher steps render their note inside the switcher chrome
  // instead, and delayed-note steps stay hidden until the timeline reveals it.
  const tourNote = inPractice
    ? sc.note
    : ((!step.showSwitcher && sc.showNote) ? step.note : null);

  // Project the note's scene anchor to a stage pixel, then keep the whole
  // (measured) card inside the stage with a small margin — mirrors the design
  // tour so the caret lands on the thing it points at. `shift` anchors the card
  // above (down-arrow), below (up-arrow) or centred (no arrow) on the anchor.
  let notePos = null;
  if (tourNote && frameSize.w > 0) {
    const k = fit * cam.z, M = 14;
    const nw = noteSize.w, nh = noteSize.h;
    let nx = frameSize.w / 2 + k * (tourNote.x - cam.cx);
    let ny = frameSize.h / 2 + k * (tourNote.y - cam.cy);
    nx = Math.min(Math.max(nx, nw / 2 + M), Math.max(nw / 2 + M, frameSize.w - nw / 2 - M));
    const a = tourNote.arrow;
    const lo = a === 'up' ? M : (a === 'down' ? nh + M : nh / 2 + M);
    const hi = a === 'up' ? frameSize.h - nh - M : (a === 'down' ? frameSize.h - M : frameSize.h - nh / 2 - M);
    ny = Math.min(Math.max(ny, lo), Math.max(lo, hi));
    notePos = { x: nx, y: ny, shift: a === 'up' ? '0%' : (a === 'down' ? '-100%' : '-50%') };
  }

  const showSwitcher = inPractice || step.showSwitcher;
  const showPlanPanel = !inPractice && !!step.showPlanPanel;
  // Lift the fighters + arena up while the switcher is docked at the bottom.
  const sceneShift = showSwitcher ? -SWITCHER_LIFT : 0;
  const sceneShiftStyle = {
    transform: `translateY(${sceneShift}px)`,
    transition: 'transform 0.42s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  return (
    <div className="htp-overlay" role="dialog" aria-label="How to play">
      {/* Header — the shared game bar (arena / duel room / lobby), with the step
          ticks riding its bottom edge so the bar itself stays 52px everywhere. */}
      <header className="game-bar htp-bar">
        <span className="game-bar-brand">COMBAT<b>O</b></span>
        <span className="game-bar-div" />
        <span className="game-bar-mode">HOW TO PLAY</span>
        <span className="game-bar-spacer" />
        {/* Skip is the only way out — the X next to it did the same thing. */}
        <div className="game-bar-rail">
          <button className="hdr-btn" onClick={onClose}>
            SKIP TUTORIAL<Icon name="arrow" size={13} />
          </button>
        </div>
        <div className="htp-ticks">
          {steps.map((_, idx) => (
            <span key={idx} className={'htp-tick' + ((inPractice || idx <= stepIndex) ? ' on' : '')} />
          ))}
        </div>
      </header>

      {/* Stage — the live arena, panned/zoomed per step. */}
      <div ref={frameRef} className="htp-stage">
        <div className="htp-fit" style={{ width: DESIGN_W, height: DESIGN_H, transform: `translate(-50%, -50%) scale(${fit})` }}>
          <div
            className="htp-camera"
            style={{ width: DESIGN_W, height: DESIGN_H, transform: `translate(${camTx}px, ${camTy}px) scale(${cam.z})` }}
          >
            <div style={{ position: 'absolute', inset: 0, zIndex: 0, ...sceneShiftStyle }}>
              <ArenaBackground seed={`${heroId}-${foeId}`} fit="cover" position="center top" />
            </div>

            <div className="htp-hud htp-hud-a"><StatusBars fighter={fighterA} hp={sc.hpA} meter={sc.meterA} status={[]} side="A" /></div>
            <div className="htp-hud htp-hud-b"><StatusBars fighter={fighterB} hp={sc.hpB} meter={sc.meterB} status={[]} side="B" /></div>
            <div className="htp-vs">VS</div>

            <div className="htp-callout htp-callout-a">
              <ActionLabel action={sc.animA} side="A" size={30} />
            </div>
            <div className="htp-callout htp-callout-b">
              <ActionLabel action={sc.animB} side="B" size={30} />
            </div>

            <div style={{ position: 'absolute', inset: 0, zIndex: 10, ...sceneShiftStyle }}>
              <ArenaStage
                characterAId={heroId}
                characterBId={foeId}
                animClassA={`anim-${sc.animA}`} animClassB={`anim-${sc.animB}`}
                animKeyA={sc.keyA} animKeyB={sc.keyB}
                plannedActionA={sc.animA} plannedActionB={sc.animB}
                hpA={sc.hpA} hpB={sc.hpB}
                hideB={!inPractice && !!step.soloA}
                width={DESIGN_W} height={DESIGN_H}
                onReady={() => setStageReady(true)}
              />
            </div>
          </div>
        </div>

        {/* Cinematic edge vignette so the scene reads as framed, not letterboxed. */}
        <div className="htp-vignette" />

        {/* Strategy switcher — fixed stage chrome (NOT inside the scaled camera),
            so it stays a readable, tappable size on mobile. On a tour switcher
            step the note rides above it, caret pointing down at the bar. On the
            plan step it lifts to sit on top of the editor, exactly as the plan
            bar sits above the editor in Settings. */}
        {showSwitcher && (
          <div className={`htp-switcher${showPlanPanel ? ' is-lifted' : ''}`}>
            {!inPractice && step.showSwitcher && step.note && (
              <div className="htp-switcher-note">
                <div className="htp-note-text">{step.note.text}</div>
                <span className="htp-note-caret down" />
              </div>
            )}
            <StrategySwitcher
              strategies={DEMO_STRATEGIES}
              selectedIndex={sc.selIdx}
              effectiveIndex={sc.effIdx}
              pending={sc.pending}
              progress={sc.prog}
              hintIndex={inPractice ? hintIndex : undefined}
              onSelect={handleSelect}
              disabled={false}
            />
          </div>
        )}

        {/* In-scene note — anchored on the thing it explains, caret pointing at it. */}
        {notePos && (
          <div
            ref={noteRef}
            className="htp-note"
            style={{ left: notePos.x, top: notePos.y, transform: `translate(-50%, ${notePos.shift})` }}
          >
            {tourNote.arrow === 'up' && <span className="htp-note-caret up" />}
            <div className="htp-note-text">{sc.noteText || tourNote.text}</div>
            {tourNote.arrow === 'down' && <span className="htp-note-caret down" />}
          </div>
        )}

        {/* Write your first plan — the setup page's editor, in place. */}
        {showPlanPanel && <HtpPlanPanel onSave={handlePlanSave} />}

        {/* Bottom navigation — Prev (left) · Next (right). The plan step has no
            Next: its SAVE is the way forward. */}
        {!inPractice && (
          <div className="htp-nav">
            <button className="htp-nav-prev" onClick={goPrev} disabled={atFirst} aria-label="Previous step">
              <Icon name="back" size={20} />
            </button>
            {!showPlanPanel && (
              <button className={'htp-nav-next' + (actionDone ? ' pulse' : '')} onClick={goNext} aria-label="Next step">
                Next
                <Icon name="arrow" size={18} />
              </button>
            )}
          </div>
        )}

        {/* Practice win CTA */}
        {won && (
          <div className="htp-cta">
            <div className="htp-cta-panel">
              <span className="htp-cta-mark"><Icon name="trophy" size={34} /></span>
              <div className="htp-cta-head">
                <div className="htp-cta-title">You win!</div>
                <div className="htp-cta-sub">Now build your own fighter &amp; strategies.</div>
              </div>
              <div className="htp-cta-btns">
                {onSetup && <button className="btn htp-cta-btn" onClick={onSetup}>Set up your fighter</button>}
              </div>
            </div>
          </div>
        )}

        {!stageReady && <div className="htp-loading">Loading arena…</div>}
      </div>

      {/* Landscape-only tutorial: block portrait phones with a rotate prompt. */}
      {portrait && (
        <div className="htp-rotate">
          <Icon name="rotate" size={52} />
          <div className="htp-rotate-title">Rotate your phone</div>
          <div className="htp-rotate-sub">This tutorial is designed for landscape.</div>
        </div>
      )}
    </div>
  );
}
