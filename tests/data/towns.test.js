import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTIONS, RESOURCES, TERRAINS } from '../../src/core/constants.js';
import { FACTIONS_DATA, FACTION_BY_ID, getFaction, factionCreatureIds, factionOfCreature } from '../../src/data/factions.js';
import {
  BUILDINGS, BUILDING_BY_ID, getBuilding, buildingsForFaction, getBuildingEffects, EFFECT_TYPES,
  isBuilt, missingRequirements, checkBuildable, applyBuild, successorsOf, predecessorsOf,
  dwellingsForFaction, hordesForTier, grailOf, startingBuildings, STARTING_BUILDINGS,
  BUILDS_PER_DAY, CAPITOL_UNIQUE_PER_PLAYER, UNIQUE_PER_PLAYER_BUILDINGS, MAGE_GUILD_SPELL_SLOTS,
  marketEfficiency, marketRate, freelancerRate, freelancerEfficiency, FREELANCER_EFFICIENCY, artifactBuyPrice, artifactSellPrice,
  SKELETON_TRANSFORMER, TAVERN_HERO_COST, TAVERN_POOL_SIZE, totalCost,
} from '../../src/data/buildings.js';

const KINDS = ['hall', 'fort', 'dwelling', 'mage_guild', 'market', 'tavern', 'blacksmith', 'horde', 'special', 'grail', 'shipyard', 'silo'];
const COMMON_IDS = ['village_hall', 'town_hall', 'city_hall', 'capitol', 'fort', 'citadel', 'castle', 'tavern',
  'blacksmith', 'marketplace', 'resource_silo', 'mage_guild_1', 'mage_guild_2', 'mage_guild_3', 'mage_guild_4',
  'mage_guild_5', 'shipyard'];
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

// ---------------------------------------------------------------- factions

test('factions: all 11 present, in constants order, with lookup', () => {
  assert.deepEqual(FACTIONS_DATA.map((f) => f.id), FACTIONS);
  for (const id of FACTIONS) assert.equal(getFaction(id), FACTION_BY_ID[id]);
  assert.throws(() => getFaction('nope'));
});

test('factions: schema', () => {
  const allCreatures = new Set();
  const allNames = new Set();
  for (const f of FACTIONS_DATA) {
    assert.ok(f.name, f.id);
    assert.ok(['good', 'evil', 'neutral'].includes(f.alignment), f.id);
    assert.ok(TERRAINS.includes(f.nativeTerrain), `${f.id} terrain`);
    assert.equal(f.heroClasses.length, 2);
    for (const c of f.heroClasses) assert.match(c, SNAKE);
    assert.equal(f.creatures.length, 7);
    for (const pair of f.creatures) {
      assert.equal(pair.length, 2);
      for (const c of pair) {
        assert.match(c, SNAKE);
        assert.ok(!allCreatures.has(c), `duplicate creature ${c}`);
        allCreatures.add(c);
      }
    }
    assert.ok(f.townNames.length >= 16, `${f.id} town names`);
    assert.equal(new Set(f.townNames).size, f.townNames.length);
    for (const n of f.townNames) { assert.ok(!allNames.has(n), `duplicate town name ${n}`); allNames.add(n); }
    assert.match(f.color, /^#[0-9a-f]{6}$/);
    assert.ok(f.warMachines.length >= 1);
    for (const r of f.siloResources) assert.ok(RESOURCES.includes(r) && r !== 'gold');
    assert.ok(f.siege.moat === null || f.siege.moat.damage > 0);
    assert.ok(Array.isArray(f.rules));
  }
  assert.equal(new Set(FACTIONS_DATA.flatMap((f) => f.heroClasses)).size, 22);
});

test('factions: mage guild caps and known facts', () => {
  const caps = Object.fromEntries(FACTIONS_DATA.map((f) => [f.id, f.mageGuildMax]));
  assert.equal(caps.castle, 4);
  assert.equal(caps.stronghold, 3);
  assert.equal(caps.fortress, 3);
  for (const id of ['rampart', 'tower', 'inferno', 'necropolis', 'dungeon', 'conflux', 'factory']) assert.equal(caps[id], 5);
  assert.deepEqual(getFaction('castle').creatures[0], ['pikeman', 'halberdier']);
  assert.deepEqual(getFaction('castle').creatures[6], ['angel', 'arch_angel']);
  assert.deepEqual(getFaction('rampart').creatures[2], ['wood_elf', 'grand_elf']);
  assert.deepEqual(getFaction('tower').creatures[0], ['gremlin', 'master_gremlin']);
  assert.deepEqual(getFaction('castle').heroClasses, ['knight', 'cleric']);
  assert.equal(getFaction('tower').siege.moat, null);
  assert.ok(getFaction('tower').siege.mines.damage > 0);
  assert.equal(getFaction('inferno').siege.moat.damage, 90);
  assert.equal(getFaction('castle').siege.moat.damage, 70);
  assert.equal(factionOfCreature('black_dragon'), 'dungeon');
  assert.equal(factionOfCreature('juggernaut'), 'factory');
  assert.equal(factionOfCreature('peasant'), null);
  assert.equal(factionCreatureIds('factory').length, 16);
  assert.equal(factionCreatureIds('castle').length, 14);
});

// ---------------------------------------------------------------- buildings: structure

test('buildings: unique snake_case ids, lookup, schema', () => {
  assert.equal(new Set(BUILDINGS.map((b) => b.id)).size, BUILDINGS.length);
  for (const b of BUILDINGS) {
    assert.match(b.id, SNAKE);
    assert.equal(getBuilding(b.id), b);
    assert.equal(BUILDING_BY_ID[b.id], b);
    assert.ok(b.name && b.description, `${b.id} name/description`);
    assert.ok(b.faction === 'common' || FACTIONS.includes(b.faction), b.id);
    assert.ok(KINDS.includes(b.kind), `${b.id} kind ${b.kind}`);
    assert.ok(Array.isArray(b.requires) && Array.isArray(b.effects), b.id);
    assert.ok(b.replaces === null || typeof b.replaces === 'string', b.id);
    if (b.faction !== 'common') assert.ok(b.id.startsWith(`${b.faction}_`), `${b.id} must be namespaced`);
    for (const [r, v] of Object.entries(b.cost)) {
      assert.ok(RESOURCES.includes(r), `${b.id} cost resource ${r}`);
      assert.ok(Number.isInteger(v) && v > 0, `${b.id} cost ${r}`);
    }
    if (!b.startsBuilt && !b.requiresGrail) assert.ok(b.cost.gold > 0, `${b.id} must cost gold`);
  }
  assert.throws(() => getBuilding('nope'));
  assert.doesNotThrow(() => JSON.stringify(BUILDINGS));
});

test('buildings: common ids follow DESIGN.md', () => {
  const common = BUILDINGS.filter((b) => b.faction === 'common').map((b) => b.id);
  assert.deepEqual([...common].sort(), [...COMMON_IDS].sort());
});

test('buildings: requires/replaces reference buildings available to the faction', () => {
  for (const f of FACTIONS) {
    const avail = new Set(buildingsForFaction(f).map((b) => b.id));
    for (const b of buildingsForFaction(f)) {
      for (const r of b.requires) {
        assert.ok(BUILDING_BY_ID[r], `${b.id} requires unknown ${r}`);
        assert.ok(avail.has(r), `${f}: ${b.id} requires ${r} which the faction cannot build`);
        assert.notEqual(r, b.id);
      }
      if (b.replaces) {
        assert.ok(avail.has(b.replaces), `${f}: ${b.id} replaces unavailable ${b.replaces}`);
        assert.ok(b.requires.includes(b.replaces), `${b.id} must require what it replaces`);
      }
    }
  }
});

test('buildings: no prerequisite cycles; everything is reachable from an empty town', () => {
  for (const f of FACTIONS) {
    let built = [];
    const todo = new Set(buildingsForFaction(f).map((b) => b.id));
    let progress = true;
    while (progress) {
      progress = false;
      for (const id of [...todo]) {
        if (isBuilt(built, id)) { todo.delete(id); continue; }
        if (checkBuildable(built, id, f).ok) {
          built = applyBuild(built, id);
          todo.delete(id);
          progress = true;
        }
      }
    }
    assert.deepEqual([...todo], [], `${f}: unreachable (cycle or broken requirement)`);
    // only the top of each upgrade chain remains
    const avail = new Set(buildingsForFaction(f).map((b) => b.id));
    for (const id of built) {
      assert.deepEqual(successorsOf(id).filter((s) => avail.has(s)), [id], `${f}: ${id} should have been replaced`);
    }
  }
});

test('buildings: each building is replaced by at most one upgrade', () => {
  const seen = new Set();
  for (const b of BUILDINGS) {
    if (!b.replaces) continue;
    assert.ok(!seen.has(b.replaces) || b.replaces === 'tavern', `${b.replaces} replaced twice`);
    seen.add(b.replaces);
  }
});

test('buildings: effect types come from the closed set', () => {
  const used = new Set();
  for (const f of FACTIONS) {
    for (const b of buildingsForFaction(f)) {
      for (const e of getBuildingEffects(b.id, f)) {
        assert.ok(EFFECT_TYPES[e.type], `${b.id}: unknown effect type ${e.type}`);
        used.add(e.type);
      }
    }
  }
  for (const [type, def] of Object.entries(EFFECT_TYPES)) {
    assert.ok(['passive', 'daily', 'weekly', 'visit', 'siege', 'action', 'build'].includes(def.when), type);
    assert.ok(def.description, type);
    assert.ok(used.has(type), `effect type ${type} documented but never used`);
  }
});

test('buildings: effect parameters are well formed', () => {
  const stats = ['morale', 'luck', 'attack', 'defense', 'power', 'knowledge'];
  for (const f of FACTIONS) {
    for (const b of buildingsForFaction(f)) {
      for (const e of getBuildingEffects(b.id, f)) {
        if (e.type === 'resource_income') { assert.ok(RESOURCES.includes(e.resource)); assert.ok(e.value > 0); }
        if (e.type === 'growth_percent') assert.ok(e.percent > 0);
        if (e.type === 'garrison_bonus') { assert.ok(stats.includes(e.stat), b.id); assert.ok(e.value > 0); }
        if (e.type === 'visit_bonus') { assert.ok([...stats, 'experience'].includes(e.stat), b.id); assert.ok(e.value > 0); }
        if (e.type === 'player_hero_bonus' || e.type === 'visit_temp_bonus') assert.ok(e.bonus && e.bonus.type, b.id);
        if (e.type === 'sells_war_machine') { assert.match(e.machineId, SNAKE); assert.ok(e.cost > 0); }
        if (e.type === 'creature_growth') {
          assert.deepEqual(e.creatureIds, getFaction(f).creatures[e.tier - 1], b.id);
          assert.ok(e.value > 0);
        }
      }
    }
  }
});

// ---------------------------------------------------------------- dwellings

test('dwellings: 14 per faction matching factions.js tiers and id conventions', () => {
  for (const f of FACTIONS_DATA) {
    const std = dwellingsForFaction(f.id).filter((b) => !b.dwelling.alt);
    assert.equal(std.length, 14, f.id);
    f.creatures.forEach(([base, up], i) => {
      const t = i + 1;
      const b = getBuilding(`${f.id}_dwelling_${t}`);
      const u = getBuilding(`${f.id}_dwelling_${t}_up`);
      assert.deepEqual(b.dwelling, { creatureId: base, tier: t, upgraded: false });
      assert.deepEqual(u.dwelling, { creatureId: up, tier: t, upgraded: true });
      assert.equal(b.kind, 'dwelling');
      assert.equal(b.replaces, null);
      assert.equal(u.replaces, b.id);
      assert.ok(u.requires.includes(b.id));
    });
    assert.deepEqual(getBuilding(`${f.id}_dwelling_1`).requires, ['fort'], `${f.id} tier 1 needs only the fort`);
    const alts = dwellingsForFaction(f.id).filter((b) => b.dwelling.alt);
    assert.equal(alts.length, f.altCreatures.length * 2);
    for (const a of f.altCreatures) {
      assert.equal(getBuilding(a.dwellingId).dwelling.creatureId, a.creatures[0]);
      assert.equal(getBuilding(`${a.dwellingId}_up`).dwelling.creatureId, a.creatures[1]);
      assert.equal(getBuilding(a.dwellingId).dwelling.tier, a.tier);
    }
  }
  assert.equal(dwellingsForFaction('factory').length, 16);
});

test('dwellings: a higher tier never unlocks before tier 1; tier 7 is the most expensive base dwelling', () => {
  for (const f of FACTIONS) {
    for (let t = 2; t <= 7; t++) {
      // transitive closure of requirements must contain tier 1 and the fort
      const seen = new Set();
      const stack = [`${f}_dwelling_${t}`];
      while (stack.length) for (const r of getBuilding(stack.pop()).requires) if (!seen.has(r)) { seen.add(r); stack.push(r); }
      assert.ok(seen.has(`${f}_dwelling_1`) && seen.has('fort'), `${f} tier ${t}`);
    }
    const golds = [1, 2, 3, 4, 5, 6, 7].map((t) => getBuilding(`${f}_dwelling_${t}`).cost.gold);
    assert.equal(Math.max(...golds), golds[6], `${f} tier 7 gold`);
  }
});

test('hordes: every horde targets an existing dwelling of its faction', () => {
  const expected = {
    castle: { 3: 3 }, rampart: { 2: 4, 5: 2 }, tower: { 2: 4 }, inferno: { 1: 8, 3: 3 }, necropolis: { 1: 6 },
    dungeon: { 1: 7 }, stronghold: { 1: 8 }, fortress: { 1: 6 }, conflux: { 1: 10 },
  };
  for (const [f, tiers] of Object.entries(expected)) {
    const hordes = BUILDINGS.filter((b) => b.faction === f && b.kind === 'horde');
    assert.equal(hordes.length, Object.keys(tiers).length, f);
    for (const [tier, value] of Object.entries(tiers)) {
      const [h] = hordesForTier(f, Number(tier));
      assert.ok(h, `${f} horde tier ${tier}`);
      assert.equal(h.effects[0].value, value, h.id);
      assert.ok(h.requires.includes(`${f}_dwelling_${tier}`));
    }
  }
  for (const f of FACTIONS) assert.ok(BUILDINGS.some((b) => b.faction === f && b.kind === 'horde'), `${f} has a horde`);
});

// ---------------------------------------------------------------- common chains

test('halls chain: incomes 500/1000/2000/4000, costs and requirements', () => {
  const ids = ['village_hall', 'town_hall', 'city_hall', 'capitol'];
  const incomes = ids.map((id) => getBuilding(id).effects.find((e) => e.type === 'resource_income' && e.resource === 'gold').value);
  assert.deepEqual(incomes, [500, 1000, 2000, 4000]);
  assert.deepEqual(predecessorsOf('capitol'), ['capitol', 'city_hall', 'town_hall', 'village_hall']);
  assert.deepEqual(successorsOf('village_hall'), ids);
  assert.deepEqual(getBuilding('village_hall').cost, {});
  assert.equal(getBuilding('village_hall').startsBuilt, true);
  assert.deepEqual(getBuilding('town_hall').cost, { gold: 2500 });
  assert.deepEqual(getBuilding('town_hall').requires, ['village_hall', 'tavern']);
  assert.deepEqual(getBuilding('city_hall').cost, { gold: 5000 });
  assert.deepEqual([...getBuilding('city_hall').requires].sort(), ['blacksmith', 'mage_guild_1', 'marketplace', 'town_hall']);
  assert.deepEqual(getBuilding('capitol').cost, { gold: 10000 });
  assert.deepEqual([...getBuilding('capitol').requires].sort(), ['castle', 'city_hall']);
  assert.equal(getBuilding('capitol').uniquePerPlayer, true);
  assert.equal(CAPITOL_UNIQUE_PER_PLAYER, true);
  assert.deepEqual(UNIQUE_PER_PLAYER_BUILDINGS, ['capitol']);
  assert.equal(BUILDS_PER_DAY, 1);
});

test('fort chain: costs, growth and siege levels', () => {
  assert.deepEqual(getBuilding('fort').cost, { gold: 5000, wood: 20, ore: 20 });
  assert.deepEqual(getBuilding('citadel').cost, { gold: 2500, ore: 5 });
  assert.deepEqual(getBuilding('castle').cost, { gold: 5000, wood: 10, ore: 10 });
  assert.deepEqual(successorsOf('fort'), ['fort', 'citadel', 'castle']);
  const growth = (id) => getBuilding(id).effects.filter((e) => e.type === 'growth_percent').reduce((s, e) => s + e.percent, 0);
  assert.deepEqual(['fort', 'citadel', 'castle'].map(growth), [0, 50, 100]);
  const siege = (id) => getBuilding(id).effects.find((e) => e.type === 'siege_defense');
  assert.deepEqual(['fort', 'citadel', 'castle'].map((id) => siege(id).fortLevel), [1, 2, 3]);
  assert.equal(siege('fort').moat, false);
  assert.equal(siege('fort').keep, false);
  assert.equal(siege('citadel').keep, true);
  assert.equal(siege('citadel').moat, true);
  assert.equal(siege('citadel').turrets, 0);
  assert.equal(siege('castle').turrets, 2);
  assert.ok(siege('castle').wallHp > siege('fort').wallHp);
});

test('mage guilds: costs, chain, per-faction cap, slots', () => {
  assert.deepEqual(getBuilding('mage_guild_1').cost, { gold: 2000, wood: 5, ore: 5 });
  const rare = [0, 4, 6, 8, 10];
  for (let l = 2; l <= 5; l++) {
    assert.deepEqual(getBuilding(`mage_guild_${l}`).cost,
      { gold: 1000, wood: 5, ore: 5, mercury: rare[l - 1], sulfur: rare[l - 1], crystal: rare[l - 1], gems: rare[l - 1] });
    assert.equal(getBuilding(`mage_guild_${l}`).replaces, `mage_guild_${l - 1}`);
  }
  assert.deepEqual(MAGE_GUILD_SPELL_SLOTS, [5, 4, 3, 2, 1]);
  for (const f of FACTIONS_DATA) {
    const levels = buildingsForFaction(f.id).filter((b) => b.kind === 'mage_guild').map((b) => b.mageGuildLevel);
    assert.deepEqual(levels, [1, 2, 3, 4, 5].slice(0, f.mageGuildMax), f.id);
  }
  assert.ok(isBuilt(['mage_guild_3'], 'mage_guild_1'));
  assert.ok(!isBuilt(['mage_guild_1'], 'mage_guild_2'));
});

test('other common buildings: costs and per-faction effects', () => {
  assert.deepEqual(getBuilding('tavern').cost, { gold: 500, wood: 5 });
  assert.deepEqual(getBuilding('marketplace').cost, { gold: 500, wood: 5 });
  assert.deepEqual(getBuilding('blacksmith').cost, { gold: 1000, wood: 5 });
  assert.deepEqual(getBuilding('resource_silo').cost, { gold: 5000, ore: 5 });
  assert.deepEqual(getBuilding('resource_silo').requires, ['marketplace']);
  assert.deepEqual(getBuilding('shipyard').cost, { gold: 2000, wood: 20 });
  assert.equal(TAVERN_HERO_COST, 2500);
  assert.equal(TAVERN_POOL_SIZE, 2);
  const silo = (f) => getBuildingEffects('resource_silo', f).map((e) => e.resource);
  assert.deepEqual(silo('castle'), ['wood', 'ore']);
  assert.deepEqual(silo('rampart'), ['crystal']);
  assert.deepEqual(silo('tower'), ['gems']);
  assert.deepEqual(silo('inferno'), ['mercury']);
  assert.deepEqual(silo('necropolis'), ['wood', 'ore']);
  assert.deepEqual(silo('dungeon'), ['sulfur']);
  assert.deepEqual(silo('stronghold'), ['wood', 'ore']);
  assert.deepEqual(silo('fortress'), ['wood', 'ore']);
  assert.deepEqual(silo('conflux'), ['mercury']);
  const smith = (f) => getBuildingEffects('blacksmith', f).map((e) => e.machineId);
  assert.deepEqual(smith('castle'), ['ballista']);
  assert.deepEqual(smith('rampart'), ['first_aid_tent']);
  assert.deepEqual(smith('tower'), ['ammo_cart']);
  assert.deepEqual(smith('stronghold'), ['ammo_cart']);
  assert.deepEqual(smith('cove'), ['cannon']);
  for (const f of FACTIONS) {
    assert.ok(smith(f).length >= 1, f);
    assert.ok(silo(f).length >= 1, f);
    assert.equal(buildingsForFaction(f).some((b) => b.id === 'shipyard'), getFaction(f).hasShipyard, f);
  }
  assert.deepEqual(FACTIONS.filter((f) => getFaction(f).hasShipyard), ['castle', 'necropolis', 'fortress', 'conflux', 'cove']);
});

// ---------------------------------------------------------------- specials & grails

test('grails: one per faction with +5000 gold, +50% growth and a unique effect', () => {
  const names = {
    castle: 'Colossus', rampart: 'Spirit Guardian', tower: 'Skyship', inferno: 'Deity of Fire',
    necropolis: 'Soul Prison', dungeon: 'Guardian of Earth', stronghold: "Warlords' Monument",
    fortress: 'Carnivorous Plant', conflux: 'Aurora Borealis',
  };
  for (const f of FACTIONS) {
    const grails = BUILDINGS.filter((b) => b.faction === f && b.kind === 'grail');
    assert.equal(grails.length, 1, f);
    const g = grailOf(f);
    assert.equal(g, grails[0]);
    assert.equal(g.requiresGrail, true);
    assert.deepEqual(g.cost, {});
    assert.ok(g.effects.some((e) => e.type === 'grail'));
    assert.ok(g.effects.some((e) => e.type === 'resource_income' && e.resource === 'gold' && e.value === 5000));
    assert.ok(g.effects.some((e) => e.type === 'growth_percent' && e.percent === 50));
    assert.ok(g.effects.length >= 4, `${f} grail unique effect`);
    if (names[f]) assert.equal(g.name, names[f]);
  }
});

test('specials: the original special buildings exist with the right effects', () => {
  const has = (id, type, match = {}) => {
    const e = getBuilding(id).effects.find((x) => x.type === type);
    assert.ok(e, `${id} lacks ${type}`);
    for (const [k, v] of Object.entries(match)) assert.deepEqual(e[k], v, `${id}.${k}`);
  };
  has('castle_lighthouse', 'player_hero_bonus', { bonus: { type: 'movement_sea', value: 500 } });
  has('castle_stables', 'visit_temp_bonus', { until: 'end_of_week' });
  has('castle_brotherhood_of_the_sword', 'garrison_bonus', { stat: 'morale' });
  has('castle_griffin_bastion', 'creature_growth', { value: 3 });
  has('rampart_mystic_pond', 'weekly_resource_random', { min: 1, max: 4 });
  has('rampart_fountain_of_fortune', 'garrison_bonus', { stat: 'luck', value: 2 });
  has('rampart_dwarven_treasury', 'gold_interest', { percent: 10 });
  has('tower_library', 'library_extra_spell', { value: 1 });
  has('tower_lookout_tower', 'reveal_map', { radius: 20 });
  has('tower_wall_of_knowledge', 'visit_bonus', { stat: 'knowledge', value: 1 });
  has('tower_artifact_merchants', 'sells_artifacts');
  has('tower_grail', 'reveal_map', { all: true });
  has('tower_grail', 'garrison_bonus', { stat: 'knowledge', value: 15 });
  has('inferno_castle_gate', 'town_gate');
  has('inferno_order_of_fire', 'visit_bonus', { stat: 'power', value: 1 });
  has('inferno_brimstone_stormclouds', 'garrison_bonus', { stat: 'power', value: 2 });
  has('inferno_grail', 'week_of_creature', { creatureId: 'imp' });
  has('necropolis_cover_of_darkness', 'fog_cover', { radius: 20 });
  has('necropolis_necromancy_amplifier', 'necromancy_bonus', { percent: 10 });
  has('necropolis_skeleton_transformer', 'skeleton_transform');
  has('necropolis_grail', 'necromancy_bonus', { percent: 20 });
  has('dungeon_mana_vortex', 'mana_double');
  has('dungeon_portal_of_summoning', 'portal_of_summoning');
  has('dungeon_battle_scholar_academy', 'visit_bonus', { stat: 'experience', value: 1000 });
  has('dungeon_artifact_merchants', 'sells_artifacts');
  has('dungeon_grail', 'garrison_bonus', { stat: 'power', value: 12 });
  has('stronghold_escape_tunnel', 'escape_tunnel');
  has('stronghold_freelancers_guild', 'trade_creatures_for_resources');
  has('stronghold_ballista_yard', 'sells_war_machine', { machineId: 'ballista' });
  has('stronghold_hall_of_valhalla', 'visit_bonus', { stat: 'attack', value: 1 });
  has('stronghold_grail', 'garrison_bonus', { stat: 'attack', value: 20 });
  has('fortress_cage_of_warlords', 'visit_bonus', { stat: 'defense', value: 1 });
  has('fortress_glyphs_of_fear', 'garrison_bonus', { stat: 'defense', value: 2 });
  has('fortress_blood_obelisk', 'garrison_bonus', { stat: 'attack', value: 2 });
  has('conflux_magic_university', 'teach_skill', { cost: 2000 });
  has('conflux_artifact_merchants', 'sells_artifacts');
  has('conflux_grail', 'all_spells');
  has('castle_grail', 'player_hero_bonus', { bonus: { type: 'morale', value: 2 } });
  has('rampart_grail', 'player_hero_bonus', { bonus: { type: 'luck', value: 2 } });
  has('cove_grotto', 'sacrifice_altar');
  has('cove_pub', 'recruit_heroes');
  has('factory_artifact_merchants', 'sells_artifacts');
  assert.equal(getBuilding('cove_pub').replaces, 'tavern');
  assert.ok(isBuilt(['cove_pub'], 'tavern'));
  // tavern morale: +1, Brotherhood brings the total to +2
  const morale = ['tavern', 'castle_brotherhood_of_the_sword']
    .flatMap((id) => getBuilding(id).effects).filter((e) => e.type === 'garrison_bonus' && e.stat === 'morale')
    .reduce((s, e) => s + e.value, 0);
  assert.equal(morale, 2);
});

test('spot checks of known costs and prerequisites', () => {
  const c = (id) => getBuilding(id).cost;
  const r = (id) => [...getBuilding(id).requires].sort();
  assert.deepEqual(c('castle_dwelling_7'), { gold: 20000, mercury: 10, sulfur: 10, crystal: 10, gems: 10 });
  assert.deepEqual(c('castle_dwelling_7_up'), { gold: 20000, mercury: 10, sulfur: 10, crystal: 10, gems: 10 });
  assert.deepEqual(c('castle_dwelling_1'), { gold: 500, ore: 10 });
  assert.deepEqual(c('castle_dwelling_2'), { gold: 1000, wood: 5, ore: 5 });
  assert.deepEqual(c('castle_dwelling_5'), { gold: 3000, wood: 5, ore: 5, mercury: 2, sulfur: 2, crystal: 2, gems: 2 });
  assert.deepEqual(c('castle_dwelling_6'), { gold: 5000, wood: 20 });
  assert.deepEqual(r('castle_dwelling_6'), ['castle_stables']);
  assert.deepEqual(r('castle_dwelling_7'), ['castle_dwelling_5']);
  assert.deepEqual(r('castle_dwelling_5'), ['castle_dwelling_4', 'mage_guild_1']);
  assert.deepEqual(c('castle_stables'), { gold: 2000, wood: 10 });
  assert.deepEqual(c('castle_griffin_bastion'), { gold: 1000 });
  assert.deepEqual(c('castle_brotherhood_of_the_sword'), { gold: 500, wood: 5 });
  assert.deepEqual(c('rampart_dwelling_7'), { gold: 10000, ore: 30, crystal: 20 });
  assert.deepEqual(c('rampart_dwelling_7_up'), { gold: 20000, ore: 30, crystal: 20 });
  assert.deepEqual(c('rampart_dwelling_5'), { gold: 2500 });
  assert.deepEqual(r('rampart_dwelling_7'), ['mage_guild_2', 'rampart_dwelling_6']);
  assert.deepEqual(c('tower_dwelling_7_up'), { gold: 25000, wood: 5, ore: 5, gems: 30 });
  assert.deepEqual(c('tower_dwelling_1'), { gold: 300, wood: 5, ore: 5 });
  assert.ok(r('tower_dwelling_4_up').includes('tower_library'));
  assert.deepEqual(c('tower_artifact_merchants'), { gold: 10000 });
  assert.deepEqual(c('inferno_castle_gate'), { gold: 10000, wood: 5, ore: 5 });
  assert.deepEqual(c('necropolis_dwelling_1'), { gold: 400, wood: 5, ore: 5 });
  assert.deepEqual(c('necropolis_dwelling_6'), { gold: 6000, wood: 10, ore: 10 });
  assert.ok(r('necropolis_dwelling_4_up').includes('necropolis_necromancy_amplifier'));
  assert.deepEqual(c('necropolis_skeleton_transformer'), { gold: 1000 });
  assert.deepEqual(c('dungeon_dwelling_3'), { gold: 1000, wood: 1, ore: 1, mercury: 1, sulfur: 1, crystal: 1, gems: 1 });
  assert.deepEqual(c('dungeon_dwelling_7'), { gold: 15000, wood: 15, ore: 15, sulfur: 20 });
  assert.deepEqual(c('dungeon_dwelling_2'), { gold: 1000 });
  assert.deepEqual(c('stronghold_dwelling_1'), { gold: 200, wood: 5, ore: 5 });
  assert.deepEqual(c('stronghold_dwelling_7'), { gold: 10000, wood: 10, ore: 10, crystal: 10 });
  assert.deepEqual(c('stronghold_dwelling_4'), { gold: 2000, wood: 20 });
  assert.deepEqual(c('fortress_dwelling_1'), { gold: 400, wood: 10 });
  assert.deepEqual(c('fortress_dwelling_7'), { gold: 10000, wood: 10, ore: 10, sulfur: 10 });
  assert.deepEqual(c('conflux_magic_university'), { gold: 5000, wood: 10, ore: 10 });
  assert.deepEqual(totalCost(['fort', 'citadel', 'castle']), { gold: 12500, wood: 30, ore: 35 });
});

test('building counts per faction', () => {
  const counts = Object.fromEntries(FACTIONS.map((f) => [f, buildingsForFaction(f).length]));
  for (const f of FACTIONS) {
    const own = BUILDINGS.filter((b) => b.faction === f).length;
    const common = 11 + getFaction(f).mageGuildMax + (getFaction(f).hasShipyard ? 1 : 0);
    assert.equal(counts[f], own + common, f);
    assert.ok(own >= 18, `${f} has dwellings + specials + grail`);
  }
});

// ---------------------------------------------------------------- helpers & rules

test('helpers: isBuilt / missingRequirements / checkBuildable / applyBuild', () => {
  let b = startingBuildings('castle', 'main');
  assert.deepEqual(b, ['village_hall', 'fort', 'tavern', 'castle_dwelling_1']);
  assert.deepEqual(checkBuildable(b, 'town_hall', 'castle'), { ok: true });
  assert.deepEqual(checkBuildable(b, 'city_hall', 'castle'), { ok: false, error: 'missing_requirements' });
  assert.deepEqual([...missingRequirements(b, 'city_hall')].sort(), ['blacksmith', 'mage_guild_1', 'marketplace', 'town_hall']);
  assert.deepEqual(checkBuildable(b, 'fort', 'castle'), { ok: false, error: 'already_built' });
  assert.deepEqual(checkBuildable(b, 'mage_guild_5', 'castle'), { ok: false, error: 'not_available' });
  assert.deepEqual(checkBuildable(b, 'rampart_dwelling_1', 'castle'), { ok: false, error: 'not_available' });
  assert.deepEqual(checkBuildable(b, 'shipyard', 'rampart'), { ok: false, error: 'not_available' });
  b = applyBuild(b, 'town_hall');
  assert.ok(!b.includes('village_hall') && b.includes('town_hall'));
  assert.ok(isBuilt(b, 'village_hall'));
  b = applyBuild(applyBuild(b, 'citadel'), 'castle');
  assert.ok(isBuilt(b, 'fort') && !b.includes('fort') && !b.includes('citadel'));
  assert.deepEqual(checkBuildable(b, 'citadel', 'castle'), { ok: false, error: 'already_built' });
  assert.deepEqual(checkBuildable(b, 'castle_dwelling_2', 'castle'), { ok: true });
});

test('starting building sets are self-consistent for every faction', () => {
  assert.deepEqual(Object.keys(STARTING_BUILDINGS).sort(), ['main', 'other']);
  for (const f of FACTIONS) {
    for (const role of ['main', 'other']) {
      const set = startingBuildings(f, role);
      assert.ok(set.includes('village_hall'));
      for (const id of set) {
        assert.ok(buildingsForFaction(f).some((b) => b.id === id), `${f}/${role}: ${id}`);
        assert.deepEqual(missingRequirements(set, id), [], `${f}/${role}: ${id}`);
      }
    }
  }
  assert.throws(() => startingBuildings('castle', 'bogus'));
  assert.throws(() => startingBuildings('bogus'));
});

test('marketplace exchange table', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20].map(marketEfficiency),
    [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.5, 0.5]);
  // one marketplace
  assert.deepEqual(marketRate('wood', 'gold', 1), { give: 1, get: 25 });
  assert.deepEqual(marketRate('gems', 'gold', 1), { give: 1, get: 50 });
  assert.deepEqual(marketRate('gold', 'wood', 1), { give: 2500, get: 1 });
  assert.deepEqual(marketRate('gold', 'gems', 1), { give: 5000, get: 1 });
  assert.deepEqual(marketRate('wood', 'ore', 1), { give: 10, get: 1 });
  assert.deepEqual(marketRate('wood', 'gems', 1), { give: 20, get: 1 });
  assert.deepEqual(marketRate('gems', 'wood', 1), { give: 5, get: 1 });
  assert.deepEqual(marketRate('gems', 'sulfur', 1), { give: 10, get: 1 });
  // nine marketplaces (cap)
  assert.deepEqual(marketRate('wood', 'gold', 9), { give: 1, get: 125 });
  assert.deepEqual(marketRate('gold', 'wood', 9), { give: 500, get: 1 });
  assert.deepEqual(marketRate('gold', 'gems', 9), { give: 1000, get: 1 });
  assert.deepEqual(marketRate('wood', 'ore', 9), { give: 2, get: 1 });
  assert.deepEqual(marketRate('gems', 'wood', 9), { give: 1, get: 1 });
  assert.deepEqual(marketRate('wood', 'gold', 30), marketRate('wood', 'gold', 9));
  assert.deepEqual(marketRate('ore', 'ore', 3), { give: 1, get: 1 });
  // rates never get worse with more markets
  for (const [from, to] of [['wood', 'gold'], ['gold', 'crystal'], ['mercury', 'ore'], ['ore', 'gems']]) {
    let prev = 0;
    for (let n = 1; n <= 10; n++) {
      const { give, get } = marketRate(from, to, n);
      assert.ok(get / give >= prev, `${from}->${to} at ${n}`);
      prev = get / give;
    }
  }
  assert.throws(() => marketRate('wood', 'mithril', 1));
});

test('freelancer guild and artifact merchant rates', () => {
  // Freelancer's Guild efficiency table (not the marketplace formula)
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 20].map(freelancerEfficiency),
    [0.3, 0.45, 0.5, 0.65, 0.7, 0.85, 0.9, 1, 1, 1]);
  assert.deepEqual(FREELANCER_EFFICIENCY, [0, 0.3, 0.45, 0.5, 0.65, 0.7, 0.85, 0.9, 1.0]);
  assert.deepEqual(freelancerRate(3000, 'gold', 1), { give: 1, get: 900 });
  assert.deepEqual(freelancerRate(300, 'gold', 5), { give: 1, get: 210 }, 'no floating-point drift');
  assert.deepEqual(freelancerRate(3000, 'gold', 8), { give: 1, get: 3000 });
  assert.deepEqual(freelancerRate(3000, 'gold', 9), freelancerRate(3000, 'gold', 8));
  assert.deepEqual(freelancerRate(60, 'wood', 1), { give: 14, get: 1 });
  assert.deepEqual(freelancerRate(3000, 'gems', 8), { give: 1, get: 6 });
  assert.equal(artifactBuyPrice(2000, 'gold', 1), 10000);
  assert.equal(artifactBuyPrice(2000, 'wood', 1), 80);
  assert.equal(artifactBuyPrice(2000, 'gems', 1), 40);
  assert.equal(artifactBuyPrice(2000, 'gold', 9), 3333);
  assert.equal(artifactSellPrice(2000, 'gold', 1), 400);
  assert.equal(artifactSellPrice(2000, 'gold', 9), 1200);
  assert.equal(artifactSellPrice(2000, 'gems', 1), 1);
  assert.ok(artifactSellPrice(2000, 'gold', 30) < artifactBuyPrice(2000, 'gold', 30));
});

test('skeleton transformer mapping', () => {
  assert.equal(SKELETON_TRANSFORMER.default, 'skeleton');
  assert.equal(SKELETON_TRANSFORMER.dragons, 'bone_dragon');
  for (const id of ['green_dragon', 'gold_dragon', 'red_dragon', 'black_dragon', 'azure_dragon', 'faerie_dragon']) {
    assert.ok(SKELETON_TRANSFORMER.dragonIds.includes(id), id);
  }
  for (const id of ['hydra', 'chaos_hydra']) assert.ok(!SKELETON_TRANSFORMER.dragonIds.includes(id), `${id} becomes skeletons`);
  assert.equal(factionOfCreature(SKELETON_TRANSFORMER.default), 'necropolis');
  assert.equal(factionOfCreature(SKELETON_TRANSFORMER.dragons), 'necropolis');
});
