import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeCanvasFactory, drawCount, signature, nanCount, saveBalance } from './fakeCanvas.js';
import * as gfx from '../../src/gfx/index.js';
import { CREATURES } from '../../src/data/creatures.js';
import { HEROES } from '../../src/data/heroes.js';
import { TERRAIN_DATA, ROADS, RIVERS, MAGIC_TERRAINS } from '../../src/data/terrain.js';
import { MAP_OBJECTS } from '../../src/data/mapObjects.js';
import { BUILDINGS } from '../../src/data/buildings.js';
import { ARTIFACTS } from '../../src/data/artifacts.js';
import { SPELLS } from '../../src/data/spells.js';
import { SKILLS } from '../../src/data/skills.js';
import { RESOURCES, FACTIONS, PRIMARY_SKILLS } from '../../src/core/constants.js';
import { creatureHasCustomSpec, STATE_FRAMES } from '../../src/gfx/creatures.js';
import { objectPainterName } from '../../src/gfx/objects.js';
import { townBuildings } from '../../src/gfx/towns.js';

gfx.setCanvasFactory(fakeCanvasFactory);

function check(kind, id, opts, minDraws = 3) {
  const c = gfx.getSprite(kind, id, opts);
  assert.ok(c.width >= 1 && c.height >= 1, `${kind}:${id} size`);
  assert.ok(drawCount(c) >= minDraws, `${kind}:${id} only ${drawCount(c)} draw calls`);
  assert.equal(nanCount(c), 0, `${kind}:${id} drew with NaN/Infinity arguments`);
  assert.equal(saveBalance(c), 0, `${kind}:${id} unbalanced save/restore`);
  return c;
}

test('every creature renders in every state and frame', () => {
  for (const c of CREATURES) {
    for (const [state, n] of Object.entries(STATE_FRAMES)) {
      for (let f = 0; f < n; f++) check('creature', c.id, { state, frame: f, size: 48 }, 10);
    }
  }
});

test('every creature has a hand-tuned spec (no generic fallback)', () => {
  const missing = CREATURES.filter((c) => !creatureHasCustomSpec(c.id)).map((c) => c.id);
  assert.deepEqual(missing, []);
});

test('2-hex creatures get canvases twice as wide; 1-hex are square', () => {
  for (const c of CREATURES) {
    const s = gfx.getSprite('creature', c.id, { size: 40 });
    assert.equal(s.height, 40);
    assert.equal(s.width, c.size === 2 ? 80 : 40, c.id);
  }
});

test('heroes: map figure (horse + boat) and a portrait for every hero', () => {
  for (const h of HEROES) {
    check('hero', h.id, { playerColor: 'blue' }, 10);
    check('hero', h.id, { variant: 'boat', playerColor: 'red' }, 5);
    check('portrait', h.id, {}, 20);
  }
});

test('portraits of all heroes are pairwise distinct', () => {
  const sigs = new Set(HEROES.map((h) => signature(gfx.getSprite('portrait', h.id, { size: 32 }))));
  assert.equal(sigs.size, HEROES.length);
});

test('terrain tiles, variants, edges, roads, rivers, overlays, shroud', () => {
  for (const t of TERRAIN_DATA) {
    for (let v = 0; v < gfx.terrainVariantCount(t.id); v++) check('terrain', t.id, { variant: v, frame: 1 }, 5);
    for (let d = 0; d < 8; d++) check('terrain', t.id, { variant: 'edge', state: d }, 5);
  }
  for (const r of [...ROADS, ...RIVERS]) for (let m = 0; m < 16; m++) check('terrain', r.id, { variant: m }, 3);
  for (const m of MAGIC_TERRAINS) check('terrain', m.id, {}, 2);
  check('terrain', 'shroud', {}, 1);
  check('terrain', 'fog', { variant: 255 }, 1);
  // variants differ
  assert.notEqual(signature(gfx.getSprite('terrain', 'grass', { variant: 0 })), signature(gfx.getSprite('terrain', 'grass', { variant: 1 })));
});

test('drawTerrainTile composes base + edges + road + river + overlay', () => {
  const dst = fakeCanvasFactory(64, 64);
  const ctx = dst.getContext('2d');
  gfx.drawTerrainTile(ctx, 0, 0, 32, {
    terrain: 'dirt', variant: 1, neighbors: ['grass', 'water', 'snow', null, 'grass', 'dirt', 'dirt', 'lava'],
    road: 'dirt_road', roadMask: 5, river: 1, riverMask: 10, overlay: 'magic_plains',
  });
  // base + grass(N) + snow(S) + lava corner NW + river + road + overlay (water is lower priority)
  assert.equal(ctx.log.filter((l) => l.startsWith('drawImage')).length, 7);
});

test('every map object renders; towns for every faction and fort level', () => {
  for (const o of MAP_OBJECTS) {
    const c = check('object', o.id, { playerColor: 'red', frame: 2 }, 1);
    assert.equal(c.width, o.size[0] * 32);
    assert.equal(c.height, o.size[1] * 32);
  }
  for (const f of FACTIONS) for (const st of ['village', 'fort', 'citadel', 'castle']) check('object', 'town', { variant: f, state: st }, 10);
});

test('no map object uses the generic fallback painter', () => {
  const generic = MAP_OBJECTS.filter((o) => objectPainterName(o.id) === 'generic').map((o) => o.id);
  assert.deepEqual(generic, []);
});

test('buildings render for every faction; town backdrops for every faction', () => {
  for (const f of FACTIONS) {
    check('town', f, { size: 120 }, 20);
    for (const id of townBuildings(f)) check('building', id, { variant: f }, 3);
  }
  for (const b of BUILDINGS) check('building', b.id, {}, 3);
});

test('getTownLayout covers every building and has no identical same-z rects', () => {
  for (const f of FACTIONS) {
    const L = gfx.getTownLayout(f);
    for (const id of townBuildings(f)) {
      const r = L[id];
      assert.ok(r, `${f}: ${id} missing from layout`);
      assert.ok(r.w > 0 && r.h > 0 && r.x > -60 && r.x + r.w < 860 && r.y >= -10 && r.y + r.h <= 380, `${f}:${id} out of canvas`);
    }
    const seen = new Set();
    for (const r of Object.values(L)) {
      const k = `${r.z}|${r.x}|${r.y}|${r.w}|${r.h}`;
      assert.ok(!seen.has(k), `${f}: duplicate rect ${k}`);
      seen.add(k);
    }
    const zs = Object.values(L).map((r) => r.z);
    assert.equal(new Set(zs).size, zs.length, `${f}: z values must be unique`);
  }
});

test('icons: artifacts, spells, skills (all levels), resources, morale/luck pips', () => {
  for (const a of ARTIFACTS) check('artifact', a.id, {}, 5);
  for (const s of SPELLS) check('spell', s.id, {}, 5);
  for (const s of [...SKILLS.map((x) => x.id), ...PRIMARY_SKILLS]) for (const lv of ['basic', 'advanced', 'expert', 0]) check('skill', s, { state: lv }, 4);
  for (const r of RESOURCES) check('resource', r, {}, 2);
  for (const id of ['movement', 'mana', 'experience']) check('resource', id, {}, 2);
  for (const id of ['morale', 'luck']) for (let v = -3; v <= 3; v++) check('resource', id, { variant: v }, 2);
});

test('ui, obstacles (incl. siege states) and effects render', () => {
  for (const id of gfx.listIds('ui')) for (const state of ['normal', 'hover', 'pressed', 'disabled']) check('ui', id, { state, playerColor: 'teal' }, 1);
  for (let d = 0; d < 8; d++) check('ui', 'path_arrow', { variant: d, state: 'unreachable' }, 1);
  for (const id of gfx.listIds('obstacle')) for (const state of ['intact', 'damaged', 'destroyed']) check('obstacle', id, { state, variant: 'inferno' }, 2);
  for (const id of gfx.listIds('effect')) for (let f = 0; f < gfx.EFFECT_FRAMES; f++) check('effect', id, { frame: f }, 1);
  for (const s of SPELLS) assert.ok(gfx.listIds('effect').includes(gfx.effectForSpell(s.id)), s.id);
});

test('caching returns the same canvas; mirror and size produce new ones', () => {
  const a = gfx.getSprite('creature', 'pikeman', { size: 64 });
  assert.equal(gfx.getSprite('creature', 'pikeman', { size: 64 }), a);
  assert.notEqual(gfx.getSprite('creature', 'pikeman', { size: 64, facing: -1 }), a);
  assert.notEqual(gfx.getSprite('creature', 'pikeman', { size: 32 }), a);
  // irrelevant options do not fragment the cache
  assert.equal(gfx.getSprite('artifact', 'grail', { playerColor: 'red' }), gfx.getSprite('artifact', 'grail', { playerColor: 'blue' }));
});

test('determinism: identical draw calls after clearCache', () => {
  const sample = [['creature', 'chaos_hydra', { state: 'attack', frame: 1 }], ['portrait', 'sandro'], ['object', 'dragon_utopia'], ['terrain', 'lava', { variant: 2, frame: 3 }], ['building', 'capitol', { variant: 'tower' }], ['spell', 'fireball'], ['town', 'cove']];
  const first = sample.map(([k, id, o]) => signature(gfx.getSprite(k, id, o)));
  gfx.clearCache();
  const second = sample.map(([k, id, o]) => signature(gfx.getSprite(k, id, o)));
  assert.deepEqual(second, first);
});

test('different ids give different draw-call signatures', () => {
  const groups = [
    ['creature', ['pikeman', 'halberdier', 'archer', 'angel', 'arch_angel', 'skeleton', 'lich', 'titan', 'green_dragon', 'red_dragon', 'gold_dragon', 'hydra']],
    ['artifact', ['centaurs_axe', 'titans_gladius', 'ring_of_life', 'orb_of_silt', 'boots_of_speed', 'angel_wings']],
    ['spell', ['magic_arrow', 'lightning_bolt', 'bless', 'curse', 'haste', 'slow', 'resurrection']],
    ['object', ['gold_mine', 'ore_pit', 'sulfur_dune', 'crystal_cavern', 'guardhouse', 'archers_tower', 'shrine_of_magic_incantation', 'shrine_of_magic_gesture']],
    ['skill', SKILLS.map((s) => s.id)],
  ];
  for (const [kind, ids] of groups) {
    const sigs = new Set(ids.map((id) => signature(gfx.getSprite(kind, id))));
    assert.equal(sigs.size, ids.length, kind);
  }
});

test('drawSprite, getSpriteInfo, preload and 9-slice helpers', async () => {
  const dst = fakeCanvasFactory(200, 200).getContext('2d');
  gfx.drawSprite(dst, 'resource', 'gold', 4, 4, { size: 24 });
  gfx.drawPanel(dst, 'parchment', 0, 0, 150, 90);
  gfx.drawButton(dst, 10, 10, 120, 30, { label: 'OK', state: 'hover' });
  gfx.drawDamageNumber(dst, '-25', 50, 50, { t: 0.5 });
  assert.ok(dst.log.filter((l) => l.startsWith('drawImage')).length >= 19);
  const info = gfx.getSpriteInfo('creature', 'behemoth', { size: 50 });
  assert.deepEqual([info.width, info.height, info.anchorX, info.anchorY, info.frames], [100, 50, 50, 46, 4]);
  const oi = gfx.getSpriteInfo('object', 'gold_mine', { size: 32 });
  assert.deepEqual([oi.width, oi.height, oi.anchorX, oi.anchorY], [96, 64, 48, 64]);
  let progress = 0;
  const n = await gfx.preload([['spell', 'fly'], { kind: 'ui', id: 'hourglass', opts: { frame: 2 } }], (d) => { progress = d; });
  assert.equal(n, 2);
  assert.equal(progress, 2);
  assert.equal(gfx.playerColorHex('red'), '#d83a2c');
  assert.equal(gfx.playerColorHex(1), gfx.playerColorHex('blue'));
  assert.ok(gfx.getPalette().factions.castle.main);
  assert.throws(() => gfx.getSprite('nope', 'x'));
  for (const k of gfx.SPRITE_KINDS) assert.ok(gfx.listIds(k).length > 0, k);
});
