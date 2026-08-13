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
 *   1. shoot            → shoot.mp3 at the projectile-spawn moment. Woman Hero's
 *      fire arrow uses Fire_ice_shoot.mp3 instead (see 9).
 *   2. Skater Kid shoot → laserShoot.mp3 (his beam, not a gunshot)
 *   3. landed hit / slam-super that ends in a hit → hammer-hit.mp3 on impact,
 *      EXCEPT for the ranged / rolling fighters (see HAMMER_EXCLUDED). Monkey
 *      King plays it on his melee `hit` only — his thrown shoot and somersault
 *      super stay non-hammer (see HAMMER_HIT_ONLY). Iron Turtle DOES get it on
 *      his Shell Cyclone: the shell slams down like his HammerHit melee.
 *   4. ANY attack (hit/rush/projectile/shoot/slide/super) stopped by a guard →
 *      shield-blocked.mp3 (the blow clangs off the raised guard) at the attack's
 *      impact moment. Not gated to hammer fighters — a block is about the
 *      defense, not the weapon.
 *   5. any landed/connecting attack → hurt.mp3 on the victim (the "ouch"),
 *      alongside the attacker's weapon sound.
 *   6. slide → roll.mp3 for fighters whose slide is a roll (monkey/turtle/
 *      skater/womanHero), slide.mp3 for everyone else, at the slide start.
 *   7. rolling super (skater/monkey/turtle) → roll.mp3 as the roll begins.
 *   8. clash (slide↔slide, hit↔hit, super↔super) → clash.mp3 at the collision.
 *   9. Woman Hero's arrows → Fire_ice_shoot.mp3 when a fire/ice arrow is
 *      released (shoot) and when an arrow lands (hit/shoot). Her venom super
 *      plays posion.mp3 (front half only) as the volley releases.
 *  10. shield raise (defend_low / defend_high) → shield.mp3 as the guard comes
 *      up — the act of guarding, independent of whether a blow connects (4).
 *
 * Only real recorded clips are scheduled — the old synthesized SFX are gone.
 * (Background music is handled separately — see soundEngine startMusic/stopMusic.)
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
  fireIceShoot: '/assets/sound/Fire_ice_shoot.mp3',
  poison:       '/assets/sound/posion.mp3',
  shield:       '/assets/sound/shield.mp3',
};

// Fighters whose hit / super is NOT a hammer-style strike: the archer
// (womanHero) and the rolling acrobat (skater). They never trigger the
// hammer-hit impact.
const HAMMER_EXCLUDED = new Set(['womanHero', 'skater']);

// Monkey King: his thrown `shoot` is a projectile and his ultimate is an
// airborne somersault (see ROLL_SUPER_CHARS) that never slams down, but his
// melee `hit` is a heavy staff strike that lands with the same impact as a
// hammer — so ONLY his `hit` plays hammer-hit, never his super.
// Iron Turtle is deliberately NOT here: his Shell Cyclone crashes down shell-
// first, so it lands with the hammer impact just like his HammerHit melee.
const HAMMER_HIT_ONLY = new Set(['monkey']);

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
  if (!charId) return false;
  if (HAMMER_HIT_ONLY.has(charId)) return action === 'hit';
  if (HAMMER_EXCLUDED.has(charId)) return false;
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

    // (9) Shield raise — either guard stance (low or high) plays the shield
    // sound as the guard comes up. This is the act of guarding, independent of
    // whether anything actually connects (the clang on a successful block is
    // handled separately below).
    if (action === 'defend_low' || action === 'defend_high') {
      plan.push({ delayMs: 0, file: COMBAT_SOUND_FILES.shield });
    }

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
          file: charId === 'skater' ? COMBAT_SOUND_FILES.laserShoot
            : charId === 'womanHero' ? COMBAT_SOUND_FILES.fireIceShoot
            : COMBAT_SOUND_FILES.shoot,
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
    // sound as the roll BEGINS (not as it lands), so the whoosh leads the
    // motion. Skipped on a clash (supers collide before rolling in).
    if (!hasClash && isUltimateKey(action) && ROLL_SUPER_CHARS.has(charId)) {
      plan.push({ delayMs: 0, file: COMBAT_SOUND_FILES.roll });
    }

    // (10) Woman Hero's poison-arrow super (Venom Volley) — the venom release
    // sound as the volley fires. Played on release regardless of block/hit (it
    // is the firing sound), at spawn + the spread-shot release windup. The clip
    // is long, so only its front half is played (durationFrac).
    if (isUltimateKey(action) && charId === 'womanHero') {
      const ov = char?.motionOverrides?.[action];
      const spawn = char?.projectileDelayByAction?.[action] ?? char?.projectileDelayMs ?? 0;
      const releaseAt = spawn + (ov?.releaseDelay ?? 0);
      plan.push({ delayMs: Math.max(0, releaseAt), file: COMBAT_SOUND_FILES.poison, durationFrac: 0.5 });
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
      // Woman Hero's arrows (basic ice-arrow `hit` / fire-arrow `shoot`) land
      // with the fire/ice arrow impact sound — her venom super is excluded (it
      // gets its own poison sound on release above).
      if (charId === 'womanHero' && (action === 'hit' || action === 'shoot')) {
        plan.push({ delayMs: impactAt, file: COMBAT_SOUND_FILES.fireIceShoot });
      }
      plan.push({ delayMs: impactAt, file: COMBAT_SOUND_FILES.hurt });
    }

    // (4) Successful shield block — ANY attack (melee hit, rush, projectile,
    // shoot, slide, or super) stopped by O's guard produces a `blocked` event
    // tagged with O as defender. Play the shield clang as the blow meets the
    // raised guard (the attack's impact moment), whatever the attacker's weapon.
    const blocked = events.some(e => e.type === 'blocked' && e.defender === O);
    if (blocked) {
      plan.push({ delayMs: Math.max(0, s.attackImpact ?? s.myReactAt ?? 0), file: COMBAT_SOUND_FILES.shieldBlocked });
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
      if (s.file) playClip(s.file, { gain: s.gain ?? 1, offset: s.offset, duration: s.duration, durationFrac: s.durationFrac });
    };
    if (s.delayMs > 0) setTimeout(fire, s.delayMs);
    else fire();
  }
}
