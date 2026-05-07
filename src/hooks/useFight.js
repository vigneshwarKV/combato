import { useReducer, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { runFight } from '../engine/fightEngine.js';
import { playSound } from '../engine/soundEngine.js';
import { isUltimateKey } from '../engine/damageEngine.js';
import { CHARACTERS } from '../data/characters.js';
import { computeAttackTiming } from '../engine/animResolution.js';
import { reducer, initialState } from './useFightRenderer.js';

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
      // Tag character IDs onto every event so spectators (and our own
      // dispatcher) can read per-character timing without extra plumbing.
      const tagged = (event.type === 'action_result' || event.type === 'batch_start')
        ? { ...event, characterAId: fA.character, characterBId: fB.character }
        : event;
      broadcastRef?.current?.(tagged);
      const { type: _evType, ...rest } = tagged;
      switch (event.type) {
        case 'batch_start':
          flushSync(() => dispatch({ type: 'BATCH_START', ...rest }));
          break;
        case 'action_result': {
          if (isUltimateKey(event.actionA) || isUltimateKey(event.actionB)) {
            playSound('supermove_charge');
          }
          const charA = CHARACTERS[fA.character];
          const charB = CHARACTERS[fB.character];
          const timing = computeAttackTiming({
            events: event.events,
            actualActionA: event.actionA,
            actualActionB: event.actionB,
            damageToA: event.damageToA,
            damageToB: event.damageToB,
          }, charA, charB);
          flushSync(() => dispatch({
            type: 'ACTION_RESULT',
            ...rest,
            initialAnimA: timing.initialAnimA,
            initialAnimB: timing.initialAnimB,
          }));
          // Deferred launches (e.g., jumper synced to incoming projectile peak).
          if (timing.launchAnimA) {
            setTimeout(() => {
              if (fightGenRef.current === thisGen) dispatch({ type: 'LAUNCH_ACTION_A', anim: timing.launchAnimA });
            }, timing.launchAtA);
          }
          if (timing.launchAnimB) {
            setTimeout(() => {
              if (fightGenRef.current === thisGen) dispatch({ type: 'LAUNCH_ACTION_B', anim: timing.launchAnimB });
            }, timing.launchAtB);
          }
          // Victim reactions land at `reactionAt*` — typically the attacker's
          // visual impact, but deferred to landing time when a projectile hit
          // (e.g., womanHero) catches a jumping defender.
          if (timing.reactionA) {
            setTimeout(() => {
              if (fightGenRef.current === thisGen) dispatch({ type: 'VICTIM_REACTION_A', reaction: timing.reactionA });
            }, timing.reactionAtA);
          }
          if (timing.reactionB) {
            setTimeout(() => {
              if (fightGenRef.current === thisGen) dispatch({ type: 'VICTIM_REACTION_B', reaction: timing.reactionB });
            }, timing.reactionAtB);
          }
          // Skip the idle-clear for a fighter that just got KO'd — the KO
          // event will set them to anim-death, and we don't want a brief
          // idle flash between death anim and KO dispatch.
          if (event.hpA > 0) {
            setTimeout(() => { if (fightGenRef.current === thisGen) dispatch({ type: 'CLEAR_ANIM_A' }); }, timing.clearA);
          }
          if (event.hpB > 0) {
            setTimeout(() => { if (fightGenRef.current === thisGen) dispatch({ type: 'CLEAR_ANIM_B' }); }, timing.clearB);
          }
          const hasUlt = event.events?.some(e => e.type === 'ultimate');
          setTimeout(() => { if (fightGenRef.current === thisGen) dispatch({ type: 'CLEAR_HIT' }); }, hasUlt ? 1250 : 600);
          // Sound at the earliest reaction moment — aligns the thump with the
          // visible "ouch" (which is the landing for projectile-vs-jumper).
          const impactSoundDelay = (() => {
            const hits = [];
            if (timing.reactionA) hits.push(timing.reactionAtA);
            if (timing.reactionB) hits.push(timing.reactionAtB);
            return hits.length ? Math.min(...hits) : null;
          })();
          if (impactSoundDelay != null) {
            setTimeout(() => {
              if (fightGenRef.current !== thisGen) return;
              if (hasUlt) playSound('super_hit');
              else playSound('hit');
            }, impactSoundDelay);
          }
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
