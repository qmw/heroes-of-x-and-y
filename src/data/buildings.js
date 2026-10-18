// Town buildings. Exact spec, effect semantics and build trees: docs/mechanics/towns.md
import { RARE_RESOURCES } from '../core/constants.js';
import { pluralize } from '../core/plural.js';
import { FACTIONS_DATA, getFaction } from './factions.js';

/**
 * @typedef {Object} Building
 * @property {string} id
 * @property {string} faction  faction id or 'common'
 * @property {string} name
 * @property {string} description
 * @property {Object<string,number>} cost
 * @property {string[]} requires   all must be built (a building also counts as built if something replacing it is built)
 * @property {string|null} replaces  upgrade: the replaced id is removed from town.buildings
 * @property {'hall'|'fort'|'dwelling'|'mage_guild'|'market'|'tavern'|'blacksmith'|'horde'|'special'|'grail'|'shipyard'|'silo'} kind
 * @property {{creatureId:string, tier:number, upgraded:boolean, alt?:boolean}} [dwelling]
 * @property {Object[]} effects  structured effects, types listed in EFFECT_TYPES
 * @property {Object<string,Object[]>} [effectsByFaction]  extra effects of a common building, per town faction
 * @property {string[]} [factions]  common building only available to these factions (omitted = all)
 * @property {number} [mageGuildLevel]
 * @property {boolean} [requiresWater]  only buildable when the town is adjacent to water
 * @property {boolean} [requiresGrail]  only buildable by a visiting hero carrying the Grail
 * @property {boolean} [uniquePerPlayer]  a player may own only one across all towns
 * @property {boolean} [startsBuilt]  every town has it from the start
 */

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

/** A town may construct this many buildings per day (Town.builtThisTurn). The Grail is exempt. */
export const BUILDS_PER_DAY = 1;
/** A player may own only one Capitol across all towns. */
export const CAPITOL_UNIQUE_PER_PLAYER = true;
/** Building ids limited to one per player. */
export const UNIQUE_PER_PLAYER_BUILDINGS = ['capitol'];
/** Gold cost of hiring a tavern hero. */
export const TAVERN_HERO_COST = 2500;
/** Number of heroes offered in the tavern (per player, shared by all of the player's taverns). */
export const TAVERN_POOL_SIZE = 2;
/** Gold / wood cost of a boat at the shipyard. */
export const BOAT_COST = { gold: 1000, wood: 10 };
/** Spells offered per mage guild level (index 0 = level 1). The Library adds +1 to each. */
export const MAGE_GUILD_SPELL_SLOTS = [5, 4, 3, 2, 1];
/** Market value of resources used by all trade formulas. */
export const RESOURCE_VALUE = { gold: 1, wood: 250, ore: 250, mercury: 500, sulfur: 500, crystal: 500, gems: 500 };
/** War machine prices at blacksmiths. */
export const WAR_MACHINE_COST = { ballista: 2500, ammo_cart: 1000, first_aid_tent: 750, cannon: 4000 };
/** Artifact merchant stock composition (artifact classes), refreshed on day 1 of each month. */
export const ARTIFACT_MERCHANT_SLOTS = ['treasure', 'treasure', 'treasure', 'minor', 'minor', 'minor', 'major'];
/**
 * Creatures that the Skeleton Transformer turns into Bone Dragons ("dragon nature" creatures, as in
 * the original); everything else - hydras included - becomes Skeletons.
 */
export const SKELETON_TRANSFORMER_DRAGONS = [
  'green_dragon', 'gold_dragon', 'red_dragon', 'black_dragon', 'bone_dragon', 'ghost_dragon',
  'faerie_dragon', 'rust_dragon', 'crystal_dragon', 'azure_dragon',
];
export const SKELETON_TRANSFORMER = { default: 'skeleton', dragons: 'bone_dragon', dragonIds: SKELETON_TRANSFORMER_DRAGONS };

/**
 * Closed set of effect types. `when` = the moment the town engine resolves it:
 *   passive  - queried whenever relevant (the building merely has to stand)
 *   daily    - start of the owner's day
 *   weekly   - day 1 of each week
 *   visit    - when a hero enters / stays in the town
 *   siege    - when a combat for this town is set up
 *   action   - enables a player action in the town screen
 *   build    - once, at the moment of construction
 */
export const EFFECT_TYPES = {
  resource_income: { when: 'daily', params: 'resource, value', description: 'Owner gains `value` of `resource` each day.' },
  growth_percent: { when: 'weekly', params: 'percent, ofTotal?', description: 'Adds `percent` of BASE growth to every dwelling of the town (percents add up); with `ofTotal` (Grail) `percent` of the whole growth (base + fort + legion + hordes + external dwellings).' },
  creature_growth: { when: 'weekly', params: 'tier, creatureIds, value', description: 'Horde: flat +`value` weekly growth for the dwelling of `tier` (base or upgraded).' },
  siege_defense: { when: 'siege', params: 'fortLevel, wallHp, gateHp, keep, turrets, moat', description: 'Fortifications present in a siege (CombatInput.siege.fortLevel).' },
  garrison_bonus: { when: 'siege', params: 'stat, value', description: 'Defender of this town in a siege gets +value morale/luck (army) or attack/defense/power/knowledge (hero; needs a defending hero).' },
  visit_bonus: { when: 'visit', params: 'stat, value', description: 'Once per hero per town: permanent +value to a primary stat, or stat "experience".' },
  visit_temp_bonus: { when: 'visit', params: 'bonus, until', description: 'Every visit: hero.temp gets `bonus` until `until` (not stacking with itself).' },
  player_hero_bonus: { when: 'passive', params: 'bonus', description: 'Every hero of the owning player has `bonus` (a DESIGN Bonus) while the building stands. Same building in several towns does not stack.' },
  recruit_heroes: { when: 'action', params: 'cost, pool', description: 'Tavern: hire one of the player\'s `pool` tavern heroes for `cost` gold.' },
  thieves_guild: { when: 'action', params: 'value', description: 'Adds `value` to the player\'s thieves-guild information level (sum over all towns).' },
  sells_war_machine: { when: 'action', params: 'machineId, cost', description: 'Visiting hero may buy the war machine if he lacks it.' },
  trade_resources: { when: 'action', params: '', description: 'Marketplace: resource<->resource trade and sending resources to other players; counts as one marketplace.' },
  trade_creatures_for_resources: { when: 'action', params: '', description: "Freelancer's Guild: sell army stacks for resources." },
  sells_artifacts: { when: 'action', params: 'slots', description: 'Artifact Merchants: buy/sell artifacts for resources.' },
  sacrifice_altar: { when: 'action', params: 'creatures, artifacts', description: 'Grotto: sacrifice creatures/artifacts for hero experience.' },
  mage_guild: { when: 'build', params: 'level', description: 'Mage guild of `level`: spells for levels 1..level are rolled when built; visiting heroes learn what Wisdom allows.' },
  mana_restore: { when: 'daily', params: '', description: 'A hero who starts the day in this town has mana restored to maximum.' },
  mana_double: { when: 'visit', params: '', description: 'Mana Vortex: once per week (per town) a visiting hero gets mana = 2 x maximum.' },
  library_extra_spell: { when: 'build', params: 'value', description: 'Each existing/future mage guild level offers +value spells.' },
  all_spells: { when: 'build', params: '', description: 'Aurora Borealis: every built guild level of this town offers every spell of that level.' },
  weekly_resource_random: { when: 'weekly', params: 'min, max, resources', description: 'Mystic Pond: owner gets min..max of one random resource from `resources`.' },
  gold_interest: { when: 'weekly', params: 'percent', description: "Owner's gold increases by percent% of the amount held at week start." },
  skeleton_transform: { when: 'action', params: '', description: 'Convert army stacks to skeletons (dragons to bone dragons).' },
  town_gate: { when: 'action', params: '', description: 'Castle Gate: visiting hero teleports to another owned town with a Castle Gate and no visiting hero.' },
  shipyard: { when: 'action', params: 'cost', description: 'Build a boat on an adjacent free water tile.' },
  reveal_map: { when: 'build', params: 'radius | all', description: 'Reveals terrain around the town (radius tiles) or the whole map; lookout also adds permanent town sight.' },
  fog_cover: { when: 'daily', params: 'radius', description: 'Cover of Darkness: re-shrouds tiles within radius for all other players each day.' },
  necromancy_bonus: { when: 'passive', params: 'percent', description: 'All heroes of the owner get +percent Necromancy (stacks across towns).' },
  teach_skill: { when: 'action', params: 'skills, cost', description: 'Magic University: visiting hero buys a Basic secondary skill.' },
  portal_of_summoning: { when: 'weekly', params: '', description: 'Offers creatures of a random flagged external dwelling for recruitment.' },
  escape_tunnel: { when: 'siege', params: '', description: 'Defending hero may retreat/surrender from a siege.' },
  week_of_creature: { when: 'weekly', params: 'creatureId, growthBonus', description: 'Deity of Fire: in this town every week counts as the week of that creature: +growthBonus flat weekly growth for its dwelling.' },
  native_terrain_all: { when: 'passive', params: 'faction', description: 'Lodestar: all terrain counts as native for the owner\'s creatures of `faction`.' },
  grail: { when: 'passive', params: '', description: 'Marker for the Grail structure.' },
};

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

/** Cost literal without zero entries. */
function cost(gold, wood = 0, ore = 0, mercury = 0, sulfur = 0, crystal = 0, gems = 0) {
  const all = { gold, wood, ore, mercury, sulfur, crystal, gems };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v > 0));
}

function make(id, faction, kind, name, description, costObj, requires, effects, extra = {}) {
  return { id, faction, name, description, cost: costObj, requires, replaces: null, kind, effects, ...extra };
}

const bySilo = {};
const bySmith = {};
for (const f of FACTIONS_DATA) {
  bySilo[f.id] = f.siloResources.map((resource) => ({ type: 'resource_income', resource, value: 1 }));
  bySmith[f.id] = f.warMachines.map((machineId) => ({ type: 'sells_war_machine', machineId, cost: WAR_MACHINE_COST[machineId] }));
}

// ---------------------------------------------------------------------------------------------
// Common buildings
// ---------------------------------------------------------------------------------------------

const tavernEffects = [
  { type: 'recruit_heroes', cost: TAVERN_HERO_COST, pool: TAVERN_POOL_SIZE },
  { type: 'thieves_guild', value: 1 },
  { type: 'garrison_bonus', stat: 'morale', value: 1 },
];

function mageGuild(level) {
  const rare = [0, 0, 4, 6, 8, 10][level];
  return make(`mage_guild_${level}`, 'common', 'mage_guild', `Mage Guild Level ${level}`,
    `Offers ${MAGE_GUILD_SPELL_SLOTS[level - 1]} level ${level} spell(s) to visiting heroes and restores their mana overnight.`,
    cost(level === 1 ? 2000 : 1000, 5, 5, rare, rare, rare, rare),
    level === 1 ? [] : [`mage_guild_${level - 1}`],
    [{ type: 'mage_guild', level }, { type: 'mana_restore' }],
    { replaces: level === 1 ? null : `mage_guild_${level - 1}`, mageGuildLevel: level });
}

const COMMON = [
  make('village_hall', 'common', 'hall', 'Village Hall', 'Earns 500 gold per day.', {}, [],
    [{ type: 'resource_income', resource: 'gold', value: 500 }], { startsBuilt: true }),
  make('town_hall', 'common', 'hall', 'Town Hall', 'Earns 1000 gold per day.', cost(2500), ['village_hall', 'tavern'],
    [{ type: 'resource_income', resource: 'gold', value: 1000 }], { replaces: 'village_hall' }),
  make('city_hall', 'common', 'hall', 'City Hall', 'Earns 2000 gold per day.', cost(5000),
    ['town_hall', 'marketplace', 'blacksmith', 'mage_guild_1'],
    [{ type: 'resource_income', resource: 'gold', value: 2000 }], { replaces: 'town_hall' }),
  make('capitol', 'common', 'hall', 'Capitol', 'Earns 4000 gold per day. Only one per player.', cost(10000),
    ['city_hall', 'castle'],
    [{ type: 'resource_income', resource: 'gold', value: 4000 }], { replaces: 'city_hall', uniquePerPlayer: true }),

  make('fort', 'common', 'fort', 'Fort', 'Walls and a gate protect the town; allows creature dwellings.',
    cost(5000, 20, 20), [],
    [{ type: 'siege_defense', fortLevel: 1, wallHp: 2, gateHp: 2, keep: false, turrets: 0, moat: false }]),
  make('citadel', 'common', 'fort', 'Citadel', 'Adds a keep and a moat; +50% creature growth.',
    cost(2500, 0, 5), ['fort'],
    [{ type: 'siege_defense', fortLevel: 2, wallHp: 2, gateHp: 2, keep: true, turrets: 0, moat: true },
      { type: 'growth_percent', percent: 50 }], { replaces: 'fort' }),
  make('castle', 'common', 'fort', 'Castle', 'Adds two arrow towers and stronger walls; +100% creature growth.',
    cost(5000, 10, 10), ['citadel'],
    [{ type: 'siege_defense', fortLevel: 3, wallHp: 3, gateHp: 2, keep: true, turrets: 2, moat: true },
      { type: 'growth_percent', percent: 100 }], { replaces: 'citadel' }),

  make('tavern', 'common', 'tavern', 'Tavern', 'Hire heroes, hear rumours; +1 morale to the town\'s defenders.',
    cost(500, 5), [], tavernEffects),
  make('blacksmith', 'common', 'blacksmith', 'Blacksmith', 'Sells a war machine (depends on the town type).',
    cost(1000, 5), [], [], { effectsByFaction: bySmith }),
  make('marketplace', 'common', 'market', 'Marketplace', 'Trade resources; rates improve with every marketplace owned.',
    cost(500, 5), [], [{ type: 'trade_resources' }]),
  make('resource_silo', 'common', 'silo', 'Resource Silo', 'Produces resources every day (depends on the town type).',
    cost(5000, 0, 5), ['marketplace'], [], { effectsByFaction: bySilo }),
  mageGuild(1), mageGuild(2), mageGuild(3), mageGuild(4), mageGuild(5),
  make('shipyard', 'common', 'shipyard', 'Shipyard', 'Build boats (town must be next to water).',
    cost(2000, 20), [], [{ type: 'shipyard', cost: BOAT_COST }],
    { requiresWater: true, factions: FACTIONS_DATA.filter((f) => f.hasShipyard).map((f) => f.id) }),
];

// ---------------------------------------------------------------------------------------------
// Dwellings: [name, cost, requires, upgradedName, upgradedCost, extra requires of the upgrade]
// In `requires`, a number N means "<faction>_dwelling_N"; strings are building ids.
// ---------------------------------------------------------------------------------------------

const DWELLINGS = {
  castle: [
    ['Guardhouse', cost(500, 0, 10), ['fort'], 'Upg. Guardhouse', cost(1000, 0, 5), []],
    ["Archers' Tower", cost(1000, 5, 5), [1], "Upg. Archers' Tower", cost(1000, 5, 5), []],
    ['Griffin Tower', cost(1000, 0, 5), [4], 'Upg. Griffin Tower', cost(1000, 0, 5), []],
    ['Barracks', cost(2000, 0, 5), [1, 'blacksmith'], 'Upg. Barracks', cost(2000, 0, 5, 0, 0, 5), []],
    ['Monastery', cost(3000, 5, 5, 2, 2, 2, 2), [4, 'mage_guild_1'], 'Upg. Monastery', cost(1000, 2, 2, 2, 2, 2, 2), []],
    ['Training Grounds', cost(5000, 20), ['castle_stables'], 'Upg. Training Grounds', cost(3000, 10), []],
    ['Portal of Glory', cost(20000, 0, 0, 10, 10, 10, 10), [5], 'Upg. Portal of Glory', cost(20000, 0, 0, 10, 10, 10, 10), []],
  ],
  rampart: [
    ['Centaur Stables', cost(500, 10), ['fort'], 'Upg. Centaur Stables', cost(1000, 5), []],
    ['Dwarf Cottage', cost(1000, 5), [1], 'Upg. Dwarf Cottage', cost(1000, 5), []],
    ['Homestead', cost(1500, 10), [1], 'Upg. Homestead', cost(1500, 10), []],
    ['Enchanted Spring', cost(2000, 0, 0, 0, 0, 10), [3], 'Upg. Enchanted Spring', cost(2000, 0, 0, 0, 0, 5), []],
    ['Dendroid Arches', cost(2500), [3], 'Upg. Dendroid Arches', cost(1500), []],
    ['Unicorn Glade', cost(4000, 5, 5, 0, 0, 0, 10), [4, 5], 'Upg. Unicorn Glade', cost(3000, 0, 0, 0, 0, 0, 5), []],
    ['Dragon Cliffs', cost(10000, 0, 30, 0, 0, 20), [6, 'mage_guild_2'], 'Upg. Dragon Cliffs', cost(20000, 0, 30, 0, 0, 20), ['mage_guild_3']],
  ],
  tower: [
    ['Workshop', cost(300, 5, 5), ['fort'], 'Upg. Workshop', cost(1000, 5), []],
    ['Parapet', cost(1000, 0, 10), [1], 'Upg. Parapet', cost(1500, 0, 5), []],
    ['Golem Factory', cost(2000, 5, 5), [1], 'Upg. Golem Factory', cost(2000, 5, 5, 5), []],
    ['Mage Tower', cost(2500, 5, 5, 5, 5, 5, 5), [2, 3, 'mage_guild_1'], 'Upg. Mage Tower', cost(2000, 5), ['tower_library']],
    ['Altar of Wishes', cost(3000, 5, 5, 0, 0, 6, 6), [4], 'Upg. Altar of Wishes', cost(2000, 5), []],
    ['Golden Pavilion', cost(4000, 5, 5, 2, 2, 2, 2), [4], 'Upg. Golden Pavilion', cost(3000, 5, 5, 3, 3, 3, 3), []],
    ['Cloud Temple', cost(5000, 10, 10, 0, 0, 0, 10), [5, 6], 'Upg. Cloud Temple', cost(25000, 5, 5, 0, 0, 0, 30), []],
  ],
  inferno: [
    ['Imp Crucible', cost(300, 5, 5), ['fort'], 'Upg. Imp Crucible', cost(1000, 0, 0, 5), []],
    ['Hall of Sins', cost(1000, 0, 5), [1], 'Upg. Hall of Sins', cost(1000, 0, 0, 5), []],
    ['Kennels', cost(1500, 10), [1], 'Upg. Kennels', cost(1500, 0, 0, 0, 5), []],
    ['Demon Gate', cost(2000, 5, 5), [2], 'Upg. Demon Gate', cost(2000, 5, 5), []],
    ['Hell Hole', cost(3000), [4], 'Upg. Hell Hole', cost(3000, 0, 0, 5, 5), ['mage_guild_2']],
    ['Fire Lake', cost(4000, 0, 10, 3, 3, 3, 3), [4, 'mage_guild_1'], 'Upg. Fire Lake', cost(3000, 0, 5, 3, 3, 3, 3), []],
    ['Forsaken Palace', cost(15000, 10, 10, 20, 20), [5, 6], 'Upg. Forsaken Palace', cost(20000, 5, 5, 20, 20), []],
  ],
  necropolis: [
    ['Cursed Temple', cost(400, 5, 5), ['fort'], 'Upg. Cursed Temple', cost(1000, 5, 5), []],
    ['Graveyard', cost(1000, 0, 5), [1], 'Upg. Graveyard', cost(1000, 5, 5), []],
    ['Tomb of Souls', cost(1500, 5, 5), [1], 'Upg. Tomb of Souls', cost(1500, 0, 0, 5), []],
    ['Estate', cost(2000, 5, 5), [2], 'Upg. Estate', cost(2000, 5, 0, 0, 0, 10, 10), ['necropolis_necromancy_amplifier']],
    ['Mausoleum', cost(2000, 0, 10, 0, 10), [2, 'mage_guild_1'], 'Upg. Mausoleum', cost(2000, 0, 5, 0, 5), []],
    ['Hall of Darkness', cost(6000, 10, 10), [4, 5], 'Upg. Hall of Darkness', cost(3000, 5, 5, 2, 2, 2, 2), []],
    ['Dragon Vault', cost(10000, 5, 5, 5, 5, 5, 5), [6], 'Upg. Dragon Vault', cost(15000, 5, 5, 20), []],
  ],
  dungeon: [
    ['Warren', cost(400, 10), ['fort'], 'Upg. Warren', cost(1000, 5), []],
    ['Harpy Loft', cost(1000), [1], 'Upg. Harpy Loft', cost(1000, 0, 0, 0, 2, 2), []],
    ['Pillar of Eyes', cost(1000, 1, 1, 1, 1, 1, 1), [1], 'Upg. Pillar of Eyes', cost(1000, 1, 1, 1, 1, 1, 1), []],
    ['Chapel of Stilled Voices', cost(2000, 5, 10), [2, 3], 'Upg. Chapel of Stilled Voices', cost(1500, 5), []],
    ['Labyrinth', cost(4000, 0, 10, 0, 0, 0, 10), [4], 'Upg. Labyrinth', cost(3000, 0, 5, 0, 0, 0, 5), []],
    ['Manticore Lair', cost(5000, 5, 5, 5, 5), [4], 'Upg. Manticore Lair', cost(3000, 5, 5, 5, 5), []],
    ['Dragon Cave', cost(15000, 15, 15, 0, 20), [5, 6, 'mage_guild_2'], 'Upg. Dragon Cave', cost(15000, 15, 15, 0, 20), ['mage_guild_3']],
  ],
  stronghold: [
    ['Goblin Barracks', cost(200, 5, 5), ['fort'], 'Upg. Goblin Barracks', cost(1000, 5, 5), []],
    ['Wolf Pen', cost(1000, 10, 5), [1], 'Upg. Wolf Pen', cost(1000, 5, 5), []],
    ['Orc Tower', cost(1000, 5, 5), [1], 'Upg. Orc Tower', cost(1000, 2, 2), ['blacksmith']],
    ['Ogre Fort', cost(2000, 20), [3], 'Upg. Ogre Fort', cost(2000, 5, 5, 0, 0, 0, 5), ['mage_guild_1']],
    ['Cliff Nest', cost(2500, 0, 10), [2], 'Upg. Cliff Nest', cost(2000, 0, 5), []],
    ['Cyclops Cave', cost(3500, 0, 20, 0, 0, 20), [4], 'Upg. Cyclops Cave', cost(3000, 0, 5, 0, 0, 5), []],
    ['Behemoth Lair', cost(10000, 10, 10, 0, 0, 10), [5], 'Upg. Behemoth Lair', cost(15000, 10, 10, 0, 0, 20), []],
  ],
  fortress: [
    ['Gnoll Hut', cost(400, 10), ['fort'], 'Upg. Gnoll Hut', cost(1000, 10), []],
    ['Lizard Den', cost(1000, 5), [1], 'Upg. Lizard Den', cost(1000, 5), []],
    ['Serpent Fly Hive', cost(1000, 5, 0, 2, 2), [1], 'Upg. Serpent Fly Hive', cost(1000, 0, 0, 2, 2), []],
    ['Basilisk Pit', cost(2000, 5, 10), [3], 'Upg. Basilisk Pit', cost(2000, 5, 5), []],
    ['Gorgon Lair', cost(2500, 10, 0, 5, 5), [2, 3], 'Upg. Gorgon Lair', cost(2000, 5, 0, 5, 5), ['resource_silo']],
    ['Wyvern Nest', cost(3500, 15), [2], 'Upg. Wyvern Nest', cost(3000, 10, 0, 10), []],
    ['Hydra Pond', cost(10000, 10, 10, 0, 10), [4, 6], 'Upg. Hydra Pond', cost(15000, 10, 10, 0, 20), []],
  ],
  conflux: [
    ['Magic Lantern', cost(300, 5, 5), ['fort'], 'Upg. Magic Lantern', cost(1000, 5, 5), []],
    ['Altar of Air', cost(1500, 0, 5), [1, 'mage_guild_1'], 'Upg. Altar of Air', cost(1500, 0, 2, 2), []],
    ['Altar of Water', cost(1500, 0, 5), [1, 'mage_guild_1'], 'Upg. Altar of Water', cost(2000, 0, 5, 5), []],
    ['Altar of Fire', cost(2000, 5, 5), [2], 'Upg. Altar of Fire', cost(2000, 5, 5, 0, 5), []],
    ['Altar of Earth', cost(2000, 0, 10), [3], 'Upg. Altar of Earth', cost(2000, 0, 5, 0, 0, 5), []],
    ['Altar of Thought', cost(3000, 5, 5, 2, 2, 2, 2), [4, 5], 'Upg. Altar of Thought', cost(3000, 5, 5, 3, 3, 3, 3), []],
    ['Pyre', cost(10000, 10, 10, 10), [6], 'Upg. Pyre', cost(15000, 10, 10, 20), []],
  ],
  cove: [
    ['Nymph Waterfall', cost(400, 10), ['fort'], 'Upg. Nymph Waterfall', cost(1000, 5), []],
    ['Shack', cost(1000, 5, 5), [1], 'Upg. Shack', cost(1000, 5, 5), []],
    ['Frigate', cost(1500, 10), [2, 'tavern'], 'Upg. Frigate', cost(2000, 5, 0, 0, 5), ['blacksmith']],
    ['Nest', cost(2000, 5, 5, 0, 0, 0, 5), [1], 'Upg. Nest', cost(2000, 0, 0, 0, 0, 0, 5), []],
    ['Tower of the Seas', cost(3000, 5, 5, 3, 3, 3, 3), [3, 'mage_guild_1'], 'Upg. Tower of the Seas', cost(2500, 0, 0, 3, 3, 3, 3), []],
    ['Nix Fort', cost(5000, 10, 10, 0, 0, 10), [3, 4], 'Upg. Nix Fort', cost(3000, 5, 5, 0, 0, 5), []],
    ['Maelstrom', cost(12000, 10, 10, 0, 15), [5, 6], 'Upg. Maelstrom', cost(18000, 10, 10, 0, 20), []],
  ],
  factory: [
    ['Watchtower', cost(400, 5, 5), ['fort'], 'Upg. Watchtower', cost(1000, 5, 0, 0, 2), []],
    ['Foundry', cost(1000, 0, 10), [1], 'Upg. Foundry', cost(1500, 0, 5, 2), ['blacksmith']],
    ['Ranch', cost(1500, 10), [1], 'Upg. Ranch', cost(1500, 5, 5), []],
    ['Manufactory', cost(2000, 0, 10, 5), [2], 'Upg. Manufactory', cost(2500, 0, 5, 5), []],
    ['Wormery', cost(3000, 5, 5, 0, 5), [3], 'Upg. Wormery', cost(3000, 0, 5, 0, 5), []],
    ["Sheriff's Office", cost(5000, 10, 10, 0, 5, 0, 5), [4, 'tavern'], "Upg. Sheriff's Office", cost(3500, 5, 5, 0, 5, 0, 5), []],
    ['Serpentarium', cost(10000, 10, 10, 0, 0, 10, 10), [5, 6, 'mage_guild_1'], 'Upg. Serpentarium', cost(15000, 5, 5, 0, 0, 15, 15), []],
  ],
};

/** Factory's second tier-7 dwelling (Dreadnought / Juggernaut). */
const ALT_DWELLINGS = {
  factory_dwelling_7_alt: ['Gantry', cost(12000, 0, 20, 15), [4, 6], 'Upg. Gantry', cost(18000, 0, 20, 20), []],
};

function reqIds(faction, reqs) {
  return reqs.map((r) => (typeof r === 'number' ? `${faction}_dwelling_${r}` : r));
}

function dwellingPair(faction, baseId, tier, creatures, row, alt) {
  const [name, baseCost, reqs, upName, upCost, upReqs] = row;
  const altFlag = alt ? { alt: true } : {};
  return [
    make(baseId, faction, 'dwelling', name, `Recruit ${pluralize(creatures[0].replaceAll('_', ' '))} (tier ${tier}).`,
      baseCost, reqIds(faction, reqs), [],
      { dwelling: { creatureId: creatures[0], tier, upgraded: false, ...altFlag } }),
    make(`${baseId}_up`, faction, 'dwelling', upName,
      `Recruit ${pluralize(creatures[1].replaceAll('_', ' '))} and upgrade ${pluralize(creatures[0].replaceAll('_', ' '))}.`,
      upCost, [baseId, ...reqIds(faction, upReqs)], [],
      { replaces: baseId, dwelling: { creatureId: creatures[1], tier, upgraded: true, ...altFlag } }),
  ];
}

function buildDwellings() {
  const out = [];
  for (const f of FACTIONS_DATA) {
    f.creatures.forEach((pair, i) => {
      out.push(...dwellingPair(f.id, `${f.id}_dwelling_${i + 1}`, i + 1, pair, DWELLINGS[f.id][i], false));
    });
    for (const a of f.altCreatures) {
      out.push(...dwellingPair(f.id, a.dwellingId, a.tier, a.creatures, ALT_DWELLINGS[a.dwellingId], true));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Hordes, specials, grails
// ---------------------------------------------------------------------------------------------

function horde(faction, key, name, tier, value, costObj, extraReqs = []) {
  const creatureIds = getFaction(faction).creatures[tier - 1];
  return make(`${faction}_${key}`, faction, 'horde', name,
    `Increases weekly growth of ${creatureIds[0].replaceAll('_', ' ')}s by ${value}.`,
    costObj, [`${faction}_dwelling_${tier}`, ...extraReqs],
    [{ type: 'creature_growth', tier, creatureIds, value }]);
}

function special(faction, key, name, description, costObj, requires, effects, extra = {}) {
  return make(`${faction}_${key}`, faction, extra.kind ?? 'special', name, description, costObj, requires, effects, extra);
}

function grail(faction, name, description, uniqueEffects) {
  return make(`${faction}_grail`, faction, 'grail', name,
    `Grail: +5000 gold per day, +50% creature growth. ${description}`, {}, [],
    [{ type: 'grail' }, { type: 'resource_income', resource: 'gold', value: 5000 },
      { type: 'growth_percent', percent: 50, ofTotal: true }, ...uniqueEffects],
    { requiresGrail: true });
}

const garrison = (stat, value) => ({ type: 'garrison_bonus', stat, value });
const visit = (stat, value) => ({ type: 'visit_bonus', stat, value });
const artifactMerchants = (faction) => special(faction, 'artifact_merchants', 'Artifact Merchants',
  'Buy and sell artifacts for resources.', cost(10000), ['marketplace'],
  [{ type: 'sells_artifacts', slots: ARTIFACT_MERCHANT_SLOTS }], { kind: 'market' });

const SPECIALS = [
  // --- Castle ---
  special('castle', 'lighthouse', 'Lighthouse', "+500 sea movement points for all of the owner's ships.",
    cost(2000, 0, 10), ['shipyard'],
    [{ type: 'player_hero_bonus', bonus: { type: 'movement_sea', value: 500 } }], { requiresWater: true }),
  horde('castle', 'griffin_bastion', 'Griffin Bastion', 3, 3, cost(1000)),
  special('castle', 'stables', 'Stables', 'Visiting heroes gain +400 land movement until the end of the week.',
    cost(2000, 10), ['castle_dwelling_4'],
    [{ type: 'visit_temp_bonus', bonus: { type: 'movement_land', value: 400 }, until: 'end_of_week' }]),
  special('castle', 'brotherhood_of_the_sword', 'Brotherhood of the Sword',
    "Raises the defenders' morale bonus from the Tavern to +2.", cost(500, 5), ['tavern'], [garrison('morale', 1)]),
  grail('castle', 'Colossus', "+2 morale to all of the owner's heroes.",
    [{ type: 'player_hero_bonus', bonus: { type: 'morale', value: 2 } }]),

  // --- Rampart ---
  special('rampart', 'mystic_pond', 'Mystic Pond', 'Each week yields 1-4 of a random rare resource (mercury, sulfur, crystal or gems).',
    cost(2000, 2, 2, 2, 2, 2, 2), [],
    [{ type: 'weekly_resource_random', min: 1, max: 4, resources: [...RARE_RESOURCES] }]),
  special('rampart', 'fountain_of_fortune', 'Fountain of Fortune', '+2 luck to the defenders of the town.',
    cost(1500, 0, 0, 0, 0, 10), ['rampart_mystic_pond'], [garrison('luck', 2)]),
  horde('rampart', 'miners_guild', "Miners' Guild", 2, 4, cost(1000)),
  special('rampart', 'dwarven_treasury', 'Dwarven Treasury', "Each week adds 10% interest to the owner's gold.",
    cost(5000, 5), ['rampart_miners_guild'], [{ type: 'gold_interest', percent: 10 }]),
  horde('rampart', 'dendroid_saplings', 'Dendroid Saplings', 5, 2, cost(2000)),
  grail('rampart', 'Spirit Guardian', "+2 luck to all of the owner's heroes.",
    [{ type: 'player_hero_bonus', bonus: { type: 'luck', value: 2 } }]),

  // --- Tower ---
  special('tower', 'library', 'Library', 'Adds one extra spell to every level of the Mage Guild.',
    cost(1500, 5, 5, 5, 5, 5, 5), ['mage_guild_1'], [{ type: 'library_extra_spell', value: 1 }]),
  special('tower', 'lookout_tower', 'Lookout Tower', 'Reveals a 20-tile radius around the town.',
    cost(1000, 5), ['fort'], [{ type: 'reveal_map', radius: 20 }]),
  special('tower', 'wall_of_knowledge', 'Wall of Knowledge', '+1 Knowledge to each visiting hero (once).',
    cost(1000, 0, 5), ['mage_guild_1'], [visit('knowledge', 1)]),
  artifactMerchants('tower'),
  horde('tower', 'sculptors_wings', "Sculptor's Wings", 2, 4, cost(1000)),
  grail('tower', 'Skyship', 'Reveals the whole map; +15 Knowledge to a hero defending the town.',
    [{ type: 'reveal_map', all: true }, garrison('knowledge', 15)]),

  // --- Inferno ---
  special('inferno', 'castle_gate', 'Castle Gate', 'Teleport a visiting hero to another of your Castle Gates.',
    cost(10000, 5, 5), ['citadel'], [{ type: 'town_gate' }]),
  special('inferno', 'order_of_fire', 'Order of Fire', '+1 Spell Power to each visiting hero (once).',
    cost(1000, 5), ['mage_guild_1'], [visit('power', 1)]),
  special('inferno', 'brimstone_stormclouds', 'Brimstone Stormclouds', '+2 Spell Power to a hero defending the town.',
    cost(1000, 0, 0, 0, 2), ['fort'], [garrison('power', 2)]),
  horde('inferno', 'birthing_pools', 'Birthing Pools', 1, 8, cost(1000)),
  horde('inferno', 'cages', 'Cages', 3, 3, cost(1000)),
  grail('inferno', 'Deity of Fire', 'Every week is the Week of the Imp.',
    [{ type: 'week_of_creature', creatureId: 'imp', growthBonus: 15 }]),

  // --- Necropolis ---
  special('necropolis', 'cover_of_darkness', 'Cover of Darkness', 'Shrouds a 20-tile radius around the town from enemies.',
    cost(1000), ['fort'], [{ type: 'fog_cover', radius: 20 }]),
  special('necropolis', 'necromancy_amplifier', 'Necromancy Amplifier', "+10% Necromancy for all of the owner's heroes.",
    cost(1000), ['mage_guild_1'], [{ type: 'necromancy_bonus', percent: 10 }]),
  special('necropolis', 'skeleton_transformer', 'Skeleton Transformer', 'Turns any creatures into Skeletons (dragons into Bone Dragons).',
    cost(1000), ['necropolis_dwelling_1'], [{ type: 'skeleton_transform' }]),
  horde('necropolis', 'unearthed_graves', 'Unearthed Graves', 1, 6, cost(1000)),
  grail('necropolis', 'Soul Prison', "+20% Necromancy for all of the owner's heroes.",
    [{ type: 'necromancy_bonus', percent: 20 }]),

  // --- Dungeon ---
  special('dungeon', 'mana_vortex', 'Mana Vortex', "Doubles a visiting hero's spell points once per week.",
    cost(1000), ['mage_guild_1'], [{ type: 'mana_double' }]),
  special('dungeon', 'portal_of_summoning', 'Portal of Summoning', 'Recruit creatures from an external dwelling you have flagged.',
    cost(2500, 0, 5), ['fort'], [{ type: 'portal_of_summoning' }]),
  special('dungeon', 'battle_scholar_academy', 'Battle Scholar Academy', '+1000 experience to each visiting hero (once).',
    cost(1000, 5, 5), [], [visit('experience', 1000)]),
  artifactMerchants('dungeon'),
  horde('dungeon', 'mushroom_rings', 'Mushroom Rings', 1, 7, cost(1000)),
  grail('dungeon', 'Guardian of Earth', '+12 Spell Power to a hero defending the town.', [garrison('power', 12)]),

  // --- Stronghold ---
  special('stronghold', 'escape_tunnel', 'Escape Tunnel', 'A defending hero may retreat or surrender during a siege.',
    cost(2000, 5, 5), ['fort'], [{ type: 'escape_tunnel' }]),
  special('stronghold', 'freelancers_guild', "Freelancer's Guild", 'Trade creatures for resources.',
    cost(1000), ['marketplace'], [{ type: 'trade_creatures_for_resources' }], { kind: 'market' }),
  special('stronghold', 'ballista_yard', 'Ballista Yard', 'Sells Ballistas.',
    cost(1000, 5), ['blacksmith'],
    [{ type: 'sells_war_machine', machineId: 'ballista', cost: WAR_MACHINE_COST.ballista }], { kind: 'blacksmith' }),
  special('stronghold', 'hall_of_valhalla', 'Hall of Valhalla', '+1 Attack to each visiting hero (once).',
    cost(1000), ['fort'], [visit('attack', 1)]),
  horde('stronghold', 'mess_hall', 'Mess Hall', 1, 8, cost(1000)),
  grail('stronghold', "Warlords' Monument", '+20 Attack to a hero defending the town.', [garrison('attack', 20)]),

  // --- Fortress ---
  special('fortress', 'cage_of_warlords', 'Cage of Warlords', '+1 Defense to each visiting hero (once).',
    cost(1000), ['fort'], [visit('defense', 1)]),
  special('fortress', 'glyphs_of_fear', 'Glyphs of Fear', '+2 Defense to a hero defending the town.',
    cost(1000), ['fort'], [garrison('defense', 2)]),
  special('fortress', 'blood_obelisk', 'Blood Obelisk', '+2 Attack to a hero defending the town.',
    cost(1000), ['fortress_glyphs_of_fear'], [garrison('attack', 2)]),
  horde('fortress', 'captains_quarters', "Captain's Quarters", 1, 6, cost(1000)),
  grail('fortress', 'Carnivorous Plant', '+10 Attack and +10 Defense to a hero defending the town.',
    [garrison('attack', 10), garrison('defense', 10)]),

  // --- Conflux ---
  special('conflux', 'magic_university', 'Magic University', 'Visiting heroes may learn Air, Earth, Fire or Water Magic for 2000 gold each.',
    cost(5000, 10, 10), ['mage_guild_1'],
    [{ type: 'teach_skill', skills: ['air_magic', 'earth_magic', 'fire_magic', 'water_magic'], cost: 2000 }]),
  horde('conflux', 'garden_of_life', 'Garden of Life', 1, 10, cost(1000)),
  artifactMerchants('conflux'),
  grail('conflux', 'Aurora Borealis', 'The Mage Guild contains every spell.', [{ type: 'all_spells' }]),

  // --- Cove (HotA; costs approximate) ---
  special('cove', 'pub', 'Pub', 'An upgraded Tavern: far better thieves\' guild information and +2 morale for the defenders.',
    cost(2000, 5, 0, 0, 0, 0, 0), ['tavern'],
    [{ type: 'recruit_heroes', cost: TAVERN_HERO_COST, pool: TAVERN_POOL_SIZE },
      { type: 'thieves_guild', value: 3 }, garrison('morale', 2)],
    { replaces: 'tavern', kind: 'tavern' }),
  special('cove', 'grotto', 'Grotto', 'Sacrifice creatures or artifacts for experience.',
    cost(3000, 5, 5), ['marketplace'], [{ type: 'sacrifice_altar', creatures: true, artifacts: true }]),
  horde('cove', 'roost', 'Roost', 4, 3, cost(1500, 5)),
  horde('cove', 'gunpowder_warehouse', 'Gunpowder Warehouse', 3, 4, cost(1500, 0, 0, 0, 5), ['blacksmith']),
  grail('cove', 'Lodestar', 'All terrain counts as native for Cove creatures in the owner\'s armies.',
    [{ type: 'native_terrain_all', faction: 'cove' }]),

  // --- Factory (HotA-inspired; names/costs partly invented, see doc) ---
  special('factory', 'mana_generator', 'Mana Generator', "Doubles a visiting hero's spell points once per week.",
    cost(2000, 0, 5, 5), ['mage_guild_1'], [{ type: 'mana_double' }]),
  special('factory', 'bank', 'Bank', "Each week adds 5% interest to the owner's gold.",
    cost(4000, 5, 5), ['marketplace', 'town_hall'], [{ type: 'gold_interest', percent: 5 }]),
  artifactMerchants('factory'),
  special('factory', 'proving_grounds', 'Proving Grounds', '+1 Attack and +1 Knowledge to each visiting hero (once).',
    cost(2500, 5, 5), ['blacksmith', 'mage_guild_1'], [visit('attack', 1), visit('knowledge', 1)]),
  horde('factory', 'burrows', 'Burrows', 1, 8, cost(1000)),
  horde('factory', 'stockyard', 'Stockyard', 3, 3, cost(1500, 5)),
  grail('factory', 'Perpetual Engine', "+3 spell points per day and +1 morale for all of the owner's heroes.",
    [{ type: 'player_hero_bonus', bonus: { type: 'mana_regen', value: 3 } },
      { type: 'player_hero_bonus', bonus: { type: 'morale', value: 1 } }]),
];

// ---------------------------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------------------------

/** @type {Building[]} */
export const BUILDINGS = [...COMMON, ...buildDwellings(), ...SPECIALS];

export const BUILDING_BY_ID = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));

/** @param {string} id @returns {Building} */
export function getBuilding(id) {
  const b = BUILDING_BY_ID[id];
  if (!b) throw new Error(`Unknown building: ${id}`);
  return b;
}

/** Is a building (common or faction specific) available to towns of this faction? */
export function isAvailableTo(building, factionId) {
  const f = getFaction(factionId);
  if (building.faction !== 'common') return building.faction === factionId;
  if (building.factions && !building.factions.includes(factionId)) return false;
  if (building.mageGuildLevel && building.mageGuildLevel > f.mageGuildMax) return false;
  return true;
}

/** Every building a town of this faction can ever have (common + faction specific). */
export function buildingsForFaction(factionId) {
  return BUILDINGS.filter((b) => isAvailableTo(b, factionId));
}

/** Effects of a building as resolved for a town of `factionId` (blacksmith / silo differ per faction). */
export function getBuildingEffects(buildingId, factionId) {
  const b = getBuilding(buildingId);
  const extra = (b.effectsByFaction && factionId && b.effectsByFaction[factionId]) || [];
  return [...b.effects, ...extra];
}

/** Ids of buildings that directly replace `id`. */
export function upgradesOf(id) {
  return BUILDINGS.filter((b) => b.replaces === id).map((b) => b.id);
}

/** `id` plus everything that (transitively) replaces it, e.g. fort -> [fort, citadel, castle]. */
export function successorsOf(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const up of upgradesOf(out[i])) if (!out.includes(up)) out.push(up);
  }
  return out;
}

/** `id` plus everything it (transitively) replaced, e.g. castle -> [castle, citadel, fort]. */
export function predecessorsOf(id) {
  const out = [];
  for (let cur = id; cur; cur = getBuilding(cur).replaces) out.push(cur);
  return out;
}

/** True when `id` or any upgrade replacing it is in `builtIds` (town.buildings holds only the newest of a chain). */
export function isBuilt(builtIds, id) {
  return successorsOf(id).some((s) => builtIds.includes(s));
}

/** Requirements of `id` not yet satisfied by `builtIds`. */
export function missingRequirements(builtIds, id) {
  return getBuilding(id).requires.filter((r) => !isBuilt(builtIds, r));
}

/**
 * Structural buildability (no resources / per-day / capitol / water / grail checks - those need game state).
 * @returns {{ok:true}|{ok:false,error:string}}
 */
export function checkBuildable(builtIds, id, factionId) {
  const b = getBuilding(id);
  if (!isAvailableTo(b, factionId)) return { ok: false, error: 'not_available' };
  if (isBuilt(builtIds, id)) return { ok: false, error: 'already_built' };
  if (missingRequirements(builtIds, id).length) return { ok: false, error: 'missing_requirements' };
  return { ok: true };
}

/** town.buildings after constructing `id` (removes the replaced building). */
export function applyBuild(builtIds, id) {
  const b = getBuilding(id);
  return [...builtIds.filter((x) => x !== b.replaces), id];
}

/** All dwellings of a faction (14, or 16 for Factory), ordered by tier, base before upgraded. */
export function dwellingsForFaction(factionId) {
  return BUILDINGS.filter((b) => b.faction === factionId && b.kind === 'dwelling');
}

/** Horde buildings affecting a tier of a faction. */
export function hordesForTier(factionId, tier) {
  return BUILDINGS.filter((b) => b.faction === factionId && b.kind === 'horde'
    && b.effects.some((e) => e.type === 'creature_growth' && e.tier === tier));
}

export function grailOf(factionId) {
  return getBuilding(`${factionId}_grail`);
}

/** Sum of all `cost` entries of a list of buildings. */
export function totalCost(ids) {
  const sum = {};
  for (const id of ids) {
    for (const [r, v] of Object.entries(getBuilding(id).cost)) sum[r] = (sum[r] ?? 0) + v;
  }
  return sum;
}

/**
 * Marketplace efficiency for N marketplaces owned by the player (N >= 1): 10% .. 50% (cap at 9).
 * Artifact merchants use `artifactTradeEfficiency`.
 */
export function marketEfficiency(markets) {
  return Math.min((markets + 1) / 20, 0.5);
}
export function artifactTradeEfficiency(markets) {
  return Math.min((markets + 3) / 20, 0.6);
}

/**
 * Exchange rate at the marketplace: `{give, get}` = units of `from` paid for units of `to`.
 * One side is always 1. See docs/mechanics/towns.md "Marketplace".
 */
/** Math.ceil that ignores floating-point noise (250 / (1 / 0.7) must be 175, not 176). */
function ceilSafe(x) {
  return Math.ceil(x - 1e-9);
}

export function marketRate(from, to, markets) {
  const r = RESOURCE_VALUE[from];
  const g = RESOURCE_VALUE[to] / marketEfficiency(markets);
  if (r === undefined || !RESOURCE_VALUE[to]) throw new Error(`Unknown resource in trade: ${from}/${to}`);
  if (from === to) return { give: 1, get: 1 };
  if (r > g) return { give: 1, get: ceilSafe(r / g) };
  return { give: Math.floor(g / r + 0.5), get: 1 };
}

/**
 * Freelancer's Guild efficiency by number of marketplaces (index = markets, capped at 8). Unlike the
 * marketplace this is a table in the original (as reverse-engineered by VCMI), not (n+1)/20.
 */
export const FREELANCER_EFFICIENCY = [0, 0.3, 0.45, 0.5, 0.65, 0.7, 0.85, 0.9, 1.0];
export function freelancerEfficiency(markets) {
  return FREELANCER_EFFICIENCY[Math.max(1, Math.min(markets, FREELANCER_EFFICIENCY.length - 1))];
}

/** Freelancer's Guild: resources received for ONE creature with gold cost `creatureGoldCost`. */
export function freelancerRate(creatureGoldCost, to, markets) {
  const r = creatureGoldCost;
  const g = RESOURCE_VALUE[to] / freelancerEfficiency(markets);
  if (r > g) return { give: 1, get: ceilSafe(r / g) };
  return { give: Math.floor(g / r + 0.5), get: 1 };
}

/** Artifact Merchants: units of `resource` to pay for an artifact worth `artifactValue` gold. */
export function artifactBuyPrice(artifactValue, resource, markets) {
  const r = RESOURCE_VALUE[resource] / (resource === 'gold' ? 1 : 2);
  const g = artifactValue / artifactTradeEfficiency(markets);
  return Math.max(1, Math.floor(g / r + 0.5));
}

/** Artifact Merchants: units of `resource` received for selling an artifact worth `artifactValue` gold. */
export function artifactSellPrice(artifactValue, resource, markets) {
  const r = artifactValue * artifactTradeEfficiency(markets);
  return Math.max(1, Math.floor(r / RESOURCE_VALUE[resource] + 0.5));
}

/**
 * Starting building templates. '<faction>' is substituted by `startingBuildings`.
 *  main  - each player's starting town
 *  other - every other town on the map (neutral or extra player towns)
 */
export const STARTING_BUILDINGS = {
  main: ['village_hall', 'fort', 'tavern', '<faction>_dwelling_1'],
  other: ['village_hall', 'fort', '<faction>_dwelling_1'],
};

/** @param {string} factionId @param {'main'|'other'} [role] */
export function startingBuildings(factionId, role = 'main') {
  getFaction(factionId);
  const tpl = STARTING_BUILDINGS[role];
  if (!tpl) throw new Error(`Unknown starting role: ${role}`);
  return tpl.map((id) => id.replace('<faction>', factionId));
}
