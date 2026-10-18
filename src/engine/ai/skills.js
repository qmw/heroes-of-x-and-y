// Secondary-skill preferences of the AI (level-up, witch huts, universities).
import { getHeroClass } from '../../data/heroClasses.js';
import { getFaction } from '../../data/factions.js';

// [might, magic, scout]
const TABLE = {
  offense: [10, 6, 3], armorer: [9, 6, 3], logistics: [9, 9, 10], leadership: [8, 4, 2],
  archery: [7, 3, 2], tactics: [5, 3, 1], resistance: [5, 4, 2], luck: [5, 4, 2],
  earth_magic: [7, 10, 4], air_magic: [6, 9, 3], fire_magic: [4, 7, 2], water_magic: [5, 8, 2],
  wisdom: [5, 10, 2], intelligence: [2, 7, 1], sorcery: [2, 7, 1], mysticism: [2, 5, 1],
  pathfinding: [5, 5, 8], scouting: [3, 3, 6], estates: [4, 4, 7], necromancy: [10, 10, 9],
  diplomacy: [4, 4, 5], artillery: [3, 1, 1], ballistics: [2, 1, 1], first_aid: [1, 1, 1],
  learning: [2, 2, 3], eagle_eye: [1, 2, 1], scholar: [1, 2, 1], navigation: [1, 1, 2],
  interference: [3, 3, 1],
};

export function heroKind(hero) {
  try {
    return getHeroClass(hero.classId).kind === 'magic' ? 'magic' : 'might';
  } catch {
    return 'might';
  }
}

/** Value of learning / raising `skillId` to `level` for this hero. */
export function skillValue(hero, skillId, level = 1, role = 'main') {
  const row = TABLE[skillId] || [1, 1, 1];
  const idx = role === 'main' ? (heroKind(hero) === 'magic' ? 1 : 0) : 2;
  let v = row[idx];
  if (skillId === 'leadership') {
    let undead = false;
    try { undead = getFaction(getHeroClass(hero.classId).faction).id === 'necropolis'; } catch { undead = false; }
    if (undead) v = 0.5;
  }
  const have = (hero.skills || []).find((s) => s.id === skillId);
  if (have) v *= 0.9 + 0.05 * (level - have.level);
  return v;
}

/** Index of the best `level_up` option. */
export function pickLevelUp(hero, options, role) {
  let best = 0;
  let bestV = -Infinity;
  options.forEach((o, i) => {
    const id = o.skillId || o.id;
    const v = skillValue(hero, id, o.level || 1, role);
    if (v > bestV) { bestV = v; best = i; }
  });
  return best;
}
