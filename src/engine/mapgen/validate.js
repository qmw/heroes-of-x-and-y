// Blueprint validation (docs/mechanics/mapgen.md §7): ids, terrain, overlaps, town sites and a
// multi-modal reachability flood (walking, fighting through guards, teleports, boats) from every
// player's start.
import { FACTIONS, TERRAINS } from '../../core/constants.js';
import { TERRAIN_BY_ID } from '../../data/terrain.js';
import { MAP_OBJECT_BY_ID } from '../../data/mapObjects.js';
import { CREATURE_BY_ID } from '../../data/creatures.js';
import { ARTIFACT_BY_ID } from '../../data/artifacts.js';
import { HERO_BY_ID } from '../../data/heroes.js';
import { FACTION_BY_ID } from '../../data/factions.js';

const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const TOWN_SIZE = [5, 3];

function footprint(size, pos) {
  const [w, h] = size;
  const x0 = pos.x - Math.floor(w / 2);
  const out = [];
  for (let y = pos.y - h + 1; y <= pos.y; y++) for (let x = x0; x < x0 + w; x++) out.push({ x, y, z: pos.z || 0 });
  return out;
}

/**
 * Static model of a blueprint for path queries.
 */
function buildModel(bp) {
  const { map } = bp;
  const W = map.width; const H = map.height; const L = map.levels;
  const N = W * H;
  const key = (x, y, z) => z * N + y * W + x;
  const blocked = new Uint8Array(N * L);
  const water = new Uint8Array(N * L);
  const land = new Uint8Array(N * L);
  const entrance = new Map(); // key -> {kind:'obj'|'town', obj?, def?, town?, index?}
  for (let z = 0; z < L; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = map.tiles[z][y][x];
        const ter = TERRAIN_BY_ID[t.t];
        const k = key(x, y, z);
        if (!ter || !ter.passable) { blocked[k] = 1; continue; }
        if (ter.water) water[k] = 1; else land[k] = 1;
        if (t.blocked) blocked[k] = 1;
      }
    }
  }
  for (const obj of Object.values(map.objects || {})) {
    const def = MAP_OBJECT_BY_ID[obj.defId];
    if (!def || def.effect.type === 'grail') continue;
    const z = obj.pos.z || 0;
    if (def.blocking) {
      for (const p of footprint(def.size, obj.pos)) {
        if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
        const isEnt = p.x === obj.pos.x && p.y === obj.pos.y;
        const isExit = def.effect.type === 'teleport' && def.effect.kind === 'one_way_exit';
        if (!isEnt || (def.interact === 'none' && !isExit)) blocked[key(p.x, p.y, z)] = 1;
      }
    }
    if (def.interact !== 'none' || def.effect.type === 'teleport') entrance.set(key(obj.pos.x, obj.pos.y, z), { kind: 'obj', obj, def });
  }
  (bp.towns || []).forEach((t, index) => {
    const z = t.pos.z || 0;
    for (const p of footprint(TOWN_SIZE, t.pos)) {
      if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
      if (!(p.x === t.pos.x && p.y === t.pos.y)) blocked[key(p.x, p.y, z)] = 1;
    }
    entrance.set(key(t.pos.x, t.pos.y, z), { kind: 'town', town: t, index, size: TOWN_SIZE });
  });
  // teleports
  const tele = new Map();
  const objs = Object.values(map.objects || {});
  const byDef = {};
  for (const o of objs) (byDef[o.defId] ??= []).push(o);
  for (const o of objs) {
    const def = MAP_OBJECT_BY_ID[o.defId];
    if (!def || def.effect.type !== 'teleport') continue;
    const fx = def.effect;
    const k = key(o.pos.x, o.pos.y, o.pos.z || 0);
    let dests = [];
    if (fx.kind === 'subterranean_gate') {
      const mate = o.data && o.data.pair ? map.objects[o.data.pair] : null;
      if (mate) dests = [mate];
    } else if (fx.kind === 'two_way' || fx.kind === 'whirlpool') {
      dests = (byDef[o.defId] || []).filter((x) => x !== o);
    } else if (fx.kind === 'one_way_entrance') {
      dests = objs.filter((x) => { const d = MAP_OBJECT_BY_ID[x.defId]; return d && d.effect.type === 'teleport' && d.effect.kind === 'one_way_exit' && d.effect.channel === fx.channel; });
    }
    tele.set(k, dests.map((d) => key(d.pos.x, d.pos.y, d.pos.z || 0)));
  }
  return { W, H, L, N, key, blocked, water, land, entrance, tele };
}

/** Can a hero standing on k (or stepping from `from`) pass through tile `to`? */
function enterInfo(m, fromK, toK) {
  const e = m.entrance.get(toK);
  if (!e) return m.blocked[toK] ? 'no' : 'pass';
  const def = e.kind === 'town' ? null : e.def;
  const size = e.kind === 'town' ? e.size : def.size;
  const fromY = Math.floor((fromK % m.N) / m.W);
  const toY = Math.floor((toK % m.N) / m.W);
  const blocking = e.kind === 'town' ? true : def.blocking;
  if (e.kind === 'town') return fromY < toY ? 'no' : 'pass';
  const fx = def.effect.type;
  if (def.interact === 'adjacent' || fx === 'prison') {
    // interaction from the neighbouring tile; removable things (pickups, monsters) or opened guards can be crossed afterwards
    const crossable = def.removable || fx === 'monster' || fx === 'border_guard' || fx === 'quest_guard' || fx === 'prison';
    return crossable ? 'pass' : 'touch';
  }
  if (def.interact === 'none') return m.blocked[toK] ? 'no' : 'pass';
  if (blocking && size[1] >= 2 && fromY < toY) return 'no';
  return 'pass';
}

/**
 * Flood from the start keys. Walking and sailing as one graph: land->water only by boarding a boat
 * (or from a reached shipyard / own coastal town with a shipyard), water->land on free land tiles.
 * @returns {{reached: Uint8Array, touched: Uint8Array}}
 */
function flood(m, bp, starts, opts = {}) {
  const total = m.N * m.L;
  const reached = new Uint8Array(total);
  const touched = new Uint8Array(total); // interacted-with (adjacent objects)
  const q = [];
  const push = (k) => { if (!reached[k]) { reached[k] = 1; touched[k] = 1; q.push(k); } };
  for (const s of starts) push(s);
  const boatAt = new Set();
  const shipyards = [];
  for (const o of Object.values(bp.map.objects || {})) {
    if (o.defId === 'boat') boatAt.add(m.key(o.pos.x, o.pos.y, o.pos.z || 0));
    const def = MAP_OBJECT_BY_ID[o.defId];
    if (def && def.effect.type === 'shipyard') shipyards.push(o);
  }
  const launchFrom = new Map(); // entrance key -> water keys next to the footprint
  const addLaunch = (entK, size, pos) => {
    const out = [];
    const z = pos.z || 0;
    for (const p of footprint(size, pos)) {
      for (const [dx, dy] of N8) {
        const x = p.x + dx; const y = p.y + dy;
        if (x < 0 || y < 0 || x >= m.W || y >= m.H) continue;
        const k = m.key(x, y, z);
        if (m.water[k] && !m.blocked[k]) out.push(k);
      }
    }
    if (out.length) launchFrom.set(entK, out);
  };
  for (const o of shipyards) addLaunch(m.key(o.pos.x, o.pos.y, o.pos.z || 0), MAP_OBJECT_BY_ID[o.defId].size, o.pos);
  for (const t of opts.ownTowns || []) {
    const f = FACTION_BY_ID[t.faction];
    if (f && f.hasShipyard) addLaunch(m.key(t.pos.x, t.pos.y, t.pos.z || 0), TOWN_SIZE, t.pos);
  }
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    const z = Math.floor(k / m.N); const r = k % m.N; const x = r % m.W; const y = (r - x) / m.W;
    for (const d of m.tele.get(k) || []) push(d);
    for (const wk of launchFrom.get(k) || []) push(wk);
    const onWater = m.water[k] === 1;
    for (const [dx, dy] of N8) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.W || ny >= m.H) continue;
      const nk = m.key(nx, ny, z);
      if (reached[nk]) continue;
      if (onWater) {
        if (m.water[nk]) {
          const info = enterInfo(m, k, nk);
          if (info === 'pass') push(nk); else if (info === 'touch') touched[nk] = 1;
        } else if (m.land[nk]) {
          // landing: free tile without any object
          if (!m.blocked[nk] && !m.entrance.has(nk)) push(nk);
          else if (m.entrance.has(nk)) touched[nk] = 1;
        }
      } else if (m.land[nk]) {
        const info = enterInfo(m, k, nk);
        if (info === 'pass') push(nk); else if (info === 'touch') touched[nk] = 1;
      } else if (m.water[nk]) {
        if (boatAt.has(nk)) push(nk);
        else if (m.entrance.has(nk)) touched[nk] = 1; // water object next to the shore cannot be used from land
      }
    }
  }
  return { reached, touched };
}

function startKeys(m, bp) {
  const out = [];
  const n = bp.meta && bp.meta.playerSlots ? bp.meta.playerSlots : 0;
  for (let slot = 0; slot < n; slot++) {
    const hero = (bp.heroes || []).find((h) => h.ownerSlot === slot);
    const town = (bp.towns || []).find((t) => t.ownerSlot === slot);
    const pos = hero ? hero.pos : town ? town.pos : null;
    out.push(pos ? { slot, key: m.key(pos.x, pos.y, pos.z || 0), pos, towns: (bp.towns || []).filter((t) => t.ownerSlot === slot) } : { slot, key: null });
  }
  return out;
}

/**
 * Validate a MapBlueprint.
 * @returns {{ok: boolean, errors: string[], warnings: string[], stats: object}}
 */
export function validateBlueprint(bp, { requireAllReachable = true } = {}) {
  const errors = [];
  const warnings = [];
  const err = (m) => { if (errors.length < 50) errors.push(m); };
  if (!bp || !bp.map || !Array.isArray(bp.map.tiles)) return { ok: false, errors: ['no map'], warnings, stats: {} };
  const { map } = bp;
  const W = map.width; const H = map.height; const L = map.levels;
  if (!(W > 0 && H > 0 && (L === 1 || L === 2))) return { ok: false, errors: ['bad map dimensions'], warnings, stats: {} };
  if (map.tiles.length !== L) err('tiles: wrong number of levels');
  for (let z = 0; z < L; z++) {
    if (!map.tiles[z] || map.tiles[z].length !== H) { err(`tiles: level ${z} has wrong height`); continue; }
    for (let y = 0; y < H; y++) {
      const row = map.tiles[z][y];
      if (!row || row.length !== W) { err(`tiles: row ${z}/${y} has wrong width`); continue; }
      for (let x = 0; x < W; x++) {
        const t = row[x];
        if (!TERRAINS.includes(t.t)) err(`tile ${x},${y},${z}: unknown terrain ${t.t}`);
        if (![0, 1, 2, 3].includes(t.road)) err(`tile ${x},${y},${z}: bad road ${t.road}`);
        if (t.road && TERRAIN_BY_ID[t.t] && (TERRAIN_BY_ID[t.t].water || !TERRAIN_BY_ID[t.t].passable)) err(`tile ${x},${y},${z}: road on ${t.t}`);
      }
    }
  }
  if (errors.length) return { ok: false, errors, warnings, stats: {} };
  const slots = bp.meta && bp.meta.playerSlots;
  if (!(slots >= 1 && slots <= 8)) err('meta.playerSlots must be 1..8');

  // objects
  const owner = new Map();
  const claim = (x, y, z, who) => {
    const k = `${x},${y},${z}`;
    if (owner.has(k)) err(`${who} overlaps ${owner.get(k)} at ${k}`);
    else owner.set(k, who);
  };
  const inb = (p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H && (p.z || 0) >= 0 && (p.z || 0) < L;
  let grails = 0;
  for (const [id, obj] of Object.entries(map.objects || {})) {
    const def = MAP_OBJECT_BY_ID[obj.defId];
    if (!def) { err(`object ${id}: unknown defId ${obj.defId}`); continue; }
    if (obj.id !== id) err(`object ${id}: id mismatch`);
    if (!obj.pos || !inb(obj.pos)) { err(`object ${id}: position out of bounds`); continue; }
    if (def.effect.type === 'grail') { grails++; continue; }
    if (def.effect.type === 'event' || (!def.blocking && !def.visitable)) continue;
    const isWaterObj = def.terrains.length === 1 && def.terrains[0] === 'water';
    for (const p of footprint(def.size, obj.pos)) {
      if (!inb(p)) { err(`object ${id} (${def.id}): footprint out of bounds`); break; }
      const ter = TERRAIN_BY_ID[map.tiles[p.z][p.y][p.x].t];
      if (!ter.passable) err(`object ${id} (${def.id}) on impassable ${ter.id}`);
      else if (def.effect.type !== 'none' && ter.water !== isWaterObj) err(`object ${id} (${def.id}) on ${ter.id}`);
      claim(p.x, p.y, p.z, `${id}(${def.id})`);
    }
    if (def.visitable && def.interact !== 'none' && map.tiles[obj.pos.z || 0][obj.pos.y][obj.pos.x].obj !== id) {
      if (!(def.effect.type === 'boat' && obj.data && obj.data.heroId)) err(`object ${id}: entrance tile not marked`);
    }
    const d = obj.data || {};
    if (def.effect.type === 'monster') {
      if (!CREATURE_BY_ID[d.creatureId]) err(`monster ${id}: unknown creature ${d.creatureId}`);
      if (!(d.count >= 1)) err(`monster ${id}: bad count`);
    }
    if (d.artifactId && !ARTIFACT_BY_ID[d.artifactId]) err(`object ${id}: unknown artifact ${d.artifactId}`);
    if (d.heroDefId && !HERO_BY_ID[d.heroDefId]) err(`object ${id}: unknown hero ${d.heroDefId}`);
  }
  if (grails > 1) err('more than one grail');

  // towns & heroes
  (bp.towns || []).forEach((t, i) => {
    if (!t.pos || !inb(t.pos)) { err(`town ${i}: position out of bounds`); return; }
    if (t.faction !== 'random' && !FACTIONS.includes(t.faction)) err(`town ${i}: unknown faction ${t.faction}`);
    if (t.ownerSlot != null && !(t.ownerSlot >= 0 && t.ownerSlot < slots)) err(`town ${i}: bad ownerSlot ${t.ownerSlot}`);
    for (const p of footprint(TOWN_SIZE, t.pos)) {
      if (!inb(p)) { err(`town ${i}: footprint out of bounds`); break; }
      const ter = TERRAIN_BY_ID[map.tiles[p.z][p.y][p.x].t];
      if (!ter.passable || ter.water) err(`town ${i}: on ${ter.id}`);
      if (map.tiles[p.z][p.y][p.x].blocked) err(`town ${i}: footprint tile ${p.x},${p.y} is blocked`);
      claim(p.x, p.y, p.z, `town${i}`);
    }
  });
  (bp.heroes || []).forEach((h, i) => {
    if (!h.pos || !inb(h.pos)) { err(`hero ${i}: position out of bounds`); return; }
    if (h.defId !== 'random' && !HERO_BY_ID[h.defId]) err(`hero ${i}: unknown hero ${h.defId}`);
    if (!(h.ownerSlot >= 0 && h.ownerSlot < slots)) err(`hero ${i}: bad ownerSlot ${h.ownerSlot}`);
    const ter = TERRAIN_BY_ID[map.tiles[h.pos.z || 0][h.pos.y][h.pos.x].t];
    if (!ter.passable || ter.water) err(`hero ${i}: on ${ter.id}`);
  });
  for (let s = 0; s < (slots || 0); s++) {
    if (!(bp.towns || []).some((t) => t.ownerSlot === s) && !(bp.heroes || []).some((h) => h.ownerSlot === s)) err(`player slot ${s} has neither town nor hero`);
  }
  // gates
  const gates = Object.values(map.objects || {}).filter((o) => o.defId === 'subterranean_gate');
  for (const g of gates) {
    const mate = g.data && g.data.pair && map.objects[g.data.pair];
    if (!mate) err(`gate ${g.id} is not paired`);
    else if (mate.data.pair !== g.id || (mate.pos.z || 0) === (g.pos.z || 0)) err(`gate ${g.id}: bad pairing`);
  }
  if (errors.length) return { ok: false, errors, warnings, stats: {} };

  // reachability
  const m = buildModel(bp);
  const starts = startKeys(m, bp);
  const union = new Uint8Array(m.N * m.L);
  const unionTouch = new Uint8Array(m.N * m.L);
  for (const s of starts) {
    if (s.key == null) continue;
    const { reached, touched } = flood(m, bp, [s.key], { ownTowns: s.towns });
    for (const o of starts) {
      if (o === s || o.key == null) continue;
      if (!reached[o.key]) err(`player ${s.slot} cannot reach player ${o.slot}'s start`);
    }
    for (let k = 0; k < reached.length; k++) { if (reached[k]) union[k] = 1; if (touched[k]) unionTouch[k] = 1; }
  }
  let unreachable = 0;
  for (const obj of Object.values(map.objects || {})) {
    const def = MAP_OBJECT_BY_ID[obj.defId];
    if (def.interact === 'none' || def.category === 'decor' || def.effect.type === 'event' || def.effect.type === 'grail') continue;
    const k = m.key(obj.pos.x, obj.pos.y, obj.pos.z || 0);
    if (union[k] || unionTouch[k]) continue;
    unreachable++;
    if (requireAllReachable) err(`object ${obj.id} (${obj.defId}) at ${obj.pos.x},${obj.pos.y},${obj.pos.z || 0} is unreachable`);
    else warnings.push(`object ${obj.id} (${obj.defId}) is unreachable`);
  }
  (bp.towns || []).forEach((t, i) => {
    const k = m.key(t.pos.x, t.pos.y, t.pos.z || 0);
    if (!union[k]) err(`town ${i} is unreachable`);
  });
  const reachedTiles = union.reduce((a, v) => a + v, 0);
  return { ok: errors.length === 0, errors, warnings, stats: { reachedTiles, unreachable, objects: Object.keys(map.objects || {}).length } };
}

/** Reachable tiles (Uint8Array, index z*W*H + y*W + x) from a player slot's start; for tests/tools. */
export function reachableFrom(bp, slot) {
  const m = buildModel(bp);
  const s = startKeys(m, bp).find((x) => x.slot === slot);
  if (!s || s.key == null) return null;
  return flood(m, bp, [s.key], { ownTowns: s.towns }).reached;
}

/** Same as reachableFrom but walking only (no boats / shipyards). */
export function landReachableFrom(bp, slot) {
  const stripped = { ...bp, map: { ...bp.map, objects: Object.fromEntries(Object.entries(bp.map.objects).filter(([, o]) => o.defId !== 'boat' && !(MAP_OBJECT_BY_ID[o.defId] && MAP_OBJECT_BY_ID[o.defId].effect.type === 'shipyard'))) } };
  const m = buildModel(stripped);
  const s = startKeys(m, stripped).find((x) => x.slot === slot);
  if (!s || s.key == null) return null;
  return flood(m, stripped, [s.key], { ownTowns: [] }).reached;
}
