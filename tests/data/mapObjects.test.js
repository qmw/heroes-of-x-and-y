import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FACTIONS, TERRAINS, RESOURCES, PRIMARY_SKILLS } from '../../src/core/constants.js';
import {
  TERRAIN_DATA, TERRAIN_BY_ID, getTerrain, LAND_TERRAINS, ROADS, ROAD_BY_INDEX, RIVERS, MAGIC_TERRAINS,
  MAGIC_TERRAIN_BY_ID, getMagicTerrain, OVERLAY_EFFECT_TYPES, stepMoveCost, DIAGONAL_FACTOR,
} from '../../src/data/terrain.js';
import {
  MAP_OBJECTS, MAP_OBJECT_BY_ID, getMapObject, CATEGORIES, EFFECT_TYPES, REVISIT, INTERACT, SHAPES,
  getObjectsByCategory, getObjectsByEffect, getObjectsForTerrain, getDwellingsForFaction, getDecorForTerrain,
  BANKS, DWELLINGS, DECOR, EXTRA_OBJECTS, DWELLING_TABLE, KEY_COLORS, MONOLITH_COLORS, TWO_WAY_COLORS,
  MONSTER_SIZE_LABELS, MONSTER_DISPOSITIONS, monsterSizeLabel, QUEST_TYPES, QUEST_REWARD_TYPES,
  PANDORA_PRESETS, SEER_PRESETS, referencedCreatureIds,
} from '../../src/data/mapObjects.js';

/** Import a sibling data module only if another agent has already written it. */
async function optional(path) {
  try { return await import(path); } catch { return null; }
}
const creaturesMod = await optional('../../src/data/creatures.js');
const artifactsMod = await optional('../../src/data/artifacts.js');
const skillsMod = await optional('../../src/data/skills.js');
const factionsMod = await optional('../../src/data/factions.js');

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const ID = /^[a-z][a-z0-9_]*$/;
const sum = (rows) => rows.reduce((s, r) => s + r.chance, 0);
const ART_CLASSES = ['treasure', 'minor', 'major', 'relic', 'any'];
const REWARD_KEYS = ['resources', 'randomResource', 'exp', 'mana', 'artifacts', 'creatures', 'creaturesByValue',
  'spell', 'spells', 'primary', 'bonuses'];

function checkAmount(a, label) {
  if (typeof a === 'number') { assert.ok(a >= 0, label); return; }
  assert.ok(Array.isArray(a) && (a.length === 2 || a.length === 3), `${label} range`);
  assert.ok(a[0] <= a[1], `${label} min<=max`);
  if (a.length === 3) assert.equal((a[1] - a[0]) % a[2], 0, `${label} step`);
}

function checkReward(r, label) {
  assert.equal(typeof r, 'object', label);
  for (const k of Object.keys(r)) assert.ok(REWARD_KEYS.includes(k), `${label}: unknown reward key ${k}`);
  for (const [res, a] of Object.entries(r.resources || {})) {
    assert.ok(RESOURCES.includes(res), `${label}: resource ${res}`);
    checkAmount(a, `${label}.${res}`);
  }
  if (r.randomResource) {
    for (const res of r.randomResource.pool) assert.ok(RESOURCES.includes(res), `${label}: pool ${res}`);
    checkAmount(r.randomResource.amount, `${label}.randomResource`);
  }
  for (const a of r.artifacts || []) {
    assert.ok(ART_CLASSES.includes(a.class), `${label}: artifact class ${a.class}`);
    assert.ok(a.count >= 1, `${label}: artifact count`);
  }
  for (const c of r.creatures || []) {
    assert.match(c.creatureId, ID, label);
    assert.ok(c.count >= 1, label);
  }
  for (const b of r.bonuses || []) {
    assert.equal(typeof b.bonus.type, 'string', label);
    assert.ok(['next_battle', 'end_of_day', 'end_of_week'].includes(b.until), label);
  }
}

// ---- terrain ---------------------------------------------------------------------------------

test('terrain covers every TERRAINS id with original movement costs', () => {
  assert.deepEqual(TERRAIN_DATA.map((t) => t.id).sort(), [...TERRAINS].sort());
  const cost = {
    grass: 100, dirt: 100, lava: 100, subterranean: 100, highlands: 100, rough: 125, wasteland: 125,
    sand: 150, snow: 150, swamp: 175, water: 100,
  };
  for (const [id, c] of Object.entries(cost)) assert.equal(getTerrain(id).moveCost, c, id);
  for (const t of TERRAIN_DATA) {
    assert.equal(TERRAIN_BY_ID[t.id], t);
    for (const k of ['name', 'color', 'battlefield', 'description']) assert.equal(typeof t[k], 'string', `${t.id}.${k}`);
    assert.match(t.color, HEX);
    assert.equal(t.colors.length, 4);
    for (const c of t.colors) assert.match(c, HEX);
    for (const f of t.nativeFactions) assert.ok(FACTIONS.includes(f), `${t.id} native ${f}`);
    for (const k of ['passable', 'water', 'surface', 'underground', 'diggable']) assert.equal(typeof t[k], 'boolean', `${t.id}.${k}`);
    for (const d of t.decor) assert.ok(SHAPES.includes(d), `${t.id} decor shape ${d}`);
  }
  assert.equal(getTerrain('rock').passable, false);
  assert.equal(getTerrain('water').water, true);
  assert.ok(!LAND_TERRAINS.includes('water') && !LAND_TERRAINS.includes('rock'));
  assert.equal(LAND_TERRAINS.length, 10);
  assert.throws(() => getTerrain('nope'));
});

test('every faction has a native terrain (and it matches factions.js when present)', () => {
  for (const f of FACTIONS) {
    const native = TERRAIN_DATA.filter((t) => t.nativeFactions.includes(f));
    assert.equal(native.length, 1, `${f} native terrain count`);
    if (factionsMod && factionsMod.FACTION_BY_ID) {
      assert.equal(native[0].id, factionsMod.FACTION_BY_ID[f].nativeTerrain, f);
    }
  }
});

test('roads and rivers', () => {
  assert.deepEqual(ROADS.map((r) => [r.id, r.index, r.moveCost]),
    [['dirt_road', 1, 75], ['gravel_road', 2, 65], ['cobblestone_road', 3, 50]]);
  assert.equal(ROAD_BY_INDEX[3].moveCost, 50);
  assert.equal(RIVERS.length, 4);
  for (const t of TERRAIN_DATA) {
    if (t.river) assert.ok(RIVERS.find((r) => r.id === t.river).terrains.includes(t.id), `${t.id} river`);
  }
});

test('magic terrain overlays use the closed effect set', () => {
  const expected = ['magic_plains', 'cursed_ground', 'holy_ground', 'evil_fog', 'clover_field', 'lucid_pools',
    'fiery_fields', 'rocklands', 'magic_clouds', 'cracked_ice', 'dunes', 'fields_of_glory'];
  for (const id of expected) assert.ok(MAGIC_TERRAIN_BY_ID[id], id);
  for (const m of MAGIC_TERRAINS) {
    assert.match(m.id, ID);
    assert.match(m.color, HEX);
    assert.ok(m.effects.length >= 1, m.id);
    for (const e of m.effects) assert.ok(OVERLAY_EFFECT_TYPES.includes(e.type), `${m.id}: ${e.type}`);
    for (const t of m.terrains) assert.ok(TERRAINS.includes(t), `${m.id}: ${t}`);
  }
  assert.deepEqual(getMagicTerrain('magic_plains').effects, [{ type: 'spell_mastery', school: 'all', level: 3 }]);
  assert.deepEqual(getMagicTerrain('cursed_ground').effects[0], { type: 'spell_level_cap', maxLevel: 1 });
  assert.deepEqual(getMagicTerrain('clover_field').effects, [{ type: 'luck', alignment: 'neutral', value: 2 }]);
  assert.throws(() => getMagicTerrain('nope'));
});

test('stepMoveCost: terrain of origin, roads, diagonal, pathfinding, native army', () => {
  const t = (id, road = 0, overlay = null) => ({ t: id, road, overlay });
  assert.equal(DIAGONAL_FACTOR, Math.SQRT2); // original: cost * sqrt(2), truncated
  assert.equal(stepMoveCost(t('grass'), t('grass'), false), 100);
  assert.equal(stepMoveCost(t('grass'), t('grass'), true), 141);
  // the tile being LEFT decides
  assert.equal(stepMoveCost(t('swamp'), t('grass'), false), 175);
  assert.equal(stepMoveCost(t('grass'), t('swamp'), false), 100);
  assert.equal(stepMoveCost(t('swamp'), t('swamp'), true), 247);
  assert.equal(stepMoveCost(t('sand'), t('sand'), true), 212);
  assert.equal(stepMoveCost(t('dirt', 1), t('dirt', 1), true), 106);
  assert.equal(stepMoveCost(t('swamp', 2), t('swamp', 2), true), 91);
  assert.equal(stepMoveCost(t('water', 0, 'favorable_winds'), t('water'), true), 93);
  assert.equal(stepMoveCost(t('rough'), t('rough'), true), 176);
  // roads need both ends and ignore terrain
  assert.equal(stepMoveCost(t('swamp', 1), t('swamp', 1), false), 75);
  assert.equal(stepMoveCost(t('swamp', 2), t('swamp', 3), false), 65);
  assert.equal(stepMoveCost(t('swamp', 3), t('swamp', 1), false), 50);
  assert.equal(stepMoveCost(t('swamp', 3), t('swamp', 3), true), 70);
  assert.equal(stepMoveCost(t('swamp', 3), t('swamp', 0), false), 175);
  assert.equal(stepMoveCost(t('swamp', 0), t('swamp', 3), false), 175);
  // pathfinding: flat 25/50/75, never below 100
  assert.deepEqual([1, 2, 3].map((p) => stepMoveCost(t('swamp'), t('swamp'), false, { pathfinding: p })), [150, 125, 100]);
  assert.deepEqual([1, 2, 3].map((p) => stepMoveCost(t('sand'), t('sand'), false, { pathfinding: p })), [125, 100, 100]);
  assert.deepEqual([1, 2, 3].map((p) => stepMoveCost(t('rough'), t('rough'), false, { pathfinding: p })), [100, 100, 100]);
  assert.equal(stepMoveCost(t('grass'), t('grass'), false, { pathfinding: 3 }), 100);
  // native army ignores the penalty
  assert.equal(stepMoveCost(t('swamp'), t('swamp'), false, { nativeTerrains: ['swamp'] }), 100);
  assert.equal(stepMoveCost(t('snow'), t('snow'), false, { nativeTerrains: ['swamp'] }), 150);
  // percent reduction of the remaining penalty
  assert.equal(stepMoveCost(t('swamp'), t('swamp'), false, { reductionPercent: 50 }), 137);
  // sea
  assert.equal(stepMoveCost(t('water'), t('water'), false), 100);
  assert.equal(stepMoveCost(t('water', 0, 'favorable_winds'), t('water'), false), 66);
  assert.equal(stepMoveCost(t('grass'), t('rock'), false), Infinity);
});

// ---- object definitions ----------------------------------------------------------------------

test('object ids are unique and lookups work', () => {
  const ids = MAP_OBJECTS.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const o of MAP_OBJECTS) {
    assert.match(o.id, ID);
    assert.equal(MAP_OBJECT_BY_ID[o.id], o);
    assert.equal(getMapObject(o.id), o);
  }
  assert.throws(() => getMapObject('nope'));
  assert.ok(MAP_OBJECTS.length > 300);
});

test('required fields and closed sets', () => {
  for (const o of MAP_OBJECTS) {
    const l = o.id;
    assert.ok(o.name.length > 0, l);
    assert.ok(CATEGORIES.includes(o.category), `${l}: category ${o.category}`);
    assert.ok(o.effect && Object.hasOwn(EFFECT_TYPES, o.effect.type), `${l}: effect ${o.effect && o.effect.type}`);
    assert.ok(REVISIT.includes(o.revisit), `${l}: revisit ${o.revisit}`);
    assert.ok(INTERACT.includes(o.interact), `${l}: interact ${o.interact}`);
    assert.ok(SHAPES.includes(o.shape), `${l}: shape ${o.shape}`);
    assert.match(o.color, HEX, l);
    for (const k of ['blocking', 'visitable', 'removable', 'extra']) assert.equal(typeof o[k], 'boolean', `${l}.${k}`);
    assert.ok(Array.isArray(o.size) && o.size.length === 2 && o.size.every((n) => Number.isInteger(n) && n >= 1 && n <= 5), `${l}.size`);
    assert.ok(Number.isFinite(o.value) && o.value >= 0, `${l}.value`);
    assert.ok(Number.isFinite(o.frequency) && o.frequency >= 0, `${l}.frequency`);
    assert.ok(o.description.length > 5, `${l}.description`);
    assert.ok(o.terrains.length >= 1, `${l}.terrains`);
    for (const t of o.terrains) assert.ok(TERRAINS.includes(t) && t !== 'rock', `${l}: terrain ${t}`);
    // internal consistency
    assert.equal(o.visitable, o.interact !== 'none', `${l}: visitable vs interact`);
    assert.equal(o.visitable, o.revisit !== 'none', `${l}: visitable vs revisit`);
    assert.equal(o.removable, o.revisit === 'removed', `${l}: removable vs revisit`);
    if (o.category === 'decor') assert.equal(o.effect.type, 'none', l);
    if (o.category === 'visit_weekly') assert.equal(o.revisit, 'weekly', l);
    if (o.category === 'visit_per_player') assert.equal(o.revisit, 'per_player', l);
    if (o.category === 'visit_per_hero') assert.ok(o.revisit.startsWith('per_'), l);
    assert.doesNotThrow(() => JSON.stringify(o));
  }
  for (const c of CATEGORIES) assert.ok(getObjectsByCategory(c).length > 0, `category ${c} unused`);
  for (const t of Object.keys(EFFECT_TYPES)) assert.ok(getObjectsByEffect(t).length > 0, `effect ${t} unused`);
});

test('every effect type, revisit mode and overlay effect is documented', () => {
  const doc = readFileSync(new URL('../../docs/mechanics/adventure-objects.md', import.meta.url), 'utf8');
  for (const t of Object.keys(EFFECT_TYPES)) assert.ok(doc.includes(`\`${t}\``), `effect ${t} missing from doc`);
  for (const r of REVISIT) assert.ok(doc.includes(`\`${r}\``), `revisit ${r} missing from doc`);
  for (const e of OVERLAY_EFFECT_TYPES) assert.ok(doc.includes(`\`${e}\``), `overlay effect ${e} missing from doc`);
  for (const q of QUEST_TYPES) assert.ok(doc.includes(`\`${q}\``), `quest ${q} missing from doc`);
});

test('every chance table sums to 100 and rewards are well formed', () => {
  let tables = 0;
  for (const o of MAP_OBJECTS) {
    const e = o.effect;
    for (const key of ['table', 'firstWeekTable', 'costTable', 'levels']) {
      if (!e[key]) continue;
      tables++;
      assert.equal(sum(e[key]), 100, `${o.id}.${key} chances`);
      for (const r of e[key]) {
        assert.ok(r.chance > 0, `${o.id}.${key}`);
        if (r.reward) checkReward(r.reward, `${o.id}.${key}`);
      }
    }
    for (const p of [...(e.penalty || []), ...(e.emptyPenalty || [])]) {
      assert.equal(p.until, 'next_battle', o.id);
      assert.ok(['morale', 'luck'].includes(p.bonus.type) && p.bonus.value < 0, o.id);
    }
  }
  assert.ok(tables > 60);
  for (const p of [...getObjectsByEffect('pickup'), ...getObjectsByEffect('weekly_reward'), ...getObjectsByEffect('reward_once')]) {
    assert.ok(Array.isArray(p.effect.table), `${p.id} needs a table`);
  }
});

test('resource piles and treasure chest have the original numbers', () => {
  for (const r of RESOURCES) assert.ok(MAP_OBJECT_BY_ID[`resource_${r}`], r);
  const amt = (r) => getMapObject(`resource_${r}`).effect.table[0].reward.resources[r];
  assert.deepEqual(amt('wood'), [5, 10]);
  assert.deepEqual(amt('ore'), [5, 10]);
  for (const r of ['mercury', 'sulfur', 'crystal', 'gems']) assert.deepEqual(amt(r), [3, 6]);
  assert.deepEqual(amt('gold'), [500, 1000, 100]);
  assert.equal(getObjectsByCategory('resource').filter((o) => !o.effect.placeholder).length, 7);

  const chest = getMapObject('treasure_chest');
  assert.equal(chest.effect.type, 'chest');
  assert.deepEqual(chest.effect.table.filter((r) => r.gold).map((r) => [r.gold, r.exp]), [[1000, 500], [1500, 1000], [2000, 1500]]);
  assert.deepEqual(chest.effect.table.map((r) => r.chance), [32, 32, 31, 5]);
  assert.deepEqual(chest.effect.table[3].artifact, { class: 'treasure', count: 1 });
  assert.equal(chest.removable, true);
  assert.equal(chest.interact, 'adjacent');

  const camp = getMapObject('campfire').effect.table;
  assert.deepEqual(camp.map((r) => [r.reward.resources.gold, r.reward.randomResource.amount]), [[400, 4], [500, 5], [600, 6]]);
  assert.ok(!camp[0].reward.randomResource.pool.includes('gold'));
  for (const id of ['flotsam', 'sea_chest', 'shipwreck_survivor', 'sea_barrel', 'jetsam', 'ocean_bottle', 'whirlpool', 'boat', 'buoy', 'mermaids', 'derelict_ship', 'shipwreck']) {
    assert.deepEqual(getMapObject(id).terrains, ['water'], id);
  }
  for (const id of ['artifact_treasure', 'artifact_minor', 'artifact_major', 'artifact_relic', 'artifact_random', 'spell_scroll', 'pandoras_box', 'grail']) {
    assert.ok(MAP_OBJECT_BY_ID[id], id);
  }
  assert.deepEqual(['treasure', 'minor', 'major', 'relic'].map((c) => getMapObject(`artifact_${c}`).value), [2000, 5000, 10000, 20000]);
});

test('mines produce the original income', () => {
  const income = { sawmill: ['wood', 2], ore_pit: ['ore', 2], alchemists_lab: ['mercury', 1], sulfur_dune: ['sulfur', 1],
    crystal_cavern: ['crystal', 1], gem_pond: ['gems', 1], gold_mine: ['gold', 1000] };
  for (const [id, [resource, amount]] of Object.entries(income)) {
    const m = getMapObject(id);
    assert.equal(m.category, 'mine');
    assert.equal(m.effect.type, 'mine');
    assert.equal(m.effect.resource, resource, id);
    assert.equal(m.effect.amount, amount, id);
    assert.equal(m.removable, false);
  }
  const ab = getMapObject('abandoned_mine').effect;
  assert.equal(ab.guards[0].creatureId, 'troglodyte');
  assert.deepEqual(ab.guards[0].count, [100, 249]);
  assert.ok(!ab.pool.includes('wood'));
  for (const r of ab.pool) assert.equal(ab.amountByResource[r], getObjectsByEffect('mine').find((m) => m.effect.resource === r).effect.amount, r);

  assert.deepEqual(getMapObject('water_wheel').effect.table[0].reward.resources, { gold: 1000 });
  assert.deepEqual(getMapObject('water_wheel').effect.firstWeekTable[0].reward.resources, { gold: 500 });
  const wind = getMapObject('windmill').effect.table[0].reward.randomResource;
  assert.deepEqual(wind.amount, [3, 6]);
  assert.ok(!wind.pool.includes('wood') && !wind.pool.includes('gold'));
  assert.equal(getMapObject('warriors_tomb').effect.penalty[0].bonus.value, -3);
});

test('creature banks: structure and original tables', () => {
  const required = ['cyclops_stockpile', 'dwarven_treasury', 'griffin_conservatory', 'imp_cache', 'medusa_stores', 'naga_bank',
    'dragon_fly_hive', 'dragon_utopia', 'crypt', 'derelict_ship', 'shipwreck', 'beholders_sanctuary', 'temple_of_the_sea',
    'pirate_cavern', 'mansion', 'spit', 'red_tower', 'black_tower', 'ivory_tower', 'churchyard', 'experimental_shop',
    'wolf_raider_picket', 'ruins', 'pyramid'];
  for (const id of required) assert.equal(getMapObject(id).effect.type, 'bank', id);
  assert.ok(BANKS.filter((b) => b.extra).length >= 6);
  for (const b of BANKS) {
    assert.equal(b.category, 'bank', b.id);
    assert.equal(b.effect.confirm, true);
    assert.equal(sum(b.effect.levels), 100, b.id);
    assert.ok(b.value > 0, b.id);
    for (const l of b.effect.levels) {
      assert.ok(l.guards.length >= 1 && l.guards.length <= 7, b.id);
      let stacks = 0;
      for (const gd of l.guards) {
        assert.match(gd.creatureId, ID);
        assert.ok(gd.count >= 1 && gd.stacks >= 1 && gd.stacks <= gd.count, `${b.id} guard`);
        stacks += gd.stacks;
      }
      assert.ok(stacks <= 7, `${b.id}: too many stacks`);
      assert.ok(Object.keys(l.reward).length > 0, `${b.id}: empty reward`);
    }
    if (b.effect.levels.length === 4) assert.deepEqual(b.effect.levels.map((l) => l.chance), [30, 30, 30, 10], b.id);
  }
  const lv = (id) => getMapObject(id).effect.levels;
  const guards = (id) => lv(id).map((l) => l.guards.map((x) => x.count));

  const u = lv('dragon_utopia');
  assert.deepEqual(u.map((l) => l.reward.resources.gold), [20000, 30000, 40000, 50000]);
  assert.deepEqual(guards('dragon_utopia'), [[8, 5, 2, 1], [8, 6, 3, 2], [8, 6, 4, 3], [8, 7, 6, 5]]);
  assert.deepEqual(u[0].guards.map((x) => x.creatureId), ['green_dragon', 'red_dragon', 'gold_dragon', 'black_dragon']);
  const arts = (l) => Object.fromEntries(l.reward.artifacts.map((a) => [a.class, a.count]));
  assert.deepEqual(arts(u[0]), { treasure: 1, minor: 1, major: 1, relic: 1 });
  assert.deepEqual(arts(u[1]), { minor: 1, major: 1, relic: 2 });
  assert.deepEqual(arts(u[2]), { major: 1, relic: 3 });
  assert.deepEqual(arts(u[3]), { relic: 4 });
  for (const l of u) assert.equal(l.reward.artifacts.reduce((s, a) => s + a.count, 0), 4);

  assert.deepEqual(guards('cyclops_stockpile'), [[20], [30], [40], [50]]);
  assert.deepEqual(lv('cyclops_stockpile')[0].reward.resources, { wood: 4, ore: 4, mercury: 4, sulfur: 4, crystal: 4, gems: 4 });
  assert.equal(lv('cyclops_stockpile')[3].reward.resources.gems, 10);
  assert.deepEqual(lv('dwarven_treasury').map((l) => [l.guards[0].count, l.reward.resources.gold, l.reward.resources.crystal]),
    [[50, 2500, 2], [75, 4000, 3], [100, 5000, 5], [150, 7500, 10]]);
  assert.deepEqual(lv('griffin_conservatory').map((l) => [l.guards[0].count, l.reward.creatures[0].count]), [[50, 1], [100, 2], [150, 3], [200, 4]]);
  assert.equal(lv('griffin_conservatory')[0].reward.creatures[0].creatureId, 'angel');
  assert.deepEqual(lv('imp_cache').map((l) => [l.guards[0].count, l.reward.resources.gold, l.reward.resources.mercury]),
    [[100, 1000, 2], [150, 1500, 3], [200, 2000, 4], [300, 3000, 6]]);
  assert.deepEqual(lv('medusa_stores').map((l) => [l.guards[0].count, l.reward.resources.gold, l.reward.resources.sulfur]),
    [[20, 2000, 5], [30, 3000, 6], [40, 4000, 8], [50, 5000, 10]]);
  assert.deepEqual(lv('naga_bank').map((l) => [l.guards[0].count, l.reward.resources.gold, l.reward.resources.gems]),
    [[10, 4000, 8], [15, 6000, 12], [20, 8000, 16], [30, 12000, 24]]);
  assert.deepEqual(lv('dragon_fly_hive').map((l) => [l.guards[0].count, l.reward.creatures[0].count]), [[30, 4], [45, 6], [60, 8], [90, 12]]);
  assert.deepEqual(lv('crypt').map((l) => l.reward.resources.gold), [1500, 2000, 2500, 5000]);
  assert.deepEqual(guards('crypt'), [[30, 20], [25, 20, 5], [20, 20, 10, 5], [20, 20, 10, 10]]);
  assert.deepEqual(lv('shipwreck').map((l) => [l.guards[0].count, l.reward.resources.gold]), [[10, 2000], [15, 3000], [25, 4000], [50, 5000]]);
  assert.deepEqual(lv('derelict_ship').map((l) => [l.guards[0].count, l.reward.resources.gold]), [[20, 3000], [30, 3000], [40, 4000], [60, 6000]]);
  assert.deepEqual(lv('pyramid')[0].guards.map((x) => [x.creatureId, x.count]), [['gold_golem', 40], ['diamond_golem', 20]]);
  assert.equal(lv('pyramid')[0].reward.spell.level, 5);
  assert.equal(getMapObject('crypt').effect.emptyPenalty[0].bonus.value, -1);
});

test('boosters, buffs and services have the original numbers', () => {
  const opt = (id) => getMapObject(id).effect.options.map((o) => [o.stat, o.value]);
  assert.deepEqual(opt('mercenary_camp'), [['attack', 1]]);
  assert.deepEqual(opt('marletto_tower'), [['defense', 1]]);
  assert.deepEqual(opt('star_axis'), [['power', 1]]);
  assert.deepEqual(opt('garden_of_revelation'), [['knowledge', 1]]);
  assert.deepEqual(opt('arena'), [['attack', 2], ['defense', 2]]);
  assert.deepEqual(getMapObject('school_of_magic').effect.cost, { gold: 1000 });
  assert.deepEqual(opt('school_of_war'), [['attack', 1], ['defense', 1]]);
  for (const o of getObjectsByEffect('primary_boost')) {
    for (const s of o.effect.options) assert.ok(PRIMARY_SKILLS.includes(s.stat), o.id);
    assert.equal(o.revisit, 'per_hero', o.id);
  }
  assert.equal(getMapObject('learning_stone').effect.exp, 1000);
  assert.equal(getMapObject('library_of_enlightenment').effect.value, 2);
  assert.equal(getMapObject('library_of_enlightenment').effect.minLevel, 10);
  assert.deepEqual(getMapObject('tree_of_knowledge').effect.costTable.map((r) => r.cost), [{}, { gold: 2000 }, { gems: 10 }]);
  assert.deepEqual(['incantation', 'gesture', 'thought'].map((n) => getMapObject(`shrine_of_magic_${n}`).effect.level), [1, 2, 3]);
  assert.deepEqual(getMapObject('university').effect.cost, { gold: 2000 });
  assert.equal(getMapObject('university').effect.skills, 4);
  assert.ok(getMapObject('witch_hut').effect.exclude.includes('necromancy'));

  const temple = getMapObject('temple').effect.variants;
  assert.deepEqual(temple.find((v) => v.days.includes(7)).bonuses, [{ type: 'morale', value: 2 }]);
  assert.deepEqual(temple.find((v) => v.days.includes(1)).bonuses, [{ type: 'morale', value: 1 }]);
  const idol = getMapObject('idol_of_fortune').effect.variants;
  assert.deepEqual(idol.flatMap((v) => v.days).sort(), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(idol.find((v) => v.days.includes(7)).bonuses.length, 2);
  const stables = getMapObject('stables');
  assert.equal(stables.effect.until, 'end_of_week');
  assert.deepEqual(stables.effect.bonuses, [{ type: 'movement_land', value: 400 }]);
  assert.deepEqual(stables.effect.upgrade[0], { from: 'cavalier', to: 'champion', free: true });
  assert.equal(getMapObject('oasis').effect.movement, 800);
  assert.equal(getMapObject('rally_flag').effect.movement, 400);
  assert.equal(getMapObject('swan_pond').effect.endMovement, true);
  assert.deepEqual(getMapObject('fountain_of_fortune').effect.random, { bonus: 'luck', min: -1, max: 3 });
  for (const o of getObjectsByEffect('temp_bonus')) {
    assert.ok(['next_battle', 'end_of_day', 'end_of_week'].includes(o.effect.until), o.id);
    assert.ok(Array.isArray(o.effect.bonuses), o.id);
    for (const v of o.effect.variants || []) for (const d of v.days) assert.ok(d >= 1 && d <= 7, o.id);
    if (o.effect.until === 'next_battle') assert.equal(o.revisit, 'per_battle', o.id);
  }
  assert.equal(getMapObject('magic_well').effect.mode, 'full');
  assert.equal(getMapObject('magic_spring').effect.mode, 'double');
  assert.equal(getMapObject('trading_post').effect.marketCount, 5);
  assert.deepEqual(getMapObject('shipyard').effect.cost, { gold: 1000, wood: 10 });
  assert.deepEqual(getMapObject('hill_fort').effect.costPercentByTier, { 1: 0, 2: 25, 3: 50, 4: 75, 5: 100, 6: 100, 7: 100 });
  assert.deepEqual(getMapObject('lighthouse').effect.bonuses, [{ type: 'movement_sea', value: 500 }]);
  assert.equal(getMapObject('redwood_observatory').effect.radius, 20);
  assert.equal(getMapObject('cover_of_darkness').effect.radius, 20);
  assert.equal(getMapObject('obelisk').effect.puzzlePieces, 48);
  assert.deepEqual(getMapObject('war_machine_factory').effect.items.map((i) => i.cost.gold), [2500, 1000, 750]);
  assert.equal(getObjectsByEffect('reveal_map').filter((o) => o.effect.mode === 'kind').length, 3);
});

test('guards, keys, monoliths and transport', () => {
  assert.equal(KEY_COLORS.length, 8);
  for (const c of KEY_COLORS) {
    assert.equal(getMapObject(`border_guard_${c}`).effect.color, c);
    assert.equal(getMapObject(`border_guard_${c}`).effect.permanent, false);
    assert.equal(getMapObject(`border_gate_${c}`).effect.permanent, true);
    assert.equal(getMapObject(`keymasters_tent_${c}`).effect.color, c);
    assert.equal(getMapObject(`keymasters_tent_${c}`).revisit, 'per_player');
  }
  for (const c of MONOLITH_COLORS) {
    const ent = getMapObject(`monolith_one_way_entrance_${c}`);
    const exit = getMapObject(ent.effect.exit);
    assert.equal(exit.effect.kind, 'one_way_exit');
    assert.equal(exit.effect.channel, c);
    assert.equal(exit.visitable, false);
  }
  for (const c of TWO_WAY_COLORS) {
    const m = getMapObject(`monolith_two_way_${c}`);
    assert.equal(m.effect.exit, m.id);
    assert.equal(m.effect.twoWay, true);
  }
  for (const o of getObjectsByEffect('teleport')) assert.equal(o.category, 'transport', o.id);
  const wp = getMapObject('whirlpool').effect.loss;
  assert.equal(wp.percent, 50);
  assert.equal(wp.stack, 'weakest');
  const boat = getMapObject('boat').effect;
  assert.ok(boat.boardingEndsMovement && boat.landingEndsMovement);
  assert.equal(getMapObject('subterranean_gate').effect.kind, 'subterranean_gate');
  assert.equal(getMapObject('anti_magic_garrison').effect.antiMagic, true);
  assert.equal(getMapObject('garrison').effect.antiMagic, false);
  assert.equal(getMapObject('quest_guard').effect.type, 'quest_guard');
  assert.equal(QUEST_TYPES.length, 9);
  assert.equal(QUEST_REWARD_TYPES.length, 10);
  assert.deepEqual(getMapObject('seers_hut').effect.questTypes, QUEST_TYPES);
  for (const p of SEER_PRESETS) {
    assert.ok(QUEST_TYPES.includes(p.quest.type), p.quest.type);
    assert.ok(p.value > 0);
    checkReward(p.reward, 'seer preset');
  }
  const pids = PANDORA_PRESETS.map((p) => p.id);
  assert.equal(new Set(pids).size, pids.length);
  assert.deepEqual(getMapObject('pandoras_box').effect.presets, pids);
  for (const p of PANDORA_PRESETS) {
    assert.ok(p.value > 0 && p.frequency > 0, p.id);
    checkReward(p.reward, p.id);
  }
});

test('wandering monster rules', () => {
  assert.deepEqual(MONSTER_SIZE_LABELS.map((l) => [l.id, l.min, l.max]), [
    ['few', 1, 4], ['several', 5, 9], ['pack', 10, 19], ['lots', 20, 49], ['horde', 50, 99],
    ['throng', 100, 249], ['swarm', 250, 499], ['zounds', 500, 999], ['legion', 1000, null],
  ]);
  for (let i = 1; i < MONSTER_SIZE_LABELS.length; i++) {
    assert.equal(MONSTER_SIZE_LABELS[i].min, MONSTER_SIZE_LABELS[i - 1].max + 1);
  }
  assert.equal(monsterSizeLabel(1).id, 'few');
  assert.equal(monsterSizeLabel(19).id, 'pack');
  assert.equal(monsterSizeLabel(20).id, 'lots');
  assert.equal(monsterSizeLabel(999).id, 'zounds');
  assert.equal(monsterSizeLabel(123456).id, 'legion');
  assert.deepEqual(MONSTER_DISPOSITIONS.map((d) => [d.id, ...d.character]), [
    ['compliant', -4, -4], ['friendly', 1, 7], ['aggressive', 1, 10], ['hostile', 4, 10], ['savage', 10, 10],
  ]);
  const m = getMapObject('monster');
  assert.equal(m.effect.weeklyGrowthPercent, 10);
  assert.equal(m.effect.defaultDisposition, 'aggressive');
  assert.equal(m.interact, 'adjacent');
  assert.equal(m.category, 'guard');
  for (let tier = 1; tier <= 7; tier++) {
    assert.equal(getMapObject(`random_monster_${tier}`).effect.tier, tier);
    const [lo, hi] = m.effect.countByTier[tier];
    assert.ok(lo >= 1 && lo < hi);
  }
});

test('dwellings cover every faction creature tier', async () => {
  assert.equal(DWELLINGS.length, DWELLING_TABLE.length);
  for (const f of FACTIONS) {
    for (let tier = 1; tier <= 7; tier++) {
      assert.ok(getDwellingsForFaction(f, tier).length >= 1, `no dwelling for ${f} tier ${tier}`);
    }
  }
  assert.ok(getDwellingsForFaction('neutral').length >= 10);
  for (const d of DWELLINGS) {
    const e = d.effect;
    assert.equal(d.category, 'dwelling');
    assert.ok([...FACTIONS, 'neutral'].includes(e.faction), d.id);
    assert.ok(Number.isInteger(e.tier) && e.tier >= 0 && e.tier <= 8, d.id);
    assert.ok(e.creatures.length >= 1, d.id);
    for (const c of e.creatures) assert.match(c, ID);
    assert.equal(e.freeFirst, e.tier === 1, d.id);
    assert.ok(d.value > 0 && d.frequency > 0, d.id);
    if (FACTIONS.includes(e.faction)) assert.equal(d.terrains[0], d.nativeTerrain, d.id);
  }
  assert.deepEqual(getMapObject('golem_factory').effect.creatures, ['stone_golem', 'iron_golem', 'gold_golem', 'diamond_golem']);
  assert.equal(getMapObject('elemental_conflux').effect.creatures.length, 4);
  assert.equal(getMapObject('guardhouse').effect.creatures[0], 'pikeman');
  assert.equal(getMapObject('portal_of_glory').effect.creatures[0], 'angel');

  if (creaturesMod && creaturesMod.CREATURE_BY_ID) {
    const { CREATURES, CREATURE_BY_ID } = creaturesMod;
    for (const id of referencedCreatureIds()) assert.ok(CREATURE_BY_ID[id], `unknown creature id ${id}`);
    // every base (non-upgraded) town creature of tier 1-7 can be bought in some external dwelling
    const sold = new Set(DWELLINGS.flatMap((d) => d.effect.creatures));
    for (const c of CREATURES) {
      if (c.warMachine || c.upgraded || !FACTIONS.includes(c.faction) || c.tier < 1 || c.tier > 7) continue;
      assert.ok(sold.has(c.id), `no external dwelling sells ${c.id}`);
    }
    // single-creature faction dwellings agree with the creature's faction and tier
    for (const d of DWELLINGS) {
      if (d.effect.creatures.length !== 1 || d.effect.tier === 0) continue;
      const c = CREATURE_BY_ID[d.effect.creatures[0]];
      assert.equal(c.faction, d.effect.faction, `${d.id} faction`);
      assert.equal(c.tier, d.effect.tier, `${d.id} tier`);
    }
  }
});

test('cross references to artifacts and skills exist when those modules are present', () => {
  if (artifactsMod && artifactsMod.ARTIFACT_BY_ID) {
    const A = artifactsMod.ARTIFACT_BY_ID;
    const ids = ['grail', 'spell_scroll',
      ...getMapObject('whirlpool').effect.loss.protectedBy.artifactIds,
      ...getMapObject('boat').effect.noPenaltyWith.artifactIds,
      ...getMapObject('war_machine_factory').effect.items.map((i) => i.artifactId)];
    for (const id of ids) assert.ok(A[id], `unknown artifact id ${id}`);
  }
  if (skillsMod && skillsMod.SKILL_IDS) {
    const ids = [...getMapObject('witch_hut').effect.exclude, ...getMapObject('university').effect.exclude,
      getMapObject('pyramid').effect.levels[0].reward.spell.requires.skillId, 'diplomacy', 'pathfinding'];
    for (const id of ids) assert.ok(skillsMod.SKILL_IDS.includes(id), `unknown skill id ${id}`);
  }
});

test('scenery and generator helpers', () => {
  assert.ok(DECOR.length >= 60);
  for (const t of LAND_TERRAINS) {
    const decor = getDecorForTerrain(t);
    assert.ok(decor.length >= 8, `${t}: only ${decor.length} decor objects`);
    assert.ok(decor.some((d) => d.shape === 'mountain' || d.shape === 'rock'), `${t}: no rocks/mountains`);
    assert.ok(decor.some((d) => d.blocking && d.size[0] === 1 && d.size[1] === 1), `${t}: no 1x1 blocker`);
    assert.ok(getObjectsForTerrain(t).filter((o) => o.category !== 'decor').length > 80, `${t}: too few objects`);
    // every decor shape the terrain asks for is available
    for (const shape of getTerrain(t).decor) assert.ok(decor.some((d) => d.shape === shape), `${t}: no decor of shape ${shape}`);
  }
  assert.ok(getDecorForTerrain('water').length >= 5);
  assert.ok(getObjectsForTerrain('water').filter((o) => o.category !== 'decor').length >= 10);
  for (const s of ['tree', 'mountain', 'rock', 'lake', 'crater', 'mushroom', 'stump']) {
    assert.ok(DECOR.some((d) => d.shape === s), `decor shape ${s}`);
  }
  for (const d of DECOR) assert.equal(d.visitable, false, d.id);
});

test('new content is flagged extra and reuses the closed effect set', () => {
  const extraBanks = EXTRA_OBJECTS.filter((o) => o.effect.type === 'bank');
  const extraDwellings = EXTRA_OBJECTS.filter((o) => o.effect.type === 'dwelling');
  const extraOther = EXTRA_OBJECTS.filter((o) => !['bank', 'dwelling'].includes(o.effect.type));
  assert.equal(extraBanks.length, 6);
  assert.ok(extraOther.length >= 15, `only ${extraOther.length} extra visitables`);
  assert.ok(extraDwellings.length >= 5);
  for (const o of EXTRA_OBJECTS) {
    assert.ok(o.visitable, o.id);
    assert.ok(o.frequency > 0 && o.value > 0, o.id);
  }
});

// ---- adventure audit (docs/audit/adventure.md): remaining SoD values pinned -------------------

test('audit: sea pickups, caches and weekly objects keep the SoD tables', () => {
  const rows = (id) => getMapObject(id).effect.table.map((r) => [r.chance, r.reward]);
  assert.deepEqual(rows('flotsam'), [[25, {}], [25, { resources: { wood: 5 } }], [25, { resources: { wood: 5, gold: 200 } }], [25, { resources: { wood: 10, gold: 500 } }]]);
  assert.deepEqual(rows('sea_chest'), [[20, {}], [70, { resources: { gold: 1500 } }], [10, { resources: { gold: 1000 }, artifacts: [{ class: 'treasure', count: 1 }] }]]);
  assert.deepEqual(rows('shipwreck_survivor').map(([c, r]) => [c, r.artifacts[0].class]), [[55, 'treasure'], [20, 'minor'], [20, 'major'], [5, 'relic']]);
  assert.deepEqual(rows('warriors_tomb').map(([c, r]) => [c, r.artifacts[0].class]), [[30, 'treasure'], [50, 'minor'], [15, 'major'], [5, 'relic']]);
  assert.equal(getMapObject('warriors_tomb').effect.penaltyWhenEmpty, true);
  assert.deepEqual(rows('wagon').map(([c]) => c), [10, 20, 20, 50]);
  assert.deepEqual(rows('wagon')[3][1].randomResource.amount, [2, 5]);
  assert.deepEqual(rows('mystical_garden'), [[50, { resources: { gems: 5 } }], [50, { resources: { gold: 500 } }]]);
  assert.equal(getMapObject('mystical_garden').revisit, 'weekly');
  assert.equal(getMapObject('windmill').revisit, 'weekly');
  assert.equal(getMapObject('water_wheel').revisit, 'weekly');
});

test('audit: boosters, shrines, scholar, library and witch hut follow SoD', () => {
  assert.deepEqual(getMapObject('library_of_enlightenment').effect.diplomacyLevelReduction, [0, 2, 4, 6], 'level 10 / 8 / 6 / 4');
  assert.deepEqual(getMapObject('witch_hut').effect.exclude.slice().sort(), ['leadership', 'necromancy']);
  assert.equal(getMapObject('witch_hut').effect.level, 1);
  assert.deepEqual(getMapObject('school_of_war').effect.cost, { gold: 1000 });
  assert.deepEqual(getMapObject('tree_of_knowledge').effect.costTable.map((r) => r.chance), [34, 33, 33]);
  const scholar = getMapObject('scholar');
  assert.equal(scholar.revisit, 'removed');
  assert.deepEqual(scholar.effect.table.map((r) => r.kind), ['primary', 'skill', 'spell']);
  assert.deepEqual(scholar.effect.table[2].level, [1, 5]);
  for (const id of ['mercenary_camp', 'marletto_tower', 'star_axis', 'garden_of_revelation', 'arena', 'school_of_magic',
    'school_of_war', 'learning_stone', 'library_of_enlightenment', 'tree_of_knowledge', 'witch_hut',
    'shrine_of_magic_incantation', 'shrine_of_magic_gesture', 'shrine_of_magic_thought']) {
    assert.equal(getMapObject(id).revisit, 'per_hero', id);
  }
  const pyramid = getMapObject('pyramid').effect;
  assert.deepEqual(pyramid.levels[0].reward.spell.requires, { skillId: 'wisdom', level: 3 });
  assert.deepEqual(pyramid.emptyPenalty, [{ bonus: { type: 'luck', value: -2 }, until: 'next_battle' }]);
  for (const id of ['crypt', 'shipwreck', 'derelict_ship']) {
    assert.deepEqual(getMapObject(id).effect.emptyPenalty, [{ bonus: { type: 'morale', value: -1 }, until: 'next_battle' }], id);
  }
  const lvArts = (id) => getMapObject(id).effect.levels.map((l) => (l.reward.artifacts || []).map((a) => a.class).join('+'));
  assert.deepEqual(lvArts('crypt'), ['', '', 'treasure', 'treasure']);
  assert.deepEqual(lvArts('derelict_ship'), ['', 'treasure', 'treasure', 'minor']);
  assert.deepEqual(lvArts('shipwreck'), ['', '', 'treasure', 'minor']);
  assert.deepEqual(getMapObject('derelict_ship').effect.levels.map((l) => l.guards[0].creatureId), Array(4).fill('water_elemental'));
  assert.deepEqual(getMapObject('shipwreck').effect.levels.map((l) => l.guards[0].creatureId), Array(4).fill('wight'));
});

test('audit: temporary bonuses, mana objects and information objects follow SoD', () => {
  const bon = (id) => getMapObject(id).effect.bonuses;
  assert.deepEqual(bon('fountain_of_youth'), [{ type: 'morale', value: 1 }]);
  assert.equal(getMapObject('fountain_of_youth').effect.movement, 400);
  assert.deepEqual(bon('watering_hole'), [{ type: 'morale', value: 1 }]);
  assert.equal(getMapObject('watering_hole').effect.movement, 400);
  assert.deepEqual(bon('oasis'), [{ type: 'morale', value: 1 }]);
  assert.deepEqual(bon('rally_flag'), [{ type: 'morale', value: 1 }, { type: 'luck', value: 1 }]);
  assert.deepEqual(bon('faerie_ring'), [{ type: 'luck', value: 1 }]);
  assert.deepEqual(bon('mermaids'), [{ type: 'luck', value: 1 }]);
  assert.deepEqual(bon('buoy'), [{ type: 'morale', value: 1 }]);
  assert.deepEqual(bon('swan_pond'), [{ type: 'luck', value: 2 }]);
  // Idol of Fortune (VCMI CGBonusingObject: day % 2 ? LUCK : MORALE, day 7 both)
  const idol = getMapObject('idol_of_fortune').effect.variants;
  const idolOn = (d) => idol.find((v) => v.days.includes(d)).bonuses.map((b) => b.type).sort();
  assert.deepEqual([1, 3, 5].map(idolOn), [['luck'], ['luck'], ['luck']]);
  assert.deepEqual([2, 4, 6].map(idolOn), [['morale'], ['morale'], ['morale']]);
  assert.deepEqual(idolOn(7), ['luck', 'morale']);
  assert.equal(getMapObject('stables').revisit, 'per_hero_weekly');
  assert.equal(getMapObject('magic_well').revisit, 'per_hero_daily');
  assert.equal(getMapObject('magic_spring').revisit, 'weekly');
  for (const id of ['redwood_observatory', 'pillar_of_fire']) {
    assert.equal(getMapObject(id).effect.radius, 20, id);
    assert.equal(getMapObject(id).revisit, 'per_player', id);
  }
  for (const k of ['sea', 'land', 'underground']) assert.deepEqual(getMapObject(`cartographer_${k}`).effect.cost, { gold: 1000 }, k);
  assert.equal(getMapObject('cover_of_darkness').revisit, 'always');
  const wp = getMapObject('whirlpool').effect.loss;
  assert.equal(wp.min, 1);
  assert.ok(wp.protectedBy.artifactIds.includes('admirals_hat') && wp.protectedBy.artifactIds.includes('sea_captains_hat'));
  assert.deepEqual(getMapObject('boat').effect.noPenaltyWith.artifactIds, ['admirals_hat']);
});

test('audit: services, dwellings and monsters follow SoD', () => {
  const rc = getMapObject('refugee_camp').effect;
  assert.equal(rc.costMultiplier, 1);
  assert.equal(rc.stock, 'growth');
  assert.equal(getMapObject('black_market').effect.slots, 7);
  assert.equal(getMapObject('prison').revisit, 'removed');
  // tier-1 external dwellings give their creatures for free (VCMI CGDwelling: "first level - creatures are for free")
  for (const d of DWELLINGS) assert.equal(d.effect.freeFirst, d.effect.tier === 1, d.id);
  const m = getMapObject('monster').effect;
  assert.equal(m.growthCap, 4000);
  assert.equal(m.upgradedStackChance, 50);
  assert.equal(m.guardRadius, 1);
  assert.deepEqual([1, 2, 3, 4].map((t) => m.countByTier[t]), [[20, 50], [16, 30], [12, 25], [10, 20]]);
});
