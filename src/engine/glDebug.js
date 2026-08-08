// Renderer diagnostics for the "fighters vanish mid-fight" bug.
//
// The arena is a hybrid: fighters are drawn by one PIXI/WebGL canvas
// (ArenaStage), everything else — background, HP bars, timer, action labels —
// is DOM. Every report of the glitch shows the DOM layers painting fine while
// the fighters are gone, so the failure is confined to the canvas. This module
// exists to tell apart the three ways that can happen:
//
//   1. Nothing is ticking      → orphaned Spine skeletons stranded on the
//                                GLOBAL PIXI.Ticker.shared. Spine registers
//                                itself there at construction (autoUpdate
//                                defaults true) and only destroy() removes it,
//                                so a sprite loaded into a cancelled mount
//                                ticks forever. Watch `tickerListeners` climb
//                                and never fall. Pixi's ticker loop has no
//                                try/catch, so one throwing orphan starves
//                                every listener added after it — watch
//                                `tickerThrows`.
//   2. The context is dead     → browser dropped the WebGL context (limit
//                                eviction / memory pressure). Pixi 8.13 only
//                                auto-restores losses IT forced, so a
//                                browser-initiated loss is permanent silence.
//                                Watch `contextLost`.
//   3. It's drawn at zero size → Arena's stageScale collapsed. Watch the
//                                stageScale sample's inputs.
//
// Everything here is inert unless enabled, and every entry point is wrapped so
// a diagnostic can never be the thing that breaks a fight.

const STORAGE_KEY = 'pk.debugGl';
const RING_MAX = 500;

let enabled = false;
let started = false;

const ring = [];
const subscribers = new Set();

const state = {
  apps: { created: 0, destroyed: 0, live: 0, byLabel: {} },
  ticker: { listeners: 0, byOwner: {}, throws: 0, lastThrow: null, guardMode: 'rethrow' },
  context: { lost: 0, lostExpected: 0, restored: 0, canvasesWatched: 0 },
  stageScale: null,
  fighters: null,
  assets: { duringArena: 0, arenaActive: false, preloadedAtMount: null },
  startedAt: 0,
};

/** `?debug=gl` turns it on and persists; `?debug=off` clears it. */
export function isGlDebugEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('debug');
    if (q === 'gl') { localStorage.setItem(STORAGE_KEY, '1'); return true; }
    if (q === 'off') { localStorage.removeItem(STORAGE_KEY); return false; }
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function now() {
  return Math.round(performance.now());
}

export function logEvent(type, data) {
  if (!enabled) return;
  ring.push({ t: now(), type, ...data });
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

function notify() {
  subscribers.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getSnapshot() {
  return state;
}

// ── PIXI Application accounting ────────────────────────────────────────────
// Both ArenaStage and CharacterPreview route their app through here, so the
// live count is the real number of WebGL contexts this page is holding open.

// Keyed on the Application object, not a label string, so the several
// cancel-and-destroy paths in ArenaStage/CharacterPreview can each call
// untrackApp defensively without double-counting.
const trackedApps = new WeakSet();

export function trackApp(app, label) {
  if (!enabled || !app || trackedApps.has(app)) return app;
  trackedApps.add(app);
  app.__pkLabel = label;
  state.apps.created++;
  state.apps.live++;
  state.apps.byLabel[label] = (state.apps.byLabel[label] || 0) + 1;
  logEvent('app:create', { label, live: state.apps.live });
  notify();
  return app;
}

// Call BEFORE app.destroy(). Pixi's own teardown calls loseContext(), which
// fires webglcontextlost on our canvas — so without this marker every normal
// unmount looks like a browser-initiated context loss and the one number that
// tests the "browser dropped our context" hypothesis is pure noise.
export function untrackApp(app) {
  if (!enabled || !app || !trackedApps.has(app)) return;
  trackedApps.delete(app);
  try { if (app.canvas) selfDestroyed.add(app.canvas); } catch { /* ignore */ }
  const label = app.__pkLabel || 'unknown';
  state.apps.destroyed++;
  state.apps.live = Math.max(0, state.apps.live - 1);
  state.apps.byLabel[label] = Math.max(0, (state.apps.byLabel[label] || 0) - 1);
  logEvent('app:destroy', { label, live: state.apps.live });
  notify();
}

// ── stageScale ─────────────────────────────────────────────────────────────
// Arena computes padBottom from window.innerHeight but subtracts it from the
// wrapper's clientHeight. Logging both is how we see them diverge.

export function recordStageScale(sample) {
  if (!enabled) return;
  state.stageScale = { ...sample, t: now() };
  logEvent('stageScale', sample);
  notify();
}

// ── fighter probe ──────────────────────────────────────────────────────────
// ArenaStage registers a getter; we sample it once a second. Distinguishes
// "scaled to nothing" from "context dead" from "never ticked".

let fighterProbe = null;
export function registerFighterProbe(fn) {
  if (!enabled) return () => {};
  fighterProbe = fn;
  return () => { if (fighterProbe === fn) fighterProbe = null; };
}

export function setArenaActive(active, extra = {}) {
  if (!enabled) return;
  state.assets.arenaActive = active;
  if (active) {
    state.assets.duringArena = 0;
    state.assets.preloadedAtMount = extra.preloaded ?? null;
  }
  logEvent(active ? 'arena:mount' : 'arena:unmount', extra);
  notify();
}

// ── ticker inspection ──────────────────────────────────────────────────────
// Walks PIXI.Ticker.shared's private linked list. `_head` is a sentinel
// TickerListener; each node carries `_fn`, `_context` and `next`.

function ownerName(node) {
  const ctx = node?._context;
  if (ctx && ctx.constructor && ctx.constructor.name) return ctx.constructor.name;
  if (node?._fn?.name) return `fn:${node._fn.name}`;
  return 'anonymous';
}

function sampleTicker(PIXI) {
  const shared = PIXI?.Ticker?.shared;
  if (!shared || !shared._head) return;
  const byOwner = {};
  let count = 0;
  let node = shared._head.next;
  // Bounded walk — a corrupted list must not hang the overlay.
  while (node && count < 5000) {
    count++;
    const name = ownerName(node);
    byOwner[name] = (byOwner[name] || 0) + 1;
    node = node.next;
  }
  const prev = state.ticker.listeners;
  state.ticker.listeners = count;
  state.ticker.byOwner = byOwner;
  if (count !== prev) logEvent('ticker:count', { count, delta: count - prev, byOwner });
}

// Wrap TickerListener.prototype.emit so a throwing listener is recorded rather
// than silently aborting the frame. Default mode rethrows, preserving the exact
// production symptom; 'continue' keeps the chain going so we can see every
// listener despite a bad one.
function installTickerGuard(PIXI) {
  const shared = PIXI?.Ticker?.shared;
  const proto = shared?._head?.constructor?.prototype;
  if (!proto || proto.__pkGuarded) return;
  const original = proto.emit;
  proto.emit = function guardedEmit(ticker) {
    try {
      return original.call(this, ticker);
    } catch (err) {
      state.ticker.throws++;
      state.ticker.lastThrow = {
        owner: ownerName(this),
        message: err?.message || String(err),
      };
      logEvent('ticker:throw', state.ticker.lastThrow);
      if (state.ticker.guardMode === 'continue') return this.next;
      throw err;
    }
  };
  proto.__pkGuarded = true;
}

// ── WebGL context loss ─────────────────────────────────────────────────────
// Nothing in the app listens for these today. Whether they fire is the single
// decisive test for the "browser dropped the context" hypothesis.

const watched = new WeakSet();
// Canvases whose app WE tore down — their context loss is expected, not a
// browser eviction. Populated by untrackApp.
const selfDestroyed = new WeakSet();

function watchCanvas(cv) {
  if (!cv || watched.has(cv)) return;
  watched.add(cv);
  state.context.canvasesWatched++;
  cv.addEventListener('webglcontextlost', (e) => {
    const expected = selfDestroyed.has(cv);
    if (expected) {
      state.context.lostExpected++;
      return;
    }
    // The one that matters: nobody asked for this. Pixi 8.13 will NOT restore
    // it (it only auto-restores losses it forced itself), so this canvas is
    // dead for good.
    state.context.lost++;
    logEvent('gl:lost', { w: cv.width, h: cv.height, defaultPrevented: e.defaultPrevented });
    notify();
  });
  cv.addEventListener('webglcontextrestored', () => {
    state.context.restored++;
    logEvent('gl:restored', {});
    notify();
  });
}

function watchAllCanvases(root) {
  if (!root) return;
  if (root.tagName === 'CANVAS') watchCanvas(root);
  root.querySelectorAll?.('canvas').forEach(watchCanvas);
}

/**
 * Saturation probe: can this page still create a WebGL context? Returns the
 * number of fresh contexts obtainable up to `max`, then releases them. A low
 * number means we are at the browser's per-page cap and the next arena mount
 * is at risk of evicting an older context.
 */
export function probeContextHeadroom(max = 20) {
  const made = [];
  try {
    for (let i = 0; i < max; i++) {
      const cv = document.createElement('canvas');
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      if (!gl) break;
      made.push(gl);
    }
  } catch { /* ignore */ }
  const headroom = made.length;
  made.forEach((gl) => { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ } });
  logEvent('gl:headroom', { headroom, max });
  notify();
  return headroom;
}

// ── asset requests ─────────────────────────────────────────────────────────

function installAssetObserver() {
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.name.includes('/assets/')) continue;
        if (!state.assets.arenaActive) continue;
        state.assets.duringArena++;
        if (state.assets.duringArena <= 20) {
          logEvent('asset:duringFight', { url: entry.name.split('/assets/')[1] });
        }
      }
    });
    po.observe({ type: 'resource', buffered: false });
  } catch { /* ignore */ }
}

// ── diagnostics export ─────────────────────────────────────────────────────

export function buildReport() {
  return {
    ua: navigator.userAgent,
    url: window.location.href,
    uptimeMs: now() - state.startedAt,
    summary: {
      appsLive: state.apps.live,
      appsCreated: state.apps.created,
      appsDestroyed: state.apps.destroyed,
      tickerListeners: state.ticker.listeners,
      tickerByOwner: state.ticker.byOwner,
      tickerThrows: state.ticker.throws,
      lastThrow: state.ticker.lastThrow,
      contextLost: state.context.lost,
      contextLostExpected: state.context.lostExpected,
      contextRestored: state.context.restored,
      stageScale: state.stageScale,
      fighters: state.fighters,
      assetsDuringArena: state.assets.duringArena,
      preloadedAtArenaMount: state.assets.preloadedAtMount,
    },
    log: ring.slice(),
  };
}

export async function copyDiagnostics() {
  const text = JSON.stringify(buildReport(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    console.log('[glDebug] diagnostics:\n', text);
    return 'logged to console';
  }
}

// ── bootstrap ──────────────────────────────────────────────────────────────

export function initGlDebug(PIXI) {
  if (started) return;
  enabled = isGlDebugEnabled();
  if (!enabled) return;
  started = true;
  state.startedAt = now();

  try { installTickerGuard(PIXI); } catch (e) { console.warn('[glDebug] ticker guard failed', e); }
  installAssetObserver();

  watchAllCanvases(document.body);
  const mo = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => { if (n.nodeType === 1) watchAllCanvases(n); });
  });
  mo.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    try {
      sampleTicker(PIXI);
      state.fighters = fighterProbe ? fighterProbe() : null;
      if (state.fighters) logEvent('fighters', state.fighters);
      notify();
    } catch { /* ignore */ }
  }, 1000);

  window.__pkDebug = {
    pixi: PIXI,          // handy for poking at Assets/Cache from the console
    report: buildReport,
    copy: copyDiagnostics,
    headroom: probeContextHeadroom,
    state,
    setTickerGuardMode: (m) => { state.ticker.guardMode = m; },
    // Forces the exact failure mode we're testing for. getContext returns the
    // canvas's EXISTING context, so this kills the live arena renderer.
    killContext: (selector = 'canvas') => {
      const cv = document.querySelector(selector);
      if (!cv) return 'no canvas found';
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      if (!gl) return 'canvas has no webgl context';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return 'context lost';
    },
  };

  console.log('[glDebug] enabled. window.__pkDebug available.');
}
