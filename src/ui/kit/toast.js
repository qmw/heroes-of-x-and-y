// Toast notifications and the scrolling log console.
import { h, clear } from './dom.js';
import { getLayer } from './stage.js';

/**
 * Transient notification at the top of the stage.
 *   toast('Not enough gold', 'error')         kinds: info | good | warn | error
 * @returns {HTMLElement} the toast element (already attached; removes itself after `ms`)
 */
export function toast(text, kind = 'info', ms = 2600) {
  const el = h('div.k-toast', { class: `k-toast-${kind}` }, String(text));
  const layer = getLayer('toasts');
  layer.appendChild(el);
  while (layer.children.length > 5) layer.children[0].remove();
  if (ms > 0) {
    const t = setTimeout(() => el.remove(), ms);
    if (t && t.unref) t.unref();
  }
  el.addEventListener('click', () => el.remove());
  return el;
}

/**
 * Observable message log (pure - no DOM). app.js owns one as `ctx.logStore`; `ctx.log(text, kind)`
 * appends to it.
 * @returns {{ entries: Array<{n, text, kind, day}>, add, clear, subscribe }}
 */
export function createLogStore(limit = 300) {
  const subs = new Set();
  const store = {
    entries: [],
    count: 0,
    add(text, kind = 'info', extra = {}) {
      const entry = { n: ++store.count, text: String(text), kind, ...extra };
      store.entries.push(entry);
      if (store.entries.length > limit) store.entries.splice(0, store.entries.length - limit);
      for (const fn of subs) fn(entry, store);
      return entry;
    },
    clear() { store.entries.length = 0; for (const fn of subs) fn(null, store); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
  return store;
}

/**
 * Scrolling console bound to a log store.
 *   const con = LogConsole({ store: ctx.logStore, max: 80, height: 96 });
 * API: .destroy() (unsubscribe - call in your screen's unmount), .add(text, kind) (standalone use)
 */
export function LogConsole(opts = {}) {
  const store = opts.store || createLogStore();
  const max = opts.max || 80;
  const el = h('div.k-log', { class: opts.class, style: opts.height ? { height: opts.height } : undefined });
  const line = (e) => h('div.k-log-line', { class: `k-log-${e.kind}` }, e.text);
  const fill = () => { clear(el, store.entries.slice(-max).map(line)); el.scrollTop = el.scrollHeight || 1e9; };
  fill();
  const off = store.subscribe((entry) => {
    if (!entry) { fill(); return; }
    el.appendChild(line(entry));
    while (el.children.length > max) el.children[0].remove();
    el.scrollTop = el.scrollHeight || 1e9;
  });
  el.store = store;
  el.add = (text, kind) => store.add(text, kind);
  el.destroy = off;
  return el;
}
