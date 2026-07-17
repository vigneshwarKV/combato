import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ArenaBackground from './ArenaBackground.jsx';
import ArenaStage from './ArenaStage.jsx';
import StatusBars from './StatusBars.jsx';
import ActionLabel from './ActionLabel.jsx';
import { StrategySwitcher } from './Arena.jsx';
import { MovesPanel } from './design/DesignKit.jsx';
import Icon from './design/Icons.jsx';
import { loadProfile, charById, BASE_MOVES } from '../data/designData.js';
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

// Build the ordered, looping tour.
//   enter    — scene fields applied on entering the step (animA/animB replay)
//   timeline — [{ at: ms, patch }] scheduled after enter
//   note     — in-scene callout { text, x, y, arrow } (design coords)
//   duration — ms before auto-advancing to the next step
function buildSteps({ superKey }) {
  // A quick move demo — plays the action once; the in-fight ActionLabel names it.
  // soloA hides the opponent so the full lunge/slide reads clearly.
  // The "valid moves" caption stays pinned in the same spot across every move
  // demo (same camera + note position), so it holds while each move plays.
  const movesNote = { text: 'These are the valid moves in a fight', x: 460, y: 350, arrow: 'none' };
  const move = (action) => ({
    camera: 'fighterA',
    soloA: true,
    enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0 },
    timeline: [{ at: 300, patch: { animA: action } }],
    note: movesNote,
    duration: 2000,
  });

  const steps = [
    // Establishing shot — the real arena, both fighters idle.
    {
      camera: 'duel',
      enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0, meterB: 0 },
      note: { text: 'This is a 1-on-1 fight — Built strategy to win', x: 550, y: 225, arrow: 'none' },
      duration: 2800,
    },
    // Zoom onto your fighter, pause, then run through the moves (opponent hidden).
    {
      camera: 'fighterA',
      soloA: true,
      enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0 },
      note: { text: 'These are the valid moves in a fight', x: 460, y: 350, arrow: 'none' },
      duration: 2400,
    },
    // Each move: zoom in and play it — the in-fight ActionLabel names it.
    move('hit'),
    move('shoot'),
    move('slide'),
    move('jump'),
    move('defend_high'),
    move('defend_low'),
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
    // Back to idle, then a clean hit lands and their HP drops.
    {
      camera: 'full',
      enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0 },
      timeline: [
        { at: 900, patch: { animA: 'shoot' } },
        { at: 1900, patch: { animB: 'hurt', hpB: 74, meterA: 22 } },
      ],
      duration: 3600,
    },
    // Health bar callout — zoom the bar that just dropped.
    {
      camera: 'healthB',
      enter: { animA: 'idle', animB: 'idle', hpB: 100 },
      timeline: [{ at: 700, patch: { animB: 'hurt', hpB: 58 } }],
      note: { text: 'Each hit reduces your opponent’s health bar', x: 845, y: 126, arrow: 'up' },
      duration: 3800,
    },
    // Super meter — first: how it fills.
    {
      camera: 'meterA',
      enter: { meterA: 0 },
      timeline: [{ at: 500, patch: { meterA: 55 } }, { at: 1700, patch: { meterA: 100 } }],
      note: { text: 'Each hit or block builds your super meter', x: 255, y: 166, arrow: 'up' },
      duration: 3800,
    },
    // Super meter — then: what a full meter unlocks.
    {
      camera: 'meterA',
      enter: { meterA: 100 },
      note: { text: 'Fill it to unleash your super', x: 255, y: 166, arrow: 'up' },
      duration: 2600,
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

  // Stay on the KO scene (omit animB so the opponent keeps its death pose) —
  // text-only beats: the blocked-super caution, then fighters differ, then setup.
  steps.push({
    camera: 'superView',
    enter: { animA: 'idle' },
    note: { text: 'If your super is blocked by a shield, your HP drops', x: 470, y: 300, arrow: 'none' },
    duration: 3600,
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
      camera: 'strategy',
      showSwitcher: true,
      enter: { selIdx: 0, effIdx: 0, pending: false, prog: 0 },
      note: { text: 'You can set up to 3 strategies', x: 550, y: 590, arrow: 'down' },
      duration: 3400,
    },
    // Strategy bar — switching live.
    {
      camera: 'strategy',
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
  const [sc, setSc] = useState(INITIAL_SCENE);

  const step = steps[stepIndex];
  const beat = practice[practiceIdx];
  const inPractice = phase === 'practice';

  // Guards deferred SFX so nothing plays after the tour closes.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    startMusic();
    preloadCombatClips();
    return () => { aliveRef.current = false; stopMusic(); };
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
    if (step.enter) applyPatch(step.enter);
    if (stageReady) {
      (step.timeline || []).forEach(({ at, patch }) => {
        timersRef.current.push(setTimeout(() => applyPatch(patch), at));
      });
    }
    return () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepIndex, stageReady]);

  // Tour auto-advance — stops on the last step and shows the end CTA (no loop).
  useEffect(() => {
    if (inPractice || !stageReady || !step.duration) return;
    const t = setTimeout(() => {
      if (stepIndex < steps.length - 1) setStepIndex(stepIndex + 1);
      else setEnded(true);
    }, step.duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepIndex, stageReady]);

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

  // Practice always uses the full view (both fighters, bars and switcher visible).
  const cam = framedCamera(inPractice ? CAMERAS.full : (CAMERAS[step.camera] || CAMERAS.full));
  const camTx = DESIGN_W / 2 - cam.z * cam.cx;
  const camTy = DESIGN_H / 2 - cam.z * cam.cy;

  const showMovesCard = !inPractice && !!step.showMovesCard;
  const tourNote = !inPractice && !showMovesCard ? step.note : null;
  const noteScreen = tourNote && frameSize.w > 0
    ? {
        x: frameSize.w / 2 + fit * cam.z * (tourNote.x - cam.cx),
        y: frameSize.h / 2 + fit * cam.z * (tourNote.y - cam.cy),
      }
    : null;

  const showSwitcher = inPractice || step.showSwitcher;

  return (
    <div className="htp-overlay" role="dialog" aria-label="How to play">
      <button className="htp-close" onClick={onClose} aria-label="Close">
        <Icon name="close" size={18} />
      </button>

      <div className="htp-titlebar">
        <span className="dot" />{inPractice ? 'Try It Yourself' : 'How to Play'}
      </div>

      <div ref={frameRef} className="htp-frame">
        <div className="htp-fit" style={{ width: DESIGN_W, height: DESIGN_H, transform: `translate(-50%, -50%) scale(${fit})` }}>
          <div
            className="htp-camera"
            style={{ width: DESIGN_W, height: DESIGN_H, transform: `translate(${camTx}px, ${camTy}px) scale(${cam.z})` }}
          >
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
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

            <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
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

            {showSwitcher && (
              <div className="htp-switcher">
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
          </div>
        </div>

        {noteScreen && <SceneNote note={tourNote} x={noteScreen.x} y={noteScreen.y} />}

        {/* Moves card — the same per-move DMG / SPM table from the setup page,
            shown while explaining that each fighter's numbers differ. */}
        {showMovesCard && (
          <div className="htp-movescard pk-design">
            <div className="htp-movescard-title">{step.note?.text}</div>
            <div className="htp-movescard-body">
              <MovesPanel char={charById(heroId)} moves={BASE_MOVES} />
            </div>
          </div>
        )}

        {/* End-of-tour CTA */}
        {ended && !inPractice && (
          <div className="htp-cta">
            <div className="htp-cta-title">That’s the basics!</div>
            <div className="htp-cta-btns">
              <button className="htp-cta-btn primary" onClick={startPractice}>Play a sample round</button>
              {onSetup && <button className="htp-cta-btn" onClick={onSetup}>Go to Settings</button>}
            </div>
          </div>
        )}

        {/* Practice win CTA */}
        {won && (
          <div className="htp-cta">
            <div className="htp-cta-title">You win! 🏆</div>
            <div className="htp-cta-sub">Now build your own fighter &amp; strategies.</div>
            <div className="htp-cta-btns">
              {onSetup && <button className="htp-cta-btn primary" onClick={onSetup}>Set up your fighter</button>}
            </div>
          </div>
        )}

        {!stageReady && <div className="htp-loading">Loading arena…</div>}
      </div>
    </div>
  );
}

// A small labelled callout pinned at a frame-pixel position, with a caret
// pointing at the element it describes.
function SceneNote({ note, x, y }) {
  return (
    <div className="htp-note" style={{ left: x, top: y }}>
      {note.arrow === 'up' && <span className="htp-note-caret up" />}
      <span className="htp-note-text">{note.text}</span>
      {note.arrow === 'down' && <span className="htp-note-caret down" />}
    </div>
  );
}
