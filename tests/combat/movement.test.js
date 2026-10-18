import test from 'node:test';
import assert from 'node:assert/strict';
import { getLegalActions, performAction, addStatus, placeObstacle } from '../../src/engine/combat/index.js';
import { reachable } from '../../src/engine/combat/actions.js';
import { hexIndex, hexFromIndex, hexDistance } from '../../src/engine/combat/hex.js';
import { battle, A, D, place, activate, act, has, damageTo } from './helpers.js';

const column = (x, skip = []) => [{ kind: 'boulder', hexes: Array.from({ length: 11 }, (_, y) => ({ x, y })).filter((h) => !skip.includes(h.y)) }];
const at = (reach, x, y) => reach.get(hexIndex({ x, y }));

test('a walker reaches exactly the free hexes within its speed on an empty field', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]]);
  const reach = reachable(cs, A(cs));
  for (let i = 0; i < 165; i++) {
    const h = hexFromIndex(i);
    assert.equal(reach.has(i), hexDistance(A(cs).pos, h) <= 4, `${h.x},${h.y}`);
    if (reach.has(i)) assert.equal(reach.get(i).dist, hexDistance(A(cs).pos, h));
  }
});

test('walkers path around obstacles and stacks', () => {
  const obstacles = [{ kind: 'boulder', hexes: [{ x: 1, y: 4 }, { x: 1, y: 5 }, { x: 1, y: 6 }] }];
  const cs = battle([['pikeman', 5]], [['imp', 5]], { obstacles });
  const reach = reachable(cs, A(cs));
  assert.equal(at(reach, 1, 5), undefined);
  assert.equal(at(reach, 2, 4).dist, 4); // (0,4) (0,3) (1,3) (2,4)
  assert.equal(at(reach, 2, 5), undefined); // 5 steps
  // a stack in the way blocks like an obstacle
  const cs2 = battle([['pikeman', 5]], [['imp', 5], ['imp', 5], ['imp', 5]]);
  place(D(cs2, 0), 1, 4); place(D(cs2, 1), 1, 5); place(D(cs2, 2), 1, 6);
  const reach2 = reachable(cs2, A(cs2));
  assert.equal(at(reach2, 1, 5), undefined);
  assert.equal(at(reach2, 2, 5), undefined);
  assert.equal(at(reach2, 2, 4).dist, 4);
});

test('a wall of obstacles stops walkers but not flyers, teleporters or burrowers', () => {
  const armies = [['cavalier', 1], ['griffin', 1], ['devil', 1], ['sandworm', 1]];
  const cs = battle(armies, [['imp', 5]], { obstacles: column(3) });
  const [cav, griffin, devil, worm] = [0, 1, 2, 3].map((i) => A(cs, i));
  for (const s of [cav, griffin, worm]) place(s, 1, 5);
  place(devil, 0, 5);
  const others = (keep) => { for (const s of [cav, griffin, devil, worm]) s.alive = s === keep; };
  others(cav);
  assert.ok([...reachable(cs, cav).keys()].every((i) => hexFromIndex(i).x <= 2), 'walker stays left of the wall');
  others(griffin);
  const fly = reachable(cs, griffin);
  assert.equal(at(fly, 7, 5).dist, 6);
  assert.equal(at(fly, 8, 5), undefined); // 7 hexes
  assert.equal(at(fly, 3, 5), undefined); // cannot land on an obstacle
  assert.equal(at(fly, 4, 5), undefined); // tail would be on the obstacle
  assert.ok(at(fly, 5, 5));
  others(devil);
  const tp = reachable(cs, devil);
  assert.equal(at(tp, 11, 5).dist, 11);
  assert.equal(at(tp, 12, 5), undefined);
  assert.equal(at(tp, 3, 5), undefined);
  others(worm);
  const dig = reachable(cs, worm);
  assert.equal(at(dig, 6, 5).dist, 5);
  assert.equal(at(dig, 7, 5).dist, 6);
  assert.equal(at(dig, 8, 5), undefined);
  assert.equal(at(dig, 3, 5), undefined);
});

test('burrowers pass under stacks, walkers do not', () => {
  const cs = battle([['sandworm', 1], ['cavalier', 1]], Array.from({ length: 7 }, () => ['imp', 1]));
  // a line of imps on column 4 with gaps too small for a two-hex walker to slip through
  cs.obstacles.push(...column(4, [5]).map((o, i) => ({ id: 100 + i, ...o, blocks: true })));
  place(D(cs, 0), 4, 5);
  const worm = place(A(cs, 0), 2, 5);
  const cav = place(A(cs, 1), 2, 3);
  assert.ok(at(reachable(cs, worm), 7, 5));
  assert.ok([...reachable(cs, cav).keys()].every((i) => hexFromIndex(i).x <= 3));
});

test('two-hex walkers need room for both hexes', () => {
  const cs = battle([['cavalier', 1]], [['imp', 5]], { obstacles: [{ kind: 'boulder', hexes: [{ x: 2, y: 5 }] }] });
  const cav = A(cs);
  const reach = reachable(cs, cav);
  assert.equal(at(reach, 2, 5), undefined);
  assert.equal(at(reach, 3, 5), undefined); // tail on the boulder
  assert.ok(at(reach, 4, 5));
  // clicking the hex the tail would occupy moves the head one further
  activate(cs, cav);
  const events = act(cs, { type: 'move', to: { x: 3, y: 5 } });
  assert.deepEqual(cav.pos, { x: 4, y: 5 });
  const mv = events.find((e) => e.type === 'move');
  assert.equal(mv.mode, 'walk');
  assert.deepEqual(mv.from, { x: 1, y: 5 });
  assert.deepEqual(mv.path[mv.path.length - 1], { x: 4, y: 5 });
});

test('move action: legal hexes, events, errors', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]]);
  const pike = activate(cs, A(cs));
  const legal = getLegalActions(cs);
  assert.equal(legal.stackId, pike.id);
  assert.equal(legal.side, 'attacker');
  assert.ok(legal.moves.some((h) => h.x === 4 && h.y === 5));
  assert.ok(!legal.moves.some((h) => h.x === 0 && h.y === 5), 'current hex is not a move');
  assert.deepEqual(legal.attacks, []);
  assert.deepEqual(legal.shots, []);
  assert.deepEqual(performAction(cs, { type: 'move', to: { x: 9, y: 5 } }), { ok: false, error: 'unreachable' });
  assert.deepEqual(performAction(cs, { type: 'move', to: { x: 0, y: 5 } }), { ok: false, error: 'unreachable' });
  assert.equal(performAction(cs, { type: 'fly_to_the_moon' }).ok, false);
  const events = act(cs, { type: 'move', to: { x: 4, y: 5 } });
  assert.deepEqual(pike.pos, { x: 4, y: 5 });
  assert.equal(events[0].type, 'move');
  assert.equal(events[0].path.length, 4);
  assert.equal(pike.acted, true);
  assert.notEqual(cs.active, pike.id);
});

test('attack options list every reachable hex next to the target', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]]);
  place(D(cs), 3, 5);
  const pike = activate(cs, A(cs));
  const legal = getLegalActions(cs);
  assert.equal(legal.attacks.length, 1);
  assert.equal(legal.attacks[0].targetId, D(cs).id);
  const from = legal.attacks[0].fromHexes.map((h) => `${h.x},${h.y}`).sort();
  assert.deepEqual(from, ['2,5', '3,4', '3,6', '4,4', '4,6']); // (4,5) is 5 steps away around the imp
  assert.deepEqual(performAction(cs, { type: 'attack', targetId: D(cs).id, from: { x: 0, y: 5 } }), { ok: false, error: 'bad_from_hex' });
  assert.deepEqual(performAction(cs, { type: 'attack', targetId: pike.id }), { ok: false, error: 'bad_target' });
  const events = act(cs, { type: 'attack', targetId: D(cs).id, from: { x: 2, y: 5 } });
  assert.deepEqual(pike.pos, { x: 2, y: 5 });
  assert.deepEqual(events.slice(0, 2).map((e) => e.type), ['move', 'attack']);
});

test('a bound stack cannot move but may still attack adjacent enemies', () => {
  const cs = battle([['pikeman', 5]], [['dendroid_guard', 5]]);
  const pike = place(A(cs), 5, 5);
  const tree = place(D(cs), 6, 5);
  addStatus(cs, pike, 'bind', { casterSide: 'defender', sourceStackId: tree.id, rounds: null });
  activate(cs, pike);
  const legal = getLegalActions(cs);
  assert.deepEqual(legal.moves, []);
  assert.deepEqual(legal.attacks, [{ targetId: tree.id, fromHexes: [{ x: 5, y: 5 }] }]);
});

test('quicksand stops enemy walkers; flyers and the owner ignore it', () => {
  const cs = battle([['pikeman', 5], ['griffin', 2]], [['imp', 5]]);
  const { obstacle } = placeObstacle(cs, { kind: 'quicksand', hexes: [{ x: 2, y: 5 }], side: 'defender', hidden: true });
  assert.equal(obstacle.blocks, false);
  const pike = activate(cs, place(A(cs, 0), 0, 5));
  const events = act(cs, { type: 'move', to: { x: 4, y: 5 } });
  assert.deepEqual(pike.pos, { x: 2, y: 5 });
  assert.ok(has(events, 'obstacle_triggered', (e) => e.kind === 'quicksand'));
  assert.equal(cs.obstacles[0].hidden, false);
  const griffin = activate(cs, place(A(cs, 1), 1, 3));
  cs.obstacles[0].hexes = [{ x: 2, y: 3 }];
  act(cs, { type: 'move', to: { x: 5, y: 3 } });
  assert.deepEqual(griffin.pos, { x: 5, y: 3 });
  // the caster's own troops walk over it
  const imp = activate(cs, place(D(cs), 6, 3));
  cs.obstacles[0].hexes = [{ x: 5, y: 4 }];
  place(griffin, 1, 9);
  act(cs, { type: 'move', to: { x: 4, y: 4 } });
  assert.deepEqual(imp.pos, { x: 4, y: 4 });
});

test('land mine explodes once under an enemy walker; fire wall burns whoever walks through', () => {
  const cs = battle([['pikeman', 20]], [['imp', 5]]);
  placeObstacle(cs, { kind: 'land_mine', hexes: [{ x: 1, y: 5 }], side: 'defender', damage: 35, element: 'fire', hidden: true });
  placeObstacle(cs, { kind: 'fire_wall', hexes: [{ x: 3, y: 5 }], side: 'defender', damage: 12, element: 'fire', rounds: 2 });
  const pike = activate(cs, A(cs));
  let events = act(cs, { type: 'move', to: { x: 4, y: 5 } });
  assert.deepEqual(pike.pos, { x: 1, y: 5 });
  assert.equal(damageTo(events, pike)[0].amount, 35);
  assert.equal(pike.count, 17);
  assert.equal(cs.obstacles.length, 1);
  activate(cs, pike);
  events = act(cs, { type: 'move', to: { x: 5, y: 5 } });
  assert.deepEqual(pike.pos, { x: 5, y: 5 });
  assert.equal(damageTo(events, pike)[0].amount, 12);
});
