import { CHARACTERS, STATUS_EFFECTS, METER, BASE_DAMAGE, getUltimate, isAirborneUltimate } from '../data/characters.js';

export const BASE_ACTIONS = ['idle', 'jump', 'hit', 'shoot', 'slide', 'defend'];

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

  // 3. Damage matrix — handle simultaneous-action clashes first, then per-side
  // attack resolution. Clash rules:
  //   hit  vs hit  → both whiff (weapons cancel)
  //   ult  vs ult  → both whiff (energies cancel; meter still spent)
  //   slide vs slide → both collide and take slide damage
  const isUltA = isUltimateKey(actualA);
  const isUltB = isUltimateKey(actualB);
  const clashHit   = actualA === 'hit'   && actualB === 'hit';
  const clashUlt   = isUltA && isUltB;
  const clashSlide = actualA === 'slide' && actualB === 'slide';

  let dmgFromA, dmgFromB, aHit, bHit, resultA, resultB;
  if (clashHit) {
    events.push({ type: 'clash', kind: 'hit' });
    dmgFromA = 0; dmgFromB = 0; aHit = false; bHit = false;
    resultA = { ultimate: false }; resultB = { ultimate: false };
  } else if (clashUlt) {
    events.push({ type: 'clash', kind: 'ultimate' });
    dmgFromA = 0; dmgFromB = 0; aHit = false; bHit = false;
    // Mark ultimate=false so per-side side-effects (heal/status/etc.) skip;
    // meter is still spent in step 5 because isUltimateKey(actual) is true.
    resultA = { ultimate: false }; resultB = { ultimate: false };
  } else if (clashSlide) {
    const d = BASE_DAMAGE.slide ?? 6;
    events.push({ type: 'clash', kind: 'slide', damage: d });
    dmgFromA = d; dmgFromB = d; aHit = true; bHit = true;
    resultA = { ultimate: false }; resultB = { ultimate: false };
  } else {
    ({ attackerDamage: dmgFromB, attackerHit: bHit, attackResult: resultB } =
      computeAttack(actualB, actualA, characterB, characterA, events, 'B', 'A'));
    ({ attackerDamage: dmgFromA, attackerHit: aHit, attackResult: resultA } =
      computeAttack(actualA, actualB, characterA, characterB, events, 'A', 'B'));
  }

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
    landedHit: (actualA === 'hit' || actualA === 'slide') && aHit,
    landedShot: actualA === 'shoot' && aHit,
    tookDamage: damageToA > 0,
    slidPast: actualA === 'slide' && !aHit && (actualB === 'hit' || actualB === 'shoot'),
    blockedAttack: actualA === 'defend' && (actualB === 'hit' || isUltimateKey(actualB)) && !bHit,
    evadedByJump: actualA === 'jump' && (actualB === 'hit' || actualB === 'shoot') && !bHit,
  });
  newMeterB = applyMeterGains(newMeterB, {
    landedHit: (actualB === 'hit' || actualB === 'slide') && bHit,
    landedShot: actualB === 'shoot' && bHit,
    tookDamage: damageToB > 0,
    slidPast: actualB === 'slide' && !bHit && (actualA === 'hit' || actualA === 'shoot'),
    blockedAttack: actualB === 'defend' && (actualA === 'hit' || isUltimateKey(actualA)) && !aHit,
    evadedByJump: actualB === 'jump' && (actualA === 'hit' || actualA === 'shoot') && !aHit,
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
    if (!ult) return { action: 'hit', reason: 'unknown_ultimate' };
    if (meter < ult.meterCost) return { action: 'hit', reason: 'insufficient_meter' };
    return { action: requested, reason: null };
  }
  if (!BASE_ACTIONS.includes(requested) && requested !== 'none') {
    return { action: 'idle', reason: 'invalid_action' };
  }
  return { action: requested, reason: null };
}

function computeAttack(attacker, defender, attackerCharId, defenderCharId, events, attackerLabel, defenderLabel) {
  // Non-offensive actions (slide is offensive in the new matrix; handled below)
  if (['idle', 'jump', 'defend', 'none'].includes(attacker)) {
    return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: false } };
  }

  if (attacker === 'hit') {
    // All hit variants land on a jumper. For melee hits (hammer/fist/kick) the
    // jumper is clipped out of the air — animResolution plays death+knockdown.
    // For projectile-based hits (e.g., womanHero's ice arrow) the engine still
    // counts damage, but the reaction is deferred to AFTER landing (handled
    // visually in animResolution.computeAttackTiming).
    if (defender === 'slide')  { events.push({ type: 'miss', attacker: attackerLabel, reason: 'slid' }); return hit(0, false); }
    if (defender === 'defend') { events.push({ type: 'blocked', defender: defenderLabel, kind: 'hit' }); return hit(0, false); }
    events.push({ type: 'hit', attacker: attackerLabel, victim: defenderLabel, damage: BASE_DAMAGE.hit, kind: 'hit' });
    return hit(BASE_DAMAGE.hit, true);
  }

  if (attacker === 'shoot') {
    // Shoot travels straight — jump and slide both evade. Defend does NOT block shoot
    // (a shield is for melee/ultimate impact, not stopping projectiles).
    if (defender === 'jump')  { events.push({ type: 'miss', attacker: attackerLabel, reason: 'jumped' }); return hit(0, false); }
    if (defender === 'slide') { events.push({ type: 'miss', attacker: attackerLabel, reason: 'slid' }); return hit(0, false); }
    // An airborne ultimate (flyHit / jet-pack lift) takes the defender out of
    // the projectile's path the same way a jump does. Grounded ultimates
    // (e.g., womanHero's Triple Shot) still get hit.
    if (isAirborneUltimate(defenderCharId, defender)) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'ult_airborne' });
      return hit(0, false);
    }
    events.push({ type: 'hit', attacker: attackerLabel, victim: defenderLabel, damage: BASE_DAMAGE.shoot, kind: 'shoot' });
    return hit(BASE_DAMAGE.shoot, true);
  }

  if (attacker === 'slide') {
    // Slide is a low-line tackle — passes under hit/shoot, can't reach a jumper.
    // It collides with a slide (handled as clash in resolveActions) and damages
    // anyone standing (idle / defend / shoot — defend doesn't help vs slide).
    // It also can't reach an opponent who is mid-Ultimate: airborne ults clear
    // the slider entirely, and grounded ults (e.g., womanHero's spread shot)
    // create an arrow rain the slider can't slide through.
    if (defender === 'jump') { events.push({ type: 'miss', attacker: attackerLabel, reason: 'jumped' }); return hit(0, false); }
    if (defender === 'hit')  { events.push({ type: 'miss', attacker: attackerLabel, reason: 'attack_whiffed' }); return hit(0, false); }
    if (isUltimateKey(defender)) {
      const reason = isAirborneUltimate(defenderCharId, defender) ? 'ult_airborne' : 'ult_active';
      events.push({ type: 'miss', attacker: attackerLabel, reason });
      return hit(0, false);
    }
    const dmg = BASE_DAMAGE.slide ?? 6;
    events.push({ type: 'hit', attacker: attackerLabel, victim: defenderLabel, damage: dmg, kind: 'slide' });
    return hit(dmg, true);
  }

  if (isUltimateKey(attacker)) {
    const ult = getUltimate(attackerCharId, attacker);
    if (!ult) return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: false } };

    // Defend blocks Ultimates (only hit + ultimate are blockable per the matrix).
    if (defender === 'defend' && !ult.unblockable) {
      events.push({ type: 'blocked', defender: defenderLabel, kind: 'ultimate', name: ult.name });
      return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: true, ult, blocked: true } };
    }

    // An airborne ult (jet-pack/flyHit) skips clean over a sliding defender —
    // they pass each other in different vertical lanes, neither connects.
    // Grounded ults (e.g., womanHero's spread shot) still hit a slider in full
    // because at least one arrow is angled to the lower lane.
    if (defender === 'slide' && isAirborneUltimate(attackerCharId, attacker) && !ult.ignoresDodge) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'slid_under', name: ult.name });
      return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: true, ult, missed: true } };
    }

    // Ultimate base damage (multi-hit scaling if applicable)
    let dmg = ult.damage ?? 0;
    if (ult.hits && ult.hits > 1) dmg = (ult.damage ?? 0) * ult.hits;

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

function applyMeterGains(currentMeter, { landedHit, landedShot, tookDamage, slidPast, blockedAttack, evadedByJump }) {
  let m = currentMeter;
  if (landedHit)     m += METER.GAIN_ON_MELEE_HIT;
  if (landedShot)    m += METER.GAIN_ON_RANGED_HIT;
  if (tookDamage)    m += METER.GAIN_ON_TAKING_DAMAGE;
  if (slidPast)      m += METER.GAIN_ON_DODGE;
  if (blockedAttack) m += METER.GAIN_ON_BLOCK;
  if (evadedByJump)  m += METER.GAIN_ON_JUMP_EVADE;
  return Math.min(METER.MAX, m);
}
