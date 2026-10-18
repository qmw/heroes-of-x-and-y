import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestState, addTestTown } from '../../src/engine/testing.js';
import {
  addHero, removeHero, dismissHero, canAddHero, giveExperience, canLearnSpell, learnSpell,
  learnSpellError, getHeroSpells, getGrantedSpells, addTempBonus, hasTempBonus, expireTempBonuses,
  startOfDayHero, tradeArmy, tradeArtifact, meetHeroes, applyEagleEye, computeNecromancy,
  buildCombatSide, startCombat, finishCombat, quickCombat, registerCombatOutcome, setCombatEngine,
  getCombatEngine, setTownModule, getTownDefender, getSurrenderCost, siegeInfoFor, engineReady,
  HERO_DEFEAT_EXP, dismissStack, moveHeroArtifact, setHeroAsleep, getSpecialtyUpgrades, specialtyUpgrade,
} from '../../src/engine/hero.js';
import { getMaxMana, getMaxMovePoints } from '../../src/engine/bonuses.js';
import { giveArtifact, hasArtifact, ownsArtifact, makeScroll, removeArtifact } from '../../src/engine/artifacts.js';
import { resolvePending, getPending } from '../../src/engine/pending.js';
import { expForLevel } from '../../src/engine/leveling.js';
import { armyCount, armyIsEmpty, armyStackCount } from '../../src/engine/army.js';
import { SPELLS, getSpell } from '../../src/data/spells.js';

const army = (...pairs) => pairs.map(([creatureId, count]) => ({ creatureId, count: count ?? 1 }));
const pad7 = (a) => { const out = a.slice(); while (out.length < 7) out.push(null); return out; };

function mk(state, defId, stacks = [['pikeman', 10]], playerId = 0, pos) {
  const n = Object.keys(state.heroes).length;
  return addHero(state, defId, playerId, pos || { x: 1 + n, y: 1, z: 0 }, { army: army(...stacks) });
}
const setSkills = (hero, obj) => { hero.skills = Object.entries(obj).map(([id, level]) => ({ id, level })); };
const roundTrip = (state) => assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

/** Fake combat engine: the test supplies the CombatResult. */
function fakeEngine(resultFn) {
  const calls = { inputs: [] };
  const engine = {
    calls,
    createCombat(input) { calls.inputs.push(input); return { input, over: false, result: null }; },
    isOver(cs) { return cs.over; },
    getResult(cs) { return cs.result; },
    autoResolve(cs) { cs.over = true; cs.result = resultFn(cs.input); return cs.result; },
  };
  return engine;
}
function sideResult(armyLeft, extra = {}) {
  return { army: pad7(armyLeft), losses: {}, manaLeft: undefined, heroFled: false, heroSurrendered: false, warMachinesLost: [], ...extra };
}
function withEngine(resultFn, fn) {
  const prev = getCombatEngine();
  const engine = fakeEngine(resultFn);
  setCombatEngine(engine);
  setTownModule({});
  try { return fn(engine); } finally { setCombatEngine(prev); }
}

await engineReady;

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

test('addHero registers the hero, generates ids from state.nextId, computes mana/movement', () => {
  const state = createTestState();
  const a = addHero(state, 'orrin', 0, { x: 3, y: 4, z: 0 });
  const b = addHero(state, 'sandro', 1, { x: 5, y: 5 });
  assert.equal(a.id, 'h1');
  assert.equal(b.id, 'h2');
  assert.equal(state.nextId, 3);
  assert.equal(state.heroes.h1, a);
  assert.deepEqual(state.players[0].heroes, ['h1']);
  assert.deepEqual(state.players[1].heroes, ['h2']);
  assert.deepEqual(a.pos, { x: 3, y: 4, z: 0 });
  assert.deepEqual(b.pos, { x: 5, y: 5, z: 0 });
  assert.equal(a.owner, 0);
  assert.equal(a.level, 1);
  assert.equal(a.army.length, 7);
  assert.equal(a.maxMovePoints, 1560); // pikemen, speed 4
  assert.equal(a.movePoints, 1560);
  assert.equal(b.maxMovePoints, 1500); // walking dead, speed 3
  assert.equal(b.mana, getMaxMana(state, b));
  assert.equal(canAddHero(state, 0), true);
  assert.throws(() => addHero(state, 'nobody', 0, { x: 0, y: 0 }));
  roundTrip(state);
});

test('addHero options: explicit id, army, tavern (single stack)', () => {
  const state = createTestState();
  const a = addHero(state, 'orrin', 0, { x: 1, y: 1 }, { id: 'hero_x', army: army(['angel', 2]) });
  assert.equal(a.id, 'hero_x');
  assert.equal(armyCount(a.army, 'angel'), 2);
  assert.equal(a.maxMovePoints, 2000);
  const t = addHero(state, 'sorsha', 0, { x: 2, y: 1 }, { tavern: true });
  assert.equal(armyStackCount(t.army), 1);
  assert.equal(t.army[0].creatureId, 'pikeman');
  // ownerless hero (prison / tavern preview)
  const n = addHero(state, 'edric', null, { x: 3, y: 1 });
  assert.equal(n.owner, null);
  assert.equal(state.players.every((p) => !p.heroes.includes(n.id)), true);
});

test('removeHero / dismissHero unregister everywhere', () => {
  const state = createTestState();
  const a = mk(state, 'orrin');
  const b = mk(state, 'sorsha');
  const town = addTestTown(state, { owner: 0 });
  town.visitingHero = a.id;
  town.garrisonHero = b.id;
  const res = removeHero(state, a.id, 'defeated');
  assert.equal(res.ok, true);
  assert.deepEqual(res.events[0], { type: 'hero_removed', heroId: a.id, defId: 'orrin', playerId: 0, reason: 'defeated', toTavern: false, toPool: true });
  assert.equal(state.heroes[a.id], undefined);
  assert.deepEqual(state.players[0].heroes, [b.id]);
  assert.equal(town.visitingHero, null);
  assert.equal(dismissHero(state, b.id).ok, true);
  assert.equal(town.garrisonHero, null);
  assert.deepEqual(state.players[0].heroes, []);
  assert.equal(removeHero(state, 'h99').error, 'no_such_hero');
  assert.equal(dismissHero(state, 'h99').error, 'no_such_hero');
  // the defeated hero went back to the global pool (no tavern slot), the dismissed one is gone
  assert.deepEqual(Object.keys(state.heroPool), ['orrin']);
  assert.ok(!(state.players[0].tavernHeroes || []).includes('orrin'));
  roundTrip(state);
});

// ---------------------------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------------------------

test('giveExperience applies Learning and artifacts', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  let res = giveExperience(state, hero.id, 500);
  assert.equal(res.gained, 500);
  assert.equal(hero.exp, 500);
  setSkills(hero, { learning: 1 });
  res = giveExperience(state, hero.id, 199);
  assert.equal(res.gained, 208); // floor(199 x 1.05 = 208.95)
  setSkills(hero, { learning: 3 });
  giveArtifact(hero, 'scholars_monocle');
  res = giveExperience(state, hero.id, 100);
  assert.equal(res.gained, 125);
  res = giveExperience(state, hero.id, 100, { raw: true });
  assert.equal(res.gained, 100);
  assert.equal(hero.exp, 933);
  assert.equal(hero.level, 1);
  assert.deepEqual(giveExperience(state, hero.id, 0), { ok: true, events: [] });
  assert.equal(giveExperience(state, 'h99', 10).error, 'no_such_hero');
});

test('a level-up rolls a primary skill at once and queues a level_up pending', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  const before = { ...hero.primary };
  const skillsBefore = hero.skills.reduce((n, s) => n + s.level, 0);
  const res = giveExperience(state, hero.id, 1000);
  assert.equal(hero.level, 2);
  assert.equal(res.levels, 1);
  const sum = (p) => p.attack + p.defense + p.power + p.knowledge;
  assert.equal(sum(hero.primary), sum(before) + 1);
  const lvl = res.events.find((e) => e.type === 'hero_level_up');
  assert.equal(lvl.level, 2);
  assert.equal(hero.primary[lvl.primary], before[lvl.primary] + 1);
  const pend = getPending(state, 0);
  assert.equal(pend.length, 1);
  assert.equal(pend[0].kind, 'level_up');
  assert.equal(pend[0].heroId, hero.id);
  assert.equal(pend[0].options.length, 2);
  assert.equal(pend[0].data.remaining, 0);
  assert.equal(pend[0].data.level, 2);
  assert.equal(hero.skills.reduce((n, s) => n + s.level, 0), skillsBefore); // not applied yet
  roundTrip(state);
  const choice = pend[0].options[1];
  const done = resolvePending(state, pend[0].id, 1);
  assert.equal(done.ok, true);
  assert.deepEqual(done.events[0], { type: 'skill_learned', heroId: hero.id, skillId: choice.skillId, level: choice.level });
  assert.equal(hero.skills.find((s) => s.id === choice.skillId).level, choice.level);
  assert.equal(getPending(state).length, 0);
});

test('several level-ups at once are resolved as a chain, one pending at a time', () => {
  const state = createTestState({ seed: 7 });
  const hero = mk(state, 'orrin');
  const skillsBefore = hero.skills.reduce((n, s) => n + s.level, 0);
  const res = giveExperience(state, hero.id, expForLevel(6)); // 6200 -> level 6
  assert.equal(hero.level, 6);
  assert.equal(res.levels, 5);
  assert.equal(res.events.filter((e) => e.type === 'hero_level_up').length, 5);
  let resolved = 0;
  const seenRemaining = [];
  while (getPending(state).length > 0) {
    const pend = getPending(state);
    assert.equal(pend.length, 1);
    seenRemaining.push(pend[0].data.remaining);
    // every offered option is applicable to the hero as he is NOW
    for (const o of pend[0].options) {
      const cur = hero.skills.find((s) => s.id === o.skillId)?.level || 0;
      assert.equal(o.level, cur + 1);
    }
    assert.equal(resolvePending(state, pend[0].id, 0).ok, true);
    resolved++;
  }
  assert.equal(resolved, 5);
  assert.deepEqual(seenRemaining, [4, 3, 2, 1, 0]);
  assert.deepEqual(seenRemaining.map((r) => 6 - r), [2, 3, 4, 5, 6]);
  assert.equal(hero.skills.reduce((n, s) => n + s.level, 0), skillsBefore + 5);
  roundTrip(state);
});

test('experience gained while a choice is pending extends the chain', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  giveExperience(state, hero.id, 1000);
  const first = getPending(state)[0];
  giveExperience(state, hero.id, 1000); // level 3
  assert.equal(hero.level, 3);
  assert.equal(getPending(state).length, 1);
  assert.equal(first.data.remaining, 1);
  resolvePending(state, first.id, 0);
  assert.equal(getPending(state).length, 1);
  assert.equal(getPending(state)[0].data.remaining, 0);
  resolvePending(state, getPending(state)[0].id, 0);
  assert.equal(getPending(state).length, 0);
});

test('no pending when nothing can be offered; ownerless heroes choose automatically', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  setSkills(hero, { leadership: 3, archery: 3, offense: 3, armorer: 3, logistics: 3, tactics: 3, wisdom: 3, luck: 3 });
  giveExperience(state, hero.id, 5000);
  assert.equal(hero.level, 5);
  assert.equal(getPending(state).length, 0);
  assert.equal(hero.skills.length, 8);
  const free = addHero(state, 'sorsha', null, { x: 9, y: 9 });
  const before = free.skills.reduce((n, s) => n + s.level, 0);
  giveExperience(state, free.id, 2000);
  assert.equal(free.level, 3);
  assert.equal(getPending(state).length, 0);
  assert.equal(free.skills.reduce((n, s) => n + s.level, 0), before + 2);
});

test('removing a hero drops his pending level-up', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  giveExperience(state, hero.id, 1000);
  assert.equal(getPending(state).length, 1);
  removeHero(state, hero.id, 'defeated');
  assert.equal(getPending(state).length, 0);
});

// ---------------------------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------------------------

test('spell learning: spellbook, Wisdom levels, duplicates', () => {
  const state = createTestState();
  const knight = mk(state, 'orrin');
  assert.equal(hasArtifact(knight, 'spellbook'), false);
  assert.equal(canLearnSpell(state, knight, 'magic_arrow'), false);
  assert.equal(learnSpellError(state, knight, 'magic_arrow'), 'no_spellbook');
  assert.equal(learnSpell(state, knight.id, 'magic_arrow').error, 'no_spellbook');
  giveArtifact(knight, 'spellbook');
  assert.equal(canLearnSpell(state, knight, 'magic_arrow'), true); // level 1
  assert.equal(canLearnSpell(state, knight, 'lightning_bolt'), true); // level 2
  assert.equal(canLearnSpell(state, knight, 'fireball'), false); // level 3
  assert.equal(learnSpellError(state, knight, 'fireball'), 'wisdom_too_low');
  setSkills(knight, { wisdom: 1 });
  assert.equal(canLearnSpell(state, knight, 'fireball'), true);
  assert.equal(canLearnSpell(state, knight, 'chain_lightning'), false); // level 4
  setSkills(knight, { wisdom: 2 });
  assert.equal(canLearnSpell(state, knight, 'chain_lightning'), true);
  assert.equal(canLearnSpell(state, knight, 'implosion'), false); // level 5
  setSkills(knight, { wisdom: 3 });
  assert.equal(canLearnSpell(state, knight, 'implosion'), true);
  const res = learnSpell(state, knight.id, 'implosion');
  assert.deepEqual(res, { ok: true, events: [{ type: 'spell_learned', heroId: knight.id, spellId: 'implosion', via: null }] });
  assert.equal(learnSpell(state, knight.id, 'implosion').error, 'already_known');
  assert.equal(canLearnSpell(state, knight, 'titans_lightning_bolt'), false); // artifact-only
  assert.throws(() => canLearnSpell(state, knight, 'no_such_spell'));
  // force skips Wisdom only
  setSkills(knight, {});
  assert.equal(learnSpell(state, knight.id, 'fireball', { force: true }).ok, true);
  removeArtifact(knight, 'spellbook');
  assert.equal(learnSpell(state, knight.id, 'haste', { force: true }).error, 'no_spellbook');
  assert.deepEqual(getHeroSpells(state, knight), []); // no book, no spells
});

test('getHeroSpells merges scrolls, tomes, hats and item spells; they are not learned', () => {
  const state = createTestState();
  const hero = mk(state, 'sandro', [['skeleton', 10]]); // knows slow
  assert.deepEqual(getHeroSpells(state, hero), ['slow']);
  giveArtifact(hero, makeScroll('haste'));
  assert.deepEqual(getHeroSpells(state, hero), ['slow', 'haste']);
  giveArtifact(hero, 'tome_of_fire_magic');
  const fire = SPELLS.filter((s) => !s.creatureOnly && !s.special && (s.school === 'fire' || s.school === 'all')).map((s) => s.id);
  const spells = getHeroSpells(state, hero);
  for (const id of fire) assert.ok(spells.includes(id), id);
  assert.ok(spells.includes('fireball'));
  assert.ok(!spells.includes('lightning_bolt'));
  assert.equal(new Set(spells).size, spells.length);
  giveArtifact(hero, 'spellbinders_hat');
  const all = getHeroSpells(state, hero);
  assert.ok(all.includes('implosion'));
  assert.ok(!all.includes('titans_lightning_bolt'));
  assert.ok(all.every((id) => !getSpell(id).creatureOnly));
  assert.deepEqual(hero.spells, ['slow']);
  const granted = getGrantedSpells(state, hero);
  assert.ok(granted.some((g) => g.spellId === 'haste' && g.source === 'artifact:spell_scroll'));
  // Titan's Thunder style: mastery + free flags are reported
  addTempBonus(state, hero.id, 't', { type: 'grants_spell', spellId: 'titans_lightning_bolt', mastery: 3, free: true }, 'next_battle');
  const t = getGrantedSpells(state, hero).find((g) => g.spellId === 'titans_lightning_bolt');
  assert.deepEqual([t.mastery, t.free], [3, true]);
  assert.ok(getHeroSpells(state, hero).includes('titans_lightning_bolt'));
});

test('Scholar: allied heroes exchange spells up to the better Scholar level', () => {
  const state = createTestState();
  const a = mk(state, 'aine', [['gremlin', 10]]); // Basic Scholar (level <= 2), Basic Wisdom
  const b = mk(state, 'orrin');
  giveArtifact(b, 'spellbook');
  a.spells = ['magic_arrow', 'lightning_bolt', 'fireball'];
  b.spells = ['haste', 'chain_lightning'];
  let res = meetHeroes(state, a.id, b.id);
  assert.equal(res.ok, true);
  assert.deepEqual(a.spells, ['magic_arrow', 'lightning_bolt', 'fireball', 'haste']);
  assert.deepEqual(b.spells, ['haste', 'chain_lightning', 'magic_arrow', 'lightning_bolt']);
  assert.equal(res.events.filter((e) => e.type === 'spell_learned').length, 3);
  assert.ok(res.events.every((e) => e.type !== 'spell_learned' || e.via === 'scholar'));
  // Expert Scholar: level 4, but the receiver still needs Wisdom
  setSkills(a, { scholar: 3, wisdom: 2 });
  res = meetHeroes(state, b.id, a.id);
  assert.ok(a.spells.includes('chain_lightning')); // a has Advanced Wisdom
  assert.ok(!b.spells.includes('fireball')); // b has no Wisdom
  setSkills(b, { wisdom: 1 });
  meetHeroes(state, a.id, b.id);
  assert.ok(b.spells.includes('fireball'));
  // nothing new the second time
  assert.equal(meetHeroes(state, a.id, b.id).events.length, 1);
});

test('Scholar needs the skill, two spellbooks and the same owner', () => {
  const state = createTestState();
  const a = mk(state, 'orrin');
  const b = mk(state, 'sorsha');
  giveArtifact(a, 'spellbook');
  a.spells = ['haste'];
  setSkills(a, { scholar: 1 });
  meetHeroes(state, a.id, b.id); // b has no book
  assert.deepEqual(b.spells, []);
  giveArtifact(b, 'spellbook');
  setSkills(a, {});
  meetHeroes(state, a.id, b.id); // nobody has Scholar
  assert.deepEqual(b.spells, []);
  const foe = mk(state, 'aine', [['gremlin', 5]], 1);
  foe.spells = ['slow'];
  meetHeroes(state, a.id, foe.id);
  assert.deepEqual(a.spells, ['haste']);
  assert.equal(meetHeroes(state, a.id, a.id).error, 'same_hero');
  assert.equal(meetHeroes(state, a.id, 'h99').error, 'no_such_hero');
});

test('Eagle Eye learns enemy spells within its level limit and Wisdom', () => {
  const state = createTestState();
  const hero = mk(state, 'sanya', [['gremlin', 10]]); // Eagle Eye specialty, Basic Wisdom
  setSkills(hero, { eagle_eye: 3, wisdom: 1 });
  hero.level = 14; // 60% x 1.7 = 102% -> always
  hero.spells = [];
  const cast = ['haste', 'haste', 'fireball', 'chain_lightning', 'implosion'];
  const events = applyEagleEye(state, hero, cast);
  assert.deepEqual(hero.spells, ['haste', 'fireball']); // level 4 needs Advanced Wisdom, level 5 is beyond Eagle Eye
  assert.deepEqual(events.map((e) => [e.spellId, e.via]), [['haste', 'eagle_eye'], ['fireball', 'eagle_eye']]);
  setSkills(hero, { eagle_eye: 3, wisdom: 3 });
  applyEagleEye(state, hero, cast);
  assert.deepEqual(hero.spells, ['haste', 'fireball', 'chain_lightning']);
  // Basic: level <= 2 only
  setSkills(hero, { eagle_eye: 1, wisdom: 3 });
  hero.level = 30; // 40% x 2.5 = 100%
  hero.spells = [];
  applyEagleEye(state, hero, ['lightning_bolt', 'fireball']);
  assert.deepEqual(hero.spells, ['lightning_bolt']);
  // without the skill or without a list nothing happens
  setSkills(hero, { wisdom: 3 });
  assert.deepEqual(applyEagleEye(state, hero, ['bless']), []);
  setSkills(hero, { eagle_eye: 3 });
  assert.deepEqual(applyEagleEye(state, hero, undefined), []);
});

test('Eagle Eye chance is a real roll', () => {
  const state = createTestState({ seed: 42 });
  let learned = 0;
  for (let i = 0; i < 400; i++) {
    const hero = mk(state, 'orrin', [['pikeman', 1]], 0, { x: 0, y: 0 });
    giveArtifact(hero, 'spellbook');
    setSkills(hero, { eagle_eye: 1 }); // 40%
    if (applyEagleEye(state, hero, ['haste']).length) learned++;
    removeHero(state, hero.id, 'test');
  }
  assert.ok(learned > 120 && learned < 200, `learned ${learned} of 400`);
});

// ---------------------------------------------------------------------------------------------
// Temp bonuses and start of day
// ---------------------------------------------------------------------------------------------

test('addTempBonus + expiry rules', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  state.turn = 10;
  state.date = { day: 3, week: 2, month: 1 };
  assert.equal(addTempBonus(state, hero.id, 'temple', { type: 'morale', value: 1 }, 'next_battle').ok, true);
  addTempBonus(state, hero.id, 'day', { type: 'luck', value: 1 }, 'end_of_day');
  addTempBonus(state, hero.id, 'stables', { type: 'movement_land', value: 400 }, 'end_of_week');
  addTempBonus(state, hero.id, 'spell', { type: 'sight_radius', value: 2 }, 11);
  assert.equal(addTempBonus(state, hero.id, 'stables', { type: 'movement_land', value: 400 }, 'end_of_week', { unique: true }).error, 'already_active');
  assert.equal(hero.temp.length, 4);
  assert.equal(hasTempBonus(hero, 'temple'), true);
  assert.throws(() => addTempBonus(state, hero.id, 'x', { type: 'luck', value: 1 }, 'someday'));
  assert.equal(addTempBonus(state, 'h99', 'x', { type: 'luck', value: 1 }, 'end_of_day').error, 'no_such_hero');
  roundTrip(state);

  // day 11 (not a new week): end_of_day goes
  state.turn = 11; state.date.day = 4;
  startOfDayHero(state, hero.id);
  assert.deepEqual(hero.temp.map((t) => t.source), ['temple', 'stables', 'spell']);
  assert.equal(hero.maxMovePoints, 1960); // 1560 + 400 stables
  // day 12: the turn-numbered bonus (active through turn 11) goes
  state.turn = 12; state.date.day = 5;
  const res = startOfDayHero(state, hero.id);
  assert.deepEqual(hero.temp.map((t) => t.source), ['temple', 'stables']);
  assert.ok(res.events.some((e) => e.type === 'temp_bonus_expired' && e.source === 'spell'));
  // day 1 of the next week: end_of_week goes, movement drops back
  state.turn = 15; state.date = { day: 1, week: 3, month: 1 };
  startOfDayHero(state, hero.id);
  assert.deepEqual(hero.temp.map((t) => t.source), ['temple']);
  assert.equal(hero.maxMovePoints, 1560);
  // battle
  assert.deepEqual(expireTempBonuses(state, hero, 'battle').map((t) => t.source), ['temple']);
  assert.deepEqual(hero.temp, []);
});

test('startOfDayHero: movement refilled from the current army, mana regeneration', () => {
  const state = createTestState();
  const hero = mk(state, 'aine', [['gremlin', 10]]); // max mana 30
  hero.movePoints = 0;
  hero.mana = 10;
  hero.army = pad7(army(['angel', 1]));
  let res = startOfDayHero(state, hero.id);
  assert.equal(hero.maxMovePoints, 2000);
  assert.equal(hero.movePoints, 2000);
  assert.equal(hero.mana, 11);
  assert.deepEqual(res.events, [{ type: 'mana_regenerated', heroId: hero.id, amount: 1 }]);
  setSkills(hero, { mysticism: 3 }); // +4
  startOfDayHero(state, hero.id);
  assert.equal(hero.mana, 16);
  hero.mana = 28;
  startOfDayHero(state, hero.id);
  assert.equal(hero.mana, 30); // capped at the maximum
  hero.mana = 55; // over-charged (mana vortex): untouched
  res = startOfDayHero(state, hero.id);
  assert.equal(hero.mana, 55);
  assert.deepEqual(res.events, []);
  // Wizard's Well
  hero.mana = 3;
  addTempBonus(state, hero.id, 'well', { type: 'mana_regen_full' }, 'end_of_week');
  state.date.day = 2;
  startOfDayHero(state, hero.id);
  assert.equal(hero.mana, 30);
  // sea movement when in a boat
  hero.inBoat = true;
  startOfDayHero(state, hero.id);
  assert.equal(hero.movePoints, 1500);
  assert.equal(startOfDayHero(state, 'h99').error, 'no_such_hero');
});

// ---------------------------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------------------------

test('tradeArmy between adjacent allied heroes; never the last stack', () => {
  const state = createTestState();
  const a = mk(state, 'orrin', [['pikeman', 10], ['archer', 4]], 0, { x: 5, y: 5, z: 0 });
  const b = mk(state, 'sorsha', [['griffin', 3]], 0, { x: 6, y: 6, z: 0 });
  let res = tradeArmy(state, a.id, 0, b.id, 1);
  assert.equal(res.ok, true);
  assert.deepEqual(res.events[0], { type: 'army_moved', fromHeroId: a.id, fromSlot: 0, toHeroId: b.id, toSlot: 1, action: 'move', count: 10 });
  assert.equal(tradeArmy(state, a.id, 1, b.id, 2).error, 'last_stack');
  assert.equal(tradeArmy(state, a.id, 1, b.id, 2, 3).ok, true); // leaves one archer
  assert.deepEqual(a.army[1], { creatureId: 'archer', count: 1 });
  assert.equal(tradeArmy(state, a.id, 1, b.id, 0).events[0].action, 'swap'); // swap is fine
  assert.deepEqual(a.army[1], { creatureId: 'griffin', count: 3 });
  assert.equal(tradeArmy(state, b.id, 1, b.id, 6).ok, true); // rearrange own army
  assert.equal(tradeArmy(state, b.id, 1, a.id, 0).error, 'empty_slot');
  // rules
  b.pos = { x: 8, y: 5, z: 0 };
  assert.equal(tradeArmy(state, a.id, 1, b.id, 3).error, 'not_adjacent');
  b.pos = { x: 5, y: 5, z: 1 };
  assert.equal(tradeArmy(state, a.id, 1, b.id, 3).error, 'not_adjacent');
  a.townId = 't1'; b.townId = 't1'; // garrison + visiting hero of one town
  assert.equal(tradeArmy(state, b.id, 6, a.id, 5, 2).ok, true);
  const foe = mk(state, 'edric', [['pikeman', 5]], 1, { x: 5, y: 6, z: 0 });
  assert.equal(tradeArmy(state, a.id, 1, foe.id, 3).error, 'not_allied');
  assert.equal(tradeArmy(state, a.id, 1, 'h99', 3).error, 'no_such_hero');
  roundTrip(state);
});

test('tradeArtifact moves artifacts between adjacent allied heroes', () => {
  const state = createTestState();
  const a = mk(state, 'orrin', undefined, 0, { x: 5, y: 5, z: 0 });
  const b = mk(state, 'sorsha', undefined, 0, { x: 5, y: 6, z: 0 });
  giveArtifact(a, 'centaurs_axe');
  const res = tradeArtifact(state, a.id, b.id, 'centaurs_axe');
  assert.equal(res.ok, true);
  assert.equal(hasArtifact(a, 'centaurs_axe'), false);
  assert.equal(hasArtifact(b, 'centaurs_axe'), true);
  assert.equal(tradeArtifact(state, b.id, a.id, 'centaurs_axe', { backpack: true }).ok, true);
  assert.equal(ownsArtifact(a, 'centaurs_axe'), true);
  assert.equal(hasArtifact(a, 'centaurs_axe'), false);
  assert.equal(tradeArtifact(state, a.id, b.id, 'catapult').ok, false);
  b.pos = { x: 15, y: 15, z: 0 };
  assert.equal(tradeArtifact(state, a.id, b.id, 'centaurs_axe').error, 'not_adjacent');
});

// ---------------------------------------------------------------------------------------------
// Necromancy
// ---------------------------------------------------------------------------------------------

test('computeNecromancy: hp of killed living creatures x % -> skeletons, capped by bodies', () => {
  const state = createTestState();
  const isra = mk(state, 'isra', [['skeleton', 10]]); // 21%
  // 100 pikemen x 10 hp = 1000 hp; 21% = 210 hp; / 6 = 35 skeletons
  assert.deepEqual(computeNecromancy(state, isra, { pikeman: 100 }), { creatureId: 'skeleton', count: 35 });
  // 1 angel = 200 hp -> 42 hp -> 7 skeletons, but only one body
  assert.deepEqual(computeNecromancy(state, isra, { angel: 1 }), { creatureId: 'skeleton', count: 1 });
  // at least one when anything living died
  assert.deepEqual(computeNecromancy(state, isra, { peasant: 3 }), { creatureId: 'skeleton', count: 1 });
  // undead, golems, elementals and war machines leave nothing to raise
  assert.equal(computeNecromancy(state, isra, { skeleton: 50, stone_golem: 10, air_elemental: 5, ballista: 1 }), null);
  // mixed: only the living part counts: 20 x 10 + 2 x 25 = 250 hp -> 52.5 -> 8
  assert.deepEqual(computeNecromancy(state, isra, { pikeman: 20, griffin: 2, wight: 30 }), { creatureId: 'skeleton', count: 8 });
  assert.equal(computeNecromancy(state, isra, {}), null);
  assert.equal(computeNecromancy(state, mk(state, 'orrin'), { pikeman: 100 }), null);
});

test('computeNecromancy: no room -> skeleton warriors (2/3) only if the hero leads them', () => {
  const state = createTestState();
  const full = [['walking_dead', 1], ['wight', 1], ['vampire', 1], ['lich', 1], ['black_knight', 1], ['bone_dragon', 1]];
  const isra = mk(state, 'isra', [...full, ['zombie', 1]]);
  assert.equal(computeNecromancy(state, isra, { pikeman: 100 }), null);
  isra.army[6] = { creatureId: 'skeleton_warrior', count: 5 };
  assert.deepEqual(computeNecromancy(state, isra, { pikeman: 100 }), { creatureId: 'skeleton_warrior', count: 23 }); // floor(35 x 2/3)
  assert.deepEqual(computeNecromancy(state, isra, { peasant: 1 }), { creatureId: 'skeleton_warrior', count: 1 });
  // with a free slot plain skeletons are raised even next to warriors
  isra.army[0] = null;
  assert.deepEqual(computeNecromancy(state, isra, { pikeman: 100 }), { creatureId: 'skeleton', count: 35 });
});

test('computeNecromancy with the Cloak of the Undead King', () => {
  const state = createTestState();
  const hero = mk(state, 'isra', [['skeleton', 10]]);
  addTempBonus(state, hero.id, 'cloak', { type: 'necromancy_raise', creatures: ['skeleton', 'walking_dead', 'wight', 'lich'] }, 'end_of_week');
  // Advanced: wights (18 hp): 1000 x 21% = 210 -> 11
  assert.deepEqual(computeNecromancy(state, hero, { pikeman: 100 }), { creatureId: 'wight', count: 11 });
  setSkills(hero, { necromancy: 3 }); // 30 x 1.05 = 31.5% -> 315 hp / 30 = 10 liches
  assert.deepEqual(computeNecromancy(state, hero, { pikeman: 100 }), { creatureId: 'lich', count: 10 });
  setSkills(hero, { necromancy: 1 }); // 10.5% -> 105 / 15 = 7 walking dead
  assert.deepEqual(computeNecromancy(state, hero, { pikeman: 100 }), { creatureId: 'walking_dead', count: 7 });
  // no slot for the cloak creature: nothing
  setSkills(hero, { necromancy: 3 });
  hero.army = pad7(army(['skeleton'], ['walking_dead'], ['wight'], ['vampire'], ['black_knight'], ['bone_dragon'], ['zombie']));
  assert.equal(computeNecromancy(state, hero, { pikeman: 100 }), null);
  // the real artifact (three parts assembled) works without the skill: 30% from the parts
  const knight = mk(state, 'orrin');
  for (const id of ['amulet_of_the_undertaker', 'vampires_cowl', 'dead_mans_boots']) giveArtifact(knight, id);
  assert.deepEqual(computeNecromancy(state, knight, { pikeman: 100 }), { creatureId: 'skeleton', count: 50 });
});

// ---------------------------------------------------------------------------------------------
// Combat adapters
// ---------------------------------------------------------------------------------------------

test('buildCombatSide for a hero: effective stats, spells, skills, bonuses, machines, morale/luck', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin', [['pikeman', 10], ['archer', 5]]);
  giveArtifact(hero, 'centaurs_axe');
  giveArtifact(hero, 'ballista');
  giveArtifact(hero, 'spellbook');
  giveArtifact(hero, makeScroll('haste'));
  hero.spells.push('bless');
  hero.mana = 7;
  const side = buildCombatSide(state, { heroId: hero.id });
  assert.equal(side.playerId, 0);
  assert.equal(side.isHuman, true);
  assert.deepEqual(
    { id: side.hero.id, name: side.hero.name, attack: side.hero.attack, defense: side.hero.defense, power: side.hero.power, knowledge: side.hero.knowledge, mana: side.hero.mana },
    { id: hero.id, name: 'Orrin', attack: 4, defense: 2, power: 1, knowledge: 1, mana: 7 },
  );
  assert.deepEqual(side.hero.spells, ['bless', 'haste']);
  assert.deepEqual(side.hero.skills, { leadership: 1, archery: 1 });
  assert.equal(side.hero.specialty.type, 'skill');
  assert.ok(side.hero.bonuses.some((b) => b.type === 'damage_percent' && b.mode === 'ranged' && b.percent === 10.5));
  assert.ok(side.hero.bonuses.some((b) => b.type === 'morale' && b.value === 1));
  assert.deepEqual(side.warMachines, ['ballista']); // the catapult is automatic
  assert.equal(side.army.length, 7);
  assert.deepEqual(side.army[1], { creatureId: 'archer', count: 5 });
  side.army[1].count = 1; // a copy
  assert.equal(hero.army[1].count, 5);
  assert.equal(side.morale, 2);
  assert.equal(side.luck, 0);
  assert.deepEqual(side.stackMorale, [2, 2, null, null, null, null, null]);
  assert.equal(side.canRetreat, true);
  assert.equal(side.canSurrender, false); // nobody to surrender to
  JSON.stringify(side);
  assert.throws(() => buildCombatSide(state, { heroId: 'h99' }));
  assert.throws(() => buildCombatSide(state, {}));
});

test('buildCombatSide for a neutral army and enemy-dependent values', () => {
  const state = createTestState();
  const hero = mk(state, 'sorsha', [['pikeman', 10]]);
  hero.skills = [];
  const foe = mk(state, 'sandro', [['bone_dragon', 2]], 1);
  giveArtifact(foe, 'shackles_of_war');
  const neutral = buildCombatSide(state, { army: army(['gnoll', 30], ['skeleton', 5]), playerId: null }, { enemy: { heroId: hero.id } });
  assert.equal(neutral.hero, null);
  assert.equal(neutral.playerId, null);
  assert.equal(neutral.isHuman, false);
  assert.deepEqual(neutral.warMachines, []);
  assert.equal(neutral.morale, -1);
  assert.equal(neutral.canRetreat, false);
  const mine = buildCombatSide(state, { heroId: hero.id }, { enemy: { heroId: foe.id } });
  assert.equal(mine.morale, 1); // base: one town +1 (the engine applies the bone dragons' -1 itself)
  assert.equal(mine.stackMorale[0], 0); // ... which the per-stack preview already includes
  assert.equal(mine.canRetreat, false); // Shackles of War
  assert.equal(mine.canSurrender, false);
  removeArtifact(foe, 'shackles_of_war');
  const free = buildCombatSide(state, { heroId: hero.id }, { enemy: { heroId: foe.id } });
  assert.equal(free.canRetreat, true);
  assert.equal(free.canSurrender, true);
  assert.equal(free.surrenderCost, 600); // 10 pikemen x 60 gold (full cost, original)
  state.players[0].resources.gold = 599;
  assert.equal(buildCombatSide(state, { heroId: hero.id }, { enemy: { heroId: foe.id } }).canSurrender, false);
});

test('town defenders: visiting hero first, then garrison hero, then garrison; siege bonuses', () => {
  const state = createTestState();
  const town = addTestTown(state, { faction: 'fortress', owner: 1, buildings: ['fort', 'tavern', 'fortress_glyphs_of_fear', 'fortress_blood_obelisk'] });
  town.garrison = pad7(army(['gnoll', 20]));
  assert.deepEqual(getTownDefender(state, town.id), { kind: 'garrison', heroId: null, army: town.garrison });
  let side = buildCombatSide(state, { townId: town.id });
  assert.equal(side.hero, null);
  assert.equal(side.playerId, 1);
  assert.equal(side.morale, 2); // one town +1, tavern +1
  assert.deepEqual(side.bonuses, [{ type: 'morale', value: 1, source: 'building:tavern' }]);
  assert.deepEqual(side.army[0], { creatureId: 'gnoll', count: 20 });

  const gHero = mk(state, 'sorsha', [['pikeman', 5]], 1);
  gHero.skills = [];
  town.garrisonHero = gHero.id;
  assert.equal(getTownDefender(state, town.id).kind, 'garrison_hero');
  side = buildCombatSide(state, { townId: town.id });
  assert.equal(side.hero.id, gHero.id);
  assert.equal(side.hero.attack, gHero.primary.attack + 2); // Blood Obelisk
  assert.equal(side.hero.defense, gHero.primary.defense + 2); // Glyphs of Fear
  assert.equal(side.morale, 2);
  assert.ok(side.hero.bonuses.some((b) => b.type === 'morale' && b.source === 'building:tavern'));
  assert.equal(side.canRetreat, false); // no escape tunnel
  // without a fort there is no siege: no garrison bonuses, retreat allowed
  const open = buildCombatSide(state, { townId: town.id }, { siege: false });
  assert.equal(open.hero.attack, gHero.primary.attack);
  assert.equal(open.morale, 1);
  assert.equal(open.canRetreat, true);

  const vHero = mk(state, 'edric', [['griffin', 5]], 1);
  town.visitingHero = vHero.id;
  assert.equal(getTownDefender(state, town.id).kind, 'visiting');
  assert.equal(buildCombatSide(state, { townId: town.id }).hero.id, vHero.id);

  town.visitingHero = null; town.garrisonHero = null; town.garrison = pad7([]);
  assert.equal(getTownDefender(state, town.id).kind, 'empty');

  // escape tunnel / fallback siege info
  const sh = addTestTown(state, { faction: 'stronghold', owner: 1, buildings: ['fort', 'citadel', 'stronghold_escape_tunnel'] });
  sh.garrisonHero = gHero.id;
  assert.equal(buildCombatSide(state, { townId: sh.id }).canRetreat, true);
  setTownModule({});
  const info = siegeInfoFor(state, sh.id);
  assert.equal(info.fortLevel, 2);
  assert.equal(info.faction, 'stronghold');
  assert.equal(siegeInfoFor(state, addTestTown(state, { owner: 1 }).id), null);
  setTownModule({ getSiegeInfo: (s, id) => ({ fortLevel: 3, faction: 'x', buildings: [], from: id }) });
  assert.deepEqual(siegeInfoFor(state, sh.id), { fortLevel: 3, faction: 'x', buildings: [], from: sh.id });
  setTownModule({});
});

test('startCombat builds the CombatInput and state.combat', () => {
  withEngine(() => null, (engine) => {
    const state = createTestState();
    state.map.tiles[0][7][7].t = 'swamp';
    state.map.tiles[0][7][7].overlay = 'holy_ground';
    const hero = mk(state, 'orrin', [['pikeman', 10]], 0, { x: 6, y: 7, z: 0 });
    const res = startCombat(state, {
      attackerHeroId: hero.id, defender: { army: army(['imp', 30]), pos: { x: 7, y: 7, z: 0 } },
      context: { kind: 'monster', objId: 'o5' },
    });
    assert.equal(res.ok, true);
    assert.equal(res.events[0].type, 'combat_started');
    const input = engine.calls.inputs[0];
    assert.equal(input.terrain, 'swamp');
    assert.equal(input.overlay, 'holy_ground');
    assert.equal(input.siege, null);
    assert.equal(input.bank, false);
    assert.equal(input.obstacles, 'random');
    assert.ok(Number.isInteger(input.seed) && input.seed > 0);
    assert.equal(input.attacker.hero.id, hero.id);
    assert.equal(input.attacker.stackMorale[0], 3); // 1 + Leadership 1 + holy ground 1
    assert.equal(input.defender.hero, null);
    assert.equal(input.defender.stackMorale[0], 0); // evil on holy ground: 1 - 1
    assert.deepEqual(state.combat.context, { kind: 'monster', objId: 'o5' });
    assert.equal(state.combat.attackerHeroId, hero.id);
    assert.equal(state.combat.defenderHeroId, null);
    assert.equal(state.combat.townId, null);
    roundTrip(state);
    // only one combat at a time; not finishable before it is over
    assert.equal(startCombat(state, { attackerHeroId: hero.id, defender: { army: army(['imp', 1]) }, context: { kind: 'x' } }).error, 'combat_in_progress');
    assert.equal(finishCombat(state).error, 'combat_not_over');
  });
});

test('startCombat: explicit terrain, town siege, errors', () => {
  withEngine(() => null, (engine) => {
    const state = createTestState();
    const hero = mk(state, 'orrin', [['pikeman', 10]], 0, { x: 2, y: 2, z: 0 });
    assert.equal(startCombat(state, { attackerHeroId: 'h99', defender: { army: [] }, context: { kind: 'x' } }).error, 'no_such_hero');
    assert.equal(startCombat(state, { attackerHeroId: hero.id, defender: {}, context: { kind: 'x' } }).error, 'bad_defender');
    assert.equal(startCombat(state, { attackerHeroId: hero.id, defender: { heroId: hero.id }, context: { kind: 'x' } }).error, 'same_hero');
    assert.equal(startCombat(state, { attackerHeroId: hero.id, defender: { townId: 'zz' }, context: { kind: 'x' } }).error, 'no_such_town');
    const town = addTestTown(state, { owner: 1, pos: { x: 9, y: 9, z: 0 }, buildings: ['fort', 'citadel', 'castle', 'tavern'] });
    town.garrison = pad7(army(['archer', 12]));
    state.map.tiles[0][9][9].t = 'dirt';
    state.map.tiles[0][9][9].overlay = 'cursed_ground'; // overlays never apply in sieges
    const res = startCombat(state, { attackerHeroId: hero.id, defender: { townId: town.id }, context: { kind: 'siege', townId: town.id } });
    assert.equal(res.ok, true);
    const input = engine.calls.inputs[0];
    assert.equal(input.terrain, 'dirt');
    assert.equal(input.overlay, null);
    assert.equal(input.siege.fortLevel, 3);
    assert.equal(input.siege.faction, 'castle');
    assert.equal(input.defender.playerId, 1);
    assert.equal(input.defender.morale, 2);
    assert.equal(state.combat.townId, town.id);
    assert.equal(state.combat.defenderKind, 'garrison');
    state.combat = null;
    startCombat(state, { attackerHeroId: hero.id, defender: { army: army(['imp', 1]) }, terrain: 'lava', bank: true, seed: 99, context: { kind: 'bank' } });
    assert.equal(engine.calls.inputs[1].terrain, 'lava');
    assert.equal(engine.calls.inputs[1].bank, true);
    assert.equal(engine.calls.inputs[1].seed, 99);
  });
  const prev = getCombatEngine();
  setCombatEngine(null);
  const state = createTestState();
  const hero = mk(state, 'orrin');
  assert.equal(startCombat(state, { attackerHeroId: hero.id, defender: { army: army(['imp', 1]) }, context: { kind: 'x' } }).error, 'combat_engine_unavailable');
  assert.equal(finishCombat(state).error, 'no_combat');
  setCombatEngine(prev);
});

test('finishCombat vs neutrals: casualties, mana, war machine, experience, temp bonuses, handler', () => {
  const seen = [];
  registerCombatOutcome('monster_test', (state, context, result) => {
    seen.push({ context, result, combatCleared: state.combat === null });
    return { events: [{ type: 'monster_gone', objId: context.objId }] };
  });
  withEngine(() => null, () => {
    const state = createTestState();
    const hero = mk(state, 'orrin', [['pikeman', 10], ['archer', 5]]);
    giveArtifact(hero, 'ballista');
    giveArtifact(hero, 'spellbook');
    hero.mana = 10;
    addTempBonus(state, hero.id, 'temple', { type: 'morale', value: 1 }, 'next_battle');
    addTempBonus(state, hero.id, 'stables', { type: 'movement_land', value: 400 }, 'end_of_week');
    startCombat(state, { attackerHeroId: hero.id, defender: { army: army(['imp', 40]) }, context: { kind: 'monster_test', objId: 'o7' } });
    const cs = state.combat.cs;
    cs.over = true;
    cs.result = {
      winner: 'attacker', rounds: 3,
      attacker: sideResult(army(['pikeman', 6], ['archer', 5]), { losses: { pikeman: 4 }, manaLeft: 4, warMachinesLost: ['ballista'] }),
      defender: sideResult([], { losses: { imp: 40 } }),
      expAttacker: 160, expDefender: 40, raised: null, capturedArtifacts: false,
    };
    const res = finishCombat(state);
    assert.equal(res.ok, true);
    assert.deepEqual(hero.army.slice(0, 3), [{ creatureId: 'pikeman', count: 6 }, { creatureId: 'archer', count: 5 }, null]);
    assert.equal(hero.mana, 4);
    assert.equal(hasArtifact(hero, 'ballista'), false);
    assert.equal(hasArtifact(hero, 'catapult'), true);
    assert.equal(hero.exp, 160);
    assert.deepEqual(hero.temp.map((t) => t.source), ['stables']);
    assert.equal(state.combat, null);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].context, { kind: 'monster_test', objId: 'o7' });
    assert.equal(seen[0].combatCleared, true);
    assert.equal(seen[0].result.winner, 'attacker');
    assert.equal(seen[0].result.winnerHeroId, hero.id);
    assert.equal(seen[0].result.experience, 160);
    assert.deepEqual(seen[0].result.fates, { attacker: 'won', defender: 'none' });
    assert.ok(res.events.some((e) => e.type === 'war_machine_lost' && e.machine === 'ballista'));
    assert.ok(res.events.some((e) => e.type === 'experience_gained' && e.amount === 160));
    assert.ok(res.events.some((e) => e.type === 'combat_finished' && e.winner === 'attacker'));
    assert.deepEqual(res.events[res.events.length - 1], { type: 'monster_gone', objId: 'o7' });
    assert.equal(res.result.winner, 'attacker');
    roundTrip(state);
  });
});

test('experience falls back to the hp of the killed troops and uses Learning', () => {
  withEngine((input) => ({
    winner: 'attacker', rounds: 1,
    attacker: sideResult(input.attacker.army),
    defender: sideResult([], { losses: { imp: 40, gog: 5 } }),
  }), () => {
    const state = createTestState();
    const hero = mk(state, 'orrin');
    setSkills(hero, { learning: 2 });
    const res = quickCombat(state, { attackerHeroId: hero.id, defender: { army: army(['imp', 40], ['gog', 5]) }, context: { kind: 'none' } });
    assert.equal(res.ok, true);
    assert.equal(hero.exp, Math.floor((40 * 4 + 5 * 13) * 1.1)); // imp 4 hp, gog 13 hp
    assert.equal(state.combat, null);
    assert.equal(res.events[0].type, 'combat_started');
  });
});

test('hero vs hero: winner captures artifacts, gets +500 exp, loser is removed', () => {
  withEngine((input) => ({
    winner: 'attacker', rounds: 5,
    attacker: sideResult(army(['pikeman', 3])),
    defender: sideResult([], { losses: { griffin: 8 }, manaLeft: 0 }),
    expAttacker: 200, expDefender: 70,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    const d = mk(state, 'edric', [['griffin', 8]], 1);
    giveArtifact(d, 'centaurs_axe');
    giveArtifact(d, 'ballista');
    giveArtifact(d, 'boots_of_speed', { toBackpack: true });
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } });
    assert.equal(res.ok, true);
    assert.equal(a.exp, 200); // the engine's figure is final (it already holds the +500)
    assert.equal(hasArtifact(a, 'centaurs_axe'), true);
    assert.equal(ownsArtifact(a, 'boots_of_speed'), true);
    assert.equal(hasArtifact(a, 'ballista'), false); // war machines are not captured
    assert.equal(state.heroes[d.id], undefined);
    assert.deepEqual(state.players[1].heroes, []);
    // the defeated hero is back in the global pool: level kept, army and captured artifacts gone
    const pooled = state.heroPool.edric;
    assert.equal(pooled.level, d.level);
    assert.ok(armyIsEmpty(pooled.army));
    assert.equal(ownsArtifact(pooled, 'centaurs_axe'), false);
    assert.ok(!(state.players[1].tavernHeroes || []).includes('edric'), 'not offered in the old owner\'s tavern slot');
    assert.deepEqual(state.defeated.hero, { [d.id]: 0, edric: 0 }, 'victory credit recorded');
    assert.deepEqual(res.result.fates, { attacker: 'won', defender: 'defeated' });
    assert.deepEqual(res.result.removedHeroes, [d.id]);
    assert.equal(res.result.loserHeroId, d.id);
    assert.ok(res.events.some((e) => e.type === 'artifact_transferred' && e.artifact === 'centaurs_axe'));
    assert.ok(res.events.some((e) => e.type === 'hero_removed' && e.reason === 'defeated'));
    assert.equal(getPending(state).length, 0);
    roundTrip(state);
  });
});

test('the defender can win: attacker hero removed, defender gets the experience', () => {
  withEngine(() => ({
    winner: 'defender', rounds: 2,
    attacker: sideResult([], { losses: { pikeman: 10 } }),
    defender: sideResult(army(['griffin', 6])),
    expAttacker: 50, expDefender: 100,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    const d = mk(state, 'edric', [['griffin', 8]], 1);
    giveArtifact(a, 'centaurs_axe');
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } });
    assert.equal(state.heroes[a.id], undefined);
    assert.equal(d.exp, 100);
    assert.equal(hasArtifact(d, 'centaurs_axe'), true);
    assert.equal(d.army[0].count, 6);
    assert.equal(res.result.winnerHeroId, d.id);
  });
});

test('retreat: hero goes to the tavern pool without army, keeps artifacts; no capture, no +500', () => {
  withEngine(() => ({
    winner: 'attacker', rounds: 1,
    attacker: sideResult(army(['pikeman', 10])),
    defender: sideResult(army(['griffin', 5]), { losses: { griffin: 3 }, heroFled: true }),
    expAttacker: 75, expDefender: 0,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    const d = mk(state, 'edric', [['griffin', 8]], 1);
    giveArtifact(d, 'centaurs_axe');
    d.level = 5; d.exp = 4600;
    state.players[1].tavernHeroes = ['tyris', 'valeska'];
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } });
    assert.equal(a.exp, 75);
    assert.equal(hasArtifact(a, 'centaurs_axe'), false);
    assert.equal(state.heroes[d.id], undefined);
    assert.deepEqual(state.players[1].heroes, []);
    assert.deepEqual(state.players[1].tavernHeroes, ['tyris', 'edric']);
    const pooled = state.heroPool.edric;
    assert.ok(armyIsEmpty(pooled.army));
    assert.equal(hasArtifact(pooled, 'centaurs_axe'), true);
    assert.equal(pooled.owner, null);
    assert.deepEqual(res.result.fates, { attacker: 'won', defender: 'retreated' });
    assert.ok(res.events.some((e) => e.type === 'hero_retreated'));
    assert.ok(res.events.some((e) => e.type === 'hero_removed' && e.toTavern === true));
    roundTrip(state);
    // re-hiring restores the same hero, with a starter stack
    const back = addHero(state, 'edric', 1, { x: 4, y: 4 });
    assert.equal(back.level, 5);
    assert.equal(hasArtifact(back, 'centaurs_axe'), true);
    assert.equal(armyStackCount(back.army), 1);
    assert.equal(back.army[0].creatureId, 'pikeman');
    assert.equal(back.owner, 1);
    assert.equal(state.heroPool.edric, undefined);
    assert.deepEqual(state.players[1].tavernHeroes, ['tyris', null]);
    assert.deepEqual(state.players[1].heroes, [back.id]);
    assert.equal(back.fromPool, undefined);
    roundTrip(state);
  });
});

test('surrender: gold goes to the winner, the hero keeps his army in the pool', () => {
  withEngine(() => ({
    winner: 'defender', rounds: 1,
    attacker: sideResult(army(['pikeman', 10], ['archer', 2]), { losses: { pikeman: 5 }, heroSurrendered: true }),
    defender: sideResult(army(['griffin', 8])),
    expAttacker: 0, expDefender: 50,
  }), () => {
    const state = createTestState({ resources: { gold: 1000 } });
    const a = mk(state, 'orrin', [['pikeman', 15], ['archer', 2]]);
    setSkills(a, { diplomacy: 1 }); // -20%
    const d = mk(state, 'edric', [['griffin', 8]], 1);
    assert.equal(getSurrenderCost(state, a), 880); // (15 x 60 + 2 x 100) x 0.8
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } });
    // price of the surviving army: (10 x 60 + 2 x 100) x 0.8 = 640
    assert.equal(res.result.surrenderPaid, 640);
    assert.equal(state.players[0].resources.gold, 360);
    assert.equal(state.players[1].resources.gold, 1640);
    assert.equal(d.exp, 50);
    const pooled = state.heroPool.orrin;
    assert.deepEqual(pooled.army.slice(0, 2), [{ creatureId: 'pikeman', count: 10 }, { creatureId: 'archer', count: 2 }]);
    assert.equal(state.players[0].tavernHeroes[1], 'orrin');
    assert.deepEqual(res.result.fates, { attacker: 'surrendered', defender: 'won' });
    const back = addHero(state, 'orrin', 0, { x: 1, y: 1 });
    assert.equal(armyCount(back.army, 'pikeman'), 10);
  });
});

test('draw: both heroes are lost, nothing is captured, nobody gets experience', () => {
  withEngine(() => ({
    winner: 'draw', rounds: 4,
    attacker: sideResult([], { losses: { pikeman: 10 } }),
    defender: sideResult([], { losses: { griffin: 8 } }),
    expAttacker: 200, expDefender: 100,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    const d = mk(state, 'edric', [['griffin', 8]], 1);
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } });
    assert.equal(res.ok, true);
    assert.deepEqual(Object.keys(state.heroes), []);
    assert.deepEqual(res.result.removedHeroes, [a.id, d.id]);
    assert.equal(res.result.winnerHeroId, null);
  });
});

test('necromancy after a won battle; blocked by Ring of Oblivion', () => {
  const result = () => ({
    winner: 'attacker', rounds: 2,
    attacker: sideResult(army(['skeleton', 20], ['wight', 2])),
    defender: sideResult([], { losses: { pikeman: 100, skeleton: 40 } }),
    expAttacker: 1000, expDefender: 0, raised: { creatureId: 'skeleton', count: 999 },
  });
  withEngine(result, () => {
    const state = createTestState();
    const isra = mk(state, 'isra', [['skeleton', 20], ['wight', 3]]);
    const res = quickCombat(state, { attackerHeroId: isra.id, defender: { army: army(['pikeman', 100], ['skeleton', 40]) }, context: { kind: 'none' } });
    assert.deepEqual(res.result.raised, { creatureId: 'skeleton', count: 35 }); // the adapter's own number
    assert.deepEqual(isra.army[0], { creatureId: 'skeleton', count: 55 });
    assert.ok(res.events.some((e) => e.type === 'necromancy' && e.count === 35));

    const state2 = createTestState();
    const isra2 = mk(state2, 'isra', [['skeleton', 20], ['wight', 3]]);
    giveArtifact(isra2, 'ring_of_oblivion');
    const res2 = quickCombat(state2, { attackerHeroId: isra2.id, defender: { army: army(['pikeman', 100]) }, context: { kind: 'none' } });
    assert.equal(res2.result.raised, null);
    assert.deepEqual(isra2.army[0], { creatureId: 'skeleton', count: 20 });
  });
});

test('Eagle Eye after combat uses the spells the enemy hero cast', () => {
  withEngine(() => ({
    winner: 'attacker', rounds: 2,
    attacker: sideResult(army(['gremlin', 10])),
    defender: sideResult([], { losses: { griffin: 8 }, spellsCast: ['haste', 'bless', 'implosion'] }),
    expAttacker: 10, expDefender: 0,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'sanya', [['gremlin', 10]]);
    setSkills(a, { eagle_eye: 3, wisdom: 1 });
    a.level = 14;
    a.exp = expForLevel(14);
    a.spells = ['haste'];
    const d = mk(state, 'adela', [['griffin', 8]], 1);
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } });
    assert.deepEqual(a.spells, ['haste', 'bless']);
    assert.ok(res.events.some((e) => e.type === 'spell_learned' && e.via === 'eagle_eye' && e.spellId === 'bless'));
  });
});

test('town garrison casualties are written back; a garrison win keeps the town army', () => {
  withEngine(() => ({
    winner: 'defender', rounds: 2,
    attacker: sideResult([], { losses: { pikeman: 10 } }),
    defender: sideResult(army(['archer', 7])),
    expAttacker: 0, expDefender: 100,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    const town = addTestTown(state, { owner: 1, buildings: ['fort'] });
    town.garrison = pad7(army(['archer', 12]));
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { townId: town.id }, context: { kind: 'none' } });
    assert.equal(res.ok, true);
    assert.deepEqual(town.garrison[0], { creatureId: 'archer', count: 7 });
    assert.equal(state.heroes[a.id], undefined);
    assert.equal(res.result.townId, town.id);
    assert.equal(res.result.defenderKind, 'garrison');
  });
});

test('visiting hero defends a town with his own army; the garrison is untouched', () => {
  withEngine(() => ({
    winner: 'attacker', rounds: 2,
    attacker: sideResult(army(['pikeman', 4])),
    defender: sideResult([], { losses: { griffin: 5 } }),
    expAttacker: 125, expDefender: 0,
  }), (engine) => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    const town = addTestTown(state, { owner: 1, buildings: ['fort'] });
    town.garrison = pad7(army(['archer', 12]));
    const v = mk(state, 'edric', [['griffin', 5]], 1);
    town.visitingHero = v.id;
    v.townId = town.id;
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { townId: town.id }, context: { kind: 'none' } });
    assert.equal(engine.calls.inputs[0].defender.hero.id, v.id);
    assert.deepEqual(engine.calls.inputs[0].defender.army[0], { creatureId: 'griffin', count: 5 });
    assert.equal(engine.calls.inputs[0].siege.fortLevel, 1);
    assert.equal(state.heroes[v.id], undefined);
    assert.equal(town.visitingHero, null);
    assert.deepEqual(town.garrison[0], { creatureId: 'archer', count: 12 });
    assert.equal(res.result.defenderKind, 'visiting');
    // the garrison is next
    assert.equal(getTownDefender(state, town.id).kind, 'garrison');
  });
});

test('quickCombat reports an engine that cannot resolve; unknown outcome kinds are fine', () => {
  const prev = getCombatEngine();
  setCombatEngine({ createCombat: (input) => ({ input }), isOver: () => false, getResult: () => null });
  const state = createTestState();
  const hero = mk(state, 'orrin');
  const res = quickCombat(state, { attackerHeroId: hero.id, defender: { army: army(['imp', 1]) }, context: { kind: 'never_registered' } });
  assert.equal(res.error, 'combat_not_resolved');
  assert.equal(state.combat, null);
  setCombatEngine(prev);
});

test('state stays plain JSON through a whole sequence of operations', () => {
  withEngine((input) => ({
    winner: 'attacker', rounds: 1,
    attacker: sideResult(input.attacker.army, { manaLeft: 1 }),
    defender: sideResult([], { losses: { imp: 10 } }),
    expAttacker: 2500, expDefender: 0,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'sandro', [['skeleton', 20]]);
    const b = mk(state, 'isra', [['skeleton', 10], ['wight', 2]]);
    addTestTown(state, { faction: 'necropolis', owner: 0, buildings: ['necropolis_necromancy_amplifier'] });
    giveArtifact(a, 'tome_of_fire_magic');
    addTempBonus(state, a.id, 'idol', { type: 'luck', value: 1 }, 'next_battle');
    meetHeroes(state, a.id, b.id);
    tradeArmy(state, b.id, 1, a.id, 3);
    quickCombat(state, { attackerHeroId: a.id, defender: { army: army(['imp', 10]) }, context: { kind: 'none' } });
    while (getPending(state).length) resolvePending(state, getPending(state)[0].id, 0);
    startOfDayHero(state, a.id);
    getHeroSpells(state, a);
    getMaxMovePoints(state, a);
    roundTrip(state);
    assert.equal(a.level, 3);
    assert.equal(armyCount(a.army, 'skeleton'), 21); // 10 imps x 4 hp = 40 hp x 20% (10 + amplifier 10) = 8 hp -> 1
  });
});

// ---------------------------------------------------------------------------------------------
// Integration with the real combat engine (skipped until src/engine/combat/index.js exists)
// ---------------------------------------------------------------------------------------------

const realEngine = getCombatEngine();
const realUsable = !!realEngine && ['createCombat', 'isOver', 'getResult'].every((f) => typeof realEngine[f] === 'function');

test('integration: quickCombat against the real combat engine', { skip: !realUsable || typeof realEngine.autoResolve !== 'function' }, () => {
  const state = createTestState();
  const hero = mk(state, 'isra', [['skeleton', 200], ['lich', 20]]);
  const seen = [];
  registerCombatOutcome('integration', (s, context, result) => { seen.push(result); });
  const res = quickCombat(state, { attackerHeroId: hero.id, defender: { army: army(['peasant', 30]) }, context: { kind: 'integration' } });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.result.winner, 'attacker');
  assert.equal(state.combat, null);
  assert.equal(seen.length, 1);
  assert.ok(state.heroes[hero.id]);
  assert.ok(hero.exp >= 30, `exp ${hero.exp}`); // 30 peasants x 1 hp (+5% from nothing)
  assert.ok(armyCount(hero.army, 'skeleton') >= 190);
  assert.deepEqual(res.result.raised, { creatureId: 'skeleton', count: 1 }); // 30 hp x 21% = 6.3 hp -> 1
  roundTrip(state);
});

test('integration: hero vs hero with the real combat engine', { skip: !realUsable || typeof realEngine.autoResolve !== 'function' }, () => {
  const state = createTestState();
  const a = mk(state, 'orrin', [['angel', 20], ['marksman', 50]]);
  const d = mk(state, 'edric', [['pikeman', 5]], 1);
  giveArtifact(d, 'centaurs_axe');
  const res = quickCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.result.winner, 'attacker');
  assert.equal(state.heroes[d.id], undefined);
  if (res.result.fates.defender === 'defeated') {
    assert.equal(hasArtifact(a, 'centaurs_axe'), true);
    assert.ok(a.exp >= 50 + HERO_DEFEAT_EXP);
  }
  roundTrip(state);
});

test('fallbacks without engine figures: +500 for an enemy hero, engine kill list and surrender price are used', () => {
  withEngine(() => ({
    winner: 'attacker', rounds: 1,
    attacker: sideResult(army(['skeleton', 20]), { killedEnemies: [
      { creatureId: 'pikeman', count: 100, hp: 10, living: true, summoned: false },
      { creatureId: 'pikeman', count: 500, hp: 10, living: true, summoned: true },
    ] }),
    defender: sideResult(army(['pikeman', 3]), { losses: { pikeman: 600 }, heroSurrendered: true }),
    surrenderCost: 77,
  }), () => {
    const state = createTestState({ resources: { gold: 1000 } });
    const a = mk(state, 'isra', [['skeleton', 20]]);
    const d = mk(state, 'edric', [['pikeman', 603]], 1);
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } });
    assert.equal(res.result.experience, 600 * 10 + HERO_DEFEAT_EXP);
    assert.deepEqual(res.result.raised, { creatureId: 'skeleton', count: 35 }); // summoned casualties ignored
    assert.equal(res.result.surrenderPaid, 77);
    assert.equal(state.players[1].resources.gold, 923);
  });
});

test('defeated hero: re-hired later with his level and skills; beaten by neutrals he loses his artifacts', () => {
  withEngine(() => ({
    winner: 'defender', rounds: 3,
    attacker: sideResult([], { losses: { pikeman: 10 } }),
    defender: sideResult(army(['imp', 5])),
    expAttacker: 0, expDefender: 50,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    giveArtifact(a, 'centaurs_axe');
    a.level = 7;
    setSkills(a, { archery: 2, leadership: 1 });
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { army: army(['imp', 20]) }, context: { kind: 'none' } });
    assert.equal(res.ok, true);
    assert.ok(res.events.some((e) => e.type === 'artifact_lost' && e.artifact === 'centaurs_axe'));
    assert.equal(state.heroes[a.id], undefined);
    assert.deepEqual(state.defeated.hero, { [a.id]: null, orrin: null }, 'a neutral kill credits nobody');
    const again = addHero(state, 'orrin', 1, { x: 5, y: 5, z: 0 }, { tavern: true });
    assert.equal(again.level, 7);
    assert.deepEqual(again.skills.map((x) => [x.id, x.level]), [['archery', 2], ['leadership', 1]]);
    assert.equal(ownsArtifact(again, 'centaurs_axe'), false);
    assert.ok(!armyIsEmpty(again.army), 'gets a start stack');
    roundTrip(state);
  });
});

test('winning with only summoned creatures left counts as a loss (draw when the enemy is gone too)', () => {
  withEngine(() => ({
    winner: 'attacker', rounds: 4,
    attacker: sideResult([], { losses: { pikeman: 10 } }), // only an air elemental survived
    defender: sideResult([], { losses: { imp: 20 } }),
    expAttacker: 80, expDefender: 0,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { army: army(['imp', 20]) }, context: { kind: 'none' } });
    assert.equal(res.ok, true);
    assert.equal(res.result.winner, 'draw');
    assert.equal(res.result.reason, 'no_real_troops');
    assert.equal(state.heroes[a.id], undefined);
    assert.equal(a.exp, 0, 'no experience');
    assert.deepEqual(res.result.fates, { attacker: 'defeated', defender: 'none' });
  });
});

test('timeout (round cap): the engine reports a defender win; the attacker hero is defeated like any loser', () => {
  withEngine(() => ({
    winner: 'defender', reason: 'timeout', rounds: 100,
    attacker: sideResult([], { losses: { pikeman: 10 } }),
    defender: sideResult(army(['imp', 20])),
    expAttacker: 0, expDefender: 0,
  }), () => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    const res = quickCombat(state, { attackerHeroId: a.id, defender: { army: army(['imp', 20]) }, context: { kind: 'none' } });
    assert.equal(res.result.winner, 'defender');
    assert.deepEqual(res.result.fates, { attacker: 'defeated', defender: 'none' });
    assert.ok(state.heroPool.orrin);
  });
});

test('startCombat passes spellLevelCap (anti-magic garrison) and maxRounds into the CombatInput', () => {
  withEngine(() => null, (engine) => {
    const state = createTestState();
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    assert.equal(startCombat(state, { attackerHeroId: a.id, defender: { army: army(['imp', 5]) }, spellLevelCap: 0, maxRounds: 50, context: { kind: 'none' } }).ok, true);
    assert.equal(engine.calls.inputs[0].spellLevelCap, 0);
    assert.equal(engine.calls.inputs[0].maxRounds, 50);
    state.combat = null;
    startCombat(state, { attackerHeroId: a.id, defender: { army: army(['imp', 5]) }, context: { kind: 'none' } });
    assert.equal('spellLevelCap' in engine.calls.inputs[1], false);
  });
});

test('level_up pending carries the primary skill gained at that level', () => {
  const state = createTestState();
  const hero = mk(state, 'orrin');
  const res = giveExperience(state, hero.id, expForLevel(4), { raw: true });
  const gained = res.events.filter((e) => e.type === 'hero_level_up').map((e) => e.primary);
  assert.equal(gained.length, 3);
  const seen = [];
  for (let guard = 0; guard < 5 && getPending(state).length; guard++) {
    const p = getPending(state)[0];
    seen.push([p.data.level, p.data.primary]);
    resolvePending(state, p.id, 0);
  }
  assert.ok(seen.length >= 1);
  for (const [level, primary] of seen) assert.equal(primary, gained[level - 2]);
});

test('integration: Eagle Eye learns the spell the enemy hero cast in a real battle', { skip: !realUsable }, () => {
  const state = createTestState();
  // slow attackers: the defending hero gets a turn (and a cast) before his troops fall
  const a = mk(state, 'orrin', [['swordsman', 60]]);
  const d = mk(state, 'edric', [['pikeman', 3]], 1);
  setSkills(a, { eagle_eye: 1 });
  for (const h of [a, d]) if (!hasArtifact(h, 'spellbook')) giveArtifact(h, 'spellbook');
  a.spells = [];
  d.spells = ['magic_arrow'];
  d.mana = 50;
  addTempBonus(state, a.id, 'test', { type: 'eagle_eye', percent: 100 }, 'end_of_day');
  assert.equal(startCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } }).ok, true);
  const cs = state.combat.cs;
  let cast = false;
  for (let guard = 0; guard < 500 && !realEngine.isOver(cs); guard++) {
    const st = realEngine.getActiveStack(cs);
    if (!cast && st && st.side === 'defender') {
      const target = cs.stacks.find((x) => x.side === 'attacker' && x.alive && !x.warMachine);
      const r = realEngine.performAction(cs, { type: 'cast', spellId: 'magic_arrow', target: target.id });
      if (r.ok) { cast = true; continue; }
    }
    const r = realEngine.performAction(cs, { type: 'auto' });
    if (!r.ok) realEngine.performAction(cs, { type: 'defend' });
  }
  assert.ok(cast, 'the defender cast Magic Arrow');
  assert.deepEqual(realEngine.getResult(cs).defender.spellsCast, ['magic_arrow']);
  const res = finishCombat(state);
  assert.equal(res.ok, true, res.error);
  assert.equal(res.result.winner, 'attacker');
  assert.ok(a.spells.includes('magic_arrow'));
  assert.ok(res.events.some((e) => e.type === 'spell_learned' && e.via === 'eagle_eye'));
});

test('dismissStack / moveHeroArtifact / setHeroAsleep player actions', () => {
  const state = createTestState();
  const h = mk(state, 'orrin', [['pikeman', 10], ['archer', 4]]);
  const r = dismissStack(state, h.id, 1);
  assert.deepEqual(r.events, [{ type: 'stack_dismissed', heroId: h.id, slot: 1, creatureId: 'archer', count: 4 }]);
  assert.equal(dismissStack(state, h.id, 0).error, 'last_stack');
  assert.equal(dismissStack(state, h.id, 3).error, 'empty_slot');
  giveArtifact(h, 'quiet_eye_of_the_dragon');
  assert.equal(h.artifacts.equipped.ring[0], 'quiet_eye_of_the_dragon');
  assert.equal(moveHeroArtifact(state, h.id, { slot: 'ring', index: 0 }, { slot: 'ring', index: 1 }).ok, true);
  assert.deepEqual(h.artifacts.equipped.ring, [null, 'quiet_eye_of_the_dragon']);
  assert.equal(setHeroAsleep(state, h.id, true).ok, true);
  assert.equal(h.asleep, true);
  setHeroAsleep(state, h.id, false);
  assert.equal(h.asleep, false);
  state.currentPlayer = 1;
  assert.equal(setHeroAsleep(state, h.id, true).error, 'not_your_turn');
  assert.equal(dismissStack(state, h.id, 0).error, 'not_your_turn');
});

test('specialtyUpgrade: Gelu turns archers / wood elves into sharpshooters for the cost difference', () => {
  const state = createTestState({ resources: { gold: 10000 } });
  const g = mk(state, 'gelu', [['archer', 10], ['grand_elf', 2], ['pikeman', 5]]);
  const offers = getSpecialtyUpgrades(state, g);
  assert.deepEqual(offers.map((o) => [o.slot, o.from, o.to, o.cost.gold]), [[0, 'archer', 'sharpshooter', 3000], [1, 'grand_elf', 'sharpshooter', 350]]);
  const gold = state.players[0].resources.gold;
  const r = specialtyUpgrade(state, g.id, 0);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(g.army[0], { creatureId: 'sharpshooter', count: 10 });
  assert.equal(state.players[0].resources.gold, gold - 3000);
  assert.equal(specialtyUpgrade(state, g.id, 2).error, 'no_specialty_upgrade');
  assert.equal(specialtyUpgrade(state, g.id, 5).error, 'empty_slot');
  state.players[0].resources.gold = 0;
  assert.equal(specialtyUpgrade(state, g.id, 1).error, 'not_enough_resources');
  const d = mk(state, 'dracon', [['mage', 3]]);
  assert.deepEqual(getSpecialtyUpgrades(state, d).map((o) => o.to), ['enchanter']);
  assert.deepEqual(getSpecialtyUpgrades(state, mk(state, 'orrin', [['archer', 3]])), []);
});

test('startCombat refuses to fight an allied (same team) hero or town', () => {
  withEngine(() => null, () => {
    const state = createTestState();
    state.players[0].team = 5;
    state.players[1].team = 5;
    const a = mk(state, 'orrin', [['pikeman', 10]]);
    const d = mk(state, 'edric', [['pikeman', 3]], 1);
    assert.equal(startCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } }).error, 'allied');
    state.players[1].team = 6;
    assert.equal(startCombat(state, { attackerHeroId: a.id, defender: { heroId: d.id }, context: { kind: 'none' } }).ok, true);
  });
});
