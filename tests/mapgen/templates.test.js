// Templates, guard formula and guard creature choice (docs/mechanics/mapgen.md §3, §6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../../src/core/rng.js';
import { CREATURE_BY_ID } from '../../src/data/creatures.js';
import { listTemplates, TEMPLATES, expandTemplate, guardStrength, pickGuard, normalizeOptions, MAP_SIZES } from '../../src/engine/mapgen/index.js';

test('at least eight templates with UI metadata, including the default one', () => {
  const list = listTemplates();
  assert.ok(list.length >= 8);
  assert.ok(list.some((t) => t.id === 'default'), 'the new-game screen starts with template "default"');
  for (const t of list) {
    assert.ok(t.id && t.name && t.description, t.id);
    assert.ok(t.players[0] >= 2 && t.players[1] <= 8 && t.players[0] <= t.players[1], t.id);
  }
  assert.equal(new Set(list.map((t) => t.id)).size, list.length);
});

test('every template expands to a connected zone graph with one start zone per player', () => {
  for (const tpl of TEMPLATES) {
    for (const n of new Set([tpl.players[0], tpl.players[1], Math.min(tpl.players[1], 4)])) {
      const { zones, links } = expandTemplate(tpl, n, createRng(7));
      const starts = zones.filter((z) => z.type === 'start');
      assert.equal(starts.length, n, `${tpl.id}/${n}`);
      assert.deepEqual(starts.map((z) => z.owner).sort(), [...Array(n).keys()], `${tpl.id}/${n}`);
      const ids = new Set(zones.map((z) => z.id));
      for (const l of links) assert.ok(ids.has(l.a) && ids.has(l.b) && l.a !== l.b, `${tpl.id}: bad link ${l.a}-${l.b}`);
      // connectivity
      const adj = {};
      for (const l of links) { (adj[l.a] ??= []).push(l.b); (adj[l.b] ??= []).push(l.a); }
      const seen = new Set([zones[0].id]);
      const q = [zones[0].id];
      while (q.length) for (const nb of adj[q.shift()] || []) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
      assert.equal(seen.size, zones.length, `${tpl.id}/${n}: zone graph not connected`);
      for (const z of zones) assert.ok(z.size > 0 && Array.isArray(z.treasure), `${tpl.id}: zone ${z.id}`);
    }
  }
});

test('guard strength follows the original formula and grows with the monster setting', () => {
  // normal map, normal zone: (v - 1000) * 1 + max(0, v - 7500) * 1
  assert.equal(guardStrength(1500, 'normal', 'normal'), 500);
  assert.equal(guardStrength(7000, 'normal', 'normal'), 6000);
  assert.equal(guardStrength(10000, 'normal', 'normal'), 9000 + 2500);
  // weak map: (v - 1500) * 0.75 + max(0, v - 7500) * 0.75
  assert.equal(guardStrength(10000, 'weak', 'normal'), Math.round(8500 * 0.75 + 2500 * 0.75));
  // strong map: (v - 500) * 1.5 + max(0, v - 5000) * 1
  assert.equal(guardStrength(10000, 'strong', 'normal'), 9500 * 1.5 + 5000);
  // zone strength shifts the index; connection guards ignore it
  assert.ok(guardStrength(8000, 'normal', 'strong') > guardStrength(8000, 'normal', 'normal'));
  assert.equal(guardStrength(8000, 'normal', 'strong', true), guardStrength(8000, 'normal', 'normal', true));
  assert.equal(guardStrength(50000, 'none', 'normal'), 0);
  assert.equal(guardStrength(50000, 'normal', 'none'), 0);
  for (const v of [3000, 6000, 12000, 25000]) {
    assert.ok(guardStrength(v, 'weak') < guardStrength(v, 'normal'));
    assert.ok(guardStrength(v, 'normal') < guardStrength(v, 'strong'));
  }
});

test('guard creatures: a real creature whose stack matches the requested strength', () => {
  const rng = createRng(3);
  for (const s of [600, 2500, 9000, 30000, 90000]) {
    for (let k = 0; k < 20; k++) {
      const g = pickGuard(rng, s, ['castle']);
      const c = CREATURE_BY_ID[g.creatureId];
      assert.ok(c && !c.warMachine, g.creatureId);
      assert.ok(g.count >= 1);
      const total = c.aiValue * g.count;
      assert.ok(total > s * 0.5 && total < s * 1.6, `${s}: ${g.count} ${g.creatureId} = ${total}`);
    }
  }
});

test('option normalisation accepts the new-game screen names', () => {
  const o = normalizeOptions({ size: 'L', underground: true, water: 'islands', monsterStrength: 'strong', template: 'ring', players: 3,
    playerSlots: [{ slot: 0, faction: 'castle', hero: 'orrin' }, { slot: 1, faction: 'random', hero: 'random' }, { slot: 2, faction: 'cove' }], seed: '42' });
  assert.equal(o.width, MAP_SIZES.L);
  assert.equal(o.levels, 2);
  assert.equal(o.water, 'islands');
  assert.equal(o.monsters, 'strong');
  assert.deepEqual(o.factions, ['castle', 'random', 'cove']);
  assert.deepEqual(o.heroes, ['orrin', 'random', 'random']);
  assert.equal(o.seed, 42);
  assert.deepEqual(MAP_SIZES, { S: 36, M: 72, L: 108, XL: 144, H: 180, XH: 216, G: 252 });
});
