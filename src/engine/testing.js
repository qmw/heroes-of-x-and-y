// Test helper shared by every engine area: builds a minimal but valid GameState (DESIGN.md §4).
// Dependency-light on purpose (core + data only) so it never drags a half-written engine module
// into another agent's tests.

import { emptyResources, PLAYER_COLORS, FACTIONS } from '../core/constants.js';
import { createRng } from '../core/rng.js';

/**
 * Build an empty map: `levels` x `height` x `width` tiles of one terrain.
 * @returns {object} GameMap
 */
export function createTestMap(width = 20, height = 20, levels = 1, terrain = 'grass') {
  const tiles = [];
  for (let z = 0; z < levels; z++) {
    const level = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) row.push({ t: terrain, road: 0, river: 0, obj: null, blocked: false });
      level.push(row);
    }
    tiles.push(level);
  }
  return { width, height, levels, tiles, objects: {} };
}

/**
 * Minimal valid GameState.
 * @param {object} [opts]
 * @param {number} [opts.players=2]        number of players
 * @param {number} [opts.seed=1]
 * @param {number} [opts.width=20] @param {number} [opts.height=20] @param {number} [opts.levels=1]
 * @param {string} [opts.terrain='grass']
 * @param {object} [opts.resources]        starting resources of every player (merged over the default)
 * @param {string[]} [opts.factions]       faction per player (default: FACTIONS in order)
 * @param {boolean[]} [opts.humans]        isHuman per player (default: all human)
 * @returns {object} GameState
 */
export function createTestState(opts = {}) {
  const {
    players = 2, seed = 1, width = 20, height = 20, levels = 1, terrain = 'grass',
    resources = {}, factions = FACTIONS, humans = [],
  } = opts;
  const state = {
    version: 1,
    rng: createRng(seed),
    nextId: 1,
    turn: 1,
    date: { day: 1, week: 1, month: 1 },
    weekOf: { creatureId: null, kind: 'normal' },
    currentPlayer: 0,
    players: [],
    heroes: {},
    towns: {},
    map: createTestMap(width, height, levels, terrain),
    combat: null,
    pending: [],
    settings: { difficulty: 1, victory: 'standard', loss: 'standard' },
    log: [],
    winner: null,
  };
  for (let i = 0; i < players; i++) {
    state.players.push({
      id: i,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      name: `Player ${i + 1}`,
      isHuman: humans[i] ?? true,
      faction: factions[i % factions.length],
      alive: true,
      resources: { ...emptyResources(), gold: 20000, wood: 20, ore: 20, mercury: 10, sulfur: 10, crystal: 10, gems: 10, ...resources },
      heroes: [],
      towns: [],
      explored: [],
      tavernHeroes: [],
      daysWithoutTown: 0,
      ai: {},
      visited: {},
    });
  }
  return state;
}

/**
 * Add a bare Town entity (no map object, no engine logic) for tests of other modules.
 * @param {object} state
 * @param {{faction?: string, owner?: number|null, pos?: object, buildings?: string[], name?: string, id?: string}} [o]
 */
export function addTestTown(state, o = {}) {
  const id = o.id || `t${state.nextId++}`;
  const town = {
    id,
    name: o.name || `Town ${id}`,
    faction: o.faction || 'castle',
    owner: o.owner ?? null,
    pos: o.pos ? { ...o.pos } : { x: 1, y: 1, z: 0 },
    buildings: o.buildings ? o.buildings.slice() : ['village_hall'],
    builtThisTurn: false,
    garrison: new Array(7).fill(null),
    visitingHero: null,
    garrisonHero: null,
    stock: {},
    mageGuild: [[], [], [], [], []],
  };
  state.towns[id] = town;
  if (town.owner != null && state.players[town.owner]) state.players[town.owner].towns.push(id);
  return town;
}
