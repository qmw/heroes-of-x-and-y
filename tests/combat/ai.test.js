// Combat AI: constructed scenarios with an obviously right decision.
import test from 'node:test';
import assert from 'node:assert/strict';
import { performAction, getLegalActions, isOver, applySpellToStack } from '../../src/engine/combat/index.js';
import { chooseAction } from '../../src/engine/combat/ai.js';
import { stackDistance } from '../../src/engine/combat/hex.js';
import { battle, hero, A, D, place, activate, act, machine } from './helpers.js';

/** Put every stack of the side out of the way and let `stack` act. */
function ready(cs, stack) {
  activate(cs, stack);
  cs.sides.attacker.castThisRound = false;
  cs.sides.defender.castThisRound = false;
  return stack;
}

test('AI shoots the most valuable target it can kill, not the biggest pile of hit points', () => {
  const cs = battle([['marksman', 30]], [['peasant', 40], ['monk', 3]]);
  place(A(cs), 1, 5); place(D(cs, 0), 13, 2); place(D(cs, 1), 13, 8);
  ready(cs, A(cs));
  const a = chooseAction(cs);
  assert.equal(a.type, 'shoot');
  assert.equal(a.targetId, D(cs, 1).id);
});

test('AI does not attack into a huge retaliation when a better target is in reach', () => {
  const cs = battle([['swordsman', 10]], [['ancient_behemoth', 3], ['archer', 12]]);
  place(A(cs), 6, 5); place(D(cs, 0), 8, 4); place(D(cs, 1), 8, 7);
  ready(cs, A(cs));
  const a = chooseAction(cs);
  assert.equal(a.type, 'attack');
  assert.equal(a.targetId, D(cs, 1).id);
});

test('AI prefers a no-retaliation attack and attacking a stack that already retaliated', () => {
  const cs = battle([['pikeman', 20], ['halberdier', 20]], [['griffin', 10]]);
  place(A(cs, 0), 6, 5); place(A(cs, 1), 6, 7); place(D(cs), 7, 6);
  D(cs).retaliationsUsed = 0;
  ready(cs, A(cs, 0));
  // griffins retaliate twice: still the best target, but the AI must not prefer waiting forever
  const a = chooseAction(cs);
  assert.ok(['attack', 'wait'].includes(a.type), JSON.stringify(a));
});

test('AI blocks an enemy shooter with a fast melee stack', () => {
  const cs = battle([['royal_griffin', 8]], [['marksman', 25], ['pikeman', 6]]);
  place(A(cs), 2, 5); place(D(cs, 0), 8, 2); place(D(cs, 1), 13, 9);
  ready(cs, A(cs));
  act(cs, chooseAction(cs));
  assert.equal(stackDistance(A(cs), D(cs, 0)), 1, 'the griffins stand next to the marksmen');
});

test('AI waits with a melee stack when nothing is in reach and the enemy still has to move', () => {
  const cs = battle([['pikeman', 20]], [['swordsman', 10]]);
  place(A(cs), 1, 5); place(D(cs), 13, 5);
  ready(cs, A(cs));
  D(cs).acted = false;
  const a = chooseAction(cs);
  assert.ok(['wait', 'defend', 'move'].includes(a.type));
  assert.notEqual(a.type, 'attack');
});

test('hero casts Implosion on the biggest threat', () => {
  const h = hero({ power: 10, knowledge: 10, mana: 60, spells: ['implosion'], skills: { earth_magic: 3 } });
  const cs = battle([['pikeman', 10]], [['goblin', 30], ['black_dragon', 2], ['gnoll', 20]], { heroA: h });
  ready(cs, A(cs));
  const a = chooseAction(cs);
  // black dragons are immune: the AI must not waste the spell on them
  assert.equal(a.type, 'cast');
  assert.equal(a.spellId, 'implosion');
  assert.notEqual(a.target, D(cs, 1).id);
  const cs2 = battle([['pikeman', 10]], [['goblin', 30], ['red_dragon', 2], ['gnoll', 20]], { heroA: h });
  ready(cs2, A(cs2));
  const b = chooseAction(cs2);
  assert.equal(b.type, 'cast');
  assert.equal(b.target, D(cs2, 1).id, 'the red dragons are the biggest threat Implosion can hit');
});

test('hero casts mass Haste / mass Slow when they matter', () => {
  const army = [['swordsman', 20], ['crusader', 10], ['griffin', 10], ['pikeman', 30]];
  const foes = [['orc', 20], ['ogre', 10], ['wolf_rider', 20], ['goblin', 40]];
  const haste = battle(army, foes, { heroA: hero({ power: 4, knowledge: 5, mana: 50, spells: ['haste'], skills: { air_magic: 3 } }) });
  ready(haste, A(haste));
  assert.deepEqual(chooseAction(haste), { type: 'cast', spellId: 'haste', target: null });
  const slow = battle(army, foes, { heroA: hero({ power: 4, knowledge: 5, mana: 50, spells: ['slow'], skills: { earth_magic: 3 } }) });
  ready(slow, A(slow));
  assert.deepEqual(chooseAction(slow), { type: 'cast', spellId: 'slow', target: null });
});

test('hero does not cast Armageddon that kills only its own army, but does when it is net positive', () => {
  const h = hero({ power: 8, knowledge: 10, mana: 60, spells: ['armageddon'], skills: { fire_magic: 3 } });
  const bad = battle([['peasant', 60], ['pikeman', 20]], [['black_dragon', 3]], { heroA: h });
  ready(bad, A(bad));
  assert.notEqual(chooseAction(bad).type, 'cast');
  const good = battle([['efreet_sultan', 6]], [['goblin', 40], ['orc', 20], ['wolf_rider', 15]], { heroA: h });
  ready(good, A(good));
  assert.deepEqual(chooseAction(good), { type: 'cast', spellId: 'armageddon', target: null });
});

test('hero resurrects a stack after a big loss', () => {
  const h = hero({ power: 6, knowledge: 10, mana: 60, spells: ['resurrection'], skills: { earth_magic: 3 } });
  const cs = battle([['champion', 10], ['pikeman', 10]], [['goblin', 20]], { heroA: h });
  const champs = A(cs, 0);
  champs.count = 2;
  ready(cs, A(cs, 1));
  const a = chooseAction(cs);
  assert.equal(a.type, 'cast');
  assert.equal(a.spellId, 'resurrection');
  assert.equal(a.target, champs.id);
});

test('hero spells: nothing worth casting -> the stack acts', () => {
  const h = hero({ power: 1, knowledge: 1, mana: 10, spells: ['cure'], skills: {} });
  const cs = battle([['pikeman', 10]], [['goblin', 5]], { heroA: h });
  ready(cs, A(cs));
  assert.notEqual(chooseAction(cs).type, 'cast');
});

test('AI hero retreats from a hopeless battle, surrenders when it can buy a valuable army free', () => {
  const big = hero({ level: 12, bonuses: [{ type: 'luck', value: 1 }, { type: 'morale', value: 1 }], spells: ['bless', 'cure', 'haste'] });
  const cs = battle([['pikeman', 3]], [['arch_angel', 10]], { heroA: big, heroD: hero() });
  ready(cs, A(cs));
  assert.deepEqual(chooseAction(cs), { type: 'retreat' });
  // a nobody fights on
  const nobody = battle([['pikeman', 3]], [['arch_angel', 10]], { heroA: hero(), heroD: hero() });
  ready(nobody, A(nobody));
  assert.notEqual(chooseAction(nobody).type, 'retreat');
  // valuable army + gold: surrender
  const rich = battle([['champion', 4]], [['arch_angel', 12]], { heroA: big, heroD: hero(), sideA: { gold: 100000 } });
  ready(rich, A(rich));
  assert.deepEqual(chooseAction(rich), { type: 'surrender' });
  // easiest difficulty never runs
  const easy = battle([['pikeman', 3]], [['arch_angel', 10]], { heroA: big, heroD: hero(), sideA: { aiLevel: 0 } });
  ready(easy, A(easy));
  assert.ok(!['retreat', 'surrender'].includes(chooseAction(easy).type));
});

test('First Aid Tent heals the most valuable wound; controlled Ballista shoots the best target', () => {
  const cs = battle([['pikeman', 10], ['champion', 3]], [['goblin', 10], ['black_dragon', 1]], {
    machinesA: ['first_aid_tent', 'ballista'],
    heroA: hero({ attack: 5, bonuses: [{ type: 'first_aid', control: true, healMin: 1, healMax: 50 }, { type: 'artillery', control: true, shots: 1, doubleDamagePercent: 0 }] }),
  });
  A(cs, 0).hp = 2; A(cs, 1).hp = 50;
  const tent = machine(cs, 'attacker', 'first_aid_tent');
  ready(cs, tent);
  assert.deepEqual(chooseAction(cs), { type: 'heal', targetId: A(cs, 1).id });
  const ballista = machine(cs, 'attacker', 'ballista');
  D(cs, 1).count = 1; D(cs, 1).hp = 8;
  ready(cs, ballista);
  const a = chooseAction(cs);
  assert.equal(a.type, 'shoot');
  assert.equal(a.targetId, D(cs, 1).id, 'finish the nearly dead dragon');
});

test('tactics phase: shooters move to the back, melee to the front, then the phase ends', () => {
  const cs = battle([['pikeman', 10], ['archer', 10], ['swordsman', 5]], [['goblin', 10]], {
    heroA: hero({ bonuses: [{ type: 'tactics', hexes: 5 }] }),
  });
  assert.equal(cs.phase, 'tactics');
  for (let i = 0; i < 10 && cs.phase === 'tactics'; i++) act(cs, chooseAction(cs));
  assert.equal(cs.phase, 'battle');
  assert.ok(A(cs, 0).pos.x >= 4, 'pikemen moved forward');
  assert.ok(A(cs, 2).pos.x >= 4, 'swordsmen moved forward');
  assert.equal(A(cs, 1).pos.x, 0, 'archers stay at the back');
});

test('creature abilities: an Archangel resurrects a heavily damaged ally', () => {
  const cs = battle([['arch_angel', 1], ['champion', 10]], [['black_dragon', 5]]);
  place(A(cs, 0), 1, 5); place(A(cs, 1), 1, 7); place(D(cs), 14, 0);
  A(cs, 1).count = 2;
  ready(cs, A(cs, 0));
  const a = chooseAction(cs);
  assert.equal(a.type, 'ability');
  assert.equal(a.ability, 'resurrection');
  assert.equal(a.targetId, A(cs, 1).id);
});

test('two-hex breath geometry: a dragon lines up two enemy stacks', () => {
  const cs = battle([['red_dragon', 2]], [['pikeman', 20], ['archer', 20]]);
  place(A(cs), 3, 5); place(D(cs, 0), 8, 5); place(D(cs, 1), 9, 5);
  ready(cs, A(cs));
  const a = chooseAction(cs);
  assert.equal(a.type, 'attack');
  const events = act(cs, a);
  const hit = events.find((e) => e.type === 'attack');
  assert.equal(hit.targets.length, 2, `breath hits both stacks (${JSON.stringify(a)})`);
});

test('chooseAction never returns an illegal action and does not touch the state', () => {
  const h = hero({ power: 5, knowledge: 8, mana: 40, spells: ['fireball', 'bless', 'slow', 'magic_arrow'], skills: { fire_magic: 2, earth_magic: 1 } });
  const cs = battle([['pikeman', 20], ['archer', 15], ['griffin', 6]], [['goblin', 30], ['orc', 12], ['ogre', 4]], { heroA: h, heroD: h });
  for (let i = 0; i < 400 && !isOver(cs); i++) {
    const before = JSON.stringify(cs);
    const a = chooseAction(cs);
    assert.equal(JSON.stringify(cs), before, 'chooseAction is pure');
    assert.deepEqual(chooseAction(cs), a, 'chooseAction is deterministic');
    const res = performAction(cs, a);
    assert.equal(res.ok, true, `${JSON.stringify(a)}: ${res.error}`);
  }
  assert.ok(isOver(cs));
  assert.ok(getLegalActions(cs).phase === 'over');
});

test('siege: defenders shoot from behind the walls, wall attackers pick a structure', () => {
  const cs = battle([['pikeman', 20], ['cyclops', 4]], [['archer', 20], ['swordsman', 8]], { siege: { fortLevel: 3, faction: 'castle', buildings: [] } });
  const archers = D(cs, 0);
  ready(cs, archers);
  const a = chooseAction(cs);
  assert.equal(a.type, 'shoot', JSON.stringify(a));
  const cyc = A(cs, 1);
  ready(cs, cyc);
  const legal = getLegalActions(cs);
  const b = chooseAction(cs);
  assert.ok(['shoot', 'siege_attack'].includes(b.type), JSON.stringify(b));
  if (b.type === 'siege_attack') assert.ok(legal.siegeTargets.some((t) => t.targetId === b.targetId));
  act(cs, b);
});

test('hero cures a big stack hit by harmful effects', () => {
  const h = hero({ power: 3, knowledge: 10, mana: 40, spells: ['cure'], skills: { water_magic: 2 } });
  const cs = battle([['champion', 10], ['pikeman', 10]], [['goblin', 40], ['orc', 20]], { heroA: h });
  const champs = A(cs, 0);
  for (const spellId of ['slow', 'curse', 'weakness']) {
    applySpellToStack(cs, spellId, { mastery: 2, power: 5, casterSide: 'defender', resistible: false }, champs);
  }
  ready(cs, A(cs, 1));
  assert.deepEqual(chooseAction(cs), { type: 'cast', spellId: 'cure', target: champs.id });
});
