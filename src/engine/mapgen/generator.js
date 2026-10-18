// Random map generator pipeline (docs/mechanics/mapgen.md §4):
// template -> zone graph -> layout -> water/terrain -> passages -> towns -> networks/roads ->
// gates/monoliths -> mines -> treasure piles + guards -> specials -> obstacles -> rivers -> blueprint.
import { FACTIONS, RARE_RESOURCES } from '../../core/constants.js';
import { createRng, rand, randInt, pick, shuffle, weightedPick } from '../../core/rng.js';
import { getTerrain, SURFACE_TERRAINS } from '../../data/terrain.js';
import { getFaction } from '../../data/factions.js';
import { getMapObject, TWO_WAY_COLORS, MONOLITH_COLORS, KEY_COLORS } from '../../data/mapObjects.js';
import { getArtifact } from '../../data/artifacts.js';
import { removeObject, rollSpell } from '../adventure/index.js';
import {
  createBuilder, idxOf, inside, terrainAt, setTerrain, isLand, isWater, reserve, shortestPath, makeNoise,
  canPlace, place, placeConnected, connect, accessOf, canPlaceTown, placeTown, placeMonster, coverWithDecor,
  toBlueprint, OCC_FREE, OCC_KEEP, NEIGHBOURS8,
} from './builder.js';
import { forceLayout, assignZones, zoneAdjacency } from './layout.js';
import { expandTemplate, getTemplate, BANDS } from './templates.js';
import { guardStrength, pickGuard, POOL, SEER_POOL, composePile, MIN_GUARD_STRENGTH } from './treasure.js';

export const MAP_SIZES = { S: 36, M: 72, L: 108, XL: 144, H: 180, XH: 216, G: 252 };
const MINE_DEF = { wood: 'sawmill', ore: 'ore_pit', mercury: 'alchemists_lab', sulfur: 'sulfur_dune', crystal: 'crystal_cavern', gems: 'gem_pond', gold: 'gold_mine' };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TERRAIN_WEIGHT = { dirt: 1, sand: 0.6, grass: 1, snow: 0.7, swamp: 0.6, rough: 1, lava: 0.8, highlands: 1, wasteland: 0.9 };

/** Surface terrain for a faction's home zone (Dungeon's cave floor only exists underground). */
export function nativeSurfaceTerrain(faction) {
  const t = getFaction(faction).nativeTerrain;
  return getTerrain(t).surface ? t : 'dirt';
}

function hashSeed(seed, attempt) {
  let x = (seed >>> 0) ^ Math.imul(attempt + 1, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) || 1;
}

/** Normalise the `generateMap` options (names used by the new-game screen, see newGameModel.js). */
export function normalizeOptions(o = {}) {
  const slots = o.playerSlots || [];
  const size = MAP_SIZES[o.size] ? o.size : null;
  const width = size ? MAP_SIZES[size] : (o.width || 72);
  const height = size ? MAP_SIZES[size] : (o.height || width);
  const players = o.players || slots.length || 2;
  const factions = [];
  const heroes = [];
  for (let i = 0; i < players; i++) {
    factions.push((o.factions && o.factions[i]) || (slots[i] && slots[i].faction) || 'random');
    heroes.push((slots[i] && slots[i].hero) || 'random');
  }
  return {
    size: size || `${width}x${height}`, width, height,
    levels: o.levels || (o.underground ? 2 : 1),
    water: ['none', 'normal', 'islands'].includes(o.water) ? o.water : 'normal',
    monsters: ['weak', 'normal', 'strong', 'none'].includes(o.monsterStrength || o.monsters) ? (o.monsterStrength || o.monsters) : 'normal',
    template: o.template || 'default',
    players, factions, heroes,
    teams: o.teams || null,
    seed: (Number(o.seed) >>> 0) || 1,
    name: o.name || null,
  };
}

// ------------------------------------------------------------------------------------------------

/**
 * Generate a random map blueprint. Retries a few sub-seeds until `validate` accepts the map.
 * @returns {object} MapBlueprint or `{ ok: false, error }`
 */
export function generateRandomMap(options, validate) {
  const opts = normalizeOptions(options);
  const tpl = getTemplate(opts.template);
  if (!tpl) return { ok: false, error: `unknown template: ${opts.template}` };
  if (opts.players < tpl.players[0] || opts.players > tpl.players[1]) {
    return { ok: false, error: `template ${tpl.name} supports ${tpl.players[0]}-${tpl.players[1]} players` };
  }
  if (opts.players < 1 || opts.players > 8) return { ok: false, error: 'between 1 and 8 players are supported' };
  if (opts.width < 24 || opts.height < 24 || opts.width > 256 || opts.height > 256) return { ok: false, error: 'map size out of range' };
  let lastError = 'generation failed';
  for (let attempt = 0; attempt < 6; attempt++) {
    const rng = createRng(hashSeed(opts.seed, attempt));
    let bp;
    try {
      bp = generateOnce(opts, tpl, rng);
    } catch (err) {
      if (!(err instanceof GenError)) throw err;
      lastError = err.message;
      if (globalThis.process?.env?.MAPGEN_DEBUG) console.log('attempt', attempt, lastError);
      continue;
    }
    bp.meta.attempt = attempt;
    if (!validate) return bp;
    const v = validate(bp);
    if (v.ok) return bp;
    lastError = v.errors[0];
    if (globalThis.process?.env?.MAPGEN_DEBUG) console.log('attempt', attempt, v.errors.slice(0, 5));
  }
  const hint = /too small|no room/.test(lastError) ? ' - try a bigger map or fewer players' : '';
  return { ok: false, error: `could not generate a valid map (${lastError})${hint}` };
}

class GenError extends Error {}
const fail = (msg) => { throw new GenError(msg); };

function generateOnce(opts, tpl, rng) {
  const { width: W, height: H, levels: L } = opts;
  const water = L >= 1 ? (tpl.water || opts.water) : 'none';
  const b = createBuilder({ width: W, height: H, levels: L, rng });
  const ctx = { b, rng, opts, tpl, water, W, H, L, zones: [], links: [], gates: [], guards: [], monolithColors: TWO_WAY_COLORS.slice(), oneWayColors: MONOLITH_COLORS.slice(), keyColors: KEY_COLORS.slice() };

  // 1. zone graph ------------------------------------------------------------------------------
  const graph = expandTemplate(tpl, opts.players, rng);
  // random factions: prefer ones nobody else plays
  const fixed = opts.factions.filter((f) => FACTIONS.includes(f));
  const factions = opts.factions.map((f) => {
    if (f && f !== 'random' && FACTIONS.includes(f)) return f;
    const free = FACTIONS.filter((x) => !fixed.includes(x));
    const choice = pick(rng, free.length ? free : FACTIONS);
    fixed.push(choice);
    return choice;
  });
  ctx.factions = factions;
  const zones = graph.zones.map((z, i) => ({ ...z, idx: i, level: 0, factions: [] }));
  const byId = Object.fromEntries(zones.map((z) => [z.id, z]));
  const links = graph.links.map((l) => ({ ...l, za: byId[l.a], zb: byId[l.b] }));
  for (const z of zones) {
    if (z.type === 'start') { z.faction = factions[z.owner]; z.factions.push(z.faction); }
    z.townFactions = [];
    for (let k = 0; k < (z.towns?.neutral || 0); k++) z.townFactions.push(pick(rng, FACTIONS));
    z.factions.push(...z.townFactions);
  }
  if (L === 2) {
    const surf = zones.slice();
    for (const s of surf) {
      const u = {
        id: `${s.id}_under`, idx: zones.length, level: 1, type: 'treasure', size: s.size, mirrorOf: s.idx,
        terrain: 'under', monsters: s.monsters === 'none' ? 'none' : (s.type === 'start' ? 'normal' : s.monsters),
        towns: { neutral: s.size >= 20 && rand(rng) < 0.3 ? 1 : 0 }, mines: { rare: 1 }, treasure: BANDS.under, factions: [],
      };
      u.townFactions = u.towns.neutral ? [pick(rng, ['dungeon', 'inferno', 'necropolis', 'dungeon'])] : [];
      u.factions.push(...u.townFactions);
      s.under = u;
      zones.push(u);
    }
    for (const l of links.slice()) {
      links.push({ a: l.za.under.id, b: l.zb.under.id, za: l.za.under, zb: l.zb.under, guard: Math.max(3000, l.guard || 0), wide: false });
    }
    let gates = surf.filter((s) => s.type === 'start' || rand(rng) < 0.5);
    if (gates.length < 2) gates = surf.slice(0, Math.min(2, surf.length));
    ctx.gates = gates.map((s) => ({ s, u: s.under, guard: s.type === 'start' ? 3000 : 5000 }));
  }
  ctx.zones = zones; ctx.links = links;

  // 2. layout ----------------------------------------------------------------------------------
  const surf = zones.filter((z) => z.level === 0);
  const edges = links.filter((l) => l.za.level === 0 && l.zb.level === 0).map((l) => ({ ia: surf.indexOf(l.za), ib: surf.indexOf(l.zb) }));
  let best = null;
  for (let t = 0; t < 6; t++) {
    const nodes = forceLayout(rng, surf, edges);
    const assign = assignZones(rng, W, H, nodes, surf.map((z) => z.size));
    const adj = zoneAdjacency(assign, W, H);
    const miss = edges.filter((e) => !adj.has(e.ia < e.ib ? `${e.ia}|${e.ib}` : `${e.ib}|${e.ia}`)).length;
    if (!best || miss < best.miss) best = { nodes, assign, miss };
    if (miss === 0) break;
  }
  for (let i = 0; i < W * H; i++) {
    const s = surf[best.assign[i]];
    b.zone[0][i] = s.idx;
    if (L === 2) b.zone[1][i] = s.under.idx;
  }

  // 3. water & terrain --------------------------------------------------------------------------
  paintWater(ctx);
  paintTerrain(ctx);
  if (L === 2) carveCaves(ctx);
  for (const z of zones) collectZone(ctx, z);
  markBorders(ctx);
  computeBorderDistance(ctx);

  // 4. passages ---------------------------------------------------------------------------------
  const fallback = [];
  for (const l of links) {
    if (l.za.level !== l.zb.level) continue;
    if (water === 'islands' && l.za.level === 0) continue;
    if (!makePassage(ctx, l)) fallback.push(l);
  }
  const monolithLinks = [];
  for (const l of fallback) {
    if (ctx.monolithColors.length) { l.monolith = ctx.monolithColors.shift(); monolithLinks.push(l); } else carveLink(ctx, l);
  }
  if (L === 2) {
    for (let i = 0; i < W * H; i++) {
      if (b.border[1][i] && !b.resv[1][i]) setTerrain(b, i % W, (i / W) | 0, 1, 'rock');
    }
  }

  // 5. towns & heroes ---------------------------------------------------------------------------
  for (const z of zones.filter((zz) => zz.type === 'start')) placeZoneTowns(ctx, z);
  for (const z of zones.filter((zz) => zz.type !== 'start')) placeZoneTowns(ctx, z);
  if (water === 'islands') for (const z of zones.filter((zz) => zz.level === 0)) islandLanding(ctx, z);

  // 6. networks & roads -------------------------------------------------------------------------
  for (const z of zones) buildNetwork(ctx, z);

  // 7. connection guards, monoliths, gates -------------------------------------------------------
  for (const l of links) if (l.passage) guardPassage(ctx, l);
  for (const l of monolithLinks) placeMonolithLink(ctx, l);
  for (const g of ctx.gates) placeGatePair(ctx, g);
  ctx.gates = ctx.gates.filter((g) => !g.failed);
  if (L === 2 && !ctx.gates.length) fail('no subterranean gate fits');
  for (const g of ctx.gates) { g.objS.data.pair = g.objU.id; g.objU.data.pair = g.objS.id; }

  // 8. mines, grail, treasure, specials ---------------------------------------------------------
  for (const z of zones) placeMines(ctx, z);
  if (water !== 'none') placeShipyards(ctx);
  placeGrailAndObelisks(ctx);
  for (const z of zones) placeTreasure(ctx, z);
  if (water !== 'none') placeWaterTreasure(ctx);
  placeSeerHuts(ctx);

  // 9. obstacles & rivers -----------------------------------------------------------------------
  fillBorders(ctx);
  fillInterior(ctx);
  if (water !== 'islands') drawRivers(ctx);

  // 10. blueprint -------------------------------------------------------------------------------
  return finish(ctx);
}

// ---- water & terrain ----------------------------------------------------------------------------

function paintWater(ctx) {
  const { b, rng, W, H, water } = ctx;
  if (water === 'none') return;
  const band = Math.max(2, Math.round(W * (water === 'islands' ? 0.04 : 0.06)));
  const noise = makeNoise(rng, W, H, Math.max(4, Math.round(W / 10)));
  let near = null;
  if (water === 'islands') {
    // distance (4-steps) to the nearest tile of another zone
    near = new Int32Array(W * H).fill(1 << 20);
    const q = [];
    for (let i = 0; i < W * H; i++) {
      const x = i % W; const y = (i / W) | 0;
      for (const [dx, dy] of N4) {
        const ax = x + dx; const ay = y + dy;
        if (inside(b, ax, ay) && b.zone[0][ay * W + ax] !== b.zone[0][i]) { near[i] = 0; q.push(i); break; }
      }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]; const x = i % W; const y = (i / W) | 0;
      for (const [dx, dy] of N4) {
        const ax = x + dx; const ay = y + dy;
        if (!inside(b, ax, ay)) continue;
        const j = ay * W + ax;
        if (near[j] > near[i] + 1) { near[j] = near[i] + 1; q.push(j); }
      }
    }
  }
  const half = Math.max(W < 72 ? 1 : 2, Math.round(W / 40));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = Math.min(x, y, W - 1 - x, H - 1 - y);
      let wet = e + (noise[i] - 0.5) * band * 1.6 < band * 0.9;
      if (near && near[i] + (noise[i] - 0.5) * 2 < half) wet = true;
      if (wet) setTerrain(b, x, y, 0, 'water');
    }
  }
  if (water === 'normal') {
    // a few lakes inside treasure zones
    for (const z of ctx.zones) {
      if (z.level !== 0 || z.type === 'start' || rand(rng) > 0.35) continue;
      const tiles = [];
      for (let i = 0; i < W * H; i++) if (b.zone[0][i] === z.idx && getTerrain(terrainAt(b, i % W, (i / W) | 0, 0)).water === false) tiles.push(i);
      if (tiles.length < 120) continue;
      const c = pick(rng, tiles);
      const cx = c % W; const cy = (c / W) | 0;
      const r = randInt(rng, 2, 4);
      for (let y = cy - r - 1; y <= cy + r + 1; y++) {
        for (let x = cx - r - 1; x <= cx + r + 1; x++) {
          if (!inside(b, x, y) || b.zone[0][y * W + x] !== z.idx) continue;
          if (Math.hypot(x - cx, y - cy) + (noise[y * W + x] - 0.5) * 2 <= r) setTerrain(b, x, y, 0, 'water');
        }
      }
    }
  }
  // no single-tile puddles
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isWater(b, x, y, 0)) continue;
      let n = 0;
      for (const [dx, dy] of N4) if (isWater(b, x + dx, y + dy, 0)) n++;
      if (n <= 1 && x > 0 && y > 0 && x < W - 1 && y < H - 1) setTerrain(b, x, y, 0, 'grass');
    }
  }
}

function pickZoneTerrain(ctx, z) {
  const { rng } = ctx;
  if (z.terrain === 'under') return rand(rng) < 0.75 ? 'subterranean' : 'lava';
  if (z.terrain === 'native' && z.faction) return nativeSurfaceTerrain(z.faction);
  if (Array.isArray(z.terrain)) return pick(rng, z.terrain);
  if (z.terrain && z.terrain !== 'random' && z.terrain !== 'native') return z.terrain;
  if (z.townFactions.length && rand(rng) < 0.7) return nativeSurfaceTerrain(z.townFactions[0]);
  const list = SURFACE_TERRAINS;
  return weightedPick(rng, list, list.map((t) => TERRAIN_WEIGHT[t] ?? 1));
}

function paintTerrain(ctx) {
  const { b, W, H, L } = ctx;
  for (const z of ctx.zones) z.terrainId = pickZoneTerrain(ctx, z);
  const byIdx = ctx.zones;
  for (let z = 0; z < L; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (isWater(b, x, y, z)) continue;
        setTerrain(b, x, y, z, byIdx[b.zone[z][y * W + x]].terrainId);
      }
    }
  }
}

function carveCaves(ctx) {
  const { b, rng, W, H } = ctx;
  const noise = makeNoise(rng, W, H, 5);
  // distance to the nearest zone boundary: keep the contact areas open so passages fit
  const d = new Int16Array(W * H).fill(99);
  const q = [];
  for (let i = 0; i < W * H; i++) {
    const x = i % W; const y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const ax = x + dx; const ay = y + dy;
      if (inside(b, ax, ay) && b.zone[1][ay * W + ax] !== b.zone[1][i]) { d[i] = 0; q.push(i); break; }
    }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h]; const x = i % W; const y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const ax = x + dx; const ay = y + dy;
      if (!inside(b, ax, ay)) continue;
      const j = ay * W + ax;
      if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); }
    }
  }
  for (let i = 0; i < W * H; i++) {
    const x = i % W; const y = (i / W) | 0;
    const e = Math.min(x, y, W - 1 - x, H - 1 - y);
    if ((noise[i] > 0.63 && d[i] > 3) || e === 0) setTerrain(b, x, y, 1, 'rock');
  }
}

/** Keep the zone's largest 8-connected land piece; record its tiles and centre. */
function collectZone(ctx, z) {
  const { b, W, H } = ctx;
  const lv = z.level;
  const N = W * H;
  const seen = new Uint8Array(N);
  const comps = [];
  for (let i = 0; i < N; i++) {
    if (seen[i] || b.zone[lv][i] !== z.idx || !isLand(b, i % W, (i / W) | 0, lv)) continue;
    const comp = [i]; seen[i] = 1;
    for (let h = 0; h < comp.length; h++) {
      const c = comp[h]; const x = c % W; const y = (c / W) | 0;
      for (const [dx, dy] of NEIGHBOURS8) {
        const ax = x + dx; const ay = y + dy;
        if (!inside(b, ax, ay)) continue;
        const j = ay * W + ax;
        if (seen[j] || b.zone[lv][j] !== z.idx || !isLand(b, ax, ay, lv)) continue;
        seen[j] = 1; comp.push(j);
      }
    }
    comps.push(comp);
  }
  comps.sort((a, c) => c.length - a.length);
  z.tiles = comps[0] || [];
  for (const comp of comps.slice(1)) {
    for (const i of comp) {
      const x = i % W; const y = (i / W) | 0;
      if (lv === 1) { setTerrain(b, x, y, 1, 'rock'); continue; }
      let wet = false;
      for (const [dx, dy] of NEIGHBOURS8) if (isWater(b, x + dx, y + dy, 0)) wet = true;
      if (wet) setTerrain(b, x, y, 0, 'water'); else b.border[0][i] = 1;
    }
  }
  z.water = [];
  if (lv === 0) for (let i = 0; i < N; i++) if (b.zone[0][i] === z.idx && isWater(b, i % W, (i / W) | 0, 0)) z.water.push(i);
  let sx = 0; let sy = 0;
  for (const i of z.tiles) { sx += i % W; sy += (i / W) | 0; }
  z.area = z.tiles.length;
  z.center = z.area ? { x: Math.round(sx / z.area), y: Math.round(sy / z.area), z: lv } : { x: W >> 1, y: H >> 1, z: lv };
  if (z.area < (z.type === 'start' ? 50 : 16)) fail(`zone ${z.id} is too small`);
}

function wallSide(a, o) {
  return a.tiles.length > o.tiles.length || (a.tiles.length === o.tiles.length && a.idx < o.idx);
}

function markBorders(ctx) {
  const { b, W, H, L } = ctx;
  const thin = W * H < 72 * 72;
  for (let lv = 0; lv < L; lv++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!isLand(b, x, y, lv)) continue;
        const zn = b.zone[lv][i];
        for (const [dx, dy] of NEIGHBOURS8) {
          const ax = x + dx; const ay = y + dy;
          if (!inside(b, ax, ay) || !isLand(b, ax, ay, lv)) continue;
          const other = b.zone[lv][ay * W + ax];
          if (other === zn) continue;
          // small maps: one-tile walls on the side of the bigger zone; otherwise both sides
          if (!thin || wallSide(ctx.zones[zn], ctx.zones[other])) { b.border[lv][i] = 1; break; }
        }
      }
    }
  }
  // zone tile lists exclude borders from now on; keep only the largest connected inner piece
  for (const z of ctx.zones) {
    const lv = z.level;
    const inner = new Set(z.tiles.filter((i) => !b.border[lv][i]));
    let best = [];
    const seen = new Set();
    for (const i of inner) {
      if (seen.has(i)) continue;
      const comp = [i]; seen.add(i);
      for (let h = 0; h < comp.length; h++) {
        const c = comp[h]; const x = c % W; const y = (c / W) | 0;
        for (const [dx, dy] of NEIGHBOURS8) {
          const j = (y + dy) * W + x + dx;
          if (x + dx < 0 || x + dx >= W || y + dy < 0 || y + dy >= H || seen.has(j) || !inner.has(j)) continue;
          seen.add(j); comp.push(j);
        }
      }
      if (comp.length > best.length) best = comp;
    }
    const keep = new Set(best);
    for (const i of inner) if (!keep.has(i)) b.border[lv][i] = 1;
    z.inner = z.tiles.filter((i) => keep.has(i));
    if (z.inner.length < (z.type === 'start' ? 40 : 12)) fail(`zone ${z.id} is too small`);
  }
}

/** Distance from every land tile to the nearest non-zone / border / water tile (per level). */
function computeBorderDistance(ctx) {
  const { b, W, H, L } = ctx;
  ctx.bdist = [];
  for (let lv = 0; lv < L; lv++) {
    const d = new Int16Array(W * H).fill(999);
    const q = [];
    for (let i = 0; i < W * H; i++) {
      const x = i % W; const y = (i / W) | 0;
      if (!isLand(b, x, y, lv) || b.border[lv][i] || x === 0 || y === 0 || x === W - 1 || y === H - 1) { d[i] = 0; q.push(i); }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]; const x = i % W; const y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBOURS8) {
        const ax = x + dx; const ay = y + dy;
        if (!inside(b, ax, ay)) continue;
        const j = ay * W + ax;
        if (d[j] > d[i] + 1) { d[j] = d[i] + 1; q.push(j); }
      }
    }
    ctx.bdist.push(d);
  }
}

// ---- passages -----------------------------------------------------------------------------------

function hasInnerNeighbour(ctx, i, zn, lv) {
  const { b, W } = ctx;
  const x = i % W; const y = (i / W) | 0;
  for (const [dx, dy] of NEIGHBOURS8) {
    const ax = x + dx; const ay = y + dy;
    if (!inside(b, ax, ay)) continue;
    const j = ay * W + ax;
    if (b.zone[lv][j] === zn && !b.border[lv][j] && isLand(b, ax, ay, lv)) return true;
  }
  return false;
}

function makePassage(ctx, l) {
  const { b, W, H, rng } = ctx;
  const lv = l.za.level;
  const inB = new Set(l.zb.tiles);
  const cands = [];
  for (const i of l.za.tiles) {
    if (!b.border[lv][i]) continue;
    const x = i % W; const y = (i / W) | 0;
    if (x < 2 || y < 2 || x > W - 3 || y > H - 3) continue;
    if (b.resv[lv][i] || !hasInnerNeighbour(ctx, i, l.za.idx, lv)) continue;
    for (const [dx, dy] of N4) {
      const j = (y + dy) * W + x + dx;
      if (!inB.has(j) || b.resv[lv][j] || !hasInnerNeighbour(ctx, j, l.zb.idx, lv)) continue;
      // keep clear of other passages
      let clash = false;
      for (const p of ctx.passageTiles || []) if (p.z === lv && Math.abs(p.x - x) <= 4 && Math.abs(p.y - y) <= 4) clash = true;
      if (!clash) cands.push([i, j]);
    }
  }
  if (!cands.length) return false;
  const mx = cands.reduce((s, c) => s + (c[0] % W), 0) / cands.length;
  const my = cands.reduce((s, c) => s + ((c[0] / W) | 0), 0) / cands.length;
  cands.sort((p, q) => Math.hypot((p[0] % W) - mx, ((p[0] / W) | 0) - my) - Math.hypot((q[0] % W) - mx, ((q[0] / W) | 0) - my));
  const [ia, ib] = cands[Math.min(cands.length - 1, randInt(rng, 0, 2))];
  const pa = { x: ia % W, y: (ia / W) | 0, z: lv };
  const pb = { x: ib % W, y: (ib / W) | 0, z: lv };
  reserve(b, pa.x, pa.y, lv); reserve(b, pb.x, pb.y, lv);
  const groupA = [ia]; const groupB = [ib];
  if (l.wide) {
    for (const [ca, cb] of cands) {
      if (Math.abs((ca % W) - pa.x) <= 1 && Math.abs(((ca / W) | 0) - pa.y) <= 1) {
        reserve(b, ca % W, (ca / W) | 0, lv); reserve(b, cb % W, (cb / W) | 0, lv);
        groupA.push(ca); groupB.push(cb);
      }
    }
  }
  l.passage = { a: pa, b: pb };
  (l.za.seeds ??= []).push(groupA);
  (l.zb.seeds ??= []).push(groupB);
  (ctx.passageTiles ??= []).push(pa);
  return true;
}

/** Last resort for zones that do not touch: a reserved corridor straight through the map. */
function carveLink(ctx, l) {
  const { b, W } = ctx;
  const lv = l.za.level;
  const src = idxOf(b, l.za.center.x, l.za.center.y);
  const dstSet = new Set(l.zb.inner.length ? l.zb.inner : l.zb.tiles);
  const path = shortestPath(b, [nearestOf(ctx, l.za, src)], {
    pass: (j) => isLand(b, j % W, (j / W) | 0, lv) && (b.occ[lv][j] === OCC_FREE || b.resv[lv][j]),
    target: (j) => dstSet.has(j),
    cost: (j) => (b.zone[lv][j] === l.za.idx || b.zone[lv][j] === l.zb.idx ? 1 : 4),
  });
  if (!path) fail(`cannot connect ${l.a} and ${l.b}`);
  const groups = {};
  for (const j of path) {
    reserve(b, j % W, (j / W) | 0, lv);
    b.border[lv][j] = 0;
    const zn = b.zone[lv][j];
    (groups[zn] ??= []).push(j);
  }
  for (const [zn, g] of Object.entries(groups)) (ctx.zones[zn].seeds ??= []).push(g);
  const guardAt = path.find((j) => b.zone[lv][j] !== l.za.idx);
  if (guardAt != null) l.passage = { a: { x: path[0] % W, y: (path[0] / W) | 0, z: lv }, b: { x: guardAt % W, y: (guardAt / W) | 0, z: lv } };
  l.carved = true;
}

function nearestOf(ctx, z, i) {
  const { W } = ctx;
  const list = z.inner.length ? z.inner : z.tiles;
  let best = list[0]; let bd = Infinity;
  for (const j of list) {
    const d = Math.abs((j % W) - (i % W)) + Math.abs(((j / W) | 0) - ((i / W) | 0));
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

// ---- towns ----------------------------------------------------------------------------------------

function candidatesNear(ctx, z, target, { minDist = 0, maxDist = Infinity, minBorder = 0, jitter = 1.5, list = null } = {}) {
  const { W, rng } = ctx;
  const bd = ctx.bdist[z.level];
  const out = [];
  for (const i of list || z.inner) {
    const x = i % W; const y = (i / W) | 0;
    const d = Math.hypot(x - target.x, y - target.y);
    if (d < minDist || d > maxDist || bd[i] < minBorder) continue;
    out.push({ x, y, z: z.level, k: d + rand(rng) * jitter });
  }
  out.sort((a, c) => a.k - c.k);
  return out;
}

function placeZoneTowns(ctx, z) {
  const { b, opts } = ctx;
  const sites = [];
  const tryTown = (target, far, entry) => {
    for (const [minBorder, sep] of [[4, 10], [3, 8], [2, 7], [1, 6]]) {
      let cands = candidatesNear(ctx, z, target, { minBorder, jitter: far ? 4 : 1.5 });
      if (far) cands = cands.filter((c) => sites.every((st) => Math.hypot(st.x - c.x, st.y - c.y) >= sep)).reverse();
      for (const c of cands) {
        if (!canPlaceTown(b, c, z.idx)) continue;
        const t = placeTown(b, c, entry);
        (z.seeds ??= []).push(forecourt(ctx, c));
        sites.push(c);
        return t;
      }
    }
    // a neutral town that does not fit is dropped; a player's home town must fit
    if (entry.ownerSlot != null) fail(`no room for a town in zone ${z.id}`);
    return null;
  };
  z.townList = [];
  if (z.type === 'start') {
    const t = tryTown(z.center, false, { faction: z.faction, ownerSlot: z.owner });
    z.mainTown = t;
    z.townList.push(t);
    const defId = opts.heroes[z.owner] || 'random';
    b.heroes.push({ ownerSlot: z.owner, pos: { ...t.pos }, defId });
    if (defId !== 'random') b.gs.heroes[`start_${z.owner}`] = { id: `start_${z.owner}`, defId }; // keeps prisons from rolling him
  }
  for (const f of z.townFactions) {
    const t = tryTown(sites.length ? sites[0] : z.center, sites.length > 0, { faction: f, ownerSlot: null });
    if (!t) continue;
    if (!z.mainTown) z.mainTown = t;
    z.townList.push(t);
  }
}

function forecourt(ctx, pos) {
  const { b, W } = ctx;
  const g = [];
  for (const dx of [-1, 0, 1]) {
    const i = (pos.y + 1) * W + pos.x + dx;
    if (b.resv[pos.z][i]) g.push(i);
  }
  return g;
}

/** Islands: a reserved landing tile on the coast near the zone centre (+ a boat for start zones). */
function islandLanding(ctx, z) {
  const { b, W } = ctx;
  if (!z.tiles.length) return;
  const coast = z.inner.filter((i) => {
    const x = i % W; const y = (i / W) | 0;
    return NEIGHBOURS8.some(([dx, dy]) => isWater(b, x + dx, y + dy, 0)) && b.occ[0][i] === OCC_FREE;
  });
  if (!coast.length) fail(`island ${z.id} has no coast`);
  const target = z.mainTown ? z.mainTown.pos : z.center;
  coast.sort((p, q) => Math.hypot((p % W) - target.x, ((p / W) | 0) - target.y) - Math.hypot((q % W) - target.x, ((q / W) | 0) - target.y));
  for (const i of coast) {
    const x = i % W; const y = (i / W) | 0;
    if (z.type === 'start') {
      // a boat on an adjacent free water tile
      const spot = NEIGHBOURS8.map(([dx, dy]) => ({ x: x + dx, y: y + dy, z: 0 }))
        .find((p) => isWater(b, p.x, p.y, 0) && b.occ[0][idxOf(b, p.x, p.y)] === OCC_FREE);
      if (!spot) continue;
      reserve(b, x, y, 0);
      place(b, 'boat', spot, { owner: null, data: { owner: z.owner } });
    } else {
      reserve(b, x, y, 0);
    }
    (z.seeds ??= []).push([i]);
    z.landing = { x, y, z: 0 };
    return;
  }
  fail(`island ${z.id} has no landing`);
}

// ---- network & roads ------------------------------------------------------------------------------

function buildNetwork(ctx, z) {
  const { b, W, rng } = ctx;
  const groups = (z.seeds || []).filter((g) => g.length);
  if (!groups.length) return;
  const lv = z.level;
  const roadType = lv === 1 ? 1 : (z.type === 'start' ? 3 : (z.townList && z.townList.length ? 2 : 1));
  const inTree = new Uint8Array(W * ctx.H);
  const noise = ctx.netNoise || (ctx.netNoise = makeNoise(rng, W, ctx.H, 4));
  const bd = ctx.bdist[lv];
  const first = groups[0];
  for (const i of first) inTree[i] = 1;
  const cx = (first[0] % W); const cy = ((first[0] / W) | 0);
  const rest = groups.slice(1).sort((p, q) => Math.hypot((p[0] % W) - cx, ((p[0] / W) | 0) - cy) - Math.hypot((q[0] % W) - cx, ((q[0] / W) | 0) - cy));
  const road = (i) => { if (z.road !== false) b.map.tiles[lv][(i / W) | 0][i % W].road = roadType; };
  if (groups.length > 1 || z.townList?.length) first.forEach(road);
  for (const g of rest) {
    const path = shortestPath(b, g, {
      pass: (j) => b.zone[lv][j] === z.idx && (b.resv[lv][j] || (b.occ[lv][j] === OCC_FREE && !b.border[lv][j] && isLand(b, j % W, (j / W) | 0, lv))),
      target: (j) => inTree[j] === 1,
      cost: (j) => 1 + noise[j] * 0.8 + (bd[j] <= 1 ? 1.5 : 0),
    });
    if (!path) fail(`zone ${z.id} is split`);
    for (const j of path) { reserve(b, j % W, (j / W) | 0, lv); inTree[j] = 1; road(j); }
    for (const j of g) { inTree[j] = 1; road(j); }
  }
}

// ---- guards -----------------------------------------------------------------------------------------

function zoneFactions(ctx, ...zs) {
  const out = [];
  for (const z of zs) out.push(...(z.factions || []));
  return out;
}

function addGuard(ctx, pos, strength, factions, kind, extra = {}) {
  if (strength <= 0) return null;
  const g = pickGuard(ctx.rng, strength, factions);
  const obj = placeMonster(ctx.b, pos, { ...g, ...extra });
  if (obj) ctx.guards.push({ kind, strength, creatureId: g.creatureId, count: g.count, objectId: obj.id, pos: { ...obj.pos } });
  return obj;
}

function guardPassage(ctx, l) {
  const { b, opts } = ctx;
  if (l.wide) return;
  if (l.border && ctx.keyColors.length) {
    const color = ctx.keyColors.shift();
    const tent = placeInZone(ctx, l.za, `keymasters_tent_${color}`, {}, { near: l.za.mainTown ? l.za.mainTown.pos : l.za.center, maxDist: 30 });
    if (tent) {
      place(b, `border_guard_${color}`, l.passage.b);
      l.borderColor = color;
      return;
    }
  }
  if (!l.guard) return;
  const s = guardStrength(l.guard, opts.monsters, null, true);
  addGuard(ctx, l.passage.b, s, zoneFactions(ctx, l.za, l.zb), 'connection', { disposition: 'hostile' });
}

function unplace(ctx, obj) {
  const { b } = ctx;
  const def = getMapObject(obj.defId);
  const z = obj.pos.z || 0;
  const [w, h] = def.size;
  const x0 = obj.pos.x - Math.floor(w / 2);
  for (let y = obj.pos.y - h + 1; y <= obj.pos.y; y++) for (let x = x0; x < x0 + w; x++) if (inside(b, x, y)) b.occ[z][idxOf(b, x, y)] = OCC_FREE;
  removeObject(b.gs, obj.id);
}

function placeMonolithLink(ctx, l) {
  const defId = `monolith_two_way_${l.monolith}`;
  const towardB = l.zb.center; const towardA = l.za.center;
  const A = placeInZone(ctx, l.za, defId, {}, { near: towardB, prefer: 'near' });
  if (!A) fail(`no room for a monolith in ${l.za.id}`);
  const B = placeInZone(ctx, l.zb, defId, {}, { near: towardA, prefer: 'near' });
  if (!B) fail(`no room for a monolith in ${l.zb.id}`);
  if (l.guard) addGuard(ctx, accessOf(A.pos), guardStrength(l.guard, ctx.opts.monsters, null, true), zoneFactions(ctx, l.za, l.zb), 'connection');
  l.monolithIds = [A.id, B.id];
}

function placeGatePair(ctx, g) {
  const { b } = ctx;
  const s = g.s; const u = g.u;
  const target = s.mainTown ? s.mainTown.pos : s.center;
  let surfCands = candidatesNear(ctx, s, target, { minDist: s.mainTown ? 6 : 0, minBorder: 2, jitter: 6 });
  if (surfCands.length < 40) surfCands = candidatesNear(ctx, s, target, { minDist: s.mainTown ? 4 : 0, minBorder: 1, jitter: 6 });
  let tries = 0;
  for (const c of surfCands) {
    if (++tries > 120) break;
    const A = placeConnected(b, 'subterranean_gate', c, {}, { zone: s.idx });
    if (!A) continue;
    const under = candidatesNear(ctx, u, c, { minBorder: 1, jitter: 1, maxDist: 25 }).slice(0, 150);
    let B = null;
    for (const p of under) { B = placeConnected(b, 'subterranean_gate', { x: p.x, y: p.y, z: 1 }, {}, { zone: u.idx }); if (B) break; }
    if (!B) { unplace(ctx, A); continue; }
    g.objS = A; g.objU = B;
    const st = guardStrength(g.guard, ctx.opts.monsters, null, true);
    addGuard(ctx, accessOf(B.pos), st, zoneFactions(ctx, u), 'connection');
    return;
  }
  // no room: this pair is dropped (the validator rejects the map if the underground became unreachable)
  g.failed = true;
}

// ---- generic zone placement -------------------------------------------------------------------------

/**
 * Place `defId` somewhere in zone `z` (connected to the network).
 * opts: near (pos), minDist, maxDist, prefer: 'near'|'far'|'random', water (use water tiles), freshAccess.
 */
function placeInZone(ctx, z, defId, params = {}, o = {}) {
  const { b, W, rng } = ctx;
  const def = getMapObject(defId);
  const water = def.terrains.length === 1 && def.terrains[0] === 'water';
  let list = water ? z.water : z.inner;
  if (!list || !list.length) return null;
  const near = o.near || null;
  let cands;
  if (near) {
    cands = [];
    for (const i of list) {
      const x = i % W; const y = (i / W) | 0;
      const d = Math.hypot(x - near.x, y - near.y);
      if (d < (o.minDist || 0) || d > (o.maxDist ?? Infinity)) continue;
      cands.push({ x, y, z: z.level, k: o.prefer === 'far' ? -d + rand(rng) * 4 : (o.prefer === 'random' ? rand(rng) : d + rand(rng) * 3) });
    }
    cands.sort((p, q) => p.k - q.k);
  } else {
    cands = shuffle(rng, list.slice(0, list.length)).slice(0, 600).map((i) => ({ x: i % W, y: (i / W) | 0, z: z.level }));
  }
  let tries = 0;
  for (const c of cands) {
    if (++tries > (o.maxTries || 300)) break;
    if (water) {
      if (!waterSpotOk(ctx, def, c)) continue;
      if (!canPlace(b, def, c, { zone: z.idx, needAccess: false, spacing: 1 })) continue;
      return place(b, defId, c, params);
    }
    if (o.freshAccess) {
      const a = accessOf(c);
      if (!inside(b, a.x, a.y) || b.resv[c.z][idxOf(b, a.x, a.y)]) continue;
    }
    const obj = placeConnected(b, defId, c, typeof params === 'function' ? params() : params, { zone: z.idx, maxCost: o.maxCost || 60 });
    if (obj) return obj;
  }
  return null;
}

/** Water objects keep 2 tiles of open sea around them so channels never close. */
function waterSpotOk(ctx, def, pos) {
  const { b } = ctx;
  const [w, h] = def.size;
  const x0 = pos.x - Math.floor(w / 2);
  for (let y = pos.y - h + 1 - 2; y <= pos.y + 2; y++) {
    for (let x = x0 - 2; x < x0 + w + 2; x++) {
      if (!inside(b, x, y) || !isWater(b, x, y, pos.z)) return false;
      if (b.occ[pos.z][idxOf(b, x, y)] !== OCC_FREE) return false;
    }
  }
  return true;
}

function guardObject(ctx, z, obj, value, kind) {
  const s = guardStrength(value, ctx.opts.monsters, z.monsters, false);
  if (s < MIN_GUARD_STRENGTH) return null;
  return addGuard(ctx, accessOf(obj.pos), s, zoneFactions(ctx, z), kind);
}

// ---- mines --------------------------------------------------------------------------------------------

function placeMines(ctx, z) {
  const { rng } = ctx;
  const spec = z.mines || {};
  const list = [];
  for (const r of ['wood', 'ore', 'mercury', 'sulfur', 'crystal', 'gems', 'gold']) for (let k = 0; k < (spec[r] || 0); k++) list.push(r);
  const rare = shuffle(rng, RARE_RESOURCES.slice());
  for (let k = 0; k < (spec.rare || 0); k++) list.push(rare[k % rare.length]);
  z.mineList = [];
  z.minesPlanned = list.length;
  const home = z.mainTown ? z.mainTown.pos : null;
  for (const r of list) {
    const defId = MINE_DEF[r];
    const basic = r === 'wood' || r === 'ore';
    const o = home ? (basic ? { near: home, minDist: 4, maxDist: 12 } : { near: home, minDist: 9, prefer: 'near' }) : {};
    let obj = placeInZone(ctx, z, defId, {}, { ...o, freshAccess: true });
    if (!obj && home) obj = placeInZone(ctx, z, defId, {}, { freshAccess: true });
    if (!obj) continue;
    z.mineList.push(obj.defId);
    guardObject(ctx, z, obj, getMapObject(defId).value, 'mine');
  }
}

// ---- shipyards ----------------------------------------------------------------------------------------

function placeShipyards(ctx) {
  const { b, W, rng, water } = ctx;
  for (const z of ctx.zones) {
    if (z.level !== 0 || !z.water.length) continue;
    const want = water === 'islands' ? (z.type === 'start') : (z.type === 'start' || rand(rng) < 0.3);
    if (!want) continue;
    const coastal = z.inner.filter((i) => {
      const x = i % W; const y = (i / W) | 0;
      for (let dy = -3; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) if (isWater(b, x + dx, y + dy, 0)) return true;
      return false;
    });
    const target = z.mainTown ? z.mainTown.pos : z.center;
    const cands = coastal.map((i) => ({ x: i % W, y: (i / W) | 0, z: 0, k: Math.hypot((i % W) - target.x, ((i / W) | 0) - target.y) + rand(rng) * 3 }))
      .sort((p, q) => p.k - q.k);
    let tries = 0;
    for (const c of cands) {
      if (++tries > 250) break;
      if (!launchTile(ctx, c)) continue;
      const obj = placeConnected(b, 'shipyard', c, { owner: null }, { zone: z.idx, maxCost: 60 });
      if (obj) { z.shipyard = obj.id; break; }
    }
  }
}

/** A free water tile next to a 3x2 shipyard footprint (where its boats appear). */
function launchTile(ctx, pos) {
  const { b } = ctx;
  for (let y = pos.y - 2; y <= pos.y + 1; y++) {
    for (let x = pos.x - 2; x <= pos.x + 2; x++) {
      if (isWater(b, x, y, 0) && b.occ[0][idxOf(b, x, y)] === OCC_FREE) return { x, y };
    }
  }
  return null;
}

// ---- grail & obelisks -------------------------------------------------------------------------------

function placeGrailAndObelisks(ctx) {
  const { b, W, rng } = ctx;
  const surfaceZones = ctx.zones.filter((z) => z.level === 0);
  const pool = surfaceZones.filter((z) => z.type !== 'start');
  const zone = pick(rng, pool.length ? pool : surfaceZones);
  const tiles = shuffle(rng, zone.inner.slice());
  for (const i of tiles) {
    const x = i % W; const y = (i / W) | 0;
    const tile = b.map.tiles[0][y][x];
    if (b.occ[0][i] !== OCC_FREE || b.resv[0][i] || tile.road || !getTerrain(tile.t).diggable) continue;
    place(b, 'grail', { x, y, z: 0 }, {}, OCC_KEEP);
    ctx.grail = { x, y, z: 0, zone: zone.id };
    break;
  }
  const n = Math.max(2, Math.min(8, Math.round(ctx.zones.length / 2)));
  const zs = shuffle(rng, ctx.zones.filter((z) => z.type !== 'start'));
  if (!zs.length) zs.push(...ctx.zones);
  ctx.obelisks = 0;
  for (let k = 0; k < n * 2 && ctx.obelisks < n; k++) {
    const z = zs[k % zs.length];
    if (placeInZone(ctx, z, 'obelisk', {}, {})) ctx.obelisks++;
  }
}

// ---- treasure -------------------------------------------------------------------------------------

const sizeOf = (defId) => getMapObject(defId).size;

function entryData(ctx, z, e) {
  const data = {};
  if (e.data) Object.assign(data, JSON.parse(JSON.stringify(e.data)));
  if (e.pandora) data.faction = z.factions[0] || pick(ctx.rng, FACTIONS);
  if (e.spellLevel) {
    const spellId = rollSpell(ctx.b.gs, { level: e.spellLevel });
    if (spellId) data.spellId = spellId;
  }
  return data;
}

function placeTreasure(ctx, z) {
  const { rng } = ctx;
  if (!z.inner.length) return;
  z.treasureValue = 0;
  z.counts = {};
  const home = z.mainTown ? z.mainTown.pos : null;
  for (const band of z.treasure || []) {
    const richness = 0.85 + rand(rng) * 0.3;
    const count = Math.round((z.area * band.density / 650) * richness);
    for (let k = 0; k < count; k++) {
      const pile = composePile(rng, band, POOL.land, z.factions, z.counts, sizeOf);
      if (!pile.length) continue;
      const value = pile.reduce((s, e) => s + e.value, 0);
      const o = home ? (value >= 6000 ? { near: home, minDist: 6, prefer: 'far' } : { near: home, minDist: 5, prefer: 'random' }) : {};
      const objs = pile.length === 1 ? single(ctx, z, pile[0], o) : row(ctx, z, pile, o);
      if (!objs) continue;
      for (const e of pile) z.counts[e.defId] = (z.counts[e.defId] || 0) + 1;
      z.treasureValue += value;
      if (!pile.some((e) => e.ownGuards)) guardObject(ctx, z, objs.guardAnchor, value, 'treasure');
    }
  }
}

function single(ctx, z, e, o) {
  const obj = placeInZone(ctx, z, e.defId, () => ({ data: entryData(ctx, z, e) }), { ...o, freshAccess: true });
  return obj ? { guardAnchor: obj } : null;
}

/** Two or three 1x1 objects side by side, reached (and guarded) from below the middle one. */
function row(ctx, z, pile, o) {
  const { b, W, rng } = ctx;
  const n = pile.length;
  const near = o.near;
  let list = z.inner;
  let cands;
  if (near) {
    cands = list.map((i) => ({ x: i % W, y: (i / W) | 0, d: Math.hypot((i % W) - near.x, ((i / W) | 0) - near.y) }))
      .filter((c) => c.d >= (o.minDist || 0)).map((c) => ({ ...c, k: rand(rng) })).sort((p, q) => p.k - q.k).slice(0, 300);
  } else {
    cands = shuffle(rng, list.slice()).slice(0, 300).map((i) => ({ x: i % W, y: (i / W) | 0 }));
  }
  const lv = z.level;
  for (const c of cands) {
    const xs = n === 3 ? [c.x - 1, c.x, c.x + 1] : [c.x - 1, c.x];
    let ok = true;
    for (let k = 0; k < n && ok; k++) {
      const pos = { x: xs[k], y: c.y, z: lv };
      if (!canPlace(b, pile[k].defId, pos, { zone: z.idx, spacing: 0, needAccess: false })) ok = false;
    }
    if (!ok) continue;
    // spacing ring around the whole row
    for (let y = c.y - 1; y <= c.y + 1 && ok; y++) {
      for (let x = xs[0] - 1; x <= xs[n - 1] + 1; x++) {
        if (!inside(b, x, y)) { ok = false; break; }
        const v = b.occ[lv][idxOf(b, x, y)];
        if (v === 2 || v === 3) { ok = false; break; }
      }
    }
    const acc = { x: c.x, y: c.y + 1, z: lv };
    if (!ok || !inside(b, acc.x, acc.y)) continue;
    const ai = idxOf(b, acc.x, acc.y);
    if (b.resv[lv][ai] || b.occ[lv][ai] !== OCC_FREE || b.zone[lv][ai] !== z.idx || !isLand(b, acc.x, acc.y, lv) || b.border[lv][ai]) continue;
    // mark, connect, place
    for (const x of xs) b.occ[lv][idxOf(b, x, c.y)] = 2;
    const okc = connect(b, acc, { zone: z.idx, maxCost: 60 });
    for (const x of xs) b.occ[lv][idxOf(b, x, c.y)] = OCC_FREE;
    if (!okc) continue;
    let mid = null;
    pile.forEach((e, k) => {
      const obj = place(b, e.defId, { x: xs[k], y: c.y, z: lv }, { data: entryData(ctx, z, e) });
      if (xs[k] === c.x) mid = obj;
    });
    return { guardAnchor: mid };
  }
  return null;
}

function placeWaterTreasure(ctx) {
  const { rng } = ctx;
  let total = 0;
  for (const z of ctx.zones) {
    if (z.level !== 0 || !z.water.length) continue;
    total += z.water.length;
    const count = Math.round(z.water.length * 5 / 650);
    for (let k = 0; k < count; k++) {
      const band = { min: 300, max: k % 4 === 3 ? 6000 : 2000 };
      const cands = POOL.water.filter((e) => e.value <= band.max && !(e.limit && (z.counts?.[e.defId] || 0) >= e.limit));
      if (!cands.length) break;
      const e = weightedPick(rng, cands, cands.map((x) => x.weight));
      const obj = placeInZone(ctx, z, e.defId, { data: entryData(ctx, z, e) }, {});
      if (obj) { z.counts ??= {}; z.counts[e.defId] = (z.counts[e.defId] || 0) + 1; }
    }
  }
  // a pair of whirlpools on big seas
  if (total >= 500) {
    const wz = shuffle(rng, ctx.zones.filter((z) => z.level === 0 && z.water.length > 80));
    let placed = 0;
    for (const z of wz) { if (placed >= 2) break; if (placeInZone(ctx, z, 'whirlpool', {}, {})) placed++; }
    if (placed === 1) {
      // a single whirlpool leads nowhere: remove it
      const lone = Object.values(ctx.b.map.objects).find((o) => o.defId === 'whirlpool');
      if (lone) unplace(ctx, lone);
    }
  }
}

// ---- seer huts --------------------------------------------------------------------------------------

function placeSeerHuts(ctx) {
  const { b, rng } = ctx;
  const zones = ctx.zones.filter((z) => z.type !== 'start' && z.inner.length);
  for (const z of zones) {
    if (rand(rng) > 0.5) continue;
    const maxBand = Math.max(...(z.treasure || [{ max: 3000 }]).map((t) => t.max));
    const presets = SEER_POOL.filter((p) => p.value <= maxBand);
    if (!presets.length) continue;
    const p = pick(rng, presets);
    const quest = JSON.parse(JSON.stringify(p.quest));
    const reward = JSON.parse(JSON.stringify(p.reward));
    const hut = placeInZone(ctx, z, 'seers_hut', { data: { quest, reward } }, {});
    if (!hut) continue;
    const q = hut.data.quest;
    if (q.type === 'kill_monster' && !q.objectId) { unplace(ctx, hut); continue; }
    if (q.type === 'bring_artifacts') {
      // make every requested artifact obtainable: put it somewhere else on the map, guarded
      let okk = true;
      for (const artifactId of q.artifactIds) {
        const others = shuffle(rng, ctx.zones.filter((o) => o !== z && o.inner.length));
        const host = others[0] || z;
        const cls = getArtifact(artifactId).class;
        const defId = `artifact_${['treasure', 'minor', 'major', 'relic'].includes(cls) ? cls : 'treasure'}`;
        const obj = placeInZone(ctx, host, defId, { data: { artifactId } }, { freshAccess: true });
        if (!obj) { okk = false; break; }
        b.map.placedArtifacts ??= [];
        b.map.placedArtifacts.push(artifactId);
        guardObject(ctx, host, obj, getMapObject(defId).value, 'treasure');
      }
      if (!okk) fail('could not place a quest artifact');
    }
    ctx.seerHuts = (ctx.seerHuts || 0) + 1;
  }
}

// ---- obstacles --------------------------------------------------------------------------------------

function fillBorders(ctx) {
  const { b, W, H, L } = ctx;
  for (let lv = 0; lv < L; lv++) {
    const resv = b.resv[lv]; const occ = b.occ[lv]; const border = b.border[lv]; const zone = b.zone[lv];
    for (let i = 0; i < W * H; i++) {
      if (!border[i] || resv[i] || occ[i] !== OCC_FREE) continue;
      const x = i % W; const y = (i / W) | 0;
      if (!isLand(b, x, y, lv)) continue;
      const zn = zone[i];
      const allow = (j) => !resv[j] && occ[j] === OCC_FREE && (border[j] || zone[j] === zn);
      if (!coverWithDecor(b, x, y, lv, allow, true)) b.map.tiles[lv][y][x].blocked = true;
    }
  }
}

function fillInterior(ctx) {
  const { b, W, H, L, rng } = ctx;
  for (let lv = 0; lv < L; lv++) {
    const noise = makeNoise(rng, W, H, 5);
    const resv = b.resv[lv]; const occ = b.occ[lv]; const border = b.border[lv]; const zone = b.zone[lv];
    const nearResv = (x, y) => {
      for (const [dx, dy] of NEIGHBOURS8) if (inside(b, x + dx, y + dy) && resv[idxOf(b, x + dx, y + dy)]) return true;
      return false;
    };
    for (let i = 0; i < W * H; i++) {
      if (resv[i] || occ[i] !== OCC_FREE || border[i]) continue;
      const x = i % W; const y = (i / W) | 0;
      if (!isLand(b, x, y, lv)) {
        // isolated sea rocks far from everything
        if (lv === 0 && isWater(b, x, y, 0) && rand(rng) < 0.006 && openSea(ctx, x, y)) coverWithDecor(b, x, y, 0, () => true, false);
        continue;
      }
      let p = noise[i] > 0.6 ? 0.6 : noise[i] > 0.48 ? 0.16 : 0.03;
      if (nearResv(x, y)) p *= 0.3;
      if (rand(rng) >= p) continue;
      const zn = zone[i];
      coverWithDecor(b, x, y, lv, (j) => !resv[j] && occ[j] === OCC_FREE && !border[j] && zone[j] === zn, rand(rng) < 0.5);
    }
  }
}

function openSea(ctx, x, y) {
  const { b } = ctx;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!isWater(b, x + dx, y + dy, 0) || b.occ[0][idxOf(b, x + dx, y + dy)] !== OCC_FREE) return false;
    }
  }
  return true;
}

function drawRivers(ctx) {
  const { b, W, rng } = ctx;
  for (const z of ctx.zones) {
    if (z.level !== 0 || rand(rng) > 0.35 || z.inner.length < 80) continue;
    const free = z.inner.filter((i) => b.occ[0][i] === OCC_FREE && !b.map.tiles[0][(i / W) | 0][i % W].obj);
    if (free.length < 20) continue;
    const a = pick(rng, free);
    let far = a; let fd = 0;
    for (let k = 0; k < 40; k++) {
      const c = pick(rng, free);
      const d = Math.hypot((c % W) - (a % W), ((c / W) | 0) - ((a / W) | 0));
      if (d > fd) { fd = d; far = c; }
    }
    if (fd < 10) continue;
    const path = shortestPath(b, [a], {
      pass: (j) => b.zone[0][j] === z.idx && isLand(b, j % W, (j / W) | 0, 0) && !b.map.tiles[0][(j / W) | 0][j % W].obj
        && !b.map.tiles[0][(j / W) | 0][j % W].blocked && (b.occ[0][j] === OCC_FREE || b.resv[0][j]),
      target: (j) => j === far,
      maxCost: 200,
    });
    if (!path) continue;
    for (const j of path) b.map.tiles[0][(j / W) | 0][j % W].river = 1;
    ctx.rivers = (ctx.rivers || 0) + 1;
  }
}

// ---- output -------------------------------------------------------------------------------------------

function finish(ctx) {
  const { b, opts, tpl, W, H, L, water } = ctx;
  const nameBase = opts.name || `${tpl.name} ${opts.size}${L === 2 ? '+U' : ''}`;
  const zones = ctx.zones.map((z) => ({
    id: z.id, type: z.type, level: z.level, owner: z.owner ?? null, terrain: z.terrainId, area: z.area,
    center: z.center, towns: (z.townList || []).length, mines: z.mineList || [], minesPlanned: z.minesPlanned || 0,
    treasureValue: z.treasureValue || 0, townsPlanned: (z.type === 'start' ? 1 : 0) + (z.townFactions || []).length,
    factions: z.factions,
  }));
  const objects = Object.values(b.map.objects);
  const meta = {
    name: nameBase,
    description: `${tpl.description} Random map, seed ${opts.seed}.`,
    size: opts.size, width: W, height: H, levels: L,
    template: tpl.id, playerSlots: opts.players, seed: opts.seed,
    water, monsters: opts.monsters, generated: true,
    players: ctx.factions.map((f, i) => ({ slot: i, faction: f, team: opts.teams ? opts.teams[i] ?? i : i })),
    teams: opts.teams || null,
    zones,
    links: ctx.links.map((l) => ({ a: l.a, b: l.b, guard: l.guard || 0, wide: !!l.wide, level: l.za.level,
      via: l.passage ? (l.carved ? 'corridor' : 'passage') : l.monolithIds ? 'monolith' : (water === 'islands' && l.za.level === 0 ? 'sea' : 'none'),
      border: l.borderColor || null })),
    stats: {
      objects: objects.length,
      towns: b.towns.length,
      guards: ctx.guards,
      obelisks: ctx.obelisks || 0,
      grail: ctx.grail || null,
      gates: ctx.gates.length,
      seerHuts: ctx.seerHuts || 0,
      rivers: ctx.rivers || 0,
      decor: objects.filter((o) => getMapObject(o.defId).category === 'decor').length,
    },
  };
  return toBlueprint(b, meta);
}

