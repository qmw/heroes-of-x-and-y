import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fire, tick } from './fakeDom.js';

installFakeDom();
const ui = await import('../../src/ui/kit/index.js');
afterEach(() => ui.closeAllDialogs());

const army = () => [{ creatureId: 'pikeman', count: 20 }, { creatureId: 'archer', count: 8 }, null, { creatureId: 'pikeman', count: 5 }, null, null, null];

test('armyClickStep: select, info, move, split rules (pure)', () => {
  const st = (slot, a = army(), row = 'r') => ({ row, slot, stack: a[slot] });
  let r = ui.armyClickStep(null, st(2));
  assert.deepEqual(r, { selection: null, action: null }, 'clicking an empty slot with nothing selected');
  r = ui.armyClickStep(null, st(0));
  assert.equal(r.action.type, 'select');
  const sel = r.selection;
  assert.equal(ui.armyClickStep(sel, st(0)).action.type, 'info');
  assert.deepEqual(ui.armyClickStep(sel, st(1)).action, { type: 'move', from: 0, to: 1, fromRow: 'r', toRow: 'r' });
  assert.deepEqual(ui.armyClickStep(sel, st(2)).action, { type: 'move', from: 0, to: 2, fromRow: 'r', toRow: 'r' });
  // shift: split into an empty slot keeps at least one behind
  assert.deepEqual(ui.armyClickStep(sel, st(2), { shift: true }).action, { type: 'split', from: 0, to: 2, fromRow: 'r', toRow: 'r', max: 19, creatureId: 'pikeman' });
  // shift onto the same creature: may move everything
  assert.equal(ui.armyClickStep(sel, st(3), { shift: true }).action.max, 20);
  // shift onto a different creature is a plain swap
  assert.equal(ui.armyClickStep(sel, st(1), { shift: true }).action.type, 'move');
  // a single creature cannot be split into an empty slot
  const one = { row: 'r', slot: 0, stack: { creatureId: 'pikeman', count: 1 } };
  assert.equal(ui.armyClickStep(one, st(2), { shift: true }).action, null);
  // cross-row
  assert.deepEqual(ui.armyClickStep(sel, st(4, army(), 'other')).action, { type: 'move', from: 0, to: 4, fromRow: 'r', toRow: 'other' });
});

test('ArmyRow renders 7 slots and emits onMove on click-click', () => {
  const moves = [];
  const selects = [];
  const row = ui.ArmyRow({ army: army(), onMove: (...a) => moves.push(a), onSelect: (slot) => selects.push(slot) });
  assert.equal(row.slotEls.length, 7);
  assert.equal(row.slotEls[0].querySelector('.k-army-count').textContent, '20');
  assert.ok(row.slotEls[2].classList.contains('is-empty'));
  row.slotEls[2].click();
  assert.equal(row.selected, null);
  row.slotEls[0].click();
  assert.equal(row.selected, 0);
  assert.ok(row.slotEls[0].classList.contains('is-selected'));
  row.slotEls[1].click();
  assert.deepEqual(moves, [[0, 1, undefined, 'army', 'army']]);
  assert.equal(row.selected, null);
  assert.ok(!row.slotEls[0].classList.contains('is-selected'));
  assert.deepEqual(selects, [0]);
});

test('clicking the selected stack again asks for info and deselects', () => {
  const infos = [];
  const row = ui.ArmyRow({ army: army(), onInfo: (slot, stack) => infos.push([slot, stack.creatureId]) });
  row.slotEls[1].click();
  row.slotEls[1].click();
  assert.deepEqual(infos, [[1, 'archer']]);
  assert.equal(row.selected, null);
  fire(row.slotEls[0], 'dblclick');
  assert.deepEqual(infos[1], [0, 'pikeman']);
});

test('shift-click opens the split dialog and emits the chosen count', async () => {
  const moves = [];
  const row = ui.ArmyRow({ army: army(), onMove: (...a) => moves.push(a) });
  row.slotEls[0].click();
  fire(row.slotEls[2], 'click', { shiftKey: true });
  await tick(1);
  assert.equal(ui.dialogCount(), 1);
  const dlg = document.body.querySelector('.k-dlg-split');
  assert.ok(dlg);
  const stepper = dlg.querySelector('.k-stepper');
  const slider = dlg.querySelector('.k-slider');
  assert.equal(stepper.value, 10, 'starts at half');
  slider.input.value = '7';
  fire(slider.input, 'input');
  assert.equal(stepper.value, 7, 'slider and stepper stay in sync');
  assert.match(dlg.textContent, /Move 7 of 19/);
  document.body.querySelectorAll('.k-dlg-buttons .k-btn')[0].click();
  await tick();
  assert.deepEqual(moves, [[0, 2, 7, 'army', 'army']]);
});

test('cancelling the split emits nothing; askSplit can be overridden', async () => {
  const moves = [];
  const row = ui.ArmyRow({ army: army(), onMove: (...a) => moves.push(a) });
  row.slotEls[0].click();
  fire(row.slotEls[2], 'click', { shiftKey: true });
  await tick(1);
  ui.closeTopDialog();
  await tick();
  assert.equal(moves.length, 0);

  const asked = [];
  const row2 = ui.ArmyRow({ army: army(), onMove: (...a) => moves.push(a), askSplit: async (a) => { asked.push(a.max); return 3; } });
  row2.slotEls[0].click();
  fire(row2.slotEls[3], 'click', { shiftKey: true });
  await tick();
  assert.deepEqual(asked, [20]);
  assert.deepEqual(moves, [[0, 3, 3, 'army', 'army']]);
});

test('rows sharing a selection move stacks between armies', () => {
  const moves = [];
  const selection = ui.createArmySelection();
  const onMove = (...a) => moves.push(a);
  const top = ui.ArmyRow({ id: 'garrison', army: army(), selection, onMove });
  const bottom = ui.ArmyRow({ id: 'visiting', army: [null, null, null, null, null, null, null], selection, onMove });
  top.slotEls[1].click();
  assert.equal(top.selected, 1);
  assert.equal(bottom.selected, null);
  bottom.slotEls[4].click();
  assert.deepEqual(moves, [[1, 4, undefined, 'garrison', 'visiting']]);
  assert.equal(top.selected, null);
  assert.ok(!top.slotEls[1].classList.contains('is-selected'));
});

test('drag and drop emits the same move', () => {
  const moves = [];
  const selection = ui.createArmySelection();
  const a = ui.ArmyRow({ id: 'a', army: army(), selection, onMove: (...x) => moves.push(x) });
  const b = ui.ArmyRow({ id: 'b', army: army(), selection, onMove: (...x) => moves.push(x) });
  assert.equal(a.slotEls[0].draggable, true);
  assert.notEqual(a.slotEls[2].draggable, true);
  fire(a.slotEls[0], 'dragstart');
  assert.ok(fire(b.slotEls[2], 'dragover').defaultPrevented);
  fire(b.slotEls[2], 'drop');
  assert.deepEqual(moves, [[0, 2, undefined, 'a', 'b']]);
  fire(a.slotEls[0], 'dragstart');
  fire(a.slotEls[0], 'drop');
  assert.equal(moves.length, 1, 'dropping on itself does nothing');
});

test('update() re-renders and drops a selection whose stack vanished; readonly rows do not select', () => {
  const row = ui.ArmyRow({ army: army() });
  row.select(1);
  assert.equal(row.selected, 1);
  row.update([{ creatureId: 'pikeman', count: 28 }, null, null, null, null, null, null]);
  assert.equal(row.selected, null);
  assert.equal(row.slotEls[0].querySelector('.k-army-count').textContent, '28');
  assert.ok(row.slotEls[1].classList.contains('is-empty'));

  const infos = [];
  const ro = ui.ArmyRow({ army: army(), readonly: true, onInfo: (s) => infos.push(s) });
  ro.slotEls[0].click();
  assert.equal(ro.selected, null);
  assert.deepEqual(infos, [0]);
});

test('right-click-hold on a stack shows its creature card', () => {
  const row = ui.ArmyRow({ army: army() });
  fire(row.slotEls[1], 'mousedown', { button: 2 });
  const pop = document.body.querySelector('.k-infopopup');
  assert.ok(pop);
  assert.match(pop.textContent, /8 Archer/);
  ui.hideInfoPopup();
});
