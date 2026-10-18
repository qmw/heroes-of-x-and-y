import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTIFACT_SLOTS, SLOT_COUNTS, RESOURCES, PRIMARY_SKILLS, FACTIONS } from '../../src/core/constants.js';
import {
  ARTIFACTS, ARTIFACT_BY_ID, ARTIFACT_CLASSES, COMBO_ARTIFACTS, getArtifact, isArtifact,
  artifactsOfClass, artifactsOfSlot, isCombo, combosContaining, randomArtifactPool,
} from '../../src/data/artifacts.js';

const bonus = (id, type) => getArtifact(id).bonuses.filter((b) => b.type === type);
const primary = (id) => Object.fromEntries(bonus(id, 'primary').map((b) => [b.stat, b.value]));

test('ids are unique snake_case and the lookup matches the array', () => {
  const seen = new Set();
  for (const a of ARTIFACTS) {
    assert.match(a.id, /^[a-z][a-z0-9_]*$/, a.id);
    assert.ok(!seen.has(a.id), `duplicate ${a.id}`);
    seen.add(a.id);
    assert.equal(ARTIFACT_BY_ID[a.id], a);
  }
  assert.equal(new Set(ARTIFACTS.map((a) => a.name)).size, ARTIFACTS.length, 'names unique');
  assert.throws(() => getArtifact('no_such_thing'));
  assert.equal(isArtifact('centaurs_axe'), true);
  assert.equal(isArtifact('toString'), false);
});

test('every artifact has valid slot, class, cost, description and structured bonuses', () => {
  for (const a of ARTIFACTS) {
    assert.ok(ARTIFACT_SLOTS.includes(a.slot), `${a.id} slot`);
    assert.ok(ARTIFACT_CLASSES.includes(a.class), `${a.id} class`);
    assert.ok(Number.isInteger(a.cost) && a.cost >= 0, `${a.id} cost`);
    assert.ok(typeof a.name === 'string' && a.name.length > 0);
    assert.ok(typeof a.description === 'string' && a.description.length > 3, `${a.id} description`);
    assert.ok(Array.isArray(a.bonuses) && a.bonuses.length > 0, `${a.id} bonuses`);
    for (const b of a.bonuses) {
      assert.ok(typeof b.type === 'string' && b.type.length > 0, `${a.id} bonus type`);
      if (b.type === 'primary') {
        assert.ok(PRIMARY_SKILLS.includes(b.stat), `${a.id} stat`);
        assert.ok(Number.isInteger(b.value));
      }
      if (b.type === 'resource_income') assert.ok(RESOURCES.includes(b.resource) && b.value > 0, a.id);
      if (b.type === 'no_alignment_penalty') for (const f of b.factions) assert.ok(FACTIONS.includes(f) || f === 'neutral', f);
      if (b.side) assert.ok(['own', 'both'].includes(b.side), `${a.id} side`);
    }
    if (a.slotIndex != null) assert.ok(a.slotIndex < SLOT_COUNTS[a.slot]);
    assert.equal(a.extra === true, a.origin === 'extra');
    assert.doesNotThrow(() => JSON.stringify(a));
  }
});

test('catalogue size: full original set, HotA additions and >= 25 extras with 3 extra combos', () => {
  const by = (o) => ARTIFACTS.filter((a) => a.origin === o);
  assert.ok(by('sod').length >= 140, `sod ${by('sod').length}`);
  assert.ok(by('hota').length >= 20);
  assert.ok(by('extra').length >= 25);
  assert.equal(COMBO_ARTIFACTS.filter((c) => c.origin === 'sod').length, 12);
  assert.equal(COMBO_ARTIFACTS.filter((c) => c.extra).length, 3);
  for (const cls of ['treasure', 'minor', 'major', 'relic']) assert.ok(artifactsOfClass(cls).length >= 25, cls);
  for (const slot of ARTIFACT_SLOTS) assert.ok(artifactsOfSlot(slot).length >= 1, slot);
});

test('combination artifacts reference existing, non-combo components and fit the hero', () => {
  assert.equal(artifactsOfClass('combo').length, COMBO_ARTIFACTS.length);
  for (const c of COMBO_ARTIFACTS) {
    assert.ok(isCombo(c.id));
    assert.ok(c.components.length >= 2, c.id);
    assert.equal(new Set(c.components).size, c.components.length, `${c.id} duplicate component`);
    const need = {};
    let sum = 0;
    for (const id of c.components) {
      const part = getArtifact(id);
      assert.ok(!part.components, `${c.id} nests combo ${id}`);
      need[part.slot] = (need[part.slot] || 0) + 1;
      sum += part.cost;
      assert.ok(combosContaining(id).includes(c));
    }
    assert.ok(need[c.slot] >= 1, `${c.id}: a component must use the combo slot`);
    for (const [slot, n] of Object.entries(need)) assert.ok(n <= SLOT_COUNTS[slot], `${c.id} needs ${n} ${slot}`);
    assert.equal(c.cost, sum, `${c.id} cost = sum of components`);
    if (c.extra) for (const id of c.components) assert.ok(getArtifact(id).extra, `${c.id} uses original part`);
  }
  // no artifact is a component of two different sets
  const owners = {};
  for (const c of COMBO_ARTIFACTS) for (const id of c.components) {
    assert.ok(!owners[id], `${id} in ${owners[id]} and ${c.id}`);
    owners[id] = c.id;
  }
});

test('random pool excludes combos, specials and unique items', () => {
  const pool = randomArtifactPool();
  assert.ok(pool.length > 140);
  for (const a of pool) assert.ok(['treasure', 'minor', 'major', 'relic'].includes(a.class));
  for (const id of ['grail', 'spellbook', 'spell_scroll', 'ballista', 'angelic_alliance', 'armageddons_blade']) {
    assert.ok(!pool.some((a) => a.id === id), id);
  }
  assert.ok(randomArtifactPool('relic').every((a) => a.class === 'relic'));
});

test('spot checks: primary skill artifacts', () => {
  assert.deepEqual(primary('centaurs_axe'), { attack: 2 });
  assert.deepEqual(primary('titans_gladius'), { attack: 12, defense: -3 });
  assert.deepEqual(primary('sentinels_shield'), { defense: 12, attack: -3 });
  assert.deepEqual(primary('thunder_helmet'), { knowledge: 10, power: -2 });
  assert.deepEqual(primary('titans_cuirass'), { power: 10, knowledge: -2 });
  assert.deepEqual(primary('dragon_scale_armor'), { attack: 4, defense: 4 });
  assert.deepEqual(primary('dragon_scale_shield'), { attack: 3, defense: 3 });
  assert.deepEqual(primary('crown_of_dragontooth'), { power: 4, knowledge: 4 });
  const all = (v) => ({ attack: v, defense: v, power: v, knowledge: v });
  assert.deepEqual(primary('armor_of_wonder'), all(1));
  assert.deepEqual(primary('sandals_of_the_saint'), all(2));
  assert.deepEqual(primary('celestial_necklace_of_bliss'), all(3));
  assert.deepEqual(primary('lions_shield_of_courage'), all(4));
  assert.deepEqual(primary('sword_of_judgement'), all(5));
  assert.deepEqual(primary('helm_of_heavenly_enlightenment'), all(6));
  assert.equal(getArtifact('titans_gladius').slot, 'right_hand');
  assert.equal(getArtifact('titans_gladius').class, 'relic');
  assert.equal(getArtifact('centaurs_axe').cost, 2000);
  assert.equal(getArtifact('helm_of_heavenly_enlightenment').cost, 24000);
  assert.equal(getArtifact('sandals_of_the_saint').slot, 'feet');
});

test('spot checks: other bonuses', () => {
  assert.equal(bonus('boots_of_speed', 'movement_land')[0].value, 600);
  assert.equal(bonus('equestrians_gloves', 'movement_land')[0].value, 300);
  assert.equal(bonus('necklace_of_ocean_guidance', 'movement_sea')[0].value, 1000);
  assert.equal(bonus('sea_captains_hat', 'movement_sea')[0].value, 500);
  assert.deepEqual(bonus('sea_captains_hat', 'grants_spell').map((b) => b.spellId), ['summon_boat', 'scuttle_boat']);
  assert.equal(bonus('endless_sack_of_gold', 'resource_income')[0].value, 1000);
  assert.equal(bonus('endless_bag_of_gold', 'resource_income')[0].value, 750);
  assert.equal(bonus('endless_purse_of_gold', 'resource_income')[0].value, 500);
  assert.deepEqual(bonus('orb_of_silt', 'spell_power_percent')[0], { type: 'spell_power_percent', school: 'earth', percent: 50 });
  assert.deepEqual(bonus('orb_of_inhibition', 'block_spells')[0], { type: 'block_spells', minLevel: 1, maxLevel: 5, side: 'both' });
  assert.equal(bonus('recanters_cloak', 'block_spells')[0].minLevel, 3);
  assert.deepEqual([5, 10, 15], ['amulet_of_the_undertaker', 'vampires_cowl', 'dead_mans_boots']
    .map((id) => bonus(id, 'necromancy_percent')[0].percent));
  assert.deepEqual([5, 10, 15], ['bow_of_elven_cherrywood', 'bowstring_of_the_unicorns_mane', 'angel_feather_arrows']
    .map((id) => bonus(id, 'damage_percent')[0].percent));
  assert.deepEqual([5, 10, 15], ['garniture_of_interference', 'surcoat_of_counterpoise', 'boots_of_polarity']
    .map((id) => bonus(id, 'magic_resistance')[0].percent));
  assert.deepEqual([[2, 5], [3, 4], [4, 3], [5, 2], [6, 1]],
    ['legs_of_legion', 'loins_of_legion', 'torso_of_legion', 'arms_of_legion', 'head_of_legion']
      .map((id) => [bonus(id, 'creature_growth')[0].tier, bonus(id, 'creature_growth')[0].value]));
  assert.equal(bonus('pendant_of_courage', 'morale')[0].value, 3);
  assert.equal(bonus('sphere_of_permanence', 'spell_immunity')[0].spellId, 'dispel');
  assert.equal(bonus('tome_of_air_magic', 'grants_spells')[0].school, 'air');
  assert.equal(bonus('spellbinders_hat', 'grants_spells')[0].level, 5);
  assert.equal(getArtifact('angel_wings').bonuses[0].type, 'fly');
  assert.equal(getArtifact('boots_of_levitation').bonuses[0].type, 'water_walk');
});

test('spot checks: combination artifacts', () => {
  assert.equal(getArtifact('angelic_alliance').components.length, 6);
  assert.equal(getArtifact('angelic_alliance').slot, 'right_hand');
  assert.equal(getArtifact('angelic_alliance').cost, 84000);
  assert.equal(bonus('angelic_alliance', 'combat_start_cast')[0].spellId, 'prayer');
  assert.deepEqual(bonus('armor_of_the_damned', 'combat_start_cast').map((b) => b.spellId),
    ['slow', 'curse', 'weakness', 'misfortune']);
  assert.ok(bonus('armor_of_the_damned', 'combat_start_cast').every((b) => b.mastery === 3 && b.power === 50 && b.target === 'all_enemies'));
  assert.deepEqual(bonus('cloak_of_the_undead_king', 'necromancy_raise')[0].creatures,
    ['skeleton', 'walking_dead', 'wight', 'lich']);
  assert.equal(getArtifact('power_of_the_dragon_father').components.length, 9);
  assert.equal(bonus('power_of_the_dragon_father', 'spell_immunity')[0].maxLevel, 4);
  assert.equal(bonus('statue_of_legion', 'creature_growth')[0].percent, 50);
  assert.equal(bonus('titans_thunder', 'grants_spell')[0].spellId, 'titans_lightning_bolt');
  assert.equal(bonus('elixir_of_life', 'creature_stat')[0].percent, 25);
  assert.equal(bonus('ring_of_the_magi', 'spell_duration')[0].value, 50);
  assert.deepEqual(getArtifact('admirals_hat').components.slice().sort(), ['necklace_of_ocean_guidance', 'sea_captains_hat']);
  assert.equal(getArtifact('cornucopia').components.length, 4);
  assert.ok(getArtifact('bow_of_the_sharpshooter').bonuses.some((b) => b.type === 'free_shooting'));
});

test('war machines have distinct fixed slots (cannon shares the ballista slot)', () => {
  const idx = (id) => getArtifact(id).slotIndex;
  assert.equal(new Set(['ballista', 'ammo_cart', 'first_aid_tent', 'catapult'].map(idx)).size, 4);
  assert.equal(idx('cannon'), idx('ballista'));
  for (const a of artifactsOfSlot('war_machine')) assert.equal(a.bonuses[0].type, 'war_machine');
});
