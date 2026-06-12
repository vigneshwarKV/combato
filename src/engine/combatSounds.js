/**
 * Per-turn combat SFX scheduling.
 *
 * Translates a resolved turn (damageEngine events + animResolution timing) into
 * a list of timestamped sounds, so both the host loop (useFight) and the
 * spectator renderer (useFightRenderer) share one source of truth for WHICH
 * sound fires WHEN. The caller schedules each entry itself (so it can apply its
 * own cancellation guard).
 *
 * Mapping:
 *   1. shoot            → shoot.mp3 at the projectile-spawn moment
 *   2. Skater Kid shoot → laserShoot.mp3 (his beam, not a gunshot)
 *   3. landed hit / slam-super that ends in a hit → hammer-hit.mp3 on impact,
 *      EXCEPT for the ranged / spear / rolling fighters (see HAMMER_EXCLUDED).
 *   4. ANY hit / super blocked by defend_high → shield-blocked.mp3 (the blow
 *      clangs off the raised guard) at the attacker's throwback moment. Not
 *      gated to hammer fighters — a block is about the defense, not the weapon.
 *   5. any landed/connecting attack → hurt.mp3 on the victim (the "ouch"),
 *      alongside the attacker's weapon sound.
 *   6. slide → roll.mp3 for fighters whose slide is a roll (monkey/turtle/
 *      skater/womanHero), slide.mp3 for everyone else, at the slide start.
 *   7. rolling super (skater/monkey/turtle) → roll.mp3 as it lands.
 *   8. clash (slide↔slide, hit↔hit, super↔super) → clash.mp3 at the collision.
 *
 * Only real recorded clips are scheduled — the old synthesized SFX are gone.
 * (Background music is handled separately in soundEngine.startBackgroundMusic.)
 */
import { isUltimateKey } from './damageEngine.js';
import { playClip, preloadClips } from './soundEngine.js';

export const COMBAT_SOUND_FILES = {
  shoot:        '/assets/sound/shoot.mp3',
  laserShoot:   '/assets/sound/laserShoot.mp3',
  hammerHit:    '/assets/sound/hammer-hit.mp3',
  shieldBlocked: '/assets/sound/shield-blocked.mp3',
  hurt:         '/assets/sound/hurt.mp3',
  clash:        '/assets/sound/clash.mp3',
  roll:         '/assets/sound/roll.mp3',
  slide:        '/assets/sound/slide.mp3',
  winner:       '/assets/sound/winner.mp3',
};

// Fighters whose hit / super is NOT a hammer-style strike: the archer
// (womanHero), the spear throwers (monkey, turtle) and the rolling acrobat
// (skater). They never trigger the hammer-hit impact.
const HAMMER_EXCLUDED = new Set(['womanHero', 'monkey', 'skater', 'turtle']);

// Fighters whose `slide` action is a roll (their slide animation tumbles) — use
// roll.mp3 instead of slide.mp3 when they slide.
const ROLL_SLIDE_CHARS = new Set(['monkey', 'turtle', 'skater', 'womanHero']);

// Fighters whose ultimate ends in a roll (Sky Grind / Cloud Somersault / Shell
// Cyclone) — play roll.mp3 as the super lands.
const ROLL_SUPER_CHARS = new Set(['skater', 'monkey', 'turtle']);

// A hammer attacker lands a heavy melee 'hit' OR a slam-style super (every PNG
// fighter's airborne ultimate ends in a 'hit' pose). Excluded fighters never
// qualify, so a blocked-high check below is automatically restricted to them.
function isHammerAttacker(charId, action) {
  if (!charId || HAMMER_EXCLUDED.has(charId)) return false;
  return action === 'hit' || isUltimateKey(action);
}

function shootSpawnDelay(char) {
  return char?.projectileDelayByAction?.shoot ?? char?.projectileDelayMs ?? 0;
}

export function preloadCombatClips() {
  preloadClips(Object.values(COMBAT_SOUND_FILES));
}

// Victory fanfare — played when a fighter wins (KO or decision) and starts
// celebrating. No winner on a draw, so the caller skips it there.
export function playWinnerSound() {
  playClip(COMBAT_SOUND_FILES.winner);
}

// Build the per-turn sound schedule. Returns [{ delayMs, file, gain? }].
export function planCombatSounds({ events = [], actionA, actionB, charAId, charBId, charA, charB, timing }) {
  const plan = [];
  if (!timing) return plan;

  const sides = [
    {
      S: 'A', O: 'B', action: actionA, charId: charAId, char: charA,
      myReactAt: timing.reactionAtA, opReactAt: timing.reactionAtB, attackImpact: timing.impactA,
    },
    {
      S: 'B', O: 'A', action: actionB, charId: charBId, char: charB,
      myReactAt: timing.reactionAtB, opReactAt: timing.reactionAtA, attackImpact: timing.impactB,
    },
  ];

  // A collision this turn (slide↔slide, hit↔hit, super↔super). Suppresses the
  // per-side rolling-super sound (the supers meet mid-air and never complete
  // the roll-down).
  const hasClash = events.some(e => e.type === 'clash');

  for (const s of sides) {
    const { S, O, action, charId, char } = s;
    if (!action) continue;

    // (1, 2) Shoot — gunshot, or Skater Kid's laser beam. Skip when the throw
    // was interrupted before release (a slow thrower rushed down mid-windup):
    // no projectile spawns, so no shot is heard.
    if (action === 'shoot') {
      const interrupted = events.some(e =>
        e.type === 'miss' && e.attacker === S
        && typeof e.reason === 'string' && e.reason.startsWith('interrupted'));
      if (!interrupted) {
        plan.push({
          delayMs: Math.max(0, shootSpawnDelay(char)),
          file: charId === 'skater' ? COMBAT_SOUND_FILES.laserShoot : COMBAT_SOUND_FILES.shoot,
        });
      }
    }

    // (6) Slide — a roll for the tumblers (monkey/turtle/skater/womanHero), a
    // slide for everyone else, at the moment the move starts.
    if (action === 'slide') {
      plan.push({
        delayMs: 0,
        file: ROLL_SLIDE_CHARS.has(charId) ? COMBAT_SOUND_FILES.roll : COMBAT_SOUND_FILES.slide,
      });
    }

    // (7) Rolling super (Sky Grind / Cloud Somersault / Shell Cyclone) — roll
    // sound as it lands. Skipped on a clash (supers collide before rolling in).
    if (!hasClash && isUltimateKey(action) && ROLL_SUPER_CHARS.has(charId)) {
      plan.push({ delayMs: Math.max(0, s.attackImpact ?? 0), file: COMBAT_SOUND_FILES.roll });
    }

    // (3, 5) Impact — when attacker S lands a real hit/super on O. hammer-hit
    // for hammer fighters' melee/slam, plus the victim's hurt "ouch" for any
    // connecting attack (shoot/slide/arrow/spear/rush/roll-super included).
    const landed = events.some(e =>
      (e.type === 'hit' || e.type === 'ultimate')
      && e.attacker === S && e.victim === O && (e.damage ?? 0) > 0);
    if (landed) {
      const impactAt = Math.max(0, s.opReactAt ?? s.attackImpact ?? 0);
      if (isHammerAttacker(charId, action)) {
        plan.push({ delayMs: impactAt, file: COMBAT_SOUND_FILES.hammerHit });
      }
      plan.push({ delayMs: impactAt, file: COMBAT_SOUND_FILES.hurt });
    }

    // (4) Blocked by defend_high — the high-line guard stops a melee hit
    // (event kind 'hit') or an airborne super (kind 'ultimate_air'); both kinds
    // are produced ONLY against defend_high. Plays the shield clang at the
    // attacker's throwback moment, for any attacker (Woman Hero pierces shields
    // so she never produces a block event and is naturally excluded).
    const blockedHigh = events.some(e =>
      e.type === 'blocked' && e.defender === O
      && (e.kind === 'hit' || e.kind === 'ultimate_air'));
    if (blockedHigh) {
      plan.push({ delayMs: Math.max(0, s.myReactAt ?? s.attackImpact ?? 0), file: COMBAT_SOUND_FILES.shieldBlocked });
    }
  }

  // (8) Clash — the two attacks collide. Both sides react at the same meeting
  // moment, so a single clang at that time.
  if (hasClash) {
    const clashAt = timing.reactionAtA ?? timing.reactionAtB ?? timing.impactA ?? 0;
    plan.push({ delayMs: Math.max(0, clashAt), file: COMBAT_SOUND_FILES.clash });
  }

  return plan;
}

// Schedule a plan from planCombatSounds(). `guard` is checked at fire time so a
// cancelled fight (new generation) drops its still-pending sounds.
export function playCombatPlan(plan, guard = () => true) {
  for (const s of plan) {
    const fire = () => {
      if (!guard()) return;
      if (s.file) playClip(s.file, { gain: s.gain ?? 1 });
    };
    if (s.delayMs > 0) setTimeout(fire, s.delayMs);
    else fire();
  }
}
