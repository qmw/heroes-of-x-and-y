// Map editor: blueprint creation / normalisation, map info, resize, player slots, victory / loss,
// (de)serialisation, random-map import and the hand-off to createGame. docs/mechanics/editor.md §2.
import { FACTIONS, RESOURCES, PLAYER_COLORS } from '../../core/constants.js';
import { createRng } from '../../core/rng.js';
import { TERRAIN_BY_ID } from '../../data/terrain.js';
import { MAP_OBJECT_BY_ID } from '../../data/mapObjects.js';
import { ARTIFACT_BY_ID } from '../../data/artifacts.js';
import { CREATURE_BY_ID } from '../../data/creatures.js';
import { createEmptyMap } from '../adventure/map.js';
import { VICTORY_TYPES, LOSS_TYPES } from '../victory.js';
import { generateMap, MAP_SIZES } from '../mapgen/index.js';
import { beginTx } from './history.js';
import { timedEventProblems } from './data.js';

export const MAP_FORMAT = 'h3online-map';
export const MAP_FORMAT_VERSION = 1;
export const EDITOR_SIZES = MAP_SIZES; // { S: 36, M: 72, L: 108, XL: 144, H: 180, XH: 216, G: 252 }
export const MIN_MAP_SIZE = 8;
export const MAX_MAP_SIZE = 252;
export const MAX_SLOTS = 8;

const clone = (v) => JSON.parse(JSON.stringify(v));
const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

export function defaultPlayerMeta(slot) {
  return { slot, team: null, human: true, ai: true, factions: [] };
}

/** Name of a size for `meta.size` ('S'...'G' when square and standard, else 'WxH'). */
export function sizeName(width, height) {
  const k = Object.keys(MAP_SIZES).find((s) => MAP_SIZES[s] === width && width === height);
  return k || `${width}x${height}`;
}

/**
 * Fresh blank blueprint.
 * @param {{size?: string, width?: number, height?: number, levels?: number, terrain?: string, name?: string, players?: number, description?: string}} o
 */
export function createBlankBlueprint(o = {}) {
  const width = clampSize(MAP_SIZES[o.size] || o.width || 36);
  const height = clampSize(MAP_SIZES[o.size] || o.height || width);
  const levels = o.levels === 2 ? 2 : 1;
  const terrain = o.terrain && TERRAIN_BY_ID[o.terrain] ? o.terrain : 'grass';
  const map = createEmptyMap(width, height, levels, terrain);
  if (levels === 2) for (const row of map.tiles[1]) for (const t of row) t.t = 'subterranean';
  map.placedArtifacts = [];
  const slots = Math.max(1, Math.min(MAX_SLOTS, o.players || 2));
  return {
    map, towns: [], heroes: [],
    meta: {
      name: o.name || 'New map', description: o.description || '', difficulty: 1,
      size: sizeName(width, height), width, height, levels, playerSlots: slots,
      players: Array.from({ length: slots }, (_, i) => defaultPlayerMeta(i)),
      editor: { version: MAP_FORMAT_VERSION },
    },
    victory: 'standard', loss: 'standard',
  };
}

function clampSize(n) {
  return Math.max(MIN_MAP_SIZE, Math.min(MAX_MAP_SIZE, Math.floor(Number(n) || 36)));
}

/** Fill in what an imported / generated blueprint may lack (mutates and returns it). */
export function normalizeBlueprint(bp) {
  bp.towns ??= [];
  bp.heroes ??= [];
  bp.events ??= [];
  bp.map.objects ??= {};
  bp.map.placedArtifacts ??= [];
  const m = (bp.meta ??= {});
  m.name ??= 'Untitled map';
  m.description ??= '';
  m.difficulty ??= 1;
  m.width = bp.map.width;
  m.height = bp.map.height;
  m.levels = bp.map.levels;
  m.size = m.size || sizeName(bp.map.width, bp.map.height);
  if (!(m.playerSlots >= 1)) {
    const used = [...bp.towns.map((t) => t.ownerSlot), ...bp.heroes.map((h) => h.ownerSlot)].filter((s) => s != null);
    m.playerSlots = Math.max(1, Math.min(MAX_SLOTS, used.length ? Math.max(...used) + 1 : 2));
  }
  const old = Array.isArray(m.players) ? m.players : [];
  m.players = Array.from({ length: m.playerSlots }, (_, slot) => {
    const p = old.find((x) => x && x.slot === slot) || {};
    const team = p.team ?? (Array.isArray(m.teams) ? m.teams[slot] ?? null : null);
    return { ...defaultPlayerMeta(slot), ...p, slot, team, factions: Array.isArray(p.factions) ? p.factions.filter((f) => FACTIONS.includes(f)) : [] };
  });
  m.editor = { version: MAP_FORMAT_VERSION, ...(m.editor || {}) };
  bp.victory ??= m.victory ?? 'standard';
  bp.loss ??= m.loss ?? 'standard';
  return bp;
}

/** Highest `o<n>` object id + 1. */
function nextIdFor(bp) {
  let n = 0;
  for (const id of Object.keys(bp.map.objects || {})) {
    const m = /^o(\d+)$/.exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return n + 1;
}

/**
 * Wrap a blueprint (deep copy) into an editor document.
 * @returns {{bp: object, rng: {s: number}, nextId: number, undo: object[], redo: object[], version: number, savedVersion: number}}
 */
export function createEditor(bp, { seed = 1 } = {}) {
  const copy = normalizeBlueprint(clone(bp));
  return { bp: copy, rng: createRng(seed), nextId: nextIdFor(copy), undo: [], redo: [], version: 0, savedVersion: 0 };
}

export function newMap(o = {}) {
  return createEditor(createBlankBlueprint(o), { seed: o.seed || 1 });
}

// ---- map info ------------------------------------------------------------------------------------

export function setMapInfo(doc, { name, description, difficulty } = {}) {
  if (difficulty != null && !(Number.isInteger(difficulty) && difficulty >= 0 && difficulty <= 4)) return fail('bad_value');
  const tx = beginTx(doc, 'Map info').touch('meta');
  const m = doc.bp.meta;
  if (name != null) m.name = String(name).slice(0, 60);
  if (description != null) m.description = String(description).slice(0, 2000);
  if (difficulty != null) m.difficulty = difficulty;
  tx.commit();
  return ok();
}

// ---- footprints (shared with ops.js) -------------------------------------------------------------

export const TOWN_SIZE = [5, 3];
export function rectFootprint(size, pos) {
  const [w, h] = size;
  const x0 = pos.x - Math.floor(w / 2);
  const out = [];
  for (let y = pos.y - h + 1; y <= pos.y; y++) for (let x = x0; x < x0 + w; x++) out.push({ x, y, z: pos.z || 0 });
  return out;
}

/**
 * Resize the map (top-left anchored). New surface tiles copy the nearest old edge tile's terrain,
 * a new underground level is subterranean. Objects / towns / heroes that no longer fit are dropped.
 */
export function resizeMap(doc, { width, height, levels } = {}) {
  const bp = doc.bp;
  const old = bp.map;
  const W = clampSize(width ?? old.width);
  const H = clampSize(height ?? old.height);
  const L = levels === 2 ? 2 : levels === 1 ? 1 : old.levels;
  if (W === old.width && H === old.height && L === old.levels) return ok({ removed: 0 });
  const tx = beginTx(doc, 'Resize map').touch('map').touch('towns').touch('heroes').touch('meta').touch('victory').touch('loss');
  const map = createEmptyMap(W, H, L, 'grass');
  for (let z = 0; z < L; z++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (z < old.levels && x < old.width && y < old.height) map.tiles[z][y][x] = { ...old.tiles[z][y][x], obj: null, blocked: false };
        else if (z < old.levels) map.tiles[z][y][x].t = old.tiles[z][Math.min(y, old.height - 1)][Math.min(x, old.width - 1)].t;
        else map.tiles[z][y][x].t = 'subterranean';
        const t = map.tiles[z][y][x];
        if (!TERRAIN_BY_ID[t.t].passable || TERRAIN_BY_ID[t.t].water) { t.road = 0; t.river = 0; }
      }
    }
  }
  map.placedArtifacts = old.placedArtifacts || [];
  if (old.puzzleOrder) map.puzzleOrder = old.puzzleOrder;
  const inb = (p) => p.x >= 0 && p.y >= 0 && p.x < W && p.y < H && (p.z || 0) < L;
  let removed = 0;
  // objects: keep those whose whole footprint is inside; re-mark the tiles
  for (const obj of Object.values(old.objects)) {
    const def = MAP_OBJECT_BY_ID[obj.defId];
    if (!def || !rectFootprint(def.size, obj.pos).every(inb)) { removed++; continue; }
    map.objects[obj.id] = obj;
  }
  bp.map = map;
  for (const obj of Object.values(map.objects)) markObjectTiles(map, obj);
  const keepTowns = [];
  const townMap = [];
  bp.towns.forEach((t, i) => {
    if (rectFootprint(TOWN_SIZE, t.pos).every(inb)) { townMap[i] = keepTowns.length; keepTowns.push(t); } else { townMap[i] = null; removed++; }
  });
  const keepHeroes = [];
  const heroMap = [];
  bp.heroes.forEach((h, i) => {
    if (inb(h.pos)) { heroMap[i] = keepHeroes.length; keepHeroes.push(h); } else { heroMap[i] = null; removed++; }
  });
  bp.towns = keepTowns;
  bp.heroes = keepHeroes;
  remapConditions(bp, townMap, heroMap);
  for (const obj of Object.values(map.objects)) {
    if (obj.defId === 'subterranean_gate' && obj.data.pair && !map.objects[obj.data.pair]) obj.data.pair = null;
  }
  Object.assign(bp.meta, { width: W, height: H, levels: L, size: sizeName(W, H) });
  tx.commit();
  return ok({ removed });
}

/** Tile markers of an object (same rules as adventure/map.js markFootprint). */
export function markObjectTiles(map, obj) {
  const def = MAP_OBJECT_BY_ID[obj.defId];
  if (!def || def.effect.type === 'grail') return;
  const z = obj.pos.z || 0;
  const tileOf = (p) => (p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height && z < map.levels ? map.tiles[z][p.y][p.x] : null);
  const entrance = tileOf(obj.pos);
  const isExit = def.effect.type === 'teleport' && def.effect.kind === 'one_way_exit';
  if (def.blocking) {
    for (const p of rectFootprint(def.size, obj.pos)) {
      const t = tileOf(p);
      if (!t) continue;
      const isEnt = p.x === obj.pos.x && p.y === obj.pos.y;
      if (!isEnt || (def.interact === 'none' && !isExit)) t.blocked = true;
    }
    if (entrance && !(def.effect.type === 'boat' && obj.data && obj.data.heroId)) entrance.obj = obj.id;
  } else if (def.visitable || def.id === 'hole') {
    if (entrance) entrance.obj = obj.id;
  }
}

/** Clear the tile markers of an object. */
export function unmarkObjectTiles(map, obj) {
  const def = MAP_OBJECT_BY_ID[obj.defId];
  if (!def || def.effect.type === 'grail') return;
  const z = obj.pos.z || 0;
  for (const p of rectFootprint(def.size, obj.pos)) {
    if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) continue;
    const t = map.tiles[z][p.y][p.x];
    if (def.blocking) t.blocked = false;
    if (t.obj === obj.id) t.obj = null;
  }
}

// ---- conditions ------------------------------------------------------------------------------------

/**
 * Keep victory / loss references valid after towns / heroes were removed or re-ordered.
 * `townMap[i]` / `heroMap[i]` = new index or null (removed); undefined = unchanged.
 */
export function remapConditions(bp, townMap = null, heroMap = null) {
  for (const key of ['victory', 'loss']) {
    const c = bp[key];
    if (!c || typeof c !== 'object') continue;
    let gone = false;
    if (townMap && c.townIndex != null && townMap[c.townIndex] !== undefined) {
      if (townMap[c.townIndex] === null) gone = true; else c.townIndex = townMap[c.townIndex];
    }
    if (heroMap && c.heroIndex != null && heroMap[c.heroIndex] !== undefined) {
      if (heroMap[c.heroIndex] === null) gone = true; else c.heroIndex = heroMap[c.heroIndex];
    }
    if (c.objectId && !bp.map.objects[c.objectId]) gone = true;
    if (gone) bp[key] = 'standard';
  }
}

/**
 * Keep `kill_hero` quests that point at a starting hero (`heroIndex`) valid after heroes were removed /
 * re-ordered. A quest whose hero is gone keeps a dangling index (validation warns). `touch(id)` records undo.
 */
export function remapHeroQuests(bp, heroMap, touch = () => {}) {
  if (!heroMap) return;
  for (const obj of Object.values(bp.map.objects)) {
    const q = obj.data && obj.data.quest;
    if (!q || q.type !== 'kill_hero' || q.heroIndex == null || heroMap[q.heroIndex] === undefined) continue;
    const next = heroMap[q.heroIndex];
    if (next === q.heroIndex) continue;
    touch(obj.id);
    if (next === null) { delete q.heroIndex; q.heroDefId = q.heroDefId || null; } else q.heroIndex = next;
  }
}

/** Problems of a victory condition on this map ([] = fine). */
export function victoryProblems(bp, cond) {
  if (!cond || cond === 'standard') return [];
  const out = [];
  const type = typeof cond === 'string' ? cond : cond.type;
  if (!VICTORY_TYPES.includes(type)) return [`unknown victory condition ${type}`];
  const c = typeof cond === 'string' ? {} : cond;
  const towns = bp.towns || [];
  const heroes = bp.heroes || [];
  switch (type) {
    case 'capture_town':
      if (!(Number.isInteger(c.townIndex) && towns[c.townIndex])) out.push('the town to capture does not exist');
      break;
    case 'build_grail':
      if (c.townIndex != null && !towns[c.townIndex]) out.push('the Grail town does not exist');
      break;
    case 'defeat_hero':
      if (!(Number.isInteger(c.heroIndex) && heroes[c.heroIndex])) out.push('the hero to defeat does not exist');
      break;
    case 'defeat_monster': {
      const o = c.objectId && bp.map.objects[c.objectId];
      if (!o || o.defId !== 'monster') out.push('the monster to defeat does not exist');
      break;
    }
    case 'acquire_artifact':
      if (!ARTIFACT_BY_ID[c.artifactId]) out.push(`unknown artifact ${c.artifactId}`);
      break;
    case 'accumulate_creatures':
      if (!CREATURE_BY_ID[c.creatureId]) out.push(`unknown creature ${c.creatureId}`);
      if (!(c.count >= 1)) out.push('creature count must be at least 1');
      break;
    case 'accumulate_resources':
      if (!RESOURCES.includes(c.resource)) out.push(`unknown resource ${c.resource}`);
      if (!(c.amount >= 1)) out.push('amount must be at least 1');
      break;
    case 'survive':
      if (!(c.days >= 1)) out.push('days must be at least 1');
      break;
    default: break;
  }
  return out;
}

export function lossProblems(bp, cond) {
  if (!cond || cond === 'standard') return [];
  const type = typeof cond === 'string' ? cond : cond.type;
  if (!LOSS_TYPES.includes(type)) return [`unknown loss condition ${type}`];
  const c = typeof cond === 'string' ? {} : cond;
  if (type === 'lose_town' && !(Number.isInteger(c.townIndex) && (bp.towns || [])[c.townIndex])) return ['the town that must not be lost does not exist'];
  if (type === 'lose_hero' && !(Number.isInteger(c.heroIndex) && (bp.heroes || [])[c.heroIndex])) return ['the hero who must not be lost does not exist'];
  if (type === 'time_limit' && !(c.days >= 1)) return ['days must be at least 1'];
  return [];
}

function normCond(cond) {
  if (!cond || cond === 'standard' || (typeof cond === 'object' && (cond.type === 'standard' || cond.type === 'defeat_all'))) return 'standard';
  return typeof cond === 'string' ? { type: cond } : clone(cond);
}

export function setVictory(doc, cond) {
  const c = normCond(cond);
  const problems = victoryProblems(doc.bp, c);
  if (problems.length) return fail('bad_condition', { problems });
  const tx = beginTx(doc, 'Victory condition').touch('victory');
  doc.bp.victory = c;
  tx.commit();
  return ok();
}

export function setLoss(doc, cond) {
  const c = normCond(cond);
  const problems = lossProblems(doc.bp, c);
  if (problems.length) return fail('bad_condition', { problems });
  const tx = beginTx(doc, 'Loss condition').touch('loss');
  doc.bp.loss = c;
  tx.commit();
  return ok();
}

// ---- players ---------------------------------------------------------------------------------------

/** Number of player slots (1..8). Towns of dropped slots become neutral, their heroes are removed. */
export function setPlayerCount(doc, n) {
  if (!(Number.isInteger(n) && n >= 1 && n <= MAX_SLOTS)) return fail('bad_value');
  const bp = doc.bp;
  const tx = beginTx(doc, 'Player count').touch('meta').touch('towns').touch('heroes').touch('victory').touch('loss');
  const m = bp.meta;
  m.playerSlots = n;
  m.players = Array.from({ length: n }, (_, slot) => (m.players || []).find((p) => p.slot === slot) || defaultPlayerMeta(slot));
  for (const t of bp.towns) if (t.ownerSlot != null && t.ownerSlot >= n) t.ownerSlot = null;
  const heroMap = [];
  const keep = [];
  bp.heroes.forEach((h, i) => { if (h.ownerSlot >= n) heroMap[i] = null; else { heroMap[i] = keep.length; keep.push(h); } });
  bp.heroes = keep;
  remapConditions(bp, null, heroMap);
  remapHeroQuests(bp, heroMap, (id) => tx.obj(id));
  if (bp.events) {
    tx.touch('events');
    for (const e of bp.events) if (Array.isArray(e.players)) e.players = e.players.filter((s) => s < n);
  }
  for (const obj of Object.values(bp.map.objects)) {
    const owned = obj.owner != null && obj.owner >= n;
    const ev = Array.isArray(obj.data && obj.data.players) && obj.data.players.some((s) => s >= n);
    if (!owned && !ev) continue;
    tx.obj(obj.id);
    if (owned) obj.owner = null;
    if (ev) obj.data.players = obj.data.players.filter((s) => s < n);
  }
  tx.commit();
  return ok();
}

/** Per-slot setup: `{team, human, ai, factions}` (factions = allowed towns, [] = all). */
export function setPlayer(doc, slot, patch = {}) {
  const m = doc.bp.meta;
  if (!(slot >= 0 && slot < m.playerSlots)) return fail('bad_slot');
  if (patch.factions && !(Array.isArray(patch.factions) && patch.factions.every((f) => FACTIONS.includes(f)))) return fail('bad_value');
  if (patch.team != null && !(Number.isInteger(patch.team) && patch.team >= 0 && patch.team < MAX_SLOTS)) return fail('bad_value');
  const p = { ...m.players.find((x) => x.slot === slot) };
  for (const k of ['team', 'human', 'ai', 'factions']) if (patch[k] !== undefined) p[k] = clone(patch[k]);
  if (!p.human && !p.ai) return fail('slot_needs_human_or_ai');
  const tx = beginTx(doc, 'Player setup').touch('meta');
  m.players = m.players.map((x) => (x.slot === slot ? p : x));
  tx.commit();
  return ok();
}

// ---- timed events ----------------------------------------------------------------------------------

const cleanEvent = (e) => {
  const out = { name: String(e.name || ''), day: e.day ?? 1, repeat: e.repeat ?? 0, message: String(e.message || '') };
  if (Array.isArray(e.players) && e.players.length) out.players = e.players.slice();
  if (e.humanOnly) out.humanOnly = true;
  if (e.aiOnly) out.aiOnly = true;
  if (e.resources && Object.keys(e.resources).length) out.resources = { ...e.resources };
  if (e.creatures && e.creatures.length) out.creatures = e.creatures.map((c) => ({ creatureId: c.creatureId, count: c.count }));
  return out;
};

/** Add a map-wide timed event (fired by the game at the start of `day`, then every `repeat` days). */
export function addTimedEvent(doc, ev) {
  const e = cleanEvent(ev || {});
  const problems = timedEventProblems(doc.bp, e);
  if (problems.length) return fail('bad_value', { problems });
  const tx = beginTx(doc, 'Add timed event').touch('events');
  (doc.bp.events ??= []).push(e);
  tx.commit();
  return ok({ index: doc.bp.events.length - 1 });
}

export function setTimedEvent(doc, index, patch) {
  const list = doc.bp.events || [];
  if (!list[index]) return fail('no_such_event');
  const e = cleanEvent({ ...list[index], ...patch });
  const problems = timedEventProblems(doc.bp, e);
  if (problems.length) return fail('bad_value', { problems });
  const tx = beginTx(doc, 'Edit timed event').touch('events');
  doc.bp.events[index] = e;
  tx.commit();
  return ok({ index });
}

export function removeTimedEvent(doc, index) {
  if (!(doc.bp.events || [])[index]) return fail('no_such_event');
  const tx = beginTx(doc, 'Remove timed event').touch('events');
  doc.bp.events.splice(index, 1);
  tx.commit();
  return ok();
}

// ---- serialisation ---------------------------------------------------------------------------------

export function serializeMap(bp, { now = Date.now() } = {}) {
  return JSON.stringify({ format: MAP_FORMAT, version: MAP_FORMAT_VERSION, savedAt: now, blueprint: bp });
}

/**
 * Parse a saved map (or a bare MapBlueprint).
 * @returns {{ok: true, bp: object} | {ok: false, error: string}}
 */
export function deserializeMap(input) {
  let obj = input;
  if (typeof input === 'string') {
    try { obj = JSON.parse(input); } catch { return fail('not_json'); }
  }
  if (!obj || typeof obj !== 'object') return fail('not_a_map');
  let bp = obj;
  if (obj.format !== undefined) {
    if (obj.format !== MAP_FORMAT) return fail('not_a_map');
    if (!(obj.version >= 1)) return fail('not_a_map');
    if (obj.version > MAP_FORMAT_VERSION) return fail('newer_version');
    bp = obj.blueprint;
  }
  const m = bp && bp.map;
  if (!m || !Array.isArray(m.tiles) || !(m.width >= 1) || !(m.height >= 1) || !(m.levels === 1 || m.levels === 2)) return fail('not_a_map');
  if (m.tiles.length !== m.levels || m.tiles.some((lv) => !Array.isArray(lv) || lv.length !== m.height || lv.some((row) => !Array.isArray(row) || row.length !== m.width))) return fail('corrupt_map');
  for (const lv of m.tiles) for (const row of lv) for (const t of row) if (!t || !TERRAIN_BY_ID[t.t]) return fail('corrupt_map');
  if (m.objects && typeof m.objects !== 'object') return fail('corrupt_map');
  return ok({ bp: normalizeBlueprint(clone(bp)) });
}

// ---- random map ------------------------------------------------------------------------------------

/** Generate a random map (mapgen options) and return it as an editable blueprint. */
export function blueprintFromRandomMap(options = {}) {
  const res = generateMap({ seed: 1, size: 'S', players: 2, ...options });
  if (!res || res.ok === false) return fail((res && res.error) || 'generation_failed');
  const bp = normalizeBlueprint(clone(res.blueprint || res));
  if (!options.name) bp.meta.name = `Random map ${bp.meta.seed ?? ''}`.trim();
  return ok({ bp });
}

// ---- play --------------------------------------------------------------------------------------------

/** Deep copy for createGame. */
export function prepareForPlay(bp) {
  const out = clone(bp);
  out.victory ??= 'standard';
  out.loss ??= 'standard';
  return out;
}

/**
 * Settings for `createGame` from a seat list `[{slot, isHuman, faction?, color?, name?, team?}]`.
 * Every slot of the map should be seated (owners in the editor are slots).
 */
export function buildPlaySettings(bp, seats, { seed = 1, difficulty = 1 } = {}) {
  return {
    seed, difficulty,
    mapName: bp.meta && bp.meta.name,
    players: seats.map((s, i) => ({
      slot: s.slot, isHuman: s.isHuman !== false, faction: s.faction || 'random',
      color: s.color || PLAYER_COLORS[s.slot % PLAYER_COLORS.length], name: s.name || `Player ${i + 1}`,
      ...(s.team != null ? { team: s.team } : {}),
      ...(allowedOf(bp, s.slot).length ? { allowedFactions: allowedOf(bp, s.slot) } : {}),
    })),
    victory: clone(bp.victory ?? 'standard'),
    loss: clone(bp.loss ?? 'standard'),
  };
}

const allowedOf = (bp, slot) => ((bp.meta && bp.meta.players) || []).find((p) => p.slot === slot)?.factions || [];

/** Default seats: slot 0 human, others computer (respecting the slot's human / ai permissions). */
export function defaultSeats(bp) {
  const players = (bp.meta && bp.meta.players) || [];
  return Array.from({ length: (bp.meta && bp.meta.playerSlots) || 2 }, (_, slot) => {
    const p = players.find((x) => x.slot === slot) || defaultPlayerMeta(slot);
    const isHuman = slot === 0 ? p.human !== false : p.ai === false;
    const town = (bp.towns || []).find((t) => t.ownerSlot === slot && t.faction !== 'random');
    const faction = town ? town.faction : (p.factions && p.factions.length === 1 ? p.factions[0] : 'random');
    return { slot, isHuman, faction, color: PLAYER_COLORS[slot], name: `${PLAYER_COLORS[slot][0].toUpperCase()}${PLAYER_COLORS[slot].slice(1)}`, team: p.team };
  });
}
