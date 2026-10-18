// Spell casting in combat (hero casts, creature casts, artifact casts). Rules:
// docs/mechanics/spells.md (main spec) and docs/mechanics/combat.md §6.
//
// This module owns: cast legality (mana, once per round, block_spells, spell level caps, known
// spells), mastery, cost, effective spell power, the damage / heal / value multipliers (Sorcery,
// orbs, per-spell bonuses, hero spell specialties), target selection for every target mode, area
// previews for the UI, and `resolveSpell` (single / mass / all / radius / ring / chain). Effect
// types that are not "one spell on one stack" (summon, clone, teleport, obstacles, remove
// obstacle, earthquake, sacrifice) live in `spells/handlers.js` and are registered in
// EXTRA_HANDLERS below.
import { MASTERY } from '../../core/constants.js';
import { getCreature } from '../../data/creatures.js';
import {
  getSpell, spellCost, spellValue, effectiveTarget, spellSchools, castingMastery,
} from '../../data/spells.js';
import { hexesInRadius, hexIndex, stackHexes, stackDistance, inBounds, sameHex } from './hex.js';
import { getStack, otherSide, findBonuses, sumBonus, anyBonus, SIDES, stackAt } from './state.js';
import { abilityOf, controllerOf, totalHp, controlOf } from './stats.js';
import {
  ev, applySpellToStack, canSpellAffect, canResurrect, STACK_EFFECT_TYPES, removeObstacle, removeStatus,
} from './effects.js';
import { createHandlers } from './spells/handlers.js';

/**
 * Handlers for effect types that are not "one spell on one stack".
 * `{ [effectType]: {
 *     targets(cs, side, spell, ctx, sel) -> {mode, stackIds, anyHex, available, hexes?, obstacleIds?, target2?},
 *     cast(cs, side, spell, ctx, target) -> events | null (null = illegal target),
 *     preview(cs, side, spell, ctx, hex, sel) -> {hexes, stackIds, valid} } }`
 * `ctx` is the cast context built by `castContext` (mastery, power, adjust(), ...).
 */
export const EXTRA_HANDLERS = createHandlers();

const partsOf = (spell) => (spell.effect.type === 'multi' ? spell.effect.effects : [spell.effect]);
const STACK_MODES = ['enemy_stack', 'friendly_stack', 'any_stack', 'dead_friendly_stack'];
const MASS_MODES = ['all', 'all_enemies', 'all_friendly'];

/** True when this module can resolve the spell for a hero. */
export function isSpellSupported(spell) {
  if (spell.kind !== 'combat' || spell.creatureOnly) return false;
  if (EXTRA_HANDLERS[spell.effect.type]) return true;
  if (!partsOf(spell).every((p) => STACK_EFFECT_TYPES.includes(p.type))) return false;
  if (spell.area && spell.area.shape === 'line') return false;
  return !['none', 'hex', 'obstacle'].includes(spell.target);
}

// ---- hero numbers -------------------------------------------------------------------------------

/** Magic-terrain / battlefield effects passed by the adapter (`CombatInput.overlayEffects`). */
const overlayEffects = (cs, type) => (cs.overlayEffects ?? []).filter((e) => e.type === type);

/**
 * Mastery with which the side's hero casts the spell: school skills, `spell_school_mastery`
 * bonuses, `grants_spell` mastery and magic-terrain `spell_mastery` overlays.
 */
export function heroMastery(cs, side, spell) {
  const hero = cs.sides[side].hero;
  if (!hero) return 0;
  const schools = {};
  for (const s of ['air', 'earth', 'fire', 'water']) schools[s] = hero.skills[`${s}_magic`] ?? 0;
  const raise = (school, level) => {
    if (school in schools) schools[school] = Math.max(schools[school], level ?? 0);
    else if (school === 'all' || school === undefined) for (const s of Object.keys(schools)) schools[s] = Math.max(schools[s], level ?? 0);
  };
  for (const b of findBonuses(cs, side, 'spell_school_mastery')) raise(b.school, b.level);
  for (const e of overlayEffects(cs, 'spell_mastery')) raise(e.school, e.level);
  let m = castingMastery(spell, schools);
  for (const b of findBonuses(cs, side, 'grants_spell', (x) => x.spellId === spell.id)) m = Math.max(m, b.mastery ?? 0);
  return Math.min(MASTERY.EXPERT, m);
}

/** Effective spell power: hero power reduced by the enemy's Interference / eclipse artifacts. */
export function heroSpellPower(cs, side) {
  const hero = cs.sides[side].hero;
  if (!hero) return 0;
  const foe = otherSide(side);
  let sp = hero.power;
  const interference = sumBonus(cs, foe, 'interference', null, 'percent');
  if (interference > 0) sp = Math.ceil((sp * (100 - Math.min(100, interference))) / 100);
  const eclipse = sumBonus(cs, foe, 'enemy_spell_power_percent', null, 'percent');
  if (eclipse) sp = Math.floor((sp * Math.max(0, 100 + eclipse)) / 100);
  return Math.max(1, sp);
}

function auraMax(cs, side, abilityId) {
  let v = 0;
  for (const s of cs.stacks) {
    if (!s.alive || s.side !== side) continue;
    const ab = abilityOf(s, abilityId);
    if (ab) v = Math.max(v, ab.value);
  }
  return v;
}

/** Mana the hero pays: mastery cost + `spell_cost` bonuses + enemy Pegasi - own Mages (min 1). */
export function heroSpellCost(cs, side, spellId) {
  const spell = getSpell(spellId);
  if (findBonuses(cs, side, 'grants_spell', (b) => b.spellId === spellId && b.free).length) return 0;
  const schools = spellSchools(spell);
  let delta = sumBonus(cs, side, 'spell_cost', (b) => b.school === undefined || schools.includes(b.school), 'value');
  delta += auraMax(cs, otherSide(side), 'enemy_spell_cost');
  delta -= auraMax(cs, side, 'hero_spell_cost');
  return spellCost(spell, heroMastery(cs, side, spell), delta);
}

/** Hero damage multiplier (Sorcery, orbs, per-spell bonuses) - spells.md §3.1 steps 2-4. */
export function heroDamageMultiplier(cs, side, spell) {
  const schools = spellSchools(spell);
  const generic = sumBonus(cs, side, 'spell_power_percent', (b) => b.school === undefined && b.spellId === undefined, 'percent');
  const perSchool = schools.map((s) => sumBonus(cs, side, 'spell_power_percent', (b) => b.school === s && b.spellId === undefined, 'percent'));
  const school = spell.school === 'all' ? Math.max(0, ...perSchool) : perSchool.reduce((a, b) => a + b, 0);
  const own = sumBonus(cs, side, 'spell_power_percent', (b) => b.spellId === spell.id, 'percent');
  return (1 + generic / 100) * (1 + school / 100) * (1 + own / 100);
}

/** Creature tier used by level-scaled specialties (1..7; tier 8 counts as 7). */
function tierOf(target) {
  const t = target ? getCreature(target.creatureId).tier : 0;
  return Math.min(7, Math.max(1, t || 1));
}

/**
 * Hero spell specialty (`spell_specialty` bonuses, docs/mechanics/heroes.md §4) and per-spell
 * `spell_power_percent` applied to one value for one target.
 * @param {'damage'|'heal'|'value'|'hp_limit'|'count'} kind
 *   damage: float factor (Sorcery etc. are already in the caller's base); heal: §3.2 (per-spell
 *   percent + specialty, floored); value: status magnitude (level_scaled rounds the delta up,
 *   fixed_percent floors, tiered / fixed_value add); hp_limit / count: factor.
 * @param {Object|null} target stack (or `{creatureId}`) whose tier scales `level_scaled`
 */
export function specialtyAdjust(cs, side, spell, kind, value, target = null) {
  const hero = side ? cs.sides[side]?.hero : null;
  if (!hero) return value;
  const specs = findBonuses(cs, side, 'spell_specialty', (b) => b.spellId === spell.id);
  let factor = 1;
  let flat = 0;
  for (const b of specs) {
    if (b.mode === 'level_scaled') {
      if (target) factor *= 1 + ((b.percentPerStep ?? 3) / 100) * Math.floor((b.heroLevel ?? hero.level ?? 1) / tierOf(target));
    } else if (b.mode === 'fixed_percent') {
      factor *= 1 + (b.percent ?? 0) / 100;
    } else if (b.mode === 'tiered') {
      if (target) flat += (b.tierBonus ?? [3, 3, 2, 2, 1, 1, 0])[tierOf(target) - 1] ?? 0;
    } else if (b.mode === 'fixed_value') {
      flat += b.value ?? 0;
    }
  }
  switch (kind) {
    case 'damage':
      return value * factor;
    case 'heal': {
      const own = sumBonus(cs, side, 'spell_power_percent', (b) => b.spellId === spell.id, 'percent');
      return Math.floor(value * (1 + own / 100) * factor + 1e-9);
    }
    case 'value': {
      if (factor === 1) return value + flat;
      const scaled = specs.some((b) => b.mode === 'level_scaled') ? Math.ceil(value * factor - 1e-9) : Math.floor(value * factor + 1e-9);
      return scaled + flat;
    }
    default:
      return value * factor;
  }
}

/** Spell levels nobody may cast: `block_spells` artifacts, anti-magic garrisons, cursed ground. */
function spellBlocked(cs, spell) {
  for (const side of SIDES) {
    for (const b of findBonuses(cs, side, 'block_spells')) {
      if (spell.level >= (b.minLevel ?? 1) && spell.level <= (b.maxLevel ?? 5)) return true;
    }
  }
  if (typeof cs.spellLevelCap === 'number' && spell.level > cs.spellLevelCap) return true;
  for (const e of overlayEffects(cs, 'spell_level_cap')) if (spell.level > (e.maxLevel ?? 5)) return true;
  return false;
}

/** Spells the side's hero knows in combat: spell book + `grants_spell` bonuses. */
export function knownSpells(cs, side) {
  const hero = cs.sides[side]?.hero;
  // `spellbook: false` (CombatSide.hero from the hero adapter): scrolls / artifacts need a book too.
  if (!hero || hero.spellbook === false) return [];
  const ids = new Set(hero.spells);
  for (const b of findBonuses(cs, side, 'grants_spell')) if (b.spellId) ids.add(b.spellId);
  return [...ids].filter((id) => {
    try { return getSpell(id).kind === 'combat'; } catch { return false; }
  });
}

/**
 * Everything a hero cast needs, for one spell: mastery, effective power, multipliers, duration
 * bonus and the specialty adjuster. Also used for previews and target lists.
 */
export function castContext(cs, side, spell) {
  return {
    mastery: heroMastery(cs, side, spell),
    power: heroSpellPower(cs, side),
    casterSide: side,
    hero: true,
    allowMirror: true,
    damageMult: heroDamageMultiplier(cs, side, spell),
    extraDuration: sumBonus(cs, side, 'spell_duration', null, 'value'),
    adjust: (kind, value, target) => specialtyAdjust(cs, side, spell, kind, value, target),
  };
}

// ---- targets ------------------------------------------------------------------------------------

const identity = (kind, value) => value;

function hpLimitOk(spell, ctx, target) {
  const part = partsOf(spell).find((p) => p.hpLimit);
  if (!part) return true;
  const limit = (ctx.adjust ?? identity)('hp_limit', spellValue(spell, ctx.mastery ?? 0, ctx.power ?? 0), target);
  return totalHp(target) < limit;
}

/** Stacks that may be chosen (single target) or will be affected (mass / all). */
function eligibleStacks(cs, spell, mode, side, ctx) {
  const out = [];
  const mastery = ctx.mastery ?? 0;
  for (const s of cs.stacks) {
    if (mode === 'dead_friendly_stack') {
      if (s.side !== side || s.clone || s.summoned || s.warMachine) continue;
      if (!canResurrect(cs, s) || !canSpellAffect(cs, spell.id, s, side, { allowDead: true })) continue;
      out.push(s);
      continue;
    }
    if (!s.alive) continue;
    const friendly = controllerOf(s) === side;
    if ((mode === 'friendly_stack' || mode === 'all_friendly') && !friendly) continue;
    if ((mode === 'enemy_stack' || mode === 'all_enemies') && friendly) continue;
    const expertDispel = spell.effect.type === 'dispel' && mastery >= MASTERY.EXPERT;
    if (!canSpellAffect(cs, spell.id, s, side, { ignoreAntiMagic: expertDispel })) continue;
    if (!hpLimitOk(spell, ctx, s)) continue;
    if (controlOf(s, 'hypnotize') && partsOf(spell).some((p) => p.type === 'control' && p.kind === 'hypnotize')) continue;
    out.push(s);
  }
  return out;
}

/**
 * What the hero of `side` may target with a spell right now.
 * @param {Object} [sel] second-step selection: `{stackId}` for Teleport (-> destination hexes) and
 *   Sacrifice (-> victims)
 * @returns {{mode: string, stackIds: number[], anyHex: boolean, available?: boolean,
 *   hexes?: Hex[], obstacleIds?: number[], target2?: string}}
 *   `mode`: `enemy_stack | friendly_stack | any_stack | dead_friendly_stack | area | all_enemies |
 *   all_friendly | all | hex | obstacle | none`. For `area` any battlefield hex is legal and
 *   `stackIds` lists the stacks the spell could affect at all; `hex`: `hexes` = legal top hexes of
 *   a line obstacle; `obstacle`: `obstacleIds`; `none`: no selection (`available` tells whether
 *   the cast is possible).
 */
export function getSpellTargets(cs, side, spellId, sel = {}) {
  const spell = getSpell(spellId);
  const ctx = castContext(cs, side, spell);
  return spellTargets(cs, side, spell, ctx, sel);
}

function spellTargets(cs, side, spell, ctx, sel = {}) {
  const handler = EXTRA_HANDLERS[spell.effect.type];
  if (handler) return handler.targets(cs, side, spell, ctx, sel);
  const mode = effectiveTarget(spell, ctx.mastery);
  const pool = mode === 'area' || mode === 'all' ? 'any_stack' : mode;
  const stackIds = eligibleStacks(cs, spell, pool, side, ctx).map((s) => s.id);
  return { mode, stackIds, anyHex: mode === 'area' };
}

const targetsAvailable = (t) => (t.available !== undefined ? t.available : t.stackIds.length > 0);

function castProblem(cs, side, spellId) {
  const sideState = cs.sides[side];
  const hero = sideState?.hero;
  if (cs.phase !== 'battle') return 'not_in_battle';
  if (!hero) return 'no_hero';
  if (sideState.castThisRound) return 'already_cast';
  const active = getStack(cs, cs.active);
  if (!active || controllerOf(active) !== side) return 'not_your_turn';
  if (!knownSpells(cs, side).includes(spellId)) return 'unknown_spell';
  const spell = getSpell(spellId);
  if (spell.special && !findBonuses(cs, side, 'grants_spell', (b) => b.spellId === spellId).length) return 'unknown_spell';
  if (!isSpellSupported(spell)) return 'unsupported_spell';
  if (spellBlocked(cs, spell)) return 'spells_blocked';
  if (hero.mana < heroSpellCost(cs, side, spellId)) return 'no_mana';
  if (!targetsAvailable(getSpellTargets(cs, side, spellId))) return 'no_target';
  return null;
}

/** Spell ids the side's hero can cast right now (known, affordable, has a target, not yet cast). */
export function getCastableSpells(cs, side) {
  if (!cs.sides[side]?.hero) return [];
  return knownSpells(cs, side).filter((id) => castProblem(cs, side, id) === null);
}

/** Why the hero cannot cast the spell now (`null` = castable). */
export function getCastProblem(cs, side, spellId) {
  return castProblem(cs, side, spellId);
}

// ---- areas --------------------------------------------------------------------------------------

/** Hexes covered by a `radius` / `ring` spell centred on `center` at mastery `m`. */
export function spellAreaHexes(spell, mastery, center) {
  if (!spell.area || !['radius', 'ring'].includes(spell.area.shape)) return [{ x: center.x, y: center.y }];
  return hexesInRadius(center, spell.area.r[mastery], spell.area.shape === 'ring' ? 1 : 0);
}

function areaStacks(cs, spell, mastery, center, casterSide) {
  const hexes = new Set(spellAreaHexes(spell, mastery, center).map(hexIndex));
  const friendlyFire = spell.effect.friendlyFire || spell.effect.type === 'control';
  return cs.stacks.filter((s) => s.alive && stackHexes(s).some((h) => hexes.has(hexIndex(h)))
    && (friendlyFire || controllerOf(s) !== casterSide));
}

/** Chain Lightning order from `first` (resistance not rolled: immune stacks are skipped). */
function chainOrder(cs, spell, mastery, first, casterSide) {
  const order = [];
  const hit = new Set();
  let current = first;
  for (let k = 0; k < spell.area.targets[mastery] && current; k++) {
    order.push(current);
    hit.add(current.id);
    const from = current;
    const next = cs.stacks.filter((s) => s.alive && !hit.has(s.id) && canSpellAffect(cs, spell.id, s, casterSide))
      .sort((a, b) => stackDistance(from, a) - stackDistance(from, b) || a.id - b.id);
    current = next[0] ?? null;
  }
  return order;
}

/**
 * UI preview of what a cast aimed at `hex` would affect (no randomness, nothing changes).
 * @param {Object} [sel] `{stackId}` for the second step of Teleport / Sacrifice
 * @returns {{mode: string, valid: boolean, hexes: Hex[], stackIds: number[]}}
 *   `hexes`: highlighted hexes (area, line, destination footprint, target footprint);
 *   `stackIds`: stacks that would be affected (Chain Lightning: in jump order).
 */
export function getSpellAreaPreview(cs, side, spellId, hex = null, sel = {}) {
  const spell = getSpell(spellId);
  const ctx = castContext(cs, side, spell);
  const t = spellTargets(cs, side, spell, ctx, sel);
  const m = ctx.mastery;
  const handler = EXTRA_HANDLERS[spell.effect.type];
  if (handler && handler.preview) return { mode: t.mode, ...handler.preview(cs, side, spell, ctx, hex, sel, t) };
  const stacksIn = (ids) => ids.map((id) => getStack(cs, id)).filter(Boolean);
  if (t.mode === 'area') {
    if (!hex || !inBounds(hex)) return { mode: t.mode, valid: false, hexes: [], stackIds: [] };
    const stacks = areaStacks(cs, spell, m, hex, side).filter((s) => canSpellAffect(cs, spell.id, s, side));
    return { mode: t.mode, valid: true, hexes: spellAreaHexes(spell, m, hex), stackIds: stacks.map((s) => s.id) };
  }
  if (MASS_MODES.includes(t.mode)) {
    const stacks = stacksIn(t.stackIds);
    return { mode: t.mode, valid: stacks.length > 0, hexes: stacks.flatMap(stackHexes), stackIds: stacks.map((s) => s.id) };
  }
  // single-stack modes: the stack under the cursor
  const under = hex ? (stackAt(cs, hex) ?? cs.stacks.find((s) => !s.alive && stackHexes(s).some((h) => sameHex(h, hex))) ?? null) : null;
  if (!under || !t.stackIds.includes(under.id)) return { mode: t.mode, valid: false, hexes: [], stackIds: [] };
  let stacks = [under];
  if (spell.area && spell.area.shape === 'chain') stacks = chainOrder(cs, spell, m, under, side);
  return { mode: t.mode, valid: true, hexes: stacks.flatMap(stackHexes), stackIds: stacks.map((s) => s.id) };
}

// ---- resolution ---------------------------------------------------------------------------------

/**
 * Resolve a spell on the battlefield for any caster (hero or creature): picks the affected
 * stacks from the target mode / area / chain and applies the spell to each.
 * @param {Object} ctx { mastery, power, casterSide, sourceStackId?, duration?, extraDuration?,
 *                       damageMult?, damage?, heal?, value?, mode? (override the selection mode,
 *                       e.g. 'all_friendly'), resistible?, hero?, allowMirror?,
 *                       adjust?(kind, value, target) (hero specialty) }
 * @param {Object|number|null} target stack, stack id, `{stackId}`, or `{x, y}` for area spells
 * @returns {Object[]} events
 */
export function resolveSpell(cs, spellId, ctx, target = null) {
  const spell = getSpell(spellId);
  const m = ctx.mastery ?? 0;
  const handler = EXTRA_HANDLERS[spell.effect.type];
  if (handler && !ctx.mode) return handler.cast(cs, ctx.casterSide, spell, { ...ctx, mastery: m }, target) ?? [];
  const mode = ctx.mode ?? effectiveTarget(spell, m);
  const events = [];
  const parts = partsOf(spell);
  const isDamage = parts.some((p) => p.type === 'damage' || p.type === 'damage_over_time');
  const isHeal = parts.some((p) => ['heal', 'heal_over_time', 'resurrect'].includes(p.type));
  const hasValue = parts.some((p) => !['damage', 'damage_over_time', 'heal', 'heal_over_time', 'resurrect', 'dispel'].includes(p.type));
  const adjust = ctx.adjust ?? identity;
  const base = { ...ctx };
  delete base.mode;
  delete base.adjust;
  delete base.damageMult;
  const baseDamage = isDamage ? (ctx.damage ?? spellValue(spell, m, ctx.power ?? 0) * (ctx.damageMult ?? 1)) : undefined;
  const baseHeal = isHeal ? (ctx.heal ?? spellValue(spell, m, ctx.power ?? 0)) : undefined;
  if (spell.effect.type === 'dispel' && m >= MASTERY.EXPERT) base.ignoreAntiMagic = true;
  /** Per-target options (hero specialties scale damage / heal / magnitude by the target's tier). */
  const optsFor = (t, extra = {}) => {
    const o = { ...base, ...extra };
    if (isDamage) o.damage = adjust('damage', baseDamage, t);
    if (isHeal) o.heal = adjust('heal', baseHeal, t);
    if (hasValue && ctx.value === undefined && ctx.adjust) {
      let v = adjust('value', spell.power[m], t);
      if (parts.some((p) => p.type === 'control' && p.kind === 'forget')) v = Math.min(100, v);
      if (v !== spell.power[m]) o.value = v;
    }
    return o;
  };
  let tStack = null;
  if (typeof target === 'number') tStack = getStack(cs, target);
  else if (target && target.id !== undefined && target.creatureId) tStack = target;
  else if (target && target.stackId !== undefined) tStack = getStack(cs, target.stackId);

  if (mode === 'area') {
    const center = tStack ? tStack.pos : target;
    if (!center || !inBounds(center)) return events;
    for (const s of areaStacks(cs, spell, m, center, ctx.casterSide)) {
      if (!s.alive) continue;
      if (canSpellAffect(cs, spellId, s, ctx.casterSide)) events.push(...applySpellToStack(cs, spellId, optsFor(s, { allowMirror: false }), s));
    }
    return events;
  }
  if (MASS_MODES.includes(mode)) {
    for (const s of [...cs.stacks]) {
      if (!s.alive) continue;
      const friendly = controllerOf(s) === ctx.casterSide;
      if ((mode === 'all_enemies' && friendly) || (mode === 'all_friendly' && !friendly)) continue;
      if (!canSpellAffect(cs, spellId, s, ctx.casterSide, { ignoreAntiMagic: base.ignoreAntiMagic })) continue;
      if (!hpLimitOk(spell, ctx, s)) continue;
      events.push(...applySpellToStack(cs, spellId, optsFor(s, { allowMirror: false }), s));
      // Expert Dispel is the only thing that removes Anti-Magic (spells.md §7.2).
      if (spell.effect.type === 'dispel' && base.ignoreAntiMagic) {
        events.push(...removeStatus(cs, s, (e) => getSpell(e.spellId).effect.type === 'spell_immunity', 'dispelled'));
      }
    }
    // Expert Dispel also clears every magical obstacle (both sides').
    const dispel = parts.find((p) => p.type === 'dispel');
    if (dispel && dispel.obstacles && dispel.obstacles[m]) {
      for (const o of [...cs.obstacles]) if (o.magical && !o.siege) events.push(...removeObstacle(cs, o.id));
    }
    return events;
  }
  if (!tStack) return events;
  if (spell.area && spell.area.shape === 'chain') {
    const hit = new Set();
    let current = tStack;
    let factor = 1;
    for (let k = 0; k < spell.area.targets[m] && current; k++) {
      hit.add(current.id);
      events.push(...applySpellToStack(cs, spellId, optsFor(current, { factor, allowMirror: k === 0 && ctx.allowMirror }), current));
      factor *= spell.area.factor;
      const from = current;
      const next = cs.stacks.filter((s) => s.alive && !hit.has(s.id) && canSpellAffect(cs, spellId, s, ctx.casterSide))
        .sort((a, b) => stackDistance(from, a) - stackDistance(from, b) || a.id - b.id);
      current = next[0] ?? null;
    }
    return events;
  }
  events.push(...applySpellToStack(cs, spellId, optsFor(tStack), tStack));
  return events;
}

/** Stack ids touched by a cast (for the `spell` event). */
const AFFECT_EVENTS = ['damage', 'status_added', 'status_removed', 'heal', 'resurrect', 'summon', 'spell_resisted', 'spell_immune', 'spell_reflected', 'move', 'death'];
function affectedIds(events) {
  const ids = [];
  for (const e of events) {
    if (AFFECT_EVENTS.includes(e.type) && e.stackId !== undefined && e.stackId !== null && !ids.includes(e.stackId)) ids.push(e.stackId);
  }
  return ids;
}

/**
 * The hero of `side` casts a spell. Does not consume the active stack's action.
 * `target` per selection mode:
 *   stack modes: stack id or `{stackId}`; `area`: `{x, y}` (or a stack id = its hex);
 *   mass / `all` / `none`: null; `hex` (Force Field, Fire Wall): `{x, y}` = top hex of the line;
 *   `obstacle` (Remove Obstacle): obstacle id or `{obstacleId}`;
 *   Teleport: `{stackId, hex: {x, y}}`; Sacrifice: `{stackId (raised), victimId}`.
 * @returns {{ok: true, events: Object[]} | {ok: false, error: string}}
 */
export function castHeroSpell(cs, side, spellId, target = null) {
  const problem = castProblem(cs, side, spellId);
  if (problem) return { ok: false, error: problem };
  const spell = getSpell(spellId);
  const sideState = cs.sides[side];
  const hero = sideState.hero;
  const ctx = castContext(cs, side, spell);
  const cost = heroSpellCost(cs, side, spellId);
  // Familiars of the enemy channel part of the mana (decided at cast time).
  const foe = otherSide(side);
  let channelPct = 0;
  for (const s of cs.stacks) if (s.alive && s.side === foe) channelPct = Math.max(channelPct, abilityOf(s, 'magic_channel')?.percent ?? 0);
  let resolved;
  const handler = EXTRA_HANDLERS[spell.effect.type];
  if (handler) {
    resolved = handler.cast(cs, side, spell, ctx, target);
    if (!resolved) return { ok: false, error: 'bad_target' };
  } else {
    const targets = spellTargets(cs, side, spell, ctx);
    let tgt = target;
    if (tgt && typeof tgt === 'object' && tgt.stackId !== undefined) tgt = tgt.stackId;
    if (STACK_MODES.includes(targets.mode)) {
      if (typeof tgt !== 'number' || !targets.stackIds.includes(tgt)) return { ok: false, error: 'bad_target' };
    } else if (targets.mode === 'area') {
      if (typeof tgt === 'number') tgt = getStack(cs, tgt)?.pos ?? null;
      if (!tgt || !inBounds(tgt)) return { ok: false, error: 'bad_target' };
    } else {
      tgt = null;
    }
    resolved = resolveSpell(cs, spellId, ctx, tgt);
  }
  hero.mana -= cost;
  sideState.castThisRound = true;
  if (!sideState.spellsCast) sideState.spellsCast = [];
  sideState.spellsCast.push(spellId);
  const events = [ev('spell', {
    side, spellId, mastery: ctx.mastery, cost, power: ctx.power, target, manaLeft: hero.mana, caster: 'hero',
    affected: affectedIds(resolved),
  }), ...resolved];
  const foeHero = cs.sides[foe].hero;
  if (foeHero && cost > 0) {
    const gain = Math.min(Math.floor((cost * channelPct) / 100), Math.max(0, foeHero.maxMana - foeHero.mana));
    if (gain > 0) {
      foeHero.mana += gain;
      events.push(ev('mana_channel', { side: foe, amount: gain }));
    }
  }
  return { ok: true, events };
}

/** `combat_start_cast` hero bonuses (Angelic Alliance, Armor of the Damned...): free mass casts. */
export function applyCombatStartCasts(cs) {
  const events = [];
  for (const side of SIDES) {
    for (const b of findBonuses(cs, side, 'combat_start_cast')) {
      const power = b.power ?? 1;
      const resolved = resolveSpell(cs, b.spellId, {
        mastery: b.mastery ?? 0, power, casterSide: side, duration: power, mode: b.target ?? 'all_friendly',
      });
      events.push(ev('spell', { side, spellId: b.spellId, mastery: b.mastery ?? 0, cost: 0, power, target: null, auto: true, caster: 'artifact', affected: affectedIds(resolved) }));
      events.push(...resolved);
    }
  }
  return events;
}

export { anyBonus };
