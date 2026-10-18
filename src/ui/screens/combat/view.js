// Combat screen: the battlefield view model and its canvas renderer. The view model is what is
// drawn (positions in pixels, displayed counts, animation states); the engine state is only read
// to (re)synchronise it, so animations can show the past while the engine is already ahead.
import { CANVAS_W, CANVAS_H, HEX, UNIT_SIZE, HERO_POS, HERO_SIZE, FIELD_W, FIELD_H, feetOf, footprint, badgeKind, BADGE_COLORS } from './model.js';
import { TERRAIN_DATA } from '../../../data/terrain.js';
import { HERO_BY_ID } from '../../../data/heroes.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';

// ---- view model -------------------------------------------------------------------------------------

/** Create an empty view model. */
export function createView() {
  return {
    stacks: new Map(),             // id -> view stack
    obstacleAlpha: new Map(),      // obstacle id -> alpha (fade in)
    effects: [], texts: [], projectiles: [],
    banner: null,
    activeId: null,
    hover: null,                   // { hex, mouse, highlight, cursor }
    shadow: [], zone: [], targets: [],
    heroes: { attacker: { state: 'idle', t0: 0 }, defender: { state: 'idle', t0: 0 } },
    time: 0,
    busy: false,
  };
}

const sideFacing = (side) => (side === 'attacker' ? 1 : -1);

function makeViewStack(layout, s) {
  const f = feetOf(layout, s);
  return {
    id: s.id, side: s.side, creatureId: s.creatureId, size: s.size || 1,
    x: f.x, y: f.y, dx: 0, dy: 0, count: s.count, alive: s.alive, alpha: 1,
    state: s.alive ? 'idle' : 'dead', t0: -1e6, facing: sideFacing(s.side), flash: 0,
    summoned: !!s.summoned, clone: !!s.clone, warMachine: !!s.warMachine,
  };
}

/** Bring the view in line with the engine state (after animations, on mount). */
export function syncView(view, cs, layout) {
  const ids = new Set();
  for (const s of cs.stacks) {
    ids.add(s.id);
    let v = view.stacks.get(s.id);
    if (!v) { v = makeViewStack(layout, s); view.stacks.set(s.id, v); continue; }
    const f = feetOf(layout, s);
    Object.assign(v, { x: f.x, y: f.y, dx: 0, dy: 0, count: s.count, side: s.side, size: s.size || 1, creatureId: s.creatureId, facing: sideFacing(s.side) });
    if (s.alive && !v.alive) { v.alive = true; v.state = 'idle'; v.alpha = 1; }
    if (!s.alive && v.alive) { v.alive = false; v.state = 'dead'; v.t0 = -1e6; }
    if (s.alive) { v.alpha = 1; if (v.state !== 'idle') v.state = 'idle'; }
    if (!s.alive && (s.summoned || s.clone)) v.alpha = 0;
  }
  for (const id of [...view.stacks.keys()]) if (!ids.has(id)) view.stacks.delete(id);
  for (const o of cs.obstacles || []) if (!view.obstacleAlpha.has(o.id)) view.obstacleAlpha.set(o.id, 1);
  view.activeId = cs.phase === 'battle' ? cs.active : null;
}

/** Ensure a view stack exists for an engine stack (summons appear mid-playback). */
export function ensureViewStack(view, cs, layout, stack) {
  let v = view.stacks.get(stack.id);
  if (!v) { v = makeViewStack(layout, stack); view.stacks.set(stack.id, v); }
  return v;
}

// ---- sprite helpers ------------------------------------------------------------------------------------

/**
 * Sprite services for the renderer: geometry + frame counts from gfx (and Duelyst) when present,
 * placeholder-safe drawing through ctx.drawSprite.
 */
export function createSpriteKit(ctx, duelyst = null) {
  const geom = new Map();
  const frames = new Map();
  const gfx = () => (ctx.gfx && ctx.gfx.module) || null;
  return {
    info(kind, id, size, extra = null) {
      const key = `${kind}|${id}|${size}${extra ? `|${extra.minBody}|${extra.box.w}x${extra.box.h}` : ''}`;
      let g = geom.get(key);
      if (g) return g;
      g = null;
      const m = gfx();
      if (m && typeof m.getSpriteInfo === 'function') {
        try {
          const i = m.getSpriteInfo(kind, id, { size, ...(extra || {}) });
          if (i && i.width > 0) g = { w: i.width, h: i.height, ax: i.anchorX, ay: i.anchorY };
        } catch { g = null; }
      }
      if (!g) g = { w: size, h: size, ax: size / 2, ay: size * 0.92 };
      geom.set(key, g);
      return g;
    },
    /** { frames, fps } of an animation state. */
    anim(kind, id, state) {
      const key = `${kind}|${id}|${state}`;
      let a = frames.get(key);
      if (a) return a;
      a = null;
      if (duelyst && typeof duelyst.getAnimationInfo === 'function') {
        try { const d = duelyst.getAnimationInfo(kind, id, state); if (d && d.frames > 0 && duelyst.isDuelystReady && duelyst.isDuelystReady()) a = { frames: d.frames, fps: d.fps || 12 }; } catch { a = null; }
      }
      if (!a) {
        const m = gfx();
        let n = 1;
        if (m && typeof m.getFrameCount === 'function') { try { n = m.getFrameCount(kind, id, state) || 1; } catch { n = 1; } }
        a = { frames: n, fps: state === 'idle' ? 5 : 10 };
      }
      frames.set(key, a);
      return a;
    },
    draw(g, kind, id, x, y, opts) { ctx.drawSprite(g, kind, id, x, y, opts); },
    reset() { geom.clear(); frames.clear(); },
  };
}

// ---- background ----------------------------------------------------------------------------------------

function seeded(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}
function hashStr(s) { let x = 7; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }

/** Procedural battlefield backdrop (terrain colours, horizon band, seeded patches). */
export function paintProceduralBackground(g, terrain) {
  const t = TERRAIN_DATA.find((x) => x.id === terrain) || TERRAIN_DATA[0];
  const cols = (t && t.colors) || ['#5a7a3a', '#4a6a2a', '#6a8a4a'];
  const sky = g.createLinearGradient(0, 0, 0, 90);
  sky.addColorStop(0, '#1c2430');
  sky.addColorStop(1, shadeHex(cols[0], -0.35));
  g.fillStyle = sky;
  g.fillRect(0, 0, CANVAS_W, 90);
  const ground = g.createLinearGradient(0, 60, 0, CANVAS_H);
  ground.addColorStop(0, shadeHex(cols[0], -0.15));
  ground.addColorStop(1, shadeHex(cols[1] || cols[0], -0.3));
  g.fillStyle = ground;
  g.fillRect(0, 60, CANVAS_W, CANVAS_H - 60);
  const r = seeded(hashStr(terrain || 'grass'));
  for (let i = 0; i < 140; i++) {
    const c = cols[i % cols.length];
    g.globalAlpha = 0.08 + r() * 0.12;
    g.fillStyle = shadeHex(c, r() * 0.3 - 0.15);
    g.beginPath();
    g.ellipse(r() * CANVAS_W, 70 + r() * (CANVAS_H - 70), 20 + r() * 70, 6 + r() * 20, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function shadeHex(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex || '#555';
  const n = parseInt(m[1], 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const r = f((n >> 16) & 255); const gg = f((n >> 8) & 255); const b = f(n & 255);
  return `#${((r << 16) | (gg << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Where the walkable floor of each Duelyst arena lies, as a fraction [x0, y0, x1, y1] of the 16:9
 * frame both arena layers are cover-fitted into. The arena is scaled and moved so this floor covers
 * the 15x11 hex field (the art is painted for Duelyst's much smaller 9x5 board). Keyed by a
 * substring of the midground URL. `tint` recolours the floor (battlemap5's board is a blue pool,
 * which reads as water on a grass battle).
 */
export const ARENA_FLOORS = [
  { match: 'battlemap5_', floor: [0.27, 0.27, 0.72, 0.73], tint: { color: '#4f7a34', alpha: 0.78, rect: [0.29, 0.30, 0.70, 0.70] } },
  { match: 'battlemap0_', floor: [0.19, 0.22, 0.81, 0.83], shape: 'ellipse' },
  { match: 'battlemap1_', floor: [0.19, 0.27, 0.86, 0.97] },
  { match: 'battlemap2_', floor: [0.16, 0.16, 0.88, 0.88] },
  { match: 'battlemap3_', floor: [0.20, 0.22, 0.80, 0.82] },
  { match: 'battlemap4_', floor: [0.28, 0.26, 0.94, 0.86] },
  { match: 'battlemap7_', floor: [0.16, 0.27, 0.86, 0.95] },
  { match: 'battlemap6_', floor: [0.10, 0.26, 0.90, 0.95] },
  { match: 'shimzar/', floor: [0.13, 0.13, 0.81, 0.79], shape: 'ellipse' },
  { match: 'vanar/', floor: [0.21, 0.26, 0.93, 0.82], shape: 'ellipse' },
  { match: 'redrock/', floor: [0.12, 0.25, 0.86, 0.95], shape: 'ellipse' },
  { match: 'abyssian/', floor: [0.15, 0.22, 0.85, 0.92] },
];
const FRAME_W = 1280;
const FRAME_H = 720;

/** The hex field's bounding box in canvas pixels. */
export function fieldRect(hex = HEX) {
  const hexH = (hex.rowH * 4) / 3;
  return { x: hex.originX, y: hex.originY, w: hex.w * (FIELD_W + 0.5), h: hex.rowH * (FIELD_H - 1) + hexH };
}

/**
 * Transform { s, tx, ty } that maps the 16:9 arena frame onto the canvas so the arena floor
 * covers the hex field, never leaving the canvas uncovered.
 */
export function arenaTransform(floor, field = fieldRect(), shape = 'rect') {
  const [x0, y0, x1, y1] = floor || [0, 0, 1, 1];
  const fw = Math.max(0.05, x1 - x0) * FRAME_W;
  const fh = Math.max(0.05, y1 - y0) * FRAME_H;
  // rectangular floors: cover the field's bounding box; elliptical floors (round arenas): scale until
  // the field's corners sit on the ellipse (8% tolerance - the corner hexes may touch the rim)
  const fit = shape === 'ellipse'
    ? Math.hypot(field.w / fw, field.h / fh) / 1.08
    : Math.max(field.w / fw, field.h / fh);
  let s = Math.max(fit, CANVAS_W / FRAME_W, CANVAS_H / FRAME_H);
  s = Math.min(s, 2.4);
  const cx = ((x0 + x1) / 2) * FRAME_W;
  const cy = ((y0 + y1) / 2) * FRAME_H;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const tx = clamp(field.x + field.w / 2 - cx * s, CANVAS_W - FRAME_W * s, 0);
  const ty = clamp(field.y + field.h / 2 - cy * s, CANVAS_H - FRAME_H * s, 0);
  return { s, tx, ty };
}

function arenaFor(url) {
  return ARENA_FLOORS.find((a) => String(url || '').includes(a.match)) || null;
}

/** Darken everything outside the hex field (soft edge) so the units and the grid read first. */
function paintVignette(g, layout) {
  g.save();
  g.beginPath();
  g.rect(0, 0, CANVAS_W, CANVAS_H);
  const f = fieldRect();
  const r = 26;
  g.moveTo(f.x + r, f.y);
  g.arcTo(f.x + f.w, f.y, f.x + f.w, f.y + f.h, r);
  g.arcTo(f.x + f.w, f.y + f.h, f.x, f.y + f.h, r);
  g.arcTo(f.x, f.y + f.h, f.x, f.y, r);
  g.arcTo(f.x, f.y, f.x + f.w, f.y, r);
  g.closePath();
  if ('filter' in g) g.filter = 'blur(18px)';
  g.fillStyle = 'rgba(8, 6, 4, 0.34)';
  g.fill('evenodd');
  g.restore();
  // a faint edge darkening of the whole frame
  const vg = g.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.55, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = vg;
  g.fillRect(0, 0, CANVAS_W, CANVAS_H);
  void layout;
}

/**
 * Background holder: Duelyst battlefield layers when the images load, procedural otherwise.
 * The arena is fitted so its floor covers the hex field and pre-rendered once (2x for crispness).
 * `draw(g)` paints the back layers, `drawFront(g)` the foreground decorations.
 */
export function createBackground(terrain, duelyst, onReady) {
  const bg = { images: [], front: [], cache: null, arenaCache: null, terrain, arena: null };
  let pending = 0;
  if (duelyst && typeof duelyst.getBattlefieldLayers === 'function' && typeof globalThis.Image === 'function') {
    try {
      const layers = duelyst.getBattlefieldLayers(terrain);
      bg.arena = arenaFor(layers.midground);
      const load = (url, list, counted) => {
        if (!url) return;
        const img = new globalThis.Image();
        const entry = { img, ok: false, done: false };
        if (counted) pending++;
        const settle = (ok) => { entry.ok = ok; entry.done = true; bg.arenaCache = null; if (onReady) onReady(); };
        img.onload = () => settle(true);
        img.onerror = () => settle(false);
        img.src = url;
        list.push(entry);
      };
      load(layers.background, bg.images, true);
      load(layers.midground, bg.images, true);
      for (const f of layers.foreground || []) load(f, bg.front, false);
    } catch { /* procedural */ }
  }
  void pending;
  const coverFrame = (g, img) => {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const s = Math.max(FRAME_W / iw, FRAME_H / ih);
    g.drawImage(img, (FRAME_W - iw * s) / 2, (FRAME_H - ih * s) / 2, iw * s, ih * s);
  };
  const paintArena = (g, loaded) => {
    const t = arenaTransform(bg.arena ? bg.arena.floor : null, fieldRect(), bg.arena ? bg.arena.shape : 'rect');
    g.save();
    g.translate(t.tx, t.ty);
    g.scale(t.s, t.s);
    for (const e of loaded) coverFrame(g, e.img);
    const tint = bg.arena && bg.arena.tint;
    if (tint) {
      const [x0, y0, x1, y1] = tint.rect;
      g.globalCompositeOperation = 'color';
      g.globalAlpha = tint.alpha;
      if ('filter' in g) g.filter = 'blur(10px)';
      g.fillStyle = tint.color;
      g.fillRect(x0 * FRAME_W, y0 * FRAME_H, (x1 - x0) * FRAME_W, (y1 - y0) * FRAME_H);
      g.globalCompositeOperation = 'soft-light';
      g.globalAlpha = tint.alpha * 0.6;
      g.fillRect(x0 * FRAME_W, y0 * FRAME_H, (x1 - x0) * FRAME_W, (y1 - y0) * FRAME_H);
    }
    g.restore();
    paintVignette(g);
  };
  bg.draw = (g) => {
    const loaded = bg.images.filter((e) => e.ok);
    if (loaded.length) {
      const allDone = bg.images.every((e) => e.done);
      if (allDone && !bg.arenaCache && typeof document !== 'undefined') {
        try {
          const c = document.createElement('canvas');
          c.width = CANVAS_W * 2; c.height = CANVAS_H * 2;
          const cg = c.getContext('2d');
          if (cg) { cg.scale(2, 2); paintArena(cg, loaded); bg.arenaCache = c; }
        } catch { bg.arenaCache = null; }
      }
      if (bg.arenaCache) g.drawImage(bg.arenaCache, 0, 0, CANVAS_W, CANVAS_H);
      else paintArena(g, loaded);
      return;
    }
    if (!bg.cache && typeof document !== 'undefined') {
      try {
        const c = document.createElement('canvas');
        c.width = CANVAS_W; c.height = CANVAS_H;
        const cg = c.getContext('2d');
        if (cg) { paintProceduralBackground(cg, terrain); paintVignette(cg); bg.cache = c; }
      } catch { bg.cache = null; }
    }
    if (bg.cache) g.drawImage(bg.cache, 0, 0);
    else paintProceduralBackground(g, terrain);
  };
  // Duelyst foreground layers are small corner props (e.g. 589x449) that the original game places
  // with per-map offsets we do not have; stretched over the canvas they hid the whole battlefield.
  // They are loaded (cheap) but not drawn.
  bg.drawFront = () => {};
  return bg;
}

// ---- drawing -------------------------------------------------------------------------------------------

function hexPath(g, layout, h, inset = 0) {
  const pts = layout.polygon(h.x, h.y);
  const c = layout.center(h.x, h.y);
  g.beginPath();
  pts.forEach(([x, y], i) => {
    const px = inset ? c.x + (x - c.x) * (1 - inset) : x;
    const py = inset ? c.y + (y - c.y) * (1 - inset) : y;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  });
  g.closePath();
}

function fillHexes(g, layout, hexes, fill, stroke = null, inset = 0.04) {
  for (const h of hexes || []) {
    hexPath(g, layout, h, inset);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 2; g.stroke(); }
  }
}

function pieceState(p) {
  if (!p) return 'intact';
  if (typeof p.state === 'string' && ['intact', 'damaged', 'destroyed'].includes(p.state)) return p.state;
  if (p.destroyed || (typeof p.hp === 'number' && p.hp <= 0)) return 'destroyed';
  if (typeof p.hp === 'number' && typeof p.maxHp === 'number' && p.hp < p.maxHp) return 'damaged';
  return 'intact';
}

/** Drawable siege pieces from `cs.siege` (defensive about the exact shape). */
export function siegePieces(cs) {
  const s = cs.siege;
  if (!s) return { ground: [], standing: [] };
  const ground = [];
  const standing = [];
  const hexOf = (p) => (p.hexes && p.hexes[0]) || p.pos || p.hex || null;
  const moatHexes = (s.moat && (s.moat.hexes || [])) || [];
  for (const h of moatHexes) ground.push({ kind: 'moat', hex: h, state: 'intact' });
  for (const w of s.walls || []) {
    const hexes = w.hexes && w.hexes.length ? w.hexes : [hexOf(w)].filter(Boolean);
    for (const h of hexes) standing.push({ kind: 'wall', hex: h, state: pieceState(w), id: w.id });
  }
  for (const h of s.fixed || []) standing.push({ kind: 'wall', hex: h, state: 'intact', id: null });
  if (s.gate) {
    const h = (s.gate.hexes && s.gate.hexes[0]) || hexOf(s.gate);
    if (h) standing.push({ kind: 'gate', hex: h, state: s.gate.open && pieceState(s.gate) === 'intact' ? 'damaged' : pieceState(s.gate), id: s.gate.id || 'gate', open: !!s.gate.open });
  }
  for (const t of s.towers || []) {
    const h = t.pos || hexOf(t);
    standing.push({ kind: t.kind === 'keep' ? 'keep' : 'tower', hex: h || null, state: pieceState(t), id: t.id });
  }
  return { ground, standing };
}

const CURSOR_GLYPH = {
  move: '\u{1F462}', fly: '\u{1F54A}', shoot: '\u{1F3F9}', spell: '✨', heal: '✚', info: '?', select: '☝', blocked: '⦸',
};

function drawCursor(g, c, x, y) {
  if (!c || c.type === 'default') return;
  g.save();
  g.translate(x, y);
  if (c.type === 'attack') {
    // sword pointing along the attack direction
    g.rotate(((c.angle || 0) * Math.PI) / 180);
    g.fillStyle = '#e8e8f0';
    g.strokeStyle = '#1a1208';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(14, 0); g.lineTo(-6, -3); g.lineTo(-6, 3); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = '#c8a040';
    g.fillRect(-9, -7, 3, 14);
    g.fillStyle = '#6a4020';
    g.fillRect(-16, -2, 7, 4);
  } else if (c.type === 'shoot' || c.type === 'shoot_half') {
    g.rotate(-Math.PI / 4);
    g.strokeStyle = '#2a1a0a';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(-14, 0); g.lineTo(c.type === 'shoot_half' ? -2 : 12, 0); g.stroke();
    if (c.type === 'shoot_half') { g.beginPath(); g.moveTo(3, 3); g.lineTo(12, 0); g.stroke(); }
    g.fillStyle = '#d8d8e0';
    g.beginPath(); g.moveTo(16, 0); g.lineTo(9, -4); g.lineTo(9, 4); g.closePath(); g.fill();
  } else {
    g.font = 'bold 18px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = c.type === 'blocked' ? '#e05040' : '#fff4d0';
    g.strokeStyle = '#000';
    g.lineWidth = 3;
    const t = CURSOR_GLYPH[c.type] || '';
    g.strokeText(t, 0, 0);
    g.fillText(t, 0, 0);
  }
  g.restore();
}

function frameFor(kit, kind, id, state, elapsedMs) {
  const a = kit.anim(kind, id, state);
  const f = Math.floor((Math.max(0, elapsedMs) / 1000) * a.fps);
  if (state === 'idle' || state === 'move') return a.frames > 0 ? f % a.frames : 0;
  return Math.min(a.frames - 1, f);
}

/** Height of a battlefield hex (pointy-top, rows overlap by a quarter). */
export const HEX_H = (HEX.rowH * 4) / 3;

/**
 * Body height a creature should reach on the battlefield, relative to the hex: 1-hex units about
 * 1.3x (tier 1) to 1.8x (tier 7) the hex height, 2-hex units 20% more. Duelyst sheets paint bodies
 * of very different sizes (26..67 px at the same scale), so this is a target, not a scale.
 */
export function stackBodyHeight(creatureId) {
  const c = CREATURE_BY_ID[creatureId];
  const tier = Math.max(1, Math.min(8, (c && c.tier) || 1));
  const two = !!c && c.size === 2;
  return Math.round(HEX_H * (1.3 + 0.08 * (tier - 1)) * (two ? 1.2 : 1));
}

/**
 * Canvas box + minimum body height for a battlefield creature: the box is wide and tall enough
 * that long weapons / wings are not clipped; the body is scaled to `stackBodyHeight`.
 */
export function stackSpriteOpts(creatureId, size = UNIT_SIZE) {
  const c = CREATURE_BY_ID[creatureId];
  const two = !!c && c.size === 2;
  const body = stackBodyHeight(creatureId);
  const h = Math.round(Math.max(size * 1.25, body * 1.55));
  const w = Math.round(HEX.w * (two ? 3.9 : 2.7));
  return { box: { w, h, ax: w / 2, ay: Math.round(h * 0.92) }, minBody: body, snap: true };
}

function drawStack(g, kit, view, v, opts) {
  const size = UNIT_SIZE;
  const extra = stackSpriteOpts(v.creatureId, size);
  const info = kit.info('creature', v.creatureId, size, extra);
  const x = v.x + v.dx;
  const y = v.y + v.dy;
  const state = v.alive ? v.state : 'dead';
  const elapsed = state === 'dead' && v.t0 < -1e5 ? 1e6 : view.time - v.t0;
  const frame = frameFor(kit, 'creature', v.creatureId, state === 'dead' ? 'dead' : state, state === 'idle' ? view.time + v.id * 137 : elapsed);
  g.globalAlpha = Math.max(0, Math.min(1, v.alpha * (v.alive ? 1 : 0.75)));
  if (v.alive) {
    // soft contact shadow so the unit stands on the floor
    const sw = (v.size > 1 ? HEX.w * 0.95 : HEX.w * 0.48);
    g.fillStyle = 'rgba(0, 0, 0, 0.32)';
    g.beginPath();
    g.ellipse(x, y - 2, sw, HEX_H * 0.17, 0, 0, Math.PI * 2);
    g.fill();
  }
  // pixel art: no smoothing, whole-pixel placement
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  kit.draw(g, 'creature', v.creatureId, Math.round(x - info.ax), Math.round(y - info.ay), { size, ...extra, facing: v.facing, state, frame, playerColor: opts.colorOf(v.side) });
  g.imageSmoothingEnabled = smooth;
  if (v.flash > 0) {
    const body = extra.minBody;
    g.globalAlpha = v.flash * 0.5;
    g.fillStyle = '#ff4030';
    g.beginPath();
    g.ellipse(x, y - body * 0.5, Math.min(info.w * 0.3, body * 0.45), body * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Count badge: at the stack's front foot, legible on any floor (dark plate, gold rim, 13px). */
function drawBadge(g, layout, v, stack) {
  if (!v.alive || v.count <= 0 || v.warMachine) return;
  const front = v.facing;
  const text = String(v.count);
  g.font = 'bold 13px Georgia, serif';
  const tw = g.measureText ? g.measureText(text).width : text.length * 8;
  const w = Math.max(26, Math.round(tw) + 12);
  const hh = 18;
  const bx = Math.round(v.x + v.dx + front * (v.size > 1 ? layout.w * 0.95 : layout.w * 0.46) - w / 2);
  const by = Math.round(v.y + v.dy - hh + 6);
  roundRect(g, bx, by, w, hh, 4);
  g.fillStyle = BADGE_COLORS[stack ? badgeKind(stack) : 'normal'];
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  g.stroke();
  roundRect(g, bx + 1.5, by + 1.5, w - 3, hh - 3, 3);
  g.lineWidth = 1;
  g.strokeStyle = '#e8c870';
  g.stroke();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, bx + w / 2, by + hh / 2 + 1);
}

/** Hero on the battlefield: a single figure on a stone plinth with a name plate. */
function drawHeroFigure(g, kit, view, cs, side, o) {
  const hero = cs.sides[side]?.hero;
  if (!hero) return;
  const pos = HERO_POS[side];
  const defId = o.heroDefOf ? o.heroDefOf(side) : hero.id;
  const hv = view.heroes[side];
  const st = hv.state || 'idle';
  const frame = frameFor(kit, 'hero', defId, st, st === 'idle' ? view.time : view.time - hv.t0);
  const fled = cs.sides[side].fled || cs.sides[side].surrendered;
  const color = o.colorOf(side);
  const pc = o.playerHex ? o.playerHex(color) : null;
  g.save();
  g.globalAlpha = fled ? 0.3 : 1;
  // plinth
  const px = pos.x; const py = pos.y;
  g.fillStyle = 'rgba(0, 0, 0, 0.45)';
  g.beginPath(); g.ellipse(px, py + 6, 50, 13, 0, 0, Math.PI * 2); g.fill();
  const pg = g.createLinearGradient(0, py - 10, 0, py + 8);
  pg.addColorStop(0, '#6d6252'); pg.addColorStop(1, '#2c261e');
  g.fillStyle = pg;
  g.beginPath(); g.ellipse(px, py, 44, 11, 0, 0, Math.PI * 2); g.fill();
  g.lineWidth = 2; g.strokeStyle = pc || '#c8a050'; g.stroke();
  g.lineWidth = 1; g.strokeStyle = 'rgba(255, 230, 160, 0.5)';
  g.beginPath(); g.ellipse(px, py - 1, 38, 8, 0, Math.PI, Math.PI * 2); g.stroke();
  // warm backlight separates the figure from busy arena art
  const glow = g.createRadialGradient(px, py - 46, 6, px, py - 46, 70);
  glow.addColorStop(0, 'rgba(255, 226, 160, 0.30)');
  glow.addColorStop(1, 'rgba(255, 226, 160, 0)');
  g.fillStyle = glow;
  g.fillRect(px - 72, py - 118, 144, 140);
  const info = kit.info('hero', defId, HERO_SIZE);
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  // many generals are painted dark (Abyssian / Magmar): lift them so they read against the arena
  if ('filter' in g) g.filter = 'brightness(1.22) saturate(1.1) drop-shadow(0 0 1px rgba(255, 236, 190, 0.85))';
  kit.draw(g, 'hero', defId, Math.round(px - info.ax), Math.round(py - info.ay), { size: HERO_SIZE, facing: sideFacing(side), state: st, frame, flag: false });
  if ('filter' in g) g.filter = 'none';
  g.imageSmoothingEnabled = smooth;
  // name plate
  g.font = 'bold 14px Georgia, serif';
  const name = hero.name || '';
  const tw = g.measureText ? g.measureText(name).width : name.length * 8;
  const w = Math.round(tw) + 26;
  const x0 = Math.round(px - w / 2);
  const y0 = Math.round(py + 16);
  roundRect(g, x0, y0, w, 22, 4);
  const ng = g.createLinearGradient(0, y0, 0, y0 + 22);
  ng.addColorStop(0, '#3a3024'); ng.addColorStop(1, '#16110b');
  g.fillStyle = ng; g.fill();
  g.lineWidth = 1.5; g.strokeStyle = '#c8a050'; g.stroke();
  g.fillStyle = pc || '#888';
  g.fillRect(x0 + 5, y0 + 5, 5, 12);
  g.fillStyle = '#f4e4b0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, px + 4, y0 + 12);
  g.restore();
}

/**
 * Paint one frame.
 * @param {CanvasRenderingContext2D} g
 * @param {Object} view view model
 * @param {Object} cs CombatState (obstacles, siege, effects for badges, heroes)
 * @param {Object} o { layout, kit, background, showGrid, shadow, cursorShadow, viewer, colorOf(side), heroDefOf(side), drawCursor }
 */
export function renderBattlefield(g, view, cs, o) {
  const { layout, kit } = o;
  g.clearRect(0, 0, CANVAS_W, CANVAS_H);
  if (o.background) o.background.draw(g); else paintProceduralBackground(g, cs.terrain);

  // grid & shadows
  const all = [];
  for (let y = 0; y < FIELD_H; y++) for (let x = 0; x < FIELD_W; x++) all.push({ x, y });
  if (o.showGrid) {
    // two-tone lines read on light and dark floors alike
    g.beginPath();
    for (const h of all) {
      layout.polygon(h.x, h.y).forEach(([x, y], i) => { if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.closePath();
    }
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255, 240, 200, 0.30)';
    g.stroke();
  }
  if (view.zone && view.zone.length) fillHexes(g, layout, view.zone, 'rgba(70, 150, 255, 0.22)', 'rgba(140, 200, 255, 0.5)');
  if (o.shadow && view.shadow && view.shadow.length) fillHexes(g, layout, view.shadow, 'rgba(0, 0, 0, 0.26)');
  if (view.targets && view.targets.length) fillHexes(g, layout, view.targets, null, 'rgba(200, 150, 255, 0.75)', 0.12);
  const active = view.activeId != null ? view.stacks.get(view.activeId) : null;
  const activeStack = active ? cs.stacks.find((s) => s.id === active.id) : null;
  if (activeStack && activeStack.alive && !view.busy) {
    const pulse = 0.55 + 0.35 * Math.sin(view.time / 180);
    fillHexes(g, layout, footprint(activeStack), `rgba(255, 220, 90, ${0.18 * pulse})`, `rgba(255, 225, 110, ${pulse})`, 0.08);
  }
  if (view.hover && view.hover.highlight && view.hover.highlight.length) {
    const spell = view.hover.cursor && view.hover.cursor.type === 'spell';
    fillHexes(g, layout, view.hover.highlight, spell ? 'rgba(170, 110, 255, 0.32)' : 'rgba(255, 235, 140, 0.30)', spell ? 'rgba(210, 170, 255, 0.8)' : 'rgba(255, 240, 160, 0.8)');
  } else if (o.cursorShadow && view.hover && view.hover.hex) {
    fillHexes(g, layout, [view.hover.hex], 'rgba(0, 0, 0, 0.18)');
  }

  // ground pieces (moat), corpses
  const pieces = siegePieces(cs);
  for (const p of pieces.ground) {
    const c = layout.center(p.hex.x, p.hex.y);
    kit.draw(g, 'obstacle', 'moat', c.x - 30, c.y - 8, { size: 30, variant: cs.siege?.faction, state: p.state });
  }
  const stackById = new Map(cs.stacks.map((s) => [s.id, s]));
  for (const v of view.stacks.values()) if (!v.alive && v.alpha > 0 && v.state === 'dead') drawStack(g, kit, view, v, o);

  // depth-sorted: obstacles, siege pieces, living stacks
  const items = [];
  for (const ob of cs.obstacles || []) {
    if (ob.hidden && ob.side !== o.viewer) continue;
    const a = view.obstacleAlpha.has(ob.id) ? view.obstacleAlpha.get(ob.id) : 1;
    for (const h of ob.hexes || []) {
      const c = layout.center(h.x, h.y);
      items.push({ y: c.y + 2, draw: () => {
        g.globalAlpha = a * (ob.hidden ? 0.5 : 1);
        kit.draw(g, 'obstacle', ob.kind, c.x - 32, c.y - 46, { size: 64, variant: cs.terrain });
        g.globalAlpha = 1;
      } });
    }
  }
  for (const p of pieces.standing) {
    if (!p.hex) continue;
    const c = layout.center(p.hex.x, p.hex.y);
    const size = p.kind === 'keep' ? 160 : p.kind === 'tower' ? 148 : 122;   // sized to the enlarged units
    const inf = kit.info('obstacle', p.kind, size);
    items.push({ y: c.y + 1, draw: () => kit.draw(g, 'obstacle', p.kind, c.x - inf.w / 2, c.y + layout.hexH * 0.3 - inf.h, { size, variant: cs.siege?.faction, state: p.state }) });
  }
  for (const v of view.stacks.values()) {
    if (!v.alive || v.alpha <= 0) continue;
    items.push({ y: v.y + v.dy, draw: () => drawStack(g, kit, view, v, o) });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();
  for (const v of view.stacks.values()) if (v.alpha > 0.5) drawBadge(g, layout, v, stackById.get(v.id));

  // heroes
  for (const side of ['attacker', 'defender']) drawHeroFigure(g, kit, view, cs, side, o);

  if (o.background) o.background.drawFront(g);

  // effects, projectiles, floating texts
  for (const fx of view.effects) {
    const a = kit.anim('effect', fx.id, 'cast');
    const n = Math.max(1, a.frames);
    const frame = Math.min(n - 1, Math.floor(fx.t * n));
    const size = fx.size || 96;
    g.globalAlpha = fx.alpha ?? 1;
    kit.draw(g, 'effect', fx.id, fx.x - size / 2, fx.y - size / 2, { size, frame, state: 'cast' });
    g.globalAlpha = 1;
  }
  for (const p of view.projectiles) {
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.angle || 0);
    kit.draw(g, 'effect', p.id, -24, -24, { size: 48 });
    g.restore();
  }
  for (const t of view.texts) {
    g.globalAlpha = Math.max(0, Math.min(1, t.alpha ?? 1));
    g.font = `bold ${t.size || 16}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    g.strokeStyle = '#000';
    g.strokeText(t.text, t.x, t.y);
    g.fillStyle = t.color || '#fff';
    g.fillText(t.text, t.x, t.y);
    g.globalAlpha = 1;
  }
  if (view.banner) {
    const b = view.banner;
    g.globalAlpha = Math.max(0, Math.min(1, b.alpha ?? 1));
    g.fillStyle = 'rgba(20, 12, 4, 0.75)';
    g.fillRect(CANVAS_W / 2 - 220, 150, 440, 56);
    g.strokeStyle = '#d8b060';
    g.lineWidth = 2;
    g.strokeRect(CANVAS_W / 2 - 220, 150, 440, 56);
    g.font = 'bold 28px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f8e0a0';
    g.fillText(b.text, CANVAS_W / 2, 179);
    g.globalAlpha = 1;
  }
  if (view.hover && view.hover.mouse && o.drawCursor !== false) drawCursor(g, view.hover.cursor, view.hover.mouse.x, view.hover.mouse.y);
}

/** Hero figure hit box (logical canvas coords). */
export function heroRect(side) {
  const p = HERO_POS[side];
  return { x: p.x - HERO_SIZE / 2, y: p.y - HERO_SIZE, w: HERO_SIZE, h: HERO_SIZE + 40 };
}

/** Hero definition id for a combat side (state hero → defId; falls back to the id). */
export function heroDefId(state, hero) {
  if (!hero) return null;
  const h = state && state.heroes ? state.heroes[hero.id] : null;
  const id = (h && h.defId) || hero.defId || hero.id;
  return HERO_BY_ID[id] ? id : (hero.name && HERO_BY_ID[String(hero.name).toLowerCase()] ? String(hero.name).toLowerCase() : id);
}

export { HEX };
