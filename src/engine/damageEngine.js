import { CHARACTERS, STATUS_EFFECTS, METER, BASE_DAMAGE, getUltimate } from '../data/characters.js';

export const BASE_ACTIONS = ['idle', 'jump', 'melee', 'ranged', 'dodge', 'defend'];

export function isUltimateKey(action) {
  return typeof action === 'string' && action.startsWith('ultimate_');
}

export function validActionsForCharacter(charId) {
  const c = CHARACTERS[charId];
  const ults = c ? c.ultimates.map(u => u.key) : [];
  return [...BASE_ACTIONS, ...ults, 'none'];
}

// Kept for backwards-compat with old fight log consumers during migration.
export const VALID_ACTIONS = BASE_ACTIONS;
export const ALL_ACTIONS = [...BASE_ACTIONS, 'none'];

/**
 * Resolve one simultaneous turn between two fighters under the new action system.
 *
 * Inputs describe each fighter's state *before* the turn's effects apply.
 * Output describes damage dealt, meter changes, status effects, and the
 * action actually executed (may differ from the requested action due to
 * freeze/stun coercion or insufficient-meter fallback).
 *
 * Turn sequence:
 *   1. Pre-tick DoT damage (burn, poison) for each fighter.
 *   2. Coerce actions: frozen/stunned → idle; Ultimate without meter → melee.
 *   3. Resolve damage matrix based on actual actions.
 *   4. Apply Ultimate special effects (heal, status, reflect, etc.).
 *   5. Pay Ultimate meter cost (from attacker's meter).
 *   6. Grant meter gains from landing hits / taking damage / evasion.
 *   7. Decrement status effect durations; drop expired ones.
 */
export function resolveActions(
  requestedA, requestedB,
  characterA, characterB,
  meterA = 0, meterB = 0,
  statusA = [], statusB = []
) {
  const events = [];

  // 1. Pre-tick DoT
  const { totalDamage: dotDamageA, nextStatus: statusAAfterTick } = tickDot(statusA);
  const { totalDamage: dotDamageB, nextStatus: statusBAfterTick } = tickDot(statusB);
  if (dotDamageA > 0) events.push({ type: 'dot', victim: 'A', damage: dotDamageA });
  if (dotDamageB > 0) events.push({ type: 'dot', victim: 'B', damage: dotDamageB });

  // 2. Action coercion
  const { action: actualA, reason: coerceReasonA } =
    coerceAction(requestedA, characterA, meterA, statusAAfterTick);
  const { action: actualB, reason: coerceReasonB } =
    coerceAction(requestedB, characterB, meterB, statusBAfterTick);

  if (coerceReasonA) events.push({ type: 'coerced', fighter: 'A', from: requestedA, to: actualA, reason: coerceReasonA });
  if (coerceReasonB) events.push({ type: 'coerced', fighter: 'B', from: requestedB, to: actualB, reason: coerceReasonB });

  // 3. Damage matrix
  const { attackerDamage: dmgFromB, attackerHit: bHit, attackResult: resultB } =
    computeAttack(actualB, actualA, characterB, events, 'B', 'A');
  const { attackerDamage: dmgFromA, attackerHit: aHit, attackResult: resultA } =
    computeAttack(actualA, actualB, characterA, events, 'A', 'B');

  let damageToA = dmgFromB;
  let damageToB = dmgFromA;

  // Apply pre-tick DoT on top of attack damage
  damageToA += dotDamageA;
  damageToB += dotDamageB;

  // 4. Apply Ultimate side-effects (self-heal, self-damage, status effects)
  let newStatusA = statusAAfterTick;
  let newStatusB = statusBAfterTick;

  if (isUltimateKey(actualA) && resultA.ultimate) {
    const ult = getUltimate(characterA, actualA);
    if (ult) {
      if (ult.heals && aHit) { damageToA -= ult.heals; events.push({ type: 'heal', fighter: 'A', amount: ult.heals }); }
      if (ult.selfDamage) { damageToA += ult.selfDamage; events.push({ type: 'self_damage', fighter: 'A', amount: ult.selfDamage }); }
      if (ult.statusApplied && aHit) { newStatusB = addStatus(newStatusB, ult.statusApplied); events.push({ type: 'status', fighter: 'B', effect: ult.statusApplied }); }
      if (ult.selfRisk && aHit) { newStatusA = addStatus(newStatusA, ult.selfRisk); events.push({ type: 'status', fighter: 'A', effect: ult.selfRisk, selfRisk: true }); }
    }
  }
  if (isUltimateKey(actualB) && resultB.ultimate) {
    const ult = getUltimate(characterB, actualB);
    if (ult) {
      if (ult.heals && bHit) { damageToB -= ult.heals; events.push({ type: 'heal', fighter: 'B', amount: ult.heals }); }
      if (ult.selfDamage) { damageToB += ult.selfDamage; events.push({ type: 'self_damage', fighter: 'B', amount: ult.selfDamage }); }
      if (ult.statusApplied && bHit) { newStatusA = addStatus(newStatusA, ult.statusApplied); events.push({ type: 'status', fighter: 'A', effect: ult.statusApplied }); }
      if (ult.selfRisk && bHit) { newStatusB = addStatus(newStatusB, ult.selfRisk); events.push({ type: 'status', fighter: 'B', effect: ult.selfRisk, selfRisk: true }); }
    }
  }

  // 5. Spend Ultimate meter cost
  let newMeterA = meterA;
  let newMeterB = meterB;
  if (isUltimateKey(actualA)) {
    const ult = getUltimate(characterA, actualA);
    if (ult) newMeterA = Math.max(0, newMeterA - ult.meterCost);
    if (ult?.gainMeter) newMeterA = Math.min(METER.MAX, newMeterA + ult.gainMeter);
  }
  if (isUltimateKey(actualB)) {
    const ult = getUltimate(characterB, actualB);
    if (ult) newMeterB = Math.max(0, newMeterB - ult.meterCost);
    if (ult?.gainMeter) newMeterB = Math.min(METER.MAX, newMeterB + ult.gainMeter);
  }

  // 6. Meter gains from this turn's outcomes
  newMeterA = applyMeterGains(newMeterA, {
    landedMelee: actualA === 'melee' && aHit,
    landedRanged: actualA === 'ranged' && aHit,
    tookDamage: damageToA > 0,
    dodgedAttack: actualA === 'dodge' && !aHit && (actualB === 'melee' || actualB === 'ranged'),
    blockedAttack: actualA === 'defend' && (actualB === 'melee' || actualB === 'ranged') && !bHit,
    evadedByJump: actualA === 'jump' && actualB === 'melee' && !bHit,
  });
  newMeterB = applyMeterGains(newMeterB, {
    landedMelee: actualB === 'melee' && bHit,
    landedRanged: actualB === 'ranged' && bHit,
    tookDamage: damageToB > 0,
    dodgedAttack: actualB === 'dodge' && !bHit && (actualA === 'melee' || actualA === 'ranged'),
    blockedAttack: actualB === 'defend' && (actualA === 'melee' || actualA === 'ranged') && !aHit,
    evadedByJump: actualB === 'jump' && actualA === 'melee' && !aHit,
  });

  return {
    damageToA: Math.max(0, damageToA),
    damageToB: Math.max(0, damageToB),
    actualActionA: actualA,
    actualActionB: actualB,
    newMeterA,
    newMeterB,
    newStatusA,
    newStatusB,
    events,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function coerceAction(requested, charId, meter, status) {
  if (hasSkipStatus(status)) {
    return { action: 'idle', reason: 'frozen_or_stunned' };
  }
  if (isUltimateKey(requested)) {
    const ult = getUltimate(charId, requested);
    if (!ult) return { action: 'melee', reason: 'unknown_ultimate' };
    if (meter < ult.meterCost) return { action: 'melee', reason: 'insufficient_meter' };
    return { action: requested, reason: null };
  }
  if (!BASE_ACTIONS.includes(requested) && requested !== 'none') {
    return { action: 'idle', reason: 'invalid_action' };
  }
  return { action: requested, reason: null };
}

function computeAttack(attacker, defender, attackerCharId, events, attackerLabel, defenderLabel) {
  // Non-offensive actions
  if (['idle', 'jump', 'dodge', 'defend', 'none'].includes(attacker)) {
    return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: false } };
  }

  if (attacker === 'melee') {
    if (defender === 'jump')   { events.push({ type: 'miss', attacker: attackerLabel, reason: 'jumped' }); return hit(0, false); }
    if (defender === 'dodge')  { events.push({ type: 'miss', attacker: attackerLabel, reason: 'dodged' }); return hit(0, false); }
    if (defender === 'defend') { events.push({ type: 'blocked', defender: defenderLabel, kind: 'melee' }); return hit(0, false); }
    events.push({ type: 'hit', attacker: attackerLabel, victim: defenderLabel, damage: BASE_DAMAGE.melee, kind: 'melee' });
    return hit(BASE_DAMAGE.melee, true);
  }

  if (attacker === 'ranged') {
    if (defender === 'dodge')  { events.push({ type: 'miss', attacker: attackerLabel, reason: 'dodged' }); return hit(0, false); }
    if (defender === 'defend') { events.push({ type: 'blocked', defender: defenderLabel, kind: 'ranged' }); return hit(0, false); }
    events.push({ type: 'hit', attacker: attackerLabel, victim: defenderLabel, damage: BASE_DAMAGE.ranged, kind: 'ranged' });
    return hit(BASE_DAMAGE.ranged, true);
  }

  if (isUltimateKey(attacker)) {
    const ult = getUltimate(attackerCharId, attacker);
    if (!ult) return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: false } };

    // Ultimate base damage
    let dmg = ult.damage ?? 0;

    // Dodge still provides partial protection against Ultimates unless the Ultimate ignores it
    if (defender === 'dodge' && !ult.ignoresDodge) {
      dmg = Math.floor(dmg / 2);
      events.push({ type: 'partial_dodge', attacker: attackerLabel, victim: defenderLabel, damage: dmg });
    }

    // Multi-hit
    if (ult.hits && ult.hits > 1) {
      dmg = Math.floor(dmg * ult.hits / ult.hits) * ult.hits;
      // Already `dmg * hits` conceptually — but we'll scale: treat ult.damage as per-hit
      dmg = (ult.damage ?? 0) * ult.hits;
      if (defender === 'dodge' && !ult.ignoresDodge) dmg = Math.floor(dmg / 2);
    }

    events.push({ type: 'ultimate', attacker: attackerLabel, victim: defenderLabel, name: ult.name, damage: dmg });
    return { attackerDamage: dmg, attackerHit: dmg > 0, attackResult: { ultimate: true, ult } };
  }

  return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: false } };
}

function hit(damage, landed) {
  return { attackerDamage: damage, attackerHit: landed, attackResult: { ultimate: false } };
}

function tickDot(statusList) {
  let totalDamage = 0;
  const nextStatus = [];
  for (const s of statusList) {
    const def = STATUS_EFFECTS[s.type];
    if (def?.damagePerTurn) totalDamage += def.damagePerTurn;
    if (s.duration > 1) nextStatus.push({ ...s, duration: s.duration - 1 });
  }
  return { totalDamage, nextStatus };
}

function addStatus(statusList, effectType) {
  const def = STATUS_EFFECTS[effectType];
  if (!def) return statusList;
  // Refresh duration if already present
  const filtered = statusList.filter(s => s.type !== effectType);
  return [...filtered, { type: effectType, duration: def.duration }];
}

function hasSkipStatus(statusList) {
  return statusList.some(s => STATUS_EFFECTS[s.type]?.skipsAction);
}

function applyMeterGains(currentMeter, { landedMelee, landedRanged, tookDamage, dodgedAttack, blockedAttack, evadedByJump }) {
  let m = currentMeter;
  if (landedMelee)   m += METER.GAIN_ON_MELEE_HIT;
  if (landedRanged)  m += METER.GAIN_ON_RANGED_HIT;
  if (tookDamage)    m += METER.GAIN_ON_TAKING_DAMAGE;
  if (dodgedAttack)  m += METER.GAIN_ON_DODGE;
  if (blockedAttack) m += METER.GAIN_ON_BLOCK;
  if (evadedByJump)  m += METER.GAIN_ON_JUMP_EVADE;
  return Math.min(METER.MAX, m);
}
