// Town screen art: `town` kind (per-faction backdrop, 800 x 374 design grid), `building` kind
// (each building as a piece for the composed town view) and getTownLayout(factionId).

import { BUILDINGS, BUILDING_BY_ID } from '../data/buildings.js';
import { FACTIONS_DATA } from '../data/factions.js';
import { FACTIONS } from '../core/constants.js';
import { INK, alpha, blob, circ, curve, ell, glow, hashStr, lgrad, line, mix, poly, rect, rgrad, rrect, seeded, shade, star, vgrad } from './kit.js';
import { factionPalette, RESOURCE_HEX } from './palette.js';
import { house, tower, tent, wallSeg, tree, mountain, crystals, cave, pool, temple, hull } from './structures.js';
import { paintCreature } from './creatures.js';
import { resourceGlyph } from './objects.js';

export const TOWN_VIEW = { width: 800, height: 374, horizon: 190 };
export const TOWN_IDS = [...FACTIONS];
export const BUILDING_IDS = BUILDINGS.map((b) => b.id);

const FACTION_BY_ID = Object.fromEntries(FACTIONS_DATA.map((f) => [f.id, f]));

const CHAINS = {
  hall: ['village_hall', 'town_hall', 'city_hall', 'capitol'],
  fort: ['fort', 'citadel', 'castle'],
  mage: ['mage_guild_1', 'mage_guild_2', 'mage_guild_3', 'mage_guild_4', 'mage_guild_5'],
};

const STYLE = {
  castle: { roofKind: 'gable', towerRoof: 'cone' }, rampart: { roofKind: 'thatch', towerRoof: 'cone' },
  tower: { roofKind: 'dome', towerRoof: 'onion' }, inferno: { roofKind: 'spike', towerRoof: 'spike' },
  necropolis: { roofKind: 'spike', towerRoof: 'spike' }, dungeon: { roofKind: 'pagoda', towerRoof: 'spike' },
  stronghold: { roofKind: 'tent', towerRoof: 'flat' }, fortress: { roofKind: 'thatch', towerRoof: 'cone' },
  conflux: { roofKind: 'dome', towerRoof: 'dome' }, cove: { roofKind: 'hip', towerRoof: 'cone' },
  factory: { roofKind: 'flat', towerRoof: 'flat' },
};

/** Buildings shown in a faction's town (common ones + the faction's own). */
export function townBuildings(factionId) {
  return BUILDINGS.filter((b) => b.faction === 'common' || b.faction === factionId).map((b) => b.id);
}

const layoutCache = new Map();

/**
 * Layout of every building of a faction on the 800x374 town canvas.
 * @returns {{ [buildingId]: { x, y, w, h, z } }} top-left box + draw order (higher z = in front)
 */
export function getTownLayout(factionId) {
  if (layoutCache.has(factionId)) return structuredCloneLayout(layoutCache.get(factionId));
  const r = seeded(`layout:${factionId}`);
  const out = {};
  const put = (id, cx, base, w, h, sub = 0) => {
    const jx = r.f(-8, 8);
    out[id] = { x: Math.round(cx + jx - w / 2), y: Math.round(base - h), w: Math.round(w), h: Math.round(h), z: Math.round(base) * 10 + sub };
  };
  CHAINS.fort.forEach((id, i) => put(id, 400, 196, 240 + i * 30, 70 + i * 25, i));
  CHAINS.hall.forEach((id, i) => put(id, 110, 302, 90 + i * 14, 72 + i * 20, i));
  CHAINS.mage.forEach((id, i) => put(id, 700, 214, 52, 64 + i * 20, i));
  put('tavern', 250, 330, 90, 66);
  put('blacksmith', 560, 342, 84, 62);
  put('marketplace', 655, 360, 100, 56);
  put('resource_silo', 750, 318, 54, 72);
  put('shipyard', 735, 372, 110, 52);
  const anchors = [[205, 244], [305, 238], [515, 240], [612, 250], [350, 348], [465, 352], [70, 370], [790 - 40, 262]];
  const order = [0, 1, 2, 3, 4, 5, 6];
  for (let i = order.length - 1; i > 0; i--) {
    const j = r.i(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const extras = [[40, 252], [262, 204], [548, 200], [170, 338], [420, 262], [770, 210], [600, 300]];
  let e = 0;
  for (const id of townBuildings(factionId)) {
    if (out[id]) continue;
    const b = BUILDING_BY_ID[id];
    if (b.kind === 'dwelling') {
      const tier = b.dwelling ? b.dwelling.tier : 1;
      const alt = id.includes('_alt');
      const [ax, ay] = alt ? anchors[7] : anchors[order[(tier - 1) % 7]];
      const up = b.dwelling && b.dwelling.upgraded ? 1 : 0;
      put(id, ax, ay, 62 + tier * 6 + up * 10, 52 + tier * 7 + up * 10, up + 2);
    } else if (b.kind === 'grail') {
      put(id, 400, 300, 72, 120, 5);
    } else {
      const [ax, ay] = extras[e % extras.length];
      put(id, ax, ay + Math.floor(e / extras.length) * 12, 72, 64, 1 + Math.floor(e / extras.length));
      e++;
    }
  }
  layoutCache.set(factionId, out);
  return structuredCloneLayout(out);
}

function structuredCloneLayout(l) {
  return Object.fromEntries(Object.entries(l).map(([k, v]) => [k, { ...v }]));
}

// ---------------------------------------------------------------------------------------------
// Building painters (box w x h, ground line at y = h)
// ---------------------------------------------------------------------------------------------

function styleFor(f) {
  const pal = factionPalette(f);
  return { pal, ...STYLE[f] || STYLE.castle, wall: pal.wall, roof: pal.roof, lw: 1.6 };
}

function paintBuilding(g, b, f, W, H) {
  const s = styleFor(f);
  const r = seeded(`bld:${b.id}:${f}`);
  const pal = s.pal;
  const cx = W / 2;
  const base = H - 2;
  const lw = 1.6;
  const glowC = f === 'inferno' ? '#ff8030' : f === 'necropolis' ? '#80ff90' : '#ffd070';
  ell(g, cx, base, W * 0.46, Math.min(6, H * 0.06), 'rgba(0,0,0,0.25)', null);
  const level = (chain) => Math.max(0, chain.indexOf(b.id));
  switch (b.kind) {
    case 'hall': {
      const lv = level(CHAINS.hall);
      house(g, cx, base, W * (0.62 - lv * 0.04), H * (0.62 + lv * 0.06), { wall: s.wall, roof: lv === 3 ? '#e8c040' : s.roof, roofKind: lv === 3 ? 'dome' : s.roofKind === 'tent' ? 'gable' : s.roofKind, r, windows: 2 + lv * 2, glow: glowC, lw, trim: pal.trim });
      for (let i = 0; i < lv; i++) {
        const d = i % 2 ? 1 : -1;
        tower(g, cx + d * W * (0.36 + Math.floor(i / 2) * 0.08), base, W * 0.13, H * (0.6 + lv * 0.08), { wall: s.wall, roof: lv === 3 ? '#e8c040' : s.roof, roofKind: s.towerRoof, r, lw, banner: pal.main, glow: glowC });
      }
      break;
    }
    case 'fort': {
      const lv = level(CHAINS.fort);
      wallSeg(g, W * 0.04, base, W * 0.92, H * 0.5, { wall: s.wall, r, lw });
      const n = 2 + lv;
      for (let i = 0; i < n; i++) {
        const x = W * (0.06 + (0.88 * i) / (n - 1));
        tower(g, x, base, W * 0.1, H * (0.7 + (i % 2) * 0.1), { wall: s.wall, roof: s.roof, roofKind: s.towerRoof === 'flat' ? 'battlement' : s.towerRoof, r, lw, banner: i === 0 ? pal.main : null });
      }
      if (lv >= 1) tower(g, cx, base - H * 0.05, W * 0.16, H * 0.95, { wall: shade(s.wall, 0.05), roof: s.roof, roofKind: s.towerRoof, r, lw, banner: pal.main, glow: glowC });
      g.beginPath();
      g.moveTo(cx - W * 0.06, base);
      g.lineTo(cx - W * 0.06, base - H * 0.24);
      g.quadraticCurveTo(cx, base - H * 0.34, cx + W * 0.06, base - H * 0.24);
      g.lineTo(cx + W * 0.06, base);
      g.closePath();
      g.fillStyle = '#2a1a10';
      g.fill();
      for (let i = -2; i <= 2; i++) line(g, [cx + i * W * 0.022, base - H * 0.28, cx + i * W * 0.022, base], '#5a5a62', 1.2);
      break;
    }
    case 'dwelling': case 'horde': {
      const info = b.dwelling || {};
      const up = !!info.upgraded;
      const bw = W * 0.62;
      const bx = W * 0.4;
      if (f === 'rampart') tree(g, bx, base, H * 0.98, 'oak', '#3c8c3c', r, lw);
      if (f === 'dungeon' || f === 'inferno') cave(g, bx, base, bw, H * 0.85, s.wall, { lw, glow: glowC });
      else if (f === 'stronghold') tent(g, bx, base, bw, H * 0.86, { color: s.wall, stripe: s.roof, flagC: pal.main, lw });
      else house(g, bx, base - (f === 'rampart' ? H * 0.3 : 0), bw * (f === 'rampart' ? 0.6 : 1), H * (f === 'rampart' ? 0.4 : 0.8), { wall: s.wall, roof: s.roof, roofKind: s.roofKind, r, lw, windows: 2, glow: glowC, trim: pal.trim });
      if (up) {
        line(g, [bx + bw * 0.45, base, bx + bw * 0.45, base - H * 0.95], INK, 1.6);
        poly(g, [bx + bw * 0.45, base - H * 0.95, bx + bw * 0.45 + W * 0.14, base - H * 0.88, bx + bw * 0.45, base - H * 0.8], pal.trim, INK, 1.2);
      }
      const cid = info.creatureId;
      if (cid) {
        try {
          g.save();
          const k = (H * (b.kind === 'horde' ? 0.45 : 0.62)) / 100;
          g.translate(W * 0.98 - 100 * k, base - 92 * k);
          g.scale(k, k);
          paintCreature(g, cid, 'idle', 0);
          g.restore();
        } catch {
          g.restore();
        }
      } else if (b.kind === 'horde') star(g, W * 0.82, H * 0.3, W * 0.08, W * 0.03, 5, pal.trim, INK, 1);
      break;
    }
    case 'mage_guild': {
      const lv = level(CHAINS.mage) + 1;
      const segH = (H * 0.86) / (lv + 0.6);
      for (let i = 0; i < lv; i++) {
        const w = W * (0.7 - i * 0.07);
        const y0 = base - i * segH;
        rect(g, cx - w / 2, y0 - segH, w, segH, vgrad(g, y0 - segH, y0, i % 2 ? shade(s.wall, -0.06) : s.wall, 0.16), INK, lw);
        rect(g, cx - w * 0.1, y0 - segH * 0.75, w * 0.2, segH * 0.45, '#9ad0ff', INK, 1);
        rect(g, cx - w / 2 - 2, y0 - segH - 2, w + 4, 3.5, pal.roof, INK, 1);
      }
      const ty = base - lv * segH;
      poly(g, [cx - W * 0.22, ty, cx, ty - segH * 0.7, cx + W * 0.22, ty], s.roof, INK, lw);
      glow(g, cx, ty - segH * 0.85, W * 0.3, '#9ad0ff', 0.7);
      circ(g, cx, ty - segH * 0.85, W * 0.07, '#cfe8ff', INK, 1);
      break;
    }
    case 'tavern': {
      house(g, cx, base, W * 0.7, H * 0.82, { wall: s.wall, roof: s.roof, roofKind: s.roofKind === 'flat' ? 'gable' : s.roofKind, r, lw, windows: 2, glow: '#ffc050', timber: true, chimney: true, smoke: true });
      line(g, [cx + W * 0.36, base - H * 0.5, cx + W * 0.48, base - H * 0.5], INK, 1.6);
      rrect(g, cx + W * 0.4, base - H * 0.47, W * 0.1, H * 0.13, 2, '#e8c040', INK, 1);
      break;
    }
    case 'blacksmith': {
      house(g, cx - W * 0.08, base, W * 0.6, H * 0.74, { wall: shade(s.wall, -0.15), roof: '#4a4a52', roofKind: 'flat', r, lw, chimney: true, smoke: true, glow: '#ff8030', windows: 2 });
      rect(g, cx + W * 0.28, base - H * 0.16, W * 0.14, H * 0.07, '#4a4a52', INK, 1.2);
      rect(g, cx + W * 0.32, base - H * 0.1, W * 0.06, H * 0.1, '#4a4a52', INK, 1.2);
      break;
    }
    case 'market': {
      for (let i = 0; i < 3; i++) {
        const x = W * (0.2 + i * 0.3);
        rect(g, x - W * 0.12, base - H * 0.3, W * 0.24, H * 0.3, '#8a6a3e', INK, 1.2);
        for (const d of [-1, 1]) line(g, [x + d * W * 0.11, base - H * 0.3, x + d * W * 0.11, base - H * 0.7], '#6a4626', 1.6);
        poly(g, [x - W * 0.14, base - H * 0.62, x + W * 0.14, base - H * 0.62, x + W * 0.11, base - H * 0.78, x - W * 0.11, base - H * 0.78], i % 2 ? pal.main : '#f0ece0', INK, 1.2);
        resourceGlyph(g, ['gold', 'gems', 'wood'][i], x, base - H * 0.42, W * 0.12);
      }
      break;
    }
    case 'silo': {
      const res = (FACTION_BY_ID[f] && FACTION_BY_ID[f].siloResources) || ['ore'];
      rect(g, cx - W * 0.32, base - H * 0.72, W * 0.64, H * 0.72, lgrad(g, cx - W * 0.32, 0, cx + W * 0.32, 0, [[0, shade(s.wall, 0.15)], [0.6, s.wall], [1, shade(s.wall, -0.25)]]), INK, lw);
      g.beginPath();
      g.ellipse(cx, base - H * 0.72, W * 0.34, H * 0.16, 0, Math.PI, Math.PI * 2);
      g.closePath();
      g.fillStyle = vgrad(g, base - H * 0.9, base - H * 0.72, s.roof, 0.2);
      g.fill();
      g.strokeStyle = INK;
      g.stroke();
      for (const t of [0.3, 0.55]) line(g, [cx - W * 0.32, base - H * t, cx + W * 0.32, base - H * t], shade(s.wall, -0.3), 1.2);
      res.forEach((rid, i) => resourceGlyph(g, rid, cx + (i - (res.length - 1) / 2) * W * 0.3, base - H * 0.12, W * 0.26));
      break;
    }
    case 'shipyard': {
      pool(g, cx, base - H * 0.12, W * 0.48, H * 0.14, '#3a74b8', { lw, shine: false });
      rect(g, W * 0.04, base - H * 0.32, W * 0.3, H * 0.08, '#8a6a3e', INK, 1.2);
      hull(g, cx + W * 0.1, base - H * 0.15, W * 0.55, H * 0.28, '#8a5a2a', lw);
      for (let i = 0; i < 4; i++) line(g, [cx - W * 0.12 + i * W * 0.1, base - H * 0.42, cx - W * 0.12 + i * W * 0.1, base - H * 0.75], '#6a4626', 1.4);
      line(g, [cx - W * 0.14, base - H * 0.75, cx + W * 0.2, base - H * 0.75], '#6a4626', 1.6);
      break;
    }
    case 'grail': {
      glow(g, cx, H * 0.35, W * 0.6, '#ffe070', 0.6);
      rect(g, cx - W * 0.35, base - H * 0.12, W * 0.7, H * 0.12, '#c8c0b0', INK, lw);
      const shape = { tower: 'spire', inferno: 'spire', necropolis: 'spire', dungeon: 'spire', rampart: 'tree', fortress: 'tree', conflux: 'crystal', cove: 'crystal' }[f] || 'monument';
      if (shape === 'tree') tree(g, cx, base - H * 0.12, H * 0.86, 'oak', '#e8c040', r, lw);
      else if (shape === 'crystal') crystals(g, cx, base - H * 0.12, H * 0.82, '#f0e080', lw, 5);
      else if (shape === 'spire') poly(g, [cx - W * 0.2, base - H * 0.12, cx, base - H * 0.98, cx + W * 0.2, base - H * 0.12], vgrad(g, 0, H, '#e8c040', 0.35), INK, lw);
      else {
        rect(g, cx - W * 0.12, base - H * 0.75, W * 0.24, H * 0.63, vgrad(g, base - H * 0.75, base, '#e8c040', 0.35), INK, lw);
        poly(g, [cx - W * 0.3, base - H * 0.75, cx - W * 0.2, base - H * 0.95, cx + W * 0.2, base - H * 0.95, cx + W * 0.3, base - H * 0.75], '#f6e08a', INK, lw);
      }
      star(g, cx, H * 0.12, W * 0.08, W * 0.03, 6, '#ffffff', null);
      break;
    }
    default: paintSpecial(g, b, f, W, H, s, r); break;
  }
}

function paintSpecial(g, b, f, W, H, s, r) {
  const id = b.id;
  const cx = W / 2;
  const base = H - 2;
  const lw = 1.6;
  const pal = s.pal;
  const has = (...k) => k.some((x) => id.includes(x));
  if (has('lighthouse', 'lookout')) {
    tower(g, cx, base, W * 0.3, H * 0.95, { wall: '#f0e8d0', roof: s.roof, roofKind: 'cone', taperK: 0.7, lw, glow: '#ffe070', r });
  } else if (has('pond', 'fountain', 'pools', 'grotto', 'spring')) {
    pool(g, cx, base - H * 0.18, W * 0.42, H * 0.18, has('pools') ? '#ff6030' : '#4a9ad8', { lw });
    rect(g, cx - 3, base - H * 0.65, 6, H * 0.45, '#c8c0b0', INK, 1.2);
    for (const d of [-1, 1]) curve(g, [cx, base - H * 0.65, cx + d * W * 0.15, base - H * 0.75, cx + d * W * 0.25, base - H * 0.25], alpha('#9ad0ff', 0.9), 2);
  } else if (has('library', 'university', 'academy', 'wall_of_knowledge', 'brotherhood', 'order_of_fire', 'hall_of_valhalla', 'proving')) {
    temple(g, cx, base, W * 0.86, H * 0.86, { wall: mix(s.wall, '#f0ece0', 0.5), roof: s.roof, emblem: pal.trim, glow: has('order_of_fire') ? '#ff7020' : null, lw });
  } else if (has('stables', 'cage', 'guild', 'quarters', 'mess', 'treasury', 'bank', 'merchants', 'tunnel')) {
    house(g, cx, base, W * 0.76, H * 0.7, { wall: s.wall, roof: s.roof, roofKind: s.roofKind, r, lw, windows: 2, glow: '#ffd070', timber: has('stables') });
    if (has('treasury', 'bank', 'merchants')) resourceGlyph(g, 'gold', W * 0.85, base - H * 0.08, W * 0.22);
    if (has('tunnel')) cave(g, W * 0.82, base, W * 0.3, H * 0.4, '#7a6a5a', { lw });
  } else if (has('vortex', 'portal', 'generator', 'amplifier', 'transformer', 'obelisk', 'glyphs', 'stormclouds', 'gate', 'darkness')) {
    const c = has('stormclouds', 'gate') ? '#ff6030' : has('darkness', 'amplifier', 'transformer') ? '#80ff90' : has('blood') ? '#d03030' : '#a080ff';
    if (has('obelisk', 'glyphs', 'darkness')) poly(g, [cx - W * 0.12, base, cx - W * 0.07, base - H * 0.88, cx, base - H * 0.98, cx + W * 0.07, base - H * 0.88, cx + W * 0.12, base], vgrad(g, 0, H, has('darkness') ? '#2a2632' : s.wall, 0.25), INK, lw);
    else tower(g, cx, base, W * 0.34, H * 0.8, { wall: s.wall, roof: s.roof, roofKind: s.towerRoof, r, lw });
    glow(g, cx, H * 0.25, W * 0.4, c, 0.7);
    star(g, cx, H * 0.25, W * 0.1, W * 0.04, 6, shade(c, 0.4), null);
  } else if (has('mushroom', 'garden', 'saplings', 'roost', 'burrows', 'stockyard', 'graves', 'birthing', 'sculptor', 'miners', 'griffin_bastion', 'warehouse')) {
    house(g, cx, base, W * 0.6, H * 0.55, { wall: s.wall, roof: s.roof, roofKind: s.roofKind, r, lw });
    for (let i = 0; i < 3; i++) circ(g, W * (0.15 + i * 0.35), base - 5, 5, pal.trim, INK, 1);
  } else {
    house(g, cx, base, W * 0.66, H * 0.78, { wall: s.wall, roof: s.roof, roofKind: s.roofKind, r, lw, windows: 2, glow: '#ffd070' });
    star(g, cx, H * 0.12, W * 0.07, W * 0.03, 5, pal.trim, INK, 1);
  }
}

/**
 * Building sprite. opts: variant = faction id (needed for common buildings, default the
 * building's own faction or 'castle'), size = pixel height (default = layout height).
 */
export function buildingHandler(id, o) {
  const b = BUILDING_BY_ID[id];
  if (!b) throw new Error(`gfx: unknown building '${id}'`);
  const f = b.faction !== 'common' ? b.faction : FACTIONS.includes(o.variant) ? o.variant : 'castle';
  const L = getTownLayout(f)[id] || { w: 80, h: 70 };
  return { dw: L.w, dh: L.h, unit: L.h, size: L.h, key: f, paint: (g) => paintBuilding(g, b, f, L.w, L.h) };
}

// ---------------------------------------------------------------------------------------------
// Backdrops
// ---------------------------------------------------------------------------------------------

function ridge(g, y, amp, color, r, W = 800) {
  g.beginPath();
  g.moveTo(0, 374);
  g.lineTo(0, y);
  for (let x = 0; x <= W; x += 40) g.lineTo(x, y - r.f(0, amp));
  g.lineTo(W, 374);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

function paintTownBackdrop(g, f) {
  const pal = factionPalette(f);
  const r = seeded(`backdrop:${f}`);
  const [s0, s1] = pal.sky;
  const hz = TOWN_VIEW.horizon;
  rect(g, 0, 0, 800, 374, lgrad(g, 0, 0, 0, hz + 40, [[0, s0], [1, s1]]), null);
  const night = f === 'necropolis' || f === 'dungeon' || f === 'inferno';
  if (f === 'dungeon') {
    for (let x = 0; x < 800; x += 26) poly(g, [x, 0, x + 13, r.f(30, 90), x + 26, 0], '#2a2028', null);
    for (let i = 0; i < 6; i++) crystals(g, r.f(20, 780), r.f(110, 170), r.f(14, 26), '#8a5cc0', 1);
  } else if (night) {
    circ(g, 660, 70, 30, f === 'inferno' ? '#ff9a50' : '#e8e8f0', null);
    glow(g, 660, 70, 90, f === 'inferno' ? '#ff6020' : '#c0c8ff', 0.3);
    if (f === 'necropolis') for (let i = 0; i < 40; i++) rect(g, r.f(0, 800), r.f(0, 150), 1.5, 1.5, alpha('#ffffff', 0.7), null);
  } else {
    glow(g, 140, 70, 90, '#fff8d0', 0.6);
    circ(g, 140, 70, 26, '#fff8e0', null);
    for (let i = 0; i < 5; i++) {
      const x = r.f(0, 800);
      const y = r.f(30, 120);
      for (const [dx, dy, rr] of [[0, 0, 18], [20, -6, 22], [42, 0, 16]]) ell(g, x + dx, y + dy, rr * 1.4, rr * 0.7, alpha('#ffffff', 0.75), null);
    }
  }
  if (f === 'conflux') for (let i = 0; i < 4; i++) {
    const x = r.f(60, 740);
    const y = r.f(50, 130);
    blob(g, [x - 40, y, x, y - 12, x + 40, y, x + 10, y + 30, x - 10, y + 30], vgrad(g, y - 12, y + 30, '#8a6a9a', 0.3), INK, 1.5);
    crystals(g, x, y - 4, 26, '#f0a0e0', 1);
  }
  const far = { tower: '#c8d8ea', inferno: '#5a1a14', necropolis: '#3a3448', stronghold: '#c8885a', factory: '#b8805a', cove: '#7ab0c8', dungeon: '#3a2e36' }[f] || mix(s1, pal.ground, 0.55);
  if (f === 'stronghold' || f === 'factory') {
    for (let i = 0; i < 4; i++) {
      const x = r.f(0, 760);
      const w = r.f(80, 160);
      const h = r.f(50, 90);
      poly(g, [x, hz + 10, x + 15, hz - h, x + w - 15, hz - h, x + w, hz + 10], far, null);
      line(g, [x + 15, hz - h, x + w - 15, hz - h], shade(far, 0.2), 2);
    }
  } else {
    for (let i = 0; i < 6; i++) mountain(g, r.f(0, 800), hz + 15, r.f(160, 260), r.f(70, 130), far, f === 'tower' || f === 'castle' || f === 'rampart' ? '#ffffff' : null, r, 0);
  }
  if (f === 'factory') for (const x of [120, 690]) {
    rect(g, x, hz - 90, 16, 100, '#6a5a4a', INK, 1.4);
    for (let i = 0; i < 4; i++) circ(g, x + 8 + i * 12, hz - 100 - i * 18, 10 + i * 4, alpha('#8a8070', 0.5 - i * 0.1), null);
  }
  ridge(g, hz + 10, 30, mix(far, pal.ground, 0.6), r);
  // ground
  rect(g, 0, hz, 800, 374 - hz, lgrad(g, 0, hz, 0, 374, [[0, shade(pal.ground, 0.08)], [1, shade(pal.ground, -0.3)]]), null);
  for (let i = 0; i < 160; i++) rect(g, r.f(0, 800), r.f(hz, 374), r.f(2, 6), 1.5, alpha(shade(pal.ground, r.chance(0.5) ? 0.2 : -0.25), 0.6), null);
  if (f === 'inferno') {
    for (let i = 0; i < 3; i++) {
      const y = r.f(hz + 30, 360);
      curve(g, [0, y, 200, y - 20, 420, y + 15, 800, y - 10], alpha('#ff6010', 0.4), 14);
      curve(g, [0, y, 200, y - 20, 420, y + 15, 800, y - 10], '#ff9a30', 4);
    }
  } else if (f === 'fortress' || f === 'cove') {
    pool(g, f === 'cove' ? 720 : 120, 345, 160, 40, f === 'cove' ? '#3a90c8' : '#3a6a5a', { lw: 0 });
    if (f === 'fortress') for (let i = 0; i < 4; i++) tree(g, r.f(10, 790), r.f(hz + 10, hz + 40), 70, 'mangrove', '#2a5a3a', r, 1.4);
    else for (let i = 0; i < 3; i++) tree(g, r.f(10, 790), r.f(hz + 10, hz + 40), 80, 'palm', '#4a9a3a', r, 1.4);
  } else if (f === 'rampart' || f === 'castle') {
    for (let i = 0; i < 6; i++) tree(g, r.f(0, 800), hz + r.f(4, 30), r.f(50, 80), f === 'rampart' ? 'oak' : r.pick(['oak', 'pine']), f === 'rampart' ? '#3c8c3c' : '#3a7a2a', r, 1.4);
  } else if (f === 'necropolis') {
    for (let i = 0; i < 6; i++) tree(g, r.f(0, 800), hz + r.f(4, 30), r.f(50, 80), 'dead', '#4a3a2a', r, 1.4);
    for (let i = 0; i < 8; i++) {
      const x = r.f(20, 780);
      const y = r.f(hz + 40, 370);
      rrect(g, x - 5, y - 14, 10, 14, 4, '#7a7680', INK, 1.2);
    }
  } else if (f === 'tower') {
    for (let i = 0; i < 6; i++) ell(g, r.f(0, 800), r.f(hz + 20, 370), r.f(30, 60), r.f(6, 12), alpha('#ffffff', 0.7), null);
  }
}

/** Town backdrop. opts.size = pixel height (default 374; width = size * 800 / 374). */
export function townHandler(id) {
  const f = FACTIONS.includes(id) ? id : 'castle';
  return { dw: 800, dh: 374, unit: 374, size: 374, key: f, paint: (g) => paintTownBackdrop(g, f) };
}

export { hashStr, RESOURCE_HEX, rgrad };
