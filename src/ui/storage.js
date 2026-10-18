import { compressUtf16, decompressUtf16 } from './lz.js';

// Persistence: save slots (localStorage) with metadata, autosave, JSON export/import, and the
// user settings store. No DOM here - only a Storage-like backend ({getItem, setItem, removeItem}),
// so everything is unit-tested with a fake backend.
//
// Save record (one localStorage key per slot, `h3o.save.<slot>`):
//   { format: 'h3online-save', version: 1, meta: SaveMeta, data: string, encoding?: 'lz16' }
// data = serialized state, LZ-compressed (src/ui/lz.js) when `encoding` is 'lz16'. Records without
// `encoding` (older saves, hand-made files) are read as plain text.
// The index of metas lives under `h3o.saves` so listing never parses whole games.

export const SAVE_FORMAT = 'h3online-save';
export const SAVE_VERSION = 1;
export const SAVE_PREFIX = 'h3o.save.';
export const INDEX_KEY = 'h3o.saves';
export const SETTINGS_KEY = 'h3o.settings';
export const AUTOSAVE_SLOT = 'autosave';
export const QUICKSAVE_SLOT = 'quicksave';
export const DATA_PREFIX = 'h3o.data.';

/** The browser's localStorage, or null when unavailable (private mode, file://, Node). */
export function safeLocalStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const k = '__h3o_probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}

/** In-memory fallback backend (settings/saves then last for the session only). */
export function memoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

/** 'My Save #1!' -> 'my_save_1' */
export function slotId(name) {
  const id = String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return id || 'save';
}

/**
 * Summary shown in the load/save list (pure). Tolerates partial states.
 * @returns {{ slot, name, savedAt, turn, date, mapName, mapSize, difficulty, players: [{color, name, isHuman, faction, alive}], currentPlayer, size }}
 */
export function buildSaveMeta(state, { slot, name, now = Date.now() } = {}) {
  const s = state || {};
  const players = (s.players || []).map((p) => ({ color: p.color, name: p.name, isHuman: !!p.isHuman, faction: p.faction, alive: p.alive !== false }));
  const cur = (s.players || [])[s.currentPlayer];
  return {
    slot, name: name || slot, savedAt: now,
    turn: s.turn ?? null, date: s.date ? { ...s.date } : null,
    mapName: s.meta?.name || s.map?.name || s.settings?.mapName || null,
    mapSize: s.map ? `${s.map.width}x${s.map.height}${s.map.levels > 1 ? ' +U' : ''}` : null,
    difficulty: s.settings?.difficulty ?? null,
    players, currentPlayer: cur ? cur.name || cur.color : null,
  };
}

/**
 * @param {object} [o]
 *   backend: Storage-like (default: localStorage, else memory),
 *   serialize(state) => string|object, deserialize(data) => state   (default: JSON),
 *   compress: false to store plain JSON text (default: LZ-compressed when smaller),
 *   now: () => number
 */
export function createStorage(o = {}) {
  const real = o.backend || safeLocalStorage();
  const backend = real || memoryBackend();
  let serialize = o.serialize || null;
  let deserialize = o.deserialize || null;
  const now = o.now || (() => Date.now());
  const compress = o.compress !== false;       // LZ-compress save data (default on)

  const fail = (error, detail) => ({ ok: false, error, ...(detail ? { detail } : {}) });

  function readIndex() {
    try {
      const raw = backend.getItem(INDEX_KEY);
      const idx = raw ? JSON.parse(raw) : {};
      return idx && typeof idx === 'object' && !Array.isArray(idx) ? idx : {};
    } catch { return {}; }
  }
  function writeIndex(idx) {
    try { backend.setItem(INDEX_KEY, JSON.stringify(idx)); } catch { /* the saves themselves still exist */ }
  }

  function encode(state) {
    const out = serialize ? serialize(state) : JSON.stringify(state);
    return typeof out === 'string' ? out : JSON.stringify(out);
  }
  function decode(data, encoding) {
    if (encoding === 'lz16') {
      data = decompressUtf16(data);
      if (data == null) throw new Error('compressed save data is corrupt');
    } else if (encoding != null) {
      throw new Error(`unknown save encoding '${encoding}'`);
    }
    if (deserialize) return deserialize(data);
    return typeof data === 'string' ? JSON.parse(data) : data;
  }
  function makeRecord(slot, state, name) {
    const raw = encode(state);
    const meta = buildSaveMeta(state, { slot, name, now: now() });
    meta.rawSize = raw.length;
    const packed = compress ? compressUtf16(raw) : null;
    if (packed != null && packed.length < raw.length) {
      meta.size = packed.length;
      return { format: SAVE_FORMAT, version: SAVE_VERSION, meta, encoding: 'lz16', data: packed };
    }
    meta.size = raw.length;
    return { format: SAVE_FORMAT, version: SAVE_VERSION, meta, data: raw };
  }
  function parseRecord(text) {
    let rec;
    try { rec = typeof text === 'string' ? JSON.parse(text) : text; } catch { return fail('corrupt_save'); }
    if (!rec || typeof rec !== 'object') return fail('corrupt_save');
    if (rec.format !== SAVE_FORMAT) {
      // Accept a bare game state too (a hand-made / debug export).
      if (rec.players && rec.map) return { ok: true, record: { format: SAVE_FORMAT, version: SAVE_VERSION, meta: buildSaveMeta(rec, { now: now() }), data: JSON.stringify(rec) } };
      return fail('not_a_save_file');
    }
    if (rec.version > SAVE_VERSION) return fail('save_from_newer_version');
    if (rec.data == null) return fail('corrupt_save');
    return { ok: true, record: rec };
  }

  const api = {
    /** false when localStorage is unavailable and saves only live in memory. */
    persistent: !!real,
    /** Use the game's own serialize/deserialize once the engine is loaded. */
    setCodec(codec = {}) { serialize = codec.serialize || null; deserialize = codec.deserialize || null; },

    /** All save metas, newest first. */
    list() {
      return Object.values(readIndex()).filter((m) => m && m.slot).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    },
    meta(slot) { return readIndex()[slot] || null; },
    has(slot) { return backend.getItem(SAVE_PREFIX + slot) != null; },

    /** @returns {{ok: true, meta} | {ok: false, error: 'no_state'|'quota_exceeded'|'serialize_failed'|'storage_failed'}} */
    save(slot, state, { name } = {}) {
      if (!state) return fail('no_state');
      slot = slotId(slot);
      let record;
      try { record = makeRecord(slot, state, name || readIndex()[slot]?.name || slot); } catch (err) { return fail('serialize_failed', String(err && err.message)); }
      try {
        backend.setItem(SAVE_PREFIX + slot, JSON.stringify(record));
      } catch (err) {
        const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message)));
        return fail(quota ? 'quota_exceeded' : 'storage_failed', String(err && err.message));
      }
      const idx = readIndex();
      idx[slot] = record.meta;
      writeIndex(idx);
      return { ok: true, meta: record.meta };
    },

    /** @returns {{ok: true, state, meta} | {ok: false, error: 'no_such_save'|'corrupt_save'|...}} */
    load(slot) {
      const raw = backend.getItem(SAVE_PREFIX + slot);
      if (raw == null) return fail('no_such_save');
      const parsed = parseRecord(raw);
      if (!parsed.ok) return parsed;
      try {
        return { ok: true, state: decode(parsed.record.data, parsed.record.encoding), meta: parsed.record.meta };
      } catch (err) {
        return fail('corrupt_save', String(err && err.message));
      }
    },

    remove(slot) {
      try { backend.removeItem(SAVE_PREFIX + slot); } catch { /* ignore */ }
      const idx = readIndex();
      delete idx[slot];
      writeIndex(idx);
      return { ok: true };
    },

    /** The slot's save file content (JSON text) for download, or null. */
    exportSlot(slot) { return backend.getItem(SAVE_PREFIX + slot); },
    /** Save file content for a live state without touching any slot. */
    exportState(state, name = 'export') { return JSON.stringify(makeRecord(slotId(name), state, name)); },

    /**
     * Parse an exported file. With `slot` (or `store: true`) it is also written to a slot.
     * @returns {{ok: true, state, meta, slot?} | {ok: false, error}}
     */
    importJson(text, { slot = null, store = false } = {}) {
      const parsed = parseRecord(text);
      if (!parsed.ok) return parsed;
      let state;
      try { state = decode(parsed.record.data, parsed.record.encoding); } catch (err) { return fail('corrupt_save', String(err && err.message)); }
      if (!state || typeof state !== 'object') return fail('corrupt_save');
      const meta = { ...parsed.record.meta };
      if (slot || store) {
        const target = slotId(slot || meta.name || meta.slot || 'imported');
        const res = api.save(target, state, { name: meta.name || target });
        if (!res.ok) return res;
        return { ok: true, state, meta: res.meta, slot: target };
      }
      return { ok: true, state, meta };
    },

    // Small JSON records that are not games (campaign progress ...), key `h3o.data.<name>`.
    /** The stored value or null (missing / unreadable). */
    readData(name) {
      try { const raw = backend.getItem(DATA_PREFIX + name); return raw == null ? null : JSON.parse(raw); } catch { return null; }
    },
    /** @returns {{ok: true} | {ok: false, error: 'quota_exceeded'|'storage_failed'}} */
    writeData(name, value) {
      try { backend.setItem(DATA_PREFIX + name, JSON.stringify(value)); return { ok: true }; } catch (err) {
        const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message)));
        return fail(quota ? 'quota_exceeded' : 'storage_failed', String(err && err.message));
      }
    },
    removeData(name) { try { backend.removeItem(DATA_PREFIX + name); } catch { /* ignore */ } return { ok: true }; },
  };
  return api;
}

/** Friendly text for a storage error code. */
export function storageErrorText(error) {
  return {
    no_state: 'There is no game in progress to save.',
    quota_exceeded: 'The browser storage is full. Delete old saves or export this game to a file instead.',
    storage_failed: 'The browser refused to store the save.',
    serialize_failed: 'The game state could not be serialized.',
    no_such_save: 'That save no longer exists.',
    corrupt_save: 'The save data is corrupt and cannot be read.',
    not_a_save_file: 'This file is not an H3online save.',
    save_from_newer_version: 'This save was made by a newer version of the game.',
  }[error] || `Storage error: ${error}`;
}

// ---- settings -----------------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  volume: 0.5,          // 0..1 master volume of the sfx synth
  muted: false,
  animSpeed: 1,         // animation time multiplier: 0.5 | 1 | 2 | 4
  autosave: true,       // save to the 'autosave' slot at the start of each human turn
  showGrid: false,      // grid overlay on the adventure map / battlefield
  edgeScroll: true,     // scroll the adventure map when the pointer touches the stage edge
  uiScale: 1,           // 0.5..1 fraction of the window the stage may occupy
  quickCombat: false,   // auto-resolve battles
  confirmEndTurn: true, // ask before ending a turn while heroes can still move
};

const LIMITS = { volume: [0, 1], animSpeed: [0.25, 8], uiScale: [0.5, 1] };

function sanitize(key, value) {
  const def = DEFAULT_SETTINGS[key];
  if (def === undefined) return value;
  if (typeof def === 'boolean') return !!value;
  if (typeof def === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return def;
    const lim = LIMITS[key];
    return lim ? Math.min(lim[1], Math.max(lim[0], n)) : n;
  }
  return value;
}

/**
 * Persistent settings store.
 *   settings.get('volume'); settings.set('volume', 0.8); const off = settings.subscribe((key, value) => ...);
 * @returns {{ get, set, all, reset, subscribe }}
 */
export function createSettings(backend = safeLocalStorage() || memoryBackend()) {
  const values = { ...DEFAULT_SETTINGS };
  const subs = new Set();
  try {
    const raw = backend.getItem(SETTINGS_KEY);
    const stored = raw ? JSON.parse(raw) : null;
    if (stored && typeof stored === 'object') for (const [k, v] of Object.entries(stored)) values[k] = sanitize(k, v);
  } catch { /* defaults */ }
  const persist = () => { try { backend.setItem(SETTINGS_KEY, JSON.stringify(values)); } catch { /* ignore */ } };
  return {
    get: (key) => values[key],
    set(key, value) {
      const v = sanitize(key, value);
      if (values[key] === v) return v;
      values[key] = v;
      persist();
      for (const fn of subs) fn(key, v);
      return v;
    },
    all: () => ({ ...values }),
    reset() {
      for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (values[k] !== v) { values[k] = v; for (const fn of subs) fn(k, v); }
      }
      persist();
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
