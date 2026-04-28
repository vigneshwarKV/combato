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
    if (isProjectileAction(action)) spawnProjectile(appRef.current, fa.sprite, fighterBRef.current?.sprite, action, 'A', charA);
  }, [animClassA, animKeyA]);

  // Drive Fighter B animation
  useEffect(() => {
    const fb = fighterBRef.current;
    if (!fb) return;
    const action = (animClassB || 'anim-idle').replace(/^anim-/, '');
    playAction(fb, fighterARef.current, action, appRef.current);
    raiseAttacker(fb.sprite, action);
    if (isProjectileAction(action)) spawnProjectile(appRef.current, fb.sprite, fighterARef.current?.sprite, action, 'B', charB);
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
  if (action === 'ultimate_fire')   return '/assets/effects/FireArrow.png';
  if (action === 'ultimate_ice')    return '/assets/effects/IceArrow.png';
  if (action === 'ultimate_poison') return '/assets/effects/IceArrow.png'; // tinted later
  if (character?.projectile) return character.projectile;
  return '/assets/effects/Bullets.png';
}

function isProjectileAction(action) {
  return action === 'shoot'
      || action === 'ultimate_fire'
      || action === 'ultimate_ice'
      || action === 'ultimate_poison';
}

function spawnProjectile(app, fromSprite, toSprite, action, side, character) {
  if (!app || !fromSprite || !toSprite) return;
  const delayMs = character?.projectileDelayMs ?? 0;
  if (delayMs > 0) {
    setTimeout(() => fireProjectile(app, fromSprite, toSprite, action, side, character), delayMs);
  } else {
    fireProjectile(app, fromSprite, toSprite, action, side, character);
  }
}

function fireProjectile(app, fromSprite, toSprite, action, side, character) {
  if (!app || !fromSprite || !toSprite) return;
  const texUrl = projectileTexture(action, character);
  const isArrow = action.startsWith('ultimate_');
  const scale = isArrow ? 0.9 : (character?.projectileScale ?? 1.0);

  // Spawn at gun barrel tip (far side of attacker), target chest of opponent.
  const startX = fromSprite.x + (side === 'A' ? 160 : -160);
  const startY = fromSprite.y - 80;
  const endX = toSprite.x + (side === 'A' ? -40 : 40);
  const endY = toSprite.y - 80;

  // Muzzle flash + smoke puff at the gun barrel — only for bullets, not arrows
  // or thrown weapons (custom projectile means non-gun weapon).
  if (!isArrow && !character?.projectile) spawnMuzzleEffect(app, startX, startY, side);

  PIXI.Assets.load(texUrl).then(texture => {
    const bullet = new PIXI.Sprite(texture);
    bullet.anchor.set(0.5);
    bullet.scale.set(scale);
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
    case 'static':
      if (fighter.character.animations[action]) {
        if (fighter.character.renderMode === 'png') {
          playStaticFrame(fighter.sprite, fighter.character, action);
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
