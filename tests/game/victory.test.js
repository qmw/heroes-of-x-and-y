import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giveArtifact, removeArtifact } from '../../src/engine/artifacts.js';
import { deps } from '../../src/engine/gameDeps.js';
import {
  checkVictory, eliminatePlayer, recordDefeat, calculateScore, getScoreBreakdown, getRankTitle,
  normalizeVictory, normalizeLoss, meetsVictory, RANK_TITLES, DAYS_WITHOUT_TOWN_LIMIT, VICTORY_TYPES, LOSS_TYPES,
} from '../../src/engine/victory.js';
import { startNewDay, endTurn } from '../../src/engine/game.js';
import { captureTown, build } from '../../src/engine/town.js';
import { setup, town, hero } from './fixture.js';

/** Two (or more) players, each with a town and a hero. */
function world(opts = {}) {
  const s = setup(opts);
  const towns = [];
  const heroes = [];
  const defs = ['orrin', 'edric', 'sorsha', 'tyris'];
  s.players.forEach((p, i) => {
    towns.push(town(s, { owner: p.id, pos: { x: 3 + i * 5, y: 3 + i * 5, z: 0 } }));
    heroes.push(hero(s, defs[i], p.id));
  });
  return { s, towns, heroes };
}

test('normalizeVictory / normalizeLoss', () => {
  assert.deepEqual(normalizeVictory('standard'), { type: 'defeat_all', allowStandard: true, appliesToAi: true });
  assert.deepEqual(normalizeVictory(undefined).type, 'defeat_all');
  assert.deepEqual(normalizeVictory({ type: 'capture_town', townId: 't1', allowStandard: false }),
    { type: 'capture_town', townId: 't1', allowStandard: false, appliesToAi: true });
  assert.throws(() => normalizeVictory({ type: 'win_lottery' }));
  assert.deepEqual(normalizeLoss('standard'), { type: 'standard' });
  assert.deepEqual(normalizeLoss({ type: 'time_limit', days: 30 }), { type: 'time_limit', days: 30 });
  assert.throws(() => normalizeLoss({ type: 'bad' }));
  assert.equal(VICTORY_TYPES.length, 10);
  assert.equal(LOSS_TYPES.length, 4);
});

test('nothing happens while everybody is alive', () => {
  const { s } = world();
  const r = checkVictory(s);
  assert.deepEqual([r.ok, r.over, r.winner, r.events.length], [true, false, null, 0]);
  assert.equal(s.winner, null);
});

test('elimination: no heroes and no towns -> out; last player standing wins', () => {
  const { s, towns, heroes } = world({ players: 3 });
  // player 2 loses the hero but keeps the town: alive
  deps.removeHero(s, heroes[2].id, 'defeated');
  assert.equal(checkVictory(s).over, false);
  assert.equal(s.players[2].alive, true);
  // loses the town too
  const r = captureTown(s, towns[2].id, 0);
  assert.ok(r.events.some((e) => e.type === 'player_eliminated' && e.playerId === 2 && e.reason === 'defeated'));
  assert.equal(s.players[2].alive, false);
  assert.equal(s.winner, null, 'two players left');
  // player 1: town captured, hero killed
  captureTown(s, towns[1].id, 0);
  assert.equal(s.players[1].alive, true, 'still has a hero');
  deps.removeHero(s, heroes[1].id, 'defeated');
  const end = checkVictory(s);
  assert.deepEqual([end.over, end.winner], [true, 0]);
  assert.deepEqual(s.gameOver.reason, 'defeat_all');
  assert.equal(s.winner, 0);
  assert.deepEqual(end.events.map((e) => e.type), ['player_eliminated', 'game_over']);
  assert.ok(s.log.some((e) => e.type === 'game_over' && e.winner === 0));
  // idempotent afterwards
  assert.deepEqual(checkVictory(s).events, []);
  assert.equal(endTurn(s).error, 'game_over');
});

test('eliminatePlayer: heroes vanish, towns and mines become neutral, pendings dropped', () => {
  const { s, towns, heroes } = world();
  const mine = deps.addObject(s, 'gold_mine', { x: 15, y: 15, z: 0 }, { owner: 1 });
  towns[1].visitingHero = heroes[1].id;
  heroes[1].townId = towns[1].id;
  s.pending.push({ id: 5, playerId: 1, kind: 'x', options: [] }, { id: 6, playerId: 0, kind: 'x', options: [] });
  const r = eliminatePlayer(s, 1, 'resigned');
  assert.deepEqual(r.events, [{ type: 'player_eliminated', playerId: 1, reason: 'resigned' }]);
  const p = s.players[1];
  assert.deepEqual([p.alive, p.heroes, p.towns, p.eliminatedOn, p.eliminationReason], [false, [], [], 1, 'resigned']);
  assert.equal(s.heroes[heroes[1].id], undefined);
  assert.deepEqual([towns[1].owner, towns[1].visitingHero], [null, null]);
  assert.equal(mine.owner, null);
  assert.deepEqual(s.pending.map((x) => x.id), [6]);
  assert.equal(eliminatePlayer(s, 1).error, 'already_eliminated');
  assert.equal(eliminatePlayer(s, 9).error, 'no_such_player');
});

test('7 days without a town: warning countdown, then elimination; a captured town resets it', () => {
  const { s, towns, heroes } = world({ players: 3 });
  assert.equal(DAYS_WITHOUT_TOWN_LIMIT, 7);
  captureTown(s, towns[1].id, 0);
  assert.equal(s.players[1].alive, true);
  const warnings = [];
  for (let d = 1; d <= 6; d++) {
    const ev = startNewDay(s).events;
    const w = ev.find((e) => e.type === 'town_loss_warning');
    assert.equal(w.playerId, 1);
    warnings.push(w.daysLeft);
    assert.equal(s.players[1].daysWithoutTown, d);
  }
  assert.deepEqual(warnings, [6, 5, 4, 3, 2, 1]);
  // he retakes a town on the last day: counter reset, no elimination
  captureTown(s, towns[1].id, 1);
  assert.equal(s.players[1].daysWithoutTown, 0);
  for (let d = 0; d < 10; d++) startNewDay(s);
  assert.equal(s.players[1].alive, true);
  // loses it for good
  captureTown(s, towns[1].id, 2);
  let out = null;
  for (let d = 1; d <= 7 && !out; d++) out = startNewDay(s).events.find((e) => e.type === 'player_eliminated') || null;
  assert.deepEqual(out, { type: 'player_eliminated', playerId: 1, reason: 'no_town' });
  assert.equal(s.players[1].daysWithoutTown, 7);
  assert.equal(s.heroes[heroes[1].id], undefined, 'his heroes are gone');
  assert.equal(s.winner, null);
});

test('victory: capture a specific town', () => {
  const { s, towns } = world({ players: 3 });
  const target = town(s, { owner: null, faction: 'tower', pos: { x: 18, y: 4, z: 0 } });
  s.settings.victory = { type: 'capture_town', townId: target.id };
  assert.equal(checkVictory(s).over, false);
  captureTown(s, towns[2].id, 1);
  assert.equal(s.winner, null, 'another town does not count');
  const r = captureTown(s, target.id, 1);
  assert.deepEqual(r.events.at(-1), { type: 'game_over', winner: 1, reason: 'capture_town' });
  assert.deepEqual([s.winner, s.gameOver.reason, s.gameOver.turn], [1, 'capture_town', 1]);
});

test('victory: defeat a specific hero (credit via recordDefeat or the player to move)', () => {
  let { s, heroes } = world({ players: 3 });
  s.settings.victory = { type: 'defeat_hero', heroId: heroes[2].id };
  assert.equal(checkVictory(s).over, false);
  s.towns[s.players[2].towns[0]].owner = 2;
  recordDefeat(s, { kind: 'hero', id: heroes[2].id, byPlayerId: 1 });
  deps.removeHero(s, heroes[2].id, 'defeated');
  assert.deepEqual([checkVictory(s).winner, s.gameOver.reason], [1, 'defeat_hero']);
  // without a record the current player gets it; by hero definition id
  ({ s, heroes } = world({ players: 3 }));
  s.settings.victory = { type: 'defeat_hero', heroDefId: 'sorsha' };
  s.currentPlayer = 0;
  deps.removeHero(s, heroes[2].id, 'defeated');
  assert.equal(checkVictory(s).winner, 0);
});

test('victory: a defeat_hero target killed by neutrals credits nobody; loseIfFailed ends it for the humans', () => {
  let { s, heroes } = world({ players: 3 });
  s.settings.victory = { type: 'defeat_hero', heroId: heroes[2].id, allowStandard: true };
  s.currentPlayer = 0;
  recordDefeat(s, { kind: 'hero', id: heroes[2].id, byPlayerId: null });
  deps.removeHero(s, heroes[2].id, 'defeated');
  let r = checkVictory(s);
  assert.equal(r.over, false, 'the player to move does not get a neutral kill');
  assert.ok(r.events.some((e) => e.type === 'objective_failed'));
  assert.deepEqual(s.objectiveFailed, { type: 'defeat_hero', turn: s.turn });
  assert.ok(s.players.every((p) => p.alive), 'without loseIfFailed the game goes on (conquest still wins)');
  assert.equal(checkVictory(s).events.length, 0, 'reported once');
  // the scenario says the objective is a must: the humans lose
  ({ s, heroes } = world({ players: 3 }));
  s.players.forEach((p) => { p.isHuman = p.id === 0; });
  s.settings.victory = { type: 'defeat_hero', heroDefId: 'sorsha', loseIfFailed: true, appliesToAi: false };
  recordDefeat(s, { kind: 'hero', id: 'sorsha', byPlayerId: null });
  deps.removeHero(s, heroes[2].id, 'defeated');
  r = checkVictory(s);
  assert.equal(s.players[0].alive, false);
  assert.equal(s.players[0].eliminationReason, 'objective_failed');
  assert.ok(s.players[1].alive && s.players[2].alive);
});

test('victory: defeat a specific monster', () => {
  const { s } = world();
  const monster = deps.addObject(s, 'monster', { x: 15, y: 15, z: 0 }, { data: { creatureId: 'azure_dragon', count: 5 } });
  s.settings.victory = { type: 'defeat_monster', objectId: monster.id };
  assert.equal(checkVictory(s).over, false);
  s.currentPlayer = 1;
  deps.removeObject(s, monster.id);
  assert.deepEqual([checkVictory(s).winner, s.gameOver.reason], [1, 'defeat_monster']);
});

test('victory: acquire an artifact', () => {
  const { s, heroes } = world();
  s.settings.victory = { type: 'acquire_artifact', artifactId: 'endless_sack_of_gold' };
  assert.equal(checkVictory(s).over, false);
  giveArtifact(heroes[1], 'endless_sack_of_gold', { toBackpack: true });
  assert.deepEqual([checkVictory(s).winner, s.gameOver.reason], [1, 'acquire_artifact']);
});

test('victory: accumulate creatures (armies + garrisons)', () => {
  const { s, towns, heroes } = world();
  s.settings.victory = { type: 'accumulate_creatures', creatureId: 'arch_angel', count: 10 };
  heroes[0].army[3] = { creatureId: 'arch_angel', count: 6 };
  towns[0].garrison[0] = { creatureId: 'arch_angel', count: 3 };
  heroes[1].army[3] = { creatureId: 'angel', count: 50 };
  assert.equal(checkVictory(s).over, false);
  towns[0].garrison[0].count = 4;
  assert.deepEqual([checkVictory(s).winner, s.gameOver.reason], [0, 'accumulate_creatures']);
});

test('victory: accumulate resources; appliesToAi = false keeps the AI from winning by it', () => {
  const { s } = world({ humans: [true, false] });
  for (const p of s.players) p.resources.gems = 10;
  s.settings.victory = { type: 'accumulate_resources', resource: 'gems', amount: 100, appliesToAi: false };
  s.players[1].resources.gems = 500;
  assert.equal(checkVictory(s).over, false);
  assert.equal(meetsVictory(s, s.players[1], normalizeVictory(s.settings.victory)), true);
  s.players[0].resources.gems = 100;
  assert.equal(checkVictory(s).winner, 0);
  const again = world({ humans: [true, false] }).s;
  again.settings.victory = { type: 'accumulate_resources', resource: 'gems', amount: 100 };
  for (const p of again.players) p.resources.gems = 10;
  again.players[1].resources.gems = 100;
  assert.equal(checkVictory(again).winner, 1);
});

test('victory: build the grail structure (checked right after construction)', () => {
  const { s, towns, heroes } = world();
  s.settings.victory = { type: 'build_grail' };
  heroes[1].townId = towns[1].id;
  towns[1].visitingHero = heroes[1].id;
  giveArtifact(heroes[1], 'grail');
  assert.equal(checkVictory(s).over, false);
  s.currentPlayer = 1;
  const r = build(s, towns[1].id, 'castle_grail');
  assert.equal(r.ok, true);
  assert.deepEqual(r.events.at(-1), { type: 'game_over', winner: 1, reason: 'build_grail' });
  // restricted to one town
  const w = world();
  w.s.settings.victory = { type: 'build_grail', townId: w.towns[0].id };
  w.towns[1].buildings.push('castle_grail');
  assert.equal(checkVictory(w.s).over, false);
  w.towns[0].buildings.push('castle_grail');
  assert.equal(checkVictory(w.s).winner, 0);
});

test('victory: survive N days (time limit as a victory)', () => {
  const { s } = world({ humans: [true, false] });
  s.settings.victory = { type: 'survive', days: 10 };
  for (let d = 0; d < 9; d++) startNewDay(s);
  assert.deepEqual([s.turn, s.winner], [10, null]);
  const ev = startNewDay(s).events;
  assert.deepEqual(ev.at(-1), { type: 'game_over', winner: 0, reason: 'survive' });
  assert.equal(s.winner, 0, 'the human survivor wins');
});

test('special victory keeps "defeat everybody" as an alternative unless allowStandard is false', () => {
  let { s, towns, heroes } = world();
  s.settings.victory = { type: 'accumulate_resources', resource: 'gold', amount: 1e9 };
  deps.removeHero(s, heroes[1].id, 'defeated');
  captureTown(s, towns[1].id, 0);
  assert.deepEqual([s.winner, s.gameOver.reason], [0, 'defeat_all']);
  ({ s, towns, heroes } = world());
  s.settings.victory = { type: 'accumulate_resources', resource: 'gold', amount: 1e9, allowStandard: false };
  deps.removeHero(s, heroes[1].id, 'defeated');
  captureTown(s, towns[1].id, 0);
  assert.equal(s.players[1].alive, false);
  assert.equal(s.winner, null);
  assert.equal(s.gameOver, undefined);
});

test('loss: losing a specific hero eliminates his owner', () => {
  const { s, heroes } = world({ players: 3 });
  s.settings.loss = { type: 'lose_hero', heroId: heroes[0].id };
  assert.equal(checkVictory(s).over, false);
  assert.equal(s.settings.loss.playerId, 0, 'owner resolved on the first check');
  deps.removeHero(s, heroes[0].id, 'defeated');
  const r = checkVictory(s);
  assert.deepEqual(r.events, [{ type: 'player_eliminated', playerId: 0, reason: 'lost_hero' }]);
  assert.equal(s.players[0].alive, false);
  assert.equal(s.towns[Object.keys(s.towns)[0]].owner, null);
  assert.equal(s.winner, null, 'two players remain');
});

test('loss: losing a specific town eliminates its original owner (and can end the game)', () => {
  const { s, towns } = world();
  s.settings.loss = { type: 'lose_town', townId: towns[0].id, playerId: 0 };
  assert.equal(checkVictory(s).over, false);
  const r = captureTown(s, towns[0].id, 1);
  assert.deepEqual(r.events.slice(-2), [
    { type: 'player_eliminated', playerId: 0, reason: 'lost_town' },
    { type: 'game_over', winner: 1, reason: 'defeat_all' },
  ]);
});

test('loss: time expires -> everybody loses, no winner', () => {
  const { s } = world();
  s.settings.loss = { type: 'time_limit', days: 14 };
  for (let d = 0; d < 13; d++) startNewDay(s);
  assert.deepEqual([s.turn, s.gameOver], [14, undefined]);
  const ev = startNewDay(s).events;
  assert.deepEqual(ev.slice(-3).map((e) => [e.type, e.reason]), [
    ['player_eliminated', 'time_expired'], ['player_eliminated', 'time_expired'], ['game_over', 'time_expired'],
  ]);
  assert.deepEqual([s.winner, s.gameOver.winner, s.gameOver.reason], [null, null, 'time_expired']);
  assert.ok(s.players.every((p) => !p.alive));
  // a victory reached in time beats the clock
  const w = world();
  w.s.settings.loss = { type: 'time_limit', days: 5 };
  w.s.settings.victory = { type: 'accumulate_resources', resource: 'wood', amount: 5 };
  for (let d = 0; d < 6; d++) startNewDay(w.s);
  assert.equal(w.s.gameOver.reason, 'accumulate_resources');
});

test('score: original rating formula and rank titles', () => {
  const { s, towns, heroes } = world();
  // day 1, the player owns 1 town: 200 - floor(11 / 6) = 199 (towns = the player's towns, not the map's)
  assert.deepEqual(getScoreBreakdown(s, 0), {
    days: 1, towns: 1, base: 199, allDefeated: false, grail: false, percent: 100, score: 199, title: 'Wolf Rider',
  });
  s.turn = 130; // 200 - floor(140 / 6) = 177
  assert.equal(calculateScore(s, 0), 177);
  s.settings.difficulty = 4;
  assert.equal(calculateScore(s, 0), 354);
  s.settings.difficulty = 0;
  assert.equal(calculateScore(s, 0), 141);
  s.settings.difficulty = 2;
  // carrying the Grail counts like having built it
  giveArtifact(heroes[0], 'grail');
  assert.equal(getScoreBreakdown(s, 0).grail, true);
  assert.equal(removeArtifact(heroes[0], 'grail').ok, true);
  assert.equal(getScoreBreakdown(s, 0).grail, false);
  towns[0].buildings.push('castle_grail');
  assert.equal(calculateScore(s, 0), Math.floor(202 * 1.3));
  deps.removeHero(s, heroes[1].id, 'defeated');
  captureTown(s, towns[1].id, 0);
  assert.equal(s.gameOver.score, Math.floor(230 * 1.3));
  assert.equal(getScoreBreakdown(s, 0).allDefeated, true);
  s.turn = 100000;
  assert.equal(calculateScore(s, 0), 0, 'never negative');
  // titles
  assert.equal(getRankTitle(0), 'Peasant');
  assert.equal(getRankTitle(24), 'Peasant');
  assert.equal(getRankTitle(25), 'Imp');
  assert.equal(getRankTitle(299), 'Minotaur');
  assert.equal(getRankTitle(500), 'Archangel');
  assert.equal(getRankTitle(9999), 'Archangel');
  assert.equal(RANK_TITLES.length, 21);
  for (let i = 1; i < RANK_TITLES.length; i++) assert.equal(RANK_TITLES[i][0] - RANK_TITLES[i - 1][0], 25);
});

test('teams: an alliance left standing wins together; allies are not enemies for the score', async () => {
  const { s } = world({ players: 3 });
  s.players[0].team = 1;
  s.players[2].team = 1;
  assert.equal(checkVictory(s).over, false);
  eliminatePlayer(s, 1);
  const r = checkVictory(s);
  assert.equal(r.over, true);
  assert.equal(s.gameOver.reason, 'defeat_all');
  assert.deepEqual(s.gameOver.winners, [0, 2]);
  assert.ok(r.events.some((e) => e.type === 'game_over' && e.winners && e.winners.length === 2));
  assert.equal(getScoreBreakdown(s, 0).allDefeated, true);
});

test('teams: createGame takes player.team from settings or the blueprint meta', async () => {
  const { createGame, setAiDriver } = await import('../../src/engine/game.js');
  const { createTestMap } = await import('../../src/engine/testing.js');
  const { tinyBlueprint } = await import('./fixture.js');
  setAiDriver(null);
  const bp = tinyBlueprint(createTestMap);
  bp.meta = { ...bp.meta, players: [{ slot: 0, team: 0 }, { slot: 1, team: 0 }] };
  const s = createGame(bp, { seed: 1, players: [{ slot: 0, isHuman: true, faction: 'castle' }, { slot: 1, isHuman: false, faction: 'tower' }] });
  assert.deepEqual(s.players.map((p) => p.team), [0, 0]);
  const t = createGame(tinyBlueprint(createTestMap), { seed: 1, players: [{ slot: 0, isHuman: true, faction: 'castle', team: 3 }, { slot: 1, isHuman: false, faction: 'tower' }] });
  assert.deepEqual(t.players.map((p) => p.team), [3, undefined]);
});

test('victory: capture_all_towns (every town owned by the player or his allies)', () => {
  const { s, towns } = world({ players: 3 });
  s.settings.victory = { type: 'capture_all_towns', allowStandard: true };
  assert.ok(VICTORY_TYPES.includes('capture_all_towns'));
  assert.equal(checkVictory(s).over, false);
  towns[1].owner = 0; s.players[1].towns = []; s.players[0].towns.push(towns[1].id);
  assert.equal(meetsVictory(s, s.players[0], s.settings.victory), false, 'player 2 still holds a town');
  s.players[2].team = 9; s.players[0].team = 9;
  assert.equal(meetsVictory(s, s.players[0], s.settings.victory), true, 'the last town belongs to an ally');
  s.players[2].team = 4;
  towns[2].owner = 0; s.players[2].towns = []; s.players[0].towns.push(towns[2].id);
  const r = checkVictory(s);
  assert.deepEqual([r.over, r.winner, s.gameOver.reason], [true, 0, 'capture_all_towns']);
});
