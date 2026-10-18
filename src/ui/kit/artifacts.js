// ArtifactSlot + ArtifactGrid (paper doll laid out from ARTIFACT_SLOTS / SLOT_COUNTS + backpack).
// Engine-agnostic: the grid never mutates `hero.artifacts`; it emits
//     onMove(from, to)   with refs { where: 'equipped', slot, index } | { where: 'backpack', index }
// and the owner calls the engine (equip / unequip / transferArtifact) then `.update(artifacts)`.
import { h, clear, fmt, humanize } from './dom.js';
import { sprite } from '../sprites.js';
import { attachInfo, attachTooltip } from './tooltip.js';
import { playClick } from './button.js';
import { ARTIFACT_BY_ID } from '../../data/artifacts.js';
import { SPELL_BY_ID } from '../../data/spells.js';
import { ARTIFACT_SLOTS, SLOT_COUNTS } from '../../core/constants.js';

export const SLOT_LABELS = {
  head: 'Head', neck: 'Neck', torso: 'Torso', shoulders: 'Shoulders', right_hand: 'Right hand',
  left_hand: 'Left hand', ring: 'Ring', feet: 'Feet', misc: 'Misc', war_machine: 'War machine', spellbook: 'Spell book',
};

/** Artifact id of an entry (`'id'` or `{ id, spellId }`), or null. */
export function artifactEntryId(entry) {
  if (entry == null) return null;
  return typeof entry === 'string' ? entry : entry.id;
}

/** Display name of an entry (spell scrolls include their spell). */
export function artifactEntryName(entry) {
  const id = artifactEntryId(entry);
  if (!id) return '';
  const a = ARTIFACT_BY_ID[id];
  const spell = entry && typeof entry === 'object' && entry.spellId ? SPELL_BY_ID[entry.spellId] : null;
  return `${a ? a.name : humanize(id)}${spell ? `: ${spell.name}` : ''}`;
}

/** Flat list of every paper-doll position: [{ slot, index, key: 'ring:1' }] (pure). */
export function paperDollSlots() {
  const out = [];
  for (const slot of ARTIFACT_SLOTS) for (let i = 0; i < SLOT_COUNTS[slot]; i++) out.push({ slot, index: i, key: `${slot}:${i}` });
  return out;
}

/** Info panel for an artifact entry (used as the right-click popup). */
export function ArtifactInfo(entry) {
  const id = artifactEntryId(entry);
  const a = ARTIFACT_BY_ID[id];
  if (!a) return h('div.k-artinfo', null, humanize(id));
  return h('div.k-artinfo', null,
    h('div.k-artinfo-head', null, sprite('artifact', id, { size: 52 }),
      h('div', null, h('div.k-artinfo-name', null, artifactEntryName(entry)),
        h('div.k-artinfo-sub', null, `${humanize(a.class)} - ${SLOT_LABELS[a.slot] || a.slot} - ${fmt(a.cost)} gold`))),
    h('div.k-artinfo-desc', null, a.description || ''),
    a.components ? h('div.k-artinfo-parts', null, 'Assembled from: ', a.components.map((c) => ARTIFACT_BY_ID[c]?.name || c).join(', ')) : null);
}

/**
 * ArtifactSlot({ slot?, index?, entry, size = 46, locked?, selected?, onClick?(entry, event), label? })
 * API: .set(entry), .setSelected(bool), .entry
 */
export function ArtifactSlot(opts = {}) {
  const size = opts.size || 46;
  const el = h('div.k-art-slot', {
    class: [opts.slot && `k-art-${opts.slot}`, opts.locked && 'is-locked', opts.class],
    dataset: { slot: opts.slot || '', index: opts.index ?? 0 },
    style: { width: size, height: size },
  });
  el.entry = null;
  el.set = (entry) => {
    el.entry = entry ?? null;
    const id = artifactEntryId(entry);
    clear(el, id ? sprite('artifact', id, { size: size - 6 }) : (opts.slot ? h('span.k-art-ghost', null, SLOT_LABELS[opts.slot] || '') : null));
    el.classList.toggle('is-empty', !id);
  };
  attachTooltip(el, () => (el.entry ? artifactEntryName(el.entry) : opts.locked ? 'Locked by a combination artifact' : opts.slot ? `${SLOT_LABELS[opts.slot]} (empty)` : ''));
  attachInfo(el, () => (el.entry ? ArtifactInfo(el.entry) : null));
  el.addEventListener('click', (e) => { if (opts.onClick) opts.onClick(el.entry, e); });
  el.setSelected = (s) => el.classList.toggle('is-selected', !!s);
  el.set(opts.entry);
  if (opts.selected) el.setSelected(true);
  return el;
}

/**
 * Paper doll + backpack.
 *   ArtifactGrid({ artifacts: hero.artifacts,           // { equipped: {slot: [entry|null]}, backpack: [entry], locks? }
 *                  onMove(from, to), onPick?(ref, entry), onActivate?(ref, entry),   // dblclick (assemble / disassemble menus)
 *                  selection?: createArtifactSelection()  (share between two heroes' grids),
 *                  id?: string, readonly?, backpackVisible = 8, slotSize = 46 })
 * refs: { grid: id, where: 'equipped', slot, index } | { grid: id, where: 'backpack', index }
 * (`index` of a backpack target may equal backpack.length = "append").
 * API: .update(artifacts), .slotEl(slot, index), .backpackEls, .selection
 */
export function ArtifactGrid(opts = {}) {
  const id = opts.id || 'hero';
  const size = opts.slotSize || 46;
  const visible = opts.backpackVisible || 8;
  const selection = opts.selection || createArtifactSelection();
  let arts = { equipped: {}, backpack: [], locks: {} };
  let page = 0;
  const doll = h('div.k-art-doll');
  const packRow = h('div.k-art-pack-row');
  const pageLabel = h('span.k-art-pack-page');
  const prev = h('button.k-btn.k-art-pack-nav', { type: 'button' }, '<');
  const next = h('button.k-btn.k-art-pack-nav', { type: 'button' }, '>');
  const el = h('div.k-art-grid', { class: [opts.class, opts.readonly && 'is-readonly'] }, doll,
    h('div.k-art-pack', null, h('div.k-art-pack-head', null, 'Backpack', pageLabel), h('div.k-art-pack-body', null, prev, packRow, next)));
  const slotEls = new Map();
  el.backpackEls = [];

  const same = (a, b) => a && b && a.grid === b.grid && a.where === b.where && a.slot === b.slot && a.index === b.index;

  function click(ref, entry) {
    if (opts.readonly) { if (entry && opts.onPick) opts.onPick(ref, entry); return; }
    const cur = selection.current;
    if (!cur) {
      if (!entry) return;
      playClick('click');
      selection.set({ ...ref, entry });
      if (opts.onPick) opts.onPick(ref, entry);
      return;
    }
    selection.set(null);
    if (same(cur, ref)) return;
    playClick('click');
    const { entry: _e, ...from } = cur;
    if (opts.onMove) opts.onMove(from, ref);
  }

  function build() {
    slotEls.clear();
    clear(doll);
    for (const p of paperDollSlots()) {
      const entry = arts.equipped?.[p.slot]?.[p.index] ?? null;
      const locked = !!(arts.locks && arts.locks[p.key]);
      const ref = { grid: id, where: 'equipped', slot: p.slot, index: p.index };
      const s = ArtifactSlot({ slot: p.slot, index: p.index, entry, size, locked, onClick: (en) => click(ref, en) });
      s.classList.add(`k-art-pos-${p.slot}-${p.index}`);
      if (opts.onActivate) s.addEventListener('dblclick', () => { if (s.entry) { selection.set(null); opts.onActivate(ref, s.entry); } });
      slotEls.set(p.key, s);
      doll.appendChild(s);
    }
    const pack = arts.backpack || [];
    const pages = Math.max(1, Math.ceil((pack.length + 1) / visible));
    page = Math.min(page, pages - 1);
    el.backpackEls = [];
    for (let k = 0; k < visible; k++) {
      const index = page * visible + k;
      const entry = index < pack.length ? pack[index] : null;
      const ref = { grid: id, where: 'backpack', index: Math.min(index, pack.length) };
      const s = ArtifactSlot({ entry, size, class: 'k-art-pack-slot', onClick: (en) => click(ref, en) });
      s.dataset.backpack = String(index);
      if (opts.onActivate) s.addEventListener('dblclick', () => { if (s.entry) { selection.set(null); opts.onActivate(ref, s.entry); } });
      el.backpackEls.push(s);
    }
    clear(packRow, el.backpackEls);
    pageLabel.textContent = ` (${pack.length})${pages > 1 ? ` - page ${page + 1}/${pages}` : ''}`;
    prev.disabled = page <= 0;
    next.disabled = page >= pages - 1;
    el.refreshSelection();
  }
  prev.addEventListener('click', () => { if (page > 0) { page--; build(); } });
  next.addEventListener('click', () => { page++; build(); });

  el.refreshSelection = () => {
    const cur = selection.current;
    for (const [key, s] of slotEls) {
      s.setSelected(!!cur && cur.grid === id && cur.where === 'equipped' && `${cur.slot}:${cur.index}` === key);
    }
    el.backpackEls.forEach((s) => s.setSelected(!!cur && cur.grid === id && cur.where === 'backpack' && String(cur.index) === s.dataset.backpack));
  };
  el.update = (a) => { arts = a || { equipped: {}, backpack: [] }; build(); };
  el.slotEl = (slot, index = 0) => slotEls.get(`${slot}:${index}`) || null;
  el.selection = selection;
  el.destroy = selection._register(el);
  el.update(opts.artifacts);
  return el;
}

/** Shared selection for one or more ArtifactGrids (hero exchange screen). */
export function createArtifactSelection() {
  const grids = new Set();
  const sel = {
    current: null,
    set(v) { sel.current = v; for (const g of grids) g.refreshSelection(); },
    clear() { sel.set(null); },
    _register(g) { grids.add(g); return () => grids.delete(g); },
  };
  return sel;
}
