import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArmy, armyAdd, armyCanAdd, armyRemove, armyMove, armyStrength, armyIsEmpty, armyTotalCount,
  armySlowestSpeed, armyCreatureIds, armyClone, armyStackCount, armyCount, armyRemoveCreature,
  armyCanMergeAll, armyMergeAll, armyTotalHp, armyFreeSlot, armyFindSlot, armyDismiss,
} from '../../src/engine/army.js';

const st = (creatureId, count) => ({ creatureId, count });

test('createArmy: seven empty slots', () => {
  const a = createArmy();
  assert.equal(a.length, 7);
  assert.ok(a.every((s) => s === null));
  assert.ok(armyIsEmpty(a));
  assert.equal(armyTotalCount(a), 0);
  assert.equal(armySlowestSpeed(a), null);
  assert.equal(armyFreeSlot(a), 0);
});

test('armyAdd merges the same creature and uses the first free slot otherwise', () => {
  const a = createArmy();
  assert.equal(armyAdd(a, 'pikeman', 10), true);
  assert.equal(armyAdd(a, 'archer', 5), true);
  assert.equal(armyAdd(a, 'pikeman', 7), true);
  assert.deepEqual(a.slice(0, 3), [st('pikeman', 17), st('archer', 5), null]);
  assert.equal(armyStackCount(a), 2);
  assert.equal(armyCount(a, 'pikeman'), 17);
  assert.equal(armyFindSlot(a, 'archer'), 1);
  assert.equal(armyAdd(a, 'pikeman', 0), false);
  assert.throws(() => armyAdd(a, 'no_such_creature', 1));
});

test('armyAdd / armyCanAdd fail on a full army unless the creature is already there', () => {
  const a = createArmy();
  const ids = ['pikeman', 'archer', 'griffin', 'swordsman', 'monk', 'cavalier', 'angel'];
  ids.forEach((id) => armyAdd(a, id, 1));
  assert.equal(armyFreeSlot(a), -1);
  assert.equal(armyCanAdd(a, 'imp'), false);
  assert.equal(armyAdd(a, 'imp', 3), false);
  assert.equal(armyCanAdd(a, 'angel'), true);
  assert.equal(armyAdd(a, 'angel', 2), true);
  assert.equal(a[6].count, 3);
  assert.deepEqual(armyCreatureIds(a), ids);
});

test('armyRemove: partial, whole, over-count', () => {
  const a = createArmy();
  armyAdd(a, 'pikeman', 10);
  assert.equal(armyRemove(a, 0, 4), 4);
  assert.equal(a[0].count, 6);
  assert.equal(armyRemove(a, 0, 100), 6);
  assert.equal(a[0], null);
  assert.equal(armyRemove(a, 0), 0);
  armyAdd(a, 'archer', 3);
  assert.equal(armyRemove(a, 0), 3);
  assert.ok(armyIsEmpty(a));
});

test('armyRemoveCreature spans several stacks', () => {
  const a = createArmy();
  a[0] = st('pikeman', 5);
  a[3] = st('pikeman', 5);
  assert.equal(armyRemoveCreature(a, 'pikeman', 7), 7);
  assert.equal(a[0], null);
  assert.equal(a[3].count, 3);
});

test('armyMove within one army: move, split, merge, swap', () => {
  const a = createArmy();
  a[0] = st('pikeman', 10);
  a[1] = st('archer', 4);
  assert.deepEqual(armyMove(a, 0, a, 3), { ok: true, action: 'move', moved: 10 });
  assert.equal(a[0], null);
  assert.deepEqual(a[3], st('pikeman', 10));
  assert.deepEqual(armyMove(a, 3, a, 0, 4), { ok: true, action: 'split', moved: 4 });
  assert.deepEqual([a[0], a[3]], [st('pikeman', 4), st('pikeman', 6)]);
  assert.deepEqual(armyMove(a, 0, a, 3), { ok: true, action: 'merge', moved: 4 });
  assert.deepEqual([a[0], a[3]], [null, st('pikeman', 10)]);
  assert.deepEqual(armyMove(a, 3, a, 1), { ok: true, action: 'swap', moved: 10 });
  assert.deepEqual([a[1], a[3]], [st('pikeman', 10), st('archer', 4)]);
  assert.deepEqual(armyMove(a, 1, a, 1), { ok: true, action: 'none', moved: 0 });
  assert.equal(armyTotalCount(a), 14);
});

test('armyMove errors: empty slot, bad slot, bad count, partial onto another creature', () => {
  const a = createArmy();
  a[0] = st('pikeman', 10);
  a[1] = st('archer', 4);
  assert.equal(armyMove(a, 2, a, 3).error, 'empty_slot');
  assert.equal(armyMove(a, 0, a, 7).error, 'bad_slot');
  assert.equal(armyMove(a, -1, a, 0).error, 'bad_slot');
  assert.equal(armyMove(a, 0, a, 2, 11).error, 'bad_count');
  assert.equal(armyMove(a, 0, a, 2, 0).error, 'bad_count');
  assert.equal(armyMove(a, 0, a, 1, 3).error, 'slot_occupied');
  assert.deepEqual(a.slice(0, 2), [st('pikeman', 10), st('archer', 4)]);
});

test('armyMove between armies and the last-stack rule', () => {
  const hero = createArmy();
  const town = createArmy();
  hero[0] = st('pikeman', 10);
  // the last stack cannot leave a hero ...
  assert.deepEqual(armyMove(hero, 0, town, 0, undefined, { keepA: true }), { ok: false, error: 'last_stack' });
  // ... but all except one creature can
  assert.deepEqual(armyMove(hero, 0, town, 0, 9, { keepA: true }), { ok: true, action: 'split', moved: 9 });
  assert.deepEqual([hero[0], town[0]], [st('pikeman', 1), st('pikeman', 9)]);
  assert.equal(armyMove(hero, 0, town, 0, 1, { keepA: true }).error, 'last_stack');
  // without the flag (a garrison) it may be emptied
  assert.equal(armyMove(town, 0, hero, 0).action, 'merge');
  assert.ok(armyIsEmpty(town));
  // a swap never empties anybody
  town[2] = st('archer', 3);
  assert.equal(armyMove(hero, 0, town, 2, undefined, { keepA: true }).action, 'swap');
  assert.deepEqual([hero[0], town[2]], [st('archer', 3), st('pikeman', 10)]);
  // with a second stack the first may go
  hero[1] = st('griffin', 2);
  assert.equal(armyMove(hero, 0, town, 5, undefined, { keepA: true }).action, 'move');
});

test('armyStrength, armyTotalHp, armySlowestSpeed use creature data', () => {
  const a = createArmy();
  armyAdd(a, 'pikeman', 10); // aiValue 80, hp 10, speed 4
  armyAdd(a, 'griffin', 2); // aiValue 351, hp 25, speed 6
  assert.equal(armyStrength(a), 10 * 80 + 2 * 351);
  assert.equal(armyTotalHp(a), 10 * 10 + 2 * 25);
  assert.equal(armySlowestSpeed(a), 4);
  armyAdd(a, 'dwarf', 1); // speed 3
  assert.equal(armySlowestSpeed(a), 3);
});

test('armyClone is deep, drops dead stacks, pads to 7', () => {
  const src = [st('pikeman', 3), { creatureId: 'archer', count: 0 }, null];
  const c = armyClone(src);
  assert.equal(c.length, 7);
  assert.deepEqual(c[0], st('pikeman', 3));
  assert.equal(c[1], null);
  c[0].count = 99;
  assert.equal(src[0].count, 3);
});

test('armyCanMergeAll / armyMergeAll', () => {
  const into = createArmy();
  ['pikeman', 'archer', 'griffin', 'swordsman', 'monk', 'cavalier'].forEach((id) => armyAdd(into, id, 1));
  const from = createArmy();
  from[0] = st('pikeman', 5);
  from[1] = st('angel', 1);
  assert.equal(armyCanMergeAll(into, from), true);
  from[2] = st('imp', 1);
  assert.equal(armyCanMergeAll(into, from), false);
  assert.equal(armyMergeAll(into, from), false);
  assert.equal(armyCount(into, 'pikeman'), 6);
  assert.equal(armyCount(into, 'angel'), 1);
  assert.deepEqual(from.slice(0, 3), [null, null, st('imp', 1)]);
});

test('armyDismiss removes a whole stack; keepOne protects the last stack of a hero', () => {
  const a = createArmy();
  a[0] = st('pikeman', 5);
  a[3] = st('archer', 2);
  assert.deepEqual(armyDismiss(a, 3, { keepOne: true }), { ok: true, stack: st('archer', 2) });
  assert.equal(a[3], null);
  assert.deepEqual(armyDismiss(a, 0, { keepOne: true }), { ok: false, error: 'last_stack' });
  assert.deepEqual(armyDismiss(a, 1), { ok: false, error: 'empty_slot' });
  assert.equal(armyDismiss(a, 0).ok, true);
  assert.ok(armyIsEmpty(a));
});
