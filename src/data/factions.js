// Factions (town types). Spec: docs/mechanics/towns.md
// The id list lives in core/constants.js (FACTIONS); this module holds the full records.
import { FACTIONS } from '../core/constants.js';

/**
 * @typedef {Object} FactionSiege
 * @property {{name:string, damage:number, width:number}|null} moat  damage per stack entering/starting in moat (Citadel+)
 * @property {{damage:number, count:number}|null} mines  Tower only: land mines instead of a moat (Citadel+)
 * @property {string} wallName  flavour for gfx
 *
 * @typedef {Object} FactionRule
 * @property {string} id
 * @property {string} description
 *
 * @typedef {Object} Faction
 * @property {string} id
 * @property {string} name
 * @property {'good'|'evil'|'neutral'} alignment
 * @property {string} nativeTerrain
 * @property {[string,string]} heroClasses  [might, magic]
 * @property {[string,string][]} creatures  7 x [base, upgraded]
 * @property {{tier:number, creatures:[string,string], dwellingId:string}[]} altCreatures  extra lineups (Factory)
 * @property {string[]} townNames
 * @property {string} color  theme colour (hex)
 * @property {number} mageGuildMax
 * @property {boolean} hasShipyard  may build a shipyard when the town is adjacent to water
 * @property {string[]} warMachines  what the blacksmith sells
 * @property {string[]} siloResources  what the resource silo yields daily (+1 each)
 * @property {FactionSiege} siege
 * @property {FactionRule[]} rules
 */

/** @type {Faction[]} */
export const FACTIONS_DATA = [
  {
    id: 'castle', name: 'Castle', alignment: 'good', nativeTerrain: 'grass',
    heroClasses: ['knight', 'cleric'],
    creatures: [
      ['pikeman', 'halberdier'], ['archer', 'marksman'], ['griffin', 'royal_griffin'],
      ['swordsman', 'crusader'], ['monk', 'zealot'], ['cavalier', 'champion'], ['angel', 'arch_angel'],
    ],
    altCreatures: [],
    townNames: ['Steadwick', 'Whitestone', 'Terraneus', 'Fort Riverstride', 'Middleheim', 'Clovergreen',
      'Brettonia', 'Plinth', 'Gateway', 'Kildare', 'Haven', 'Lakeside', 'Cornerstone', 'Highcastle',
      'Valeford', 'Dunwall', 'Alexandretta', 'Stonecastle'],
    color: '#3f6fb5', mageGuildMax: 4, hasShipyard: true,
    warMachines: ['ballista'], siloResources: ['wood', 'ore'],
    siege: { moat: { name: 'Moat', damage: 70, width: 1 }, mines: null, wallName: 'stone' },
    rules: [
      { id: 'mage_guild_cap', description: 'Mage Guild can only reach level 4.' },
    ],
  },
  {
    id: 'rampart', name: 'Rampart', alignment: 'good', nativeTerrain: 'grass',
    heroClasses: ['ranger', 'druid'],
    creatures: [
      ['centaur', 'centaur_captain'], ['dwarf', 'battle_dwarf'], ['wood_elf', 'grand_elf'],
      ['pegasus', 'silver_pegasus'], ['dendroid_guard', 'dendroid_soldier'], ['unicorn', 'war_unicorn'],
      ['green_dragon', 'gold_dragon'],
    ],
    altCreatures: [],
    townNames: ['Elfwood', 'Goldenglade', 'Shadowden', 'Rainhaven', 'Lorekeep', 'Forestglen', 'Deepwood',
      'Glenwood', 'Evermorn', 'Dewfall', 'Mistvale', 'Vinehome', 'Woodhaven', 'Oakenhall', 'Autumnrest',
      'Greenhaven', 'Lightspring', 'Pinecrest'],
    color: '#3c8c3c', mageGuildMax: 5, hasShipyard: false,
    warMachines: ['first_aid_tent'], siloResources: ['crystal'],
    siege: { moat: { name: 'Brambles', damage: 70, width: 1 }, mines: null, wallName: 'wood' },
    rules: [],
  },
  {
    id: 'tower', name: 'Tower', alignment: 'good', nativeTerrain: 'snow',
    heroClasses: ['alchemist', 'wizard'],
    creatures: [
      ['gremlin', 'master_gremlin'], ['stone_gargoyle', 'obsidian_gargoyle'], ['stone_golem', 'iron_golem'],
      ['mage', 'arch_mage'], ['genie', 'master_genie'], ['naga', 'naga_queen'], ['giant', 'titan'],
    ],
    altCreatures: [],
    townNames: ['Celeste', 'Cloudspire', 'Whitestar', 'Skyreach', 'Frostholm', 'Highrock', 'Starfall',
      'Snowhaven', 'Thundertop', 'Azurepeak', 'Icewatch', 'Sagespire', 'Silverwing', 'Stormcrest',
      'Wintergarde', 'Aerie', 'Mystral', 'Glacierhold'],
    color: '#8fb8d8', mageGuildMax: 5, hasShipyard: false,
    warMachines: ['ammo_cart'], siloResources: ['gems'],
    siege: { moat: null, mines: { damage: 150, count: 6 }, wallName: 'marble' },
    rules: [
      { id: 'land_mines', description: 'Has no moat; a Citadel scatters hidden land mines in front of the walls instead.' },
    ],
  },
  {
    id: 'inferno', name: 'Inferno', alignment: 'evil', nativeTerrain: 'lava',
    heroClasses: ['demoniac', 'heretic'],
    creatures: [
      ['imp', 'familiar'], ['gog', 'magog'], ['hell_hound', 'cerberus'], ['demon', 'horned_demon'],
      ['pit_fiend', 'pit_lord'], ['efreet', 'efreet_sultan'], ['devil', 'arch_devil'],
    ],
    altCreatures: [],
    townNames: ['Ashden', 'Brimstone', 'Cinderfall', 'Darkflame', 'Emberpit', 'Hellgate', 'Kreelah',
      'Scorchspire', 'Sulfurmoor', 'Blackforge', 'Pyrehold', 'Ruinous', 'Soulburn', 'Dreadmaw',
      'Magmaheart', 'Charhaven', 'Smokewreath', 'Blazerock'],
    color: '#c0392b', mageGuildMax: 5, hasShipyard: false,
    warMachines: ['ammo_cart'], siloResources: ['mercury'],
    siege: { moat: { name: 'Lava', damage: 90, width: 1 }, mines: null, wallName: 'obsidian' },
    rules: [],
  },
  {
    id: 'necropolis', name: 'Necropolis', alignment: 'evil', nativeTerrain: 'dirt',
    heroClasses: ['death_knight', 'necromancer'],
    creatures: [
      ['skeleton', 'skeleton_warrior'], ['walking_dead', 'zombie'], ['wight', 'wraith'],
      ['vampire', 'vampire_lord'], ['lich', 'power_lich'], ['black_knight', 'dread_knight'],
      ['bone_dragon', 'ghost_dragon'],
    ],
    altCreatures: [],
    townNames: ['Stonecrypt', 'Shadowkeep', 'Darkhaven', 'Dirgewood', 'Coldreign', 'Gravehold', 'Bonewatch',
      'Mournmoor', 'Blightfall', 'Duskwall', 'Ghostwind', 'Nighthollow', 'Tombstead', 'Wraithmere',
      'Deadreach', 'Lichgate', 'Sorrowfen', 'Palecross'],
    color: '#5b4b6b', mageGuildMax: 5, hasShipyard: true,
    warMachines: ['first_aid_tent'], siloResources: ['wood', 'ore'],
    siege: { moat: { name: 'Boneyard', damage: 70, width: 1 }, mines: null, wallName: 'bone' },
    rules: [
      { id: 'undead_town', description: 'All town creatures are undead: neutral morale, immune to mind spells.' },
    ],
  },
  {
    id: 'dungeon', name: 'Dungeon', alignment: 'evil', nativeTerrain: 'subterranean',
    heroClasses: ['overlord', 'warlock'],
    creatures: [
      ['troglodyte', 'infernal_troglodyte'], ['harpy', 'harpy_hag'], ['beholder', 'evil_eye'],
      ['medusa', 'medusa_queen'], ['minotaur', 'minotaur_king'], ['manticore', 'scorpicore'],
      ['red_dragon', 'black_dragon'],
    ],
    altCreatures: [],
    townNames: ['Darkburrow', 'Deepshadow', 'Gloomhold', 'Nighon', 'Blackcavern', 'Mazewarren', 'Stonemaw',
      'Dimhollow', 'Underreach', 'Echovault', 'Shadowpit', 'Wyrmrest', 'Lowgate', 'Murkdeep',
      'Grimtunnel', 'Chasmwatch', 'Blindcave', 'Sunless'],
    color: '#7a4a9a', mageGuildMax: 5, hasShipyard: false,
    warMachines: ['ballista'], siloResources: ['sulfur'],
    siege: { moat: { name: 'Boiling Oil', damage: 90, width: 1 }, mines: null, wallName: 'cavern' },
    rules: [],
  },
  {
    id: 'stronghold', name: 'Stronghold', alignment: 'neutral', nativeTerrain: 'rough',
    heroClasses: ['barbarian', 'battle_mage'],
    creatures: [
      ['goblin', 'hobgoblin'], ['wolf_rider', 'wolf_raider'], ['orc', 'orc_chieftain'], ['ogre', 'ogre_mage'],
      ['roc', 'thunderbird'], ['cyclops', 'cyclops_king'], ['behemoth', 'ancient_behemoth'],
    ],
    altCreatures: [],
    townNames: ['Krewlod', 'Bonecrag', 'Axehold', 'Warcamp', 'Ironfist', 'Skullrock', 'Bloodmesa',
      'Thundercliff', 'Grimtusk', 'Dustfang', 'Stonehowl', 'Redridge', 'Brokenhorn', 'Wolfden',
      'Ragegorge', 'Cragmaw', 'Savagefort', 'Hidegate'],
    color: '#b5803f', mageGuildMax: 3, hasShipyard: false,
    warMachines: ['ammo_cart'], siloResources: ['wood', 'ore'],
    siege: { moat: { name: 'Spiked Barricade', damage: 70, width: 1 }, mines: null, wallName: 'palisade' },
    rules: [
      { id: 'mage_guild_cap', description: 'Mage Guild can only reach level 3.' },
    ],
  },
  {
    id: 'fortress', name: 'Fortress', alignment: 'neutral', nativeTerrain: 'swamp',
    heroClasses: ['beastmaster', 'witch'],
    creatures: [
      ['gnoll', 'gnoll_marauder'], ['lizardman', 'lizard_warrior'], ['serpent_fly', 'dragon_fly'],
      ['basilisk', 'greater_basilisk'], ['gorgon', 'mighty_gorgon'], ['wyvern', 'wyvern_monarch'],
      ['hydra', 'chaos_hydra'],
    ],
    altCreatures: [],
    townNames: ['Tatalia', 'Bogwater', 'Mirehold', 'Fenwatch', 'Marshgate', 'Mudhaven', 'Reedfort',
      'Swampstone', 'Mossfang', 'Stillmere', 'Quagmoor', 'Blackwater', 'Toadhollow', 'Viperden',
      'Weedhaven', 'Murkwall', 'Slitherfen', 'Drownedkeep'],
    color: '#4f7f6a', mageGuildMax: 3, hasShipyard: true,
    warMachines: ['first_aid_tent'], siloResources: ['wood', 'ore'],
    siege: { moat: { name: 'Boiling Tar', damage: 90, width: 1 }, mines: null, wallName: 'earthwork' },
    rules: [
      { id: 'mage_guild_cap', description: 'Mage Guild can only reach level 3.' },
    ],
  },
  {
    id: 'conflux', name: 'Conflux', alignment: 'neutral', nativeTerrain: 'grass',
    heroClasses: ['planeswalker', 'elementalist'],
    creatures: [
      ['pixie', 'sprite'], ['air_elemental', 'storm_elemental'], ['water_elemental', 'ice_elemental'],
      ['fire_elemental', 'energy_elemental'], ['earth_elemental', 'magma_elemental'],
      ['psychic_elemental', 'magic_elemental'], ['firebird', 'phoenix'],
    ],
    altCreatures: [],
    townNames: ['Aethermoor', 'Elemental Rise', 'Stormcradle', 'Tidewell', 'Emberglade', 'Stonesong',
      'Prismhold', 'Skyforge', 'Fourwinds', 'Primordia', 'Galeheart', 'Mistral', 'Flamecrest',
      'Crystalmere', 'Thoughtspire', 'Dawnpyre', 'Planegate', 'Zephyria'],
    color: '#d05fb0', mageGuildMax: 5, hasShipyard: true,
    warMachines: ['ballista'], siloResources: ['mercury'],
    siege: { moat: { name: 'Elemental Rift', damage: 70, width: 1 }, mines: null, wallName: 'crystal' },
    rules: [],
  },
  {
    id: 'cove', name: 'Cove', alignment: 'neutral', nativeTerrain: 'swamp',
    heroClasses: ['captain', 'navigator'],
    creatures: [
      ['nymph', 'oceanid'], ['crew_mate', 'seaman'], ['pirate', 'corsair'], ['stormbird', 'ayssid'],
      ['sea_witch', 'sorceress'], ['nix', 'nix_warrior'], ['sea_serpent', 'haspid'],
    ],
    altCreatures: [],
    townNames: ['Regnan Port', 'Saltreach', 'Blackwake', 'Corsair Bay', 'Tidehaven', 'Wreckers Rest',
      'Gullcliff', 'Stormharbor', 'Reefwatch', 'Driftwood', 'Kelpmoor', 'Anchorage', 'Brinehold',
      'Seaspray', 'Smugglers Den', 'Coralgate', 'Mistral Quay', 'Shellbank'],
    color: '#2f9c9c', mageGuildMax: 4, hasShipyard: true,
    warMachines: ['cannon'], siloResources: ['wood', 'ore'],
    siege: { moat: { name: 'Tidal Moat', damage: 70, width: 1 }, mines: null, wallName: 'ship timber' },
    rules: [
      { id: 'mage_guild_cap', description: 'Mage Guild can only reach level 4.' },
      { id: 'coastal', description: 'Map generator should prefer placing Cove towns next to water.' },
    ],
  },
  {
    id: 'factory', name: 'Factory', alignment: 'neutral', nativeTerrain: 'wasteland',
    heroClasses: ['mercenary', 'artificer'],
    creatures: [
      ['halfling', 'halfling_grenadier'], ['mechanic', 'engineer'], ['armadillo', 'bellwether_armadillo'],
      ['automaton', 'sentinel_automaton'], ['sandworm', 'olgoi_khorkhoi'], ['gunslinger', 'bounty_hunter'],
      ['couatl', 'crimson_couatl'],
    ],
    // HotA Factory has an 8th lineup: a second, independent tier-7 dwelling.
    altCreatures: [
      { tier: 7, creatures: ['dreadnought', 'juggernaut'], dwellingId: 'factory_dwelling_7_alt' },
    ],
    townNames: ['Dry Gulch', 'Cogsworth', 'Rustwater', 'Steamhollow', 'Ironvale', 'Gearford', 'Brasswick',
      'Dustbowl', 'Pistonridge', 'Tinkerton', 'Boilerbrook', 'Coppermine', 'Redcanyon', 'Smeltmoor',
      'Anvilrock', 'Sprocket Falls', 'Gunmetal', 'Tumbleweed'],
    color: '#a8a060', mageGuildMax: 5, hasShipyard: false,
    warMachines: ['ballista', 'ammo_cart', 'first_aid_tent'], siloResources: ['mercury'],
    siege: { moat: { name: 'Scrap Trench', damage: 70, width: 1 }, mines: null, wallName: 'riveted iron' },
    rules: [
      { id: 'two_tier7', description: 'Has two independent tier-7 dwellings (Couatl and Dreadnought); both may be built.' },
    ],
  },
];

export const FACTION_BY_ID = Object.fromEntries(FACTIONS_DATA.map((f) => [f.id, f]));

/** @param {string} id @returns {Faction} */
export function getFaction(id) {
  const f = FACTION_BY_ID[id];
  if (!f) throw new Error(`Unknown faction: ${id}`);
  return f;
}

/** All creature ids recruitable in a faction's town (base + upgraded, incl. alt lineups). */
export function factionCreatureIds(id) {
  const f = getFaction(id);
  return [...f.creatures.flat(), ...f.altCreatures.flatMap((a) => a.creatures)];
}

/** Faction id owning a creature id, or null. */
export function factionOfCreature(creatureId) {
  for (const f of FACTIONS_DATA) {
    if (factionCreatureIds(f.id).includes(creatureId)) return f.id;
  }
  return null;
}

// Sanity: data order mirrors constants.
if (FACTIONS_DATA.map((f) => f.id).join() !== FACTIONS.join()) {
  throw new Error('factions.js out of sync with constants.FACTIONS');
}
