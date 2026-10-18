// Combat sound: Duelyst sfx / music files through the audio map when the browser can play them,
// the procedural synth (`ctx.audio`) otherwise. Every call is guarded; respects volume / muted.
let audioMap = null;
const SYNTH = {
  melee: 'sword', melee_blade: 'sword', melee_blunt: 'sword', melee_claw: 'sword', melee_bite: 'sword', melee_magic: 'spell',
  melee_heavy: 'sword', arrow: 'arrow', hit: 'click', cannon: 'build', death: 'error', victory: 'victory', defeat: 'defeat',
  move: 'move', spell: 'spell', heal: 'levelup', resurrect: 'levelup', morale: 'levelup',
};

/** Load the Duelyst audio map once (optional module). */
export async function loadAudioMap(loader = () => import('../../../gfx/duelyst/audioMap.js')) {
  if (audioMap) return audioMap;
  try { audioMap = await loader(); } catch { audioMap = null; }
  return audioMap;
}

const canPlayFiles = () => typeof globalThis.Audio === 'function';

/**
 * @param {Object} ctx screen ctx
 * @returns {{ sfx(name), music(context), stop() }}
 */
export function createCombatAudio(ctx) {
  let musicEl = null;
  const volume = () => {
    const s = ctx.settings;
    if (!s) return 0.5;
    if (s.get('muted')) return 0;
    const v = Number(s.get('volume'));
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
  };
  const synth = (name) => {
    const n = SYNTH[name] || (/^spell/.test(name) ? 'spell' : /^death/.test(name) ? 'error' : /^melee/.test(name) ? 'sword' : null);
    if (n && ctx.audio && ctx.audio.play) { try { ctx.audio.play(n); } catch { /* ignore */ } }
  };
  return {
    sfx(name) {
      if (volume() <= 0) return;
      const url = audioMap && canPlayFiles() ? safe(() => audioMap.getSfxUrl(name)) : null;
      if (url) {
        try {
          const a = new globalThis.Audio(url);
          a.volume = volume();
          const p = a.play();
          if (p && p.catch) p.catch(() => synth(name));
          return;
        } catch { /* fall through */ }
      }
      synth(name);
    },
    music(context) {
      this.stopMusic();
      if (!audioMap || !canPlayFiles() || volume() <= 0) return;
      const url = safe(() => audioMap.getMusicUrl(context));
      if (!url) return;
      try {
        musicEl = new globalThis.Audio(url);
        musicEl.loop = true;
        musicEl.volume = volume() * 0.5;
        const p = musicEl.play();
        if (p && p.catch) p.catch(() => {});
      } catch { musicEl = null; }
    },
    stopMusic() {
      if (musicEl) { try { musicEl.pause(); } catch { /* ignore */ } musicEl = null; }
    },
    stop() { this.stopMusic(); },
  };
}

function safe(fn) { try { return fn(); } catch { return null; } }
