import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addHero, adv, fillRect, answer, finishCombat, kinds } from './fixture.js';

const P = (x, y, z = 0) => ({ x, y, z });
const mage = (state, o = {}) => addHero(state, { pos: P(4, 5), mana: 100, spells: ['summon_boat', 'scuttle_boat', 'visions', 'view_earth', 'view_air', 'disguise', 'fly', 'water_walk', 'dimension_door', 'town_portal'], ...o });
const cast = (state, h, id, target) => adv.castAdventureSpell(state, h.id, id, target);
const last = (res) => res.events[res.events.length - 1];

test('casting rules: book, known spell, mana, mastery cost', () => {
  const state = makeState();
  const h = mage(state);
  assert.equal(cast(state, h, 'haste').error, 'not_an_adventure_spell');
  h.spells = [];
  assert.equal(cast(state, h, 'fly').error, 'spell_unknown');
  h.spells = ['fly'];
  h.mana = 19;
  assert.equal(cast(state, h, 'fly').error, 'not_enough_mana');
  h.mana = 20;
  const r = cast(state, h, 'fly');
  assert.ok(r.ok);
  assert.equal(h.mana, 0);
  assert.equal(last(r).cost, 20);
  h.skills = [{ id: 'air_magic', level: 1 }];
  h.mana = 15;
  assert.ok(cast(state, h, 'fly').ok, 'basic air: 15');
  assert.equal(adv.getSpellMastery(state, h, { school: 'air', id: 'fly' }), 1);
  h.artifacts.equipped.spellbook[0] = null;
  assert.equal(cast(state, h, 'fly').error, 'no_spellbook');
  // granted by an artifact (Sea Captain's Hat) without learning it
  const s2 = makeState();
  const h2 = addHero(s2, { mana: 50 });
  h2.artifacts.equipped.head[0] = 'sea_captains_hat';
  assert.notEqual(cast(s2, h2, 'summon_boat').error, 'spell_unknown');
});

test('Summon Boat: nearest own boat, chance by mastery, expert creates one', () => {
  let ok = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const state = makeState({ seed });
    fillRect(state, 5, 0, 15, 11, { t: 'water' });
    const h = mage(state);
    const far = adv.addObject(state, 'boat', P(14, 10), { data: { owner: 0 } });
    adv.addObject(state, 'boat', P(10, 1), { data: { owner: 1 } });
    const r = cast(state, h, 'summon_boat');
    assert.equal(h.mana, 92);
    if (last(r).success) { ok++; assert.deepEqual(far.pos, P(5, 4)); assert.equal(state.map.tiles[0][4][5].obj, far.id); }
  }
  assert.ok(ok > 15 && ok < 45, `50%: ${ok}/60`);
  const state = makeState();
  fillRect(state, 5, 0, 15, 11, { t: 'water' });
  const h = mage(state, { skills: [{ id: 'water_magic', level: 2 }] });
  const r = cast(state, h, 'summon_boat');
  assert.equal(h.mana, 93);
  assert.ok(!last(r).success && ['no_boat', 'failed'].includes(last(r).reason), 'no own boat below expert');
  h.skills[0].level = 3;
  const e = cast(state, h, 'summon_boat');
  assert.equal(last(e).success, true);
  assert.equal(last(e).created, true);
  const s3 = makeState();
  assert.equal(cast(s3, mage(s3), 'summon_boat').error, 'no_water', 'rejected for free without a shore');
});

test('Scuttle Boat: adjacent empty boat, chance by mastery', () => {
  const state = makeState();
  fillRect(state, 5, 0, 15, 11, { t: 'water' });
  const h = mage(state, { skills: [{ id: 'water_magic', level: 3 }] });
  assert.equal(cast(state, h, 'scuttle_boat').error, 'no_boat_in_range');
  const b = adv.addObject(state, 'boat', P(5, 5));
  const r = cast(state, h, 'scuttle_boat');
  assert.equal(last(r).success, true);
  assert.equal(state.map.objects[b.id], undefined);
  assert.equal(h.mana, 94);
});

test('Visions: range max(3, k x power), exact monster counts and intentions', () => {
  const state = makeState({ width: 30 });
  const h = mage(state, { primary: { power: 2 } });
  adv.addObject(state, 'monster', P(7, 5), { data: { creatureId: 'imp', count: 3, character: 1 } });
  adv.addObject(state, 'monster', P(12, 5), { data: { creatureId: 'imp', count: 3 } });
  assert.deepEqual(adv.getVisionsInfo(state, h.id).monsters, []);
  const r = cast(state, h, 'visions');
  assert.equal(last(r).range, 3);
  assert.deepEqual(last(r).info.monsters.map((m) => [m.count, m.outcome]), [[3, 'join']]);
  h.skills = [{ id: 'air_magic', level: 3 }];
  h.primary.power = 3;
  const r2 = cast(state, h, 'visions');
  assert.equal(last(r2).range, 9);
  assert.equal(last(r2).info.monsters.length, 2);
  addHero(state, { pos: P(8, 8), owner: 1, id: 'foe' });
  assert.equal(adv.getVisionsInfo(state, h.id).heroes.length, 1, 'expert shows heroes');
  assert.equal(h.temp.filter((t) => t.source === 'visions').length, 1, 'replaced, not stacked');
});

test('View Earth / View Air: markers by mastery, no fog change', () => {
  const state = makeState();
  const h = mage(state);
  adv.addObject(state, 'resource_wood', P(10, 2));
  adv.addObject(state, 'sawmill', P(10, 8));
  adv.addObject(state, 'artifact_minor', P(13, 2));
  addHero(state, { pos: P(14, 10), owner: 1, id: 'foe' });
  const e = last(cast(state, h, 'view_earth'));
  assert.equal(e.resources.length, 1);
  assert.equal(e.mines.length, 0);
  assert.equal(e.terrain, false);
  h.skills = [{ id: 'earth_magic', level: 3 }, { id: 'air_magic', level: 2 }];
  const e3 = last(cast(state, h, 'view_earth'));
  assert.equal(e3.mines.length, 1);
  assert.equal(e3.terrain, true);
  const a = last(cast(state, h, 'view_air'));
  assert.equal(a.artifacts.length, 1);
  assert.equal(a.heroes.length, 2);
  assert.equal(a.towns.length, 0);
  assert.ok(!adv.isExplored(state, 0, P(14, 10)));
});

test('Disguise: what enemies see of the army', () => {
  const state = makeState();
  const h = mage(state, { army: [{ creatureId: 'pikeman', count: 200 }, { creatureId: 'angel', count: 2 }, { creatureId: 'archer', count: 3 }] });
  assert.deepEqual(adv.getDisplayedArmy(state, h.id, 1).filter(Boolean).length, 3);
  cast(state, h, 'disguise');
  const seen = adv.getDisplayedArmy(state, h.id, 1).filter(Boolean);
  assert.deepEqual(seen, [{ creatureId: 'pikeman', count: 200 }, { creatureId: 'pikeman', count: 200 }, { creatureId: 'pikeman', count: 200 }], 'strongest stack');
  assert.equal(adv.getDisplayedArmy(state, h.id, 0)[1].creatureId, 'angel', 'own player sees the truth');
  h.skills = [{ id: 'air_magic', level: 2 }];
  cast(state, h, 'disguise');
  assert.deepEqual(adv.getDisplayedArmy(state, h.id, 1)[0], { creatureId: 'angel', count: 200 });
  h.skills[0].level = 3;
  cast(state, h, 'disguise');
  assert.equal(adv.getDisplayedArmy(state, h.id, 1), null);
});

test('Fly / Water Walk set a day-long movement mode with the mastery', () => {
  const state = makeState();
  const h = mage(state, { skills: [{ id: 'air_magic', level: 2 }, { id: 'water_magic', level: 1 }] });
  cast(state, h, 'fly');
  cast(state, h, 'water_walk');
  assert.deepEqual(h.temp.map((t) => [t.bonus.type, t.bonus.mastery, t.until]), [['fly', 2, 'end_of_day'], ['water_walk', 1, 'end_of_day']]);
  assert.equal(adv.getMoveContext(state, h).flyFactor, 1.2);
});

test('Dimension Door: range, move cost, uses per day, legal destinations, guards', () => {
  const state = makeState({ width: 30, height: 20 });
  const h = mage(state, { pos: P(5, 5), mana: 200 });
  assert.equal(cast(state, h, 'dimension_door', P(14, 5)).error, 'cannot_teleport_there', 'range 8');
  adv.addObject(state, 'resource_wood', P(9, 5));
  assert.equal(cast(state, h, 'dimension_door', P(9, 5)).error, 'cannot_teleport_there', 'object tile');
  state.map.tiles[0][5][10].t = 'water';
  assert.equal(cast(state, h, 'dimension_door', P(10, 5)).error, 'cannot_teleport_there', 'water from land');
  assert.equal(h.mana, 200, 'illegal casts are free');
  let r = cast(state, h, 'dimension_door', P(13, 5));
  assert.ok(r.ok);
  assert.deepEqual(h.pos, P(13, 5));
  assert.equal(h.movePoints, 1200);
  assert.equal(h.mana, 175);
  r = cast(state, h, 'dimension_door', P(13, 12));
  assert.equal(last(r).usesLeft, 0);
  assert.equal(cast(state, h, 'dimension_door', P(13, 13)).error, 'no_uses_left');
  state.turn = 2;
  h.movePoints = 299;
  assert.equal(cast(state, h, 'dimension_door', P(13, 13)).error, 'no_movement_points');
  // expert: 4 uses, 200 points, range 12; arriving next to a monster starts the fight
  h.skills = [{ id: 'air_magic', level: 3 }];
  h.movePoints = 1500;
  h.mana = 200;
  adv.addObject(state, 'monster', P(25, 12), { data: { creatureId: 'imp', count: 50, disposition: 'savage' } });
  r = cast(state, h, 'dimension_door', P(24, 12));
  assert.ok(r.ok);
  assert.equal(h.movePoints, 1300);
  assert.equal(state.combat.context.kind, 'adv_monster');
});

test('Town Portal: nearest free own town below advanced; choice at advanced', () => {
  const state = makeState({ width: 40, height: 20 });
  const h = mage(state, { pos: P(2, 2), skills: [{ id: 'wisdom', level: 2 }] });
  const town = (id, x, owner) => { state.towns[id] = { id, name: id, pos: P(x, 10), owner, garrison: new Array(7).fill(null), visitingHero: null, garrisonHero: null, buildings: [] }; adv.addObject(state, 'town', P(x, 10), { owner, data: { townId: id } }); };
  assert.equal(cast(state, h, 'town_portal').error, 'no_town');
  town('near', 6, 0); town('far', 30, 0); town('enemy', 3, 1);
  state.towns.near.visitingHero = 'someone';
  assert.equal(cast(state, h, 'town_portal').error, 'town_occupied');
  state.towns.near.visitingHero = null;
  const r = cast(state, h, 'town_portal');
  assert.ok(r.ok);
  assert.deepEqual(h.pos, P(6, 10));
  assert.equal(h.townId, 'near');
  assert.equal(h.movePoints, 1200);
  assert.equal(h.mana, 84);
  h.skills.push({ id: 'earth_magic', level: 2 });
  const r2 = cast(state, h, 'town_portal');
  assert.ok(r2.pending);
  assert.deepEqual(kinds(state), ['town_portal']);
  assert.deepEqual(state.pending[0].options.map((o) => o.id), ['far', 'cancel']);
  answer(state, 0);
  assert.deepEqual(h.pos, P(30, 10));
  assert.equal(state.towns.near.visitingHero, null);
  assert.equal(state.towns.far.visitingHero, h.id);
  h.inBoat = true;
  assert.equal(cast(state, h, 'town_portal', { townId: 'near' }).error, 'in_boat');
  void finishCombat;
});
