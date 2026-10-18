import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addHero, adv, assertJson } from './fixture.js';
import { getMapObject, MAP_OBJECTS, EFFECT_TYPES, MONSTER_COUNT_BY_TIER } from '../../src/data/mapObjects.js';
import { getCreature } from '../../src/data/creatures.js';
import { getSpell } from '../../src/data/spells.js';
import { getArtifact } from '../../src/data/artifacts.js';

test('createEmptyMap builds levels x height x width tiles of the DESIGN shape', () => {
  const map = adv.createEmptyMap(5, 4, 2, 'dirt');
  assert.equal(map.levels, 2);
  assert.equal(map.tiles.length, 2);
  assert.equal(map.tiles[1].length, 4);
  assert.equal(map.tiles[1][3].length, 5);
  assert.deepEqual(map.tiles[0][0][0], { t: 'dirt', road: 0, river: 0, obj: null, blocked: false });
  assert.ok(adv.inBounds(map, { x: 4, y: 3, z: 1 }));
  assert.ok(!adv.inBounds(map, { x: 5, y: 3, z: 0 }));
  assert.ok(!adv.inBounds(map, { x: 0, y: 0, z: 2 }));
  assert.equal(adv.getTile(map, { x: -1, y: 0, z: 0 }), null);
  assert.throws(() => adv.createEmptyMap(2, 2, 1, 'nope'));
});

test('footprint: entrance is the bottom row, column floor(w/2)', () => {
  const fp = adv.getFootprint(getMapObject('sawmill'), { x: 5, y: 5, z: 0 }); // 3x2
  assert.deepEqual(fp.map((p) => `${p.x},${p.y}`), ['4,4', '5,4', '6,4', '4,5', '5,5', '6,5']);
  const fp2 = adv.getFootprint(getMapObject('windmill'), { x: 5, y: 5, z: 0 }); // 2x2
  assert.deepEqual(fp2.map((p) => `${p.x},${p.y}`), ['4,4', '5,4', '4,5', '5,5']);
});

test('addObject marks blocked tiles, keeps the entrance open; removeObject frees them', () => {
  const state = makeState();
  const obj = adv.addObject(state, 'sawmill', { x: 5, y: 5, z: 0 });
  assert.equal(obj.id, 'o1');
  const t = (x, y) => state.map.tiles[0][y][x];
  for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5]]) assert.equal(t(x, y).blocked, true, `${x},${y}`);
  assert.equal(t(5, 5).blocked, false);
  assert.equal(t(5, 5).obj, obj.id);
  assert.equal(adv.getObjectAt(state, { x: 5, y: 5, z: 0 }), obj);
  assert.equal(adv.getObjectAt(state, { x: 4, y: 4, z: 0 }), null);
  assert.ok(!adv.canPlaceObject(state, 'windmill', { x: 6, y: 6, z: 0 }));
  assert.ok(adv.canPlaceObject(state, 'windmill', { x: 10, y: 6, z: 0 }));
  adv.removeObject(state, obj.id);
  for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [5, 5]]) {
    assert.equal(t(x, y).blocked, false);
    assert.equal(t(x, y).obj, null);
  }
  assert.equal(state.map.objects[obj.id], undefined);
});

test('scenery blocks its whole footprint; passable scenery, grail and events leave tiles walkable', () => {
  const state = makeState();
  adv.addObject(state, 'mountains_2x2', { x: 3, y: 3, z: 0 });
  for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) assert.equal(state.map.tiles[0][y][x].blocked, true);
  adv.addObject(state, 'flowers_1x1', { x: 8, y: 8, z: 0 });
  assert.deepEqual(state.map.tiles[0][8][8], { t: 'grass', road: 0, river: 0, obj: null, blocked: false });
  adv.addObject(state, 'grail', { x: 9, y: 9, z: 0 });
  assert.equal(state.map.tiles[0][9][9].obj, null);
  const ev = adv.addObject(state, 'event', { x: 10, y: 9, z: 0 }, { data: { exp: 100 } });
  assert.equal(state.map.tiles[0][9][10].obj, ev.id);
  assert.equal(state.map.tiles[0][9][10].blocked, false);
  const exit = adv.addObject(state, 'monolith_one_way_exit_blue', { x: 12, y: 9, z: 0 });
  assert.equal(state.map.tiles[0][9][12].blocked, false, 'heroes arrive on the exit tile');
  assert.equal(state.map.tiles[0][9][12].obj, exit.id);
});

test('getHeroAt / getTownAt', () => {
  const state = makeState();
  const hero = addHero(state, { pos: { x: 2, y: 2, z: 0 } });
  assert.equal(adv.getHeroAt(state, { x: 2, y: 2, z: 0 }), hero);
  assert.equal(adv.getHeroAt(state, { x: 3, y: 2, z: 0 }), null);
  hero.garrisoned = true;
  assert.equal(adv.getHeroAt(state, { x: 2, y: 2, z: 0 }), null);
  state.towns.t1 = { id: 't1', pos: { x: 8, y: 8, z: 0 }, owner: 0, garrison: new Array(7).fill(null) };
  adv.addObject(state, 'town', { x: 8, y: 8, z: 0 }, { owner: 0, data: { townId: 't1' } });
  assert.equal(adv.getTownAt(state, { x: 8, y: 8, z: 0 }).id, 't1');
  assert.equal(adv.getTownAt(state, { x: 1, y: 1, z: 0 }), null);
});

test('instance data is rolled at placement for every rolled effect type', () => {
  const state = makeState({ width: 40, height: 40 });
  const at = (() => { let i = 0; return () => ({ x: 3 + (i % 6) * 6, y: 4 + Math.floor(i++ / 6) * 5, z: 0 }); })();
  const add = (id, params) => adv.addObject(state, id, at(), params);

  const art = add('artifact_minor');
  assert.equal(getArtifact(art.data.artifactId).class, 'minor');
  const scroll = add('spell_scroll');
  assert.ok(getSpell(scroll.data.spellId).level >= 1);
  const mine = add('abandoned_mine');
  assert.ok(['ore', 'mercury', 'sulfur', 'crystal', 'gems', 'gold'].includes(mine.data.resource));
  const trogs = mine.data.guards.filter(Boolean);
  assert.equal(trogs.length, 5);
  const total = trogs.reduce((n, s) => n + s.count, 0);
  assert.ok(total >= 100 && total <= 249);
  assert.ok(trogs.every((s) => s.creatureId === 'troglodyte'));
  const mill = add('windmill');
  const [res, amount] = Object.entries(mill.data.reward.resources)[0];
  assert.ok(['ore', 'mercury', 'sulfur', 'crystal', 'gems'].includes(res) && amount >= 3 && amount <= 6);
  const wheel = add('water_wheel');
  assert.deepEqual(wheel.data.reward, { resources: { gold: 500 } }, 'first week table');
  const tomb = add('warriors_tomb');
  assert.equal(tomb.data.reward.artifacts.length, 1);
  const tree = add('tree_of_knowledge');
  assert.ok([{}, { gold: 2000 }, { gems: 10 }].some((c) => JSON.stringify(c) === JSON.stringify(tree.data.cost)));
  const hut = add('witch_hut');
  assert.equal(hut.data.skills.length, 1);
  assert.ok(!['necromancy', 'leadership'].includes(hut.data.skills[0]));
  const rune = add('runestone');
  assert.equal(new Set(rune.data.skills).size, 2);
  const scholar = add('scholar');
  assert.ok(['primary', 'skill', 'spell'].includes(scholar.data.kind));
  const uni = add('university');
  assert.equal(new Set(uni.data.skills).size, 4);
  assert.ok(!uni.data.skills.includes('necromancy'));
  for (const [id, level] of [['shrine_of_magic_incantation', 1], ['shrine_of_magic_gesture', 2], ['shrine_of_magic_thought', 3], ['shrine_of_magic_mystery', 4]]) {
    assert.equal(getSpell(add(id).data.spellId).level, level);
  }
  const sanctum = add('fire_sanctum');
  assert.ok(['fire', 'all'].includes(getSpell(sanctum.data.spellId).school));
  const bm = add('black_market');
  assert.equal(bm.data.stock.length, 7);
  bm.data.stock.forEach((a) => getArtifact(a));
  const camp = add('refugee_camp');
  assert.equal(camp.data.count, getCreature(camp.data.creatureId).growth);
  const prison = add('prison');
  assert.ok(prison.data.heroDefId);
  const dw = add('guardhouse');
  assert.deepEqual(dw.data.stock, { pikeman: getCreature('pikeman').growth });
  assert.equal(dw.data.cleared, true);
  const golems = add('golem_factory');
  assert.equal(golems.data.cleared, false);
  assert.equal(golems.data.guards.filter(Boolean).reduce((n, s) => n + s.count, 0), 15);
  const lamp = add('ancient_lamp');
  assert.ok(lamp.data.stock.master_genie >= 4 && lamp.data.stock.master_genie <= 6);
  const mon = add('monster', { data: { creatureId: 'griffin' } });
  const [lo, hi] = MONSTER_COUNT_BY_TIER[3];
  assert.ok(mon.data.count >= lo && mon.data.count <= hi);
  assert.equal(mon.data.disposition, 'aggressive');
  assert.ok(mon.data.character >= 1 && mon.data.character <= 10);
  const rnd = add('random_monster_5');
  assert.equal(rnd.defId, 'monster');
  assert.equal(getCreature(rnd.data.creatureId).tier, 5);
  assert.equal(add('monster', { data: { creatureId: 'imp', disposition: 'compliant' } }).data.character, -4);
  assert.equal(add('monster', { data: { creatureId: 'imp', disposition: 'savage' } }).data.character, 10);
  const pile = add('resource_random');
  assert.match(pile.defId, /^resource_(wood|ore|mercury|sulfur|crystal|gems|gold)$/);
  const ob1 = add('obelisk');
  const ob2 = add('obelisk');
  assert.deepEqual([ob1.data.index, ob2.data.index], [0, 1]);
  assert.equal(state.map.puzzleOrder.length, 48);
  assert.equal(new Set(state.map.puzzleOrder).size, 48);
  const box = add('pandoras_box', { data: { preset: 'gold_10000' } });
  assert.deepEqual(box.data.resources, { gold: 10000 });
  const box2 = add('pandoras_box', { data: { preset: 'creatures_tier_3', faction: 'castle' } });
  assert.deepEqual(box2.data.creatures, [{ creatureId: 'griffin', count: Math.floor(6000 / getCreature('griffin').aiValue) }]);
  const box3 = add('pandoras_box', { data: { preset: 'spells_level_5' } });
  assert.ok(box3.data.spells.length >= 5 && box3.data.spells.every((s) => getSpell(s).level === 5));
  const seer = add('seers_hut', { data: { quest: { type: 'bring_artifacts', class: 'treasure', count: 1 }, reward: { primary: { random: 2 } } } });
  assert.equal(getArtifact(seer.data.quest.artifactIds[0]).class, 'treasure');
  assert.equal(Object.values(seer.data.reward.primary)[0], 2);
  const gar = add('garrison', { owner: 1, data: { army: [{ creatureId: 'pikeman', count: 5 }] } });
  assert.equal(gar.data.army.length, 7);
  assertJson(assert, state);
});

test('bank instance: level by chance, guards split into stacks, reward fixed at placement', () => {
  const levels = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const state = makeState({ seed });
    const bank = adv.addObject(state, 'dwarven_treasury', { x: 5, y: 5, z: 0 });
    levels.add(bank.data.level);
    const fx = getMapObject('dwarven_treasury').effect.levels[bank.data.level];
    const stacks = bank.data.guards.filter(Boolean);
    assert.equal(stacks.length, 5);
    assert.equal(stacks.reduce((n, s) => n + s.count, 0), fx.guards[0].count);
    assert.ok(stacks.filter((s) => s.creatureId === 'battle_dwarf').length <= 1, 'at most one upgraded stack');
    assert.deepEqual(bank.data.reward.resources, fx.reward.resources);
    assert.equal(bank.data.cleared, false);
  }
  assert.equal(levels.size, 4, 'all four levels occur over 40 seeds');
  const state = makeState();
  const utopia = adv.addObject(state, 'dragon_utopia', { x: 5, y: 5, z: 0 }, { data: { level: 3 } });
  assert.deepEqual(utopia.data.guards.filter(Boolean).map((s) => s.count), [8, 7, 6, 5]);
  assert.equal(utopia.data.reward.resources.gold, 50000);
  assert.equal(utopia.data.reward.artifacts.length, 4);
  assert.ok(utopia.data.reward.artifacts.every((a) => getArtifact(a).class === 'relic'));
  assert.equal(new Set(utopia.data.reward.artifacts).size, 4, 'no duplicate artifacts on one map');
  const crypt = adv.addObject(state, 'crypt', { x: 10, y: 5, z: 0 }, { data: { level: 0 } });
  assert.deepEqual(crypt.data.guards.filter(Boolean), [{ creatureId: 'skeleton', count: 30 }, { creatureId: 'walking_dead', count: 20 }]);
});

test('every definition can be instantiated and stays JSON-serializable', () => {
  const state = makeState({ width: 12, height: 12 });
  state.towns.t1 = { id: 't1', pos: { x: 6, y: 6, z: 0 }, owner: null, garrison: new Array(7).fill(null) };
  for (const def of MAP_OBJECTS) {
    const obj = adv.addObject(state, def.id, { x: 6, y: 6, z: 0 }, def.effect.type === 'town' ? { data: { townId: 't1' } } : {});
    assert.ok(EFFECT_TYPES[getMapObject(obj.defId).effect.type]);
    assertJson(assert, state);
    adv.removeObject(state, obj.id);
  }
  assert.deepEqual(Object.keys(state.map.objects), []);
  assert.ok(state.map.tiles[0].every((row) => row.every((t) => !t.blocked && !t.obj)));
});

test('subterranean gates pair with the nearest gate of the other level', () => {
  const state = makeState({ width: 20, height: 20, levels: 2 });
  const a = adv.addObject(state, 'subterranean_gate', { x: 3, y: 3, z: 0 });
  const b = adv.addObject(state, 'subterranean_gate', { x: 15, y: 15, z: 0 });
  const c = adv.addObject(state, 'subterranean_gate', { x: 14, y: 14, z: 1 });
  const d = adv.addObject(state, 'subterranean_gate', { x: 4, y: 5, z: 1 });
  const e = adv.addObject(state, 'subterranean_gate', { x: 10, y: 3, z: 0 });
  assert.equal(a.data.pair, d.id);
  assert.equal(d.data.pair, a.id);
  // surface gates in (y, x) order: a, e, b - e takes the only underground gate left
  assert.equal(e.data.pair, c.id);
  assert.equal(c.data.pair, e.id);
  assert.equal(b.data.pair, null, 'unpaired gates do nothing');
});

test('debugRenderMap draws terrain, roads, objects, heroes and fog', () => {
  const state = makeState({ width: 6, height: 3 });
  state.map.tiles[0][0][0].t = 'water';
  state.map.tiles[0][0][1].road = 1;
  adv.addObject(state, 'monster', { x: 3, y: 1, z: 0 }, { data: { creatureId: 'imp', count: 3 } });
  adv.addObject(state, 'resource_gold', { x: 5, y: 2, z: 0 });
  addHero(state, { pos: { x: 1, y: 1, z: 0 } });
  addHero(state, { pos: { x: 5, y: 0, z: 0 }, owner: 1, id: 'enemy' });
  assert.equal(adv.debugRenderMap(state), '~=...H\n.H.M..\n.....$');
  adv.revealAround(state, 0, { x: 1, y: 1, z: 0 }, 1);
  assert.equal(adv.debugRenderMap(state, 0), '?=????\n.H.???\n?.????');
});
