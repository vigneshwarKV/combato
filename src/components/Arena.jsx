import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ArenaStage from './ArenaStage.jsx';
import StatusBars from './StatusBars.jsx';
import ArenaBackground from './ArenaBackground.jsx';
import ActionLabel from './ActionLabel.jsx';
import { LandscapeLock } from './design/DesignKit.jsx';
import { useFight } from '../hooks/useFight.js';
import { useFightRenderer } from '../hooks/useFightRenderer.js';
import { CHARACTERS } from '../data/characters.js';

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

// mode="host"      → runs its own fight via useFight (getMoves from fightConfig for P2P)
// mode="spectator" → renders fight events from fightEvents prop via useFightRenderer
export default function Arena({ fighterA, fighterB, fightConfig = {}, onFightEnd, onForceNext, mode = 'host', fightEvents = [] }) {
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

  const { fightState, startFight, cancelFight, pauseFight, resumeFight, forceNextBatch, setSpeed } = host;
  const { handleFightEvent } = spectator;

  const activeFightState = mode === 'spectator' ? spectator.fightState : fightState;

  const {
    status, batchNumber, hpA, hpB,
    meterA, meterB, statusA, statusB,
    movesA, movesB, currentTurnIndex,
    winner,
    animClassA, animClassB, animKeyA, animKeyB,
    hitClassA, hitClassB, hitKeyA, hitKeyB,
    shakeScreen,
    isPaused, speedMultiplier,
  } = activeFightState;

  const currentActionA = currentTurnIndex >= 0 && movesA[currentTurnIndex] ? movesA[currentTurnIndex] : null;
  const currentActionB = currentTurnIndex >= 0 && movesB[currentTurnIndex] ? movesB[currentTurnIndex] : null;

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

  const maxBatches = fightConfig.maxBatches || 20;
  const progressPct = Math.round((batchNumber / maxBatches) * 100);

  const statusLabel = () => {
    if (status === 'idle' || status === 'calling') return 'Calling AI…';
    if (status === 'ko') return winner === 'A' ? `${fighterA.name} WINS!` : `${fighterB.name} WINS!`;
    if (status === 'decision') return winner === 'A' ? `${fighterA.name} wins on HP` : `${fighterB.name} wins on HP`;
    if (status === 'draw') return 'DRAW — Both Eliminated!';
    return `Round ${batchNumber}`;
  };

  const hasSpriteA = !!(fighterA?.character && CHARACTERS[fighterA.character]);
  const hasSpriteB = !!(fighterB?.character && CHARACTERS[fighterB.character]);
  const bgSeed = `${fighterA?.id || fighterA?.name}-${fighterB?.id || fighterB?.name}`;

  return (
    <div className={`h-screen flex flex-col overflow-x-hidden ${shakeScreen ? 'screen-shake' : ''}`}
         style={{ backgroundColor: 'var(--arena-bg)' }}>

      <LandscapeLock />

      {/* Controls bar */}
      <div
        className="flex items-center justify-between px-6 py-2 shrink-0"
        style={{ background: 'rgba(8,0,13,0.85)', borderBottom: '1px solid var(--arena-panel-border)' }}
      >
        <div className="flex items-center gap-4">
          <span className="font-arena text-sm" style={{ color: 'var(--neon-gold)', letterSpacing: '0.1em' }}>
            {statusLabel()}
          </span>
          {status === 'animating' && (
            <div className="flex items-center gap-2">
              <div className="w-32 h-1" style={{ background: 'var(--arena-panel-border)', borderRadius: 2, overflow: 'hidden' }}>
                <div className="h-full transition-all duration-300" style={{ width: `${progressPct}%`, background: 'var(--neon-gold)' }} />
              </div>
            </div>
          )}
        </div>
        {mode === 'host' && (
          <div className="flex gap-2">
            <button
              onClick={isPaused ? resumeFight : pauseFight}
              className="btn-arena btn-arena-sm btn-arena-ghost"
            >
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button
              onClick={() => setSpeed(speedMultiplier === 1 ? 2 : 1)}
              className="btn-arena btn-arena-sm btn-arena-ghost"
            >
              {speedMultiplier === 1 ? '2x' : '1x'}
            </button>
          </div>
        )}
        {mode === 'spectator' && (
          <span className="section-label">Spectating</span>
        )}
      </div>

      {/* Stage — the background is a single full-scene image that fills the
          arena (`cover`). It's anchored to the top so the sky/horizon stays in
          frame; the clip happens at the bottom (where the ground continues). */}
      <div ref={stageWrapperRef} className="flex-1 relative min-h-0 overflow-hidden">
        <ArenaBackground seed={bgSeed} fit="cover" position="center top">

          {/* Status bars */}
          <div style={{
            position: 'absolute', top: 16, left: 16, right: 16,
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            zIndex: 20, pointerEvents: 'none',
          }}>
            <StatusBars fighter={fighterA} hp={hpA} meter={meterA} status={statusA} side="A" />
            <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-arena)', fontSize: 18, padding: '8px 16px', letterSpacing: 2 }}>
              VS
            </div>
            <StatusBars fighter={fighterB} hp={hpB} meter={meterB} status={statusB} side="B" />
          </div>

          {/* Action labels — each label sits above its fighter (left-half /
              right-half columns roughly track the sprite x positions chosen
              by ArenaStage). */}
          {hasSpriteA && hasSpriteB && (
            <div style={{
              position: 'absolute', top: '14%', left: 0, right: 0,
              display: 'flex',
              pointerEvents: 'none', zIndex: 15,
            }}>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <ActionLabel action={currentActionA} characterId={fighterA.character} side="A" />
              </div>
              <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <ActionLabel action={currentActionB} characterId={fighterB.character} side="B" />
              </div>
            </div>
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
