// Custom-map library (docs/mechanics/editor.md §5): blueprints saved by the map editor, listed by the
// editor's Open dialog and the New Game screen. Stored through ctx.storage's small-record API
// (`readData` / `writeData`, keys `h3o.data.maps` (index) and `h3o.data.map.<id>`), LZ-compressed.
// No engine imports: the New Game screen uses this without loading the editor.
import { compressUtf16, decompressUtf16 } from '../../lz.js';

export const MAP_RECORD_FORMAT = 'h3online-map-record';
const INDEX = 'maps';
const RECORD = (id) => `map.${id}`;

/** 'My Map #1!' -> 'my_map_1' */
export function mapId(name) {
  const id = String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return id || 'map';
}

/** Index entry of a blueprint. */
export function mapMeta(bp, id, now = Date.now()) {
  const m = bp.meta || {};
  return {
    id, name: m.name || id, description: m.description || '', savedAt: now,
    width: bp.map.width, height: bp.map.height, levels: bp.map.levels, size: m.size || `${bp.map.width}x${bp.map.height}`,
    playerSlots: m.playerSlots || 2, difficulty: m.difficulty ?? 1,
    players: (m.players || []).map((p) => ({ slot: p.slot, human: p.human !== false, ai: p.ai !== false, factions: p.factions || [] })),
    victory: bp.victory && bp.victory !== 'standard' ? (bp.victory.type || bp.victory) : 'standard',
    loss: bp.loss && bp.loss !== 'standard' ? (bp.loss.type || bp.loss) : 'standard',
  };
}

/** In-memory stand-in for ctx.storage (tests, or a build without the small-record API). */
export function memoryRecords() {
  const m = new Map();
  return {
    readData: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
    writeData: (k, v) => { m.set(k, JSON.stringify(v)); return { ok: true }; },
    removeData: (k) => { m.delete(k); return { ok: true }; },
  };
}

const fallback = memoryRecords();

/**
 * @param {{readData, writeData, removeData}} [storage] ctx.storage
 */
export function createMapLibrary(storage) {
  const st = storage && typeof storage.readData === 'function' ? storage : fallback;
  const readIndex = () => {
    const idx = st.readData(INDEX);
    return Array.isArray(idx) ? idx.filter((e) => e && e.id) : [];
  };
  const lib = {
    /** Newest first. */
    list() { return readIndex().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)); },
    has(id) { return readIndex().some((e) => e.id === id); },
    meta(id) { return readIndex().find((e) => e.id === id) || null; },
    /**
     * Save a blueprint under `id` (default: from its name). @returns {{ok, id, meta} | {ok:false, error}}
     */
    save(bp, { id = null, now = Date.now() } = {}) {
      const key = mapId(id || (bp.meta && bp.meta.name) || 'map');
      const raw = JSON.stringify(bp);
      const packed = compressUtf16(raw);
      const rec = packed != null && packed.length < raw.length ? { format: MAP_RECORD_FORMAT, encoding: 'lz16', data: packed } : { format: MAP_RECORD_FORMAT, data: raw };
      const w = st.writeData(RECORD(key), rec);
      if (!w || !w.ok) return { ok: false, error: (w && w.error) || 'storage_failed' };
      const meta = mapMeta(bp, key, now);
      const idx = readIndex().filter((e) => e.id !== key);
      idx.push(meta);
      const wi = st.writeData(INDEX, idx);
      if (!wi || !wi.ok) return { ok: false, error: (wi && wi.error) || 'storage_failed' };
      return { ok: true, id: key, meta };
    },
    /** @returns {{ok: true, bp} | {ok: false, error}} */
    load(id) {
      const rec = st.readData(RECORD(id));
      if (!rec || rec.format !== MAP_RECORD_FORMAT) return { ok: false, error: 'no_such_map' };
      let raw = rec.data;
      if (rec.encoding === 'lz16') raw = decompressUtf16(raw);
      if (raw == null) return { ok: false, error: 'corrupt_map' };
      try { return { ok: true, bp: JSON.parse(raw) }; } catch { return { ok: false, error: 'corrupt_map' }; }
    },
    remove(id) {
      st.removeData(RECORD(id));
      st.writeData(INDEX, readIndex().filter((e) => e.id !== id));
      return { ok: true };
    },
  };
  return lib;
}
