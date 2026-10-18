// Drawing kit shared by every procedural painter: canvas factory, deterministic per-id random,
// colour maths and a handful of outlined vector primitives. Nothing here touches the DOM directly
// except the default canvas factory.

import { createRng, rand } from '../core/rng.js';

// ---------------------------------------------------------------------------------------------
// Canvas factory
// ---------------------------------------------------------------------------------------------

function defaultFactory(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  throw new Error('gfx: no canvas implementation available - call setCanvasFactory(fn) first');
}

let factory = defaultFactory;

/** Install a `(width, height) -> canvas` factory (pass null to restore the browser default). */
export function setCanvasFactory(fn) {
  factory = fn || defaultFactory;
}

/** Create a canvas of at least 1x1 integer pixels through the installed factory. */
export function createCanvas(w, h) {
  return factory(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

// ---------------------------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------------------------

/** FNV-1a 32-bit string hash. */
export function hashStr(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Small seeded generator built on src/core/rng.js.
 * @returns {{ f: (a?: number, b?: number) => number, i: (a: number, b: number) => number,
 *   pick: <T>(arr: T[]) => T, chance: (p: number) => boolean }}
 */
export function seeded(key) {
  const rng = createRng(hashStr(key));
  rand(rng);
  const f = (a = 1, b) => (b === undefined ? rand(rng) * a : a + rand(rng) * (b - a));
  return {
    f,
    i: (a, b) => a + Math.floor(rand(rng) * (b - a + 1)),
    pick: (arr) => arr[Math.floor(rand(rng) * arr.length)],
    chance: (p) => rand(rng) < p,
  };
}

// ---------------------------------------------------------------------------------------------
// Colour helpers (all take/return '#rrggbb' unless noted)
// ---------------------------------------------------------------------------------------------

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

export function rgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

/** Mix two colours, t=0 -> a, t=1 -> b. */
export function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/** amt > 0 lightens towards white, amt < 0 darkens towards black (range -1..1). */
export function shade(c, amt) {
  return amt >= 0 ? mix(c, '#ffffff', amt) : mix(c, '#000000', -amt);
}

export function alpha(c, a) {
  const [r, g, b] = rgb(c);
  return `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
}

export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function toHsl(c) {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [(h + 360) % 360, Math.min(1, s), l];
}

/** Rotate hue by `deg`, scale saturation and add to lightness. */
export function tweak(c, deg = 0, sat = 1, light = 0) {
  const [h, s, l] = toHsl(c);
  return hsl(h + deg, Math.max(0, Math.min(1, s * sat)), Math.max(0, Math.min(1, l + light)));
}

export const INK = '#1c1512'; // default outline colour

// ---------------------------------------------------------------------------------------------
// Primitives. `g` is a CanvasRenderingContext2D already scaled to the painter's design grid.
// A falsy fill/stroke skips that pass.
// ---------------------------------------------------------------------------------------------

export function paint(g, fill, stroke = INK, lw = 1.6) {
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke && lw > 0) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
  }
}

/** Closed polygon from a flat [x0,y0,x1,y1,...] list. */
export function poly(g, pts, fill, stroke, lw) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  paint(g, fill, stroke, lw);
}

/** Smooth closed blob through the points (quadratic mid-point smoothing). */
export function blob(g, pts, fill, stroke, lw) {
  const n = pts.length / 2;
  const mx = (i) => (pts[(i % n) * 2] + pts[((i + 1) % n) * 2]) / 2;
  const my = (i) => (pts[(i % n) * 2 + 1] + pts[((i + 1) % n) * 2 + 1]) / 2;
  g.beginPath();
  g.moveTo(mx(n - 1), my(n - 1));
  for (let i = 0; i < n; i++) g.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], mx(i), my(i));
  g.closePath();
  paint(g, fill, stroke, lw);
}

export function ell(g, cx, cy, rx, ry, fill, stroke, lw, rot = 0) {
  g.beginPath();
  g.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
  paint(g, fill, stroke, lw);
}

export function circ(g, cx, cy, r, fill, stroke, lw) {
  g.beginPath();
  g.arc(cx, cy, Math.max(0.01, r), 0, Math.PI * 2);
  paint(g, fill, stroke, lw);
}

export function rect(g, x, y, w, h, fill, stroke, lw) {
  g.beginPath();
  g.rect(x, y, w, h);
  paint(g, fill, stroke, lw);
}

/** Rounded rectangle. */
export function rrect(g, x, y, w, h, r, fill, stroke, lw) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
  paint(g, fill, stroke, lw);
}

/** Open polyline. */
export function line(g, pts, color = INK, lw = 1.6) {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

/** Open smooth curve through points. */
export function curve(g, pts, color = INK, lw = 1.6) {
  const n = pts.length / 2;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i * 2] + pts[i * 2 + 2]) / 2;
    const my = (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2;
    g.quadraticCurveTo(pts[i * 2], pts[i * 2 + 1], mx, my);
  }
  g.lineTo(pts[n * 2 - 2], pts[n * 2 - 1]);
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

/**
 * A "limb": thick rounded polyline with a dark outline and a soft highlight. The workhorse of the
 * creature rigs (arms, legs, necks, tails, weapon shafts).
 */
export function limb(g, pts, color, width, outline = INK, smooth = false) {
  const draw = smooth && pts.length > 4 ? curve : line;
  if (outline) draw(g, pts, outline, width + 2.4);
  draw(g, pts, color, width);
  if (width >= 3) {
    g.save();
    g.translate(-width * 0.16, -width * 0.16);
    draw(g, pts, alpha(shade(color, 0.45), 0.55), width * 0.3);
    g.restore();
  }
}

/** Tapered limb (tails, necks): series of circles shrinking from w0 to w1 along a smooth path. */
export function taper(g, pts, color, w0, w1, outline = INK) {
  const n = pts.length / 2;
  const steps = Math.max(8, n * 6);
  const at = (t) => {
    const f = t * (n - 1);
    const i = Math.min(n - 2, Math.floor(f));
    const u = f - i;
    return [pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * u, pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * u];
  };
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 0 && !outline) continue;
    g.fillStyle = pass === 0 ? outline : color;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const [x, y] = at(t);
      const r = (w0 + (w1 - w0) * t) / 2 + (pass === 0 ? 1.2 : 0);
      g.beginPath();
      g.arc(x, y, Math.max(0.2, r), 0, Math.PI * 2);
      g.fill();
    }
  }
}

/** Vertical gradient light->base->dark, the standard "lit from above" body fill. */
export function vgrad(g, y0, y1, color, k = 0.28) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, shade(color, k));
  gr.addColorStop(0.55, color);
  gr.addColorStop(1, shade(color, -k));
  return gr;
}

/** Linear gradient from explicit stops [[t, color], ...]. */
export function lgrad(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c] of stops) gr.addColorStop(t, c);
  return gr;
}

/** Radial gradient from explicit stops. */
export function rgrad(g, cx, cy, r0, r1, stops) {
  const gr = g.createRadialGradient(cx, cy, r0, cx, cy, Math.max(r1, r0 + 0.01));
  for (const [t, c] of stops) gr.addColorStop(t, c);
  return gr;
}

/** Soft radial glow blob. */
export function glow(g, cx, cy, r, color, strength = 0.7) {
  g.fillStyle = rgrad(g, cx, cy, 0, r, [[0, alpha(color, strength)], [0.5, alpha(color, strength * 0.4)], [1, alpha(color, 0)]]);
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
}

/** N-pointed star / burst. */
export function star(g, cx, cy, r0, r1, n, fill, stroke, lw, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const r = i % 2 ? r1 : r0;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  poly(g, pts, fill, stroke, lw);
}

/** Ground contact shadow. */
export function shadow(g, cx, cy, rx, ry = rx * 0.28) {
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

/** Run `fn` with a translate/rotate/scale applied, restoring afterwards. */
export function at(g, x, y, rot, sx, sy, fn) {
  g.save();
  g.translate(x, y);
  if (rot) g.rotate(rot);
  if (sx !== 1 || sy !== 1) g.scale(sx, sy === undefined ? sx : sy);
  fn();
  g.restore();
}

/** Small flag on a pole; the cloth is `color`. Pole base at (x, y). */
export function flag(g, x, y, h, color, dir = 1, wave = 0) {
  line(g, [x, y, x, y - h], INK, 2.2);
  line(g, [x, y, x, y - h], '#c9b28a', 1);
  const w = h * 0.62;
  const t = y - h;
  const d = Math.sin(wave * 1.57) * h * 0.06;
  g.beginPath();
  g.moveTo(x, t);
  g.quadraticCurveTo(x + dir * w * 0.5, t - h * 0.1 + d, x + dir * w, t + h * 0.08 - d);
  g.lineTo(x + dir * w * 0.78, t + h * 0.24);
  g.lineTo(x + dir * w, t + h * 0.42 + d);
  g.quadraticCurveTo(x + dir * w * 0.5, t + h * 0.3 - d, x, t + h * 0.42);
  g.closePath();
  paint(g, color, INK, 1.2);
  circ(g, x, t - 1, 1.4, '#f2d36b', INK, 0.8);
}

export const TAU = Math.PI * 2;
export const rad = (deg) => (deg * Math.PI) / 180;
