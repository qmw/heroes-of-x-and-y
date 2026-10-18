// Parametric humanoid rig: covers soldiers, casters, undead, giants, golems, winged humanoids,
// riders' upper bodies... Drawn front-on on a 100-unit-high design grid, looking to the right, with
// the weapon in the screen-right hand (towards the enemy) and the shield on the screen-left arm.

import {
  INK, alpha, at, blob, circ, curve, ell, glow, limb, line, mix, paint, poly, rect, rrect, shade, shadow, star, taper, vgrad,
} from './kit.js';

export const H_DEFAULTS = {
  s: 1, build: 1, headK: 1, skin: '#e0b088', cloth: '#8a7a5a', cloth2: null, metal: '#b8bcc8', trim: '#e8c860',
  hairC: '#4a3020', armor: 'cloth', head: 'human', hat: null, hair: 'short', beard: null, ears: null, horns: 0,
  hornC: '#e8e0c8', halo: false, weapon: null, weaponC: null, offhand: null, shield: null, cape: null, wings: null,
  wingC: null, wingK: 1, tail: null, legs: 'normal', hover: 0, glowC: null, eyes: null, emblem: null, zombie: false,
  belly: 0, up: false, alphaK: 1, stripes: null, pack: null, claws: false,
};

const WOOD = '#7a5230';
const STEEL = '#d4d8e0';

const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------
// Weapons - drawn along +x from the grip at (0,0). `L` is the nominal length.
// ---------------------------------------------------------------------------------------------

function blade(g, x0, L, w, color, curved = 0) {
  g.beginPath();
  g.moveTo(x0, -w);
  g.lineTo(x0 + L * 0.8, -w - curved);
  g.quadraticCurveTo(x0 + L, -w * 0.4 - curved * 1.6, x0 + L, -curved * 2.2);
  g.lineTo(x0 + L * 0.8, w - curved * 0.4);
  g.lineTo(x0, w);
  g.closePath();
  paint(g, color, INK, 1.2);
  line(g, [x0 + 1, -w * 0.2, x0 + L * 0.8, -w * 0.2 - curved], alpha('#ffffff', 0.6), 0.7);
}

export function drawWeapon(g, kind, L, h) {
  const m = h.weaponC || STEEL;
  const t = h.trim;
  switch (kind) {
    case 'sword': case 'greatsword': case 'dagger': case 'flamesword': case 'cutlass': {
      const k = kind === 'greatsword' ? 1.35 : kind === 'dagger' ? 0.5 : 1;
      const c = kind === 'flamesword' ? '#ffb030' : m;
      if (kind === 'flamesword') glow(g, L * 0.6, 0, L * 0.5, '#ff7020', 0.6);
      blade(g, L * 0.14, L * 0.9 * k, L * 0.07 * (kind === 'greatsword' ? 1.3 : 1), c, kind === 'cutlass' ? L * 0.05 : 0);
      rect(g, -L * 0.12, -L * 0.035, L * 0.24, L * 0.07, WOOD, INK, 1);
      rect(g, L * 0.09, -L * 0.14, L * 0.07, L * 0.28, t, INK, 1);
      circ(g, -L * 0.14, 0, L * 0.05, t, INK, 1);
      break;
    }
    case 'spear': case 'pike': case 'halberd': case 'trident': case 'pitchfork': case 'lance': case 'scythe': case 'harpoon': {
      const k = kind === 'pike' || kind === 'lance' ? 1.25 : 1;
      const x0 = -L * 0.55;
      const x1 = L * 1.05 * k;
      if (kind === 'lance') {
        poly(g, [x0, -L * 0.05, x1, 0, x0, L * 0.05], h.weaponC || '#e8e0d0', INK, 1.2);
        ell(g, -L * 0.05, 0, L * 0.06, L * 0.11, t, INK, 1);
        line(g, [L * 0.3, 0, L * 0.5, 0], h.cloth, 2);
        break;
      }
      limb(g, [x0, 0, x1, 0], WOOD, L * 0.05 + 1);
      if (kind === 'scythe') {
        g.beginPath();
        g.moveTo(x1, 0);
        g.quadraticCurveTo(x1 + L * 0.1, L * 0.5, x1 - L * 0.45, L * 0.62);
        g.quadraticCurveTo(x1 - L * 0.08, L * 0.36, x1 - L * 0.1, 0);
        g.closePath();
        paint(g, m, INK, 1.2);
      } else if (kind === 'trident' || kind === 'pitchfork') {
        const c = kind === 'pitchfork' ? '#8a8a8a' : m;
        for (const d of [-1, 0, 1]) {
          line(g, [x1 - L * 0.04, d * L * 0.1, x1 + L * 0.2, d * L * 0.1], INK, 3.4);
          line(g, [x1 - L * 0.04, d * L * 0.1, x1 + L * 0.2, d * L * 0.1], c, 1.6);
        }
        line(g, [x1 - L * 0.04, -L * 0.1, x1 - L * 0.04, L * 0.1], INK, 3.4);
        line(g, [x1 - L * 0.04, -L * 0.1, x1 - L * 0.04, L * 0.1], c, 1.6);
      } else {
        poly(g, [x1 - L * 0.02, -L * 0.06, x1 + L * 0.22, 0, x1 - L * 0.02, L * 0.06], m, INK, 1.1);
        if (kind === 'halberd') {
          g.beginPath();
          g.moveTo(x1 - L * 0.26, -L * 0.02);
          g.quadraticCurveTo(x1 - L * 0.16, -L * 0.3, x1 - L * 0.02, -L * 0.2);
          g.lineTo(x1 - L * 0.08, -L * 0.02);
          g.closePath();
          paint(g, m, INK, 1.1);
          poly(g, [x1 - L * 0.2, L * 0.02, x1 - L * 0.14, L * 0.14, x1 - L * 0.08, L * 0.02], m, INK, 1);
        }
        if (kind === 'harpoon') line(g, [x1 + L * 0.06, 0, x1 - L * 0.04, L * 0.1], m, 1.6);
        if (h.up) line(g, [x1 - L * 0.1, 0, x1 - L * 0.2, L * 0.16], t, 2);
      }
      break;
    }
    case 'axe': case 'battleaxe': case 'hatchet': {
      const k = kind === 'hatchet' ? 0.6 : 1;
      limb(g, [-L * 0.2 * k, 0, L * 0.9 * k, 0], WOOD, L * 0.055 + 1);
      const x = L * 0.78 * k;
      const r = L * (kind === 'battleaxe' ? 0.3 : 0.24);
      for (const d of kind === 'battleaxe' ? [-1, 1] : [-1]) {
        g.beginPath();
        g.moveTo(x - r * 0.25, 0);
        g.quadraticCurveTo(x - r * 0.9, d * r * 0.9, x - r * 0.1, d * r * 1.05);
        g.quadraticCurveTo(x + r * 0.5, d * r * 0.95, x + r * 0.8, d * r * 0.5);
        g.quadraticCurveTo(x + r * 0.2, d * r * 0.4, x + r * 0.25, 0);
        g.closePath();
        paint(g, m, INK, 1.2);
      }
      break;
    }
    case 'club': case 'boneclub': case 'iceclub': {
      const c = kind === 'boneclub' ? '#e8e0c8' : kind === 'iceclub' ? '#a8d8f0' : h.weaponC || '#6a4626';
      poly(g, [-L * 0.15, -L * 0.04, L * 0.9, -L * 0.14, L * 1.0, 0, L * 0.9, L * 0.14, -L * 0.15, L * 0.04], c, INK, 1.3);
      for (const x of [0.55, 0.75]) circ(g, L * x, (x > 0.6 ? -1 : 1) * L * 0.05, L * 0.03, shade(c, -0.35), null);
      break;
    }
    case 'mace': case 'hammer': case 'flail': case 'ball': {
      if (kind !== 'ball') limb(g, [-L * 0.15, 0, L * 0.7, 0], WOOD, L * 0.05 + 1);
      if (kind === 'hammer') {
        rrect(g, L * 0.6, -L * 0.2, L * 0.24, L * 0.4, 2, m, INK, 1.2);
      } else if (kind === 'mace') {
        star(g, L * 0.78, 0, L * 0.19, L * 0.11, 7, m, INK, 1.1);
      } else {
        const bx = kind === 'ball' ? L * 0.5 : L * 0.95;
        const by = kind === 'ball' ? L * 0.35 : L * 0.3;
        curve(g, [kind === 'ball' ? 0 : L * 0.7, 0, bx * 0.9, by * 0.3, bx, by], INK, 2.6);
        curve(g, [kind === 'ball' ? 0 : L * 0.7, 0, bx * 0.9, by * 0.3, bx, by], '#9a9a9a', 1.1);
        star(g, bx, by, L * 0.17, L * 0.11, 8, shade(m, -0.3), INK, 1.1);
      }
      break;
    }
    case 'staff': case 'skullstaff': case 'wand': case 'broom': {
      const k = kind === 'wand' ? 0.5 : 1;
      limb(g, [-L * 0.5 * k, 0, L * 0.95 * k, 0], h.weaponC || WOOD, L * 0.045 + 1);
      const x = L * 0.98 * k;
      if (kind === 'skullstaff') {
        circ(g, x, 0, L * 0.11, '#e8e0c8', INK, 1.1);
        circ(g, x + L * 0.03, -L * 0.04, L * 0.025, INK, null);
        circ(g, x + L * 0.03, L * 0.04, L * 0.025, INK, null);
      } else if (kind === 'broom') {
        poly(g, [x - L * 0.1, -L * 0.04, x + L * 0.25, -L * 0.14, x + L * 0.25, L * 0.14, x - L * 0.1, L * 0.04], '#c8a850', INK, 1);
      } else {
        glow(g, x, 0, L * 0.3, h.glowC || t, 0.6);
        circ(g, x, 0, L * 0.1, h.glowC || t, INK, 1.1);
        circ(g, x - L * 0.03, -L * 0.03, L * 0.03, '#ffffff', null);
      }
      break;
    }
    case 'bow': case 'longbow': case 'sling': {
      const r = L * (kind === 'longbow' ? 0.62 : kind === 'sling' ? 0.3 : 0.5);
      if (kind === 'sling') {
        line(g, [0, 0, L * 0.2, -r, 0, 0, L * 0.2, r], INK, 2.8);
        line(g, [0, 0, L * 0.2, -r, 0, 0, L * 0.2, r], WOOD, 1.4);
        line(g, [L * 0.2, -r, -L * 0.1, 0, L * 0.2, r], '#3a2a1a', 0.9);
        break;
      }
      const pull = h._pull || 0;
      for (const [c, w] of [[INK, 3.6], [h.weaponC || '#8a5a2a', 1.9]]) {
        g.beginPath();
        g.moveTo(-L * 0.05, -r);
        g.quadraticCurveTo(L * 0.3, 0, -L * 0.05, r);
        g.strokeStyle = c;
        g.lineWidth = w;
        g.lineCap = 'round';
        g.stroke();
      }
      line(g, [-L * 0.05, -r, -L * 0.05 - pull * L * 0.3, 0, -L * 0.05, r], '#e8e0d0', 0.8);
      if (pull > 0) {
        line(g, [-L * 0.05 - pull * L * 0.3, 0, L * 0.45, 0], INK, 2.2);
        line(g, [-L * 0.05 - pull * L * 0.3, 0, L * 0.45, 0], '#d8c090', 1);
        poly(g, [L * 0.42, -L * 0.05, L * 0.58, 0, L * 0.42, L * 0.05], STEEL, INK, 0.8);
      }
      break;
    }
    case 'crossbow': {
      limb(g, [-L * 0.2, 0, L * 0.5, 0], WOOD, L * 0.07 + 1);
      curve(g, [L * 0.4, -L * 0.3, L * 0.56, 0, L * 0.4, L * 0.3], INK, 3.2);
      curve(g, [L * 0.4, -L * 0.3, L * 0.56, 0, L * 0.4, L * 0.3], m, 1.6);
      line(g, [L * 0.4, -L * 0.3, L * 0.2, 0, L * 0.4, L * 0.3], '#e8e0d0', 0.8);
      break;
    }
    case 'gun': case 'pistol': case 'blunderbuss': {
      const k = kind === 'pistol' ? 0.55 : 1;
      poly(g, [-L * 0.3 * k, -L * 0.03, -L * 0.05, -L * 0.05, 0, L * 0.05, -L * 0.3 * k, L * 0.16 * k], WOOD, INK, 1.2);
      rect(g, -L * 0.05, -L * 0.055, L * 0.8 * k, L * 0.09, shade(m, -0.35), INK, 1.1);
      if (kind === 'blunderbuss') poly(g, [L * 0.7, -L * 0.055, L * 0.9, -L * 0.12, L * 0.9, L * 0.1, L * 0.7, L * 0.035], shade(m, -0.2), INK, 1.1);
      rect(g, L * 0.02, -L * 0.09, L * 0.1, L * 0.04, t, INK, 0.8);
      if (h._flash) {
        const x = L * (0.8 * k + (kind === 'blunderbuss' ? 0.15 : 0));
        star(g, x + L * 0.14, -L * 0.01, L * 0.26, L * 0.1, 7, '#ffe070', '#e8762a', 1, 0);
        glow(g, x + L * 0.14, 0, L * 0.4, '#ffd040', 0.6);
      }
      break;
    }
    case 'whip': {
      rect(g, -L * 0.1, -L * 0.03, L * 0.25, L * 0.06, WOOD, INK, 1);
      curve(g, [L * 0.15, 0, L * 0.5, -L * 0.3, L * 0.8, L * 0.1, L * 1.1, -L * 0.2, L * 1.3, L * 0.05], INK, 2.6);
      curve(g, [L * 0.15, 0, L * 0.5, -L * 0.3, L * 0.8, L * 0.1, L * 1.1, -L * 0.2, L * 1.3, L * 0.05], h.weaponC || '#c8502a', 1.2);
      break;
    }
    case 'fireball': case 'orb': case 'rock': case 'bomb': case 'potion': case 'snowball': case 'mug': case 'lantern': {
      const r = L * (kind === 'rock' ? 0.2 : 0.14);
      if (kind === 'fireball') {
        glow(g, L * 0.1, 0, r * 3, '#ff8020', 0.7);
        star(g, L * 0.1, 0, r * 1.5, r * 0.9, 7, '#ff9a30', '#c03a10', 1);
        circ(g, L * 0.1, 0, r * 0.6, '#ffe890', null);
      } else if (kind === 'orb') {
        glow(g, L * 0.1, 0, r * 3, h.glowC || t, 0.7);
        circ(g, L * 0.1, 0, r, h.glowC || t, INK, 1);
        circ(g, L * 0.07, -r * 0.3, r * 0.3, '#ffffff', null);
      } else if (kind === 'rock') {
        poly(g, [-r, -r * 0.4, -r * 0.2, -r, r * 0.8, -r * 0.7, r, r * 0.3, r * 0.2, r, -r * 0.8, r * 0.7], '#8a8278', INK, 1.3);
        line(g, [-r * 0.3, -r * 0.3, r * 0.3, 0], shade('#8a8278', -0.3), 0.9);
      } else if (kind === 'bomb') {
        circ(g, L * 0.05, 0, r, '#2a2a30', INK, 1.1);
        line(g, [L * 0.05, -r, L * 0.12, -r * 1.7], '#c8a850', 1.1);
        star(g, L * 0.13, -r * 1.9, r * 0.5, r * 0.2, 5, '#ffd040', null);
      } else if (kind === 'snowball') {
        circ(g, L * 0.05, 0, r, '#f0f8ff', INK, 1);
      } else if (kind === 'mug') {
        rrect(g, -r * 0.8, -r * 1.3, r * 1.6, r * 2, 1, '#9a6a3a', INK, 1);
        rect(g, -r * 0.8, -r * 1.6, r * 1.6, r * 0.5, '#f8f0e0', INK, 0.8);
      } else if (kind === 'lantern') {
        glow(g, 0, r, r * 3.4, '#ffe070', 0.7);
        rrect(g, -r * 0.7, 0, r * 1.4, r * 2, 1, '#ffe070', INK, 1);
        line(g, [0, 0, 0, -r], INK, 1);
      } else {
        circ(g, L * 0.05, r * 0.3, r, h.glowC || '#5ad070', INK, 1);
        rect(g, L * 0.05 - r * 0.35, -r * 1.3, r * 0.7, r * 0.8, '#d8e8f0', INK, 0.8);
      }
      break;
    }
    case 'lightning': {
      const pts = [-L * 0.2, -L * 0.02, L * 0.25, -L * 0.14, L * 0.15, -L * 0.01, L * 0.6, -L * 0.12, L * 0.5, 0.01, L * 1.0, 0,
        L * 0.45, L * 0.1, L * 0.55, L * 0.01, L * 0.1, L * 0.12, L * 0.2, L * 0.02];
      glow(g, L * 0.4, 0, L * 0.6, '#9ad0ff', 0.6);
      poly(g, pts, '#fff8b0', '#e8a020', 1.1);
      break;
    }
    case 'wrench': {
      limb(g, [-L * 0.1, 0, L * 0.55, 0], '#8a8e98', L * 0.06 + 1);
      g.beginPath();
      g.arc(L * 0.65, 0, L * 0.13, 0.6, Math.PI * 2 - 0.6);
      g.strokeStyle = INK;
      g.lineWidth = L * 0.1 + 2;
      g.stroke();
      g.strokeStyle = '#a8acb8';
      g.lineWidth = L * 0.1;
      g.stroke();
      break;
    }
    case 'pipes': {
      for (let i = 0; i < 4; i++) rect(g, i * L * 0.07, -L * 0.1, L * 0.06, L * (0.3 - i * 0.04), '#c8a850', INK, 0.8);
      break;
    }
    default:
      break;
  }
}

function drawShield(g, x, y, r, kind, h) {
  const c = kind === 'bone' ? '#d8d0b8' : kind === 'wood' ? '#8a5a2a' : h.shieldC || h.cloth;
  if (kind === 'kite' || kind === 'tower') {
    g.beginPath();
    g.moveTo(x - r * 0.8, y - r);
    g.lineTo(x + r * 0.8, y - r);
    g.quadraticCurveTo(x + r * 0.9, y + r * 0.5, x, y + r * (kind === 'tower' ? 1.2 : 1.45));
    g.quadraticCurveTo(x - r * 0.9, y + r * 0.5, x - r * 0.8, y - r);
    g.closePath();
    paint(g, vgrad(g, y - r, y + r, c), INK, 1.5);
    line(g, [x, y - r * 0.8, x, y + r], h.trim, 1.6);
    line(g, [x - r * 0.6, y - r * 0.25, x + r * 0.6, y - r * 0.25], h.trim, 1.6);
  } else {
    circ(g, x, y, r, vgrad(g, y - r, y + r, c), INK, 1.5);
    circ(g, x, y, r * 0.72, null, h.trim, 1.1);
    circ(g, x, y, r * 0.24, h.metal, INK, 0.9);
  }
}

// ---------------------------------------------------------------------------------------------
// Wings / tails / capes (drawn behind the body)
// ---------------------------------------------------------------------------------------------

export function featherWing(g, x, y, dir, S, color, flap = 0) {
  const fy = 1 - flap * 0.22;
  const P = (px, py) => [x + dir * px * S, y + py * S * (py < 0 ? fy : 1)];
  const pts = [...P(0, 0), ...P(0.3, -0.75), ...P(0.75, -1.0), ...P(1.05, -0.7), ...P(1.0, -0.2), ...P(0.8, 0.25), ...P(0.5, 0.35), ...P(0.2, 0.3)];
  blob(g, pts, vgrad(g, y - S, y + S * 0.4, color, 0.2), INK, 1.5);
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const a = P(0.25 + t * 0.5, -0.5 + t * 0.15);
    const b = P(0.5 + t * 0.5, 0.3 - t * 0.5);
    curve(g, [a[0], a[1], (a[0] + b[0]) / 2 + dir * S * 0.08, (a[1] + b[1]) / 2, b[0], b[1]], shade(color, -0.25), 0.9);
  }
}

export function batWing(g, x, y, dir, S, color, flap = 0) {
  const fy = 1 - flap * 0.25;
  const P = (px, py) => [x + dir * px * S, y + py * S * fy];
  const A = P(0.32, -0.82);
  const B = P(1.05, -0.62);
  const pts = [...P(0, 0), ...A, ...B, ...P(0.84, -0.3), ...P(0.92, 0.04), ...P(0.62, -0.12), ...P(0.56, 0.26), ...P(0.3, 0.02), ...P(0.12, 0.2)];
  poly(g, pts, vgrad(g, y - S, y + S * 0.3, color, 0.22), INK, 1.5);
  for (const e of [P(0.92, 0.04), P(0.56, 0.26)]) line(g, [A[0], A[1], e[0], e[1]], shade(color, -0.4), 1.1);
  line(g, [x, y, A[0], A[1], B[0], B[1]], shade(color, -0.45), 1.8);
}

function fairyWing(g, x, y, dir, S, color, flap) {
  const a = dir * (0.5 + flap * 0.25);
  ell(g, x + dir * S * 0.45, y - S * 0.35, S * 0.55, S * 0.22, alpha(color, 0.6), alpha(INK, 0.7), 1, -a);
  ell(g, x + dir * S * 0.38, y + S * 0.12, S * 0.4, S * 0.16, alpha(shade(color, 0.3), 0.6), alpha(INK, 0.7), 1, a * 0.6);
}

// ---------------------------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------------------------

function drawHorns(g, hx, hy, r, n, c) {
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(hx + d * r * 0.55, hy - r * 0.55);
    g.quadraticCurveTo(hx + d * r * (1.0 + n * 0.5), hy - r * 0.9, hx + d * r * (0.9 + n * 0.45), hy - r * (1.2 + n * 0.9));
    g.quadraticCurveTo(hx + d * r * (0.7 + n * 0.2), hy - r * 0.9, hx + d * r * 0.25, hy - r * 0.85);
    g.closePath();
    paint(g, c, INK, 1.2);
  }
}

function drawHead(g, hx, hy, r, h, p) {
  const skin = h.skin;
  const lw = 1.5;
  // hair behind
  if (h.hair === 'long' || h.hair === 'wild') {
    const w = h.hair === 'wild' ? 1.45 : 1.2;
    blob(g, [hx - r * w, hy - r * 0.3, hx - r * 0.5, hy - r * 1.25, hx + r * 0.6, hy - r * 1.2, hx + r * w, hy - r * 0.2,
      hx + r * 1.05, hy + r * 1.5, hx - r * 1.15, hy + r * 1.6], h.hairC, INK, lw);
  }
  if (h.hat === 'hood') {
    blob(g, [hx - r * 1.3, hy + r * 0.9, hx - r * 1.25, hy - r * 0.8, hx, hy - r * 1.55, hx + r * 1.25, hy - r * 0.8, hx + r * 1.3, hy + r * 0.9, hx, hy + r * 1.3],
      shade(h.hoodC || h.cloth, -0.12), INK, lw);
  }
  if (h.horns && h.head !== 'bull') drawHorns(g, hx, hy, r, h.horns, h.hornC);
  if (h.ears === 'point' || h.ears === 'big') {
    const k = h.ears === 'big' ? 1.9 : 1.2;
    for (const d of [-1, 1]) poly(g, [hx + d * r * 0.8, hy - r * 0.2, hx + d * r * (0.9 + k * 0.6), hy - r * (0.3 + k * 0.4), hx + d * r * 0.85, hy + r * 0.3], skin, INK, 1.1);
  }
  const fill = vgrad(g, hy - r, hy + r, skin, 0.2);
  switch (h.head) {
    case 'skull': {
      circ(g, hx, hy - r * 0.1, r, vgrad(g, hy - r, hy + r, '#ece6d0', 0.15), INK, lw);
      rrect(g, hx - r * 0.5, hy + r * 0.5, r * 1.1, r * 0.6, 1, '#dcd4bc', INK, 1.1);
      for (const dx of [-0.2, 0.1, 0.4]) line(g, [hx + dx * r, hy + r * 0.6, hx + dx * r, hy + r * 1.05], INK, 0.7);
      ell(g, hx - r * 0.25, hy - r * 0.05, r * 0.25, r * 0.3, INK, null);
      ell(g, hx + r * 0.42, hy - r * 0.05, r * 0.25, r * 0.3, INK, null);
      if (h.eyes) {
        circ(g, hx - r * 0.25, hy - r * 0.05, r * 0.12, h.eyes, null);
        circ(g, hx + r * 0.42, hy - r * 0.05, r * 0.12, h.eyes, null);
      }
      poly(g, [hx + r * 0.05, hy + r * 0.3, hx + r * 0.2, hy + r * 0.3, hx + r * 0.12, hy + r * 0.12], INK, null);
      break;
    }
    case 'beast': case 'bull': case 'lizard': case 'fish': {
      const sn = h.snout || (h.head === 'lizard' ? 1.0 : 0.7);
      if (h.head === 'bull') {
        for (const d of [-1, 1]) {
          g.beginPath();
          g.moveTo(hx + d * r * 0.7, hy - r * 0.5);
          g.quadraticCurveTo(hx + d * r * 2.0, hy - r * 0.6, hx + d * r * 1.7, hy - r * 1.7);
          g.quadraticCurveTo(hx + d * r * 1.3, hy - r * 0.9, hx + d * r * 0.5, hy - r * 0.9);
          g.closePath();
          paint(g, h.hornC, INK, 1.2);
        }
      }
      if (h.head === 'beast' && h.ears !== 'none') {
        for (const d of [-1, 1]) poly(g, [hx + d * r * 0.3, hy - r * 0.8, hx + d * r * 0.85, hy - r * 1.55, hx + d * r * 0.95, hy - r * 0.5], shade(skin, -0.1), INK, 1.1);
      }
      if (h.head === 'fish') poly(g, [hx - r * 0.5, hy - r * 0.8, hx, hy - r * 1.8, hx + r * 0.5, hy - r * 0.8], h.trim, INK, 1.1);
      circ(g, hx, hy, r, fill, INK, lw);
      ell(g, hx + r * 0.6, hy + r * 0.35, r * sn, r * 0.52, shade(skin, 0.1), INK, lw);
      circ(g, hx + r * (0.5 + sn), hy + r * 0.2, r * 0.13, INK, null);
      if (h.tusks) for (const dx of [0.3, 0.9]) poly(g, [hx + r * dx, hy + r * 0.55, hx + r * (dx + 0.12), hy + r * 0.05, hx + r * (dx + 0.28), hy + r * 0.6], '#f4f0e0', INK, 0.8);
      if (h.head === 'bull') circ(g, hx + r * 0.9, hy + r * 0.6, r * 0.22, null, h.trim, 1.1);
      if (h.eyes !== 'none') {
        circ(g, hx - r * 0.15, hy - r * 0.2, r * 0.17, h.eyes || '#fff8d0', INK, 0.7);
        circ(g, hx + r * 0.5, hy - r * 0.2, r * 0.17, h.eyes || '#fff8d0', INK, 0.7);
        circ(g, hx - r * 0.1, hy - r * 0.2, r * 0.07, INK, null);
        circ(g, hx + r * 0.55, hy - r * 0.2, r * 0.07, INK, null);
      }
      if (h.head === 'lizard') poly(g, [hx - r * 0.6, hy - r * 0.8, hx - r * 0.2, hy - r * 1.5, hx, hy - r, hx + r * 0.3, hy - r * 1.4, hx + r * 0.5, hy - r * 0.85], h.crestC || h.trim, INK, 1);
      break;
    }
    case 'golem': {
      rrect(g, hx - r, hy - r, r * 2, r * 1.9, r * 0.35, fill, INK, lw);
      rect(g, hx - r * 0.6, hy - r * 0.25, r * 1.5, r * 0.32, INK, null);
      circ(g, hx - r * 0.1, hy - r * 0.09, r * 0.15, h.eyes || '#ffd040', null);
      circ(g, hx + r * 0.55, hy - r * 0.09, r * 0.15, h.eyes || '#ffd040', null);
      line(g, [hx - r * 0.7, hy - r * 0.75, hx + r * 0.2, hy - r * 0.75], alpha('#ffffff', 0.5), 1);
      break;
    }
    case 'cyclops': {
      circ(g, hx, hy, r, fill, INK, lw);
      circ(g, hx + r * 0.15, hy - r * 0.1, r * 0.45, '#fffbe8', INK, 1.1);
      circ(g, hx + r * 0.3, hy - r * 0.1, r * 0.2, h.eyes || '#b03020', INK, 0.7);
      line(g, [hx - r * 0.3, hy - r * 0.62, hx + r * 0.7, hy - r * 0.7], INK, 1.6);
      line(g, [hx - r * 0.1, hy + r * 0.55, hx + r * 0.6, hy + r * 0.5], INK, 1.2);
      break;
    }
    case 'visor': {
      circ(g, hx, hy, r, vgrad(g, hy - r, hy + r, h.metal, 0.3), INK, lw);
      rect(g, hx - r * 0.5, hy - r * 0.2, r * 1.45, r * 0.26, INK, null);
      if (h.eyes) {
        circ(g, hx, hy - r * 0.07, r * 0.11, h.eyes, null);
        circ(g, hx + r * 0.55, hy - r * 0.07, r * 0.11, h.eyes, null);
      }
      line(g, [hx + r * 0.22, hy - r * 0.9, hx + r * 0.22, hy + r * 0.9], shade(h.metal, -0.3), 1);
      for (const dy of [0.35, 0.6]) line(g, [hx - r * 0.2, hy + r * dy, hx + r * 0.6, hy + r * dy], shade(h.metal, -0.4), 0.8);
      break;
    }
    default: {
      circ(g, hx, hy, r, fill, INK, lw);
      const ec = h.eyes || INK;
      if (h.eyes) {
        glow(g, hx + r * 0.2, hy - r * 0.05, r * 0.9, h.eyes, 0.5);
      }
      if (p.dead) {
        for (const ex of [-0.12, 0.5]) {
          line(g, [hx + r * (ex - 0.14), hy - r * 0.2, hx + r * (ex + 0.14), hy + r * 0.08], INK, 0.9);
          line(g, [hx + r * (ex - 0.14), hy + r * 0.08, hx + r * (ex + 0.14), hy - r * 0.2], INK, 0.9);
        }
      } else {
        ell(g, hx - r * 0.12, hy - r * 0.05, r * 0.11, r * 0.15, ec, null);
        ell(g, hx + r * 0.5, hy - r * 0.05, r * 0.11, r * 0.15, ec, null);
        line(g, [hx - r * 0.3, hy - r * 0.38, hx + r * 0.02, hy - r * 0.3], h.hairC === '#00000000' ? INK : shade(h.hairC, -0.3), 0.9);
        line(g, [hx + r * 0.36, hy - r * 0.3, hx + r * 0.68, hy - r * 0.38], shade(h.hairC, -0.3), 0.9);
      }
      line(g, [hx + r * 0.05, hy + r * 0.45, hx + r * 0.45, hy + r * 0.45], shade(skin, -0.5), 0.9);
      if (h.fangs) for (const dx of [0.1, 0.4]) poly(g, [hx + r * dx, hy + r * 0.45, hx + r * (dx + 0.07), hy + r * 0.75, hx + r * (dx + 0.14), hy + r * 0.45], '#ffffff', INK, 0.5);
      if (h.nose) ell(g, hx + r * 0.35, hy + r * 0.2, r * 0.3, r * 0.26, shade(skin, -0.12), INK, 0.9);
      if (h.tusks) for (const dx of [-0.05, 0.5]) poly(g, [hx + r * dx, hy + r * 0.55, hx + r * (dx + 0.08), hy + r * 0.1, hx + r * (dx + 0.2), hy + r * 0.58], '#f4f0e0', INK, 0.7);
      if (h.patch) {
        circ(g, hx + r * 0.5, hy - r * 0.05, r * 0.24, INK, null);
        line(g, [hx - r * 0.9, hy - r * 0.5, hx + r * 0.9, hy + r * 0.1], INK, 1);
      }
      if (h.bandages) for (const dy of [-0.5, 0, 0.5]) line(g, [hx - r * 0.9, hy + r * dy, hx + r * 0.9, hy + r * (dy + 0.2)], shade(skin, -0.3), 0.9);
      break;
    }
  }
  // beard
  if (h.beard) {
    const k = h.beard === 'big' ? 1.9 : h.beard === 'goatee' ? 0.9 : 1.3;
    const w = h.beard === 'goatee' ? 0.35 : 0.85;
    blob(g, [hx - r * w, hy + r * 0.3, hx + r * w + r * 0.15, hy + r * 0.3, hx + r * w * 0.8, hy + r * k * 0.8, hx + r * 0.1, hy + r * k * 1.15, hx - r * w * 0.7, hy + r * k * 0.8],
      h.beardC || h.hairC, INK, 1.2);
  }
  // hair on top
  const hairTop = (c, k = 1) => {
    g.beginPath();
    g.arc(hx, hy, r * 1.04, Math.PI * 1.02, Math.PI * 1.98);
    g.quadraticCurveTo(hx + r * 0.5, hy - r * 0.45 * k, hx, hy - r * 0.55 * k);
    g.quadraticCurveTo(hx - r * 0.6, hy - r * 0.45 * k, hx - r * 1.04, hy - r * 0.06);
    g.closePath();
    paint(g, c, INK, 1.2);
  };
  if (h.head === 'human' || h.head === 'cyclops') {
    if (h.hair === 'short' || h.hair === 'long' || h.hair === 'wild') hairTop(h.hairC);
    else if (h.hair === 'mohawk') poly(g, [hx - r * 0.25, hy - r * 0.8, hx - r * 0.1, hy - r * 1.8, hx + r * 0.3, hy - r * 1.6, hx + r * 0.35, hy - r * 0.8], h.hairC, INK, 1.1);
    else if (h.hair === 'top') circ(g, hx, hy - r * 1.15, r * 0.35, h.hairC, INK, 1.1);
    else if (h.hair === 'spiky') star(g, hx, hy - r * 0.55, r * 1.0, r * 0.6, 7, h.hairC, INK, 1.1);
  }
  // hats
  const metal = vgrad(g, hy - r * 1.2, hy, h.metal, 0.3);
  switch (h.hat) {
    case 'helm': case 'crest': case 'hornhelm': case 'spike': {
      g.beginPath();
      g.arc(hx, hy - r * 0.05, r * 1.1, Math.PI, Math.PI * 2);
      g.lineTo(hx + r * 1.1, hy + r * 0.15);
      g.lineTo(hx + r * 0.75, hy + r * 0.1);
      g.lineTo(hx + r * 0.7, hy - r * 0.35);
      g.lineTo(hx - r * 0.5, hy - r * 0.35);
      g.lineTo(hx - r * 0.75, hy + r * 0.45);
      g.lineTo(hx - r * 1.1, hy + r * 0.45);
      g.closePath();
      paint(g, metal, INK, lw);
      line(g, [hx + r * 0.2, hy - r * 0.35, hx + r * 0.2, hy + r * 0.25], INK, 2.4);
      line(g, [hx + r * 0.2, hy - r * 0.35, hx + r * 0.2, hy + r * 0.25], h.metal, 1.1);
      if (h.hat === 'crest') {
        blob(g, [hx - r * 0.2, hy - r * 1.1, hx + r * 0.3, hy - r * 1.9, hx - r * 0.9, hy - r * 2.0, hx - r * 1.5, hy - r * 1.0, hx - r * 1.2, hy - r * 0.6, hx - r * 0.7, hy - r * 1.3],
          h.crestC || h.trim, INK, 1.2);
      } else if (h.hat === 'hornhelm') drawHorns(g, hx, hy, r, 0.5, h.hornC);
      else if (h.hat === 'spike') poly(g, [hx - r * 0.2, hy - r * 1.1, hx, hy - r * 1.8, hx + r * 0.2, hy - r * 1.1], h.trim, INK, 1);
      break;
    }
    case 'wizard': case 'witch': {
      const c = h.hatC || h.cloth;
      ell(g, hx, hy - r * 0.55, r * 1.6, r * 0.32, shade(c, -0.15), INK, lw);
      g.beginPath();
      g.moveTo(hx - r * 0.95, hy - r * 0.6);
      g.quadraticCurveTo(hx - r * 0.2, hy - r * 1.6, hx - r * (h.hat === 'witch' ? 0.9 : 0.3), hy - r * 2.7);
      g.quadraticCurveTo(hx + r * 0.6, hy - r * 1.5, hx + r * 0.95, hy - r * 0.6);
      g.closePath();
      paint(g, vgrad(g, hy - r * 2.7, hy - r * 0.5, c, 0.2), INK, lw);
      line(g, [hx - r * 0.85, hy - r * 0.75, hx + r * 0.85, hy - r * 0.75], h.trim, 1.6);
      if (h.up) star(g, hx, hy - r * 1.4, r * 0.3, r * 0.13, 5, h.trim, null);
      break;
    }
    case 'tricorn': case 'cowboy': case 'tophat': case 'straw': case 'cap': {
      const c = h.hatC || (h.hat === 'straw' ? '#d8b860' : '#2e2a2a');
      if (h.hat === 'tricorn') {
        blob(g, [hx - r * 1.7, hy - r * 0.75, hx - r * 0.6, hy - r * 0.35, hx + r * 0.7, hy - r * 0.35, hx + r * 1.8, hy - r * 0.8, hx + r * 0.6, hy - r * 1.6, hx - r * 0.5, hy - r * 1.6], c, INK, lw);
        line(g, [hx - r * 1.3, hy - r * 0.75, hx, hy - r * 0.5, hx + r * 1.4, hy - r * 0.8], h.trim, 1.3);
      } else {
        const bw = h.hat === 'cowboy' || h.hat === 'straw' ? 1.9 : h.hat === 'cap' ? 1.15 : 1.4;
        const ht = h.hat === 'tophat' ? 1.5 : 0.85;
        ell(g, hx + (h.hat === 'cap' ? r * 0.3 : 0), hy - r * 0.6, r * bw, r * 0.28, shade(c, -0.12), INK, lw);
        rrect(g, hx - r * 0.8, hy - r * (0.6 + ht), r * 1.6, r * ht, r * 0.3, c, INK, lw);
        line(g, [hx - r * 0.78, hy - r * 0.78, hx + r * 0.78, hy - r * 0.78], h.trim, 1.5);
      }
      if (h.feather) curve(g, [hx - r * 0.4, hy - r * 1.2, hx - r * 1.2, hy - r * 2.4, hx - r * 1.9, hy - r * 1.8], h.feather, 2.2);
      break;
    }
    case 'bandana': {
      g.beginPath();
      g.arc(hx, hy, r * 1.06, Math.PI * 1.0, Math.PI * 2.0);
      g.lineTo(hx + r * 1.06, hy - r * 0.3);
      g.lineTo(hx - r * 1.06, hy - r * 0.3);
      g.closePath();
      paint(g, h.hatC || '#c03a2a', INK, 1.2);
      poly(g, [hx - r * 1.0, hy - r * 0.3, hx - r * 1.8, hy - r * 0.1, hx - r * 1.5, hy + r * 0.4], h.hatC || '#c03a2a', INK, 1);
      break;
    }
    case 'turban': {
      ell(g, hx, hy - r * 0.65, r * 1.15, r * 0.7, vgrad(g, hy - r * 1.4, hy, h.hatC || '#f0ece0', 0.15), INK, lw);
      curve(g, [hx - r * 0.9, hy - r * 0.5, hx, hy - r * 1.0, hx + r * 0.9, hy - r * 0.6], shade(h.hatC || '#f0ece0', -0.25), 0.9);
      circ(g, hx + r * 0.2, hy - r * 0.75, r * 0.2, h.trim, INK, 0.8);
      break;
    }
    case 'crown': {
      poly(g, [hx - r * 0.85, hy - r * 0.55, hx - r * 0.95, hy - r * 1.5, hx - r * 0.45, hy - r * 1.05, hx, hy - r * 1.65, hx + r * 0.45, hy - r * 1.05, hx + r * 0.95, hy - r * 1.5, hx + r * 0.85, hy - r * 0.55],
        h.trim, INK, 1.2);
      circ(g, hx, hy - r * 0.85, r * 0.14, '#d03a4a', null);
      break;
    }
    case 'goggles': {
      line(g, [hx - r, hy - r * 0.45, hx + r, hy - r * 0.45], '#4a3020', 2.2);
      circ(g, hx - r * 0.15, hy - r * 0.5, r * 0.3, '#9ad8f0', INK, 1);
      circ(g, hx + r * 0.5, hy - r * 0.5, r * 0.3, '#9ad8f0', INK, 1);
      break;
    }
    case 'headdress': {
      for (let i = -2; i <= 2; i++) {
        const a = -Math.PI / 2 + i * 0.38;
        poly(g, [hx + Math.cos(a - 0.14) * r, hy + Math.sin(a - 0.14) * r, hx + Math.cos(a) * r * 2.1, hy + Math.sin(a) * r * 2.1, hx + Math.cos(a + 0.14) * r, hy + Math.sin(a + 0.14) * r],
          i % 2 ? h.trim : '#d04a3a', INK, 0.9);
      }
      line(g, [hx - r * 0.95, hy - r * 0.45, hx + r * 0.95, hy - r * 0.45], h.trim, 2);
      break;
    }
    case 'leaves': {
      for (let i = -2; i <= 2; i++) ell(g, hx + i * r * 0.42, hy - r * (0.95 - Math.abs(i) * 0.12), r * 0.42, r * 0.26, i % 2 ? '#3a8a34' : '#58a840', INK, 0.9, i * 0.4);
      break;
    }
    default:
      break;
  }
  if (h.halo) {
    ell(g, hx, hy - r * 1.75, r * 0.95, r * 0.26, null, '#fff0a0', 2.4);
    ell(g, hx, hy - r * 1.75, r * 0.95, r * 0.26, null, '#e8b830', 0.9);
    glow(g, hx, hy - r * 1.75, r * 1.6, '#fff0a0', 0.4);
  }
}

// ---------------------------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------------------------

/**
 * @param g   2D context on the design grid
 * @param cx  centre x of the figure
 * @param G   ground y
 * @param spec partial of H_DEFAULTS
 * @param p   pose { bob, lean, swing, step, aim, loose, crouch, dead }
 * @returns {{ top: number, handX: number, handY: number }} layout info for callers adding extras
 */
export function humanoid(g, cx, G, spec, p) {
  const h = { ...H_DEFAULTS, ...spec };
  const T = 78 * h.s;
  const b = h.build;
  const noLegs = ['ghost', 'smoke', 'flame', 'none', 'mounted'].includes(h.legs);
  const seated = h.legs === 'mounted' || h.legs === 'none';
  const legL = seated ? 0 : T * (h.legs === 'short' ? 0.28 : 0.4);
  const hover = h.hover ? h.hover + p.bob * 1.6 : 0;
  const base = G - hover;
  const hipY = base - legL + (p.crouch ? T * 0.05 : 0);
  const torsoL = T * 0.33;
  const lean = (p.lean || 0) * T * 0.5;
  const shY = hipY - torsoL + (seated || h.hover ? 0 : p.bob) + (p.crouch ? T * 0.02 : 0);
  const sx = cx + lean;
  const shw = T * 0.155 * b;
  const hpw = T * 0.11 * b;
  const hr = T * 0.125 * h.headK;
  const hx = sx + lean * 0.35;
  const hy = shY - hr * 0.92;
  const armL = T * 0.3;
  const armW = T * 0.078 * Math.sqrt(b);
  const legW = T * 0.092 * Math.sqrt(b);
  const cloth2 = h.cloth2 || shade(h.cloth, -0.3);
  const bare = h.armor === 'bare';
  const armC = bare || h.armor === 'vest' || h.sleeveless ? h.skin : h.armor === 'plate' ? h.metal : h.cloth;
  const flap = p.flap || 0;

  if (h.alphaK < 1) g.globalAlpha = h.alphaK;
  if (!seated) shadow(g, cx, G + 1, shw * 1.7 * (h.hover ? 0.8 : 1));
  if (h.glowC && h.aura) glow(g, sx, shY + torsoL * 0.3, T * 0.6, h.glowC, 0.45);

  // --- behind the body
  if (h.wings) {
    const S = T * 0.62 * h.wingK;
    const wc = h.wingC || (h.wings === 'feather' ? '#f4f0e8' : shade(h.skin, -0.25));
    const fn = h.wings === 'feather' ? featherWing : h.wings === 'bat' ? batWing : fairyWing;
    fn(g, sx - shw * 0.5, shY + T * 0.06, -1, S, wc, flap);
    fn(g, sx + shw * 0.5, shY + T * 0.06, 1, S, wc, flap);
  }
  if (h.cape) {
    const sway = (p.step || 0) * 2 + lean * 0.6;
    const bot = base - (noLegs ? T * 0.1 : legL * 0.22);
    blob(g, [sx - shw * 1.05, shY, sx + shw * 1.05, shY, sx + shw * 1.5 - sway, bot, sx - sway * 0.5, bot + T * 0.03, sx - shw * 1.7 - sway, bot],
      vgrad(g, shY, bot, h.cape, 0.2), INK, 1.5);
  }
  if (h.tail === 'devil') {
    const pts = [cx - hpw * 0.5, hipY, cx - hpw * 2.4, hipY + legL * 0.5, cx - hpw * 3.2, hipY + legL * 0.1, cx - hpw * 3.0, hipY - legL * 0.35];
    curve(g, pts, INK, T * 0.035 + 2);
    curve(g, pts, h.skin, T * 0.035);
    poly(g, [pts[6] - 3, pts[7], pts[6], pts[7] - 6, pts[6] + 3, pts[7]], h.skin, INK, 1);
  } else if (h.tail === 'lizard' || h.tail === 'fish') {
    taper(g, [cx - hpw * 0.4, hipY, cx - hpw * 1.8, hipY + legL * 0.55, cx - hpw * 3.2, hipY + legL * 0.8, cx - hpw * 4.2, hipY + legL * 0.55], h.skin, legW * 1.1, 1.5);
    if (h.tail === 'fish') poly(g, [cx - hpw * 4.0, hipY + legL * 0.55, cx - hpw * 5.2, hipY + legL * 0.2, cx - hpw * 5.0, hipY + legL * 0.95], h.trim, INK, 1);
  }
  if (h.pack) rrect(g, sx - shw * 1.5, shY + T * 0.02, shw * 1.4, torsoL * 0.85, 2, h.pack, INK, 1.4);

  // --- left arm (screen-left / shield arm) is drawn before the torso unless it reaches forward
  const shL = [sx - shw * 0.92, shY + T * 0.035];
  const shR = [sx + shw * 0.92, shY + T * 0.035];
  let handL = [shL[0] - T * 0.035, shY + armL * 0.98];
  const bowKinds = ['bow', 'longbow'];
  const isBow = bowKinds.includes(h.weapon);
  if (h.zombie) handL = [shL[0] + armL * 0.75, shY + T * 0.08 + p.bob];
  if (h.shield) handL = p.crouch ? [sx + shw * 0.2, shY + armL * 0.55] : [shL[0] - T * 0.01, shY + armL * 0.62];
  if (isBow && p.aim) handL = [sx + shw * 0.1, shY + T * 0.07];
  if (h.offhand) handL = [shL[0] - armL * 0.45, shY + armL * 0.55];
  const elbow = (a, bb, k) => [(a[0] + bb[0]) / 2 + k * (bb[1] - a[1]) * 0.18, (a[1] + bb[1]) / 2 - k * (bb[0] - a[0]) * 0.18 + armL * 0.08];
  const drawArm = (sh, hand, k) => {
    if (h.armless) return;
    const e = elbow(sh, hand, k);
    limb(g, [sh[0], sh[1], e[0], e[1], hand[0], hand[1]], armC, armW);
    circ(g, hand[0], hand[1], armW * 0.6, h.gloveC || h.skin, INK, 1.1);
    if (h.claws) for (const d of [-1, 0, 1]) line(g, [hand[0], hand[1], hand[0] + d * armW * 0.5 + (hand[0] - e[0]) * 0.25, hand[1] + armW * 0.9 + (hand[1] - e[1]) * 0.1], '#f4f0e0', 1.1);
  };
  const leftBehind = !(h.shield && p.crouch) && !h.zombie && !(isBow && p.aim);
  if (leftBehind) drawArm(shL, handL, -1);

  // --- legs
  if (!noLegs && h.armor !== 'robe') {
    const st = (p.step || 0) * T * 0.07;
    const legC = bare ? (h.legC || h.skin) : cloth2;
    for (const d of [-1, 1]) {
      const hip = [cx + d * hpw * 0.55, hipY];
      const foot = [cx + d * hpw * 0.95 + d * st, base - (d * (p.step || 0) > 0 ? T * 0.02 : 0)];
      const knee = [(hip[0] + foot[0]) / 2 + T * 0.02, (hip[1] + foot[1]) / 2];
      limb(g, [hip[0], hip[1], knee[0], knee[1], foot[0], foot[1] - legW * 0.3], legC, legW);
      if (h.legs === 'hooves') ell(g, foot[0] + 1, foot[1] - legW * 0.25, legW * 0.6, legW * 0.42, '#2a2018', INK, 1.1);
      else if (h.legs === 'talons') for (const t of [-1, 0, 1]) line(g, [foot[0], foot[1] - legW * 0.3, foot[0] + t * legW * 0.7 + 1, foot[1]], '#e8c040', 1.5);
      else ell(g, foot[0] + legW * 0.3, foot[1] - legW * 0.3, legW * 0.85, legW * 0.48, h.bootC || shade(cloth2, -0.35), INK, 1.2);
    }
  } else if (h.legs === 'mounted') {
    const hip = [cx + hpw * 0.3, hipY];
    limb(g, [hip[0], hip[1], hip[0] + T * 0.1, hip[1] + T * 0.12, hip[0] + T * 0.06, hip[1] + T * 0.27], bare ? h.skin : cloth2, legW);
    ell(g, hip[0] + T * 0.08, hip[1] + T * 0.28, legW * 0.8, legW * 0.45, h.bootC || shade(cloth2, -0.35), INK, 1.1);
  } else if (h.legs === 'ghost') {
    const c = h.cloth;
    const pts = [sx - shw, hipY - T * 0.05, sx + shw, hipY - T * 0.05];
    const n = 5;
    for (let i = 0; i <= n; i++) pts.push(cx + shw * 1.2 - (i / n) * shw * 2.6, base - (i % 2 ? T * 0.1 : 0) - T * 0.02);
    poly(g, pts, vgrad(g, hipY, base, c, 0.25), INK, 1.4);
  } else if (h.legs === 'smoke' || h.legs === 'flame') {
    const c = h.legs === 'flame' ? '#ff8a20' : h.smokeC || mix(h.skin, '#ffffff', 0.35);
    if (h.legs === 'flame') glow(g, cx, base - T * 0.12, T * 0.3, '#ff6010', 0.6);
    taper(g, [cx, hipY - 1, cx + hpw * 0.8, hipY + T * 0.14, cx - hpw * 0.6, hipY + T * 0.26, cx + hpw * 0.2, hipY + T * 0.36 + hover], c, hpw * 2.1, 1.5);
    if (h.legs === 'flame') taper(g, [cx, hipY + 2, cx + hpw * 0.5, hipY + T * 0.14, cx - hpw * 0.3, hipY + T * 0.24], '#ffe070', hpw * 1.1, 1, null);
  }

  // --- torso
  const tfill = vgrad(g, shY, hipY, bare ? h.skin : h.armor === 'plate' ? h.metal : h.cloth, 0.24);
  if (h.armor === 'robe') {
    const bot = h.hover ? base + T * 0.02 : base;
    const sway = (p.step || 0) * 1.5;
    blob(g, [sx - shw, shY, sx + shw, shY, sx + shw * 0.95, hipY - T * 0.05, cx + shw * 1.45 + sway, bot, cx - shw * 1.45 + sway, bot, sx - shw * 0.95, hipY - T * 0.05],
      vgrad(g, shY, bot, h.cloth, 0.24), INK, 1.6);
    rect(g, cx - shw * 1.25 + sway * 0.8, bot - T * 0.045, shw * 2.5, T * 0.035, h.trim, null);
    line(g, [sx, shY + T * 0.05, cx + sway * 0.5, bot - T * 0.05], h.trim, 1.5);
    line(g, [sx - shw * 0.9, hipY - T * 0.06, sx + shw * 0.9, hipY - T * 0.06], cloth2, 2.4);
  } else {
    if (h.armor === 'coat') {
      poly(g, [sx - shw * 0.95, hipY - 2, sx + shw * 0.95, hipY - 2, cx + shw * 1.15, hipY + legL * 0.5, cx + hpw * 0.2, hipY + legL * 0.42, cx - shw * 1.15, hipY + legL * 0.5],
        shade(h.cloth, -0.1), INK, 1.4);
    }
    const waist = h.belly ? 1 + h.belly : 1;
    blob(g, [sx - shw, shY - T * 0.01, sx, shY - T * 0.025, sx + shw, shY - T * 0.01, sx + shw * 0.92 * waist, (shY + hipY) / 2 + T * 0.03, cx + hpw * waist, hipY + T * 0.02, cx, hipY + T * 0.04, cx - hpw * waist, hipY + T * 0.02, sx - shw * 0.92 * waist, (shY + hipY) / 2 + T * 0.03],
      tfill, INK, 1.6);
    if (bare) {
      line(g, [sx - shw * 0.5, shY + torsoL * 0.38, sx - shw * 0.05, shY + torsoL * 0.42], shade(h.skin, -0.3), 1);
      line(g, [sx + shw * 0.05, shY + torsoL * 0.42, sx + shw * 0.5, shY + torsoL * 0.38], shade(h.skin, -0.3), 1);
      poly(g, [cx - hpw * 1.1 * waist, hipY - T * 0.04, cx + hpw * 1.1 * waist, hipY - T * 0.04, cx + hpw * 0.9, hipY + T * 0.09, cx, hipY + T * 0.13, cx - hpw * 0.9, hipY + T * 0.09], h.cloth, INK, 1.3);
    } else if (h.armor === 'plate') {
      curve(g, [sx - shw * 0.6, shY + torsoL * 0.2, sx, shY + torsoL * 0.5, sx + shw * 0.6, shY + torsoL * 0.2], shade(h.metal, -0.35), 1);
      line(g, [sx - shw * 0.5, shY + torsoL * 0.1, sx - shw * 0.2, shY + torsoL * 0.05], alpha('#ffffff', 0.7), 1.1);
      for (const d of [-1, 1]) ell(g, sx + d * shw * 0.95, shY + T * 0.02, armW * 0.85, armW * 0.7, h.up ? h.trim : h.metal, INK, 1.2);
      rect(g, cx - hpw * 1.05, hipY - T * 0.04, hpw * 2.1, T * 0.1, h.cloth, INK, 1.2);
    } else if (h.armor === 'leather' || h.armor === 'vest') {
      if (h.armor === 'vest') poly(g, [sx - shw * 0.35, shY, sx + shw * 0.35, shY, sx + shw * 0.2, hipY, sx - shw * 0.2, hipY], h.skin, null);
      line(g, [sx - shw * 0.8, shY + 1, cx + hpw * 0.8, hipY - 2], h.strapC || shade(h.cloth, -0.4), 2);
    } else if (h.armor === 'fur') {
      for (let i = -2; i <= 2; i++) poly(g, [cx + i * hpw * 0.45 - 2, hipY, cx + i * hpw * 0.45, hipY + T * 0.07, cx + i * hpw * 0.45 + 2, hipY], h.cloth, INK, 0.9);
    } else if (h.armor === 'coat') {
      line(g, [sx, shY + 2, cx, hipY + T * 0.03], shade(h.cloth, -0.4), 1.1);
      for (const t of [0.3, 0.6]) circ(g, sx + 2, shY + torsoL * t, 0.9, h.trim, null);
    }
    if (h.stripes) for (const t of [0.25, 0.5, 0.75]) line(g, [sx - shw * 0.85, shY + torsoL * t, sx + shw * 0.85, shY + torsoL * t], h.stripes, 1.6);
    if (!bare && h.armor !== 'plate') rect(g, cx - hpw * 1.02 * waist, hipY - T * 0.05, hpw * 2.04 * waist, T * 0.045, h.beltC || '#4a3020', INK, 0.9);
    if (!bare) circ(g, cx, hipY - T * 0.028, T * 0.02, h.trim, INK, 0.7);
  }
  if (h.emblem === 'cross') {
    rect(g, sx - T * 0.012, shY + torsoL * 0.2, T * 0.024, torsoL * 0.55, h.emblemC || '#c0392b', null);
    rect(g, sx - T * 0.06, shY + torsoL * 0.36, T * 0.12, T * 0.024, h.emblemC || '#c0392b', null);
  } else if (h.emblem === 'ribs') {
    for (const t of [0.2, 0.4, 0.6]) curve(g, [sx - shw * 0.7, shY + torsoL * t, sx, shY + torsoL * (t + 0.12), sx + shw * 0.7, shY + torsoL * t], INK, 1.3);
    line(g, [sx, shY, sx, hipY], INK, 1.3);
  } else if (h.emblem === 'gear') {
    star(g, sx, shY + torsoL * 0.45, T * 0.06, T * 0.042, 8, h.trim, INK, 0.9);
    circ(g, sx, shY + torsoL * 0.45, T * 0.02, INK, null);
  } else if (h.emblem === 'gem') {
    glow(g, sx, shY + torsoL * 0.4, T * 0.12, h.glowC || h.trim, 0.6);
    poly(g, [sx, shY + torsoL * 0.22, sx + T * 0.045, shY + torsoL * 0.4, sx, shY + torsoL * 0.6, sx - T * 0.045, shY + torsoL * 0.4], h.glowC || h.trim, INK, 0.9);
  } else if (h.emblem === 'cracks') {
    line(g, [sx - shw * 0.5, shY + torsoL * 0.2, sx - shw * 0.1, shY + torsoL * 0.5, sx - shw * 0.3, shY + torsoL * 0.8], h.glowC || INK, 1.3);
    line(g, [sx + shw * 0.5, shY + torsoL * 0.3, sx + shw * 0.2, shY + torsoL * 0.6], h.glowC || INK, 1.3);
  }
  if (h.up && h.armor !== 'bare' && h.armor !== 'robe' && h.armor !== 'plate') {
    line(g, [sx - shw * 0.8, shY + 1.5, sx + shw * 0.8, shY + 1.5], h.trim, 1.6);
  }

  // --- head
  drawHead(g, hx, hy, hr, h, p);

  // --- weapon arm
  const sw = p.swing || 0;
  const thrust = ['spear', 'pike', 'halberd', 'trident', 'pitchfork', 'lance', 'harpoon'].includes(h.weapon);
  const ranged = ['bow', 'longbow', 'crossbow', 'gun', 'pistol', 'blunderbuss', 'sling'].includes(h.weapon);
  let ha;
  let wa;
  if (p.aim && (ranged || h.weapon === 'staff' || h.weapon === 'skullstaff' || h.weapon === 'wand')) {
    ha = ranged ? 2 : -25;
    wa = ranged ? 0 : -40;
  } else if (h.zombie) {
    ha = 8 - sw * 20;
    wa = -20;
  } else if (thrust) {
    ha = sw < 0 ? lerp(62, 150, -sw) : lerp(62, 8, sw);
    wa = sw < 0 ? lerp(-86, -8, -sw) : lerp(-86, 4, sw);
  } else if (ranged && !isBow) {
    ha = 45;
    wa = -35;
  } else {
    const idleWa = isBow ? -90 : h.weapon === 'staff' || h.weapon === 'skullstaff' || h.weapon === 'scythe' || h.weapon === 'broom' ? -88 : -62;
    ha = sw < 0 ? lerp(58, -70, -sw) : lerp(58, 8, sw);
    wa = sw < 0 ? lerp(idleWa, -118, -sw) : lerp(idleWa, 22, sw);
  }
  const har = (ha * Math.PI) / 180;
  const handR = [shR[0] + Math.cos(har) * armL * 0.95, shR[1] + Math.sin(har) * armL * 0.95];
  if (!leftBehind && !(h.shield && p.crouch)) drawArm(shL, handL, -1);
  if (h.offhand) {
    at(g, handL[0], handL[1], ((-180 - wa) * Math.PI) / 180, 1, 1, () => drawWeapon(g, h.offhand, T * 0.42 * (h.weaponK || 1), h));
  }
  if (h.shield && !p.crouch) drawShield(g, handL[0] - T * 0.02, handL[1], T * 0.15 * (h.shieldK || 1), h.shield, h);
  if (h.weapon && !h.armless) {
    const spec2 = { ...h, _pull: isBow && p.aim && !p.loose ? 1 : 0, _flash: p.loose };
    const L = T * 0.46 * (h.weaponK || 1);
    const behind = isBow;
    if (behind) at(g, handR[0], handR[1], (wa * Math.PI) / 180 + (p.aim ? 0 : Math.PI / 2), 1, 1, () => drawWeapon(g, h.weapon, L, spec2));
    drawArm(shR, handR, 1);
    if (!behind) at(g, handR[0], handR[1], (wa * Math.PI) / 180, 1, 1, () => drawWeapon(g, h.weapon, L, spec2));
    circ(g, handR[0], handR[1], armW * 0.55, h.gloveC || h.skin, INK, 1);
    if (p.aim && p.loose && !ranged) {
      glow(g, handR[0] + T * 0.3, handR[1] - T * 0.25, T * 0.3, h.glowC || h.trim, 0.8);
      star(g, handR[0] + T * 0.3, handR[1] - T * 0.25, T * 0.14, T * 0.05, 6, '#ffffff', null);
    }
  } else {
    drawArm(shR, h.zombie ? [shR[0] + armL * 0.8, shY + T * 0.03 - p.bob] : handR, 1);
    if (p.aim && p.loose && h.castC) {
      glow(g, handR[0] + T * 0.1, handR[1], T * 0.3, h.castC, 0.8);
      star(g, handR[0] + T * 0.1, handR[1], T * 0.14, T * 0.05, 6, '#ffffff', null);
    }
  }
  if (h.shield && p.crouch) {
    drawArm(shL, handL, -1);
    drawShield(g, handL[0] + T * 0.03, handL[1] + T * 0.02, T * 0.19 * (h.shieldK || 1), h.shield, h);
  }
  if (h.alphaK < 1) g.globalAlpha = 1;
  return { top: hy - hr, hx, hy, hr, handX: handR[0], handY: handR[1], shY, hipY, sx };
}
