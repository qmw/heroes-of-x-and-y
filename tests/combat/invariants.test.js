// Property checks over many seeded battles stepped one action at a time (combat/creatures audit):
// board geometry, counts / hp, turn bookkeeping, retaliation counters, dead stacks never act.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randInt, pick, rand } from '../../src/core/rng.js';
import { FACTIONS } from '../../src/core/constants.js';
import { CREATURES, creaturesOfFaction, getCreature } from '../../src/data/creatures.js';
import { createCombat, performAction, isOver, getResult } from '../../src/engine/combat/index.js';
import { stackHexes, inBounds, hexIndex } from '../../src/engine/combat/hex.js';
import { blockedHexes } from '../../src/engine/combat/state.js';
import { maxRetaliations } from '../../src/engine/combat/stats.js';
import { battle, A, D, melee, shoot, place, firstDamage } from './helpers.js';

function side(rng, i, opts = {}) {
  const pool = rand(rng) < 0.3 ? CREATURES.filter((c) => !c.warMachine) : creaturesOfFaction(pick(rng, FACTIONS));
  const army = [];
  for (let k = 0; k < 7; k++) {
    if (k >= randInt(rng, 1, 7)) { army.push(null); continue; }
    const c = pick(rng, pool);
    army.push({ creatureId: c.id, count: opts.huge ? randInt(rng, 2000, 12000) : Math.max(1, Math.round(randInt(rng, 100, 3000) / c.aiValue)) });
  }
  const hero = rand(rng) < 0.5 ? { id: `h${i}`, name: 'H', attack: randInt(rng, 0, 10), defense: randInt(rng, 0, 10), power: 2,
    knowledge: 2, mana: 20, spells: ['magic_arrow', 'slow', 'haste', 'bless'], skills: {}, bonuses: [] } : null;
  return { playerId: i, isHuman: false, hero, army, warMachines: ['ballista', 'first_aid_tent', 'ammo_cart'].filter(() => rand(rng) < 0.3) };
}

function checkBoard(cs, ctx) {
  const occupied = new Map();
  const blocked = cs.siege ? null : blockedHexes(cs);
  for (const s of cs.stacks) {
    assert.ok(Number.isInteger(s.count) && s.count >= 0, `${ctx}: count ${s.count}`);
    if (!s.alive) {
      assert.equal(s.count, 0, `${ctx}: dead stack keeps creatures`);
      assert.notEqual(cs.active, s.id, `${ctx}: a dead stack is active`);
      continue;
    }
    assert.ok(s.count > 0 && s.hp > 0 && s.hp <= s.maxHp && s.maxHp <= s.baseHp, `${ctx}: hp ${s.hp}/${s.maxHp}/${s.baseHp}`);
    if (!s.summoned) assert.ok(s.count <= Math.max(s.startCount, 1), `${ctx}: ${s.creatureId} count ${s.count} > start ${s.startCount}`);
    assert.ok(s.shots >= 0 && s.shots <= Math.max(getCreature(s.creatureId).shots * 2, 0), `${ctx}: shots ${s.shots}`);
    assert.ok(s.retaliationsUsed <= maxRetaliations(cs, s), `${ctx}: retaliations ${s.retaliationsUsed}`);
    const hexes = stackHexes(s);
    assert.equal(hexes.length, s.size);
    for (const h of hexes) {
      assert.ok(inBounds(h), `${ctx}: ${s.creatureId} out of bounds ${JSON.stringify(h)}`);
      const i = hexIndex(h);
      assert.ok(!occupied.has(i), `${ctx}: stacks ${occupied.get(i)} and ${s.id} overlap`);
      occupied.set(i, s.id);
      if (blocked) assert.ok(!blocked.has(i), `${ctx}: ${s.creatureId} stands on an obstacle`);
    }
  }
  if (cs.phase === 'battle' && cs.active !== null) {
    const a = cs.stacks.find((s) => s.id === cs.active);
    assert.ok(a && a.alive && !a.acted, `${ctx}: bad active stack`);
  }
}

/** No dead stack acts: after its `death` event a stack attacks / shoots / moves only once revived. */
function checkEvents(events, ctx) {
  const dead = new Set();
  for (const e of events) {
    if (e.type === 'death') dead.add(e.stackId);
    else if (['resurrect', 'rebirth'].includes(e.type)) dead.delete(e.stackId);
    else if (['attack', 'retaliate', 'shoot', 'move'].includes(e.type)) assert.ok(!dead.has(e.stackId), `${ctx}: dead stack ${e.stackId} did ${e.type}`);
    if (e.type === 'damage') assert.ok(e.dealt >= 0 && e.killed >= 0 && e.remaining >= 0, `${ctx}: damage event ${JSON.stringify(e)}`);
  }
}

function run(seed, opts = {}) {
  const rng = createRng(seed * 6271 + (opts.huge ? 1 : 0));
  const cs = createCombat({ seed, terrain: pick(rng, ['grass', 'dirt', 'lava', 'snow']), attacker: side(rng, 0, opts), defender: side(rng, 1, opts) });
  checkBoard(cs, `seed ${seed} start`);
  const turns = new Map();
  for (let i = 0; i < 1500 && !isOver(cs); i++) {
    const round = cs.round;
    const res = performAction(cs, { type: 'auto' });
    assert.equal(res.ok, true, `seed ${seed}: ${res.error}`);
    const ctx = `seed ${seed} step ${i}`;
    checkEvents(res.events, ctx);
    for (const e of res.events) {
      if (e.type === 'round_start') {
        // retaliation counters are refreshed with every new round
        turns.clear();
      }
      if (e.type === 'turn_start' && !e.extra && !e.resumed) {
        const k = `${e.stackId}`;
        assert.ok(!turns.has(k), `${ctx}: stack ${k} got two turns in round ${e.round}`);
        turns.set(k, true);
      }
    }
    if (cs.round > round) for (const s of cs.stacks) if (s.alive && !s.acted && !s.turnStarted) assert.ok(s.retaliationsUsed <= maxRetaliations(cs, s));
    checkBoard(cs, ctx);
    if (cs.round > 60) break;
  }
  if (isOver(cs)) {
    const r = getResult(cs);
    for (const s of ['attacker', 'defender']) for (const slot of r[s].army) if (slot) assert.ok(slot.count > 0);
  }
}

test('invariants: board, counts, hp, turns and retaliations stay consistent in 60 stepped battles', () => {
  for (let seed = 1; seed <= 60; seed++) run(seed);
});

test('invariants: huge stacks (2000-12000 creatures) keep integer, finite numbers', () => {
  for (let seed = 1; seed <= 8; seed++) run(seed, { huge: true });
});

test('retaliation counters are refreshed at every round start', () => {
  const cs = battle([['pikeman', 10], ['pikeman', 10]], [['griffin', 5]]);
  const g = D(cs);
  g.retaliationsUsed = 2;
  // finish the round: everyone defends
  for (let i = 0; i < 10 && cs.round === 1; i++) performAction(cs, { type: 'defend' });
  assert.equal(cs.round, 2);
  assert.equal(g.retaliationsUsed, 0);
});

test('edge: a single creature with 1 hp left dies to the minimum damage of 1', () => {
  const cs = battle([['peasant', 1]], [['crusader', 1]]);
  D(cs).hp = 1;
  const ev = melee(cs, A(cs), D(cs));
  assert.equal(firstDamage(ev, D(cs)), 1);
  assert.equal(D(cs).alive, false);
  assert.equal(D(cs).count, 0);
});

test('edge: 9999+ creatures: ten dice scaled by count / 10, exact integer kills', () => {
  const cs = battle([['pikeman', 12345]], [['peasant', 99999]], { damage: 'max' });
  const ev = melee(cs, A(cs), D(cs));
  // 12345 x 3 = 37035; attack 4 vs defense 1: +15% -> 42590.25
  assert.equal(firstDamage(ev, D(cs)), 42590);
  assert.equal(D(cs).count, 99999 - 42590);
  const big = battle([['azure_dragon', 9999]], [['azure_dragon', 9999]]);
  place(A(big), 5, 5); place(D(big), 7, 5);
  const e2 = melee(big, A(big), D(big), { keep: true });
  // 9999 x 80 = 799920, attack 50 vs defense 50: no modifier; 799 dragons die, the top one keeps 80 hp
  assert.equal(firstDamage(e2, D(big)), 799920);
  assert.equal(D(big).count, 9999 - 799);
  assert.equal(D(big).hp, 1000 - 920);
});

test('edge: shooting the last creature of a stack ends the battle cleanly', () => {
  const cs = battle([['archer', 50]], [['peasant', 1]]);
  place(D(cs), 8, 5);
  shoot(cs, A(cs), D(cs));
  assert.equal(isOver(cs), true);
  assert.equal(getResult(cs).winner, 'attacker');
});
