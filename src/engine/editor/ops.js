// Map editor operations: terrain, roads, rivers, objects / towns / heroes (docs/mechanics/editor.md §2).
// Every operation runs in one history transaction (history.js) and returns {ok, ...} | {ok:false, error}.
import { TERRAIN_BY_ID, MAGIC_TERRAIN_BY_ID } from '../../data/terrain.js';
import { MAP_OBJECT_BY_ID, MONSTER_DISPOSITIONS } from '../../data/mapObjects.js';
import { HERO_BY_ID } from '../../data/heroes.js';
import { FACTION_BY_ID } from '../../data/factions.js';
import { randInt } from '../../core/rng.js';
import { addObject, removeObject } from '../adventure/index.js';
import { beginTx } from './history.js';
import { TOWN_SIZE, rectFootprint, markObjectTiles, unmarkObjectTiles, remapConditions, remapHeroQuests } from './blueprint.js';
import { objectDataProblems, townProblems, heroProblems, OWNABLE_EFFECTS } from './data.js';

export const HERO_ID = 'hero';
export const TOWN_IDS = ['town', 'random_town'];
export const BRUSH_SIZES = [1, 2, 4];
/** Neighbour order of the masks (same as the renderer / gfx DIRS8): N, E, S, W, NE, SE, SW, NW. */
export const DIRS8 = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const kOf = (p) => `${p.x},${p.y},${p.z || 0}`;
const copyPos = (p) => ({ x: p.x, y: p.y, z: p.z || 0 });
const sameRef = (a, b) => !!a && !!b && a.kind === b.kind && (a.kind === 'object' ? a.id === b.id : a.index === b.index);

export function inBounds(bp, p) {
  const z = p.z || 0;
  return p.x >= 0 && p.y >= 0 && p.x < bp.map.width && p.y < bp.map.height && z >= 0 && z < bp.map.levels;
}
export const tileOf = (bp, p) => (inBounds(bp, p) ? bp.map.tiles[p.z || 0][p.y][p.x] : null);
const isWaterDef = (def) => def.terrains.length > 0 && def.terrains.every((t) => t === 'water');

/** Throw-away generation state for the adventure addObject (instance data rolls). */
function genState(doc) {
  return { map: doc.bp.map, rng: doc.rng, nextId: doc.nextId, players: [], heroes: {}, towns: {}, settings: {}, turn: 1, date: { day: 1, week: 1, month: 1 } };
}

// ---- lookups -------------------------------------------------------------------------------------

/** Footprint of a placeable id at an entrance position. */
export function footprintOf(defId, pos) {
  if (defId === HERO_ID) return [copyPos(pos)];
  if (TOWN_IDS.includes(defId)) return rectFootprint(TOWN_SIZE, pos);
  const def = MAP_OBJECT_BY_ID[defId];
  if (!def) return [];
  return def.effect.type === 'grail' ? [copyPos(pos)] : rectFootprint(def.size, pos);
}

const occCache = new WeakMap();
/** `{occ: Map key -> ref (objects, towns), heroes: Map key -> index}` cached per document version. */
export function occupancy(doc, { fresh = false } = {}) {
  const c = occCache.get(doc);
  if (!fresh && c && c.version === doc.version && c.map === doc.bp.map) return c;
  const occ = new Map();
  for (const obj of Object.values(doc.bp.map.objects)) {
    if (!MAP_OBJECT_BY_ID[obj.defId]) continue;
    for (const p of footprintOf(obj.defId, obj.pos)) {
      const k = kOf(p);
      if (!occ.has(k) || (p.x === obj.pos.x && p.y === obj.pos.y)) occ.set(k, { kind: 'object', id: obj.id });
    }
  }
  doc.bp.towns.forEach((t, index) => { for (const p of rectFootprint(TOWN_SIZE, t.pos)) occ.set(kOf(p), { kind: 'town', index }); });
  const heroes = new Map();
  doc.bp.heroes.forEach((h, index) => heroes.set(kOf(h.pos), index));
  const out = { version: doc.version, map: doc.bp.map, occ, heroes };
  if (!fresh) occCache.set(doc, out);
  return out;
}

/** Topmost editable thing on a tile: hero, then object (any footprint tile), then town. */
export function refAt(doc, pos) {
  const { occ, heroes } = occupancy(doc, { fresh: true });
  const k = kOf(pos);
  if (heroes.has(k)) return { kind: 'hero', index: heroes.get(k) };
  return occ.get(k) || null;
}

export function getRef(doc, ref) {
  if (!ref) return null;
  if (ref.kind === 'object') return doc.bp.map.objects[ref.id] || null;
  if (ref.kind === 'town') return doc.bp.towns[ref.index] || null;
  if (ref.kind === 'hero') return doc.bp.heroes[ref.index] || null;
  return null;
}

/** `{kind, defId, name, pos, owner}` for lists / the inspector title. */
export function describeRef(doc, ref) {
  const e = getRef(doc, ref);
  if (!e) return null;
  if (ref.kind === 'object') {
    const def = MAP_OBJECT_BY_ID[e.defId];
    return { kind: 'object', defId: e.defId, name: def ? def.name : e.defId, pos: e.pos, owner: e.owner ?? null };
  }
  if (ref.kind === 'town') {
    const f = FACTION_BY_ID[e.faction];
    return { kind: 'town', defId: e.faction === 'random' ? 'random_town' : 'town', name: e.name || `${f ? f.name : 'Random'} town`, pos: e.pos, owner: e.ownerSlot ?? null };
  }
  const hd = HERO_BY_ID[e.defId];
  return { kind: 'hero', defId: HERO_ID, name: hd ? hd.name : 'Random hero', pos: e.pos, owner: e.ownerSlot ?? null };
}

/** Every thing on the map as refs (objects, towns, heroes). */
export function listRefs(doc) {
  return [
    ...Object.keys(doc.bp.map.objects).map((id) => ({ kind: 'object', id })),
    ...doc.bp.towns.map((_, index) => ({ kind: 'town', index })),
    ...doc.bp.heroes.map((_, index) => ({ kind: 'hero', index })),
  ];
}

// ---- placement checks ----------------------------------------------------------------------------

/**
 * Terrain-only check of a footprint (also used after terrain changes).
 * @returns {string|null} error code
 */
function terrainError(bp, defId, pos) {
  const isTown = TOWN_IDS.includes(defId);
  const def = isTown || defId === HERO_ID ? null : MAP_OBJECT_BY_ID[defId];
  if (!isTown && defId !== HERO_ID && !def) return 'unknown_object';
  for (const p of footprintOf(defId, pos)) {
    const tile = tileOf(bp, p);
    if (!tile) return 'out_of_bounds';
    const ter = TERRAIN_BY_ID[tile.t];
    if (!ter || !ter.passable) return 'wrong_terrain';
    if (isTown || defId === HERO_ID) {
      if (ter.water) return 'wrong_terrain';
      if (isTown && tile.river) return 'on_river';
      continue;
    }
    if (ter.water !== isWaterDef(def)) return 'wrong_terrain';
    if (def.category !== 'decor' && tile.river) return 'on_river';
  }
  return null;
}

/**
 * Can `defId` (map object id, `town`, `random_town` or `hero`) stand with its entrance at `pos`?
 * `ignore` = a ref that does not count as an obstacle (the thing being moved).
 * @returns {{ok: boolean, error?: string, tiles: object[]}}
 */
export function canPlace(doc, defId, pos, { ignore = null } = {}) {
  const tiles = footprintOf(defId, pos);
  const terr = terrainError(doc.bp, defId, pos);
  if (terr) return { ok: false, error: terr, tiles };
  const { occ, heroes } = occupancy(doc);
  if (defId === HERO_ID) {
    const k = kOf(pos);
    if (heroes.has(k) && !sameRef({ kind: 'hero', index: heroes.get(k) }, ignore)) return { ok: false, error: 'occupied', tiles };
    const o = occ.get(k);
    if (o && !sameRef(o, ignore)) {
      const t = o.kind === 'town' ? doc.bp.towns[o.index] : null;
      if (!(t && t.pos.x === pos.x && t.pos.y === pos.y)) return { ok: false, error: 'occupied', tiles };
    }
    return { ok: true, tiles };
  }
  const isTown = TOWN_IDS.includes(defId);
  for (const p of tiles) {
    const k = kOf(p);
    const o = occ.get(k);
    if (o && !sameRef(o, ignore)) return { ok: false, error: 'occupied', tiles };
    if (heroes.has(k) && !sameRef({ kind: 'hero', index: heroes.get(k) }, ignore)) {
      if (!(isTown && p.x === pos.x && p.y === pos.y)) return { ok: false, error: 'occupied', tiles };
    }
  }
  return { ok: true, tiles };
}

// ---- terrain -------------------------------------------------------------------------------------

/** Tiles of a square brush (top-left anchored), clipped to the map. */
export function brushTiles(bp, pos, brush = 1) {
  const n = BRUSH_SIZES.includes(brush) ? brush : 1;
  const out = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
    const p = { x: pos.x + dx, y: pos.y + dy, z: pos.z || 0 };
    if (inBounds(bp, p)) out.push(p);
  }
  return out;
}

export function terrainAllowedOnLevel(terrain, z) {
  const t = TERRAIN_BY_ID[terrain];
  return !!t && (z === 0 ? t.surface : t.underground);
}

/** Set terrain on tiles inside `tx`; returns the refs removed because they no longer fit. */
function applyTerrain(doc, tx, tiles, terrain) {
  const bp = doc.bp;
  const ter = TERRAIN_BY_ID[terrain];
  const { occ, heroes } = occupancy(doc, { fresh: true });
  const affected = new Map();
  for (const p of tiles) {
    const tile = tileOf(bp, p);
    if (tile.t === terrain) continue;
    tx.tile(p.x, p.y, p.z);
    tile.t = terrain;
    if (ter.water || !ter.passable) { tile.road = 0; tile.river = 0; }
    if (tile.overlay && !(MAGIC_TERRAIN_BY_ID[tile.overlay] && MAGIC_TERRAIN_BY_ID[tile.overlay].terrains.includes(terrain))) delete tile.overlay;
    const k = kOf(p);
    const o = occ.get(k);
    if (o) affected.set(o.kind === 'object' ? `o:${o.id}` : `t:${o.index}`, o);
    if (heroes.has(k)) affected.set(`h:${heroes.get(k)}`, { kind: 'hero', index: heroes.get(k) });
  }
  const invalid = [];
  for (const ref of affected.values()) {
    const e = getRef(doc, ref);
    const id = ref.kind === 'object' ? e.defId : ref.kind === 'town' ? 'town' : HERO_ID;
    if (terrainError(bp, id, e.pos)) invalid.push(ref);
  }
  removeRefsInTx(doc, tx, invalid);
  return invalid;
}

export function paintTerrain(doc, pos, terrain, { brush = 1 } = {}) {
  if (!TERRAIN_BY_ID[terrain]) return fail('bad_terrain');
  if (!inBounds(doc.bp, pos)) return fail('out_of_bounds');
  if (!terrainAllowedOnLevel(terrain, pos.z || 0)) return fail('bad_terrain_for_level');
  const tx = beginTx(doc, `Paint ${TERRAIN_BY_ID[terrain].name}`);
  const removed = applyTerrain(doc, tx, brushTiles(doc.bp, pos, brush), terrain);
  const changed = tx.commit();
  return ok({ changed, removed });
}

/** Flood fill (4-neighbour) of the region of `pos`'s terrain. */
export function fillTerrain(doc, pos, terrain) {
  if (!TERRAIN_BY_ID[terrain]) return fail('bad_terrain');
  if (!inBounds(doc.bp, pos)) return fail('out_of_bounds');
  const z = pos.z || 0;
  if (!terrainAllowedOnLevel(terrain, z)) return fail('bad_terrain_for_level');
  const bp = doc.bp;
  const from = tileOf(bp, pos).t;
  if (from === terrain) return ok({ changed: false, removed: [], count: 0 });
  const W = bp.map.width;
  const seen = new Uint8Array(W * bp.map.height);
  const tiles = [];
  const q = [[pos.x, pos.y]];
  seen[pos.y * W + pos.x] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    tiles.push({ x, y, z });
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= bp.map.height || seen[ny * W + nx]) continue;
      if (bp.map.tiles[z][ny][nx].t !== from) continue;
      seen[ny * W + nx] = 1;
      q.push([nx, ny]);
    }
  }
  const tx = beginTx(doc, `Fill ${TERRAIN_BY_ID[terrain].name}`);
  const removed = applyTerrain(doc, tx, tiles, terrain);
  const changed = tx.commit();
  return ok({ changed, removed, count: tiles.length });
}

// ---- roads & rivers --------------------------------------------------------------------------------

/** 8-connected line (Bresenham). */
export function linePoints(a, b) {
  const out = [];
  let x = a.x; let y = a.y;
  const dx = Math.abs(b.x - x); const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1; const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y, z: a.z || 0 });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

/** 4-connected line: a diagonal step becomes two orthogonal steps (rivers join only orthogonally). */
export function linePoints4(a, b) {
  const pts = linePoints(a, b);
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1]; const c = pts[i];
    if (p.x !== c.x && p.y !== c.y) out.push({ x: c.x, y: p.y, z: c.z });
    out.push(c);
  }
  return out;
}

function roadable(tile) {
  const ter = TERRAIN_BY_ID[tile.t];
  return ter && ter.passable && !ter.water;
}

function setRoads(doc, tiles, type, label) {
  if (![0, 1, 2, 3].includes(type)) return fail('bad_value');
  const tx = beginTx(doc, label);
  let skipped = 0;
  for (const p of tiles) {
    const tile = tileOf(doc.bp, p);
    if (!tile) continue;
    if (type && !roadable(tile)) { skipped++; continue; }
    if (tile.road === type) continue;
    tx.tile(p.x, p.y, p.z);
    tile.road = type;
  }
  return ok({ changed: tx.commit(), skipped });
}

export function paintRoad(doc, pos, type, { brush = 1 } = {}) {
  if (!inBounds(doc.bp, pos)) return fail('out_of_bounds');
  return setRoads(doc, brushTiles(doc.bp, pos, brush), type, type ? 'Road' : 'Erase road');
}
export function paintRoadLine(doc, from, to, type) {
  if (!inBounds(doc.bp, from) || !inBounds(doc.bp, to)) return fail('out_of_bounds');
  return setRoads(doc, linePoints(from, { ...to, z: from.z || 0 }), type, type ? 'Road' : 'Erase road');
}

function setRivers(doc, tiles, on, label) {
  const v = on ? 1 : 0;
  const tx = beginTx(doc, label);
  const { occ } = occupancy(doc, { fresh: true });
  let skipped = 0;
  for (const p of tiles) {
    const tile = tileOf(doc.bp, p);
    if (!tile) continue;
    if (v) {
      if (!roadable(tile)) { skipped++; continue; }
      const o = occ.get(kOf(p));
      const def = o && o.kind === 'object' ? MAP_OBJECT_BY_ID[doc.bp.map.objects[o.id].defId] : null;
      if (o && (o.kind === 'town' || (def && def.category !== 'decor'))) { skipped++; continue; }
    }
    if ((tile.river || 0) === v) continue;
    tx.tile(p.x, p.y, p.z);
    tile.river = v;
  }
  return ok({ changed: tx.commit(), skipped });
}

export function paintRiver(doc, pos, on = true, { brush = 1 } = {}) {
  if (!inBounds(doc.bp, pos)) return fail('out_of_bounds');
  return setRivers(doc, brushTiles(doc.bp, pos, brush), on, on ? 'River' : 'Erase river');
}
export function paintRiverLine(doc, from, to, on = true) {
  if (!inBounds(doc.bp, from) || !inBounds(doc.bp, to)) return fail('out_of_bounds');
  return setRivers(doc, linePoints4(from, { ...to, z: from.z || 0 }), on, on ? 'River' : 'Erase river');
}

/** Road auto-connection mask: bit i = DIRS8[i] neighbour has a road. */
export function roadMask(bp, pos) {
  let m = 0;
  DIRS8.forEach(([dx, dy], i) => { const t = tileOf(bp, { x: pos.x + dx, y: pos.y + dy, z: pos.z || 0 }); if (t && t.road) m |= 1 << i; });
  return m;
}
/** River mask: 4 bits N E S W. */
export function riverMask(bp, pos) {
  let m = 0;
  for (let i = 0; i < 4; i++) { const t = tileOf(bp, { x: pos.x + DIRS8[i][0], y: pos.y + DIRS8[i][1], z: pos.z || 0 }); if (t && t.river) m |= 1 << i; }
  return m;
}

// ---- objects ------------------------------------------------------------------------------------------

function freeObjectId(doc) {
  let n = doc.nextId || 1;
  while (doc.bp.map.objects[`o${n}`]) n++;
  return { id: `o${n}`, next: n + 1 };
}

const gates = (bp) => Object.values(bp.map.objects).filter((o) => o.defId === 'subterranean_gate');
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Pair `gate` with the nearest unpaired gate on another level (keeps existing pairs). */
function autoPairGate(bp, gate) {
  const free = gates(bp).filter((g) => g !== gate && !g.data.pair && (g.pos.z || 0) !== (gate.pos.z || 0));
  if (!free.length) { gate.data.pair = null; return; }
  free.sort((a, b) => dist2(a.pos, gate.pos) - dist2(b.pos, gate.pos));
  gate.data.pair = free[0].id;
  free[0].data.pair = gate.id;
}

function resourceOfPile(def) {
  if (def.effect.type !== 'pickup' || def.category !== 'resource') return null;
  const row = (def.effect.table || [])[0];
  const keys = Object.keys((row && row.reward && row.reward.resources) || {});
  return keys.length === 1 ? keys[0] : null;
}

function ownerOk(bp, def, owner) {
  if (owner == null) return true;
  return OWNABLE_EFFECTS.includes(def.effect.type) && Number.isInteger(owner) && owner >= 0 && owner < bp.meta.playerSlots;
}

/**
 * Place a map object / town / hero.
 * props: objects `{owner, data}`; towns `{faction, ownerSlot, name, buildings}`; heroes `{defId, ownerSlot}`.
 * @returns {{ok: true, ref} | {ok: false, error, problems?}}
 */
export function placeObject(doc, defId, pos, props = {}) {
  const bp = doc.bp;
  pos = copyPos(pos);
  const check = canPlace(doc, defId, pos);
  if (!check.ok) return fail(check.error);
  if (defId === HERO_ID) {
    const entry = { ownerSlot: props.ownerSlot ?? 0, pos, defId: props.defId || 'random' };
    for (const k of ['army', 'primary', 'skills', 'spells', 'artifacts']) if (props[k] != null) entry[k] = JSON.parse(JSON.stringify(props[k]));
    const problems = heroProblems(bp, entry);
    if (problems.length) return fail('bad_value', { problems });
    if (entry.defId !== 'random' && bp.heroes.some((h) => h.defId === entry.defId)) return fail('hero_taken');
    const tx = beginTx(doc, 'Place hero').touch('heroes');
    bp.heroes.push(entry);
    tx.commit();
    return ok({ ref: { kind: 'hero', index: bp.heroes.length - 1 } });
  }
  if (TOWN_IDS.includes(defId)) {
    const entry = { pos, faction: defId === 'random_town' ? 'random' : (props.faction || 'castle'), ownerSlot: props.ownerSlot ?? null };
    if (defId === 'random_town' && props.faction) entry.faction = props.faction;
    if (props.name) entry.name = String(props.name);
    if (props.buildings) entry.buildings = props.buildings.slice();
    const problems = townProblems(bp, entry);
    if (problems.length) return fail('bad_value', { problems });
    const tx = beginTx(doc, 'Place town').touch('towns');
    bp.towns.push(entry);
    tx.commit();
    return ok({ ref: { kind: 'town', index: bp.towns.length - 1 } });
  }
  const def = MAP_OBJECT_BY_ID[defId];
  if (!ownerOk(bp, def, props.owner)) return fail('bad_owner');
  const data = { ...(props.data || {}) };
  const problems = objectDataProblems(bp, def, data);
  if (problems.length) return fail('bad_value', { problems });
  const amount = data.amount;
  delete data.amount;
  const tx = beginTx(doc, `Place ${def.name}`).touch('placedArtifacts').touch('puzzleOrder').touch('nextId');
  for (const p of check.tiles) tx.tile(p.x, p.y, p.z);
  const { id, next } = freeObjectId(doc);
  tx.obj(id);
  const isGate = def.effect.type === 'teleport' && def.effect.kind === 'subterranean_gate';
  const pairs = new Map();
  if (isGate) for (const g of gates(bp)) { tx.obj(g.id); pairs.set(g.id, g.data.pair ?? null); }
  let obj;
  try {
    const gs = genState(doc);
    gs.nextId = next;
    obj = addObject(gs, defId, pos, { id, ...(props.owner !== undefined ? { owner: props.owner } : {}), data });
    doc.nextId = gs.nextId;
  } catch (err) {
    tx.rollback();
    return fail('bad_value', { problems: [err.message] });
  }
  if (amount != null) {
    const res = resourceOfPile(MAP_OBJECT_BY_ID[obj.defId]);
    if (res) obj.data.reward = { resources: { [res]: amount } };
  }
  if (isGate) {
    for (const g of gates(bp)) if (pairs.has(g.id)) g.data.pair = pairs.get(g.id);
    autoPairGate(bp, obj);
  }
  tx.commit();
  return ok({ ref: { kind: 'object', id: obj.id }, object: obj });
}

/** Remove refs inside an open transaction (towns / heroes in descending index order). */
function removeRefsInTx(doc, tx, refs) {
  const bp = doc.bp;
  const objs = refs.filter((r) => r.kind === 'object');
  const towns = refs.filter((r) => r.kind === 'town').map((r) => r.index).sort((a, b) => b - a);
  const heroes = refs.filter((r) => r.kind === 'hero').map((r) => r.index).sort((a, b) => b - a);
  if (objs.length) tx.touch('victory').touch('loss');
  for (const r of objs) {
    const obj = bp.map.objects[r.id];
    if (!obj) continue;
    const def = MAP_OBJECT_BY_ID[obj.defId];
    tx.obj(obj.id);
    if (def) for (const p of footprintOf(obj.defId, obj.pos)) if (inBounds(bp, p)) tx.tile(p.x, p.y, p.z);
    if (obj.defId === 'subterranean_gate' && obj.data.pair && bp.map.objects[obj.data.pair]) {
      tx.obj(obj.data.pair);
      bp.map.objects[obj.data.pair].data.pair = null;
    }
    if (def) removeObject({ map: bp.map }, obj.id);
    else delete bp.map.objects[obj.id];
  }
  if (towns.length || heroes.length) tx.touch('towns').touch('heroes').touch('victory').touch('loss');
  const townMap = bp.towns.map((_, i) => i);
  for (const i of towns) { bp.towns.splice(i, 1); townMap[i] = null; }
  let n = 0;
  townMap.forEach((v, i) => { if (v !== null) townMap[i] = n++; });
  const heroMap = bp.heroes.map((_, i) => i);
  for (const i of heroes) { bp.heroes.splice(i, 1); heroMap[i] = null; }
  n = 0;
  heroMap.forEach((v, i) => { if (v !== null) heroMap[i] = n++; });
  remapConditions(bp, towns.length ? townMap : null, heroes.length ? heroMap : null);
  if (heroes.length) remapHeroQuests(bp, heroMap, (id) => tx.obj(id));
}

export function removeRef(doc, ref) {
  if (!getRef(doc, ref)) return fail('no_such_object');
  const d = describeRef(doc, ref);
  const tx = beginTx(doc, `Remove ${d.name}`);
  removeRefsInTx(doc, tx, [ref]);
  tx.commit();
  return ok({ removed: [ref] });
}

/** Remove the topmost thing on a tile. */
export function removeAt(doc, pos) {
  const ref = refAt(doc, pos);
  if (!ref) return fail('nothing_here');
  return removeRef(doc, ref);
}

/** Move an object / town / hero, keeping its id and instance data. */
export function moveRef(doc, ref, pos) {
  const e = getRef(doc, ref);
  if (!e) return fail('no_such_object');
  pos = copyPos(pos);
  if (e.pos.x === pos.x && e.pos.y === pos.y && (e.pos.z || 0) === pos.z) return ok({ ref, changed: false });
  const bp = doc.bp;
  const id = ref.kind === 'object' ? e.defId : ref.kind === 'town' ? 'town' : HERO_ID;
  const check = canPlace(doc, id, pos, { ignore: ref });
  if (!check.ok) return fail(check.error);
  if (ref.kind !== 'object') {
    const tx = beginTx(doc, 'Move').touch(ref.kind === 'town' ? 'towns' : 'heroes');
    e.pos = pos;
    tx.commit();
    return ok({ ref, changed: true });
  }
  const tx = beginTx(doc, `Move ${MAP_OBJECT_BY_ID[e.defId].name}`).obj(e.id);
  for (const p of [...footprintOf(e.defId, e.pos), ...check.tiles]) if (inBounds(bp, p)) tx.tile(p.x, p.y, p.z);
  unmarkObjectTiles(bp.map, e);
  e.pos = pos;
  markObjectTiles(bp.map, e);
  if (e.defId === 'subterranean_gate') {
    const mate = e.data.pair && bp.map.objects[e.data.pair];
    if (mate && (mate.pos.z || 0) === pos.z) { tx.obj(mate.id); mate.data.pair = null; e.data.pair = null; }
    if (!e.data.pair) { for (const g of gates(bp)) tx.obj(g.id); autoPairGate(bp, e); }
  }
  tx.commit();
  return ok({ ref, changed: true });
}

/**
 * Edit properties. Objects: `{owner?, data?: {...}}` (merged, null deletes a field; `amount` for
 * resource piles); towns: `{faction, ownerSlot, name, buildings}`; heroes: `{defId, ownerSlot}`.
 */
export function setProps(doc, ref, patch = {}) {
  const e = getRef(doc, ref);
  if (!e) return fail('no_such_object');
  const bp = doc.bp;
  if (ref.kind === 'town') {
    const next = { ...e };
    for (const k of ['faction', 'ownerSlot', 'name', 'buildings']) {
      if (patch[k] === undefined) continue;
      if (patch[k] === null || patch[k] === '' || (k === 'buildings' && !patch[k].length)) { if (k === 'ownerSlot') next.ownerSlot = null; else if (k !== 'faction') delete next[k]; } else next[k] = JSON.parse(JSON.stringify(patch[k]));
    }
    const problems = townProblems(bp, next);
    if (problems.length) return fail('bad_value', { problems });
    const tx = beginTx(doc, 'Town properties').touch('towns');
    bp.towns[ref.index] = next;
    tx.commit();
    return ok({ ref });
  }
  if (ref.kind === 'hero') {
    const next = { ...e, ...(patch.defId !== undefined ? { defId: patch.defId || 'random' } : {}), ...(patch.ownerSlot !== undefined ? { ownerSlot: patch.ownerSlot } : {}) };
    // starting-hero extras (applied by createGame): army, primary, skills, spells, artifacts; null / [] clears
    for (const k of ['army', 'primary', 'skills', 'spells', 'artifacts']) {
      if (patch[k] === undefined) continue;
      const empty = patch[k] == null || (Array.isArray(patch[k]) ? !patch[k].length : !Object.keys(patch[k]).length);
      if (empty) delete next[k]; else next[k] = JSON.parse(JSON.stringify(patch[k]));
    }
    const problems = heroProblems(bp, next);
    if (problems.length) return fail('bad_value', { problems });
    if (next.defId !== 'random' && bp.heroes.some((h, i) => i !== ref.index && h.defId === next.defId)) return fail('hero_taken');
    const tx = beginTx(doc, 'Hero properties').touch('heroes');
    bp.heroes[ref.index] = next;
    tx.commit();
    return ok({ ref });
  }
  const def = MAP_OBJECT_BY_ID[e.defId];
  if (patch.owner !== undefined && !ownerOk(bp, def, patch.owner)) return fail('bad_owner');
  const data = JSON.parse(JSON.stringify(e.data || {}));
  for (const [k, v] of Object.entries(patch.data || {})) {
    if (v === null || v === undefined) delete data[k]; else data[k] = JSON.parse(JSON.stringify(v));
  }
  const problems = objectDataProblems(bp, def, data);
  if (problems.length) return fail('bad_value', { problems });
  if (data.amount != null) {
    const res = resourceOfPile(def);
    if (res) data.reward = { resources: { [res]: data.amount } };
    delete data.amount;
  }
  if (def.effect.type === 'monster' && patch.data && patch.data.disposition && patch.data.disposition !== (e.data || {}).disposition) {
    const disp = MONSTER_DISPOSITIONS.find((x) => x.id === data.disposition);
    data.character = randInt(doc.rng, disp.character[0], disp.character[1]);
  }
  const tx = beginTx(doc, `${def.name} properties`).obj(e.id);
  if (patch.owner !== undefined) e.owner = patch.owner;
  e.data = data;
  tx.commit();
  return ok({ ref });
}

/** Manually pair two subterranean gates on different levels (their old mates become unpaired). */
export function pairGates(doc, idA, idB) {
  const bp = doc.bp;
  const a = bp.map.objects[idA];
  const b = bp.map.objects[idB];
  if (!a || !b || a.defId !== 'subterranean_gate' || b.defId !== 'subterranean_gate') return fail('no_such_object');
  if ((a.pos.z || 0) === (b.pos.z || 0)) return fail('same_level');
  const tx = beginTx(doc, 'Pair gates');
  for (const g of gates(bp)) tx.obj(g.id);
  for (const g of [a, b]) {
    const old = g.data.pair && bp.map.objects[g.data.pair];
    if (old) old.data.pair = null;
  }
  a.data.pair = b.id;
  b.data.pair = a.id;
  tx.commit();
  return ok();
}
