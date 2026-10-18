import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTIONS, RESOURCES } from '../../src/core/constants.js';
import {
  buildingsForFaction, getBuilding, startingBuildings, isBuilt, totalCost, dwellingsForFaction,
} from '../../src/data/buildings.js';
import { getCreature } from '../../src/data/creatures.js';
import { giveArtifact, ownsArtifact } from '../../src/engine/artifacts.js';
import {
  createTown, canBuild, build, buildInTown, getAvailableBuildings, getTownGrowth, startOfDayTown,
  getMageGuildLevel, townHasWater, getTownWaterTiles, captureTown,
} from '../../src/engine/town.js';
import { setup, town, hero, setResources, buildAll } from './fixture.js';

test('createTown: main / other starting sets, stock = one week of growth, registered with the owner', () => {
  const s = setup();
  const main = createTown(s, { faction: 'castle', owner: 0, pos: { x: 3, y: 3, z: 0 } });
  assert.deepEqual(main.buildings, startingBuildings('castle', 'main'));
  assert.equal(main.role, 'main');
  assert.deepEqual(main.stock, { pikeman: 14 });
  assert.deepEqual(s.players[0].towns, [main.id]);
  assert.equal(s.towns[main.id], main);
  assert.ok(main.name.length > 0);
  assert.equal(main.garrison.length, 7);
  assert.deepEqual(main.mageGuild, [[], [], [], [], []], 'no guild built, nothing rolled');
  const second = createTown(s, { faction: 'tower', owner: 0, pos: { x: 9, y: 3, z: 0 } });
  assert.deepEqual(second.buildings, startingBuildings('tower', 'other'));
  assert.equal(second.role, 'other');
  assert.deepEqual(second.stock, { gremlin: 16 });
  const neutral = createTown(s, { faction: 'inferno', pos: { x: 15, y: 3, z: 0 } });
  assert.equal(neutral.owner, null);
  assert.deepEqual(neutral.buildings, startingBuildings('inferno', 'other'));
  assert.notEqual(main.name, createTown(s, { faction: 'castle', owner: 1, pos: { x: 3, y: 9, z: 0 } }).name, 'unique names');
  assert.equal(createTown(s, { faction: 'castle', pos: { x: 1, y: 1, z: 0 }, name: 'Xanadu' }).name, 'Xanadu');
});

test('createTown: explicit buildings are normalised (chains, village hall) and guild rolled', () => {
  const s = setup();
  const t = createTown(s, {
    faction: 'castle', owner: 0, pos: { x: 3, y: 3, z: 0 },
    buildings: ['fort', 'citadel', 'castle', 'mage_guild_1', 'mage_guild_2', 'castle_dwelling_1', 'castle_dwelling_1_up'],
  });
  assert.deepEqual(t.buildings.slice().sort(), ['castle', 'castle_dwelling_1_up', 'mage_guild_2', 'village_hall'].sort());
  assert.deepEqual(t.mageGuild.map((l) => l.length), [5, 4, 0, 0, 0]);
  assert.deepEqual(t.stock, { halberdier: 28 }, 'castle doubles the base growth');
  assert.throws(() => createTown(s, { faction: 'castle', pos: { x: 1, y: 1, z: 0 }, buildings: ['tower_library'] }));
  assert.throws(() => createTown(s, { faction: 'atlantis', pos: { x: 1, y: 1, z: 0 } }));
});

test('build: rejection reasons in the documented order', () => {
  const s = setup({ poor: true });
  setResources(s, 0, { gold: 100000, wood: 100, ore: 100, mercury: 100, sulfur: 100, crystal: 100, gems: 100 });
  const t = town(s);
  // 1 not_available
  assert.equal(canBuild(s, t.id, 'tower_library').error, 'not_available');
  assert.equal(canBuild(s, t.id, 'mage_guild_5').error, 'not_available', 'castle guild cap is 4');
  const rampart = town(s, { faction: 'rampart', pos: { x: 12, y: 12, z: 0 } });
  assert.equal(canBuild(s, rampart.id, 'shipyard').error, 'not_available', 'rampart has no shipyard');
  // 2 already_built (also through a successor)
  assert.equal(canBuild(s, t.id, 'fort').error, 'already_built');
  assert.equal(canBuild(s, t.id, 'village_hall').error, 'already_built');
  // 4 missing_requirements
  const miss = canBuild(s, t.id, 'city_hall');
  assert.equal(miss.error, 'missing_requirements');
  assert.deepEqual(miss.missing.sort(), ['blacksmith', 'mage_guild_1', 'marketplace', 'town_hall']);
  // 5 no_water (map is all grass)
  assert.equal(canBuild(s, t.id, 'shipyard').error, 'no_water');
  // 8 not_enough_resources
  setResources(s, 0, { gold: 499, wood: 5 });
  assert.equal(canBuild(s, t.id, 'marketplace').error, 'not_enough_resources');
  setResources(s, 0, { gold: 500, wood: 4 });
  assert.equal(build(s, t.id, 'marketplace').error, 'not_enough_resources');
  // success: pays exactly the cost
  setResources(s, 0, { gold: 1500, wood: 12 });
  const r = build(s, t.id, 'marketplace');
  assert.equal(r.ok, true);
  assert.equal(r.events[0].type, 'building_built');
  assert.deepEqual([s.players[0].resources.gold, s.players[0].resources.wood], [1000, 7]);
  assert.ok(t.buildings.includes('marketplace'));
  // 3 built_this_turn comes before missing requirements and resources
  assert.equal(t.builtThisTurn, true);
  assert.equal(canBuild(s, t.id, 'blacksmith').error, 'built_this_turn');
  assert.equal(canBuild(s, t.id, 'capitol').error, 'built_this_turn');
  assert.equal(canBuild(s, t.id, 'marketplace').error, 'already_built', 'already_built precedes built_this_turn');
  startOfDayTown(s, t.id);
  assert.equal(t.builtThisTurn, false);
  assert.equal(build(s, t.id, 'blacksmith').ok, true);
  assert.equal(buildInTown, build);
  assert.equal(build(s, 'nope', 'fort').error, 'no_such_town');
  assert.throws(() => canBuild(s, t.id, 'no_such_building'));
});

test('build: neutral towns cannot build; owner with pending choices is blocked', () => {
  const s = setup();
  const n = town(s, { owner: null });
  assert.equal(build(s, n.id, 'tavern').error, 'not_owned');
  const t = town(s, { pos: { x: 9, y: 9, z: 0 } });
  s.pending.push({ id: 1, playerId: 0, kind: 'x', options: [] });
  assert.equal(build(s, t.id, 'marketplace').error, 'pending');
  s.pending = [];
  assert.equal(build(s, t.id, 'marketplace').ok, true);
});

test('upgrades replace their predecessor and requirements accept successors', () => {
  const s = setup();
  const t = town(s);
  buildAll(s, t.id, ['citadel']);
  assert.ok(!t.buildings.includes('fort') && t.buildings.includes('citadel'));
  assert.ok(isBuilt(t.buildings, 'fort'));
  buildAll(s, t.id, ['castle_dwelling_1_up']);
  assert.ok(!t.buildings.includes('castle_dwelling_1'));
  // castle_dwelling_2 requires castle_dwelling_1: satisfied by the upgrade
  assert.equal(canBuild(s, t.id, 'castle_dwelling_2').ok, true);
  buildAll(s, t.id, ['town_hall']);
  assert.ok(!t.buildings.includes('village_hall'));
  assert.equal(t.buildings.filter((b) => getBuilding(b).kind === 'hall').length, 1);
});

test('a new dwelling adds one base growth to the stock; upgraded dwelling keeps the base stock', () => {
  const s = setup();
  const t = town(s);
  assert.deepEqual(t.stock, { pikeman: 14 });
  buildAll(s, t.id, ['castle_dwelling_2']);
  assert.equal(t.stock.archer, 9);
  buildAll(s, t.id, ['castle_dwelling_1_up']);
  assert.deepEqual([t.stock.pikeman, t.stock.halberdier], [14, 14]);
  assert.deepEqual(getTownGrowth(s, t.id), { halberdier: 14, archer: 9 });
});

test('capitol: one per player; a captured second capitol is downgraded to a city hall', () => {
  const s = setup();
  const full = ['capitol', 'castle', 'tavern', 'marketplace', 'blacksmith', 'mage_guild_1'];
  const a = town(s, { buildings: ['city_hall', 'castle', 'tavern', 'marketplace', 'blacksmith', 'mage_guild_1'] });
  const b = town(s, { pos: { x: 10, y: 10, z: 0 }, buildings: ['city_hall', 'castle', 'tavern', 'marketplace', 'blacksmith', 'mage_guild_1'] });
  assert.equal(build(s, a.id, 'capitol').ok, true);
  assert.equal(canBuild(s, b.id, 'capitol').error, 'capitol_exists');
  assert.equal(build(s, b.id, 'capitol').error, 'capitol_exists');
  // the other player may have his own
  const c = town(s, { owner: 1, pos: { x: 15, y: 15, z: 0 }, buildings: full });
  assert.ok(c.buildings.includes('capitol'));
  // player 0 captures it: downgraded
  const r = captureTown(s, c.id, 0);
  assert.equal(r.ok, true);
  assert.ok(r.events.some((e) => e.type === 'capitol_downgraded'));
  assert.ok(c.buildings.includes('city_hall') && !c.buildings.includes('capitol'));
  assert.ok(a.buildings.includes('capitol'));
  // player 1 (no capitol) captures player 0's capitol: it stays
  captureTown(s, a.id, 1);
  assert.ok(a.buildings.includes('capitol'));
  // and now player 0 can build one in b
  assert.equal(canBuild(s, b.id, 'capitol').ok, true);
});

test('shipyard / lighthouse need water next to the town', () => {
  const s = setup();
  const t = town(s, { pos: { x: 5, y: 5, z: 0 } });
  assert.equal(townHasWater(s, t), false);
  s.map.tiles[0][7][5].t = 'water';
  s.map.tiles[0][6][6].t = 'water';
  assert.equal(townHasWater(s, t), true);
  assert.deepEqual(getTownWaterTiles(s, t), [{ x: 6, y: 6, z: 0 }, { x: 5, y: 7, z: 0 }], 'ring 1 before ring 2');
  assert.equal(build(s, t.id, 'shipyard').ok, true);
  t.builtThisTurn = false;
  assert.equal(build(s, t.id, 'castle_lighthouse').ok, true);
  const dry = town(s, { pos: { x: 15, y: 15, z: 0 } });
  assert.equal(canBuild(s, dry.id, 'shipyard').error, 'no_water');
  dry.coastal = true;
  assert.equal(canBuild(s, dry.id, 'shipyard').ok, true, 'coastal flag overrides the map check');
});

test('grail: needs a hero inside carrying the Grail, consumes it, exempt from the daily limit', () => {
  const s = setup();
  const t = town(s);
  assert.equal(canBuild(s, t.id, 'castle_grail').error, 'no_grail');
  const h = hero(s, 'orrin', 0, t.id);
  assert.equal(canBuild(s, t.id, 'castle_grail').error, 'no_grail');
  assert.equal(giveArtifact(h, 'grail').ok, true);
  assert.equal(build(s, t.id, 'marketplace').ok, true);
  assert.equal(t.builtThisTurn, true);
  const r = build(s, t.id, 'castle_grail');
  assert.equal(r.ok, true, 'allowed on a day something else was built');
  assert.equal(ownsArtifact(h, 'grail'), false, 'grail consumed');
  assert.ok(t.buildings.includes('castle_grail'));
  assert.equal(canBuild(s, t.id, 'castle_grail').error, 'already_built');
  // grail does not use up the day's build either
  const t2 = town(s, { pos: { x: 12, y: 12, z: 0 } });
  const h2 = hero(s, 'edric', 0, t2.id);
  giveArtifact(h2, 'grail');
  assert.equal(build(s, t2.id, 'castle_grail').ok, true);
  assert.equal(t2.builtThisTurn, false);
  assert.equal(build(s, t2.id, 'marketplace').ok, true);
  assert.equal(build(s, t2.id, 'blacksmith').error, 'built_this_turn');
});

test('grail may be delivered by the garrison hero', () => {
  const s = setup();
  const t = town(s, { faction: 'tower' });
  const h = hero(s, 'solmyr', 0);
  t.garrisonHero = h.id;
  h.townId = t.id;
  giveArtifact(h, 'grail');
  assert.equal(build(s, t.id, 'tower_grail').ok, true);
});

test('getAvailableBuildings lists every faction building with a status', () => {
  const s = setup();
  const t = town(s);
  const list = getAvailableBuildings(s, t.id);
  assert.equal(list.length, buildingsForFaction('castle').length);
  const by = Object.fromEntries(list.map((b) => [b.id, b]));
  assert.equal(by.fort.status, 'built');
  assert.equal(by.village_hall.status, 'built');
  assert.equal(by.marketplace.status, 'available');
  assert.equal(by.town_hall.status, 'available');
  assert.equal(by.capitol.status, 'blocked');
  assert.equal(by.capitol.error, 'missing_requirements');
  assert.ok(by.capitol.missing.includes('city_hall'));
  assert.equal(by.castle_grail.error, 'no_grail');
  assert.equal(by.shipyard.error, 'no_water');
  assert.ok(!by.tower_library && !by.mage_guild_5);
});

/** Greedy legal order: every day build the first building whose rules pass. */
function walkTree(s, t, wanted) {
  const order = [];
  const left = new Set(wanted);
  for (let day = 0; day < 200 && left.size; day++) {
    startOfDayTown(s, t.id);
    const id = [...left].find((b) => canBuild(s, t.id, b).ok);
    assert.ok(id, `stuck in ${t.faction}; left: ${[...left].join(', ')}`);
    assert.equal(build(s, t.id, id).ok, true);
    left.delete(id);
    if (!getBuilding(id).requiresGrail) {
      for (const other of left) {
        if (!getBuilding(other).requiresGrail) assert.equal(canBuild(s, t.id, other).error, 'built_this_turn', 'one building per day');
      }
    }
    order.push(id);
  }
  return order;
}

for (const faction of FACTIONS) {
  test(`full build tree walk: ${faction}`, () => {
    const s = setup();
    const t = createTown(s, { faction, owner: 0, pos: { x: 5, y: 5, z: 0 } });
    t.coastal = true;
    const h = hero(s, 'orrin', 0, t.id);
    giveArtifact(h, 'grail');
    const all = buildingsForFaction(faction);
    const wanted = all.map((b) => b.id).filter((id) => !isBuilt(t.buildings, id));
    const before = { ...s.players[0].resources };
    const order = walkTree(s, t, wanted);
    assert.equal(order.length, wanted.length);
    // everything stands (newest of each chain) and nothing replaced is left
    for (const b of all) assert.ok(isBuilt(t.buildings, b.id), `${b.id} built`);
    for (const id of t.buildings) {
      assert.ok(!all.some((x) => x.replaces === id && t.buildings.includes(x.id)), `${id} should have been replaced`);
    }
    assert.equal(new Set(t.buildings).size, t.buildings.length);
    // the money spent is exactly the sum of the costs
    const cost = totalCost(wanted);
    for (const r of RESOURCES) assert.equal(before[r] - s.players[0].resources[r], cost[r] || 0, `${r} spent`);
    // all dwellings upgraded, top hall / fort / guild
    for (const d of dwellingsForFaction(faction).filter((b) => b.dwelling.upgraded)) assert.ok(t.buildings.includes(d.id));
    assert.ok(t.buildings.includes('capitol') && t.buildings.includes('castle'));
    assert.equal(getMageGuildLevel(t), all.reduce((m, b) => Math.max(m, b.mageGuildLevel || 0), 0));
    assert.ok(t.buildings.includes(`${faction}_grail`));
    // every recruitable creature of the final town grows
    const growth = getTownGrowth(s, t.id);
    for (const d of dwellingsForFaction(faction).filter((b) => b.dwelling.upgraded)) {
      assert.ok(growth[d.dwelling.creatureId] >= getCreature(d.dwelling.creatureId).growth * 2, `${d.dwelling.creatureId} grows`);
    }
    JSON.stringify(s);
  });
}
