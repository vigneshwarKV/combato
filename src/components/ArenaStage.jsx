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

        spriteA.x = width / 2 - 110;
        spriteA.y = groundY;
        applyScale(spriteA, baseScaleA, /* mirrored */ false);

        spriteB.x = width / 2 + 110;
        spriteB.y = groundY;
        applyScale(spriteB, baseScaleB, /* mirrored */ true);

        // Render order: fighter B behind by default — flips per attacker so the
        // attacking fighter renders on top during melee crossover.
        app.stage.addChild(spriteB);
        app.stage.addChild(spriteA);

        // Position shields just in front of each fighter (screen-relative)
        shieldA.x = spriteA.x + 50;
        shieldA.y = spriteA.y - 90;
        shieldB.x = spriteB.x - 50;
        shieldB.y = spriteB.y - 90;
        app.stage.addChild(shieldA);
        app.stage.addChild(shieldB);

        fighterARef.current = { sprite: spriteA, character: charA, shield: shieldA };
        fighterBRef.current = { sprite: spriteB, character: charB, shield: shieldB };

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
    playAnimation(fa.sprite, fa.character, action);
    raiseAttacker(fa.sprite, action);
    if (fa.shield) fa.shield.visible = action === 'defend';
    if (isProjectileAction(action)) spawnProjectile(appRef.current, fa.sprite, fighterBRef.current?.sprite, action, 'A');
  }, [animClassA, animKeyA]);

  // Drive Fighter B animation
  useEffect(() => {
    const fb = fighterBRef.current;
    if (!fb) return;
    const action = (animClassB || 'anim-idle').replace(/^anim-/, '');
    playAnimation(fb.sprite, fb.character, action);
    raiseAttacker(fb.sprite, action);
    if (fb.shield) fb.shield.visible = action === 'defend';
    if (isProjectileAction(action)) spawnProjectile(appRef.current, fb.sprite, fighterARef.current?.sprite, action, 'B');
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
// arrows when the character has them; everything else uses the generic bullet.
function projectileTexture(action) {
  if (action === 'ultimate_fire')   return '/assets/effects/FireArrow.png';
  if (action === 'ultimate_ice')    return '/assets/effects/IceArrow.png';
  if (action === 'ultimate_poison') return '/assets/effects/IceArrow.png'; // tinted later
  return '/assets/effects/Bullets.png';
}

function isProjectileAction(action) {
  return action === 'ranged'
      || action === 'ultimate_fire'
      || action === 'ultimate_ice'
      || action === 'ultimate_poison';
}

function spawnProjectile(app, fromSprite, toSprite, action, side) {
  if (!app || !fromSprite || !toSprite) return;
  const texUrl = projectileTexture(action);
  const isArrow = action.startsWith('ultimate_');

  // Spawn ~gun height of attacker, target chest of opponent.
  const startX = fromSprite.x + (side === 'A' ? 30 : -30);
  const startY = fromSprite.y - 110;
  const endX = toSprite.x + (side === 'A' ? -30 : 30);
  const endY = toSprite.y - 110;

  // Muzzle flash + smoke puff at the gun barrel — only for bullets, not arrows
  if (!isArrow) spawnMuzzleEffect(app, startX, startY, side);

  PIXI.Assets.load(texUrl).then(texture => {
    const bullet = new PIXI.Sprite(texture);
    bullet.anchor.set(0.5);
    bullet.scale.set(isArrow ? 0.9 : 1.0);
    if (action === 'ultimate_poison') bullet.tint = 0x84cc16;

    bullet.x = startX;
    bullet.y = startY;
    // Rotation alone aligns the bullet with the firing direction. Don't also
    // flip scale.x — that would double-mirror it for fighter B and the bullet
    // would face the wrong way.
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
  const isAttacking = action === 'melee' || action === 'ranged' || action.startsWith('ultimate');
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
  const animationName = character.animations[actionKey] || character.animations.idle;
  if (!animationName) return;

  if (character.renderMode === 'spine' && sprite.state) {
    const loop = actionKey === 'idle' || actionKey === 'celebrate';
    try {
      sprite.state.setAnimation(0, animationName, loop);
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
    };
    if (cached) apply(cached);
    else loadFrames(sprite._character, animationName, files)
      .then(textures => { sprite._loadedAnims.set(animationName, textures); apply(textures); })
      .catch(e => console.warn('[ArenaStage] frame load failed:', e));
  }
}
