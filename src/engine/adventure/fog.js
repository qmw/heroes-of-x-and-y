// Fog of war. `player.explored[z]` is a flat number[] (0|1) of width*height per level (plain JSON).
// "Explored" is permanent knowledge of the terrain; "visible" is what the player currently sees
// (within the sight radius of an own/allied hero, town or flagged object) and is computed on demand.
import { deps } from './deps.js';
import { inBounds } from './map.js';
import { getPlayer, areAllies } from './util.js';

export const TOWN_SIGHT_RADIUS = 5;
export const OBJECT_SIGHT_RADIUS = 3;

export function ensureExplored(state, player) {
  const { width, height, levels } = state.map;
  player.explored ??= [];
  for (let z = 0; z < levels; z++) {
    if (!Array.isArray(player.explored[z]) || player.explored[z].length !== width * height) {
      player.explored[z] = new Array(width * height).fill(0);
    }
  }
  return player.explored;
}

/** Players sharing vision with `playerId` (itself + team mates). */
function visionGroup(state, playerId) {
  return state.players.filter((p) => areAllies(state, p.id, playerId));
}

function forCircle(map, pos, radius, fn) {
  const z = pos.z || 0;
  if (z < 0 || z >= map.levels) return;
  const r2 = radius * radius;
  for (let y = Math.max(0, pos.y - radius); y <= Math.min(map.height - 1, pos.y + radius); y++) {
    for (let x = Math.max(0, pos.x - radius); x <= Math.min(map.width - 1, pos.x + radius); x++) {
      if ((x - pos.x) ** 2 + (y - pos.y) ** 2 <= r2) fn(x, y, z);
    }
  }
}

/**
 * Mark every tile within Euclidean distance `radius` of `pos` as explored for the player (and allies).
 * @returns {number} number of newly explored tiles (for the player itself)
 */
export function revealAround(state, playerId, pos, radius) {
  const map = state.map;
  let fresh = 0;
  for (const p of visionGroup(state, playerId)) {
    const ex = ensureExplored(state, p);
    forCircle(map, pos, radius, (x, y, z) => {
      const i = y * map.width + x;
      if (!ex[z][i]) { ex[z][i] = 1; if (p.id === playerId) fresh++; }
    });
  }
  return fresh;
}

/** Reveal every tile matching `pred(tile, x, y, z)`. */
export function revealWhere(state, playerId, pred) {
  const map = state.map;
  let fresh = 0;
  for (const p of visionGroup(state, playerId)) {
    const ex = ensureExplored(state, p);
    for (let z = 0; z < map.levels; z++) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const i = y * map.width + x;
          if (!ex[z][i] && pred(map.tiles[z][y][x], x, y, z)) { ex[z][i] = 1; if (p.id === playerId) fresh++; }
        }
      }
    }
  }
  return fresh;
}

export function isExplored(state, playerId, pos) {
  const p = getPlayer(state, playerId);
  if (!p || !inBounds(state.map, pos)) return false;
  return !!p.explored?.[pos.z || 0]?.[pos.y * state.map.width + pos.x];
}

/** Vision sources of a player: `[{pos, radius}]` (own and allied heroes, towns, flagged objects). */
export function getVisionSources(state, playerId) {
  const out = [];
  for (const h of Object.values(state.heroes)) {
    if (h.owner != null && areAllies(state, h.owner, playerId)) out.push({ pos: h.pos, radius: deps.getSightRadius(state, h) });
  }
  for (const t of Object.values(state.towns)) {
    if (t.owner != null && areAllies(state, t.owner, playerId)) out.push({ pos: t.pos, radius: deps.getTownSightRadius(t) || TOWN_SIGHT_RADIUS });
  }
  for (const o of Object.values(state.map.objects)) {
    if (o.owner != null && o.defId !== 'town' && o.defId !== 'boat' && areAllies(state, o.owner, playerId)) out.push({ pos: o.pos, radius: OBJECT_SIGHT_RADIUS });
  }
  return out;
}

/** Currently visible tiles: per level a flat number[] (0|1). Computed, not stored. */
export function getVisibleTiles(state, playerId) {
  const map = state.map;
  const vis = [];
  for (let z = 0; z < map.levels; z++) vis.push(new Array(map.width * map.height).fill(0));
  for (const s of getVisionSources(state, playerId)) forCircle(map, s.pos, s.radius, (x, y, z) => { vis[z][y * map.width + x] = 1; });
  return vis;
}

export function isVisible(state, playerId, pos) {
  if (!inBounds(state.map, pos)) return false;
  const z = pos.z || 0;
  for (const s of getVisionSources(state, playerId)) {
    if ((s.pos.z || 0) === z && (s.pos.x - pos.x) ** 2 + (s.pos.y - pos.y) ** 2 <= s.radius * s.radius) return true;
  }
  return false;
}

/** Explore everything the player currently sees (call at game start / day start). */
export function refreshVision(state, playerId) {
  let fresh = 0;
  for (const s of getVisionSources(state, playerId)) fresh += revealAround(state, playerId, s.pos, s.radius);
  return fresh;
}

/**
 * Cover of darkness: un-explore tiles within `radius` of `pos` for one player, except tiles that
 * player currently sees. @returns {number} tiles hidden
 */
export function hideAround(state, playerId, pos, radius) {
  const p = getPlayer(state, playerId);
  if (!p) return 0;
  const map = state.map;
  const ex = ensureExplored(state, p);
  const vis = getVisibleTiles(state, playerId);
  let hidden = 0;
  forCircle(map, pos, radius, (x, y, z) => {
    const i = y * map.width + x;
    if (ex[z][i] && !vis[z][i]) { ex[z][i] = 0; hidden++; }
  });
  return hidden;
}
