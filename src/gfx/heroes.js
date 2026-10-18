// `hero` kind (adventure-map figure on horseback / in a boat, with a player-coloured flag) and
// `portrait` kind (procedural face portraits, one per hero definition).

import { HEROES, HERO_BY_ID } from '../data/heroes.js';
import { HERO_CLASSES, HERO_CLASS_BY_ID } from '../data/heroClasses.js';
import { FACTIONS } from '../core/constants.js';
import {
  INK, alpha, at, blob, circ, curve, ell, flag, glow, hashStr, lgrad, line, mix, paint, poly, rect, rgrad, rrect, seeded, shade, shadow, star, tweak, vgrad,
} from './kit.js';
import { factionPalette, playerColorHex } from './palette.js';
import { quadruped } from './rigBeasts.js';
import { humanoid } from './rigHumanoid.js';
import { poseFor, STATE_FRAMES } from './creatures.js';

export const HERO_IDS = HEROES.map((h) => h.id);
export const HERO_FIGURE_IDS = HERO_IDS;

/** Resolve a hero id / class id / faction id to { id, faction, kind, gender, classId }. */
export function resolveHero(id) {
  const h = HERO_BY_ID[id];
  if (h) {
    const cls = HERO_CLASS_BY_ID[h.classId];
    return { id, faction: h.faction || (cls && cls.faction) || 'neutral', kind: cls ? cls.kind : 'might', gender: h.gender || 'male', classId: h.classId };
  }
  const cls = HERO_CLASS_BY_ID[id];
  if (cls) return { id, faction: cls.faction, kind: cls.kind, gender: 'male', classId: cls.id };
  if (FACTIONS.includes(id)) return { id, faction: id, kind: 'might', gender: 'male', classId: null };
  return { id, faction: 'neutral', kind: hashStr(id) % 2 ? 'might' : 'magic', gender: hashStr(id) % 3 ? 'male' : 'female', classId: null };
}

const HAIR = ['#2a2018', '#4a3020', '#8a5a2a', '#c8a040', '#b0502a', '#6a6a6a', '#e8e8e8', '#1a1a22'];
const SKIN = ['#f0c8a0', '#e0b088', '#c89868', '#a87850', '#7a5236'];

// ---------------------------------------------------------------------------------------------
// Map figure
// ---------------------------------------------------------------------------------------------

function riderSpec(info) {
  const pal = factionPalette(info.faction);
  const r = seeded(`rider:${info.id}`);
  const magic = info.kind === 'magic';
  const spec = {
    s: 0.74, cloth: pal.cloth, metal: pal.metal, trim: pal.trim, skin: r.pick(SKIN.slice(0, 4)), hairC: r.pick(HAIR),
    armor: magic ? 'robe' : 'plate', weapon: magic ? 'staff' : 'sword', glowC: pal.trim,
    hair: info.gender === 'female' ? 'long' : 'short', cape: r.chance(0.6) ? shade(pal.cloth, -0.25) : null,
  };
  const f = info.faction;
  if (f === 'castle') Object.assign(spec, magic ? { hat: 'hood' } : { hat: 'crest' });
  else if (f === 'rampart') Object.assign(spec, { ears: 'point', hat: magic ? 'leaves' : null, armor: magic ? 'robe' : 'leather', weapon: magic ? 'staff' : 'spear' });
  else if (f === 'tower') Object.assign(spec, { hat: magic ? 'wizard' : 'turban' });
  else if (f === 'inferno') Object.assign(spec, { skin: '#c8483a', horns: 0.5, hair: 'bald', armor: magic ? 'robe' : 'bare', weapon: magic ? 'staff' : 'axe' });
  else if (f === 'necropolis') Object.assign(spec, magic ? { head: 'skull', skin: '#e4dcc4', hat: 'hood', eyes: '#60ff90', weapon: 'skullstaff' } : { head: 'visor', eyes: '#ff4040', metal: '#4a4a56' });
  else if (f === 'dungeon') Object.assign(spec, magic ? { hat: 'hood' } : { hat: 'hornhelm', metal: '#5a5068' });
  else if (f === 'stronghold') Object.assign(spec, { skin: '#7a9a4a', tusks: true, hair: 'mohawk', armor: magic ? 'fur' : 'bare', weapon: magic ? 'skullstaff' : 'axe', hat: magic ? 'headdress' : null });
  else if (f === 'fortress') Object.assign(spec, magic ? { hat: 'witch', hatC: '#3a4a3a' } : { head: 'lizard', skin: '#5a9a4a', hair: 'bald', armor: 'leather', weapon: 'spear' });
  else if (f === 'conflux') Object.assign(spec, { skin: r.pick(['#f0a060', '#8ac8f0', '#d8c8f0', '#b8a070']), eyes: '#ffffff', aura: true, glowC: pal.trim, hair: 'bald' });
  else if (f === 'cove') Object.assign(spec, { hat: magic ? 'bandana' : 'tricorn', armor: 'coat', weapon: magic ? 'staff' : 'cutlass' });
  else if (f === 'factory') Object.assign(spec, { hat: magic ? 'goggles' : 'cowboy', hatC: '#5a3a22', armor: 'coat', weapon: magic ? 'wrench' : 'gun' });
  return spec;
}

function paintHeroFigure(g, info, o) {
  const pal = factionPalette(info.faction);
  const pc = playerColorHex(o.playerColor);
  const p = poseFor(o.state, o.frame);
  const r = seeded(`horse:${info.id}`);
  const HORSES = { necropolis: ['#2a2630', '#4a4650'], inferno: ['#3a1a1a', '#5a2a22'], tower: ['#f0ece4', '#d0d0d8'], conflux: ['#e8e0f0', '#c8d8f0'] };
  const horse = r.pick(HORSES[info.faction] || ['#8a5a3a', '#6a4a2a', '#b89a6a', '#f0ece0', '#4a3a2e', '#9a7a5a']);
  if (o.variant === 'boat') {
    const bobY = [0, 1, 0, -1][p.frame % 4];
    // water ripple
    ell(g, 50, 86, 44, 7, alpha('#bfe0f4', 0.55), null);
    at(g, 50, 70 + bobY, [0, 0.02, 0, -0.02][p.frame % 4], 1, 1, () => {
      line(g, [0, -4, 0, -62], INK, 3.4);
      line(g, [0, -4, 0, -62], '#8a6a3e', 1.8);
      // sail in player colour
      g.beginPath();
      g.moveTo(2, -58);
      g.quadraticCurveTo(34 + (p.frame % 2) * 2, -40, 4, -14);
      g.closePath();
      paint(g, vgrad(g, -58, -14, pc, 0.25), INK, 1.6);
      g.beginPath();
      g.moveTo(-2, -50);
      g.quadraticCurveTo(-22, -34, -3, -16);
      g.closePath();
      paint(g, '#f0ece0', INK, 1.4);
      poly(g, [0, -62, 12, -66, 0, -70], pc, INK, 1);
      // hull
      g.beginPath();
      g.moveTo(-40, -6);
      g.quadraticCurveTo(-30, 14, 0, 14);
      g.quadraticCurveTo(32, 14, 44, -10);
      g.lineTo(30, -4);
      g.lineTo(-30, -4);
      g.closePath();
      paint(g, vgrad(g, -8, 14, '#8a5a2a', 0.25), INK, 1.8);
      line(g, [-32, 2, 34, 2], shade('#8a5a2a', -0.35), 1.2);
      line(g, [-30, -4, 30, -4], pal.trim, 1.6);
      // tiny hero at the stern
      circ(g, -18, -14, 5, '#e0b088', INK, 1.2);
      rrect(g, -23, -10, 10, 8, 2, pal.cloth, INK, 1.2);
    });
    for (const x of [14, 40, 72]) curve(g, [x, 88, x + 6, 85, x + 12, 88], alpha('#ffffff', 0.8), 1.4);
    return;
  }
  const spec = riderSpec(info);
  // flag behind the rider
  const bob = p.bob * 0.5;
  flag(g, 30, 52 + bob, 40, pc, -1, p.frame);
  quadruped(g, 47, 92, {
    s: 0.66, head: 'horse', color: horse, mane: shade(horse, -0.45), bridle: pal.trim, armor: info.kind === 'might' ? shade(pal.cloth, -0.05) : null,
    trim: pal.trim, eyes: info.faction === 'necropolis' ? '#ff4040' : null, rider: spec, saddleC: shade(pc, -0.3),
  }, p);
}

/**
 * opts: size (px, square), state idle|move, frame, facing, playerColor, variant 'boat'.
 * Anchor: feet at (size/2, 0.92*size).
 */
export function heroHandler(id, o) {
  const info = resolveHero(id);
  const state = o.state === 'move' ? 'move' : 'idle';
  const n = STATE_FRAMES[state];
  const frame = ((((o.frame | 0) % n) + n) % n);
  const boat = o.variant === 'boat';
  return {
    dw: 100, dh: 100, unit: 100, size: 64, frames: n, ax: 50, ay: 92,
    key: `${state}|${frame}|${playerColorHex(o.playerColor)}|${boat ? 'boat' : ''}`,
    mirror: o.facing === -1,
    paint: (g) => paintHeroFigure(g, info, { ...o, state, frame }),
  };
}

// ---------------------------------------------------------------------------------------------
// Portraits (100x100 design grid)
// ---------------------------------------------------------------------------------------------

/** Decide what kind of being the portrait shows. */
function portraitSpecies(info, r) {
  const m = info.kind === 'might';
  switch (info.faction) {
    case 'necropolis': return m ? r.pick(['skull', 'pale', 'pale']) : r.pick(['pale', 'skull', 'pale', 'lich']);
    case 'inferno': return m ? r.pick(['demon', 'demon', 'human']) : r.pick(['human', 'demon', 'human']);
    case 'stronghold': return r.pick(['orc', 'orc', 'ogre', 'human', 'goblin']);
    case 'fortress': return m ? r.pick(['human', 'lizard', 'gnoll', 'human']) : r.pick(['human', 'human', 'lizard']);
    case 'dungeon': return m ? r.pick(['human', 'minotaur', 'trog', 'human']) : r.pick(['human', 'pale', 'human']);
    case 'conflux': return r.pick(['fire', 'water', 'air', 'earth']);
    case 'rampart': return m ? r.pick(['elf', 'dwarf', 'elf']) : r.pick(['elf', 'elf', 'human']);
    case 'tower': return m ? r.pick(['human', 'human', 'genie']) : r.pick(['human', 'human', 'genie']);
    case 'cove': return r.pick(['human', 'human', 'human', 'nix']);
    case 'factory': return r.pick(['human', 'human', 'halfling']);
    default: return 'human';
  }
}

const SPECIES_SKIN = {
  skull: ['#e4dcc4', '#d8d0b0'], lich: ['#c8d0b8', '#b8c0a8'], pale: ['#d8d4d8', '#c8c8d0', '#d0d8c8'],
  demon: ['#c8483a', '#a83a3a', '#d8603a'], orc: ['#7a9a4a', '#6a8a3a', '#8aa860'], ogre: ['#b8a85a', '#a89848'],
  goblin: ['#8ab04a', '#70a040'], lizard: ['#5a9a4a', '#4a8a5a', '#6aa040'], gnoll: ['#b89a5a', '#a08a4a'],
  minotaur: ['#8a5a3a', '#6a4a3a'], trog: ['#8a6a8a', '#7a5a7a'], fire: ['#f09040', '#e87030'], water: ['#6ab0e8', '#5aa0d8'],
  air: ['#d0e0f0', '#c0d0e8'], earth: ['#a08a60', '#8a7a50'], genie: ['#5a9ae0', '#4a8ad0'], nix: ['#3a8aa0', '#4a9ab0'],
};

function paintPortrait(g, info) {
  const pal = factionPalette(info.faction);
  const r = seeded(`portrait:${info.id}`);
  const species = portraitSpecies(info, r);
  const female = info.gender === 'female';
  const might = info.kind === 'might';
  const humanish = ['human', 'elf', 'dwarf', 'halfling', 'pale'].includes(species);
  const skin = SPECIES_SKIN[species] ? r.pick(SPECIES_SKIN[species]) : r.pick(SKIN);
  const hairC = species === 'pale' ? r.pick(['#1a1a22', '#e8e8e8', '#3a2a3a']) : species === 'dwarf' ? r.pick(['#c8703a', '#8a5a2a', '#e8e0d0']) : r.pick(HAIR);
  const eyeC = { fire: '#fff0a0', water: '#e0f8ff', air: '#ffffff', earth: '#60ff60', skull: '#60ff90', lich: '#60ff90', demon: '#ffe040', pale: '#d03030' }[species]
    || r.pick(['#3a6a9a', '#4a3020', '#3a7a3a', '#6a5a3a', '#5a5a6a']);
  const cx = 50 + r.f(-2, 2);
  const cy = 47 + r.f(-1.5, 1.5);
  const fw = (species === 'dwarf' || species === 'ogre' || species === 'orc' ? 25 : female ? 20.5 : 22.5) + r.f(-1.5, 1.5);
  const fh = (female ? 25 : 26.5) + r.f(-1.5, 1.5);
  const jaw = r.f(0.55, 0.9) * (female ? 0.85 : 1);

  // --- background
  const bgHue = r.f(-18, 18);
  const bg0 = tweak(pal.main, bgHue, 0.8, -0.18);
  const bg1 = tweak(pal.main, bgHue, 0.9, 0.12);
  rect(g, 0, 0, 100, 100, lgrad(g, 0, 0, 0, 100, [[0, bg1], [1, bg0]]), null);
  const bgStyle = r.i(0, 3);
  if (bgStyle === 0) {
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.36;
      poly(g, [50, 44, 50 + Math.cos(a - 0.07) * 90, 44 + Math.sin(a - 0.07) * 90, 50 + Math.cos(a + 0.07) * 90, 44 + Math.sin(a + 0.07) * 90], alpha('#ffffff', 0.07), null);
    }
  } else if (bgStyle === 1) {
    g.fillStyle = rgrad(g, 50, 40, 5, 60, [[0, alpha(pal.trim, 0.45)], [1, alpha(pal.trim, 0)]]);
    g.fillRect(0, 0, 100, 100);
  } else if (bgStyle === 2) {
    for (let i = 0; i < 5; i++) rect(g, 0, 8 + i * 20 + r.f(-3, 3), 100, 6, alpha('#000000', 0.08), null);
  } else {
    for (let i = 0; i < 12; i++) circ(g, r.f(4, 96), r.f(4, 60), r.f(0.6, 1.6), alpha('#ffffff', 0.45), null);
  }
  g.fillStyle = rgrad(g, 50, 50, 30, 75, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.45)']]);
  g.fillRect(0, 0, 100, 100);

  // --- hair behind the head
  const hairStyle = species === 'skull' || species === 'lich' || species === 'lizard' || species === 'trog' || species === 'nix' ? 'bald'
    : female ? r.pick(['long', 'long', 'wavy', 'bun', 'braids', 'short']) : r.pick(['short', 'short', 'bald', 'medium', 'long', 'mohawk', 'tail']);
  if (['long', 'wavy', 'braids', 'medium'].includes(hairStyle)) {
    const len = hairStyle === 'medium' ? 22 : 40;
    const w = fw + (hairStyle === 'wavy' ? 9 : 6);
    blob(g, [cx - w, cy - 6, cx - w * 0.6, cy - fh - 6, cx + w * 0.6, cy - fh - 6, cx + w, cy - 6, cx + w + (hairStyle === 'wavy' ? 4 : 0), cy + len, cx + w * 0.4, cy + len + 4, cx - w * 0.4, cy + len + 4, cx - w - (hairStyle === 'wavy' ? 4 : 0), cy + len],
      vgrad(g, cy - fh, cy + len, hairC, 0.2), INK, 1.8);
  }
  if (species === 'elf' || species === 'goblin' || species === 'genie' || species === 'demon' || species === 'halfling') {
    const k = species === 'goblin' ? 1.5 : species === 'halfling' ? 0.6 : 1;
    for (const d of [-1, 1]) poly(g, [cx + d * (fw - 2), cy - 4, cx + d * (fw + 9 * k), cy - 12 * k - 2, cx + d * (fw - 1), cy + 6], shade(skin, -0.05), INK, 1.6);
  } else if (humanish || ['orc', 'ogre', 'fire', 'water', 'air', 'earth'].includes(species)) {
    for (const d of [-1, 1]) ell(g, cx + d * fw, cy + 1, 3.6, 5.5, shade(skin, -0.06), INK, 1.5);
  } else if (species === 'gnoll' || species === 'minotaur') {
    for (const d of [-1, 1]) poly(g, [cx + d * (fw - 8), cy - fh + 6, cx + d * (fw + 6), cy - fh - 8, cx + d * (fw + 1), cy - fh + 16], shade(skin, -0.12), INK, 1.6);
  }

  // --- shoulders / clothes
  const clothHue = r.f(-25, 25);
  const cloth = tweak(pal.cloth, clothHue, 1, r.f(-0.08, 0.08));
  const metal = tweak(pal.metal, 0, 1, r.f(-0.08, 0.08));
  const shY = cy + fh + 6;
  blob(g, [8, 104, 12, shY + 6, 34, shY - 3, 50, shY, 66, shY - 3, 88, shY + 6, 92, 104], vgrad(g, shY - 4, 100, might ? metal : cloth, 0.22), INK, 2);
  rect(g, cx - 8.5, cy + fh - 8, 17, 16, shade(skin, -0.14), INK, 1.6);
  const outfit = r.i(0, 2);
  if (might) {
    for (const d of [-1, 1]) {
      ell(g, 50 + d * 31, shY + 7, 15, 10, vgrad(g, shY - 3, shY + 17, outfit === 2 ? pal.trim : metal, 0.3), INK, 1.8);
      if (outfit === 1) poly(g, [50 + d * 26, shY - 1, 50 + d * 34, shY - 11, 50 + d * 40, shY + 1], metal, INK, 1.4);
      curve(g, [50 + d * 20, shY + 8, 50 + d * 31, shY + 3, 50 + d * 43, shY + 9], shade(metal, -0.35), 1.1);
    }
    poly(g, [36, shY - 2, 50, shY + 12, 64, shY - 2, 60, shY - 5, 50, shY + 4, 40, shY - 5], cloth, INK, 1.5);
    if (r.chance(0.5)) circ(g, 50, shY + 16, 3.4, pal.trim, INK, 1.1);
  } else {
    poly(g, [34, shY - 2, 50, shY + 16, 66, shY - 2, 61, shY - 6, 50, shY + 6, 39, shY - 6], shade(cloth, 0.2), INK, 1.5);
    line(g, [50, shY + 16, 50, 100], pal.trim, 2);
    if (outfit === 0) for (const d of [-1, 1]) curve(g, [50 + d * 16, shY + 2, 50 + d * 26, shY + 14, 50 + d * 30, 100], shade(cloth, -0.3), 1.3);
    else if (outfit === 1) {
      curve(g, [36, shY + 2, 50, shY + 22, 64, shY + 2], pal.trim, 1.5);
      poly(g, [50, shY + 19, 53.5, shY + 24, 50, shY + 29, 46.5, shY + 24], r.pick(['#d03a4a', '#3ad0a0', '#5a8ae8', '#e8c040']), INK, 1.1);
    } else for (const d of [-1, 1]) ell(g, 50 + d * 30, shY + 5, 13, 7, shade(cloth, -0.15), INK, 1.5);
  }

  // --- horns behind face
  if (species === 'demon' || species === 'minotaur') {
    const k = species === 'minotaur' ? 1.5 : r.f(0.7, 1.3);
    for (const d of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + d * (fw - 10), cy - fh + 6);
      g.quadraticCurveTo(cx + d * (fw + 6 * k), cy - fh - 2, cx + d * (fw + 4 * k), cy - fh - 16 * k);
      g.quadraticCurveTo(cx + d * (fw - 2), cy - fh - 4, cx + d * (fw - 16), cy - fh + 2);
      g.closePath();
      paint(g, species === 'minotaur' ? '#e8e0c8' : shade(skin, -0.45), INK, 1.6);
    }
  }

  // --- face shape
  const face = [cx - fw, cy - 6, cx - fw * 0.8, cy - fh, cx, cy - fh - 3, cx + fw * 0.8, cy - fh, cx + fw, cy - 6, cx + fw * jaw, cy + fh * 0.72, cx, cy + fh + (species === 'gnoll' || species === 'lizard' ? 3 : 0), cx - fw * jaw, cy + fh * 0.72];
  blob(g, face, lgrad(g, cx - fw, 0, cx + fw, 0, [[0, shade(skin, 0.14)], [0.6, skin], [1, shade(skin, -0.2)]]), INK, 2);
  if (['fire', 'water', 'air', 'earth'].includes(species)) glow(g, cx, cy, fw * 1.2, eyeC, 0.25);
  if (species === 'earth') for (const [x0, y0, x1, y1] of [[-12, -18, -6, -8], [10, 8, 15, 16], [8, -20, 13, -14]]) line(g, [cx + x0, cy + y0, cx + x1, cy + y1], shade(skin, -0.45), 1.3);

  // --- eyes
  const ey = cy - 3 + r.f(-1.5, 1.5);
  const ex = fw * (0.4 + r.f(-0.03, 0.05));
  const eSize = r.f(0.85, 1.15) * (female ? 1.12 : 1);
  const browTilt = r.f(-2.2, 2.4) + (might ? 0.8 : -0.4);
  const skullish = species === 'skull' || species === 'lich';
  for (const d of [-1, 1]) {
    const x = cx + d * ex;
    if (skullish) {
      ell(g, x, ey, 5.2, 6, '#141018', INK, 1.2);
      circ(g, x, ey, 2, eyeC, null);
      glow(g, x, ey, 6, eyeC, 0.7);
      continue;
    }
    if (species === 'trog') continue;
    ell(g, x, ey, 4.6 * eSize, 3.1 * eSize, ['fire', 'water', 'air', 'earth'].includes(species) ? eyeC : '#fffdf4', INK, 1.2);
    if (!['fire', 'water', 'air', 'earth'].includes(species)) {
      circ(g, x + 0.6, ey, 2.2 * eSize, eyeC, null);
      if (species === 'lizard' || species === 'demon') ell(g, x + 0.6, ey, 0.7, 2.2 * eSize, INK, null);
      else circ(g, x + 0.6, ey, 1.05 * eSize, INK, null);
      circ(g, x - 0.4, ey - 1, 0.7, '#ffffff', null);
    } else glow(g, x, ey, 7, eyeC, 0.7);
    line(g, [x - 5.4, ey - 5.6 - d * browTilt * -0.5, x + 5.4, ey - 5.6 + d * browTilt * -0.5 * -1], species === 'pale' || humanish ? shade(hairC, -0.2) : shade(skin, -0.5), female ? 1.5 : 2.3);
    if (female) line(g, [x - 4.6 * eSize, ey - 0.6, x + 4.6 * eSize, ey - 2.4 * (d > 0 ? 1 : 0.4)], INK, 1.3);
  }
  if (r.chance(0.12) && humanish) {
    const d = r.pick([-1, 1]);
    line(g, [cx + d * ex - 2, ey - 9, cx + d * ex + 1.5, ey + 9], shade(skin, -0.4), 1.4);
  }

  // --- nose & mouth
  const ny = cy + 7 + r.f(-1, 1.5);
  const noseKind = r.i(0, 2);
  const my = cy + fh * 0.56 + r.f(-1, 1);
  const mw = fw * r.f(0.3, 0.42);
  const smile = r.f(-1.6, 2.4);
  if (species === 'gnoll' || species === 'lizard' || species === 'minotaur' || species === 'trog') {
    // muzzle
    ell(g, cx, cy + fh * 0.48, fw * 0.62, fh * 0.42, shade(skin, 0.14), INK, 1.7);
    if (species === 'minotaur') {
      for (const d of [-1, 1]) ell(g, cx + d * 4.5, cy + fh * 0.38, 2, 2.6, INK, null);
      circ(g, cx, cy + fh * 0.62, 4.2, null, pal.trim, 1.6);
    } else {
      for (const d of [-1, 1]) circ(g, cx + d * 3, cy + fh * 0.3, 1.3, INK, null);
      if (species === 'gnoll') ell(g, cx, cy + fh * 0.26, 4.6, 3.2, '#2a1a14', INK, 1);
    }
    curve(g, [cx - fw * 0.42, cy + fh * 0.58, cx, cy + fh * 0.7, cx + fw * 0.42, cy + fh * 0.58], INK, 1.5);
    if (species !== 'minotaur') for (const d of [-1, 1]) poly(g, [cx + d * fw * 0.22 - 1.5, cy + fh * 0.63, cx + d * fw * 0.22, cy + fh * 0.76, cx + d * fw * 0.22 + 1.5, cy + fh * 0.63], '#fffdf0', INK, 0.7);
  } else if (skullish) {
    poly(g, [cx - 2.4, ny + 3, cx, ny - 3, cx + 2.4, ny + 3], '#141018', null);
    rrect(g, cx - mw, my - 3.5, mw * 2, 7, 1.5, shade(skin, -0.06), INK, 1.3);
    for (let i = -2; i <= 2; i++) line(g, [cx + i * mw * 0.36, my - 3.5, cx + i * mw * 0.36, my + 3.5], INK, 0.9);
    line(g, [cx - mw, my, cx + mw, my], INK, 0.9);
  } else {
    if (noseKind === 0) curve(g, [cx - 1, ey + 4, cx + 2.6, ny + 1, cx - 1.6, ny + 3], shade(skin, -0.42), 1.5);
    else if (noseKind === 1) {
      line(g, [cx, ey + 4, cx, ny], shade(skin, -0.3), 1.2);
      curve(g, [cx - 3.4, ny + 1.5, cx, ny + 3.6, cx + 3.4, ny + 1.5], shade(skin, -0.45), 1.4);
    } else ell(g, cx, ny, species === 'ogre' || species === 'orc' || species === 'goblin' ? 5 : 3.2, 3.2, shade(skin, -0.1), shade(skin, -0.5), 1.2);
    curve(g, [cx - mw, my - smile * 0.5, cx, my + smile, cx + mw, my - smile * 0.5], female ? '#b03a4a' : shade(skin, -0.55), female ? 2.4 : 1.8);
    if (female) curve(g, [cx - mw * 0.7, my + 1.6, cx, my + smile + 2.6, cx + mw * 0.7, my + 1.6], alpha('#d05a6a', 0.8), 1.5);
    if (species === 'orc' || species === 'ogre' || species === 'goblin') {
      for (const d of [-1, 1]) poly(g, [cx + d * mw * 0.75 - 1.8, my + 0.5, cx + d * mw * 0.75, my - 6.5, cx + d * mw * 0.75 + 1.8, my + 0.5], '#fffdf0', INK, 0.9);
    }
    if (species === 'pale' && r.chance(0.6)) for (const d of [-1, 1]) poly(g, [cx + d * 2.6 - 1, my + 0.6, cx + d * 2.6, my + 4.2, cx + d * 2.6 + 1, my + 0.6], '#ffffff', INK, 0.6);
    if (r.chance(0.35)) for (const d of [-1, 1]) ell(g, cx + d * fw * 0.58, cy + 9, 4, 2.6, alpha('#e06050', 0.2), null);
  }
  if (species === 'nix') for (const d of [-1, 1]) for (let i = 0; i < 3; i++) line(g, [cx + d * (fw - 2), cy + 6 + i * 4, cx + d * (fw - 8), cy + 8 + i * 4], shade(skin, -0.4), 1.2);
  if (species === 'lizard') poly(g, [cx - 10, cy - fh + 2, cx - 6, cy - fh - 10, cx - 1, cy - fh, cx + 3, cy - fh - 12, cx + 7, cy - fh, cx + 11, cy - fh - 8, cx + 12, cy - fh + 3], pal.trim, INK, 1.4);

  // --- beard / moustache
  const canBeard = !female && (humanish || ['orc', 'ogre', 'genie', 'earth', 'fire'].includes(species));
  const beard = species === 'dwarf' ? 'long' : canBeard ? r.pick(['none', 'none', 'stubble', 'goatee', 'full', 'long', 'moustache', 'full']) : 'none';
  const bc = species === 'fire' ? '#ffd040' : hairC;
  if (beard === 'full' || beard === 'long') {
    const len = beard === 'long' ? 22 : 9;
    blob(g, [cx - fw * 0.95, cy + 5, cx - fw * 0.55, my - 6, cx, my - 3.5, cx + fw * 0.55, my - 6, cx + fw * 0.95, cy + 5, cx + fw * 0.7, cy + fh + len * 0.4, cx, cy + fh + len, cx - fw * 0.7, cy + fh + len * 0.4],
      vgrad(g, cy, cy + fh + len, bc, 0.18), INK, 1.7);
    curve(g, [cx - mw * 0.8, my + 1, cx, my + 2.6 + smile * 0.3, cx + mw * 0.8, my + 1], shade(bc, -0.55), 1.6);
    if (beard === 'long') for (const d of [-0.4, 0, 0.4]) line(g, [cx + d * fw, cy + fh, cx + d * fw * 0.7, cy + fh + len * 0.7], shade(bc, -0.3), 1);
  } else if (beard === 'goatee') {
    blob(g, [cx - 5, my + 3, cx + 5, my + 3, cx + 3.4, cy + fh + 6, cx, cy + fh + 9, cx - 3.4, cy + fh + 6], bc, INK, 1.4);
  } else if (beard === 'stubble') {
    for (let i = 0; i < 26; i++) circ(g, cx + r.f(-fw * 0.7, fw * 0.7), my + r.f(-2, fh * 0.36), 0.55, alpha(shade(hairC, -0.3), 0.55), null);
  }
  if (beard === 'moustache' || beard === 'full' || (beard === 'goatee' && r.chance(0.5))) {
    for (const d of [-1, 1]) curve(g, [cx, my - 4.2, cx + d * mw * 0.7, my - 4.6, cx + d * (mw + 3), my - 0.4 + r.f(-2, 2)], bc, 2.8);
  }

  // --- hair on top
  const top = cy - fh;
  const capHair = (h) => {
    g.beginPath();
    g.moveTo(cx - fw - 1, cy - 6);
    g.quadraticCurveTo(cx - fw * 0.9, top - 7, cx, top - 8);
    g.quadraticCurveTo(cx + fw * 0.9, top - 7, cx + fw + 1, cy - 6);
    g.quadraticCurveTo(cx + fw * 0.7, top + h, cx + fw * 0.2, top + h * 0.75);
    g.quadraticCurveTo(cx - fw * 0.3, top + h * 1.2, cx - fw - 1, cy - 6);
    g.closePath();
    paint(g, vgrad(g, top - 8, top + h, hairC, 0.22), INK, 1.8);
  };
  const hairy = humanish || ['orc', 'ogre', 'goblin', 'genie'].includes(species);
  if (hairy) {
    if (['short', 'medium', 'long', 'wavy', 'braids', 'tail'].includes(hairStyle)) capHair(r.f(7, 12));
    else if (hairStyle === 'bun') {
      circ(g, cx, top - 9, 7.5, hairC, INK, 1.7);
      capHair(8);
    } else if (hairStyle === 'mohawk') blob(g, [cx - 5, top + 4, cx - 4, top - 16, cx + 2, top - 19, cx + 6, top - 12, cx + 5, top + 4], hairC, INK, 1.7);
    if (hairStyle === 'braids') for (const d of [-1, 1]) for (let i = 0; i < 4; i++) circ(g, cx + d * (fw + 3), cy + 6 + i * 7, 3.2, hairC, INK, 1.2);
    if (hairStyle === 'tail') blob(g, [cx + fw - 2, top + 4, cx + fw + 9, top + 2, cx + fw + 10, cy + 14, cx + fw + 4, cy + 10], hairC, INK, 1.5);
  } else if (species === 'fire') {
    for (let i = -3; i <= 3; i++) {
      const hgt = 14 + ((i * 7 + 21) % 5) * 2.4 + r.f(0, 4);
      blob(g, [cx + i * 6 - 4.5, top + 5, cx + i * 6 - 2 + r.f(-2, 2), top - hgt, cx + i * 6 + 4.5, top + 5], i % 2 ? '#ffd040' : '#ff8a20', '#c03a10', 1.2);
    }
  } else if (species === 'water') {
    blob(g, [cx - fw, top + 8, cx - fw * 0.6, top - 10, cx, top - 5, cx + fw * 0.5, top - 15, cx + fw + 3, top - 6, cx + fw, top + 8, cx, top + 1], shade(skin, 0.3), shade(skin, -0.4), 1.5);
  } else if (species === 'air') {
    for (const [dx, dy, rr] of [[-12, -4, 9], [0, -9, 11], [13, -4, 9]]) circ(g, cx + dx, top + dy, rr, alpha('#ffffff', 0.85), alpha('#7a8ab0', 0.9), 1.2);
  } else if (species === 'earth') {
    for (const [dx, hh] of [[-12, 9], [-2, 14], [9, 10]]) poly(g, [cx + dx - 6, top + 5, cx + dx - 2, top - hh, cx + dx + 5, top - hh * 0.6, cx + dx + 7, top + 5], shade(skin, -0.2), INK, 1.4);
  }

  // --- headgear
  const GEAR = {
    castle: might ? ['helm', 'helm', 'circlet', 'none'] : ['hood', 'mitre', 'circlet', 'none'],
    rampart: might ? ['band', 'none', 'helm', 'leaves'] : ['leaves', 'circlet', 'hood', 'none'],
    tower: might ? ['turban', 'goggles', 'none', 'helm'] : ['wizard', 'turban', 'circlet', 'wizard'],
    inferno: might ? ['none', 'none', 'spikes', 'helm'] : ['hood', 'none', 'circlet', 'hood'],
    necropolis: might ? ['darkhelm', 'none', 'crown', 'darkhelm'] : ['hood', 'crown', 'hood', 'none'],
    dungeon: might ? ['hornhelm', 'darkhelm', 'none', 'circlet'] : ['hood', 'circlet', 'wizard', 'none'],
    stronghold: might ? ['hornhelm', 'band', 'none', 'none'] : ['headdress', 'band', 'headdress', 'none'],
    fortress: might ? ['band', 'helm', 'none', 'none'] : ['witch', 'hood', 'band', 'none'],
    conflux: ['circlet', 'none', 'crown', 'none'],
    cove: might ? ['tricorn', 'bandana', 'tricorn', 'none'] : ['bandana', 'tricorn', 'circlet', 'none'],
    factory: might ? ['cowboy', 'goggles', 'cowboy', 'none'] : ['goggles', 'tophat', 'goggles', 'none'],
  };
  let gear = r.pick(GEAR[info.faction] || ['none']);
  if ((species === 'minotaur' || species === 'demon' || species === 'gnoll') && ['helm', 'darkhelm', 'hornhelm', 'hood', 'cowboy', 'tricorn', 'wizard', 'witch'].includes(gear)) gear = 'circlet';
  if (['fire', 'water', 'air', 'earth', 'lizard'].includes(species) && gear !== 'none') gear = 'circlet';
  const gearC = tweak(pal.cloth, r.f(-20, 20), 1, r.f(-0.1, 0.05));
  switch (gear) {
    case 'helm': case 'darkhelm': case 'hornhelm': {
      const mc = gear === 'darkhelm' ? '#4a4a56' : metal;
      if (gear === 'hornhelm') for (const d of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx + d * (fw - 2), top + 2);
        g.quadraticCurveTo(cx + d * (fw + 14), top - 2, cx + d * (fw + 12), top - 20);
        g.quadraticCurveTo(cx + d * (fw + 4), top - 6, cx + d * (fw - 8), top - 2);
        g.closePath();
        paint(g, '#e8e0c8', INK, 1.6);
      }
      g.beginPath();
      g.moveTo(cx - fw - 2.5, cy + 2);
      g.quadraticCurveTo(cx - fw - 2, top - 12, cx, top - 12);
      g.quadraticCurveTo(cx + fw + 2, top - 12, cx + fw + 2.5, cy + 2);
      g.lineTo(cx + fw - 4, cy + 2);
      g.lineTo(cx + fw - 5, top + 9);
      g.lineTo(cx + 3, top + 9);
      g.lineTo(cx, cy + 3);
      g.lineTo(cx - 3, top + 9);
      g.lineTo(cx - fw + 5, top + 9);
      g.lineTo(cx - fw + 4, cy + 2);
      g.closePath();
      paint(g, vgrad(g, top - 12, cy, mc, 0.32), INK, 1.9);
      line(g, [cx, top - 12, cx, top + 9], shade(mc, -0.3), 1.3);
      curve(g, [cx - fw * 0.7, top - 5, cx - fw * 0.2, top - 9, cx + fw * 0.1, top - 9], alpha('#ffffff', 0.6), 1.4);
      if (r.chance(0.5)) blob(g, [cx - 3, top - 11, cx + 2, top - 24, cx + 14, top - 20, cx + 18, top - 8, cx + 8, top - 13], pal.roof, INK, 1.5);
      break;
    }
    case 'hood': {
      g.beginPath();
      g.moveTo(cx - fw - 7, cy + fh + 6);
      g.quadraticCurveTo(cx - fw - 12, top - 14, cx, top - 16);
      g.quadraticCurveTo(cx + fw + 12, top - 14, cx + fw + 7, cy + fh + 6);
      g.lineTo(cx + fw - 1, cy + fh * 0.5);
      g.quadraticCurveTo(cx + fw + 1, top + 4, cx, top + 3);
      g.quadraticCurveTo(cx - fw - 1, top + 4, cx - fw + 1, cy + fh * 0.5);
      g.closePath();
      paint(g, vgrad(g, top - 16, cy + fh, gearC, 0.25), INK, 1.9);
      break;
    }
    case 'wizard': case 'witch': {
      ell(g, cx, top + 3, fw + 13, 5.5, shade(gearC, -0.2), INK, 1.8);
      g.beginPath();
      g.moveTo(cx - fw + 1, top + 2);
      g.quadraticCurveTo(cx - 6, top - 22, cx + (gear === 'witch' ? -16 : 8), top - 40);
      g.quadraticCurveTo(cx + 12, top - 16, cx + fw - 1, top + 2);
      g.closePath();
      paint(g, vgrad(g, top - 40, top + 2, gearC, 0.24), INK, 1.9);
      line(g, [cx - fw + 3, top - 1.5, cx + fw - 3, top - 1.5], pal.trim, 2.4);
      if (r.chance(0.6)) star(g, cx + 3, top - 16, 4, 1.7, 5, pal.trim, null);
      break;
    }
    case 'mitre': {
      poly(g, [cx - fw + 3, top + 4, cx - fw + 4, top - 12, cx, top - 28, cx + fw - 4, top - 12, cx + fw - 3, top + 4], vgrad(g, top - 28, top + 4, '#f0ece0', 0.14), INK, 1.9);
      rect(g, cx - 1.5, top - 20, 3, 20, pal.trim, null);
      rect(g, cx - 7, top - 12, 14, 3, pal.trim, null);
      break;
    }
    case 'turban': {
      const tc = r.pick(['#f0ece0', gearC, '#e8d8a0']);
      ell(g, cx, top - 3, fw + 3, 14, vgrad(g, top - 17, top + 11, tc, 0.18), INK, 1.9);
      for (const k of [-0.5, 0.1, 0.6]) curve(g, [cx - fw, top + 2 - k * 6, cx, top - 10 - k * 6, cx + fw, top + 2 + k * 5], shade(tc, -0.25), 1.2);
      circ(g, cx, top - 3, 3.6, r.pick(['#d03a4a', '#3ad0a0', '#5a8ae8']), INK, 1.2);
      poly(g, [cx - 2, top - 6, cx, top - 20, cx + 2, top - 6], pal.trim, INK, 0.9);
      break;
    }
    case 'bandana': {
      const bc2 = r.pick(['#c03a2a', '#2a5a9a', '#2a2a2a', gearC]);
      g.beginPath();
      g.moveTo(cx - fw - 1.5, cy - 9);
      g.quadraticCurveTo(cx - fw, top - 9, cx, top - 9);
      g.quadraticCurveTo(cx + fw, top - 9, cx + fw + 1.5, cy - 9);
      g.quadraticCurveTo(cx, top + 4, cx - fw - 1.5, cy - 9);
      g.closePath();
      paint(g, bc2, INK, 1.8);
      poly(g, [cx + fw, cy - 10, cx + fw + 12, cy - 5, cx + fw + 7, cy + 4, cx + fw + 1, cy - 4], bc2, INK, 1.4);
      for (let i = -2; i <= 2; i++) circ(g, cx + i * 8, top - 1 + Math.abs(i) * 1.5, 1.2, alpha('#ffffff', 0.7), null);
      break;
    }
    case 'tricorn': case 'cowboy': case 'tophat': {
      const hc = gear === 'cowboy' ? r.pick(['#5a3a22', '#8a6a4a', '#2a2420']) : r.pick(['#1e1c20', '#2a2a42', '#4a2020']);
      if (gear === 'tricorn') {
        blob(g, [cx - fw - 16, top - 6, cx - fw * 0.5, top + 7, cx + fw * 0.5, top + 7, cx + fw + 16, top - 6, cx + fw * 0.6, top - 22, cx, top - 16, cx - fw * 0.6, top - 22], vgrad(g, top - 22, top + 7, hc, 0.2), INK, 1.9);
        curve(g, [cx - fw - 12, top - 5, cx, top + 5, cx + fw + 12, top - 5], pal.trim, 1.8);
        if (r.chance(0.5)) circ(g, cx, top - 5, 3.4, '#f0ece0', INK, 1);
      } else {
        const bw = gear === 'cowboy' ? fw + 18 : fw + 8;
        const ht = gear === 'cowboy' ? 17 : 27;
        ell(g, cx, top + 2, bw, gear === 'cowboy' ? 6.5 : 4.5, shade(hc, -0.15), INK, 1.9);
        rrect(g, cx - fw + 3, top - ht, fw * 2 - 6, ht + 2, gear === 'cowboy' ? 8 : 2, vgrad(g, top - ht, top + 2, hc, 0.2), INK, 1.9);
        rect(g, cx - fw + 3, top - 6, fw * 2 - 6, 4.5, pal.trim, INK, 0.9);
      }
      break;
    }
    case 'crown': case 'circlet': {
      const cc = pal.trim;
      if (gear === 'crown') poly(g, [cx - fw + 2, top + 5, cx - fw + 1, top - 12, cx - fw * 0.45, top - 3, cx, top - 16, cx + fw * 0.45, top - 3, cx + fw - 1, top - 12, cx + fw - 2, top + 5], vgrad(g, top - 16, top + 5, cc, 0.3), INK, 1.8);
      else rrect(g, cx - fw + 1, top + 3, fw * 2 - 2, 5, 2, cc, INK, 1.4);
      circ(g, cx, top + 4.5, 3, r.pick(['#d03a4a', '#3ad0a0', '#5a8ae8', '#b060e0']), INK, 1.1);
      break;
    }
    case 'goggles': {
      rect(g, cx - fw - 1, top + 6, fw * 2 + 2, 4.5, '#4a3020', INK, 1.1);
      for (const d of [-1, 1]) {
        circ(g, cx + d * 8.5, top + 7, 7, '#b0864a', INK, 1.6);
        circ(g, cx + d * 8.5, top + 7, 4.6, '#9ad8f0', INK, 1);
        line(g, [cx + d * 8.5 - 2.4, top + 5, cx + d * 8.5 + 0.4, top + 4], '#ffffff', 1.1);
      }
      break;
    }
    case 'band': {
      rect(g, cx - fw, top + 7, fw * 2, 4.5, r.pick(['#c03a2a', gearC, '#8a5a2a']), INK, 1.2);
      if (r.chance(0.5)) poly(g, [cx + fw - 4, top + 7, cx + fw + 3, top - 9, cx + fw + 6, top + 7], '#f0ece0', INK, 1.1);
      break;
    }
    case 'headdress': {
      for (let i = -3; i <= 3; i++) {
        const a = -Math.PI / 2 + i * 0.3;
        poly(g, [cx + Math.cos(a - 0.1) * fw, top + 14 + Math.sin(a - 0.1) * 14, cx + Math.cos(a) * (fw + 20), top + 14 + Math.sin(a) * 34, cx + Math.cos(a + 0.1) * fw, top + 14 + Math.sin(a + 0.1) * 14],
          i % 2 ? '#f0ece0' : '#d04a3a', INK, 1.2);
      }
      rect(g, cx - fw, top + 6, fw * 2, 5, pal.trim, INK, 1.2);
      break;
    }
    case 'leaves': {
      for (let i = -3; i <= 3; i++) ell(g, cx + i * (fw / 3.2), top + 5 - (3 - Math.abs(i)) * 2.2, 5.4, 3.2, i % 2 ? '#3a8a34' : '#58a840', INK, 1.1, i * 0.35);
      if (r.chance(0.5)) circ(g, cx + 4, top + 1, 2, '#e84a3a', INK, 0.8);
      break;
    }
    case 'spikes': {
      for (let i = -2; i <= 2; i++) poly(g, [cx + i * 8 - 3, top + 3, cx + i * 8, top - 9 - (2 - Math.abs(i)) * 3, cx + i * 8 + 3, top + 3], shade(skin, -0.45), INK, 1.2);
      break;
    }
    default:
      break;
  }
  if (humanish && r.chance(info.faction === 'cove' ? 0.3 : 0.04)) {
    const d = r.pick([-1, 1]);
    ell(g, cx + d * ex, ey, 6, 5, '#141018', INK, 1);
    line(g, [cx - fw, ey - 9, cx + fw, ey - 3 * d], '#141018', 1.5);
  }

  // --- frame
  rect(g, 1.5, 1.5, 97, 97, null, '#1a1410', 3);
  rect(g, 3.2, 3.2, 93.6, 93.6, null, mix(pal.trim, '#d8ad45', 0.6), 2.2);
  rect(g, 5.2, 5.2, 89.6, 89.6, null, alpha('#000000', 0.45), 1);
  for (const [x, y] of [[4, 4], [96, 4], [4, 96], [96, 96]]) circ(g, x, y, 2.6, pal.main, '#1a1410', 1);
}

/** opts: size (px, square). */
export function portraitHandler(id) {
  const info = resolveHero(id);
  return { dw: 100, dh: 100, unit: 100, size: 64, key: '', paint: (g) => paintPortrait(g, info) };
}

export { HERO_CLASSES, shadow };
