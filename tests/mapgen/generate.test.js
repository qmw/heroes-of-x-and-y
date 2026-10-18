// Random map generator end to end: every template on S and M, an L and an XL two-level map,
// determinism, validation, createGame on the real engines (docs/mechanics/mapgen.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, validateBlueprint, renderBlueprintAscii, listTemplates, reachableFrom, landReachableFrom } from '../../src/engine/mapgen/index.js';
import { getMapObject } from '../../src/data/mapObjects.js';
import { getTerrain } from '../../src/data/terrain.js';
import { createGame, setAiDriver } from '../../src/engine/game.js';
import { resetGameDeps } from '../../src/engine/gameDeps.js';

function settingsFor(n, seed = 9) {
  return { seed, difficulty: 1, players: Array.from({ length: n }, (_, i) => ({ slot: i, isHuman: i === 0, faction: 'random', name: `P${i}` })) };
}

function gen(opts) {
  const bp = generateMap(opts);
  assert.notEqual(bp.ok, false, `${JSON.stringify(opts)}: ${bp.error}`);
  return bp;
}

function startGame(bp) {
  resetGameDeps();
  setAiDriver(null);
  const state = createGame(bp, settingsFor(bp.meta.playerSlots));
  const json = JSON.stringify(state);
  assert.deepEqual(JSON.parse(json), state, 'state is plain JSON');
  return state;
}

const objectsOf = (bp, pred) => Object.values(bp.map.objects).filter((o) => pred(getMapObject(o.defId), o));

test('every template generates, validates and starts a game on S and M maps', () => {
  for (const t of listTemplates()) {
    for (const size of ['S', 'M']) {
      const players = Math.max(t.players[0], Math.min(t.players[1], size === 'S' ? 2 : 4));
      const bp = gen({ size, template: t.id, players, seed: 11 });
      const v = validateBlueprint(bp);
      assert.ok(v.ok, `${t.id}/${size}: ${v.errors.slice(0, 3).join('; ')}`);
      assert.equal(bp.map.width, size === 'S' ? 36 : 72);
      assert.equal(bp.meta.template, t.id);
      assert.equal(bp.meta.playerSlots, players);
      assert.equal(bp.meta.seed, 11);
      assert.ok(bp.meta.name && bp.meta.description && bp.meta.size === size);
      const state = startGame(bp);
      assert.equal(state.players.length, players);
      for (const p of state.players) {
        assert.ok(p.towns.length >= 1, `${t.id}/${size}: player ${p.id} has a town`);
        assert.ok(p.heroes.length >= 1, `${t.id}/${size}: player ${p.id} has a hero`);
      }
    }
  }
});

test('generation is deterministic per seed', () => {
  const opts = { size: 'M', template: 'ring', players: 3, seed: 1234, water: 'normal' };
  const a = JSON.stringify(gen(opts));
  const b = JSON.stringify(gen(opts));
  assert.equal(a, b);
  const c = JSON.stringify(gen({ ...opts, seed: 1235 }));
  assert.notEqual(a, c);
});

test('large map and extra-large two-level map generate quickly and validate', () => {
  const t0 = Date.now();
  const l = gen({ size: 'L', template: 'balance', players: 6, seed: 5 });
  const tL = Date.now() - t0;
  assert.ok(validateBlueprint(l).ok);
  const t1 = Date.now();
  const xl = gen({ size: 'XL', template: 'default', players: 8, levels: 2, seed: 5 });
  const tXL = Date.now() - t1;
  console.log(`# timings: L ${tL} ms, XL two-level ${tXL} ms (incl. validation)`);
  assert.ok(tXL < 10000, `XL two-level took ${tXL} ms`);
  const v = validateBlueprint(xl);
  assert.ok(v.ok, v.errors.join('; '));
  assert.equal(xl.map.levels, 2);
  // underground: rock exists, subterranean gates are paired across levels
  let rock = 0;
  for (const row of xl.map.tiles[1]) for (const t of row) if (t.t === 'rock') rock++;
  assert.ok(rock > 1000);
  const gates = objectsOf(xl, (d) => d.id === 'subterranean_gate');
  assert.ok(gates.length >= 4 && gates.length % 2 === 0);
  for (const g of gates) {
    const mate = xl.map.objects[g.data.pair];
    assert.ok(mate && mate.data.pair === g.id && mate.pos.z !== g.pos.z);
  }
  // some underground tiles are reachable from player 0's start (through a gate)
  const reach = reachableFrom(xl, 0);
  const N = xl.map.width * xl.map.height;
  let under = 0;
  for (let i = N; i < 2 * N; i++) under += reach[i];
  assert.ok(under > 500);
  const state = startGame(xl);
  assert.equal(state.players.length, 8);
});

test('players reach each other and every object; connection guards stand in the passages', () => {
  const bp = gen({ size: 'M', template: 'default', players: 4, seed: 21 });
  const { map } = bp;
  const N = map.width * map.height;
  const reach = reachableFrom(bp, 0);
  for (const h of bp.heroes) assert.equal(reach[(h.pos.z || 0) * N + h.pos.y * map.width + h.pos.x], 1);
  for (const t of bp.towns) assert.equal(reach[(t.pos.z || 0) * N + t.pos.y * map.width + t.pos.x], 1);
  const v = validateBlueprint(bp);
  assert.equal(v.stats.unreachable, 0);
  const guarded = bp.meta.links.filter((l) => l.via === 'passage' && l.guard > 0 && !l.wide && !l.border);
  const conn = bp.meta.stats.guards.filter((g) => g.kind === 'connection');
  assert.ok(conn.length >= guarded.length);
  for (const g of conn) assert.equal(map.objects[g.objectId].defId, 'monster');
  // the map is walled: some tiles are blocked by obstacles, every monster stands on a free tile
  assert.ok(bp.meta.stats.decor > 50);
  for (const o of objectsOf(bp, (d) => d.effect.type === 'monster')) assert.equal(map.tiles[o.pos.z][o.pos.y][o.pos.x].blocked, false);
});

test('towns and mines per template: start zones get their town, sawmill and ore pit', () => {
  for (const template of ['default', 'duel', 'crossroads', 'balance']) {
    const bp = gen({ size: 'M', template, players: template === 'duel' ? 2 : 3, seed: 31 });
    const starts = bp.meta.zones.filter((z) => z.type === 'start');
    assert.equal(starts.length, bp.meta.playerSlots);
    for (const z of starts) {
      assert.ok(z.towns >= 1, `${template}: ${z.id} has a town`);
      assert.ok(z.mines.includes('sawmill') && z.mines.includes('ore_pit'), `${template}: ${z.id} mines ${z.mines}`);
    }
    const planned = bp.meta.zones.reduce((s, z) => s + z.townsPlanned, 0);
    assert.equal(bp.towns.length, planned, `${template}: towns`);
    const minesPlanned = bp.meta.zones.reduce((s, z) => s + z.minesPlanned, 0);
    const mines = bp.meta.zones.reduce((s, z) => s + z.mines.length, 0);
    assert.ok(mines >= minesPlanned * 0.9, `${template}: ${mines}/${minesPlanned} mines placed`);
    assert.equal(objectsOf(bp, (d) => d.effect.type === 'mine').length >= mines, true);
    // owned towns carry the player's (resolved) faction, neutral ones a concrete faction too
    for (const t of bp.towns) assert.notEqual(t.faction, 'random');
    for (const t of bp.towns.filter((x) => x.ownerSlot != null)) assert.equal(t.faction, bp.meta.players[t.ownerSlot].faction);
  }
  const cross = gen({ size: 'M', template: 'crossroads', players: 2, seed: 4 });
  const home = cross.meta.zones.find((z) => z.id === 'start_0');
  assert.ok(home.mines.includes('gold_mine') && home.mines.length >= 8, 'crossroads home zones hold every mine');
});

test('player choices: fixed factions and heroes, native terrain under the home town', () => {
  const bp = gen({ size: 'M', template: 'ring', players: 3, seed: 8,
    playerSlots: [{ slot: 0, faction: 'tower', hero: 'iona' }, { slot: 1, faction: 'random', hero: 'random' }, { slot: 2, faction: 'inferno', hero: 'random' }] });
  assert.equal(bp.meta.players[0].faction, 'tower');
  assert.equal(bp.meta.players[2].faction, 'inferno');
  assert.equal(bp.heroes.find((h) => h.ownerSlot === 0).defId, 'iona');
  const t0 = bp.towns.find((t) => t.ownerSlot === 0);
  assert.equal(bp.map.tiles[0][t0.pos.y][t0.pos.x].t, 'snow');
  const t2 = bp.towns.find((t) => t.ownerSlot === 2);
  assert.equal(bp.map.tiles[0][t2.pos.y][t2.pos.x].t, 'lava');
  const state = startGame(bp);
  assert.equal(state.players[0].faction, 'tower');
  assert.equal(state.heroes[state.players[0].heroes[0]].defId, 'iona');
});

test('guards scale with the monster strength setting; "none" places no monsters', () => {
  const total = {};
  for (const monsters of ['none', 'weak', 'normal', 'strong']) {
    const bp = gen({ size: 'M', template: 'default', players: 2, seed: 9, monsters });
    total[monsters] = bp.meta.stats.guards.reduce((s, g) => s + g.strength, 0);
    if (monsters === 'none') assert.equal(objectsOf(bp, (d) => d.effect.type === 'monster').length, 0);
  }
  assert.ok(total.weak < total.normal && total.normal < total.strong, JSON.stringify(total));
});

test('islands: each start is an island with a boat and a shipyard; the others are reached only by sea', () => {
  const bp = gen({ size: 'M', template: 'archipelago', players: 3, seed: 2 });
  assert.equal(bp.meta.water, 'islands');
  assert.ok(validateBlueprint(bp).ok);
  const boats = objectsOf(bp, (d) => d.id === 'boat');
  const yards = objectsOf(bp, (d) => d.effect.type === 'shipyard');
  assert.ok(boats.length >= 3 && yards.length >= 3, `${boats.length} boats, ${yards.length} shipyards`);
  const { map } = bp;
  const land = landReachableFrom(bp, 0);
  const other = bp.heroes.find((h) => h.ownerSlot === 1).pos;
  assert.equal(land[other.y * map.width + other.x], 0, 'not reachable on foot');
  const sea = reachableFrom(bp, 0);
  assert.equal(sea[other.y * map.width + other.x], 1, 'reachable by boat');
  startGame(bp);
});

test('normal water: sea on the map edge, water objects only on water, no water in "none"', () => {
  const wet = gen({ size: 'M', template: 'default', players: 2, seed: 13, water: 'normal' });
  let water = 0;
  for (const row of wet.map.tiles[0]) for (const t of row) if (t.t === 'water') water++;
  assert.ok(water > 300);
  for (const o of Object.values(wet.map.objects)) {
    const d = getMapObject(o.defId);
    if (d.category === 'decor' || d.effect.type === 'grail') continue;
    const isWaterObj = d.terrains.length === 1 && d.terrains[0] === 'water';
    assert.equal(getTerrain(wet.map.tiles[o.pos.z][o.pos.y][o.pos.x].t).water, isWaterObj, o.defId);
  }
  const dry = gen({ size: 'M', template: 'default', players: 2, seed: 13, water: 'none' });
  for (const row of dry.map.tiles[0]) for (const t of row) assert.notEqual(t.t, 'water');
});

test('treasure, specials and the grail', () => {
  const bp = gen({ size: 'L', template: 'grand_melee', players: 4, seed: 77 });
  const kinds = new Set(Object.values(bp.map.objects).map((o) => getMapObject(o.defId).effect.type));
  for (const k of ['pickup', 'artifact', 'bank', 'dwelling', 'mine', 'obelisk', 'grail', 'monster']) assert.ok(kinds.has(k), `has ${k}`);
  const grail = objectsOf(bp, (d) => d.id === 'grail');
  assert.equal(grail.length, 1);
  const gt = bp.map.tiles[0][grail[0].pos.y][grail[0].pos.x];
  assert.ok(getTerrain(gt.t).diggable && !gt.blocked && !gt.obj && !gt.road);
  assert.ok(bp.meta.stats.obelisks >= 2);
  // treasure value is spent in every zone
  for (const z of bp.meta.zones) assert.ok(z.treasureValue > 0, z.id);
  // seer huts carry concrete quests; quest artifacts exist on the map
  for (const hut of objectsOf(bp, (d) => d.effect.type === 'seer_hut')) {
    const q = hut.data.quest;
    assert.ok(q && q.type);
    if (q.type === 'bring_artifacts') {
      for (const id of q.artifactIds) assert.ok(Object.values(bp.map.objects).some((o) => o.data && o.data.artifactId === id), `quest artifact ${id} on the map`);
    }
    if (q.type === 'kill_monster') assert.ok(bp.map.objects[q.objectId]);
  }
  // roads lead out of every town
  for (const t of bp.towns) assert.ok(bp.map.tiles[t.pos.z][t.pos.y + 1][t.pos.x].road > 0);
});

test('validateBlueprint rejects broken blueprints', () => {
  const bp = gen({ size: 'S', template: 'duel', players: 2, seed: 3 });
  assert.ok(validateBlueprint(bp).ok);
  const clone = () => JSON.parse(JSON.stringify(bp));
  // unknown object id
  let b = clone();
  Object.values(b.map.objects)[0].defId = 'no_such_thing';
  assert.ok(validateBlueprint(b).errors.some((e) => /unknown defId/.test(e)));
  // overlapping objects
  b = clone();
  const mine = Object.values(b.map.objects).find((o) => o.defId === 'sawmill');
  const t = b.towns[0];
  mine.pos = { ...t.pos, y: t.pos.y - 1 };
  assert.ok(validateBlueprint(b).errors.some((e) => /overlaps/.test(e)));
  // town on water
  b = clone();
  b.map.tiles[0][b.towns[0].pos.y][b.towns[0].pos.x].t = 'water';
  assert.ok(!validateBlueprint(b).ok);
  // walled-in player
  b = clone();
  const h = b.heroes[0].pos;
  for (let y = h.y - 4; y <= h.y + 4; y++) for (let x = h.x - 5; x <= h.x + 5; x++) {
    if (Math.max(Math.abs(x - h.x) - 1, Math.abs(y - h.y) - 1) >= 3 && b.map.tiles[0][y] && b.map.tiles[0][y][x]) b.map.tiles[0][y][x].blocked = true;
  }
  const v = validateBlueprint(b);
  assert.ok(v.errors.some((e) => /cannot reach|unreachable/.test(e)), v.errors.join('; '));
  // bad hero / faction ids
  b = clone();
  b.heroes[0].defId = 'nobody';
  b.towns[0].faction = 'elves';
  const errs = validateBlueprint(b).errors.join(' ');
  assert.match(errs, /unknown hero/);
  assert.match(errs, /unknown faction/);
});

test('renderBlueprintAscii draws one character per tile and marks towns and heroes', () => {
  const bp = gen({ size: 'S', template: 'small_ring', players: 2, seed: 5, levels: 2 });
  const txt = renderBlueprintAscii(bp);
  const blocks = txt.split('\n\n');
  assert.equal(blocks.length, 2);
  for (const blk of blocks) {
    const lines = blk.split('\n');
    assert.equal(lines.length, 36);
    for (const l of lines) assert.equal(l.length, 36);
  }
  assert.equal((txt.match(/H/g) || []).length, 2);
  assert.ok((txt.match(/t/g) || []).length >= 2 * 14, 'town footprints');
  assert.ok(blocks[1].includes('#'), 'rock underground');
});

test('bad options give { ok: false, error } instead of throwing', () => {
  assert.equal(generateMap({ size: 'M', template: 'no_such_template', players: 2 }).ok, false);
  assert.match(generateMap({ size: 'M', template: 'duel', players: 4 }).error, /supports/);
  assert.equal(generateMap({ type: 'scenario', scenarioId: 'nope' }).ok, false);
  assert.equal(generateMap({ type: 'scenario' }).ok, false);
});

test('the new-game screen options produce a map and a game (random map and scenario)', async () => {
  const M = await import('../../src/ui/screens/newGameModel.js');
  const setup = M.createSetup({ seed: 77 });
  M.setSlotType(setup, 2, 'ai');
  M.setSlotFaction(setup, 0, 'castle');
  setup.underground = true;
  const bp = generateMap(M.buildMapOptions(setup));
  assert.notEqual(bp.ok, false, bp.error);
  assert.equal(bp.meta.playerSlots, 3);
  assert.equal(bp.map.levels, 2);
  resetGameDeps();
  const state = createGame(bp, M.buildGameSettings(setup));
  assert.equal(state.players[0].faction, 'castle');
  M.setMapType(setup, 'scenario');
  M.setScenario(setup, { id: 'grail_hunt', playerSlots: 4 });
  const sc = generateMap(M.buildMapOptions(setup));
  assert.notEqual(sc.ok, false, sc.error);
  const settings = { ...M.buildGameSettings(setup), victory: sc.victory, loss: sc.loss };
  const s2 = createGame(sc, settings);
  assert.equal(s2.players.length, 4);
  assert.equal(s2.settings.victory.type, 'build_grail');
});
