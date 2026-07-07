import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ArenaStage from './ArenaStage.jsx';
import StatusBars from './StatusBars.jsx';
import ArenaBackground from './ArenaBackground.jsx';
import ActionLabel from './ActionLabel.jsx';
import { LandscapeLock } from './design/DesignKit.jsx';
import { useFight } from '../hooks/useFight.js';
import { useFightRenderer } from '../hooks/useFightRenderer.js';
import { CHARACTERS } from '../data/characters.js';
import { startMusic, stopMusic, toggleMusic, isMusicPlaying, onMusicChange } from '../engine/soundEngine.js';
import { FIGHT_TIME_LIMIT_MS } from '../engine/fightEngine.js';

// Top-bar music on/off toggle. Reflects whether the theme is actually playing
// (so a cold reload, where audio isn't unlocked, shows OFF). Clicking unlocks
// audio + starts the theme, or mutes it — see soundEngine.toggleMusic.
function MusicToggle() {
  const [playing, setPlaying] = useState(isMusicPlaying());
  useEffect(() => onMusicChange(() => setPlaying(isMusicPlaying())), []);
  return (
    <button
      onClick={toggleMusic}
      className="btn-arena btn-arena-sm btn-arena-ghost"
      title={playing ? 'Music on — click to mute' : 'Music off — click to play'}
      aria-label={playing ? 'Mute music' : 'Play music'}
    >
      {playing ? '🔊' : '🔇'}
    </button>
  );
}

// Match countdown shown between the two HP meters. Counts down from the engine's
// time limit (armed by the `fight_start` event → status 'calling'), pauses while
// the fight is paused, and freezes when the match ends. Display-only — the engine
// clock in fightEngine is authoritative for the actual cutoff.
function FightTimer({ status, isPaused, timeLimitMs = FIGHT_TIME_LIMIT_MS }) {
  const active = status === 'calling' || status === 'animating';
  const ended = status === 'ko' || status === 'decision' || status === 'draw';

  const [remainingMs, setRemainingMs] = useState(timeLimitMs);
  const remainingRef = useRef(timeLimitMs);   // authoritative value across re-runs
  const lastTickRef = useRef(0);
  const wasActiveRef = useRef(false);

  // One effect owns the whole countdown. It re-runs on the active edge and on a
  // pause toggle (to re-base its tick clock); state is set ONLY inside the timer
  // callback — never synchronously in the effect body — so it stays lint-clean.
  useEffect(() => {
    if (!active) { wasActiveRef.current = false; return; }
    // Rising edge = a fresh fight just went live → re-arm to the full limit.
    if (!wasActiveRef.current) {
      wasActiveRef.current = true;
      remainingRef.current = timeLimitMs;
    }
    lastTickRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      if (isPaused) return;            // frozen while paused
      remainingRef.current = Math.max(0, remainingRef.current - dt);
      setRemainingMs(remainingRef.current);
    }, 200);
    return () => clearInterval(id);
  }, [active, isPaused, timeLimitMs]);

  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const low = remainingMs <= 10_000 && active;

  return (
    <div className={`fight-timer ${low ? 'low' : ''} ${ended ? 'ended' : ''}`}>
      {mm}:{String(ss).padStart(2, '0')}
    </div>
  );
}

// Fixed canvas design dimensions. All fighter positioning, motion offsets
// (PNG_MOTION) and projectile aim are tuned in this pixel space, so we render
// at this size and uniformly CSS-scale the canvas to fit the viewport. The
// arena background and HUD overlays stay at viewport size — only the
// canvas + sprite layer scales — so desktop output is unchanged.
const DESIGN_W = 1100;
// Tall enough that supermove arcs (peakY 400px above groundY) don't clip
// at the WebGL canvas boundary. groundY = DESIGN_H - 30 = 730; flyHit peak
// at y=330; a 300px sprite clears the top by ~30px.
const DESIGN_H = 760;

// Bottom-of-arena strategy switcher. One button per strategy (up to 3).
//   • The EFFECTIVE strategy (driving the current moves) is green.
//   • Tapping another marks it PENDING (orange) with a loader that fills across
//     the current 3-move batch — while the old one STAYS green (still active).
//   • When the loader fills, the orange takes over: it turns green and the old
//     green switches off.
// When nothing is pending, the single green button shows the same loader as a
// 3-move cycle indicator.
export function StrategySwitcher({
  strategies, selectedIndex, effectiveIndex, onSelect, disabled, pending, progress,
}) {
  if (!Array.isArray(strategies) || strategies.length === 0) return null;
  return (
    <div className="strategy-switcher">
      <div className="strategy-switcher-btns">
        {strategies.map((s, i) => {
          const name = (s?.name || '').trim() || `Strategy ${i + 1}`;
          const isEffective = i === effectiveIndex;
          const isPendingSel = pending && i === selectedIndex;
          const tone = isPendingSel ? 'pending' : isEffective ? 'live' : '';
          // Loader rides the incoming strategy: the pending (orange) one while a
          // switch is queued, otherwise the active (green) one.
          const showLoader = i === selectedIndex;
          return (
            <button
              key={i}
              type="button"
              className={`strategy-btn ${tone}`}
              onClick={() => !disabled && onSelect?.(i)}
              disabled={disabled}
              title={s?.text || name}
              aria-label={isPendingSel ? `${name} — taking over` : isEffective ? `${name} — active` : name}
            >
              {showLoader && (
                <span className={`strategy-btn-fill ${pending ? 'pending' : 'live'}`}
                      style={{ width: `${Math.round(progress * 100)}%` }} />
              )}
              <span className="strategy-btn-num">{i + 1}</span>
              <span className="strategy-btn-name">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// mode="host"      → runs its own fight via useFight (getMoves from fightConfig for P2P)
// mode="spectator" → renders fight events from fightEvents prop via useFightRenderer
// strategies / activeStrategyIndex / onSelectStrategy → live strategy switcher for
//   the local player (both bot matches and P2P rooms). Omitted → switcher hidden.
export default function Arena({ fighterA, fighterB, fightConfig = {}, onFightEnd, onForceNext, mode = 'host', fightEvents = [], randomBackground = false, onHome, strategies, activeStrategyIndex = 0, onSelectStrategy }) {
  // Keep a ref to the broadcast function so the fight loop always uses the latest
  // value without needing it in useCallback deps (avoids stale-closure issues).
  const broadcastRef = useRef(null);
  broadcastRef.current = fightConfig.onBroadcastEvent ?? null;

  // Landscape lock is scoped to the arena fight only: tag <body> on mount so
  // the rotate overlay (rendered below) shows on phones in portrait, then
  // remove on unmount so RoomPage's lobby/champion phases run portrait-first.
  useEffect(() => {
    document.body.classList.add('needs-landscape');
    return () => document.body.classList.remove('needs-landscape');
  }, []);

  // Measure the stage wrapper to compute a uniform scale that fits the
  // 1100×520 design surface inside the available area. Listens to
  // ResizeObserver (covers most cases) plus orientationchange/resize as a
  // safety net for iOS Safari's mid-rotate layout settle.
  const stageWrapperRef = useRef(null);
  const [stageScale, setStageScale] = useState(1);
  // Responsive action-callout font size: ~28px on desktop, shrinking on
  // narrow (mobile-landscape) arenas so the verb doesn't dwarf the fighters.
  const [calloutSize, setCalloutSize] = useState(28);
  useLayoutEffect(() => {
    if (!stageWrapperRef.current) return;
    let raf = 0;
    const compute = () => {
      const el = stageWrapperRef.current;
      if (!el) return;
      const w = el.clientWidth;
      // Mirror the 4vh paddingBottom on the fighter container so the canvas
      // doesn't overlap the ground edge on small screens.
      const padBottom = window.innerHeight * 0.04;
      const h = el.clientHeight - padBottom;
      if (w <= 0 || h <= 0) return;
      const s = Math.min(w / DESIGN_W, h / DESIGN_H, 1);
      setStageScale(s);
      setCalloutSize(Math.max(14, Math.min(28, Math.round(w / 32))));
    };
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(stageWrapperRef.current);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('resize', schedule);
    compute();
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const host = useFight(fighterA, fighterB, fightConfig, broadcastRef);
  const spectator = useFightRenderer();

  const { fightState, startFight, cancelFight, forceNextBatch } = host;
  const { handleFightEvent } = spectator;

  const activeFightState = mode === 'spectator' ? spectator.fightState : fightState;

  const {
    status, hpA, hpB,
    meterA, meterB, statusA, statusB,
    movesA, movesB, currentTurnIndex, completedTurns,
    animClassA, animClassB, animKeyA, animKeyB,
    shakeScreen, isPaused, timeLimitMs, batchNumber,
  } = activeFightState;

  // ── Live strategy tracking ────────────────────────────────────────────────
  // `activeStrategyIndex` is what the player SELECTED (read by the engine for the
  // NEXT batch). `effectiveIndex` is what's actually driving the CURRENT batch —
  // it catches up to the selection at each new batch. So a freshly-tapped
  // strategy shows as "pending" until the next 3 moves begin.
  const activeIndexRef = useRef(activeStrategyIndex);
  activeIndexRef.current = activeStrategyIndex;
  const [effectiveIndex, setEffectiveIndex] = useState(activeStrategyIndex);
  const lastBatchRef = useRef(0);
  useEffect(() => {
    if (batchNumber && batchNumber !== lastBatchRef.current) {
      lastBatchRef.current = batchNumber;
      // The batch's moves were just computed from the current selection.
      setEffectiveIndex(activeIndexRef.current);
    }
  }, [batchNumber]);
  // If the fight resets (batchNumber back to 0), realign to the selection.
  useEffect(() => {
    if (!batchNumber) { lastBatchRef.current = 0; setEffectiveIndex(activeStrategyIndex); }
  }, [batchNumber, activeStrategyIndex]);

  const strategyPending = activeStrategyIndex !== effectiveIndex;
  // Progress toward the switch: how far through the current batch of moves we are.
  const movesPerBatch = movesA.length || 3;
  const movesPlayed = Math.max(0, currentTurnIndex + 1);
  const switchProgress = Math.min(1, movesPlayed / movesPerBatch);   // 0 → 1
  const movesUntilSwitch = Math.max(0, movesPerBatch - movesPlayed); // 3 → 0

  // Once the loader is full (the last move of the batch has begun), flip a
  // pending selection to green immediately — don't wait out the gap before the
  // next batch's moves arrive.
  useEffect(() => {
    if (movesUntilSwitch === 0 && strategyPending) setEffectiveIndex(activeStrategyIndex);
  }, [movesUntilSwitch, strategyPending, activeStrategyIndex]);

  const currentActionA = currentTurnIndex >= 0 && movesA[currentTurnIndex] ? movesA[currentTurnIndex] : null;
  const currentActionB = currentTurnIndex >= 0 && movesB[currentTurnIndex] ? movesB[currentTurnIndex] : null;

  // A super_move requested without a full meter is coerced to idle by the
  // engine (see damageEngine.coerceAction). When the planned move was a super
  // but the actually-executed action this turn isn't, the callout strikes the
  // SUPERMOVE label through to read as "attempted, wasted".
  const turnResult = currentTurnIndex >= 0
    ? completedTurns?.find(t => t.index === currentTurnIndex)
    : null;
  const isSuper = (a) => typeof a === 'string' && a.startsWith('ultimate_');
  const wastedA = isSuper(currentActionA) && !!turnResult && !isSuper(turnResult.actionA);
  const wastedB = isSuper(currentActionB) && !!turnResult && !isSuper(turnResult.actionB);

  // ArenaStage signals readiness after sprites finish loading. Host fight start
  // is gated on this so the first batch's animations aren't dispatched before
  // sprites exist (see ArenaStage onReady note for the random-move race).
  const [stageReady, setStageReady] = useState(false);
  const handleStageReady = useCallback(() => setStageReady(true), []);

  // Host: start fight once stage is ready
  useEffect(() => {
    if (mode !== 'host' || !stageReady) return;
    let cancelled = false;
    const run = async () => {
      const result = await startFight();
      if (!cancelled && result && onFightEnd) onFightEnd(result);
    };
    run().catch(err => console.error('[Arena] fight error:', err));
    return () => { cancelled = true; cancelFight(); };
  }, [stageReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spectator: process ALL new events (not just the last — batched updates may skip events)
  const lastProcessedEventRef = useRef(0);
  useEffect(() => {
    if (mode !== 'spectator') return;
    const newEvents = fightEvents.slice(lastProcessedEventRef.current);
    newEvents.forEach(evt => handleFightEvent(evt));
    lastProcessedEventRef.current = fightEvents.length;
  }, [fightEvents]); // eslint-disable-line react-hooks/exhaustive-deps

  // Spectator: fire onFightEnd when fight concludes (host result arrives via events)
  const spectatorEndFiredRef = useRef(false);
  useEffect(() => {
    if (mode !== 'spectator') return;
    const s = spectator.fightState;
    if ((s.status === 'ko' || s.status === 'decision' || s.status === 'draw') && !spectatorEndFiredRef.current) {
      spectatorEndFiredRef.current = true;
      onFightEnd?.({ winner: s.winner, hpA: s.hpA, hpB: s.hpB });
    }
  }, [spectator.fightState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (onForceNext) onForceNext.current = forceNextBatch;
  }, [forceNextBatch, onForceNext]);

  // Music plays ONLY while a fight is on screen: start when a match becomes
  // active (AI call / animating), stop when it ends (KO / decision / draw), and
  // always stop when leaving the arena. Works for both bot and tournament since
  // both render through this component. startMusic is a no-op until audio is
  // unlocked, so a cold reload stays silent until the user toggles music on.
  useEffect(() => () => stopMusic(), []);
  useEffect(() => {
    if (status === 'ko' || status === 'decision' || status === 'draw') stopMusic();
    else if (status === 'calling' || status === 'animating') startMusic();
  }, [status]);

  const hasSpriteA = !!(fighterA?.character && CHARACTERS[fighterA.character]);
  const hasSpriteB = !!(fighterB?.character && CHARACTERS[fighterB.character]);
  const bgSeed = `${fighterA?.id || fighterA?.name}-${fighterB?.id || fighterB?.name}`;

  return (
    <div className={`h-screen flex flex-col overflow-x-hidden ${shakeScreen ? 'screen-shake' : ''}`}
         style={{ backgroundColor: 'var(--arena-bg)' }}>

      <LandscapeLock />

      {/* Controls bar — kept intentionally minimal: just Home + sound. The
          live status text (Calling AI / Round N / win label) and the batch
          progress bar were removed; fight state already reads off the HUD. */}
      <div
        className="flex items-center justify-between px-6 py-2 shrink-0"
        style={{ background: 'rgba(8,0,13,0.85)', borderBottom: '1px solid var(--arena-panel-border)' }}
      >
        <div className="flex items-center gap-2">
          {onHome && (
            <button
              onClick={onHome}
              className="btn-arena btn-arena-sm btn-arena-ghost"
              aria-label="Back to home"
            >
              ← Home
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <MusicToggle />
          {mode === 'spectator' && (
            <span className="section-label">Spectating</span>
          )}
        </div>
      </div>

      {/* Stage — the background is a single full-scene image that fills the
          arena (`cover`). It's anchored to the top so the sky/horizon stays in
          frame; the clip happens at the bottom (where the ground continues). */}
      <div ref={stageWrapperRef} className="flex-1 relative min-h-0 overflow-hidden">
        <ArenaBackground seed={bgSeed} random={randomBackground} fit="cover" position="center top">

          {/* Status bars */}
          <div style={{
            position: 'absolute', top: 16, left: 16, right: 16,
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            zIndex: 20, pointerEvents: 'none',
          }}>
            <StatusBars fighter={fighterA} hp={hpA} meter={meterA} status={statusA} side="A" />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 12px' }}>
              <FightTimer status={status} isPaused={isPaused} timeLimitMs={timeLimitMs} />
              <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-arena)', fontSize: 14, letterSpacing: 2 }}>
                VS
              </div>
            </div>
            <StatusBars fighter={fighterB} hp={hpB} meter={meterB} status={statusB} side="B" />
          </div>

          {/* Action callouts — Speed Streak verbs on each fighter's OUTER
              side (A pinned left, B pinned right), vertically around the
              fighter's torso. Replaces the old top-centre placement. */}
          {hasSpriteA && hasSpriteB && (
            <>
              <div style={{
                position: 'absolute', top: '70%', left: '16%',
                pointerEvents: 'none', zIndex: 15,
              }}>
                <ActionLabel action={currentActionA} characterId={fighterA.character} side="A" size={calloutSize} struck={wastedA} />
              </div>
              <div style={{
                position: 'absolute', top: '70%', right: '16%',
                pointerEvents: 'none', zIndex: 15,
              }}>
                <ActionLabel action={currentActionB} characterId={fighterB.character} side="B" size={calloutSize} struck={wastedB} />
              </div>
            </>
          )}

          {/* Fighters — canvas renders at fixed DESIGN_W×DESIGN_H and the
              wrapper applies a uniform CSS scale so it fits the available
              area on any viewport without disturbing pixel-tuned motion. */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            paddingBottom: '4vh', zIndex: 10,
          }}>
            {hasSpriteA && hasSpriteB ? (
              <div style={{
                width: DESIGN_W, height: DESIGN_H,
                position: 'relative',
                flexShrink: 0,
                transform: `scale(${stageScale})`,
                transformOrigin: 'center bottom',
              }}>
                <ArenaStage
                  characterAId={fighterA.character}
                  characterBId={fighterB.character}
                  animClassA={animClassA} animClassB={animClassB}
                  animKeyA={animKeyA} animKeyB={animKeyB}
                  plannedActionA={currentActionA} plannedActionB={currentActionB}
                  hpA={hpA} hpB={hpB}
                  width={DESIGN_W} height={DESIGN_H}
                  onReady={handleStageReady}
                />
              </div>
            ) : (
              // Character data hasn't arrived yet (joiner race: LOBBY_UPDATE
              // landed before FIGHT_START), or a character key is unknown.
              // Show a quiet placeholder instead of the legacy stick-figure
              // <Fighter> debug skeleton — once data syncs we'll re-render
              // into ArenaStage. The fight start gate keeps the loop paused
              // until then.
              <div style={{
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-arena)',
                letterSpacing: '0.2em',
                fontSize: 14,
                opacity: 0.7,
                paddingBottom: '8vh',
              }}>
                LOADING FIGHTERS…
              </div>
            )}
          </div>
        </ArenaBackground>
      </div>

      {/* Live strategy switcher (only when the player made more than one). Hidden
          once the match ends so it can't be tapped after the fight is over. */}
      {Array.isArray(strategies) && strategies.length > 1 && (
        <StrategySwitcher
          strategies={strategies}
          selectedIndex={activeStrategyIndex}
          effectiveIndex={effectiveIndex}
          pending={strategyPending}
          progress={switchProgress}
          onSelect={onSelectStrategy}
          disabled={status === 'ko' || status === 'decision' || status === 'draw'}
        />
      )}

      {/* Landscape toggle — fullscreen + orientation.lock both need a user
          gesture, so we trigger them from a button click. iOS Safari doesn't
          support orientation.lock; the fullscreen call still helps there. */}
      <button
        className="landscape-btn"
        onClick={async () => {
          try {
            const el = document.documentElement;
            if (el.requestFullscreen && !document.fullscreenElement) {
              await el.requestFullscreen();
            }
            if (screen.orientation && screen.orientation.lock) {
              await screen.orientation.lock('landscape');
            }
          } catch (e) {
            console.warn('[Arena] landscape lock failed:', e);
          }
        }}
      >
        ↻ LANDSCAPE
      </button>
    </div>
  );
}
