// Hero classes: one might + one magic class per faction (22 total).
// Schema: DESIGN.md §3 "Hero class". Start stats, primary chances and secondary skill weights are
// the original HCTRAITS values (each weight row sums to 112 without Interference); Cove/Factory
// and the `interference` column follow HotA (audit: docs/audit/heroes-artifacts.md).

import { SKILL_IDS } from './skills.js';

/**
 * @typedef {{attack:number, defense:number, power:number, knowledge:number}} Primary
 * @typedef {{id:string, name:string, faction:string, kind:'might'|'magic', startPrimary:Primary,
 *   primaryChancesLow:Primary, primaryChancesHigh:Primary, skillWeights:Object<string,number>}} HeroClass
 */

// Column order of the weight rows below.
const WEIGHT_ORDER = [
  'pathfinding', 'archery', 'logistics', 'scouting', 'diplomacy', 'navigation', 'leadership',
  'wisdom', 'mysticism', 'luck', 'ballistics', 'eagle_eye', 'necromancy', 'estates',
  'fire_magic', 'air_magic', 'water_magic', 'earth_magic', 'scholar', 'tactics', 'artillery',
  'learning', 'offense', 'armorer', 'intelligence', 'sorcery', 'resistance', 'first_aid',
  'interference',
];

const p = (attack, defense, power, knowledge) => ({ attack, defense, power, knowledge });

function cls(id, name, faction, kind, start, low, high, weights) {
  if (weights.length !== WEIGHT_ORDER.length) throw new Error(`Bad weight row for ${id}`);
  return {
    id, name, faction, kind,
    startPrimary: p(...start),
    primaryChancesLow: p(...low),
    primaryChancesHigh: p(...high),
    skillWeights: Object.fromEntries(WEIGHT_ORDER.map((s, i) => [s, weights[i]])),
  };
}

/** @type {HeroClass[]} */
export const HERO_CLASSES = [
  //                                                                  Pa Ar Lo Sc Di Na Le Wi My Lu Ba Ea Ne Es Fi Ai Wa Ea Sc Ta Ar Le Of Ar In So Re FA If
  cls('knight', 'Knight', 'castle', 'might', [2, 2, 1, 1], [35, 45, 10, 10], [30, 30, 20, 20],
    [4, 5, 5, 4, 4, 8, 10, 3, 2, 3, 8, 2, 0, 6, 1, 3, 4, 2, 1, 7, 5, 4, 7, 5, 1, 1, 5, 2, 5]),
  cls('cleric', 'Cleric', 'castle', 'magic', [1, 0, 2, 2], [20, 15, 30, 35], [20, 20, 30, 30],
    [2, 3, 4, 3, 7, 5, 2, 7, 4, 5, 4, 6, 0, 3, 2, 4, 4, 3, 6, 2, 2, 4, 4, 3, 6, 5, 2, 10, 0]),
  cls('ranger', 'Ranger', 'rampart', 'might', [1, 3, 1, 1], [35, 45, 10, 10], [30, 30, 20, 20],
    [7, 8, 5, 7, 4, 3, 6, 3, 3, 6, 4, 2, 0, 2, 0, 1, 3, 3, 1, 5, 6, 4, 5, 8, 2, 2, 9, 3, 9]),
  cls('druid', 'Druid', 'rampart', 'magic', [0, 2, 1, 2], [10, 20, 35, 35], [20, 20, 30, 30],
    [5, 5, 5, 2, 4, 2, 2, 8, 6, 9, 4, 7, 0, 3, 1, 2, 4, 4, 8, 1, 1, 4, 1, 3, 7, 6, 1, 7, 0]),
  cls('alchemist', 'Alchemist', 'tower', 'might', [1, 1, 2, 2], [30, 30, 20, 20], [30, 30, 20, 20],
    [4, 5, 6, 4, 3, 3, 3, 6, 4, 2, 6, 3, 0, 4, 1, 4, 2, 3, 3, 4, 4, 10, 6, 8, 4, 3, 5, 2, 5]),
  cls('wizard', 'Wizard', 'tower', 'magic', [0, 0, 2, 3], [10, 10, 40, 40], [30, 20, 20, 30],
    [2, 2, 2, 2, 4, 1, 4, 10, 8, 4, 4, 8, 0, 5, 2, 6, 3, 3, 9, 1, 1, 4, 1, 1, 10, 8, 0, 7, 0]),
  cls('demoniac', 'Demoniac', 'inferno', 'might', [2, 2, 1, 1], [35, 35, 15, 15], [30, 30, 20, 20],
    [4, 6, 10, 5, 4, 4, 3, 4, 2, 2, 7, 3, 0, 3, 4, 2, 1, 3, 2, 6, 5, 4, 8, 7, 2, 3, 6, 2, 6]),
  cls('heretic', 'Heretic', 'inferno', 'magic', [1, 1, 2, 1], [15, 15, 35, 35], [20, 20, 30, 30],
    [4, 4, 3, 3, 3, 2, 2, 8, 10, 2, 6, 4, 0, 2, 5, 3, 2, 4, 5, 4, 4, 4, 4, 4, 6, 6, 3, 5, 0]),
  cls('death_knight', 'Death Knight', 'necropolis', 'might', [1, 2, 2, 1], [30, 25, 20, 25], [25, 25, 25, 25],
    [4, 5, 5, 4, 2, 8, 0, 6, 4, 1, 7, 4, 10, 0, 1, 2, 3, 4, 2, 5, 5, 4, 7, 5, 5, 4, 5, 0, 5]),
  cls('necromancer', 'Necromancer', 'necropolis', 'magic', [1, 0, 2, 2], [15, 15, 35, 35], [25, 25, 25, 25],
    [6, 2, 4, 2, 4, 5, 0, 8, 6, 1, 5, 7, 10, 3, 2, 3, 3, 8, 6, 2, 3, 4, 3, 2, 6, 6, 1, 0, 0]),
  cls('overlord', 'Overlord', 'dungeon', 'might', [2, 2, 1, 1], [35, 35, 15, 15], [30, 30, 20, 20],
    [5, 6, 8, 5, 3, 4, 8, 3, 3, 1, 7, 2, 0, 4, 2, 1, 0, 3, 1, 10, 8, 4, 8, 6, 1, 2, 6, 1, 6]),
  cls('warlock', 'Warlock', 'dungeon', 'magic', [0, 0, 3, 2], [10, 10, 50, 30], [20, 20, 30, 30],
    [2, 2, 2, 2, 4, 4, 3, 10, 8, 2, 6, 8, 0, 5, 5, 2, 2, 5, 8, 1, 1, 4, 1, 1, 8, 10, 0, 6, 0]),
  cls('barbarian', 'Barbarian', 'stronghold', 'might', [4, 0, 1, 1], [55, 35, 5, 5], [30, 30, 20, 20],
    [8, 7, 7, 8, 1, 2, 5, 2, 3, 3, 8, 2, 0, 2, 2, 3, 0, 3, 1, 8, 8, 4, 10, 6, 1, 1, 6, 1, 6]),
  cls('battle_mage', 'Battle Mage', 'stronghold', 'magic', [2, 1, 1, 1], [30, 20, 25, 25], [25, 25, 25, 25],
    [4, 4, 9, 4, 3, 0, 4, 6, 4, 2, 6, 5, 0, 1, 3, 3, 3, 3, 4, 5, 4, 4, 8, 4, 5, 6, 4, 4, 1]),
  cls('beastmaster', 'Beastmaster', 'fortress', 'might', [0, 4, 1, 1], [30, 50, 10, 10], [30, 30, 20, 20],
    [8, 7, 8, 7, 1, 8, 5, 2, 2, 2, 7, 1, 0, 1, 0, 1, 2, 3, 1, 6, 8, 4, 5, 10, 1, 1, 5, 6, 5]),
  cls('witch', 'Witch', 'fortress', 'magic', [0, 1, 2, 2], [5, 15, 40, 40], [20, 20, 30, 30],
    [2, 3, 3, 2, 2, 6, 1, 8, 8, 4, 8, 10, 0, 1, 3, 3, 3, 3, 7, 1, 1, 4, 2, 4, 7, 8, 0, 8, 0]),
  cls('planeswalker', 'Planeswalker', 'conflux', 'might', [3, 1, 1, 1], [45, 25, 15, 15], [30, 30, 20, 20],
    [6, 8, 8, 6, 2, 5, 3, 2, 3, 2, 8, 2, 0, 3, 3, 2, 2, 3, 1, 8, 8, 8, 9, 5, 1, 1, 2, 1, 2]),
  cls('elementalist', 'Elementalist', 'conflux', 'magic', [0, 0, 3, 3], [15, 15, 35, 35], [25, 25, 25, 25],
    [2, 2, 2, 2, 4, 4, 3, 8, 8, 2, 4, 8, 0, 3, 6, 6, 6, 6, 8, 1, 1, 4, 1, 1, 8, 8, 0, 4, 0]),
  cls('captain', 'Captain', 'cove', 'might', [3, 0, 2, 1], [45, 25, 20, 10], [30, 30, 20, 20],
    [8, 9, 6, 4, 5, 6, 6, 1, 1, 7, 5, 4, 0, 4, 2, 3, 2, 4, 1, 6, 5, 2, 9, 2, 3, 2, 3, 2, 3]),
  cls('navigator', 'Navigator', 'cove', 'magic', [2, 0, 1, 2], [15, 10, 40, 35], [30, 20, 20, 30],
    [6, 6, 3, 2, 2, 6, 2, 8, 3, 4, 2, 2, 0, 2, 2, 6, 9, 5, 5, 4, 1, 4, 4, 1, 8, 6, 5, 4, 1]),
  cls('mercenary', 'Mercenary', 'factory', 'might', [3, 1, 1, 1], [35, 35, 15, 15], [30, 30, 20, 20],
    [7, 7, 7, 5, 7, 4, 5, 3, 1, 5, 6, 2, 0, 3, 3, 3, 0, 3, 1, 8, 6, 4, 6, 5, 2, 2, 4, 3, 4]),
  cls('artificer', 'Artificer', 'factory', 'magic', [0, 1, 2, 2], [20, 15, 30, 35], [20, 20, 30, 30],
    [3, 4, 5, 4, 3, 4, 2, 8, 5, 3, 8, 4, 0, 2, 4, 3, 3, 4, 5, 3, 6, 4, 2, 3, 7, 7, 0, 6, 0]),
];

export const HERO_CLASS_BY_ID = Object.fromEntries(HERO_CLASSES.map((c) => [c.id, c]));

/** @param {string} id @returns {HeroClass} */
export function getHeroClass(id) {
  const c = HERO_CLASS_BY_ID[id];
  if (!c) throw new Error(`Unknown hero class: ${id}`);
  return c;
}

/** [mightClassId, magicClassId] of a faction. */
export function getFactionClasses(faction) {
  const list = HERO_CLASSES.filter((c) => c.faction === faction);
  return [list.find((c) => c.kind === 'might').id, list.find((c) => c.kind === 'magic').id];
}

// Sanity: every skill has a weight column.
for (const id of SKILL_IDS) {
  if (!WEIGHT_ORDER.includes(id)) throw new Error(`heroClasses.js: no weight column for skill ${id}`);
}
