// Fuzz: seeded auto-resolved sieges across every faction and fort level.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randInt, pick, rand } from '../../src/core/rng.js';
import { FACTIONS_DATA } from '../../src/data/factions.js';
import { creaturesOfFaction } from '../../src/data/creatures.js';
import { SKILLS } from '../../src/data/skills.js';
import { createCombat, autoResolve, performAction, isOver, getLegalActions } from '../../src/engine/combat/index.js';
import { getSiegeStructures } from '../../src/engine/combat/siege.js';

const BALLISTICS = SKILLS.find((s) => s.id === 'ballistics').levels.map((l) => l.effects[0]);

function side(rng, i, faction, extra = []) {
  const pool = creaturesOfFaction(faction).filter((c) => !c.warMachine);
  const army = [];
  const n = randInt(rng, 1, 7);
  for (let k = 0; k < 7; k++) {
    if (k >= n) { army.push(null); continue; }
    const c = k === 0 && extra.length ? extra[0] : pick(rng, pool);
    army.push({ creatureId: c.id ?? c, count: Math.max(1, Math.round(randInt(rng, 300, 5000) / (c.aiValue ?? 1266))) });
  }
  let hero = null;
  if (rand(rng) < 0.7) {
    const level = randInt(rng, 0, 3);
    hero = { id: `h${i}`, name: 'H', attack: randInt(rng, 0, 10), defense: randInt(rng, 0, 10), power: randInt(rng, 1, 6),
      knowledge: randInt(rng, 1, 6), mana: randInt(rng, 0, 60), spells: ['magic_arrow', 'bless', 'haste', 'earthquake'],
      skills: {}, bonuses: level ? [BALLISTICS[level - 1]] : [] };
  }
  const warMachines = ['ballista', 'ammo_cart', 'first_aid_tent'].filter(() => rand(rng) < 0.4);
  if (rand(rng) < 0.15) warMachines.push('cannon');
  return { playerId: i, isHuman: rand(rng) < 0.3, hero, army, warMachines: warMachines.filter((m, _, a) => !(m === 'cannon' && a.includes('ballista'))) };
}

function assertSane(cs) {
  const json = JSON.stringify(cs);
  assert.ok(!/NaN/.test(json));
  assert.deepEqual(JSON.parse(json), cs, 'state must be JSON round-trippable');
  for (const s of cs.stacks) {
    for (const k of ['count', 'hp', 'maxHp', 'attack', 'defense', 'speed', 'shots']) assert.ok(Number.isFinite(s[k]), `stack.${k} = ${s[k]}`);
    assert.ok(s.count >= 0 && s.hp >= 0 && s.hp <= s.maxHp);
  }
  for (const t of getSiegeStructures(cs)) assert.ok(Number.isInteger(t.hp) && t.hp >= 0 && t.hp <= t.maxHp, `${t.id} hp ${t.hp}`);
}

test('fuzz: 100 seeded sieges (all factions x fort levels) terminate without errors', () => {
  const winners = { attacker: 0, defender: 0, draw: 0 };
  let towerShots = 0;
  let catapultShots = 0;
  let wallsDown = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const rng = createRng(seed * 6007);
    const faction = FACTIONS_DATA[seed % FACTIONS_DATA.length];
    const fortLevel = 1 + (seed % 3);
    const attFaction = pick(rng, FACTIONS_DATA).id;
    const input = {
      seed, terrain: 'grass',
      attacker: side(rng, 0, attFaction, seed % 5 === 0 ? ['cyclops_king'] : []),
      defender: side(rng, 1, faction.id),
      siege: { fortLevel, faction: faction.id, buildings: new Array(randInt(rng, 5, 30)).fill('b'), escapeTunnel: rand(rng) < 0.3 },
    };
    try {
      const cs = createCombat(input);
      assertSane(cs);
      const events = [...cs.startEvents];
      for (let i = 0; i < 20000 && !isOver(cs); i++) {
        if (cs.round > 60) break;
        // a player-controlled catapult aims through the legal action list
        const legal = getLegalActions(cs);
        let res;
        const active = cs.stacks.find((s) => s.id === legal.stackId);
        if (active && active.creatureId === 'catapult' && legal.siegeTargets.length) {
          res = performAction(cs, { type: 'siege_attack', targetId: legal.siegeTargets[randInt(rng, 0, legal.siegeTargets.length - 1)].targetId });
        } else {
          res = performAction(cs, { type: 'auto' });
          if (!res.ok) res = performAction(cs, { type: 'defend' });
        }
        assert.equal(res.ok, true, res.error);
        events.push(...res.events);
      }
      const result = autoResolve(cs, { maxRounds: 60 });
      assertSane(cs);
      assert.ok(isOver(cs));
      assert.ok(['attacker', 'defender', 'draw'].includes(result.winner));
      assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
      assert.ok(!result.warMachinesLost?.attacker?.includes?.('catapult'));
      winners[result.winner] += 1;
      towerShots += events.filter((e) => e.type === 'tower_shot').length;
      catapultShots += events.filter((e) => e.type === 'catapult_shot').length;
      wallsDown += events.filter((e) => e.type === 'wall_destroyed').length;
      for (const e of events) if (e.type === 'tower_shot') assert.ok(fortLevel >= 2 && Number.isFinite(e.damage) && e.damage >= 1);
    } catch (err) {
      err.message = `seed ${seed} (${faction.id} level ${fortLevel}): ${err.message}`;
      throw err;
    }
  }
  assert.ok(winners.attacker > 5 && winners.defender > 5, JSON.stringify(winners));
  assert.ok(towerShots > 50 && catapultShots > 50 && wallsDown > 10, JSON.stringify({ towerShots, catapultShots, wallsDown }));
});
