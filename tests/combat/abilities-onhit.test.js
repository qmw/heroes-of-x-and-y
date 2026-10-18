// On-hit abilities (creatures.md §4.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getStackInfo, addStatus } from '../../src/engine/combat/index.js';
import { battle, A, D, place, activate, act, melee, shoot, firstDamage, damageTo, has, effectIds } from './helpers.js';

const ON = (tag) => ({ chance: { [tag]: true } });

test('death_stare: binomial kills capped at ceil(count / 10), living targets only', () => {
  const cs = battle([['mighty_gorgon', 30]], [['crusader', 100]], ON('death_stare'));
  const ev = melee(cs, A(cs), D(cs));
  // 480 * 0.975 = 468 -> 87 left (top 22 hp); stare kills 3 whole creatures
  assert.ok(has(ev, 'ability', (e) => e.ability === 'death_stare' && e.kills === 3));
  assert.ok(D(cs).count <= 84);
  const cs2 = battle([['mighty_gorgon', 10]], [['crusader', 100]], { chance: { death_stare: undefined }, forceRolls: [0.5, 0.05, 0.01] });
  const ev2 = melee(cs2, A(cs2), D(cs2));
  assert.ok(has(ev2, 'ability', (e) => e.ability === 'death_stare' && e.kills === 1));
  const cs3 = battle([['mighty_gorgon', 30]], [['skeleton', 100]], ON('death_stare'));
  assert.ok(!has(melee(cs3, A(cs3), D(cs3)), 'ability'));
});

test('cast_on_hit: Unicorn blind (melee), Black Knight / Mummy curse, Bog Witch curse on shots', () => {
  const cs = battle([['unicorn', 5]], [['pikeman', 99]], ON('cast_on_hit:blind'));
  const ev = melee(cs, A(cs), D(cs));
  assert.deepEqual(effectIds(D(cs)), ['blind']);
  assert.equal(D(cs).effects[0].mastery, 2);
  assert.ok(has(ev, 'status_added', (e) => e.spellId === 'blind' && e.rounds === 3));
  assert.ok(!has(ev, 'retaliate'), 'blinded by this blow: no retaliation');
  const cs2 = battle([['black_knight', 2]], [['pikeman', 99]], ON('cast_on_hit:curse'));
  melee(cs2, A(cs2), D(cs2));
  assert.deepEqual(effectIds(D(cs2)), ['curse']);
  const cs3 = battle([['mummy', 2]], [['pikeman', 99]], { chance: { 'cast_on_hit:curse': undefined }, forceRolls: [0.49] });
  melee(cs3, A(cs3), D(cs3));
  assert.deepEqual(effectIds(D(cs3)), ['curse'], 'mummy curse 50%');
  const cs4 = battle([['bog_witch', 5]], [['pikeman', 99]], ON('cast_on_hit:curse'));
  place(D(cs4), 8, 5);
  shoot(cs4, A(cs4), D(cs4));
  assert.deepEqual(effectIds(D(cs4)), ['curse']);
  // undead are immune to curse
  const cs5 = battle([['black_knight', 2]], [['skeleton', 99]], ON('cast_on_hit:curse'));
  melee(cs5, A(cs5), D(cs5));
  assert.deepEqual(effectIds(D(cs5)), []);
});

test('cast_on_hit before damage: Serpent Fly dispels beneficial spells, Dragon Fly weakens first', () => {
  const cs = battle([['serpent_fly', 5]], [['pikeman', 99]], ON('cast_on_hit:dispel'));
  addStatus(cs, D(cs), 'stone_skin', { mastery: 2, casterSide: 'defender', rounds: 5 });
  addStatus(cs, D(cs), 'slow', { mastery: 2, casterSide: 'attacker', rounds: 5 });
  melee(cs, A(cs), D(cs));
  assert.deepEqual(effectIds(D(cs)), ['slow']);
  const cs2 = battle([['dragon_fly', 5]], [['crusader', 99]], { chance: { 'cast_on_hit:dispel': true, 'cast_on_hit:weakness': true } });
  const ev = melee(cs2, A(cs2), D(cs2));
  assert.ok(ev.findIndex((e) => e.type === 'status_added' && e.spellId === 'weakness') < ev.findIndex((e) => e.type === 'damage'));
  assert.equal(getStackInfo(cs2, D(cs2).id).attack, 6);
});

test('cast_on_hit: Sorceress Disrupting Ray is permanent and stacks; Sea Witch weakens with shots', () => {
  const cs = battle([['sorceress', 5]], [['crusader', 99]], { chance: { 'cast_on_hit:weakness': true, 'cast_on_hit:disrupting_ray': true } });
  place(D(cs), 8, 5);
  shoot(cs, A(cs), D(cs));
  shoot(cs, A(cs), D(cs));
  assert.equal(D(cs).effects.filter((e) => e.spellId === 'disrupting_ray').length, 2);
  assert.ok(D(cs).effects.every((e) => e.spellId !== 'disrupting_ray' || e.roundsLeft === null));
  assert.equal(getStackInfo(cs, D(cs).id).defense, 12 - 8);
  const cs2 = battle([['sea_witch', 5]], [['crusader', 99]], { chance: { 'cast_on_hit:weakness': true } });
  place(D(cs2), 8, 5);
  shoot(cs2, A(cs2), D(cs2));
  assert.deepEqual(effectIds(D(cs2)), ['weakness']);
});

test('cast_on_hit: Fangarm hypnotizes only when retaliating, within its hp limit', () => {
  const cs = battle([['pikeman', 2], ['pikeman', 50]], [['fangarm', 1]], ON('cast_on_hit:hypnotize'));
  melee(cs, A(cs), D(cs));
  assert.deepEqual(effectIds(A(cs)), ['hypnotize']);
  assert.equal(getStackInfo(cs, A(cs).id).controller, 'defender');
  const cs2 = battle([['pikeman', 20]], [['fangarm', 1]], ON('cast_on_hit:hypnotize'));
  melee(cs2, A(cs2), D(cs2));
  assert.deepEqual(effectIds(A(cs2)), [], 'over the hp limit');
  const cs3 = battle([['fangarm', 5]], [['pikeman', 2]], ON('cast_on_hit:hypnotize'));
  melee(cs3, A(cs3), D(cs3));
  assert.deepEqual(effectIds(D(cs3)), [], 'not when attacking');
});

test('petrify_attack: melee only, half damage, no retaliation, breaks when hit; immunities', () => {
  const cs = battle([['medusa', 5], ['crusader', 10]], [['pikeman', 99]], ON('petrify_attack'));
  melee(cs, A(cs, 0), D(cs));
  assert.deepEqual(effectIds(D(cs)), ['petrify']);
  const crus = place(A(cs, 1), 6, 4);
  activate(cs, crus);
  const ev = act(cs, { type: 'attack', targetId: D(cs).id, from: crus.pos });
  assert.equal(firstDamage(ev, D(cs)), 67); // 135 / 2
  assert.ok(!has(ev, 'retaliate'));
  assert.deepEqual(effectIds(D(cs)), []);
  const shot = battle([['medusa', 5]], [['pikeman', 99]], ON('petrify_attack'));
  place(D(shot), 8, 5);
  shoot(shot, A(shot), D(shot));
  assert.deepEqual(effectIds(D(shot)), []);
  for (const immune of ['troglodyte', 'green_dragon']) {
    const c = battle([['basilisk', 5]], [[immune, 99]], ON('petrify_attack'));
    melee(c, A(c), D(c));
    assert.deepEqual(effectIds(D(c)), [], immune);
  }
  const undead = battle([['basilisk', 5]], [['skeleton', 99]], ON('petrify_attack'));
  melee(undead, A(undead), D(undead));
  assert.deepEqual(effectIds(D(undead)), ['petrify']);
});

test('paralyze_attack: 3 rounds, no turns; mind-immune and undead are immune', () => {
  const cs = battle([['scorpicore', 5]], [['pikeman', 99]], ON('paralyze_attack'));
  const ev = melee(cs, A(cs), D(cs));
  assert.deepEqual(effectIds(D(cs)), ['paralyze']);
  assert.ok(has(ev, 'status_added', (e) => e.spellId === 'paralyze' && e.rounds === 3));
  assert.ok(has(ev, 'turn_skipped', (e) => e.stackId === D(cs).id && e.reason === 'disabled'));
  for (const immune of ['giant', 'skeleton', 'stone_golem']) {
    const c = battle([['scorpicore', 5]], [[immune, 99]], ON('paralyze_attack'));
    melee(c, A(c), D(c));
    assert.deepEqual(effectIds(D(c)), [], immune);
  }
});

test('disease_attack: -2 attack / -2 defense, refreshed not stacked, living only', () => {
  const cs = battle([['zombie', 50]], [['crusader', 10]], ON('disease_attack'));
  melee(cs, A(cs), D(cs));
  melee(cs, A(cs), D(cs), { keep: true });
  assert.deepEqual(effectIds(D(cs)), ['disease']);
  assert.equal(getStackInfo(cs, D(cs).id).attack, 10);
  assert.equal(getStackInfo(cs, D(cs).id).defense, 10);
  const c = battle([['zombie', 20]], [['skeleton', 99]], ON('disease_attack'));
  melee(c, A(c), D(c));
  assert.deepEqual(effectIds(D(c)), []);
});

test('aging_attack: max hp halved (rounded up) for 3 rounds, restored without healing', async () => {
  const { removeStatus } = await import('../../src/engine/combat/index.js');
  const cs = battle([['ghost_dragon', 1]], [['pikeman', 99]], ON('aging_attack'));
  melee(cs, A(cs), D(cs));
  assert.equal(D(cs).maxHp, 5);
  assert.ok(D(cs).hp <= 5);
  const hp = D(cs).hp;
  removeStatus(cs, D(cs), 'age');
  assert.equal(D(cs).maxHp, 10);
  assert.equal(D(cs).hp, hp);
});

test('poison_attack: -10% max hp now and at the next 2 round starts, floor 50%, lasts the battle', () => {
  const cs = battle([['wyvern_monarch', 1]], [['pikeman', 20]], ON('poison_attack'));
  melee(cs, A(cs), D(cs));
  assert.equal(D(cs).maxHp, 9);
  while (cs.round < 4) act(cs, { type: 'defend' });
  assert.equal(D(cs).maxHp, 7);
  assert.deepEqual(effectIds(D(cs)), [], 'expired');
  assert.equal(D(cs).maxHp, 7, 'loss stays');
});

test('lightning_strike: 10 x count as Lightning Bolt after the retaliation, with immunities', () => {
  // damage uses the thunderbirds still alive after the retaliation
  const run = (target, n = 50) => {
    const cs = battle([['thunderbird', 10]], [[target, n]], ON('lightning_strike'));
    const ev = melee(cs, A(cs), D(cs));
    return [damageTo(ev, D(cs), 'spell')[0]?.amount, 10 * A(cs).count];
  };
  const [p, n] = run('pikeman');
  assert.equal(p, n);
  assert.ok(n < 100, 'the retaliation killed some thunderbirds first');
  const [air, n2] = run('air_elemental', 15);
  assert.equal(air, 2 * n2);
  const [golem, n3] = run('stone_golem', 15);
  assert.equal(golem, Math.floor(n3 / 2));
  assert.equal(run('earth_elemental', 15)[0], undefined);
  assert.equal(run('green_dragon', 3)[0], undefined);
  const cs = battle([['thunderbird', 5]], [['pikeman', 50]], ON('lightning_strike'));
  const ev = melee(cs, A(cs), D(cs));
  assert.ok(ev.findIndex((e) => e.type === 'retaliate') < ev.findIndex((e) => e.type === 'damage' && e.kind === 'spell'));
  const cs2 = battle([['pikeman', 50]], [['thunderbird', 5]], ON('lightning_strike'));
  assert.equal(damageTo(melee(cs2, A(cs2), D(cs2)), A(cs2), 'spell').length, 0, 'not on retaliation');
});

test('binding: the hit stack is rooted until the binder moves or dies', () => {
  const cs = battle([['dendroid_guard', 10]], [['pikeman', 50]]);
  melee(cs, A(cs), D(cs));
  assert.deepEqual(effectIds(D(cs)), ['bind']);
  activate(cs, D(cs));
  assert.equal(act(cs, { type: 'defend' }).length > 0, true);
  activate(cs, A(cs));
  act(cs, { type: 'move', to: { x: 5, y: 3 } });
  assert.deepEqual(effectIds(D(cs)), []);
  const cs2 = battle([['pikeman', 50]], [['dendroid_guard', 10]]);
  melee(cs2, A(cs2), D(cs2));
  assert.deepEqual(effectIds(A(cs2)), ['bind'], 'also on retaliation');
});

test('acid_breath: -3 defense per hit for the battle, 30% for 25 x count extra damage, breath target too', () => {
  const cs = battle([['rust_dragon', 1]], [['crusader', 99], ['crusader', 99]], ON('acid_breath'));
  place(A(cs), 5, 5); place(D(cs, 0), 6, 5); place(D(cs, 1), 7, 5);
  activate(cs, A(cs));
  const ev = act(cs, { type: 'attack', targetId: D(cs, 0).id, from: { x: 5, y: 5 } });
  assert.equal(damageTo(ev, D(cs, 0), 'acid')[0].amount, 25);
  assert.equal(damageTo(ev, D(cs, 1), 'acid')[0].amount, 25);
  assert.equal(getStackInfo(cs, D(cs, 1).id).defense, 9);
  activate(cs, A(cs));
  act(cs, { type: 'attack', targetId: D(cs, 0).id, from: { x: 5, y: 5 } });
  assert.equal(getStackInfo(cs, D(cs, 0).id).defense, 6);
});

test('life_drain: heals then resurrects up to the starting count, living targets only', () => {
  const cs = battle([['vampire_lord', 10]], [['pikeman', 99]]);
  A(cs).count = 5; A(cs).hp = 10;
  melee(cs, A(cs), D(cs)); // 40 * 1.25 = 50 drained
  assert.equal(A(cs).count, 6);
  assert.equal(A(cs).hp, 20);
  const full = battle([['vampire_lord', 10]], [['pikeman', 99]]);
  melee(full, A(full), D(full));
  assert.equal(A(full).count, 10);
  const undead = battle([['vampire_lord', 10]], [['skeleton', 99]]);
  A(undead).count = 5; A(undead).hp = 10;
  melee(undead, A(undead), D(undead));
  assert.equal(A(undead).hp, 10);
});

test('heat_stroke: other enemies around the target take a share as fire damage', () => {
  const cs = battle([['dreadnought', 1], ['pikeman', 10]], [['pikeman', 50], ['pikeman', 50], ['efreet', 5], ['iron_golem', 5]]);
  place(A(cs, 0), 5, 5); place(D(cs, 0), 6, 5); place(D(cs, 1), 7, 5); place(D(cs, 2), 6, 4); place(D(cs, 3), 7, 6);
  place(A(cs, 1), 6, 6);
  activate(cs, A(cs, 0));
  const ev = act(cs, { type: 'attack', targetId: D(cs, 0).id, from: { x: 5, y: 5 } });
  assert.equal(firstDamage(ev, D(cs, 0)), 82);
  assert.equal(firstDamage(ev, D(cs, 1)), 41);
  assert.equal(damageTo(ev, D(cs, 2)).length, 0, 'fire immune');
  assert.equal(firstDamage(ev, D(cs, 3)), 10, 'golem reduction');
  assert.equal(damageTo(ev, A(cs, 1)).length, 0, 'friends spared');
});
