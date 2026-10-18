import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giveArtifact, assemble } from '../../src/engine/artifacts.js';
import { deps } from '../../src/engine/gameDeps.js';
import { startNewDay } from '../../src/engine/game.js';
import {
  getTownGrowth, getTownGrowthBreakdown, startOfWeekTown, recruit, recruitAll, getRecruitInfo,
  upgradeStack, getUpgradeInfo, getUpgradeTarget, swapTownHeroes, seedNeutralGarrison,
} from '../../src/engine/town.js';
import { setup, town, hero, setResources, buildAll } from './fixture.js';

test('growth: worked example of towns.md (castle + Griffin Bastion + grail = 25 griffins)', () => {
  const s = setup();
  const t = town(s, { buildings: ['castle', 'castle_dwelling_3', 'castle_griffin_bastion', 'castle_grail'] });
  // 7 base + 7 castle + 3 bastion = 17; the Grail adds 50 % of the whole: +8
  assert.equal(getTownGrowth(s, t.id).griffin, 25);
  assert.deepEqual(getTownGrowthBreakdown(s, t.id), [{
    dwellingId: 'castle_dwelling_3', creatureId: 'griffin', tier: 3, base: 7, percent: 100, fort: 7, legion: 0,
    horde: 3, artifacts: 0, external: 0, grail: 8, week: 0, special: 0, total: 25,
  }]);
});

test('growth: village (no fort) has plain base growth; fort adds nothing', () => {
  const s = setup();
  const t = town(s, { buildings: ['village_hall', 'castle_dwelling_1', 'castle_dwelling_2'] });
  assert.deepEqual(getTownGrowth(s, t.id), { pikeman: 14, archer: 9 });
  buildAll(s, t.id, ['fort']);
  assert.deepEqual(getTownGrowth(s, t.id), { pikeman: 14, archer: 9 });
  buildAll(s, t.id, ['citadel']);
  assert.deepEqual(getTownGrowth(s, t.id), { pikeman: 21, archer: 13 }, 'floor(9 * 1.5) = 13');
});

test('growth: hand-computed mixed setup (citadel, hordes, external dwellings, week of)', () => {
  const s = setup();
  const t = town(s, {
    faction: 'rampart',
    buildings: ['citadel', 'rampart_dwelling_1', 'rampart_dwelling_2_up', 'rampart_dwelling_5', 'rampart_miners_guild', 'rampart_dendroid_saplings'],
  });
  const dwarf = 8; // battle dwarf base growth
  assert.deepEqual(getTownGrowth(s, t.id), {
    centaur: Math.floor(14 * 1.5), // 21
    battle_dwarf: Math.floor(dwarf * 1.5) + 4, // 16
    dendroid_guard: Math.floor(3 * 1.5) + 2, // 6
  });
  // two flagged external dwarf cottages (+1 each), one centaur dwelling of the enemy (ignored)
  deps.addObject(s, 'dwarf_cottage', { x: 15, y: 15, z: 0 }, { owner: 0 });
  deps.addObject(s, 'dwarf_cottage', { x: 17, y: 15, z: 0 }, { owner: 0 });
  deps.addObject(s, 'centaur_stables', { x: 15, y: 17, z: 0 }, { owner: 1 });
  let g = getTownGrowth(s, t.id);
  assert.deepEqual([g.centaur, g.battle_dwarf, g.dendroid_guard], [21, 18, 6]);
  assert.equal(getTownGrowthBreakdown(s, t.id).find((r) => r.creatureId === 'battle_dwarf').external, 2);
  // week of the dwarf: +5 (also for the upgraded dwelling); week of the upgraded form counts as well
  s.weekOf = { kind: 'week_of', creatureId: 'dwarf' };
  assert.equal(getTownGrowth(s, t.id).battle_dwarf, 23);
  s.weekOf = { kind: 'week_of', creatureId: 'battle_dwarf' };
  assert.equal(getTownGrowth(s, t.id).battle_dwarf, 23);
  s.weekOf = { kind: 'week_of', creatureId: 'pikeman' };
  g = getTownGrowth(s, t.id);
  assert.deepEqual([g.centaur, g.battle_dwarf], [21, 18]);
  // month-of does not add the +5
  s.weekOf = { kind: 'month_of', creatureId: 'dwarf' };
  assert.equal(getTownGrowth(s, t.id).battle_dwarf, 18);
});

test('growth: Legion pieces of a hero in the town (flat) and the assembled Statue (+50 % everywhere)', () => {
  const s = setup();
  const t = town(s, { buildings: ['castle', 'castle_dwelling_1', 'castle_dwelling_2', 'castle_dwelling_3'] });
  const far = town(s, { buildings: ['castle', 'castle_dwelling_2'], pos: { x: 12, y: 12, z: 0 } });
  const h = hero(s, 'orrin', 0);
  giveArtifact(h, 'legs_of_legion'); // tier 2 +5
  giveArtifact(h, 'loins_of_legion'); // tier 3 +4
  assert.deepEqual(getTownGrowth(s, t.id), { pikeman: 28, archer: 18, griffin: 14 }, 'hero is not in the town');
  const other = hero(s, 'edric', 0, t.id);
  assert.equal(other.townId, t.id);
  assert.deepEqual(getTownGrowth(s, t.id), { pikeman: 28, archer: 18, griffin: 14 });
  swapTownHeroes(s, t.id); // edric to the garrison
  h.townId = t.id;
  t.visitingHero = h.id;
  assert.deepEqual(getTownGrowth(s, t.id), { pikeman: 28, archer: 23, griffin: 18 });
  assert.equal(getTownGrowth(s, far.id).archer, 18, 'pieces only help the town the hero is in');
  // the garrison hero counts too
  t.visitingHero = null;
  h.townId = null;
  giveArtifact(other, 'torso_of_legion'); // tier 4, no dwelling here
  giveArtifact(other, 'legs_of_legion');
  assert.equal(getTownGrowth(s, t.id).archer, 23);
  // assembled statue: +50 % in ALL towns of the owner, pieces still work where he stands
  for (const piece of ['torso_of_legion', 'arms_of_legion', 'head_of_legion']) giveArtifact(h, piece);
  assert.equal(assemble(h, 'statue_of_legion').ok, true);
  assert.equal(getTownGrowth(s, far.id).archer, 27, '9 base + 9 castle + 50 % of (9 + 9)');
  h.townId = far.id;
  far.visitingHero = h.id;
  assert.equal(getTownGrowth(s, far.id).archer, 27 + 5);
  const enemy = town(s, { owner: 1, buildings: ['castle', 'castle_dwelling_2'], pos: { x: 17, y: 17, z: 0 } });
  assert.equal(getTownGrowth(s, enemy.id).archer, 18);
});

test('weekly accumulation: unrecruited creatures pile up, upgraded dwelling feeds the upgraded stock', () => {
  const s = setup();
  s.settings.forceWeekEvent = { kind: 'normal' };
  const t = town(s, { buildings: ['citadel', 'castle_dwelling_1', 'castle_dwelling_2'] });
  assert.deepEqual(t.stock, { pikeman: 21, archer: 13 });
  for (let d = 0; d < 6; d++) startNewDay(s);
  assert.deepEqual(t.stock, { pikeman: 21, archer: 13 }, 'nothing grows during the week');
  startNewDay(s);
  assert.deepEqual([s.date.day, s.date.week], [1, 2]);
  assert.deepEqual(t.stock, { pikeman: 42, archer: 26 });
  buildAll(s, t.id, ['castle_dwelling_1_up']);
  assert.deepEqual(t.stock, { pikeman: 42, archer: 26, halberdier: 14 }, '+ base growth on construction');
  for (let d = 0; d < 7; d++) startNewDay(s);
  assert.deepEqual(t.stock, { pikeman: 42, archer: 39, halberdier: 35 });
  for (let d = 0; d < 14; d++) startNewDay(s);
  assert.deepEqual(t.stock, { pikeman: 42, archer: 65, halberdier: 77 }, 'no cap');
});

test('plague halves every stock instead of growing; month-of doubles after growth', () => {
  const s = setup();
  const t = town(s, { buildings: ['fort', 'castle_dwelling_1_up', 'castle_dwelling_2'] });
  t.stock = { pikeman: 5, halberdier: 21, archer: 9 };
  s.weekOf = { kind: 'plague', creatureId: null };
  const r = startOfWeekTown(s, t.id);
  assert.deepEqual(t.stock, { pikeman: 2, halberdier: 10, archer: 4 });
  assert.deepEqual(r.events, [{ type: 'plague', townId: t.id }]);
  s.weekOf = { kind: 'month_of', creatureId: 'pikeman' };
  startOfWeekTown(s, t.id);
  // halberdier: (10 + 14) * 2, leftover pikemen double too, archers just grow
  assert.deepEqual(t.stock, { pikeman: 4, halberdier: 48, archer: 13 });
  s.weekOf = { kind: 'month_of', creatureId: 'imp' };
  startOfWeekTown(s, t.id);
  assert.deepEqual(t.stock, { pikeman: 4, halberdier: 62, archer: 22 }, 'no imp dwelling: plain growth');
});

test('neutral towns grow their stock and +10 % garrison per week (at least +1)', () => {
  const s = setup();
  const t = town(s, { owner: null, buildings: ['citadel', 'castle_dwelling_1'] });
  assert.deepEqual(t.stock, { pikeman: 21 });
  t.garrison[0] = { creatureId: 'pikeman', count: 57 };
  t.garrison[1] = { creatureId: 'archer', count: 3 };
  startOfWeekTown(s, t.id);
  assert.deepEqual(t.stock, { pikeman: 42 });
  assert.deepEqual([t.garrison[0].count, t.garrison[1].count], [62, 4]);
  const owned = town(s, { pos: { x: 9, y: 9, z: 0 } });
  owned.garrison[0] = { creatureId: 'pikeman', count: 50 };
  startOfWeekTown(s, owned.id);
  assert.equal(owned.garrison[0].count, 50, 'player garrisons do not grow');
  const g = seedNeutralGarrison(s, t.id, 1.5);
  assert.deepEqual(g.slice(0, 3), [
    { creatureId: 'pikeman', count: 42 }, { creatureId: 'archer', count: 27 }, { creatureId: 'griffin', count: 21 },
  ]);
});

test('recruit: cost, stock, slots, targets', () => {
  const s = setup({ poor: true });
  const t = town(s, { buildings: ['fort', 'castle_dwelling_1', 'castle_dwelling_7'] });
  assert.deepEqual(t.stock, { pikeman: 14, angel: 1 });
  setResources(s, 0, { gold: 3500, gems: 1 });
  assert.equal(recruit(s, t.id, 'pikeman', 0).error, 'bad_count');
  assert.equal(recruit(s, t.id, 'pikeman', 2.5).error, 'bad_count');
  assert.equal(recruit(s, t.id, 'archer', 1).error, 'no_dwelling');
  assert.equal(recruit(s, t.id, 'pikeman', 15).error, 'not_enough_creatures');
  assert.equal(recruit(s, t.id, 'pikeman', 1, 'visiting').error, 'no_hero');
  assert.equal(recruit(s, t.id, 'pikeman', 1, 'backpack').error, 'bad_target');
  let r = recruit(s, t.id, 'pikeman', 5);
  assert.equal(r.ok, true);
  assert.deepEqual(r.events[0], { type: 'recruited', townId: t.id, creatureId: 'pikeman', count: 5, target: 'garrison', cost: { gold: 300 } });
  assert.deepEqual([s.players[0].resources.gold, t.stock.pikeman], [3200, 9]);
  assert.deepEqual(t.garrison[0], { creatureId: 'pikeman', count: 5 });
  // angel: 3000 gold + 1 gem
  r = recruit(s, t.id, 'angel', 1);
  assert.equal(r.ok, true);
  assert.deepEqual([s.players[0].resources.gold, s.players[0].resources.gems, t.stock.angel], [200, 0, 0]);
  assert.equal(recruit(s, t.id, 'angel', 1).error, 'not_enough_creatures');
  assert.equal(recruit(s, t.id, 'pikeman', 4).error, 'not_enough_resources');
  assert.equal(t.stock.pikeman, 9, 'nothing taken on failure');
  // visiting hero, merging into his stack
  const h = hero(s, 'orrin', 0, t.id);
  h.army = [{ creatureId: 'pikeman', count: 10 }, null, null, null, null, null, null];
  assert.equal(recruit(s, t.id, 'pikeman', 3, 'visiting').ok, true);
  assert.equal(h.army[0].count, 13);
  assert.equal(s.players[0].resources.gold, 20);
  // full army without a matching stack
  setResources(s, 0, { gold: 10000 });
  h.army = ['archer', 'griffin', 'swordsman', 'monk', 'cavalier', 'angel', 'zealot'].map((creatureId) => ({ creatureId, count: 1 }));
  assert.equal(recruit(s, t.id, 'pikeman', 1, 'visiting').error, 'no_free_slot');
  assert.equal(recruit(s, t.id, 'pikeman', 1, 'garrison').ok, true);
  // garrison hero: the garrison row is his army
  swapTownHeroes(s, t.id);
  assert.equal(t.garrisonHero, null, 'army would not fit: swap refused');
});

test('recruit with a garrison hero goes into his army', () => {
  const s = setup();
  const t = town(s, { buildings: ['fort', 'castle_dwelling_1'] });
  const h = hero(s, 'orrin', 0, t.id);
  h.army = [{ creatureId: 'archer', count: 2 }, null, null, null, null, null, null];
  t.garrison[3] = { creatureId: 'pikeman', count: 4 };
  assert.equal(swapTownHeroes(s, t.id).ok, true);
  assert.deepEqual([t.garrisonHero, t.visitingHero, h.garrisoned], [h.id, null, true]);
  assert.ok(t.garrison.every((x) => x === null), 'garrison troops joined the hero');
  assert.equal(recruit(s, t.id, 'pikeman', 6, 'garrison').ok, true);
  assert.deepEqual(h.army.filter(Boolean), [{ creatureId: 'archer', count: 2 }, { creatureId: 'pikeman', count: 10 }]);
});

test('recruit: an upgraded dwelling still sells the base creature from the same pool', () => {
  const s = setup({ poor: true });
  const t = town(s, { buildings: ['fort', 'castle_dwelling_1'] });
  setResources(s, 0, { gold: 100000, ore: 10 });
  buildAll(s, t.id, ['castle_dwelling_1_up']);
  assert.deepEqual(t.stock, { pikeman: 14, halberdier: 14 });
  setResources(s, 0, { gold: 10000 });
  assert.equal(recruit(s, t.id, 'pikeman', 20).ok, true);
  assert.deepEqual(t.stock, { pikeman: 0, halberdier: 8 }, 'leftover base stock first, then the upgraded pool');
  assert.equal(s.players[0].resources.gold, 10000 - 20 * 60);
  assert.equal(recruit(s, t.id, 'halberdier', 9).error, 'not_enough_creatures');
  assert.equal(recruit(s, t.id, 'halberdier', 8).ok, true);
  assert.equal(s.players[0].resources.gold, 10000 - 20 * 60 - 8 * 75);
});

test('recruitAll buys the strongest affordable creatures first', () => {
  const s = setup({ poor: true });
  const t = town(s, { buildings: ['fort', 'castle_dwelling_1', 'castle_dwelling_2', 'castle_dwelling_3'] });
  assert.deepEqual(t.stock, { pikeman: 14, archer: 9, griffin: 7 });
  setResources(s, 0, { gold: 2000 });
  const r = recruitAll(s, t.id, 'garrison');
  assert.equal(r.ok, true);
  // 7 griffins (1400) + 6 archers (600) + 0 pikemen
  assert.deepEqual(t.stock, { pikeman: 14, archer: 3, griffin: 0 });
  assert.equal(s.players[0].resources.gold, 0);
  assert.deepEqual(r.events.map((e) => [e.creatureId, e.count]), [['griffin', 7], ['archer', 6]]);
  assert.equal(recruitAll(s, t.id, 'visiting').error, 'no_hero');
  const info = getRecruitInfo(s, t.id);
  assert.deepEqual(info.map((x) => [x.creatureId, x.available, x.growth, x.affordable]), [['pikeman', 14, 14, 0], ['archer', 3, 9, 0], ['griffin', 0, 7, 0]]);
});

test('upgradeStack: price difference x count, needs the upgraded dwelling', () => {
  const s = setup({ poor: true });
  const t = town(s, { buildings: ['fort', 'castle_dwelling_1', 'castle_dwelling_7_up'] });
  const h = hero(s, 'orrin', 0, t.id);
  h.army = [{ creatureId: 'pikeman', count: 20 }, { creatureId: 'angel', count: 2 }, { creatureId: 'arch_angel', count: 1 }, null, null, null, null];
  t.garrison[0] = { creatureId: 'angel', count: 1 };
  assert.equal(getUpgradeTarget(t, 'pikeman'), null);
  assert.equal(getUpgradeTarget(t, 'angel'), 'arch_angel');
  assert.equal(upgradeStack(s, { townId: t.id, where: 'visiting', slot: 0 }).error, 'no_upgrade_available');
  assert.equal(upgradeStack(s, { townId: t.id, where: 'visiting', slot: 2 }).error, 'no_upgrade_available', 'already top');
  assert.equal(upgradeStack(s, { townId: t.id, where: 'visiting', slot: 5 }).error, 'empty_slot');
  assert.deepEqual(getUpgradeInfo(s, { townId: t.id, where: 'visiting', slot: 1 }), {
    from: 'angel', to: 'arch_angel', count: 2, cost: { gold: 4000, gems: 4 },
  });
  setResources(s, 0, { gold: 4000, gems: 3 });
  assert.equal(upgradeStack(s, { townId: t.id, where: 'visiting', slot: 1 }).error, 'not_enough_resources');
  setResources(s, 0, { gold: 6100, gems: 6 });
  assert.equal(upgradeStack(s, { townId: t.id, where: 'visiting', slot: 1 }).ok, true);
  assert.deepEqual(h.army[1], { creatureId: 'arch_angel', count: 2 });
  assert.deepEqual([s.players[0].resources.gold, s.players[0].resources.gems], [2100, 2]);
  assert.equal(upgradeStack(s, { townId: t.id, where: 'garrison', slot: 0 }).ok, true);
  assert.deepEqual(t.garrison[0], { creatureId: 'arch_angel', count: 1 });
  assert.deepEqual([s.players[0].resources.gold, s.players[0].resources.gems], [100, 0]);
  // pikemen once the Guardhouse is upgraded: 15 gold each
  setResources(s, 0, { gold: 1300, ore: 5 });
  buildAll(s, t.id, ['castle_dwelling_1_up']);
  assert.equal(upgradeStack(s, { townId: t.id, where: 'visiting', slot: 0 }).ok, true);
  assert.deepEqual(h.army[0], { creatureId: 'halberdier', count: 20 });
  assert.equal(s.players[0].resources.gold, 0);
});

test('Factory: both tier-7 dwellings grow and recruit independently', () => {
  const s = setup();
  const t = town(s, { faction: 'factory', buildings: ['castle', 'factory_dwelling_7', 'factory_dwelling_7_alt', 'factory_stockyard'] });
  assert.deepEqual(getTownGrowth(s, t.id), { couatl: 2, dreadnought: 2 });
  assert.deepEqual(t.stock, { couatl: 2, dreadnought: 2 });
  assert.equal(recruit(s, t.id, 'dreadnought', 2).ok, true);
  assert.equal(recruit(s, t.id, 'couatl', 1).ok, true);
  assert.deepEqual(t.stock, { couatl: 1, dreadnought: 0 });
  buildAll(s, t.id, ['factory_dwelling_7_alt_up']);
  assert.deepEqual(getTownGrowth(s, t.id), { couatl: 2, juggernaut: 2 });
  t.garrison = [{ creatureId: 'dreadnought', count: 2 }, { creatureId: 'couatl', count: 1 }, null, null, null, null, null];
  assert.equal(getUpgradeTarget(t, 'dreadnought'), 'juggernaut');
  assert.equal(getUpgradeTarget(t, 'couatl'), null);
  const gold = s.players[0].resources.gold;
  assert.equal(upgradeStack(s, { townId: t.id, where: 'garrison', slot: 0 }).ok, true);
  assert.equal(s.players[0].resources.gold, gold - 2 * 1500);
});
