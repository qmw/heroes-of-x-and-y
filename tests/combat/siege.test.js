// Siege combat: layout, walls, gate, moat, mines, arrow towers, catapult, Cyclops, wall penalty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { battle, hero, A, D, machine, place, activate, act, has, firstDamage, shoot } from './helpers.js';
import { getLegalActions, performAction, getStackInfo } from '../../src/engine/combat/index.js';
import { reachable } from '../../src/engine/combat/actions.js';
import { defenseOf } from '../../src/engine/combat/stats.js';
import { hexIndex, W, H } from '../../src/engine/combat/hex.js';
import {
  SIEGE_LAYOUT, damageWall, earthquake, siegeZone, isBehindWalls, siegeBlocksHex, siegeShotPenalty, catapultAct,
  siegeOnRoundStart, siegeOnTurnStart, getSiegeTargets, chooseSiegeTarget, wallPathCost, towerDamage, towerTarget,
  siegeTeleportAllowed, getSiegeStructures, BALLISTICS,
} from '../../src/engine/combat/siege.js';
import { FACTIONS_DATA } from '../../src/data/factions.js';
import { SKILLS } from '../../src/data/skills.js';

const SIEGE = (fortLevel, faction = 'castle', extra = {}) => ({ fortLevel, faction, buildings: [], ...extra });
const ballistics = (level) => SKILLS.find((s) => s.id === 'ballistics').levels[level - 1].effects[0];
const reachSet = (cs, s, speed = 99) => new Set([...reachable(cs, s, speed).keys()]);
const at = (x, y) => hexIndex({ x, y });

test('layout: fort / citadel / castle structures, hp and towers', () => {
  const fort = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(1) });
  assert.equal(fort.siege.walls.length, 4);
  assert.ok(fort.siege.walls.every((w) => w.hp === 2 && w.maxHp === 2));
  assert.equal(fort.siege.gate.hp, 2);
  assert.deepEqual(fort.siege.towers, []);
  assert.equal(fort.siege.moat, null);

  const citadel = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(2) });
  assert.deepEqual(citadel.siege.towers.map((t) => t.id), ['keep']);
  assert.equal(citadel.siege.moat.damage, 70);
  assert.ok(citadel.siege.walls.every((w) => w.hp === 2));

  const castle = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(3, 'castle', { buildings: new Array(10).fill('x') }) });
  assert.deepEqual(castle.siege.towers.map((t) => [t.id, t.kind, t.hp]), [['keep', 'keep', 2], ['tower_upper', 'turret', 2], ['tower_lower', 'turret', 2]]);
  assert.ok(castle.siege.walls.every((w) => w.hp === 3));
  assert.deepEqual(castle.siege.towers[0].damage, { min: 30, max: 45 });
  assert.deepEqual(castle.siege.towers[1].damage, { min: 16, max: 29 });
  assert.equal(getSiegeStructures(castle).length, 8);
  // town.js getSiegeInfo fields override the derived values
  const custom = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(3, 'castle', { wallHp: 5, gateHp: 4, turrets: 1, towers: { attack: 12, keep: { min: 1, max: 2 }, turret: { min: 3, max: 4 } } }) });
  assert.equal(custom.siege.walls[0].hp, 5);
  assert.equal(custom.siege.gate.hp, 4);
  assert.deepEqual(custom.siege.towers.map((t) => t.id), ['keep', 'tower_upper']);
  assert.equal(custom.siege.towerAttack, 12);
  // unknown faction / level 0: no crash, no walls
  const odd = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(0, 'nope') });
  assert.equal(odd.siege.walled, false);
  assert.equal(siegeBlocksHex(odd, { x: 12, y: 0 }), false);
  assert.equal(siegeZone(odd, { x: 13, y: 5 }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(castle)), castle);
});

test('layout: the wall line is one connected chain; armies, tent, cart and ballista start inside', () => {
  const L = SIEGE_LAYOUT;
  for (let y = 0; y < H - 1; y++) {
    const a = { x: L.line[y], y };
    const b = { x: L.line[y + 1], y: y + 1 };
    const dx = b.x - a.x;
    assert.ok((y & 1) ? dx === 0 || dx === 1 : dx === 0 || dx === -1, `row ${y}`);
  }
  const cs = battle([['pikeman', 5]], [['pikeman', 5], ['cavalier', 2], ['archer', 3], ['pikeman', 1], ['pikeman', 1], ['pikeman', 1], ['pikeman', 1]],
    { siege: SIEGE(3), machinesD: ['first_aid_tent', 'ammo_cart', 'ballista'] });
  for (const s of cs.stacks.filter((x) => x.side === 'defender')) assert.ok(isBehindWalls(cs, s.id), `${s.creatureId} at ${JSON.stringify(s.pos)}`);
  for (const s of cs.stacks.filter((x) => x.side === 'attacker')) assert.equal(isBehindWalls(cs, s), false);
  assert.equal(siegeZone(cs, { x: 9, y: 5 }), 'gate');
  assert.equal(siegeZone(cs, { x: 10, y: 4 }), 'wall');
  assert.equal(siegeZone(cs, { x: 9, y: 4 }), 'moat');
  assert.equal(siegeZone(cs, { x: 8, y: 5 }), 'outside'); // drawbridge
  assert.equal(siegeZone(cs, { x: 13, y: 0 }), 'inside');
});

test('every faction: moat from faction data at citadel+, Tower gets hidden land mines, nothing at fort level', () => {
  for (const f of FACTIONS_DATA) {
    const fort = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(1, f.id) });
    assert.equal(fort.siege.moat, null, f.id);
    assert.deepEqual(fort.obstacles, [], f.id);
    const cit = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(2, f.id), seed: 7 });
    if (f.siege.moat) {
      assert.equal(cit.siege.moat.damage, f.siege.moat.damage, f.id);
      assert.equal(cit.siege.moat.name, f.siege.moat.name, f.id);
      assert.equal(cit.siege.moat.hexes.length, 10, f.id);
      assert.deepEqual(cit.obstacles, [], f.id);
    } else {
      assert.equal(cit.siege.moat, null, f.id);
      const mines = cit.obstacles.filter((o) => o.kind === 'land_mine');
      assert.equal(mines.length, f.siege.mines.count, f.id);
      const zone = new Set(SIEGE_LAYOUT.mineZone.map(hexIndex));
      for (const m of mines) {
        assert.ok(zone.has(hexIndex(m.hexes[0])));
        assert.equal(m.side, 'defender');
        assert.equal(m.hidden, true);
        assert.equal(m.damage, f.siege.mines.damage);
        assert.equal(m.blocks, false);
      }
      assert.equal(new Set(mines.map((m) => hexIndex(m.hexes[0]))).size, mines.length);
    }
  }
});

test('Tower land mines hurt attacker walkers, never the defender', () => {
  const cs = battle([['pikeman', 50]], [['pikeman', 50]], { siege: SIEGE(2, 'tower') });
  const mine = cs.obstacles.find((o) => o.kind === 'land_mine');
  const h = mine.hexes[0];
  const a = place(A(cs), h.x - 1, h.y);
  activate(cs, a);
  const ev = act(cs, { type: 'move', to: h });
  assert.ok(has(ev, 'obstacle_triggered', (e) => e.kind === 'land_mine'));
  assert.ok(firstDamage(ev, a) > 0);
  const cs2 = battle([['pikeman', 50]], [['pikeman', 50]], { siege: SIEGE(2, 'tower') });
  const m2 = cs2.obstacles.find((o) => o.kind === 'land_mine').hexes[0];
  const d = place(D(cs2), m2.x + 1, m2.y);
  activate(cs2, d);
  const ev2 = act(cs2, { type: 'move', to: m2 });
  assert.ok(!has(ev2, 'obstacle_triggered'));
});

test('walls block walkers of both sides; the closed gate only the attacker', () => {
  for (const level of [1, 3]) {
    const cs = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(level) });
    const a = place(A(cs), 5, 5);
    const reach = reachSet(cs, a);
    for (const i of reach) {
      const h = { x: i % W, y: Math.floor(i / W) };
      assert.ok(!['inside', 'gate', 'wall'].includes(siegeZone(cs, h)), `attacker reached ${JSON.stringify(h)} at level ${level}`);
    }
    // defender walks out through the gate
    const d = D(cs);
    assert.ok(reachSet(cs, d).has(at(5, 4)));
    assert.ok(!reachSet(cs, d).has(at(10, 4)), 'never onto an intact wall');
  }
  const cs = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(1) });
  assert.equal(siegeBlocksHex(cs, { x: 9, y: 5 }), true); // no stack: conservative
  assert.equal(siegeBlocksHex(cs, { x: 9, y: 5 }, D(cs)), false);
  assert.equal(siegeBlocksHex(cs, { x: 9, y: 5 }, A(cs)), true);
  assert.equal(siegeBlocksHex(cs, { x: 11, y: 2 }, D(cs)), true);
});

test('the gate opens for a defender walking through and closes when it is empty again', () => {
  const cs = battle([['pikeman', 5]], [['pikeman', 5], ['pikeman', 5]], { siege: SIEGE(1) });
  const d = place(D(cs), 11, 5);
  activate(cs, d);
  const ev = act(cs, { type: 'move', to: { x: 7, y: 5 } });
  assert.ok(has(ev, 'gate_opened', (e) => e.stackId === d.id));
  assert.equal(d.pos.x, 7);
  if (cs.siege.gate.open) assert.ok(has(siegeTurnEvents(cs), 'gate_closed')); // next fresh turn start
  assert.equal(cs.siege.gate.open, false);
  // a defender standing in the gate keeps it open; attackers may not land on a closed gate
  const cs2 = battle([['royal_griffin', 5]], [['pikeman', 5], ['pikeman', 5]], { siege: SIEGE(1) });
  const g = A(cs2);
  place(g, 5, 5);
  assert.ok(!reachSet(cs2, g, 9).has(at(10, 5)));
  assert.ok(reachSet(cs2, g, 9).has(at(12, 5)), 'flyers cross the walls');
  const d2 = place(D(cs2), 11, 5);
  activate(cs2, d2);
  act(cs2, { type: 'move', to: { x: 10, y: 5 } });
  assert.equal(cs2.siege.gate.open, true);
  assert.ok(!has(siegeTurnEvents(cs2), 'gate_closed'));
});

function siegeTurnEvents(cs) {
  const events = [];
  siegeOnTurnStart(cs, cs.stacks.find((s) => s.alive), events);
  return events;
}

test('destroyed wall sections and gate become passable rubble; towers stop shooting', () => {
  const cs = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(3) });
  const a = place(A(cs), 8, 4);
  assert.ok(!reachSet(cs, a).has(at(11, 4)));
  const ev = damageWall(cs, 'wall_upper_mid', 2, 'test');
  assert.deepEqual(ev.map((e) => e.type), ['wall_damaged']);
  assert.equal(ev[0].hp, 1);
  const ev2 = damageWall(cs, 'wall_upper_mid', 5, 'test');
  assert.deepEqual(ev2.map((e) => e.type), ['wall_damaged', 'wall_destroyed']);
  assert.equal(ev2[0].amount, 1);
  assert.deepEqual(damageWall(cs, 'wall_upper_mid', 1), []);
  assert.deepEqual(damageWall(cs, 'nope', 1), []);
  // the moat (9,4) is in the way; from inside the moat the breach leads in
  place(a, 9, 4);
  a.inMoat = true;
  assert.ok(reachSet(cs, a).has(at(10, 4)));
  assert.ok(reachSet(cs, a).has(at(11, 4)));
  // gate
  damageWall(cs, 'gate', 2);
  assert.equal(siegeBlocksHex(cs, { x: 10, y: 5 }), false);
  place(a, 7, 5);
  a.inMoat = false;
  assert.ok(reachSet(cs, a).has(at(11, 5)));
  // towers
  damageWall(cs, 'keep', 2);
  const events = [];
  siegeOnRoundStart(cs, events);
  assert.deepEqual(events.filter((e) => e.type === 'tower_shot').map((e) => e.towerId), ['tower_upper', 'tower_lower']);
});

test('moat: entering stops the walker, deals faction damage once, -3 defense; again at turn start; flyers over it are safe', () => {
  const cs = battle([['pikeman', 50], ['royal_griffin', 20]], [['pikeman', 5]], { siege: SIEGE(2, 'inferno') });
  const a = place(A(cs, 0), 6, 4);
  const reach = reachSet(cs, a, 99);
  assert.ok(reach.has(at(9, 4)));
  assert.equal(defenseOf(cs, a), 5);
  activate(cs, a);
  const ev = act(cs, { type: 'move', to: { x: 9, y: 4 } });
  assert.ok(has(ev, 'moat_damage', (e) => e.stackId === a.id && e.amount === 90));
  assert.ok(has(ev, 'damage', (e) => e.stackId === a.id && e.kind === 'moat' && e.amount === 90));
  assert.equal(a.count, 41);
  assert.equal(a.inMoat, true);
  assert.equal(defenseOf(cs, a), 2);
  const t = [];
  siegeOnTurnStart(cs, a, t);
  assert.ok(has(t, 'moat_damage'));
  assert.equal(a.count, 32);
  // a walker heading through the moat stops in it
  const cs2 = battle([['pikeman', 50]], [['pikeman', 5]], { siege: SIEGE(2) });
  damageWall(cs2, 'wall_upper_mid', 2);
  const w = place(A(cs2), 7, 4);
  assert.ok(!reachSet(cs2, w).has(at(10, 4)), 'cannot walk through the moat in one move');
  // flyer passes over
  const g = place(A(cs, 1), 6, 2);
  activate(cs, g);
  const ev2 = act(cs, { type: 'move', to: { x: 12, y: 4 } });
  assert.ok(!has(ev2, 'moat_damage'));
  // flyer landing in the moat is hurt
  const cs3 = battle([['royal_griffin', 20]], [['pikeman', 5]], { siege: SIEGE(2) });
  const g3 = place(A(cs3), 5, 3);
  activate(cs3, g3);
  const ev3 = act(cs3, { type: 'move', to: { x: 9, y: 3 } });
  assert.ok(has(ev3, 'moat_damage', (e) => e.amount === 70));
  // fort level: no moat
  const cs4 = battle([['pikeman', 50]], [['pikeman', 5]], { siege: SIEGE(1) });
  const a4 = place(A(cs4), 6, 4);
  activate(cs4, a4);
  assert.ok(!has(act(cs4, { type: 'move', to: { x: 9, y: 4 } }), 'moat_damage'));
});

test('arrow towers: damage formula from buildings, keep first, best target, Armorer, round-start timing', () => {
  const siege = SIEGE(3, 'castle', { buildings: new Array(10).fill('x') });
  const cs = battle([['pikeman', 100]], [['pikeman', 5]], { siege });
  const shots = cs.startEvents.filter((e) => e.type === 'tower_shot');
  assert.deepEqual(shots.map((e) => [e.towerId, e.damage]), [['keep', 56], ['tower_upper', 36], ['tower_lower', 36]]);
  assert.ok(cs.startEvents.findIndex((e) => e.type === 'tower_shot') < cs.startEvents.findIndex((e) => e.type === 'turn_start'));
  assert.ok(has(cs.startEvents, 'damage', (e) => e.kind === 'tower' && e.amount === 56));
  // min roll, Armorer 15%
  const keep = cs.siege.towers[0];
  const p = A(cs);
  assert.equal(towerDamage(cs, keep, p, 'min'), Math.floor(30 * 1.25));
  const cs2 = battle([['pikeman', 100]], [['pikeman', 5]], { siege, heroA: hero({ bonuses: [{ type: 'damage_reduction_percent', percent: 15 }] }) });
  assert.equal(cs2.startEvents.find((e) => e.type === 'tower_shot').damage, 47); // 45 * 1.25 * 0.85
  // high defense target: 2.5% per point
  const cs3 = battle([['angel', 1]], [['pikeman', 5]], { siege });
  assert.equal(cs3.startEvents.find((e) => e.type === 'tower_shot').damage, 33); // 45 * 0.75
  // target: the most valuable expected damage, creatures before machines
  const cs4 = battle([['pikeman', 10], ['angel', 1]], [['pikeman', 5]], { siege, machinesA: ['ballista'] });
  assert.equal(towerTarget(cs4, cs4.siege.towers[0]).creatureId, 'angel');
  for (const s of cs4.stacks) if (s.side === 'attacker' && !s.warMachine) { s.alive = false; s.count = 0; }
  assert.ok(towerTarget(cs4, cs4.siege.towers[0]).warMachine);
  // no towers at fort level
  const fort = battle([['pikeman', 10]], [['pikeman', 5]], { siege: SIEGE(1) });
  assert.ok(!has(fort.startEvents, 'tower_shot'));
});

test('catapult without Ballistics: random target, 50% wall hit, 0/1/2 damage table (forced rolls)', () => {
  const cs = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(1), chance: { catapult_hit: true } });
  const cat = machine(cs, 'attacker', 'catapult');
  assert.equal(getStackInfo(cs, cat.id).machineControl, 'auto');
  const events = [];
  cs.forceRolls = [0.0, 0.95]; // target 0 = wall_upper, damage roll 95 -> 2
  catapultAct(cs, cat, events);
  assert.deepEqual(events.map((e) => e.type), ['catapult_shot', 'wall_damaged', 'wall_destroyed']);
  assert.equal(events[0].targetId, 'wall_upper');
  assert.equal(events[0].damage, 2);
  assert.equal(cs.siege.walls[0].hp, 0);
  const e2 = [];
  cs.forceRolls = [0.0, 0.05]; // next intact: wall_upper_mid, damage roll 5 -> 0
  catapultAct(cs, cat, e2);
  assert.deepEqual(e2.map((e) => [e.type, e.targetId, e.hit, e.damage]), [['catapult_shot', 'wall_upper_mid', true, 0]]);
  cs.force.chance.catapult_hit = false;
  const e3 = [];
  cs.forceRolls = [0.5];
  catapultAct(cs, cat, e3);
  assert.deepEqual(e3.map((e) => [e.type, e.hit, e.damage]), [['catapult_shot', false, 0]]);
  assert.deepEqual(getSiegeTargets(cs, cat).map((t) => t.hitChance), [50, 50, 50, 25]);
});

test('catapult with Ballistics: human control via siege_attack, shots and tables per level', () => {
  for (const level of [1, 2, 3]) {
    const cs = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(3), chance: { catapult_hit: true },
      heroA: hero({ bonuses: [ballistics(level)] }) });
    const cat = machine(cs, 'attacker', 'catapult');
    assert.equal(getStackInfo(cs, cat.id).machineControl, 'player');
    activate(cs, cat);
    const legal = getLegalActions(cs);
    const gate = legal.siegeTargets.find((t) => t.targetId === 'gate');
    assert.equal(gate.hitChance, BALLISTICS[level].hitChance.gate);
    assert.equal(legal.siegeTargets.find((t) => t.targetId === 'keep').hitChance, BALLISTICS[level].hitChance.keep);
    assert.equal(legal.siegeTargets.find((t) => t.targetId === 'tower_upper').hitChance, BALLISTICS[level].hitChance.tower);
    cs.forceRolls = [0.2, 0.7]; // 1 then 2 damage (ignored at Expert: always 2)
    const ev = act(cs, { type: 'siege_attack', targetId: 'gate' });
    const shotsFired = ev.filter((e) => e.type === 'catapult_shot');
    assert.equal(shotsFired.length, BALLISTICS[level].shots, `level ${level}`);
    assert.equal(shotsFired[0].targetId, 'gate');
    if (level === 1) assert.equal(cs.siege.gate.hp, 1);
    if (level === 2) { assert.equal(cs.siege.gate.hp, 0); assert.ok(has(ev, 'wall_destroyed', (e) => e.targetId === 'gate')); }
    if (level === 3) {
      assert.equal(cs.siege.gate.hp, 0);
      assert.notEqual(shotsFired[1].targetId, 'gate'); // the gate fell: the second shot is re-aimed
    }
  }
  // AI side with Ballistics: automatic but aimed
  const ai = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(1), heroA: hero({ bonuses: [ballistics(3)] }), sideA: { isHuman: false }, chance: { catapult_hit: true } });
  const cat = machine(ai, 'attacker', 'catapult');
  assert.equal(getStackInfo(ai, cat.id).machineControl, 'auto');
  const events = [];
  catapultAct(ai, cat, events);
  assert.equal(events.filter((e) => e.type === 'catapult_shot').length, 2);
  assert.equal(events[0].targetId, 'gate'); // aimed: a walking army wants the gate
  // bad target / defender side
  const cs = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(1), heroA: hero({ bonuses: [ballistics(1)] }) });
  activate(cs, machine(cs, 'attacker', 'catapult'));
  assert.equal(performAction(cs, { type: 'siege_attack', targetId: 'keep' }).error, 'bad_target');
  assert.deepEqual(getSiegeTargets(cs, D(cs)), []);
});

test('Cyclops / Cyclops King / Cannon attack the walls (siege_attack), 1 ammo per action', () => {
  const cs = battle([['cyclops', 5]], [['pikeman', 5]], { siege: SIEGE(1), chance: { catapult_hit: true } });
  const c = place(A(cs), 3, 5);
  activate(cs, c);
  const targets = getLegalActions(cs).siegeTargets;
  assert.equal(targets.find((t) => t.targetId === 'wall_upper').hitChance, 60); // Basic table
  cs.forceRolls = [0.9];
  const ev = act(cs, { type: 'siege_attack', targetId: 'wall_upper' });
  assert.ok(has(ev, 'ability', (e) => e.ability === 'siege_attack'));
  assert.deepEqual(ev.filter((e) => e.type === 'catapult_shot').map((e) => [e.source, e.damage]), [['siege_attack', 2]]);
  assert.equal(cs.siege.walls[0].hp, 0);
  assert.equal(c.shots, 15);
  // King: two shots (Advanced); Ammo Cart keeps the ammo
  const k = battle([['cyclops_king', 5]], [['pikeman', 5]], { siege: SIEGE(1), chance: { catapult_hit: true }, machinesA: ['ammo_cart'] });
  const ck = place(A(k), 3, 5);
  activate(k, ck);
  k.forceRolls = [0.1, 0.1];
  const evk = act(k, { type: 'siege_attack', targetId: 'gate' });
  assert.equal(evk.filter((e) => e.type === 'catapult_shot').length, 2);
  assert.equal(k.siege.gate.hp, 0);
  assert.equal(ck.shots, 24);
  // no ammo / adjacent enemy / defender side: no wall targets
  const n = battle([['cyclops', 5]], [['cyclops', 5]], { siege: SIEGE(1) });
  const nc = place(A(n), 3, 5);
  nc.shots = 0;
  assert.deepEqual(getSiegeTargets(n, nc), []);
  nc.shots = 5;
  place(D(n), 4, 5);
  assert.deepEqual(getSiegeTargets(n, nc), []);
  assert.deepEqual(getSiegeTargets(n, D(n)), []);
  // Cannon (attacker war machine) may target walls too
  const cn = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(1), machinesA: ['cannon'] });
  assert.ok(getSiegeTargets(cn, machine(cn, 'attacker', 'cannon')).length > 0);
  // a plain shooter cannot
  const ar = battle([['archer', 5]], [['pikeman', 5]], { siege: SIEGE(1) });
  assert.deepEqual(getSiegeTargets(ar, A(ar)), []);
});

test('Earthquake helper damages random intact structures', () => {
  const cs = battle([['pikeman', 5]], [['pikeman', 5]], { siege: SIEGE(3) });
  const before = getSiegeStructures(cs).reduce((a, t) => a + t.hp, 0);
  const ev = earthquake(cs, 4, 1);
  assert.equal(ev.filter((e) => e.type === 'wall_damaged').length, 4);
  assert.ok(ev.every((e) => e.source === 'earthquake'));
  assert.equal(getSiegeStructures(cs).reduce((a, t) => a + t.hp, 0), before - 4);
  const plain = battle([['pikeman', 5]], [['pikeman', 5]], {});
  assert.deepEqual(earthquake(plain, 3, 1), []);
  assert.deepEqual(damageWall(plain, 'gate', 1), []);
});

test('shooting over intact walls halves damage; rubble, defenders and no_obstacle_penalty ignore it', () => {
  const run = (shooter, opts = {}) => {
    const cs = battle([[shooter, 10]], [['pikeman', 99]], { siege: SIEGE(1), heroA: opts.heroA });
    place(A(cs), opts.ax ?? 4, opts.ay ?? 5);
    place(D(cs), opts.dx ?? 13, opts.dy ?? 5);
    if (opts.destroy) for (const id of opts.destroy) damageWall(cs, id, 9);
    return firstDamage(shoot(cs, A(cs), D(cs)), D(cs));
  };
  assert.equal(run('archer'), 15); // 30 * 1.05 * 0.5
  assert.equal(run('archer', { destroy: ['gate'] }), 31);
  assert.equal(run('archer', { ay: 1, dy: 1 }), 15);
  assert.equal(run('archer', { ay: 1, dy: 1, destroy: ['wall_upper'] }), 31);
  assert.equal(run('archer', { ax: 4, ay: 3, dx: 13, dy: 3 }), 15); // permanent wall part
  assert.equal(run('archer', { heroA: hero({ bonuses: [{ type: 'no_obstacle_penalty' }] }) }), 31);
  assert.ok(run('mage') > 0);
  const cs = battle([['archer', 10]], [['archer', 10]], { siege: SIEGE(1) });
  place(A(cs), 4, 5);
  place(D(cs), 13, 5);
  assert.equal(siegeShotPenalty(cs, A(cs), D(cs)), true);
  assert.equal(siegeShotPenalty(cs, D(cs), A(cs)), false, 'defenders shoot out freely');
  place(A(cs), 12, 3);
  assert.equal(siegeShotPenalty(cs, A(cs), D(cs)), false, 'attacker inside the walls');
  // mage: its own no_obstacle_penalty
  const m = battle([['mage', 10]], [['pikeman', 99]], { siege: SIEGE(1) });
  place(A(m), 4, 5);
  place(D(m), 13, 5);
  const withWall = firstDamage(shoot(m, A(m), D(m)), D(m));
  const m2 = battle([['mage', 10]], [['pikeman', 99]], { siege: SIEGE(1) });
  place(A(m2), 4, 5);
  place(D(m2), 13, 5);
  damageWall(m2, 'gate', 9);
  assert.equal(firstDamage(shoot(m2, A(m2), D(m2)), D(m2)), withWall);
});

test('AI helpers: wall targets with values, isBehindWalls, wallPathCost, teleport rule', () => {
  const cs = battle([['pikeman', 50], ['royal_griffin', 1]], [['pikeman', 5]], { siege: SIEGE(3) });
  const cat = machine(cs, 'attacker', 'catapult');
  const t = getSiegeTargets(cs, cat);
  assert.equal(t.length, 8);
  assert.ok(t.every((x) => Number.isFinite(x.value) && x.value >= 0));
  assert.equal(chooseSiegeTarget(cs, cat), 'gate'); // a walking army wants the gate
  const a = place(A(cs, 0), 2, 5);
  assert.equal(wallPathCost(cs, a, { x: 13, y: 5 }), Infinity);
  damageWall(cs, 'gate', 9);
  assert.equal(wallPathCost(cs, a, { x: 13, y: 5 }), 11);
  damageWall(cs, 'wall_upper_mid', 9);
  assert.equal(wallPathCost(cs, a, { x: 11, y: 4 }) >= 9, true);
  const flyer = place(A(cs, 1), 2, 3);
  assert.equal(wallPathCost(cs, flyer, { x: 13, y: 3 }), 11); // flyers: plain distance
  // teleport rule
  const g = A(cs, 1);
  place(g, 3, 3);
  assert.equal(siegeTeleportAllowed(cs, g, { x: 13, y: 3 }, { crossMoat: true, crossWalls: false }), false);
  assert.equal(siegeTeleportAllowed(cs, g, { x: 13, y: 3 }, { crossMoat: true, crossWalls: true }), true);
  assert.equal(siegeTeleportAllowed(cs, g, { x: 9, y: 3 }, { crossMoat: false, crossWalls: false }), false);
  assert.equal(siegeTeleportAllowed(cs, g, { x: 9, y: 3 }, { crossMoat: true, crossWalls: false }), true);
  assert.equal(siegeTeleportAllowed(cs, g, { x: 6, y: 8 }, {}), true);
});

test('retreat: siege defender only with an escape tunnel, attacker always', () => {
  const cs = battle([['pikeman', 10]], [['pikeman', 5]], { heroA: hero(), heroD: hero(), siege: SIEGE(1) });
  activate(cs, D(cs));
  assert.equal(getLegalActions(cs).canRetreat, false);
  activate(cs, A(cs));
  assert.equal(getLegalActions(cs).canRetreat, true);
  const tunnel = battle([['pikeman', 10]], [['pikeman', 5]], { heroA: hero(), heroD: hero(), siege: SIEGE(3, 'castle', { escapeTunnel: true }) });
  activate(tunnel, D(tunnel));
  assert.equal(getLegalActions(tunnel).canRetreat, true);
});
