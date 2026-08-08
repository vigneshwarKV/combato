import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { CHARACTERS } from '../data/characters.js';
import {
  loadFighterSprite,
  loadFrames,
  loadManifest,
  playAnimation,
  applyScale,
  destroyFighterSprite,
  destroyApp,
} from '../engine/spritePlayer.js';
import { ANIM_DURATION } from '../engine/animResolution.js';
import { trackApp, untrackApp } from '../engine/glDebug.js';

const HOLDS = {
  hit: ANIM_DURATION.hit,
  slide: ANIM_DURATION.slide,
  shoot: ANIM_DURATION.shoot,
  ultimate: ANIM_DURATION.ultimate,
};

// Standalone single-character preview. No opponent, no projectiles, no motion
// tweens — just the sprite playing actions so a player can feel the character
// before picking.
//
// `mode`:
//   'idle'    → loop the idle animation.
//   'actions' → cycle hit → slide → shoot → first ultimate → loop. No idle
//               in the sequence.
//
// RENDERER SPLIT — this is a WebGL budget decision, not a style one.
// Every PIXI.Application costs one WebGL context, and browsers cap them per
// page (Chrome 16; iOS lower and memory-driven). Callers fan this component out
// across a whole roster — BotMatchPage renders one per character — so a PIXI app
// per instance put the page at 13 live contexts with the arena still to come.
// Past the cap the browser silently kills the OLDEST context and Pixi 8.13 does
// not restore browser-initiated losses, so the arena canvas dies with no error.
// PNG fighters are just frame sequences, so they render through <img> and cost
// no context at all. Only Spine skeletons actually need a renderer.
export default function CharacterPreview({ characterId, width = 360, height = 420, mode = 'idle' }) {
  const char = CHARACTERS[characterId];
  if (!char) return null;
  return char.renderMode === 'spine'
    ? <SpinePreview characterId={characterId} width={width} height={height} mode={mode} />
    : <FramePreview characterId={characterId} width={width} height={height} mode={mode} />;
}

// Pick the action sequence for 'actions' mode — shared by both renderers so the
// two paths stay in step.
function actionSteps(char) {
  const ultKey = char.ultimates?.[0]?.key ?? null;
  return ['hit', 'slide', 'shoot', ultKey].filter(k => k && char.animations[k]);
}
const holdFor = (char, k) =>
  (k === (char.ultimates?.[0]?.key ?? null) ? HOLDS.ultimate : (HOLDS[k] ?? 800));

// ── PNG fighters: plain <img> frame swapper, zero WebGL contexts ────────────

const FRAME_MS = 80;   // ~12fps, matches the old AnimatedSprite feel closely

function FramePreview({ characterId, width, height, mode }) {
  const char = CHARACTERS[characterId];
  const [manifest, setManifest] = useState(null);
  const [actionFolder, setActionFolder] = useState(null);
  const [frame, setFrame] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadManifest(char)
      .then(m => { if (!cancelled) setManifest(m); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [char]);

  const has = f => !!(f && manifest?.animations?.[f]?.length);
  const idleFolder = has(char.animations.idle) ? char.animations.idle : null;
  // Derived, not stored — idle mode never needs a state write.
  const folder = (mode === 'actions' ? actionFolder : null) ?? idleFolder;

  // 'actions' mode rotates through the action folders, each held for the same
  // duration the PIXI path used. The first step is scheduled rather than run
  // inline so the effect never sets state synchronously.
  useEffect(() => {
    if (!manifest || mode !== 'actions') { setActionFolder(null); return undefined; }
    const steps = actionSteps(char).map(k => ({ k, f: char.animations[k] })).filter(s => has(s.f));
    if (steps.length === 0) return undefined;

    let i = 0;
    let timer = null;
    let cancelled = false;
    const next = () => {
      if (cancelled) return;
      const step = steps[i % steps.length];
      i += 1;
      setActionFolder(step.f);
      timer = setTimeout(next, holdFor(char, step.k) + 50);
    };
    timer = setTimeout(next, 0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, mode, char]);

  // Frame ticker. Idle loops; action folders hold on their last frame until the
  // rotation above swaps them out. The counter lives in the closure and resets
  // naturally when the effect re-runs on a folder change.
  useEffect(() => {
    const files = folder ? manifest?.animations?.[folder] : null;
    if (!files || files.length <= 1) return undefined;
    const isIdle = folder === char.animations.idle;
    let i = 0;
    setFrame(0);
    const id = setInterval(() => {
      i = i + 1 >= files.length ? (isIdle ? 0 : files.length - 1) : i + 1;
      setFrame(i);
    }, FRAME_MS);
    return () => clearInterval(id);
     
  }, [manifest, folder, char]);

  // Warm the action frames so a rotation swap doesn't flash — but ONLY once
  // this tile is actually animating. Doing it on mount would fire a few hundred
  // image requests at once on a full roster grid (9 PNG tiles x ~4 folders x
  // ~8-16 frames), which is worse than the lazy loading the PIXI path did.
  useEffect(() => {
    if (!manifest || mode !== 'actions') return;
    for (const k of actionSteps(char)) {
      const f = char.animations[k];
      (manifest.animations?.[f] || []).forEach(file => {
        const img = new Image();
        img.src = `${char.assetBase}/frames/${f}/${file}`;
      });
    }
  }, [manifest, mode, char]);

  const files = folder ? manifest?.animations?.[folder] : null;
  const src = files?.length ? `${char.assetBase}/frames/${folder}/${files[Math.min(frame, files.length - 1)]}` : null;

  return (
    <div
      className="char-preview-canvas"
      style={{ width, height, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}
    >
      {src && !failed && (
        <img
          src={src}
          alt={char.name}
          draggable="false"
          onError={() => setFailed(true)}
          // Matches the PIXI path's framing: bottom-anchored, ~70% of the box.
          style={{ maxHeight: '78%', maxWidth: '100%', objectFit: 'contain', marginBottom: '8%', display: 'block' }}
        />
      )}
    </div>
  );
}

// ── Spine fighters: one PIXI.Application (one WebGL context) ────────────────

function SpinePreview({ characterId, width, height, mode }) {
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
        trackApp(app, 'CharacterPreview');
        await app.init({ width, height, backgroundAlpha: 0, antialias: true, preference: 'webgl' });
        if (token.cancelled) { untrackApp(app); destroyApp(app); return; }
        containerRef.current.appendChild(app.canvas);

        sprite = await loadFighterSprite(char);
        if (token.cancelled) { destroyFighterSprite(sprite); untrackApp(app); destroyApp(app); return; }
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
            // Use THIS run's sprite, not spriteRef.current — a queued rAF can
            // fire after the component has already switched characters, and
            // would otherwise reposition the NEW sprite using the OLD run's
            // width/height.
            if (token.cancelled || !sprite) return;
            const s = sprite;
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
        startCycle(mode, token);
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
        untrackApp(app);
        destroyApp(app, { children: true, texture: false, textureSource: false });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, width, height]);

  // Mode change effect — swap animation cycle without rebuilding Pixi.
  useEffect(() => {
    if (spriteRef.current && charRef.current) startCycle(mode, cancelTokenRef.current);
     
  }, [mode]);

  // `token` is the cancel token of the run that owns this cycle. It must be
  // passed in, not read from cancelTokenRef at tick time: that ref is
  // reassigned on every character switch, so a stale loop would check the NEW
  // token, see cancelled === false, and keep driving a destroyed sprite for the
  // life of the component.
  function startCycle(currentMode, token) {
    const sprite = spriteRef.current;
    const char = charRef.current;
    if (!sprite || !char) return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    const STEPS = currentMode === 'actions' ? actionSteps(char) : [];

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
    const step = () => {
      if (token?.cancelled || !spriteRef.current) return;
      const k = STEPS[i % STEPS.length];
      playAnimation(sprite, char, k);
      timerRef.current = setTimeout(() => { i++; step(); }, holdFor(char, k) + 50);
    };
    step();
  }

  return (
    <div ref={containerRef} className="char-preview-canvas" style={{ width, height }}>
      {error && <div className="char-preview-error">{error}</div>}
    </div>
  );
}
