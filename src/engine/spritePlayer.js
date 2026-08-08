// Sprite asset loaders + per-action animation playback for both fight and
// preview surfaces. Pure presentation: knows how to bring a character on screen
// and play named actions, but knows nothing about fighters, opponents,
// projectiles, motion tweens, or the fight loop.
//
// Two render modes:
//   - 'spine' → @pixi/spine-pixi loads skeleton + atlas, animation by name
//   - 'png'   → AnimatedSprite plays frame sequences listed in manifest.json

import * as PIXI from 'pixi.js';
import { Spine } from '@pixi/spine-pixi';

// Caches keyed by character.assetBase so loaders only fire once per character
// across mounts. Display objects are NOT cached (each surface needs its own
// instance) — only URLs, parsed manifests, and decoded textures.
const spineLoaded = new Set();      // assetBase strings
const manifestCache = new Map();    // assetBase → manifest
const frameCache = new Map();       // `${assetBase}/${animName}` → PIXI.Texture[]

export async function loadFighterSprite(character) {
  if (character.renderMode === 'spine') return loadSpine(character);
  return loadPng(character);
}

// Warm the Spine skeleton + atlas (and the atlas' texture pages) into PIXI's
// cache without building a display object. Used by the up-front asset
// preloader; loadSpine() reuses it on the actual mount.
export async function preloadSpineAssets(character) {
  if (spineLoaded.has(character.assetBase)) return;
  const skelUrl = `${character.assetBase}/${character.skeletonJson}`;
  const atlasUrl = `${character.assetBase}/${character.atlasFile}`;
  await PIXI.Assets.load([skelUrl, atlasUrl]);
  spineLoaded.add(character.assetBase);
}

export async function loadSpine(character) {
  await preloadSpineAssets(character);
  const skelUrl = `${character.assetBase}/${character.skeletonJson}`;
  const atlasUrl = `${character.assetBase}/${character.atlasFile}`;
  // Craftpix Spine atlases are sized for high-res — base 0.5 brings them to a
  // comfortable arena size. Per-character displayScale stacks on top via applyScale.
  const spine = Spine.from({ skeleton: skelUrl, atlas: atlasUrl, scale: 0.5 });
  spine.state.setAnimation(0, character.animations.idle, true);
  return spine;
}

// Fetch + cache a PNG character's manifest.json (action folder → frame file
// list). Cached per assetBase so it's fetched once across mounts/preload.
export async function loadManifest(character) {
  let manifest = manifestCache.get(character.assetBase);
  if (!manifest) {
    const res = await fetch(`${character.assetBase}/manifest.json`);
    if (!res.ok) throw new Error(`manifest fetch ${res.status}`);
    manifest = await res.json();
    manifestCache.set(character.assetBase, manifest);
  }
  return manifest;
}

export async function loadPng(character) {
  const manifest = await loadManifest(character);
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

export async function loadFrames(character, folder, files) {
  const key = `${character.assetBase}/${folder}`;
  if (frameCache.has(key)) return frameCache.get(key);
  const resolvedFiles = files ?? manifestCache.get(character.assetBase)?.animations?.[folder];
  if (!resolvedFiles) throw new Error(`No frame list for ${folder}`);
  const urls = resolvedFiles.map(f => `${character.assetBase}/frames/${folder}/${f}`);
  const textures = await Promise.all(urls.map(u => PIXI.Assets.load(u)));
  frameCache.set(key, textures);
  return textures;
}

export function playAnimation(sprite, character, actionKey) {
  // Accept either a known action key (looked up in animations) or a raw
  // animation name — useful for phase2 of multi-phase moves.
  const animationName = character.animations[actionKey] || actionKey || character.animations.idle;
  if (!animationName) return;

  if (character.renderMode === 'spine' && sprite.state) {
    const loop = actionKey === 'idle' || actionKey === 'celebrate';
    try {
      const track = sprite.state.setAnimation(0, animationName, loop);
      if (track) {
        if (actionKey === 'defend_low' || actionKey === 'defend_high') {
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
        const idleH = sprite._loadedAnims.get(character.animations.idle)?.[0]?.height ?? textures[0].height;
        const extraH = textures[0].height - idleH;
        if (extraH > 0) sprite.y += extraH * (character.displayScale ?? 1);
      }
    };
    if (cached) apply(cached);
    else loadFrames(sprite._character, animationName, files)
      .then(textures => { sprite._loadedAnims.set(animationName, textures); apply(textures); })
      .catch(e => console.warn('[spritePlayer] frame load failed:', e));
  }
}

// Per-action slot color tinting + attachment swapping for Spine characters.
// Shoot animations have BOTH rgba and attachment timelines that overwrite our
// edits every frame, so a per-frame ticker is needed to keep the override on.
// Tears down on action change.
export function applySlotTints(sprite, character, actionKey) {
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

export function applyScale(sprite, base, mirrored) {
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

// Detach any per-sprite ticker callbacks (slot-tint enforcer) before the
// owning Application is destroyed. Safe to call on any sprite.
export function destroyFighterSprite(sprite) {
  if (!sprite) return;
  const app = sprite._pixiApp;
  if (sprite._tintTicker && app) {
    try { app.ticker.remove(sprite._tintTicker); } catch { /* ignore */ }
    sprite._tintTicker = null;
  }
  try { sprite.destroy?.({ children: true, texture: false, textureSource: false }); } catch { /* ignore */ }
}

/**
 * Destroy a PIXI Application at most once, and never throw.
 *
 * ArenaStage and CharacterPreview both init their app asynchronously and have
 * several abort paths — React cleanup, a cancelled mount, a failed load — that
 * can each reach a destroy. Whichever runs second used to throw, because
 * Application.destroy dereferences a renderer the first call already nulled.
 * The throw landed in the init catch and logged a spurious "init failed".
 */
export function destroyApp(app, options = { children: true }) {
  if (!app || app.__pkDestroyed) return;
  try {
    app.destroy(true, options);
    app.__pkDestroyed = true;
  } catch {
    // Almost always "destroy before init() resolved" — the renderer isn't there
    // yet. Deliberately leave the flag unset: the init continuation checks its
    // cancelled flag and calls us again, and THAT call must actually run or the
    // Application (and its WebGL context) leaks.
  }
}
