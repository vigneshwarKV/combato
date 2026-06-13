import { CHARACTERS, METER, BASE_DAMAGE, getUltimate, isAirborneUltimate, getMeterGain, BLOCKED_SUPER_DAMAGE_MULTIPLIER } from '../data/characters.js';

export const BASE_ACTIONS = ['idle', 'jump', 'hit', 'shoot', 'slide', 'defend_low', 'defend_high'];

// The two guard stances. defend_high braces overhead (blocks high-line attacks:
// regular melee hit + airborne supers); defend_low guards the body/legs (blocks
// low-line attacks: shoot, slide, rush/projectile hits, grounded supers).
// Guessing the wrong line = the attack lands for full damage.
export const DEFEND_ACTIONS = ['defend_low', 'defend_high'];

export function isDefendAction(action) {
  return action === 'defend_low' || action === 'defend_high';
}

export function isUltimateKey(action) {
  return typeof action === 'string' && action.startsWith('ultimate_');
}

// Which guard line an offensive action travels on. 'high' attacks are stopped
// only by defend_high, 'low' attacks only by defend_low. Returns null for
// non-offensive actions (idle/jump/defend/none).
//   hit  → 'high' normally; 'low' for rush-style (Skater Kid) or projectile-
//          style (Woman Hero) hits.
//   shoot/slide → always 'low'.
//   ultimate → 'high' when airborne (flyHit/jet-pack), else 'low' (grounded).
export function attackLine(action, attackerCharId) {
  if (action === 'hit') {
    const c = CHARACTERS[attackerCharId];
    const isRush = !!c?.hitIsRushStyle;
    const isProj = !!c?.extraProjectileActions?.includes('hit');
    return (isRush || isProj) ? 'low' : 'high';
  }
  if (action === 'shoot' || action === 'slide') return 'low';
  if (isUltimateKey(action)) return isAirborneUltimate(attackerCharId, action) ? 'high' : 'low';
  return null;
}

// True when `defendAction` is the guard that stops an attack on `line`.
function guardBlocks(defendAction, line) {
  if (line === 'high') return defendAction === 'defend_high';
  if (line === 'low') return defendAction === 'defend_low';
  return false;
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
 * Output describes damage dealt, meter changes, and the action actually
 * executed (may differ from the requested action when an Ultimate is chosen
 * without enough meter, or an invalid action is requested).
 *
 * Turn sequence:
 *   1. Coerce actions: Ultimate without meter → melee; invalid → idle.
 *   2. Resolve damage matrix based on actual actions.
 *   3. Apply Ultimate side-effects (self-heal, self-damage).
 *   4. Pay Ultimate meter cost (from attacker's meter).
 *   5. Grant meter gains from landing hits / taking damage / evasion.
 */
export function resolveActions(
  requestedA, requestedB,
  characterA, characterB,
  meterA = 0, meterB = 0
) {
  const events = [];

  // 1. Action coercion (Ultimate without meter → melee; invalid → idle).
  const { action: actualA, reason: coerceReasonA } =
    coerceAction(requestedA, characterA, meterA);
  const { action: actualB, reason: coerceReasonB } =
    coerceAction(requestedB, characterB, meterB);

  if (coerceReasonA) events.push({ type: 'coerced', fighter: 'A', from: requestedA, to: actualA, reason: coerceReasonA });
  if (coerceReasonB) events.push({ type: 'coerced', fighter: 'B', from: requestedB, to: actualB, reason: coerceReasonB });

  // 3. Damage matrix — handle simultaneous-action clashes first, then per-side
  // attack resolution. Clash rules:
  //   hit  vs hit  → both whiff (weapons cancel)
  //   ult  vs ult  → both whiff (energies cancel; meter still spent)
  //   slide vs slide → both collide and take slide damage
  const isUltA = isUltimateKey(actualA);
  const isUltB = isUltimateKey(actualB);
  // Projectile-hit (Woman Hero's IceShoot) doesn't clash with melee — she
  // jumps up to fire, so the other character's lunge can interrupt her arrow
  // release while she eats the hit. Skip clash so per-side computeAttack runs.
  const aProjHit = actualA === 'hit' && CHARACTERS[characterA]?.extraProjectileActions?.includes('hit');
  const bProjHit = actualB === 'hit' && CHARACTERS[characterB]?.extraProjectileActions?.includes('hit');
  const clashHit   = actualA === 'hit'   && actualB === 'hit' && !aProjHit && !bProjHit;
  // Ult-vs-ult only clashes when both ults occupy the same vertical lane —
  // both airborne (mid-flight collision) or both grounded. An airborne ult
  // vs a grounded ult (e.g., Beast's Rocket Charge vs Woman Hero's spread
  // shot) is asymmetric: the flying ult clears the grounded ult's path and
  // lands on the grounded user, while the grounded user's arrows miss the
  // flyer. Per-side computeAttack handles that.
  const aAirborneUlt = isUltA && isAirborneUltimate(characterA, actualA);
  const bAirborneUlt = isUltB && isAirborneUltimate(characterB, actualB);
  const clashUlt   = isUltA && isUltB && (aAirborneUlt === bAirborneUlt);
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

  // 4. Apply Ultimate side-effects (self-heal, self-damage).
  if (isUltimateKey(actualA) && resultA.ultimate) {
    const ult = getUltimate(characterA, actualA);
    if (ult) {
      if (ult.heals && aHit) { damageToA -= ult.heals; events.push({ type: 'heal', fighter: 'A', amount: ult.heals }); }
      if (ult.selfDamage) { damageToA += ult.selfDamage; events.push({ type: 'self_damage', fighter: 'A', amount: ult.selfDamage }); }
    }
  }
  if (isUltimateKey(actualB) && resultB.ultimate) {
    const ult = getUltimate(characterB, actualB);
    if (ult) {
      if (ult.heals && bHit) { damageToB -= ult.heals; events.push({ type: 'heal', fighter: 'B', amount: ult.heals }); }
      if (ult.selfDamage) { damageToB += ult.selfDamage; events.push({ type: 'self_damage', fighter: 'B', amount: ult.selfDamage }); }
    }
  }

  // 4b. A super stopped by the opponent's SHIELD backfires on the attacker —
  // they eat a multiple of the super's own damage for the failed read. Only
  // applies to a shield block (resultX.blocked), not a jump/slide dodge.
  if (isUltimateKey(actualA) && resultA.blocked) {
    const ult = getUltimate(characterA, actualA);
    const mult = ult?.blockBackfireMult ?? BLOCKED_SUPER_DAMAGE_MULTIPLIER;
    const backfire = (ult?.damage ?? 0) * mult;
    if (backfire > 0) { damageToA += backfire; events.push({ type: 'super_backfire', fighter: 'A', amount: backfire }); }
  }
  if (isUltimateKey(actualB) && resultB.blocked) {
    const ult = getUltimate(characterB, actualB);
    const mult = ult?.blockBackfireMult ?? BLOCKED_SUPER_DAMAGE_MULTIPLIER;
    const backfire = (ult?.damage ?? 0) * mult;
    if (backfire > 0) { damageToB += backfire; events.push({ type: 'super_backfire', fighter: 'B', amount: backfire }); }
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

  // 6. Meter gains from this turn's outcomes. The super meter fills on two
  // events only (rates are per character — see getMeterGain):
  //   • LANDING an attack — a hit / shoot / slide that connects     → +onHit
  //   • Successfully DEFENDING an incoming attack — the opponent made
  //     an offensive move (hit / shoot / slide / super) and dealt 0
  //     damage to you while you were guarding or evading (shield
  //     block, jump, or slide dodge)                                → +onDefend
  const aLandedAttack = (actualA === 'hit' || actualA === 'shoot' || actualA === 'slide') && aHit;
  const bLandedAttack = (actualB === 'hit' || actualB === 'shoot' || actualB === 'slide') && bHit;
  const aDefended = isOffensiveAction(actualB) && dmgFromB <= 0 && isDefensiveStance(actualA);
  const bDefended = isOffensiveAction(actualA) && dmgFromA <= 0 && isDefensiveStance(actualB);
  newMeterA = applyMeterGains(newMeterA, characterA, { landedAttack: aLandedAttack, defended: aDefended });
  newMeterB = applyMeterGains(newMeterB, characterB, { landedAttack: bLandedAttack, defended: bDefended });

  return {
    damageToA: Math.max(0, damageToA),
    damageToB: Math.max(0, damageToB),
    actualActionA: actualA,
    actualActionB: actualB,
    newMeterA,
    newMeterB,
    // Status effects were removed — supers are damage-only now. These stay
    // empty so the HUD status row and downstream consumers keep working.
    newStatusA: [],
    newStatusB: [],
    events,
  };
}

// ── helpers ────────────────────────────────────────────────────────────────

function coerceAction(requested, charId, meter) {
  if (isUltimateKey(requested)) {
    const ult = getUltimate(charId, requested);
    if (!ult) return { action: 'idle', reason: 'unknown_ultimate' };
    // Super requested without a full meter → the turn is wasted on idle (not a
    // melee hit), so an over-eager super pick reads as "stalled" rather than
    // masquerading as a grounded hit.
    if (meter < ult.meterCost) return { action: 'idle', reason: 'insufficient_meter' };
    return { action: requested, reason: null };
  }
  if (!BASE_ACTIONS.includes(requested) && requested !== 'none') {
    return { action: 'idle', reason: 'invalid_action' };
  }
  return { action: requested, reason: null };
}

function computeAttack(attacker, defender, attackerCharId, defenderCharId, events, attackerLabel, defenderLabel) {
  // Non-offensive actions (slide is offensive in the new matrix; handled below)
  if (['idle', 'jump', 'defend_low', 'defend_high', 'none'].includes(attacker)) {
    return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: false } };
  }

  if (attacker === 'hit') {
    const attackerIsProjHit = !!CHARACTERS[attackerCharId]?.extraProjectileActions?.includes('hit');
    const attackerIsRushHit = !!CHARACTERS[attackerCharId]?.hitIsRushStyle;
    const defenderIsProjHit = !!CHARACTERS[defenderCharId]?.extraProjectileActions?.includes('hit');
    // Projectile-style hit (Woman Hero's IceShoot) misses a jumper — straight-
    // line shot, jumper evades the same way they do shoot.
    if (defender === 'jump' && attackerIsProjHit) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'jumped' });
      return hit(0, false);
    }
    // Projectile hit attacker vs an opposing melee hit — opponent's lunge
    // catches the projectile-hitter before they release the arrow. The
    // melee hit's damage lands (in opponent's branch); this branch whiffs.
    if (defender === 'hit' && attackerIsProjHit && !defenderIsProjHit) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'interrupted_by_hit' });
      return hit(0, false);
    }
    // Rush-style hit (Skater Kid) vs projectile-hit (Woman Hero) — both end
    // up airborne (skateboard rush vs jumpShoot) and pass each other; rush
    // misses too. Projectile-hit's miss is handled by the case above.
    if (defender === 'hit' && attackerIsRushHit && defenderIsProjHit) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'both_airborne' });
      return hit(0, false);
    }
    // Melee hits (hammer/fist/kick) clip a jumper out of the air —
    // animResolution plays death+knockdown. Projectile-based hits had the
    // damage-applies-but-deferred-hurt path; that's now removed (above) since
    // the user wants projectile hits to MISS jumpers like a shoot.
    // Melee hit misses sliders (slide dodges low). Projectile-style hit
    // (Woman Hero's IceShoot) doesn't miss — the arrow flies straight and
    // catches the slider once they finish their slide and return to base
    // (the deferred-hurt timing is handled in animResolution).
    if (defender === 'slide' && !attackerIsProjHit) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'slid' });
      return hit(0, false);
    }
    // Guard block by line: a regular melee hit travels HIGH (stopped only by
    // defend_high); a rush-style charge (Skater Kid) or projectile-style hit
    // (Woman Hero) travels LOW (stopped only by defend_low). Guessing the
    // wrong guard lets the hit land for full damage (falls through below).
    if (isDefendAction(defender) && guardBlocks(defender, attackLine('hit', attackerCharId))) {
      const kind = attackerIsRushHit ? 'rush' : (attackerIsProjHit ? 'projhit' : 'hit');
      events.push({ type: 'blocked', defender: defenderLabel, kind });
      return hit(0, false);
    }
    // Melee hit attacker rushing forward gets stopped by an opposing FAST
    // shoot — bullet catches the hitter mid-lunge (damage handled in the
    // shoot branch). SLOW throwers (turtle's spear, monkey's spear) lose
    // to the lunge — the hitter reaches them before the projectile spawns
    // and the hit damage lands on the thrower instead. Projectile-style
    // hits (womanHero's IceShoot) don't lunge so they aren't stopped.
    if (defender === 'shoot'
      && !CHARACTERS[attackerCharId]?.extraProjectileActions?.includes('hit')
      && !isSlowProjectileShot(defenderCharId, attackerCharId, 'hit')) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'shot_first' });
      return hit(0, false);
    }
    // Melee hitter charging into a RANGED super (Woman Hero's arrow volley) —
    // the super's projectiles fire from range and clip the hitter mid-lunge
    // before the blow lands, like a fast shoot. The hit is interrupted (no
    // damage); the super's damage + throwback land in the ult branch below.
    // Projectile-style hitters (another Woman Hero) don't rush, so skip them.
    if (isUltimateKey(defender)
      && getUltimate(defenderCharId, defender)?.rangedSuper
      && !CHARACTERS[attackerCharId]?.extraProjectileActions?.includes('hit')) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'interrupted_by_super' });
      return hit(0, false);
    }
    events.push({ type: 'hit', attacker: attackerLabel, victim: defenderLabel, damage: BASE_DAMAGE.hit, kind: 'hit' });
    return hit(BASE_DAMAGE.hit, true);
  }

  if (attacker === 'shoot') {
    // Shoot travels the LOW line — a low guard catches the projectile on the
    // shield. A high guard leaves the body open, so the shot lands.
    if (defender === 'defend_low') {
      events.push({ type: 'blocked', defender: defenderLabel, kind: 'shoot' });
      return hit(0, false);
    }
    // Shoot travels straight — jump still evades.
    if (defender === 'jump')  { events.push({ type: 'miss', attacker: attackerLabel, reason: 'jumped' }); return hit(0, false); }
    if (defender === 'slide') {
      // Fast bullets catch the slider mid-slide. Slow throws (turtle / monkey
      // spear) lose to a slide — the slider reaches the thrower before the
      // projectile spawns; the throw gets interrupted (handled in the slide
      // branch where the slider damages the slow thrower).
      if (isSlowProjectileShot(attackerCharId, defenderCharId)) {
        events.push({ type: 'miss', attacker: attackerLabel, reason: 'interrupted_by_slide' });
        return hit(0, false);
      }
      events.push({ type: 'hit', attacker: attackerLabel, victim: defenderLabel, damage: BASE_DAMAGE.shoot, kind: 'shoot' });
      return hit(BASE_DAMAGE.shoot, true);
    }
    // An airborne ultimate (flyHit / jet-pack lift) takes the defender out of
    // the projectile's path the same way a jump does. Grounded ultimates
    // (e.g., womanHero's Triple Shot) still get hit.
    if (isAirborneUltimate(defenderCharId, defender)) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'ult_airborne' });
      return hit(0, false);
    }
    // Projectile-style hit (Woman Hero's IceShoot) is a jumpShoot — she
    // rises up to fire her ice arrow, so an opposing straight-line bullet
    // passes under her like it would past a jumper.
    if (defender === 'hit' && CHARACTERS[defenderCharId]?.extraProjectileActions?.includes('hit')) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'attacker_airborne' });
      return hit(0, false);
    }
    // Slow thrower rushed by a melee hit-attacker — the lunge reaches the
    // thrower before the projectile spawns. Shoot is interrupted; the
    // lunge's damage is awarded in the hit branch.
    if (defender === 'hit'
      && !CHARACTERS[defenderCharId]?.extraProjectileActions?.includes('hit')
      && isSlowProjectileShot(attackerCharId, defenderCharId, 'hit')) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'interrupted_by_hit' });
      return hit(0, false);
    }
    // Shoot vs shoot — whoever releases first lands their shot before the other
    // gets their weapon off. A slower thrower (longer spawn delay: monkey /
    // turtle spear at 550ms) eats the faster shooter's projectile mid-windup,
    // so their own throw never releases (no damage). Equal delays → both fire
    // and trade hits (handled by the final landed-shot below).
    if (defender === 'shoot'
      && shootProjectileDelay(attackerCharId) > shootProjectileDelay(defenderCharId)) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'interrupted_by_shot' });
      return hit(0, false);
    }
    events.push({ type: 'hit', attacker: attackerLabel, victim: defenderLabel, damage: BASE_DAMAGE.shoot, kind: 'shoot' });
    return hit(BASE_DAMAGE.shoot, true);
  }

  if (attacker === 'slide') {
    // Slide is a low-line tackle — clips a melee hitter's legs and throws
    // them back. Passes under shoots; can't reach a jumper. It collides with
    // a slide (handled as a clash in resolveActions) and damages anyone
    // standing (idle / defend / shoot — defend doesn't help vs slide). It
    // also can't reach a defender who is mid-Ultimate: airborne ults clear
    // the slider entirely, grounded ults (e.g., womanHero's spread shot)
    // create an arrow rain the slider can't slide through. Projectile-style
    // hits (womanHero's IceShoot3 jumpShoot — she rises up to fire) put the
    // attacker out of leg-clip range too.
    // A low tackle is caught by a low guard (shield dropped to the legs); a
    // high guard is raised over the head and gets swept out from under.
    if (defender === 'defend_low') {
      events.push({ type: 'blocked', defender: defenderLabel, kind: 'slide' });
      return hit(0, false);
    }
    if (defender === 'jump') { events.push({ type: 'miss', attacker: attackerLabel, reason: 'jumped' }); return hit(0, false); }
    if (defender === 'hit' && CHARACTERS[defenderCharId]?.extraProjectileActions?.includes('hit')) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'attacker_airborne' });
      return hit(0, false);
    }
    if (defender === 'shoot' && !isSlowProjectileShot(defenderCharId, attackerCharId)) {
      // Fast shooter tags the slider mid-slide before the slide reaches them
      // (the slider's hit damage is awarded in the shoot branch's hit case).
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'shot_first' });
      return hit(0, false);
    }
    if (isUltimateKey(defender)) {
      const reason = isAirborneUltimate(defenderCharId, defender) ? 'ult_airborne' : 'ult_active';
      events.push({ type: 'miss', attacker: attackerLabel, reason });
      return hit(0, false);
    }
    // Slide damages everything still on the ground here: idle / defend / shoot
    // (slow thrower) / melee hit attacker.
    const dmg = BASE_DAMAGE.slide ?? 6;
    events.push({ type: 'hit', attacker: attackerLabel, victim: defenderLabel, damage: dmg, kind: 'slide' });
    return hit(dmg, true);
  }

  if (isUltimateKey(attacker)) {
    const ult = getUltimate(attackerCharId, attacker);
    if (!ult) return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: false } };

    // Guard block by line: an AIRBORNE super (flyHit / jet-pack) crashes down
    // HIGH and is stopped by defend_high; a GROUNDED super runs in LOW and is
    // stopped by defend_low. Either guard guessed wrong lets the super land for
    // full damage. (`unblockable` / `piercesShield` no longer bypass a guard —
    // the high/low guess is the only counter now.)
    const ultLine = attackLine(attacker, attackerCharId);
    if (isDefendAction(defender) && guardBlocks(defender, ultLine)) {
      const kind = ultLine === 'high' ? 'ultimate_air' : 'ultimate_ground';
      events.push({ type: 'blocked', defender: defenderLabel, kind, name: ult.name });
      return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: true, ult, blocked: true } };
    }

    // Melee hit attacker rushing forward clips the ult-er mid-windup before
    // the ult connects — ult is interrupted (no damage to the hitter). The
    // hit's damage still lands on the ult-er via the hit branch. Skipped
    // for projectile-style hits (Woman Hero's IceShoot doesn't lunge) AND for
    // a RANGED super (Woman Hero's arrow volley): it fires from range, so a
    // charging hitter can't interrupt it — instead the volley lands and the
    // hit is stopped in the hit branch (matching the fast-shoot-vs-rush rule).
    if (defender === 'hit'
      && !ult.rangedSuper
      && !CHARACTERS[defenderCharId]?.extraProjectileActions?.includes('hit')) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'interrupted_by_hit', name: ult.name });
      return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: true, ult, missed: true } };
    }

    // Grounded ult vs airborne ult — grounded user (e.g., Woman Hero's
    // spread shot) is stationary firing arrows; the airborne ult-er
    // (jet-pack/flyHit) clears those arrows by flying past in a different
    // vertical lane. Grounded ult misses; the airborne ult lands on the
    // grounded user (handled in the opponent's branch).
    if (isUltimateKey(defender)
      && isAirborneUltimate(defenderCharId, defender)
      && !isAirborneUltimate(attackerCharId, attacker)) {
      events.push({ type: 'miss', attacker: attackerLabel, reason: 'ult_airborne', name: ult.name });
      return { attackerDamage: 0, attackerHit: false, attackResult: { ultimate: true, ult, missed: true } };
    }

    // All Ultimates land on a sliding defender — visual outcome differs:
    //  - airborne ult (flyHit / jet-pack): slider plays the FULL slide first
    //    (forward → hold → retreat back to base), and only THEN takes the
    //    death anim — read as "slid out and back, ult catches them at home"
    //  - grounded ult (e.g., womanHero spread shot): same as shoot-vs-slide
    //    pattern — slider holds in idle, brief slide, gets thrown back.
    // Both timings are computed in animResolution.computeAttackTiming.
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

// True when the shooter's projectile spawn delay is long enough that an
// opposing rusher reaches them before the throw releases. Used to flip the
// shoot-vs-slide AND shoot-vs-melee-hit outcomes: fast guns (no delay) tag
// the rusher mid-motion; slow throwers (turtle's spear delay 380, monkey's
// 320) get rushed before they fire. Threshold is the rusher's own forward
// phase length — they cover that distance in `fwdMs`, so any spawn delay
// >= fwdMs means the rusher arrives first.
// Per-character spawn delay (ms) before a `shoot` projectile is released. Fast
// guns are 0; slow throwers (monkey / turtle spear) wind up for ~550ms.
function shootProjectileDelay(charId) {
  const c = CHARACTERS[charId];
  return c?.projectileDelayByAction?.shoot ?? c?.projectileDelayMs ?? 0;
}

function isSlowProjectileShot(shooterCharId, rusherCharId, rusherAction = 'slide') {
  const shooter = CHARACTERS[shooterCharId];
  const rusher  = CHARACTERS[rusherCharId];
  const shooterDelay = shooter?.projectileDelayByAction?.shoot
    ?? shooter?.projectileDelayMs
    ?? 0;
  const defaultFwd = rusherAction === 'slide' ? 320 : 220;
  const rusherFwdMs = rusher?.motionOverrides?.[rusherAction]?.fwdMs ?? defaultFwd;
  return shooterDelay >= rusherFwdMs;
}

// Offensive actions that can both deal damage and (when they whiff against a
// guarding/evading defender) count as the attack the defender defended.
function isOffensiveAction(action) {
  return action === 'hit' || action === 'shoot' || action === 'slide' || isUltimateKey(action);
}

// Stances that earn a defend bonus when they take zero damage from an incoming
// attack: a shield guard (defend_low/high), a jump evade, or a slide dodge.
function isDefensiveStance(action) {
  return isDefendAction(action) || action === 'jump' || action === 'slide';
}

function applyMeterGains(currentMeter, charId, { landedAttack, defended }) {
  const { onHit, onDefend } = getMeterGain(charId);
  let m = currentMeter;
  if (landedAttack) m += onHit;
  if (defended)     m += onDefend;
  return Math.min(METER.MAX, m);
}
