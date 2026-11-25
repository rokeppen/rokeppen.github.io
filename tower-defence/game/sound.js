// Tiny WebAudio synth: every effect is generated, there are no audio files.
// The AudioContext is created (or resumed) on the first user gesture, as browsers require.
const STORAGE_KEY = 'friday-drinks:muted';
const MIN_GAP = { shot: 0.07, cork: 0.04, leak: 0.1 }; // seconds between repeats of one sound

function readMuted() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted) {
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Storage blocked (private mode, sandbox): mute just isn't remembered.
  }
}

export function createSound() {
  let ctx = null;
  let master = null;
  let muted = readMuted();
  const lastPlayed = {};

  function unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      console.warn('Sound unavailable:', e);
    }
  }
  for (const type of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }

  // One oscillator with a pitch glide and an attack/decay envelope.
  function tone(t0, { type = 'sine', from, to = from, dur, vol = 0.2, attack = 0.005 }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Short filtered noise burst (the "pop" in a cork, the "fft" of a shot).
  function noise(t0, { dur, vol = 0.2, freq = 2000, q = 1 }) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(master);
    src.start(t0);
  }

  const effects = {
    shot(t) {
      noise(t, { dur: 0.05, vol: 0.12, freq: 3200, q: 2 });
      tone(t, { type: 'triangle', from: 900, to: 500, dur: 0.06, vol: 0.04 });
    },
    cork(t) {
      noise(t, { dur: 0.04, vol: 0.35, freq: 1400, q: 3 });
      tone(t, { type: 'sine', from: 380, to: 1100, dur: 0.09, vol: 0.18 });
    },
    leak(t) {
      // A sad glug: three falling bubbles.
      [0, 0.09, 0.18].forEach((d, i) => {
        tone(t + d, { type: 'sine', from: 320 - i * 60, to: 140 - i * 20, dur: 0.12, vol: 0.2 });
      });
    },
    bell(t) {
      // Bell partials with long decays; the low hum lingers longest.
      const f = 660;
      [[0.5, 0.18, 3.2], [1, 0.3, 2.6], [2, 0.16, 1.8], [2.76, 0.12, 1.3], [5.4, 0.06, 0.7]]
        .forEach(([ratio, vol, dur]) => tone(t, { from: f * ratio, dur, vol, attack: 0.002 }));
      tone(t + 0.35, { from: f, dur: 2.2, vol: 0.12, attack: 0.002 });
      tone(t + 0.35, { from: f * 2.76, dur: 1, vol: 0.05, attack: 0.002 });
    },
    won(t) {
      [523.25, 659.25, 783.99, 1046.5].forEach((fr, i) => {
        tone(t + i * 0.12, { type: 'triangle', from: fr, dur: i === 3 ? 0.8 : 0.22, vol: 0.2 });
      });
      tone(t + 0.36, { type: 'sine', from: 1567.98, dur: 0.8, vol: 0.06 });
    },
    lost(t) {
      // Sad trombone.
      [[392, 0.3], [369.99, 0.3], [349.23, 0.3], [329.63, 0.9]].reduce((at, [fr, dur]) => {
        tone(at, { type: 'sawtooth', from: fr, to: fr * (dur > 0.5 ? 0.94 : 0.99), dur, vol: 0.08, attack: 0.03 });
        return at + dur;
      }, t);
    },
  };

  return {
    play(name) {
      if (muted || !ctx || ctx.state !== 'running' || !effects[name]) return;
      const now = ctx.currentTime;
      if (now - (lastPlayed[name] ?? -1) < (MIN_GAP[name] ?? 0)) return;
      lastPlayed[name] = now;
      try {
        effects[name](now + 0.005);
      } catch (e) {
        console.warn(`Sound "${name}" failed:`, e);
      }
    },
    setMuted(value) {
      muted = !!value;
      writeMuted(muted);
    },
    get muted() {
      return muted;
    },
  };
}
