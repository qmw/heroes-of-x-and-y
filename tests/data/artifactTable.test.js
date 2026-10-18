// Pins slot / class / gold value of every original (SoD) and HotA artifact to the original
// ARTRAITS values (audit: docs/audit/heroes-artifacts.md). Combination artifacts' value is the sum
// of their components, as in the original.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTIFACTS, getArtifact } from '../../src/data/artifacts.js';
import { getArtifactBonuses, createEmptyArtifacts, giveArtifact, assemble } from '../../src/engine/artifacts.js';

const TABLE = {
  spellbook: ['spellbook', 'special', 500],
  spell_scroll: ['misc', 'special', 2000],
  grail: ['misc', 'special', 0],
  catapult: ['war_machine', 'special', 0],
  ballista: ['war_machine', 'special', 2500],
  ammo_cart: ['war_machine', 'special', 1000],
  first_aid_tent: ['war_machine', 'special', 750],
  cannon: ['war_machine', 'special', 4000],
  centaurs_axe: ['right_hand', 'treasure', 2000],
  blackshard_of_the_dead_knight: ['right_hand', 'minor', 3000],
  greater_gnolls_flail: ['right_hand', 'minor', 4000],
  ogres_club_of_havoc: ['right_hand', 'major', 5000],
  sword_of_hellfire: ['right_hand', 'major', 6000],
  titans_gladius: ['right_hand', 'relic', 10000],
  shield_of_the_dwarven_lords: ['left_hand', 'treasure', 2000],
  shield_of_the_yawning_dead: ['left_hand', 'minor', 3000],
  buckler_of_the_gnoll_king: ['left_hand', 'minor', 4000],
  targ_of_the_rampaging_ogre: ['left_hand', 'major', 5000],
  shield_of_the_damned: ['left_hand', 'major', 6000],
  sentinels_shield: ['left_hand', 'relic', 10000],
  helm_of_the_alabaster_unicorn: ['head', 'treasure', 1000],
  skull_helmet: ['head', 'treasure', 3000],
  helm_of_chaos: ['head', 'minor', 4000],
  crown_of_the_supreme_magi: ['head', 'minor', 5000],
  hellstorm_helmet: ['head', 'major', 6000],
  thunder_helmet: ['head', 'relic', 10000],
  breastplate_of_petrified_wood: ['torso', 'treasure', 1000],
  rib_cage: ['torso', 'minor', 3000],
  scales_of_the_greater_basilisk: ['torso', 'minor', 4000],
  tunic_of_the_cyclops_king: ['torso', 'major', 5000],
  breastplate_of_brimstone: ['torso', 'major', 6000],
  titans_cuirass: ['torso', 'relic', 10000],
  armor_of_wonder: ['torso', 'minor', 4000],
  sandals_of_the_saint: ['feet', 'relic', 8000],
  celestial_necklace_of_bliss: ['neck', 'relic', 12000],
  lions_shield_of_courage: ['left_hand', 'relic', 16000],
  sword_of_judgement: ['right_hand', 'relic', 20000],
  helm_of_heavenly_enlightenment: ['head', 'relic', 24000],
  quiet_eye_of_the_dragon: ['ring', 'treasure', 2000],
  red_dragon_flame_tongue: ['right_hand', 'minor', 4000],
  dragon_scale_shield: ['left_hand', 'major', 6000],
  dragon_scale_armor: ['torso', 'relic', 8000],
  dragonbone_greaves: ['feet', 'treasure', 2000],
  dragon_wing_tabard: ['shoulders', 'minor', 4000],
  necklace_of_dragonteeth: ['neck', 'major', 6000],
  crown_of_dragontooth: ['head', 'relic', 8000],
  still_eye_of_the_dragon: ['ring', 'treasure', 2000],
  clover_of_fortune: ['misc', 'treasure', 1000],
  cards_of_prophecy: ['misc', 'treasure', 1000],
  ladybird_of_luck: ['misc', 'treasure', 1000],
  badge_of_courage: ['misc', 'treasure', 1000],
  crest_of_valor: ['misc', 'treasure', 1000],
  glyph_of_gallantry: ['misc', 'treasure', 1000],
  pendant_of_courage: ['neck', 'major', 7000],
  spirit_of_oppression: ['misc', 'treasure', 2000],
  hourglass_of_the_evil_hour: ['misc', 'treasure', 2000],
  speculum: ['misc', 'treasure', 1000],
  spyglass: ['misc', 'treasure', 1000],
  amulet_of_the_undertaker: ['neck', 'treasure', 2000],
  vampires_cowl: ['shoulders', 'minor', 4000],
  dead_mans_boots: ['feet', 'major', 6000],
  garniture_of_interference: ['neck', 'major', 2000],
  surcoat_of_counterpoise: ['shoulders', 'major', 4000],
  boots_of_polarity: ['feet', 'relic', 6000],
  bow_of_elven_cherrywood: ['misc', 'treasure', 2000],
  bowstring_of_the_unicorns_mane: ['misc', 'minor', 4000],
  angel_feather_arrows: ['misc', 'major', 6000],
  golden_bow: ['misc', 'major', 8000],
  bird_of_perception: ['misc', 'treasure', 1000],
  stoic_watchman: ['misc', 'treasure', 2000],
  emblem_of_cognizance: ['misc', 'minor', 3000],
  statesmans_medal: ['neck', 'major', 5000],
  diplomats_ring: ['ring', 'major', 5000],
  ambassadors_sash: ['shoulders', 'major', 5000],
  ring_of_the_wayfarer: ['ring', 'major', 5000],
  necklace_of_swiftness: ['neck', 'treasure', 5000],
  cape_of_velocity: ['shoulders', 'major', 10000],
  ring_of_vitality: ['ring', 'treasure', 5000],
  ring_of_life: ['ring', 'minor', 5000],
  vial_of_lifeblood: ['misc', 'major', 10000],
  vial_of_dragon_blood: ['misc', 'relic', 20000],
  equestrians_gloves: ['ring', 'minor', 3000],
  boots_of_speed: ['feet', 'minor', 6000],
  necklace_of_ocean_guidance: ['neck', 'major', 10000],
  sea_captains_hat: ['head', 'relic', 15000],
  angel_wings: ['shoulders', 'relic', 20000],
  boots_of_levitation: ['feet', 'relic', 10000],
  charm_of_mana: ['misc', 'treasure', 500],
  talisman_of_mana: ['misc', 'treasure', 1000],
  mystic_orb_of_mana: ['misc', 'treasure', 1500],
  collar_of_conjuring: ['neck', 'treasure', 500],
  ring_of_conjuring: ['ring', 'treasure', 1000],
  cape_of_conjuring: ['shoulders', 'treasure', 1500],
  orb_of_the_firmament: ['misc', 'major', 6000],
  orb_of_silt: ['misc', 'major', 6000],
  orb_of_tempestuous_fire: ['misc', 'major', 6000],
  orb_of_driving_rain: ['misc', 'major', 6000],
  orb_of_inhibition: ['misc', 'relic', 20000],
  orb_of_vulnerability: ['misc', 'relic', 25000],
  recanters_cloak: ['shoulders', 'major', 8000],
  sphere_of_permanence: ['misc', 'major', 7500],
  pendant_of_dispassion: ['neck', 'treasure', 1000],
  pendant_of_second_sight: ['neck', 'major', 5000],
  pendant_of_holiness: ['neck', 'treasure', 1000],
  pendant_of_life: ['neck', 'treasure', 2500],
  pendant_of_death: ['neck', 'treasure', 2500],
  pendant_of_free_will: ['neck', 'treasure', 1000],
  pendant_of_negativity: ['neck', 'major', 5000],
  pendant_of_total_recall: ['neck', 'treasure', 3000],
  tome_of_fire_magic: ['misc', 'relic', 20000],
  tome_of_air_magic: ['misc', 'relic', 20000],
  tome_of_water_magic: ['misc', 'relic', 20000],
  tome_of_earth_magic: ['misc', 'relic', 20000],
  spellbinders_hat: ['head', 'relic', 30000],
  armageddons_blade: ['right_hand', 'relic', 50000],
  shackles_of_war: ['misc', 'major', 5000],
  legs_of_legion: ['misc', 'treasure', 5000],
  loins_of_legion: ['misc', 'minor', 5000],
  torso_of_legion: ['misc', 'minor', 5000],
  arms_of_legion: ['misc', 'major', 5000],
  head_of_legion: ['misc', 'major', 5000],
  endless_sack_of_gold: ['misc', 'relic', 10000],
  endless_bag_of_gold: ['misc', 'major', 7500],
  endless_purse_of_gold: ['misc', 'major', 5000],
  inexhaustible_cart_of_ore: ['misc', 'minor', 5000],
  inexhaustible_cart_of_lumber: ['misc', 'minor', 5000],
  everflowing_crystal_cloak: ['shoulders', 'major', 5000],
  ring_of_infinite_gems: ['ring', 'major', 5000],
  everpouring_vial_of_mercury: ['misc', 'major', 5000],
  eversmoking_ring_of_sulfur: ['ring', 'major', 5000],
  trident_of_dominion: ['right_hand', 'major', 7000],
  shield_of_naval_glory: ['left_hand', 'major', 7000],
  royal_armor_of_nix: ['torso', 'major', 7000],
  crown_of_the_five_seas: ['head', 'major', 7000],
  wayfarers_boots: ['feet', 'major', 5000],
  charm_of_eclipse: ['misc', 'minor', 5000],
  seal_of_sunset: ['ring', 'minor', 5000],
  plate_of_dying_light: ['torso', 'relic', 10000],
  sleepkeeper: ['misc', 'relic', 50000],
  hideous_mask: ['misc', 'minor', 4000],
  pendant_of_downfall: ['neck', 'major', 7000],
  ring_of_suppression: ['ring', 'minor', 4000],
  runes_of_imminency: ['misc', 'treasure', 2000],
  demons_horseshoe: ['misc', 'treasure', 2000],
  shamans_puppet: ['misc', 'minor', 4000],
  cape_of_silence: ['shoulders', 'major', 7500],
  ring_of_oblivion: ['ring', 'major', 7500],
  horn_of_the_abyss: ['misc', 'relic', 50000],
  angelic_alliance: ['right_hand', 'combo', 84000],
  cloak_of_the_undead_king: ['shoulders', 'combo', 12000],
  elixir_of_life: ['misc', 'combo', 20000],
  armor_of_the_damned: ['torso', 'combo', 12000],
  statue_of_legion: ['misc', 'combo', 25000],
  power_of_the_dragon_father: ['torso', 'combo', 42000],
  titans_thunder: ['right_hand', 'combo', 40000],
  admirals_hat: ['head', 'combo', 25000],
  bow_of_the_sharpshooter: ['misc', 'combo', 12000],
  wizards_well: ['misc', 'combo', 3000],
  ring_of_the_magi: ['ring', 'combo', 3000],
  cornucopia: ['misc', 'combo', 20000],
  ironfist_of_the_ogre: ['right_hand', 'combo', 20000],
  golden_goose: ['misc', 'combo', 22500],
  diplomats_cloak: ['shoulders', 'combo', 15000],
  pendant_of_reflection: ['neck', 'combo', 12000],
};

test('artifact table: slot, class and value of every SoD / HotA artifact', () => {
  const originals = ARTIFACTS.filter((a) => a.origin !== 'extra');
  assert.equal(originals.length, Object.keys(TABLE).length);
  for (const [id, [slot, cls, cost]] of Object.entries(TABLE)) {
    const a = getArtifact(id);
    assert.deepEqual([a.slot, a.class, a.cost], [slot, cls, cost], id);
  }
});

/** Primary totals and selected effects of an assembled combo (components + set bonus). */
function assembled(comboId) {
  const h = { id: 'h', artifacts: createEmptyArtifacts() };
  for (const c of getArtifact(comboId).components) assert.ok(giveArtifact(h, c).ok, c);
  assert.ok(assemble(h, comboId).ok, comboId);
  const bonuses = getArtifactBonuses(h);
  const prim = { attack: 0, defense: 0, power: 0, knowledge: 0 };
  for (const b of bonuses) if (b.type === 'primary') prim[b.stat] += b.value;
  const sum = (type, field = 'value') => bonuses.filter((b) => b.type === type).reduce((n, b) => n + (b[field] || 0), 0);
  return { prim, sum, bonuses };
}

test('combination artifacts: totals of the original sets', () => {
  const all = (v) => ({ attack: v, defense: v, power: v, knowledge: v });
  assert.deepEqual(assembled('angelic_alliance').prim, all(21));
  assert.deepEqual(assembled('power_of_the_dragon_father').prim, all(16));
  assert.equal(assembled('power_of_the_dragon_father').sum('morale'), 1);
  assert.equal(assembled('power_of_the_dragon_father').sum('luck'), 1);
  assert.deepEqual(assembled('titans_thunder').prim, { attack: 9, defense: 9, power: 8, knowledge: 8 });
  assert.deepEqual(assembled('armor_of_the_damned').prim, { attack: 3, defense: 3, power: 2, knowledge: 2 });
  assert.deepEqual(assembled('ironfist_of_the_ogre').prim, { attack: 5, defense: 5, power: 4, knowledge: 4 });
  assert.equal(assembled('cloak_of_the_undead_king').sum('necromancy_percent', 'percent'), 30);
  assert.equal(assembled('elixir_of_life').sum('creature_stat'), 4); // +4 hp flat (+25 % on top)
  assert.equal(assembled('ring_of_the_magi').sum('spell_duration'), 56);
  assert.equal(assembled('admirals_hat').sum('movement_sea'), 1500);
  assert.equal(assembled('bow_of_the_sharpshooter').sum('damage_percent', 'percent'), 30);
  assert.equal(assembled('golden_goose').sum('resource_income'), 7000);
  assert.equal(assembled('pendant_of_reflection').sum('magic_resistance', 'percent'), 50);
  assert.equal(assembled('diplomats_cloak').sum('surrender_cost_percent', 'percent'), -30);
  const corn = assembled('cornucopia').bonuses.filter((b) => b.type === 'resource_income');
  for (const r of ['mercury', 'sulfur', 'crystal', 'gems']) {
    assert.equal(corn.filter((b) => b.resource === r).reduce((n, b) => n + b.value, 0), 5, r);
  }
  assert.deepEqual(assembled('cloak_of_the_undead_king').bonuses.find((b) => b.type === 'necromancy_raise').creatures,
    ['skeleton', 'walking_dead', 'wight', 'lich']);
});

test("Armageddon's Blade and Sleepkeeper", () => {
  const h = { id: 'h', artifacts: createEmptyArtifacts() };
  giveArtifact(h, 'armageddons_blade');
  const prim = {};
  for (const b of getArtifactBonuses(h)) if (b.type === 'primary') prim[b.stat] = b.value;
  assert.deepEqual(prim, { attack: 3, defense: 3, power: 3, knowledge: 6 });
  const sk = getArtifact('sleepkeeper');
  assert.equal(sk.noRandom, true); // banned by default in HotA
  assert.deepEqual(sk.bonuses.map((b) => b.spellId).sort(), ['berserk', 'blind', 'fear', 'forgetfulness', 'hypnotize', 'sorrow']);
});

test('Vial of Dragon Blood helps the ten true dragons only (not wyverns)', () => {
  const ids = getArtifact('vial_of_dragon_blood').bonuses[0].filter.creatureIds;
  assert.equal(ids.length, 10);
  for (const id of ['green_dragon', 'gold_dragon', 'bone_dragon', 'ghost_dragon', 'azure_dragon']) assert.ok(ids.includes(id), id);
  for (const id of ['wyvern', 'wyvern_monarch', 'dragon_fly']) assert.ok(!ids.includes(id), id);
});
