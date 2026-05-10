import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { CHARACTERS } from '../data/characters.js';
import {
  loadFighterSprite,
  loadFrames,
  playAnimation,
  applyScale,
} from '../engine/spritePlayer.js';

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
  // The action each fighter is going to perform this turn (even if currently
  // visually held in idle for sync, e.g. slideHold). Used by fireProjectile
  // to tell that the defender is GOING to slide so the bullet can fade out
  // before reaching the slider's resting base.
  plannedActionA, plannedActionB,
  hpA = 100, hpB = 100,
  width = 1100,
  height = 600,
  onReady,
}) {
  const containerRef = useRef(null);
  const appRef = useRef(null);
  const fighterARef = useRef(null);
  const fighterBRef = useRef(null);
  const [loadError, setLoadError] = useState(null);

  const charA = CHARACTERS[characterAId];
  const charB = CHARACTERS[characterBId];

  // sizeRef gives the async init access to the LATEST width/height. Without it,
  // ResizeObserver-driven width changes that arrive while init is awaiting
  // would leave sprites placed using the stale mount-time width — visually
  // shifting them off-center inside the now-wider wrapping div.
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  // onReadyRef lets the async init fire the latest callback without depending
  // on it (which would re-init on every parent render).
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!containerRef.current || !charA || !charB) return;
    let cancelled = false;

    const app = new PIXI.Application();
    appRef.current = app;

    (async () => {
      try {
        const { width: w0, height: h0 } = sizeRef.current;
        await app.init({
          width: w0, height: h0,
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

        // Read the LATEST size — stageWidth may have updated during the await.
        const { width: w, height: h } = sizeRef.current;
        if (w !== w0 || h !== h0) app.renderer.resize(w, h);

        // Center two fighters at the bottom of the stage, separated by ~180px.
        // Fighter A faces right (default), Fighter B is mirrored.
        const groundY = h - 30;
        const baseScaleA = (charA.displayScale ?? 1) * (charA.renderMode === 'spine' ? 1 : 1);
        const baseScaleB = (charB.displayScale ?? 1) * (charB.renderMode === 'spine' ? 1 : 1);

        // Keep at least 80px from each canvas edge so sprites never start outside bounds
        const sep = Math.min(240, w / 2 - 80);
        spriteA.x = w / 2 - sep;
        spriteA.y = groundY;
        applyScale(spriteA, baseScaleA, /* mirrored */ false);

        spriteB.x = w / 2 + sep;
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
        // Resting (ground) X/Y — used by fireProjectile so straight-line shots
        // aim at the defender's visual base position, not their tweened or
        // rig-compensated sprite position. (Spine `defendOffsetX` for monkey/
        // turtle/womanHero shifts sprite.x by hundreds of pixels to keep the
        // rendered body in place; reading sprite.x then would target the wrong
        // side of the canvas and the bullet would fly backwards.)
        spriteA._baseX = spriteA.x;
        spriteA._baseY = spriteA.y;
        spriteB._baseX = spriteB.x;
        spriteB._baseY = spriteB.y;
        // Stash character on Spine sprites too so fireProjectile's predictive
        // aim can read motionOverrides.slide directly off toSprite._character.
        // (loadPng already sets sprite._character; this is the Spine equivalent.)
        spriteA._character = charA;
        spriteB._character = charB;

        fighterARef.current = { sprite: spriteA, character: charA, shield: shieldA, baseX: spriteA.x, baseY: spriteA.y, side: 'A', activeTween: null };
        fighterBRef.current = { sprite: spriteB, character: charB, shield: shieldB, baseX: spriteB.x, baseY: spriteB.y, side: 'B', activeTween: null };

        playAnimation(spriteA, charA, 'idle');
        playAnimation(spriteB, charB, 'idle');

        // Signal readiness AFTER sprites are loaded and idle pose is up. The
        // host gates startFight() on this — without the gate the fight loop's
        // first action_result fires before sprites exist and the animation
        // useEffects bail (fighterARef null), dropping the first batch on the
        // floor. Random-move fights especially exhibit this: callAI returns
        // 'FAIL' instantly with no API key, so batch 1 dispatches well before
        // the Spine atlas / PNG manifest fetches resolve.
        onReadyRef.current?.();
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

  // Resize the PIXI canvas + recenter fighters when stageWidth/height change
  // after init (Arena.jsx feeds a ResizeObserver-driven width). Without this,
  // a 1100px canvas would sit left-aligned inside a wider wrapping div and the
  // fighters would appear shifted left of screen center. Skips reposition while
  // a tween is active so an in-flight lunge/jump doesn't get yanked back.
  useEffect(() => {
    const app = appRef.current;
    const fa = fighterARef.current;
    const fb = fighterBRef.current;
    if (!app?.renderer || !fa || !fb) return;
    app.renderer.resize(width, height);
    const groundY = height - 30;
    const sep = Math.min(240, width / 2 - 80);

    fa.baseX = width / 2 - sep;
    fa.baseY = groundY;
    fa.sprite._baseX = fa.baseX;
    fa.sprite._baseY = fa.baseY;
    if (!fa.activeTween) {
      fa.sprite.x = fa.baseX;
      fa.sprite.y = fa.baseY;
    }

    fb.baseX = width / 2 + sep;
    fb.baseY = groundY;
    fb.sprite._baseX = fb.baseX;
    fb.sprite._baseY = fb.baseY;
    if (!fb.activeTween) {
      fb.sprite.x = fb.baseX;
      fb.sprite.y = fb.baseY;
    }
  }, [width, height]);

  // Mirror plannedAction* onto sprites so fireProjectile can inspect what the
  // defender is GOING to do this turn (even if currently held in idle).
  useEffect(() => {
    const fa = fighterARef.current;
    if (fa?.sprite) fa.sprite._plannedAction = plannedActionA;
  }, [plannedActionA]);
  useEffect(() => {
    const fb = fighterBRef.current;
    if (fb?.sprite) fb.sprite._plannedAction = plannedActionB;
  }, [plannedActionB]);

  // Drive Fighter A animation. Trust useFight as the single source of truth —
  // it dispatches anim-death on KO and anim-celebrate on victory; do NOT
  // override based on hp here, otherwise the death plays once on ACTION_RESULT
  // and again on the KO event.
  useEffect(() => {
    const fa = fighterARef.current;
    if (!fa) return;
    cancelPendingProjectiles(fa);
    const action = (animClassA || 'anim-idle').replace(/^anim-/, '');
    fa.sprite._currentAction = action;
    playAction(fa, fighterBRef.current, action, appRef.current);
    raiseAttacker(fa.sprite, action);
    if (isProjectileAction(action, charA)) {
      fa._pendingProjectiles = spawnProjectile(appRef.current, fa.sprite, fighterBRef.current?.sprite, action, 'A', charA);
    }
  }, [animClassA, animKeyA]);

  // Drive Fighter B animation
  useEffect(() => {
    const fb = fighterBRef.current;
    if (!fb) return;
    cancelPendingProjectiles(fb);
    const action = (animClassB || 'anim-idle').replace(/^anim-/, '');
    fb.sprite._currentAction = action;
    playAction(fb, fighterARef.current, action, appRef.current);
    raiseAttacker(fb.sprite, action);
    if (isProjectileAction(action, charB)) {
      fb._pendingProjectiles = spawnProjectile(appRef.current, fb.sprite, fighterARef.current?.sprite, action, 'B', charB);
    }
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

// Returns an array of pending setTimeout IDs so the caller can cancel any
// scheduled-but-not-yet-spawned projectiles when the attacker's animation
// gets interrupted (e.g., a slow thrower clipped by a slide should keep the
// windup but never release the spear).
function spawnProjectile(app, fromSprite, toSprite, action, side, character) {
  if (!app || !fromSprite || !toSprite) return [];
  const delayMs = character?.projectileDelayByAction?.[action]
    ?? character?.projectileDelayMs ?? 0;
  const motionOverride = character?.motionOverrides?.[action];
  const spreadShot = motionOverride?.spreadShot;
  const timers = [];

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
        if (releaseDelay > 0) timers.push(setTimeout(releaseFn, releaseDelay));
        else releaseFn();
      };
      if (animAt > 0) timers.push(setTimeout(startAnim, animAt));
      else startAnim();
    });
    return timers;
  }

  if (delayMs > 0) {
    timers.push(setTimeout(() => {
      // If the attacker's animation has already moved on (interrupted by a
      // counter-attack — e.g., slide clipping a slow thrower mid-windup),
      // don't release the weapon. The currentAction stash is updated in
      // ArenaStage's animClass useEffect.
      if (fromSprite._currentAction !== action) return;
      fireProjectile(app, fromSprite, toSprite, action, side, character, 0);
    }, delayMs));
  } else {
    fireProjectile(app, fromSprite, toSprite, action, side, character, 0);
  }
  return timers;
}

function cancelPendingProjectiles(fighter) {
  if (!fighter?._pendingProjectiles?.length) return;
  fighter._pendingProjectiles.forEach(id => clearTimeout(id));
  fighter._pendingProjectiles = [];
}

// Reproduce the slide glide tween's X-position at time `t` (ms since slide
// start). Used for predictive aim — slide and the opposing shoot start in the
// same dispatch tick, so `t` is also the time elapsed since the bullet's
// turn began. Falls back to base if numbers are missing.
function predictSliderX(sliderSprite, attackerSprite, t) {
  const sliderChar = sliderSprite._character;
  const sliderBaseX = sliderSprite._baseX;
  const attackerBaseX = attackerSprite._baseX;
  if (sliderBaseX == null || attackerBaseX == null) return null;
  const motion = sliderChar?.motionOverrides?.slide ?? PNG_MOTION.slide;
  const fwdMs = motion.fwdMs ?? 320;
  const holdMs = motion.holdMs ?? 220;
  const retMs  = motion.retMs ?? 360;
  const gap    = motion.gap ?? 130;
  // Slider's direction is opposite to the attacker's: attacker on the left
  // (sliderBaseX > attackerBaseX) ⇒ slider moves left toward attacker, etc.
  const sliderDir = sliderBaseX > attackerBaseX ? -1 : 1;
  const targetX = attackerBaseX + (sliderDir > 0 ? -gap : gap);  // stop `gap` short of attacker
  if (t <= 0) return sliderBaseX;
  if (t <= fwdMs) {
    return sliderBaseX + (targetX - sliderBaseX) * easeOut(t / fwdMs);
  }
  if (t <= fwdMs + holdMs) return targetX;
  if (t <= fwdMs + holdMs + retMs) {
    const r = (t - fwdMs - holdMs) / retMs;
    return targetX + (sliderBaseX - targetX) * easeOut(r);
  }
  return sliderBaseX;
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
  // Aim at the defender's VISUAL base position — sprite.x can be shifted by
  // defendOffsetX (Spine rig compensation) and sprite.y by jump/lunge tweens.
  // Reading either directly would point the projectile to the wrong place
  // (e.g., backwards when monkey defends with offset 387 on side A).
  let targetBaseX = toSprite._baseX ?? toSprite.x;
  const targetBaseY = toSprite._baseY ?? toSprite.y;
  // If the defender is sliding (or about to slide), OR doing a rush-style
  // hit (Skater Kid's skateboard run), redirect the bullet to the midpoint
  // of their forward path AND shorten the visual flight so it disappears
  // before reaching their resting base. Standard melee hit doesn't need
  // this: the lunge ends near the shooter and the natural bullet path
  // passes through them around 90% of fwdMs.
  const targetIsSliding = toSprite._currentAction === 'slide' || toSprite._plannedAction === 'slide';
  const targetIsRushHit = (toSprite._currentAction === 'hit' || toSprite._plannedAction === 'hit')
    && toSprite._character?.hitIsRushStyle;
  let duration = 600;
  if (targetIsSliding || targetIsRushHit) {
    const action = targetIsSliding ? 'slide' : 'hit';
    const midX = convergeMidPathX(toSprite, fromSprite, action);
    if (midX != null) targetBaseX = midX;
    duration = SHORT_PROJECTILE_DURATION_MS;
  }
  const endX = targetBaseX + (side === 'A' ? -40 : 40);
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

// Bullets fired at a sliding target reach midX in this many ms — matches the
// shoot-vs-slide reaction time (impactA - SHOOT_HIT_OFFSET_MS in animResolution
// where impactA = projectileDelay + 600). Hardcoded here because ArenaStage
// doesn't import animResolution; if SHOOT_HIT_OFFSET_MS changes there, mirror.
const SHORT_PROJECTILE_DURATION_MS = 350;

// Midpoint of a converging defender's forward path (slide glide OR melee
// hit lunge). Used as the bullet's aim when the defender is rushing the
// shooter, so the projectile visibly meets them mid-motion instead of
// flying past to their resting base.
function convergeMidPathX(targetSprite, attackerSprite, action) {
  const targetBaseX = targetSprite._baseX;
  const attackerBaseX = attackerSprite._baseX;
  if (targetBaseX == null || attackerBaseX == null) return null;
  const motion = targetSprite._character?.motionOverrides?.[action] ?? PNG_MOTION[action];
  if (!motion) return null;
  const gap = motion.gap ?? (action === 'hit' ? 150 : 130);
  const dir = targetBaseX > attackerBaseX ? -1 : 1;
  const targetX = attackerBaseX + (dir > 0 ? -gap : gap);
  return (targetBaseX + targetX) / 2;
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

// When a fighter starts attacking, raise their z-index so they render in front
// during a lunge. Reverts on idle.
function raiseAttacker(sprite, action) {
  const isAttacking = action === 'hit' || action === 'shoot' || action.startsWith('ultimate');
  if (sprite.parent) {
    if (isAttacking) sprite.parent.setChildIndex(sprite, sprite.parent.children.length - 1);
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

function cancelActiveTween(fighter, { resetPosition = true } = {}) {
  if (fighter.activeTween) {
    try { fighter.activeTween(); } catch { /* ignore */ }
    fighter.activeTween = null;
  }
  if (resetPosition && fighter.sprite) {
    // Snap back to base position immediately
    fighter.sprite.x = fighter.baseX;
    fighter.sprite.y = fighter.baseY;
    fighter.sprite.rotation = 0;
  }
}

// Recover from a displaced impact pose to the fighter's base position while
// the death/hurt anim plays in parallel. Used in two cases:
//   - jumper clipped out of the air by a melee hit/ult — Y drops with gravity
//   - slide-vs-slide collision — X tweens back so both fighters get thrown
//     apart toward their starting positions
// When both axes are displaced (e.g., flyHit ult slammed mid-flight), both
// channels animate simultaneously.
function tweenImpactRecover(fighter, app) {
  if (!app || !fighter?.sprite) return;
  const startX = fighter.sprite.x;
  const startY = fighter.sprite.y;
  const endX = fighter.baseX;
  const endY = fighter.baseY;
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
    fighter.sprite.x = endX;
    fighter.sprite.y = endY;
    fighter.sprite.rotation = 0;
    return;
  }
  fighter.sprite.rotation = 0;
  const startTime = performance.now();
  const ms = 400;
  const tick = () => {
    const t = Math.min((performance.now() - startTime) / ms, 1);
    const easeOut = 1 - Math.pow(1 - t, 2); // for X (smooth deceleration toward base)
    const easeIn  = t * t;                  // for Y descent (gravity)
    fighter.sprite.x = startX + dx * easeOut;
    fighter.sprite.y = startY + dy * (dy > 0 ? easeIn : easeOut);
    if (t >= 1) {
      fighter.sprite.x = endX;
      fighter.sprite.y = endY;
      app.ticker.remove(tick);
      fighter.activeTween = null;
    }
  };
  app.ticker.add(tick);
  fighter.activeTween = () => app.ticker.remove(tick);
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
  // If we're transitioning into a reaction anim (death / hurt) while a motion
  // tween is in progress AND the sprite is currently displaced (mid-air from
  // jump, mid-glide from slide, mid-flyHit from an ult), skip the snap-to-base
  // so an impact-recover tween can carry the body back to its starting
  // position. The activeTween check matters: defenders sit at sprite.x =
  // baseX ± defendOffsetX (Spine rig compensation, no tween), and that's a
  // STATIC offset — when defend ends we must SNAP back, not tween, otherwise
  // the body slides sideways into the opponent's lane and back. Otherwise
  // reset normally.
  const sp = fighter.sprite;
  const isReactionAnim = action === 'death' || action === 'hurt';
  const isDisplaced = sp
    && (sp.y < fighter.baseY - 20 || Math.abs(sp.x - fighter.baseX) > 20);
  const wantsRecover = isReactionAnim && isDisplaced && !!fighter.activeTween;
  cancelActiveTween(fighter, { resetPosition: !wantsRecover });
  if (wantsRecover) tweenImpactRecover(fighter, app);

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
