// Keys, teleport links and boat creation helpers (no visiting logic here - see visit.js).
import { getTerrain } from '../../data/terrain.js';
import { getMapObject } from '../../data/mapObjects.js';
import { getTile, objectsByDef, getHeroAt, addObject, getFootprint } from './map.js';
import { DIRS, areAllies } from './util.js';

/** Does the player (or an ally) hold the keymaster key of this colour? */
export function hasKey(state, playerId, color) {
  return state.players.some((p) => areAllies(state, p.id, playerId) && p.visited && p.visited[`key_${color}`]);
}

/** Every object a teleporter may send a hero to. */
export function teleportDestinations(state, obj) {
  const fx = getMapObject(obj.defId).effect;
  if (fx.type !== 'teleport') return [];
  if (fx.kind === 'one_way_entrance') return objectsByDef(state, fx.exit);
  if (fx.kind === 'two_way' || fx.kind === 'whirlpool') return objectsByDef(state, obj.defId).filter((o) => o.id !== obj.id);
  if (fx.kind === 'subterranean_gate') {
    const mate = obj.data.pair && state.map.objects[obj.data.pair];
    return mate ? [mate] : [];
  }
  return [];
}

/**
 * Destination object for a hero, or null. With `deterministicOnly` only teleporters with exactly
 * one possible exit and no confirmation (not whirlpools) qualify - used by the path-finder.
 */
export function teleportTarget(state, obj, hero, { deterministicOnly = false } = {}) {
  const fx = getMapObject(obj.defId).effect;
  const list = teleportDestinations(state, obj);
  if (deterministicOnly) return list.length === 1 && fx.kind !== 'whirlpool' ? list[0] : null;
  return list.length ? list : null;
}

/** First free water tile around a set of tiles, clockwise from north of `origin`. */
export function findFreeWaterTile(state, origin, footprint = [origin]) {
  const z = origin.z || 0;
  const inFootprint = (p) => footprint.some((f) => f.x === p.x && f.y === p.y);
  const candidates = [];
  for (const d of DIRS) candidates.push({ x: origin.x + d.dx, y: origin.y + d.dy, z });
  for (const f of footprint) for (const d of DIRS) candidates.push({ x: f.x + d.dx, y: f.y + d.dy, z });
  for (const p of candidates) {
    if (inFootprint(p)) continue;
    const tile = getTile(state.map, p);
    if (!tile || !getTerrain(tile.t).water || tile.blocked || tile.obj || getHeroAt(state, p)) continue;
    return p;
  }
  return null;
}

/** Water tile where a shipyard object would launch its boat (doc §3.6). */
export function shipyardLaunchTile(state, obj) {
  return findFreeWaterTile(state, obj.pos, getFootprint(getMapObject(obj.defId), obj.pos));
}

/** Create an empty boat. */
export function createBoat(state, pos, owner = null) {
  return addObject(state, 'boat', pos, { data: { heroId: null, owner } });
}
