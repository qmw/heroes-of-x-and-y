import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randInt, pick, rand } from '../../src/core/rng.js';
import { FACTIONS } from '../../src/core/constants.js';
import { CREATURES, creaturesOfFaction, neutralCreatures } from '../../src/data/creatures.js';
import { COMBAT_SPELLS } from '../../src/data/spells.js';
import { createCombat, autoResolve, performAction, isOver, getResult, getLegalActions } from '../../src/engine/combat/index.js';

const BONUS_POOL = [
  { type: 'damage_percent', mode: 'melee', percent: 20 }, { type: 'damage_percent', mode: 'ranged', percent: 25 },
  { type: 'damage_reduction_percent', percent: 10 }, { type: 'morale', value: 2 }, { type: 'luck', value: 2 },
  { type: 'enemy_morale', value: -2 }, { type: 'enemy_luck', value: -2 }, { type: 'magic_resistance', percent: 20 },
  { type: 'artillery', control: true, shots: 2, doubleDamagePercent: 50 }, { type: 'first_aid', control: true, healMin: 1, healMax: 75 },
  { type: 'creature_stat', stat: 'speed', value: 1 }, { type: 'creature_stat', stat: 'hp', percent: 25, except: ['undead'] },
  { type: 'creature_regeneration', except: [] }, { type: 'raise_on_kill', creatureId: 'fangarm', except: [] },
  { type: 'resurrect_fallen', percent: 20, uses: 1 }, { type: 'no_range_penalty' }, { type: 'free_shooting' },
  { type: 'block_positive_morale', side: 'both' }, { type: 'negate_resistance', side: 'both' },
  { type: 'combat_start_cast', spellId: 'prayer', mastery: 3, power: 5, target: 'all_friendly' },
  { type: 'combat_start_cast', spellId: 'slow', mastery: 2, power: 3, target: 'all_enemies' },
  { type: 'spell_school_mastery', school: 'fire', level: 3 }, { type: 'spell_power_percent', percent: 15 },
  { type: 'spell_immunity', spellId: 'blind', side: 'own' }, { type: 'interference', percent: 20 },
];

function randomSide(rng, i) {
  const faction = pick(rng, FACTIONS);
  const pool = rand(rng) < 0.25 ? CREATURES.filter((c) => !c.warMachine) : [...creaturesOfFaction(faction), ...(rand(rng) < 0.3 ? neutralCreatures() : [])];
  const army = [];
  const n = randInt(rng, 1, 7);
  for (let k = 0; k < 7; k++) {
    if (k >= n) { army.push(null); continue; }
    const c = pick(rng, pool);
    army.push({ creatureId: c.id, count: Math.max(1, Math.round(randInt(rng, 200, 4000) / c.aiValue)) });
  }
  let hero = null;
  if (rand(rng) < 0.6) {
    const spells = [];
    for (let k = 0; k < 8; k++) spells.push(pick(rng, COMBAT_SPELLS).id);
    const bonuses = [];
    for (let k = randInt(rng, 0, 5); k > 0; k--) bonuses.push(pick(rng, BONUS_POOL));
    hero = { id: `h${i}`, name: 'H', attack: randInt(rng, 0, 12), defense: randInt(rng, 0, 12), power: randInt(rng, 1, 10),
      knowledge: randInt(rng, 1, 10), mana: randInt(rng, 0, 100), spells: [...new Set(spells)],
      skills: { air_magic: randInt(rng, 0, 3), water_magic: randInt(rng, 0, 3), earth_magic: randInt(rng, 0, 3) }, bonuses };
  }
  const warMachines = ['ballista', 'ammo_cart', 'first_aid_tent', 'cannon'].filter(() => rand(rng) < 0.4).filter((m, _, a) => !(m === 'cannon' && a.includes('ballista')));
  return { playerId: i, isHuman: false, hero, army, warMachines };
}

function assertSane(cs) {
  const json = JSON.stringify(cs);
  assert.ok(!json.includes('null,"count":null') && !/NaN/.test(json));
  assert.deepEqual(JSON.parse(json), cs, 'state must be JSON round-trippable');
  for (const s of cs.stacks) {
    for (const k of ['count', 'hp', 'maxHp', 'attack', 'defense', 'speed', 'shots']) assert.ok(Number.isFinite(s[k]), `stack.${k} = ${s[k]}`);
    assert.ok(s.count >= 0 && s.hp >= 0 && s.hp <= s.maxHp);
    if (s.alive) assert.ok(s.count > 0 && s.hp > 0, 'living stack has creatures');
  }
}

test('fuzz: 200 seeded auto-resolved battles terminate without errors', () => {
  const terrains = ['grass', 'dirt', 'snow', 'lava', 'swamp', 'sand', 'rough', 'subterranean'];
  const winners = { attacker: 0, defender: 0, draw: 0 };
  for (let seed = 1; seed <= 200; seed++) {
    const rng = createRng(seed * 7919);
    const input = { seed, terrain: pick(rng, terrains), attacker: randomSide(rng, 0), defender: randomSide(rng, 1),
      bank: seed % 17 === 0, siege: seed % 13 === 0 ? { fortLevel: 2, faction: 'castle', buildings: [] } : null };
    let cs;
    try {
      cs = createCombat(input);
      assertSane(cs);
      const result = autoResolve(cs, { maxRounds: 60 });
      assertSane(cs);
      assert.ok(isOver(cs));
      assert.ok(['attacker', 'defender', 'draw'].includes(result.winner));
      assert.ok(Number.isFinite(result.expAttacker) && Number.isFinite(result.expDefender));
      assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
      for (const side of ['attacker', 'defender']) {
        input[side].army.forEach((orig, i) => {
          const left = result[side].army[i];
          if (left && orig && left.creatureId === orig.creatureId) assert.ok(left.count <= orig.count || result[side].overflow, 'no free creatures');
        });
      }
      winners[result.winner] += 1;
    } catch (err) {
      err.message = `seed ${seed}: ${err.message}`;
      throw err;
    }
  }
  assert.ok(winners.attacker > 20 && winners.defender > 20, JSON.stringify(winners));
  assert.ok(winners.draw < 30, `too many draws: ${JSON.stringify(winners)}`);
});

test('fuzz: stepping with auto actions keeps legal actions consistent', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rng = createRng(seed * 104729);
    const cs = createCombat({ seed, terrain: 'grass', attacker: randomSide(rng, 0), defender: randomSide(rng, 1) });
    for (let i = 0; i < 3000 && !isOver(cs); i++) {
      const legal = getLegalActions(cs);
      assert.equal(legal.phase, 'battle');
      assert.ok(legal.stackId !== null, `seed ${seed}: a stack must be active while the battle runs`);
      const res = performAction(cs, { type: 'auto' });
      assert.equal(res.ok, true, `seed ${seed}: ${res.error}`);
      assert.ok(res.events.length > 0);
      if (cs.round > 80) break;
    }
    if (isOver(cs)) assert.ok(getResult(cs));
  }
});

test('determinism: the same seed gives the same result and the same final state', () => {
  const rngA = createRng(4242);
  const input = { seed: 99, terrain: 'grass', attacker: randomSide(rngA, 0), defender: randomSide(rngA, 1) };
  const a = createCombat(JSON.parse(JSON.stringify(input)));
  const b = createCombat(JSON.parse(JSON.stringify(input)));
  const ra = autoResolve(a);
  const rb = autoResolve(b);
  assert.deepEqual(ra, rb);
  assert.deepEqual(a, b);
  const c = createCombat({ ...JSON.parse(JSON.stringify(input)), seed: 100 });
  autoResolve(c);
  assert.notDeepEqual(a.rng, c.rng);
});

test('a saved and reloaded combat continues identically', () => {
  const rng = createRng(777);
  const input = { seed: 5, terrain: 'dirt', attacker: randomSide(rng, 0), defender: randomSide(rng, 1) };
  const a = createCombat(input);
  for (let i = 0; i < 10 && !isOver(a); i++) performAction(a, { type: 'auto' });
  const b = JSON.parse(JSON.stringify(a));
  assert.deepEqual(autoResolve(a), autoResolve(b));
});
