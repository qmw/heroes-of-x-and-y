// Runs the adventure engine against the REAL hero / bonuses / economy / town / combat modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../../src/engine/testing.js';
import * as adv from '../../src/engine/adventure/index.js';
import * as hero from '../../src/engine/hero.js';
import { resolvePending } from '../../src/engine/pending.js';

const P = (x, y, z = 0) => ({ x, y, z });

function realState(humans = [false, false]) {
  adv.resetDeps();
  const state = createTestState({ width: 16, height: 12, humans });
  state.map = adv.createEmptyMap(16, 12, 1, 'grass');
  const h = hero.addHero(state, 'christian', 0, P(2, 5));
  h.army = [{ creatureId: 'angel', count: 20 }, null, null, null, null, null, null];
  h.movePoints = h.maxMovePoints = 1500;
  return { state, h };
}

test('real modules: deps resolve to the real implementations', () => {
  adv.resetDeps();
  for (const name of ['getHeroBonuses', 'getMaxMovePoints', 'giveExperience', 'startCombat', 'pay', 'visitTown', 'getTownSightRadius']) {
    assert.ok(adv.deps && (adv.deps[name]), name);
  }
});

test('real modules: move, pick up, learn, and beat a monster with quick combat', async () => {
  if (hero.engineReady) await hero.engineReady;
  const { state, h } = realState();
  adv.addObject(state, 'resource_gold', P(4, 5));
  adv.addObject(state, 'learning_stone', P(6, 6));
  const mon = adv.addObject(state, 'monster', P(10, 5), { data: { creatureId: 'peasant', count: 10, disposition: 'savage' } });
  const g = state.players[0].resources.gold;
  let res = adv.moveHero(state, h.id, P(4, 5));
  assert.ok(res.ok, res.error);
  assert.ok(state.players[0].resources.gold > g);
  res = adv.moveHero(state, h.id, P(6, 6));
  assert.ok(res.ok, res.error);
  assert.ok(h.exp >= 1000);
  assert.ok(state.pending.some((p) => p.kind === 'level_up'), 'real giveExperience queues the level-up');
  while (state.pending.length) resolvePending(state, state.pending[0].id, 0);
  h.movePoints = 1500;
  res = adv.moveHero(state, h.id, P(10, 5));
  assert.ok(res.ok, res.error);
  // savage stack vs 20 angels: they flee -> pursue
  while (state.pending.length) resolvePending(state, state.pending[0].id, 0);
  assert.equal(state.combat, null, 'quick combat resolved immediately for the AI player');
  assert.equal(state.map.objects[mon.id], undefined);
  assert.equal(state.players[0].visited[`killed_${mon.id}`], true);
  assert.deepEqual(JSON.parse(JSON.stringify(state.map)), state.map);
});

test('real modules: town entry and mine income', () => {
  const { state, h } = realState();
  adv.addObject(state, 'gold_mine', P(5, 5));
  adv.moveHero(state, h.id, P(5, 5));
  assert.deepEqual(adv.getMineIncome(state, 0), { gold: 1000 });
});

test('real modules: defeat_hero / defeat_monster victory credit comes from the combat outcome', async () => {
  if (hero.engineReady) await hero.engineReady;
  const { checkVictory } = await import('../../src/engine/victory.js');
  // defeat_hero: player 0 beats player 1's hero; the check runs on player 1's turn but credits player 0
  {
    const { state, h } = realState();
    const enemy = hero.addHero(state, 'edric', 1, P(5, 5));
    enemy.army = [{ creatureId: 'peasant', count: 3 }, null, null, null, null, null, null];
    hero.addHero(state, 'sorsha', 1, P(14, 10)); // player 1 stays alive
    state.settings.victory = { type: 'defeat_hero', heroId: enemy.id, allowStandard: true, appliesToAi: true };
    const res = adv.moveHero(state, h.id, P(5, 5));
    assert.ok(res.ok, res.error);
    assert.equal(state.heroes[enemy.id], undefined);
    assert.equal(state.defeated.hero[enemy.id], 0);
    state.currentPlayer = 1;
    const v = checkVictory(state);
    assert.deepEqual([v.over, v.winner, state.gameOver.reason], [true, 0, 'defeat_hero']);
  }
  // defeat_monster
  {
    const { state, h } = realState();
    hero.addHero(state, 'sorsha', 1, P(14, 10));
    const mon = adv.addObject(state, 'monster', P(5, 5), { data: { creatureId: 'peasant', count: 5, character: 10 } });
    state.settings.victory = { type: 'defeat_monster', objectId: mon.id, allowStandard: true, appliesToAi: true };
    adv.moveHero(state, h.id, P(5, 5));
    while (state.pending.length) resolvePending(state, state.pending[0].id, 0);
    assert.equal(state.map.objects[mon.id], undefined);
    assert.equal(state.defeated.monster[mon.id], 0);
    state.currentPlayer = 1;
    assert.equal(checkVictory(state).winner, 0);
  }
});
