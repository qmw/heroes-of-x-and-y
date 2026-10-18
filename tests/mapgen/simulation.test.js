// A week of play on generated maps with the default AI driver (it just ends the turn): the state
// stays consistent and serializable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../../src/engine/mapgen/index.js';
import { createGame, endTurn, setAiDriver, serialize, deserialize } from '../../src/engine/game.js';
import { resetGameDeps } from '../../src/engine/gameDeps.js';
import { getTerrain } from '../../src/data/terrain.js';

function checkState(state) {
  const { map } = state;
  for (const h of Object.values(state.heroes)) {
    const t = map.tiles[h.pos.z || 0][h.pos.y][h.pos.x];
    assert.ok(getTerrain(t.t).passable, `hero ${h.id} on passable ground`);
    assert.ok(state.players[h.owner].heroes.includes(h.id));
  }
  for (const t of Object.values(state.towns)) {
    const obj = map.objects[t.objectId];
    assert.ok(obj && obj.data.townId === t.id, `town ${t.id} has its map object`);
  }
  for (const o of Object.values(map.objects)) assert.ok(o.pos.x >= 0 && o.pos.x < map.width && o.pos.y >= 0 && o.pos.y < map.height);
  assert.deepEqual(deserialize(serialize(state)), state);
}

for (const [label, opts] of [
  ['M ring, 3 players', { size: 'M', template: 'ring', players: 3, seed: 17 }],
  ['S duel, two levels', { size: 'S', template: 'duel', players: 2, seed: 18, levels: 2 }],
  ['M archipelago', { size: 'M', template: 'archipelago', players: 2, seed: 19 }],
]) {
  test(`7-day simulation on a generated map stays valid (${label})`, () => {
    resetGameDeps();
    setAiDriver(null);
    const bp = generateMap(opts);
    assert.notEqual(bp.ok, false, bp.error);
    const n = bp.meta.playerSlots;
    const state = createGame(bp, { seed: 3, difficulty: 1, players: Array.from({ length: n }, (_, i) => ({ slot: i, isHuman: i === 0, faction: 'random' })) });
    checkState(state);
    const gold0 = state.players[0].resources.gold;
    for (let day = 0; day < 7; day++) {
      const r = endTurn(state);
      assert.ok(r.ok, JSON.stringify(r));
      checkState(state);
    }
    assert.equal(state.turn, 8);
    assert.equal(state.date.week, 2);
    assert.ok(state.players[0].resources.gold > gold0, 'income arrived');
    assert.equal(state.gameOver, null);
  });
}
