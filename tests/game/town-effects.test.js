// One (or more) test per building effect type of the closed set in data/buildings.js EFFECT_TYPES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFECT_TYPES, BUILDINGS, getBuildingEffects, ARTIFACT_MERCHANT_SLOTS, artifactBuyPrice, artifactSellPrice } from '../../src/data/buildings.js';
import { getArtifact } from '../../src/data/artifacts.js';
import { FACTIONS } from '../../src/core/constants.js';
import { getCreature } from '../../src/data/creatures.js';
import { guildSpellPool, getSpell } from '../../src/data/spells.js';
import { giveArtifact, ownsArtifact, getWarMachines } from '../../src/engine/artifacts.js';
import { expForLevel } from '../../src/engine/leveling.js';
import { deps } from '../../src/engine/gameDeps.js';
import { getTownIncome } from '../../src/engine/economy.js';
import { startNewDay } from '../../src/engine/game.js';
import {
  getTownGrowth, getSiegeInfo, getTownGarrisonBonuses, arrowTowerDamage, visitTown, leaveTown, build,
  getMerchantStock, startOfDayTown, startOfWeekTown, startOfMonthTown, applyWeeklyTownResources, getPlayerTownBonuses,
  hireHero, getThievesGuildLevel, getThievesGuildInfo, getWarMachinesForSale, buyWarMachine, sellCreatures,
  getArtifactMerchantOffers, buyArtifact, sellArtifact, sacrificeCreatures, sacrificeArtifact,
  getMageGuildLevel, getGuildSlots, transformToSkeletons, skeletonTransformResult, useCastleGate,
  getCastleGateDestinations, buildBoat, getTownSightRadius, applyFogCover, learnUniversitySkill,
  hasNativeTerrainAll, playerHasGrailBuilding, captureTown, ensureTavernPool, recruit,
} from '../../src/engine/town.js';
import { setup, town, hero, setResources, buildAll } from './fixture.js';

const covered = new Set();
/** Register a test for an effect type. */
function effect(type, name, fn) {
  if (!EFFECT_TYPES[type]) throw new Error(`not an effect type: ${type}`);
  covered.add(type);
  test(`${type}: ${name}`, fn);
}

effect('resource_income', 'halls and silo pay through getTownIncome', () => {
  const s = setup();
  const t = town(s, { faction: 'inferno', buildings: ['city_hall', 'marketplace', 'resource_silo'] });
  const inc = getTownIncome(t);
  assert.deepEqual([inc.gold, inc.mercury, inc.wood], [2000, 1, 0]);
});

effect('growth_percent', 'citadel +50 %, castle +100 % of base growth', () => {
  const s = setup();
  const t = town(s);
  assert.equal(getTownGrowth(s, t.id).pikeman, 14);
  buildAll(s, t.id, ['citadel']);
  assert.equal(getTownGrowth(s, t.id).pikeman, 21);
  buildAll(s, t.id, ['castle']);
  assert.equal(getTownGrowth(s, t.id).pikeman, 28);
});

effect('creature_growth', 'horde building adds flat growth to its tier only', () => {
  const s = setup();
  const t = town(s, { buildings: ['castle', 'castle_dwelling_1', 'castle_dwelling_3', 'castle_dwelling_2'] });
  assert.equal(getTownGrowth(s, t.id).griffin, 14);
  buildAll(s, t.id, ['castle_griffin_bastion']);
  const g = getTownGrowth(s, t.id);
  assert.deepEqual([g.griffin, g.pikeman, g.archer], [17, 28, 18]);
  buildAll(s, t.id, ['castle_dwelling_3_up']);
  assert.equal(getTownGrowth(s, t.id).royal_griffin, 17, 'horde also feeds the upgraded dwelling');
});

effect('siege_defense', 'fort levels, moat, mines and arrow towers in getSiegeInfo', () => {
  const s = setup();
  const village = town(s, { buildings: ['village_hall'] });
  assert.equal(getSiegeInfo(s, village.id), null);
  const t = town(s, { pos: { x: 9, y: 9, z: 0 } });
  let info = getSiegeInfo(s, t.id);
  assert.deepEqual([info.fortLevel, info.wallHp, info.gateHp, info.keep, info.turrets, info.moat], [1, 2, 2, false, 0, null]);
  assert.equal(info.faction, 'castle');
  assert.deepEqual(info.buildings, t.buildings);
  assert.deepEqual(info.towers, { attack: 10, keep: null, turret: null });
  buildAll(s, t.id, ['citadel']);
  info = getSiegeInfo(s, t.id);
  assert.deepEqual([info.fortLevel, info.keep, info.turrets], [2, true, 0]);
  assert.deepEqual(info.moat, { name: 'Moat', damage: 70, width: 1 });
  const n = t.buildings.length;
  assert.deepEqual(info.towers.keep, { min: 10 + 2 * n, max: 15 + 3 * n });
  assert.equal(info.towers.turret, null);
  buildAll(s, t.id, ['castle']);
  info = getSiegeInfo(s, t.id);
  assert.deepEqual([info.fortLevel, info.wallHp, info.turrets], [3, 3, 2]);
  assert.deepEqual(info.towers.turret, { min: 6 + n, max: 9 + 2 * n });
  assert.deepEqual(arrowTowerDamage(10), { keep: { min: 30, max: 45 }, turret: { min: 16, max: 29 } });
  const tower = town(s, { faction: 'tower', buildings: ['citadel'], pos: { x: 14, y: 14, z: 0 } });
  const ti = getSiegeInfo(s, tower.id);
  assert.equal(ti.moat, null);
  assert.deepEqual(ti.mines, { damage: 150, count: 6 });
  const dungeon = town(s, { faction: 'dungeon', buildings: ['castle'], pos: { x: 17, y: 3, z: 0 } });
  assert.equal(getSiegeInfo(s, dungeon.id).moat.damage, 90);
  assert.equal(getSiegeInfo(s, dungeon.id).mines, null);
});

effect('garrison_bonus', 'tavern / brotherhood morale, fountain luck, hero primaries, grail', () => {
  const s = setup();
  const t = town(s);
  let g = getTownGarrisonBonuses(s, t.id);
  assert.equal(g.morale, 1);
  assert.deepEqual(g.bonuses.map((b) => [b.type, b.value]), [['morale', 1]]);
  buildAll(s, t.id, ['castle_brotherhood_of_the_sword']);
  assert.equal(getTownGarrisonBonuses(s, t.id).morale, 2);
  assert.equal(getSiegeInfo(s, t.id).garrison.morale, 2);
  const rampart = town(s, { faction: 'rampart', buildings: ['fort', 'rampart_mystic_pond', 'rampart_fountain_of_fortune'], pos: { x: 9, y: 9, z: 0 } });
  g = getTownGarrisonBonuses(s, rampart.id);
  assert.deepEqual([g.morale, g.luck], [0, 2]);
  assert.deepEqual(g.bonuses.map((b) => [b.type, b.value]), [['luck', 2]]);
  const inferno = town(s, { faction: 'inferno', buildings: ['fort', 'inferno_brimstone_stormclouds'], pos: { x: 13, y: 13, z: 0 } });
  assert.deepEqual(getTownGarrisonBonuses(s, inferno.id).primary, { attack: 0, defense: 0, power: 2, knowledge: 0 });
  const fortress = town(s, {
    faction: 'fortress', pos: { x: 16, y: 16, z: 0 },
    buildings: ['fort', 'fortress_glyphs_of_fear', 'fortress_blood_obelisk', 'fortress_grail'],
  });
  assert.deepEqual(getTownGarrisonBonuses(s, fortress.id).primary, { attack: 12, defense: 12, power: 0, knowledge: 0 });
  const grails = { tower: ['knowledge', 15], dungeon: ['power', 12], stronghold: ['attack', 20] };
  let x = 1;
  for (const [f, [stat, value]] of Object.entries(grails)) {
    const gt = town(s, { faction: f, buildings: ['village_hall', `${f}_grail`], pos: { x: x += 2, y: 18, z: 0 } });
    assert.equal(getTownGarrisonBonuses(s, gt.id).primary[stat], value, f);
  }
  const pub = town(s, { faction: 'cove', buildings: ['village_hall', 'cove_pub'], pos: { x: 1, y: 12, z: 0 } });
  assert.equal(getTownGarrisonBonuses(s, pub.id).morale, 2);
});

effect('visit_bonus', 'once per hero per town; primary stats', () => {
  const s = setup();
  const a = town(s, { faction: 'stronghold', buildings: ['fort', 'stronghold_hall_of_valhalla'] });
  const b = town(s, { faction: 'stronghold', buildings: ['fort', 'stronghold_hall_of_valhalla'], pos: { x: 9, y: 9, z: 0 } });
  const h = hero(s, 'orrin', 0);
  const base = h.primary.attack;
  const r = visitTown(s, h.id, a.id);
  assert.ok(r.events.some((e) => e.type === 'visit_bonus' && e.stat === 'attack' && e.value === 1));
  assert.equal(h.primary.attack, base + 1);
  leaveTown(s, h.id);
  visitTown(s, h.id, a.id);
  startOfDayTown(s, a.id);
  assert.equal(h.primary.attack, base + 1, 'only once in the same town');
  leaveTown(s, h.id);
  visitTown(s, h.id, b.id);
  assert.equal(h.primary.attack, base + 2, 'another town of the same type gives it again');
  const other = hero(s, 'edric', 0);
  leaveTown(s, h.id);
  visitTown(s, other.id, b.id);
  assert.equal(other.primary.attack, 2 + 1, 'each hero gets his own');
});

effect('visit_bonus', 'granted when the building is built with the hero inside; all four stat buildings', () => {
  const s = setup();
  const cases = [
    ['tower', 'tower_wall_of_knowledge', ['mage_guild_1'], { knowledge: 1 }],
    ['inferno', 'inferno_order_of_fire', ['mage_guild_1'], { power: 1 }],
    ['fortress', 'fortress_cage_of_warlords', [], { defense: 1 }],
    ['factory', 'factory_proving_grounds', ['blacksmith', 'mage_guild_1'], { attack: 1, knowledge: 1 }],
  ];
  let x = 2;
  for (const [faction, buildingId, pre, gains] of cases) {
    const t = town(s, { faction, buildings: ['fort', ...pre], pos: { x: x += 3, y: 4, z: 0 } });
    const h = hero(s, ['orrin', 'edric', 'sorsha', 'tyris'][cases.findIndex((c) => c[0] === faction)], 0, t.id);
    const before = { ...h.primary };
    buildAll(s, t.id, [buildingId]);
    for (const [stat, v] of Object.entries(gains)) assert.equal(h.primary[stat], before[stat] + v, `${buildingId} ${stat}`);
    startOfDayTown(s, t.id);
    for (const [stat, v] of Object.entries(gains)) assert.equal(h.primary[stat], before[stat] + v, 'not again next day');
  }
});

effect('visit_bonus', 'Battle Scholar Academy: +1000 experience (level-up)', () => {
  const s = setup();
  const t = town(s, { faction: 'dungeon', buildings: ['fort', 'dungeon_battle_scholar_academy'] });
  const h = hero(s, 'orrin', 0);
  assert.deepEqual([h.exp, h.level], [0, 1]);
  visitTown(s, h.id, t.id);
  assert.equal(h.exp, 1000);
  assert.equal(h.level, 2);
  assert.equal(expForLevel(2), 1000);
  leaveTown(s, h.id);
  visitTown(s, h.id, t.id);
  assert.equal(h.exp, 1000);
});

effect('visit_temp_bonus', 'Stables: +400 movement until the end of the week, not stacking', () => {
  const s = setup();
  const t = town(s, { buildings: ['fort', 'castle_stables'] });
  const h = hero(s, 'orrin', 0);
  const mp = h.movePoints;
  visitTown(s, h.id, t.id);
  assert.equal(h.movePoints, mp + 400);
  const temps = h.temp.filter((x) => x.source === 'castle_stables');
  assert.equal(temps.length, 1);
  assert.deepEqual(temps[0].bonus, { type: 'movement_land', value: 400 });
  assert.equal(temps[0].until, 'end_of_week');
  leaveTown(s, h.id);
  visitTown(s, h.id, t.id);
  startOfDayTown(s, t.id);
  assert.equal(h.temp.filter((x) => x.source === 'castle_stables').length, 1);
  assert.equal(h.movePoints, mp + 400);
  // next day (same week): still there and included in the day's movement
  startNewDay(s);
  assert.equal(h.temp.length, 1);
  assert.equal(h.movePoints, h.maxMovePoints);
  assert.equal(h.maxMovePoints, mp + 400);
  // new week: expires, and since he still stands in the town he gets a fresh one
  leaveTown(s, h.id);
  while (s.date.day !== 1) startNewDay(s);
  assert.equal(h.temp.length, 0);
  assert.equal(h.maxMovePoints, mp);
});

effect('player_hero_bonus', 'collected per player, same building in two towns does not stack', () => {
  const s = setup();
  town(s, { buildings: ['village_hall', 'shipyard', 'castle_lighthouse'] });
  assert.deepEqual(getPlayerTownBonuses(s, 0).map((b) => [b.type, b.value]), [['movement_sea', 500]]);
  town(s, { buildings: ['village_hall', 'shipyard', 'castle_lighthouse'], pos: { x: 9, y: 9, z: 0 } });
  assert.equal(getPlayerTownBonuses(s, 0).length, 1);
  town(s, { buildings: ['village_hall', 'castle_grail'], pos: { x: 12, y: 12, z: 0 } });
  town(s, { faction: 'factory', buildings: ['village_hall', 'factory_grail'], pos: { x: 15, y: 15, z: 0 } });
  const all = getPlayerTownBonuses(s, 0).map((b) => `${b.type}:${b.value}`).sort();
  assert.deepEqual(all, ['mana_regen:3', 'morale:1', 'morale:2', 'movement_sea:500']);
  assert.deepEqual(getPlayerTownBonuses(s, 1), []);
  const rampart = town(s, { owner: 1, faction: 'rampart', buildings: ['village_hall', 'rampart_grail'], pos: { x: 3, y: 15, z: 0 } });
  assert.deepEqual(getPlayerTownBonuses(s, 1).map((b) => [b.type, b.value]), [['luck', 2]]);
  captureTown(s, rampart.id, 0);
  assert.deepEqual(getPlayerTownBonuses(s, 1), [], 'gone with the town');
});

effect('recruit_heroes', 'tavern (and Pub) let the owner hire a hero for 2500 gold', () => {
  const s = setup({ poor: true });
  setResources(s, 0, { gold: 3000 });
  const noTavern = town(s, { buildings: ['village_hall'] });
  ensureTavernPool(s, 0);
  assert.equal(hireHero(s, noTavern.id, 0).error, 'no_tavern');
  const pub = town(s, { faction: 'cove', buildings: ['village_hall', 'cove_pub'], pos: { x: 9, y: 9, z: 0 } });
  const r = hireHero(s, pub.id, 0);
  assert.equal(r.ok, true);
  assert.equal(s.players[0].resources.gold, 500);
  assert.equal(pub.visitingHero, r.heroId);
});

effect('thieves_guild', 'information level = sum over towns; rows unlock by level', () => {
  const s = setup();
  assert.equal(getThievesGuildLevel(s, 0), 0);
  assert.ok(getThievesGuildInfo(s, 0).rows.every((r) => !r.unlocked && r.ranking === null));
  town(s);
  town(s, { owner: 1, pos: { x: 9, y: 9, z: 0 }, buildings: ['village_hall'] });
  town(s, { owner: 1, pos: { x: 12, y: 9, z: 0 }, buildings: ['village_hall'] });
  assert.equal(getThievesGuildLevel(s, 0), 1);
  let info = getThievesGuildInfo(s, 0);
  assert.equal(info.level, 1);
  const row = (id) => info.rows.find((r) => r.id === id);
  assert.deepEqual(row('towns').ranking, [[1], [0]]);
  assert.deepEqual(row('heroes').ranking, [[0, 1]], 'ties share a rank');
  assert.equal(row('gold').unlocked, false);
  town(s, { faction: 'cove', buildings: ['village_hall', 'cove_pub'], pos: { x: 15, y: 15, z: 0 } });
  assert.equal(getThievesGuildLevel(s, 0), 4);
  s.players[0].resources.gold = 5;
  info = getThievesGuildInfo(s, 0);
  assert.deepEqual(row('gold').ranking, [[1], [0]]);
  assert.equal(row('artifacts').unlocked, true);
  assert.equal(row('army').unlocked, false);
  assert.equal(getThievesGuildLevel(s, 1), 0);
});

effect('sells_war_machine', 'blacksmith stock per faction, Ballista Yard, slot rules', () => {
  const s = setup({ poor: true });
  setResources(s, 0, { gold: 10000 });
  const castle = town(s, { buildings: ['village_hall', 'blacksmith'] });
  assert.deepEqual(getWarMachinesForSale(s, castle.id), [{ machineId: 'ballista', cost: 2500 }]);
  assert.equal(buyWarMachine(s, castle.id, 'ballista').error, 'no_hero');
  const h = hero(s, 'orrin', 0, castle.id);
  assert.equal(buyWarMachine(s, castle.id, 'ammo_cart').error, 'not_sold_here');
  assert.equal(buyWarMachine(s, castle.id, 'ballista').ok, true);
  assert.equal(s.players[0].resources.gold, 7500);
  assert.ok(getWarMachines(h).includes('ballista'));
  assert.equal(buyWarMachine(s, castle.id, 'ballista').error, 'slot_occupied');
  assert.equal(s.players[0].resources.gold, 7500);
  leaveTown(s, h.id);
  const stronghold = town(s, { faction: 'stronghold', buildings: ['village_hall', 'blacksmith'], pos: { x: 9, y: 9, z: 0 } });
  assert.deepEqual(getWarMachinesForSale(s, stronghold.id), [{ machineId: 'ammo_cart', cost: 1000 }]);
  setResources(s, 0, { gold: 7500, wood: 5 });
  buildAll(s, stronghold.id, ['stronghold_ballista_yard']);
  setResources(s, 0, { gold: 7500 });
  assert.deepEqual(getWarMachinesForSale(s, stronghold.id).map((o) => o.machineId), ['ammo_cart', 'ballista']);
  visitTown(s, h.id, stronghold.id);
  const gold = s.players[0].resources.gold;
  assert.equal(buyWarMachine(s, stronghold.id, 'ammo_cart').ok, true);
  assert.equal(s.players[0].resources.gold, gold - 1000);
  setResources(s, 0, { gold: 100 });
  leaveTown(s, h.id);
  const factory = town(s, { faction: 'factory', buildings: ['village_hall', 'blacksmith'], pos: { x: 13, y: 13, z: 0 } });
  assert.deepEqual(getWarMachinesForSale(s, factory.id).map((o) => o.machineId), ['ballista', 'ammo_cart', 'first_aid_tent']);
  visitTown(s, h.id, factory.id);
  assert.equal(buyWarMachine(s, factory.id, 'first_aid_tent').error, 'not_enough_resources');
  const cove = town(s, { faction: 'cove', buildings: ['village_hall', 'blacksmith'], pos: { x: 16, y: 16, z: 0 } });
  assert.deepEqual(getWarMachinesForSale(s, cove.id), [{ machineId: 'cannon', cost: 4000 }]);
});

effect('trade_resources', 'every building with the effect counts as one marketplace', () => {
  const withEffect = BUILDINGS.filter((b) => getBuildingEffects(b.id, b.faction === 'common' ? 'castle' : b.faction).some((e) => e.type === 'trade_resources'));
  assert.deepEqual(withEffect.map((b) => b.id), ['marketplace']);
  // behaviour: tests/game/economy.test.js (marketTrade / countMarketplaces)
});

effect('trade_creatures_for_resources', "Freelancer's Guild sells stacks at the freelancer rate", () => {
  const s = setup({ poor: true });
  const t = town(s, { faction: 'stronghold', buildings: ['village_hall', 'marketplace'] });
  const h = hero(s, 'orrin', 0, t.id);
  h.army = [{ creatureId: 'pikeman', count: 100 }, { creatureId: 'angel', count: 2 }, null, null, null, null, null];
  assert.equal(sellCreatures(s, t.id, { slot: 0, resource: 'wood' }).error, 'no_freelancers_guild');
  buildAll(s, t.id, ['stronghold_freelancers_guild']);
  setResources(s, 0, {});
  // one marketplace = 30 % efficiency: 14 pikemen (60 gold) buy 1 wood; 100 -> 7 lots = 98 pikemen
  let r = sellCreatures(s, t.id, { slot: 0, resource: 'wood' });
  assert.equal(r.ok, true);
  assert.deepEqual([h.army[0].count, s.players[0].resources.wood], [2, 7]);
  assert.equal(sellCreatures(s, t.id, { slot: 0, resource: 'wood' }).error, 'not_enough_creatures');
  // one 3000-gold creature gives 900 gold
  r = sellCreatures(s, t.id, { slot: 1, count: 1, resource: 'gold' });
  assert.equal(s.players[0].resources.gold, 900);
  assert.equal(h.army[1].count, 1);
  r = sellCreatures(s, t.id, { slot: 0, count: 2, resource: 'gold' });
  assert.equal(s.players[0].resources.gold, 900 + 2 * 18);
  assert.equal(h.army[0], null);
  assert.equal(sellCreatures(s, t.id, { slot: 1, resource: 'gold' }).error, 'last_stack');
  assert.equal(sellCreatures(s, t.id, { slot: 3, resource: 'gold' }).error, 'empty_slot');
  assert.equal(sellCreatures(s, t.id, { slot: 1, count: 5, resource: 'gold' }).error, 'bad_count');
  // garrison troops (no garrison hero) may be sold to the last
  t.garrison[0] = { creatureId: 'angel', count: 1 };
  assert.equal(sellCreatures(s, t.id, { where: 'garrison', slot: 0, resource: 'gold' }).ok, true);
  assert.equal(t.garrison[0], null);
});

effect('sells_artifacts', 'Artifact Merchants: one shared stock, buy to backpack, sell, monthly restock', () => {
  const s = setup({ poor: true });
  const t = town(s, { faction: 'tower', buildings: ['village_hall', 'marketplace'] });
  assert.deepEqual(getMerchantStock(s), []);
  assert.deepEqual(getArtifactMerchantOffers(s, t.id), []);
  setResources(s, 0, { gold: 1000000, wood: 10000 });
  buildAll(s, t.id, ['tower_artifact_merchants']);
  const stock = () => getMerchantStock(s);
  assert.equal(stock().length, 7);
  assert.deepEqual(stock().map((id) => getArtifact(id).class), ARTIFACT_MERCHANT_SLOTS);
  assert.equal(new Set(stock()).size, 7, 'no duplicates');
  // a second Merchants (other faction, other player even) offers the very same stock
  const first = [...stock()];
  const t2 = town(s, { faction: 'dungeon', owner: 1, buildings: ['village_hall', 'marketplace', 'dungeon_artifact_merchants'], pos: { x: 9, y: 9, z: 0 } });
  assert.deepEqual(stock(), first, 'building another Merchants does not re-roll');
  assert.deepEqual(getArtifactMerchantOffers(s, t2.id).map((o) => o.artifactId), first);
  const offers = getArtifactMerchantOffers(s, t.id);
  const art = getArtifact(stock()[0]);
  assert.equal(offers[0].prices.gold, artifactBuyPrice(art.cost, 'gold', 1));
  assert.equal(offers[0].prices.gold, Math.floor(art.cost / 0.2 + 0.5), 'efficiency 20 % with one marketplace');
  assert.equal(buyArtifact(s, t.id, 0).error, 'no_hero');
  const h = hero(s, 'solmyr', 0, t.id);
  const gold = s.players[0].resources.gold;
  let r = buyArtifact(s, t.id, 0);
  assert.equal(r.ok, true);
  assert.equal(s.players[0].resources.gold, gold - offers[0].prices.gold);
  assert.deepEqual(h.artifacts.backpack, [art.id]);
  assert.equal(stock()[0], null);
  assert.equal(getArtifactMerchantOffers(s, t.id)[0], null);
  assert.equal(getArtifactMerchantOffers(s, t2.id)[0], null, 'sold out in every town');
  assert.equal(buyArtifact(s, t.id, 0).error, 'sold_out');
  const wood = s.players[0].resources.wood;
  r = buyArtifact(s, t.id, 1, 'wood');
  assert.equal(r.ok, true);
  assert.equal(s.players[0].resources.wood, wood - offers[1].prices.wood);
  setResources(s, 0, { gold: 10 });
  assert.equal(buyArtifact(s, t.id, 2).error, 'not_enough_resources');
  // sell
  r = sellArtifact(s, t.id, art.id);
  assert.equal(r.ok, true);
  assert.equal(s.players[0].resources.gold, 10 + artifactSellPrice(art.cost, 'gold', 1));
  assert.equal(ownsArtifact(h, art.id), false);
  assert.equal(sellArtifact(s, t.id, art.id).error, 'not_found');
  assert.equal(sellArtifact(s, t.id, 'spellbook').error, 'not_tradable');
  assert.equal(sellArtifact(s, t.id, 'catapult').error, 'not_tradable');
  giveArtifact(h, 'grail');
  assert.equal(sellArtifact(s, t.id, 'grail').error, 'not_tradable');
  // restock on day 1 of a month only, once for all towns
  startOfWeekTown(s, t.id);
  assert.equal(stock()[0], null);
  s.turn += 28;
  startOfMonthTown(s, t.id);
  assert.ok(stock().every(Boolean));
  const rolled = [...stock()];
  startOfMonthTown(s, t2.id);
  assert.deepEqual(stock(), rolled, 'not re-rolled for the second town');
});

effect('sacrifice_altar', 'Grotto: creatures give hp x count experience, artifacts cost / 2', () => {
  const s = setup();
  const t = town(s, { faction: 'cove', buildings: ['village_hall', 'marketplace'] });
  const h = hero(s, 'orrin', 0, t.id);
  h.army = [{ creatureId: 'pikeman', count: 30 }, { creatureId: 'archer', count: 5 }, null, null, null, null, null];
  assert.equal(sacrificeCreatures(s, t.id, { slot: 0, count: 10 }).error, 'no_altar');
  buildAll(s, t.id, ['cove_grotto']);
  let r = sacrificeCreatures(s, t.id, { slot: 0, count: 10 });
  assert.equal(r.ok, true);
  assert.equal(h.exp, 100, '10 pikemen x 10 hp');
  assert.equal(h.army[0].count, 20);
  sacrificeCreatures(s, t.id, { slot: 0 });
  assert.equal(h.exp, 300);
  assert.equal(h.army[0], null);
  assert.equal(sacrificeCreatures(s, t.id, { slot: 1 }).error, 'last_stack');
  giveArtifact(h, 'endless_purse_of_gold', { toBackpack: true });
  const value = getArtifact('endless_purse_of_gold').cost;
  r = sacrificeArtifact(s, t.id, 'endless_purse_of_gold');
  assert.equal(r.ok, true);
  assert.equal(h.exp, 300 + Math.floor(value / 2));
  assert.equal(ownsArtifact(h, 'endless_purse_of_gold'), false);
  assert.equal(sacrificeArtifact(s, t.id, 'spellbook').error, 'not_found');
  assert.equal(sacrificeArtifact(s, t.id, 'catapult').error, 'not_tradable');
});

effect('mage_guild', 'each level is rolled when built: 5/4/3/2/1 distinct spells of that level', () => {
  const s = setup();
  const t = town(s, { faction: 'rampart' });
  assert.equal(getMageGuildLevel(t), 0);
  const sizes = [5, 4, 3, 2, 1];
  for (let level = 1; level <= 5; level++) {
    buildAll(s, t.id, [`mage_guild_${level}`]);
    assert.equal(getMageGuildLevel(t), level);
    assert.deepEqual(t.mageGuild.map((l) => l.length), sizes.map((n, i) => (i < level ? n : 0)));
    const spells = t.mageGuild[level - 1];
    assert.equal(new Set(spells).size, spells.length);
    for (const id of spells) {
      assert.equal(getSpell(id).level, level);
      assert.ok(guildSpellPool('rampart', level).some((x) => x.id === id), `${id} allowed in a rampart guild`);
    }
  }
  const first = t.mageGuild[0].slice();
  startOfWeekTown(s, t.id);
  assert.deepEqual(t.mageGuild[0], first, 'never re-rolled');
});

effect('mana_restore', 'a hero starting the day in a town with a mage guild has full mana', () => {
  const s = setup();
  const t = town(s, { buildings: ['village_hall', 'mage_guild_1'] });
  const plain = town(s, { buildings: ['village_hall'], pos: { x: 9, y: 9, z: 0 } });
  const a = hero(s, 'adelaide', 0, t.id);
  const b = hero(s, 'adela', 0, plain.id);
  const g = hero(s, 'caitlin', 0);
  t.garrisonHero = g.id;
  g.townId = t.id;
  for (const h of [a, b, g]) h.mana = 0;
  const maxA = deps.getMaxMana(s, a);
  startNewDay(s);
  assert.equal(a.mana, maxA, 'visiting hero');
  assert.equal(g.mana, deps.getMaxMana(s, g), 'garrison hero');
  assert.equal(b.mana, 1, 'no guild: only the natural regeneration');
  a.mana = maxA + 7;
  startOfDayTown(s, t.id);
  assert.equal(a.mana, maxA + 7, 'never lowers mana');
});

effect('mana_double', 'Mana Vortex: mana = 2 x maximum, once per week per town', () => {
  const s = setup();
  const t = town(s, { faction: 'dungeon', buildings: ['village_hall', 'mage_guild_1', 'dungeon_mana_vortex'] });
  const a = hero(s, 'adelaide', 0);
  const b = hero(s, 'adela', 0);
  const maxA = deps.getMaxMana(s, a);
  let r = visitTown(s, a.id, t.id);
  assert.ok(r.events.some((e) => e.type === 'mana_doubled'));
  assert.equal(a.mana, 2 * maxA);
  leaveTown(s, a.id);
  b.mana = 0;
  r = visitTown(s, b.id, t.id);
  assert.ok(!r.events.some((e) => e.type === 'mana_doubled'), 'used up this week');
  assert.equal(b.mana, 0);
  // the hero standing inside on day 1 of the next week gets it
  do startNewDay(s); while (s.date.day !== 1);
  assert.equal(b.mana, 2 * deps.getMaxMana(s, b));
  // Factory's Mana Generator is the same effect
  const f = town(s, { faction: 'factory', buildings: ['village_hall', 'mage_guild_1', 'factory_mana_generator'], pos: { x: 9, y: 9, z: 0 } });
  a.mana = 3;
  visitTown(s, a.id, f.id);
  assert.equal(a.mana, 2 * maxA);
});

effect('library_extra_spell', 'Library: 6/5/4/3/2 spells, also for levels built before it', () => {
  const s = setup();
  const t = town(s, { faction: 'tower', buildings: ['village_hall', 'mage_guild_2'] });
  assert.deepEqual(t.mageGuild.map((l) => l.length), [5, 4, 0, 0, 0]);
  const before = t.mageGuild.map((l) => l.slice());
  buildAll(s, t.id, ['tower_library']);
  assert.deepEqual(t.mageGuild.map((l) => l.length), [6, 5, 0, 0, 0]);
  assert.deepEqual(t.mageGuild[0].slice(0, 5), before[0], 'existing spells kept');
  assert.equal(new Set(t.mageGuild[0]).size, 6);
  buildAll(s, t.id, ['mage_guild_3', 'mage_guild_4', 'mage_guild_5']);
  assert.deepEqual(t.mageGuild.map((l) => l.length), [6, 5, 4, 3, 2]);
  assert.equal(getGuildSlots(t, 5), 2);
  const ready = town(s, { faction: 'tower', buildings: ['village_hall', 'mage_guild_1', 'tower_library'], pos: { x: 9, y: 9, z: 0 } });
  assert.equal(ready.mageGuild[0].length, 6);
});

effect('all_spells', 'Aurora Borealis: every built level holds every spell of that level', () => {
  const s = setup();
  const t = town(s, { faction: 'conflux', buildings: ['village_hall', 'mage_guild_2'] });
  const h = hero(s, 'orrin', 0, t.id);
  giveArtifact(h, 'grail');
  assert.equal(build(s, t.id, 'conflux_grail').ok, true);
  assert.deepEqual(t.mageGuild[0].slice().sort(), guildSpellPool('conflux', 1).map((x) => x.id).sort());
  assert.equal(t.mageGuild[1].length, guildSpellPool('conflux', 2).length);
  assert.equal(t.mageGuild[2].length, 0, 'level 3 not built yet');
  buildAll(s, t.id, ['mage_guild_3', 'mage_guild_4', 'mage_guild_5']);
  for (let l = 3; l <= 5; l++) assert.equal(t.mageGuild[l - 1].length, guildSpellPool('conflux', l).length);
});

effect('weekly_resource_random', 'Mystic Pond: 1-4 of one random rare resource per week', () => {
  const s = setup({ poor: true });
  town(s, { faction: 'rampart', buildings: ['village_hall', 'rampart_mystic_pond'] });
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    setResources(s, 0, {});
    const r = applyWeeklyTownResources(s, 0);
    const ev = r.events.filter((e) => e.type === 'weekly_resource');
    assert.equal(ev.length, 1);
    assert.ok(['mercury', 'sulfur', 'crystal', 'gems'].includes(ev[0].resource), 'never wood / ore / gold');
    assert.ok(ev[0].amount >= 1 && ev[0].amount <= 4);
    assert.equal(s.players[0].resources[ev[0].resource], ev[0].amount);
    assert.equal(s.players[0].resources.gold, 0);
    seen.add(ev[0].resource);
  }
  assert.equal(seen.size, 4, 'all four rare resources turn up');
  // only on day 1 of a week
  setResources(s, 0, {});
  s.settings.forceWeekEvent = { kind: 'normal' };
  let weekly = 0;
  for (let d = 0; d < 14; d++) weekly += startNewDay(s).events.filter((e) => e.type === 'weekly_resource').length;
  assert.equal(weekly, 2);
});

effect('gold_interest', 'Dwarven Treasury 10 % of the gold held at the start of the week', () => {
  const s = setup({ poor: true });
  const t = town(s, { faction: 'rampart', buildings: ['village_hall', 'rampart_dwarven_treasury'] });
  setResources(s, 0, { gold: 12345 });
  const r = applyWeeklyTownResources(s, 0);
  assert.deepEqual(r.events, [{ type: 'gold_interest', playerId: 0, percent: 10, amount: 1234 }]);
  assert.equal(s.players[0].resources.gold, 13579);
  // Factory Bank: 5 %, percentages of several buildings add up
  town(s, { faction: 'factory', buildings: ['town_hall', 'tavern', 'marketplace', 'factory_bank'], pos: { x: 9, y: 9, z: 0 } });
  setResources(s, 0, { gold: 1000 });
  applyWeeklyTownResources(s, 0);
  assert.equal(s.players[0].resources.gold, 1150);
  // in the game loop: interest is computed before the day's income, once a week
  setResources(s, 0, { gold: 10000 });
  s.settings.forceWeekEvent = { kind: 'normal' };
  let interest = 0;
  for (let d = 0; d < 7; d++) interest += startNewDay(s).events.filter((e) => e.type === 'gold_interest').length;
  assert.equal(interest, 1);
  assert.equal(t.owner, 0);
});

effect('skeleton_transform', 'everything becomes skeletons (hydras too), dragons bone dragons', () => {
  assert.equal(skeletonTransformResult('pikeman'), 'skeleton');
  assert.equal(skeletonTransformResult('arch_angel'), 'skeleton');
  for (const d of ['green_dragon', 'gold_dragon', 'red_dragon', 'black_dragon', 'azure_dragon', 'ghost_dragon', 'faerie_dragon', 'rust_dragon', 'crystal_dragon']) {
    assert.equal(skeletonTransformResult(d), 'bone_dragon', d);
  }
  for (const d of ['hydra', 'chaos_hydra', 'wyvern', 'firebird']) assert.equal(skeletonTransformResult(d), 'skeleton', d);
  for (const d of ['skeleton', 'skeleton_warrior', 'bone_dragon', 'ballista']) assert.equal(skeletonTransformResult(d), null, d);
  const s = setup();
  const t = town(s, { faction: 'necropolis', buildings: ['fort', 'necropolis_dwelling_1'] });
  t.garrison[0] = { creatureId: 'pikeman', count: 40 };
  t.garrison[1] = { creatureId: 'skeleton', count: 10 };
  t.garrison[2] = { creatureId: 'green_dragon', count: 2 };
  assert.equal(transformToSkeletons(s, t.id, { where: 'garrison', slot: 0 }).error, 'no_skeleton_transformer');
  buildAll(s, t.id, ['necropolis_skeleton_transformer']);
  const gold = s.players[0].resources.gold;
  assert.equal(transformToSkeletons(s, t.id, { where: 'garrison', slot: 1 }).error, 'nothing_to_transform');
  assert.equal(transformToSkeletons(s, t.id, { where: 'garrison', slot: 0 }).ok, true);
  assert.equal(t.garrison[0], null, 'merged into the existing skeleton stack');
  assert.deepEqual(t.garrison[1], { creatureId: 'skeleton', count: 50 });
  assert.equal(transformToSkeletons(s, t.id, { where: 'garrison', slot: 2 }).ok, true);
  assert.deepEqual(t.garrison[2], { creatureId: 'bone_dragon', count: 2 });
  assert.equal(s.players[0].resources.gold, gold, 'free of charge');
  assert.equal(transformToSkeletons(s, t.id, { where: 'garrison', slot: 5 }).error, 'empty_slot');
  assert.equal(transformToSkeletons(s, t.id, { where: 'visiting', slot: 0 }).error, 'no_hero');
  const h = hero(s, 'orrin', 0, t.id);
  h.army = [{ creatureId: 'pikeman', count: 7 }, null, null, null, null, null, null];
  assert.equal(transformToSkeletons(s, t.id, { slot: 0 }).ok, true);
  assert.deepEqual(h.army[0], { creatureId: 'skeleton', count: 7 });
});

effect('town_gate', 'Castle Gate teleports the visiting hero between own Infernos', () => {
  const s = setup();
  const gate = ['citadel', 'inferno_castle_gate'];
  const a = town(s, { faction: 'inferno', buildings: gate, pos: { x: 2, y: 2, z: 0 } });
  const b = town(s, { faction: 'inferno', buildings: gate, pos: { x: 17, y: 17, z: 0 } });
  const noGate = town(s, { faction: 'inferno', buildings: ['citadel'], pos: { x: 10, y: 10, z: 0 } });
  const enemy = town(s, { owner: 1, faction: 'inferno', buildings: gate, pos: { x: 2, y: 17, z: 0 } });
  assert.equal(useCastleGate(s, a.id, b.id).error, 'no_hero');
  const h = hero(s, 'orrin', 0, a.id);
  assert.deepEqual(getCastleGateDestinations(s, a.id), [b.id]);
  assert.equal(useCastleGate(s, a.id, noGate.id).error, 'bad_destination');
  assert.equal(useCastleGate(s, a.id, enemy.id).error, 'bad_destination');
  assert.equal(useCastleGate(s, noGate.id, a.id).error, 'no_castle_gate');
  const mp = h.movePoints;
  const r = useCastleGate(s, a.id, b.id);
  assert.equal(r.ok, true);
  assert.deepEqual([a.visitingHero, b.visitingHero, h.townId], [null, h.id, b.id]);
  assert.deepEqual(h.pos, b.pos);
  assert.equal(h.movePoints, mp, 'costs no movement');
  const h2 = hero(s, 'edric', 0, a.id);
  assert.deepEqual(getCastleGateDestinations(s, a.id), [], 'destination occupied');
  assert.equal(useCastleGate(s, a.id, b.id).error, 'bad_destination');
  assert.equal(h2.townId, a.id);
});

effect('shipyard', 'buildBoat places a boat on the first free water tile for 1000 gold + 10 wood', () => {
  const s = setup({ poor: true });
  const t = town(s, { pos: { x: 5, y: 5, z: 0 } });
  setResources(s, 0, { gold: 5000, wood: 50 });
  assert.equal(buildBoat(s, t.id).error, 'no_shipyard');
  s.map.tiles[0][6][5].t = 'water';
  s.map.tiles[0][6][4].t = 'water';
  buildAll(s, t.id, ['shipyard']);
  setResources(s, 0, { gold: 2500, wood: 25 });
  let r = buildBoat(s, t.id);
  assert.equal(r.ok, true);
  assert.deepEqual(r.events[0].pos, { x: 5, y: 6, z: 0 }, 'tile below the entrance first');
  assert.deepEqual([s.players[0].resources.gold, s.players[0].resources.wood], [1500, 15]);
  const boat = s.map.objects[s.map.tiles[0][6][5].obj];
  assert.equal(boat.defId, 'boat');
  r = buildBoat(s, t.id);
  assert.deepEqual(r.events[0].pos, { x: 4, y: 6, z: 0 }, 'then clockwise');
  assert.equal(buildBoat(s, t.id).error, 'boat_exists');
  assert.deepEqual([s.players[0].resources.gold, s.players[0].resources.wood], [500, 5]);
  deps.removeObject(s, boat.id);
  assert.equal(buildBoat(s, t.id).error, 'not_enough_resources');
  // water occupied by something else
  const t2 = town(s, { pos: { x: 15, y: 15, z: 0 }, buildings: ['village_hall', 'shipyard'] });
  s.map.tiles[0][16][15].t = 'water';
  s.map.tiles[0][16][15].blocked = true;
  assert.equal(buildBoat(s, t2.id).error, 'no_free_water');
});

effect('reveal_map', 'Lookout Tower reveals radius 20 (on build and capture), Skyship the whole map', () => {
  const s = setup({ width: 60, height: 60 });
  const t = town(s, { faction: 'tower', pos: { x: 30, y: 30, z: 0 } });
  const at = (pid, x, y) => deps.isExplored(s, pid, { x, y, z: 0 });
  assert.equal(getTownSightRadius(t), 5);
  assert.equal(at(0, 30, 34), true, 'normal town sight');
  assert.equal(at(0, 30, 45), false);
  buildAll(s, t.id, ['tower_lookout_tower']);
  assert.equal(getTownSightRadius(t), 20);
  assert.equal(at(0, 30, 45), true);
  assert.equal(at(0, 49, 30), true);
  assert.equal(at(0, 30, 55), false);
  assert.equal(at(1, 30, 45), false);
  captureTown(s, t.id, 1);
  assert.equal(at(1, 30, 45), true, 'new owner sees the surroundings');
  assert.equal(at(1, 2, 2), false);
  const h = hero(s, 'solmyr', 1, t.id);
  giveArtifact(h, 'grail');
  s.currentPlayer = 1; // town actions belong to the player whose turn it is
  assert.equal(build(s, t.id, 'tower_grail').ok, true);
  assert.ok(s.players[1].explored[0].every((v) => v === 1), 'Skyship reveals everything');
  assert.ok(s.players[0].explored[0].some((v) => v === 0));
});

effect('fog_cover', 'Cover of Darkness re-shrouds 20 tiles around the town for other players', () => {
  const s = setup({ width: 60, height: 60 });
  const t = town(s, { faction: 'necropolis', pos: { x: 30, y: 30, z: 0 }, buildings: ['fort', 'necropolis_cover_of_darkness'] });
  const scout = hero(s, 'orrin', 1);
  scout.pos = { x: 30, y: 44, z: 0 };
  for (const pid of [0, 1]) deps.revealAround(s, pid, { x: 30, y: 30, z: 0 }, 100);
  const at = (pid, x, y) => deps.isExplored(s, pid, { x, y, z: 0 });
  const r = applyFogCover(s);
  assert.deepEqual(r.events, [{ type: 'fog_cover', townId: t.id, playerId: 1, radius: 20 }]);
  assert.equal(at(1, 30, 30), false, 'town itself hidden');
  assert.equal(at(1, 30, 12), false);
  assert.equal(at(1, 12, 30), false);
  assert.equal(at(1, 30, 5), true, 'outside the radius');
  assert.equal(at(1, 30, 42), true, 'inside, but in sight of his hero');
  assert.equal(at(0, 30, 30), true, 'owner unaffected');
  // applied by the daily tick
  deps.revealAround(s, 1, { x: 30, y: 30, z: 0 }, 100);
  startNewDay(s);
  assert.equal(at(1, 30, 30), false);
});

effect('necromancy_bonus', 'Amplifier +10 % per town (stacking), Soul Prison +20 %', () => {
  const s = setup();
  const amp = ['village_hall', 'mage_guild_1', 'necropolis_necromancy_amplifier'];
  town(s, { faction: 'necropolis', buildings: amp });
  const sum = () => getPlayerTownBonuses(s, 0).filter((b) => b.type === 'necromancy_percent').reduce((n, b) => n + b.percent, 0);
  assert.equal(sum(), 10);
  town(s, { faction: 'necropolis', buildings: amp, pos: { x: 9, y: 9, z: 0 } });
  assert.equal(sum(), 20);
  town(s, { faction: 'necropolis', buildings: ['village_hall', 'necropolis_grail'], pos: { x: 13, y: 13, z: 0 } });
  assert.equal(sum(), 40);
});

effect('teach_skill', 'Magic University sells Basic magic schools for 2000 gold', () => {
  const s = setup({ poor: true });
  const t = town(s, { faction: 'conflux', buildings: ['village_hall', 'mage_guild_1'] });
  const h = hero(s, 'orrin', 0, t.id);
  setResources(s, 0, { gold: 100000, wood: 100, ore: 100 });
  assert.equal(learnUniversitySkill(s, t.id, 'fire_magic').error, 'not_taught_here');
  buildAll(s, t.id, ['conflux_magic_university']);
  setResources(s, 0, { gold: 4500 });
  assert.equal(learnUniversitySkill(s, t.id, 'wisdom').error, 'not_taught_here');
  let r = learnUniversitySkill(s, t.id, 'fire_magic');
  assert.equal(r.ok, true);
  assert.deepEqual(h.skills.find((x) => x.id === 'fire_magic'), { id: 'fire_magic', level: 1 });
  assert.equal(s.players[0].resources.gold, 2500);
  assert.equal(learnUniversitySkill(s, t.id, 'fire_magic').error, 'already_known');
  assert.equal(learnUniversitySkill(s, t.id, 'air_magic').ok, true);
  assert.equal(learnUniversitySkill(s, t.id, 'water_magic').error, 'not_enough_resources');
  setResources(s, 0, { gold: 100000 });
  h.skills = ['archery', 'armorer', 'ballistics', 'diplomacy', 'estates', 'leadership', 'logistics', 'luck'].map((id) => ({ id, level: 1 }));
  assert.equal(learnUniversitySkill(s, t.id, 'earth_magic').error, 'no_skill_slot');
  leaveTown(s, h.id);
  assert.equal(learnUniversitySkill(s, t.id, 'earth_magic').error, 'no_hero');
});

effect('portal_of_summoning', 'weekly pick of a flagged external dwelling, recruit at normal cost', () => {
  const s = setup({ poor: true });
  const t = town(s, { faction: 'dungeon', buildings: ['fort', 'dungeon_portal_of_summoning'] });
  assert.equal(t.portal, null, 'no flagged dwellings: empty');
  deps.addObject(s, 'griffin_tower', { x: 15, y: 15, z: 0 }, { owner: 0 });
  deps.addObject(s, 'barracks', { x: 17, y: 15, z: 0 }, { owner: 1 });
  startOfWeekTown(s, t.id);
  assert.deepEqual(t.portal, { creatureId: 'griffin', count: 7 });
  setResources(s, 0, { gold: 1000 });
  assert.equal(recruit(s, t.id, 'griffin', 8, 'garrison').error, 'not_enough_creatures');
  assert.equal(recruit(s, t.id, 'griffin', 6, 'garrison').error, 'not_enough_resources');
  assert.equal(recruit(s, t.id, 'griffin', 5, 'garrison').ok, true);
  assert.equal(s.players[0].resources.gold, 0);
  assert.deepEqual(t.portal, { creatureId: 'griffin', count: 2 });
  assert.deepEqual(t.garrison[0], { creatureId: 'griffin', count: 5 });
  startOfWeekTown(s, t.id);
  assert.equal(t.portal.count, 7, 'refilled, not accumulated');
  // built later
  const t2 = town(s, { faction: 'dungeon', pos: { x: 9, y: 9, z: 0 } });
  setResources(s, 0, { gold: 100000, wood: 100, ore: 100 });
  buildAll(s, t2.id, ['dungeon_portal_of_summoning']);
  assert.equal(t2.portal.creatureId, 'griffin');
  captureTown(s, t.id, 1);
  assert.deepEqual(t.portal, { creatureId: 'swordsman', count: 4 }, 're-rolled for the new owner');
});

effect('escape_tunnel', 'defending hero may retreat from a siege only with the tunnel', () => {
  const s = setup();
  const t = town(s, { faction: 'stronghold' });
  assert.deepEqual([getSiegeInfo(s, t.id).escapeTunnel, getSiegeInfo(s, t.id).canRetreat], [false, false]);
  buildAll(s, t.id, ['stronghold_escape_tunnel']);
  assert.deepEqual([getSiegeInfo(s, t.id).escapeTunnel, getSiegeInfo(s, t.id).canRetreat], [true, true]);
});

effect('week_of_creature', 'Deity of Fire: +15 imps every week in that town only', () => {
  const s = setup();
  const t = town(s, { faction: 'inferno', buildings: ['castle', 'inferno_dwelling_1', 'inferno_dwelling_2', 'inferno_grail'] });
  const other = town(s, { faction: 'inferno', buildings: ['castle', 'inferno_dwelling_1'], pos: { x: 9, y: 9, z: 0 } });
  // imp: (15 base + 15 castle) + 50 % grail of that = 45, + 15 Deity of Fire = 60
  assert.equal(getTownGrowth(s, t.id).imp, 60);
  assert.equal(getTownGrowth(s, t.id).gog, 24, '(8 + 8) * 1.5');
  assert.equal(getTownGrowth(s, other.id).imp, 30);
  buildAll(s, t.id, ['inferno_dwelling_1_up']);
  assert.equal(getTownGrowth(s, t.id).familiar, 60, 'upgraded dwelling too');
  s.weekOf = { kind: 'week_of', creatureId: 'imp' };
  assert.equal(getTownGrowth(s, t.id).familiar, 65, 'stacks with the global week of the imp');
});

effect('native_terrain_all', 'Lodestar: all terrain is native for the owner\'s Cove creatures', () => {
  const s = setup();
  assert.equal(hasNativeTerrainAll(s, 0, 'cove'), false);
  const t = town(s, { faction: 'cove', buildings: ['village_hall', 'cove_grail'] });
  assert.equal(hasNativeTerrainAll(s, 0, 'cove'), true);
  assert.equal(hasNativeTerrainAll(s, 0, 'castle'), false);
  assert.equal(hasNativeTerrainAll(s, 1, 'cove'), false);
  captureTown(s, t.id, 1);
  assert.deepEqual([hasNativeTerrainAll(s, 0, 'cove'), hasNativeTerrainAll(s, 1, 'cove')], [false, true]);
});

effect('grail', 'every faction grail: marker, +5000 gold, +50 % growth', () => {
  for (const faction of FACTIONS) {
    const s = setup();
    assert.equal(playerHasGrailBuilding(s, 0), false);
    const plain = town(s, { faction, buildings: ['castle', `${faction}_dwelling_2`] });
    const t = town(s, { faction, buildings: ['castle', `${faction}_dwelling_2`, `${faction}_grail`], pos: { x: 9, y: 9, z: 0 } });
    assert.equal(playerHasGrailBuilding(s, 0), true, faction);
    assert.equal(playerHasGrailBuilding(s, 1), false);
    assert.equal(getTownIncome(t).gold, 5500, faction);
    const [creatureId, withGrail] = Object.entries(getTownGrowth(s, t.id))[0];
    const base = getCreature(creatureId).growth;
    assert.equal(getTownGrowth(s, plain.id)[creatureId], base * 2, faction);
    assert.equal(withGrail, base * 2 + Math.floor(base * 2 / 2), `${faction}: castle 100 %, then grail +50 % of the total`);
  }
});

test('every effect type of the closed set has a test above', () => {
  assert.deepEqual(Object.keys(EFFECT_TYPES).filter((t) => !covered.has(t)), []);
  assert.equal(Object.keys(EFFECT_TYPES).length, 34);
});
