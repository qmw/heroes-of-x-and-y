// Tiny procedural WebAudio synth for UI / game sound effects. No assets. Every call is a safe
// no-op when AudioContext is unavailable (Node, old browsers) or the user muted the game.
//
//   ctx.audio.play('click');   // click | hover | error | coin | sword | arrow | spell | levelup |
//                              // daystart | build | recruit | move | victory | defeat | chest

/**
 * Sound recipes: lists of voices. A voice is an oscillator sweep or a filtered noise burst.
 *   { wave, f: [startHz, endHz], t: startSec, d: durationSec, g: gain }
 *   { noise: true, f: [filterStartHz, filterEndHz], t, d, g, q }
 */
export const SOUNDS = {
  click: [{ wave: 'square', f: [620, 420], t: 0, d: 0.05, g: 0.25 }, { noise: true, f: [3000, 1500], t: 0, d: 0.03, g: 0.15 }],
  hover: [{ wave: 'sine', f: [880, 900], t: 0, d: 0.03, g: 0.08 }],
  error: [{ wave: 'sawtooth', f: [200, 140], t: 0, d: 0.16, g: 0.25 }, { wave: 'sawtooth', f: [150, 110], t: 0.1, d: 0.18, g: 0.2 }],
  coin: [{ wave: 'triangle', f: [1320, 1320], t: 0, d: 0.07, g: 0.3 }, { wave: 'triangle', f: [1760, 1760], t: 0.06, d: 0.22, g: 0.3 }],
  chest: [{ wave: 'triangle', f: [660, 660], t: 0, d: 0.08, g: 0.3 }, { wave: 'triangle', f: [880, 880], t: 0.08, d: 0.08, g: 0.3 }, { wave: 'triangle', f: [1320, 1320], t: 0.16, d: 0.25, g: 0.3 }],
  sword: [{ noise: true, f: [5000, 800], t: 0, d: 0.12, g: 0.5, q: 2 }, { wave: 'square', f: [1800, 900], t: 0.01, d: 0.08, g: 0.12 }, { wave: 'sine', f: [140, 60], t: 0.02, d: 0.14, g: 0.4 }],
  arrow: [{ noise: true, f: [1200, 5000], t: 0, d: 0.16, g: 0.3, q: 4 }, { wave: 'sine', f: [300, 120], t: 0.15, d: 0.06, g: 0.3 }],
  spell: [{ wave: 'sine', f: [300, 1500], t: 0, d: 0.35, g: 0.25 }, { wave: 'triangle', f: [450, 2250], t: 0.05, d: 0.35, g: 0.15 }, { noise: true, f: [800, 6000], t: 0.1, d: 0.35, g: 0.12, q: 6 }],
  levelup: [{ wave: 'triangle', f: [523, 523], t: 0, d: 0.12, g: 0.3 }, { wave: 'triangle', f: [659, 659], t: 0.12, d: 0.12, g: 0.3 }, { wave: 'triangle', f: [784, 784], t: 0.24, d: 0.12, g: 0.3 }, { wave: 'triangle', f: [1047, 1047], t: 0.36, d: 0.4, g: 0.32 }],
  daystart: [{ wave: 'sine', f: [392, 392], t: 0, d: 0.25, g: 0.25 }, { wave: 'sine', f: [587, 587], t: 0.18, d: 0.45, g: 0.25 }, { wave: 'triangle', f: [784, 784], t: 0.36, d: 0.5, g: 0.12 }],
  build: [{ noise: true, f: [900, 300], t: 0, d: 0.08, g: 0.5, q: 1 }, { noise: true, f: [900, 300], t: 0.16, d: 0.08, g: 0.5, q: 1 }, { wave: 'sine', f: [110, 70], t: 0, d: 0.3, g: 0.3 }],
  recruit: [{ wave: 'square', f: [330, 330], t: 0, d: 0.09, g: 0.15 }, { wave: 'square', f: [440, 440], t: 0.1, d: 0.16, g: 0.15 }],
  move: [{ noise: true, f: [500, 250], t: 0, d: 0.06, g: 0.25, q: 1 }],
  victory: [{ wave: 'triangle', f: [523, 523], t: 0, d: 0.18, g: 0.3 }, { wave: 'triangle', f: [659, 659], t: 0.18, d: 0.18, g: 0.3 }, { wave: 'triangle', f: [784, 784], t: 0.36, d: 0.18, g: 0.3 }, { wave: 'triangle', f: [1047, 1047], t: 0.54, d: 0.7, g: 0.35 }, { wave: 'sine', f: [262, 262], t: 0.54, d: 0.7, g: 0.2 }],
  defeat: [{ wave: 'sawtooth', f: [330, 310], t: 0, d: 0.3, g: 0.18 }, { wave: 'sawtooth', f: [262, 247], t: 0.3, d: 0.3, g: 0.18 }, { wave: 'sawtooth', f: [196, 98], t: 0.6, d: 0.8, g: 0.2 }],
};

export const SOUND_NAMES = Object.keys(SOUNDS);

/**
 * @param {{ get(key): any } | null} settings  settings store (reads `volume`, `muted`)
 * @param {{ AudioContext?: Function }} [env]  injection point for tests
 * @returns {{ play(name, opts?), unlock(), supported: boolean, names: string[], volume(): number }}
 */
export function createAudio(settings = null, env = {}) {
  const Ctor = env.AudioContext || (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext)) || null;
  let ac = null;
  let noiseBuffer = null;
  let lastPlay = {};

  const volume = () => {
    if (!settings) return 0.5;
    if (settings.get('muted')) return 0;
    const v = Number(settings.get('volume'));
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  };

  function context() {
    if (!Ctor) return null;
    if (!ac) {
      try { ac = new Ctor(); } catch { ac = null; return null; }
    }
    if (ac.state === 'suspended' && ac.resume) { try { const p = ac.resume(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
    return ac;
  }

  function noise(a) {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(a.sampleRate * 0.5);
    noiseBuffer = a.createBuffer(1, len, a.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;       // deterministic LCG: no Math.random needed
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return noiseBuffer;
  }

  function voice(a, v, t0, master, pitch) {
    const start = t0 + (v.t || 0);
    const end = start + v.d;
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, v.g * master), start + Math.min(0.01, v.d / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(a.destination);
    if (v.noise) {
      const src = a.createBufferSource();
      src.buffer = noise(a);
      const filter = a.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = v.q || 1;
      filter.frequency.setValueAtTime(v.f[0], start);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, v.f[1]), end);
      src.connect(filter);
      filter.connect(gain);
      src.start(start);
      src.stop(end + 0.02);
    } else {
      const osc = a.createOscillator();
      osc.type = v.wave || 'sine';
      osc.frequency.setValueAtTime(v.f[0] * pitch, start);
      if (v.f[1] !== v.f[0]) osc.frequency.exponentialRampToValueAtTime(Math.max(20, v.f[1] * pitch), end);
      osc.connect(gain);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }

  const api = {
    supported: !!Ctor,
    names: SOUND_NAMES,
    volume,
    /** Call from a user gesture (app.js does it on the first pointer/key event) to satisfy autoplay rules. */
    unlock() { context(); },
    /**
     * Play a sound by name. Unknown names and any WebAudio failure are ignored.
     * @param {string} name
     * @param {{ pitch?: number, gain?: number }} [opts]
     * @returns {boolean} whether something was scheduled
     */
    play(name, opts = {}) {
      const recipe = SOUNDS[name];
      const master = volume() * (opts.gain ?? 1);
      if (!recipe || master <= 0) return false;
      try {
        const a = context();
        if (!a) return false;
        const now = a.currentTime;
        if (lastPlay[name] != null && now - lastPlay[name] < 0.03) return false;   // no machine-gun stacking
        lastPlay[name] = now;
        for (const v of recipe) voice(a, v, now + 0.005, master, opts.pitch || 1);
        return true;
      } catch {
        return false;
      }
    },
  };
  return api;
}
