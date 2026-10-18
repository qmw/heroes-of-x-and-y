// The attack damage formula of the original game (docs/mechanics/combat.md §4).
//   damage = floor( base * (1 + sum of bonuses) * product(1 - reductions) ), minimum 1
// Pure with respect to the state except for the dice consumed by the base damage roll.
import { rollInt, sumBonus, hasBonus, bonusesOf } from './state.js';
import { stackDistance } from './hex.js';
import {
  creatureOf, abilityOf, hasAb, attackOf, defenseOf, partsOfType, controlOf, totalHp,
} from './stats.js';
import { siegeShotPenalty } from './siege.js';

/** Per-creature damage range after Bless / Curse. */
export function damageRange(stack) {
  let min = stack.minDamage;
  let max = stack.maxDamage;
  for (const p of partsOfType(stack, 'damage_mode')) {
    if (p.mode === 'max') min = max; else max = min;
  }
  return { min, max: Math.max(min, max) };
}

/**
 * Bless / Curse percent on the stack's base damage (advanced+: Bless +3 %, Curse -20 %);
 * applied to the total, floored, minimum 1 (spells.md §4 `damage_mode`).
 */
export function blessCursePercent(stack) {
  let pct = 0;
  for (const p of partsOfType(stack, 'damage_mode')) pct += p.percent?.[p.eff.mastery] ?? 0;
  return pct;
}

/** Number of creatures that take part in the blow (Forgetfulness halves shooters). */
export function strikingCount(stack, ranged) {
  if (hasAb(stack, 'hero_attack_scaling')) return 1;
  if (ranged) {
    const forget = controlOf(stack, 'forget');
    if (forget && forget.value < 100) return Math.ceil(stack.count / 2);
  }
  return stack.count;
}

/**
 * Base damage: up to 10 creatures roll individually; larger stacks roll 10 times and scale by
 * count / 10 (integer division). `mode`: 'roll' | 'min' | 'max' | 'avg' (AI look-ahead).
 */
export function rollBaseDamage(cs, stack, ranged, mode = 'roll') {
  const { min, max } = damageRange(stack);
  const n = strikingCount(stack, ranged);
  const forced = mode !== 'roll' ? mode : (cs.force && cs.force.damage) || null;
  let base;
  if (forced === 'min' || min === max) base = n * min;
  else if (forced === 'max') base = n * max;
  else if (forced === 'avg') base = (n * (min + max)) / 2; // AI look-ahead (expected value, unrounded)
  else if (n <= 10) {
    base = 0;
    for (let i = 0; i < n; i++) base += rollInt(cs, min, max);
  } else {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += rollInt(cs, min, max);
    base = Math.floor((sum * n) / 10);
  }
  if (hasAb(stack, 'hero_attack_scaling')) base *= (cs.sides[stack.side].hero?.attack ?? 0) + 1;
  const pct = blessCursePercent(stack);
  if (pct) base = Math.max(1, Math.floor((base * (100 + pct)) / 100 + 1e-9));
  return base;
}

/**
 * Every modifier of one blow, without rolling anything.
 * @param {Object} opts
 * @param {boolean} [opts.ranged]
 * @param {boolean} [opts.retaliation]
 * @param {number} [opts.hexesTravelled] for jousting (0 on retaliations / second blows)
 * @param {number} [opts.luck] +1 lucky strike, -1 unlucky, 0 none
 * @param {boolean} [opts.deathBlow] Dread Knight `double_damage_chance` hit: +100% to the bonus sum
 * @param {boolean} [opts.doubleDamage] Artillery double damage: +100% to the bonus sum
 * @param {number} [opts.retalPercent] 100 unless the retaliator is blinded / paralyzed
 * @param {boolean} [opts.noRangePenalty] @param {boolean} [opts.noMeleePenalty]
 * @returns {{attack, defense, bonusPct, reductions: number[], factor: number, parts: Object}}
 */
export function damageModifiers(cs, attacker, defender, opts = {}) {
  const ranged = !!opts.ranged;
  const parts = {};
  let attack = attackOf(cs, attacker, { ranged, target: defender });
  const nix = abilityOf(defender, 'reduce_enemy_attack');
  if (nix) attack = Math.floor((attack * (100 - nix.percent)) / 100);
  let defense = defenseOf(cs, defender);
  const ignore = abilityOf(attacker, 'reduce_enemy_defense');
  if (ignore && !ranged) defense = Math.floor((defense * (100 - ignore.percent)) / 100);

  let bonusPct = 0;
  const reductions = [];
  if (attack > defense) {
    parts.attackBonus = Math.min(300, 5 * (attack - defense));
    bonusPct += parts.attackBonus;
  } else if (defense > attack) {
    parts.defenseReduction = Math.min(70, 2.5 * (defense - attack));
    reductions.push(parts.defenseReduction);
  }
  // Offense / Archery (and items that add to them)
  parts.skill = sumBonus(cs, attacker.side, 'damage_percent', (b) => b.mode === (ranged ? 'ranged' : 'melee'), 'percent');
  bonusPct += parts.skill;
  if (opts.luck > 0) { parts.luck = 100; bonusPct += 100; }
  // Death blow and Artillery's double damage are additive bonuses like luck (original formula:
  // a lucky death blow deals x3, not x4).
  if (opts.deathBlow) { parts.deathBlow = 100; bonusPct += 100; }
  if (opts.doubleDamage) { parts.doubleDamage = 100; bonusPct += 100; }
  const hates = creatureOf(attacker).abilities.find((a) => a.id === 'hates' && a.targets.includes(defender.creatureId));
  if (hates) { parts.hates = hates.percent; bonusPct += hates.percent; }
  const joust = abilityOf(attacker, 'jousting');
  if (joust && !ranged && !opts.retaliation && opts.hexesTravelled > 0 && !hasAb(defender, 'charge_immunity')) {
    parts.jousting = joust.percentPerHex * opts.hexesTravelled;
    bonusPct += parts.jousting;
  }

  // Armorer
  const armorer = sumBonus(cs, defender.side, 'damage_reduction_percent', null, 'percent');
  if (armorer > 0) { parts.armorer = Math.min(100, armorer); reductions.push(parts.armorer); }
  // Shield / Air Shield
  for (const p of partsOfType(defender, 'damage_reduction')) {
    if (p.against === (ranged ? 'ranged' : 'melee')) reductions.push(p.value);
  }
  if (ranged) {
    const noRange = opts.noRangePenalty || attacker.warMachine || hasAb(attacker, 'no_range_penalty') || hasBonus(cs, attacker.side, 'no_range_penalty');
    if (!noRange && stackDistance(attacker, defender) > 10) { parts.rangePenalty = 50; reductions.push(50); }
    const noWall = hasAb(attacker, 'no_obstacle_penalty') || hasBonus(cs, attacker.side, 'no_obstacle_penalty');
    if (!noWall && cs.siege && siegeShotPenalty(cs, attacker, defender)) { parts.obstaclePenalty = 50; reductions.push(50); }
  } else if (creatureOf(attacker).shots > 0 && !attacker.warMachine && !opts.noMeleePenalty && !hasAb(attacker, 'no_melee_penalty')) {
    parts.meleePenalty = 50;
    reductions.push(50);
  }
  if (opts.retalPercent !== undefined && opts.retalPercent < 100) reductions.push(100 - opts.retalPercent);
  const stone = controlOf(defender, 'stone');
  if (stone) { parts.petrified = 100 - (stone.damageTakenPercent ?? 50); reductions.push(parts.petrified); }
  if (opts.luck < 0) { parts.badLuck = 50; reductions.push(50); }

  let factor = (100 + bonusPct) / 100;
  for (const r of reductions) factor *= (100 - r) / 100;
  // Haspid: damage grows with its own losses.
  if (hasAb(attacker, 'revenge') && attacker.startCount > 0) {
    parts.revenge = 1 + Math.max(0, attacker.startCount - attacker.count) / attacker.startCount;
    factor *= parts.revenge;
  }
  return { attack, defense, bonusPct, reductions, factor, parts };
}

export const finalDamage = (base, factor) => Math.max(1, Math.floor(base * factor + 1e-9));

/**
 * Roll and compute the damage of one blow of `attacker` against `defender`.
 * @returns {{damage: number, base: number, mods: Object}}
 */
export function computeAttackDamage(cs, attacker, defender, opts = {}) {
  const base = opts.base ?? rollBaseDamage(cs, attacker, !!opts.ranged);
  const mods = damageModifiers(cs, attacker, defender, opts);
  return { damage: finalDamage(base, mods.factor), base, mods };
}

/** Creatures that `damage` would kill in the stack. */
export function killsFor(stack, damage) {
  const total = totalHp(stack);
  if (damage >= total) return stack.count;
  return stack.count - Math.ceil((total - damage) / stack.maxHp);
}

/**
 * Damage range for tooltips (no luck, no chance abilities).
 * @returns {{minDamage, maxDamage, minKills, maxKills}}
 */
export function previewDamage(cs, attacker, defender, opts = {}) {
  const mods = damageModifiers(cs, attacker, defender, { ...opts, luck: 0 });
  const lo = finalDamage(rollBaseDamage(cs, attacker, !!opts.ranged, 'min'), mods.factor);
  const hi = finalDamage(rollBaseDamage(cs, attacker, !!opts.ranged, 'max'), mods.factor);
  return { minDamage: lo, maxDamage: hi, minKills: killsFor(defender, lo), maxKills: killsFor(defender, hi) };
}

export { bonusesOf };
