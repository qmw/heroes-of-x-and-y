// Buttons and frames.
import { h, toNode } from './dom.js';
import { sprite } from '../sprites.js';
import { attachTooltip } from './tooltip.js';

let clickSound = null;
/** app.js installs a click-sound hook here so every kit button blips. */
export function setClickSound(fn) { clickSound = fn; }
export function playClick(name = 'click') { if (clickSound) { try { clickSound(name); } catch { /* ignore */ } } }

/**
 * Text button.
 *   Button('End Turn', { onClick, kind: 'primary'|'default'|'danger'|'ghost', size: 'sm'|'md'|'lg',
 *                         icon: {kind, id}, tooltip, disabled, hotkey: 'E', sound: 'click' })
 * API on the returned <button>: setLabel(text), setDisabled(bool), setActive(bool)
 */
export function Button(label, opts = {}) {
  if (typeof opts === 'function') opts = { onClick: opts };
  const labelEl = h('span.k-btn-label', null, label ?? '');
  const el = h('button.k-btn', {
    type: 'button',
    class: [`k-btn-${opts.kind || 'default'}`, opts.size && `k-btn-${opts.size}`, opts.class],
    disabled: !!opts.disabled,
  },
  opts.icon ? sprite(opts.icon.kind, opts.icon.id, { size: opts.icon.size || 22 }) : null,
  labelEl,
  opts.hotkey ? h('span.k-btn-hotkey', null, opts.hotkey) : null);
  el.addEventListener('click', (e) => {
    if (el.disabled) return;
    playClick(opts.sound || 'click');
    if (opts.onClick) opts.onClick(e);
  });
  if (opts.tooltip) attachTooltip(el, opts.tooltip);
  el.setLabel = (t) => { labelEl.textContent = t; };
  el.setDisabled = (d) => { el.disabled = !!d; el.classList.toggle('is-disabled', !!d); };
  el.setActive = (a) => { el.classList.toggle('is-active', !!a); };
  if (opts.disabled) el.classList.add('is-disabled');
  if (opts.active) el.classList.add('is-active');
  return el;
}

/**
 * Square icon button. `icon` is `{kind, id}` (sprite), a string glyph, or a node.
 *   IconButton({ kind: 'ui', id: 'end_turn' }, { onClick, tooltip: 'End turn (E)', size: 40 })
 */
export function IconButton(icon, opts = {}) {
  if (typeof opts === 'function') opts = { onClick: opts };
  const size = opts.size || 40;
  const inner = icon && typeof icon === 'object' && !icon.nodeType
    ? sprite(icon.kind, icon.id, { size: size - 10 })
    : typeof icon === 'string' ? h('span.k-glyph', null, icon) : icon;
  const el = h('button.k-btn.k-iconbtn', {
    type: 'button', class: [opts.class, opts.kind && `k-btn-${opts.kind}`], disabled: !!opts.disabled,
    style: { width: size, height: size },
  }, inner);
  el.addEventListener('click', (e) => {
    if (el.disabled) return;
    playClick(opts.sound || 'click');
    if (opts.onClick) opts.onClick(e);
  });
  if (opts.tooltip) attachTooltip(el, opts.tooltip);
  el.setDisabled = (d) => { el.disabled = !!d; el.classList.toggle('is-disabled', !!d); };
  el.setActive = (a) => { el.classList.toggle('is-active', !!a); };
  if (opts.disabled) el.classList.add('is-disabled');
  if (opts.active) el.classList.add('is-active');
  return el;
}

/**
 * Stone panel with an optional gold title bar.
 *   Panel({ title: 'Garrison', variant: 'stone'|'parchment'|'dark', class, footer }, ...children)
 * API: .body (content element), .setTitle(text), .setContent(...nodes)
 */
export function Panel(opts = {}, ...children) {
  if (opts == null || opts.nodeType || typeof opts !== 'object' || Array.isArray(opts)) {
    children.unshift(opts);
    opts = {};
  }
  const titleEl = opts.title != null ? h('div.k-panel-title', null, opts.title) : null;
  const body = h('div.k-panel-body', null, children);
  const el = h('div.k-panel', { class: [`k-panel-${opts.variant || 'stone'}`, opts.class], style: opts.style },
    titleEl, body, opts.footer ? h('div.k-panel-footer', null, opts.footer) : null);
  el.body = body;
  el.setTitle = (t) => { if (titleEl) titleEl.textContent = t; };
  el.setContent = (...nodes) => { body.replaceChildren(); for (const n of nodes.flat()) if (n != null) body.appendChild(toNode(n)); };
  return el;
}

/** Thin ornamental gold frame around arbitrary content (portraits, canvases). */
export function Frame(opts = {}, ...children) {
  if (opts == null || opts.nodeType || typeof opts !== 'object' || Array.isArray(opts)) {
    children.unshift(opts);
    opts = {};
  }
  return h('div.k-frame', { class: [opts.class, opts.inset && 'k-frame-inset'], style: opts.style }, children);
}

/** Small "label: value" line used all over stat panels. */
export function StatLine(label, value, opts = {}) {
  const v = h('span.k-stat-value', null, value == null ? '-' : String(value));
  const el = h('div.k-stat', { class: opts.class }, h('span.k-stat-label', null, label), v);
  el.set = (nv) => { v.textContent = String(nv); };
  if (opts.tooltip) attachTooltip(el, opts.tooltip);
  return el;
}
