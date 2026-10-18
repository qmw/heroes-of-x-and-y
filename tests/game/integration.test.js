// The game / town modules running on the REAL hero, bonuses and adventure engines (through the
// gameDeps seam), as opposed to the hermetic fallback deps used by the other test files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestState } from '../../src/engine/testing.js';
import { giveArtifact } from '../../src/engine/artifacts.js';
import { getPending } from '../../src/engine/pending.js';
import { deps, resetGameDeps, boundToReal, isRealDep, REAL_MODULE_SOURCES } from '../../src/engine/gameDeps.js';
import { REAL_MODULES } from '../../src/engine/gameDepsReal.js';
import * as heroEngine from '../../src/engine/hero.js';
import * as bonusEngine from '../../src/engine/bonuses.js';
import * as adventure from '../../src/engine/adventure/index.js';
import { getDailyIncome } from '../../src/engine/economy.js';
import { startNewDay, resolvePending, setAiDriver } from '../../src/engine/game.js';
import {
  createTown, visitTown, leaveTown, hireHero, ensureTavernPool, getPlayerTownBonuses, getTownGrowth,
  getSiegeInfo, captureTown, applyFogCover, startOfWeekTown, buySpellbook,
} from '../../src/engine/town.js';
import { RESOURCES } from '../../src/core/constants.js';
import { runSimulation, assertValidState } from './sim.js';

function setup(opts = {}) {
  resetGameDeps();
  setAiDriver(null);
  const s = createTestState(opts);
  for (const p of s.players) for (const r of RESOURCES) p.resources[r] = 100000;
  return s;
}

test('every dependency is served by a real engine module', () => {
  resetGameDeps();
  assert.deepEqual(boundToReal.slice().sort(), Object.keys(REAL_MODULE_SOURCES).sort());
  const missing = Object.keys(REAL_MODULE_SOURCES).filter((name) => !isRealDep(name, REAL_MODULES));
  assert.deepEqual(missing, [], 'deps still on the fallback implementation');
});

test('60-day simulation on the real engines stays valid and serializable', () => {
  resetGameDeps();
  const { state, stats } = runSimulation({ days: 60, seed: 42 });
  assert.equal(state.turn, 61);
  assert.equal(state.gameOver, null);
  assertValidState(state);
  assert.ok(stats.built >= 45 && stats.recruited > 400 && stats.hired >= 2, JSON.stringify(stats));
  for (const p of state.players) assert.ok(state.towns[p.towns[0]].buildings.includes('capitol'));
  // fog arrays in the adventure engine's format
  for (const p of state.players) assert.equal(p.explored[0].length, 24 * 24);
});

test('town building bonuses agree with the bonus aggregator', () => {
  const s = setup();
  createTown(s, { faction: 'castle', owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings: ['village_hall', 'castle_grail'] });
  createTown(s, { faction: 'necropolis', owner: 0, pos: { x: 12, y: 12, z: 0 }, buildings: ['village_hall', 'mage_guild_1', 'necropolis_necromancy_amplifier'] });
  const h = heroEngine.addHero(s, 'orrin', 0, { x: 1, y: 1, z: 0 });
  const mine = getPlayerTownBonuses(s, 0).map((b) => `${b.type}:${b.value ?? b.percent}`).sort();
  const theirs = bonusEngine.getTownBuildingBonuses(s, 0).map((b) => `${b.type}:${b.value ?? b.percent}`).sort();
  assert.deepEqual(mine, theirs);
  assert.deepEqual(mine, ['morale:2', 'necromancy_percent:10']);
  assert.ok(bonusEngine.getHeroBonuses(s, h).some((b) => b.type === 'morale' && b.value === 2 && String(b.source).includes('castle_grail')));
});

test('Stables through the real temp-bonus machinery', () => {
  const s = setup();
  const t = createTown(s, { faction: 'castle', owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings: ['fort', 'castle_stables'] });
  const h = heroEngine.addHero(s, 'orrin', 0, { x: 5, y: 6, z: 0 });
  const base = h.maxMovePoints;
  const before = h.movePoints;
  assert.equal(visitTown(s, h.id, t.id).ok, true);
  assert.equal(h.movePoints, before + 400);
  assert.equal(h.temp.filter((x) => x.source === 'castle_stables').length, 1);
  leaveTown(s, h.id);
  visitTown(s, h.id, t.id);
  assert.equal(h.temp.filter((x) => x.source === 'castle_stables').length, 1, 'does not stack');
  leaveTown(s, h.id);
  startNewDay(s);
  assert.equal(h.maxMovePoints, base + 400, 'kept for the rest of the week');
  while (s.date.day !== 1) startNewDay(s);
  assert.equal(h.maxMovePoints, base, 'gone with the new week');
});

test('mage guild, spellbook and overnight mana with the real hero engine', () => {
  const s = setup();
  const t = createTown(s, { faction: 'tower', owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings: ['village_hall', 'mage_guild_3'] });
  const mage = heroEngine.addHero(s, 'solmyr', 0, { x: 5, y: 6, z: 0 });
  visitTown(s, mage.id, t.id);
  for (const l of [0, 1, 2]) assert.ok(t.mageGuild[l].every((id) => mage.spells.includes(id)), `level ${l + 1} learned (Basic Wisdom)`);
  mage.mana = 0;
  startNewDay(s);
  assert.equal(mage.mana, bonusEngine.getMaxMana(s, mage));
  leaveTown(s, mage.id);
  const knight = heroEngine.addHero(s, 'edric', 0, { x: 5, y: 6, z: 0 });
  visitTown(s, knight.id, t.id);
  assert.deepEqual(knight.spells, []);
  assert.equal(buySpellbook(s, t.id).ok, true);
  assert.equal(t.mageGuild[0].filter((id) => knight.spells.includes(id)).length, 5);
  assert.equal(t.mageGuild[2].filter((id) => knight.spells.includes(id)).length, 0, 'no Wisdom');
});

test('Battle Scholar Academy: experience goes through giveExperience (level-up pending)', () => {
  const s = setup();
  const t = createTown(s, { faction: 'dungeon', owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings: ['fort', 'dungeon_battle_scholar_academy'] });
  const h = heroEngine.addHero(s, 'orrin', 0, { x: 5, y: 6, z: 0 });
  visitTown(s, h.id, t.id);
  assert.ok(h.exp >= 1000);
  for (let i = 0; i < 20 && getPending(s, 0).length; i++) {
    const p = getPending(s, 0)[0];
    assert.equal(p.kind, 'level_up');
    assert.equal(resolvePending(s, p.id, 0).ok, true);
  }
  assert.ok(h.level >= 2);
  const exp = h.exp;
  leaveTown(s, h.id);
  visitTown(s, h.id, t.id);
  assert.equal(h.exp, exp, 'only once');
});

test('tavern: hire, retreat (removeHero) and re-hire with the kept level', () => {
  const s = setup();
  const t = createTown(s, { faction: 'castle', owner: 0, pos: { x: 5, y: 5, z: 0 } });
  ensureTavernPool(s, 0);
  const offered = s.players[0].tavernHeroes[0];
  const r = hireHero(s, t.id, 0);
  assert.equal(r.ok, true);
  const h = s.heroes[r.heroId];
  assert.deepEqual([h.defId, h.townId, t.visitingHero, h.owner], [offered, t.id, h.id, 0]);
  assert.equal(h.army.filter(Boolean).length, 1);
  assert.ok(!s.players[0].tavernHeroes.includes(offered));
  h.level = 9;
  heroEngine.removeHero(s, h.id, 'retreated');
  assert.deepEqual([t.visitingHero, s.players[0].tavernHeroes[1]], [null, offered]);
  const back = s.heroes[hireHero(s, t.id, 1).heroId];
  assert.deepEqual([back.defId, back.level, back.townId], [offered, 9, t.id]);
  assert.ok(back.army.some(Boolean), 'never without troops');
  assertValidState(s);
});

test('income: mines flagged on the adventure map and Estates', () => {
  const s = setup();
  createTown(s, { faction: 'castle', owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings: ['village_hall'] });
  adventure.addObject(s, 'gold_mine', { x: 15, y: 15, z: 0 }, { owner: 0 });
  adventure.addObject(s, 'sawmill', { x: 10, y: 15, z: 0 }, { owner: 0 });
  adventure.addObject(s, 'ore_pit', { x: 15, y: 10, z: 0 }, { owner: 1 });
  const base = getDailyIncome(s, 0);
  assert.deepEqual([base.gold, base.wood, base.ore], [1500, 2, 0]);
  const haart = heroEngine.addHero(s, 'lord_haart', 0, { x: 1, y: 1, z: 0 });
  const withEstates = getDailyIncome(s, 0).gold;
  assert.ok(withEstates >= 1625 && withEstates <= 1700, `Estates basic (+ specialty): ${withEstates}`);
  giveArtifact(haart, 'endless_sack_of_gold');
  assert.equal(getDailyIncome(s, 0).gold, withEstates + 1000);
  const gold = s.players[0].resources.gold;
  startNewDay(s);
  assert.equal(s.players[0].resources.gold, gold + withEstates + 1000);
});

test('external dwellings: +1 growth and the Portal of Summoning', () => {
  const s = setup();
  const t = createTown(s, { faction: 'dungeon', owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings: ['fort', 'dungeon_dwelling_1', 'dungeon_portal_of_summoning'] });
  assert.equal(getTownGrowth(s, t.id).troglodyte, 14);
  assert.equal(t.portal, null);
  adventure.addObject(s, 'warren', { x: 15, y: 15, z: 0 }, { owner: 0 });
  assert.equal(getTownGrowth(s, t.id).troglodyte, 15);
  startOfWeekTown(s, t.id);
  assert.deepEqual(t.portal, { creatureId: 'troglodyte', count: 14 });
});

test('fog: capture reveals, Cover of Darkness hides', () => {
  const s = setup({ width: 60, height: 60 });
  const t = createTown(s, { faction: 'necropolis', owner: 0, pos: { x: 30, y: 30, z: 0 }, buildings: ['fort', 'necropolis_cover_of_darkness'] });
  const obj = adventure.addObject(s, 'town', t.pos, { owner: 0, data: { townId: t.id } });
  createTown(s, { faction: 'castle', owner: 0, pos: { x: 5, y: 5, z: 0 } });
  const scout = heroEngine.addHero(s, 'orrin', 1, { x: 30, y: 52, z: 0 });
  adventure.revealAround(s, 1, { x: 30, y: 30, z: 0 }, 30);
  assert.equal(adventure.isExplored(s, 1, { x: 30, y: 32, z: 0 }), true);
  applyFogCover(s);
  assert.equal(adventure.isExplored(s, 1, { x: 30, y: 32, z: 0 }), false);
  assert.equal(adventure.isExplored(s, 1, { x: 30, y: 51, z: 0 }), true, 'next to his hero');
  assert.equal(adventure.isExplored(s, 0, { x: 30, y: 32, z: 0 }), true);
  captureTown(s, t.id, 1, { heroId: scout.id });
  assert.equal(obj.owner, 1);
  assert.equal(adventure.isExplored(s, 1, { x: 30, y: 32, z: 0 }), true);
  assert.equal(t.visitingHero, scout.id);
});

test('the hero engine picks up getSiegeInfo from town.js', async () => {
  const s = setup();
  const t = createTown(s, { faction: 'castle', owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings: ['castle', 'tavern'] });
  await heroEngine.engineReady;
  const info = heroEngine.siegeInfoFor(s, t.id);
  assert.deepEqual(info, getSiegeInfo(s, t.id));
  assert.deepEqual([info.fortLevel, info.turrets, info.garrison.morale], [3, 2, 1]);
  assert.equal(deps.getSightRadius(s, heroEngine.addHero(s, 'orrin', 0, { x: 1, y: 1, z: 0 })) >= 5, true);
});
