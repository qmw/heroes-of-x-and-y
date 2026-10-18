// Map model (DESIGN.md §4): tiles, object instances, footprints, lookups, ASCII debug rendering.
// Spec: docs/mechanics/adventure-objects.md §2.1, docs/mechanics/adventure-engine.md.
import { getTerrain } from '../../data/terrain.js';
import { getMapObject } from '../../data/mapObjects.js';
import { pick } from '../../core/rng.js';
import { copyPos, samePos, nextObjectId, dist2 } from './util.js';
import { initObject } from './init.js';

/**
 * @typedef {{t:string, road:number, river:number, obj:string|null, blocked:boolean, overlay?:string}} Tile
 * @typedef {{id:string, defId:string, pos:{x:number,y:number,z:number}, owner?:number|null, data:object}} MapObject
 */

/**
 * @param {number} width @param {number} height @param {number} [levels] 1|2
 * @param {string} [terrainId] terrain of every tile (level 1 defaults to the same terrain)
 */
export function createEmptyMap(width, height, levels = 1, terrainId = 'grass') {
  getTerrain(terrainId);
  const tiles = [];
  for (let z = 0; z < levels; z++) {
    const level = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) row.push({ t: terrainId, road: 0, river: 0, obj: null, blocked: false });
      level.push(row);
    }
    tiles.push(level);
  }
  return { width, height, levels, tiles, objects: {} };
}

export function inBounds(map, pos) {
  const z = pos.z || 0;
  return z >= 0 && z < map.levels && pos.x >= 0 && pos.y >= 0 && pos.x < map.width && pos.y < map.height;
}

/** @returns {Tile|null} */
export function getTile(map, pos) {
  return inBounds(map, pos) ? map.tiles[pos.z || 0][pos.y][pos.x] : null;
}

/** Footprint tiles of an object definition placed with its entrance at `pos` (doc §2.1). */
export function getFootprint(def, pos) {
  const [w, h] = def.size;
  const x0 = pos.x - Math.floor(w / 2);
  const out = [];
  for (let y = pos.y - h + 1; y <= pos.y; y++) {
    for (let x = x0; x < x0 + w; x++) out.push({ x, y, z: pos.z || 0 });
  }
  return out;
}

const isExit = (def) => def.effect.type === 'teleport' && def.effect.kind === 'one_way_exit';

/** Can `defId` be placed with its entrance at `pos`? (in bounds, footprint free of objects/blocks) */
export function canPlaceObject(state, defId, pos) {
  const def = getMapObject(defId);
  const water = (def.terrains || []).length === 1 && def.terrains[0] === 'water';
  for (const p of getFootprint(def, pos)) {
    const tile = getTile(state.map, p);
    if (!tile || tile.blocked || tile.obj) return false;
    const ter = getTerrain(tile.t);
    if (!ter.passable) return false;
    if (def.effect.type !== 'none' && ter.water !== water) return false;
  }
  return true;
}

function resolvePlaceholder(state, def) {
  const fx = def.effect;
  if (fx.type === 'pickup' && fx.placeholder) return getMapObject(pick(state.rng, fx.replaceWith));
  return def;
}

/**
 * Create an object instance, roll its instance data and mark its footprint.
 * @param {object} state
 * @param {string} defId
 * @param {{x:number,y:number,z?:number}} pos entrance tile
 * @param {{id?:string, owner?:number|null, data?:object}} [params] explicit `data` fields win over rolls
 * @returns {MapObject}
 */
export function addObject(state, defId, pos, params = {}) {
  let def = resolvePlaceholder(state, getMapObject(defId));
  const map = state.map;
  if (!inBounds(map, pos)) throw new Error(`addObject(${defId}): position out of bounds`);
  if (def.effect.type === 'monster' && def.id !== 'monster') {
    // random_monster / random_monster_<tier> placeholders become plain `monster` instances
    params = { ...params, data: { tier: def.effect.tier, ...(params.data || {}) } };
    def = getMapObject('monster');
  }
  const obj = { id: params.id || nextObjectId(state), defId: def.id, pos: copyPos(pos), data: { ...(params.data || {}) } };
  if (params.owner !== undefined) obj.owner = params.owner;
  map.objects[obj.id] = obj;
  markFootprint(map, obj, def);
  initObject(state, obj);
  return obj;
}

function markFootprint(map, obj, def) {
  const fx = def.effect;
  if (fx.type === 'grail') return; // hidden marker: leaves no trace on the tiles
  const entrance = getTile(map, obj.pos);
  if (def.blocking) {
    for (const p of getFootprint(def, obj.pos)) {
      const tile = getTile(map, p);
      if (!tile) continue;
      const isEntrance = samePos(p, obj.pos);
      if (!isEntrance || (def.interact === 'none' && !isExit(def))) tile.blocked = true;
    }
    if (entrance && !(fx.type === 'boat' && obj.data.heroId)) entrance.obj = obj.id;
  } else if (def.visitable || def.id === 'hole') {
    if (entrance) entrance.obj = obj.id;
  }
}

/** Delete an object and free its footprint. Unknown ids are ignored. */
export function removeObject(state, objId) {
  const map = state.map;
  const obj = map.objects[objId];
  if (!obj) return false;
  const def = getMapObject(obj.defId);
  if (def.effect.type !== 'grail') {
    for (const p of getFootprint(def, obj.pos)) {
      const tile = getTile(map, p);
      if (!tile) continue;
      if (def.blocking) tile.blocked = false;
      if (tile.obj === objId) tile.obj = null;
    }
  }
  delete map.objects[objId];
  return true;
}

/** Move a 1x1 object (boats) to another tile, keeping the tile markers consistent. */
export function relocateObject(state, obj, pos, { mark = true } = {}) {
  const old = getTile(state.map, obj.pos);
  if (old && old.obj === obj.id) old.obj = null;
  obj.pos = copyPos(pos);
  const tile = getTile(state.map, pos);
  if (mark && tile && !tile.obj) tile.obj = obj.id;
}

/** The object whose entrance (or single tile) is at `pos`, else null. */
export function getObjectAt(state, pos) {
  const tile = getTile(state.map, pos);
  return tile && tile.obj ? state.map.objects[tile.obj] || null : null;
}

/** Hero standing on the map at `pos` (garrisoned heroes are inside a town, not on the map). */
export function getHeroAt(state, pos) {
  for (const h of Object.values(state.heroes)) {
    if (!h.garrisoned && samePos(h.pos, pos)) return h;
  }
  return null;
}

/** Town whose entrance tile is `pos`. */
export function getTownAt(state, pos) {
  const obj = getObjectAt(state, pos);
  if (obj && obj.data && obj.data.townId && state.towns[obj.data.townId]) return state.towns[obj.data.townId];
  for (const t of Object.values(state.towns)) if (samePos(t.pos, pos)) return t;
  return null;
}

export function objectsByDef(state, defId) {
  return Object.values(state.map.objects).filter((o) => o.defId === defId);
}

export function objectsByEffect(state, type) {
  return Object.values(state.map.objects).filter((o) => getMapObject(o.defId).effect.type === type);
}

/** Empty boat object standing on `pos`, else null. */
export function getBoatAt(state, pos) {
  const obj = getObjectAt(state, pos);
  if (obj && obj.defId === 'boat') return obj;
  return null;
}

/** The boat a sailing hero is aboard. */
export function getBoatOfHero(state, heroId) {
  return Object.values(state.map.objects).find((o) => o.defId === 'boat' && o.data.heroId === heroId) || null;
}

/**
 * Pair subterranean gates (doc §3.9): gates of each level sorted by (y, x); each surface gate takes
 * the nearest unpaired underground gate. Re-run whenever a gate is added or removed.
 */
export function pairSubterraneanGates(state) {
  const gates = objectsByDef(state, 'subterranean_gate');
  const order = (a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x;
  const top = gates.filter((g) => (g.pos.z || 0) === 0).sort(order);
  const bottom = gates.filter((g) => (g.pos.z || 0) === 1).sort(order);
  for (const g of gates) g.data.pair = null;
  const free = bottom.slice();
  for (const g of top) {
    if (!free.length) break;
    let best = 0;
    for (let i = 1; i < free.length; i++) if (dist2(free[i].pos, g.pos) < dist2(free[best].pos, g.pos)) best = i;
    const [mate] = free.splice(best, 1);
    g.data.pair = mate.id;
    mate.data.pair = g.id;
  }
}

// ---- debug --------------------------------------------------------------------------------------

const TERRAIN_CHAR = { dirt: ',', sand: ':', grass: '.', snow: '*', swamp: '%', rough: ';', subterranean: '_', lava: '^', highlands: '"', wasteland: '`', water: '~', rock: '#' };
const EFFECT_CHAR = {
  monster: 'M', town: 'T', mine: 'm', bank: 'B', dwelling: 'D', pickup: '$', chest: 'c', artifact: 'a', spell_scroll: 'a',
  boat: 'b', teleport: 'O', garrison: 'G', border_guard: 'K', quest_guard: 'Q', seer_hut: 'S', pandoras_box: 'P',
  event: '.', none: 'x',
};

/**
 * ASCII rendering for tests/debugging. One block per level. `?` = unexplored for `playerId`
 * (pass null/undefined to ignore fog). Heroes: `H` (own / no viewer), `E` (others); roads `=`.
 */
export function debugRenderMap(state, playerId = null) {
  const map = state.map;
  const player = playerId == null ? null : state.players.find((p) => p.id === playerId);
  const heroAt = {};
  for (const h of Object.values(state.heroes)) if (!h.garrisoned) heroAt[`${h.pos.x},${h.pos.y},${h.pos.z || 0}`] = h;
  const blocks = [];
  for (let z = 0; z < map.levels; z++) {
    const lines = [];
    for (let y = 0; y < map.height; y++) {
      let line = '';
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[z][y][x];
        if (player && !(player.explored?.[z]?.[y * map.width + x])) { line += '?'; continue; }
        const hero = heroAt[`${x},${y},${z}`];
        if (hero) { line += player == null || hero.owner === playerId ? 'H' : 'E'; continue; }
        if (tile.obj && map.objects[tile.obj]) {
          const type = getMapObject(map.objects[tile.obj].defId).effect.type;
          line += EFFECT_CHAR[type] === '.' ? TERRAIN_CHAR[tile.t] : (EFFECT_CHAR[type] || 'o');
          continue;
        }
        if (tile.blocked) { line += 'X'; continue; }
        line += tile.road ? '=' : (TERRAIN_CHAR[tile.t] || '?');
      }
      lines.push(line);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}
