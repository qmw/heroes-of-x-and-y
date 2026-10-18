import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressUtf16, decompressUtf16, lzCompress, lzDecompress } from '../../src/ui/lz.js';
import { createRng, randInt, pick } from '../../src/core/rng.js';

const roundTrip = (s) => assert.equal(decompressUtf16(compressUtf16(s)), s);

test('round-trips edge cases', () => {
  for (const s of ['', 'a', 'aa', 'ab', 'abababababababab', 'x'.repeat(10000), '{"a":1}', 'ąęłżź ünïcödé', '\u0000\u0001ÿĀ',
    '😀 emoji with surrogates 🐉', 'TOBEORNOTTOBEORTOBEORNOT#']) roundTrip(s);
});

test('round-trips random strings of every alphabet size and length', () => {
  const rng = createRng(99);
  const alphabets = ['ab', 'abcdefgh', '{}[]",:0123456789abcdefghijklmnopqrstuvwxyz_', 'ĀāĂăĄąĆć€✓'];
  for (let n = 0; n < 300; n++) {
    const alpha = pick(rng, alphabets);
    const len = randInt(rng, 0, n < 250 ? 200 : 20000);
    let s = '';
    for (let i = 0; i < len; i++) s += alpha[randInt(rng, 0, alpha.length - 1)];
    roundTrip(s);
  }
});

test('output is storage-safe UTF-16 (no surrogates, no control chars) and compresses game-like JSON well', () => {
  const tiles = [];
  for (let y = 0; y < 72; y++) for (let x = 0; x < 72; x++) tiles.push({ t: x % 7 ? 'grass' : 'dirt', road: 0, river: 0, obj: null, blocked: false });
  const json = JSON.stringify({ map: { width: 72, height: 72, tiles }, players: [{ id: 0, resources: { gold: 1000 } }] });
  const packed = compressUtf16(json);
  for (let i = 0; i < packed.length; i++) {
    const c = packed.charCodeAt(i);
    assert.ok(c >= 32 && c < 0xd800, `char ${c}`);
  }
  assert.ok(packed.length * 20 < json.length, `ratio ${json.length / packed.length}`);
  assert.equal(decompressUtf16(packed), json);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify({ data: packed })));
});

test('corrupt input yields null (or a wrong string), never a throw or a hang', () => {
  assert.equal(decompressUtf16(''), null);
  assert.equal(decompressUtf16(' '), '');
  const good = compressUtf16('hello hello hello world');
  for (let i = 0; i < good.length; i++) {
    const bad = good.slice(0, i) + String.fromCharCode(32 + ((good.charCodeAt(i) * 7 + 13) % 32768)) + good.slice(i + 1);
    const out = decompressUtf16(bad);
    assert.ok(out === null || typeof out === 'string');
  }
  assert.ok([null, ''].includes(decompressUtf16(good.slice(0, 2))) || typeof decompressUtf16(good.slice(0, 2)) === 'string');
});

test('core codec works with other symbol widths', () => {
  const s = 'the quick brown fox jumps over the lazy dog '.repeat(20);
  const packed = lzCompress(s, 8, (v) => String.fromCharCode(v));
  assert.equal(lzDecompress(packed.length, 128, (i) => packed.charCodeAt(i)), s);
});
