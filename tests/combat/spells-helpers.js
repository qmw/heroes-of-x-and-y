// Shared helpers for the spell tests (not a test file).
import assert from 'node:assert/strict';
import { battle, hero, A, D, activate, QUIET } from './helpers.js';
import { castHeroSpell, createCombat } from '../../src/engine/combat/index.js';

export const SCHOOL_SKILL = { air: 'air_magic', earth: 'earth_magic', fire: 'fire_magic', water: 'water_magic' };

/** Skills giving mastery `m` in every school. */
export const allSchools = (m) => ({ air_magic: m, earth_magic: m, fire_magic: m, water_magic: m });

/**
 * Battle whose attacker hero knows `spells` with mastery `m` in every school.
 * opts: { att, def, power, m, bonuses, level, heroD, mana, chance, ... battle() opts }
 */
export function arena(spells, opts = {}) {
  const h = hero({
    power: opts.power ?? 1, mana: opts.mana ?? 999, maxMana: 999, spells, level: opts.level ?? 1,
    skills: opts.skills ?? allSchools(opts.m ?? 0), bonuses: opts.bonuses ?? [],
  });
  const army = (list) => list.map((s) => (s ? { creatureId: s[0], count: s[1] } : null));
  const cs = createCombat({
    seed: opts.seed ?? 1,
    terrain: opts.terrain ?? 'water',
    attacker: { playerId: 0, isHuman: true, hero: h, army: army(opts.att ?? [['pikeman', 100]]), warMachines: opts.machinesA ?? [] },
    defender: { playerId: 1, isHuman: false, hero: opts.heroD ?? null, army: army(opts.def ?? [['pikeman', 1000]]), warMachines: opts.machinesD ?? [] },
    siege: opts.siege ?? null,
    obstacles: opts.obstacles ?? [],
    tactics: opts.tactics,
    spellLevelCap: opts.spellLevelCap,
    overlayEffects: opts.overlayEffects,
    force: { chance: { ...QUIET, ...(opts.chance ?? {}) }, damage: 'max' },
    forceRolls: opts.forceRolls ?? [],
  });
  if (cs.phase === 'battle') activate(cs, A(cs));
  return cs;
}

/** Cast for `side` (default attacker), ignoring the once-per-round rule; asserts success. */
export function cast(cs, spellId, target = null, side = 'attacker') {
  cs.sides[side].castThisRound = false;
  const active = cs.stacks.find((s) => s.id === cs.active);
  if (!active || active.side !== side) activate(cs, side === 'attacker' ? A(cs) : D(cs));
  const res = castHeroSpell(cs, side, spellId, target);
  assert.equal(res.ok, true, `cast ${spellId} failed: ${res.error}`);
  return res.events;
}

/** Cast that must fail; returns the error. */
export function castFail(cs, spellId, target = null, side = 'attacker') {
  cs.sides[side].castThisRound = false;
  const res = castHeroSpell(cs, side, spellId, target);
  assert.equal(res.ok, false, `cast ${spellId} should fail`);
  return res.error;
}

/** Sum of `damage.amount` events on a stack. */
export const dmgOn = (events, stack) => events.filter((e) => e.type === 'damage' && e.stackId === stack.id).reduce((a, e) => a + e.amount, 0);
export const effectOf = (stack, spellId) => stack.effects.find((e) => e.spellId === spellId) ?? null;
export { A, D, hero, battle, activate };
