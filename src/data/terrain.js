// Terrain, roads, rivers and "magic terrain" overlays.
// Spec: docs/mechanics/adventure-objects.md (sections "Movement cost" and "Terrain overlays").
import { TERRAINS } from '../core/constants.js';

/**
 * @typedef {Object} Terrain
 * @property {string} id
 * @property {string} name
 * @property {number} moveCost      movement points to LEAVE one tile of this terrain orthogonally (100 = 1 tile)
 * @property {boolean} passable     false => no hero can ever stand here (rock)
 * @property {boolean} water        true => only boats / water walk / fly
 * @property {string} color         base palette colour (hex)
 * @property {string[]} colors      [base, light, dark, accent] for procedural tiles
 * @property {string[]} nativeFactions
 * @property {string} battlefield   combat background / obstacle set id
 * @property {string[]} obstacles   battlefield obstacle kinds that fit
 * @property {string[]} decor       adventure decor shapes that fit (see DECOR in mapObjects.js)
 * @property {boolean} surface      may be generated on the surface level
 * @property {boolean} underground  may be generated on the underground level
 * @property {boolean} diggable     grail can be dug here
 * @property {string|null} river    default river id drawn on this terrain
 * @property {string} description
 */

/** Diagonal step multiplier (applied to the orthogonal cost, result truncated) - sqrt(2) as in the original: 141/176/212/247, roads 106/91/70. */
export const DIAGONAL_FACTOR = Math.SQRT2;
/** Cost of one orthogonal step on penalty-free ground. */
export const BASE_MOVE_COST = 100;
/** Pathfinding: flat reduction of the terrain cost per mastery [none, basic, advanced, expert]. */
export const PATHFINDING_REDUCTION = [0, 25, 50, 75];

/** @type {Terrain[]} */
export const TERRAIN_DATA = [
  { id: 'dirt', name: 'Dirt', moveCost: 100, passable: true, water: false,
    color: '#7a5a3a', colors: ['#7a5a3a', '#8f6c47', '#5e432a', '#4a3a26'],
    nativeFactions: ['necropolis'], battlefield: 'dirt',
    obstacles: ['dead_tree', 'stump', 'boulder', 'bones', 'log'],
    decor: ['tree', 'dead_tree', 'mountain', 'rock', 'lake', 'crater', 'stump', 'shrub', 'bones', 'log'],
    surface: true, underground: false, diggable: true, river: 'muddy_river',
    description: 'Plain earth. No movement penalty.' },
  { id: 'sand', name: 'Sand', moveCost: 150, passable: true, water: false,
    color: '#d8c07a', colors: ['#d8c07a', '#e8d596', '#b99f58', '#a0823c'],
    nativeFactions: [], battlefield: 'sand',
    obstacles: ['cactus', 'boulder', 'bones', 'dune'],
    decor: ['palm', 'cactus', 'mountain', 'rock', 'dune', 'crater', 'bones', 'oasis_lake'],
    surface: true, underground: false, diggable: true, river: 'clear_river',
    description: 'Desert. 150% movement cost. Nomads in the army remove the penalty.' },
  { id: 'grass', name: 'Grass', moveCost: 100, passable: true, water: false,
    color: '#4c8a2e', colors: ['#4c8a2e', '#62a53c', '#386b20', '#d8d04a'],
    nativeFactions: ['castle', 'rampart', 'conflux'], battlefield: 'grass',
    obstacles: ['tree', 'stump', 'boulder', 'shrub', 'log'],
    decor: ['tree', 'pine', 'mountain', 'rock', 'lake', 'stump', 'shrub', 'flowers', 'log', 'crater'],
    surface: true, underground: false, diggable: true, river: 'clear_river',
    description: 'Meadows. No movement penalty.' },
  { id: 'snow', name: 'Snow', moveCost: 150, passable: true, water: false,
    color: '#e8eef4', colors: ['#e8eef4', '#ffffff', '#b9c8d8', '#8fb0d0'],
    nativeFactions: ['tower'], battlefield: 'snow',
    obstacles: ['pine', 'ice_block', 'boulder', 'stump'],
    decor: ['pine', 'mountain', 'rock', 'frozen_lake', 'ice_block', 'stump', 'crater'],
    surface: true, underground: false, diggable: true, river: 'icy_river',
    description: 'Snowfields. 150% movement cost.' },
  { id: 'swamp', name: 'Swamp', moveCost: 175, passable: true, water: false,
    color: '#4a6a4a', colors: ['#4a6a4a', '#5f8560', '#33503a', '#2c4a52'],
    nativeFactions: ['fortress', 'cove'], battlefield: 'swamp',
    obstacles: ['mangrove', 'stump', 'reeds', 'log', 'pool'],
    decor: ['mangrove', 'mountain', 'rock', 'lake', 'stump', 'reeds', 'log', 'moss'],
    surface: true, underground: false, diggable: true, river: 'muddy_river',
    description: 'Marshland. 175% movement cost - the slowest terrain.' },
  { id: 'rough', name: 'Rough', moveCost: 125, passable: true, water: false,
    color: '#9a7a4e', colors: ['#9a7a4e', '#b08e5e', '#7a5e38', '#5c4426'],
    nativeFactions: ['stronghold'], battlefield: 'rough',
    obstacles: ['boulder', 'dead_tree', 'bones', 'cactus'],
    decor: ['dead_tree', 'mountain', 'rock', 'crater', 'canyon', 'cactus', 'bones', 'shrub'],
    surface: true, underground: false, diggable: true, river: 'muddy_river',
    description: 'Broken badlands. 125% movement cost.' },
  { id: 'subterranean', name: 'Subterranean', moveCost: 100, passable: true, water: false,
    color: '#5a4a52', colors: ['#5a4a52', '#6e5c66', '#40343a', '#8a5cc0'],
    nativeFactions: ['dungeon'], battlefield: 'subterranean',
    obstacles: ['stalagmite', 'mushroom', 'boulder', 'crystal'],
    decor: ['mushroom', 'stalagmite', 'mountain', 'rock', 'lake', 'crystal', 'crater', 'bones'],
    surface: false, underground: true, diggable: true, river: 'clear_river',
    description: 'Cave floor of the underground level. No movement penalty.' },
  { id: 'lava', name: 'Lava', moveCost: 100, passable: true, water: false,
    color: '#4a3030', colors: ['#4a3030', '#5e3c3a', '#2e1c1c', '#e8601c'],
    nativeFactions: ['inferno'], battlefield: 'lava',
    obstacles: ['lava_pool', 'boulder', 'dead_tree', 'bones'],
    decor: ['volcano', 'mountain', 'rock', 'lava_lake', 'lava_flow', 'dead_tree', 'crater', 'bones'],
    surface: true, underground: true, diggable: true, river: 'lava_river',
    description: 'Cooled lava fields. No movement penalty.' },
  { id: 'highlands', name: 'Highlands', moveCost: 100, passable: true, water: false,
    color: '#6f9a4e', colors: ['#6f9a4e', '#86b262', '#547a3a', '#b8a06a'],
    nativeFactions: [], battlefield: 'highlands',
    obstacles: ['pine', 'boulder', 'stump', 'shrub'],
    decor: ['pine', 'tree', 'mountain', 'rock', 'lake', 'stump', 'shrub', 'flowers', 'crater'],
    surface: true, underground: false, diggable: true, river: 'clear_river',
    description: 'Windy upland meadows. No movement penalty.' },
  { id: 'wasteland', name: 'Wasteland', moveCost: 125, passable: true, water: false,
    color: '#b0733c', colors: ['#b0733c', '#c98a4e', '#8a5628', '#5e3a1c'],
    nativeFactions: ['factory'], battlefield: 'wasteland',
    obstacles: ['cactus', 'boulder', 'bones', 'dead_tree'],
    decor: ['cactus', 'dead_tree', 'mountain', 'rock', 'canyon', 'crater', 'bones', 'tar_pit'],
    surface: true, underground: false, diggable: true, river: 'muddy_river',
    description: 'Scorched mesa. 125% movement cost.' },
  { id: 'water', name: 'Water', moveCost: 100, passable: true, water: true,
    color: '#2a5c9a', colors: ['#2a5c9a', '#3a74b8', '#1c4478', '#bfe0f4'],
    nativeFactions: [], battlefield: 'ship',
    obstacles: [],
    decor: ['reef', 'sea_rock', 'kelp'],
    surface: true, underground: true, diggable: false, river: null,
    description: 'Sea. Only boats (or Water Walk / Fly) may cross. Sailing always costs 100 per tile.' },
  { id: 'rock', name: 'Rock', moveCost: 0, passable: false, water: false,
    color: '#1a1614', colors: ['#1a1614', '#2a2420', '#0c0a09', '#3a322c'],
    nativeFactions: [], battlefield: 'subterranean',
    obstacles: [],
    decor: [],
    surface: false, underground: true, diggable: false, river: null,
    description: 'Solid rock filling the unused underground. Impassable, cannot hold objects.' },
];

export const TERRAIN_BY_ID = Object.fromEntries(TERRAIN_DATA.map((t) => [t.id, t]));

/** @param {string} id @returns {Terrain} */
export function getTerrain(id) {
  const t = TERRAIN_BY_ID[id];
  if (!t) throw new Error(`Unknown terrain: ${id}`);
  return t;
}

/** Land terrains heroes can walk on. */
export const LAND_TERRAINS = TERRAINS.filter((id) => TERRAIN_BY_ID[id] && TERRAIN_BY_ID[id].passable && !TERRAIN_BY_ID[id].water);
/** Land terrains valid on the surface level. */
export const SURFACE_TERRAINS = LAND_TERRAINS.filter((id) => TERRAIN_BY_ID[id].surface);

/**
 * Roads. `index` is the value stored in `tile.road` (0 = no road).
 * A road is only used when BOTH the tile left and the tile entered carry a road; the cost is then
 * the road cost of the tile being left and the terrain penalty is ignored entirely.
 */
export const ROADS = [
  { id: 'dirt_road', index: 1, name: 'Dirt Road', moveCost: 75, color: '#8a6a3e', edge: '#5e4626' },
  { id: 'gravel_road', index: 2, name: 'Gravel Road', moveCost: 65, color: '#a8a090', edge: '#6e6860' },
  { id: 'cobblestone_road', index: 3, name: 'Cobblestone Road', moveCost: 50, color: '#8a8a94', edge: '#4e4e58' },
];
export const ROAD_BY_ID = Object.fromEntries(ROADS.map((r) => [r.id, r]));
export const ROAD_BY_INDEX = Object.fromEntries(ROADS.map((r) => [r.index, r]));

/**
 * Rivers are purely cosmetic (no movement effect). `tile.river` stores 0|1; the variant drawn is
 * `getTerrain(tile.t).river`. Rivers never block and objects may not be placed on river tiles.
 */
export const RIVERS = [
  { id: 'clear_river', index: 1, name: 'Clear River', color: '#4a8ad0', terrains: ['grass', 'sand', 'highlands', 'subterranean'] },
  { id: 'icy_river', index: 2, name: 'Icy River', color: '#bfe4f8', terrains: ['snow'] },
  { id: 'muddy_river', index: 3, name: 'Muddy River', color: '#6e6a3c', terrains: ['dirt', 'swamp', 'rough', 'wasteland'] },
  { id: 'lava_river', index: 4, name: 'Lava River', color: '#f0641e', terrains: ['lava'] },
];
export const RIVER_BY_ID = Object.fromEntries(RIVERS.map((r) => [r.id, r]));

/** Closed set of overlay effect types (see doc section "Terrain overlays"). */
export const OVERLAY_EFFECT_TYPES = [
  'spell_mastery',       // { school: 'air'|'earth'|'fire'|'water'|'all', level: 3 } spells of school are cast at this mastery by both sides
  'spell_level_cap',     // { maxLevel } spells above this level cannot be cast by heroes or creatures
  'nullify_morale_luck', // {} all positive and negative morale/luck modifiers are ignored (both are 0)
  'morale',              // { alignment: 'good'|'evil'|'neutral'|'all', value } per-stack by its faction alignment
  'luck',                // { alignment, value }
  'creature_stat',       // { stat, value, filter: { flying?: bool, nativeTerrain?: id } } combat stat delta
  'move_cost',           // { cost } replaces the adventure-map cost of leaving this tile
];

/**
 * Magic terrain overlays. Stored per tile by the map generator as `tile.overlay = id` (optional
 * tile field). Combat on a tile inherits the overlay of the DEFENDER's tile; adventure effects
 * (`move_cost`) apply to the tile being left.
 */
export const MAGIC_TERRAINS = [
  { id: 'magic_plains', name: 'Magic Plains', color: '#b06ad8', terrains: ['grass', 'dirt', 'highlands', 'snow', 'sand', 'rough'], water: false,
    effects: [{ type: 'spell_mastery', school: 'all', level: 3 }],
    description: 'All spells are cast at Expert level by both sides.' },
  { id: 'cursed_ground', name: 'Cursed Ground', color: '#4e3a2a', terrains: ['dirt', 'rough', 'wasteland', 'swamp', 'lava', 'subterranean'], water: false,
    effects: [{ type: 'spell_level_cap', maxLevel: 1 }, { type: 'nullify_morale_luck' }],
    description: 'Only level 1 spells can be cast; morale and luck are neutralised for both sides.' },
  { id: 'holy_ground', name: 'Holy Ground', color: '#f4ecc0', terrains: ['grass', 'dirt', 'highlands', 'snow'], water: false,
    effects: [{ type: 'morale', alignment: 'good', value: 1 }, { type: 'morale', alignment: 'evil', value: -1 }],
    description: '+1 morale to creatures of good towns, -1 morale to creatures of evil towns.' },
  { id: 'evil_fog', name: 'Evil Fog', color: '#5c6a5c', terrains: ['dirt', 'swamp', 'lava', 'subterranean', 'rough', 'wasteland'], water: false,
    effects: [{ type: 'morale', alignment: 'evil', value: 1 }, { type: 'morale', alignment: 'good', value: -1 }],
    description: '+1 morale to creatures of evil towns, -1 morale to creatures of good towns.' },
  { id: 'clover_field', name: 'Clover Field', color: '#3cae4a', terrains: ['grass', 'highlands', 'swamp'], water: false,
    effects: [{ type: 'luck', alignment: 'neutral', value: 2 }],
    description: '+2 luck to creatures of neutral-aligned towns.' },
  { id: 'lucid_pools', name: 'Lucid Pools', color: '#5ac0e0', terrains: ['grass', 'swamp', 'highlands', 'snow', 'subterranean'], water: false,
    effects: [{ type: 'spell_mastery', school: 'water', level: 3 }],
    description: 'Water Magic spells are cast at Expert level.' },
  { id: 'fiery_fields', name: 'Fiery Fields', color: '#e0582a', terrains: ['lava', 'rough', 'wasteland', 'dirt', 'subterranean'], water: false,
    effects: [{ type: 'spell_mastery', school: 'fire', level: 3 }],
    description: 'Fire Magic spells are cast at Expert level.' },
  { id: 'rocklands', name: 'Rocklands', color: '#8a7a6a', terrains: ['rough', 'dirt', 'wasteland', 'subterranean', 'highlands', 'sand'], water: false,
    effects: [{ type: 'spell_mastery', school: 'earth', level: 3 }],
    description: 'Earth Magic spells are cast at Expert level.' },
  { id: 'magic_clouds', name: 'Magic Clouds', color: '#d8e4f4', terrains: ['snow', 'highlands', 'grass', 'sand'], water: false,
    effects: [{ type: 'spell_mastery', school: 'air', level: 3 }],
    description: 'Air Magic spells are cast at Expert level.' },
  { id: 'cracked_ice', name: 'Cracked Ice', color: '#a8d4e8', terrains: ['snow'], water: false,
    effects: [{ type: 'creature_stat', stat: 'defense', value: -5, filter: { flying: false } }],
    description: 'Ground (non-flying) creatures of both sides get -5 defense.' },
  { id: 'dunes', name: 'Dunes', color: '#e8c860', terrains: ['sand'], water: false,
    effects: [{ type: 'creature_stat', stat: 'speed', value: -1, filter: { flying: false } }],
    description: 'Ground (non-flying) creatures of both sides get -1 speed.' },
  { id: 'fields_of_glory', name: 'Fields of Glory', color: '#e8b040', terrains: ['grass', 'dirt', 'rough', 'highlands', 'wasteland'], water: false,
    effects: [{ type: 'luck', alignment: 'all', value: 2 }],
    description: '+2 luck to every creature of both sides.' },
  { id: 'favorable_winds', name: 'Favorable Winds', color: '#7ab4e8', terrains: ['water'], water: true,
    effects: [{ type: 'move_cost', cost: 66 }],
    description: 'Sailing out of this tile costs 66 instead of 100 movement points.' },
];
export const MAGIC_TERRAIN_BY_ID = Object.fromEntries(MAGIC_TERRAINS.map((m) => [m.id, m]));

/** @param {string} id */
export function getMagicTerrain(id) {
  const m = MAGIC_TERRAIN_BY_ID[id];
  if (!m) throw new Error(`Unknown magic terrain: ${id}`);
  return m;
}

/**
 * Movement points needed for ONE step from tile `from` to the adjacent tile `to`.
 * Pure reference implementation of the formula in docs/mechanics/adventure-objects.md.
 *
 * @param {{t: string, road?: number, overlay?: string|null}} from  tile being left
 * @param {{t: string, road?: number}} to                            tile being entered
 * @param {boolean} diagonal
 * @param {Object} [opts]
 * @param {number} [opts.pathfinding]      0..3 mastery of Pathfinding
 * @param {string[]} [opts.nativeTerrains] terrains on which this army pays no penalty (see doc)
 * @param {number} [opts.reductionPercent] extra `terrain_penalty_reduction` percent of the penalty (0..100)
 * @param {boolean} [opts.sailing]         hero is in a boat (or flying over / walking on water)
 * @returns {number} cost in movement points, or Infinity when `to` is impassable
 */
export function stepMoveCost(from, to, diagonal, opts = {}) {
  const tf = getTerrain(from.t);
  const tt = getTerrain(to.t);
  if (!tt.passable) return Infinity;
  let cost;
  if (tf.water || opts.sailing) {
    cost = BASE_MOVE_COST;
    if (from.overlay) {
      const fx = getMagicTerrain(from.overlay).effects.find((e) => e.type === 'move_cost');
      if (fx) cost = fx.cost;
    }
  } else if (from.road && to.road) {
    cost = ROAD_BY_INDEX[from.road].moveCost;
  } else {
    cost = tf.moveCost;
    if (cost > BASE_MOVE_COST) {
      if ((opts.nativeTerrains || []).includes(tf.id)) {
        cost = BASE_MOVE_COST;
      } else {
        cost -= PATHFINDING_REDUCTION[opts.pathfinding || 0];
        if (cost < BASE_MOVE_COST) cost = BASE_MOVE_COST;
        if (opts.reductionPercent) {
          cost = BASE_MOVE_COST + Math.floor(((cost - BASE_MOVE_COST) * (100 - Math.min(100, opts.reductionPercent))) / 100);
        }
      }
    }
  }
  return diagonal ? Math.floor(cost * DIAGONAL_FACTOR) : cost;
}
