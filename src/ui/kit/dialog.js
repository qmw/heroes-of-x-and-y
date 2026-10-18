// Modal dialog stack with a promise API.
//   await ui.message('The town is yours.');
//   if (await ui.confirm('Dismiss this hero?')) ...
//   const v = await ui.choose({ title: 'Treasure', options: [{ label: '1500 gold', icon: {kind:'resource', id:'gold'}, value: 'gold' }, ...] });
//   const d = ui.openDialog({ title, content: node, buttons: [...] });  d.close(value);  await d.result;
import { h, toNode } from './dom.js';
import { getLayer } from './stage.js';
import { sprite } from '../sprites.js';
import { Button, playClick } from './button.js';

/** @type {Array<object>} open dialogs, bottom -> top */
const stack = [];
const listeners = new Set();

function changed() { for (const fn of listeners) fn(stack.length); }

/** Subscribe to stack size changes (app.js pauses screen shortcuts while a dialog is open). */
export function onDialogStackChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function dialogCount() { return stack.length; }
export function topDialog() { return stack[stack.length - 1] || null; }

/**
 * Open a modal dialog.
 * @param {object} opts
 *   title?: string, content?: string | Node | () => Node, icon?: {kind, id},
 *   buttons?: [{ label, value, kind?: 'primary'|'default'|'danger', default?: bool, cancel?: bool,
 *               disabled?: bool, keep?: bool, onClick?: (handle) => void }]   (default: one OK button)
 *   dismissable?: bool (Esc / backdrop click closes with `cancelValue`; default true),
 *   cancelValue?: any (default null), width?: number, class?: string, onClose?: (value) => void
 * @returns {{ el, body, result: Promise<any>, close: (value?) => void, isOpen: () => boolean,
 *             setButtonDisabled: (index, bool) => void }}
 */
export function openDialog(opts = {}) {
  const dismissable = opts.dismissable !== false;
  const cancelValue = 'cancelValue' in opts ? opts.cancelValue : null;
  let resolve;
  let open = true;
  const result = new Promise((r) => { resolve = r; });

  const body = h('div.k-dlg-body', null, opts.content != null ? toNode(opts.content) : null);
  const buttonDefs = opts.buttons || [{ label: 'OK', value: true, kind: 'primary', default: true }];
  const handle = { el: null, body, result, close, isOpen: () => open, buttons: [], setButtonDisabled };

  const buttonEls = buttonDefs.map((b) => Button(b.label, {
    kind: b.kind || (b.default ? 'primary' : 'default'),
    disabled: b.disabled,
    sound: b.sound,
    onClick: () => {
      if (b.onClick) b.onClick(handle);
      if (!b.keep) close(typeof b.value === 'function' ? b.value() : b.value);
    },
  }));
  handle.buttons = buttonEls;

  const panel = h('div.k-dlg', { class: opts.class, style: opts.width ? { width: opts.width } : undefined },
    opts.title != null ? h('div.k-dlg-title', null, opts.title) : null,
    h('div.k-dlg-main', null,
      opts.icon ? h('div.k-dlg-icon', null, sprite(opts.icon.kind, opts.icon.id, { size: opts.icon.size || 72 })) : null,
      body),
    buttonEls.length ? h('div.k-dlg-buttons', null, buttonEls) : null);
  const backdrop = h('div.k-dlg-backdrop', { class: opts.backdropClass }, panel);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop && dismissable) close(cancelValue);
  });
  handle.el = panel;
  handle.backdrop = backdrop;

  function setButtonDisabled(i, d) { if (buttonEls[i]) buttonEls[i].setDisabled(d); }

  function close(value) {
    if (!open) return;
    open = false;
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    backdrop.remove();
    changed();
    if (opts.onClose) { try { opts.onClose(value); } catch (e) { console.error(e); } }
    resolve(value);
  }

  const entry = {
    handle,
    dismissable,
    cancel: () => close(cancelValue),
    accept: () => {
      const i = buttonDefs.findIndex((b) => b.default && !buttonEls[buttonDefs.indexOf(b)].disabled);
      if (i >= 0) { buttonEls[i].click(); return true; }
      return false;
    },
    onKey: opts.onKey || null,
  };
  stack.push(entry);
  getLayer('dialogs').appendChild(backdrop);
  // the button that opened the dialog (or any other focused control) must not catch Enter: focus the default button
  try {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && active.blur && !(panel.contains && panel.contains(active))) active.blur();
    const di = buttonDefs.findIndex((b) => b.default);
    if (di >= 0 && buttonEls[di].focus) buttonEls[di].focus();
  } catch { /* no focus support */ }
  changed();
  return handle;
}

/** Close the top dialog as if Esc was pressed. Returns true if a dialog was closed. */
export function closeTopDialog() {
  const top = topDialog();
  if (!top || !top.dismissable) return false;
  top.cancel();
  return true;
}

/** Close every open dialog (screen change, error overlay). */
export function closeAllDialogs() {
  while (stack.length) stack[stack.length - 1].handle.close(undefined);
}

/**
 * Keyboard routing for the dialog stack. Returns true when a dialog is open (the key is then
 * consumed and must not reach screen shortcuts). Esc cancels, Enter presses the default button (also when a button
 * has the focus; not in a textarea),
 * anything else is offered to the dialog's `onKey(key, event)`.
 */
export function handleDialogKey(e) {
  const top = topDialog();
  if (!top) return false;
  const key = String(e.key || '').toLowerCase();
  if (key === 'escape') {
    if (top.dismissable) { playClick('click'); top.cancel(); }
  } else if (key === 'enter') {
    // Enter always means the dialog's default action - even when a (mouse-clicked) button still has the
    // focus, which the browser would otherwise press again. Only multi-line text keeps its Enter.
    const tag = e.target && e.target.tagName;
    if (tag === 'TEXTAREA') return true;
    top.accept();
  } else if (top.onKey) {
    top.onKey(key, e);
  } else {
    return true;
  }
  if (e.preventDefault) e.preventDefault();
  return true;
}

/** Message box with one OK button. Resolves when closed. */
export function message(text, opts = {}) {
  return openDialog({ title: opts.title, icon: opts.icon, content: text, width: opts.width,
    buttons: [{ label: opts.ok || 'OK', value: true, default: true }], cancelValue: true, ...opts.dialog }).result;
}

/** Yes/No box. Resolves true / false (Esc => false). */
export function confirm(text, opts = {}) {
  return openDialog({ title: opts.title, icon: opts.icon, content: text, width: opts.width,
    buttons: [
      { label: opts.yes || 'Yes', value: true, default: true, kind: opts.danger ? 'danger' : 'primary' },
      { label: opts.no || 'No', value: false, cancel: true },
    ],
    cancelValue: false }).result;
}

/**
 * Choice dialog with big icon options (treasure chest, level-up, pick a faction ...).
 * @param {object} opts { title, text, options: [{ label, description?, icon?: {kind,id}, value?,
 *   disabled?, tooltip? }], cancellable?: bool (default false), cancelLabel?, columns?,
 *   confirm?: bool (select then press OK instead of click-to-pick) }
 * @returns {Promise<any>} the option's `value` (or its index when it has none); null if cancelled
 */
export function choose(opts = {}) {
  const options = opts.options || [];
  const valueOf = (i) => (options[i] && 'value' in options[i] ? options[i].value : i);
  let selected = -1;
  let handle = null;
  const cards = options.map((o, i) => {
    const card = h('button.k-choice', { type: 'button', class: o.disabled && 'is-disabled', disabled: !!o.disabled, dataset: { index: i } },
      o.icon ? h('div.k-choice-icon', null, sprite(o.icon.kind, o.icon.id, { size: o.icon.size || 64 })) : null,
      h('div.k-choice-label', null, o.label ?? String(valueOf(i))),
      o.description ? h('div.k-choice-desc', null, o.description) : null,
      options.length <= 9 ? h('span.k-choice-key', null, String(i + 1)) : null);
    card.addEventListener('click', () => pick(i));
    return card;
  });
  function pick(i) {
    if (!options[i] || options[i].disabled) return;
    playClick('click');
    if (opts.confirm) {
      selected = i;
      cards.forEach((c, j) => c.classList.toggle('is-selected', j === i));
      handle.setButtonDisabled(0, false);
    } else {
      handle.close(valueOf(i));
    }
  }
  const content = h('div.k-choose', null,
    opts.text ? h('div.k-choose-text', null, toNode(opts.text)) : null,
    h('div.k-choice-grid', { style: opts.columns ? { gridTemplateColumns: `repeat(${opts.columns}, 1fr)` } : undefined }, cards));
  const buttons = [];
  if (opts.confirm) buttons.push({ label: opts.okLabel || 'OK', default: true, disabled: true, value: () => valueOf(selected) });
  if (opts.cancellable) buttons.push({ label: opts.cancelLabel || 'Cancel', value: null, cancel: true });
  handle = openDialog({
    title: opts.title, icon: opts.icon, content, buttons, width: opts.width, class: 'k-dlg-choose',
    dismissable: !!opts.cancellable, cancelValue: null,
    onKey: (key) => {
      const n = Number(key);
      if (n >= 1 && n <= options.length && options.length <= 9) pick(n - 1);
    },
  });
  handle.cards = cards;
  handle.pick = pick;
  const p = handle.result;
  p.handle = handle;
  return p;
}

/** Single-line text prompt. Resolves the string, or null when cancelled. */
export function prompt(opts = {}) {
  const input = h('input.k-input', { type: 'text', value: opts.value ?? '', maxLength: opts.maxLength || 40, placeholder: opts.placeholder || '' });
  const handle = openDialog({
    title: opts.title, width: opts.width,
    content: h('div.k-prompt', null, opts.label ? h('label.k-label', null, opts.label) : null, input),
    buttons: [
      { label: opts.ok || 'OK', default: true, value: () => String(input.value) },
      { label: 'Cancel', value: null, cancel: true },
    ],
    cancelValue: null,
  });
  if (input.focus) input.focus();
  const p = handle.result;
  p.handle = handle;
  p.input = input;
  return p;
}
