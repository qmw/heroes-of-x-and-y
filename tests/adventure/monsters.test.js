import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addHero, adv, answer, finishCombat, kinds, eventTypes } from './fixture.js';
import { getCreature } from '../../src/data/creatures.js';

const P = (x, y, z = 0) => ({ x, y, z });
const PIKE = getCreature('pikeman').aiValue; // 80

/** Hero with `strength` worth of pikemen-equivalents next to a monster stack. */
function scene({ creatureId = 'imp', count = 10, data = {}, hero = {} } = {}) {
  const state = makeState();
  const h = addHero(state, { pos: P(5, 6), primary: { attack: 0, defense: 0 }, ...hero });
  const mon = adv.addObject(state, 'monster', P(5, 5), { data: { creatureId, count, character: 5, ...data } });
  return { state, hero: h, mon, attack: () => adv.moveHero(state, h.id, P(5, 5)) };
}
const pikes = (n) => [{ creatureId: 'pikeman', count: n }];
const imps = (strength) => Math.round(strength / getCreature('imp').aiValue);

test('powerFactor table', () => {
  assert.equal(adv.powerFactor(7), 11);
  assert.equal(adv.powerFactor(100), 11);
  assert.equal(adv.powerFactor(6.99), 11);
  assert.equal(adv.powerFactor(6.4), 10);
  assert.equal(adv.powerFactor(3), 4);
  assert.equal(adv.powerFactor(1.5), 1);
  assert.equal(adv.powerFactor(1.49), 0);
  assert.equal(adv.powerFactor(1), 0);
  assert.equal(adv.powerFactor(0.99), -1);
  assert.equal(adv.powerFactor(0.5), -1);
  assert.equal(adv.powerFactor(0.49), -2);
  assert.equal(adv.powerFactor(0.333), -2);
  assert.equal(adv.powerFactor(0.33), -3);
});

test('strength ratio uses army AI value and sqrt((1+0.05A)(1+0.05D))', () => {
  const impV = getCreature('imp').aiValue;
  const s = scene({ count: 16, hero: { army: pikes(10), primary: { attack: 0, defense: 0 } } });
  assert.equal(adv.evaluateMonster(s.state, s.hero, s.mon).ratio, (10 * PIKE) / (16 * impV));
  s.hero.primary.attack = 20; // (1 + 1) * 1 -> sqrt(2)
  assert.ok(Math.abs(adv.evaluateMonster(s.state, s.hero, s.mon).ratio - Math.SQRT2 * (10 * PIKE) / (16 * impV)) < 1e-9);
  s.hero.primary.defense = 20;
  assert.ok(Math.abs(adv.evaluateMonster(s.state, s.hero, s.mon).ratio - 2 * (10 * PIKE) / (16 * impV)) < 1e-9);
});

test('outcome matrix: fight / join free / join for gold / flee', () => {
  // ratio 2 -> powerFactor 2
  const count = imps(10 * PIKE / 2);
  const ratio2 = (o) => scene({ count, ...o });
  const ev = (s) => adv.evaluateMonster(s.state, s.hero, s.mon);
  assert.equal(ev(ratio2({ data: { character: 3 } })).outcome, 'fight', 'charisma 2 < 3');
  assert.equal(ev(ratio2({ data: { character: 1 } })).outcome, 'join', '0 + 0 + 1 >= 1');
  assert.equal(ev(ratio2({ data: { character: 2 } })).outcome, 'fight', 'charisma 2 = character, cannot join, not >');
  const dip1 = { skills: [{ id: 'diplomacy', level: 1 }] };
  assert.equal(ev(ratio2({ data: { character: 2 }, hero: dip1 })).outcome, 'join', '1 + 0 + 1 >= 2');
  const gold = ev(ratio2({ data: { character: 3 }, hero: dip1 }));
  assert.equal(gold.outcome, 'join_gold', '2 < 3 but 2*1 + 0 + 1 >= 3');
  assert.equal(gold.cost, count * getCreature('imp').cost.gold);
  assert.equal(ev(ratio2({ data: { character: 4 }, hero: dip1 })).outcome, 'fight', 'charisma 3 < 4');
  const dip3 = { skills: [{ id: 'diplomacy', level: 3 }] };
  assert.equal(ev(ratio2({ data: { character: 4 }, hero: dip3 })).outcome, 'join');
  assert.equal(ev(ratio2({ data: { character: 5 }, hero: dip3 })).outcome, 'join_gold', '3+0+1 < 5 <= 6+0+1');
  // overwhelming hero (ratio >= 7): flees unless it would join
  const big = (o) => scene({ count: 1, ...o });
  assert.equal(ev(big({ data: { character: 5 } })).outcome, 'flee');
  assert.equal(ev(big({ data: { character: 1 } })).outcome, 'join');
  assert.equal(ev(big({ data: { character: 5, neverFlees: true } })).outcome, 'fight');
  assert.equal(ev(big({ data: { disposition: 'savage', character: undefined } })).outcome, 'flee', 'savage never joins');
  assert.equal(ev(big({ data: { character: 11 } })).outcome, 'fight', 'charisma 11 = character 11');
  // weak hero
  const weak = scene({ count: 500, data: { character: 1 } });
  assert.equal(ev(weak).outcome, 'fight');
  assert.equal(ev(weak).powerFactor, -3);
  const compliant = scene({ count: 500, data: { disposition: 'compliant', character: undefined } });
  assert.equal(compliant.mon.data.character, -4);
  assert.equal(ev(compliant).outcome, 'join', 'compliant stacks always join');
});

test('sympathy: same creature line in the army (+1), more than half of the army (+2)', () => {
  const count = imps(10 * PIKE / 2);
  const mixed = scene({ count, data: { character: 2 }, hero: { army: [{ creatureId: 'pikeman', count: 10 }, { creatureId: 'familiar', count: 1 }] } });
  const e1 = adv.evaluateMonster(mixed.state, mixed.hero, mixed.mon);
  assert.equal(e1.sympathy, 1, 'upgrade of the monster counts');
  assert.equal(e1.outcome, 'join', '0 + 1 + 1 >= 2');
  const mostly = scene({ count: 5, data: { character: 3 }, hero: { army: [{ creatureId: 'pikeman', count: 3 }, { creatureId: 'imp', count: 40 }] } });
  const e2 = adv.evaluateMonster(mostly.state, mostly.hero, mostly.mon);
  assert.equal(e2.sympathy, 2);
  assert.equal(e2.outcome, 'join', '0 + 2 + 1 >= 3');
  const half = scene({ count: 5, data: { character: 3 }, hero: { army: [{ creatureId: 'pikeman', count: 40 }, { creatureId: 'imp', count: 40 }] } });
  assert.equal(adv.evaluateMonster(half.state, half.hero, half.mon).sympathy, 1, 'exactly half is not "more than half"');
});

test('canJoin is false without a free slot (and no stack of the kind)', () => {
  const seven = ['pikeman', 'archer', 'griffin', 'swordsman', 'monk', 'cavalier', 'angel'].map((creatureId) => ({ creatureId, count: 50 }));
  const s = scene({ count: 1, data: { character: 1 }, hero: { army: seven } });
  const e = adv.evaluateMonster(s.state, s.hero, s.mon);
  assert.equal(e.canJoin, false);
  assert.equal(e.outcome, 'flee');
  s.state.settings.noMonsterJoin = true;
  const s2 = scene({ count: 1, data: { character: 1 } });
  s2.state.settings.noMonsterJoin = true;
  assert.equal(adv.evaluateMonster(s2.state, s2.hero, s2.mon).outcome, 'flee');
});

test('JOIN: free join adds the whole stack, no experience; declining -> flee if they would flee, else fight', () => {
  const s = scene({ count: 4, data: { character: 1 } });
  const r = s.attack();
  assert.deepEqual(kinds(s.state), ['monster_join']);
  assert.equal(s.state.pending[0].data.cost, 0);
  assert.equal(s.state.pending[0].data.sizeLabel, 'few');
  assert.ok(eventTypes(r).includes('monster_encounter'));
  const res = answer(s.state, 0);
  assert.deepEqual(s.hero.army.filter(Boolean), [{ creatureId: 'pikeman', count: 10 }, { creatureId: 'imp', count: 4 }]);
  assert.equal(s.state.map.objects[s.mon.id], undefined);
  assert.equal(s.hero.exp, 0);
  assert.equal(res.events[0].type, 'monster_joined');
  // overwhelming hero refuses: the stack re-evaluates without joining (charisma 11 > 1) and flees
  const d = scene({ count: 4, data: { character: 1 } });
  d.attack();
  const ref = answer(d.state, 1);
  assert.deepEqual(kinds(d.state), ['monster_flee']);
  assert.equal(ref.events[0].type, 'monster_refused');
  assert.equal(d.state.combat, null);
  answer(d.state, 0); // pursue
  assert.equal(d.state.combat.context.kind, 'adv_monster');
  assert.ok(d.state.map.objects[d.mon.id]);
  // charisma == character (ratio 1, Diplomacy 1, character 1): joins, but refusing means a fight
  const f = scene({ count: imps(10 * PIKE), data: { character: 1 }, hero: { skills: [{ id: 'diplomacy', level: 1 }] } });
  assert.equal(adv.evaluateMonster(f.state, f.hero, f.mon).outcome, 'join');
  f.attack();
  answer(f.state, 1);
  assert.deepEqual(kinds(f.state), []);
  assert.equal(f.state.combat.context.kind, 'adv_monster');
});

test('JOIN FOR GOLD: costs count x creature gold; not enough gold means a fight', () => {
  const count = imps(10 * PIKE / 2);
  const dip1 = { skills: [{ id: 'diplomacy', level: 1 }] };
  const s = scene({ count, data: { character: 3 }, hero: dip1 });
  s.attack();
  const cost = count * getCreature('imp').cost.gold;
  assert.equal(s.state.pending[0].data.cost, cost);
  const g = s.state.players[0].resources.gold;
  answer(s.state, 0);
  assert.equal(s.state.players[0].resources.gold, g - cost);
  assert.equal(s.hero.army[1].count, count);
  const poor = scene({ count, data: { character: 3 }, hero: dip1 });
  poor.state.players[0].resources.gold = cost - 1;
  poor.attack();
  assert.deepEqual(kinds(poor.state), []);
  assert.equal(poor.state.combat.context.kind, 'adv_monster');
});

test('FLEE: letting them go removes the stack without experience; pursuing fights', () => {
  const s = scene({ count: 1, data: { character: 5 } });
  s.attack();
  assert.deepEqual(kinds(s.state), ['monster_flee']);
  const res = answer(s.state, 1);
  assert.equal(res.events[0].type, 'monster_fled');
  assert.equal(s.state.map.objects[s.mon.id], undefined);
  assert.equal(s.state.combat, null);
  const p = scene({ count: 1, data: { character: 5 } });
  p.attack();
  answer(p.state, 0);
  assert.equal(p.state.combat.context.objectId, p.mon.id);
});

test('FIGHT: win removes the stack and grants its reward; a lost fight leaves the survivors', () => {
  const s = scene({ count: 300, data: { character: 10, reward: { resources: { gold: 700 }, artifacts: ['spyglass'] } } });
  s.attack();
  assert.deepEqual(kinds(s.state), []);
  assert.equal(s.state.combat.defender.army.filter(Boolean).reduce((n, st) => n + st.count, 0), 300);
  const g = s.state.players[0].resources.gold;
  const fin = finishCombat(s.state, 'attacker');
  assert.equal(s.state.map.objects[s.mon.id], undefined);
  assert.equal(s.state.players[0].resources.gold, g + 700);
  assert.equal(s.state.players[0].visited[`killed_${s.mon.id}`], true);
  assert.equal(fin.events[0].type, 'monster_defeated');
  const l = scene({ count: 300, data: { character: 10 } });
  l.attack();
  finishCombat(l.state, 'defender', [{ creatureId: 'imp', count: 100 }, { creatureId: 'familiar', count: 44 }]);
  assert.equal(l.mon.data.count, 144, 'upgraded stack folds back into the count');
  assert.equal(l.state.heroes[l.hero.id], undefined);
});

test('stack splitting: base count by ratio, +-1 by roll, even split, 50% upgraded middle stack', () => {
  assert.deepEqual([0.3, 0.5, 0.66, 0.67, 0.99, 1, 1.49, 1.5, 1.99, 2, 9].map(adv.baseStackCount), [7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2]);
  const sizes = new Set();
  let upgraded = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const state = makeState({ seed });
    const mon = adv.addObject(state, 'monster', P(5, 5), { data: { creatureId: 'imp', count: 100 } });
    const army = adv.splitMonster(state, mon, 1.2).filter(Boolean); // base 4
    sizes.add(army.length);
    assert.equal(army.reduce((n, s) => n + s.count, 0), 100);
    const counts = army.map((s) => s.count);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'even split');
    assert.ok(counts[0] >= counts[counts.length - 1], 'remainder goes to the first stacks');
    const ups = army.map((s, i) => (s.creatureId === 'familiar' ? i : -1)).filter((i) => i >= 0);
    assert.ok(ups.length <= 1);
    if (ups.length) { upgraded++; assert.equal(ups[0], Math.floor(army.length / 2)); }
    assert.ok(army.every((s) => ['imp', 'familiar'].includes(s.creatureId)));
  }
  assert.deepEqual([...sizes].sort(), [3, 4, 5]);
  assert.ok(upgraded > 70 && upgraded < 130, `upgraded stacks: ${upgraded}/200`);
  // clamps: never more stacks than creatures, never more than 7, never fewer than 1
  const state = makeState();
  const two = adv.addObject(state, 'monster', P(5, 5), { data: { creatureId: 'peasant', count: 2 } });
  for (let i = 0; i < 20; i++) assert.ok(adv.splitMonster(state, two, 0.1).filter(Boolean).length <= 2);
  const many = adv.addObject(state, 'monster', P(8, 5), { data: { creatureId: 'peasant', count: 1000 } });
  for (let i = 0; i < 20; i++) {
    const n = adv.splitMonster(state, many, 0.1).filter(Boolean).length;
    assert.ok(n >= 6 && n <= 7);
  }
  // creatures without an upgrade never get one
  assert.ok(adv.splitMonster(state, many, 3).filter(Boolean).every((s) => s.creatureId === 'peasant'));
});

test('weekly growth: +10% with hidden fractions (count = floor(power/1000)) from week 2 on, cap 4000, noGrowth', () => {
  const state = makeState();
  const a = adv.addObject(state, 'monster', P(2, 2), { data: { creatureId: 'imp', count: 10 } });
  const b = adv.addObject(state, 'monster', P(5, 5), { data: { creatureId: 'imp', count: 11 } });
  const c = adv.addObject(state, 'monster', P(8, 8), { data: { creatureId: 'imp', count: 100, noGrowth: true } });
  const d = adv.addObject(state, 'monster', P(11, 2), { data: { creatureId: 'imp', count: 3990 } });
  adv.startOfWeekAdventure(state); // week 1, day 1: map start, no growth
  assert.deepEqual([a, b, c, d].map((m) => m.data.count), [10, 11, 100, 3990]);
  state.turn = 8;
  adv.startOfWeekAdventure(state);
  assert.deepEqual([a, b, c, d].map((m) => m.data.count), [11, 12, 100, 4000]);
  state.turn = 15;
  adv.startOfWeekAdventure(state);
  assert.deepEqual([a, b, c, d].map((m) => m.data.count), [12, 13, 100, 4000]);
  // a stack of 5 shows no growth in week 2 (5.5) but 6 in week 3 (6.05): fractions accumulate
  const e = adv.addObject(state, 'monster', P(2, 8), { data: { creatureId: 'imp', count: 5 } });
  adv.growMonster(e);
  assert.equal(e.data.count, 5);
  adv.growMonster(e);
  assert.equal(e.data.count, 6);
  // a battle changes the count: the hidden size restarts from the new count
  e.data.count = 3;
  adv.growMonster(e);
  assert.equal(e.data.count, 3);
  assert.equal(e.data.power, 3300);
});

test('spawnMonthMonsters places stacks of the creature on free land', () => {
  const state = makeState({ width: 30, height: 30 });
  const res = adv.spawnMonthMonsters(state, 'imp');
  assert.equal(res.events.length, 3);
  const mons = Object.values(state.map.objects);
  assert.ok(mons.every((m) => m.defId === 'monster' && m.data.creatureId === 'imp' && m.data.count >= 20));
});

test('a battle the combat adapter refuses is not reported: moveHero fails, state stays consistent', () => {
  const s = scene({ count: 50, data: { character: 10 } });
  adv.setDeps({ startCombat: () => ({ ok: false, error: 'attacker_has_no_army' }) });
  const mp = s.hero.movePoints;
  const r = s.attack();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'combat_failed');
  assert.equal(r.reason, 'attacker_has_no_army');
  assert.ok(!eventTypes(r).includes('combat'), 'no phantom battle');
  assert.ok(eventTypes(r).includes('combat_failed'));
  assert.equal(s.state.combat, null);
  assert.deepEqual(s.hero.pos, P(5, 6), 'hero did not move');
  assert.equal(s.hero.movePoints, mp, 'the refused attack cost nothing');
  assert.ok(s.state.map.objects[s.mon.id], 'monster still there');
  adv.useFallbackDeps();
});
