#!/usr/bin/env node
// Review helper: tiles images onto a grey checker sheet (one PNG) so many generated sprites can be
// looked at in one go.  node tools/genart/contact-sheet.mjs out.png [--cell 160] [--cols 8] file...
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '../png-lite.mjs';
import { resize, blit } from './imageops.mjs';

const args = process.argv.slice(2);
const out = args.shift();
const take = (n, d) => { const i = args.indexOf(`--${n}`); if (i < 0) return d; const v = Number(args[i + 1]); args.splice(i, 2); return v; };
const cell = take('cell', 160);
const cols = take('cols', 8);
const files = args;
const rows = Math.ceil(files.length / cols);
const W = cols * cell; const H = rows * cell;
const sheet = { width: W, height: H, data: new Uint8Array(W * H * 4) };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = ((x >> 4) + (y >> 4)) & 1 ? 120 : 140;
  const edge = x % cell === 0 || y % cell === 0;
  const o = (y * W + x) * 4;
  sheet.data[o] = sheet.data[o + 1] = sheet.data[o + 2] = edge ? 40 : c; sheet.data[o + 3] = 255;
}
files.forEach((f, i) => {
  let img = decodePng(readFileSync(f));
  const k = Math.min(1, (cell - 6) / Math.max(img.width, img.height));
  if (k < 1) img = resize(img, Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  const cx = (i % cols) * cell; const cy = Math.floor(i / cols) * cell;
  blit(sheet, img, cx + Math.round((cell - img.width) / 2), cy + cell - 3 - img.height);
});
writeFileSync(out, encodePng(sheet));
console.log(`${out}: ${files.length} images, ${cols}x${rows}`);
