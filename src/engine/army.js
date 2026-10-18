// Army helpers. An Army is a plain array of ARMY_SLOTS (7) entries: {creatureId, count} | null.
// Everything here is pure with respect to GameState (it only mutates the armies passed in).
// Spec: docs/mechanics/hero-engine.md §2.

import { ARMY_SLOTS } from '../core/constants.js';
import { getCreature } from '../data/creatures.js';

/**
 * @typedef {{creatureId: string, count: number}} Stack
 * @typedef {(Stack|null)[]} Army
 */

/** @returns {Army} seven empty slots */
export function createArmy() {
  return new Array(ARMY_SLOTS).fill(null);
}

/** Deep copy, padded/truncated to 7 slots; stacks with count <= 0 become null. */
export function armyClone(army) {
  const out = createArmy();
  for (let i = 0; i < ARMY_SLOTS; i++) {
    const s = army?.[i];
    if (s && s.count > 0) out[i] = { creatureId: s.creatureId, count: s.count };
  }
  return out;
}

export function armyIsEmpty(army) {
  return !army || army.every((s) => !s || s.count <= 0);
}

/** Number of occupied slots. */
export function armyStackCount(army) {
  return (army || []).filter((s) => s && s.count > 0).length;
}

/** Total number of creatures. */
export function armyTotalCount(army) {
  return (army || []).reduce((n, s) => n + (s && s.count > 0 ? s.count : 0), 0);
}

/** Distinct creature ids, in slot order. */
export function armyCreatureIds(army) {
  const out = [];
  for (const s of army || []) if (s && s.count > 0 && !out.includes(s.creatureId)) out.push(s.creatureId);
  return out;
}

/** Number of creatures of one kind across all slots. */
export function armyCount(army, creatureId) {
  return (army || []).reduce((n, s) => n + (s && s.creatureId === creatureId ? s.count : 0), 0);
}

/** Index of the first slot holding `creatureId`, or -1. */
export function armyFindSlot(army, creatureId) {
  return army.findIndex((s) => s && s.count > 0 && s.creatureId === creatureId);
}

/** Index of the first empty slot, or -1. */
export function armyFreeSlot(army) {
  for (let i = 0; i < ARMY_SLOTS; i++) if (!army[i] || army[i].count <= 0) return i;
  return -1;
}

/** Can `creatureId` be added (an existing stack of it, or a free slot)? */
export function armyCanAdd(army, creatureId) {
  getCreature(creatureId);
  return armyFindSlot(army, creatureId) >= 0 || armyFreeSlot(army) >= 0;
}

/**
 * Add creatures: merged into the first stack of the same creature, else put in the first free slot.
 * @returns {boolean} false (nothing changed) when there is no room or count <= 0
 */
export function armyAdd(army, creatureId, count) {
  getCreature(creatureId);
  if (!(count > 0)) return false;
  const n = Math.floor(count);
  const same = armyFindSlot(army, creatureId);
  if (same >= 0) {
    army[same].count += n;
    return true;
  }
  const free = armyFreeSlot(army);
  if (free < 0) return false;
  army[free] = { creatureId, count: n };
  return true;
}

/**
 * Remove `count` creatures (default: the whole stack) from a slot.
 * @returns {number} how many were actually removed
 */
export function armyRemove(army, slotIdx, count) {
  const s = army[slotIdx];
  if (!s || s.count <= 0) return 0;
  const n = count === undefined ? s.count : Math.max(0, Math.min(s.count, Math.floor(count)));
  s.count -= n;
  if (s.count <= 0) army[slotIdx] = null;
  return n;
}

/**
 * Dismiss (destroy) the whole stack in `slot`. `opts.keepOne` (hero armies) refuses to remove the
 * last stack (`last_stack`, original rule). @returns {{ok:true, stack} | {ok:false, error}}
 */
export function armyDismiss(army, slot, opts = {}) {
  const s = army?.[slot];
  if (!s || s.count <= 0) return { ok: false, error: 'empty_slot' };
  if (opts.keepOne && armyStackCount(army) <= 1) return { ok: false, error: 'last_stack' };
  army[slot] = null;
  return { ok: true, stack: { creatureId: s.creatureId, count: s.count } };
}

/** Remove `count` creatures of one kind from wherever they are (first slots first). */
export function armyRemoveCreature(army, creatureId, count) {
  let left = count;
  for (let i = 0; i < ARMY_SLOTS && left > 0; i++) {
    if (army[i] && army[i].creatureId === creatureId) left -= armyRemove(army, i, left);
  }
  return count - left;
}

/**
 * Move a stack (or `count` creatures of it) from `armyA[i]` to `armyB[j]`:
 *  - empty destination: move / split;
 *  - same creature: merge (all or `count`);
 *  - different creature: swap the two whole stacks (`count` must be omitted or the full stack).
 * `armyA` and `armyB` may be the same array (rearranging one army).
 *
 * The original rule "a hero is never left without troops" is enforced through the flags:
 * `opts.keepA` / `opts.keepB` = that army must still hold at least one creature afterwards
 * (pass true for hero armies, false for town garrisons). The move is refused with
 * `error: 'last_stack'`; moving all but one creature (a split) is still allowed.
 *
 * @param {Army} armyA @param {number} i @param {Army} armyB @param {number} j
 * @param {number} [count]
 * @param {{keepA?: boolean, keepB?: boolean}} [opts]
 * @returns {{ok: true, action: 'none'|'move'|'split'|'merge'|'swap', moved: number} | {ok: false, error: string}}
 */
export function armyMove(armyA, i, armyB, j, count, opts = {}) {
  const valid = (k) => Number.isInteger(k) && k >= 0 && k < ARMY_SLOTS;
  if (!valid(i) || !valid(j)) return { ok: false, error: 'bad_slot' };
  const src = armyA[i];
  if (!src || src.count <= 0) return { ok: false, error: 'empty_slot' };
  const same = armyA === armyB;
  if (same && i === j) return { ok: true, action: 'none', moved: 0 };
  if (count !== undefined && !(Number.isInteger(count) && count >= 1 && count <= src.count)) {
    return { ok: false, error: 'bad_count' };
  }
  const n = count === undefined ? src.count : count;
  const whole = n === src.count;
  const dst = armyB[j] && armyB[j].count > 0 ? armyB[j] : null;

  if (dst && dst.creatureId !== src.creatureId) {
    if (!whole) return { ok: false, error: 'slot_occupied' };
    // A swap never empties either army.
    armyA[i] = dst;
    armyB[j] = src;
    return { ok: true, action: 'swap', moved: n };
  }
  if (!same && whole && opts.keepA && armyStackCount(armyA) === 1) return { ok: false, error: 'last_stack' };
  if (dst) dst.count += n;
  else armyB[j] = { creatureId: src.creatureId, count: n };
  if (whole) armyA[i] = null;
  else src.count -= n;
  return { ok: true, action: dst ? 'merge' : (whole ? 'move' : 'split'), moved: n };
}

/** Sum of aiValue x count. */
export function armyStrength(army) {
  return (army || []).reduce((sum, s) => sum + (s && s.count > 0 ? getCreature(s.creatureId).aiValue * s.count : 0), 0);
}

/** Total hit points of the army (base hp). */
export function armyTotalHp(army) {
  return (army || []).reduce((sum, s) => sum + (s && s.count > 0 ? getCreature(s.creatureId).hp * s.count : 0), 0);
}

/** Base speed of the slowest creature; null for an empty army. */
export function armySlowestSpeed(army) {
  let min = null;
  for (const s of army || []) {
    if (!s || s.count <= 0) continue;
    const sp = getCreature(s.creatureId).speed;
    if (min === null || sp < min) min = sp;
  }
  return min;
}

/**
 * Can every stack of `from` be merged into `into` (same creatures merge, others need free slots)?
 * Used for "creatures join" / garrison merges.
 */
export function armyCanMergeAll(into, from) {
  const probe = armyClone(into);
  for (const s of from || []) if (s && s.count > 0 && !armyAdd(probe, s.creatureId, s.count)) return false;
  return true;
}

/** Merge as many stacks of `from` into `into` as fit; merged stacks are removed from `from`. */
export function armyMergeAll(into, from) {
  let all = true;
  for (let i = 0; i < ARMY_SLOTS; i++) {
    const s = from[i];
    if (!s || s.count <= 0) continue;
    if (armyAdd(into, s.creatureId, s.count)) from[i] = null;
    else all = false;
  }
  return all;
}
