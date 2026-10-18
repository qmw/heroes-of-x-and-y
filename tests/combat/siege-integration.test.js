// Siege through the adventure adapter: hero.js startCombat against a real town (town.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../../src/engine/testing.js';
import { addHero, startCombat, finishCombat, setTownModule, setCombatEngine, engineReady } from '../../src/engine/hero.js';
import * as townModule from '../../src/engine/town.js';
import * as combat from '../../src/engine/combat/index.js';
import { getSiegeStructures } from '../../src/engine/combat/siege.js';

await engineReady;
setCombatEngine(combat);
setTownModule(townModule);

const army = (...pairs) => pairs.map(([creatureId, count]) => ({ creatureId, count }));
const pad7 = (a) => { const out = a.slice(); while (out.length < 7) out.push(null); return out; };

function setup(faction, buildings, garrison = [['pikeman', 10]]) {
  const state = createTestState({ humans: [false, false] });
  const town = townModule.createTown(state, { faction, owner: 1, pos: { x: 9, y: 9, z: 0 }, buildings });
  town.garrison = pad7(army(...garrison));
  const hero = addHero(state, 'orrin', 0, { x: 8, y: 9, z: 0 }, { army: army(['cyclops_king', 6], ['ogre', 10]) });
  return { state, town, hero };
}

test('startCombat with a real town: fort / citadel / castle layouts, tower damage from the building count', () => {
  const levels = [
    [['village_hall', 'fort'], 1, 0],
    [['village_hall', 'fort', 'citadel'], 2, 1],
    [['village_hall', 'tavern', 'fort', 'citadel', 'castle'], 3, 3],
  ];
  for (const [buildings, fortLevel, towers] of levels) {
    const { state, town, hero } = setup('castle', buildings);
    const res = startCombat(state, { attackerHeroId: hero.id, defender: { townId: town.id }, context: { kind: 'siege', townId: town.id }, seed: 5 });
    assert.equal(res.ok, true, res.error);
    const cs = state.combat.cs;
    assert.equal(cs.siege.fortLevel, fortLevel);
    assert.equal(cs.siege.towers.length, towers);
    assert.equal(cs.siege.walls.length, 4);
    assert.equal(!!cs.siege.moat, fortLevel >= 2);
    const expected = townModule.arrowTowerDamage(town.buildings.length);
    if (towers) assert.deepEqual(cs.siege.towers[0].damage, expected.keep);
    if (towers === 3) assert.deepEqual(cs.siege.towers[1].damage, expected.turret);
    assert.ok(cs.stacks.some((s) => s.side === 'attacker' && s.creatureId === 'catapult'));
    combat.autoResolve(cs, { maxRounds: 80 });
    const fin = finishCombat(state);
    assert.equal(fin.ok, true, fin.error);
    assert.equal(state.combat, null);
    assert.ok(getSiegeStructures(cs).every((t) => t.hp >= 0));
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  }
});

test('startCombat: a town without a fort is an ordinary battle; Tower town gets mines; escape tunnel lets the hero flee', () => {
  const plain = setup('castle', ['village_hall']);
  startCombat(plain.state, { attackerHeroId: plain.hero.id, defender: { townId: plain.town.id }, context: { kind: 'siege' } });
  assert.equal(plain.state.combat.cs.siege, null);

  const tower = setup('tower', ['village_hall', 'fort', 'citadel']);
  startCombat(tower.state, { attackerHeroId: tower.hero.id, defender: { townId: tower.town.id }, context: { kind: 'siege' } });
  assert.equal(tower.state.combat.cs.siege.moat, null);
  assert.equal(tower.state.combat.cs.obstacles.filter((o) => o.kind === 'land_mine').length, 6);

  const sh = setup('stronghold', ['village_hall', 'fort', 'stronghold_escape_tunnel']);
  const def = addHero(sh.state, 'orrin', 1, { x: 9, y: 9, z: 0 }, { army: army(['goblin', 20]) });
  sh.town.visitingHero = def.id;
  startCombat(sh.state, { attackerHeroId: sh.hero.id, defender: { townId: sh.town.id }, context: { kind: 'siege' } });
  assert.equal(sh.state.combat.cs.siege.escapeTunnel, true);
  assert.equal(combat.canRetreat(sh.state.combat.cs, 'defender'), true);

  const noTunnel = setup('stronghold', ['village_hall', 'fort']);
  const d2 = addHero(noTunnel.state, 'orrin', 1, { x: 9, y: 9, z: 0 }, { army: army(['goblin', 20]) });
  noTunnel.town.visitingHero = d2.id;
  startCombat(noTunnel.state, { attackerHeroId: noTunnel.hero.id, defender: { townId: noTunnel.town.id }, context: { kind: 'siege' } });
  assert.equal(combat.canRetreat(noTunnel.state.combat.cs, 'defender'), false);
});
