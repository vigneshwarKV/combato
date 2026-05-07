import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Spine } from '@pixi/spine-pixi';
import { CHARACTERS } from '../data/characters.js';

// Caches keyed by character.assetBase so loaders only fire once per character
// across mounts. The actual PIXI display objects are NOT cached — only the
// asset URLs and parsed manifest data — because each fight needs its own
// instance attached to its own stage.
const spineLoaded = new Set();      // assetBase strings
const manifestCache = new Map();    // assetBase → manifest
const frameCache = new Map();       // `${assetBase}/${animName}` → PIXI.Texture[]

/**
 * One Pixi.js Application that hosts BOTH fighters in a single canvas.
 * This fixes two things over the old per-fighter canvas approach:
 *   - sprites can cross the centerline during attack lunges without clipping
 *   - per-character displayScale can normalise visual size differences
 *     between sprite packs without changing the global sprite scale
 *
 * Props:
 *   characterAId, characterBId — keys in CHARACTERS
 *   animClassA, animClassB     — 'anim-idle', 'anim-melee', etc. (CSS-style)
 *   animKeyA, animKeyB         — increment to restart the same animation
 *   hpA, hpB                   — current HP (0 → death animation)
 *   width, height              — total stage dimensions
 */
export default function ArenaStage({
  characterAId, characterBId,
  animClassA, animClassB,
  animKeyA, animKeyB,
  hpA = 100, hpB = 100,
  width = 1100,
  height = 600,
}) {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const fighterARef = useRef(null);
  const fighterBRef = useRef(null);
  const [loadError, setLoadError] = useState(null);

  const charA = CHARACTERS[characterAId];
  const charB = CHARACTERS[characterBId];

  useEffect(() => {
    if (!containerRef.current || !charA || !charB) return;
    let cancelled = false;

    const app = new PIXI.Application();
    appRef.current = app;

    (async () => {
      try {
        await app.init({
          width, height,
          backgroundAlpha: 0,
          antialias: true,
          preference: 'webgl',
        });
        if (cancelled) { app.destroy(true); return; }
        containerRef.current?.appendChild(app.canvas);

        const [spriteA, spriteB] = await Promise.all([
          loadFighterSprite(charA),
          loadFighterSprite(charB),
        ]);
        if (cancelled) return;

        // Build a shield overlay for each fighter — initially hidden, shown
        // while the fighter's action is 'defend'.
        const shieldA = makeShield();
        const shieldB = makeShield();
        shieldA.visible = false;
        shieldB.visible = false;

        // Center two fighters at the bottom of the stage, separated by ~180px.
        // Fighter A faces right (default), Fighter B is mirrored.
        const groundY = height - 30;
        const baseScaleA = (charA.displayScale ?? 1) * (charA.renderMode === 'spine' ? 1 : 1);
        const baseScaleB = (charB.displayScale ?? 1) * (charB.renderMode === 'spine' ? 1 : 1);

        // Keep at least 80px from each canvas edge so sprites never start outside bounds
        const sep = Math.min(240, width / 2 - 80);
        spriteA.x = width / 2 - sep;
        spriteA.y = groundY;
        applyScale(spriteA, baseScaleA, /* mirrored */ false);

        spriteB.x = width / 2 + sep;
        spriteB.y = groundY;
        applyScale(spriteB, baseScaleB, /* mirrored */ true);

        // Render order: fighter B behind by default — flips per attacker so the
        // attacking fighter renders on top during melee crossover.
        app.stage.addChild(spriteB);
        app.stage.addChild(spriteA);

        // Shields are created but never shown (removed per design decision)
        app.stage.addChild(shieldA);
        app.stage.addChild(shieldB);

        // Stash app on sprites so per-frame helpers (e.g., slot-tint enforcer)
        // can access app.ticker without threading it through every callsite.
        spriteA._pixiApp = app;
        spriteB._pixiApp = app;
        // Resting (ground) Y — used by fireProjectile so straight-line shots
        // aim at the defender's base position, not their mid-jump position.
        spriteA._baseY = spriteA.y;
        spriteB._baseY = spriteB.y;

        fighterARef.current = { sprite: spriteA, character: charA, shield: shieldA, baseX: spriteA.x, baseY: spriteA.y, side: 'A', activeTween: null };
        fighterBRef.current = { sprite: spriteB, character: charB, shield: shieldB, baseX: spriteB.x, baseY: spriteB.y, side: 'B', activeTween: null };

        playAnimation(spriteA, charA, 'idle');
        playAnimation(spriteB, charB, 'idle');
      } catch (e) {
        console.error('[ArenaStage] init failed:', e);
        if (!cancelled) setLoadError(e.message || 'Stage load failed');
      }
    })();

    return () => {
      cancelled = true;
      try { app.destroy(true, { children: true }); } catch { /* ignore */ }
      appRef.current = null;
      fighterARef.current = null;
      fighterBRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterAId, characterBId]);

  // Drive Fighter A animation. Trust useFight as the single source of truth —
  // it dispatches anim-death on KO and anim-celebrate on victory; do NOT
  // override based on hp here, otherwise the death plays once on ACTION_RESULT
  // and again on the KO event.
  useEffect(() => {
    const fa = fighterARef.current;
    if (!fa) return;
    const action = (animClassA || 'anim-idle').replace(/^anim-/, '');
    playAction(fa, fighterBRef.current, action, appRef.current);
    raiseAttacker(fa.sprite, action);
    if (isProjectileAction(action, charA)) spawnProjectile(appRef.current, fa.sprite, fighterBRef.current?.sprite, action, 'A', charA);
  }, [animClassA, animKeyA]);

  // Drive Fighter B animation
  useEffect(() => {
    const fb = fighterBRef.current;
    if (!fb) return;
    const action = (animClassB || 'anim-idle').replace(/^anim-/, '');
    playAction(fb, fighterARef.current, action, appRef.current);
    raiseAttacker(fb.sprite, action);
    if (isProjectileAction(action, charB)) spawnProjectile(appRef.current, fb.sprite, fighterARef.current?.sprite, action, 'B', charB);
  }, [animClassB, animKeyB]);

  if (!charA || !charB) {
    return <div style={{ width, height, display: 'grid', placeItems: 'center', color: '#f87171' }}>
      Missing character: {!charA ? characterAId : characterBId}
    </div>;
  }
  if (loadError) {
    return <div style={{ width, height, display: 'grid', placeItems: 'center', color: '#f87171', fontSize: 12 }}>
      Stage load failed: {loadError}
    </div>;
  }
  return <div ref={containerRef} style={{ width, height, position: 'relative' }} />;
}

// ── helpers ────────────────────────────────────────────────────────────────

function makeShield() {
  // A glowing translucent shield drawn with Pixi.Graphics — works at any size
  // and avoids needing per-character shield sprites.
  const g = new PIXI.Graphics();
  g.ellipse(0, 0, 48, 90).fill({ color: 0x60a5fa, alpha: 0.28 });
  g.ellipse(0, 0, 48, 90).stroke({ color: 0x93c5fd, width: 3, alpha: 0.95 });
  g.moveTo(-12, -40).lineTo(12, -40).lineTo(0, -16).lineTo(-12, -40).fill({ color: 0xffffff, alpha: 0.5 });
  return g;
}

// Pick the projectile sprite for a given action. Ultimate shoots use elemental
// arrows when the character has them; otherwise the character's own projectile
// override (if any), or the generic bullet.
function projectileTexture(action, character) {
  if (action === 'hit' && character?.hitProjectile) return character.hitProjectile;
  if (action === 'ultimate_fire')   return '/assets/effects/FireArrow.png';
  if (action === 'ultimate_ice')    return '/assets/effects/IceArrow.png';
  if (action === 'ultimate_poison') return '/assets/effects/IceArrow.png'; // tinted later
  if (action === 'ultimate_arrow')  return '/assets/effects/FireArrow.png'; // tinted green later
  if (character?.projectile) return character.projectile;
  return '/assets/effects/Bullets.png';
}

function isProjectileAction(action, character) {
  if (action === 'shoot'
      || action === 'ultimate_fire'
      || action === 'ultimate_ice'
      || action === 'ultimate_poison'
      || action === 'ultimate_arrow') return true;
  return character?.extraProjectileActions?.includes(action) ?? false;
}

function spawnProjectile(app, fromSprite, toSprite, action, side, character) {
  if (!app || !fromSprite || !toSprite) return;
  const delayMs = character?.projectileDelayByAction?.[action]
    ?? character?.projectileDelayMs ?? 0;
  const motionOverride = character?.motionOverrides?.[action];
  const spreadShot = motionOverride?.spreadShot;

  if (spreadShot) {
    const stagger = motionOverride?.spreadStagger ?? 100;
    const releaseDelay = motionOverride?.releaseDelay ?? 0;
    // Each entry: { endYOff, rotation }. The character tilts to "aim" each
    // direction before releasing, then re-triggers the shoot animation.
    const sequence = motionOverride?.spread ?? [
      { endYOff: -80, rotation: 0 },
      { endYOff:  80, rotation: 0 },
      { endYOff:   0, rotation: 0 },
    ];
    sequence.forEach((step, i) => {
      const animAt = delayMs + i * stagger;
      const startAnim = () => {
        // Tilt the sprite to aim. Anchor is at the feet so the head/bow rotates.
        if (step.rotation !== undefined) fromSprite.rotation = step.rotation;
        playAnimation(fromSprite, character, action);
        const releaseFn = () => fireProjectile(app, fromSprite, toSprite, action, side, character, step.endYOff ?? 0);
        if (releaseDelay > 0) setTimeout(releaseFn, releaseDelay);
        else releaseFn();
      };
      if (animAt > 0) setTimeout(startAnim, animAt);
      else startAnim();
    });
    return;
  }

  if (delayMs > 0) {
    setTimeout(() => fireProjectile(app, fromSprite, toSprite, action, side, character, 0), delayMs);
  } else {
    fireProjectile(app, fromSprite, toSprite, action, side, character, 0);
  }
}

// endYOffset shifts the TARGET Y on the opponent (positive = lower). For spread
// shots each arrow fans to a different vertical position on the opponent.
function fireProjectile(app, fromSprite, toSprite, action, side, character, endYOffset = 0) {
  if (!app || !fromSprite || !toSprite) return;
  const texUrl = projectileTexture(action, character);
  const isArrow = action.startsWith('ultimate_') || (action === 'hit' && !!character?.hitProjectile);
  const scale = character?.projectileScale ?? (isArrow ? 0.9 : 1.0);

  // Start at attacker's current Y (correct when firing mid-jump), target opponent chest ± offset.
  const startXOff = character?.projectileStartXByAction?.[action] ?? 160;
  const startX = fromSprite.x + (side === 'A' ? startXOff : -startXOff);
  const startYOff = character?.projectileStartYByAction?.[action] ?? -80;
  const startY = fromSprite.y + startYOff;
  const endX = toSprite.x + (side === 'A' ? -40 : 40);
  // Aim at the defender's RESTING chest height — a straight-line shot must
  // not track a jumping defender (jump is supposed to evade shoot, so the
  // arrow/spear should pass under them visually).
  const targetBaseY = toSprite._baseY ?? toSprite.y;
  const endY = targetBaseY - 80 + endYOffset;

  // Muzzle flash only for bullets (no custom projectile, no arrow).
  if (!isArrow && !character?.projectile) spawnMuzzleEffect(app, startX, startY, side);

  PIXI.Assets.load(texUrl).then(texture => {
    const bullet = new PIXI.Sprite(texture);
    bullet.anchor.set(0.5);
    bullet.scale.set(scale);
    if (action === 'ultimate_poison') bullet.tint = 0x84cc16;

    bullet.x = startX;
    bullet.y = startY;
    bullet.rotation = Math.atan2(endY - startY, endX - startX);
    app.stage.addChild(bullet);

    const startTime = performance.now();
    const duration = 600;
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      bullet.x = startX + (endX - startX) * t;
      bullet.y = startY + (endY - startY) * t;
      if (t >= 1) {
        app.ticker.remove(tick);
        try { app.stage.removeChild(bullet); bullet.destroy(); } catch { /* ignore */ }
      }
    };
    app.ticker.add(tick);
  }).catch(e => console.warn('[ArenaStage] projectile load failed:', e));
}

// Muzzle flash + smoke cloud at the gun barrel. Layered: outer glow, bright
// star spark, then a frame-animated Craftpix smoke puff drifting forward.
function spawnMuzzleEffect(app, x, y, side) {
  const dir = side === 'A' ? 1 : -1;

  // 1. Outer glow — large soft yellow circle behind the spark
  const glow = new PIXI.Graphics();
  glow.circle(0, 0, 38).fill({ color: 0xfde68a, alpha: 0.55 });
  glow.x = x + dir * 12;
  glow.y = y;
  app.stage.addChild(glow);

  // 2. Bright star spark
  const spark = new PIXI.Graphics();
  spark.star(0, 0, 8, 32, 12).fill({ color: 0xffffff, alpha: 1 });
  spark.star(0, 0, 8, 22, 8).fill({ color: 0xffd54a, alpha: 1 });
  spark.x = x + dir * 12;
  spark.y = y;
  app.stage.addChild(spark);

  // Animate spark + glow over 220ms
  const sparkStart = performance.now();
  const sparkDur = 220;
  const sparkTick = () => {
    const elapsed = performance.now() - sparkStart;
    const t = Math.min(1, elapsed / sparkDur);
    spark.alpha = 1 - t;
    spark.scale.set(1 + t * 0.8);
    glow.alpha = 0.55 * (1 - t);
    glow.scale.set(1 + t * 1.2);
    if (t >= 1) {
      app.ticker.remove(sparkTick);
      try { app.stage.removeChild(spark); spark.destroy(); } catch { /* ignore */ }
      try { app.stage.removeChild(glow); glow.destroy(); } catch { /* ignore */ }
    }
  };
  app.ticker.add(sparkTick);

  // 3. Smoke puff — Craftpix Smoke01..04 as a frame animation drifting forward
  const smokeUrls = [
    '/assets/effects/Smoke01.png',
    '/assets/effects/Smoke02.png',
    '/assets/effects/Smoke03.png',
    '/assets/effects/Smoke04.png',
  ];
  Promise.all(smokeUrls.map(u => PIXI.Assets.load(u).catch(() => null))).then(textures => {
    const valid = textures.filter(Boolean);
    if (valid.length === 0) return;
    const smoke = new PIXI.AnimatedSprite(valid);
    smoke.anchor.set(0.5);
    smoke.scale.set(2.0);  // Smoke01-04 source PNGs are tiny (~30px) — scale way up
    smoke.x = x + dir * 22;
    smoke.y = y - 4;
    smoke.animationSpeed = 0.18;
    smoke.loop = false;
    smoke.alpha = 0.95;
    smoke.tint = 0xfff4d4;
    smoke.play();
    app.stage.addChild(smoke);

    const startTime = performance.now();
    const duration = 500;
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      smoke.x = x + dir * (22 + 60 * t);
      smoke.y = y - 4 - 8 * t;  // drifts up slightly
      smoke.alpha = 0.95 * (1 - t * 0.95);
      smoke.scale.set(2.0 + 1.4 * t);
      if (t >= 1) {
        app.ticker.remove(tick);
        try { app.stage.removeChild(smoke); smoke.destroy(); } catch { /* ignore */ }
      }
    };
    app.ticker.add(tick);
  });
}

function applyScale(sprite, base, mirrored) {
  const sx = mirrored ? -base : base;
  if (sprite.scale && typeof sprite.scale.set === 'function') {
    sprite.scale.set(sx, base);
  } else {
    sprite.scale.x = sx;
    sprite.scale.y = base;
  }
  if (sprite.anchor && typeof sprite.anchor.set === 'function') {
    sprite.anchor.set(0.5, 1);
  }
}

// When a fighter starts attacking, raise their z-index so they render in front
// during a lunge. Reverts on idle.
function raiseAttacker(sprite, action) {
  const isAttacking = action === 'hit' || action === 'shoot' || action.startsWith('ultimate');
  if (sprite.parent) {
    if (isAttacking) sprite.parent.setChildIndex(sprite, sprite.parent.children.length - 1);
  }
}

async function loadFighterSprite(character) {
  if (character.renderMode === 'spine') return loadSpine(character);
  return loadPng(character);
}

async function loadSpine(character) {
  if (!spineLoaded.has(character.assetBase)) {
    const skelUrl = `${character.assetBase}/${character.skeletonJson}`;
    const atlasUrl = `${character.assetBase}/${character.atlasFile}`;
    await PIXI.Assets.load([skelUrl, atlasUrl]);
    spineLoaded.add(character.assetBase);
  }
  const skelUrl = `${character.assetBase}/${character.skeletonJson}`;
  const atlasUrl = `${character.assetBase}/${character.atlasFile}`;
  // spine.scale: Craftpix Spine atlases are sized for high-res — base 0.5
  // brings them to a comfortable arena size. Per-character displayScale
  // stacks on top of the View's scale (set by applyScale).
  const spine = Spine.from({ skeleton: skelUrl, atlas: atlasUrl, scale: 0.5 });
  spine.state.setAnimation(0, character.animations.idle, true);
  return spine;
}

async function loadPng(character) {
  let manifest = manifestCache.get(character.assetBase);
  if (!manifest) {
    const res = await fetch(`${character.assetBase}/manifest.json`);
    if (!res.ok) throw new Error(`manifest fetch ${res.status}`);
    manifest = await res.json();
    manifestCache.set(character.assetBase, manifest);
  }
  const idleFolder = character.animations.idle;
  const idleFiles = manifest.animations[idleFolder];
  if (!idleFiles) throw new Error(`No idle animation: ${idleFolder}`);

  const sprite = new PIXI.AnimatedSprite([PIXI.Texture.EMPTY]);
  sprite._character = character;
  sprite._manifest = manifest;
  sprite._loadedAnims = new Map();

  const idleTextures = await loadFrames(character, idleFolder, idleFiles);
  sprite._loadedAnims.set(idleFolder, idleTextures);
  sprite.textures = idleTextures;
  sprite.animationSpeed = 0.35;
  sprite.loop = true;
  sprite.play();
  return sprite;
}

async function loadFrames(character, folder, files) {
  const key = `${character.assetBase}/${folder}`;
  if (frameCache.has(key)) return frameCache.get(key);
  const urls = files.map(f => `${character.assetBase}/frames/${folder}/${f}`);
  const textures = await Promise.all(urls.map(u => PIXI.Assets.load(u)));
  frameCache.set(key, textures);
  return textures;
}

function playAnimation(sprite, character, actionKey) {
  // Accept either a known action key (looked up in animations) or a raw
  // animation name — useful for phase2 of multi-phase moves.
  const animationName = character.animations[actionKey] || actionKey || character.animations.idle;
  if (!animationName) return;

  if (character.renderMode === 'spine' && sprite.state) {
    const loop = actionKey === 'idle' || actionKey === 'celebrate';
    try {
      const track = sprite.state.setAnimation(0, animationName, loop);
      if (track) {
        if (actionKey === 'defend') {
          track.trackTime = 0;     // freeze on first frame (matches idle position)
          track.timeScale = 0;     // freeze on that pose
        } else {
          track.timeScale = character.actionTimeScales?.[actionKey] ?? 1;
        }
      }
      applySlotTints(sprite, character, actionKey);
    } catch {
      try { sprite.state.setAnimation(0, character.animations.idle, true); } catch { /* ignore */ }
    }
    return;
  }

  if (character.renderMode === 'png' && sprite._manifest) {
    const files = sprite._manifest.animations[animationName];
    if (!files) return;
    const loop = actionKey === 'idle' || actionKey === 'celebrate';
    const cached = sprite._loadedAnims.get(animationName);
    const apply = (textures) => {
      sprite.textures = textures;
      sprite.loop = loop;
      sprite.gotoAndPlay(0);
      // Die frames are taller than idle — push sprite down so the fallen
      // character lands on the ground rather than floating at mid-height.
      if (actionKey === 'death' && textures.length > 0) {
        const idleFiles = sprite._manifest.animations[character.animations.idle];
        const idleH = sprite._loadedAnims.get(character.animations.idle)?.[0]?.height ?? textures[0].height;
        const extraH = textures[0].height - idleH;
        if (extraH > 0) sprite.y += extraH * (character.displayScale ?? 1);
      }
    };
    if (cached) apply(cached);
    else loadFrames(sprite._character, animationName, files)
      .then(textures => { sprite._loadedAnims.set(animationName, textures); apply(textures); })
      .catch(e => console.warn('[ArenaStage] frame load failed:', e));
  }
}

// Per-action slot color tinting + attachment swapping for Spine characters.
// Shoot animations have BOTH rgba and attachment timelines that overwrite our
// edits every frame, so a per-frame ticker is needed to keep the override on.
// Tears down on action change.
function applySlotTints(sprite, character, actionKey) {
  if (!sprite?.skeleton?.findSlot) return;
  const app = sprite._pixiApp;

  if (sprite._tintTicker && app) {
    app.ticker.remove(sprite._tintTicker);
    sprite._tintTicker = null;
  }

  const tints = character.slotTints?.[actionKey] ?? {};
  const swaps = character.attachmentSwaps?.[actionKey] ?? {};

  // Reset any slot this character ever tints back to white. Animation
  // attachment timelines naturally re-set on the next setAnimation, so
  // attachment swap doesn't need a manual reset path.
  const allTintSlots = new Set();
  for (const map of Object.values(character.slotTints ?? {})) {
    for (const name of Object.keys(map)) allTintSlots.add(name);
  }
  for (const name of allTintSlots) {
    const slot = sprite.skeleton.findSlot(name);
    if (slot?.color) { slot.color.r = 1; slot.color.g = 1; slot.color.b = 1; }
  }

  const tintEntries = Object.entries(tints);
  const swapEntries = Object.entries(swaps);
  if ((tintEntries.length === 0 && swapEntries.length === 0) || !app) return;

  const rgb = tintEntries.map(([name, c]) => ({
    name,
    r: ((c >> 16) & 0xff) / 255,
    g: ((c >> 8) & 0xff) / 255,
    b: (c & 0xff) / 255,
  }));

  const tickerFn = () => {
    for (const t of rgb) {
      const slot = sprite.skeleton.findSlot(t.name);
      if (slot?.color) { slot.color.r = t.r; slot.color.g = t.g; slot.color.b = t.b; }
    }
    for (const [slotName, attachmentName] of swapEntries) {
      try {
        const slot = sprite.skeleton.findSlot(slotName);
        if (!slot) continue;
        // Try the modern setAttachment API first; fall back to looking up the
        // attachment via the skin and assigning directly.
        if (typeof sprite.skeleton.setAttachment === 'function') {
          sprite.skeleton.setAttachment(slotName, attachmentName);
        } else {
          const skin = sprite.skeleton.skin ?? sprite.skeleton.data?.defaultSkin;
          const att = skin?.getAttachment?.(slot.data.index, attachmentName)
                   ?? skin?.attachments?.[slotName]?.[attachmentName];
          if (att) slot.setAttachment ? slot.setAttachment(att) : (slot.attachment = att);
        }
      } catch { /* ignore */ }
    }
  };
  // LOW priority so this fires AFTER the Spine state.apply() that runs each
  // frame — otherwise our overrides are immediately overwritten by the
  // animation's rgba and attachment timelines.
  app.ticker.add(tickerFn, null, PIXI.UPDATE_PRIORITY.LOW);
  sprite._tintTicker = tickerFn;
}

// Stop the PNG sprite on a specific frame number (for static defend pose).
function playStaticFrame(sprite, character, actionKey) {
  if (character.renderMode !== 'png' || !sprite._manifest) return;
  const folder = character.animations[actionKey];
  if (!folder) return;
  const files = sprite._manifest.animations[folder];
  if (!files) return;
  const frameIdx = character.defendStaticFrame ?? 0;
  const cached = sprite._loadedAnims.get(folder);
  const apply = (textures) => {
    sprite.textures = textures;
    sprite.gotoAndStop(Math.min(frameIdx, textures.length - 1));
  };
  if (cached) apply(cached);
  else loadFrames(character, folder, files)
    .then(t => { sprite._loadedAnims.set(folder, t); apply(t); })
    .catch(e => console.warn('[ArenaStage] static frame load failed:', e));
}

// ── PNG character motion system ──────────────────────────────────────────────
// Applies to all renderMode:'png' characters. Spine characters skip this path
// entirely and use playAnimation directly (they handle motion internally).

const PNG_MOTION = {
  hit:             { kind: 'lunge',  gap: 150, fwdMs: 220, holdMs: 320, retMs: 200 },
  shoot:           { kind: 'none' },
  jump:            { kind: 'arc',    peakY: 130, ms: 850 },
  slide:           { kind: 'glide',  gap: 130, fwdMs: 320, holdMs: 220, retMs: 360 },
  defend:          { kind: 'static' },
  ultimate_rocket: { kind: 'flyHit', gap: 160, fwdMs: 900, holdMs: 500, retMs: 300, peakY: 400, phase2: 'hit' },
  ultimate_roll:   { kind: 'flyHit', gap: 160, fwdMs: 900, holdMs: 500, retMs: 300, peakY: 400, phase2: 'slide' },
  idle:            { kind: 'none' },
  hurt:            { kind: 'none' },
  death:           { kind: 'none' },
  celebrate:       { kind: 'none' },
};

function cancelActiveTween(fighter) {
  if (fighter.activeTween) {
    try { fighter.activeTween(); } catch { /* ignore */ }
    fighter.activeTween = null;
  }
  // Snap back to base position immediately
  if (fighter.sprite) {
    fighter.sprite.x = fighter.baseX;
    fighter.sprite.y = fighter.baseY;
    fighter.sprite.rotation = 0;
  }
}

function tweenLunge(fighter, opponent, motion, app) {
  if (!app || !opponent) return;
  const dir = fighter.side === 'A' ? 1 : -1;
  const targetX = opponent.baseX - dir * motion.gap;
  const startX = fighter.baseX;
  const startTime = performance.now();
  const totalMs = motion.fwdMs + motion.holdMs + motion.retMs;

  const tick = () => {
    const elapsed = performance.now() - startTime;
    if (elapsed <= motion.fwdMs) {
      const t = elapsed / motion.fwdMs;
      fighter.sprite.x = startX + (targetX - startX) * easeOut(t);
    } else if (elapsed <= motion.fwdMs + motion.holdMs) {
      fighter.sprite.x = targetX;
    } else if (elapsed <= totalMs) {
      const t = (elapsed - motion.fwdMs - motion.holdMs) / motion.retMs;
      fighter.sprite.x = targetX + (startX - targetX) * easeOut(t);
    } else {
      fighter.sprite.x = startX;
      app.ticker.remove(tick);
      fighter.activeTween = null;
    }
  };
  app.ticker.add(tick);
  fighter.activeTween = () => app.ticker.remove(tick);
}

function tweenGlide(fighter, opponent, motion, app) {
  // Same shape as lunge but with glide easing
  tweenLunge(fighter, opponent, motion, app);
}

function tweenArcY(fighter, motion, app) {
  if (!app) return;
  const startY = fighter.baseY;
  const peakY = startY - motion.peakY;
  const startTime = performance.now();

  const tick = () => {
    const elapsed = performance.now() - startTime;
    const t = Math.min(elapsed / motion.ms, 1);
    // Parabola: peaks at t=0.5
    const arc = 4 * t * (1 - t);
    fighter.sprite.y = startY + (peakY - startY) * arc;
    if (t >= 1) {
      fighter.sprite.y = startY;
      app.ticker.remove(tick);
      fighter.activeTween = null;
    }
  };
  app.ticker.add(tick);
  fighter.activeTween = () => app.ticker.remove(tick);
}

// Jump straight up, hold at peak (firing phase), arc back down. No X movement.
function tweenJumpShoot(fighter, motion, app) {
  if (!app) return;
  const startY = fighter.baseY;
  const peakY = startY - (motion.peakY ?? 200);
  const startTime = performance.now();
  const upMs = motion.upMs ?? 400;
  const holdMs = motion.holdMs ?? 150;
  const downMs = motion.downMs ?? 400;
  const totalMs = upMs + holdMs + downMs;

  const tick = () => {
    const elapsed = performance.now() - startTime;
    if (elapsed <= upMs) {
      const t = elapsed / upMs;
      fighter.sprite.y = startY + (peakY - startY) * easeOut(t);
    } else if (elapsed <= upMs + holdMs) {
      fighter.sprite.y = peakY;
    } else if (elapsed <= totalMs) {
      const t = (elapsed - upMs - holdMs) / downMs;
      fighter.sprite.y = peakY + (startY - peakY) * easeOut(t);
    } else {
      fighter.sprite.y = startY;
      app.ticker.remove(tick);
      fighter.activeTween = null;
    }
  };
  app.ticker.add(tick);
  fighter.activeTween = () => app.ticker.remove(tick);
}

function tweenFlyHit(fighter, opponent, motion, app) {
  if (!app || !opponent) return;
  const dir = fighter.side === 'A' ? 1 : -1;
  const targetX = opponent.baseX - dir * motion.gap;
  const startX = fighter.baseX;
  const startY = fighter.baseY;
  const peakY = startY - (motion.peakY ?? 80);
  // endY: where phase 1 lands (and where hold + return-from happen).
  // endYOffset > 0 means land above the ground (e.g., at opponent's head).
  const endY = startY - (motion.endYOffset ?? 0);
  const startTime = performance.now();
  const totalMs = motion.fwdMs + motion.holdMs + motion.retMs;
  let phase2Triggered = false;

  const tick = () => {
    const elapsed = performance.now() - startTime;
    if (elapsed <= motion.fwdMs) {
      const t = elapsed / motion.fwdMs;
      fighter.sprite.x = startX + (targetX - startX) * t;
      // Linear from startY → endY, plus a sin arc above the line that peaks at t=0.5.
      const linearY = startY + (endY - startY) * t;
      const arcOffset = (peakY - startY) * Math.sin(Math.PI * t);
      fighter.sprite.y = linearY + arcOffset;
      // Switch to Hit animation on the descent, just before landing
      if (!phase2Triggered && t >= 0.78 && motion.phase2) {
        phase2Triggered = true;
        playAnimation(fighter.sprite, fighter.character, motion.phase2);
      }
    } else if (elapsed <= motion.fwdMs + motion.holdMs) {
      fighter.sprite.x = targetX;
      fighter.sprite.y = endY;
    } else if (elapsed <= totalMs) {
      const t = (elapsed - motion.fwdMs - motion.holdMs) / motion.retMs;
      fighter.sprite.x = targetX + (startX - targetX) * easeOut(t);
      fighter.sprite.y = endY + (startY - endY) * easeOut(t);
    } else {
      fighter.sprite.x = startX;
      fighter.sprite.y = startY;
      app.ticker.remove(tick);
      fighter.activeTween = null;
    }
  };
  app.ticker.add(tick);
  fighter.activeTween = () => app.ticker.remove(tick);
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 2);
}

function playAction(fighter, opponent, action, app) {
  if (!fighter) return;
  // Skip motion system for characters without a motionProfile and not PNG.
  if (fighter.character.renderMode !== 'png' && !fighter.character.motionProfile) {
    playAnimation(fighter.sprite, fighter.character, action);
    return;
  }

  const DEFAULT_ULTIMATE_MOTION = { kind: 'flyHit', gap: 160, fwdMs: 900, holdMs: 500, retMs: 300, peakY: 400, phase2: 'hit' };
  const baseMotion = PNG_MOTION[action] ?? (action.startsWith('ultimate_') ? DEFAULT_ULTIMATE_MOTION : PNG_MOTION.idle);
  const override = fighter.character.motionOverrides?.[action];
  const motion = override ? { ...baseMotion, ...override } : baseMotion;
  cancelActiveTween(fighter);

  switch (motion.kind) {
    case 'lunge':
      playAnimation(fighter.sprite, fighter.character, action);
      tweenLunge(fighter, opponent, motion, app);
      break;
    case 'glide':
      playAnimation(fighter.sprite, fighter.character, action);
      tweenGlide(fighter, opponent, motion, app);
      break;
    case 'arc':
      playAnimation(fighter.sprite, fighter.character, action);
      tweenArcY(fighter, motion, app);
      break;
    case 'jumpShoot':
      playAnimation(fighter.sprite, fighter.character, action);
      tweenJumpShoot(fighter, motion, app);
      break;
    case 'static':
      if (fighter.character.animations[action]) {
        if (fighter.character.renderMode === 'png') {
          playStaticFrame(fighter.sprite, fighter.character, action);
        } else if (motion.spreadShot) {
          // spawnProjectile triggers playAnimation once per arrow; skip the
          // initial play here so we don't see an extra empty draw/release
          // before the first arrow fires.
        } else {
          playAnimation(fighter.sprite, fighter.character, action);
          const offset = fighter.character.defendOffsetX;
          if (offset) {
            const dir = fighter.side === 'A' ? 1 : -1;
            fighter.sprite.x = fighter.baseX + dir * offset;
          }
        }
      } else {
        playAnimation(fighter.sprite, fighter.character, 'idle');
      }
      break;
    case 'flyHit':
      playAnimation(fighter.sprite, fighter.character, action);
      tweenFlyHit(fighter, opponent, motion, app);
      break;
    case 'none':
    default:
      playAnimation(fighter.sprite, fighter.character, action);
      break;
  }
  // Per-action Y offset (e.g., for Spine animations that displace the body
  // outside the canvas — push the sprite up to compensate).
  const yOffset = fighter.character.actionYOffsets?.[action];
  if (yOffset) fighter.sprite.y = fighter.baseY + yOffset;
}
