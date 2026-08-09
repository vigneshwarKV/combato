# Arena rendering glitch — investigation notes

**Date:** 2026-08-08, updated 2026-08-09 · **Branch:** master · **Status:** **two
root causes found and fixed — see §0 and §0.1.** Both are Pixi v8 global-state
bugs triggered by destroying one `Application` while others are alive. Fix #1 is
a one-line argument change; fix #2 is backported in `src/engine/pixiPatches.js`
because the pixi release that fixes it upstream breaks `@pixi/spine-pixi`
(§0.2). **Not yet browser-validated — work the §0.3 checklist.** The §4
fixes below are still correct, but they addressed a *different* failure mode
(context eviction) than the one that actually produced the reports.

Read this first if the "fighters disappear mid-fight" reports come back. It
records what was measured, what was fixed, **what was ruled out**, and how to
re-run every measurement.

---

## 0. ROOT CAUSE — `destroyApp` passed Pixi v7's argument to a v8 API

**One character of API drift.** `spritePlayer.js`'s `destroyApp` called:

```js
app.destroy(true, options);        // v7 semantics: "removeView"
```

In **Pixi v7** the first argument was `removeView: boolean`. In **Pixi v8** it is
`RendererDestroyOptions`, and `AbstractRenderer.destroy` reads a literal `true`
as **`releaseGlobalResources`**:

```js
// node_modules/pixi.js/lib/rendering/renderers/shared/system/AbstractRenderer.mjs:250
if (options === true || (typeof options === 'object' && options.releaseGlobalResources)) {
  GlobalResourceRegistry.release();
}
```

`GlobalResourceRegistry.release()` clears state that is **module-global, not
per-renderer**: the `Batch` pool in `rendering/batcher/shared/Batcher.mjs`, plus
`BigPool`, `TexturePool`, `CanvasPool` and the canvas texture cache. So
destroying *any one* Application on the page wiped shared GPU bookkeeping out
from under **every other Application still alive**.

### Why it corrupts a renderer that was never touched

`batchPool` is a plain module-level array, and `batchPool.length` never shrinks —
every `Batch` a batcher has ever used stays reachable from that array, including
the ones a live batcher is *currently* holding in `this.batches[]`.
`release()` iterates the whole array and calls `destroy()` on all of them,
nulling `textures`, `bindGroup` and `batcher`. Then, on the surviving renderer:

1. `Batcher.begin()` hands its now-destroyed batches back to the pool.
2. `Batcher.break()` pulls one out and does `batch.textures.clear()` →
   **`Cannot read properties of null (reading 'clear')`**.
3. Instructions still reference nulled batches → `draw()` reads
   **`null.topology` / `null.instanceCount`**.
4. Index/attribute buffers desync → **`glDrawElements: Insufficient buffer size`**,
   flooding until "too many errors".

That is the reported console output, in order. It also explains the two details
that never fit the context-eviction theory: **two different GL context IDs
erroring at once** (the corruption is in shared state, not one context), and
fighters rendering as **torn garbage** rather than merely freezing.

### Trigger

Navigating between surfaces that each own an Application — Settings ⇄ Quick
Fight, roster ⇄ arena. Every navigation destroys one app and poisons the rest.
Rare on localhost only because it needs a second renderer alive at the moment of
teardown; production's warm asset cache changes the mount timing that makes the
overlap likely.

### Fix

```js
app.destroy({ removeView: true }, options);
```

An options *object* fails the `releaseGlobalResources` test while still
detaching the canvas, scoping teardown to that renderer. Single call site —
`destroyApp` in `src/engine/spritePlayer.js` — used by both `ArenaStage` and
`CharacterPreview`.

> **Never pass a bare `true` as the first argument of `Application.destroy`.**
> Pixi's own JSDoc still documents it as "Removes the canvas element" and does
> not mention the global release, so this reads as correct at every call site.

### Verified

Reproduced against real Pixi functions (no browser): a live `Batcher` whose
batch is destroyed by `release()` throws the exact production message on its
next `break()`. Confirmed `{removeView:true}` does not trigger the release path.

**This fixed the `break()`/`clear()` crash and the `Insufficient buffer size`
flood, but not the whole failure** — see §0.1.

---

## 0.1 ROOT CAUSE (second, independent) — Pixi 8.13 double-returns batches

After §0 shipped, the arena still died, but with a **strictly smaller** error
set: the `break()` → `clear()` crash and the `glDrawElements` flood were gone,
leaving only two errors inside `draw()`:

```
Cannot read properties of null (reading 'instanceCount')
Cannot read properties of null (reading 'topology')
```

The production chunk hash matched a local build, so the minified offsets decode
directly. `index-*.js:2162:14466` is `GlGeometrySystem.draw`:

```js
draw(e, t, n, r) {
  let { gl: i } = this._renderer,
      a = this._activeGeometry,     // ← null
      o = eg[e || a.topology];      // col 14466
  if (r ??= a.instanceCount, …)     // col 14485
```

So a draw call was issued with **no geometry bound**.

### The bug

`Batcher.begin()` returns batches to the shared pool using `batchIndex`.
`Batcher.destroy()` uses `batches.length` — and `batches` only ever grows
(`_finishBatch` does `this.batches[this.batchIndex++] = batch`). Every slot past
`batchIndex` was **already returned by the last `begin()`**, so `destroy()`
returns it a second time:

```js
// 8.13.0 — Batcher.mjs
destroy() {
  for (let i = 0; i < this.batches.length; i++) returnBatchToPool(this.batches[i]);
```

A `Batch` sitting in the pool twice is handed to **two** batchers. The second
rewrites it through `_finishBatch`, including `batch.action`, which flips
`'startBatch'` → `'renderBatch'`. `BatcherPipe.execute` only calls
`_adaptor.start()` — the thing that does `geometry.bind()` — for `'startBatch'`:

```js
execute(batch) {
  if (batch.action === 'startBatch') { … this._adaptor.start(this, geometry, shader); }
  this._adaptor.execute(this, batch);   // → geometry.draw() with _activeGeometry === null
}
```

Same trigger as §0: `BatcherPipe.destroy()` → `Batcher.destroy()` runs on **every
Application teardown**, poisoning the module-global pool for every Application
still alive.

### Fix — backported, because the version that fixes it breaks Spine

Pixi's changelog lists **"Batch pool double-return prevention" in v8.15.0**, and
8.15+ loops `i < this.batchIndex`. **We cannot take that version** — see §0.2.
The fix is backported in `src/engine/pixiPatches.js` (`applyPixiPatches()`,
called at the top of `main.jsx` **before any Application is constructed**):
truncate `batches.length` to `batchIndex`, making 8.14's loop identical to
8.15's. It no-ops on any version that already iterates `batchIndex`.

### Verified

`batches.length` is 3 while `batchIndex` is 1 → the 8.13 `destroy()` re-pools 3
(2 duplicates); 8.19 re-pools exactly 1. Confirmed by reading both versions'
`Batcher.mjs` side by side.

---

## 0.2 The pixi.js upgrade — 8.13.0 → **8.14.0**, and why it stops there

The intent was 8.19.0, to pick up §0.1's fix at source. **8.19.0 was installed,
built, and reverted**: it breaks `@pixi/spine-pixi`. Settled on **8.14.0**, the
newest spine-compatible release, pinned **exactly** (`"pixi.js": "8.14.0"`, no
`^`), with §0.1 backported.

### 🚫 The blocker — pixi ≥ 8.15.0 cannot load a Spine character

```
[ArenaStage] init failed: TypeError:
  Cannot read properties of undefined (reading 'autoGarbageCollect')
    at loadSpine (spritePlayer.js:42)
```

8.15.0's unified GCSystem added this to `ViewContainer`'s constructor —
**without defaulting `options`**:

```js
// pixi.js/lib/scene/view/ViewContainer.mjs:24  (8.15.0 → 8.19.0)
constructor(options) {
  …
  this.autoGarbageCollect = options.autoGarbageCollect ?? true;   // options is undefined
```

`@pixi/spine-pixi@2.1.1` — the **latest published release** — has
`class Spine extends ViewContainer` whose constructor calls a **bare `super()`**.
So `Spine.from()` throws on every pixi ≥ 8.15.0.

| pixi | reads `options.autoGarbageCollect` | Spine |
|---|---|---|
| 8.13.0, **8.14.0** | no | ✅ works |
| 8.15.0 – 8.19.0 | yes, undefaulted | ❌ throws |

The cruel part: **8.15.0 is both the release that fixes §0.1 and the release
that breaks Spine.** There is no version pair that has both, so §0.1 stays
backported.

**To revisit:** watch for a `@pixi/spine-pixi` release that passes options to
`super()` (or a pixi release that defaults `options`). Then delete
`src/engine/pixiPatches.js`, drop its `main.jsx` call, and move to 8.15+.
Re-run the §0.2 audit below before doing so — it was written against 8.19.0 and
still holds.

### Why 8.14.0 is safe — audit performed

8.14.0 has **no breaking changes at all** (per its release notes) and adds
"draw call skipped when `instanceCount < 1`", which touches the §0.1 crash path.
The audit below was run against 8.19.0, so it covers 8.14 a fortiori.

Every breaking change in 8.14–8.19 was checked against actual usage. The
codebase imports pixi as `import * as PIXI` in 6 files, and the **entire** API
surface it touches is:

`Application` · `Assets(.load/.get/.cache)` · `Ticker.shared` · `AnimatedSprite`
· `Sprite` · `Graphics` · `Texture(.EMPTY)` · `UPDATE_PRIORITY.LOW`

| Breaking change | Version | Applies? |
|---|---|---|
| `Container.updateTransform({scaleX:0})` literal zero | 8.19 | no — unused |
| `ParticleContainer` inherits ancestor blend modes | 8.19 | no — unused |
| `FillPattern` gains `textureSpace`, defaults `'global'` | 8.19 | no — fills are solid colour only (`fill({color, alpha})`) |
| Text width reporting for word-wrapped text | 8.18 | no — no `Text` |
| `BlurFilter` new halving scheme | 8.17 | no — no filters |
| Text `align:'justify'`, HTMLText `breakWords` | 8.17 | no |
| SplitText / BitmapText / HTMLText changes | 8.16 | no |
| `Container.cullArea` now local-space | 8.16 | no — unused |
| `TextureGCSystem`/`RenderableGCSystem` deprecated → unified `GCSystem` | 8.15 | no — never referenced, and no GC options passed to `app.init()` |

**`@pixi/spine-pixi@2.1.1`** (already the latest release) peers `^8.4.0`. It is
the real risk surface — it imports **32 symbols** from pixi including internals
(`Batcher`, `compileHighShaderGlProgram`, `generateTextureBatchBit`,
`getBatchSamplersUniformGroup`, `collectAllRenderables`, `ViewContainer`) and
**subclasses `Batcher`**. Checked:

- all 32 symbols still exported by 8.19 ✓
- `Batcher`'s constructor is byte-identical between 8.13 and 8.19 ✓
- 8.19's `Batcher.destroy()` calls `this.geometry.destroy(true)`; spine's
  subclass does define its own `geometry` (and `shader`) ✓
- 8.19's `Batcher.destroy(options)` destroys the shader only when
  `options.shader` is set, and `BatcherPipe.destroy()` calls it with **no
  arguments** — so spine's *module-level singleton* shader is not destroyed.
  Worth re-checking on any future upgrade: if that ever changes, tearing down
  one Application would destroy the shared spine shader and reintroduce exactly
  the §0/§0.1 class of cross-Application bug ✓

### Fixes gained — and forfeited

Gained at 8.14.0:

| Version | Fix | Relevance |
|---|---|---|
| 8.14.0 | draw skipped when `instanceCount < 1` | the §0.1 `draw()` crash path |
| 8.14.0 | `childrenRenderablesToUpdate` index validation during render | render-loop correctness |
| 8.14.0 | accessibility div recycling from object pools | pool hygiene |

**Forfeited** until the Spine blocker clears — all of these are relevant to the
crashes in §0/§0.1, which is what makes the blocker annoying rather than
academic:

| Version | Fix |
|---|---|
| 8.15.0 | batch pool double-return (= §0.1; backported instead) |
| 8.16.0 | VAO cache preservation in `GlGeometrySystem` |
| 8.17.0 | BindGroup crash when a resource is destroyed in a batched group |
| 8.17.0 | `Renderer.destroy()` `removeAllListeners()` behaviour |
| 8.15.0 | unified `GCSystem`, explicit `unload()` — GPU memory on mobile/iOS |

### `{ removeView: true }` is still required

`AbstractRenderer.destroy`'s `releaseGlobalResources` behaviour is **unchanged**
in 8.19 (still `AbstractRenderer.mjs:250`). §0's fix is not made redundant by
the upgrade — keep it.

### Not validated

Build passes; lint problem count is identical to baseline (359 pre-existing,
none in touched files); the bundle was confirmed to contain 8.14.0, the
backport, and §0's `removeView`. **No browser run was performed** beyond the
8.19.0 attempt that surfaced the Spine blocker. Chunk names changed with the
version bump, so old stack-trace chunk hashes no longer apply. See §0.3.

---

## 0.3 Post-upgrade validation checklist

Run with `?debug=gl` and the console open:

1. **Settings ⇄ Quick Fight, ~10 round trips** — the original trigger. Console
   must stay free of `topology` / `instanceCount` / `clear` nulls and
   `glDrawElements` errors.
2. **A full bot match**, both spine and PNG fighters, through to KO.
3. **Roster grid** — spine previews animate; PNG tiles still use `<img>`
   (no new WebGL contexts; §4.1).
4. **Character carousel on `/setup`** — step quickly through all fighters,
   watch for §8's duplicate-sprite report.
5. **Projectiles / shields / slot tints** — these drive `app.ticker` and
   `Spine` slot mutation, the least standard part of the integration.
6. **`/dev?debug=gl&stress=100&hold=60`** — ticker listeners must return to
   baseline after every unmount (§7).
7. **iOS Capacitor build** — tightest context budget, and where the reports
   originated.

---

## 1. The original reports

- Arena "glitches" during tournaments, typically after several matches.
- Seen on iOS; reproduced once on Mac Chrome.
- Not reliably reproducible by hand.

Two screenshots. In both, the DOM layers render perfectly — arena background
(a CSS `background-image` div), HP/super bars, timer, and the `DEFEND LOW` /
`SHOOT` action labels — while **the fighters are absent**. The fight is clearly
still running: timer counts down, HP drops, super meters fill.

## 2. Why that screenshot is diagnostic

The arena is a hybrid. **Fighters are the only thing drawn by the PIXI/WebGL
canvas (`ArenaStage`); everything else is DOM.** So a failure confined to the
canvas produces exactly that picture.

It also rules things out. `Arena.jsx` gates the host's `startFight()` on
`stageReady`, which only fires at the end of a *successful* `ArenaStage` init,
and an init throw paints a visible red "Stage load failed". Since the fight was
running and no error was shown, **init succeeded and then the canvas died** —
so "assets hadn't finished downloading" is not the direct cause.

Every fighter visible across the screenshots (Skater Kid ×2, Woman Hero, Iron
Turtle) is one of the four `renderMode: 'spine'` characters. No PNG fighter
appears. Possibly selection bias, but worth re-checking on any new report.

## 3. What was measured

Driven with Playwright against `npm run dev` + the `?debug=gl` overlay.

| Measurement | Before | After |
|---|---|---|
| Live WebGL contexts on `/bot` | **13** | **4** |
| Extra contexts needed before Chrome evicted one of the page's own | **4** | **>8** (none evicted) |
| Orphaned `Spine` on `PIXI.Ticker.shared` after 100 mount/unmount cycles | **6**, permanent | **0** |
| Arena after a browser-initiated context loss | dead, frozen canvas | **self-rebuilds**, fighters healthy |
| Spurious `[ArenaStage] init failed` in console | present | gone |

### The key finding: contexts are evicted silently

`/bot` held **13 live WebGL contexts** — one `PIXI.Application` per
`CharacterPreview` in the roster grid. Chrome's per-page cap is **16**. Adding
a 4th extra context made Chrome **kill one of the page's own** — no exception,
no console warning, and the app's own accounting still reported all 13 as live.

`pixi.js@8.13.0` only auto-restores a context loss **it forced itself**
(`GlContextSystem.handleContextLost` checks `_contextLossForced`), so a
browser-initiated eviction was permanent. Nothing in `src/` listened for
`webglcontextlost`. **iOS caps far below 16 and is memory-driven**, which is the
most plausible reason friends hit this there and we rarely did on desktop.

---

## 4. Fixes applied

### 4.1 PNG previews no longer cost a WebGL context — `src/components/CharacterPreview.jsx`

Split into `SpinePreview` (PIXI, unchanged) and `FramePreview` (a plain `<img>`
frame swapper). PNG fighters are just frame sequences and never needed a
renderer. The public API is identical, so all call sites are untouched:
`BotMatchPage`, `ChampionView`, `DesignKit`/`SlotSprite` (lobby slots),
`CharSelectPage`.

**This is the fix that matters most** — it took `/bot` from 13 contexts to 4
and moved the page well clear of the cap.

> Treat live WebGL context count as a hard budget. Do not add per-item
> `PIXI.Application`s (previews, thumbnails, lobby slots).

Note: `FramePreview` only preloads action frames once a tile is actually
animating (`mode === 'actions'`). Preloading on mount fired several hundred
image requests at once on the roster grid.

### 4.2 The arena survives a lost context — `src/components/ArenaStage.jsx`

A `webglcontextlost` handler (`onContextLost`, ~line 117) calls
`preventDefault()` and bumps `rebuildKey`, which re-runs the init effect and
builds a fresh renderer. Textures are still in `spritePlayer`'s `frameCache` /
`PIXI.Assets`, so only the GPU upload repeats. Capped at
`MAX_CONTEXT_REBUILDS = 3`, after which it shows a visible error rather than a
silent blank. The handler ignores losses caused by our own teardown.

### 4.3 Orphaned Spine skeletons — `src/components/ArenaStage.jsx`

`Spine` registers itself on the **global** `PIXI.Ticker.shared` at construction
(`autoUpdate` defaults true); only `destroy()` removes it. The
`if (cancelled) return;` after `loadFighterSprite` abandoned already-constructed
sprites, so they ticked for the rest of the session. Both abort paths now call
`destroyFighterSprite`, and the effect cleanup destroys the fighters explicitly
before `destroyApp` — a sprite that never got parented isn't a stage child, so
`app.destroy({children:true})` alone would miss it.

### 4.4 Idempotent teardown — `src/engine/spritePlayer.js`

`destroyApp(app, options)` destroys a PIXI Application at most once. The several
abort paths could each reach a destroy; the second threw on an already-nulled
renderer, and the throw surfaced as a misleading `[ArenaStage] init failed`.

---

## 5. Ruled out — don't re-tread these

- **"Assets hadn't downloaded."** A full preloader already exists
  (`src/engine/assetPreloader.js`, `AssetPreloadModal.jsx`, `public/sw.js`), and
  the screenshots show a failure *after* init succeeded. Adding more preloading
  would not have fixed this.
- **The orphaned-Spine leak is not the cause.** It's real and now fixed, but it
  **plateaued** rather than growing (100 cycles ended at the same 6 orphans as
  20 — it saturates once the asset cache warms), and `ticker throws` stayed **0**
  in every run. The theory that one throwing orphan starves later ticker
  listeners was **not** observed.
- **`stageScale` collapse is weak.** `Arena.jsx` does mix coordinate spaces —
  `padBottom` comes from `window.innerHeight` but is subtracted from the wrapper's
  `clientHeight` — but working the arithmetic through, the worst realistic
  landscape viewport lands near `s ≈ 0.35`. That makes fighters *small*, not
  *absent*. Reasoning only; not measured (couldn't drive the bot match to the
  arena under automation).
- **Do not revive the shared-`PIXI.Application` approach** from commit `e2bc366`
  (reverted 51 minutes later by `7589889`). Its cleanup used
  `app.stage.removeChildren()` **without destroying the children**, which would
  orphan Spine instances on *every* match — strictly worse than the bug in §4.3.

---

## 6. Still open

- ~~**The exact symptom was never reproduced.**~~ **Closed by §0.** The gap
  between "frozen" (forced context loss) and "gone / torn" (the screenshots) was
  the tell that this was never a context-loss bug: it was shared batcher state
  being destroyed under a live renderer.
- **Nothing was tested on iOS**, which is where the reports came from and where
  the context cap is tightest. Worth a Capacitor build with the overlay on.
- **The preloader still never runs on the tournament or bot path.**
  `preloadAll()` is called from exactly one place, `CharSelectPage.jsx:151`.
  `HomePage.jsx` navigates straight to `/room/:code` once a profile exists in
  localStorage, so a returning player never visits `/setup` and nothing is
  preloaded. Real bug, separate from this one.
- **Spectator timers are unguarded.** `useFightRenderer.js` has ~8 `setTimeout`
  sites with no generation guard and no `clearTimeout` (the host path in
  `useFight.js` *is* guarded). They `flushSync(dispatch)` into a dead reducer
  after unmount. Every non-fighting client runs this every match.
- **`Arena.jsx` uses `h-screen` (`100vh`) with no `dvh` fallback**, while every
  other full-viewport surface uses `100dvh` (`src/styles/mobile.css:1276`). A
  candidate for the *first* screenshot (header strip only, dead space below).

---

## 7. How to reproduce and measure

### Diagnostics overlay
Add `?debug=gl` to any URL. Shows live PIXI app count, `PIXI.Ticker.shared`
listeners broken down by owner class, ticker throws, **unexpected** vs
own-destroy context losses, `stageScale` inputs, and a per-second fighter probe
(visible / scale / parented / `gl.isContextLost()`).

The flag persists in `localStorage` (`pk.debugGl`); `?debug=off` clears it.
**`COPY` dumps a ring buffer** — send a player a `?debug=gl` link and have them
tap it when the glitch hits. That is the fastest route to closing §6's first gap.

Console API: `window.__pkDebug` → `report()`, `copy()`, `headroom()`,
`killContext()`.

### Stress harness
```
/dev?debug=gl&stress=100&hold=60          # 100 arena mount/unmount cycles
/dev?debug=gl&stress=20&hold=1500&pool=all
```
`hold` randomises how long each mount lives, so some unmounts land mid-
`loadFighterSprite` — the window that strands sprites. A fixed hold misses the
race entirely, which is why this is hard to hit by hand. Source:
`src/components/StressHarness.jsx`.

**Pass condition:** ticker listeners return to baseline after every unmount and
stay flat across the run.

### StrictMode
`?strict=1` wraps the app in `<StrictMode>` (absent by default). The double-mount
forces the unmount-during-async-init races. Worth enabling permanently at some
point — its absence is why these never surfaced in development.

### Forcing a context loss
```js
document.querySelector('canvas').getContext('webgl2')
  .getExtension('WEBGL_lose_context').loseContext();
```
**Pass condition:** the arena rebuilds itself and the fight continues.

### Proving eviction
```js
const junk = [];
for (let i = 0; i < 8; i++) junk.push(document.createElement('canvas').getContext('webgl2'));
```
Then check the overlay's "gl lost (unexpected)" counter. Before the fix, 4 extra
contexts were enough to kill one of the page's own.

---

## 8. Follow-up: duplicate character on `/setup` (spine only, intermittent)

**Report:** occasionally the setup page shows the same spine fighter twice — e.g.
a turtle appearing where another fighter should be. Only spine characters.
Not reproducible on demand.

### Ruled out: atlas filename collision

This is the tempting explanation, because the spine packs **do** reuse page
image filenames:

| character | atlas | page image |
|---|---|---|
| skater | `CharacterAnim.atlas` | `CharacterAnim.png` |
| monkey | `CharacterAnim.atlas` | `CharacterAnim.png` |
| turtle | `Character_Anim.atlas` | `Character_Anim.png` |
| womanHero | `Character_Anim.atlas` | `Character_Anim.png` |

**It is not the cause.** `atlasLoader.mjs` resolves page images against
`path.dirname(options.src)`, so each becomes a distinct absolute URL, and
`Spine.from` keys its `SkeletonData` cache on `${skeleton}-${atlas}-${scale}` —
also full URLs. Verified empirically by loading all four concurrently through
the real `loadSpine` path: distinct bone counts (23/54/41/37), distinct
animation counts, distinct atlas page labels, **distinct GPU texture uids**.
No sharing anywhere. Don't spend time here again.

### Actual defects found (fixed, but not proven to be the cause)

`CharacterPreview`'s spine path keeps per-run state in refs that every effect
run overwrites, while its init is `async`. The carousel is where that bites:
`<FighterStage char={fighter} />` had **no `key`**, so React reused one
`SpinePreview` instance and just swapped `characterId` — meaning run N+1's refs
were live while run N's async work was still in flight.

1. **Animation loop never stopped.** `startCycle`'s `step()` checked
   `cancelTokenRef.current.cancelled` — the *shared* ref, reassigned on every
   character switch. A loop started for turtle checked womanHero's fresh token,
   saw `cancelled === false`, and kept driving turtle's destroyed sprite for the
   life of the component. Fixed by passing the owning run's token into
   `startCycle` explicitly.
2. **Cross-sprite reposition.** `recenter` read `spriteRef.current` instead of
   its own `sprite`, so a queued `rAF` could reposition the *new* character's
   skeleton using the *old* run's `width`/`height`. Fixed to use the local.
3. **Missing `key` on the carousel** (`CharSelectPage.jsx` ~308 and ~419). Added
   `key={fighter.id}` so React remounts instead of reusing — this removes the
   whole class of cross-run races rather than patching instances of it.
4. **`destroyApp` flag ordering** (`spritePlayer.js`) — it marked the app
   destroyed *before* attempting, so a destroy that threw (called before
   `init()` resolved) permanently blocked the real one, leaking the Application
   and its WebGL context. Now the flag is only set on success.

### Status

**Not reproduced.** 12 rounds of frantic carousel stepping under Playwright
produced no mismatch, before or after the fixes; captured cards always matched
their labels. The four defects above are real and worth fixing on their own
merits, but none is confirmed to produce a *duplicate character image* — the
mechanism from "stale loop / stale reposition" to "wrong sprite drawn" is not
established. If it recurs, get a `?debug=gl` COPY dump at the moment it shows,
and check whether the tile has more than one `<canvas>` in it.

## 9. Files

| File | Role |
|---|---|
| `src/engine/glDebug.js` | Diagnostics core. Inert unless `?debug=gl`. |
| `src/components/GlDebugOverlay.jsx` | On-screen readout + COPY button. |
| `src/components/StressHarness.jsx` | `/dev?stress=N` mount/unmount harness. |
| `src/components/CharacterPreview.jsx` | Renderer split (§4.1). |
| `src/components/ArenaStage.jsx` | Context-loss recovery + sprite cleanup (§4.2, §4.3). |
| `src/engine/spritePlayer.js` | **`destroyApp` — root-cause fix #1 (§0)** + idempotent teardown (§4.4). |
| `src/engine/pixiPatches.js` | **Root-cause fix #2 (§0.1)** — backported pixi 8.15 `Batcher.destroy` bound. |
| `package.json` | **`pixi.js` pinned exactly at `8.14.0`** — max version compatible with Spine (§0.2). |
| `src/components/Arena.jsx` | `recordStageScale` instrumentation only. |
| `src/main.jsx` | `initGlDebug`, `?strict=1`. |
