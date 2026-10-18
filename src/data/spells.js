// Spell data: all 70 spells of the original, ~12 extra spells (`extra: true`) and the creature-only
// effects (`creatureOnly: true`) that share the same effect/status system.
// Exact resolution rules for every field and effect type: docs/mechanics/spells.md
//
// Conventions
// - Every per-mastery array has 4 entries indexed by MASTERY (none, basic, advanced, expert).
// - Generic value of a spell: value = power[mastery] + perPower * heroSpellPower  (see spellValue).
// - `effect.sign` (+1 / -1) tells whether the value is added or subtracted for stat-like effects.

import { SPELL_SCHOOLS, MASTERY, FACTIONS } from '../core/constants.js';
import { weightedPick } from '../core/rng.js';

/**
 * @typedef {Object} Spell
 * @property {string} id
 * @property {string} name
 * @property {'air'|'earth'|'fire'|'water'|'all'} school
 * @property {number} level 1..5
 * @property {number} cost mana cost without school mastery (== costByMastery[0])
 * @property {number[]} costByMastery mana cost per mastery [none, basic, advanced, expert]
 * @property {'combat'|'adventure'} kind
 * @property {string} target one of SPELL_TARGETS (base target, see effectiveTarget)
 * @property {string[]|null} targetByMastery per-mastery target override (Dispel)
 * @property {string|null} target2 second selection (Teleport: 'hex', Sacrifice: 'friendly_stack')
 * @property {string} category one of SPELL_CATEGORIES
 * @property {'positive'|'negative'|'neutral'} alignment
 * @property {number[]} power base value per mastery
 * @property {number} perPower added per point of hero spell power
 * @property {'power'|'battle'|'day'|number|null} duration
 * @property {number[]|null} durationByMastery fixed rounds per mastery (overrides numeric duration)
 * @property {number|null} massAt mastery at which the spell hits all valid targets
 * @property {Object|null} area
 * @property {Object} effect
 * @property {string[]} immune creature tags that are immune
 * @property {string[]} vulnerable creature tags that take double damage
 * @property {string[]} requires creature tags a target must ALL have
 * @property {boolean} resistible subject to magic resistance / magic mirror
 * @property {boolean} dispellable removed by Dispel / Cure
 * @property {boolean} guild may appear in mage guilds, scrolls, shrines, pyramids
 * @property {number} triggerChance creature-only: default % chance to trigger (0 = n/a)
 * @property {boolean} extra not in the original game
 * @property {boolean} creatureOnly creature ability, never castable by heroes
 * @property {boolean} special castable only through an artifact (Titan's Lightning Bolt)
 * @property {string[]} description per mastery
 * @property {number} aiValue
 */

// ---------------------------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------------------------

export const SPELL_SCHOOL_IDS = [...SPELL_SCHOOLS, 'all'];
export const SPELL_KINDS = ['combat', 'adventure'];
export const SPELL_TARGETS = [
  'none', 'enemy_stack', 'friendly_stack', 'any_stack', 'hex', 'area', 'all_enemies',
  'all_friendly', 'all', 'obstacle', 'dead_friendly_stack',
];
export const SPELL_CATEGORIES = [
  'damage', 'buff', 'debuff', 'heal', 'summon', 'control', 'utility', 'adventure',
];
export const SPELL_ALIGNMENTS = ['positive', 'negative', 'neutral'];
export const SPELL_DURATION_KEYWORDS = ['power', 'battle', 'day'];

export const EFFECT_TYPES = [
  'damage',            // instant damage
  'damage_over_time',  // damage every round while active
  'heal',              // restore hp of the top creature (no resurrection)
  'heal_over_time',    // heal every round while active
  'resurrect',         // raise dead creatures of a stack
  'sacrifice',         // destroy one friendly stack to resurrect another
  'summon',            // create a new stack
  'clone',             // create a fragile copy of a stack
  'stat_mod',          // attack / defense / morale / luck delta
  'speed_mod',         // speed delta (flat or percent)
  'damage_mode',       // always max / always min damage
  'damage_reduction',  // % less damage from melee / ranged / a spell school
  'damage_shield',     // returns % of received melee damage to the attacker
  'max_hp_mod',        // changes max hp of every creature in the stack
  'extra_retaliation', // additional retaliations per round
  'frenzy',            // converts defense into attack
  'slayer',            // attack bonus versus listed creature kinds
  'spell_immunity',    // immunity to spells up to a level
  'spell_reflect',     // chance to reflect hostile single-target spells
  'dispel',            // remove active effects
  'control',           // blind / berserk / hypnotize / forget / paralyze / stone / bind / fear
  'teleport',          // move a stack to a free hex
  'obstacle',          // create battlefield obstacles
  'remove_obstacle',   // remove a battlefield obstacle
  'wall_damage',       // damage siege walls
  'instant_kill',      // kill whole creatures outright (death stare)
  'life_drain',        // attacker heals/resurrects from dealt damage
  'adventure',         // adventure-map action
  'multi',             // several effects applied together: effect.effects = [...]
];

export const CONTROL_KINDS = [
  'blind', 'berserk', 'hypnotize', 'forget', 'paralyze', 'stone', 'bind', 'fear',
];
export const OBSTACLE_KINDS = ['quicksand', 'land_mine', 'force_field', 'fire_wall'];
export const ADVENTURE_ACTIONS = [
  'summon_boat', 'scuttle_boat', 'visions', 'view_earth', 'view_air', 'disguise', 'fly',
  'water_walk', 'dimension_door', 'town_portal',
];
export const AREA_SHAPES = ['radius', 'ring', 'chain', 'line'];
/** Damage elements (independent of school; drive elemental immunity / vulnerability). */
export const DAMAGE_ELEMENTS = ['fire', 'cold', 'lightning', 'earth'];
export const STAT_MOD_STATS = ['attack', 'defense', 'morale', 'luck'];

/** Creature tags a spell's `immune` / `requires` lists may use (engine derives them per stack). */
export const IMMUNITY_TAGS = [
  'undead',            // skeletons, zombies, ... all Necropolis units, mummies
  'non_living',        // golems, gargoyles, elementals (not undead, not alive)
  'mind_immune',       // explicit "immune to mind spells" (giants, titans, ...)
  'war_machine',       // ballista, catapult, ammo cart, first aid tent, arrow towers
  'sightless',         // troglodytes: immune to Blind and Stone Gaze
  'flying',            // flyers (immune to Entangle / quicksand-like effects)
  'shooter',           // has a ranged attack with shots left (used in `requires`)
  'fire_immune',       // efreet, fire elementals, phoenix: immune to the whole fire school
  'cold_immune',       // water / ice elementals
  'lightning_immune',  // earth / magma elementals
  'earth_immune',      // air / storm elementals
];
/** Creature tags a spell's `vulnerable` list may use (damage x2). */
export const VULNERABILITY_TAGS = [
  'fire_vulnerable', 'cold_vulnerable', 'lightning_vulnerable', 'earth_vulnerable',
];
/** Creature kinds the Slayer spell knows about (engine maps creature ids to these). */
export const SLAYER_KINDS = ['dragon', 'behemoth', 'hydra', 'angel', 'devil', 'titan'];

// ---------------------------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------------------------

/** Tags immune to mind spells. */
const MIND = ['mind_immune', 'undead', 'non_living', 'war_machine'];
/** Tags that are not alive. */
const UNLIVING = ['undead', 'non_living', 'war_machine'];

const POSITIVE_CATEGORIES = ['buff', 'heal', 'summon'];
const NEGATIVE_CATEGORIES = ['damage', 'debuff', 'control'];

function four(v) {
  if (v.length === 4) return [...v];
  if (v.length === 2) return [v[0], v[1], v[1], v[1]];
  throw new Error('expected 2 or 4 values');
}

function describe(spell, template, suffixes) {
  return [0, 1, 2, 3].map((m) => {
    const text = template
      .replaceAll('{p}', String(spell.power[m]))
      .replaceAll('{pp}', String(spell.perPower));
    const extra = suffixes ? suffixes[m] : '';
    return extra ? `${text} ${extra}` : text;
  });
}

/**
 * Compact spell definition -> full Spell.
 * o: { id, name, school, level, c (cost [none, mastered] or 4 values), kind, target, category,
 *      p (power x4), pp (perPower), dur, durM, mass, area, effect, immune, vulnerable, requires,
 *      d (description template), dm (per-mastery description suffixes), ai, ...flags }
 */
function S(o) {
  const kind = o.kind ?? 'combat';
  const category = o.category;
  const alignment = o.alignment ?? (POSITIVE_CATEGORIES.includes(category) ? 'positive'
    : NEGATIVE_CATEGORIES.includes(category) ? 'negative' : 'neutral');
  const duration = o.dur ?? null;
  const costByMastery = four(o.c);
  const immune = [...(o.immune ?? [])];
  // Fire-immune creatures are immune to the whole fire school.
  if (o.school === 'fire' && kind === 'combat' && !immune.includes('fire_immune')) {
    immune.push('fire_immune');
  }
  const spell = {
    id: o.id,
    name: o.name,
    school: o.school,
    level: o.level,
    cost: costByMastery[0],
    costByMastery,
    kind,
    target: o.target,
    targetByMastery: o.targetM ?? null,
    target2: o.target2 ?? null,
    category,
    alignment,
    power: o.p ? [...o.p] : [0, 0, 0, 0],
    perPower: o.pp ?? 0,
    duration,
    durationByMastery: o.durM ?? null,
    massAt: o.mass ?? null,
    area: o.area ?? null,
    effect: o.effect,
    immune,
    vulnerable: [...(o.vulnerable ?? [])],
    requires: [...(o.requires ?? [])],
    resistible: o.resistible ?? (kind === 'combat' && alignment === 'negative'),
    dispellable: o.dispellable ?? (kind === 'combat' && duration !== null && duration !== 'battle'),
    guild: o.guild ?? !(o.creatureOnly || o.special),
    triggerChance: o.chance ?? 0,
    extra: o.extra ?? false,
    creatureOnly: o.creatureOnly ?? false,
    special: o.special ?? false,
    description: [],
    aiValue: o.ai ?? 0,
  };
  spell.description = describe(spell, o.d, o.dm);
  return spell;
}

const MASS = MASTERY.EXPERT;
const dmg = (element = null, extra = {}) => ({ type: 'damage', element, ...extra });
const stat = (statId, sign, extra = {}) => ({ type: 'stat_mod', stat: statId, sign, mode: 'all', ...extra });
const adv = (action, extra = {}) => ({ type: 'adventure', action, ...extra });
const MASS_TXT = ['', '', '', 'Affects all valid targets.'];

// ---------------------------------------------------------------------------------------------
// Original spells (70)
// ---------------------------------------------------------------------------------------------

const ORIGINAL = [
  // ---- Adventure spells ---------------------------------------------------------------------
  S({ id: 'summon_boat', name: 'Summon Boat', school: 'water', level: 1, c: [8, 7], kind: 'adventure',
    target: 'none', category: 'adventure', p: [50, 50, 75, 100],
    effect: adv('summon_boat', { createsBoat: [false, false, false, true] }),
    d: '{p}% chance to bring your nearest unoccupied boat to the hero\'s shore.',
    dm: ['', '', '', 'If no boat exists, a new one is created.'], ai: 20 }),
  S({ id: 'scuttle_boat', name: 'Scuttle Boat', school: 'water', level: 2, c: [8, 6], kind: 'adventure',
    target: 'none', category: 'adventure', p: [50, 50, 75, 100],
    effect: adv('scuttle_boat', { range: 1 }),
    d: '{p}% chance to destroy an unoccupied boat adjacent to the hero.', ai: 10 }),
  S({ id: 'visions', name: 'Visions', school: 'all', level: 2, c: [4, 2], kind: 'adventure',
    target: 'none', category: 'adventure', p: [1, 1, 2, 3], dur: 'day',
    effect: adv('visions', { minRange: 3,
      shows: [['monsters'], ['monsters'], ['monsters', 'heroes'], ['monsters', 'heroes', 'towns']] }),
    d: 'Reveals exact numbers and disposition of wandering monsters within {p} x Power tiles (minimum 3).',
    dm: ['', '', 'Also shows enemy heroes\' stats and armies.', 'Also shows enemy heroes and towns.'], ai: 10 }),
  S({ id: 'view_earth', name: 'View Earth', school: 'earth', level: 1, c: [2, 1], kind: 'adventure',
    target: 'none', category: 'adventure',
    effect: adv('view_earth', {
      shows: [['resources'], ['resources'], ['resources', 'mines'], ['resources', 'mines', 'terrain']] }),
    d: 'Shows the location of all resources on the map.',
    dm: ['', '', 'Also shows mines.', 'Also shows mines and reveals the terrain.'], ai: 10 }),
  S({ id: 'disguise', name: 'Disguise', school: 'air', level: 2, c: [4, 2], kind: 'adventure',
    target: 'none', category: 'adventure', dur: 'day',
    effect: adv('disguise', {
      mode: ['strongest_stack', 'strongest_stack', 'strongest_creature', 'hidden'] }),
    d: 'Until the next day enemies see all your stacks as copies of your most powerful stack.',
    dm: ['', '', 'Stacks appear as the most powerful creature of your army in great numbers.',
      'Enemies cannot see your army at all.'], ai: 10 }),
  S({ id: 'view_air', name: 'View Air', school: 'air', level: 1, c: [2, 1], kind: 'adventure',
    target: 'none', category: 'adventure',
    effect: adv('view_air', {
      shows: [['artifacts'], ['artifacts'], ['artifacts', 'heroes'], ['artifacts', 'heroes', 'towns']] }),
    d: 'Shows the location of all artifacts on the map.',
    dm: ['', '', 'Also shows heroes.', 'Also shows heroes and towns.'], ai: 10 }),
  S({ id: 'fly', name: 'Fly', school: 'air', level: 5, c: [20, 15], kind: 'adventure',
    target: 'none', category: 'adventure', p: [40, 40, 20, 0], dur: 'day',
    effect: adv('fly'),
    d: 'Until the end of the day the hero may fly over obstacles and water. Each tile costs {p}% more movement.', ai: 150 }),
  S({ id: 'water_walk', name: 'Water Walk', school: 'water', level: 4, c: [12, 9], kind: 'adventure',
    target: 'none', category: 'adventure', p: [40, 40, 20, 0], dur: 'day',
    effect: adv('water_walk'),
    d: 'Until the end of the day the hero may walk over water. Each water tile costs {p}% more movement.', ai: 60 }),
  S({ id: 'dimension_door', name: 'Dimension Door', school: 'air', level: 5, c: [25, 20], kind: 'adventure',
    target: 'none', category: 'adventure', p: [2, 2, 3, 4],
    effect: adv('dimension_door', { usesPerDay: [2, 2, 3, 4], moveCost: [300, 300, 300, 200],
      range: [8, 8, 10, 12] }),
    d: 'Teleports the hero to a free tile nearby. Usable {p} times per day.',
    dm: ['Costs 3 tiles of movement.', 'Costs 3 tiles of movement.', 'Costs 3 tiles of movement.',
      'Costs 2 tiles of movement.'], ai: 200 }),
  S({ id: 'town_portal', name: 'Town Portal', school: 'earth', level: 4, c: [16, 12], kind: 'adventure',
    target: 'none', category: 'adventure',
    effect: adv('town_portal', { chooseTown: [false, false, true, true],
      moveCost: [300, 300, 300, 200] }),
    d: 'Teleports the hero to the nearest friendly town without a visiting hero.',
    dm: ['Costs 3 tiles of movement.', 'Costs 3 tiles of movement.',
      'You may choose the town. Costs 3 tiles of movement.',
      'You may choose the town. Costs 2 tiles of movement.'], ai: 180 }),

  // ---- Battlefield obstacles / siege ----------------------------------------------------------
  S({ id: 'quicksand', name: 'Quicksand', school: 'earth', level: 2, c: [8, 6], target: 'none',
    category: 'utility', p: [4, 4, 6, 8], dur: 'battle', resistible: false,
    immune: ['flying'],
    effect: { type: 'obstacle', kind: 'quicksand', count: [4, 4, 6, 8], placement: 'random',
      hiddenFromEnemy: true, stopsMovement: true },
    d: 'Places {p} quicksand pits at random hexes. A walking stack that enters a pit stops moving for the turn.', ai: 20 }),
  S({ id: 'land_mine', name: 'Land Mine', school: 'fire', level: 3, c: [18, 15], target: 'none',
    category: 'damage', alignment: 'neutral', p: [25, 25, 50, 100], pp: 10, dur: 'battle',
    resistible: false, immune: ['flying'], vulnerable: ['fire_vulnerable'],
    effect: { type: 'obstacle', kind: 'land_mine', count: [4, 4, 6, 8], placement: 'random',
      hiddenFromEnemy: true, stopsMovement: true, element: 'fire' },
    d: 'Places mines at random hexes; each deals {p} + {pp} x Power fire damage to a stack walking onto it.',
    dm: ['(4 mines)', '(4 mines)', '(6 mines)', '(8 mines)'], ai: 30 }),
  S({ id: 'force_field', name: 'Force Field', school: 'earth', level: 3, c: [12, 9], target: 'hex',
    category: 'utility', p: [2, 2, 3, 3], dur: 2, resistible: false,
    area: { shape: 'line', length: [2, 2, 3, 3] },
    effect: { type: 'obstacle', kind: 'force_field', blocksMovement: true },
    d: 'Creates an impassable {p}-hex wide force field for 2 rounds.', ai: 40 }),
  S({ id: 'fire_wall', name: 'Fire Wall', school: 'fire', level: 2, c: [8, 6], target: 'hex',
    category: 'damage', alignment: 'neutral', p: [10, 10, 20, 50], pp: 10, dur: 2, resistible: false,
    area: { shape: 'line', length: [2, 2, 3, 3] }, vulnerable: ['fire_vulnerable'],
    effect: { type: 'obstacle', kind: 'fire_wall', element: 'fire', blocksMovement: false },
    d: 'Creates a wall of fire for 2 rounds dealing {p} + {pp} x Power damage to stacks passing through it.',
    dm: ['(2 hexes)', '(2 hexes)', '(3 hexes)', '(3 hexes)'], ai: 30 }),
  S({ id: 'earthquake', name: 'Earthquake', school: 'earth', level: 3, c: [20, 17], target: 'none',
    category: 'utility', p: [2, 2, 3, 4], resistible: false,
    effect: { type: 'wall_damage', hits: [2, 2, 3, 4], damagePerHit: 1 },
    d: 'Damages {p} random sections of the town walls. Only usable in a siege.', ai: 30 }),

  // ---- Direct damage ------------------------------------------------------------------------
  S({ id: 'magic_arrow', name: 'Magic Arrow', school: 'all', level: 1, c: [5, 4], target: 'enemy_stack',
    category: 'damage', p: [10, 10, 20, 30], pp: 10, effect: dmg(),
    d: 'Deals {p} + {pp} x Power damage to a single stack.', ai: 20 }),
  S({ id: 'ice_bolt', name: 'Ice Bolt', school: 'water', level: 2, c: [8, 6], target: 'enemy_stack',
    category: 'damage', p: [10, 10, 20, 50], pp: 20, effect: dmg('cold'),
    immune: ['cold_immune'], vulnerable: ['cold_vulnerable'],
    d: 'Deals {p} + {pp} x Power cold damage to a single stack.', ai: 40 }),
  S({ id: 'lightning_bolt', name: 'Lightning Bolt', school: 'air', level: 2, c: [10, 8], target: 'enemy_stack',
    category: 'damage', p: [10, 10, 20, 50], pp: 25, effect: dmg('lightning'),
    immune: ['lightning_immune'], vulnerable: ['lightning_vulnerable'],
    d: 'Deals {p} + {pp} x Power lightning damage to a single stack.', ai: 50 }),
  S({ id: 'implosion', name: 'Implosion', school: 'earth', level: 5, c: [30, 25], target: 'enemy_stack',
    category: 'damage', p: [100, 100, 200, 300], pp: 75, effect: dmg(),
    d: 'Deals {p} + {pp} x Power damage to a single stack.', ai: 200 }),
  S({ id: 'chain_lightning', name: 'Chain Lightning', school: 'air', level: 4, c: [24, 20], target: 'enemy_stack',
    category: 'damage', p: [25, 25, 50, 100], pp: 40,
    area: { shape: 'chain', targets: [4, 4, 4, 5], factor: 0.5 },
    effect: dmg('lightning', { friendlyFire: true }),
    immune: ['lightning_immune'], vulnerable: ['lightning_vulnerable'],
    d: 'Deals {p} + {pp} x Power lightning damage to the target, then jumps to the nearest stack for half the damage, and so on.',
    dm: ['(4 stacks)', '(4 stacks)', '(4 stacks)', '(5 stacks)'], ai: 120 }),
  S({ id: 'frost_ring', name: 'Frost Ring', school: 'water', level: 3, c: [12, 9], target: 'area',
    category: 'damage', p: [15, 15, 30, 60], pp: 10, area: { shape: 'ring', r: [1, 1, 1, 1] },
    effect: dmg('cold', { friendlyFire: true }),
    immune: ['cold_immune'], vulnerable: ['cold_vulnerable'],
    d: 'Deals {p} + {pp} x Power cold damage to all stacks adjacent to the target hex (not the hex itself).', ai: 50 }),
  S({ id: 'fireball', name: 'Fireball', school: 'fire', level: 3, c: [15, 12], target: 'area',
    category: 'damage', p: [15, 15, 30, 60], pp: 10, area: { shape: 'radius', r: [1, 1, 1, 1] },
    effect: dmg('fire', { friendlyFire: true }), vulnerable: ['fire_vulnerable'],
    d: 'Deals {p} + {pp} x Power fire damage to all stacks on the target hex and the hexes around it.', ai: 60 }),
  S({ id: 'inferno', name: 'Inferno', school: 'fire', level: 4, c: [16, 12], target: 'area',
    category: 'damage', p: [20, 20, 40, 80], pp: 10, area: { shape: 'radius', r: [2, 2, 2, 2] },
    effect: dmg('fire', { friendlyFire: true }), vulnerable: ['fire_vulnerable'],
    d: 'Deals {p} + {pp} x Power fire damage to all stacks within 2 hexes of the target hex.', ai: 80 }),
  S({ id: 'meteor_shower', name: 'Meteor Shower', school: 'earth', level: 4, c: [16, 12], target: 'area',
    category: 'damage', p: [25, 25, 50, 100], pp: 25, area: { shape: 'radius', r: [1, 1, 1, 1] },
    effect: dmg('earth', { friendlyFire: true }),
    immune: ['earth_immune'], vulnerable: ['earth_vulnerable'],
    d: 'Deals {p} + {pp} x Power damage to all stacks on the target hex and the hexes around it.', ai: 110 }),
  S({ id: 'death_ripple', name: 'Death Ripple', school: 'earth', level: 2, c: [10, 8], target: 'all',
    category: 'damage', p: [10, 10, 20, 30], pp: 5, effect: dmg(null, { friendlyFire: true }),
    immune: ['undead', 'war_machine'],
    d: 'Deals {p} + {pp} x Power damage to every stack on the battlefield that is not undead.', ai: 30 }),
  S({ id: 'destroy_undead', name: 'Destroy Undead', school: 'air', level: 3, c: [15, 12], target: 'all',
    category: 'damage', p: [10, 10, 20, 50], pp: 10, effect: dmg(null, { friendlyFire: true }),
    requires: ['undead'],
    d: 'Deals {p} + {pp} x Power damage to every undead stack on the battlefield.', ai: 30 }),
  S({ id: 'armageddon', name: 'Armageddon', school: 'fire', level: 4, c: [24, 20], target: 'all',
    category: 'damage', p: [30, 30, 60, 120], pp: 50, effect: dmg('fire', { friendlyFire: true }),
    immune: ['lightning_immune'], vulnerable: ['fire_vulnerable', 'lightning_vulnerable'],
    d: 'Deals {p} + {pp} x Power damage to every stack on the battlefield.', ai: 150 }),

  // ---- Protection ---------------------------------------------------------------------------
  S({ id: 'shield', name: 'Shield', school: 'earth', level: 1, c: [5, 4], target: 'friendly_stack',
    category: 'buff', p: [15, 15, 30, 30], dur: 'power', mass: MASS,
    effect: { type: 'damage_reduction', against: 'melee' },
    d: 'Reduces melee damage taken by {p}%.', dm: MASS_TXT, ai: 30 }),
  S({ id: 'air_shield', name: 'Air Shield', school: 'air', level: 3, c: [12, 9], target: 'friendly_stack',
    category: 'buff', p: [25, 25, 50, 50], dur: 'power', mass: MASS,
    effect: { type: 'damage_reduction', against: 'ranged' },
    d: 'Reduces ranged damage taken by {p}%.', dm: MASS_TXT, ai: 40 }),
  S({ id: 'fire_shield', name: 'Fire Shield', school: 'fire', level: 4, c: [16, 12], target: 'friendly_stack',
    category: 'buff', p: [20, 20, 25, 30], dur: 'power',
    effect: { type: 'damage_shield', element: 'fire' },
    d: 'Melee attackers of the target receive {p}% of the damage they deal as fire damage.', ai: 50 }),
  S({ id: 'protection_from_air', name: 'Protection from Air', school: 'air', level: 2, c: [7, 5],
    target: 'friendly_stack', category: 'buff', p: [30, 30, 50, 50], dur: 'power', mass: MASS,
    effect: { type: 'damage_reduction', against: 'spell_school', school: 'air' },
    d: 'Reduces damage from Air spells by {p}%.', dm: MASS_TXT, ai: 20 }),
  S({ id: 'protection_from_fire', name: 'Protection from Fire', school: 'fire', level: 1, c: [5, 4],
    target: 'friendly_stack', category: 'buff', p: [30, 30, 50, 50], dur: 'power', mass: MASS,
    effect: { type: 'damage_reduction', against: 'spell_school', school: 'fire' },
    d: 'Reduces damage from Fire spells by {p}%.', dm: MASS_TXT, ai: 20 }),
  S({ id: 'protection_from_water', name: 'Protection from Water', school: 'water', level: 1, c: [5, 4],
    target: 'friendly_stack', category: 'buff', p: [30, 30, 50, 50], dur: 'power', mass: MASS,
    effect: { type: 'damage_reduction', against: 'spell_school', school: 'water' },
    d: 'Reduces damage from Water spells by {p}%.', dm: MASS_TXT, ai: 20 }),
  S({ id: 'protection_from_earth', name: 'Protection from Earth', school: 'earth', level: 3, c: [12, 9],
    target: 'friendly_stack', category: 'buff', p: [30, 30, 50, 50], dur: 'power', mass: MASS,
    effect: { type: 'damage_reduction', against: 'spell_school', school: 'earth' },
    d: 'Reduces damage from Earth spells by {p}%.', dm: MASS_TXT, ai: 20 }),
  S({ id: 'anti_magic', name: 'Anti-Magic', school: 'earth', level: 3, c: [15, 12], target: 'friendly_stack',
    category: 'buff', p: [3, 3, 4, 5], dur: 'power', dispellable: false,
    effect: { type: 'spell_immunity', maxLevel: [3, 3, 4, 5], removesExisting: true },
    d: 'The target becomes immune to all spells of level {p} and lower.', ai: 60 }),
  S({ id: 'dispel', name: 'Dispel', school: 'water', level: 1, c: [5, 4], target: 'friendly_stack',
    targetM: ['friendly_stack', 'friendly_stack', 'any_stack', 'all'],
    category: 'utility', resistible: false,
    effect: { type: 'dispel', which: 'all', obstacles: [false, false, false, true] },
    d: 'Removes all spell effects from a friendly stack.',
    dm: ['', '', 'May also target enemy stacks.',
      'Affects every stack and removes magical obstacles from the battlefield.'], ai: 30 }),
  S({ id: 'magic_mirror', name: 'Magic Mirror', school: 'air', level: 5, c: [25, 20], target: 'friendly_stack',
    category: 'buff', p: [20, 20, 30, 40], dur: 'power',
    effect: { type: 'spell_reflect' },
    d: '{p}% chance to redirect a hostile spell cast on the target to a random enemy stack.', ai: 50 }),

  // ---- Healing / raising --------------------------------------------------------------------
  S({ id: 'cure', name: 'Cure', school: 'water', level: 1, c: [6, 5], target: 'friendly_stack',
    category: 'heal', p: [10, 10, 20, 30], pp: 5, mass: MASS,
    effect: { type: 'multi', effects: [{ type: 'dispel', which: 'negative' }, { type: 'heal' }] },
    d: 'Removes all negative spell effects and heals {p} + {pp} x Power hit points of the top creature.',
    dm: MASS_TXT, ai: 30 }),
  S({ id: 'resurrection', name: 'Resurrection', school: 'earth', level: 4, c: [20, 16],
    target: 'dead_friendly_stack', category: 'heal', p: [40, 40, 80, 160], pp: 50, immune: UNLIVING,
    effect: { type: 'resurrect', permanent: [false, false, true, true] },
    d: 'Restores {p} + {pp} x Power hit points worth of dead living creatures in a friendly stack.',
    dm: ['Raised creatures vanish after the battle.', 'Raised creatures vanish after the battle.',
      'Raised creatures stay after the battle.', 'Raised creatures stay after the battle.'], ai: 160 }),
  S({ id: 'animate_dead', name: 'Animate Dead', school: 'earth', level: 3, c: [15, 12],
    target: 'dead_friendly_stack', category: 'heal', p: [30, 30, 60, 160], pp: 50, requires: ['undead'],
    effect: { type: 'resurrect', permanent: [true, true, true, true] },
    d: 'Permanently restores {p} + {pp} x Power hit points worth of dead undead creatures in a friendly stack.', ai: 110 }),
  S({ id: 'sacrifice', name: 'Sacrifice', school: 'fire', level: 5, c: [25, 20],
    target: 'dead_friendly_stack', target2: 'friendly_stack', category: 'heal', p: [3, 3, 6, 10],
    immune: UNLIVING,
    effect: { type: 'sacrifice', permanent: true, victimImmune: ['undead', 'war_machine'] },
    d: 'Destroys a friendly living stack to resurrect (Power + victim hit points + {p}) x victim count hit points in another friendly stack.', ai: 90 }),

  // ---- Stat buffs / debuffs -----------------------------------------------------------------
  S({ id: 'bless', name: 'Bless', school: 'water', level: 1, c: [5, 4], target: 'friendly_stack',
    category: 'buff', p: [0, 0, 1, 1], dur: 'power', mass: MASS, immune: ['undead'],
    effect: { type: 'damage_mode', mode: 'max', percent: [0, 0, 3, 3] },
    d: 'The target always deals maximum damage.',
    dm: ['', '', 'Maximum damage +3%.', 'Maximum damage +3%. Affects all friendly stacks.'], ai: 40 }),
  S({ id: 'curse', name: 'Curse', school: 'fire', level: 1, c: [6, 5], target: 'enemy_stack',
    category: 'debuff', p: [0, 0, 1, 1], dur: 'power', mass: MASS, immune: ['undead'],
    effect: { type: 'damage_mode', mode: 'min', percent: [0, 0, -20, -20] },
    d: 'The target always deals minimum damage.',
    dm: ['', '', 'Minimum damage -20%.', 'Minimum damage -20%. Affects all enemy stacks.'], ai: 40 }),
  S({ id: 'bloodlust', name: 'Bloodlust', school: 'fire', level: 1, c: [5, 4], target: 'friendly_stack',
    category: 'buff', p: [3, 3, 6, 6], dur: 'power', mass: MASS,
    effect: stat('attack', 1, { mode: 'melee' }),
    d: 'Increases the target\'s Attack by {p} for melee attacks.', dm: MASS_TXT, ai: 40 }),
  S({ id: 'precision', name: 'Precision', school: 'air', level: 2, c: [8, 6], target: 'friendly_stack',
    category: 'buff', p: [3, 3, 6, 6], dur: 'power', mass: MASS, requires: ['shooter'],
    effect: stat('attack', 1, { mode: 'ranged' }),
    d: 'Increases the target\'s Attack by {p} for ranged attacks.', dm: MASS_TXT, ai: 40 }),
  S({ id: 'weakness', name: 'Weakness', school: 'water', level: 2, c: [8, 6], target: 'enemy_stack',
    category: 'debuff', p: [3, 3, 6, 6], dur: 'power', mass: MASS,
    effect: stat('attack', -1),
    d: 'Reduces the target\'s Attack by {p}.', dm: MASS_TXT, ai: 40 }),
  S({ id: 'stone_skin', name: 'Stone Skin', school: 'earth', level: 1, c: [5, 4], target: 'friendly_stack',
    category: 'buff', p: [3, 3, 6, 6], dur: 'power', mass: MASS,
    effect: stat('defense', 1),
    d: 'Increases the target\'s Defense by {p}.', dm: MASS_TXT, ai: 40 }),
  S({ id: 'disrupting_ray', name: 'Disrupting Ray', school: 'air', level: 2, c: [10, 8], target: 'enemy_stack',
    category: 'debuff', p: [3, 3, 4, 5], dur: 'battle', dispellable: false,
    effect: stat('defense', -1, { stacking: true, min: 0 }),
    d: 'Reduces the target\'s Defense by {p} for the rest of the battle. Stacks with itself and cannot be dispelled.', ai: 40 }),
  S({ id: 'prayer', name: 'Prayer', school: 'water', level: 4, c: [16, 12], target: 'friendly_stack',
    category: 'buff', p: [2, 2, 4, 4], dur: 'power', mass: MASS,
    effect: { type: 'multi', effects: [stat('attack', 1), stat('defense', 1),
      { type: 'speed_mod', op: 'add', sign: 1 }] },
    d: 'Increases the target\'s Attack, Defense and Speed by {p}.', dm: MASS_TXT, ai: 110 }),
  S({ id: 'mirth', name: 'Mirth', school: 'water', level: 3, c: [12, 9], target: 'friendly_stack',
    category: 'buff', p: [1, 1, 2, 2], dur: 'power', mass: MASS, immune: MIND,
    effect: stat('morale', 1),
    d: 'Increases the target\'s Morale by {p}.', dm: MASS_TXT, ai: 40 }),
  S({ id: 'sorrow', name: 'Sorrow', school: 'earth', level: 4, c: [16, 12], target: 'enemy_stack',
    category: 'debuff', p: [1, 1, 2, 2], dur: 'power', mass: MASS, immune: MIND,
    effect: stat('morale', -1),
    d: 'Reduces the target\'s Morale by {p}.', dm: MASS_TXT, ai: 40 }),
  S({ id: 'fortune', name: 'Fortune', school: 'air', level: 2, c: [7, 5], target: 'friendly_stack',
    category: 'buff', p: [1, 1, 2, 2], dur: 'power', mass: MASS,
    effect: stat('luck', 1),
    d: 'Increases the target\'s Luck by {p}.', dm: MASS_TXT, ai: 30 }),
  S({ id: 'misfortune', name: 'Misfortune', school: 'fire', level: 3, c: [12, 9], target: 'enemy_stack',
    category: 'debuff', p: [1, 1, 2, 2], dur: 'power', mass: MASS,
    effect: stat('luck', -1),
    d: 'Reduces the target\'s Luck by {p}.', dm: MASS_TXT, ai: 30 }),
  S({ id: 'haste', name: 'Haste', school: 'air', level: 1, c: [6, 5], target: 'friendly_stack',
    category: 'buff', p: [3, 3, 5, 5], dur: 'power', mass: MASS,
    effect: { type: 'speed_mod', op: 'add', sign: 1 },
    d: 'Increases the target\'s Speed by {p}.', dm: MASS_TXT, ai: 80 }),
  S({ id: 'slow', name: 'Slow', school: 'earth', level: 1, c: [6, 5], target: 'enemy_stack',
    category: 'debuff', p: [25, 25, 50, 50], dur: 'power', mass: MASS,
    effect: { type: 'speed_mod', op: 'percent', sign: -1 },
    d: 'Reduces the target\'s Speed by {p}%.', dm: MASS_TXT, ai: 80 }),
  S({ id: 'slayer', name: 'Slayer', school: 'fire', level: 4, c: [16, 12], target: 'friendly_stack',
    category: 'buff', p: [8, 8, 8, 8], dur: 'power',
    effect: { type: 'slayer', versus: [
      ['dragon', 'behemoth', 'hydra'],
      ['dragon', 'behemoth', 'hydra'],
      ['dragon', 'behemoth', 'hydra', 'angel', 'devil'],
      ['dragon', 'behemoth', 'hydra', 'angel', 'devil', 'titan']] },
    d: 'Increases the target\'s Attack by {p} against dragons, behemoths and hydras.',
    dm: ['', '', 'Also works against angels and devils.', 'Also works against angels, devils and titans.'], ai: 30 }),
  S({ id: 'frenzy', name: 'Frenzy', school: 'fire', level: 4, c: [16, 12], target: 'friendly_stack',
    category: 'buff', p: [100, 100, 150, 200], dur: 1, immune: MIND,
    effect: { type: 'frenzy' },
    d: 'Until its next turn ends the target\'s Defense drops to 0 and its Attack rises by {p}% of the lost Defense.', ai: 40 }),
  S({ id: 'titans_lightning_bolt', name: 'Titan\'s Lightning Bolt', school: 'air', level: 5, c: [0, 0],
    target: 'enemy_stack', category: 'damage', p: [600, 600, 600, 600], pp: 0, special: true,
    effect: dmg('lightning', { fixed: true }),
    immune: ['lightning_immune'], vulnerable: ['lightning_vulnerable'],
    d: 'Deals {p} lightning damage to a single stack. Granted only by Titan\'s Thunder.', ai: 250 }),
  S({ id: 'counterstrike', name: 'Counterstrike', school: 'air', level: 4, c: [24, 20], target: 'friendly_stack',
    category: 'buff', p: [1, 1, 2, 2], dur: 'power', mass: MASS,
    effect: { type: 'extra_retaliation' },
    d: 'The target may retaliate {p} additional time(s) each round.', dm: MASS_TXT, ai: 40 }),

  // ---- Control ------------------------------------------------------------------------------
  S({ id: 'berserk', name: 'Berserk', school: 'fire', level: 4, c: [20, 16], target: 'area',
    category: 'control', p: [0, 0, 1, 2], dur: 1, immune: MIND,
    area: { shape: 'radius', r: [0, 0, 1, 2] },
    effect: { type: 'control', kind: 'berserk', endsOnAttack: true },
    d: 'The affected stack attacks the nearest stack (friend or foe) on its next turn.',
    dm: ['', '', 'Affects all stacks within 1 hex.', 'Affects all stacks within 2 hexes.'], ai: 90 }),
  S({ id: 'hypnotize', name: 'Hypnotize', school: 'air', level: 3, c: [18, 15], target: 'enemy_stack',
    category: 'control', p: [10, 10, 20, 50], pp: 25, dur: 'power', immune: MIND,
    effect: { type: 'control', kind: 'hypnotize', hpLimit: true },
    d: 'Take control of an enemy stack whose total hit points are below {p} + {pp} x Power.', ai: 70 }),
  S({ id: 'forgetfulness', name: 'Forgetfulness', school: 'water', level: 3, c: [12, 9], target: 'enemy_stack',
    category: 'control', p: [50, 50, 100, 100], dur: 'power', mass: MASS, immune: MIND,
    requires: ['shooter'],
    effect: { type: 'control', kind: 'forget' },
    d: '{p}% of the creatures in the target stack forget how to use their ranged attack.',
    dm: ['', '', 'The stack cannot shoot at all.', 'No enemy stack can shoot.'], ai: 50 }),
  S({ id: 'blind', name: 'Blind', school: 'fire', level: 2, c: [10, 8], target: 'enemy_stack',
    category: 'control', p: [50, 50, 25, 0], dur: 'power', immune: [...MIND, 'sightless'],
    effect: { type: 'control', kind: 'blind', breakOnDamage: true, retaliationPercent: [50, 50, 25, 0] },
    d: 'The target cannot act until it is attacked or the spell wears off. When attacked it retaliates at {p}% strength.',
    dm: ['', '', '', 'The blinded stack does not retaliate.'], ai: 90 }),
  S({ id: 'teleport', name: 'Teleport', school: 'water', level: 3, c: [15, 12, 3, 3], target: 'friendly_stack',
    target2: 'hex', category: 'utility', alignment: 'positive', immune: ['war_machine'],
    effect: { type: 'teleport', crossMoat: [false, false, true, true],
      crossWalls: [false, false, false, true] },
    d: 'Instantly moves a friendly stack to any free hex.',
    dm: ['Cannot cross town walls or moat.', 'Cannot cross town walls or moat.',
      'Can cross the moat but not the walls.', 'Can cross walls and moat.'], ai: 50 }),
  S({ id: 'remove_obstacle', name: 'Remove Obstacle', school: 'water', level: 2, c: [7, 5], target: 'obstacle',
    category: 'utility', resistible: false,
    effect: { type: 'remove_obstacle', kinds: [
      ['natural'], ['natural'], ['natural', 'fire_wall'],
      ['natural', 'fire_wall', 'force_field', 'land_mine', 'quicksand']] },
    d: 'Removes a natural obstacle from the battlefield.',
    dm: ['', '', 'Can also remove Fire Walls.', 'Can also remove any magical obstacle.'], ai: 10 }),
  S({ id: 'clone', name: 'Clone', school: 'water', level: 4, c: [24, 20], target: 'friendly_stack',
    category: 'summon', p: [5, 5, 6, 7], dur: 'power', immune: ['war_machine'], dispellable: false,
    effect: { type: 'clone', maxTier: [5, 5, 6, 7] },
    d: 'Creates a copy of a friendly stack of tier {p} or lower. The clone is destroyed by any damage.', ai: 100 }),

  // ---- Summoning ----------------------------------------------------------------------------
  S({ id: 'summon_fire_elemental', name: 'Fire Elemental', school: 'fire', level: 5, c: [25, 20], target: 'none',
    category: 'summon', p: [2, 2, 3, 4],
    effect: { type: 'summon', creatureId: 'fire_elemental', perSpellPower: [2, 2, 3, 4] },
    d: 'Summons {p} x Power fire elementals.', ai: 120 }),
  S({ id: 'summon_earth_elemental', name: 'Earth Elemental', school: 'earth', level: 5, c: [25, 20], target: 'none',
    category: 'summon', p: [2, 2, 3, 4],
    effect: { type: 'summon', creatureId: 'earth_elemental', perSpellPower: [2, 2, 3, 4] },
    d: 'Summons {p} x Power earth elementals.', ai: 120 }),
  S({ id: 'summon_water_elemental', name: 'Water Elemental', school: 'water', level: 5, c: [25, 20], target: 'none',
    category: 'summon', p: [2, 2, 3, 4],
    effect: { type: 'summon', creatureId: 'water_elemental', perSpellPower: [2, 2, 3, 4] },
    d: 'Summons {p} x Power water elementals.', ai: 120 }),
  S({ id: 'summon_air_elemental', name: 'Air Elemental', school: 'air', level: 5, c: [25, 20], target: 'none',
    category: 'summon', p: [2, 2, 3, 4],
    effect: { type: 'summon', creatureId: 'air_elemental', perSpellPower: [2, 2, 3, 4] },
    d: 'Summons {p} x Power air elementals.', ai: 120 }),
];

// ---------------------------------------------------------------------------------------------
// Extra spells (not in the original) — same effect vocabulary
// ---------------------------------------------------------------------------------------------

const EXTRA = [
  S({ id: 'fog', name: 'Fog', school: 'water', level: 1, c: [5, 4], target: 'enemy_stack',
    category: 'debuff', p: [3, 3, 6, 6], dur: 'power', mass: MASS, requires: ['shooter'], extra: true,
    effect: stat('attack', -1, { mode: 'ranged' }),
    d: 'Reduces the target\'s Attack by {p} for ranged attacks.', dm: MASS_TXT, ai: 30 }),
  S({ id: 'thunderclap', name: 'Thunderclap', school: 'air', level: 2, c: [10, 8], target: 'enemy_stack',
    category: 'control', p: [10, 10, 20, 40], pp: 15, dur: 1, extra: true,
    immune: ['lightning_immune', 'war_machine'],
    effect: { type: 'control', kind: 'paralyze', hpLimit: true, breakOnDamage: false,
      retaliationPercent: [100, 100, 100, 100] },
    d: 'Stuns an enemy stack whose total hit points are below {p} + {pp} x Power: it loses its next turn.', ai: 50 }),
  S({ id: 'static_charge', name: 'Static Charge', school: 'air', level: 3, c: [12, 9], target: 'friendly_stack',
    category: 'buff', p: [10, 10, 15, 20], dur: 'power', extra: true,
    effect: { type: 'damage_shield', element: 'lightning' },
    d: 'Melee attackers of the target receive {p}% of the damage they deal as lightning damage.', ai: 40 }),
  S({ id: 'storm', name: 'Storm', school: 'air', level: 4, c: [20, 16], target: 'area',
    category: 'damage', p: [20, 20, 40, 80], pp: 15, area: { shape: 'radius', r: [2, 2, 2, 2] }, extra: true,
    effect: dmg('lightning', { friendlyFire: true }),
    immune: ['lightning_immune'], vulnerable: ['lightning_vulnerable'],
    d: 'Deals {p} + {pp} x Power lightning damage to all stacks within 2 hexes of the target hex.', ai: 100 }),
  S({ id: 'entangle', name: 'Entangle', school: 'earth', level: 2, c: [8, 6], target: 'enemy_stack',
    category: 'control', p: [2, 2, 3, 3], dur: 2, durM: [2, 2, 3, 3], extra: true,
    immune: ['flying', 'war_machine'],
    effect: { type: 'control', kind: 'bind', whileAdjacent: false },
    d: 'Roots a walking enemy stack for {p} rounds: it cannot move but may still attack adjacent stacks, shoot and retaliate.', ai: 50 }),
  S({ id: 'stone_spikes', name: 'Stone Spikes', school: 'earth', level: 2, c: [7, 5], target: 'enemy_stack',
    category: 'damage', p: [10, 10, 20, 40], pp: 15, extra: true, effect: dmg('earth'),
    immune: ['earth_immune', 'flying'], vulnerable: ['earth_vulnerable'],
    d: 'Deals {p} + {pp} x Power damage to a single walking stack.', ai: 35 }),
  S({ id: 'flesh_to_stone', name: 'Flesh to Stone', school: 'earth', level: 4, c: [18, 15], target: 'enemy_stack',
    category: 'control', p: [10, 10, 20, 50], pp: 20, dur: 2, durM: [2, 2, 3, 3], extra: true,
    immune: ['non_living', 'war_machine'],
    effect: { type: 'control', kind: 'stone', hpLimit: true, breakOnDamage: true, damageTakenPercent: 50,
      retaliationPercent: [0, 0, 0, 0] },
    d: 'Petrifies an enemy stack whose total hit points are below {p} + {pp} x Power. It cannot act, takes half damage, and is freed when damaged.',
    dm: ['(2 rounds)', '(2 rounds)', '(3 rounds)', '(3 rounds)'], ai: 80 }),
  S({ id: 'fire_bolt', name: 'Fire Bolt', school: 'fire', level: 2, c: [8, 6], target: 'enemy_stack',
    category: 'damage', p: [10, 10, 20, 50], pp: 20, extra: true, effect: dmg('fire'),
    vulnerable: ['fire_vulnerable'],
    d: 'Deals {p} + {pp} x Power fire damage to a single stack.', ai: 40 }),
  S({ id: 'melt_armor', name: 'Melt Armor', school: 'fire', level: 2, c: [8, 6], target: 'enemy_stack',
    category: 'debuff', p: [3, 3, 6, 6], dur: 'power', mass: MASS, extra: true,
    effect: stat('defense', -1),
    d: 'Reduces the target\'s Defense by {p}.', dm: MASS_TXT, ai: 40 }),
  S({ id: 'immolation', name: 'Immolation', school: 'fire', level: 3, c: [12, 9], target: 'enemy_stack',
    category: 'damage', p: [10, 10, 20, 30], pp: 5, dur: 3, extra: true,
    vulnerable: ['fire_vulnerable'],
    effect: { type: 'damage_over_time', element: 'fire', tick: 'round_start', immediate: true },
    d: 'Sets a stack ablaze: {p} + {pp} x Power fire damage now and at the start of each of the next 2 rounds.', ai: 50 }),
  S({ id: 'regeneration', name: 'Regeneration', school: 'water', level: 2, c: [8, 6], target: 'friendly_stack',
    category: 'heal', p: [10, 10, 20, 30], pp: 5, dur: 3, extra: true, immune: UNLIVING,
    effect: { type: 'heal_over_time', tick: 'round_start', immediate: true },
    d: 'Heals {p} + {pp} x Power hit points of the top creature now and at the start of each of the next 2 rounds.', ai: 35 }),
  S({ id: 'tidal_wave', name: 'Tidal Wave', school: 'water', level: 5, c: [22, 18], target: 'all_enemies',
    category: 'damage', p: [30, 30, 60, 120], pp: 20, extra: true, effect: dmg('cold'),
    immune: ['cold_immune'], vulnerable: ['cold_vulnerable'],
    d: 'Deals {p} + {pp} x Power cold damage to every enemy stack.', ai: 140 }),
];

// ---------------------------------------------------------------------------------------------
// Creature-only effects. Never castable by heroes; triggered by creature abilities.
// `power`/`perPower` use the same formula with "spell power" replaced by what the ability says
// (usually 0); `effect.perAttacker` means the value is multiplied by the attacking stack's count.
// ---------------------------------------------------------------------------------------------

const C = (o) => S({ c: [0, 0], creatureOnly: true, resistible: false, target: 'enemy_stack', ...o });

const CREATURE_ONLY = [
  C({ id: 'poison', name: 'Poison', school: 'earth', level: 2, category: 'debuff', p: [10, 10, 10, 10],
    dur: 3, chance: 30, immune: UNLIVING,
    effect: { type: 'max_hp_mod', op: 'percent', sign: -1, perRound: true, floorPercent: 50 },
    d: 'Each round for 3 rounds the stack\'s maximum hit points drop by {p}% of the original value (down to 50%).', ai: 0 }),
  C({ id: 'disease', name: 'Disease', school: 'earth', level: 2, category: 'debuff', p: [2, 2, 2, 2],
    dur: 3, chance: 20, immune: UNLIVING,
    effect: { type: 'multi', effects: [stat('attack', -1), stat('defense', -1)] },
    d: 'Reduces Attack and Defense by {p} for 3 rounds.', ai: 0 }),
  C({ id: 'age', name: 'Aging', school: 'earth', level: 3, category: 'debuff', p: [50, 50, 50, 50],
    dur: 3, chance: 20, immune: UNLIVING,
    effect: { type: 'max_hp_mod', op: 'percent', sign: -1, perRound: false, floorPercent: 50 },
    d: 'Reduces the maximum hit points of every creature in the stack by {p}% for 3 rounds.', ai: 0 }),
  C({ id: 'paralyze', name: 'Paralyzing Venom', school: 'earth', level: 3, category: 'control',
    p: [25, 25, 25, 25], dur: 3, chance: 20, immune: ['war_machine'],
    effect: { type: 'control', kind: 'paralyze', breakOnDamage: true,
      retaliationPercent: [25, 25, 25, 25] },
    d: 'The stack cannot act for 3 rounds or until attacked; it retaliates at {p}% strength.', ai: 0 }),
  C({ id: 'petrify', name: 'Stone Gaze', school: 'earth', level: 3, category: 'control',
    p: [50, 50, 50, 50], dur: 3, chance: 20, immune: ['sightless', 'war_machine'],
    effect: { type: 'control', kind: 'stone', breakOnDamage: true, damageTakenPercent: 50,
      retaliationPercent: [0, 0, 0, 0] },
    d: 'The stack turns to stone for 3 rounds or until attacked; it takes {p}% damage and cannot retaliate.', ai: 0 }),
  C({ id: 'bind', name: 'Binding Roots', school: 'earth', level: 1, category: 'control',
    dur: 'battle', chance: 100, immune: ['war_machine'], dispellable: false,
    effect: { type: 'control', kind: 'bind', whileAdjacent: true },
    d: 'The stack cannot move while the binding creature stays adjacent to it.', ai: 0 }),
  C({ id: 'acid_breath', name: 'Acid Breath', school: 'earth', level: 3, category: 'debuff',
    p: [3, 3, 3, 3], dur: 'battle', chance: 100, dispellable: false, immune: ['war_machine'],
    effect: { type: 'multi', effects: [
      stat('defense', -1, { stacking: true, min: 0 }),
      { type: 'damage', element: null, value: [25, 25, 25, 25], perAttacker: true, chance: 30 }] },
    d: 'Reduces Defense by {p} for the rest of the battle (stacks). 30% chance of 25 extra damage per attacker.', ai: 0 }),
  C({ id: 'thunderbolt', name: 'Thunderbolt', school: 'air', level: 2, category: 'damage',
    p: [10, 10, 10, 10], chance: 20, immune: ['lightning_immune'], vulnerable: ['lightning_vulnerable'],
    effect: dmg('lightning', { perAttacker: true }),
    d: 'A bolt of lightning deals {p} damage per attacking creature.', ai: 0 }),
  C({ id: 'death_cloud', name: 'Death Cloud', school: 'earth', level: 3, category: 'damage', target: 'area',
    chance: 100, area: { shape: 'radius', r: [1, 1, 1, 1] }, immune: ['undead'],
    effect: dmg(null, { useAttackDamage: true, friendlyFire: true }),
    d: 'The ranged attack also hits every living stack adjacent to the target.', ai: 0 }),
  C({ id: 'fireball_attack', name: 'Fireball Attack', school: 'fire', level: 3, category: 'damage',
    target: 'area', chance: 100, area: { shape: 'radius', r: [1, 1, 1, 1] },
    vulnerable: ['fire_vulnerable'],
    effect: dmg('fire', { useAttackDamage: true, friendlyFire: true }),
    d: 'The ranged attack also hits every stack adjacent to the target.', ai: 0 }),
  C({ id: 'death_stare', name: 'Death Stare', school: 'earth', level: 4, category: 'damage',
    p: [10, 10, 10, 10], chance: 100, immune: UNLIVING,
    effect: { type: 'instant_kill', percentPerAttacker: 10, maxKillsPerAttackers: 10 },
    d: 'Each attacker has a {p}% chance to kill one creature outright (at most one kill per 10 attackers, rounded up).', ai: 0 }),
  C({ id: 'fear', name: 'Fear', school: 'all', level: 4, category: 'control', dur: 1, chance: 10,
    immune: MIND, effect: { type: 'control', kind: 'fear' },
    d: 'The stack is frozen with fear and loses its turn.', ai: 0 }),
  C({ id: 'dispel_helpful', name: 'Dispel Helpful Spells', school: 'water', level: 1, category: 'utility',
    chance: 100, effect: { type: 'dispel', which: 'positive', obstacles: [false, false, false, false] },
    d: 'Removes all beneficial spell effects from the attacked stack.', ai: 0 }),
  C({ id: 'drain_life', name: 'Drain Life', school: 'earth', level: 3, category: 'heal',
    alignment: 'neutral', p: [100, 100, 100, 100], chance: 100, immune: UNLIVING,
    effect: { type: 'life_drain', resurrects: true, permanent: true },
    d: 'The attacker restores hit points equal to {p}% of the damage dealt to living creatures, resurrecting its dead.', ai: 0 }),
  C({ id: 'raise_demons', name: 'Raise Demons', school: 'fire', level: 4, category: 'summon',
    target: 'dead_friendly_stack', p: [50, 50, 50, 50], chance: 100, immune: UNLIVING,
    effect: { type: 'resurrect', permanent: [true, true, true, true], asCreatureId: 'demon',
      perAttacker: true, maxCountFromCorpses: true, oncePerBattle: true },
    d: 'Once per battle turns a dead friendly stack into demons: {p} hit points per caster, never more demons than corpses.', ai: 0 }),
  C({ id: 'rebirth', name: 'Rebirth', school: 'fire', level: 5, category: 'heal',
    target: 'none', p: [20, 20, 20, 20], chance: 100,
    effect: { type: 'resurrect', permanent: [true, true, true, true], self: true,
      percentOfStack: true, oncePerBattle: true },
    d: 'Once per battle when the stack is destroyed, {p}% of its creatures (at least 1) rise again.', ai: 0 }),
];

// ---------------------------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------------------------

export const SPELLS = [...ORIGINAL, ...EXTRA, ...CREATURE_ONLY];
export const SPELL_BY_ID = Object.fromEntries(SPELLS.map((s) => [s.id, s]));

/** @returns {Spell} */
export function getSpell(id) {
  const spell = SPELL_BY_ID[id];
  if (!spell) throw new Error(`Unknown spell: ${id}`);
  return spell;
}

/** Spells a hero can have in a spellbook (no creature-only effects). */
export const HERO_SPELLS = SPELLS.filter((s) => !s.creatureOnly);
/** The 70 spells of the original game. */
export const ORIGINAL_SPELLS = SPELLS.filter((s) => !s.creatureOnly && !s.extra);
export const EXTRA_SPELLS = SPELLS.filter((s) => s.extra);
export const CREATURE_ONLY_SPELLS = SPELLS.filter((s) => s.creatureOnly);
export const COMBAT_SPELLS = HERO_SPELLS.filter((s) => s.kind === 'combat');
export const ADVENTURE_SPELLS = HERO_SPELLS.filter((s) => s.kind === 'adventure');

/** Hero spells of a school. `'all'`-school spells belong to every school unless strict. */
export function spellsOfSchool(school, { strict = false } = {}) {
  return HERO_SPELLS.filter((s) => s.school === school || (!strict && s.school === 'all'));
}

export function spellsOfLevel(level) {
  return HERO_SPELLS.filter((s) => s.level === level);
}

/** Schools whose mastery applies to the spell ('all' => every school). */
export function spellSchools(spell) {
  return spell.school === 'all' ? [...SPELL_SCHOOLS] : [spell.school];
}

/**
 * Mastery with which a hero casts a spell: the best mastery among the spell's schools.
 * @param {Spell} spell
 * @param {{air?:number, earth?:number, fire?:number, water?:number}} schoolMastery
 */
export function castingMastery(spell, schoolMastery = {}) {
  return Math.max(0, ...spellSchools(spell).map((s) => schoolMastery[s] ?? 0));
}

function clampMastery(mastery) {
  return Math.max(MASTERY.NONE, Math.min(MASTERY.EXPERT, mastery | 0));
}

/** Mana cost at a mastery, plus a flat delta from `spell_cost` bonuses (never below 1 unless free). */
export function spellCost(spell, mastery = MASTERY.NONE, delta = 0) {
  const base = spell.costByMastery[clampMastery(mastery)];
  if (base === 0) return 0;
  return Math.max(1, base + delta);
}

/** Generic value: power[mastery] + perPower * spellPower (before any multipliers). */
export function spellValue(spell, mastery = MASTERY.NONE, spellPower = 0) {
  return spell.power[clampMastery(mastery)] + spell.perPower * spellPower;
}

/**
 * Duration in rounds (combat) for a cast; null = instant, Infinity = whole battle / day.
 * @param {number} extraRounds sum of `spell_duration` bonuses (only applied to 'power' durations)
 */
export function spellDuration(spell, mastery = MASTERY.NONE, spellPower = 1, extraRounds = 0) {
  const d = spell.duration;
  if (d === null) return null;
  if (d === 'battle' || d === 'day') return Infinity;
  if (d === 'power') return Math.max(1, spellPower + extraRounds);
  return spell.durationByMastery ? spell.durationByMastery[clampMastery(mastery)] : d;
}

export function isMass(spell, mastery = MASTERY.NONE) {
  return spell.massAt !== null && clampMastery(mastery) >= spell.massAt;
}

/** Target selection mode actually used at a mastery (mass spells stop asking for a stack). */
export function effectiveTarget(spell, mastery = MASTERY.NONE) {
  const m = clampMastery(mastery);
  if (spell.targetByMastery) return spell.targetByMastery[m];
  if (!isMass(spell, m)) return spell.target;
  if (spell.target === 'friendly_stack') return 'all_friendly';
  if (spell.target === 'enemy_stack') return 'all_enemies';
  if (spell.target === 'any_stack') return 'all';
  return spell.target;
}

/**
 * Tag-level immunity check (does NOT include level immunity, resistance rolls, Anti-Magic or
 * artifacts — see docs/mechanics/spells.md §5 for the full pipeline).
 * @param {Spell} spell
 * @param {string[]} tags creature tags of the stack (IMMUNITY_TAGS / VULNERABILITY_TAGS)
 * @returns {boolean} true when the spell can affect a stack with these tags
 */
export function spellAffectsTags(spell, tags) {
  if (spell.requires.some((t) => !tags.includes(t))) return false;
  if (spell.immune.some((t) => tags.includes(t))) return false;
  // War machines can only be hurt (or dispelled); they never receive other effects.
  if (tags.includes('war_machine') && !['damage', 'dispel'].includes(spell.effect.type)) return false;
  return true;
}

/** Damage multiplier from elemental vulnerability tags (2 when vulnerable, else 1). */
export function vulnerabilityMultiplier(spell, tags) {
  return spell.vulnerable.some((t) => tags.includes(t)) ? 2 : 1;
}

/** Wisdom level (0 none .. 3 expert) required to learn a spell of the given level. */
export function wisdomRequired(level) {
  return Math.max(0, level - 2);
}

// ---------------------------------------------------------------------------------------------
// Mage guilds
// ---------------------------------------------------------------------------------------------

/** Number of spells offered per guild level (index 0 = level 1). Tower's Library adds +1 each. */
export const GUILD_SPELLS_PER_LEVEL = [5, 4, 3, 2, 1];

/** Highest mage guild level a town type can build. */
export const MAGE_GUILD_MAX_LEVEL = {
  castle: 4, rampart: 5, tower: 5, inferno: 5, necropolis: 5, dungeon: 5,
  stronghold: 3, fortress: 3, conflux: 5, cove: 4, factory: 5,
};

/** Spells that never appear in a town type's guild. */
export const MAGE_GUILD_BANS = {
  castle: ['armageddon', 'animate_dead', 'death_ripple'],
  rampart: ['armageddon', 'animate_dead', 'death_ripple'],
  tower: ['animate_dead', 'death_ripple'],
  inferno: ['bless', 'cure', 'prayer', 'regeneration'],
  necropolis: ['bless', 'cure', 'prayer', 'destroy_undead', 'regeneration'],
  dungeon: ['bless', 'prayer'],
  stronghold: ['animate_dead'],
  fortress: ['animate_dead'],
  conflux: [],
  cove: ['animate_dead', 'armageddon'],
  factory: ['animate_dead', 'death_ripple'],
};

/** Relative weight (10 = neutral) with which a town type rolls spells of each school. */
export const MAGE_GUILD_SCHOOL_WEIGHTS = {
  castle: { air: 10, earth: 10, fire: 6, water: 14 },
  rampart: { air: 8, earth: 14, fire: 6, water: 12 },
  tower: { air: 14, earth: 10, fire: 8, water: 10 },
  inferno: { air: 10, earth: 10, fire: 15, water: 6 },
  necropolis: { air: 10, earth: 14, fire: 10, water: 7 },
  dungeon: { air: 12, earth: 10, fire: 12, water: 7 },
  stronghold: { air: 10, earth: 10, fire: 12, water: 8 },
  fortress: { air: 8, earth: 12, fire: 8, water: 12 },
  conflux: { air: 10, earth: 10, fire: 10, water: 10 },
  cove: { air: 12, earth: 8, fire: 7, water: 15 },
  factory: { air: 11, earth: 11, fire: 11, water: 8 },
};

/** Per-spell weight overrides `{ [spellId]: { [faction|'*']: weight } }` (rare / common spells). */
export const MAGE_GUILD_SPELL_WEIGHTS = {
  magic_arrow: { '*': 20 },
  dimension_door: { '*': 6 },
  fly: { '*': 6 },
  town_portal: { '*': 8 },
  implosion: { '*': 8 },
  armageddon: { '*': 6, inferno: 12, dungeon: 12 },
  animate_dead: { '*': 4, necropolis: 20 },
  death_ripple: { '*': 4, necropolis: 20 },
  destroy_undead: { '*': 6, castle: 12 },
  resurrection: { '*': 10, necropolis: 3 },
  summon_boat: { cove: 20 },
  scuttle_boat: { cove: 14 },
};

function assertFaction(faction) {
  if (!FACTIONS.includes(faction)) throw new Error(`Unknown faction: ${faction}`);
}

/** Roll weight of a spell in a town type's guild; 0 = can never appear. */
export function guildWeight(spell, faction) {
  assertFaction(faction);
  if (!spell.guild) return 0;
  if (spell.level > MAGE_GUILD_MAX_LEVEL[faction]) return 0;
  if (MAGE_GUILD_BANS[faction].includes(spell.id)) return 0;
  const override = MAGE_GUILD_SPELL_WEIGHTS[spell.id];
  if (override && override[faction] !== undefined) return override[faction];
  if (override && override['*'] !== undefined) return override['*'];
  return spell.school === 'all' ? 10 : MAGE_GUILD_SCHOOL_WEIGHTS[faction][spell.school];
}

export function spellAllowedInGuild(spell, faction) {
  return guildWeight(spell, faction) > 0;
}

/** All spells that can appear at a guild level of a town type. */
export function guildSpellPool(faction, level) {
  return HERO_SPELLS.filter((s) => s.level === level && guildWeight(s, faction) > 0);
}

/**
 * Roll the spells of one guild level: weighted picks without replacement.
 * @param {string} faction
 * @param {number} level 1..5
 * @param {{s:number}} rng state rng (src/core/rng.js)
 * @param {number} [count] defaults to GUILD_SPELLS_PER_LEVEL
 * @param {string[]} [exclude] spell ids already present in the guild
 * @returns {string[]} spell ids
 */
export function rollGuildLevel(faction, level, rng, count = GUILD_SPELLS_PER_LEVEL[level - 1], exclude = []) {
  const pool = guildSpellPool(faction, level).filter((s) => !exclude.includes(s.id));
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    const spell = weightedPick(rng, pool, pool.map((s) => guildWeight(s, faction)));
    picked.push(spell.id);
    pool.splice(pool.indexOf(spell), 1);
  }
  return picked;
}

/**
 * Roll a whole guild: `[ [ids level 1], ..., [ids level 5] ]` (levels above the town's maximum are
 * empty). `extraPerLevel` = 1 for Tower's Library.
 */
export function rollMageGuild(faction, rng, extraPerLevel = 0) {
  assertFaction(faction);
  const guild = [];
  for (let level = 1; level <= 5; level++) {
    if (level > MAGE_GUILD_MAX_LEVEL[faction]) { guild.push([]); continue; }
    guild.push(rollGuildLevel(faction, level, rng, GUILD_SPELLS_PER_LEVEL[level - 1] + extraPerLevel));
  }
  return guild;
}
