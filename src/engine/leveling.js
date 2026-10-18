// Hero experience, level-ups, secondary skill offers and hero creation.
// Pure functions over plain-JSON Hero objects (DESIGN.md §4); all randomness via core/rng.js.
// Spec: docs/mechanics/heroes.md.

import { PRIMARY_SKILLS, MAX_SECONDARY_SKILLS, MASTERY, SLOT_COUNTS, ARMY_SLOTS } from '../core/constants.js';
import { randInt, weightedPick, pick } from '../core/rng.js';
import { getHeroClass } from '../data/heroClasses.js';
import { getHeroDef } from '../data/heroes.js';
import { SKILL_IDS, MAGIC_SCHOOL_SKILLS, getSkill } from '../data/skills.js';

export const MAX_HERO_LEVEL = 74;
/** Levels between guaranteed offers: { might, magic }. */
export const WISDOM_GUARANTEE = { might: 6, magic: 3 };
export const SCHOOL_GUARANTEE = { might: 4, magic: 3 };
/** Placeholder adventure movement points until the movement engine recomputes them. */
export const BASE_MOVE_POINTS = 1500;

// Artifact ids assumed to exist in src/data/artifacts.js (CROSS-REFERENCES).
export const SPELL_BOOK_ARTIFACT = 'spellbook';
export const CATAPULT_ARTIFACT = 'catapult';
/** war_machine slot index of each machine artifact. */
export const WAR_MACHINE_SLOT = { ballista: 0, cannon: 0, ammo_cart: 1, first_aid_tent: 2, catapult: 3 };

/**
 * @typedef {{skillId: string, level: number}} SkillOffer  level = mastery after accepting (1..3)
 * @typedef {{level: number, primary: string, offers: SkillOffer[]|null}} LevelUp
 */

// ---------------------------------------------------------------------------------------------
// Experience table
// ---------------------------------------------------------------------------------------------

const EXP_FIXED = [0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, 12200, 14700, 17500, 20600, 24320];

const EXP_TABLE = (() => {
  const t = EXP_FIXED.slice();
  let diff = t[12] - t[11];
  while (t.length < MAX_HERO_LEVEL) {
    diff = Math.floor(diff * 1.2);
    t.push(t[t.length - 1] + diff);
  }
  return t;
})();

/**
 * Total experience required to reach `level` (level 1 = 0).
 * @param {number} level 1..MAX_HERO_LEVEL
 */
export function expForLevel(level) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_HERO_LEVEL) {
    throw new Error(`Bad hero level: ${level}`);
  }
  return EXP_TABLE[level - 1];
}

/** Level a hero with `exp` total experience has (1..MAX_HERO_LEVEL). */
export function levelForExp(exp) {
  let level = 1;
  while (level < MAX_HERO_LEVEL && exp >= EXP_TABLE[level]) level++;
  return level;
}

// ---------------------------------------------------------------------------------------------
// Primary skills
// ---------------------------------------------------------------------------------------------

/**
 * Roll which primary skill increases when reaching `level`.
 * Levels 2-9 use the class's low table, 10+ the high table.
 * @returns {'attack'|'defense'|'power'|'knowledge'}
 */
export function rollPrimarySkill(rng, classId, level) {
  const cls = getHeroClass(classId);
  const chances = level < 10 ? cls.primaryChancesLow : cls.primaryChancesHigh;
  return weightedPick(rng, PRIMARY_SKILLS, PRIMARY_SKILLS.map((s) => chances[s]));
}

// ---------------------------------------------------------------------------------------------
// Secondary skills
// ---------------------------------------------------------------------------------------------

/** Mastery (0..3) of a secondary skill on a hero. */
export function getSkillLevel(hero, skillId) {
  const s = hero.skills.find((x) => x.id === skillId);
  return s ? s.level : MASTERY.NONE;
}

function ensureCounters(hero) {
  if (!hero.skillCounters) hero.skillCounters = { wisdom: 0, school: 0 };
  return hero.skillCounters;
}

/**
 * Generate the secondary skill options for ONE level-up (0, 1 or 2 options).
 * Call exactly once per level gained, after the previous level-up's choice was applied:
 * it advances `hero.skillCounters` (the Wisdom / magic school guarantee counters) and `rng`.
 *
 * Rules (see docs/mechanics/heroes.md §5):
 *  - option 1 is an upgrade of an owned, non-Expert skill when one exists (uniform draw);
 *  - option 2 is a new skill (class-weighted, weight > 0) when a slot is free, otherwise a second upgrade;
 *  - with nothing to upgrade both options are new skills;
 *  - Wisdom / a magic school is forced into the offer when its guarantee counter is due.
 * @returns {SkillOffer[]}
 */
export function offerSecondarySkills(rng, hero) {
  const cls = getHeroClass(hero.classId);
  const counters = ensureCounters(hero);
  counters.wisdom++;
  counters.school++;
  const wisdomDue = counters.wisdom >= WISDOM_GUARANTEE[cls.kind];
  const schoolDue = counters.school >= SCHOOL_GUARANTEE[cls.kind];

  const weight = (id) => cls.skillWeights[id] || 0;
  const upgradable = hero.skills.filter((s) => s.level < MASTERY.EXPERT).map((s) => s.id);
  const fresh = hero.skills.length < MAX_SECONDARY_SKILLS
    ? SKILL_IDS.filter((id) => getSkillLevel(hero, id) === 0 && weight(id) > 0)
    : [];

  /** @type {string[]} */
  const chosen = [];
  const isSchool = (id) => MAGIC_SCHOOL_SKILLS.includes(id);

  // Upgrades are drawn uniformly among the owned Basic/Advanced skills, new skills by the class
  // weights (original rule; weight-0 skills never appear in `fresh`).
  const pickFrom = (pool, weighted) => {
    const options = pool.filter((id) => !chosen.includes(id));
    if (options.length === 0) return;
    let id;
    const schools = options.filter(isSchool);
    const draw = (list) => (weighted ? weightedPick(rng, list, list.map((s) => Math.max(weight(s), 1))) : pick(rng, list));
    if (wisdomDue && options.includes('wisdom') && !chosen.includes('wisdom')) {
      id = 'wisdom';
    } else if (schoolDue && schools.length > 0 && !chosen.some(isSchool)) {
      id = draw(schools);
    } else {
      id = draw(options);
    }
    chosen.push(id);
  };

  if (upgradable.length > 0) {
    pickFrom(upgradable, false);
    if (fresh.length > 0) pickFrom(fresh, true);
    else pickFrom(upgradable, false);
  } else {
    pickFrom(fresh, true);
    pickFrom(fresh, true);
  }

  if (chosen.includes('wisdom')) counters.wisdom = 0;
  if (chosen.some(isSchool)) counters.school = 0;

  return chosen.map((id) => ({ skillId: id, level: getSkillLevel(hero, id) + 1 }));
}

/**
 * Learn a new secondary skill at Basic or raise an owned one by one mastery level.
 * @returns {{ok: true, skillId: string, level: number} | {ok: false, error: string}}
 */
export function applySkillChoice(hero, skillId) {
  getSkill(skillId); // throws on unknown id
  const owned = hero.skills.find((s) => s.id === skillId);
  if (owned) {
    if (owned.level >= MASTERY.EXPERT) return { ok: false, error: 'skill_already_expert' };
    owned.level++;
    return { ok: true, skillId, level: owned.level };
  }
  if (hero.skills.length >= MAX_SECONDARY_SKILLS) return { ok: false, error: 'no_free_skill_slot' };
  hero.skills.push({ id: skillId, level: MASTERY.BASIC });
  return { ok: true, skillId, level: MASTERY.BASIC };
}

// ---------------------------------------------------------------------------------------------
// Experience gain
// ---------------------------------------------------------------------------------------------

/**
 * Add experience and process every level-up it causes: the level and the rolled primary skill
 * are applied immediately. Secondary skill choices are NOT resolved here.
 *
 * `amount` is the final amount: the caller applies Learning (`experience_percent`) beforehand.
 *
 * Offers of a level-up depend on the choice made at the previous one, so only the first
 * level-up that needs a decision carries `offers`; every later one has `offers: null`
 * and the caller must call `offerSecondarySkills(rng, hero)` for it once the earlier choice has
 * been applied with `applySkillChoice`. (Level-ups with an empty offer list need no decision,
 * so the chain continues past them.)
 * @returns {{levelUps: LevelUp[]}}
 */
export function gainExperience(rng, hero, amount) {
  if (!(amount >= 0)) throw new Error(`Bad experience amount: ${amount}`);
  hero.exp += Math.floor(amount);
  /** @type {LevelUp[]} */
  const levelUps = [];
  let blocked = false; // a previous level-up still awaits the player's choice
  while (hero.level < MAX_HERO_LEVEL && hero.exp >= EXP_TABLE[hero.level]) {
    hero.level++;
    const primary = rollPrimarySkill(rng, hero.classId, hero.level);
    hero.primary[primary]++;
    let offers = null;
    if (!blocked) {
      offers = offerSecondarySkills(rng, hero);
      if (offers.length > 0) blocked = true;
    }
    levelUps.push({ level: hero.level, primary, offers });
  }
  return { levelUps };
}

// ---------------------------------------------------------------------------------------------
// Specialties
// ---------------------------------------------------------------------------------------------

/**
 * Translate a hero specialty into Bonus objects for the aggregator at a given hero level.
 * Semantics of every emitted type: docs/mechanics/heroes.md ("Bonus types", "Specialty types").
 * @param {string} defId hero definition id
 * @param {number} heroLevel
 * @returns {Array<{type: string, [k: string]: any}>}
 */
export function specialtyBonuses(defId, heroLevel) {
  const sp = getHeroDef(defId).specialty;
  switch (sp.type) {
    case 'creature':
      return [
        { type: 'creature_stat', filter: { creatureIds: sp.creatures }, stat: 'speed', value: 1 },
        { type: 'creature_specialty', creatures: sp.creatures, percentPerStep: 5, heroLevel },
      ];
    case 'war_machine':
      return [{ type: 'creature_specialty', creatures: [sp.machineId], tier: sp.tier, percentPerStep: 5, heroLevel }];
    case 'creature_bonus':
      return ['attack', 'defense', 'damage', 'speed']
        .filter((stat) => sp[stat])
        .map((stat) => ({ type: 'creature_stat', filter: { creatureIds: sp.creatures }, stat, value: sp[stat] }));
    case 'creature_upgrade':
      return [{ type: 'creature_upgrade', upgrades: sp.upgrades }];
    case 'skill':
      return [{ type: 'skill_percent', skillId: sp.skillId, percent: 5 * heroLevel }];
    case 'spell': {
      const b = { type: 'spell_specialty', spellId: sp.spellId, mode: sp.mode, heroLevel };
      for (const k of ['percentPerStep', 'tierBonus', 'percent', 'value']) if (k in sp) b[k] = sp[k];
      return [b];
    }
    case 'resource':
      return [{ type: 'resource_income', resource: sp.resource, value: sp.amount }];
    case 'speed':
      return [{ type: 'creature_stat', stat: 'speed', value: sp.value }];
    case 'mastery':
      return [{ type: 'spell_school_mastery', school: sp.school, level: MASTERY.EXPERT }];
    default:
      throw new Error(`Unknown specialty type: ${sp.type}`);
  }
}

/**
 * Attack/defense bonus a `creature_specialty` bonus gives to one stat of one creature:
 * ceil(base * percentPerStep% * floor(heroLevel / tier)).
 */
export function creatureSpecialtyStatBonus(baseStat, creatureTier, heroLevel, percentPerStep = 5) {
  const steps = Math.floor(heroLevel / Math.max(1, creatureTier));
  return Math.ceil((baseStat * percentPerStep * steps) / 100);
}

// ---------------------------------------------------------------------------------------------
// Hero creation
// ---------------------------------------------------------------------------------------------

function emptyEquipment() {
  const equipped = {};
  for (const [slot, count] of Object.entries(SLOT_COUNTS)) equipped[slot] = new Array(count).fill(null);
  return equipped;
}

/**
 * Build a level 1 Hero state object (DESIGN.md §4) from a hero definition.
 * @param {{s:number}} rng
 * @param {string} defId
 * @param {{id?: string, owner?: number|null, pos?: {x:number,y:number,z:number}}} [opts]
 */
export function createHero(rng, defId, opts = {}) {
  const def = getHeroDef(defId);
  const cls = getHeroClass(def.classId);
  const primary = { ...cls.startPrimary };

  const equipped = emptyEquipment();
  equipped.war_machine[WAR_MACHINE_SLOT[CATAPULT_ARTIFACT]] = CATAPULT_ARTIFACT;
  if (def.startWarMachine) equipped.war_machine[WAR_MACHINE_SLOT[def.startWarMachine]] = def.startWarMachine;
  if (cls.kind === 'magic' || def.startSpell) equipped.spellbook[0] = SPELL_BOOK_ARTIFACT;

  const army = new Array(ARMY_SLOTS).fill(null);
  def.startArmy.forEach((stack, i) => {
    army[i] = { creatureId: stack.creatureId, count: randInt(rng, stack.min, stack.max) };
  });

  return {
    id: opts.id || def.id,
    defId: def.id,
    name: def.name,
    classId: def.classId,
    owner: opts.owner ?? null,
    pos: opts.pos ? { ...opts.pos } : { x: 0, y: 0, z: 0 },
    primary,
    level: 1,
    exp: 0,
    mana: 10 * primary.knowledge,
    movePoints: BASE_MOVE_POINTS,
    maxMovePoints: BASE_MOVE_POINTS,
    skills: def.startSkills.map((s) => ({ id: s.id, level: s.level })),
    spells: def.startSpell ? [def.startSpell] : [],
    artifacts: { equipped, backpack: [] },
    army,
    temp: [],
    visited: {},
    inBoat: false,
    townId: null,
    garrisoned: false,
    asleep: false,
    skillCounters: { wisdom: 0, school: 0 },
  };
}
