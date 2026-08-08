// Up-front asset preloader.
//
// Problem: fight assets (sprite frames, spine atlases, shields, backgrounds,
// effects, sounds) were fetched lazily the first time each was used mid-fight,
// causing visible stutter as textures were downloaded AND uploaded to the GPU.
//
// Fix: warm everything a fight can need BEFORE the first match, through the
// engine's own loaders so PIXI's texture cache + spritePlayer's frame/spine
// caches + soundEngine's raw-clip cache are all hot. By fight time every
// lookup is a synchronous cache hit — no network, no decode hitch.
//
// Pairs with public/sw.js (cache-first on /assets) so a page RELOAD re-warms
// the in-memory caches from the Service Worker cache instead of re-downloading.
//
// The caller (CharSelectPage) passes which characters to preload — typically
// the playable roster — so this module stays free of UI-roster concerns.

import * as PIXI from 'pixi.js';
import { loadManifest, loadFrames, preloadSpineAssets } from './spritePlayer.js';
import { prefetchClipBytes } from './soundEngine.js';
import { COMBAT_SOUND_FILES } from './combatSounds.js';
import { CHARACTERS } from '../data/characters.js';

// Full-scene battle backgrounds (see ArenaBackground.jsx).
const BACKGROUND_URLS = Array.from(
  { length: 7 },
  (_, i) => `/assets/backgrounds/PNG/game_background_${i + 1}.png`,
);

// Projectiles, jetpack flames, smoke puffs and elemental arrows (see
// ArenaStage.jsx). Per-character projectile overrides are folded in from the
// roster below, so this is just the shared set.
const EFFECT_URLS = [
  '/assets/effects/Bullets.png',
  '/assets/effects/FireArrow.png',
  '/assets/effects/IceArrow.png',
  '/assets/effects/JetPackFire1.png',
  '/assets/effects/JetPackFire2.png',
  '/assets/effects/JetPackFire3.png',
  '/assets/effects/Smoke01.png',
  '/assets/effects/Smoke02.png',
  '/assets/effects/Smoke03.png',
  '/assets/effects/Smoke04.png',
  '/assets/effects/smokejet01.png',
  '/assets/effects/smokejet02.png',
  '/assets/effects/smokejet03.png',
  '/assets/effects/smokejet04.png',
  '/assets/effects/monkey-spear.png',
  '/assets/effects/projectile.png',
  '/assets/effects/spear.png',
];

const MUSIC_URL = '/assets/sound/game_theme.mp3';

let preloadDone = false;

// True once a full preloadAll() has completed this page-load. Resets on reload
// (module state is gone) — but the Service Worker serves the bytes from cache,
// so the re-run is fast.
export function isPreloaded() { return preloadDone; }

// Build the flat task list. Each task is one cache-warming unit:
//   - one PNG animation folder (loadFrames pulls all its frames in parallel)
//   - one Spine skeleton+atlas
//   - one shield / background / effect / projectile image
//   - one sound clip's bytes
// total = tasks.length drives the progress bar. Fetching the PNG manifests up
// front is what lets us count frame-folder tasks before loading them.
//
// `backgrounds`, `sounds` and `imagesFirst` are narrowed by the pre-fight warm-up
// below, which wants the same character machinery but only one background, no
// audio, and the small images fetched ahead of the bulky frame folders.
// Effects are always included — the whole folder is ~140 KB.
async function buildTasks(characters, { backgrounds = BACKGROUND_URLS, sounds = true, imagesFirst = false } = {}) {
  const frameTasks = [];
  const imageUrls = new Set([...backgrounds, ...EFFECT_URLS]);

  for (const c of characters) {
    if (!c) continue;

    if (c.renderMode === 'spine') {
      frameTasks.push({ label: `${c.id} (spine)`, run: () => preloadSpineAssets(c) });
    } else {
      const manifest = await loadManifest(c);
      // Only the folders an action actually maps to — skips non-animation
      // manifest entries (e.g. raw "Character_Parts_Spriter" part atlases).
      const folders = [...new Set(Object.values(c.animations || {}))];
      for (const folder of folders) {
        const files = manifest.animations?.[folder];
        if (!files) continue;
        frameTasks.push({ label: `${c.id}/${folder}`, run: () => loadFrames(c, folder, files) });
      }
    }

    // Combined character+shield PNGs (only characters that opt into combinedDefend).
    if (c.combinedDefend) {
      imageUrls.add(`/assets/shields/${c.id}/shield_front.png`);
      imageUrls.add(`/assets/shields/${c.id}/shield_top.png`);
    }
    // Per-character projectile overrides.
    if (c.projectile) imageUrls.add(c.projectile);
    if (c.hitProjectile) imageUrls.add(c.hitProjectile);
  }

  const imageTasks = [...imageUrls].map(url => ({ label: url, run: () => PIXI.Assets.load(url) }));

  // Sound bytes (combat SFX + theme). Decode happens later on the first user
  // gesture — here we only need the bytes downloaded + cached.
  const soundTasks = sounds
    ? [...new Set([...Object.values(COMBAT_SOUND_FILES), MUSIC_URL])]
        .map(url => ({ label: url, run: () => prefetchClipBytes(url) }))
    : [];

  return imagesFirst
    ? [...imageTasks, ...frameTasks, ...soundTasks]
    : [...frameTasks, ...imageTasks, ...soundTasks];
}

// Run a task list with `concurrency` lanes, reporting (done, total).
async function runTasks(tasks, { onProgress, signal, concurrency }) {
  const total = tasks.length || 1;
  let completed = 0;
  onProgress?.(0, total);

  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const task = tasks[next++];
      try {
        await task.run();
      } catch (err) {
        console.warn('[assetPreloader] failed to preload', task.label, err);
      }
      completed++;
      onProgress?.(completed, total);
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, tasks.length));
  await Promise.all(Array.from({ length: lanes }, worker));
}

// Preload every fight asset for `characters`, reporting progress as (done, total).
//
// Individual task failures (e.g. a missing shield_top.png) are swallowed and
// still count toward progress, so one stray 404 can't wedge the bar — a missing
// asset simply falls back to the old lazy load at fight time. Aborts cleanly via
// `signal` (used by the "Continue anyway" / unmount paths).
export async function preloadAll({ characters = [], onProgress, signal, concurrency = 8 } = {}) {
  if (preloadDone) { onProgress?.(1, 1); return; }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  const tasks = await buildTasks(characters);
  await runTasks(tasks, { onProgress, signal, concurrency });
  preloadDone = true;
}

// ── Pre-fight warm-up ───────────────────────────────────────────────────────
//
// The home page and the how-to-play tour both run the REAL arena components, and
// both are reached long before the setup screen's preload gate — so their assets
// used to stream in action by action, and the first defend / ultimate of a
// session hitched. (The defend hitch was worse than a hitch: see
// showCombinedDefend in ArenaStage.)
//
// This warms only the fixed cast those two screens use — ~22 MB, against ~90 MB
// for the whole roster — so it can run unblocking rather than behind a loading
// screen. It is not extra traffic either: the home arena loops random actions,
// so anyone who lingers there pulls these same bytes anyway. We just fetch them
// earlier, and in a better order. preloadAll() still owns the full download
// before a real match, and this doesn't mark that as done.
//
// Cast (hardcoded in the screens themselves, not player-chosen):
//   home arena      HomeArena.jsx    madScientist vs beast, no background
//   how-to-play     HowToPlay.jsx    turtle vs beast, seeded background
const PRE_FIGHT_CHARACTER_IDS = ['madScientist', 'beast', 'turtle'];

let warmStarted = false;

/**
 * Warm what the pre-match screens draw. Fire-and-forget: resolves when done,
 * never rejects, and is a no-op after the first call (or once preloadAll has
 * already covered everything).
 *
 * @param backgrounds  arena background URLs to include — the caller resolves
 *                     these, since the seed→image mapping lives in the view.
 */
export async function warmPreFightAssets({ backgrounds = [], concurrency = 4 } = {}) {
  if (warmStarted || preloadDone) return;
  warmStarted = true;
  const characters = PRE_FIGHT_CHARACTER_IDS.map(id => CHARACTERS[id]).filter(Boolean);
  try {
    // imagesFirst puts the shields, effects and background (~6 MB, 20-odd files)
    // ahead of the ~16 MB of frame folders. The shields are the urgent ones: a
    // missing frame folder just replays the previous animation, but a missing
    // shield used to blank the fighter out entirely.
    const tasks = await buildTasks(characters, { backgrounds, sounds: false, imagesFirst: true });
    // Lower concurrency than preloadAll: this shares the network with the home
    // arena's own first paint, and finishing fast matters less than not
    // starving it.
    await runTasks(tasks, { concurrency });
  } catch (err) {
    console.warn('[assetPreloader] pre-fight warm-up failed', err);
  }
}
