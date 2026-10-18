// Strategic AI extensions: artifacts, war machines, spellbooks, boats, Dimension Door, grail,
// seer huts, garrison swaps.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { getPending } from '../../src/engine/pending.js';
import { giveArtifact, getEquippedArtifacts, hasArtifact, ownsArtifact } from '../../src/engine/artifacts.js';
import { learnSpell } from '../../src/engine/hero.js';
import { armyStrength } from '../../src/engine/army.js';
import { aiDriver, getLastAiReport } from '../../src/engine/ai/index.js';
import { ready, solo, soloDays, P, adv } from './fixture.js';

before(ready);

const equippedIds = (h) => getEquippedArtifacts(h).map((e) => e.id);

test('equips the better item of a slot and assembles a combo', () => {
  const { s, hero } = solo({ seed: 31 });
  giveArtifact(hero, 'helm_of_the_alabaster_unicorn');
  giveArtifact(hero, 'thunder_helmet', { backpack: true });
  giveArtifact(hero, 'sea_captains_hat', { backpack: true });
  giveArtifact(hero, 'necklace_of_ocean_guidance', { backpack: true });
  hero.movePoints = 0;
  aiDriver(s, 0);
  const ids = equippedIds(hero);
  assert.ok(ids.includes('admirals_hat'), `combo assembled: ${ids}`);
  assert.ok(ownsArtifact(hero, 'thunder_helmet') && ownsArtifact(hero, 'helm_of_the_alabaster_unicorn'), 'nothing lost');
});

test('equips a better head item over a worse one', () => {
  const { s, hero } = solo({ seed: 32 });
  giveArtifact(hero, 'helm_of_the_alabaster_unicorn');
  giveArtifact(hero, 'thunder_helmet', { backpack: true });
  hero.movePoints = 0;
  aiDriver(s, 0);
  assert.ok(equippedIds(hero).includes('thunder_helmet'));
  assert.ok(hero.artifacts.backpack.includes('helm_of_the_alabaster_unicorn'));
});

test('a meeting secondary hero hands his artifacts to the main hero', () => {
  const { s, hero } = solo({ seed: 33 });
  s.towns[s.players[0].towns[0]].stock = {};
  adv.placeHero(s, hero, P(12, 12), []);
  hero.army = [{ creatureId: 'pikeman', count: 20 }, null, null, null, null, null, null];
  s.players[0].ai.mainHeroId = hero.id;
  const sec = adv.deps.addHero(s, 'edric', 0, P(14, 12));
  sec.army = [{ creatureId: 'peasant', count: 1 }, null, null, null, null, null, null];
  giveArtifact(sec, 'thunder_helmet');
  aiDriver(s, 0);
  assert.ok(hasArtifact(hero, 'thunder_helmet'), 'main hero wears it');
  assert.ok(!ownsArtifact(sec, 'thunder_helmet'));
});

test('buys war machines and a spellbook for the main hero when rich', () => {
  const { s, hero } = solo({ seed: 34, buildings: ['village_hall', 'fort', 'tavern', 'blacksmith', 'mage_guild_1', 'castle_dwelling_1'] });
  const town = s.towns[s.players[0].towns[0]];
  assert.equal(town.visitingHero, hero.id);
  hero.artifacts.equipped.spellbook[0] = null;
  s.players[0].resources.gold = 30000;
  aiDriver(s, 0);
  const ids = equippedIds(hero);
  assert.ok(ids.includes('spellbook'), `spellbook: ${ids}`);
  assert.ok(ids.includes('ballista'), `ballista: ${ids}`);
});

test('builds a boat to reach another island and collects there', () => {
  // island A (town) x 1..10, island B x 15..22; water elsewhere
  const mapFn = (map) => {
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const a = x >= 1 && x <= 10 && y >= 1 && y <= 9;
      const b = x >= 15 && x <= 22 && y >= 1 && y <= 22;
      map.tiles[0][y][x].t = a || b ? 'grass' : 'water';
    }
  };
  const { s, hero } = solo({
    seed: 35, mapFn, townPos: P(5, 7), farPos: P(19, 20),
    buildings: ['village_hall', 'fort', 'tavern', 'castle_dwelling_1', 'shipyard'],
  });
  s.players[0].resources.gold = 20000;
  s.players[0].resources.wood = 40;
  // everything on the home island is gone; a chest lies on island B
  const chest = adv.addObject(s, 'treasure_chest', P(16, 6));
  adv.revealAround(s, 0, P(16, 6), 3);
  soloDays(s, 6);
  assert.ok((Object.values(s.map.objects).some((o) => o.defId === 'boat')), 'a boat exists');
  assert.equal(s.map.objects[chest.id], undefined, `chest collected (hero at ${JSON.stringify(s.heroes[hero.id]?.pos)})`);
});

test('uses Dimension Door to reach a treasure behind a wall', () => {
  const mapFn = (map) => {
    for (let y = 0; y < 24; y++) map.tiles[0][y][12].t = 'water';
    for (let y = 0; y < 24; y++) map.tiles[0][y][13].t = 'water';
  };
  const { s, hero } = solo({ seed: 36, mapFn, farPos: P(20, 20) });
  adv.placeHero(s, hero, P(10, 12), []);
  if (!hero.artifacts.equipped.spellbook[0]) giveArtifact(hero, 'spellbook');
  learnSpell(s, hero.id, 'dimension_door', { force: true });
  hero.mana = 100;
  hero.movePoints = hero.maxMovePoints;
  const chest = adv.addObject(s, 'treasure_chest', P(16, 12));
  adv.revealAround(s, 0, P(16, 12), 3);
  aiDriver(s, 0);
  assert.equal(s.map.objects[chest.id], undefined, `chest taken; trace ${getLastAiReport(0).trace.join(' ; ')}`);
  assert.ok(hero.pos.x > 13, 'crossed the water');
});

test('visits the obelisk, digs up the grail and builds the grail structure', () => {
  const { s, hero } = solo({ seed: 37 });
  const grail = adv.getGrailObject(s);
  adv.removeObject(s, grail.id);
  adv.setupGrail(s, { pos: P(9, 11) });
  adv.addObject(s, 'obelisk', P(7, 9));
  adv.revealAround(s, 0, P(8, 10), 4);
  soloDays(s, 5);
  const town = s.towns[s.players[0].towns[0]];
  assert.equal(adv.getGrailObject(s), null, 'grail dug up');
  assert.ok(town.buildings.includes('castle_grail'), `grail built: ${town.buildings}`);
});

test('completes a seer hut quest it can fulfil', () => {
  const { s, hero } = solo({ seed: 38 });
  const hut = adv.addObject(s, 'seers_hut', P(8, 9), {
    data: { quest: { type: 'bring_resources', resources: { wood: 5 } }, reward: { resources: { gems: 10 } }, completed: false },
  });
  const gems = s.players[0].resources.gems;
  soloDays(s, 2);
  assert.equal(s.map.objects[hut.id].data.completed, true);
  assert.ok(s.players[0].resources.gems >= gems + 10);
  assert.ok(hero);
});

test('a holding hero moves into the garrison row and leaves it when the danger is gone', () => {
  const { s, hero } = solo({ seed: 39 });
  const town = s.towns[s.players[0].towns[0]];
  town.garrison = [{ creatureId: 'griffin', count: 6 }, null, null, null, null, null, null];
  hero.army = [{ creatureId: 'pikeman', count: 30 }, { creatureId: 'archer', count: 20 }, null, null, null, null, null];
  const enemy = adv.deps.addHero(s, 'mephala', 1, P(9, 6));
  enemy.army = [{ creatureId: 'dwarf', count: 45 }, { creatureId: 'wood_elf', count: 12 }, null, null, null, null, null];
  aiDriver(s, 0);
  assert.equal(town.garrisonHero, hero.id, getLastAiReport(0).trace.join(' ; '));
  assert.ok(hero.army.some((x) => x && x.creatureId === 'griffin'), 'took the garrison along');
  adv.deps.removeHero(s, enemy.id, 'defeated');
  aiDriver(s, 0);
  assert.notEqual(town.garrisonHero, hero.id, JSON.stringify(getLastAiReport(0)));
  assert.equal(hero.garrisoned, false);
  assert.ok(armyStrength(hero.army) > 0);
  assert.equal(getPending(s, 0).length, 0);
});
