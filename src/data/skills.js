// Secondary skills: the 28 of the original + HotA's Interference.
// Schema (DESIGN.md §3): { id, name, description, levels: [ {description, effects:[Bonus...]} x3 ] }
// levels[0] = Basic, [1] = Advanced, [2] = Expert.
// Extra field `specialtyParam`: name of the numeric field (of levels[n].effects[0]) that a
// `skill_percent` bonus (hero skill specialty, artifacts) multiplies. null = nothing to scale.
// Every Bonus type used here is specified in docs/mechanics/heroes.md ("Bonus types").

import { SPELL_SCHOOLS } from '../core/constants.js';

const LEVEL_NAMES = ['Basic', 'Advanced', 'Expert'];

/**
 * @typedef {{type: string, [k: string]: any}} Bonus
 * @typedef {{description: string, effects: Bonus[]}} SkillLevel
 * @typedef {{id: string, name: string, description: string, specialtyParam: string|null, levels: SkillLevel[]}} Skill
 */

/**
 * Build a skill from a per-level table.
 * @param {string} id
 * @param {string} name
 * @param {string} description general description
 * @param {string|null} specialtyParam
 * @param {Array<[string, Bonus[]]>} rows three [description, effects] rows
 * @returns {Skill}
 */
function skill(id, name, description, specialtyParam, rows) {
  return {
    id, name, description, specialtyParam,
    levels: rows.map(([text, effects], i) => ({
      description: `${LEVEL_NAMES[i]} ${name}: ${text}`,
      effects,
    })),
  };
}

function school(schoolId, name) {
  return skill(`${schoolId}_magic`, `${name} Magic`,
    `Allows the hero to cast ${name} school spells with greater effect and at reduced cost.`, null,
    [
      [`${name} spells are cast at Basic mastery (reduced mana cost).`,
        [{ type: 'spell_school_mastery', school: schoolId, level: 1 }]],
      [`${name} spells are cast at Advanced mastery.`,
        [{ type: 'spell_school_mastery', school: schoolId, level: 2 }]],
      [`${name} spells are cast at Expert mastery.`,
        [{ type: 'spell_school_mastery', school: schoolId, level: 3 }]],
    ]);
}

/** @type {Skill[]} */
export const SKILLS = [
  skill('pathfinding', 'Pathfinding', 'Reduces the movement penalty of rough terrain.', 'percent', [
    ['reduces terrain movement penalties by 25 points.', [{ type: 'terrain_penalty_reduction', percent: 25 }]],
    ['reduces terrain movement penalties by 50 points.', [{ type: 'terrain_penalty_reduction', percent: 50 }]],
    ['reduces terrain movement penalties by 75 points.', [{ type: 'terrain_penalty_reduction', percent: 75 }]],
  ]),
  skill('archery', 'Archery', 'Increases the damage done by ranged attacks.', 'percent', [
    ['ranged damage +10%.', [{ type: 'damage_percent', mode: 'ranged', percent: 10 }]],
    ['ranged damage +25%.', [{ type: 'damage_percent', mode: 'ranged', percent: 25 }]],
    ['ranged damage +50%.', [{ type: 'damage_percent', mode: 'ranged', percent: 50 }]],
  ]),
  skill('logistics', 'Logistics', 'Increases the hero\'s movement range over land.', 'percent', [
    ['land movement +10%.', [{ type: 'movement_land', percent: 10 }]],
    ['land movement +20%.', [{ type: 'movement_land', percent: 20 }]],
    ['land movement +30%.', [{ type: 'movement_land', percent: 30 }]],
  ]),
  skill('scouting', 'Scouting', 'Increases the hero\'s sight radius on the adventure map.', 'value', [
    ['sight radius +1.', [{ type: 'sight_radius', value: 1 }]],
    ['sight radius +2.', [{ type: 'sight_radius', value: 2 }]],
    ['sight radius +3.', [{ type: 'sight_radius', value: 3 }]],
  ]),
  skill('diplomacy', 'Diplomacy',
    'Wandering creatures may offer to join, and surrendering costs less.', 'surrenderDiscountPercent', [
      ['creatures are more willing to join; surrender cost -20%.',
        [{ type: 'diplomacy', level: 1, joinPercent: 25, surrenderDiscountPercent: 20 }]],
      ['creatures are much more willing to join; surrender cost -40%.',
        [{ type: 'diplomacy', level: 2, joinPercent: 50, surrenderDiscountPercent: 40 }]],
      ['creatures are most willing to join; surrender cost -60%.',
        [{ type: 'diplomacy', level: 3, joinPercent: 100, surrenderDiscountPercent: 60 }]],
    ]),
  skill('navigation', 'Navigation', 'Increases the hero\'s movement range at sea.', 'percent', [
    ['sea movement +50%.', [{ type: 'movement_sea', percent: 50 }]],
    ['sea movement +100%.', [{ type: 'movement_sea', percent: 100 }]],
    ['sea movement +150%.', [{ type: 'movement_sea', percent: 150 }]],
  ]),
  skill('leadership', 'Leadership', 'Increases the morale of the hero\'s troops.', null, [
    ['morale +1.', [{ type: 'morale', value: 1 }]],
    ['morale +2.', [{ type: 'morale', value: 2 }]],
    ['morale +3.', [{ type: 'morale', value: 3 }]],
  ]),
  skill('wisdom', 'Wisdom', 'Allows the hero to learn spells above 2nd level.', null, [
    ['can learn 3rd level spells.', [{ type: 'learn_spell_level', level: 3 }]],
    ['can learn 4th level spells.', [{ type: 'learn_spell_level', level: 4 }]],
    ['can learn 5th level spells.', [{ type: 'learn_spell_level', level: 5 }]],
  ]),
  skill('mysticism', 'Mysticism', 'Regenerates additional spell points each day.', 'value', [
    ['+2 spell points per day.', [{ type: 'mana_regen', value: 2 }]],
    ['+3 spell points per day.', [{ type: 'mana_regen', value: 3 }]],
    ['+4 spell points per day.', [{ type: 'mana_regen', value: 4 }]],
  ]),
  skill('luck', 'Luck', 'Increases the luck of the hero\'s troops.', null, [
    ['luck +1.', [{ type: 'luck', value: 1 }]],
    ['luck +2.', [{ type: 'luck', value: 2 }]],
    ['luck +3.', [{ type: 'luck', value: 3 }]],
  ]),
  skill('ballistics', 'Ballistics', 'Gives control of the catapult and makes it more effective.', null, [
    ['you aim the catapult; better hit chance; 1 shot.',
      [{ type: 'ballistics', control: true, shots: 1,
        hitChance: { wall: 60, gate: 30, tower: 15, keep: 7 }, damageChance: [0, 50, 50] }]],
    ['you aim the catapult; it fires twice per turn.',
      [{ type: 'ballistics', control: true, shots: 2,
        hitChance: { wall: 75, gate: 40, tower: 20, keep: 10 }, damageChance: [0, 50, 50] }]],
    ['you aim the catapult; it fires twice and always does maximum damage.',
      [{ type: 'ballistics', control: true, shots: 2,
        hitChance: { wall: 75, gate: 50, tower: 25, keep: 15 }, damageChance: [0, 0, 100] }]],
  ]),
  skill('eagle_eye', 'Eagle Eye', 'Chance to learn a spell cast by an enemy during combat.', 'percent', [
    ['40% chance to learn enemy spells up to 2nd level.', [{ type: 'eagle_eye', percent: 40, maxLevel: 2 }]],
    ['50% chance to learn enemy spells up to 3rd level.', [{ type: 'eagle_eye', percent: 50, maxLevel: 3 }]],
    ['60% chance to learn enemy spells up to 4th level.', [{ type: 'eagle_eye', percent: 60, maxLevel: 4 }]],
  ]),
  skill('necromancy', 'Necromancy', 'Raises a part of the creatures killed in combat as skeletons.', 'percent', [
    ['10% of slain creatures rise as skeletons.', [{ type: 'necromancy_percent', percent: 10 }]],
    ['20% of slain creatures rise as skeletons.', [{ type: 'necromancy_percent', percent: 20 }]],
    ['30% of slain creatures rise as skeletons.', [{ type: 'necromancy_percent', percent: 30 }]],
  ]),
  skill('estates', 'Estates', 'The hero contributes gold to the treasury every day.', 'value', [
    ['+125 gold per day.', [{ type: 'resource_income', resource: 'gold', value: 125 }]],
    ['+250 gold per day.', [{ type: 'resource_income', resource: 'gold', value: 250 }]],
    ['+500 gold per day.', [{ type: 'resource_income', resource: 'gold', value: 500 }]],
  ]),
  school('fire', 'Fire'),
  school('air', 'Air'),
  school('water', 'Water'),
  school('earth', 'Earth'),
  skill('scholar', 'Scholar', 'Heroes who meet teach each other spells.', null, [
    ['exchange spells up to 2nd level.', [{ type: 'scholar', maxLevel: 2 }]],
    ['exchange spells up to 3rd level.', [{ type: 'scholar', maxLevel: 3 }]],
    ['exchange spells up to 4th level.', [{ type: 'scholar', maxLevel: 4 }]],
  ]),
  skill('tactics', 'Tactics', 'Lets you rearrange your troops before combat begins.', null, [
    ['rearrange troops within 3 hex columns.', [{ type: 'tactics', hexes: 3 }]],
    ['rearrange troops within 5 hex columns.', [{ type: 'tactics', hexes: 5 }]],
    ['rearrange troops within 7 hex columns.', [{ type: 'tactics', hexes: 7 }]],
  ]),
  skill('artillery', 'Artillery', 'Gives control of the ballista and arrow towers and makes the ballista deadlier.', null, [
    ['you control the ballista; 50% chance of double damage.',
      [{ type: 'artillery', control: true, shots: 1, doubleDamagePercent: 50 }]],
    ['you control the ballista; it fires twice; 75% chance of double damage.',
      [{ type: 'artillery', control: true, shots: 2, doubleDamagePercent: 75 }]],
    ['you control the ballista; it fires twice and always does double damage.',
      [{ type: 'artillery', control: true, shots: 2, doubleDamagePercent: 100 }]],
  ]),
  skill('learning', 'Learning', 'Increases the experience the hero earns.', 'percent', [
    ['experience +5%.', [{ type: 'experience_percent', percent: 5 }]],
    ['experience +10%.', [{ type: 'experience_percent', percent: 10 }]],
    ['experience +15%.', [{ type: 'experience_percent', percent: 15 }]],
  ]),
  skill('offense', 'Offense', 'Increases the damage done in hand-to-hand combat.', 'percent', [
    ['melee damage +10%.', [{ type: 'damage_percent', mode: 'melee', percent: 10 }]],
    ['melee damage +20%.', [{ type: 'damage_percent', mode: 'melee', percent: 20 }]],
    ['melee damage +30%.', [{ type: 'damage_percent', mode: 'melee', percent: 30 }]],
  ]),
  skill('armorer', 'Armorer', 'Reduces the physical damage done to the hero\'s troops.', 'percent', [
    ['damage taken -5%.', [{ type: 'damage_reduction_percent', percent: 5 }]],
    ['damage taken -10%.', [{ type: 'damage_reduction_percent', percent: 10 }]],
    ['damage taken -15%.', [{ type: 'damage_reduction_percent', percent: 15 }]],
  ]),
  skill('intelligence', 'Intelligence', 'Increases the hero\'s maximum spell points.', 'percent', [
    ['maximum spell points +25%.', [{ type: 'mana_max_percent', percent: 25 }]],
    ['maximum spell points +50%.', [{ type: 'mana_max_percent', percent: 50 }]],
    ['maximum spell points +100%.', [{ type: 'mana_max_percent', percent: 100 }]],
  ]),
  skill('sorcery', 'Sorcery', 'Increases the damage of the hero\'s spells.', 'percent', [
    ['spell damage +5%.', [{ type: 'spell_power_percent', percent: 5 }]],
    ['spell damage +10%.', [{ type: 'spell_power_percent', percent: 10 }]],
    ['spell damage +15%.', [{ type: 'spell_power_percent', percent: 15 }]],
  ]),
  skill('resistance', 'Resistance', 'Gives the hero\'s troops a chance to resist hostile spells.', 'percent', [
    ['5% chance to resist enemy spells.', [{ type: 'magic_resistance', percent: 5 }]],
    ['10% chance to resist enemy spells.', [{ type: 'magic_resistance', percent: 10 }]],
    ['20% chance to resist enemy spells.', [{ type: 'magic_resistance', percent: 20 }]],
  ]),
  skill('first_aid', 'First Aid', 'Gives control of the first aid tent and makes it heal more.', 'healMax', [
    ['you control the tent; it heals 1-50 hit points.', [{ type: 'first_aid', control: true, healMin: 1, healMax: 50 }]],
    ['you control the tent; it heals 1-75 hit points.', [{ type: 'first_aid', control: true, healMin: 1, healMax: 75 }]],
    ['you control the tent; it heals 1-100 hit points.', [{ type: 'first_aid', control: true, healMin: 1, healMax: 100 }]],
  ]),
  skill('interference', 'Interference', 'Weakens the spell power of the enemy hero in combat.', 'percent', [
    ['enemy hero spell power -10%.', [{ type: 'interference', percent: 10 }]],
    ['enemy hero spell power -20%.', [{ type: 'interference', percent: 20 }]],
    ['enemy hero spell power -30%.', [{ type: 'interference', percent: 30 }]],
  ]),
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
export const SKILL_IDS = SKILLS.map((s) => s.id);

/** Skill ids of the four magic schools (`fire_magic`, ...), in SPELL_SCHOOLS order. */
export const MAGIC_SCHOOL_SKILLS = SPELL_SCHOOLS.map((s) => `${s}_magic`);

/** @param {string} id @returns {Skill} */
export function getSkill(id) {
  const s = SKILL_BY_ID[id];
  if (!s) throw new Error(`Unknown skill: ${id}`);
  return s;
}

/**
 * Bonuses granted by a skill at a mastery level.
 * @param {string} id
 * @param {number} level 1..3
 * @returns {Bonus[]}
 */
export function getSkillEffects(id, level) {
  const s = getSkill(id);
  if (!(level >= 1 && level <= 3)) throw new Error(`Bad skill level ${level} for ${id}`);
  return s.levels[level - 1].effects;
}
