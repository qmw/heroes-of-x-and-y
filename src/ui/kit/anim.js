// Animation loop and tween utilities with a promise API, for sequencing engine events:
//
//   const anim = ctx.anim;                                   // shared animator (honours animSpeed)
//   await anim.tween({ from: 0, to: 1, duration: 300, ease: 'outQuad', onUpdate: (v) => { hero.px = lerp(a, b, v); } });
//   await anim.delay(150);
//   await sequence([() => anim.tween(...), () => anim.delay(100), () => showDamage()]);
//   await playEvents(result.events, { hero_moved: (e) => animateStep(e), combat_started: ... });
//
// The animator's clock is injectable (`createAnimator({ manual: true })` + `advance(ms)`), which
// is how the unit tests drive it and how "instant" animation speed works (speed = Infinity).

export const EASE = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inCubic: (t) => t * t * t,
  outBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  outBounce: (t) => {
    const n = 7.5625;
    const d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

export function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Create an animator.
 * @param {object} [opts]
 *   manual: true => no requestAnimationFrame; call `advance(ms)` yourself (tests),
 *   speed: number | () => number  (time multiplier; Infinity/0-duration => tweens finish at once),
 *   raf / caf: custom scheduling functions.
 * @returns animator { tween, delay, loop, advance, cancelAll, active, time, setSpeed }
 */
export function createAnimator(opts = {}) {
  const manual = !!opts.manual;
  const raf = opts.raf || (typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : null);
  const caf = opts.caf || (typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : () => {});
  let speed = opts.speed ?? 1;
  const items = new Set();      // running tweens / loops
  let frame = null;
  let last = null;
  const anim = { time: 0 };

  const getSpeed = () => {
    const s = typeof speed === 'function' ? speed() : speed;
    return s > 0 ? s : 1;
  };

  function step(dt) {
    anim.time += dt;
    for (const it of [...items]) {
      if (!items.has(it)) continue;
      it.update(dt);
    }
  }

  function schedule() {
    if (manual || frame != null || items.size === 0 || !raf) return;
    frame = raf(onFrame);
  }
  function onFrame(now) {
    frame = null;
    const t = typeof now === 'number' ? now : Date.now();
    const dt = last == null ? 16 : Math.min(100, Math.max(0, t - last));
    last = t;
    step(dt);
    if (items.size) schedule(); else last = null;
  }

  /**
   * Tween a number (or run a timed callback).
   * @param {object} o { from = 0, to = 1, duration (ms), ease = 'linear' | fn, onUpdate(value, t),
   *                     onDone(), realtime: bool (ignore animation speed) }
   * @returns {Promise<void> & { cancel: (finish?: boolean) => void }} resolves when finished or cancelled
   */
  anim.tween = (o = {}) => {
    const from = o.from ?? 0;
    const to = o.to ?? 1;
    const ease = typeof o.ease === 'function' ? o.ease : EASE[o.ease] || EASE.linear;
    const duration = Math.max(0, o.duration ?? 300);
    let elapsed = 0;
    let done = false;
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    const finish = (jump) => {
      if (done) return;
      done = true;
      items.delete(item);
      if (jump) { if (o.onUpdate) o.onUpdate(to, 1); if (o.onDone) o.onDone(); }
      resolve();
    };
    const item = {
      cancel: () => finish(false),
      update(dt) {
        const sp = o.realtime ? 1 : getSpeed();
        elapsed += dt * sp;
        if (elapsed >= duration || !Number.isFinite(sp)) { finish(true); return; }
        const t = elapsed / duration;
        if (o.onUpdate) o.onUpdate(lerp(from, to, ease(t)), t);
      },
    };
    p.cancel = (jumpToEnd = false) => finish(jumpToEnd);
    if (duration === 0 || (!o.realtime && !Number.isFinite(getSpeed())) || (!manual && !raf)) {
      // Nothing to animate (or no way to schedule frames): complete immediately.
      finish(true);
      return p;
    }
    if (o.onUpdate) o.onUpdate(from, 0);
    items.add(item);
    schedule();
    return p;
  };

  /** Promise that resolves after `ms` of animation time. */
  anim.delay = (ms, o = {}) => anim.tween({ duration: ms, realtime: o.realtime });

  /**
   * Per-frame callback: `fn(dtMs, timeMs)`; return false to stop.
   * @returns {{ stop: () => void, running: boolean }}
   */
  anim.loop = (fn) => {
    const handle = { running: true, stop() { handle.running = false; items.delete(item); } };
    const item = { cancel: () => handle.stop(), update(dt) { if (fn(dt, anim.time) === false) handle.stop(); } };
    items.add(item);
    schedule();
    return handle;
  };

  /** Manual clock: advance by `ms`, in `stepMs` slices (default one slice). */
  anim.advance = (ms, stepMs = ms) => {
    let left = ms;
    while (left > 0) {
      const dt = Math.min(stepMs > 0 ? stepMs : left, left);
      step(dt);
      left -= dt;
    }
  };

  /** Stop everything (screen unmount). Running tweens resolve without jumping to their end. */
  anim.cancelAll = () => {
    for (const it of [...items]) it.cancel();
    items.clear();
    if (frame != null) { caf(frame); frame = null; }
    last = null;
  };

  anim.setSpeed = (s) => { speed = s; };
  Object.defineProperty(anim, 'active', { get: () => items.size });
  return anim;
}

/** Run async steps one after another. Each step is a function returning a promise (or a value). */
export async function sequence(steps) {
  const out = [];
  for (const s of steps) out.push(await (typeof s === 'function' ? s() : s));
  return out;
}

/** Run async steps together; resolves when all are done. */
export function parallel(steps) {
  return Promise.all(steps.map((s) => (typeof s === 'function' ? s() : s)));
}

/**
 * Play engine events in order: for each `{type, ...}` call `handlers[type](event, index)` and wait
 * for its promise. Unknown types go to `handlers['*']` if present. Handler errors are logged, not
 * thrown, so a broken animation never blocks the game.
 */
export async function playEvents(events, handlers = {}, { onError } = {}) {
  let i = 0;
  for (const e of events || []) {
    const fn = handlers[e.type] || handlers['*'];
    if (fn) {
      try { await fn(e, i); } catch (err) { if (onError) onError(err, e); else console.error('[playEvents]', e.type, err); }
    }
    i++;
  }
}
