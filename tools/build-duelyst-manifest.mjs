#!/usr/bin/env node
// Builds compact JSON manifests for the CC0 Duelyst art in assets/duelyst/.
//   node tools/build-duelyst-manifest.mjs [--assets assets/duelyst] [--out assets/duelyst-manifest] [--quiet] [--no-bounds]
// The asset files are treated as untrusted DATA: they are only read and parsed, never executed.
// Only the used subset of the Duelyst release is shipped; the tool lists whatever is on disk (missing
// folders yield empty lists), so after adding or removing files just re-run it.
// Output format: docs/mechanics/duelyst-assets.md ("Manifest format").
import { readFile, readdir, writeFile, mkdir, open } from 'node:fs/promises';
import { join, resolve, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlist, parseAtlas, atlasToAnimations, unpackFrame } from '../src/gfx/duelyst/plist.js';
import { decodePng, opaqueBounds } from './png-lite.mjs';

export const MANIFEST_VERSION = 1;
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Recursively list files (posix-style relative paths, sorted). */
async function walk(dir, base = dir) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p, base));
    else if (e.isFile()) out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

/** Read image dimensions from a PNG or JPEG header without decoding. Returns [w, h] or null. */
export async function imageSize(file) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (bytesRead >= 24 && buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (bytesRead >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let pos = 2;
      let data = buf.subarray(0, bytesRead);
      // JPEG headers can exceed the first chunk (EXIF/ICC), so fall back to the whole file.
      for (let attempt = 0; attempt < 2; attempt++) {
        pos = 2;
        while (pos + 9 < data.length) {
          if (data[pos] !== 0xff) { pos++; continue; }
          const marker = data[pos + 1];
          if (marker === 0xff) { pos++; continue; }
          if (marker >= 0xd0 && marker <= 0xd9) { pos += 2; continue; }
          const len = data.readUInt16BE(pos + 2);
          const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
          if (isSof) return [data.readUInt16BE(pos + 7), data.readUInt16BE(pos + 5)];
          pos += 2 + len;
        }
        if (attempt === 0) data = await readFile(file);
      }
    }
    return null;
  } finally {
    await fh.close();
  }
}

/**
 * Parse every `<name>.plist` texture atlas of a folder.
 * @returns {Promise<{ sheets: Record<string, any>, skipped: string[] }>}
 */
/**
 * Opaque bounding box (in untrimmed source-frame coordinates) of a unit's standing pose: the union
 * over its `breathing` (else `idle`) frames. The runtime uses it to plant the feet on the hex and
 * to scale units by their real body size instead of the padded frame size.
 */
async function standingBounds(file, sheet) {
  const frames = sheet.a.breathing || sheet.a.breathe || sheet.a.breath || sheet.a.idle || Object.values(sheet.a)[0];
  if (!frames || !frames.length) return null;
  const img = decodePng(await readFile(file));
  let box = null;
  for (const packed of frames) {
    const f = unpackFrame(packed, sheet.fw, sheet.fh);
    if (f.rot) continue; // rotated frames are rare (1 sheet); skip them for the measurement
    const b = opaqueBounds(img, f.x, f.y, f.w, f.h);
    if (!b) continue;
    const r = [b[0] + f.ox, b[1] + f.oy, b[2] + f.ox, b[3] + f.oy];
    box = box ? [Math.min(box[0], r[0]), Math.min(box[1], r[1]), Math.max(box[2], r[2]), Math.max(box[3], r[3])] : r;
  }
  return box;
}

export async function buildAtlasManifest(assetsDir, folder, { bounds = false } = {}) {
  const files = await walk(join(assetsDir, folder));
  const have = new Set(files);
  const sheets = {};
  const skipped = [];
  for (const f of files) {
    if (extname(f) !== '.plist') continue;
    const name = f.slice(0, -'.plist'.length);
    let plist;
    try { plist = parsePlist(await readFile(join(assetsDir, folder, f), 'utf8')); } catch (err) { skipped.push(`${folder}/${f}: ${err.message}`); continue; }
    if (!plist || typeof plist !== 'object' || !plist.frames) { skipped.push(`${folder}/${f}: not a texture atlas`); continue; }
    const atlas = parseAtlas(plist);
    if (!atlas.frames.length) { skipped.push(`${folder}/${f}: no frames`); continue; }
    const png = [`${name}.png`, atlas.texture ? join(f, '..', atlas.texture).split('\\').join('/') : null].find((c) => c && have.has(c));
    if (!png) { skipped.push(`${folder}/${f}: texture missing`); continue; }
    let { width, height } = atlas;
    if (!width || !height) { const s = await imageSize(join(assetsDir, folder, png)); if (s) [width, height] = s; }
    const { fw, fh, anims } = atlasToAnimations(atlas, basename(name));
    sheets[name] = { s: `${folder}/${png}`, w: width, h: height, fw, fh, a: anims };
    if (bounds) {
      try {
        const b = await standingBounds(join(assetsDir, folder, png), sheets[name]);
        if (b) sheets[name].b = b;
      } catch (err) { skipped.push(`${folder}/${png}: bounds: ${err.message}`); }
    }
  }
  return { sheets, skipped };
}

/** Plain image/audio folders: list of base files with dimensions and a has-@2x flag. */
async function buildFileList(assetsDir, folder, { sizes = false } = {}) {
  const files = await walk(join(assetsDir, folder));
  const have = new Set(files);
  const out = [];
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (ext === '.plist' || /@\dx\./.test(f)) continue;
    const entry = { f: `${folder}/${f}` };
    if (sizes && (ext === '.png' || ext === '.jpg')) {
      const s = await imageSize(join(assetsDir, folder, f));
      if (s) { entry.w = s[0]; entry.h = s[1]; }
    }
    if (have.has(f.replace(/(\.[a-z0-9]+)$/i, '@2x$1'))) entry.x2 = 1;
    out.push(entry);
  }
  return out;
}

const ATLAS_FOLDERS = ['units', 'icons', 'fx'];
const MISC_ATLAS_FOLDERS = ['tiles', 'runes'];
const LIST_FOLDERS = ['generals', 'maps', 'profile_icons', 'crests', 'ui', 'modifiers', 'scenes', 'card_backgrounds', 'tiles', 'runes', 'particles'];
const AUDIO_FOLDERS = ['sfx', 'music'];

/** Build all manifests in memory. */
export async function buildManifests(assetsDir, { bounds = true } = {}) {
  const out = {};
  const skipped = [];
  for (const folder of ATLAS_FOLDERS) {
    const r = await buildAtlasManifest(assetsDir, folder, { bounds: bounds && folder === 'units' });
    out[`${folder}.json`] = { version: MANIFEST_VERSION, kind: folder, sheets: r.sheets };
    skipped.push(...r.skipped);
  }
  const misc = {};
  for (const folder of MISC_ATLAS_FOLDERS) {
    const r = await buildAtlasManifest(assetsDir, folder);
    for (const [k, v] of Object.entries(r.sheets)) misc[`${folder}/${k}`] = v;
    skipped.push(...r.skipped.filter((s) => !/not a texture atlas/.test(s)));
  }
  out['misc-atlases.json'] = { version: MANIFEST_VERSION, kind: 'misc', sheets: misc };
  const files = { version: MANIFEST_VERSION };
  for (const folder of LIST_FOLDERS) files[folder] = await buildFileList(assetsDir, folder, { sizes: true });
  for (const folder of AUDIO_FOLDERS) files[folder] = (await buildFileList(assetsDir, folder)).map((e) => e.f);
  out['files.json'] = files;
  const count = (m) => Object.keys(m.sheets).length;
  const frames = (m) => Object.values(m.sheets).reduce((n, s) => n + Object.values(s.a).reduce((k, a) => k + a.length, 0), 0);
  out['summary.json'] = {
    version: MANIFEST_VERSION,
    source: 'https://github.com/open-duelyst/duelyst (CC0-1.0)',
    atlases: Object.fromEntries([...ATLAS_FOLDERS.map((f) => [f, out[`${f}.json`]]), ['misc', out['misc-atlases.json']]]
      .map(([k, m]) => [k, { sheets: count(m), frames: frames(m) }])),
    files: Object.fromEntries([...LIST_FOLDERS, ...AUDIO_FOLDERS].map((f) => [f, files[f].length])),
    skipped,
  };
  return out;
}

/** Stable, compact JSON: one sheet per line so diffs stay readable. */
function serialize(name, data) {
  if (!data.sheets) return JSON.stringify(data, null, name === 'summary.json' ? 2 : 0) + '\n';
  const lines = Object.keys(data.sheets).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(data.sheets[k])}`);
  return `{"version":${data.version},"kind":${JSON.stringify(data.kind)},"sheets":{\n${lines.join(',\n')}\n}}\n`;
}

async function main(argv) {
  const arg = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
  const assetsDir = resolve(ROOT, arg('--assets', 'assets/duelyst'));
  const outDir = resolve(ROOT, arg('--out', 'assets/duelyst-manifest'));
  const quiet = argv.includes('--quiet');
  const manifests = await buildManifests(assetsDir, { bounds: !argv.includes('--no-bounds') });
  await mkdir(outDir, { recursive: true });
  for (const [name, data] of Object.entries(manifests)) {
    const text = serialize(name, data);
    await writeFile(join(outDir, name), text);
    if (!quiet) console.log(`${name.padEnd(20)} ${(text.length / 1024).toFixed(0).padStart(6)} KB`);
  }
  if (!quiet) console.log(JSON.stringify(manifests['summary.json'], null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => { console.error(err); process.exit(1); });
}
