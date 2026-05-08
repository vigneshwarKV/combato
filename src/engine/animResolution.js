import { isUltimateKey } from './damageEngine.js';

// Single source of truth for per-action animation durations. Imported by the
// fight loop, the spectator renderer, and DevPage so they share one timing
// budget. Keep keys aligned with `ACTION_KEYS` in `data/characters.js`.
export const ANIM_DURATION = {
  idle: 500, jump: 900, hit: 800, shoot: 800,
  slide: 950, defend: 700, hurt: 500, death: 800, none: 500, ultimate: 1550,
};

// When (ms from action start) each attacker action visually CONNECTS with its
// target. Used to schedule the victim's hurt/death animation so the reaction
// lands on impact instead of pre-empting the victim's own action animation.
// Source for the numbers: ArenaStage.jsx motion phase timings (lunge fwdMs,
// glide fwdMs, flyHit phase2 trigger, projectile travel = 600ms).
export const IMPACT_DELAY = {
  hit:    380,   // mid-lunge hold
  shoot:  600,   // projectile travel time (spawn delay added on top)
  slide:  320,   // end of forward glide (vs a stationary defender)
  ultimate: 750, // ~0.78 × 900 fwdMs default for flyHit
};

// When two converging tweens (slide ↔ slide, hit ↔ slide) approach each other,
// they meet near the centre well BEFORE either reaches the end of their fwdMs.
// Both lunge and glide use easeOut(t/fwd), so each side has covered ~half the
// forward distance at t/fwd ≈ 0.44 — that's roughly when their paths cross.
// Firing the impact at this moment keeps the hit landing BEFORE the sprites
// pass through each other. Stage-width-dependent corrections are minor; the
// 0.44 ratio is accurate to within a frame or two for the default sep.
const CONVERGE_MEET_RATIO = 0.44;
const DEFAULT_FWD_MS = { hit: 220, slide: 320 };
function fwdMsFor(action, character) {
  if (action !== 'hit' && action !== 'slide') return null;
  return character?.motionOverrides?.[action]?.fwdMs ?? DEFAULT_FWD_MS[action];
}
function convergeMeetMs(actionA, characterA, actionB, characterB) {
  const fwdA = fwdMsFor(actionA, characterA);
  const fwdB = fwdMsFor(actionB, characterB);
  if (!fwdA || !fwdB) return null;
  return Math.round(((fwdA + fwdB) / 2) * CONVERGE_MEET_RATIO);
}

export function durationFor(actionKey) {
  if (isUltimateKey(actionKey)) return ANIM_DURATION.ultimate;
  return ANIM_DURATION[actionKey] || 500;
}

// True iff `victim` actually took ultimate damage this turn (not just blocked).
export function hasUltimateHit(events, victim) {
  return events?.some(e => e.type === 'ultimate' && e.victim === victim && (e.damage ?? 0) > 0) || false;
}

// resolveActions adds `ult.selfDamage` (e.g. Beast's Rocket Charge -5 HP) onto
// the attacker's `damageTo*` total, but that's a status cost — NOT a hit from
// the opponent. Reaction anims should only fire on opponent-inflicted damage,
// otherwise Beast swaps to `hurt` mid-rocket-charge and clips its own ult.
function selfDamageFor(events, fighter) {
  if (!events?.length) return 0;
  let total = 0;
  for (const e of events) {
    if (e.type === 'self_damage' && e.fighter === fighter) total += (e.amount ?? 0);
  }
  return total;
}

// Pick the reaction animation a victim should play when they take damage.
// Returns null when the fighter took no damage (no override needed).
//   ultimate damage                → 'death' (fall+die)
//   melee hit while jumping        → 'death' (knocked out of the air)
//   projectile hit while jumping   → 'hurt'  (no knockdown — jumper completes
//                                      arc and hurt fires after landing)
//   slide collision                → 'death' (hard throwback)
//   hit-attacker clipped by slide  → 'death' (legs taken out — throwback
//                                      reads better than a meek 'hurt' here)
//   any other damage               → 'hurt'
// In every 'death' case, ArenaStage's tweenImpactRecover carries the sprite
// back to base position while the death anim plays.
export function reactionAnim(damage, gotUltHit, victimAction, knockdownFromAir = true) {
  if (damage <= 0) return null;
  if (gotUltHit) return 'death';
  if (victimAction === 'jump' && knockdownFromAir) return 'death';
  if (victimAction === 'slide') return 'death';
  if (victimAction === 'hit') return 'death';
  return 'hurt';
}

// True when this character's `hit` is projectile-based (e.g., womanHero
// fires an ice arrow on her IceShoot3) rather than a melee swing.
export function isProjectileHit(character) {
  return !!character?.extraProjectileActions?.includes('hit');
}

// True when this character's ultimate motion lifts them off the ground
// (flyHit / jumpShoot / arc) — same logic as data/characters.isAirborneUltimate
// but takes the character object directly so animResolution doesn't need to
// look up by id. Default ult motion is flyHit → airborne.
function isAirborneUlt(action, character) {
  if (!isUltimateKey(action)) return false;
  const kind = character?.motionOverrides?.[action]?.kind;
  if (!kind) return true; // default flyHit
  return kind === 'flyHit' || kind === 'jumpShoot' || kind === 'arc';
}

// Visual ms from action start until the attacker's blow lands on its target.
// `character.projectileDelayByAction[action] || character.projectileDelayMs`
// is added for projectile-based actions so per-character spawn delays line up.
export function impactDelayFor(action, character) {
  if (!action) return 0;
  if (action === 'shoot') {
    const spawn = character?.projectileDelayByAction?.shoot ?? character?.projectileDelayMs ?? 0;
    return spawn + IMPACT_DELAY.shoot;
  }
  if (action === 'hit') {
    if (isProjectileHit(character)) {
      const spawn = character?.projectileDelayByAction?.hit ?? character?.projectileDelayMs ?? 0;
      return spawn + IMPACT_DELAY.shoot;
    }
    return IMPACT_DELAY.hit;
  }
  if (action === 'slide') return IMPACT_DELAY.slide;
  if (isUltimateKey(action)) {
    // flyHit phase2 triggers at 0.78 × fwdMs — read the override if present
    // so character-specific timings (e.g., monkey's longer fwdMs) stay in sync.
    const override = character?.motionOverrides?.[action];
    if (override?.fwdMs)             return Math.round(override.fwdMs * 0.78);
    if (override?.kind === 'jumpShoot') return (override.upMs ?? 400) + (override.holdMs ?? 200);
    if (override?.spreadShot) {
      const release = override.releaseDelay ?? 0;
      const spawn = character?.projectileDelayByAction?.[action] ?? character?.projectileDelayMs ?? 0;
      return spawn + release + IMPACT_DELAY.shoot;
    }
    return IMPACT_DELAY.ultimate;
  }
  return 0;
}

// When a defender jumps against a slow attack (turtle's spear, monkey's spear,
// womanHero's arrows — all of which travel ~600ms after a per-character spawn
// delay), the natural jump arc finishes before the projectile arrives, so the
// dodge reads as "jump and land, then projectile drifts past." Hold the jump
// launch so its peak (~jumpDuration/2) lines up with the incoming impact time.
function jumpHoldFor(ownAction, opponentImpact) {
  if (ownAction !== 'jump') return 0;
  const jumpPeakMs = ANIM_DURATION.jump / 2; // ~450ms
  if (opponentImpact <= jumpPeakMs) return 0;
  return Math.round(opponentImpact - jumpPeakMs);
}

// When a slider is going to take damage from an incoming shoot, the natural
// slide tween reaches the opponent before the bullet arrives — so visually
// the slider charges all the way in, THEN the slide gets cut short on the
// recovery. The user wants the bullet to clip them just after the slide
// starts. Two-step:
//  - The reaction fires SHOOT_HIT_OFFSET_MS BEFORE the bullet reaches the
//    slider's resting base (the bullet is still in flight; visually it has
//    just passed through where the slider is mid-glide).
//  - The slide is held so it starts SLIDE_LEAD_MS before the reaction —
//    slider barely begins their forward phase before getting hit.
const SLIDE_LEAD_MS = 100;
const SHOOT_HIT_OFFSET_MS = 250;
function shootSlideHitsAt(opponentImpact) {
  return Math.max(0, opponentImpact - SHOOT_HIT_OFFSET_MS);
}
function slideHoldFor(ownAction, ownDamage, opponentAction, opponentImpact, opponentChar) {
  if (ownAction !== 'slide') return 0;
  if (ownDamage <= 0) return 0;
  // Shoot-pattern timing also applies to grounded Ultimates (e.g., womanHero's
  // spread shot). For airborne Ultimates the slider plays their full slide
  // and the reaction fires after — handled in computeAttackTiming, NO hold.
  const isShoot = opponentAction === 'shoot';
  const isGroundedUlt = isUltimateKey(opponentAction) && !isAirborneUlt(opponentAction, opponentChar);
  if (!isShoot && !isGroundedUlt) return 0;
  const reactionAt = shootSlideHitsAt(opponentImpact);
  if (reactionAt <= SLIDE_LEAD_MS) return 0;
  return Math.round(reactionAt - SLIDE_LEAD_MS);
}

// Given a resolveActions() result and (optionally) the two characters,
// produce the timeline the renderers need to schedule the turn.
//   initialAnim*   → what plays at t=0 (becomes 'idle' when a launch is delayed)
//   launchAnim*    → the deferred action to swap to (null when not delayed)
//   launchAt*      → when to swap initialAnim → launchAnim (0 when not delayed)
//   reaction*      → 'hurt' / 'death' / null — what the victim swaps to
//   reactionAtA/B  → ms when each victim's reaction fires (impact for melee /
//                    ult; jumper-landing for projectile-hit-vs-jumper so the
//                    hurt reads as "they came down, then hurt").
//   impactA        → ms until A's attack visually lands (sound/fx alignment)
//   impactB        → ms until B's attack visually lands
//   clearA/B       → ms until each fighter returns to idle (or no clear if KO'd)
export function computeAttackTiming(result, characterA, characterB) {
  const aGotUltHit = hasUltimateHit(result.events, 'A');
  const bGotUltHit = hasUltimateHit(result.events, 'B');
  const actionA = result.actualActionA || 'idle';
  const actionB = result.actualActionB || 'idle';
  // Strip self-damage so reactions only fire for opponent-inflicted hits.
  const damageToA = Math.max(0, result.damageToA - selfDamageFor(result.events, 'A'));
  const damageToB = Math.max(0, result.damageToB - selfDamageFor(result.events, 'B'));
  let impactA = impactDelayFor(actionA, characterA);
  let impactB = impactDelayFor(actionB, characterB);
  // Converging melee pairs (slide-vs-slide, hit-vs-slide, slide-vs-hit) meet
  // at the centre well before either reaches end-of-fwd. Override both impact
  // times to the meeting moment so the reaction fires BEFORE the sprites
  // cross through each other.
  const isConverging = (actionA === 'slide' && actionB === 'slide')
    || (actionA === 'hit'   && actionB === 'slide')
    || (actionA === 'slide' && actionB === 'hit');
  if (isConverging) {
    const meetAt = convergeMeetMs(actionA, characterA, actionB, characterB);
    if (meetAt != null) {
      impactA = meetAt;
      impactB = meetAt;
    }
  }
  // Slow-attack jump-sync: hold the jumper in idle until just before peak.
  // Same idea for sliders against fast shoots OR grounded Ultimates — hold
  // so the bullet/arrow catches them just after the slide starts. Slow
  // throwers (turtle/monkey) don't trigger slideHold because the slider
  // takes no damage in that pairing (slide rushes the thrower instead).
  // Airborne Ultimates also don't hold — the slider plays their full slide
  // and the reaction fires when the slide naturally completes.
  const launchAtA = jumpHoldFor(actionA, impactB)
    || slideHoldFor(actionA, damageToA, actionB, impactB, characterB);
  const launchAtB = jumpHoldFor(actionB, impactA)
    || slideHoldFor(actionB, damageToB, actionA, impactA, characterA);
  const initialAnimA = launchAtA > 0 ? 'idle' : actionA;
  const initialAnimB = launchAtB > 0 ? 'idle' : actionB;
  const launchAnimA = launchAtA > 0 ? actionA : null;
  const launchAnimB = launchAtB > 0 ? actionB : null;
  // Projectile-hit landing on a jumper: damage applies, but the hurt anim is
  // deferred until the jumper has finished their arc (no knockdown, just
  // "they landed, then hurt"). For everyone else (melee hit, ult, etc.) the
  // reaction fires at the visual impact and uses 'death' if mid-air.
  const aLandedHurt = actionA === 'jump' && damageToA > 0 && !aGotUltHit && actionB === 'hit' && isProjectileHit(characterB);
  const bLandedHurt = actionB === 'jump' && damageToB > 0 && !bGotUltHit && actionA === 'hit' && isProjectileHit(characterA);
  // Slider getting clipped by an incoming attack:
  //  - fast shoot: reaction fires before bullet reaches base (mid-slide
  //    throwback) — uses the shoot-vs-slide pattern.
  //  - grounded ult (e.g., womanHero spread): same pattern as fast shoot.
  //  - airborne ult (Beast Rocket Charge, etc.): slider plays the full slide
  //    (forward → hold → retreat to base) and the reaction fires AFTER the
  //    slide completes — the death anim plays at base, no throwback tween.
  const aShootPattern = actionA === 'slide' && damageToA > 0 && (
    actionB === 'shoot'
    || (isUltimateKey(actionB) && !isAirborneUlt(actionB, characterB))
  );
  const bShootPattern = actionB === 'slide' && damageToB > 0 && (
    actionA === 'shoot'
    || (isUltimateKey(actionA) && !isAirborneUlt(actionA, characterA))
  );
  const aSlideUltAirborne = actionA === 'slide' && damageToA > 0
    && isUltimateKey(actionB) && isAirborneUlt(actionB, characterB);
  const bSlideUltAirborne = actionB === 'slide' && damageToB > 0
    && isUltimateKey(actionA) && isAirborneUlt(actionA, characterA);
  const reactionA = aLandedHurt
    ? reactionAnim(damageToA, aGotUltHit, actionA, /* knockdownFromAir */ false)
    : reactionAnim(damageToA, aGotUltHit, actionA);
  const reactionB = bLandedHurt
    ? reactionAnim(damageToB, bGotUltHit, actionB, /* knockdownFromAir */ false)
    : reactionAnim(damageToB, bGotUltHit, actionB);
  const reactionAtA = aLandedHurt ? launchAtA + ANIM_DURATION.jump
    : aShootPattern ? shootSlideHitsAt(impactB)
    : aSlideUltAirborne ? ANIM_DURATION.slide
    : impactB;
  const reactionAtB = bLandedHurt ? launchAtB + ANIM_DURATION.jump
    : bShootPattern ? shootSlideHitsAt(impactA)
    : bSlideUltAirborne ? ANIM_DURATION.slide
    : impactA;
  // Each fighter's "natural" anim duration accounts for the launch delay.
  const ownAnimEndA = launchAnimA ? launchAtA + durationFor(launchAnimA) : durationFor(initialAnimA);
  const ownAnimEndB = launchAnimB ? launchAtB + durationFor(launchAnimB) : durationFor(initialAnimB);
  // Victim clears at reaction + reaction-anim duration; non-victim clears at
  // the natural anim end.
  const clearA = reactionA ? reactionAtA + durationFor(reactionA) : ownAnimEndA;
  const clearB = reactionB ? reactionAtB + durationFor(reactionB) : ownAnimEndB;
  return {
    initialAnimA, initialAnimB,
    launchAnimA, launchAnimB,
    launchAtA, launchAtB,
    reactionA, reactionB,
    reactionAtA, reactionAtB,
    impactA, impactB,
    clearA, clearB,
    aGotUltHit, bGotUltHit,
  };
}
