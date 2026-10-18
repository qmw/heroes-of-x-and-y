// Duelyst (CC0) art layer: synchronous sprite canvases backed by lazily loaded sprite sheets.
// Spec: docs/mechanics/duelyst-assets.md. Browser + Node: image loading, JSON fetching and canvas
// creation are injectable (see initDuelyst / configureDuelyst).
//
//   await initDuelyst({ baseUrl, manifestUrl, onProgress })      // manifests only
//   getDuelystSprite(kind, id, opts) -> canvas | null              // sync; draws when the sheet arrives
//   onSpriteReady(fn) -> unsubscribe                               // redraw canvas-rendered screens
//   getAnimationInfo(kind, id, state) -> { frames, fps, loop } | null
//   hasDuelystSprite(kind, id)   preloadSprites(list)   getBattlefieldBackground(terrainId)
//   getPortraitUrl(heroId)   getPortraitCanvas(heroId, size)

import { unpackFrame } from './plist.js';
import { resolveSprite, BATTLEFIELDS, DEFAULT_BATTLEFIELD, CREATURE_SPRITES } from './mapping.js';
import { CREATURE_BY_ID } from '../../data/creatures.js';
import { TERRAIN_BY_ID } from '../../data/terrain.js';

export const DEFAULT_FPS = 12;
/** Game state -> Duelyst animation names, in order of preference. */
export const STATE_ANIMS = {
  idle: ['breathing', 'breathe', 'breath', 'idle'],
  flourish: ['idle', 'breathing'],
  move: ['run', 'move', 'movement', 'crawl', 'breathing', 'idle'],
  walk: ['run', 'move', 'movement', 'crawl', 'breathing', 'idle'],
  attack: ['attack', 'cast', 'idle'],
  shoot: ['attack', 'cast', 'idle'],
  cast: ['cast', 'castloop', 'castLoop', 'caststart', 'attack'],
  hit: ['hit', 'hurt', 'damage', 'breathing', 'idle'],
  defend: ['hit', 'hurt', 'damage', 'breathing', 'idle'],
  dead: ['death', 'die', 'death2'],
  death: ['death', 'die', 'death2'],
};
const NON_LOOPING = new Set(['attack', 'shoot', 'cast', 'hit', 'dead', 'death']);
const UNIT_KINDS = new Set(['creature', 'hero']);
const PLAYER_HEX = { red: '#d83a2c', blue: '#3564d8', tan: '#c8aa72', green: '#3fa544', orange: '#e8862a', purple: '#8e44c8', teal: '#2aa8a0', pink: '#e87ab8' };
const PLAYER_ORDER = ['red', 'blue', 'tan', 'green', 'orange', 'purple', 'teal', 'pink'];

const state = {
  ready: false,
  baseUrl: 'assets/duelyst/',
  manifests: { units: {}, icons: {}, fx: {} },
  images: new Map(), // url -> { status: 'loading'|'ok'|'error', img, waiters: Set<fn> }
  cache: new Map(), // key -> canvas (insertion order = LRU order)
  maxCache: 3000,
  broken: new Set(), // `${kind}|${id}` whose art failed to load
  listeners: new Set(),
  env: {
    loadImage: defaultLoadImage,
    fetchJson: defaultFetchJson,
    createCanvas: defaultCreateCanvas,
  },
};

function defaultLoadImage(url) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { reject(new Error('Image unavailable')); return; }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`duelyst: failed to load ${url}`));
    img.src = url;
  });
}
async function defaultFetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`duelyst: ${url} -> HTTP ${res.status}`);
  return res.json();
}
function defaultCreateCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('duelyst: no canvas implementation; call configureDuelyst({ createCanvas })');
}

/** Inject environment functions (tests, workers). Any omitted key keeps its current value. */
export function configureDuelyst({ loadImage, fetchJson, createCanvas, maxCache } = {}) {
  if (loadImage) state.env.loadImage = loadImage;
  if (fetchJson) state.env.fetchJson = fetchJson;
  if (createCanvas) state.env.createCanvas = createCanvas;
  if (maxCache) state.maxCache = maxCache;
}

/**
 * Load the JSON manifests (sheets themselves load lazily on first use).
 * @param {{ baseUrl?: string, manifestUrl?: string, onProgress?: (done:number,total:number)=>void,
 *           loadImage?: Function, fetchJson?: Function, createCanvas?: Function }} [o]
 */
export async function initDuelyst(o = {}) {
  configureDuelyst(o);
  const baseUrl = o.baseUrl ?? 'assets/duelyst/';
  const manifestUrl = o.manifestUrl ?? 'assets/duelyst-manifest/';
  const names = ['units', 'icons', 'fx'];
  let done = 0;
  const loaded = await Promise.all(names.map(async (n) => {
    const json = await state.env.fetchJson(`${manifestUrl}${n}.json`);
    done++;
    if (o.onProgress) o.onProgress(done, names.length);
    return [n, (json && json.sheets) || {}];
  }));
  state.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  state.manifests = Object.fromEntries(loaded);
  state.cache.clear();
  state.broken.clear();
  state.ready = true;
  return { units: Object.keys(state.manifests.units).length, icons: Object.keys(state.manifests.icons).length, fx: Object.keys(state.manifests.fx).length };
}

/** Forget everything (tests). */
export function resetDuelyst() {
  state.ready = false;
  state.manifests = { units: {}, icons: {}, fx: {} };
  state.images.clear();
  state.cache.clear();
  state.broken.clear();
  state.listeners.clear();
}

export function isDuelystReady() { return state.ready; }

/** Subscribe to "a sheet finished loading and canvases were redrawn". Returns an unsubscribe fn. */
export function onSpriteReady(listener) {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}
function notify(info) {
  for (const fn of [...state.listeners]) {
    try { fn(info); } catch (err) { if (typeof console !== 'undefined') console.error(err); }
  }
}

// ------------------------------------------------------------------------------------------------
// Resolution helpers
// ------------------------------------------------------------------------------------------------

function sheetOf(ref) {
  if (!ref) return null;
  if (ref.unit) return state.manifests.units[ref.unit] || null;
  if (ref.icon) return state.manifests.icons[ref.icon] || null;
  if (ref.fx) return state.manifests.fx[ref.fx] || null;
  return null;
}

function refFor(kind, id) {
  if (!state.ready || state.broken.has(`${kind}|${id}`)) return null;
  const ref = resolveSprite(kind, id);
  if (!ref) return null;
  if (ref.image) return ref;
  return sheetOf(ref) ? ref : null;
}

/** True when (kind, id) has Duelyst art and the layer is initialised. */
export function hasDuelystSprite(kind, id) {
  return refFor(kind, id) !== null;
}

/** Pick the animation (name + packed frames) of a sheet for a game state. */
export function pickAnimation(sheet, ref, gameState = 'idle') {
  const a = sheet.a;
  if (ref.fx || ref.icon) {
    if (ref.anim !== undefined && a[ref.anim]) return { name: ref.anim, frames: a[ref.anim] };
    if (a['']) return { name: '', frames: a[''] };
    let best = null;
    for (const [name, frames] of Object.entries(a)) if (!best || frames.length > best.frames.length) best = { name, frames };
    return best;
  }
  for (const name of STATE_ANIMS[gameState] || STATE_ANIMS.idle) if (a[name] && a[name].length) return { name, frames: a[name] };
  for (const name of STATE_ANIMS.idle) if (a[name] && a[name].length) return { name, frames: a[name] };
  const first = Object.entries(a).find(([, f]) => f.length);
  return first ? { name: first[0], frames: first[1] } : null;
}

function normState(s) {
  if (!s) return 'idle';
  return STATE_ANIMS[s] ? s : 'idle';
}

/**
 * Animation length for a state, so callers can cycle `opts.frame`.
 * @returns {{ frames: number, fps: number, loop: boolean, anim: string } | null}
 */
export function getAnimationInfo(kind, id, gameState = 'idle') {
  const ref = refFor(kind, id);
  if (!ref || ref.image) return ref ? { frames: 1, fps: DEFAULT_FPS, loop: false, anim: '' } : null;
  const s = normState(gameState);
  const anim = pickAnimation(sheetOf(ref), ref, s);
  if (!anim) return null;
  const loop = kind === 'effect' ? false : !NON_LOOPING.has(s);
  return { frames: anim.frames.length, fps: DEFAULT_FPS, loop, anim: anim.name };
}

/** Frame index for (state, opts.frame | opts.time) with looping / clamping rules. */
export function frameIndex(n, gameState, opts = {}) {
  if (n <= 1) return 0;
  let f;
  if (typeof opts.time === 'number') f = Math.floor(opts.time * DEFAULT_FPS);
  else if (opts.frame === undefined || opts.frame === null) f = gameState === 'dead' ? n - 1 : 0;
  else f = opts.frame | 0;
  if (opts.frames > 0 && opts.frame !== undefined) f = Math.floor(((f % opts.frames) + opts.frames) % opts.frames * n / opts.frames);
  if (gameState === 'dead' || gameState === 'death' || opts.clamp) return Math.max(0, Math.min(n - 1, f));
  return ((f % n) + n) % n;
}

// ------------------------------------------------------------------------------------------------
// Geometry (pure, unit-tested)
// ------------------------------------------------------------------------------------------------

/**
 * Where to copy a packed atlas frame from and where to put it inside the untrimmed frame box.
 * Rotated frames are stored 90deg clockwise in the sheet: the sheet region is h x w and must be
 * drawn rotated by -90deg.
 * @returns {{ sx, sy, sw, sh, dx, dy, dw, dh, rot }} sheet rect (sx..sh) and frame-space rect (dx..dh)
 */
export function frameRects(packed, fw, fh) {
  const f = unpackFrame(packed, fw, fh);
  return {
    sx: f.x, sy: f.y, sw: f.rot ? f.h : f.w, sh: f.rot ? f.w : f.h,
    dx: f.ox, dy: f.oy, dw: f.w, dh: f.h, rot: f.rot, fw: f.sw, fh: f.sh,
  };
}

/** Draw one atlas frame into ctx at frame-space origin (ox, oy) with uniform scale k. */
export function drawFrame(ctx, img, packed, fw, fh, ox, oy, k) {
  const r = frameRects(packed, fw, fh);
  if (!r.rot) {
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, ox + r.dx * k, oy + r.dy * k, r.dw * k, r.dh * k);
    return r;
  }
  ctx.save();
  // Destination top-left of the unrotated frame; rotate -90deg around it and draw the h x w region.
  ctx.translate(ox + r.dx * k, oy + (r.dy + r.dh) * k);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, r.sw * k, r.sh * k);
  ctx.restore();
  return r;
}

/**
 * Canvas box and placement for a unit sprite.
 * Matches the procedural creature contract: height = size, width = size (2*size for 2-hex
 * creatures), feet at (w/2, 0.92h). `opts.box = { w, h, ax, ay }` overrides it.
 * @returns {{ w, h, ax, ay, k, ox, oy }} canvas size, anchor, scale, frame-space origin
 */
export function unitLayout(sheet, ref, kind, id, opts = {}) {
  const size = Math.max(4, Math.round(opts.size > 0 ? opts.size : 96));
  const twoHex = kind === 'creature' && CREATURE_BY_ID[id] && CREATURE_BY_ID[id].size === 2;
  const box = opts.box || { w: twoHex ? size * 2 : size, h: size, ax: (twoHex ? size * 2 : size) / 2, ay: Math.round(size * 0.92) };
  const b = sheet.b || [0, 0, sheet.fw - 1, sheet.fh - 1];
  const bw = b[2] - b[0] + 1;
  const bh = b[3] - b[1] + 1;
  let k = (size / 64) * (ref.scale || 1) * (twoHex && !ref.scale ? 1.2 : 1);
  // opts.minBody: enlarge sprites whose painted body is short (Duelyst units vary 26..67 px tall at
  // the same scale), so a small sheet does not read as a speck next to its neighbours
  if (opts.minBody > 0) k = Math.max(k, opts.minBody / bh);
  k = Math.min(k, (box.ay * 0.98) / bh, box.w / Math.max(1, bw + Math.abs(sheet.fw / 2 - (b[0] + b[2]) / 2) * 2));
  // opts.snap: big enlargements use whole-pixel factors (2x, 3x) so every art pixel has the same size
  if (opts.snap && k >= 1.75) k = Math.min(3, Math.floor(k + 0.25));
  const ox = box.ax - (sheet.fw / 2) * k;
  const oy = box.ay - (b[3] + 1) * k;
  return { w: Math.round(box.w), h: Math.round(box.h), ax: box.ax, ay: box.ay, k, ox, oy };
}

/** Size of an icon/effect canvas (square unless opts.box). */
function squareLayout(sheet, opts, def) {
  const size = Math.max(4, Math.round(opts.size > 0 ? opts.size : def));
  const box = opts.box || { w: size, h: size, ax: size / 2, ay: size / 2 };
  const k = Math.min(box.w / sheet.fw, box.h / sheet.fh);
  return { w: Math.round(box.w), h: Math.round(box.h), ax: box.ax, ay: box.ay, k, ox: box.ax - (sheet.fw * k) / 2, oy: box.ay - (sheet.fh * k) / 2 };
}

export function playerColorHex(c) {
  if (typeof c === 'number') return PLAYER_HEX[PLAYER_ORDER[c]] || '#9a9a9a';
  if (typeof c === 'string' && c[0] === '#') return c;
  return PLAYER_HEX[c] || '#9a9a9a';
}

// ------------------------------------------------------------------------------------------------
// Image loading
// ------------------------------------------------------------------------------------------------

function urlOf(path) { return state.baseUrl + path; }

function requestImage(path, onDone) {
  const url = urlOf(path);
  let e = state.images.get(url);
  if (e && e.status === 'ok') return e.img;
  if (e && e.status === 'error') return null;
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

/** Image status for a path relative to baseUrl: 'ok' | 'loading' | 'error' | 'none'. */
export function imageStatus(path) {
  const e = state.images.get(urlOf(path));
  return e ? e.status : 'none';
}

/**
 * Start loading the sheets behind a list of sprites.
 * @param {Array<[string,string]|{kind:string,id:string}>} list
 * @returns {Promise<number>} number of images that loaded
 */
export function preloadSprites(list) {
  const paths = new Set();
  for (const it of list || []) {
    const [kind, id] = Array.isArray(it) ? it : [it.kind, it.id];
    const ref = refFor(kind, id);
    if (!ref) continue;
    paths.add(ref.image || sheetOf(ref).s);
  }
  return Promise.all([...paths].map((p) => new Promise((resolve) => {
    const img = requestImage(p, (loaded) => resolve(loaded ? 1 : 0));
    if (img) resolve(1);
  }))).then((r) => r.reduce((s, x) => s + x, 0));
}

// ------------------------------------------------------------------------------------------------
// Painting
// ------------------------------------------------------------------------------------------------

function ctx2d(canvas) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  return g;
}

function applyTint(canvas, tint, alpha) {
  if (!tint) return;
  const g = ctx2d(canvas);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = alpha ?? 0.35;
  g.fillStyle = tint;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.restore();
}

function drawPlayerRing(g, L, color) {
  const hex = playerColorHex(color);
  g.save();
  g.globalAlpha = 0.85;
  g.strokeStyle = hex;
  g.lineWidth = Math.max(1.5, L.h / 40);
  g.beginPath();
  g.ellipse(L.ax, L.ay, Math.min(L.w * 0.42, L.h * 0.4), L.h * 0.08, 0, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

function drawHeroFlag(g, L, color) {
  const hex = playerColorHex(color);
  const x = L.ax - L.w * 0.34;
  const top = L.h * 0.12;
  g.save();
  g.fillStyle = '#3a2a1a';
  g.fillRect(x, top, Math.max(1, L.h / 48), L.ay - top);
  g.fillStyle = hex;
  g.beginPath();
  g.moveTo(x, top);
  g.lineTo(x + L.h * 0.2, top + L.h * 0.06);
  g.lineTo(x, top + L.h * 0.12);
  g.closePath();
  g.fill();
  g.restore();
}

/** Paint a sheet-backed sprite into `canvas` (cleared first). */
function paintSheet(canvas, img, sheet, ref, kind, id, o) {
  const g = ctx2d(canvas);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const s = normState(o.state);
  const anim = pickAnimation(sheet, ref, s);
  if (!anim) return;
  const fi = frameIndex(anim.frames.length, kind === 'effect' ? 'dead' : s, kind === 'effect' ? { ...o, clamp: true } : o);
  const L = UNIT_KINDS.has(kind) ? unitLayout(sheet, ref, kind, id, o) : squareLayout(sheet, o, kind === 'effect' ? 96 : 48);
  if (UNIT_KINDS.has(kind) && o.playerColor !== undefined && o.playerColor !== null) drawPlayerRing(g, L, o.playerColor);
  if (kind === 'hero' && o.playerColor !== undefined && o.playerColor !== null && o.flag !== false) drawHeroFlag(g, L, o.playerColor);
  // Draw the unit on its own layer when tinted so the ring/flag keep their colour.
  const tint = o.tint || ref.tint;
  const layer = tint ? state.env.createCanvas(canvas.width, canvas.height) : canvas;
  const lg = ctx2d(layer);
  lg.save();
  // Duelyst art faces right. facing -1 (or 'left') mirrors; ref.flip inverts the default.
  const left = o.facing === -1 || o.facing === 'left';
  if (left !== Boolean(ref.flip)) { lg.translate(L.w, 0); lg.scale(-1, 1); }
  if (ref.alpha !== undefined) lg.globalAlpha = ref.alpha;
  drawFrame(lg, img, anim.frames[fi], sheet.fw, sheet.fh, left !== Boolean(ref.flip) ? L.w - L.ax - (L.ax - L.ox) : L.ox, L.oy, L.k);
  lg.restore();
  if (tint) {
    applyTint(layer, tint, o.tint ? o.tintAlpha ?? 0.35 : ref.tintAlpha);
    g.drawImage(layer, 0, 0);
  }
}

/** Paint a plain image (portraits, ui icons), cover-fitted. */
function paintImage(canvas, img, ref, o) {
  const g = ctx2d(canvas);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const iw = img.naturalWidth || img.width || canvas.width;
  const ih = img.naturalHeight || img.height || canvas.height;
  const cover = o.fit !== 'contain';
  const k = cover ? Math.max(canvas.width / iw, canvas.height / ih) : Math.min(canvas.width / iw, canvas.height / ih);
  const dw = iw * k; const dh = ih * k;
  const layer = ref.tint ? state.env.createCanvas(canvas.width, canvas.height) : canvas;
  const lg = ctx2d(layer);
  lg.imageSmoothingEnabled = true; // painted art, not pixel art
  lg.save();
  if (ref.flip) { lg.translate(canvas.width, 0); lg.scale(-1, 1); }
  lg.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  lg.restore();
  if (ref.tint) {
    applyTint(layer, ref.tint, ref.tintAlpha);
    g.drawImage(layer, 0, 0);
  }
  if (o.playerColor !== undefined && o.playerColor !== null && o.border !== false) {
    g.save();
    g.strokeStyle = playerColorHex(o.playerColor);
    g.lineWidth = Math.max(2, canvas.width / 24);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, canvas.width - g.lineWidth, canvas.height - g.lineWidth);
    g.restore();
  }
}

function drawPlaceholder(canvas, o) {
  const p = typeof o.placeholder === 'function' ? o.placeholder() : o.placeholder;
  if (!p) return;
  const g = ctx2d(canvas);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.drawImage(p, 0, 0, canvas.width, canvas.height);
}

function cacheKey(kind, id, o) {
  const box = o.box ? `${o.box.w},${o.box.h},${o.box.ax},${o.box.ay}` : '';
  const t = typeof o.time === 'number' ? `t${Math.floor(o.time * DEFAULT_FPS)}` : `f${o.frame ?? ''}/${o.frames ?? ''}`;
  return `${kind}|${id}|${o.size ?? ''}|${o.state ?? ''}|${t}|${o.facing ?? ''}|${o.playerColor ?? ''}|${o.tint ?? ''}|${box}|${o.fit ?? ''}|${o.flag ?? ''}|${o.minBody ?? ''}|${o.snap ? 1 : ''}`;
}

function remember(key, canvas) {
  state.cache.set(key, canvas);
  if (state.cache.size > state.maxCache) state.cache.delete(state.cache.keys().next().value);
}

/**
 * Synchronous Duelyst sprite.
 * @param {string} kind creature|hero|portrait|spell|artifact|skill|resource|stat|ui|effect
 * @param {string} id
 * @param {{ size?: number, frame?: number, frames?: number, time?: number, facing?: 1|-1|'left'|'right',
 *           playerColor?: string|number, state?: string, tint?: string, tintAlpha?: number,
 *           box?: {w:number,h:number,ax:number,ay:number}, placeholder?: any, flag?: boolean, fit?: 'cover'|'contain' }} [opts]
 * @returns {HTMLCanvasElement|OffscreenCanvas|null} null when unmapped or not initialised
 */
export function getDuelystSprite(kind, id, opts) {
  const o = opts || {};
  const ref = refFor(kind, id);
  if (!ref) return null;
  const key = cacheKey(kind, id, o);
  const hit = state.cache.get(key);
  if (hit) { state.cache.delete(key); state.cache.set(key, hit); return hit; }

  let canvas;
  let paint;
  let path;
  if (ref.image) {
    const size = Math.max(4, Math.round(o.size > 0 ? o.size : 64));
    const box = o.box || { w: size, h: size };
    canvas = state.env.createCanvas(Math.round(box.w), Math.round(box.h));
    path = ref.image;
    paint = (img) => paintImage(canvas, img, ref, o);
  } else {
    const sheet = sheetOf(ref);
    const L = UNIT_KINDS.has(kind) ? unitLayout(sheet, ref, kind, id, o) : squareLayout(sheet, o, kind === 'effect' ? 96 : 48);
    canvas = state.env.createCanvas(L.w, L.h);
    path = sheet.s;
    paint = (img) => paintSheet(canvas, img, sheet, ref, kind, id, o);
  }
  remember(key, canvas);
  const img = requestImage(path, (loaded) => {
    if (loaded) paint(loaded);
    else state.broken.add(`${kind}|${id}`);
  });
  if (img) paint(img);
  else drawPlaceholder(canvas, o);
  return canvas;
}

/** Anchor/size info matching getDuelystSprite's canvas (null when unmapped). */
export function getDuelystSpriteInfo(kind, id, opts) {
  const o = opts || {};
  const ref = refFor(kind, id);
  if (!ref) return null;
  if (ref.image) {
    const size = Math.max(4, Math.round(o.size > 0 ? o.size : 64));
    return { width: size, height: size, anchorX: 0, anchorY: 0, frames: 1 };
  }
  const sheet = sheetOf(ref);
  const L = UNIT_KINDS.has(kind) ? unitLayout(sheet, ref, kind, id, o) : squareLayout(sheet, o, kind === 'effect' ? 96 : 48);
  const anim = pickAnimation(sheet, ref, normState(o.state));
  return { width: L.w, height: L.h, anchorX: Math.round(L.ax), anchorY: Math.round(L.ay), frames: anim ? anim.frames.length : 1 };
}

// ------------------------------------------------------------------------------------------------
// Plain URLs
// ------------------------------------------------------------------------------------------------

/**
 * Battlefield art for an adventure terrain id (or a battlefield id such as 'ship').
 * @returns {string} URL of the arena layer (midground) - see getBattlefieldLayers for all layers
 */
export function getBattlefieldBackground(terrainId) {
  return getBattlefieldLayers(terrainId).midground;
}

/** @returns {{ background: string, midground: string, foreground: string[] }} absolute-ish URLs */
export function getBattlefieldLayers(terrainId) {
  const t = TERRAIN_BY_ID[terrainId];
  const bf = BATTLEFIELDS[terrainId] || (t && BATTLEFIELDS[t.battlefield]) || BATTLEFIELDS[DEFAULT_BATTLEFIELD];
  return { background: urlOf(bf.background), midground: urlOf(bf.midground), foreground: bf.foreground.map(urlOf) };
}

/** URL of the painted portrait behind a hero (flip/tint variants are applied by getPortraitCanvas). */
export function getPortraitUrl(heroDefId) {
  const ref = resolveSprite('portrait', heroDefId);
  return ref ? urlOf(ref.image) : null;
}

/** Portrait variant info: { url, flip, tint, tintAlpha } (for CSS consumers). */
export function getPortraitStyle(heroDefId) {
  const ref = resolveSprite('portrait', heroDefId);
  return ref ? { url: urlOf(ref.image), flip: Boolean(ref.flip), tint: ref.tint || null, tintAlpha: ref.tintAlpha || 0 } : null;
}

/** Portrait canvas with the hero's variant applied (works before init: portraits need no manifest). */
export function getPortraitCanvas(heroDefId, size = 64, opts = {}) {
  if (!resolveSprite('portrait', heroDefId)) return null;
  const wasReady = state.ready;
  state.ready = true; // portraits are plain images; no manifest required
  try { return getDuelystSprite('portrait', heroDefId, { ...opts, size }); } finally { state.ready = wasReady; }
}

/** URL for an arbitrary file in the Duelyst folder. */
export function duelystUrl(path) { return urlOf(path); }

/** The unit sheet name used for a creature (gallery / debugging). */
export function creatureUnitName(id) { return CREATURE_SPRITES[id] ? CREATURE_SPRITES[id].unit : null; }
