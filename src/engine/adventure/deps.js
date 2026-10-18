// Seam between the adventure engine and the modules written by other agents (hero.js, bonuses.js,
// economy.js, town.js - DESIGN.md §8). Every cross-module call of the adventure engine goes through
// `deps.<name>(...)`. Resolution order per call: test override (`setDeps`) -> real module export
// (registered with `registerRealModule`, see realDeps.js) -> local fallback implemented below.
//
// The fallbacks are deliberately simple but rule-conforming, so the adventure engine is fully
// usable (and testable) on its own.

import { PRIMARY_SKILLS, MAX_HEROES_PER_PLAYER, RESOURCES } from '../../core/constants.js';
import { getSkillEffects } from '../../data/skills.js';
import { getSpell, wisdomRequired } from '../../data/spells.js';
import { getCreature } from '../../data/creatures.js';
import { getArtifactBonuses, hasArtifact } from '../artifacts.js';
import { getSkillLevel as levelingSkillLevel, gainExperience, applySkillChoice, createHero, SPELL_BOOK_ARTIFACT } from '../leveling.js';
import { armyStacks, getPlayer } from './util.js';

const overrides = {};
const realModules = [];
const combatOutcomes = {};

/** Tests: replace any dependency (`setDeps({ startCombat: fake })`). */
export function setDeps(map) { Object.assign(overrides, map); }
/** Tests: drop all overrides. */
export function resetDeps() { for (const k of Object.keys(overrides)) delete overrides[k]; }
/** Tests: force the built-in fallbacks for everything (hermetic unit tests). */
export function useFallbackDeps() { resetDeps(); Object.assign(overrides, fallbacks); }
/** Register an ES module namespace whose exports take precedence over the fallbacks. */
export function registerRealModule(ns) { realModules.push(ns); }
/** True when `name` resolves to a real module export (not a fallback / override). */
export function hasRealDep(name) { return !overrides[name] && realModules.some((m) => typeof m[name] === 'function'); }

function resolve(name) {
  if (overrides[name]) return overrides[name];
  for (const m of realModules) if (typeof m[name] === 'function') return m[name];
  return fallbacks[name];
}

// ---- fallbacks ----------------------------------------------------------------------------------

function sumField(bonuses, type, field) {
  return bonuses.filter((b) => b.type === type).reduce((n, b) => n + (b[field] || 0), 0);
}

const LAND_MOVE_BY_SPEED = [1500, 1500, 1500, 1500, 1560, 1630, 1700, 1760, 1830, 1900, 1960, 2000];

const fallbacks = {
  // -- bonuses.js
  getHeroBonuses(state, hero) {
    const out = [];
    for (const s of hero.skills || []) out.push(...getSkillEffects(s.id, s.level).map((b) => ({ ...b, source: `skill:${s.id}` })));
    out.push(...getArtifactBonuses(hero));
    for (const t of hero.temp || []) out.push({ ...t.bonus, source: t.source });
    // player-wide: lighthouses
    for (const o of Object.values(state.map?.objects || {})) {
      if (o.defId === 'lighthouse' && o.owner === hero.owner && hero.owner != null) out.push({ type: 'movement_sea', value: 500, source: 'lighthouse' });
    }
    return out;
  },
  sumBonus(bonuses, type, match) {
    return bonuses.filter((b) => b.type === type && (!match || Object.keys(match).every((k) => b[k] === match[k])))
      .reduce((n, b) => n + (b.value || 0), 0);
  },
  getSkillLevel(hero, skillId) { return levelingSkillLevel(hero, skillId); },
  getPrimary(state, hero) {
    const bonuses = deps.getHeroBonuses(state, hero);
    const out = {};
    for (const s of PRIMARY_SKILLS) {
      out[s] = Math.max(s === 'power' || s === 'knowledge' ? 1 : 0, hero.primary[s] + deps.sumBonus(bonuses, 'primary', { stat: s }));
    }
    return out;
  },
  getMaxMana(state, hero) {
    const bonuses = deps.getHeroBonuses(state, hero);
    const base = deps.getPrimary(state, hero).knowledge * 10;
    return Math.floor(base * (100 + sumField(bonuses, 'mana_max_percent', 'percent')) / 100);
  },
  getSightRadius(state, hero) {
    return 5 + deps.sumBonus(deps.getHeroBonuses(state, hero), 'sight_radius');
  },
  getMaxMovePoints(state, hero) {
    const bonuses = deps.getHeroBonuses(state, hero);
    const type = hero.inBoat ? 'movement_sea' : 'movement_land';
    let base = 1500;
    if (!hero.inBoat) {
      const stacks = armyStacks(hero.army);
      const slowest = stacks.length ? Math.min(...stacks.map((s) => getCreature(s.creatureId).speed)) : 3;
      base = LAND_MOVE_BY_SPEED[Math.max(0, Math.min(11, slowest))];
    }
    base += sumField(bonuses, type, 'value');
    return Math.floor(base * (100 + sumField(bonuses, type, 'percent')) / 100);
  },
  // -- hero.js
  giveExperience(state, heroId, amount) {
    const hero = state.heroes[heroId];
    if (!hero || amount <= 0) return { ok: true, events: [] };
    const pct = sumField(deps.getHeroBonuses(state, hero), 'experience_percent', 'percent');
    const gained = Math.floor(amount * (100 + pct) / 100);
    const { levelUps } = gainExperience(state.rng, hero, gained);
    // fallback: secondary skill choices are auto-resolved (first offer)
    for (const lu of levelUps) if (lu.offers && lu.offers.length) applySkillChoice(hero, lu.offers[0].skillId);
    return { ok: true, events: [{ type: 'experience', heroId, amount: gained, levelUps: levelUps.length }] };
  },
  canLearnSpell(state, hero, spellId) {
    const spell = getSpell(spellId);
    if (!hasArtifact(hero, SPELL_BOOK_ARTIFACT)) return false;
    if ((hero.spells || []).includes(spellId)) return false;
    return deps.getSkillLevel(hero, 'wisdom') >= wisdomRequired(spell.level);
  },
  learnSpell(state, heroId, spellId) {
    const hero = state.heroes[heroId];
    if (!deps.canLearnSpell(state, hero, spellId)) return { ok: false, error: 'cannot_learn' };
    hero.spells.push(spellId);
    return { ok: true, events: [{ type: 'spell_learned', heroId, spellId }] };
  },
  getHeroSpells(state, hero) {
    const granted = deps.getHeroBonuses(state, hero).filter((b) => b.type === 'grants_spell' && b.spellId).map((b) => b.spellId);
    return [...new Set([...(hero.spells || []), ...granted])];
  },
  addTempBonus(state, heroId, source, bonus, until) {
    const hero = state.heroes[heroId];
    hero.temp ??= [];
    hero.temp.push({ source, bonus: { ...bonus }, until });
    return { ok: true, events: [] };
  },
  addHero(state, defId, playerId, pos, opts = {}) {
    let id = opts.id || defId;
    while (state.heroes[id]) id = `h${state.nextId++}`;
    const hero = createHero(state.rng, defId, { id, owner: playerId, pos });
    state.heroes[id] = hero;
    const player = getPlayer(state, playerId);
    if (player && !player.heroes.includes(id)) player.heroes.push(id);
    return hero;
  },
  removeHero(state, heroId) {
    const hero = state.heroes[heroId];
    if (!hero) return { ok: false, error: 'no_hero' };
    const player = getPlayer(state, hero.owner);
    if (player) player.heroes = player.heroes.filter((h) => h !== heroId);
    for (const t of Object.values(state.towns || {})) {
      if (t.visitingHero === heroId) t.visitingHero = null;
      if (t.garrisonHero === heroId) t.garrisonHero = null;
    }
    delete state.heroes[heroId];
    return { ok: true, events: [{ type: 'hero_removed', heroId }] };
  },
  meetHeroes() { return { ok: true, events: [] }; },
  /** Fallback combat: only records the battle; a test (or the real hero.js) resolves it. */
  startCombat(state, opts) {
    state.combat = { cs: null, context: opts.context, attackerHeroId: opts.attackerHeroId, defender: opts.defender, stub: true };
    return { ok: true, events: [{ type: 'combat_started', ...opts.context }] };
  },
  quickCombat(state, opts) { return deps.startCombat(state, opts); },
  registerCombatOutcome(kind, fn) { combatOutcomes[kind] = fn; },
  // -- economy.js
  canAfford(state, playerId, cost) {
    const p = getPlayer(state, playerId);
    return !!p && RESOURCES.every((r) => (p.resources[r] || 0) >= (cost?.[r] || 0));
  },
  pay(state, playerId, cost) {
    if (!deps.canAfford(state, playerId, cost)) return false;
    const p = getPlayer(state, playerId);
    for (const r of RESOURCES) if (cost?.[r]) p.resources[r] -= cost[r];
    return true;
  },
  addResources(state, playerId, res) {
    const p = getPlayer(state, playerId);
    if (!p) return;
    for (const r of RESOURCES) if (res?.[r]) p.resources[r] = Math.max(0, (p.resources[r] || 0) + res[r]);
  },
  // -- town.js
  getTownSightRadius() { return 5; },
  visitTown(state, heroId, townId) {
    const town = state.towns[townId];
    const hero = state.heroes[heroId];
    town.visitingHero = heroId;
    hero.townId = townId;
    return { ok: true, events: [{ type: 'town_visited', heroId, townId }] };
  },
  leaveTown(state, heroId) {
    const hero = state.heroes[heroId];
    const town = hero && state.towns[hero.townId];
    if (town && town.visitingHero === heroId) town.visitingHero = null;
    if (hero) hero.townId = null;
    return { ok: true, events: [] };
  },
  captureTown(state, townId, playerId) {
    const town = state.towns[townId];
    const old = getPlayer(state, town.owner);
    if (old) old.towns = old.towns.filter((t) => t !== townId);
    town.owner = playerId;
    const p = getPlayer(state, playerId);
    if (p && !p.towns.includes(townId)) p.towns.push(townId);
    return { ok: true, events: [{ type: 'town_captured', townId, playerId }] };
  },
};

/** The dependency facade used by every adventure module. */
export const deps = {};
for (const name of Object.keys(fallbacks)) deps[name] = (...args) => resolve(name)(...args);

/** Always record a handler in the local (fallback) registry. */
export function registerLocalCombatOutcome(kind, fn) { combatOutcomes[kind] = fn; }
/** The real-module implementation of a dependency, or null. */
export function getRealDep(name) {
  for (const m of realModules) if (typeof m[name] === 'function') return m[name];
  return null;
}

/** Outcome handlers registered with the FALLBACK `registerCombatOutcome` (tests / standalone use). */
export function getFallbackCombatOutcome(kind) { return combatOutcomes[kind]; }

/**
 * Standalone/test helper: finish the combat recorded by the fallback `startCombat` with a given
 * CombatResult-like object (`{ winner, attacker:{army}, defender:{army} }`).
 */
export function finishStubCombat(state, result) {
  const c = state.combat;
  if (!c) return { ok: false, error: 'no_combat' };
  state.combat = null;
  const fn = combatOutcomes[c.context.kind];
  const res = fn ? fn(state, c.context, result) : null;
  return { ok: true, events: res?.events || [] };
}

export { MAX_HEROES_PER_PLAYER, sumField };
