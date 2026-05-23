import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import ArenaStage from '../ArenaStage.jsx';
import { CHARACTERS, METER } from '../../data/characters.js';
import { resolveActions, validActionsForCharacter } from '../../engine/damageEngine.js';
import { computeAttackTiming } from '../../engine/animResolution.js';

// Hero-page random-action loop. Mirrors DevPage's "Random Attack" mode:
// real fight engine resolves the two picked actions, computeAttackTiming
// drives initial/launch/reaction/clear anim swaps, and a tick loop chains
// the next pair when the current cycle ends. No arena background — the
// ArenaStage canvas is transparent so the home page gradient shows through.
//
// Held to two fixed fighters so the home page doesn't surprise users with
// roster preview shuffling. Pick mad scientist (PNG) + beast (PNG) — both
// have a full action set including jet-pack ultimates.
const HOME_CHAR_A = 'madScientist';
const HOME_CHAR_B = 'beast';

// Design surface — the engine math (lunge distances, projectile arcs, ult
// jump heights) is tuned at this resolution. Height is intentionally taller
// than the visible home-arena slot so jet-pack ults can lift OVER the
// wordmark text. The slot CSS uses overflow: visible and z-index to let the
// canvas overhang upward; we width-scale only so vertical headroom is
// preserved at every viewport.
const STAGE_W = 900;
const STAGE_H = 600;

export default function HomeArena() {
  const charAId = HOME_CHAR_A;
  const charBId = HOME_CHAR_B;

  const [animClassA, setAnimClassA] = useState('anim-idle');
  const [animClassB, setAnimClassB] = useState('anim-idle');
  const [animKeyA, setAnimKeyA] = useState(0);
  const [animKeyB, setAnimKeyB] = useState(0);
  const [plannedA, setPlannedA] = useState('idle');
  const [plannedB, setPlannedB] = useState('idle');

  // Cancelable timer bag — every scheduled anim swap goes through here so a
  // late-arriving callback can't leak past a stop / unmount.
  const timersRef = useRef([]);
  const cancelTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };
  const schedule = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
    return id;
  };

  const loopRef = useRef(false);
  const loopTimerRef = useRef(null);

  // Run one pair through the real fight engine and schedule the anim swaps
  // its timing model produces. Returns the longest clear delay so the loop
  // knows when to queue the next pair.
  const fireWith = useCallback((actA, actB) => {
    cancelTimers();

    const result = resolveActions(
      actA, actB,
      charAId, charBId,
      METER.MAX, METER.MAX,
      [], [],
    );
    const charA = CHARACTERS[charAId];
    const charB = CHARACTERS[charBId];
    const timing = computeAttackTiming(result, charA, charB);

    setAnimClassA(`anim-${timing.initialAnimA}`);
    setAnimKeyA(k => k + 1);
    setAnimClassB(`anim-${timing.initialAnimB}`);
    setAnimKeyB(k => k + 1);

    if (timing.launchAnimA) {
      schedule(() => {
        setAnimClassA(`anim-${timing.launchAnimA}`);
        setAnimKeyA(k => k + 1);
      }, timing.launchAtA);
    }
    if (timing.launchAnimB) {
      schedule(() => {
        setAnimClassB(`anim-${timing.launchAnimB}`);
        setAnimKeyB(k => k + 1);
      }, timing.launchAtB);
    }
    if (timing.reactionA) {
      schedule(() => {
        flushSync(() => {
          setAnimClassA(`anim-${timing.reactionA}`);
          setAnimKeyA(k => k + 1);
        });
      }, timing.reactionAtA);
    }
    if (timing.reactionB) {
      schedule(() => {
        flushSync(() => {
          setAnimClassB(`anim-${timing.reactionB}`);
          setAnimKeyB(k => k + 1);
        });
      }, timing.reactionAtB);
    }
    schedule(() => {
      setAnimClassA('anim-idle');
      setAnimKeyA(k => k + 1);
    }, timing.clearA);
    schedule(() => {
      setAnimClassB('anim-idle');
      setAnimKeyB(k => k + 1);
    }, timing.clearB);

    return Math.max(timing.clearA, timing.clearB);
  }, [charAId, charBId]);

  // Random-pair tick: pick a non-idle action for each fighter, fire it,
  // queue the next pick once the current cycle clears. Same pacing as
  // DevPage's Random Attack loop (cycleMs + 400ms gap).
  useEffect(() => {
    loopRef.current = true;
    const pick = (id) => {
      const opts = validActionsForCharacter(id).filter(a => a !== 'none' && a !== 'idle');
      return opts[Math.floor(Math.random() * opts.length)];
    };
    const tick = () => {
      if (!loopRef.current) return;
      const a = pick(charAId);
      const b = pick(charBId);
      setPlannedA(a);
      setPlannedB(b);
      const cycleMs = fireWith(a, b);
      loopTimerRef.current = setTimeout(tick, cycleMs + 400);
    };
    // Brief delay so the canvas mounts + sprites finish initial load before
    // the first action fires (avoids a visible "idle then jump" snap).
    const start = setTimeout(tick, 800);
    return () => {
      loopRef.current = false;
      clearTimeout(start);
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      cancelTimers();
    };
  }, [fireWith, charAId, charBId]);

  // Fit the engine's fixed design surface inside whatever width the slot has.
  // Same pattern as Arena.jsx / DevPage — ResizeObserver + rAF debounce,
  // clamped to ≤ 1 so desktop never upscales the sprites.
  const wrapperRef = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (!wrapperRef.current) return;
    let raf = 0;
    const compute = () => {
      const el = wrapperRef.current;
      if (!el) return;
      const w = el.clientWidth;
      if (w <= 0) return;
      // Width-only fit, clamped to 1 so desktop never upscales sprites. We
      // deliberately don't constrain by slot height — the stage is allowed
      // (and expected) to overflow upward so jumps clear the wordmark.
      setScale(Math.min(w / STAGE_W, 1));
    };
    const sched = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    const ro = new ResizeObserver(sched);
    ro.observe(wrapperRef.current);
    window.addEventListener('orientationchange', sched);
    window.addEventListener('resize', sched);
    compute();
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', sched);
      window.removeEventListener('resize', sched);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="home-arena" ref={wrapperRef}>
      <div
        className="home-arena-stage"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          // translateX(-50%) is composed against the un-scaled width, so it
          // resolves to STAGE_W/2 — combined with `left: 50%` from CSS this
          // centers the stage horizontally regardless of `scale`.
          transform: `translateX(-50%) scale(${scale})`,
          transformOrigin: 'center bottom',
        }}
      >
        <ArenaStage
          characterAId={charAId}
          characterBId={charBId}
          animClassA={animClassA}
          animClassB={animClassB}
          animKeyA={animKeyA}
          animKeyB={animKeyB}
          plannedActionA={plannedA}
          plannedActionB={plannedB}
          width={STAGE_W}
          height={STAGE_H}
        />
      </div>
    </div>
  );
}
