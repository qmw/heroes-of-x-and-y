// Look-ahead helpers: the AI evaluates candidate actions by applying them to a private copy of
// the CombatState (the real state is never touched and no real dice are consumed).
import { getStack } from '../state.js';

/** Deep copy of plain JSON data (faster than a JSON round trip for the small nested objects here). */
export function deepCopy(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const a = new Array(v.length);
    for (let i = 0; i < v.length; i++) a[i] = deepCopy(v[i]);
    return a;
  }
  const o = {};
  for (const k in v) o[k] = deepCopy(v[k]);
  return o;
}

/**
 * Deep copy of the state prepared for a simulation by `side`: morale / luck / fear / resistance
 * / mirror rolls are switched off (the AI accounts for them as expectations), forced rolls are
 * dropped and obstacles hidden from `side` (enemy mines, quicksand) are removed, so the AI never
 * "discovers" them by simulating. `damage`: 'min' | 'max' | 'avg' (forced base damage).
 */
export function simState(cs, side, damage = 'avg') {
  const c = {};
  // the opening's event log is never read by the engine: share it instead of copying
  for (const k in cs) c[k] = k === 'startEvents' ? cs[k] : deepCopy(cs[k]);
  const chance = {
    ...(c.force?.chance ?? {}), morale: false, bad_morale: false, luck: false, bad_luck: false, fear: false,
    resist: false, magic_mirror: false,
  };
  c.force = { ...(c.force ?? {}), chance, damage };
  c.forceRolls = [];
  if (Array.isArray(c.obstacles)) c.obstacles = c.obstacles.filter((o) => !(o.hidden && o.side !== side));
  return c;
}

/**
 * Run `fn(copy, actingStackCopy)` on an average-damage copy; returns `[state]` or null when the
 * action failed.
 */
export function simulateBoth(cs, side, stackId, fn) {
  const c = simState(cs, side, 'avg');
  let ok;
  try {
    ok = fn(c, getStack(c, stackId));
  } catch {
    ok = false;
  }
  return ok === false ? null : [c, c];
}

/** Tiny deterministic hash -> [0, 1) used for difficulty noise (never consumes the combat rng). */
export function noise(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x9e3779b9;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
