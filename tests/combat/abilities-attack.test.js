// Attack-pattern and attack-modifier abilities (creatures.md §3, §4.1-4.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLegalActions, performAction, getAttackPreview, addStatus } from '../../src/engine/combat/index.js';
import { battle, hero, A, D, place, activate, act, melee, shoot, firstDamage, damageTo, has } from './helpers.js';

const count = (events, type) => events.filter((e) => e.type === type).length;

test('retaliation counts: default 1 / extra_retaliations / unlimited_retaliations / no_enemy_retaliation / Counterstrike', () => {
  const retaliations = (defId, prep = () => {}) => {
    const cs = battle([['pikeman', 50], ['pikeman', 50], ['pikeman', 50]], [[defId, 50]]);
    const d = place(D(cs), 6, 5);
    prep(cs, d);
    const spots = [[5, 5], [6, 4], [6, 6]];
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const a = place(A(cs, i), ...spots[i]);
      activate(cs, a);
      n += count(act(cs, { type: 'attack', targetId: d.id, from: a.pos }), 'retaliate');
    }
    return n;
  };
  assert.equal(retaliations('pikeman'), 1);
  assert.equal(retaliations('griffin'), 2);
  assert.equal(retaliations('royal_griffin'), 3);
  assert.equal(retaliations('pikeman', (cs, d) => addStatus(cs, d, 'counterstrike', { mastery: 2, casterSide: 'defender', rounds: 3 })), 3);
  const cs = battle([['vampire', 5]], [['pikeman', 50]]);
  const ev = melee(cs, A(cs), D(cs));
  assert.equal(count(ev, 'retaliate'), 0);
  assert.equal(D(cs).retaliationsUsed, 0, 'no retaliation is spent');
});

test('a retaliation is never counter-retaliated; war machines never retaliate', () => {
  const cs = battle([['pikeman', 50]], [['pikeman', 50]]);
  assert.equal(count(melee(cs, A(cs), D(cs)), 'retaliate'), 1);
  const cs2 = battle([['pikeman', 50]], [['imp', 1]], { machinesD: ['ballista'] });
  const ballista = cs2.stacks.find((s) => s.creatureId === 'ballista');
  assert.equal(count(melee(cs2, A(cs2), ballista), 'retaliate'), 0);
});

test('double_attack: two blows, one retaliation; no second blow on a dead target', () => {
  const cs = battle([['crusader', 10]], [['pikeman', 99]]);
  const ev = melee(cs, A(cs), D(cs));
  assert.equal(count(ev, 'attack'), 2);
  assert.equal(count(ev, 'retaliate'), 1);
  assert.ok(ev.findIndex((e) => e.type === 'retaliate') < ev.map((e) => e.type).lastIndexOf('attack'));
  const cs2 = battle([['wolf_raider', 10]], [['pikeman', 2]]);
  assert.equal(count(melee(cs2, A(cs2), D(cs2)), 'attack'), 1);
});

test('double_shot: two shots, two ammo; one when the target dies; none in melee', () => {
  const cs = battle([['marksman', 10]], [['pikeman', 99]]);
  const ev = shoot(cs, A(cs), D(cs));
  assert.equal(count(ev, 'shoot'), 2);
  assert.equal(A(cs).shots, 22);
  const cs2 = battle([['marksman', 10]], [['pikeman', 1]]);
  assert.equal(count(shoot(cs2, A(cs2), D(cs2)), 'shoot'), 1);
  const cs3 = battle([['marksman', 10]], [['pikeman', 99]]);
  A(cs3).shots = 1;
  assert.equal(count(shoot(cs3, A(cs3), D(cs3)), 'shoot'), 1);
  const cs4 = battle([['marksman', 10]], [['pikeman', 99]]);
  assert.equal(count(melee(cs4, A(cs4), D(cs4)), 'attack'), 1);
});

test('ferocity: strikes again only after killing at least one creature', () => {
  const cs = battle([['ayssid', 1]], [['pikeman', 2]]); // 10 * 1.3 = 13 -> 1 kill
  assert.equal(count(melee(cs, A(cs), D(cs)), 'attack'), 2);
  const cs2 = battle([['ayssid', 1]], [['crusader', 1]]); // 9 dmg vs 35 hp
  assert.equal(count(melee(cs2, A(cs2), D(cs2)), 'attack'), 1);
  const cs3 = battle([['dire_wolf', 10]], [['pikeman', 20]]);
  assert.equal(count(melee(cs3, A(cs3), D(cs3)), 'attack'), 2);
});

test('attack_all_adjacent hits every adjacent enemy, never friends', () => {
  const cs = battle([['hydra', 1], ['pikeman', 5]], [['pikeman', 50], ['pikeman', 50], ['pikeman', 50], ['pikeman', 50]]);
  const hydra = place(A(cs, 0), 5, 5); // hexes (5,5),(4,5)
  place(A(cs, 1), 6, 4);
  place(D(cs, 0), 6, 5); place(D(cs, 1), 3, 5); place(D(cs, 2), 4, 4); place(D(cs, 3), 9, 9);
  activate(cs, hydra);
  const ev = act(cs, { type: 'attack', targetId: D(cs, 0).id, from: hydra.pos });
  for (const i of [0, 1, 2]) assert.equal(damageTo(ev, D(cs, i)).length, 1, `enemy ${i}`);
  assert.equal(damageTo(ev, D(cs, 3)).length, 0);
  assert.equal(damageTo(ev, A(cs, 1)).length, 0);
  assert.equal(count(ev, 'retaliate'), 0);
});

test('three_headed_attack hits the enemies flanking the target only', () => {
  const cs = battle([['cerberus', 5], ['pikeman', 5]], [['pikeman', 50], ['pikeman', 50], ['pikeman', 50]]);
  const cerb = place(A(cs, 0), 5, 5);
  place(D(cs, 0), 6, 5); place(D(cs, 1), 6, 4); place(D(cs, 2), 5, 4);
  place(A(cs, 1), 6, 6);
  activate(cs, cerb);
  const ev = act(cs, { type: 'attack', targetId: D(cs, 0).id, from: cerb.pos });
  assert.equal(damageTo(ev, D(cs, 0)).length, 1);
  assert.equal(damageTo(ev, D(cs, 1)).length, 1);
  assert.equal(damageTo(ev, D(cs, 2)).length, 0, 'adjacent to the cerberus but not flanking');
  assert.equal(damageTo(ev, A(cs, 1)).length, 0, 'friends are spared');
});

test('breath_attack hits the hex behind the target, friend or foe, each with its own defense', () => {
  const cs = battle([['green_dragon', 1], ['crusader', 50]], [['pikeman', 50]]);
  const dragon = place(A(cs, 0), 5, 5);
  place(D(cs), 6, 5);
  place(A(cs, 1), 7, 5);
  activate(cs, dragon);
  const ev = act(cs, { type: 'attack', targetId: D(cs).id, from: dragon.pos });
  assert.equal(firstDamage(ev, D(cs)), 82); // 50 * 1.65
  assert.equal(firstDamage(ev, A(cs, 1)), 65); // 50 * 1.30 against defense 12
  // diagonal: from (5,5) to (6,4) continues to (6,3)
  const cs2 = battle([['green_dragon', 1]], [['pikeman', 50], ['pikeman', 50]]);
  place(A(cs2), 5, 5); place(D(cs2, 0), 6, 4); place(D(cs2, 1), 6, 3);
  activate(cs2, A(cs2));
  const ev2 = act(cs2, { type: 'attack', targetId: D(cs2, 0).id, from: { x: 5, y: 5 } });
  assert.equal(damageTo(ev2, D(cs2, 1)).length, 1);
  // a two-hex target is not hit twice
  const cs3 = battle([['green_dragon', 1]], [['cavalier', 5]]);
  const ev3 = melee(cs3, A(cs3), D(cs3));
  assert.equal(damageTo(ev3, D(cs3), 'melee').length, 1);
});

test('area_shot: Magog hits everything around the target; Lich clouds spare the non-living', () => {
  const cs = battle([['magog', 10], ['pikeman', 5]], [['pikeman', 50], ['efreet', 5], ['pikeman', 50]]);
  place(D(cs, 0), 8, 5); place(D(cs, 1), 9, 5); place(D(cs, 2), 11, 5); place(A(cs, 1), 7, 5);
  const ev = shoot(cs, A(cs, 0), D(cs, 0));
  assert.equal(firstDamage(ev, D(cs, 0)), 44); // 40 * 1.1
  assert.ok(firstDamage(ev, D(cs, 1)) > 0, 'physical: fire immunity does not help');
  assert.ok(firstDamage(ev, A(cs, 1)) > 0, 'friendly fire');
  assert.equal(damageTo(ev, D(cs, 2)).length, 0);
  const cs2 = battle([['lich', 10]], [['skeleton', 50], ['pikeman', 50], ['zombie', 50]]);
  place(D(cs2, 0), 8, 5); place(D(cs2, 1), 9, 5); place(D(cs2, 2), 7, 5);
  const ev2 = shoot(cs2, A(cs2), D(cs2, 0));
  assert.equal(damageTo(ev2, D(cs2, 0)).length, 1, 'the primary target is always hit');
  assert.equal(damageTo(ev2, D(cs2, 1)).length, 1);
  assert.equal(damageTo(ev2, D(cs2, 2)).length, 0);
  const cs3 = battle([['magog', 10]], [['pikeman', 50], ['pikeman', 50]]);
  place(A(cs3), 5, 5); place(D(cs3, 0), 6, 5); place(D(cs3, 1), 7, 5);
  activate(cs3, A(cs3));
  const ev3 = act(cs3, { type: 'attack', targetId: D(cs3, 0).id, from: { x: 5, y: 5 } });
  assert.equal(damageTo(ev3, D(cs3, 1)).length, 0, 'no splash in melee');
});

test('strike_and_return: back to the origin hex, unless bound', () => {
  const cs = battle([['harpy', 10]], [['pikeman', 50]]);
  const harpy = place(A(cs), 2, 5);
  place(D(cs), 6, 5);
  activate(cs, harpy);
  const ev = act(cs, { type: 'attack', targetId: D(cs).id, from: { x: 5, y: 5 } });
  assert.deepEqual(harpy.pos, { x: 2, y: 5 });
  assert.ok(has(ev, 'move', (e) => e.returning));
  assert.ok(has(ev, 'retaliate'));
  const cs2 = battle([['harpy_hag', 10]], [['dendroid_guard', 50]]);
  place(A(cs2), 2, 5); place(D(cs2), 6, 5);
  activate(cs2, A(cs2));
  act(cs2, { type: 'attack', targetId: D(cs2).id, from: { x: 5, y: 5 } });
  assert.deepEqual(A(cs2).pos, { x: 2, y: 5 }, 'no retaliation, so nothing binds the hag');
});

test('strike_and_return stays when bound by a retaliating dendroid', () => {
  const cs = battle([['harpy', 10]], [['dendroid_guard', 50]]);
  place(A(cs), 2, 5); place(D(cs), 6, 5);
  activate(cs, A(cs));
  act(cs, { type: 'attack', targetId: D(cs).id, from: { x: 5, y: 5 } });
  assert.deepEqual(A(cs).pos, { x: 5, y: 5 });
});

test('jousting +5% per hex travelled, cancelled by charge_immunity', () => {
  const run = (target, from) => {
    const cs = battle([['champion', 1]], [[target, 50]]);
    place(A(cs), 1, 5); place(D(cs), 8, 5);
    activate(cs, A(cs));
    const preview = getAttackPreview(cs, A(cs).id, D(cs).id, { from });
    const ev = act(cs, { type: 'attack', targetId: D(cs).id, from });
    return [firstDamage(ev, D(cs)), preview.maxDamage];
  };
  assert.deepEqual(run('swordsman', { x: 7, y: 5 }), [37, 37]); // 25 * (1 + .2 + .3)
  assert.deepEqual(run('pikeman', { x: 7, y: 5 }), [38, 38]); // 25 * 1.55, no jousting
  const cs = battle([['champion', 1]], [['swordsman', 50]]);
  assert.equal(firstDamage(melee(cs, A(cs), D(cs)), D(cs)), 30, 'no movement, no bonus');
});

test('hates +50% in both directions for all three pairs', () => {
  const rows = [
    ['angel', 'devil', 73], ['devil', 'angel', 58], ['arch_angel', 'arch_devil', 80],
    ['genie', 'efreet', 24], ['efreet', 'genie', 40], ['titan', 'black_dragon', 87], ['black_dragon', 'titan', 77],
    ['angel', 'imp', 92],
  ];
  for (const [a, d, dmg] of rows) {
    const cs = battle([[a, 1]], [[d, 9]]);
    assert.equal(firstDamage(melee(cs, A(cs), D(cs)), D(cs)), dmg, `${a} -> ${d}`);
  }
});

test('double_damage_chance 20%: death blow adds +100% to the bonus sum (original formula)', () => {
  const run = (opts) => { const cs = battle([['dread_knight', 1]], [['pikeman', 99]], opts); return firstDamage(melee(cs, A(cs), D(cs)), D(cs)); };
  assert.equal(run({ chance: { double_damage_chance: false } }), 49); // 30 * 1.65
  assert.equal(run({ chance: { double_damage_chance: true } }), 79); // 30 * (1 + 0.65 + 1)
  assert.equal(run({ chance: { double_damage_chance: undefined, 'cast_on_hit:curse': false }, forceRolls: [0.19] }), 79);
  assert.equal(run({ chance: { double_damage_chance: undefined, 'cast_on_hit:curse': false }, forceRolls: [0.2] }), 49);
  const cs = battle([['shadow_assassin', 10]], [['pikeman', 99]], { chance: { double_damage_chance: true } });
  assert.equal(firstDamage(melee(cs, A(cs), D(cs)), D(cs)), 235); // 100 * (1 + 0.35 + 1)
  // luck and death blow are both additive: a lucky death blow is not x4
  const lucky = battle([['dread_knight', 1]], [['pikeman', 99]], { chance: { double_damage_chance: true, luck: true }, heroA: { id: 'h', name: 'H', attack: 0, defense: 0, power: 1, knowledge: 1, mana: 0, spells: [], skills: {}, bonuses: [{ type: 'luck', value: 3 }] } });
  assert.equal(firstDamage(melee(lucky, A(lucky), D(lucky)), D(lucky)), 109); // 30 * (1 + 0.65 + 1 + 1) = 109.5
});

test('reduce_enemy_defense 40 / 80 / 20 % (also when retaliating)', () => {
  const dmg = (a, d) => { const cs = battle([[a, 1]], [[d, 99]]); return firstDamage(melee(cs, A(cs), D(cs)), D(cs)); };
  assert.equal(dmg('behemoth', 'crusader'), 75); // D 12 -> 7: 50 * 1.5
  assert.equal(dmg('ancient_behemoth', 'crusader'), 92); // D 12 -> 2: 50 * 1.85
  assert.equal(dmg('frost_giant', 'crusader'), 42); // D 12 -> 9: 30 * 1.4
  const cs = battle([['crusader', 1]], [['behemoth', 1]]);
  assert.equal(firstDamage(melee(cs, A(cs), D(cs)), A(cs)), 75);
});

test('reduce_enemy_attack 30 / 60 %, melee and ranged', () => {
  const cs = battle([['crusader', 10]], [['nix', 9]]);
  assert.equal(firstDamage(melee(cs, A(cs), D(cs)), D(cs)), 80); // A 12 -> 8 vs 16
  const cs2 = battle([['crusader', 10]], [['nix_warrior', 9]]);
  assert.equal(firstDamage(melee(cs2, A(cs2), D(cs2)), D(cs2)), 67); // A 12 -> 4 vs 17: 100 * 0.675
  const cs3 = battle([['archer', 10]], [['nix', 9]]);
  place(D(cs3), 8, 5);
  assert.equal(firstDamage(shoot(cs3, A(cs3), D(cs3)), D(cs3)), 21); // A 6 -> 4 vs 16: 30 * 0.7
});

test('revenge: Haspid damage grows with its own losses', () => {
  const cs = battle([['haspid', 10]], [['pikeman', 999]]);
  assert.equal(firstDamage(melee(cs, A(cs), D(cs)), D(cs)), 1210); // 550 * 2.2
  const cs2 = battle([['haspid', 10]], [['pikeman', 999]]);
  A(cs2).count = 5;
  assert.equal(firstDamage(melee(cs2, A(cs2), D(cs2)), D(cs2)), 907); // 275 * 2.2 * 1.5
});

test('first_strike: the Bone Colossus answers before the blow (not against no-retaliation attackers)', () => {
  const cs = battle([['pikeman', 50]], [['bone_colossus', 5]]);
  const ev = melee(cs, A(cs), D(cs));
  const types = ev.map((e) => e.type).filter((t) => t === 'attack' || t === 'retaliate');
  assert.deepEqual(types, ['retaliate', 'attack']);
  const cs2 = battle([['pikeman', 3]], [['bone_colossus', 5]]);
  const ev2 = melee(cs2, A(cs2), D(cs2));
  assert.equal(count(ev2, 'attack'), 0, 'attacker killed first');
  const cs3 = battle([['vampire', 5]], [['bone_colossus', 5]]);
  assert.equal(count(melee(cs3, A(cs3), D(cs3)), 'retaliate'), 0);
});

test('preemptive_shot: once per round at a stack that walks up to melee; not at burrowers', () => {
  const cs = battle([['pikeman', 50], ['pikeman', 50]], [['gunslinger', 5]]);
  place(A(cs, 0), 2, 5); place(A(cs, 1), 2, 7); place(D(cs), 6, 5);
  activate(cs, A(cs, 0));
  const ev = act(cs, { type: 'attack', targetId: D(cs).id, from: { x: 5, y: 5 } });
  assert.ok(has(ev, 'ability', (e) => e.ability === 'preemptive_shot'));
  assert.ok(ev.findIndex((e) => e.type === 'shoot') < ev.findIndex((e) => e.type === 'attack'));
  assert.equal(D(cs).shots, 15);
  activate(cs, A(cs, 1));
  const ev2 = act(cs, { type: 'attack', targetId: D(cs).id, from: { x: 6, y: 6 } });
  assert.ok(!has(ev2, 'shoot'), 'once per round');
  const cs2 = battle([['sandworm', 5]], [['gunslinger', 5]]);
  place(A(cs2), 2, 5); place(D(cs2), 6, 5);
  activate(cs2, A(cs2));
  assert.ok(!has(act(cs2, { type: 'attack', targetId: D(cs2).id, from: { x: 5, y: 5 } }), 'shoot'));
});

test('ranged_retaliation: the Bounty Hunter shoots back once per round', () => {
  const cs = battle([['archer', 20], ['archer', 20]], [['bounty_hunter', 5]]);
  place(D(cs), 8, 5);
  const ev = shoot(cs, A(cs, 0), D(cs));
  assert.ok(has(ev, 'ability', (e) => e.ability === 'ranged_retaliation'));
  assert.equal(damageTo(ev, A(cs, 0)).length, 1);
  assert.equal(D(cs).shots, 23);
  assert.ok(!has(shoot(cs, A(cs, 1), D(cs)), 'ability', (e) => e.ability === 'ranged_retaliation'));
});

test('accurate_shot: extra kills capped at ceil(count x 3%), living targets only', () => {
  const cs = battle([['sea_dog', 100]], [['crusader', 200]], { chance: { accurate_shot: true } });
  place(D(cs), 8, 5);
  const ev = shoot(cs, A(cs), D(cs));
  assert.ok(has(ev, 'ability', (e) => e.ability === 'accurate_shot' && e.kills === 3));
  const cs2 = battle([['sea_dog', 100]], [['stone_golem', 200]], { chance: { accurate_shot: true } });
  place(D(cs2), 8, 5);
  assert.ok(!has(shoot(cs2, A(cs2), D(cs2)), 'ability'));
});

test('shooting is blocked by an adjacent enemy unless the hero has free_shooting; ammo runs out', () => {
  const cs = battle([['archer', 10]], [['pikeman', 10]]);
  place(A(cs), 5, 5); place(D(cs), 6, 5);
  activate(cs, A(cs));
  assert.deepEqual(getLegalActions(cs).shots, []);
  assert.equal(performAction(cs, { type: 'shoot', targetId: D(cs).id }).ok, false);
  const cs2 = battle([['archer', 10]], [['pikeman', 10]], { heroA: hero({ bonuses: [{ type: 'free_shooting' }] }) });
  place(A(cs2), 5, 5); place(D(cs2), 6, 5);
  activate(cs2, A(cs2));
  assert.deepEqual(getLegalActions(cs2).shots, [D(cs2).id]);
  const cs3 = battle([['archer', 10]], [['pikeman', 10]]);
  A(cs3).shots = 0;
  activate(cs3, A(cs3));
  assert.deepEqual(getLegalActions(cs3).shots, []);
});

test('no_obstacle_penalty: siege wall halves shots unless the shooter or its hero ignores it', () => {
  const run = (shooter, heroA) => {
    const cs = battle([[shooter, 10]], [['pikeman', 99]], { siege: { fortLevel: 1, faction: 'castle' }, heroA });
    cs.siege.wallColumn = 10;
    return firstDamage(shoot(cs, A(cs), D(cs)), D(cs));
  };
  assert.equal(run('sharpshooter'), 135);
  assert.equal(run('archer'), 7); // 31.5 * 0.5 (range) * 0.5 (wall)
  assert.equal(run('halfling_grenadier'), 15); // 30 * 0.5 (range only)
  assert.equal(run('archer', hero({ bonuses: [{ type: 'no_obstacle_penalty' }] })), 15);
});
