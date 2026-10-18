// Shared helpers of the AI tests: real engines, small handmade maps.
import { createRng, randInt } from '../../src/core/rng.js';
import assert from 'node:assert/strict';
import { createGame, endTurn, runAiTurn, resetGameDeps, startNewDay } from '../../src/engine/game.js';
import { getPending } from '../../src/engine/pending.js';
import { engineReady } from '../../src/engine/hero.js';
import * as adv from '../../src/engine/adventure/index.js';
import { installAi, aiDriver, getLastAiReport } from '../../src/engine/ai/index.js';
import { armyStrength } from '../../src/engine/army.js';
import { setAiSafetyMs } from '../../src/engine/ai/context.js';
// Deterministic tests: no wall-clock cut-off of AI turns.
setAiSafetyMs(Infinity);

export { adv };
export const P = (x, y, z = 0) => ({ x, y, z });

export async function ready() {
  await engineReady;
  resetGameDeps();
  adv.resetDeps();
  installAi();
}

/**
 * A game on an empty grass map. `towns`: [{pos, faction, ownerSlot}], `players`: slots config.
 * @returns {object} GameState (current player = the first player)
 */
export function makeGame({ size = 24, seed = 1, difficulty = 2, towns, heroes = [], players, autoHeroes = true, mapFn = null } = {}) {
  const map = adv.createEmptyMap(size, size, 1, 'grass');
  if (mapFn) mapFn(map);
  const blueprint = {
    map,
    towns: towns || [{ pos: P(4, 4), faction: 'castle', ownerSlot: 0 }],
    heroes,
    meta: { name: 'AI test', description: '', playerSlots: 2, size },
  };
  const cfg = players || [{ slot: 0, isHuman: false, faction: 'castle' }];
  return createGame(blueprint, { seed, difficulty, players: cfg, autoHeroes, neutralGarrisons: true });
}

/** Scatter collectible objects / monsters deterministically over free tiles. */
export function scatter(state, { seed = 7, piles = 20, mines = 6, monsters = 10, misc = 8, avoid = [] } = {}) {
  const rng = createRng(seed);
  const { width, height } = state.map;
  const free = (p) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = state.map.tiles[0][p.y + dy]?.[p.x + dx];
        if (!t || t.obj || t.blocked) return false;
      }
    }
    return !avoid.some((a) => Math.abs(a.x - p.x) <= 4 && Math.abs(a.y - p.y) <= 4);
  };
  const place = (defId, params) => {
    for (let i = 0; i < 60; i++) {
      const p = P(randInt(rng, 2, width - 3), randInt(rng, 2, height - 3));
      if (!free(p)) continue;
      try {
        if (!adv.canPlaceObject(state, defId, p)) continue;
        return adv.addObject(state, defId, p, params);
      } catch {
        return null;
      }
    }
    return null;
  };
  const pileIds = ['resource_wood', 'resource_ore', 'resource_gold', 'resource_random', 'treasure_chest', 'campfire'];
  for (let i = 0; i < piles; i++) place(pileIds[i % pileIds.length]);
  const mineIds = ['sawmill', 'ore_pit', 'gold_mine', 'alchemists_lab', 'crystal_cavern', 'gem_pond', 'sulfur_dune'];
  for (let i = 0; i < mines; i++) place(mineIds[i % mineIds.length]);
  const mon = ['random_monster_1', 'random_monster_1', 'random_monster_2', 'random_monster_3', 'random_monster_4', 'random_monster_5'];
  for (let i = 0; i < monsters; i++) place(mon[i % mon.length]);
  const miscIds = ['artifact_treasure', 'learning_stone', 'windmill', 'guardhouse', 'mercenary_camp', 'archers_tower', 'witch_hut', 'pandoras_box'];
  for (let i = 0; i < misc; i++) place(miscIds[i % miscIds.length]);
}

/** Play `days` full days of an all-AI game (manual AI stepping: every player plays every day). */
export function playDays(state, days, onDay) {
  for (let d = 0; d < days && !state.gameOver; d++) {
    for (let k = 0; k < state.players.length && !state.gameOver; k++) {
      const r = runAiTurn(state);
      if (!r.ok) throw new Error(`runAiTurn failed: ${r.error}`);
      if (state.gameOver) break;
      const e = endTurn(state, { manualAi: true });
      if (!e.ok) throw new Error(`endTurn failed: ${e.error}`);
    }
    if (onDay) onDay(state);
  }
}

export function playerArmy(state, playerId) {
  const p = state.players[playerId];
  let s = 0;
  for (const id of p.heroes) if (state.heroes[id]) s += armyStrength(state.heroes[id].army);
  for (const id of p.towns) {
    const t = state.towns[id];
    if (t && !t.garrisonHero) s += armyStrength(t.garrison);
  }
  return s;
}

const TWO = [{ slot: 0, isHuman: false, faction: 'castle' }, { slot: 1, isHuman: true, faction: 'rampart' }];

/**
 * One AI player (0) with a castle town (default at (4,4)) and his hero; player 1 (human) sits far
 * away behind an untouchable garrison (keeps the game from ending).
 */
export function solo(opts = {}) {
  const size = opts.size || 24;
  const s = makeGame({
    size, seed: opts.seed || 1, difficulty: opts.difficulty ?? 2, mapFn: opts.mapFn,
    towns: [
      { pos: opts.townPos || P(4, 4), faction: 'castle', ownerSlot: 0, buildings: opts.buildings },
      { pos: opts.farPos || P(size - 4, size - 3), faction: 'rampart', ownerSlot: 1 },
    ],
    players: TWO,
  });
  const far = s.towns[s.players[1].towns[0]];
  far.garrison = [{ creatureId: 'angel', count: 200 }, null, null, null, null, null, null];
  const hero = s.heroes[s.players[0].heroes[0]];
  return { s, hero };
}

/** Play `days` days of player 0 only (the human never moves). */
export function soloDays(s, days, each) {
  for (let d = 0; d < days; d++) {
    s.currentPlayer = 0;
    assert.equal(s.gameOver, null);
    aiDriver(s, 0);
    const rep = getLastAiReport(0);
    assert.deepEqual(rep.errors.filter((e) => e.includes('_threw')), [], 'no exceptions inside the AI');
    if (getPending(s, 0).length) throw new Error(`left pending ${getPending(s, 0)[0].kind}`);
    if (each) each(s, rep);
    startNewDay(s);
  }
}
