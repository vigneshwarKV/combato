/**
 * Recorded sound-effect playback via the Web Audio API.
 *
 * All combat SFX are real audio files under /assets/sound (the old
 * procedurally-synthesized tones have been removed). Each play spins up its own
 * BufferSource so sounds can overlap.
 *
 * Autoplay policy: browsers won't let an AudioContext START until a user
 * gesture. We therefore (a) NEVER create the context during preload — preload
 * only fetches the raw bytes — and (b) create + resume the context on the first
 * pointer/key/touch anywhere on the page (the "unlock" listeners below). By the
 * time a fight starts (always reached via a click), the context is already
 * live, so timer-scheduled clips play without the "not allowed to start"
 * warning.
 */

let audioCtx = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

const rawClips = new Map();     // url -> Promise<ArrayBuffer | null>   (no context needed)
const decodedClips = new Map(); // url -> AudioBuffer | Promise<AudioBuffer | null>

function fetchRaw(url) {
  if (!rawClips.has(url)) {
    rawClips.set(url, fetch(url).then(res => res.arrayBuffer()).catch(() => null));
  }
  return rawClips.get(url);
}

// Decode requires a context, so this is only ever called once one exists
// (from playClip or the gesture unlock). Cached so each clip decodes once.
function decodeClip(url) {
  if (decodedClips.has(url)) return decodedClips.get(url);
  const ctx = getCtx();
  const p = Promise.resolve(fetchRaw(url))
    // slice(0) so decodeAudioData detaches a copy, leaving the cached raw intact
    .then(raw => (raw ? ctx.decodeAudioData(raw.slice(0)) : null))
    .then(buffer => { if (buffer) decodedClips.set(url, buffer); return buffer; })
    .catch(() => { decodedClips.delete(url); return null; });
  decodedClips.set(url, p);
  return p;
}

// Warm the cache. Only fetches bytes (and decodes if a context already exists,
// e.g. after the first gesture) — never creates the context on its own.
export function preloadClips(urls = []) {
  for (const url of urls) {
    fetchRaw(url);
    if (audioCtx) decodeClip(url);
  }
}

export function playClip(url, { gain = 1 } = {}) {
  // Never CREATE the context here — only the gesture unlock does that. Before
  // the first gesture audioCtx is null, so a sound that fires from an effect or
  // a timer is simply dropped (no audio is allowed pre-gesture anyway) instead
  // of spawning a suspended context and tripping the autoplay warning.
  if (!audioCtx) return;
  try {
    const ctx = audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    Promise.resolve(decodeClip(url)).then(buffer => {
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = gain;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start();
    }).catch(() => { /* decode failed — silent */ });
  } catch {
    // AudioContext unavailable or blocked — silent fail
  }
}

// ── Background music ─────────────────────────────────────────────────────────
// One looping theme, played ONLY while a fight is on screen — the Arena drives
// start (match begins) and stop (match ends / leave). Gated by a user on/off
// preference, and it can't start before audio is unlocked by a gesture.
let musicUrl = null;
let musicGain = 0.25;
let musicSource = null;    // the live looping BufferSource while playing
let musicEnabled = true;   // user on/off preference
const musicListeners = new Set();

function notifyMusic() {
  for (const cb of musicListeners) { try { cb(); } catch { /* ignore */ } }
}

// Subscribe to music state changes (start / stop / enable toggle). Returns an
// unsubscribe fn — lets a React toggle button re-render when music flips.
export function onMusicChange(cb) {
  musicListeners.add(cb);
  return () => musicListeners.delete(cb);
}

// Register the theme track: fetch the bytes now (no playback, no context). Call
// once at startup; playback is driven later by startMusic() / the toggle.
export function setMusicTrack(url, { gain = 0.25 } = {}) {
  musicUrl = url;
  musicGain = gain;
  fetchRaw(url);
}

export function isMusicEnabled() { return musicEnabled; }
export function isMusicPlaying() { return !!musicSource; }

// Start the looping theme. No-op if disabled, already playing, no track, or the
// context isn't unlocked yet (no gesture) — so on a cold reload it silently
// stays off until the user toggles it on.
export function startMusic() {
  if (!musicEnabled || !musicUrl || musicSource || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  Promise.resolve(decodeClip(musicUrl)).then(buffer => {
    // Re-check: a stop()/disable may have happened during the async decode.
    if (!buffer || musicSource || !musicEnabled || !audioCtx) return;
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = musicGain;
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    source.start();
    musicSource = source;
    notifyMusic();
  }).catch(() => { /* decode failed — silent */ });
}

export function stopMusic() {
  if (!musicSource) return;
  try { musicSource.stop(); } catch { /* ignore */ }
  musicSource = null;
  notifyMusic();
}

// User on/off preference. Disabling stops playback immediately; enabling does
// not auto-start (the fight lifecycle / toggle decides when to actually play).
export function setMusicEnabled(on) {
  musicEnabled = !!on;
  if (!musicEnabled) stopMusic();
  notifyMusic();
}

// Themed on/off toggle handler — runs inside a user gesture, so it's also a
// valid moment to unlock audio. Playing → mute; off → unlock + enable + play.
export function toggleMusic() {
  if (musicSource) {
    setMusicEnabled(false);
  } else {
    unlockAudio();        // gesture: create/resume the context
    musicEnabled = true;
    startMusic();
    notifyMusic();
  }
}

// True once a user gesture has created + resumed the AudioContext — i.e. a clip
// will actually play right now. False before the first gesture this page-load,
// and also while the context is merely 'suspended' (idle / backgrounded). Use
// `audioGestured()` for the looser "has the user interacted at all" question.
export function isAudioUnlocked() {
  return !!audioCtx && audioCtx.state === 'running';
}

// Browser-native: has the user made ANY gesture since this page loaded? Returns
// false until the first click/tap/key, then true for the document's lifetime.
// Falls back to our own context state where navigator.userActivation is absent
// (older Safari).
export function audioGestured() {
  if (typeof navigator !== 'undefined' && navigator.userActivation) {
    return navigator.userActivation.hasBeenActive;
  }
  return !!audioCtx;
}

// Create + resume the AudioContext and decode any already-prefetched clips. MUST
// be called from within a user gesture (click/key/tap) — the only time the
// browser lets the context start. Safe to call repeatedly. Does NOT start music
// (that's fight-driven now).
export function unlockAudio() {
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();
    for (const url of rawClips.keys()) decodeClip(url);
  } catch { /* ignore */ }
  return audioCtx;
}

// Auto-unlock on the first interaction ANYWHERE on the page. Registered in the
// CAPTURE phase so it fires before any descendant that calls stopPropagation()
// on the gesture, and we keep listening until the context is confirmed
// 'running' so a blocked first attempt is retried on the next interaction.
//
// Note: a page that auto-starts a fight on mount (e.g. /bot when a saved
// profile skips the FIGHT! screen) can't make sound until the FIRST gesture —
// no audio is allowed before one. Screens that begin on an explicit click
// (FIGHT!, Attack) call unlockAudio() directly so their fight has sound.
function installAudioUnlock() {
  if (typeof window === 'undefined') return;
  const events = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'];
  const handler = () => {
    unlockAudio();
    if (audioCtx && audioCtx.state === 'running') {
      events.forEach(e => window.removeEventListener(e, handler, true));
    }
  };
  events.forEach(e => window.addEventListener(e, handler, { capture: true, passive: true }));
}

installAudioUnlock();
