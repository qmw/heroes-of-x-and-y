#!/usr/bin/env node
// Builds assets/packs-manifest.json for the third-party asset packs (docs/mechanics/asset-packs.md).
//   node tools/build-packs-manifest.mjs [--prune] [--quiet]
// Pack files are untrusted DATA: they are only read (PNG headers / pixels decoded by png-lite),
// never executed. --prune deletes files inside assets/<pack>/ that no mapping uses (the licence
// files are always kept), so the folders hold exactly what the game shows.
import { readFile, readdir, writeFile, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, opaqueBounds } from './png-lite.mjs';
import { PACKS } from '../src/gfx/packs/registry.js';
import { mappedFiles, UNIT_SHEETS } from '../src/gfx/packs/mapping.js';

export const PACKS_MANIFEST_VERSION = 1;
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ASSETS = join(ROOT, 'assets');
const OUT = join(ASSETS, 'packs-manifest.json');

/** Files under `dir`, as paths relative to it (sub-folders included, e.g. the generated pack). */
async function listFiles(dir, prefix = '') {
  const out = [];
  for (const d of (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else out.push(rel);
  }
  return out;
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

const union = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

/** Opaque bounds (frame space) of the frames a unit sheet uses in one row, over every layer. */
function rowBounds(sheet, images, row) {
  let b = null;
  const cols = new Set(Object.values(sheet.anims).flat());
  for (const img of images) for (const col of cols) b = union(b, opaqueBounds(img, col * sheet.fw, row * sheet.fh, sheet.fw, sheet.fh));
  return b;
}

export async function buildPacksManifest({ prune = false, log = console.log } = {}) {
  const problems = [];
  const files = {};
  const wanted = new Set(mappedFiles());
  const packs = {};
  for (const p of PACKS) {
    const dir = join(ASSETS, p.id);
    if (!(await exists(join(dir, p.licenseFile)))) problems.push(`${p.id}: missing licence file ${p.licenseFile}`);
    packs[p.id] = { name: p.name, author: p.author, license: p.license, url: p.url, files: 0 };
    let names = [];
    try { names = await listFiles(dir); } catch { problems.push(`${p.id}: folder assets/${p.id}/ missing`); }
    for (const n of names) {
      const rel = `${p.id}/${n}`;
      if (n === p.licenseFile) continue;
      if (!wanted.has(rel)) {
        if (prune) { await unlink(join(dir, n)); log(`pruned ${rel}`); } else log(`unused ${rel}`);
      }
    }
  }
  const decoded = new Map();
  const pending = [];
  for (const rel of [...wanted].sort()) {
    const full = join(ASSETS, rel);
    if (!(await exists(full))) {
      // the generated pack lists pictures still to be made; they keep the procedural art meanwhile
      if (rel.startsWith('generated/')) pending.push(rel); else problems.push(`missing ${rel}`);
      continue;
    }
    const packId = rel.split('/')[0];
    if (!packs[packId]) { problems.push(`${rel}: pack ${packId} not in registry`); continue; }
    packs[packId].files++;
    const buf = await readFile(full);
    const entry = { bytes: buf.length };
    if (rel.endsWith('.png')) {
      const img = decodePng(buf);
      entry.w = img.width;
      entry.h = img.height;
      // opaque bounds of single images (icons are scaled by their visible part, not the canvas)
      if (img.width <= 256 && img.height <= 256) entry.b = opaqueBounds(img, 0, 0, img.width, img.height);
      decoded.set(rel, img);
    }
    files[rel] = entry;
  }
  const units = {};
  for (const [id, sheet] of Object.entries(UNIT_SHEETS)) {
    const imgs = sheet.layers.map((l) => decoded.get(l)).filter(Boolean);
    if (imgs.length !== sheet.layers.length) continue;
    const rows = Object.fromEntries(Object.entries(sheet.rows).map(([k, row]) => [k, rowBounds(sheet, imgs, row)]));
    units[id] = { b: Object.values(rows).reduce(union, null), rows };
  }
  const manifest = { version: PACKS_MANIFEST_VERSION, packs, files, units };
  await writeFile(OUT, `${JSON.stringify(manifest, null, 1)}\n`);
  return { manifest, problems, pending };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const quiet = process.argv.includes('--quiet');
  const { manifest, problems, pending } = await buildPacksManifest({ prune: process.argv.includes('--prune'), log: quiet ? () => {} : console.log });
  for (const p of problems) console.error(`problem: ${p}`);
  if (!quiet) console.log(`packs-manifest.json: ${Object.keys(manifest.files).length} files, ${Object.keys(manifest.units).length} unit sheets, ${pending.length} generated pictures still to make`);
  process.exitCode = problems.length ? 1 : 0;
}
