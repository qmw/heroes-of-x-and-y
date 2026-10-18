// Generated art pack (docs/mechanics/generated-art.md): licence, files on disk and their sizes,
// mapping ids, painter geometry (footprint / layout / backdrop / units), flags and gfx priority.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PACK_BY_ID } from '../../src/gfx/packs/registry.js';
import * as M from '../../src/gfx/packs/mapping.js';
import * as G from '../../src/gfx/packs/generated.js';
import * as P from '../../src/gfx/packs/index.js';
import { MAP_OBJECT_BY_ID, MAP_OBJECTS } from '../../src/data/mapObjects.js';
import { BUILDINGS } from '../../src/data/buildings.js';
import { ARTIFACTS } from '../../src/data/artifacts.js';
import { CREATURE_BY_ID } from '../../src/data/creatures.js';
import { decodePng } from '../../tools/png-lite.mjs';
import { fakeCanvasFactory } from './fakeCanvas.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const manifest = JSON.parse(readFileSync(join(ASSETS, 'packs-manifest.json'), 'utf8'));
const MAX_SIDE = { object: 256, building: 384, artifact: 64, unit: 192, hero: 192, siege: 256 };

test('generated pack: registry entry, licence file and credits', () => {
  const p = PACK_BY_ID.generated;
  assert.ok(p, 'registry entry');
  assert.equal(p.license, 'LicenseRef-Project-Generated');
  assert.equal(p.note, 'generated for this project with OpenAI image generation via Codex CLI; owned by the project author');
  const lic = readFileSync(join(ASSETS, 'generated', 'LICENSE.txt'), 'utf8');
  assert.ok(lic.includes(p.note));
  assert.ok(readFileSync(join(ASSETS, 'CREDITS.md'), 'utf8').includes('owned by the project author'));
});

test('generated files in the manifest exist, decode and stay within their size limits', () => {
  const mapped = new Set(G.generatedFiles());
  const present = Object.keys(manifest.files).filter((rel) => rel.startsWith('generated/'));
  assert.ok(present.length >= 150, `${present.length} generated files present`);
  for (const rel of present) {
    assert.ok(mapped.has(rel), `${rel} is mapped`);
    const full = join(ASSETS, rel);
    assert.ok(existsSync(full), `missing ${rel}`);
    const img = decodePng(readFileSync(full));
    const kind = rel.split('/')[1];
    if (kind === 'town') assert.deepEqual([img.width, img.height], [800, 374], rel);
    else assert.ok(Math.max(img.width, img.height) <= (kind === 'siege' ? 256 : MAX_SIDE[kind]), `${rel}: ${img.width}x${img.height}`);
    assert.equal(manifest.files[rel].w, img.width, rel);
  }
  // every mapped picture that exists on disk is in the manifest (re-run tools/build-packs-manifest.mjs)
  for (const rel of mapped) if (existsSync(join(ASSETS, rel))) assert.ok(manifest.files[rel], `${rel} in packs-manifest.json`);
  let total = 0;
  for (const f of readdirSync(join(ASSETS, 'generated'), { recursive: true })) {
    const s = statSync(join(ASSETS, 'generated', f));
    if (s.isFile()) total += s.size;
  }
  assert.ok(total < 40 * 1024 * 1024, `assets/generated is ${(total / 1048576).toFixed(1)} MB`);
});

test('per-faction sets are only used when complete; missing pictures fall back', async () => {
  for (const set of ['townscreen', 'maptown', 'siege']) {
    const done = G.completeFactions(set, manifest.files);
    for (const f of G.GEN_FACTIONS) assert.equal(done.has(f), G.factionSetFiles(set, f).every((x) => manifest.files[x]), `${set} ${f}`);
  }
  P.resetPacks();
  const e = env();
  await P.initPacks({ ...e, baseUrl: 'base/' });
  for (const f of G.GEN_FACTIONS) {
    const usable = G.completeFactions('townscreen', manifest.files).has(f);
    assert.equal(P.getPackSprite('building', 'tavern', { variant: f }) !== null, usable, `tavern @ ${f}`);
    assert.equal(P.getPackSprite('town', f, { size: 100 }) !== null, usable, `backdrop ${f}`);
  }
  for (const id of Object.keys(G.GEN_OBJECTS)) {
    const has = Boolean(manifest.files[G.GEN_OBJECTS[id].file]);
    assert.equal(P.hasPackSprite('object', id), has, `object ${id}`);
  }
});

test('mapping ids are real and cover what the enabled groups promise', () => {
  const artifactIds = new Set(ARTIFACTS.map((a) => a.id));
  for (const id of Object.keys(G.GEN_OBJECTS)) assert.ok(MAP_OBJECT_BY_ID[id], `object ${id}`);
  for (const id of Object.keys(G.GEN_ARTIFACTS)) assert.ok(artifactIds.has(id), `artifact ${id}`);
  for (const id of Object.keys(G.GEN_UNITS)) assert.equal(CREATURE_BY_ID[id] && CREATURE_BY_ID[id].warMachine, true, id);
  if (G.GENERATED_KINDS.has('object')) {
    // every placeable map object except monsters / editor markers has a picture (or keeps procedural art on purpose)
    for (const o of MAP_OBJECTS) {
      if (/monster/.test(o.id) || ['town', 'random_town', 'event'].includes(o.id) || G.GENERATED_OMIT.has(`object/${o.id}`)) continue;
      const shared = G.GEN_OBJECTS[o.id] && G.GEN_OBJECTS[o.id].shared;
      if (shared && !G.GENERATED_KINDS.has('building')) continue;
      assert.ok(M.resolvePackRef('object', o.id), `object ${o.id} mapped`);
    }
    // faction dwellings on the map share the town dwelling picture
    assert.equal(G.GEN_OBJECTS.guardhouse.file, 'generated/building/castle_dwelling_1.png');
    assert.equal(G.GEN_OBJECTS.gold_mine.flag, true);
    assert.equal(G.GEN_OBJECTS.oak_trees_2x2.flag, false);
  }
  if (G.GENERATED_KINDS.has('building')) {
    for (const b of BUILDINGS) for (const f of !b.faction || b.faction === 'common' ? G.GEN_FACTIONS : [b.faction]) {
      const r = M.resolvePackRef('building', b.id, { variant: f });
      assert.ok(r && r.mode === 'building' && r.faction === f, `${b.id} @ ${f}`);
    }
  }
  if (G.GENERATED_KINDS.has('town')) for (const f of G.GEN_FACTIONS) assert.equal(M.resolvePackRef('town', f).mode, 'backdrop');
  for (const f of G.GEN_FACTIONS) assert.equal(M.resolvePackRef('obstacle', 'wall', { variant: f, state: 'damaged' }).file, `generated/siege/${f}_wall_damaged.png`);
  assert.equal(M.resolvePackRef('object', 'monster'), null, 'monsters stay creatures');
});

function env() {
  const pending = [];
  return {
    pending,
    createCanvas: fakeCanvasFactory,
    loadImage: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
    fetchJson: async () => manifest,
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const imgDraws = (c) => c.getContext('2d').log.filter((l) => l.startsWith('drawImage('));

test('object painter: footprint canvas, entrance anchor, contained bottom-centred, flag overlay', async (t) => {
  if (!G.GENERATED_KINDS.has('object')) return t.skip('objects not generated yet');
  P.resetPacks();
  const e = env();
  await P.initPacks({ ...e, baseUrl: 'base/' });
  const info = P.getPackSpriteInfo('object', 'gold_mine', { size: 32 });
  assert.deepEqual(info, { width: 96, height: 64, scale: 1, anchorX: 48, anchorY: 64, frames: 1 });
  const c = P.getPackSprite('object', 'gold_mine', { size: 32, frame: 2 });
  assert.equal(c, P.getPackSprite('object', 'gold_mine', { size: 32, frame: 3 }), 'stills ignore the frame');
  const owned = P.getPackSprite('object', 'gold_mine', { size: 32, playerColor: 'red' });
  assert.notEqual(owned, c);
  const meta = manifest.files[G.GEN_OBJECTS.gold_mine.file];
  await tick();
  for (const p of e.pending) p.resolve({ width: meta.w, height: meta.h });
  await tick(); await tick();
  const d = imgDraws(c);
  assert.equal(d.length, 1);
  const [x, y, w, h] = d[0].slice(10, -1).split(',').slice(1).map(Number);
  assert.ok(w <= 96.01 && h <= 64.01 && (Math.abs(w - 96) < 0.5 || Math.abs(h - 64) < 0.5), 'contained, touching the box');
  assert.ok(Math.abs(y + h - 64) < 0.5 && Math.abs(x + w / 2 - 48) < 0.5, 'bottom-centred');
  assert.ok(owned.getContext('2d').draws > c.getContext('2d').draws, 'flag drawn for the owner');
  // pick-ups are smaller than their tile; decor never gets a flag
  const chest = P.getPackSpriteInfo('object', 'treasure_chest', { size: 40 });
  assert.equal(chest.width, 40);
  const tree = P.getPackSprite('object', 'oak_trees_2x2', { size: 32, playerColor: 'blue' });
  assert.equal(tree, P.getPackSprite('object', 'oak_trees_2x2', { size: 32 }));
});

test('buildings, backdrops, siege pieces and units follow the procedural geometry', async () => {
  const gfx = await import('../../src/gfx/index.js');
  const L = gfx.getTownLayout('rampart').tavern;
  const bref = M.resolvePackRef('building', 'tavern', { variant: 'rampart' });
  assert.match(bref.file, /rampart_tavern\.png$/);
  assert.match(M.resolvePackRef('building', 'tavern', {}).file, /castle_tavern\.png$/, 'common buildings default to castle');
  const bl = P.genLayout('building', 'tavern', bref, {});
  assert.equal(bl.h, L.h);
  assert.ok(Math.abs(bl.w - L.w) <= 1);
  const tl = P.genLayout('town', 'inferno', M.resolvePackRef('town', 'inferno'), { size: 187 });
  assert.deepEqual([tl.w, tl.h], [400, 187]);
  const sl = P.genLayout('obstacle', 'wall', M.resolvePackRef('obstacle', 'wall', { variant: 'tower' }), { size: 122 });
  assert.deepEqual([sl.w, sl.h, sl.ax, sl.ay], [61, 122, 30.5, 122]);
  const ul = P.genLayout('creature', 'ammo_cart', M.resolvePackRef('creature', 'ammo_cart'), { size: 96 });
  assert.deepEqual([ul.w, ul.h, ul.ax, ul.ay], [96, 96, 48, 88]);
  const fit = P.fitBottom(200, 100, 96, 64, 1);
  assert.deepEqual([fit.dw, fit.dh, fit.dx, fit.dy], [96, 48, 0, 16]);
});

test('gfx index: generated art comes before Duelyst and procedural; packs off -> procedural', async (t) => {
  if (!G.GENERATED_KINDS.has('object')) return t.skip('objects not generated yet');
  const gfx = await import('../../src/gfx/index.js');
  gfx.setCanvasFactory(fakeCanvasFactory);
  P.resetPacks();
  const e = env();
  await gfx.initArtPacks({ ...e, baseUrl: 'base/' });
  const s = gfx.getSprite('object', 'windmill', { size: 32 });
  assert.equal(s, P.getPackSprite('object', 'windmill', { size: 32 }));
  assert.deepEqual(gfx.getSpriteInfo('object', 'windmill', { size: 32 }), P.getPackSpriteInfo('object', 'windmill', { size: 32 }));
  gfx.setUsePacks(false);
  assert.notEqual(gfx.getSprite('object', 'windmill', { size: 32 }), s);
  gfx.setUsePacks(true);
  // monsters and unmapped kinds are untouched
  assert.equal(P.getPackSprite('object', 'random_monster', { size: 32 }), null);
});
