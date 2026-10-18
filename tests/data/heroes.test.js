import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACTIONS, PRIMARY_SKILLS, RESOURCES, SPELL_SCHOOLS, MAX_SECONDARY_SKILLS } from '../../src/core/constants.js';
import { SKILLS, SKILL_BY_ID, SKILL_IDS, MAGIC_SCHOOL_SKILLS, getSkill, getSkillEffects } from '../../src/data/skills.js';
import { HERO_CLASSES, HERO_CLASS_BY_ID, getHeroClass, getFactionClasses } from '../../src/data/heroClasses.js';
import {
  HEROES, HERO_BY_ID, getHeroDef, getFactionHeroes, SPECIALTY_TYPES, SPELL_SPECIALTY_MODES,
  FACTION_START_ARMY, WAR_MACHINES,
} from '../../src/data/heroes.js';

const CLASSIC_TOWNS = ['castle', 'rampart', 'tower', 'inferno', 'necropolis', 'dungeon', 'stronghold', 'fortress'];

/** Import another agent's data module; null when it does not exist (yet). */
async function optional(path) {
  try { return await import(path); } catch { return null; }
}

function unique(ids) {
  return new Set(ids).size === ids.length;
}

// ------------------------------------------------------------------ skills

test('skills: 29 skills (28 original + interference) with unique ids', () => {
  assert.equal(SKILLS.length, 29);
  assert.ok(unique(SKILL_IDS));
  assert.ok(SKILL_BY_ID.interference);
  for (const id of ['pathfinding', 'archery', 'logistics', 'scouting', 'diplomacy', 'navigation', 'leadership',
    'wisdom', 'mysticism', 'luck', 'ballistics', 'eagle_eye', 'necromancy', 'estates', 'fire_magic', 'air_magic',
    'water_magic', 'earth_magic', 'scholar', 'tactics', 'artillery', 'learning', 'offense', 'armorer',
    'intelligence', 'sorcery', 'resistance', 'first_aid']) {
    assert.ok(SKILL_BY_ID[id], `missing skill ${id}`);
  }
  assert.throws(() => getSkill('nope'));
});

test('skills: every skill has 3 levels with structured effects', () => {
  for (const s of SKILLS) {
    assert.match(s.id, /^[a-z_]+$/);
    assert.ok(s.name && s.description);
    assert.equal(s.levels.length, 3, s.id);
    for (const lvl of s.levels) {
      assert.ok(lvl.description.length > 0);
      assert.ok(Array.isArray(lvl.effects) && lvl.effects.length > 0, s.id);
      for (const e of lvl.effects) assert.equal(typeof e.type, 'string');
    }
    // the same bonus type at each level, so levels are comparable
    assert.equal(new Set(s.levels.map((l) => l.effects[0].type)).size, 1, s.id);
    if (s.specialtyParam) {
      for (const lvl of s.levels) assert.equal(typeof lvl.effects[0][s.specialtyParam], 'number', s.id);
    }
  }
});

test('skills: exact original numbers', () => {
  const vals = (id, field) => [1, 2, 3].map((l) => getSkillEffects(id, l)[0][field]);
  assert.deepEqual(vals('archery', 'percent'), [10, 25, 50]);
  assert.deepEqual(vals('offense', 'percent'), [10, 20, 30]);
  assert.deepEqual(vals('armorer', 'percent'), [5, 10, 15]);
  assert.deepEqual(vals('logistics', 'percent'), [10, 20, 30]);
  assert.deepEqual(vals('necromancy', 'percent'), [10, 20, 30]);
  assert.deepEqual(vals('estates', 'value'), [125, 250, 500]);
  assert.deepEqual(vals('mysticism', 'value'), [2, 3, 4]);
  assert.deepEqual(vals('intelligence', 'percent'), [25, 50, 100]);
  assert.deepEqual(vals('sorcery', 'percent'), [5, 10, 15]);
  assert.deepEqual(vals('learning', 'percent'), [5, 10, 15]);
  assert.deepEqual(vals('eagle_eye', 'percent'), [40, 50, 60]);
  assert.deepEqual(vals('eagle_eye', 'maxLevel'), [2, 3, 4]);
  assert.deepEqual(vals('navigation', 'percent'), [50, 100, 150]);
  assert.deepEqual(vals('pathfinding', 'percent'), [25, 50, 75]);
  assert.deepEqual(vals('scouting', 'value'), [1, 2, 3]);
  assert.deepEqual(vals('tactics', 'hexes'), [3, 5, 7]);
  assert.deepEqual(vals('resistance', 'percent'), [5, 10, 20]);
  assert.deepEqual(vals('leadership', 'value'), [1, 2, 3]);
  assert.deepEqual(vals('luck', 'value'), [1, 2, 3]);
  assert.deepEqual(vals('wisdom', 'level'), [3, 4, 5]);
  assert.deepEqual(vals('scholar', 'maxLevel'), [2, 3, 4]);
  assert.deepEqual(vals('interference', 'percent'), [10, 20, 30]);
  assert.deepEqual(vals('first_aid', 'healMax'), [50, 75, 100]);
  assert.deepEqual(vals('artillery', 'doubleDamagePercent'), [50, 75, 100]);
  assert.deepEqual(vals('ballistics', 'shots'), [1, 2, 2]);
  assert.deepEqual(vals('diplomacy', 'surrenderDiscountPercent'), [20, 40, 60]);
  assert.equal(getSkillEffects('archery', 1)[0].mode, 'ranged');
  assert.equal(getSkillEffects('offense', 1)[0].mode, 'melee');
  assert.throws(() => getSkillEffects('archery', 4));
});

test('skills: magic schools map to spell_school_mastery of the right school', () => {
  assert.deepEqual(MAGIC_SCHOOL_SKILLS, SPELL_SCHOOLS.map((s) => `${s}_magic`));
  for (const school of SPELL_SCHOOLS) {
    for (const level of [1, 2, 3]) {
      assert.deepEqual(getSkillEffects(`${school}_magic`, level),
        [{ type: 'spell_school_mastery', school, level }]);
    }
  }
});

// ------------------------------------------------------------------ classes

test('classes: unique ids; a might and a magic class for each of the 11 factions', () => {
  assert.equal(HERO_CLASSES.length, 22);
  assert.ok(unique(HERO_CLASSES.map((c) => c.id)));
  for (const f of FACTIONS) {
    const cs = HERO_CLASSES.filter((c) => c.faction === f);
    assert.deepEqual(cs.map((c) => c.kind).sort(), ['magic', 'might'], f);
    const [might, magic] = getFactionClasses(f);
    assert.equal(HERO_CLASS_BY_ID[might].kind, 'might');
    assert.equal(HERO_CLASS_BY_ID[magic].kind, 'magic');
  }
  for (const c of HERO_CLASSES) assert.ok(FACTIONS.includes(c.faction));
  assert.throws(() => getHeroClass('nope'));
});

test('classes: primary chances sum to 100 and start stats are sane', () => {
  for (const c of HERO_CLASSES) {
    for (const table of [c.primaryChancesLow, c.primaryChancesHigh, c.startPrimary]) {
      assert.deepEqual(Object.keys(table), PRIMARY_SKILLS, c.id);
    }
    const sum = (t) => PRIMARY_SKILLS.reduce((a, s) => a + t[s], 0);
    assert.equal(sum(c.primaryChancesLow), 100, `${c.id} low`);
    assert.equal(sum(c.primaryChancesHigh), 100, `${c.id} high`);
    for (const s of PRIMARY_SKILLS) {
      assert.ok(c.startPrimary[s] >= 0 && Number.isInteger(c.startPrimary[s]));
      assert.ok(c.primaryChancesLow[s] > 0 && c.primaryChancesHigh[s] > 0);
    }
    assert.ok(c.startPrimary.power >= 1 && c.startPrimary.knowledge >= 1, `${c.id} needs power & knowledge >= 1`);
    assert.ok(sum(c.startPrimary) >= 5 && sum(c.startPrimary) <= 6, c.id);
  }
  assert.deepEqual(getHeroClass('knight').startPrimary, { attack: 2, defense: 2, power: 1, knowledge: 1 });
  assert.deepEqual(getHeroClass('barbarian').primaryChancesLow, { attack: 55, defense: 35, power: 5, knowledge: 5 });
  assert.deepEqual(getHeroClass('warlock').primaryChancesLow, { attack: 10, defense: 10, power: 50, knowledge: 30 });
});

test('classes: weights reference exactly the existing skills', () => {
  for (const c of HERO_CLASSES) {
    assert.deepEqual(Object.keys(c.skillWeights).sort(), [...SKILL_IDS].sort(), c.id);
    for (const w of Object.values(c.skillWeights)) assert.ok(Number.isInteger(w) && w >= 0 && w <= 10);
    // enough learnable skills to fill all 8 slots
    assert.ok(Object.values(c.skillWeights).filter((w) => w > 0).length >= MAX_SECONDARY_SKILLS);
    assert.ok(c.skillWeights.wisdom > 0, `${c.id} must be able to learn wisdom`);
    assert.ok(MAGIC_SCHOOL_SKILLS.some((s) => c.skillWeights[s] > 0));
  }
});

test('classes: banned skills of the original', () => {
  for (const c of HERO_CLASSES) {
    if (c.faction === 'necropolis') {
      assert.equal(c.skillWeights.necromancy, 10, c.id);
      assert.equal(c.skillWeights.leadership, 0, c.id);
    } else {
      assert.equal(c.skillWeights.necromancy, 0, c.id);
    }
  }
  // HCTRAITS zeros (audit docs/audit/heroes-artifacts.md)
  const zero = (ids, skill) => {
    for (const id of ids) assert.equal(getHeroClass(id).skillWeights[skill], 0, `${id}/${skill}`);
  };
  zero(['barbarian', 'overlord', 'mercenary'], 'water_magic');
  zero(['ranger', 'beastmaster'], 'fire_magic');
  zero(['wizard', 'warlock', 'witch', 'elementalist', 'artificer'], 'resistance');
  zero(['battle_mage'], 'navigation');
  zero(['death_knight', 'necromancer'], 'first_aid');
  zero(['death_knight'], 'estates');
  for (const c of HERO_CLASSES) {
    if (['wizard', 'warlock', 'witch', 'elementalist', 'artificer'].includes(c.id)) continue;
    assert.ok(c.skillWeights.resistance > 0, c.id);
  }
});

test('classes: secondary skill weights are the original HCTRAITS rows (sum 112 each)', () => {
  for (const c of HERO_CLASSES) {
    const sum = Object.entries(c.skillWeights).filter(([k]) => k !== 'interference').reduce((a, [, v]) => a + v, 0);
    assert.equal(sum, 112, c.id);
  }
  // signature weights of the original classes
  const w = (id, skill) => getHeroClass(id).skillWeights[skill];
  assert.equal(w('knight', 'leadership'), 10);
  assert.equal(w('cleric', 'first_aid'), 10);
  assert.equal(w('ranger', 'resistance'), 9);
  assert.equal(w('druid', 'luck'), 9);
  assert.equal(w('alchemist', 'learning'), 10);
  assert.equal(w('wizard', 'wisdom'), 10);
  assert.equal(w('wizard', 'intelligence'), 10);
  assert.equal(w('demoniac', 'logistics'), 10);
  assert.equal(w('heretic', 'mysticism'), 10);
  assert.equal(w('overlord', 'tactics'), 10);
  assert.equal(w('warlock', 'sorcery'), 10);
  assert.equal(w('barbarian', 'offense'), 10);
  assert.equal(w('battle_mage', 'logistics'), 9);
  assert.equal(w('beastmaster', 'armorer'), 10);
  assert.equal(w('witch', 'eagle_eye'), 10);
  assert.equal(w('planeswalker', 'offense'), 9);
  assert.equal(w('elementalist', 'fire_magic'), 6);
  assert.equal(w('captain', 'navigation'), 6);
  assert.equal(w('navigator', 'water_magic'), 9);
});

test('classes: primary skill chances of the HotA classes', () => {
  assert.deepEqual(getHeroClass('navigator').primaryChancesHigh, { attack: 30, defense: 20, power: 20, knowledge: 30 });
  assert.deepEqual(getHeroClass('mercenary').primaryChancesLow, { attack: 35, defense: 35, power: 15, knowledge: 15 });
  assert.deepEqual(getHeroClass('artificer').primaryChancesLow, { attack: 20, defense: 15, power: 30, knowledge: 35 });
});

// ------------------------------------------------------------------ heroes

test('heroes: unique ids, valid class/faction refs, required fields', () => {
  assert.ok(unique(HEROES.map((h) => h.id)));
  assert.ok(HEROES.length >= 176);
  for (const h of HEROES) {
    assert.match(h.id, /^[a-z0-9_]+$/);
    assert.equal(HERO_BY_ID[h.id], h);
    const cls = HERO_CLASS_BY_ID[h.classId];
    assert.ok(cls, `${h.id}: class ${h.classId}`);
    assert.equal(h.faction, cls.faction);
    assert.ok(FACTIONS.includes(h.faction));
    assert.ok(['male', 'female'].includes(h.gender));
    assert.ok(h.name.length > 0);
    assert.ok(h.biography.length > 10 && !h.biography.includes('\n'), h.id);
    assert.equal(typeof h.special, 'boolean');
  }
  assert.throws(() => getHeroDef('nope'));
});

test('heroes: every faction has >= 8 regular heroes per class (16 per town)', () => {
  for (const f of FACTIONS) {
    const regular = getFactionHeroes(f);
    assert.ok(regular.length >= 16, `${f}: ${regular.length}`);
    for (const classId of getFactionClasses(f)) {
      assert.ok(regular.filter((h) => h.classId === classId).length >= 8, `${f}/${classId}`);
    }
    assert.ok(regular.every((h) => !h.special));
    assert.ok(getFactionHeroes(f, true).length >= regular.length);
  }
  for (const f of CLASSIC_TOWNS) assert.equal(getFactionHeroes(f).length, 16, f);
});

test('heroes: special campaign heroes are flagged', () => {
  for (const id of ['sir_mullich', 'gelu', 'dracon', 'kilgor', 'lord_haart_undead', 'xeron', 'adrienne',
    'catherine', 'roland', 'mutare']) {
    assert.equal(getHeroDef(id).special, true, id);
  }
  for (const id of ['gem', 'sandro', 'lord_haart', 'crag_hack', 'solmyr']) {
    assert.equal(getHeroDef(id).special, false, id);
  }
});

test('heroes: start skills are valid, distinct and total 2 mastery levels (regular heroes)', () => {
  for (const h of HEROES) {
    assert.ok(h.startSkills.length >= 1 && h.startSkills.length <= 2, h.id);
    assert.ok(unique(h.startSkills.map((s) => s.id)), h.id);
    for (const s of h.startSkills) {
      assert.ok(SKILL_BY_ID[s.id], `${h.id}: skill ${s.id}`);
      assert.ok(s.level >= 1 && s.level <= 3);
    }
    if (!h.special && h.id !== 'neela' && h.id !== 'deemer' && h.id !== 'uland') {
      assert.equal(h.startSkills.reduce((a, s) => a + s.level, 0), 2, h.id);
    }
    if (h.faction === 'necropolis') assert.ok(h.startSkills.some((s) => s.id === 'necromancy'), h.id);
    else assert.ok(!h.startSkills.some((s) => s.id === 'necromancy'), h.id);
  }
});

test('heroes: magic heroes start with a spell; start army has 2-3 valid stacks', () => {
  for (const h of HEROES) {
    const cls = HERO_CLASS_BY_ID[h.classId];
    if (cls.kind === 'magic') assert.equal(typeof h.startSpell, 'string', h.id);
    else assert.ok(h.startSpell === null || typeof h.startSpell === 'string');
    assert.ok(h.startArmy.length >= 2 && h.startArmy.length <= 3, h.id);
    assert.equal(h.startArmy.length, h.startWarMachine ? 2 : 3, h.id);
    for (const s of h.startArmy) {
      assert.match(s.creatureId, /^[a-z_]+$/);
      assert.ok(Number.isInteger(s.min) && Number.isInteger(s.max) && s.min >= 1 && s.min <= s.max, h.id);
    }
    assert.ok(h.startWarMachine === null || WAR_MACHINES.includes(h.startWarMachine), h.id);
  }
  assert.deepEqual(Object.keys(FACTION_START_ARMY).sort(), [...FACTIONS].sort());
  assert.deepEqual(getHeroDef('edric').startArmy, [
    { creatureId: 'pikeman', min: 10, max: 20 },
    { creatureId: 'archer', min: 4, max: 7 },
    { creatureId: 'griffin', min: 2, max: 3 },
  ]);
});

test('heroes: specialties use the closed set of types with well-formed params', () => {
  const used = new Set();
  for (const h of HEROES) {
    const sp = h.specialty;
    used.add(sp.type);
    assert.ok(SPECIALTY_TYPES.includes(sp.type), `${h.id}: ${sp.type}`);
    assert.ok(sp.description.length > 0, h.id);
    switch (sp.type) {
      case 'creature':
        assert.ok(sp.creatures.length >= 1);
        break;
      case 'creature_bonus':
        assert.ok(sp.creatures.length >= 1);
        assert.ok(sp.attack + sp.defense + sp.damage + sp.speed > 0, h.id);
        break;
      case 'creature_upgrade':
        assert.ok(Object.keys(sp.upgrades).length >= 1);
        break;
      case 'skill':
        assert.ok(SKILL_BY_ID[sp.skillId], h.id);
        assert.ok(SKILL_BY_ID[sp.skillId].specialtyParam, `${h.id}: ${sp.skillId} has nothing to scale`);
        assert.ok(h.startSkills.some((s) => s.id === sp.skillId), `${h.id} should start with ${sp.skillId}`);
        break;
      case 'spell':
        assert.ok(SPELL_SPECIALTY_MODES.includes(sp.mode), h.id);
        assert.equal(h.startSpell, sp.spellId, h.id);
        if (sp.mode === 'level_scaled') assert.equal(sp.percentPerStep, 3);
        if (sp.mode === 'tiered') {
          assert.equal(sp.tierBonus.length, 7, h.id);
          for (let i = 1; i < 7; i++) assert.ok(sp.tierBonus[i] <= sp.tierBonus[i - 1], h.id);
        }
        if (sp.mode === 'fixed_percent') assert.ok(sp.percent > 0);
        if (sp.mode === 'fixed_value') assert.ok(sp.value > 0);
        break;
      case 'resource':
        assert.ok(RESOURCES.includes(sp.resource));
        assert.equal(sp.amount, sp.resource === 'gold' ? 350 : 1, h.id);
        break;
      case 'speed':
        assert.ok(sp.value > 0);
        break;
      case 'war_machine':
        assert.ok(WAR_MACHINES.includes(sp.machineId));
        assert.equal(h.startWarMachine, sp.machineId, h.id);
        break;
      case 'mastery':
        assert.ok(SPELL_SCHOOLS.includes(sp.school));
        break;
      default:
        assert.fail(sp.type);
    }
  }
  assert.deepEqual([...used].sort(), [...SPECIALTY_TYPES].sort(), 'every specialty type is used');
});

test('heroes: well-known heroes match the original', () => {
  const crag = getHeroDef('crag_hack');
  assert.equal(crag.classId, 'barbarian');
  assert.deepEqual(crag.startSkills, [{ id: 'offense', level: 2 }]);
  assert.deepEqual(crag.specialty.skillId, 'offense');
  const solmyr = getHeroDef('solmyr');
  assert.equal(solmyr.startSpell, 'chain_lightning');
  assert.equal(solmyr.specialty.spellId, 'chain_lightning');
  assert.equal(getHeroDef('tazar').specialty.skillId, 'armorer');
  assert.deepEqual(getHeroDef('galthran').specialty.creatures, ['skeleton', 'skeleton_warrior']);
  assert.deepEqual(getHeroDef('gelu').specialty.upgrades.archer, 'sharpshooter');
  assert.equal(getHeroDef('sir_mullich').specialty.type, 'speed');
  assert.equal(getHeroDef('christian').startWarMachine, 'ballista');
});

// ------------------------------------------------------------------ cross references (other agents' data)

test('cross-refs: factions.js lists the same hero classes', async (t) => {
  const mod = await optional('../../src/data/factions.js');
  if (!mod || !mod.FACTION_BY_ID) return t.skip('factions.js not available');
  for (const f of FACTIONS) {
    assert.deepEqual(mod.FACTION_BY_ID[f].heroClasses, getFactionClasses(f), f);
  }
});

test('cross-refs: creature ids exist in creatures.js', async (t) => {
  const mod = await optional('../../src/data/creatures.js');
  if (!mod || !mod.CREATURE_BY_ID) return t.skip('creatures.js not available');
  for (const h of HEROES) {
    const ids = [...h.startArmy.map((s) => s.creatureId), ...(h.specialty.creatures || [])];
    if (h.specialty.upgrades) ids.push(...Object.keys(h.specialty.upgrades), ...Object.values(h.specialty.upgrades));
    if (h.specialty.machineId) ids.push(h.specialty.machineId);
    for (const id of ids) assert.ok(mod.CREATURE_BY_ID[id], `${h.id}: unknown creature ${id}`);
    for (const s of h.startArmy) assert.equal(mod.CREATURE_BY_ID[s.creatureId].faction, h.faction, h.id);
  }
});

test('cross-refs: spell ids exist in spells.js', async (t) => {
  const mod = await optional('../../src/data/spells.js');
  if (!mod || !mod.SPELL_BY_ID) return t.skip('spells.js not available');
  for (const h of HEROES) {
    for (const id of [h.startSpell, h.specialty.spellId]) {
      if (id) assert.ok(mod.SPELL_BY_ID[id], `${h.id}: unknown spell ${id}`);
    }
  }
});

test('cross-refs: war machine artifacts exist in artifacts.js', async (t) => {
  const mod = await optional('../../src/data/artifacts.js');
  if (!mod || !mod.ARTIFACT_BY_ID) return t.skip('artifacts.js not available');
  for (const id of [...WAR_MACHINES, 'catapult', 'spellbook']) assert.ok(mod.ARTIFACT_BY_ID[id], id);
});
