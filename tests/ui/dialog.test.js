import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fire, tick } from './fakeDom.js';

installFakeDom();
const ui = await import('../../src/ui/kit/index.js');

afterEach(() => ui.closeAllDialogs());

const key = (k, extra = {}) => { const e = { key: k, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, target: null, ...extra }; return [ui.handleDialogKey(e), e]; };
const buttons = () => document.body.querySelectorAll('.k-dlg-buttons .k-btn');

test('message resolves when OK is pressed', async () => {
  const p = ui.message('The town is yours.', { title: 'Victory' });
  assert.equal(ui.dialogCount(), 1);
  assert.equal(document.body.querySelector('.k-dlg-title').textContent, 'Victory');
  assert.match(document.body.querySelector('.k-dlg-body').textContent, /The town is yours/);
  buttons()[0].click();
  assert.equal(await p, true);
  assert.equal(ui.dialogCount(), 0);
  assert.equal(document.body.querySelector('.k-dlg'), null);
});

test('confirm resolves true / false, Esc means no, Enter means yes', async () => {
  let p = ui.confirm('Dismiss this hero?');
  buttons()[0].click();
  assert.equal(await p, true);
  p = ui.confirm('Dismiss this hero?');
  buttons()[1].click();
  assert.equal(await p, false);
  p = ui.confirm('Again?');
  const [consumed, e] = key('Escape');
  assert.ok(consumed && e.defaultPrevented);
  assert.equal(await p, false);
  p = ui.confirm('Again?');
  key('Enter');
  assert.equal(await p, true);
});

test('choose resolves the option value (or index), number keys work, not cancellable by default', async () => {
  let p = ui.choose({ title: 'Treasure', options: [{ label: '1500 gold', value: 'gold', icon: { kind: 'resource', id: 'gold' } }, { label: '1000 exp', value: 'exp' }] });
  assert.equal(document.body.querySelectorAll('.k-choice').length, 2);
  key('Escape');
  assert.equal(ui.dialogCount(), 1, 'Esc does not close a mandatory choice');
  document.body.querySelectorAll('.k-choice')[1].click();
  assert.equal(await p, 'exp');

  p = ui.choose({ options: [{ label: 'a' }, { label: 'b' }, { label: 'c', disabled: true }] });
  key('3');
  assert.equal(ui.dialogCount(), 1, 'disabled option ignored');
  key('2');
  assert.equal(await p, 1);

  p = ui.choose({ options: [{ label: 'a' }], cancellable: true });
  key('Escape');
  assert.equal(await p, null);
});

test('choose with confirm: select first, then OK', async () => {
  const p = ui.choose({ confirm: true, options: [{ label: 'a', value: 'A' }, { label: 'b', value: 'B' }] });
  const ok = buttons()[0];
  assert.equal(ok.disabled, true);
  key('Enter');
  assert.equal(ui.dialogCount(), 1, 'Enter does nothing until something is selected');
  p.handle.cards[1].click();
  assert.ok(p.handle.cards[1].classList.contains('is-selected'));
  assert.equal(ok.disabled, false);
  ok.click();
  assert.equal(await p, 'B');
});

test('prompt resolves the typed text or null', async () => {
  let p = ui.prompt({ title: 'Save', value: 'Day 1' });
  p.input.value = 'My save';
  buttons()[0].click();
  assert.equal(await p, 'My save');
  p = ui.prompt({ title: 'Save' });
  buttons()[1].click();
  assert.equal(await p, null);
});

test('dialogs stack: keys and Esc go to the top one only', async () => {
  const order = [];
  const a = ui.openDialog({ title: 'A', content: 'a', cancelValue: 'a-cancel' });
  const b = ui.openDialog({ title: 'B', content: 'b', cancelValue: 'b-cancel' });
  a.result.then((v) => order.push(v));
  b.result.then((v) => order.push(v));
  assert.equal(ui.dialogCount(), 2);
  assert.equal(ui.topDialog().handle, b);
  assert.ok(ui.closeTopDialog());
  await tick();
  assert.deepEqual(order, ['b-cancel']);
  assert.ok(a.isOpen());
  key('Escape');
  await tick();
  assert.deepEqual(order, ['b-cancel', 'a-cancel']);
  assert.equal(key('Escape')[0], false, 'no dialog: key is not consumed');
});

test('openDialog: custom buttons, keep, close(value), onClose, backdrop click, non-dismissable', async () => {
  let kept = 0;
  const closed = [];
  const d = ui.openDialog({
    title: 'Trade', content: ui.h('div.custom', null, 'x'), onClose: (v) => closed.push(v),
    buttons: [{ label: '+1', keep: true, onClick: () => kept++ }, { label: 'Done', value: () => `done:${kept}`, default: true }],
  });
  d.buttons[0].click();
  d.buttons[0].click();
  assert.ok(d.isOpen());
  d.buttons[1].click();
  assert.equal(await d.result, 'done:2');
  assert.deepEqual(closed, ['done:2']);
  d.close('again');
  assert.deepEqual(closed, ['done:2'], 'closing twice is a no-op');

  const e = ui.openDialog({ content: 'x', cancelValue: 'out' });
  fire(e.backdrop, 'mousedown');
  assert.equal(await e.result, 'out');
  const f = ui.openDialog({ content: 'x', dismissable: false });
  fire(f.backdrop, 'mousedown');
  key('Escape');
  assert.ok(f.isOpen());
  f.close(5);
  assert.equal(await f.result, 5);
});

test('stack listeners and closeAllDialogs', async () => {
  const sizes = [];
  const off = ui.onDialogStackChange((n) => sizes.push(n));
  const a = ui.openDialog({ content: 'a' });
  const b = ui.openDialog({ content: 'b' });
  ui.closeAllDialogs();
  off();
  assert.deepEqual(sizes, [1, 2, 1, 0]);
  assert.equal(await a.result, undefined);
  assert.equal(await b.result, undefined);
});

test('Enter presses the default button even when a clicked button has the focus; typing keys are swallowed while modal', async () => {
  // a screen button that opened the dialog keeps the focus in the browser: Enter must not re-press it
  let screenClicks = 0;
  const opener = ui.Button('Save', { onClick: () => { screenClicks++; } });
  document.body.appendChild(opener);
  opener.focus();
  const p = ui.confirm('x');
  assert.notEqual(document.activeElement, opener, 'the opener lost the focus');
  assert.equal(document.activeElement, buttons()[0], 'the default button has the focus');
  const [consumed, e] = key('e');
  assert.equal(consumed, true, 'screen shortcuts are blocked while a dialog is open');
  assert.equal(e.defaultPrevented, false);
  // Enter with a (previously clicked) non-default button as the event target -> the default action
  const [c2, e2] = key('Enter', { target: buttons()[1] });
  assert.ok(c2 && e2.defaultPrevented);
  assert.equal(await p, true);
  assert.equal(screenClicks, 0);
  // a textarea keeps its Enter
  const d = ui.openDialog({ title: 't', content: ui.h('textarea') });
  const [c3, e3] = key('Enter', { target: { tagName: 'TEXTAREA' } });
  assert.ok(c3);
  assert.equal(e3.defaultPrevented, false);
  assert.ok(d.isOpen());
  opener.remove();
});
