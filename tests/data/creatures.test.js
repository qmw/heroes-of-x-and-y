import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTIONS, NEUTRAL, RESOURCES, SPELL_SCHOOLS } from '../../src/core/constants.js';
import { ABILITIES, ABILITY_IDS, ABILITY_TAGS, getAbility, validateAbilityEntry } from '../../src/data/abilities.js';
import {
  CREATURES, CREATURE_BY_ID, ORIGINAL_NEUTRAL_IDS, getCreature, creaturesOfFaction, neutralCreatures,
  getWarMachines, creaturesOfTier, getUpgrade, getBaseCreature, getUpgradeChain, canUpgradeTo,
  getUpgradeCost, getCreatureAbility, hasAbility, isShooter, creatureTags, hasTag, factionLineup,
} from '../../src/data/creatures.js';

const SHAPES = ['humanoid', 'beast', 'dragon', 'flyer', 'undead', 'elemental', 'construct', 'serpent',
  'insect', 'plant', 'machine', 'giant', 'caster', 'rider'];
const REQUIRED = ['id', 'name', 'faction', 'tier', 'upgraded', 'upgradeOf', 'upgradesTo', 'attack',
  'defense', 'minDamage', 'maxDamage', 'hp', 'speed', 'growth', 'aiValue', 'fightValue', 'cost', 'shots',
  'size', 'flying', 'abilities', 'warMachine', 'shape'];
const units = CREATURES.filter((c) => !c.warMachine);

/** [attack, defense, minDamage, maxDamage, hp, speed] */
const stats = (id) => {
  const c = getCreature(id);
  return [c.attack, c.defense, c.minDamage, c.maxDamage, c.hp, c.speed];
};

// ---- registry ------------------------------------------------------------------------------------

test('ability registry entries are well formed', () => {
  assert.ok(ABILITY_IDS.length > 60);
  for (const [id, def] of Object.entries(ABILITIES)) {
    assert.match(id, /^[a-z][a-z0-9_]*$/, id);
    assert.equal(typeof def.name, 'string', id);
    assert.ok(def.description.length > 10, `${id} description`);
    assert.ok(Array.isArray(def.params), `${id} params`);
    assert.ok(['tag', 'attack', 'on_hit', 'defense', 'aura', 'cast', 'adventure', 'machine'].includes(def.kind), `${id} kind`);
  }
  for (const tag of ['undead', 'non_living', 'mind_immune', 'mechanical', 'elemental', 'dragon']) {
    assert.ok(ABILITY_TAGS.includes(tag), tag);
    assert.deepEqual(ABILITIES[tag].params, []);
  }
  assert.throws(() => getAbility('nope'));
  assert.equal(getAbility('jousting').params[0], 'percentPerHex');
});

test('every registered ability is used by at least one creature', () => {
  const used = new Set(CREATURES.flatMap((c) => c.abilities.map((ab) => ab.id)));
  assert.deepEqual(ABILITY_IDS.filter((id) => !used.has(id)), []);
});

test('validateAbilityEntry reports unknown ids and missing params', () => {
  assert.deepEqual(validateAbilityEntry({ id: 'undead' }), []);
  assert.equal(validateAbilityEntry({ id: 'hates', targets: ['devil'] }).length, 1);
  assert.equal(validateAbilityEntry({ id: 'not_an_ability' }).length, 1);
});

// ---- generic validation ----------------------------------------------------------------------------

test('ids are unique snake_case and lookups agree', () => {
  const ids = CREATURES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(CREATURES.map((c) => c.name)).size, ids.length, 'names unique');
  for (const c of CREATURES) {
    assert.match(c.id, /^[a-z][a-z0-9_]*$/);
    assert.equal(CREATURE_BY_ID[c.id], c);
    assert.equal(getCreature(c.id), c);
  }
  assert.throws(() => getCreature('no_such_creature'), /Unknown creature/);
});

test('all required fields are present with sane ranges', () => {
  for (const c of CREATURES) {
    for (const f of REQUIRED) assert.notEqual(c[f], undefined, `${c.id}.${f}`);
    assert.deepEqual(Object.keys(c).sort(), [...REQUIRED].sort(), `${c.id} has no extra fields`);
    assert.ok(c.name.length > 0, c.id);
    assert.ok(c.faction === NEUTRAL || FACTIONS.includes(c.faction), `${c.id} faction`);
    assert.ok(SHAPES.includes(c.shape), `${c.id} shape ${c.shape}`);
    assert.ok(c.size === 1 || c.size === 2, `${c.id} size`);
    for (const f of ['upgraded', 'flying', 'warMachine']) assert.equal(typeof c[f], 'boolean', `${c.id}.${f}`);
    for (const f of ['attack', 'defense', 'minDamage', 'maxDamage', 'hp', 'speed', 'growth', 'aiValue', 'fightValue', 'shots', 'tier']) {
      assert.ok(Number.isInteger(c[f]) && c[f] >= 0, `${c.id}.${f}`);
    }
    assert.ok(c.minDamage <= c.maxDamage, `${c.id} damage range`);
    assert.ok(c.hp >= 1 && c.hp <= 1000, `${c.id} hp`);
    assert.ok(c.attack <= 50 && c.defense <= 50, `${c.id} atk/def`);
    assert.ok(c.aiValue > 0 && c.fightValue > 0, `${c.id} values`);
    assert.ok(Array.isArray(c.abilities), c.id);
  }
});

test('regular creatures: tier, speed, damage and growth ranges', () => {
  for (const c of units) {
    assert.ok(c.tier >= 1 && c.tier <= 8, `${c.id} tier`);
    assert.ok(c.speed >= 3 && c.speed <= 21, `${c.id} speed`);
    assert.ok(c.minDamage >= 1, `${c.id} min damage`);
    assert.ok(c.growth >= 1 && c.growth <= 25, `${c.id} growth`);
    assert.ok(c.attack >= 1 && c.defense >= 1, c.id);
    if (c.faction !== NEUTRAL) assert.ok(c.tier <= 7, `${c.id} town tier`);
  }
  // tier 8 is reserved for the above-7 specials
  assert.deepEqual(creaturesOfTier(8).map((c) => c.id).sort(),
    ['azure_dragon', 'crystal_dragon', 'faerie_dragon', 'rust_dragon']);
});

test('costs only use valid resources, always include gold, and rare resources only on high tiers', () => {
  for (const c of CREATURES) {
    const keys = Object.keys(c.cost);
    assert.ok(keys.length >= 1, c.id);
    for (const k of keys) {
      assert.ok(RESOURCES.includes(k), `${c.id} cost resource ${k}`);
      assert.ok(Number.isInteger(c.cost[k]) && c.cost[k] > 0, `${c.id} cost ${k}`);
    }
    assert.ok(c.cost.gold > 0, `${c.id} gold cost`);
    if (keys.length > 1) assert.ok(c.tier >= 7, `${c.id} rare resource cost below tier 7`);
  }
});

test('every ability id is registered and carries its required params', () => {
  for (const c of CREATURES) {
    const seen = new Set();
    for (const ab of c.abilities) {
      assert.deepEqual(validateAbilityEntry(ab), [], c.id);
      const key = ab.id === 'cast_on_hit' ? `${ab.id}:${ab.spellId}` : ab.id === 'spell_immunity' || ab.id === 'hates' ? JSON.stringify(ab) : ab.id;
      assert.ok(!seen.has(key), `${c.id} duplicate ability ${key}`);
      seen.add(key);
    }
  }
});

test('ability params have sane values', () => {
  const pct = (v) => Number.isFinite(v) && v > 0 && v <= 100;
  for (const c of CREATURES) {
    for (const ab of c.abilities) {
      const where = `${c.id}/${ab.id}`;
      for (const p of ['chance', 'percent', 'percentPerCreature', 'percentPerHex', 'hpPercent', 'hpPercentPerRound']) {
        if (ab[p] !== undefined) assert.ok(pct(ab[p]), `${where}.${p}`);
      }
      for (const p of ['spells', 'targets', 'friendlySpells', 'enemySpells']) {
        if (ab[p] !== undefined) {
          assert.ok(Array.isArray(ab[p]) && ab[p].length > 0, `${where}.${p}`);
          for (const s of ab[p]) assert.match(s, /^[a-z][a-z0-9_]*$/, `${where}.${p}`);
        }
      }
      if (ab.mastery !== undefined) assert.ok([0, 1, 2, 3].includes(ab.mastery), where);
      if (ab.casts !== undefined) assert.ok(Number.isInteger(ab.casts) && ab.casts >= 1, where);
      if (ab.school !== undefined) assert.ok(SPELL_SCHOOLS.includes(ab.school), where);
      if (ab.maxLevel !== undefined) assert.ok(ab.maxLevel >= 1 && ab.maxLevel <= 5, where);
      if (ab.id === 'hates') for (const t of ab.targets) assert.ok(CREATURE_BY_ID[t], `${where} target ${t}`);
      if (ab.id === 'raise_demons') assert.ok(CREATURE_BY_ID[ab.creatureId], where);
      if (ab.id === 'resource_generation') assert.ok(RESOURCES.includes(ab.resource), where);
      if (ab.id === 'cast_on_hit') assert.ok(['before', 'after'].includes(ab.timing), where);
      if (ab.id === 'spellcaster') assert.ok(['friendly', 'enemy'].includes(ab.target), where);
      if (ab.id === 'enemy_morale' || ab.id === 'enemy_luck') assert.ok(ab.value < 0, where);
      if (ab.id === 'army_morale') assert.ok(ab.value > 0, where);
    }
  }
});

test('shooter-only abilities belong to shooters; shooters have shots > 0', () => {
  const shooterOnly = ['double_shot', 'no_melee_penalty', 'no_range_penalty', 'no_obstacle_penalty',
    'area_shot', 'accurate_shot', 'preemptive_shot', 'ranged_retaliation'];
  for (const c of CREATURES) {
    for (const id of shooterOnly) if (hasAbility(c, id)) assert.ok(c.shots > 0, `${c.id} has ${id} but no shots`);
    assert.equal(isShooter(c), c.shots > 0);
  }
  const shooters = ['archer', 'marksman', 'monk', 'zealot', 'wood_elf', 'grand_elf', 'master_gremlin', 'mage',
    'arch_mage', 'titan', 'gog', 'magog', 'lich', 'power_lich', 'beholder', 'evil_eye', 'medusa', 'medusa_queen',
    'orc', 'orc_chieftain', 'cyclops', 'cyclops_king', 'lizardman', 'lizard_warrior', 'storm_elemental',
    'ice_elemental', 'pirate', 'corsair', 'sea_dog', 'sea_witch', 'sorceress', 'halfling', 'halfling_grenadier',
    'gunslinger', 'bounty_hunter', 'sharpshooter', 'enchanter', 'ballista', 'cannon', 'arrow_tower'];
  for (const id of shooters) assert.ok(getCreature(id).shots > 0, `${id} must be a shooter`);
  for (const id of ['gremlin', 'giant', 'pikeman', 'angel', 'air_elemental', 'first_aid_tent', 'ammo_cart']) {
    assert.equal(getCreature(id).shots, 0, id);
  }
});

// ---- upgrades & faction layout ---------------------------------------------------------------------

test('upgrade links are symmetric and stay within faction and tier', () => {
  for (const c of CREATURES) {
    assert.equal(c.upgraded, c.upgradeOf !== null, `${c.id} upgraded flag`);
    if (c.upgradesTo) {
      const up = getCreature(c.upgradesTo);
      assert.equal(up.upgradeOf, c.id, `${c.id} -> ${up.id}`);
      assert.equal(up.faction, c.faction);
      assert.equal(up.tier, c.tier);
      assert.ok(up.aiValue > c.aiValue, `${up.id} aiValue should exceed ${c.id}`);
      assert.ok(up.cost.gold > c.cost.gold, `${up.id} should cost more than ${c.id}`);
      assert.ok(up.speed >= c.speed && up.hp >= c.hp, `${up.id} not weaker`);
      assert.equal(up.size, c.size, `${up.id} size`);
      assert.equal(up.growth, c.growth, `${up.id} growth`);
    }
    if (c.upgradeOf) assert.equal(getCreature(c.upgradeOf).upgradesTo, c.id, `${c.id} <- ${c.upgradeOf}`);
  }
});

test('each faction has 7 tiers, each with base + upgrade', () => {
  for (const faction of FACTIONS) {
    const lineup = factionLineup(faction);
    assert.equal(lineup.length, 7);
    lineup.forEach((chains, i) => {
      const expectedChains = faction === 'factory' && i === 6 ? 2 : 1;
      assert.equal(chains.length, expectedChains, `${faction} tier ${i + 1} chains`);
      for (const chain of chains) {
        const expectedLen = chain[0] === 'pirate' ? 3 : 2;
        assert.equal(chain.length, expectedLen, `${faction} tier ${i + 1}: ${chain}`);
      }
    });
    const expectedCount = { cove: 15, factory: 16 }[faction] ?? 14;
    assert.equal(creaturesOfFaction(faction).length, expectedCount, faction);
  }
  assert.throws(() => factionLineup('neutral'));
});

test('specific lineups: Conflux, Cove and Factory', () => {
  assert.deepEqual(factionLineup('conflux').map((t) => t[0]), [
    ['pixie', 'sprite'], ['air_elemental', 'storm_elemental'], ['water_elemental', 'ice_elemental'],
    ['fire_elemental', 'energy_elemental'], ['earth_elemental', 'magma_elemental'],
    ['psychic_elemental', 'magic_elemental'], ['firebird', 'phoenix']]);
  assert.deepEqual(factionLineup('cove').map((t) => t[0]), [
    ['nymph', 'oceanid'], ['crew_mate', 'seaman'], ['pirate', 'corsair', 'sea_dog'], ['stormbird', 'ayssid'],
    ['sea_witch', 'sorceress'], ['nix', 'nix_warrior'], ['sea_serpent', 'haspid']]);
  assert.deepEqual(factionLineup('factory').flat(), [
    ['halfling', 'halfling_grenadier'], ['mechanic', 'engineer'], ['armadillo', 'bellwether_armadillo'],
    ['automaton', 'sentinel_automaton'], ['sandworm', 'olgoi_khorkhoi'], ['gunslinger', 'bounty_hunter'],
    ['couatl', 'crimson_couatl'], ['dreadnought', 'juggernaut']]);
  // Conflux growth: Firebirds come two a week
  assert.equal(getCreature('firebird').growth, 2);
});

test('neutrals and war machines are complete', () => {
  const neutralIds = neutralCreatures().map((c) => c.id);
  for (const id of ['peasant', 'rogue', 'boar', 'nomad', 'mummy', 'troll', 'gold_golem', 'diamond_golem',
    'sharpshooter', 'enchanter', 'faerie_dragon', 'rust_dragon', 'crystal_dragon', 'azure_dragon', 'satyr',
    'fangarm', 'leprechaun', 'steel_golem']) {
    assert.ok(neutralIds.includes(id), `missing neutral ${id}`);
  }
  assert.ok(ORIGINAL_NEUTRAL_IDS.length >= 8);
  for (const id of ORIGINAL_NEUTRAL_IDS) assert.ok(neutralIds.includes(id), id);
  assert.ok(new Set(ORIGINAL_NEUTRAL_IDS.map((id) => getCreature(id).tier)).size >= 6, 'varied tiers');
  for (const c of neutralCreatures()) assert.equal(c.upgradesTo, null);
  // Halfling exists exactly once (it is the Factory tier-1 creature, as in HotA).
  assert.equal(getCreature('halfling').faction, 'factory');

  assert.deepEqual(getWarMachines().map((c) => c.id).sort(),
    ['ammo_cart', 'arrow_tower', 'ballista', 'cannon', 'catapult', 'first_aid_tent']);
  for (const m of getWarMachines()) {
    assert.equal(m.tier, 0);
    assert.equal(m.speed, 0);
    assert.equal(m.growth, 0);
    assert.equal(m.faction, NEUTRAL);
    assert.ok(hasAbility(m, 'immobile'));
    assert.ok(hasTag(m, 'war_machine') && hasTag(m, 'non_living'));
  }
  assert.ok(!neutralIds.includes('ballista'));
  assert.equal(creaturesOfTier(0).length, 0);
});

// ---- helpers -------------------------------------------------------------------------------------

test('upgrade helpers', () => {
  assert.equal(getUpgrade('pikeman').id, 'halberdier');
  assert.equal(getUpgrade('halberdier'), null);
  assert.equal(getBaseCreature('arch_angel').id, 'angel');
  assert.equal(getBaseCreature('sea_dog').id, 'pirate');
  assert.equal(getBaseCreature('peasant').id, 'peasant');
  assert.deepEqual(getUpgradeChain('corsair').map((c) => c.id), ['pirate', 'corsair', 'sea_dog']);
  assert.ok(canUpgradeTo('pirate', 'sea_dog'));
  assert.ok(!canUpgradeTo('sea_dog', 'pirate'));
  assert.ok(!canUpgradeTo('pikeman', 'marksman'));
  assert.deepEqual(getUpgradeCost('pikeman', 'halberdier'), { gold: 15 });
  assert.deepEqual(getUpgradeCost('angel', 'arch_angel'), { gold: 2000, gems: 2 });
  assert.deepEqual(getUpgradeCost('bone_dragon', 'ghost_dragon'), { gold: 1200, mercury: 1 });
  assert.throws(() => getUpgradeCost('pikeman', 'archer'));
  assert.equal(creaturesOfTier(7, 'castle').length, 2);
});

test('tags are derived consistently', () => {
  for (const c of CREATURES) {
    const tags = creatureTags(c);
    const exclusive = ['living', 'undead', 'non_living'].filter((t) => tags.includes(t));
    assert.equal(exclusive.length, 1, `${c.id}: ${exclusive}`);
    if (tags.includes('undead') || tags.includes('non_living')) assert.ok(tags.includes('mind_immune'), c.id);
  }
  for (const c of creaturesOfFaction('necropolis')) assert.ok(hasTag(c, 'undead'), c.id);
  for (const id of ['stone_golem', 'iron_golem', 'gold_golem', 'diamond_golem', 'steel_golem', 'stone_gargoyle',
    'obsidian_gargoyle', 'air_elemental', 'magma_elemental', 'psychic_elemental', 'automaton']) {
    assert.ok(hasTag(id, 'non_living'), id);
  }
  for (const id of ['giant', 'titan', 'black_dragon', 'magic_elemental', 'mummy', 'fangarm']) assert.ok(hasTag(id, 'mind_immune'), id);
  for (const id of ['pikeman', 'angel', 'red_dragon', 'pixie', 'firebird', 'troll']) {
    assert.ok(hasTag(id, 'living') && !hasTag(id, 'mind_immune'), id);
  }
  for (const id of ['green_dragon', 'gold_dragon', 'red_dragon', 'black_dragon', 'bone_dragon', 'ghost_dragon',
    'faerie_dragon', 'rust_dragon', 'crystal_dragon', 'azure_dragon']) assert.ok(hasTag(id, 'dragon'), id);
  assert.ok(hasTag('devil', 'flying') && !getCreature('devil').flying);
});

// ---- spot checks against the original game -----------------------------------------------------------

test('spot checks: stats', () => {
  const expected = {
    pikeman: [4, 5, 1, 3, 10, 4], halberdier: [6, 5, 2, 3, 10, 5], marksman: [6, 3, 2, 3, 10, 6],
    royal_griffin: [9, 9, 3, 6, 25, 9], crusader: [12, 12, 7, 10, 35, 6], zealot: [12, 10, 10, 12, 30, 7],
    champion: [16, 16, 20, 25, 100, 9], angel: [20, 20, 50, 50, 200, 12], arch_angel: [30, 30, 50, 50, 250, 18],
    centaur: [5, 3, 2, 3, 8, 6], grand_elf: [9, 5, 3, 5, 15, 7], gold_dragon: [27, 27, 40, 50, 250, 16],
    gremlin: [3, 3, 1, 2, 4, 4], naga_queen: [16, 13, 30, 30, 110, 7], titan: [24, 24, 40, 60, 300, 11],
    imp: [2, 3, 1, 2, 4, 5], arch_devil: [26, 28, 30, 40, 200, 17], efreet_sultan: [16, 14, 16, 24, 90, 13],
    skeleton: [5, 4, 1, 3, 6, 4], vampire_lord: [10, 10, 5, 8, 40, 9], dread_knight: [18, 18, 15, 30, 120, 9],
    ghost_dragon: [19, 17, 25, 50, 200, 14], troglodyte: [4, 3, 1, 3, 5, 4], minotaur_king: [15, 15, 12, 20, 50, 8],
    black_dragon: [25, 25, 40, 50, 300, 15], red_dragon: [19, 19, 40, 50, 180, 11], goblin: [4, 2, 1, 2, 5, 5],
    thunderbird: [13, 11, 11, 15, 60, 11], ancient_behemoth: [19, 19, 30, 50, 300, 9], gnoll: [3, 5, 2, 3, 6, 4],
    mighty_gorgon: [11, 16, 12, 16, 70, 6], chaos_hydra: [18, 20, 25, 45, 250, 7], pixie: [2, 2, 1, 2, 3, 7],
    phoenix: [21, 18, 30, 40, 200, 21], magic_elemental: [15, 13, 15, 25, 80, 9], peasant: [1, 1, 1, 1, 1, 3],
    azure_dragon: [50, 50, 70, 80, 1000, 19], rust_dragon: [30, 30, 50, 50, 750, 17],
    crystal_dragon: [40, 40, 60, 75, 800, 16], faerie_dragon: [20, 20, 20, 30, 500, 15],
    enchanter: [17, 12, 14, 14, 30, 9], sharpshooter: [12, 10, 8, 10, 15, 9], diamond_golem: [13, 12, 10, 14, 60, 5],
  };
  for (const [id, s] of Object.entries(expected)) assert.deepEqual(stats(id), s, id);
});

test('spot checks: cost, growth, shots, ai value, size, flying', () => {
  assert.deepEqual(getCreature('pikeman').cost, { gold: 60 });
  assert.deepEqual(getCreature('arch_angel').cost, { gold: 5000, gems: 3 });
  assert.deepEqual(getCreature('black_dragon').cost, { gold: 4000, sulfur: 2 });
  assert.deepEqual(getCreature('titan').cost, { gold: 5000, gems: 2 });
  assert.deepEqual(getCreature('arch_devil').cost, { gold: 4500, mercury: 2 });
  assert.deepEqual(getCreature('gold_dragon').cost, { gold: 4000, crystal: 2 });
  assert.deepEqual(getCreature('azure_dragon').cost, { gold: 30000, mercury: 20 });
  assert.deepEqual(getCreature('behemoth').cost, { gold: 1500 });
  const growth = { pikeman: 14, archer: 9, griffin: 7, swordsman: 4, monk: 3, cavalier: 2, angel: 1, pixie: 20,
    gremlin: 16, skeleton: 12, imp: 15, peasant: 25 };
  for (const [id, g] of Object.entries(growth)) assert.equal(getCreature(id).growth, g, id);
  const shots = { archer: 12, marksman: 24, medusa: 4, medusa_queen: 8, master_gremlin: 8, cyclops: 16,
    titan: 24, sharpshooter: 32, ballista: 24 };
  for (const [id, s] of Object.entries(shots)) assert.equal(getCreature(id).shots, s, id);
  const ai = { pikeman: 80, arch_angel: 8776, black_dragon: 8721, titan: 7500, azure_dragon: 78845,
    peasant: 15, phoenix: 6721, ancient_behemoth: 6168 };
  for (const [id, v] of Object.entries(ai)) assert.equal(getCreature(id).aiValue, v, id);
  for (const id of ['griffin', 'cavalier', 'centaur', 'unicorn', 'green_dragon', 'naga', 'hell_hound', 'black_knight',
    'medusa', 'behemoth', 'hydra', 'firebird', 'wolf_rider', 'gorgon', 'azure_dragon']) {
    assert.equal(getCreature(id).size, 2, id);
  }
  for (const id of ['pikeman', 'angel', 'devil', 'titan', 'efreet', 'vampire', 'minotaur', 'ogre']) {
    assert.equal(getCreature(id).size, 1, id);
  }
  for (const id of ['griffin', 'angel', 'pegasus', 'gold_dragon', 'stone_gargoyle', 'genie', 'efreet', 'wight',
    'vampire', 'bone_dragon', 'harpy', 'manticore', 'black_dragon', 'roc', 'serpent_fly', 'wyvern', 'pixie',
    'energy_elemental', 'phoenix', 'azure_dragon']) assert.ok(getCreature(id).flying, id);
  for (const id of ['pikeman', 'imp', 'air_elemental', 'crystal_dragon', 'hydra', 'devil']) assert.ok(!getCreature(id).flying, id);
});

test('spot checks: signature abilities and their numbers', () => {
  const ab = getCreatureAbility;
  assert.equal(ab('cavalier', 'jousting').percentPerHex, 5);
  assert.equal(ab('champion', 'jousting').percentPerHex, 5);
  assert.ok(hasAbility('pikeman', 'charge_immunity') && hasAbility('halberdier', 'charge_immunity'));
  assert.equal(ab('arch_angel', 'resurrection').hpPerCreature, 100);
  assert.ok(!hasAbility('angel', 'resurrection'));
  assert.equal(ab('dread_knight', 'double_damage_chance').chance, 20);
  assert.equal(ab('mighty_gorgon', 'death_stare').percentPerCreature, 10);
  assert.equal(ab('vampire_lord', 'life_drain').percent, 100);
  assert.equal(ab('phoenix', 'rebirth').percent, 20);
  assert.deepEqual([ab('thunderbird', 'lightning_strike').chance, ab('thunderbird', 'lightning_strike').damagePerCreature], [20, 10]);
  assert.equal(ab('behemoth', 'reduce_enemy_defense').percent, 40);
  assert.equal(ab('ancient_behemoth', 'reduce_enemy_defense').percent, 80);
  assert.equal(ab('pit_lord', 'raise_demons').hpPerCreature, 50);
  assert.equal(ab('pit_lord', 'raise_demons').creatureId, 'demon');
  const golems = { stone_golem: 50, iron_golem: 75, steel_golem: 80, gold_golem: 85, diamond_golem: 95 };
  for (const [id, p] of Object.entries(golems)) assert.equal(ab(id, 'spell_damage_reduction').percent, p, id);
  const dragons = { green_dragon: 3, red_dragon: 3, azure_dragon: 3, gold_dragon: 4, black_dragon: 5, magic_elemental: 5 };
  for (const [id, l] of Object.entries(dragons)) assert.equal(ab(id, 'spell_level_immunity').maxLevel, l, id);
  assert.equal(ab('dwarf', 'magic_resistance').percent, 20);
  assert.equal(ab('battle_dwarf', 'magic_resistance').percent, 40);
  assert.equal(ab('ogre_mage', 'spellcaster').casts, 3);
  assert.deepEqual(ab('ogre_mage', 'spellcaster').spells, ['bloodlust']);
  assert.equal(ab('master_genie', 'spellcaster').casts, 3);
  assert.equal(ab('faerie_dragon', 'spellcaster').casts, 5);
  assert.equal(ab('efreet_sultan', 'fire_shield').percent, 20);
  assert.equal(ab('wraith', 'mana_drain').value, 2);
  assert.equal(ab('griffin', 'extra_retaliations').count, 1);
  assert.ok(hasAbility('royal_griffin', 'unlimited_retaliations'));
  assert.ok(hasAbility('crusader', 'double_attack') && hasAbility('wolf_raider', 'double_attack'));
  assert.ok(hasAbility('marksman', 'double_shot') && hasAbility('grand_elf', 'double_shot'));
  assert.ok(hasAbility('hydra', 'attack_all_adjacent') && hasAbility('hydra', 'no_enemy_retaliation'));
  assert.ok(hasAbility('cerberus', 'three_headed_attack'));
  assert.equal(ab('rust_dragon', 'acid_breath').defenseReduction, 3);
  assert.equal(ab('azure_dragon', 'fear').chance, 10);
});

test('hate pairs are mutual and +50%', () => {
  const pairs = [[['angel', 'arch_angel'], ['devil', 'arch_devil']], [['genie', 'master_genie'], ['efreet', 'efreet_sultan']],
    [['titan'], ['black_dragon']]];
  for (const [as, bs] of pairs) {
    for (const [from, to] of [[as, bs], [bs, as]]) {
      for (const id of from) {
        const h = getCreatureAbility(id, 'hates');
        assert.ok(h, `${id} hates`);
        assert.equal(h.percent, 50);
        assert.deepEqual([...h.targets].sort(), [...to].sort(), id);
      }
    }
  }
  assert.equal(CREATURES.filter((c) => hasAbility(c, 'hates')).length, 10);
});

test('elemental immunities and vulnerabilities do not overlap', () => {
  for (const c of creaturesOfFaction('conflux')) {
    const imm = new Set(c.abilities.filter((x) => x.id === 'spell_immunity').flatMap((x) => x.spells));
    const vul = c.abilities.filter((x) => x.id === 'spell_vulnerability').flatMap((x) => x.spells);
    for (const s of vul) assert.ok(!imm.has(s), `${c.id} both immune and vulnerable to ${s}`);
  }
  assert.ok(getCreatureAbility('air_elemental', 'spell_vulnerability').spells.includes('lightning_bolt'));
  assert.ok(getCreatureAbility('earth_elemental', 'spell_immunity').spells.includes('lightning_bolt'));
  assert.equal(getCreatureAbility('fire_elemental', 'school_immunity').school, 'fire');
  assert.deepEqual(getCreatureAbility('water_elemental', 'spell_immunity').spells, ['ice_bolt', 'frost_ring']);
});

test('element tags shared with the spell data are derived from abilities', () => {
  const has = (id, ...tags) => tags.every((t) => hasTag(id, t));
  assert.ok(has('air_elemental', 'earth_immune', 'lightning_vulnerable'));
  assert.ok(has('water_elemental', 'cold_immune', 'fire_vulnerable'));
  assert.ok(has('fire_elemental', 'fire_immune', 'cold_vulnerable'));
  assert.ok(has('earth_elemental', 'lightning_immune', 'earth_vulnerable'));
  assert.ok(has('efreet', 'fire_immune') && has('phoenix', 'fire_immune') && has('nymph', 'cold_immune'));
  assert.ok(has('troglodyte', 'sightless') && has('infernal_troglodyte', 'sightless'));
  assert.ok(has('titan', 'shooter') && has('angel', 'flying'));
  for (const c of CREATURES) {
    const tags = creatureTags(c);
    for (const e of ['fire', 'cold', 'lightning', 'earth']) {
      assert.ok(!(tags.includes(`${e}_immune`) && tags.includes(`${e}_vulnerable`)), `${c.id} ${e}`);
    }
  }
});

test('data is plain JSON', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CREATURES)), CREATURES);
});

test('spell ids referenced by abilities exist in spells.js (when that module is present)', async (t) => {
  let spells;
  try {
    spells = await import('../../src/data/spells.js');
  } catch {
    t.skip('src/data/spells.js not available yet');
    return;
  }
  const known = new Set(Object.keys(spells.SPELL_BY_ID ?? {}));
  if (known.size === 0) { t.skip('SPELL_BY_ID not exported'); return; }
  const missing = new Set();
  for (const c of CREATURES) {
    for (const ab of c.abilities) {
      const ids = [ab.spellId, ...(ab.spells ?? []), ...(ab.friendlySpells ?? []), ...(ab.enemySpells ?? [])].filter(Boolean);
      for (const id of ids) if (!known.has(id)) missing.add(id);
    }
  }
  assert.deepEqual([...missing], []);
});
