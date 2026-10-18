// Pixel operations for the generated-art tools (docs/mechanics/generated-art.md). Zero dependencies:
// images are { width, height, data: Uint8Array RGBA8 } as returned by tools/png-lite.mjs.

/** Opaque bounds [x0, y0, x1, y1] (inclusive) of pixels with alpha > threshold, or null. */
export function alphaBounds(img, threshold = 40) {
  const { width: w, height: h, data } = img;
  let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

export function crop(img, x0, y0, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = y + y0;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < w; x++) {
      const sx = x + x0;
      if (sx < 0 || sx >= img.width) continue;
      const s = (sy * img.width + sx) * 4; const d = (y * w + x) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/** Drop faint alpha noise (alpha <= threshold -> 0) so trimming and edges stay clean. */
export function cleanAlpha(img, threshold = 40) {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] <= threshold) { d[i] = 0; d[i - 1] = 0; d[i - 2] = 0; d[i - 3] = 0; }
  return img;
}

/** Trim fully transparent borders, keeping `pad` px of margin. */
export function trim(img, pad = 1, threshold = 40) {
  const b = alphaBounds(img, threshold);
  if (!b) return img;
  const x0 = Math.max(0, b[0] - pad); const y0 = Math.max(0, b[1] - pad);
  const x1 = Math.min(img.width - 1, b[2] + pad); const y1 = Math.min(img.height - 1, b[3] + pad);
  return crop(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

// 1D area-average resample of `n` channels (float premultiplied), from `sl` samples to `dl`.
function resample1d(src, sl, dl, count, stride, step, getOff) {
  const out = new Float32Array(dl * count * 4);
  const scale = sl / dl;
  for (let line = 0; line < count; line++) {
    const base = getOff(line);
    for (let i = 0; i < dl; i++) {
      const a = i * scale; const b = (i + 1) * scale;
      let r = 0; let g = 0; let bl = 0; let al = 0;
      for (let s = Math.floor(a); s < Math.ceil(b) && s < sl; s++) {
        const wgt = Math.min(b, s + 1) - Math.max(a, s);
        if (wgt <= 0) continue;
        const o = base + s * step;
        r += src[o] * wgt; g += src[o + 1] * wgt; bl += src[o + 2] * wgt; al += src[o + 3] * wgt;
      }
      const d = (line * dl + i) * 4;
      out[d] = r / scale; out[d + 1] = g / scale; out[d + 2] = bl / scale; out[d + 3] = al / scale;
      void stride;
    }
  }
  return out;
}

/** Box-filter (area-average) resize with premultiplied alpha. Downscale only (upscales are copied). */
export function resize(img, dw, dh) {
  const { width: sw, height: sh, data } = img;
  if (dw === sw && dh === sh) return img;
  const pre = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = data[i * 4 + 3] / 255;
    pre[i * 4] = data[i * 4] * a; pre[i * 4 + 1] = data[i * 4 + 1] * a; pre[i * 4 + 2] = data[i * 4 + 2] * a; pre[i * 4 + 3] = data[i * 4 + 3];
  }
  // horizontal: rows of sw -> dw (output laid out row-major dw x sh)
  const h1 = resample1d(pre, sw, dw, sh, 4, 4, (row) => row * sw * 4);
  // vertical: columns of sh -> dh. h1 is dw x sh row-major; treat column x with step dw*4.
  const v = resample1d(h1, sh, dh, dw, 4, dw * 4, (col) => col * 4);
  // v is laid out column-major (col * dh + y); convert back
  const out = new Uint8Array(dw * dh * 4);
  for (let x = 0; x < dw; x++) {
    for (let y = 0; y < dh; y++) {
      const s = (x * dh + y) * 4; const d = (y * dw + x) * 4;
      const a = v[s + 3];
      if (a < 1) continue;
      const k = 255 / a;
      out[d] = Math.min(255, Math.round(v[s] * k)); out[d + 1] = Math.min(255, Math.round(v[s + 1] * k));
      out[d + 2] = Math.min(255, Math.round(v[s + 2] * k)); out[d + 3] = Math.min(255, Math.round(a));
    }
  }
  return { width: dw, height: dh, data: out };
}

function rgb2hsv(r, g, b) {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/**
 * Recolour the magenta parts of an image (hue ~300 deg, saturated) to `target` (#rrggbb), keeping
 * their shading: the pixel's brightness scales the target colour; highlights blend towards white.
 * Returns a new image.
 */
export function recolorMagenta(img, target) {
  const [tr, tg, tb] = hex(target);
  const out = new Uint8Array(img.data);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const r = out[i]; const g = out[i + 1]; const b = out[i + 2];
    const [h, s, v] = rgb2hsv(r, g, b);
    const dh = Math.min(Math.abs(h - 300), 360 - Math.abs(h - 300));
    if (dh > 45 || s < 0.25 || v < 0.12) continue;
    const w = Math.min(1, (45 - dh) / 15) * Math.min(1, (s - 0.25) / 0.2);
    // shading: v relative to a fully lit magenta (v = 1) scales the target colour
    const k = Math.min(1.25, v * 1.1);
    let nr = tr * k; let ng = tg * k; let nb = tb * k;
    const white = Math.max(0, 1 - s) * 0.6; // pale pink highlights -> pale target highlights
    nr += (255 - nr) * white; ng += (255 - ng) * white; nb += (255 - nb) * white;
    out[i] = Math.round(r + (Math.min(255, nr) - r) * w);
    out[i + 1] = Math.round(g + (Math.min(255, ng) - g) * w);
    out[i + 2] = Math.round(b + (Math.min(255, nb) - b) * w);
  }
  return { width: img.width, height: img.height, data: out };
}

/** Fraction of fully transparent pixels on the outer `m` px border (1 = clean cut-out). */
export function borderTransparency(img, m = 4) {
  const { width: w, height: h, data } = img;
  let n = 0; let t = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x >= m && y >= m && x < w - m && y < h - m) continue;
    n++; if (data[(y * w + x) * 4 + 3] < 30) t++;
  }
  return n ? t / n : 1;
}

/** Composite onto a solid colour (contact sheets). */
export function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const yy = y + dy; if (yy < 0 || yy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const xx = x + dx; if (xx < 0 || xx >= dst.width) continue;
      const s = (y * src.width + x) * 4; const d = (yy * dst.width + xx) * 4;
      const a = src.data[s + 3] / 255;
      for (let k = 0; k < 3; k++) dst.data[d + k] = Math.round(src.data[s + k] * a + dst.data[d + k] * (1 - a));
      dst.data[d + 3] = 255;
    }
  }
}

/**
 * Median-cut colour quantisation to at most `max` RGBA colours (no dithering: pixel art).
 * @returns {{ width, height, palette: number[][], index: Uint8Array }}
 */
export function quantize(img, max = 256) {
  const { data } = img;
  const hist = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const key = a === 0 ? -1 : ((data[i] >> 3) << 15) | ((data[i + 1] >> 3) << 10) | ((data[i + 2] >> 3) << 5) | (a >> 3);
    let e = hist.get(key);
    if (!e) { e = { n: 0, r: 0, g: 0, b: 0, a: 0 }; hist.set(key, e); }
    e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; e.a += a;
  }
  const transparent = hist.get(-1);
  hist.delete(-1);
  const cols = [...hist.values()].map((e) => ({ n: e.n, c: [e.r / e.n, e.g / e.n, e.b / e.n, e.a / e.n] }));
  const target = max - (transparent ? 1 : 0);
  let boxes = [cols];
  const range = (box) => {
    let best = -1; let ch = 0;
    for (let k = 0; k < 4; k++) {
      let lo = 1e9; let hi = -1e9;
      for (const p of box) { if (p.c[k] < lo) lo = p.c[k]; if (p.c[k] > hi) hi = p.c[k]; }
      const wgt = k === 3 ? 1.5 : k === 1 ? 1.2 : 1;
      const n = box.reduce((s, p) => s + p.n, 0);
      const score = (hi - lo) * wgt * Math.sqrt(n);
      if (score > best) { best = score; ch = k; }
    }
    return { best, ch };
  };
  while (boxes.length < target) {
    let bi = -1; let bs = 0; let bch = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; const r = range(b); if (r.best > bs) { bs = r.best; bi = i; bch = r.ch; } });
    if (bi < 0) break;
    const box = boxes[bi].sort((p, q) => p.c[bch] - q.c[bch]);
    const total = box.reduce((s, p) => s + p.n, 0);
    let acc = 0; let cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += box[i].n; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  const palette = [];
  if (transparent) palette.push([0, 0, 0, 0]);
  for (const b of boxes) {
    const n = b.reduce((s, p) => s + p.n, 0);
    const c = [0, 0, 0, 0];
    for (const p of b) for (let k = 0; k < 4; k++) c[k] += p.c[k] * p.n;
    palette.push(c.map((v) => Math.round(v / n)));
  }
  const index = new Uint8Array(img.width * img.height);
  const cache = new Map();
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3];
    if (a === 0 && transparent) { index[p] = 0; continue; }
    const key = (data[i] << 24 >>> 0) + (data[i + 1] << 16) + (data[i + 2] << 8) + a;
    let best = cache.get(key);
    if (best === undefined) {
      let bd = Infinity; best = 0;
      for (let j = transparent ? 1 : 0; j < palette.length; j++) {
        const q = palette[j];
        const dr = q[0] - data[i]; const dg = q[1] - data[i + 1]; const db = q[2] - data[i + 2]; const da = q[3] - a;
        const d = dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.7 + da * da * 2;
        if (d < bd) { bd = d; best = j; }
      }
      cache.set(key, best);
    }
    index[p] = best;
  }
  return { width: img.width, height: img.height, palette, index };
}
