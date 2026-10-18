// Hero lifecycle, experience, spells, temporary bonuses, trading and the combat adapters.
// Spec: docs/mechanics/hero-engine.md. Contract: docs/DESIGN.md §8 ("hero agent" block), §5.

import { MAX_HEROES_PER_PLAYER } from '../core/constants.js';
import { randInt, chance } from '../core/rng.js';
import { getHeroDef } from '../data/heroes.js';
import { getCreature, creatureTags } from '../data/creatures.js';
import { getSpell, HERO_SPELLS, spellSchools } from '../data/spells.js';
import { BUILDING_BY_ID, getBuildingEffects } from '../data/buildings.js';
import { FACTION_BY_ID } from '../data/factions.js';
import { MAGIC_TERRAIN_BY_ID } from '../data/terrain.js';
import {
  createHero, expForLevel, rollPrimarySkill, offerSecondarySkills, applySkillChoice, MAX_HERO_LEVEL,
} from './leveling.js';
import {
  hasArtifact, getWarMachines, transferArtifact, captureArtifacts, removeArtifact, ensureArtifacts,
  getEquippedArtifacts, entryId, moveArtifact,
} from './artifacts.js';
import { getArtifact } from '../data/artifacts.js';
import { recordDefeat, areAllied } from './victory.js';
import { pushPending, registerPendingHandler, getPending } from './pending.js';
import {
  createArmy, armyClone, armyAdd, armyMove, armyIsEmpty, armyFindSlot, armyFreeSlot, armyDismiss,
} from './army.js';
import {
  getHeroBonuses, getPrimary, getMaxMana, getManaRegen, getMaxMovePoints, getLearnSpellLevel,
  getExperienceMultiplier, getEagleEye, getScholarLevel, getNecromancyInfo, getGarrisonBonuses,
  getArmyMoraleDetails, getArmyLuckDetails, getSurrenderCostMultiplier, hasBonus,
} from './bonuses.js';

export const SPELLBOOK = 'spellbook';
/** Extra experience for beating an enemy hero (used only when the combat engine reports no experience figure). */
export const HERO_DEFEAT_EXP = 500;
/** Round cap of every battle started by `startCombat` (same as the engine's `autoResolve` default). */
export const COMBAT_MAX_ROUNDS = 100;
/** Skeleton warriors raised instead of skeletons come at 2/3 of the amount. */
export const UPGRADED_RAISE_FACTOR = 2 / 3;

const ok = (events = [], extra = {}) => ({ ok: true, events, ...extra });
const fail = (error) => ({ ok: false, error });

// ---------------------------------------------------------------------------------------------
// Injectable seams: combat engine and town module (written by other agents; may be absent)
// ---------------------------------------------------------------------------------------------

let combatEngine = null;
let townModule = null;

/** Replace the combat engine ({createCombat, isOver, getResult, autoResolve?}). null = none. */
export function setCombatEngine(impl) {
  combatEngine = impl;
}
export function getCombatEngine() {
  return combatEngine;
}
/** Replace the town module hooks ({getSiegeInfo?}). */
export function setTownModule(impl) {
  townModule = impl;
}

/**
 * Resolves once the default implementations (src/engine/combat/index.js, src/engine/town.js) were
 * looked up. They are loaded without blocking module evaluation (town.js imports this module), so
 * code that needs them right at startup should `await engineReady` once. Explicit
 * `setCombatEngine` / `setTownModule` calls always win.
 */
export const engineReady = Promise.all([
  import('./combat/index.js').then((m) => { if (!combatEngine) combatEngine = m; }).catch(() => {}),
  import('./town.js').then((m) => { if (!townModule) townModule = m; }).catch(() => {}),
]).then(() => true);

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

function nextHeroId(state) {
  state.nextId = state.nextId || 1;
  let id;
  do { id = `h${state.nextId++}`; } while (state.heroes[id]);
  return id;
}

function starterStack(state, defId) {
  const first = getHeroDef(defId).startArmy[0];
  return { creatureId: first.creatureId, count: randInt(state.rng, first.min, first.max) };
}

/** Recompute `maxMovePoints` from the current army / bonuses. `refill` also resets `movePoints`. */
export function refreshMovement(state, hero, refill = false) {
  hero.maxMovePoints = getMaxMovePoints(state, hero);
  if (refill) hero.movePoints = hero.maxMovePoints;
  return hero.maxMovePoints;
}

/**
 * Create a hero for a player and register it (`state.heroes`, `player.heroes`).
 * A hero waiting in `state.heroPool` (he retreated or surrendered earlier) is re-used with his
 * level, skills and artifacts; with an empty army he gets his first start stack.
 * @param {object} state @param {string} defId @param {number|null} playerId
 * @param {{x:number,y:number,z?:number}} pos
 * @param {{id?: string, army?: Array, tavern?: boolean, townId?: string, fresh?: boolean}} [opts]
 *   `tavern`: only the first start stack (heroes hired after day 1); `fresh`: ignore the pool.
 * @returns {object} Hero
 */
export function addHero(state, defId, playerId, pos, opts = {}) {
  getHeroDef(defId);
  state.heroes = state.heroes || {};
  const id = opts.id || nextHeroId(state);
  const where = { x: pos?.x ?? 0, y: pos?.y ?? 0, z: pos?.z ?? 0 };
  let hero = !opts.fresh && state.heroPool ? state.heroPool[defId] : null;
  if (hero) {
    delete state.heroPool[defId];
    hero.id = id;
    hero.owner = playerId ?? null;
    hero.pos = where;
  } else {
    hero = createHero(state.rng, defId, { id, owner: playerId ?? null, pos: where });
    if (opts.tavern) {
      const first = hero.army[0];
      hero.army = createArmy();
      hero.army[0] = first;
    }
  }
  if (opts.army) hero.army = armyClone(opts.army);
  if (armyIsEmpty(hero.army)) hero.army[0] = starterStack(state, defId);
  ensureArtifacts(hero);
  hero.temp = hero.temp || [];
  hero.visited = hero.visited || {};
  hero.townId = opts.townId ?? null;
  hero.garrisoned = false;
  hero.inBoat = false;
  hero.asleep = false;
  state.heroes[id] = hero;
  const player = playerId != null ? state.players?.[playerId] : null;
  if (player) {
    if (!player.heroes.includes(id)) player.heroes.push(id);
    // He is in play now: no longer on offer in anybody's tavern.
    for (const p of state.players) {
      if (Array.isArray(p.tavernHeroes)) p.tavernHeroes = p.tavernHeroes.map((d) => (d === defId ? null : d));
    }
  }
  if (!hero.fromPool) hero.mana = getMaxMana(state, hero);
  delete hero.fromPool;
  refreshMovement(state, hero, true);
  return hero;
}

/** May the player take one more hero? (8 on the map at most) */
export function canAddHero(state, playerId) {
  const p = state.players?.[playerId];
  return !!p && p.heroes.length < MAX_HEROES_PER_PLAYER;
}

function detachHero(state, hero) {
  const player = hero.owner != null ? state.players?.[hero.owner] : null;
  if (player) player.heroes = player.heroes.filter((h) => h !== hero.id);
  for (const town of Object.values(state.towns || {})) {
    if (town.visitingHero === hero.id) town.visitingHero = null;
    if (town.garrisonHero === hero.id) town.garrisonHero = null;
  }
  state.pending = (state.pending || []).filter((p) => !(p.kind === 'level_up' && p.heroId === hero.id));
  delete state.heroes[hero.id];
}

/**
 * Remove a hero from play. `reason`: 'defeated' | 'dismissed' | 'retreated' | 'surrendered' | any.
 * 'retreated' / 'surrendered' / 'defeated' park the hero record in `state.heroPool[defId]` with his
 * level, skills and spells (original: defeated heroes return to the global pool and can be hired in
 * any tavern later). Retreat and surrender also offer him in slot 1 of the owner's tavern (retreat:
 * without army; surrender: with the surviving army); a defeated hero loses his army (his artifacts
 * were captured or lost by `finishCombat`).
 */
export function removeHero(state, heroId, reason = 'removed') {
  const hero = state.heroes?.[heroId];
  if (!hero) return fail('no_such_hero');
  const owner = hero.owner;
  detachHero(state, hero);
  const toPool = reason === 'retreated' || reason === 'surrendered' || reason === 'defeated';
  const toTavern = reason === 'retreated' || reason === 'surrendered';
  if (toPool) {
    if (reason !== 'surrendered') hero.army = createArmy();
    hero.temp = [];
    hero.owner = null;
    hero.townId = null;
    hero.garrisoned = false;
    hero.inBoat = false;
    hero.fromPool = true;
    state.heroPool = state.heroPool || {};
    state.heroPool[hero.defId] = hero;
    const player = owner != null && toTavern ? state.players?.[owner] : null;
    if (player) {
      player.tavernHeroes = player.tavernHeroes || [];
      while (player.tavernHeroes.length < 1) player.tavernHeroes.push(null);
      player.tavernHeroes[1] = hero.defId;
    }
  }
  return ok([{ type: 'hero_removed', heroId, defId: hero.defId, playerId: owner, reason, toTavern, toPool }]);
}

/** Dismiss a hero for good (his army and artifacts vanish). */
export function dismissHero(state, heroId) {
  const hero = state.heroes?.[heroId];
  if (!hero) return fail('no_such_hero');
  if (state.combat && (state.combat.attackerHeroId === heroId || state.combat.defenderHeroId === heroId)) {
    return fail('hero_in_combat');
  }
  return removeHero(state, heroId, 'dismissed');
}

// ---------------------------------------------------------------------------------------------
// Experience and level-ups
// ---------------------------------------------------------------------------------------------

function levelUpOptions(offers) {
  return offers.map((o) => ({ id: o.skillId, skillId: o.skillId, level: o.level }));
}

/**
 * Work through `count` level-ups that still need their secondary skill: offer skills for the next
 * one; an empty offer needs no decision; otherwise queue a `level_up` pending (auto-resolved with
 * the first option for ownerless heroes) and stop until it is resolved.
 */
function continueLevelUps(state, hero, count, events, primaries = []) {
  let remaining = count;
  const queue = primaries.slice();
  while (remaining > 0) {
    const offers = offerSecondarySkills(state.rng, hero);
    remaining--;
    const primary = queue.shift() ?? null;
    if (offers.length === 0) continue;
    const hasPlayer = hero.owner != null && !!state.players?.[hero.owner];
    if (!hasPlayer) {
      const res = applySkillChoice(hero, offers[0].skillId);
      if (res.ok) events.push({ type: 'skill_learned', heroId: hero.id, skillId: res.skillId, level: res.level });
      continue;
    }
    const pending = pushPending(state, {
      kind: 'level_up', playerId: hero.owner, heroId: hero.id,
      options: levelUpOptions(offers),
      // `primary`: the primary skill raised at this level (for the level-up dialog); `primaries`:
      // those of the levels still waiting behind this one
      data: { level: hero.level - remaining, remaining, primary, primaries: queue },
    });
    events.push({ type: 'level_up_choice', heroId: hero.id, pendingId: pending.id, options: pending.options });
    return;
  }
}

registerPendingHandler('level_up', (state, pending, optionIndex) => {
  const hero = state.heroes?.[pending.heroId];
  if (!hero) return { ok: true, events: [] };
  const events = [];
  const opt = pending.options[optionIndex];
  if (opt) {
    const res = applySkillChoice(hero, opt.skillId);
    if (res.ok) events.push({ type: 'skill_learned', heroId: hero.id, skillId: res.skillId, level: res.level });
  }
  continueLevelUps(state, hero, pending.data?.remaining || 0, events, pending.data?.primaries || []);
  return { ok: true, events };
});

/**
 * Give experience. `amount` is the raw amount: Learning / `experience_percent` is applied here
 * (pass `{raw: true}` to skip it). Levels and primary skills are applied at once; the secondary
 * skill choices go through `level_up` pendings, one at a time.
 */
export function giveExperience(state, heroId, amount, opts = {}) {
  const hero = state.heroes?.[heroId];
  if (!hero) return fail('no_such_hero');
  if (!(amount > 0)) return ok([]);
  const gained = Math.floor(amount * (opts.raw ? 1 : getExperienceMultiplier(state, hero)) + 1e-9);
  hero.exp += gained;
  const events = [{ type: 'experience_gained', heroId, amount: gained, base: Math.floor(amount) }];
  let levels = 0;
  const primaries = [];
  while (hero.level < MAX_HERO_LEVEL && hero.exp >= expForLevel(hero.level + 1)) {
    hero.level++;
    const primary = rollPrimarySkill(state.rng, hero.classId, hero.level);
    hero.primary[primary]++;
    primaries.push(primary);
    levels++;
    events.push({ type: 'hero_level_up', heroId, level: hero.level, primary });
  }
  if (levels > 0) {
    const waiting = getPending(state).find((p) => p.kind === 'level_up' && p.heroId === heroId);
    if (waiting) {
      waiting.data.remaining = (waiting.data.remaining || 0) + levels;
      waiting.data.primaries = [...(waiting.data.primaries || []), ...primaries];
    } else continueLevelUps(state, hero, levels, events, primaries);
  }
  return ok(events, { gained, levels });
}

// ---------------------------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------------------------

export function hasSpellbook(hero) {
  return hasArtifact(hero, SPELLBOOK);
}

/** Why a hero cannot learn a spell: null when he can. */
export function learnSpellError(state, hero, spellId) {
  const spell = getSpell(spellId);
  if (spell.creatureOnly || spell.special) return 'not_learnable';
  if (!hasSpellbook(hero)) return 'no_spellbook';
  if ((hero.spells || []).includes(spellId)) return 'already_known';
  if (spell.level > getLearnSpellLevel(state, hero)) return 'wisdom_too_low';
  return null;
}

/** Spellbook present, not known yet, and Wisdom high enough (levels 1-2 need none). */
export function canLearnSpell(state, hero, spellId) {
  return learnSpellError(state, hero, spellId) === null;
}

/** Permanently add a spell to the hero's book. `opts.force` skips the Wisdom check only. */
export function learnSpell(state, heroId, spellId, opts = {}) {
  const hero = state.heroes?.[heroId];
  if (!hero) return fail('no_such_hero');
  const err = learnSpellError(state, hero, spellId);
  if (err && !(opts.force && err === 'wisdom_too_low')) return fail(err);
  hero.spells.push(spellId);
  return ok([{ type: 'spell_learned', heroId, spellId, via: opts.via || null }]);
}

/**
 * Spells granted by equipped artifacts (scrolls, tomes, hats, Titan's Thunder...):
 * `[{spellId, mastery?, free?, source}]`. They are castable but not learned.
 */
export function getGrantedSpells(state, hero) {
  const out = [];
  for (const b of getHeroBonuses(state, hero)) {
    if (b.type === 'grants_spell' && b.spellId) {
      out.push({ spellId: b.spellId, mastery: b.mastery ?? null, free: !!b.free, source: b.source });
    } else if (b.type === 'grants_spells') {
      for (const s of HERO_SPELLS) {
        if (s.special) continue;
        if (b.school && !spellSchools(s).includes(b.school)) continue;
        if (b.level && s.level !== b.level) continue;
        out.push({ spellId: s.id, mastery: null, free: false, source: b.source });
      }
    }
  }
  return out;
}

/** Every spell the hero can cast: learned + artifact-granted. Empty without a spellbook. */
export function getHeroSpells(state, hero) {
  if (!hasSpellbook(hero)) return [];
  const out = [];
  for (const id of hero.spells || []) if (!out.includes(id)) out.push(id);
  for (const g of getGrantedSpells(state, hero)) if (!out.includes(g.spellId)) out.push(g.spellId);
  return out;
}

function teachSpells(state, teacher, pupil, maxLevel, events) {
  for (const spellId of teacher.spells || []) {
    if (getSpell(spellId).level > maxLevel) continue;
    if (!canLearnSpell(state, pupil, spellId)) continue;
    pupil.spells.push(spellId);
    events.push({ type: 'spell_learned', heroId: pupil.id, spellId, via: 'scholar', fromHeroId: teacher.id });
  }
}

/**
 * Two heroes meet on the map. Heroes of the same player exchange spells through Scholar: every
 * spell of level <= the better Scholar's limit that the receiver may learn (spellbook + Wisdom).
 */
export function meetHeroes(state, heroAId, heroBId) {
  const a = state.heroes?.[heroAId];
  const b = state.heroes?.[heroBId];
  if (!a || !b) return fail('no_such_hero');
  if (a === b) return fail('same_hero');
  const events = [{ type: 'heroes_met', heroAId, heroBId }];
  if (a.owner !== b.owner || a.owner == null) return ok(events);
  const maxLevel = Math.max(getScholarLevel(state, a), getScholarLevel(state, b));
  if (maxLevel > 0 && hasSpellbook(a) && hasSpellbook(b)) {
    // Both teach what they knew before the meeting.
    const fromA = { id: a.id, spells: a.spells.slice() };
    const fromB = { id: b.id, spells: b.spells.slice() };
    teachSpells(state, fromA, b, maxLevel, events);
    teachSpells(state, fromB, a, maxLevel, events);
  }
  return ok(events);
}

/**
 * Eagle Eye: after a won battle each spell the enemy hero cast (`spellsCast`) of a level within
 * the skill's limit that the hero can learn is learned with the skill's chance.
 */
export function applyEagleEye(state, hero, spellsCast) {
  const events = [];
  const ee = getEagleEye(state, hero);
  if (!ee || !Array.isArray(spellsCast)) return events;
  for (const spellId of [...new Set(spellsCast)]) {
    const spell = getSpell(spellId);
    if (spell.level > ee.maxLevel || !canLearnSpell(state, hero, spellId)) continue;
    if (!chance(state.rng, ee.percent / 100)) continue;
    hero.spells.push(spellId);
    events.push({ type: 'spell_learned', heroId: hero.id, spellId, via: 'eagle_eye' });
  }
  return events;
}

// ---------------------------------------------------------------------------------------------
// Temporary bonuses, start of day
// ---------------------------------------------------------------------------------------------

/**
 * Add a temporary bonus. `until`: 'next_battle' | 'end_of_day' | 'end_of_week' | turn number (the
 * last day on which it is active). `opts.unique`: do nothing if a bonus from `source` exists.
 */
export function addTempBonus(state, heroId, source, bonus, until, opts = {}) {
  const hero = state.heroes?.[heroId];
  if (!hero) return fail('no_such_hero');
  const valid = ['next_battle', 'end_of_day', 'end_of_week'].includes(until) || Number.isInteger(until);
  if (!valid) throw new Error(`Bad temp bonus expiry: ${until}`);
  hero.temp = hero.temp || [];
  if (opts.unique && hero.temp.some((t) => t.source === source)) return fail('already_active');
  const entry = { source, bonus: { ...bonus }, until };
  hero.temp.push(entry);
  return ok([{ type: 'temp_bonus_added', heroId, source, bonus: entry.bonus, until }]);
}

export function hasTempBonus(hero, source) {
  return (hero.temp || []).some((t) => t.source === source);
}

/**
 * Drop expired temp bonuses. `trigger`: 'battle' (after a combat) or 'day' (a new day began:
 * removes `end_of_day`, `end_of_week` when the new day is day 1, and turn numbers < state.turn).
 * @returns {object[]} removed entries
 */
export function expireTempBonuses(state, hero, trigger) {
  const keep = [];
  const removed = [];
  for (const t of hero.temp || []) {
    let gone = false;
    if (trigger === 'battle') gone = t.until === 'next_battle';
    else if (trigger === 'day') {
      gone = t.until === 'end_of_day'
        || (t.until === 'end_of_week' && state.date?.day === 1)
        || (typeof t.until === 'number' && t.until < state.turn);
    }
    (gone ? removed : keep).push(t);
  }
  hero.temp = keep;
  return removed;
}

/**
 * Start of a new day for one hero (call after `state.date` / `state.turn` advanced):
 * temp bonus expiry, movement points recomputed and refilled, mana regeneration
 * (+1 +Mysticism +artifacts up to the maximum; Wizard's Well refills completely).
 * Town mage-guild mana restoration is done by the town engine.
 */
export function startOfDayHero(state, heroId) {
  const hero = state.heroes?.[heroId];
  if (!hero) return fail('no_such_hero');
  const events = [];
  for (const t of expireTempBonuses(state, hero, 'day')) {
    events.push({ type: 'temp_bonus_expired', heroId, source: t.source });
  }
  refreshMovement(state, hero, true);
  const max = getMaxMana(state, hero);
  const before = hero.mana;
  if (hero.mana < max) {
    const full = hasBonus(getHeroBonuses(state, hero), 'mana_regen_full');
    hero.mana = full ? max : Math.min(max, hero.mana + getManaRegen(state, hero));
  }
  if (hero.mana !== before) events.push({ type: 'mana_regenerated', heroId, amount: hero.mana - before });
  return ok(events);
}

// ---------------------------------------------------------------------------------------------
// Trading between heroes
// ---------------------------------------------------------------------------------------------

function canTrade(a, b) {
  if (a.owner == null || a.owner !== b.owner) return 'not_allied';
  if (a === b) return null;
  if (a.townId && a.townId === b.townId) return null;
  const az = a.pos.z ?? 0;
  const bz = b.pos.z ?? 0;
  if (az !== bz || Math.abs(a.pos.x - b.pos.x) > 1 || Math.abs(a.pos.y - b.pos.y) > 1) return 'not_adjacent';
  return null;
}

/**
 * Move/merge/swap/split a stack between two heroes of the same player standing next to each
 * other (or the same hero: rearranging). A hero can never give away his last stack
 * (`error: 'last_stack'`); splitting off all but one creature is fine.
 */
export function tradeArmy(state, heroAId, i, heroBId, j, count) {
  const a = state.heroes?.[heroAId];
  const b = state.heroes?.[heroBId];
  if (!a || !b) return fail('no_such_hero');
  const err = canTrade(a, b);
  if (err) return fail(err);
  const res = armyMove(a.army, i, b.army, j, count, { keepA: true, keepB: true });
  if (!res.ok) return res;
  return ok([{ type: 'army_moved', fromHeroId: heroAId, fromSlot: i, toHeroId: heroBId, toSlot: j, action: res.action, count: res.moved }]);
}

/**
 * Hand an artifact to another hero of the same player. `ref` / `dest` as in
 * `transferArtifact` (src/engine/artifacts.js).
 */
export function tradeArtifact(state, fromHeroId, toHeroId, ref, dest) {
  const a = state.heroes?.[fromHeroId];
  const b = state.heroes?.[toHeroId];
  if (!a || !b) return fail('no_such_hero');
  const err = canTrade(a, b);
  if (err) return fail(err);
  return transferArtifact(a, b, ref, dest);
}

/** Player-action guard: the hero exists and belongs to the player whose turn it is. */
function ownHeroError(state, hero) {
  if (!hero) return 'no_such_hero';
  const cur = state.players?.[state.currentPlayer];
  if (cur && hero.owner !== cur.id) return 'not_your_turn';
  return null;
}

/**
 * Dismiss one stack of a hero's army (the creatures are gone). A hero keeps at least one stack
 * (`last_stack`). Event `stack_dismissed {heroId, slot, creatureId, count}`.
 */
export function dismissStack(state, heroId, slot) {
  const hero = state.heroes?.[heroId];
  const err = ownHeroError(state, hero);
  if (err) return fail(err);
  if (state.combat) return fail('in_combat');
  const r = armyDismiss(hero.army, slot, { keepOne: true });
  if (!r.ok) return r;
  return ok([{ type: 'stack_dismissed', heroId, slot, creatureId: r.stack.creatureId, count: r.stack.count }]);
}

/**
 * Rearrange a hero's own artifacts (`artifacts.js moveArtifact`): backpack order, ring / misc slot
 * swaps, slot <-> backpack. `from` / `to` = `{backpack: i}` | `{slot, index}`.
 */
export function moveHeroArtifact(state, heroId, from, to) {
  const hero = state.heroes?.[heroId];
  const err = ownHeroError(state, hero);
  if (err) return fail(err);
  return moveArtifact(hero, from, to);
}

/** Put a hero to sleep (skipped by "next hero" and the end-of-turn reminder) or wake him up. */
export function setHeroAsleep(state, heroId, asleep = true) {
  const hero = state.heroes?.[heroId];
  const err = ownHeroError(state, hero);
  if (err) return fail(err);
  hero.asleep = !!asleep;
  return ok([{ type: asleep ? 'hero_asleep' : 'hero_awake', heroId }]);
}

// ---------------------------------------------------------------------------------------------
// Specialty upgrades (Gelu: Sharpshooters, Dracon: Enchanters - heroes.md `creature_upgrade`)
// ---------------------------------------------------------------------------------------------

function upgradeCost(fromId, toId, count) {
  const a = getCreature(fromId).cost || {};
  const b = getCreature(toId).cost || {};
  const cost = {};
  for (const r of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = Math.max(0, (b[r] || 0) - (a[r] || 0)) * count;
    if (d > 0) cost[r] = d;
  }
  return cost;
}

/**
 * Stacks of the hero's army his `creature_upgrade` specialty can convert:
 * `[{slot, from, to, count, cost}]` (cost = difference of the creature costs × count).
 */
export function getSpecialtyUpgrades(state, hero) {
  const map = {};
  for (const b of getHeroBonuses(state, hero)) if (b.type === 'creature_upgrade' && b.upgrades) Object.assign(map, b.upgrades);
  const out = [];
  hero.army.forEach((s, slot) => {
    if (!s || s.count <= 0) return;
    const to = map[s.creatureId];
    if (to && to !== s.creatureId) out.push({ slot, from: s.creatureId, to, count: s.count, cost: upgradeCost(s.creatureId, to, s.count) });
  });
  return out;
}

/**
 * Upgrade one stack through the hero's `creature_upgrade` specialty (anywhere: town or hero screen),
 * paying the cost difference. Errors: `no_specialty_upgrade`, `not_enough_resources`.
 */
export function specialtyUpgrade(state, heroId, slot) {
  const hero = state.heroes?.[heroId];
  const err = ownHeroError(state, hero);
  if (err) return fail(err);
  if (state.combat) return fail('in_combat');
  const offer = getSpecialtyUpgrades(state, hero).find((u) => u.slot === slot);
  if (!offer) return fail(hero.army[slot] ? 'no_specialty_upgrade' : 'empty_slot');
  const player = state.players?.[hero.owner];
  if (!player) return fail('no_owner');
  for (const [r, n] of Object.entries(offer.cost)) if ((player.resources[r] || 0) < n) return fail('not_enough_resources');
  for (const [r, n] of Object.entries(offer.cost)) player.resources[r] -= n;
  hero.army[slot].creatureId = offer.to;
  return ok([{ type: 'stack_upgraded', heroId, slot, from: offer.from, to: offer.to, count: offer.count, cost: offer.cost, via: 'specialty' }]);
}

// ---------------------------------------------------------------------------------------------
// Necromancy
// ---------------------------------------------------------------------------------------------

/**
 * Creatures raised by Necromancy after a won battle.
 *  hp pool  = sum(hp x count) of the killed LIVING enemy creatures x necromancy %
 *  count    = floor(pool / hp of the raised creature), at most the number of living creatures
 *             killed, at least 1 if any were killed
 *  skeletons need a skeleton stack or a free slot; failing that a hero who already leads
 *  skeleton warriors gets warriors instead, at 2/3 of the amount (min 1). Cloak of the Undead
 *  King creatures are raised only if a stack of them or a free slot exists.
 * @param {{[creatureId: string]: number}} killed enemy losses
 * @returns {{creatureId: string, count: number} | null}
 */
export function computeNecromancy(state, hero, killed) {
  const info = getNecromancyInfo(state, hero);
  if (!info.active || !killed) return null;
  let hp = 0;
  let bodies = 0;
  for (const [creatureId, n] of Object.entries(killed)) {
    if (!(n > 0)) continue;
    const c = getCreature(creatureId);
    if (c.warMachine || !creatureTags(c).includes('living')) continue;
    hp += c.hp * n;
    bodies += n;
  }
  if (bodies === 0) return null;
  const raised = getCreature(info.creatureId);
  let count = Math.floor((hp * info.percent) / 100 / raised.hp + 1e-9);
  count = Math.max(1, Math.min(count, bodies));
  const fits = (id) => armyFindSlot(hero.army, id) >= 0 || armyFreeSlot(hero.army) >= 0;
  if (fits(raised.id)) return { creatureId: raised.id, count };
  const upgrade = raised.upgradesTo;
  if (raised.id === 'skeleton' && upgrade && armyFindSlot(hero.army, upgrade) >= 0) {
    return { creatureId: upgrade, count: Math.max(1, Math.floor(count * UPGRADED_RAISE_FACTOR + 1e-9)) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Combat adapters
// ---------------------------------------------------------------------------------------------

const outcomeHandlers = {};

/** Register `fn(state, context, result)` to run after a combat whose `context.kind === kind`. */
export function registerCombatOutcome(kind, fn) {
  outcomeHandlers[kind] = fn;
}

/** Fort level 0..3 from the town's buildings (`siege_defense` effect). */
function fortLevelOf(town) {
  let level = 0;
  for (const bid of town.buildings || []) {
    if (!BUILDING_BY_ID[bid]) continue;
    for (const e of getBuildingEffects(bid, town.faction)) {
      if (e.type === 'siege_defense') level = Math.max(level, e.fortLevel || 0);
    }
  }
  return level;
}

function townHasEffect(town, type) {
  return (town.buildings || []).some((bid) => BUILDING_BY_ID[bid]
    && getBuildingEffects(bid, town.faction).some((e) => e.type === type));
}

function playerHasTownEffect(state, playerId, type) {
  if (playerId == null) return false;
  return Object.values(state.towns || {}).some((t) => t.owner === playerId && townHasEffect(t, type));
}

/** CombatInput.siege for a town: town.js `getSiegeInfo` when available, else a minimal fallback. */
export function siegeInfoFor(state, townId) {
  const town = state.towns?.[townId];
  if (!town) return null;
  if (townModule && typeof townModule.getSiegeInfo === 'function') return townModule.getSiegeInfo(state, townId) || null;
  const fortLevel = fortLevelOf(town);
  if (fortLevel === 0) return null;
  const siege = FACTION_BY_ID[town.faction]?.siege || null;
  return {
    fortLevel, faction: town.faction, buildings: town.buildings.slice(),
    escapeTunnel: townHasEffect(town, 'escape_tunnel'),
    moat: fortLevel >= 2 ? siege?.moat ?? null : null,
  };
}

/**
 * Who defends a town: the visiting hero first (with his own army), else the garrison hero, else
 * the garrison troops. `{ kind: 'visiting'|'garrison_hero'|'garrison'|'empty', heroId, army }`.
 * After the visiting hero falls, the outcome handler starts the next fight if anybody is left.
 */
export function getTownDefender(state, townId) {
  const town = state.towns[townId];
  if (town.visitingHero && state.heroes[town.visitingHero]) {
    return { kind: 'visiting', heroId: town.visitingHero, army: state.heroes[town.visitingHero].army };
  }
  if (town.garrisonHero && state.heroes[town.garrisonHero]) {
    return { kind: 'garrison_hero', heroId: town.garrisonHero, army: state.heroes[town.garrisonHero].army };
  }
  const army = town.garrison || createArmy();
  return { kind: armyIsEmpty(army) ? 'empty' : 'garrison', heroId: null, army };
}

/** Gold a hero pays to surrender: the full gold cost of his army x the Diplomacy/artifact multiplier (original; combat/result.js). */
export function getSurrenderCost(state, hero, army = hero.army) {
  let gold = 0;
  for (const s of army || []) if (s && s.count > 0) gold += (getCreature(s.creatureId).cost.gold || 0) * s.count;
  return Math.floor(gold * getSurrenderCostMultiplier(state, hero) + 1e-9);
}

/**
 * Build one CombatSide (DESIGN §5).
 * @param {object} state
 * @param {{heroId: string, townId?: string} | {army: Array, playerId?: number|null, townId?: string} | {townId: string}} spec
 *   `townId` = the side defends that town (garrison bonuses, town defender rules).
 * @param {{siege?: boolean, enemy?: object, overlay?: string}} [opts]
 *   `siege` (default: the town has a fort), `enemy` = the opposing spec (for morale/luck/retreat rules).
 */
export function buildCombatSide(state, spec, opts = {}) {
  let hero = null;
  let army;
  let playerId = spec.playerId ?? null;
  const town = spec.townId ? state.towns?.[spec.townId] : null;
  if (spec.heroId) {
    hero = state.heroes[spec.heroId];
    if (!hero) throw new Error(`Unknown hero: ${spec.heroId}`);
    army = hero.army;
  } else if (spec.army) {
    army = spec.army;
  } else if (town) {
    const d = getTownDefender(state, town.id);
    hero = d.heroId ? state.heroes[d.heroId] : null;
    army = d.army;
  } else {
    throw new Error('buildCombatSide: need heroId, army or townId');
  }
  if (hero) playerId = hero.owner;
  else if (playerId == null && town) playerId = town.owner;
  const player = playerId != null ? state.players?.[playerId] : null;
  const siege = town ? (opts.siege ?? fortLevelOf(town) > 0) : false;

  const garrison = town && siege ? getGarrisonBonuses(state, town.id) : [];
  const sideBonuses = garrison
    .filter((g) => g.stat === 'morale' || g.stat === 'luck')
    .map((g) => ({ type: g.stat, value: g.value, source: g.source }));
  const primaryBonuses = garrison
    .filter((g) => g.stat !== 'morale' && g.stat !== 'luck')
    .map((g) => ({ type: 'primary', stat: g.stat, value: g.value, source: g.source }));

  let heroBlock = null;
  let heroBonuses = [];
  if (hero) {
    heroBonuses = getHeroBonuses(state, hero);
    const primary = getPrimary(state, hero, primaryBonuses);
    const def = getHeroDef(hero.defId);
    const skills = {};
    for (const s of hero.skills) skills[s.id] = s.level;
    heroBlock = {
      id: hero.id, name: hero.name, defId: hero.defId, classId: hero.classId, level: hero.level,
      attack: primary.attack, defense: primary.defense, power: primary.power, knowledge: primary.knowledge,
      mana: hero.mana,
      maxMana: getMaxMana(state, hero),
      spells: getHeroSpells(state, hero),
      spellbook: hasSpellbook(hero), // no book: no casting at all, not even scroll / artifact spells
      skills,
      specialty: { ...def.specialty },
      bonuses: [...heroBonuses, ...sideBonuses, ...primaryBonuses.map((b) => ({ ...b, applied: true }))],
    };
  }

  const enemySpec = opts.enemy || null;
  const enemyHero = enemySpec?.heroId ? state.heroes[enemySpec.heroId] : null;
  const enemy = enemySpec ? { hero: enemyHero, army: enemyHero ? enemyHero.army : enemySpec.army || [] } : undefined;
  const mlSpec = { hero, army, bonuses: heroBonuses, townId: town?.id, siege, overlay: opts.overlay, enemy };
  const morale = getArmyMoraleDetails(state, mlSpec);
  const luck = getArmyLuckDetails(state, mlSpec);

  // Retreat / surrender rules.
  const enemyBonuses = enemyHero ? getHeroBonuses(state, enemyHero) : [];
  const shackled = hasBonus(heroBonuses, 'no_retreat') || hasBonus(enemyBonuses, 'no_retreat');
  const alwaysRetreat = hasBonus(heroBonuses, 'always_can_retreat');
  const trapped = !!town && siege && !townHasEffect(town, 'escape_tunnel');
  const canRetreat = !!hero && !shackled && (!trapped || alwaysRetreat);
  const surrenderCost = hero ? getSurrenderCost(state, hero, army) : 0;
  const gold = player ? player.resources.gold : 0;
  const canSurrender = canRetreat && (!!enemyHero || alwaysRetreat) && gold >= surrenderCost;

  return {
    playerId,
    isHuman: player ? !!player.isHuman : false,
    hero: heroBlock,
    army: armyClone(army),
    warMachines: hero ? getWarMachines(hero).filter((m) => m !== 'catapult') : [],
    bonuses: sideBonuses,
    // Base values for the combat engine (alignment mix, undead, hero and garrison bonuses); it adds
    // creature auras / enemy reductions live and clamps per stack. The `stack*` arrays are the
    // resulting per-slot values at the start of the battle (preview / AI).
    morale: morale.base,
    luck: luck.base,
    stackMorale: morale.perStack,
    stackLuck: luck.perStack,
    canRetreat,
    canSurrender,
    surrenderCost,
    gold,
    nativeTerrainAll: playerHasTownEffect(state, playerId, 'native_terrain_all'),
  };
}

function tileAt(state, pos) {
  if (!pos || !state.map?.tiles) return null;
  return state.map.tiles[pos.z ?? 0]?.[pos.y]?.[pos.x] ?? null;
}

/**
 * Begin a combat.
 * @param {object} state
 * @param {object} o
 * @param {string} o.attackerHeroId
 * @param {{heroId: string} | {army: Array, playerId?: number|null, pos?: object} | {townId: string}} o.defender
 * @param {string} [o.terrain]   default: terrain of the defender's tile
 * @param {boolean} [o.bank]
 * @param {{kind: string}} o.context  passed to the outcome handler registered for `context.kind`
 * @param {number} [o.seed] @param {'random'|Array} [o.obstacles]
 * Creates `state.combat = { cs, context, attackerHeroId, defenderHeroId, townId, defenderKind, input }`.
 */
export function startCombat(state, o) {
  if (state.combat) return fail('combat_in_progress');
  if (!combatEngine) return fail('combat_engine_unavailable');
  const attacker = state.heroes?.[o.attackerHeroId];
  if (!attacker) return fail('no_such_hero');
  const d = o.defender || {};
  let townId = d.townId || null;
  let defenderHeroId = d.heroId || null;
  let defenderSpec;
  let defenderKind;
  let pos = d.pos || null;
  if (townId) {
    const town = state.towns?.[townId];
    if (!town) return fail('no_such_town');
    const td = getTownDefender(state, townId);
    defenderHeroId = td.heroId;
    defenderKind = td.kind;
    defenderSpec = td.heroId
      ? { heroId: td.heroId, townId }
      : { army: td.army, playerId: town.owner, townId };
    pos = town.pos;
  } else if (defenderHeroId) {
    const dh = state.heroes[defenderHeroId];
    if (!dh) return fail('no_such_hero');
    if (dh.id === attacker.id) return fail('same_hero');
    defenderSpec = { heroId: defenderHeroId };
    defenderKind = 'hero';
    pos = dh.pos;
  } else if (d.army) {
    defenderSpec = { army: d.army, playerId: d.playerId ?? null };
    defenderKind = 'army';
  } else {
    return fail('bad_defender');
  }
  if (armyIsEmpty(attacker.army)) return fail('attacker_has_no_army');
  // allies (same `player.team`) never fight: the adventure engine turns this into a meeting / visit
  const defOwner = defenderHeroId ? state.heroes[defenderHeroId]?.owner : townId ? state.towns[townId].owner : d.playerId;
  if (defOwner != null && attacker.owner != null && areAllied(state, attacker.owner, defOwner)) return fail('allied');

  const siege = townId ? siegeInfoFor(state, townId) : null;
  const tile = tileAt(state, pos || attacker.pos);
  const terrain = o.terrain || tile?.t || 'grass';
  const overlay = !siege && !townId && !o.bank ? (o.overlay ?? tile?.overlay ?? null) : null;

  const attackerSpec = { heroId: attacker.id };
  const input = {
    seed: o.seed ?? randInt(state.rng, 1, 0x7fffffff),
    terrain,
    attacker: buildCombatSide(state, attackerSpec, { enemy: defenderSpec, overlay }),
    defender: buildCombatSide(state, defenderSpec, { enemy: attackerSpec, overlay, siege: !!siege }),
    siege,
    bank: !!o.bank,
    obstacles: o.obstacles || 'random',
    overlay,
    // anti-magic garrison (adventure engine passes 0): highest castable spell level
    ...(typeof o.spellLevelCap === 'number' ? { spellLevelCap: o.spellLevelCap } : {}),
    // round cap (engine: reaching it ends the battle as a defender win, reason 'timeout')
    maxRounds: typeof o.maxRounds === 'number' ? o.maxRounds : COMBAT_MAX_ROUNDS,
    overlayEffects: overlay && MAGIC_TERRAIN_BY_ID[overlay] ? MAGIC_TERRAIN_BY_ID[overlay].effects.map((e) => ({ ...e })) : [],
  };
  const cs = combatEngine.createCombat(input);
  state.combat = {
    cs, context: o.context || { kind: 'none' },
    attackerHeroId: attacker.id, defenderHeroId, townId, defenderKind,
  };
  return ok([{
    type: 'combat_started', attackerHeroId: attacker.id, defenderHeroId, townId, terrain,
    siege: !!siege, bank: !!o.bank, kind: state.combat.context.kind,
  }]);
}

function sumLossHp(losses) {
  let hp = 0;
  for (const [id, n] of Object.entries(losses || {})) if (n > 0) hp += getCreature(id).hp * n;
  return hp;
}

function applySide(state, hero, side, events) {
  if (!hero || !side) return;
  if (Array.isArray(side.army)) hero.army = armyClone(side.army);
  for (const m of side.warMachinesLost || []) {
    if (m === 'catapult') continue;
    const res = removeArtifact(hero, m);
    if (res.ok) events.push({ type: 'war_machine_lost', heroId: hero.id, machine: m });
  }
  if (typeof side.manaLeft === 'number') hero.mana = Math.max(0, side.manaLeft);
  expireTempBonuses(state, hero, 'battle');
}

/** Destroy the transferable artifacts of a hero beaten by an army without a hero (nobody captures them). */
function dropArtifacts(hero) {
  const events = [];
  ensureArtifacts(hero);
  const lost = (entry) => !getArtifact(entryId(entry)).noTransfer && !getArtifact(entryId(entry)).noBackpack;
  for (const e of getEquippedArtifacts(hero)) {
    if (!lost(e.entry)) continue;
    removeArtifact(hero, { slot: e.slot, index: e.index });
    events.push({ type: 'artifact_lost', heroId: hero.id, artifact: e.entry, where: 'defeat' });
  }
  hero.artifacts.backpack = hero.artifacts.backpack.filter((entry) => {
    if (!lost(entry)) return true;
    events.push({ type: 'artifact_lost', heroId: hero.id, artifact: entry, where: 'defeat' });
    return false;
  });
  return events;
}

/** Player credited with a win of `side` (hero owner, else the side's player, e.g. a town garrison). */
function sidePlayer(state, side, hero) {
  if (hero && hero.owner != null) return hero.owner;
  const pid = state.combat?.cs?.sides?.[side]?.playerId;
  return pid ?? null;
}

function finish(state, result) {
  const { context, attackerHeroId, defenderHeroId, townId, defenderKind } = state.combat;
  const events = [];
  const heroes = { attacker: state.heroes[attackerHeroId] || null, defender: defenderHeroId ? state.heroes[defenderHeroId] || null : null };
  const town = townId ? state.towns?.[townId] : null;

  // 1. survivors, war machines, mana, next_battle bonuses
  applySide(state, heroes.attacker, result.attacker, events);
  applySide(state, heroes.defender, result.defender, events);
  if (!heroes.defender && town && defenderKind !== 'visiting' && Array.isArray(result.defender?.army)) {
    town.garrison = armyClone(result.defender.army);
  }

  let winnerSide = result.winner === 'attacker' || result.winner === 'defender' ? result.winner : null;
  // Original rule: a hero whose real army is gone (only summoned / temporarily raised creatures were
  // left standing) loses the battle; with the enemy army destroyed too this is a draw.
  if (winnerSide && heroes[winnerSide] && armyIsEmpty(result[winnerSide]?.army || [])
    && !(result[winnerSide]?.overflow || []).length) {
    result = { ...result, winner: 'draw', reason: 'no_real_troops', [winnerSide]: { ...result[winnerSide], army: createArmy() } };
    winnerSide = null;
  }
  const summary = {
    ...result, attackerHeroId, defenderHeroId, townId, defenderKind,
    winnerHeroId: null, loserHeroId: null, experience: 0, raised: null, surrenderPaid: 0,
    removedHeroes: [],
  };

  const fate = (side) => {
    const r = result[side] || {};
    if (!heroes[side]) return 'none';
    if (winnerSide === side) return 'won';
    if (r.heroSurrendered) return 'surrendered';
    if (r.heroFled) return 'retreated';
    return 'defeated';
  };
  const fates = { attacker: fate('attacker'), defender: fate('defender') };

  if (winnerSide) {
    const loserSide = winnerSide === 'attacker' ? 'defender' : 'attacker';
    const winner = heroes[winnerSide];
    const loser = heroes[loserSide];
    summary.winnerHeroId = winner ? winner.id : null;
    summary.loserHeroId = loser ? loser.id : null;

    if (winner) {
      const noRaise = hasBonus(getHeroBonuses(state, winner), 'no_resurrection')
        || (loser && hasBonus(getHeroBonuses(state, loser), 'no_resurrection'));
      // 2. necromancy (computed before experience so a level-up does not change the percentage)
      // Prefer the engine's kill list (it knows which casualties were only summoned).
      const killList = result[winnerSide]?.killedEnemies;
      let killed = result[loserSide]?.losses;
      if (Array.isArray(killList)) {
        killed = {};
        for (const k of killList) if (!k.summoned) killed[k.creatureId] = (killed[k.creatureId] || 0) + k.count;
      }
      const raised = noRaise ? null : computeNecromancy(state, winner, killed);
      // 3. experience
      const key = winnerSide === 'attacker' ? 'expAttacker' : 'expDefender';
      // The combat engine's figure already contains the +500 for an enemy hero; the fallback
      // (no figure) adds it here.
      let exp = result[key];
      if (typeof exp !== 'number') exp = sumLossHp(result[loserSide]?.losses) + (loser ? HERO_DEFEAT_EXP : 0);
      if (exp > 0) {
        const res = giveExperience(state, winner.id, exp);
        summary.experience = res.gained || 0;
        events.push(...res.events);
      }
      if (raised && armyAdd(winner.army, raised.creatureId, raised.count)) {
        summary.raised = raised;
        events.push({ type: 'necromancy', heroId: winner.id, creatureId: raised.creatureId, count: raised.count });
      }
      // 4. eagle eye
      events.push(...applyEagleEye(state, winner, result[loserSide]?.spellsCast));
    }

    // 5. the loser's hero
    if (loser) {
      const how = fates[loserSide];
      if (how === 'surrendered') {
        const cost = typeof result.surrenderCost === 'number' && result.surrenderCost > 0
          ? result.surrenderCost : getSurrenderCost(state, loser, loser.army);
        const payer = loser.owner != null ? state.players?.[loser.owner] : null;
        const paid = payer ? Math.min(cost, payer.resources.gold) : 0;
        if (payer) payer.resources.gold -= paid;
        const payee = winner && winner.owner != null ? state.players?.[winner.owner] : null;
        if (payee) payee.resources.gold += paid;
        summary.surrenderPaid = paid;
        events.push({ type: 'hero_surrendered', heroId: loser.id, gold: paid, toPlayerId: payee ? payee.id : null });
      } else if (how === 'retreated') {
        events.push({ type: 'hero_retreated', heroId: loser.id });
      } else if (winner) {
        events.push(...captureArtifacts(loser, winner).events);
      } else {
        events.push(...dropArtifacts(loser));
      }
      // quest / victory credit (defeat_hero): the winning side's player; a neutral winner (monster,
      // neutral town garrison) is recorded as `null` = nobody gets the credit
      const by = sidePlayer(state, winnerSide, winner);
      recordDefeat(state, { kind: 'hero', id: loser.id, byPlayerId: by ?? null });
      recordDefeat(state, { kind: 'hero', id: loser.defId, byPlayerId: by ?? null });
      events.push(...removeHero(state, loser.id, how).events);
      summary.removedHeroes.push(loser.id);
    }
  } else {
    // Draw: both armies are gone; neither hero survives, nothing is captured (artifacts are lost).
    for (const side of ['attacker', 'defender']) {
      const h = heroes[side];
      if (!h) continue;
      const how = fates[side] === 'won' ? 'defeated' : fates[side];
      if (how === 'defeated') events.push(...dropArtifacts(h));
      const other = side === 'attacker' ? 'defender' : 'attacker';
      const by = sidePlayer(state, other, heroes[other]);
      recordDefeat(state, { kind: 'hero', id: h.id, byPlayerId: by ?? null });
      recordDefeat(state, { kind: 'hero', id: h.defId, byPlayerId: by ?? null });
      events.push(...removeHero(state, h.id, how).events);
      summary.removedHeroes.push(h.id);
    }
  }
  summary.fates = fates;

  events.push({
    type: 'combat_finished', winner: result.winner, attackerHeroId, defenderHeroId, townId,
    kind: context?.kind, rounds: result.rounds,
  });

  // 6. hand over to the area that started the fight
  state.combat = null;
  const handler = context ? outcomeHandlers[context.kind] : null;
  if (handler) {
    const res = handler(state, context, summary);
    if (res && Array.isArray(res.events)) events.push(...res.events);
  }
  return ok(events, { result: summary });
}

/**
 * Apply the outcome of the finished combat in `state.combat` and clear it:
 * survivors, lost war machines, mana, `next_battle` bonuses, necromancy, experience (+Learning),
 * Eagle Eye, artifact capture, retreat / surrender (hero to the tavern pool) or removal of the
 * loser's hero, then the handler registered for `context.kind`.
 * The handler (and the returned `result`) get the CombatResult extended with
 * `{ attackerHeroId, defenderHeroId, townId, defenderKind, winnerHeroId, loserHeroId, experience,
 *    raised, surrenderPaid, removedHeroes, fates: {attacker, defender} }`.
 */
export function finishCombat(state) {
  if (!state.combat) return fail('no_combat');
  if (!combatEngine) return fail('combat_engine_unavailable');
  if (!combatEngine.isOver(state.combat.cs)) return fail('combat_not_over');
  return finish(state, combatEngine.getResult(state.combat.cs));
}

/** Start a combat, let the engine auto-resolve it and apply the outcome. Same options as `startCombat`. */
export function quickCombat(state, opts) {
  const started = startCombat(state, opts);
  if (!started.ok) return started;
  const cs = state.combat.cs;
  let result = typeof combatEngine.autoResolve === 'function' ? combatEngine.autoResolve(cs) : null;
  if (!result || !result.winner) {
    if (!combatEngine.isOver(cs)) {
      state.combat = null;
      return fail('combat_not_resolved');
    }
    result = combatEngine.getResult(cs);
  }
  const res = finish(state, result);
  return res.ok ? ok([...started.events, ...res.events], { result: res.result }) : res;
}
