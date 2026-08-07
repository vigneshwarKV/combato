import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ArenaBackground from './ArenaBackground.jsx';
import ArenaStage from './ArenaStage.jsx';
import StatusBars from './StatusBars.jsx';
import ActionLabel from './ActionLabel.jsx';
import { StrategySwitcher } from './Arena.jsx';
import { MovesTable } from './design/DesignKit.jsx';
import Icon from './design/Icons.jsx';
import { loadProfile, charById } from '../data/designData.js';
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

// Build the ordered, looping tour.
//   enter    — scene fields applied on entering the step (animA/animB replay)
//   timeline — [{ at: ms, patch }] scheduled after enter
//   note     — in-scene callout { text, x, y, arrow } (design coords)
//   duration — ms before auto-advancing to the next step
function buildSteps({ superKey }) {
  const steps = [
    // Establishing shot — the real arena, both fighters idle.
    {
      camera: 'duel',
      enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0, meterB: 0 },
      note: { text: 'This is a 1-on-1 duel — Build strategies to win', x: 550, y: 225, arrow: 'none' },
      duration: 2800,
    },
    // Your moves — ONE step auto-plays every valid move back to back
    // (hit → jump → shoot → slide → block high → block low). The in-fight
    // ActionLabel names each as it plays; the opponent is hidden (soloA) so the
    // full lunge / slide reads clearly, and the caption holds throughout.
    {
      camera: 'fighterA',
      soloA: true,
      enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0 },
      note: { text: 'These are the valid moves in a fight', x: 460, y: 350, arrow: 'none' },
      timeline: buildMoveTimeline(['hit', 'jump', 'shoot', 'slide', 'defend_high', 'defend_low']),
      duration: 8200,
    },
  ];

  steps.push(
    // Zoom out — the opponent reappears and BOTH fighters act at once
    // (A shoots, B blocks low), showing simultaneous turns.
    {
      camera: 'full',
      enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0 },
      timeline: [{ at: 800, patch: { animA: 'shoot', animB: 'defend_low' } }],
      note: { text: 'Both fighters act at the same time', x: 550, y: 235, arrow: 'none' },
      duration: 3600,
    },
    // Health — sequenced within one step: no text first, the shoot lands and
    // their HP drops (full view), THEN zoom into the health bar, THEN the note.
    {
      camera: 'full',
      delayNote: true,
      enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0 },
      timeline: [
        { at: 600,  patch: { animA: 'shoot' } },        // you shoot
        { at: 1300, patch: { animB: 'hurt' } },          // opponent takes the hit (HP still full)
        { at: 1900, patch: { cam: 'healthB' } },         // zoom into the full health bar
        { at: 2700, patch: { showNote: true } },         // show the text
        { at: 3100, patch: { hpB: 58, meterA: 22 } },    // THEN the bar visibly drops — the effect
      ],
      note: { text: 'Each hit reduces your opponent’s health bar', x: 845, y: 100, arrow: 'up' },
      duration: 5400,
    },
    // Super meter — fills, then the note swaps automatically to what a full
    // meter unlocks (no extra Next tap needed).
    {
      camera: 'meterA',
      enter: { meterA: 0 },
      timeline: [
        { at: 500,  patch: { meterA: 55 } },
        { at: 1700, patch: { meterA: 100 } },
        { at: 2700, patch: { noteText: 'Fill it to unleash your super' } },
      ],
      note: { text: 'Each hit or block builds your super meter', x: 255, y: 88, arrow: 'up' },
      duration: 4600,
    },
  );

  // Super move — shown right after the meter fills. Gentler zoom (it flies
  // around), and the super finishes the opponent off. Meter empties as it fires.
  if (superKey && superKey !== 'none') steps.push({
    camera: 'superView',
    enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 100 },
    timeline: [
      { at: 500, patch: { animA: superKey, meterA: 0 } },
      { at: 1250, patch: { animB: 'death', hpB: 0 } },
    ],
    duration: 4000,
  });

  // Shielded super — SHOW the cost, don't just say it: reset the scene, the
  // opponent raises a shield, you fire your super, it's blocked, and YOUR hp drops.
  const superAnim = superKey && superKey !== 'none' ? superKey : 'shoot';
  steps.push({
    camera: 'full',
    enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 100 },
    timeline: [
      { at: 500,  patch: { animB: 'defend_high' } },       // opponent raises a shield
      { at: 1000, patch: { animA: superAnim, meterA: 0 } }, // you fire your super
      { at: 2000, patch: { animA: 'hurt', hpA: 60 } },      // blocked → YOUR hp drops
    ],
    note: { text: 'If your super move is shielded, your HP drops', x: 550, y: 235, arrow: 'none' },
    duration: 4200,
  });
  steps.push({
    camera: 'superView',
    enter: { animA: 'idle' },
    note: { text: 'Each fighter’s damage & super gain are different', x: 470, y: 360, arrow: 'none' },
    showMovesCard: true,
    duration: 5200,
  });
  steps.push({
    camera: 'superView',
    enter: { animA: 'idle' },
    note: { text: 'Choose a fighter & set your strategy in Settings', x: 470, y: 360, arrow: 'none' },
    duration: 3400,
  });

  steps.push(
    // Strategy bar — how many you get.
    {
      camera: 'duel',
      showSwitcher: true,
      enter: { selIdx: 0, effIdx: 0, pending: false, prog: 0 },
      note: { text: 'You can set up to 3 strategies', x: 550, y: 590, arrow: 'down' },
      duration: 3400,
    },
    // Strategy bar — switching live.
    {
      camera: 'duel',
      showSwitcher: true,
      enter: { selIdx: 0, effIdx: 0, pending: false, prog: 0 },
      note: { text: 'Switch strategies mid-fight', x: 550, y: 590, arrow: 'down' },
      timeline: [
        { at: 700,  patch: { selIdx: 1, pending: true, prog: 0.05 } },
        { at: 1500, patch: { prog: 0.45 } },
        { at: 2300, patch: { prog: 0.85 } },
        { at: 3000, patch: { effIdx: 1, selIdx: 1, pending: false, prog: 1 } },
      ],
      duration: 4800,
    },
  );

  return steps;
}

// Interactive practice after the tour — a real mini-fight. Each `turn` is
// resolved by the actual engine (resolveActions) and animated with the real
// timing (computeAttackTiming), exactly like a live fight — so hits, blocks,
// dodges, HP and meter are all authentic, not faked. It plays in batches of 3;
// after 2 moves it asks the player to tap DEFEND (switch lands after move 3),
// then 3 blocks fill the meter, it asks for ADAPT, and the super finishes it.
//
// Beat types:
//   reset  — reset HP/meter/scene
//   turn   — one exchange {a,b} run through the engine; `prog` fills the loader
//   gate   — pause: player must tap strategy `want`; `hint` pulses + shows a cue
//   switch — the queued strategy takes over (turns green)
//   super  — the finisher: fills the meter, fires the super, KOs the rival
//   win    — show the win CTA
function buildPractice() {
  const T = 1 / 3;
  return [
    { type: 'reset' },
    // ── Batch 1 · ATTACK ── (3 moves, then ask to switch)
    { type: 'turn', a: 'shoot', b: 'defend_low', prog: T },     // blocked → beast gains meter
    { type: 'turn', a: 'slide', b: 'jump',       prog: 2 * T }, // dodged → beast gains meter
    { type: 'turn', a: 'hit',   b: 'jump',       prog: 1 },     // melee clips the jumper → beast hurt
    { type: 'gate', want: 1, hint: 1 },                          // after 3 moves → tap DEFEND
    { type: 'switch', want: 1 },
    // ── Batch 2 · DEFEND ── (blocks & dodges build the meter)
    { type: 'turn', a: 'defend_low',  b: 'shoot', prog: T },
    { type: 'turn', a: 'defend_high', b: 'hit',   prog: 2 * T },
    { type: 'turn', a: 'jump',        b: 'slide', prog: 1 },
    { type: 'gate', want: 2, hint: 2 },                          // after 3 moves → tap ADAPT
    { type: 'switch', want: 2 },
    // ── Batch 3 · ADAPT ──
    { type: 'turn', a: 'shoot', b: 'slide', prog: T },           // beats a slide → beast hurt
    { type: 'turn', a: 'hit',   b: 'jump',  prog: 2 * T, meterFull: true }, // meter → full
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
};

export default function HowToPlay({ onClose, onSetup }) {
  const profile = useMemo(() => loadProfile(), []);
  // Fixed demo cast so the tour looks the same for everyone: Iron Turtle (left)
  // vs Beast (right).
  const heroId = 'turtle';
  const foeId = 'beast';
  const superKey = resolveSuperMove(heroId);

  const steps = useMemo(() => buildSteps({ superKey }), [superKey]);
  const practice = useMemo(() => buildPractice(), []);

  const fighterA = { name: profile.handle || 'YOU', character: heroId, color: '#ffd84a' };
  const fighterB = { name: 'RIVAL', character: foeId, color: '#ff5670' };

  const [phase, setPhase] = useState('tour');      // 'tour' | 'practice'
  const [stepIndex, setStepIndex] = useState(0);
  const [ended, setEnded] = useState(false);       // tour finished → end CTA
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
  function runTurn(actA, actB, { koB = false, meterFull = false, timers } = {}) {
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
    // Commit HP / meter bars when the hit visually lands.
    t(() => setSc(p => ({ ...p, hpA: newHpA, hpB: newHpB, meterA: newMeterA, meterB: result.newMeterB })), barCommitAt(timing));
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
    if (ended) return;
    if (atLast) setEnded(true);
    else setStepIndex(i => i + 1);
  }
  function goPrev() {
    if (ended) { setEnded(false); return; }   // back into the tour from the end CTA
    if (!atFirst) setStepIndex(i => i - 1);
  }
  // Left / right arrow keys drive the tour; ignored during the practice round.
  useEffect(() => {
    if (inPractice) return;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepIndex, ended]);

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
        applyPatch({ animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0, meterB: 0, selIdx: 0, effIdx: 0, pending: false, prog: 0 });
        advance(1100);
        break;
      case 'turn': {
        if (beat.prog != null) setSc(p => ({ ...p, prog: beat.prog }));
        const dur = runTurn(beat.a, beat.b, { timers, meterFull: beat.meterFull });
        advance(dur + 350);
        break;
      }
      case 'super': {
        // Meter is full going into the finisher; the super KOs the rival.
        fightRef.current = { ...fightRef.current, meterA: METER.MAX };
        setSc(p => ({ ...p, meterA: METER.MAX, prog: 0 }));
        const dur = runTurn(resolveSuperMove(heroId), 'idle', { koB: true, timers });
        advance(dur + 900);
        break;
      }
      case 'gate':
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
    startMusic();   // background theme starts only for the sample round
    fightRef.current = { hpA: 100, hpB: 100, meterA: 0, meterB: 0 };
    setSc({ ...INITIAL_SCENE });
    setEnded(false);
    setWon(false);
    setAwaitSel(null);
    setHintIndex(null);
    setPracticeIdx(0);
    setPhase('practice');
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

  // Practice always uses the full view; otherwise the timeline-driven camera
  // (sc.cam) can zoom mid-step, falling back to the step's base camera.
  const camName = inPractice ? 'full' : (sc.cam || step.camera);
  const cam = framedCamera(CAMERAS[camName] || CAMERAS.full);
  const camTx = DESIGN_W / 2 - cam.z * cam.cx;
  const camTy = DESIGN_H / 2 - cam.z * cam.cy;

  const showMovesCard = !inPractice && !!step.showMovesCard;
  // Switcher steps render their note inside the switcher chrome; delayed-note
  // steps keep it hidden until the timeline reveals it (sc.showNote).
  const tourNote = (!inPractice && !showMovesCard && !step.showSwitcher && sc.showNote) ? step.note : null;

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
  // Lift the fighters + arena up while the switcher is docked at the bottom.
  const sceneShift = showSwitcher ? -SWITCHER_LIFT : 0;
  const sceneShiftStyle = {
    transform: `translateY(${sceneShift}px)`,
    transition: 'transform 0.42s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  return (
    <div className="htp-overlay" role="dialog" aria-label="How to play">
      {/* Header — progress ticks + title, skip & close. */}
      <div className="htp-header">
        <div className="htp-ticks">
          {steps.map((_, idx) => (
            <span key={idx} className={'htp-tick' + ((!inPractice && (ended || idx <= stepIndex)) ? ' on' : '')} />
          ))}
        </div>
        <div className="htp-header-row">
          <div className="htp-header-left">
            <span className="htp-header-dot" />
            <span className="htp-header-title">HOW TO <span className="kk">PLAY</span></span>
          </div>
          <div className="htp-header-right">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              Skip tutorial
              <Icon name="arrow" size={13} />
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" size={15} />
            </button>
          </div>
        </div>
      </div>

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
            step the note rides above it, caret pointing down at the bar. */}
        {showSwitcher && (
          <div className="htp-switcher">
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

        {/* Moves card — the same MOVE / DAMAGE table from the setup page,
            shown while explaining that each fighter's numbers differ. */}
        {showMovesCard && (
          <div className="htp-movescard pk-design">
            <div className="htp-movescard-title">{step.note?.text}</div>
            <div className="htp-movescard-body">
              <MovesTable char={charById(heroId)} />
            </div>
          </div>
        )}

        {/* Bottom navigation — Prev (left) · Next / Finish (right). */}
        {!inPractice && !ended && (
          <div className="htp-nav">
            <button className="htp-nav-prev" onClick={goPrev} disabled={atFirst} aria-label="Previous step">
              <Icon name="back" size={20} />
            </button>
            <button className={'htp-nav-next' + (actionDone ? ' pulse' : '')} onClick={goNext} aria-label={atLast ? 'Finish' : 'Next step'}>
              {atLast ? 'Finish' : 'Next'}
              <Icon name="arrow" size={18} />
            </button>
          </div>
        )}

        {/* End-of-tour CTA */}
        {ended && !inPractice && (
          <div className="htp-cta">
            <div className="htp-cta-panel no-sub">
              <div className="htp-cta-title">That’s the basics!</div>
              <div className="htp-cta-btns">
                <button className="btn htp-cta-btn" onClick={startPractice}>Play a sample round</button>
                {onSetup && <button className="btn btn-ghost htp-cta-btn" onClick={onSetup}>Go to Settings</button>}
              </div>
            </div>
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
