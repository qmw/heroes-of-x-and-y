// Every component of the attack damage formula with hand-computed expectations.
// Default test setup: empty field, no native terrain, damage rolls forced to the maximum,
// luck / morale rolls off. Pikeman 4/5 1-3, Crusader 12/12 7-10, Archer 6/3 2-3, Swordsman 10/12 6-9.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAttackPreview, addStatus } from '../../src/engine/combat/index.js';
import { battle, hero, A, D, place, melee, shoot, firstDamage, has, effectIds } from './helpers.js';

const meleeDmg = (att, def, opts = {}, prep = () => {}) => {
  const cs = battle(att, def, opts);
  prep(cs);
  return firstDamage(melee(cs, A(cs), D(cs)), D(cs));
};
const shotDmg = (att, def, opts = {}, x = 8, prep = () => {}) => {
  const cs = battle(att, def, opts);
  place(D(cs), x, 5);
  prep(cs);
  return firstDamage(shoot(cs, A(cs), D(cs)), D(cs));
};
const status = (who, spellId, mastery) => (cs) => addStatus(cs, who(cs), spellId, { mastery, casterSide: 'attacker', rounds: 5 });

test('defense above attack: -2.5% per point', () => {
  assert.equal(meleeDmg([['pikeman', 10]], [['pikeman', 99]]), 29); // 30 * 0.975 = 29.25
  assert.equal(meleeDmg([['pikeman', 10]], [['pikeman', 99]], { damage: 'min' }), 9); // 10 * 0.975
  assert.equal(meleeDmg([['swordsman', 10]], [['crusader', 99]]), 85); // 90 * 0.95 = 85.5
});

test('attack above defense: +5% per point', () => {
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]]), 135); // 100 * 1.35
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], { damage: 'min' }), 94); // 70 * 1.35 = 94.5
  assert.equal(meleeDmg([['crusader', 1]], [['pikeman', 99]], { heroA: hero({ attack: 3 }) }), 15); // 10 * 1.5
});

test('caps: +300% and -70%', () => {
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 999]], { heroA: hero({ attack: 100 }) }), 400);
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 999]], { heroA: hero({ attack: 48 }) }), 375); // 55 points: +275%
  assert.equal(meleeDmg([['pikeman', 10]], [['imp', 99]], { heroD: hero({ defense: 60 }) }), 9); // 30 * 0.3
  assert.equal(meleeDmg([['pikeman', 10]], [['imp', 99]], { heroD: hero({ defense: 21 }) }), 15); // 20 points: 30 * 0.5
});

test('minimum damage is 1', () => {
  assert.equal(meleeDmg([['peasant', 1]], [['crusader', 9]]), 1);
});

test('base roll: up to 10 creatures roll individually', () => {
  const cs = battle([['pikeman', 5]], [['peasant', 999]], { damage: null, forceRolls: [0, 0.34, 0.67, 0.99, 0.5, 0.123] });
  // rolls 1,2,3,3,2 = 11; attack 4 vs defense 1: +15% -> 12.65
  assert.equal(firstDamage(melee(cs, A(cs), D(cs)), D(cs)), 12);
  assert.deepEqual(cs.forceRolls, [0.123], 'exactly five dice were rolled');
});

test('base roll: more than 10 creatures roll ten dice and scale by count / 10', () => {
  const cs = battle([['pikeman', 25]], [['peasant', 999]], { damage: null, forceRolls: [...Array(10).fill(0.5), 0.123] });
  // ten 2s = 20 -> floor(20 * 25 / 10) = 50 -> * 1.15 = 57.5
  assert.equal(firstDamage(melee(cs, A(cs), D(cs)), D(cs)), 57);
  assert.deepEqual(cs.forceRolls, [0.123]);
  const cs2 = battle([['pikeman', 13]], [['peasant', 999]], { damage: null, forceRolls: [0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99] });
  // 5 * 1 + 5 * 3 = 20 -> floor(20 * 13 / 10) = 26 -> * 1.15 = 29.9
  assert.equal(firstDamage(melee(cs2, A(cs2), D(cs2)), D(cs2)), 29);
});

test('Offense and Archery add to the attack bonus', () => {
  const offense = hero({ bonuses: [{ type: 'damage_percent', mode: 'melee', percent: 30 }] });
  const archery = hero({ bonuses: [{ type: 'damage_percent', mode: 'ranged', percent: 50 }] });
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], { heroA: offense }), 165); // 100 * (1 + .35 + .30)
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], { heroA: archery }), 135);
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]]), 31); // 30 * 1.05 = 31.5
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], { heroA: archery }), 46); // 30 * 1.55 = 46.5
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], { heroA: offense }), 31);
  const both = hero({ bonuses: [{ type: 'damage_percent', mode: 'ranged', percent: 50 }, { type: 'damage_percent', mode: 'ranged', percent: 15 }] });
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], { heroA: both }), 51); // 30 * 1.70
});

test('Armorer reduces multiplicatively', () => {
  const armorer = hero({ bonuses: [{ type: 'damage_reduction_percent', percent: 15 }] });
  const offense = hero({ bonuses: [{ type: 'damage_percent', mode: 'melee', percent: 30 }] });
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], { heroD: armorer }), 114); // 135 * 0.85 = 114.75
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], { heroA: offense, heroD: armorer }), 140); // 165 * 0.85 = 140.25
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], { heroD: armorer }), 26); // 31.5 * 0.85 = 26.775
});

test('range penalty: half damage beyond 10 hexes unless negated', () => {
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], {}, 10), 31);
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], {}, 11), 15); // 31.5 / 2
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], {}, 14), 15);
  assert.equal(shotDmg([['sharpshooter', 10]], [['pikeman', 99]], {}, 14), 135); // no_range_penalty
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], { heroA: hero({ bonuses: [{ type: 'no_range_penalty' }] }) }, 14), 31);
});

test('melee penalty: shooters deal half damage hand to hand unless no_melee_penalty', () => {
  assert.equal(meleeDmg([['archer', 10]], [['pikeman', 99]]), 15); // 30 * 1.05 * 0.5
  assert.equal(meleeDmg([['archer', 10]], [['pikeman', 99]], {}, (cs) => { A(cs).shots = 0; }), 15);
  assert.equal(meleeDmg([['zealot', 10]], [['pikeman', 99]]), 162); // 120 * 1.35
});

test('Shield and Air Shield', () => {
  const onD = (spellId, m) => status(D, spellId, m);
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, onD('shield', 2)), 94); // 135 * 0.7
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, onD('shield', 1)), 114); // 135 * 0.85
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, onD('air_shield', 2)), 135);
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], {}, 8, onD('air_shield', 2)), 15); // 31.5 * 0.5
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], {}, 8, onD('air_shield', 1)), 23); // 31.5 * 0.75
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], {}, 8, onD('shield', 2)), 31);
});

test('all reductions multiply, bonuses add (documented order)', () => {
  const armorer = hero({ bonuses: [{ type: 'damage_reduction_percent', percent: 15 }] });
  const offense = hero({ bonuses: [{ type: 'damage_percent', mode: 'melee', percent: 30 }] });
  // 100 * (1 + 0.35 + 0.30) * 0.85 * 0.70 = 98.175
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], { heroA: offense, heroD: armorer }, status(D, 'shield', 2)), 98);
  // archers: 30 * 1.05 * 0.85 * 0.5 (air shield) * 0.5 (range) = 6.69
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], { heroD: armorer }, 14, status(D, 'air_shield', 2)), 6);
  // lucky strike is one more additive +100%: 100 * (1 + .35 + .30 + 1) * 0.85 = 225.25
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], { heroA: offense, heroD: armorer, sideA: { luck: 1 }, chance: { luck: true } }), 225);
});

test('Bless (max, +3 % at advanced) and Curse (min, -20 % at advanced, at least 1)', () => {
  assert.equal(meleeDmg([['pikeman', 10]], [['pikeman', 99]], { damage: 'min' }, status(A, 'bless', 1)), 29);
  assert.equal(meleeDmg([['pikeman', 10]], [['pikeman', 99]], { damage: 'min' }, status(A, 'bless', 2)), 29); // floor(3 * 10 * 1.03) = 30, * 0.975
  assert.equal(meleeDmg([['pikeman', 10]], [['pikeman', 99]], {}, status(A, 'curse', 1)), 9);
  assert.equal(meleeDmg([['pikeman', 10]], [['pikeman', 99]], {}, status(A, 'curse', 2)), 7); // floor(1 * 10 * 0.8) = 8, * 0.975
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, status(A, 'curse', 2)), 75); // floor(7 * 10 * 0.8) = 56, * 1.35
  const cs = battle([['pikeman', 10]], [['pikeman', 99]]);
  status(A, 'bless', 1)(cs);
  status(A, 'curse', 1)(cs);
  assert.deepEqual(effectIds(A(cs)), ['curse'], 'opposites cancel');
});

test('attack and defense spell modifiers', () => {
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, status(A, 'bloodlust', 2)), 165); // 18 vs 5
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], {}, 8, status(A, 'bloodlust', 2)), 31); // melee only
  assert.equal(shotDmg([['archer', 10]], [['pikeman', 99]], {}, 8, status(A, 'precision', 2)), 40); // 12 vs 5: 30 * 1.35
  assert.equal(meleeDmg([['archer', 10]], [['pikeman', 99]], {}, status(A, 'precision', 2)), 15); // ranged only
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, status(A, 'weakness', 2)), 105); // 6 vs 5
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, status(D, 'stone_skin', 2)), 105); // 12 vs 11
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, status(A, 'prayer', 2)), 155); // 16 vs 5
  // Disrupting Ray stacks and never pushes defense below 0: 5 - 4 - 4 -> 0, so +60%
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, (cs) => { status(D, 'disrupting_ray', 2)(cs); status(D, 'disrupting_ray', 2)(cs); }), 160);
  // attack never drops below 0: pikeman 4 - 6 -> 0 vs defense 5: -12.5%
  assert.equal(meleeDmg([['pikeman', 10]], [['pikeman', 99]], {}, status(A, 'weakness', 2)), 26); // 30 * 0.875 = 26.25
});

test('Frenzy converts defense into attack; Slayer adds +8 against its targets', () => {
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, status(A, 'frenzy', 1)), 195); // 12 + 12 = 24 vs 5
  assert.equal(meleeDmg([['crusader', 10]], [['pikeman', 99]], {}, status(A, 'frenzy', 3)), 255); // 12 + 24 = 36 vs 5
  assert.equal(meleeDmg([['pikeman', 10]], [['crusader', 99]], {}, status(D, 'frenzy', 1)), 36); // defense 0: 30 * 1.2
  assert.equal(meleeDmg([['crusader', 10]], [['green_dragon', 9]]), 85); // 12 vs 18
  assert.equal(meleeDmg([['crusader', 10]], [['green_dragon', 9]], {}, status(A, 'slayer', 1)), 110); // 20 vs 18
  assert.equal(meleeDmg([['crusader', 10]], [['angel', 9]], {}, status(A, 'slayer', 1)), 80); // basic: no angels
  assert.equal(meleeDmg([['crusader', 10]], [['angel', 9]], {}, status(A, 'slayer', 2)), 100);
  assert.equal(meleeDmg([['crusader', 10]], [['titan', 9]], {}, status(A, 'slayer', 2)), 70); // 12 vs 24
  assert.equal(meleeDmg([['crusader', 10]], [['titan', 9]], {}, status(A, 'slayer', 3)), 90); // 20 vs 24
});

test('kills and the hit points of the top creature', () => {
  const cs = battle([['crusader', 10]], [['pikeman', 99]]);
  const events = melee(cs, A(cs), D(cs));
  const dmg = events.find((e) => e.type === 'damage' && e.stackId === D(cs).id);
  assert.deepEqual([dmg.amount, dmg.dealt, dmg.killed, dmg.remaining, dmg.kind], [135, 135, 13, 86, 'melee']);
  // 86 pikemen retaliate: 258 * 0.8 = 206 -> 5 crusaders die (35 hp each), the top one keeps 4 hp
  const back = events.find((e) => e.type === 'damage' && e.stackId === A(cs).id);
  assert.deepEqual([back.amount, back.killed, back.remaining], [206, 5, 5]);
  assert.equal(A(cs).hp, 4);
  // the five survivors strike again: 50 * 1.35 = 67.5
  const second = events.filter((e) => e.type === 'damage' && e.stackId === D(cs).id)[1];
  assert.deepEqual([second.amount, second.killed, second.remaining], [67, 7, 79]);
  assert.equal(D(cs).count, 79);
  assert.equal(D(cs).hp, 8); // 855 - 67 = 788
});

test('overkill is capped at the hit points left and kills the stack', () => {
  const cs = battle([['crusader', 10], ['pikeman', 1]], [['pikeman', 3], ['pikeman', 1]]);
  const events = melee(cs, A(cs), D(cs));
  const dmg = events.find((e) => e.type === 'damage');
  assert.deepEqual([dmg.amount, dmg.dealt, dmg.killed, dmg.remaining], [135, 30, 3, 0]);
  assert.ok(has(events, 'death', (e) => e.stackId === D(cs).id));
  assert.equal(D(cs).alive, false);
  assert.ok(!has(events, 'retaliate'));
});

test('blinded stacks retaliate at reduced strength and wake up; petrified ones take half and never answer', () => {
  const run = (spellId, mastery) => {
    const cs = battle([['pikeman', 100]], [['pikeman', 60]]);
    addStatus(cs, D(cs), spellId, { mastery, casterSide: 'attacker', rounds: 3 });
    const events = melee(cs, A(cs), D(cs));
    return { cs, events, hit: firstDamage(events, D(cs)), back: firstDamage(events, A(cs)) };
  };
  // 300 * 0.975 = 292 -> 31 pikemen left -> 93 * 0.975 = 90.675
  assert.equal(run('bless', 1).back, 90);
  const basic = run('blind', 1);
  assert.equal(basic.hit, 292);
  assert.equal(basic.back, 45); // 90.675 * 0.5
  assert.deepEqual(effectIds(D(basic.cs)), []);
  assert.ok(has(basic.events, 'status_removed', (e) => e.spellId === 'blind' && e.reason === 'damaged'));
  assert.equal(run('blind', 2).back, 22); // 25%
  assert.equal(run('blind', 3).back, undefined); // expert: no retaliation
  const stone = run('petrify', 0);
  assert.equal(stone.hit, 146); // 292.5 / 2
  assert.equal(stone.back, undefined);
  assert.deepEqual(effectIds(D(stone.cs)), []);
  assert.equal(run('paralyze', 0).back, 22);
});

test('getAttackPreview: damage and kill range without luck', () => {
  const cs = battle([['crusader', 10], ['archer', 10]], [['pikeman', 99]]);
  assert.deepEqual(getAttackPreview(cs, A(cs, 0).id, D(cs).id), { minDamage: 94, maxDamage: 135, minKills: 9, maxKills: 13, ranged: false });
  // archers: ranged by default, with the range penalty (14 hexes): 20..30 * 1.05 / 2
  assert.deepEqual(getAttackPreview(cs, A(cs, 1).id, D(cs).id), { minDamage: 10, maxDamage: 15, minKills: 1, maxKills: 1, ranged: true });
  assert.deepEqual(getAttackPreview(cs, A(cs, 1).id, D(cs).id, { ranged: false }), { minDamage: 10, maxDamage: 15, minKills: 1, maxKills: 1, ranged: false });
  place(D(cs), 5, 8);
  assert.equal(getAttackPreview(cs, A(cs, 1).id, D(cs).id).maxDamage, 31);
  assert.equal(getAttackPreview(cs, 999, D(cs).id), null);
  const before = JSON.stringify(cs);
  getAttackPreview(cs, A(cs, 0).id, D(cs).id);
  assert.equal(JSON.stringify(cs), before, 'preview does not touch the state or the rng');
});
