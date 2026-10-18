import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRng } from '../../src/core/rng.js';
import { PRIMARY_SKILLS, MAX_SECONDARY_SKILLS, ARMY_SLOTS, SLOT_COUNTS } from '../../src/core/constants.js';
import { HERO_CLASSES, getHeroClass } from '../../src/data/heroClasses.js';
import { HEROES, getHeroDef } from '../../src/data/heroes.js';
import { SKILL_IDS, MAGIC_SCHOOL_SKILLS } from '../../src/data/skills.js';
import {
  MAX_HERO_LEVEL, WISDOM_GUARANTEE, SCHOOL_GUARANTEE, expForLevel, levelForExp, rollPrimarySkill,
  offerSecondarySkills, applySkillChoice, gainExperience, createHero, getSkillLevel, specialtyBonuses,
  creatureSpecialtyStatBonus,
} from '../../src/engine/leveling.js';

/** Level a hero up one level at a time, always taking option `pickIndex` (clamped). */
function levelTo(rng, hero, targetLevel, pickIndex = 0, onOffer = () => {}) {
  while (hero.level < targetLevel) {
    const before = hero.level;
    const { levelUps } = gainExperience(rng, hero, expForLevel(hero.level + 1) - hero.exp);
    assert.equal(levelUps.length, 1);
    assert.equal(hero.level, before + 1);
    const offers = levelUps[0].offers;
    onOffer(offers, hero);
    if (offers.length > 0) {
      const choice = offers[Math.min(pickIndex, offers.length - 1)];
      assert.equal(applySkillChoice(hero, choice.skillId).ok, true);
    }
  }
}

// ------------------------------------------------------------------ experience table

test('expForLevel: original table values', () => {
  const expected = [0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, 12200, 14700, 17500, 20600, 24320,
    28784, 34140, 40567, 48279, 57533, 68637];
  expected.forEach((exp, i) => assert.equal(expForLevel(i + 1), exp, `level ${i + 1}`));
  assert.throws(() => expForLevel(0));
  assert.throws(() => expForLevel(MAX_HERO_LEVEL + 1));
  assert.throws(() => expForLevel(2.5));
});

test('expForLevel: strictly increasing, +20% step growth after level 13', () => {
  for (let l = 2; l <= MAX_HERO_LEVEL; l++) assert.ok(expForLevel(l) > expForLevel(l - 1));
  for (let l = 14; l <= MAX_HERO_LEVEL; l++) {
    const prev = expForLevel(l - 1) - expForLevel(l - 2);
    assert.equal(expForLevel(l) - expForLevel(l - 1), Math.floor(prev * 1.2), `level ${l}`);
  }
  assert.ok(Number.isSafeInteger(expForLevel(MAX_HERO_LEVEL)));
});

test('levelForExp: inverse of expForLevel', () => {
  assert.equal(levelForExp(0), 1);
  assert.equal(levelForExp(999), 1);
  assert.equal(levelForExp(1000), 2);
  assert.equal(levelForExp(24319), 12);
  assert.equal(levelForExp(24320), 13);
  for (let l = 1; l <= MAX_HERO_LEVEL; l++) {
    assert.equal(levelForExp(expForLevel(l)), l);
    if (l > 1) assert.equal(levelForExp(expForLevel(l) - 1), l - 1);
  }
  assert.equal(levelForExp(Number.MAX_SAFE_INTEGER), MAX_HERO_LEVEL);
});

// ------------------------------------------------------------------ primary skills

test('rollPrimarySkill: follows the class distribution (low and high tables)', () => {
  const rng = createRng(7);
  for (const [level, table] of [[5, 'primaryChancesLow'], [15, 'primaryChancesHigh']]) {
    const counts = { attack: 0, defense: 0, power: 0, knowledge: 0 };
    const n = 20000;
    for (let i = 0; i < n; i++) counts[rollPrimarySkill(rng, 'barbarian', level)]++;
    for (const s of PRIMARY_SKILLS) {
      const expected = getHeroClass('barbarian')[table][s] / 100;
      assert.ok(Math.abs(counts[s] / n - expected) < 0.02, `${table} ${s}: ${counts[s] / n} vs ${expected}`);
    }
  }
  assert.throws(() => rollPrimarySkill(rng, 'nope', 2));
});

test('rollPrimarySkill: level 9 uses the low table, level 10 the high one', () => {
  // identical rng state => the roll differs only through the table used
  let differs = false;
  for (let seed = 1; seed <= 200 && !differs; seed++) {
    const a = rollPrimarySkill(createRng(seed), 'barbarian', 9);
    const b = rollPrimarySkill(createRng(seed), 'barbarian', 10);
    const c = rollPrimarySkill(createRng(seed), 'barbarian', 2);
    assert.equal(a, c);
    if (a !== b) differs = true;
  }
  assert.ok(differs);
});

// ------------------------------------------------------------------ createHero

test('createHero: output shape per DESIGN.md §4', () => {
  const hero = createHero(createRng(1), 'solmyr', { id: 'h1', owner: 2, pos: { x: 3, y: 4, z: 0 } });
  assert.equal(hero.id, 'h1');
  assert.equal(hero.defId, 'solmyr');
  assert.equal(hero.name, 'Solmyr');
  assert.equal(hero.classId, 'wizard');
  assert.equal(hero.owner, 2);
  assert.deepEqual(hero.pos, { x: 3, y: 4, z: 0 });
  assert.deepEqual(hero.primary, { attack: 0, defense: 0, power: 2, knowledge: 3 });
  assert.equal(hero.level, 1);
  assert.equal(hero.exp, 0);
  assert.equal(hero.mana, 30);
  assert.ok(hero.movePoints > 0 && hero.movePoints === hero.maxMovePoints);
  assert.deepEqual(hero.skills, [{ id: 'wisdom', level: 1 }, { id: 'sorcery', level: 1 }]);
  assert.deepEqual(hero.spells, ['chain_lightning']);
  assert.deepEqual(Object.keys(hero.artifacts.equipped).sort(), Object.keys(SLOT_COUNTS).sort());
  for (const [slot, n] of Object.entries(SLOT_COUNTS)) assert.equal(hero.artifacts.equipped[slot].length, n);
  assert.deepEqual(hero.artifacts.equipped.spellbook, ['spellbook']);
  assert.deepEqual(hero.artifacts.equipped.war_machine, [null, null, null, 'catapult']);
  assert.deepEqual(hero.artifacts.backpack, []);
  assert.equal(hero.army.length, ARMY_SLOTS);
  assert.deepEqual(hero.army.slice(3), [null, null, null, null]);
  assert.deepEqual(hero.temp, []);
  assert.deepEqual(hero.visited, {});
  assert.equal(hero.inBoat, false);
  assert.equal(hero.townId, null);
  assert.equal(hero.garrisoned, false);
  assert.equal(hero.asleep, false);
  assert.deepEqual(hero.skillCounters, { wisdom: 0, school: 0 });
  // plain JSON
  assert.deepEqual(JSON.parse(JSON.stringify(hero)), hero);
  assert.throws(() => createHero(createRng(1), 'nope'));
});

test('createHero: defaults, might heroes without spells have no spellbook, war machines', () => {
  const edric = createHero(createRng(3), 'edric');
  assert.equal(edric.id, 'edric');
  assert.equal(edric.owner, null);
  assert.deepEqual(edric.pos, { x: 0, y: 0, z: 0 });
  assert.deepEqual(edric.spells, []);
  assert.deepEqual(edric.artifacts.equipped.spellbook, [null]);
  assert.equal(edric.mana, 10);

  const christian = createHero(createRng(3), 'christian');
  assert.deepEqual(christian.artifacts.equipped.war_machine, ['ballista', null, null, 'catapult']);
  assert.equal(christian.army.filter(Boolean).length, 2);

  const rion = createHero(createRng(3), 'rion');
  assert.deepEqual(rion.artifacts.equipped.war_machine, [null, null, 'first_aid_tent', 'catapult']);

  // death knights are might heroes but know a spell => spellbook
  const tamika = createHero(createRng(3), 'tamika');
  assert.deepEqual(tamika.artifacts.equipped.spellbook, ['spellbook']);
});

test('createHero: every hero builds; army rolled within min-max; does not alias the definition', () => {
  const rng = createRng(11);
  for (const def of HEROES) {
    for (let i = 0; i < 5; i++) {
      const hero = createHero(rng, def.id);
      const cls = getHeroClass(def.classId);
      assert.deepEqual(hero.primary, cls.startPrimary);
      assert.equal(hero.mana, 10 * cls.startPrimary.knowledge);
      def.startArmy.forEach((s, idx) => {
        assert.equal(hero.army[idx].creatureId, s.creatureId);
        assert.ok(hero.army[idx].count >= s.min && hero.army[idx].count <= s.max, def.id);
      });
      hero.skills[0].level = 3;
      hero.primary.attack += 5;
    }
    assert.ok(def.startSkills[0].level < 3 || def.id === 'adrienne' || def.startSkills.length === 2);
    assert.deepEqual(createHero(rng, def.id).primary, getHeroClass(def.classId).startPrimary);
  }
  assert.deepEqual(getHeroDef('adrienne').startSkills[1], { id: 'fire_magic', level: 3 });
});

test('createHero: deterministic by seed', () => {
  assert.deepEqual(createHero(createRng(42), 'shakti'), createHero(createRng(42), 'shakti'));
  const counts = new Set();
  for (let seed = 1; seed <= 30; seed++) counts.add(createHero(createRng(seed), 'shakti').army[0].count);
  assert.ok(counts.size > 3, 'army size varies with the seed');
});

// ------------------------------------------------------------------ applySkillChoice

test('applySkillChoice: learn, upgrade, expert cap, 8 skill cap', () => {
  const hero = createHero(createRng(1), 'edric'); // leadership 1, armorer 1
  assert.deepEqual(applySkillChoice(hero, 'armorer'), { ok: true, skillId: 'armorer', level: 2 });
  assert.deepEqual(applySkillChoice(hero, 'armorer'), { ok: true, skillId: 'armorer', level: 3 });
  assert.deepEqual(applySkillChoice(hero, 'armorer'), { ok: false, error: 'skill_already_expert' });
  assert.equal(getSkillLevel(hero, 'armorer'), 3);
  assert.deepEqual(applySkillChoice(hero, 'luck'), { ok: true, skillId: 'luck', level: 1 });
  for (const id of ['offense', 'tactics', 'wisdom', 'archery', 'logistics']) assert.ok(applySkillChoice(hero, id).ok);
  assert.equal(hero.skills.length, MAX_SECONDARY_SKILLS);
  assert.deepEqual(applySkillChoice(hero, 'scouting'), { ok: false, error: 'no_free_skill_slot' });
  assert.equal(hero.skills.length, MAX_SECONDARY_SKILLS);
  assert.ok(applySkillChoice(hero, 'luck').ok, 'upgrades still work with full slots');
  assert.equal(getSkillLevel(hero, 'scouting'), 0);
  assert.throws(() => applySkillChoice(hero, 'nope'));
});

// ------------------------------------------------------------------ offers

test('offerSecondarySkills: one upgrade + one new skill while both are possible', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = createRng(seed);
    const hero = createHero(rng, 'edric');
    const offers = offerSecondarySkills(rng, hero);
    assert.equal(offers.length, 2);
    assert.ok(['leadership', 'armorer'].includes(offers[0].skillId));
    assert.equal(offers[0].level, 2);
    assert.equal(getSkillLevel(hero, offers[1].skillId), 0);
    assert.equal(offers[1].level, 1);
    assert.ok(getHeroClass('knight').skillWeights[offers[1].skillId] > 0);
  }
});

test('offerSecondarySkills: two new skills when nothing can be upgraded', () => {
  const rng = createRng(5);
  const hero = createHero(rng, 'crag_hack');
  hero.skills = [{ id: 'offense', level: 3 }];
  const offers = offerSecondarySkills(rng, hero);
  assert.equal(offers.length, 2);
  assert.notEqual(offers[0].skillId, offers[1].skillId);
  for (const o of offers) {
    assert.equal(o.level, 1);
    assert.notEqual(o.skillId, 'offense');
  }
});

test('offerSecondarySkills: two upgrades when all 8 slots are used; none when everything is expert', () => {
  const rng = createRng(5);
  const hero = createHero(rng, 'edric');
  hero.skills = ['leadership', 'armorer', 'offense', 'tactics', 'luck', 'archery', 'logistics', 'estates']
    .map((id) => ({ id, level: 1 }));
  for (let i = 0; i < 50; i++) {
    const offers = offerSecondarySkills(rng, hero);
    assert.equal(offers.length, 2);
    assert.notEqual(offers[0].skillId, offers[1].skillId);
    for (const o of offers) {
      assert.equal(getSkillLevel(hero, o.skillId), 1);
      assert.equal(o.level, 2);
    }
  }
  hero.skills.forEach((s, i) => { s.level = i === 0 ? 2 : 3; });
  assert.deepEqual(offerSecondarySkills(rng, hero), [{ skillId: 'leadership', level: 3 }]);
  hero.skills[0].level = 3;
  assert.deepEqual(offerSecondarySkills(rng, hero), []);
});

test('offerSecondarySkills: never offers banned (weight 0) skills, over many heroes and seeds', () => {
  for (const cls of HERO_CLASSES) {
    const def = HEROES.find((h) => h.classId === cls.id && !h.special);
    for (let seed = 1; seed <= 25; seed++) {
      const rng = createRng(seed * 31 + 1);
      const hero = createHero(rng, def.id);
      levelTo(rng, hero, 30, seed % 2, (offers, h) => {
        for (const o of offers) {
          if (getSkillLevel(h, o.skillId) === 0) {
            assert.ok(cls.skillWeights[o.skillId] > 0, `${cls.id} was offered banned skill ${o.skillId}`);
          }
        }
      });
      if (cls.faction !== 'necropolis') assert.equal(getSkillLevel(hero, 'necromancy'), 0);
      else assert.equal(getSkillLevel(hero, 'leadership'), 0);
    }
  }
});

test('offerSecondarySkills: caps hold through a whole career (max 8 skills, expert cap, valid offers)', () => {
  for (const defId of ['orrin', 'solmyr', 'sandro', 'crag_hack', 'luna', 'jeremy', 'agar', 'tazar']) {
    for (const pick of [0, 1]) {
      const rng = createRng(1234 + pick);
      const hero = createHero(rng, defId);
      levelTo(rng, hero, 40, pick, (offers, h) => {
        assert.ok(offers.length <= 2);
        assert.equal(new Set(offers.map((o) => o.skillId)).size, offers.length);
        for (const o of offers) {
          assert.ok(SKILL_IDS.includes(o.skillId));
          assert.equal(o.level, getSkillLevel(h, o.skillId) + 1);
          assert.ok(o.level >= 1 && o.level <= 3);
          if (o.level === 1) assert.ok(h.skills.length < MAX_SECONDARY_SKILLS);
        }
      });
      assert.ok(hero.skills.length <= MAX_SECONDARY_SKILLS);
      assert.equal(new Set(hero.skills.map((s) => s.id)).size, hero.skills.length);
      for (const s of hero.skills) assert.ok(s.level >= 1 && s.level <= 3);
      // 8 skills x 3 levels = 24 choices at most; by level 40 everything is expert
      assert.equal(hero.skills.length, MAX_SECONDARY_SKILLS);
      assert.ok(hero.skills.every((s) => s.level === 3), defId);
      assert.deepEqual(offerSecondarySkills(rng, hero), []);
    }
  }
});

test('offerSecondarySkills: Wisdom is guaranteed every 6 (might) / 3 (magic) levels', () => {
  for (const [defId, kind] of [['crag_hack', 'might'], ['edric', 'might'], ['luna', 'magic']]) {
    const period = WISDOM_GUARANTEE[kind];
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(seed);
      const hero = createHero(rng, defId);
      hero.skills = hero.skills.filter((s) => s.id !== 'wisdom');
      let sinceWisdom = 0;
      for (let i = 0; i < 12; i++) {
        const offers = offerSecondarySkills(rng, hero);
        sinceWisdom = offers.some((o) => o.skillId === 'wisdom') ? 0 : sinceWisdom + 1;
        assert.ok(sinceWisdom < period, `${defId} seed ${seed}: no wisdom offer for ${sinceWisdom} levels`);
        // always decline wisdom and take a non-wisdom upgrade/new skill only while slots remain
        const other = offers.find((o) => o.skillId !== 'wisdom' && o.level > 1);
        if (other) applySkillChoice(hero, other.skillId);
      }
    }
  }
});

test('offerSecondarySkills: a magic school is guaranteed every 4 (might) / 3 (magic) levels', () => {
  for (const [defId, kind] of [['orrin', 'might'], ['tazar', 'might'], ['sandro', 'magic'], ['adela', 'magic']]) {
    const period = SCHOOL_GUARANTEE[kind];
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(seed + 500);
      const hero = createHero(rng, defId);
      hero.skills = [{ id: 'wisdom', level: 3 }, ...hero.skills.filter((s) => s.id !== 'wisdom')]; // wisdom never competes
      let since = 0;
      for (let i = 0; i < 10; i++) {
        const offers = offerSecondarySkills(rng, hero);
        since = offers.some((o) => MAGIC_SCHOOL_SKILLS.includes(o.skillId)) ? 0 : since + 1;
        assert.ok(since < period, `${defId} seed ${seed}: no school offer for ${since} levels`);
      }
    }
  }
});

test('offerSecondarySkills: guarantees never override bans or caps', () => {
  // Stronghold heroes cannot learn Water Magic even when a school is forced.
  for (let seed = 1; seed <= 60; seed++) {
    const rng = createRng(seed);
    const hero = createHero(rng, 'crag_hack');
    for (let i = 0; i < 12; i++) {
      for (const o of offerSecondarySkills(rng, hero)) assert.notEqual(o.skillId, 'water_magic');
    }
  }
  // Full skill list without wisdom/schools: nothing new can be forced in.
  const rng = createRng(9);
  const hero = createHero(rng, 'edric');
  hero.skills = ['leadership', 'armorer', 'offense', 'tactics', 'luck', 'archery', 'logistics', 'estates']
    .map((id) => ({ id, level: 2 }));
  for (let i = 0; i < 20; i++) {
    for (const o of offerSecondarySkills(rng, hero)) assert.equal(o.level, 3);
  }
});

test('offerSecondarySkills: tolerates heroes without skillCounters (old saves)', () => {
  const rng = createRng(2);
  const hero = createHero(rng, 'edric');
  delete hero.skillCounters;
  assert.equal(offerSecondarySkills(rng, hero).length, 2);
  assert.ok(hero.skillCounters);
});

// ------------------------------------------------------------------ gainExperience

test('gainExperience: no level-up below the threshold', () => {
  const rng = createRng(1);
  const hero = createHero(rng, 'edric');
  const before = JSON.parse(JSON.stringify(hero));
  assert.deepEqual(gainExperience(rng, hero, 999), { levelUps: [] });
  assert.equal(hero.exp, 999);
  assert.equal(hero.level, 1);
  assert.deepEqual(hero.primary, before.primary);
  assert.deepEqual(hero.skills, before.skills);
  assert.throws(() => gainExperience(rng, hero, -5));
  assert.throws(() => gainExperience(rng, hero, NaN));
});

test('gainExperience: single level-up applies the primary skill and returns offers unresolved', () => {
  const rng = createRng(1);
  const hero = createHero(rng, 'edric');
  const skillsBefore = JSON.parse(JSON.stringify(hero.skills));
  const total = (h) => PRIMARY_SKILLS.reduce((a, s) => a + h.primary[s], 0);
  const before = total(hero);
  const { levelUps } = gainExperience(rng, hero, 1000);
  assert.equal(levelUps.length, 1);
  assert.equal(levelUps[0].level, 2);
  assert.ok(PRIMARY_SKILLS.includes(levelUps[0].primary));
  assert.equal(total(hero), before + 1);
  assert.equal(levelUps[0].offers.length, 2);
  assert.deepEqual(hero.skills, skillsBefore, 'choice is not resolved');
  assert.equal(hero.level, 2);
  assert.equal(hero.exp, 1000);
});

test('gainExperience: multiple level-ups at once; later offers are deferred until the choice is made', () => {
  const rng = createRng(77);
  const hero = createHero(rng, 'gelu');
  const total = (h) => PRIMARY_SKILLS.reduce((a, s) => a + h.primary[s], 0);
  const before = total(hero);
  const { levelUps } = gainExperience(rng, hero, 10500); // level 8 = 10000
  assert.equal(hero.level, 8);
  assert.deepEqual(levelUps.map((l) => l.level), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(total(hero), before + 7);
  assert.equal(levelUps[0].offers.length, 2);
  for (const l of levelUps.slice(1)) assert.equal(l.offers, null);

  // The game layer resolves them one by one.
  applySkillChoice(hero, levelUps[0].offers[0].skillId);
  for (const l of levelUps.slice(1)) {
    const offers = offerSecondarySkills(rng, hero);
    assert.ok(offers.length > 0, `level ${l.level}`);
    assert.ok(applySkillChoice(hero, offers[offers.length - 1].skillId).ok);
  }
  assert.equal(hero.skills.reduce((a, s) => a + s.level, 0), 2 + 7);
  assert.equal(levelForExp(hero.exp), hero.level);
});

test('gainExperience: level-ups without any possible choice do not block the chain', () => {
  const rng = createRng(3);
  const hero = createHero(rng, 'edric');
  hero.skills = ['leadership', 'armorer', 'offense', 'tactics', 'luck', 'archery', 'logistics', 'estates']
    .map((id) => ({ id, level: 3 }));
  const { levelUps } = gainExperience(rng, hero, expForLevel(5));
  assert.equal(levelUps.length, 4);
  for (const l of levelUps) assert.deepEqual(l.offers, []);
});

test('gainExperience: stops at the level cap', () => {
  const rng = createRng(3);
  const hero = createHero(rng, 'edric');
  const { levelUps } = gainExperience(rng, hero, expForLevel(MAX_HERO_LEVEL) * 2);
  assert.equal(hero.level, MAX_HERO_LEVEL);
  assert.equal(levelUps.length, MAX_HERO_LEVEL - 1);
  assert.deepEqual(gainExperience(rng, hero, 1e9), { levelUps: [] });
});

test('gainExperience: deterministic by seed, different seeds diverge', () => {
  const run = (seed) => {
    const rng = createRng(seed);
    const hero = createHero(rng, 'sandro');
    const log = [];
    levelTo(rng, hero, 25, 1, (offers) => log.push(offers.map((o) => `${o.skillId}${o.level}`).join('|')));
    return { hero, log, rng };
  };
  assert.deepEqual(run(2024), run(2024));
  const variants = new Set();
  for (let seed = 1; seed <= 10; seed++) variants.add(JSON.stringify(run(seed).log));
  assert.ok(variants.size > 5);
});

test('gainExperience: primary skills gained over a career reflect the class (might vs magic)', () => {
  const rngA = createRng(10);
  const barbarian = createHero(rngA, 'crag_hack');
  levelTo(rngA, barbarian, 9);
  const rngB = createRng(10);
  const warlock = createHero(rngB, 'jeddite');
  levelTo(rngB, warlock, 9);
  assert.ok(barbarian.primary.attack + barbarian.primary.defense > barbarian.primary.power + barbarian.primary.knowledge);
  assert.ok(warlock.primary.power + warlock.primary.knowledge > warlock.primary.attack + warlock.primary.defense);
});

// ------------------------------------------------------------------ specialties

test('specialtyBonuses: one mapping per specialty type', () => {
  assert.deepEqual(specialtyBonuses('edric', 6), [
    { type: 'creature_stat', filter: { creatureIds: ['griffin', 'royal_griffin'] }, stat: 'speed', value: 1 },
    { type: 'creature_specialty', creatures: ['griffin', 'royal_griffin'], percentPerStep: 5, heroLevel: 6 },
  ]);
  assert.deepEqual(specialtyBonuses('orrin', 10), [{ type: 'skill_percent', skillId: 'archery', percent: 50 }]);
  assert.deepEqual(specialtyBonuses('caitlin', 1), [{ type: 'resource_income', resource: 'gold', value: 350 }]);
  assert.deepEqual(specialtyBonuses('rissa', 20), [{ type: 'resource_income', resource: 'mercury', value: 1 }]);
  assert.deepEqual(specialtyBonuses('sir_mullich', 3), [{ type: 'creature_stat', stat: 'speed', value: 2 }]);
  assert.deepEqual(specialtyBonuses('adrienne', 3), [{ type: 'spell_school_mastery', school: 'fire', level: 3 }]);
  assert.deepEqual(specialtyBonuses('christian', 7),
    [{ type: 'creature_specialty', creatures: ['ballista'], tier: 5, percentPerStep: 5, heroLevel: 7 }]);
  assert.deepEqual(specialtyBonuses('thunar', 1), [
    { type: 'creature_stat', filter: { creatureIds: ['earth_elemental', 'magma_elemental'] }, stat: 'attack', value: 2 },
    { type: 'creature_stat', filter: { creatureIds: ['earth_elemental', 'magma_elemental'] }, stat: 'defense', value: 1 },
    { type: 'creature_stat', filter: { creatureIds: ['earth_elemental', 'magma_elemental'] }, stat: 'damage', value: 5 },
  ]);
  assert.deepEqual(specialtyBonuses('gelu', 1), [{ type: 'creature_upgrade',
    upgrades: { archer: 'sharpshooter', marksman: 'sharpshooter', wood_elf: 'sharpshooter', grand_elf: 'sharpshooter' } }]);
  assert.deepEqual(specialtyBonuses('solmyr', 12),
    [{ type: 'spell_specialty', spellId: 'chain_lightning', mode: 'level_scaled', heroLevel: 12, percentPerStep: 3 }]);
  assert.deepEqual(specialtyBonuses('cyra', 4),
    [{ type: 'spell_specialty', spellId: 'haste', mode: 'tiered', heroLevel: 4, tierBonus: [3, 3, 2, 2, 1, 1, 0] }]);
  assert.deepEqual(specialtyBonuses('ciele', 4),
    [{ type: 'spell_specialty', spellId: 'magic_arrow', mode: 'fixed_percent', heroLevel: 4, percent: 50 }]);
  assert.deepEqual(specialtyBonuses('coronius', 4),
    [{ type: 'spell_specialty', spellId: 'slayer', mode: 'tiered', heroLevel: 4, tierBonus: [4, 3, 2, 1, 0, 0, 0] }]);
  assert.deepEqual(specialtyBonuses('aenain', 4),
    [{ type: 'spell_specialty', spellId: 'disrupting_ray', mode: 'fixed_value', heroLevel: 4, value: 2 }]);
  for (const def of HEROES) assert.ok(specialtyBonuses(def.id, 10).length > 0, def.id);
});

test('creatureSpecialtyStatBonus: ceil(base * 5% * floor(heroLevel / tier))', () => {
  assert.equal(creatureSpecialtyStatBonus(8, 3, 1), 0);   // griffin attack 8, tier 3, hero level 1
  assert.equal(creatureSpecialtyStatBonus(8, 3, 3), 1);   // 0.4 -> 1
  assert.equal(creatureSpecialtyStatBonus(8, 3, 15), 2);  // 5 steps: 2.0
  assert.equal(creatureSpecialtyStatBonus(8, 3, 16), 2);
  assert.equal(creatureSpecialtyStatBonus(8, 3, 18), 3);  // 6 steps: 2.4 -> 3
  assert.equal(creatureSpecialtyStatBonus(5, 1, 20), 5);  // skeleton attack 5, tier 1: 100%
  assert.equal(creatureSpecialtyStatBonus(30, 7, 6), 0);
  assert.equal(creatureSpecialtyStatBonus(30, 7, 14), 3);
});
