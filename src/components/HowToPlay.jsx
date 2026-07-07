import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ArenaBackground from './ArenaBackground.jsx';
import ArenaStage from './ArenaStage.jsx';
import StatusBars from './StatusBars.jsx';
import ActionLabel from './ActionLabel.jsx';
import { StrategySwitcher } from './Arena.jsx';
import Icon from './design/Icons.jsx';
import { loadProfile } from '../data/designData.js';
import { resolveSuperMove } from '../engine/prompts.js';
import { startMusic, stopMusic } from '../engine/soundEngine.js';

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
  const move = (action) => ({
    camera: 'fighterA',
    soloA: true,
    enter: { animA: 'idle', animB: 'idle', hpA: 100, hpB: 100, meterA: 0 },
    timeline: [{ at: 300, patch: { animA: action } }],
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
    duration: 3600,
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

const INITIAL_SCENE = {
  animA: 'idle', animB: 'idle', keyA: 0, keyB: 0,
  hpA: 100, hpB: 100, meterA: 0, meterB: 0,
  selIdx: 0, effIdx: 0, pending: false, prog: 0, movesLeft: 0,
};

export default function HowToPlay({ onClose }) {
  const profile = useMemo(() => loadProfile(), []);
  // Fixed demo cast so the tour looks the same for everyone: Mad Scientist (left)
  // vs Beast (right).
  const heroId = 'turtle';
  const foeId = 'beast';
  const superKey = resolveSuperMove(heroId);

  const steps = useMemo(() => buildSteps({ superKey }), [superKey]);

  const fighterA = { name: profile.handle || 'YOU', character: heroId, color: '#ffd84a' };
  const fighterB = { name: 'RIVAL', character: foeId, color: '#ff5670' };

  const [stepIndex, setStepIndex] = useState(0);
  const [stageReady, setStageReady] = useState(false);
  const [sc, setSc] = useState(INITIAL_SCENE);
  const step = steps[stepIndex];

  // Play the fight theme while the tour is open; stop it when it closes/unmounts.
  // (Audio is unlocked by the click that opened the tour — see HomePage.)
  useEffect(() => {
    startMusic();
    return () => stopMusic();
  }, []);

  function applyPatch(patch) {
    setSc(prev => {
      const next = { ...prev, ...patch };
      // Only replay an animation when its value actually changes — bumping the
      // key on an unchanged 'idle' would re-run ArenaStage's anim effect and
      // un-hide a fighter we've hidden (soloA).
      if ('animA' in patch && patch.animA !== prev.animA) next.keyA = prev.keyA + 1;
      if ('animB' in patch && patch.animB !== prev.animB) next.keyB = prev.keyB + 1;
      return next;
    });
  }

  // Content: apply the step's enter patch + timeline (held until sprites load).
  const timersRef = useRef([]);
  useEffect(() => {
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
  }, [stepIndex, stageReady]);

  // Auto-advance, looping back to the start when the tour finishes.
  useEffect(() => {
    if (!stageReady || !step.duration) return;
    const t = setTimeout(() => setStepIndex(i => (i + 1) % steps.length), step.duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, stageReady]);

  // Fit the design-space scene into the frame.
  const frameRef = useRef(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) setFit(Math.min(w / DESIGN_W, h / DESIGN_H));
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, []);

  const cam = framedCamera(CAMERAS[step.camera] || CAMERAS.full);
  const camTx = DESIGN_W / 2 - cam.z * cam.cx;
  const camTy = DESIGN_H / 2 - cam.z * cam.cy;

  return (
    <div className="htp-overlay" role="dialog" aria-label="How to play">
      <button className="htp-close" onClick={onClose} aria-label="Close">
        <Icon name="close" size={18} />
      </button>

      <div className="htp-titlebar"><span className="dot" />How to Play</div>

      <div ref={frameRef} className="htp-frame">
        <div className="htp-fit" style={{ width: DESIGN_W, height: DESIGN_H, transform: `translate(-50%, -50%) scale(${fit})` }}>
          <div
            className="htp-camera"
            style={{ width: DESIGN_W, height: DESIGN_H, transform: `translate(${camTx}px, ${camTy}px) scale(${cam.z})` }}
          >
            {/* Background */}
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
              <ArenaBackground seed={`${heroId}-${foeId}`} fit="cover" position="center top" />
            </div>

            {/* HUD — same StatusBars as a real fight */}
            <div className="htp-hud htp-hud-a"><StatusBars fighter={fighterA} hp={sc.hpA} meter={sc.meterA} status={[]} side="A" /></div>
            <div className="htp-hud htp-hud-b"><StatusBars fighter={fighterB} hp={sc.hpB} meter={sc.meterB} status={[]} side="B" /></div>
            <div className="htp-vs">VS</div>

            {/* In-fight move callouts (same component the arena uses) */}
            <div className="htp-callout htp-callout-a">
              <ActionLabel action={sc.animA} side="A" size={30} />
            </div>
            <div className="htp-callout htp-callout-b">
              <ActionLabel action={sc.animB} side="B" size={30} />
            </div>

            {/* Fighters */}
            <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
              <ArenaStage
                characterAId={heroId}
                characterBId={foeId}
                animClassA={`anim-${sc.animA}`} animClassB={`anim-${sc.animB}`}
                animKeyA={sc.keyA} animKeyB={sc.keyB}
                plannedActionA={sc.animA} plannedActionB={sc.animB}
                hpA={sc.hpA} hpB={sc.hpB}
                hideB={!!step.soloA}
                width={DESIGN_W} height={DESIGN_H}
                onReady={() => setStageReady(true)}
              />
            </div>

            {/* Strategy switcher — only while the strategy steps explain it. */}
            {step.showSwitcher && (
              <div className="htp-switcher">
                <StrategySwitcher
                  strategies={DEMO_STRATEGIES}
                  selectedIndex={sc.selIdx}
                  effectiveIndex={sc.effIdx}
                  pending={sc.pending}
                  progress={sc.prog}
                  onSelect={(i) => applyPatch({ selIdx: i, pending: i !== sc.effIdx })}
                  disabled={false}
                />
              </div>
            )}

            {/* In-scene info callout (health bar / super meter / strategies) */}
            {step.note && <SceneNote note={step.note} />}
          </div>
        </div>

        {!stageReady && <div className="htp-loading">Loading arena…</div>}
      </div>
    </div>
  );
}

// A small labelled callout pinned in the scene at design coords, with a caret
// pointing at the element it describes.
function SceneNote({ note }) {
  return (
    <div className="htp-note" style={{ left: note.x, top: note.y }}>
      {note.arrow === 'up' && <span className="htp-note-caret up" />}
      <span className="htp-note-text">{note.text}</span>
      {note.arrow === 'down' && <span className="htp-note-caret down" />}
    </div>
  );
}
