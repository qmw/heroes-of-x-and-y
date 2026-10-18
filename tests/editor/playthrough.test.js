// A 2-player map built entirely through the editor API validates, starts a game (createGame) and
// survives 7 days of endTurn - with the do-nothing driver and with the real AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/engine/editor/index.js';
import { createGame, endTurn, setAiDriver, serialize, deserialize } from '../../src/engine/game.js';
import { resetGameDeps } from '../../src/engine/gameDeps.js';
import { moveHero, findPath } from '../../src/engine/adventure/index.js';

const P = (x, y, z = 0) => ({ x, y, z });
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };

function buildMap() {
  const doc = E.newMap({ size: 'S', players: 2, name: 'Editor duel', terrain: 'grass' });
  E.setMapInfo(doc, { description: 'Built with the editor API.', difficulty: 2 });
  // terrain: a sandy south-east, a lake in the middle, some rough ground
  must(E.fillTerrain(doc, P(0, 0), 'grass'));
  for (let y = 20; y < 36; y += 4) for (let x = 20; x < 36; x += 4) must(E.paintTerrain(doc, P(x, y), 'sand', { brush: 4 }));
  must(E.paintTerrain(doc, P(16, 14), 'water', { brush: 4 }));
  must(E.paintTerrain(doc, P(4, 26), 'rough', { brush: 4 }));
  // towns + heroes
  must(E.placeObject(doc, 'town', P(6, 6), { faction: 'castle', ownerSlot: 0, name: 'Westwatch' }));
  must(E.placeObject(doc, 'town', P(29, 29), { faction: 'inferno', ownerSlot: 1 }));
  must(E.placeObject(doc, 'hero', P(6, 6), { ownerSlot: 0, defId: 'orrin' }));
  must(E.placeObject(doc, 'hero', P(29, 29), { ownerSlot: 1 }));
  must(E.placeObject(doc, 'random_town', P(28, 18), { ownerSlot: null, name: 'Crossing' }));
  // a road between the gates
  must(E.paintRoadLine(doc, P(6, 7), P(29, 7), 3));
  must(E.paintRoadLine(doc, P(29, 7), P(29, 30), 2));
  must(E.paintRiverLine(doc, P(2, 14), P(12, 18), true));
  // mines
  must(E.placeObject(doc, 'sawmill', P(10, 12), { owner: 0 }));
  must(E.placeObject(doc, 'ore_pit', P(25, 24), { owner: 1 }));
  const gold = must(E.placeObject(doc, 'gold_mine', P(18, 26)));
  // monsters: a guard in front of the gold mine and a free roaming stack
  const guard = must(E.placeObject(doc, 'monster', P(18, 27), { data: { creatureId: 'griffin', count: 6, disposition: 'hostile' } }));
  must(E.placeObject(doc, 'monster', P(30, 14), { data: { creatureId: 'goblin', count: 30 } }));
  // treasure close to player 0: a resource pile with a fixed amount
  const wood = must(E.placeObject(doc, 'resource_wood', P(8, 8), { data: { amount: 25 } }));
  must(E.placeObject(doc, 'event', P(12, 7), { data: { message: 'A merchant pays a toll.', resources: { gold: 500 }, players: [0], once: true } }));
  // a quest: kill the gold-mine guard for an artifact; and a quest guard asking for gold
  must(E.placeObject(doc, 'seers_hut', P(14, 22), { data: { quest: { type: 'kill_monster', objectId: guard.ref.id }, reward: { exp: 2000, resources: { gold: 1000 } } } }));
  must(E.placeObject(doc, 'quest_guard', P(4, 31), { data: { quest: { type: 'bring_resources', resources: { gold: 2000 } } } }));
  must(E.placeObject(doc, 'pine_trees_2x2', P(24, 3)));
  E.setPlayer(doc, 1, { human: false });
  must(E.setVictory(doc, { type: 'capture_town', townIndex: 2, allowStandard: true }));
  must(E.setLoss(doc, { type: 'lose_town', townIndex: 0 }));
  return { doc, goldMine: gold.ref.id, woodId: wood.ref.id };
}

function checkState(state) {
  for (const h of Object.values(state.heroes)) assert.ok(state.players[h.owner].heroes.includes(h.id));
  for (const t of Object.values(state.towns)) assert.equal(state.map.objects[t.objectId].data.townId, t.id);
  assert.deepEqual(deserialize(serialize(state)), state);
}

function startGame(bp) {
  const seats = E.defaultSeats(bp);
  return createGame(E.prepareForPlay(bp), E.buildPlaySettings(bp, seats, { seed: 9, difficulty: 1 }));
}

test('editor-built map validates, round-trips and starts a game with its conditions', () => {
  const { doc } = buildMap();
  const v = E.validateMap(doc.bp);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.warnings.length, 0, JSON.stringify(v.warnings));
  const back = E.deserializeMap(E.serializeMap(doc.bp));
  assert.ok(back.ok);
  resetGameDeps();
  setAiDriver(null);
  const state = startGame(back.bp);
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0].isHuman, true);
  assert.equal(state.players[1].isHuman, false);
  assert.equal(Object.keys(state.towns).length, 3);
  assert.equal(state.heroes[state.players[0].heroes[0]].defId, 'orrin');
  assert.equal(state.settings.victory.type, 'capture_town');
  assert.equal(state.towns[state.settings.victory.townId].owner, null);
  assert.equal(state.towns[state.settings.victory.townId].name, 'Crossing');
  assert.equal(state.settings.loss.townId, state.players[0].towns[0]);
  assert.equal(state.meta.name, 'Editor duel');
  checkState(state);
});

test('7 days of endTurn on the editor-built map (pickup amount honoured, income from owned mines)', () => {
  const { doc, woodId } = buildMap();
  resetGameDeps();
  setAiDriver(null);
  const state = startGame(doc.bp);
  const heroId = state.players[0].heroes[0];
  const wood0 = state.players[0].resources.wood;
  // walk next to the wood pile and pick it up: exactly the editor amount
  const path = findPath(state, heroId, state.map.objects[woodId].pos);
  assert.ok(path, 'wood pile reachable');
  const r = moveHero(state, heroId, state.map.objects[woodId].pos);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(state.map.objects[woodId], undefined);
  assert.equal(state.players[0].resources.wood, wood0 + 25);
  for (let day = 0; day < 7; day++) {
    const res = endTurn(state);
    assert.ok(res.ok, JSON.stringify(res));
    checkState(state);
  }
  assert.equal(state.turn, 8);
  assert.equal(state.gameOver, null);
  assert.ok(state.players[0].resources.wood >= wood0 + 25 + 2 * 6, 'sawmill income');
});

test('7 days with the real AI driver on the editor-built map', async () => {
  const { doc } = buildMap();
  resetGameDeps();
  const ai = await import('../../src/engine/ai/index.js');
  ai.installAi();
  try {
    const state = startGame(doc.bp);
    for (let day = 0; day < 7 && !state.gameOver; day++) {
      const res = endTurn(state);
      assert.ok(res.ok, JSON.stringify(res).slice(0, 500));
      if (state.combat) break; // the computer attacked us: a human battle would follow in the UI
      checkState(state);
    }
    assert.ok(state.turn >= 2);
  } finally {
    setAiDriver(null);
  }
});
