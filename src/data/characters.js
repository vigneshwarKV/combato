// ─────────────────────────────────────────────────────────────────────────────
// characters.js — engine-facing roster + combat constants.
//
// NOTE: this file was rebuilt from how it is consumed across the engine and
// renderer (damageEngine, prompts, spritePlayer, ArenaStage, CharacterPreview).
// Numbers (damage, meter, status) are reasonable defaults — tune to taste.
//
// Each CHARACTERS entry shape:
//   id            unique key (also the key in this object)
//   name          display name
//   archetype     dummy label only — combat is driven by the fields below
//   description   one-liner injected into the LLM moveset prompt
//   renderMode    'png' (frame sequences) | 'spine' (skeletal)
//   assetBase     folder under /public/assets/characters
//   animations    action key → animation name
//                    png   → manifest.json folder name
//                    spine → animation track name in the skeleton json
//   stats         { attack, defense } 1–5 (used by BotMatch tiles)
//   ultimates     array of ultimate-move descriptors (see below)
//
//   spine only:   skeletonJson, atlasFile
//
//   optional combat modifiers (all default off):
//     extraProjectileActions  e.g. ['hit'] — that action behaves like a projectile
//     hitIsRushStyle          melee 'hit' is a rush that breaks through defend
//     projectileDelayMs       global projectile spawn delay (slow throws)
//     projectileDelayByAction { shoot: ms, hit: ms } per-action override
//     motionOverrides         per-action { fwdMs, gap, kind } animation tuning
//     displayScale            sprite scale multiplier (default 1)
//
// Ultimate descriptor shape (all effect fields optional):
//   key           must start with 'ultimate_' AND appear in animations
//   name          display name
//   meterCost     meter spent to fire
//   damage        base damage
//   airborne      true → jet-pack/fly style ult (dodges shoot, clashes airborne)
//   hits          multi-hit multiplier
//   heals         HP healed on landing
//   selfDamage    HP cost to self
//   reflectsNext / blocksNext / ignoresDodge / unblockable / gainMeter /
//   critVsLowHp / empowerNextMelees — situational flags read by damageEngine
// ─────────────────────────────────────────────────────────────────────────────

const BASE = '/assets/characters';

// Standard action→folder map for PNG packs. Gun-idle, jetpack, and climb folder
// names vary between packs, so they're passed in.
//
// `defend` points at the climb/ladder animation (looking-back pose). The
// renderer freezes the sprite on `defendStaticFrame` (default 0), so visually
// this is a single still frame of the climb pose — no movement.
function pngAnimations({ gunIdle, jetpack, ultKey, climb = 'Climb' }) {
  return {
    idle:      'Idle',
    jump:      'Jump',
    hit:       'Hit',
    shoot:     gunIdle,
    slide:     'Slide',
    defend:    climb,         // freeze-frame on the climb pose
    hurt:      'GetHit',
    death:     'Die',         // ← MUST be 'death' (engine hardcodes this key)
    celebrate: 'Celebrate',   // ← MUST be 'celebrate' (loop check in spritePlayer)
    [ultKey]:  jetpack,
  };
}

export const CHARACTERS = {
  // ── PNG fighters ──────────────────────────────────────────────────────────
  soldierBoy: {
    id: 'soldierBoy',
    name: 'Soldier Boy',
    archetype: 'striker',
    description: 'A disciplined frontline soldier who closes distance fast and punishes hesitation.',
    renderMode: 'png',
    assetBase: `${BASE}/main-character-for-2d-platformer`,
    stats: { attack: 4, defense: 3 },
    displayScale: 0.85,
    // 3rd frame of the climb sequence — both legs on the ground (frames 0/1
    // have the back leg raised mid-step). 0-indexed: 2 → Climbing_002.png.
    defendStaticFrame: 2,
    // Smoke trail behind the jetpack during airborne ultimates. type 'fire'
    // uses JetPackFire1-3, 'smoke' uses smokejet01-04. Tune position with
    // xOff (default -55), yOff (default -90), scale (default 1).
    jetExhaust: { type: 'smoke' },
    animations: pngAnimations({ gunIdle: 'Idle_With_Gun', jetpack: 'Jetpack', ultKey: 'ultimate_orbitstrike' }),
    ultimates: [
      { key: 'ultimate_orbitstrike', name: 'Orbit Strike', meterCost: 100, damage: 28, airborne: true },
    ],
  },

  beast: {
    id: 'beast',
    name: 'Beast',
    archetype: 'tank',
    description: 'A hulking brawler who rockets across the arena and crashes down on opponents.',
    renderMode: 'png',
    assetBase: `${BASE}/beast-character-sprites`,
    stats: { attack: 5, defense: 4 },
    displayScale: 0.85,
    // 3rd frame of the climb sequence — both legs on the ground (frames 0/1
    // have the back leg raised mid-step). 0-indexed: 2 → Climbing_002.png.
    defendStaticFrame: 2,
    // Die_000 has the body drawn high in the 464px-tall canvas with empty
    // space at the bottom. The auto-compensator (spritePlayer) already shifts
    // by (deathH-idleH)*scale ≈ 151px, but more is needed to plant the body
    // on the ground. Positive yOffset pushes sprite anchor further down.
    actionYOffsets: { death: 80 },
    // Smoke trail behind the jetpack during airborne ultimates. type 'fire'
    // uses JetPackFire1-3, 'smoke' uses smokejet01-04. Tune position with
    // xOff (default -55), yOff (default -90), scale (default 1).
    jetExhaust: { type: 'smoke' },
    animations: pngAnimations({ gunIdle: 'IdleWithGun', jetpack: 'JetPack', ultKey: 'ultimate_rocketcharge', climb: 'Climbing' }),
    ultimates: [
      { key: 'ultimate_rocketcharge', name: 'Rocket Charge', meterCost: 100, damage: 30, airborne: true },
    ],
  },

  speedKid: {
    id: 'speedKid',
    name: 'Speed Kid',
    archetype: 'acrobat',
    description: 'A glitchy speedster who blinks in and out of the fight before you can react.',
    renderMode: 'png',
    assetBase: `${BASE}/animated-boy-character-sprite-pack`,
    stats: { attack: 3, defense: 2 },
    displayScale: 0.85,
    // 3rd frame of the climb sequence — both legs on the ground (frames 0/1
    // have the back leg raised mid-step). 0-indexed: 2 → Climbing_002.png.
    defendStaticFrame: 2,
    // Smoke trail behind the jetpack during airborne ultimates. type 'fire'
    // uses JetPackFire1-3, 'smoke' uses smokejet01-04. Tune position with
    // xOff (default -55), yOff (default -90), scale (default 1).
    jetExhaust: { type: 'smoke' },
    animations: pngAnimations({ gunIdle: 'IdleWithGun', jetpack: 'Jetpack', ultKey: 'ultimate_glitchblitz', climb: 'Climbing' }),
    ultimates: [
      { key: 'ultimate_glitchblitz', name: 'Glitch Blitz', meterCost: 100, damage: 26, airborne: true },
    ],
  },

  gunBoy: {
    id: 'gunBoy',
    name: 'Gun Boy',
    archetype: 'striker',
    description: 'A hot-headed gunner who sets the ring alight with every charge.',
    renderMode: 'png',
    assetBase: `${BASE}/boy-character-sprites-for-platformer`,
    stats: { attack: 4, defense: 3 },
    displayScale: 0.85,
    // 3rd frame of the climb sequence — both legs on the ground (frames 0/1
    // have the back leg raised mid-step). 0-indexed: 2 → Climbing_002.png.
    defendStaticFrame: 2,
    // Smoke trail behind the jetpack during airborne ultimates. type 'fire'
    // uses JetPackFire1-3, 'smoke' uses smokejet01-04. Tune position with
    // xOff (default -55), yOff (default -90), scale (default 1).
    jetExhaust: { type: 'smoke' },
    animations: pngAnimations({ gunIdle: 'IdleWithGun', jetpack: 'Jetpack', ultKey: 'ultimate_infernorush' }),
    ultimates: [
      { key: 'ultimate_infernorush', name: 'Inferno Rush', meterCost: 100, damage: 26, airborne: true },
    ],
  },

  cartoonBoy: {
    id: 'cartoonBoy',
    name: 'Cartoon Boy',
    archetype: 'striker',
    description: 'A cartoon scrapper whose cartoon physics make every blow land harder than it should.',
    renderMode: 'png',
    assetBase: `${BASE}/cartoon-boy-sprites-for-platformer-game`,
    stats: { attack: 4, defense: 2 },
    displayScale: 0.85,
    // 3rd frame of the climb sequence — both legs on the ground (frames 0/1
    // have the back leg raised mid-step). 0-indexed: 2 → Climbing_002.png.
    defendStaticFrame: 2,
    // Smoke trail behind the jetpack during airborne ultimates. type 'fire'
    // uses JetPackFire1-3, 'smoke' uses smokejet01-04. Tune position with
    // xOff (default -55), yOff (default -90), scale (default 1).
    jetExhaust: { type: 'smoke' },
    animations: pngAnimations({ gunIdle: 'IdleWithGun', jetpack: 'Jetpack', ultKey: 'ultimate_toonquake' }),
    ultimates: [
      { key: 'ultimate_toonquake', name: 'Toon Quake', meterCost: 100, damage: 27, airborne: true },
    ],
  },

  spaceGirl: {
    id: 'spaceGirl',
    name: 'Space Girl',
    archetype: 'ranger',
    description: 'A cosmic markswoman who rains starlight on anyone who keeps their distance.',
    renderMode: 'png',
    assetBase: `${BASE}/female-main-character-sprites-for-platformer`,
    stats: { attack: 4, defense: 3 },
    displayScale: 0.85,
    // 3rd frame of the climb sequence — both legs on the ground (frames 0/1
    // have the back leg raised mid-step). 0-indexed: 2 → Climbing_002.png.
    defendStaticFrame: 2,
    // Smoke trail behind the jetpack during airborne ultimates. type 'fire'
    // uses JetPackFire1-3, 'smoke' uses smokejet01-04. Tune position with
    // xOff (default -55), yOff (default -90), scale (default 1).
    jetExhaust: { type: 'smoke' },
    animations: pngAnimations({ gunIdle: 'IdleWGun', jetpack: 'JetPack', ultKey: 'ultimate_starfall' }),
    ultimates: [
      { key: 'ultimate_starfall', name: 'Star Fall', meterCost: 100, damage: 27, airborne: true },
    ],
  },

  stormGirl: {
    id: 'stormGirl',
    name: 'Storm Girl',
    archetype: 'mage',
    description: 'A tempest-channeling mage who batters opponents with raw storm force.',
    renderMode: 'png',
    assetBase: `${BASE}/female-protagonist-character-sprites`,
    stats: { attack: 3, defense: 3 },
    displayScale: 0.85,
    // 3rd frame of the climb sequence — both legs on the ground (frames 0/1
    // have the back leg raised mid-step). 0-indexed: 2 → Climbing_002.png.
    defendStaticFrame: 2,
    // Smoke trail behind the jetpack during airborne ultimates. type 'fire'
    // uses JetPackFire1-3, 'smoke' uses smokejet01-04. Tune position with
    // xOff (default -55), yOff (default -90), scale (default 1).
    jetExhaust: { type: 'smoke' },
    animations: pngAnimations({ gunIdle: 'IdleWithGun', jetpack: 'Jetpack', ultKey: 'ultimate_tempest' }),
    ultimates: [
      { key: 'ultimate_tempest', name: 'Tempest Surge', meterCost: 100, damage: 24, airborne: true },
    ],
  },

  ironKnight: {
    id: 'ironKnight',
    name: 'Iron Knight',
    archetype: 'tank',
    description: 'An armored heavy who soaks up punishment and answers with a steel barrage.',
    renderMode: 'png',
    assetBase: `${BASE}/game-character-for-2d-platformer`,
    stats: { attack: 4, defense: 5 },
    displayScale: 0.85,
    // 3rd frame of the climb sequence — both legs on the ground (frames 0/1
    // have the back leg raised mid-step). 0-indexed: 2 → Climbing_002.png.
    defendStaticFrame: 2,
    // Smoke trail behind the jetpack during airborne ultimates. type 'fire'
    // uses JetPackFire1-3, 'smoke' uses smokejet01-04. Tune position with
    // xOff (default -55), yOff (default -90), scale (default 1).
    jetExhaust: { type: 'smoke' },
    animations: pngAnimations({ gunIdle: 'IdleWithGun', jetpack: 'Jetpack', ultKey: 'ultimate_steelstorm' }),
    ultimates: [
      { key: 'ultimate_steelstorm', name: 'Steel Storm', meterCost: 100, damage: 28, airborne: true },
    ],
  },

  madScientist: {
    id: 'madScientist',
    name: 'Mad Scientist',
    archetype: 'mage',
    description: 'A mad scientist who overloads the arena with arcing electricity.',
    renderMode: 'png',
    assetBase: `${BASE}/mad-scientist-game-character-sprite`,
    stats: { attack: 3, defense: 2 },
    displayScale: 0.85,
    // 3rd frame of the climb sequence — both legs on the ground (frames 0/1
    // have the back leg raised mid-step). 0-indexed: 2 → Climbing_002.png.
    defendStaticFrame: 2,
    // Smoke trail behind the jetpack during airborne ultimates. type 'fire'
    // uses JetPackFire1-3, 'smoke' uses smokejet01-04. Tune position with
    // xOff (default -55), yOff (default -90), scale (default 1).
    jetExhaust: { type: 'smoke' },
    animations: pngAnimations({ gunIdle: 'IdleWithGun', jetpack: 'Jetpack', ultKey: 'ultimate_teslaoverload' }),
    ultimates: [
      { key: 'ultimate_teslaoverload', name: 'Tesla Overload', meterCost: 100, damage: 22, airborne: true },
    ],
  },

  // ── Spine fighters ──────────────────────────────────────────────────────────
  skater: {
    id: 'skater',
    name: 'Skater Kid',
    archetype: 'acrobat',
    description: 'A reckless skateboarder whose board run smashes straight through a raised guard.',
    renderMode: 'spine',
    assetBase: `${BASE}/cartoon-boy-character-animation-sprites`,
    skeletonJson: 'TheKids.json',
    atlasFile: 'CharacterAnim.atlas',
    stats: { attack: 4, defense: 2 },
    // Opt spine fighters into the positional tween system (lunge/glide/fly toward
    // the opponent). Without this they play their animation in place. See
    // ArenaStage.playAction gate.
    motionProfile: true,
    displayScale: 1.4,
    hitIsRushStyle: true,
    // Purple beam projectile for `shoot`. projectileEmerges makes it grow from
    // a sliver to full length over the first 150ms — reads as the beam sliding
    // out of the barrel tip-first (per the renderer's emerge logic).
    projectile: '/assets/effects/projectile.png',
    projectileEmerges: true,
    projectileScale: 0.45,
    // Skateboard run: a long forward rush (fwdMs 600) that crashes through a
    // raised guard. animResolution caps the rush throwback at 0.9×fwdMs, so the
    // 600 here keeps his timing in sync (default lunge fwdMs of 220 fires far
    // too early for a rush this long).
    motionOverrides: {
      hit: { kind: 'lunge', fwdMs: 600, gap: 60, holdMs: 160, retMs: 260 },
      // ultimate_roll default lands at the GROUND (endYOffset 0). gap=80
      // closes the distance — default 160 left him stopping well short of
      // the opponent. When the opponent defends, the renderer overrides
      // endYOffset to ~180 so the roll stops at the shield (head height)
      // and retreats. Logic lives in ArenaStage.playAction's flyHit case.
      ultimate_roll: { gap: 80 },
    },
    animations: {
      idle:  'Idle',
      jump:  'Jump',
      hit:   'OnSkateboard',
      shoot: 'IdleShoot',
      slide: 'roll',
      defend: 'Idle',
      hurt:  'GetHit',
      death: 'Dead',
      ultimate_roll: 'JetPack',
    },
    ultimates: [
      { key: 'ultimate_roll', name: 'Sky Grind', meterCost: 100, damage: 26, airborne: true },
    ],
  },

  monkey: {
    id: 'monkey',
    name: 'Monkey King',
    archetype: 'striker',
    description: 'A trickster who hurls a spear from range and somersaults skyward on a flying staff.',
    renderMode: 'spine',
    assetBase: `${BASE}/monkey-game-character-sprite`,
    skeletonJson: 'Wukong.json',
    atlasFile: 'CharacterAnim.atlas',
    stats: { attack: 5, defense: 3 },
    motionProfile: true,
    // Spine rigs render small at native scale next to PNG fighters. Scale up
    // so silhouettes are roughly comparable. Tune to taste.
    displayScale: 1.5,
    defendOffsetX: 380,
    // Throws a spear, not a bullet. projectileTexture() returns this for `shoot`.
    // Native PNG is 400×128 — scale down so it reads as a spear, not a log.
    projectile: '/assets/effects/monkey-spear.png',
    projectileScale: 0.35,
    // Default spawn-X is 160 (well in front of the body). 60 releases the
    // spear from near the thrower's hand instead.
    projectileStartXByAction: { shoot: 60 },
    projectileDelayByAction: { shoot: 550 },
    // Close the gap on the roll ult so he lands ON the opponent rather than
    // stopping short. Default flyHit gap is 160 — 80 brings him in close.
    // defendEndYOffset lifts him higher than skater's 180 default because the
    // Monkey 'Roll' spine track draws his body lower in bone-space, so the
    // standard 180 leaves his body brushing the ground when blocked.
    motionOverrides: {
      ultimate_roll: { gap: 80, defendEndYOffset: 280 },
    },
    animations: {
      idle:  'Idle',
      jump:  'Jump',
      hit:   'Hit',
      shoot: 'Throw',
      slide: 'Roll',
      defend: 'onLadder',
      hurt:  'GetHit',
      death: 'Death',
      celebrate: 'Celebrates',
      ultimate_roll: 'FlyOnStick',
    },
    ultimates: [
      { key: 'ultimate_roll', name: 'Cloud Somersault', meterCost: 100, damage: 16, hits: 2, airborne: true },
    ],
  },

  turtle: {
    id: 'turtle',
    name: 'Iron Turtle',
    archetype: 'tank',
    description: 'A slow, armored bruiser who throws a heavy spear and spins into a defensive cyclone.',
    renderMode: 'spine',
    assetBase: `${BASE}/turtle-game-character-sprite`,
    skeletonJson: 'skeleton.json',
    atlasFile: 'Character_Anim.atlas',
    stats: { attack: 4, defense: 5 },
    motionProfile: true,
    displayScale: 1.4,
    defendOffsetX: 250,
    // Throws a spear, not a bullet.
    projectile: '/assets/effects/spear.png',
    projectileScale: 0.35,
    projectileStartXByAction: { shoot: 60 },
    projectileDelayByAction: { shoot: 550 },
    animations: {
      idle:  'Idle',
      jump:  'Jump',
      hit:   'HammerHit',
      shoot: 'Throw',
      slide: 'Roll',
      defend: 'Climb',
      hurt:  'GetHit',
      death: 'Die',
      celebrate: 'Celebrates',
      ultimate_shellcyclone: 'Fly',
    },
    ultimates: [
      // airborne: true is critical — without it, engine treats this as grounded
      // (shoot can clip it, no clash with opposing airborne ults) while the
      // renderer treats it as airborne (default flyHit kind). The mismatch
      // causes the weird interrupt/clash behavior.
      { key: 'ultimate_shellcyclone', name: 'Shell Cyclone', meterCost: 100, damage: 22, heals: 8, blocksNext: 1, airborne: true },
    ],
  },

  womanHero: {
    id: 'womanHero',
    name: 'Woman Hero',
    archetype: 'ranger',
    description: 'An archer who jump-shoots ice arrows that pierce a guard and unleashes a piercing arrow volley.',
    renderMode: 'spine',
    assetBase: `${BASE}/woman-hero-game-character-sprite`,
    skeletonJson: 'Archy.json',
    atlasFile: 'Character_Anim.atlas',
    stats: { attack: 4, defense: 3 },
    motionProfile: true,
    displayScale: 1.5,
    defendOffsetX: 250,
    extraProjectileActions: ['hit'],
    // Her arrows pierce a raised guard: both her hit (already projectile-style)
    // and her ultimate punch straight through a defending opponent's shield and
    // deal full damage — and she is never thrown back by a blocked shield.
    piercesShield: true,
    // Arrows, not bullets:
    //   shoot → fire arrow (FireShoot anim)
    //   hit   → ice arrow (IceShoot anim, airborne jumpShoot)
    //   ult   → green-tinted arrow x3 spread (renderer auto-tints for ultimate_poison)
    projectile:    '/assets/effects/FireArrow.png',
    hitProjectile: '/assets/effects/IceArrow.png',
    projectileScale: 0.5,
    // Per-action projectile timing.
    //   hit:   spawn at jump apex so arrow fires from up high (upMs=350 + buffer);
    //          auto-rotates via atan2(endY-startY, endX-startX) → angles down.
    //   shoot: short windup before release.
    projectileDelayByAction: { hit: 380, shoot: 200 },
    // Per-action spawn offset relative to her body. Defaults: X=160 (well in
    // front), Y=-80 (above feet). For shoot we pull X in closer (110, ~50px
    // back toward the body) and lift Y higher (-120, ~40px more up).
    projectileStartXByAction: { shoot: 110 },
    projectileStartYByAction: { shoot: -120 },
    // hit  → jumpShoot: she springs straight up, fires an ice arrow at the apex,
    //        then drops back (no X travel — she's a ranged fighter). 'jumpShoot'
    //        kind is what makes the engine treat her hit as an airborne projectile
    //        (animResolution.isAirborneHitAction).
    // ult  → grounded spread shot (three staggered arrows). 'static' kind keeps it
    //        GROUNDED so it doesn't clash mid-air with airborne ults; spreadShot
    //        fires the volley. Uses the canonical 'ultimate_poison' key so the
    //        renderer spawns + green-tints the arrows (ArenaStage.projectileTexture).
    motionOverrides: {
      // Hit: jump up, then at apex tilt body forward (fireRotation: 0.25 rad ≈ 14°)
      // to "aim down" before the ice arrow releases. Rotation is reset by the
      // next action's cancelActiveTween.
      hit: {
        kind: 'jumpShoot', peakY: 180, upMs: 350, holdMs: 220, downMs: 350,
        fireRotation: 0.25,
      },
      // Ult: 3-arrow poison spread. Each arrow has its own body tilt so she
      // visually aims HIGH (-0.2 rad back), then LOW (+0.2 rad forward), then
      // straight. endYOff matches the rotation direction.
      ultimate_poison: {
        kind: 'static', spreadShot: true, releaseDelay: 150, spreadStagger: 120,
        spread: [
          { endYOff: -80, rotation: -0.2 },  // aim high — body leans back
          { endYOff:  80, rotation:  0.2 },  // aim low — body leans forward
          { endYOff:   0, rotation:  0   },  // straight — neutral
        ],
      },
    },
    animations: {
      idle:  'Idle',
      jump:  'Jump',
      hit:   'IceShoot1',
      shoot: 'FireShoot1',
      slide: 'Roll',
      defend: 'OnLadder',
      hurt:  'GetHit',
      death: 'Die',
      ultimate_poison: 'PoisonShoot1',
    },
    ultimates: [
      { key: 'ultimate_poison', name: 'Venom Volley', meterCost: 100, damage: 20 },
    ],
  },
};

// Flat list — used by BotMatch character grid and DevPage.
export const CHARACTER_LIST = Object.values(CHARACTERS);

// ── Combat constants ──────────────────────────────────────────────────────────
export const BASE_DAMAGE = {
  idle: 0,
  jump: 0,
  hit: 10,
  shoot: 12,
  slide: 6,
  defend: 0,
};

export const METER = {
  MAX: 100,
  GAIN_ON_MELEE_HIT: 15,
  GAIN_ON_RANGED_HIT: 15,
  GAIN_ON_TAKING_DAMAGE: 10,
  GAIN_ON_DODGE: 8,
  GAIN_ON_BLOCK: 10,
  GAIN_ON_JUMP_EVADE: 8,
};

// ── Ultimate lookup helpers ─────────────────────────────────────────────────
export function getUltimate(charId, key) {
  const c = CHARACTERS[charId];
  if (!c) return null;
  return c.ultimates.find(u => u.key === key) || null;
}

export function isAirborneUltimate(charId, key) {
  const u = getUltimate(charId, key);
  return !!u?.airborne;
}
