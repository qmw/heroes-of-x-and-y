// Reward vocabulary (docs/mechanics/adventure-objects.md §2.3): resolving ranges/tables into a
// concrete reward (plain JSON, storable in obj.data) and applying it to a hero.
import { RESOURCES, PRIMARY_SKILLS, MAX_SECONDARY_SKILLS, FACTIONS } from '../../core/constants.js';
import { HERO_SPELLS, getSpell, spellSchools } from '../../data/spells.js';
import { getCreature, creaturesOfTier } from '../../data/creatures.js';
import { getArtifact } from '../../data/artifacts.js';
import { pickRandomArtifact, giveArtifact, makeScroll, BACKPACK_CAP, ensureArtifacts } from '../artifacts.js';
import { pushPending, registerPendingHandler } from '../pending.js';
import { deps } from './deps.js';
import { rollRange, pick, randInt, pickDistinct, armyAdd, armyCanAdd, armyRemoveCreature, armyStacks, getPlayer } from './util.js';

// ---- random pools -------------------------------------------------------------------------------

/** Random artifact id of a class (`'any'`/null = any of the four), avoiding ids already placed on this map. */
export function rollArtifact(state, cls) {
  const map = state.map;
  map.placedArtifacts ??= [];
  const c = cls === 'any' || cls == null ? null : cls;
  let id = pickRandomArtifact(state.rng, c, map.placedArtifacts);
  if (!id) id = pickRandomArtifact(state.rng, c, []); // pool exhausted: allow duplicates
  if (id) map.placedArtifacts.push(id);
  return id;
}

/** Random hero spell id. `level`: n or [min,max]; `school`: optional. */
export function rollSpell(state, { level = null, school = null, exclude = [] } = {}) {
  const lv = level == null ? null : rollRange(state.rng, Array.isArray(level) ? [level[0], level[1]] : level);
  const pool = HERO_SPELLS.filter((s) => !s.special && (lv == null || s.level === lv) &&
    (school == null || spellSchools(s).includes(school)) && !exclude.includes(s.id));
  return pool.length ? pick(state.rng, pool).id : null;
}

// ---- resolve ------------------------------------------------------------------------------------

/**
 * Turn a Reward description (ranges, classes, filters) into a concrete reward:
 * `{ resources?, exp?, mana?, artifacts?: [id|{id:'spell_scroll',spellId}], creatures?, spell?: {spellId, requires?},
 *    spells?: [spellId], primary?: {stat: n}, bonuses?: [{bonus, until}], skills?, morale?, luck? }`.
 */
export function resolveReward(state, reward, opts = {}) {
  const rng = state.rng;
  const out = {};
  if (!reward) return out;
  const resources = {};
  for (const [r, v] of Object.entries(reward.resources || {})) resources[r] = (resources[r] || 0) + rollRange(rng, v);
  if (reward.randomResource) {
    const r = pick(rng, reward.randomResource.pool);
    resources[r] = (resources[r] || 0) + rollRange(rng, reward.randomResource.amount);
  }
  if (Object.keys(resources).length) out.resources = resources;
  for (const k of ['exp', 'mana', 'morale', 'luck']) if (reward[k]) out[k] = rollRange(rng, reward[k]);
  if (reward.artifacts && reward.artifacts.length) {
    out.artifacts = [];
    for (const a of reward.artifacts) {
      if (typeof a === 'string' || a.id) { out.artifacts.push(a); continue; }
      for (let i = 0; i < (a.count || 1); i++) {
        const id = rollArtifact(state, a.class);
        if (id) out.artifacts.push(id);
      }
    }
  }
  if (reward.artifact) (out.artifacts ??= []).push(reward.artifact);
  if (reward.creatures && reward.creatures.length) out.creatures = reward.creatures.map((c) => ({ creatureId: c.creatureId, count: rollRange(rng, c.count) }));
  if (reward.creaturesByValue) {
    const { tier, aiValue } = reward.creaturesByValue;
    const faction = opts.faction || reward.creaturesByValue.faction || pick(rng, FACTIONS);
    const pool = creaturesOfTier(tier, faction).filter((c) => !c.upgraded && !c.warMachine);
    const c = pool.length ? pick(rng, pool) : pick(rng, creaturesOfTier(tier).filter((x) => !x.warMachine));
    (out.creatures ??= []).push({ creatureId: c.id, count: Math.max(1, Math.floor(aiValue / c.aiValue)) });
  }
  if (reward.spell) {
    if (typeof reward.spell === 'string') out.spell = { spellId: reward.spell };
    else if (reward.spell.spellId) out.spell = { ...reward.spell };
    else {
      const spellId = rollSpell(state, { level: reward.spell.level, school: reward.spell.school });
      if (spellId) out.spell = { spellId, ...(reward.spell.requires ? { requires: reward.spell.requires } : {}) };
    }
  }
  if (reward.spells) {
    if (Array.isArray(reward.spells)) out.spells = reward.spells.slice();
    else {
      const f = reward.spells;
      const pool = HERO_SPELLS.filter((s) => !s.special && (f.level == null || s.level === f.level) && (f.school == null || spellSchools(s).includes(f.school))).map((s) => s.id);
      out.spells = f.count === 'all' || f.count >= pool.length ? pool : pickDistinct(rng, pool, f.count);
    }
  }
  if (reward.primary) {
    out.primary = {};
    for (const [stat, n] of Object.entries(reward.primary)) {
      const s = stat === 'random' ? pick(rng, PRIMARY_SKILLS) : stat;
      out.primary[s] = (out.primary[s] || 0) + n;
    }
  }
  if (reward.skill) out.skills = [{ ...reward.skill }];
  if (reward.skills) out.skills = [...(out.skills || []), ...reward.skills.map((s) => ({ ...s }))];
  if (reward.bonuses && reward.bonuses.length) out.bonuses = reward.bonuses.map((b) => ({ bonus: { ...b.bonus }, until: b.until }));
  return out;
}

export const rewardIsEmpty = (r) => !r || Object.keys(r).length === 0;

// ---- apply --------------------------------------------------------------------------------------

/** Can the hero take one more artifact (free slot or backpack room)? */
export function canCarryArtifact(hero) {
  return ensureArtifacts(hero).backpack.length < BACKPACK_CAP;
}

/** Give an artifact entry to the hero; events are appended. @returns {boolean} */
export function grantArtifact(state, hero, entry, events) {
  const e = typeof entry === 'object' && entry.id === 'spell_scroll' ? makeScroll(entry.spellId) : entry;
  getArtifact(typeof e === 'string' ? e : e.id);
  const res = giveArtifact(hero, e);
  if (res.ok) events.push(...res.events);
  else events.push({ type: 'artifact_lost', heroId: hero.id, artifact: e, reason: res.error });
  return res.ok;
}

/**
 * Creatures join the hero (existing stack of the type, else a free slot). Without room an
 * `army_overflow` pending lets the player dismiss a stack; declined leftovers are lost.
 */
export function grantCreatures(state, hero, creatureId, count, events) {
  if (count < 0) {
    const removed = armyRemoveCreature(hero.army, creatureId, -count);
    // never remove the very last creature of the army
    if (armyStacks(hero.army).length === 0 && removed > 0) hero.army[0] = { creatureId, count: 1 };
    events.push({ type: 'creatures_lost', heroId: hero.id, creatureId, count: removed });
    return true;
  }
  if (count === 0) return true;
  if (armyAdd(hero.army, creatureId, count)) {
    events.push({ type: 'creatures_joined', heroId: hero.id, creatureId, count });
    return true;
  }
  pushPending(state, {
    kind: 'army_overflow', playerId: hero.owner, heroId: hero.id,
    options: [
      ...hero.army.map((s, slot) => (s ? { id: 'dismiss', slot, creatureId: s.creatureId, count: s.count } : null)).filter(Boolean),
      { id: 'leave' },
    ],
    data: { creatureId, count },
  });
  events.push({ type: 'army_overflow', heroId: hero.id, creatureId, count });
  return false;
}

registerPendingHandler('army_overflow', (state, pending, optionIndex) => {
  const hero = state.heroes[pending.heroId];
  const opt = pending.options[optionIndex];
  const { creatureId, count } = pending.data;
  if (!hero || opt.id === 'leave') return { ok: true, events: [{ type: 'creatures_left', heroId: pending.heroId, creatureId, count }] };
  const events = [{ type: 'stack_dismissed', heroId: hero.id, slot: opt.slot, creatureId: opt.creatureId, count: opt.count }];
  hero.army[opt.slot] = null;
  armyAdd(hero.army, creatureId, count);
  events.push({ type: 'creatures_joined', heroId: hero.id, creatureId, count });
  return { ok: true, events };
});

/** Learn / raise a secondary skill to at least `level`. @returns {boolean} changed */
export function grantSkill(hero, id, level = 1) {
  const have = hero.skills.find((s) => s.id === id);
  if (have) {
    if (have.level >= level) return false;
    have.level = Math.min(3, level);
    return true;
  }
  if (hero.skills.length >= MAX_SECONDARY_SKILLS) return false;
  hero.skills.push({ id, level: Math.min(3, level) });
  return true;
}

/**
 * Apply a concrete reward (or a Pandora/event payload - same keys, values may be negative).
 * @param {string} source `hero.temp[].source` for temp bonuses (object definition id)
 */
export function applyReward(state, hero, reward, events, source = 'reward') {
  if (!reward) return;
  const player = getPlayer(state, hero.owner);
  if (reward.resources && player) {
    const delta = {};
    for (const r of RESOURCES) {
      const n = reward.resources[r] || 0;
      if (!n) continue;
      delta[r] = n < 0 ? -Math.min(player.resources[r] || 0, -n) : n;
    }
    deps.addResources(state, hero.owner, delta);
    events.push({ type: 'resources', playerId: hero.owner, resources: delta });
  }
  if (reward.mana) {
    hero.mana = Math.max(0, hero.mana + reward.mana);
    events.push({ type: 'mana', heroId: hero.id, amount: reward.mana });
  }
  for (const k of ['morale', 'luck']) {
    if (reward[k]) {
      deps.addTempBonus(state, hero.id, source, { type: k, value: reward[k] }, 'next_battle');
      events.push({ type: 'temp_bonus', heroId: hero.id, bonus: { type: k, value: reward[k] }, until: 'next_battle' });
    }
  }
  for (const b of reward.bonuses || []) {
    deps.addTempBonus(state, hero.id, source, b.bonus, b.until);
    events.push({ type: 'temp_bonus', heroId: hero.id, bonus: b.bonus, until: b.until });
  }
  for (const [stat, n] of Object.entries(reward.primary || {})) {
    const s = stat === 'random' ? pick(state.rng, PRIMARY_SKILLS) : stat;
    hero.primary[s] = Math.max(0, hero.primary[s] + n);
    events.push({ type: 'primary', heroId: hero.id, stat: s, value: n });
  }
  for (const s of reward.skills || []) {
    if (grantSkill(hero, s.id, s.level || 1)) events.push({ type: 'skill_learned', heroId: hero.id, skillId: s.id, level: s.level || 1 });
  }
  for (const a of reward.artifacts || []) grantArtifact(state, hero, a, events);
  const spells = [...(reward.spells || [])];
  if (reward.spell) {
    const rq = reward.spell.requires;
    if (!rq || deps.getSkillLevel(hero, rq.skillId) >= rq.level) spells.push(reward.spell.spellId);
    else events.push({ type: 'spell_not_learned', heroId: hero.id, spellId: reward.spell.spellId, reason: 'requirement' });
  }
  for (const spellId of spells) {
    getSpell(spellId);
    if ((hero.spells || []).includes(spellId)) continue;
    if (deps.canLearnSpell(state, hero, spellId)) {
      const res = deps.learnSpell(state, hero.id, spellId);
      if (res && res.ok !== false) { events.push({ type: 'spell_learned', heroId: hero.id, spellId }); continue; }
    }
    events.push({ type: 'spell_not_learned', heroId: hero.id, spellId, reason: 'cannot_learn' });
  }
  for (const c of reward.creatures || []) {
    getCreature(c.creatureId);
    grantCreatures(state, hero, c.creatureId, c.count, events);
  }
  // experience last: it may queue level-up pendings
  if (reward.exp) {
    if (reward.exp > 0) {
      const res = deps.giveExperience(state, hero.id, reward.exp);
      events.push({ type: 'exp', heroId: hero.id, amount: reward.exp });
      if (res && res.events) events.push(...res.events);
    } else {
      hero.exp = Math.max(0, hero.exp + reward.exp);
      events.push({ type: 'exp', heroId: hero.id, amount: reward.exp });
    }
  }
}

export { armyCanAdd, randInt };
