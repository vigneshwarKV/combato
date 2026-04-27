import { useReducer, useCallback } from 'react';
import { isUltimateKey } from '../engine/damageEngine.js';
import { playSound } from '../engine/soundEngine.js';

const ANIM_DURATION = {
  idle: 500, jump: 900, melee: 700, ranged: 800,
  dodge: 600, hurt: 500, death: 800, none: 500, ultimate: 1200,
};

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

function hasUltimateHit(events, victim) {
  return events?.some(e => e.type === 'ultimate' && e.victim === victim) || false;
}

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
      const { turn, batchTurn, actionA, actionB, damageToA, damageToB, events, hpA, hpB, meterA, meterB, statusA, statusB } = action;
      const newEntries = buildFeedEntries(turn, actionA, actionB, damageToA, damageToB, events);
      const hasKO = hpA <= 0 || hpB <= 0;
      const newHitClassA = damageToA > 0 ? (hasUltimateHit(events, 'A') ? 'anim-hit-super' : 'anim-hit-normal') : '';
      const newHitClassB = damageToB > 0 ? (hasUltimateHit(events, 'B') ? 'anim-hit-super' : 'anim-hit-normal') : '';
      return {
        ...state, status: 'animating',
        currentTurnIndex: batchTurn,
        hpA, hpB, meterA, meterB,
        statusA: statusA || state.statusA, statusB: statusB || state.statusB,
        completedTurns: [...state.completedTurns, { index: batchTurn, actionA, actionB, damageToA, damageToB, events }],
        feedEntries: [...state.feedEntries, ...newEntries],
        animClassA: `anim-${actionA || 'idle'}`, animClassB: `anim-${actionB || 'idle'}`,
        animKeyA: state.animKeyA + 1, animKeyB: state.animKeyB + 1,
        hitClassA: newHitClassA, hitClassB: newHitClassB,
        hitKeyA: newHitClassA ? state.hitKeyA + 1 : state.hitKeyA,
        hitKeyB: newHitClassB ? state.hitKeyB + 1 : state.hitKeyB,
        shakeScreen: hasKO,
      };
    }
    case 'CLEAR_ANIM': return { ...state, animClassA: 'anim-idle', animClassB: 'anim-idle' };
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
        dispatch({ type: 'BATCH_START', ...rest });
        break;
      case 'action_result': {
        if (isUltimateKey(event.actionA) || isUltimateKey(event.actionB)) {
          playSound('supermove_charge');
        }
        dispatch({ type: 'ACTION_RESULT', ...rest });
        const durFor = (a) => isUltimateKey(a) ? ANIM_DURATION.ultimate : (ANIM_DURATION[a] || 500);
        const dur = Math.max(durFor(event.actionA), durFor(event.actionB));
        setTimeout(() => dispatch({ type: 'CLEAR_ANIM' }), dur);
        const hasUlt = event.events?.some(e => e.type === 'ultimate');
        setTimeout(() => dispatch({ type: 'CLEAR_HIT' }), hasUlt ? 1250 : 600);
        setTimeout(() => {
          if (hasUlt) playSound('super_hit');
          else if (event.damageToA > 0 || event.damageToB > 0) playSound('hit');
        }, hasUlt ? 380 : 180);
        break;
      }
      case 'ko':
        dispatch({ type: 'KO', ...rest });
        playSound('ko');
        setTimeout(() => dispatch({ type: 'CLEAR_SHAKE' }), 800);
        break;
      case 'decision':
        dispatch({ type: 'DECISION', ...rest });
        break;
      case 'draw':
        dispatch({ type: 'DRAW', ...rest });
        playSound('ko');
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
