// Derived, read-only views of a stack: tags, abilities, effective attack/defense/speed/morale/
// luck with every status effect, aura and hero bonus applied. Nothing here mutates the state.
import { getCreature } from '../../data/creatures.js';
import { getSpell } from '../../data/spells.js';
import { baseTags, otherSide, sumBonus, anyBonus, hasBonus, findBonuses } from './state.js';
import { stacksAdjacent } from './hex.js';

export const creatureOf = (stack) => getCreature(stack.creatureId);

/** First ability entry with this id, or null. */
export function abilityOf(stack, id) {
  return creatureOf(stack).abilities.find((a) => a.id === id) ?? null;
}
export const hasAb = (stack, id) => abilityOf(stack, id) !== null;

/** Creature tags of a stack; `shooter` additionally requires remaining ammunition. */
export function tagsOf(stack) {
  const tags = baseTags(stack.creatureId);
  if (stack.shots <= 0 && tags.includes('shooter')) return tags.filter((t) => t !== 'shooter');
  return tags;
}
export const hasTagS = (stack, tag) => tagsOf(stack).includes(tag);
export const isLiving = (stack) => baseTags(stack.creatureId).includes('living');

export const totalHp = (stack) => (stack.alive ? (stack.count - 1) * stack.maxHp + stack.hp : 0);

// ---- status effect views ----------------------------------------------------------------------

/**
 * Sub-effects of an active effect with their numeric value resolved:
 * `[{ ...spellEffectPart, value, eff }]` (a `multi` spell yields one entry per sub-effect).
 */
export function effectParts(eff) {
  const def = getSpell(eff.spellId).effect;
  const parts = def.type === 'multi' ? def.effects : [def];
  return parts.map((p) => ({ ...p, value: Array.isArray(p.value) ? p.value[eff.mastery] : eff.value, eff }));
}

/** All parts of a given effect type over every active effect of the stack. */
export function partsOfType(stack, type) {
  const out = [];
  for (const eff of stack.effects) for (const p of effectParts(eff)) if (p.type === type) out.push(p);
  return out;
}

/** Active control effect part of a kind (`blind`, `stone`, `bind`, ...), or null. */
export function controlOf(stack, kind) {
  return partsOfType(stack, 'control').find((p) => p.kind === kind) ?? null;
}

export const hasEffect = (stack, spellId) => stack.effects.some((e) => e.spellId === spellId);

/** Side that currently commands the stack (a hypnotized stack fights for the caster). */
export function controllerOf(stack) {
  const hyp = controlOf(stack, 'hypnotize');
  return hyp ? hyp.eff.casterSide : stack.side;
}

/** Blinded, paralyzed or petrified stacks skip their turns. */
export function isDisabled(stack) {
  return !!(controlOf(stack, 'blind') || controlOf(stack, 'paralyze') || controlOf(stack, 'stone'));
}

export const isImmobile = (stack) => hasAb(stack, 'immobile');

// ---- slayer -------------------------------------------------------------------------------------

const SLAYER_IDS = {
  behemoth: ['behemoth', 'ancient_behemoth'], hydra: ['hydra', 'chaos_hydra'], angel: ['angel', 'arch_angel'],
  devil: ['devil', 'arch_devil'], titan: ['giant', 'titan'],
};
export function slayerKinds(stack) {
  const kinds = [];
  if (baseTags(stack.creatureId).includes('dragon')) kinds.push('dragon');
  for (const [kind, ids] of Object.entries(SLAYER_IDS)) if (ids.includes(stack.creatureId)) kinds.push(kind);
  return kinds;
}

// ---- attack / defense / speed -------------------------------------------------------------------

function rawDefense(stack) {
  let d = stack.defense;
  for (const p of partsOfType(stack, 'stat_mod')) if (p.stat === 'defense') d += p.sign * p.value;
  d = Math.max(0, d);
  // Defend: +20% of the current Defense, rounded down, at least +1 (original / VCMI).
  if (stack.defending) d += Math.max(1, Math.floor(d / 5));
  if (stack.inMoat) d -= 3;
  return Math.max(0, d);
}

/** Effective Defense (before the attacker's `reduce_enemy_defense`). Frenzy sets it to 0. */
export function defenseOf(cs, stack) {
  if (partsOfType(stack, 'frenzy').length) return 0;
  return rawDefense(stack);
}

/**
 * Effective Attack.
 * @param {{ranged?: boolean, target?: Object}} ctx
 */
export function attackOf(cs, stack, ctx = {}) {
  let a = stack.attack;
  for (const p of partsOfType(stack, 'stat_mod')) {
    if (p.stat !== 'attack') continue;
    if (p.mode === 'all' || (p.mode === 'melee' && !ctx.ranged) || (p.mode === 'ranged' && ctx.ranged)) a += p.sign * p.value;
  }
  if (ctx.target) {
    const kinds = slayerKinds(ctx.target);
    for (const p of partsOfType(stack, 'slayer')) {
      if (p.versus[p.eff.mastery].some((k) => kinds.includes(k))) a += p.value;
    }
  }
  for (const p of partsOfType(stack, 'frenzy')) a += Math.floor((rawDefense(stack) * p.value) / 100);
  return Math.max(0, a);
}

/** Effective speed: flat adds, then percent (ceil), minimum 1 for mobile creatures. */
export function speedOf(cs, stack) {
  if (isImmobile(stack)) return 0;
  let s = stack.speed;
  let pct = 0;
  for (const p of partsOfType(stack, 'speed_mod')) {
    if (p.op === 'add') s += p.sign * p.value; else pct += p.sign * p.value;
  }
  s = Math.ceil((s * (100 + pct)) / 100 - 1e-9);
  return Math.max(1, s);
}

// ---- morale & luck ------------------------------------------------------------------------------

/** Strongest aura value of `abilityId` among living stacks of `side` (0 when absent). */
function auraValue(cs, side, abilityId, pick = Math.max) {
  let v = 0;
  for (const s of cs.stacks) {
    if (!s.alive || s.side !== side) continue;
    const ab = abilityOf(s, abilityId);
    if (ab) v = v === 0 ? ab.value : pick(v, ab.value);
  }
  return v;
}

const clamp3 = (v) => Math.max(-3, Math.min(3, v));

/** Magic terrain `nullify_morale_luck` (Cursed Ground) passed in `CombatInput.overlayEffects`. */
const nullifiedByTerrain = (cs) => (cs.overlayEffects ?? []).some((e) => e.type === 'nullify_morale_luck');

export function moraleOf(cs, stack) {
  const tags = baseTags(stack.creatureId);
  if (stack.warMachine || tags.includes('undead') || tags.includes('non_living')) return 0;
  const foe = otherSide(stack.side);
  let m = cs.sides[stack.side].morale
    + sumBonus(cs, foe, 'enemy_morale', null, 'value')
    + auraValue(cs, stack.side, 'army_morale', Math.max)
    + auraValue(cs, foe, 'enemy_morale', Math.min);
  for (const p of partsOfType(stack, 'stat_mod')) if (p.stat === 'morale') m += p.sign * p.value;
  m = clamp3(m);
  if (hasAb(stack, 'positive_morale')) m = Math.max(m, 1);
  if (anyBonus(cs, 'block_positive_morale')) m = Math.min(m, 0);
  if (nullifiedByTerrain(cs)) m = 0; // Cursed Ground
  return m;
}

export function luckOf(cs, stack) {
  if (stack.warMachine) return 0;
  const foe = otherSide(stack.side);
  let l = cs.sides[stack.side].luck
    + sumBonus(cs, foe, 'enemy_luck', null, 'value')
    + auraValue(cs, foe, 'enemy_luck', Math.min);
  for (const p of partsOfType(stack, 'stat_mod')) if (p.stat === 'luck') l += p.sign * p.value;
  l = clamp3(l);
  if (hasAb(stack, 'positive_luck')) l = Math.max(l, 1);
  if (anyBonus(cs, 'block_positive_luck')) l = Math.min(l, 0);
  if (nullifiedByTerrain(cs)) l = 0; // Cursed Ground
  return l;
}

// ---- retaliation --------------------------------------------------------------------------------

export function maxRetaliations(cs, stack) {
  if (hasAb(stack, 'unlimited_retaliations')) return Infinity;
  let n = 1 + (abilityOf(stack, 'extra_retaliations')?.count ?? 0);
  for (const p of partsOfType(stack, 'extra_retaliation')) n += p.value;
  return n;
}

/**
 * Damage percent of a retaliation the stack could deliver right now (0 = cannot retaliate).
 * Blinded / paralyzed stacks answer at the spell's `retaliationPercent`, petrified ones never.
 */
export function retaliationPercent(cs, stack) {
  if (!stack.alive || stack.warMachine || isImmobile(stack)) return 0;
  if (stack.retaliationsUsed >= maxRetaliations(cs, stack)) return 0;
  let pct = 100;
  for (const kind of ['blind', 'paralyze', 'stone']) {
    const c = controlOf(stack, kind);
    if (c) pct = Math.min(pct, c.retaliationPercent ? c.retaliationPercent[c.eff.mastery] : 0);
  }
  return pct;
}

// ---- magic --------------------------------------------------------------------------------------

/** Chance (0..100) that a hostile spell fails against the stack. */
export function magicResistanceOf(cs, stack) {
  if (anyBonus(cs, 'negate_resistance')) return 0;
  let pct = (abilityOf(stack, 'magic_resistance')?.percent ?? 0) + sumBonus(cs, stack.side, 'magic_resistance', null, 'percent');
  let aura = 0;
  for (const s of cs.stacks) {
    if (!s.alive || s.side !== stack.side) continue;
    const ab = abilityOf(s, 'resistance_aura');
    if (ab && (s.id === stack.id || stacksAdjacent(s, stack))) aura = Math.max(aura, ab.percent);
  }
  pct += aura;
  return Math.max(0, Math.min(100, pct));
}

/** Ammo is free while a friendly Ammo Cart stands. */
export function hasAmmoCart(cs, side) {
  return cs.stacks.some((s) => s.alive && s.side === side && hasAb(s, 'ammo_supply'));
}

// wrappers (not aliases): siege.js -> stats.js may be evaluated while state.js is still loading
export const heroHas = (...args) => hasBonus(...args);
export const heroBonuses = (...args) => findBonuses(...args);
