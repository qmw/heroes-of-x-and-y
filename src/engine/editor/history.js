// Undo / redo for the map editor (docs/mechanics/editor.md §1). An operation opens a transaction,
// "touches" every piece of the blueprint it is about to change (a tile, an object, the towns list...),
// and commits: the step stores the before/after copies of exactly those pieces.

export const HISTORY_LIMIT = 200;

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function readKey(doc, key) {
  const bp = doc.bp;
  if (key.startsWith('tile:')) {
    const [z, y, x] = key.slice(5).split(',').map(Number);
    return bp.map.tiles[z][y][x];
  }
  if (key.startsWith('obj:')) return bp.map.objects[key.slice(4)];
  switch (key) {
    case 'map': return bp.map;
    case 'placedArtifacts': return bp.map.placedArtifacts;
    case 'puzzleOrder': return bp.map.puzzleOrder;
    case 'nextId': return doc.nextId;
    default: return bp[key];
  }
}

function writeKey(doc, key, value) {
  const bp = doc.bp;
  const v = clone(value);
  if (key.startsWith('tile:')) {
    const [z, y, x] = key.slice(5).split(',').map(Number);
    bp.map.tiles[z][y][x] = v;
    return;
  }
  if (key.startsWith('obj:')) {
    const id = key.slice(4);
    if (v == null) delete bp.map.objects[id]; else bp.map.objects[id] = v;
    return;
  }
  switch (key) {
    case 'map': bp.map = v; return;
    case 'placedArtifacts': case 'puzzleOrder':
      if (v === undefined) delete bp.map[key]; else bp.map[key] = v;
      return;
    case 'nextId': doc.nextId = v; return;
    default:
      if (v === undefined) delete bp[key]; else bp[key] = v;
  }
}

/** Open a transaction. `tx.touch(key)` saves the current value of a key the first time. */
export function beginTx(doc, label) {
  const saved = new Map();
  const tx = {
    label,
    touch(key) {
      if (!saved.has(key)) saved.set(key, clone(readKey(doc, key)));
      return tx;
    },
    tile(x, y, z = 0) { return tx.touch(`tile:${z},${y},${x}`); },
    obj(id) { return tx.touch(`obj:${id}`); },
    /** Undo everything done so far (failed operation). */
    rollback() {
      for (const [key, before] of [...saved.entries()].reverse()) writeKey(doc, key, before);
      saved.clear();
    },
    /** Record the step (skipped when nothing changed). Returns true when something changed. */
    commit() {
      const entries = [];
      for (const [key, before] of saved) {
        const after = clone(readKey(doc, key));
        if (JSON.stringify(before) !== JSON.stringify(after)) entries.push({ key, before, after });
      }
      saved.clear();
      if (!entries.length) return false;
      const batch = doc.batch;
      if (batch && batch.step && doc.undo[doc.undo.length - 1] === batch.step) {
        // merge into the open batch step: keep the earliest `before`, take the latest `after`
        const byKey = new Map(batch.step.entries.map((e) => [e.key, e]));
        for (const e of entries) {
          const prev = byKey.get(e.key);
          if (prev) prev.after = e.after; else { batch.step.entries.push(e); byKey.set(e.key, e); }
        }
        doc.redo = [];
        doc.version++;
        return true;
      }
      const step = { label: batch ? batch.label || label : label, entries };
      if (batch) batch.step = step;
      doc.undo.push(step);
      if (doc.undo.length > HISTORY_LIMIT) doc.undo.splice(0, doc.undo.length - HISTORY_LIMIT);
      doc.redo = [];
      doc.version++;
      return true;
    },
  };
  return tx;
}

/**
 * Group the following operations into ONE undo step (a brush stroke, a road drag) until `endBatch`.
 */
export function beginBatch(doc, label = null) {
  doc.batch = { label, step: null };
}
export function endBatch(doc) {
  doc.batch = null;
}

export const canUndo = (doc) => doc.undo.length > 0;
export const canRedo = (doc) => doc.redo.length > 0;

/** @returns {{ok: boolean, label?: string, error?: string}} */
export function undo(doc) {
  doc.batch = null;
  const step = doc.undo.pop();
  if (!step) return { ok: false, error: 'nothing_to_undo' };
  for (let i = step.entries.length - 1; i >= 0; i--) writeKey(doc, step.entries[i].key, step.entries[i].before);
  doc.redo.push(step);
  doc.version++;
  return { ok: true, label: step.label, keys: step.entries.map((e) => e.key) };
}

export function redo(doc) {
  doc.batch = null;
  const step = doc.redo.pop();
  if (!step) return { ok: false, error: 'nothing_to_redo' };
  for (const e of step.entries) writeKey(doc, e.key, e.after);
  doc.undo.push(step);
  doc.version++;
  return { ok: true, label: step.label, keys: step.entries.map((e) => e.key) };
}
