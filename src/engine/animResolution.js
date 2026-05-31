import { isUltimateKey } from './damageEngine.js';

// Single source of truth for per-action animation durations. Imported by the
// fight loop, the spectator renderer, and DevPage so they share one timing
// budget. Keep keys aligned with `ACTION_KEYS` in `data/characters.js`.
export const ANIM_DURATION = {
  idle: 500, jump: 900, hit: 800, shoot: 800,
  slide: 950, defend: 700, hurt: 500, death: 800, none: 500, ultimate: 1550,
  // Attacker thrown back (death pose) after a hit/ultimate is blocked by a
  // shield. Long enough for the backward throw + settle tween + death pose to
  // read (see ArenaStage.tweenKnockback).
  knockback: 800,
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
  // Ult: fire at ~93% of the default flyHit fwdMs (900) so the victim's
  // reaction lands when the ult-er has nearly reached them — not at the
  // earlier phase2 anim-swap (0.78×). Before this, vs an opponent's shoot
  // the shooter's death fired mid-flight while the ult-er was still 22%
  // away in the air.
  ultimate: 840,
};

// When two converging tweens (slide ↔ slide, hit ↔ slide) approach each other,
// they meet near the centre well BEFORE either reaches the end of their fwdMs.
// Both lunge and glide use easeOut(t/fwd), so each side has covered ~half the
// forward distance at t/fwd ≈ 0.44 — that's roughly when their paths cross.
// Firing the impact at this moment keeps the hit landing BEFORE the sprites
// pass through each other. Stage-width-dependent corrections are minor; the
// 0.44 ratio is accurate to within a frame or two for the default sep.
const CONVERGE_MEET_RATIO = 0.44;
const DEFAULT_FWD_MS = { hit: 220, slide: 320, ult: 900 };
const DEFAULT_GAP = { hit: 150, slide: 130, ult: 160 };
function fwdMsFor(action, character) {
  if (isUltimateKey(action)) {
    return character?.motionOverrides?.[action]?.fwdMs ?? DEFAULT_FWD_MS.ult;
  }
  if (action !== 'hit' && action !== 'slide') return null;
  return character?.motionOverrides?.[action]?.fwdMs ?? DEFAULT_FWD_MS[action];
}
function gapFor(action, character) {
  if (isUltimateKey(action)) {
    return character?.motionOverrides?.[action]?.gap ?? DEFAULT_GAP.ult;
  }
  if (action !== 'hit' && action !== 'slide') return null;
  return character?.motionOverrides?.[action]?.gap ?? DEFAULT_GAP[action];
}
function convergeMeetMs(actionA, characterA, actionB, characterB) {
  const fwdA = fwdMsFor(actionA, characterA);
  const fwdB = fwdMsFor(actionB, characterB);
  if (!fwdA || !fwdB) return null;
  return Math.round(((fwdA + fwdB) / 2) * CONVERGE_MEET_RATIO);
}

// Two airborne flyHit Ultimates fly toward each other linearly in X. They
// collide mid-air at the t where their X paths cross. Solve:
//   dA·(t/fwdA) + dB·(t/fwdB) = 2·sep, where d = 2·sep − gap (each fighter's
//   forward travel). Default sep = 240 (max stage half-width).
const STAGE_HALF_SEP = 240;
function ultClashMeetMs(actionA, characterA, actionB, characterB) {
  const fwdA = fwdMsFor(actionA, characterA);
  const fwdB = fwdMsFor(actionB, characterB);
  const gapA = gapFor(actionA, characterA);
  const gapB = gapFor(actionB, characterB);
  if (!fwdA || !fwdB || gapA == null || gapB == null) return null;
  const dA = 2 * STAGE_HALF_SEP - gapA;
  const dB = 2 * STAGE_HALF_SEP - gapB;
  const closingSpeed = dA / fwdA + dB / fwdB;
  if (closingSpeed <= 0) return null;
  return Math.round((2 * STAGE_HALF_SEP) / closingSpeed);
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
    // flyHit phase2 (hit-pose anim swap) triggers at 0.78 × fwdMs, but the
    // attacker keeps traveling until 1.0. Fire the victim's reaction at 0.93
    // so it lands as the ult-er nearly arrives — not mid-flight when they're
    // still ~22% away (which read as "the shooter dies before the ult-er
    // reaches them").
    const override = character?.motionOverrides?.[action];
    if (override?.fwdMs)             return Math.round(override.fwdMs * 0.93);
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
  // Rush-style hits (Skater Kid's skateboard run) get the slide-pattern
  // reaction TIMING, but skip the idle hold — their fwdMs is long enough
  // that they're still mid-rush when the bullet meets them at the slide-
  // pattern reaction time. Holding them in idle first just adds dead air.
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

// Hit-vs-fast-shoot reaction time: when the bullet visually crosses the
// hitter mid-lunge. Empirically ~90% of the lunge's forward phase — bullet
// has flown most of its path by then and the hitter has nearly reached the
// hit target. No artificial idle hold here, the lunge starts at t=0.
const HIT_VS_SHOOT_REACTION_RATIO = 0.9;
function hitVsShootReactAt(hitterChar) {
  const fwdMs = hitterChar?.motionOverrides?.hit?.fwdMs ?? 220;
  return Math.round(fwdMs * HIT_VS_SHOOT_REACTION_RATIO);
}

// When a blocked attacker is thrown back, decide WHEN the throw fires.
//   melee hit → at normal impact (the punch meets the shield and bounces).
//   ultimate  → the super move flies all the way in and the hit lands FIRST;
//               only after the forward flight + half the hold does the shield
//               hurl the attacker away. So fire later than the normal ult
//               impact (which is ~0.93·fwdMs, mid-descent).
function shieldThrowAt(action, character) {
  if (isUltimateKey(action)) {
    const fwd = fwdMsFor(action, character) ?? DEFAULT_FWD_MS.ult;
    // Roll-type ults (Skater Sky Grind, Monkey Cloud Somersault) bounce off
    // the shield as soon as they reach the head — no shield-hold loiter, no
    // rolling-in-place. Fire the throwback right as fwd ends (small buffer
    // so the head contact registers visually).
    if (action === 'ultimate_roll') return fwd + 30;
    // Other ults (slam-style) fly all the way in, the hit "lands" on the
    // shield, then the throwback fires after half the hold — reads as
    // "impact, brief contact, hurled away".
    const hold = character?.motionOverrides?.[action]?.holdMs ?? 500;
    return Math.round(fwd + hold * 0.5);
  }
  return impactDelayFor(action, character);
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
  // Same idea for projectile-hit landing on a slider — slide dodges the
  // arrow's path momentarily, but once they finish the glide and return to
  // base the arrow catches them. Plays simple hurt at base (no throwback
  // since they've already returned to baseX).
  const aSlideLandedHurt = actionA === 'slide' && damageToA > 0 && !aGotUltHit && actionB === 'hit' && isProjectileHit(characterB);
  const bSlideLandedHurt = actionB === 'slide' && damageToB > 0 && !bGotUltHit && actionA === 'hit' && isProjectileHit(characterA);
  // Slider getting clipped by an incoming attack:
  //  - fast shoot: reaction fires before bullet reaches base (mid-slide
  //    throwback) — uses the shoot-vs-slide pattern.
  //  - grounded ult (e.g., womanHero spread): same pattern as fast shoot.
  //  - airborne ult (Beast Rocket Charge, etc.): slider plays the full slide
  //    (forward → hold → retreat to base) and the reaction fires AFTER the
  //    slide completes — the death anim plays at base, no throwback tween.
  // Slide-shoot pattern: slider (or rush-style hitter, e.g. Skater Kid)
  // hit by fast shoot or grounded ult — holds, lunges briefly, throwback
  // at shoot-pattern offset.
  const aIsRushy = actionA === 'slide' || (actionA === 'hit' && characterA?.hitIsRushStyle);
  const bIsRushy = actionB === 'slide' || (actionB === 'hit' && characterB?.hitIsRushStyle);
  const aShootPattern = aIsRushy && damageToA > 0 && (
    actionB === 'shoot'
    || (isUltimateKey(actionB) && !isAirborneUlt(actionB, characterB))
  );
  const bShootPattern = bIsRushy && damageToB > 0 && (
    actionA === 'shoot'
    || (isUltimateKey(actionA) && !isAirborneUlt(actionA, characterA))
  );
  // Hit-vs-fast-shoot: melee hitter clipped mid-lunge by an incoming bullet.
  // No hold — lunge starts at t=0 and the reaction fires when the bullet
  // visually meets the hitter (~90% of fwdMs). Rush-style hits use the
  // slide-shoot pattern above instead.
  const aHitVsShoot = actionA === 'hit' && damageToA > 0 && actionB === 'shoot'
    && !isProjectileHit(characterA) && !characterA?.hitIsRushStyle;
  const bHitVsShoot = actionB === 'hit' && damageToB > 0 && actionA === 'shoot'
    && !isProjectileHit(characterB) && !characterB?.hitIsRushStyle;
  // Airborne ult vs airborne ult: engine clashes both for 0 damage, but
  // visually we want both fighters to collide mid-flight and fall down with
  // the death anim (HP unchanged, only the visual reads as a knockout).
  // Skipped when either ult is grounded (Woman Hero's spread shot stays
  // grounded — that pairing keeps the silent clash with no death anim).
  const isAirborneUltClash =
    isUltimateKey(actionA) && isUltimateKey(actionB)
    && damageToA === 0 && damageToB === 0
    && isAirborneUlt(actionA, characterA) && isAirborneUlt(actionB, characterB);
  const ultClashAt = isAirborneUltClash
    ? ultClashMeetMs(actionA, characterA, actionB, characterB)
    : null;
  // Airborne ult-er clipped by an opposing melee hit: ult is interrupted in
  // engine; here we make the ult-er fall out of mid-flight with the death
  // anim (rather than the default 'hurt' which would just play in place).
  const aAirborneUltKO = isUltimateKey(actionA) && damageToA > 0 && isAirborneUlt(actionA, characterA);
  const bAirborneUltKO = isUltimateKey(actionB) && damageToB > 0 && isAirborneUlt(actionB, characterB);
  // Slow-shooter clipped by a rushing melee hit (turtle/monkey spear). The
  // reaction must fire BEFORE the projectile spawn delay so cancelPending-
  // Projectiles can clear the spawn timer — otherwise the spear visually
  // releases before the throw is interrupted. Using fwdMsFor('hit') puts
  // the reaction at the lunge's forward-end (~220ms < monkey's 320 spawn).
  const aShooterHitByLunge = actionA === 'shoot' && damageToA > 0 && actionB === 'hit' && !isProjectileHit(characterB);
  const bShooterHitByLunge = actionB === 'shoot' && damageToB > 0 && actionA === 'hit' && !isProjectileHit(characterA);
  // Same idea for melee hit vs melee hit — both lunge toward each other,
  // collide mid-fwd, throw back to base with the death anim. Skipped for
  // projectile-style hits (Woman Hero's IceShoot doesn't lunge — that
  // pairing keeps the silent clash).
  const isMeleeHitClash =
    actionA === 'hit' && actionB === 'hit'
    && damageToA === 0 && damageToB === 0
    && !isProjectileHit(characterA) && !isProjectileHit(characterB);
  const hitClashAt = isMeleeHitClash
    ? convergeMeetMs('hit', characterA, 'hit', characterB)
    : null;
  const aSlideUltAirborne = actionA === 'slide' && damageToA > 0
    && isUltimateKey(actionB) && isAirborneUlt(actionB, characterB);
  const bSlideUltAirborne = actionB === 'slide' && damageToB > 0
    && isUltimateKey(actionA) && isAirborneUlt(actionA, characterA);
  const reactionA = isAirborneUltClash || isMeleeHitClash || aAirborneUltKO ? 'death'
    : aLandedHurt ? reactionAnim(damageToA, aGotUltHit, actionA, /* knockdownFromAir */ false)
    : aSlideLandedHurt ? 'hurt'
    : reactionAnim(damageToA, aGotUltHit, actionA);
  const reactionB = isAirborneUltClash || isMeleeHitClash || bAirborneUltKO ? 'death'
    : bLandedHurt ? reactionAnim(damageToB, bGotUltHit, actionB, /* knockdownFromAir */ false)
    : bSlideLandedHurt ? 'hurt'
    : reactionAnim(damageToB, bGotUltHit, actionB);
  // Rush-style hits (Skater Kid) have a much longer fwdMs (600) than slides
  // (320), so applying the standard slide-shoot offset can push the reaction
  // past the rusher's forward-target arrival. Cap the rush reaction at ~90%
  // of the rusher's fwdMs so the throwback fires just before they reach the
  // opponent rather than during the post-reach hold.
  const RUSH_FWD_CAP_RATIO = 0.9;
  const rushReactCapA = (actionA === 'hit' && characterA?.hitIsRushStyle)
    ? Math.round((fwdMsFor('hit', characterA) ?? DEFAULT_FWD_MS.hit) * RUSH_FWD_CAP_RATIO)
    : null;
  const rushReactCapB = (actionB === 'hit' && characterB?.hitIsRushStyle)
    ? Math.round((fwdMsFor('hit', characterB) ?? DEFAULT_FWD_MS.hit) * RUSH_FWD_CAP_RATIO)
    : null;
  const reactionAtA = isAirborneUltClash ? ultClashAt
    : isMeleeHitClash ? hitClashAt
    : aLandedHurt ? launchAtA + ANIM_DURATION.jump
    : aSlideLandedHurt ? ANIM_DURATION.slide
    : aShootPattern ? (rushReactCapA != null
        ? Math.min(shootSlideHitsAt(impactB), rushReactCapA)
        : shootSlideHitsAt(impactB))
    : aHitVsShoot ? hitVsShootReactAt(characterA)
    : aShooterHitByLunge ? (fwdMsFor('hit', characterB) ?? DEFAULT_FWD_MS.hit)
    : aSlideUltAirborne ? ANIM_DURATION.slide
    : impactB;
  const reactionAtB = isAirborneUltClash ? ultClashAt
    : isMeleeHitClash ? hitClashAt
    : bLandedHurt ? launchAtB + ANIM_DURATION.jump
    : bSlideLandedHurt ? ANIM_DURATION.slide
    : bShootPattern ? (rushReactCapB != null
        ? Math.min(shootSlideHitsAt(impactA), rushReactCapB)
        : shootSlideHitsAt(impactA))
    : bHitVsShoot ? hitVsShootReactAt(characterB)
    : bShooterHitByLunge ? (fwdMsFor('hit', characterA) ?? DEFAULT_FWD_MS.hit)
    : bSlideUltAirborne ? ANIM_DURATION.slide
    : impactA;
  // ── Shield throwback ──────────────────────────────────────────────────
  // When an attacker's hit/ultimate is blocked by the opponent's shield, the
  // attacker is thrown back. damageEngine tags each `blocked` event with the
  // DEFENDER's label, so a block with defender 'B' means A's blow bounced off
  // B's shield → A is thrown (and vice-versa). `piercesShield` attackers
  // (Woman Hero) never produce a block event, so they're naturally exempt.
  // The throw only overrides a fighter with no existing damage reaction.
  const aThrownBack = !reactionA
    && (result.events?.some(e => e.type === 'blocked' && e.defender === 'B') ?? false);
  const bThrownBack = !reactionB
    && (result.events?.some(e => e.type === 'blocked' && e.defender === 'A') ?? false);
  const outReactionA = aThrownBack ? 'knockback' : reactionA;
  const outReactionB = bThrownBack ? 'knockback' : reactionB;
  const outReactionAtA = aThrownBack ? shieldThrowAt(actionA, characterA) : reactionAtA;
  const outReactionAtB = bThrownBack ? shieldThrowAt(actionB, characterB) : reactionAtB;
  // Each fighter's "natural" anim duration accounts for the launch delay.
  const ownAnimEndA = launchAnimA ? launchAtA + durationFor(launchAnimA) : durationFor(initialAnimA);
  const ownAnimEndB = launchAnimB ? launchAtB + durationFor(launchAnimB) : durationFor(initialAnimB);
  // Successful block: when defender blocks an opposing hit or Ultimate (no
  // damage taken), they should hold the defend pose for the full duration of
  // the attacker's animation — without this, the defender's defend ends at
  // ANIM_DURATION.defend (700ms) while the attacker is still mid-swing/ult.
  const aDefendBlocking = actionA === 'defend' && damageToA === 0
    && (actionB === 'hit' || isUltimateKey(actionB));
  const bDefendBlocking = actionB === 'defend' && damageToB === 0
    && (actionA === 'hit' || isUltimateKey(actionA));
  // Victim clears at reaction + reaction-anim duration; non-victim clears at
  // the natural anim end (extended to opponent's anim when blocking, and to
  // the thrown attacker's knockback so the defender holds the shield until the
  // opponent finishes tumbling).
  const clearA = outReactionA ? outReactionAtA + durationFor(outReactionA)
    : aDefendBlocking ? Math.max(ownAnimEndA, durationFor(actionB),
        bThrownBack ? outReactionAtB + durationFor('knockback') : 0)
    : ownAnimEndA;
  const clearB = outReactionB ? outReactionAtB + durationFor(outReactionB)
    : bDefendBlocking ? Math.max(ownAnimEndB, durationFor(actionA),
        aThrownBack ? outReactionAtA + durationFor('knockback') : 0)
    : ownAnimEndB;
  return {
    initialAnimA, initialAnimB,
    launchAnimA, launchAnimB,
    launchAtA, launchAtB,
    reactionA: outReactionA, reactionB: outReactionB,
    reactionAtA: outReactionAtA, reactionAtB: outReactionAtB,
    impactA, impactB,
    clearA, clearB,
    aGotUltHit, bGotUltHit,
  };
}
