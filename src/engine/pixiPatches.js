// Backported upstream fix for pixi.js 8.14.0 (the exact version this project
// pins). Must run BEFORE any PIXI.Application is constructed — called at the top
// of main.jsx.
//
// Context: ARENA_RENDER_DEBUG.md §0.1 and §0.2. The bug corrupts state that is
// MODULE-GLOBAL rather than per-renderer, so tearing down one Application
// (navigating Settings ⇄ Quick Fight, roster ⇄ arena) breaks every OTHER
// Application still on the page. Symptom: the arena renders fighters as torn
// garbage or not at all while every DOM layer keeps painting.
//
// WHY THIS ISN'T JUST A VERSION BUMP: pixi fixed it in 8.15.0 — but 8.15.0 also
// added `this.autoGarbageCollect = options.autoGarbageCollect ?? true` to
// `ViewContainer`'s constructor WITHOUT defaulting `options`, and
// @pixi/spine-pixi@2.1.1 (the latest release) calls a bare `super()`. So every
// pixi >= 8.15.0 throws
//   "Cannot read properties of undefined (reading 'autoGarbageCollect')"
// the moment `Spine.from()` runs. 8.14.0 is the newest version compatible with
// spine, so the fix is backported here instead. Revisit if spine-pixi ships a
// release that passes options to super().

import { Batcher } from 'pixi.js';

let applied = false;

/**
 * `Batcher.destroy()` returns batches to the shared, module-global `batchPool`
 * using `this.batches.length` — but `batches` only ever grows (`_finishBatch`
 * does `this.batches[this.batchIndex++] = batch`), while `begin()` correctly
 * returns only `[0, batchIndex)`. Every slot beyond `batchIndex` is one
 * `begin()` ALREADY returned, so `destroy()` returns it a second time.
 *
 * A Batch sitting in the pool twice gets handed to two different batchers. The
 * second rewrites it via `_finishBatch` — including `batch.action`, which flips
 * `'startBatch'` → `'renderBatch'`. `BatcherPipe.execute` only calls
 * `_adaptor.start()` (which does `geometry.bind()`) for `'startBatch'`, so the
 * first batcher then draws with nothing bound:
 *
 *     GlGeometrySystem.draw -> this._activeGeometry is null
 *     -> "Cannot read properties of null (reading 'topology')"
 *     -> "Cannot read properties of null (reading 'instanceCount')"
 *
 * and, when the stolen batch carries the other batcher's start/size, a flood of
 * `glDrawElements: Insufficient buffer size`.
 *
 * Upstream fix (pixi 8.15.0) loops to `this.batchIndex`. Truncating `batches` to
 * `batchIndex` first makes 8.14's `.length` loop identical, and is a no-op on
 * any version that already iterates `batchIndex` — so it stays correct if the
 * spine blocker clears and this project moves to 8.15+.
 */
export function applyPixiPatches() {
  if (applied) return;
  applied = true;

  const originalDestroy = Batcher.prototype.destroy;
  Batcher.prototype.destroy = function patchedBatcherDestroy(...args) {
    if (this.batches && this.batches.length > this.batchIndex) {
      this.batches.length = this.batchIndex;
    }
    return originalDestroy.apply(this, args);
  };
}
