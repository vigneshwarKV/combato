import { useCallback, useEffect, useRef, useState } from 'react';
import ArenaStage from './ArenaStage.jsx';
import StatusBars from './StatusBars.jsx';
import ArenaBackground from './ArenaBackground.jsx';
import ActionLabel from './ActionLabel.jsx';
import { useFight } from '../hooks/useFight.js';
import { useFightRenderer } from '../hooks/useFightRenderer.js';
import { CHARACTERS } from '../data/characters.js';

// mode="host"      → runs its own fight via useFight (getMoves from fightConfig for P2P)
// mode="spectator" → renders fight events from fightEvents prop via useFightRenderer
export default function Arena({ fighterA, fighterB, fightConfig = {}, onFightEnd, onForceNext, mode = 'host', fightEvents = [] }) {
  // Keep a ref to the broadcast function so the fight loop always uses the latest
  // value without needing it in useCallback deps (avoids stale-closure issues).
  const broadcastRef = useRef(null);
  broadcastRef.current = fightConfig.onBroadcastEvent ?? null;

  const stageContainerRef = useRef(null);
  const [stageWidth, setStageWidth] = useState(1100);
  useEffect(() => {
    if (!stageContainerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) setStageWidth(w);
    });
    ro.observe(stageContainerRef.current);
    return () => ro.disconnect();
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

      {/* Stage */}
      <div className="flex-1 relative min-h-0 overflow-visible">
        <ArenaBackground seed={bgSeed} parallax>

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

          {/* Fighters */}
          <div ref={stageContainerRef} style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            paddingBottom: '4vh', zIndex: 10,
          }}>
            {hasSpriteA && hasSpriteB ? (
              <ArenaStage
                characterAId={fighterA.character}
                characterBId={fighterB.character}
                animClassA={animClassA} animClassB={animClassB}
                animKeyA={animKeyA} animKeyB={animKeyB}
                plannedActionA={currentActionA} plannedActionB={currentActionB}
                hpA={hpA} hpB={hpB}
                width={stageWidth} height={520}
                onReady={handleStageReady}
              />
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
    </div>
  );
}
