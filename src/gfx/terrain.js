// `terrain` kind: ground tiles (several variants each, animated water/lava), blended edge fringes,
// roads and rivers by neighbour bitmask, magic-terrain overlays, fog of war / shroud tiles and the
// drawTerrainTile() compositor. Design grid: 32 x 32 units per tile.

import { TERRAIN_DATA, TERRAIN_BY_ID, ROADS, ROAD_BY_ID, ROAD_BY_INDEX, RIVERS, RIVER_BY_ID, MAGIC_TERRAINS, MAGIC_TERRAIN_BY_ID } from '../data/terrain.js';
import { alpha, circ, curve, ell, glow, hashStr, lgrad, line, mix, poly, rect, rgrad, seeded, shade, star } from './kit.js';

export const TILE = 32;

/** Neighbour order used by every mask in this module: N, E, S, W, NE, SE, SW, NW. */
export const DIRS8 = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

/** Later entries bleed over earlier ones at borders. */
export const TERRAIN_PRIORITY = ['water', 'sand', 'dirt', 'wasteland', 'rough', 'subterranean', 'lava', 'swamp', 'highlands', 'grass', 'snow', 'rock'];

const RIVER_BY_INDEX = Object.fromEntries(RIVERS.map((r) => [r.index, r]));

export const TERRAIN_SPRITE_IDS = [
  ...TERRAIN_DATA.map((t) => t.id), ...ROADS.map((r) => r.id), ...RIVERS.map((r) => r.id), ...MAGIC_TERRAINS.map((m) => m.id),
  'shroud', 'fog',
];

const VARIANTS = 4;
const ANIMATED = { water: 4, lava: 4 };

/** How many distinct base variants a terrain has. */
export function terrainVariantCount() {
  return VARIANTS;
}

/** Build a mask (bit i = DIRS8[i]) from 8 booleans / truthy values. */
export function roadMask(neighbours) {
  let m = 0;
  for (let i = 0; i < 8; i++) if (neighbours[i]) m |= 1 << i;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Base tiles
// ---------------------------------------------------------------------------------------------

function speckle(g, r, colors, n, sizeMax = 2) {
  for (let i = 0; i < n; i++) {
    const s = r.i(1, sizeMax);
    g.fillStyle = colors[r.i(0, colors.length - 1)];
    g.fillRect(r.i(0, TILE - s), r.i(0, TILE - s), s, s);
  }
}

function paintTerrain(g, t, variant, frame) {
  const [base, light, dark, accent] = t.colors;
  const r = seeded(`terrain:${t.id}:${variant}`);
  g.fillStyle = base;
  g.fillRect(0, 0, TILE, TILE);
  switch (t.id) {
    case 'grass': case 'highlands': {
      speckle(g, r, [light, dark, mix(base, dark, 0.5)], 70);
      for (let i = 0; i < 9; i++) {
        const x = r.i(3, 28);
        const y = r.i(5, 29);
        line(g, [x - 1.5, y - 2.5, x, y, x + 1.5, y - 3], i % 3 ? dark : light, 0.8);
      }
      if (t.id === 'grass') for (let i = 0; i < r.i(0, 3); i++) rect(g, r.i(3, 28), r.i(3, 28), 1.2, 1.2, i % 2 ? accent : '#f4f0e0', null);
      else for (let i = 0; i < r.i(1, 3); i++) ell(g, r.i(4, 27), r.i(4, 27), r.f(1.2, 2.4), r.f(0.9, 1.5), accent, shade(accent, -0.3), 0.5);
      break;
    }
    case 'dirt': {
      speckle(g, r, [light, dark, mix(base, dark, 0.5)], 80);
      for (let i = 0; i < 4; i++) ell(g, r.i(4, 27), r.i(4, 27), r.f(0.8, 1.8), r.f(0.6, 1.2), accent, null);
      for (let i = 0; i < 2; i++) {
        const x = r.i(5, 24);
        const y = r.i(5, 24);
        line(g, [x, y, x + r.f(2, 4), y + r.f(-1, 2), x + r.f(4, 7), y + r.f(1, 4)], alpha(accent, 0.7), 0.6);
      }
      break;
    }
    case 'sand': {
      speckle(g, r, [light, mix(base, dark, 0.4)], 50);
      for (let i = 0; i < 4; i++) {
        const y = 4 + i * 7 + r.f(-1.5, 1.5);
        const x = r.i(2, 10);
        curve(g, [x, y, x + 5, y - 1.6, x + 11, y + 0.6, x + r.i(14, 19), y - 1], alpha(i % 2 ? dark : light, 0.8), 0.8);
      }
      for (let i = 0; i < 2; i++) rect(g, r.i(3, 28), r.i(3, 28), 1, 1, accent, null);
      break;
    }
    case 'snow': {
      speckle(g, r, [light, mix(base, dark, 0.35)], 36);
      for (let i = 0; i < 3; i++) {
        const x = r.i(3, 14);
        const y = r.i(6, 27);
        curve(g, [x, y, x + 5, y - 2.6, x + 11, y - 1, x + 15, y + 0.6], alpha(dark, 0.85), 1);
        curve(g, [x + 1, y + 1.2, x + 6, y - 1.2, x + 12, y + 0.4], alpha(accent, 0.45), 0.7);
      }
      for (let i = 0; i < 4; i++) rect(g, r.i(2, 29), r.i(2, 29), 1, 1, '#ffffff', null);
      break;
    }
    case 'swamp': {
      speckle(g, r, [light, dark, mix(base, dark, 0.5)], 70);
      for (let i = 0; i < r.i(1, 2); i++) {
        const x = r.i(8, 23);
        const y = r.i(8, 23);
        ell(g, x, y, r.f(3.5, 6), r.f(2, 3.4), accent, alpha(dark, 0.9), 0.7);
        line(g, [x - 2, y - 0.6, x + 1, y - 0.6], alpha('#9ad0c0', 0.6), 0.6);
      }
      for (let i = 0; i < 5; i++) {
        const x = r.i(3, 28);
        const y = r.i(6, 29);
        line(g, [x, y, x + r.f(-0.8, 0.8), y - r.f(2.5, 4.5)], i % 2 ? light : '#8a8a3a', 0.7);
      }
      break;
    }
    case 'rough': case 'wasteland': {
      speckle(g, r, [light, dark, mix(base, dark, 0.5)], 70);
      const n = t.id === 'wasteland' ? 3 : 2;
      for (let i = 0; i < n; i++) {
        let x = r.i(4, 14);
        let y = r.i(4, 26);
        const pts = [x, y];
        for (let k = 0; k < 4; k++) {
          x += r.f(2.5, 4.5);
          y += r.f(-2.6, 2.6);
          pts.push(Math.min(29, x), Math.max(2, Math.min(29, y)));
        }
        line(g, pts, alpha(accent, 0.85), 0.7);
      }
      for (let i = 0; i < (t.id === 'rough' ? 4 : 2); i++) {
        const x = r.i(4, 27);
        const y = r.i(4, 27);
        ell(g, x, y, r.f(1.2, 2.3), r.f(0.9, 1.6), light, accent, 0.5);
      }
      break;
    }
    case 'subterranean': {
      speckle(g, r, [light, dark, mix(base, dark, 0.5)], 60);
      for (let i = 0; i < 3; i++) {
        const x = r.i(3, 18);
        const y = r.i(4, 26);
        line(g, [x, y, x + r.f(3, 6), y + r.f(-2, 2), x + r.f(7, 11), y + r.f(-1, 3)], alpha(dark, 0.9), 0.8);
      }
      for (let i = 0; i < r.i(0, 2); i++) {
        const x = r.i(5, 26);
        const y = r.i(6, 26);
        poly(g, [x - 1.2, y, x, y - 3.2, x + 1.2, y], accent, alpha('#1a1016', 0.8), 0.4);
      }
      break;
    }
    case 'lava': {
      speckle(g, r, [light, dark, mix(base, dark, 0.5)], 60);
      for (let i = 0; i < 3; i++) {
        let x = r.i(3, 12);
        let y = r.i(4, 27);
        const pts = [x, y];
        for (let k = 0; k < 4; k++) {
          x += r.f(3, 5);
          y += r.f(-3, 3);
          pts.push(Math.min(29, x), Math.max(2, Math.min(29, y)));
        }
        const hot = (i + frame) % 4;
        line(g, pts, alpha(accent, 0.35), 2.2);
        line(g, pts, hot === 0 ? '#ffd060' : hot === 1 ? '#ff9a30' : accent, 0.8);
      }
      break;
    }
    case 'water': {
      speckle(g, r, [light, dark], 26, 2);
      for (let i = 0; i < 6; i++) {
        const y = 3 + i * 5 + r.f(-1, 1);
        const x = (r.i(0, 31) + frame * 4 + i * 5) % 22 + 2;
        const w = r.f(4, 7);
        curve(g, [x, y, x + w * 0.5, y - 1.3, x + w, y], i % 3 === 0 ? alpha(accent, 0.75) : alpha(light, 0.9), 0.8);
      }
      break;
    }
    default: { // rock
      speckle(g, r, [light, dark], 50);
      for (let i = 0; i < 4; i++) {
        const x = r.i(4, 24);
        const y = r.i(6, 26);
        poly(g, [x, y, x + r.f(2, 4), y - r.f(3, 5), x + r.f(5, 7), y - r.f(0, 1.5), x + r.f(3, 5), y + r.f(1, 2.5)], light, alpha(accent, 0.8), 0.5);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Edge fringes (transparent tiles with terrain `t` creeping in from one side / corner)
// ---------------------------------------------------------------------------------------------

function paintEdge(g, t, dir, foam) {
  const [base, light, dark] = t.colors;
  const r = seeded(`edge:${t.id}:${dir}`);
  g.save();
  g.translate(16, 16);
  g.rotate((dir % 4) * (Math.PI / 2));
  g.translate(-16, -16);
  if (dir < 4) {
    // fringe along the top side
    g.fillStyle = lgrad(g, 0, 0, 0, 13, [[0, alpha(base, 0.95)], [0.45, alpha(base, 0.55)], [1, alpha(base, 0)]]);
    g.fillRect(0, 0, TILE, 13);
    for (let x = 0; x < TILE; x += 2) {
      const d = 3 + r.i(0, 5);
      g.fillStyle = r.chance(0.25) ? light : r.chance(0.2) ? dark : base;
      g.fillRect(x, 0, 2, d);
      if (r.chance(0.5)) {
        g.fillStyle = base;
        g.fillRect(x + r.i(0, 1), d + r.i(1, 4), 1, 1);
      }
      if (foam && r.chance(0.6)) {
        g.fillStyle = alpha('#ffffff', 0.75);
        g.fillRect(x, d, 2, 1);
      }
    }
  } else {
    // dir 4 = NE corner before rotation -> draw in the top-right corner
    g.fillStyle = rgrad(g, TILE, 0, 0, 11, [[0, alpha(base, 0.95)], [0.5, alpha(base, 0.6)], [1, alpha(base, 0)]]);
    g.fillRect(TILE - 11, 0, 11, 11);
    for (let i = 0; i < 16; i++) {
      const a = r.f(0, Math.PI / 2);
      const d = r.f(0, 8.5);
      g.fillStyle = r.chance(0.25) ? light : base;
      g.fillRect(Math.floor(TILE - 2 - Math.cos(a) * d), Math.floor(Math.sin(a) * d), 2, 2);
    }
    if (foam) {
      g.fillStyle = alpha('#ffffff', 0.7);
      for (let i = 0; i < 4; i++) g.fillRect(TILE - 9 + i * 2, 6 - i, 2, 1);
    }
  }
  g.restore();
}

// ---------------------------------------------------------------------------------------------
// Roads and rivers
// ---------------------------------------------------------------------------------------------

function paintRoad(g, road, mask) {
  const r = seeded(`road:${road.id}:${mask}`);
  const ends = [];
  for (let i = 0; i < 8; i++) if (mask & (1 << i)) ends.push([16 + DIRS8[i][0] * 17, 16 + DIRS8[i][1] * 17, i]);
  const seg = (color, w) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    if (!ends.length) {
      g.moveTo(15, 16);
      g.lineTo(17, 16);
    }
    for (const [x, y] of ends) {
      g.moveTo(16, 16);
      g.lineTo(x, y);
    }
    g.stroke();
  };
  seg(alpha(road.edge, 0.55), 12.5);
  seg(road.edge, 10.5);
  seg(road.color, 8.5);
  // surface texture along every arm
  const arms = ends.length ? ends : [[16, 16, -1]];
  for (const [ex, ey] of arms) {
    const len = Math.hypot(ex - 16, ey - 16) || 1;
    const ux = (ex - 16) / len;
    const uy = (ey - 16) / len;
    for (let d = 0; d < Math.max(len, 3); d += 2.6) {
      for (const side of [-2.4, 0, 2.4]) {
        const x = 16 + ux * d - uy * side + r.f(-0.6, 0.6);
        const y = 16 + uy * d + ux * side + r.f(-0.6, 0.6);
        if (x < 0.5 || y < 0.5 || x > 31.5 || y > 31.5) continue;
        if (road.id === 'cobblestone_road') ell(g, x, y, 1.2, 1, r.chance(0.5) ? shade(road.color, 0.22) : shade(road.color, -0.1), alpha(road.edge, 0.9), 0.35);
        else if (road.id === 'gravel_road') rect(g, x, y, 1, 1, r.chance(0.5) ? shade(road.color, 0.3) : shade(road.color, -0.25), null);
        else if (side !== 0 && r.chance(0.7)) rect(g, x, y, 1.6, 0.8, shade(road.color, -0.22), null);
      }
    }
  }
}

function paintRiver(g, river, mask, frame) {
  const r = seeded(`river:${river.id}:${mask}`);
  const m = mask & 15;
  const ends = [];
  for (let i = 0; i < 4; i++) if (m & (1 << i)) ends.push([16 + DIRS8[i][0] * 17, 16 + DIRS8[i][1] * 17]);
  const cx = 16 + r.f(-2, 2);
  const cy = 16 + r.f(-2, 2);
  const lava = river.id === 'lava_river';
  const stroke = (color, w) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    if (!ends.length) {
      g.moveTo(cx - 1, cy);
      g.lineTo(cx + 1, cy);
    }
    for (const [x, y] of ends) {
      g.moveTo(cx, cy);
      g.quadraticCurveTo((cx + x) / 2 + (y - cy) * 0.12, (cy + y) / 2 - (x - cx) * 0.12, x, y);
    }
    g.stroke();
  };
  if (lava) stroke(alpha('#ff7020', 0.3), 13);
  stroke(alpha(shade(river.color, -0.55), 0.75), 10);
  stroke(shade(river.color, -0.25), 8);
  stroke(river.color, 6);
  const hi = lava ? '#ffd060' : shade(river.color, 0.45);
  for (const [x, y] of ends.length ? ends : [[cx, cy]]) {
    for (let k = 0; k < 3; k++) {
      const t = ((k + frame * 0.25) % 3) / 3 + 0.12;
      const px = cx + (x - cx) * t + r.f(-1.2, 1.2);
      const py = cy + (y - cy) * t + r.f(-1.2, 1.2);
      if (px < 1 || py < 1 || px > 30 || py > 30) continue;
      const horiz = Math.abs(x - cx) > Math.abs(y - cy);
      line(g, horiz ? [px - 1.5, py, px + 1.5, py] : [px, py - 1.5, px, py + 1.5], alpha(hi, 0.85), 0.8);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Magic terrain overlays, shroud / fog
// ---------------------------------------------------------------------------------------------

function paintOverlay(g, m, variant, frame) {
  const r = seeded(`overlay:${m.id}:${variant}`);
  const c = m.color;
  g.fillStyle = alpha(c, m.id === 'cursed_ground' || m.id === 'evil_fog' ? 0.42 : 0.3);
  g.fillRect(0, 0, TILE, TILE);
  const spots = () => [r.i(5, 27), r.i(5, 27)];
  switch (m.id) {
    case 'magic_plains': case 'fields_of_glory': case 'holy_ground':
      for (let i = 0; i < 4; i++) {
        const [x, y] = spots();
        star(g, x, y, (i + frame) % 2 ? 2.6 : 1.8, 0.7, 4, alpha(shade(c, 0.55), 0.95), null);
      }
      if (m.id === 'holy_ground') {
        rect(g, 15.2, 9, 1.6, 12, alpha('#ffffff', 0.6), null);
        rect(g, 11.5, 12.5, 9, 1.6, alpha('#ffffff', 0.6), null);
      }
      break;
    case 'cursed_ground':
      for (let i = 0; i < 2; i++) {
        const [x, y] = spots();
        circ(g, x, y, 2.6, alpha('#d8d0c0', 0.75), alpha('#1a1410', 0.8), 0.5);
        rect(g, x - 1.4, y - 0.8, 1, 1, '#1a1410', null);
        rect(g, x + 0.5, y - 0.8, 1, 1, '#1a1410', null);
      }
      for (let i = 0; i < 3; i++) {
        const [x, y] = spots();
        line(g, [x, y, x + 3, y - 2, x + 5, y + 1], alpha('#1a1410', 0.6), 0.6);
      }
      break;
    case 'evil_fog': case 'magic_clouds':
      for (let i = 0; i < 4; i++) {
        const [x, y] = spots();
        ell(g, x + ((frame + i) % 2), y, r.f(4, 7), r.f(2, 3), alpha(shade(c, m.id === 'evil_fog' ? -0.2 : 0.4), 0.5), null);
      }
      break;
    case 'clover_field':
      for (let i = 0; i < 5; i++) {
        const [x, y] = spots();
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1]]) circ(g, x + dx, y + dy, 1, shade(c, 0.2), alpha('#1a3a1a', 0.7), 0.3);
        line(g, [x, y + 1, x + 0.5, y + 2.6], '#1a5a2a', 0.5);
      }
      break;
    case 'lucid_pools': case 'cracked_ice':
      for (let i = 0; i < 3; i++) {
        const [x, y] = spots();
        if (m.id === 'lucid_pools') ell(g, x, y, r.f(3, 5), r.f(1.6, 2.6), alpha(shade(c, 0.3), 0.75), alpha('#ffffff', 0.7), 0.5);
        else line(g, [x - 4, y, x, y + r.f(-2, 2), x + 2, y + 3, x, y + r.f(-2, 2), x + 4, y - 3], alpha('#ffffff', 0.85), 0.6);
      }
      break;
    case 'fiery_fields':
      for (let i = 0; i < 4; i++) {
        const [x, y] = spots();
        const hgt = 4 + ((i + frame) % 2);
        poly(g, [x - 1.6, y, x - 0.6, y - hgt * 0.6, x, y - hgt, x + 0.8, y - hgt * 0.5, x + 1.6, y], '#ff9a30', '#c03a10', 0.4);
        glow(g, x, y - 2, 4, '#ff7020', 0.5);
      }
      break;
    case 'rocklands':
      for (let i = 0; i < 5; i++) {
        const [x, y] = spots();
        poly(g, [x - 2, y + 1, x - 1, y - 1.6, x + 1.4, y - 2, x + 2.4, y + 0.6, x + 0.6, y + 1.8], shade(c, 0.1), alpha('#1a1410', 0.8), 0.5);
      }
      break;
    case 'dunes':
      for (let i = 0; i < 3; i++) curve(g, [2, 7 + i * 9, 10, 3 + i * 9, 20, 9 + i * 9, 30, 5 + i * 9], alpha(shade(c, -0.25), 0.8), 1);
      break;
    case 'favorable_winds':
      for (let i = 0; i < 3; i++) {
        const y = 7 + i * 9;
        const x = 3 + ((frame * 3 + i * 4) % 8);
        curve(g, [x, y, x + 8, y - 2, x + 14, y, x + 18, y - 3], alpha('#ffffff', 0.8), 0.8);
        line(g, [x + 16, y - 4.4, x + 18.4, y - 3, x + 16.2, y - 1.2], alpha('#ffffff', 0.8), 0.8);
      }
      break;
    default:
      for (let i = 0; i < 4; i++) {
        const [x, y] = spots();
        circ(g, x, y, 1.2, alpha(shade(c, 0.4), 0.8), null);
      }
      break;
  }
}

function paintShroud(g, id, variant) {
  const fog = id === 'fog';
  const c = fog ? '#0e1018' : '#0a0806';
  const a = fog ? 0.5 : 1;
  if (variant === 'full') {
    g.fillStyle = alpha(c, a);
    g.fillRect(0, 0, TILE, TILE);
    if (!fog) {
      const r = seeded('shroud');
      for (let i = 0; i < 26; i++) {
        g.fillStyle = alpha(r.chance(0.5) ? '#241c18' : '#16110e', 0.9);
        g.fillRect(r.i(0, 30), r.i(0, 30), 2, 2);
      }
    }
    return;
  }
  const mask = variant | 0;
  const D = 15;
  const stops = [[0, alpha(c, a * 0.95)], [0.45, alpha(c, a * 0.5)], [1, alpha(c, 0)]];
  const sides = [[0, 0, 0, D, 0, 0, TILE, D], [TILE, 0, TILE - D, 0, TILE - D, 0, D, TILE], [0, TILE, 0, TILE - D, 0, TILE - D, TILE, D], [0, 0, D, 0, 0, 0, D, TILE]];
  for (let i = 0; i < 4; i++) {
    if (!(mask & (1 << i))) continue;
    const [x0, y0, x1, y1, rx, ry, rw, rh] = sides[i];
    g.fillStyle = lgrad(g, x0, y0, x1, y1, stops);
    g.fillRect(rx, ry, rw, rh);
  }
  const corners = [[TILE, 0, 0, 1], [TILE, TILE, 1, 2], [0, TILE, 2, 3], [0, 0, 3, 0]];
  for (let i = 0; i < 4; i++) {
    const [x, y, s1, s2] = corners[i];
    if (!(mask & (1 << (4 + i))) || mask & (1 << s1) || mask & (1 << s2)) continue;
    g.fillStyle = rgrad(g, x, y, 0, D, stops);
    g.fillRect(x ? TILE - D : 0, y ? TILE - D : 0, D, D);
  }
}

// ---------------------------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------------------------

/**
 * ids: terrain ids | road ids | river ids | magic terrain ids | 'shroud' | 'fog'.
 * opts: size (tile px), variant, frame, state.
 *   terrain: variant 0..3 (or any int, wrapped); variant 'edge' / 'shore' + state 0..7 (DIRS8) = fringe
 *   road: variant = 8-bit neighbour mask;  river: variant = 4-bit mask (N,E,S,W), frame 0..3
 *   magic terrain: variant 0..1, frame 0..1;  shroud/fog: variant 'full' (default) or 8-bit mask
 */
export function terrainHandler(id, o) {
  const base = { dw: TILE, dh: TILE, unit: TILE, size: 32 };
  const t = TERRAIN_BY_ID[id];
  if (t) {
    if (o.variant === 'edge' || o.variant === 'shore') {
      const dir = (((o.state | 0) % 8) + 8) % 8;
      const foam = o.variant === 'shore';
      return { ...base, key: `${o.variant}|${dir}`, paint: (g) => paintEdge(g, t, dir, foam) };
    }
    const variant = ((((o.variant | 0) % VARIANTS) + VARIANTS) % VARIANTS);
    const nf = ANIMATED[id] || 1;
    const frame = ((((o.frame | 0) % nf) + nf) % nf);
    return { ...base, frames: nf, key: `${variant}|${frame}`, paint: (g) => paintTerrain(g, t, variant, frame) };
  }
  const road = ROAD_BY_ID[id];
  if (road) {
    const mask = (o.variant | 0) & 255;
    return { ...base, key: `${mask}`, paint: (g) => paintRoad(g, road, mask) };
  }
  const river = RIVER_BY_ID[id];
  if (river) {
    const mask = (o.variant | 0) & 15;
    const frame = (((o.frame | 0) % 4) + 4) % 4;
    return { ...base, frames: 4, key: `${mask}|${frame}`, paint: (g) => paintRiver(g, river, mask, frame) };
  }
  const magic = MAGIC_TERRAIN_BY_ID[id];
  if (magic) {
    const variant = (o.variant | 0) & 1;
    const frame = (o.frame | 0) & 1;
    return { ...base, frames: 2, key: `${variant}|${frame}`, paint: (g) => paintOverlay(g, magic, variant, frame) };
  }
  if (id === 'shroud' || id === 'fog') {
    const variant = o.variant === undefined || o.variant === 'full' ? 'full' : (o.variant | 0) & 255;
    return { ...base, key: `${variant}`, paint: (g) => paintShroud(g, id, variant) };
  }
  throw new Error(`gfx: unknown terrain sprite '${id}'`);
}

// ---------------------------------------------------------------------------------------------
// Compositor
// ---------------------------------------------------------------------------------------------

let spriteGetter = null;

/** index.js injects getSprite here (avoids a circular import). */
export function setTerrainSpriteGetter(fn) {
  spriteGetter = fn;
}

// Optional texture painter from the asset-pack layer (src/gfx/packs, docs/mechanics/asset-packs.md):
// { base(ctx,x,y,size,terrain,info) -> bool, edge(ctx,x,y,size,terrain,edgeCanvas,info,kind) -> bool }.
// When it returns false (unmapped terrain, texture not loaded yet) the procedural tile is drawn.
let packPainter = null;

/** index.js injects the pack terrain painter here (null = procedural only). */
export function setTerrainPackPainter(p) {
  packPainter = p || null;
}

const prio = (id) => TERRAIN_PRIORITY.indexOf(id);

/**
 * Draw one fully composed map tile: base terrain, blended fringes of higher-priority neighbours,
 * river, road and magic overlay.
 * @param ctx  destination 2D context
 * @param x,y  destination top-left in pixels
 * @param size tile size in pixels
 * @param info { terrain, variant?, seed?, frame?, neighbors?: (terrainId|null)[8] in DIRS8 order,
 *               road?: id|index, roadMask?, river?: id|index, riverMask?, overlay?: magicTerrainId }
 */
export function drawTerrainTile(ctx, x, y, size, info) {
  const get = spriteGetter;
  if (!get) throw new Error('gfx: drawTerrainTile used before index.js initialised');
  const own = info.terrain;
  const variant = info.variant !== undefined ? info.variant : hashStr(`v:${info.seed ?? `${x},${y}`}`) % VARIANTS;
  const frame = info.frame | 0;
  if (!(packPainter && packPainter.base(ctx, x, y, size, own, info))) ctx.drawImage(get('terrain', own, { size, variant, frame }), x, y);
  const nb = info.neighbors;
  if (nb) {
    const p0 = prio(own);
    const edgeKind = own === 'water' ? 'shore' : 'edge';
    const order = [];
    for (let i = 0; i < 8; i++) {
      const t = nb[i];
      if (!t || t === own || !TERRAIN_BY_ID[t] || prio(t) <= p0) continue;
      if (i >= 4) {
        // skip a corner when one of its two sides already brings the same terrain in
        const s1 = i - 4;
        const s2 = (i - 3) % 4;
        if (nb[s1] === t || nb[s2] === t) continue;
      }
      order.push([prio(t), t, i]);
    }
    order.sort((a, b) => a[0] - b[0]);
    for (const [, t, i] of order) {
      const edge = get('terrain', t, { size, variant: edgeKind, state: i });
      if (!(packPainter && packPainter.edge(ctx, x, y, size, t, edge, info, edgeKind))) ctx.drawImage(edge, x, y);
    }
  }
  if (info.river) {
    const rv = typeof info.river === 'number' ? RIVER_BY_INDEX[info.river] : RIVER_BY_ID[info.river];
    if (rv) ctx.drawImage(get('terrain', rv.id, { size, variant: info.riverMask | 0, frame }), x, y);
  }
  if (info.road) {
    const rd = typeof info.road === 'number' ? ROAD_BY_INDEX[info.road] : ROAD_BY_ID[info.road];
    if (rd) ctx.drawImage(get('terrain', rd.id, { size, variant: info.roadMask | 0 }), x, y);
  }
  if (info.overlay && MAGIC_TERRAIN_BY_ID[info.overlay]) {
    ctx.drawImage(get('terrain', info.overlay, { size, variant: variant & 1, frame: frame & 1 }), x, y);
  }
}
