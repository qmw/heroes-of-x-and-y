import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTIONS, PLAYER_COLORS, RESOURCES } from '../../src/core/constants.js';
import { getHeroDef } from '../../src/data/heroes.js';
import { getArtifact } from '../../src/data/artifacts.js';
import { startingBuildings } from '../../src/data/buildings.js';
import { createTestMap } from '../../src/engine/testing.js';
import { pushPending, registerPendingHandler } from '../../src/engine/pending.js';
import { deps, useFallbackDeps, setGameDeps } from '../../src/engine/gameDeps.js';
import { startingResources, getDailyIncome } from '../../src/engine/economy.js';
import {
  createGame, endTurn, startNewDay, getCurrentPlayer, runAiTurn, setAiDriver, resolvePending, serialize,
  deserialize, getKingdomOverview, applyStartingBonus, GAME_VERSION, eliminatePlayer,
} from '../../src/engine/game.js';
import { build, recruit, captureTown } from '../../src/engine/town.js';
import { tinyBlueprint } from './fixture.js';

useFallbackDeps();

const twoPlayers = (extra = {}) => ({
  seed: 7,
  difficulty: 1,
  players: [
    { slot: 0, name: 'Ann', isHuman: true, faction: 'castle', color: 'red' },
    { slot: 1, name: 'Bot', isHuman: false, faction: 'random' },
  ],
  ...extra,
});

function game(settings = twoPlayers(), bp = tinyBlueprint(createTestMap)) {
  useFallbackDeps();
  setAiDriver(null);
  return createGame(bp, settings);
}

test('createGame: state skeleton per DESIGN §4', () => {
  const s = game();
  assert.equal(s.version, GAME_VERSION);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.date, { day: 1, week: 1, month: 1 });
  assert.equal(s.weekOf.kind, 'normal');
  assert.deepEqual([s.currentPlayer, s.combat, s.winner, s.gameOver], [0, null, null, null]);
  assert.deepEqual(s.pending, []);
  assert.equal(typeof s.rng.s, 'number');
  assert.equal(s.settings.difficulty, 1);
  assert.deepEqual(s.settings.victory, { type: 'defeat_all', allowStandard: true, appliesToAi: true });
  assert.deepEqual(s.settings.loss, { type: 'standard' });
  assert.equal(s.meta.name, 'Tiny');
  assert.equal(s.map.width, 24);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'plain JSON');
});

test('createGame: players (ids = indices, colors, factions, starting resources by difficulty)', () => {
  const s = game();
  assert.equal(s.players.length, 2);
  const [a, b] = s.players;
  assert.deepEqual([a.id, a.slot, a.name, a.isHuman, a.faction, a.color, a.alive], [0, 0, 'Ann', true, 'castle', 'red', true]);
  assert.deepEqual([b.id, b.slot, b.name, b.isHuman], [1, 1, 'Bot', false]);
  assert.ok(FACTIONS.includes(b.faction));
  assert.ok(PLAYER_COLORS.includes(b.color) && b.color !== 'red');
  assert.deepEqual(a.resources, startingResources(1, true));
  assert.deepEqual(b.resources, startingResources(1, false));
  assert.deepEqual([a.daysWithoutTown, b.daysWithoutTown], [0, 0]);
  const hard = game(twoPlayers({ difficulty: 4 }));
  assert.equal(hard.players[0].resources.gold, 0);
  assert.equal(hard.players[1].resources.gold, 10000);
  assert.throws(() => createGame(tinyBlueprint(createTestMap), twoPlayers({ difficulty: 9 })));
});

test('createGame: towns become entities + map objects; random factions; main / other sets; neutral garrison', () => {
  const s = game();
  const towns = Object.values(s.towns);
  assert.equal(towns.length, 3);
  const [t0, t1, tn] = towns;
  assert.deepEqual([t0.owner, t0.faction, t0.role], [0, 'castle', 'main']);
  assert.deepEqual(t0.buildings, startingBuildings('castle', 'main'));
  assert.deepEqual([t1.owner, t1.faction], [1, s.players[1].faction], "a player's random town takes his faction");
  assert.deepEqual([tn.owner, tn.faction, tn.role], [null, 'rampart', 'other']);
  assert.deepEqual(s.players[0].towns, [t0.id]);
  assert.deepEqual(s.players[1].towns, [t1.id]);
  for (const t of towns) {
    const obj = s.map.objects[t.objectId];
    assert.deepEqual([obj.defId, obj.data.townId, obj.owner ?? null], ['town', t.id, t.owner]);
    assert.deepEqual(obj.pos, t.pos);
    assert.equal(s.map.tiles[0][t.pos.y][t.pos.x].obj, obj.id);
    assert.ok(Object.values(t.stock)[0] > 0);
  }
  assert.deepEqual(tn.garrison.filter(Boolean).map((x) => x.creatureId), ['centaur', 'dwarf', 'wood_elf']);
  assert.deepEqual(tn.garrison[0], { creatureId: 'centaur', count: 28 });
  assert.ok(t0.garrison.every((x) => x === null));
  // the blueprint is not mutated
  const bp = tinyBlueprint(createTestMap);
  const copy = JSON.stringify(bp);
  createGame(bp, twoPlayers());
  assert.equal(JSON.stringify(bp), copy);
});

test('createGame: heroes (fixed, random of the faction, auto hero in the main town)', () => {
  const s = game();
  const h0 = s.heroes[s.players[0].heroes[0]];
  assert.deepEqual([h0.defId, h0.owner], ['orrin', 0]);
  assert.deepEqual(h0.pos, { x: 4, y: 6, z: 0 });
  const h1 = s.heroes[s.players[1].heroes[0]];
  assert.equal(getHeroDef(h1.defId).faction, s.players[1].faction, 'random hero of the own faction');
  assert.ok(h1.army.filter(Boolean).length >= 2, 'starting heroes come with their full army');
  // no blueprint heroes: one is created inside the main town
  const bp = tinyBlueprint(createTestMap);
  bp.heroes = [];
  const auto = game(twoPlayers(), bp);
  for (const p of auto.players) {
    assert.equal(p.heroes.length, 1);
    const h = auto.heroes[p.heroes[0]];
    const t = auto.towns[p.towns[0]];
    assert.deepEqual([t.visitingHero, h.townId], [h.id, t.id]);
    assert.equal(getHeroDef(h.defId).faction, p.faction);
  }
  const none = game(twoPlayers({ autoHeroes: false }), bp);
  assert.deepEqual(none.players.map((p) => p.heroes.length), [0, 0]);
  // a hero placed on the own town tile starts as visiting hero
  const bp2 = tinyBlueprint(createTestMap);
  bp2.heroes[0].pos = { x: 4, y: 4, z: 0 };
  const inside = game(twoPlayers(), bp2);
  assert.equal(inside.towns[inside.players[0].towns[0]].visitingHero, inside.players[0].heroes[0]);
});

test('createGame: fog revealed around towns and heroes only', () => {
  const s = game();
  const seen = (pid, x, y) => deps.isExplored(s, pid, { x, y, z: 0 });
  assert.equal(seen(0, 4, 4), true);
  assert.equal(seen(0, 4, 10), true, 'hero sight');
  assert.equal(seen(0, 19, 19), false);
  assert.equal(seen(1, 19, 19), true);
  assert.equal(seen(1, 4, 4), false);
  assert.equal(seen(0, 12, 8), false, 'neutral town unknown');
});

test('createGame: tavern pools, deterministic per seed', () => {
  const s = game();
  const pools = s.players.map((p) => p.tavernHeroes);
  assert.ok(pools.every((p) => p.length === 2 && p.every(Boolean)));
  const onMap = Object.values(s.heroes).map((h) => h.defId);
  assert.equal(new Set([...pools.flat(), ...onMap]).size, 6);
  pools.forEach((p, i) => assert.equal(getHeroDef(p[0]).faction, s.players[i].faction));
  assert.deepEqual(game(), game(), 'same seed, same game');
  assert.notDeepEqual(game(twoPlayers({ seed: 8 })).rng, s.rng);
});

test('createGame: default players from the blueprint, unowned slots become neutral', () => {
  useFallbackDeps();
  const s = createGame(tinyBlueprint(createTestMap));
  assert.deepEqual(s.players.map((p) => [p.slot, p.isHuman]), [[0, true], [1, false]]);
  const solo = createGame(tinyBlueprint(createTestMap), { players: [{ slot: 1, isHuman: true, faction: 'tower' }] });
  assert.equal(solo.players.length, 1);
  const towns = Object.values(solo.towns);
  assert.deepEqual(towns.map((t) => t.owner), [null, 0, null]);
  assert.equal(towns[1].faction, 'tower');
  assert.equal(Object.keys(solo.heroes).length, 1);
  assert.ok(towns[0].garrison[0], 'ownerless player town gets a neutral garrison');
});

test('starting bonus: gold / resource / artifact / random', () => {
  const s = game(twoPlayers({ players: [
    { slot: 0, isHuman: true, faction: 'castle', bonus: 'gold' },
    { slot: 1, isHuman: true, faction: 'tower', bonus: 'resource' },
  ] }));
  const gold = s.players[0].resources.gold - 20000;
  assert.ok(gold >= 500 && gold <= 1000 && gold % 100 === 0, `gold bonus ${gold}`);
  const gems = s.players[1].resources.gems - 10;
  assert.ok(gems >= 3 && gems <= 6, `tower gets gems: ${gems}`);
  assert.equal(s.players[1].resources.wood, 20);
  assert.equal(s.log.filter((e) => e.type === 'starting_bonus').length, 2);
  // wood + ore factions get both
  const before = { ...s.players[0].resources };
  const b = applyStartingBonus(s, 0, 'resource');
  assert.deepEqual(Object.keys(b.resources).sort(), ['ore', 'wood']);
  for (const r of ['wood', 'ore']) assert.ok(s.players[0].resources[r] - before[r] >= 5 && s.players[0].resources[r] - before[r] <= 10);
  // artifact: a treasure for the first hero
  const a = applyStartingBonus(s, 0, 'artifact');
  assert.equal(getArtifact(a.artifactId).class, 'treasure');
  const h = s.heroes[a.heroId];
  assert.ok(JSON.stringify(h.artifacts).includes(a.artifactId));
  assert.ok(['gold', 'resource', 'artifact'].includes(applyStartingBonus(s, 0, 'random').kind));
  assert.deepEqual(applyStartingBonus(s, 0, undefined), { kind: 'none' });
  // without a hero the artifact bonus falls back to gold
  eliminatePlayer(s, 1);
  s.players[1].alive = true;
  assert.equal(applyStartingBonus(s, 1, 'artifact').kind, 'gold');
});

test('victory / loss settings: blueprint indices are resolved to entity ids', () => {
  const s = game(twoPlayers({
    victory: { type: 'capture_town', townIndex: 2 },
    loss: { type: 'lose_hero', heroIndex: 0 },
  }));
  const townIds = Object.keys(s.towns);
  assert.equal(s.settings.victory.townId, townIds[2]);
  assert.deepEqual([s.settings.loss.heroId, s.settings.loss.playerId], [s.players[0].heroes[0], 0]);
  captureTown(s, townIds[2], 1);
  assert.deepEqual([s.winner, s.gameOver.reason], [1, 'capture_town']);
  const l = game(twoPlayers({ loss: { type: 'lose_town', townIndex: 0 } }));
  assert.equal(l.settings.loss.playerId, 0);
  captureTown(l, Object.keys(l.towns)[0], 1);
  assert.equal(l.players[0].alive, false);
  assert.equal(l.winner, 1);
});

test('endTurn: order, new day after the last player, events', () => {
  const s = game(twoPlayers({ players: [
    { slot: 0, isHuman: true, faction: 'castle' }, { slot: 1, isHuman: true, faction: 'tower' },
  ] }));
  assert.equal(getCurrentPlayer(s).id, 0);
  let r = endTurn(s);
  assert.equal(r.ok, true);
  assert.deepEqual(r.events.map((e) => e.type), ['turn_ended', 'turn_started']);
  assert.deepEqual([s.currentPlayer, s.turn], [1, 1]);
  r = endTurn(s);
  assert.deepEqual([s.currentPlayer, s.turn], [0, 2]);
  assert.deepEqual(s.date, { day: 2, week: 1, month: 1 });
  const types = r.events.map((e) => e.type);
  assert.equal(types[0], 'turn_ended');
  assert.equal(types[1], 'day_started');
  assert.equal(types.at(-1), 'turn_started');
  assert.equal(types.filter((t) => t === 'income').length, 2);
});

test('endTurn: income arrives with each new day, not on day 1', () => {
  const s = game(twoPlayers({ players: [{ slot: 0, isHuman: true, faction: 'castle' }, { slot: 1, isHuman: true, faction: 'tower' }] }));
  assert.equal(s.players[0].resources.gold, 20000, 'day 1: exactly the starting resources');
  assert.equal(getDailyIncome(s, 0).gold, 500);
  endTurn(s);
  assert.equal(s.players[0].resources.gold, 20000);
  endTurn(s);
  assert.deepEqual(s.players.map((p) => p.resources.gold), [20500, 20500]);
  for (let i = 0; i < 10; i++) endTurn(s);
  assert.deepEqual([s.turn, s.players[0].resources.gold], [7, 23000]);
});

test('endTurn: start of day resets builtThisTurn and hero movement', () => {
  const s = game(twoPlayers({ players: [{ slot: 0, isHuman: true, faction: 'castle' }] }));
  const t = s.towns[s.players[0].towns[0]];
  const h = s.heroes[s.players[0].heroes[0]];
  assert.equal(build(s, t.id, 'marketplace').ok, true);
  assert.equal(build(s, t.id, 'blacksmith').error, 'built_this_turn');
  h.movePoints = 0;
  endTurn(s);
  assert.equal(s.turn, 2, 'single player: every endTurn is a new day');
  assert.equal(t.builtThisTurn, false);
  assert.equal(h.movePoints, h.maxMovePoints);
  assert.equal(build(s, t.id, 'blacksmith').ok, true);
});

test('endTurn is refused while the current player has pending choices or a combat runs', () => {
  const s = game(twoPlayers({ players: [{ slot: 0, isHuman: true, faction: 'castle' }, { slot: 1, isHuman: true, faction: 'tower' }] }));
  const calls = [];
  registerPendingHandler('test_choice', (state, pending, option) => { calls.push(option); return { ok: true, events: [{ type: 'chosen', option }] }; });
  const p = pushPending(s, { kind: 'test_choice', playerId: 0, options: [{ label: 'a' }, { label: 'b' }] });
  assert.equal(endTurn(s).error, 'pending');
  assert.equal(s.currentPlayer, 0);
  assert.equal(resolvePending(s, p.id, 5).error, 'bad_option');
  const r = resolvePending(s, p.id, 1);
  assert.deepEqual([r.ok, calls], [true, [1]]);
  assert.deepEqual(r.events[0], { type: 'chosen', option: 1 });
  // another player's pending does not block
  pushPending(s, { kind: 'test_choice', playerId: 1, options: [{ label: 'a' }] });
  assert.equal(endTurn(s).ok, true);
  assert.equal(endTurn(s).error, 'pending');
  s.pending = [];
  s.combat = { cs: {} };
  assert.equal(endTurn(s).error, 'in_combat');
  s.combat = null;
  assert.equal(endTurn(s).ok, true);
});

test('endTurn skips eliminated players', () => {
  const s = game({ seed: 3, players: [0, 1, 2].map((slot) => ({ slot, isHuman: true, faction: 'castle' })) }, (() => {
    const bp = tinyBlueprint(createTestMap);
    bp.towns[2].ownerSlot = 2;
    return bp;
  })());
  assert.equal(s.players.length, 3);
  eliminatePlayer(s, 1);
  endTurn(s);
  assert.deepEqual([s.currentPlayer, s.turn], [2, 1]);
  endTurn(s);
  assert.deepEqual([s.currentPlayer, s.turn], [0, 2]);
  eliminatePlayer(s, 0);
  // the dead current player may still pass the turn; the survivor has already won
  const r = endTurn(s);
  assert.equal(r.ok, true);
  assert.equal(s.winner, 2);
});

test('AI hook: setAiDriver runs for AI players, leftover pendings are auto-resolved', () => {
  const s = game();
  const seen = [];
  registerPendingHandler('ai_choice', (state, pending, option) => { seen.push(['resolved', pending.playerId, option]); return { ok: true }; });
  setAiDriver((state, playerId) => {
    seen.push(['driver', playerId, state.turn]);
    const t = state.towns[state.players[playerId].towns[0]];
    assert.equal(build(state, t.id, 'marketplace').ok || state.turn > 1, true);
    pushPending(state, { kind: 'ai_choice', playerId, options: [{ label: 'x' }, { label: 'y' }] });
  });
  const r = endTurn(s);
  assert.equal(r.ok, true);
  assert.deepEqual(seen, [['driver', 1, 1], ['resolved', 1, 0]]);
  assert.deepEqual([s.currentPlayer, s.turn], [0, 2], 'back to the human on the next day');
  assert.ok(r.events.some((e) => e.type === 'ai_turn' && e.playerId === 1));
  assert.ok(s.towns[s.players[1].towns[0]].buildings.includes('marketplace'));
  assert.deepEqual(s.pending, []);
  // the default driver simply passes
  setAiDriver(null);
  endTurn(s);
  assert.deepEqual([s.currentPlayer, s.turn], [0, 3]);
  // manual mode stops on the AI player
  s.settings.manualAi = true;
  endTurn(s);
  assert.equal(s.currentPlayer, 1);
  assert.deepEqual(runAiTurn(s).events, [{ type: 'ai_turn', playerId: 1 }]);
  endTurn(s);
  assert.deepEqual([s.currentPlayer, s.turn], [0, 4]);
  assert.deepEqual(runAiTurn(s).events, [], 'no-op for a human');
});

test('all-AI game: each endTurn call advances one full round', () => {
  const s = game({ seed: 2, players: [{ slot: 0, isHuman: false, faction: 'castle' }, { slot: 1, isHuman: false, faction: 'inferno' }] });
  const turns = [];
  setAiDriver((state, pid) => turns.push([state.turn, pid]));
  endTurn(s);
  endTurn(s);
  assert.ok(s.turn >= 2);
  assert.ok(turns.length >= 3);
  setAiDriver(null);
});

test('turn sequence: every AI player plays exactly once per day (all-AI, AI first, mixed)', () => {
  const log = [];
  // all-AI: player 0 (the first) also plays, nobody is skipped across calls
  const s = game({ seed: 2, players: [{ slot: 0, isHuman: false, faction: 'castle' }, { slot: 1, isHuman: false, faction: 'inferno' }] });
  setAiDriver((state, pid) => log.push(`${state.turn}:${pid}`));
  for (let i = 0; i < 4; i++) assert.equal(endTurn(s).ok, true);
  assert.deepEqual(log.slice(0, 8), ['1:0', '1:1', '2:0', '2:1', '3:0', '3:1', '4:0', '4:1']);
  // AI first, human second: the AI plays its day-1 turn before the human moves
  log.length = 0;
  const m = game({ seed: 4, players: [{ slot: 0, isHuman: false, faction: 'castle' }, { slot: 1, isHuman: true, faction: 'tower' }] });
  setAiDriver((state, pid) => log.push(`${state.turn}:${pid}`));
  assert.equal(m.currentPlayer, 0);
  endTurn(m);
  assert.deepEqual([m.currentPlayer, m.turn, log], [1, 1, ['1:0']]);
  endTurn(m);
  assert.deepEqual([m.currentPlayer, m.turn, log], [1, 2, ['1:0', '2:0']]);
  // an explicit runAiTurn is not repeated by endTurn
  m.currentPlayer = 0;
  runAiTurn(m);
  endTurn(m);
  assert.deepEqual(log, ['1:0', '2:0', '2:0']);
  setAiDriver(null);
});

test('runAiTurn resolves leftover pendings with safe defaults', () => {
  const s = game();
  const seen = [];
  registerPendingHandler('safe_test', (state, pending, option) => { seen.push([pending.data.n, option]); return { ok: true }; });
  setAiDriver((state, playerId) => {
    pushPending(state, { kind: 'safe_test', playerId, options: [{ id: 'yes' }, { id: 'no' }], data: { n: 'confirm' } });
    pushPending(state, { kind: 'safe_test', playerId, options: [{ id: 'fight' }, { id: 'buy' }, { id: 'leave' }], data: { n: 'dialog' } });
    pushPending(state, { kind: 'safe_test', playerId, options: [{ id: 'skill_a' }, { id: 'skill_b' }], data: { n: 'level_up' } });
  });
  endTurn(s);
  assert.deepEqual(seen, [['confirm', 1], ['dialog', 2], ['level_up', 0]]);
  setAiDriver(null);
});

test('daily tick calls the hero and adventure engines in order', () => {
  const s = game();
  const order = [];
  setGameDeps({
    startOfDayHero: (state, heroId) => { order.push(`hero:${heroId}`); return { ok: true, events: [] }; },
    startOfDayAdventure: () => { order.push('adventure:day'); return { ok: true, events: [{ type: 'adv_day' }] }; },
    startOfWeekAdventure: () => { order.push('adventure:week'); return { ok: true, events: [] }; },
  });
  let r = startNewDay(s);
  assert.deepEqual(order, [...Object.keys(s.heroes).map((id) => `hero:${id}`), 'adventure:day']);
  assert.ok(r.events.some((e) => e.type === 'adv_day'));
  order.length = 0;
  for (let d = 0; d < 6; d++) r = startNewDay(s);
  assert.equal(order.filter((x) => x === 'adventure:week').length, 1);
  assert.equal(order.at(-1), 'adventure:week');
  assert.equal(order.filter((x) => x === 'adventure:day').length, 6);
  useFallbackDeps();
});

test('serialize / deserialize: exact round trip, version check, game continues identically', () => {
  const s = game();
  const t = s.towns[s.players[0].towns[0]];
  build(s, t.id, 'marketplace');
  recruit(s, t.id, 'pikeman', 5, 'garrison');
  for (let i = 0; i < 9; i++) endTurn(s);
  const json = serialize(s);
  assert.equal(typeof json, 'string');
  const copy = deserialize(json);
  assert.deepEqual(copy, s);
  assert.notEqual(copy, s);
  assert.equal(serialize(copy), json);
  // both continue identically (rng is part of the state)
  for (let i = 0; i < 20; i++) {
    endTurn(s);
    endTurn(copy);
  }
  assert.deepEqual(copy, s);
  assert.deepEqual(deserialize(JSON.parse(json)), deserialize(json), 'accepts a parsed object');
  assert.throws(() => deserialize(json.replace('"version":1', '"version":2')), /Unsupported save version: 2/);
  assert.throws(() => deserialize('{nope'), /Corrupt save/);
  assert.throws(() => deserialize('42'), /Corrupt save/);
  assert.throws(() => deserialize('{"version":1}'), /Corrupt save/);
});

test('getKingdomOverview summarises a kingdom as plain JSON', () => {
  const s = game();
  const t = s.towns[s.players[0].towns[0]];
  recruit(s, t.id, 'pikeman', 10, 'garrison');
  const o = getKingdomOverview(s, 0);
  assert.deepEqual([o.playerId, o.name, o.faction, o.alive, o.turn], [0, 'Ann', 'castle', true, 1]);
  assert.deepEqual(o.date, { day: 1, week: 1, month: 1 });
  for (const r of RESOURCES) assert.equal(o.resources[r], s.players[0].resources[r]);
  assert.equal(o.income.gold, 500);
  assert.equal(o.incomeBySource.towns.gold, 500);
  assert.equal(o.towns.length, 1);
  const row = o.towns[0];
  assert.deepEqual([row.id, row.name, row.faction, row.hallLevel, row.fortLevel, row.mageGuildLevel], [t.id, t.name, 'castle', 1, 1, 0]);
  assert.deepEqual(row.growth, { pikeman: 14 });
  assert.deepEqual(row.stock, { pikeman: 4 });
  assert.equal(row.garrisonStrength, 800);
  assert.ok(row.canBuild.includes('marketplace') && !row.canBuild.includes('capitol'));
  assert.equal(o.heroes.length, 1);
  assert.deepEqual([o.heroes[0].name, o.heroes[0].level, o.heroes[0].townId], ['Orrin', 1, null]);
  assert.equal(o.armyStrength, 800 + o.heroes[0].armyStrength);
  assert.deepEqual([o.marketplaces, o.thievesGuildLevel, o.daysLeftWithoutTown], [0, 1, null]);
  assert.equal(o.score.score, 199);
  assert.deepEqual(JSON.parse(JSON.stringify(o)), o);
  assert.throws(() => getKingdomOverview(s, 5));
});
