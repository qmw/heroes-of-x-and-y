// Adventure-map object definitions (data only).
// Exact semantics of every effect type: docs/mechanics/adventure-objects.md
import { FACTIONS, RARE_RESOURCES } from '../core/constants.js';
import { LAND_TERRAINS, SURFACE_TERRAINS } from './terrain.js';

/**
 * @typedef {Object} MapObjectDef
 * @property {string} id
 * @property {string} name
 * @property {string} category        one of CATEGORIES
 * @property {{type: string}} effect  type is a key of EFFECT_TYPES
 * @property {string} revisit         one of REVISIT
 * @property {boolean} blocking       footprint tiles (other than the entrance) block movement
 * @property {boolean} visitable      has an entrance a hero can interact with
 * @property {boolean} removable      disappears after a successful visit
 * @property {[number, number]} size  footprint [w, h]; entrance = bottom row, column floor(w/2)
 * @property {string} interact        'enter' (hero ends on the entrance tile) | 'adjacent' (hero stays put) | 'none'
 * @property {string[]} terrains      terrain ids the generator may place it on
 * @property {number} value           map-generator budget value / AI desirability
 * @property {number} frequency       RMG rarity weight (0 = never placed randomly)
 * @property {number} [limit]         max copies per zone for the RMG
 * @property {string} shape           one of SHAPES (procedural gfx hint)
 * @property {string} color           hex accent colour
 * @property {string} description
 * @property {boolean} extra          true = not in the original game
 */

export const CATEGORIES = [
  'resource', 'mine', 'dwelling', 'visit_once', 'visit_weekly', 'visit_per_hero', 'visit_per_player',
  'bank', 'transport', 'treasure', 'decor', 'guard', 'town', 'special',
];

/** Who may (re)visit and when. See doc section "Revisit rules". */
export const REVISIT = [
  'none',            // not visitable
  'removed',         // object disappears on the first successful visit
  'once',            // first hero ever; object stays, marked visited for everybody
  'per_hero',        // each hero once per game
  'per_player',      // each player once per game
  'per_battle',      // each hero; again only after that hero has fought a battle
  'per_hero_daily',  // each hero once per day
  'per_hero_weekly', // each hero once per week
  'weekly',          // object-wide: first hero each week
  'monthly',         // object-wide: refreshes on day 1 of each month
  'always',          // no limit
];

export const INTERACT = ['enter', 'adjacent', 'none'];

export const SHAPES = [
  'pile', 'chest', 'campfire', 'crate', 'artifact', 'scroll', 'box', 'marker', 'mine', 'mill', 'garden',
  'tent', 'wagon', 'bones', 'tomb', 'ship', 'tower', 'stone', 'tree', 'hut', 'shrine', 'pyramid',
  'altar', 'statue', 'fountain', 'ring', 'pond', 'flag', 'buoy', 'temple', 'building', 'well',
  'stall', 'cage', 'fort', 'lighthouse', 'observatory', 'pillar', 'obelisk', 'sign', 'bottle',
  'gate', 'portal', 'whirlpool', 'boat', 'dwelling', 'bank', 'monster', 'town',
  // decor
  'pine', 'palm', 'dead_tree', 'mangrove', 'mountain', 'volcano', 'rock', 'sea_rock', 'reef', 'kelp',
  'lake', 'frozen_lake', 'lava_lake', 'oasis_lake', 'lava_flow', 'crater', 'canyon', 'mushroom',
  'stalagmite', 'crystal', 'stump', 'log', 'shrub', 'flowers', 'cactus', 'dune', 'reeds', 'moss',
  'ice_block', 'tar_pit', 'hole',
];

/** Closed set of effect types. One line each; the full contract is in the mechanics doc. */
export const EFFECT_TYPES = {
  none: 'Does nothing (scenery, markers, holes).',
  pickup: 'Roll `table` (chance %), grant the Reward to the visiting hero/player, object removed.',
  chest: 'Treasure chest: roll `table`; gold-or-experience outcomes raise a choice, artifact outcome is automatic.',
  artifact: 'Artifact lying on the map: hero takes it (after guards / payment set on the instance).',
  spell_scroll: 'Artifact pickup of a Spell Scroll holding one random spell.',
  pandoras_box: 'Instance-parametrised box: optional guards, then grants/removes a bundle of things.',
  event: 'Invisible walk-on trigger with the same payload as pandoras_box, filtered by player.',
  grail: 'Hidden grail location; only reachable by digging.',
  mine: 'Flaggable; owner receives `amount` of `resource` at the start of every day.',
  weekly_reward: 'Object refills each week; the first visitor of the week gets a Reward from `table`.',
  reward_once: 'One-time cache: first visitor rolls `table`; later visitors get nothing (or only the penalty).',
  bank: 'Creature bank: confirm, fight a guard set rolled at map start, winner takes that level\'s Reward.',
  primary_boost: 'Permanent primary-skill gain, once per hero; optional choice between stats and optional cost.',
  exp_boost: 'Flat experience gain, once per hero; optional cost.',
  level_up: 'Tree of Knowledge: hero gains exactly one level; the price is rolled per object.',
  library: 'Library of Enlightenment: +2 to all primary skills if hero level requirement is met.',
  learn_skill: 'Teaches a secondary skill rolled per object (Witch Hut family).',
  scholar: 'Wandering scholar: teaches one primary point, secondary skill or spell, then vanishes.',
  university: 'Sells Basic level of 4 secondary skills rolled per object.',
  learn_spell: 'Teaches the spell rolled per object (Shrine family).',
  altar_of_sacrifice: 'Convert artifacts (good) or creatures (evil) into experience.',
  temp_bonus: 'Temporary Bonus entries on the hero (morale/luck/movement...) plus optional instant movement.',
  mana_restore: 'Restores or overcharges spell points.',
  market: 'Opens a trade window (resources / creatures-for-resources) with a fixed marketplace count.',
  black_market: 'Sells artifacts rolled per object.',
  refugee_camp: 'Sells one random creature type, re-rolled weekly.',
  tavern: 'Hire heroes exactly as in a town tavern.',
  war_machine_factory: 'Sells Ballista, Ammo Cart and First Aid Tent.',
  thieves_guild: 'Shows the Thieves\' Guild comparison screen.',
  sanctuary: 'Hero standing inside cannot be attacked.',
  prison: 'Frees the imprisoned hero, who joins the visiting player; object removed.',
  hill_fort: 'Upgrade creatures in the hero\'s army at tier-discounted cost.',
  lighthouse: 'Flaggable; +movement at sea for every hero of the owner.',
  shipyard: 'Flaggable; builds a boat on an adjacent water tile.',
  reveal_map: 'Removes fog of war in an area / of a kind for the visiting player.',
  hide_map: 'Covers an area with fog of war for every OTHER player.',
  obelisk: 'Reveals part of the grail puzzle map for the visiting player.',
  message: 'Displays text (sign); removable variants vanish (ocean bottle).',
  quest_guard: 'Blocks the way until the quest stored on the instance is fulfilled, then vanishes.',
  border_guard: 'Blocks the way; passes players who visited the Keymaster\'s Tent of the same colour.',
  keymaster_tent: 'Gives the visiting player the key of its colour.',
  seer_hut: 'Offers a quest stored on the instance and pays a Reward once on completion.',
  garrison: 'Flaggable gate holding an army; enemies must defeat it to pass.',
  teleport: 'Moves the hero to a linked exit (monoliths, subterranean gates, whirlpools).',
  boat: 'Vehicle: boarding turns a land hero into a sailing hero.',
  dwelling: 'Flaggable external dwelling: weekly stock of creatures to hire, +growth in towns.',
  monster: 'Wandering monster stack guarding its neighbouring tiles; fights, flees or joins.',
  town: 'Town placeholder for the map generator; behaviour lives in the town engine.',
};

// ---------------------------------------------------------------------------------------------
// helpers

const LAND = LAND_TERRAINS;
const SURFACE = SURFACE_TERRAINS;
const WATER = ['water'];
const NON_GOLD = ['wood', 'ore', 'mercury', 'sulfur', 'crystal', 'gems'];

const DEFAULT_REVISIT = {
  resource: 'removed', treasure: 'removed', mine: 'always', dwelling: 'always', visit_once: 'once',
  visit_weekly: 'weekly', visit_per_hero: 'per_hero', visit_per_player: 'per_player', bank: 'once',
  transport: 'always', decor: 'none', guard: 'always', town: 'always', special: 'always',
};

/** Build a full definition from the compact form. */
function def(id, name, category, effect, o = {}) {
  const pickup = category === 'resource' || category === 'treasure';
  return {
    id, name, category, effect,
    revisit: DEFAULT_REVISIT[category],
    blocking: true, visitable: category !== 'decor', removable: pickup,
    size: [1, 1], interact: category === 'decor' ? 'none' : pickup ? 'adjacent' : 'enter',
    terrains: LAND, value: 0, frequency: 0,
    shape: 'building', color: '#b0a080', description: '', extra: false,
    ...o,
  };
}

const row = (chance, reward) => ({ chance, reward });
const g = (creatureId, count, stacks = 1) => ({ creatureId, count, stacks });
const lvl = (chance, guards, reward, value) => ({ chance, guards, reward, value });
const art = (cls, count = 1) => ({ class: cls, count });
const temp = (bonus, until) => ({ bonus, until });
const allOf = (n) => Object.fromEntries(NON_GOLD.map((r) => [r, n]));

// ---------------------------------------------------------------------------------------------
// exported vocab used inside effects

export const KEY_COLORS = ['light_blue', 'green', 'red', 'dark_blue', 'brown', 'purple', 'white', 'black'];
const KEY_HEX = { light_blue: '#6ac4f0', green: '#3cae4a', red: '#d03a2a', dark_blue: '#2a4ab0', brown: '#8a5a2a', purple: '#8a3ab0', white: '#f0f0f0', black: '#202020' };
export const MONOLITH_COLORS = ['blue', 'pink', 'orange', 'yellow'];
export const TWO_WAY_COLORS = ['green', 'brown', 'violet', 'white'];
const MONO_HEX = { blue: '#3a6ad8', pink: '#e86ab0', orange: '#e8862a', yellow: '#e8d83a', green: '#3cae4a', brown: '#8a5a2a', violet: '#8a3ad8', white: '#f0f0f0' };

/** Stack-size labels shown instead of exact counts. `max: null` = unbounded. */
export const MONSTER_SIZE_LABELS = [
  { id: 'few', name: 'Few', min: 1, max: 4 },
  { id: 'several', name: 'Several', min: 5, max: 9 },
  { id: 'pack', name: 'Pack', min: 10, max: 19 },
  { id: 'lots', name: 'Lots', min: 20, max: 49 },
  { id: 'horde', name: 'Horde', min: 50, max: 99 },
  { id: 'throng', name: 'Throng', min: 100, max: 249 },
  { id: 'swarm', name: 'Swarm', min: 250, max: 499 },
  { id: 'zounds', name: 'Zounds', min: 500, max: 999 },
  { id: 'legion', name: 'Legion', min: 1000, max: null },
];

/** @param {number} count */
export function monsterSizeLabel(count) {
  return MONSTER_SIZE_LABELS.find((l) => count >= l.min && (l.max === null || count <= l.max)) || MONSTER_SIZE_LABELS[0];
}

/**
 * Disposition -> "character" value rolled once per stack at map start, uniformly in [min, max].
 * Compared against the hero's charisma (see doc "Wandering monsters").
 */
export const MONSTER_DISPOSITIONS = [
  { id: 'compliant', name: 'Compliant', character: [-4, -4], description: 'Always joins.' },
  { id: 'friendly', name: 'Friendly', character: [1, 7], description: 'Likely to join.' },
  { id: 'aggressive', name: 'Aggressive', character: [1, 10], description: 'May join (default).' },
  { id: 'hostile', name: 'Hostile', character: [4, 10], description: 'Unlikely to join.' },
  { id: 'savage', name: 'Savage', character: [10, 10], description: 'Never joins.' },
];

/** Random starting stack size by creature tier, used when the instance has no explicit count. */
export const MONSTER_COUNT_BY_TIER = {
  1: [20, 50], 2: [16, 30], 3: [12, 25], 4: [10, 20], 5: [6, 12], 6: [4, 8], 7: [2, 4], 8: [1, 2],
};

export const QUEST_TYPES = [
  'reach_level',      // { level }
  'reach_primary',    // { stats: { attack?, defense?, power?, knowledge? } } base + bonuses
  'kill_hero',        // { heroId }
  'kill_monster',     // { objectId }
  'bring_artifacts',  // { artifactIds: [...] } taken from the hero
  'bring_creatures',  // { creatures: [{creatureId, count}] } taken from the hero
  'bring_resources',  // { resources: Resources } taken from the player
  'be_hero',          // { heroDefId }
  'be_player',        // { playerId }
];

export const QUEST_REWARD_TYPES = [
  'exp', 'mana', 'morale', 'luck', 'resources', 'primary', 'skill', 'artifact', 'spell', 'creatures',
];

/** Seer-hut quest/reward pairs the random map generator may use (value = RMG budget). */
export const SEER_PRESETS = [
  { quest: { type: 'bring_artifacts', class: 'treasure', count: 1 }, reward: { exp: 5000 }, value: 2000 },
  { quest: { type: 'bring_artifacts', class: 'treasure', count: 1 }, reward: { resources: { gold: 5000 } }, value: 2000 },
  { quest: { type: 'bring_artifacts', class: 'minor', count: 1 }, reward: { exp: 10000 }, value: 5333 },
  { quest: { type: 'bring_artifacts', class: 'minor', count: 1 }, reward: { resources: { gold: 10000 } }, value: 5333 },
  { quest: { type: 'bring_artifacts', class: 'major', count: 1 }, reward: { exp: 15000 }, value: 8666 },
  { quest: { type: 'bring_artifacts', class: 'major', count: 1 }, reward: { resources: { gold: 15000 } }, value: 8666 },
  { quest: { type: 'bring_artifacts', class: 'relic', count: 1 }, reward: { exp: 20000 }, value: 12000 },
  { quest: { type: 'bring_artifacts', class: 'relic', count: 1 }, reward: { resources: { gold: 20000 } }, value: 12000 },
  { quest: { type: 'reach_level', level: 10 }, reward: { primary: { random: 2 } }, value: 4000 },
  { quest: { type: 'bring_resources', resources: { gold: 5000 } }, reward: { artifacts: [{ class: 'minor', count: 1 }] }, value: 3000 },
  { quest: { type: 'kill_monster', nearest: true }, reward: { artifacts: [{ class: 'major', count: 1 }] }, value: 7000 },
  { quest: { type: 'bring_creatures', tier: 3, count: 20 }, reward: { exp: 8000 }, value: 4000 },
];

/** Pandora's Box contents the random map generator may use. */
export const PANDORA_PRESETS = [
  { id: 'gold_5000', reward: { resources: { gold: 5000 } }, value: 5000, frequency: 40 },
  { id: 'gold_10000', reward: { resources: { gold: 10000 } }, value: 10000, frequency: 40 },
  { id: 'gold_15000', reward: { resources: { gold: 15000 } }, value: 15000, frequency: 40 },
  { id: 'gold_20000', reward: { resources: { gold: 20000 } }, value: 20000, frequency: 40 },
  { id: 'exp_5000', reward: { exp: 5000 }, value: 6000, frequency: 40 },
  { id: 'exp_10000', reward: { exp: 10000 }, value: 12000, frequency: 40 },
  { id: 'exp_15000', reward: { exp: 15000 }, value: 18000, frequency: 40 },
  { id: 'exp_20000', reward: { exp: 20000 }, value: 24000, frequency: 40 },
  // creatures: count = floor(budget / creature.aiValue) of a random creature of the zone's town, per tier
  { id: 'creatures_tier_1', reward: { creaturesByValue: { tier: 1, aiValue: 3000 } }, value: 3000, frequency: 30 },
  { id: 'creatures_tier_2', reward: { creaturesByValue: { tier: 2, aiValue: 4500 } }, value: 4500, frequency: 30 },
  { id: 'creatures_tier_3', reward: { creaturesByValue: { tier: 3, aiValue: 6000 } }, value: 6000, frequency: 30 },
  { id: 'creatures_tier_4', reward: { creaturesByValue: { tier: 4, aiValue: 8000 } }, value: 8000, frequency: 30 },
  { id: 'creatures_tier_5', reward: { creaturesByValue: { tier: 5, aiValue: 10000 } }, value: 10000, frequency: 30 },
  { id: 'creatures_tier_6', reward: { creaturesByValue: { tier: 6, aiValue: 15000 } }, value: 15000, frequency: 30 },
  { id: 'creatures_tier_7', reward: { creaturesByValue: { tier: 7, aiValue: 20000 } }, value: 20000, frequency: 30 },
  { id: 'spells_level_1', reward: { spells: { level: 1, count: 'all' } }, value: 5000, frequency: 20 },
  { id: 'spells_level_2', reward: { spells: { level: 2, count: 'all' } }, value: 7500, frequency: 20 },
  { id: 'spells_level_3', reward: { spells: { level: 3, count: 'all' } }, value: 10000, frequency: 20 },
  { id: 'spells_level_4', reward: { spells: { level: 4, count: 'all' } }, value: 12500, frequency: 20 },
  { id: 'spells_level_5', reward: { spells: { level: 5, count: 'all' } }, value: 15000, frequency: 20 },
  { id: 'spells_air', reward: { spells: { school: 'air', count: 15 } }, value: 15000, frequency: 20 },
  { id: 'spells_earth', reward: { spells: { school: 'earth', count: 15 } }, value: 15000, frequency: 20 },
  { id: 'spells_fire', reward: { spells: { school: 'fire', count: 15 } }, value: 15000, frequency: 20 },
  { id: 'spells_water', reward: { spells: { school: 'water', count: 15 } }, value: 15000, frequency: 20 },
  { id: 'spells_all', reward: { spells: { count: 60 } }, value: 30000, frequency: 20 },
];

// ---------------------------------------------------------------------------------------------
// 1. pickups

const RES_NAME = { wood: 'Wood', ore: 'Ore', mercury: 'Mercury', sulfur: 'Sulfur', crystal: 'Crystal', gems: 'Gems', gold: 'Gold' };
const RES_HEX = { wood: '#8a5a2a', ore: '#7a7a82', mercury: '#c0c8d8', sulfur: '#e8d83a', crystal: '#d03a4a', gems: '#3ad0a0', gold: '#e8c040' };
const RES_RANGE = { wood: [5, 10], ore: [5, 10], mercury: [3, 6], sulfur: [3, 6], crystal: [3, 6], gems: [3, 6], gold: [500, 1000, 100] };
const RES_VALUE = { wood: 1400, ore: 1400, mercury: 2000, sulfur: 2000, crystal: 2000, gems: 2000, gold: 750 };

const PICKUPS = [
  ...Object.keys(RES_NAME).map((r) => def(`resource_${r}`, RES_NAME[r], 'resource',
    { type: 'pickup', table: [row(100, { resources: { [r]: RES_RANGE[r] } })] },
    { value: RES_VALUE[r], frequency: 300, shape: 'pile', color: RES_HEX[r],
      description: `A pile of ${RES_NAME[r].toLowerCase()}: ${RES_RANGE[r][0]}-${RES_RANGE[r][1]}.` })),
  def('resource_random', 'Random Resource', 'resource',
    { type: 'pickup', placeholder: true, replaceWith: Object.keys(RES_NAME).map((r) => `resource_${r}`), table: [row(100, {})] },
    { value: 1500, frequency: 0, shape: 'pile', color: '#c0c0c0', description: 'Generator placeholder replaced by a random resource pile.' }),

  def('treasure_chest', 'Treasure Chest', 'treasure',
    { type: 'chest', table: [
      { chance: 32, gold: 1000, exp: 500 },
      { chance: 32, gold: 1500, exp: 1000 },
      { chance: 31, gold: 2000, exp: 1500 },
      { chance: 5, artifact: art('treasure') },
    ] },
    { value: 1500, frequency: 500, shape: 'chest', color: '#b8862a',
      description: 'Gold (1000/1500/2000) or experience (500/1000/1500); 5%: a treasure artifact instead.' }),
  def('campfire', 'Campfire', 'treasure',
    { type: 'pickup', table: [
      row(34, { resources: { gold: 400 }, randomResource: { pool: NON_GOLD, amount: 4 } }),
      row(33, { resources: { gold: 500 }, randomResource: { pool: NON_GOLD, amount: 5 } }),
      row(33, { resources: { gold: 600 }, randomResource: { pool: NON_GOLD, amount: 6 } }),
    ] },
    { value: 2000, frequency: 500, shape: 'campfire', color: '#e8762a',
      description: '400-600 gold and 4-6 of one random other resource.' }),
  def('flotsam', 'Flotsam', 'treasure',
    { type: 'pickup', table: [
      row(25, {}),
      row(25, { resources: { wood: 5 } }),
      row(25, { resources: { wood: 5, gold: 200 } }),
      row(25, { resources: { wood: 10, gold: 500 } }),
    ] },
    { terrains: WATER, value: 500, frequency: 100, shape: 'crate', color: '#8a6a3e', description: 'Floating wreckage: nothing, wood, or wood and gold.' }),
  def('sea_chest', 'Sea Chest', 'treasure',
    { type: 'pickup', table: [
      row(20, {}),
      row(70, { resources: { gold: 1500 } }),
      row(10, { resources: { gold: 1000 }, artifacts: [art('treasure')] }),
    ] },
    { terrains: WATER, value: 1500, frequency: 100, shape: 'chest', color: '#3a8ab0', description: 'Empty (20%), 1500 gold (70%) or 1000 gold and a treasure artifact (10%).' }),
  def('shipwreck_survivor', 'Shipwreck Survivor', 'treasure',
    { type: 'pickup', table: [
      row(55, { artifacts: [art('treasure')] }),
      row(20, { artifacts: [art('minor')] }),
      row(20, { artifacts: [art('major')] }),
      row(5, { artifacts: [art('relic')] }),
    ] },
    { terrains: WATER, value: 1500, frequency: 50, shape: 'crate', color: '#d8b080', description: 'A rescued sailor hands over an artifact (55/20/20/5% treasure/minor/major/relic).' }),
  def('sea_barrel', 'Sea Barrel', 'treasure',
    { type: 'pickup', table: [
      row(20, {}),
      row(80, { randomResource: { pool: NON_GOLD, amount: [3, 6] } }),
    ] },
    { terrains: WATER, value: 500, frequency: 80, shape: 'crate', color: '#7a5a3a', description: 'Empty (20%) or 3-6 of a random non-gold resource.' }),
  def('jetsam', 'Jetsam', 'treasure',
    { type: 'pickup', table: [
      row(25, {}),
      row(25, { resources: { ore: 5 } }),
      row(25, { resources: { ore: 5, gold: 200 } }),
      row(25, { resources: { ore: 10, gold: 500 } }),
    ] },
    { terrains: WATER, value: 500, frequency: 80, shape: 'crate', color: '#6a6a72', description: 'Sunken cargo: nothing, ore, or ore and gold.' }),
  def('vial_of_mana', 'Vial of Mana', 'treasure',
    { type: 'pickup', table: [
      row(40, { mana: 10 }), row(30, { mana: 20 }), row(20, { mana: 30 }), row(10, { mana: 50 }),
    ] },
    { terrains: WATER, value: 500, frequency: 40, shape: 'bottle', color: '#5a6ae8', description: 'Restores 10-50 spell points (may exceed the maximum).' }),

  ...[['artifact_random', 'Random Artifact', 'any', 7000, 0], ['artifact_treasure', 'Treasure Artifact', 'treasure', 2000, 150],
    ['artifact_minor', 'Minor Artifact', 'minor', 5000, 150], ['artifact_major', 'Major Artifact', 'major', 10000, 150],
    ['artifact_relic', 'Relic Artifact', 'relic', 20000, 150]].map(([id, name, cls, value, frequency]) =>
    def(id, name, 'treasure', { type: 'artifact', class: cls }, { value, frequency, shape: 'artifact', color: '#e8c040',
      description: `An artifact (${cls} class) lying on the ground. Instances may be guarded or demand payment.` })),
  def('spell_scroll', 'Spell Scroll', 'treasure', { type: 'spell_scroll', artifactId: 'spell_scroll', spellLevel: [1, 5] },
    { value: 500, frequency: 30, shape: 'scroll', color: '#e8dcb0',
      description: 'A scroll holding one spell, castable while equipped. RMG value: level x 500 + 0 (500/2000/3000/4000/5000 for levels 1-5).',
      valueBySpellLevel: [500, 2000, 3000, 4000, 5000] }),
  def('pandoras_box', "Pandora's Box", 'treasure',
    { type: 'pandoras_box', confirm: true, presets: PANDORA_PRESETS.map((p) => p.id),
      payloadFields: ['guards', 'message', 'exp', 'mana', 'morale', 'luck', 'resources', 'primary', 'skills', 'artifacts', 'spells', 'creatures'] },
    { value: 5000, frequency: 100, shape: 'box', color: '#8a3ab0', description: 'Opening it may bless or curse: anything from gold to dragons.' }),
  def('grail', 'Grail', 'special', { type: 'grail', artifactId: 'grail' },
    { blocking: false, visitable: false, interact: 'none', revisit: 'none', value: 0, frequency: 0, shape: 'marker', color: '#e8c040',
      description: 'Invisible marker of where the Grail is buried. One per map at most.' }),
  def('hole', 'Hole', 'decor', { type: 'none' },
    { blocking: false, shape: 'hole', color: '#3a2a1a', description: 'Left behind by a hero who dug for the Grail. Cannot be dug again.' }),
];

// ---------------------------------------------------------------------------------------------
// 2. mines and income / cache objects

const mine = (id, name, resource, amount, value, color, o = {}) => def(id, name, 'mine',
  { type: 'mine', resource, amount }, { size: [3, 2], value, frequency: 0, shape: 'mine', color,
    description: `Produces ${amount} ${resource} per day for its owner.`, ...o });

const MINES = [
  mine('sawmill', 'Sawmill', 'wood', 2, 1500, RES_HEX.wood, { shape: 'mill' }),
  mine('ore_pit', 'Ore Pit', 'ore', 2, 1500, RES_HEX.ore),
  mine('alchemists_lab', "Alchemist's Lab", 'mercury', 1, 3500, RES_HEX.mercury, { shape: 'tower' }),
  mine('sulfur_dune', 'Sulfur Dune', 'sulfur', 1, 3500, RES_HEX.sulfur),
  mine('crystal_cavern', 'Crystal Cavern', 'crystal', 1, 3500, RES_HEX.crystal),
  mine('gem_pond', 'Gem Pond', 'gems', 1, 3500, RES_HEX.gems, { shape: 'pond' }),
  mine('gold_mine', 'Gold Mine', 'gold', 1000, 7000, RES_HEX.gold),
  def('abandoned_mine', 'Abandoned Mine', 'mine',
    { type: 'mine', resource: 'random', pool: ['ore', 'mercury', 'sulfur', 'crystal', 'gems', 'gold'],
      amountByResource: { ore: 2, mercury: 1, sulfur: 1, crystal: 1, gems: 1, gold: 1000 }, amount: 1,
      guards: [{ creatureId: 'troglodyte', count: [100, 249], stacks: 5 }], confirm: true },
    { size: [3, 2], value: 3500, frequency: 30, shape: 'mine', color: '#5a4a52', terrains: ['subterranean', 'dirt', 'rough', 'grass', 'wasteland'],
      description: 'Infested by a throng of troglodytes. Once cleared it becomes a random mine (never a sawmill).' }),

  def('windmill', 'Windmill', 'visit_weekly',
    { type: 'weekly_reward', table: [row(100, { randomResource: { pool: ['ore', 'mercury', 'sulfur', 'crystal', 'gems'], amount: [3, 6] } })] },
    { size: [2, 2], terrains: SURFACE.filter((t) => t !== 'lava'), value: 2500, frequency: 80, shape: 'mill', color: '#d8c8a0',
      description: 'Each week: 3-6 of a random resource (never wood or gold).' }),
  def('water_wheel', 'Water Wheel', 'visit_weekly',
    { type: 'weekly_reward', table: [row(100, { resources: { gold: 1000 } })], firstWeekTable: [row(100, { resources: { gold: 500 } })] },
    { size: [2, 2], terrains: ['grass', 'dirt', 'swamp', 'highlands', 'rough', 'snow'], value: 750, frequency: 50, shape: 'mill', color: '#4a8ad0',
      description: 'Each week: 1000 gold (only 500 during the first week of the game).' }),
  def('mystical_garden', 'Mystical Garden', 'visit_weekly',
    { type: 'weekly_reward', table: [row(50, { resources: { gems: 5 } }), row(50, { resources: { gold: 500 } })] },
    { size: [2, 1], terrains: ['grass', 'dirt', 'swamp', 'highlands', 'rough'], value: 500, frequency: 50, shape: 'garden', color: '#3cae4a',
      description: 'Each week: 5 gems or 500 gold (50/50, rolled weekly).' }),
  ...NON_GOLD.concat('gold').map((r) => def(`warehouse_of_${r}`, `Warehouse of ${RES_NAME[r]}`, 'visit_weekly',
    { type: 'weekly_reward', table: [row(100, { resources: { [r]: r === 'gold' ? 2000 : RARE_RESOURCES.includes(r) ? 6 : 10 } })] },
    { size: [2, 2], value: r === 'gold' ? 3000 : 2500, frequency: 10, shape: 'building', color: RES_HEX[r],
      description: `Each week: ${r === 'gold' ? 2000 : RARE_RESOURCES.includes(r) ? 6 : 10} ${r}.` })),

  def('lean_to', 'Lean-To', 'visit_once',
    { type: 'reward_once', table: [row(100, { randomResource: { pool: NON_GOLD, amount: [1, 5] } })] },
    { terrains: ['snow', 'highlands', 'dirt', 'rough'], value: 500, frequency: 50, shape: 'tent', color: '#8a6a3e', description: 'Once: 1-5 of a random non-gold resource.' }),
  def('wagon', 'Wagon', 'visit_once',
    { type: 'reward_once', table: [
      row(10, {}),
      row(20, { artifacts: [art('treasure')] }),
      row(20, { artifacts: [art('minor')] }),
      row(50, { randomResource: { pool: NON_GOLD, amount: [2, 5] } }),
    ] },
    { terrains: ['grass', 'dirt', 'rough', 'sand', 'wasteland', 'highlands'], value: 500, frequency: 50, shape: 'wagon', color: '#8a6a3e',
      description: 'Once: empty (10%), a treasure or minor artifact (40%), or 2-5 of a random resource (50%).' }),
  def('corpse', 'Corpse', 'visit_once',
    { type: 'reward_once', table: [
      row(80, {}),
      row(10, { artifacts: [art('treasure')] }),
      row(10, { artifacts: [art('minor')] }),
    ] },
    { value: 500, frequency: 50, shape: 'bones', color: '#d8d0c0', description: 'Once: 20% chance of a treasure or minor artifact.' }),
  def('warriors_tomb', "Warrior's Tomb", 'visit_once',
    { type: 'reward_once', confirm: true,
      table: [
        row(30, { artifacts: [art('treasure')] }),
        row(50, { artifacts: [art('minor')] }),
        row(15, { artifacts: [art('major')] }),
        row(5, { artifacts: [art('relic')] }),
      ],
      penalty: [temp({ type: 'morale', value: -3 }, 'next_battle')], penaltyWhenEmpty: true },
    { size: [2, 1], value: 6000, frequency: 20, shape: 'tomb', color: '#8a8a94',
      description: 'Robbing the grave yields an artifact (30/50/15/5%) and -3 morale until the next battle. Later visits only give the penalty.' }),
];

// ---------------------------------------------------------------------------------------------
// 3. creature banks

const bank = (id, name, levels, o = {}, fx = {}) => def(id, name, 'bank',
  { type: 'bank', confirm: true, levels, ...fx },
  { size: [3, 2], frequency: 100, shape: 'bank', ...o });

const dragonUtopiaLevels = [
  lvl(30, [g('green_dragon', 8), g('red_dragon', 5), g('gold_dragon', 2), g('black_dragon', 1)],
    { resources: { gold: 20000 }, artifacts: [art('treasure'), art('minor'), art('major'), art('relic')] }, 21000),
  lvl(30, [g('green_dragon', 8), g('red_dragon', 6), g('gold_dragon', 3), g('black_dragon', 2)],
    { resources: { gold: 30000 }, artifacts: [art('minor'), art('major'), art('relic', 2)] }, 31000),
  lvl(30, [g('green_dragon', 8), g('red_dragon', 6), g('gold_dragon', 4), g('black_dragon', 3)],
    { resources: { gold: 40000 }, artifacts: [art('major'), art('relic', 3)] }, 41000),
  lvl(10, [g('green_dragon', 8), g('red_dragon', 7), g('gold_dragon', 6), g('black_dragon', 5)],
    { resources: { gold: 50000 }, artifacts: [art('relic', 4)] }, 51000),
];

/** Four-level bank with a single guard type split into `stacks` stacks. */
const simple = (creatureId, counts, rewards, stacks = 5, upgrade = null) =>
  [30, 30, 30, 10].map((chance, i) => ({
    ...lvl(chance, [g(creatureId, counts[i], stacks)], rewards[i]),
    ...(upgrade ? { upgradedStack: { creatureId: upgrade, chance: 50 } } : {}),
  }));

const BANKS_LIST = [
  bank('cyclops_stockpile', 'Cyclops Stockpile',
    simple('cyclops', [20, 30, 40, 50], [4, 6, 8, 10].map((n) => ({ resources: allOf(n) })), 5, 'cyclops_king'),
    { value: 3000, color: '#b0733c', terrains: ['rough', 'dirt', 'grass', 'sand', 'wasteland', 'highlands', 'snow'],
      description: 'Cyclopes guard 4-10 of every non-gold resource.' }),
  bank('dwarven_treasury', 'Dwarven Treasury',
    simple('dwarf', [50, 75, 100, 150], [[2500, 2], [4000, 3], [5000, 5], [7500, 10]].map(([gold, crystal]) => ({ resources: { gold, crystal } })), 5, 'battle_dwarf'),
    { value: 2000, color: '#7a7a82', terrains: ['grass', 'dirt', 'snow', 'highlands', 'rough', 'subterranean'],
      description: 'Dwarves guard gold and crystal.' }),
  bank('griffin_conservatory', 'Griffin Conservatory',
    simple('griffin', [50, 100, 150, 200], [1, 2, 3, 4].map((n) => ({ creatures: [{ creatureId: 'angel', count: n }] })), 5, 'royal_griffin'),
    { value: 2000, color: '#e8dcb0', terrains: ['grass', 'dirt', 'snow', 'highlands', 'rough', 'sand'],
      description: 'Griffins guard captive angels who join the victor.' }),
  bank('imp_cache', 'Imp Cache',
    simple('imp', [100, 150, 200, 300], [[1000, 2], [1500, 3], [2000, 4], [3000, 6]].map(([gold, mercury]) => ({ resources: { gold, mercury } })), 5, 'familiar'),
    { value: 5000, color: '#d03a2a', terrains: ['lava', 'dirt', 'rough', 'subterranean', 'wasteland', 'grass'],
      description: 'Imps guard gold and mercury.' }),
  bank('medusa_stores', 'Medusa Stores',
    simple('medusa', [20, 30, 40, 50], [[2000, 5], [3000, 6], [4000, 8], [5000, 10]].map(([gold, sulfur]) => ({ resources: { gold, sulfur } })), 5, 'medusa_queen'),
    { value: 1500, color: '#5a8a5a', terrains: ['subterranean', 'dirt', 'swamp', 'rough', 'grass', 'lava'],
      description: 'Medusas guard gold and sulfur.' }),
  bank('naga_bank', 'Naga Bank',
    simple('naga', [10, 15, 20, 30], [[4000, 8], [6000, 12], [8000, 16], [12000, 24]].map(([gold, gems]) => ({ resources: { gold, gems } })), 5, 'naga_queen'),
    { value: 3000, color: '#3ad0a0', terrains: ['snow', 'grass', 'dirt', 'highlands', 'sand', 'swamp'],
      description: 'Nagas guard gold and gems.' }),
  bank('dragon_fly_hive', 'Dragon Fly Hive',
    simple('dragon_fly', [30, 45, 60, 90], [4, 6, 8, 12].map((n) => ({ creatures: [{ creatureId: 'wyvern', count: n }] })), 5),
    { value: 9000, color: '#6a8a3a', terrains: ['swamp', 'grass', 'dirt', 'highlands'],
      description: 'Dragon flies guard wyverns who join the victor.' }),
  bank('dragon_utopia', 'Dragon Utopia', dragonUtopiaLevels,
    { size: [3, 3], value: 10000, frequency: 100, color: '#d03a2a', terrains: SURFACE.concat('subterranean'),
      description: 'Four kinds of dragons guard 20000-50000 gold and four artifacts.' }),
  bank('crypt', 'Crypt', [
    lvl(30, [g('skeleton', 30), g('walking_dead', 20)], { resources: { gold: 1500 } }),
    lvl(30, [g('skeleton', 25), g('walking_dead', 20), g('wight', 5)], { resources: { gold: 2000 } }),
    lvl(30, [g('skeleton', 20), g('walking_dead', 20), g('wight', 10), g('vampire', 5)], { resources: { gold: 2500 }, artifacts: [art('treasure')] }),
    lvl(10, [g('skeleton', 20), g('walking_dead', 20), g('wight', 10), g('vampire', 10)], { resources: { gold: 5000 }, artifacts: [art('treasure')] }),
  ], { size: [2, 2], value: 1000, color: '#8a8a94', shape: 'tomb',
    description: 'Undead guard gold and sometimes a treasure artifact. Disturbing an empty crypt costs 1 morale.' },
  { emptyPenalty: [temp({ type: 'morale', value: -1 }, 'next_battle')] }),
  bank('derelict_ship', 'Derelict Ship', [
    lvl(30, [g('water_elemental', 20, 5)], { resources: { gold: 3000 } }),
    lvl(30, [g('water_elemental', 30, 5)], { resources: { gold: 3000 }, artifacts: [art('treasure')] }),
    lvl(30, [g('water_elemental', 40, 5)], { resources: { gold: 4000 }, artifacts: [art('treasure')] }),
    lvl(10, [g('water_elemental', 60, 5)], { resources: { gold: 6000 }, artifacts: [art('minor')] }),
  ], { terrains: WATER, value: 4000, frequency: 20, color: '#4a6a8a', shape: 'ship',
    description: 'Water elementals guard gold and artifacts aboard a drifting wreck.' },
  { emptyPenalty: [temp({ type: 'morale', value: -1 }, 'next_battle')] }),
  bank('shipwreck', 'Shipwreck', [
    lvl(30, [g('wight', 10, 5)], { resources: { gold: 2000 } }),
    lvl(30, [g('wight', 15, 5)], { resources: { gold: 3000 } }),
    lvl(30, [g('wight', 25, 5)], { resources: { gold: 4000 }, artifacts: [art('treasure')] }),
    lvl(10, [g('wight', 50, 5)], { resources: { gold: 5000 }, artifacts: [art('minor')] }),
  ], { terrains: WATER, value: 2000, frequency: 20, color: '#6a5a4a', shape: 'ship',
    description: 'Wights haunt a wreck holding gold and artifacts.' },
  { emptyPenalty: [temp({ type: 'morale', value: -1 }, 'next_battle')] }),
  bank('pyramid', 'Pyramid', [
    lvl(100, [g('gold_golem', 40, 2), g('diamond_golem', 20, 2)], { spell: { level: 5, requires: { skillId: 'wisdom', level: 3 } } }),
  ], { size: [3, 2], terrains: ['sand', 'wasteland'], value: 5000, frequency: 20, limit: 1, color: '#d8c07a', shape: 'pyramid',
    description: 'Golems guard a level 5 spell (needs Expert Wisdom and a spell book). An empty pyramid curses luck by 2.' },
  { emptyPenalty: [temp({ type: 'luck', value: -2 }, 'next_battle')] }),

  // --- HotA banks
  bank('beholders_sanctuary', "Beholders' Sanctuary",
    simple('beholder', [50, 75, 100, 150], [[2500, 1], [4000, 1], [5000, 2], [7500, 3]].map(([gold, n]) => ({ resources: { gold }, artifacts: [art('treasure', n)] })), 5, 'evil_eye'),
    { value: 2500, color: '#8a5cc0', terrains: ['subterranean', 'dirt', 'rough', 'swamp', 'lava'],
      description: 'Beholders guard gold and treasure artifacts.' }),
  bank('temple_of_the_sea', 'Temple of the Sea', [
    lvl(100, [g('hydra', 8, 2), g('sea_serpent', 6, 2), g('chaos_hydra', 3), g('haspid', 2)],
      { resources: { gold: 10000 }, artifacts: [art('treasure'), art('minor'), art('major'), art('relic')] }),
  ], { terrains: WATER, size: [3, 3], value: 10000, frequency: 10, limit: 1, color: '#2a8ab0', shape: 'temple',
    description: 'Sea monsters guard 10000 gold and one artifact of every class.' }),
  bank('pirate_cavern', 'Pirate Cavern', [
    lvl(30, [g('pirate', 20, 2), g('corsair', 20, 2), g('sea_dog', 20)], { resources: { gold: 6000 }, creatures: [{ creatureId: 'sea_dog', count: 6 }] }),
    lvl(30, [g('pirate', 30, 2), g('corsair', 30, 2), g('sea_dog', 30)], { resources: { gold: 9000 }, creatures: [{ creatureId: 'sea_dog', count: 9 }] }),
    lvl(30, [g('pirate', 40, 2), g('corsair', 40, 2), g('sea_dog', 40)], { resources: { gold: 12000 }, creatures: [{ creatureId: 'sea_dog', count: 12 }] }),
    lvl(10, [g('pirate', 60, 2), g('corsair', 60, 2), g('sea_dog', 60)], { resources: { gold: 17000 }, creatures: [{ creatureId: 'sea_dog', count: 16 }] }),
  ], { value: 3500, color: '#2a6a8a', terrains: ['swamp', 'sand', 'grass', 'dirt', 'rough', 'subterranean'],
    description: 'Pirates guard gold; surviving sea dogs sign on with the victor.' }),
  bank('mansion', 'Mansion',
    simple('vampire', [40, 60, 80, 100], [[2500, 2], [5000, 3], [7500, 4], [10000, 5]].map(([gold, n]) => ({ resources: { gold, ...allOf(n) } })), 5, 'vampire_lord'),
    { value: 5000, color: '#5a2a3a', terrains: ['dirt', 'grass', 'swamp', 'rough', 'wasteland'],
      description: 'Vampires guard gold and a little of every resource.' }),
  bank('spit', 'Spit',
    simple('basilisk', [20, 30, 40, 50], [[2000, 4], [3000, 6], [4000, 8], [5000, 10]].map(([gold, gems]) => ({ resources: { gold, gems } })), 5, 'greater_basilisk'),
    { value: 1500, color: '#6a8a3a', terrains: ['swamp', 'sand', 'dirt', 'grass', 'rough'],
      description: 'Basilisks guard gold and gems.' }),
  bank('red_tower', 'Red Tower',
    simple('fire_elemental', [35, 70, 105, 140], [1, 2, 3, 4].map((n) => ({ creatures: [{ creatureId: 'efreet_sultan', count: n * 2 }] })), 5, 'energy_elemental'),
    { size: [2, 3], value: 4000, frequency: 40, color: '#d03a2a', shape: 'tower', terrains: ['lava', 'rough', 'wasteland', 'dirt', 'subterranean'],
      description: 'Fire elementals guard efreet sultans who join the victor.' }),
  bank('black_tower', 'Black Tower', [
    lvl(30, [g('green_dragon', 1)], { resources: { gold: 2000 } }),
    lvl(30, [g('red_dragon', 1)], { resources: { gold: 2250 } }),
    lvl(30, [g('gold_dragon', 1)], { resources: { gold: 3250 } }),
    lvl(10, [g('black_dragon', 1)], { resources: { gold: 3750 } }),
  ], { size: [2, 3], value: 1500, frequency: 40, color: '#2a2a32', shape: 'tower',
    description: 'A single dragon guards a modest hoard.' }),
  bank('ivory_tower', 'Ivory Tower',
    simple('arch_mage', [35, 50, 65, 80], [3, 6, 9, 12].map((n) => ({ creatures: [{ creatureId: 'enchanter', count: n }] })), 5),
    { size: [2, 3], value: 7000, frequency: 40, color: '#f0ece0', shape: 'tower', terrains: ['snow', 'highlands', 'grass', 'dirt', 'sand'],
      description: 'Arch magi guard enchanters who join the victor.' }),
  bank('churchyard', 'Churchyard',
    simple('zombie', [90, 120, 150, 200], [[2500, 0], [3500, 0], [4500, 1], [6000, 1]].map(([gold, n]) => ({ resources: { gold }, artifacts: n ? [art('treasure', n)] : [] })), 5),
    { value: 1500, color: '#6a7a6a', shape: 'tomb', terrains: ['dirt', 'grass', 'swamp', 'rough', 'wasteland'],
      description: 'Zombies guard gold and sometimes a treasure artifact. An empty churchyard costs 1 morale.' },
    { emptyPenalty: [temp({ type: 'morale', value: -1 }, 'next_battle')] }),
  bank('experimental_shop', 'Experimental Shop',
    simple('steel_golem', [25, 50, 75, 100], [1, 2, 3, 4].map((n) => ({ creatures: [{ creatureId: 'giant', count: n }] })), 5),
    { value: 3500, color: '#9aa0b0', terrains: ['snow', 'highlands', 'grass', 'dirt', 'wasteland'],
      description: 'Steel golems guard giants who join the victor.' }),
  bank('wolf_raider_picket', 'Wolf Raider Picket',
    simple('wolf_raider', [50, 75, 100, 150], [[1500, 4], [2500, 6], [3500, 8], [5000, 12]].map(([gold, ore]) => ({ resources: { gold, ore, wood: ore } })), 5),
    { value: 1500, color: '#8a6a3e', terrains: ['rough', 'dirt', 'grass', 'sand', 'wasteland'],
      description: 'Wolf raiders guard gold, wood and ore.' }),
  bank('ruins', 'Ruins', [
    lvl(30, [g('skeleton_warrior', 20, 2), g('wight', 6), g('wraith', 6), g('power_lich', 3)], { resources: { gold: 1000 } }),
    lvl(30, [g('skeleton_warrior', 30, 2), g('wight', 8), g('wraith', 8), g('power_lich', 5)], { resources: { gold: 2000 } }),
    lvl(30, [g('skeleton_warrior', 40, 2), g('wight', 10), g('wraith', 10), g('power_lich', 6)], { resources: { gold: 3000 } }),
    lvl(10, [g('skeleton_warrior', 50, 2), g('wight', 15), g('wraith', 15), g('power_lich', 10)], { resources: { gold: 4000 }, artifacts: [art('minor')] }),
  ], { value: 1000, color: '#9a9080', shape: 'tomb',
    description: 'A mixed undead host guards a small treasury.' }),

  // --- new banks (not in the original)
  bank('bandit_hideout', 'Bandit Hideout',
    simple('rogue', [40, 60, 80, 120], [[1500, 0], [2500, 0], [3500, 1], [5000, 1]].map(([gold, n]) => ({ resources: { gold }, artifacts: n ? [art('treasure', n)] : [] })), 4),
    { value: 1200, color: '#5a5a4a', extra: true, shape: 'tent',
      description: 'Rogues guard their loot: gold and sometimes a treasure artifact.' }),
  bank('troll_cavern', 'Troll Cavern',
    simple('troll', [15, 22, 30, 45], [[3000, 5], [4500, 8], [6000, 10], [9000, 15]].map(([gold, n]) => ({ resources: { gold, wood: n, ore: n } })), 3),
    { value: 3000, color: '#4a6a4a', extra: true, terrains: ['swamp', 'subterranean', 'rough', 'dirt', 'highlands'],
      description: 'Regenerating trolls guard gold, wood and ore.' }),
  bank('sunken_vault', 'Sunken Vault', [
    lvl(30, [g('sea_serpent', 4, 2), g('nix', 10, 2)], { resources: { gold: 5000, gems: 4, crystal: 4 } }),
    lvl(30, [g('sea_serpent', 6, 2), g('nix', 14, 2)], { resources: { gold: 7000, gems: 6, crystal: 6 }, artifacts: [art('treasure')] }),
    lvl(30, [g('sea_serpent', 8, 2), g('nix', 18, 2)], { resources: { gold: 9000, gems: 8, crystal: 8 }, artifacts: [art('minor')] }),
    lvl(10, [g('sea_serpent', 12, 2), g('nix', 25, 2)], { resources: { gold: 12000, gems: 12, crystal: 12 }, artifacts: [art('major')] }),
  ], { terrains: WATER, value: 6000, frequency: 15, color: '#1c6a8a', extra: true, shape: 'temple',
    description: 'Sea serpents and nixes guard a flooded treasury.' }),
  bank('elemental_forge', 'Elemental Forge', [
    lvl(30, [g('magma_elemental', 20, 2), g('energy_elemental', 10, 2)], { artifacts: [art('minor')], resources: { ore: 10, sulfur: 5 } }),
    lvl(30, [g('magma_elemental', 30, 2), g('energy_elemental', 15, 2)], { artifacts: [art('minor', 2)], resources: { ore: 15, sulfur: 8 } }),
    lvl(30, [g('magma_elemental', 40, 2), g('energy_elemental', 20, 2)], { artifacts: [art('major')], resources: { ore: 20, sulfur: 10 } }),
    lvl(10, [g('magma_elemental', 60, 2), g('energy_elemental', 30, 2)], { artifacts: [art('major'), art('minor')], resources: { ore: 30, sulfur: 15 } }),
  ], { value: 7000, frequency: 40, color: '#e8601c', extra: true, terrains: ['lava', 'subterranean', 'rough', 'wasteland', 'highlands'],
    description: 'Elementals guard artifacts still warm from the forge.' }),
  bank('haunted_library', 'Haunted Library', [
    lvl(30, [g('wraith', 30, 3), g('lich', 6, 2)], { spell: { level: 3 }, resources: { gold: 1000 } }),
    lvl(30, [g('wraith', 45, 3), g('lich', 10, 2)], { spell: { level: 4 }, resources: { gold: 1500 } }),
    lvl(30, [g('wraith', 60, 3), g('power_lich', 12, 2)], { spell: { level: 4 }, artifacts: [art('minor')] }),
    lvl(10, [g('wraith', 90, 3), g('power_lich', 20, 2)], { spell: { level: 5 }, artifacts: [art('major')] }),
  ], { value: 4500, frequency: 40, color: '#4a3a6a', extra: true,
    description: 'Ghostly librarians guard a forgotten spell (hero must be able to learn it).' }),
  bank('crystal_dragon_roost', 'Crystal Dragon Roost', [
    lvl(30, [g('crystal_dragon', 1)], { resources: { crystal: 15, gems: 10, gold: 5000 } }),
    lvl(30, [g('crystal_dragon', 2)], { resources: { crystal: 25, gems: 15, gold: 10000 }, artifacts: [art('major')] }),
    lvl(30, [g('crystal_dragon', 3)], { resources: { crystal: 35, gems: 20, gold: 15000 }, artifacts: [art('relic')] }),
    lvl(10, [g('crystal_dragon', 5)], { resources: { crystal: 50, gems: 30, gold: 25000 }, artifacts: [art('relic', 2)] }),
  ], { size: [3, 3], value: 12000, frequency: 20, limit: 1, color: '#d03a8a', extra: true, terrains: ['snow', 'highlands', 'subterranean', 'rough'],
    description: 'Crystal dragons nest on a hoard of crystal, gems and relics.' }),
];

// ---------------------------------------------------------------------------------------------
// 4. permanent boosters (per hero)

const per = (id, name, effect, o) => def(id, name, 'visit_per_hero', effect, o);
const stat = (s, value = 1) => ({ stat: s, value });

const BOOSTERS = [
  per('mercenary_camp', 'Mercenary Camp', { type: 'primary_boost', options: [stat('attack')] },
    { size: [2, 1], value: 1500, frequency: 50, shape: 'tent', color: '#d03a2a', description: '+1 Attack, once per hero.' }),
  per('marletto_tower', 'Marletto Tower', { type: 'primary_boost', options: [stat('defense')] },
    { size: [1, 2], value: 1500, frequency: 50, shape: 'tower', color: '#7a7a82', description: '+1 Defense, once per hero.' }),
  per('star_axis', 'Star Axis', { type: 'primary_boost', options: [stat('power')] },
    { value: 1500, frequency: 50, shape: 'statue', color: '#e8d83a', description: '+1 Spell Power, once per hero.' }),
  per('garden_of_revelation', 'Garden of Revelation', { type: 'primary_boost', options: [stat('knowledge')] },
    { size: [2, 1], value: 1500, frequency: 50, shape: 'garden', color: '#5ac0e0', description: '+1 Knowledge, once per hero.' }),
  per('arena', 'Arena', { type: 'primary_boost', options: [stat('attack', 2), stat('defense', 2)] },
    { size: [3, 2], value: 3000, frequency: 50, shape: 'building', color: '#c8a070', description: '+2 Attack or +2 Defense (hero chooses), once per hero.' }),
  per('colosseum_of_the_magi', 'Colosseum of the Magi', { type: 'primary_boost', options: [stat('power', 2), stat('knowledge', 2)] },
    { size: [3, 2], value: 3000, frequency: 50, shape: 'building', color: '#8a6ad8', description: '+2 Spell Power or +2 Knowledge (hero chooses), once per hero.' }),
  per('school_of_magic', 'School of Magic', { type: 'primary_boost', options: [stat('power'), stat('knowledge')], cost: { gold: 1000 } },
    { size: [2, 2], value: 1000, frequency: 50, shape: 'building', color: '#5a6ae8', description: 'For 1000 gold: +1 Spell Power or +1 Knowledge, once per hero.' }),
  per('school_of_war', 'School of War', { type: 'primary_boost', options: [stat('attack'), stat('defense')], cost: { gold: 1000 } },
    { size: [2, 2], value: 1000, frequency: 50, shape: 'building', color: '#b04a3a', description: 'For 1000 gold: +1 Attack or +1 Defense, once per hero.' }),
  per('library_of_enlightenment', 'Library of Enlightenment',
    { type: 'library', value: 2, minLevel: 10, diplomacyLevelReduction: [0, 2, 4, 6] },
    { size: [2, 2], value: 12000, frequency: 20, limit: 1, shape: 'building', color: '#e8dcb0',
      description: '+2 to all four primary skills for heroes of level 10+ (8/6/4 with Basic/Advanced/Expert Diplomacy).' }),
  per('learning_stone', 'Learning Stone', { type: 'exp_boost', exp: 1000 },
    { value: 1500, frequency: 200, shape: 'stone', color: '#9a9aa8', description: '+1000 experience, once per hero.' }),
  per('gazebo', 'Gazebo', { type: 'exp_boost', exp: 2000, cost: { gold: 1000 } },
    { value: 1000, frequency: 50, shape: 'hut', color: '#d8c8a0', description: 'For 1000 gold: +2000 experience, once per hero.' }),
  per('tree_of_knowledge', 'Tree of Knowledge',
    { type: 'level_up', costTable: [{ chance: 34, cost: {} }, { chance: 33, cost: { gold: 2000 } }, { chance: 33, cost: { gems: 10 } }] },
    { size: [1, 2], value: 2500, frequency: 50, shape: 'tree', color: '#3cae4a', terrains: SURFACE,
      description: 'Raises the hero by one level: free, for 2000 gold or for 10 gems (fixed per tree).' }),
  per('witch_hut', 'Witch Hut',
    { type: 'learn_skill', level: 1, pick: 'random', exclude: ['necromancy', 'leadership'], choices: 1, cost: null },
    { value: 1500, frequency: 80, shape: 'hut', color: '#6a4a8a', terrains: ['swamp', 'grass', 'dirt', 'rough', 'highlands', 'snow', 'wasteland'],
      description: 'Teaches Basic level of a random secondary skill fixed per hut (never Necromancy or Leadership).' }),
  per('hermits_shack', "Hermit's Shack",
    { type: 'learn_skill', mode: 'upgrade_existing', choices: 1, cost: null },
    { value: 1500, frequency: 30, shape: 'hut', color: '#7a6a4a',
      description: 'Raises one of the hero\'s non-Expert secondary skills (chosen at random) by one level.' }),
  def('scholar', 'Scholar', 'visit_once',
    { type: 'scholar', table: [{ chance: 34, kind: 'primary', value: 1 }, { chance: 33, kind: 'skill', level: 1 }, { chance: 33, kind: 'spell', level: [1, 5] }] },
    { revisit: 'removed', removable: true, interact: 'adjacent', value: 1500, frequency: 30, shape: 'statue', color: '#c8b080',
      description: 'Teaches +1 to a primary skill, a secondary skill or a spell, then leaves.' }),
  def('university', 'University', 'special',
    { type: 'university', skills: 4, level: 1, cost: { gold: 2000 }, exclude: ['necromancy'] },
    { size: [3, 2], value: 2500, frequency: 20, limit: 1, shape: 'building', color: '#5a6ae8',
      description: 'Sells Basic level of four random secondary skills (fixed per university) for 2000 gold each.' }),
  ...[['shrine_of_magic_incantation', 'Shrine of Magic Incantation', 1, 500, 100], ['shrine_of_magic_gesture', 'Shrine of Magic Gesture', 2, 2000, 100],
    ['shrine_of_magic_thought', 'Shrine of Magic Thought', 3, 3000, 100], ['shrine_of_magic_mystery', 'Shrine of Magic Mystery', 4, 5000, 30]].map(([id, name, level, value, frequency]) =>
    per(id, name, { type: 'learn_spell', level, school: null },
      { value, frequency, shape: 'shrine', color: ['#9ac0e0', '#6a9ae0', '#4a6ae0', '#8a3ae0'][level - 1],
        description: `Teaches a random level ${level} spell (fixed per shrine). Needs a spell book${level >= 3 ? ` and ${['', '', '', 'Basic', 'Advanced'][level]} Wisdom` : ''}.` })),
  def('altar_of_sacrifice', 'Altar of Sacrifice', 'special',
    { type: 'altar_of_sacrifice', artifactAlignments: ['good', 'neutral'], creatureAlignments: ['evil', 'neutral'],
      creatureExp: { per: 'aiValue', divisor: 40, multiplier: 5 }, artifactExp: { per: 'cost', multiplier: 1 } },
    { size: [2, 1], value: 100, frequency: 20, shape: 'altar', color: '#8a2a2a',
      description: 'Good heroes sacrifice artifacts, evil heroes sacrifice creatures, for experience.' }),
];

// ---------------------------------------------------------------------------------------------
// 5. temporary buffs, services, information

const B = { morale: (v) => ({ type: 'morale', value: v }), luck: (v) => ({ type: 'luck', value: v }) };
const buff = (id, name, fx, o) => def(id, name, 'visit_per_hero', { type: 'temp_bonus', until: 'next_battle', ...fx },
  { revisit: 'per_battle', value: 100, frequency: 100, ...o });

const BUFFS = [
  buff('idol_of_fortune', 'Idol of Fortune',
    { bonuses: [], variants: [
      { days: [1, 3, 5], bonuses: [B.luck(1)] },
      { days: [2, 4, 6], bonuses: [B.morale(1)] },
      { days: [7], bonuses: [B.luck(1), B.morale(1)] },
    ] },
    { shape: 'statue', color: '#e8c040', description: '+1 luck on odd days, +1 morale on even days, both on day 7; until the next battle.' }),
  buff('fountain_of_fortune', 'Fountain of Fortune',
    { bonuses: [], random: { bonus: 'luck', min: -1, max: 3 } },
    { shape: 'fountain', color: '#5ac0e0', description: 'Random luck from -1 to +3 until the next battle.' }),
  buff('fountain_of_youth', 'Fountain of Youth',
    { bonuses: [B.morale(1)], movement: 400 },
    { size: [2, 1], shape: 'fountain', color: '#9ae0f0', description: '+1 morale until the next battle and +400 movement points today.' }),
  buff('faerie_ring', 'Faerie Ring', { bonuses: [B.luck(1)] },
    { size: [2, 1], shape: 'ring', color: '#d86ad8', terrains: ['grass', 'dirt', 'swamp', 'highlands', 'subterranean'], description: '+1 luck until the next battle.' }),
  buff('swan_pond', 'Swan Pond', { bonuses: [B.luck(2)], endMovement: true },
    { size: [2, 1], shape: 'pond', color: '#bfe0f4', terrains: ['grass', 'swamp', 'highlands', 'dirt'], description: '+2 luck until the next battle, but the hero loses all remaining movement.' }),
  buff('rally_flag', 'Rally Flag', { bonuses: [B.morale(1), B.luck(1)], movement: 400 },
    { shape: 'flag', color: '#d03a2a', description: '+1 morale and +1 luck until the next battle, +400 movement points today.' }),
  buff('buoy', 'Buoy', { bonuses: [B.morale(1)] },
    { terrains: WATER, shape: 'buoy', color: '#e8762a', description: '+1 morale until the next battle.' }),
  buff('temple', 'Temple',
    { bonuses: [], variants: [{ days: [1, 2, 3, 4, 5, 6], bonuses: [B.morale(1)] }, { days: [7], bonuses: [B.morale(2)] }] },
    { size: [2, 2], shape: 'temple', color: '#f4ecc0', description: '+1 morale until the next battle (+2 on day 7).' }),
  buff('mermaids', 'Mermaids', { bonuses: [B.luck(1)] },
    { terrains: WATER, shape: 'statue', color: '#3ad0a0', description: '+1 luck until the next battle.' }),
  buff('oasis', 'Oasis', { bonuses: [B.morale(1)], movement: 800 },
    { size: [2, 1], terrains: ['sand', 'wasteland'], shape: 'pond', color: '#3cae8a', description: '+1 morale until the next battle and +800 movement points today.' }),
  buff('watering_hole', 'Watering Hole', { bonuses: [B.morale(1)], movement: 400 },
    { size: [2, 1], terrains: ['rough', 'dirt', 'grass', 'wasteland', 'sand'], value: 500, shape: 'pond', color: '#4a8ad0', description: '+1 morale until the next battle and +400 movement points today.' }),
  buff('mineral_spring', 'Mineral Spring', { bonuses: [B.luck(1)], movement: 600 },
    { size: [2, 1], value: 500, frequency: 40, shape: 'fountain', color: '#8ad0c0', description: '+1 luck until the next battle and +600 movement points today.' }),
  def('stables', 'Stables', 'visit_per_hero',
    { type: 'temp_bonus', until: 'end_of_week', bonuses: [{ type: 'movement_land', value: 400 }], movement: 400,
      upgrade: [{ from: 'cavalier', to: 'champion', free: true }] },
    { revisit: 'per_hero_weekly', size: [2, 2], value: 200, frequency: 40, shape: 'building', color: '#8a5a2a', terrains: SURFACE,
      description: '+400 land movement each day until the end of the week; Cavaliers are upgraded to Champions for free.' }),

  def('magic_well', 'Magic Well', 'visit_per_hero', { type: 'mana_restore', mode: 'full' },
    { revisit: 'per_hero_daily', value: 250, frequency: 100, shape: 'well', color: '#5a6ae8', description: 'Refills spell points to the maximum; once per day per hero.' }),
  def('magic_spring', 'Magic Spring', 'visit_weekly', { type: 'mana_restore', mode: 'double' },
    { size: [2, 1], value: 500, frequency: 50, shape: 'fountain', color: '#8a6ae8', description: 'Sets spell points to twice the maximum; the spring recharges weekly.' }),

  def('trading_post', 'Trading Post', 'special', { type: 'market', modes: ['resource_resource', 'resource_player'], marketCount: 5 },
    { size: [3, 2], value: 3000, frequency: 100, limit: 1, shape: 'stall', color: '#c8a040', description: 'Trade resources at the rate of five marketplaces.' }),
  def('freelancers_guild', "Freelancer's Guild", 'special', { type: 'market', modes: ['creature_resource'], marketCount: 5 },
    { size: [3, 2], value: 100, frequency: 100, limit: 1, shape: 'stall', color: '#a07050', description: 'Sell creatures from the hero\'s army for resources.' }),
  def('black_market', 'Black Market', 'special', { type: 'black_market', slots: 7, classes: ['treasure', 'minor', 'major', 'relic'], marketCount: 9, restock: 'monthly' },
    { size: [3, 2], value: 8000, frequency: 100, limit: 1, shape: 'stall', color: '#3a2a3a', description: 'Sells seven random artifacts for gold; restocked on day 1 of each month.' }),
  def('refugee_camp', 'Refugee Camp', 'special', { type: 'refugee_camp', maxTier: 7, costMultiplier: 1, stock: 'growth' },
    { size: [3, 2], value: 5000, frequency: 100, limit: 1, shape: 'tent', color: '#8a7a5a', description: 'Each week one random creature type can be hired here (one week of growth).' }),
  def('tavern', 'Tavern', 'special', { type: 'tavern' },
    { size: [2, 2], value: 100, frequency: 100, limit: 1, shape: 'building', color: '#a0703a', description: 'Hire heroes for 2500 gold and hear rumours.' }),
  def('war_machine_factory', 'War Machine Factory', 'special',
    { type: 'war_machine_factory', items: [{ artifactId: 'ballista', cost: { gold: 2500 } }, { artifactId: 'ammo_cart', cost: { gold: 1000 } }, { artifactId: 'first_aid_tent', cost: { gold: 750 } }] },
    { size: [3, 2], value: 1500, frequency: 20, limit: 1, shape: 'building', color: '#7a6a5a', description: 'Sells Ballista (2500), Ammo Cart (1000) and First Aid Tent (750).' }),
  def('den_of_thieves', 'Den of Thieves', 'special', { type: 'thieves_guild', level: 'full' },
    { size: [2, 2], value: 100, frequency: 100, limit: 1, shape: 'hut', color: '#4a4a3a', description: 'Reveals how all players compare.' }),
  def('sanctuary', 'Sanctuary', 'special', { type: 'sanctuary' },
    { size: [2, 2], value: 100, frequency: 100, limit: 1, shape: 'temple', color: '#f0f0e0', description: 'A hero resting here cannot be attacked.' }),
  def('prison', 'Prison', 'special', { type: 'prison', valueByHeroExp: [[0, 2500], [5000, 5000], [15000, 10000], [90000, 20000], [500000, 30000]] },
    { revisit: 'removed', removable: true, value: 2500, frequency: 30, limit: 1, shape: 'cage', color: '#6a6a72', description: 'Holds a captive hero who joins whoever frees him.' }),
  def('hill_fort', 'Hill Fort', 'special', { type: 'hill_fort', costPercentByTier: { 1: 0, 2: 25, 3: 50, 4: 75, 5: 100, 6: 100, 7: 100 } },
    { size: [3, 2], value: 7000, frequency: 20, limit: 1, shape: 'fort', color: '#8a7a6a', description: 'Upgrades creatures: free for tier 1, 25/50/75% for tiers 2-4, full price above.' }),
  def('lighthouse', 'Lighthouse', 'special', { type: 'lighthouse', bonuses: [{ type: 'movement_sea', value: 500 }] },
    { size: [1, 2], value: 500, frequency: 0, shape: 'lighthouse', color: '#f0e8d0', coastal: true, description: 'Flaggable. +500 sea movement for all heroes of the owner (cumulative per lighthouse).' }),
  def('shipyard', 'Shipyard', 'special', { type: 'shipyard', cost: { gold: 1000, wood: 10 } },
    { size: [3, 2], value: 0, frequency: 0, shape: 'building', color: '#6a5a4a', coastal: true, description: 'Flaggable. Builds a boat for 1000 gold and 10 wood.' }),

  def('redwood_observatory', 'Redwood Observatory', 'visit_per_player', { type: 'reveal_map', mode: 'radius', radius: 20 },
    { size: [1, 2], value: 750, frequency: 100, shape: 'observatory', color: '#8a3a2a', terrains: SURFACE.filter((t) => t !== 'lava'), description: 'Reveals the map within 20 tiles.' }),
  def('pillar_of_fire', 'Pillar of Fire', 'visit_per_player', { type: 'reveal_map', mode: 'radius', radius: 20 },
    { size: [1, 2], value: 750, frequency: 100, shape: 'pillar', color: '#e8601c', terrains: ['lava', 'subterranean'], description: 'Reveals the map within 20 tiles.' }),
  def('observation_tower', 'Observation Tower', 'visit_per_player', { type: 'reveal_map', mode: 'radius', radius: 20 },
    { size: [1, 2], value: 750, frequency: 50, shape: 'observatory', color: '#7a7a82', description: 'Reveals the map within 20 tiles.' }),
  def('hut_of_the_magi', 'Hut of the Magi', 'special', { type: 'reveal_map', mode: 'objects', objectDefId: 'eye_of_the_magi', radius: 10 },
    { value: 100, frequency: 20, shape: 'hut', color: '#8a6ad8', description: 'Shows the surroundings (10 tiles) of every Eye of the Magi.' }),
  def('eye_of_the_magi', 'Eye of the Magi', 'decor', { type: 'none' },
    { value: 100, frequency: 20, shape: 'statue', color: '#8a6ad8', description: 'A watching eye linked to every Hut of the Magi.' }),
  ...[['cartographer_sea', 'Cartographer (Sea)', 'water', SURFACE], ['cartographer_land', 'Cartographer (Land)', 'surface', SURFACE], ['cartographer_underground', 'Cartographer (Underground)', 'underground', ['subterranean']]].map(([id, name, kind, terrains]) =>
    def(id, name, 'visit_per_player', { type: 'reveal_map', mode: 'kind', kind, cost: { gold: 1000 } },
      { size: [2, 2], value: 10000, frequency: 20, limit: 1, shape: 'stall', color: '#c8b080', terrains, description: `For 1000 gold reveals all ${kind} tiles of the map.` })),
  def('cover_of_darkness', 'Cover of Darkness', 'special', { type: 'hide_map', radius: 20 },
    { size: [1, 2], value: 500, frequency: 30, shape: 'pillar', color: '#1a1a22', description: 'Shrouds everything within 20 tiles for all other players.' }),
  def('obelisk', 'Obelisk', 'visit_per_player', { type: 'obelisk', puzzlePieces: 48 },
    { size: [1, 2], value: 350, frequency: 200, shape: 'obelisk', color: '#b0a890', description: 'Uncovers part of the puzzle map leading to the Grail.' }),
  def('sign', 'Sign', 'special', { type: 'message' },
    { blocking: false, value: 0, frequency: 0, shape: 'sign', color: '#8a6a3e', description: 'Shows a message.' }),
  def('ocean_bottle', 'Ocean Bottle', 'treasure', { type: 'message' },
    { terrains: WATER, value: 0, frequency: 0, shape: 'bottle', color: '#9ae0c0', description: 'A message in a bottle; vanishes once read.' }),
];

// ---------------------------------------------------------------------------------------------
// 6. guards, quests, transport

const GUARDS_TRANSPORT = [
  def('quest_guard', 'Quest Guard', 'guard', { type: 'quest_guard', questTypes: QUEST_TYPES },
    { interact: 'adjacent', value: 0, frequency: 0, shape: 'gate', color: '#8a7a6a', description: 'Steps aside (and vanishes) once its quest is completed.' }),
  ...KEY_COLORS.flatMap((c) => {
    const nice = c.replace('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    return [
      def(`border_guard_${c}`, `Border Guard (${nice})`, 'guard', { type: 'border_guard', color: c, permanent: false, confirm: true },
        { interact: 'adjacent', value: 0, frequency: 0, shape: 'gate', color: KEY_HEX[c], description: `Lets through (and vanishes for) a player holding the ${nice} key.` }),
      def(`border_gate_${c}`, `Border Gate (${nice})`, 'guard', { type: 'border_guard', color: c, permanent: true, confirm: false },
        { value: 0, frequency: 0, shape: 'gate', color: KEY_HEX[c], description: `Permanent gate: only players holding the ${nice} key may walk through.` }),
      def(`keymasters_tent_${c}`, `Keymaster's Tent (${nice})`, 'visit_per_player', { type: 'keymaster_tent', color: c },
        { value: 0, frequency: 0, shape: 'tent', color: KEY_HEX[c], description: `Gives the visiting player the ${nice} key.` }),
    ];
  }),
  def('seers_hut', "Seer's Hut", 'special', { type: 'seer_hut', questTypes: QUEST_TYPES, rewardTypes: QUEST_REWARD_TYPES },
    { value: 2000, frequency: 50, shape: 'hut', color: '#6a8a5a', description: 'The seer asks a favour and rewards whoever completes it.' }),
  def('garrison', 'Garrison', 'guard', { type: 'garrison', antiMagic: false, removableUnits: true },
    { size: [3, 1], value: 0, frequency: 0, shape: 'gate', color: '#7a6a5a', description: 'A fortified gate. Its owner may station troops; enemies must defeat them to pass.' }),
  def('anti_magic_garrison', 'Anti-Magic Garrison', 'guard', { type: 'garrison', antiMagic: true, removableUnits: true },
    { size: [3, 1], value: 0, frequency: 0, shape: 'gate', color: '#5a6ae8', description: 'A garrison where no spells can be cast in battle.' }),

  def('subterranean_gate', 'Subterranean Gate', 'transport', { type: 'teleport', kind: 'subterranean_gate', pairing: 'nearest_other_level', twoWay: true },
    { size: [3, 2], value: 0, frequency: 0, shape: 'gate', color: '#5a4a52', description: 'Passage between the surface and the underground.' }),
  ...MONOLITH_COLORS.flatMap((c) => [
    def(`monolith_one_way_entrance_${c}`, `Monolith One-Way Entrance (${c})`, 'transport', { type: 'teleport', kind: 'one_way_entrance', channel: c, exit: `monolith_one_way_exit_${c}`, twoWay: false },
      { value: 0, frequency: 0, shape: 'portal', color: MONO_HEX[c], description: `Sends the hero to a random ${c} one-way exit.` }),
    def(`monolith_one_way_exit_${c}`, `Monolith One-Way Exit (${c})`, 'transport', { type: 'teleport', kind: 'one_way_exit', channel: c, exit: null, twoWay: false },
      { visitable: false, interact: 'none', revisit: 'none', value: 0, frequency: 0, shape: 'portal', color: MONO_HEX[c], description: `Arrival point of ${c} one-way entrances. Cannot be entered.` }),
  ]),
  ...TWO_WAY_COLORS.map((c) =>
    def(`monolith_two_way_${c}`, `Monolith Two-Way (${c})`, 'transport', { type: 'teleport', kind: 'two_way', channel: c, exit: `monolith_two_way_${c}`, twoWay: true },
      { value: 0, frequency: 0, shape: 'portal', color: MONO_HEX[c], description: `Sends the hero to a random other ${c} two-way monolith.` })),
  def('whirlpool', 'Whirlpool', 'transport',
    { type: 'teleport', kind: 'whirlpool', channel: 'whirlpool', exit: 'whirlpool', twoWay: true,
      loss: { stack: 'weakest', percent: 50, min: 1, exemptSingleCreature: true, protectedBy: { artifactIds: ['sea_captains_hat', 'admirals_hat'] } } },
    { terrains: WATER, value: 0, frequency: 0, shape: 'whirlpool', color: '#1c4478', description: 'Drags a ship to another whirlpool, drowning half of the weakest stack.' }),
  def('boat', 'Boat', 'transport', { type: 'boat', boardingEndsMovement: true, landingEndsMovement: true, noPenaltyWith: { artifactIds: ['admirals_hat'] } },
    { terrains: WATER, value: 0, frequency: 0, shape: 'boat', color: '#8a5a2a', description: 'Board to sail. Boarding and landing each use up all remaining movement.' }),
];

// ---------------------------------------------------------------------------------------------
// 7. external creature dwellings

/**
 * Compact dwelling table: [faction, tier, id, name, creatureIds, extra?].
 * tier 0 = multi-creature / off-lineup dwelling. Faction 'neutral' for neutral creatures.
 */
export const DWELLING_TABLE = [
  ['castle', 1, 'guardhouse', 'Guardhouse', ['pikeman']],
  ['castle', 2, 'archers_tower', "Archers' Tower", ['archer']],
  ['castle', 3, 'griffin_tower', 'Griffin Tower', ['griffin']],
  ['castle', 4, 'barracks', 'Barracks', ['swordsman']],
  ['castle', 5, 'monastery', 'Monastery', ['monk']],
  ['castle', 6, 'training_grounds', 'Training Grounds', ['cavalier']],
  ['castle', 7, 'portal_of_glory', 'Portal of Glory', ['angel']],
  ['rampart', 1, 'centaur_stables', 'Centaur Stables', ['centaur']],
  ['rampart', 2, 'dwarf_cottage', 'Dwarf Cottage', ['dwarf']],
  ['rampart', 3, 'homestead', 'Homestead', ['wood_elf']],
  ['rampart', 4, 'enchanted_spring', 'Enchanted Spring', ['pegasus']],
  ['rampart', 5, 'dendroid_arches', 'Dendroid Arches', ['dendroid_guard']],
  ['rampart', 6, 'unicorn_glade', 'Unicorn Glade', ['unicorn']],
  ['rampart', 7, 'dragon_cliffs', 'Dragon Cliffs', ['green_dragon']],
  ['tower', 1, 'workshop', 'Workshop', ['gremlin']],
  ['tower', 2, 'parapet', 'Parapet', ['stone_gargoyle']],
  ['tower', 3, 'golem_factory', 'Golem Factory', ['stone_golem', 'iron_golem', 'gold_golem', 'diamond_golem']],
  ['tower', 4, 'mage_tower', 'Mage Tower', ['mage']],
  ['tower', 5, 'altar_of_wishes', 'Altar of Wishes', ['genie']],
  ['tower', 6, 'golden_pavilion', 'Golden Pavilion', ['naga']],
  ['tower', 7, 'cloud_temple', 'Cloud Temple', ['giant']],
  ['inferno', 1, 'imp_crucible', 'Imp Crucible', ['imp']],
  ['inferno', 2, 'hall_of_sins', 'Hall of Sins', ['gog']],
  ['inferno', 3, 'kennels', 'Kennels', ['hell_hound']],
  ['inferno', 4, 'demon_gate', 'Demon Gate', ['demon']],
  ['inferno', 5, 'hell_hole', 'Hell Hole', ['pit_fiend']],
  ['inferno', 6, 'fire_lake', 'Fire Lake', ['efreet']],
  ['inferno', 7, 'forsaken_palace', 'Forsaken Palace', ['devil']],
  ['necropolis', 1, 'cursed_temple', 'Cursed Temple', ['skeleton']],
  ['necropolis', 2, 'graveyard', 'Graveyard', ['walking_dead']],
  ['necropolis', 3, 'tomb_of_souls', 'Tomb of Souls', ['wight']],
  ['necropolis', 4, 'estate', 'Estate', ['vampire']],
  ['necropolis', 5, 'mausoleum', 'Mausoleum', ['lich']],
  ['necropolis', 6, 'hall_of_darkness', 'Hall of Darkness', ['black_knight']],
  ['necropolis', 7, 'dragon_vault', 'Dragon Vault', ['bone_dragon']],
  ['dungeon', 1, 'warren', 'Warren', ['troglodyte']],
  ['dungeon', 2, 'harpy_loft', 'Harpy Loft', ['harpy']],
  ['dungeon', 3, 'pillar_of_eyes', 'Pillar of Eyes', ['beholder']],
  ['dungeon', 4, 'chapel_of_stilled_voices', 'Chapel of Stilled Voices', ['medusa']],
  ['dungeon', 5, 'labyrinth', 'Labyrinth', ['minotaur']],
  ['dungeon', 6, 'manticore_lair', 'Manticore Lair', ['manticore']],
  ['dungeon', 7, 'dragon_cave', 'Dragon Cave', ['red_dragon']],
  ['stronghold', 1, 'goblin_barracks', 'Goblin Barracks', ['goblin']],
  ['stronghold', 2, 'wolf_pen', 'Wolf Pen', ['wolf_rider']],
  ['stronghold', 3, 'orc_tower', 'Orc Tower', ['orc']],
  ['stronghold', 4, 'ogre_fort', 'Ogre Fort', ['ogre']],
  ['stronghold', 5, 'cliff_nest', 'Cliff Nest', ['roc']],
  ['stronghold', 6, 'cyclops_cave', 'Cyclops Cave', ['cyclops']],
  ['stronghold', 7, 'behemoth_crag', 'Behemoth Crag', ['behemoth']],
  ['fortress', 1, 'gnoll_hut', 'Gnoll Hut', ['gnoll']],
  ['fortress', 2, 'lizard_den', 'Lizard Den', ['lizardman']],
  ['fortress', 3, 'serpent_fly_hive', 'Serpent Fly Hive', ['serpent_fly']],
  ['fortress', 4, 'basilisk_pit', 'Basilisk Pit', ['basilisk']],
  ['fortress', 5, 'gorgon_lair', 'Gorgon Lair', ['gorgon']],
  ['fortress', 6, 'wyvern_nest', 'Wyvern Nest', ['wyvern']],
  ['fortress', 7, 'hydra_pond', 'Hydra Pond', ['hydra']],
  ['conflux', 1, 'magic_lantern', 'Magic Lantern', ['pixie']],
  ['conflux', 2, 'altar_of_air', 'Altar of Air', ['air_elemental']],
  ['conflux', 3, 'altar_of_water', 'Altar of Water', ['water_elemental']],
  ['conflux', 4, 'altar_of_fire', 'Altar of Fire', ['fire_elemental']],
  ['conflux', 5, 'altar_of_earth', 'Altar of Earth', ['earth_elemental']],
  ['conflux', 6, 'altar_of_thought', 'Altar of Thought', ['psychic_elemental']],
  ['conflux', 7, 'pyre', 'Pyre', ['firebird']],
  ['conflux', 0, 'elemental_conflux', 'Elemental Conflux', ['air_elemental', 'water_elemental', 'fire_elemental', 'earth_elemental']],
  ['cove', 1, 'nymph_waterfall', 'Nymph Waterfall', ['nymph']],
  ['cove', 2, 'shack', 'Shack', ['crew_mate']],
  ['cove', 3, 'frigate', 'Frigate', ['pirate']],
  ['cove', 4, 'nest', 'Nest', ['stormbird']],
  ['cove', 5, 'tower_of_the_seas', 'Tower of the Seas', ['sea_witch']],
  ['cove', 6, 'nix_fort', 'Nix Fort', ['nix']],
  ['cove', 7, 'maelstrom', 'Maelstrom', ['sea_serpent']],
  ['factory', 1, 'thatched_hut', 'Thatched Hut', ['halfling']],
  ['factory', 2, 'foundry', 'Foundry', ['mechanic']],
  ['factory', 3, 'ranch', 'Ranch', ['armadillo']],
  ['factory', 4, 'manufactory', 'Manufactory', ['automaton']],
  ['factory', 5, 'wormhole', 'Wormhole', ['sandworm']],
  ['factory', 6, 'saloon', 'Saloon', ['gunslinger']],
  ['factory', 7, 'serpentarium', 'Serpentarium', ['couatl']],
  ['factory', 7, 'gantry', 'Gantry', ['dreadnought']],
  ['neutral', 1, 'hovel', 'Hovel', ['peasant']],
  ['neutral', 2, 'boar_glen', 'Boar Glen', ['boar']],
  ['neutral', 2, 'rogue_cavern', 'Rogue Cavern', ['rogue']],
  ['neutral', 2, 'alehouse', 'Alehouse', ['leprechaun']],
  ['neutral', 3, 'nomad_tent', 'Nomad Tent', ['nomad']],
  ['neutral', 3, 'tomb_of_curses', 'Tomb of Curses', ['mummy']],
  ['neutral', 4, 'vineyard', 'Vineyard', ['satyr']],
  ['neutral', 4, 'treetop_tower', 'Treetop Tower', ['sharpshooter']],
  ['neutral', 5, 'troll_bridge', 'Troll Bridge', ['troll']],
  ['neutral', 5, 'ziggurat', 'Ziggurat', ['fangarm']],
  ['neutral', 6, 'enchanters_hollow', "Enchanter's Hollow", ['enchanter']],
  ['neutral', 0, 'ancient_lamp', 'Ancient Lamp', ['master_genie']],
  ['neutral', 8, 'magic_forest', 'Magic Forest', ['faerie_dragon']],
  ['neutral', 8, 'sulfurous_lair', 'Sulfurous Lair', ['rust_dragon']],
  ['neutral', 8, 'crystal_cave', 'Crystal Cave', ['crystal_dragon']],
  ['neutral', 8, 'frozen_cliffs', 'Frozen Cliffs', ['azure_dragon']],
  // dwellings of the new neutral creatures (extra: true)
  ['neutral', 1, 'wisp_hollow', 'Wisp Hollow', ['will_o_wisp'], true],
  ['neutral', 2, 'wolf_den', 'Wolf Den', ['dire_wolf'], true],
  ['neutral', 3, 'bog_hut', 'Bog Hut', ['bog_witch'], true],
  ['neutral', 4, 'spider_nest', 'Spider Nest', ['giant_spider'], true],
  ['neutral', 4, 'shadow_guild', 'Shadow Guild', ['shadow_assassin'], true],
  ['neutral', 4, 'steelworks', 'Steelworks', ['steel_golem'], true],
  ['neutral', 5, 'clockwork_hall', 'Clockwork Hall', ['clockwork_knight'], true],
  ['neutral', 6, 'frost_hall', 'Frost Hall', ['frost_giant'], true],
  ['neutral', 6, 'ossuary', 'Ossuary', ['bone_colossus'], true],
  ['neutral', 7, 'storm_peak', 'Storm Peak', ['storm_drake'], true],
];

/** RMG value of a dwelling by creature tier (index = tier; 0 = multi dwelling). */
export const DWELLING_VALUE_BY_TIER = [6000, 750, 1000, 1500, 2000, 3000, 5000, 9000, 20000];
const DWELLING_FREQ_BY_TIER = [10, 60, 60, 50, 50, 40, 30, 20, 5];
const FACTION_TERRAIN = {
  castle: 'grass', rampart: 'grass', tower: 'snow', inferno: 'lava', necropolis: 'dirt', dungeon: 'subterranean',
  stronghold: 'rough', fortress: 'swamp', conflux: 'highlands', cove: 'swamp', factory: 'wasteland',
};
const FACTION_HEX = {
  castle: '#d8d0b0', rampart: '#3c8a3a', tower: '#9ac0e0', inferno: '#d03a2a', necropolis: '#6a6a72', dungeon: '#6a3a8a',
  stronghold: '#b0733c', fortress: '#4a7a5a', conflux: '#d86ad8', cove: '#2a8ab0', factory: '#c8862a', neutral: '#a09a8a',
};
/** Fixed guards of special dwellings (must be beaten once before the first flagging). */
const DWELLING_GUARDS = {
  golem_factory: [g('gold_golem', 9, 3), g('diamond_golem', 6, 2)],
  elemental_conflux: [g('earth_elemental', 12, 3), g('fire_elemental', 12, 2)],
  magic_forest: [g('faerie_dragon', 3, 1)],
  sulfurous_lair: [g('rust_dragon', 3, 1)],
  crystal_cave: [g('crystal_dragon', 3, 1)],
  frozen_cliffs: [g('azure_dragon', 3, 1)],
  ancient_lamp: [],
};

const DWELLING_LIST = DWELLING_TABLE.map(([faction, tier, id, name, creatures, extra = false]) => {
  const special = { ancient_lamp: { stockFixed: [4, 6], restock: false, removable: true } }[id] || {};
  const native = FACTION_TERRAIN[faction];
  return def(id, name, 'dwelling',
    { type: 'dwelling', faction, tier, creatures, freeFirst: tier === 1, guards: DWELLING_GUARDS[id] || [],
      growthMultiplier: 1, townGrowthBonus: tier >= 1 && tier <= 7 ? 1 : 0, ...special },
    { size: tier >= 6 || tier === 0 ? [3, 2] : [2, 2], value: DWELLING_VALUE_BY_TIER[tier], frequency: DWELLING_FREQ_BY_TIER[tier],
      terrains: native ? [native, ...LAND.filter((t) => t !== native)] : LAND,
      nativeTerrain: native || null, shape: 'dwelling', color: FACTION_HEX[faction], extra,
      description: `Hire ${creatures.map((c) => c.replace(/_/g, ' ')).join(', ')} here every week${tier === 1 ? ' (they join for free)' : ''}.` });
});

// ---------------------------------------------------------------------------------------------
// 8. monsters and towns (generator placeholders + rules)

const MONSTER_EFFECT = {
  type: 'monster',
  sizeLabels: MONSTER_SIZE_LABELS.map((l) => l.id),
  dispositions: MONSTER_DISPOSITIONS.map((d) => d.id),
  defaultDisposition: 'aggressive',
  weeklyGrowthPercent: 10,
  growthCap: 4000,
  guardRadius: 1,
  countByTier: MONSTER_COUNT_BY_TIER,
  upgradedStackChance: 50,
  canFlee: true,
  canJoin: true,
};

const MONSTERS_TOWNS = [
  def('monster', 'Monster', 'guard', { ...MONSTER_EFFECT, tier: null },
    { interact: 'adjacent', removable: true, revisit: 'removed', value: 0, frequency: 0, shape: 'monster', color: '#c03a2a',
      description: 'A wandering stack of creatures. Instance data: creatureId, count, disposition, neverFlees, noGrowth, reward.' }),
  def('random_monster', 'Random Monster', 'guard', { ...MONSTER_EFFECT, tier: null, placeholder: true },
    { interact: 'adjacent', removable: true, revisit: 'removed', shape: 'monster', color: '#c03a2a', description: 'Placeholder: any creature of tier 1-7.' }),
  ...[1, 2, 3, 4, 5, 6, 7].map((tier) => def(`random_monster_${tier}`, `Random Monster (Level ${tier})`, 'guard', { ...MONSTER_EFFECT, tier, placeholder: true },
    { interact: 'adjacent', removable: true, revisit: 'removed', shape: 'monster', color: '#c03a2a', description: `Placeholder: any creature of tier ${tier}.` })),
  def('town', 'Town', 'town', { type: 'town', faction: null },
    { size: [5, 3], value: 0, frequency: 0, shape: 'town', color: '#d8c8a0', description: 'A town. Instance data: townId.' }),
  def('random_town', 'Random Town', 'town', { type: 'town', faction: 'random', placeholder: true },
    { size: [5, 3], value: 0, frequency: 0, shape: 'town', color: '#d8c8a0', description: 'Placeholder replaced by a town of a random faction.' }),
  def('event', 'Event', 'special', { type: 'event', payloadFields: ['guards', 'message', 'exp', 'mana', 'morale', 'luck', 'resources', 'primary', 'skills', 'artifacts', 'spells', 'creatures'],
    filters: ['players', 'humanOnly', 'aiOnly', 'once'] },
    { blocking: false, value: 0, frequency: 0, shape: 'marker', color: '#00000000', description: 'Invisible trigger on a tile.' }),
];

// ---------------------------------------------------------------------------------------------
// 9. new visitable objects (not in the original)

const x = { extra: true };
const EXTRAS = [
  def('ancient_battlefield', 'Ancient Battlefield', 'visit_once',
    { type: 'reward_once', confirm: true,
      table: [row(40, { resources: { gold: [500, 1500, 100] } }), row(35, { artifacts: [art('treasure')] }), row(15, { artifacts: [art('minor')] }), row(10, {})],
      penalty: [temp({ type: 'morale', value: -1 }, 'next_battle')], penaltyWhenEmpty: true },
    { ...x, size: [2, 1], value: 1500, frequency: 40, shape: 'bones', color: '#a09080', description: 'Search the fallen for gold or an artifact at the cost of 1 morale until the next battle.' }),
  per('sparring_grounds', 'Sparring Grounds', { type: 'primary_boost', options: [stat('attack'), stat('defense')] },
    { ...x, size: [2, 1], value: 1500, frequency: 40, shape: 'flag', color: '#b04a3a', description: '+1 Attack or +1 Defense (hero chooses), once per hero.' }),
  per('stone_circle', 'Stone Circle', { type: 'primary_boost', options: [stat('power'), stat('knowledge')] },
    { ...x, size: [2, 2], value: 1500, frequency: 40, shape: 'ring', color: '#9a9aa8', description: '+1 Spell Power or +1 Knowledge (hero chooses), once per hero.' }),
  per('veterans_hall', "Veterans' Hall", { type: 'exp_boost', exp: 0, expPerLevel: 250 },
    { ...x, size: [2, 2], value: 2000, frequency: 30, shape: 'building', color: '#8a5a3a', description: 'Old soldiers share their tales: +250 experience per hero level, once per hero.' }),
  def('moon_well', 'Moon Well', 'visit_per_hero', { type: 'mana_restore', mode: 'add', amount: 25, allowOvercharge: true },
    { ...x, revisit: 'per_hero_daily', value: 300, frequency: 50, shape: 'well', color: '#c0c8f0', description: '+25 spell points, even above the maximum; once per day per hero.' }),
  def('tailwind_totem', 'Tailwind Totem', 'visit_per_hero', { type: 'temp_bonus', until: 'end_of_day', bonuses: [], movement: 600 },
    { ...x, revisit: 'per_hero_daily', value: 300, frequency: 40, shape: 'pillar', color: '#bfe0f4', description: '+600 movement points today; once per day per hero.' }),
  buff('war_drums', 'War Drums', { bonuses: [B.morale(2)] },
    { ...x, value: 200, frequency: 40, shape: 'tent', color: '#a03a2a', description: '+2 morale until the next battle.' }),
  buff('fortune_teller', 'Fortune Teller', { bonuses: [], random: { bonus: 'luck', min: -2, max: 3 }, cost: { gold: 100 } },
    { ...x, value: 100, frequency: 40, shape: 'tent', color: '#8a3ab0', description: 'For 100 gold: random luck from -2 to +3 until the next battle.' }),
  buff('battle_shrine', 'Battle Shrine', { bonuses: [{ type: 'primary', stat: 'attack', value: 2 }, { type: 'primary', stat: 'defense', value: 2 }] },
    { ...x, value: 500, frequency: 30, shape: 'shrine', color: '#d8a03a', description: '+2 Attack and +2 Defense until the next battle.' }),
  def('smugglers_den', "Smugglers' Den", 'special', { type: 'black_market', slots: 3, classes: ['treasure', 'minor'], marketCount: 9, restock: 'weekly' },
    { ...x, size: [2, 2], value: 3000, frequency: 30, limit: 1, shape: 'hut', color: '#3a4a4a', coastal: true, description: 'Sells three cheap artifacts, restocked every week.' }),
  def('watchtower', 'Watchtower', 'visit_per_player', { type: 'reveal_map', mode: 'radius', radius: 12 },
    { ...x, size: [1, 2], value: 400, frequency: 80, shape: 'tower', color: '#8a7a6a', description: 'Reveals the map within 12 tiles.' }),
  def('star_chart', 'Star Chart', 'visit_per_player', { type: 'reveal_map', mode: 'objects', objectDefId: 'obelisk', radius: 3 },
    { ...x, value: 1000, frequency: 20, limit: 1, shape: 'observatory', color: '#3a3a8a', description: 'Shows the location of every obelisk on the map.' }),
  def('royal_mint', 'Royal Mint', 'visit_weekly', { type: 'weekly_reward', table: [row(50, { resources: { gold: 750 } }), row(30, { resources: { gold: 1000 } }), row(20, { resources: { gold: 1500 } })] },
    { ...x, size: [2, 2], value: 1500, frequency: 30, shape: 'building', color: '#e8c040', description: 'Each week: 750, 1000 or 1500 gold.' }),
  def('wishing_well', 'Wishing Well', 'visit_weekly',
    { type: 'weekly_reward', cost: { gold: 100 }, table: [
      row(40, {}), row(30, { resources: { gold: 500 } }), row(15, { randomResource: { pool: RARE_RESOURCES, amount: [2, 4] } }),
      row(10, { bonuses: [temp({ type: 'luck', value: 2 }, 'next_battle')] }), row(5, { artifacts: [art('treasure')] }),
    ] },
    { ...x, value: 400, frequency: 40, shape: 'well', color: '#6ac4f0', description: 'Toss in 100 gold once a week: nothing, gold, resources, luck or even an artifact.' }),
  def('beastmaster_camp', 'Beastmaster Camp', 'special', { type: 'refugee_camp', maxTier: 4, costMultiplier: 0.8, stock: 'growth' },
    { ...x, size: [2, 2], value: 2500, frequency: 30, limit: 1, shape: 'tent', color: '#7a8a4a', description: 'Each week one random creature of tier 1-4 can be hired at 80% of its cost.' }),
  ...['air', 'earth', 'fire', 'water'].map((school) => per(`${school}_sanctum`, `${school[0].toUpperCase()}${school.slice(1)} Sanctum`, { type: 'learn_spell', level: [1, 3], school },
    { ...x, value: 2000, frequency: 15, shape: 'shrine', color: { air: '#d8e4f4', earth: '#8a7a4a', fire: '#e0582a', water: '#3a8ad8' }[school],
      description: `Teaches a random ${school} spell of level 1-3 (fixed per sanctum).` })),
  per('runestone', 'Runestone', { type: 'learn_skill', level: 1, pick: 'random', exclude: ['necromancy'], choices: 2, cost: { gold: 1500 } },
    { ...x, value: 2000, frequency: 30, shape: 'stone', color: '#6ad8c0', description: 'For 1500 gold teaches Basic level of one of two secondary skills (fixed per stone, hero chooses).' }),
];

// ---------------------------------------------------------------------------------------------
// 10. scenery

/**
 * Compact decor table: [id, name, shape, terrains, sizes, blocking, frequency, color].
 * Each (id, size) pair yields one definition; ids get a `_WxH` suffix when several sizes exist.
 */
const DECOR_TABLE = [
  ['oak_trees', 'Oak Trees', 'tree', ['grass', 'dirt', 'highlands'], [[1, 1], [2, 1], [2, 2], [3, 2]], true, 100, '#2e6a22'],
  ['pine_trees', 'Pine Trees', 'pine', ['snow', 'highlands', 'grass'], [[1, 1], [2, 1], [2, 2], [3, 2]], true, 100, '#1e5a3a'],
  ['palm_trees', 'Palm Trees', 'palm', ['sand'], [[1, 1], [2, 1], [2, 2]], true, 80, '#4a9a3a'],
  ['dead_trees', 'Dead Trees', 'dead_tree', ['dirt', 'rough', 'lava', 'wasteland'], [[1, 1], [2, 1], [2, 2]], true, 80, '#4a3a2a'],
  ['mangroves', 'Mangroves', 'mangrove', ['swamp'], [[1, 1], [2, 1], [2, 2], [3, 2]], true, 100, '#2a5a3a'],
  ['mountains', 'Mountains', 'mountain', SURFACE.concat('subterranean'), [[2, 2], [3, 2], [4, 3], [5, 3]], true, 100, '#6a625a'],
  ['volcano', 'Volcano', 'volcano', ['lava'], [[3, 3], [4, 3]], true, 30, '#e8601c'],
  ['rocks', 'Rocks', 'rock', LAND, [[1, 1], [2, 1], [2, 2]], true, 80, '#7a726a'],
  ['lake', 'Lake', 'lake', ['grass', 'dirt', 'swamp', 'highlands', 'subterranean'], [[2, 2], [3, 2], [4, 3]], true, 50, '#3a74b8'],
  ['frozen_lake', 'Frozen Lake', 'frozen_lake', ['snow'], [[2, 2], [3, 2], [4, 3]], true, 50, '#bfe0f4'],
  ['lava_lake', 'Lava Lake', 'lava_lake', ['lava'], [[2, 2], [3, 2], [4, 3]], true, 50, '#f0641e'],
  ['oasis_pool', 'Desert Pool', 'oasis_lake', ['sand'], [[2, 2], [3, 2]], true, 20, '#3a9ab8'],
  ['lava_flow', 'Lava Flow', 'lava_flow', ['lava'], [[2, 1], [3, 1]], true, 40, '#f0641e'],
  ['crater', 'Crater', 'crater', ['dirt', 'rough', 'lava', 'wasteland', 'sand', 'grass', 'snow', 'highlands', 'subterranean'], [[2, 2], [3, 2]], true, 30, '#4a3a2a'],
  ['canyon', 'Canyon', 'canyon', ['rough', 'wasteland'], [[3, 2], [4, 2]], true, 30, '#7a4a28'],
  ['mushrooms', 'Mushrooms', 'mushroom', ['subterranean', 'swamp'], [[1, 1], [2, 1], [2, 2]], true, 100, '#b06ad8'],
  ['stalagmites', 'Stalagmites', 'stalagmite', ['subterranean'], [[1, 1], [2, 1], [2, 2]], true, 80, '#6e5c66'],
  ['crystals', 'Crystal Outcrop', 'crystal', ['subterranean', 'snow'], [[1, 1], [2, 1]], true, 30, '#d03a8a'],
  ['stump', 'Stump', 'stump', ['grass', 'dirt', 'swamp', 'snow', 'highlands'], [[1, 1]], true, 60, '#6a4a2a'],
  ['log', 'Fallen Log', 'log', ['grass', 'dirt', 'swamp', 'highlands'], [[2, 1]], true, 40, '#6a4a2a'],
  ['shrubs', 'Shrubs', 'shrub', ['grass', 'dirt', 'rough', 'highlands'], [[1, 1], [2, 1]], true, 60, '#3a7a2a'],
  ['flowers', 'Flowers', 'flowers', ['grass', 'highlands'], [[1, 1], [2, 1]], false, 60, '#e86ab0'],
  ['cactus', 'Cacti', 'cactus', ['sand', 'rough', 'wasteland'], [[1, 1], [2, 1]], true, 80, '#4a8a3a'],
  ['sand_dune', 'Sand Dune', 'dune', ['sand'], [[2, 1], [3, 2]], true, 60, '#c8a850'],
  ['reeds', 'Reeds', 'reeds', ['swamp'], [[1, 1], [2, 1]], true, 60, '#7a8a3a'],
  ['moss', 'Moss', 'moss', ['swamp', 'subterranean'], [[1, 1], [2, 1]], false, 40, '#4a7a3a'],
  ['ice_block', 'Ice Block', 'ice_block', ['snow'], [[1, 1], [2, 1]], true, 60, '#a8d4e8'],
  ['tar_pit', 'Tar Pit', 'tar_pit', ['wasteland', 'rough'], [[2, 1], [2, 2]], true, 30, '#1a1614'],
  ['skeleton_remains', 'Bones', 'bones', ['sand', 'rough', 'wasteland', 'dirt', 'lava', 'subterranean'], [[1, 1], [2, 1]], false, 40, '#d8d0c0'],
  ['reef', 'Reef', 'reef', ['water'], [[1, 1], [2, 1], [2, 2]], true, 80, '#5a6a6a'],
  ['sea_rocks', 'Sea Rocks', 'sea_rock', ['water'], [[1, 1], [2, 1], [2, 2], [3, 2]], true, 80, '#6a6a72'],
  ['kelp', 'Kelp', 'kelp', ['water'], [[1, 1], [2, 1]], false, 30, '#2a6a4a'],
];

const DECOR_LIST = DECOR_TABLE.flatMap(([id, name, shape, terrains, sizes, blocking, frequency, color]) =>
  sizes.map((size) => def(sizes.length > 1 ? `${id}_${size[0]}x${size[1]}` : id, name, 'decor', { type: 'none' },
    { size, blocking, terrains, frequency, shape, color, value: 0, base: id,
      description: blocking ? 'Impassable scenery.' : 'Passable scenery.' })));

// ---------------------------------------------------------------------------------------------
// exports

/** @type {MapObjectDef[]} */
export const MAP_OBJECTS = [
  ...PICKUPS, ...MINES, ...BANKS_LIST, ...BOOSTERS, ...BUFFS, ...GUARDS_TRANSPORT,
  ...DWELLING_LIST, ...MONSTERS_TOWNS, ...EXTRAS, ...DECOR_LIST,
];

export const MAP_OBJECT_BY_ID = Object.fromEntries(MAP_OBJECTS.map((o) => [o.id, o]));

/** @param {string} id @returns {MapObjectDef} */
export function getMapObject(id) {
  const o = MAP_OBJECT_BY_ID[id];
  if (!o) throw new Error(`Unknown map object: ${id}`);
  return o;
}

/** @param {string} category */
export function getObjectsByCategory(category) {
  return MAP_OBJECTS.filter((o) => o.category === category);
}

/** @param {string} type effect type */
export function getObjectsByEffect(type) {
  return MAP_OBJECTS.filter((o) => o.effect.type === type);
}

/** Objects the generator may place on a terrain (frequency > 0). */
export function getObjectsForTerrain(terrainId) {
  return MAP_OBJECTS.filter((o) => o.frequency > 0 && o.terrains.includes(terrainId));
}

export const BANKS = getObjectsByEffect('bank');
export const DWELLINGS = getObjectsByEffect('dwelling');
export const MINE_OBJECTS = getObjectsByEffect('mine');
export const DECOR = getObjectsByCategory('decor').filter((o) => o.effect.type === 'none' && o.frequency > 0);
export const EXTRA_OBJECTS = MAP_OBJECTS.filter((o) => o.extra);

/** Dwellings selling creatures of a faction, optionally of one tier. */
export function getDwellingsForFaction(faction, tier = null) {
  return DWELLINGS.filter((d) => d.effect.faction === faction && (tier === null || d.effect.tier === tier));
}

/** Decor definitions that fit a terrain. */
export function getDecorForTerrain(terrainId) {
  return DECOR.filter((o) => o.terrains.includes(terrainId));
}

/** Every creature id this file refers to (for cross-module reconciliation and tests). */
export function referencedCreatureIds() {
  const ids = new Set();
  for (const o of MAP_OBJECTS) {
    const e = o.effect;
    for (const c of e.creatures || []) ids.add(c);
    for (const gd of e.guards || []) ids.add(gd.creatureId);
    for (const l of e.levels || []) {
      for (const gd of l.guards) ids.add(gd.creatureId);
      for (const c of l.reward.creatures || []) ids.add(c.creatureId);
      if (l.upgradedStack) ids.add(l.upgradedStack.creatureId);
    }
    for (const u of e.upgrade || []) { ids.add(u.from); ids.add(u.to); }
  }
  return [...ids].sort();
}

export const DWELLING_FACTIONS = [...FACTIONS, 'neutral'];
