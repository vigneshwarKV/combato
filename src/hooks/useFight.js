import { useReducer, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { runFight } from '../engine/fightEngine.js';
import { playSound } from '../engine/soundEngine.js';
import { isUltimateKey } from '../engine/damageEngine.js';
import { reducer, initialState } from './useFightRenderer.js';

const ANIM_DURATION = {
  idle: 500, jump: 900, hit: 800, shoot: 800,
  slide: 950, defend: 700, hurt: 500, death: 800, none: 500, ultimate: 1550,
};

export function useFight(fighterA, fighterB, fightConfig = {}, broadcastRef = null) {
  const [fightState, dispatch] = useReducer(reducer, initialState);
  const pauseRef     = useRef(false);
  const forceNextRef = useRef(false);
  const runningRef   = useRef(false);
  const fightGenRef  = useRef(0);

  const getDelay = useCallback(
    () => Math.round(2000 / (fightState.speedMultiplier || 1)),
    [fightState.speedMultiplier]
  );

  const startFight = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    dispatch({ type: 'RESET' });

    if (!runningRef.current) return;
    const thisGen = ++fightGenRef.current;

    const fA = { ...fighterA, hp: 100 };
    const fB = { ...fighterB, hp: 100 };

    const result = await runFight(fA, fB, {
      n: fightConfig.n || 3,
      maxBatches: fightConfig.maxBatches || 20,
      getDelay,
      pauseRef,
      forceNextRef,
      getMoves: fightConfig.getMoves,
      defaults: fightConfig.defaults || {},
    }, (event) => {
      if (fightGenRef.current !== thisGen) return;
      // Broadcast to P2P clients — use ref so it's always current, no stale closure
      broadcastRef?.current?.(event);
      const { type: _evType, ...rest } = event;
      switch (event.type) {
        case 'batch_start':
          flushSync(() => dispatch({ type: 'BATCH_START', ...rest }));
          break;
        case 'action_result': {
          if (isUltimateKey(event.actionA) || isUltimateKey(event.actionB)) {
            playSound('supermove_charge');
          }
          flushSync(() => dispatch({ type: 'ACTION_RESULT', ...rest }));
          const durFor = (a) => isUltimateKey(a) ? ANIM_DURATION.ultimate : (ANIM_DURATION[a] || 500);
          const dur = Math.max(durFor(event.actionA), durFor(event.actionB));
          setTimeout(() => { if (fightGenRef.current === thisGen) dispatch({ type: 'CLEAR_ANIM' }); }, dur);
          const hasUlt = event.events?.some(e => e.type === 'ultimate');
          setTimeout(() => { if (fightGenRef.current === thisGen) dispatch({ type: 'CLEAR_HIT' }); }, hasUlt ? 1250 : 600);
          setTimeout(() => {
            if (fightGenRef.current !== thisGen) return;
            if (hasUlt) playSound('super_hit');
            else if (event.damageToA > 0 || event.damageToB > 0) playSound('hit');
          }, hasUlt ? 380 : 180);
          break;
        }
        case 'ko':
          flushSync(() => dispatch({ type: 'KO', ...rest }));
          playSound('ko');
          setTimeout(() => { if (fightGenRef.current === thisGen) dispatch({ type: 'CLEAR_SHAKE' }); }, 800);
          break;
        case 'decision':
          flushSync(() => dispatch({ type: 'DECISION', ...rest }));
          break;
        case 'draw':
          flushSync(() => dispatch({ type: 'DRAW', ...rest }));
          playSound('ko');
          break;
        case 'api_error':
          flushSync(() => dispatch({ type: 'API_ERROR', ...rest }));
          break;
      }
    });

    runningRef.current = false;
    return result;
  }, [fighterA, fighterB, fightConfig, getDelay]);

  const pauseFight     = useCallback(() => { pauseRef.current = true;  dispatch({ type: 'TOGGLE_PAUSE' }); }, []);
  const resumeFight    = useCallback(() => { pauseRef.current = false; dispatch({ type: 'TOGGLE_PAUSE' }); }, []);
  const forceNextBatch = useCallback(() => { forceNextRef.current = true; }, []);
  const setSpeed       = useCallback((value) => dispatch({ type: 'SET_SPEED', value }), []);
  const cancelFight    = useCallback(() => { fightGenRef.current++; runningRef.current = false; }, []);

  return { fightState, startFight, cancelFight, pauseFight, resumeFight, forceNextBatch, setSpeed };
}
