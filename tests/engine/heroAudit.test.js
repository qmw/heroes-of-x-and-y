// Regression tests for the heroes & artifacts fidelity audit (docs/audit/heroes-artifacts.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addHero, adv } from '../adventure/fixture.js';
import { getCreature } from '../../src/data/creatures.js';
import { getArtifact } from '../../src/data/artifacts.js';
import { giveArtifact } from '../../src/engine/artifacts.js';
import { createTestState } from '../../src/engine/testing.js';
import { addHero as addEngineHero } from '../../src/engine/hero.js';
import { getArmyMorale, alignmentMorale, getHeroBonuses, getSkillBonuses } from '../../src/engine/bonuses.js';
import { specialtyBonuses } from '../../src/engine/leveling.js';

const P = (x, y, z = 0) => ({ x, y, z });

test("Diplomat's Cloak triples the hero's strength when monsters decide to join / flee", () => {
  const state = makeState();
  const h = addHero(state, { pos: P(5, 6), primary: { attack: 0, defense: 0 }, army: [{ creatureId: 'pikeman', count: 10 }] });
  const mon = adv.addObject(state, 'monster', P(5, 5), { data: { creatureId: 'imp', count: 16, character: 5 } });
  const plain = adv.evaluateMonster(state, h, mon).ratio;
  assert.ok(giveArtifact(h, 'diplomats_cloak').ok);
  assert.ok(Math.abs(adv.evaluateMonster(state, h, mon).ratio - 3 * plain) < 1e-9);
});

test('Angelic Alliance merges every good and neutral town (and neutral creatures) for morale', () => {
  const aa = getArtifact('angelic_alliance').bonuses.find((b) => b.type === 'no_alignment_penalty').factions;
  for (const f of ['castle', 'rampart', 'tower', 'stronghold', 'fortress', 'conflux', 'cove', 'factory', 'neutral']) {
    assert.ok(aa.includes(f), f);
  }
  for (const f of ['inferno', 'necropolis', 'dungeon']) assert.ok(!aa.includes(f), f);
  const army = [{ creatureId: 'pikeman', count: 1 }, { creatureId: 'pixie', count: 1 }, { creatureId: 'peasant', count: 1 }, null, null, null, null];
  assert.equal(getCreature('peasant').faction, 'neutral');
  assert.equal(alignmentMorale(army).value, -1); // 3 groups
  assert.equal(alignmentMorale(army, aa).value, 1); // one merged group
  army[3] = { creatureId: 'imp', count: 1 };
  assert.equal(alignmentMorale(army, aa).value, 0); // merged good/neutral + inferno
});

test('morale: alignment groups, undead penalty and the +-3 clamp', () => {
  const state = createTestState();
  const army = (...ids) => [...ids.map((creatureId) => ({ creatureId, count: 5 })), ...new Array(7 - ids.length).fill(null)];
  assert.equal(getArmyMorale(state, { army: army('pikeman', 'archer') }), 1);
  assert.equal(getArmyMorale(state, { army: army('pikeman', 'centaur') }), 0);
  assert.equal(getArmyMorale(state, { army: army('pikeman', 'centaur', 'gremlin') }), -1);
  assert.equal(getArmyMorale(state, { army: army('pikeman', 'centaur', 'gremlin', 'goblin', 'gnoll') }), -3);
  assert.equal(getArmyMorale(state, { army: army('pikeman', 'centaur', 'gremlin', 'goblin', 'gnoll', 'pixie', 'imp') }), -3);
  // one undead stack: -1 for the living (two towns: 0 - 1)
  assert.equal(getArmyMorale(state, { army: army('pikeman', 'skeleton') }), -1);
  // pure undead army: morale does not apply
  assert.equal(getArmyMorale(state, { army: army('skeleton', 'zombie') }), 0);
});

test('original fixed-bonus campaign specialists: Kilgor and the undead Lord Haart', () => {
  const stats = (defId) => Object.fromEntries(specialtyBonuses(defId, 1).map((b) => [b.stat, b.value]));
  assert.deepEqual(stats('kilgor'), { attack: 5, defense: 5, damage: 10 });
  assert.deepEqual(specialtyBonuses('kilgor', 1)[0].filter, { creatureIds: ['behemoth', 'ancient_behemoth'] });
  assert.deepEqual(stats('lord_haart_undead'), { attack: 5, defense: 5, damage: 10 });
  assert.deepEqual(specialtyBonuses('lord_haart_undead', 30)[0].filter, { creatureIds: ['black_knight', 'dread_knight'] });
});

test('Diplomacy specialists (Melchior) scale the surrender discount', () => {
  const hero = { skills: [{ id: 'diplomacy', level: 3 }] };
  const [b] = getSkillBonuses(hero, { diplomacy: 50 });
  assert.equal(b.surrenderDiscountPercent, 90);
  assert.equal(specialtyBonuses('melchior', 10)[0].percent, 50);
});

test('engine hero: specialty bonuses are aggregated for every hero definition', () => {
  const state = createTestState();
  const h = addEngineHero(state, 'adrienne', 0, P(1, 1));
  assert.ok(getHeroBonuses(state, h).some((b) => b.type === 'spell_school_mastery' && b.source === 'specialty'));
});

test('level-up: the upgrade offer is a uniform draw among owned skills, new skills follow class weights', async () => {
  const { createRng } = await import('../../src/core/rng.js');
  const { offerSecondarySkills } = await import('../../src/engine/leveling.js');
  const rng = createRng(5);
  const counts = { leadership: 0, fire_magic: 0 };
  const fresh = {};
  for (let i = 0; i < 4000; i++) {
    // knight: leadership weight 10, fire magic weight 1
    const hero = { classId: 'knight', skills: [{ id: 'leadership', level: 1 }, { id: 'fire_magic', level: 1 }],
      skillCounters: { wisdom: 0, school: -100 } };
    const [up, nw] = offerSecondarySkills(rng, hero);
    counts[up.skillId]++;
    fresh[nw.skillId] = (fresh[nw.skillId] || 0) + 1;
  }
  assert.ok(Math.abs(counts.leadership - 2000) < 200, JSON.stringify(counts));
  // knight weights: navigation / ballistics 8 vs scholar / intelligence / sorcery 1
  assert.ok(fresh.ballistics > 4 * (fresh.scholar || 0), JSON.stringify(fresh));
  assert.equal(fresh.necromancy, undefined);
});
