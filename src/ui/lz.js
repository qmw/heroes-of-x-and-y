// Zero-dependency LZ compression for save games (an LZW variant with growing code width, in the
// style of lz-string, written from scratch). Pure and synchronous: no DOM, works in Node.
//
// `compressUtf16` packs 15 bits into every UTF-16 code unit (chars 32..32799, never surrogates),
// which suits localStorage: browsers count the quota in UTF-16 code units, so this gets far
// more out of the quota than gzip+base64 (6 bits per char) would.

/** Core compressor: emits `bits`-bit symbols through `toChar`. */
export function lzCompress(input, bits, toChar) {
  if (input == null || input === '') return '';
  const dict = new Map();
  const fresh = new Set();          // single chars added to the dictionary but not yet emitted literally
  const out = [];
  let w = '';
  let enlargeIn = 2;
  let dictSize = 3;
  let numBits = 2;
  let val = 0;
  let pos = 0;

  const writeBit = (b) => {
    val = (val << 1) | b;
    if (pos === bits - 1) { pos = 0; out.push(toChar(val)); val = 0; } else pos++;
  };
  const writeBits = (n, v) => { for (let i = 0; i < n; i++) { writeBit(v & 1); v >>= 1; } };
  const grow = () => { if (--enlargeIn === 0) { enlargeIn = 2 ** numBits; numBits++; } };
  const emit = () => {
    if (fresh.has(w)) {
      const code = w.charCodeAt(0);
      if (code < 256) { writeBits(numBits, 0); writeBits(8, code); } else { writeBits(numBits, 1); writeBits(16, code); }
      grow();
      fresh.delete(w);
    } else {
      writeBits(numBits, dict.get(w));
    }
    grow();
  };

  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i);
    if (!dict.has(c)) { dict.set(c, dictSize++); fresh.add(c); }
    const wc = w + c;
    if (dict.has(wc)) { w = wc; continue; }
    emit();
    dict.set(wc, dictSize++);
    w = c;
  }
  if (w !== '') emit();
  writeBits(numBits, 2);            // end of stream
  for (;;) {                        // flush the last partial symbol
    val <<= 1;
    if (pos === bits - 1) { out.push(toChar(val)); break; }
    pos++;
  }
  return out.join('');
}

/** Core decompressor. Returns null on corrupt input. */
export function lzDecompress(length, resetValue, nextValue) {
  const dict = ['', '', ''];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let w;
  let val = nextValue(0);
  let position = resetValue;
  let index = 1;
  const result = [];

  const readBits = (n) => {
    let bitsOut = 0;
    for (let power = 1, i = 0; i < n; i++, power *= 2) {
      const bit = val & position;
      position >>= 1;
      if (position === 0) { position = resetValue; val = nextValue(index++); }
      if (bit) bitsOut += power;
    }
    return bitsOut;
  };

  let c;
  switch (readBits(2)) {
    case 0: c = String.fromCharCode(readBits(8)); break;
    case 1: c = String.fromCharCode(readBits(16)); break;
    case 2: return '';
    default: return null;
  }
  dict[3] = c;
  w = c;
  result.push(c);
  for (;;) {
    if (index > length) return null;
    let cc = readBits(numBits);
    if (cc === 0 || cc === 1) {
      dict[dictSize++] = String.fromCharCode(readBits(cc === 0 ? 8 : 16));
      cc = dictSize - 1;
      if (--enlargeIn === 0) { enlargeIn = 2 ** numBits; numBits++; }
    } else if (cc === 2) {
      return result.join('');
    }
    let entry;
    if (cc < dictSize && dict[cc] !== undefined && cc >= 3) entry = dict[cc];
    else if (cc === dictSize) entry = w + w.charAt(0);
    else return null;
    result.push(entry);
    dict[dictSize++] = w + entry.charAt(0);
    w = entry;
    if (--enlargeIn === 0) { enlargeIn = 2 ** numBits; numBits++; }
  }
}

/** String -> compact UTF-16 string (safe for localStorage and JSON). */
export function compressUtf16(input) {
  if (input == null) return '';
  return `${lzCompress(String(input), 15, (v) => String.fromCharCode(v + 32))} `;
}

/** Inverse of compressUtf16. Returns null when the data is corrupt. */
export function decompressUtf16(data) {
  if (data == null) return '';
  if (data === '') return null;
  if (data === ' ') return '';
  return lzDecompress(data.length, 16384, (i) => data.charCodeAt(i) - 32);
}
