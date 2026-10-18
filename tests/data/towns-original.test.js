// Audit (docs/audit/towns-economy.md): original SoD values of the nine classic towns, pinned
// independently of the data files - building costs, prerequisites, hordes, grails, trade tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBuilding, getBuildingEffects, BOAT_COST, TAVERN_HERO_COST, WAR_MACHINE_COST, marketRate,
  ARTIFACT_MERCHANT_SLOTS, MAGE_GUILD_SPELL_SLOTS } from '../../src/data/buildings.js';
import { getFaction } from '../../src/data/factions.js';
import { DIFFICULTIES } from '../../src/engine/economy.js';

const RES = ['gold', 'wood', 'ore', 'mercury', 'sulfur', 'crystal', 'gems'];
/** c(gold, wood, ore, mercury, sulfur, crystal, gems) without zero entries. */
const c = (...v) => Object.fromEntries(v.map((n, i) => [RES[i], n]).filter(([, n]) => n));
const SOD = ['castle', 'rampart', 'tower', 'inferno', 'necropolis', 'dungeon', 'stronghold', 'fortress', 'conflux'];

test('original: common buildings (costs and prerequisites)', () => {
  const table = {
    town_hall: [c(2500), ['tavern', 'village_hall']],
    city_hall: [c(5000), ['blacksmith', 'mage_guild_1', 'marketplace', 'town_hall']],
    capitol: [c(10000), ['castle', 'city_hall']],
    fort: [c(5000, 20, 20), []],
    citadel: [c(2500, 0, 5), ['fort']],
    castle: [c(5000, 10, 10), ['citadel']],
    tavern: [c(500, 5), []],
    blacksmith: [c(1000, 5), []],
    marketplace: [c(500, 5), []],
    resource_silo: [c(5000, 0, 5), ['marketplace']],
    mage_guild_1: [c(2000, 5, 5), []],
    mage_guild_2: [c(1000, 5, 5, 4, 4, 4, 4), ['mage_guild_1']],
    mage_guild_3: [c(1000, 5, 5, 6, 6, 6, 6), ['mage_guild_2']],
    mage_guild_4: [c(1000, 5, 5, 8, 8, 8, 8), ['mage_guild_3']],
    mage_guild_5: [c(1000, 5, 5, 10, 10, 10, 10), ['mage_guild_4']],
    shipyard: [c(2000, 20), []],
  };
  for (const [id, [cost, req]] of Object.entries(table)) {
    assert.deepEqual(getBuilding(id).cost, cost, id);
    assert.deepEqual([...getBuilding(id).requires].sort(), req, id);
  }
  const income = (id) => getBuildingEffects(id, 'castle').find((e) => e.type === 'resource_income').value;
  assert.deepEqual(['village_hall', 'town_hall', 'city_hall', 'capitol'].map(income), [500, 1000, 2000, 4000]);
  assert.deepEqual(BOAT_COST, { gold: 1000, wood: 10 });
  assert.equal(TAVERN_HERO_COST, 2500);
  assert.deepEqual(WAR_MACHINE_COST, { ballista: 2500, ammo_cart: 1000, first_aid_tent: 750, cannon: 4000 });
  assert.deepEqual(ARTIFACT_MERCHANT_SLOTS, ['treasure', 'treasure', 'treasure', 'minor', 'minor', 'minor', 'major']);
  assert.deepEqual(MAGE_GUILD_SPELL_SLOTS, [5, 4, 3, 2, 1]);
});

test('original: faction properties (guild cap, blacksmith, silo, shipyard)', () => {
  const t = {
    castle: [4, ['ballista'], ['wood', 'ore'], true],
    rampart: [5, ['first_aid_tent'], ['crystal'], false],
    tower: [5, ['ammo_cart'], ['gems'], false],
    inferno: [5, ['ammo_cart'], ['mercury'], false],
    necropolis: [5, ['first_aid_tent'], ['wood', 'ore'], true],
    dungeon: [5, ['ballista'], ['sulfur'], false],
    stronghold: [3, ['ammo_cart'], ['wood', 'ore'], false],
    fortress: [3, ['first_aid_tent'], ['wood', 'ore'], true],
    conflux: [5, ['ballista'], ['mercury'], true],
  };
  for (const [f, [guild, smith, silo, ship]] of Object.entries(t)) {
    const fac = getFaction(f);
    assert.deepEqual([fac.mageGuildMax, fac.warMachines, fac.siloResources, fac.hasShipyard], [guild, smith, silo, ship], f);
  }
});

test('original: base dwelling costs of the nine SoD towns', () => {
  const t = {
    castle: [c(500, 0, 10), c(1000, 5, 5), c(1000, 0, 5), c(2000, 0, 5), c(3000, 5, 5, 2, 2, 2, 2), c(5000, 20), c(20000, 0, 0, 10, 10, 10, 10)],
    rampart: [c(500, 10), c(1000, 5), c(1500, 10), c(2000, 0, 0, 0, 0, 10), c(2500), c(4000, 5, 5, 0, 0, 0, 10), c(10000, 0, 30, 0, 0, 20)],
    tower: [c(300, 5, 5), c(1000, 0, 10), c(2000, 5, 5), c(2500, 5, 5, 5, 5, 5, 5), c(3000, 5, 5, 0, 0, 6, 6), c(4000, 5, 5, 2, 2, 2, 2), c(5000, 10, 10, 0, 0, 0, 10)],
    inferno: [c(300, 5, 5), c(1000, 0, 5), c(1500, 10), c(2000, 5, 5), c(3000), c(4000, 0, 10, 3, 3, 3, 3), c(15000, 10, 10, 20, 20)],
    necropolis: [c(400, 5, 5), c(1000, 0, 5), c(1500, 5, 5), c(2000, 5, 5), c(2000, 0, 10, 0, 10), c(6000, 10, 10), c(10000, 5, 5, 5, 5, 5, 5)],
    dungeon: [c(400, 10), c(1000), c(1000, 1, 1, 1, 1, 1, 1), c(2000, 5, 10), c(4000, 0, 10, 0, 0, 0, 10), c(5000, 5, 5, 5, 5), c(15000, 15, 15, 0, 20)],
    stronghold: [c(200, 5, 5), c(1000, 10, 5), c(1000, 5, 5), c(2000, 20), c(2500, 0, 10), c(3500, 0, 20, 0, 0, 20), c(10000, 10, 10, 0, 0, 10)],
    fortress: [c(400, 10), c(1000, 5), c(1000, 5, 0, 2, 2), c(2000, 5, 10), c(2500, 10, 0, 5, 5), c(3500, 15), c(10000, 10, 10, 0, 10)],
    conflux: [c(300, 5, 5), c(1500, 0, 5), c(1500, 0, 5), c(2000, 5, 5), c(2000, 0, 10), c(3000, 5, 5, 2, 2, 2, 2), c(10000, 10, 10, 10)],
  };
  for (const f of SOD) {
    t[f].forEach((cost, i) => assert.deepEqual(getBuilding(`${f}_dwelling_${i + 1}`).cost, cost, `${f} tier ${i + 1}`));
    assert.deepEqual(getBuilding(`${f}_dwelling_1`).requires, ['fort'], `${f}: tier 1 needs the fort`);
  }
  // tier-7 upgrades
  const up7 = {
    castle: c(20000, 0, 0, 10, 10, 10, 10), rampart: c(20000, 0, 30, 0, 0, 20), tower: c(25000, 5, 5, 0, 0, 0, 30),
    inferno: c(20000, 5, 5, 20, 20), necropolis: c(15000, 5, 5, 20), dungeon: c(15000, 15, 15, 0, 20),
    stronghold: c(15000, 10, 10, 0, 0, 20), fortress: c(15000, 10, 10, 0, 20), conflux: c(15000, 10, 10, 20),
  };
  for (const f of SOD) assert.deepEqual(getBuilding(`${f}_dwelling_7_up`).cost, up7[f], `${f} upg. tier 7`);
});

test('original: key dwelling prerequisites', () => {
  const r = (id) => [...getBuilding(id).requires].sort();
  const t = {
    castle_dwelling_3: ['castle_dwelling_4'],
    castle_dwelling_4: ['blacksmith', 'castle_dwelling_1'],
    castle_dwelling_6: ['castle_stables'],
    rampart_dwelling_6: ['rampart_dwelling_4', 'rampart_dwelling_5'],
    rampart_dwelling_7: ['mage_guild_2', 'rampart_dwelling_6'],
    tower_dwelling_4: ['mage_guild_1', 'tower_dwelling_2', 'tower_dwelling_3'],
    tower_dwelling_7: ['tower_dwelling_5', 'tower_dwelling_6'],
    inferno_dwelling_7: ['inferno_dwelling_5', 'inferno_dwelling_6'],
    necropolis_dwelling_5: ['mage_guild_1', 'necropolis_dwelling_2'],
    dungeon_dwelling_7: ['dungeon_dwelling_5', 'dungeon_dwelling_6', 'mage_guild_2'],
    stronghold_dwelling_3_up: ['blacksmith', 'stronghold_dwelling_3'],
    conflux_dwelling_2: ['conflux_dwelling_1', 'mage_guild_1'],
  };
  for (const [id, req] of Object.entries(t)) assert.deepEqual(r(id), req, id);
});

test('original: special buildings, hordes and grails', () => {
  const costs = {
    castle_lighthouse: c(2000, 0, 10), castle_stables: c(2000, 10), castle_brotherhood_of_the_sword: c(500, 5), castle_griffin_bastion: c(1000),
    rampart_mystic_pond: c(2000, 2, 2, 2, 2, 2, 2), rampart_fountain_of_fortune: c(1500, 0, 0, 0, 0, 10), rampart_miners_guild: c(1000),
    rampart_dwarven_treasury: c(5000, 5), rampart_dendroid_saplings: c(2000),
    tower_library: c(1500, 5, 5, 5, 5, 5, 5), tower_lookout_tower: c(1000, 5), tower_wall_of_knowledge: c(1000, 0, 5),
    tower_artifact_merchants: c(10000), tower_sculptors_wings: c(1000),
    inferno_castle_gate: c(10000, 5, 5), inferno_order_of_fire: c(1000, 5), inferno_birthing_pools: c(1000), inferno_cages: c(1000),
    necropolis_necromancy_amplifier: c(1000), necropolis_skeleton_transformer: c(1000), necropolis_unearthed_graves: c(1000),
    dungeon_mana_vortex: c(1000), dungeon_portal_of_summoning: c(2500, 0, 5), dungeon_battle_scholar_academy: c(1000, 5, 5),
    dungeon_artifact_merchants: c(10000), dungeon_mushroom_rings: c(1000),
    stronghold_escape_tunnel: c(2000, 5, 5), stronghold_freelancers_guild: c(1000), stronghold_ballista_yard: c(1000, 5),
    stronghold_hall_of_valhalla: c(1000), stronghold_mess_hall: c(1000),
    fortress_cage_of_warlords: c(1000), fortress_glyphs_of_fear: c(1000), fortress_blood_obelisk: c(1000), fortress_captains_quarters: c(1000),
    conflux_magic_university: c(5000, 10, 10), conflux_garden_of_life: c(1000), conflux_artifact_merchants: c(10000),
  };
  for (const [id, cost] of Object.entries(costs)) assert.deepEqual(getBuilding(id).cost, cost, id);
  const eff = (id, type) => getBuilding(id).effects.find((e) => e.type === type);
  // effects with original numbers
  assert.equal(eff('rampart_dwarven_treasury', 'gold_interest').percent, 10);
  assert.deepEqual(eff('rampart_mystic_pond', 'weekly_resource_random'), { type: 'weekly_resource_random', min: 1, max: 4, resources: ['mercury', 'sulfur', 'crystal', 'gems'] });
  assert.equal(eff('rampart_fountain_of_fortune', 'garrison_bonus').value, 2);
  assert.equal(eff('castle_lighthouse', 'player_hero_bonus').bonus.value, 500);
  assert.equal(eff('necropolis_necromancy_amplifier', 'necromancy_bonus').percent, 10);
  assert.equal(eff('dungeon_battle_scholar_academy', 'visit_bonus').value, 1000);
  assert.deepEqual(['stronghold_hall_of_valhalla', 'fortress_cage_of_warlords', 'inferno_order_of_fire', 'tower_wall_of_knowledge']
    .map((id) => [eff(id, 'visit_bonus').stat, eff(id, 'visit_bonus').value]),
  [['attack', 1], ['defense', 1], ['power', 1], ['knowledge', 1]]);
  assert.deepEqual(['fortress_glyphs_of_fear', 'fortress_blood_obelisk', 'inferno_brimstone_stormclouds']
    .map((id) => [eff(id, 'garrison_bonus').stat, eff(id, 'garrison_bonus').value]),
  [['defense', 2], ['attack', 2], ['power', 2]]);
  assert.equal(eff('conflux_magic_university', 'teach_skill').cost, 2000);
  // grails: +5000 gold, +50 % of the whole growth, and the faction effect
  for (const f of SOD) {
    const g = getBuilding(`${f}_grail`);
    assert.equal(eff(g.id, 'resource_income').value, 5000, f);
    assert.deepEqual(eff(g.id, 'growth_percent'), { type: 'growth_percent', percent: 50, ofTotal: true }, f);
  }
  const garrisonOf = (id) => getBuilding(id).effects.filter((e) => e.type === 'garrison_bonus').map((e) => [e.stat, e.value]);
  assert.deepEqual(garrisonOf('tower_grail'), [['knowledge', 15]]);
  assert.deepEqual(garrisonOf('dungeon_grail'), [['power', 12]]);
  assert.deepEqual(garrisonOf('stronghold_grail'), [['attack', 20]]);
  assert.deepEqual(garrisonOf('fortress_grail'), [['attack', 10], ['defense', 10]]);
  assert.deepEqual(eff('castle_grail', 'player_hero_bonus').bonus, { type: 'morale', value: 2 });
  assert.deepEqual(eff('rampart_grail', 'player_hero_bonus').bonus, { type: 'luck', value: 2 });
  assert.equal(eff('necropolis_grail', 'necromancy_bonus').percent, 20);
  assert.deepEqual(eff('inferno_grail', 'week_of_creature'), { type: 'week_of_creature', creatureId: 'imp', growthBonus: 15 });
  assert.ok(eff('conflux_grail', 'all_spells'));
  assert.equal(eff('tower_grail', 'reveal_map').all, true);
});

test('original: starting resources by difficulty and score multipliers', () => {
  const r = (g, wo, rare) => ({ gold: g, wood: wo, ore: wo, mercury: rare, sulfur: rare, crystal: rare, gems: rare });
  assert.deepEqual(DIFFICULTIES.map((d) => d.human), [r(30000, 30, 15), r(20000, 20, 10), r(15000, 15, 7), r(10000, 10, 4), r(0, 0, 0)]);
  assert.deepEqual(DIFFICULTIES.map((d) => d.ratingPercent), [80, 100, 130, 160, 200]);
  assert.ok(DIFFICULTIES.every((d) => d.aiIncomePercent === 100), 'no AI income cheat in SoD');
});

test('original: marketplace table at 1 / 5 / 9 marketplaces', () => {
  const row = (n) => [marketRate('wood', 'gold', n).get, marketRate('gems', 'gold', n).get, marketRate('gold', 'wood', n).give,
    marketRate('gold', 'gems', n).give, marketRate('wood', 'ore', n).give, marketRate('wood', 'gems', n).give, marketRate('gems', 'wood', n).give];
  assert.deepEqual(row(1), [25, 50, 2500, 5000, 10, 20, 5]);
  assert.deepEqual(row(5), [75, 150, 833, 1667, 3, 7, 2]);
  assert.deepEqual(row(9), [125, 250, 500, 1000, 2, 4, 1]);
});
