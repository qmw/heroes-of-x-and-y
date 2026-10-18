// Artifact catalogue. Schema: docs/DESIGN.md §3, semantics of every bonus: docs/mechanics/artifacts.md.
//
// Artifact = {
//   id, name, slot (ARTIFACT_SLOTS), class: 'treasure'|'minor'|'major'|'relic'|'combo'|'special',
//   cost (gold value), bonuses: Bonus[], description,
//   components?: artifactId[]   // combination artifacts; `bonuses` are the EXTRA bonuses of the
//                               // assembled set, the components' own bonuses still apply on top
//   slotIndex?: number          // fixed index inside the slot (war machines)
//   extra?: true                // not in the original game (H3online addition)
//   origin: 'sod'|'hota'|'extra'
//   noRandom?: true             // never produced by pickRandomArtifact
//   noBackpack?: true           // can only sit in its slot (spellbook, war machines)
//   backpackOnly?: true         // can never be equipped (Grail)
//   noTransfer?: true           // cannot be traded / captured (spellbook, catapult, Grail)
//   instanced?: true            // entries are objects {id, spellId} (spell scroll)
// }

import { ARTIFACT_SLOTS, PRIMARY_SKILLS, SPELL_SCHOOLS } from '../core/constants.js';
import { FACTIONS_DATA } from './factions.js';

/** Angelic Alliance: every good and neutral town, plus neutral (town-less) creatures, count as one group. */
const GOOD_AND_NEUTRAL = [...FACTIONS_DATA.filter((f) => f.alignment !== 'evil').map((f) => f.id), 'neutral'];

export const ARTIFACT_CLASSES = ['treasure', 'minor', 'major', 'relic', 'combo', 'special'];
/** Classes that can be found at random on the map / in merchants. */
export const RANDOM_ARTIFACT_CLASSES = ['treasure', 'minor', 'major', 'relic'];
export const SPELL_SCROLL_ID = 'spell_scroll';
/** Gold value of a spell scroll by spell level (index = level). */
export const SCROLL_COST_BY_LEVEL = [0, 500, 2000, 3000, 8000, 10000];

// ---- bonus shorthands ------------------------------------------------------------------------
const prim = (stat, value) => ({ type: 'primary', stat, value });
const atk = (v) => prim('attack', v);
const def = (v) => prim('defense', v);
const pow = (v) => prim('power', v);
const kno = (v) => prim('knowledge', v);
const allPrim = (v) => PRIMARY_SKILLS.map((s) => prim(s, v));
const morale = (value) => ({ type: 'morale', value });
const luck = (value) => ({ type: 'luck', value });
const income = (resource, value) => ({ type: 'resource_income', resource, value });
const immune = (spellId) => ({ type: 'spell_immunity', spellId, side: 'own' });
const startCast = (spellId, target, power) => ({ type: 'combat_start_cast', spellId, mastery: 3, power, target });
const LIVING_ONLY = ['undead', 'non_living'];
/** Creatures of "dragon nature" (Vial of Dragon Blood): not wyverns or drakes. */
const DRAGONS = ['green_dragon', 'gold_dragon', 'red_dragon', 'black_dragon', 'bone_dragon', 'ghost_dragon',
  'faerie_dragon', 'rust_dragon', 'crystal_dragon', 'azure_dragon'];

function describeBonus(b) {
  const sign = (v) => (v >= 0 ? `+${v}` : `${v}`);
  switch (b.type) {
    case 'primary': return `${sign(b.value)} ${b.stat}`;
    case 'morale': return `${sign(b.value)} morale`;
    case 'luck': return `${sign(b.value)} luck`;
    case 'enemy_morale': return `${sign(b.value)} enemy morale`;
    case 'enemy_luck': return `${sign(b.value)} enemy luck`;
    case 'resource_income': return `${sign(b.value)} ${b.resource} per day`;
    case 'necromancy_percent': return `${sign(b.percent)}% necromancy`;
    case 'magic_resistance': return `${sign(b.percent)}% magic resistance`;
    case 'eagle_eye': return `${sign(b.percent)}% eagle eye`;
    case 'mana_regen': return `${sign(b.value)} spell points per day`;
    case 'spell_duration': return `${sign(b.value)} rounds of spell duration`;
    case 'sight_radius': return `${sign(b.value)} scouting radius`;
    case 'surrender_cost_percent': return `${sign(b.percent)}% surrender cost`;
    case 'enemy_spell_power_percent': return `${sign(b.percent)}% enemy spell power`;
    case 'spell_immunity': return b.spellId ? `immunity to ${b.spellId.replace(/_/g, ' ')}` : 'spell immunity';
    case 'spell_power_percent': return `${sign(b.percent)}% ${b.school ? b.school + ' ' : ''}spell damage`;
    case 'movement_land': return b.percent != null ? `${sign(b.percent)}% land movement` : `${sign(b.value)} land movement points`;
    case 'movement_sea': return b.percent != null ? `${sign(b.percent)}% sea movement` : `${sign(b.value)} sea movement points`;
    case 'damage_percent': return `${sign(b.percent)}% ${b.mode} damage`;
    case 'creature_stat': return `${b.percent != null ? sign(b.percent) + '%' : sign(b.value)} creature ${b.stat}`;
    case 'creature_growth':
      return `${b.percent != null ? sign(b.percent) + '%' : sign(b.value)} weekly growth${b.tier ? ` of level ${b.tier} creatures` : ''}`;
    default: return b.type.replace(/_/g, ' ');
  }
}

function make(origin, id, name, slot, cls, cost, bonuses, description, more) {
  const art = {
    id, name, slot, class: cls, cost, bonuses,
    description: description || `${bonuses.map(describeBonus).join(', ')}.`,
    origin,
  };
  if (origin === 'extra') art.extra = true;
  return Object.assign(art, more || {});
}
const sod = (...args) => make('sod', ...args);
const hota = (...args) => make('hota', ...args);
const extra = (...args) => make('extra', ...args);

// ---- the catalogue ---------------------------------------------------------------------------
const BASE = [
  // -- special ---------------------------------------------------------------------------------
  sod('spellbook', 'Spell Book', 'spellbook', 'special', 500, [{ type: 'spellbook' }],
    'Allows the hero to learn and cast spells.', { noRandom: true, noBackpack: true, noTransfer: true }),
  sod('spell_scroll', 'Spell Scroll', 'misc', 'special', 2000, [{ type: 'grants_spell', fromInstance: true }],
    'While equipped, the hero can cast the spell written on the scroll.', { noRandom: true, instanced: true }),
  sod('grail', 'Grail', 'misc', 'special', 0, [{ type: 'grail' }],
    'Bring it to a town to build the ultimate structure.', { noRandom: true, backpackOnly: true, noTransfer: true }),
  sod('catapult', 'Catapult', 'war_machine', 'special', 0, [{ type: 'war_machine', creatureId: 'catapult' }],
    'Destroys walls during sieges.', { noRandom: true, noBackpack: true, noTransfer: true, slotIndex: 3 }),
  sod('ballista', 'Ballista', 'war_machine', 'special', 2500, [{ type: 'war_machine', creatureId: 'ballista' }],
    'Shoots at enemy troops in combat.', { noRandom: true, noBackpack: true, slotIndex: 0 }),
  sod('ammo_cart', 'Ammo Cart', 'war_machine', 'special', 1000, [{ type: 'war_machine', creatureId: 'ammo_cart' }],
    'Provides unlimited shots to your shooters.', { noRandom: true, noBackpack: true, slotIndex: 1 }),
  sod('first_aid_tent', 'First Aid Tent', 'war_machine', 'special', 750, [{ type: 'war_machine', creatureId: 'first_aid_tent' }],
    'Heals a friendly stack every round.', { noRandom: true, noBackpack: true, slotIndex: 2 }),
  hota('cannon', 'Cannon', 'war_machine', 'special', 4000, [{ type: 'war_machine', creatureId: 'cannon' }],
    'A heavier ballista that can also batter walls. Occupies the ballista slot.', { noRandom: true, noBackpack: true, slotIndex: 0 }),

  // -- weapons (attack) ------------------------------------------------------------------------
  sod('centaurs_axe', "Centaur's Axe", 'right_hand', 'treasure', 2000, [atk(2)]),
  sod('blackshard_of_the_dead_knight', 'Blackshard of the Dead Knight', 'right_hand', 'minor', 3000, [atk(3)]),
  sod('greater_gnolls_flail', "Greater Gnoll's Flail", 'right_hand', 'minor', 4000, [atk(4)]),
  sod('ogres_club_of_havoc', "Ogre's Club of Havoc", 'right_hand', 'major', 5000, [atk(5)]),
  sod('sword_of_hellfire', 'Sword of Hellfire', 'right_hand', 'major', 6000, [atk(6)]),
  sod('titans_gladius', "Titan's Gladius", 'right_hand', 'relic', 10000, [atk(12), def(-3)]),

  // -- shields (defense) -----------------------------------------------------------------------
  sod('shield_of_the_dwarven_lords', 'Shield of the Dwarven Lords', 'left_hand', 'treasure', 2000, [def(2)]),
  sod('shield_of_the_yawning_dead', 'Shield of the Yawning Dead', 'left_hand', 'minor', 3000, [def(3)]),
  sod('buckler_of_the_gnoll_king', 'Buckler of the Gnoll King', 'left_hand', 'minor', 4000, [def(4)]),
  sod('targ_of_the_rampaging_ogre', 'Targ of the Rampaging Ogre', 'left_hand', 'major', 5000, [def(5)]),
  sod('shield_of_the_damned', 'Shield of the Damned', 'left_hand', 'major', 6000, [def(6)]),
  sod('sentinels_shield', "Sentinel's Shield", 'left_hand', 'relic', 10000, [def(12), atk(-3)]),

  // -- helmets (knowledge) ---------------------------------------------------------------------
  sod('helm_of_the_alabaster_unicorn', 'Helm of the Alabaster Unicorn', 'head', 'treasure', 1000, [kno(1)]),
  sod('skull_helmet', 'Skull Helmet', 'head', 'treasure', 3000, [kno(2)]),
  sod('helm_of_chaos', 'Helm of Chaos', 'head', 'minor', 4000, [kno(3)]),
  sod('crown_of_the_supreme_magi', 'Crown of the Supreme Magi', 'head', 'minor', 5000, [kno(4)]),
  sod('hellstorm_helmet', 'Hellstorm Helmet', 'head', 'major', 6000, [kno(5)]),
  sod('thunder_helmet', 'Thunder Helmet', 'head', 'relic', 10000, [kno(10), pow(-2)]),

  // -- armour (spell power) --------------------------------------------------------------------
  sod('breastplate_of_petrified_wood', 'Breastplate of Petrified Wood', 'torso', 'treasure', 1000, [pow(1)]),
  sod('rib_cage', 'Rib Cage', 'torso', 'minor', 3000, [pow(2)]),
  sod('scales_of_the_greater_basilisk', 'Scales of the Greater Basilisk', 'torso', 'minor', 4000, [pow(3)]),
  sod('tunic_of_the_cyclops_king', 'Tunic of the Cyclops King', 'torso', 'major', 5000, [pow(4)]),
  sod('breastplate_of_brimstone', 'Breastplate of Brimstone', 'torso', 'major', 6000, [pow(5)]),
  sod('titans_cuirass', "Titan's Cuirass", 'torso', 'relic', 10000, [pow(10), kno(-2)]),

  // -- all primary skills (Angelic Alliance pieces) --------------------------------------------
  sod('armor_of_wonder', 'Armor of Wonder', 'torso', 'minor', 4000, allPrim(1)),
  sod('sandals_of_the_saint', 'Sandals of the Saint', 'feet', 'relic', 8000, allPrim(2)),
  sod('celestial_necklace_of_bliss', 'Celestial Necklace of Bliss', 'neck', 'relic', 12000, allPrim(3)),
  sod('lions_shield_of_courage', "Lion's Shield of Courage", 'left_hand', 'relic', 16000, allPrim(4)),
  sod('sword_of_judgement', 'Sword of Judgement', 'right_hand', 'relic', 20000, allPrim(5)),
  sod('helm_of_heavenly_enlightenment', 'Helm of Heavenly Enlightenment', 'head', 'relic', 24000, allPrim(6)),

  // -- dragon set ------------------------------------------------------------------------------
  sod('quiet_eye_of_the_dragon', 'Quiet Eye of the Dragon', 'ring', 'treasure', 2000, [atk(1), def(1)]),
  sod('red_dragon_flame_tongue', 'Red Dragon Flame Tongue', 'right_hand', 'minor', 4000, [atk(2), def(2)]),
  sod('dragon_scale_shield', 'Dragon Scale Shield', 'left_hand', 'major', 6000, [atk(3), def(3)]),
  sod('dragon_scale_armor', 'Dragon Scale Armor', 'torso', 'relic', 8000, [atk(4), def(4)]),
  sod('dragonbone_greaves', 'Dragonbone Greaves', 'feet', 'treasure', 2000, [pow(1), kno(1)]),
  sod('dragon_wing_tabard', 'Dragon Wing Tabard', 'shoulders', 'minor', 4000, [pow(2), kno(2)]),
  sod('necklace_of_dragonteeth', 'Necklace of Dragonteeth', 'neck', 'major', 6000, [pow(3), kno(3)]),
  sod('crown_of_dragontooth', 'Crown of Dragontooth', 'head', 'relic', 8000, [pow(4), kno(4)]),
  sod('still_eye_of_the_dragon', 'Still Eye of the Dragon', 'ring', 'treasure', 2000, [morale(1), luck(1)]),

  // -- luck / morale ---------------------------------------------------------------------------
  sod('clover_of_fortune', 'Clover of Fortune', 'misc', 'treasure', 1000, [luck(1)]),
  sod('cards_of_prophecy', 'Cards of Prophecy', 'misc', 'treasure', 1000, [luck(1)]),
  sod('ladybird_of_luck', 'Ladybird of Luck', 'misc', 'treasure', 1000, [luck(1)]),
  sod('badge_of_courage', 'Badge of Courage', 'misc', 'treasure', 1000, [morale(1)]),
  sod('crest_of_valor', 'Crest of Valor', 'misc', 'treasure', 1000, [morale(1)]),
  sod('glyph_of_gallantry', 'Glyph of Gallantry', 'misc', 'treasure', 1000, [morale(1)]),
  sod('pendant_of_courage', 'Pendant of Courage', 'neck', 'major', 7000, [morale(3), luck(3)]),
  sod('spirit_of_oppression', 'Spirit of Oppression', 'misc', 'treasure', 2000, [{ type: 'block_positive_morale', side: 'both' }],
    'No stack on either side can receive a positive morale roll.'),
  sod('hourglass_of_the_evil_hour', 'Hourglass of the Evil Hour', 'misc', 'treasure', 2000, [{ type: 'block_positive_luck', side: 'both' }],
    'No stack on either side can receive a positive luck roll.'),

  // -- scouting --------------------------------------------------------------------------------
  sod('speculum', 'Speculum', 'misc', 'treasure', 1000, [{ type: 'sight_radius', value: 1 }]),
  sod('spyglass', 'Spyglass', 'misc', 'treasure', 1000, [{ type: 'sight_radius', value: 1 }]),

  // -- necromancy ------------------------------------------------------------------------------
  sod('amulet_of_the_undertaker', 'Amulet of the Undertaker', 'neck', 'treasure', 2000, [{ type: 'necromancy_percent', percent: 5 }]),
  sod('vampires_cowl', "Vampire's Cowl", 'shoulders', 'minor', 4000, [{ type: 'necromancy_percent', percent: 10 }]),
  sod('dead_mans_boots', "Dead Man's Boots", 'feet', 'major', 6000, [{ type: 'necromancy_percent', percent: 15 }]),

  // -- magic resistance ------------------------------------------------------------------------
  sod('garniture_of_interference', 'Garniture of Interference', 'neck', 'major', 2000, [{ type: 'magic_resistance', percent: 5 }]),
  sod('surcoat_of_counterpoise', 'Surcoat of Counterpoise', 'shoulders', 'major', 4000, [{ type: 'magic_resistance', percent: 10 }]),
  sod('boots_of_polarity', 'Boots of Polarity', 'feet', 'relic', 6000, [{ type: 'magic_resistance', percent: 15 }]),

  // -- archery ---------------------------------------------------------------------------------
  sod('bow_of_elven_cherrywood', 'Bow of Elven Cherrywood', 'misc', 'treasure', 2000, [{ type: 'damage_percent', mode: 'ranged', percent: 5 }]),
  sod('bowstring_of_the_unicorns_mane', "Bowstring of the Unicorn's Mane", 'misc', 'minor', 4000, [{ type: 'damage_percent', mode: 'ranged', percent: 10 }]),
  sod('angel_feather_arrows', 'Angel Feather Arrows', 'misc', 'major', 6000, [{ type: 'damage_percent', mode: 'ranged', percent: 15 }]),
  sod('golden_bow', 'Golden Bow', 'misc', 'major', 8000, [{ type: 'no_range_penalty' }, { type: 'no_obstacle_penalty' }],
    'Your shooters suffer no range penalty and no obstacle (wall) penalty.'),

  // -- eagle eye -------------------------------------------------------------------------------
  sod('bird_of_perception', 'Bird of Perception', 'misc', 'treasure', 1000, [{ type: 'eagle_eye', percent: 5 }]),
  sod('stoic_watchman', 'Stoic Watchman', 'misc', 'treasure', 2000, [{ type: 'eagle_eye', percent: 10 }]),
  sod('emblem_of_cognizance', 'Emblem of Cognizance', 'misc', 'minor', 3000, [{ type: 'eagle_eye', percent: 15 }]),

  // -- diplomacy -------------------------------------------------------------------------------
  sod('statesmans_medal', "Statesman's Medal", 'neck', 'major', 5000, [{ type: 'surrender_cost_percent', percent: -10 }]),
  sod('diplomats_ring', "Diplomat's Ring", 'ring', 'major', 5000, [{ type: 'surrender_cost_percent', percent: -10 }]),
  sod('ambassadors_sash', "Ambassador's Sash", 'shoulders', 'major', 5000, [{ type: 'surrender_cost_percent', percent: -10 }]),

  // -- creature speed / health -----------------------------------------------------------------
  sod('ring_of_the_wayfarer', 'Ring of the Wayfarer', 'ring', 'major', 5000, [{ type: 'creature_stat', stat: 'speed', value: 1 }]),
  sod('necklace_of_swiftness', 'Necklace of Swiftness', 'neck', 'treasure', 5000, [{ type: 'creature_stat', stat: 'speed', value: 1 }]),
  sod('cape_of_velocity', 'Cape of Velocity', 'shoulders', 'major', 10000, [{ type: 'creature_stat', stat: 'speed', value: 2 }]),
  sod('ring_of_vitality', 'Ring of Vitality', 'ring', 'treasure', 5000, [{ type: 'creature_stat', stat: 'hp', value: 1 }]),
  sod('ring_of_life', 'Ring of Life', 'ring', 'minor', 5000, [{ type: 'creature_stat', stat: 'hp', value: 1 }]),
  sod('vial_of_lifeblood', 'Vial of Lifeblood', 'misc', 'major', 10000, [{ type: 'creature_stat', stat: 'hp', value: 2 }]),
  sod('vial_of_dragon_blood', 'Vial of Dragon Blood', 'misc', 'relic', 20000,
    [{ type: 'creature_stat', filter: { creatureIds: DRAGONS }, stat: 'attack', value: 5 },
      { type: 'creature_stat', filter: { creatureIds: DRAGONS }, stat: 'defense', value: 5 }],
    'All dragons in your army gain +5 attack and +5 defense.'),

  // -- adventure movement ----------------------------------------------------------------------
  sod('equestrians_gloves', "Equestrian's Gloves", 'ring', 'minor', 3000, [{ type: 'movement_land', value: 300 }]),
  sod('boots_of_speed', 'Boots of Speed', 'feet', 'minor', 6000, [{ type: 'movement_land', value: 600 }]),
  sod('necklace_of_ocean_guidance', 'Necklace of Ocean Guidance', 'neck', 'major', 10000, [{ type: 'movement_sea', value: 1000 }]),
  sod('sea_captains_hat', "Sea Captain's Hat", 'head', 'relic', 15000,
    [{ type: 'movement_sea', value: 500 }, { type: 'grants_spell', spellId: 'summon_boat' }, { type: 'grants_spell', spellId: 'scuttle_boat' }],
    '+500 sea movement points; adds Summon Boat and Scuttle Boat to the spell book.'),
  sod('angel_wings', 'Angel Wings', 'shoulders', 'relic', 20000, [{ type: 'fly', mastery: 3 }],
    'The hero can fly over any terrain and obstacle.'),
  sod('boots_of_levitation', 'Boots of Levitation', 'feet', 'relic', 10000, [{ type: 'water_walk', mastery: 3 }],
    'The hero can walk across water.'),

  // -- mana / spell duration -------------------------------------------------------------------
  sod('charm_of_mana', 'Charm of Mana', 'misc', 'treasure', 500, [{ type: 'mana_regen', value: 1 }]),
  sod('talisman_of_mana', 'Talisman of Mana', 'misc', 'treasure', 1000, [{ type: 'mana_regen', value: 2 }]),
  sod('mystic_orb_of_mana', 'Mystic Orb of Mana', 'misc', 'treasure', 1500, [{ type: 'mana_regen', value: 3 }]),
  sod('collar_of_conjuring', 'Collar of Conjuring', 'neck', 'treasure', 500, [{ type: 'spell_duration', value: 1 }]),
  sod('ring_of_conjuring', 'Ring of Conjuring', 'ring', 'treasure', 1000, [{ type: 'spell_duration', value: 2 }]),
  sod('cape_of_conjuring', 'Cape of Conjuring', 'shoulders', 'treasure', 1500, [{ type: 'spell_duration', value: 3 }]),

  // -- orbs ------------------------------------------------------------------------------------
  sod('orb_of_the_firmament', 'Orb of the Firmament', 'misc', 'major', 6000, [{ type: 'spell_power_percent', school: 'air', percent: 50 }]),
  sod('orb_of_silt', 'Orb of Silt', 'misc', 'major', 6000, [{ type: 'spell_power_percent', school: 'earth', percent: 50 }]),
  sod('orb_of_tempestuous_fire', 'Orb of Tempestuous Fire', 'misc', 'major', 6000, [{ type: 'spell_power_percent', school: 'fire', percent: 50 }]),
  sod('orb_of_driving_rain', 'Orb of Driving Rain', 'misc', 'major', 6000, [{ type: 'spell_power_percent', school: 'water', percent: 50 }]),
  sod('orb_of_inhibition', 'Orb of Inhibition', 'misc', 'relic', 20000, [{ type: 'block_spells', minLevel: 1, maxLevel: 5, side: 'both' }],
    'No hero can cast spells in combat.'),
  sod('orb_of_vulnerability', 'Orb of Vulnerability', 'misc', 'relic', 25000, [{ type: 'negate_resistance', immunities: true, side: 'both' }],
    'Negates all magic resistance and natural spell immunities of every creature in combat.'),
  sod('recanters_cloak', "Recanter's Cloak", 'shoulders', 'major', 8000, [{ type: 'block_spells', minLevel: 3, maxLevel: 5, side: 'both' }],
    'No hero can cast spells of level 3 or higher in combat.'),
  sod('sphere_of_permanence', 'Sphere of Permanence', 'misc', 'major', 7500, [immune('dispel')],
    'Your troops are immune to Dispel.'),

  // -- spell immunity pendants -----------------------------------------------------------------
  sod('pendant_of_dispassion', 'Pendant of Dispassion', 'neck', 'treasure', 1000, [immune('berserk')]),
  sod('pendant_of_second_sight', 'Pendant of Second Sight', 'neck', 'major', 5000, [immune('blind')]),
  sod('pendant_of_holiness', 'Pendant of Holiness', 'neck', 'treasure', 1000, [immune('curse')]),
  sod('pendant_of_life', 'Pendant of Life', 'neck', 'treasure', 2500, [immune('death_ripple')]),
  sod('pendant_of_death', 'Pendant of Death', 'neck', 'treasure', 2500, [immune('destroy_undead')]),
  sod('pendant_of_free_will', 'Pendant of Free Will', 'neck', 'treasure', 1000, [immune('hypnotize')]),
  sod('pendant_of_negativity', 'Pendant of Negativity', 'neck', 'major', 5000, [immune('lightning_bolt'), immune('chain_lightning')]),
  sod('pendant_of_total_recall', 'Pendant of Total Recall', 'neck', 'treasure', 3000, [immune('forgetfulness')]),

  // -- spell granting --------------------------------------------------------------------------
  sod('tome_of_fire_magic', 'Tome of Fire Magic', 'misc', 'relic', 20000, [{ type: 'grants_spells', school: 'fire' }],
    'All Fire Magic spells are available in the spell book.'),
  sod('tome_of_air_magic', 'Tome of Air Magic', 'misc', 'relic', 20000, [{ type: 'grants_spells', school: 'air' }],
    'All Air Magic spells are available in the spell book.'),
  sod('tome_of_water_magic', 'Tome of Water Magic', 'misc', 'relic', 20000, [{ type: 'grants_spells', school: 'water' }],
    'All Water Magic spells are available in the spell book.'),
  sod('tome_of_earth_magic', 'Tome of Earth Magic', 'misc', 'relic', 20000, [{ type: 'grants_spells', school: 'earth' }],
    'All Earth Magic spells are available in the spell book.'),
  sod('spellbinders_hat', "Spellbinder's Hat", 'head', 'relic', 30000, [{ type: 'grants_spells', level: 5 }],
    'All level 5 spells are available in the spell book.'),
  sod('armageddons_blade', "Armageddon's Blade", 'right_hand', 'relic', 50000,
    [atk(3), def(3), pow(3), kno(6), { type: 'grants_spell', spellId: 'armageddon', mastery: 3 }, immune('armageddon')],
    '+3 attack, +3 defense, +3 power, +6 knowledge; expert Armageddon in the spell book and your troops are immune to it.',
    { noRandom: true }),

  // -- battle rules ----------------------------------------------------------------------------
  sod('shackles_of_war', 'Shackles of War', 'misc', 'major', 5000, [{ type: 'no_retreat', side: 'both' }],
    'Neither hero can retreat or surrender.'),

  // -- legion ----------------------------------------------------------------------------------
  sod('legs_of_legion', 'Legs of Legion', 'misc', 'treasure', 5000, [{ type: 'creature_growth', tier: 2, value: 5, scope: 'town' }]),
  sod('loins_of_legion', 'Loins of Legion', 'misc', 'minor', 5000, [{ type: 'creature_growth', tier: 3, value: 4, scope: 'town' }]),
  sod('torso_of_legion', 'Torso of Legion', 'misc', 'minor', 5000, [{ type: 'creature_growth', tier: 4, value: 3, scope: 'town' }]),
  sod('arms_of_legion', 'Arms of Legion', 'misc', 'major', 5000, [{ type: 'creature_growth', tier: 5, value: 2, scope: 'town' }]),
  sod('head_of_legion', 'Head of Legion', 'misc', 'major', 5000, [{ type: 'creature_growth', tier: 6, value: 1, scope: 'town' }]),

  // -- resources -------------------------------------------------------------------------------
  sod('endless_sack_of_gold', 'Endless Sack of Gold', 'misc', 'relic', 10000, [income('gold', 1000)]),
  sod('endless_bag_of_gold', 'Endless Bag of Gold', 'misc', 'major', 7500, [income('gold', 750)]),
  sod('endless_purse_of_gold', 'Endless Purse of Gold', 'misc', 'major', 5000, [income('gold', 500)]),
  sod('inexhaustible_cart_of_ore', 'Inexhaustible Cart of Ore', 'misc', 'minor', 5000, [income('ore', 1)]),
  sod('inexhaustible_cart_of_lumber', 'Inexhaustible Cart of Lumber', 'misc', 'minor', 5000, [income('wood', 1)]),
  sod('everflowing_crystal_cloak', 'Everflowing Crystal Cloak', 'shoulders', 'major', 5000, [income('crystal', 1)]),
  sod('ring_of_infinite_gems', 'Ring of Infinite Gems', 'ring', 'major', 5000, [income('gems', 1)]),
  sod('everpouring_vial_of_mercury', 'Everpouring Vial of Mercury', 'misc', 'major', 5000, [income('mercury', 1)]),
  sod('eversmoking_ring_of_sulfur', 'Eversmoking Ring of Sulfur', 'ring', 'major', 5000, [income('sulfur', 1)]),

  // -- HotA additions --------------------------------------------------------------------------
  hota('trident_of_dominion', 'Trident of Dominion', 'right_hand', 'major', 7000, [atk(7)]),
  hota('shield_of_naval_glory', 'Shield of Naval Glory', 'left_hand', 'major', 7000, [def(7)]),
  hota('royal_armor_of_nix', 'Royal Armor of Nix', 'torso', 'major', 7000, [pow(6)]),
  hota('crown_of_the_five_seas', 'Crown of the Five Seas', 'head', 'major', 7000, [kno(6)]),
  hota('wayfarers_boots', "Wayfarer's Boots", 'feet', 'major', 5000, [{ type: 'terrain_penalty_reduction', percent: 100 }],
    'The hero ignores all terrain movement penalties.'),
  hota('charm_of_eclipse', 'Charm of Eclipse', 'misc', 'minor', 5000, [{ type: 'enemy_spell_power_percent', percent: -10 }]),
  hota('seal_of_sunset', 'Seal of Sunset', 'ring', 'minor', 5000, [{ type: 'enemy_spell_power_percent', percent: -10 }]),
  hota('plate_of_dying_light', 'Plate of Dying Light', 'torso', 'relic', 10000, [{ type: 'enemy_spell_power_percent', percent: -25 }]),
  hota('sleepkeeper', 'Sleepkeeper', 'misc', 'relic', 50000,
    ['sorrow', 'berserk', 'hypnotize', 'forgetfulness', 'blind', 'fear'].map(immune),
    'Your troops are immune to hostile mind spells.', { noRandom: true }),
  hota('hideous_mask', 'Hideous Mask', 'misc', 'minor', 4000, [{ type: 'enemy_morale', value: -1 }]),
  hota('pendant_of_downfall', 'Pendant of Downfall', 'neck', 'major', 7000, [{ type: 'enemy_morale', value: -2 }]),
  hota('ring_of_suppression', 'Ring of Suppression', 'ring', 'minor', 4000, [{ type: 'enemy_morale', value: -1 }]),
  hota('runes_of_imminency', 'Runes of Imminency', 'misc', 'treasure', 2000, [{ type: 'enemy_luck', value: -1 }]),
  hota('demons_horseshoe', "Demon's Horseshoe", 'misc', 'treasure', 2000, [{ type: 'enemy_luck', value: -1 }]),
  hota('shamans_puppet', "Shaman's Puppet", 'misc', 'minor', 4000, [{ type: 'enemy_luck', value: -2 }]),
  hota('cape_of_silence', 'Cape of Silence', 'shoulders', 'major', 7500, [{ type: 'block_spells', minLevel: 1, maxLevel: 2, side: 'both' }],
    'No hero can cast spells of level 1 or 2 in combat.'),
  hota('ring_of_oblivion', 'Ring of Oblivion', 'ring', 'major', 7500, [{ type: 'no_resurrection', side: 'both' }],
    'Creatures killed in combat cannot be resurrected, raised or healed back after the battle.'),
  hota('horn_of_the_abyss', 'Horn of the Abyss', 'misc', 'relic', 50000, [{ type: 'raise_on_kill', creatureId: 'fangarm', except: LIVING_ONLY }],
    'When a stack of living creatures is slain in combat, Fangarms rise from it and stay with the hero.', { noRandom: true }),

  // -- H3online originals ----------------------------------------------------------------------
  extra('stormglass_circlet', 'Stormglass Circlet', 'head', 'minor', 4000, [pow(2), { type: 'spell_power_percent', school: 'air', percent: 10 }]),
  extra('gauntlet_of_static', 'Gauntlet of Static', 'ring', 'minor', 3500, [kno(2), { type: 'spell_cost', school: 'air', value: -1 }],
    '+2 knowledge; Air Magic spells cost 1 spell point less.'),
  extra('cloak_of_gales', 'Cloak of Gales', 'shoulders', 'major', 6000, [{ type: 'creature_stat', stat: 'speed', value: 1 }, pow(1)]),
  extra('warlords_greatsword', "Warlord's Greatsword", 'right_hand', 'major', 6500, [atk(4), { type: 'damage_percent', mode: 'melee', percent: 5 }]),
  extra('warlords_bulwark', "Warlord's Bulwark", 'left_hand', 'major', 6500, [def(4), { type: 'damage_reduction_percent', percent: 5 }],
    '+4 defense; your troops take 5% less damage.'),
  extra('warlords_cuirass', "Warlord's Cuirass", 'torso', 'minor', 4500, [atk(2), def(2)]),
  extra('banner_of_the_vanguard', 'Banner of the Vanguard', 'misc', 'minor', 3000, [morale(1), { type: 'creature_stat', stat: 'speed', value: 1, filter: { tier: 1 } }],
    '+1 morale; level 1 creatures gain +1 speed.'),
  extra('cartographers_compass', "Cartographer's Compass", 'misc', 'minor', 3000, [{ type: 'sight_radius', value: 2 }]),
  extra('trailblazers_boots', "Trailblazer's Boots", 'feet', 'minor', 4000, [{ type: 'movement_land', value: 200 }, { type: 'terrain_penalty_reduction', percent: 25 }],
    '+200 land movement points; terrain penalties reduced by 25%.'),
  extra('saddlebags_of_plenty', 'Saddlebags of Plenty', 'misc', 'minor', 3500, [{ type: 'movement_land', value: 100 }, income('gold', 125)]),
  extra('phoenix_feather', 'Phoenix Feather', 'misc', 'relic', 18000, [{ type: 'resurrect_fallen', percent: 25, uses: 1 }],
    'Once per battle, the first of your stacks to be destroyed rises again with 25% of its starting numbers.'),
  extra('mirror_of_vanity', 'Mirror of Vanity', 'misc', 'major', 9000, [{ type: 'spell_reflection', percent: 20 }],
    'Each hostile spell aimed at one of your stacks has a 20% chance to be reflected onto a random enemy stack.'),
  extra('alchemists_crucible', "Alchemist's Crucible", 'misc', 'major', 8000, [income('mercury', 1), income('sulfur', 1)]),
  extra('scholars_monocle', "Scholar's Monocle", 'misc', 'minor', 3000, [{ type: 'experience_percent', percent: 10 }],
    'The hero gains 10% more experience.'),
  extra('helm_of_the_iron_will', 'Helm of the Iron Will', 'head', 'minor', 4500, [def(2), morale(1)]),
  extra('gloves_of_the_marksman', 'Gloves of the Marksman', 'ring', 'minor', 3500, [{ type: 'damage_percent', mode: 'ranged', percent: 5 }, atk(1)]),
  extra('warhorn_of_the_steppe', 'Warhorn of the Steppe', 'misc', 'major', 7000, [{ type: 'creature_stat', stat: 'attack', value: 2, filter: { shooter: false } }],
    'Your non-shooting creatures gain +2 attack.'),
  extra('heartstone_of_the_mountain', 'Heartstone of the Mountain', 'misc', 'major', 9000, [{ type: 'creature_stat', stat: 'hp', percent: 10 }]),
  extra('mariners_astrolabe', "Mariner's Astrolabe", 'misc', 'minor', 3000, [{ type: 'movement_sea', value: 300 }, { type: 'sight_radius', value: 1 }]),
  extra('ring_of_the_arch_magus', 'Ring of the Arch-Magus', 'ring', 'major', 7000, [{ type: 'mana_max_percent', percent: 25 }],
    '+25% maximum spell points.'),
  extra('staff_of_the_elements', 'Staff of the Elements', 'right_hand', 'major', 8000, [pow(2), { type: 'spell_power_percent', percent: 10 }],
    '+2 power; all damage spells deal 10% more damage.'),
  extra('aegis_of_the_ancients', 'Aegis of the Ancients', 'left_hand', 'relic', 12000, [def(5), { type: 'magic_resistance', percent: 10 }]),
  extra('crown_of_command', 'Crown of Command', 'head', 'major', 6000, [atk(1), def(1), morale(1)]),
  extra('misers_coffer', "Miser's Coffer", 'misc', 'minor', 2500, [income('gold', 250)]),
  extra('merchants_scales', "Merchant's Scales", 'misc', 'minor', 4000, [{ type: 'marketplace_count', value: 1 }],
    'Marketplace exchange rates are calculated as if you owned one more marketplace.'),
];

const BASE_BY_ID = Object.fromEntries(BASE.map((a) => [a.id, a]));

function combo(origin, id, name, slot, components, bonuses, description) {
  const cost = components.reduce((sum, c) => {
    if (!BASE_BY_ID[c]) throw new Error(`combo ${id}: unknown component ${c}`);
    return sum + BASE_BY_ID[c].cost;
  }, 0);
  return make(origin, id, name, slot, 'combo', cost, bonuses, description, { components, noRandom: true });
}

const COMBOS = [
  combo('sod', 'angelic_alliance', 'Angelic Alliance', 'right_hand',
    ['sword_of_judgement', 'armor_of_wonder', 'sandals_of_the_saint', 'celestial_necklace_of_bliss',
      'lions_shield_of_courage', 'helm_of_heavenly_enlightenment'],
    [{ type: 'no_alignment_penalty', factions: GOOD_AND_NEUTRAL },
      startCast('prayer', 'all_friendly', 10)],
    '+21 to all primary skills. Good and neutral troops mix without morale penalty. Casts expert Prayer at the start of every battle.'),
  combo('sod', 'cloak_of_the_undead_king', 'Cloak of the Undead King', 'shoulders',
    ['vampires_cowl', 'amulet_of_the_undertaker', 'dead_mans_boots'],
    [{ type: 'necromancy_raise', creatures: ['skeleton', 'walking_dead', 'wight', 'lich'] }],
    '+30% necromancy. Raises Skeletons without the Necromancy skill, Walking Dead at Basic, Wights at Advanced and Liches at Expert.'),
  combo('sod', 'elixir_of_life', 'Elixir of Life', 'misc',
    ['vial_of_lifeblood', 'ring_of_vitality', 'ring_of_life'],
    [{ type: 'creature_stat', stat: 'hp', percent: 25, except: LIVING_ONLY },
      { type: 'creature_regeneration', except: LIVING_ONLY }],
    '+4 health, a further +25% health and regeneration for all living creatures in your army.'),
  combo('sod', 'armor_of_the_damned', 'Armor of the Damned', 'torso',
    ['rib_cage', 'blackshard_of_the_dead_knight', 'shield_of_the_yawning_dead', 'skull_helmet'],
    [startCast('slow', 'all_enemies', 50), startCast('curse', 'all_enemies', 50),
      startCast('weakness', 'all_enemies', 50), startCast('misfortune', 'all_enemies', 50)],
    '+3 attack, +3 defense, +2 power, +2 knowledge. Casts expert Slow, Curse, Weakness and Misfortune on all enemies at the start of every battle (50 rounds).'),
  combo('sod', 'statue_of_legion', 'Statue of Legion', 'misc',
    ['legs_of_legion', 'loins_of_legion', 'torso_of_legion', 'arms_of_legion', 'head_of_legion'],
    [{ type: 'creature_growth', percent: 50, scope: 'all_towns' }],
    '+50% creature growth in all of your towns.'),
  combo('sod', 'power_of_the_dragon_father', 'Power of the Dragon Father', 'torso',
    ['dragon_scale_armor', 'quiet_eye_of_the_dragon', 'red_dragon_flame_tongue', 'dragon_scale_shield',
      'dragonbone_greaves', 'dragon_wing_tabard', 'necklace_of_dragonteeth', 'crown_of_dragontooth',
      'still_eye_of_the_dragon'],
    [...allPrim(6), { type: 'spell_immunity', maxLevel: 4, side: 'own' }],
    '+16 to all primary skills, +1 morale and luck; your troops are immune to spells of level 1-4.'),
  combo('sod', 'titans_thunder', "Titan's Thunder", 'right_hand',
    ['titans_gladius', 'sentinels_shield', 'thunder_helmet', 'titans_cuirass'],
    [{ type: 'grants_spell', spellId: 'titans_lightning_bolt', mastery: 3, free: true, requiresSpellbook: true }],
    "+9 attack, +9 defense, +8 power, +8 knowledge; adds Titan's Lightning Bolt (600 damage, no mana cost) to the spell book."),
  combo('sod', 'admirals_hat', "Admiral's Hat", 'head',
    ['sea_captains_hat', 'necklace_of_ocean_guidance'],
    [{ type: 'free_boarding' }],
    '+1500 sea movement points; boarding or leaving a boat costs no movement points.'),
  combo('sod', 'bow_of_the_sharpshooter', 'Bow of the Sharpshooter', 'misc',
    ['bow_of_elven_cherrywood', 'bowstring_of_the_unicorns_mane', 'angel_feather_arrows'],
    [{ type: 'no_range_penalty' }, { type: 'no_obstacle_penalty' }, { type: 'free_shooting' }],
    '+30% ranged damage; no range or obstacle penalty; your shooters can fire while adjacent to an enemy.'),
  combo('sod', 'wizards_well', "Wizard's Well", 'misc',
    ['charm_of_mana', 'talisman_of_mana', 'mystic_orb_of_mana'],
    [{ type: 'mana_regen_full' }],
    'Restores all of the hero\'s spell points every day.'),
  combo('sod', 'ring_of_the_magi', 'Ring of the Magi', 'ring',
    ['ring_of_conjuring', 'collar_of_conjuring', 'cape_of_conjuring'],
    [{ type: 'spell_duration', value: 50 }],
    'Your spells last 56 rounds longer.'),
  combo('sod', 'cornucopia', 'Cornucopia', 'misc',
    ['everpouring_vial_of_mercury', 'everflowing_crystal_cloak', 'ring_of_infinite_gems', 'eversmoking_ring_of_sulfur'],
    [income('mercury', 4), income('sulfur', 4), income('crystal', 4), income('gems', 4)],
    '+5 mercury, sulfur, crystal and gems per day.'),

  combo('hota', 'ironfist_of_the_ogre', 'Ironfist of the Ogre', 'right_hand',
    ['ogres_club_of_havoc', 'targ_of_the_rampaging_ogre', 'crown_of_the_supreme_magi', 'tunic_of_the_cyclops_king'],
    [startCast('haste', 'all_friendly', 50), startCast('bloodlust', 'all_friendly', 50),
      startCast('fire_shield', 'all_friendly', 50), startCast('counterstrike', 'all_friendly', 50)],
    '+5 attack, +5 defense, +4 power, +4 knowledge. Casts expert Haste, Bloodlust, Fire Shield and Counterstrike on your army at the start of every battle (50 rounds).'),
  combo('hota', 'golden_goose', 'Golden Goose', 'misc',
    ['endless_sack_of_gold', 'endless_bag_of_gold', 'endless_purse_of_gold'],
    [income('gold', 4750)],
    '+7000 gold per day.'),
  combo('hota', 'diplomats_cloak', "Diplomat's Cloak", 'shoulders',
    ['ambassadors_sash', 'statesmans_medal', 'diplomats_ring'],
    [{ type: 'always_can_retreat' }, { type: 'army_strength_percent', percent: 200, context: 'negotiation' }],
    '-30% surrender cost; the hero may retreat or surrender in any battle; army strength counts triple when wandering monsters decide to flee or join.'),
  combo('hota', 'pendant_of_reflection', 'Pendant of Reflection', 'neck',
    ['garniture_of_interference', 'surcoat_of_counterpoise', 'boots_of_polarity'],
    [{ type: 'magic_resistance', percent: 20 }],
    '+50% magic resistance.'),

  combo('extra', 'stormcallers_regalia', "Stormcaller's Regalia", 'head',
    ['stormglass_circlet', 'gauntlet_of_static', 'cloak_of_gales'],
    [{ type: 'spell_school_mastery', school: 'air', level: 3 },
      { type: 'spell_power_percent', school: 'air', percent: 25 },
      { type: 'grants_spell', spellId: 'chain_lightning' }],
    'Air Magic spells are cast at Expert level and deal a further +25% damage; adds Chain Lightning to the spell book.'),
  combo('extra', 'warlords_panoply', "Warlord's Panoply", 'torso',
    ['warlords_cuirass', 'warlords_greatsword', 'warlords_bulwark', 'banner_of_the_vanguard'],
    [{ type: 'damage_percent', mode: 'melee', percent: 10 }, { type: 'damage_reduction_percent', percent: 10 },
      { type: 'creature_stat', stat: 'speed', value: 1 }, morale(1)],
    'A further +10% melee damage, 10% less damage taken, +1 speed for all creatures and +1 morale.'),
  combo('extra', 'pathfinders_legacy', "Pathfinder's Legacy", 'feet',
    ['trailblazers_boots', 'cartographers_compass', 'saddlebags_of_plenty'],
    [{ type: 'movement_land', percent: 15 }, { type: 'terrain_penalty_reduction', percent: 75 },
      { type: 'sight_radius', value: 2 }],
    '+15% land movement, no terrain penalties and a further +2 scouting radius.'),
];

/** @type {ReadonlyArray<object>} */
export const ARTIFACTS = [...BASE, ...COMBOS];
export const ARTIFACT_BY_ID = Object.fromEntries(ARTIFACTS.map((a) => [a.id, a]));
export const COMBO_ARTIFACTS = COMBOS;

/** Throws on unknown id (programmer error). */
export function getArtifact(id) {
  const art = ARTIFACT_BY_ID[id];
  if (!art) throw new Error(`Unknown artifact: ${id}`);
  return art;
}

export function isArtifact(id) {
  return Object.prototype.hasOwnProperty.call(ARTIFACT_BY_ID, id);
}

export function artifactsOfClass(cls) {
  return ARTIFACTS.filter((a) => a.class === cls);
}

export function artifactsOfSlot(slot) {
  return ARTIFACTS.filter((a) => a.slot === slot);
}

export function isCombo(id) {
  return Array.isArray(getArtifact(id).components);
}

/** Combination artifacts that use `componentId` as a part. */
export function combosContaining(componentId) {
  return COMBOS.filter((c) => c.components.includes(componentId));
}

/** Artifacts eligible for random placement (optionally restricted to one class / a list). */
export function randomArtifactPool(cls) {
  const classes = cls == null ? RANDOM_ARTIFACT_CLASSES : Array.isArray(cls) ? cls : [cls];
  return ARTIFACTS.filter((a) => classes.includes(a.class) && !a.noRandom);
}

// Sanity guard so a typo in this file fails fast at import time.
for (const a of ARTIFACTS) {
  if (!ARTIFACT_SLOTS.includes(a.slot)) throw new Error(`artifact ${a.id}: bad slot ${a.slot}`);
  for (const b of a.bonuses) {
    if (b.school && !SPELL_SCHOOLS.includes(b.school)) throw new Error(`artifact ${a.id}: bad school ${b.school}`);
  }
}
