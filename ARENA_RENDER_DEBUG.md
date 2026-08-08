# Arena rendering glitch — investigation notes

**Date:** 2026-08-08 · **Branch:** master · **Status:** failure modes removed, root
cause of the original screenshots not conclusively proven.

Read this first if the "fighters disappear mid-fight" reports come back. It
records what was measured, what was fixed, **what was ruled out**, and how to
re-run every measurement.

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

- **The exact symptom was never reproduced.** A forced context loss *freezes* the
  canvas on its last frame; the screenshots show fighters *absent*. The gap
  between "frozen" and "gone" is unexplained.
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
| `src/engine/spritePlayer.js` | `destroyApp` (§4.4). |
| `src/components/Arena.jsx` | `recordStageScale` instrumentation only. |
| `src/main.jsx` | `initGlDebug`, `?strict=1`. |
