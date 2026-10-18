import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLegalActions, performAction, describeTurnOrder, getStackInfo, getActiveStack, isOver,
} from '../../src/engine/combat/index.js';
import { battle, hero, A, D, place, activate, act, has, melee, firstDamage } from './helpers.js';

const ATT = [['pikeman', 10], ['archer', 10], ['griffin', 5]]; // speeds 4, 4, 6
const DEF = [['imp', 10], ['gog', 10]]; // speeds 5, 4

function playOrder(cs, n, action = { type: 'defend' }) {
  const order = [];
  for (let i = 0; i < n; i++) {
    order.push(getActiveStack(cs).creatureId);
    act(cs, action);
  }
  return order;
}

test('turn order: speed first; ties alternate sides starting with the attacker, then slot order', () => {
  const cs = battle(ATT, DEF);
  assert.deepEqual(describeTurnOrder(cs).slice(0, 5).map((r) => r.creatureId), ['griffin', 'imp', 'pikeman', 'gog', 'archer']);
  assert.equal(describeTurnOrder(cs)[0].phase, 'active');
  assert.deepEqual(describeTurnOrder(cs).slice(5).map((r) => [r.creatureId, r.phase]),
    [['griffin', 'next_round'], ['imp', 'next_round'], ['pikeman', 'next_round'], ['gog', 'next_round'], ['archer', 'next_round']]);
  assert.deepEqual(playOrder(cs, 5), ['griffin', 'imp', 'pikeman', 'gog', 'archer']);
  assert.equal(cs.round, 2);
  assert.deepEqual(playOrder(cs, 5), ['griffin', 'imp', 'pikeman', 'gog', 'archer']);
  assert.equal(cs.round, 3);
});

test('equal speed on both sides: attacker moves first', () => {
  const cs = battle([['pikeman', 1], ['pikeman', 1]], [['pikeman', 1], ['pikeman', 1]]);
  const ids = playOrder(cs, 4).length && cs.stacks.map((s) => s.id);
  assert.deepEqual(ids, [1, 2, 3, 4]);
  const cs2 = battle([['pikeman', 1], ['pikeman', 1]], [['pikeman', 1], ['pikeman', 1]]);
  const sides = [];
  for (let i = 0; i < 4; i++) { sides.push(getActiveStack(cs2).side); act(cs2, { type: 'defend' }); }
  assert.deepEqual(sides, ['attacker', 'defender', 'attacker', 'defender']);
});

test('wait: the stack acts after everyone else, waiters in reverse speed order; no second wait', () => {
  const cs = battle(ATT, DEF);
  act(cs, { type: 'wait' }); // griffin (6)
  act(cs, { type: 'wait' }); // imp (5)
  assert.deepEqual(playOrder(cs, 3), ['pikeman', 'gog', 'archer']);
  assert.equal(cs.round, 1);
  assert.equal(getActiveStack(cs).creatureId, 'imp'); // slower waiter first
  assert.deepEqual(getLegalActions(cs).canWait, false);
  assert.deepEqual(performAction(cs, { type: 'wait' }), { ok: false, error: 'cannot_wait' });
  assert.deepEqual(describeTurnOrder(cs).slice(0, 2).map((r) => [r.creatureId, r.phase]), [['imp', 'active'], ['griffin', 'waited']]);
  act(cs, { type: 'defend' });
  assert.equal(getActiveStack(cs).creatureId, 'griffin');
  act(cs, { type: 'defend' });
  assert.equal(cs.round, 2);
  assert.equal(getActiveStack(cs).creatureId, 'griffin');
});

test('speed changes re-sort the remaining queue (Slow / Haste)', async () => {
  const { addStatus } = await import('../../src/engine/combat/index.js');
  const cs = battle(ATT, DEF);
  addStatus(cs, A(cs, 2), 'slow', { mastery: 2, casterSide: 'defender', rounds: 3 }); // griffin 6 -> 3
  addStatus(cs, D(cs, 1), 'haste', { mastery: 2, casterSide: 'defender', rounds: 3 }); // gog 4 -> 9
  assert.equal(getStackInfo(cs, A(cs, 2).id).speed, 3);
  assert.equal(getStackInfo(cs, D(cs, 1).id).speed, 9);
  act(cs, { type: 'defend' }); // griffin was already active
  assert.deepEqual(playOrder(cs, 4), ['gog', 'imp', 'pikeman', 'archer']);
  assert.deepEqual(playOrder(cs, 5), ['gog', 'imp', 'pikeman', 'archer', 'griffin']);
});

test('defend: +20% of defense (rounded down, at least 1) until the next own turn', () => {
  const cs = battle([['pikeman', 10], ['crusader', 10], ['gremlin', 10], ['evil_eye', 10], ['black_dragon', 1]], [['imp', 10]]);
  const [pike, crus, grem, eye, bd] = [A(cs, 0), A(cs, 1), A(cs, 2), A(cs, 3), A(cs, 4)];
  for (const s of [pike, crus, grem, eye, bd]) { activate(cs, s); act(cs, { type: 'defend' }); }
  assert.equal(getStackInfo(cs, pike.id).defense, 6); // 5 + floor(1.0)
  assert.equal(getStackInfo(cs, crus.id).defense, 14); // 12 + floor(2.4)
  assert.equal(getStackInfo(cs, grem.id).defense, 4); // 3 + max(1, floor(0.6))
  assert.equal(getStackInfo(cs, eye.id).defense, 9); // 8 + floor(1.6) (not rounded to 2)
  assert.equal(getStackInfo(cs, bd.id).defense, 30); // 25 + floor(5.0)
  assert.equal(pike.defending, true);
  while (getActiveStack(cs).id !== pike.id) act(cs, { type: 'defend' });
  assert.equal(pike.defending, false);
  assert.equal(getStackInfo(cs, pike.id).defense, 5);
});

test('good morale: one extra action after acting, never after defend or wait', () => {
  const cs = battle([['pikeman', 10]], [['imp', 10]], { chance: { morale: true } });
  const pike = getActiveStack(cs);
  assert.equal(pike.creatureId, 'imp'); // imp is faster
  const imp = pike;
  let events = act(cs, { type: 'move', to: { x: 12, y: 5 } });
  assert.ok(has(events, 'morale', (e) => e.good && e.stackId === imp.id));
  assert.ok(has(events, 'turn_start', (e) => e.extra));
  assert.equal(getActiveStack(cs).id, imp.id);
  events = act(cs, { type: 'move', to: { x: 10, y: 5 } });
  assert.ok(!has(events, 'morale'), 'only one morale action per turn');
  assert.equal(getActiveStack(cs).id, A(cs).id);
  events = act(cs, { type: 'defend' });
  assert.ok(!has(events, 'morale'));
  assert.equal(getActiveStack(cs).id, imp.id);
  events = act(cs, { type: 'wait' });
  assert.ok(!has(events, 'morale'));
});

test('morale probabilities: +1/24 per point for an extra action, 1/12 per point to freeze', () => {
  // single-faction army: morale +1 -> 1/24 = 0.041666
  for (const [rollValue, expected] of [[0.041, true], [0.042, false]]) {
    const cs = battle([['pikeman', 10]], [['gremlin', 10]], { chance: { morale: undefined }, forceRolls: [rollValue] });
    assert.equal(getStackInfo(cs, A(cs).id).morale, 1);
    const events = act(cs, { type: 'move', to: { x: 2, y: 5 } });
    assert.equal(has(events, 'morale', (e) => e.good), expected);
  }
  // three factions: morale -1 -> 1/12 = 0.08333
  for (const [rollValue, expected] of [[0.083, true], [0.084, false]]) {
    const cs = battle([['centaur', 10], ['gremlin', 10], ['imp', 10]], [['peasant', 10]], { chance: { bad_morale: undefined }, forceRolls: [rollValue] });
    assert.equal(has(cs.startEvents, 'morale', (e) => !e.good), expected);
    assert.equal(has(cs.startEvents, 'turn_skipped', (e) => e.reason === 'morale'), expected);
    assert.equal(getActiveStack(cs).creatureId, expected ? 'imp' : 'centaur');
  }
});

test('morale sources: auras, hero bonuses, clamps, undead and machines are neutral', () => {
  const info = (cs, s) => getStackInfo(cs, s.id);
  let cs = battle([['pikeman', 5], ['angel', 1]], [['imp', 5], ['bone_dragon', 1]]);
  assert.equal(info(cs, A(cs, 0)).morale, 1 + 1 - 1); // one faction, angel, enemy bone dragon
  assert.equal(info(cs, D(cs, 0)).morale, -1); // two factions with undead: 0 - 1
  assert.equal(info(cs, D(cs, 1)).morale, 0); // undead
  cs = battle([['pikeman', 5], ['angel', 1], ['arch_angel', 1]], [['imp', 5]]);
  assert.equal(info(cs, A(cs, 0)).morale, 2, 'the angel aura does not stack');
  cs = battle([['minotaur', 5], ['centaur', 5], ['gremlin', 5], ['imp', 5]], [['stone_golem', 5]], { machinesA: ['ballista'] });
  assert.equal(info(cs, A(cs, 1)).morale, -2);
  assert.equal(info(cs, A(cs, 0)).morale, 1, 'minotaurs always have positive morale');
  assert.equal(info(cs, D(cs, 0)).morale, 0, 'golems are non-living');
  assert.equal(info(cs, cs.stacks.find((s) => s.warMachine)).morale, 0);
  cs = battle([['pikeman', 5]], [['imp', 5]], {
    heroA: hero({ bonuses: [{ type: 'morale', value: 5 }] }), heroD: hero({ bonuses: [{ type: 'enemy_morale', value: -1 }] }) });
  assert.equal(info(cs, A(cs)).morale, 3, 'clamped to +3');
  cs = battle([['pikeman', 5]], [['imp', 5]], { heroD: hero({ bonuses: [{ type: 'enemy_morale', value: -2 }] }) });
  assert.equal(info(cs, A(cs)).morale, -1);
  cs = battle([['pikeman', 5]], [['imp', 5]], { heroD: hero({ bonuses: [{ type: 'block_positive_morale', side: 'both' }] }) });
  assert.equal(info(cs, A(cs)).morale, 0);
  assert.equal(info(cs, D(cs)).morale, 0);
});

test('luck sources: hero, devils, halflings, clamps, Hourglass', () => {
  const info = (cs, s) => getStackInfo(cs, s.id);
  let cs = battle([['pikeman', 5], ['halfling', 5]], [['devil', 1]], { heroA: hero({ bonuses: [{ type: 'luck', value: 1 }] }) });
  assert.equal(info(cs, A(cs, 0)).luck, 0); // +1 hero, -1 devil
  assert.equal(info(cs, A(cs, 1)).luck, 1); // halflings: at least +1
  assert.equal(info(cs, D(cs)).luck, 0);
  cs = battle([['pikeman', 5]], [['imp', 1]], { heroA: hero({ bonuses: [{ type: 'luck', value: 7 }] }), heroD: hero({ bonuses: [{ type: 'enemy_luck', value: -2 }] }) });
  assert.equal(info(cs, A(cs)).luck, 3);
  cs = battle([['pikeman', 5]], [['imp', 1]], { sideA: { luck: 2 }, heroD: hero({ bonuses: [{ type: 'block_positive_luck', side: 'both' }] }) });
  assert.equal(info(cs, A(cs)).luck, 0);
  cs = battle([['pikeman', 5]], [['imp', 1]], { sideA: { luck: -5 }, machinesA: ['ballista'] });
  assert.equal(info(cs, A(cs)).luck, -3);
  assert.equal(info(cs, cs.stacks.find((s) => s.warMachine)).luck, 0);
});

test('luck rolls: 1/24 per point for double damage, 1/12 per point for half; Leprechauns double the chance', () => {
  const run = (att, def, luck, rollValue) => {
    const cs = battle(att, def, { sideA: { luck }, chance: { luck: undefined, bad_luck: undefined }, forceRolls: [rollValue] });
    const events = melee(cs, A(cs), D(cs));
    return { lucky: events.find((e) => e.type === 'attack').lucky, dmg: firstDamage(events, D(cs)) };
  };
  // 10 crusaders (max 100) vs pikemen: +35% -> 135; lucky +100% -> 235; unlucky x0.5 -> 67
  assert.deepEqual(run([['crusader', 10]], [['pikeman', 99]], 0, 0.0), { lucky: 0, dmg: 135 });
  assert.deepEqual(run([['crusader', 10]], [['pikeman', 99]], 1, 0.041), { lucky: 1, dmg: 235 });
  assert.deepEqual(run([['crusader', 10]], [['pikeman', 99]], 1, 0.042), { lucky: 0, dmg: 135 });
  assert.deepEqual(run([['crusader', 10]], [['pikeman', 99]], 3, 0.124), { lucky: 1, dmg: 235 });
  assert.deepEqual(run([['crusader', 10]], [['pikeman', 99]], -1, 0.083), { lucky: -1, dmg: 67 });
  assert.deepEqual(run([['crusader', 10]], [['pikeman', 99]], -1, 0.084), { lucky: 0, dmg: 135 });
  assert.deepEqual(run([['crusader', 10], ['leprechaun', 1]], [['pikeman', 99]], 1, 0.083), { lucky: 1, dmg: 235 });
  assert.deepEqual(run([['crusader', 10], ['leprechaun', 1]], [['pikeman', 99]], 1, 0.084), { lucky: 0, dmg: 135 });
});

test('fear: an enemy Azure Dragon can freeze a stack; undead and Azure Dragons are immune', () => {
  const cs = battle([['pikeman', 5], ['skeleton', 5]], [['azure_dragon', 1]], { chance: { fear: true } });
  const azure = D(cs);
  assert.equal(getActiveStack(cs).id, azure.id);
  const events = act(cs, { type: 'defend' });
  assert.ok(has(events, 'turn_skipped', (e) => e.reason === 'fear' && e.stackId === A(cs, 0).id));
  assert.ok(!has(events, 'turn_skipped', (e) => e.stackId === A(cs, 1).id));
  assert.equal(getActiveStack(cs).id, A(cs, 1).id);
  assert.equal(A(cs, 0).acted, true);
  // exact chance 10%
  for (const [rollValue, feared] of [[0.099, true], [0.1, false]]) {
    const c2 = battle([['champion', 5]], [['azure_dragon', 1]], { chance: { fear: undefined }, forceRolls: [rollValue] });
    act(c2, { type: 'defend' });
    assert.equal(getActiveStack(c2).creatureId, feared ? 'azure_dragon' : 'champion');
  }
});

test('a new round resets retaliations and the hero cast flag', () => {
  const cs = battle([['pikeman', 100]], [['pikeman', 50]]);
  melee(cs, A(cs), D(cs));
  assert.equal(D(cs).retaliationsUsed, 1);
  cs.sides.attacker.castThisRound = true;
  let events = [];
  while (cs.round === 1) events = act(cs, { type: 'defend' });
  assert.ok(has(events, 'round_start', (e) => e.round === 2));
  assert.equal(D(cs).retaliationsUsed, 0);
  assert.equal(cs.sides.attacker.castThisRound, false);
});

test('tactics phase: only for a human side with a Tactics advantage', () => {
  const tactics = (hexes) => hero({ bonuses: [{ type: 'tactics', hexes }] });
  const cs = battle([['pikeman', 5], ['griffin', 2]], [['imp', 5]], { heroA: tactics(5), heroD: tactics(3) });
  assert.equal(cs.phase, 'tactics');
  assert.deepEqual(cs.tactics, { side: 'attacker', hexes: 2 });
  assert.equal(getActiveStack(cs), null);
  const legal = getLegalActions(cs);
  assert.equal(legal.phase, 'tactics');
  const pikeHexes = legal.tactics.stacks.find((s) => s.stackId === A(cs, 0).id).hexes;
  assert.ok(pikeHexes.every((h) => h.x <= 2));
  assert.ok(pikeHexes.some((h) => h.x === 2 && h.y === 0));
  assert.deepEqual(performAction(cs, { type: 'tactics_move', stackId: A(cs, 0).id, to: { x: 3, y: 5 } }), { ok: false, error: 'bad_tactics_move' });
  assert.deepEqual(performAction(cs, { type: 'tactics_move', stackId: D(cs).id, to: { x: 12, y: 5 } }), { ok: false, error: 'bad_tactics_move' });
  assert.equal(performAction(cs, { type: 'defend' }).ok, false);
  act(cs, { type: 'tactics_move', stackId: A(cs, 0).id, to: { x: 2, y: 4 } });
  assert.deepEqual(A(cs, 0).pos, { x: 2, y: 4 });
  const events = act(cs, { type: 'tactics_end' });
  assert.equal(cs.phase, 'battle');
  assert.ok(has(events, 'round_start'));
  assert.ok(getActiveStack(cs));
  // equal Tactics cancel out; an AI side skips the phase
  assert.equal(battle([['pikeman', 5]], [['imp', 5]], { heroA: tactics(3), heroD: tactics(3) }).phase, 'battle');
  assert.equal(battle([['pikeman', 5]], [['imp', 5]], { heroD: tactics(3) }).phase, 'battle');
  assert.equal(battle([['pikeman', 5]], [['imp', 5]], { heroA: tactics(3), tactics: false }).phase, 'battle');
  // {type:'auto'} ends the phase
  const auto = battle([['pikeman', 5]], [['imp', 5]], { heroA: tactics(3) });
  act(auto, { type: 'auto' });
  assert.equal(auto.phase, 'battle');
  assert.equal(isOver(auto), false);
});

test('place() helper sanity: activating a stack makes it the actor', () => {
  const cs = battle(ATT, DEF);
  const gog = activate(cs, place(D(cs, 1), 10, 5));
  assert.equal(getLegalActions(cs).stackId, gog.id);
  assert.equal(getLegalActions(cs).side, 'defender');
});
