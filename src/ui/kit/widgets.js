// Small general-purpose widgets: Tabs, ScrollList, Slider, NumberStepper, ProgressBar, Select,
// Checkbox, TextInput. Every factory returns its root element with a small API attached.
import { h, clear, toNode, clamp } from './dom.js';
import { sprite } from '../sprites.js';
import { playClick } from './button.js';

/**
 * Tab strip + content area.
 *   Tabs({ tabs: [{ id, label, icon?: {kind,id}, content: Node | () => Node, badge? }], active, onChange(id) })
 * API: .select(id), .active (id), .content (element), .refresh() (re-render the active tab)
 * A function `content` is called every time the tab is shown (lazy + always fresh).
 */
export function Tabs(opts = {}) {
  const tabs = opts.tabs || [];
  const strip = h('div.k-tabs-strip');
  const content = h('div.k-tabs-content');
  const el = h('div.k-tabs', { class: [opts.class, opts.vertical && 'k-tabs-vertical'] }, strip, content);
  const buttons = new Map();
  for (const t of tabs) {
    const b = h('button.k-tab', { type: 'button', dataset: { tab: t.id }, title: t.title || '' },
      t.icon ? sprite(t.icon.kind, t.icon.id, { size: t.icon.size || 20 }) : null,
      h('span', null, t.label ?? t.id),
      t.badge != null ? h('span.k-tab-badge', null, String(t.badge)) : null);
    b.addEventListener('click', () => { playClick('click'); select(t.id, true); });
    buttons.set(t.id, b);
    strip.appendChild(b);
  }
  function render() {
    const t = tabs.find((x) => x.id === el.active);
    clear(content);
    if (t && t.content != null) content.appendChild(toNode(t.content));
  }
  function select(id, user = false) {
    if (!buttons.has(id)) return;
    el.active = id;
    for (const [tid, b] of buttons) b.classList.toggle('is-active', tid === id);
    render();
    if (user && opts.onChange) opts.onChange(id);
  }
  el.content = content;
  el.select = (id) => select(id, false);
  el.refresh = render;
  el.active = null;
  if (tabs.length) select(opts.active != null && buttons.has(opts.active) ? opts.active : tabs[0].id);
  return el;
}

/**
 * Scrollable, selectable list.
 *   ScrollList({ items, renderItem(item, index) => Node|string, onSelect(item, index), onActivate(item, index),
 *                selected: index, height, emptyText, keyOf(item) })
 * API: .setItems(items), .select(index, silent?), .selectedIndex, .selectedItem, .items, .rows
 * onActivate fires on double-click.
 */
export function ScrollList(opts = {}) {
  const el = h('div.k-list', { class: opts.class, style: opts.height ? { height: opts.height } : undefined });
  el.items = [];
  el.rows = [];
  el.selectedIndex = -1;
  el.selectedItem = null;
  const renderItem = opts.renderItem || ((item) => String(item?.name ?? item?.label ?? item));

  function select(index, silent = false) {
    el.selectedIndex = index >= 0 && index < el.items.length ? index : -1;
    el.selectedItem = el.selectedIndex >= 0 ? el.items[el.selectedIndex] : null;
    el.rows.forEach((r, i) => r.classList.toggle('is-selected', i === el.selectedIndex));
    if (!silent && el.selectedItem != null && opts.onSelect) opts.onSelect(el.selectedItem, el.selectedIndex);
  }
  function setItems(items, keepKey) {
    const prevKey = keepKey ?? (opts.keyOf && el.selectedItem != null ? opts.keyOf(el.selectedItem) : null);
    el.items = items || [];
    el.rows = el.items.map((item, i) => {
      const row = h('div.k-list-row', { dataset: { index: i } }, toNode(renderItem(item, i)));
      row.addEventListener('click', () => { playClick('click'); select(i); });
      if (opts.onActivate) row.addEventListener('dblclick', () => opts.onActivate(item, i));
      return row;
    });
    clear(el, el.rows.length ? el.rows : h('div.k-list-empty', null, opts.emptyText || 'Nothing here.'));
    let idx = -1;
    if (prevKey != null && opts.keyOf) idx = el.items.findIndex((it) => opts.keyOf(it) === prevKey);
    select(idx, true);
  }
  el.setItems = setItems;
  el.select = select;
  el.scrollToSelected = () => {
    const row = el.rows[el.selectedIndex];
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  };
  setItems(opts.items || []);
  if (opts.selected != null) select(opts.selected, true);
  return el;
}

/**
 * Horizontal slider (native range input, skinned in CSS).
 *   Slider({ min: 0, max: 50, value: 25, step: 1, onChange(value), onCommit(value) })
 * API: .value (get/set), .setRange(min, max), .input
 */
export function Slider(opts = {}) {
  let min = opts.min ?? 0;
  let max = opts.max ?? 100;
  const step = opts.step ?? 1;
  const input = h('input.k-slider-input', { type: 'range' });
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(clamp(opts.value ?? min, min, max));
  const el = h('div.k-slider', { class: opts.class }, input);
  const read = () => clamp(Number(input.value) || 0, min, max);
  input.addEventListener('input', () => { if (opts.onChange) opts.onChange(read()); });
  input.addEventListener('change', () => { if (opts.onCommit) opts.onCommit(read()); });
  Object.defineProperty(el, 'value', {
    get: read,
    set(v) { input.value = String(clamp(Number(v) || 0, min, max)); },
  });
  el.setRange = (lo, hi) => { min = lo; max = hi; input.min = String(lo); input.max = String(hi); input.value = String(read()); };
  el.input = input;
  return el;
}

/**
 * [-] 12 [+] numeric stepper with a typed field.
 *   NumberStepper({ min: 0, max: 99, value: 1, step: 1, bigStep: 10, onChange(value) })
 * API: .value (get/set), .setRange(min, max)
 */
export function NumberStepper(opts = {}) {
  let min = opts.min ?? 0;
  let max = opts.max ?? 999999;
  const step = opts.step ?? 1;
  let value = clamp(opts.value ?? min, min, max);
  const input = h('input.k-stepper-input', { type: 'text', value: String(value) });
  input.setAttribute('inputmode', 'numeric');
  const set = (v, notify = true) => {
    const nv = clamp(Math.round(Number(v) || 0), min, max);
    const was = value;
    value = nv;
    input.value = String(nv);
    if (notify && nv !== was && opts.onChange) opts.onChange(nv);
  };
  const btn = (label, delta, cls) => {
    const b = h('button.k-btn.k-stepper-btn', { type: 'button', class: cls }, label);
    b.addEventListener('click', (e) => { playClick('click'); set(value + delta * (e.shiftKey ? (opts.bigStep || step * 10) : step)); });
    return b;
  };
  input.addEventListener('change', () => set(input.value));
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (input.value !== '' && Number.isFinite(n) && n >= min && n <= max) set(n);
  });
  const el = h('div.k-stepper', { class: opts.class },
    opts.showMinMax ? (() => { const b = h('button.k-btn.k-stepper-btn', { type: 'button' }, 'min'); b.addEventListener('click', () => set(min)); return b; })() : null,
    btn('-', -1, 'k-stepper-dec'), input, btn('+', +1, 'k-stepper-inc'),
    opts.showMinMax ? (() => { const b = h('button.k-btn.k-stepper-btn', { type: 'button' }, 'max'); b.addEventListener('click', () => set(max)); return b; })() : null);
  Object.defineProperty(el, 'value', { get: () => value, set: (v) => set(v, false) });
  el.setRange = (lo, hi) => { min = lo; max = hi; set(value, false); };
  el.input = input;
  return el;
}

/**
 * Progress / gauge bar.
 *   ProgressBar({ value: 30, max: 100, label: '30 / 100', color: 'mana'|'exp'|'hp'|'gold' })
 * API: .set(value, max?, label?)
 */
export function ProgressBar(opts = {}) {
  const fill = h('div.k-progress-fill');
  const label = h('div.k-progress-label');
  const el = h('div.k-progress', { class: [opts.color && `k-progress-${opts.color}`, opts.class] }, fill, label);
  el.set = (value, max = el.max, text) => {
    el.value = value;
    el.max = max;
    const frac = max > 0 ? clamp(value / max, 0, 1) : 0;
    fill.style.width = `${(frac * 100).toFixed(1)}%`;
    label.textContent = text ?? '';
  };
  el.max = opts.max ?? 100;
  el.set(opts.value ?? 0, el.max, opts.label);
  return el;
}

/**
 * Skinned <select>.
 *   Select({ options: [{ value, label }] | ['a', 'b'], value, onChange(value) })
 * API: .value (get/set), .setOptions(options, value?)
 */
export function Select(opts = {}) {
  const el = h('select.k-select', { class: opts.class });
  let options = [];
  let current;
  function setOptions(list, value) {
    options = (list || []).map((o) => (o != null && typeof o === 'object' ? o : { value: o, label: String(o) }));
    clear(el, options.map((o, i) => h('option', { value: String(i), disabled: !!o.disabled }, o.label ?? String(o.value))));
    setValue(value !== undefined ? value : current);
  }
  function setValue(v) {
    let i = options.findIndex((o) => o.value === v);
    if (i < 0) i = options.length ? 0 : -1;
    current = i >= 0 ? options[i].value : undefined;
    el.value = String(i);
    el.selectedIndex = i;
  }
  el.addEventListener('change', () => {
    const i = Number(el.value);
    if (!options[i]) return;
    current = options[i].value;
    if (opts.onChange) opts.onChange(current);
  });
  Object.defineProperty(el, 'val', { get: () => current, set: setValue });
  el.setOptions = setOptions;
  setOptions(opts.options || [], opts.value);
  return el;
}

/**
 * Checkbox with a label.
 *   Checkbox({ label: 'Underground', checked: true, onChange(bool) })
 * API: .checked (get/set via .input.checked), .input
 */
export function Checkbox(opts = {}) {
  const input = h('input.k-check-input', { type: 'checkbox', checked: !!opts.checked, disabled: !!opts.disabled });
  const el = h('label.k-check', { class: opts.class }, input, h('span.k-check-box'), h('span.k-check-label', null, opts.label || ''));
  input.addEventListener('change', () => { playClick('click'); if (opts.onChange) opts.onChange(!!input.checked); });
  el.input = input;
  Object.defineProperty(el, 'isChecked', { get: () => !!input.checked, set: (v) => { input.checked = !!v; } });
  return el;
}

/** Text input. TextInput({ value, placeholder, maxLength, onChange(value), onInput(value), width }) */
export function TextInput(opts = {}) {
  const el = h('input.k-input', { type: opts.type || 'text', value: opts.value ?? '', placeholder: opts.placeholder || '',
    class: opts.class, style: opts.width ? { width: opts.width } : undefined });
  if (opts.maxLength) el.maxLength = opts.maxLength;
  if (opts.onInput) el.addEventListener('input', () => opts.onInput(String(el.value)));
  if (opts.onChange) el.addEventListener('change', () => opts.onChange(String(el.value)));
  return el;
}

/** A labelled form row: Field('Map size', selectEl, 'hint text') */
export function Field(label, control, hint) {
  return h('div.k-field', null, h('div.k-field-label', null, label), h('div.k-field-control', null, control),
    hint ? h('div.k-field-hint', null, hint) : null);
}
