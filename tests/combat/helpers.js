// Shared helpers for combat tests (not a test file).
import assert from 'node:assert/strict';
import { createCombat, performAction, getStack } from '../../src/engine/combat/index.js';

const army = (list) => list.map((s) => (s ? { creatureId: s[0], count: s[1] } : null));

/** Roll tags that are switched off by default so tests are deterministic. */
export const QUIET = {
  morale: false, bad_morale: false, luck: false, bad_luck: false, fear: false, resist: false, magic_mirror: false,
};

/**
 * Small battle on an empty field. `att` / `def`: arrays of [creatureId, count].
 * opts: { seed, heroA, heroD, machinesA, machinesD, terrain, obstacles, siege, bank, chance, damage,
 *         sideA, sideD (extra CombatSide fields) }
 */
export function battle(att, def, opts = {}) {
  const cs = createCombat({
    seed: opts.seed ?? 1,
    terrain: opts.terrain ?? 'water', // no faction is native to it: no terrain bonuses
    attacker: { playerId: 0, isHuman: true, hero: opts.heroA ?? null, army: army(att), warMachines: opts.machinesA ?? [], ...(opts.sideA ?? {}) },
    defender: { playerId: 1, isHuman: false, hero: opts.heroD ?? null, army: army(def), warMachines: opts.machinesD ?? [], ...(opts.sideD ?? {}) },
    siege: opts.siege ?? null,
    bank: opts.bank ?? false,
    obstacles: opts.obstacles ?? [],
    tactics: opts.tactics,
    overlayEffects: opts.overlayEffects,
    // test hooks: forced chance rolls and damage rolls from the very first turn
    force: { chance: { ...QUIET, ...(opts.chance ?? {}) }, damage: opts.damage === undefined ? 'max' : opts.damage },
    forceRolls: opts.forceRolls ?? [],
  });
  return cs;
}

export const hero = (extra = {}) => ({ id: 'h', name: 'Hero', attack: 0, defense: 0, power: 1, knowledge: 1, mana: 0, spells: [], skills: {}, bonuses: [], ...extra });

/** n-th stack (by army order) of a side, machines excluded. */
export const stackOf = (cs, side, n = 0) => cs.stacks.filter((s) => s.side === side && !s.warMachine && s.slot !== null)[n];
export const A = (cs, n = 0) => stackOf(cs, 'attacker', n);
export const D = (cs, n = 0) => stackOf(cs, 'defender', n);
export const machine = (cs, side, id) => cs.stacks.find((s) => s.side === side && s.creatureId === id);

export function place(stack, x, y) {
  stack.pos = { x, y };
  return stack;
}

/** Make `stack` the one that acts now. */
export function activate(cs, stack) {
  stack.acted = false;
  stack.waited = false;
  cs.active = stack.id;
  return stack;
}

/** performAction that must succeed; returns the events. */
export function act(cs, action) {
  const res = performAction(cs, action);
  assert.equal(res.ok, true, `action ${JSON.stringify(action)} failed: ${res.error}`);
  return res.events;
}

/** Attacker's stack `a` attacks `d` (placed adjacent first unless `keep`). Returns events. */
export function melee(cs, a, d, opts = {}) {
  if (!opts.keep) {
    place(a, 5, 5);
    place(d, a.size > 1 ? 6 : 6, 5);
  }
  activate(cs, a);
  return act(cs, { type: 'attack', targetId: d.id, from: opts.from });
}

export function shoot(cs, a, d) {
  activate(cs, a);
  return act(cs, { type: 'shoot', targetId: d.id });
}

export const damageTo = (events, stack, kind) => events.filter((e) => e.type === 'damage' && e.stackId === stack.id && (!kind || e.kind === kind));
export const firstDamage = (events, stack, kind) => damageTo(events, stack, kind)[0]?.amount;
export const has = (events, type, pred = () => true) => events.some((e) => e.type === type && pred(e));
export const effectIds = (stack) => stack.effects.map((e) => e.spellId);
export { getStack };
