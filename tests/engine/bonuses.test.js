import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState, addTestTown } from '../../src/engine/testing.js';
import { addHero, addTempBonus } from '../../src/engine/hero.js';
import { giveArtifact } from '../../src/engine/artifacts.js';
import { CREATURES } from '../../src/data/creatures.js';
import {
  getHeroBonuses, sumBonus, sumBonusValue, sumBonusPercent, filterBonuses, hasBonus, getPrimary,
  getSkillLevel, getMaxMana, getManaRegen, getSightRadius, getMaxMovePoints, landMoveBase,
  getArmyMorale, getArmyLuck, getArmyMoraleDetails, getArmyLuckDetails, getNecromancyInfo,
  alignmentMorale, getTerrainPenaltyReduction, getLearnSpellLevel, getSchoolMastery, getEagleEye,
  getScholarLevel, getExperienceMultiplier, getHeroIncome, getDiplomacy, getSurrenderCostMultiplier,
  getNegotiationStrengthMultiplier, getTownBuildingBonuses, getGarrisonBonuses, creatureUsesMorale,
  LAND_MOVE_BY_SPEED,
} from '../../src/engine/bonuses.js';

const army = (...pairs) => pairs.map(([creatureId, count]) => ({ creatureId, count: count ?? 1 }));

function mk(state, defId, stacks = [['pikeman', 10]], playerId = 0) {
  return addHero(state, defId, playerId, { x: 1 + Object.keys(state.heroes).length, y: 1, z: 0 }, { army: army(...stacks) });
}
const setSkills = (hero, obj) => { hero.skills = Object.entries(obj).map(([id, level]) => ({ id, level })); };
const temp = (state, hero, bonus, source = 'test') => addTempBonus(state, hero.id, source, bonus, 'next_battle');

// ---------------------------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------------------------

test('getHeroBonuses collects skills, artifacts, specialty and temp bonuses with sources', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  giveArtifact(hero, 'centaurs_axe');
  temp(state, hero, { type: 'luck', value: 1 }, 'faerie_ring');
  const b = getHeroBonuses(state, hero);
  assert.ok(b.some((x) => x.type === 'morale' && x.source === 'skill:leadership' && x.value === 1));
  assert.ok(b.some((x) => x.type === 'primary' && x.source === 'artifact:centaurs_axe'));
  assert.ok(b.some((x) => x.type === 'skill_percent' && x.source === 'specialty' && x.percent === 5));
  assert.ok(b.some((x) => x.type === 'luck' && x.source === 'temp:faerie_ring'));
  assert.ok(b.every((x) => typeof x.source === 'string'));
  assert.equal(getSkillLevel(hero, 'leadership'), 1);
  assert.equal(getSkillLevel(hero, 'wisdom'), 0);
  JSON.stringify(b);
});

test('sumBonus helpers: value, percent, match object and predicate', () => {
  const list = [
    { type: 'primary', stat: 'attack', value: 2 }, { type: 'primary', stat: 'attack', value: 3 },
    { type: 'primary', stat: 'defense', value: 4 }, { type: 'movement_land', percent: 10 },
    { type: 'movement_land', value: 600 }, { type: 'mana_max_percent', percent: 25 },
  ];
  assert.equal(sumBonus(list, 'primary'), 9);
  assert.equal(sumBonus(list, 'primary', { stat: 'attack' }), 5);
  assert.equal(sumBonus(list, 'primary', (b) => b.value > 2), 7);
  assert.equal(sumBonus(list, 'mana_max_percent'), 25);
  assert.equal(sumBonusValue(list, 'movement_land'), 600);
  assert.equal(sumBonusPercent(list, 'movement_land'), 10);
  assert.equal(filterBonuses(list, 'primary', { stat: 'defense' }).length, 1);
  assert.equal(hasBonus(list, 'luck'), false);
  assert.equal(sumBonus(list, 'luck'), 0);
});

test('skill specialty scales the specialtyParam by 5% per hero level (skill_percent)', () => {
  const state = createTestState();
  const orrin = mk(state, 'orrin'); // Basic Archery 10%, Archery specialty
  const ranged = () => sumBonusPercent(getHeroBonuses(state, orrin), 'damage_percent', { mode: 'ranged' });
  assert.equal(ranged(), 10.5); // 10 x 1.05
  orrin.level = 10;
  assert.equal(ranged(), 15); // 10 x 1.5
  setSkills(orrin, { archery: 3 });
  assert.equal(ranged(), 75); // 50 x 1.5
  // skill_percent from several sources adds up
  temp(state, orrin, { type: 'skill_percent', skillId: 'archery', percent: 50 });
  assert.equal(ranged(), 100); // 50 x (1 + 0.5 + 0.5)
  // no skill, no effect
  setSkills(orrin, {});
  assert.equal(ranged(), 0);
});

test('skill_percent rounds integer params down (Estates) and ignores unscalable skills', () => {
  const state = createTestState();
  const haart = mk(state, 'lord_haart'); // Basic Estates 125, Estates specialty
  assert.equal(getHeroIncome(state, haart).gold, 131); // floor(125 x 1.05)
  haart.level = 4;
  assert.equal(getHeroIncome(state, haart).gold, 150); // 125 x 1.2
  temp(state, haart, { type: 'skill_percent', skillId: 'leadership', percent: 100 });
  assert.equal(sumBonus(getHeroBonuses(state, haart), 'morale'), 1); // leadership has no specialtyParam
});

test('resource specialty and artifacts feed getHeroIncome', () => {
  const state = createTestState();
  const aine = mk(state, 'aine', [['gremlin', 10]]);
  assert.equal(getHeroIncome(state, aine).gold, 350);
  giveArtifact(aine, 'endless_sack_of_gold');
  assert.equal(getHeroIncome(state, aine).gold, 1350);
  assert.equal(getHeroIncome(state, aine).wood, 0);
});

// ---------------------------------------------------------------------------------------------
// Primary skills, mana, sight
// ---------------------------------------------------------------------------------------------

test('getPrimary: base + artifacts + temp, with minimums 0/0/1/1', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin'); // knight 2/2/1/1
  assert.deepEqual(getPrimary(state, hero), { attack: 2, defense: 2, power: 1, knowledge: 1 });
  giveArtifact(hero, 'centaurs_axe'); // +2 attack
  giveArtifact(hero, 'crown_of_dragontooth'); // +4 power, +4 knowledge
  assert.deepEqual(getPrimary(state, hero), { attack: 4, defense: 2, power: 5, knowledge: 5 });
  for (const stat of ['attack', 'defense', 'power', 'knowledge']) temp(state, hero, { type: 'primary', stat, value: -20 });
  assert.deepEqual(getPrimary(state, hero), { attack: 0, defense: 0, power: 1, knowledge: 1 });
  // extra (garrison) bonuses
  hero.temp = [];
  assert.equal(getPrimary(state, hero, [{ type: 'primary', stat: 'defense', value: 2 }]).defense, 4);
});

test('getMaxMana: 10 x knowledge x Intelligence, artifacts add percent and knowledge', () => {
  const state = createTestState();
  const hero = mk(state, 'aine', [['gremlin', 10]]); // wizard, knowledge 3
  assert.equal(getMaxMana(state, hero), 30);
  assert.equal(hero.mana, 30);
  setSkills(hero, { intelligence: 1 });
  assert.equal(getMaxMana(state, hero), 37); // 30 x 1.25 = 37.5
  setSkills(hero, { intelligence: 2 });
  assert.equal(getMaxMana(state, hero), 45);
  setSkills(hero, { intelligence: 3 });
  assert.equal(getMaxMana(state, hero), 60);
  giveArtifact(hero, 'ring_of_the_arch_magus'); // +25%
  assert.equal(getMaxMana(state, hero), 67); // 30 x 2.25 = 67.5
  giveArtifact(hero, 'helm_of_chaos'); // +3 knowledge
  assert.equal(getMaxMana(state, hero), 135); // 60 x 2.25
  temp(state, hero, { type: 'primary', stat: 'knowledge', value: -50 });
  assert.equal(getMaxMana(state, hero), 22); // knowledge floor 1: 10 x 2.25
});

test('Intelligence specialty scales the percentage', () => {
  const state = createTestState();
  const hero = mk(state, 'elleshar', [['centaur', 5]]); // Basic Intelligence, Intelligence specialty
  const kn = hero.primary.knowledge;
  hero.level = 20; // 25% x 2 = 50%
  assert.equal(getMaxMana(state, hero), Math.floor(10 * kn * 1.5));
});

test('getManaRegen: 1 + Mysticism + artifacts + owner grail', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  assert.equal(getManaRegen(state, hero), 1);
  setSkills(hero, { mysticism: 1 });
  assert.equal(getManaRegen(state, hero), 3);
  setSkills(hero, { mysticism: 3 });
  assert.equal(getManaRegen(state, hero), 5);
  giveArtifact(hero, 'charm_of_mana');
  giveArtifact(hero, 'talisman_of_mana');
  giveArtifact(hero, 'mystic_orb_of_mana');
  assert.equal(getManaRegen(state, hero), 11);
  addTestTown(state, { faction: 'factory', owner: 0, buildings: ['factory_grail'] });
  assert.equal(getManaRegen(state, hero), 14);
});

test('Mysticism specialty scales the value and rounds down', () => {
  const state = createTestState();
  const hero = mk(state, 'halon', [['gremlin', 5]]); // Basic Mysticism (2), Mysticism specialty
  assert.equal(getManaRegen(state, hero), 3); // floor(2 x 1.05) = 2
  hero.level = 10;
  assert.equal(getManaRegen(state, hero), 4); // 2 x 1.5 = 3
});

test('getSightRadius: 5 + Scouting + artifacts', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  assert.equal(getSightRadius(state, hero), 5);
  setSkills(hero, { scouting: 1 });
  assert.equal(getSightRadius(state, hero), 6);
  setSkills(hero, { scouting: 3 });
  assert.equal(getSightRadius(state, hero), 8);
  giveArtifact(hero, 'speculum');
  giveArtifact(hero, 'spyglass');
  assert.equal(getSightRadius(state, hero), 10);
});

// ---------------------------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------------------------

test('land movement table by the slowest creature', () => {
  const expected = { 3: 1500, 4: 1560, 5: 1630, 6: 1700, 7: 1760, 8: 1830, 9: 1900, 10: 1960, 11: 2000, 12: 2000, 13: 2000 };
  assert.deepEqual(LAND_MOVE_BY_SPEED, { 3: 1500, 4: 1560, 5: 1630, 6: 1700, 7: 1760, 8: 1830, 9: 1900, 10: 1960, 11: 2000 });
  for (const [speed, points] of Object.entries(expected)) {
    const c = CREATURES.find((x) => x.speed === Number(speed) && !x.warMachine);
    assert.ok(c, `creature with speed ${speed}`);
    assert.equal(landMoveBase(army([c.id, 3])), points, `speed ${speed}`);
  }
  // the slowest stack decides
  assert.equal(landMoveBase(army(['angel', 1], ['dwarf', 1], ['pikeman', 1])), 1500);
  assert.equal(landMoveBase(army(['angel', 1], ['pikeman', 1])), 1560);
});

test('getMaxMovePoints on land: base x Logistics + artifacts + temp (stables)', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin', [['pikeman', 5]]);
  assert.equal(getMaxMovePoints(state, hero), 1560);
  assert.equal(hero.maxMovePoints, 1560);
  assert.equal(hero.movePoints, 1560);
  setSkills(hero, { logistics: 1 });
  assert.equal(getMaxMovePoints(state, hero), 1716); // 1560 x 1.1
  setSkills(hero, { logistics: 2 });
  assert.equal(getMaxMovePoints(state, hero), 1872);
  setSkills(hero, { logistics: 3 });
  assert.equal(getMaxMovePoints(state, hero), 2028);
  giveArtifact(hero, 'boots_of_speed'); // +600
  assert.equal(getMaxMovePoints(state, hero), 2628);
  giveArtifact(hero, 'equestrians_gloves'); // +300
  assert.equal(getMaxMovePoints(state, hero), 2928);
  addTempBonus(state, hero.id, 'stables', { type: 'movement_land', value: 400 }, 'end_of_week');
  assert.equal(getMaxMovePoints(state, hero), 3328);
  // sea bonuses do not leak into land movement
  giveArtifact(hero, 'necklace_of_ocean_guidance');
  assert.equal(getMaxMovePoints(state, hero), 3328);
});

test('Logistics specialty: percent x (1 + 5% x level)', () => {
  const state = createTestState();
  const hero = mk(state, 'gunnar', [['pikeman', 5]]); // Basic Logistics, Logistics specialty
  assert.equal(getMaxMovePoints(state, hero), 1723); // 1560 x 1.105 = 1723.8
  hero.level = 20;
  assert.equal(getMaxMovePoints(state, hero), 1872); // 10% x 2 = 20%
});

test('sea movement: 1500 x Navigation + artifacts + lighthouses', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin', [['dwarf', 5]]);
  hero.inBoat = true;
  assert.equal(getMaxMovePoints(state, hero), 1500); // army speed is irrelevant at sea
  assert.equal(getMaxMovePoints(state, hero, { sea: false }), 1500);
  setSkills(hero, { navigation: 1 });
  assert.equal(getMaxMovePoints(state, hero), 2250);
  setSkills(hero, { navigation: 2 });
  assert.equal(getMaxMovePoints(state, hero), 3000);
  setSkills(hero, { navigation: 3 });
  assert.equal(getMaxMovePoints(state, hero), 3750);
  giveArtifact(hero, 'necklace_of_ocean_guidance'); // +1000
  giveArtifact(hero, 'sea_captains_hat'); // +500
  assert.equal(getMaxMovePoints(state, hero), 5250);
  // town Lighthouse: once per building id, however many towns have it
  addTestTown(state, { owner: 0, buildings: ['castle_lighthouse'] });
  assert.equal(getMaxMovePoints(state, hero), 5750);
  addTestTown(state, { owner: 0, buildings: ['castle_lighthouse'] });
  assert.equal(getMaxMovePoints(state, hero), 5750);
  addTestTown(state, { owner: 1, buildings: ['castle_lighthouse'] });
  assert.equal(getMaxMovePoints(state, hero), 5750);
  // flagged adventure lighthouses are cumulative
  state.map.objects.o90 = { id: 'o90', defId: 'lighthouse', pos: { x: 5, y: 5, z: 0 }, owner: 0, data: {} };
  state.map.objects.o91 = { id: 'o91', defId: 'lighthouse', pos: { x: 6, y: 5, z: 0 }, owner: 0, data: {} };
  state.map.objects.o92 = { id: 'o92', defId: 'lighthouse', pos: { x: 7, y: 5, z: 0 }, owner: 1, data: {} };
  assert.equal(getMaxMovePoints(state, hero), 6750);
  assert.equal(getMaxMovePoints(state, hero, { sea: false }), 1500);
});

test('Navigation specialty (Sylvia)', () => {
  const state = createTestState();
  const hero = mk(state, 'sylvia');
  assert.equal(getMaxMovePoints(state, hero, { sea: true }), 2287); // 1500 x 1.525
});

test('getTerrainPenaltyReduction: Pathfinding points vs artifact percent (capped 100)', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  assert.deepEqual(getTerrainPenaltyReduction(state, hero), { points: 0, level: 0, percent: 0 });
  setSkills(hero, { pathfinding: 2 });
  assert.deepEqual(getTerrainPenaltyReduction(state, hero), { points: 50, level: 2, percent: 0 });
  giveArtifact(hero, 'wayfarers_boots');
  temp(state, hero, { type: 'terrain_penalty_reduction', percent: 25 });
  assert.deepEqual(getTerrainPenaltyReduction(state, hero), { points: 50, level: 2, percent: 100 });
});

// ---------------------------------------------------------------------------------------------
// Town buildings
// ---------------------------------------------------------------------------------------------

test('player_hero_bonus: owner-wide, de-duplicated per building id; other players unaffected', () => {
  const state = createTestState();
  addTestTown(state, { owner: 0, buildings: ['castle_grail', 'tavern'] });
  addTestTown(state, { owner: 0, buildings: ['castle_grail'] });
  addTestTown(state, { faction: 'rampart', owner: 0, buildings: ['rampart_grail'] });
  addTestTown(state, { faction: 'factory', owner: 0, buildings: ['factory_grail'] });
  const b = getTownBuildingBonuses(state, 0);
  assert.equal(sumBonus(b, 'morale'), 3); // Colossus 2 (once) + Perpetual Engine 1
  assert.equal(sumBonus(b, 'luck'), 2);
  assert.equal(sumBonus(b, 'mana_regen'), 3);
  assert.deepEqual(getTownBuildingBonuses(state, 1), []);
  assert.deepEqual(getTownBuildingBonuses(state, null), []);
  const mine = mk(state, 'orrin');
  const theirs = mk(state, 'sorsha', [['pikeman', 5]], 1);
  assert.equal(getArmyLuck(state, { hero: mine }), 2);
  assert.equal(getArmyLuck(state, { hero: theirs }), 0);
});

test('necromancy_bonus buildings stack per town', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  assert.deepEqual(getNecromancyInfo(state, hero), { percent: 0, level: 0, creatureId: 'skeleton', active: false });
  addTestTown(state, { faction: 'necropolis', owner: 0, buildings: ['necropolis_necromancy_amplifier'] });
  addTestTown(state, { faction: 'necropolis', owner: 0, buildings: ['necropolis_necromancy_amplifier', 'necropolis_grail'] });
  assert.equal(getNecromancyInfo(state, hero).percent, 40); // 10 + 10 + 20, even without the skill
});

test('getGarrisonBonuses lists garrison_bonus effects of one town', () => {
  const state = createTestState();
  const t = addTestTown(state, { faction: 'fortress', owner: 0, buildings: ['fort', 'tavern', 'fortress_glyphs_of_fear', 'fortress_blood_obelisk'] });
  const g = getGarrisonBonuses(state, t.id);
  assert.deepEqual(g.map((x) => [x.stat, x.value]), [['morale', 1], ['defense', 2], ['attack', 2]]);
  assert.deepEqual(getGarrisonBonuses(state, 'nope'), []);
});

// ---------------------------------------------------------------------------------------------
// Morale
// ---------------------------------------------------------------------------------------------

test('alignmentMorale: +1 one town, 0 two, -1 three, -2 four, ...', () => {
  const mixes = [
    [[['pikeman'], ['archer'], ['angel']], 1],
    [[['pikeman'], ['centaur']], 0],
    [[['pikeman'], ['centaur'], ['gremlin']], -1],
    [[['pikeman'], ['centaur'], ['gremlin'], ['gnoll']], -2],
    [[['pikeman'], ['centaur'], ['gremlin'], ['gnoll'], ['goblin']], -3],
    [[['pikeman'], ['centaur'], ['gremlin'], ['gnoll'], ['goblin'], ['imp']], -4],
    [[['peasant']], 1], // neutrals are an alignment of their own
    [[['pikeman'], ['peasant']], 0],
  ];
  for (const [stacks, value] of mixes) {
    assert.equal(alignmentMorale(army(...stacks)).value, value, JSON.stringify(stacks));
  }
  assert.deepEqual(alignmentMorale([]), { count: 0, value: 0 });
  // Angelic Alliance merges the listed factions
  const merged = ['castle', 'rampart', 'tower', 'fortress', 'stronghold'];
  assert.equal(alignmentMorale(army(['pikeman'], ['centaur'], ['gremlin'], ['gnoll'], ['goblin']), merged).value, 1);
  assert.equal(alignmentMorale(army(['pikeman'], ['centaur'], ['imp']), merged).value, 0);
});

test('army morale without a hero (neutral stacks, garrisons)', () => {
  const state = createTestState();
  assert.equal(getArmyMorale(state, { army: army(['pikeman', 10]) }), 1);
  assert.equal(getArmyMorale(state, { army: army(['pikeman'], ['centaur'], ['gremlin'], ['gnoll']) }), -2);
  assert.equal(getArmyMorale(state, { army: army(['pikeman'], ['centaur'], ['gremlin'], ['gnoll'], ['goblin'], ['imp'], ['peasant']) }), -3); // clamp
  assert.equal(getArmyMorale(state, { army: [] }), 0);
});

test('undead in the army: -1 for the living, undead-only armies are neutral', () => {
  const state = createTestState();
  const mixed = getArmyMoraleDetails(state, { army: army(['pikeman', 5], ['skeleton', 5]) });
  assert.equal(mixed.value, -1); // two alignments 0, undead -1
  assert.deepEqual(mixed.perStack.slice(0, 2), [-1, 0]);
  const dead = getArmyMoraleDetails(state, { army: army(['skeleton', 5], ['lich', 2]) });
  assert.equal(dead.value, 0);
  assert.equal(dead.applies, false);
  assert.deepEqual(dead.perStack.slice(0, 2), [0, 0]);
  assert.equal(creatureUsesMorale('skeleton'), false);
  assert.equal(creatureUsesMorale('stone_golem'), false);
  assert.equal(creatureUsesMorale('air_elemental'), false);
  assert.equal(creatureUsesMorale('ballista'), false);
  assert.equal(creatureUsesMorale('pikeman'), true);
  // golems are not undead: no -1, but they do not use morale themselves
  const tower = getArmyMoraleDetails(state, { army: army(['gremlin', 5], ['stone_golem', 2]) });
  assert.equal(tower.value, 1);
  assert.deepEqual(tower.perStack.slice(0, 2), [1, 0]);
});

test('Leadership, artifacts, temp bonuses and the -3..+3 clamp', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin', [['pikeman', 5]]); // Basic Leadership
  assert.equal(getArmyMorale(state, { hero }), 2);
  setSkills(hero, { leadership: 3 });
  assert.equal(getArmyMorale(state, { hero }), 3); // 1 + 3 = 4 -> clamp
  assert.equal(getArmyMoraleDetails(state, { hero }).raw, 4);
  setSkills(hero, {});
  assert.equal(getArmyMorale(state, { hero }), 1);
  giveArtifact(hero, 'badge_of_courage');
  assert.equal(getArmyMorale(state, { hero }), 2);
  temp(state, hero, { type: 'morale', value: -3 }, 'warriors_tomb');
  assert.equal(getArmyMorale(state, { hero }), -1);
  temp(state, hero, { type: 'morale', value: -3 }, 'graveyard');
  assert.equal(getArmyMorale(state, { hero }), -3);
  // `army` overrides the hero's own army
  assert.equal(getArmyMorale(state, { hero: hero.id, army: army(['pikeman'], ['imp']) }), -3);
  const d = getArmyMoraleDetails(state, { hero });
  assert.ok(d.items.some((i) => i.source === 'temp:graveyard' && i.value === -3));
  assert.ok(d.items.some((i) => i.source === 'alignment' && i.value === 1));
});

test('angel aura +1 (not stacking), minotaurs never below +1', () => {
  const state = createTestState();
  assert.equal(getArmyMorale(state, { army: army(['angel', 1]) }), 2);
  assert.equal(getArmyMorale(state, { army: army(['angel', 1], ['arch_angel', 1], ['pikeman', 1]) }), 2);
  const d = getArmyMoraleDetails(state, { army: army(['minotaur', 3], ['pikeman', 3], ['gremlin', 1], ['gnoll', 1]) });
  assert.equal(d.value, -2);
  assert.deepEqual(d.perStack.slice(0, 4), [1, -2, -2, -2]);
});

test('enemy effects: Hideous Mask, Pendant of Downfall, bone dragons', () => {
  const state = createTestState();
  const hero = mk(state, 'sorsha', [['pikeman', 5]]);
  setSkills(hero, {});
  const foe = mk(state, 'sandro', [['skeleton', 20]], 1);
  assert.equal(getArmyMorale(state, { hero, enemy: { hero: foe } }), 1);
  giveArtifact(foe, 'hideous_mask');
  assert.equal(getArmyMorale(state, { hero, enemy: { hero: foe } }), 0);
  giveArtifact(foe, 'pendant_of_downfall');
  assert.equal(getArmyMorale(state, { hero, enemy: { hero: foe } }), -2);
  // creature aura: one or two bone dragon stacks = -1
  assert.equal(getArmyMorale(state, { hero, enemy: { army: army(['bone_dragon', 1]) } }), 0);
  assert.equal(getArmyMorale(state, { hero, enemy: { army: army(['bone_dragon', 1], ['ghost_dragon', 1]) } }), 0);
  // the enemy's own morale is not touched by his mask
  assert.equal(getArmyMoraleDetails(state, { hero: foe, enemy: { hero } }).items.some((i) => i.source.startsWith('enemy')), false);
});

test('Spirit of Oppression blocks positive morale for both sides, negative stays', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin', [['pikeman', 5]]);
  const foe = mk(state, 'sorsha', [['pikeman', 5]], 1);
  giveArtifact(foe, 'spirit_of_oppression');
  const mine = getArmyMoraleDetails(state, { hero, enemy: { hero: foe } });
  assert.equal(mine.value, 0);
  assert.equal(mine.blockedPositive, true);
  assert.deepEqual(mine.perStack[0], 0);
  assert.equal(getArmyMorale(state, { hero: foe, enemy: { hero } }), 0);
  temp(state, hero, { type: 'morale', value: -4 });
  assert.equal(getArmyMorale(state, { hero, enemy: { hero: foe } }), -2);
  // minotaurs lose their guarantee too
  assert.deepEqual(getArmyMoraleDetails(state, { army: army(['minotaur', 1]), enemy: { hero: foe } }).perStack[0], 0);
});

test('Angelic Alliance removes the mixed-army penalty for good/neutral towns', () => {
  const state = createTestState();
  const hero = mk(state, 'sorsha', [['pikeman', 1], ['centaur', 1], ['gremlin', 1]]);
  setSkills(hero, {});
  assert.equal(getArmyMorale(state, { hero }), -1);
  const res = giveArtifact(hero, 'angelic_alliance');
  assert.equal(res.ok, true);
  assert.equal(res.events[0].where, 'equipped');
  assert.equal(getArmyMorale(state, { hero }), 1);
  hero.army[3] = { creatureId: 'imp', count: 1 };
  assert.equal(getArmyMorale(state, { hero }), 0);
});

test('town garrison bonuses apply to the defender in a siege only', () => {
  const state = createTestState();
  const t = addTestTown(state, { owner: 0, buildings: ['fort', 'tavern', 'castle_brotherhood_of_the_sword'] });
  const a = army(['pikeman', 10]);
  assert.equal(getArmyMorale(state, { army: a, townId: t.id }), 3); // 1 + tavern 1 + brotherhood 1
  assert.equal(getArmyMorale(state, { army: a, townId: t.id, siege: false }), 1);
  const r = addTestTown(state, { faction: 'rampart', owner: 0, buildings: ['fort', 'rampart_fountain_of_fortune'] });
  assert.equal(getArmyLuck(state, { army: a, townId: r.id }), 2);
  assert.equal(getArmyLuck(state, { army: a }), 0);
});

test('magic terrain overlays: per alignment, cursed ground nullifies', () => {
  const state = createTestState();
  const a = army(['pikeman', 1], ['imp', 1], ['minotaur', 1]); // good, evil, evil(+positive_morale): 3 towns -> -1
  const holy = getArmyMoraleDetails(state, { army: a, overlay: 'holy_ground' });
  assert.deepEqual(holy.perStack.slice(0, 3), [0, -2, 1]);
  const fog = getArmyMoraleDetails(state, { army: a, overlay: 'evil_fog' });
  assert.deepEqual(fog.perStack.slice(0, 3), [-2, 0, 1]);
  const cursed = getArmyMoraleDetails(state, { army: a, overlay: 'cursed_ground' });
  assert.equal(cursed.value, 0);
  assert.equal(cursed.nullified, true);
  assert.deepEqual(cursed.perStack.slice(0, 3), [0, 0, 0]);
  assert.equal(getArmyLuck(state, { army: a, overlay: 'cursed_ground' }), 0);
  // luck overlays
  const glory = getArmyLuckDetails(state, { army: a, overlay: 'fields_of_glory' });
  assert.deepEqual(glory.perStack.slice(0, 3), [2, 2, 2]);
  const clover = getArmyLuckDetails(state, { army: army(['pikeman', 1], ['air_elemental', 1], ['peasant', 1]), overlay: 'clover_field' });
  assert.deepEqual(clover.perStack.slice(0, 3), [0, 2, 2]); // conflux and neutral creatures are neutral-aligned
});

// ---------------------------------------------------------------------------------------------
// Luck
// ---------------------------------------------------------------------------------------------

test('luck: skill, artifacts, temp, enemy reductions, Hourglass, clamp', () => {
  const state = createTestState();
  const hero = mk(state, 'sorsha', [['pikeman', 5], ['skeleton', 5]]);
  setSkills(hero, {});
  const foe = mk(state, 'orrin', [['pikeman', 5]], 1);
  assert.equal(getArmyLuck(state, { hero }), 0);
  setSkills(hero, { luck: 2 });
  assert.equal(getArmyLuck(state, { hero }), 2);
  giveArtifact(hero, 'clover_of_fortune');
  assert.equal(getArmyLuck(state, { hero }), 3);
  giveArtifact(hero, 'still_eye_of_the_dragon');
  assert.equal(getArmyLuck(state, { hero }), 3); // 4 -> clamp
  assert.equal(getArmyLuckDetails(state, { hero }).raw, 4);
  // undead do use luck
  assert.deepEqual(getArmyLuckDetails(state, { hero }).perStack.slice(0, 2), [3, 3]);
  giveArtifact(foe, 'runes_of_imminency'); // enemy luck -1
  assert.equal(getArmyLuck(state, { hero, enemy: { hero: foe } }), 3);
  assert.equal(getArmyLuckDetails(state, { hero, enemy: { hero: foe } }).raw, 3);
  foe.army[1] = { creatureId: 'devil', count: 1 }; // devils: enemy luck -1
  assert.equal(getArmyLuck(state, { hero, enemy: { hero: foe } }), 2);
  giveArtifact(foe, 'hourglass_of_the_evil_hour');
  assert.equal(getArmyLuck(state, { hero, enemy: { hero: foe } }), 0);
  temp(state, hero, { type: 'luck', value: -6 }, 'pyramid');
  assert.equal(getArmyLuck(state, { hero, enemy: { hero: foe } }), -3);
});

test('halflings are never unlucky', () => {
  const state = createTestState();
  const foe = mk(state, 'orrin', [['devil', 1]], 1);
  const d = getArmyLuckDetails(state, { army: army(['halfling', 5], ['pikeman', 5]), enemy: { hero: foe } });
  assert.equal(d.value, -1);
  assert.deepEqual(d.perStack.slice(0, 2), [1, -1]);
});

// ---------------------------------------------------------------------------------------------
// Necromancy, magic, misc getters
// ---------------------------------------------------------------------------------------------

test('getNecromancyInfo: skill x specialty + artifacts, cap, Cloak of the Undead King tiers', () => {
  const state = createTestState();
  const isra = mk(state, 'isra', [['skeleton', 10]]); // Advanced Necromancy + specialty
  assert.deepEqual(getNecromancyInfo(state, isra), { percent: 21, level: 2, creatureId: 'skeleton', active: true });
  isra.level = 10;
  assert.equal(getNecromancyInfo(state, isra).percent, 30); // 20 x 1.5
  giveArtifact(isra, 'amulet_of_the_undertaker');
  giveArtifact(isra, 'vampires_cowl');
  giveArtifact(isra, 'dead_mans_boots');
  assert.equal(getNecromancyInfo(state, isra).percent, 60); // +5 +10 +15
  temp(state, isra, { type: 'necromancy_percent', percent: 80 });
  assert.equal(getNecromancyInfo(state, isra).percent, 100);
  // the cloak picks the creature by Necromancy mastery
  const cloak = { type: 'necromancy_raise', creatures: ['skeleton', 'walking_dead', 'wight', 'lich'] };
  const knight = mk(state, 'orrin');
  temp(state, knight, cloak);
  temp(state, knight, { type: 'necromancy_percent', percent: 30 });
  assert.deepEqual(getNecromancyInfo(state, knight), { percent: 30, level: 0, creatureId: 'skeleton', active: true });
  for (const [level, id] of [[1, 'walking_dead'], [2, 'wight'], [3, 'lich']]) {
    setSkills(knight, { necromancy: level });
    assert.equal(getNecromancyInfo(state, knight).creatureId, id);
  }
});

test('magic getters: Wisdom level, school mastery, Eagle Eye, Scholar', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  assert.equal(getLearnSpellLevel(state, hero), 2);
  assert.deepEqual(getSchoolMastery(state, hero), { air: 0, earth: 0, fire: 0, water: 0 });
  assert.equal(getEagleEye(state, hero), null);
  assert.equal(getScholarLevel(state, hero), 0);
  setSkills(hero, { wisdom: 2, air_magic: 3, fire_magic: 1, eagle_eye: 2, scholar: 3 });
  assert.equal(getLearnSpellLevel(state, hero), 4);
  assert.deepEqual(getSchoolMastery(state, hero), { air: 3, earth: 0, fire: 1, water: 0 });
  assert.deepEqual(getEagleEye(state, hero), { percent: 50, maxLevel: 3 });
  giveArtifact(hero, 'bird_of_perception');
  assert.deepEqual(getEagleEye(state, hero), { percent: 55, maxLevel: 3 });
  assert.equal(getScholarLevel(state, hero), 4);
  // artifacts alone do not give Eagle Eye
  setSkills(hero, {});
  assert.equal(getEagleEye(state, hero), null);
  // mastery specialty (Adrienne: expert Fire Magic)
  const adrienne = mk(state, 'adrienne', [['pikeman', 1]]);
  assert.equal(getSchoolMastery(state, adrienne).fire, 3);
});

test('Learning, Diplomacy, surrender cost, negotiation strength', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  assert.equal(getExperienceMultiplier(state, hero), 1);
  assert.deepEqual(getDiplomacy(state, hero), { level: 0, joinPercent: 0, surrenderDiscountPercent: 0 });
  assert.equal(getSurrenderCostMultiplier(state, hero), 1);
  assert.equal(getNegotiationStrengthMultiplier(state, hero), 1);
  setSkills(hero, { learning: 3, diplomacy: 2 });
  giveArtifact(hero, 'scholars_monocle');
  assert.equal(getExperienceMultiplier(state, hero), 1.25);
  assert.deepEqual(getDiplomacy(state, hero), { level: 2, joinPercent: 50, surrenderDiscountPercent: 40 });
  assert.ok(Math.abs(getSurrenderCostMultiplier(state, hero) - 0.6) < 1e-9);
  giveArtifact(hero, 'statesmans_medal');
  assert.ok(Math.abs(getSurrenderCostMultiplier(state, hero) - 0.5) < 1e-9);
  setSkills(hero, { diplomacy: 3 });
  giveArtifact(hero, 'diplomats_ring');
  giveArtifact(hero, 'ambassadors_sash');
  assert.ok(Math.abs(getSurrenderCostMultiplier(state, hero) - 0.1) < 1e-9); // 60 + 30 = 90 (cap)
  temp(state, hero, { type: 'surrender_cost_percent', percent: -10 });
  assert.ok(Math.abs(getSurrenderCostMultiplier(state, hero) - 0.1) < 1e-9);
  temp(state, hero, { type: 'army_strength_percent', percent: 200 });
  assert.equal(getNegotiationStrengthMultiplier(state, hero), 3);
});

test('creature specialty and speed specialty bonuses are passed through for combat', () => {
  const state = createTestState();
  const mullich = mk(state, 'sir_mullich');
  assert.ok(getHeroBonuses(state, mullich).some((b) => b.type === 'creature_stat' && b.stat === 'speed' && b.value === 2 && !b.filter));
  const galthran = mk(state, 'galthran', [['skeleton', 10]]);
  galthran.level = 7;
  const spec = getHeroBonuses(state, galthran).find((b) => b.type === 'creature_specialty');
  assert.deepEqual(spec.creatures, ['skeleton', 'skeleton_warrior']);
  assert.equal(spec.heroLevel, 7);
});
