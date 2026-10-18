// Reusable structure / scenery painters shared by map objects, town buildings, combat obstacles and
// siege pieces. Everything is anchored at its ground point (x = centre, y = base line) and sized
// by explicit w/h so callers can use any design grid. `lw` is the outline width.

import { INK, alpha, blob, circ, curve, ell, glow, line, paint, poly, rect, rrect, shade, star, vgrad, lgrad } from './kit.js';

function bricks(g, x, y, w, h, color, r, n) {
  for (let i = 0; i < n; i++) {
    const bw = Math.max(1.5, w * 0.16);
    const bx = x + r.f(0.04, 0.8) * w;
    const by = y + r.f(0.06, 0.86) * h;
    rect(g, bx, by, Math.min(bw, x + w - bx - 0.5), Math.max(0.8, h * 0.06), color, null);
  }
}

/**
 * House: walls + roof + door + windows.
 * o: { wall, roof, roofKind: gable|hip|flat|thatch|dome|cone|pagoda|spike|tent, door, windows, glow,
 *      chimney, timber, lw, r (seeded rng), roofH (fraction of h) }
 */
export function house(g, x, y, w, h, o = {}) {
  const lw = o.lw || 1;
  const wall = o.wall || '#b8b0a0';
  const roof = o.roof || '#b0483a';
  const kind = o.roofKind || 'gable';
  const rh = h * (o.roofH || (kind === 'flat' ? 0.12 : kind === 'spike' || kind === 'cone' ? 0.55 : 0.42));
  const bh = h - rh;
  const x0 = x - w / 2;
  const top = y - bh;
  if (o.chimney) {
    rect(g, x + w * 0.2, top - rh * 0.8, w * 0.13, rh * 0.8, shade(wall, -0.2), INK, lw);
    if (o.smoke) for (let i = 0; i < 3; i++) circ(g, x + w * 0.27 + i * w * 0.05, top - rh * 0.95 - i * h * 0.1, w * (0.06 + i * 0.025), alpha('#d8d8d8', 0.55 - i * 0.14), null);
  }
  rect(g, x0, top, w, bh, vgrad(g, top, y, wall, 0.16), INK, lw);
  if (o.r) bricks(g, x0, top, w, bh, shade(wall, -0.13), o.r, o.bricks ?? 5);
  if (o.timber) {
    const tc = shade(wall, -0.5);
    line(g, [x0, top + bh * 0.5, x0 + w, top + bh * 0.5], tc, lw);
    line(g, [x0 + w * 0.3, top, x0 + w * 0.3, y, x0 + w * 0.7, top, x0 + w * 0.7, y], tc, lw);
  }
  const ov = w * 0.09;
  const rf = vgrad(g, top - rh, top, roof, 0.22);
  if (kind === 'gable' || kind === 'thatch') {
    poly(g, [x0 - ov, top + 0.5, x, top - rh, x0 + w + ov, top + 0.5], rf, INK, lw);
    if (kind === 'thatch') for (let i = 1; i < 5; i++) line(g, [x0 - ov + (w + 2 * ov) * (i / 5), top, x + (i - 2.5) * w * 0.05, top - rh * 0.8], shade(roof, -0.25), lw * 0.6);
    else line(g, [x0 - ov * 0.3, top - rh * 0.2, x0 + w + ov * 0.3, top - rh * 0.2], shade(roof, -0.25), lw * 0.6);
  } else if (kind === 'hip') {
    poly(g, [x0 - ov, top + 0.5, x0 + w * 0.22, top - rh, x0 + w * 0.78, top - rh, x0 + w + ov, top + 0.5], rf, INK, lw);
  } else if (kind === 'flat') {
    rect(g, x0 - ov * 0.5, top - rh, w + ov, rh, rf, INK, lw);
    for (let i = 0; i < 4; i++) rect(g, x0 + w * (0.04 + i * 0.26), top - rh * 1.9, w * 0.14, rh, wall, INK, lw);
  } else if (kind === 'dome') {
    g.beginPath();
    g.ellipse(x, top, w / 2 + ov * 0.4, rh, 0, Math.PI, Math.PI * 2);
    g.closePath();
    paint(g, rf, INK, lw);
    line(g, [x, top - rh, x, top - rh * 1.35], INK, lw);
    circ(g, x, top - rh * 1.4, w * 0.045, o.trim || '#e8c040', INK, lw * 0.7);
  } else if (kind === 'cone' || kind === 'spike') {
    const k = kind === 'spike' ? 0.5 : 1;
    poly(g, [x0 - ov * k, top + 0.5, x, top - rh, x0 + w + ov * k, top + 0.5], rf, INK, lw);
  } else if (kind === 'pagoda') {
    for (let i = 0; i < 2; i++) {
      const yy = top - i * rh * 0.5;
      const ww = w * (1 - i * 0.35);
      g.beginPath();
      g.moveTo(x - ww / 2 - ov * 1.6, yy + 1);
      g.quadraticCurveTo(x - ww * 0.3, yy - rh * 0.1, x - ww * 0.2, yy - rh * 0.5);
      g.lineTo(x + ww * 0.2, yy - rh * 0.5);
      g.quadraticCurveTo(x + ww * 0.3, yy - rh * 0.1, x + ww / 2 + ov * 1.6, yy + 1);
      g.closePath();
      paint(g, rf, INK, lw);
    }
  } else if (kind === 'tent') {
    poly(g, [x0 - ov, top + 0.5, x - w * 0.1, top - rh, x + w * 0.1, top - rh, x0 + w + ov, top + 0.5], rf, INK, lw);
  }
  // door + windows
  const dw = Math.min(w * 0.24, bh * 0.5);
  const dh = Math.min(bh * 0.62, dw * 1.7);
  if (o.door !== false) {
    g.beginPath();
    g.moveTo(x - dw / 2, y);
    g.lineTo(x - dw / 2, y - dh * 0.7);
    g.quadraticCurveTo(x, y - dh * 1.15, x + dw / 2, y - dh * 0.7);
    g.lineTo(x + dw / 2, y);
    g.closePath();
    paint(g, o.door || '#4a3020', INK, lw);
  }
  const nw = o.windows ?? (w > bh * 1.3 ? 2 : 0);
  for (let i = 0; i < nw; i++) {
    const side = i % 2 ? 1 : -1;
    const wx = x + side * w * (0.3 + Math.floor(i / 2) * 0.12);
    const wy = top + bh * (0.22 + Math.floor(i / 2) * 0.3);
    const ww = Math.max(1.2, w * 0.11);
    if (o.glow) glow(g, wx, wy + ww * 0.6, ww * 2, o.glow, 0.5);
    rect(g, wx - ww / 2, wy, ww, ww * 1.3, o.glow || '#2a2a3a', INK, lw * 0.8);
  }
  return { top: top - rh, wallTop: top };
}

/**
 * Tower. o: { wall, roof, roofKind: cone|battlement|dome|onion|spike|flat|none, windows, banner, lw, r, taperK, glow }
 */
export function tower(g, x, y, w, h, o = {}) {
  const lw = o.lw || 1;
  const wall = o.wall || '#a8a094';
  const roof = o.roof || '#a03a2a';
  const kind = o.roofKind || 'cone';
  const rh = kind === 'battlement' || kind === 'flat' || kind === 'none' ? h * 0.1 : h * (kind === 'spike' ? 0.42 : 0.3);
  const bh = h - rh;
  const tk = o.taperK ?? 0.86;
  const top = y - bh;
  poly(g, [x - w / 2, y, x - (w / 2) * tk, top, x + (w / 2) * tk, top, x + w / 2, y], lgrad(g, x - w / 2, 0, x + w / 2, 0, [[0, shade(wall, 0.16)], [0.55, wall], [1, shade(wall, -0.22)]]), INK, lw);
  if (o.r) bricks(g, x - w * 0.4, top, w * 0.8, bh, shade(wall, -0.14), o.r, o.bricks ?? 6);
  const tw = w * tk;
  if (kind === 'battlement') {
    rect(g, x - tw / 2 - w * 0.08, top - rh * 0.6, tw + w * 0.16, rh * 0.9, shade(wall, 0.06), INK, lw);
    const n = 3;
    const cw = (tw + w * 0.16) / (n * 2 - 1);
    for (let i = 0; i < n; i++) rect(g, x - tw / 2 - w * 0.08 + i * cw * 2, top - rh * 1.4, cw, rh * 0.85, wall, INK, lw);
  } else if (kind === 'cone' || kind === 'spike') {
    poly(g, [x - tw / 2 - w * 0.12, top + 0.5, x, top - rh, x + tw / 2 + w * 0.12, top + 0.5], vgrad(g, top - rh, top, roof, 0.22), INK, lw);
  } else if (kind === 'dome' || kind === 'onion') {
    g.beginPath();
    if (kind === 'onion') {
      g.moveTo(x - tw * 0.4, top);
      g.quadraticCurveTo(x - tw * 0.95, top - rh * 0.45, x, top - rh);
      g.quadraticCurveTo(x + tw * 0.95, top - rh * 0.45, x + tw * 0.4, top);
    } else g.ellipse(x, top, tw / 2 + w * 0.05, rh * 0.8, 0, Math.PI, Math.PI * 2);
    g.closePath();
    paint(g, vgrad(g, top - rh, top, roof, 0.25), INK, lw);
    line(g, [x, top - rh * 0.85, x, top - rh * 1.25], INK, lw);
    circ(g, x, top - rh * 1.28, w * 0.07, o.trim || '#e8c040', INK, lw * 0.7);
  } else if (kind === 'flat') {
    rect(g, x - tw / 2 - w * 0.06, top - rh, tw + w * 0.12, rh, shade(wall, 0.08), INK, lw);
  }
  const nw = o.windows ?? Math.max(1, Math.round(bh / (w * 1.3)));
  for (let i = 0; i < nw; i++) {
    const wy = top + bh * ((i + 0.5) / (nw + 0.6));
    const ww = Math.max(1, w * 0.16);
    if (o.glow) glow(g, x, wy + ww, ww * 2.4, o.glow, 0.55);
    g.beginPath();
    g.moveTo(x - ww / 2, wy + ww * 1.6);
    g.lineTo(x - ww / 2, wy + ww * 0.4);
    g.quadraticCurveTo(x, wy - ww * 0.3, x + ww / 2, wy + ww * 0.4);
    g.lineTo(x + ww / 2, wy + ww * 1.6);
    g.closePath();
    paint(g, o.glow || '#1e1a24', INK, lw * 0.8);
  }
  if (o.banner) {
    const ty = top - (kind === 'battlement' ? rh * 1.4 : rh);
    line(g, [x, ty, x, ty - h * 0.2], INK, lw);
    poly(g, [x, ty - h * 0.2, x + w * 0.5, ty - h * 0.15, x, ty - h * 0.09], o.banner, INK, lw * 0.8);
  }
  return { top: top - rh, wallTop: top };
}

/** Tent. o: { color, stripe, flagC, lw, open } */
export function tent(g, x, y, w, h, o = {}) {
  const lw = o.lw || 1;
  const c = o.color || '#c8a070';
  g.beginPath();
  g.moveTo(x - w / 2, y);
  g.quadraticCurveTo(x - w * 0.22, y - h * 0.45, x, y - h * 0.86);
  g.quadraticCurveTo(x + w * 0.22, y - h * 0.45, x + w / 2, y);
  g.closePath();
  paint(g, vgrad(g, y - h, y, c, 0.2), INK, lw);
  if (o.stripe) {
    for (const d of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + d * w * 0.22, y);
      g.quadraticCurveTo(x + d * w * 0.1, y - h * 0.4, x, y - h * 0.84);
      g.quadraticCurveTo(x + d * w * 0.2, y - h * 0.4, x + d * w * 0.38, y);
      g.closePath();
      paint(g, o.stripe, null);
    }
  }
  if (o.open !== false) poly(g, [x - w * 0.1, y, x, y - h * 0.42, x + w * 0.1, y], '#2a2018', INK, lw * 0.8);
  line(g, [x, y - h * 0.86, x, y - h], INK, lw);
  if (o.flagC) poly(g, [x, y - h, x + w * 0.2, y - h * 0.95, x, y - h * 0.9], o.flagC, INK, lw * 0.7);
}

/** Crenellated wall segment with top-left at (x, y - h). */
export function wallSeg(g, x, y, w, h, o = {}) {
  const lw = o.lw || 1;
  const wall = o.wall || '#a8a094';
  rect(g, x, y - h * 0.82, w, h * 0.82, vgrad(g, y - h, y, wall, 0.16), INK, lw);
  if (o.r) bricks(g, x, y - h * 0.8, w, h * 0.78, shade(wall, -0.14), o.r, o.bricks ?? Math.round(w / 6));
  const n = Math.max(2, Math.round(w / (h * 0.36)));
  const cw = w / (n * 2 - 1);
  for (let i = 0; i < n; i++) rect(g, x + i * cw * 2, y - h, cw, h * 0.2, wall, INK, lw);
}

/** Trees. kind: oak|pine|palm|dead|mangrove. `s` ~ height. */
export function tree(g, x, y, s, kind, color, r, lw = 1) {
  const trunk = kind === 'dead' ? '#5a4a3a' : '#6a4a2a';
  const j = r ? r.f(-0.08, 0.08) : 0;
  if (kind === 'pine') {
    rect(g, x - s * 0.04, y - s * 0.16, s * 0.08, s * 0.16, trunk, INK, lw);
    for (let i = 0; i < 3; i++) {
      const yy = y - s * (0.12 + i * 0.26);
      const ww = s * (0.3 - i * 0.07);
      poly(g, [x - ww, yy, x + s * j, yy - s * 0.38, x + ww, yy], i % 2 ? shade(color, 0.08) : color, INK, lw);
    }
  } else if (kind === 'palm') {
    curve(g, [x, y, x + s * 0.06, y - s * 0.4, x + s * (0.02 + j), y - s * 0.78], INK, s * 0.09 + lw);
    curve(g, [x, y, x + s * 0.06, y - s * 0.4, x + s * (0.02 + j), y - s * 0.78], '#9a7a4a', s * 0.07);
    const tx = x + s * (0.02 + j);
    const ty = y - s * 0.78;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI * 0.95 + (i / 5) * Math.PI * 0.9 + (i > 2 ? 0.25 : 0);
      const ex = tx + Math.cos(a) * s * 0.34;
      const ey = ty + Math.sin(a) * s * 0.2 + s * 0.1;
      g.beginPath();
      g.moveTo(tx, ty);
      g.quadraticCurveTo((tx + ex) / 2, ty - s * 0.2, ex, ey);
      g.quadraticCurveTo((tx + ex) / 2, ty - s * 0.04, tx, ty);
      g.closePath();
      paint(g, i % 2 ? shade(color, 0.12) : color, INK, lw * 0.8);
    }
    circ(g, tx + s * 0.03, ty + s * 0.03, s * 0.035, '#6a4a2a', INK, lw * 0.6);
  } else if (kind === 'dead') {
    line(g, [x, y, x + s * j, y - s * 0.55], INK, s * 0.1 + lw);
    line(g, [x, y, x + s * j, y - s * 0.55], trunk, s * 0.08);
    for (const [dx, dy, k] of [[-0.26, -0.82, 0.3], [0.24, -0.9, 0.36], [0.02, -0.98, 0.5], [-0.3, -0.5, 0.22], [0.3, -0.56, 0.26]]) {
      line(g, [x + s * j * k * 2, y - s * k, x + s * dx, y + s * dy], INK, s * 0.045 + lw);
      line(g, [x + s * j * k * 2, y - s * k, x + s * dx, y + s * dy], trunk, s * 0.035);
    }
  } else if (kind === 'mangrove') {
    for (const dx of [-0.16, -0.05, 0.07, 0.17]) {
      curve(g, [x + s * dx * 0.3, y - s * 0.34, x + s * dx, y - s * 0.16, x + s * dx * 1.5, y], INK, s * 0.04 + lw);
      curve(g, [x + s * dx * 0.3, y - s * 0.34, x + s * dx, y - s * 0.16, x + s * dx * 1.5, y], trunk, s * 0.03);
    }
    rect(g, x - s * 0.05, y - s * 0.5, s * 0.1, s * 0.2, trunk, INK, lw);
    ell(g, x, y - s * 0.66, s * 0.36, s * 0.24, vgrad(g, y - s * 0.9, y - s * 0.42, color, 0.2), INK, lw);
    for (const dx of [-0.2, 0.05, 0.22]) line(g, [x + s * dx, y - s * 0.5, x + s * dx, y - s * 0.34], shade(color, -0.2), lw * 0.7);
  } else {
    rect(g, x - s * 0.06, y - s * 0.36, s * 0.12, s * 0.36, trunk, INK, lw);
    const blobs = [[-0.2, -0.5, 0.2], [0.2, -0.52, 0.2], [0, -0.72, 0.24], [-0.02, -0.5, 0.2]];
    for (const [dx, dy, rr] of blobs) circ(g, x + s * (dx + j), y + s * dy, s * rr + lw * 0.8, INK, null);
    blobs.forEach(([dx, dy, rr], i) => circ(g, x + s * (dx + j), y + s * dy, s * rr, i % 2 ? shade(color, 0.1) : i === 2 ? shade(color, 0.2) : color, null));
    circ(g, x + s * (j - 0.08), y - s * 0.78, s * 0.07, alpha('#ffffff', 0.2), null);
  }
}

/** Jagged mountain peak. */
export function mountain(g, x, y, w, h, color, snow, r, lw = 1) {
  const j = r ? r.f(-0.1, 0.1) : 0;
  const px = x + w * j;
  poly(g, [x - w / 2, y, x - w * 0.2, y - h * 0.55, px, y - h, x + w * 0.22, y - h * 0.6, x + w / 2, y], lgrad(g, x - w / 2, 0, x + w / 2, 0, [[0, shade(color, 0.2)], [0.5, color], [1, shade(color, -0.3)]]), INK, lw);
  poly(g, [px, y - h, x + w * 0.22, y - h * 0.6, x + w / 2, y, x + w * 0.1, y, x + w * 0.02, y - h * 0.45], alpha('#000000', 0.2), null);
  if (snow) poly(g, [px - w * 0.14, y - h * 0.7, px, y - h, px + w * 0.15, y - h * 0.72, px + w * 0.05, y - h * 0.62, px - w * 0.03, y - h * 0.7, px - w * 0.09, y - h * 0.6], snow, INK, lw * 0.6);
  line(g, [x - w * 0.2, y - h * 0.3, x - w * 0.08, y - h * 0.5], shade(color, -0.3), lw * 0.6);
}

/** Boulder / rock pile. */
export function rock(g, x, y, s, color, r, lw = 1) {
  const k = r ? r.f(0.85, 1.15) : 1;
  poly(g, [x - s * 0.5, y, x - s * 0.42, y - s * 0.4 * k, x - s * 0.1, y - s * 0.7 * k, x + s * 0.3, y - s * 0.56, x + s * 0.5, y - s * 0.2, x + s * 0.44, y],
    lgrad(g, x - s / 2, 0, x + s / 2, 0, [[0, shade(color, 0.22)], [0.5, color], [1, shade(color, -0.28)]]), INK, lw);
  line(g, [x - s * 0.1, y - s * 0.7 * k, x, y - s * 0.3, x + s * 0.3, y - s * 0.56, x, y - s * 0.3, x - s * 0.1, y], shade(color, -0.3), lw * 0.6);
}

/** Crystal cluster. */
export function crystals(g, x, y, s, color, lw = 1, n = 3) {
  const defs = [[0, 1, 0], [-0.3, 0.62, -0.4], [0.3, 0.7, 0.35], [-0.5, 0.4, -0.8], [0.52, 0.42, 0.75]];
  for (let i = Math.min(n, defs.length) - 1; i >= 0; i--) {
    const [dx, hh, a] = defs[i];
    g.save();
    g.translate(x + dx * s * 0.5, y);
    g.rotate(a * 0.5);
    const w = s * 0.15;
    const H = s * hh;
    poly(g, [-w, 0, -w, -H * 0.7, 0, -H, w, -H * 0.7, w, 0], lgrad(g, -w, 0, w, 0, [[0, shade(color, 0.4)], [0.5, color], [1, shade(color, -0.25)]]), INK, lw);
    line(g, [0, -H, 0, 0], alpha('#ffffff', 0.55), lw * 0.6);
    g.restore();
  }
}

/** Rocky mound with a dark cave mouth. */
export function cave(g, x, y, w, h, color, o = {}) {
  const lw = o.lw || 1;
  blob(g, [x - w / 2, y + h * 0.1, x - w * 0.46, y - h * 0.5, x - w * 0.2, y - h * 0.98, x + w * 0.16, y - h * 0.9, x + w * 0.46, y - h * 0.5, x + w / 2, y + h * 0.1],
    lgrad(g, x - w / 2, 0, x + w / 2, 0, [[0, shade(color, 0.2)], [0.5, color], [1, shade(color, -0.3)]]), INK, lw);
  rect(g, x - w / 2 - 1, y, w + 2, h * 0.2, 'rgba(0,0,0,0)', null);
  const mw = w * (o.mouth || 0.34);
  g.beginPath();
  g.moveTo(x - mw / 2, y);
  g.quadraticCurveTo(x - mw * 0.55, y - h * 0.55, x, y - h * 0.58);
  g.quadraticCurveTo(x + mw * 0.55, y - h * 0.55, x + mw / 2, y);
  g.closePath();
  paint(g, o.inner || '#140e0c', INK, lw);
  if (o.glow) glow(g, x, y - h * 0.2, mw * 0.8, o.glow, 0.7);
  line(g, [x - w * 0.3, y - h * 0.6, x - w * 0.2, y - h * 0.4], shade(color, -0.3), lw * 0.7);
  line(g, [x + w * 0.26, y - h * 0.66, x + w * 0.3, y - h * 0.44], shade(color, -0.3), lw * 0.7);
}

/** Pool of liquid with a shore outline. */
export function pool(g, x, y, rx, ry, color, o = {}) {
  const lw = o.lw || 1;
  ell(g, x, y, rx + lw, ry + lw, o.shore || alpha('#000000', 0.25), null);
  ell(g, x, y, rx, ry, vgrad(g, y - ry, y + ry, color, 0.18), o.outline === null ? null : shade(color, -0.45), lw * 0.8);
  if (o.shine !== false) {
    curve(g, [x - rx * 0.5, y - ry * 0.3, x - rx * 0.1, y - ry * 0.5, x + rx * 0.3, y - ry * 0.3], alpha('#ffffff', 0.6), lw * 0.8);
    line(g, [x + rx * 0.1, y + ry * 0.3, x + rx * 0.5, y + ry * 0.3], alpha('#ffffff', 0.4), lw * 0.7);
  }
}

/** Column row + pediment (temples, libraries, banks). */
export function temple(g, x, y, w, h, o = {}) {
  const lw = o.lw || 1;
  const c = o.wall || '#e8e4d8';
  rect(g, x - w / 2, y - h * 0.1, w, h * 0.1, shade(c, -0.12), INK, lw);
  rect(g, x - w * 0.44, y - h * 0.62, w * 0.88, h * 0.52, shade(c, -0.28), INK, lw);
  const n = o.columns || 4;
  for (let i = 0; i < n; i++) {
    const cx = x - w * 0.4 + (w * 0.8 * i) / (n - 1);
    rect(g, cx - w * 0.045, y - h * 0.62, w * 0.09, h * 0.52, vgrad(g, y - h * 0.62, y - h * 0.1, c, 0.12), INK, lw * 0.8);
  }
  rect(g, x - w * 0.48, y - h * 0.7, w * 0.96, h * 0.09, c, INK, lw);
  poly(g, [x - w * 0.5, y - h * 0.7, x, y - h, x + w * 0.5, y - h * 0.7], vgrad(g, y - h, y - h * 0.7, o.roof || c, 0.14), INK, lw);
  if (o.emblem) circ(g, x, y - h * 0.8, h * 0.055, o.emblem, INK, lw * 0.7);
  if (o.glow) glow(g, x, y - h * 0.34, w * 0.26, o.glow, 0.6);
}

/** Simple wooden boat hull (no sail), centre-bottom anchored. */
export function hull(g, x, y, w, h, color, lw = 1) {
  g.beginPath();
  g.moveTo(x - w / 2, y - h);
  g.quadraticCurveTo(x - w * 0.36, y, x, y);
  g.quadraticCurveTo(x + w * 0.4, y, x + w / 2, y - h * 1.2);
  g.lineTo(x + w * 0.34, y - h * 0.9);
  g.lineTo(x - w * 0.36, y - h * 0.9);
  g.closePath();
  paint(g, vgrad(g, y - h, y, color, 0.22), INK, lw);
  line(g, [x - w * 0.38, y - h * 0.5, x + w * 0.4, y - h * 0.5], shade(color, -0.35), lw * 0.7);
}

export { star, rrect };
