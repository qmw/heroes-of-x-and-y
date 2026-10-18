import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, tick } from './fakeDom.js';

installFakeDom();
const ui = await import('../../src/ui/kit/index.js');
afterEach(() => ui.closeAllDialogs());

test('describeOption infers label and icon from common option fields', () => {
  assert.deepEqual(ui.describeOption({ skillId: 'wisdom', level: 2 }), { label: 'Advanced Wisdom', description: ui.describeOption({ skillId: 'wisdom', level: 2 }).description, icon: { kind: 'skill', id: 'wisdom' }, disabled: false });
  assert.match(ui.describeOption({ skillId: 'wisdom', level: 2 }).description, /Wisdom/);
  assert.equal(ui.describeOption({ creatureId: 'pikeman', count: 1200 }).label, '1,200 Pikeman');
  assert.deepEqual(ui.describeOption({ artifactId: 'centaurs_axe' }).icon, { kind: 'artifact', id: 'centaurs_axe' });
  assert.equal(ui.describeOption({ spellId: 'haste' }).label, 'Haste');
  assert.equal(ui.describeOption({ resource: 'gems', amount: 5 }).label, '5 Gems');
  assert.equal(ui.describeOption({ stat: 'attack', value: 2 }).label, '+2 Attack');
  assert.equal(ui.describeOption({ exp: 1500 }).label, '1,500 experience');
  assert.equal(ui.describeOption({ gold: 2000 }).label, '2,000 gold');
  assert.equal(ui.describeOption({ id: 'fight_them' }).label, 'Fight Them');
  assert.equal(ui.describeOption({ label: 'Custom', icon: { kind: 'ui', id: 'x' }, creatureId: 'pikeman' }).label, 'Custom');
  assert.deepEqual(ui.describeOption({ label: 'Custom', icon: { kind: 'ui', id: 'x' }, creatureId: 'pikeman' }).icon, { kind: 'ui', id: 'x' });
  assert.equal(ui.describeOption('accept').label, 'Accept');
  assert.equal(ui.describeOption(null, 2).label, 'Option 3');
  assert.equal(ui.describeOption({}, 0).label, 'Option 1');
  assert.equal(ui.describeOption({ id: 'x', disabled: true }).disabled, true);
});

test('describePending builds a title / text / options model', () => {
  const m = ui.describePending({ id: 3, kind: 'level_up', playerId: 0, data: { description: 'Christian reached level 2.' }, options: [{ skillId: 'archery', level: 1 }, { skillId: 'luck', level: 2 }] });
  assert.equal(m.title, 'Level Up');
  assert.equal(m.text, 'Christian reached level 2.');
  assert.deepEqual(m.options.map((o) => o.label), ['Basic Archery', 'Advanced Luck']);
  assert.equal(ui.describePending({ kind: 'x', title: 'Explicit', options: [] }).title, 'Explicit');
});

test('default dialog: shows options with icons and resolves with the chosen index', async () => {
  const p = ui.showPending({ id: 1, kind: 'chest', data: { title: 'Chest', text: 'Choose' }, options: [{ gold: 1000 }, { exp: 500 }] });
  await tick(1);
  const cards = document.body.querySelectorAll('.k-choice');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].querySelector('canvas').dataset.id, 'gold');
  ui.handleDialogKey({ key: 'Escape' });
  assert.equal(ui.dialogCount(), 1, 'a pending choice cannot be dismissed');
  cards[1].click();
  assert.deepEqual(await p, { optionIndex: 1 });
  assert.equal(ui.PendingChoiceDialog, ui.showPending);
});

test('a pending entry without options is an acknowledgement', async () => {
  const p = ui.showPending({ id: 2, kind: 'week_event', data: { title: 'Week of the Imp', message: 'Imp growth doubles.' }, options: [] });
  await tick(1);
  assert.match(document.body.querySelector('.k-dlg').textContent, /Week of the Imp.*Imp growth doubles/);
  document.body.querySelectorAll('.k-dlg-buttons .k-btn')[0].click();
  assert.deepEqual(await p, { optionIndex: 0 });
});

test('registerPendingRenderer overrides the dialog for a kind', async () => {
  const seen = [];
  ui.registerPendingRenderer('recruit_amount', async (pending, ctx) => { seen.push([pending.id, ctx.tag]); return { optionIndex: 0, extra: { count: 12 } }; });
  ui.registerPendingRenderer('simple_number', () => 2);
  ui.registerPendingRenderer('returns_nothing', () => undefined);
  assert.ok(ui.hasPendingRenderer('recruit_amount'));
  assert.deepEqual(await ui.showPending({ id: 9, kind: 'recruit_amount', options: [{ id: 'buy' }] }, { tag: 'ctx' }), { optionIndex: 0, extra: { count: 12 } });
  assert.deepEqual(seen, [[9, 'ctx']]);
  assert.deepEqual(await ui.showPending({ id: 10, kind: 'simple_number', options: [] }), { optionIndex: 2 });
  assert.deepEqual(await ui.showPending({ id: 11, kind: 'returns_nothing', options: [] }), { optionIndex: 0 });
  assert.equal(ui.dialogCount(), 0, 'custom renderers own their UI');
});
