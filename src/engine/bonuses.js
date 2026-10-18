// Bonus aggregator: collects every Bonus that applies to a hero (secondary skills, artifacts,
// specialty, temporary effects, owner-wide town buildings, flagged lighthouses) and derives the
// hero-level numbers from them (primary skills, mana, movement, sight, morale, luck, necromancy).
// Spec: docs/mechanics/hero-engine.md §1 (and the "Bonus types" sections of heroes.md / artifacts.md).

import { PRIMARY_SKILLS, MASTERY, SPELL_SCHOOLS, RESOURCES, emptyResources } from '../core/constants.js';
import { getSkill } from '../data/skills.js';
import { getCreature, creatureTags, getCreatureAbility } from '../data/creatures.js';
import { FACTION_BY_ID } from '../data/factions.js';
import { BUILDING_BY_ID, getBuildingEffects } from '../data/buildings.js';
import { MAP_OBJECT_BY_ID } from '../data/mapObjects.js';
import { MAGIC_TERRAIN_BY_ID } from '../data/terrain.js';
import { getArtifactBonuses } from './artifacts.js';
import { specialtyBonuses, getSkillLevel as levelOfSkill } from './leveling.js';
import { armySlowestSpeed } from './army.js';

/** @typedef {{type: string, value?: number, percent?: number, source?: string, [k: string]: any}} Bonus */

export const BASE_SIGHT_RADIUS = 5;
export const BASE_MANA_REGEN = 1;
export const MANA_PER_KNOWLEDGE = 10;
export const BASE_SEA_MOVE_POINTS = 1500;
/** Land movement points by the base speed of the slowest creature (index = speed, clamped 3..11). */
export const LAND_MOVE_BY_SPEED = { 3: 1500, 4: 1560, 5: 1630, 6: 1700, 7: 1760, 8: 1830, 9: 1900, 10: 1960, 11: 2000 };
export const MORALE_MIN = -3;
export const MORALE_MAX = 3;
export const PRIMARY_MIN = { attack: 0, defense: 0, power: 1, knowledge: 1 };
export const NECROMANCY_CAP = 100;
export const DEFAULT_RAISED_CREATURE = 'skeleton';
export const SURRENDER_DISCOUNT_CAP = 90;

/** Bonus types that only matter on the adventure map / in the economy (not needed by combat). */
export const NON_COMBAT_BONUS_TYPES = [
  'movement_land', 'movement_sea', 'terrain_penalty_reduction', 'sight_radius', 'mana_regen',
  'mana_regen_full', 'mana_max_percent', 'learn_spell_level', 'resource_income', 'creature_growth',
  'experience_percent', 'scholar', 'diplomacy', 'fly', 'water_walk', 'free_boarding',
  'marketplace_count', 'army_strength_percent', 'surrender_cost_percent', 'creature_upgrade', 'grail',
  'skill_percent',
];

// ---------------------------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------------------------

/** Mastery (0..3) of a secondary skill on a hero. */
export function getSkillLevel(hero, skillId) {
  return levelOfSkill(hero, skillId);
}

function matches(b, type, match) {
  if (b.type !== type) return false;
  if (!match) return true;
  if (typeof match === 'function') return !!match(b);
  for (const k of Object.keys(match)) if (b[k] !== match[k]) return false;
  return true;
}

/** Bonuses of one type; `match` = object of fields that must be equal, or a predicate. */
export function filterBonuses(bonuses, type, match) {
  return bonuses.filter((b) => matches(b, type, match));
}

export function hasBonus(bonuses, type, match) {
  return bonuses.some((b) => matches(b, type, match));
}

/**
 * Sum of a bonus type: each matching bonus contributes its `value`, or its `percent` when it has
 * no `value`. For types that mix both forms (`movement_land`, `movement_sea`, `creature_stat`,
 * `creature_growth`) use `sumBonusValue` / `sumBonusPercent`.
 */
export function sumBonus(bonuses, type, match) {
  let sum = 0;
  for (const b of bonuses) if (matches(b, type, match)) sum += b.value ?? b.percent ?? 0;
  return sum;
}

/** Sum of the `value` field only. */
export function sumBonusValue(bonuses, type, match) {
  let sum = 0;
  for (const b of bonuses) if (matches(b, type, match) && typeof b.value === 'number') sum += b.value;
  return sum;
}

/** Sum of the `percent` field of every bonus of `type`. */
export function sumBonusPercent(bonuses, type, match) {
  let sum = 0;
  for (const b of bonuses) if (matches(b, type, match) && typeof b.percent === 'number') sum += b.percent;
  return sum;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

/**
 * Bonuses of the hero's secondary skills. `skillPercent` = { [skillId]: percent } from
 * `skill_percent` bonuses: the skill's `specialtyParam` field of effects[0] is multiplied by
 * (1 + percent/100). Integer-valued params (`value`, `healMax`) are rounded down.
 */
export function getSkillBonuses(hero, skillPercent = {}) {
  const out = [];
  for (const s of hero.skills || []) {
    const def = getSkill(s.id);
    const effects = def.levels[s.level - 1].effects;
    effects.forEach((e, i) => {
      const b = { ...e, source: `skill:${s.id}` };
      const pct = skillPercent[s.id] || 0;
      const param = def.specialtyParam;
      if (i === 0 && pct && param && typeof b[param] === 'number') {
        const scaled = b[param] * (1 + pct / 100);
        b[param] = param === 'percent' ? Math.round(scaled * 1000) / 1000 : Math.floor(scaled + 1e-9);
        b.scaledBy = pct;
      }
      out.push(b);
    });
  }
  return out;
}

/**
 * Owner-wide bonuses from town buildings: `player_hero_bonus` (same building id in several towns
 * counts once) and `necromancy_bonus` (stacks per town, emitted as `necromancy_percent`).
 */
export function getTownBuildingBonuses(state, playerId) {
  const out = [];
  if (playerId == null || !state?.towns) return out;
  const seen = new Set();
  for (const town of Object.values(state.towns)) {
    if (town.owner !== playerId) continue;
    for (const bid of town.buildings || []) {
      if (!BUILDING_BY_ID[bid]) continue;
      for (const e of getBuildingEffects(bid, town.faction)) {
        if (e.type === 'player_hero_bonus') {
          if (seen.has(bid)) continue;
          out.push({ ...e.bonus, source: `building:${bid}` });
        } else if (e.type === 'necromancy_bonus') {
          out.push({ type: 'necromancy_percent', percent: e.percent, source: `building:${bid}`, townId: town.id });
        }
      }
      seen.add(bid);
    }
  }
  return out;
}

/** Bonuses from flagged adventure objects that help every hero of the owner (lighthouses; cumulative). */
export function getOwnedObjectBonuses(state, playerId) {
  const out = [];
  const objects = state?.map?.objects;
  if (playerId == null || !objects) return out;
  for (const obj of Object.values(objects)) {
    if (obj.owner !== playerId) continue;
    const def = MAP_OBJECT_BY_ID[obj.defId];
    if (!def || def.effect?.type !== 'lighthouse') continue;
    for (const b of def.effect.bonuses || []) out.push({ ...b, source: `object:${obj.defId}`, objectId: obj.id });
  }
  return out;
}

/**
 * Every bonus applying to the hero, each a copy tagged with `source`
 * (`skill:<id>`, `artifact:<id>`, `specialty`, `temp:<source>`, `building:<id>`, `object:<defId>`).
 * Skill bonuses are already scaled by `skill_percent` (which is also kept in the list).
 * @returns {Bonus[]}
 */
export function getHeroBonuses(state, hero) {
  if (!hero) return [];
  const other = [];
  for (const b of getArtifactBonuses(hero)) other.push(b);
  if (hero.defId) for (const b of specialtyBonuses(hero.defId, hero.level || 1)) other.push({ ...b, source: 'specialty' });
  for (const t of hero.temp || []) other.push({ ...t.bonus, source: `temp:${t.source}`, until: t.until });
  for (const b of getTownBuildingBonuses(state, hero.owner)) other.push(b);
  for (const b of getOwnedObjectBonuses(state, hero.owner)) other.push(b);

  const skillPercent = {};
  for (const b of other) {
    if (b.type === 'skill_percent') skillPercent[b.skillId] = (skillPercent[b.skillId] || 0) + (b.percent || 0);
  }
  return [...getSkillBonuses(hero, skillPercent), ...other];
}

// ---------------------------------------------------------------------------------------------
// Primary skills, mana, sight
// ---------------------------------------------------------------------------------------------

/**
 * Effective primary skills: base + `primary` bonuses, never below 0 (attack/defense) or 1
 * (power/knowledge). `extra` = additional bonuses (e.g. town garrison bonuses for a siege).
 */
export function getPrimary(state, hero, extra = []) {
  const bonuses = [...getHeroBonuses(state, hero), ...extra];
  const out = {};
  for (const stat of PRIMARY_SKILLS) {
    out[stat] = Math.max(PRIMARY_MIN[stat], (hero.primary[stat] || 0) + sumBonus(bonuses, 'primary', { stat }));
  }
  return out;
}

/** Maximum spell points: 10 x knowledge x (1 + sum of `mana_max_percent`/100), rounded down. */
export function getMaxMana(state, hero) {
  const bonuses = getHeroBonuses(state, hero);
  const knowledge = Math.max(PRIMARY_MIN.knowledge, hero.primary.knowledge + sumBonus(bonuses, 'primary', { stat: 'knowledge' }));
  const pct = sumBonusPercent(bonuses, 'mana_max_percent');
  return Math.max(0, Math.floor((MANA_PER_KNOWLEDGE * knowledge * (100 + pct)) / 100 + 1e-9));
}

/** Spell points regenerated per day: 1 + `mana_regen` bonuses (Mysticism, artifacts, grail). */
export function getManaRegen(state, hero) {
  return Math.max(0, BASE_MANA_REGEN + Math.floor(sumBonus(getHeroBonuses(state, hero), 'mana_regen')));
}

/** Adventure map sight radius in tiles: 5 + `sight_radius` bonuses. */
export function getSightRadius(state, hero) {
  return Math.max(1, BASE_SIGHT_RADIUS + Math.floor(sumBonus(getHeroBonuses(state, hero), 'sight_radius')));
}

// ---------------------------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------------------------

/** Base land movement points for an army (by its slowest creature's base speed). */
export function landMoveBase(army) {
  const speed = armySlowestSpeed(army);
  if (speed === null) return LAND_MOVE_BY_SPEED[11];
  return LAND_MOVE_BY_SPEED[clamp(speed, 3, 11)];
}

/**
 * Daily movement points. Land: table base x (1 + `movement_land` percent/100) + flat values.
 * Sea (hero.inBoat, or opts.sea): 1500 x (1 + `movement_sea` percent/100) + flat values.
 * @param {{sea?: boolean}} [opts] force the land (false) or sea (true) figure
 */
export function getMaxMovePoints(state, hero, opts = {}) {
  const sea = opts.sea ?? !!hero.inBoat;
  const bonuses = getHeroBonuses(state, hero);
  const type = sea ? 'movement_sea' : 'movement_land';
  const base = sea ? BASE_SEA_MOVE_POINTS : landMoveBase(hero.army);
  const pct = sumBonusPercent(bonuses, type);
  return Math.max(0, Math.floor((base * (100 + pct)) / 100 + 1e-9) + Math.floor(sumBonusValue(bonuses, type)));
}

/**
 * Terrain penalty reduction for the pathfinder:
 * `points` = Pathfinding skill (subtracted from a tile's cost, never below 100; scaled by a
 * specialty), `level` = Pathfinding mastery, `percent` = artifact reduction of the penalty (0..100).
 */
export function getTerrainPenaltyReduction(state, hero) {
  const bonuses = filterBonuses(getHeroBonuses(state, hero), 'terrain_penalty_reduction');
  let points = 0;
  let percent = 0;
  for (const b of bonuses) {
    if (b.source === 'skill:pathfinding') points += b.percent || 0;
    else percent += b.percent || 0;
  }
  return { points, level: getSkillLevel(hero, 'pathfinding'), percent: clamp(percent, 0, 100) };
}

// ---------------------------------------------------------------------------------------------
// Magic helpers
// ---------------------------------------------------------------------------------------------

/** Highest spell level the hero may learn (2 without Wisdom). */
export function getLearnSpellLevel(state, hero) {
  let max = 2;
  for (const b of filterBonuses(getHeroBonuses(state, hero), 'learn_spell_level')) max = Math.max(max, b.level || 0);
  return max;
}

/** Mastery (0..3) of each magic school: { air, earth, fire, water }. */
export function getSchoolMastery(state, hero) {
  const out = {};
  for (const s of SPELL_SCHOOLS) out[s] = MASTERY.NONE;
  for (const b of filterBonuses(getHeroBonuses(state, hero), 'spell_school_mastery')) {
    const schools = b.school === 'all' ? SPELL_SCHOOLS : [b.school];
    for (const s of schools) if (s in out) out[s] = Math.max(out[s], b.level || 0);
  }
  return out;
}

/** Eagle Eye: null without the skill; else { percent (skill + artifacts), maxLevel }. */
export function getEagleEye(state, hero) {
  const all = filterBonuses(getHeroBonuses(state, hero), 'eagle_eye');
  const skill = all.find((b) => b.source === 'skill:eagle_eye');
  if (!skill) return null;
  return { percent: clamp(all.reduce((s, b) => s + (b.percent || 0), 0), 0, 100), maxLevel: skill.maxLevel };
}

/** Scholar: highest spell level the hero can exchange (0 without the skill). */
export function getScholarLevel(state, hero) {
  let max = 0;
  for (const b of filterBonuses(getHeroBonuses(state, hero), 'scholar')) max = Math.max(max, b.maxLevel || 0);
  return max;
}

// ---------------------------------------------------------------------------------------------
// Economy helpers
// ---------------------------------------------------------------------------------------------

/** Multiplier applied to experience gains: 1 + sum of `experience_percent`/100. */
export function getExperienceMultiplier(state, hero) {
  return 1 + sumBonusPercent(getHeroBonuses(state, hero), 'experience_percent') / 100;
}

/** Daily resources the hero brings to the owner (Estates, resource specialties, artifacts). */
export function getHeroIncome(state, hero) {
  const out = emptyResources();
  for (const b of filterBonuses(getHeroBonuses(state, hero), 'resource_income')) {
    if (RESOURCES.includes(b.resource)) out[b.resource] += Math.floor(b.value || 0);
  }
  return out;
}

/** Diplomacy: { level, joinPercent, surrenderDiscountPercent } (zeros without the skill). */
export function getDiplomacy(state, hero) {
  const b = filterBonuses(getHeroBonuses(state, hero), 'diplomacy')[0];
  return b
    ? { level: b.level, joinPercent: b.joinPercent, surrenderDiscountPercent: b.surrenderDiscountPercent }
    : { level: 0, joinPercent: 0, surrenderDiscountPercent: 0 };
}

/**
 * Multiplier of the surrender price: 1 - (Diplomacy discount + artifact reductions)/100, the
 * total reduction capped at 90 %.
 */
export function getSurrenderCostMultiplier(state, hero) {
  const bonuses = getHeroBonuses(state, hero);
  const dip = filterBonuses(bonuses, 'diplomacy').reduce((s, b) => s + (b.surrenderDiscountPercent || 0), 0);
  const art = -sumBonusPercent(bonuses, 'surrender_cost_percent');
  return 1 - clamp(dip + art, 0, SURRENDER_DISCOUNT_CAP) / 100;
}

/** Army strength multiplier used when wandering monsters decide to flee/join (Diplomat's Cloak). */
export function getNegotiationStrengthMultiplier(state, hero) {
  return 1 + sumBonusPercent(getHeroBonuses(state, hero), 'army_strength_percent') / 100;
}

// ---------------------------------------------------------------------------------------------
// Morale and luck
// ---------------------------------------------------------------------------------------------

/** Does a stack of this creature roll for morale? (undead, non-living and war machines do not) */
export function creatureUsesMorale(creatureId) {
  const c = getCreature(creatureId);
  if (c.warMachine) return false;
  const tags = creatureTags(c);
  return !tags.includes('undead') && !tags.includes('non_living');
}

/** Does a stack of this creature roll for luck? (everything except war machines) */
export function creatureUsesLuck(creatureId) {
  return !getCreature(creatureId).warMachine;
}

function creatureAlignment(creature) {
  const f = FACTION_BY_ID[creature.faction];
  return f ? f.alignment : 'neutral';
}

/**
 * Morale modifier for the number of different town types in an army:
 * 1 -> +1, 2 -> 0, 3 -> -1, 4 -> -2, ... `mergedFactions` (Angelic Alliance) count as one.
 */
export function alignmentMorale(army, mergedFactions = []) {
  const groups = new Set();
  for (const s of army || []) {
    if (!s || s.count <= 0) continue;
    const f = getCreature(s.creatureId).faction || 'neutral';
    groups.add(mergedFactions.includes(f) ? '*merged*' : f);
  }
  const n = groups.size;
  if (n === 0) return { count: 0, value: 0 };
  return { count: n, value: n === 1 ? 1 : 2 - n };
}

function stacksOf(army) {
  return (army || []).filter((s) => s && s.count > 0).map((s) => getCreature(s.creatureId));
}

/** Strongest (non-stacking) value of an aura ability among the stacks: max for positive, min for negative. */
function auraValue(army, abilityId, sign) {
  let best = 0;
  for (const c of stacksOf(army)) {
    const ab = getCreatureAbility(c, abilityId);
    if (!ab) continue;
    const v = ab.value ?? sign;
    best = sign > 0 ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

function resolveHero(state, hero) {
  if (!hero) return null;
  return typeof hero === 'string' ? state.heroes[hero] : hero;
}

/** `garrison_bonus` effects of a town's buildings as plain {stat, value, source} entries. */
export function getGarrisonBonuses(state, townId) {
  const town = state?.towns?.[townId];
  const out = [];
  if (!town) return out;
  for (const bid of town.buildings || []) {
    if (!BUILDING_BY_ID[bid]) continue;
    for (const e of getBuildingEffects(bid, town.faction)) {
      if (e.type === 'garrison_bonus') out.push({ stat: e.stat, value: e.value, source: `building:${bid}` });
    }
  }
  return out;
}

function overlayEffects(overlay) {
  if (!overlay) return [];
  const m = MAGIC_TERRAIN_BY_ID[overlay];
  return m ? m.effects : [];
}

/**
 * @typedef {object} MoraleSpec
 * @property {object|string} [hero]   hero (or id) leading the army
 * @property {Array} army
 * @property {string} [townId]        town whose `garrison_bonus` buildings help this army ...
 * @property {boolean} [siege]        ... only when it is defended in a siege (default: true when townId is given)
 * @property {string} [overlay]       magic terrain id of the battlefield (`terrain` is accepted for symmetry and ignored)
 * @property {{hero?: object|string, army?: Array}} [enemy]  opponent (enemy_morale / enemy_luck sources)
 * @property {Bonus[]} [bonuses]      pre-computed hero bonuses (skips aggregation)
 */

function moraleLuck(state, spec, kind) {
  const hero = resolveHero(state, spec.hero);
  const army = spec.army || (hero ? hero.army : []);
  const bonuses = spec.bonuses || (hero ? getHeroBonuses(state, hero) : []);
  const enemyHero = resolveHero(state, spec.enemy?.hero);
  const enemyBonuses = spec.enemy?.bonuses || (enemyHero ? getHeroBonuses(state, enemyHero) : []);
  const enemyArmy = spec.enemy?.army || (enemyHero ? enemyHero.army : []);
  const items = [];
  const add = (source, value) => { if (value) items.push({ source, value }); };

  if (kind === 'morale') {
    const merged = filterBonuses(bonuses, 'no_alignment_penalty').flatMap((b) => b.factions || []);
    add('alignment', alignmentMorale(army, merged).value);
    if (stacksOf(army).some((c) => creatureTags(c).includes('undead'))) add('undead', -1);
    add('creature:army_morale', auraValue(army, 'army_morale', 1));
  }
  for (const b of bonuses) if (b.type === kind && typeof b.value === 'number') add(b.source || 'hero', b.value);
  if (spec.townId && spec.siege !== false) {
    for (const g of getGarrisonBonuses(state, spec.townId)) if (g.stat === kind) add(g.source, g.value);
  }
  const enemyType = `enemy_${kind}`;
  for (const b of enemyBonuses) if (b.type === enemyType && typeof b.value === 'number') add(`enemy:${b.source || 'hero'}`, b.value);
  add(`enemy:creature:${enemyType}`, auraValue(enemyArmy, enemyType, -1));

  const effects = overlayEffects(spec.overlay);
  const nullified = effects.some((e) => e.type === 'nullify_morale_luck');
  const blockType = `block_positive_${kind}`;
  const blockedPositive = hasBonus(bonuses, blockType) || hasBonus(enemyBonuses, blockType);
  const raw = items.reduce((s, it) => s + it.value, 0);
  const finish = (v) => {
    let out = clamp(v, MORALE_MIN, MORALE_MAX);
    if (blockedPositive) out = Math.min(out, 0);
    if (nullified) out = 0;
    return out;
  };

  const uses = kind === 'morale' ? creatureUsesMorale : creatureUsesLuck;
  const positiveAbility = `positive_${kind}`;
  const perStack = (army || []).map((s) => {
    if (!s || s.count <= 0) return null;
    if (!uses(s.creatureId)) return 0;
    const c = getCreature(s.creatureId);
    const align = creatureAlignment(c);
    let v = raw;
    for (const e of effects) {
      if (e.type === kind && (e.alignment === 'all' || e.alignment === align)) v += e.value;
    }
    v = clamp(v, MORALE_MIN, MORALE_MAX);
    if (getCreatureAbility(c, positiveAbility)) v = Math.max(v, 1);
    return finish(v);
  });
  const anyUses = perStack.some((v, i) => v !== null && uses(army[i].creatureId));
  // `base` = what the combat engine takes as the side's starting value: it adds creature auras
  // and the enemy's reductions itself (they change while stacks die) and clamps per stack.
  const base = items.filter((it) => !it.source.startsWith('enemy:') && !it.source.startsWith('creature:'))
    .reduce((s, it) => s + it.value, 0);
  return { value: anyUses ? finish(raw) : 0, raw, base, items, perStack, blockedPositive, nullified, applies: anyUses };
}

/**
 * Full morale breakdown: `{ value (clamped -3..+3, 0 when no stack uses morale), raw, base (raw
 * without creature auras and enemy effects), items: [{source, value}],
 * perStack: [number|null x7], blockedPositive, nullified, applies }`.
 * @param {MoraleSpec} spec
 */
export function getArmyMoraleDetails(state, spec) {
  return moraleLuck(state, spec, 'morale');
}

/** Same breakdown for luck. */
export function getArmyLuckDetails(state, spec) {
  return moraleLuck(state, spec, 'luck');
}

/** Army morale, -3..+3. @param {MoraleSpec} spec */
export function getArmyMorale(state, spec) {
  return moraleLuck(state, spec, 'morale').value;
}

/** Army luck, -3..+3. @param {MoraleSpec} spec */
export function getArmyLuck(state, spec) {
  return moraleLuck(state, spec, 'luck').value;
}

// ---------------------------------------------------------------------------------------------
// Necromancy
// ---------------------------------------------------------------------------------------------

/**
 * Necromancy of a hero: `{ percent, level, creatureId, active }`.
 * percent = Necromancy skill (scaled by a specialty) + artifacts (work without the skill) +
 * Necromancy Amplifiers / Soul Prison of the owner's towns, capped at 100.
 * creatureId = `skeleton`, or with the Cloak of the Undead King the entry of its `creatures`
 * list for the hero's Necromancy mastery.
 */
export function getNecromancyInfo(state, hero) {
  const bonuses = getHeroBonuses(state, hero);
  const percent = clamp(sumBonusPercent(bonuses, 'necromancy_percent'), 0, NECROMANCY_CAP);
  const level = getSkillLevel(hero, 'necromancy');
  const cloak = filterBonuses(bonuses, 'necromancy_raise')[0];
  const creatureId = cloak ? (cloak.creatures[level] || DEFAULT_RAISED_CREATURE) : DEFAULT_RAISED_CREATURE;
  return { percent, level, creatureId, active: percent > 0 };
}
