// Canvas helpers: DPR-aware canvas, pan/zoom camera, pointer mapping, hit-testing, hex/grid maths.
// The pure maths (camera, hex, hit regions) has no DOM dependency and is unit-tested.
import { h, clamp } from './dom.js';

/**
 * Create a canvas of logical size w x h whose backing store honours devicePixelRatio.
 * Draw in logical units: the context is pre-scaled.
 * @returns {{ canvas, ctx, width, height, dpr, resize(w, h), clear() }}
 */
export function createCanvas(width, height, opts = {}) {
  const canvas = h('canvas', { class: opts.class });
  const out = { canvas, ctx: null, width, height, dpr: 1 };
  out.resize = (w, hh) => {
    const dpr = opts.dpr ?? Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    out.width = w;
    out.height = hh;
    out.dpr = dpr;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hh * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hh}px`;
    out.ctx = canvas.getContext('2d');
    if (out.ctx && out.ctx.setTransform) out.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (out.ctx && opts.pixelated) out.ctx.imageSmoothingEnabled = false;
  };
  out.clear = () => { if (out.ctx) out.ctx.clearRect(0, 0, out.width, out.height); };
  out.resize(width, height);
  return out;
}

/**
 * Pointer position in the canvas' LOGICAL coordinates, correct under the stage's CSS scale.
 * `logicalWidth` defaults to the canvas CSS width (style.width) or its backing width.
 */
export function eventPos(canvas, e, logicalWidth, logicalHeight) {
  const r = canvas.getBoundingClientRect();
  const lw = logicalWidth ?? (parseFloat(canvas.style.width) || canvas.width);
  const lh = logicalHeight ?? (parseFloat(canvas.style.height) || canvas.height);
  const sx = r.width ? lw / r.width : 1;
  const sy = r.height ? lh / r.height : 1;
  return { x: ((e.clientX || 0) - r.left) * sx, y: ((e.clientY || 0) - r.top) * sy };
}

/**
 * 2D pan/zoom camera (pure). `x, y` = world coordinates of the view's top-left corner.
 *   const cam = createCamera({ viewW: 960, viewH: 640, worldW: 72 * 32, worldH: 72 * 32 });
 *   cam.apply(ctx); ...draw world...; ctx.restore() is up to you (apply does save()).
 */
export function createCamera(opts = {}) {
  const cam = {
    x: opts.x ?? 0, y: opts.y ?? 0, zoom: opts.zoom ?? 1,
    minZoom: opts.minZoom ?? 0.25, maxZoom: opts.maxZoom ?? 4,
    viewW: opts.viewW ?? 800, viewH: opts.viewH ?? 600,
    worldW: opts.worldW ?? Infinity, worldH: opts.worldH ?? Infinity,
    margin: opts.margin ?? 0,
  };
  cam.clampToWorld = () => {
    const vw = cam.viewW / cam.zoom;
    const vh = cam.viewH / cam.zoom;
    if (Number.isFinite(cam.worldW)) {
      cam.x = cam.worldW + 2 * cam.margin <= vw ? (cam.worldW - vw) / 2 : clamp(cam.x, 0 - cam.margin, cam.worldW + cam.margin - vw);
    }
    if (Number.isFinite(cam.worldH)) {
      cam.y = cam.worldH + 2 * cam.margin <= vh ? (cam.worldH - vh) / 2 : clamp(cam.y, 0 - cam.margin, cam.worldH + cam.margin - vh);
    }
    return cam;
  };
  cam.worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom });
  cam.screenToWorld = (sx, sy) => ({ x: sx / cam.zoom + cam.x, y: sy / cam.zoom + cam.y });
  /** Pan by screen pixels. */
  cam.panBy = (dx, dy) => { cam.x -= dx / cam.zoom; cam.y -= dy / cam.zoom; return cam.clampToWorld(); };
  cam.centerOn = (wx, wy) => { cam.x = wx - cam.viewW / cam.zoom / 2; cam.y = wy - cam.viewH / cam.zoom / 2; return cam.clampToWorld(); };
  cam.center = () => ({ x: cam.x + cam.viewW / cam.zoom / 2, y: cam.y + cam.viewH / cam.zoom / 2 });
  /** Zoom keeping the world point under screen (sx, sy) fixed. */
  cam.zoomAt = (factor, sx = cam.viewW / 2, sy = cam.viewH / 2) => {
    const before = cam.screenToWorld(sx, sy);
    cam.zoom = clamp(cam.zoom * factor, cam.minZoom, cam.maxZoom);
    cam.x = before.x - sx / cam.zoom;
    cam.y = before.y - sy / cam.zoom;
    return cam.clampToWorld();
  };
  cam.setView = (w, hh) => { cam.viewW = w; cam.viewH = hh; return cam.clampToWorld(); };
  /** Visible world rectangle {x, y, w, h}. */
  cam.visibleRect = () => ({ x: cam.x, y: cam.y, w: cam.viewW / cam.zoom, h: cam.viewH / cam.zoom });
  /** Range of grid cells intersecting the view: {x0, y0, x1, y1} inclusive, clamped to cols/rows. */
  cam.visibleCells = (cell, cols = Infinity, rows = Infinity) => {
    const r = cam.visibleRect();
    return {
      x0: Math.max(0, Math.floor(r.x / cell)), y0: Math.max(0, Math.floor(r.y / cell)),
      x1: Math.min(cols - 1, Math.floor((r.x + r.w) / cell)), y1: Math.min(rows - 1, Math.floor((r.y + r.h) / cell)),
    };
  };
  /** ctx.save() + transform so that subsequent drawing is in world coordinates. */
  cam.apply = (ctx) => { ctx.save(); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x, -cam.y); };
  return cam.clampToWorld();
}

/** Grid cell under a screen point: { x, y } (integers; may be out of bounds - check yourself). */
export function cellAt(cam, sx, sy, cellSize) {
  const w = cam.screenToWorld(sx, sy);
  return { x: Math.floor(w.x / cellSize), y: Math.floor(w.y / cellSize) };
}

export function pointInRect(px, py, r) {
  return px >= r.x && py >= r.y && px < r.x + r.w && py < r.y + r.h;
}

/**
 * Hit-region list for canvas UIs. Later regions are on top.
 *   const hits = createHitRegions();  hits.clear();  hits.add({ x, y, w, h }, { type: 'stack', id });
 *   const data = hits.at(mouse.x, mouse.y);          // topmost region's data or null
 * A region may also be a circle `{ cx, cy, r }` or a polygon `{ points: [[x, y], ...] }`.
 */
export function createHitRegions() {
  const regions = [];
  return {
    regions,
    clear() { regions.length = 0; },
    add(shape, data) { regions.push({ shape, data }); },
    at(x, y) {
      for (let i = regions.length - 1; i >= 0; i--) if (hitShape(regions[i].shape, x, y)) return regions[i].data;
      return null;
    },
    all(x, y) { return regions.filter((r) => hitShape(r.shape, x, y)).map((r) => r.data).reverse(); },
  };
}

export function hitShape(s, x, y) {
  if (s.points) return pointInPolygon(x, y, s.points);
  if (s.r != null) return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r;
  return pointInRect(x, y, s);
}

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- hex grid (combat field: pointy-top hexes, odd rows shifted right, offset coords) ----------

/**
 * Hex layout for the battlefield. `size` = hex width in px; rows are `size * 0.75 * (2/sqrt(3))`
 * apart... simplified here to width `w` and row pitch `rowH` chosen by the caller.
 *   const hex = createHexLayout({ w: 44, rowH: 38, originX: 60, originY: 90 });
 *   hex.center(col, row) -> {x, y};  hex.at(px, py) -> {x: col, y: row};  hex.polygon(col, row)
 */
export function createHexLayout({ w = 44, rowH = 38, originX = 0, originY = 0 } = {}) {
  const hexH = rowH * 4 / 3;       // full height of a pointy-top hex with this row pitch
  const layout = { w, rowH, hexH, originX, originY };
  layout.center = (col, row) => ({
    x: originX + col * w + ((row & 1) ? w / 2 : 0) + w / 2,
    y: originY + row * rowH + hexH / 2,
  });
  layout.polygon = (col, row) => {
    const c = layout.center(col, row);
    const hw = w / 2;
    const hh = hexH / 2;
    return [[c.x, c.y - hh], [c.x + hw, c.y - hh / 2], [c.x + hw, c.y + hh / 2],
      [c.x, c.y + hh], [c.x - hw, c.y + hh / 2], [c.x - hw, c.y - hh / 2]];
  };
  /** Hex under a pixel (nearest centre among the candidates around the rough row/col). */
  layout.at = (px, py) => {
    const row0 = Math.floor((py - originY) / rowH);
    let best = null;
    let bestD = Infinity;
    for (let row = row0 - 1; row <= row0 + 1; row++) {
      const col0 = Math.floor((px - originX - ((row & 1) ? w / 2 : 0)) / w);
      for (let col = col0 - 1; col <= col0 + 1; col++) {
        const c = layout.center(col, row);
        const d = (c.x - px) ** 2 + (c.y - py) ** 2;
        if (d < bestD) { bestD = d; best = { x: col, y: row }; }
      }
    }
    return best;
  };
  return layout;
}

/**
 * Wire mouse panning (drag with `button`, default middle/right-less left drag) and wheel zoom to
 * a camera. Returns a detach function. `onChange()` is called after every camera change;
 * `onClick(pos, event)` when the pointer went down and up without dragging.
 */
export function enablePanZoom(canvas, cam, opts = {}) {
  const button = opts.button ?? 0;
  const threshold = opts.threshold ?? 5;
  let drag = null;
  const pos = (e) => eventPos(canvas, e, cam.viewW, cam.viewH);
  const down = (e) => {
    if (e.button !== button) return;
    const p = pos(e);
    drag = { x: p.x, y: p.y, moved: false };
  };
  const move = (e) => {
    if (!drag) return;
    const p = pos(e);
    if (!drag.moved && Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) < threshold) return;
    if (opts.pan === false) { drag.moved = true; return; }
    cam.panBy(p.x - drag.x, p.y - drag.y);
    drag.x = p.x;
    drag.y = p.y;
    drag.moved = true;
    if (opts.onChange) opts.onChange(cam);
  };
  const up = (e) => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    if (!wasDrag && opts.onClick && e.target === canvas) opts.onClick(pos(e), e);
  };
  const wheel = (e) => {
    if (opts.zoom === false) return;
    if (e.preventDefault) e.preventDefault();
    const p = pos(e);
    cam.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    if (opts.onChange) opts.onChange(cam);
  };
  canvas.addEventListener('mousedown', down);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return () => {
    canvas.removeEventListener('mousedown', down);
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    canvas.removeEventListener('wheel', wheel);
  };
}
