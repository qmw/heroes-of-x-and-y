// `ui` kind: skin pieces (9-slice panels, buttons, scrollbar, checkbox), cursors, hourglass, flag,
// combat hex highlights, adventure path arrows, tile cursor / selection, empty artifact slots.
// Each id has a natural design size; opts.size = pixel HEIGHT.

import { ARTIFACT_SLOTS } from '../core/constants.js';
import { INK, alpha, at, blob, circ, curve, ell, flag, glow, lgrad, line, paint, poly, rect, rgrad, rrect, seeded, shade, star, vgrad } from './kit.js';
import { playerColorHex, UI_HEX } from './palette.js';
import { DIRS8 } from './terrain.js';

/** 9-slice geometry of panel / button sprites (design units = pixels at size = h). */
export const NINE_SLICE = { panel: { size: 48, border: 14 }, button: { w: 96, h: 32, border: 10 } };

const PANEL_STYLES = { parchment: ['#e2cf9f', '#b89c66'], stone: ['#6a6660', '#3a3834'], gold: ['#d8ad45', '#7c5a1c'], dark: ['#2a2420', '#14100c'] };
const CURSORS = ['arrow', 'sword', 'horse', 'boot', 'bow', 'spell', 'question', 'hand', 'anchor', 'no', 'town', 'trade', 'hero', 'attack', 'wait'];
const HEX_STATES = ['grid', 'move', 'attack', 'target', 'active', 'hover', 'shade', 'blocked'];

export const UI_IDS = [
  ...Object.keys(PANEL_STYLES).map((s) => `panel_${s}`), 'button', 'button_round', 'scrollbar_track', 'scrollbar_thumb', 'scroll_up', 'scroll_down',
  'checkbox', 'arrow_left', 'arrow_right', 'arrow_up', 'arrow_down', 'close', 'ok', 'cancel', 'hourglass', 'flag',
  ...CURSORS.map((c) => `cursor_${c}`), 'hex', 'path_arrow', 'path_dest', 'grid_cursor', 'selection', 'slot_empty', 'divider',
];

const SIZES = {
  button: [96, 32], button_round: [32, 32], scrollbar_track: [16, 48], scrollbar_thumb: [16, 32], scroll_up: [16, 16], scroll_down: [16, 16],
  checkbox: [20, 20], arrow_left: [24, 24], arrow_right: [24, 24], arrow_up: [24, 24], arrow_down: [24, 24], close: [32, 32], ok: [32, 32],
  cancel: [32, 32], hourglass: [32, 32], flag: [32, 32], hex: [44, 50], path_arrow: [32, 32], path_dest: [32, 32], grid_cursor: [32, 32],
  selection: [32, 32], slot_empty: [44, 44], divider: [96, 8],
};

function panel(g, style) {
  const [c0, c1] = PANEL_STYLES[style] || PANEL_STYLES.parchment;
  const S = 48;
  rect(g, 0, 0, S, S, lgrad(g, 0, 0, S, S, [[0, shade(c0, 0.08)], [1, shade(c0, -0.1)]]), null);
  const r = seeded(`panel:${style}`);
  for (let i = 0; i < 40; i++) rect(g, r.f(14, 33), r.f(14, 33), 1, 1, alpha(c1, 0.25), null);
  rect(g, 1, 1, S - 2, S - 2, null, INK, 2);
  rect(g, 3.5, 3.5, S - 7, S - 7, null, style === 'parchment' ? '#7c5a1c' : UI_HEX.gold, 3);
  rect(g, 5.5, 5.5, S - 11, S - 11, null, style === 'parchment' ? UI_HEX.goldLight : UI_HEX.goldLight, 1);
  rect(g, 8, 8, S - 16, S - 16, null, alpha(INK, 0.4), 1);
  for (const [x, y] of [[5, 5], [43, 5], [5, 43], [43, 43]]) {
    circ(g, x, y, 4, UI_HEX.gold, INK, 1);
    circ(g, x - 1, y - 1, 1.3, '#fff4c0', null);
  }
}

function button(g, state, W, H, round) {
  const pressed = state === 'pressed';
  const dis = state === 'disabled';
  const base = dis ? '#5a5048' : state === 'hover' ? '#8a5a2a' : '#6a4422';
  const grd = lgrad(g, 0, 0, 0, H, pressed ? [[0, shade(base, -0.3)], [1, shade(base, 0.1)]] : [[0, shade(base, 0.3)], [0.5, base], [1, shade(base, -0.35)]]);
  if (round) {
    circ(g, W / 2, H / 2, W / 2 - 1, grd, INK, 2);
    circ(g, W / 2, H / 2, W / 2 - 3.5, null, dis ? '#8a8070' : UI_HEX.gold, 2);
  } else {
    rrect(g, 1, 1, W - 2, H - 2, 5, grd, INK, 2);
    rrect(g, 3.5, 3.5, W - 7, H - 7, 3.5, null, dis ? '#8a8070' : state === 'hover' ? UI_HEX.goldLight : UI_HEX.gold, 1.8);
    if (!pressed) line(g, [8, 6, W - 8, 6], alpha('#ffffff', dis ? 0.1 : 0.3), 1.4);
  }
  if (state === 'hover') glow(g, W / 2, H / 2, W * 0.5, '#ffe080', 0.18);
}

function arrowShape(g, dir, c = UI_HEX.goldLight) {
  at(g, 12, 12, { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir], 1, 1, () => poly(g, [-6, -8, 8, 0, -6, 8, -3, 0], c, INK, 1.6));
}

function cursor(g, kind, frame) {
  switch (kind) {
    case 'arrow': poly(g, [2, 2, 2, 24, 8, 18, 13, 28, 17, 26, 12, 16, 20, 16], '#f6e08a', INK, 1.8); break;
    case 'sword': case 'attack': at(g, 16, 16, -Math.PI / 4, 0.38, 0.38, () => {
      poly(g, [-4, -30, 0, -38, 4, -30, 4, 12, -4, 12], '#e8ecf4', INK, 3); rrect(g, -13, 12, 26, 5, 2, '#e8c040', INK, 3); rect(g, -2.6, 17, 5.2, 12, '#6a4626', INK, 2.4);
    }); if (kind === 'attack') star(g, 26, 26, 5, 2, 6, '#ff7050', INK, 1); break;
    case 'horse': blob(g, [6, 26, 6, 14, 14, 6, 24, 4, 28, 12, 22, 14, 18, 26], '#a07a4a', INK, 1.6); circ(g, 22, 8, 1.2, INK, null); break;
    case 'boot': poly(g, [8, 4, 18, 4, 18, 20, 28, 22, 28, 28, 8, 28], '#8a5a2a', INK, 1.6); break;
    case 'bow': { g.beginPath(); g.moveTo(6, 4); g.quadraticCurveTo(28, 16, 6, 28); g.strokeStyle = INK; g.lineWidth = 4; g.stroke(); g.strokeStyle = '#a06a3a'; g.lineWidth = 2; g.stroke(); line(g, [6, 4, 6, 28], '#f0e8d0', 1); line(g, [6, 16, 28, 16], '#d8c090', 1.6); poly(g, [26, 13, 31, 16, 26, 19], '#d4d8e0', INK, 0.8); break; }
    case 'spell': glow(g, 16, 16, 14, '#9ac0ff', 0.7); star(g, 16, 16, 12, 5, 5, '#cfe0ff', INK, 1.4); break;
    case 'question': circ(g, 16, 16, 13, '#f6e08a', INK, 1.8); g.fillStyle = INK; g.font = 'bold 18px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 16, 17); break;
    case 'hand': blob(g, [8, 30, 6, 16, 10, 14, 12, 4, 16, 4, 16, 12, 20, 10, 24, 12, 26, 18, 24, 30], '#f0c8a0', INK, 1.6); break;
    case 'anchor': line(g, [16, 6, 16, 26], INK, 4); line(g, [16, 6, 16, 26], '#8a8e98', 2); curve(g, [6, 18, 10, 28, 16, 28, 22, 28, 26, 18], INK, 4); curve(g, [6, 18, 10, 28, 16, 28, 22, 28, 26, 18], '#8a8e98', 2); circ(g, 16, 5, 3, null, '#8a8e98', 2); break;
    case 'no': circ(g, 16, 16, 12, null, INK, 6); circ(g, 16, 16, 12, null, '#e04a3a', 3.4); line(g, [8, 24, 24, 8], '#e04a3a', 3.4); break;
    case 'town': poly(g, [4, 28, 4, 14, 10, 8, 16, 14, 16, 6, 22, 2, 28, 6, 28, 28], '#c8c0b0', INK, 1.6); rect(g, 13, 20, 6, 8, '#4a3020', null); break;
    case 'trade': circ(g, 11, 16, 8, '#e8c040', INK, 1.6); circ(g, 21, 16, 8, '#c8ccd4', INK, 1.6); break;
    case 'hero': circ(g, 16, 8, 5, '#f0c8a0', INK, 1.4); poly(g, [8, 28, 10, 15, 22, 15, 24, 28], '#3f6fb5', INK, 1.4); break;
    case 'wait': hourglass(g, frame); break;
    default: break;
  }
}

function hourglass(g, frame) {
  const k = (frame % 4) / 3;
  rect(g, 6, 2, 20, 4, '#7a4a2a', INK, 1.4);
  rect(g, 6, 26, 20, 4, '#7a4a2a', INK, 1.4);
  poly(g, [8, 6, 24, 6, 17, 16, 24, 26, 8, 26, 15, 16], alpha('#d8e8f0', 0.7), INK, 1.4);
  poly(g, [10 + k * 4, 6 + k * 8, 22 - k * 4, 6 + k * 8, 16, 15], '#e8c860', null);
  poly(g, [9, 26, 23, 26, 16, 26 - k * 8], '#e8c860', null);
  line(g, [16, 16, 16, 25], alpha('#e8c860', 0.9), 0.8);
}

function hex(g, state) {
  const W = 44;
  const H = 50;
  const pts = [W / 2, 1, W - 1, H * 0.25, W - 1, H * 0.75, W / 2, H - 1, 1, H * 0.75, 1, H * 0.25];
  const col = { grid: null, move: '#60c0ff', attack: '#ff5040', target: '#ffd040', active: '#f6e08a', hover: '#ffffff', shade: '#000000', blocked: '#800000' }[state];
  if (state === 'grid') { poly(g, pts, null, alpha('#000000', 0.35), 1.2); return; }
  if (state === 'shade') { poly(g, pts, alpha('#000000', 0.3), alpha('#000000', 0.45), 1); return; }
  poly(g, pts, alpha(col, state === 'hover' ? 0.18 : 0.28), alpha(col, 0.95), state === 'active' ? 3 : 2);
  if (state === 'active') poly(g, pts.map((v, i) => (i % 2 ? H / 2 + (v - H / 2) * 0.82 : W / 2 + (v - W / 2) * 0.82)), null, alpha('#ffffff', 0.6), 1);
}

function pathArrow(g, dir, state, dest) {
  const c = state === 'unreachable' ? '#e04a3a' : state === 'next' ? '#f0c040' : '#4ad04a';
  if (dest) {
    for (const [a, b] of [[[9, 9], [23, 23]], [[23, 9], [9, 23]]]) { line(g, [...a, ...b], INK, 7); line(g, [...a, ...b], c, 4); }
    return;
  }
  const [dx, dy] = DIRS8[((dir | 0) % 8 + 8) % 8];
  at(g, 16, 16, Math.atan2(dy, dx), 1, 1, () => {
    poly(g, [-9, -3, 2, -3, 2, -8, 11, 0, 2, 8, 2, 3, -9, 3], c, INK, 1.6);
  });
}

const SLOT_SIL = {
  head: (g) => { g.beginPath(); g.arc(22, 24, 12, Math.PI, 0); g.lineTo(34, 30); g.lineTo(10, 30); g.closePath(); },
  neck: (g) => { g.beginPath(); g.arc(22, 26, 7, 0, Math.PI * 2); },
  torso: (g) => { g.beginPath(); g.rect(13, 12, 18, 22); },
  shoulders: (g) => { g.beginPath(); g.moveTo(16, 10); g.lineTo(28, 10); g.lineTo(34, 34); g.lineTo(10, 34); g.closePath(); },
  right_hand: (g) => { g.beginPath(); g.moveTo(30, 8); g.lineTo(34, 10); g.lineTo(16, 30); g.lineTo(13, 27); g.closePath(); },
  left_hand: (g) => { g.beginPath(); g.moveTo(12, 10); g.lineTo(32, 10); g.quadraticCurveTo(32, 28, 22, 35); g.quadraticCurveTo(12, 28, 12, 10); g.closePath(); },
  ring: (g) => { g.beginPath(); g.arc(22, 24, 8, 0, Math.PI * 2); },
  feet: (g) => { g.beginPath(); g.moveTo(15, 10); g.lineTo(24, 10); g.lineTo(24, 26); g.lineTo(32, 28); g.lineTo(32, 34); g.lineTo(15, 34); g.closePath(); },
  misc: (g) => { g.beginPath(); g.arc(22, 22, 9, 0, Math.PI * 2); },
  war_machine: (g) => { g.beginPath(); g.arc(16, 30, 5, 0, Math.PI * 2); g.arc(30, 30, 5, 0, Math.PI * 2); g.rect(10, 18, 24, 8); },
  spellbook: (g) => { g.beginPath(); g.rect(13, 10, 18, 24); },
};

function paintUi(g, id, o, W, H) {
  const st = o.state;
  if (id.startsWith('panel_')) return panel(g, id.slice(6));
  if (id.startsWith('cursor_')) return cursor(g, id.slice(7), o.frame | 0);
  switch (id) {
    case 'button': return button(g, st, W, H, false);
    case 'button_round': return button(g, st, W, H, true);
    case 'scrollbar_track': rect(g, 1, 0, 14, 48, lgrad(g, 0, 0, 16, 0, [[0, '#2a2018'], [0.5, '#3a3028'], [1, '#2a2018']]), INK, 1.4); return line(g, [8, 2, 8, 46], alpha('#000000', 0.4), 2);
    case 'scrollbar_thumb': return button(g, st || 'normal', W, H, false);
    case 'scroll_up': case 'scroll_down': button(g, st, 16, 16, false); return at(g, 8, 8, id === 'scroll_up' ? -Math.PI / 2 : Math.PI / 2, 0.5, 0.5, () => poly(g, [-6, -8, 8, 0, -6, 8], UI_HEX.goldLight, INK, 2));
    case 'checkbox': rrect(g, 1, 1, 18, 18, 3, lgrad(g, 0, 0, 0, 20, [[0, '#4a3828'], [1, '#2a2018']]), INK, 1.6); rrect(g, 3, 3, 14, 14, 2, null, UI_HEX.gold, 1.2); if (st === 'checked' || st === true) { line(g, [5, 10, 9, 15, 16, 4], INK, 4); line(g, [5, 10, 9, 15, 16, 4], '#7ae07a', 2.4); } return;
    case 'arrow_left': case 'arrow_right': case 'arrow_up': case 'arrow_down': return arrowShape(g, id.slice(6), st === 'disabled' ? '#8a8070' : UI_HEX.goldLight);
    case 'close': case 'cancel': button(g, st, 32, 32, true); line(g, [11, 11, 21, 21], '#e86a5a', 3.4); return line(g, [21, 11, 11, 21], '#e86a5a', 3.4);
    case 'ok': button(g, st, 32, 32, true); line(g, [10, 17, 14, 22, 23, 10], INK, 5); return line(g, [10, 17, 14, 22, 23, 10], '#7ae07a', 3);
    case 'hourglass': return hourglass(g, o.frame | 0);
    case 'flag': return flag(g, 9, 30, 26, playerColorHex(o.playerColor), 1, o.frame | 0);
    case 'hex': return hex(g, HEX_STATES.includes(st) ? st : 'grid');
    case 'path_arrow': return pathArrow(g, o.variant, st, false);
    case 'path_dest': return pathArrow(g, 0, st, true);
    case 'grid_cursor': rect(g, 1, 1, 30, 30, null, INK, 3); return rect(g, 1, 1, 30, 30, null, '#f6e08a', 1.6);
    case 'selection': for (const [x, y, sx, sy] of [[2, 2, 1, 1], [30, 2, -1, 1], [2, 30, 1, -1], [30, 30, -1, -1]]) { line(g, [x, y + sy * 9, x, y, x + sx * 9, y], INK, 4.4); line(g, [x, y + sy * 9, x, y, x + sx * 9, y], '#f6e08a', 2.4); } return;
    case 'slot_empty': {
      rrect(g, 1, 1, 42, 42, 4, lgrad(g, 0, 0, 0, 44, [[0, '#2a2420'], [1, '#14100c']]), INK, 1.6);
      rrect(g, 3, 3, 38, 38, 3, null, alpha(UI_HEX.gold, 0.6), 1.2);
      const sil = SLOT_SIL[o.variant] || SLOT_SIL.misc;
      sil(g);
      return paint(g, alpha('#c8b890', 0.18), alpha('#c8b890', 0.35), 1.2);
    }
    case 'divider': line(g, [2, 4, 94, 4], INK, 4); line(g, [2, 4, 94, 4], UI_HEX.gold, 2); return star(g, 48, 4, 4, 1.6, 4, UI_HEX.goldLight, INK, 0.8);
    default: return star(g, W / 2, H / 2, W * 0.4, W * 0.16, 5, UI_HEX.gold, INK, 1);
  }
}

/**
 * opts: size = pixel height; state (button normal|hover|pressed|disabled, checkbox checked,
 * hex grid|move|attack|target|active|hover|shade|blocked, path reachable|unreachable|next),
 * variant (path_arrow direction 0..7 in DIRS8 order; slot_empty slot id), frame, playerColor.
 */
export function uiHandler(id, o) {
  const [W, H] = id.startsWith('panel_') ? [48, 48] : id.startsWith('cursor_') ? [32, 32] : SIZES[id] || [32, 32];
  const pc = id === 'flag' ? playerColorHex(o.playerColor) : '';
  const frames = id === 'hourglass' || id === 'flag' || id === 'cursor_wait' ? 4 : 1;
  const frame = (((o.frame | 0) % frames) + frames) % frames;
  return {
    dw: W, dh: H, unit: H, size: H, frames,
    key: `${o.state ?? ''}|${o.variant ?? ''}|${frame}|${pc}`,
    paint: (g) => paintUi(g, id, { ...o, frame }, W, H),
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers for the UI shell (draw directly on a destination context)
// ---------------------------------------------------------------------------------------------

let getter = null;
export function setUiSpriteGetter(fn) {
  getter = fn;
}

function nine(ctx, src, sb, x, y, w, h, db) {
  const sw = src.width;
  const sh = src.height;
  const xs = [0, sb, sw - sb, sw];
  const ys = [0, sb, sh - sb, sh];
  const dxs = [x, x + db, x + w - db, x + w];
  const dys = [y, y + db, y + h - db, y + h];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const sW = xs[i + 1] - xs[i];
      const sH = ys[j + 1] - ys[j];
      const dW = dxs[i + 1] - dxs[i];
      const dH = dys[j + 1] - dys[j];
      if (sW > 0 && sH > 0 && dW > 0 && dH > 0) ctx.drawImage(src, xs[i], ys[j], sW, sH, dxs[i], dys[j], dW, dH);
    }
  }
}

/** 9-slice panel. style: parchment|stone|gold|dark. scale multiplies the border thickness. */
export function drawPanel(ctx, style, x, y, w, h, scale = 1) {
  const px = Math.round(48 * scale);
  const src = getter('ui', `panel_${style}`, { size: px });
  const b = Math.round(NINE_SLICE.panel.border * scale);
  nine(ctx, src, b, x, y, w, h, Math.min(b, w / 2, h / 2));
}

/** 9-slice button with optional centred label. opts: { state, label, font, color } */
export function drawButton(ctx, x, y, w, h, opts = {}) {
  const src = getter('ui', 'button', { size: Math.max(16, Math.round(h)), state: opts.state || 'normal' });
  const b = Math.round((NINE_SLICE.button.border * h) / NINE_SLICE.button.h);
  nine(ctx, src, b, x, y, w, h, Math.min(b, w / 2, h / 2));
  if (opts.label) {
    ctx.font = opts.font || `bold ${Math.round(h * 0.45)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.state === 'disabled' ? '#9a9080' : opts.color || UI_HEX.goldLight;
    ctx.fillText(opts.label, x + w / 2, y + h / 2 + (opts.state === 'pressed' ? 1 : 0));
  }
}

/**
 * Floating combat number. t = 0..1 animation progress (rises and fades).
 * opts: { color (default red for damage), size (px font), kind: 'damage'|'heal'|'info' }
 */
export function drawDamageNumber(ctx, text, x, y, opts = {}) {
  const t = Math.max(0, Math.min(1, opts.t ?? 0));
  const size = opts.size || 18;
  const color = opts.color || (opts.kind === 'heal' ? '#7ae07a' : opts.kind === 'info' ? '#f6e08a' : '#ff5a40');
  ctx.save();
  ctx.globalAlpha = 1 - t * t;
  ctx.font = `bold ${size}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(2, size / 6);
  ctx.strokeStyle = '#1a1410';
  const yy = y - t * size * 1.6;
  ctx.strokeText(String(text), x, yy);
  ctx.fillStyle = color;
  ctx.fillText(String(text), x, yy);
  ctx.restore();
}

export { ARTIFACT_SLOTS, vgrad, rgrad, ell };
