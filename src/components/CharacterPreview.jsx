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
  const spriteRef = useRef(null);
  const charRef = useRef(null);
  const timerRef = useRef(null);
  const cancelTokenRef = useRef({ cancelled: false });
  const [error, setError] = useState(null);

  // Mount/init effect — runs once per character (mode change does NOT remount).
  useEffect(() => {
    const char = CHARACTERS[characterId];
    if (!containerRef.current || !char) return undefined;

    const token = { cancelled: false };
    cancelTokenRef.current = token;
    let app = null;
    let sprite = null;

    (async () => {
      try {
        app = new PIXI.Application();
        await app.init({ width, height, backgroundAlpha: 0, antialias: true, preference: 'webgl' });
        if (token.cancelled) { app.destroy(true); return; }
        containerRef.current.appendChild(app.canvas);

        sprite = await loadFighterSprite(char);
        if (token.cancelled) { destroyFighterSprite(sprite); app.destroy(true); return; }
        sprite._pixiApp = app;
        app.stage.addChild(sprite);

        let bounds;
        if (char.renderMode === 'spine' && sprite.state) {
          try { sprite.state.apply(sprite.skeleton); sprite.skeleton.updateWorldTransform?.(); } catch { /* ignore */ }
          bounds = sprite.getBounds?.();
        } else {
          bounds = sprite.getBounds?.();
        }
        const naturalH = bounds?.height || sprite.height || (sprite.textures?.[0]?.height ?? 200);
        const targetH = height * 0.7;
        const previewScale = Math.max(0.2, Math.min(3, targetH / naturalH));
        applyScale(sprite, previewScale, /* mirrored */ false);
        sprite.x = width / 2;
        sprite.y = height * 0.92;

        // Spine skeletons have no PIXI anchor — sprite.x positions the root
        // bone, not the visual silhouette center. Bounds are only valid once
        // the spine has ticked at least once.
        if (char.renderMode === 'spine') {
          const recenter = () => {
            if (token.cancelled || !spriteRef.current) return;
            const s = spriteRef.current;
            try {
              s.state?.update?.(0);
              s.state?.apply?.(s.skeleton);
              s.skeleton?.updateWorldTransform?.();
            } catch { /* ignore */ }
            const lb = s.getLocalBounds?.();
            if (lb && lb.width > 0) {
              const scaleX = Math.abs(s.scale?.x ?? 1);
              s.x = width / 2 - (lb.x + lb.width / 2) * scaleX;
              return;
            }
            const b = s.getBounds?.();
            const bx = b?.x ?? b?.minX;
            const bw = b?.width ?? (b?.maxX != null && b?.minX != null ? b.maxX - b.minX : 0);
            if (bw > 0) {
              const visualCenter = bx + bw / 2;
              s.x += (width / 2) - visualCenter;
            }
          };
          // Try immediately, then again after a tick in case bounds were 0.
          recenter();
          requestAnimationFrame(() => requestAnimationFrame(recenter));
        }

        spriteRef.current = sprite;
        charRef.current = char;
        startCycle(mode);
      } catch (e) {
        console.error('[CharacterPreview] init failed:', e);
        if (!token.cancelled) setError(e.message || 'Preview load failed');
      }
    })();

    return () => {
      token.cancelled = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      spriteRef.current = null;
      charRef.current = null;
      if (sprite) destroyFighterSprite(sprite);
      if (app) {
        try { app.destroy(true, { children: true, texture: false, textureSource: false }); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, width, height]);

  // Mode change effect — swap animation cycle without rebuilding Pixi.
  useEffect(() => {
    if (spriteRef.current && charRef.current) startCycle(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function startCycle(currentMode) {
    const sprite = spriteRef.current;
    const char = charRef.current;
    if (!sprite || !char) return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    const ultKey = char.ultimates?.[0]?.key ?? null;
    const STEPS = (currentMode === 'actions'
      ? ['hit', 'slide', 'shoot', ultKey]
      : []
    ).filter(k => k && char.animations[k]);

    if (char.renderMode === 'png' && STEPS.length > 0) {
      const manifest = sprite._manifest;
      const folders = STEPS
        .map(k => char.animations[k])
        .filter(folder => folder && manifest?.animations?.[folder]);
      Promise.all(folders.map(f => loadFrames(char, f, manifest.animations[f])))
        .catch(() => { /* fire-and-forget */ });
    }

    if (STEPS.length === 0) {
      playAnimation(sprite, char, 'idle');
      return;
    }

    let i = 0;
    const holdFor = k => k === ultKey ? HOLDS.ultimate : (HOLDS[k] ?? 800);
    const step = () => {
      if (cancelTokenRef.current.cancelled || !spriteRef.current) return;
      const k = STEPS[i % STEPS.length];
      playAnimation(sprite, char, k);
      timerRef.current = setTimeout(() => { i++; step(); }, holdFor(k) + 50);
    };
    step();
  }

  if (!CHARACTERS[characterId]) return null;
  return (
    <div ref={containerRef} className="char-preview-canvas" style={{ width, height }}>
      {error && <div className="char-preview-error">{error}</div>}
    </div>
  );
}
