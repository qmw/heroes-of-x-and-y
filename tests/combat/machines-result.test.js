// War machines, retreat / surrender, CombatResult mapping, AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLegalActions, performAction, getResult, autoResolve, isOver, applyDamage, resurrectStack, summonStack, getSurrenderCost } from '../../src/engine/combat/index.js';
import { ABILITIES } from '../../src/data/abilities.js';
import { checkBattleEnd } from '../../src/engine/combat/result.js';
import { battle, hero, A, D, machine, place, activate, act, has, damageTo } from './helpers.js';

test('ballista: damage x (hero attack + 1), random target without Artillery', () => {
  const cs = battle([['pikeman', 1]], [['crusader', 99]], { heroA: hero({ attack: 5 }), machinesA: ['ballista'] });
  const b = machine(cs, 'attacker', 'ballista');
  assert.equal(b.attack, 15, 'the hero Attack is added to the machine Attack as well');
  const ev = [...cs.startEvents];
  for (let i = 0; i < 10 && !has(ev, 'shoot'); i++) ev.push(...act(cs, { type: 'defend' }));
  // 3 * 6 = 18; the crusaders defended first (defense 12 + floor(12/5) = 14): attack 15 vs 14 = +5% -> 18.9
  assert.equal(damageTo(ev, D(cs))[0].amount, 18);
  assert.equal(b.shots, 23);
});

test('Artillery: player control, two shots, double damage chance', () => {
  const art = hero({ attack: 9, bonuses: [{ type: 'artillery', control: true, shots: 2, doubleDamagePercent: 50 }] });
  const cs = battle([['pikeman', 1]], [['pikeman', 99]], { heroA: art, machinesA: ['ballista'], chance: { artillery: true } });
  const b = machine(cs, 'attacker', 'ballista');
  activate(cs, b);
  const legal = getLegalActions(cs);
  assert.deepEqual(legal.shots, [D(cs).id]);
  assert.equal(legal.canWait, false);
  const ev = act(cs, { type: 'shoot', targetId: D(cs).id });
  // base 3 * (9 + 1) = 30; Attack 10 + 9 (hero) vs Defense 5: +70%; Artillery double damage is
  // another +100% in the same sum (original formula): 30 * 2.7 = 81; machines have no range penalty
  assert.deepEqual(damageTo(ev, D(cs)).map((e) => e.amount), [81, 81]);
});

test('first aid tent heals the top creature only; First Aid gives control and a bigger roll', () => {
  const cs = battle([['pikeman', 10]], [['imp', 1]], { machinesA: ['first_aid_tent'], forceRolls: [0.99] });
  A(cs).hp = 1; A(cs).count = 5;
  const tent = machine(cs, 'attacker', 'first_aid_tent');
  const evs = [...cs.startEvents];
  for (let i = 0; i < 10 && !has(evs, 'heal'); i++) evs.push(...act(cs, { type: 'defend' }));
  assert.ok(has(evs, 'ability', (e) => e.stackId === tent.id));
  assert.deepEqual([A(cs).hp, A(cs).count], [10, 5]);
  const fa = battle([['crusader', 10]], [['imp', 1]], { machinesA: ['first_aid_tent'], heroA: hero({ bonuses: [{ type: 'first_aid', control: true, healMin: 1, healMax: 75 }] }), forceRolls: [0.5] });
  A(fa).hp = 1;
  activate(fa, machine(fa, 'attacker', 'first_aid_tent'));
  assert.deepEqual(getLegalActions(fa).heals, [A(fa).id]);
  act(fa, { type: 'heal', targetId: A(fa).id });
  assert.equal(A(fa).hp, 35); // 1 + min(38, 34)
});

test('ammo cart: friendly shooters keep their ammunition while it stands', () => {
  const cs = battle([['archer', 10]], [['pikeman', 99]], { machinesA: ['ammo_cart'] });
  activate(cs, A(cs));
  act(cs, { type: 'shoot', targetId: D(cs).id });
  assert.equal(A(cs).shots, 12);
  applyDamage(cs, machine(cs, 'attacker', 'ammo_cart'), 999, {}, []);
  activate(cs, A(cs));
  act(cs, { type: 'shoot', targetId: D(cs).id });
  assert.equal(A(cs).shots, 11);
});

test('catapult and Cyclops siege attacks are delegated to siege.js (details: siege*.test.js)', () => {
  const cs = battle([['cyclops', 5]], [['imp', 5]], { siege: { fortLevel: 1, faction: 'castle', buildings: [] } });
  assert.ok(machine(cs, 'attacker', 'catapult'));
  activate(cs, A(cs));
  assert.ok(getLegalActions(cs).siegeTargets.some((t) => t.targetId === 'gate'));
  assert.deepEqual(performAction(cs, { type: 'siege_attack', targetId: 1 }), { ok: false, error: 'bad_target' });
});

test('retreat: hero flees, army lost, enemy wins; forbidden by Shackles and for a siege defender without tunnel', () => {
  const cs = battle([['pikeman', 10]], [['imp', 5]], { heroA: hero({ mana: 7 }), heroD: hero() });
  activate(cs, A(cs));
  assert.equal(getLegalActions(cs).canRetreat, true);
  const ev = act(cs, { type: 'retreat' });
  assert.ok(has(ev, 'combat_end', (e) => e.winner === 'defender' && e.reason === 'retreat'));
  const r = getResult(cs);
  assert.equal(r.attacker.heroFled, true);
  assert.deepEqual(r.attacker.army, [null, null, null, null, null, null, null]);
  assert.deepEqual(r.attacker.losses, { pikeman: 10 });
  assert.equal(r.attacker.manaLeft, 7);
  assert.equal(r.expDefender, 500);
  assert.equal(r.capturedArtifacts, false);
  const shackles = battle([['pikeman', 10]], [['imp', 5]], { heroA: hero(), heroD: hero({ bonuses: [{ type: 'no_retreat', side: 'both' }] }) });
  activate(shackles, A(shackles));
  assert.equal(getLegalActions(shackles).canRetreat, false);
  assert.deepEqual(performAction(shackles, { type: 'retreat' }), { ok: false, error: 'cannot_retreat' });
  const siege = battle([['pikeman', 10]], [['imp', 5]], { heroA: hero(), heroD: hero(), siege: { fortLevel: 1, faction: 'castle', buildings: [] } });
  activate(siege, D(siege));
  assert.equal(getLegalActions(siege).canRetreat, false);
  const tunnel = battle([['pikeman', 10]], [['imp', 5]], { heroD: hero(), siege: { fortLevel: 1, faction: 'castle', buildings: ['castle_escape_tunnel'] } });
  activate(tunnel, D(tunnel));
  assert.equal(getLegalActions(tunnel).canRetreat, true);
  const noHero = battle([['pikeman', 10]], [['imp', 5]]);
  assert.equal(getLegalActions(noHero).canRetreat, false);
});

test('surrender: full gold value of the army, Diplomacy discount, keeps the army, needs an enemy hero and gold', () => {
  const dip = hero({ bonuses: [{ type: 'diplomacy', surrenderDiscountPercent: 40 }, { type: 'surrender_cost_percent', percent: -10 }] });
  const cs = battle([['pikeman', 10], ['archer', 5]], [['imp', 5]], { heroA: dip, heroD: hero() });
  assert.equal(getSurrenderCost(cs, 'attacker'), 550); // 600 + 500 = 1100, -40% -10% (original: full cost)
  activate(cs, A(cs));
  act(cs, { type: 'surrender' });
  const r = getResult(cs);
  assert.equal(r.winner, 'defender');
  assert.equal(r.surrenderCost, 550);
  assert.equal(r.attacker.heroSurrendered, true);
  assert.deepEqual(r.attacker.army[0], { creatureId: 'pikeman', count: 10 });
  const broke = battle([['pikeman', 10]], [['imp', 5]], { heroA: hero(), heroD: hero(), sideA: { gold: 100 } });
  activate(broke, A(broke));
  assert.equal(getLegalActions(broke).canSurrender, false);
  const neutral = battle([['pikeman', 10]], [['imp', 5]], { heroA: hero() });
  activate(neutral, A(neutral));
  assert.equal(getLegalActions(neutral).canSurrender, false);
});

test('result: survivors per slot, temporary raises removed, summons gone, raised demons join, experience', () => {
  const cs = battle([null, ['pikeman', 20], ['pit_lord', 10], ['imp', 30]], [['crusader', 2]], { heroD: hero() });
  const pike = A(cs, 0);
  pike.count = 10;
  resurrectStack(cs, pike, 50, { permanent: false }); // +5 temporary
  summonStack(cs, 'attacker', 'air_elemental', 5);
  applyDamage(cs, A(cs, 2), 9999, {}, []); // imps die
  activate(cs, A(cs, 1));
  act(cs, { type: 'ability', ability: 'raise_demons', targetId: A(cs, 2).id });
  applyDamage(cs, D(cs), 9999, {}, []);
  checkBattleEnd(cs, []);
  assert.equal(isOver(cs), true);
  const r = getResult(cs);
  assert.equal(r.winner, 'attacker');
  assert.deepEqual(r.attacker.army, [{ creatureId: 'demon', count: 3 }, { creatureId: 'pikeman', count: 10 }, { creatureId: 'pit_lord', count: 10 }, null, null, null, null]); // new stacks take the first free slot
  assert.deepEqual(r.attacker.losses, { pikeman: 10, imp: 30 });
  assert.equal(r.expAttacker, 2 * 35 + 500);
  assert.equal(r.expDefender, 0);
  assert.equal(r.capturedArtifacts, true);
  assert.deepEqual(r.attacker.killedEnemies, [{ creatureId: 'crusader', count: 2, hp: 35, living: true, summoned: false }]);
  assert.equal(r.attacker.killedHp, 70);
  assert.equal(r.defender.killedCount, 40);
  assert.deepEqual(r.defender.army, [null, null, null, null, null, null, null]);
});

test('result: destroyed war machines are reported; both sides wiped is a draw', () => {
  const cs = battle([['pikeman', 10]], [['imp', 1]], { machinesA: ['ballista', 'first_aid_tent'] });
  applyDamage(cs, machine(cs, 'attacker', 'ballista'), 9999, {}, []);
  applyDamage(cs, D(cs), 9999, {}, []);
  activate(cs, A(cs));
  performAction(cs, { type: 'defend' });
  assert.equal(isOver(cs), true);
  assert.deepEqual(getResult(cs).attacker.warMachinesLost, ['ballista']);
  const draw = battle([['automaton', 1]], [['imp', 1]]);
  place(A(draw), 5, 5); place(D(draw), 6, 5);
  applyDamage(draw, A(draw), 999, {}, []); // explodes and kills the imp
  checkBattleEnd(draw, []);
  assert.equal(getResult(draw).winner, 'draw');
});

test('AI: autoResolve ends every battle; the stronger army wins; round cap gives the defender the win', () => {
  const strong = battle([['angel', 5]], [['peasant', 50]]);
  const r = autoResolve(strong);
  assert.equal(r.winner, 'attacker');
  assert.ok(r.rounds <= 5);
  const shooters = battle([['archer', 20]], [['pikeman', 10]]);
  assert.equal(performAction(shooters, { type: 'auto' }).events.some((e) => e.type === 'shoot' || e.type === 'move'), true);
  const stuck = battle([['pikeman', 10]], [['imp', 10]], { obstacles: [{ kind: 'boulder', hexes: Array.from({ length: 11 }, (_, y) => ({ x: 7, y })) }] });
  const r2 = autoResolve(stuck, { maxRounds: 5 });
  assert.equal(r2.winner, 'defender');
  assert.equal(r2.reason, 'timeout');
});

test('every registered ability has a combat test or a documented non-combat role', async () => {
  const fs = await import('node:fs');
  const dir = new URL('.', import.meta.url);
  const src = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => fs.readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const doc = fs.readFileSync(new URL('../../docs/mechanics/combat.md', import.meta.url), 'utf8');
  const missing = Object.keys(ABILITIES).filter((id) => !src.includes(id) && !src.includes(id.replace(/_/g, ' ')));
  // abilities only used through tags or creatures are exercised indirectly; the doc lists them
  for (const id of missing) assert.ok(doc.includes(`\`${id}\``), `ability ${id} neither tested nor documented`);
});
