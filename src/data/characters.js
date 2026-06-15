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
//   ratings       { atk, def, spm } 0–100 player-facing bars (CharSelect screen).
//                 `def`'s only combat role is setting block throwbackDmg =
//                 round(def/12) (see throwbackDmgFor) — the recoil a sturdy guard
//                 deals to an attacker it blocks. (DEF does NOT mitigate incoming
//                 damage; that mechanic was removed.)
//   actionTable   per-fighter combat tuning that overrides the global BASE_DAMAGE
//                 / METER defaults for this character:
//                   hit/shoot/slide → { dmg, spm } damage dealt + meter gained
//                                     when that attack lands
//                   defend          → { spm } meter gained on a correct guard.
//                     The HP the blocker still takes when knocked back blocking
//                     a THROWBACK blow (melee hit / rush charge / slide) is
//                     DERIVED from ratings.def via throwbackDmgFor() — tankier
//                     frames get rattled harder. Ranged blocks that don't throw
//                     the guard cost nothing: a blocked shoot and Woman Hero's
//                     ice arrow (projhit) are clean catches; a blocked super
//                     backfires on the attacker instead.
//                   jump/slideDodge → { spm } meter gained on the evade
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
//     meterGain               { onHit, onDefend } super-meter gain rates
//                             (default METER.GAIN_ON_HIT / GAIN_ON_DEFEND)
//     actionYOffsets          per-action sprite Y nudge (e.g. { slide: -75 })
//     actionScales            per-action scale multiplier on displayScale
//                             (e.g. { slide: 0.8 }); default 1 per action
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
//   blockBackfireMult  HP backfire multiplier when this super is shield-blocked
//                      (default BLOCKED_SUPER_DAMAGE_MULTIPLIER)
//   rangedSuper   fires from range — a charging melee hit can't interrupt it;
//                 the super lands and the hitter is clipped/thrown instead
//   piercesShield super punches through EITHER guard — never blocked, and the
//                 shooter is never thrown back (no `blocked` event)
//   gainMeter     meter refunded to the attacker when the super fires
//
// Side-effect flags ACTUALLY honored by damageEngine: heals, selfDamage,
// gainMeter, rangedSuper, piercesShield, blockBackfireMult, hits, airborne.
// Earlier drafts also listed reflectsNext / blocksNext / ignoresDodge /
// unblockable / critVsLowHp / empowerNextMelees as engine-read — they are NOT
// wired up (only unblockable / reflectsNext do anything, and only as LLM
// moveset text in prompts.js).
// ─────────────────────────────────────────────────────────────────────────────

const BASE = '/assets/characters';

// Standard action→folder map for PNG packs. Gun-idle, jetpack, and climb folder
// names vary between packs, so they're passed in.
//
// Both guard stances (`defend_low` / `defend_high`) freeze on the climb/ladder
// pose (defendStaticFrame) with a shield overlay drawn on top (high = braced
// overhead, low = dropped to the body).
function pngAnimations({ gunIdle, jetpack, ultKey, climb = 'Climb' }) {
  return {
    idle:      'Idle',
    jump:      'Jump',
    hit:       'Hit',
    shoot:     gunIdle,
    slide:     'Slide',
    defend_low:  climb,       // freeze-frame on the climb pose + low shield
    defend_high: climb,       // freeze-frame on the climb pose + overhead shield
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
    combinedDefend: {
      scale:  { low: 1.15, high: 1.5 },
      width:  { high: 1, low: 1 },
      offset: { low: { x: 11, y: 20 }, high: { x: 22, y: 30 } },
    },
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
    combinedDefend: {
      scale:  { low: 1.2, high: 1.4 },
      width:  { high: 1.1 },
      offset: { low: { x: 22, y: 18 }, high: { x: 22, y: 40 } },
    },
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
    // ── Unstoppable Engine: heaviest hits + biggest super, slowest meter ──
    ratings: { atk: 90, def: 80, spm: 35 },
    actionTable: {
      hit:   { dmg: 13, spm: 6 },
      shoot: { dmg: 5,  spm: 6 },   // weak poke — well below his hit/slide so shoot can't out-trade them
      slide: { dmg: 8,  spm: 5 },
      defend:     { spm: 7 },   // guard meter; throwback dmg is DEF-derived (throwbackDmgFor)
      jump:       { spm: 12 },  // jump-evade — above guard
      slideDodge: { spm: 8 },   // slide used to dodge
    },
    ultimates: [
      { key: 'ultimate_rocketcharge', name: 'Rocket Charge', meterCost: 100, damage: 34, airborne: true },
    ],
  },

  speedKid: {
    id: 'speedKid',
    combinedDefend: {
      scale:  { low: 1.2, high: 1.1 },
      width:  { high: 1.1, low: 1.1 },
      offset: { low: { x: 11, y: 50 }, high: { x: 22, y: 18 } },
    },
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
    combinedDefend: {
      scale:  { low: 1.1, high: 1.1 },
      width:  { high: 1.1, low: 1 },
      offset: { low: { x: 0, y: 20 }, high: { x: 22, y: 18 } },
    },
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
    combinedDefend: {
      scale:  { low: 1.1, high: 1.45 },
      width:  { high: 1, low: 1 },
      offset: { low: { x: 5, y: 10 }, high: { x: 0, y: 10 } },
    },
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
    combinedDefend: {
      scale:  { low: 1, high: 1 },
      width:  { high: 1, low: 1 },
      offset: { low: { x: 11, y: 50 }, high: { x: 22, y: 18 } },
    },
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
    // ── Sniper: dominates at range (strong shot), folds in melee ──
    ratings: { atk: 80, def: 60, spm: 55 },
    actionTable: {
      hit:   { dmg: 8,  spm: 6 },
      shoot: { dmg: 14, spm: 9 },
      slide: { dmg: 6,  spm: 6 },
      defend:     { spm: 9 },
      jump:       { spm: 16 },
      slideDodge: { spm: 11 },
    },
    ultimates: [
      { key: 'ultimate_starfall', name: 'Star Fall', meterCost: 100, damage: 27, airborne: true },
    ],
  },

  stormGirl: {
    id: 'stormGirl',
    combinedDefend: {
      scale:  { low: 1.3, high: 1.35 },
      width:  { high: 1.05, low: 1.05 },
      offset: { low: { x: 11, y: 50 }, high: { x: 0, y: 12 } },
    },
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
    combinedDefend: {
      scale:  { low: 1.07, high: 1.45 },
      width:  { high: 1, low: 1 },
      offset: { low: { x: 0, y: 10 }, high: { x: 15, y: 20 } },
    },
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
    combinedDefend: {
      scale:  { low: 1.2, high: 1.1 },
      width:  { high: 1.1, low: 1.1 },
      offset: { low: { x: 11, y: 50 }, high: { x: 22, y: 18 } },
    },
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
    // ── Overload: modest basics but charges fastest; squishy ──
    ratings: { atk: 65, def: 35, spm: 90 },
    actionTable: {
      hit:   { dmg: 9,  spm: 9 },
      shoot: { dmg: 4,  spm: 10 },  // weakest shoot in the cast — he pokes, doesn't out-trade
      slide: { dmg: 6,  spm: 7 },
      defend:     { spm: 8 },
      jump:       { spm: 18 },
      slideDodge: { spm: 11 },
    },
    ultimates: [
      { key: 'ultimate_teslaoverload', name: 'Tesla Overload', meterCost: 100, damage: 22, airborne: true },
    ],
  },

  // ── Spine fighters ──────────────────────────────────────────────────────────
  skater: {
    id: 'skater',
    combinedDefend: {
      scale:  { low: 1.5, high: 2 },
      width:  { high: 1, low: 1 },
      offset: { low: { x: 11, y: 50 }, high: { x: -5, y: 70 } },
    },
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
      hit: { kind: 'lunge', fwdMs: 600, gap: 60, holdMs: 0, retMs: 260 },
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
      defend_low: 'Idle',
      defend_high: 'Idle',
      hurt:  'GetHit',
      death: 'Dead',
      // TheKids.json has no dedicated 'Celebrate' track, and IdleShoot/JetPackWShoot
      // are gun poses we don't want on a victory. Reuse the gun-free skateboard
      // trick 'OnSkateboard_Jump' as the victory move — on-theme for a skater.
      celebrate: 'OnSkateboard_Jump',
      ultimate_roll: 'JetPack',
    },
    // ── Grind: guard-breaking rush + mobility, fast meter, flimsy frame ──
    ratings: { atk: 75, def: 45, spm: 75 },
    actionTable: {
      hit:   { dmg: 12, spm: 8 },  // skateboard rush — breaks a high guard (low line)
      shoot: { dmg: 6,  spm: 7 },   // strongest of the NORMAL shooters, but still below his rush/slide
      slide: { dmg: 7,  spm: 8 },
      defend:     { spm: 7 },
      jump:       { spm: 20 },  // acrobat — biggest jump bonus in the cast
      slideDodge: { spm: 12 },
    },
    ultimates: [
      { key: 'ultimate_roll', name: 'Sky Grind', meterCost: 100, damage: 26, airborne: true },
    ],
  },

  monkey: {
    id: 'monkey',
    combinedDefend: {
      scale:  { low: 1.2, high: 1.6 },
      width:  { high: 1, low: 1 },
      offset: { low: { x: 11, y: 30 }, high: { x: 22, y: 40 } },
    },
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
    // The 'Roll' (slide) spine track tucks the body BELOW the skeleton origin,
    // so grounded at groundY (height-30) the roll clips off the bottom of the
    // canvas. Lift the sprite during the slide so the tucked body clears the
    // edge (negative = up). Turtle's Roll sits higher and needs no offset.
    actionYOffsets: { slide: -75 },
    // His 'Roll' rig reads oversized next to the others — shrink it during the
    // slide only (1 = full displayScale). Feet-anchored, so it scales in place.
    actionScales: { slide: 0.8 },
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
      defend_low: 'onLadder',
      defend_high: 'onLadder',
      hurt:  'GetHit',
      death: 'Death',
      celebrate: 'Celebrates',
      ultimate_roll: 'FlyOnStick',
    },
    // ── Trickster: slow spear hits double a normal shot; agile, fast meter ──
    ratings: { atk: 85, def: 45, spm: 75 },
    actionTable: {
      hit:   { dmg: 11, spm: 8 },
      shoot: { dmg: 24, spm: 9 },  // heavy spear — slow to release (loses to rush/slide)
      slide: { dmg: 7,  spm: 8 },
      defend:     { spm: 8 },
      jump:       { spm: 20 },  // somersault — biggest jump bonus
      slideDodge: { spm: 12 },
    },
    ultimates: [
      { key: 'ultimate_roll', name: 'Cloud Somersault', meterCost: 100, damage: 16, hits: 2, airborne: true },
    ],
  },

  turtle: {
    id: 'turtle',
    combinedDefend: {
      scale:  { low: 1.7, high: 1.5 },
      width:  { high: 1, low: 1.1 },
      offset: { low: { x: 11, y: 60 }, high: { x: 10, y: -5 } },
    },
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
      defend_low: 'Climb',
      defend_high: 'Climb',
      hurt:  'GetHit',
      death: 'Die',
      celebrate: 'Celebrates',
      ultimate_shellcyclone: 'Fly',
    },
    // ── Highest DEF in the cast → highest block throwbackDmg (8): attackers who
    // throw a melee/slide into his guard bounce off for 8. Paired with the best
    // block/dodge-to-meter conversion in the cast, he's a punishing wall that
    // charges super fastest by defending. Slow heavy spear loses to rush/slide. ──
    ratings: { atk: 70, def: 90, spm: 60 },
    actionTable: {
      hit:   { dmg: 12, spm: 7 },
      shoot: { dmg: 24, spm: 9 },  // heavy spear — slow to release (loses to rush/slide)
      slide: { dmg: 6,  spm: 6 },
      defend:     { spm: 16 },  // best guard-to-meter conversion in the cast (tankiest DEF)
      jump:       { spm: 16 },
      slideDodge: { spm: 14 },  // even his dodges feed the meter
    },
    ultimates: [
      // airborne: true is critical — without it, engine treats this as grounded
      // (shoot can clip it, no clash with opposing airborne ults) while the
      // renderer treats it as airborne (default flyHit kind). The mismatch
      // causes the weird interrupt/clash behavior.
      // No heal: his staying power is punishing blocks (throwbackDmg 8 onto
      // attackers) + the best block/dodge-to-meter conversion (defend spm 16).
      { key: 'ultimate_shellcyclone', name: 'Shell Cyclone', meterCost: 100, damage: 22, airborne: true },
    ],
  },

  womanHero: {
    id: 'womanHero',
    combinedDefend: {
      scale:  { low: 1.6, high: 1.1 },
      width:  { high: 1, low: 1 },
      offset: { low: { x: 11, y: 60 }, high: { x: 10, y: 0 } },
    },
    name: 'Woman Hero',
    archetype: 'ranger',
    description: 'An archer who jump-shoots ice arrows that slip past a raised guard, then unleashes a low arrow volley.',
    renderMode: 'spine',
    assetBase: `${BASE}/woman-hero-game-character-sprite`,
    skeletonJson: 'Archy.json',
    atlasFile: 'Character_Anim.atlas',
    stats: { attack: 4, defense: 3 },
    motionProfile: true,
    displayScale: 1.5,
    defendOffsetX: 250,
    // Her 'Roll' (slide) spine track tucks the body below the skeleton origin
    // and clips the bottom of the canvas — lift the sprite during the slide so
    // the roll clears the edge (negative = up). See monkey for the same fix.
    actionYOffsets: { slide: -50 },
    extraProjectileActions: ['hit'],
    // Her ice-arrow `hit` is projectile-style → it travels the LOW line, so a
    // RAISED guard (defend_high) can't stop it (that's the "pierces a guard"
    // read) while defend_low still blocks it. No character-level piercesShield
    // flag: the engine only ever honored piercesShield on a SUPER, so the
    // character-level one was inert and has been removed.
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
      // next action's cancelActiveTween. holdMs hovers her at the apex long
      // enough that an opposing bullet passes UNDER her before she descends —
      // without the longer hover she clips the bullet on the way down even
      // though the engine scores it a clean miss (she's airborne).
      hit: {
        kind: 'jumpShoot', peakY: 180, upMs: 350, holdMs: 420, downMs: 350,
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
      defend_low: 'OnLadder',
      defend_high: 'OnLadder',
      hurt:  'GetHit',
      death: 'Die',
      // Her rig has no dedicated celebrate track — reuse the OnLadder pose for
      // the victory loop (loops because spritePlayer keys the loop off the
      // 'celebrate' action key, not the track name).
      celebrate: 'OnLadder',
      ultimate_poison: 'PoisonShoot1',
    },
    // ── Glass Volley: weak, BLOCKABLE super but charges fastest in the cast.
    // Her basic ice-arrow `hit` still pierces a RAISED guard (it's a low-line
    // projectile — see extraProjectileActions); only the SUPER lost its pierce. ──
    ratings: { atk: 55, def: 55, spm: 95 },
    actionTable: {
      hit:   { dmg: 10, spm: 10 },  // ice arrow — pierces a raised guard, misses jumpers
      shoot: { dmg: 5,  spm: 12 },  // fire-arrow poke — low damage, but fastest meter gain in the cast
      slide: { dmg: 6,  spm: 8 },
      defend:     { spm: 10 },
      jump:       { spm: 18 },
      slideDodge: { spm: 12 },
    },
    ultimates: [
      // rangedSuper: fires arrows from range — a charging melee hit can't
      // interrupt it; the volley lands and clips/throws the hitter instead.
      // No piercesShield: the volley is a LOW-line spread that defend_low blocks.
      // blockBackfireMult: 0 — fired from afar, so a blocked volley does NOT
      // rebound HP onto her (unlike melee-range supers). It just whiffs: she
      // loses the spent meter and staggers (animResolution plays 'hurt', not the
      // knockback throw). Weak damage, but her meter refills fast so she spams it.
      { key: 'ultimate_poison', name: 'Venom Volley', meterCost: 100, damage: 16, rangedSuper: true, blockBackfireMult: 0 },
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
  defend_low: 0,
  defend_high: 0,
};

export const METER = {
  MAX: 100,
  // Default per-event meter gains. The super meter only fills on two events:
  //   GAIN_ON_HIT    — landing an attack (hit / shoot / slide that connects)
  //   GAIN_ON_DEFEND — successfully defending an incoming attack: a shield
  //                    block, a jump/slide evade, or a defended super.
  // Override per character via `meterGain: { onHit, onDefend }`.
  GAIN_ON_HIT: 10,
  GAIN_ON_DEFEND: 20,
};

// When a super_move is stopped by the opponent's SHIELD (correct guard line),
// it backfires on the attacker — they take this multiple of the super's own
// damage as HP loss. Override per ultimate via `blockBackfireMult`.
export const BLOCKED_SUPER_DAMAGE_MULTIPLIER = 2;

// Per-character super-meter gain rates, falling back to the global METER
// defaults. Set `meterGain: { onHit, onDefend }` on a character to tune.
export function getMeterGain(charId) {
  const c = CHARACTERS[charId];
  return {
    onHit: c?.meterGain?.onHit ?? METER.GAIN_ON_HIT,
    onDefend: c?.meterGain?.onDefend ?? METER.GAIN_ON_DEFEND,
  };
}

// Recoil HP a fighter's GUARD deals to an attacker whose melee/rush/slide it
// correctly blocks — the attacker bounces off the shield (the blocker takes 0).
// Scales WITH ratings.def so sturdier guards punish hardest: round(def/12) →
// Iron Turtle (def 90) = 8, Mad Scientist (def 35) = 3. Untuned fighters (no
// ratings.def) deal none. Ranged blocks (shoot, Woman Hero's ice arrow) and
// supers never reach this — only the kinds in damageEngine's THROWBACK_BLOCK_KINDS.
export function throwbackDmgFor(charId) {
  const def = CHARACTERS[charId]?.ratings?.def;
  if (def == null) return 0;
  return Math.round(def / 12);
}

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
