// Handcrafted scenarios: metadata, validity, game start with their victory / loss conditions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, listScenarios, validateBlueprint } from '../../src/engine/mapgen/index.js';
import { getMapObject } from '../../src/data/mapObjects.js';
import { createGame, setAiDriver } from '../../src/engine/game.js';
import { resetGameDeps } from '../../src/engine/gameDeps.js';

function start(bp, n) {
  resetGameDeps();
  setAiDriver(null);
  return createGame(bp, {
    seed: 4, difficulty: 1, victory: bp.victory, loss: bp.loss,
    players: Array.from({ length: n }, (_, i) => ({ slot: i, isHuman: i === 0, faction: 'random' })),
  });
}

test('at least six scenarios with UI metadata of different sizes', () => {
  const list = listScenarios();
  assert.ok(list.length >= 6);
  for (const s of list) {
    for (const k of ['id', 'name', 'description', 'size', 'difficulty', 'victory', 'loss']) assert.ok(s[k], `${s.id}: ${k}`);
    assert.ok(s.players >= 2 && s.players <= 8);
    assert.equal(s.playerSlots, s.players);
  }
  assert.equal(new Set(list.map((s) => s.id)).size, list.length);
  const sizes = new Set(list.map((s) => s.size));
  assert.ok(sizes.has('S') && sizes.has('M') && sizes.has('L'));
  assert.ok(list.some((s) => s.levels === 2), 'one scenario has an underground level');
  assert.ok(list.some((s) => s.players === 7), 'a seven-player scenario');
  const victoryTypes = new Set(list.map((s) => (typeof s.victoryCondition === 'string' ? s.victoryCondition : s.victoryCondition.type)));
  assert.ok(victoryTypes.size >= 5, [...victoryTypes].join(','));
});

test('every scenario builds, validates, starts a game and is JSON-serializable', () => {
  for (const meta of listScenarios()) {
    const bp = generateMap({ type: 'scenario', scenarioId: meta.id });
    assert.notEqual(bp.ok, false, `${meta.id}: ${bp.error}`);
    const v = validateBlueprint(bp);
    assert.ok(v.ok, `${meta.id}: ${v.errors.slice(0, 3).join('; ')}`);
    assert.equal(bp.meta.playerSlots, meta.players);
    assert.equal(bp.map.width, meta.width);
    assert.equal(bp.map.levels, meta.levels);
    const state = start(bp, meta.players);
    assert.equal(state.players.length, meta.players);
    for (const p of state.players) assert.ok(p.towns.length >= 1 && p.heroes.length >= 1, `${meta.id}: player ${p.id}`);
    // fixed factions of the scenario are kept when the player chose "random"
    meta.factions.forEach((f, i) => assert.equal(state.players[i].faction, f, `${meta.id}: slot ${i}`));
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  }
});

test('scenarios are fixed maps: the same blueprint every time, also via the "scenario" option name', () => {
  const a = generateMap({ type: 'scenario', scenarioId: 'first_blood' });
  const b = generateMap({ type: 'scenario', scenario: 'first_blood', seed: 999 });
  assert.deepEqual(a, b);
  a.map.width = 1; // callers get their own copy
  assert.equal(generateMap({ type: 'scenario', scenarioId: 'first_blood' }).map.width, 36);
});

test('victory and loss conditions resolve to real entities', () => {
  const undead = generateMap({ type: 'scenario', scenarioId: 'undead_rising' });
  let s = start(undead, 3);
  assert.equal(s.settings.victory.type, 'defeat_hero');
  assert.equal(s.heroes[s.settings.victory.heroId].defId, 'vidomina');
  assert.equal(s.heroes[s.settings.victory.heroId].owner, 2);
  assert.equal(s.settings.loss.type, 'lose_town');
  assert.equal(s.towns[s.settings.loss.townId].name, 'Lionsgate');
  assert.equal(s.settings.loss.playerId, 0);

  const factory = generateMap({ type: 'scenario', scenarioId: 'factory_lines' });
  s = start(factory, 2);
  assert.equal(s.settings.victory.type, 'capture_town');
  assert.equal(s.towns[s.settings.victory.townId].name, 'Gearhaven');
  assert.equal(s.towns[s.settings.victory.townId].owner, null);
  assert.deepEqual(s.settings.loss, { type: 'time_limit', days: 112 });

  const hoard = generateMap({ type: 'scenario', scenarioId: 'dragons_hoard' });
  const blade = Object.values(hoard.map.objects).find((o) => o.data && o.data.artifactId === 'armageddons_blade');
  assert.ok(blade, 'the blade lies on the map');
  assert.equal(hoard.victory.artifactId, 'armageddons_blade');
  const guard = Object.values(hoard.map.objects).find((o) => o.defId === 'monster' && o.pos.x === blade.pos.x && o.pos.y === blade.pos.y + 1);
  assert.equal(guard.data.creatureId, 'black_dragon');

  const grail = generateMap({ type: 'scenario', scenarioId: 'grail_hunt' });
  assert.equal(grail.victory.type, 'build_grail');
  const objs = Object.values(grail.map.objects).map((o) => o.defId);
  assert.equal(objs.filter((d) => d === 'obelisk').length, 8);
  assert.equal(objs.filter((d) => d === 'grail').length, 1);
  s = start(grail, 4);
  assert.equal(Object.values(s.map.objects).filter((o) => o.defId === 'grail').length, 1, 'createGame keeps the scenario grail');
});

test('naval scenario: boats and shipyards on every home island, gates paired in the two-level one', () => {
  const bp = generateMap({ type: 'scenario', scenarioId: 'sapphire_archipelago' });
  const boats = Object.values(bp.map.objects).filter((o) => o.defId === 'boat');
  const yards = Object.values(bp.map.objects).filter((o) => getMapObject(o.defId).effect.type === 'shipyard');
  assert.ok(boats.length >= 4 && yards.length >= 4);
  const undead = generateMap({ type: 'scenario', scenarioId: 'undead_rising' });
  const gates = Object.values(undead.map.objects).filter((o) => o.defId === 'subterranean_gate');
  assert.equal(gates.length, 6);
  for (const g of gates) assert.equal(undead.map.objects[g.data.pair].data.pair, g.id);
});
