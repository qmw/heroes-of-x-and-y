import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addHero, adv, fillRect, setTiles, answer, answerId, finishCombat, kinds, eventTypes, visitResults, assertJson } from './fixture.js';

const P = (x, y, z = 0) => ({ x, y, z });

/** Cost of one step for a hero standing on `from` terrain, via the real engine path. */
function stepCost(opts) {
  const { from = 'grass', to = 'grass', dx = 1, dy = 0, fromRoad = 0, toRoad = 0, hero: heroOpts = {} } = opts;
  const state = makeState();
  Object.assign(state.map.tiles[0][5][5], { t: from, road: fromRoad });
  Object.assign(state.map.tiles[0][5 + dy][5 + dx], { t: to, road: toRoad });
  const hero = addHero(state, { pos: P(5, 5), ...heroOpts });
  if (heroOpts.equip) for (const [slot, id] of Object.entries(heroOpts.equip)) hero.artifacts.equipped[slot][0] = id;
  const before = hero.movePoints;
  const res = adv.moveHero(state, hero.id, P(5 + dx, 5 + dy));
  assert.ok(res.ok, res.error);
  return before - hero.movePoints;
}

test('terrain cost is the cost of the tile being LEFT (hand-computed table)', () => {
  const table = { dirt: 100, sand: 150, grass: 100, snow: 150, swamp: 175, rough: 125, subterranean: 100, lava: 100, highlands: 100, wasteland: 125 };
  for (const [terrain, cost] of Object.entries(table)) {
    assert.equal(stepCost({ from: terrain, to: 'grass' }), cost, `leaving ${terrain}`);
    assert.equal(stepCost({ from: 'grass', to: terrain }), 100, `entering ${terrain}`);
  }
});

test('diagonal steps cost floor(cost * sqrt(2)) as in the original', () => {
  for (const [terrain, cost] of [['grass', 141], ['rough', 176], ['sand', 212], ['snow', 212], ['swamp', 247], ['wasteland', 176]]) {
    assert.equal(stepCost({ from: terrain, dx: 1, dy: 1 }), cost, terrain);
    assert.equal(stepCost({ from: terrain, dx: -1, dy: -1 }), cost, terrain);
  }
});

test('roads need both ends and ignore terrain; cost of the road being left', () => {
  assert.equal(stepCost({ from: 'swamp', to: 'swamp', fromRoad: 1, toRoad: 1 }), 75);
  assert.equal(stepCost({ from: 'swamp', to: 'swamp', fromRoad: 2, toRoad: 2 }), 65);
  assert.equal(stepCost({ from: 'swamp', to: 'swamp', fromRoad: 3, toRoad: 3 }), 50);
  assert.equal(stepCost({ from: 'swamp', to: 'swamp', fromRoad: 3, toRoad: 1 }), 50, 'road of the tile left');
  assert.equal(stepCost({ from: 'swamp', to: 'swamp', fromRoad: 1, toRoad: 3 }), 75);
  assert.equal(stepCost({ from: 'swamp', to: 'swamp', fromRoad: 3, toRoad: 0 }), 175, 'leaving the road');
  assert.equal(stepCost({ from: 'swamp', to: 'swamp', fromRoad: 0, toRoad: 3 }), 175, 'entering the road');
  assert.equal(stepCost({ from: 'sand', fromRoad: 1, toRoad: 1, dx: 1, dy: 1 }), 106);
  assert.equal(stepCost({ from: 'sand', fromRoad: 2, toRoad: 2, dx: 1, dy: 1 }), 91);
  assert.equal(stepCost({ from: 'sand', fromRoad: 3, toRoad: 3, dx: 1, dy: 1 }), 70);
});

test('Pathfinding subtracts 25/50/75, never below 100', () => {
  const pf = (level) => ({ skills: [{ id: 'pathfinding', level }] });
  assert.equal(stepCost({ from: 'swamp', hero: pf(1) }), 150);
  assert.equal(stepCost({ from: 'swamp', hero: pf(2) }), 125);
  assert.equal(stepCost({ from: 'swamp', hero: pf(3) }), 100);
  assert.equal(stepCost({ from: 'sand', hero: pf(1) }), 125);
  assert.equal(stepCost({ from: 'sand', hero: pf(2) }), 100);
  assert.equal(stepCost({ from: 'rough', hero: pf(1) }), 100);
  assert.equal(stepCost({ from: 'grass', hero: pf(3) }), 100);
  assert.equal(stepCost({ from: 'swamp', hero: pf(1), dx: 1, dy: 1 }), 212);
  assert.equal(stepCost({ from: 'swamp', hero: pf(3), fromRoad: 1, toRoad: 1 }), 75, 'roads are not affected');
});

test('native terrain: an army entirely native to the terrain pays 100; nomads make sand native', () => {
  const army = (...ids) => ({ army: ids.map((creatureId) => ({ creatureId, count: 5 })) });
  assert.equal(stepCost({ from: 'swamp', hero: army('gnoll', 'lizardman') }), 100, 'fortress army on swamp');
  assert.equal(stepCost({ from: 'swamp', hero: army('gnoll', 'pikeman') }), 175, 'one foreign stack breaks it');
  assert.equal(stepCost({ from: 'swamp', hero: army('gnoll', 'peasant') }), 175, 'neutral stack breaks it');
  assert.equal(stepCost({ from: 'snow', hero: army('gremlin', 'mage') }), 100, 'tower army on snow');
  assert.equal(stepCost({ from: 'sand', hero: army('gremlin', 'mage') }), 150);
  assert.equal(stepCost({ from: 'rough', hero: army('goblin') }), 100, 'stronghold on rough');
  assert.equal(stepCost({ from: 'sand', hero: army('pikeman', 'nomad') }), 100, 'nomads');
  assert.equal(stepCost({ from: 'swamp', hero: army('pikeman', 'nomad') }), 175);
  assert.equal(stepCost({ from: 'swamp', hero: army('gnoll'), dx: 1, dy: 1 }), 141);
});

test('terrain_penalty_reduction artifacts scale the remaining penalty', () => {
  assert.equal(stepCost({ from: 'swamp', hero: { equip: { feet: 'wayfarers_boots' } } }), 100);
  assert.equal(stepCost({ from: 'swamp', hero: { equip: { feet: 'trailblazers_boots' } } }), 156, '100 + floor(75 * 0.75)');
  assert.equal(stepCost({ from: 'swamp', hero: { equip: { feet: 'trailblazers_boots' }, skills: [{ id: 'pathfinding', level: 1 }] } }), 137, '150 -> 100 + floor(50 * 0.75)');
});

test('last-step rule: a diagonal step is allowed with at least the orthogonal cost and uses everything', () => {
  assert.equal(stepCost({ dx: 1, dy: 1, hero: { movePoints: 141 } }), 141);
  assert.equal(stepCost({ dx: 1, dy: 1, hero: { movePoints: 120 } }), 120, 'consumes all remaining points');
  assert.equal(stepCost({ dx: 1, dy: 1, hero: { movePoints: 100 } }), 100);
  const state = makeState();
  const hero = addHero(state, { pos: P(5, 5), movePoints: 99 });
  assert.deepEqual(adv.moveHero(state, hero.id, P(6, 6)), { ok: false, error: 'no_movement_points', events: [] });
  assert.equal(adv.moveHero(state, hero.id, P(6, 5)).error, 'no_movement_points');
  hero.movePoints = 100;
  assert.ok(adv.moveHero(state, hero.id, P(6, 5)).ok);
  assert.equal(hero.movePoints, 0);
  assert.equal(adv.spendStep(150, 141, 100, true), 9);
  assert.equal(adv.spendStep(100, 141, 100, true), 0);
  assert.equal(adv.spendStep(99, 141, 100, true), -1);
  assert.equal(adv.spendStep(120, 150, 150, false), -1);
});

test('findPath: straight, diagonal, around obstacles, unreachable', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 1) });
  const p = adv.findPath(state, hero.id, P(4, 4));
  assert.equal(p.cost, 3 * 141);
  assert.equal(p.turns, 0);
  assert.deepEqual(p.path, [P(2, 2), P(3, 3), P(4, 4)]);
  assert.equal(adv.findPath(state, hero.id, P(1, 1)), null);
  assert.equal(adv.findPath(state, hero.id, P(99, 1)), null);
  // wall with a gap
  fillRect(state, 6, 0, 6, 11, { blocked: true });
  assert.equal(adv.findPath(state, hero.id, P(8, 1)), null);
  state.map.tiles[0][9][6].blocked = false;
  const around = adv.findPath(state, hero.id, P(8, 1));
  assert.ok(around.path.some((q) => q.x === 6 && q.y === 9));
  assert.equal(adv.findPath(state, hero.id, P(6, 3)), null, 'blocked tile is no destination');
  // rock is impassable
  state.map.tiles[0][9][6].t = 'rock';
  assert.equal(adv.findPath(state, hero.id, P(8, 1)), null);
});

test('findPath prefers roads and cheap terrain', () => {
  const state = makeState({ terrain: 'swamp' });
  const hero = addHero(state, { pos: P(1, 5) });
  fillRect(state, 1, 6, 10, 6, { road: 3 });
  const p = adv.findPath(state, hero.id, P(10, 5));
  // straight line through the swamp: 9 * 175 = 1575. Via the road: step down (175), 9 road steps (50), step up (175)
  assert.equal(p.cost, 175 + 9 * 50 + 175);
  assert.ok(p.path.slice(0, -1).every((q) => q.y === 6));
  assert.equal(p.steps.length, 11);
});

test('multi-day paths: turns counted, moveHero walks only what today allows', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 1), movePoints: 250, maxMovePoints: 1560 });
  const p = adv.findPath(state, hero.id, P(8, 1));
  assert.equal(p.turns, 1);
  assert.equal(p.cost, 700);
  assert.deepEqual(p.steps.map((s) => s.turn), [0, 0, 1, 1, 1, 1, 1]);
  const far = adv.findPath(state, hero.id, P(15, 11));
  assert.equal(far.turns, 1);
  const res = adv.moveHero(state, hero.id, P(8, 1));
  assert.ok(res.ok);
  assert.equal(res.arrived, false);
  assert.equal(res.stopped, 'out_of_movement');
  assert.deepEqual(hero.pos, P(3, 1));
  assert.equal(hero.movePoints, 50);
  assert.equal(res.events.filter((e) => e.type === 'move').length, 2);
  // three days for a long swamp walk with few points per day
  const s2 = makeState({ terrain: 'swamp', width: 30 });
  const slow = addHero(s2, { pos: P(0, 0), movePoints: 0, army: [{ creatureId: 'walking_dead', count: 1 }] });
  // walking dead speed 3 -> 1500 per day -> 8 swamp steps a day (175 each)
  const long = adv.findPath(s2, slow.id, P(20, 0));
  assert.equal(long.turns, 3);
  assert.deepEqual([long.steps[0].turn, long.steps[7].turn, long.steps[8].turn, long.steps[16].turn, long.steps[19].turn], [1, 1, 2, 3, 3]);
});

test('getReachable lists tiles with cost and interaction kind', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(5, 5), movePoints: 200 });
  adv.addObject(state, 'resource_wood', P(6, 5));
  adv.addObject(state, 'mountains_2x2', P(4, 4)); // blocks 3..4 x 3..4
  const reach = adv.getReachable(state, hero.id);
  const at = (x, y) => reach.find((r) => r.x === x && r.y === y);
  assert.deepEqual(at(5, 7), { x: 5, y: 7, z: 0, cost: 200, turns: 0, kind: 'move' });
  assert.equal(at(6, 5).kind, 'adjacent');
  assert.equal(at(4, 4), undefined);
  assert.equal(at(5, 8), undefined);
  assert.equal(at(7, 5), undefined, 'cannot walk through a pickup');
  assert.equal(at(6, 6).cost, 141);
  assert.ok(adv.getReachable(state, hero.id, 1).length > reach.length);
});

test('moveHero refuses when it is not the hero\'s turn, during combat or with a pending choice', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 1) });
  const foe = addHero(state, { pos: P(9, 9), owner: 1, id: 'foe' });
  assert.equal(adv.moveHero(state, foe.id, P(9, 8)).error, 'not_your_turn');
  assert.equal(adv.moveHero(state, 'nobody', P(9, 8)).error, 'no_such_hero');
  state.combat = { stub: true };
  assert.equal(adv.moveHero(state, hero.id, P(2, 1)).error, 'in_combat');
  state.combat = null;
  state.pending.push({ id: 99, kind: 'x', playerId: 0, options: [] });
  assert.equal(adv.moveHero(state, hero.id, P(2, 1)).error, 'pending_choice');
  state.pending = [];
  assert.ok(adv.moveHero(state, hero.id, P(2, 1)).ok);
});

test('adjacent objects are used from the neighbouring tile at the cost of the step; the hero stays', () => {
  const state = makeState({ terrain: 'sand' });
  const hero = addHero(state, { pos: P(3, 3) });
  adv.addObject(state, 'resource_gold', P(5, 3));
  const res = adv.moveHero(state, hero.id, P(5, 3));
  assert.ok(res.ok && res.arrived);
  assert.deepEqual(hero.pos, P(4, 3));
  assert.equal(hero.movePoints, 1500 - 300);
  assert.ok(state.players[0].resources.gold > 20000);
  assert.equal(adv.getObjectAt(state, P(5, 3)), null);
  assert.deepEqual(eventTypes(res), ['move', 'pickup', 'resources']);
  // cannot afford the step -> no pickup
  adv.addObject(state, 'resource_wood', P(5, 3));
  hero.movePoints = 100;
  assert.equal(adv.moveHero(state, hero.id, P(5, 3)).error, 'no_movement_points');
  assert.ok(adv.getObjectAt(state, P(5, 3)));
});

test('enter objects: the hero walks onto the entrance, never through blocked tiles or from above', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(5, 2) });
  const mine = adv.addObject(state, 'sawmill', P(5, 5)); // blocks (4..6, 4) and (4,5),(6,5)
  const p = adv.findPath(state, hero.id, P(5, 5));
  const last = p.path[p.path.length - 2];
  assert.equal(last.y, 6, 'approached from the row below');
  const res = adv.moveHero(state, hero.id, P(5, 5));
  assert.ok(res.arrived);
  assert.deepEqual(hero.pos, P(5, 5));
  assert.equal(mine.owner, 0);
  // a 1x2 tower: its upper tile is blocked, diagonals from above are refused
  const state2 = makeState();
  const h2 = addHero(state2, { pos: P(4, 4) });
  adv.addObject(state2, 'marletto_tower', P(5, 5));
  const ctx = adv.getMoveContext(state2, h2);
  assert.equal(adv.classifyStep(state2, ctx, P(4, 4), P(5, 5), false).kind, 'blocked');
  assert.equal(adv.classifyStep(state2, ctx, P(4, 5), P(5, 5), false).kind, 'enter');
  assert.equal(adv.classifyStep(state2, ctx, P(4, 6), P(5, 5), false).kind, 'enter');
  assert.equal(adv.classifyStep(state2, ctx, P(5, 3), P(5, 4), false).kind, 'blocked');
  // 1x1 objects can be entered from any side
  adv.addObject(state2, 'learning_stone', P(10, 5));
  assert.equal(adv.classifyStep(state2, ctx, P(10, 4), P(10, 5), false).kind, 'enter');
  // paths never run through an entrance
  const state3 = makeState({ width: 7, height: 3 });
  fillRect(state3, 0, 0, 6, 0, { blocked: true });
  fillRect(state3, 0, 2, 6, 2, { blocked: true });
  const h3 = addHero(state3, { pos: P(0, 1) });
  adv.addObject(state3, 'learning_stone', P(3, 1));
  assert.equal(adv.findPath(state3, h3.id, P(6, 1)), null);
  assert.equal(adv.findPath(state3, h3.id, P(3, 1)).cost, 300);
});

test('monster zone of control: stepping next to a monster stops the hero and starts the fight', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 5) });
  const mon = adv.addObject(state, 'monster', P(5, 6), { data: { creatureId: 'imp', count: 200, disposition: 'savage' } });
  const res = adv.moveHero(state, hero.id, P(9, 5), { path: [2, 3, 4, 5, 6, 7, 8, 9].map((x) => P(x, 5)) });
  assert.ok(res.ok);
  assert.equal(res.stopped, 'guard');
  assert.deepEqual(hero.pos, P(4, 5), 'first guarded tile');
  assert.equal(state.combat.context.kind, 'adv_monster');
  assert.equal(state.combat.context.objectId, mon.id);
  assert.equal(adv.moveHero(state, hero.id, P(3, 5)).error, 'in_combat');
  // the path-finder routes around the zone when it can
  finishCombat(state, 'attacker');
  assert.equal(state.map.objects[mon.id], undefined);
  const mon2 = adv.addObject(state, 'monster', P(7, 6), { data: { creatureId: 'imp', count: 200, disposition: 'savage' } });
  const p = adv.findPath(state, hero.id, P(10, 5));
  assert.ok(p.path.every((q) => Math.max(Math.abs(q.x - 7), Math.abs(q.y - 6)) > 1), 'detour around the guarded tiles');
  // attacking the monster itself: walk to a neighbouring tile, the fight starts there
  const attack = adv.findPath(state, hero.id, P(7, 6));
  assert.equal(attack.steps[attack.steps.length - 1].kind, 'adjacent');
  const r2 = adv.moveHero(state, hero.id, P(7, 6));
  assert.ok(r2.ok);
  assert.equal(state.combat.context.objectId, mon2.id);
  assert.equal(Math.max(Math.abs(hero.pos.x - 7), Math.abs(hero.pos.y - 6)), 1);
});

test('a guarded pickup: the monster is fought first, then the visit continues', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(2, 5) });
  adv.addObject(state, 'resource_wood', P(4, 5));
  const mon = adv.addObject(state, 'monster', P(5, 5), { data: { creatureId: 'imp', count: 200, disposition: 'savage' } });
  const wood = state.players[0].resources.wood;
  const res = adv.moveHero(state, hero.id, P(4, 5));
  assert.ok(res.ok);
  assert.deepEqual(hero.pos, P(3, 5));
  assert.equal(state.combat.context.objectId, mon.id);
  assert.deepEqual(state.combat.context.then, { type: 'visit', objectId: 'o1' });
  assert.equal(state.players[0].resources.wood, wood, 'nothing picked up before the fight');
  const fin = finishCombat(state, 'attacker');
  assert.deepEqual(fin.events.map((e) => e.type), ['monster_defeated', 'pickup', 'resources']);
  assert.ok(state.players[0].resources.wood > wood);
  // losing cancels the action
  const s2 = makeState();
  const h2 = addHero(s2, { pos: P(2, 5) });
  adv.addObject(s2, 'resource_wood', P(4, 5));
  adv.addObject(s2, 'monster', P(5, 5), { data: { creatureId: 'imp', count: 200, disposition: 'savage' } });
  adv.moveHero(s2, h2.id, P(4, 5));
  finishCombat(s2, 'defender', [{ creatureId: 'imp', count: 150 }]);
  assert.ok(adv.getObjectAt(s2, P(4, 5)), 'pile still there');
  assert.equal(adv.getObjectAt(s2, P(5, 5)).data.count, 150);
});

test('heroes: meeting an ally opens the exchange, an enemy is attacked, nobody walks through heroes', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(2, 2) });
  const friend = addHero(state, { pos: P(4, 2), id: 'friend' });
  const foe = addHero(state, { pos: P(2, 4), owner: 1, id: 'foe' });
  let res = adv.moveHero(state, hero.id, P(4, 2));
  assert.deepEqual(hero.pos, P(3, 2));
  assert.deepEqual(kinds(state), ['hero_exchange']);
  assert.equal(state.pending[0].data.otherHeroId, friend.id);
  assert.ok(eventTypes(res).includes('hero_meeting'));
  answer(state, 0);
  res = adv.moveHero(state, hero.id, P(2, 4));
  assert.equal(Math.max(Math.abs(hero.pos.x - 2), Math.abs(hero.pos.y - 4)), 1, 'stops next to the enemy');
  assert.equal(state.combat.context.kind, 'adv_hero');
  assert.deepEqual(state.combat.defender, { heroId: foe.id });
  finishCombat(state, 'attacker');
  assert.equal(state.players[0].visited.killed_hero_foe, true);
  // a corridor blocked by a hero
  const s2 = makeState({ width: 7, height: 3 });
  fillRect(s2, 0, 0, 6, 0, { blocked: true });
  fillRect(s2, 0, 2, 6, 2, { blocked: true });
  const a = addHero(s2, { pos: P(0, 1) });
  addHero(s2, { pos: P(3, 1), id: 'b' });
  assert.equal(adv.findPath(s2, a.id, P(6, 1)), null);
});

test('sanctuary: an enemy cannot step onto a hero resting inside', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(5, 8) });
  adv.addObject(state, 'sanctuary', P(5, 5));
  const foe = addHero(state, { pos: P(5, 5), owner: 1, id: 'foe' });
  assert.equal(adv.findPath(state, hero.id, P(5, 5)), null);
  foe.owner = 0; // a friend inside can be met
  assert.ok(adv.findPath(state, hero.id, P(5, 5)));
});

test('towns: enter own town, capture an empty enemy town, besiege a defended one', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(8, 9) });
  const mk = (id, x, owner) => {
    state.towns[id] = { id, name: id, pos: P(x, 5), owner, garrison: new Array(7).fill(null), visitingHero: null, garrisonHero: null, buildings: [] };
    if (owner != null) state.players[owner].towns.push(id);
    return adv.addObject(state, 'town', P(x, 5), { owner, data: { townId: id } });
  };
  mk('own', 3, 0);
  mk('empty', 9, 1);
  let res = adv.moveHero(state, hero.id, P(3, 5));
  assert.ok(res.arrived, JSON.stringify(res));
  assert.deepEqual(hero.pos, P(3, 5));
  assert.equal(hero.townId, 'own');
  assert.equal(state.towns.own.visitingHero, hero.id);
  // leaving clears the visit
  hero.movePoints = 3000;
  res = adv.moveHero(state, hero.id, P(9, 5));
  assert.equal(state.towns.own.visitingHero, null);
  assert.equal(state.towns.empty.owner, 0);
  assert.deepEqual(state.players[1].towns, []);
  assert.ok(state.players[0].towns.includes('empty'));
  assert.equal(hero.townId, 'empty');
  assert.ok(eventTypes(res).includes('town_captured'));
  // defended town -> siege, capture on victory
  const s2 = makeState();
  const h2 = addHero(s2, { pos: P(5, 6) });
  s2.towns.fort = { id: 'fort', name: 'fort', pos: P(5, 5), owner: null, garrison: [{ creatureId: 'pikeman', count: 30 }, null, null, null, null, null, null], visitingHero: null, garrisonHero: null, buildings: [] };
  adv.addObject(s2, 'town', P(5, 5), { data: { townId: 'fort' } });
  adv.moveHero(s2, h2.id, P(5, 5));
  assert.deepEqual(h2.pos, P(5, 6), 'waits outside during the siege');
  assert.deepEqual(s2.combat.defender, { townId: 'fort' });
  assert.equal(s2.combat.context.kind, 'adv_town');
  finishCombat(s2, 'attacker');
  assert.equal(s2.towns.fort.owner, 0);
  assert.deepEqual(h2.pos, P(5, 5));
  // lost siege: nothing changes
  const s3 = makeState();
  const h3 = addHero(s3, { pos: P(5, 6) });
  s3.towns.fort = { id: 'fort', name: 'fort', pos: P(5, 5), owner: 1, garrison: [{ creatureId: 'pikeman', count: 30 }, null, null, null, null, null, null], visitingHero: null, garrisonHero: null, buildings: [] };
  adv.addObject(s3, 'town', P(5, 5), { owner: 1, data: { townId: 'fort' } });
  adv.moveHero(s3, h3.id, P(5, 5));
  finishCombat(s3, 'defender');
  assert.equal(s3.towns.fort.owner, 1);
});

test('events fire when stepped on and stop the walk; signs are walked over', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 1) });
  adv.addObject(state, 'sign', P(2, 1), { data: { text: 'Beware' } });
  const ev = adv.addObject(state, 'event', P(4, 1), { data: { resources: { gold: 300 }, message: 'Found it', once: true } });
  const gold = state.players[0].resources.gold;
  const res = adv.moveHero(state, hero.id, P(8, 1), { path: [2, 3, 4, 5, 6, 7, 8].map((x) => P(x, 1)) });
  assert.deepEqual(hero.pos, P(4, 1));
  assert.equal(res.stopped, 'event');
  assert.equal(state.players[0].resources.gold, gold + 300);
  assert.ok(!eventTypes(res).includes('message'), 'sign not read while passing');
  assert.equal(state.map.objects[ev.id], undefined);
  const back = adv.moveHero(state, hero.id, P(2, 1));
  assert.deepEqual(back.events.filter((e) => e.type === 'message').map((e) => e.text), ['Beware']);
  assert.deepEqual(hero.pos, P(2, 1));
});

test('state stays JSON-serializable after moving, fighting and visiting', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 1) });
  adv.addObject(state, 'treasure_chest', P(3, 1));
  adv.addObject(state, 'monster', P(6, 6), { data: { creatureId: 'imp', count: 10, disposition: 'savage' } });
  adv.moveHero(state, hero.id, P(3, 1));
  assertJson(assert, state);
  if (state.pending.length) answer(state, 0);
  adv.moveHero(state, hero.id, P(6, 6));
  assertJson(assert, state);
  void answerId; void setTiles; void visitResults;
});
