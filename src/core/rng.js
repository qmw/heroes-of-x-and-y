// Deterministic, serializable RNG (mulberry32). The rng is a plain object `{ s }` so it can live
// inside the JSON game state. ALL engine randomness must go through these helpers.

export function createRng(seed = 1) {
  return { s: (seed >>> 0) || 1 };
}

/** Float in [0, 1). */
export function rand(rng) {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [min, max] inclusive. */
export function randInt(rng, min, max) {
  return min + Math.floor(rand(rng) * (max - min + 1));
}

/** True with probability p (0..1). */
export function chance(rng, p) {
  return rand(rng) < p;
}

export function pick(rng, arr) {
  return arr[Math.floor(rand(rng) * arr.length)];
}

/** Pick from `items` using parallel `weights` (non-negative numbers). */
export function weightedPick(rng, items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pick(rng, items);
  let r = rand(rng) * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** In-place Fisher-Yates shuffle; returns the array. */
export function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(rng) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
