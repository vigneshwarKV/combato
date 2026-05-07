import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { CHARACTERS } from '../data/characters.js';
import {
  loadFighterSprite,
  loadFrames,
  playAnimation,
  applyScale,
  destroyFighterSprite,
} from '../engine/spritePlayer.js';
import { ANIM_DURATION } from '../engine/animResolution.js';

const HOLDS = {
  hit: ANIM_DURATION.hit,
  slide: ANIM_DURATION.slide,
  shoot: ANIM_DURATION.shoot,
  ultimate: ANIM_DURATION.ultimate,
};

// Standalone single-character preview. Mounts its own PIXI app, no opponent,
// no projectiles, no motion tweens — just the sprite playing actions so a
// player can feel the character before picking. Uses the same asset caches
// as ArenaStage, so warming preview pre-warms a future fight.
//
// `mode`:
//   'idle'    → play idle animation once (PIXI's loop=true keeps it cycling).
//               No JS timers — cheap enough to leave on every tile.
//   'actions' → cycle hit → slide → shoot → first ultimate → loop. No idle
//               in the sequence.
export default function CharacterPreview({ characterId, width = 360, height = 420, mode = 'idle' }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const char = CHARACTERS[characterId];
    if (!containerRef.current || !char) return undefined;

    let cancelled = false;
    let timer = null;
    let app = null;
    let sprite = null;

    const ultKey = char.ultimates?.[0]?.key ?? null;
    const STEPS = (mode === 'actions'
      ? ['hit', 'slide', 'shoot', ultKey]
      : []
    ).filter(k => k && char.animations[k]);

    function holdFor(k) {
      if (k === ultKey) return HOLDS.ultimate;
      return HOLDS[k] ?? 800;
    }

    (async () => {
      try {
        app = new PIXI.Application();
        await app.init({ width, height, backgroundAlpha: 0, antialias: true, preference: 'webgl' });
        if (cancelled) { app.destroy(true); return; }
        containerRef.current.appendChild(app.canvas);

        sprite = await loadFighterSprite(char);
        if (cancelled) { destroyFighterSprite(sprite); app.destroy(true); return; }
        sprite._pixiApp = app;
        app.stage.addChild(sprite);

        // Background prefetch frames for upcoming PNG actions so the cycle
        // doesn't stall on first transition. Spine loads everything in one shot.
        if (char.renderMode === 'png' && STEPS.length > 0) {
          const manifest = sprite._manifest;
          const folders = STEPS
            .map(k => char.animations[k])
            .filter(folder => folder && manifest?.animations?.[folder]);
          Promise.all(folders.map(f => loadFrames(char, f, manifest.animations[f])))
            .catch(() => { /* fire-and-forget; cycle will fall back to lazy load */ });
        }

        // Compute preview-friendly scale from sprite bounds. Sprite was created
        // by loadFighterSprite without a scale set yet; bounds reflect natural size.
        // Spine bounds need a state.update tick first; PNG bounds are valid now.
        let bounds;
        if (char.renderMode === 'spine' && sprite.state) {
          try { sprite.state.apply(sprite.skeleton); sprite.skeleton.updateWorldTransform?.(); } catch { /* ignore */ }
          bounds = sprite.getBounds?.();
        } else {
          bounds = sprite.getBounds?.();
        }
        const naturalH = bounds?.height || sprite.height || (sprite.textures?.[0]?.height ?? 200);
        const targetH = height * 0.85;
        const previewScale = Math.max(0.2, Math.min(3, targetH / naturalH));
        applyScale(sprite, previewScale, /* mirrored */ false);
        sprite.x = width / 2;
        sprite.y = height * 0.92;

        if (STEPS.length === 0) {
          // Idle mode: PIXI's built-in animation loop handles repetition;
          // no JS timer needed.
          playAnimation(sprite, char, 'idle');
        } else {
          // Action cycle — closure, not React state, so no re-renders.
          let i = 0;
          const step = () => {
            if (cancelled) return;
            const k = STEPS[i % STEPS.length];
            playAnimation(sprite, char, k);
            timer = setTimeout(() => { i++; step(); }, holdFor(k) + 50);
          };
          step();
        }
      } catch (e) {
        console.error('[CharacterPreview] init failed:', e);
        if (!cancelled) setError(e.message || 'Preview load failed');
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (sprite) destroyFighterSprite(sprite);
      if (app) {
        try { app.destroy(true, { children: true, texture: false, textureSource: false }); } catch { /* ignore */ }
      }
    };
  }, [characterId, width, height, mode]);

  if (!CHARACTERS[characterId]) return null;
  return (
    <div ref={containerRef} className="char-preview-canvas" style={{ width, height }}>
      {error && <div className="char-preview-error">{error}</div>}
    </div>
  );
}
