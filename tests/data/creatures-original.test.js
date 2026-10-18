// Full table of the original (SoD) creature numbers, written independently of src/data/creatures.js
// (combat/creatures audit, docs/audit/combat-creatures.md). One row per creature:
// [attack, defense, minDamage, maxDamage, hp, speed, growth, aiValue, gold, shots, size, flying, rare]
// `rare` = [resource, amount] for the tier-7/8 resource cost, or null.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCreature, hasAbility, getCreatureAbility, creatureTags } from '../../src/data/creatures.js';

const F = false;
const T = true;
const SOD = {
  // Castle
  pikeman: [4, 5, 1, 3, 10, 4, 14, 80, 60, 0, 1, F, null],
  halberdier: [6, 5, 2, 3, 10, 5, 14, 115, 75, 0, 1, F, null],
  archer: [6, 3, 2, 3, 10, 4, 9, 126, 100, 12, 1, F, null],
  marksman: [6, 3, 2, 3, 10, 6, 9, 184, 150, 24, 1, F, null],
  griffin: [8, 8, 3, 6, 25, 6, 7, 351, 200, 0, 2, T, null],
  royal_griffin: [9, 9, 3, 6, 25, 9, 7, 448, 240, 0, 2, T, null],
  swordsman: [10, 12, 6, 9, 35, 5, 4, 445, 300, 0, 1, F, null],
  crusader: [12, 12, 7, 10, 35, 6, 4, 588, 400, 0, 1, F, null],
  monk: [12, 7, 10, 12, 30, 5, 3, 485, 400, 12, 1, F, null],
  zealot: [12, 10, 10, 12, 30, 7, 3, 750, 450, 24, 1, F, null],
  cavalier: [15, 15, 15, 25, 100, 7, 2, 1946, 1000, 0, 2, F, null],
  champion: [16, 16, 20, 25, 100, 9, 2, 2100, 1200, 0, 2, F, null],
  angel: [20, 20, 50, 50, 200, 12, 1, 5019, 3000, 0, 1, T, ['gems', 1]],
  arch_angel: [30, 30, 50, 50, 250, 18, 1, 8776, 5000, 0, 1, T, ['gems', 3]],
  // Rampart
  centaur: [5, 3, 2, 3, 8, 6, 14, 100, 70, 0, 2, F, null],
  centaur_captain: [6, 3, 2, 3, 10, 8, 14, 138, 90, 0, 2, F, null],
  dwarf: [6, 7, 2, 4, 20, 3, 8, 138, 120, 0, 1, F, null],
  battle_dwarf: [7, 7, 2, 4, 20, 5, 8, 209, 150, 0, 1, F, null],
  wood_elf: [9, 5, 3, 5, 15, 6, 7, 234, 200, 24, 1, F, null],
  grand_elf: [9, 5, 3, 5, 15, 7, 7, 331, 225, 24, 1, F, null],
  pegasus: [9, 8, 5, 9, 30, 8, 5, 518, 250, 0, 2, T, null],
  silver_pegasus: [9, 10, 5, 9, 30, 12, 5, 532, 275, 0, 2, T, null],
  dendroid_guard: [9, 12, 10, 14, 55, 3, 3, 517, 350, 0, 1, F, null],
  dendroid_soldier: [9, 12, 10, 14, 65, 4, 3, 803, 425, 0, 1, F, null],
  unicorn: [15, 14, 18, 22, 90, 7, 2, 1806, 850, 0, 2, F, null],
  war_unicorn: [15, 14, 18, 22, 110, 9, 2, 2030, 950, 0, 2, F, null],
  green_dragon: [18, 18, 40, 50, 180, 10, 1, 4872, 2400, 0, 2, T, ['crystal', 1]],
  gold_dragon: [27, 27, 40, 50, 250, 16, 1, 8613, 4000, 0, 2, T, ['crystal', 2]],
  // Tower
  gremlin: [3, 3, 1, 2, 4, 4, 16, 44, 30, 0, 1, F, null],
  master_gremlin: [4, 4, 1, 2, 4, 5, 16, 66, 40, 8, 1, F, null],
  stone_gargoyle: [6, 6, 2, 3, 16, 6, 9, 165, 130, 0, 1, T, null],
  obsidian_gargoyle: [7, 7, 2, 3, 16, 9, 9, 201, 160, 0, 1, T, null],
  stone_golem: [7, 10, 4, 5, 30, 3, 6, 250, 150, 0, 1, F, null],
  iron_golem: [9, 10, 4, 5, 35, 5, 6, 412, 200, 0, 1, F, null],
  mage: [11, 8, 7, 9, 25, 5, 4, 570, 350, 24, 1, F, null],
  arch_mage: [12, 9, 7, 9, 30, 7, 4, 680, 450, 24, 1, F, null],
  genie: [12, 12, 13, 16, 40, 7, 3, 884, 550, 0, 1, T, null],
  master_genie: [12, 12, 13, 16, 40, 11, 3, 942, 600, 0, 1, T, null],
  naga: [16, 13, 20, 20, 110, 5, 2, 2016, 1100, 0, 2, F, null],
  naga_queen: [16, 13, 30, 30, 110, 7, 2, 2840, 1600, 0, 2, F, null],
  giant: [19, 16, 40, 60, 150, 7, 1, 3718, 2000, 0, 1, F, ['gems', 1]],
  titan: [24, 24, 40, 60, 300, 11, 1, 7500, 5000, 24, 1, F, ['gems', 2]],
  // Inferno
  imp: [2, 3, 1, 2, 4, 5, 15, 50, 50, 0, 1, F, null],
  familiar: [4, 4, 1, 2, 4, 7, 15, 60, 60, 0, 1, F, null],
  gog: [6, 4, 2, 4, 13, 4, 8, 159, 125, 12, 1, F, null],
  magog: [7, 4, 2, 4, 13, 6, 8, 240, 175, 24, 1, F, null],
  hell_hound: [10, 6, 2, 7, 25, 7, 5, 357, 200, 0, 2, F, null],
  cerberus: [10, 8, 2, 7, 25, 8, 5, 392, 250, 0, 2, F, null],
  demon: [10, 10, 7, 9, 35, 5, 4, 445, 250, 0, 1, F, null],
  horned_demon: [10, 10, 7, 9, 40, 6, 4, 480, 270, 0, 1, F, null],
  pit_fiend: [13, 13, 13, 17, 45, 6, 3, 765, 500, 0, 1, F, null],
  pit_lord: [13, 13, 13, 17, 45, 7, 3, 1224, 700, 0, 1, F, null],
  efreet: [16, 12, 16, 24, 90, 9, 2, 1670, 900, 0, 1, T, null],
  efreet_sultan: [16, 14, 16, 24, 90, 13, 2, 1848, 1100, 0, 1, T, null],
  devil: [19, 21, 30, 40, 160, 11, 1, 5101, 2700, 0, 1, F, ['mercury', 1]],
  arch_devil: [26, 28, 30, 40, 200, 17, 1, 7115, 4500, 0, 1, F, ['mercury', 2]],
  // Necropolis
  skeleton: [5, 4, 1, 3, 6, 4, 12, 60, 60, 0, 1, F, null],
  skeleton_warrior: [6, 6, 1, 3, 6, 5, 12, 85, 70, 0, 1, F, null],
  walking_dead: [5, 5, 2, 3, 15, 3, 8, 98, 100, 0, 1, F, null],
  zombie: [5, 5, 2, 3, 20, 4, 8, 128, 125, 0, 1, F, null],
  wight: [7, 7, 3, 5, 18, 5, 7, 252, 200, 0, 1, T, null],
  wraith: [7, 7, 3, 5, 18, 7, 7, 315, 230, 0, 1, T, null],
  vampire: [10, 9, 5, 8, 30, 6, 4, 555, 360, 0, 1, T, null],
  vampire_lord: [10, 10, 5, 8, 40, 9, 4, 783, 500, 0, 1, T, null],
  lich: [13, 10, 11, 13, 30, 6, 3, 848, 550, 12, 1, F, null],
  power_lich: [13, 10, 11, 15, 40, 7, 3, 1079, 600, 24, 1, F, null],
  black_knight: [16, 16, 15, 30, 120, 7, 2, 2087, 1200, 0, 2, F, null],
  dread_knight: [18, 18, 15, 30, 120, 9, 2, 2382, 1500, 0, 2, F, null],
  bone_dragon: [17, 15, 25, 50, 150, 9, 1, 3388, 1800, 0, 2, T, null],
  ghost_dragon: [19, 17, 25, 50, 200, 14, 1, 4696, 3000, 0, 2, T, ['mercury', 1]],
  // Dungeon
  troglodyte: [4, 3, 1, 3, 5, 4, 14, 59, 50, 0, 1, F, null],
  infernal_troglodyte: [5, 4, 1, 3, 6, 5, 14, 84, 65, 0, 1, F, null],
  harpy: [6, 5, 1, 4, 14, 6, 8, 154, 130, 0, 1, T, null],
  harpy_hag: [6, 6, 1, 4, 14, 9, 8, 238, 170, 0, 1, T, null],
  beholder: [9, 7, 3, 5, 22, 5, 7, 336, 250, 12, 1, F, null],
  evil_eye: [10, 8, 3, 5, 22, 7, 7, 367, 280, 24, 1, F, null],
  medusa: [9, 9, 6, 8, 25, 5, 4, 517, 300, 4, 2, F, null],
  medusa_queen: [10, 10, 6, 8, 30, 6, 4, 577, 330, 8, 2, F, null],
  minotaur: [14, 12, 12, 20, 50, 6, 3, 835, 500, 0, 1, F, null],
  minotaur_king: [15, 15, 12, 20, 50, 8, 3, 1068, 575, 0, 1, F, null],
  manticore: [15, 13, 14, 20, 80, 7, 2, 1547, 850, 0, 2, T, null],
  scorpicore: [16, 14, 14, 20, 80, 11, 2, 1589, 1050, 0, 2, T, null],
  red_dragon: [19, 19, 40, 50, 180, 11, 1, 4702, 2500, 0, 2, T, ['sulfur', 1]],
  black_dragon: [25, 25, 40, 50, 300, 15, 1, 8721, 4000, 0, 2, T, ['sulfur', 2]],
  // Stronghold
  goblin: [4, 2, 1, 2, 5, 5, 15, 60, 40, 0, 1, F, null],
  hobgoblin: [5, 3, 1, 2, 5, 7, 15, 78, 50, 0, 1, F, null],
  wolf_rider: [7, 5, 2, 4, 10, 6, 9, 130, 100, 0, 2, F, null],
  wolf_raider: [8, 5, 3, 4, 10, 8, 9, 203, 140, 0, 2, F, null],
  orc: [8, 4, 2, 5, 15, 4, 7, 192, 150, 12, 1, F, null],
  orc_chieftain: [8, 4, 2, 5, 20, 5, 7, 240, 165, 24, 1, F, null],
  ogre: [13, 7, 6, 12, 40, 4, 4, 416, 300, 0, 1, F, null],
  ogre_mage: [13, 7, 6, 12, 60, 5, 4, 672, 400, 0, 1, F, null],
  roc: [13, 11, 11, 15, 60, 7, 3, 1027, 600, 0, 2, T, null],
  thunderbird: [13, 11, 11, 15, 60, 11, 3, 1106, 700, 0, 2, T, null],
  cyclops: [15, 12, 16, 20, 70, 6, 2, 1266, 750, 16, 1, F, null],
  cyclops_king: [17, 13, 16, 20, 70, 8, 2, 1443, 1100, 24, 1, F, null],
  behemoth: [17, 17, 30, 50, 160, 6, 1, 3162, 1500, 0, 2, F, null],
  ancient_behemoth: [19, 19, 30, 50, 300, 9, 1, 6168, 3000, 0, 2, F, ['crystal', 1]],
  // Fortress
  gnoll: [3, 5, 2, 3, 6, 4, 12, 56, 50, 0, 1, F, null],
  gnoll_marauder: [4, 6, 2, 3, 6, 5, 12, 90, 70, 0, 1, F, null],
  lizardman: [5, 6, 2, 3, 14, 4, 9, 126, 110, 12, 1, F, null],
  lizard_warrior: [6, 8, 2, 5, 15, 5, 9, 156, 140, 24, 1, F, null],
  serpent_fly: [7, 9, 2, 5, 20, 9, 8, 268, 220, 0, 1, T, null],
  dragon_fly: [8, 10, 2, 5, 20, 13, 8, 312, 240, 0, 1, T, null],
  basilisk: [11, 11, 6, 10, 35, 5, 4, 552, 325, 0, 2, F, null],
  greater_basilisk: [12, 12, 6, 10, 40, 7, 4, 714, 400, 0, 2, F, null],
  gorgon: [10, 14, 12, 16, 70, 5, 3, 890, 525, 0, 2, F, null],
  mighty_gorgon: [11, 16, 12, 16, 70, 6, 3, 1028, 600, 0, 2, F, null],
  wyvern: [14, 14, 14, 18, 70, 7, 2, 1350, 800, 0, 2, T, null],
  wyvern_monarch: [14, 14, 18, 22, 70, 11, 2, 1518, 1100, 0, 2, T, null],
  hydra: [16, 18, 25, 45, 175, 5, 1, 4120, 2200, 0, 2, F, null],
  chaos_hydra: [18, 20, 25, 45, 250, 7, 1, 5931, 3500, 0, 2, F, ['sulfur', 1]],
  // Conflux
  pixie: [2, 2, 1, 2, 3, 7, 20, 55, 25, 0, 1, T, null],
  sprite: [2, 2, 1, 3, 3, 9, 20, 95, 30, 0, 1, T, null],
  air_elemental: [9, 9, 2, 8, 25, 7, 6, 356, 250, 0, 1, F, null],
  storm_elemental: [9, 9, 2, 8, 25, 8, 6, 486, 275, 24, 1, F, null],
  water_elemental: [8, 10, 3, 7, 30, 5, 6, 315, 300, 0, 1, F, null],
  ice_elemental: [8, 10, 3, 7, 30, 6, 6, 380, 375, 24, 1, F, null],
  fire_elemental: [10, 8, 4, 6, 35, 6, 5, 345, 350, 0, 1, F, null],
  energy_elemental: [12, 8, 4, 6, 35, 8, 5, 470, 400, 0, 1, T, null],
  earth_elemental: [10, 10, 4, 8, 40, 4, 4, 330, 400, 0, 1, F, null],
  magma_elemental: [11, 11, 6, 10, 40, 6, 4, 490, 500, 0, 1, F, null],
  psychic_elemental: [15, 13, 10, 20, 75, 7, 2, 1669, 750, 0, 1, F, null],
  magic_elemental: [15, 13, 15, 25, 80, 9, 2, 2012, 800, 0, 1, F, null],
  firebird: [18, 18, 30, 40, 150, 15, 2, 4547, 1500, 0, 2, T, null],
  phoenix: [21, 18, 30, 40, 200, 21, 2, 6721, 2000, 0, 2, T, ['mercury', 1]],
  // SoD neutrals
  peasant: [1, 1, 1, 1, 1, 3, 25, 15, 10, 0, 1, F, null],
  rogue: [8, 3, 2, 4, 10, 6, 8, 135, 100, 0, 1, F, null],
  boar: [6, 5, 2, 3, 15, 6, 8, 145, 150, 0, 2, F, null],
  nomad: [9, 8, 2, 6, 30, 7, 7, 345, 200, 0, 2, F, null],
  mummy: [7, 7, 3, 5, 30, 5, 7, 270, 300, 0, 1, F, null],
  sharpshooter: [12, 10, 8, 10, 15, 9, 4, 585, 400, 32, 1, F, null],
  troll: [14, 7, 10, 15, 40, 7, 3, 1024, 500, 0, 1, F, null],
  gold_golem: [11, 12, 8, 10, 50, 5, 3, 600, 500, 0, 1, F, null],
  diamond_golem: [13, 12, 10, 14, 60, 5, 2, 775, 750, 0, 1, F, null],
  enchanter: [17, 12, 14, 14, 30, 9, 2, 1210, 750, 32, 1, F, null],
  faerie_dragon: [20, 20, 20, 30, 500, 15, 1, 19580, 10000, 0, 2, T, ['gems', 8]],
  rust_dragon: [30, 30, 50, 50, 750, 17, 1, 26433, 15000, 0, 2, T, ['sulfur', 14]],
  crystal_dragon: [40, 40, 60, 75, 800, 16, 1, 39338, 20000, 0, 2, F, ['crystal', 10]],
  azure_dragon: [50, 50, 70, 80, 1000, 19, 1, 78845, 30000, 0, 2, T, ['mercury', 20]],
};

test('original numbers: every SoD town creature and neutral matches the reference table', () => {
  assert.equal(Object.keys(SOD).length, 9 * 14 + 14);
  const bad = [];
  for (const [id, row] of Object.entries(SOD)) {
    const c = getCreature(id);
    const [attack, defense, minDamage, maxDamage, hp, speed, growth, aiValue, gold, shots, size, flying, rare] = row;
    const got = [c.attack, c.defense, c.minDamage, c.maxDamage, c.hp, c.speed, c.growth, c.aiValue, c.cost.gold, c.shots, c.size, c.flying];
    const want = [attack, defense, minDamage, maxDamage, hp, speed, growth, aiValue, gold, shots, size, flying];
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${id}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
    const extra = Object.entries(c.cost).filter(([r]) => r !== 'gold');
    if (JSON.stringify(extra) !== JSON.stringify(rare ? [rare] : [])) bad.push(`${id} cost ${JSON.stringify(c.cost)}`);
  }
  assert.deepEqual(bad, []);
});

test('original war machines: Ballista 10/10 2-3 250hp 24 shots, Catapult 1000hp, Tent 75hp, Ammo Cart 0/5 100hp', () => {
  const row = (id) => { const c = getCreature(id); return [c.attack, c.defense, c.minDamage, c.maxDamage, c.hp, c.shots, c.cost.gold]; };
  assert.deepEqual(row('ballista'), [10, 10, 2, 3, 250, 24, 2500]);
  assert.deepEqual(row('catapult').slice(0, 5), [10, 10, 0, 0, 1000]);
  assert.deepEqual(row('first_aid_tent').slice(0, 5), [0, 0, 0, 0, 75]);
  assert.deepEqual(row('first_aid_tent')[6], 750);
  assert.deepEqual(row('ammo_cart').slice(0, 5), [0, 5, 0, 0, 100]);
  assert.deepEqual(row('ammo_cart')[6], 1000);
  assert.deepEqual(getCreatureAbility('first_aid_tent', 'heals'), { id: 'heals', min: 1, max: 25 });
});

test('original abilities: the SoD special-ability matrix', () => {
  const has = (id, ab) => assert.ok(hasAbility(id, ab), `${id} should have ${ab}`);
  const not = (id, ab) => assert.ok(!hasAbility(id, ab), `${id} should not have ${ab}`);
  // retaliation rules
  assert.equal(getCreatureAbility('griffin', 'extra_retaliations').count, 1);
  has('royal_griffin', 'unlimited_retaliations');
  for (const id of ['naga', 'naga_queen', 'vampire', 'vampire_lord', 'harpy_hag', 'cerberus', 'hydra', 'chaos_hydra',
    'sprite', 'devil', 'arch_devil', 'psychic_elemental', 'magic_elemental']) has(id, 'no_enemy_retaliation');
  for (const id of ['harpy', 'pixie', 'hell_hound', 'manticore']) not(id, 'no_enemy_retaliation');
  // attack patterns
  for (const id of ['crusader', 'wolf_raider']) has(id, 'double_attack');
  for (const id of ['marksman', 'grand_elf']) has(id, 'double_shot');
  for (const id of ['hydra', 'chaos_hydra', 'psychic_elemental', 'magic_elemental']) has(id, 'attack_all_adjacent');
  has('cerberus', 'three_headed_attack');
  for (const id of ['green_dragon', 'gold_dragon', 'red_dragon', 'black_dragon', 'firebird', 'phoenix', 'rust_dragon', 'azure_dragon']) has(id, 'breath_attack');
  for (const id of ['bone_dragon', 'ghost_dragon', 'faerie_dragon', 'crystal_dragon']) not(id, 'breath_attack');
  for (const id of ['harpy', 'harpy_hag']) has(id, 'strike_and_return');
  for (const id of ['devil', 'arch_devil']) has(id, 'teleport');
  assert.deepEqual(getCreatureAbility('magog', 'area_shot'), { id: 'area_shot', radius: 1, affects: 'all' });
  assert.deepEqual(getCreatureAbility('power_lich', 'area_shot'), { id: 'area_shot', radius: 1, affects: 'living' });
  for (const id of ['cavalier', 'champion']) assert.equal(getCreatureAbility(id, 'jousting').percentPerHex, 5);
  for (const id of ['pikeman', 'halberdier']) has(id, 'charge_immunity');
  // melee penalty exemptions among shooters
  for (const id of ['zealot', 'titan', 'mage', 'arch_mage', 'beholder', 'evil_eye', 'medusa', 'medusa_queen', 'enchanter']) has(id, 'no_melee_penalty');
  for (const id of ['archer', 'marksman', 'monk', 'wood_elf', 'grand_elf', 'master_gremlin', 'gog', 'magog', 'lich', 'power_lich',
    'orc', 'orc_chieftain', 'cyclops', 'cyclops_king', 'lizardman', 'lizard_warrior', 'storm_elemental', 'ice_elemental', 'sharpshooter']) not(id, 'no_melee_penalty');
  for (const id of ['mage', 'arch_mage', 'sharpshooter', 'enchanter']) has(id, 'no_obstacle_penalty');
  has('sharpshooter', 'no_range_penalty');
  // hates (+50%)
  const hates = (id) => getCreatureAbility(id, 'hates');
  assert.deepEqual(hates('angel').targets, ['devil', 'arch_devil']);
  assert.deepEqual(hates('arch_devil').targets, ['angel', 'arch_angel']);
  assert.deepEqual(hates('master_genie').targets, ['efreet', 'efreet_sultan']);
  assert.deepEqual(hates('efreet').targets, ['genie', 'master_genie']);
  assert.deepEqual(hates('titan').targets, ['black_dragon']);
  assert.deepEqual(hates('black_dragon').targets, ['titan']);
  assert.equal(hates('giant'), null);
  for (const id of ['angel', 'arch_devil', 'genie', 'efreet_sultan', 'titan', 'black_dragon']) assert.equal(hates(id).percent, 50);
  // on-hit chances
  const onHit = (id, spell) => getCreatureAbility(id, 'cast_on_hit') && getCreature(id).abilities.find((a) => a.id === 'cast_on_hit' && a.spellId === spell);
  assert.equal(onHit('unicorn', 'blind').chance, 20);
  assert.equal(onHit('war_unicorn', 'blind').chance, 20);
  assert.equal(onHit('black_knight', 'curse').chance, 20);
  assert.equal(onHit('dread_knight', 'curse').chance, 20);
  assert.equal(onHit('mummy', 'curse').chance, 50);
  assert.equal(onHit('serpent_fly', 'dispel').chance, 100);
  assert.equal(onHit('dragon_fly', 'weakness').chance, 100);
  assert.equal(getCreatureAbility('dread_knight', 'double_damage_chance').chance, 20);
  assert.equal(getCreatureAbility('mighty_gorgon', 'death_stare').percentPerCreature, 10);
  not('gorgon', 'death_stare');
  for (const id of ['medusa', 'medusa_queen', 'basilisk', 'greater_basilisk']) assert.equal(getCreatureAbility(id, 'petrify_attack').chance, 20);
  assert.equal(getCreatureAbility('scorpicore', 'paralyze_attack').chance, 20);
  assert.deepEqual(getCreatureAbility('zombie', 'disease_attack'), { id: 'disease_attack', chance: 20, duration: 3, attack: -2, defense: -2 });
  assert.equal(getCreatureAbility('ghost_dragon', 'aging_attack').chance, 20);
  assert.equal(getCreatureAbility('wyvern_monarch', 'poison_attack').chance, 30);
  assert.deepEqual(getCreatureAbility('thunderbird', 'lightning_strike'), { id: 'lightning_strike', chance: 20, damagePerCreature: 10 });
  assert.deepEqual(getCreatureAbility('rust_dragon', 'acid_breath'), { id: 'acid_breath', defenseReduction: 3, chance: 30, damagePerCreature: 25 });
  for (const id of ['dendroid_guard', 'dendroid_soldier']) has(id, 'binding');
  assert.equal(getCreatureAbility('vampire_lord', 'life_drain').percent, 100);
  not('vampire', 'life_drain');
  // defense / reduction
  assert.equal(getCreatureAbility('behemoth', 'reduce_enemy_defense').percent, 40);
  assert.equal(getCreatureAbility('ancient_behemoth', 'reduce_enemy_defense').percent, 80);
  const golem = (id) => getCreatureAbility(id, 'spell_damage_reduction').percent;
  assert.deepEqual(['stone_golem', 'iron_golem', 'gold_golem', 'diamond_golem'].map(golem), [50, 75, 85, 95]);
  const mr = (id) => getCreatureAbility(id, 'magic_resistance').percent;
  assert.deepEqual(['dwarf', 'battle_dwarf', 'crystal_dragon'].map(mr), [20, 40, 20]);
  for (const id of ['unicorn', 'war_unicorn']) assert.equal(getCreatureAbility(id, 'resistance_aura').percent, 20);
  const lvl = (id) => getCreatureAbility(id, 'spell_level_immunity').maxLevel;
  assert.deepEqual(['green_dragon', 'red_dragon', 'azure_dragon', 'gold_dragon', 'black_dragon', 'magic_elemental'].map(lvl), [3, 3, 3, 4, 5, 5]);
  for (const id of ['efreet', 'efreet_sultan', 'fire_elemental', 'energy_elemental', 'firebird', 'phoenix']) assert.ok(creatureTags(id).includes('fire_immune'), id);
  assert.equal(getCreatureAbility('efreet_sultan', 'fire_shield').percent, 20);
  assert.equal(getCreatureAbility('faerie_dragon', 'magic_mirror').chance, 20);
  for (const id of ['wight', 'wraith', 'troll']) has(id, 'regeneration');
  assert.equal(getCreatureAbility('phoenix', 'rebirth').percent, 20);
  for (const id of ['troglodyte', 'infernal_troglodyte']) assert.ok(creatureTags(id).includes('sightless'));
  for (const id of ['giant', 'titan']) assert.ok(creatureTags(id).includes('mind_immune'));
  for (const id of ['stone_gargoyle', 'obsidian_gargoyle', 'stone_golem', 'iron_golem', 'gold_golem', 'diamond_golem',
    'air_elemental', 'psychic_elemental', 'magic_elemental']) assert.ok(creatureTags(id).includes('non_living'), id);
  for (const id of ['skeleton', 'zombie', 'wraith', 'vampire_lord', 'power_lich', 'dread_knight', 'ghost_dragon', 'mummy']) assert.ok(creatureTags(id).includes('undead'), id);
  // auras and hero interaction
  for (const id of ['angel', 'arch_angel']) assert.equal(getCreatureAbility(id, 'army_morale').value, 1);
  for (const id of ['bone_dragon', 'ghost_dragon']) assert.equal(getCreatureAbility(id, 'enemy_morale').value, -1);
  for (const id of ['devil', 'arch_devil']) assert.equal(getCreatureAbility(id, 'enemy_luck').value, -1);
  for (const id of ['minotaur', 'minotaur_king']) has(id, 'positive_morale');
  for (const id of ['mage', 'arch_mage']) assert.equal(getCreatureAbility(id, 'hero_spell_cost').value, 2);
  for (const id of ['pegasus', 'silver_pegasus']) assert.equal(getCreatureAbility(id, 'enemy_spell_cost').value, 2);
  assert.equal(getCreatureAbility('familiar', 'magic_channel').percent, 20);
  assert.equal(getCreatureAbility('wraith', 'mana_drain').value, 2);
  not('wight', 'mana_drain');
  // casters
  assert.equal(getCreatureAbility('arch_angel', 'resurrection').hpPerCreature, 100);
  assert.equal(getCreatureAbility('arch_angel', 'resurrection').casts, 1);
  assert.equal(getCreatureAbility('pit_lord', 'raise_demons').hpPerCreature, 50);
  assert.equal(getCreatureAbility('master_genie', 'spellcaster').casts, 3);
  assert.deepEqual(getCreatureAbility('ogre_mage', 'spellcaster').spells, ['bloodlust']);
  assert.equal(getCreatureAbility('faerie_dragon', 'spellcaster').powerPerCreature, 5);
  assert.equal(getCreatureAbility('azure_dragon', 'fear').chance, 10);
  assert.equal(getCreatureAbility('cyclops_king', 'siege_attack').level, 2);
});
