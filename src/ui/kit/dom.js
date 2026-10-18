// DOM helpers shared by the whole UI. Plain DOM factory functions - no framework.
// The kit only uses the DOM subset implemented by tests/ui/fakeDom.js (see docs/mechanics/ui.md).

/**
 * Create an element.
 *   h('div.k-panel.big#main', { title: 'Hi', dataset: { id: 3 }, onClick: fn }, 'text', childEl, [more])
 * `tag` may carry `.class` and `#id` suffixes. Props:
 *   class (string | array, falsy items skipped), dataset {..}, style {..} | string, attrs {..},
 *   on { event: fn }, any `onXxx: fn` (=> addEventListener('xxx')), text, everything else is
 *   assigned as a DOM property (value, disabled, type, draggable, title ...).
 * Children: nodes, strings, numbers, nested arrays; null/undefined/false are skipped.
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const parts = String(tag).split(/(?=[.#])/);
  const el = document.createElement(parts[0] || 'div');
  for (let i = 1; i < parts.length; i++) {
    if (parts[i][0] === '.') el.classList.add(parts[i].slice(1));
    else el.id = parts[i].slice(1);
  }
  if (props != null && (typeof props !== 'object' || Array.isArray(props) || props.nodeType)) {
    children.unshift(props);
    props = null;
  }
  if (props) setProps(el, props);
  appendAll(el, children);
  return el;
}

export function setProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === 'class' || key === 'className') {
      for (const c of [].concat(value)) {
        if (c) for (const one of String(c).split(/\s+/)) if (one) el.classList.add(one);
      }
    } else if (key === 'dataset') {
      for (const [k, v] of Object.entries(value)) if (v != null) el.dataset[k] = String(v);
    } else if (key === 'style') {
      if (typeof value === 'string') el.setAttribute('style', value);
      else setStyle(el, value);
    } else if (key === 'attrs') {
      for (const [k, v] of Object.entries(value)) if (v != null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
    } else if (key === 'on') {
      for (const [k, fn] of Object.entries(value)) if (fn) el.addEventListener(k, fn);
    } else if (key === 'text') {
      el.textContent = value == null ? '' : String(value);
    } else if (key.length > 2 && key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      el[key] = value;
    }
  }
  return el;
}

/** Assign style properties; keys starting with `--` are set as CSS custom properties. */
export function setStyle(el, style) {
  for (const [k, v] of Object.entries(style)) {
    if (v == null) continue;
    if (k.startsWith('--')) el.style.setProperty(k, String(v));
    else el.style[k] = typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : String(v);
  }
  return el;
}
const UNITLESS = new Set(['opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight', 'order', 'zoom', 'gridColumn', 'gridRow']);

export function appendAll(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) appendAll(el, c);
    else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
  return el;
}

/** Remove all children (and optionally append new ones). */
export function clear(el, ...children) {
  el.replaceChildren();
  appendAll(el, children);
  return el;
}

/** addEventListener that returns an "off" function. */
export function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

/** Turn a string | node | function into a node (functions are called). */
export function toNode(content) {
  if (typeof content === 'function') content = content();
  if (content == null || content === false) return document.createTextNode('');
  if (Array.isArray(content)) return h('div', null, content);
  if (typeof content === 'string' || typeof content === 'number') {
    const lines = String(content).split('\n');
    if (lines.length === 1) return h('span', null, lines[0]);
    return h('div', null, lines.map((l) => h('p.k-line', null, l)));
  }
  return content;
}

// ---- text helpers (pure) ------------------------------------------------------------------------

/** 12345 -> "12,345" */
export function fmt(n) {
  if (n == null || Number.isNaN(n)) return '-';
  const neg = n < 0;
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${s}` : s;
}

/** 12345 -> "12.3k" (for cramped places such as army slots). */
export function fmtShort(n) {
  if (n == null) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return String(n);
}

/** "arch_angel" -> "Arch Angel" */
export function humanize(id) {
  return String(id ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** +3 / -2 / 0 */
export function signed(n) { return n > 0 ? `+${n}` : String(n); }

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** { gold: 100, wood: 5 } -> "100 gold, 5 wood" */
export function costText(cost) {
  const parts = Object.entries(cost || {}).filter(([, v]) => v).map(([k, v]) => `${fmt(v)} ${k}`);
  return parts.length ? parts.join(', ') : 'free';
}
