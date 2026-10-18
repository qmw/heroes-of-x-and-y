import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombat } from '../../src/engine/combat/index.js';
import { armyBaseMorale } from '../../src/engine/combat/state.js';
import { stackHexes, hexIndex } from '../../src/engine/combat/hex.js';
import { battle, hero, A, D, machine } from './helpers.js';

const seven = ['pikeman', 'archer', 'griffin', 'swordsman', 'monk', 'cavalier', 'angel'].map((id) => [id, 5]);

test('formation rows by number of stacks (original loose formation)', () => {
  const rows = { 1: [5], 2: [2, 8], 3: [2, 5, 8], 4: [0, 4, 6, 10], 5: [0, 2, 5, 8, 10], 6: [0, 2, 4, 6, 8, 10], 7: [0, 2, 4, 5, 6, 8, 10] };
  for (let n = 1; n <= 7; n++) {
    const cs = battle(seven.slice(0, n).map(() => ['pikeman', 3]), seven.slice(0, n).map(() => ['imp', 3]));
    assert.deepEqual(cs.stacks.filter((s) => s.side === 'attacker').map((s) => s.pos.y), rows[n]);
    assert.deepEqual(cs.stacks.filter((s) => s.side === 'defender').map((s) => s.pos.y), rows[n]);
    assert.ok(cs.stacks.filter((s) => s.side === 'attacker').every((s) => s.pos.x === 0));
    assert.ok(cs.stacks.filter((s) => s.side === 'defender').every((s) => s.pos.x === 14));
  }
});

test('army slots are preserved and empty slots skipped', () => {
  const cs = battle([null, ['pikeman', 10], null, ['archer', 5]], [['imp', 1]]);
  assert.deepEqual(cs.stacks.filter((s) => s.side === 'attacker').map((s) => [s.slot, s.creatureId, s.count, s.pos.y]),
    [[1, 'pikeman', 10, 2], [3, 'archer', 5, 8]]);
});

test('two-hex creatures stand with both hexes on the field, facing the enemy', () => {
  const cs = battle([['griffin', 3]], [['griffin', 3]]);
  assert.deepEqual(stackHexes(A(cs)), [{ x: 1, y: 5 }, { x: 0, y: 5 }]);
  assert.deepEqual(stackHexes(D(cs)), [{ x: 13, y: 5 }, { x: 14, y: 5 }]);
});

test('war machines take their fixed rows; no catapult outside a siege', () => {
  const cs = battle(seven, seven, { machinesA: ['ballista', 'ammo_cart', 'first_aid_tent', 'catapult'], machinesD: ['ballista'] });
  assert.deepEqual(machine(cs, 'attacker', 'ammo_cart').pos, { x: 1, y: 1 });
  assert.deepEqual(machine(cs, 'attacker', 'ballista').pos, { x: 1, y: 3 });
  assert.deepEqual(machine(cs, 'attacker', 'first_aid_tent').pos, { x: 1, y: 9 });
  assert.deepEqual(machine(cs, 'defender', 'ballista').pos, { x: 13, y: 3 });
  assert.equal(machine(cs, 'attacker', 'catapult'), undefined);
  // nothing overlaps
  const seen = new Set();
  for (const s of cs.stacks) for (const h of stackHexes(s)) { assert.ok(!seen.has(hexIndex(h))); seen.add(hexIndex(h)); }
});

test('the attacker gets a catapult in a siege; cs.siege keeps the description', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]], { siege: { fortLevel: 2, faction: 'castle', buildings: ['fort', 'citadel'] } });
  assert.deepEqual(machine(cs, 'attacker', 'catapult').pos, { x: 1, y: 7 });
  assert.equal(machine(cs, 'defender', 'catapult'), undefined);
  assert.equal(cs.siege.fortLevel, 2);
  assert.equal(cs.siege.faction, 'castle');
  assert.deepEqual(cs.obstacles, []);
});

test('random obstacles are seeded, stay in the middle and never under a stack', () => {
  const mk = (seed) => createCombat({ seed, terrain: 'grass', attacker: { army: [{ creatureId: 'pikeman', count: 5 }] }, defender: { army: [{ creatureId: 'imp', count: 5 }] } });
  let total = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const a = mk(seed);
    assert.deepEqual(a.obstacles, mk(seed).obstacles);
    const seen = new Set();
    for (const o of a.obstacles) {
      assert.ok(['tree', 'stump', 'boulder', 'shrub', 'log'].includes(o.kind), o.kind);
      for (const h of o.hexes) {
        assert.ok(h.x >= 2 && h.x <= 12 && h.y >= 0 && h.y <= 10);
        assert.ok(!seen.has(hexIndex(h)));
        seen.add(hexIndex(h));
      }
    }
    total += a.obstacles.length;
  }
  assert.ok(total > 40);
  assert.notDeepEqual(mk(1).obstacles, mk(2).obstacles);
});

test('explicit obstacle list and "none"', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]], { obstacles: [{ kind: 'boulder', hexes: [{ x: 7, y: 5 }] }] });
  assert.equal(cs.obstacles.length, 1);
  assert.equal(cs.obstacles[0].blocks, true);
  assert.equal(battle([['pikeman', 5]], [['imp', 5]], { obstacles: 'none' }).obstacles.length, 0);
});

test('creature bank layout: attacker in the middle, defenders around, no obstacles', () => {
  const cs = battle(seven, seven.map(() => ['imp', 4]), { bank: true, obstacles: 'random', machinesA: ['ballista'] });
  assert.equal(cs.obstacles.length, 0);
  assert.equal(cs.stacks.filter((s) => s.warMachine).length, 0);
  assert.ok(cs.stacks.filter((s) => s.side === 'attacker').every((s) => s.pos.x >= 4 && s.pos.x <= 10 && s.pos.y >= 3 && s.pos.y <= 7));
  assert.deepEqual(cs.stacks.filter((s) => s.side === 'defender').map((s) => [s.pos.x, s.pos.y]),
    [[14, 0], [14, 10], [1, 10], [1, 0], [14, 5], [1, 5], [7, 0]]);
  const seen = new Set();
  for (const s of cs.stacks) for (const h of stackHexes(s)) { assert.ok(!seen.has(hexIndex(h))); seen.add(hexIndex(h)); }
});

test('hero attack and defense are added to the stacks', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]], { heroA: hero({ attack: 5, defense: 3 }) });
  assert.equal(A(cs).attack, 9);
  assert.equal(A(cs).defense, 8);
  assert.equal(D(cs).attack, 2);
});

test('creature_stat bonuses: filters, flat and percent, except tags', () => {
  const bonuses = [
    { type: 'creature_stat', stat: 'speed', value: 2, filter: { tier: 1 } },
    { type: 'creature_stat', stat: 'hp', value: 2 },
    { type: 'creature_stat', stat: 'hp', percent: 25, except: ['undead'] },
    { type: 'creature_stat', stat: 'damage', value: 1, filter: { creatureIds: ['archer'] } },
    { type: 'creature_stat', stat: 'attack', value: 3, filter: { shooter: true } },
    { type: 'creature_stat', stat: 'defense', value: 4, filter: { faction: 'necropolis' } },
  ];
  const cs = battle([['pikeman', 5], ['archer', 5], ['skeleton', 5]], [['imp', 5]], { heroA: hero({ bonuses }) });
  const [pike, archer, skel] = [A(cs, 0), A(cs, 1), A(cs, 2)];
  assert.equal(pike.speed, 6);
  assert.equal(archer.speed, 4);
  assert.equal(pike.maxHp, 15); // floor((10 + 2) * 1.25)
  assert.equal(pike.hp, 15);
  assert.equal(skel.maxHp, 8); // undead: no percent
  assert.deepEqual([archer.minDamage, archer.maxDamage], [3, 4]);
  assert.deepEqual([pike.minDamage, pike.maxDamage], [1, 3]);
  assert.equal(archer.attack, 9);
  assert.equal(pike.attack, 4);
  assert.equal(skel.defense, 8);
});

test('creature specialty: +ceil(base x 5% x floor(level / tier)) attack and defense', () => {
  const bonuses = [{ type: 'creature_specialty', creatures: ['pikeman', 'swordsman'], percentPerStep: 5, heroLevel: 10 }];
  const cs = battle([['pikeman', 5], ['swordsman', 5], ['archer', 5]], [['imp', 5]], { heroA: hero({ bonuses }) });
  assert.equal(A(cs, 0).attack, 4 + 2); // ceil(4 * 0.05 * 10)
  assert.equal(A(cs, 0).defense, 5 + 3); // ceil(2.5)
  assert.equal(A(cs, 1).attack, 10 + 1); // tier 4: 2 steps -> ceil(10 * 0.1)
  assert.equal(A(cs, 1).defense, 12 + 2); // ceil(1.2)
  assert.equal(A(cs, 2).attack, 6);
  const machineBonus = [{ type: 'creature_specialty', creatures: ['ballista'], percentPerStep: 5, heroLevel: 10, tier: 5 }];
  const cs2 = battle([['pikeman', 5]], [['imp', 5]], { heroA: hero({ bonuses: machineBonus, attack: 7 }), machinesA: ['ballista'] });
  assert.equal(machine(cs2, 'attacker', 'ballista').attack, 10 + 1 + 7); // ceil(10 * 0.05 * 2) + hero attack
});

test('native terrain gives +1 attack, defense and speed', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]], { terrain: 'grass' });
  assert.deepEqual([A(cs).attack, A(cs).defense, A(cs).speed], [5, 6, 5]);
  assert.deepEqual([D(cs).attack, D(cs).defense, D(cs).speed], [2, 3, 5]);
  const lava = battle([['pikeman', 5]], [['imp', 5]], { terrain: 'lava' });
  assert.deepEqual([D(lava).attack, D(lava).defense, D(lava).speed], [3, 4, 6]);
});

test('base army morale: one faction +1, each extra faction -1, undead -1', () => {
  const m = (ids, bonuses) => armyBaseMorale(ids.map((id) => ({ creatureId: id, count: 1 })), bonuses);
  assert.equal(m(['pikeman', 'archer']), 1);
  assert.equal(m(['pikeman', 'centaur']), 0);
  assert.equal(m(['pikeman', 'centaur', 'gremlin']), -1);
  assert.equal(m(['pikeman', 'centaur', 'gremlin', 'imp', 'goblin']), -3);
  assert.equal(m(['skeleton', 'zombie']), 0); // one faction, but undead
  assert.equal(m(['pikeman', 'skeleton']), -1);
  assert.equal(m(['pikeman', 'centaur', 'gremlin'], [{ type: 'no_alignment_penalty', factions: ['castle', 'rampart', 'tower'] }]), 1);
  const cs = battle([['pikeman', 5], ['centaur', 5]], [['imp', 5]], { heroA: hero({ bonuses: [{ type: 'morale', value: 2 }, { type: 'luck', value: 1 }] }) });
  assert.equal(cs.sides.attacker.morale, 2);
  assert.equal(cs.sides.attacker.luck, 1);
  const pre = battle([['pikeman', 5]], [['imp', 5]], { sideA: { morale: -2, luck: 3 } });
  assert.equal(pre.sides.attacker.morale, -2);
  assert.equal(pre.sides.attacker.luck, 3);
});

test('the state is plain JSON right after creation', () => {
  const cs = battle(seven, seven, { heroA: hero({ attack: 2 }), machinesA: ['ballista'] });
  assert.deepEqual(JSON.parse(JSON.stringify(cs)), cs);
  assert.equal(cs.phase, 'battle');
  assert.equal(cs.round, 1);
  assert.ok(cs.startEvents.some((e) => e.type === 'round_start' && e.round === 1));
});

test('the combat hero keeps defId / classId (UI portraits)', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]], { heroA: { id: 'h1', defId: 'christian', classId: 'knight', name: 'Christian', attack: 1, defense: 1, power: 1, knowledge: 1 } });
  assert.equal(cs.sides.attacker.hero.defId, 'christian');
  assert.equal(cs.sides.attacker.hero.classId, 'knight');
  assert.equal(cs.sides.defender.hero, null);
});

test('magic terrain overlay effects: Cracked Ice / Dunes stats for both sides, Cursed Ground nullifies morale and luck', async () => {
  const { moraleOf, luckOf } = await import('../../src/engine/combat/stats.js');
  const plain = battle([['pikeman', 5], ['griffin', 2]], [['imp', 5]]);
  const ice = battle([['pikeman', 5], ['griffin', 2]], [['imp', 5]], { overlayEffects: [{ type: 'creature_stat', stat: 'defense', value: -5, filter: { flying: false } }] });
  assert.equal(A(ice).defense, A(plain).defense - 5);
  assert.equal(A(ice, 1).defense, A(plain, 1).defense, 'flyers unaffected');
  assert.equal(D(ice).defense, D(plain).defense - 5, 'defender too');
  const dunes = battle([['pikeman', 5]], [['imp', 5]], { overlayEffects: [{ type: 'creature_stat', stat: 'speed', value: -1, filter: { flying: false } }] });
  assert.equal(D(dunes).speed, D(plain).speed - 1);
  const cursed = battle([['pikeman', 5]], [['imp', 5]], { sideA: { morale: 3, luck: 2 }, overlayEffects: [{ type: 'nullify_morale_luck' }] });
  assert.deepEqual([moraleOf(cursed, A(cursed)), luckOf(cursed, A(cursed))], [0, 0]);
});
