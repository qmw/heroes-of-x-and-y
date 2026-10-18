#!/usr/bin/env node
// Downscales the raw Codex images ($GENART_DIR/raw/<kind>/<key>.png) into the game's art pack
// assets/generated/<kind>/<key>.png (docs/mechanics/generated-art.md). Zero dependencies: PNG
// decode/encode via tools/png-lite.mjs, area-average resize with premultiplied alpha, transparent
// borders trimmed. Backdrops (town screens) are cropped to 800x374. Entries with `variants` also
// write one recoloured copy per variant (magenta parts -> variant colour).
//   GENART_DIR=... node tools/genart/resize.mjs [--only <regex>] [--force]
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, encodeIndexedPng } from '../png-lite.mjs';
import { cleanAlpha, trim, resize, crop, recolorMagenta, borderTransparency, quantize } from './imageops.mjs';
import { RAW_DIR, rawPath, validPng } from './generate.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const OUT_DIR = join(ROOT, 'assets', 'generated');
export const BACKDROP = { w: 800, h: 374 };

/** PNG bytes: 256-colour indexed (about a third of the RGBA size), RGBA when that is smaller. */
export function encodeBest(img) {
  const indexed = encodeIndexedPng(quantize(img, 256));
  if (img.width * img.height < 1200) {
    const full = encodePng(img);
    return full.length < indexed.length ? full : indexed;
  }
  return indexed;
}

/** Process one prompt entry's raw image into its output file(s). Returns written paths. */
export function processEntry(e, raw) {
  const written = [];
  let img = raw;
  if (e.backdrop) {
    // widest band with the town aspect, biased towards the ground half
    const ch = Math.min(img.height, Math.round((img.width * BACKDROP.h) / BACKDROP.w));
    const y0 = Math.round((img.height - ch) * 0.55);
    img = resize(crop(img, 0, y0, img.width, ch), BACKDROP.w, BACKDROP.h);
  } else {
    img = trim(cleanAlpha(img), 1);
    const k = Math.min(1, e.max / Math.max(img.width, img.height));
    img = resize(img, Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  }
  const dir = join(OUT_DIR, e.kind);
  mkdirSync(dir, { recursive: true });
  if (e.variants) {
    for (const [vk, colour] of Object.entries(e.variants)) {
      const p = join(dir, `${vk}.png`);
      writeFileSync(p, encodeBest(recolorMagenta(img, colour)));
      written.push(p);
    }
  } else {
    const p = join(dir, `${e.key}.png`);
    writeFileSync(p, encodeBest(img));
    written.push(p);
  }
  return written;
}

export function outputsOf(e) {
  const keys = e.variants ? Object.keys(e.variants) : [e.key];
  return keys.map((k) => join(OUT_DIR, e.kind, `${k}.png`));
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--only');
  const only = i >= 0 ? new RegExp(args[i + 1]) : null;
  const force = args.includes('--force');
  const all = JSON.parse(readFileSync(new URL('./prompts.json', import.meta.url), 'utf8'));
  let n = 0; let skipped = 0; let missing = 0;
  const warn = [];
  for (const e of all) {
    if (only && !only.test(e.id)) continue;
    const rp = rawPath(e);
    if (!validPng(rp)) { missing++; continue; }
    const outs = outputsOf(e);
    if (!force && outs.every((p) => existsSync(p) && statSync(p).mtimeMs >= statSync(rp).mtimeMs)) { skipped++; continue; }
    const raw = decodePng(readFileSync(rp));
    if (!e.backdrop && borderTransparency(raw) < 0.9) warn.push(`${e.id}: background not transparent (${borderTransparency(raw).toFixed(2)})`);
    processEntry(e, raw);
    n++;
  }
  for (const w of warn) console.warn(`warning: ${w}`);
  console.log(`resize: ${n} processed, ${skipped} up to date, ${missing} without raw image (raw dir ${RAW_DIR})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
