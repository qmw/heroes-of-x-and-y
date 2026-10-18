// Map builder: the grid bookkeeping shared by the random map generator and the scenario builder.
// It wraps a throw-away "generation state" (map + rng + id counter) so the real adventure
// `addObject` rolls every object's instance data exactly as the engine expects
// (docs/mechanics/adventure-engine.md "Object instance data shapes").
//
// Per level it keeps flat arrays (index = y * W + x):
//   zone  - zone id (global across levels) or -1
//   occ   - 0 free | 1 decor/obstacle | 2 object footprint | 3 town footprint | 4 keep free (grail...)
//   resv  - 1 = reserved path tile ("network"): never covered by objects or obstacles
//   border- 1 = zone border tile (walled with obstacles / rock)
// Connectivity rule: every object's access tile is joined to its zone's reserved network by a
// reserved path, and obstacles never cover reserved tiles - so everything stays reachable.
import { createRng, rand, pick, shuffle, weightedPick } from '../../core/rng.js';
import { getTerrain } from '../../data/terrain.js';
import { getMapObject, getDecorForTerrain } from '../../data/mapObjects.js';
import { createEmptyMap, addObject, getFootprint } from '../adventure/index.js';

export const OCC_FREE = 0;
export const OCC_DECOR = 1;
export const OCC_OBJECT = 2;
export const OCC_TOWN = 3;
export const OCC_KEEP = 4;

export const TOWN_DEF_ID = 'town';
const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
export const NEIGHBOURS8 = N8;

/**
 * @param {{width:number, height:number, levels?:number, seed?:number, rng?:object, terrain?:string}} o
 */
export function createBuilder({ width, height, levels = 1, seed = 1, rng = null, terrain = 'grass' }) {
  const map = createEmptyMap(width, height, levels, terrain);
  const r = rng || createRng(seed);
  const gs = { map, rng: r, nextId: 1, players: [], heroes: {}, towns: {}, settings: {}, turn: 1, date: { day: 1, week: 1, month: 1 } };
  const N = width * height;
  const mk = (T, fill = 0) => Array.from({ length: levels }, () => new T(N).fill(fill));
  return {
    W: width, H: height, L: levels, N, rng: r, map, gs,
    zone: mk(Int16Array, -1), occ: mk(Uint8Array), resv: mk(Uint8Array), border: mk(Uint8Array),
    netCount: {},          // zone id -> reserved tiles count
    towns: [], heroes: [], // blueprint entries
    townSites: [],         // {pos, x0, y0, x1, y1}
  };
}

export const idxOf = (b, x, y) => y * b.W + x;
export const inside = (b, x, y) => x >= 0 && y >= 0 && x < b.W && y < b.H;
export const tileAt = (b, x, y, z) => b.map.tiles[z][y][x];
export const terrainAt = (b, x, y, z) => b.map.tiles[z][y][x].t;

export function setTerrain(b, x, y, z, t) {
  b.map.tiles[z][y][x].t = t;
}

export function isWater(b, x, y, z) {
  return inside(b, x, y) && getTerrain(terrainAt(b, x, y, z)).water;
}

export function isLand(b, x, y, z) {
  if (!inside(b, x, y)) return false;
  const t = getTerrain(terrainAt(b, x, y, z));
  return t.passable && !t.water;
}

/** Tile can be walked over (for path carving): land, not occupied (or reserved). */
export function walkable(b, x, y, z, water = false) {
  if (!inside(b, x, y)) return false;
  const i = idxOf(b, x, y);
  const t = getTerrain(terrainAt(b, x, y, z));
  if (!t.passable || t.water !== water) return false;
  if (b.resv[z][i]) return true;
  return b.occ[z][i] === OCC_FREE;
}

export function reserve(b, x, y, z) {
  const i = idxOf(b, x, y);
  if (b.resv[z][i]) return;
  b.resv[z][i] = 1;
  const zn = b.zone[z][i];
  b.netCount[zn] = (b.netCount[zn] || 0) + 1;
}

// ---- binary heap ---------------------------------------------------------------------------------

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k; const v = this.v;
    k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k; const v = this.v;
    const top = v[0];
    const lk = k.pop(); const lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Dijkstra on one level (8-connected). `pass(i)` decides traversable tiles (the sources are always
 * allowed), `cost(i)` the price of entering tile i (default 1), `target(i)` ends the search.
 * @returns {number[]|null} tile indices from a source to the target (inclusive)
 */
export function shortestPath(b, sources, { pass, target, cost = null, maxCost = Infinity }) {
  const W = b.W;
  if (!b._dist) { b._dist = new Float64Array(b.N); b._prev = new Int32Array(b.N); b._stamp = new Uint32Array(b.N); b._gen = 0; }
  const gen = ++b._gen;
  const dist = b._dist; const prev = b._prev; const stamp = b._stamp;
  const heap = new Heap();
  for (const s of sources) { dist[s] = 0; prev[s] = -1; stamp[s] = gen; heap.push(0, s); }
  while (heap.size) {
    const i = heap.pop();
    const d = dist[i];
    if (target(i)) {
      const path = [];
      for (let c = i; c !== -1; c = prev[c]) path.push(c);
      return path.reverse();
    }
    if (d > maxCost) continue;
    const x = i % W; const y = (i - x) / W;
    for (const [dx, dy] of N8) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= b.H) continue;
      const j = ny * W + nx;
      const nd = d + (dx && dy ? 1.42 : 1) * (cost ? cost(j) : 1);
      if (stamp[j] === gen && dist[j] <= nd) continue;
      if (!pass(j)) continue;
      dist[j] = nd; prev[j] = i; stamp[j] = gen;
      heap.push(nd, j);
    }
  }
  return null;
}

/** Noise field in [0,1) with features of about `cell` tiles (bilinear value noise). */
export function makeNoise(rng, W, H, cell = 8) {
  const gw = Math.ceil(W / cell) + 2; const gh = Math.ceil(H / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rand(rng);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = x / cell; const fy = y / cell;
      const x0 = Math.floor(fx); const y0 = Math.floor(fy);
      const tx = fx - x0; const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx); const sy = ty * ty * (3 - 2 * ty);
      const a = g[y0 * gw + x0]; const bb = g[y0 * gw + x0 + 1];
      const c = g[(y0 + 1) * gw + x0]; const d = g[(y0 + 1) * gw + x0 + 1];
      out[y * W + x] = (a + (bb - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

// ---- object placement ----------------------------------------------------------------------------

const isWaterDef = (def) => (def.terrains || []).length === 1 && def.terrains[0] === 'water';

/** The tile from which a hero reaches an object (the one below its entrance). */
export function accessOf(pos) {
  return { x: pos.x, y: pos.y + 1, z: pos.z || 0 };
}

/**
 * Can `defId` stand with its entrance at `pos`?
 * opts: zone (all tiles in that zone), spacing (free ring of other objects, default 1 for
 * visitable objects), allowBorder, needAccess (default: visitable), allowReserved (1x1 guards).
 */
export function canPlace(b, defId, pos, opts = {}) {
  const def = typeof defId === 'string' ? getMapObject(defId) : defId;
  const z = pos.z || 0;
  const water = isWaterDef(def);
  const fp = getFootprint(def, pos);
  for (const p of fp) {
    if (!inside(b, p.x, p.y)) return false;
    const i = idxOf(b, p.x, p.y);
    if (b.occ[z][i] !== OCC_FREE) return false;
    if (b.resv[z][i] && !opts.allowReserved) return false;
    if (b.border[z][i] && !opts.allowBorder) return false;
    if (opts.zone != null && b.zone[z][i] !== opts.zone) return false;
    const tile = b.map.tiles[z][p.y][p.x];
    const ter = getTerrain(tile.t);
    if (!ter.passable || ter.water !== water) return false;
    if (tile.river && def.category !== 'decor') return false;
    if (def.category !== 'decor' && !opts.anyTerrain && !def.terrains.includes(tile.t)) return false;
    if (def.category === 'decor' && !def.terrains.includes(tile.t)) return false;
  }
  const visitable = def.interact !== 'none';
  const spacing = opts.spacing ?? (visitable ? 1 : 0);
  if (spacing > 0) {
    const [w, h] = def.size;
    const x0 = pos.x - Math.floor(w / 2);
    for (let y = pos.y - h + 1 - spacing; y <= pos.y + spacing; y++) {
      for (let x = x0 - spacing; x < x0 + w + spacing; x++) {
        if (!inside(b, x, y)) continue;
        const o = b.occ[z][idxOf(b, x, y)];
        if (o === OCC_OBJECT || o === OCC_TOWN) return false;
      }
    }
  }
  if (opts.needAccess ?? visitable) {
    const a = accessOf(pos);
    if (!inside(b, a.x, a.y)) return false;
    const i = idxOf(b, a.x, a.y);
    if (b.occ[z][i] !== OCC_FREE && !b.resv[z][i]) return false;
    if (opts.zone != null && b.zone[z][i] !== opts.zone) return false;
    if (getTerrain(terrainAt(b, a.x, a.y, z)).water !== water) return false;
    if (!getTerrain(terrainAt(b, a.x, a.y, z)).passable) return false;
  }
  return true;
}

/** addObject on the generation state + occupancy bookkeeping. */
export function place(b, defId, pos, params = {}, occ = null) {
  const def = getMapObject(defId);
  const p = { x: pos.x, y: pos.y, z: pos.z || 0 };
  const obj = addObject(b.gs, defId, p, params);
  const o = occ ?? (def.category === 'decor' ? OCC_DECOR : OCC_OBJECT);
  if (def.effect.type !== 'grail') {
    for (const f of getFootprint(def, p)) if (inside(b, f.x, f.y)) b.occ[p.z][idxOf(b, f.x, f.y)] = o;
  } else {
    b.occ[p.z][idxOf(b, p.x, p.y)] = OCC_KEEP;
  }
  return obj;
}

/**
 * Join tile `start` to the reserved network of its zone (shortest free path, reserved afterwards).
 * When the zone has no network yet, `start` becomes its first tile.
 * @returns {boolean}
 */
export function connect(b, start, { maxCost = 80, water = false, zone = undefined, cost = null } = {}) {
  const z = start.z || 0;
  const si = idxOf(b, start.x, start.y);
  const zn = zone === undefined ? b.zone[z][si] : zone;
  if (b.resv[z][si]) return true;
  if (!b.netCount[zn]) { reserve(b, start.x, start.y, z); return true; }
  const zoneArr = b.zone[z]; const resv = b.resv[z]; const occ = b.occ[z]; const border = b.border[z];
  const tiles = b.map.tiles[z];
  const W = b.W;
  const path = shortestPath(b, [si], {
    pass: (j) => {
      if (zoneArr[j] !== zn) return false;
      if (resv[j]) return true;
      if (occ[j] !== OCC_FREE || border[j]) return false;
      const t = getTerrain(tiles[(j / W) | 0][j % W].t);
      return t.passable && t.water === water;
    },
    target: (j) => resv[j] === 1 && j !== si,
    cost, maxCost,
  });
  if (!path) return false;
  for (const j of path) reserve(b, j % W, (j / W) | 0, z);
  return true;
}

/**
 * Place an object and join its access tile to the network; undone when the join fails.
 * @returns {object|null} the map object
 */
export function placeConnected(b, defId, pos, params = {}, opts = {}) {
  const def = getMapObject(defId);
  if (!canPlace(b, def, pos, opts)) return null;
  const z = pos.z || 0;
  const fp = getFootprint(def, pos);
  // temporarily mark the footprint so the path does not run through it
  const saved = fp.map((f) => b.occ[z][idxOf(b, f.x, f.y)]);
  for (const f of fp) b.occ[z][idxOf(b, f.x, f.y)] = OCC_OBJECT;
  let okc = true;
  if (def.interact !== 'none') okc = connect(b, accessOf(pos), { water: isWaterDef(def), maxCost: opts.maxCost ?? 80, zone: opts.zone });
  fp.forEach((f, k) => { b.occ[z][idxOf(b, f.x, f.y)] = saved[k]; });
  if (!okc) return null;
  return place(b, defId, pos, params);
}

/**
 * Try `candidates` (positions) in order until `defId` fits and connects.
 * @returns {object|null}
 */
export function placeAtFirst(b, defId, candidates, params = {}, opts = {}) {
  let tries = 0;
  for (const pos of candidates) {
    if (++tries > (opts.maxTries ?? 400)) break;
    const obj = placeConnected(b, defId, pos, typeof params === 'function' ? params() : params, opts);
    if (obj) return obj;
  }
  return null;
}

// ---- towns & heroes ------------------------------------------------------------------------------

/** Footprint rectangle of a town with its entrance at pos (5x3, entrance bottom-centre). */
export function townRect(pos) {
  return { x0: pos.x - 2, x1: pos.x + 2, y0: pos.y - 2, y1: pos.y };
}

/** Can a town stand here (footprint + margin of one tile + an open forecourt below the gate)? */
export function canPlaceTown(b, pos, zone = null) {
  const z = pos.z || 0;
  const r = townRect(pos);
  for (let y = r.y0 - 1; y <= r.y1 + 2; y++) {
    for (let x = r.x0 - 1; x <= r.x1 + 1; x++) {
      if (!inside(b, x, y)) return false;
      const i = idxOf(b, x, y);
      if (b.occ[z][i] !== OCC_FREE) return false;
      const inFoot = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
      if ((inFoot || y > r.y1) && (b.resv[z][i] || b.border[z][i])) return false;
      if (zone != null && b.zone[z][i] !== zone) return false;
      if (!isLand(b, x, y, z)) return false;
      if (inFoot && b.map.tiles[z][y][x].river) return false;
    }
  }
  return true;
}

/** Register a town (blueprint entry) and reserve its forecourt. */
export function placeTown(b, pos, entry) {
  const z = pos.z || 0;
  const r = townRect(pos);
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) b.occ[z][idxOf(b, x, y)] = OCC_TOWN;
  const town = { pos: { x: pos.x, y: pos.y, z }, ...entry };
  b.towns.push(town);
  b.townSites.push({ pos: town.pos, ...r });
  for (const dx of [-1, 0, 1]) {
    const x = pos.x + dx; const y = pos.y + 1;
    if (inside(b, x, y) && isLand(b, x, y, z) && b.occ[z][idxOf(b, x, y)] === OCC_FREE) reserve(b, x, y, z);
  }
  return town;
}

// ---- monsters ------------------------------------------------------------------------------------

/** Put a monster stack on `pos` (normally a reserved tile in front of what it guards). */
export function placeMonster(b, pos, data) {
  const z = pos.z || 0;
  const i = idxOf(b, pos.x, pos.y);
  if (b.occ[z][i] !== OCC_FREE) return null;
  return place(b, 'monster', pos, { data: { disposition: 'aggressive', ...data } });
}

// ---- obstacles -----------------------------------------------------------------------------------

const decorCache = {};
function decorFor(terrain) {
  if (!decorCache[terrain]) decorCache[terrain] = getDecorForTerrain(terrain).filter((d) => d.blocking);
  return decorCache[terrain];
}

/**
 * Cover tile (x, y) with a blocking decor object (largest fitting first, any size), using only
 * tiles allowed by `allow(i)`. Falls back to 1x1 rocks.
 * @returns {boolean}
 */
export function coverWithDecor(b, x, y, z, allow, preferBig = true) {
  const t = terrainAt(b, x, y, z);
  const list = decorFor(t);
  if (!list.length) return false;
  const cands = shuffle(b.rng, list.slice());
  if (preferBig) cands.sort((a, c) => c.size[0] * c.size[1] - a.size[0] * a.size[1]);
  for (const def of cands) {
    const [w, h] = def.size;
    // try entrance positions so that (x, y) is inside the footprint
    const ox = Math.floor(w / 2);
    for (let ey = y; ey < y + h; ey++) {
      for (let ex = x - (w - 1 - ox); ex <= x + ox; ex++) {
        const pos = { x: ex, y: ey, z };
        if (!canPlace(b, def, pos, { spacing: 0, needAccess: false })) continue;
        let okk = true;
        for (const f of getFootprint(def, pos)) {
          const fi = idxOf(b, f.x, f.y);
          if (!allow(fi) || b.map.tiles[z][f.y][f.x].t !== t) { okk = false; break; }
        }
        if (!okk) continue;
        place(b, def.id, pos);
        return true;
      }
    }
  }
  return false;
}

/** Weighted random pick helper re-exported for the generator modules. */
export function wpick(rng, items, weightFn) {
  return weightedPick(rng, items, items.map(weightFn));
}

export { pick, shuffle, rand };

// ---- blueprint -----------------------------------------------------------------------------------

/** Finish: plain JSON MapBlueprint (DESIGN.md §8). */
export function toBlueprint(b, meta, extra = {}) {
  const map = JSON.parse(JSON.stringify(b.map));
  return {
    map,
    towns: b.towns.map((t) => ({ ...t, pos: { ...t.pos } })),
    heroes: b.heroes.map((h) => ({ ...h, pos: { ...h.pos } })),
    meta,
    ...extra,
  };
}
