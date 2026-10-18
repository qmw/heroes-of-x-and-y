// Tiny dependency-free PNG reader (Node only: uses node:zlib). Decodes non-interlaced PNGs of any
// colour type / bit depth to RGBA8, and encodes RGBA8 back to PNG (tools/genart/resize.mjs). Used by tools/build-duelyst-manifest.mjs to measure the opaque
// bounding box of sprite frames, and by tests. The input is treated as untrusted data.
import zlib from 'node:zlib';

/**
 * @param {Buffer} buf PNG file contents
 * @returns {{ width: number, height: number, data: Uint8Array }} RGBA8 pixels
 */
export function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('png: bad signature');
  let p = 8; let w = 0; let h = 0; let bd = 8; let ct = 6; let interlace = 0; let pal = null; let trns = null;
  const idat = [];
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') pal = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (interlace) throw new Error('png: interlaced images are not supported');
  if (!w || !h || w > 16384 || h > 16384) throw new Error('png: unreasonable size');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!channels) throw new Error(`png: bad colour type ${ct}`);
  const stride = Math.ceil((w * channels * bd) / 8);
  const bpp = Math.max(1, (channels * bd) >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * h + 1024 });
  if (raw.length < (stride + 1) * h) throw new Error('png: truncated image data');
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  let rp = 0;
  const maxv = (1 << bd) - 1;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++];
    const line = new Uint8Array(raw.buffer, raw.byteOffset + rp, stride).slice();
    rp += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const sample = (k) => {
        if (bd === 8) return line[x * channels + k];
        if (bd === 16) return line[(x * channels + k) * 2];
        const bit = x * bd;
        return (line[bit >> 3] >> (8 - bd - (bit & 7))) & maxv;
      };
      if (ct === 3) {
        const i = sample(0);
        out[o] = pal[i * 3]; out[o + 1] = pal[i * 3 + 1]; out[o + 2] = pal[i * 3 + 2];
        out[o + 3] = trns && i < trns.length ? trns[i] : 255;
      } else if (ct === 6) {
        out[o] = sample(0); out[o + 1] = sample(1); out[o + 2] = sample(2); out[o + 3] = sample(3);
      } else if (ct === 2) {
        out[o] = sample(0); out[o + 1] = sample(1); out[o + 2] = sample(2); out[o + 3] = 255;
      } else {
        const g = bd < 8 ? Math.round((sample(0) * 255) / maxv) : sample(0);
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = ct === 4 ? sample(1) : 255;
      }
    }
    prev = line;
  }
  return { width: w, height: h, data: out };
}

/**
 * Opaque bounding box of a sheet region, in region coordinates.
 * @returns {[number, number, number, number] | null} [x0, y0, x1, y1] inclusive, null when empty
 */
export function opaqueBounds(img, sx, sy, sw, sh, threshold = 24) {
  let x0 = sw; let y0 = sh; let x1 = -1; let y1 = -1;
  for (let y = 0; y < sh; y++) {
    const yy = sy + y;
    if (yy < 0 || yy >= img.height) continue;
    for (let x = 0; x < sw; x++) {
      const xx = sx + x;
      if (xx < 0 || xx >= img.width) continue;
      if (img.data[(yy * img.width + xx) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

// ---- encoder -------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encode RGBA8 pixels as a PNG (colour type 6, or 2 when every pixel is opaque). Each row picks the
 * filter (none/sub/up/average/paeth) with the smallest sum of absolute values.
 * @param {{ width: number, height: number, data: Uint8Array }} img
 * @returns {Buffer}
 */
export function encodePng({ width: w, height: h, data }) {
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  const ch = opaque ? 3 : 4;
  const stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  const line = new Uint8Array(stride);
  let prev = new Uint8Array(stride);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) for (let k = 0; k < ch; k++) line[x * ch + k] = data[(y * w + x) * 4 + k];
    let best = 0; let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const o = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= ch ? line[i - ch] : 0; const b = prev[i]; const c = i >= ch ? prev[i - ch] : 0;
        let p = 0;
        if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
        else if (f === 4) { const pp = a + b - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const v = (line[i] - p) & 255;
        o[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    raw.set(cand[best], y * (stride + 1) + 1);
    prev = line.slice();
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Encode an indexed (palette) PNG, colour type 3, 8-bit indices, with a tRNS chunk when any
 * palette entry is not opaque.
 * @param {{ width: number, height: number, palette: number[][], index: Uint8Array }} q  palette entries [r,g,b,a]
 */
export function encodeIndexedPng({ width: w, height: h, palette, index }) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    raw.set(index.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 3;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((c, i) => { plte[i * 3] = c[0]; plte[i * 3 + 1] = c[1]; plte[i * 3 + 2] = c[2]; });
  const alphas = palette.map((c) => c[3]);
  let last = -1;
  alphas.forEach((a, i) => { if (a !== 255) last = i; });
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (last >= 0) parts.push(chunk('tRNS', Buffer.from(alphas.slice(0, last + 1))));
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
