import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeStorage } from './fakeDom.js';
import {
  createStorage, createSettings, buildSaveMeta, slotId, storageErrorText, memoryBackend, safeLocalStorage,
  DEFAULT_SETTINGS, SAVE_PREFIX, INDEX_KEY, SETTINGS_KEY, SAVE_FORMAT,
} from '../../src/ui/storage.js';

const sampleState = (turn = 9) => ({
  version: 1, rng: { s: 12345 }, turn, date: { day: 2, week: 2, month: 1 }, currentPlayer: 1,
  players: [{ id: 0, color: 'red', name: 'Ann', isHuman: true, faction: 'castle', alive: true, resources: { gold: 1000 } },
    { id: 1, color: 'blue', name: 'CPU', isHuman: false, faction: 'inferno', alive: false, resources: { gold: 5 } }],
  heroes: { h1: { id: 'h1', defId: 'christian', army: [{ creatureId: 'pikeman', count: 10 }, null] } }, towns: {},
  map: { width: 36, height: 36, levels: 2, tiles: [], objects: {} }, pending: [], settings: { difficulty: 3 }, log: [], winner: null,
});

test('save / load round-trips the state and records metadata', () => {
  let clock = 1000;
  const backend = createFakeStorage();
  const store = createStorage({ backend, now: () => clock });
  assert.equal(store.persistent, true);
  const state = sampleState();
  const res = store.save('My Save #1!', state, { name: 'My Save #1!' });
  assert.ok(res.ok);
  assert.equal(res.meta.slot, 'my_save_1');
  assert.equal(res.meta.name, 'My Save #1!');
  assert.equal(res.meta.turn, 9);
  assert.equal(res.meta.mapSize, '36x36 +U');
  assert.equal(res.meta.difficulty, 3);
  assert.equal(res.meta.currentPlayer, 'CPU');
  assert.deepEqual(res.meta.players[1], { color: 'blue', name: 'CPU', isHuman: false, faction: 'inferno', alive: false });
  assert.ok(res.meta.size > 100);
  assert.ok(backend.getItem(`${SAVE_PREFIX}my_save_1`));

  const loaded = store.load('my_save_1');
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.state, state);
  assert.notEqual(loaded.state, state, 'a copy, not the same object');
  assert.equal(loaded.meta.savedAt, 1000);

  clock = 2000;
  store.save('autosave', sampleState(10), { name: 'Autosave' });
  clock = 3000;
  store.save('my_save_1', sampleState(11));
  const list = store.list();
  assert.deepEqual(list.map((m) => [m.slot, m.turn]), [['my_save_1', 11], ['autosave', 10]], 'newest first; overwrite keeps one entry');
  assert.equal(list[0].name, 'My Save #1!', 'overwriting keeps the display name');
  assert.ok(store.has('autosave'));
  assert.equal(store.meta('autosave').name, 'Autosave');

  store.remove('autosave');
  assert.equal(store.has('autosave'), false);
  assert.equal(store.list().length, 1);
  assert.deepEqual(store.load('autosave'), { ok: false, error: 'no_such_save' });
});

test('saves are LZ-compressed transparently; plain (older) records still load', () => {
  const backend = createFakeStorage();
  const store = createStorage({ backend });
  const state = sampleState();
  state.map.tiles = [Array.from({ length: 36 }, () => Array.from({ length: 36 }, () => ({ t: 'grass', road: 0, river: 0, obj: null, blocked: false })))];
  const res = store.save('big', state);
  assert.ok(res.ok);
  const rec = JSON.parse(backend.getItem(`${SAVE_PREFIX}big`));
  assert.equal(rec.encoding, 'lz16');
  assert.ok(res.meta.size * 10 < res.meta.rawSize, `compressed ${res.meta.rawSize} -> ${res.meta.size}`);
  assert.deepEqual(store.load('big').state, state);
  // export / import keeps working with compressed records
  const other = createStorage({ backend: createFakeStorage() });
  assert.deepEqual(other.importJson(store.exportSlot('big')).state, state);
  // a record written before compression existed (no `encoding`)
  backend.setItem(`${SAVE_PREFIX}old`, JSON.stringify({ format: SAVE_FORMAT, version: 1, meta: { slot: 'old' }, data: JSON.stringify(state) }));
  assert.deepEqual(store.load('old').state, state);
  // compress: false writes plain text
  const plain = createStorage({ backend, compress: false });
  plain.save('plain', state);
  assert.equal(JSON.parse(backend.getItem(`${SAVE_PREFIX}plain`)).encoding, undefined);
  assert.deepEqual(store.load('plain').state, state);
  // tiny states that would not shrink are stored plain
  store.save('tiny', { a: 1 });
  assert.equal(JSON.parse(backend.getItem(`${SAVE_PREFIX}tiny`)).encoding, undefined);
  // corrupt or unknown encodings are reported, not thrown
  backend.setItem(`${SAVE_PREFIX}broken`, JSON.stringify({ ...rec, data: '' }));
  assert.equal(store.load('broken').error, 'corrupt_save');
  backend.setItem(`${SAVE_PREFIX}alien`, JSON.stringify({ ...rec, encoding: 'zstd' }));
  assert.equal(store.load('alien').error, 'corrupt_save');
});

test('compression lets a save fit where plain JSON would exceed the quota', () => {
  const state = sampleState();
  state.log = Array.from({ length: 200 }, (_, i) => ({ type: 'day', text: 'A new day dawns over the land.', day: i % 7 }));
  const plainSize = JSON.stringify(state).length;
  const quota = Math.floor(plainSize * 0.8);
  assert.equal(createStorage({ backend: createFakeStorage(quota), compress: false }).save('s', state).error, 'quota_exceeded');
  assert.ok(createStorage({ backend: createFakeStorage(quota) }).save('s', state).ok);
});

test('errors: nothing to save, quota, corrupt data', () => {
  const store = createStorage({ backend: createFakeStorage(200) });
  assert.deepEqual(store.save('a', null), { ok: false, error: 'no_state' });
  const big = store.save('big', sampleState());
  assert.equal(big.ok, false);
  assert.equal(big.error, 'quota_exceeded');
  assert.equal(store.list().length, 0, 'a failed save leaves no index entry');
  assert.match(storageErrorText('quota_exceeded'), /full/);
  assert.match(storageErrorText('weird'), /weird/);

  const backend = createFakeStorage();
  const s2 = createStorage({ backend });
  backend.setItem(`${SAVE_PREFIX}bad`, '{not json');
  assert.equal(s2.load('bad').error, 'corrupt_save');
  backend.setItem(`${SAVE_PREFIX}alien`, JSON.stringify({ hello: 1 }));
  assert.equal(s2.load('alien').error, 'not_a_save_file');
  backend.setItem(`${SAVE_PREFIX}future`, JSON.stringify({ format: SAVE_FORMAT, version: 99, meta: {}, data: '{}' }));
  assert.equal(s2.load('future').error, 'save_from_newer_version');
  backend.setItem(INDEX_KEY, 'garbage');
  assert.deepEqual(s2.list(), [], 'a broken index is ignored');
  const cyc = {};
  cyc.self = cyc;
  assert.equal(s2.save('cyc', cyc).error, 'serialize_failed');
});

test('export / import: file text round-trips into another storage', () => {
  const a = createStorage({ backend: createFakeStorage(), now: () => 5 });
  const state = sampleState(21);
  a.save('campaign', state, { name: 'Campaign' });
  const text = a.exportSlot('campaign');
  assert.equal(typeof text, 'string');
  assert.equal(a.exportSlot('nope'), null);

  const b = createStorage({ backend: createFakeStorage(), now: () => 77 });
  const peek = b.importJson(text);
  assert.ok(peek.ok);
  assert.deepEqual(peek.state, state);
  assert.equal(b.list().length, 0, 'importJson without a slot does not store');
  const stored = b.importJson(text, { slot: 'From File' });
  assert.ok(stored.ok);
  assert.equal(stored.slot, 'from_file');
  assert.equal(b.meta('from_file').name, 'Campaign');
  assert.deepEqual(b.load('from_file').state, state);

  assert.equal(b.importJson('nonsense').error, 'corrupt_save');
  assert.equal(b.importJson('{"a":1}').error, 'not_a_save_file');
  assert.equal(b.importJson('[1,2]').error, 'not_a_save_file');
  // a bare game state (debug export) is accepted
  const bare = b.importJson(JSON.stringify(state), { store: true });
  assert.ok(bare.ok);
  assert.deepEqual(bare.state, state);
  // exportState does not need a slot
  const direct = JSON.parse(a.exportState(state, 'Quick'));
  assert.equal(direct.format, SAVE_FORMAT);
  assert.equal(direct.meta.name, 'Quick');
});

test('uses the game codec when provided (serialize / deserialize)', () => {
  const calls = [];
  const store = createStorage({ backend: createFakeStorage() });
  store.setCodec({
    serialize: (s) => { calls.push('ser'); return JSON.stringify({ wrapped: s }); },
    deserialize: (text) => { calls.push('de'); return JSON.parse(text).wrapped; },
  });
  const state = sampleState();
  assert.ok(store.save('x', state).ok);
  assert.deepEqual(store.load('x').state, state);
  assert.deepEqual(calls, ['ser', 'de']);
  // a codec returning an object instead of a string is tolerated
  store.setCodec({ serialize: (s) => ({ v: s }), deserialize: (text) => JSON.parse(text).v });
  store.save('y', state);
  assert.deepEqual(store.load('y').state, state);
  store.setCodec({ deserialize: () => { throw new Error('bad version'); } });
  assert.equal(store.load('y').error, 'corrupt_save');
  store.setCodec();
  assert.ok(store.load('x').state.wrapped, 'fallback JSON codec');
});

test('helpers: slotId, buildSaveMeta on partial states, memory backend, no localStorage in Node', () => {
  assert.equal(slotId('  Hello, World!  '), 'hello_world');
  assert.equal(slotId(''), 'save');
  assert.equal(slotId('x'.repeat(100)).length, 40);
  const meta = buildSaveMeta({}, { slot: 's', now: 1 });
  assert.deepEqual(meta.players, []);
  assert.equal(meta.turn, null);
  assert.equal(buildSaveMeta(null, { slot: 's' }).mapSize, null);
  const mem = memoryBackend();
  mem.setItem('a', 1);
  assert.equal(mem.getItem('a'), '1');
  mem.removeItem('a');
  assert.equal(mem.getItem('a'), null);
  assert.equal(safeLocalStorage(), null);
  const store = createStorage();
  assert.equal(store.persistent, false);
  assert.ok(store.save('m', sampleState()).ok, 'falls back to memory');
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
  const st = createStorage({ backend: throwing });
  assert.deepEqual(st.list(), []);
  assert.equal(st.save('a', sampleState()).error, 'storage_failed');
});

test('settings: defaults, persistence, sanitising, subscribe, reset', () => {
  const backend = createFakeStorage();
  const s = createSettings(backend);
  assert.deepEqual(s.all(), DEFAULT_SETTINGS);
  const seen = [];
  const off = s.subscribe((k, v) => seen.push([k, v]));
  assert.equal(s.set('volume', 0.8), 0.8);
  assert.equal(s.set('volume', 0.8), 0.8);
  assert.equal(s.set('volume', 7), 1, 'clamped');
  assert.equal(s.set('uiScale', 0.1), 0.5);
  assert.equal(s.set('animSpeed', 'fast'), 1, 'garbage falls back to the default');
  assert.equal(s.set('autosave', 0), false);
  s.set('custom', { a: 1 });
  assert.deepEqual(seen, [['volume', 0.8], ['volume', 1], ['uiScale', 0.5], ['autosave', false], ['custom', { a: 1 }]]);
  assert.equal(JSON.parse(backend.getItem(SETTINGS_KEY)).volume, 1);

  const again = createSettings(backend);
  assert.equal(again.get('volume'), 1);
  assert.equal(again.get('autosave'), false);
  assert.equal(again.get('showGrid'), false);
  off();
  s.reset();
  assert.equal(s.get('volume'), DEFAULT_SETTINGS.volume);
  assert.equal(seen.length, 5, 'unsubscribed');
  backend.setItem(SETTINGS_KEY, '{broken');
  assert.deepEqual(createSettings(backend).all(), DEFAULT_SETTINGS);
  backend.setItem(SETTINGS_KEY, JSON.stringify({ volume: 'loud', muted: 1 }));
  const fixed = createSettings(backend);
  assert.equal(fixed.get('volume'), DEFAULT_SETTINGS.volume);
  assert.equal(fixed.get('muted'), true);
});
