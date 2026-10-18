// Icon kinds on a 100x100 design grid: `artifact`, `spell`, `skill` (29 secondary skills +
// primary skills), `resource` (7 resources + movement, mana, experience, morale/luck pips).

import { ARTIFACTS, ARTIFACT_BY_ID } from '../data/artifacts.js';
import { SPELLS, SPELL_BY_ID } from '../data/spells.js';
import { SKILLS } from '../data/skills.js';
import { RESOURCES, PRIMARY_SKILLS } from '../core/constants.js';
import { INK, alpha, at, blob, circ, curve, ell, glow, hashStr, lgrad, limb, line, mix, paint, poly, rect, rgrad, rrect, seeded, shade, star, tweak, vgrad } from './kit.js';
import { CLASS_HEX, RESOURCE_HEX, SCHOOL_HEX, UI_HEX } from './palette.js';
import { resourceGlyph } from './objects.js';
import { paintCreature } from './creatures.js';
import { CREATURE_BY_ID } from '../data/creatures.js';

export const ARTIFACT_IDS = ARTIFACTS.map((a) => a.id);
export const SPELL_IDS = SPELLS.map((s) => s.id);
export const SKILL_SPRITE_IDS = [...SKILLS.map((s) => s.id), ...PRIMARY_SKILLS];
export const RESOURCE_SPRITE_IDS = [...RESOURCES, 'movement', 'mana', 'experience', 'morale', 'luck', 'gold_pile'];

const STEEL = '#d4d8e0';

// ---------------------------------------------------------------------------------------------
// Shared glyphs (centred on 50,50 unless stated)
// ---------------------------------------------------------------------------------------------

export function swordGlyph(g, x, y, s, blade = STEEL, hilt = '#e8c040', rot = -Math.PI / 4) {
  at(g, x, y, rot, s, s, () => {
    poly(g, [-4, -30, 0, -38, 4, -30, 4, 12, -4, 12], lgrad(g, -4, 0, 4, 0, [[0, shade(blade, 0.4)], [1, shade(blade, -0.2)]]), INK, 2);
    line(g, [0, -32, 0, 10], alpha('#ffffff', 0.6), 1.2);
    rrect(g, -13, 12, 26, 5, 2, hilt, INK, 1.8);
    rect(g, -2.6, 17, 5.2, 12, '#6a4626', INK, 1.6);
    circ(g, 0, 31, 4, hilt, INK, 1.6);
  });
}

export function shieldGlyph(g, x, y, s, c, trim = '#e8c040', emblem) {
  at(g, x, y, 0, s, s, () => {
    g.beginPath();
    g.moveTo(-26, -28);
    g.lineTo(26, -28);
    g.quadraticCurveTo(28, 10, 0, 34);
    g.quadraticCurveTo(-28, 10, -26, -28);
    g.closePath();
    paint(g, vgrad(g, -28, 34, c, 0.3), INK, 2.4);
    g.beginPath();
    g.moveTo(-19, -21);
    g.lineTo(19, -21);
    g.quadraticCurveTo(20, 7, 0, 25);
    g.quadraticCurveTo(-20, 7, -19, -21);
    g.closePath();
    paint(g, null, trim, 2.2);
    if (emblem) emblem();
  });
}

function bookGlyph(g, x, y, s, cover, gem) {
  at(g, x, y, 0, s, s, () => {
    poly(g, [-26, -30, 22, -34, 26, 30, -22, 34], vgrad(g, -34, 34, cover, 0.3), INK, 2.2);
    poly(g, [22, -34, 28, -30, 30, 32, 26, 30], '#f0e8d0', INK, 1.6);
    rect(g, -16, -20, 32, 6, alpha('#e8c040', 0.9), null);
    if (gem) {
      glow(g, 0, 6, 16, gem, 0.6);
      poly(g, [0, -6, 9, 6, 0, 18, -9, 6], gem, INK, 1.6);
    }
  });
}

function flaskGlyph(g, x, y, s, c) {
  at(g, x, y, 0, s, s, () => {
    glow(g, 0, 10, 30, c, 0.4);
    poly(g, [-7, -30, 7, -30, 7, -12, 24, 22, 18, 30, -18, 30, -24, 22, -7, -12], alpha('#e0f0ff', 0.6), INK, 2.2);
    poly(g, [-15, 6, 15, 6, 22, 22, 17, 28, -17, 28, -22, 22], c, null);
    rect(g, -9, -36, 18, 7, '#8a5a2a', INK, 1.8);
    circ(g, -8, 16, 3, alpha('#ffffff', 0.8), null);
  });
}

function orbGlyph(g, x, y, s, c) {
  at(g, x, y, 0, s, s, () => {
    glow(g, 0, -4, 40, c, 0.55);
    rrect(g, -18, 18, 36, 12, 3, '#a8703a', INK, 2);
    circ(g, 0, -4, 24, rgrad(g, -8, -12, 2, 30, [[0, shade(c, 0.6)], [0.5, c], [1, shade(c, -0.45)]]), INK, 2.2);
    ell(g, -8, -14, 7, 4, alpha('#ffffff', 0.7), null, 0, -0.5);
  });
}

function ringGlyph(g, x, y, s, metal, gem) {
  at(g, x, y, 0, s, s, () => {
    ell(g, 0, 8, 26, 22, null, INK, 12);
    ell(g, 0, 8, 26, 22, null, metal, 8);
    ell(g, -6, 2, 20, 16, null, alpha('#ffffff', 0.4), 2);
    poly(g, [-12, -16, 0, -30, 12, -16, 0, -6], gem, INK, 2);
    line(g, [-4, -22, 0, -26], alpha('#ffffff', 0.8), 2);
  });
}

function amuletGlyph(g, x, y, s, metal, gem) {
  at(g, x, y, 0, s, s, () => {
    curve(g, [-26, -34, -20, -4, 0, 6, 20, -4, 26, -34], INK, 5);
    curve(g, [-26, -34, -20, -4, 0, 6, 20, -4, 26, -34], metal, 3);
    circ(g, 0, 18, 16, vgrad(g, 2, 34, metal, 0.3), INK, 2.2);
    circ(g, 0, 18, 9, gem, INK, 1.6);
    glow(g, 0, 18, 14, gem, 0.5);
  });
}

function helmGlyph(g, x, y, s, metal, kind, extra) {
  at(g, x, y, 0, s, s, () => {
    if (kind === 'crown') {
      poly(g, [-30, 20, -32, -18, -16, 0, 0, -26, 16, 0, 32, -18, 30, 20], vgrad(g, -26, 20, metal, 0.35), INK, 2.4);
      for (const gx of [-16, 0, 16]) circ(g, gx, 10, 4, extra, INK, 1.4);
      return;
    }
    if (kind === 'hat') {
      ell(g, 0, 18, 36, 9, shade(metal, -0.15), INK, 2.2);
      poly(g, [-20, 16, -6, -34, 20, 16], vgrad(g, -34, 16, metal, 0.25), INK, 2.2);
      line(g, [-19, 10, 19, 10], extra, 3);
      return;
    }
    if (kind === 'skull') {
      circ(g, 0, -2, 26, vgrad(g, -28, 24, '#ece6d0', 0.15), INK, 2.4);
      rrect(g, -12, 18, 24, 12, 2, '#dcd4bc', INK, 2);
      for (const dx of [-9, 9]) ell(g, dx, 0, 7, 8, INK, null);
      return;
    }
    g.beginPath();
    g.moveTo(-28, 24);
    g.quadraticCurveTo(-30, -30, 0, -32);
    g.quadraticCurveTo(30, -30, 28, 24);
    g.lineTo(14, 24);
    g.lineTo(12, 0);
    g.lineTo(-12, 0);
    g.lineTo(-14, 24);
    g.closePath();
    paint(g, vgrad(g, -32, 24, metal, 0.35), INK, 2.4);
    line(g, [0, -32, 0, 0], shade(metal, -0.35), 2);
    if (kind === 'horned') for (const d of [-1, 1]) poly(g, [d * 22, -16, d * 40, -30, d * 38, -44, d * 26, -26], '#f0e8d0', INK, 2);
    else poly(g, [-4, -32, 6, -46, 22, -42, 10, -30], extra, INK, 2);
  });
}

function armorGlyph(g, x, y, s, metal, trim, kind) {
  at(g, x, y, 0, s, s, () => {
    if (kind === 'ribs') {
      rrect(g, -24, -30, 48, 60, 12, alpha('#3a3440', 0.5), INK, 2);
      for (let i = 0; i < 4; i++) curve(g, [-22, -20 + i * 13, 0, -12 + i * 13, 22, -20 + i * 13], '#ece6d0', 4);
      line(g, [0, -30, 0, 30], '#ece6d0', 4);
      return;
    }
    poly(g, [-34, -26, -18, -34, -8, -26, 8, -26, 18, -34, 34, -26, 28, -4, 22, 32, -22, 32, -28, -4], vgrad(g, -34, 32, metal, 0.3), INK, 2.4);
    curve(g, [-20, -6, 0, 8, 20, -6], shade(metal, -0.35), 2);
    line(g, [0, -26, 0, 30], shade(metal, -0.25), 1.6);
    rect(g, -22, 22, 44, 6, trim, INK, 1.6);
    if (kind === 'scales') for (let i = 0; i < 9; i++) ell(g, -14 + (i % 3) * 14, -10 + Math.floor(i / 3) * 10, 6, 4, shade(metal, 0.15), INK, 1);
  });
}

function cloakGlyph(g, x, y, s, c, trim, wings) {
  at(g, x, y, 0, s, s, () => {
    if (wings) {
      for (const d of [-1, 1]) blob(g, [d * 4, -10, d * 22, -36, d * 40, -30, d * 38, 0, d * 26, 24, d * 8, 12], vgrad(g, -36, 24, c, 0.2), INK, 2.2);
      return;
    }
    blob(g, [-14, -34, 14, -34, 24, -10, 34, 32, 0, 36, -34, 32, -24, -10], vgrad(g, -34, 36, c, 0.25), INK, 2.4);
    rect(g, -16, -34, 32, 8, trim, INK, 1.6);
    circ(g, 0, -30, 5, trim, INK, 1.4);
    for (const dx of [-12, 12]) line(g, [dx, -20, dx * 1.6, 30], shade(c, -0.3), 1.6);
  });
}

function bootGlyph(g, x, y, s, c, trim, wings) {
  at(g, x, y, 0, s, s, () => {
    poly(g, [-14, -30, 10, -30, 10, 10, 30, 18, 30, 30, -16, 30], vgrad(g, -30, 30, c, 0.3), INK, 2.4);
    rect(g, -16, -34, 28, 8, trim, INK, 1.6);
    if (wings) for (let i = 0; i < 3; i++) poly(g, [-14, -18 + i * 7, -32, -26 + i * 8, -14, -12 + i * 7], '#f8f4e8', INK, 1.4);
  });
}

function bowGlyph(g, x, y, s, c) {
  at(g, x, y, -0.6, s, s, () => {
    for (const [col, w] of [[INK, 7], [c, 4]]) {
      g.beginPath();
      g.moveTo(0, -36);
      g.quadraticCurveTo(28, 0, 0, 36);
      g.strokeStyle = col;
      g.lineWidth = w;
      g.stroke();
    }
    line(g, [0, -36, 0, 36], '#f0e8d0', 1.6);
  });
}

// ---------------------------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------------------------

function paintArtifact(g, a) {
  const r = seeded(`art:${a.id}`);
  const cls = CLASS_HEX[a.class] || CLASS_HEX.special;
  const n = a.id;
  const has = (...k) => k.some((w) => n.includes(w));
  const GEMS = ['#d03a4a', '#3ad0a0', '#5a8ae8', '#e8d040', '#b060e0', '#f0f0f0', '#ff8030'];
  const gem = has('dragon') ? '#d03a2a' : has('sea', 'ocean', 'naval', 'water') ? '#3a8ad8' : has('fire', 'hell', 'brimstone', 'sulfur') ? '#ff6020' : has('dead', 'damned', 'undead', 'death') ? '#60ff90' : r.pick(GEMS);
  const metal = has('dragon') ? '#c84030' : has('bone', 'skull', 'dead', 'rib') ? '#e4dcc4' : has('gold', 'titan', 'angel', 'celestial', 'saint', 'holiness') ? '#e8c040' : has('damned', 'black', 'chaos', 'hell', 'oppression') ? '#5a4a5a' : has('wood', 'petrified', 'centaur', 'ogre', 'gnoll') ? '#9a6a3a' : r.pick(['#c8ccd4', '#b8bcc8', '#d8b860', '#a8b0c0']);
  // background tile by class
  rrect(g, 3, 3, 94, 94, 12, rgrad(g, 50, 40, 6, 70, [[0, shade(cls, -0.35)], [1, shade(cls, -0.75)]]), INK, 3);
  rrect(g, 7, 7, 86, 86, 9, null, alpha(cls, 0.9), 2.2);
  if (a.class === 'relic' || a.class === 'combo') glow(g, 50, 50, 44, cls, 0.35);
  const s = 1;
  switch (a.slot) {
    case 'right_hand': {
      if (has('axe', 'blackshard')) {
        at(g, 50, 52, -0.7, 1, 1, () => {
          limb(g, [0, 36, 0, -32], '#7a5230', 6);
          blob(g, [2, -30, 26, -38, 30, -10, 2, -14], vgrad(g, -38, -10, metal, 0.3), INK, 2.2);
          if (has('blackshard')) blob(g, [-2, -30, -26, -38, -30, -10, -2, -14], vgrad(g, -38, -10, metal, 0.3), INK, 2.2);
        });
      } else if (has('flail', 'club', 'ironfist')) {
        at(g, 50, 52, -0.7, 1, 1, () => {
          limb(g, [0, 36, 0, -10], '#7a5230', 7);
          if (has('flail')) { curve(g, [0, -10, 10, -20, 14, -28], INK, 3); star(g, 16, -32, 12, 7, 8, metal, INK, 2); }
          else poly(g, [-6, -8, -14, -38, 14, -38, 6, -8], vgrad(g, -38, -8, has('ogre', 'ironfist') ? '#7a5a3a' : metal, 0.3), INK, 2.2);
        });
      } else if (has('trident')) {
        at(g, 50, 52, -0.7, 1, 1, () => {
          limb(g, [0, 38, 0, -20], '#7a5230', 5);
          for (const d of [-12, 0, 12]) poly(g, [d - 3, -18, d, -40, d + 3, -18], metal, INK, 1.6);
          rect(g, -14, -20, 28, 5, metal, INK, 1.6);
        });
      } else if (has('staff')) {
        at(g, 50, 50, -0.7, 1, 1, () => {
          limb(g, [0, 38, 0, -26], '#7a5230', 6);
          for (const [d, c] of [[-1, '#ff6020'], [1, '#3a8ad8']]) circ(g, d * 8, -32, 7, c, INK, 1.6);
          for (const [d, c] of [[-1, '#7a9a3a'], [1, '#5aa8e8']]) circ(g, d * 8, -18, 6, c, INK, 1.6);
        });
      } else swordGlyph(g, 50, 52, 1.05 * s, has('hellfire', 'flame', 'armageddon') ? '#ffb030' : has('blackshard', 'judgement') ? '#e8e8f0' : STEEL, has('titan', 'judgement', 'angelic') ? '#e8c040' : metal);
      if (has('armageddon', 'hellfire', 'flame')) glow(g, 46, 40, 24, '#ff7020', 0.5);
      if (has('thunder', 'titan')) poly(g, [70, 14, 60, 34, 68, 34, 58, 54, 78, 28, 70, 28, 78, 14], '#fff8a0', '#e8a020', 1.4);
      break;
    }
    case 'left_hand': {
      const sc = has('dragon') ? '#c84030' : has('dead', 'damned') ? '#4a4050' : has('dwarven') ? '#8a8a92' : has('naval') ? '#2a5a9a' : has('lion') ? '#e8c040' : tweak(metal, r.f(-20, 20), 1, -0.1);
      shieldGlyph(g, 50, 50, 1, sc, has('dead') ? '#e4dcc4' : '#e8c040', () => {
        if (has('lion')) circ(g, 0, 0, 9, '#d8a040', INK, 1.6);
        else if (has('dead', 'yawning')) { circ(g, 0, -2, 9, '#e4dcc4', INK, 1.4); ell(g, -3, -3, 2.4, 3, INK, null); ell(g, 3, -3, 2.4, 3, INK, null); }
        else if (has('dragon')) for (let i = 0; i < 3; i++) curve(g, [-12, -8 + i * 8, 0, -2 + i * 8, 12, -8 + i * 8], shade(sc, 0.3), 2.4);
        else star(g, 0, 0, 10, 4, r.i(4, 8), gem, INK, 1.4);
      });
      break;
    }
    case 'head': {
      const kind = has('crown', 'circlet', 'regalia') ? 'crown' : has('hat') ? 'hat' : has('skull') ? 'skull' : has('chaos', 'hellstorm', 'thunder') ? 'horned' : 'helm';
      helmGlyph(g, 50, 54, 1, kind === 'hat' ? (has('captain', 'admiral') ? '#2a2a42' : '#5a3aa0') : metal, kind, kind === 'crown' || kind === 'hat' ? gem : has('unicorn') ? '#ffffff' : gem);
      if (has('unicorn')) poly(g, [46, 18, 50, 2, 54, 18], '#fff4d0', INK, 1.6);
      if (has('enlightenment', 'supreme')) glow(g, 50, 28, 26, '#fff0a0', 0.6);
      break;
    }
    case 'neck': {
      if (has('teeth', 'dragonteeth')) {
        curve(g, [22, 20, 30, 56, 50, 66, 70, 56, 78, 20], INK, 5);
        curve(g, [22, 20, 30, 56, 50, 66, 70, 56, 78, 20], '#8a5a2a', 2.6);
        for (let i = 0; i < 7; i++) { const t = i / 6; const x = 28 + t * 44; const y = 52 + Math.sin(t * Math.PI) * 12; poly(g, [x - 3, y, x, y + 12, x + 3, y], '#f4f0e0', INK, 1.2); }
      } else if (has('medal', 'garniture', 'collar')) {
        amuletGlyph(g, 50, 46, 1, '#c03a2a', gem);
        star(g, 50, 64, 12, 5, 5, '#e8c040', INK, 1.4);
      } else amuletGlyph(g, 50, 46, 1, metal, gem);
      break;
    }
    case 'torso': {
      armorGlyph(g, 50, 52, 1, has('wood') ? '#8a6a3a' : has('tunic') ? '#6a4a8a' : has('scale', 'basilisk', 'dragon') ? (has('dragon') ? '#c84030' : '#5a8a3a') : metal, gem === '#f0f0f0' ? '#e8c040' : gem, has('rib') ? 'ribs' : has('scale', 'basilisk') ? 'scales' : 'plate');
      break;
    }
    case 'shoulders': {
      const c = has('vampire', 'undead') ? '#3a2a3a' : has('dragon') ? '#c84030' : has('angel') ? '#f8f4e8' : has('crystal') ? '#8ad0f0' : tweak('#5a3a8a', r.f(-120, 120), 1, r.f(-0.1, 0.1));
      cloakGlyph(g, 50, 50, 1, c, '#e8c040', has('wings', 'wing'));
      break;
    }
    case 'feet': {
      const c = has('dragon', 'bone') ? '#e4dcc4' : has('dead') ? '#4a4050' : has('saint') ? '#d8b860' : tweak('#7a4a2a', r.f(-30, 30), 1, r.f(-0.08, 0.1));
      bootGlyph(g, 52, 52, 1, c, has('dead') ? '#60ff90' : '#e8c040', has('speed', 'levitation', 'swift'));
      if (has('levitation')) ell(g, 50, 90, 24, 4, alpha('#9ad0ff', 0.6), null);
      break;
    }
    case 'ring': {
      if (has('glove', 'gauntlet')) {
        at(g, 50, 52, 0, 1, 1, () => {
          blob(g, [-20, 34, -22, -6, -16, -30, -6, -34, 4, -32, 14, -30, 22, -10, 24, 34], vgrad(g, -34, 34, has('gauntlet') ? metal : '#8a5a2a', 0.3), INK, 2.4);
          for (const dx of [-10, 0, 10]) line(g, [dx, -30, dx, -10], INK, 1.4);
          rect(g, -22, 24, 46, 10, '#e8c040', INK, 1.6);
        });
      } else if (has('eye')) {
        ell(g, 50, 50, 30, 18, '#fffbe8', INK, 2.4);
        circ(g, 50, 50, 11, has('quiet') ? '#3ad0a0' : '#d03a2a', INK, 1.6);
        ell(g, 50, 50, 3, 9, INK, null);
      } else ringGlyph(g, 50, 54, 1, metal, gem);
      break;
    }
    case 'spellbook': bookGlyph(g, 50, 50, 1, '#7a2a2a', '#5a8ae8'); break;
    case 'war_machine': {
      if (CREATURE_BY_ID[a.id]) {
        g.save();
        const wide = CREATURE_BY_ID[a.id].size === 2;
        const k = wide ? 0.42 : 0.8;
        g.translate(50 - (wide ? 100 : 50) * k, 50 - 55 * k);
        g.scale(k, k);
        paintCreature(g, a.id, 'idle', 0);
        g.restore();
      }
      break;
    }
    default: paintMiscArtifact(g, a, r, has, gem, metal); break;
  }
  // class pips
  const pips = { treasure: 1, minor: 2, major: 3, relic: 4, combo: 5 }[a.class] || 0;
  for (let i = 0; i < pips; i++) circ(g, 14 + i * 7, 88, 2.6, cls, INK, 1);
}

function paintMiscArtifact(g, a, r, has, gem, metal) {
  if (has('orb', 'sphere')) orbGlyph(g, 50, 50, 1, has('firmament') ? '#9ad0ff' : has('silt') ? '#8a7a4a' : has('fire') ? '#ff6020' : has('rain') ? '#3a6ad8' : has('inhibition') ? '#5a4a6a' : has('vulnerab') ? '#a03a4a' : gem);
  else if (has('tome')) bookGlyph(g, 50, 50, 1, has('fire') ? '#a02a1a' : has('air') ? '#3a7ab0' : has('water') ? '#2a4a9a' : '#5a6a2a', has('fire') ? '#ff8030' : has('air') ? '#c0e8ff' : has('water') ? '#5aa0ff' : '#a0d040');
  else if (has('vial', 'elixir')) flaskGlyph(g, 50, 52, 1, has('dragon') ? '#d03a2a' : has('life') ? '#e84a6a' : '#5ad070');
  else if (has('bow') && !has('bowstring')) bowGlyph(g, 52, 50, 1, has('golden', 'sharpshooter') ? '#e8c040' : '#a06a3a');
  else if (has('bowstring')) { curve(g, [20, 30, 40, 50, 50, 46, 70, 70, 80, 60], INK, 4); curve(g, [20, 30, 40, 50, 50, 46, 70, 70, 80, 60], '#f4f0e0', 2); }
  else if (has('arrow')) for (let i = 0; i < 3; i++) at(g, 40 + i * 10, 50, -0.6, 1, 1, () => { line(g, [0, 34, 0, -26], '#a07a4a', 3); poly(g, [-4, -24, 0, -36, 4, -24], STEEL, INK, 1.2); poly(g, [-6, 34, 0, 26, 6, 34], '#f8f4e8', INK, 1); });
  else if (has('clover')) { for (let i = 0; i < 4; i++) at(g, 50, 46, (i * Math.PI) / 2, 1, 1, () => blob(g, [0, 0, -12, -14, 0, -26, 12, -14], '#3cae4a', INK, 2)); line(g, [50, 50, 58, 80], '#2a7a2a', 3); }
  else if (has('cards')) for (let i = 0; i < 3; i++) at(g, 50, 54, (i - 1) * 0.3, 1, 1, () => { rrect(g, -14, -24, 28, 40, 3, '#f8f4e8', INK, 2); star(g, 0, -4, 7, 3, 4, i === 1 ? '#d03a2a' : '#2a2a3a', null); });
  else if (has('ladybird')) { ell(g, 50, 54, 22, 18, '#d03a2a', INK, 2.4); circ(g, 50, 34, 9, '#2a2a2a', INK, 2); line(g, [50, 38, 50, 72], INK, 2); for (const [x, y] of [[40, 48], [60, 48], [42, 62], [58, 62]]) circ(g, x, y, 3.4, INK, null); }
  else if (has('badge', 'crest', 'glyph', 'emblem', 'banner')) shieldGlyph(g, 50, 50, 0.9, has('banner') ? '#c03a2a' : tweak('#3a5aa0', r.f(-60, 60), 1, 0), '#e8c040', () => star(g, 0, 0, 11, 5, 5, '#e8c040', INK, 1.4));
  else if (has('hourglass')) { poly(g, [30, 18, 70, 18, 52, 50, 70, 82, 30, 82, 48, 50], alpha('#d8e8f0', 0.6), INK, 2.4); poly(g, [36, 76, 64, 76, 50, 60], '#e8c860', null); rect(g, 26, 14, 48, 6, '#7a4a2a', INK, 1.6); rect(g, 26, 80, 48, 6, '#7a4a2a', INK, 1.6); }
  else if (has('speculum', 'spyglass', 'monocle', 'mirror')) {
    if (has('spyglass')) at(g, 50, 50, -0.5, 1, 1, () => { rrect(g, -34, -7, 68, 14, 4, vgrad(g, -7, 7, '#c8a040', 0.3), INK, 2); circ(g, 34, 0, 9, '#9ad0f0', INK, 2); });
    else { circ(g, 46, 44, 22, '#9ad0f0', INK, 3); circ(g, 46, 44, 18, null, metal, 3); line(g, [62, 60, 78, 80], '#7a4a2a', 5); }
  } else if (has('bird')) { blob(g, [30, 60, 40, 40, 60, 36, 74, 46, 66, 64, 44, 70], '#7a8a9a', INK, 2.2); circ(g, 66, 40, 9, '#7a8a9a', INK, 2); poly(g, [74, 38, 84, 42, 74, 44], '#e8c040', INK, 1.4); }
  else if (has('watchman', 'legion', 'statue', 'puppet')) {
    circ(g, 50, 28, 10, has('puppet') ? '#c8a070' : '#c8c0b0', INK, 2);
    poly(g, [38, 40, 62, 40, 66, 76, 34, 76], has('legion') ? '#b0a080' : '#9a9488', INK, 2.2);
    rect(g, 30, 76, 40, 8, '#8a8278', INK, 1.8);
  } else if (has('charm', 'talisman', 'mana')) { star(g, 50, 50, 28, 12, 6, '#5a8ae8', INK, 2.2); circ(g, 50, 50, 8, '#cfe0ff', INK, 1.4); glow(g, 50, 50, 30, '#5a8ae8', 0.4); }
  else if (has('shackles')) { for (const x of [36, 64]) ell(g, x, 54, 14, 12, null, '#6a6a72', 5); line(g, [44, 46, 56, 46], '#6a6a72', 4); }
  else if (has('sack', 'bag', 'purse', 'coffer')) {
    blob(g, [28, 80, 24, 54, 36, 34, 50, 30, 64, 34, 76, 54, 72, 80], vgrad(g, 30, 80, has('coffer') ? '#7a4a2a' : '#a0703a', 0.25), INK, 2.4);
    rect(g, 40, 26, 20, 8, '#7a4a2a', INK, 1.8);
    resourceGlyph(g, 'gold', 50, 62, 30);
  } else if (has('cart')) { rect(g, 22, 40, 56, 26, '#8a5a2a', INK, 2.2); resourceGlyph(g, has('ore') ? 'ore' : 'wood', 50, 34, 30); for (const x of [32, 68]) circ(g, x, 72, 9, '#5a3a1e', INK, 2); }
  else if (has('vial_of_mercury', 'mercury')) flaskGlyph(g, 50, 52, 1, RESOURCE_HEX.mercury);
  else if (has('horseshoe')) { g.beginPath(); g.arc(50, 50, 22, Math.PI * 0.8, Math.PI * 2.2); g.strokeStyle = INK; g.lineWidth = 14; g.stroke(); g.strokeStyle = has('demon') ? '#c84030' : '#b8bcc8'; g.lineWidth = 10; g.stroke(); }
  else if (has('mask')) { blob(g, [24, 36, 50, 26, 76, 36, 72, 64, 50, 80, 28, 64], '#e8e0d0', INK, 2.4); for (const x of [40, 60]) ell(g, x, 48, 6, 4, INK, null); curve(g, [40, 66, 50, 60, 60, 66], INK, 2); }
  else if (has('runes')) { rrect(g, 26, 22, 48, 58, 8, '#8a8278', INK, 2.4); for (let i = 0; i < 3; i++) line(g, [40, 34 + i * 14, 50, 30 + i * 14, 60, 36 + i * 14], '#9ae0ff', 2.4); }
  else if (has('horn', 'warhorn')) { g.beginPath(); g.moveTo(24, 34); g.quadraticCurveTo(60, 30, 78, 70); g.lineTo(66, 76); g.quadraticCurveTo(54, 46, 26, 46); g.closePath(); paint(g, vgrad(g, 30, 76, has('abyss') ? '#3a2a4a' : '#e8dcc0', 0.2), INK, 2.4); }
  else if (has('compass', 'astrolabe')) { circ(g, 50, 50, 28, '#c8a040', INK, 2.4); circ(g, 50, 50, 22, '#f8f0d8', INK, 1.6); poly(g, [50, 30, 55, 50, 50, 70, 45, 50], '#d03a2a', INK, 1.4); }
  else if (has('saddlebags')) { for (const x of [34, 66]) rrect(g, x - 14, 36, 28, 36, 6, '#8a5a2a', INK, 2.2); line(g, [34, 36, 66, 36], '#5a3a1e', 4); }
  else if (has('feather')) { at(g, 50, 50, -0.6, 1, 1, () => { blob(g, [0, -38, 12, -10, 6, 26, 0, 34, -6, 26, -12, -10], has('phoenix') ? '#ff8a20' : '#f8f4e8', INK, 2); line(g, [0, -36, 0, 38], INK, 1.4); }); }
  else if (has('crucible')) { blob(g, [26, 40, 74, 40, 66, 76, 34, 76], '#6a6a72', INK, 2.4); ell(g, 50, 40, 24, 6, '#ffb030', INK, 2); glow(g, 50, 36, 20, '#ffb030', 0.5); }
  else if (has('heartstone')) { poly(g, [50, 78, 24, 46, 32, 28, 50, 36, 68, 28, 76, 46], vgrad(g, 28, 78, '#a05a3a', 0.3), INK, 2.4); }
  else if (has('scales')) { line(g, [50, 22, 50, 74], '#c8a040', 3); line(g, [26, 34, 74, 34], '#c8a040', 3); for (const x of [26, 74]) { line(g, [x, 34, x - 8, 54, x + 8, 54, x, 34], INK, 1.2); ell(g, x, 56, 10, 4, '#c8a040', INK, 1.6); } }
  else if (has('cornucopia')) { g.beginPath(); g.moveTo(20, 30); g.quadraticCurveTo(30, 80, 76, 64); g.lineTo(70, 46); g.quadraticCurveTo(44, 54, 20, 30); g.closePath(); paint(g, '#c8a040', INK, 2.4); for (const [x, y, c] of [[72, 50, '#d03a2a'], [80, 58, '#3cae4a'], [68, 62, '#e8d040']]) circ(g, x, y, 6, c, INK, 1.4); }
  else if (has('goose')) { blob(g, [26, 66, 30, 46, 50, 40, 70, 50, 72, 66], '#f0f0e8', INK, 2.2); circ(g, 70, 36, 8, '#f0f0e8', INK, 2); poly(g, [76, 34, 86, 38, 76, 40], '#e8a020', INK, 1.4); ell(g, 44, 74, 8, 10, '#e8c040', INK, 2); }
  else if (has('well')) { rrect(g, 28, 46, 44, 30, 4, '#9a9488', INK, 2.4); ell(g, 50, 46, 22, 6, '#5a8ae8', INK, 2); for (const x of [30, 70]) line(g, [x, 46, x, 22], '#6a4626', 3); line(g, [26, 22, 74, 22], '#8a5a3a', 4); }
  else if (has('scroll')) { rrect(g, 28, 26, 44, 48, 3, '#e8dcb0', INK, 2.2); for (const y of [26, 74]) ell(g, 50, y, 24, 5, '#c8b890', INK, 2); for (let i = 0; i < 4; i++) line(g, [36, 38 + i * 8, 64, 38 + i * 8], alpha('#5a4020', 0.7), 1.6); }
  else if (has('grail')) { glow(g, 50, 46, 34, '#ffe070', 0.6); poly(g, [30, 24, 70, 24, 64, 48, 54, 56, 54, 70, 66, 78, 34, 78, 46, 70, 46, 56, 36, 48], vgrad(g, 24, 78, '#e8c040', 0.35), INK, 2.4); }
  else { star(g, 50, 50, 26, 12, r.i(5, 8), gem, INK, 2.2); circ(g, 50, 50, 10, metal, INK, 1.6); }
}

export function artifactHandler(id) {
  const a = ARTIFACT_BY_ID[id] || { id, slot: 'misc', class: 'special' };
  return { dw: 100, dh: 100, unit: 100, size: 44, key: '', paint: (g) => paintArtifact(g, a) };
}

// ---------------------------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------------------------

const ELEMENT_OF = { air: 'bolt', fire: 'flame', water: 'ice', earth: 'rock' };

function glyphFor(sp) {
  const id = sp.id;
  const t = sp.effect && sp.effect.type;
  const has = (...k) => k.some((w) => id.includes(w));
  if (has('summon_boat', 'scuttle')) return 'boat';
  if (has('visions', 'view_', 'disguise')) return 'eye';
  if (has('fly')) return 'wing';
  if (has('water_walk')) return 'wave';
  if (has('dimension_door', 'town_portal', 'teleport')) return 'portal';
  if (has('quicksand')) return 'spiral';
  if (has('land_mine')) return 'mine';
  if (has('force_field', 'fire_wall')) return 'wall';
  if (has('earthquake')) return 'quake';
  if (has('meteor', 'implosion', 'stone_spikes')) return 'rock';
  if (has('chain_lightning', 'lightning', 'thunder', 'storm', 'static')) return 'bolt';
  if (has('frost', 'ice', 'tidal')) return 'ice';
  if (has('fireball', 'inferno', 'fire_bolt', 'immolation', 'armageddon')) return 'flame';
  if (has('death_ripple', 'destroy_undead', 'death_stare', 'death_cloud', 'age', 'disease', 'poison')) return 'skull';
  if (has('magic_arrow')) return 'arrow';
  if (t === 'damage_reduction' || has('shield', 'protection', 'anti_magic', 'counterstrike')) return 'shield';
  if (t === 'spell_reflect' || has('mirror')) return 'mirror';
  if (t === 'dispel' || has('remove_obstacle')) return 'dispel';
  if (t === 'resurrect' || has('resurrection', 'animate', 'rebirth', 'raise')) return 'ankh';
  if (sp.category === 'heal' || has('cure', 'regeneration', 'drain_life', 'sacrifice')) return 'heart';
  if (t === 'speed_mod') return has('haste') ? 'wing' : 'snail';
  if (sp.category === 'summon') return has('clone') ? 'clone' : 'elemental';
  if (sp.category === 'control') return has('blind', 'hypnot', 'paralyze', 'petrify', 'flesh') ? 'eye' : has('bind', 'entangle') ? 'chain' : 'spiral';
  if (sp.category === 'buff') return 'up';
  if (sp.category === 'debuff') return 'down';
  return ELEMENT_OF[sp.school] || 'star';
}

export const SPELL_GLYPHS = ['boat', 'eye', 'wing', 'wave', 'portal', 'spiral', 'mine', 'wall', 'quake', 'rock', 'bolt', 'ice', 'flame', 'skull', 'arrow', 'shield', 'mirror', 'dispel', 'ankh', 'heart', 'snail', 'clone', 'elemental', 'chain', 'up', 'down', 'star'];

function drawGlyph(g, glyph, c, sp, r) {
  const light = shade(c, 0.55);
  switch (glyph) {
    case 'bolt': poly(g, [56, 12, 30, 54, 48, 54, 38, 88, 72, 40, 54, 40, 66, 12], '#fff8a0', '#e8a020', 2.4); break;
    case 'flame':
      glow(g, 50, 56, 36, '#ff7020', 0.6);
      blob(g, [28, 80, 24, 54, 36, 34, 42, 46, 50, 14, 62, 40, 68, 32, 76, 56, 72, 80], '#ff8a20', '#a02a10', 2.2);
      blob(g, [40, 80, 38, 62, 50, 40, 60, 62, 60, 80], '#ffe070', null);
      break;
    case 'ice': for (let i = 0; i < 3; i++) at(g, 50, 52, (i * Math.PI) / 3, 1, 1, () => { line(g, [0, -34, 0, 34], '#e8f8ff', 5); line(g, [0, -34, 0, 34], '#7ac0f0', 2); for (const y of [-20, 20]) line(g, [-8, y - 8 * Math.sign(y), 0, y, 8, y - 8 * Math.sign(y)], '#e8f8ff', 2); }); break;
    case 'rock': for (const [x, y, s] of [[40, 34, 14], [62, 52, 12], [44, 66, 10]]) { glow(g, x, y, s * 1.8, '#ff7020', 0.5); poly(g, [x - s, y, x - s * 0.4, y - s, x + s * 0.7, y - s * 0.6, x + s, y + s * 0.4, x, y + s], '#8a7a6a', INK, 2); } break;
    case 'skull': circ(g, 50, 44, 24, '#ece6d0', INK, 2.4); rrect(g, 38, 62, 24, 14, 3, '#dcd4bc', INK, 2); for (const x of [40, 60]) ell(g, x, 44, 7, 8, INK, null); poly(g, [47, 58, 50, 52, 53, 58], INK, null); break;
    case 'arrow': at(g, 50, 50, -0.75, 1, 1, () => { line(g, [0, 34, 0, -24], '#fff8d0', 5); poly(g, [-8, -20, 0, -38, 8, -20], '#ffffff', INK, 1.6); poly(g, [-8, 36, 0, 26, 8, 36], light, INK, 1.4); }); glow(g, 50, 50, 30, c, 0.4); break;
    case 'shield': shieldGlyph(g, 50, 50, 0.95, shade(c, -0.15), light, () => star(g, 0, 0, 9, 4, 4, '#ffffff', null)); break;
    case 'mirror': ell(g, 50, 46, 22, 28, rgrad(g, 44, 38, 2, 30, [[0, '#ffffff'], [1, light]]), INK, 2.6); line(g, [40, 30, 48, 24], '#ffffff', 3); rect(g, 46, 74, 8, 14, '#c8a040', INK, 1.6); break;
    case 'dispel': circ(g, 50, 50, 28, null, '#ffffff', 5); line(g, [30, 70, 70, 30], '#ffffff', 5); circ(g, 50, 50, 28, null, c, 2); break;
    case 'ankh': { g.beginPath(); g.ellipse(50, 32, 11, 15, 0, 0, Math.PI * 2); g.strokeStyle = INK; g.lineWidth = 9; g.stroke(); g.strokeStyle = '#ffe070'; g.lineWidth = 5; g.stroke(); limb(g, [50, 46, 50, 86], '#ffe070', 6); limb(g, [30, 52, 70, 52], '#ffe070', 6); glow(g, 50, 50, 34, '#fff0a0', 0.4); break; }
    case 'heart': glow(g, 50, 52, 34, '#ff7090', 0.4); blob(g, [50, 82, 22, 52, 26, 30, 42, 26, 50, 38, 58, 26, 74, 30, 78, 52], '#e84a6a', INK, 2.4); line(g, [36, 38, 42, 34], '#ffffff', 3); break;
    case 'up': case 'down': {
      const d = glyph === 'up' ? -1 : 1;
      const col = glyph === 'up' ? '#7ae07a' : '#e05a4a';
      poly(g, [50, 50 + d * 34, 76, 50 + d * 6, 60, 50 + d * 6, 60, 50 - d * 30, 40, 50 - d * 30, 40, 50 + d * 6, 24, 50 + d * 6], col, INK, 2.4);
      const sub = r.i(0, 3);
      if (sub === 0) swordGlyph(g, 74, 74, 0.32);
      else if (sub === 1) shieldGlyph(g, 76, 76, 0.32, '#5a6a9a');
      else if (sub === 2) star(g, 76, 76, 9, 4, 5, '#ffe070', INK, 1.2);
      else circ(g, 76, 76, 8, '#c060ff', INK, 1.4);
      break;
    }
    case 'wing': for (const d of [-1, 1]) blob(g, [50, 52, 50 + d * 14, 24, 50 + d * 36, 18, 50 + d * 38, 40, 50 + d * 26, 62], '#f8f4e8', INK, 2.2); break;
    case 'snail': circ(g, 54, 48, 20, '#b08a5a', INK, 2.4); g.beginPath(); g.arc(54, 48, 10, 0, Math.PI * 1.6); g.strokeStyle = INK; g.lineWidth = 2; g.stroke(); poly(g, [20, 72, 74, 72, 70, 64, 30, 62], '#8ab06a', INK, 2); line(g, [26, 62, 22, 50], INK, 2); break;
    case 'eye': ell(g, 50, 50, 32, 20, '#fffbe8', INK, 2.6); circ(g, 50, 50, 12, c, INK, 2); circ(g, 50, 50, 5, INK, null); circ(g, 46, 46, 2.4, '#ffffff', null); break;
    case 'spiral': for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(50, 50, 10 + i * 9, i, i + 4.4); g.strokeStyle = i % 2 ? '#ffffff' : light; g.lineWidth = 4; g.stroke(); } break;
    case 'chain': for (let i = 0; i < 4; i++) ell(g, 26 + i * 16, 50 + (i % 2 ? -4 : 4), 10, 7, null, '#c8ccd4', 4, i % 2 ? 0.5 : -0.5); break;
    case 'portal': ell(g, 50, 50, 22, 32, rgrad(g, 50, 50, 2, 32, [[0, '#ffffff'], [0.5, light], [1, c]]), INK, 2.6); for (let i = 0; i < 2; i++) { g.beginPath(); g.arc(50, 50, 8 + i * 8, i * 2, i * 2 + 3.6); g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.stroke(); } break;
    case 'boat': poly(g, [18, 60, 82, 60, 70, 76, 30, 76], '#8a5a2a', INK, 2.4); line(g, [50, 60, 50, 22], INK, 3); poly(g, [52, 24, 74, 52, 52, 54], '#f0ece0', INK, 2); if (sp.id.includes('scuttle')) line(g, [24, 30, 76, 82], '#e05a4a', 5); break;
    case 'wave': for (let i = 0; i < 3; i++) curve(g, [18, 40 + i * 14, 34, 32 + i * 14, 50, 40 + i * 14, 66, 32 + i * 14, 82, 40 + i * 14], '#ffffff', 4); break;
    case 'wall': for (let row = 0; row < 3; row++) for (let i = 0; i < 3; i++) rect(g, 20 + i * 20 + (row % 2) * 10 - 5, 66 - row * 16, 18, 14, sp.id.includes('fire') ? '#ff8a20' : light, INK, 1.8); break;
    case 'mine': circ(g, 50, 56, 18, '#4a4a52', INK, 2.4); for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; line(g, [50 + Math.cos(a) * 18, 56 + Math.sin(a) * 18, 50 + Math.cos(a) * 26, 56 + Math.sin(a) * 26], INK, 3); } star(g, 50, 26, 8, 3, 6, '#ffe070', null); break;
    case 'quake': poly(g, [14, 64, 40, 56, 50, 66, 62, 52, 86, 60, 86, 86, 14, 86], '#8a7a5a', INK, 2.2); line(g, [50, 20, 44, 36, 56, 44, 48, 60], '#ffffff', 3); break;
    case 'clone': for (const [x, a] of [[40, 1], [60, 0.5]]) { circ(g, x, 36, 9, alpha('#ffffff', a), INK, 2); poly(g, [x - 12, 76, x - 9, 48, x + 9, 48, x + 12, 76], alpha('#ffffff', a), INK, 2); } break;
    case 'elemental': { const ec = SCHOOL_HEX[sp.school] || c; glow(g, 50, 50, 34, ec, 0.6); blob(g, [34, 82, 30, 52, 40, 30, 50, 18, 60, 30, 70, 52, 66, 82], shade(ec, 0.2), INK, 2.4); for (const x of [44, 56]) circ(g, x, 40, 3, '#ffffff', null); break; }
    default: star(g, 50, 50, 30, 12, 5, light, INK, 2.2);
  }
}

function paintSpell(g, sp) {
  const c = SCHOOL_HEX[sp.school] || SCHOOL_HEX.all;
  const r = seeded(`spell:${sp.id}`);
  rrect(g, 3, 3, 94, 94, 10, rgrad(g, 50, 44, 6, 70, [[0, shade(c, 0.1)], [1, shade(c, -0.6)]]), INK, 3);
  for (let i = 0; i < 6; i++) star(g, r.f(12, 88), r.f(12, 88), r.f(1.5, 3), 0.8, 4, alpha('#ffffff', 0.55), null);
  drawGlyph(g, glyphFor(sp), c, sp, r);
  rrect(g, 6, 6, 88, 88, 8, null, alpha(UI_HEX.gold, 0.9), 2);
  const lvl = sp.level || 0;
  for (let i = 0; i < lvl; i++) circ(g, 50 - (lvl - 1) * 5 + i * 10, 91, 3, '#f6e08a', INK, 1);
}

/** opts.size = px. */
export function spellHandler(id) {
  const sp = SPELL_BY_ID[id] || { id, school: 'all', category: 'utility', level: 0 };
  return { dw: 100, dh: 100, unit: 100, size: 48, key: '', paint: (g) => paintSpell(g, sp) };
}

// ---------------------------------------------------------------------------------------------
// Skills (secondary + primary)
// ---------------------------------------------------------------------------------------------

const SKILL_GLYPH = {
  pathfinding: (g) => { for (const [x, y] of [[30, 76], [46, 62], [40, 44], [58, 32], [68, 18]]) ell(g, x, y, 6, 4, '#8a5a2a', INK, 1.6, -0.5); curve(g, [20, 86, 46, 60, 38, 44, 70, 18], alpha('#f0e0b0', 0.6), 4); },
  archery: (g) => { bowGlyph(g, 44, 50, 1, '#a06a3a'); at(g, 52, 50, -0.75, 1, 1, () => { line(g, [0, 34, 0, -26], '#d8c090', 3); poly(g, [-5, -24, 0, -36, 5, -24], STEEL, INK, 1.2); }); },
  logistics: (g) => { circ(g, 50, 50, 26, '#8a5a2a', INK, 2.4); circ(g, 50, 50, 18, '#c8a070', INK, 2); for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 4; line(g, [50 - Math.cos(a) * 18, 50 - Math.sin(a) * 18, 50 + Math.cos(a) * 18, 50 + Math.sin(a) * 18], '#6a4626', 3); } poly(g, [74, 30, 90, 40, 74, 50], '#f8f4e8', INK, 1.6); },
  scouting: (g) => { at(g, 50, 50, -0.5, 1, 1, () => { rrect(g, -32, -8, 64, 16, 4, vgrad(g, -8, 8, '#c8a040', 0.3), INK, 2); circ(g, 32, 0, 10, '#9ad0f0', INK, 2); rect(g, -10, -10, 4, 20, '#7a4a2a', null); }); },
  diplomacy: (g) => { rrect(g, 24, 24, 52, 52, 4, '#e8dcb0', INK, 2.2); for (let i = 0; i < 3; i++) line(g, [32, 36 + i * 10, 68, 36 + i * 10], alpha('#5a4020', 0.6), 2); circ(g, 64, 70, 10, '#c03a2a', INK, 2); },
  navigation: (g) => { circ(g, 50, 50, 20, null, '#8a5a2a', 6); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; limb(g, [50 + Math.cos(a) * 14, 50 + Math.sin(a) * 14, 50 + Math.cos(a) * 32, 50 + Math.sin(a) * 32], '#a0703a', 4); } circ(g, 50, 50, 6, '#e8c040', INK, 1.6); },
  leadership: (g) => { line(g, [36, 88, 36, 14], '#6a4626', 5); poly(g, [38, 16, 80, 24, 70, 38, 80, 52, 38, 50], '#c03a2a', INK, 2.2); star(g, 56, 33, 8, 3.4, 5, '#e8c040', null); },
  wisdom: (g) => { bookGlyph(g, 50, 52, 0.9, '#3a5aa0', null); glow(g, 50, 24, 20, '#fff0a0', 0.7); star(g, 50, 24, 8, 3, 6, '#ffffff', null); },
  mysticism: (g) => { glow(g, 50, 50, 34, '#5a8ae8', 0.6); star(g, 50, 50, 28, 10, 8, '#9ac0ff', INK, 2); circ(g, 50, 50, 8, '#ffffff', null); },
  luck: (g) => SKILL_GLYPH._clover(g),
  _clover: (g) => { for (let i = 0; i < 4; i++) at(g, 50, 46, (i * Math.PI) / 2 + 0.78, 1, 1, () => blob(g, [0, 0, -12, -14, 0, -26, 12, -14], '#3cae4a', INK, 2)); line(g, [50, 50, 60, 84], '#2a7a2a', 4); },
  ballistics: (g) => { poly(g, [16, 74, 84, 74, 78, 64, 22, 64], '#8a5a2a', INK, 2); limb(g, [44, 64, 70, 22], '#a0703a', 6); circ(g, 72, 18, 8, '#8a8278', INK, 2); for (const x of [30, 70]) circ(g, x, 78, 8, '#5a3a1e', INK, 2); },
  eagle_eye: (g) => { for (const d of [-1, 1]) blob(g, [50, 50, 50 + d * 14, 28, 50 + d * 38, 24, 50 + d * 36, 44], '#a07a4a', INK, 2); ell(g, 50, 54, 16, 10, '#fffbe8', INK, 2); circ(g, 50, 54, 6, '#e8a020', INK, 1.4); circ(g, 50, 54, 2.4, INK, null); },
  necromancy: (g) => { glow(g, 50, 46, 34, '#60ff90', 0.4); circ(g, 50, 44, 22, '#ece6d0', INK, 2.4); rrect(g, 40, 60, 20, 12, 2, '#dcd4bc', INK, 2); for (const x of [41, 59]) ell(g, x, 44, 6, 7, INK, null); for (const x of [41, 59]) circ(g, x, 44, 2.4, '#60ff90', null); },
  estates: (g) => { blob(g, [26, 80, 22, 54, 36, 34, 50, 30, 64, 34, 78, 54, 74, 80], vgrad(g, 30, 80, '#a0703a', 0.25), INK, 2.4); rect(g, 40, 24, 20, 8, '#7a4a2a', INK, 2); resourceGlyph(g, 'gold', 50, 62, 30); },
  fire_magic: (g) => drawGlyph(g, 'flame', SCHOOL_HEX.fire, { id: '' }, seeded('f')),
  air_magic: (g) => drawGlyph(g, 'bolt', SCHOOL_HEX.air, { id: '' }, seeded('a')),
  water_magic: (g) => { glow(g, 50, 54, 30, '#5aa0ff', 0.5); blob(g, [50, 14, 70, 50, 66, 74, 50, 84, 34, 74, 30, 50], vgrad(g, 14, 84, '#5aa0ff', 0.3), INK, 2.4); line(g, [40, 56, 42, 70], '#ffffff', 3); },
  earth_magic: (g) => { for (const [x, y, s] of [[38, 66, 18], [64, 62, 14], [50, 40, 16]]) poly(g, [x - s, y + s * 0.5, x - s * 0.5, y - s * 0.8, x + s * 0.6, y - s * 0.6, x + s, y + s * 0.5], '#8a7a4a', INK, 2.2); line(g, [20, 82, 80, 82], '#5a4a2a', 4); },
  scholar: (g) => { rrect(g, 26, 26, 44, 50, 3, '#e8dcb0', INK, 2.2); for (let i = 0; i < 4; i++) line(g, [32, 36 + i * 9, 62, 36 + i * 9], alpha('#5a4020', 0.6), 1.8); at(g, 66, 40, 0.6, 1, 1, () => { blob(g, [0, -30, 8, -8, 2, 20, -2, 20, -8, -8], '#f8f4e8', INK, 1.8); }); },
  tactics: (g) => { rect(g, 20, 20, 60, 60, '#d8c8a0', INK, 2); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) rect(g, 20 + i * 15, 20 + j * 15, 15, 15, '#8a6a4a', null); poly(g, [30, 70, 52, 48, 46, 44, 66, 34, 62, 54, 56, 50, 36, 74], '#c03a2a', INK, 2); },
  artillery: (g) => { at(g, 52, 48, -0.4, 1, 1, () => { rrect(g, -30, -9, 56, 18, 6, vgrad(g, -9, 9, '#c08a3a', 0.35), INK, 2.2); rect(g, 24, -11, 6, 22, '#9a6a2a', INK, 1.6); }); for (const x of [40]) circ(g, x, 66, 14, '#6a4626', INK, 2.4); },
  learning: (g) => { for (let i = 0; i < 3; i++) rrect(g, 24 + i * 4, 66 - i * 14, 52 - i * 8, 12, 2, ['#7a2a2a', '#2a5a3a', '#3a4a8a'][i], INK, 2); star(g, 50, 22, 10, 4, 5, '#e8c040', INK, 1.4); },
  offense: (g) => { swordGlyph(g, 44, 54, 0.95); swordGlyph(g, 56, 54, 0.95, STEEL, '#e8c040', Math.PI / 4); },
  armorer: (g) => armorGlyph(g, 50, 52, 0.95, '#b8bcc8', '#e8c040', 'plate'),
  intelligence: (g) => { glow(g, 50, 46, 34, '#c080ff', 0.5); blob(g, [26, 50, 30, 28, 50, 20, 70, 28, 74, 50, 64, 66, 36, 66], '#e8a0b8', INK, 2.4); for (const y of [36, 48]) curve(g, [32, y, 44, y - 6, 56, y + 4, 68, y - 4], shade('#e8a0b8', -0.3), 2); },
  sorcery: (g) => { at(g, 44, 58, -0.7, 1, 1, () => limb(g, [0, 30, 0, -24], '#5a3a8a', 6)); glow(g, 62, 34, 22, '#ffe070', 0.7); star(g, 62, 34, 14, 5, 5, '#fff8b0', INK, 1.6); },
  resistance: (g) => { shieldGlyph(g, 50, 52, 0.95, '#5a6a9a', '#e8c040', () => { circ(g, 0, 0, 10, null, '#c080ff', 3); line(g, [-8, 8, 8, -8], '#c080ff', 3); }); },
  first_aid: (g) => { poly(g, [18, 80, 26, 50, 50, 22, 74, 50, 82, 80], '#f0ece0', INK, 2.4); rect(g, 44, 46, 12, 30, '#d03a3a', null); rect(g, 35, 55, 30, 12, '#d03a3a', null); },
  interference: (g) => { star(g, 50, 50, 28, 12, 6, '#9ac0ff', INK, 2); line(g, [24, 76, 76, 24], '#e05a4a', 7); line(g, [24, 76, 76, 24], '#ffb0a0', 2); },
  attack: (g) => swordGlyph(g, 50, 52, 1.05, STEEL, '#e8c040', -Math.PI / 4),
  defense: (g) => shieldGlyph(g, 50, 50, 1, '#5a6a9a', '#e8c040', () => star(g, 0, 0, 8, 3.4, 4, '#e8c040', null)),
  power: (g) => { glow(g, 50, 50, 36, '#c080ff', 0.6); circ(g, 50, 50, 22, rgrad(g, 44, 42, 2, 26, [[0, '#ffffff'], [0.4, '#c080ff'], [1, '#4a2a8a']]), INK, 2.4); poly(g, [54, 30, 42, 52, 52, 52, 46, 70, 62, 46, 52, 46, 58, 30], '#fff8a0', '#e8a020', 1.6); },
  knowledge: (g) => { bookGlyph(g, 50, 50, 0.95, '#3a5aa0', '#5aa0ff'); },
};

const LEVELS = { basic: 1, advanced: 2, expert: 3 };

function paintSkill(g, id, lvl) {
  const prim = PRIMARY_SKILLS.includes(id);
  const bg = prim ? '#3a2a1a' : '#2a3a4a';
  const border = [UI_HEX.gold, '#b07840', '#c8ccd4', '#f6d860'][lvl];
  rrect(g, 3, 3, 94, 94, 10, rgrad(g, 50, 42, 6, 70, [[0, shade(bg, 0.35)], [1, shade(bg, -0.4)]]), INK, 3);
  (SKILL_GLYPH[id] || ((gg) => star(gg, 50, 50, 26, 10, 7, '#e8c040', INK, 2)))(g);
  rrect(g, 6, 6, 88, 88, 8, null, border, lvl ? 3.4 : 2);
  for (let i = 0; i < lvl; i++) star(g, 50 - (lvl - 1) * 9 + i * 18, 90, 5, 2.2, 5, border, INK, 1);
}

/** opts.state / opts.variant = 'basic'|'advanced'|'expert' or 1..3 (level border), 0/none = plain. */
export function skillHandler(id, o) {
  const raw = o.state ?? o.variant;
  const lvl = typeof raw === 'number' ? Math.max(0, Math.min(3, raw | 0)) : LEVELS[raw] || 0;
  return { dw: 100, dh: 100, unit: 100, size: 44, key: `${lvl}`, paint: (g) => paintSkill(g, id, lvl) };
}

// ---------------------------------------------------------------------------------------------
// Resources & stat pips
// ---------------------------------------------------------------------------------------------

function paintResource(g, id, v) {
  if (RESOURCES.includes(id)) {
    resourceGlyph(g, id, 50, 56, 84);
    return;
  }
  switch (id) {
    case 'gold_pile': resourceGlyph(g, 'gold', 50, 56, 90); resourceGlyph(g, 'gems', 70, 70, 30); break;
    case 'movement': bootGlyph(g, 50, 50, 1.1, '#7a4a2a', '#e8c040', true); break;
    case 'mana': glow(g, 50, 52, 40, '#5a8ae8', 0.6); blob(g, [50, 10, 74, 52, 68, 80, 50, 88, 32, 80, 26, 52], vgrad(g, 10, 88, '#5a8ae8', 0.35), INK, 3); line(g, [40, 58, 42, 72], '#ffffff', 4); break;
    case 'experience': glow(g, 50, 50, 40, '#ffe070', 0.6); star(g, 50, 52, 40, 17, 5, vgrad(g, 10, 90, '#f6d860', 0.3), INK, 3); break;
    case 'morale': case 'luck': {
      const val = Math.max(-3, Math.min(3, v | 0));
      const good = val > 0;
      const bad = val < 0;
      const c = good ? '#4ac04a' : bad ? '#d04a3a' : '#c8b890';
      rrect(g, 4, 4, 92, 92, 12, shade(c, -0.6), INK, 3);
      const n = Math.max(1, Math.abs(val));
      for (let i = 0; i < n; i++) {
        const x = 50 - (n - 1) * 15 + i * 30;
        const s = n === 1 ? 1 : 0.62;
        if (id === 'luck') at(g, x, 50, 0, s, s, () => { for (let k = 0; k < 4; k++) at(g, 0, -4, (k * Math.PI) / 2 + 0.78, 1, 1, () => blob(g, [0, 0, -12, -14, 0, -26, 12, -14], bad ? '#7a6a4a' : val === 0 ? '#b8b090' : '#3cae4a', INK, 2.4)); line(g, [0, 2, 8, 34], '#2a5a2a', 4); });
        else at(g, x, 50, bad ? Math.PI : 0, s, s, () => { poly(g, [0, -34, 26, 0, 10, 0, 10, 30, -10, 30, -10, 0, -26, 0], val === 0 ? '#c8b890' : c, INK, 3); });
      }
      if (val === 0) line(g, [20, 80, 80, 80], '#c8b890', 4);
      break;
    }
    default: star(g, 50, 50, 30, 12, 5, '#c0c0c0', INK, 2);
  }
}

/** ids: RESOURCES + movement|mana|experience|gold_pile|morale|luck. morale/luck: opts.variant = -3..3. */
export function resourceHandler(id, o) {
  const v = id === 'morale' || id === 'luck' ? Math.max(-3, Math.min(3, o.variant | 0)) : 0;
  return { dw: 100, dh: 100, unit: 100, size: 24, key: `${v}`, paint: (g) => paintResource(g, id, v) };
}

export { hashStr, mix, rect, ell };
