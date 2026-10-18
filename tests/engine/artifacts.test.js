import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTIFACT_SLOTS, SLOT_COUNTS } from '../../src/core/constants.js';
import { createRng } from '../../src/core/rng.js';
import { getArtifact } from '../../src/data/artifacts.js';
import {
  BACKPACK_CAP, createEmptyArtifacts, ensureArtifacts, canEquip, findEquipSlot, equip, unequip,
  moveToBackpack, giveArtifact, removeArtifact, hasArtifact, ownsArtifact, getEquippedArtifacts,
  getArtifactBonuses, getWarMachines, canAssemble, checkAssemble, getAssemblableCombos, assemble,
  disassemble, transferArtifact, captureArtifacts, artifactSellPrice, artifactValue,
  pickRandomArtifact, isSlotLocked, slotLockedBy, makeScroll, findArtifact, moveArtifact,
} from '../../src/engine/artifacts.js';

const hero = (id = 'h1') => ({ id, artifacts: createEmptyArtifacts() });
const give = (h, ...ids) => ids.forEach((id) => assert.equal(giveArtifact(h, id).ok, true, `give ${id}`));
const sumPrimary = (h) => {
  const out = { attack: 0, defense: 0, power: 0, knowledge: 0 };
  for (const b of getArtifactBonuses(h)) if (b.type === 'primary') out[b.stat] += b.value;
  return out;
};
const AA = ['sword_of_judgement', 'armor_of_wonder', 'sandals_of_the_saint', 'celestial_necklace_of_bliss',
  'lions_shield_of_courage', 'helm_of_heavenly_enlightenment'];

test('createEmptyArtifacts follows SLOT_COUNTS and is plain JSON', () => {
  const a = createEmptyArtifacts();
  for (const slot of ARTIFACT_SLOTS) {
    assert.equal(a.equipped[slot].length, SLOT_COUNTS[slot]);
    assert.ok(a.equipped[slot].every((e) => e === null));
  }
  assert.deepEqual(a.backpack, []);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
});

test('engine tolerates heroes with a partial / missing artifacts object', () => {
  const h = { id: 'x' };
  assert.equal(hasArtifact(h, 'centaurs_axe'), false);
  assert.deepEqual(getArtifactBonuses(h), []);
  assert.equal(canEquip(h, 'centaurs_axe'), true);
  give(h, 'centaurs_axe');
  assert.equal(h.artifacts.equipped.right_hand[0], 'centaurs_axe');
  const h2 = { id: 'y', artifacts: { equipped: { head: ['skull_helmet'] }, backpack: [] } };
  ensureArtifacts(h2);
  assert.equal(h2.artifacts.equipped.misc.length, 5);
  assert.equal(hasArtifact(h2, 'skull_helmet'), true);
});

test('giveArtifact auto-equips into a free slot, then falls back to the backpack', () => {
  const h = hero();
  const r = giveArtifact(h, 'centaurs_axe');
  assert.equal(r.ok, true);
  assert.deepEqual(r.events[0], { type: 'artifact_gained', heroId: 'h1', artifact: 'centaurs_axe', where: 'equipped', slot: 'right_hand', index: 0 });
  const r2 = giveArtifact(h, 'sword_of_hellfire');
  assert.equal(r2.events[0].where, 'backpack');
  assert.deepEqual(h.artifacts.backpack, ['sword_of_hellfire']);
  assert.equal(hasArtifact(h, 'centaurs_axe'), true);
  assert.equal(hasArtifact(h, 'sword_of_hellfire'), false, 'backpack does not count');
  assert.equal(ownsArtifact(h, 'sword_of_hellfire'), true);
  assert.equal(giveArtifact(h, 'skull_helmet', { toBackpack: true }).events[0].where, 'backpack');
  assert.throws(() => giveArtifact(h, 'bogus'));
});

test('two rings and five misc slots', () => {
  const h = hero();
  give(h, 'ring_of_vitality', 'ring_of_life', 'diplomats_ring');
  assert.deepEqual(h.artifacts.equipped.ring, ['ring_of_vitality', 'ring_of_life']);
  assert.deepEqual(h.artifacts.backpack, ['diplomats_ring']);
  give(h, 'clover_of_fortune', 'cards_of_prophecy', 'ladybird_of_luck', 'speculum', 'spyglass', 'badge_of_courage');
  assert.deepEqual(h.artifacts.equipped.misc, ['clover_of_fortune', 'cards_of_prophecy', 'ladybird_of_luck', 'speculum', 'spyglass']);
  assert.deepEqual(h.artifacts.backpack, ['diplomats_ring', 'badge_of_courage']);
  assert.equal(canEquip(h, 'crest_of_valor'), false);
  assert.equal(findEquipSlot(h, 'crest_of_valor').error, 'no_free_slot');
  assert.equal(getArtifactBonuses(h).filter((b) => b.type === 'luck').reduce((s, b) => s + b.value, 0), 3);
});

test('slot rules: wrong slot, bad index, explicit index', () => {
  const h = hero();
  assert.equal(findEquipSlot(h, 'centaurs_axe', 'head').error, 'wrong_slot');
  assert.equal(findEquipSlot(h, 'centaurs_axe', 'right_hand', 1).error, 'bad_index');
  assert.equal(findEquipSlot(h, 'ring_of_life', 'ring', 2).error, 'bad_index');
  assert.deepEqual(findEquipSlot(h, 'ring_of_life', 'ring', 1), { ok: true, slot: 'ring', index: 1, locks: [] });
  assert.equal(canEquip(h, 'grail'), false);
  assert.equal(findEquipSlot(h, 'grail').error, 'not_equippable');
  give(h, 'grail');
  assert.deepEqual(h.artifacts.backpack, ['grail']);
});

test('equip from backpack: free slot, swap with occupant, errors', () => {
  const h = hero();
  give(h, 'centaurs_axe', 'sword_of_hellfire', 'ring_of_life');
  assert.equal(equip(h, 'skull_helmet').error, 'not_in_backpack');
  assert.equal(equip(h, 'sword_of_hellfire').error, 'no_free_slot');
  // explicit index => swap
  const r = equip(h, 'sword_of_hellfire', 'right_hand', 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.events.map((e) => e.type), ['artifact_unequipped', 'artifact_equipped']);
  assert.equal(h.artifacts.equipped.right_hand[0], 'sword_of_hellfire');
  assert.deepEqual(h.artifacts.backpack, ['centaurs_axe']);
  // by backpack index, into a chosen ring slot
  unequip(h, 'ring', 0);
  assert.equal(equip(h, 1, 'ring', 1).ok, true);
  assert.deepEqual(h.artifacts.equipped.ring, [null, 'ring_of_life']);
  assert.equal(equip(h, 0, 'left_hand').error, 'wrong_slot');
  assert.equal(equip(h, 7).error, 'not_in_backpack');
});

test('unequip / moveToBackpack', () => {
  const h = hero();
  give(h, 'centaurs_axe');
  assert.equal(unequip(h, 'head').error, 'empty_slot');
  assert.equal(unequip(h, 'nose').error, 'bad_slot');
  const r = unequip(h, 'right_hand');
  assert.deepEqual(r, { ok: true, events: [{ type: 'artifact_unequipped', heroId: 'h1', artifact: 'centaurs_axe', slot: 'right_hand', index: 0 }] });
  assert.equal(h.artifacts.equipped.right_hand[0], null);
  assert.deepEqual(h.artifacts.backpack, ['centaurs_axe']);
  assert.equal(moveToBackpack(h, 'centaurs_axe').error, 'already_in_backpack');
  assert.equal(moveToBackpack(h, 'skull_helmet').error, 'not_found');
  equip(h, 'centaurs_axe');
  assert.equal(moveToBackpack(h, 'centaurs_axe').ok, true);
  assert.deepEqual(getEquippedArtifacts(h), []);
});

test('backpack overflow: cap 64', () => {
  const h = hero();
  for (let i = 0; i < BACKPACK_CAP; i++) assert.equal(giveArtifact(h, 'centaurs_axe', { toBackpack: true }).ok, true);
  assert.equal(BACKPACK_CAP, 64);
  assert.equal(h.artifacts.backpack.length, 64);
  // still auto-equips while a slot is free
  assert.equal(giveArtifact(h, 'skull_helmet').ok, true);
  assert.equal(giveArtifact(h, 'skull_helmet').error, 'backpack_full');
  assert.equal(giveArtifact(h, 'helm_of_chaos', { toBackpack: true }).error, 'backpack_full');
  assert.equal(unequip(h, 'head').error, 'backpack_full');
  assert.equal(h.artifacts.equipped.head[0], 'skull_helmet');
  // swapping keeps the size constant, so it still works
  give(h, 'sword_of_hellfire');
  assert.equal(equip(h, 0, 'right_hand', 0).ok, true);
  assert.equal(h.artifacts.backpack.length, 64);
  assert.equal(h.artifacts.backpack[0], 'sword_of_hellfire');
});

test('removeArtifact prefers equipped, then backpack', () => {
  const h = hero();
  give(h, 'centaurs_axe', 'centaurs_axe');
  assert.equal(removeArtifact(h, 'centaurs_axe').events[0].where, 'equipped');
  assert.equal(removeArtifact(h, 'centaurs_axe').events[0].where, 'backpack');
  assert.equal(removeArtifact(h, 'centaurs_axe').error, 'not_found');
  give(h, 'skull_helmet');
  assert.equal(removeArtifact(h, { slot: 'head', index: 0 }).ok, true);
  assert.equal(removeArtifact(h, { slot: 'head', index: 0 }).error, 'not_found');
});

test('war machines and spellbook: fixed slots, never in the backpack', () => {
  const h = hero();
  give(h, 'spellbook', 'first_aid_tent', 'ballista', 'catapult', 'ammo_cart');
  assert.deepEqual(h.artifacts.equipped.war_machine, ['ballista', 'ammo_cart', 'first_aid_tent', 'catapult']);
  assert.deepEqual(getWarMachines(h), ['ballista', 'ammo_cart', 'first_aid_tent', 'catapult']);
  assert.equal(giveArtifact(h, 'ballista').error, 'no_free_slot');
  assert.equal(giveArtifact(h, 'cannon').error, 'no_free_slot', 'cannon shares the ballista slot');
  assert.equal(giveArtifact(h, 'spellbook').error, 'no_free_slot');
  assert.equal(unequip(h, 'war_machine', 0).error, 'not_movable');
  assert.equal(unequip(h, 'spellbook').error, 'not_movable');
  assert.equal(findEquipSlot(h, 'ammo_cart', 'war_machine', 0).error, 'wrong_slot');
  assert.equal(removeArtifact(h, 'ballista').ok, true);
  give(h, 'cannon');
  assert.equal(h.artifacts.equipped.war_machine[0], 'cannon');
  assert.equal(h.artifacts.backpack.length, 0);
});

test('getArtifactBonuses flattens equipped artifacts and tags the source', () => {
  const h = hero();
  give(h, 'titans_gladius', 'sentinels_shield', 'endless_sack_of_gold', 'endless_sack_of_gold', 'boots_of_speed');
  giveArtifact(h, 'helm_of_heavenly_enlightenment', { toBackpack: true });
  assert.deepEqual(sumPrimary(h), { attack: 9, defense: 9, power: 0, knowledge: 0 });
  const bs = getArtifactBonuses(h);
  assert.equal(bs.filter((b) => b.type === 'resource_income').reduce((s, b) => s + b.value, 0), 2000);
  assert.ok(bs.every((b) => typeof b.type === 'string' && b.source.startsWith('artifact:')));
  assert.equal(bs.find((b) => b.type === 'movement_land').source, 'artifact:boots_of_speed');
  // copies: mutating the result must not touch the data
  bs[0].value = 999;
  assert.equal(getArtifact('titans_gladius').bonuses[0].value, 12);
});

test('assemble: needs all components equipped; combo takes main slot and locks the rest', () => {
  const h = hero();
  give(h, ...AA.slice(0, 5));
  assert.equal(canAssemble(h, 'angelic_alliance'), false);
  assert.equal(checkAssemble(h, 'angelic_alliance').error, 'missing_components');
  assert.equal(assemble(h, 'angelic_alliance').error, 'missing_components');
  assert.equal(assemble(h, 'centaurs_axe').error, 'not_a_combo');
  giveArtifact(h, AA[5], { toBackpack: true });
  assert.equal(canAssemble(h, 'angelic_alliance'), false, 'backpack parts do not count');
  equip(h, AA[5]);
  assert.deepEqual(getAssemblableCombos(h), ['angelic_alliance']);
  assert.deepEqual(sumPrimary(h), { attack: 21, defense: 21, power: 21, knowledge: 21 });

  const r = assemble(h, 'angelic_alliance');
  assert.deepEqual(r, { ok: true, events: [{ type: 'artifact_assembled', heroId: 'h1', artifact: 'angelic_alliance', slot: 'right_hand', index: 0 }] });
  assert.equal(h.artifacts.equipped.right_hand[0], 'angelic_alliance');
  for (const slot of ['torso', 'feet', 'neck', 'left_hand', 'head']) {
    assert.equal(h.artifacts.equipped[slot][0], null, slot);
    assert.equal(isSlotLocked(h, slot, 0), true, slot);
    assert.equal(slotLockedBy(h, slot, 0), 'angelic_alliance');
  }
  assert.equal(isSlotLocked(h, 'right_hand', 0), false);
  assert.equal(getEquippedArtifacts(h).length, 1);
  assert.deepEqual(getAssemblableCombos(h), []);
  // components count as present; bonuses = components + combo extras
  for (const id of AA) assert.equal(hasArtifact(h, id), true, id);
  assert.equal(hasArtifact(h, 'angelic_alliance'), true);
  assert.deepEqual(sumPrimary(h), { attack: 21, defense: 21, power: 21, knowledge: 21 });
  const bs = getArtifactBonuses(h);
  assert.equal(bs.filter((b) => b.type === 'combat_start_cast' && b.spellId === 'prayer').length, 1);
  assert.equal(bs.filter((b) => b.type === 'no_alignment_penalty').length, 1);
  assert.ok(bs.every((b) => b.source === 'artifact:angelic_alliance'));
  assert.deepEqual(JSON.parse(JSON.stringify(h)), h);
});

test('locked slots refuse artifacts; they go to the backpack instead', () => {
  const h = hero();
  give(h, ...AA);
  assemble(h, 'angelic_alliance');
  assert.equal(canEquip(h, 'skull_helmet'), false);
  assert.equal(findEquipSlot(h, 'skull_helmet').error, 'no_free_slot');
  assert.equal(findEquipSlot(h, 'skull_helmet', 'head', 0).error, 'slot_locked');
  assert.equal(giveArtifact(h, 'skull_helmet').events[0].where, 'backpack');
  assert.equal(equip(h, 'skull_helmet', 'head', 0).error, 'slot_locked');
  assert.equal(unequip(h, 'head', 0).error, 'slot_locked');
  // unrelated slots still work
  assert.equal(giveArtifact(h, 'ring_of_life').events[0].where, 'equipped');
});

test('disassemble restores the components to their slots and clears locks', () => {
  const h = hero();
  give(h, ...AA);
  assemble(h, 'angelic_alliance');
  assert.equal(disassemble(h, 'centaurs_axe').error, 'not_found');
  const r = disassemble(h, 'angelic_alliance');
  assert.equal(r.ok, true);
  assert.equal(r.events[0].type, 'artifact_disassembled');
  assert.deepEqual(h.artifacts.locks, {});
  for (const id of AA) assert.equal(h.artifacts.equipped[getArtifact(id).slot][0], id);
  assert.deepEqual(h.artifacts.backpack, []);
  give(h, 'ring_of_life');
  assert.equal(disassemble(h, 'ring_of_life').error, 'not_a_combo');
});

test('multi-slot combos: Elixir of Life locks both rings, Statue of Legion all misc', () => {
  const h = hero();
  give(h, 'ring_of_vitality', 'ring_of_life', 'clover_of_fortune', 'vial_of_lifeblood');
  assert.equal(assemble(h, 'elixir_of_life').ok, true);
  assert.deepEqual(h.artifacts.equipped.misc, ['clover_of_fortune', 'elixir_of_life', null, null, null]);
  assert.deepEqual(h.artifacts.equipped.ring, [null, null]);
  assert.equal(isSlotLocked(h, 'ring', 0) && isSlotLocked(h, 'ring', 1), true);
  assert.equal(canEquip(h, 'diplomats_ring'), false);
  const hp = getArtifactBonuses(h).filter((b) => b.type === 'creature_stat' && b.stat === 'hp');
  assert.equal(hp.filter((b) => b.value).reduce((s, b) => s + b.value, 0), 4);
  assert.equal(hp.find((b) => b.percent).percent, 25);
  assert.ok(getArtifactBonuses(h).some((b) => b.type === 'creature_regeneration'));

  const g = hero('h2');
  give(g, 'legs_of_legion', 'loins_of_legion', 'torso_of_legion', 'arms_of_legion', 'head_of_legion');
  assemble(g, 'statue_of_legion');
  assert.deepEqual(g.artifacts.equipped.misc, ['statue_of_legion', null, null, null, null]);
  assert.equal(findEquipSlot(g, 'speculum').error, 'no_free_slot');
  assert.equal(Object.keys(g.artifacts.locks).length, 4);
});

test('Cloak of the Undead King aggregates necromancy and exposes the raise table', () => {
  const h = hero();
  give(h, 'amulet_of_the_undertaker', 'vampires_cowl', 'dead_mans_boots');
  assemble(h, 'cloak_of_the_undead_king');
  assert.equal(h.artifacts.equipped.shoulders[0], 'cloak_of_the_undead_king');
  const bs = getArtifactBonuses(h);
  assert.equal(bs.filter((b) => b.type === 'necromancy_percent').reduce((s, b) => s + b.percent, 0), 30);
  assert.deepEqual(bs.find((b) => b.type === 'necromancy_raise').creatures, ['skeleton', 'walking_dead', 'wight', 'lich']);
});

test('unequipping a combo releases its locks; re-equipping needs the component slots free', () => {
  const h = hero();
  give(h, 'ring_of_conjuring', 'collar_of_conjuring', 'cape_of_conjuring');
  assemble(h, 'ring_of_the_magi');
  assert.equal(h.artifacts.equipped.ring[0], 'ring_of_the_magi');
  assert.equal(isSlotLocked(h, 'neck', 0), true);
  assert.equal(unequip(h, 'ring', 0).ok, true);
  assert.deepEqual(h.artifacts.locks, {});
  assert.deepEqual(h.artifacts.backpack, ['ring_of_the_magi']);
  assert.equal(hasArtifact(h, 'collar_of_conjuring'), false);
  assert.equal(ownsArtifact(h, 'collar_of_conjuring'), true);

  give(h, 'pendant_of_courage'); // takes the neck
  assert.equal(equip(h, 'ring_of_the_magi').error, 'component_slots_occupied');
  assert.equal(canEquip(h, 'ring_of_the_magi'), false);
  moveToBackpack(h, 'pendant_of_courage');
  assert.equal(equip(h, 'ring_of_the_magi').ok, true);
  assert.equal(isSlotLocked(h, 'neck', 0) && isSlotLocked(h, 'shoulders', 0), true);
  assert.equal(getArtifactBonuses(h).filter((b) => b.type === 'spell_duration').reduce((s, b) => s + b.value, 0), 56);
});

test('giveArtifact auto-equips a whole combo when its slots are free; disassemble from backpack', () => {
  const h = hero();
  assert.equal(giveArtifact(h, 'titans_thunder').events[0].where, 'equipped');
  assert.equal(h.artifacts.equipped.right_hand[0], 'titans_thunder');
  for (const s of ['left_hand', 'head', 'torso']) assert.equal(slotLockedBy(h, s, 0), 'titans_thunder');
  assert.deepEqual(sumPrimary(h), { attack: 9, defense: 9, power: 8, knowledge: 8 });
  assert.equal(giveArtifact(h, 'titans_thunder').events[0].where, 'backpack');
  assert.equal(disassemble(h, { backpack: 0 }).ok, true);
  assert.deepEqual(h.artifacts.backpack, ['titans_gladius', 'sentinels_shield', 'thunder_helmet', 'titans_cuirass']);
  // swapping a combo out for a plain weapon frees its locks
  assert.equal(equip(h, 'titans_gladius', 'right_hand', 0).ok, true);
  assert.deepEqual(h.artifacts.locks, {});
  assert.equal(h.artifacts.backpack[0], 'titans_thunder');
  assert.equal(equip(h, 'thunder_helmet').ok, true);
});

test('swapping a combo into an explicit occupied slot', () => {
  const h = hero();
  give(h, 'centaurs_axe');
  giveArtifact(h, 'titans_thunder'); // right hand taken -> backpack
  assert.deepEqual(h.artifacts.backpack, ['titans_thunder']);
  assert.equal(equip(h, 'titans_thunder').error, 'no_free_slot');
  assert.equal(equip(h, 'titans_thunder', 'right_hand', 0).ok, true);
  assert.deepEqual(h.artifacts.backpack, ['centaurs_axe']);
  assert.equal(Object.keys(h.artifacts.locks).length, 3);
});

test('spell scrolls are {id, spellId} instances', () => {
  const h = hero();
  assert.equal(giveArtifact(h, 'spell_scroll').error, 'scroll_needs_spell');
  assert.equal(giveArtifact(h, makeScroll('town_portal')).ok, true);
  assert.equal(giveArtifact(h, { id: 'spell_scroll', spellId: 'magic_arrow' }).ok, true);
  assert.deepEqual(h.artifacts.equipped.misc.slice(0, 2), [
    { id: 'spell_scroll', spellId: 'town_portal' }, { id: 'spell_scroll', spellId: 'magic_arrow' }]);
  assert.equal(hasArtifact(h, 'spell_scroll'), true);
  const granted = getArtifactBonuses(h).filter((b) => b.type === 'grants_spell');
  assert.deepEqual(granted.map((b) => b.spellId), ['town_portal', 'magic_arrow']);
  assert.ok(granted.every((b) => !('fromInstance' in b)));
  // a specific scroll can be addressed; a bare id matches the first one
  assert.deepEqual(findArtifact(h, makeScroll('magic_arrow')), { where: 'equipped', slot: 'misc', index: 1, entry: { id: 'spell_scroll', spellId: 'magic_arrow' } });
  assert.equal(moveToBackpack(h, makeScroll('magic_arrow')).ok, true);
  assert.deepEqual(h.artifacts.backpack, [{ id: 'spell_scroll', spellId: 'magic_arrow' }]);
  assert.deepEqual(getArtifactBonuses(h).filter((b) => b.type === 'grants_spell').map((b) => b.spellId), ['town_portal']);
  assert.equal(equip(h, makeScroll('haste')).error, 'not_in_backpack');
  assert.equal(equip(h, 'spell_scroll', 'misc', 4).ok, true);
  assert.equal(h.artifacts.equipped.misc[4].spellId, 'magic_arrow');
  assert.equal(removeArtifact(h, makeScroll('town_portal')).ok, true);
  assert.equal(removeArtifact(h, makeScroll('town_portal')).error, 'not_found');
  assert.deepEqual(JSON.parse(JSON.stringify(h)), h);
  // object entries for ordinary artifacts are normalised to ids
  giveArtifact(h, { id: 'centaurs_axe' });
  assert.equal(h.artifacts.equipped.right_hand[0], 'centaurs_axe');
  // scroll value by spell level
  assert.equal(artifactValue(makeScroll('magic_arrow'), 1), 500);
  assert.equal(artifactValue(makeScroll('town_portal'), 4), 8000);
});

test('transferArtifact between heroes', () => {
  const a = hero('a');
  const b = hero('b');
  give(a, 'centaurs_axe', 'skull_helmet', 'spellbook', 'catapult', 'ballista');
  giveArtifact(a, makeScroll('haste'));
  give(b, 'sword_of_hellfire');
  assert.equal(transferArtifact(a, a, 'centaurs_axe').error, 'same_hero');
  assert.equal(transferArtifact(a, b, 'ring_of_life').error, 'not_found');
  assert.equal(transferArtifact(a, b, 'spellbook').error, 'not_transferable');
  assert.equal(transferArtifact(a, b, 'catapult').error, 'not_transferable');
  // auto: right hand of b is taken -> backpack
  const r = transferArtifact(a, b, 'centaurs_axe');
  assert.equal(r.ok, true);
  assert.equal(r.events[0].where, 'backpack');
  assert.deepEqual(b.artifacts.backpack, ['centaurs_axe']);
  assert.equal(a.artifacts.equipped.right_hand[0], null);
  // explicit slot
  assert.equal(transferArtifact(b, a, { backpack: 0 }, { slot: 'right_hand' }).ok, true);
  assert.equal(a.artifacts.equipped.right_hand[0], 'centaurs_axe');
  assert.equal(transferArtifact(b, a, 'sword_of_hellfire', { slot: 'right_hand', index: 0 }).error, 'slot_occupied');
  assert.equal(transferArtifact(b, a, 'sword_of_hellfire', { slot: 'head' }).error, 'wrong_slot');
  assert.equal(b.artifacts.equipped.right_hand[0], 'sword_of_hellfire', 'failed transfer changes nothing');
  // explicit backpack
  assert.equal(transferArtifact(a, b, 'skull_helmet', { backpack: true }).ok, true);
  assert.deepEqual(b.artifacts.backpack, ['skull_helmet']);
  // scrolls and war machines move too
  assert.equal(transferArtifact(a, b, makeScroll('haste')).ok, true);
  assert.deepEqual(b.artifacts.equipped.misc[0], { id: 'spell_scroll', spellId: 'haste' });
  assert.equal(transferArtifact(a, b, 'ballista').ok, true);
  assert.equal(b.artifacts.equipped.war_machine[0], 'ballista');
  give(a, 'ballista');
  assert.equal(transferArtifact(a, b, 'ballista').error, 'no_free_slot');
});

test('transferring an equipped combo moves locks with it', () => {
  const a = hero('a');
  const b = hero('b');
  give(a, 'titans_thunder');
  give(b, 'skull_helmet');
  assert.equal(transferArtifact(a, b, 'titans_thunder').events[0].where, 'backpack');
  assert.deepEqual(a.artifacts.locks, {});
  assert.equal(transferArtifact(b, a, 'titans_thunder').events[0].where, 'equipped');
  assert.equal(Object.keys(a.artifacts.locks).length, 3);
  for (let i = 0; i < BACKPACK_CAP; i++) giveArtifact(b, 'centaurs_axe', { toBackpack: true });
  assert.equal(transferArtifact(a, b, 'titans_thunder').error, 'backpack_full');
  assert.equal(a.artifacts.equipped.right_hand[0], 'titans_thunder');
});

test('captureArtifacts moves everything transferable to the winner', () => {
  const loser = hero('l');
  const winner = hero('w');
  give(loser, 'spellbook', 'ballista', 'centaurs_axe', 'sword_of_hellfire', 'titans_thunder', 'grail');
  giveArtifact(loser, makeScroll('haste'));
  const r = captureArtifacts(loser, winner);
  assert.equal(r.ok, true);
  assert.equal(r.events.filter((e) => e.type === 'artifact_transferred').length, 4);
  assert.deepEqual(getEquippedArtifacts(loser).map((e) => e.id).sort(), ['ballista', 'spellbook']);
  assert.deepEqual(loser.artifacts.backpack, ['grail']);
  assert.equal(hasArtifact(winner, 'centaurs_axe'), true);
  assert.equal(hasArtifact(winner, 'spell_scroll'), true);
  assert.deepEqual(winner.artifacts.backpack.slice().sort(), ['sword_of_hellfire', 'titans_thunder']);
});

test('artifactSellPrice scales with marketplaces', () => {
  assert.equal(artifactSellPrice('centaurs_axe', 1), 600);
  assert.equal(artifactSellPrice('centaurs_axe'), 600);
  assert.equal(artifactSellPrice('centaurs_axe', 3), 1000);
  assert.equal(artifactSellPrice('centaurs_axe', 8), 2000);
  assert.equal(artifactSellPrice('centaurs_axe', 20), 2000);
  assert.equal(artifactSellPrice('centaurs_axe', 0), 0);
  assert.equal(artifactSellPrice('sword_of_judgement', 8, { resource: 'wood' }), 80);
  assert.equal(artifactSellPrice('sword_of_judgement', 8, { resource: 'gems' }), 40);
  assert.equal(artifactSellPrice('grail', 8), 0);
  assert.equal(artifactSellPrice(makeScroll('haste'), 8, { spellLevel: 1 }), 500);
  let prev = -1;
  for (let m = 1; m <= 9; m++) {
    const p = artifactSellPrice('angelic_alliance', m);
    assert.ok(p >= prev);
    prev = p;
  }
});

test('pickRandomArtifact is deterministic, respects class and exclude', () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = Array.from({ length: 20 }, () => pickRandomArtifact(a, 'major'));
  const seqB = Array.from({ length: 20 }, () => pickRandomArtifact(b, 'major'));
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((id) => getArtifact(id).class === 'major'));
  assert.ok(new Set(seqA).size > 5);
  const rng = createRng(7);
  for (let i = 0; i < 200; i++) {
    const id = pickRandomArtifact(rng);
    const def = getArtifact(id);
    assert.ok(['treasure', 'minor', 'major', 'relic'].includes(def.class));
    assert.ok(!def.noRandom && !def.components);
  }
  const relics = [];
  for (;;) {
    const id = pickRandomArtifact(rng, 'relic', relics);
    if (id === null) break;
    assert.ok(!relics.includes(id));
    relics.push(id);
  }
  assert.ok(relics.length >= 25);
  assert.ok(!relics.includes('armageddons_blade'));
  assert.equal(pickRandomArtifact(rng, 'combo'), null);
  assert.ok(['treasure', 'minor'].includes(getArtifact(pickRandomArtifact(rng, ['treasure', 'minor'])).class));
});

test('moveArtifact: backpack order, ring swap, slot <-> backpack position, failures leave the hero unchanged', () => {
  const h = hero();
  give(h, 'quiet_eye_of_the_dragon', 'still_eye_of_the_dragon');
  assert.deepEqual(h.artifacts.equipped.ring, ['quiet_eye_of_the_dragon', 'still_eye_of_the_dragon']);
  assert.equal(moveArtifact(h, { slot: 'ring', index: 0 }, { slot: 'ring', index: 1 }).ok, true);
  assert.deepEqual(h.artifacts.equipped.ring, ['still_eye_of_the_dragon', 'quiet_eye_of_the_dragon']);
  giveArtifact(h, 'centaurs_axe', { toBackpack: true });
  giveArtifact(h, 'boots_of_speed', { toBackpack: true });
  assert.equal(moveArtifact(h, { backpack: 1 }, { backpack: 0 }).ok, true);
  assert.deepEqual(h.artifacts.backpack, ['boots_of_speed', 'centaurs_axe']);
  assert.equal(moveArtifact(h, { slot: 'ring', index: 1 }, { backpack: 0 }).ok, true);
  assert.deepEqual(h.artifacts.backpack, ['quiet_eye_of_the_dragon', 'boots_of_speed', 'centaurs_axe']);
  assert.equal(moveArtifact(h, { backpack: 2 }, { slot: 'right_hand', index: 0 }).ok, true);
  const before = JSON.stringify(h.artifacts);
  assert.equal(moveArtifact(h, { slot: 'right_hand', index: 0 }, { slot: 'head', index: 0 }).error, 'wrong_slot');
  assert.equal(moveArtifact(h, { backpack: 9 }, { backpack: 0 }).error, 'empty_slot');
  assert.equal(JSON.stringify(h.artifacts), before);
});
