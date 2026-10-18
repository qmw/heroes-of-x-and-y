// Adventure screen dialogs: info popups, puzzle map, world view, cast-spell book, quest log,
// system / adventure menus, thieves' guild, combat result and game over. Spec: ui-adventure.md.
import { h, fmt } from '../../kit/dom.js';
import { openDialog, choose, message } from '../../kit/dialog.js';
import { SpellbookView } from '../../kit/spellbook.js';
import { sprite } from '../../sprites.js';
import { TERRAIN_BY_ID } from '../../../data/terrain.js';
import { SPELL_BY_ID } from '../../../data/spells.js';
import { minimapPixels, puzzleWindow, playerName, creatureName, humanizeId } from './model.js';

// ---- right-click info --------------------------------------------------------------------------

/** DOM for a `describeTile` model. */
export function infoNode(model) {
  if (!model) return null;
  return h('div.adv-info', { class: `adv-info-${model.kind}` },
    h('div.adv-info-title', null, model.title),
    (model.lines || []).map((l) => h('div.adv-info-line', null, l)),
    model.army && model.army.length ? h('div.adv-info-army', null, model.army.map((s) => h('div.adv-info-stack', null,
      sprite('creature', s.creatureId, { size: 36 }), h('span', null, s.label)))) : null);
}

// ---- canvas helpers ----------------------------------------------------------------------------

function mapImage(state, viewerId, z, w, h, { reveal = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.className = 'adv-worldmap';
  const g = c.getContext('2d');
  if (!g) return c;
  const mw = state.map.width;
  const mh = state.map.height;
  try {
    const src = document.createElement('canvas');
    src.width = mw;
    src.height = mh;
    const sg = src.getContext('2d');
    const img = sg.createImageData(mw, mh);
    const px = minimapPixels(state, reveal ? null : viewerId, z);
    if (img.data && img.data.set) img.data.set(px);
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, w, h);
  } catch { /* fake canvases in tests */ }
  return c;
}

/**
 * World view (View World / View Air / View Earth): the whole level scaled to fit, with optional
 * markers `[{pos, color, label}]`.
 */
export function showWorldView(ctx, state, viewerId, z, { title = 'World View', markers = [] } = {}) {
  const maxW = 900;
  const maxH = 540;
  const k = Math.max(1, Math.floor(Math.min(maxW / state.map.width, maxH / state.map.height)));
  const w = state.map.width * k;
  const hh = state.map.height * k;
  const c = mapImage(state, viewerId, z, w, hh);
  const g = c.getContext('2d');
  if (g) {
    for (const m of markers) {
      if ((m.pos.z || 0) !== z) continue;
      g.fillStyle = m.color || '#ffe9a6';
      g.fillRect(m.pos.x * k - 1, m.pos.y * k - 1, Math.max(3, k + 2), Math.max(3, k + 2));
    }
  }
  const legend = markers.length ? h('div.adv-small', null, `${markers.length} marked location${markers.length === 1 ? '' : 's'}`) : null;
  return openDialog({ title, content: h('div.adv-world', null, c, legend), class: 'adv-dlg adv-dlg-wide', width: Math.min(1000, w + 60) });
}

/** Markers for the `spell_cast` event of View Air / View Earth. */
export function spellMarkers(e) {
  const out = [];
  for (const a of e.artifacts || []) out.push({ pos: a.pos, color: '#e8c040', label: 'artifact' });
  for (const r of e.resources || []) out.push({ pos: r.pos, color: '#f0f0f0', label: 'resource' });
  for (const m of e.mines || []) out.push({ pos: m.pos, color: '#c06a2a', label: 'mine' });
  for (const x of e.heroes || []) out.push({ pos: x.pos, color: '#ff4040', label: 'hero' });
  for (const t of e.towns || []) out.push({ pos: t.pos, color: '#40a0ff', label: 'town' });
  return out;
}

// ---- puzzle map --------------------------------------------------------------------------------

/**
 * Puzzle map: the terrain around the grail, covered by `cols x rows` pieces; pieces of visited
 * obelisks are removed. The grail cross is drawn on the terrain (visible once uncovered).
 * @returns dialog handle (handle.model = { progress, window })
 */
export function showPuzzle(ctx, state, viewerId, progress, grailPos) {
  const cols = progress.cols || 8;
  const rows = progress.rows || 6;
  // the engine tells which map area the puzzle shows (`progress.area`, once a piece is uncovered)
  const win = progress.area || puzzleWindow(state, grailPos, cols, rows);
  const W = 640;
  const H = Math.round((W * win.h) / Math.max(1, win.w));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.className = 'adv-puzzle';
  const g = c.getContext('2d');
  const removed = new Set(progress.removed || []);
  if (g) {
    const kx = W / win.w;
    const ky = H / win.h;
    for (let y = 0; y < win.h; y++) {
      for (let x = 0; x < win.w; x++) {
        const t = state.map.tiles[win.z][win.y0 + y][win.x0 + x];
        g.fillStyle = (TERRAIN_BY_ID[t.t] && TERRAIN_BY_ID[t.t].color) || '#777';
        g.fillRect(x * kx, y * ky, Math.ceil(kx), Math.ceil(ky));
        if (t.blocked) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x * kx, y * ky, Math.ceil(kx), Math.ceil(ky)); }
      }
    }
    if (grailPos) {
      const gx = (grailPos.x - win.x0 + 0.5) * kx;
      const gy = (grailPos.y - win.y0 + 0.5) * ky;
      g.strokeStyle = '#d02010';
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(gx - 10, gy - 10); g.lineTo(gx + 10, gy + 10); g.moveTo(gx + 10, gy - 10); g.lineTo(gx - 10, gy + 10); g.stroke();
    }
    const pw = W / cols;
    const ph = H / rows;
    for (let i = 0; i < cols * rows; i++) {
      if (removed.has(i)) continue;
      const px = (i % cols) * pw;
      const py = Math.floor(i / cols) * ph;
      g.fillStyle = (i + Math.floor(i / cols)) % 2 ? '#b79c69' : '#a88c5a';
      g.fillRect(px, py, pw, ph);
      g.strokeStyle = '#5b4a33';
      g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    }
  }
  const text = progress.total
    ? `Obelisks visited: ${progress.visited} / ${progress.total}${progress.complete ? ' — the location of the Grail is revealed!' : ''}`
    : 'There are no obelisks in this world.';
  const handle = openDialog({ title: 'Puzzle Map', content: h('div.adv-puzzle-wrap', null, c, h('p', null, text)), class: 'adv-dlg adv-dlg-wide', width: 700 });
  handle.model = { progress, window: win, removed: [...removed] };
  return handle;
}

// ---- spells ------------------------------------------------------------------------------------

/**
 * Spell book for adventure spells. `info` = { spells: [id], mana, mastery, costOf(spell), canCast(spell) }.
 * @returns {Promise<string|null>} chosen spell id
 */
export function pickAdventureSpell(ctx, info) {
  let handle = null;
  const book = SpellbookView({
    spells: info.spells, mana: info.mana, mastery: info.mastery, kind: 'adventure', lockKind: true,
    costOf: info.costOf, canCast: info.canCast, onSelect: (id) => handle.close(id),
  });
  handle = openDialog({ title: 'Adventure Spells', content: book, class: 'adv-dlg adv-dlg-wide', width: 720, buttons: [{ label: 'Close', value: null, cancel: true }] });
  handle.book = book;
  const p = handle.result;
  p.handle = handle;
  return p;
}

export function spellName(id) {
  return (SPELL_BY_ID[id] && SPELL_BY_ID[id].name) || humanizeId(id);
}

// ---- menus -------------------------------------------------------------------------------------

export function systemMenu() {
  return choose({
    title: 'System Options', cancellable: true, columns: 1,
    options: [
      { label: 'Save game', value: 'save' }, { label: 'Load game', value: 'load' }, { label: 'Quick save', value: 'quicksave' },
      { label: 'Options', value: 'options' }, { label: 'Encyclopedia', value: 'encyclopedia' }, { label: 'Main menu', value: 'menu' },
    ],
  });
}

export function adventureMenu({ canDig = true } = {}) {
  return choose({
    title: 'Adventure Options', cancellable: true, columns: 1,
    options: [
      { label: 'Dig for the Grail', value: 'dig', disabled: !canDig },
      { label: 'View puzzle map', value: 'puzzle' },
      { label: 'View world', value: 'world' },
      { label: 'Kingdom overview', value: 'kingdom' },
    ],
  });
}

export function showQuestLog(ctx, entries, onGo) {
  let handle = null;
  const body = entries.length
    ? h('div.adv-list', null, entries.map((q) => {
      const go = h('button.k-btn.k-btn-sm', { type: 'button' }, 'Go to');
      go.addEventListener('click', () => { handle.close(null); if (onGo) onGo(q.pos); });
      return h('div.adv-list-row', null, h('div.adv-list-main', null, h('div.adv-list-label', null, q.title), h('div.adv-list-note', null, q.text + (q.deadline ? ` (until day ${q.deadline})` : ''))), go);
    }))
    : h('p', null, 'You have no quests.');
  handle = openDialog({ title: 'Quest Log', content: body, class: 'adv-dlg', width: 560 });
  return handle;
}

export function showThievesGuild(ctx, state, table) {
  const cols = ['towns', 'heroes', 'gold', 'woodOre', 'rare', 'obelisks', 'artifacts', 'mines'];
  const rows = table.map((r) => h('tr', null, h('td', null, playerName(state, r.playerId)), cols.map((c) => h('td', null, fmt(r[c] ?? 0))),
    h('td', null, r.bestHero ? `${r.bestHero.name} (${r.bestHero.level})` : '-')));
  const t = h('table.adv-table', null, h('tr', null, h('th', null, 'Player'), cols.map((c) => h('th', null, humanizeId(c.replace('woodOre', 'wood_ore')))), h('th', null, 'Best hero')), rows);
  return openDialog({ title: "Thieves' Guild", content: t, class: 'adv-dlg adv-dlg-wide', width: 900 });
}

// ---- combat result / game over -------------------------------------------------------------------

export function combatResultText(state, viewerId, res) {
  const r = (res && res.result) || {};
  const winner = r.winner;
  const attackerOwner = r.attackerHeroId && state.heroes[r.attackerHeroId] ? state.heroes[r.attackerHeroId].owner : null;
  const lines = [];
  let won = null;
  if (winner === 'draw') lines.push('The battle ends in a draw.');
  else if (winner) {
    const fates = r.fates || {};
    won = (winner === 'attacker' && (fates.attacker === 'won' || attackerOwner === viewerId)) || (winner === 'defender' && attackerOwner !== viewerId && attackerOwner != null);
    if (r.winnerHeroId && state.heroes[r.winnerHeroId]) won = state.heroes[r.winnerHeroId].owner === viewerId;
    lines.push(won ? 'Victory!' : 'Defeat!');
  }
  if (r.experience) lines.push(`Experience gained: ${fmt(r.experience)}`);
  if (r.raised) lines.push(`Raised ${fmt(r.raised.count)} ${creatureName(r.raised.creatureId, r.raised.count)}`);
  for (const side of ['attacker', 'defender']) {
    const losses = r[side] && r[side].losses;
    if (!losses) continue;
    const list = Object.entries(losses).filter(([, n]) => n > 0).map(([id, n]) => `${fmt(n)} ${creatureName(id, n)}`);
    if (list.length) lines.push(`${side === 'attacker' ? 'Attacker' : 'Defender'} losses: ${list.join(', ')}`);
  }
  return { won, lines };
}

export function showCombatResult(ctx, state, viewerId, res) {
  const m = combatResultText(state, viewerId, res);
  return message(h('div.adv-combat-result', null, m.lines.map((l) => h('p', null, l))), { title: m.won === false ? 'Defeat' : m.won ? 'Victory' : 'Battle' });
}

/** Victory / defeat dialog with the score breakdown. Resolves when closed. */
export function showGameOver(ctx, state, viewerId, breakdown) {
  const over = state.gameOver || {};
  const won = over.winner != null && over.winner === viewerId;
  const title = won ? 'Victory!' : over.winner == null ? 'The game is over' : 'Defeat';
  const text = won ? 'You have conquered the land!'
    : over.winner == null ? 'Nobody has won.' : `${playerName(state, over.winner)} player has won the game.`;
  const b = breakdown || {};
  const content = h('div.adv-gameover', null,
    h('p', null, text),
    b.score != null ? h('table.adv-table', null,
      h('tr', null, h('td', null, 'Days'), h('td', null, String(b.days ?? state.turn))),
      h('tr', null, h('td', null, 'Base'), h('td', null, String(b.base ?? ''))),
      h('tr', null, h('td', null, 'All enemies defeated'), h('td', null, b.allDefeated ? '+25' : '0')),
      h('tr', null, h('td', null, 'Grail'), h('td', null, b.grail ? '+25' : '0')),
      h('tr', null, h('td', null, 'Difficulty'), h('td', null, `${b.percent ?? 100}%`)),
      h('tr.adv-score', null, h('td', null, 'Score'), h('td', null, String(b.score))),
      h('tr', null, h('td', null, 'Rank'), h('td', null, b.title || ''))) : null);
  return openDialog({ title, content, class: 'adv-dlg', width: 460, buttons: [{ label: 'Main menu', value: true, default: true }], cancelValue: true }).result;
}

