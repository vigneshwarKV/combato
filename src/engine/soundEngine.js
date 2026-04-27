/**
 * Synthesized sound effects via Web Audio API.
 * No audio files — all procedurally generated.
 * AudioContext is lazily created on first playSound() call (browser requires user gesture).
 */

let audioCtx = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone({ freq = 440, type = 'sine', gain = 0.3, duration = 0.15, decay = 0.12 }) {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freq * 0.4, 20), ctx.currentTime + duration);
  gainNode.gain.setValueAtTime(gain, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration + decay);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration + decay + 0.01);
}

function playNoiseBurst({ gain = 0.3, duration = 0.08, highpass = 800 }) {
  const ctx = getCtx();
  const bufferSize = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = highpass;

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);
  source.start();
}

export function playSound(type) {
  try {
    switch (type) {
      case 'hit':
        // Light snap — quick noise + dull thud
        playNoiseBurst({ gain: 0.30, duration: 0.05, highpass: 900 });
        playTone({ freq: 160, type: 'square', gain: 0.10, duration: 0.06, decay: 0.04 });
        break;

      case 'super_hit':
        // Massive explosion — deep boom + crunch + sub bass rumble
        playNoiseBurst({ gain: 0.95, duration: 0.22, highpass: 60 });
        playNoiseBurst({ gain: 0.6, duration: 0.14, highpass: 400 });
        playTone({ freq: 55, type: 'sawtooth', gain: 0.55, duration: 0.45, decay: 0.5 });
        playTone({ freq: 90, type: 'square', gain: 0.38, duration: 0.35, decay: 0.4 });
        playTone({ freq: 140, type: 'sawtooth', gain: 0.22, duration: 0.2, decay: 0.2 });
        break;

      case 'supermove_charge':
        // Rising power-up whoosh before the blast
        playTone({ freq: 180, type: 'sine', gain: 0.22, duration: 0.5, decay: 0.08 });
        playTone({ freq: 360, type: 'sine', gain: 0.16, duration: 0.4, decay: 0.06 });
        playTone({ freq: 720, type: 'sine', gain: 0.10, duration: 0.3, decay: 0.05 });
        break;

      case 'block':
        playNoiseBurst({ gain: 0.28, duration: 0.05, highpass: 1400 });
        playTone({ freq: 340, type: 'triangle', gain: 0.14, duration: 0.06, decay: 0.04 });
        break;

      case 'ko':
        playNoiseBurst({ gain: 0.65, duration: 0.22, highpass: 90 });
        playTone({ freq: 100, type: 'sawtooth', gain: 0.42, duration: 0.42, decay: 0.32 });
        playTone({ freq: 58, type: 'square', gain: 0.28, duration: 0.65, decay: 0.42 });
        break;

      default:
        break;
    }
  } catch {
    // AudioContext unavailable or blocked — silent fail
  }
}
