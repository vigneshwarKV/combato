import { useReducer, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { CHARACTERS } from '../data/characters.js';
import { computeAttackTiming } from '../engine/animResolution.js';
import { planCombatSounds, playCombatPlan, preloadCombatClips, playWinnerSound } from '../engine/combatSounds.js';
import { FIGHT_TIME_LIMIT_MS } from '../engine/fightEngine.js';

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
  shakeScreen: false,
  isPaused: false,
  speedMultiplier: 1,
  timeLimitMs: FIGHT_TIME_LIMIT_MS,
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

// When to commit the hp / meter bars for a turn: the moment the attack(s)
// visually land — the later of the two victim reactions, floored by the
// impact times so meter-only turns (no damage) still settle at contact rather
// than at the start of the movement.
function barCommitAt(timing) {
  return Math.max(
    timing.reactionA ? timing.reactionAtA : 0,
    timing.reactionB ? timing.reactionAtB : 0,
    timing.impactA || 0,
    timing.impactB || 0,
  );
}

function reducer(state, action) {
  switch (action.type) {
    case 'FIGHT_START':
      // Real fight-start instant — arms the HUD timer (and music) before the
      // first batch. Carries the engine's authoritative time limit.
      return { ...state, status: 'calling', timeLimitMs: action.timeLimitMs ?? state.timeLimitMs };
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
      // NB: hp/meter/status bars are NOT committed here — they're applied by a
      // deferred COMMIT_BARS dispatch when the attack visually lands (impact /
      // reaction time), so the bars drop at the climax of the movement rather
      // than the instant it starts.
      const { turn, batchTurn, actionA, actionB, damageToA, damageToB, events, initialAnimA, initialAnimB } = action;
      const newEntries = buildFeedEntries(turn, actionA, actionB, damageToA, damageToB, events);
      // The dispatcher passes `initialAnim*` so it can hold a jumper in idle
      // until they should launch (sync jump peak with a slow projectile).
      // Falls back to the requested action when no deferral is needed.
      const animA = initialAnimA ?? actionA ?? 'idle';
      const animB = initialAnimB ?? actionB ?? 'idle';
      return {
        ...state, status: 'animating',
        currentTurnIndex: batchTurn,
        completedTurns: [...state.completedTurns, { index: batchTurn, actionA, actionB, damageToA, damageToB, events }],
        feedEntries: [...state.feedEntries, ...newEntries],
        animClassA: `anim-${animA}`, animClassB: `anim-${animB}`,
        animKeyA: state.animKeyA + 1, animKeyB: state.animKeyB + 1,
      };
    }
    case 'COMMIT_BARS': {
      // Apply the post-turn hp / super-meter / status values when the hit lands.
      const hasKO = action.hpA <= 0 || action.hpB <= 0;
      return {
        ...state,
        hpA: action.hpA, hpB: action.hpB,
        meterA: action.meterA, meterB: action.meterB,
        statusA: action.statusA || state.statusA, statusB: action.statusB || state.statusB,
        shakeScreen: hasKO || state.shakeScreen,
      };
    }
    case 'LAUNCH_ACTION_A': return { ...state, animClassA: `anim-${action.anim}`, animKeyA: state.animKeyA + 1 };
    case 'LAUNCH_ACTION_B': return { ...state, animClassB: `anim-${action.anim}`, animKeyB: state.animKeyB + 1 };
    case 'VICTIM_REACTION_A': return { ...state, animClassA: `anim-${action.reaction}`, animKeyA: state.animKeyA + 1 };
    case 'VICTIM_REACTION_B': return { ...state, animClassB: `anim-${action.reaction}`, animKeyB: state.animKeyB + 1 };
    case 'CLEAR_ANIM_A': return { ...state, animClassA: 'anim-idle', animKeyA: state.animKeyA + 1 };
    case 'CLEAR_ANIM_B': return { ...state, animClassB: 'anim-idle', animKeyB: state.animKeyB + 1 };
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
      case 'fight_start':
        dispatch({ type: 'FIGHT_START', ...rest });
        break;
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
        // Commit the hp / super-meter bars when the attack lands, not at the
        // start of the movement.
        setTimeout(() => dispatch({
          type: 'COMMIT_BARS',
          hpA: event.hpA, hpB: event.hpB,
          meterA: event.meterA, meterB: event.meterB,
          statusA: event.statusA, statusB: event.statusB,
        }), barCommitAt(timing));
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

export { reducer, initialState, barCommitAt };
