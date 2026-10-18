import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useFallbackDeps } from '../../src/engine/gameDeps.js';
import { serialize } from '../../src/engine/game.js';
import { getMageGuildLevel } from '../../src/engine/town.js';
import { runSimulation, assertValidState } from './sim.js';

test('60-day scripted game on the tiny blueprint stays valid and serializable', () => {
  useFallbackDeps();
  const { state, stats } = runSimulation({ days: 60, seed: 42 });
  assert.equal(state.turn, 61);
  assert.deepEqual(state.date, { day: 5, week: 1, month: 3 });
  assert.equal(state.gameOver, null);
  assert.ok(state.players.every((p) => p.alive));
  assertValidState(state);
  // the script really exercised the engine
  assert.equal(stats.aiTurns, 60);
  assert.equal(stats.saves, 6);
  assert.ok(stats.built >= 45, `built ${stats.built}`);
  assert.ok(stats.recruited > 400, `recruited ${stats.recruited}`);
  assert.ok(stats.hired >= 2 && stats.trades > 0 && stats.swaps > 0 && stats.moves > 0 && stats.visits > 0, JSON.stringify(stats));
  assert.ok(stats.upgraded > 0 && stats.spellbooks >= 1 && stats.machines >= 1, JSON.stringify(stats));
  // both kingdoms developed
  for (const p of state.players) {
    const t = state.towns[p.towns[0]];
    assert.ok(t.buildings.length >= 14, `${t.name}: ${t.buildings.length} buildings`);
    assert.ok(t.buildings.includes('capitol'), `${t.name} has a capitol`);
    assert.ok(getMageGuildLevel(t) >= 3);
    assert.equal(p.heroes.length, 2);
    assert.ok(p.heroes.some((id) => state.heroes[id].spells.length >= 5), 'a hero learned guild spells');
  }
  // 8 week starts happened and were logged
  assert.equal(state.log.filter((e) => e.type === 'week_started' || e.type === 'month_started').length, 8);
  assert.equal(state.log.filter((e) => e.type === 'month_started').length, 2);
  // the neutral town kept growing
  const neutral = Object.values(state.towns).find((t) => t.owner === null);
  assert.equal(neutral.garrison[0].count, 55, '28 centaurs growing 10 % for 8 weeks');
  assert.equal(typeof serialize(state), 'string');
});

test('the simulation is deterministic for a seed', () => {
  useFallbackDeps();
  const a = runSimulation({ days: 25, seed: 7 });
  const b = runSimulation({ days: 25, seed: 7 });
  assert.deepEqual(a.state, b.state);
  assert.deepEqual(a.stats, b.stats);
  const c = runSimulation({ days: 25, seed: 8 });
  assert.notDeepEqual(c.state.rng, a.state.rng);
});
