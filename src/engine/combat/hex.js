// Hex math for the 15x11 battlefield. Offset coordinates, odd rows shifted right by half a hex.
// Hexes are plain `{x, y}` objects. No state, no randomness.
import { BATTLEFIELD } from '../../core/constants.js';

export const W = BATTLEFIELD.WIDTH;
export const H = BATTLEFIELD.HEIGHT;

/** Direction indices: 0 = E, 1 = SE, 2 = SW, 3 = W, 4 = NW, 5 = NE. */
export const DIRS = [0, 1, 2, 3, 4, 5];

export const inBounds = (h) => h.x >= 0 && h.x < W && h.y >= 0 && h.y < H;
export const hexIndex = (h) => h.y * W + h.x;
export const hexFromIndex = (i) => ({ x: i % W, y: Math.floor(i / W) });
export const sameHex = (a, b) => a.x === b.x && a.y === b.y;

/** Neighbour of `h` in direction `dir` (may be out of bounds). */
export function neighbor(h, dir) {
  const odd = h.y & 1;
  switch (dir) {
    case 0: return { x: h.x + 1, y: h.y };
    case 1: return { x: h.x + odd, y: h.y + 1 };
    case 2: return { x: h.x - 1 + odd, y: h.y + 1 };
    case 3: return { x: h.x - 1, y: h.y };
    case 4: return { x: h.x - 1 + odd, y: h.y - 1 };
    case 5: return { x: h.x + odd, y: h.y - 1 };
    default: throw new Error(`bad hex direction ${dir}`);
  }
}

/** In-bounds neighbours. */
export function neighbors(h) {
  const out = [];
  for (const d of DIRS) {
    const n = neighbor(h, d);
    if (inBounds(n)) out.push(n);
  }
  return out;
}

/** Hex distance (number of steps on an empty field). */
export function hexDistance(a, b) {
  const aq = a.x - (a.y - (a.y & 1)) / 2;
  const bq = b.x - (b.y - (b.y & 1)) / 2;
  const dq = aq - bq;
  const dr = a.y - b.y;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Direction from `a` to the adjacent hex `b`, or -1 when they are not adjacent. */
export function directionTo(a, b) {
  for (const d of DIRS) if (sameHex(neighbor(a, d), b)) return d;
  return -1;
}

/** All in-bounds hexes with distance `min..r` from `center` (min 0 = disc, min 1 = ring). */
export function hexesInRadius(center, r, min = 0) {
  const out = [];
  for (let y = Math.max(0, center.y - r); y <= Math.min(H - 1, center.y + r); y++) {
    for (let x = Math.max(0, center.x - r - 1); x <= Math.min(W - 1, center.x + r + 1); x++) {
      const d = hexDistance(center, { x, y });
      if (d <= r && d >= min) out.push({ x, y });
    }
  }
  return out;
}

/** +1 when the side faces right (attacker), -1 when it faces left (defender). */
export const facing = (side) => (side === 'attacker' ? 1 : -1);

/**
 * Hexes a stack would occupy with its head on `pos`. A two-hex creature occupies the head hex and
 * the hex behind it (towards its own edge of the field). Orientation never changes.
 */
export function stackHexesAt(stack, pos) {
  if (stack.size < 2) return [{ x: pos.x, y: pos.y }];
  return [{ x: pos.x, y: pos.y }, { x: pos.x - facing(stack.side), y: pos.y }];
}

export const stackHexes = (stack) => stackHexesAt(stack, stack.pos);

/** Smallest hex distance between any hexes of two hex lists. */
export function hexSetDistance(as, bs) {
  let best = Infinity;
  for (const a of as) for (const b of bs) best = Math.min(best, hexDistance(a, b));
  return best;
}

export const stackDistance = (a, b) => hexSetDistance(stackHexes(a), stackHexes(b));
export const stacksAdjacent = (a, b) => stackDistance(a, b) === 1;
