// Combat extras: `obstacle` kind (battlefield obstacles per terrain, spell obstacles, siege
// wall/gate/tower/keep/moat pieces in intact/damaged/destroyed states) and `effect` kind (particle /
// flash frame sequences per spell category, projectiles).

import { TERRAIN_DATA } from '../data/terrain.js';
import { SPELL_BY_ID } from '../data/spells.js';
import { FACTIONS } from '../core/constants.js';
import { INK, alpha, at, blob, circ, curve, ell, glow, line, poly, rect, rgrad, seeded, shade, star, vgrad, lgrad } from './kit.js';
import { factionPalette } from './palette.js';
import { tree, rock, crystals, pool, tower, wallSeg } from './structures.js';

const TERRAIN_OBSTACLES = [...new Set(TERRAIN_DATA.flatMap((t) => t.obstacles || []))];
const SPELL_OBSTACLES = ['quicksand', 'land_mine', 'force_field', 'fire_wall'];
const SIEGE = ['wall', 'gate', 'tower', 'keep', 'moat'];
export const OBSTACLE_IDS = [...TERRAIN_OBSTACLES, ...SPELL_OBSTACLES, ...SIEGE];
export const SIEGE_STATES = ['intact', 'damaged', 'destroyed'];

const SIEGE_SIZE = { wall: [48, 96], gate: [64, 96], tower: [56, 110], keep: [90, 120], moat: [48, 24] };

function crack(g, x, y, h, r) {
  const pts = [x, y];
  for (let i = 1; i <= 4; i++) pts.push(x + r.f(-5, 5), y + (h * i) / 4);
  line(g, pts, '#1a1410', 1.6);
}

/**
 * A stone wall block with depth: footing, lit walkway on top, brick front face with side shading,
 * merlons with lit tops and a few moss / stain patches. Original procedural art.
 */
function wallBlock(g, W, H, wall, r, top = 0.2) {
  const y0 = H * top;
  const d = Math.max(4, W * 0.12);                   // depth of the walkway (seen from above)
  // footing
  rect(g, 0, H - 9, W, 9, vgrad(g, H - 9, H, shade(wall, -0.25), 0.2), INK, 1.2);
  // front face
  rect(g, 2, y0 + d, W - 4, H - 9 - y0 - d, lgrad(g, 0, y0 + d, 0, H - 9, [[0, shade(wall, 0.08)], [1, shade(wall, -0.22)]]), INK, 1.4);
  const rows = Math.max(4, Math.round((H - 9 - y0 - d) / 9));
  const rh = (H - 9 - y0 - d) / rows;
  for (let i = 1; i < rows; i++) line(g, [3, y0 + d + i * rh, W - 3, y0 + d + i * rh], alpha(shade(wall, -0.35), 0.55), 1);
  for (let i = 0; i < rows; i++) {
    const off = i % 2 ? W * 0.25 : 0;
    for (let x = 4 + off; x < W - 4; x += W * 0.5) line(g, [x, y0 + d + i * rh, x, y0 + d + (i + 1) * rh], alpha(shade(wall, -0.35), 0.5), 1);
  }
  rect(g, W - 9, y0 + d, 7, H - 9 - y0 - d, alpha("#000000", 0.18), null);   // shaded right edge
  rect(g, 2, y0 + d, 4, H - 9 - y0 - d, alpha("#ffffff", 0.1), null);       // lit left edge
  for (let i = 0; i < 2; i++) ell(g, r.f(8, W - 14), r.f(H * 0.5, H - 16), r.f(3, 6), r.f(2, 3.5), alpha("#4a6a2a", 0.45), null);
  // walkway
  poly(g, [2, y0 + d, W - 2, y0 + d, W - 2 - d * 0.4, y0, 2 + d * 0.4, y0], shade(wall, 0.22), INK, 1.2);
  // merlons
  const n = Math.max(2, Math.round(W / 16));
  const cw = (W - 4) / (n * 2 - 1);
  for (let i = 0; i < n; i++) {
    const x = 2 + i * cw * 2;
    rect(g, x, y0 - H * 0.1, cw, H * 0.1 + d * 0.5, vgrad(g, y0 - H * 0.1, y0 + d, wall, 0.18), INK, 1.2);
    rect(g, x + 1, y0 - H * 0.1, cw - 2, 2, shade(wall, 0.35), null);
  }
}

function paintSiege(g, id, f, state, W, H) {
  const pal = factionPalette(f);
  const r = seeded(`siege:${id}:${f}:${state}`);
  const wall = pal.wall;
  const dmg = SIEGE_STATES.indexOf(state);
  if (id === 'moat') {
    rect(g, 0, 4, W, H - 6, lgrad(g, 0, 4, 0, H, [[0, shade(f === 'inferno' ? '#ff6020' : '#3a6a9a', -0.2)], [1, shade(f === 'inferno' ? '#ff6020' : '#3a6a9a', -0.5)]]), INK, 1.4);
    for (let i = 0; i < 3; i++) curve(g, [4 + i * 14, 12, 10 + i * 14, 9, 16 + i * 14, 12], alpha('#ffffff', 0.5), 1.2);
    return;
  }
  if (dmg === 2) {
    for (let i = 0; i < 5; i++) rock(g, r.f(8, W - 8), H - r.f(1, 6), r.f(10, 18), wall, r, 1.2);
    if (id === 'keep' || id === 'tower') rect(g, W * 0.2, H - 30, W * 0.6, 26, vgrad(g, H - 30, H, wall, 0.2), INK, 1.4);
    return;
  }
  if (id === 'wall') wallBlock(g, W, H, wall, r, 0.2);
  else if (id === 'gate') {
    wallBlock(g, W, H, wall, r, 0.16);
    g.beginPath();
    g.moveTo(W * 0.25, H - 2);
    g.lineTo(W * 0.25, H * 0.45);
    g.quadraticCurveTo(W / 2, H * 0.28, W * 0.75, H * 0.45);
    g.lineTo(W * 0.75, H - 2);
    g.closePath();
    g.fillStyle = vgrad(g, H * 0.3, H, '#6a4626', 0.2);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 1.4;
    g.stroke();
    for (let x = W * 0.3; x < W * 0.74; x += W * 0.09) line(g, [x, H * 0.42, x, H - 3], '#4a3018', 1.2);
  } else if (id === 'tower') tower(g, W / 2, H - 2, W * 0.8, H * 0.95, { wall, roof: pal.roof, roofKind: 'battlement', r, lw: 1.4, windows: 2 });
  else tower(g, W / 2, H - 2, W * 0.8, H * 0.96, { wall, roof: pal.roof, roofKind: 'cone', r, lw: 1.6, windows: 3, banner: pal.main });
  if (dmg === 1) {
    for (let i = 0; i < 3; i++) crack(g, r.f(W * 0.2, W * 0.8), r.f(H * 0.2, H * 0.5), H * 0.3, r);
    poly(g, [W * 0.6, H * 0.12, W * 0.85, H * 0.1, W * 0.9, H * 0.3, W * 0.7, H * 0.24], 'rgba(0,0,0,0)', null);
    for (let i = 0; i < 3; i++) rock(g, r.f(4, W - 4), H - 1, r.f(5, 9), wall, r, 1);
  }
}

function paintObstacle(g, id, terrain, W, H) {
  const r = seeded(`obst:${id}:${terrain}`);
  const t = TERRAIN_DATA.find((x) => x.id === terrain);
  const tint = t ? t.colors[0] : '#7a7a7a';
  ell(g, W / 2, H - 6, W * 0.36, 5, 'rgba(0,0,0,0.25)', null);
  const B = H - 6;
  switch (id) {
    case 'tree': tree(g, W / 2, B, 56, 'oak', '#3a8a34', r, 1.4); break;
    case 'pine': tree(g, W / 2, B, 58, 'pine', terrain === 'snow' ? '#3a6a5a' : '#2a6a3a', r, 1.4); break;
    case 'dead_tree': tree(g, W / 2, B, 54, 'dead', '#4a3a2a', r, 1.4); break;
    case 'mangrove': tree(g, W / 2, B, 54, 'mangrove', '#2a5a3a', r, 1.4); break;
    case 'stump': ell(g, W / 2, B - 10, 10, 4, '#c8a070', INK, 1.2); rect(g, W / 2 - 10, B - 10, 20, 10, '#6a4a2a', null); ell(g, W / 2, B, 10, 4, '#6a4a2a', INK, 1.2); break;
    case 'boulder': rock(g, W / 2, B, 40, shade('#8a8278', 0), r, 1.4); break;
    case 'bones': for (const [x, y] of [[W * 0.35, B - 4], [W * 0.62, B - 2]]) { circ(g, x, y - 4, 6, '#e4dcc4', INK, 1.2); ell(g, x - 2, y - 5, 1.4, 1.8, INK, null); ell(g, x + 2, y - 5, 1.4, 1.8, INK, null); } line(g, [W * 0.2, B, W * 0.8, B - 6], '#e4dcc4', 3); break;
    case 'log': { at(g, W / 2, B - 6, -0.1, 1, 1, () => { rect(g, -24, -6, 48, 12, vgrad(g, -6, 6, '#6a4a2a', 0.2), INK, 1.4); ell(g, 24, 0, 3, 6, '#c8a070', INK, 1); }); break; }
    case 'cactus': rect(g, W / 2 - 5, B - 38, 10, 38, '#4a8a3a', INK, 1.4); rect(g, W / 2 - 15, B - 28, 8, 14, '#4a8a3a', INK, 1.2); rect(g, W / 2 + 7, B - 32, 8, 12, '#4a8a3a', INK, 1.2); break;
    case 'dune': blob(g, [6, B, W * 0.35, B - 18, W * 0.65, B - 22, W - 6, B], vgrad(g, B - 22, B, '#c8a850', 0.2), shade('#c8a850', -0.3), 1.4); break;
    case 'shrub': for (const dx of [-10, 10, 0]) circ(g, W / 2 + dx, B - 9 - (dx ? 0 : 6), 10, shade('#3a7a2a', r.f(-0.1, 0.1)), INK, 1.2); break;
    case 'reeds': for (let i = 0; i < 12; i++) { const x = r.f(12, W - 12); line(g, [x, B, x + r.f(-4, 4), B - r.f(18, 34)], '#7a8a3a', 1.6); } break;
    case 'pool': pool(g, W / 2, B - 6, W * 0.38, 9, '#3a6a5a', { lw: 1.2 }); break;
    case 'lava_pool': glow(g, W / 2, B - 6, 30, '#ff6010', 0.5); pool(g, W / 2, B - 6, W * 0.38, 9, '#f0641e', { lw: 1.2, shore: '#2e1c1c' }); break;
    case 'ice_block': poly(g, [W / 2 - 18, B, W / 2 - 15, B - 26, W / 2 + 2, B - 34, W / 2 + 18, B - 22, W / 2 + 16, B], vgrad(g, B - 34, B, '#a8d4e8', 0.3), shade('#a8d4e8', -0.4), 1.4); break;
    case 'stalagmite': for (const [dx, h] of [[-10, 32], [6, 42], [16, 24]]) poly(g, [W / 2 + dx - 7, B, W / 2 + dx, B - h, W / 2 + dx + 7, B], vgrad(g, B - h, B, '#6e5c66', 0.25), INK, 1.2); break;
    case 'mushroom': for (const [dx, s] of [[-10, 1], [10, 0.7]]) { rect(g, W / 2 + dx - 3 * s, B - 22 * s, 6 * s, 22 * s, '#e8e0d0', INK, 1); ell(g, W / 2 + dx, B - 22 * s, 13 * s, 8 * s, '#b06ad8', INK, 1.2); } break;
    case 'crystal': crystals(g, W / 2, B, 40, '#d03a8a', 1.2, 4); break;
    case 'quicksand': ell(g, W / 2, B - 8, W * 0.42, 12, '#b89a58', shade('#b89a58', -0.4), 1.4); for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(W / 2, B - 8, 6 + i * 7, 2 + i * 3, 0, i, i + 4); g.strokeStyle = shade('#b89a58', -0.35); g.lineWidth = 1.4; g.stroke(); } break;
    case 'land_mine': circ(g, W / 2, B - 6, 8, '#4a4a52', INK, 1.4); circ(g, W / 2, B - 10, 2, '#ff5030', null); glow(g, W / 2, B - 10, 6, '#ff5030', 0.6); break;
    case 'force_field': glow(g, W / 2, B - 24, 30, '#80c0ff', 0.5); rect(g, W / 2 - 14, B - 50, 28, 50, alpha('#80c0ff', 0.35), alpha('#cfe8ff', 0.9), 1.6); for (let i = 0; i < 4; i++) line(g, [W / 2 - 12, B - 44 + i * 12, W / 2 + 12, B - 40 + i * 12], alpha('#ffffff', 0.6), 1); break;
    case 'fire_wall': glow(g, W / 2, B - 20, 32, '#ff6010', 0.6); for (const dx of [-14, 0, 14]) blob(g, [W / 2 + dx - 8, B, W / 2 + dx - 6, B - 20, W / 2 + dx, B - 38, W / 2 + dx + 6, B - 20, W / 2 + dx + 8, B], '#ff8a20', '#a02a10', 1.2); break;
    default: rock(g, W / 2, B, 34, tint, r, 1.4);
  }
}

/**
 * opts: size = px height; variant = terrain id (terrain obstacles) or faction id (siege pieces);
 * state = intact|damaged|destroyed (siege pieces).
 */
export function obstacleHandler(id, o) {
  if (SIEGE.includes(id)) {
    const [W, H] = SIEGE_SIZE[id];
    const f = FACTIONS.includes(o.variant) ? o.variant : 'castle';
    const state = SIEGE_STATES.includes(o.state) ? o.state : 'intact';
    return { dw: W, dh: H, unit: H, size: H, key: `${f}|${state}`, paint: (g) => paintSiege(g, id, f, state, W, H) };
  }
  const terrain = typeof o.variant === 'string' ? o.variant : '';
  return { dw: 64, dh: 64, unit: 64, size: 48, key: terrain, paint: (g) => paintObstacle(g, id, terrain, 64, 64) };
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

export const EFFECT_FRAMES = 6;
const PROJECTILES = ['arrow', 'bolt', 'fireball', 'rock', 'cannonball', 'magic_missile', 'ice_shard', 'lightning_ray'];
const EFFECTS = ['fire', 'lightning', 'ice', 'earth', 'magic', 'buff', 'debuff', 'heal', 'summon', 'control', 'dispel', 'resurrect', 'death', 'teleport', 'explosion', 'hit', 'block', 'poison', 'morale_good', 'morale_bad', 'luck_good', 'luck_bad', 'level_up'];
export const EFFECT_IDS = [...EFFECTS, ...PROJECTILES];

/** Map a spell id to the effect id that visualises it. */
export function effectForSpell(spellId) {
  const sp = SPELL_BY_ID[spellId];
  if (!sp) return 'magic';
  const id = sp.id;
  if (sp.category === 'damage' || (sp.effect && sp.effect.type === 'damage')) {
    if (/death|destroy_undead|stare|cloud/.test(id)) return 'death';
    if (/meteor|implosion|spikes|earthquake/.test(id)) return 'earth';
    return { fire: 'fire', air: 'lightning', water: 'ice', earth: 'earth' }[sp.school] || 'explosion';
  }
  if (sp.category === 'heal') return /resurrect|animate|rebirth|raise/.test(id) ? 'resurrect' : 'heal';
  if (sp.effect && sp.effect.type === 'resurrect') return 'resurrect';
  if (sp.category === 'buff') return 'buff';
  if (sp.category === 'debuff') return /poison|disease|age/.test(id) ? 'poison' : 'debuff';
  if (sp.category === 'summon') return 'summon';
  if (sp.category === 'control') return 'control';
  if (/dispel/.test(id)) return 'dispel';
  if (/teleport|portal|door/.test(id)) return 'teleport';
  return 'magic';
}

function paintEffect(g, id, f) {
  const t = f / (EFFECT_FRAMES - 1);
  const r = seeded(`fx:${id}`);
  const C = 48;
  const burst = (color, n, rad, size) => {
    for (let i = 0; i < n; i++) {
      const a = r.f(0, Math.PI * 2);
      const d = r.f(0.3, 1) * rad * (0.3 + t);
      star(g, C + Math.cos(a) * d, C + Math.sin(a) * d, size * (1 - t * 0.6), size * 0.35, 4, alpha(color, 1 - t * 0.8), null);
    }
  };
  const ring = (color, rad) => {
    circ(g, C, C, Math.max(1, rad * (0.2 + t * 0.9)), null, alpha(color, 1 - t), 4 * (1 - t) + 1);
  };
  switch (id) {
    case 'fire': case 'explosion':
      glow(g, C, C, 44 * (0.4 + t * 0.6), '#ff7020', 0.9 - t * 0.6);
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + r.f(-0.3, 0.3); const d = 30 * t; blob(g, [C + Math.cos(a) * d - 6, C + Math.sin(a) * d + 6, C + Math.cos(a) * d, C + Math.sin(a) * d - 14 * (1 - t * 0.5), C + Math.cos(a) * d + 6, C + Math.sin(a) * d + 6], alpha(i % 2 ? '#ffe070' : '#ff8a20', 1 - t * 0.7), null); }
      if (t < 0.5) circ(g, C, C, 14 * (1 - t), '#fff8d0', null);
      break;
    case 'lightning':
      glow(g, C, C + 20, 40, '#9ad0ff', 0.8 - t * 0.6);
      if (f < 4) { const pts = [C + r.f(-6, 6), 0]; for (let y = 12; y <= 76; y += 12) pts.push(C + r.f(-12, 12), y); line(g, pts, alpha('#9ad0ff', 0.6), 7); line(g, pts, '#ffffff', 2.6); }
      burst('#cfe8ff', 6, 34, 6);
      break;
    case 'ice':
      for (let i = 0; i < 6; i++) at(g, C, C, (i / 6) * Math.PI * 2, 1, 1, () => poly(g, [-4, 0, 0, -10 - 28 * Math.min(1, t * 1.6), 4, 0], alpha('#cfeaff', 1 - t * 0.5), alpha('#5a9ad8', 1 - t * 0.5), 1.2));
      burst('#ffffff', 8, 40, 4);
      break;
    case 'earth':
      for (let i = 0; i < 6; i++) { const x = r.f(12, 84); const y = 20 + t * 60 + r.f(-10, 10); poly(g, [x - 7, y, x - 3, y - 8, x + 6, y - 6, x + 7, y + 4, x, y + 7], '#8a7a6a', INK, 1.2); glow(g, x, y - 6, 8, '#ff7020', 0.5); }
      break;
    case 'heal': case 'resurrect': case 'level_up':
      glow(g, C, C, 40, id === 'heal' ? '#7ae07a' : '#fff0a0', 0.6 * (1 - t));
      for (let i = 0; i < 8; i++) { const x = r.f(16, 80); const y = 86 - t * 70 - r.f(0, 20); if (id === 'heal') { rect(g, x - 1.5, y - 5, 3, 10, alpha('#7ae07a', 1 - t), null); rect(g, x - 5, y - 1.5, 10, 3, alpha('#7ae07a', 1 - t), null); } else star(g, x, y, 5, 2, 4, alpha('#fff4b0', 1 - t), null); }
      break;
    case 'buff': case 'morale_good': case 'luck_good':
      ring('#ffe070', 44);
      for (let i = 0; i < 5; i++) { const x = 20 + i * 14; const y = 80 - t * 60; poly(g, [x, y - 8, x + 6, y, x + 2, y, x + 2, y + 8, x - 2, y + 8, x - 2, y, x - 6, y], alpha(id === 'luck_good' ? '#7ae07a' : '#ffe070', 1 - t), null); }
      break;
    case 'debuff': case 'morale_bad': case 'luck_bad': case 'poison':
      glow(g, C, C, 40, id === 'poison' ? '#80d040' : '#a040c0', 0.6 * (1 - t));
      for (let i = 0; i < 5; i++) { const x = 20 + i * 14; const y = 16 + t * 60; poly(g, [x, y + 8, x + 6, y, x + 2, y, x + 2, y - 8, x - 2, y - 8, x - 2, y, x - 6, y], alpha(id === 'poison' ? '#80d040' : '#c060e0', 1 - t), null); }
      break;
    case 'summon': case 'teleport':
      for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(C, C + 20, 10 + i * 10 + t * 8, (10 + i * 10) * 0.35, 0, t * 6 + i, t * 6 + i + 4); g.strokeStyle = alpha(id === 'summon' ? '#c080ff' : '#80c0ff', 1 - t * 0.8); g.lineWidth = 3; g.stroke(); }
      glow(g, C, C, 36, id === 'summon' ? '#c080ff' : '#80c0ff', 0.6 * (1 - t));
      break;
    case 'control': for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(C, C, 8 + i * 9, t * 5 + i, t * 5 + i + 4); g.strokeStyle = alpha('#e080ff', 1 - t * 0.7); g.lineWidth = 3; g.stroke(); } break;
    case 'dispel': ring('#ffffff', 46); burst('#cfe0ff', 10, 40, 5); break;
    case 'death': glow(g, C, C, 40, '#60ff90', 0.6 * (1 - t)); at(g, C, C - t * 20, 0, 1, 1, () => { circ(g, 0, 0, 14, alpha('#ece6d0', 1 - t), INK, 1.4); ell(g, -5, -1, 3.4, 4, INK, null); ell(g, 5, -1, 3.4, 4, INK, null); }); break;
    case 'hit': star(g, C, C, 26 * (0.5 + t * 0.5), 9, 8, alpha('#fff0b0', 1 - t), alpha('#e05a3a', 1 - t), 2); break;
    case 'block': at(g, C, C, 0, 0.8 + t * 0.2, 0.8 + t * 0.2, () => { g.globalAlpha = 1 - t * 0.8; poly(g, [-20, -22, 20, -22, 22, 4, 0, 26, -22, 4], alpha('#80c0ff', 0.5), '#cfe8ff', 3); g.globalAlpha = 1; }); break;
    default: ring('#c080ff', 44); burst('#ffffff', 10, 40, 5); glow(g, C, C, 30, '#c080ff', 0.5 * (1 - t));
  }
}

function paintProjectile(g, id) {
  const C = 48;
  switch (id) {
    case 'arrow': line(g, [14, C, 78, C], '#3a2a1a', 3.4); line(g, [14, C, 78, C], '#d8c090', 1.8); poly(g, [76, C - 5, 88, C, 76, C + 5], '#d4d8e0', INK, 1.2); poly(g, [12, C - 6, 22, C, 12, C + 6], '#f0ece0', INK, 1); break;
    case 'bolt': line(g, [20, C, 76, C], '#3a2a1a', 4.4); line(g, [20, C, 76, C], '#a07a4a', 2.6); poly(g, [74, C - 6, 90, C, 74, C + 6], '#d4d8e0', INK, 1.2); break;
    case 'fireball': glow(g, C + 10, C, 30, '#ff7020', 0.8); blob(g, [C + 22, C, C + 6, C - 14, C - 24, C - 4, C - 30, C, C - 24, C + 4, C + 6, C + 14], alpha('#ff8a20', 0.9), null); circ(g, C + 10, C, 12, '#ffe070', '#ff8020', 1.6); break;
    case 'rock': poly(g, [C - 14, C - 4, C - 6, C - 14, C + 10, C - 12, C + 14, C + 2, C + 4, C + 14, C - 12, C + 10], '#8a8278', INK, 2); break;
    case 'cannonball': circ(g, C, C, 11, rgrad(g, C - 4, C - 4, 1, 14, [[0, '#8a8a92'], [1, '#2a2a30']]), INK, 1.6); for (let i = 0; i < 3; i++) circ(g, C - 18 - i * 9, C, 6 - i * 1.5, alpha('#c8c8c8', 0.5 - i * 0.12), null); break;
    case 'ice_shard': poly(g, [16, C, 70, C - 8, 88, C, 70, C + 8], vgrad(g, C - 8, C + 8, '#cfeaff', 0.3), '#5a9ad8', 1.4); break;
    case 'lightning_ray': line(g, [6, C, 26, C - 8, 40, C + 6, 58, C - 6, 72, C + 4, 90, C], alpha('#9ad0ff', 0.6), 8); line(g, [6, C, 26, C - 8, 40, C + 6, 58, C - 6, 72, C + 4, 90, C], '#ffffff', 2.6); break;
    default: glow(g, C, C, 24, '#c080ff', 0.8); star(g, C, C, 12, 5, 6, '#ffffff', '#c080ff', 1.2);
  }
}

/**
 * opts: size = px (square, default 96), frame 0..EFFECT_FRAMES-1 (effects), facing -1 mirrors
 * projectiles (which fly to the right by default).
 */
export function effectHandler(id, o) {
  if (PROJECTILES.includes(id)) {
    return { dw: 96, dh: 96, unit: 96, size: 48, frames: 1, key: '', mirror: o.facing === -1, paint: (g) => paintProjectile(g, id) };
  }
  const eid = EFFECTS.includes(id) ? id : SPELL_BY_ID[id] ? effectForSpell(id) : 'magic';
  const f = (((o.frame | 0) % EFFECT_FRAMES) + EFFECT_FRAMES) % EFFECT_FRAMES;
  return { dw: 96, dh: 96, unit: 96, size: 96, frames: EFFECT_FRAMES, key: `${eid}|${f}`, paint: (g) => paintEffect(g, eid, f) };
}
