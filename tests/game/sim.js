// Scripted 60-day game used by simulation.test.js (fallback deps) and integration.test.js (real engine).
import assert from 'node:assert/strict';
import { RESOURCES, ARMY_SLOTS } from '../../src/core/constants.js';
import { getBuilding } from '../../src/data/buildings.js';
import { getCreature } from '../../src/data/creatures.js';
import { createTestMap } from '../../src/engine/testing.js';
import { getPending } from '../../src/engine/pending.js';
import { dateFromTurn } from '../../src/engine/calendar.js';
import { marketTrade, countMarketplaces } from '../../src/engine/economy.js';
import {
  createGame, endTurn, setAiDriver, serialize, deserialize, getKingdomOverview, resolvePending,
} from '../../src/engine/game.js';
import {
  getAvailableBuildings, build, recruitAll, hireHero, swapTownHeroes, townArmyMove, upgradeStack,
  getUpgradeInfo, buySpellbook, buyWarMachine, getWarMachinesForSale, leaveTown, visitTown, getGarrisonArmy,
} from '../../src/engine/town.js';
import { tinyBlueprint } from './fixture.js';

const BUILD_PRIORITY = ['town_hall', 'marketplace', 'blacksmith', 'mage_guild_1', 'city_hall', 'citadel', 'castle', 'capitol', 'resource_silo'];

/** Structural invariants of a GameState; throws with a readable message. */
export function assertValidState(s) {
  assert.deepEqual(s.date, dateFromTurn(s.turn), 'date matches turn');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'state is plain JSON');
  assert.ok(Number.isInteger(s.rng.s));
  s.players.forEach((p, i) => {
    assert.equal(p.id, i);
    for (const r of RESOURCES) assert.ok(Number.isInteger(p.resources[r]) && p.resources[r] >= 0, `player ${i} ${r} = ${p.resources[r]}`);
    for (const tid of p.towns) assert.equal(s.towns[tid].owner, i, `town ${tid} owner`);
    for (const hid of p.heroes) assert.equal(s.heroes[hid]?.owner, i, `hero ${hid} owner`);
    assert.ok(p.heroes.length <= 8);
    assert.equal(new Set(p.towns).size, p.towns.length);
    if (!p.alive) assert.deepEqual([p.towns, p.heroes], [[], []]);
  });
  const checkArmy = (army, what) => {
    assert.equal(army.length, ARMY_SLOTS, what);
    for (const st of army) {
      if (st === null) continue;
      getCreature(st.creatureId);
      assert.ok(Number.isInteger(st.count) && st.count > 0, `${what}: ${JSON.stringify(st)}`);
    }
  };
  for (const t of Object.values(s.towns)) {
    if (t.owner != null) assert.ok(s.players[t.owner].towns.includes(t.id));
    assert.equal(new Set(t.buildings).size, t.buildings.length, `${t.id} duplicate buildings`);
    for (const b of t.buildings) {
      const def = getBuilding(b);
      assert.ok(!def.replaces || !t.buildings.includes(def.replaces), `${t.id}: ${def.replaces} should be replaced by ${b}`);
    }
    assert.equal(t.buildings.filter((b) => getBuilding(b).kind === 'hall').length, 1);
    for (const [c, n] of Object.entries(t.stock)) {
      getCreature(c);
      assert.ok(Number.isInteger(n) && n >= 0, `${t.id} stock ${c} = ${n}`);
    }
    checkArmy(t.garrison, `${t.id} garrison`);
    assert.equal(t.mageGuild.length, 5);
    for (const key of ['visitingHero', 'garrisonHero']) {
      if (!t[key]) continue;
      const h = s.heroes[t[key]];
      assert.ok(h, `${t.id}.${key} points to a missing hero`);
      assert.equal(h.townId, t.id);
      assert.equal(h.owner, t.owner);
    }
    if (t.garrisonHero) assert.ok(t.garrison.every((x) => x === null), 'garrison troops belong to the garrison hero');
    assert.ok(!t.visitingHero || t.visitingHero !== t.garrisonHero);
  }
  for (const h of Object.values(s.heroes)) {
    checkArmy(h.army, `hero ${h.id}`);
    assert.ok(h.army.some(Boolean), `hero ${h.id} has no troops`);
    assert.ok(s.players[h.owner].heroes.includes(h.id));
    assert.ok(h.mana >= 0 && h.movePoints >= 0);
    if (h.townId) {
      const t = s.towns[h.townId];
      assert.ok(t.visitingHero === h.id || t.garrisonHero === h.id, `hero ${h.id} claims town ${h.townId}`);
    }
  }
  const capitols = {};
  for (const t of Object.values(s.towns)) if (t.owner != null && t.buildings.includes('capitol')) capitols[t.owner] = (capitols[t.owner] || 0) + 1;
  for (const n of Object.values(capitols)) assert.equal(n, 1, 'one capitol per player');
}

function resolveAll(state, playerId) {
  for (let i = 0; i < 100; i++) {
    const p = getPending(state, playerId)[0];
    if (!p) return;
    const r = resolvePending(state, p.id, 0);
    if (!r.ok) state.pending = state.pending.filter((x) => x.id !== p.id);
  }
}

/** One scripted turn of a player: build, recruit, hire, trade, shuffle armies. */
export function playTurn(state, playerId, stats) {
  const player = state.players[playerId];
  if (!player.alive) return;
  for (const townId of player.towns) {
    const town = state.towns[townId];
    // build: priority list first, otherwise the cheapest available building
    const options = getAvailableBuildings(state, townId).filter((b) => b.status === 'available');
    const pick = BUILD_PRIORITY.map((id) => options.find((b) => b.id === id)).find(Boolean)
      || options.sort((a, b) => (a.cost.gold || 0) - (b.cost.gold || 0))[0];
    if (pick) {
      const r = build(state, townId, pick.id);
      assert.equal(r.ok, true, `build ${pick.id}: ${r.error}`);
      stats.built++;
      assert.equal(build(state, townId, pick.id).error, 'already_built');
    }
    resolveAll(state, playerId);
    // tavern: a second hero as soon as the visiting slot is free
    if (!town.visitingHero && player.heroes.length < 2 && player.resources.gold >= 2500) {
      const r = hireHero(state, townId, 0);
      if (r.ok) stats.hired++;
    }
    // recruit on days 1 and 4 of a week when the treasury allows it
    if ((state.date.day === 1 || state.date.day === 4) && player.resources.gold > 6000) {
      const target = town.visitingHero && state.date.day === 4 ? 'visiting' : 'garrison';
      const r = recruitAll(state, townId, target);
      assert.equal(r.ok, true);
      stats.recruited += r.events.reduce((n, e) => n + e.count, 0);
    }
    // upgrade whatever can be upgraded
    for (const where of ['garrison', 'visiting']) {
      for (let slot = 0; slot < ARMY_SLOTS; slot++) {
        if (getUpgradeInfo(state, { townId, where, slot }) && upgradeStack(state, { townId, where, slot }).ok) stats.upgraded++;
      }
    }
    const visiting = state.heroes[town.visitingHero];
    if (visiting) {
      if (buySpellbook(state, townId).ok) stats.spellbooks++;
      for (const o of getWarMachinesForSale(state, townId)) if (player.resources.gold > 8000 && buyWarMachine(state, townId, o.machineId).ok) stats.machines++;
      // hand the first garrison stack to the hero, split one creature back
      const g = getGarrisonArmy(state, town);
      const from = g.findIndex(Boolean);
      const free = visiting.army.findIndex((x, i) => !x || (g[from] && x.creatureId === g[from].creatureId && i >= 0));
      if (!town.garrisonHero && from >= 0 && free >= 0 && (!visiting.army[free] || visiting.army[free].creatureId === g[from].creatureId)) {
        if (townArmyMove(state, townId, { where: 'garrison', slot: from }, { where: 'visiting', slot: free }).ok) stats.moves++;
      }
      // every 5th day the hero swaps into / out of the garrison, on other days he may leave and return
      if (state.turn % 5 === 0) {
        if (swapTownHeroes(state, townId).ok) stats.swaps++;
      } else if (state.turn % 7 === 3) {
        assert.equal(leaveTown(state, visiting.id).ok, true);
        assert.equal(visitTown(state, visiting.id, townId).ok, true);
        stats.visits++;
      }
    } else if (town.garrisonHero && state.turn % 5 === 2) {
      if (swapTownHeroes(state, townId).ok) stats.swaps++;
    }
    resolveAll(state, playerId);
  }
  // marketplace: turn surplus gold into the scarcest resource, and surplus wood into gold
  if (countMarketplaces(state, playerId) > 0) {
    const scarce = RESOURCES.filter((r) => r !== 'gold').sort((a, b) => player.resources[a] - player.resources[b])[0];
    for (let i = 0; i < 2; i++) {
      if (player.resources.gold > 12000 && player.resources[scarce] < 10 && marketTrade(state, playerId, 'gold', scarce, 1).ok) stats.trades++;
    }
    if (player.resources.wood > 40 && marketTrade(state, playerId, 'wood', 'gold', 5).ok) stats.trades++;
  }
}

/**
 * Play `days` days on the tiny blueprint: player 0 is scripted as a human, player 1 through the AI
 * driver. Validates the state after every turn. @returns {{state, stats}}
 */
export function runSimulation({ days = 60, seed = 42, bindHeroes = true } = {}) {
  const bp = tinyBlueprint(createTestMap, { mines: true });
  if (bindHeroes) {
    // start both heroes inside their towns so that visit effects, guild learning etc. are exercised
    bp.heroes[0].pos = { ...bp.towns[0].pos };
    bp.heroes[1].pos = { ...bp.towns[1].pos };
  }
  const state = createGame(bp, {
    seed,
    difficulty: 1,
    players: [
      { slot: 0, name: 'Human', isHuman: true, faction: 'castle', bonus: 'gold' },
      { slot: 1, name: 'Computer', isHuman: false, faction: 'tower', bonus: 'resource' },
    ],
  });
  const stats = { built: 0, hired: 0, recruited: 0, upgraded: 0, spellbooks: 0, machines: 0, moves: 0, swaps: 0, visits: 0, trades: 0, aiTurns: 0, saves: 0 };
  setAiDriver((s, playerId) => {
    stats.aiTurns++;
    playTurn(s, playerId, stats);
  });
  assertValidState(state);
  let current = state;
  try {
    while (current.turn <= days && !current.gameOver) {
      const day = current.turn;
      playTurn(current, 0, stats);
      assertValidState(current);
      const r = endTurn(current);
      assert.equal(r.ok, true, `endTurn day ${day}: ${r.error}`);
      assert.equal(current.turn, day + 1, 'one human + one AI: every endTurn is a new day');
      assert.equal(current.currentPlayer, 0);
      assertValidState(current);
      getKingdomOverview(current, 0);
      getKingdomOverview(current, 1);
      // save / load every 10 days and carry on with the loaded copy
      if (day % 10 === 0) {
        const loaded = deserialize(serialize(current));
        assert.deepEqual(loaded, current);
        current = loaded;
        stats.saves++;
      }
    }
  } finally {
    setAiDriver(null);
  }
  return { state: current, stats };
}
