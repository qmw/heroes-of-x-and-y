import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACTIONS, SPELL_SCHOOLS, MASTERY } from '../../src/core/constants.js';
import { createRng } from '../../src/core/rng.js';
import {
  SPELLS, SPELL_BY_ID, getSpell, HERO_SPELLS, ORIGINAL_SPELLS, EXTRA_SPELLS, CREATURE_ONLY_SPELLS,
  COMBAT_SPELLS, ADVENTURE_SPELLS,
  SPELL_SCHOOL_IDS, SPELL_KINDS, SPELL_TARGETS, SPELL_CATEGORIES, SPELL_ALIGNMENTS,
  SPELL_DURATION_KEYWORDS, EFFECT_TYPES, CONTROL_KINDS, OBSTACLE_KINDS, ADVENTURE_ACTIONS,
  AREA_SHAPES, DAMAGE_ELEMENTS, STAT_MOD_STATS, IMMUNITY_TAGS, VULNERABILITY_TAGS, SLAYER_KINDS,
  spellsOfSchool, spellsOfLevel, spellSchools, castingMastery, spellCost, spellValue, spellDuration,
  isMass, effectiveTarget, spellAffectsTags, vulnerabilityMultiplier, wisdomRequired,
  GUILD_SPELLS_PER_LEVEL, MAGE_GUILD_MAX_LEVEL, MAGE_GUILD_BANS, MAGE_GUILD_SCHOOL_WEIGHTS,
  MAGE_GUILD_SPELL_WEIGHTS, guildWeight, spellAllowedInGuild, guildSpellPool, rollGuildLevel,
  rollMageGuild,
} from '../../src/data/spells.js';

const is4 = (a) => Array.isArray(a) && a.length === 4;

/** Flatten an effect into itself + nested multi sub-effects. */
function flatEffects(effect) {
  return effect.type === 'multi' ? effect.effects.flatMap(flatEffects) : [effect];
}

// ---------------------------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------------------------

test('ids are unique snake_case and the lookup matches', () => {
  const ids = SPELLS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of SPELLS) {
    assert.match(s.id, /^[a-z][a-z0-9_]*$/);
    assert.equal(SPELL_BY_ID[s.id], s);
    assert.equal(getSpell(s.id), s);
    assert.ok(s.name.length > 0);
  }
  assert.throws(() => getSpell('no_such_spell'), /Unknown spell/);
});

test('every field is from its closed set', () => {
  for (const s of SPELLS) {
    const where = `spell ${s.id}`;
    assert.ok(SPELL_SCHOOL_IDS.includes(s.school), where);
    assert.ok(Number.isInteger(s.level) && s.level >= 1 && s.level <= 5, where);
    assert.ok(SPELL_KINDS.includes(s.kind), where);
    assert.ok(SPELL_TARGETS.includes(s.target), where);
    assert.ok(s.target2 === null || SPELL_TARGETS.includes(s.target2), where);
    if (s.targetByMastery) {
      assert.ok(is4(s.targetByMastery), where);
      for (const t of s.targetByMastery) assert.ok(SPELL_TARGETS.includes(t), where);
    }
    assert.ok(SPELL_CATEGORIES.includes(s.category), where);
    assert.ok(SPELL_ALIGNMENTS.includes(s.alignment), where);
    assert.ok(EFFECT_TYPES.includes(s.effect.type), `${where} effect ${s.effect.type}`);
    for (const t of s.immune) assert.ok(IMMUNITY_TAGS.includes(t), `${where} immune ${t}`);
    for (const t of s.requires) assert.ok(IMMUNITY_TAGS.includes(t), `${where} requires ${t}`);
    for (const t of s.vulnerable) assert.ok(VULNERABILITY_TAGS.includes(t), `${where} vulnerable ${t}`);
    for (const flag of ['resistible', 'dispellable', 'guild', 'extra', 'creatureOnly', 'special']) {
      assert.equal(typeof s[flag], 'boolean', `${where} ${flag}`);
    }
    assert.ok(Number.isFinite(s.aiValue) && s.aiValue >= 0, where);
  }
});

test('per-mastery arrays have 4 numeric entries', () => {
  for (const s of SPELLS) {
    const where = `spell ${s.id}`;
    assert.ok(is4(s.power), where);
    assert.ok(is4(s.costByMastery), where);
    assert.ok(is4(s.description), where);
    for (const v of s.power) assert.ok(Number.isFinite(v), where);
    for (const d of s.description) assert.ok(typeof d === 'string' && d.length > 10 && !d.includes('{'), where);
    assert.ok(Number.isFinite(s.perPower) && s.perPower >= 0, where);
    if (s.durationByMastery) assert.ok(is4(s.durationByMastery), where);
    // every array nested in the effect that is per-mastery must have length 4
    for (const e of flatEffects(s.effect)) {
      for (const [key, value] of Object.entries(e)) {
        if (Array.isArray(value) && key !== 'effects' && key !== 'victimImmune') {
          assert.ok(is4(value), `${where} effect.${key}`);
        }
      }
    }
  }
});

test('costs: positive, never increasing with mastery, cost == costByMastery[0]', () => {
  for (const s of SPELLS) {
    assert.equal(s.cost, s.costByMastery[0], s.id);
    for (let m = 1; m < 4; m++) assert.ok(s.costByMastery[m] <= s.costByMastery[m - 1], s.id);
    if (s.creatureOnly || s.special) {
      assert.deepEqual(s.costByMastery, [0, 0, 0, 0], s.id);
    } else {
      for (const c of s.costByMastery) assert.ok(Number.isInteger(c) && c > 0, s.id);
      assert.ok(s.costByMastery[1] < s.costByMastery[0], `${s.id} gets cheaper with mastery`);
    }
  }
});

test('durations, areas and mass flags are well formed', () => {
  for (const s of SPELLS) {
    const where = `spell ${s.id}`;
    const d = s.duration;
    assert.ok(d === null || SPELL_DURATION_KEYWORDS.includes(d) || (Number.isInteger(d) && d > 0), where);
    assert.ok(s.massAt === null || [1, 2, 3].includes(s.massAt), where);
    if (s.massAt !== null) {
      assert.ok(['friendly_stack', 'enemy_stack', 'any_stack'].includes(s.target), where);
    }
    if (s.area) {
      assert.ok(AREA_SHAPES.includes(s.area.shape), where);
      if (s.area.shape === 'radius' || s.area.shape === 'ring') assert.ok(is4(s.area.r), where);
      if (s.area.shape === 'chain') assert.ok(is4(s.area.targets) && s.area.factor === 0.5, where);
      if (s.area.shape === 'line') assert.ok(is4(s.area.length), where);
    }
    if (s.target === 'area') assert.ok(s.area, where);
    if (s.kind === 'adventure') {
      assert.equal(s.category, 'adventure', where);
      assert.equal(s.effect.type, 'adventure', where);
      assert.equal(s.target, 'none', where);
    }
  }
});

test('effect parameters come from their closed sets', () => {
  for (const s of SPELLS) {
    for (const e of flatEffects(s.effect)) {
      const where = `spell ${s.id} effect ${e.type}`;
      assert.ok(EFFECT_TYPES.includes(e.type) && e.type !== 'multi', where);
      switch (e.type) {
        case 'damage': case 'damage_over_time':
          assert.ok(e.element === null || DAMAGE_ELEMENTS.includes(e.element), where);
          break;
        case 'stat_mod':
          assert.ok(STAT_MOD_STATS.includes(e.stat), where);
          assert.ok([1, -1].includes(e.sign), where);
          assert.ok(['all', 'melee', 'ranged'].includes(e.mode), where);
          break;
        case 'speed_mod':
          assert.ok(['add', 'percent'].includes(e.op) && [1, -1].includes(e.sign), where);
          break;
        case 'max_hp_mod':
          assert.ok(e.op === 'percent' && [1, -1].includes(e.sign), where);
          break;
        case 'damage_mode':
          assert.ok(['max', 'min'].includes(e.mode), where);
          break;
        case 'damage_reduction':
          assert.ok(['melee', 'ranged', 'spell_school'].includes(e.against), where);
          if (e.against === 'spell_school') assert.ok(SPELL_SCHOOLS.includes(e.school), where);
          break;
        case 'damage_shield':
          assert.ok(DAMAGE_ELEMENTS.includes(e.element), where);
          break;
        case 'control':
          assert.ok(CONTROL_KINDS.includes(e.kind), where);
          break;
        case 'obstacle':
          assert.ok(OBSTACLE_KINDS.includes(e.kind), where);
          break;
        case 'remove_obstacle':
          for (const kinds of e.kinds) {
            for (const k of kinds) assert.ok(k === 'natural' || OBSTACLE_KINDS.includes(k), where);
          }
          break;
        case 'dispel':
          assert.ok(['all', 'positive', 'negative'].includes(e.which), where);
          break;
        case 'summon':
          assert.match(e.creatureId, /^[a-z_]+$/, where);
          break;
        case 'slayer':
          for (const kinds of e.versus) for (const k of kinds) assert.ok(SLAYER_KINDS.includes(k), where);
          break;
        case 'adventure':
          assert.ok(ADVENTURE_ACTIONS.includes(e.action), where);
          break;
        default:
      }
    }
  }
  // every closed-set member is actually used (no dead vocabulary)
  const used = new Set(SPELLS.flatMap((s) => [s.effect.type, ...flatEffects(s.effect).map((e) => e.type)]));
  for (const t of EFFECT_TYPES) assert.ok(used.has(t), `effect type ${t} unused`);
  const kinds = new Set(SPELLS.flatMap((s) => flatEffects(s.effect)).filter((e) => e.type === 'control').map((e) => e.kind));
  for (const k of CONTROL_KINDS) assert.ok(kinds.has(k), `control kind ${k} unused`);
  const actions = new Set(ADVENTURE_SPELLS.map((s) => s.effect.action));
  assert.deepEqual([...actions].sort(), [...ADVENTURE_ACTIONS].sort());
});

test('data is plain JSON', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(SPELLS)), SPELLS);
});

// ---------------------------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------------------------

const ORIGINAL_IDS = [
  'summon_boat', 'scuttle_boat', 'visions', 'view_earth', 'disguise', 'view_air', 'fly', 'water_walk',
  'dimension_door', 'town_portal', 'quicksand', 'land_mine', 'force_field', 'fire_wall', 'earthquake',
  'magic_arrow', 'ice_bolt', 'lightning_bolt', 'implosion', 'chain_lightning', 'frost_ring', 'fireball',
  'inferno', 'meteor_shower', 'death_ripple', 'destroy_undead', 'armageddon', 'shield', 'air_shield',
  'fire_shield', 'protection_from_air', 'protection_from_fire', 'protection_from_water',
  'protection_from_earth', 'anti_magic', 'dispel', 'magic_mirror', 'cure', 'resurrection', 'animate_dead',
  'sacrifice', 'bless', 'curse', 'bloodlust', 'precision', 'weakness', 'stone_skin', 'disrupting_ray',
  'prayer', 'mirth', 'sorrow', 'fortune', 'misfortune', 'haste', 'slow', 'slayer', 'frenzy',
  'titans_lightning_bolt', 'counterstrike', 'berserk', 'hypnotize', 'forgetfulness', 'blind', 'teleport',
  'remove_obstacle', 'clone', 'summon_fire_elemental', 'summon_earth_elemental',
  'summon_water_elemental', 'summon_air_elemental',
];

test('all 70 original spells are present', () => {
  assert.equal(ORIGINAL_IDS.length, 70);
  assert.equal(ORIGINAL_SPELLS.length, 70);
  assert.deepEqual(ORIGINAL_SPELLS.map((s) => s.id).sort(), [...ORIGINAL_IDS].sort());
  assert.equal(ADVENTURE_SPELLS.length, 10);
  assert.equal(COMBAT_SPELLS.length, HERO_SPELLS.length - 10);
});

test('original school / level distribution', () => {
  const count = (school) => ORIGINAL_SPELLS.filter((s) => s.school === school).length;
  assert.deepEqual([count('air'), count('earth'), count('fire'), count('water'), count('all')],
    [18, 17, 16, 17, 2]);
  const at = (id, school, level) => {
    assert.equal(getSpell(id).school, school, id);
    assert.equal(getSpell(id).level, level, id);
  };
  at('magic_arrow', 'all', 1); at('visions', 'all', 2);
  at('haste', 'air', 1); at('view_air', 'air', 1); at('lightning_bolt', 'air', 2);
  at('disrupting_ray', 'air', 2); at('precision', 'air', 2); at('fortune', 'air', 2);
  at('protection_from_air', 'air', 2); at('disguise', 'air', 2);
  at('air_shield', 'air', 3); at('destroy_undead', 'air', 3); at('hypnotize', 'air', 3);
  at('chain_lightning', 'air', 4); at('counterstrike', 'air', 4);
  at('dimension_door', 'air', 5); at('fly', 'air', 5); at('magic_mirror', 'air', 5);
  at('summon_air_elemental', 'air', 5); at('titans_lightning_bolt', 'air', 5);
  at('shield', 'earth', 1); at('slow', 'earth', 1); at('stone_skin', 'earth', 1); at('view_earth', 'earth', 1);
  at('death_ripple', 'earth', 2); at('quicksand', 'earth', 2);
  at('animate_dead', 'earth', 3); at('anti_magic', 'earth', 3); at('earthquake', 'earth', 3);
  at('force_field', 'earth', 3); at('protection_from_earth', 'earth', 3);
  at('meteor_shower', 'earth', 4); at('resurrection', 'earth', 4); at('sorrow', 'earth', 4);
  at('town_portal', 'earth', 4); at('implosion', 'earth', 5); at('summon_earth_elemental', 'earth', 5);
  at('bloodlust', 'fire', 1); at('curse', 'fire', 1); at('protection_from_fire', 'fire', 1);
  at('blind', 'fire', 2); at('fire_wall', 'fire', 2);
  at('fireball', 'fire', 3); at('land_mine', 'fire', 3); at('misfortune', 'fire', 3);
  at('armageddon', 'fire', 4); at('berserk', 'fire', 4); at('fire_shield', 'fire', 4);
  at('frenzy', 'fire', 4); at('inferno', 'fire', 4); at('slayer', 'fire', 4);
  at('sacrifice', 'fire', 5); at('summon_fire_elemental', 'fire', 5);
  at('bless', 'water', 1); at('cure', 'water', 1); at('dispel', 'water', 1);
  at('protection_from_water', 'water', 1); at('summon_boat', 'water', 1);
  at('ice_bolt', 'water', 2); at('remove_obstacle', 'water', 2); at('scuttle_boat', 'water', 2);
  at('weakness', 'water', 2);
  at('forgetfulness', 'water', 3); at('frost_ring', 'water', 3); at('mirth', 'water', 3);
  at('teleport', 'water', 3); at('clone', 'water', 4); at('prayer', 'water', 4);
  at('water_walk', 'water', 4); at('summon_water_elemental', 'water', 5);
});

test('damage spells: mana cost, base damage per mastery and per-power multiplier', () => {
  const check = (id, cost, reduced, perPower, power) => {
    const s = getSpell(id);
    assert.equal(s.cost, cost, `${id} cost`);
    assert.equal(s.costByMastery[1], reduced, `${id} reduced cost`);
    assert.equal(s.perPower, perPower, `${id} perPower`);
    assert.deepEqual(s.power, power, `${id} power`);
    assert.equal(s.category, 'damage', id);
  };
  check('magic_arrow', 5, 4, 10, [10, 10, 20, 30]);
  check('ice_bolt', 8, 6, 20, [10, 10, 20, 50]);
  check('lightning_bolt', 10, 8, 25, [10, 10, 20, 50]);
  check('implosion', 30, 25, 75, [100, 100, 200, 300]);
  check('chain_lightning', 24, 20, 40, [25, 25, 50, 100]);
  check('frost_ring', 12, 9, 10, [15, 15, 30, 60]);
  check('fireball', 15, 12, 10, [15, 15, 30, 60]);
  check('inferno', 16, 12, 10, [20, 20, 40, 80]);
  check('meteor_shower', 16, 12, 25, [25, 25, 50, 100]);
  check('death_ripple', 10, 8, 5, [10, 10, 20, 30]);
  check('destroy_undead', 15, 12, 10, [10, 10, 20, 50]);
  check('armageddon', 24, 20, 50, [30, 30, 60, 120]);
  check('land_mine', 18, 15, 10, [25, 25, 50, 100]);
  check('fire_wall', 8, 6, 10, [10, 10, 20, 50]);
  assert.deepEqual(getSpell('titans_lightning_bolt').power, [600, 600, 600, 600]);
  assert.equal(getSpell('titans_lightning_bolt').cost, 0);
  assert.equal(getSpell('titans_lightning_bolt').special, true);
});

test('spellValue applies base + power x perPower', () => {
  assert.equal(spellValue(getSpell('magic_arrow'), MASTERY.NONE, 5), 60);
  assert.equal(spellValue(getSpell('magic_arrow'), MASTERY.EXPERT, 10), 130);
  assert.equal(spellValue(getSpell('lightning_bolt'), MASTERY.EXPERT, 10), 300);
  assert.equal(spellValue(getSpell('implosion'), MASTERY.EXPERT, 20), 1800);
  assert.equal(spellValue(getSpell('chain_lightning'), MASTERY.ADVANCED, 10), 450);
  assert.equal(spellValue(getSpell('armageddon'), MASTERY.EXPERT, 10), 620);
  assert.equal(spellValue(getSpell('resurrection'), MASTERY.EXPERT, 10), 660);
  assert.equal(spellValue(getSpell('animate_dead'), MASTERY.BASIC, 4), 230);
  assert.equal(spellValue(getSpell('cure'), MASTERY.ADVANCED, 6), 50);
  assert.equal(spellValue(getSpell('hypnotize'), MASTERY.EXPERT, 10), 300);
  assert.equal(spellValue(getSpell('haste'), MASTERY.EXPERT, 99), 5);
  assert.equal(spellValue(getSpell('titans_lightning_bolt'), MASTERY.NONE, 30), 600);
});

test('area shapes of the classic area spells', () => {
  assert.deepEqual(getSpell('fireball').area, { shape: 'radius', r: [1, 1, 1, 1] });
  assert.deepEqual(getSpell('meteor_shower').area, { shape: 'radius', r: [1, 1, 1, 1] });
  assert.deepEqual(getSpell('inferno').area, { shape: 'radius', r: [2, 2, 2, 2] });
  assert.deepEqual(getSpell('frost_ring').area, { shape: 'ring', r: [1, 1, 1, 1] });
  assert.deepEqual(getSpell('chain_lightning').area, { shape: 'chain', targets: [4, 4, 4, 5], factor: 0.5 });
  assert.deepEqual(getSpell('berserk').area.r, [0, 0, 1, 2]);
  assert.deepEqual(getSpell('force_field').area.length, [2, 2, 3, 3]);
  assert.deepEqual(getSpell('fire_wall').area.length, [2, 2, 3, 3]);
  for (const id of ['armageddon', 'death_ripple', 'destroy_undead']) assert.equal(getSpell(id).target, 'all');
  for (const id of ['fireball', 'inferno', 'meteor_shower', 'frost_ring', 'chain_lightning', 'armageddon']) {
    assert.equal(getSpell(id).effect.friendlyFire, true, id);
  }
});

test('buff / debuff values', () => {
  const p = (id) => getSpell(id).power;
  assert.deepEqual(p('haste'), [3, 3, 5, 5]);
  assert.deepEqual(getSpell('haste').effect, { type: 'speed_mod', op: 'add', sign: 1 });
  assert.deepEqual(p('slow'), [25, 25, 50, 50]);
  assert.deepEqual(getSpell('slow').effect, { type: 'speed_mod', op: 'percent', sign: -1 });
  assert.deepEqual(getSpell('bless').effect, { type: 'damage_mode', mode: 'max', percent: [0, 0, 3, 3] });
  assert.deepEqual(getSpell('curse').effect, { type: 'damage_mode', mode: 'min', percent: [0, 0, -20, -20] });
  assert.equal(getSpell('bless').cost, 5);
  assert.equal(getSpell('curse').cost, 6);
  for (const id of ['bloodlust', 'precision', 'weakness', 'stone_skin']) assert.deepEqual(p(id), [3, 3, 6, 6], id);
  assert.equal(getSpell('bloodlust').effect.mode, 'melee');
  assert.equal(getSpell('precision').effect.mode, 'ranged');
  assert.equal(getSpell('weakness').effect.sign, -1);
  assert.equal(getSpell('stone_skin').effect.stat, 'defense');
  assert.deepEqual(p('disrupting_ray'), [3, 3, 4, 5]);
  assert.equal(getSpell('disrupting_ray').effect.stacking, true);
  assert.equal(getSpell('disrupting_ray').duration, 'battle');
  assert.equal(getSpell('disrupting_ray').dispellable, false);
  assert.deepEqual(p('prayer'), [2, 2, 4, 4]);
  assert.equal(getSpell('prayer').effect.effects.length, 3);
  for (const id of ['mirth', 'sorrow', 'fortune', 'misfortune', 'counterstrike']) assert.deepEqual(p(id), [1, 1, 2, 2], id);
  assert.deepEqual(p('shield'), [15, 15, 30, 30]);
  assert.deepEqual(p('air_shield'), [25, 25, 50, 50]);
  assert.deepEqual(p('fire_shield'), [20, 20, 25, 30]);
  for (const school of SPELL_SCHOOLS) {
    const s = getSpell(`protection_from_${school}`);
    assert.deepEqual(s.power, [30, 30, 50, 50]);
    assert.deepEqual(s.effect, { type: 'damage_reduction', against: 'spell_school', school });
  }
  assert.deepEqual(p('anti_magic'), [3, 3, 4, 5]);
  assert.deepEqual(p('magic_mirror'), [20, 20, 30, 40]);
  assert.deepEqual(p('frenzy'), [100, 100, 150, 200]);
  assert.deepEqual(p('slayer'), [8, 8, 8, 8]);
  assert.deepEqual(getSpell('slayer').effect.versus[3], ['dragon', 'behemoth', 'hydra', 'angel', 'devil', 'titan']);
  assert.deepEqual(p('clone'), [5, 5, 6, 7]);
  assert.deepEqual(p('hypnotize'), [10, 10, 20, 50]);
  assert.equal(getSpell('hypnotize').perPower, 25);
  assert.deepEqual(p('forgetfulness'), [50, 50, 100, 100]);
  assert.deepEqual(p('sacrifice'), [3, 3, 6, 10]);
  assert.deepEqual(p('earthquake'), [2, 2, 3, 4]);
  assert.deepEqual(getSpell('quicksand').effect.count, [4, 4, 6, 8]);
  assert.deepEqual(getSpell('land_mine').effect.count, [4, 4, 6, 8]);
});

test('raising / summoning', () => {
  const res = getSpell('resurrection');
  assert.deepEqual([res.cost, res.perPower], [20, 50]);
  assert.deepEqual(res.power, [40, 40, 80, 160]);
  assert.deepEqual(res.effect.permanent, [false, false, true, true]);
  assert.ok(res.immune.includes('undead'));
  const anim = getSpell('animate_dead');
  assert.deepEqual([anim.cost, anim.perPower], [15, 50]);
  assert.deepEqual(anim.power, [30, 30, 60, 160]);
  assert.deepEqual(anim.requires, ['undead']);
  for (const el of ['air', 'earth', 'fire', 'water']) {
    const s = getSpell(`summon_${el}_elemental`);
    assert.equal(s.school, el);
    assert.equal(s.cost, 25);
    assert.equal(s.effect.creatureId, `${el}_elemental`);
    assert.deepEqual(s.effect.perSpellPower, [2, 2, 3, 4]);
  }
});

test('mass at expert exactly for the classic mass spells', () => {
  const mass = ['bless', 'curse', 'bloodlust', 'precision', 'weakness', 'stone_skin', 'prayer', 'mirth',
    'sorrow', 'fortune', 'misfortune', 'haste', 'slow', 'shield', 'air_shield', 'protection_from_air',
    'protection_from_earth', 'protection_from_fire', 'protection_from_water', 'cure', 'counterstrike',
    'forgetfulness'];
  assert.deepEqual(ORIGINAL_SPELLS.filter((s) => s.massAt !== null).map((s) => s.id).sort(), mass.sort());
  for (const id of mass) assert.equal(getSpell(id).massAt, MASTERY.EXPERT, id);
  assert.equal(isMass(getSpell('haste'), MASTERY.ADVANCED), false);
  assert.equal(isMass(getSpell('haste'), MASTERY.EXPERT), true);
  assert.equal(effectiveTarget(getSpell('haste'), MASTERY.ADVANCED), 'friendly_stack');
  assert.equal(effectiveTarget(getSpell('haste'), MASTERY.EXPERT), 'all_friendly');
  assert.equal(effectiveTarget(getSpell('slow'), MASTERY.EXPERT), 'all_enemies');
  assert.equal(effectiveTarget(getSpell('blind'), MASTERY.EXPERT), 'enemy_stack');
  assert.deepEqual([0, 1, 2, 3].map((m) => effectiveTarget(getSpell('dispel'), m)),
    ['friendly_stack', 'friendly_stack', 'any_stack', 'all']);
});

test('adventure spells', () => {
  const tp = getSpell('town_portal');
  assert.deepEqual(tp.costByMastery, [16, 12, 12, 12]);
  assert.deepEqual(tp.effect.chooseTown, [false, false, true, true]);
  assert.deepEqual(tp.effect.moveCost, [300, 300, 300, 200]);
  const dd = getSpell('dimension_door');
  assert.deepEqual(dd.costByMastery, [25, 20, 20, 20]);
  assert.deepEqual(dd.effect.usesPerDay, [2, 2, 3, 4]);
  assert.deepEqual(dd.effect.moveCost, [300, 300, 300, 200]);
  assert.ok(dd.effect.range.every((r, i, a) => r > 0 && (i === 0 || r >= a[i - 1])));
  assert.deepEqual(getSpell('fly').costByMastery, [20, 15, 15, 15]);
  assert.deepEqual(getSpell('fly').power, [40, 40, 20, 0]);
  assert.deepEqual(getSpell('water_walk').costByMastery, [12, 9, 9, 9]);
  assert.deepEqual(getSpell('water_walk').power, [40, 40, 20, 0]);
  assert.deepEqual(getSpell('summon_boat').power, [50, 50, 75, 100]);
  assert.deepEqual(getSpell('scuttle_boat').power, [50, 50, 75, 100]);
  assert.deepEqual(getSpell('view_air').costByMastery, [2, 1, 1, 1]);
  assert.deepEqual(getSpell('view_air').effect.shows[3], ['artifacts', 'heroes', 'towns']);
  assert.deepEqual(getSpell('view_earth').effect.shows[3], ['resources', 'mines', 'terrain']);
  assert.deepEqual(getSpell('visions').costByMastery, [4, 2, 2, 2]);
  assert.deepEqual(getSpell('disguise').costByMastery, [4, 2, 2, 2]);
  for (const s of ADVENTURE_SPELLS) assert.equal(s.resistible, false, s.id);
});

test('immunity tags', () => {
  for (const id of ['blind', 'berserk', 'hypnotize', 'forgetfulness', 'frenzy', 'mirth', 'sorrow']) {
    const s = getSpell(id);
    for (const tag of ['mind_immune', 'undead', 'non_living']) assert.ok(s.immune.includes(tag), `${id} ${tag}`);
  }
  assert.ok(getSpell('blind').immune.includes('sightless'));
  assert.ok(getSpell('death_ripple').immune.includes('undead'));
  assert.deepEqual(getSpell('destroy_undead').requires, ['undead']);
  assert.deepEqual(getSpell('precision').requires, ['shooter']);
  // whole fire school is blocked by fire immunity
  for (const s of COMBAT_SPELLS.filter((x) => x.school === 'fire')) assert.ok(s.immune.includes('fire_immune'), s.id);
  // elemental immunities / vulnerabilities (air / earth / fire / water elemental)
  const air = ['non_living', 'earth_immune', 'lightning_vulnerable'];
  const earth = ['non_living', 'lightning_immune', 'earth_vulnerable'];
  const fire = ['non_living', 'fire_immune', 'cold_vulnerable'];
  const water = ['non_living', 'cold_immune', 'fire_vulnerable'];
  const hit = (id, tags) => (spellAffectsTags(getSpell(id), tags) ? vulnerabilityMultiplier(getSpell(id), tags) : 0);
  assert.deepEqual(['lightning_bolt', 'chain_lightning', 'armageddon', 'meteor_shower', 'fireball'].map((id) => hit(id, air)), [2, 2, 2, 0, 1]);
  assert.deepEqual(['lightning_bolt', 'chain_lightning', 'armageddon', 'meteor_shower', 'ice_bolt'].map((id) => hit(id, earth)), [0, 0, 0, 2, 1]);
  assert.deepEqual(['fireball', 'inferno', 'armageddon', 'ice_bolt', 'frost_ring', 'magic_arrow'].map((id) => hit(id, fire)), [0, 0, 0, 2, 2, 1]);
  assert.deepEqual(['ice_bolt', 'frost_ring', 'fireball', 'inferno', 'armageddon', 'lightning_bolt'].map((id) => hit(id, water)), [0, 0, 2, 2, 2, 1]);
  // requires / war machines
  assert.equal(spellAffectsTags(getSpell('destroy_undead'), []), false);
  assert.equal(spellAffectsTags(getSpell('destroy_undead'), ['undead']), true);
  assert.equal(spellAffectsTags(getSpell('animate_dead'), ['undead']), true);
  assert.equal(spellAffectsTags(getSpell('resurrection'), ['undead']), false);
  assert.equal(spellAffectsTags(getSpell('bless'), ['undead']), false);
  assert.equal(spellAffectsTags(getSpell('haste'), ['war_machine']), false);
  assert.equal(spellAffectsTags(getSpell('lightning_bolt'), ['war_machine']), true);
  assert.equal(spellAffectsTags(getSpell('death_ripple'), ['war_machine']), false);
});

test('alignment, resistibility and dispellability', () => {
  for (const id of ['haste', 'bless', 'cure', 'resurrection', 'prayer', 'clone', 'teleport']) {
    assert.equal(getSpell(id).alignment, 'positive', id);
    assert.equal(getSpell(id).resistible, false, id);
  }
  for (const id of ['slow', 'curse', 'blind', 'magic_arrow', 'implosion', 'hypnotize', 'disrupting_ray']) {
    assert.equal(getSpell(id).alignment, 'negative', id);
    assert.equal(getSpell(id).resistible, true, id);
  }
  for (const id of ['haste', 'slow', 'bless', 'blind', 'berserk', 'shield', 'immolation']) {
    assert.equal(getSpell(id).dispellable, true, id);
  }
  for (const id of ['disrupting_ray', 'anti_magic', 'magic_arrow', 'clone', 'acid_breath', 'bind']) {
    assert.equal(getSpell(id).dispellable, false, id);
  }
  for (const s of CREATURE_ONLY_SPELLS) assert.equal(s.resistible, false, s.id);
});

// ---------------------------------------------------------------------------------------------
// Extra & creature-only content
// ---------------------------------------------------------------------------------------------

test('extra spells: ~12, spread over all four schools, flagged and balanced', () => {
  assert.ok(EXTRA_SPELLS.length >= 12);
  for (const school of SPELL_SCHOOLS) {
    assert.ok(EXTRA_SPELLS.filter((s) => s.school === school).length >= 2, school);
  }
  assert.ok(new Set(EXTRA_SPELLS.map((s) => s.level)).size >= 4);
  for (const s of EXTRA_SPELLS) {
    assert.equal(s.creatureOnly, false);
    assert.equal(s.kind, 'combat');
    // damage per mana of an extra single-target nuke never beats Implosion's efficiency at SP 10
    if (s.category === 'damage' && s.target === 'enemy_stack' && s.duration === null) {
      assert.ok(spellValue(s, 3, 10) <= spellValue(getSpell('implosion'), 3, 10), s.id);
    }
  }
  for (const id of ['storm', 'entangle', 'immolation', 'regeneration']) assert.ok(SPELL_BY_ID[id], id);
  assert.equal(getSpell('regeneration').effect.type, 'heal_over_time');
  assert.equal(getSpell('regeneration').level, 2);
  assert.equal(getSpell('regeneration').school, 'water');
  assert.equal(getSpell('immolation').effect.type, 'damage_over_time');
  assert.equal(getSpell('entangle').effect.kind, 'bind');
  assert.deepEqual(getSpell('entangle').durationByMastery, [2, 2, 3, 3]);
});

test('creature-only effects exist, are free and never reach guilds or spellbooks', () => {
  for (const id of ['poison', 'disease', 'age', 'paralyze', 'petrify', 'bind', 'acid_breath', 'thunderbolt',
    'death_cloud', 'death_stare', 'fear', 'drain_life']) {
    const s = getSpell(id);
    assert.equal(s.creatureOnly, true, id);
    assert.equal(s.guild, false, id);
    assert.equal(s.cost, 0, id);
    assert.ok(s.triggerChance > 0 && s.triggerChance <= 100, id);
    assert.ok(!HERO_SPELLS.includes(s), id);
  }
  assert.equal(getSpell('paralyze').effect.kind, 'paralyze');
  assert.equal(getSpell('petrify').effect.kind, 'stone');
  assert.equal(getSpell('poison').effect.type, 'max_hp_mod');
  assert.equal(getSpell('age').power[0], 50);
  assert.deepEqual(getSpell('disease').effect.effects.map((e) => [e.stat, e.sign]), [['attack', -1], ['defense', -1]]);
  for (const id of ['poison', 'disease', 'age', 'death_stare', 'drain_life']) {
    assert.equal(spellAffectsTags(getSpell(id), ['undead']), false, id);
    assert.equal(spellAffectsTags(getSpell(id), ['non_living']), false, id);
    assert.equal(spellAffectsTags(getSpell(id), []), true, id);
  }
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

test('school / level helpers', () => {
  assert.ok(spellsOfSchool('air').some((s) => s.id === 'magic_arrow'));
  assert.ok(!spellsOfSchool('air', { strict: true }).some((s) => s.id === 'magic_arrow'));
  assert.ok(spellsOfSchool('fire').every((s) => !s.creatureOnly));
  assert.equal([1, 2, 3, 4, 5].reduce((n, l) => n + spellsOfLevel(l).length, 0), HERO_SPELLS.length);
  assert.deepEqual(spellSchools(getSpell('magic_arrow')), SPELL_SCHOOLS);
  assert.deepEqual(spellSchools(getSpell('haste')), ['air']);
  assert.equal(castingMastery(getSpell('haste'), { air: 2, fire: 3 }), 2);
  assert.equal(castingMastery(getSpell('magic_arrow'), { air: 2, fire: 3 }), 3);
  assert.equal(castingMastery(getSpell('slow'), {}), 0);
  assert.deepEqual([1, 2, 3, 4, 5].map(wisdomRequired), [0, 0, 1, 2, 3]);
});

test('spellCost', () => {
  assert.equal(spellCost(getSpell('magic_arrow')), 5);
  assert.equal(spellCost(getSpell('magic_arrow'), MASTERY.BASIC), 4);
  assert.equal(spellCost(getSpell('implosion'), MASTERY.EXPERT), 25);
  assert.equal(spellCost(getSpell('town_portal'), MASTERY.NONE), 16);
  assert.equal(spellCost(getSpell('haste'), MASTERY.EXPERT), 5);
  assert.equal(spellCost(getSpell('magic_arrow'), MASTERY.BASIC, -10), 1);
  assert.equal(spellCost(getSpell('magic_arrow'), MASTERY.NONE, 2), 7);
  assert.equal(spellCost(getSpell('titans_lightning_bolt'), MASTERY.NONE, 3), 0);
  assert.equal(spellCost(getSpell('magic_arrow'), 7), 4);
});

test('spellDuration', () => {
  assert.equal(spellDuration(getSpell('magic_arrow'), 0, 10), null);
  assert.equal(spellDuration(getSpell('haste'), 0, 7), 7);
  assert.equal(spellDuration(getSpell('haste'), 0, 7, 3), 10);
  assert.equal(spellDuration(getSpell('haste'), 0, 0), 1);
  assert.equal(spellDuration(getSpell('force_field'), 3, 20), 2);
  assert.equal(spellDuration(getSpell('frenzy'), 3, 20, 3), 1);
  assert.equal(spellDuration(getSpell('disrupting_ray'), 0, 1), Infinity);
  assert.equal(spellDuration(getSpell('entangle'), 1, 9), 2);
  assert.equal(spellDuration(getSpell('entangle'), 3, 9), 3);
  assert.equal(spellDuration(getSpell('poison'), 0, 0), 3);
});

// ---------------------------------------------------------------------------------------------
// Mage guilds
// ---------------------------------------------------------------------------------------------

test('guild tables cover every faction and reference real spells', () => {
  assert.deepEqual(GUILD_SPELLS_PER_LEVEL, [5, 4, 3, 2, 1]);
  for (const f of FACTIONS) {
    assert.ok(MAGE_GUILD_MAX_LEVEL[f] >= 3 && MAGE_GUILD_MAX_LEVEL[f] <= 5, f);
    assert.ok(Array.isArray(MAGE_GUILD_BANS[f]), f);
    for (const id of MAGE_GUILD_BANS[f]) assert.ok(SPELL_BY_ID[id], `${f} bans ${id}`);
    for (const school of SPELL_SCHOOLS) assert.ok(MAGE_GUILD_SCHOOL_WEIGHTS[f][school] > 0, f);
  }
  for (const [id, weights] of Object.entries(MAGE_GUILD_SPELL_WEIGHTS)) {
    assert.ok(SPELL_BY_ID[id], id);
    for (const key of Object.keys(weights)) assert.ok(key === '*' || FACTIONS.includes(key), `${id} ${key}`);
  }
  assert.equal(MAGE_GUILD_MAX_LEVEL.castle, 4);
  assert.equal(MAGE_GUILD_MAX_LEVEL.stronghold, 3);
  assert.equal(MAGE_GUILD_MAX_LEVEL.fortress, 3);
  assert.equal(MAGE_GUILD_MAX_LEVEL.tower, 5);
});

test('guild bans and weights', () => {
  assert.equal(spellAllowedInGuild(getSpell('armageddon'), 'castle'), false);
  assert.equal(spellAllowedInGuild(getSpell('armageddon'), 'inferno'), true);
  assert.equal(spellAllowedInGuild(getSpell('animate_dead'), 'castle'), false);
  assert.equal(spellAllowedInGuild(getSpell('animate_dead'), 'necropolis'), true);
  assert.equal(spellAllowedInGuild(getSpell('bless'), 'necropolis'), false);
  assert.equal(spellAllowedInGuild(getSpell('destroy_undead'), 'necropolis'), false);
  assert.equal(spellAllowedInGuild(getSpell('implosion'), 'castle'), false); // level 5 > max 4
  assert.equal(spellAllowedInGuild(getSpell('chain_lightning'), 'stronghold'), false);
  assert.equal(spellAllowedInGuild(getSpell('titans_lightning_bolt'), 'tower'), false);
  assert.equal(spellAllowedInGuild(getSpell('poison'), 'tower'), false);
  assert.equal(guildWeight(getSpell('magic_arrow'), 'castle'), 20);
  assert.equal(guildWeight(getSpell('bless'), 'castle'), 14);
  assert.equal(guildWeight(getSpell('animate_dead'), 'necropolis'), 20);
  assert.throws(() => guildWeight(getSpell('haste'), 'atlantis'), /Unknown faction/);
  for (const f of FACTIONS) {
    for (let level = 1; level <= MAGE_GUILD_MAX_LEVEL[f]; level++) {
      assert.ok(guildSpellPool(f, level).length >= GUILD_SPELLS_PER_LEVEL[level - 1] + 1, `${f} L${level}`);
    }
  }
});

test('rollMageGuild is deterministic, respects counts, bans and levels', () => {
  for (const f of FACTIONS) {
    for (let seed = 1; seed <= 20; seed++) {
      const guild = rollMageGuild(f, createRng(seed));
      assert.deepEqual(guild, rollMageGuild(f, createRng(seed)));
      assert.equal(guild.length, 5);
      guild.forEach((ids, i) => {
        const level = i + 1;
        assert.equal(ids.length, level <= MAGE_GUILD_MAX_LEVEL[f] ? GUILD_SPELLS_PER_LEVEL[i] : 0);
        assert.equal(new Set(ids).size, ids.length);
        for (const id of ids) {
          assert.equal(getSpell(id).level, level);
          assert.ok(spellAllowedInGuild(getSpell(id), f), `${f} rolled ${id}`);
        }
      });
    }
  }
  const library = rollMageGuild('tower', createRng(3), 1);
  assert.deepEqual(library.map((l) => l.length), [6, 5, 4, 3, 2]);
  assert.deepEqual(rollGuildLevel('tower', 5, createRng(1), 1, ['implosion']).includes('implosion'), false);
});
