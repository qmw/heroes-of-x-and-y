// All creatures: 11 towns, neutrals and war machines. Numbers follow SoD (classic towns) and HotA
// (Cove, Factory, HotA neutrals). See docs/mechanics/creatures.md for ability semantics and for
// the list of values that are approximations.
import { FACTIONS, NEUTRAL } from '../core/constants.js';
import { ABILITIES } from './abilities.js';

/**
 * @typedef {Object} Creature
 * @property {string} id
 * @property {string} name
 * @property {string} faction        faction id or 'neutral'
 * @property {number} tier           1..7, 8 = above-7 specials, 0 = war machines
 * @property {boolean} upgraded
 * @property {string|null} upgradeOf
 * @property {string|null} upgradesTo
 * @property {number} attack
 * @property {number} defense
 * @property {number} minDamage
 * @property {number} maxDamage
 * @property {number} hp
 * @property {number} speed
 * @property {number} growth
 * @property {number} aiValue
 * @property {number} fightValue
 * @property {Object<string, number>} cost
 * @property {number} shots
 * @property {1|2} size
 * @property {boolean} flying
 * @property {Array<{id: string}>} abilities
 * @property {boolean} warMachine
 * @property {string} shape
 */

// ---- compact authoring helpers ---------------------------------------------------------------

/** Ability entry. */
const a = (id, params = {}) => ({ id, ...params });
const UNDEAD = a('undead');
const GOLEM = a('non_living');
const MIND = a('mind_immune');
const DRAGON = a('dragon');
const ELEM = a('elemental');
const MECH = a('mechanical');
const NO_RETAL = a('no_enemy_retaliation');
const NO_MELEE = a('no_melee_penalty');
const BREATH = a('breath_attack');
const hates = (...targets) => a('hates', { targets, percent: 50 });
const immuneLvl = (maxLevel) => a('spell_level_immunity', { maxLevel });
const immune = (...spells) => a('spell_immunity', { spells });
const vulnerable = (...spells) => a('spell_vulnerability', { spells, percent: 100 });
const onHit = (spellId, chance, extra = {}) =>
  a('cast_on_hit', { spellId, chance, mastery: 2, duration: 3, timing: 'after', ...extra });
const protector = (spellId) =>
  a('spellcaster', { spells: [spellId], casts: 3, mastery: 2, target: 'friendly', duration: 6 });

const FLY = { flying: true };
const BIG = { size: 2 };
const BIGFLY = { size: 2, flying: true };

/** Cost: plain gold number, or [gold, resource, amount]. */
function toCost(cost) {
  if (typeof cost === 'number') return { gold: cost };
  const [gold, resource, amount] = cost;
  return gold > 0 ? { gold, [resource]: amount } : { [resource]: amount };
}

/**
 * One creature row.
 * @param {string} id
 * @param {string} name
 * @param {number[]} stats  [attack, defense, minDamage, maxDamage, hp, speed]
 * @param {number} growth
 * @param {number} aiValue
 * @param {number} fightValue
 * @param {number|Array} cost
 * @param {string} shape
 * @param {Object} [opts]  { shots, size, flying, ab: [...abilities] }
 */
function u(id, name, stats, growth, aiValue, fightValue, cost, shape, opts = {}) {
  const [attack, defense, minDamage, maxDamage, hp, speed] = stats;
  return {
    id, name, faction: NEUTRAL, tier: 1, upgraded: false, upgradeOf: null, upgradesTo: null,
    attack, defense, minDamage, maxDamage, hp, speed, growth, aiValue, fightValue,
    cost: toCost(cost), shots: opts.shots ?? 0, size: opts.size ?? 1, flying: opts.flying ?? false,
    abilities: opts.ab ?? [], warMachine: false, shape,
  };
}

/** An upgrade chain (base, upgrade[, second upgrade]) of one faction tier. */
function line(faction, tier, ...units) {
  units.forEach((unit, i) => {
    unit.faction = faction;
    unit.tier = tier;
    unit.upgraded = i > 0;
    unit.upgradeOf = i > 0 ? units[i - 1].id : null;
    unit.upgradesTo = i < units.length - 1 ? units[i + 1].id : null;
  });
  return units;
}

const ANGELS = ['angel', 'arch_angel'];
const DEVILS = ['devil', 'arch_devil'];
const GENIES = ['genie', 'master_genie'];
const EFREET = ['efreet', 'efreet_sultan'];

const GENIE_SPELLS = [
  'air_shield', 'anti_magic', 'bless', 'bloodlust', 'counterstrike', 'cure', 'fire_shield',
  'fortune', 'haste', 'magic_mirror', 'mirth', 'prayer', 'precision', 'protection_from_air',
  'protection_from_earth', 'protection_from_fire', 'protection_from_water', 'shield', 'slayer',
  'stone_skin',
];
const FAERIE_SPELLS = [
  'magic_arrow', 'ice_bolt', 'lightning_bolt', 'chain_lightning', 'frost_ring', 'fireball',
  'inferno', 'meteor_shower',
];
const FIRE_DAMAGE = ['fireball', 'fire_wall', 'inferno', 'armageddon'];
const ICE_DAMAGE = ['ice_bolt', 'frost_ring'];
const AIR_DAMAGE = ['lightning_bolt', 'chain_lightning'];

// ---- Castle ------------------------------------------------------------------------------------
const castle = [
  line('castle', 1,
    u('pikeman', 'Pikeman', [4, 5, 1, 3, 10, 4], 14, 80, 100, 60, 'humanoid', { ab: [a('charge_immunity')] }),
    u('halberdier', 'Halberdier', [6, 5, 2, 3, 10, 5], 14, 115, 115, 75, 'humanoid', { ab: [a('charge_immunity')] })),
  line('castle', 2,
    u('archer', 'Archer', [6, 3, 2, 3, 10, 4], 9, 126, 115, 100, 'humanoid', { shots: 12 }),
    u('marksman', 'Marksman', [6, 3, 2, 3, 10, 6], 9, 184, 115, 150, 'humanoid', { shots: 24, ab: [a('double_shot')] })),
  line('castle', 3,
    u('griffin', 'Griffin', [8, 8, 3, 6, 25, 6], 7, 351, 324, 200, 'flyer', { ...BIGFLY, ab: [a('extra_retaliations', { count: 1 })] }),
    u('royal_griffin', 'Royal Griffin', [9, 9, 3, 6, 25, 9], 7, 448, 364, 240, 'flyer', { ...BIGFLY, ab: [a('unlimited_retaliations')] })),
  line('castle', 4,
    u('swordsman', 'Swordsman', [10, 12, 6, 9, 35, 5], 4, 445, 445, 300, 'humanoid'),
    u('crusader', 'Crusader', [12, 12, 7, 10, 35, 6], 4, 588, 588, 400, 'humanoid', { ab: [a('double_attack')] })),
  line('castle', 5,
    u('monk', 'Monk', [12, 7, 10, 12, 30, 5], 3, 485, 485, 400, 'caster', { shots: 12 }),
    u('zealot', 'Zealot', [12, 10, 10, 12, 30, 7], 3, 750, 500, 450, 'caster', { shots: 24, ab: [NO_MELEE] })),
  line('castle', 6,
    u('cavalier', 'Cavalier', [15, 15, 15, 25, 100, 7], 2, 1946, 1668, 1000, 'rider', { ...BIG, ab: [a('jousting', { percentPerHex: 5 })] }),
    u('champion', 'Champion', [16, 16, 20, 25, 100, 9], 2, 2100, 1800, 1200, 'rider', { ...BIG, ab: [a('jousting', { percentPerHex: 5 })] })),
  line('castle', 7,
    u('angel', 'Angel', [20, 20, 50, 50, 200, 12], 1, 5019, 3585, [3000, 'gems', 1], 'flyer',
      { ...FLY, ab: [hates(...DEVILS), a('army_morale', { value: 1 })] }),
    u('arch_angel', 'Archangel', [30, 30, 50, 50, 250, 18], 1, 8776, 6033, [5000, 'gems', 3], 'flyer',
      { ...FLY, ab: [hates(...DEVILS), a('army_morale', { value: 1 }), a('resurrection', { hpPerCreature: 100, casts: 1 })] })),
];

// ---- Rampart -----------------------------------------------------------------------------------
const rampart = [
  line('rampart', 1,
    u('centaur', 'Centaur', [5, 3, 2, 3, 8, 6], 14, 100, 100, 70, 'rider', BIG),
    u('centaur_captain', 'Centaur Captain', [6, 3, 2, 3, 10, 8], 14, 138, 115, 90, 'rider', BIG)),
  line('rampart', 2,
    u('dwarf', 'Dwarf', [6, 7, 2, 4, 20, 3], 8, 138, 194, 120, 'humanoid', { ab: [a('magic_resistance', { percent: 20 })] }),
    u('battle_dwarf', 'Battle Dwarf', [7, 7, 2, 4, 20, 5], 8, 209, 209, 150, 'humanoid', { ab: [a('magic_resistance', { percent: 40 })] })),
  line('rampart', 3,
    u('wood_elf', 'Wood Elf', [9, 5, 3, 5, 15, 6], 7, 234, 195, 200, 'humanoid', { shots: 24 }),
    u('grand_elf', 'Grand Elf', [9, 5, 3, 5, 15, 7], 7, 331, 195, 225, 'humanoid', { shots: 24, ab: [a('double_shot')] })),
  line('rampart', 4,
    u('pegasus', 'Pegasus', [9, 8, 5, 9, 30, 8], 5, 518, 407, 250, 'flyer', { ...BIGFLY, ab: [a('enemy_spell_cost', { value: 2 })] }),
    u('silver_pegasus', 'Silver Pegasus', [9, 10, 5, 9, 30, 12], 5, 532, 418, 275, 'flyer', { ...BIGFLY, ab: [a('enemy_spell_cost', { value: 2 })] })),
  line('rampart', 5,
    u('dendroid_guard', 'Dendroid Guard', [9, 12, 10, 14, 55, 3], 3, 517, 690, 350, 'plant', { ab: [a('binding')] }),
    u('dendroid_soldier', 'Dendroid Soldier', [9, 12, 10, 14, 65, 4], 3, 803, 765, 425, 'plant', { ab: [a('binding')] })),
  line('rampart', 6,
    u('unicorn', 'Unicorn', [15, 14, 18, 22, 90, 7], 2, 1806, 1548, 850, 'beast',
      { ...BIG, ab: [onHit('blind', 20, { mode: 'melee' }), a('resistance_aura', { percent: 20 })] }),
    u('war_unicorn', 'War Unicorn', [15, 14, 18, 22, 110, 9], 2, 2030, 1740, 950, 'beast',
      { ...BIG, ab: [onHit('blind', 20, { mode: 'melee' }), a('resistance_aura', { percent: 20 })] })),
  line('rampart', 7,
    u('green_dragon', 'Green Dragon', [18, 18, 40, 50, 180, 10], 1, 4872, 3654, [2400, 'crystal', 1], 'dragon',
      { ...BIGFLY, ab: [DRAGON, BREATH, immuneLvl(3)] }),
    u('gold_dragon', 'Gold Dragon', [27, 27, 40, 50, 250, 16], 1, 8613, 6220, [4000, 'crystal', 2], 'dragon',
      { ...BIGFLY, ab: [DRAGON, BREATH, immuneLvl(4)] })),
];

// ---- Tower -------------------------------------------------------------------------------------
const tower = [
  line('tower', 1,
    u('gremlin', 'Gremlin', [3, 3, 1, 2, 4, 4], 16, 44, 55, 30, 'humanoid'),
    u('master_gremlin', 'Master Gremlin', [4, 4, 1, 2, 4, 5], 16, 66, 55, 40, 'humanoid', { shots: 8 })),
  line('tower', 2,
    u('stone_gargoyle', 'Stone Gargoyle', [6, 6, 2, 3, 16, 6], 9, 165, 150, 130, 'flyer', { ...FLY, ab: [GOLEM] }),
    u('obsidian_gargoyle', 'Obsidian Gargoyle', [7, 7, 2, 3, 16, 9], 9, 201, 155, 160, 'flyer', { ...FLY, ab: [GOLEM] })),
  line('tower', 3,
    u('stone_golem', 'Stone Golem', [7, 10, 4, 5, 30, 3], 6, 250, 339, 150, 'construct', { ab: [GOLEM, a('spell_damage_reduction', { percent: 50 })] }),
    u('iron_golem', 'Iron Golem', [9, 10, 4, 5, 35, 5], 6, 412, 412, 200, 'construct', { ab: [GOLEM, a('spell_damage_reduction', { percent: 75 })] })),
  line('tower', 4,
    u('mage', 'Mage', [11, 8, 7, 9, 25, 5], 4, 570, 418, 350, 'caster',
      { shots: 24, ab: [NO_MELEE, a('no_obstacle_penalty'), a('hero_spell_cost', { value: 2 })] }),
    u('arch_mage', 'Arch Mage', [12, 9, 7, 9, 30, 7], 4, 680, 467, 450, 'caster',
      { shots: 24, ab: [NO_MELEE, a('no_obstacle_penalty'), a('hero_spell_cost', { value: 2 })] })),
  line('tower', 5,
    u('genie', 'Genie', [12, 12, 13, 16, 40, 7], 3, 884, 680, 550, 'caster', { ...FLY, ab: [hates(...EFREET)] }),
    u('master_genie', 'Master Genie', [12, 12, 13, 16, 40, 11], 3, 942, 748, 600, 'caster',
      { ...FLY, ab: [hates(...EFREET), a('spellcaster', { spells: GENIE_SPELLS, casts: 3, mastery: 2, target: 'friendly', random: true, duration: 6 })] })),
  line('tower', 6,
    u('naga', 'Naga', [16, 13, 20, 20, 110, 5], 2, 2016, 2016, 1100, 'serpent', { ...BIG, ab: [NO_RETAL] }),
    u('naga_queen', 'Naga Queen', [16, 13, 30, 30, 110, 7], 2, 2840, 2485, 1600, 'serpent', { ...BIG, ab: [NO_RETAL] })),
  line('tower', 7,
    u('giant', 'Giant', [19, 16, 40, 60, 150, 7], 1, 3718, 3146, [2000, 'gems', 1], 'giant', { ab: [MIND] }),
    u('titan', 'Titan', [24, 24, 40, 60, 300, 11], 1, 7500, 5000, [5000, 'gems', 2], 'giant',
      { shots: 24, ab: [MIND, NO_MELEE, hates('black_dragon')] })),
];

// ---- Inferno -----------------------------------------------------------------------------------
const inferno = [
  line('inferno', 1,
    u('imp', 'Imp', [2, 3, 1, 2, 4, 5], 15, 50, 50, 50, 'humanoid'),
    u('familiar', 'Familiar', [4, 4, 1, 2, 4, 7], 15, 60, 60, 60, 'humanoid', { ab: [a('magic_channel', { percent: 20 })] })),
  line('inferno', 2,
    u('gog', 'Gog', [6, 4, 2, 4, 13, 4], 8, 159, 145, 125, 'humanoid', { shots: 12 }),
    u('magog', 'Magog', [7, 4, 2, 4, 13, 6], 8, 240, 210, 175, 'humanoid', { shots: 24, ab: [a('area_shot', { radius: 1, affects: 'all' })] })),
  line('inferno', 3,
    u('hell_hound', 'Hell Hound', [10, 6, 2, 7, 25, 7], 5, 357, 275, 200, 'beast', BIG),
    u('cerberus', 'Cerberus', [10, 8, 2, 7, 25, 8], 5, 392, 308, 250, 'beast', { ...BIG, ab: [a('three_headed_attack'), NO_RETAL] })),
  line('inferno', 4,
    u('demon', 'Demon', [10, 10, 7, 9, 35, 5], 4, 445, 445, 250, 'humanoid'),
    u('horned_demon', 'Horned Demon', [10, 10, 7, 9, 40, 6], 4, 480, 480, 270, 'humanoid')),
  line('inferno', 5,
    u('pit_fiend', 'Pit Fiend', [13, 13, 13, 17, 45, 6], 3, 765, 765, 500, 'humanoid'),
    u('pit_lord', 'Pit Lord', [13, 13, 13, 17, 45, 7], 3, 1224, 1071, 700, 'humanoid',
      { ab: [a('raise_demons', { hpPerCreature: 50, casts: 1, creatureId: 'demon' })] })),
  line('inferno', 6,
    u('efreet', 'Efreet', [16, 12, 16, 24, 90, 9], 2, 1670, 1413, 900, 'elemental',
      { ...FLY, ab: [a('school_immunity', { school: 'fire' }), hates(...GENIES)] }),
    u('efreet_sultan', 'Efreet Sultan', [16, 14, 16, 24, 90, 13], 2, 1848, 1584, 1100, 'elemental',
      { ...FLY, ab: [a('school_immunity', { school: 'fire' }), hates(...GENIES), a('fire_shield', { percent: 20 })] })),
  line('inferno', 7,
    u('devil', 'Devil', [19, 21, 30, 40, 160, 11], 1, 5101, 3759, [2700, 'mercury', 1], 'humanoid',
      { ab: [a('teleport'), NO_RETAL, a('enemy_luck', { value: -1 }), hates(...ANGELS)] }),
    u('arch_devil', 'Arch Devil', [26, 28, 30, 40, 200, 17], 1, 7115, 5243, [4500, 'mercury', 2], 'humanoid',
      { ab: [a('teleport'), NO_RETAL, a('enemy_luck', { value: -1 }), hates(...ANGELS)] })),
];

// ---- Necropolis --------------------------------------------------------------------------------
const necropolis = [
  line('necropolis', 1,
    u('skeleton', 'Skeleton', [5, 4, 1, 3, 6, 4], 12, 60, 75, 60, 'undead', { ab: [UNDEAD] }),
    u('skeleton_warrior', 'Skeleton Warrior', [6, 6, 1, 3, 6, 5], 12, 85, 85, 70, 'undead', { ab: [UNDEAD] })),
  line('necropolis', 2,
    u('walking_dead', 'Walking Dead', [5, 5, 2, 3, 15, 3], 8, 98, 140, 100, 'undead', { ab: [UNDEAD] }),
    u('zombie', 'Zombie', [5, 5, 2, 3, 20, 4], 8, 128, 160, 125, 'undead',
      { ab: [UNDEAD, a('disease_attack', { chance: 20, duration: 3, attack: -2, defense: -2 })] })),
  line('necropolis', 3,
    u('wight', 'Wight', [7, 7, 3, 5, 18, 5], 7, 252, 231, 200, 'undead', { ...FLY, ab: [UNDEAD, a('regeneration')] }),
    u('wraith', 'Wraith', [7, 7, 3, 5, 18, 7], 7, 315, 252, 230, 'undead',
      { ...FLY, ab: [UNDEAD, a('regeneration'), a('mana_drain', { value: 2 })] })),
  line('necropolis', 4,
    u('vampire', 'Vampire', [10, 9, 5, 8, 30, 6], 4, 555, 518, 360, 'undead', { ...FLY, ab: [UNDEAD, NO_RETAL] }),
    u('vampire_lord', 'Vampire Lord', [10, 10, 5, 8, 40, 9], 4, 783, 652, 500, 'undead',
      { ...FLY, ab: [UNDEAD, NO_RETAL, a('life_drain', { percent: 100 })] })),
  line('necropolis', 5,
    u('lich', 'Lich', [13, 10, 11, 13, 30, 6], 3, 848, 742, 550, 'undead',
      { shots: 12, ab: [UNDEAD, a('area_shot', { radius: 1, affects: 'living' })] }),
    u('power_lich', 'Power Lich', [13, 10, 11, 15, 40, 7], 3, 1079, 889, 600, 'undead',
      { shots: 24, ab: [UNDEAD, a('area_shot', { radius: 1, affects: 'living' })] })),
  line('necropolis', 6,
    u('black_knight', 'Black Knight', [16, 16, 15, 30, 120, 7], 2, 2087, 1753, 1200, 'rider',
      { ...BIG, ab: [UNDEAD, onHit('curse', 20)] }),
    u('dread_knight', 'Dread Knight', [18, 18, 15, 30, 120, 9], 2, 2382, 2029, 1500, 'rider',
      { ...BIG, ab: [UNDEAD, onHit('curse', 20), a('double_damage_chance', { chance: 20 })] })),
  line('necropolis', 7,
    u('bone_dragon', 'Bone Dragon', [17, 15, 25, 50, 150, 9], 1, 3388, 2420, 1800, 'dragon',
      { ...BIGFLY, ab: [UNDEAD, DRAGON, a('enemy_morale', { value: -1 })] }),
    u('ghost_dragon', 'Ghost Dragon', [19, 17, 25, 50, 200, 14], 1, 4696, 3228, [3000, 'mercury', 1], 'dragon',
      { ...BIGFLY, ab: [UNDEAD, DRAGON, a('enemy_morale', { value: -1 }), a('aging_attack', { chance: 20, duration: 3, hpPercent: 50 })] })),
];

// ---- Dungeon -----------------------------------------------------------------------------------
const dungeon = [
  line('dungeon', 1,
    u('troglodyte', 'Troglodyte', [4, 3, 1, 3, 5, 4], 14, 59, 73, 50, 'humanoid', { ab: [immune('blind')] }),
    u('infernal_troglodyte', 'Infernal Troglodyte', [5, 4, 1, 3, 6, 5], 14, 84, 84, 65, 'humanoid', { ab: [immune('blind')] })),
  line('dungeon', 2,
    u('harpy', 'Harpy', [6, 5, 1, 4, 14, 6], 8, 154, 140, 130, 'flyer', { ...FLY, ab: [a('strike_and_return')] }),
    u('harpy_hag', 'Harpy Hag', [6, 6, 1, 4, 14, 9], 8, 238, 196, 170, 'flyer', { ...FLY, ab: [a('strike_and_return'), NO_RETAL] })),
  line('dungeon', 3,
    u('beholder', 'Beholder', [9, 7, 3, 5, 22, 5], 7, 336, 240, 250, 'beast', { shots: 12, ab: [NO_MELEE] }),
    u('evil_eye', 'Evil Eye', [10, 8, 3, 5, 22, 7], 7, 367, 245, 280, 'beast', { shots: 24, ab: [NO_MELEE] })),
  line('dungeon', 4,
    u('medusa', 'Medusa', [9, 9, 6, 8, 25, 5], 4, 517, 379, 300, 'serpent',
      { ...BIG, shots: 4, ab: [NO_MELEE, a('petrify_attack', { chance: 20, duration: 3 })] }),
    u('medusa_queen', 'Medusa Queen', [10, 10, 6, 8, 30, 6], 4, 577, 423, 330, 'serpent',
      { ...BIG, shots: 8, ab: [NO_MELEE, a('petrify_attack', { chance: 20, duration: 3 })] })),
  line('dungeon', 5,
    u('minotaur', 'Minotaur', [14, 12, 12, 20, 50, 6], 3, 835, 835, 500, 'humanoid', { ab: [a('positive_morale')] }),
    u('minotaur_king', 'Minotaur King', [15, 15, 12, 20, 50, 8], 3, 1068, 1068, 575, 'humanoid', { ab: [a('positive_morale')] })),
  line('dungeon', 6,
    u('manticore', 'Manticore', [15, 13, 14, 20, 80, 7], 2, 1547, 1215, 850, 'flyer', BIGFLY),
    u('scorpicore', 'Scorpicore', [16, 14, 14, 20, 80, 11], 2, 1589, 1248, 1050, 'flyer',
      { ...BIGFLY, ab: [a('paralyze_attack', { chance: 20, duration: 3 })] })),
  line('dungeon', 7,
    u('red_dragon', 'Red Dragon', [19, 19, 40, 50, 180, 11], 1, 4702, 3762, [2500, 'sulfur', 1], 'dragon',
      { ...BIGFLY, ab: [DRAGON, BREATH, immuneLvl(3)] }),
    u('black_dragon', 'Black Dragon', [25, 25, 40, 50, 300, 15], 1, 8721, 6783, [4000, 'sulfur', 2], 'dragon',
      { ...BIGFLY, ab: [DRAGON, BREATH, immuneLvl(5), hates('titan')] })),
];

// ---- Stronghold --------------------------------------------------------------------------------
const stronghold = [
  line('stronghold', 1,
    u('goblin', 'Goblin', [4, 2, 1, 2, 5, 5], 15, 60, 60, 40, 'humanoid'),
    u('hobgoblin', 'Hobgoblin', [5, 3, 1, 2, 5, 7], 15, 78, 65, 50, 'humanoid')),
  line('stronghold', 2,
    u('wolf_rider', 'Wolf Rider', [7, 5, 2, 4, 10, 6], 9, 130, 130, 100, 'rider', BIG),
    u('wolf_raider', 'Wolf Raider', [8, 5, 3, 4, 10, 8], 9, 203, 174, 140, 'rider', { ...BIG, ab: [a('double_attack')] })),
  line('stronghold', 3,
    u('orc', 'Orc', [8, 4, 2, 5, 15, 4], 7, 192, 175, 150, 'humanoid', { shots: 12 }),
    u('orc_chieftain', 'Orc Chieftain', [8, 4, 2, 5, 20, 5], 7, 240, 200, 165, 'humanoid', { shots: 24 })),
  line('stronghold', 4,
    u('ogre', 'Ogre', [13, 7, 6, 12, 40, 4], 4, 416, 520, 300, 'giant'),
    u('ogre_mage', 'Ogre Mage', [13, 7, 6, 12, 60, 5], 4, 672, 672, 400, 'giant',
      { ab: [a('spellcaster', { spells: ['bloodlust'], casts: 3, mastery: 2, target: 'friendly', duration: 6 })] })),
  line('stronghold', 5,
    u('roc', 'Roc', [13, 11, 11, 15, 60, 7], 3, 1027, 790, 600, 'flyer', BIGFLY),
    u('thunderbird', 'Thunderbird', [13, 11, 11, 15, 60, 11], 3, 1106, 869, 700, 'flyer',
      { ...BIGFLY, ab: [a('lightning_strike', { chance: 20, damagePerCreature: 10 })] })),
  line('stronghold', 6,
    u('cyclops', 'Cyclops', [15, 12, 16, 20, 70, 6], 2, 1266, 1055, 750, 'giant', { shots: 16, ab: [a('siege_attack', { level: 1 })] }),
    u('cyclops_king', 'Cyclops King', [17, 13, 16, 20, 70, 8], 2, 1443, 1110, 1100, 'giant', { shots: 24, ab: [a('siege_attack', { level: 2 })] })),
  line('stronghold', 7,
    u('behemoth', 'Behemoth', [17, 17, 30, 50, 160, 6], 1, 3162, 3162, 1500, 'beast',
      { ...BIG, ab: [a('reduce_enemy_defense', { percent: 40 })] }),
    u('ancient_behemoth', 'Ancient Behemoth', [19, 19, 30, 50, 300, 9], 1, 6168, 5397, [3000, 'crystal', 1], 'beast',
      { ...BIG, ab: [a('reduce_enemy_defense', { percent: 80 })] })),
];

// ---- Fortress ----------------------------------------------------------------------------------
const fortress = [
  line('fortress', 1,
    u('gnoll', 'Gnoll', [3, 5, 2, 3, 6, 4], 12, 56, 70, 50, 'humanoid'),
    u('gnoll_marauder', 'Gnoll Marauder', [4, 6, 2, 3, 6, 5], 12, 90, 90, 70, 'humanoid')),
  line('fortress', 2,
    u('lizardman', 'Lizardman', [5, 6, 2, 3, 14, 4], 9, 126, 115, 110, 'humanoid', { shots: 12 }),
    u('lizard_warrior', 'Lizard Warrior', [6, 8, 2, 5, 15, 5], 9, 156, 130, 140, 'humanoid', { shots: 24 })),
  line('fortress', 3,
    u('serpent_fly', 'Serpent Fly', [7, 9, 2, 5, 20, 9], 8, 268, 215, 220, 'insect',
      { ...FLY, ab: [onHit('dispel', 100, { timing: 'before', duration: 0 })] }),
    u('dragon_fly', 'Dragon Fly', [8, 10, 2, 5, 20, 13], 8, 312, 250, 240, 'insect',
      { ...FLY, ab: [onHit('dispel', 100, { timing: 'before', duration: 0 }), onHit('weakness', 100, { timing: 'before' })] })),
  line('fortress', 4,
    u('basilisk', 'Basilisk', [11, 11, 6, 10, 35, 5], 4, 552, 506, 325, 'beast', { ...BIG, ab: [a('petrify_attack', { chance: 20, duration: 3 })] }),
    u('greater_basilisk', 'Greater Basilisk', [12, 12, 6, 10, 40, 7], 4, 714, 561, 400, 'beast', { ...BIG, ab: [a('petrify_attack', { chance: 20, duration: 3 })] })),
  line('fortress', 5,
    u('gorgon', 'Gorgon', [10, 14, 12, 16, 70, 5], 3, 890, 890, 525, 'beast', BIG),
    u('mighty_gorgon', 'Mighty Gorgon', [11, 16, 12, 16, 70, 6], 3, 1028, 1028, 600, 'beast',
      { ...BIG, ab: [a('death_stare', { percentPerCreature: 10 })] })),
  line('fortress', 6,
    u('wyvern', 'Wyvern', [14, 14, 14, 18, 70, 7], 2, 1350, 1050, 800, 'dragon', BIGFLY),
    u('wyvern_monarch', 'Wyvern Monarch', [14, 14, 18, 22, 70, 11], 2, 1518, 1181, 1100, 'dragon',
      { ...BIGFLY, ab: [a('poison_attack', { chance: 30, duration: 3, hpPercentPerRound: 10 })] })),
  line('fortress', 7,
    u('hydra', 'Hydra', [16, 18, 25, 45, 175, 5], 1, 4120, 4120, 2200, 'serpent', { ...BIG, ab: [a('attack_all_adjacent'), NO_RETAL] }),
    u('chaos_hydra', 'Chaos Hydra', [18, 20, 25, 45, 250, 7], 1, 5931, 5272, [3500, 'sulfur', 1], 'serpent',
      { ...BIG, ab: [a('attack_all_adjacent'), NO_RETAL] })),
];

// ---- Conflux -----------------------------------------------------------------------------------
// Tier layout: 1 pixie, 2 air, 3 water, 4 fire, 5 earth, 6 psychic, 7 firebird.
const conflux = [
  line('conflux', 1,
    u('pixie', 'Pixie', [2, 2, 1, 2, 3, 7], 20, 55, 40, 25, 'flyer', FLY),
    u('sprite', 'Sprite', [2, 2, 1, 3, 3, 9], 20, 95, 70, 30, 'flyer', { ...FLY, ab: [NO_RETAL] })),
  line('conflux', 2,
    u('air_elemental', 'Air Elemental', [9, 9, 2, 8, 25, 7], 6, 356, 324, 250, 'elemental',
      { ab: [ELEM, GOLEM, immune('meteor_shower'), vulnerable(...AIR_DAMAGE, 'armageddon')] }),
    u('storm_elemental', 'Storm Elemental', [9, 9, 2, 8, 25, 8], 6, 486, 324, 275, 'elemental',
      { shots: 24, ab: [ELEM, GOLEM, immune('meteor_shower'), vulnerable(...AIR_DAMAGE, 'armageddon'), protector('protection_from_air')] })),
  line('conflux', 3,
    u('water_elemental', 'Water Elemental', [8, 10, 3, 7, 30, 5], 6, 315, 315, 300, 'elemental',
      { ab: [ELEM, GOLEM, immune(...ICE_DAMAGE), vulnerable(...FIRE_DAMAGE)] }),
    u('ice_elemental', 'Ice Elemental', [8, 10, 3, 7, 30, 6], 6, 380, 315, 375, 'elemental',
      { shots: 24, ab: [ELEM, GOLEM, immune(...ICE_DAMAGE), vulnerable(...FIRE_DAMAGE), protector('protection_from_water')] })),
  line('conflux', 4,
    u('fire_elemental', 'Fire Elemental', [10, 8, 4, 6, 35, 6], 5, 345, 345, 350, 'elemental',
      { ab: [ELEM, GOLEM, a('school_immunity', { school: 'fire' }), vulnerable(...ICE_DAMAGE)] }),
    u('energy_elemental', 'Energy Elemental', [12, 8, 4, 6, 35, 8], 5, 470, 360, 400, 'elemental',
      { ...FLY, ab: [ELEM, GOLEM, a('school_immunity', { school: 'fire' }), vulnerable(...ICE_DAMAGE), protector('protection_from_fire')] })),
  line('conflux', 5,
    u('earth_elemental', 'Earth Elemental', [10, 10, 4, 8, 40, 4], 4, 330, 415, 400, 'elemental',
      { ab: [ELEM, GOLEM, immune(...AIR_DAMAGE, 'armageddon'), vulnerable('meteor_shower')] }),
    u('magma_elemental', 'Magma Elemental', [11, 11, 6, 10, 40, 6], 4, 490, 490, 500, 'elemental',
      { ab: [ELEM, GOLEM, immune(...AIR_DAMAGE, 'armageddon'), vulnerable('meteor_shower'), protector('protection_from_earth')] })),
  line('conflux', 6,
    u('psychic_elemental', 'Psychic Elemental', [15, 13, 10, 20, 75, 7], 2, 1669, 1431, 750, 'elemental',
      { ab: [ELEM, GOLEM, a('attack_all_adjacent'), NO_RETAL] }),
    u('magic_elemental', 'Magic Elemental', [15, 13, 15, 25, 80, 9], 2, 2012, 1724, 800, 'elemental',
      { ab: [ELEM, GOLEM, a('attack_all_adjacent'), NO_RETAL, immuneLvl(5)] })),
  line('conflux', 7,
    u('firebird', 'Firebird', [18, 18, 30, 40, 150, 15], 2, 4547, 3248, 1500, 'flyer',
      { ...BIGFLY, ab: [BREATH, a('school_immunity', { school: 'fire' })] }),
    u('phoenix', 'Phoenix', [21, 18, 30, 40, 200, 21], 2, 6721, 4929, [2000, 'mercury', 1], 'flyer',
      { ...BIGFLY, ab: [BREATH, a('school_immunity', { school: 'fire' }), a('rebirth', { percent: 20 })] })),
];

// ---- Cove (HotA) -------------------------------------------------------------------------------
const cove = [
  line('cove', 1,
    u('nymph', 'Nymph', [5, 2, 1, 2, 4, 6], 16, 57, 57, 35, 'humanoid', { ab: [a('teleport'), immune(...ICE_DAMAGE)] }),
    u('oceanid', 'Oceanid', [6, 2, 1, 3, 4, 8], 16, 75, 75, 45, 'humanoid', { ab: [a('teleport'), immune(...ICE_DAMAGE)] })),
  line('cove', 2,
    u('crew_mate', 'Crew Mate', [7, 4, 2, 4, 15, 5], 9, 155, 155, 110, 'humanoid'),
    u('seaman', 'Seaman', [8, 6, 3, 4, 15, 6], 9, 174, 174, 140, 'humanoid')),
  line('cove', 3,
    u('pirate', 'Pirate', [8, 6, 3, 7, 15, 6], 7, 312, 260, 225, 'humanoid', { shots: 4, ab: [NO_MELEE] }),
    u('corsair', 'Corsair', [10, 8, 3, 7, 15, 7], 7, 407, 330, 275, 'humanoid', { shots: 4, ab: [NO_MELEE, NO_RETAL] }),
    u('sea_dog', 'Sea Dog', [12, 11, 3, 7, 15, 8], 7, 602, 460, 375, 'humanoid',
      { shots: 12, ab: [NO_MELEE, NO_RETAL, a('accurate_shot', { percentPerCreature: 3 })] })),
  line('cove', 4,
    u('stormbird', 'Stormbird', [10, 8, 6, 9, 30, 9], 4, 502, 420, 275, 'flyer', FLY),
    u('ayssid', 'Ayssid', [11, 8, 6, 10, 30, 11], 4, 645, 520, 325, 'flyer', { ...FLY, ab: [a('ferocity')] })),
  line('cove', 5,
    u('sea_witch', 'Sea Witch', [12, 7, 10, 14, 35, 6], 3, 790, 610, 515, 'caster',
      { shots: 12, ab: [onHit('weakness', 100, { timing: 'before' })] }),
    u('sorceress', 'Sorceress', [12, 9, 10, 16, 35, 7], 3, 852, 660, 565, 'caster',
      { shots: 12, ab: [onHit('weakness', 100, { timing: 'before' }), onHit('disrupting_ray', 100, { timing: 'before', duration: 0 })] })),
  line('cove', 6,
    u('nix', 'Nix', [13, 16, 18, 22, 80, 6], 2, 1415, 1300, 1000, 'humanoid', { ab: [a('reduce_enemy_attack', { percent: 30 })] }),
    u('nix_warrior', 'Nix Warrior', [14, 17, 18, 22, 90, 7], 2, 2116, 1850, 1300, 'humanoid', { ab: [a('reduce_enemy_attack', { percent: 60 })] })),
  line('cove', 7,
    u('sea_serpent', 'Sea Serpent', [22, 16, 30, 55, 180, 9], 1, 3953, 3100, [2200, 'sulfur', 1], 'serpent',
      { ...BIG, ab: [a('poison_attack', { chance: 30, duration: 3, hpPercentPerRound: 10 })] }),
    u('haspid', 'Haspid', [29, 20, 30, 55, 300, 12], 1, 7220, 5500, [4000, 'sulfur', 2], 'serpent',
      { ...BIG, ab: [a('poison_attack', { chance: 30, duration: 3, hpPercentPerRound: 10 }), a('revenge')] })),
];

// ---- Factory (HotA) ----------------------------------------------------------------------------
// Tier 7 has two alternative lines (Couatl and Dreadnought).
const factory = [
  line('factory', 1,
    u('halfling', 'Halfling', [4, 2, 1, 3, 4, 5], 15, 75, 60, 40, 'humanoid', { shots: 24, ab: [a('positive_luck')] }),
    u('halfling_grenadier', 'Halfling Grenadier', [5, 2, 2, 3, 4, 6], 15, 95, 75, 65, 'humanoid',
      { shots: 24, ab: [a('positive_luck'), a('no_obstacle_penalty')] })),
  line('factory', 2,
    u('mechanic', 'Mechanic', [6, 5, 2, 4, 14, 6], 8, 186, 160, 140, 'humanoid', { ab: [a('repair', { hpPerCreature: 5, casts: 1 })] }),
    u('engineer', 'Engineer', [7, 5, 2, 5, 16, 7], 8, 278, 230, 170, 'humanoid', { ab: [a('repair', { hpPerCreature: 10, casts: 2 })] })),
  line('factory', 3,
    u('armadillo', 'Armadillo', [5, 10, 3, 5, 25, 4], 6, 198, 220, 200, 'beast', BIG),
    u('bellwether_armadillo', 'Bellwether Armadillo', [5, 11, 3, 5, 25, 6], 6, 256, 260, 230, 'beast', { ...BIG, ab: [a('army_morale', { value: 1 })] })),
  line('factory', 4,
    u('automaton', 'Automaton', [12, 10, 9, 9, 30, 8], 5, 669, 540, 350, 'construct',
      { ab: [MECH, a('explode_on_death', { damagePerCreature: 9 })] }),
    u('sentinel_automaton', 'Sentinel Automaton', [12, 10, 9, 9, 30, 9], 5, 947, 700, 450, 'construct',
      { ab: [MECH, a('explode_on_death', { damagePerCreature: 12 }), a('unlimited_retaliations')] })),
  line('factory', 5,
    u('sandworm', 'Sandworm', [13, 12, 12, 16, 50, 6], 3, 991, 850, 575, 'serpent', { ...BIG, ab: [a('burrow')] }),
    u('olgoi_khorkhoi', 'Olgoi-Khorkhoi', [15, 12, 12, 16, 60, 9], 3, 1220, 1020, 700, 'serpent',
      { ...BIG, ab: [a('burrow'), a('devour_corpse', { hpPercent: 50 })] })),
  line('factory', 6,
    u('gunslinger', 'Gunslinger', [17, 12, 14, 24, 45, 7], 2, 1351, 1100, 800, 'humanoid',
      { shots: 16, ab: [a('preemptive_shot')] }),
    u('bounty_hunter', 'Bounty Hunter', [18, 14, 14, 24, 45, 8], 2, 1454, 1200, 1100, 'humanoid',
      { shots: 24, ab: [a('preemptive_shot'), a('ranged_retaliation')] })),
  line('factory', 7,
    u('couatl', 'Couatl', [21, 21, 25, 45, 160, 12], 1, 3574, 2900, [2000, 'gems', 1], 'serpent', BIGFLY),
    u('crimson_couatl', 'Crimson Couatl', [23, 23, 25, 45, 200, 15], 1, 5341, 4200, [3500, 'gems', 2], 'serpent',
      { ...BIGFLY, ab: [a('invulnerability', { rounds: 1, casts: 1 })] })),
  line('factory', 7,
    u('dreadnought', 'Dreadnought', [18, 20, 40, 50, 200, 6], 1, 3879, 3600, [2500, 'mercury', 1], 'machine',
      { ...BIG, ab: [MECH, a('heat_stroke', { radius: 1, percent: 50 })] }),
    u('juggernaut', 'Juggernaut', [23, 23, 50, 60, 300, 6], 1, 6433, 5800, [4000, 'mercury', 2], 'machine',
      { ...BIG, ab: [MECH, a('heat_stroke', { radius: 1, percent: 100 })] })),
];

// ---- Neutrals ----------------------------------------------------------------------------------
const n = (tier, unit) => line(NEUTRAL, tier, unit);
const neutrals = [
  n(1, u('peasant', 'Peasant', [1, 1, 1, 1, 1, 3], 25, 15, 15, 10, 'humanoid',
    { ab: [a('resource_generation', { resource: 'gold', amount: 1, period: 'day' })] })),
  n(2, u('rogue', 'Rogue', [8, 3, 2, 4, 10, 6], 8, 135, 135, 100, 'humanoid', { ab: [a('spying')] })),
  n(2, u('boar', 'Boar', [6, 5, 2, 3, 15, 6], 8, 145, 145, 150, 'beast', BIG)),
  n(2, u('leprechaun', 'Leprechaun', [8, 5, 3, 5, 15, 5], 9, 208, 190, 100, 'humanoid',
    { ab: [a('luck_doubling'), a('spellcaster', { spells: ['fortune'], casts: 1, mastery: 2, target: 'friendly', duration: 6 })] })),
  n(3, u('nomad', 'Nomad', [9, 8, 2, 6, 30, 7], 7, 345, 285, 200, 'rider', { ...BIG, ab: [a('sandwalker')] })),
  n(3, u('mummy', 'Mummy', [7, 7, 3, 5, 30, 5], 7, 270, 270, 300, 'undead', { ab: [UNDEAD, onHit('curse', 50)] })),
  n(4, u('satyr', 'Satyr', [10, 11, 6, 10, 35, 7], 4, 518, 450, 300, 'humanoid',
    { ab: [a('spellcaster', { spells: ['mirth'], casts: 1, mastery: 2, target: 'friendly', duration: 6 })] })),
  n(4, u('steel_golem', 'Steel Golem', [10, 11, 6, 8, 45, 6], 5, 597, 597, 400, 'construct',
    { ab: [GOLEM, a('spell_damage_reduction', { percent: 80 })] })),
  n(4, u('sharpshooter', 'Sharpshooter', [12, 10, 8, 10, 15, 9], 4, 585, 415, 400, 'humanoid',
    { shots: 32, ab: [a('no_range_penalty'), a('no_obstacle_penalty')] })),
  n(5, u('troll', 'Troll', [14, 7, 10, 15, 40, 7], 3, 1024, 1024, 500, 'giant', { ab: [a('regeneration')] })),
  n(5, u('gold_golem', 'Gold Golem', [11, 12, 8, 10, 50, 5], 3, 600, 600, 500, 'construct',
    { ab: [GOLEM, a('spell_damage_reduction', { percent: 85 })] })),
  n(5, u('fangarm', 'Fangarm', [12, 12, 8, 12, 50, 6], 3, 929, 800, 600, 'beast',
    { ab: [MIND, a('teleport'), a('unlimited_retaliations'), onHit('hypnotize', 20, { mode: 'retaliation' })] })),
  n(6, u('diamond_golem', 'Diamond Golem', [13, 12, 10, 14, 60, 5], 2, 775, 775, 750, 'construct',
    { ab: [GOLEM, a('spell_damage_reduction', { percent: 95 })] })),
  n(6, u('enchanter', 'Enchanter', [17, 12, 14, 14, 30, 9], 2, 1210, 805, 750, 'caster',
    { shots: 32, ab: [NO_MELEE, a('no_obstacle_penalty'), a('mass_caster', {
      friendlySpells: ['air_shield', 'bless', 'cure', 'haste', 'slayer', 'stone_skin'],
      enemySpells: ['curse', 'slow', 'weakness'], mastery: 3, duration: 3, interval: 3 })] })),
  n(8, u('faerie_dragon', 'Faerie Dragon', [20, 20, 20, 30, 500, 15], 1, 19580, 16317, [10000, 'gems', 8], 'dragon',
    { ...BIGFLY, ab: [DRAGON, a('magic_mirror', { chance: 20 }),
      a('spellcaster', { spells: FAERIE_SPELLS, casts: 5, mastery: 2, target: 'enemy', random: true, powerPerCreature: 5 })] })),
  n(8, u('rust_dragon', 'Rust Dragon', [30, 30, 50, 50, 750, 17], 1, 26433, 24030, [15000, 'sulfur', 14], 'dragon',
    { ...BIGFLY, ab: [DRAGON, BREATH, a('acid_breath', { defenseReduction: 3, chance: 30, damagePerCreature: 25 })] })),
  n(8, u('crystal_dragon', 'Crystal Dragon', [40, 40, 60, 75, 800, 16], 1, 39338, 30260, [20000, 'crystal', 10], 'dragon',
    { ...BIG, ab: [DRAGON, a('magic_resistance', { percent: 20 }),
      a('resource_generation', { resource: 'crystal', amount: 3, period: 'week', perStack: true })] })),
  n(8, u('azure_dragon', 'Azure Dragon', [50, 50, 70, 80, 1000, 19], 1, 78845, 56315, [30000, 'mercury', 20], 'dragon',
    { ...BIGFLY, ab: [DRAGON, BREATH, immuneLvl(3), a('fear', { chance: 10 })] })),

  // Original (non-H3) neutrals that enrich the roster.
  n(1, u('will_o_wisp', "Will-o'-Wisp", [3, 3, 1, 2, 5, 8], 16, 70, 60, 35, 'elemental',
    { ...FLY, ab: [ELEM, GOLEM, a('mana_drain', { value: 1 })] })),
  n(2, u('dire_wolf', 'Dire Wolf', [8, 5, 2, 4, 14, 8], 9, 190, 170, 130, 'beast', { ...BIG, ab: [a('ferocity')] })),
  n(3, u('bog_witch', 'Bog Witch', [8, 6, 3, 5, 18, 5], 6, 300, 240, 220, 'caster',
    { shots: 8, ab: [onHit('curse', 30), a('hero_spell_cost', { value: 1 })] })),
  n(4, u('giant_spider', 'Giant Spider', [11, 9, 6, 9, 35, 7], 4, 560, 480, 330, 'insect',
    { ...BIG, ab: [a('binding'), a('poison_attack', { chance: 30, duration: 3, hpPercentPerRound: 10 })] })),
  n(4, u('shadow_assassin', 'Shadow Assassin', [12, 6, 7, 10, 22, 9], 4, 520, 430, 380, 'humanoid',
    { ab: [NO_RETAL, a('double_damage_chance', { chance: 20 }), a('spying')] })),
  n(5, u('clockwork_knight', 'Clockwork Knight', [14, 14, 10, 16, 55, 7], 3, 980, 900, 600, 'rider',
    { ...BIG, ab: [MECH, a('jousting', { percentPerHex: 5 }), a('spell_damage_reduction', { percent: 50 })] })),
  n(6, u('frost_giant', 'Frost Giant', [17, 15, 20, 30, 120, 6], 2, 2200, 1900, 1300, 'giant',
    { ab: [MIND, immune(...ICE_DAMAGE), vulnerable(...FIRE_DAMAGE), a('reduce_enemy_defense', { percent: 20 })] })),
  n(6, u('bone_colossus', 'Bone Colossus', [16, 18, 18, 28, 140, 5], 2, 2300, 2100, 1400, 'undead',
    { ...BIG, ab: [UNDEAD, a('first_strike'), a('regeneration'), a('enemy_morale', { value: -1 })] })),
  n(7, u('storm_drake', 'Storm Drake', [22, 20, 35, 50, 220, 14], 1, 5600, 4300, [3500, 'mercury', 2], 'dragon',
    { ...BIGFLY, ab: [DRAGON, BREATH, immuneLvl(2), immune(...AIR_DAMAGE),
      a('lightning_strike', { chance: 20, damagePerCreature: 10 })] })),
];

/** Ids of the invented (non-H3) neutral creatures. */
export const ORIGINAL_NEUTRAL_IDS = [
  'will_o_wisp', 'dire_wolf', 'bog_witch', 'giant_spider', 'shadow_assassin', 'clockwork_knight',
  'frost_giant', 'bone_colossus', 'storm_drake',
];

// ---- War machines ------------------------------------------------------------------------------
function machine(unit) {
  unit.tier = 0;
  unit.warMachine = true;
  return [unit];
}
const IMMOBILE = a('immobile');
const machines = [
  machine(u('ballista', 'Ballista', [10, 10, 2, 3, 250, 0], 0, 600, 600, 2500, 'machine',
    { size: 2, shots: 24, ab: [MECH, IMMOBILE, a('hero_attack_scaling')] })),
  machine(u('cannon', 'Cannon', [20, 10, 4, 7, 250, 0], 0, 1200, 1200, 4000, 'machine',
    { size: 2, shots: 12, ab: [MECH, IMMOBILE, a('hero_attack_scaling'), a('no_obstacle_penalty'), a('siege_attack', { level: 1 })] })),
  machine(u('catapult', 'Catapult', [10, 10, 0, 0, 1000, 0], 0, 500, 500, 1000, 'machine',
    { size: 2, shots: 24, ab: [MECH, IMMOBILE, a('catapult')] })),
  machine(u('first_aid_tent', 'First Aid Tent', [0, 0, 0, 0, 75, 0], 0, 300, 300, 750, 'machine',
    { size: 2, ab: [MECH, IMMOBILE, a('heals', { min: 1, max: 25 })] })),
  machine(u('ammo_cart', 'Ammo Cart', [0, 5, 0, 0, 100, 0], 0, 400, 400, 1000, 'machine',
    { size: 2, ab: [MECH, IMMOBILE, a('ammo_supply')] })),
  machine(u('arrow_tower', 'Arrow Tower', [10, 10, 10, 15, 200, 0], 0, 400, 400, 1000, 'machine',
    { shots: 99, ab: [MECH, IMMOBILE, a('no_range_penalty'), a('no_obstacle_penalty')] })),
];

// ---- exports -----------------------------------------------------------------------------------

/** @type {Creature[]} */
export const CREATURES = [
  castle, rampart, tower, inferno, necropolis, dungeon, stronghold, fortress, conflux, cove,
  factory, neutrals, machines,
].flat(2);

/** @type {Record<string, Creature>} */
export const CREATURE_BY_ID = Object.fromEntries(CREATURES.map((c) => [c.id, c]));

/** @param {string} id @returns {Creature} */
export function getCreature(id) {
  const c = CREATURE_BY_ID[id];
  if (!c) throw new Error(`Unknown creature: ${id}`);
  return c;
}

/** All creatures of a faction (or 'neutral'), war machines excluded, ordered by tier then chain. */
export function creaturesOfFaction(faction) {
  return CREATURES.filter((c) => c.faction === faction && !c.warMachine);
}

/** Neutral creatures (no war machines). */
export function neutralCreatures() {
  return creaturesOfFaction(NEUTRAL);
}

/** War machine entries (ballista, cannon, catapult, first aid tent, ammo cart, arrow tower). */
export function getWarMachines() {
  return CREATURES.filter((c) => c.warMachine);
}

/** Creatures of a tier, optionally within one faction. War machines (tier 0) are never returned. */
export function creaturesOfTier(tier, faction = null) {
  return CREATURES.filter((c) => !c.warMachine && c.tier === tier && (!faction || c.faction === faction));
}

/** The creature this one upgrades to, or null. */
export function getUpgrade(id) {
  const to = getCreature(id).upgradesTo;
  return to ? getCreature(to) : null;
}

/** The un-upgraded root of this creature's chain (itself when it is a base creature). */
export function getBaseCreature(id) {
  let c = getCreature(id);
  while (c.upgradeOf) c = getCreature(c.upgradeOf);
  return c;
}

/** Whole upgrade chain containing `id`, base first. */
export function getUpgradeChain(id) {
  const chain = [getBaseCreature(id)];
  while (chain[chain.length - 1].upgradesTo) chain.push(getCreature(chain[chain.length - 1].upgradesTo));
  return chain;
}

/** True when `toId` is reachable from `fromId` by one or more upgrades. */
export function canUpgradeTo(fromId, toId) {
  let c = getCreature(fromId);
  while (c.upgradesTo) {
    c = getCreature(c.upgradesTo);
    if (c.id === toId) return true;
  }
  return false;
}

/**
 * Gold-and-resources price of upgrading one creature: the cost difference, never negative.
 * @returns {Object<string, number>}
 */
export function getUpgradeCost(fromId, toId) {
  if (!canUpgradeTo(fromId, toId)) throw new Error(`${fromId} cannot be upgraded to ${toId}`);
  const from = getCreature(fromId).cost;
  const to = getCreature(toId).cost;
  const out = {};
  for (const res of Object.keys(to)) {
    const diff = to[res] - (from[res] ?? 0);
    if (diff > 0) out[res] = diff;
  }
  return out;
}

/** The creature's ability entry with this id, or null. */
export function getCreatureAbility(creature, abilityId) {
  const c = typeof creature === 'string' ? getCreature(creature) : creature;
  return c.abilities.find((ab) => ab.id === abilityId) ?? null;
}

export function hasAbility(creature, abilityId) {
  return getCreatureAbility(creature, abilityId) !== null;
}

export function isShooter(creature) {
  const c = typeof creature === 'string' ? getCreature(creature) : creature;
  return c.shots > 0;
}

/** Representative damage spell per element: immunity/vulnerability to it implies the element tag. */
const ELEMENT_PROBE_SPELL = { fire: 'fireball', cold: 'ice_bolt', lightning: 'lightning_bolt', earth: 'meteor_shower' };

/**
 * Classification tags used by spell `immune` lists and by abilities:
 * 'undead' | 'non_living' | 'mechanical' | 'living' | 'mind_immune' | 'elemental' | 'dragon' |
 * 'war_machine' | 'flying' | 'shooter' | 'sightless' | '<fire|cold|lightning|earth>_immune' |
 * '<element>_vulnerable'. Derived rules: mechanical => non_living;
 * undead / non_living => mind_immune; neither undead nor non_living => living;
 * spell_level_immunity 5 => mind_immune.
 * @returns {string[]}
 */
export function creatureTags(creature) {
  const c = typeof creature === 'string' ? getCreature(creature) : creature;
  const has = (id) => c.abilities.some((ab) => ab.id === id);
  const tags = new Set();
  for (const ab of c.abilities) if (ABILITIES[ab.id].kind === 'tag') tags.add(ab.id);
  if (tags.has('mechanical')) tags.add('non_living');
  if (!tags.has('undead') && !tags.has('non_living')) tags.add('living');
  if (tags.has('undead') || tags.has('non_living')) tags.add('mind_immune');
  if (c.abilities.some((ab) => ab.id === 'spell_level_immunity' && ab.maxLevel >= 5)) tags.add('mind_immune');
  // Element tags shared with src/data/spells.js (IMMUNITY_TAGS / VULNERABILITY_TAGS).
  const listed = (abilityId) => c.abilities.filter((ab) => ab.id === abilityId).flatMap((ab) => ab.spells);
  const immuneTo = listed('spell_immunity');
  const vulnerableTo = listed('spell_vulnerability');
  for (const [element, probe] of Object.entries(ELEMENT_PROBE_SPELL)) {
    if (immuneTo.includes(probe)) tags.add(`${element}_immune`);
    if (vulnerableTo.includes(probe)) tags.add(`${element}_vulnerable`);
  }
  if (c.abilities.some((ab) => ab.id === 'school_immunity' && ab.school === 'fire')) tags.add('fire_immune');
  if (immuneTo.includes('blind')) tags.add('sightless');
  if (c.warMachine) tags.add('war_machine');
  if (c.flying || has('teleport')) tags.add('flying');
  if (c.shots > 0) tags.add('shooter');
  return [...tags];
}

export function hasTag(creature, tag) {
  return creatureTags(creature).includes(tag);
}

/** `[[base, upgraded], ...]` grouped by tier for a town faction (index 0 = tier 1). */
export function factionLineup(faction) {
  if (!FACTIONS.includes(faction)) throw new Error(`Unknown faction: ${faction}`);
  const tiers = [];
  for (let tier = 1; tier <= 7; tier++) {
    tiers.push(creaturesOfTier(tier, faction).filter((c) => !c.upgradeOf).map((c) => getUpgradeChain(c.id).map((x) => x.id)));
  }
  return tiers;
}
