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
  slide:  320,   // end of forward glide
  ultimate: 750, // ~0.78 × 900 fwdMs default for flyHit
};

export function durationFor(actionKey) {
  if (isUltimateKey(actionKey)) return ANIM_DURATION.ultimate;
  return ANIM_DURATION[actionKey] || 500;
}

// True iff `victim` actually took ultimate damage this turn (not just blocked).
export function hasUltimateHit(events, victim) {
  return events?.some(e => e.type === 'ultimate' && e.victim === victim && (e.damage ?? 0) > 0) || false;
}

// Pick the reaction animation a victim should play when they take damage.
// Returns null when the fighter took no damage (no override needed).
export function reactionAnim(damage, gotUltHit) {
  if (gotUltHit) return 'death';
  if (damage > 0) return 'hurt';
  return null;
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
  if (action === 'hit')   return IMPACT_DELAY.hit;
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

// Given a resolveActions() result and (optionally) the two characters,
// produce the timeline the renderers need to schedule the turn.
//   initialAnim*  → what plays at t=0 (becomes 'idle' when a launch is delayed)
//   launchAnim*   → the deferred action to swap to (null when not delayed)
//   launchAt*     → when to swap initialAnim → launchAnim (0 when not delayed)
//   reaction*     → 'hurt' / 'death' / null — what the victim swaps to at impact
//   impactA       → ms until A's attack lands on B (schedules B's reaction)
//   impactB       → ms until B's attack lands on A (schedules A's reaction)
//   clearA/B      → ms until each fighter returns to idle (or no clear if KO'd)
export function computeAttackTiming(result, characterA, characterB) {
  const aGotUltHit = hasUltimateHit(result.events, 'A');
  const bGotUltHit = hasUltimateHit(result.events, 'B');
  const actionA = result.actualActionA || 'idle';
  const actionB = result.actualActionB || 'idle';
  const reactionA = reactionAnim(result.damageToA, aGotUltHit);
  const reactionB = reactionAnim(result.damageToB, bGotUltHit);
  const impactA = impactDelayFor(actionA, characterA);
  const impactB = impactDelayFor(actionB, characterB);
  // Slow-attack jump-sync: hold the jumper in idle until just before peak.
  const launchAtA = jumpHoldFor(actionA, impactB);
  const launchAtB = jumpHoldFor(actionB, impactA);
  const initialAnimA = launchAtA > 0 ? 'idle' : actionA;
  const initialAnimB = launchAtB > 0 ? 'idle' : actionB;
  const launchAnimA = launchAtA > 0 ? actionA : null;
  const launchAnimB = launchAtB > 0 ? actionB : null;
  // Each fighter's "natural" anim duration accounts for the launch delay.
  const ownAnimEndA = launchAnimA ? launchAtA + durationFor(launchAnimA) : durationFor(initialAnimA);
  const ownAnimEndB = launchAnimB ? launchAtB + durationFor(launchAnimB) : durationFor(initialAnimB);
  // Victim clears at impact + reaction; non-victim clears at the natural end.
  const clearA = reactionA ? impactB + durationFor(reactionA) : ownAnimEndA;
  const clearB = reactionB ? impactA + durationFor(reactionB) : ownAnimEndB;
  return {
    initialAnimA, initialAnimB,
    launchAnimA, launchAnimB,
    launchAtA, launchAtB,
    reactionA, reactionB,
    impactA, impactB,
    clearA, clearB,
    aGotUltHit, bGotUltHit,
  };
}
