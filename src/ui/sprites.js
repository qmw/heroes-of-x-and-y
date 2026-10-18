// Thin, crash-proof wrapper around the procedural graphics module (src/gfx/index.js).
// The UI NEVER imports src/gfx directly: it asks for `sprite(kind, id, opts)` and always gets a
// canvas back - the real sprite when gfx is present and works, otherwise a coloured placeholder
// tile with the id's initials.
//
// kinds: creature | hero | portrait | terrain | object | building | artifact | spell | resource |
//        skill | town | ui | obstacle | effect
// opts : { size, frame, facing, playerColor, variant, state }  (+ `title` for a native tooltip)

let gfx = null;
let warned = new Set();

const DEFAULT_SIZE = {
  creature: 64, hero: 64, portrait: 64, terrain: 32, object: 48, building: 64, artifact: 44,
  spell: 48, resource: 24, skill: 44, town: 64, ui: 32, obstacle: 48, effect: 48,
};

/** Try to load the gfx module. Safe to call many times; resolves to true when gfx is usable. */
export async function initSprites(loader = () => import('../gfx/index.js')) {
  if (gfx) return true;
  try {
    const mod = await loader();
    if (mod && typeof mod.getSprite === 'function') {
      gfx = mod;
      // Duelyst sheets load asynchronously: refresh DOM copies when they arrive.
      if (typeof mod.onSpriteReady === 'function') mod.onSpriteReady(refreshCopies);
      if (typeof mod.initDuelyst === 'function') {
        mod.initDuelyst().catch((err) => warnOnce('duelyst', `Duelyst art unavailable (${err && err.message})`));
      }
      // third-party asset packs (terrain textures, extra icons, war machines): optional as well
      if (typeof mod.initArtPacks === 'function') {
        mod.initArtPacks().catch((err) => warnOnce('packs', `asset packs unavailable (${err && err.message})`));
      }
      return true;
    }
  } catch (err) {
    warnOnce('gfx-load', `gfx module not available, using placeholders (${err && err.message})`);
  }
  return false;
}

/** Inject a gfx module (tests) or null to force placeholders. */
export function setGfx(mod) { gfx = mod; warned = new Set(); }
export function hasGfx() { return !!gfx; }
export function getGfx() { return gfx; }

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof console !== 'undefined') console.warn(`[sprites] ${msg}`);
}

function hashHue(str) {
  let x = 7;
  for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0;
  return x % 360;
}

/** "arch_angel" -> "AA", "pikeman" -> "PI" */
export function initials(id) {
  const words = String(id ?? '?').split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Colour of the placeholder tile for an id (pure). */
export function placeholderColor(kind, id) {
  return `hsl(${hashHue(`${kind}:${id}`)}, 38%, 34%)`;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A placeholder tile: coloured rounded square with the id's initials. Always works. */
export function placeholder(kind, id, size = 48) {
  const c = makeCanvas(size, size);
  try {
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = placeholderColor(kind, id);
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(255, 220, 140, 0.55)';
      ctx.lineWidth = Math.max(1, size / 24);
      ctx.strokeRect(1, 1, size - 2, size - 2);
      ctx.fillStyle = 'rgba(255, 244, 214, 0.92)';
      ctx.font = `bold ${Math.max(8, Math.floor(size * 0.4))}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(id), size / 2, size / 2 + 1);
    }
  } catch { /* a blank canvas is still fine */ }
  return c;
}

/** The cached source canvas from gfx, or null. Do NOT insert this into the DOM (it is shared). */
function source(kind, id, opts) {
  if (!gfx) return null;
  try {
    const c = gfx.getSprite(kind, id, opts);
    if (c && c.width > 0 && c.height > 0) return c;
  } catch (err) {
    warnOnce(`${kind}:${id}`, `getSprite(${kind}, ${id}) threw: ${err && err.message}`);
  }
  return null;
}

/**
 * A fresh canvas element showing a sprite - safe to append anywhere (gfx caches and shares its
 * canvases, so we always hand out a copy). CSS size = `opts.size` (width; height keeps the
 * sprite's aspect ratio).
 * @returns {HTMLCanvasElement}
 */
export function sprite(kind, id, opts = {}) {
  const size = opts.size || DEFAULT_SIZE[kind] || 48;
  // UI icons of creatures (army slots, lists, cards): crop the pixel-art sheet to a square box and
  // scale the body to fill it, instead of a small figure lost in the battlefield-sized frame.
  // Callers that need the battlefield geometry pass their own `box` (or `fit: 'natural'`).
  if (kind === 'creature' && !opts.box && opts.fit !== 'natural') {
    opts = { ...opts, box: { w: size, h: size, ax: size / 2, ay: Math.round(size * 0.95) }, minBody: Math.round(size * 0.8) };
  }
  const src = id == null ? null : source(kind, id, { ...opts, size });
  let c;
  if (src) {
    c = makeCanvas(src.width, src.height);
    try { c.getContext('2d').drawImage(src, 0, 0); trackCopy(c, src); } catch { c = placeholder(kind, id, size); }
  } else {
    c = placeholder(kind, id ?? 'none', size);
  }
  c.classList.add('spr', `spr-${kind}`);
  c.dataset.kind = kind;
  c.dataset.id = String(id);
  // gfx renders at the requested pixel size, and multi-cell sprites (2-hex creatures, multi-tile
  // objects) come out wider than `size` - keep their real proportions instead of squashing them.
  const nominal = src && (kind === 'creature' || kind === 'building' || kind === 'object') ? c.width : size;
  c.style.width = `${nominal}px`;
  c.style.height = `${Math.round(nominal * (c.height / c.width))}px`;
  if (opts.title) c.title = opts.title;
  return c;
}

// DOM copies of gfx canvases, so they can be re-copied when an async (Duelyst) sheet finishes loading.
const copies = new Set();
const MAX_COPIES = 4000;

function refreshCopies() {
  for (const entry of copies) {
    const { c, src } = entry;
    if (c.isConnected === false) { copies.delete(entry); continue; }
    try {
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0);
    } catch { copies.delete(entry); }
  }
}

function trackCopy(c, src) {
  if (copies.size >= MAX_COPIES) {
    for (const entry of copies) if (entry.c.isConnected === false) copies.delete(entry);
    if (copies.size >= MAX_COPIES) copies.delete(copies.values().next().value);
  }
  copies.add({ c, src });
}

const phCache = new Map();

/**
 * Draw a sprite onto a 2D context with its top-left corner at (x, y), `opts.size` px wide.
 * Never throws.
 */
export function drawSprite(ctx, kind, id, x, y, opts = {}) {
  const size = opts.size || DEFAULT_SIZE[kind] || 48;
  try {
    if (gfx && typeof gfx.drawSprite === 'function') {
      gfx.drawSprite(ctx, kind, id, x, y, { ...opts, size });
      return true;
    }
    const src = source(kind, id, { ...opts, size });
    if (src) {
      ctx.drawImage(src, x, y, size, size * (src.height / src.width));
      return true;
    }
  } catch (err) {
    warnOnce(`draw:${kind}:${id}`, `drawSprite(${kind}, ${id}) threw: ${err && err.message}`);
  }
  try {
    const key = `${kind}:${id}:${size}`;
    let ph = phCache.get(key);
    if (!ph) { ph = placeholder(kind, id, size); phCache.set(key, ph); }
    ctx.drawImage(ph, x, y, size, size);
  } catch { /* nothing more we can do */ }
  return false;
}
