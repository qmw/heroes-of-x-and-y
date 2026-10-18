import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCES } from '../../src/core/constants.js';
import {
  canAfford, pay, addResources, getDailyIncome, getIncomeBreakdown, applyDailyIncome, startingResources,
  DIFFICULTIES, getNeutralStrengthMultiplier, costTimes, maxAffordable, countMarketplaces, getMarketRate,
  marketTrade, sendResources, getTownIncome,
} from '../../src/engine/economy.js';
import { marketRate } from '../../src/data/buildings.js';
import { giveArtifact } from '../../src/engine/artifacts.js';
import { deps } from '../../src/engine/gameDeps.js';
import { setup, town, hero, setResources, buildAll } from './fixture.js';

test('canAfford / pay / addResources', () => {
  const s = setup({ poor: true });
  setResources(s, 0, { gold: 1000, wood: 5 });
  assert.equal(canAfford(s, 0, { gold: 1000, wood: 5 }), true);
  assert.equal(canAfford(s, 0, { gold: 1001 }), false);
  assert.equal(canAfford(s, 0, { ore: 1 }), false);
  assert.equal(canAfford(s, 0, {}), true);
  assert.equal(pay(s, 0, { gold: 400, ore: 1 }), false, 'all or nothing');
  assert.equal(s.players[0].resources.gold, 1000);
  assert.equal(pay(s, 0, { gold: 400, wood: 5 }), true);
  assert.deepEqual([s.players[0].resources.gold, s.players[0].resources.wood], [600, 0]);
  addResources(s, 0, { gems: 3, gold: -1000 });
  assert.deepEqual([s.players[0].resources.gold, s.players[0].resources.gems], [0, 3], 'never negative');
  assert.throws(() => canAfford(s, 9, {}));
});

test('costTimes / maxAffordable', () => {
  const s = setup({ poor: true });
  setResources(s, 0, { gold: 10000, gems: 2 });
  assert.deepEqual(costTimes({ gold: 3000, gems: 1 }, 3), { gold: 9000, gems: 3 });
  assert.equal(maxAffordable(s, 0, { gold: 3000, gems: 1 }), 2);
  assert.equal(maxAffordable(s, 0, { gold: 60 }), 166);
  assert.equal(maxAffordable(s, 0, {}), Infinity);
});

test('starting resources by difficulty (original tables)', () => {
  const g = (d, human) => { const r = startingResources(d, human); return [r.gold, r.wood, r.ore, r.mercury, r.sulfur, r.crystal, r.gems]; };
  assert.deepEqual(g(0, true), [30000, 30, 30, 15, 15, 15, 15]);
  assert.deepEqual(g(1, true), [20000, 20, 20, 10, 10, 10, 10]);
  assert.deepEqual(g(2, true), [15000, 15, 15, 7, 7, 7, 7]);
  assert.deepEqual(g(3, true), [10000, 10, 10, 4, 4, 4, 4]);
  assert.deepEqual(g(4, true), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(g(0, false), [5000, 5, 5, 2, 2, 2, 2]);
  assert.deepEqual(g(1, false), [7500, 10, 10, 5, 5, 5, 5]);
  for (const d of [2, 3, 4]) assert.deepEqual(g(d, false), [10000, 15, 15, 7, 7, 7, 7]);
  assert.deepEqual(DIFFICULTIES.map((d) => d.ratingPercent), [80, 100, 130, 160, 200]);
  assert.throws(() => startingResources(5));
  const a = startingResources(1);
  a.gold = 0;
  assert.equal(startingResources(1).gold, 20000, 'fresh object each time');
});

test('neutral strength multiplier grows with difficulty', () => {
  const s = setup();
  const m = [0, 1, 2, 3, 4].map((d) => { s.settings.difficulty = d; return getNeutralStrengthMultiplier(s); });
  assert.equal(m[1], 1);
  for (let i = 1; i < m.length; i++) assert.ok(m[i] > m[i - 1]);
});

test('town income: halls 500/1000/2000/4000, silo per faction, grail +5000', () => {
  const s = setup();
  const t = town(s);
  assert.equal(getTownIncome(t).gold, 500);
  buildAll(s, t.id, ['town_hall']);
  assert.equal(getTownIncome(t).gold, 1000);
  buildAll(s, t.id, ['marketplace', 'blacksmith', 'mage_guild_1', 'city_hall']);
  assert.equal(getTownIncome(t).gold, 2000);
  buildAll(s, t.id, ['citadel', 'castle', 'capitol', 'resource_silo']);
  const inc = getTownIncome(t);
  assert.deepEqual([inc.gold, inc.wood, inc.ore, inc.mercury], [4000, 1, 1, 0]);
  const tower = town(s, { faction: 'tower', buildings: ['village_hall', 'marketplace', 'resource_silo'], pos: { x: 9, y: 9, z: 0 } });
  assert.deepEqual([getTownIncome(tower).gems, getTownIncome(tower).wood], [1, 0]);
  const withGrail = town(s, { faction: 'castle', buildings: ['village_hall', 'castle_grail'], pos: { x: 12, y: 12, z: 0 } });
  assert.equal(getTownIncome(withGrail).gold, 5500);
});

test('daily income = towns + mines + Estates + artifacts + resource specialty', () => {
  const s = setup();
  const t = town(s, { buildings: ['town_hall', 'tavern', 'marketplace', 'resource_silo'] });
  town(s, { faction: 'rampart', pos: { x: 10, y: 10, z: 0 }, buildings: ['village_hall'] });
  deps.addObject(s, 'gold_mine', { x: 2, y: 2, z: 0 }, { owner: 0 });
  deps.addObject(s, 'sawmill', { x: 3, y: 2, z: 0 }, { owner: 0 });
  deps.addObject(s, 'gem_pond', { x: 4, y: 2, z: 0 }, { owner: 1 });
  const haart = hero(s, 'lord_haart', 0, t.id); // Estates basic +125
  giveArtifact(haart, 'endless_purse_of_gold'); // +500
  giveArtifact(haart, 'inexhaustible_cart_of_ore'); // +1 ore
  hero(s, 'caitlin', 0); // resource specialty
  const b = getIncomeBreakdown(s, 0);
  assert.equal(b.towns.gold, 1500);
  assert.deepEqual([b.towns.wood, b.towns.ore], [1, 1]);
  assert.deepEqual([b.mines.gold, b.mines.wood, b.mines.gems], [1000, 2, 0]);
  assert.equal(b.heroes.ore, 1);
  const caitlin = 350; // Caitlin: +350 gold per day
  assert.equal(b.heroes.gold, 125 + 500 + caitlin);
  const total = getDailyIncome(s, 0);
  assert.equal(total.gold, 1500 + 1000 + 625 + caitlin);
  assert.deepEqual([total.wood, total.ore, total.gems], [3, 2, 0]);
  assert.equal(getDailyIncome(s, 1).gems, 1);
  assert.equal(getDailyIncome(s, 1).gold, 0, 'no towns, no gold');
  const before = { ...s.players[0].resources };
  const r = applyDailyIncome(s, 0);
  assert.equal(r.ok, true);
  for (const res of RESOURCES) assert.equal(s.players[0].resources[res], before[res] + total[res]);
});

test('neutral towns earn nothing for anybody', () => {
  const s = setup();
  town(s, { owner: null });
  assert.equal(getDailyIncome(s, 0).gold, 0);
});

test('market rate table by number of marketplaces (towns.md §7)', () => {
  const rows = {
    1: [25, 50, 2500, 5000, 10, 20, 5],
    2: [38, 75, 1667, 3333, 7, 13, 3],
    3: [50, 100, 1250, 2500, 5, 10, 3],
    4: [63, 125, 1000, 2000, 4, 8, 2],
    5: [75, 150, 833, 1667, 3, 7, 2],
    6: [88, 175, 714, 1429, 3, 6, 1],
    7: [100, 200, 625, 1250, 3, 5, 1],
    8: [113, 225, 556, 1111, 2, 4, 1],
    9: [125, 250, 500, 1000, 2, 4, 1],
    12: [125, 250, 500, 1000, 2, 4, 1],
  };
  for (const [n, [woodGold, rareGold, goldWood, goldRare, same, woodRare, rareWood]] of Object.entries(rows)) {
    const m = Number(n);
    assert.deepEqual(marketRate('wood', 'gold', m), { give: 1, get: woodGold }, `wood->gold @${m}`);
    assert.deepEqual(marketRate('gems', 'gold', m), { give: 1, get: rareGold }, `gems->gold @${m}`);
    assert.deepEqual(marketRate('gold', 'ore', m), { give: goldWood, get: 1 }, `gold->ore @${m}`);
    assert.deepEqual(marketRate('gold', 'sulfur', m), { give: goldRare, get: 1 }, `gold->sulfur @${m}`);
    assert.deepEqual(marketRate('wood', 'ore', m), { give: same, get: 1 }, `wood->ore @${m}`);
    assert.deepEqual(marketRate('mercury', 'crystal', m), { give: same, get: 1 }, `rare->rare @${m}`);
    assert.deepEqual(marketRate('ore', 'gems', m), { give: woodRare, get: 1 }, `ore->gems @${m}`);
    assert.deepEqual(marketRate('crystal', 'wood', m), { give: rareWood, get: 1 }, `crystal->wood @${m}`);
  }
});

test('marketTrade uses the number of owned marketplaces', () => {
  const s = setup({ poor: true });
  setResources(s, 0, { gold: 10000, wood: 20 });
  const t1 = town(s, { buildings: ['village_hall'] });
  assert.equal(countMarketplaces(s, 0), 0);
  assert.equal(getMarketRate(s, 0, 'wood', 'gold'), null);
  assert.equal(marketTrade(s, 0, 'wood', 'gold', 1).error, 'no_marketplace');
  buildAll(s, t1.id, ['marketplace']);
  setResources(s, 0, { gold: 10000, wood: 20 });
  assert.equal(countMarketplaces(s, 0), 1);
  let r = marketTrade(s, 0, 'wood', 'gold', 4);
  assert.equal(r.ok, true);
  assert.deepEqual([s.players[0].resources.wood, s.players[0].resources.gold], [16, 10100]);
  r = marketTrade(s, 0, 'gold', 'gems', 2);
  assert.deepEqual([s.players[0].resources.gold, s.players[0].resources.gems], [100, 2]);
  assert.equal(marketTrade(s, 0, 'gold', 'gems', 1).error, 'not_enough_resources');
  assert.equal(marketTrade(s, 0, 'gold', 'gold', 1).error, 'bad_resource');
  assert.equal(marketTrade(s, 0, 'gold', 'mithril', 1).error, 'bad_resource');
  assert.equal(marketTrade(s, 0, 'wood', 'gold', 0).error, 'bad_amount');
  assert.equal(marketTrade(s, 0, 'wood', 'gold', 1.5).error, 'bad_amount');
  // second and third marketplace improve the rate
  town(s, { pos: { x: 9, y: 9, z: 0 }, buildings: ['village_hall', 'marketplace'] });
  town(s, { pos: { x: 13, y: 13, z: 0 }, faction: 'tower', buildings: ['village_hall', 'marketplace'] });
  assert.equal(countMarketplaces(s, 0), 3);
  marketTrade(s, 0, 'wood', 'gold', 2);
  assert.equal(s.players[0].resources.gold, 200);
  assert.deepEqual(getMarketRate(s, 0, 'wood', 'ore'), { give: 5, get: 1 });
  // a Trading Post on the map counts as a marketplace
  assert.deepEqual(getMarketRate(s, 1, 'wood', 'gold', { extraMarkets: 1 }), { give: 1, get: 25 });
  assert.equal(marketTrade(s, 0, 'wood', 'gold', 1, { townId: t1.id }).ok, true);
  s.towns[t1.id].owner = 1;
  assert.equal(marketTrade(s, 0, 'wood', 'gold', 1, { townId: t1.id }).error, 'not_your_town');
});

test('sendResources: free 1:1 transfer, needs a marketplace', () => {
  const s = setup({ poor: true });
  setResources(s, 0, { gold: 500, gems: 4 });
  assert.equal(sendResources(s, 0, 1, 'gems', 2).error, 'no_marketplace');
  town(s, { buildings: ['village_hall', 'marketplace'] });
  setResources(s, 0, { gold: 500, gems: 4 });
  setResources(s, 1, {});
  assert.equal(sendResources(s, 0, 1, 'gems', 3).ok, true);
  assert.deepEqual([s.players[0].resources.gems, s.players[1].resources.gems], [1, 3]);
  assert.equal(sendResources(s, 0, 1, 'gems', 2).error, 'not_enough_resources');
  assert.equal(sendResources(s, 0, 0, 'gems', 1).error, 'bad_player');
  assert.equal(sendResources(s, 0, 7, 'gems', 1).error, 'bad_player');
  assert.equal(sendResources(s, 0, 1, 'gems', -1).error, 'bad_amount');
  s.players[1].alive = false;
  assert.equal(sendResources(s, 0, 1, 'gems', 1).error, 'bad_player');
});

test("Merchant's Scales count as one more marketplace (only once a market exists)", async () => {
  const { giveArtifact } = await import('../../src/engine/artifacts.js');
  const s = setup();
  const t = town(s, { buildings: ['village_hall'] });
  const h = hero(s, 'orrin', 0);
  giveArtifact(h, 'merchants_scales');
  assert.equal(countMarketplaces(s, 0), 0, 'no market: the scales alone do not open one');
  t.buildings.push('marketplace');
  assert.equal(countMarketplaces(s, 0), 2);
});
