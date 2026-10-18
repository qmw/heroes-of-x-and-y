// Asset-pack layer (docs/mechanics/asset-packs.md): registry + licences, manifest, mapping ids,
// the sync-canvas / async-paint loader, terrain painter and the gfx priority wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { PACKS, PACK_BY_ID, attributionLines } from '../../src/gfx/packs/registry.js';
import * as M from '../../src/gfx/packs/mapping.js';
import * as P from '../../src/gfx/packs/index.js';
import { resolveSprite as resolveDuelyst } from '../../src/gfx/duelyst/mapping.js';
import { ARTIFACTS } from '../../src/data/artifacts.js';
import { CREATURE_BY_ID } from '../../src/data/creatures.js';
import { TERRAIN_BY_ID } from '../../src/data/terrain.js';
import { RESOURCES } from '../../src/core/constants.js';
import { getSfxUrl } from '../../src/gfx/duelyst/audioMap.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const manifest = JSON.parse(readFileSync(join(ASSETS, 'packs-manifest.json'), 'utf8'));
const ARTIFACT_IDS = new Set(ARTIFACTS.map((a) => a.id));

// ---------------------------------------------------------------- registry + licences

test('every pack is registered with source, licence and a licence file next to its files', () => {
  assert.ok(PACKS.length >= 1);
  const allowed = new Set(['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'LicenseRef-Project-Generated']);
  for (const p of PACKS) {
    for (const k of ['id', 'name', 'author', 'url', 'license', 'licenseUrl', 'licenseFile', 'usedFor']) assert.ok(p[k], `${p.id}.${k}`);
    assert.ok(allowed.has(p.license), `${p.id}: licence ${p.license} not allowed (no SA/GPL/unclear)`);
    assert.match(p.url, /^https:\/\//);
    const lic = join(ASSETS, p.id, p.licenseFile);
    assert.ok(existsSync(lic), `${p.id}: licence file missing`);
    const text = readFileSync(lic, 'utf8');
    assert.ok(text.includes(p.url), `${p.id}: licence file names the source page`);
    if (p.license === 'CC0-1.0') assert.match(text, /CC0 1\.0 Universal/);
    else if (p.license === 'LicenseRef-Project-Generated') assert.ok(text.includes(p.note), `${p.id}: licence note`);
    else {
      assert.ok(p.attribution && p.attribution.length > 10, `${p.id}: CC-BY needs an attribution line`);
      assert.ok(text.includes(p.licenseUrl), `${p.id}: licence file links the licence`);
    }
  }
  assert.equal(attributionLines().length, PACKS.filter((p) => p.license.startsWith('CC-BY')).length);
  assert.equal(PACK_BY_ID.generated.license, 'LicenseRef-Project-Generated', 'only the project\'s own generated art is not CC');
  assert.equal(PACK_BY_ID['lpc-siege-weapons'].license, 'CC-BY-4.0');
});

test('CREDITS.md and the Credits screen name every pack', () => {
  const credits = readFileSync(join(ASSETS, 'CREDITS.md'), 'utf8');
  const screen = readFileSync(join(ROOT, 'src/ui/screens/credits.js'), 'utf8');
  for (const p of PACKS) {
    assert.ok(credits.includes(p.url), `CREDITS.md lists ${p.id}`);
    assert.ok(credits.includes(p.license.replace(/-1\.0$/, '')), `CREDITS.md gives the licence of ${p.id}`);
  }
  assert.match(screen, /packs\/registry\.js/, 'credits screen renders the registry');
});

// ---------------------------------------------------------------- manifest + files

test('manifest lists exactly the mapped files, all present on disk', () => {
  assert.equal(manifest.version, 1);
  // generated pictures that are still to be made are mapped but absent (procedural meanwhile)
  const mapped = M.mappedFiles().filter((rel) => !rel.startsWith('generated/') || existsSync(join(ASSETS, rel)));
  assert.deepEqual(Object.keys(manifest.files).sort(), mapped);
  for (const rel of mapped) {
    assert.ok(existsSync(join(ASSETS, rel)), rel);
    const packId = rel.split('/')[0];
    assert.ok(PACK_BY_ID[packId], `${rel}: pack registered`);
    const e = manifest.files[rel];
    assert.ok(e.bytes > 0, rel);
    if (rel.endsWith('.png')) assert.ok(e.w > 0 && e.h > 0, rel);
  }
  for (const id of Object.keys(M.UNIT_SHEETS)) {
    const u = manifest.units[id];
    assert.ok(u && u.b && u.rows.right && u.rows.left, `${id} bounds`);
    assert.ok(u.b[2] > u.b[0] && u.b[3] > u.b[1]);
  }
});

test('pack folders hold only mapped files plus the licence (pruned)', () => {
  const mapped = new Set(M.mappedFiles());
  for (const p of PACKS) {
    for (const f of readdirSync(join(ASSETS, p.id), { recursive: true })) {
      if (f === p.licenseFile || !/\.\w+$/.test(f)) continue;
      assert.ok(mapped.has(`${p.id}/${f}`), `unused file assets/${p.id}/${f} (run tools/build-packs-manifest.mjs --prune)`);
    }
  }
});

// ---------------------------------------------------------------- mapping ids

test('mapping tables only use real ids and fill Duelyst gaps', () => {
  for (const id of Object.keys(M.ARTIFACT_ICONS)) {
    assert.ok(ARTIFACT_IDS.has(id), `artifact ${id}`);
    assert.equal(resolveDuelyst('artifact', id), null, `${id} already has Duelyst art`);
  }
  for (const id of Object.keys(M.RESOURCE_ICONS)) {
    assert.ok(RESOURCES.includes(id), `resource ${id}`);
    assert.equal(resolveDuelyst('resource', id), null, `${id} already has Duelyst art`);
  }
  for (const id of Object.keys(M.UNIT_SHEETS)) assert.equal(CREATURE_BY_ID[id] && CREATURE_BY_ID[id].warMachine, true, `war machine ${id}`);
  for (const id of Object.keys(M.TERRAIN_TEXTURES)) assert.ok(TERRAIN_BY_ID[id], `terrain ${id}`);
  for (const id of M.SKIP_DUELYST.creature) assert.ok(CREATURE_BY_ID[id], id);
  for (const id of M.SKIP_DUELYST.artifact) assert.ok(ARTIFACT_IDS.has(id), id);
  assert.equal(M.skipDuelyst('creature', 'ammo_cart'), true);
  assert.equal(M.skipDuelyst('creature', 'pikeman'), false);
  for (const t of Object.values(M.ARTIFACT_ICONS)) if (t.tint) assert.match(t.tint, /^#[0-9a-f]{6}$/i);
  assert.ok(Object.keys(M.ARTIFACT_ICONS).length >= 30);
  assert.equal(M.resolvePackRef('artifact', 'ballista').unit, 'ballista', 'war-machine artifacts show the machine');
  assert.equal(M.resolvePackRef('spell', 'magic_arrow'), null);
});

test('defeat sound comes from the pack when Duelyst has none', () => {
  assert.equal(getSfxUrl('defeat'), 'assets/lrsf-fantasy-sfx/jingle_lose_00.mp3');
  assert.equal(P.getPackSfxUrl('defeat', { baseUrl: 'x/' }), 'x/lrsf-fantasy-sfx/jingle_lose_00.mp3');
  assert.equal(P.getPackSfxUrl('victory'), null);
  for (const rel of Object.values(M.PACK_SFX)) assert.ok(existsSync(join(ASSETS, rel)), rel);
});

// ---------------------------------------------------------------- loader

function fakeEnv() {
  const canvases = [];
  const createCanvas = (w, h) => {
    const ops = [];
    const ctx = {
      ops, imageSmoothingEnabled: true, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1,
      save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
      clearRect() { ops.push(['clear']); }, fillRect() { ops.push(['fillRect', this.globalCompositeOperation]); }, strokeRect() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, ellipse() { ops.push(['ellipse']); }, stroke() {}, fill() {},
      drawImage(img, ...a) { ops.push(['drawImage', img && (img.tag || (img.ctx ? 'canvas' : '?')), ...a]); },
    };
    const c = { width: w, height: h, ctx, getContext: () => ctx };
    canvases.push(c);
    return c;
  };
  const pending = [];
  const loadImage = (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
  const fetchJson = async () => manifest;
  return { createCanvas, loadImage, fetchJson, pending, canvases };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const draws = (c) => c.ctx.ops.filter((o) => o[0] === 'drawImage');

test('nothing before init; unmapped ids are null', async () => {
  P.resetPacks();
  assert.equal(P.getPackSprite('artifact', 'golden_bow'), null);
  assert.equal(P.getPackSpriteInfo('artifact', 'golden_bow'), null);
  const env = fakeEnv();
  await P.initPacks({ ...env, baseUrl: 'base/' });
  assert.equal(P.isPacksReady(), true);
  assert.equal(P.getPackSprite('artifact', 'sword_of_hellfire'), null);
  assert.equal(P.getPackSprite('creature', 'pikeman'), null);
  assert.equal(P.getPackSprite('terrain', 'grass', { variant: 'edge', state: 1 }), null, 'edges stay procedural');
  assert.equal(P.hasPackSprite('artifact', 'golden_bow'), true);
});

test('icons: sync canvas, painted when the image arrives, tint on a layer, failures -> null', async () => {
  P.resetPacks();
  const env = fakeEnv();
  await P.initPacks({ ...env, baseUrl: 'base/' });
  let ready = 0;
  P.onPackSpriteReady(() => { ready++; });
  const c = P.getPackSprite('artifact', 'golden_bow', { size: 44 });
  assert.deepEqual([c.width, c.height], [44, 44]);
  assert.equal(draws(c).length, 0, 'nothing drawn yet');
  assert.equal(P.getPackSprite('artifact', 'golden_bow', { size: 44 }), c, 'cached');
  await tick();
  assert.equal(env.pending.length, 1);
  assert.equal(env.pending[0].url, 'base/7soul1-rpg-icons/W_Gold_Bow.png');
  env.pending[0].resolve({ tag: 'bow', width: 34, height: 34 });
  await tick(); await tick();
  assert.equal(draws(c).length, 1);
  assert.equal(draws(c)[0][1], 'bow');
  assert.equal(c.ctx.imageSmoothingEnabled, false, 'pixel art stays crisp');
  assert.equal(ready, 1);
  const info = P.getPackSpriteInfo('resource', 'wood', { size: 24 });
  assert.deepEqual([info.width, info.height, info.anchorX, info.anchorY], [24, 24, 0, 0]);
  // tinted cloak: recoloured on a separate layer with the 'color' blend
  const t = P.getPackSprite('artifact', 'cape_of_conjuring', { size: 44 });
  await tick();
  env.pending.find((p) => p.url.endsWith('idylwild-icons/cloak.png')).resolve({ tag: 'cloak', width: 32, height: 32 });
  await tick(); await tick();
  assert.ok(env.canvases.some((x) => x !== t && x.ctx.ops.some((o) => o[0] === 'fillRect' && o[1] === 'color')), 'colour blend layer');
  assert.ok(draws(t).length >= 1);
  // a failing image marks the sprite broken -> null -> procedural fallback
  const d = P.getPackSprite('artifact', 'shackles_of_war', { size: 44 });
  assert.ok(d);
  await tick();
  env.pending.find((p) => p.url.endsWith('chain.png')).reject(new Error('404'));
  await tick(); await tick();
  assert.equal(P.getPackSprite('artifact', 'shackles_of_war', { size: 44 }), null);
  assert.equal(P.hasPackSprite('artifact', 'shackles_of_war'), false);
});

test('icon placement scales the opaque part and prefers integer pixel scales', () => {
  const p = P.iconPlacement(32, 32, [6, 2, 27, 29], 44, 0.9);
  assert.deepEqual([p.sx, p.sy, p.sw, p.sh], [6, 2, 22, 28]);
  assert.ok(p.dh <= 44 * 0.9 + 1 && p.dh >= 28);
  assert.equal(p.dx, Math.round((44 - p.dw) / 2));
  const q = P.iconPlacement(34, 34, null, 72, 0.9);
  assert.equal(q.dw, 65, 'x1 would be far too small: plain fit to 90%');
  const r = P.iconPlacement(16, 16, null, 36, 0.9);
  assert.equal(r.dw, 32, 'x2 integer scale when close to the target');
});

test('war machines: layered frames, facing rows, creature geometry, animation info', async () => {
  P.resetPacks();
  const env = fakeEnv();
  await P.initPacks({ ...env, baseUrl: 'base/' });
  const sheet = M.UNIT_SHEETS.ballista;
  const c = P.getPackSprite('creature', 'ballista', { size: 80, state: 'shoot', frame: 3, playerColor: 'blue' });
  const info = P.getPackSpriteInfo('creature', 'ballista', { size: 80 });
  const w = CREATURE_BY_ID.ballista.size === 2 ? 160 : 80;
  assert.deepEqual([c.width, c.height], [w, 80]);
  assert.deepEqual([info.width, info.height, info.anchorX, info.anchorY], [w, 80, w / 2, Math.round(80 * 0.92)]);
  await tick();
  assert.equal(env.pending.length, sheet.layers.length, 'one request per layer');
  for (const p of env.pending) p.resolve({ tag: p.url.replace(/^.*\//, ''), width: 768, height: 1024 });
  await tick(); await tick();
  const d = draws(c);
  assert.deepEqual(d.map((x) => x[1]), sheet.layers.map((l) => l.replace(/^.*\//, '')), 'layers in order');
  assert.deepEqual(d[0].slice(2, 4), [3 * 128, sheet.rows.right * 128], 'column = frame, row = right side view');
  assert.ok(c.ctx.ops.some((o) => o[0] === 'ellipse'), 'player ring');
  const left = P.getPackSprite('creature', 'ballista', { size: 80, facing: -1 });
  assert.equal(draws(left)[0][3], sheet.rows.left * 128, 'left-facing row');
  const a = P.getPackAnimationInfo('creature', 'ballista', 'shoot');
  assert.deepEqual([a.frames, a.loop], [6, false]);
  assert.equal(P.getPackAnimationInfo('creature', 'ballista', 'idle').frames, 1);
  assert.equal(P.getPackAnimationInfo('creature', 'pikeman', 'idle'), null);
  assert.equal(P.packFrameIndex(6, 'shoot', { frame: 9 }), 5, 'clamped');
  assert.equal(P.packFrameIndex(6, 'dead', {}), 5);
  assert.equal(P.packFrameIndex(4, 'idle', { frame: 5 }), 1, 'loops');
  // artifact slot: the same machine in a square box
  const icon = P.getPackSprite('artifact', 'catapult', { size: 44 });
  assert.deepEqual([icon.width, icon.height], [44, 44]);
});

test('terrain painter: texture base continuous across tiles, edges masked, procedural until loaded', async () => {
  P.resetPacks();
  const env = fakeEnv();
  await P.initPacks({ ...env, baseUrl: 'base/' });
  const target = env.createCanvas(64, 64);
  assert.equal(P.terrainPackPainter.base(target.ctx, 0, 0, 32, 'grass', { seed: '5,2,0' }), false, 'not loaded yet');
  assert.equal(P.getPackSprite('terrain', 'grass', { size: 32, variant: 1 }), null, 'no blank terrain tile while loading');
  assert.equal(P.terrainPackPainter.base(target.ctx, 0, 0, 32, 'water', {}), false, 'water stays procedural');
  await tick();
  env.pending.find((p) => p.url === `base/${M.TERRAIN_TEXTURES.grass.file}`).resolve({ tag: 'grass', width: 128, height: 128 });
  await tick(); await tick();
  assert.equal(P.terrainPackPainter.base(target.ctx, 32, 0, 32, 'grass', { seed: '5,2,0' }), true);
  const d = draws(target).at(-1);
  // tile (5,2): 32 texels per tile, 128 px texture -> source (5*32 % 128, 2*32 % 128)
  assert.deepEqual(d.slice(1, 6), ['grass', 32, 64, 32, 32]);
  assert.deepEqual(P.tileCoords(64, 96, 32, {}), [2, 3]);
  assert.deepEqual(P.tileCoords(0, 0, 32, { seed: '-1,7,1' }), [-1, 7]);
  const edge = env.createCanvas(32, 32);
  assert.equal(P.terrainPackPainter.edge(target.ctx, 0, 0, 32, 'grass', edge, { seed: '1,1,0' }, 'edge'), true);
  assert.equal(draws(target).at(-1)[1], 'canvas', 'masked fringe drawn from its cached canvas');
  const n = draws(target).length;
  P.terrainPackPainter.edge(target.ctx, 0, 0, 32, 'grass', edge, { seed: '1,1,0' }, 'shore');
  assert.equal(draws(target).length, n + 2, 'coasts keep the faded procedural surf line');
  const tile = P.getPackSprite('terrain', 'grass', { size: 32, variant: 3 });
  assert.ok(tile && draws(tile).length >= 1);
});

test('gfx index: pack priority per kind and terrain wiring', async () => {
  const gfx = await import('../../src/gfx/index.js');
  const { fakeCanvasFactory } = await import('./fakeCanvas.js');
  gfx.setCanvasFactory(fakeCanvasFactory);
  P.resetPacks();
  const env = fakeEnv();
  await gfx.initArtPacks({ ...env, baseUrl: 'base/' });
  // Duelyst is not initialised in Node: artifacts fall through to the pack, then procedural
  const bow = gfx.getSprite('artifact', 'golden_bow', { size: 44 });
  assert.equal(bow, P.getPackSprite('artifact', 'golden_bow', { size: 44 }));
  assert.notEqual(gfx.getSprite('artifact', 'sword_of_hellfire', { size: 44 }), null);
  assert.equal(gfx.getSprite('creature', 'catapult', { size: 64 }), P.getPackSprite('creature', 'catapult', { size: 64 }));
  assert.equal(gfx.getFrameCount('creature', 'catapult', 'shoot'), 6);
  assert.deepEqual(gfx.getSpriteInfo('creature', 'cannon', { size: 64 }), P.getPackSpriteInfo('creature', 'cannon', { size: 64 }));
  gfx.setUsePacks(false);
  assert.notEqual(gfx.getSprite('artifact', 'golden_bow', { size: 44 }), bow, 'packs off -> procedural');
  gfx.setUsePacks(true);
  // drawTerrainTile uses the texture once loaded and still draws rivers/roads procedurally
  for (const p of env.pending) p.resolve({ tag: p.url.replace(/^.*\//, ''), width: 128, height: 128 });
  await tick(); await tick();
  const target = env.createCanvas(32, 32);
  gfx.drawTerrainTile(target.ctx, 0, 0, 32, { terrain: 'grass', seed: '3,3,0', neighbors: ['sand', null, null, null, null, null, null, null], road: 1, roadMask: 2 });
  const tags = draws(target).map((x) => x[1]);
  assert.equal(tags[0], M.TERRAIN_TEXTURES.grass.file.replace(/^.*\//, ''), 'texture base');
  assert.ok(tags.length >= 2, 'road (and fringe) drawn on top');
});
