// Map editor engine (src/engine/editor): terrain, roads, rivers, objects, properties, undo/redo,
// serialization, validation messages, random-map import. docs/mechanics/editor.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/engine/editor/index.js';
import { MAP_OBJECTS } from '../../src/data/mapObjects.js';
import { validateBlueprint } from '../../src/engine/mapgen/index.js';

const P = (x, y, z = 0) => ({ x, y, z });
const tile = (doc, x, y, z = 0) => doc.bp.map.tiles[z][y][x];
const snap = (doc) => JSON.stringify(doc.bp);

test('blank blueprint: sizes, levels, slots, valid empty-map shape', () => {
  const bp = E.createBlankBlueprint({ size: 'M', levels: 2, terrain: 'snow', players: 3, name: 'X' });
  assert.equal(bp.map.width, 72);
  assert.equal(bp.map.height, 72);
  assert.equal(bp.map.levels, 2);
  assert.equal(bp.map.tiles[0][5][5].t, 'snow');
  assert.equal(bp.map.tiles[1][5][5].t, 'subterranean');
  assert.equal(bp.meta.playerSlots, 3);
  assert.equal(bp.meta.players.length, 3);
  assert.equal(bp.meta.name, 'X');
  const custom = E.createBlankBlueprint({ width: 20, height: 12 });
  assert.equal(custom.map.width, 20);
  assert.equal(custom.meta.size, '20x12');
  // no towns / heroes yet: the validator complains about the empty slots only
  const v = E.validateMap(bp);
  assert.equal(v.ok, false);
  assert.ok(v.errors.every((e) => /neither town nor hero/.test(e.text)));
});

test('terrain brush 1/2/4 and level rules', () => {
  const doc = E.newMap({ size: 'S', levels: 2 });
  assert.ok(E.paintTerrain(doc, P(0, 0), 'sand').ok);
  assert.equal(tile(doc, 0, 0).t, 'sand');
  assert.equal(tile(doc, 1, 0).t, 'grass');
  E.paintTerrain(doc, P(4, 4), 'snow', { brush: 2 });
  assert.deepEqual([tile(doc, 4, 4).t, tile(doc, 5, 5).t, tile(doc, 6, 6).t], ['snow', 'snow', 'grass']);
  E.paintTerrain(doc, P(10, 10), 'lava', { brush: 4 });
  let n = 0;
  for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) if (tile(doc, x, y).t === 'lava') n++;
  assert.equal(n, 16);
  // brush clipped at the edge
  assert.ok(E.paintTerrain(doc, P(35, 35), 'dirt', { brush: 4 }).ok);
  assert.equal(tile(doc, 35, 35).t, 'dirt');
  assert.equal(E.paintTerrain(doc, P(0, 0), 'subterranean').error, 'bad_terrain_for_level');
  assert.equal(E.paintTerrain(doc, P(0, 0, 1), 'grass').error, 'bad_terrain_for_level');
  assert.ok(E.paintTerrain(doc, P(0, 0, 1), 'rock').ok);
  assert.equal(E.paintTerrain(doc, P(99, 0), 'sand').error, 'out_of_bounds');
  assert.equal(E.paintTerrain(doc, P(0, 0), 'nope').error, 'bad_terrain');
});

test('flood fill replaces the contiguous region only', () => {
  const doc = E.newMap({ size: 'S' });
  for (let y = 0; y < 36; y++) E.paintTerrain(doc, P(18, y), 'water');
  const r = E.fillTerrain(doc, P(2, 2), 'sand');
  assert.ok(r.ok);
  assert.equal(r.count, 18 * 36);
  assert.equal(tile(doc, 17, 30).t, 'sand');
  assert.equal(tile(doc, 18, 30).t, 'water');
  assert.equal(tile(doc, 19, 30).t, 'grass');
  assert.equal(E.fillTerrain(doc, P(2, 2), 'sand').changed, false);
});

test('painting water under objects / towns / heroes removes them; roads and rivers are cleared', () => {
  const doc = E.newMap({ size: 'S' });
  E.placeObject(doc, 'town', P(10, 10), { faction: 'castle', ownerSlot: 0 });
  E.placeObject(doc, 'hero', P(20, 20), { ownerSlot: 0 });
  const mine = E.placeObject(doc, 'gold_mine', P(25, 10));
  E.paintRoad(doc, P(5, 5), 2);
  E.paintRiver(doc, P(6, 6), true);
  const r = E.fillTerrain(doc, P(0, 0), 'water');
  assert.ok(r.ok);
  assert.equal(r.removed.length, 3);
  assert.equal(doc.bp.towns.length, 0);
  assert.equal(doc.bp.heroes.length, 0);
  assert.equal(doc.bp.map.objects[mine.ref.id], undefined);
  assert.equal(tile(doc, 5, 5).road, 0);
  assert.equal(tile(doc, 6, 6).river, 0);
  assert.equal(tile(doc, 25, 10).blocked, false);
  // one undo brings everything back
  E.undo(doc);
  assert.equal(doc.bp.towns.length, 1);
  assert.equal(doc.bp.heroes.length, 1);
  assert.ok(doc.bp.map.objects[mine.ref.id]);
  assert.equal(tile(doc, 25, 9).blocked, true);
  assert.equal(tile(doc, 5, 5).road, 2);
});

test('roads and rivers: lines, auto-connect masks, not on water', () => {
  const doc = E.newMap({ size: 'S' });
  E.paintTerrain(doc, P(10, 2), 'water');
  const r = E.paintRoadLine(doc, P(2, 2), P(12, 2), 3);
  assert.ok(r.ok);
  assert.equal(r.skipped, 1);
  assert.equal(tile(doc, 2, 2).road, 3);
  assert.equal(tile(doc, 10, 2).road, 0);
  // mask of a middle tile: west and east neighbours (bits 1 = E, 3 = W)
  assert.equal(E.roadMask(doc.bp, P(5, 2)), (1 << 1) | (1 << 3));
  // diagonal road line is 8-connected
  E.paintRoadLine(doc, P(2, 10), P(6, 14), 1);
  assert.equal(tile(doc, 4, 12).road, 1);
  assert.ok(E.roadMask(doc.bp, P(4, 12)) & (1 << 5)); // SE neighbour
  // rivers: diagonal line becomes 4-connected
  E.paintRiverLine(doc, P(20, 10), P(24, 14), true);
  for (let x = 20; x <= 24; x++) for (let y = 10; y <= 14; y++) {
    if (!tile(doc, x, y).river || (x === 24 && y === 14)) continue;
    const m = E.riverMask(doc.bp, P(x, y));
    assert.ok(m & ((1 << 1) | (1 << 2)), `river at ${x},${y} continues E or S`);
  }
  assert.equal(E.paintRiver(doc, P(10, 2), true).skipped, 1);
  E.paintRoad(doc, P(2, 2), 0);
  assert.equal(tile(doc, 2, 2).road, 0);
  // rivers are refused under objects (not decor)
  E.placeObject(doc, 'windmill', P(30, 30));
  assert.equal(E.paintRiver(doc, P(30, 30), true).skipped, 1);
  assert.equal(E.paintRoad(doc, P(0, 0), 7).error, 'bad_value');
});

test('every object id of mapObjects.js can be placed on a fitting terrain and validates its footprint', () => {
  for (const def of MAP_OBJECTS) {
    const doc = E.newMap({ size: 'S' });
    const water = def.terrains.length && def.terrains.every((t) => t === 'water');
    if (water) E.fillTerrain(doc, P(0, 0), 'water');
    else if (def.terrains.length && !def.terrains.includes('grass')) E.fillTerrain(doc, P(0, 0), def.terrains.find((t) => t !== 'subterranean') || def.terrains[0]);
    const r = E.placeObject(doc, def.id, P(18, 18), def.effect.type === 'mine' && def.id !== 'abandoned_mine' ? { owner: 0 } : {});
    assert.ok(r.ok, `${def.id}: ${r.error} ${JSON.stringify(r.problems || '')}`);
    if (r.ref.kind !== 'object') continue;
    const obj = doc.bp.map.objects[r.ref.id];
    const fp = E.footprintOf(obj.defId, obj.pos);
    // the same object cannot be placed again on any footprint tile
    for (const p of fp) assert.equal(E.canPlace(doc, 'resource_wood', p).ok, false, `${def.id} footprint ${p.x},${p.y} occupied`);
    const v = validateBlueprint({ ...doc.bp, meta: { ...doc.bp.meta, playerSlots: 1 } }, { requireAllReachable: false });
    assert.ok(!v.errors.some((e) => /overlap|out of bounds|not marked|on (water|grass|impassable)/.test(e)), `${def.id}: ${v.errors.join('; ')}`);
  }
});

test('placement checks: bounds, overlap, terrain, rivers, towns 5x3, heroes on town entrances', () => {
  const doc = E.newMap({ size: 'S' });
  assert.equal(E.placeObject(doc, 'nope', P(5, 5)).error, 'unknown_object');
  assert.equal(E.placeObject(doc, 'gold_mine', P(0, 0)).error, 'out_of_bounds'); // 3x2 sticks out
  assert.ok(E.placeObject(doc, 'gold_mine', P(5, 5)).ok);
  assert.equal(E.placeObject(doc, 'resource_gold', P(4, 4)).error, 'occupied');
  assert.equal(E.placeObject(doc, 'boat', P(10, 10)).error, 'wrong_terrain');
  E.paintRiver(doc, P(12, 12));
  assert.equal(E.placeObject(doc, 'windmill', P(12, 12)).error, 'on_river');
  assert.ok(E.placeObject(doc, 'pine_trees_1x1', P(12, 12)).ok, 'decor may stand on rivers');
  const t = E.placeObject(doc, 'random_town', P(20, 20), { ownerSlot: 1 });
  assert.ok(t.ok);
  assert.equal(doc.bp.towns[0].faction, 'random');
  assert.equal(E.placeObject(doc, 'resource_wood', P(18, 18)).error, 'occupied');
  assert.ok(E.placeObject(doc, 'resource_wood', P(17, 18)).ok);
  assert.ok(E.placeObject(doc, 'hero', P(20, 20), { ownerSlot: 1, defId: 'orrin' }).ok, 'hero on the town entrance');
  assert.equal(E.placeObject(doc, 'hero', P(20, 19), { ownerSlot: 1 }).error, 'occupied');
  assert.equal(E.placeObject(doc, 'hero', P(25, 25), { ownerSlot: 0, defId: 'orrin' }).error, 'hero_taken');
  assert.equal(E.placeObject(doc, 'hero', P(25, 25), { ownerSlot: 5 }).error, 'bad_value');
  assert.equal(E.placeObject(doc, 'town', P(30, 30), { faction: 'atlantis' }).error, 'bad_value');
  assert.equal(E.placeObject(doc, 'windmill', P(30, 30), { owner: 0 }).error, 'bad_owner');
  assert.equal(E.refAt(doc, P(20, 20)).kind, 'hero');
  assert.equal(E.refAt(doc, P(19, 19)).kind, 'town');
  assert.equal(E.refAt(doc, P(4, 4)).kind, 'object');
});

test('instance data: monsters, resources with amount, artifacts, scrolls, events, pandora, seer huts, quest guards', () => {
  const doc = E.newMap({ size: 'S', players: 2 });
  const mon = E.placeObject(doc, 'monster', P(5, 5), { data: { creatureId: 'griffin', count: 7, disposition: 'savage' } });
  assert.deepEqual([mon.object.data.creatureId, mon.object.data.count, mon.object.data.character], ['griffin', 7, 10]);
  assert.equal(E.placeObject(doc, 'monster', P(6, 7), { data: { creatureId: 'griffin', count: 0 } }).error, 'bad_value');
  const rnd = E.placeObject(doc, 'random_monster_3', P(8, 5));
  assert.equal(rnd.object.defId, 'monster');
  assert.ok(rnd.object.data.creatureId);
  const ore = E.placeObject(doc, 'resource_ore', P(10, 5), { data: { amount: 17 } });
  assert.deepEqual(ore.object.data.reward, { resources: { ore: 17 } });
  assert.ok(E.setProps(doc, ore.ref, { data: { amount: 4 } }).ok);
  assert.deepEqual(doc.bp.map.objects[ore.ref.id].data.reward, { resources: { ore: 4 } });
  const art = E.placeObject(doc, 'artifact_major', P(12, 5), { data: { artifactId: 'sword_of_hellfire' } });
  assert.ok(art.ok || art.problems, JSON.stringify(art));
  const art2 = E.placeObject(doc, 'artifact_random', P(14, 5));
  assert.ok(art2.object.data.artifactId);
  assert.equal(E.setProps(doc, art2.ref, { data: { artifactId: 'nope' } }).error, 'bad_value');
  const scroll = E.placeObject(doc, 'spell_scroll', P(16, 5), { data: { spellId: 'haste' } });
  assert.equal(scroll.object.data.spellId, 'haste');
  const ev = E.placeObject(doc, 'event', P(18, 5), { data: { message: 'Hello', resources: { gold: 1000 }, players: [1], once: true } });
  assert.ok(ev.ok);
  assert.equal(E.setProps(doc, ev.ref, { data: { players: [4] } }).error, 'bad_value');
  const box = E.placeObject(doc, 'pandoras_box', P(20, 5), { data: { exp: 2000, creatures: [{ creatureId: 'angel', count: 2 }] } });
  assert.ok(box.ok);
  assert.equal(E.setProps(doc, box.ref, { data: { creatures: [{ creatureId: 'xx', count: 1 }] } }).error, 'bad_value');
  const seer = E.placeObject(doc, 'seers_hut', P(22, 10), {
    data: { quest: { type: 'kill_monster', objectId: mon.ref.id }, reward: { artifacts: ['centaurs_axe'], exp: 1000 } },
  });
  assert.ok(seer.ok, JSON.stringify(seer));
  assert.equal(E.placeObject(doc, 'seers_hut', P(26, 10), { data: { quest: { type: 'kill_monster', objectId: 'o999' } } }).error, 'bad_value');
  const guard = E.placeObject(doc, 'quest_guard', P(26, 12), { data: { quest: { type: 'bring_resources', resources: { gold: 5000 } } } });
  assert.ok(guard.ok);
  assert.equal(E.setProps(doc, guard.ref, { data: { quest: { type: 'reach_level', level: 1 } } }).error, 'bad_value');
  assert.ok(E.setProps(doc, guard.ref, { data: { quest: { type: 'reach_level', level: 8 } } }).ok);
  assert.equal(doc.bp.map.objects[guard.ref.id].data.quest.level, 8);
  // flaggable owners
  const mine = E.placeObject(doc, 'sawmill', P(30, 30), { owner: 1 });
  assert.equal(mine.object.owner, 1);
  assert.ok(E.setProps(doc, mine.ref, { owner: null }).ok);
  assert.equal(doc.bp.map.objects[mine.ref.id].owner, null);
  assert.equal(E.setProps(doc, mine.ref, { owner: 2 }).error, 'bad_owner');
  // disposition change re-rolls the character in range
  assert.ok(E.setProps(doc, mon.ref, { data: { disposition: 'compliant' } }).ok);
  assert.equal(doc.bp.map.objects[mon.ref.id].data.character, -4);
});

test('towns and heroes: properties, removal keeps condition indices in sync', () => {
  const doc = E.newMap({ size: 'S' });
  E.placeObject(doc, 'town', P(5, 5), { faction: 'castle', ownerSlot: 0 });
  E.placeObject(doc, 'town', P(15, 5), { faction: 'rampart', ownerSlot: null });
  E.placeObject(doc, 'town', P(25, 5), { faction: 'tower', ownerSlot: 1 });
  E.placeObject(doc, 'hero', P(5, 10), { ownerSlot: 0, defId: 'orrin' });
  E.placeObject(doc, 'hero', P(25, 10), { ownerSlot: 1 });
  assert.ok(E.setProps(doc, { kind: 'town', index: 1 }, { name: 'Elmwood', buildings: ['fort', 'tavern'], ownerSlot: 1 }).ok);
  assert.deepEqual(doc.bp.towns[1], { pos: P(15, 5), faction: 'rampart', ownerSlot: 1, name: 'Elmwood', buildings: ['fort', 'tavern'] });
  assert.equal(E.setProps(doc, { kind: 'town', index: 1 }, { buildings: ['nope'] }).error, 'bad_value');
  assert.equal(E.setProps(doc, { kind: 'hero', index: 1 }, { defId: 'orrin' }).error, 'hero_taken');
  assert.ok(E.setProps(doc, { kind: 'hero', index: 1 }, { defId: 'solmyr' }).ok);
  assert.ok(E.setVictory(doc, { type: 'capture_town', townIndex: 2 }).ok);
  assert.ok(E.setLoss(doc, { type: 'lose_hero', heroIndex: 1 }).ok);
  assert.equal(E.setVictory(doc, { type: 'capture_town', townIndex: 9 }).error, 'bad_condition');
  assert.equal(E.setVictory(doc, { type: 'fly_to_moon' }).error, 'bad_condition');
  assert.ok(E.removeRef(doc, { kind: 'town', index: 0 }).ok);
  assert.deepEqual(doc.bp.victory, { type: 'capture_town', townIndex: 1 });
  assert.ok(E.removeAt(doc, P(5, 10)).ok);
  assert.deepEqual(doc.bp.loss, { type: 'lose_hero', heroIndex: 0 });
  assert.ok(E.removeRef(doc, { kind: 'hero', index: 0 }).ok);
  assert.equal(doc.bp.loss, 'standard');
  E.undo(doc);
  assert.deepEqual(doc.bp.loss, { type: 'lose_hero', heroIndex: 0 });
  // a monster victory target
  const mon = E.placeObject(doc, 'monster', P(30, 30), { data: { creatureId: 'black_dragon', count: 3 } });
  assert.ok(E.setVictory(doc, { type: 'defeat_monster', objectId: mon.ref.id }).ok);
  E.removeRef(doc, mon.ref);
  assert.equal(doc.bp.victory, 'standard');
});

test('move keeps id and data; gates pair across levels automatically and manually', () => {
  const doc = E.newMap({ size: 'S', levels: 2 });
  const m = E.placeObject(doc, 'gold_mine', P(10, 10), { owner: 0 });
  const data = JSON.stringify(m.object.data);
  assert.ok(E.moveRef(doc, m.ref, P(20, 20)).ok);
  const moved = doc.bp.map.objects[m.ref.id];
  assert.deepEqual(moved.pos, P(20, 20));
  assert.equal(JSON.stringify(moved.data), data);
  assert.equal(tile(doc, 10, 9).blocked, false);
  assert.equal(tile(doc, 20, 19).blocked, true);
  assert.equal(tile(doc, 20, 20).obj, m.ref.id);
  assert.equal(E.moveRef(doc, m.ref, P(0, 0)).error, 'out_of_bounds');
  assert.ok(E.moveRef(doc, m.ref, P(21, 20)).ok, 'overlapping its own old footprint is fine');
  E.undo(doc); E.undo(doc);
  assert.deepEqual(doc.bp.map.objects[m.ref.id].pos, P(10, 10));
  assert.equal(tile(doc, 10, 9).blocked, true);
  assert.equal(tile(doc, 20, 19).blocked, false);
  // gates
  const g1 = E.placeObject(doc, 'subterranean_gate', P(5, 30));
  assert.equal(g1.object.data.pair, null);
  const g2 = E.placeObject(doc, 'subterranean_gate', P(6, 30, 1));
  assert.equal(doc.bp.map.objects[g1.ref.id].data.pair, g2.ref.id);
  const g3 = E.placeObject(doc, 'subterranean_gate', P(30, 30));
  const g4 = E.placeObject(doc, 'subterranean_gate', P(30, 10, 1));
  assert.equal(doc.bp.map.objects[g3.ref.id].data.pair, g4.ref.id, 'existing pairs kept, new ones pair up');
  assert.equal(doc.bp.map.objects[g1.ref.id].data.pair, g2.ref.id);
  assert.ok(E.pairGates(doc, g1.ref.id, g4.ref.id).ok);
  assert.equal(doc.bp.map.objects[g2.ref.id].data.pair, null);
  assert.equal(doc.bp.map.objects[g3.ref.id].data.pair, null);
  assert.equal(E.pairGates(doc, g1.ref.id, g3.ref.id).error, 'same_level');
  E.pairGates(doc, g2.ref.id, g3.ref.id);
  const v = validateBlueprint({ ...doc.bp, meta: { ...doc.bp.meta, playerSlots: 1 } }, { requireAllReachable: false });
  assert.ok(!v.errors.some((e) => /gate/.test(e)), v.errors.join('; '));
  E.removeRef(doc, g1.ref);
  assert.equal(doc.bp.map.objects[g4.ref.id].data.pair, null);
});

test('undo / redo of every operation kind restores the exact blueprint', () => {
  const doc = E.newMap({ size: 'S', levels: 2 });
  const states = [snap(doc)];
  const ops = [
    () => E.paintTerrain(doc, P(3, 3), 'sand', { brush: 4 }),
    () => E.fillTerrain(doc, P(30, 30), 'snow'),
    () => E.paintRoadLine(doc, P(1, 20), P(20, 20), 2),
    () => E.paintRiverLine(doc, P(1, 25), P(10, 30), true),
    () => E.placeObject(doc, 'town', P(10, 10), { faction: 'necropolis', ownerSlot: 0 }),
    () => E.placeObject(doc, 'hero', P(10, 10), { ownerSlot: 0 }),
    () => E.placeObject(doc, 'crypt', P(25, 10)),
    () => E.moveRef(doc, { kind: 'object', id: Object.keys(doc.bp.map.objects)[0] }, P(26, 14)),
    () => E.setProps(doc, { kind: 'town', index: 0 }, { name: 'Bones' }),
    () => E.setMapInfo(doc, { name: 'Undo map', description: 'd', difficulty: 3 }),
    () => E.setPlayerCount(doc, 4),
    () => E.setPlayer(doc, 2, { team: 1, factions: ['castle'] }),
    () => E.setVictory(doc, { type: 'accumulate_resources', resource: 'gold', amount: 50000 }),
    () => E.setLoss(doc, { type: 'time_limit', days: 90 }),
    () => E.resizeMap(doc, { width: 30, height: 24, levels: 1 }),
    () => E.removeAt(doc, P(10, 10)),
  ];
  for (const op of ops) {
    const r = op();
    assert.ok(r.ok, JSON.stringify(r));
    states.push(snap(doc));
  }
  assert.equal(doc.undo.length, ops.length);
  for (let i = ops.length; i > 0; i--) {
    assert.ok(E.undo(doc).ok);
    assert.equal(snap(doc), states[i - 1], `undo of op ${i - 1}`);
  }
  assert.equal(E.undo(doc).ok, false);
  for (let i = 1; i <= ops.length; i++) {
    assert.ok(E.redo(doc).ok);
    assert.equal(snap(doc), states[i], `redo of op ${i - 1}`);
  }
  assert.equal(E.redo(doc).ok, false);
  // a new edit clears the redo stack
  E.undo(doc);
  E.paintTerrain(doc, P(0, 0), 'dirt');
  assert.equal(E.canRedo(doc), false);
  // failed operations record nothing
  const n = doc.undo.length;
  E.placeObject(doc, 'gold_mine', P(0, 0));
  assert.equal(doc.undo.length, n);
});

test('resize drops what does not fit and keeps the rest marked', () => {
  const doc = E.newMap({ size: 'S' });
  E.placeObject(doc, 'town', P(5, 5), { faction: 'castle', ownerSlot: 0 });
  E.placeObject(doc, 'town', P(30, 30), { faction: 'castle', ownerSlot: 1 });
  const keep = E.placeObject(doc, 'windmill', P(10, 10));
  E.placeObject(doc, 'windmill', P(25, 10));
  E.setVictory(doc, { type: 'capture_town', townIndex: 1 });
  const r = E.resizeMap(doc, { width: 20, height: 20 });
  assert.equal(r.removed, 2);
  assert.equal(doc.bp.map.width, 20);
  assert.equal(doc.bp.towns.length, 1);
  assert.equal(doc.bp.victory, 'standard');
  assert.equal(doc.bp.map.tiles[0][9][10].blocked, true);
  assert.ok(doc.bp.map.objects[keep.ref.id]);
  const grown = E.resizeMap(doc, { width: 40, height: 40, levels: 2 });
  assert.ok(grown.ok);
  assert.equal(doc.bp.map.tiles[1][0][0].t, 'subterranean');
  assert.equal(doc.bp.meta.levels, 2);
});

test('player slots: count, permissions, teams', () => {
  const doc = E.newMap({ size: 'S', players: 4 });
  E.placeObject(doc, 'town', P(5, 5), { faction: 'castle', ownerSlot: 3 });
  E.placeObject(doc, 'hero', P(20, 20), { ownerSlot: 3 });
  E.placeObject(doc, 'gold_mine', P(20, 10), { owner: 3 });
  assert.ok(E.setPlayerCount(doc, 2).ok);
  assert.equal(doc.bp.meta.playerSlots, 2);
  assert.equal(doc.bp.towns[0].ownerSlot, null);
  assert.equal(doc.bp.heroes.length, 0);
  assert.equal(Object.values(doc.bp.map.objects)[0].owner, null);
  assert.equal(E.setPlayerCount(doc, 9).error, 'bad_value');
  assert.equal(E.setPlayer(doc, 1, { human: false, ai: false }).error, 'slot_needs_human_or_ai');
  assert.ok(E.setPlayer(doc, 1, { human: false, team: 0, factions: ['tower', 'inferno'] }).ok);
  assert.deepEqual(doc.bp.meta.players[1], { slot: 1, team: 0, human: false, ai: true, factions: ['tower', 'inferno'] });
  assert.equal(E.setPlayer(doc, 1, { factions: ['atlantis'] }).error, 'bad_value');
  const seats = E.defaultSeats(doc.bp);
  assert.equal(seats[0].isHuman, true);
  assert.equal(seats[1].isHuman, false);
  const settings = E.buildPlaySettings(doc.bp, seats, { seed: 5, difficulty: 2 });
  assert.equal(settings.players.length, 2);
  assert.equal(settings.players[1].team, 0);
  assert.equal(settings.victory, 'standard');
});

test('serialize / deserialize round trip and version check', () => {
  const doc = E.newMap({ size: 'S', levels: 2, name: 'Round trip' });
  E.placeObject(doc, 'town', P(5, 5), { faction: 'castle', ownerSlot: 0 });
  E.placeObject(doc, 'pandoras_box', P(20, 20), { data: { exp: 500 } });
  E.paintRoadLine(doc, P(0, 10), P(30, 10), 1);
  E.setVictory(doc, { type: 'survive', days: 30 });
  const text = E.serializeMap(doc.bp, { now: 123 });
  const r = E.deserializeMap(text);
  assert.ok(r.ok);
  assert.deepEqual(r.bp, doc.bp);
  assert.equal(JSON.parse(text).format, 'h3online-map');
  // a bare blueprint is accepted
  assert.ok(E.deserializeMap(JSON.stringify(doc.bp)).ok);
  assert.equal(E.deserializeMap('{nope').error, 'not_json');
  assert.equal(E.deserializeMap('{"a": 1}').error, 'not_a_map');
  assert.equal(E.deserializeMap({ format: 'h3online-map', version: 99, blueprint: doc.bp }).error, 'newer_version');
  const broken = JSON.parse(text);
  broken.blueprint.map.tiles[0].pop();
  assert.equal(E.deserializeMap(broken).error, 'corrupt_map');
  // an editor wraps a copy: editing it does not touch the source blueprint
  const doc2 = E.createEditor(r.bp);
  E.paintTerrain(doc2, P(0, 0), 'sand');
  assert.equal(r.bp.map.tiles[0][0][0].t, 'grass');
  assert.ok(doc2.nextId > 1);
});

test('validation: messages with positions and editor warnings', () => {
  const doc = E.newMap({ size: 'S', players: 2 });
  doc.bp.meta.name = '';
  E.placeObject(doc, 'town', P(5, 5), { faction: 'castle', ownerSlot: 0 });
  E.placeObject(doc, 'hero', P(5, 5), { ownerSlot: 0 });
  // slot 1: hero only, walled in by water
  E.placeObject(doc, 'hero', P(30, 30), { ownerSlot: 1 });
  for (let x = 27; x <= 33; x++) for (const y of [27, 33]) E.paintTerrain(doc, P(x, y), 'water');
  for (let y = 27; y <= 33; y++) for (const x of [27, 33]) E.paintTerrain(doc, P(x, y), 'water');
  E.placeObject(doc, 'monolith_two_way_green', P(15, 15));
  E.placeObject(doc, 'seers_hut', P(20, 5));
  const v = E.validateMap(doc.bp);
  assert.equal(v.ok, false);
  const reach = v.errors.find((e) => /cannot reach/.test(e.text));
  assert.ok(reach && reach.pos, JSON.stringify(v.errors));
  const texts = v.warnings.map((w) => w.text).join('\n');
  assert.match(texts, /no name/);
  assert.match(texts, /Player 2 has no town/);
  assert.match(texts, /no partner/);
  assert.match(texts, /has no quest/);
  assert.match(texts, /has no reward/);
  const mono = v.warnings.find((w) => /no partner/.test(w.text));
  assert.deepEqual(mono.pos, P(15, 15));
  // positions of raw validator messages
  assert.deepEqual(E.positionOfMessage(doc.bp, 'town 0: footprint tile 3,3 is blocked'), P(5, 5));
  assert.deepEqual(E.positionOfMessage(doc.bp, 'tile 4,6,0: road on water'), P(4, 6));
  const oid = Object.keys(doc.bp.map.objects)[0];
  assert.deepEqual(E.positionOfMessage(doc.bp, `object ${oid} (x) at 1,2,0 is unreachable`), doc.bp.map.objects[oid].pos);
});

test('start from a random map: editable, valid, round-trips', () => {
  const r = E.blueprintFromRandomMap({ size: 'S', players: 2, seed: 11 });
  assert.ok(r.ok, r.error);
  assert.ok(E.validateMap(r.bp).ok);
  const doc = E.createEditor(r.bp);
  assert.equal(doc.bp.meta.players.length, 2);
  const before = Object.keys(doc.bp.map.objects).length;
  const free = (() => {
    for (let y = 2; y < 34; y++) for (let x = 2; x < 34; x++) if (E.canPlace(doc, 'resource_gems', P(x, y)).ok) return P(x, y);
    return null;
  })();
  assert.ok(free);
  const placed = E.placeObject(doc, 'resource_gems', free);
  assert.ok(placed.ok);
  assert.ok(!r.bp.map.objects[placed.ref.id], 'new id does not clash');
  assert.equal(Object.keys(doc.bp.map.objects).length, before + 1);
  assert.equal(E.blueprintFromRandomMap({ size: 'S', players: 2, template: 'nope' }).ok, false);
});

test('batches group a stroke into one undo step; capture-town warning for an owned target', () => {
  const doc = E.newMap({ size: 'S' });
  E.beginBatch(doc, 'Stroke');
  for (let x = 0; x < 6; x++) E.paintTerrain(doc, P(x, 0), 'sand');
  E.paintTerrain(doc, P(2, 0), 'snow');
  E.endBatch(doc);
  assert.equal(doc.undo.length, 1);
  assert.equal(doc.undo[0].label, 'Stroke');
  assert.equal(tile(doc, 2, 0).t, 'snow');
  E.undo(doc);
  for (let x = 0; x < 6; x++) assert.equal(tile(doc, x, 0).t, 'grass');
  E.redo(doc);
  assert.equal(tile(doc, 2, 0).t, 'snow');
  assert.equal(tile(doc, 5, 0).t, 'sand');
  E.placeObject(doc, 'town', P(10, 10), { faction: 'castle', ownerSlot: 1 });
  E.setVictory(doc, { type: 'capture_town', townIndex: 0 });
  assert.ok(E.validateMap(doc.bp).warnings.some((w) => /already belongs to player 2/.test(w.text)));
});
