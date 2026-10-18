// `object` kind: adventure-map objects. Canvas covers the object's footprint (size = [w, h] tiles,
// 32 design units per tile). Dedicated painters per data `shape` (plus id-specific touches), a
// generic fallback for anything else, and ownership flags in player colours.

import { MAP_OBJECTS, MAP_OBJECT_BY_ID, DWELLING_TABLE } from '../data/mapObjects.js';
import { FACTIONS } from '../core/constants.js';
import {
  INK, alpha, blob, circ, curve, ell, flag, glow, line, mix, paint, poly, rect, rrect, seeded, shade, star, vgrad, lgrad, at,
} from './kit.js';
import { factionPalette, playerColorHex, RESOURCE_HEX } from './palette.js';
import { house, tower, tent, wallSeg, tree, mountain, rock, crystals, cave, pool, temple, hull } from './structures.js';
import { paintCreature, creatureSpec } from './creatures.js';

export const OBJECT_IDS = MAP_OBJECTS.map((o) => o.id);
const T = 32;

const DWELLING_CREATURE = {};
for (const row of DWELLING_TABLE) DWELLING_CREATURE[row[2]] = { faction: row[0], tier: row[1], creature: row[4] && row[4][0] };

/** Footprint info for the UI: tiles, pixel size at `size` px/tile, entrance anchor. */
export function getObjectSpriteInfo(id, size = 32) {
  const d = MAP_OBJECT_BY_ID[id];
  const [w, h] = d ? d.size : [1, 1];
  return { tilesW: w, tilesH: h, width: w * size, height: h * size, entranceX: Math.floor(w / 2), entranceY: h - 1 };
}

const RES_OF = (id) => ['wood', 'ore', 'mercury', 'sulfur', 'crystal', 'gems', 'gold'].find((r) => id.includes(r));

// --- small resource glyphs reused by piles, mines, warehouses ------------------------------------
export function resourceGlyph(g, res, x, y, s) {
  const c = RESOURCE_HEX[res] || '#c0c0c0';
  switch (res) {
    case 'wood':
      for (const [dx, dy] of [[-0.25, 0], [0.25, 0], [0, -0.3]]) {
        rrect(g, x + dx * s - s * 0.32, y + dy * s - s * 0.13, s * 0.64, s * 0.26, s * 0.12, vgrad(g, y + dy * s - s * 0.13, y + dy * s + s * 0.13, c, 0.2), INK, 0.8);
        circ(g, x + dx * s + s * 0.3, y + dy * s, s * 0.11, '#d8b080', INK, 0.6);
      }
      break;
    case 'ore':
      for (const [dx, dy, k] of [[-0.25, 0, 0.5], [0.22, 0.02, 0.45], [0, -0.25, 0.5]]) rock(g, x + dx * s, y + dy * s + s * 0.15, s * k, c, null, 0.8);
      break;
    case 'mercury':
      ell(g, x, y + s * 0.15, s * 0.34, s * 0.3, vgrad(g, y - s * 0.2, y + s * 0.4, c, 0.4), INK, 0.8);
      rect(g, x - s * 0.1, y - s * 0.35, s * 0.2, s * 0.25, '#8a8a92', INK, 0.8);
      circ(g, x - s * 0.1, y + s * 0.05, s * 0.08, '#ffffff', null);
      break;
    case 'sulfur':
      blob(g, [x - s * 0.45, y + s * 0.3, x - s * 0.2, y - s * 0.2, x + s * 0.1, y - s * 0.32, x + s * 0.42, y + s * 0.3], vgrad(g, y - s * 0.3, y + s * 0.3, c, 0.3), INK, 0.8);
      break;
    case 'crystal':
      crystals(g, x, y + s * 0.35, s * 0.7, c, 0.8);
      break;
    case 'gems':
      for (const [dx, dy, col] of [[-0.22, 0.1, c], [0.22, 0.12, '#5a8ae8'], [0, -0.15, '#e8d040']]) {
        poly(g, [x + dx * s - s * 0.16, y + dy * s, x + dx * s, y + dy * s - s * 0.16, x + dx * s + s * 0.16, y + dy * s, x + dx * s, y + dy * s + s * 0.18], col, INK, 0.7);
      }
      break;
    case 'gold':
      for (const [dx, dy] of [[-0.22, 0.18], [0.2, 0.18], [0, 0.05], [-0.1, -0.08], [0.12, -0.12]]) {
        ell(g, x + dx * s, y + dy * s, s * 0.2, s * 0.09, vgrad(g, y + dy * s - 2, y + dy * s + 2, c, 0.3), INK, 0.6);
      }
      star(g, x + s * 0.2, y - s * 0.3, s * 0.12, s * 0.04, 4, '#ffffff', null);
      break;
    default:
      circ(g, x, y, s * 0.3, c, INK, 0.8);
      g.fillStyle = INK;
      g.font = `bold ${s * 0.4}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('?', x, y + 0.5);
  }
}

// --- painters by shape: (g, W, H, d, k) ; k = { r, c, f (frame), pc, id, o } ---------------------
const P = {};
const ground = (g, W, H, c = 'rgba(0,0,0,0.22)') => ell(g, W / 2, H - 3, W * 0.42, Math.min(5, H * 0.12), c, null);

P.pile = (g, W, H, d, k) => { ground(g, W, H); resourceGlyph(g, RES_OF(d.id) || 'random', W / 2, H * 0.62, W * 0.62); };
P.chest = (g, W, H, d, k) => {
  if (d.id === 'sea_chest') ell(g, W / 2, H - 6, 13, 4, alpha('#bfe0f4', 0.6), null); else ground(g, W, H);
  rrect(g, W / 2 - 10, H - 18, 20, 12, 1.5, vgrad(g, H - 18, H - 6, '#8a5a2a', 0.2), INK, 1);
  g.beginPath(); g.ellipse(W / 2, H - 18, 10, 5, 0, Math.PI, Math.PI * 2); g.closePath(); paint(g, '#a0703a', INK, 1);
  rect(g, W / 2 - 10, H - 19, 20, 2, '#e8c040', INK, 0.6);
  rect(g, W / 2 - 1.6, H - 17, 3.2, 4, '#e8c040', INK, 0.6);
};
P.campfire = (g, W, H, d, k) => {
  ground(g, W, H);
  for (let i = 0; i < 6; i++) circ(g, W / 2 + Math.cos(i) * 9, H - 7 + Math.sin(i) * 3, 2, '#8a8278', INK, 0.6);
  line(g, [W / 2 - 7, H - 6, W / 2 + 7, H - 9], '#6a4626', 2.4); line(g, [W / 2 - 7, H - 9, W / 2 + 7, H - 6], '#5a3a1e', 2.4);
  glow(g, W / 2, H - 12, 12, '#ff9030', 0.6);
  const fl = k.f % 2 ? 1.5 : -1.5;
  blob(g, [W / 2 - 5, H - 8, W / 2 - 3 + fl, H - 17, W / 2, H - 23, W / 2 + 3 - fl, H - 16, W / 2 + 5, H - 8], '#ff8a20', '#c03a10', 0.8);
  blob(g, [W / 2 - 2.5, H - 8, W / 2, H - 16, W / 2 + 2.5, H - 8], '#ffe070', null);
  resourceGlyph(g, 'gold', W / 2 + 10, H - 6, 8);
};
P.crate = (g, W, H, d, k) => {
  ell(g, W / 2, H - 7, 14, 4, alpha('#bfe0f4', 0.6), null);
  if (d.id === 'sea_barrel') { ell(g, W / 2, H - 13, 7, 9, vgrad(g, H - 22, H - 4, '#7a5a3a', 0.2), INK, 1); line(g, [W / 2 - 7, H - 16, W / 2 + 7, H - 16], '#5a5a62', 1.2); line(g, [W / 2 - 7, H - 10, W / 2 + 7, H - 10], '#5a5a62', 1.2); return; }
  for (let i = 0; i < 3; i++) rect(g, W / 2 - 12 + i * 2, H - 12 + i * 2.5, 22 - i * 3, 3, '#8a6a3e', INK, 0.7);
  if (d.id === 'shipwreck_survivor') { circ(g, W / 2, H - 22, 3.5, '#e0b088', INK, 0.8); rrect(g, W / 2 - 3.5, H - 19, 7, 7, 1, '#d8b080', INK, 0.8); line(g, [W / 2 + 3, H - 18, W / 2 + 8, H - 24], '#e0b088', 1.4); }
  if (d.id === 'jetsam' || d.id === 'flotsam') rect(g, W / 2 - 5, H - 19, 9, 7, d.id === 'jetsam' ? '#6a6a72' : '#a07a4a', INK, 0.8);
};
P.bottle = (g, W, H, d, k) => {
  const sea = d.id === 'ocean_bottle';
  if (sea) ell(g, W / 2, H - 6, 12, 3.5, alpha('#bfe0f4', 0.6), null); else ground(g, W, H);
  at(g, W / 2, H - 10, sea ? 1.1 : 0, 1, 1, () => {
    ell(g, 0, 0, 6, 7, alpha(d.color, 0.9), INK, 1);
    rect(g, -2, -12, 4, 6, alpha(d.color, 0.9), INK, 0.8);
    rect(g, -2.4, -14, 4.8, 2.4, '#8a5a2a', INK, 0.6);
    if (sea) rect(g, -3, -3, 6, 4, '#f0e8d0', null); else glow(g, 0, 0, 10, d.color, 0.5);
  });
};
P.artifact = (g, W, H, d, k) => {
  ground(g, W, H);
  const cls = { artifact_treasure: '#a8703a', artifact_minor: '#c0c8d0', artifact_major: '#e8c040', artifact_relic: '#c060e0' }[d.id] || '#e8c040';
  poly(g, [W / 2 - 9, H - 4, W / 2 - 6, H - 11, W / 2 + 6, H - 11, W / 2 + 9, H - 4], '#9a9488', INK, 0.9);
  glow(g, W / 2, H - 18, 12, cls, 0.7);
  at(g, W / 2, H - 18, -0.6, 1, 1, () => { poly(g, [-1.6, 6, -1.6, -8, 0, -11, 1.6, -8, 1.6, 6], '#e0e4ec', INK, 0.8); rect(g, -4.5, 4, 9, 2, cls, INK, 0.6); });
  if (d.id === 'artifact_random') star(g, W / 2 + 7, H - 24, 3, 1, 4, '#ffffff', null);
};
P.scroll = (g, W, H) => {
  ground(g, W, H);
  rrect(g, W / 2 - 9, H - 16, 18, 10, 1, '#e8dcb0', INK, 0.9);
  for (const x of [-9, 9]) ell(g, W / 2 + x, H - 11, 2.2, 5.5, '#c8b890', INK, 0.8);
  for (let i = 0; i < 3; i++) line(g, [W / 2 - 6, H - 14 + i * 2.8, W / 2 + 5, H - 14 + i * 2.8], alpha('#5a4020', 0.6), 0.6);
  circ(g, W / 2 + 4, H - 7, 2, '#c03a2a', INK, 0.5);
};
P.box = (g, W, H, d, k) => {
  ground(g, W, H); glow(g, W / 2, H - 14, 14, '#c060ff', 0.5);
  rrect(g, W / 2 - 10, H - 20, 20, 15, 2, vgrad(g, H - 20, H - 5, d.color, 0.25), INK, 1);
  rect(g, W / 2 - 11, H - 22, 22, 4, shade(d.color, 0.25), INK, 0.9);
  for (const x of [-6, 0, 6]) circ(g, W / 2 + x, H - 12, 1.6, '#e8c040', INK, 0.5);
};
P.marker = (g, W, H, d) => {
  if (d.id === 'event') { circ(g, W / 2, H / 2, 9, alpha('#e8c040', 0.35), alpha('#e8c040', 0.8), 1); g.fillStyle = '#1a1410'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', W / 2, H / 2 + 0.5); return; }
  ground(g, W, H); glow(g, W / 2, H - 16, 15, '#ffe070', 0.6);
  poly(g, [W / 2 - 7, H - 24, W / 2 + 7, H - 24, W / 2 + 5, H - 15, W / 2 + 1.5, H - 13, W / 2 + 1.5, H - 8, W / 2 + 5, H - 5, W / 2 - 5, H - 5, W / 2 - 1.5, H - 8, W / 2 - 1.5, H - 13, W / 2 - 5, H - 15], vgrad(g, H - 24, H - 5, '#e8c040', 0.35), INK, 1);
};
P.hole = (g, W, H) => { ell(g, W / 2, H / 2 + 4, 10, 5, '#2a1a10', '#5a4030', 1); };
P.mine = (g, W, H, d, k) => {
  const res = d.effect && d.effect.resource;
  const rc = d.color;
  if (d.id === 'sawmill' || d.shape === 'mill' && d.category === 'mine') {
    house(g, W * 0.4, H - 4, W * 0.46, H * 0.62, { wall: '#9a7a4a', roof: '#6a4a2a', r: k.r, timber: true, lw: 1 });
    at(g, W * 0.76, H - 16, k.f * 0.5, 1, 1, () => { star(g, 0, 0, 10, 7.5, 14, '#d4d8e0', INK, 0.8); circ(g, 0, 0, 2.5, '#6a6a72', INK, 0.6); });
    resourceGlyph(g, 'wood', W * 0.15, H - 9, 14);
    return;
  }
  if (d.id === 'alchemists_lab') {
    tower(g, W * 0.5, H - 4, W * 0.28, H * 0.9, { wall: '#9aa0b0', roof: '#5a6ae8', roofKind: 'dome', r: k.r, glow: '#a0f0c0' });
    resourceGlyph(g, 'mercury', W * 0.2, H - 12, 14);
    for (let i = 0; i < 3; i++) circ(g, W * 0.58 + i * 3, H * 0.15 - i * 5, 2 + i, alpha('#a0f0c0', 0.5), null);
    return;
  }
  if (d.id === 'gem_pond') { pool(g, W / 2, H * 0.62, W * 0.36, H * 0.24, '#3a8ab8'); resourceGlyph(g, 'gems', W * 0.5, H * 0.6, 14); resourceGlyph(g, 'gems', W * 0.78, H - 8, 12); return; }
  const hill = d.id === 'sulfur_dune' ? '#c8b050' : d.id === 'crystal_cavern' ? '#6a5a66' : '#8a7a62';
  cave(g, W / 2, H - 4, W * 0.82, H * 0.86, hill, { mouth: 0.26, glow: d.id === 'crystal_cavern' ? '#ff6070' : null });
  line(g, [W / 2 - 7, H - 4, W / 2 - 7, H - 20, W / 2 + 7, H - 20, W / 2 + 7, H - 4], '#6a4626', 2.6);
  if (d.id === 'abandoned_mine') { for (const y of [-14, -9]) line(g, [W / 2 - 8, H + y, W / 2 + 8, H + y + 2], '#8a6a3e', 2.2); return; }
  if (d.id === 'crystal_cavern') crystals(g, W * 0.24, H - 6, 18, rc, 0.8);
  rect(g, W * 0.7, H - 13, 15, 8, '#5a5a62', INK, 0.9);
  circ(g, W * 0.7 + 3, H - 4, 2.5, '#3a3a40', INK, 0.6); circ(g, W * 0.7 + 12, H - 4, 2.5, '#3a3a40', INK, 0.6);
  if (res) resourceGlyph(g, res, W * 0.7 + 7.5, H - 15, 11);
  line(g, [0, H - 2, W * 0.7, H - 2], '#5a4a3a', 1);
};
P.mill = (g, W, H, d, k) => {
  if (d.id === 'water_wheel') {
    pool(g, W * 0.75, H - 8, W * 0.26, 6, '#3a74b8', { shine: false });
    house(g, W * 0.4, H - 4, W * 0.5, H * 0.68, { wall: '#b8a888', roof: '#8a5a3a', r: k.r, timber: true });
    at(g, W * 0.78, H - 18, k.f * 0.4, 1, 1, () => {
      circ(g, 0, 0, 13, null, '#6a4626', 2.6);
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; line(g, [0, 0, Math.cos(a) * 14, Math.sin(a) * 14], '#8a6a3e', 1.6); }
      circ(g, 0, 0, 2.5, '#5a3a1e', INK, 0.6);
    });
    return;
  }
  ground(g, W, H);
  tower(g, W / 2, H - 4, W * 0.34, H * 0.7, { wall: '#e0d4b0', roof: '#8a5a3a', roofKind: 'cone', r: k.r, windows: 1 });
  at(g, W / 2, H * 0.32, k.f * 0.35 + 0.3, 1, 1, () => {
    for (let i = 0; i < 4; i++) at(g, 0, 0, (i * Math.PI) / 2, 1, 1, () => { line(g, [0, 0, 0, -26], '#6a4626', 1.8); poly(g, [1, -8, 7, -9, 7, -25, 1, -25], alpha('#f0ece0', 0.9), INK, 0.7); });
    circ(g, 0, 0, 2.5, '#5a3a1e', INK, 0.7);
  });
};
P.garden = (g, W, H, d, k) => {
  ground(g, W, H);
  for (let i = 0; i < 5; i++) circ(g, W * (0.15 + i * 0.17), H - 9 - (i % 2) * 4, 5, i % 2 ? '#3a8a34' : '#58a840', INK, 0.8);
  for (let i = 0; i < 4; i++) circ(g, W * (0.2 + i * 0.2), H - 12 - (i % 2) * 3, 1.6, ['#e84a8a', '#e8d040', '#5a8ae8', '#ffffff'][i], null);
  line(g, [2, H - 4, W - 2, H - 4], '#8a6a3e', 1.6);
  for (let x = 4; x < W; x += 6) line(g, [x, H - 3, x, H - 9], '#8a6a3e', 1.2);
  if (d.id === 'garden_of_revelation') { line(g, [W / 2 - 8, H - 4, W / 2 - 8, H - 26], '#9a9488', 3); line(g, [W / 2 + 8, H - 4, W / 2 + 8, H - 26], '#9a9488', 3); curve(g, [W / 2 - 8, H - 26, W / 2, H - 32, W / 2 + 8, H - 26], '#9a9488', 3); glow(g, W / 2, H - 18, 8, d.color, 0.7); }
  else resourceGlyph(g, 'gems', W / 2, H - 14, 9);
};
P.building = (g, W, H, d, k) => {
  ground(g, W, H);
  const id = d.id;
  const res = id.startsWith('warehouse_of_') ? RES_OF(id) : null;
  if (id === 'arena' || id === 'colosseum_of_the_magi') {
    ell(g, W / 2, H - 14, W * 0.44, H * 0.3, vgrad(g, H - 30, H, d.color, 0.2), INK, 1);
    ell(g, W / 2, H - 18, W * 0.3, H * 0.15, shade(d.color, -0.4), INK, 0.8);
    for (let i = 0; i < 9; i++) rect(g, W * 0.1 + i * W * 0.09, H - 14, 3, 7, '#2a1a10', null);
    if (id === 'colosseum_of_the_magi') glow(g, W / 2, H - 18, 10, '#c080ff', 0.8);
    return;
  }
  if (id.startsWith('library') || id === 'school_of_magic' || id === 'university') {
    temple(g, W / 2, H - 3, W * 0.8, H * 0.82, { wall: '#e8e4d8', roof: d.color, emblem: '#e8c040', glow: id === 'school_of_magic' ? '#a0c0ff' : null, columns: W > 64 ? 6 : 4 });
    return;
  }
  const kind = id === 'stables' || id === 'veterans_hall' || res ? 'gable' : id === 'school_of_war' ? 'flat' : id === 'royal_mint' ? 'dome' : id === 'war_machine_factory' ? 'flat' : 'hip';
  house(g, W / 2, H - 4, W * 0.72, H * 0.78, { wall: mix(d.color, '#d8ccb0', 0.55), roof: shade(d.color, -0.15), roofKind: kind, r: k.r, windows: 2, chimney: id === 'war_machine_factory', smoke: true, timber: id === 'stables' });
  if (res) resourceGlyph(g, res, W * 0.84, H - 8, 13);
  if (id === 'royal_mint') resourceGlyph(g, 'gold', W * 0.84, H - 8, 13);
  if (id === 'school_of_war') { line(g, [W / 2 - 7, H * 0.25, W / 2 + 7, H * 0.4], '#d4d8e0', 2); line(g, [W / 2 + 7, H * 0.25, W / 2 - 7, H * 0.4], '#d4d8e0', 2); }
  if (id === 'tavern') { line(g, [W * 0.8, H * 0.45, W * 0.95, H * 0.45], INK, 1); rrect(g, W * 0.86, H * 0.47, 7, 7, 1, '#e8c040', INK, 0.7); }
  if (id === 'war_machine_factory') star(g, W * 0.2, H * 0.4, 6, 4, 8, '#c89a3a', INK, 0.8);
  if (id === 'shipyard') { pool(g, W * 0.8, H - 8, W * 0.2, 6, '#3a74b8', { shine: false }); hull(g, W * 0.8, H - 6, W * 0.3, 8, '#8a5a2a'); }
};
P.tent = (g, W, H, d, k) => {
  ground(g, W, H);
  const keyC = d.id.startsWith('keymasters_tent') ? d.color : null;
  const n = W > 40 ? 2 : 1;
  for (let i = 0; i < n; i++) tent(g, W * (n === 1 ? 0.5 : 0.3 + i * 0.42), H - 4, W * (n === 1 ? 0.8 : 0.5), H * 0.8, { color: keyC || (d.id === 'refugee_camp' ? '#a89a7a' : mix(d.color, '#d8c8a0', 0.4)), stripe: keyC ? '#f0ece0' : shade(d.color, -0.2), flagC: keyC || d.color });
  if (d.id === 'war_drums') { ell(g, W * 0.78, H - 8, 5, 3, '#c8a070', INK, 0.8); rect(g, W * 0.78 - 5, H - 8, 10, 5, '#a03a2a', INK, 0.8); }
  if (d.id === 'fortune_teller') { circ(g, W * 0.8, H - 9, 4, alpha('#c080ff', 0.8), INK, 0.8); glow(g, W * 0.8, H - 9, 7, '#c080ff', 0.6); }
};
P.wagon = (g, W, H, d, k) => {
  ground(g, W, H);
  poly(g, [W / 2 - 12, H - 14, W / 2 + 10, H - 14, W / 2 + 8, H - 7, W / 2 - 10, H - 7], '#8a6a3e', INK, 0.9);
  g.beginPath(); g.ellipse(W / 2 - 1, H - 14, 11, 7, 0, Math.PI, Math.PI * 2); g.closePath(); paint(g, '#e8dcb8', INK, 0.9);
  for (const x of [-7, 5]) { circ(g, W / 2 + x, H - 6, 4, '#6a4626', INK, 0.8); circ(g, W / 2 + x, H - 6, 1, INK, null); }
};
P.bones = (g, W, H, d, k) => {
  for (let i = 0; i < (W > 40 ? 3 : 1); i++) {
    const x = W * (W > 40 ? 0.2 + i * 0.3 : 0.5);
    circ(g, x, H - 9, 4, '#e4dcc4', INK, 0.8);
    circ(g, x - 1.4, H - 9.5, 0.9, INK, null); circ(g, x + 1.4, H - 9.5, 0.9, INK, null);
    for (const [a, b] of [[-8, 2], [2, 9]]) line(g, [x + a, H - 4, x + b, H - 6], '#e4dcc4', 1.6);
  }
  if (d.id === 'ancient_battlefield') { line(g, [W * 0.7, H - 3, W * 0.85, H - 22], '#d4d8e0', 1.6); line(g, [W * 0.35, H - 3, W * 0.42, H - 18], '#8a6a3e', 1.4); }
};
P.tomb = (g, W, H, d, k) => {
  ground(g, W, H);
  if (d.id === 'ruins') { for (let i = 0; i < 4; i++) rect(g, W * (0.12 + i * 0.22), H - 6 - (i % 2 ? 22 : 14), 6, i % 2 ? 22 : 14, '#9a9080', INK, 0.9); rock(g, W * 0.6, H - 3, 10, '#8a8070', k.r); return; }
  if (d.id === 'churchyard') { house(g, W * 0.65, H - 4, W * 0.34, H * 0.8, { wall: '#8a8a80', roof: '#3a3a42', roofKind: 'spike', r: k.r }); for (const x of [0.12, 0.28]) { rect(g, W * x - 1, H - 14, 2, 10, '#9a9a90', INK, 0.6); rect(g, W * x - 4, H - 11, 8, 2, '#9a9a90', INK, 0.6); } return; }
  temple(g, W / 2, H - 3, W * 0.7, H * 0.78, { wall: d.color, roof: shade(d.color, -0.2), columns: 3, glow: d.id === 'crypt' ? '#60ff90' : null });
};
P.bank = (g, W, H, d, k) => {
  const id = d.id;
  const c = d.color;
  ground(g, W, H);
  if (/utopia|roost/.test(id)) {
    mountain(g, W / 2, H - 3, W * 0.95, H * 0.95, id === 'dragon_utopia' ? '#6a5a50' : '#5a4a5a', null, k.r);
    cave(g, W / 2, H - 4, W * 0.4, H * 0.42, '#4a3a3a', { glow: id === 'dragon_utopia' ? '#ff8030' : '#ff80c0' });
    if (id === 'crystal_dragon_roost') { crystals(g, W * 0.22, H - 6, 22, c); crystals(g, W * 0.8, H - 6, 18, c); }
    else { circ(g, W * 0.76, H - 10, 5, '#e4dcc4', INK, 0.8); resourceGlyph(g, 'gold', W * 0.24, H - 8, 14); }
    return;
  }
  if (/hive|spit/.test(id)) { blob(g, [W * 0.3, H - 4, W * 0.24, H * 0.4, W / 2, H * 0.12, W * 0.76, H * 0.4, W * 0.7, H - 4], vgrad(g, 0, H, c, 0.25), INK, 1); for (let i = 0; i < 3; i++) curve(g, [W * 0.3, H * (0.4 + i * 0.16), W / 2, H * (0.36 + i * 0.16), W * 0.7, H * (0.4 + i * 0.16)], shade(c, -0.35), 0.9); ell(g, W / 2, H * 0.62, 4, 5, '#1a1410', null); return; }
  if (/conservatory/.test(id)) { rock(g, W / 2, H - 3, W * 0.6, '#9a9080', k.r); ell(g, W / 2, H * 0.36, W * 0.24, 6, '#a07a4a', INK, 1); for (const x of [-5, 0, 5]) ell(g, W / 2 + x, H * 0.33, 3, 4, '#f0ece0', INK, 0.6); return; }
  if (/cavern|picket|cache|stores|stockpile/.test(id)) {
    cave(g, W / 2, H - 4, W * 0.8, H * 0.85, mix(c, '#7a6a5a', 0.5), { glow: shade(c, 0.3) });
    tent(g, W * 0.82, H - 4, W * 0.24, H * 0.5, { color: c });
    return;
  }
  if (/mansion|library/.test(id)) { house(g, W / 2, H - 4, W * 0.76, H * 0.9, { wall: shade(c, 0.1), roof: '#2a2430', roofKind: 'spike', r: k.r, windows: 4, glow: id === 'mansion' ? '#a0ffa0' : '#ffd070' }); return; }
  if (/forge|shop/.test(id)) { house(g, W / 2, H - 4, W * 0.76, H * 0.75, { wall: mix(c, '#8a8a8a', 0.5), roof: '#4a4a52', roofKind: 'flat', r: k.r, chimney: true, smoke: true, glow: '#ff9030', windows: 2 }); return; }
  temple(g, W / 2, H - 3, W * 0.82, H * 0.86, { wall: mix(c, '#e8e4d8', 0.55), roof: c, emblem: '#e8c040', columns: 5 });
};
P.ship = (g, W, H, d, k) => {
  pool(g, W / 2, H - 6, W * 0.46, 6, '#3a74b8', { shine: false });
  at(g, W / 2, H - 4, d.id === 'shipwreck' ? 0.25 : -0.08, 1, 1, () => {
    hull(g, 0, 0, W * 0.7, 14, d.color);
    line(g, [0, -12, -4, -44], '#5a3a1e', 2.4);
    poly(g, [-3, -42, 14, -34, -1, -24], alpha('#d8d0c0', 0.85), INK, 0.8);
    line(g, [-8, -10, -6, -14], '#1a1410', 2);
  });
};
P.pyramid = (g, W, H, d) => {
  ground(g, W, H);
  poly(g, [W * 0.08, H - 3, W / 2, H * 0.08, W * 0.92, H - 3], lgrad(g, 0, 0, W, 0, [[0, shade(d.color, 0.2)], [0.5, d.color], [1, shade(d.color, -0.3)]]), INK, 1.2);
  for (let i = 1; i < 5; i++) line(g, [W * (0.08 + i * 0.084), H - 3 - i * (H * 0.18), W * (0.92 - i * 0.084), H - 3 - i * (H * 0.18)], shade(d.color, -0.25), 0.7);
  rect(g, W / 2 - 4, H - 12, 8, 9, '#2a1a10', INK, 0.8);
};
P.temple = (g, W, H, d) => {
  const sea = /sea|sunken/.test(d.id);
  if (sea) pool(g, W / 2, H - 6, W * 0.46, 7, '#2a6aa8', { shine: false }); else ground(g, W, H);
  temple(g, W / 2, H - 4, W * 0.8, H * 0.8, { wall: mix(d.color, '#f0ece0', 0.5), roof: d.color, emblem: '#e8c040', glow: d.id === 'sanctuary' ? '#fff8c0' : null });
};
P.tower = (g, W, H, d, k) => {
  ground(g, W, H);
  const roofKind = d.id === 'black_tower' ? 'spike' : d.id === 'ivory_tower' ? 'dome' : d.id === 'watchtower' ? 'battlement' : 'cone';
  tower(g, W / 2, H - 3, W * 0.5, H * 0.94, { wall: d.id.includes('tower') && d.category === 'bank' ? d.color : '#9a9488', roof: d.id === 'ivory_tower' ? '#e8c040' : shade(d.color, -0.1), roofKind, r: k.r, glow: d.category === 'bank' ? '#ffd070' : null, banner: d.id === 'marletto_tower' ? '#3a6ad8' : null });
};
P.statue = (g, W, H, d, k) => {
  ground(g, W, H);
  rect(g, W / 2 - 8, H - 9, 16, 6, '#9a9488', INK, 0.9);
  const c = d.color;
  if (d.id === 'star_axis') { line(g, [W / 2, H - 9, W / 2, H - 26], '#8a8a92', 2); for (let i = 0; i < 3; i++) ell(g, W / 2, H - 20, 9 - i * 2, 3 + i * 2, null, c, 0.9); star(g, W / 2, H - 27, 4, 1.5, 5, c, INK, 0.6); return; }
  if (d.id === 'eye_of_the_magi') { line(g, [W / 2, H - 9, W / 2, H - 16], '#8a8a92', 2.4); ell(g, W / 2, H - 21, 8, 5, '#fffbe8', INK, 1); circ(g, W / 2, H - 21, 3, c, INK, 0.6); glow(g, W / 2, H - 21, 10, c, 0.5); return; }
  if (d.id === 'mermaids') { pool(g, W / 2, H - 6, 13, 4, '#3a8ab8', { shine: false }); circ(g, W / 2, H - 22, 3.5, '#e0b088', INK, 0.8); blob(g, [W / 2 - 3, H - 19, W / 2 + 3, H - 19, W / 2 + 5, H - 10, W / 2 + 9, H - 7, W / 2, H - 9], c, INK, 0.8); return; }
  circ(g, W / 2, H - 25, 3.6, '#c8c0b0', INK, 0.8);
  poly(g, [W / 2 - 4, H - 21, W / 2 + 4, H - 21, W / 2 + 5, H - 9, W / 2 - 5, H - 9], '#c8c0b0', INK, 0.8);
  if (d.id === 'idol_of_fortune') { star(g, W / 2 + 7, H - 25, 3.5, 1.5, 5, '#e8c040', INK, 0.5); glow(g, W / 2, H - 20, 10, '#e8c040', 0.5); }
  if (d.id === 'scholar') rect(g, W / 2 + 3, H - 18, 6, 4, '#8a3a2a', INK, 0.6);
};
P.stone = (g, W, H, d) => {
  ground(g, W, H);
  poly(g, [W / 2 - 7, H - 4, W / 2 - 8, H - 18, W / 2 - 3, H - 26, W / 2 + 5, H - 24, W / 2 + 8, H - 4], vgrad(g, H - 26, H - 4, d.color, 0.25), INK, 1);
  for (let i = 0; i < 3; i++) line(g, [W / 2 - 3, H - 20 + i * 5, W / 2 + 3, H - 21 + i * 5], d.id === 'runestone' ? '#a0fff0' : shade(d.color, -0.4), 1);
  if (d.id === 'runestone') glow(g, W / 2, H - 15, 9, '#6ad8c0', 0.5);
};
P.hut = (g, W, H, d, k) => {
  ground(g, W, H);
  if (d.id === 'gazebo') { for (const x of [-8, 8]) line(g, [W / 2 + x, H - 4, W / 2 + x, H - 16], '#d8c8a0', 2); poly(g, [W / 2 - 12, H - 15, W / 2, H - 27, W / 2 + 12, H - 15], '#8a5a3a', INK, 0.9); return; }
  const roof = d.id === 'witch_hut' ? '#3a3a2a' : d.id === 'hut_of_the_magi' ? '#5a3aa0' : '#8a6a3a';
  house(g, W / 2, H - 4, W * 0.62, H * 0.78, { wall: mix(d.color, '#a08a6a', 0.5), roof, roofKind: d.id === 'witch_hut' || d.id === 'seers_hut' ? 'cone' : 'thatch', r: k.r, windows: W > 40 ? 2 : 0 });
  if (d.id === 'witch_hut') { ell(g, W * 0.82, H - 6, 4, 3, '#2a2a2a', INK, 0.7); glow(g, W * 0.82, H - 9, 5, '#80ff60', 0.6); }
  if (d.id === 'hut_of_the_magi') glow(g, W / 2, H * 0.3, 8, '#c080ff', 0.6);
};
P.tree = (g, W, H, d, k) => {
  if (d.id === 'tree_of_knowledge') { ground(g, W, H); tree(g, W / 2, H - 3, H * 0.95, 'oak', '#3cae4a', k.r); for (let i = 0; i < 4; i++) circ(g, W / 2 + k.r.f(-9, 9), H * 0.32 + k.r.f(-6, 6), 1.8, '#e8c040', INK, 0.5); return; }
  forest(g, W, H, 'oak', d.color, k.r);
};
P.shrine = (g, W, H, d, k) => {
  ground(g, W, H);
  const lvl = { shrine_of_magic_incantation: 1, shrine_of_magic_gesture: 2, shrine_of_magic_thought: 3, shrine_of_magic_mystery: 4 }[d.id];
  rect(g, W / 2 - 11, H - 7, 22, 4, '#9a9488', INK, 0.8);
  for (const x of [-8, 8]) rect(g, W / 2 + x - 1.5, H - 21, 3, 14, '#c8c0b0', INK, 0.7);
  poly(g, [W / 2 - 12, H - 20, W / 2, H - 29, W / 2 + 12, H - 20], vgrad(g, H - 29, H - 20, shade(d.color, -0.2), 0.2), INK, 0.9);
  glow(g, W / 2, H - 13, 8, d.color, 0.8);
  circ(g, W / 2, H - 13, 3.4, d.color, INK, 0.7);
  for (let i = 0; i < (lvl || 0); i++) circ(g, W / 2 - 4.5 + i * 3, H - 4.8, 0.9, '#e8c040', null);
};
P.altar = (g, W, H, d) => { ground(g, W, H); rect(g, W / 2 - 14, H - 14, 28, 10, vgrad(g, H - 14, H - 4, '#8a8278', 0.2), INK, 1); rect(g, W / 2 - 16, H - 16, 32, 3, '#9a9488', INK, 0.8); glow(g, W / 2, H - 20, 8, '#ff5030', 0.7); blob(g, [W / 2 - 3, H - 16, W / 2, H - 25, W / 2 + 3, H - 16], '#ff8a20', '#c03a10', 0.6); line(g, [W / 2 - 10, H - 9, W / 2 + 10, H - 9], d.color, 1.6); };
P.fountain = (g, W, H, d, k) => { ground(g, W, H); ell(g, W / 2, H - 8, W * 0.36, 5, '#9a9488', INK, 1); ell(g, W / 2, H - 9, W * 0.3, 3.2, d.color, null); rect(g, W / 2 - 2, H - 20, 4, 11, '#c8c0b0', INK, 0.7); for (const dx of [-1, 1]) curve(g, [W / 2, H - 20, W / 2 + dx * 6, H - 24 - (k.f % 2), W / 2 + dx * 9, H - 11], alpha(shade(d.color, 0.3), 0.9), 1.2); };
P.ring = (g, W, H, d, k) => {
  ground(g, W, H);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = W / 2 + Math.cos(a) * W * 0.34;
    const y = H * 0.6 + Math.sin(a) * H * 0.22;
    if (d.id === 'faerie_ring') { rect(g, x - 0.8, y - 3, 1.6, 3, '#f0ece0', INK, 0.4); ell(g, x, y - 3, 3, 2, '#e84a8a', INK, 0.5); }
    else rect(g, x - 2.5, y - 10, 5, 10, vgrad(g, y - 10, y, '#9a9aa8', 0.2), INK, 0.7);
  }
  if (d.id === 'faerie_ring') glow(g, W / 2, H * 0.6, 10, '#ff90e0', 0.5);
};
P.pond = (g, W, H, d, k) => {
  pool(g, W / 2, H * 0.62, W * 0.42, H * 0.3, d.id === 'oasis' ? '#3a9ab8' : d.color === '#bfe0f4' ? '#5a9ad8' : d.color);
  if (d.id === 'swan_pond') { ell(g, W / 2, H * 0.62, 5, 2.6, '#ffffff', INK, 0.6); curve(g, [W / 2 + 3, H * 0.6, W / 2 + 5, H * 0.45, W / 2 + 3, H * 0.4], '#ffffff', 1.6); }
  if (d.id === 'oasis') tree(g, W * 0.82, H - 2, 26, 'palm', '#4a9a3a', k.r);
};
P.flag = (g, W, H, d, k) => {
  ground(g, W, H);
  if (d.id === 'sparring_grounds') { for (const x of [0.3, 0.7]) { line(g, [W * x, H - 4, W * x, H - 22], '#8a6a3e', 2.4); line(g, [W * x - 6, H - 17, W * x + 6, H - 17], '#8a6a3e', 2); circ(g, W * x, H - 24, 3, '#c8a070', INK, 0.7); } return; }
  flag(g, W / 2 - 4, H - 4, H * 0.7, d.color, 1, k.f);
};
P.buoy = (g, W, H, d, k) => { ell(g, W / 2, H - 7, 10, 3, alpha('#bfe0f4', 0.6), null); poly(g, [W / 2 - 6, H - 8, W / 2 - 3, H - 22, W / 2 + 3, H - 22, W / 2 + 6, H - 8], d.color, INK, 1); rect(g, W / 2 - 4.6, H - 16, 9.2, 3, '#f0ece0', null); glow(g, W / 2, H - 24, 6, '#ffe070', k.f % 2 ? 0.9 : 0.4); };
P.well = (g, W, H, d) => { ground(g, W, H); rrect(g, W / 2 - 9, H - 13, 18, 9, 2, vgrad(g, H - 13, H - 4, '#9a9488', 0.2), INK, 0.9); ell(g, W / 2, H - 13, 9, 2.6, d.color, INK, 0.8); for (const x of [-8, 8]) line(g, [W / 2 + x, H - 13, W / 2 + x, H - 26], '#6a4626', 1.8); poly(g, [W / 2 - 12, H - 25, W / 2, H - 31, W / 2 + 12, H - 25], '#8a5a3a', INK, 0.9); glow(g, W / 2, H - 13, 8, d.color, 0.5); };
P.stall = (g, W, H, d, k) => {
  ground(g, W, H);
  for (let i = 0; i < 2; i++) {
    const x = W * (0.3 + i * 0.4);
    rect(g, x - 10, H - 13, 20, 9, '#8a6a3e', INK, 0.9);
    for (const dx of [-9, 9]) line(g, [x + dx, H - 13, x + dx, H - 24], '#6a4626', 1.4);
    poly(g, [x - 12, H - 22, x + 12, H - 22, x + 10, H - 28, x - 10, H - 28], i ? d.color : '#f0ece0', INK, 0.9);
    for (let s = 0; s < 3; s++) rect(g, x - 9 + s * 7, H - 28, 3.5, 6, i ? '#f0ece0' : d.color, null);
  }
  if (d.id.startsWith('cartographer')) rrect(g, W / 2 - 6, H - 16, 12, 8, 1, '#e8dcb0', INK, 0.7);
  if (d.id === 'black_market') glow(g, W / 2, H - 10, 10, '#a060ff', 0.4);
};
P.cage = (g, W, H) => { ground(g, W, H); rect(g, W / 2 - 11, H - 24, 22, 20, alpha('#2a2a30', 0.4), INK, 1); for (let x = -8; x <= 8; x += 4) line(g, [W / 2 + x, H - 24, W / 2 + x, H - 4], '#8a8a92', 1.3); circ(g, W / 2, H - 14, 3, '#e0b088', INK, 0.6); rect(g, W / 2 - 12, H - 26, 24, 3, '#5a5a62', INK, 0.8); };
P.fort = (g, W, H, d, k) => { ground(g, W, H); wallSeg(g, W * 0.08, H - 3, W * 0.84, H * 0.55, { wall: '#9a8a7a', r: k.r }); tower(g, W * 0.18, H - 3, W * 0.18, H * 0.85, { wall: '#9a8a7a', roofKind: 'battlement' }); tower(g, W * 0.82, H - 3, W * 0.18, H * 0.85, { wall: '#9a8a7a', roofKind: 'battlement' }); rect(g, W / 2 - 6, H - 15, 12, 12, '#2a1a10', INK, 0.8); };
P.lighthouse = (g, W, H, d, k) => { ground(g, W, H); tower(g, W / 2, H - 3, W * 0.5, H * 0.84, { wall: '#f0e8d0', roof: '#c03a2a', roofKind: 'cone', taperK: 0.7, windows: 1 }); for (let i = 0; i < 3; i++) rect(g, W / 2 - 7 + i, H * 0.48 + i * 10, 14 - i * 2, 3, '#c03a2a', null); glow(g, W / 2, H * 0.24, 12, '#ffe070', k.f % 2 ? 0.9 : 0.6); };
P.observatory = (g, W, H, d, k) => {
  ground(g, W, H);
  if (d.id === 'redwood_observatory') { tree(g, W / 2, H - 3, H * 0.9, 'pine', '#3a6a3a', k.r); rect(g, W / 2 - 10, H * 0.32, 20, 3, '#8a3a2a', INK, 0.8); return; }
  if (d.id === 'star_chart') { rrect(g, W / 2 - 11, H - 22, 22, 18, 2, '#2a2a6a', INK, 1); for (let i = 0; i < 5; i++) star(g, W / 2 + k.r.f(-8, 8), H - 13 + k.r.f(-7, 7), 2, 0.8, 4, '#ffffff', null); return; }
  tower(g, W / 2, H - 3, W * 0.5, H * 0.86, { wall: d.color, roofKind: 'dome', roof: '#5a6a8a', r: k.r });
};
P.pillar = (g, W, H, d, k) => {
  ground(g, W, H);
  rect(g, W / 2 - 5, H * 0.3, 10, H * 0.66, vgrad(g, H * 0.3, H, d.id === 'cover_of_darkness' ? '#2a2a32' : '#9a9488', 0.2), INK, 1);
  rect(g, W / 2 - 7, H * 0.26, 14, 4, '#8a8278', INK, 0.8);
  if (d.id === 'pillar_of_fire') { glow(g, W / 2, H * 0.2, 12, '#ff7020', 0.8); blob(g, [W / 2 - 5, H * 0.27, W / 2 - 2 + (k.f % 2), H * 0.1, W / 2, H * 0.02, W / 2 + 4, H * 0.15, W / 2 + 5, H * 0.27], '#ff9a30', '#c03a10', 0.8); }
  else if (d.id === 'cover_of_darkness') glow(g, W / 2, H * 0.2, 14, '#000000', 0.7);
  else { for (let i = 0; i < 3; i++) curve(g, [W / 2 + 4, H * (0.4 + i * 0.15), W / 2 + 12, H * (0.36 + i * 0.15), W / 2 + 15, H * (0.4 + i * 0.15)], d.color, 1.2); }
};
P.obelisk = (g, W, H, d) => { ground(g, W, H); poly(g, [W / 2 - 7, H - 3, W / 2 - 4, H * 0.18, W / 2, H * 0.08, W / 2 + 4, H * 0.18, W / 2 + 7, H - 3], lgrad(g, W / 2 - 7, 0, W / 2 + 7, 0, [[0, shade(d.color, 0.2)], [1, shade(d.color, -0.3)]]), INK, 1); for (let i = 0; i < 4; i++) line(g, [W / 2 - 2, H * (0.3 + i * 0.12), W / 2 + 2, H * (0.3 + i * 0.12)], shade(d.color, -0.4), 1); };
P.sign = (g, W, H, d) => { ground(g, W, H); line(g, [W / 2, H - 3, W / 2, H - 22], '#6a4626', 2.4); rrect(g, W / 2 - 10, H - 25, 20, 9, 1, '#a07a4a', INK, 0.9); for (let i = 0; i < 2; i++) line(g, [W / 2 - 7, H - 22 + i * 3, W / 2 + 6, H - 22 + i * 3], alpha('#3a2a1a', 0.7), 0.7); };
P.gate = (g, W, H, d, k) => {
  ground(g, W, H);
  if (d.id === 'garrison' || d.id === 'anti_magic_garrison') { P.fort(g, W, H, d, k); if (d.id === 'anti_magic_garrison') glow(g, W / 2, H / 2, 14, '#5a6ae8', 0.5); return; }
  if (d.id.startsWith('border_gate')) {
    for (const x of [-10, 10]) rect(g, W / 2 + x - 3, H - 28, 6, 25, vgrad(g, H - 28, H, '#9a9488', 0.2), INK, 0.9);
    rect(g, W / 2 - 13, H - 30, 26, 5, d.color, INK, 0.9);
    glow(g, W / 2, H - 14, 9, d.color, 0.6);
    for (let i = 0; i < 3; i++) line(g, [W / 2 - 7, H - 22 + i * 6, W / 2 + 7, H - 22 + i * 6], alpha(d.color, 0.9), 1.4);
    return;
  }
  const c = d.id === 'quest_guard' ? '#8a7a6a' : d.color;
  // quest guard / border guard: a hooded guard with a halberd
  circ(g, W / 2, H - 22, 4, '#e0b088', INK, 0.8);
  blob(g, [W / 2 - 5, H - 19, W / 2 - 6, H - 26, W / 2, H - 29, W / 2 + 6, H - 26, W / 2 + 5, H - 19], c, INK, 0.8);
  poly(g, [W / 2 - 6, H - 18, W / 2 + 6, H - 18, W / 2 + 8, H - 4, W / 2 - 8, H - 4], vgrad(g, H - 18, H - 4, c, 0.2), INK, 0.9);
  line(g, [W / 2 + 9, H - 3, W / 2 + 9, H - 30], '#6a4626', 1.6);
  poly(g, [W / 2 + 9, H - 30, W / 2 + 14, H - 26, W / 2 + 9, H - 23], '#d4d8e0', INK, 0.6);
};
P.portal = (g, W, H, d, k) => {
  ground(g, W, H);
  const oneWayExit = d.id.includes('_exit_');
  const twoWay = d.id.includes('two_way');
  poly(g, [W / 2 - 11, H - 3, W / 2 - 9, H - 26, W / 2 - 4, H - 29, W / 2 - 5, H - 3], '#8a8278', INK, 0.9);
  poly(g, [W / 2 + 11, H - 3, W / 2 + 9, H - 26, W / 2 + 4, H - 29, W / 2 + 5, H - 3], '#8a8278', INK, 0.9);
  glow(g, W / 2, H - 14, 12, d.color, oneWayExit ? 0.35 : 0.8);
  at(g, W / 2, H - 14, k.f * (oneWayExit ? -0.8 : 0.8), 1, 1, () => {
    for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(0, 0, 2 + i * 2.3, i * 2, i * 2 + 4); g.strokeStyle = shade(d.color, 0.3 - i * 0.15); g.lineWidth = 1.2; g.stroke(); }
  });
  if (twoWay) rect(g, W / 2 - 11, H - 31, 22, 3, d.color, INK, 0.7);
};
P.whirlpool = (g, W, H, d, k) => {
  ell(g, W / 2, H / 2 + 3, 14, 9, '#2a5c9a', null);
  at(g, W / 2, H / 2 + 3, k.f * 0.7, 1, 0.62, () => { for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(0, 0, 3 + i * 3, i * 1.5, i * 1.5 + 4); g.strokeStyle = alpha('#bfe0f4', 0.9 - i * 0.15); g.lineWidth = 1.4; g.stroke(); } });
  circ(g, W / 2, H / 2 + 3, 2.2, '#0c1a30', null);
};
P.boat = (g, W, H, d, k) => { ell(g, W / 2, H - 7, 14, 3.5, alpha('#bfe0f4', 0.6), null); hull(g, W / 2, H - 6, W * 0.8, 9, d.color); line(g, [W / 2, H - 13, W / 2, H - 28], '#5a3a1e', 1.6); };
P.dwelling = (g, W, H, d, k) => {
  const info = DWELLING_CREATURE[d.id] || {};
  const fac = (d.effect && d.effect.faction) || info.faction || 'neutral';
  const pal = factionPalette(fac);
  ground(g, W, H);
  const style = { castle: ['gable', pal.wall, pal.roof], rampart: ['tree'], tower: ['cone', '#e0e6ee', '#5a7ac0'], inferno: ['cave', '#5a3432'], necropolis: ['spike', '#6a6670', '#2a2634'], dungeon: ['cave', '#5a4a52'], stronghold: ['tent', '#b08858'], fortress: ['thatch', '#7a7a5a', '#4a5a3a'], conflux: ['dome', '#d8c8f0', '#d05fb0'], cove: ['hip', '#a08868', '#2a6a7a'], factory: ['flat', '#b08a5a', '#6a5a4a'] }[fac];
  const st = style || [k.r.pick(['gable', 'thatch', 'cave', 'tent', 'cone']), mix(d.color, '#b0a080', 0.4), '#7a5a3a'];
  const bw = W * 0.6;
  const bx = W * 0.4;
  if (st[0] === 'cave') cave(g, bx, H - 4, bw, H * 0.86, st[1], { glow: fac === 'inferno' ? '#ff6020' : '#c080ff' });
  else if (st[0] === 'tent') tent(g, bx, H - 4, bw, H * 0.86, { color: st[1], stripe: '#8a4a2a', flagC: pal.main });
  else if (st[0] === 'tree') { tree(g, bx, H - 4, H * 0.95, 'oak', '#3c8c3c', k.r); rect(g, bx - 4, H - 14, 8, 10, '#4a3020', INK, 0.8); }
  else house(g, bx, H - 4, bw, H * 0.82, { wall: st[1], roof: st[2], roofKind: st[0], r: k.r, windows: 2, glow: '#ffd070' });
  if ((info.tier || 1) >= 6) star(g, bx, H * 0.08, 3, 1.2, 5, '#e8c040', INK, 0.5);
  const cid = info.creature || (d.effect && d.effect.creatures && d.effect.creatures[0]);
  if (cid) {
    try {
      // keep the whole figure (wide ones too) inside the object canvas: no clipped wings / tails
      const dw = creatureSpec(cid).wide ? 200 : 100;
      const sc = Math.min(H * 0.0065, (W * 0.62) / dw);
      g.save(); g.translate(Math.min(W * 0.6, W - dw * sc - 1), H - 2 - 100 * sc); g.scale(sc, sc); paintCreature(g, cid, 'idle', 0); g.restore();
    } catch { g.restore(); }
  }
};
P.monster = (g, W, H, d) => {
  ground(g, W, H);
  blob(g, [W / 2 - 9, H - 4, W / 2 - 10, H - 18, W / 2 - 3, H - 27, W / 2 + 6, H - 25, W / 2 + 10, H - 14, W / 2 + 9, H - 4], vgrad(g, H - 27, H - 4, d.color, 0.25), INK, 1);
  for (const x of [-3, 3]) circ(g, W / 2 + x, H - 19, 1.4, '#ffe040', null);
  const lvl = d.id.match(/_(\d)$/);
  g.fillStyle = '#fff8e0'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(lvl ? lvl[1] : '?', W / 2, H - 10);
};

// --- towns on the adventure map --------------------------------------------------------------
const TOWN_STYLE = {
  castle: { kind: 'cone', wall: '#c8c0b0', roof: '#b0483a' }, rampart: { kind: 'tree', wall: '#9a7a4a', roof: '#3c8c3c' },
  tower: { kind: 'spire', wall: '#e8eef4', roof: '#5a7ac0' }, inferno: { kind: 'spike', wall: '#5a3432', roof: '#c0392b' },
  necropolis: { kind: 'spike', wall: '#5a5660', roof: '#2a2634' }, dungeon: { kind: 'cave', wall: '#5a4a52', roof: '#7a4a9a' },
  stronghold: { kind: 'tent', wall: '#a88458', roof: '#8a4a2a' }, fortress: { kind: 'pagoda', wall: '#6a6a4a', roof: '#3a5a3a' },
  conflux: { kind: 'dome', wall: '#d8c8f0', roof: '#d05fb0' }, cove: { kind: 'ship', wall: '#9a8060', roof: '#2a6a7a' },
  factory: { kind: 'pipes', wall: '#b08a5a', roof: '#6a5a4a' },
};
const FORT_LEVELS = ['village', 'fort', 'citadel', 'castle'];

function paintTown(g, W, H, d, k) {
  const fac = FACTIONS.includes(k.o.variant) ? k.o.variant : d.id === 'random_town' ? null : 'castle';
  const lvl = Math.max(0, FORT_LEVELS.indexOf(k.o.state));
  const r = k.r;
  ground(g, W, H);
  if (!fac) {
    for (let i = 0; i < 3; i++) house(g, W * (0.3 + i * 0.2), H - 4, W * 0.16, H * (0.4 + (i % 2) * 0.2), { wall: '#b0a890', roof: '#8a8a8a', r });
    g.fillStyle = '#fff8e0'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', W / 2, H * 0.35);
    return;
  }
  const s = TOWN_STYLE[fac];
  const pal = factionPalette(fac);
  const base = H - 4;
  const rr = seeded(`town:${fac}`);
  if (lvl >= 1) wallSeg(g, W * 0.08, base, W * 0.84, H * (0.28 + lvl * 0.04), { wall: s.wall, r: rr });
  const spots = [[0.2, 0.4], [0.8, 0.42], [0.35, 0.55], [0.65, 0.55], [0.5, 0.78]];
  spots.forEach(([x, hk], i) => {
    const h = H * hk * (i === 4 ? 0.85 + lvl * 0.08 : 0.85 + lvl * 0.04);
    const w = W * (i === 4 ? 0.2 : 0.14);
    const cx = W * x;
    switch (s.kind) {
      case 'tree': tree(g, cx, base, h * 1.1, 'oak', i % 2 ? '#3c8c3c' : '#58a840', rr); if (i === 4) house(g, cx, base, w, h * 0.5, { wall: s.wall, roof: s.roof, roofKind: 'cone' }); break;
      case 'spire': tower(g, cx, base, w * 0.8, h * 1.1, { wall: s.wall, roof: s.roof, roofKind: i === 4 ? 'onion' : 'spike', taperK: 0.6, glow: '#9ad0ff' }); break;
      case 'spike': tower(g, cx, base, w, h, { wall: s.wall, roof: s.roof, roofKind: 'spike', taperK: 0.6, glow: fac === 'inferno' ? '#ff7020' : '#80ff90' }); break;
      case 'cave': cave(g, cx, base, w * 1.6, h * 0.8, s.wall, { glow: '#c080ff' }); break;
      case 'tent': tent(g, cx, base, w * 1.4, h, { color: s.wall, stripe: s.roof, flagC: pal.main }); break;
      case 'pagoda': house(g, cx, base, w * 1.2, h, { wall: s.wall, roof: s.roof, roofKind: 'pagoda' }); break;
      case 'dome': tower(g, cx, base, w, h, { wall: s.wall, roof: s.roof, roofKind: 'dome', glow: '#ffe0ff' }); crystals(g, cx + w * 0.6, base, h * 0.4, '#f0a0e0'); break;
      case 'ship': if (i === 4) { hull(g, cx, base, w * 2, h * 0.3, '#8a5a2a'); line(g, [cx, base - h * 0.3, cx, base - h * 1.1], '#5a3a1e', 2); poly(g, [cx + 1, base - h * 1.05, cx + w * 0.8, base - h * 0.7, cx + 1, base - h * 0.4], '#f0ece0', INK, 0.9); } else house(g, cx, base, w, h * 0.8, { wall: s.wall, roof: s.roof, roofKind: 'hip' }); break;
      case 'pipes': house(g, cx, base, w * 1.1, h * 0.8, { wall: s.wall, roof: s.roof, roofKind: 'flat', chimney: true, smoke: true }); break;
      default: tower(g, cx, base, w, h, { wall: s.wall, roof: s.roof, roofKind: i === 4 ? 'cone' : 'cone', banner: i === 4 ? pal.main : null, glow: '#ffd070' });
    }
  });
  if (lvl >= 2) for (const x of [0.08, 0.92]) tower(g, W * x, base, W * 0.08, H * (0.45 + lvl * 0.08), { wall: s.wall, roofKind: 'battlement' });
  if (lvl >= 3) tower(g, W * 0.5, base - H * 0.05, W * 0.1, H * 0.25, { wall: s.wall, roof: pal.main, roofKind: 'cone' });
}

/** Decor: n scattered small things across the footprint. */
function scatter(W, H, r, n) {
  const pts = [];
  const cols = Math.max(1, Math.round(W / T));
  const rows = Math.max(1, Math.round(H / T));
  for (let i = 0; i < n; i++) pts.push([((i % cols) + 0.5 + r.f(-0.2, 0.2)) * (W / cols), H - (rows - 1 - Math.floor(i / cols) % rows) * T - 4 - r.f(0, 3)]);
  return pts.sort((a, b) => a[1] - b[1]);
}
function forest(g, W, H, kind, color, r) {
  const n = Math.max(1, Math.round((W / T) * (H / T) * 1.5));
  for (const [x, y] of scatter(W, H, r, n)) tree(g, x, y, T * r.f(0.85, 1.05), kind, tweak2(color, r), r);
}
const tweak2 = (c, r) => shade(c, r.f(-0.08, 0.1));

const DECOR = {
  pine: (g, W, H, d, k) => forest(g, W, H, 'pine', d.color, k.r),
  palm: (g, W, H, d, k) => forest(g, W, H, 'palm', d.color, k.r),
  dead_tree: (g, W, H, d, k) => forest(g, W, H, 'dead', d.color, k.r),
  mangrove: (g, W, H, d, k) => forest(g, W, H, 'mangrove', d.color, k.r),
  mountain: (g, W, H, d, k) => { const n = Math.max(1, Math.round(W / T / 1.5)); for (let i = 0; i < n; i++) mountain(g, W * (i + 0.5) / n, H - 2, W / n * 1.3, H * k.r.f(0.75, 0.95), d.color, '#f0f4f8', k.r); },
  volcano: (g, W, H, d, k) => { poly(g, [2, H - 2, W * 0.4, H * 0.18, W * 0.6, H * 0.18, W - 2, H - 2], vgrad(g, 0, H, '#5a4038', 0.2), INK, 1.2); ell(g, W / 2, H * 0.18, W * 0.1, 3, '#ff7020', INK, 0.8); glow(g, W / 2, H * 0.14, W * 0.2, '#ff7020', 0.6); for (const x of [0.46, 0.55]) curve(g, [W * x, H * 0.2, W * (x - 0.05), H * 0.5, W * (x + 0.02), H * 0.8], '#ff8a20', 2); },
  rock: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.max(1, Math.round(W / T * H / T)))) rock(g, x, y, T * k.r.f(0.55, 0.8), d.color, k.r); },
  sea_rock: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.max(1, Math.round(W / T * H / T)))) { ell(g, x, y - 1, T * 0.4, 3, alpha('#ffffff', 0.5), null); rock(g, x, y - 1, T * 0.6, d.color, k.r); } },
  reef: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.round(W / T * H / T * 2))) { for (let i = 0; i < 3; i++) line(g, [x + i * 3 - 3, y, x + i * 3 - 4 + k.r.f(-2, 2), y - 8], d.color, 1.6); } },
  kelp: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.round(W / T * 2))) curve(g, [x, y, x + 3, y - 6, x - 2, y - 12, x + 2, y - 18], d.color, 1.8); },
  lake: (g, W, H, d) => pool(g, W / 2, H / 2 + 2, W * 0.44, H * 0.38, d.color),
  frozen_lake: (g, W, H, d) => { pool(g, W / 2, H / 2 + 2, W * 0.44, H * 0.38, d.color); line(g, [W * 0.3, H * 0.5, W * 0.45, H * 0.45, W * 0.55, H * 0.6], alpha('#ffffff', 0.9), 0.9); },
  lava_lake: (g, W, H, d) => { glow(g, W / 2, H / 2, W * 0.5, '#ff6010', 0.4); pool(g, W / 2, H / 2 + 2, W * 0.44, H * 0.38, d.color, { shore: '#2e1c1c' }); },
  oasis_lake: (g, W, H, d, k) => { pool(g, W / 2, H / 2 + 2, W * 0.4, H * 0.34, d.color); tree(g, W * 0.85, H - 2, T, 'palm', '#4a9a3a', k.r); },
  lava_flow: (g, W, H, d) => { glow(g, W / 2, H / 2, W * 0.4, '#ff6010', 0.4); curve(g, [2, H * 0.6, W * 0.3, H * 0.4, W * 0.6, H * 0.7, W - 2, H * 0.5], '#2e1c1c', 9); curve(g, [2, H * 0.6, W * 0.3, H * 0.4, W * 0.6, H * 0.7, W - 2, H * 0.5], d.color, 6); },
  crater: (g, W, H, d) => { ell(g, W / 2, H / 2 + 2, W * 0.42, H * 0.34, shade(d.color, -0.2), INK, 1); ell(g, W / 2, H / 2 + 4, W * 0.32, H * 0.22, '#1a1410', null); },
  canyon: (g, W, H, d) => { poly(g, [2, H * 0.3, W * 0.4, H * 0.45, W - 2, H * 0.3, W - 2, H * 0.7, W * 0.6, H * 0.6, 2, H * 0.75], '#2a1a10', INK, 1); line(g, [2, H * 0.3, W * 0.4, H * 0.45, W - 2, H * 0.3], d.color, 2.4); },
  mushroom: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.round(W / T * H / T * 2))) { rect(g, x - 1.5, y - 9, 3, 9, '#e8e0d0', INK, 0.6); ell(g, x, y - 9, 6, 4, d.color, INK, 0.8); circ(g, x - 2, y - 10, 1, '#ffffff', null); } },
  stalagmite: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.round(W / T * H / T * 2))) poly(g, [x - 5, y, x - 1, y - k.r.f(14, 22), x + 5, y], vgrad(g, y - 20, y, d.color, 0.25), INK, 0.9); },
  crystal: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.round(W / T))) crystals(g, x, y, T * 0.75, d.color); },
  stump: (g, W, H, d) => { ell(g, W / 2, H - 9, 7, 3, '#c8a070', INK, 0.8); rect(g, W / 2 - 7, H - 9, 14, 6, d.color, null); ell(g, W / 2, H - 3, 7, 2.6, d.color, INK, 0.8); line(g, [W / 2 - 7, H - 9, W / 2 - 7, H - 3], INK, 0.8); line(g, [W / 2 + 7, H - 9, W / 2 + 7, H - 3], INK, 0.8); },
  log: (g, W, H, d) => { rrect(g, 6, H - 13, W - 12, 8, 4, vgrad(g, H - 13, H - 5, d.color, 0.2), INK, 1); ell(g, W - 8, H - 9, 2.6, 4, '#c8a070', INK, 0.7); },
  shrub: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.round(W / T * 2))) for (const dx of [-4, 4, 0]) circ(g, x + dx, y - 5 - (dx ? 0 : 3), 5, tweak2(d.color, k.r), INK, 0.8); },
  flowers: (g, W, H, d, k) => { for (let i = 0; i < Math.round(W / 4); i++) { const x = k.r.f(3, W - 3); const y = k.r.f(H * 0.4, H - 3); line(g, [x, y, x, y - 3], '#3a7a2a', 0.8); circ(g, x, y - 3.5, 1.4, k.r.pick([d.color, '#e8d040', '#ffffff', '#8a5ae8']), null); } },
  cactus: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.round(W / T))) { rrect(g, x - 2.5, y - 20, 5, 20, 2.5, d.color, INK, 0.8); rrect(g, x - 8, y - 15, 3.5, 8, 1.7, d.color, INK, 0.7); rrect(g, x + 4.5, y - 17, 3.5, 7, 1.7, d.color, INK, 0.7); } },
  dune: (g, W, H, d) => { blob(g, [2, H - 2, W * 0.3, H * 0.4, W * 0.6, H * 0.35, W - 2, H - 2], vgrad(g, H * 0.35, H, d.color, 0.2), shade(d.color, -0.3), 1); },
  reeds: (g, W, H, d, k) => { for (let i = 0; i < Math.round(W / 3); i++) { const x = k.r.f(3, W - 3); line(g, [x, H - 3, x + k.r.f(-2, 2), H - k.r.f(12, 22)], d.color, 1.1); } },
  moss: (g, W, H, d, k) => { for (let i = 0; i < 4 * Math.round(W / T); i++) ell(g, k.r.f(5, W - 5), k.r.f(H * 0.4, H - 4), k.r.f(3, 6), k.r.f(2, 3), alpha(d.color, 0.9), null); },
  ice_block: (g, W, H, d, k) => { for (const [x, y] of scatter(W, H, k.r, Math.round(W / T))) poly(g, [x - 10, y, x - 8, y - 16, x + 2, y - 20, x + 10, y - 12, x + 9, y], vgrad(g, y - 20, y, d.color, 0.3), shade(d.color, -0.4), 1); },
  tar_pit: (g, W, H, d) => { pool(g, W / 2, H / 2 + 2, W * 0.42, H * 0.34, d.color, { shine: false }); circ(g, W * 0.4, H / 2, 2, '#3a3430', null); },
  bones: (g, W, H, d, k) => P.bones(g, W, H, d, k),
  tree: (g, W, H, d, k) => forest(g, W, H, 'oak', d.color, k.r),
};

function generic(g, W, H, d, k) {
  ground(g, W, H);
  house(g, W / 2, H - 4, W * 0.6, H * 0.8, { wall: mix(d.color, '#c0b090', 0.5), roof: shade(d.color, -0.3), r: k.r });
}

/** Effect types of objects that can be owned (drawn with a player flag). */
export const FLAG_EFFECTS = ['mine', 'dwelling', 'shipyard', 'lighthouse', 'garrison', 'town'];

/** Which painter an object uses: 'decor:<shape>', 'shape:<shape>', 'town' or 'generic'. */
export function objectPainterName(id) {
  const d = MAP_OBJECT_BY_ID[id];
  if (!d) return 'generic';
  if (d.category === 'town') return 'town';
  if (d.category === 'decor' && DECOR[d.shape]) return `decor:${d.shape}`;
  if (P[d.shape]) return `shape:${d.shape}`;
  if (DECOR[d.shape]) return `decor:${d.shape}`;
  return 'generic';
}

/**
 * opts: size = pixels per tile (default 32), frame (animated: windmill, campfire, portals...),
 *       playerColor (ownership flag for flaggable objects), variant (town: faction id),
 *       state (town: village|fort|citadel|castle).
 */
export function objectHandler(id, o) {
  const d = MAP_OBJECT_BY_ID[id] || { id, size: [1, 1], color: '#a09a8a', shape: 'unknown', category: 'special' };
  const [w, h] = d.size;
  const W = w * T;
  const H = h * T;
  const frame = (((o.frame | 0) % 4) + 4) % 4;
  const flaggable = ['mine', 'dwelling', 'town'].includes(d.category) || FLAG_EFFECTS.includes(d.effect && d.effect.type);
  const pc = flaggable && o.playerColor !== undefined && o.playerColor !== null ? playerColorHex(o.playerColor) : null;
  const name = objectPainterName(id);
  const town = name === 'town';
  return {
    dw: W, dh: H, unit: T, size: 32, frames: 4,
    ax: (Math.floor(w / 2) + 0.5) * T, ay: H,
    key: `${frame}|${pc || ''}|${town ? `${o.variant || ''}|${o.state || ''}` : ''}`,
    paint: (g) => {
      const k = { r: seeded(`obj:${id}`), f: frame, pc, id, o };
      if (town) paintTown(g, W, H, d, k);
      else if (name.startsWith('decor:')) DECOR[d.shape](g, W, H, d, k);
      else if (name.startsWith('shape:')) P[d.shape](g, W, H, d, k);
      else generic(g, W, H, d, k);
      if (pc && !town) flag(g, 6, Math.min(H - 4, 26), 18, pc, 1, frame);
      if (pc && town) flag(g, W * 0.5 + 10, H * 0.3, H * 0.3, pc, 1, frame);
    },
  };
}
