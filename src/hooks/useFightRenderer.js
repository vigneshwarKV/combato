import { useReducer, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { CHARACTERS } from '../data/characters.js';
import { hasUltimateHit, computeAttackTiming } from '../engine/animResolution.js';
import { planCombatSounds, playCombatPlan, preloadCombatClips, playWinnerSound } from '../engine/combatSounds.js';

const initialState = {
  status: 'idle',
  batchNumber: 0,
  hpA: 100, hpB: 100,
  meterA: 0, meterB: 0,
  statusA: [], statusB: [],
  movesA: [], movesB: [],
  currentTurnIndex: -1,
  completedTurns: [],
  history: [],
  winner: null,
  feedEntries: [],
  animClassA: 'anim-idle', animClassB: 'anim-idle',
  animKeyA: 0, animKeyB: 0,
  hitClassA: '', hitClassB: '',
  hitKeyA: 0, hitKeyB: 0,
  shakeScreen: false,
  isPaused: false,
  speedMultiplier: 1,
};

function buildFeedEntries(turn, actionA, actionB, damageToA, damageToB, events) {
  const entries = [];
  const prefix = `[T${turn}]`;
  const ultA = events?.find(e => e.type === 'ultimate' && e.attacker === 'A');
  const ultB = events?.find(e => e.type === 'ultimate' && e.attacker === 'B');
  const missA = events?.find(e => e.type === 'miss' && e.attacker === 'A');
  const missB = events?.find(e => e.type === 'miss' && e.attacker === 'B');
  const dotA = events?.find(e => e.type === 'dot' && e.victim === 'A');
  const dotB = events?.find(e => e.type === 'dot' && e.victim === 'B');
  const coerceA = events?.find(e => e.type === 'coerced' && e.fighter === 'A');
  const coerceB = events?.find(e => e.type === 'coerced' && e.fighter === 'B');
  const labelAction = (a, ult) => ult ? ult.name.toUpperCase() : (a || 'IDLE').toUpperCase();

  let textA = `${prefix} A: ${labelAction(actionA, ultA)}`;
  if (ultA)        textA += ` → ${damageToB} DMG!`;
  else if (missA)  textA += ` → MISS (${missA.reason})`;
  else if (damageToB > 0) textA += ` → ${damageToB} dmg`;
  if (coerceA)     textA += ` (forced: ${coerceA.reason})`;
  entries.push({ id: `t${turn}-a`, fighter: 'A', text: textA, highlight: !!ultA, isBatchSeparator: false });

  let textB = `${prefix} B: ${labelAction(actionB, ultB)}`;
  if (ultB)        textB += ` → ${damageToA} DMG!`;
  else if (missB)  textB += ` → MISS (${missB.reason})`;
  else if (damageToA > 0) textB += ` → ${damageToA} dmg`;
  if (coerceB)     textB += ` (forced: ${coerceB.reason})`;
  entries.push({ id: `t${turn}-b`, fighter: 'B', text: textB, highlight: !!ultB, isBatchSeparator: false });

  if (dotA) entries.push({ id: `t${turn}-dota`, fighter: 'A', text: `  ↳ A: ${dotA.damage} DoT dmg`, highlight: false, isBatchSeparator: false });
  if (dotB) entries.push({ id: `t${turn}-dotb`, fighter: 'B', text: `  ↳ B: ${dotB.damage} DoT dmg`, highlight: false, isBatchSeparator: false });
  return entries;
}

function reducer(state, action) {
  switch (action.type) {
    case 'BATCH_START':
      return {
        ...state,
        status: 'calling',
        batchNumber: action.batchNumber,
        movesA: action.movesA,
        movesB: action.movesB,
        currentTurnIndex: -1,
        completedTurns: [],
        meterA: action.meterA ?? state.meterA,
        meterB: action.meterB ?? state.meterB,
        feedEntries: [
          ...state.feedEntries,
          { id: `sep-${action.batchNumber}`, fighter: 'system', text: `— Batch ${action.batchNumber} begins —`, isBatchSeparator: true, highlight: false },
        ],
      };
    case 'ACTION_RESULT': {
      const { turn, batchTurn, actionA, actionB, damageToA, damageToB, events, hpA, hpB, meterA, meterB, statusA, statusB, initialAnimA, initialAnimB } = action;
      const newEntries = buildFeedEntries(turn, actionA, actionB, damageToA, damageToB, events);
      const hasKO = hpA <= 0 || hpB <= 0;
      const aGotUltHit = hasUltimateHit(events, 'A');
      const bGotUltHit = hasUltimateHit(events, 'B');
      // Subtract self-damage (e.g. Beast's Rocket Charge backlash) — only
      // opponent-inflicted damage should trigger the red hit-flash.
      const aSelfDmg = events?.filter(e => e.type === 'self_damage' && e.fighter === 'A').reduce((s, e) => s + (e.amount ?? 0), 0) ?? 0;
      const bSelfDmg = events?.filter(e => e.type === 'self_damage' && e.fighter === 'B').reduce((s, e) => s + (e.amount ?? 0), 0) ?? 0;
      const aOpponentDmg = damageToA - aSelfDmg;
      const bOpponentDmg = damageToB - bSelfDmg;
      const newHitClassA = aOpponentDmg > 0 ? (aGotUltHit ? 'anim-hit-super' : 'anim-hit-normal') : '';
      const newHitClassB = bOpponentDmg > 0 ? (bGotUltHit ? 'anim-hit-super' : 'anim-hit-normal') : '';
      // The dispatcher passes `initialAnim*` so it can hold a jumper in idle
      // until they should launch (sync jump peak with a slow projectile).
      // Falls back to the requested action when no deferral is needed.
      const animA = initialAnimA ?? actionA ?? 'idle';
      const animB = initialAnimB ?? actionB ?? 'idle';
      return {
        ...state, status: 'animating',
        currentTurnIndex: batchTurn,
        hpA, hpB, meterA, meterB,
        statusA: statusA || state.statusA, statusB: statusB || state.statusB,
        completedTurns: [...state.completedTurns, { index: batchTurn, actionA, actionB, damageToA, damageToB, events }],
        feedEntries: [...state.feedEntries, ...newEntries],
        animClassA: `anim-${animA}`, animClassB: `anim-${animB}`,
        animKeyA: state.animKeyA + 1, animKeyB: state.animKeyB + 1,
        hitClassA: newHitClassA, hitClassB: newHitClassB,
        hitKeyA: newHitClassA ? state.hitKeyA + 1 : state.hitKeyA,
        hitKeyB: newHitClassB ? state.hitKeyB + 1 : state.hitKeyB,
        shakeScreen: hasKO,
      };
    }
    case 'LAUNCH_ACTION_A': return { ...state, animClassA: `anim-${action.anim}`, animKeyA: state.animKeyA + 1 };
    case 'LAUNCH_ACTION_B': return { ...state, animClassB: `anim-${action.anim}`, animKeyB: state.animKeyB + 1 };
    case 'VICTIM_REACTION_A': return { ...state, animClassA: `anim-${action.reaction}`, animKeyA: state.animKeyA + 1 };
    case 'VICTIM_REACTION_B': return { ...state, animClassB: `anim-${action.reaction}`, animKeyB: state.animKeyB + 1 };
    case 'CLEAR_ANIM_A': return { ...state, animClassA: 'anim-idle', animKeyA: state.animKeyA + 1 };
    case 'CLEAR_ANIM_B': return { ...state, animClassB: 'anim-idle', animKeyB: state.animKeyB + 1 };
    case 'CLEAR_HIT': return { ...state, hitClassA: '', hitClassB: '' };
    case 'CLEAR_SHAKE': return { ...state, shakeScreen: false };
    case 'KO':
      return { ...state, status: 'ko', winner: action.winner, hpA: action.hpA, hpB: action.hpB,
        animClassA: action.winner === 'B' ? 'anim-death' : 'anim-celebrate',
        animClassB: action.winner === 'A' ? 'anim-death' : 'anim-celebrate' };
    case 'DECISION':
      return { ...state, status: 'decision', winner: action.winner,
        animClassA: action.winner === 'A' ? 'anim-celebrate' : 'anim-idle',
        animClassB: action.winner === 'B' ? 'anim-celebrate' : 'anim-idle' };
    case 'DRAW':
      return { ...state, status: 'draw', winner: 'draw', animClassA: 'anim-death', animClassB: 'anim-death' };
    case 'API_ERROR':
      return { ...state, feedEntries: [...state.feedEntries,
        { id: `err-${Date.now()}`, fighter: 'system', text: `⚠ Fighter ${action.fighter} API error — fallback moves`, isBatchSeparator: false, highlight: false }] };
    case 'TOGGLE_PAUSE': return { ...state, isPaused: !state.isPaused };
    case 'SET_SPEED': return { ...state, speedMultiplier: action.value };
    case 'RESET': return { ...initialState };
    default: return state;
  }
}

// Drives fight UI from externally-provided P2P events (no runFight).
// Used by spectator/joiner clients.
export function useFightRenderer() {
  const [fightState, dispatch] = useReducer(reducer, initialState);

  const handleFightEvent = useCallback((event) => {
    if (!event?.type) return;
    const { type: _evType, ...rest } = event;
    switch (event.type) {
      case 'batch_start':
        preloadCombatClips();   // warm the SFX cache so the first hit isn't delayed
        dispatch({ type: 'BATCH_START', ...rest });
        break;
      case 'action_result': {
        const charA = event.characterAId ? CHARACTERS[event.characterAId] : undefined;
        const charB = event.characterBId ? CHARACTERS[event.characterBId] : undefined;
        const timing = computeAttackTiming({
          events: event.events,
          actualActionA: event.actionA,
          actualActionB: event.actionB,
          damageToA: event.damageToA,
          damageToB: event.damageToB,
        }, charA, charB);
        dispatch({
          type: 'ACTION_RESULT',
          ...rest,
          initialAnimA: timing.initialAnimA,
          initialAnimB: timing.initialAnimB,
        });
        // Deferred launches (e.g., jumper synced to incoming projectile peak).
        if (timing.launchAnimA) {
          setTimeout(() => dispatch({ type: 'LAUNCH_ACTION_A', anim: timing.launchAnimA }), timing.launchAtA);
        }
        if (timing.launchAnimB) {
          setTimeout(() => dispatch({ type: 'LAUNCH_ACTION_B', anim: timing.launchAnimB }), timing.launchAtB);
        }
        // Victim reactions fire at `reactionAt*` — the attacker's visual
        // impact for melee/ult, or the jumper's landing time when a projectile
        // hit (e.g., womanHero's ice arrow) catches an airborne defender.
        // flushSync ensures the animClass commit + ArenaStage useEffect
        // (which cancels pending projectile timers) lands synchronously
        // before any same-tick projectile spawn timer fires.
        if (timing.reactionA) {
          setTimeout(() => flushSync(() => dispatch({ type: 'VICTIM_REACTION_A', reaction: timing.reactionA })), timing.reactionAtA);
        }
        if (timing.reactionB) {
          setTimeout(() => flushSync(() => dispatch({ type: 'VICTIM_REACTION_B', reaction: timing.reactionB })), timing.reactionAtB);
        }
        // Skip the idle-clear for a fighter that just got KO'd — the KO
        // event sets them to anim-death; an interim idle flash would jar.
        if (event.hpA > 0) setTimeout(() => dispatch({ type: 'CLEAR_ANIM_A' }), timing.clearA);
        if (event.hpB > 0) setTimeout(() => dispatch({ type: 'CLEAR_ANIM_B' }), timing.clearB);
        const hasUlt = event.events?.some(e => e.type === 'ultimate');
        setTimeout(() => dispatch({ type: 'CLEAR_HIT' }), hasUlt ? 1250 : 600);
        // Combat SFX (gunshots, hammer impacts, shield clangs). See combatSounds.
        playCombatPlan(planCombatSounds({
          events: event.events,
          actionA: event.actionA, actionB: event.actionB,
          charAId: event.characterAId, charBId: event.characterBId,
          charA, charB, timing,
        }));
        break;
      }
      case 'ko':
        dispatch({ type: 'KO', ...rest });
        playWinnerSound();   // winner celebrates
        setTimeout(() => dispatch({ type: 'CLEAR_SHAKE' }), 800);
        break;
      case 'decision':
        dispatch({ type: 'DECISION', ...rest });
        playWinnerSound();   // winner on HP celebrates
        break;
      case 'draw':
        dispatch({ type: 'DRAW', ...rest });
        break;
      case 'api_error':
        dispatch({ type: 'API_ERROR', ...rest });
        break;
    }
  }, []);

  const resetFight = useCallback(() => dispatch({ type: 'RESET' }), []);

  return { fightState, handleFightEvent, resetFight };
}

export { reducer, initialState };
