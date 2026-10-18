// Duelyst art layer: manifest tool, mapping tables, audio map and the sync sprite loader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { parsePlist, parseAtlas, splitFrameName, packFrame, unpackFrame, atlasToAnimations } from '../../src/gfx/duelyst/plist.js';
import * as M from '../../src/gfx/duelyst/mapping.js';
import * as A from '../../src/gfx/duelyst/audioMap.js';
import * as D from '../../src/gfx/duelyst/index.js';
import { CREATURES } from '../../src/data/creatures.js';
import { HEROES } from '../../src/data/heroes.js';
import { SPELLS } from '../../src/data/spells.js';
import { SKILL_IDS } from '../../src/data/skills.js';
import { TERRAIN_DATA } from '../../src/data/terrain.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ASSETS = join(ROOT, 'assets/duelyst');
const MAN = join(ROOT, 'assets/duelyst-manifest');
const HAVE_ASSETS = existsSync(join(ASSETS, 'units'));
const load = (n) => JSON.parse(readFileSync(join(MAN, `${n}.json`), 'utf8'));
const units = load('units').sheets;
const icons = load('icons').sheets;
const fxs = load('fx').sheets;
const assetExists = (p) => existsSync(join(ASSETS, p));

// ---------------------------------------------------------------- plist parser + atlas math

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>frames</key><dict>
    <key>x_unit_idle_001.png</key><dict>
      <key>frame</key><string>{{10,0},{100,100}}</string><key>offset</key><string>{0,0}</string>
      <key>rotated</key><false/><key>sourceColorRect</key><string>{{0,0},{100,100}}</string><key>sourceSize</key><string>{100,100}</string></dict>
    <key>x_unit_idle_000.png</key><dict>
      <key>frame</key><string>{{200,4},{40,60}}</string><key>offset</key><string>{5,-10}</string>
      <key>rotated</key><true/><key>sourceSize</key><string>{100,100}</string></dict>
    <key>x_unit_attack_000.png</key><dict>
      <key>frame</key><string>{{0,0},{100,100}}</string><key>rotated</key><false/><key>sourceSize</key><string>{100,100}</string></dict>
  </dict>
  <key>metadata</key><dict><key>format</key><integer>2</integer><key>size</key><string>{512,256}</string>
    <key>textureFileName</key><string>x_unit.png</string><key>note</key><string>a &amp; b</string><key>n</key><real>1.5</real>
    <key>list</key><array><integer>1</integer><string>two</string><true/></array></dict>
</dict></plist>`;

test('plist parser reads dicts, arrays, scalars and entities', () => {
  const p = parsePlist(SAMPLE);
  assert.equal(p.metadata.format, 2);
  assert.equal(p.metadata.note, 'a & b');
  assert.equal(p.metadata.n, 1.5);
  assert.deepEqual(p.metadata.list, [1, 'two', true]);
  assert.equal(Object.keys(p.frames).length, 3);
  assert.throws(() => parsePlist('<plist><dict><key>a</key>'), /unexpected end|unbalanced/);
});

test('atlas frames: rotated + trimmed offsets and animation grouping', () => {
  const atlas = parseAtlas(parsePlist(SAMPLE));
  assert.equal(atlas.texture, 'x_unit.png');
  assert.equal(atlas.width, 512);
  const rot = atlas.frames.find((f) => f.name === 'x_unit_idle_000.png');
  // trimmed 40x60 in a 100x100 source, centre offset (+5 right, -10 = 10 down)
  assert.deepEqual([rot.w, rot.h, rot.rot, rot.ox, rot.oy], [40, 60, true, 35, 30]);
  assert.deepEqual(splitFrameName('x_unit_idle_000.png', 'x_unit'), { anim: 'idle', index: 0 });
  assert.deepEqual(splitFrameName('fx_puff_012.png', 'fx_puff'), { anim: '', index: 12 });
  assert.deepEqual(splitFrameName('foo_hurt_003.png', 'bar'), { anim: 'hurt', index: 3 });
  const { fw, fh, anims } = atlasToAnimations(atlas, 'x_unit');
  assert.deepEqual([fw, fh], [100, 100]);
  assert.deepEqual(Object.keys(anims), ['attack', 'idle']);
  assert.deepEqual(anims.idle[1], [10, 0]); // full untrimmed frame packs to [x, y]
  assert.deepEqual(unpackFrame(anims.idle[0], fw, fh), { x: 200, y: 4, w: 40, h: 60, ox: 35, oy: 30, rot: true, sw: 100, sh: 100 });
  assert.deepEqual(packFrame(unpackFrame([7, 9], 80, 80), 80, 80), [7, 9]);
});

test('frameRects / drawFrame handle rotated frames', () => {
  const r = D.frameRects([200, 4, 40, 60, 35, 30, 1, 100, 100], 100, 100);
  assert.deepEqual([r.sx, r.sy, r.sw, r.sh], [200, 4, 60, 40]); // sheet region is h x w
  assert.deepEqual([r.dx, r.dy, r.dw, r.dh], [35, 30, 40, 60]);
  const calls = [];
  const ctx = { save() {}, restore() {}, translate: (x, y) => calls.push(['t', x, y]), rotate: (a) => calls.push(['r', a]), drawImage: (...a) => calls.push(['d', ...a.slice(1)]) };
  D.drawFrame(ctx, {}, [200, 4, 40, 60, 35, 30, 1, 100, 100], 100, 100, 0, 0, 2);
  assert.deepEqual(calls[0], ['t', 70, 180]);
  assert.equal(calls[1][1], -Math.PI / 2);
  assert.deepEqual(calls[2], ['d', 200, 4, 60, 40, 0, 0, 120, 80]);
  calls.length = 0;
  D.drawFrame(ctx, {}, [5, 6], 100, 100, 10, 20, 1);
  assert.deepEqual(calls[0], ['d', 5, 6, 100, 100, 10, 20, 100, 100]);
});

// ---------------------------------------------------------------- manifest

test('manifest covers every atlas on disk and frames lie inside their sheets', { skip: !HAVE_ASSETS }, () => {
  for (const [folder, sheets] of [['units', units], ['icons', icons], ['fx', fxs]]) {
    const plists = readdirSync(join(ASSETS, folder)).filter((f) => f.endsWith('.plist')).map((f) => f.slice(0, -6));
    assert.deepEqual(Object.keys(sheets).sort(), plists.sort(), `${folder}: every plist is in the manifest`);
    for (const [name, s] of Object.entries(sheets)) {
      assert.ok(assetExists(s.s), `${name} sheet file`);
      assert.ok(s.fw > 0 && s.fh > 0 && s.w > 0 && s.h > 0, `${name} sizes`);
      for (const frames of Object.values(s.a)) {
        for (const p of frames) {
          const r = D.frameRects(p, s.fw, s.fh);
          assert.ok(r.sx >= 0 && r.sy >= 0 && r.sx + r.sw <= s.w && r.sy + r.sh <= s.h, `${name} frame inside sheet`);
        }
      }
    }
  }
  const summary = load('summary');
  assert.equal(summary.atlases.units.sheets, Object.keys(units).length);
  assert.deepEqual(summary.skipped, []);
});

test('lists for generals/maps/sfx/music exist and point at real files', { skip: !HAVE_ASSETS }, () => {
  const files = load('files');
  for (const k of ['generals', 'maps', 'profile_icons', 'ui']) {
    assert.ok(files[k].length > 0, k);
    for (const e of files[k]) assert.ok(assetExists(e.f), e.f);
  }
  assert.equal(files.sfx.length, readdirSync(join(ASSETS, 'sfx')).length);
  assert.equal(files.music.length, readdirSync(join(ASSETS, 'music')).length);
});

// ---------------------------------------------------------------- mapping tables

function checkRef(ref, where) {
  assert.ok(ref, `${where}: mapped`);
  if (ref.unit) {
    const s = units[ref.unit];
    assert.ok(s, `${where}: unit ${ref.unit} in manifest`);
    assert.ok(s.b, `${where}: standing bounds measured`);
    for (const st of ['idle', 'attack', 'hit', 'dead', 'move']) assert.ok(D.pickAnimation(s, ref, st), `${where}: ${st} animation`);
    assert.ok(s.a.attack || s.a.cast, `${where}: has an attack/cast animation`);
    if (HAVE_ASSETS) assert.ok(assetExists(s.s), `${where}: sheet file`);
  }
  if (ref.icon) { assert.ok(icons[ref.icon], `${where}: icon ${ref.icon}`); if (HAVE_ASSETS) assert.ok(assetExists(icons[ref.icon].s)); }
  if (ref.fx) {
    assert.ok(fxs[ref.fx], `${where}: fx ${ref.fx}`);
    if (ref.anim !== undefined) assert.ok(fxs[ref.fx].a[ref.anim], `${where}: fx anim ${ref.anim}`);
    if (HAVE_ASSETS) assert.ok(assetExists(fxs[ref.fx].s));
  }
  if (ref.image && HAVE_ASSETS) assert.ok(assetExists(ref.image), `${where}: ${ref.image}`);
}

test('every creature is mapped (or listed as fallback) with all needed animations', () => {
  for (const c of CREATURES) {
    if (M.CREATURE_FALLBACK.includes(c.id)) continue;
    checkRef(M.resolveSprite('creature', c.id), c.id);
  }
  assert.equal(Object.keys(M.CREATURE_SPRITES).length + M.CREATURE_FALLBACK.length, CREATURES.length);
});

test('no two creatures (or heroes) share the same unit + tint', () => {
  const seen = new Map();
  const add = (id, r) => {
    const k = `${r.unit}|${r.tint || ''}`;
    assert.ok(!seen.has(k), `${id} duplicates ${seen.get(k)} (${k})`);
    seen.set(k, id);
  };
  for (const c of CREATURES) add(c.id, M.CREATURE_SPRITES[c.id]);
  for (const h of HEROES) add(`hero:${h.id}`, M.HERO_SPRITES[h.id]);
  // base creatures use distinct units outright
  const baseUnits = new Map();
  for (const c of CREATURES.filter((x) => !x.upgraded)) {
    const unit = M.CREATURE_SPRITES[c.id].unit;
    assert.ok(!baseUnits.has(unit) || M.CREATURE_SPRITES[c.id].tint, `${c.id} reuses ${unit} without tint`);
    baseUnits.set(unit, c.id);
  }
});

test('every hero has a figure and a distinct portrait variant', () => {
  const portraits = new Set();
  for (const h of HEROES) {
    checkRef(M.resolveSprite('hero', h.id), `hero ${h.id}`);
    const p = M.resolveSprite('portrait', h.id);
    checkRef(p, `portrait ${h.id}`);
    const k = `${p.image}|${p.variant}`;
    assert.ok(!portraits.has(k), `portrait ${h.id} duplicates ${k}`);
    portraits.add(k);
  }
});

test('spells, artifacts, skills, resources and stats point at real art', () => {
  for (const s of SPELLS) {
    checkRef(M.resolveSprite('spell', s.id), `spell ${s.id}`);
    checkRef(M.resolveSprite('effect', s.id), `effect ${s.id}`);
  }
  for (const [id, ref] of Object.entries(M.ARTIFACT_ICONS)) checkRef(ref, `artifact ${id}`);
  const artKeys = new Set();
  for (const [id, ref] of Object.entries(M.ARTIFACT_ICONS)) {
    const k = `${ref.icon || ref.unit}|${ref.tint || ''}`;
    assert.ok(!artKeys.has(k), `artifact ${id} duplicates ${k}`);
    artKeys.add(k);
  }
  for (const id of SKILL_IDS) checkRef(M.resolveSprite('skill', id), `skill ${id}`);
  for (const id of Object.keys(M.RESOURCE_ICONS)) checkRef(M.resolveSprite('resource', id), `resource ${id}`);
  for (const id of Object.keys(M.STAT_ICONS)) checkRef(M.resolveSprite('stat', id), `stat ${id}`);
  for (const id of Object.keys(M.COMBAT_FX)) checkRef(M.resolveSprite('effect', id), `fx ${id}`);
  const cov = M.mappingCoverage();
  assert.ok(cov.artifact.mapped >= 150, `artifact coverage ${cov.artifact.mapped}`);
});

test('battlefields cover every terrain and UI files exist', { skip: !HAVE_ASSETS }, () => {
  for (const t of TERRAIN_DATA) {
    const bf = M.BATTLEFIELDS[t.battlefield] || M.BATTLEFIELDS[t.id];
    assert.ok(bf, `battlefield for ${t.id}`);
    for (const f of [bf.background, bf.midground, ...bf.foreground]) assert.ok(assetExists(f), f);
  }
  for (const f of [...Object.values(M.UI_ASSETS), ...Object.values(M.FACTION_CRESTS)]) assert.ok(assetExists(f), f);
});

// ---------------------------------------------------------------- audio

test('audio map: every file exists, lookups cycle and fall back', () => {
  for (const ev of A.SFX_EVENTS) for (const f of A.sfxFiles(ev)) if (HAVE_ASSETS) assert.ok(assetExists(f), `${ev}: ${f}`);
  for (const ctx of A.MUSIC_CONTEXTS) if (HAVE_ASSETS) assert.ok(assetExists(A.MUSIC_MAP[ctx]), ctx);
  for (const ev of ['click', 'coin', 'purchase', 'arrow', 'levelup', 'daystart', 'build', 'recruit', 'victory', 'move', 'death', 'spell_fire', 'spell_air', 'spell_water', 'spell_earth', 'melee_blunt']) {
    assert.ok(A.getSfxUrl(ev), ev);
  }
  assert.equal(A.getSfxUrl('defeat'), 'assets/lrsf-fantasy-sfx/jingle_lose_00.mp3'); // asset-pack fallback
  assert.equal(A.getSfxUrl('no_such_event'), null);
  assert.match(A.getSfxUrl('spell_unknown'), /sfx_spell_manavortex/);
  const a = A.getSfxUrl('move', { index: 0 });
  const b = A.getSfxUrl('move', { index: 1 });
  assert.notEqual(a, b);
  assert.equal(A.getSfxUrl('move', { index: 4 }), a);
  assert.match(A.getMusicUrl('town_castle'), /^assets\/duelyst\/music\/.+\.m4a$/);
  assert.equal(A.getMusicUrl('adventure_nowhere'), A.getMusicUrl('adventure'));
  assert.equal(A.musicContextFor({ screen: 'town', faction: 'inferno' }), 'town_inferno');
  assert.equal(A.getMusicUrl('nope'), null);
});

// ---------------------------------------------------------------- loader

function fakeEnv() {
  const canvases = [];
  const createCanvas = (w, h) => {
    const ops = [];
    const ctx = {
      ops, imageSmoothingEnabled: true, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1,
      save() {}, restore() {}, translate(...a) { ops.push(['translate', ...a]); }, scale(...a) { ops.push(['scale', ...a]); }, rotate() {},
      clearRect() { ops.push(['clear']); }, fillRect() { ops.push(['fillRect']); }, strokeRect() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, ellipse() { ops.push(['ellipse']); }, stroke() {}, fill() {},
      drawImage(img, ...a) { ops.push(['drawImage', img && img.tag, ...a]); },
    };
    const c = { width: w, height: h, ctx, getContext: () => ctx };
    canvases.push(c);
    return c;
  };
  const pending = [];
  const loadImage = (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
  const fetchJson = async (url) => load(url.replace(/^.*\//, '').replace('.json', ''));
  return { createCanvas, loadImage, fetchJson, pending, canvases };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('getDuelystSprite is null before init and for unmapped ids', async () => {
  D.resetDuelyst();
  assert.equal(D.getDuelystSprite('creature', 'pikeman', { size: 64 }), null);
  const env = fakeEnv();
  await D.initDuelyst({ ...env, manifestUrl: 'x/', baseUrl: 'base/' });
  assert.equal(D.getDuelystSprite('creature', 'no_such_creature'), null);
  assert.equal(D.getDuelystSprite('terrain', 'grass'), null);
  assert.equal(D.hasDuelystSprite('creature', 'pikeman'), true);
});

test('getDuelystSprite returns a canvas synchronously and paints when the sheet loads', async () => {
  D.resetDuelyst();
  const env = fakeEnv();
  await D.initDuelyst({ ...env, manifestUrl: 'x/', baseUrl: 'base/' });
  let ready = 0;
  D.onSpriteReady(() => { ready++; });
  const c = D.getDuelystSprite('creature', 'pikeman', { size: 64, state: 'attack', frame: 3, playerColor: 'red' });
  assert.ok(c);
  assert.deepEqual([c.width, c.height], [64, 64]);
  assert.equal(c.ctx.ops.filter((o) => o[0] === 'drawImage').length, 0, 'nothing drawn yet');
  assert.equal(D.getDuelystSprite('creature', 'pikeman', { size: 64, state: 'attack', frame: 3, playerColor: 'red' }), c, 'cached');
  await tick();
  assert.equal(env.pending.length, 1);
  assert.equal(env.pending[0].url, `base/${units.f1_radiantdragoon.s}`);
  env.pending[0].resolve({ tag: 'sheet', width: 1024, height: 1024 });
  await tick(); await tick();
  const draws = c.ctx.ops.filter((o) => o[0] === 'drawImage');
  assert.equal(draws.length, 1);
  const expected = units.f1_radiantdragoon.a.attack[3];
  assert.deepEqual(draws[0].slice(1, 4), ['sheet', expected[0], expected[1]]);
  assert.equal(c.ctx.imageSmoothingEnabled, false);
  assert.ok(c.ctx.ops.some((o) => o[0] === 'ellipse'), 'player ring');
  assert.equal(ready, 1);
  // second sprite on the same sheet paints immediately
  const c2 = D.getDuelystSprite('creature', 'pikeman', { size: 64, facing: -1 });
  assert.ok(c2.ctx.ops.some((o) => o[0] === 'scale' && o[1] === -1), 'mirrored for facing -1');
  // 2-hex creatures get a double-width canvas, feet anchored at 0.92 h
  const info = D.getDuelystSpriteInfo('creature', 'griffin', { size: 50 });
  assert.deepEqual([info.width, info.height, info.anchorX, info.anchorY], [100, 50, 50, 46]);
});

test('tinted sprites, placeholders, failed sheets and animation info', async () => {
  D.resetDuelyst();
  const env = fakeEnv();
  await D.initDuelyst({ ...env, manifestUrl: 'x/', baseUrl: 'base/' });
  const ph = { tag: 'placeholder' };
  const c = D.getDuelystSprite('creature', 'royal_griffin', { size: 40, placeholder: () => ph });
  assert.ok(c.ctx.ops.some((o) => o[0] === 'drawImage' && o[1] === 'placeholder'));
  await tick();
  env.pending[0].resolve({ tag: 'sheet' });
  await tick(); await tick();
  const layer = env.canvases.find((x) => x !== c && x.ctx.ops.some((o) => o[0] === 'fillRect'));
  assert.ok(layer, 'tint applied on a separate layer');
  // failing image -> sprite marked broken -> caller falls back to procedural
  const d = D.getDuelystSprite('creature', 'imp', { size: 40 });
  assert.ok(d);
  await tick();
  env.pending.find((p) => p.url.includes('neutral_zyx')).reject(new Error('404'));
  await tick(); await tick();
  assert.equal(D.hasDuelystSprite('creature', 'imp'), false);
  assert.equal(D.getDuelystSprite('creature', 'imp', { size: 40 }), null);
  const ai = D.getAnimationInfo('creature', 'pikeman', 'attack');
  assert.equal(ai.frames, units.f1_radiantdragoon.a.attack.length);
  assert.equal(ai.loop, false);
  assert.equal(D.getAnimationInfo('creature', 'pikeman', 'idle').anim, 'breathing');
  assert.ok(D.getAnimationInfo('effect', 'fireball').frames > 1);
  assert.equal(D.frameIndex(10, 'dead', {}), 9);
  assert.equal(D.frameIndex(10, 'idle', { frame: 13 }), 3);
  assert.equal(D.frameIndex(8, 'idle', { frame: 2, frames: 4 }), 4);
});

test('portraits, battlefields and icons resolve to URLs / canvases', async () => {
  D.resetDuelyst();
  const env = fakeEnv();
  await D.initDuelyst({ ...env, manifestUrl: 'x/', baseUrl: 'base/' });
  const url = D.getPortraitUrl(HEROES[0].id);
  assert.match(url, /^base\/profile_icons\//);
  const pc = D.getPortraitCanvas(HEROES[0].id, 58, { playerColor: 'blue' });
  assert.deepEqual([pc.width, pc.height], [58, 58]);
  assert.match(D.getBattlefieldBackground('snow'), /vanar\/midground/);
  assert.match(D.getBattlefieldBackground('water'), /battlemap4/);
  assert.equal(D.getBattlefieldLayers('unknown').midground, D.getBattlefieldLayers('grass').midground);
  const icon = D.getDuelystSprite('spell', 'fireball', { size: 32 });
  assert.deepEqual([icon.width, icon.height], [32, 32]);
  assert.ok(D.getDuelystSprite('artifact', 'grail', { size: 44 }));
  const n = await Promise.all([D.preloadSprites([['spell', 'bless']]), tick().then(() => env.pending.at(-1).resolve({ tag: 'x' }))]);
  assert.equal(n[0], 1);
});
