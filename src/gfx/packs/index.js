// Asset-pack art layer: third-party CC0 / CC-BY packs (terrain textures, extra icons, war
// machines, a sound). Spec: docs/mechanics/asset-packs.md. Same contract as src/gfx/duelyst/:
// synchronous canvases that are painted when their image arrives, plus onPackSpriteReady.
//
//   await initPacks({ baseUrl, manifestUrl })              // manifest only; images load lazily
//   getPackSprite(kind, id, opts) -> canvas | null           // null = not mapped / not ready / broken
//   getPackSpriteInfo(kind, id, opts) -> { width, height, anchorX, anchorY, frames } | null
//   getPackAnimationInfo(kind, id, state) -> { frames, fps, loop } | null
//   terrainPackPainter -> { base(ctx,x,y,size,terrain,info), edge(ctx,x,y,size,terrain,edgeCanvas,info) }
//   onPackSpriteReady(fn) -> unsubscribe        getPackSfxUrl(event) -> url | null

import { resolvePackRef, TERRAIN_TEXTURES, TEXELS_PER_TILE, PACK_SFX } from './mapping.js';
import { completeFactions, setOf } from './generated.js';
import { CREATURE_BY_ID } from '../../data/creatures.js';
import { MAP_OBJECT_BY_ID } from '../../data/mapObjects.js';
import { getTownLayout } from '../towns.js';
import { flag as drawFlag } from '../kit.js';

export const PACK_FPS = 10;
const NON_LOOPING = new Set(['attack', 'shoot', 'hit', 'dead', 'death', 'defend']);
const STATE_ALIASES = { walk: 'move', death: 'dead', cast: 'attack', flourish: 'idle' };
const DEFAULT_ICON_SIZE = { artifact: 44, resource: 24 };

const state = {
  ready: false,
  baseUrl: 'assets/',
  files: {}, // rel path -> { w, h, bytes }
  units: {}, // unit id -> { b }
  complete: {}, // generated per-faction sets -> Set(faction) usable (see generated.js completeFactions)
  images: new Map(), // url -> { status, img, waiters }
  cache: new Map(),
  maxCache: 2000,
  broken: new Set(),
  listeners: new Set(),
  fringes: new WeakMap(), // procedural edge canvas -> Map(texture offset -> masked fringe canvas)
  env: { loadImage: defaultLoadImage, fetchJson: defaultFetchJson, createCanvas: defaultCreateCanvas },
};

function defaultLoadImage(url) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { reject(new Error('Image unavailable')); return; }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`packs: failed to load ${url}`));
    img.src = url;
  });
}
async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`packs: ${url} -> HTTP ${res.status}`);
  return res.json();
}
function defaultCreateCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('packs: no canvas implementation; call configurePacks({ createCanvas })');
}

/** Inject environment functions (tests). Omitted keys keep their value. */
export function configurePacks({ loadImage, fetchJson, createCanvas, maxCache } = {}) {
  if (loadImage) state.env.loadImage = loadImage;
  if (fetchJson) state.env.fetchJson = fetchJson;
  if (createCanvas) { state.env.createCanvas = createCanvas; state.fringes = new WeakMap(); }
  if (maxCache) state.maxCache = maxCache;
}

/**
 * Load assets/packs-manifest.json. Until it resolves every getter returns null (procedural art).
 * @returns {Promise<{ files: number, units: number }>}
 */
export async function initPacks(o = {}) {
  configurePacks(o);
  const baseUrl = o.baseUrl ?? 'assets/';
  const manifestUrl = o.manifestUrl ?? `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}packs-manifest.json`;
  const json = await state.env.fetchJson(manifestUrl);
  state.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  state.files = (json && json.files) || {};
  state.units = (json && json.units) || {};
  state.complete = Object.fromEntries(['townscreen', 'maptown', 'siege'].map((k) => [k, completeFactions(k, state.files)]));
  state.cache.clear();
  state.broken.clear();
  state.fringes = new WeakMap();
  state.ready = true;
  notify({ manifest: true });
  return { files: Object.keys(state.files).length, units: Object.keys(state.units).length };
}

/** Forget everything (tests). */
export function resetPacks() {
  state.ready = false;
  state.files = {};
  state.units = {};
  state.images.clear();
  state.cache.clear();
  state.broken.clear();
  state.listeners.clear();
}

export function isPacksReady() { return state.ready; }

export function onPackSpriteReady(listener) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
function notify(info) {
  for (const fn of [...state.listeners]) {
    try { fn(info); } catch (err) { if (typeof console !== 'undefined') console.error(err); }
  }
}

function filesOf(ref) {
  return ref.layers || [ref.file];
}

/** Mapping entry when (kind, id) is mapped, initialised, present in the manifest and not broken. */
function refFor(kind, id, opts) {
  if (!state.ready || state.broken.has(`${kind}|${id}`)) return null;
  const ref = resolvePackRef(kind, id, opts);
  if (!ref) return null;
  for (const f of filesOf(ref)) if (!state.files[f] || state.broken.has(f)) return null;
  const set = setOf(kind, ref);
  if (set && !(state.complete[set] && state.complete[set].has(ref.faction))) return null;
  return ref;
}

export function hasPackSprite(kind, id, opts) { return refFor(kind, id, opts) !== null; }

// ------------------------------------------------------------------------------------------------
// Image loading (shared by sprites and terrain)
// ------------------------------------------------------------------------------------------------

function urlOf(rel) { return state.baseUrl + rel; }

/** Image for a path relative to assets/ when loaded; starts loading otherwise (onDone(img|null)). */
function requestImage(rel, onDone) {
  const url = urlOf(rel);
  let e = state.images.get(url);
  if (e && e.status === 'ok') return e.img;
  if (e && e.status === 'error') { if (onDone) onDone(null); return null; }
  if (!e) {
    e = { status: 'loading', img: null, waiters: new Set() };
    state.images.set(url, e);
    Promise.resolve()
      .then(() => state.env.loadImage(url))
      .then((img) => { e.status = 'ok'; e.img = img; }, () => { e.status = 'error'; })
      .then(() => {
        const ws = [...e.waiters];
        e.waiters.clear();
        for (const w of ws) w(e.status === 'ok' ? e.img : null);
        notify({ url, ok: e.status === 'ok' });
      });
  }
  if (onDone) e.waiters.add(onDone);
  return null;
}

/** Load several images; calls onDone(images|null) once all are there (null if any failed). */
function requestAll(rels, onDone) {
  const out = new Array(rels.length);
  let pending = rels.length;
  let failed = false;
  let sync = true;
  const result = { imgs: null };
  rels.forEach((rel, i) => {
    const img = requestImage(rel, (loaded) => {
      if (!loaded) failed = true;
      out[i] = loaded;
      if (--pending === 0 && !sync) onDone(failed ? null : out);
    });
    if (img) { out[i] = img; pending--; }
  });
  sync = false;
  if (pending === 0) result.imgs = failed ? null : out;
  return result.imgs;
}

export function imageStatus(rel) {
  const e = state.images.get(urlOf(rel));
  return e ? e.status : 'none';
}

/** Start loading the images behind a list of [kind, id]. Resolves to the number loaded. */
export function preloadPackSprites(list) {
  const rels = new Set();
  for (const it of list || []) {
    const [kind, id, o] = Array.isArray(it) ? it : [it.kind, it.id, it.opts];
    const ref = refFor(kind, id, o);
    if (ref) for (const f of filesOf(ref)) rels.add(f);
  }
  return Promise.all([...rels].map((r) => new Promise((resolve) => {
    const img = requestImage(r, (loaded) => resolve(loaded ? 1 : 0));
    if (img) resolve(1);
  }))).then((r) => r.reduce((s, x) => s + x, 0));
}

// ------------------------------------------------------------------------------------------------
// Painting helpers
// ------------------------------------------------------------------------------------------------

function ctx2d(canvas) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  return g;
}

/** Recolour a layer with the 'color' blend (keeps luminance), then restore its alpha from `src`. */
function recolor(layer, src, tint, alpha) {
  const g = ctx2d(layer);
  g.save();
  g.globalCompositeOperation = 'color';
  g.globalAlpha = alpha ?? 0.6;
  g.fillStyle = tint;
  g.fillRect(0, 0, layer.width, layer.height);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(src, 0, 0);
  g.restore();
}

function playerColorHex(c) {
  const HEX = { red: '#d83a2c', blue: '#3564d8', tan: '#c8aa72', green: '#3fa544', orange: '#e8862a', purple: '#8e44c8', teal: '#2aa8a0', pink: '#e87ab8' };
  const ORDER = ['red', 'blue', 'tan', 'green', 'orange', 'purple', 'teal', 'pink'];
  if (typeof c === 'number') return HEX[ORDER[c]] || '#9a9a9a';
  if (typeof c === 'string' && c[0] === '#') return c;
  return HEX[c] || '#9a9a9a';
}

// ---- icons -------------------------------------------------------------------------------------

function iconSize(kind, o) {
  return Math.max(4, Math.round(o.size > 0 ? o.size : DEFAULT_ICON_SIZE[kind] || 44));
}

/**
 * Where an icon image goes in a square canvas: its opaque part (manifest bounds `b`) is centred and
 * scaled to ~90% of the side; an integer pixel-art scale is preferred when it is close enough.
 * @returns {{ sx, sy, sw, sh, dx, dy, dw, dh }}
 */
export function iconPlacement(iw, ih, b, side, fill = 0.9) {
  const [x0, y0, x1, y1] = b || [0, 0, iw - 1, ih - 1];
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const inner = side * fill;
  let k = inner / Math.max(bw, bh);
  const ki = Math.floor(k);
  if (ki >= 1 && ki * Math.max(bw, bh) >= inner * 0.8) k = ki;
  const dw = Math.round(bw * k);
  const dh = Math.round(bh * k);
  return { sx: x0, sy: y0, sw: bw, sh: bh, dx: Math.round((side - dw) / 2), dy: Math.round((side - dh) / 2), dw, dh };
}

function paintIcon(canvas, img, ref, kind, o) {
  const g = ctx2d(canvas);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const meta = state.files[ref.file] || {};
  const p = iconPlacement(iw, ih, meta.b, canvas.width, kind === 'resource' ? 0.94 : 0.86);
  const put = (ctx) => ctx.drawImage(img, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
  if (!ref.tint) {
    put(g);
    return;
  }
  const src = state.env.createCanvas(canvas.width, canvas.height);
  put(ctx2d(src));
  const layer = state.env.createCanvas(canvas.width, canvas.height);
  ctx2d(layer).drawImage(src, 0, 0);
  recolor(layer, src, ref.tint, ref.tintAlpha);
  if (ref.lighten) {
    // brighten dark art after the recolour (screen blend), alpha restored from the source
    const lg = ctx2d(layer);
    lg.save();
    lg.globalCompositeOperation = 'screen';
    lg.globalAlpha = ref.lightenAlpha ?? 0.5;
    lg.fillStyle = ref.lighten;
    lg.fillRect(0, 0, layer.width, layer.height);
    lg.globalAlpha = 1;
    lg.globalCompositeOperation = 'destination-in';
    lg.drawImage(src, 0, 0);
    lg.restore();
  }
  g.drawImage(layer, 0, 0);
}

// ---- units (war machines) ------------------------------------------------------------------------

function normState(s) {
  const n = STATE_ALIASES[s] || s || 'idle';
  return n;
}

function animFrames(ref, gameState) {
  const s = normState(gameState);
  return ref.anims[s] || ref.anims.idle;
}

/** Frame index with the Duelyst conventions: loop idle/move, clamp the rest, dead = last. */
export function packFrameIndex(n, gameState, opts = {}) {
  if (n <= 1) return 0;
  const s = normState(gameState);
  let f;
  if (typeof opts.time === 'number') f = Math.floor(opts.time * PACK_FPS);
  else if (opts.frame === undefined || opts.frame === null) f = s === 'dead' ? n - 1 : 0;
  else f = opts.frame | 0;
  if (opts.frames > 0 && opts.frame !== undefined && opts.frame !== null) f = Math.floor(((f % opts.frames) + opts.frames) % opts.frames * n / opts.frames);
  if (NON_LOOPING.has(s)) return Math.max(0, Math.min(n - 1, f));
  return ((f % n) + n) % n;
}

/** Canvas box + placement: the procedural/Duelyst creature contract (feet at (w/2, 0.92h)). */
export function packUnitLayout(ref, bounds, id, opts = {}) {
  const size = Math.max(4, Math.round(opts.size > 0 ? opts.size : 96));
  const twoHex = CREATURE_BY_ID[id] && CREATURE_BY_ID[id].size === 2;
  const w = twoHex ? size * 2 : size;
  const box = opts.box || { w, h: size, ax: w / 2, ay: Math.round(size * 0.92) };
  const b = bounds || [0, 0, ref.fw - 1, ref.fh - 1];
  const bw = b[2] - b[0] + 1;
  const bh = b[3] - b[1] + 1;
  // fill ~90% of the box width (machines are wide and low), never taller than the box
  let k = Math.min((box.w * 0.92) / bw, (box.ay * 0.9) / bh) * (ref.scale || 1);
  if (opts.minBody > 0) k = Math.max(k, Math.min(opts.minBody / bh, (box.w * 0.98) / bw));
  const cx = (b[0] + b[2] + 1) / 2;
  const ox = box.ax - cx * k;
  const oy = box.ay - (b[3] + 1) * k;
  return { w: Math.round(box.w), h: Math.round(box.h), ax: box.ax, ay: box.ay, k, ox, oy };
}

function unitBounds(id, left) {
  const u = state.units[id] || {};
  return (u.rows && u.rows[left ? 'left' : 'right']) || u.b || null;
}

function paintUnit(canvas, imgs, ref, id, o) {
  const g = ctx2d(canvas);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const left = o.facing === -1 || o.facing === 'left';
  const L = packUnitLayout(ref, unitBounds(id, left), id, o);
  const row = left ? ref.rows.left : ref.rows.right;
  const frames = animFrames(ref, o.state);
  const col = frames[packFrameIndex(frames.length, o.state, o)];
  if (o.playerColor !== undefined && o.playerColor !== null) {
    g.save();
    g.globalAlpha = 0.85;
    g.strokeStyle = playerColorHex(o.playerColor);
    g.lineWidth = Math.max(1.5, L.h / 40);
    g.beginPath();
    g.ellipse(L.ax, L.ay, Math.min(L.w * 0.42, L.h * 0.4), L.h * 0.08, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  for (const img of imgs) {
    g.drawImage(img, col * ref.fw, row * ref.fh, ref.fw, ref.fh, L.ox, L.oy, ref.fw * L.k, ref.fh * L.k);
  }
  if (o.state === 'dead' || o.state === 'death') {
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(40,30,30,0.45)';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.restore();
  }
}

// ---- terrain -----------------------------------------------------------------------------------

/** World tile coordinates for a terrain tile (info.seed 'x,y,z' from the map view, else pixels). */
export function tileCoords(x, y, size, info) {
  const s = info && typeof info.seed === 'string' ? info.seed.split(',') : null;
  if (s && s.length >= 2 && s.every((v) => /^-?\d+$/.test(v))) return [Number(s[0]), Number(s[1])];
  return [Math.round(x / size), Math.round(y / size)];
}

/** Draw the texture region of world tile (tx, ty) into ctx at (x, y, size). */
function drawTexRegion(ctx, img, ref, tx, ty, x, y, size) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const t = TEXELS_PER_TILE;
  const sx = (((tx * t) % iw) + iw) % iw;
  const sy = (((ty * t) % ih) + ih) % ih;
  const sw = Math.min(t, iw - sx);
  const sh = Math.min(t, ih - sy);
  const k = size / t;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, sw * k, sh * k);
  // wrap (texture sizes are multiples of TEXELS_PER_TILE, so this only runs for odd sizes)
  if (sw < t) ctx.drawImage(img, 0, sy, t - sw, sh, x + sw * k, y, (t - sw) * k, sh * k);
  if (sh < t) ctx.drawImage(img, sx, 0, sw, t - sh, x, y + sh * k, sw * k, (t - sh) * k);
}

/** Texture image for a terrain id, or null (not mapped / not loaded yet -> procedural). */
function terrainImage(terrain) {
  if (!state.ready) return null;
  const ref = TERRAIN_TEXTURES[terrain];
  if (!ref || !state.files[ref.file] || state.broken.has(`terrain|${terrain}`)) return null;
  const img = requestImage(ref.file, (loaded) => { if (!loaded) state.broken.add(`terrain|${terrain}`); });
  return img ? { img, ref } : null;
}

/** Apply the mapping's colour adjustments to the region just drawn at (x, y, size). */
function adjust(ctx, ref, x, y, size) {
  if (!ref.tint && !ref.shade) return;
  ctx.save();
  if (ref.tint) {
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = ref.tintAlpha ?? 0.4;
    ctx.fillStyle = ref.tint;
    ctx.fillRect(x, y, size, size);
  }
  if (ref.shade) {
    ctx.globalCompositeOperation = ref.shadeMode || 'multiply';
    ctx.globalAlpha = ref.shadeAlpha ?? 0.3;
    ctx.fillStyle = ref.shade;
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

/**
 * Terrain hook used by gfx terrain.js `drawTerrainTile`:
 * - base(): paints the ground texture for the tile; false -> procedural base.
 * - edge(): paints a transition fringe of `terrain` using the procedural edge canvas as alpha
 *   mask and the neighbour's texture as fill; false -> procedural edge.
 */
export const terrainPackPainter = {
  base(ctx, x, y, size, terrain, info) {
    const t = terrainImage(terrain);
    if (!t) return false;
    const [tx, ty] = tileCoords(x, y, size, info);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    drawTexRegion(ctx, t.img, t.ref, tx, ty, x, y, size);
    ctx.restore();
    adjust(ctx, t.ref, x, y, size);
    return true;
  },
  edge(ctx, x, y, size, terrain, edgeCanvas, info, kind) {
    const t = terrainImage(terrain);
    if (!t || !edgeCanvas) return false;
    const [tx, ty] = tileCoords(x, y, size, info);
    // masked fringes repeat with the texture period: cache them per (edge canvas, texture offset)
    const iw = t.img.naturalWidth || t.img.width;
    const ih = t.img.naturalHeight || t.img.height;
    const px = Math.max(1, Math.round(iw / TEXELS_PER_TILE));
    const py = Math.max(1, Math.round(ih / TEXELS_PER_TILE));
    const key = `${terrain}|${size}|${((tx % px) + px) % px},${((ty % py) + py) % py}`;
    let perEdge = state.fringes.get(edgeCanvas);
    if (!perEdge) { perEdge = new Map(); state.fringes.set(edgeCanvas, perEdge); }
    let s = perEdge.get(key);
    if (s) {
      ctx.drawImage(s, x, y);
      if (kind === 'shore') {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.drawImage(edgeCanvas, x, y);
        ctx.restore();
      }
      return true;
    }
    s = state.env.createCanvas(size, size);
    perEdge.set(key, s);
    const g = s.getContext('2d');
    g.save();
    g.clearRect(0, 0, size, size);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(edgeCanvas, 0, 0, size, size);
    g.globalCompositeOperation = 'source-atop';
    g.imageSmoothingEnabled = true;
    drawTexRegion(g, t.img, t.ref, tx, ty, 0, 0, size);
    g.restore();
    if (t.ref.tint || t.ref.shade) {
      // colour adjustments only where the fringe is
      g.save();
      g.globalCompositeOperation = 'source-atop';
      adjust(g, t.ref, 0, 0, size);
      g.restore();
    }
    ctx.drawImage(s, x, y);
    if (kind === 'shore') {
      // keep the procedural surf line on coasts: lay the procedural shore over the texture, faded
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(edgeCanvas, x, y);
      ctx.restore();
    }
    return true;
  },
  /** True when the texture for `terrain` is loaded (for callers that want to wait). */
  ready(terrain) { return terrainImage(terrain) !== null; },
};

/** Start loading every terrain texture (the map view redraws on onPackSpriteReady). */
export function preloadTerrainTextures() {
  if (!state.ready) return;
  for (const id of Object.keys(TERRAIN_TEXTURES)) terrainImage(id);
}

// ------------------------------------------------------------------------------------------------
// Public sprite API
// ------------------------------------------------------------------------------------------------

function cacheKey(kind, id, o, ref) {
  if (ref && ref.mode) {
    // generated stills: one picture whatever the frame / time / state (except town levels)
    return `${kind}|${id}|${ref.file}|${ref.mode === 'building' ? ref.faction : ''}|${o.size ?? ''}|${o.facing ?? ''}|${ref.flag || ref.mode === 'unit' ? o.playerColor ?? '' : ''}|${o.state === 'dead' || o.state === 'death' ? 'dead' : ''}|${o.box ? `${o.box.w},${o.box.h},${o.box.ax},${o.box.ay}` : ''}|${o.minBody ?? ''}`;
  }
  const box = o.box ? `${o.box.w},${o.box.h},${o.box.ax},${o.box.ay}` : '';
  const t = typeof o.time === 'number' ? `t${Math.floor(o.time * PACK_FPS)}` : `f${o.frame ?? ''}/${o.frames ?? ''}`;
  return `${kind}|${id}|${o.size ?? ''}|${o.state ?? ''}|${t}|${o.facing ?? ''}|${o.playerColor ?? ''}|${box}|${o.minBody ?? ''}|${o.variant ?? ''}`;
}

function remember(key, canvas) {
  state.cache.set(key, canvas);
  if (state.cache.size > state.maxCache) state.cache.delete(state.cache.keys().next().value);
}

// ---- generated stills (docs/mechanics/generated-art.md) ------------------------------------------

const OBJECT_TILE = 32;

/** Canvas geometry of a generated picture for (kind, ref, opts). */
export function genLayout(kind, id, ref, o = {}) {
  if (ref.mode === 'object') {
    const def = ref.def || MAP_OBJECT_BY_ID[id] || { size: [1, 1] };
    const [tw, th] = def.size;
    const t = Math.max(1, Math.round(o.size > 0 ? o.size : OBJECT_TILE));
    const w = tw * t; const h = th * t;
    return { w, h, ax: (Math.floor(tw / 2) + 0.5) * t, ay: h, tile: t };
  }
  if (ref.mode === 'building') {
    const L = getTownLayout(ref.faction)[id] || { w: 80, h: 70 };
    const h = Math.max(4, Math.round(o.size > 0 ? o.size : L.h));
    return { w: Math.max(4, Math.round((h * L.w) / L.h)), h, ax: 0, ay: 0 };
  }
  if (ref.mode === 'backdrop') {
    const h = Math.max(4, Math.round(o.size > 0 ? o.size : 374));
    return { w: Math.round((h * 800) / 374), h, ax: 0, ay: 0 };
  }
  if (ref.mode === 'siege') {
    // same box as the procedural siege piece: height = size, natural aspect, anchor bottom-centre
    const [bw, bh] = ref.box;
    const h = Math.max(4, Math.round(o.size > 0 ? o.size : bh));
    const w = Math.max(4, Math.round((h * bw) / bh));
    return { w, h, ax: w / 2, ay: h };
  }
  // unit / boat: the creature contract (feet at (w/2, 0.92h)), square box
  const size = Math.max(4, Math.round(o.size > 0 ? o.size : kind === 'hero' ? 64 : 96));
  const box = o.box || { w: size, h: size, ax: size / 2, ay: Math.round(size * 0.92) };
  return { w: Math.round(box.w), h: Math.round(box.h), ax: box.ax, ay: box.ay };
}

/** Fit an image (iw x ih) into a box: contain, horizontally centred, standing on the box bottom. */
export function fitBottom(iw, ih, bw, bh, fill = 1) {
  const k = Math.min((bw * fill) / iw, (bh * fill) / ih);
  const dw = iw * k; const dh = ih * k;
  return { dx: (bw - dw) / 2, dy: bh - dh, dw, dh, k };
}

function paintGenerated(canvas, img, ref, kind, id, o) {
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const L = genLayout(kind, id, ref, o);
  if (ref.mode === 'backdrop') {
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return;
  }
  if (ref.mode === 'object') {
    const f = fitBottom(iw, ih, L.w, L.h, ref.fill || 1);
    // small pick-ups stand on the entrance tile, a little above its bottom edge
    const lift = (ref.fill || 1) < 1 ? L.tile * 0.06 : 0;
    g.drawImage(img, f.dx, f.dy - lift, f.dw, f.dh);
    if (ref.flag && o.playerColor !== undefined && o.playerColor !== null) {
      const s = L.tile / OBJECT_TILE;
      g.save();
      g.scale(s, s);
      if (ref.town) drawFlag(g, (L.w / s) * 0.5 + 10, (L.h / s) * 0.3, (L.h / s) * 0.3, playerColorHex(o.playerColor), 1, 0);
      else drawFlag(g, 6, Math.min(L.h / s - 4, 26), 18, playerColorHex(o.playerColor), 1, 0);
      g.restore();
    }
    return;
  }
  if (ref.mode === 'building' || ref.mode === 'siege') {
    const f = fitBottom(iw, ih, L.w, L.h, 1);
    g.drawImage(img, f.dx, f.dy, f.dw, f.dh);
    return;
  }
  // unit / boat: fill ~90% of the box width or the height above the feet
  const k = Math.min((L.w * 0.9) / iw, (L.ay * 0.95) / ih);
  let kk = k;
  if (o.minBody > 0) kk = Math.max(k, Math.min(o.minBody / ih, (L.w * 0.98) / iw));
  const dw = iw * kk; const dh = ih * kk;
  const left = o.facing === -1 || o.facing === 'left';
  if (ref.mode === 'unit' && o.playerColor !== undefined && o.playerColor !== null) {
    g.save();
    g.globalAlpha = 0.85;
    g.strokeStyle = playerColorHex(o.playerColor);
    g.lineWidth = Math.max(1.5, L.h / 40);
    g.beginPath();
    g.ellipse(L.ax, L.ay, Math.min(L.w * 0.42, L.h * 0.4), L.h * 0.08, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  g.save();
  if (left) { g.translate(L.w, 0); g.scale(-1, 1); }
  const x = left ? L.w - L.ax - dw / 2 : L.ax - dw / 2;
  g.drawImage(img, x, L.ay - dh, dw, dh);
  g.restore();
  if (o.state === 'dead' || o.state === 'death') {
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(40,30,30,0.5)';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.restore();
  }
}

/**
 * Synchronous pack sprite. Kinds: artifact, resource (icons), creature (war machines), terrain
 * (base tile only: numeric `variant`; edges/roads/rivers stay procedural -> null), and the
 * generated stills: object, building, town (backdrop), hero (boat).
 * @returns {HTMLCanvasElement|OffscreenCanvas|null}
 */
export function getPackSprite(kind, id, opts) {
  const o = opts || {};
  if (kind === 'terrain' && o.variant !== undefined && typeof o.variant !== 'number') return null;
  const ref = refFor(kind, id, o);
  if (!ref) return null;
  // terrain tiles are only handed out once the texture is there (the caller then has the
  // procedural tile meanwhile, never a blank one)
  if (kind === 'terrain' && !requestImage(ref.file)) return null;
  const key = cacheKey(kind, id, o, ref);
  const hit = state.cache.get(key);
  if (hit) { state.cache.delete(key); state.cache.set(key, hit); return hit; }

  let canvas;
  let paint;
  if (ref.mode) {
    const L = genLayout(kind, id, ref, o);
    canvas = state.env.createCanvas(L.w, L.h);
    paint = (imgs) => paintGenerated(canvas, imgs[0], ref, kind, id, o);
  } else if (kind === 'creature') {
    const L = packUnitLayout(ref, unitBounds(id, o.facing === -1 || o.facing === 'left'), id, o);
    canvas = state.env.createCanvas(L.w, L.h);
    paint = (imgs) => paintUnit(canvas, imgs, ref, id, o);
  } else if (kind === 'terrain') {
    const size = Math.max(4, Math.round(o.size > 0 ? o.size : 32));
    canvas = state.env.createCanvas(size, size);
    paint = (imgs) => {
      const g = ctx2d(canvas);
      g.imageSmoothingEnabled = true;
      const v = (o.variant | 0) & 3;
      drawTexRegion(g, imgs[0], ref, v & 1 ? 1 : 0, v & 2 ? 1 : 0, 0, 0, size);
      adjust(g, ref, 0, 0, size);
    };
  } else if (ref.layers) {
    // war machine shown as an icon (artifact slot): side view standing in a square box
    const size = iconSize(kind, o);
    canvas = state.env.createCanvas(size, size);
    const uo = { size, box: { w: size, h: size, ax: size / 2, ay: Math.round(size * 0.86) } };
    paint = (imgs) => paintUnit(canvas, imgs, ref, ref.unit, uo);
  } else {
    const size = iconSize(kind, o);
    canvas = state.env.createCanvas(size, size);
    paint = (imgs) => paintIcon(canvas, imgs[0], ref, kind, o);
  }
  remember(key, canvas);
  const imgs = requestAll(filesOf(ref), (loaded) => {
    if (loaded) paint(loaded);
    else if (ref.mode) state.broken.add(ref.file);
    else state.broken.add(`${kind}|${id}`);
  });
  if (imgs) paint(imgs);
  return canvas;
}

/** Anchor / size of getPackSprite's canvas (null when unmapped). */
export function getPackSpriteInfo(kind, id, opts) {
  const o = opts || {};
  if (kind === 'terrain' && o.variant !== undefined && typeof o.variant !== 'number') return null;
  const ref = refFor(kind, id, o);
  if (!ref) return null;
  if (ref.mode) {
    const L = genLayout(kind, id, ref, o);
    return { width: L.w, height: L.h, scale: 1, anchorX: Math.round(L.ax), anchorY: Math.round(L.ay), frames: 1 };
  }
  if (kind === 'creature') {
    const L = packUnitLayout(ref, unitBounds(id, o.facing === -1 || o.facing === 'left'), id, o);
    return { width: L.w, height: L.h, anchorX: Math.round(L.ax), anchorY: Math.round(L.ay), frames: animFrames(ref, o.state).length };
  }
  const size = kind === 'terrain' ? Math.max(4, Math.round(o.size > 0 ? o.size : 32)) : iconSize(kind, o);
  return { width: size, height: size, anchorX: 0, anchorY: 0, frames: 1 };
}

/** Animation length for a state (war machines), null when not a pack unit. */
export function getPackAnimationInfo(kind, id, gameState = 'idle') {
  if (kind !== 'creature') return null;
  const ref = refFor(kind, id);
  if (!ref) return null;
  const s = normState(gameState);
  if (ref.mode) return { frames: 1, fps: PACK_FPS, loop: !NON_LOOPING.has(s), anim: s };
  return { frames: animFrames(ref, s).length, fps: PACK_FPS, loop: !NON_LOOPING.has(s), anim: s };
}

/** URL of a pack sound for an event the Duelyst map lacks (works before initPacks: no manifest needed). */
export function getPackSfxUrl(event, opts = {}) {
  const rel = PACK_SFX[event];
  if (!rel) return null;
  const base = opts.baseUrl ?? state.baseUrl;
  return (base.endsWith('/') ? base : `${base}/`) + rel;
}

/** URL of any pack file (gallery). */
export function packUrl(rel) { return urlOf(rel); }
