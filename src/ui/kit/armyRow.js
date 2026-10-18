// ArmyRow: 7 creature slots with selection, click-to-swap/merge, drag & drop and shift-split.
// Engine-agnostic: it never mutates the army. It emits
//     onMove(fromSlot, toSlot, count | undefined, fromRowId, toRowId)
// (count undefined = "the whole stack": the engine's armyMove swaps / merges / moves), and the
// owner re-renders with `.update(army)` after applying the engine call.
//
// Two rows that should exchange stacks (hero <-> garrison, hero <-> hero) share one selection:
//     const sel = createArmySelection();
//     const top = ArmyRow({ id: 'garrison', army: town.garrison, selection: sel, onMove });
//     const bottom = ArmyRow({ id: 'visiting', army: hero.army, selection: sel, onMove });
import { h, clear, fmt, fmtShort } from './dom.js';
import { sprite } from '../sprites.js';
import { attachInfo, attachTooltip } from './tooltip.js';
import { openDialog } from './dialog.js';
import { Slider, NumberStepper } from './widgets.js';
import { CreatureCard } from './creatureCard.js';
import { playClick } from './button.js';
import { CREATURE_BY_ID } from '../../data/creatures.js';
import { ARMY_SLOTS } from '../../core/constants.js';

/** Shared selection state for a group of rows. */
export function createArmySelection() {
  const rows = new Set();
  const sel = {
    current: null,          // { row: rowId, slot, stack }
    drag: null,
    set(v) { sel.current = v; for (const r of rows) r.refreshSelection(); },
    clear() { sel.set(null); },
    _register(row) { rows.add(row); return () => rows.delete(row); },
  };
  return sel;
}

/**
 * Pure click logic (unit-tested).
 * @param {null | {row, slot, stack}} sel     current selection
 * @param {{row, slot, stack: null | {creatureId, count}}} target   the clicked slot
 * @param {{shift?: boolean}} mods
 * @returns {{ selection: null | object, action: null | object }}
 *   action = { type: 'select', slot, row }
 *          | { type: 'info', slot, row }                       (click on the already selected stack)
 *          | { type: 'move', from, to, fromRow, toRow }        (swap / merge / move the whole stack)
 *          | { type: 'split', from, to, fromRow, toRow, max, creatureId }   (ask for a count first)
 */
export function armyClickStep(sel, target, { shift = false } = {}) {
  if (!sel) {
    if (!target.stack) return { selection: null, action: null };
    return { selection: { row: target.row, slot: target.slot, stack: target.stack }, action: { type: 'select', slot: target.slot, row: target.row } };
  }
  if (sel.row === target.row && sel.slot === target.slot) {
    return { selection: null, action: { type: 'info', slot: target.slot, row: target.row } };
  }
  const base = { from: sel.slot, to: target.slot, fromRow: sel.row, toRow: target.row };
  const sameKind = target.stack && sel.stack && target.stack.creatureId === sel.stack.creatureId;
  if (shift && sel.stack && (!target.stack || sameKind)) {
    const max = sel.stack.count - (target.stack ? 0 : 1);
    if (max >= 1) return { selection: null, action: { type: 'split', ...base, max, creatureId: sel.stack.creatureId } };
    return { selection: null, action: null };
  }
  return { selection: null, action: { type: 'move', ...base } };
}

/**
 * Split dialog: how many creatures to move. Resolves the count, or null when cancelled.
 *   const n = await splitStack({ creatureId: 'pikeman', max: 19, value: 10 });
 */
export function splitStack({ creatureId, max, value, min = 1, title } = {}) {
  const c = CREATURE_BY_ID[creatureId];
  const start = Math.min(max, Math.max(min, value ?? Math.ceil(max / 2)));
  const leftLabel = h('span.k-split-count', null, '');
  const sync = (v, from) => {
    if (from !== 'slider') slider.value = v;
    if (from !== 'stepper') stepper.value = v;
    leftLabel.textContent = `Move ${fmt(v)} of ${fmt(max)}`;
  };
  const slider = Slider({ min, max, value: start, onChange: (v) => sync(v, 'slider') });
  const stepper = NumberStepper({ min, max, value: start, onChange: (v) => sync(v, 'stepper') });
  sync(start);
  const handle = openDialog({
    title: title || `Split ${c ? c.name : 'stack'}`,
    class: 'k-dlg-split',
    content: h('div.k-split', null,
      h('div.k-split-top', null, sprite('creature', creatureId, { size: 64 }), leftLabel),
      slider, stepper),
    buttons: [
      { label: 'OK', default: true, value: () => stepper.value },
      { label: 'Cancel', value: null, cancel: true },
    ],
    cancelValue: null,
  });
  const p = handle.result;
  p.handle = handle;
  p.slider = slider;
  p.stepper = stepper;
  return p;
}

/**
 * @param {object} opts
 *   army: Array<{creatureId, count} | null> (7), id?: string (row id, default 'army'),
 *   selection?: createArmySelection() shared with other rows,
 *   onMove(fromSlot, toSlot, count|undefined, fromRowId, toRowId),
 *   onSelect?(slot|null, stack|null), onInfo?(slot, stack)  (click on the selected stack / double-click),
 *   infoContent?(slot, stack) => Node   (right-click-hold popup; default: CreatureCard),
 *   readonly?: bool, size?: px (default 58), label?: string, slots?: number (default 7),
 *   askSplit?: (action) => Promise<number|null>   (default: the split dialog)
 * API: .update(army), .selected (slot | null), .select(slot | null), .slotEls, .refreshSelection()
 */
export function ArmyRow(opts = {}) {
  const id = opts.id || 'army';
  const size = opts.size || 58;
  const count = opts.slots || ARMY_SLOTS;
  const selection = opts.selection || createArmySelection();
  const askSplit = opts.askSplit || ((a) => splitStack({ creatureId: a.creatureId, max: a.max }));
  let army = [];
  const slotsEl = h('div.k-army-slots');
  const el = h('div.k-army', { class: [opts.class, opts.readonly && 'is-readonly'] },
    opts.label ? h('div.k-army-label', null, opts.label) : null, slotsEl);
  el.slotEls = [];

  const stackAt = (i) => army[i] || null;

  async function run(step) {
    selection.set(step.selection);
    const a = step.action;
    if (!a) return;
    if (a.type === 'select') {
      playClick('click');
      if (opts.onSelect) opts.onSelect(a.slot, stackAt(a.slot));
    } else if (a.type === 'info') {
      if (opts.onSelect) opts.onSelect(null, null);
      if (opts.onInfo) opts.onInfo(a.slot, stackAt(a.slot));
    } else if (a.type === 'move') {
      playClick('click');
      if (opts.onMove) opts.onMove(a.from, a.to, undefined, a.fromRow, a.toRow);
    } else if (a.type === 'split') {
      const n = await askSplit(a);
      if (n != null && n > 0 && opts.onMove) opts.onMove(a.from, a.to, n, a.fromRow, a.toRow);
    }
  }

  function click(i, e) {
    if (opts.readonly) {
      if (stackAt(i) && opts.onInfo) opts.onInfo(i, stackAt(i));
      return;
    }
    run(armyClickStep(selection.current, { row: id, slot: i, stack: stackAt(i) }, { shift: !!(e && e.shiftKey) }));
  }

  function build() {
    el.slotEls = [];
    for (let i = 0; i < count; i++) {
      const stack = stackAt(i);
      const c = stack ? CREATURE_BY_ID[stack.creatureId] : null;
      const slot = h('div.k-army-slot', {
        class: !stack && 'is-empty', dataset: { slot: i, row: id },
        style: { width: size, height: size + 16 },
      },
      stack ? sprite('creature', stack.creatureId, { size: size - 6 }) : null,
      stack ? h('div.k-army-count', { title: fmt(stack.count) }, fmtShort(stack.count)) : null);
      slot.addEventListener('click', (e) => click(i, e));
      if (stack) {
        attachTooltip(slot, () => `${fmt(stack.count)} ${c ? c.name : stack.creatureId}`);
        attachInfo(slot, () => (opts.infoContent ? opts.infoContent(i, stack)
          : CreatureCard({ creatureId: stack.creatureId, count: stack.count, compact: true })));
        if (opts.onInfo) slot.addEventListener('dblclick', () => { selection.clear(); opts.onInfo(i, stack); });
      }
      if (!opts.readonly) {
        if (stack) {
          slot.draggable = true;
          slot.addEventListener('dragstart', (e) => {
            selection.drag = { row: id, slot: i, stack };
            if (e.dataTransfer) { try { e.dataTransfer.setData('text/plain', `${id}:${i}`); e.dataTransfer.effectAllowed = 'move'; } catch { /* ignore */ } }
          });
          slot.addEventListener('dragend', () => { selection.drag = null; });
        }
        slot.addEventListener('dragover', (e) => { if (selection.drag && e.preventDefault) e.preventDefault(); });
        slot.addEventListener('drop', (e) => {
          if (e.preventDefault) e.preventDefault();
          const from = selection.drag;
          selection.drag = null;
          if (!from || (from.row === id && from.slot === i)) return;
          run(armyClickStep(from, { row: id, slot: i, stack: stackAt(i) }, { shift: !!e.shiftKey }));
        });
      }
      el.slotEls.push(slot);
    }
    clear(slotsEl, el.slotEls);
    el.refreshSelection();
  }

  el.refreshSelection = () => {
    const cur = selection.current;
    el.slotEls.forEach((s, i) => s.classList.toggle('is-selected', !!cur && cur.row === id && cur.slot === i));
  };
  /** Re-render with a new army. Keeps the selection only if that stack still exists. */
  el.update = (next) => {
    army = next || [];
    const cur = selection.current;
    if (cur && cur.row === id) {
      const st = stackAt(cur.slot);
      if (!st) selection.current = null;
      else cur.stack = st;
    }
    build();
  };
  el.select = (slot) => {
    if (slot == null || !stackAt(slot)) selection.set(null);
    else selection.set({ row: id, slot, stack: stackAt(slot) });
  };
  Object.defineProperty(el, 'selected', {
    get: () => (selection.current && selection.current.row === id ? selection.current.slot : null),
  });
  el.selection = selection;
  el.rowId = id;
  el.destroy = selection._register(el);
  el.update(opts.army || []);
  return el;
}
