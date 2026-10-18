// Creature sprites: per-id spec table on top of the parametric rigs, pose/animation handling.
// Design grid: 100 units high, 100 wide (1-hex) or 200 wide (2-hex); ground line at y = 92;
// creatures face right (the sprite cache mirrors for facing -1).

import { CREATURE_BY_ID } from '../data/creatures.js';
import { hashStr, shade, tweak } from './kit.js';
import { factionPalette } from './palette.js';
import { humanoid } from './rigHumanoid.js';
import { bird, dragon, dragonfly, elemental, floatingEye, machine, quadruped, serpent, spider, treefolk } from './rigBeasts.js';

export const CREATURE_GROUND = 92;

/** Number of animation frames per state. */
export const STATE_FRAMES = { idle: 4, move: 4, attack: 3, shoot: 3, hit: 2, defend: 1, dead: 2 };
export const CREATURE_STATES = Object.keys(STATE_FRAMES);

const BONE = '#e4dcc4';

// rig: h humanoid | q quadruped | d dragon | b bird | s serpent | fly | spider | eye | tree | e elemental | m machine
// Upgraded creatures inherit the spec of their base and only list differences.
const SPECS = {
  // ---- Castle
  pikeman: { rig: 'h', armor: 'plate', hat: 'helm', weapon: 'pike' },
  halberdier: { weapon: 'halberd', hat: 'crest' },
  archer: { rig: 'h', armor: 'leather', hat: 'cap', hatC: '#3f6fb5', feather: '#f0f0f0', weapon: 'bow', s: 0.84 },
  marksman: { hat: 'helm', armor: 'plate', weapon: 'longbow', cape: '#2f5fa5' },
  griffin: { rig: 'q', head: 'eagle', color: '#c89a4a', headC: '#f0ece0', wings: 'feather', wingC: '#b8843a', tail: 'lion', tailC: '#7a5a2a', claws: true, neckL: 14, neckA: -52, headK: 1.25, legL: 24 },
  royal_griffin: { headC: '#ffffff', wingC: '#e8c860', color: '#d8a84a', eyes: '#ffe040', headK: 1.35 },
  swordsman: { rig: 'h', armor: 'plate', head: 'visor', weapon: 'sword', shield: 'kite' },
  crusader: { weapon: 'greatsword', shield: null, hat: 'crest', cape: '#f0ece0', emblem: 'cross', weaponK: 1.05 },
  monk: { rig: 'h', armor: 'robe', cloth: '#8a4a2a', hat: 'hood', weapon: 'orb', glowC: '#ffb040', trim: '#d8c080', hair: 'bald' },
  zealot: { cloth: '#e8e0d0', hoodC: '#c03a2a', glowC: '#ffe070', emblem: 'cross', cloth2: '#c03a2a' },
  cavalier: { rig: 'q', head: 'horse', color: '#8a5a3a', mane: '#3a2418', armor: '#3f6fb5', bridle: '#e8c860', rider: { armor: 'plate', head: 'visor', weapon: 'lance', s: 0.8, shield: 'kite', hat: 'helm' } },
  champion: { color: '#f0ece0', mane: '#d8d0c0', armor: '#b83a2a', rider: { hat: 'crest', crestC: '#c03a2a', cape: '#c03a2a', metal: '#e0d8b8' } },
  angel: { rig: 'h', armor: 'plate', metal: '#e4e0d4', cloth: '#f8f4e8', wings: 'feather', wingK: 0.7, weapon: 'sword', hair: 'long', hairC: '#f0d060', hover: 5, s: 0.93 },
  arch_angel: { halo: true, weapon: 'flamesword', wingK: 0.76, wingC: '#fff8e0', metal: '#f0d878' },
  // ---- Rampart
  centaur: { rig: 'q', rider: null, head: 'horse', color: '#9a6a3a', tailC: '#4a3020', centaur: { armor: 'bare', cloth: '#3c8c3c', weapon: 'spear', s: 0.72, hairC: '#4a3020', beard: 'short', skin: '#e0b088' } },
  centaur_captain: { color: '#6a4a2a', armor: '#3c8c3c', centaur: { armor: 'plate', hat: 'helm', shield: 'round', weapon: 'halberd' } },
  dwarf: { rig: 'h', s: 0.72, build: 1.45, headK: 1.25, beard: 'big', hairC: '#c8703a', hat: 'helm', armor: 'leather', cloth: '#6a5a3a', weapon: 'hammer', legs: 'short' },
  battle_dwarf: { hat: 'hornhelm', weapon: 'battleaxe', armor: 'plate', beardC: '#e8e0d0' },
  wood_elf: { rig: 'h', s: 0.86, build: 0.85, armor: 'leather', cloth: '#3c8c3c', ears: 'point', hair: 'long', hairC: '#d8c060', weapon: 'bow' },
  grand_elf: { cape: '#2e6e2e', cloth: '#4aa04a', weapon: 'longbow', weaponC: '#e8c860', hat: 'leaves' },
  pegasus: { rig: 'q', head: 'horse', color: '#f0ece4', mane: '#c8d8f0', wings: 'feather', wingC: '#f8f8ff', wingK: 0.85, rider: { armor: 'leather', cloth: '#3c8c3c', hair: 'long', hairC: '#d8c060', ears: 'point', weapon: 'spear', s: 0.62, skin: '#e8c0a0' } },
  silver_pegasus: { color: '#d0d8ec', wingC: '#b8c8f0', bridle: '#e8c860', rider: { armor: 'plate', hat: 'helm' } },
  dendroid_guard: { rig: 'tree', color: '#6a4a2a', leaf: '#3a8a34' },
  dendroid_soldier: { leaf: '#58a83a', color: '#5a3e24', fruit: '#e84a3a' },
  unicorn: { rig: 'q', head: 'horse', color: '#f4f0e8', mane: '#e8d070', horn: true },
  war_unicorn: { armor: '#3c8c3c', mane: '#f0e080', bridle: '#e8c860' },
  green_dragon: { rig: 'd', color: '#3a8a3a', belly: '#c8d880' },
  gold_dragon: { color: '#e0b030', belly: '#f8e8a0', wingC: '#c88a20', crest: true },
  // ---- Tower
  gremlin: { rig: 'h', s: 0.64, build: 0.95, headK: 1.3, skin: '#6a8ab0', ears: 'big', armor: 'bare', cloth: '#8a5a2a', weapon: 'ball', hair: 'bald', legs: 'short' },
  master_gremlin: { skin: '#8a6ab0', cloth: '#c0a040', eyes: '#ffe040' },
  stone_gargoyle: { rig: 'h', skin: '#8a8a8a', armor: 'bare', cloth: '#6a6a6a', wings: 'bat', wingK: 0.75, horns: 0.4, hornC: '#6a6a6a', head: 'beast', snout: 0.5, ears: 'none', claws: true, tail: 'devil', hover: 4, s: 0.85, hair: 'bald' },
  obsidian_gargoyle: { skin: '#3a3440', cloth: '#2a2430', hornC: '#2a2430', eyes: '#ff5030' },
  stone_golem: { rig: 'h', head: 'golem', skin: '#9a9488', armor: 'bare', cloth: '#7a746a', build: 1.45, s: 0.9, headK: 0.95, hair: 'bald' },
  iron_golem: { skin: '#6a7080', cloth: '#4a5060', eyes: '#ff6030', emblem: 'gear' },
  mage: { rig: 'h', armor: 'robe', cloth: '#3a5ab0', hat: 'turban', beard: 'short', beardC: '#e8e8e8', weapon: 'staff', glowC: '#6ad0ff', s: 0.92 },
  arch_mage: { cloth: '#6a3ab0', hat: 'wizard', beard: 'big', cape: '#3a2a6a', glowC: '#ffe070' },
  genie: { rig: 'h', skin: '#5a9ae0', armor: 'bare', cloth: '#e8c040', legs: 'smoke', smokeC: '#9ac8f0', hover: 6, hair: 'top', hairC: '#1a1a2a', build: 1.2, castC: '#6ad0ff', ears: 'point', s: 0.95 },
  master_genie: { skin: '#4a7ad8', hat: 'turban', armor: 'vest', cloth: '#c03a8a', hair: 'bald' },
  naga: { rig: 's', top: 'human', color: '#3a8a9a', arms: 4, human: { armor: 'bare', skin: '#d8b090', cloth: '#3a8a9a', hair: 'long', hairC: '#1a1a2a', s: 0.72, armless: true } },
  naga_queen: { color: '#8a3ab0', arms: 6, human: { hat: 'crown', cloth: '#8a3ab0' } },
  giant: { rig: 'h', s: 1.02, build: 1.25, headK: 0.9, armor: 'cloth', cloth: '#7a6ab0', sleeveless: true, beard: 'short', hairC: '#6a4a2a', weapon: 'club' },
  titan: { armor: 'plate', metal: '#e0b840', hat: 'helm', weapon: 'lightning', cape: '#3a5ab0', s: 1.06, beardC: '#f0f0f0', sleeveless: false, weaponK: 1.2 },
  // ---- Inferno
  imp: { rig: 'h', s: 0.62, headK: 1.3, skin: '#b0502a', armor: 'bare', cloth: '#5a2a1a', wings: 'bat', wingK: 0.7, horns: 0.3, tail: 'devil', ears: 'point', hair: 'bald', claws: true, legs: 'short' },
  familiar: { skin: '#c03a5a', eyes: '#ffe040', wingK: 0.85, horns: 0.5 },
  gog: { rig: 'h', skin: '#c8483a', armor: 'bare', cloth: '#4a2a2a', horns: 0.4, weapon: 'fireball', hair: 'bald', tail: 'devil', s: 0.84 },
  magog: { skin: '#e0602a', horns: 0.6, weaponK: 1.3, eyes: '#ffe040' },
  hell_hound: { rig: 'q', head: 'wolf', color: '#6a2a22', tail: 'wolf', tailC: '#3a1a14', eyes: '#ffb030', claws: true, neckL: 12, neckA: -40, legL: 22, bodyH: 22, L: 58, headK: 1.2 },
  cerberus: { heads: 3, color: '#4a2228', spikes: '#2a1218' },
  demon: { rig: 'h', skin: '#b03a2a', armor: 'bare', cloth: '#3a2a2a', horns: 0.5, build: 1.3, claws: true, hair: 'bald', tail: 'devil', s: 0.92, fangs: true },
  horned_demon: { skin: '#8a2a3a', horns: 1.0, hornC: '#f0d8a0' },
  pit_fiend: { rig: 'h', skin: '#7a2a2a', armor: 'bare', cloth: '#2a1a2a', horns: 0.6, wings: 'bat', wingK: 0.6, weapon: 'whip', hair: 'bald', build: 1.2, s: 0.95, legs: 'hooves' },
  pit_lord: { offhand: 'sword', skin: '#5a2a3a', horns: 0.9, weaponC: '#ffb030' },
  efreet: { rig: 'h', skin: '#e0602a', armor: 'bare', cloth: '#8a2a1a', legs: 'flame', hover: 5, horns: 0.4, hair: 'bald', build: 1.25, ears: 'point', castC: '#ff8020' },
  efreet_sultan: { skin: '#f0802a', aura: true, glowC: '#ff8020', horns: 0.7, hat: 'crown' },
  devil: { rig: 'h', s: 0.95, skin: '#c02a2a', armor: 'bare', cloth: '#2a2a3a', horns: 0.8, weapon: 'scythe', hair: 'bald', tail: 'devil', legs: 'hooves', build: 1.15, eyes: '#ffe040' },
  arch_devil: { skin: '#e04a1a', cape: '#2a2a6a', horns: 1.1, hornC: '#f0d060' },
  // ---- Necropolis
  skeleton: { rig: 'h', head: 'skull', skin: BONE, armor: 'bare', cloth: '#5a5040', emblem: 'ribs', build: 0.8, weapon: 'cutlass', hair: 'bald', s: 0.86 },
  skeleton_warrior: { shield: 'bone', hat: 'helm', metal: '#7a7a82' },
  walking_dead: { rig: 'h', skin: '#8aa07a', armor: 'cloth', cloth: '#5a5a4a', zombie: true, hairC: '#2a2a22', sleeveless: true, s: 0.9 },
  zombie: { skin: '#6a8a6a', cloth: '#4a3a4a', weapon: 'hatchet', hair: 'bald' },
  wight: { rig: 'h', armor: 'cloth', legs: 'ghost', hat: 'hood', cloth: '#b8c0b0', skin: BONE, head: 'skull', hover: 6, alphaK: 0.88, eyes: '#60ff90', claws: true },
  wraith: { cloth: '#5a6a7a', eyes: '#ff4040', alphaK: 0.85, hat: 'hood', horns: 0.3 },
  vampire: { rig: 'h', skin: '#d8d4d8', armor: 'coat', cloth: '#2a2430', cape: '#7a1a2a', hairC: '#1a1a1a', fangs: true, hover: 4, eyes: '#d03030' },
  vampire_lord: { wings: 'bat', wingC: '#3a2a3a', wingK: 0.7, cape: '#a01a2a', hairC: '#e8e8e8' },
  lich: { rig: 'h', head: 'skull', armor: 'robe', cloth: '#5a3a7a', hat: 'hood', weapon: 'skullstaff', eyes: '#60ff90', skin: BONE },
  power_lich: { hat: 'crown', cloth: '#3a2a6a', aura: true, glowC: '#60ff90', cape: '#2a1a3a' },
  black_knight: { rig: 'q', head: 'horse', color: '#2a2630', mane: '#1a1a1a', armor: '#3a3444', eyes: '#ff4040', rider: { armor: 'plate', metal: '#4a4a56', head: 'visor', eyes: '#ff4040', weapon: 'sword', s: 0.8, cape: '#4a1a2a' } },
  dread_knight: { armor: '#5a1a2a', rider: { hat: 'hornhelm', weapon: 'greatsword', metal: '#2e2e36' } },
  bone_dragon: { rig: 'd', bone: true, wings: 'bone', eyes: '#60ff90', breath: '#90ffa0', color: BONE },
  ghost_dragon: { ghost: '#70e0a0' },
  mummy: { rig: 'h', skin: '#d8c890', armor: 'bare', cloth: '#b8a870', bandages: true, zombie: true, hair: 'bald', eyes: '#ffe040' },
  bone_colossus: { rig: 'h', head: 'skull', skin: BONE, armor: 'bare', cloth: '#4a4038', emblem: 'ribs', s: 1.1, build: 1.5, weapon: 'boneclub', horns: 0.6, eyes: '#60ff90', hair: 'bald', weaponK: 1.3 },
  // ---- Dungeon
  troglodyte: { rig: 'h', skin: '#8a6a8a', head: 'beast', eyes: 'none', snout: 0.6, armor: 'bare', cloth: '#4a3a2a', weapon: 'spear', s: 0.8, hair: 'bald', ears: 'none' },
  infernal_troglodyte: { skin: '#a04a5a', weapon: 'trident', horns: 0.3 },
  harpy: { rig: 'h', armless: true, wings: 'feather', wingC: '#8a6a4a', wingK: 0.8, skin: '#d8b090', armor: 'bare', cloth: '#6a4a3a', legs: 'talons', hair: 'wild', hairC: '#3a2a2a', hover: 6, s: 0.82 },
  harpy_hag: { wingC: '#4a4a5a', hairC: '#5a8a4a', skin: '#b8a8a0' },
  beholder: { rig: 'eye', color: '#8a5a7a', iris: '#40a060', tentacles: 5 },
  evil_eye: { color: '#6a3a5a', iris: '#e03030', stalks: 4, tentacles: 7 },
  medusa: { rig: 's', top: 'human', color: '#5a8a4a', snakeHair: '#4aa040', rattle: true, human: { armor: 'leather', skin: '#b8c890', cloth: '#7a4a8a', weapon: 'bow', hair: 'bald', s: 0.72 } },
  medusa_queen: { color: '#8a6a3a', snakeHair: '#c8a030', human: { hat: 'crown', cloth: '#a03a6a' } },
  minotaur: { rig: 'h', head: 'bull', skin: '#8a5a3a', armor: 'bare', cloth: '#6a3a8a', weapon: 'battleaxe', build: 1.35, s: 0.98, legs: 'hooves', hair: 'bald', headK: 1.1 },
  minotaur_king: { skin: '#6a4a3a', hornC: '#e8c040', cape: '#7a2a2a', weaponC: '#e8c860' },
  manticore: { rig: 'q', head: 'lion', color: '#c88a4a', maneC: '#7a3a1a', wings: 'bat', wingC: '#8a4a3a', tail: 'scorpion', claws: true, neckL: 8, neckA: -30, legL: 22, headK: 1.2 },
  scorpicore: { color: '#a0603a', maneC: '#4a1a3a', wingC: '#5a2a4a', tailC: '#4a1a3a' },
  red_dragon: { rig: 'd', color: '#c0302a', belly: '#e8a060' },
  black_dragon: { color: '#2a2a32', belly: '#8a3a3a', wingC: '#3a2a3a', breath: '#ff5020', crest: true, eyes: '#ff5030' },
  // ---- Stronghold
  goblin: { rig: 'h', s: 0.7, headK: 1.25, skin: '#7a9a4a', ears: 'point', armor: 'leather', cloth: '#8a5a2a', weapon: 'mace', hair: 'bald', legs: 'short', nose: true },
  hobgoblin: { hat: 'helm', skin: '#5a8a3a', cloth: '#a03a2a', shield: 'wood' },
  wolf_rider: { rig: 'q', head: 'wolf', color: '#7a7a7a', tail: 'wolf', claws: true, neckL: 10, neckA: -35, legL: 21, bodyH: 21, L: 56, headK: 1.15, rider: { s: 0.62, headK: 1.25, skin: '#7a9a4a', ears: 'point', armor: 'leather', cloth: '#8a5a2a', weapon: 'mace', hair: 'bald' } },
  wolf_raider: { color: '#4a4a52', eyes: '#ffb030', rider: { hat: 'helm', weapon: 'cutlass', cloth: '#a03a2a' } },
  orc: { rig: 'h', skin: '#c89a7a', head: 'beast', snout: 0.45, tusks: true, armor: 'fur', cloth: '#7a5a3a', weapon: 'hatchet', build: 1.2, s: 0.88 },
  orc_chieftain: { hat: 'hornhelm', armor: 'leather', cloth: '#8a2a2a', weapon: 'axe' },
  ogre: { rig: 'h', skin: '#b8a85a', armor: 'bare', cloth: '#6a4a2a', build: 1.5, belly: 0.25, s: 0.98, headK: 0.85, weapon: 'club', hair: 'top', hairC: '#2a1a1a', tusks: true },
  ogre_mage: { skin: '#6a8ab0', hat: 'headdress', weapon: 'skullstaff', cloth: '#8a2a2a', castC: '#ff6040' },
  roc: { rig: 'b', color: '#8a5a3a', headC: '#a87a4a', wingC: '#7a4a2a' },
  thunderbird: { color: '#b88a3a', wingC: '#c89a3a', bolts: true, crest: '#e8d040', eyes: '#fff8a0', headC: '#e8d8a0' },
  cyclops: { rig: 'h', head: 'cyclops', skin: '#c8a070', armor: 'bare', cloth: '#6a4a8a', build: 1.35, s: 1.02, weapon: 'rock', hairC: '#3a2a1a', headK: 1.05 },
  cyclops_king: { skin: '#b88a5a', hat: 'crown', horns: 0.4, cloth: '#a03a2a', weaponK: 1.2 },
  behemoth: { rig: 'q', head: 'behemoth', color: '#b08a4a', tail: 'short', claws: true, L: 60, bodyH: 32, legL: 26, legW: 10, neckL: 6, neckA: -20, headK: 1.5 },
  ancient_behemoth: { color: '#8a5a3a', spikes: '#e8e0c8', eyes: '#ff5030' },
  // ---- Fortress
  gnoll: { rig: 'h', head: 'beast', snout: 0.75, skin: '#b89a5a', armor: 'leather', cloth: '#4f7f6a', weapon: 'flail', s: 0.85 },
  gnoll_marauder: { hat: 'hood', hoodC: '#3a5a8a', skin: '#a08a4a', weaponK: 1.2, shield: 'wood' },
  lizardman: { rig: 'h', head: 'lizard', skin: '#5a9a4a', tail: 'lizard', armor: 'leather', cloth: '#8a6a3a', weapon: 'bow', s: 0.85, crestC: '#c05a2a', hair: 'bald' },
  lizard_warrior: { armor: 'plate', metal: '#a89a5a', skin: '#3a8a5a', weapon: 'longbow' },
  serpent_fly: { rig: 'fly', color: '#4a9a3a', s: 0.85 },
  dragon_fly: { color: '#c0502a', sting: true, s: 1, eyeC: '#ffe040' },
  basilisk: { rig: 'q', head: 'lizard', color: '#5a8a3a', belly: '#c8c070', tail: 'lizard', legs: 6, legL: 14, bodyH: 20, L: 64, neckL: 8, neckA: -25, claws: true, headK: 1.3, crestC: '#c05a2a' },
  greater_basilisk: { color: '#3a7a6a', crestC: '#e8c040', eyes: '#ffe040', spikes: '#2a5a4a' },
  gorgon: { rig: 'q', head: 'bull', color: '#5a5a6a', plates: '#6a6a7a', tail: 'lion', legL: 22, bodyH: 28, neckL: 6, neckA: -10, headK: 1.3, hornC: '#d8d0c0' },
  mighty_gorgon: { color: '#3a3a4a', plates: '#4a4a5e', eyes: '#40ff80', hornC: '#e8c040' },
  wyvern: { rig: 'd', color: '#6a8a4a', belly: '#c8c090', frontLegs: false, stinger: true, s: 0.8 },
  wyvern_monarch: { color: '#8a6a3a', crest: true, wingC: '#a04a2a', s: 0.84 },
  hydra: { rig: 's', top: 'heads', heads: 3, color: '#4a7a5a', belly: '#b8c088' },
  chaos_hydra: { heads: 5, color: '#7a5a3a', headCs: ['#8a6a3a', '#6a7a3a', '#9a5a3a'], eyes: '#ffe040' },
  // ---- Conflux
  pixie: { rig: 'h', s: 0.58, headK: 1.3, wings: 'fairy', wingC: '#b8e8ff', skin: '#f0d0b8', armor: 'cloth', cloth: '#5ab05a', hair: 'long', hairC: '#e8a040', hover: 14, ears: 'point', sleeveless: true },
  sprite: { cloth: '#5a8ae0', wingC: '#e8b8ff', hairC: '#f0e070', aura: true, glowC: '#c0e0ff' },
  air_elemental: { rig: 'e', type: 'air', color: '#b8d8f0' },
  storm_elemental: { color: '#7a8ab8', bolts: true, eyeC: '#fff8a0' },
  water_elemental: { rig: 'e', type: 'water', color: '#3a7ad8' },
  ice_elemental: { type: 'ice', color: '#9ad0f0' },
  fire_elemental: { rig: 'e', type: 'fire', color: '#e0401a' },
  energy_elemental: { type: 'energy', color: '#f0a020', mid: '#ffe070', core: '#ffffff' },
  earth_elemental: { rig: 'h', head: 'golem', skin: '#7a6a4a', armor: 'bare', cloth: '#5a4a32', build: 1.5, s: 0.92, eyes: '#60ff60', emblem: 'cracks', glowC: '#3a2a1a', hair: 'bald' },
  magma_elemental: { skin: '#4a3430', cloth: '#2e1c1c', glowC: '#ff7020', eyes: '#ffb030' },
  psychic_elemental: { rig: 'h', skin: '#c8a0e8', armor: 'bare', cloth: '#8a4ac0', aura: true, glowC: '#c060ff', hover: 5, legs: 'smoke', smokeC: '#d8b0f0', hair: 'bald', eyes: '#ffffff', build: 1.1, castC: '#c060ff' },
  magic_elemental: { skin: '#f0d0f8', cloth: '#e0a030', glowC: '#ff80e0', hat: 'crown' },
  firebird: { rig: 'b', color: '#e0502a', wingC: '#e8762a', flame: '#ff8020', headC: '#f0a030', crest: '#ffd040' },
  phoenix: { color: '#f0a020', wingC: '#ffc030', flame: '#ffb020', headC: '#ffe070', eyes: '#ffffff' },
  // ---- Cove
  nymph: { rig: 'h', skin: '#8ad0e0', armor: 'robe', cloth: '#3a8ab0', sleeveless: true, hair: 'long', hairC: '#2a6a9a', s: 0.8, castC: '#6ad0ff', trim: '#bfe8f8' },
  oceanid: { skin: '#a0e0f0', cloth: '#2a6ac0', hat: 'crown', aura: true, glowC: '#6ad0ff' },
  crew_mate: { rig: 'h', armor: 'vest', cloth: '#8a5a3a', hat: 'bandana', weapon: 'club', s: 0.86 },
  seaman: { armor: 'cloth', cloth: '#e8e0d0', stripes: '#2a5a9a', weapon: 'cutlass', hatC: '#2a5a9a' },
  pirate: { rig: 'h', armor: 'coat', cloth: '#7a2a2a', hat: 'bandana', weapon: 'pistol', beard: 'short', s: 0.9 },
  corsair: { hat: 'tricorn', offhand: 'cutlass', cloth: '#2a4a7a' },
  sea_dog: { hat: 'tricorn', hatC: '#1a1a1a', patch: true, cloth: '#2a2a32', beard: 'big', beardC: '#e8e8e8', weapon: 'blunderbuss' },
  stormbird: { rig: 'b', s: 0.62, wingS: 46, color: '#7a8aa8', headC: '#e8e8f0', wingC: '#5a6a8a' },
  ayssid: { color: '#2a9a9a', wingC: '#e8c040', crest: '#e8c040', headC: '#f0f0e0' },
  sea_witch: { rig: 'h', armor: 'robe', cloth: '#2a7a7a', hair: 'long', hairC: '#3a2a4a', castC: '#60e0c0', s: 0.88 },
  sorceress: { cloth: '#6a3a9a', weapon: 'staff', glowC: '#c060ff', hat: 'crown' },
  nix: { rig: 'h', head: 'fish', skin: '#3a7a9a', armor: 'plate', metal: '#7a9aa8', weapon: 'mace', shield: 'round', tail: 'fish', s: 0.95, build: 1.15 },
  nix_warrior: { metal: '#d8b040', skin: '#2a6a8a', weapon: 'trident' },
  sea_serpent: { rig: 's', top: 'snake', water: '#3a74b8', color: '#3a9a8a', fins: '#e8762a' },
  haspid: { color: '#8a3a9a', fins: '#e8c040', eyes: '#ffe040' },
  // ---- Factory
  halfling: { rig: 'h', s: 0.64, headK: 1.3, armor: 'cloth', cloth: '#6a8a3a', hairC: '#8a5a2a', weapon: 'sling', legs: 'short', hat: 'cap', hatC: '#8a5a2a' },
  halfling_grenadier: { weapon: 'bomb', hat: 'helm', armor: 'leather' },
  mechanic: { rig: 'h', armor: 'leather', cloth: '#8a6a3a', hat: 'goggles', weapon: 'wrench', s: 0.86 },
  engineer: { hat: 'tophat', hatC: '#4a3a2a', pack: '#b0864a', emblem: 'gear', weaponK: 1.2 },
  armadillo: { rig: 'q', head: 'armadillo', color: '#b89a6a', plates: '#a0825a', tail: 'lizard', legL: 13, bodyH: 26, L: 56, neckL: 5, neckA: -5, claws: true, headK: 1.2 },
  bellwether_armadillo: { plates: '#8a8e98', color: '#a08a6a', spikes: '#e0b040' },
  automaton: { rig: 'h', head: 'golem', skin: '#b0864a', armor: 'bare', cloth: '#6a5a4a', build: 1.3, s: 0.85, emblem: 'gear', eyes: '#60d0ff', hair: 'bald' },
  sentinel_automaton: { skin: '#9aa0b0', eyes: '#ff5030', shield: 'round', shieldC: '#6a7080' },
  sandworm: { rig: 's', top: 'worm', color: '#c8a060', groundC: '#b89a58' },
  olgoi_khorkhoi: { color: '#b0483a', sparks: true, spines: '#3a1a1a' },
  gunslinger: { rig: 'h', armor: 'coat', cloth: '#8a6a4a', hat: 'cowboy', hatC: '#5a3a22', weapon: 'gun', s: 0.92 },
  bounty_hunter: { cloth: '#3a3a42', hatC: '#1a1a1a', cape: '#6a2a2a', beard: 'short' },
  couatl: { rig: 's', top: 'snake', wings: true, wingC: '#3ab08a', color: '#3a9a5a', feathers: ['#e84a3a', '#f0c030', '#3a8ae0'] },
  crimson_couatl: { color: '#c0302a', wingC: '#e8762a', feathers: ['#f0c030', '#ffffff', '#e8762a'], eyes: '#ffe040' },
  dreadnought: { rig: 'm', type: 'walker', color: '#8a8e98' },
  juggernaut: { color: '#5a5e6a', saw: true, trim: '#e0b040', eyes: '#ff5030' },
  // ---- War machines
  ballista: { rig: 'm', type: 'ballista' },
  cannon: { rig: 'm', type: 'cannon' },
  catapult: { rig: 'm', type: 'catapult' },
  first_aid_tent: { rig: 'm', type: 'first_aid_tent' },
  ammo_cart: { rig: 'm', type: 'ammo_cart' },
  arrow_tower: { rig: 'm', type: 'arrow_tower' },
  // ---- Neutral
  peasant: { rig: 'h', armor: 'cloth', cloth: '#9a8a5a', hat: 'straw', weapon: 'pitchfork', s: 0.82 },
  rogue: { rig: 'h', armor: 'leather', cloth: '#4a4a3a', hat: 'hood', weapon: 'dagger', s: 0.84, cape: '#3a3a2e' },
  leprechaun: { rig: 'h', s: 0.62, headK: 1.3, armor: 'coat', cloth: '#2a8a3a', hat: 'tophat', hatC: '#2a8a3a', beard: 'short', hairC: '#e8762a', weapon: 'mug', legs: 'short' },
  satyr: { rig: 'h', armor: 'bare', skin: '#d8a880', cloth: '#6a4a2a', legC: '#6a4a2a', legs: 'hooves', horns: 0.4, beard: 'goatee', hairC: '#4a3020', weapon: 'pipes', s: 0.86 },
  sharpshooter: { rig: 'h', armor: 'leather', cloth: '#3a6a3a', hat: 'hood', cape: '#2a4a2a', weapon: 'longbow', s: 0.9 },
  shadow_assassin: { rig: 'h', armor: 'leather', cloth: '#2a2a32', hat: 'hood', weapon: 'dagger', offhand: 'dagger', eyes: '#c060ff', cape: '#1a1a22', skin: '#5a5060', s: 0.9 },
  nomad: { rig: 'q', head: 'horse', color: '#b89a6a', mane: '#3a2a1a', armor: '#a04a2a', rider: { armor: 'cloth', cloth: '#e8e0d0', hat: 'turban', weapon: 'cutlass', s: 0.8, skin: '#c89868' } },
  boar: { rig: 'q', head: 'boar', color: '#6a4a3a', bristle: '#2a1a14', tail: 'short', legL: 16, bodyH: 26, L: 54, neckL: 4, neckA: -5, headK: 1.4 },
  fangarm: { rig: 'h', head: 'beast', skin: '#c8b040', snout: 0.5, tusks: true, armor: 'bare', cloth: '#8a7a2a', build: 1.3, claws: true, s: 0.9, eyes: '#60ff90', horns: 0.3 },
  dire_wolf: { rig: 'q', head: 'wolf', color: '#5a5a62', tail: 'wolf', claws: true, eyes: '#ffe040', legL: 24, L: 60, neckL: 10, neckA: -35, headK: 1.2, bodyH: 23 },
  enchanter: { rig: 'h', armor: 'robe', cloth: '#4a9a8a', hat: 'wizard', weapon: 'staff', glowC: '#80ffd0', beard: 'short', beardC: '#e8e8e8' },
  bog_witch: { rig: 'h', armor: 'robe', cloth: '#4a5a3a', hat: 'witch', hatC: '#2a2a2a', weapon: 'broom', hair: 'long', hairC: '#8a8a8a', skin: '#a8c088', castC: '#80ff60', nose: true },
  troll: { rig: 'h', skin: '#5a8a5a', armor: 'fur', cloth: '#6a4a2a', sleeveless: true, build: 1.35, s: 0.98, weapon: 'club', nose: true, hair: 'wild', hairC: '#2a3a2a', tusks: true },
  frost_giant: { rig: 'h', skin: '#a8d0f0', armor: 'fur', cloth: '#e8eef4', sleeveless: true, build: 1.3, s: 1.03, weapon: 'iceclub', beard: 'big', beardC: '#ffffff', hairC: '#ffffff', hat: 'hornhelm', headK: 0.9 },
  steel_golem: { rig: 'h', head: 'golem', skin: '#b8c0cc', armor: 'bare', cloth: '#8a92a0', build: 1.45, s: 0.92, hair: 'bald', eyes: '#60d0ff' },
  gold_golem: { rig: 'h', head: 'golem', skin: '#e0b840', armor: 'bare', cloth: '#b88a20', build: 1.45, s: 0.92, hair: 'bald', eyes: '#ffffff' },
  diamond_golem: { rig: 'h', head: 'golem', skin: '#a8f0f0', armor: 'bare', cloth: '#6ad0e0', build: 1.45, s: 0.94, hair: 'bald', aura: true, glowC: '#c0ffff', emblem: 'gem', eyes: '#ffffff' },
  giant_spider: { rig: 'spider', color: '#3a2a3a', mark: '#d03a3a' },
  will_o_wisp: { rig: 'e', type: 'wisp', color: '#80ffc0' },
  storm_drake: { rig: 'd', color: '#5a6a9a', belly: '#c8d0e8', marks: '#fff8a0', breath: '#a0d0ff', s: 0.82 },
  clockwork_knight: { rig: 'q', head: 'horse', mech: true, color: '#b0864a', tail: 'short', tailC: '#8a6a3a', hoofC: '#5a5a62', eyes: '#60d0ff', rider: { armor: 'plate', metal: '#c89a3a', head: 'visor', weapon: 'lance', s: 0.8, eyes: '#60d0ff' } },
  faerie_dragon: { rig: 'd', color: '#e06ab0', belly: '#f8d0e8', wings: 'butterfly', wingC: '#60d0c0', wing2: '#f0d040', s: 0.72, spikes: false, breath: '#c060ff' },
  rust_dragon: { rig: 'd', color: '#b0582a', belly: '#e0b070', wingC: '#8a3a1a', breath: '#c8d040', s: 0.92 },
  crystal_dragon: { rig: 'd', color: '#c84a8a', belly: '#f0b0d0', wings: 'none', crystal: '#f08ac0', breath: null, s: 0.95 },
  azure_dragon: { rig: 'd', color: '#2a6ad0', belly: '#a8d0f8', wingC: '#1a4aa0', crest: true, s: 0.96, wingK: 0.92, breath: '#80c0ff' },
};

const SHAPE_RIG = {
  humanoid: 'h', caster: 'h', undead: 'h', giant: 'h', construct: 'h', rider: 'q', beast: 'q', dragon: 'd', serpent: 's',
  insect: 'fly', plant: 'tree', machine: 'm', elemental: 'e',
};

const NESTED = ['rider', 'centaur', 'human'];

function mergeSpec(a, b) {
  const out = { ...a, ...b };
  for (const k of NESTED) if (a[k] && b[k]) out[k] = { ...a[k], ...b[k] };
  return out;
}

/** True when the creature has a hand-tuned entry (directly or through its base form). */
export function creatureHasCustomSpec(id) {
  const c = CREATURE_BY_ID[id];
  return !!(SPECS[id] || (c && c.upgradeOf && SPECS[c.upgradeOf]));
}

/** Shape-based defaults so that any creature (even one missing from SPECS) renders sensibly. */
function fallbackSpec(c) {
  let rig = SHAPE_RIG[c.shape] || 'h';
  if (c.shape === 'flyer') rig = c.size === 2 ? 'b' : 'h';
  const h = hashStr(c.id);
  const hue = (h % 360);
  const base = { rig };
  if (rig === 'h') {
    if (c.shape === 'caster') Object.assign(base, { armor: 'robe', weapon: 'staff', hat: 'wizard' });
    if (c.shape === 'undead') Object.assign(base, { head: 'skull', skin: BONE, hair: 'bald' });
    if (c.shape === 'giant') Object.assign(base, { s: 1.1, build: 1.3, weapon: 'club', headK: 0.9 });
    if (c.shape === 'construct') Object.assign(base, { head: 'golem', armor: 'bare', build: 1.4, hair: 'bald', skin: tweak('#9a9488', hue, 1.5) });
    if (c.shape === 'flyer') Object.assign(base, { wings: 'feather', hover: 6 });
    if (c.shots > 0 && !base.weapon) base.weapon = 'bow';
    if (!base.weapon && c.shape === 'humanoid') base.weapon = ['sword', 'spear', 'axe', 'mace'][h % 4];
  } else if (rig === 'q') {
    Object.assign(base, { head: c.shape === 'rider' ? 'horse' : 'wolf', color: tweak('#8a6a4a', hue % 40, 1), tail: c.shape === 'rider' ? 'horse' : 'wolf' });
    if (c.shape === 'rider') base.rider = { armor: 'plate', weapon: 'lance', s: 0.8 };
    if (c.flying) base.wings = 'feather';
  } else if (rig === 'd') base.color = tweak('#3a8a3a', hue, 1);
  else if (rig === 'b') base.color = tweak('#8a5a3a', hue % 60, 1);
  else if (rig === 's') Object.assign(base, { top: 'snake', color: tweak('#3a9a5a', hue, 1) });
  else if (rig === 'e') Object.assign(base, { type: ['air', 'water', 'fire', 'wisp'][h % 4], color: tweak('#5aa8e8', hue, 1) });
  else if (rig === 'fly') base.color = tweak('#4a9a3a', hue, 1);
  else if (rig === 'tree') Object.assign(base, { color: '#6a4a2a', leaf: '#3a8a34' });
  else if (rig === 'm') base.type = 'walker';
  return base;
}

const specCache = new Map();

/** Fully resolved spec for a creature id (faction palette + base spec + upgrade overrides). */
export function creatureSpec(id) {
  if (specCache.has(id)) return specCache.get(id);
  const c = CREATURE_BY_ID[id];
  if (!c) throw new Error(`gfx: unknown creature '${id}'`);
  const pal = factionPalette(c.faction);
  let spec = fallbackSpec(c);
  if (c.upgradeOf && CREATURE_BY_ID[c.upgradeOf]) spec = mergeSpec(spec, creatureSpec(c.upgradeOf).raw);
  if (SPECS[id]) spec = mergeSpec(spec, SPECS[id]);
  const raw = spec;
  spec = { ...spec };
  const h = hashStr(id);
  const tier = Math.min(8, Math.max(1, c.tier || 1));
  if (spec.rig === 'h') {
    const trim = c.upgraded ? shade(pal.trim, 0.25) : pal.trim;
    const HAIR = ['#4a3020', '#2a2018', '#8a5a2a', '#c8a040', '#6a6a6a'];
    spec = {
      cloth: c.upgraded ? tweak(pal.cloth, 0, 1.15, 0.04) : pal.cloth, metal: pal.metal, trim, skin: '#e0b088',
      hairC: HAIR[h % HAIR.length], ...spec,
    };
    if (raw.s === undefined) spec.s = 0.78 + tier * 0.026;
    spec.up = !!c.upgraded;
  } else {
    spec.up = !!c.upgraded;
    spec.trim = spec.trim || pal.trim;
    for (const k of NESTED) {
      if (spec[k]) spec[k] = { cloth: pal.cloth, metal: pal.metal, trim: pal.trim, up: !!c.upgraded, ...spec[k] };
    }
  }
  const res = { ...spec, raw, wide: c.size === 2 };
  specCache.set(id, res);
  return res;
}

/** Pose parameters for an animation state/frame. */
export function poseFor(state = 'idle', frame = 0) {
  const n = STATE_FRAMES[state] || 1;
  const f = (((frame | 0) % n) + n) % n;
  const p = { state, frame: f, bob: 0, lean: 0, swing: 0, step: 0, aim: false, loose: false, crouch: false, dead: false, flap: 0 };
  switch (state) {
    case 'move': p.step = [1, 0, -1, 0][f]; p.bob = [0, -1.4, 0, -1.4][f]; p.lean = 0.05; p.flap = [0, 1, 0, 1][f]; break;
    case 'attack': p.swing = [-1, 1, 0.45][f]; p.lean = [-0.06, 0.14, 0.05][f]; p.flap = [1, 0, 0.5][f]; break;
    case 'shoot': p.aim = true; p.loose = f >= 1; p.lean = f === 1 ? -0.04 : 0; p.flap = 0.5; break;
    case 'hit': p.lean = -0.14; p.bob = 1; p.flap = 1; break;
    case 'defend': p.crouch = true; p.lean = -0.04; break;
    case 'dead': p.dead = true; break;
    default: p.bob = [0, -0.7, -1.2, -0.7][f]; p.flap = [0, 0.5, 1, 0.5][f]; break;
  }
  return p;
}

function drawRig(g, spec, cx, G, p) {
  switch (spec.rig) {
    case 'q': quadruped(g, cx - 6, G, spec, p); break;
    case 'd': dragon(g, cx - 4, G, spec, p); break;
    case 'b': bird(g, cx, G, spec, p); break;
    case 's': serpent(g, cx + 6, G, spec, p); break;
    case 'fly': dragonfly(g, cx + 6, G, spec, p); break;
    case 'spider': spider(g, cx - 6, G, spec, p); break;
    case 'eye': floatingEye(g, cx, G, spec, p); break;
    case 'tree': treefolk(g, cx, G, spec, p); break;
    case 'e': elemental(g, cx, G, spec, p); break;
    case 'm': machine(g, cx, G, spec, p); break;
    default: humanoid(g, cx, G, spec, p); break;
  }
}

/**
 * Paint a creature on a design grid of W x 100 (W = 100 or 200).
 * @param g context scaled to the design grid
 */
export function paintCreature(g, id, state, frame) {
  const spec = creatureSpec(id);
  const W = spec.wide ? 200 : 100;
  const cx = W / 2;
  const G = CREATURE_GROUND;
  const p = poseFor(state, frame);
  g.save();
  if (p.dead) {
    const lying = p.frame >= 1;
    const machineLike = spec.rig === 'm';
    if (machineLike) {
      g.translate(cx, G);
      g.rotate(lying ? 0.22 : 0.1);
      g.scale(1, lying ? 0.62 : 0.85);
      g.translate(-cx, -G);
    } else if (spec.wide) {
      g.translate(cx, G);
      g.rotate(lying ? -0.05 : -0.12);
      g.scale(1, lying ? 0.45 : 0.75);
      g.translate(-cx, -G);
    } else {
      g.translate(cx + (lying ? 32 : 12), G - (lying ? 5 : 0));
      g.rotate(lying ? -1.42 : -0.55);
      g.scale(0.85, 0.85);
      g.translate(-cx, -G);
    }
  } else if (p.state === 'hit') {
    g.translate(-3, 0);
  } else if (p.state === 'attack' && spec.rig === 'h') {
    g.translate([-2, 5, 2][p.frame], 0);
  }
  drawRig(g, spec, cx, G, p);
  g.restore();
  if (p.dead || p.state === 'hit') {
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = p.dead ? `rgba(40,36,44,${p.frame >= 1 ? 0.5 : 0.25})` : `rgba(255,48,32,${p.frame === 0 ? 0.45 : 0.2})`;
    g.fillRect(0, 0, W, 100);
    g.restore();
  }
}

export const CREATURE_SPEC_IDS = Object.keys(SPECS);
