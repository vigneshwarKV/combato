import { resolveActions } from './damageEngine.js';
import { buildFighterPrompt, callAI, getFallback } from './prompts.js';
import { CHARACTERS } from '../data/characters.js';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Hard fight length. With no round/batch cap, this is the ONLY automatic end
// condition besides a KO: when it elapses (excluding paused time) the fight
// goes to a decision — higher HP wins, equal HP draws.
export const FIGHT_TIME_LIMIT_MS = 90_000; // 1 min 30 sec

/**
 * Run a complete fight between two fighters.
 *
 * @param {object} fighterA - { id, name, hp, prompt, promptMode, color, character }
 * @param {object} fighterB - same shape
 * @param {object} fightConfig - { n, getDelay, pauseRef, forceNextRef, defaults }
 * @param {function} onEvent - callback for each fight event
 */
export async function runFight(fighterA, fighterB, fightConfig, onEvent) {
  const { n = 3, getDelay = () => 800, pauseRef, forceNextRef, defaults = {}, shouldCancel = () => false } = fightConfig;

  const charIdA = fighterA.character || fallbackCharacter(fighterA);
  const charIdB = fighterB.character || fallbackCharacter(fighterB);

  let hpA = fighterA.hp ?? 100;
  let hpB = fighterB.hp ?? 100;
  let meterA = 0;
  let meterB = 0;
  let statusA = [];
  let statusB = [];

  let batchNumber = 0;
  const history = [];
  let winner = null;

  const TIME_LIMIT = FIGHT_TIME_LIMIT_MS;
  const fightStartTime = Date.now();
  let pausedTime = 0;

  const fightStateA = () => ({ n, batchNumber, history, meter: meterA, opponentMeter: meterB, status: statusA, opponentStatus: statusB });
  const fightStateB = () => ({ n, batchNumber, history: historyForB(), meter: meterB, opponentMeter: meterA, status: statusB, opponentStatus: statusA });

  const isTimeUp = () => (Date.now() - fightStartTime - pausedTime) >= TIME_LIMIT;

  // Snapshot returned when the fight is cancelled mid-run (the owning Arena
  // unmounted — e.g. this match ended and the next is spinning up, or the host
  // left). Lets runFight bail out of its loop instead of running on in the
  // background making AI calls and emitting events into a dead fight. The caller
  // (useFight) suppresses onFightEnd for a cancelled run via its own unmount flag.
  const cancelledResult = () => ({ winner: null, winnerId: null, hpA, hpB, meterA, meterB, history, cancelled: true });

  // History perspective flip: B sees "my moves" as movesB in raw history. Swap
  // the per-turn outcome fields too — both damage AND the actual executed action
  // — so any consumer reading outcome.actionA always gets "my" action regardless
  // of side (buildActionHistory relies on this to log the real move per fighter).
  const historyForB = () =>
    history.map(batch => ({
      ...batch,
      movesA: batch.movesB,
      movesB: batch.movesA,
      outcomes: batch.outcomes.map(o => ({
        ...o,
        damageToA: o.damageToB,
        damageToB: o.damageToA,
        actionA: o.actionB,
        actionB: o.actionA,
      })),
    }));

  // Announce the real start instant so the HUD countdown aligns with this
  // engine clock. The match runs until a KO or the time limit — no round cap.
  onEvent({ type: 'fight_start', timeLimitMs: TIME_LIMIT });

  while (!winner && !isTimeUp()) {
    if (shouldCancel()) return cancelledResult();
    batchNumber++;

    while (pauseRef?.current && !shouldCancel()) {
      const pauseStart = Date.now();
      await delay(200);
      pausedTime += Date.now() - pauseStart;
    }

    let rawA, rawB;
    if (fightConfig.getMoves) {
      // P2P mode: delegate move collection to the host hook
      const context = {
        n, hpA, hpB, meterA, meterB,
        statusA: [...statusA], statusB: [...statusB],
        history: history.slice(-3),
      };
      [rawA, rawB] = await fightConfig.getMoves(batchNumber, context);
    } else {
      // A `randomOnly` fighter (e.g. the bot opponent) never hits the AI proxy —
      // it always plays the random fallback, regardless of any prompt/API key.
      const aiOrRandom = (fighter, self, opp, state) =>
        fighter.randomOnly
          ? Promise.resolve(null)
          : callAI(fighter, buildFighterPrompt(self, opp, state), defaults);

      [rawA, rawB] = await Promise.all([
        aiOrRandom(
          { ...fighterA, character: charIdA },
          { ...fighterA, hp: hpA, character: charIdA },
          { ...fighterB, hp: hpB, character: charIdB },
          fightStateA()
        ),
        aiOrRandom(
          { ...fighterB, character: charIdB },
          { ...fighterB, hp: hpB, character: charIdB },
          { ...fighterA, hp: hpA, character: charIdA },
          fightStateB()
        ),
      ]);
    }

    if (shouldCancel()) return cancelledResult();

    const resolveMoves = (raw, charId, meter) => {
      if (!raw || !Array.isArray(raw) || raw.length !== n) return getFallback(n, charId, meter);
      return raw;
    };
    const movesA = resolveMoves(rawA, charIdA, meterA);
    const movesB = resolveMoves(rawB, charIdB, meterB);

    // A randomOnly fighter's null is an intentional random turn, not a failure.
    if (!fighterA.randomOnly && (!rawA || !Array.isArray(rawA) || rawA.length !== n)) {
      onEvent({ type: 'api_error', fighter: 'A', fallbackUsed: true });
    }
    if (!fighterB.randomOnly && (!rawB || !Array.isArray(rawB) || rawB.length !== n)) {
      onEvent({ type: 'api_error', fighter: 'B', fallbackUsed: true });
    }

    onEvent({ type: 'batch_start', batchNumber, movesA: [...movesA], movesB: [...movesB], hpA, hpB, meterA, meterB });

    const batchOutcomes = [];

    for (let i = 0; i < n; i++) {
      while (pauseRef?.current) {
        const pauseStart = Date.now();
        await delay(200);
        pausedTime += Date.now() - pauseStart;
      }

      const requestedA = movesA[i];
      const requestedB = movesB[i];

      const result = resolveActions(
        requestedA, requestedB,
        charIdA, charIdB,
        meterA, meterB,
        statusA, statusB
      );

      hpA = Math.max(0, hpA - result.damageToA);
      hpB = Math.max(0, hpB - result.damageToB);
      meterA = result.newMeterA;
      meterB = result.newMeterB;
      statusA = result.newStatusA;
      statusB = result.newStatusB;

      const turnResult = {
        turn: (batchNumber - 1) * n + i + 1,
        batchTurn: i,
        actionA: result.actualActionA,
        actionB: result.actualActionB,
        requestedA,
        requestedB,
        damageToA: result.damageToA,
        damageToB: result.damageToB,
        events: result.events,
        hpA, hpB,
        meterA, meterB,
        statusA: [...statusA],
        statusB: [...statusB],
      };

      batchOutcomes.push({
        turn: i + 1,
        damageToA: result.damageToA,
        damageToB: result.damageToB,
        actionA: result.actualActionA,
        actionB: result.actualActionB,
      });

      onEvent({ type: 'action_result', ...turnResult });

      const animMs = getDelay();
      const waitMs = forceNextRef?.current ? 50 : animMs;
      if (forceNextRef) forceNextRef.current = false;
      await delay(waitMs);

      if (shouldCancel()) return cancelledResult();

      if (hpA <= 0 || hpB <= 0) {
        winner = hpA <= 0 && hpB <= 0
          ? (hpA <= hpB ? 'B' : 'A')
          : hpA <= 0 ? 'B' : 'A';
        onEvent({ type: 'ko', winner, hpA, hpB });
        break;
      }

      if (isTimeUp()) break;
    }

    history.push({
      batch: batchNumber,
      movesA: [...movesA],
      movesB: [...movesB],
      outcomes: batchOutcomes,
    });

    if (winner) break;
  }

  if (shouldCancel()) return cancelledResult();

  if (!winner) {
    if (hpA === hpB) {
      winner = 'draw';
      onEvent({ type: 'draw', hpA, hpB });
    } else {
      winner = hpA > hpB ? 'A' : 'B';
      onEvent({ type: 'decision', winner, hpA, hpB });
    }
  }

  return {
    winner,
    winnerId: winner === 'draw' ? null : (winner === 'A' ? fighterA.id : fighterB.id),
    hpA, hpB,
    meterA, meterB,
    history,
  };
}

function fallbackCharacter(fighter) {
  // If a fighter has no character assigned, pick a stable default based on id hash.
  const ids = Object.keys(CHARACTERS);
  const id = fighter?.id || fighter?.name || '';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ids[h % ids.length];
}
