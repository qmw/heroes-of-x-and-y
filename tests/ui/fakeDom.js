// Minimal fake DOM for testing the UI kit in Node (no browser, no dependencies).
// It implements exactly the DOM subset the kit is allowed to use (see docs/mechanics/ui.md
// "DOM subset"): element tree, classList, dataset, style, attributes, events with bubbling,
// simple selectors, a no-op canvas 2D context, localStorage, window and timers.
//
// Usage:  import { installFakeDom, fire } from './fakeDom.js';
//         const dom = installFakeDom();          // sets globalThis.document / window / localStorage
//         ... import UI modules, build widgets, `fire(el, 'click')` ...

class FakeEvent {
  constructor(type, init = {}) {
    this.bubbles = true;
    Object.assign(this, init);
    this.type = type;
    this.defaultPrevented = false;
    this._stopped = false;
    this.target = null;
    this.currentTarget = null;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
  stopImmediatePropagation() { this._stopped = true; this._stoppedNow = true; }
}

class EventTargetBase {
  constructor() { this._listeners = {}; }
  addEventListener(type, fn) {
    if (typeof fn !== 'function') return;
    (this._listeners[type] ||= []).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  _invoke(evt) {
    const list = this._listeners[evt.type];
    if (!list) return;
    evt.currentTarget = this;
    for (const fn of [...list]) {
      fn.call(this, evt);
      if (evt._stoppedNow) break;
    }
  }
  dispatchEvent(evt) {
    if (!evt.target) evt.target = this;
    let node = this;
    while (node) {
      node._invoke(evt);
      if (evt._stopped || evt.bubbles === false) break;
      node = node._eventParent ? node._eventParent() : null;
    }
    return !evt.defaultPrevented;
  }
}

class FakeText {
  constructor(text) { this.nodeType = 3; this.data = String(text); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

function makeStyle() {
  const store = {};
  Object.defineProperty(store, 'setProperty', { value(k, v) { store[k] = String(v); }, enumerable: false });
  Object.defineProperty(store, 'getPropertyValue', { value(k) { return store[k] ?? ''; }, enumerable: false });
  Object.defineProperty(store, 'removeProperty', { value(k) { delete store[k]; }, enumerable: false });
  return store;
}

/** A 2D context where every method is a no-op and every property is assignable. */
function makeContext2d(canvas) {
  const target = { canvas };
  const proxy = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (key === 'getImageData' || key === 'createImageData') {
        return (x, y, w, h) => ({ width: w || 1, height: h || 1, data: new Uint8ClampedArray((w || 1) * (h || 1) * 4) });
      }
      if (typeof key === 'symbol') return undefined;
      return () => proxy; // createLinearGradient().addColorStop(), save(), fillRect() ...
    },
    set(t, key, value) { t[key] = value; return true; },
  });
  return proxy;
}

function parseCompound(sel) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([#.]?[\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
  let m;
  while ((m = re.exec(sel))) {
    if (m[2]) out.attrs.push([m[2], m[3]]);
    else if (m[1][0] === '#') out.id = m[1].slice(1);
    else if (m[1][0] === '.') out.classes.push(m[1].slice(1));
    else out.tag = m[1].toUpperCase();
  }
  return out;
}

class FakeElement extends EventTargetBase {
  constructor(tag, doc) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = doc;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.style = makeStyle();
    this._classes = [];
    const self = this;
    this.classList = {
      add(...c) { for (const x of c) if (x && !self._classes.includes(x)) self._classes.push(x); },
      remove(...c) { self._classes = self._classes.filter((x) => !c.includes(x)); },
      contains(c) { return self._classes.includes(c); },
      toggle(c, force) {
        const want = force === undefined ? !self._classes.includes(c) : !!force;
        if (want) this.add(c); else this.remove(c);
        return want;
      },
      get length() { return self._classes.length; },
    };
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.scrollHeight = 0;
    if (this.tagName === 'CANVAS') { this.width = 300; this.height = 150; }
  }

  _eventParent() {
    const doc = this.ownerDocument;
    return this.parentNode || (this === doc.body || this === doc.documentElement ? doc : null);
  }

  get className() { return this._classes.join(' '); }
  set className(v) { this._classes = String(v || '').split(/\s+/).filter(Boolean); }
  get id() { return this.attributes.id || ''; }
  set id(v) { this.attributes.id = String(v); }

  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get childElementCount() { return this.children.length; }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === this.ownerDocument.body || n === this.ownerDocument.documentElement;
  }

  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new FakeText(v));
  }

  setAttribute(k, v) {
    if (k === 'class') this.className = v;
    else if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
    else this.attributes[k] = String(v);
  }
  getAttribute(k) {
    if (k === 'class') return this.className;
    if (k.startsWith('data-')) return this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] ?? null;
    return this.attributes[k] ?? null;
  }
  hasAttribute(k) { return this.getAttribute(k) != null; }
  removeAttribute(k) { delete this.attributes[k]; }

  _adopt(node) {
    if (typeof node === 'string' || typeof node === 'number') node = new FakeText(node);
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    return node;
  }
  appendChild(node) {
    if (node.tagName === '#FRAGMENT') {
      for (const c of [...node.childNodes]) this.appendChild(c);
      return node;
    }
    node = this._adopt(node);
    this.childNodes.push(node);
    return node;
  }
  append(...nodes) { for (const n of nodes) if (n != null) this.appendChild(n); }
  prepend(...nodes) {
    const first = this.childNodes[0] || null;
    for (const n of nodes) if (n != null) this.insertBefore(n, first);
  }
  insertBefore(node, ref) {
    if (!ref) return this.appendChild(node);
    node = this._adopt(node);
    const i = this.childNodes.indexOf(ref);
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) { this.childNodes.splice(i, 1); node.parentNode = null; }
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  _matchCompound(c) {
    if (c.tag && c.tag !== this.tagName) return false;
    if (c.id && c.id !== this.id) return false;
    for (const cl of c.classes) if (!this._classes.includes(cl)) return false;
    for (const [k, v] of c.attrs) {
      const have = this.getAttribute(k) ?? (this[k] !== undefined && this[k] !== false ? String(this[k]) : null);
      if (have == null) return false;
      if (v !== undefined && String(have) !== v) return false;
    }
    return true;
  }
  matches(selector) {
    return selector.split(',').some((sel) => {
      const parts = sel.trim().split(/\s+/).map(parseCompound);
      if (!this._matchCompound(parts[parts.length - 1])) return false;
      let node = this.parentNode;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (node && !(node.nodeType === 1 && node._matchCompound(parts[i]))) node = node.parentNode;
        if (!node) return false;
        node = node.parentNode;
      }
      return true;
    });
  }
  closest(selector) {
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(selector)) return n;
    return null;
  }
  querySelectorAll(selector) {
    const out = [];
    const walk = (el) => {
      for (const c of el.children) {
        if (c.matches(selector)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  click() { if (!this.disabled) this.dispatchEvent(new FakeEvent('click', { button: 0 })); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  select() {}
  scrollIntoView() {}
  getBoundingClientRect() {
    const w = this.width || this.offsetWidth || 0;
    const hh = this.height || this.offsetHeight || 0;
    return { left: 0, top: 0, x: 0, y: 0, width: w, height: hh, right: w, bottom: hh };
  }
  getContext() { return (this._ctx ||= makeContext2d(this)); }
  toDataURL() { return 'data:,'; }
}

class FakeDocument extends EventTargetBase {
  constructor(win) {
    super();
    this.defaultView = win;
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.head = new FakeElement('head', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.activeElement = null;
  }
  _eventParent() { return this.defaultView; }
  createElement(tag) { return new FakeElement(tag, this); }
  createTextNode(text) { return new FakeText(text); }
  createDocumentFragment() { return new FakeElement('#fragment', this); }
  getElementById(id) { return this.documentElement.querySelector(`#${id}`); }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
}

/** In-memory Storage with an optional byte quota (throws like a browser when exceeded). */
export function createFakeStorage(quota = Infinity) {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      v = String(v);
      let total = v.length;
      for (const [kk, vv] of map) if (kk !== k) total += vv.length;
      if (total > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, v);
    },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
  };
}

/**
 * Create a fake window/document pair and install them as globals.
 * @returns {{window, document, localStorage, restore: () => void, flushFrames: (n?: number) => void}}
 */
export function installFakeDom() {
  const win = new EventTargetBase();
  const doc = new FakeDocument(win);
  const localStorage = createFakeStorage();
  const frames = [];
  let frameId = 0;
  Object.assign(win, {
    document: doc, localStorage, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    requestAnimationFrame(fn) { frames.push({ id: ++frameId, fn }); return frameId; },
    cancelAnimationFrame(id) { const i = frames.findIndex((f) => f.id === id); if (i >= 0) frames.splice(i, 1); },
    setTimeout: (...a) => setTimeout(...a), clearTimeout: (id) => clearTimeout(id),
    performance: { now: () => Date.now() },
    location: { href: 'http://localhost/', reload() {} },
  });
  const keys = ['window', 'document', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const saved = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const values = { window: win, document: doc, localStorage, requestAnimationFrame: win.requestAnimationFrame, cancelAnimationFrame: win.cancelAnimationFrame };
  for (const k of keys) Object.defineProperty(globalThis, k, { value: values[k], configurable: true, writable: true });
  return {
    window: win, document: doc, localStorage,
    /** Run queued requestAnimationFrame callbacks `n` times (16 ms apart). */
    flushFrames(n = 1, t0 = 0) {
      for (let i = 0; i < n; i++) {
        const batch = frames.splice(0);
        for (const f of batch) f.fn(t0 + (i + 1) * 16);
      }
    },
    restore() {
      for (const k of keys) {
        if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
        else delete globalThis[k];
      }
    },
  };
}

/** Dispatch an event on an element: `fire(el, 'click', { shiftKey: true })`. Returns the event. */
export function fire(el, type, init = {}) {
  const evt = new FakeEvent(type, init);
  el.dispatchEvent(evt);
  return evt;
}

/** Collect the text of all descendants (handy for assertions). */
export function textOf(el) { return el.textContent; }

/** Let pending promise callbacks run. */
export function tick(n = 3) {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r)));
  return p;
}

/** Wait (yielding to the event loop) until `fn()` is truthy; throws after ~`max` turns. */
/**
 * Wait (macrotask by macrotask) until `fn()` is truthy. Gives up after `max` turns, but never before
 * `minMs` of wall time: lazy `import()`s of screen modules may need more turns when the machine is
 * busy (full parallel test run), which made tests flaky. The outcome of a passing test does not
 * depend on timing - only how long a failing one takes to report.
 */
export async function until(fn, max = 500, minMs = 5000) {
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    const v = fn();
    if (v) return v;
    if (i >= max && Date.now() - t0 >= minMs) break;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`until(): condition never became true: ${fn}`);
}

export { FakeElement, FakeEvent, FakeDocument };
