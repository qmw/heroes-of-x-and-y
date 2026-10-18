// Non-humanoid creature rigs: quadrupeds (with optional rider / centaur torso / wings), dragons,
// birds, serpents, insects, floating eyes, treefolk, elementals and war machines.
// All rigs draw on a 100-unit-high design grid facing right; `cx` is the figure centre, `G` ground.

import {
  INK, alpha, at, blob, circ, curve, ell, glow, limb, line, mix, paint, poly, rect, rrect, shade, shadow, star, taper, vgrad,
} from './kit.js';
import { batWing, featherWing, humanoid } from './rigHumanoid.js';

const BONE = '#e4dcc4';

// ---------------------------------------------------------------------------------------------
// Generic beast head, facing right, centred on (0,0) with skull radius r.
// ---------------------------------------------------------------------------------------------

function beastHead(g, r, q, p) {
  const c = q.headC || q.color;
  const fill = vgrad(g, -r, r, c, 0.22);
  const open = p.swing > 0 ? 1 : 0;
  const eye = (x, y, k = 1) => {
    if (q.eyes) glow(g, x, y, r * 0.5, q.eyes, 0.7);
    circ(g, x, y, r * 0.17 * k, q.eyes || '#fff8d8', INK, 0.8);
    if (!q.eyes) circ(g, x + r * 0.04, y, r * 0.08 * k, INK, null);
  };
  switch (q.head) {
    case 'horse': {
      for (const d of [0, 1]) poly(g, [-r * 0.5 + d * r * 0.4, -r * 0.7, -r * 0.35 + d * r * 0.4, -r * 1.6, r * 0.05 + d * r * 0.4, -r * 0.8], c, INK, 1.1);
      blob(g, [-r * 0.9, -r * 0.5, 0, -r, r * 1.0, -r * 0.3, r * 2.0, r * 0.7, r * 1.9, r * 1.35, r * 1.2, r * 1.4, r * 0.1, r * 0.9, -r * 0.8, r * 0.7], fill, INK, 1.5);
      circ(g, r * 1.75, r * 0.95, r * 0.1, INK, null);
      line(g, [r * 1.2, r * 1.25, r * 1.8, r * 1.2], INK, 0.9);
      eye(r * 0.35, -r * 0.1);
      if (q.bridle) line(g, [r * 0.9, -r * 0.3, r * 1.1, r * 1.3, r * 0.9, -r * 0.3, -r * 0.6, r * 0.4], q.bridle, 1.3);
      if (q.horn) {
        poly(g, [r * 0.3, -r * 0.8, r * 1.6, -r * 2.6, r * 0.75, -r * 0.6], q.hornC || '#fff4d0', INK, 1.1);
        if (q.up) glow(g, r * 1.4, -r * 2.3, r, '#fff8c0', 0.7);
      }
      break;
    }
    case 'wolf': case 'boar': case 'armadillo': {
      const boar = q.head === 'boar';
      if (q.head !== 'armadillo') for (const d of [0, 1]) poly(g, [-r * 0.7 + d * r * 0.55, -r * 0.6, -r * 0.6 + d * r * 0.55, -r * (boar ? 1.3 : 1.8), -r * 0.05 + d * r * 0.55, -r * 0.8], c, INK, 1.1);
      blob(g, [-r, -r * 0.3, -r * 0.2, -r * 1.0, r * 0.8, -r * 0.6, r * (boar ? 1.8 : 2.2), r * 0.1, r * (boar ? 1.9 : 2.1), r * 0.6, r * 0.8, r * 0.9, -r * 0.6, r * 0.9], fill, INK, 1.5);
      if (open && !boar) {
        poly(g, [r * 0.7, r * 0.6, r * 2.0, r * 0.7, r * 1.7, r * 1.5, r * 0.6, r * 1.2], shade(c, -0.2), INK, 1.2);
        for (const x of [1.0, 1.3, 1.6]) poly(g, [r * x, r * 0.7, r * (x + 0.1), r * 1.0, r * (x + 0.2), r * 0.7], '#ffffff', null);
      }
      if (boar) {
        ell(g, r * 1.85, r * 0.3, r * 0.3, r * 0.42, shade(c, 0.25), INK, 1.1);
        for (const d of [0, 0.45]) poly(g, [r * (1.0 + d), r * 0.75, r * (1.25 + d), -r * 0.2, r * (1.35 + d), r * 0.7], '#f4f0e0', INK, 0.9);
      } else circ(g, r * 2.05, r * 0.15, r * 0.16, INK, null);
      eye(r * 0.45, -r * 0.2);
      break;
    }
    case 'lion': {
      star(g, -r * 0.1, 0, r * 1.75, r * 1.35, 11, q.maneC || shade(c, -0.3), INK, 1.3);
      circ(g, r * 0.2, 0, r, fill, INK, 1.5);
      ell(g, r * 0.85, r * 0.35, r * 0.6, r * 0.45, shade(c, 0.2), INK, 1.1);
      circ(g, r * 1.3, r * 0.15, r * 0.14, INK, null);
      if (open) for (const x of [0.6, 1.0]) poly(g, [r * x, r * 0.7, r * (x + 0.1), r * 1.1, r * (x + 0.2), r * 0.7], '#ffffff', INK, 0.5);
      eye(r * 0.35, -r * 0.3);
      line(g, [r * 0.0, -r * 0.6, r * 0.6, -r * 0.45], INK, 1.3);
      break;
    }
    case 'bull': case 'behemoth': {
      const beh = q.head === 'behemoth';
      for (const d of [0, 1]) {
        g.beginPath();
        g.moveTo(-r * 0.4 + d * r * 0.5, -r * 0.7);
        g.quadraticCurveTo(r * (0.2 + d * 0.5), -r * 1.9, r * (1.5 + d * 0.3), -r * (beh ? 2.2 : 1.6));
        g.quadraticCurveTo(r * (0.6 + d * 0.4), -r * 1.2, r * (0.2 + d * 0.4), -r * 0.6);
        g.closePath();
        paint(g, q.hornC || '#f0e8d0', INK, 1.2);
      }
      blob(g, [-r, -r * 0.4, 0, -r * 1.0, r * 1.0, -r * 0.5, r * 1.7, r * 0.3, r * 1.6, r * 1.1, r * 0.6, r * 1.2, -r * 0.8, r * 0.8], fill, INK, 1.5);
      if (beh) {
        poly(g, [r * 0.5, r * 0.7, r * 1.7, r * 0.6, r * 1.5, r * (open ? 1.9 : 1.4), r * 0.5, r * 1.3], shade(c, -0.25), INK, 1.2);
        for (const x of [0.7, 1.0, 1.3]) poly(g, [r * x, r * 0.68, r * (x + 0.1), r * 1.05, r * (x + 0.2), r * 0.68], '#ffffff', INK, 0.5);
      } else {
        circ(g, r * 1.45, r * 0.6, r * 0.12, INK, null);
        circ(g, r * 1.5, r * 0.95, r * 0.22, null, q.trim || '#e8c040', 1.1);
      }
      eye(r * 0.5, -r * 0.15);
      line(g, [r * 0.15, -r * 0.5, r * 0.8, -r * 0.3], INK, 1.5);
      break;
    }
    case 'lizard': {
      poly(g, [-r * 0.8, -r * 0.6, -r * 0.3, -r * 1.6, r * 0.0, -r * 0.8, r * 0.4, -r * 1.4, r * 0.6, -r * 0.6], q.crestC || shade(c, -0.3), INK, 1.1);
      blob(g, [-r, -r * 0.2, 0, -r * 0.8, r * 1.2, -r * 0.5, r * 2.5, r * 0.1, r * 2.4, r * 0.6, r * 1.0, r * 0.8, -r * 0.7, r * 0.7], fill, INK, 1.5);
      line(g, [r * 1.0, r * 0.45, r * 2.4, r * 0.4], INK, 0.9);
      if (open) line(g, [r * 2.4, r * 0.4, r * 3.2, r * 0.3, r * 3.5, r * 0.0], '#e03a4a', 1.4);
      eye(r * 0.5, -r * 0.3, 1.3);
      circ(g, r * 2.2, r * 0.0, r * 0.08, INK, null);
      break;
    }
    case 'eagle': {
      poly(g, [-r * 0.6, -r * 0.7, -r * 0.9, -r * 1.7, -r * 0.1, -r * 0.9], c, INK, 1.1);
      circ(g, 0, 0, r, fill, INK, 1.5);
      g.beginPath();
      g.moveTo(r * 0.6, -r * 0.55);
      g.quadraticCurveTo(r * 1.9, -r * 0.5, r * 1.9, r * 0.75);
      g.quadraticCurveTo(r * 1.3, r * 0.3, r * 0.6, r * 0.45);
      g.closePath();
      paint(g, q.beakC || '#f0c030', INK, 1.3);
      eye(r * 0.25, -r * 0.2, 1.2);
      line(g, [-r * 0.2, -r * 0.6, r * 0.6, -r * 0.4], INK, 1.5);
      break;
    }
    default: { // dragon-like
      for (const d of [0, 1]) poly(g, [-r * 0.7 + d * r * 0.4, -r * 0.5, -r * 1.8 + d * r * 0.3, -r * 1.5, -r * 0.2 + d * r * 0.4, -r * 0.75], q.hornC || '#f0e8d0', INK, 1.1);
      if (q.crest) poly(g, [-r * 1.0, -r * 0.2, -r * 0.4, -r * 1.9, r * 0.3, -r * 0.8, r * 0.6, -r * 1.5, r * 0.8, -r * 0.6], q.crestC || shade(c, -0.3), INK, 1.1);
      blob(g, [-r, -r * 0.3, -r * 0.2, -r * 0.95, r * 0.9, -r * 0.6, r * 2.3, -r * 0.15, r * 2.4, r * 0.35, r * 1.0, r * 0.45, -r * 0.6, r * 0.8], fill, INK, 1.5);
      const jaw = open ? r * 0.75 : r * 0.12;
      poly(g, [-r * 0.5, r * 0.5, r * 1.0, r * 0.4, r * 2.2, r * 0.4 + jaw, r * 0.9, r * 0.75 + jaw, -r * 0.4, r * 0.95], shade(c, -0.15), INK, 1.3);
      if (open) for (const x of [1.1, 1.5, 1.9]) poly(g, [r * x, r * 0.4, r * (x + 0.1), r * 0.75, r * (x + 0.2), r * 0.4], '#ffffff', null);
      eye(r * 0.45, -r * 0.3, 1.2);
      circ(g, r * 2.1, -r * 0.05, r * 0.09, INK, null);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Quadruped
// ---------------------------------------------------------------------------------------------

export const Q_DEFAULTS = {
  s: 1, L: 64, bodyH: 25, legL: 27, legW: 7, color: '#8a6a4a', belly: null, head: 'horse', headK: 1, neckL: 22, neckA: -55,
  neckW: 12, mane: null, tail: 'horse', tailC: null, horn: false, wings: null, wingC: null, wingK: 1, heads: 1, legs: 4,
  armor: null, plates: null, claws: false, rider: null, centaur: null, hoofC: '#2a2018', eyes: null, stripes: null, up: false,
  trim: '#e8c040', bristle: null, mech: false, spikes: null,
};

export function quadruped(g, cx, G, spec, p) {
  const q = { ...Q_DEFAULTS, ...spec };
  at(g, cx, G, 0, q.s, q.s, () => {
    const L = q.L;
    const bh = q.bodyH;
    const cy = -q.legL - bh / 2 + p.bob * 0.8;
    const c = q.color;
    const dark = shade(c, -0.3);
    const step = p.step || 0;
    const flap = p.flap || 0;
    const lunge = (p.swing || 0) > 0 ? 3 : 0;
    shadow(g, 0, 1, L * 0.62);

    const wingFn = q.wings === 'bat' ? batWing : featherWing;
    const wc = q.wingC || shade(c, 0.3);
    if (q.wings) wingFn(g, 10, cy - bh * 0.3, -1, L * 0.62 * q.wingK, shade(wc, -0.25), flap * 0.6);

    // tail
    const tx = -L * 0.47;
    const ty = cy - bh * 0.15;
    const tc = q.tailC || q.mane || dark;
    if (q.tail === 'horse') {
      blob(g, [tx + 2, ty - 3, tx - 10, ty - 6, tx - 16 - step * 2, ty + 12, tx - 12 - step * 3, ty + 28, tx - 5, ty + 20, tx - 3, ty + 6], tc, INK, 1.4);
    } else if (q.tail === 'wolf') {
      blob(g, [tx + 3, ty, tx - 12, ty - 10, tx - 24, ty - 2 + step * 2, tx - 14, ty + 8], tc, INK, 1.4);
    } else if (q.tail === 'lion') {
      const pts = [tx + 2, ty, tx - 12, ty + 8, tx - 20, ty - 4, tx - 22, ty - 16];
      curve(g, pts, INK, 5);
      curve(g, pts, c, 2.8);
      ell(g, tx - 22, ty - 18, 3.5, 5, tc, INK, 1.1);
    } else if (q.tail === 'lizard') {
      taper(g, [tx + 6, ty + 4, tx - 14, ty + 8, tx - 30, ty + 18 + step, tx - 44, ty + 16], c, bh * 0.6, 1.5);
    } else if (q.tail === 'scorpion') {
      const pts = [tx + 4, ty, tx - 16, ty - 2, tx - 24, ty - 20, tx - 14, ty - 36, tx + 2, ty - 38 + lunge];
      taper(g, pts, q.tailC || '#7a3a2a', 7, 4);
      poly(g, [tx + 2, ty - 42 + lunge, tx + 14, ty - 34 + lunge, tx + 3, ty - 33 + lunge], '#2a1a14', INK, 1);
    } else if (q.tail === 'short') {
      ell(g, tx - 2, ty, 5, 3.5, tc, INK, 1.2);
    }

    // legs
    const nLeg = q.legs;
    const legXs = nLeg === 6 ? [-0.38, -0.02, 0.34] : [-0.36, 0.34];
    const drawLeg = (lx, far, phase) => {
      const col = far ? dark : c;
      const off = far ? 4 : 0;
      const sw = step * phase * 6;
      const top = [lx * L + off, cy + bh * 0.15];
      const foot = [lx * L + off + sw, -(phase * step > 0 ? 2.5 : 0)];
      const knee = [(top[0] + foot[0]) / 2 + (lx < 0 ? -3 : 2), (top[1] + foot[1]) / 2];
      limb(g, [top[0], top[1], knee[0], knee[1], foot[0], foot[1] - q.legW * 0.4], col, q.legW);
      if (q.claws) {
        ell(g, foot[0] + 2, foot[1] - 2, q.legW * 0.8, 3, col, INK, 1.1);
        for (const d of [0, 1, 2]) line(g, [foot[0] + 1 + d * 2.2, foot[1] - 1.5, foot[0] + 3 + d * 2.2, foot[1] + 0.5], '#f4f0e0', 1);
      } else ell(g, foot[0] + 1, foot[1] - 2, q.legW * 0.62, 2.8, q.hoofC, INK, 1.1);
    };
    legXs.forEach((lx, i) => drawLeg(lx, true, i % 2 ? -1 : 1));

    // body: outline pass, then fill pass so the three masses merge
    const masses = [[0, cy, L * 0.44, bh * 0.5], [L * 0.3, cy - 1, bh * 0.62, bh * 0.58], [-L * 0.3, cy, bh * 0.6, bh * 0.56]];
    for (const [x, y, rx, ry] of masses) ell(g, x, y, rx + 1.4, ry + 1.4, INK, null);
    const bf = vgrad(g, cy - bh * 0.6, cy + bh * 0.6, c, 0.26);
    for (const [x, y, rx, ry] of masses) ell(g, x, y, rx, ry, bf, null);
    if (q.belly) ell(g, 0, cy + bh * 0.26, L * 0.36, bh * 0.2, q.belly, null);
    if (q.stripes) for (let i = -2; i <= 2; i++) line(g, [i * L * 0.12, cy - bh * 0.45, i * L * 0.12 - 3, cy + bh * 0.1], q.stripes, 1.8);
    if (q.plates) {
      for (let i = -3; i <= 3; i++) {
        g.beginPath();
        g.ellipse(i * L * 0.1, cy - bh * 0.02, L * 0.09, bh * 0.56, 0, Math.PI, Math.PI * 2);
        g.closePath();
        paint(g, i % 2 ? q.plates : shade(q.plates, -0.15), INK, 1.1);
      }
    }
    if (q.spikes) for (let i = -3; i <= 3; i++) poly(g, [i * L * 0.11 - 2.5, cy - bh * 0.5, i * L * 0.11, cy - bh * 0.5 - 6, i * L * 0.11 + 2.5, cy - bh * 0.5], q.spikes, INK, 0.9);
    if (q.bristle) for (let i = -3; i <= 4; i++) line(g, [i * L * 0.1, cy - bh * 0.5, i * L * 0.1 - 2, cy - bh * 0.5 - 5], q.bristle, 1.6);
    if (q.armor) {
      blob(g, [-L * 0.4, cy - bh * 0.5, L * 0.36, cy - bh * 0.55, L * 0.42, cy + bh * 0.5, L * 0.1, cy + bh * 0.75, -L * 0.2, cy + bh * 0.5, -L * 0.44, cy + bh * 0.72],
        vgrad(g, cy - bh * 0.5, cy + bh * 0.7, q.armor, 0.2), INK, 1.4);
      curve(g, [-L * 0.42, cy + bh * 0.55, -L * 0.2, cy + bh * 0.38, L * 0.1, cy + bh * 0.6, L * 0.4, cy + bh * 0.38], q.trim, 1.6);
    }
    if (q.mech) {
      for (const x of [-0.3, 0, 0.3]) circ(g, x * L, cy + bh * 0.1, 1.2, INK, null);
      star(g, -L * 0.3, cy - bh * 0.1, 6, 4.2, 8, q.trim, INK, 0.9);
      circ(g, -L * 0.3, cy - bh * 0.1, 1.6, INK, null);
    }
    legXs.forEach((lx, i) => drawLeg(lx, false, i % 2 ? 1 : -1));

    // neck + head(s)
    if (!q.centaur) {
      const n = q.heads;
      for (let k = n - 1; k >= 0; k--) {
        const spread = n > 1 ? (k - (n - 1) / 2) * 34 : 0;
        const a = ((q.neckA + spread) * Math.PI) / 180;
        const nx0 = L * 0.38;
        const ny0 = cy - bh * 0.18;
        const nx1 = nx0 + Math.cos(a) * (q.neckL + (n > 1 ? 5 : 0)) + lunge;
        const ny1 = ny0 + Math.sin(a) * (q.neckL + (n > 1 ? 5 : 0)) + p.bob * 0.5;
        const nc = k > 0 ? shade(c, -0.14 * k) : c;
        if (q.mane && q.head === 'horse') {
          blob(g, [nx0 - 8, ny0 - 2, nx1 - 9, ny1 - 6, nx1 - 2, ny1 - 9, nx0 + 1, ny0 - 9], q.mane, INK, 1.3);
        }
        if (q.neckL > 3) taper(g, [nx0 - 2, ny0 + 2, (nx0 + nx1) / 2, (ny0 + ny1) / 2, nx1, ny1], nc, q.neckW * 1.25, q.neckW * 0.85);
        at(g, nx1 + 1, ny1, 0, q.headK, q.headK, () => beastHead(g, 6.4, { ...q, color: nc }, p));
      }
    }

    if (q.wings) wingFn(g, 2, cy - bh * 0.32, -1, L * 0.68 * q.wingK, wc, flap);
    if (q.centaur) humanoid(g, L * 0.36 + lunge, cy - bh * 0.22, { ...q.centaur, legs: 'none' }, p);
    if (q.rider) {
      rrect(g, -L * 0.16, cy - bh * 0.62, L * 0.3, bh * 0.3, 2, q.saddleC || '#6a3a22', INK, 1.2);
      humanoid(g, -L * 0.02, cy - bh * 0.5, { ...q.rider, legs: 'mounted' }, p);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Dragon
// ---------------------------------------------------------------------------------------------

export const D_DEFAULTS = {
  s: 1, color: '#3a8a3a', belly: null, wingC: null, hornC: '#f0e8d0', wings: 'bat', bone: false, ghost: false, crystal: null,
  frontLegs: true, stinger: false, crest: false, spikes: true, eyes: '#ffe040', breath: '#ff8020', marks: null, wingK: 1, up: false,
};

function butterflyWing(g, x, y, S, c1, c2, flap) {
  const k = 1 - flap * 0.3;
  ell(g, x - S * 0.35, y - S * 0.5 * k, S * 0.5, S * 0.42 * k, alpha(c1, 0.85), INK, 1.3, -0.5);
  ell(g, x - S * 0.4, y + S * 0.05, S * 0.36, S * 0.28 * k, alpha(c2, 0.85), INK, 1.3, 0.4);
  circ(g, x - S * 0.4, y - S * 0.5 * k, S * 0.14, alpha('#ffffff', 0.7), null);
  circ(g, x - S * 0.45, y + S * 0.05, S * 0.09, alpha('#ffffff', 0.7), null);
}

function boneWing(g, x, y, S, flap, memb) {
  const k = 1 - flap * 0.25;
  const A = [x - S * 0.32, y - S * 0.82 * k];
  const tips = [[-1.05, -0.62], [-0.92, 0.04], [-0.56, 0.26]].map(([a, b]) => [x + a * S, y + b * S * k]);
  if (memb) {
    poly(g, [x, y, A[0], A[1], tips[0][0], tips[0][1], x - S * 0.84, y - S * 0.2 * k, tips[1][0], tips[1][1], x - S * 0.6, y, tips[2][0], tips[2][1], x - S * 0.2, y + S * 0.1], memb, null);
  }
  for (const t of tips) limb(g, [A[0], A[1], t[0], t[1]], BONE, 1.6);
  limb(g, [x, y, A[0], A[1]], BONE, 2.6);
}

export function dragon(g, cx, G, spec, p) {
  const d = { ...D_DEFAULTS, ...spec };
  at(g, cx, G, 0, d.s, d.s, () => {
    const c = d.color;
    const dark = shade(c, -0.3);
    const belly = d.belly || shade(c, 0.35);
    const flap = p.flap || 0;
    const bob = p.bob;
    const step = p.step || 0;
    const wc = d.wingC || shade(c, -0.12);
    const S = 54 * d.wingK;
    const open = (p.swing || 0) > 0;
    if (d.ghost) g.globalAlpha = 0.82;
    shadow(g, 0, 1, 44);
    const wing = (x, y, col, f) => {
      if (d.wings === 'bat') batWing(g, x, y, -1, S, col, f);
      else if (d.wings === 'bone') boneWing(g, x, y, S, f, d.ghost ? alpha(d.ghost, 0.45) : alpha('#3a3440', 0.3));
      else if (d.wings === 'butterfly') butterflyWing(g, x, y, S, col, d.wing2 || '#f0d040', f);
    };
    wing(16, -42 + bob, shade(wc, -0.25), flap * 0.6);

    // tail
    const tail = [-26, -24 + bob, -50, -12, -70, -11 - step, -84, -24, -90, -40];
    taper(g, tail, d.bone ? BONE : c, d.bone ? 5 : 14, 2);
    if (d.bone) for (let i = 1; i < 8; i++) line(g, [-26 - i * 7, -22 + Math.abs(i - 4) * -1.5 + 5, -26 - i * 7, -14 + Math.abs(i - 4) * -1.5 + 5], INK, 0.8);
    if (d.stinger) poly(g, [-93, -37, -88, -50, -84, -38], '#2a1a14', INK, 1);
    else if (!d.bone) poly(g, [-95, -40, -89, -52, -84, -40, -89, -36], dark, INK, 1.1);

    // far legs
    const leg = (x, far, ph, front) => {
      const col = d.bone ? shade(BONE, far ? -0.2 : 0) : far ? dark : c;
      const o = far ? 6 : 0;
      const fx = x + o + step * ph * 5;
      const w = d.bone ? 3 : 8;
      if (!front && !d.bone) ell(g, x + o - 2, -20 + bob, 11, 13, col, INK, 1.4);
      limb(g, [x + o, -20 + bob, x + o + (front ? 3 : -5), -9, fx, -2.5], col, w);
      for (const t of [0, 1, 2]) line(g, [fx + t * 2.5, -2.5, fx + 2.5 + t * 2.6, 0.5], '#f4f0e0', 1.3);
    };
    leg(-20, true, 1, false);
    if (d.frontLegs) leg(22, true, -1, true);

    // body
    if (d.bone) {
      curve(g, [-28, -30 + bob, 0, -40 + bob, 26, -36 + bob], INK, 6.5);
      curve(g, [-28, -30 + bob, 0, -40 + bob, 26, -36 + bob], BONE, 4);
      for (let i = 0; i < 6; i++) {
        const x = -18 + i * 7;
        curve(g, [x, -38 + bob, x - 5, -24 + bob, x + 2, -14 + bob], INK, 3.6);
        curve(g, [x, -38 + bob, x - 5, -24 + bob, x + 2, -14 + bob], BONE, 1.8);
      }
      if (d.ghost) glow(g, 0, -26, 30, d.ghost, 0.5);
    } else {
      ell(g, 0, -28 + bob, 34, 17, vgrad(g, -45, -11, c, 0.26), INK, 1.7);
      ell(g, 3, -21 + bob, 27, 9.5, belly, null);
      for (let i = -3; i <= 3; i++) line(g, [3 + i * 7, -29 + bob + Math.abs(i) * 0.8, 3 + i * 7, -13 + bob - Math.abs(i) * 1.2], alpha(shade(belly, -0.4), 0.55), 0.8);
      if (d.marks) for (let i = -2; i <= 2; i++) line(g, [i * 11 - 2, -43 + bob + Math.abs(i) * 2, i * 11 + 1, -37 + bob, i * 11 - 2, -33 + bob], d.marks, 1.3);
    }
    leg(-20, false, -1, false);
    if (d.frontLegs) leg(22, false, 1, true);

    // neck
    const lunge = open ? 6 : 0;
    const hx = 56 + lunge;
    const hy = -80 + bob * 1.4 + (open ? 6 : 0);
    const neck = [24, -34 + bob, 40, -52 + bob, 46, -68 + bob, hx - 4, hy + 3];
    taper(g, neck, d.bone ? BONE : c, d.bone ? 6 : 16, d.bone ? 4 : 9);
    if (d.bone) for (let i = 1; i < 5; i++) line(g, [28 + i * 5, -40 - i * 8 + bob, 36 + i * 4, -36 - i * 8 + bob], INK, 0.8);
    if (d.spikes && !d.bone) {
      const sp = [[44, -58, 0.5], [39, -47, 0.6], [30, -40, 0.8], [14, -45, 1], [0, -46, 1], [-14, -44, 1], [-27, -38, 0.9], [-42, -22, 0.7], [-56, -15, 0.6]];
      for (const [x, y, k] of sp) poly(g, [x - 3 * k, y + bob, x - 2 * k, y - 7 * k + bob, x + 3 * k, y + bob], d.spikeC || dark, INK, 0.9);
    }
    if (d.crystal) {
      const cr = [[-22, -40, 13, -0.5], [-8, -45, 18, -0.2], [8, -45, 16, 0.15], [22, -40, 11, 0.5], [-36, -30, 9, -0.8], [0, -30, 8, 0.3]];
      for (const [x, y, hgt, a] of cr) {
        at(g, x, y + bob, a, 1, 1, () => {
          poly(g, [-4, 0, -3, -hgt * 0.7, 0, -hgt, 3, -hgt * 0.7, 4, 0], d.crystal, INK, 1);
          line(g, [0, -hgt, 0, 0], alpha('#ffffff', 0.6), 0.8);
        });
      }
    }

    // head
    at(g, hx, hy, open ? 0.12 : 0, 1.25, 1.25, () => {
      if (d.bone) {
        for (const dd of [0, 1]) poly(g, [-4 + dd * 3, -3, -12 + dd * 2, -10, -1 + dd * 3, -5], BONE, INK, 1);
        blob(g, [-6, -2, -1, -6, 6, -4, 15, -1, 15, 2, 6, 3, -4, 5], BONE, INK, 1.4);
        poly(g, [-3, 3, 6, 3, 14, 3 + (open ? 5 : 1), 5, 5 + (open ? 5 : 1), -3, 6], shade(BONE, -0.1), INK, 1.1);
        circ(g, 3, -1.5, 2, INK, null);
        circ(g, 3, -1.5, 1, d.eyes, null);
        glow(g, 3, -1.5, 4, d.eyes, 0.6);
      } else {
        beastHead(g, 6.4, { color: c, head: 'dragon', hornC: d.hornC, crest: d.crest, crestC: d.spikeC || dark, eyes: d.eyes }, p);
      }
    });
    if (open && p.swing >= 1 && d.breath) {
      const fx = hx + 18;
      const fy = hy + 8;
      glow(g, fx + 14, fy + 4, 24, d.breath, 0.7);
      poly(g, [fx, fy - 1, fx + 30, fy - 8, fx + 24, fy + 2, fx + 34, fy + 8, fx + 20, fy + 12, fx, fy + 3], d.breath, shade(d.breath, -0.35), 1);
      poly(g, [fx, fy, fx + 20, fy - 3, fx + 16, fy + 3, fx + 22, fy + 7, fx, fy + 2], shade(d.breath, 0.55), null);
    }
    wing(4, -42 + bob, wc, flap);
    if (d.ghost) {
      g.globalAlpha = 1;
      glow(g, 10, -40, 60, d.ghost, 0.22);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Bird (roc, thunderbird, firebird, phoenix, stormbird...)
// ---------------------------------------------------------------------------------------------

export function bird(g, cx, G, b, p) {
  at(g, cx, G, 0, b.s || 1, b.s || 1, () => {
    const c = b.color;
    const flap = p.flap || 0;
    const y0 = -34 + p.bob * 2.2;
    const S = b.wingS || 56;
    const lunge = (p.swing || 0) > 0 ? 6 : 0;
    shadow(g, 0, 1, S * 0.5);
    if (b.flame) glow(g, 0, y0, S * 1.1, b.flame, 0.5);
    // tail fan
    for (let i = -2; i <= 2; i++) {
      const a = Math.PI * 0.72 + i * 0.2;
      const len = S * 0.52;
      poly(g, [-6, y0 + 8, -6 + Math.cos(a - 0.1) * len, y0 + 8 + Math.sin(a - 0.1) * len, -6 + Math.cos(a + 0.1) * len, y0 + 8 + Math.sin(a + 0.1) * len],
        b.flame ? (i % 2 ? b.flame : '#ffd040') : i % 2 ? shade(c, -0.25) : b.tailC || c, INK, 1.1);
    }
    featherWing(g, -5, y0 - 5, -1, S, shade(b.wingC || c, -0.12), flap);
    featherWing(g, 7, y0 - 5, 1, S * 0.92, b.wingC || c, flap);
    // legs
    for (const d of [-1, 1]) {
      const fx = d * 5 + lunge * 0.5;
      limb(g, [d * 4, y0 + 13, fx + 2, y0 + 23 + lunge * 0.4], '#e8b830', 2.4);
      for (const t of [-1, 0, 1]) line(g, [fx + 2, y0 + 23 + lunge * 0.4, fx + 2 + t * 3.5, y0 + 28 + lunge * 0.4], '#3a2a14', 1.4);
    }
    blob(g, [-10, y0 - 10, 4, y0 - 16, 13, y0 - 4, 10, y0 + 12, -2, y0 + 17, -12, y0 + 8], vgrad(g, y0 - 16, y0 + 17, c, 0.25), INK, 1.6);
    ell(g, 3, y0 + 4, 7, 9, b.belly || shade(c, 0.3), null);
    at(g, 11 + lunge, y0 - 19, 0, 1.15, 1.15, () => beastHead(g, 6.2, { color: b.headC || c, head: 'eagle', beakC: b.beakC, eyes: b.eyes }, p));
    if (b.crest) for (let i = 0; i < 3; i++) poly(g, [6 + i * 2, y0 - 25, 2 - i * 4, y0 - 37 + i * 3, 9 + i * 2, y0 - 26], b.crest, INK, 0.9);
    if (b.flame) {
      for (const [x, y, r] of [[-S * 0.8, y0 - S * 0.55, 6], [S * 0.75, y0 - S * 0.5, 6], [-S * 0.35, y0 + S * 0.42, 5], [0, y0 - S * 0.85, 4]]) {
        star(g, x, y + (flap ? 2 : 0), r, r * 0.45, 5, '#ffe070', '#e8601c', 0.9);
      }
    }
    if (b.bolts) {
      for (const d of [-1, 1]) {
        const x = d * S * 0.62;
        poly(g, [x, y0 - S * 0.2, x + 4, y0 + 2, x + 1, y0 + 2, x + 5, y0 + 16, x - 3, y0 + 6, x, y0 + 6, x - 4, y0 - S * 0.2], '#fff8a0', '#e8a020', 0.9);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Serpents: naga / medusa (humanoid top), hydra (many heads), sea serpent, sand worm, couatl
// ---------------------------------------------------------------------------------------------

export function serpent(g, cx, G, s, p) {
  at(g, cx, G, 0, s.s || 1, s.s || 1, () => {
    const c = s.color;
    const belly = s.belly || shade(c, 0.35);
    const bob = p.bob;
    const open = (p.swing || 0) > 0;
    const lunge = open ? 6 : 0;
    const sway = (p.step || 0) * 3;
    const scales = (pts, n) => {
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const f = t * (pts.length / 2 - 1);
        const k = Math.min(pts.length / 2 - 2, Math.floor(f));
        const u = f - k;
        const x = pts[k * 2] + (pts[k * 2 + 2] - pts[k * 2]) * u;
        const y = pts[k * 2 + 1] + (pts[k * 2 + 3] - pts[k * 2 + 1]) * u;
        circ(g, x, y - 1, 1.3, alpha(shade(c, -0.4), 0.6), null);
      }
    };
    if (s.top === 'human') {
      shadow(g, -6, 1, 42);
      const coil = [-56 - sway, -6, -40, -16, -22, -5, -4, -12 + sway * 0.4, 14, -8, 24, -20, 22, -34 + bob];
      taper(g, coil, c, 5, 17);
      scales(coil, 14);
      ell(g, 16, -9, 9, 4, belly, null);
      if (s.rattle) for (let i = 0; i < 3; i++) circ(g, -58 - sway - i * 3.5, -7 - i * 2.5, 2.4 - i * 0.4, '#d8c890', INK, 0.9);
      if (s.arms) {
        for (let i = 0; i < s.arms; i++) {
          const d = i % 2 ? 1 : -1;
          const up = Math.floor(i / 2);
          const sx = 22 + d * 8;
          const sy = -56 + bob + up * 2;
          const hx = sx + d * (15 + up * 2) + (d > 0 ? lunge : 0);
          const hy = sy + 8 - up * 12 + (open && d > 0 ? 6 : 0);
          limb(g, [sx, sy, (sx + hx) / 2 + d * 2, (sy + hy) / 2 + 5, hx, hy], s.human.skin, 4.5);
          at(g, hx, hy, d > 0 ? (open ? -0.1 : -0.7 - up * 0.25) : -2.45 + up * 0.25, 1, 1, () => {
            poly(g, [2, -1.6, 16, -1.2, 19, 0, 16, 1.2, 2, 1.6], '#d4d8e0', INK, 1);
            rect(g, 0, -4, 2.5, 8, s.human.trim || '#e8c040', INK, 0.8);
          });
        }
      }
      const info = humanoid(g, 22, -32, { ...s.human, legs: 'none' }, p);
      if (s.snakeHair) {
        for (let i = 0; i < 7; i++) {
          const a = Math.PI + (i / 6) * Math.PI;
          const r = info.hr;
          const x0 = info.hx + Math.cos(a) * r * 0.8;
          const y0 = info.hy + Math.sin(a) * r * 0.8;
          const x1 = info.hx + Math.cos(a) * r * 2.0 + ((i + (p.frame || 0)) % 2 ? 1.5 : -1.5);
          const y1 = info.hy + Math.sin(a) * r * 1.9;
          curve(g, [x0, y0, (x0 + x1) / 2 + 2, (y0 + y1) / 2 - 2, x1, y1], INK, 3.6);
          curve(g, [x0, y0, (x0 + x1) / 2 + 2, (y0 + y1) / 2 - 2, x1, y1], s.snakeHair, 2);
          circ(g, x1, y1, 1.5, s.snakeHair, INK, 0.7);
        }
      }
    } else if (s.top === 'heads') {
      shadow(g, -4, 1, 46);
      taper(g, [-22, -18, -46, -10, -64, -8 - sway, -78, -16], c, 16, 2);
      for (const x of [-20, 16]) {
        limb(g, [x + 5, -14, x + 7, -2], shade(c, -0.3), 9);
      }
      ell(g, -4, -20 + bob, 32, 17, vgrad(g, -37, -3, c, 0.26), INK, 1.7);
      ell(g, -2, -13 + bob, 25, 9, belly, null);
      for (const x of [-22, 14]) {
        limb(g, [x, -14, x + 2, -2], c, 10);
        for (const t of [0, 1, 2]) line(g, [x + t * 3, -2, x + 2 + t * 3, 0.5], '#f4f0e0', 1.3);
      }
      const n = s.heads || 3;
      const order = [];
      for (let i = 0; i < n; i++) order.push(i);
      order.sort((a, b) => Math.abs(b - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
      for (const i of order) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const a = (-112 + t * 92) * (Math.PI / 180);
        const len = 44 + ((i * 7) % 3) * 4 - Math.abs(t - 0.5) * 6;
        const wob = ((i + (p.frame || 0)) % 2 ? 2 : -2) + bob;
        const x0 = 12;
        const y0 = -28 + bob;
        const x1 = x0 + Math.cos(a) * len + (t > 0.5 ? lunge : 0) + 6;
        const y1 = y0 + Math.sin(a) * len + wob + (t > 0.5 && open ? 5 : 0);
        const hc = s.headCs ? s.headCs[i % s.headCs.length] : c;
        taper(g, [x0, y0, x0 + Math.cos(a - 0.5) * len * 0.5, y0 + Math.sin(a - 0.5) * len * 0.5, x1 - 4, y1 + 2], hc, 12, 7);
        at(g, x1, y1, 0.1 + (t - 0.5) * 0.5, 0.95, 0.95, () => beastHead(g, 6, { color: hc, head: 'dragon', eyes: s.eyes, hornC: s.hornC || shade(hc, -0.4) }, p));
      }
    } else if (s.top === 'worm') {
      shadow(g, -8, 1, 40);
      ell(g, -36, -1, 22, 6, s.groundC || '#b89a58', INK, 1.4);
      const arc = [];
      for (let i = 0; i <= 9; i++) {
        const t = i / 9;
        const a = Math.PI * (1.0 + t * 0.62);
        arc.push([-4 + Math.cos(a) * 32 + t * t * 18 + (i > 6 ? lunge : 0), -6 + Math.sin(a) * 50 + bob * t * 2]);
      }
      arc.forEach(([x, y], i) => {
        const r = 12 - Math.abs(i - 5) * 0.5;
        circ(g, x, y, r, vgrad(g, y - r, y + r, i % 2 ? c : shade(c, -0.12), 0.25), INK, 1.5);
        if (s.spines) poly(g, [x - 2, y - r, x, y - r - 5, x + 2, y - r], s.spines, INK, 0.8);
      });
      const [mx, my] = arc[9];
      at(g, mx + 8, my + 2, 0.25, 1, 1, () => {
        ell(g, 0, 0, 8, 12, shade(c, -0.1), INK, 1.5);
        ell(g, 1.5, 0, 5 + (open ? 1.5 : 0), 9 + (open ? 1.5 : 0), '#4a1420', INK, 1);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          poly(g, [1.5 + Math.cos(a) * 5, Math.sin(a) * 9, 1.5 + Math.cos(a + 0.25) * 5, Math.sin(a + 0.25) * 9, 1.5 + Math.cos(a + 0.12) * 2.5, Math.sin(a + 0.12) * 5], '#f8f4e0', null);
        }
      });
      if (s.sparks) for (const [x, y] of [[-20, -40], [10, -66], [34, -30]]) star(g, x, y + bob, 5, 1.6, 4, '#c8f0ff', '#5a9ae8', 0.7);
    } else {
      // free snake: sea serpent (water rings) or winged couatl (floating)
      const fly = s.wings ? 8 + bob * 2 : 0;
      if (s.water) {
        for (const [x, rx] of [[-40, 20], [0, 22], [-74, 12]]) ell(g, x, 0, rx, 5, alpha(s.water, 0.75), alpha('#ffffff', 0.8), 1.2);
      } else shadow(g, 0, 1, 40);
      const body = [-78 - sway, -6 - fly, -62, -22 - fly, -44, -6 - fly, -24, -26 - fly, -6, -8 - fly, 10, -30 - fly, 22, -54 - fly, 34 + lunge, -64 - fly + (open ? 8 : 0)];
      if (s.wings) featherWing(g, 4, -34 - fly, -1, 34, shade(s.wingC, -0.25), (p.flap || 0) * 0.6);
      if (s.water) {
        taper(g, [-66, 0, -62, -18, -52, -22, -44, 0], c, 9, 10);
        taper(g, [-32, 0, -26, -24, -14, -28, -6, 0], c, 12, 13);
        if (s.fins) for (const [x, y] of [[-55, -24], [-20, -31]]) poly(g, [x - 6, y + 2, x, y - 9, x + 7, y + 2], s.fins, INK, 1);
        taper(g, [8, 0, 10, -30, 20, -58, 34 + lunge, -70 + (open ? 8 : 0)], c, 15, 9);
        if (s.fins) for (const [x, y] of [[6, -28], [12, -46], [20, -60]]) poly(g, [x - 5, y + 3, x - 9, y - 6, x + 1, y - 4], s.fins, INK, 1);
      } else {
        taper(g, body, c, 5, 15);
        scales(body, 16);
        if (s.feathers) for (let i = 0; i < 3; i++) poly(g, [-80 - sway, -6 - fly, -92 - sway, -14 - fly + i * 7, -84 - sway, -4 - fly + i * 2], s.feathers[i % s.feathers.length], INK, 0.9);
      }
      const hx = 38 + lunge;
      const hy = (s.water ? -72 : -66 - fly) + (open ? 8 : 0);
      if (s.feathers) for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.75 + i * 0.16);
        poly(g, [hx - 2, hy, hx + Math.cos(a - 0.12) * 14, hy + Math.sin(a - 0.12) * 14, hx + Math.cos(a + 0.12) * 14, hy + Math.sin(a + 0.12) * 14], s.feathers[i % s.feathers.length], INK, 0.9);
      }
      at(g, hx, hy, 0.15, 1.2, 1.2, () => beastHead(g, 6.2, { color: c, head: 'dragon', crest: !!s.fins, crestC: s.fins, eyes: s.eyes, hornC: s.hornC || shade(c, -0.4) }, p));
      if (s.wings) featherWing(g, -2, -32 - fly, -1, 40, s.wingC, p.flap || 0);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Insects, floating eye, treefolk
// ---------------------------------------------------------------------------------------------

export function dragonfly(g, cx, G, s, p) {
  const c = s.color;
  const y = G - 44 + p.bob * 2.5;
  const flap = p.flap || 0;
  shadow(g, cx, G + 1, 16 * s.s);
  at(g, cx, y, -0.12, s.s, s.s, () => {
    for (const d of [-1, 1]) {
      ell(g, -4, -6 + d * 0, 24, 6.5, alpha('#d8f0ff', 0.55), alpha(INK, 0.7), 1, d * (0.55 - flap * 0.3) - 0.2);
      ell(g, -8, -4, 19, 5, alpha('#c0e8f8', 0.5), alpha(INK, 0.7), 1, d * (0.25 - flap * 0.2) + 0.2);
    }
    const tail = [-6, 0, -18, 3, -30, 1, -40, -5];
    taper(g, tail, c, 8, 3.5);
    for (let i = 1; i < 6; i++) line(g, [-6 - i * 6, -3 + (i > 3 ? -1 : 1), -6 - i * 6, 4 - (i > 3 ? 2 : 0)], shade(c, -0.4), 1);
    if (s.sting) poly(g, [-40, -8, -47, -9, -41, -3], '#2a1a14', INK, 0.8);
    for (const lx of [-2, 3, 8]) line(g, [lx, 5, lx + 2, 11, lx + 5 + (p.swing > 0 ? 3 : 0), 14], INK, 1.3);
    ell(g, 2, 0, 9, 6.5, vgrad(g, -7, 7, shade(c, -0.1), 0.25), INK, 1.5);
    circ(g, 13, -1, 6, vgrad(g, -7, 5, c, 0.2), INK, 1.5);
    circ(g, 15, -3, 3.2, s.eyeC || '#e8502a', INK, 0.9);
    circ(g, 16, -4, 1, '#ffffff', null);
    line(g, [18, 1, 22, 3 + (p.swing > 0 ? 2 : 0)], INK, 1.4);
    if (s.up) for (const lx of [-12, -24]) circ(g, lx, 1, 1.4, s.trim || '#ffd040', null);
  });
}

export function spider(g, cx, G, s, p) {
  at(g, cx, G, 0, s.s || 1, s.s || 1, () => {
    const c = s.color;
    const by = -22 + p.bob;
    const step = p.step || 0;
    shadow(g, 0, 1, 46);
    for (const far of [true, false]) {
      for (let i = 0; i < 4; i++) {
        const dir = i < 2 ? 1 : -1;
        const k = i % 2;
        const ph = (i % 2 ? 1 : -1) * (far ? -1 : 1) * step;
        const x0 = 8 + dir * 4;
        const kx = x0 + dir * (20 + k * 12) + (far ? 5 : 0);
        const fx = x0 + dir * (30 + k * 22) + (far ? 6 : 0) + ph * 5;
        const pts = [x0, by, kx, by - 22 - k * 6, fx, 0];
        line(g, pts, INK, 5);
        line(g, pts, far ? shade(c, -0.35) : c, 2.8);
      }
      if (far) {
        ell(g, -18, by - 4, 24, 18, vgrad(g, by - 22, by + 14, c, 0.25), INK, 1.7);
        if (s.mark) poly(g, [-18, by - 14, -13, by - 5, -18, by + 6, -23, by - 5], s.mark, INK, 0.8);
        ell(g, 12, by, 12, 10, vgrad(g, by - 10, by + 10, shade(c, 0.1), 0.25), INK, 1.6);
      }
    }
    for (const [x, y, r] of [[18, by - 3, 2], [22, by - 1, 1.6], [15, by - 6, 1.4], [20, by - 6, 1.2]]) circ(g, x, y, r, s.eyeC || '#e03a2a', INK, 0.6);
    for (const d of [0, 4]) poly(g, [19 + d, by + 5, 22 + d, by + 12 + (p.swing > 0 ? 3 : 0), 23 + d, by + 5], '#f4f0e0', INK, 0.8);
  });
}

export function floatingEye(g, cx, G, s, p) {
  const c = s.color;
  const y = G - 46 + p.bob * 2.2;
  shadow(g, cx, G + 1, 17);
  const n = s.tentacles || 5;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const x0 = cx + t * 26;
    const wob = ((i + (p.frame || 0)) % 2 ? 3 : -3);
    const pts = [x0, y + 14, x0 + t * 10 + wob, y + 26, x0 + t * 16 - wob, y + 36, x0 + t * 22 + wob * 0.5, y + 44];
    taper(g, pts, shade(c, -0.1), 5, 1.6);
  }
  for (let i = 0; i < (s.stalks || 0); i++) {
    const t = i / Math.max(1, s.stalks - 1) - 0.5;
    const x1 = cx + t * 38;
    const y1 = y - 26 - (1 - Math.abs(t) * 2) * 6;
    curve(g, [cx + t * 20, y - 14, x1 - t * 4, y1 + 6, x1, y1], INK, 4);
    curve(g, [cx + t * 20, y - 14, x1 - t * 4, y1 + 6, x1, y1], c, 2.2);
    circ(g, x1, y1, 3, '#fff8e0', INK, 0.9);
    circ(g, x1 + 0.8, y1, 1.2, s.iris, null);
  }
  circ(g, cx, y, 19, vgrad(g, y - 19, y + 19, c, 0.28), INK, 1.8);
  ell(g, cx + 3, y - 1, 13, 11 - (p.crouch ? 6 : 0), '#fffbe8', INK, 1.4);
  circ(g, cx + 6, y - 1, 6.5 - (p.crouch ? 2 : 0), s.iris, INK, 1);
  circ(g, cx + 7, y - 1, 2.8, INK, null);
  circ(g, cx + 4, y - 4, 1.6, '#ffffff', null);
  curve(g, [cx - 12, y - 10, cx + 3, y - 17, cx + 17, y - 9], INK, 2.2);
  curve(g, [cx - 8, y + 12, cx + 2, y + 15, cx + 12, y + 12], shade(c, -0.4), 1.4);
  if (p.aim && p.loose) {
    glow(g, cx + 26, y - 1, 16, s.iris, 0.8);
    poly(g, [cx + 12, y - 2.5, cx + 48, y - 5, cx + 48, y + 3, cx + 12, y + 0.5], shade(s.iris, 0.5), s.iris, 1);
  }
}

export function treefolk(g, cx, G, s, p) {
  const bark = s.color;
  const leaf = s.leaf;
  const bob = p.bob * 0.6;
  const sw = p.swing || 0;
  shadow(g, cx, G + 1, 24);
  // roots
  for (const [dx, k] of [[-18, 1], [-7, 0.6], [8, 0.6], [19, 1]]) {
    taper(g, [cx + dx * 0.3, G - 22, cx + dx * 0.8 + (p.step || 0) * 2 * k, G - 9, cx + dx * 1.15, G - 1], bark, 9, 3.5);
  }
  // foliage behind
  for (const [dx, dy, r] of [[-17, -66, 12], [15, -68, 13], [0, -76, 15]]) circ(g, cx + dx, G + dy + bob, r, shade(leaf, -0.18), INK, 1.5);
  // arms (branches)
  const armR = sw > 0 ? [cx + 30, G - 44] : sw < 0 ? [cx + 16, G - 80] : [cx + 26, G - 60 + bob];
  for (const [d, hand] of [[-1, [cx - 26, G - 58 + bob]], [1, armR]]) {
    taper(g, [cx + d * 9, G - 50 + bob, cx + d * 18, G - 46 + bob, hand[0], hand[1]], bark, 8, 4);
    for (const a of [-0.7, 0, 0.7]) line(g, [hand[0], hand[1], hand[0] + d * 6 * Math.cos(a), hand[1] - 3 + 6 * Math.sin(a)], INK, 2.6);
    for (const a of [-0.7, 0, 0.7]) line(g, [hand[0], hand[1], hand[0] + d * 6 * Math.cos(a), hand[1] - 3 + 6 * Math.sin(a)], bark, 1.3);
    circ(g, hand[0] + d * 2, hand[1] - 7, 5, leaf, INK, 1.1);
  }
  // trunk
  blob(g, [cx - 12, G - 18, cx - 10, G - 44, cx - 13, G - 62 + bob, cx, G - 68 + bob, cx + 13, G - 62 + bob, cx + 10, G - 44, cx + 12, G - 18, cx, G - 14],
    vgrad(g, G - 68, G - 14, bark, 0.25), INK, 1.7);
  for (const [x, y0, y1] of [[-6, -28, -40], [5, -22, -34], [-2, -20, -26]]) line(g, [cx + x, G + y0, cx + x + 1, G + y1], shade(bark, -0.35), 1.1);
  // face
  for (const dx of [-3, 6]) {
    ell(g, cx + dx, G - 55 + bob, 2.6, 3.2, INK, null);
    circ(g, cx + dx + 0.5, G - 55 + bob, 1.2, s.eyes || '#ffe040', null);
  }
  curve(g, [cx - 4, G - 47 + bob, cx + 2, G - 44 + bob - sw * 2, cx + 8, G - 47 + bob], INK, 1.5);
  // foliage front
  for (const [dx, dy, r] of [[-9, -72, 10], [8, -74, 10.5], [-1, -82, 9]]) circ(g, cx + dx, G + dy + bob, r, vgrad(g, G + dy - r, G + dy + r, leaf, 0.25), INK, 1.4);
  if (s.up) for (const [dx, dy] of [[-10, -76], [6, -80], [12, -70], [-2, -86]]) circ(g, cx + dx, G + dy + bob, 1.8, s.fruit || '#e84a3a', INK, 0.6);
}

// ---------------------------------------------------------------------------------------------
// Elementals
// ---------------------------------------------------------------------------------------------

export function elemental(g, cx, G, e, p) {
  const c = e.color;
  const bob = p.bob * 1.4;
  const f = p.frame || 0;
  const sw = p.swing || 0;
  const eyes = (x, y, col = '#ffffff') => {
    for (const d of [-3, 5]) {
      ell(g, x + d, y, 2, 2.8, col, null);
      glow(g, x + d, y, 5, col, 0.6);
    }
  };
  shadow(g, cx, G + 1, 18);
  switch (e.type) {
    case 'air': {
      glow(g, cx, G - 44, 36, c, 0.3);
      for (let i = 0; i < 8; i++) {
        const t = i / 7;
        const y = G - 4 - t * 70 + bob * t;
        const rx = 5 + t * 19 + (t > 0.8 ? -6 * (t - 0.8) * 5 : 0);
        const off = Math.sin(i * 1.3 + f * 1.57) * 3.5 + sw * t * 6;
        ell(g, cx + off, y, rx, 5.5, alpha(i % 2 ? c : shade(c, 0.35), 0.88), alpha(shade(c, -0.5), 0.9), 1.2);
        curve(g, [cx + off - rx * 0.7, y - 1, cx + off, y + 2.4, cx + off + rx * 0.7, y - 1], alpha('#ffffff', 0.75), 1);
      }
      for (const d of [-1, 1]) {
        const hx = cx + d * 27 + (d > 0 ? sw * 6 : 0);
        const hy = G - 44 + bob - (d > 0 && sw < 0 ? 12 : 0);
        taper(g, [cx + d * 14, G - 52 + bob, cx + d * 22, G - 54 + bob, hx, hy], alpha(shade(c, 0.2), 0.9), 7, 4, alpha(shade(c, -0.5), 0.9));
      }
      eyes(cx + Math.sin(6 * 1.3 + f * 1.57) * 3.5 + 2, G - 62 + bob, e.eyeC || '#ffffff');
      if (e.bolts) {
        for (const [x, y] of [[-20, -30], [22, -24]]) {
          poly(g, [cx + x, G + y - 12, cx + x + 5, G + y, cx + x + 1, G + y, cx + x + 4, G + y + 12, cx + x - 4, G + y + 2, cx + x, G + y + 2, cx + x - 4, G + y - 12], '#fff8a0', '#e8a020', 0.9);
        }
      }
      break;
    }
    case 'water': case 'ice': {
      const ice = e.type === 'ice';
      glow(g, cx, G - 40, 34, c, 0.25);
      if (ice) {
        poly(g, [cx - 13, G, cx - 16, G - 30, cx - 20, G - 52 + bob, cx - 8, G - 60 + bob, cx + 10, G - 60 + bob, cx + 20, G - 50 + bob, cx + 15, G - 28, cx + 13, G],
          vgrad(g, G - 60, G, c, 0.3), INK, 1.6);
        line(g, [cx - 8, G - 60 + bob, cx - 2, G - 30, cx - 13, G, cx - 2, G - 30, cx + 15, G - 28, cx - 2, G - 30, cx + 10, G - 60 + bob], alpha('#ffffff', 0.7), 1);
        for (const [x, y, hh, a] of [[-18, -54, 14, -0.6], [18, -52, 13, 0.6], [-9, -62, 9, -0.2], [9, -62, 9, 0.25]]) {
          at(g, cx + x, G + y + bob, a, 1, 1, () => poly(g, [-3.5, 0, 0, -hh, 3.5, 0], shade(c, 0.3), INK, 1.1));
        }
        poly(g, [cx - 8, G - 60 + bob, cx - 9, G - 72 + bob, cx, G - 80 + bob, cx + 10, G - 72 + bob, cx + 8, G - 60 + bob], vgrad(g, G - 80, G - 60, shade(c, 0.2), 0.2), INK, 1.5);
      } else {
        blob(g, [cx - 16, G, cx - 13, G - 30, cx - 19, G - 52 + bob, cx - 6, G - 62 + bob, cx + 8, G - 62 + bob, cx + 19, G - 50 + bob, cx + 12, G - 28, cx + 17, G],
          vgrad(g, G - 62, G, c, 0.3), INK, 1.6);
        for (const y of [-14, -30, -44]) curve(g, [cx - 11, G + y, cx - 3, G + y - 4 + (f % 2) * 2, cx + 4, G + y, cx + 11, G + y - 3], alpha('#ffffff', 0.7), 1.2);
        ell(g, cx, G - 1, 20, 4, alpha(shade(c, 0.4), 0.8), alpha('#ffffff', 0.8), 1);
        blob(g, [cx - 9, G - 60 + bob, cx - 10, G - 72 + bob, cx - 2, G - 80 + bob, cx + 10, G - 82 + bob + (f % 2) * 2, cx + 7, G - 72 + bob, cx + 9, G - 60 + bob], vgrad(g, G - 82, G - 60, shade(c, 0.15), 0.2), INK, 1.5);
      }
      for (const d of [-1, 1]) {
        const hx = cx + d * 28 + (d > 0 ? sw * 5 : 0);
        const hy = G - 36 + bob - (d > 0 && sw < 0 ? 26 : 0) - (d > 0 && p.aim ? 14 : 0);
        taper(g, [cx + d * 15, G - 52 + bob, cx + d * 24, G - 48 + bob, hx, hy], shade(c, 0.1), 9, ice ? 3 : 6);
        if (!ice) circ(g, hx, hy, 4.5, shade(c, 0.3), INK, 1.1);
      }
      eyes(cx + 1, G - 70 + bob, e.eyeC || '#ffffff');
      if (p.aim && p.loose) poly(g, [cx + 30, G - 54, cx + 46, G - 51, cx + 30, G - 48], '#e8f8ff', '#5a9ad8', 1);
      break;
    }
    case 'fire': case 'energy': {
      const hot = e.type === 'energy';
      const lift = hot ? 8 + bob : 0;
      glow(g, cx, G - 40 - lift, 40, c, 0.55);
      const flame = (k, col, st) => {
        const w = 17 * k;
        const hh = 72 * k;
        const fl = (f % 2 ? 1 : -1) * 2.2;
        blob(g, [cx - w, G - 6 - lift, cx - w * 1.15, G - hh * 0.4 - lift, cx - w * 0.75 + fl, G - hh * 0.72 - lift, cx - w * 0.25 - fl, G - hh * 0.6 - lift, cx + fl * 1.5, G - hh - lift + bob,
          cx + w * 0.35 + fl, G - hh * 0.62 - lift, cx + w * 0.9 - fl, G - hh * 0.78 - lift, cx + w * 1.15, G - hh * 0.4 - lift, cx + w, G - 6 - lift, cx, G - lift + 1], col, st, 1.5);
      };
      flame(1, c, shade(c, -0.45));
      flame(0.72, e.mid || '#ff9a30', null);
      flame(0.42, e.core || '#ffe890', null);
      for (const d of [-1, 1]) {
        const hx = cx + d * 27 + (d > 0 ? sw * 6 : 0);
        const hy = G - 40 - lift - (d > 0 && sw < 0 ? 22 : 0);
        taper(g, [cx + d * 12, G - 42 - lift, cx + d * 21, G - 48 - lift, hx, hy], e.mid || '#ff9a30', 8, 3, shade(c, -0.45));
      }
      eyes(cx + 1, G - 46 - lift + bob * 0.5, hot ? '#ffffff' : '#fff8c0');
      line(g, [cx - 3, G - 38 - lift, cx + 6, G - 38 - lift], shade(c, -0.6), 1.4);
      if (hot) for (const [x, y] of [[-22, -66], [24, -60], [-26, -26], [20, -20]]) star(g, cx + x, G + y - lift + ((f + x) % 2 ? 2 : -2), 4.5, 1.4, 4, '#ffffff', null);
      break;
    }
    default: { // wisp
      const y = G - 42 + bob * 2;
      glow(g, cx, y, 34, c, 0.75);
      for (const [dx, dy, r] of [[-12, 16, 6], [-18, 28, 4], [-14, 38, 2.5]]) circ(g, cx + dx + (f % 2) * 2, y + dy, r, alpha(shade(c, 0.4), 0.7), null);
      circ(g, cx, y, 13, shade(c, 0.5), alpha(shade(c, -0.3), 0.9), 1.5);
      circ(g, cx - 3, y - 4, 5, alpha('#ffffff', 0.85), null);
      for (const d of [-3, 5]) ell(g, cx + d, y + 1, 1.6, 2.4, shade(c, -0.6), null);
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// War machines and mechanical monsters (wide canvases, except arrow_tower)
// ---------------------------------------------------------------------------------------------

function wheel(g, x, y, r, rot = 0) {
  circ(g, x, y, r, '#6a4626', INK, 1.6);
  circ(g, x, y, r * 0.72, '#b89060', INK, 1);
  for (let i = 0; i < 4; i++) {
    const a = rot + (i * Math.PI) / 4;
    line(g, [x - Math.cos(a) * r * 0.7, y - Math.sin(a) * r * 0.7, x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7], '#5a3a1e', 1.4);
  }
  circ(g, x, y, r * 0.2, '#3a2a1a', INK, 0.8);
}

export function machine(g, cx, G, m, p) {
  const f = p.frame || 0;
  const rot = (p.step || 0) * 0.5 + (p.state === 'move' ? f * 0.6 : 0);
  const fire = p.aim && p.loose;
  const wood = '#8a5a2a';
  switch (m.type) {
    case 'ballista': {
      shadow(g, cx, G + 1, 46);
      limb(g, [cx - 40, G - 20, cx + 36, G - 34], wood, 7);
      limb(g, [cx - 10, G - 12, cx + 6, G - 30], shade(wood, -0.2), 5);
      const bx = cx + 30;
      const by = G - 33;
      const pull = p.aim && !p.loose ? 12 : 0;
      for (const [col, w] of [[INK, 6], ['#a8703a', 3.4]]) {
        g.beginPath();
        g.moveTo(bx - 6, by - 26);
        g.quadraticCurveTo(bx + 16, by, bx - 2, by + 22);
        g.strokeStyle = col;
        g.lineWidth = w;
        g.lineCap = 'round';
        g.stroke();
      }
      line(g, [bx - 6, by - 26, bx - 16 - pull, by - 1, bx - 2, by + 22], '#e8e0d0', 1);
      if (!fire) {
        limb(g, [bx - 30 - pull, by + 3, bx + 26 - pull, by - 7], '#c8a878', 2.4);
        poly(g, [bx + 24 - pull, by - 11, bx + 36 - pull, by - 9, bx + 26 - pull, by - 3], '#d4d8e0', INK, 1);
      }
      wheel(g, cx - 22, G - 11, 11, rot);
      wheel(g, cx + 12, G - 11, 11, rot);
      break;
    }
    case 'cannon': {
      shadow(g, cx, G + 1, 44);
      const rc = fire ? -5 : 0;
      limb(g, [cx - 36, G - 4, cx - 6 + rc, G - 20], wood, 6);
      at(g, cx - 4 + rc, G - 26, -0.22, 1, 1, () => {
        rrect(g, -18, -9, 56, 18, 6, vgrad(g, -9, 9, m.color || '#c08a3a', 0.35), INK, 1.7);
        rect(g, 34, -10.5, 6, 21, shade(m.color || '#c08a3a', -0.2), INK, 1.3);
        for (const x of [-6, 14]) rect(g, x, -9.5, 3, 19, shade(m.color || '#c08a3a', -0.25), null);
        circ(g, -18, 0, 5, shade(m.color || '#c08a3a', -0.15), INK, 1.2);
        if (fire) {
          glow(g, 54, 0, 26, '#ffd040', 0.8);
          star(g, 52, 0, 18, 7, 8, '#ffe070', '#e8762a', 1.1, 0);
          for (const [x, y, r] of [[66, -10, 7], [72, 4, 6]]) circ(g, x, y, r, alpha('#b8b8b8', 0.7), null);
        }
      });
      wheel(g, cx - 2 + rc, G - 14, 14, rot);
      break;
    }
    case 'catapult': {
      shadow(g, cx, G + 1, 46);
      poly(g, [cx - 40, G - 12, cx + 36, G - 12, cx + 30, G - 22, cx - 34, G - 22], wood, INK, 1.6);
      limb(g, [cx - 4, G - 20, cx + 4, G - 52], shade(wood, -0.15), 6);
      limb(g, [cx + 22, G - 20, cx + 6, G - 50], shade(wood, -0.15), 5);
      const a = fire ? -1.9 : p.aim ? -0.25 : -0.45;
      at(g, cx + 5, G - 50, a, 1, 1, () => {
        limb(g, [14, 0, -46, 0], '#a8703a', 5);
        rect(g, 12, -5, 10, 10, '#5a5a62', INK, 1.2);
        g.beginPath();
        g.arc(-48, -2, 8, 0, Math.PI);
        g.closePath();
        paint(g, '#6a4626', INK, 1.4);
        if (!fire) circ(g, -48, -6, 6, '#8a8278', INK, 1.3);
      });
      if (fire) circ(g, cx + 40, G - 84, 6, '#8a8278', INK, 1.3);
      wheel(g, cx - 26, G - 10, 10, rot);
      wheel(g, cx + 22, G - 10, 10, rot);
      break;
    }
    case 'first_aid_tent': {
      shadow(g, cx, G + 1, 44);
      const c = '#f0ece0';
      poly(g, [cx - 40, G, cx - 32, G - 34, cx, G - 62, cx + 32, G - 34, cx + 40, G], vgrad(g, G - 62, G, c, 0.14), INK, 1.8);
      poly(g, [cx - 32, G - 34, cx, G - 62, cx + 32, G - 34, cx + 26, G - 30, cx + 13, G - 35, cx, G - 29, cx - 13, G - 35, cx - 26, G - 30], '#d03a3a', INK, 1.4);
      poly(g, [cx - 8, G, cx, G - 26, cx + 8, G], '#5a4030', INK, 1.3);
      rect(g, cx + 15, G - 26, 12, 4, '#d03a3a', null);
      rect(g, cx + 19, G - 30, 4, 12, '#d03a3a', null);
      rect(g, cx - 27, G - 26, 12, 4, '#d03a3a', null);
      rect(g, cx - 23, G - 30, 4, 12, '#d03a3a', null);
      line(g, [cx, G - 62, cx, G - 76], INK, 2);
      poly(g, [cx, G - 76, cx + 14, G - 72 + (f % 2), cx, G - 68], '#d03a3a', INK, 1);
      if (p.aim && p.loose) for (const [x, y] of [[-20, -70], [22, -66], [0, -86]]) star(g, cx + x, G + y, 6, 2, 4, '#a8f0a0', '#3aa040', 0.8);
      break;
    }
    case 'ammo_cart': {
      shadow(g, cx, G + 1, 44);
      limb(g, [cx + 30, G - 18, cx + 54, G - 10], wood, 4);
      for (let i = 0; i < 7; i++) {
        const x = cx - 22 + i * 7;
        line(g, [x, G - 26, x + (i - 3) * 2, G - 52], INK, 2.6);
        line(g, [x, G - 26, x + (i - 3) * 2, G - 52], '#c8a878', 1.2);
        poly(g, [x + (i - 3) * 2 - 2.5, G - 50, x + (i - 3) * 2.2, G - 58, x + (i - 3) * 2 + 2.5, G - 50], '#d4d8e0', INK, 0.8);
      }
      poly(g, [cx - 36, G - 34, cx + 34, G - 34, cx + 30, G - 14, cx - 32, G - 14], vgrad(g, G - 34, G - 14, wood, 0.2), INK, 1.7);
      for (const x of [-18, 0, 18]) line(g, [cx + x, G - 33, cx + x, G - 15], shade(wood, -0.35), 1.1);
      rect(g, cx - 36, G - 36, 70, 4, '#5a5a62', INK, 1);
      wheel(g, cx - 18, G - 11, 11, rot);
      wheel(g, cx + 16, G - 11, 11, rot);
      break;
    }
    case 'arrow_tower': {
      const c = '#a8a094';
      shadow(g, cx, G + 1, 22);
      poly(g, [cx - 19, G, cx - 15, G - 54, cx + 15, G - 54, cx + 19, G], vgrad(g, G - 54, G, c, 0.2), INK, 1.8);
      for (const [x, y] of [[-10, -12], [4, -22], [-6, -34], [6, -44], [-12, -46]]) rect(g, cx + x, G + y, 8, 4, shade(c, -0.14), null);
      rect(g, cx - 20, G - 62, 40, 9, shade(c, 0.08), INK, 1.5);
      for (const x of [-20, -7, 6]) rect(g, cx + x, G - 69, 9, 8, c, INK, 1.4);
      rect(g, cx - 2, G - 44, 4, 16, '#1a1410', null);
      poly(g, [cx - 22, G - 69, cx, G - 90, cx + 22, G - 69], vgrad(g, G - 90, G - 69, m.color || '#a03a2a', 0.2), INK, 1.6);
      if (fire) {
        line(g, [cx + 4, G - 37, cx + 30, G - 40], '#d8c090', 1.4);
        poly(g, [cx + 28, G - 43, cx + 36, G - 40.5, cx + 28, G - 38], '#d4d8e0', INK, 0.8);
      }
      break;
    }
    default: { // dreadnought / juggernaut: steam walker
      const c = m.color || '#8a8e98';
      const brass = m.trim || '#c89a3a';
      const bob = p.bob;
      const step = p.step || 0;
      const sw = p.swing || 0;
      shadow(g, cx, G + 1, 48);
      for (const [dx, ph, far] of [[-18, 1, true], [26, -1, true], [-26, -1, false], [18, 1, false]]) {
        const col = far ? shade(c, -0.3) : c;
        const fx = cx + dx + step * ph * 6;
        limb(g, [cx + dx * 0.7, G - 32 + bob, cx + dx * 1.15, G - 18, fx, G - 5], col, 8);
        rrect(g, fx - 8, G - 7, 18, 7, 2, shade(col, -0.2), INK, 1.3);
        circ(g, cx + dx * 1.15, G - 18, 3.4, brass, INK, 1);
      }
      for (const [x, hh] of [[-20, 20], [-8, 14]]) {
        rect(g, cx + x, G - 66 - hh + bob, 8, hh + 6, shade(c, -0.3), INK, 1.4);
        rect(g, cx + x - 1.5, G - 68 - hh + bob, 11, 4, brass, INK, 1);
        for (let i = 0; i < 3; i++) circ(g, cx + x + 4 - i * 4 - (f % 2) * 2, G - 76 - hh - i * 8 + bob, 4 + i * 1.6, alpha('#d8d8d8', 0.6 - i * 0.15), null);
      }
      rrect(g, cx - 34, G - 66 + bob, 66, 38, 10, vgrad(g, G - 66, G - 28, c, 0.28), INK, 1.8);
      rect(g, cx - 34, G - 50 + bob, 66, 4, brass, INK, 0.9);
      for (let i = 0; i < 7; i++) circ(g, cx - 28 + i * 9, G - 34 + bob, 1.3, INK, null);
      circ(g, cx - 10, G - 57 + bob, 5.5, '#2a2a30', INK, 1.2);
      circ(g, cx - 10, G - 57 + bob, 3.2, m.eyes || '#ffb030', null);
      glow(g, cx - 10, G - 57 + bob, 9, m.eyes || '#ffb030', 0.6);
      rrect(g, cx + 14, G - 62 + bob, 14, 9, 2, '#ffd870', INK, 1.1);
      const ax = cx + 30;
      const ay = G - 44 + bob;
      const a = sw < 0 ? -1.0 : sw > 0 ? 0.25 : -0.2;
      at(g, ax, ay, a, 1, 1, () => {
        limb(g, [0, 0, 22, 0], shade(c, -0.15), 8);
        if (m.saw) {
          star(g, 32, 0, 12, 9, 12, '#d4d8e0', INK, 1.1, f * 0.3);
          circ(g, 32, 0, 3, brass, INK, 0.9);
        } else {
          rrect(g, 20, -7, 20, 14, 3, brass, INK, 1.4);
          poly(g, [40, -6, 52, -2, 52, 2, 40, 6], '#d4d8e0', INK, 1.1);
        }
      });
      circ(g, ax, ay, 5, brass, INK, 1.2);
      if (m.up) {
        poly(g, [cx - 30, G - 66 + bob, cx - 22, G - 76 + bob, cx - 14, G - 66 + bob], brass, INK, 1);
        poly(g, [cx + 6, G - 66 + bob, cx + 14, G - 76 + bob, cx + 22, G - 66 + bob], brass, INK, 1);
      }
      break;
    }
  }
}

export { mix, rect };
