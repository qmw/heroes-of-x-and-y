// Shared helpers of the game / town / economy tests. Hermetic: the gameDeps fallbacks are used, so
// these tests do not depend on the hero / adventure engines.
import { createTestState } from '../../src/engine/testing.js';
import { RESOURCES } from '../../src/core/constants.js';
import { deps, useFallbackDeps } from '../../src/engine/gameDeps.js';
import { createTown, visitTown, build } from '../../src/engine/town.js';

/** Fresh state on the fallback deps; every player is rich unless `opts.poor`. */
export function setup(opts = {}) {
  useFallbackDeps();
  const state = createTestState(opts);
  if (!opts.poor) for (const p of state.players) rich(state, p.id);
  return state;
}

export function rich(state, playerId, amount = 1000000) {
  for (const r of RESOURCES) state.players[playerId].resources[r] = amount;
}

export function setResources(state, playerId, res) {
  for (const r of RESOURCES) state.players[playerId].resources[r] = res[r] || 0;
}

export function town(state, opts = {}) {
  return createTown(state, { faction: 'castle', owner: 0, pos: { x: 5, y: 5, z: 0 }, ...opts });
}

/** Add a hero; with `townId` he becomes the visiting hero of that town. */
export function hero(state, defId, playerId = 0, townId = null) {
  const t = townId ? state.towns[townId] : null;
  const h = deps.addHero(state, defId, playerId, t ? t.pos : { x: 1, y: 1, z: 0 });
  if (t) {
    const r = visitTown(state, h.id, townId);
    if (!r.ok) throw new Error(`visitTown failed: ${r.error}`);
  }
  return h;
}

/** Build several buildings, ignoring the one-per-day limit; throws on the first failure. */
export function buildAll(state, townId, ids) {
  for (const id of ids) {
    state.towns[townId].builtThisTurn = false;
    const r = build(state, townId, id);
    if (!r.ok) throw new Error(`build ${id} failed: ${r.error} ${JSON.stringify(r.missing || '')}`);
  }
  state.towns[townId].builtThisTurn = false;
}

/** Tiny blueprint: 24x24 grass, a lake in the middle, 2 player towns and 1 neutral town. */
export function tinyBlueprint(mapFactory, { mines = false } = {}) {
  const map = mapFactory(24, 24, 1, 'grass');
  for (let y = 10; y <= 13; y++) for (let x = 10; x <= 13; x++) map.tiles[0][y][x].t = 'water';
  if (mines) {
    // a pre-flagged set of mines per player (one of each kind), far from the towns
    const kinds = ['sawmill', 'ore_pit', 'alchemists_lab', 'sulfur_dune', 'crystal_cavern', 'gem_pond', 'gold_mine'];
    [0, 1].forEach((owner) => kinds.forEach((defId, i) => {
      const pos = { x: 1 + i * 3, y: owner === 0 ? 16 : 1, z: 0 };
      const id = `mine_${owner}_${defId}`;
      map.objects[id] = { id, defId, pos, owner, data: {} };
      map.tiles[0][pos.y][pos.x].obj = id;
    }));
  }
  return {
    map,
    towns: [
      { pos: { x: 4, y: 4, z: 0 }, faction: 'castle', ownerSlot: 0 },
      { pos: { x: 19, y: 19, z: 0 }, faction: 'random', ownerSlot: 1 },
      { pos: { x: 12, y: 8, z: 0 }, faction: 'rampart', ownerSlot: null },
    ],
    heroes: [
      { ownerSlot: 0, pos: { x: 4, y: 6, z: 0 }, defId: 'orrin' },
      { ownerSlot: 1, pos: { x: 19, y: 21, z: 0 }, defId: 'random' },
    ],
    meta: { name: 'Tiny', description: 'test map', playerSlots: 2, size: 24 },
  };
}
