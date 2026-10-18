// Minimap canvas widget. The owner supplies the drawing: `draw(ctx, width, height)`.
import { h } from './dom.js';
import { createCanvas, eventPos } from './canvas.js';

/**
 * Minimap({ width = 180, height = 180, draw(ctx, w, h),
 *           onNavigate?(fx, fy)   // click / drag position as fractions 0..1 of the map
 *           viewport?: { x, y, w, h } fractions of the map shown as a rectangle })
 * API: .redraw(), .setViewport(rect | null), .canvas, .ctx
 */
export function Minimap(opts = {}) {
  const width = opts.width || 180;
  const height = opts.height || 180;
  const cv = createCanvas(width, height, { class: 'k-minimap-canvas' });
  const el = h('div.k-minimap.k-frame', { class: opts.class, style: { width, height } }, cv.canvas);
  let viewport = opts.viewport || null;
  let dragging = false;

  el.redraw = () => {
    const ctx = cv.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    try { if (opts.draw) opts.draw(ctx, width, height); } catch (err) { console.error('[Minimap] draw failed', err); }
    if (viewport) {
      ctx.save();
      ctx.strokeStyle = '#ffe9a6';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(viewport.x * width + 0.5, viewport.y * height + 0.5, Math.max(2, viewport.w * width), Math.max(2, viewport.h * height));
      ctx.restore();
    }
  };
  el.setViewport = (rect) => { viewport = rect; el.redraw(); };

  const nav = (e) => {
    if (!opts.onNavigate) return;
    const p = eventPos(cv.canvas, e, width, height);
    opts.onNavigate(Math.max(0, Math.min(1, p.x / width)), Math.max(0, Math.min(1, p.y / height)));
  };
  const up = () => { dragging = false; };
  cv.canvas.addEventListener('mousedown', (e) => { if (e.button === 0 || e.button == null) { dragging = true; nav(e); } });
  cv.canvas.addEventListener('mousemove', (e) => { if (dragging) nav(e); });
  window.addEventListener('mouseup', up);
  el.destroy = () => window.removeEventListener('mouseup', up);
  el.canvas = cv.canvas;
  el.ctx = cv.ctx;
  el.redraw();
  return el;
}
