// Every effect type of the closed set (48) is exercised at least once, with its revisit rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addHero, adv, fillRect, answer, answerId, finishCombat, kinds, eventTypes, visitResults, assertJson } from './fixture.js';
import { EFFECT_TYPES, getMapObject } from '../../src/data/mapObjects.js';
import { getCreature } from '../../src/data/creatures.js';
import { getArtifact } from '../../src/data/artifacts.js';
import { getSpell } from '../../src/data/spells.js';
import { ownsArtifact, hasArtifact } from '../../src/engine/artifacts.js';
import { expForLevel } from '../../src/engine/leveling.js';
import { freelancerRate } from '../../src/data/buildings.js';

const P = (x, y, z = 0) => ({ x, y, z });
const covered = new Set();

/** Place `defId` at (5,5) and walk a fresh hero (standing below it) onto / against it. */
function setup(defId, params = {}, heroOpts = {}, stateOpts = {}) {
  const state = makeState(stateOpts);
  const def = getMapObject(defId);
  const sea = def.terrains.length === 1 && def.terrains[0] === 'water';
  if (sea) fillRect(state, 0, 0, 15, 11, { t: 'water' });
  const hero = addHero(state, { pos: P(5, 6), ...heroOpts });
  if (sea) { hero.inBoat = true; adv.addObject(state, 'boat', hero.pos, { data: { heroId: hero.id, owner: 0 } }); }
  const obj = adv.addObject(state, defId, P(5, 5), params);
  covered.add(getMapObject(obj.defId).effect.type);
  const go = () => { hero.movePoints = Math.max(hero.movePoints, 1000); return adv.moveHero(state, hero.id, P(5, 5)); };
  const again = () => adv.visitObject(state, hero.id, obj.id);
  return { state, hero, obj, def, go, again, player: state.players[0] };
}
/** A second hero of the same player for per-hero / per-player rules. */
function second(t, id = 'second', owner = 0) {
  if (t.hero.pos.x === 5 && t.hero.pos.y === 5) t.hero.pos = P(0, 0); // free the entrance
  const h = addHero(t.state, { pos: P(4, 6), id, owner });
  return { hero: h, go: () => { t.state.currentPlayer = owner; h.movePoints = 1500; const r = adv.moveHero(t.state, h.id, P(5, 5)); return r; } };
}
const gold = (t, id = 0) => t.state.players[id].resources.gold;

test('none: scenery cannot be visited', () => {
  const t = setup('mountains_2x2');
  assert.equal(t.go().error, 'no_path');
  assert.equal(t.again().error, 'not_visitable');
});

test('pickup: resource piles, campfire, sea objects are rolled at the visit and removed', () => {
  const ranges = { wood: [5, 10], ore: [5, 10], mercury: [3, 6], sulfur: [3, 6], crystal: [3, 6], gems: [3, 6], gold: [500, 1000] };
  for (const [res, [lo, hi]] of Object.entries(ranges)) {
    const t = setup(`resource_${res}`);
    const before = t.player.resources[res];
    const r = t.go();
    const got = t.player.resources[res] - before;
    assert.ok(got >= lo && got <= hi, `${res}: ${got}`);
    if (res === 'gold') assert.equal(got % 100, 0);
    assert.equal(t.state.map.objects[t.obj.id], undefined);
    assert.deepEqual(t.hero.pos, P(5, 6), 'hero does not move');
    assert.deepEqual(eventTypes(r), ['pickup', 'resources']);
  }
  const fire = setup('campfire');
  const g0 = gold(fire);
  const ev = fire.go().events.find((e) => e.type === 'pickup');
  const dg = gold(fire) - g0;
  assert.ok([400, 500, 600].includes(dg));
  const other = Object.entries(ev.reward.resources).find(([r]) => r !== 'gold');
  assert.equal(other[1], dg / 100);
  // flotsam: 4 equally likely outcomes
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const t = setup('flotsam', {}, {}, { seed });
    const w = t.player.resources.wood;
    const g = gold(t);
    const r = t.go();
    seen.add(`${t.player.resources.wood - w}/${gold(t) - g}`);
    assert.equal(t.state.map.objects[t.obj.id], undefined, 'removed even when empty');
    assert.equal(r.events[r.events.length - 1].type === 'pickup', t.player.resources.wood === w);
  }
  assert.deepEqual([...seen].sort(), ['0/0', '10/500', '5/0', '5/200']);
  // survivor always gives an artifact, vial gives mana above the maximum
  const sv = setup('shipwreck_survivor');
  const countArts = (h) => h.artifacts.backpack.length + Object.values(h.artifacts.equipped).flat().filter(Boolean).length;
  const had = countArts(sv.hero);
  sv.go();
  assert.equal(countArts(sv.hero), had + 1, 'the gift');
  const vial = setup('vial_of_mana', {}, { mana: 10 });
  vial.go();
  assert.ok([20, 30, 40, 60].includes(vial.hero.mana));
});

test('chest: gold-or-experience choice (32/32/31%), 5% artifact; removed when resolved', () => {
  const rows = new Set();
  let artifacts = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const t = setup('treasure_chest', {}, {}, { seed });
    t.go();
    if (!t.state.pending.length) {
      artifacts++;
      assert.equal(t.state.map.objects[t.obj.id], undefined);
      continue;
    }
    const p = t.state.pending[0];
    assert.equal(p.kind, 'chest_choice');
    assert.deepEqual(p.options.map((o) => o.id), ['gold', 'exp']);
    rows.add(`${p.options[0].gold}/${p.options[1].exp}`);
    assert.ok(t.state.map.objects[t.obj.id], 'still there until the choice is made');
    const g = gold(t);
    if (seed % 2) {
      answer(t.state, 0);
      assert.equal(gold(t), g + p.options[0].gold);
      assert.equal(t.hero.exp, 0);
    } else {
      answer(t.state, 1);
      assert.equal(gold(t), g);
      assert.equal(t.hero.exp, p.options[1].exp);
    }
    assert.equal(t.state.map.objects[t.obj.id], undefined);
  }
  assert.deepEqual([...rows].sort(), ['1000/500', '1500/1000', '2000/1500']);
  assert.ok(artifacts >= 1 && artifacts <= 20, `artifact chests: ${artifacts}`);
});

test('artifact: plain pickup, guarded, for a price, full backpack', () => {
  const t = setup('artifact_major', { data: { artifactId: 'boots_of_speed' } });
  t.go();
  assert.ok(hasArtifact(t.hero, 'boots_of_speed'), 'equipped into the free slot');
  assert.equal(t.state.map.objects[t.obj.id], undefined);
  // guarded
  const g = setup('artifact_relic', { data: { artifactId: 'angel_wings', guards: [{ creatureId: 'griffin', count: 12, stacks: 3 }] } });
  g.go();
  assert.deepEqual(kinds(g.state), ['confirm_fight']);
  assert.deepEqual(g.state.pending[0].data.guards.filter(Boolean).map((s) => s.count), [4, 4, 4]);
  answer(g.state, 1);
  assert.ok(!ownsArtifact(g.hero, 'angel_wings'));
  g.again();
  answer(g.state, 0);
  assert.equal(g.state.combat.context.kind, 'adv_object');
  finishCombat(g.state, 'attacker');
  assert.ok(ownsArtifact(g.hero, 'angel_wings'));
  // lost fight: guards keep their survivors
  const l = setup('artifact_relic', { data: { artifactId: 'angel_wings', guards: [{ creatureId: 'griffin', count: 12 }] } });
  l.go();
  answer(l.state, 0);
  finishCombat(l.state, 'defender', [{ creatureId: 'griffin', count: 7 }]);
  assert.equal(l.obj.data.guards[0].count, 7);
  // price
  const c = setup('artifact_minor', { data: { artifactId: 'equestrians_gloves', cost: { gold: 3000, gems: 2 } } });
  c.go();
  assert.deepEqual(kinds(c.state), ['confirm_pay']);
  const before = gold(c);
  answer(c.state, 0);
  assert.equal(gold(c), before - 3000);
  assert.ok(ownsArtifact(c.hero, 'equestrians_gloves'));
  const poor = setup('artifact_minor', { data: { artifactId: 'equestrians_gloves', cost: { gold: 99999 } } });
  assert.deepEqual(visitResults(poor.go()), ['cannot_afford']);
  assert.ok(poor.state.map.objects[poor.obj.id]);
  // full backpack
  const f = setup('artifact_treasure', { data: { artifactId: 'spyglass' } });
  f.hero.artifacts.backpack = new Array(64).fill('speculum');
  assert.deepEqual(visitResults(f.go()), ['backpack_full']);
  assert.equal(f.again().error, 'backpack_full');
  assert.ok(f.state.map.objects[f.obj.id]);
});

test('spell_scroll: the hero receives a scroll bound to the rolled spell', () => {
  const t = setup('spell_scroll', { data: { spellId: 'town_portal' } });
  t.go();
  const scroll = [...t.hero.artifacts.equipped.misc, ...t.hero.artifacts.backpack].find((e) => e && e.id === 'spell_scroll');
  assert.deepEqual(scroll, { id: 'spell_scroll', spellId: 'town_portal' });
  assert.ok(adv.deps.getHeroSpells(t.state, t.hero).includes('town_portal'));
});

test("pandoras_box: confirm, optional guards, positive and negative payload", () => {
  const t = setup('pandoras_box', { data: {
    message: 'Surprise', exp: 500, mana: 20, morale: 1, luck: -1, resources: { gold: 2000, wood: -500 }, primary: { attack: 2, power: -5 },
    skills: [{ id: 'logistics', level: 2 }], artifacts: ['spyglass'], spells: ['haste'], creatures: [{ creatureId: 'angel', count: 1 }, { creatureId: 'pikeman', count: -4 }],
  } }, { primary: { power: 2 } });
  t.go();
  assert.deepEqual(kinds(t.state), ['confirm_open']);
  answer(t.state, 1);
  assert.ok(t.state.map.objects[t.obj.id], 'declining keeps the box');
  t.again();
  const g = gold(t);
  const res = answer(t.state, 0);
  assert.equal(res.events[0].type, 'box_opened');
  assert.equal(res.events[0].message, 'Surprise');
  assert.equal(t.state.map.objects[t.obj.id], undefined);
  assert.equal(gold(t), g + 2000);
  assert.equal(t.player.resources.wood, 0, 'clamped at 0');
  assert.equal(t.hero.exp, 500);
  assert.equal(t.hero.mana, 30);
  assert.deepEqual(t.hero.primary, { attack: 3, defense: 1, power: 0, knowledge: 1 }, 'negative values clamp at 0');
  assert.deepEqual(t.hero.skills, [{ id: 'logistics', level: 2 }]);
  assert.ok(ownsArtifact(t.hero, 'spyglass'));
  assert.ok(t.hero.spells.includes('haste'));
  assert.deepEqual(t.hero.army.filter(Boolean), [{ creatureId: 'pikeman', count: 6 }, { creatureId: 'angel', count: 1 }]);
  assert.deepEqual(t.hero.temp.map((x) => [x.bonus.type, x.bonus.value, x.until]), [['morale', 1, 'next_battle'], ['luck', -1, 'next_battle']]);
  // guarded box
  const gd = setup('pandoras_box', { data: { guards: [{ creatureId: 'imp', count: 30 }], resources: { gold: 5000 } } });
  gd.go();
  answer(gd.state, 0);
  assert.equal(gd.state.combat.context.objectId, gd.obj.id);
  const g2 = gold(gd);
  finishCombat(gd.state, 'attacker');
  assert.equal(gold(gd), g2 + 5000);
  assert.equal(gd.state.map.objects[gd.obj.id], undefined);
});

test('event: player filters, once, guards; army overflow pending', () => {
  const t = setup('event', { data: { players: [1], resources: { gold: 100 } } });
  const g = gold(t);
  const r = t.go();
  assert.ok(r.arrived);
  assert.equal(gold(t), g, 'not for player 0');
  assert.ok(t.state.map.objects[t.obj.id]);
  const ai = setup('event', { data: { aiOnly: true, exp: 100 } });
  ai.go();
  assert.equal(ai.hero.exp, 0);
  const hu = setup('event', { data: { humanOnly: true, exp: 100 } });
  hu.go();
  assert.equal(hu.hero.exp, 100);
  assert.ok(hu.state.map.objects[hu.obj.id], 'repeatable unless `once`');
  hu.again();
  assert.equal(hu.hero.exp, 200);
  // creatures with a full army -> army_overflow
  const full = ['pikeman', 'archer', 'griffin', 'swordsman', 'monk', 'cavalier', 'angel'].map((creatureId) => ({ creatureId, count: 1 }));
  const o = setup('event', { data: { creatures: [{ creatureId: 'imp', count: 50 }], once: true } }, { army: full });
  o.go();
  assert.deepEqual(kinds(o.state), ['army_overflow']);
  assert.equal(o.state.pending[0].options.length, 8);
  answerId(o.state, 'dismiss', undefined, (opt) => opt.slot === 2);
  assert.deepEqual(o.hero.army[2], { creatureId: 'imp', count: 50 });
  const o2 = setup('event', { data: { creatures: [{ creatureId: 'imp', count: 50 }], once: true } }, { army: full });
  o2.go();
  answerId(o2.state, 'leave');
  assert.ok(o2.hero.army.every((s) => s.creatureId !== 'imp'));
  // guards
  const gd = setup('event', { data: { guards: [{ creatureId: 'imp', count: 5 }], exp: 700, once: true } });
  gd.go();
  assert.equal(gd.state.combat.context.kind, 'adv_object');
  finishCombat(gd.state, 'attacker');
  assert.equal(gd.hero.exp, 700);
});

test('grail: hidden marker, never visitable', () => {
  const t = setup('grail');
  assert.ok(t.go().arrived);
  assert.deepEqual(t.state.pending, []);
  assert.equal(t.again().error, 'not_visitable');
});

test('mine: flag, daily income, owner revisit, garrison, abandoned mine', () => {
  const amounts = { sawmill: ['wood', 2], ore_pit: ['ore', 2], alchemists_lab: ['mercury', 1], sulfur_dune: ['sulfur', 1], crystal_cavern: ['crystal', 1], gem_pond: ['gems', 1], gold_mine: ['gold', 1000] };
  const state = makeState({ width: 40, height: 10 });
  const hero = addHero(state, { pos: P(0, 9) });
  let x = 2;
  for (const id of Object.keys(amounts)) {
    const m = adv.addObject(state, id, P(x, 5));
    hero.pos = P(x, 6);
    hero.movePoints = 1500;
    adv.moveHero(state, hero.id, P(x, 5));
    assert.equal(m.owner, 0, id);
    assert.equal(hero.movePoints, 1400, 'capturing costs only the step');
    x += 5;
  }
  assert.deepEqual(adv.getMineIncome(state, 0), { wood: 2, ore: 2, mercury: 1, sulfur: 1, crystal: 1, gems: 1, gold: 1000 });
  assert.deepEqual(adv.getMineIncome(state, 1), {});
  covered.add('mine');
  // owner revisit does nothing; garrison left by the owner must be beaten
  const t = setup('sawmill');
  t.go();
  assert.deepEqual(visitResults(t.again()), ['already_owned']);
  assert.ok(adv.garrisonTransfer(t.state, t.hero.id, t.obj.id, { from: 'hero', slot: 0, count: 6 }).ok);
  assert.deepEqual(t.obj.data.garrison[0], { creatureId: 'pikeman', count: 6 });
  t.hero.pos = P(0, 0);
  const foe = second(t, 'foe', 1);
  foe.go();
  assert.deepEqual(kinds(t.state), ['confirm_fight']);
  answer(t.state, 0);
  finishCombat(t.state, 'attacker');
  assert.equal(t.obj.owner, 1);
  assert.equal(t.obj.data.garrison, null);
  assert.deepEqual(adv.getMineIncome(t.state, 1), { wood: 2 });
  // abandoned mine
  const a = setup('abandoned_mine', { data: { resource: 'gold' } });
  a.go();
  assert.deepEqual(kinds(a.state), ['confirm_fight']);
  answer(a.state, 0);
  finishCombat(a.state, 'defender', [{ creatureId: 'troglodyte', count: 40 }]);
  assert.equal(a.obj.owner, null);
  assert.equal(a.obj.data.guards[0].count, 40);
  const a2 = setup('abandoned_mine', { data: { resource: 'gold' } });
  a2.go();
  answer(a2.state, 0);
  finishCombat(a2.state, 'attacker');
  assert.equal(a2.obj.owner, 0);
  assert.equal(a2.obj.data.cleared, true);
  assert.deepEqual(adv.getMineIncome(a2.state, 0), { gold: 1000 });
});

test('weekly_reward: first hero of the week takes it; refilled on day 1; water wheel first week; wishing well cost', () => {
  const t = setup('windmill');
  const before = { ...t.player.resources };
  t.go();
  const [res, n] = Object.entries(t.obj.data.reward.resources)[0];
  assert.equal(t.player.resources[res], before[res] + n);
  assert.deepEqual(visitResults(t.again()), ['already_visited']);
  const s = second(t);
  assert.deepEqual(visitResults(s.go()), ['already_visited']);
  // next week
  t.state.turn = 8; t.state.date = { day: 1, week: 2, month: 1 };
  adv.startOfWeekAdventure(t.state);
  assert.deepEqual(visitResults(adv.visitObject(t.state, s.hero.id, t.obj.id)), ['reward']);
  // water wheel: 500 in week 1, 1000 afterwards
  const w = setup('water_wheel');
  const g = gold(w);
  w.go();
  assert.equal(gold(w), g + 500);
  w.state.turn = 8;
  adv.startOfWeekAdventure(w.state);
  w.again();
  assert.equal(gold(w), g + 1500);
  // mystical garden: 5 gems or 500 gold
  const garden = setup('mystical_garden');
  assert.ok(['{"resources":{"gems":5}}', '{"resources":{"gold":500}}'].includes(JSON.stringify(garden.obj.data.reward)));
  // wishing well: pay 100, visit consumed whatever the roll
  const well = setup('wishing_well', { data: { reward: {} } });
  well.go();
  assert.deepEqual(kinds(well.state), ['confirm_pay']);
  answer(well.state, 1);
  assert.ok(well.obj.data.visitedWeek == null, 'declining consumes nothing');
  well.again();
  const g2 = gold(well);
  const out = answer(well.state, 0);
  assert.equal(gold(well), g2 - 100);
  assert.deepEqual(visitResults(out), ['nothing']);
  assert.deepEqual(visitResults(well.again()), ['already_visited']);
});

test('reward_once: first visitor only; warrior tomb confirm + morale penalty, also when empty', () => {
  const t = setup('lean_to', { data: { reward: { resources: { ore: 4 } } } });
  const ore = t.player.resources.ore;
  t.go();
  assert.equal(t.player.resources.ore, ore + 4);
  assert.deepEqual(visitResults(second(t).go()), ['already_visited']);
  assert.equal(t.player.resources.ore, ore + 4);
  const tomb = setup('warriors_tomb', { data: { reward: { artifacts: ['spyglass'] } } });
  tomb.go();
  assert.deepEqual(kinds(tomb.state), ['confirm_search']);
  answer(tomb.state, 1);
  assert.equal(tomb.obj.data.visited, false);
  assert.deepEqual(tomb.hero.temp, []);
  tomb.again();
  answer(tomb.state, 0);
  assert.ok(ownsArtifact(tomb.hero, 'spyglass'));
  assert.deepEqual(tomb.hero.temp, [{ source: 'warriors_tomb', bonus: { type: 'morale', value: -3 }, until: 'next_battle' }]);
  tomb.again();
  const r = answer(tomb.state, 0);
  assert.deepEqual(visitResults(r), ['nothing_left']);
  assert.equal(tomb.hero.temp.length, 2, 'penalty again on an empty tomb');
  // empty roll
  const corpse = setup('corpse', { data: { reward: {} } });
  assert.deepEqual(visitResults(corpse.go()), ['nothing']);
  assert.equal(corpse.obj.data.visited, true);
});

test('bank: confirm, bank combat, reward on victory, survivors persist, no refill, empty penalty', () => {
  const t = setup('griffin_conservatory', { data: { level: 1 } });
  let seen = null;
  adv.setDeps({ startCombat: (st, o) => { seen = o; st.combat = { context: o.context, attackerHeroId: o.attackerHeroId, stub: true }; return { ok: true, events: [] }; } });
  const r = t.go();
  assert.deepEqual(visitResults(r), ['guarded']);
  assert.deepEqual(kinds(t.state), ['confirm_fight']);
  assert.equal(t.state.pending[0].data.guards.filter(Boolean).reduce((n, s) => n + s.count, 0), 100);
  answer(t.state, 1);
  assert.equal(t.state.combat, null);
  assert.equal(t.obj.data.cleared, false);
  t.again();
  answer(t.state, 0);
  assert.equal(seen.bank, true);
  assert.equal(seen.attackerHeroId, t.hero.id);
  assert.equal(seen.terrain, 'grass');
  assert.equal(seen.context.kind, 'adv_object');
  assert.equal(seen.defender.army.filter(Boolean).length, 5);
  // defeat: survivors stay
  const lost = adv.finishStubCombat(t.state, { winner: 'defender', defender: { army: [{ creatureId: 'griffin', count: 33 }, null, null, null, null, null, null] } });
  assert.ok(lost.ok);
  assert.deepEqual(t.obj.data.guards.filter(Boolean), [{ creatureId: 'griffin', count: 33 }]);
  assert.equal(t.obj.data.cleared, false);
  // victory
  t.again();
  assert.equal(t.state.pending[0].data.guards[0].count, 33);
  answer(t.state, 0);
  const won = finishCombat(t.state, 'attacker');
  assert.deepEqual(visitResults(won), ['bank_cleared']);
  assert.deepEqual(t.hero.army.filter(Boolean), [{ creatureId: 'pikeman', count: 10 }, { creatureId: 'angel', count: 2 }]);
  assert.equal(t.obj.data.cleared, true);
  assert.equal(t.obj.data.visited, true);
  // cleared: nothing left; no refill on a new week
  assert.deepEqual(visitResults(t.again()), ['nothing_left']);
  t.state.turn = 8;
  adv.startOfWeekAdventure(t.state);
  assert.equal(t.obj.data.cleared, true);
  assert.deepEqual(visitResults(t.again()), ['nothing_left']);
  // crypt: empty penalty -1 morale; resources reward
  const c = setup('crypt', { data: { level: 0 } });
  const g = gold(c);
  c.go();
  answer(c.state, 0);
  finishCombat(c.state, 'attacker');
  assert.equal(gold(c), g + 1500);
  c.again();
  assert.deepEqual(c.hero.temp, [{ source: 'crypt', bonus: { type: 'morale', value: -1 }, until: 'next_battle' }]);
  // pyramid: level 5 spell only with expert wisdom
  const py = setup('pyramid', { data: { reward: { spell: { spellId: 'implosion', requires: { skillId: 'wisdom', level: 3 } } } } }, { skills: [{ id: 'wisdom', level: 2 }] });
  py.go(); answer(py.state, 0); finishCombat(py.state, 'attacker');
  assert.ok(!py.hero.spells.includes('implosion'));
  assert.equal(py.obj.data.cleared, true);
  const py2 = setup('pyramid', { data: { reward: { spell: { spellId: 'implosion', requires: { skillId: 'wisdom', level: 3 } } } } }, { skills: [{ id: 'wisdom', level: 3 }] });
  py2.go(); answer(py2.state, 0); finishCombat(py2.state, 'attacker');
  assert.ok(py2.hero.spells.includes('implosion'));
  py2.again();
  assert.deepEqual(py2.hero.temp[0].bonus, { type: 'luck', value: -2 });
  // derelict ship from a boat uses the ship battlefield
  const ship = setup('derelict_ship', { data: { level: 0 } });
  adv.setDeps({ startCombat: (st, o) => { seen = o; st.combat = { context: o.context, attackerHeroId: o.attackerHeroId }; return { ok: true, events: [] }; } });
  ship.go(); answer(ship.state, 0);
  assert.equal(seen.terrain, 'ship');
});

test('primary_boost: single stat, arena choice, paid schools; once per hero', () => {
  for (const [id, stat] of [['mercenary_camp', 'attack'], ['marletto_tower', 'defense'], ['star_axis', 'power'], ['garden_of_revelation', 'knowledge']]) {
    const t = setup(id);
    t.go();
    assert.equal(t.hero.primary[stat], 2, id);
    assert.deepEqual(visitResults(t.again()), ['already_visited']);
    assert.equal(t.hero.primary[stat], 2);
    const s = second(t);
    s.go();
    assert.equal(s.hero.primary[stat], 2, 'another hero may still visit');
  }
  const arena = setup('arena');
  arena.go();
  assert.deepEqual(kinds(arena.state), ['primary_choice']);
  assert.deepEqual(arena.state.pending[0].options.map((o) => [o.stat, o.value]), [['attack', 2], ['defense', 2]]);
  answer(arena.state, 1);
  assert.deepEqual(arena.hero.primary, { attack: 1, defense: 3, power: 1, knowledge: 1 });
  assert.deepEqual(visitResults(arena.again()), ['already_visited']);
  const col = setup('colosseum_of_the_magi');
  col.go(); answer(col.state, 0);
  assert.equal(col.hero.primary.power, 3);
  const school = setup('school_of_magic');
  school.go();
  assert.deepEqual(school.state.pending[0].options.map((o) => o.id), ['power', 'knowledge', 'decline']);
  answer(school.state, 2);
  assert.equal(school.hero.visited[school.obj.id], undefined, 'declining does not consume the visit');
  school.again();
  const g = gold(school);
  answer(school.state, 1);
  assert.equal(gold(school), g - 1000);
  assert.equal(school.hero.primary.knowledge, 2);
  const war = setup('school_of_war', {}, {}, { resources: { gold: 500 } });
  assert.deepEqual(visitResults(war.go()), ['cannot_afford']);
  assert.equal(war.again().error, 'cannot_afford');
  assert.equal(war.hero.visited[war.obj.id], undefined);
});

test('exp_boost: learning stone, paid gazebo, per-level hall', () => {
  const t = setup('learning_stone');
  t.go();
  assert.equal(t.hero.exp, 1000);
  assert.deepEqual(visitResults(t.again()), ['already_visited']);
  assert.equal(t.hero.exp, 1000);
  const gz = setup('gazebo');
  gz.go();
  assert.deepEqual(kinds(gz.state), ['confirm_pay']);
  const g = gold(gz);
  answer(gz.state, 0);
  assert.equal(gz.hero.exp, 2000);
  assert.equal(gold(gz), g - 1000);
  const hall = setup('veterans_hall', {}, { level: 6 });
  hall.go();
  assert.equal(hall.hero.exp, 1500);
});

test('level_up: tree of knowledge gives exactly one level, free / gold / gems', () => {
  const free = setup('tree_of_knowledge', { data: { cost: {} } });
  free.go();
  assert.equal(free.hero.level, 2);
  assert.equal(free.hero.exp, expForLevel(2));
  assert.deepEqual(visitResults(free.again()), ['already_visited']);
  const paid = setup('tree_of_knowledge', { data: { cost: { gems: 10 } } }, { level: 4 });
  paid.hero.exp = expForLevel(4) + 300;
  paid.go();
  assert.deepEqual(kinds(paid.state), ['confirm_pay']);
  answer(paid.state, 1);
  assert.equal(paid.hero.level, 4);
  paid.again();
  answer(paid.state, 0);
  assert.equal(paid.player.resources.gems, 0);
  assert.equal(paid.hero.level, 5);
  assert.equal(paid.hero.exp, expForLevel(5));
  const poor = setup('tree_of_knowledge', { data: { cost: { gold: 2000 } } }, {}, { resources: { gold: 100 } });
  assert.deepEqual(visitResults(poor.go()), ['cannot_afford']);
  assert.equal(poor.hero.level, 1);
});

test('library: +2 to all primaries from level 10 (8/6/4 with Diplomacy); not consumed when too low', () => {
  const low = setup('library_of_enlightenment', {}, { level: 9 });
  assert.deepEqual(visitResults(low.go()), ['not_ready']);
  low.hero.level = 10;
  assert.deepEqual(visitResults(low.again()), ['primary_all']);
  assert.deepEqual(low.hero.primary, { attack: 3, defense: 3, power: 3, knowledge: 3 });
  assert.deepEqual(visitResults(low.again()), ['already_visited']);
  for (const [dip, level] of [[1, 8], [2, 6], [3, 4]]) {
    const t = setup('library_of_enlightenment', {}, { level: level - 1, skills: [{ id: 'diplomacy', level: dip }] });
    assert.deepEqual(visitResults(t.go()), ['not_ready']);
    t.hero.level = level;
    assert.deepEqual(visitResults(t.again()), ['primary_all']);
  }
});

test('learn_skill: witch hut, full hero, runestone choice with price, hermit upgrade', () => {
  const t = setup('witch_hut', { data: { skills: ['archery'] } });
  assert.deepEqual(visitResults(t.go()), ['skill_learned']);
  assert.deepEqual(t.hero.skills, [{ id: 'archery', level: 1 }]);
  assert.deepEqual(t.player.visited[`info_${t.obj.id}`], { skills: ['archery'] });
  assert.deepEqual(visitResults(t.again()), ['already_visited']);
  const eight = ['archery', 'offense', 'armorer', 'luck', 'tactics', 'wisdom', 'scouting', 'estates'].map((id) => ({ id, level: 1 }));
  const full = setup('witch_hut', { data: { skills: ['logistics'] } }, { skills: eight });
  assert.deepEqual(visitResults(full.go()), ['skill_not_learned']);
  assert.equal(full.hero.skills.length, 8);
  assert.equal(full.hero.visited[full.obj.id], true, 'visit consumed anyway');
  const rune = setup('runestone', { data: { skills: ['archery', 'offense'] } }, { skills: [{ id: 'archery', level: 1 }] });
  rune.go();
  assert.deepEqual(rune.state.pending[0].options.map((o) => [o.id, o.available]), [['archery', false], ['offense', true], ['decline', undefined]]);
  assert.equal(answer(rune.state, 0).error, 'cannot_learn');
  assert.deepEqual(kinds(rune.state), ['skill_choice'], 'still open after a bad pick');
  const g = gold(rune);
  answer(rune.state, 1);
  assert.equal(gold(rune), g - 1500);
  assert.deepEqual(rune.hero.skills[1], { id: 'offense', level: 1 });
  assert.deepEqual(visitResults(rune.again()), ['already_visited']);
  const rune2 = setup('runestone', { data: { skills: ['archery', 'offense'] } });
  rune2.go(); answer(rune2.state, 2);
  assert.deepEqual(rune2.hero.skills, []);
  assert.equal(rune2.hero.visited[rune2.obj.id], undefined);
  const hermit = setup('hermits_shack', {}, { skills: [{ id: 'archery', level: 3 }, { id: 'offense', level: 2 }] });
  hermit.go();
  assert.deepEqual(hermit.hero.skills, [{ id: 'archery', level: 3 }, { id: 'offense', level: 3 }]);
  assert.deepEqual(visitResults(hermit.again()), ['already_visited']);
  const hermit2 = setup('hermits_shack', {}, { skills: [{ id: 'archery', level: 3 }] });
  assert.deepEqual(visitResults(hermit2.go()), ['nothing']);
  assert.equal(hermit2.hero.visited[hermit2.obj.id], undefined, 'not consumed');
});

test('scholar: primary / skill / spell with the +1 primary fallback; vanishes', () => {
  const p = setup('scholar', { data: { kind: 'primary', stat: 'power' } });
  p.go();
  assert.equal(p.hero.primary.power, 2);
  assert.equal(p.state.map.objects[p.obj.id], undefined);
  assert.deepEqual(p.hero.pos, P(5, 6));
  const s = setup('scholar', { data: { kind: 'skill', skillId: 'tactics' } });
  s.go();
  assert.deepEqual(s.hero.skills, [{ id: 'tactics', level: 1 }]);
  const sum = (h) => Object.values(h.primary).reduce((a, b) => a + b, 0);
  const s2 = setup('scholar', { data: { kind: 'skill', skillId: 'tactics' } }, { skills: [{ id: 'tactics', level: 1 }] });
  assert.deepEqual(visitResults(s2.go()), ['skill_upgraded']);
  assert.deepEqual(s2.hero.skills, [{ id: 'tactics', level: 2 }], 'known below Expert -> one level up');
  assert.equal(sum(s2.hero), 4);
  const s3 = setup('scholar', { data: { kind: 'skill', skillId: 'tactics' } }, { skills: [{ id: 'tactics', level: 3 }] });
  s3.go();
  assert.equal(sum(s3.hero), 5, 'already Expert -> +1 random primary');
  const full = ['archery', 'offense', 'armorer', 'luck', 'logistics', 'scouting', 'wisdom', 'mysticism'].map((id) => ({ id, level: 1 }));
  const s4 = setup('scholar', { data: { kind: 'skill', skillId: 'tactics' } }, { skills: full });
  s4.go();
  assert.equal(sum(s4.hero), 5, 'no free slot -> +1 random primary');
  const sp = setup('scholar', { data: { kind: 'spell', spellId: 'haste' } });
  sp.go();
  assert.ok(sp.hero.spells.includes('haste'));
  const sp2 = setup('scholar', { data: { kind: 'spell', spellId: 'implosion' } });
  sp2.go();
  assert.ok(!sp2.hero.spells.includes('implosion'));
  assert.equal(sum(sp2.hero), 5, 'no wisdom -> +1 random primary');
  const sp3 = setup('scholar', { data: { kind: 'spell', spellId: 'haste' } }, { noBook: true });
  sp3.go();
  assert.equal(sum(sp3.hero), 5, 'no spell book -> +1 random primary');
});

test('university: buy Basic skills for 2000 gold each; dialog stays open', () => {
  const t = setup('university', { data: { skills: ['archery', 'offense', 'armorer', 'luck'] } }, { skills: [{ id: 'luck', level: 2 }] });
  t.go();
  assert.deepEqual(kinds(t.state), ['university']);
  assert.deepEqual(t.state.pending[0].options.map((o) => o.available), [true, true, true, false, undefined]);
  const g = gold(t);
  assert.ok(answer(t.state, 0).ok);
  assert.deepEqual(kinds(t.state), ['university']);
  assert.equal(t.state.pending[0].options[0].available, false);
  assert.equal(answer(t.state, 0).error, 'cannot_learn');
  assert.equal(answer(t.state, 3).error, 'cannot_learn');
  answer(t.state, 2);
  assert.equal(gold(t), g - 4000);
  assert.deepEqual(t.hero.skills.map((s) => s.id), ['luck', 'archery', 'armorer']);
  answerId(t.state, 'leave');
  assert.deepEqual(kinds(t.state), []);
  t.player.resources.gold = 100;
  t.again();
  assert.equal(answer(t.state, 1).error, 'cannot_afford');
});

test('learn_spell: shrines need a book and Wisdom; a failed visit is not consumed', () => {
  const t = setup('shrine_of_magic_incantation', { data: { spellId: 'haste' } });
  assert.deepEqual(visitResults(t.go()), ['spell_learned']);
  assert.ok(t.hero.spells.includes('haste'));
  assert.deepEqual(visitResults(t.again()), ['already_visited']);
  const nb = setup('shrine_of_magic_gesture', { data: { spellId: 'visions' } }, { noBook: true });
  const r = nb.go();
  assert.deepEqual(visitResults(r), ['cannot_learn']);
  assert.equal(r.events.find((e) => e.type === 'visit').reason, 'no_spellbook');
  assert.deepEqual(nb.player.visited[`info_${nb.obj.id}`], { spellId: 'visions' }, 'the player still learns what it holds');
  assert.equal(nb.hero.visited[nb.obj.id], undefined);
  const spell3 = 'teleport';
  assert.equal(getSpell(spell3).level, 3);
  const w = setup('shrine_of_magic_thought', { data: { spellId: spell3 } });
  assert.equal(w.go().events.find((e) => e.type === 'visit').reason, 'needs_wisdom');
  w.hero.skills.push({ id: 'wisdom', level: 1 });
  assert.deepEqual(visitResults(w.again()), ['spell_learned']);
  const m = setup('shrine_of_magic_mystery', { data: { spellId: 'town_portal' } }, { skills: [{ id: 'wisdom', level: 1 }] });
  assert.deepEqual(visitResults(m.go()), ['cannot_learn']);
  m.hero.skills[0].level = 2;
  assert.deepEqual(visitResults(m.again()), ['spell_learned']);
});

test('altar_of_sacrifice: good heroes offer artifacts, evil heroes creatures', () => {
  const good = setup('altar_of_sacrifice'); // christian = castle knight
  good.hero.artifacts.backpack.push('spyglass', 'boots_of_speed');
  good.go();
  assert.deepEqual(kinds(good.state), ['altar']);
  assert.deepEqual([good.state.pending[0].data.canArtifacts, good.state.pending[0].data.canCreatures], [true, false]);
  assert.equal(answer(good.state, 0, { creatures: [{ slot: 0, count: 1 }] }).error, 'cannot_sacrifice_creatures');
  assert.equal(answer(good.state, 0, { artifacts: ['spellbook'] }).error, 'bad_artifact');
  assert.equal(answer(good.state, 0, { artifacts: ['catapult'] }).error, 'bad_artifact');
  assert.ok(answer(good.state, 0, { artifacts: ['spyglass', 'boots_of_speed'] }).ok);
  assert.equal(good.hero.exp, getArtifact('spyglass').cost + getArtifact('boots_of_speed').cost);
  assert.deepEqual(good.hero.artifacts.backpack, []);
  assert.deepEqual(kinds(good.state), ['altar']);
  answerId(good.state, 'leave');
  const evil = setup('altar_of_sacrifice', {}, { defId: 'galthran', army: [{ creatureId: 'skeleton', count: 20 }, { creatureId: 'vampire', count: 3 }] });
  evil.go();
  assert.deepEqual([evil.state.pending[0].data.canArtifacts, evil.state.pending[0].data.canCreatures], [false, true]);
  assert.equal(answer(evil.state, 0, { creatures: [{ slot: 0, count: 20 }, { slot: 1, count: 3 }] }).error, 'last_creature');
  answer(evil.state, 0, { creatures: [{ slot: 0, count: 10 }, { slot: 1, count: 3 }] });
  const per = (id) => Math.floor(getCreature(id).aiValue / 40) * 5;
  assert.equal(evil.hero.exp, 10 * per('skeleton') + 3 * per('vampire'));
  assert.deepEqual(evil.hero.army.filter(Boolean), [{ creatureId: 'skeleton', count: 10 }]);
});

test('temp_bonus: per-battle rule by definition id, day variants, random, movement, stables', () => {
  const t = setup('faerie_ring');
  t.go();
  assert.deepEqual(t.hero.temp, [{ source: 'faerie_ring', bonus: { type: 'luck', value: 1 }, until: 'next_battle' }]);
  assert.deepEqual(visitResults(t.again()), ['already_visited']);
  // another instance of the same definition is refused too, until the bonus is gone (after a battle)
  const ring2 = adv.addObject(t.state, 'faerie_ring', P(9, 9));
  t.hero.pos = P(9, 10); t.hero.movePoints = 1500;
  assert.deepEqual(visitResults(adv.moveHero(t.state, t.hero.id, P(9, 9))), ['already_visited']);
  t.hero.temp = [];
  assert.deepEqual(visitResults(adv.visitObject(t.state, t.hero.id, ring2.id)), ['temp_bonus']);
  // idol of fortune by day of week
  for (const [day, expected] of [[1, ['luck']], [2, ['morale']], [3, ['luck']], [6, ['morale']], [7, ['luck', 'morale']]]) {
    const idol = setup('idol_of_fortune');
    idol.state.date.day = day;
    idol.go();
    assert.deepEqual(idol.hero.temp.map((x) => x.bonus.type), expected, `day ${day}`);
  }
  const temple = setup('temple');
  temple.state.date.day = 7;
  temple.go();
  assert.equal(temple.hero.temp[0].bonus.value, 2);
  // fountain of fortune -1..+3, even a 0 counts as a visit
  const lucks = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const f = setup('fountain_of_fortune', {}, {}, { seed });
    f.go();
    lucks.add(f.hero.temp[0].bonus.value);
    assert.deepEqual(visitResults(f.again()), ['already_visited']);
  }
  assert.deepEqual([...lucks].sort((a, b) => a - b), [-1, 0, 1, 2, 3]);
  // instant movement
  for (const [id, pts] of [['fountain_of_youth', 400], ['rally_flag', 400], ['oasis', 800], ['watering_hole', 400], ['mineral_spring', 600]]) {
    const o = setup(id, {}, { movePoints: 1000 });
    o.go();
    assert.equal(o.hero.movePoints, 1000 - 100 + pts, id);
  }
  const swan = setup('swan_pond');
  swan.go();
  assert.equal(swan.hero.movePoints, 0);
  assert.equal(swan.hero.temp[0].bonus.value, 2);
  // stables: weekly per hero, cavaliers upgraded
  const st = setup('stables', {}, { army: [{ creatureId: 'cavalier', count: 5 }, { creatureId: 'pikeman', count: 5 }], movePoints: 1000 });
  st.go();
  assert.equal(st.hero.movePoints, 1300);
  assert.deepEqual(st.hero.temp, [{ source: 'stables', bonus: { type: 'movement_land', value: 400 }, until: 'end_of_week' }]);
  assert.equal(st.hero.army[0].creatureId, 'champion');
  assert.deepEqual(visitResults(st.again()), ['already_visited']);
  st.state.turn = 8;
  assert.deepEqual(visitResults(st.again()), ['temp_bonus']);
  // paid fortune teller; daily totem
  const ft = setup('fortune_teller');
  ft.go();
  assert.deepEqual(kinds(ft.state), ['confirm_pay']);
  const g = gold(ft);
  answer(ft.state, 0);
  assert.equal(gold(ft), g - 100);
  assert.equal(ft.hero.temp.length, 1);
  const totem = setup('tailwind_totem', {}, { movePoints: 1000 });
  totem.go();
  assert.equal(totem.hero.movePoints, 1500);
  assert.deepEqual(visitResults(totem.again()), ['already_visited']);
  totem.state.turn = 2;
  assert.deepEqual(visitResults(totem.again()), ['temp_bonus']);
});

test('mana_restore: magic well (daily, full), magic spring (weekly, double), moon well (add)', () => {
  const well = setup('magic_well', {}, { mana: 3, primary: { knowledge: 2 } });
  well.go();
  assert.equal(well.hero.mana, 20);
  assert.deepEqual(visitResults(well.again()), ['already_visited']);
  well.state.turn = 2;
  assert.deepEqual(visitResults(well.again()), ['already_full'], 'new day but nothing to refill');
  well.hero.mana = 5;
  assert.deepEqual(visitResults(well.again()), ['mana']);
  const spring = setup('magic_spring', {}, { mana: 3, primary: { knowledge: 2 } });
  spring.go();
  assert.equal(spring.hero.mana, 40);
  const s = second(spring);
  assert.deepEqual(visitResults(s.go()), ['already_visited'], 'object-wide weekly');
  spring.state.turn = 8;
  s.hero.movePoints = 1500;
  assert.deepEqual(visitResults(adv.visitObject(spring.state, s.hero.id, spring.obj.id)), ['mana']);
  const moon = setup('moon_well', {}, { mana: 10 });
  moon.go();
  assert.equal(moon.hero.mana, 35, 'may exceed the maximum');
});

test('market: trading post rates (5 marketplaces) and freelancer guild', () => {
  const t = setup('trading_post');
  t.go();
  assert.deepEqual(kinds(t.state), ['trade']);
  const r0 = { ...t.player.resources };
  assert.ok(answer(t.state, 0, { mode: 'resource_resource', give: 'wood', get: 'gold', amount: 4 }).ok);
  assert.equal(t.player.resources.wood, r0.wood - 4);
  assert.equal(t.player.resources.gold, r0.gold + 300, '75 gold per wood');
  answer(t.state, 0, { mode: 'resource_resource', give: 'gold', get: 'gems', amount: 2 });
  assert.equal(t.player.resources.gold, r0.gold + 300 - 2 * 1667);
  assert.equal(t.player.resources.gems, r0.gems + 2);
  answer(t.state, 0, { mode: 'resource_resource', give: 'wood', get: 'mercury', amount: 1 });
  assert.equal(t.player.resources.wood, r0.wood - 4 - 7, '7 wood per rare resource');
  assert.equal(answer(t.state, 0, { mode: 'resource_resource', give: 'wood', get: 'gold', amount: 999 }).error, 'cannot_afford');
  assert.equal(answer(t.state, 0, { mode: 'creature_resource', slot: 0 }).error, 'bad_mode');
  answer(t.state, 0, { mode: 'resource_player', give: 'ore', amount: 5, toPlayer: 1 });
  assert.equal(t.state.players[1].resources.ore, 25);
  assert.deepEqual(kinds(t.state), ['trade']);
  answerId(t.state, 'leave');
  const f = setup('freelancers_guild', {}, { army: [{ creatureId: 'swordsman', count: 10 }] });
  f.go();
  const g = gold(f);
  assert.equal(answer(f.state, 0, { mode: 'creature_resource', slot: 0, count: 10, get: 'gold' }).error, 'last_creature');
  assert.ok(answer(f.state, 0, { mode: 'creature_resource', slot: 0, count: 4, get: 'gold' }).ok);
  assert.equal(f.hero.army[0].count, 6);
  // rate shared with the town Freelancer's Guild (data/buildings.js), at the object's 5 marketplaces
  const rate = freelancerRate(getCreature('swordsman').cost.gold, 'gold', 5);
  assert.equal(rate.give, 1);
  assert.equal(gold(f), g + 4 * rate.get);
});

test('black_market: buy artifacts for their gold value; slots stay empty until the restock', () => {
  const t = setup('black_market', { data: { stock: ['spyglass', 'boots_of_speed', null, null, null, null, null] } });
  t.go();
  assert.deepEqual(kinds(t.state), ['buy_artifact']);
  assert.deepEqual(t.state.pending[0].options.map((o) => o.artifactId), ['spyglass', 'boots_of_speed', undefined]);
  const g = gold(t);
  answer(t.state, 1);
  assert.equal(gold(t), g - getArtifact('boots_of_speed').cost);
  assert.ok(ownsArtifact(t.hero, 'boots_of_speed'));
  assert.deepEqual(t.obj.data.stock.slice(0, 2), ['spyglass', null]);
  assert.deepEqual(t.state.pending[0].options.map((o) => o.id), ['buy', 'leave']);
  t.player.resources.gold = 10;
  assert.equal(answer(t.state, 0).error, 'cannot_afford');
  answerId(t.state, 'leave');
  // monthly restock
  t.state.turn = 8;
  adv.startOfWeekAdventure(t.state);
  assert.equal(t.obj.data.stock[1], null, 'no restock in week 2');
  t.state.turn = 29;
  adv.startOfWeekAdventure(t.state);
  assert.equal(t.obj.data.stock.filter(Boolean).length, 7);
  const den = setup('smugglers_den');
  assert.equal(den.obj.data.stock.length, 3);
  den.obj.data.stock = [null, null, null];
  den.state.turn = 8;
  adv.startOfWeekAdventure(den.state);
  assert.equal(den.obj.data.stock.filter(Boolean).length, 3, 'weekly restock');
});

test('refugee_camp: one creature type a week, one week of growth, normal price', () => {
  const t = setup('refugee_camp', { data: { creatureId: 'archer', count: 9 } });
  t.go();
  assert.deepEqual(kinds(t.state), ['recruit']);
  assert.deepEqual(t.state.pending[0].options[0], { id: 'recruit', label: 'Archer', creatureId: 'archer', available: 9, cost: { gold: 100 } });
  const g = gold(t);
  answer(t.state, 0, { count: 4 });
  assert.equal(gold(t), g - 400);
  assert.equal(t.obj.data.count, 5);
  assert.equal(answer(t.state, 0, { count: 6 }).error, 'bad_amount');
  answer(t.state, 0); // all that is left / affordable
  assert.equal(t.obj.data.count, 0);
  assert.deepEqual(t.hero.army.filter(Boolean), [{ creatureId: 'pikeman', count: 10 }, { creatureId: 'archer', count: 9 }]);
  assert.deepEqual(kinds(t.state), [], 'sold out closes the dialog');
  assert.deepEqual(visitResults(t.again()), ['sold_out']);
  t.state.turn = 8;
  adv.startOfWeekAdventure(t.state);
  assert.equal(t.obj.data.count, getCreature(t.obj.data.creatureId).growth);
  const bm = setup('beastmaster_camp', { data: { creatureId: 'griffin', count: 3 } });
  bm.go();
  assert.deepEqual(bm.state.pending[0].options[0].cost, { gold: 160 }, '80% price');
});

test('tavern: hire one of the two tavern heroes for 2500 gold onto a free adjacent tile', () => {
  const t = setup('tavern');
  t.player.tavernHeroes = ['orrin', 'valeska'];
  t.go();
  assert.deepEqual(kinds(t.state), ['tavern']);
  assert.deepEqual(t.state.pending[0].options.map((o) => o.heroDefId || o.id), ['orrin', 'valeska', 'leave']);
  const g = gold(t);
  const res = answer(t.state, 1);
  assert.ok(res.ok, res.error);
  assert.equal(gold(t), g - 2500);
  const hired = Object.values(t.state.heroes).find((h) => h.defId === 'valeska');
  assert.equal(hired.owner, 0);
  assert.equal(Math.max(Math.abs(hired.pos.x - 5), Math.abs(hired.pos.y - 5)), 1);
  assert.equal(adv.getTile(t.state.map, hired.pos).blocked, false);
  assert.deepEqual(t.player.tavernHeroes, ['orrin', null]);
  assert.ok(t.player.heroes.includes(hired.id));
  t.player.resources.gold = 0;
  assert.equal(answer(t.state, 0).error, 'cannot_afford');
  t.player.resources.gold = 9999;
  t.player.heroes = new Array(8).fill('x');
  assert.equal(answer(t.state, 0).error, 'too_many_heroes');
});

test('war_machine_factory: ballista 2500, ammo cart 1000, first aid tent 750; one each', () => {
  const t = setup('war_machine_factory');
  t.hero.artifacts.equipped.war_machine[0] = null; // Christian starts with a ballista
  t.go();
  assert.deepEqual(t.state.pending[0].options.map((o) => [o.artifactId, o.cost?.gold, o.available]), [['ballista', 2500, true], ['ammo_cart', 1000, true], ['first_aid_tent', 750, true], [undefined, undefined, undefined]]);
  const g = gold(t);
  answer(t.state, 0); answer(t.state, 1); answer(t.state, 2);
  assert.equal(gold(t), g - 4250);
  for (const id of ['ballista', 'ammo_cart', 'first_aid_tent']) assert.ok(hasArtifact(t.hero, id));
  assert.equal(answer(t.state, 0).error, 'already_owned');
  assert.equal(gold(t), g - 4250);
});

test('thieves_guild: shows the comparison table, no state change', () => {
  const t = setup('den_of_thieves');
  addHero(t.state, { pos: P(12, 9), owner: 1, id: 'foe', level: 7 });
  t.go();
  const snapshot = JSON.stringify(t.state);
  const r = t.again();
  const ev = r.events.find((e) => e.type === 'thieves_guild');
  assert.equal(ev.table.length, 2);
  assert.deepEqual(Object.keys(ev.table[0]).sort(), ['armyStrength', 'artifacts', 'bestHero', 'gold', 'heroes', 'mines', 'obelisks', 'playerId', 'rare', 'towns', 'woodOre']);
  assert.equal(ev.table[1].bestHero.level, 7);
  assert.equal(ev.table[0].armyStrength, 10 * getCreature('pikeman').aiValue);
  assert.equal(JSON.stringify(t.state), snapshot);
});

test('sanctuary: plain visit event', () => {
  const t = setup('sanctuary');
  assert.deepEqual(visitResults(t.go()), ['sanctuary']);
  assert.deepEqual(t.hero.pos, P(5, 5));
});

test('prison: the captive joins on the prison tile with 0 movement; no room with 8 heroes', () => {
  const t = setup('prison', { data: { heroDefId: 'orrin', exp: 5000 } });
  const r = t.go();
  assert.deepEqual(t.hero.pos, P(5, 6), 'the visitor stays outside');
  const freed = Object.values(t.state.heroes).find((h) => h.defId === 'orrin');
  assert.deepEqual(freed.pos, P(5, 5));
  assert.equal(freed.owner, 0);
  assert.equal(freed.movePoints, 0);
  assert.ok(freed.level > 1);
  assert.equal(t.state.map.objects[t.obj.id], undefined);
  assert.ok(eventTypes(r).includes('hero_freed'));
  const full = setup('prison', { data: { heroDefId: 'orrin' } });
  full.player.heroes = new Array(8).fill(full.hero.id);
  assert.deepEqual(visitResults(full.go()), ['no_room']);
  assert.ok(full.state.map.objects[full.obj.id]);
});

test('hill_fort: tier discounts (free / 25 / 50 / 75 / 100 %)', () => {
  const army = [{ creatureId: 'pikeman', count: 10 }, { creatureId: 'archer', count: 10 }, { creatureId: 'griffin', count: 4 }, { creatureId: 'swordsman', count: 4 }, { creatureId: 'angel', count: 1 }, { creatureId: 'champion', count: 2 }];
  const t = setup('hill_fort', {}, { army });
  t.go();
  assert.deepEqual(kinds(t.state), ['upgrade_creatures']);
  const opts = t.state.pending[0].options;
  const diff = (a, b) => getCreature(b).cost.gold - getCreature(a).cost.gold;
  assert.deepEqual(opts.map((o) => o.to), ['halberdier', 'marksman', 'royal_griffin', 'crusader', 'arch_angel', undefined]);
  assert.deepEqual(opts[0].cost, {});
  assert.equal(opts[1].cost.gold, Math.floor(10 * diff('archer', 'marksman') * 0.25));
  assert.equal(opts[2].cost.gold, Math.floor(4 * diff('griffin', 'royal_griffin') * 0.5));
  assert.equal(opts[3].cost.gold, Math.floor(4 * diff('swordsman', 'crusader') * 0.75));
  assert.equal(opts[4].cost.gold, diff('angel', 'arch_angel'));
  assert.equal(opts[4].cost.gems, getCreature('arch_angel').cost.gems - (getCreature('angel').cost.gems || 0));
  const g = gold(t);
  answer(t.state, 0);
  assert.equal(t.hero.army[0].creatureId, 'halberdier');
  assert.equal(gold(t), g);
  answer(t.state, 0); // now the archers are first
  assert.equal(t.hero.army[1].creatureId, 'marksman');
  assert.equal(gold(t), g - opts[1].cost.gold);
  t.player.resources.gems = 0;
  assert.equal(answerId(t.state, 'upgrade', undefined, (o) => o.from === 'angel').error, 'cannot_afford');
  assert.equal(t.hero.army[4].creatureId, 'angel');
});

test('lighthouse: flaggable, +500 sea movement for every hero of the owner', () => {
  const t = setup('lighthouse');
  assert.equal(adv.maxMovePointsFor(t.state, t.hero, true), 1500);
  t.go();
  assert.equal(t.obj.owner, 0);
  assert.equal(adv.maxMovePointsFor(t.state, t.hero, true), 2000);
  assert.deepEqual(visitResults(t.again()), ['already_owned']);
  const foe = second(t, 'foe', 1);
  t.hero.pos = P(0, 0);
  foe.go();
  assert.equal(t.obj.owner, 1);
  assert.equal(adv.maxMovePointsFor(t.state, t.hero, true), 1500);
});

test('shipyard: flag and offer a boat (details in transport tests)', () => {
  const t = setup('shipyard');
  fillRect(t.state, 7, 0, 15, 11, { t: 'water' });
  t.go();
  assert.equal(t.obj.owner, 0);
  assert.deepEqual(kinds(t.state), ['build_boat']);
  answer(t.state, 1);
  assert.equal(Object.values(t.state.map.objects).filter((o) => o.defId === 'boat').length, 0);
});

test('reveal_map: observatory radius, cartographer for gold, hut of the magi; once per player', () => {
  const t = setup('redwood_observatory', {}, {}, { width: 60, height: 60 });
  const r = t.go();
  assert.ok(adv.isExplored(t.state, 0, P(5, 25)));
  assert.ok(adv.isExplored(t.state, 0, P(25, 5)));
  assert.ok(!adv.isExplored(t.state, 0, P(5, 26)));
  assert.ok(!adv.isExplored(t.state, 0, P(20, 20)), 'a disc, not a square');
  assert.ok(!adv.isExplored(t.state, 1, P(6, 6)));
  assert.ok(r.events.find((e) => e.result === 'map_revealed').tiles > 400);
  assert.deepEqual(visitResults(t.again()), ['already_visited']);
  assert.deepEqual(visitResults(second(t).go()), ['already_visited'], 'per player');
  const w = setup('watchtower', {}, {}, { width: 60, height: 60 });
  w.go();
  assert.ok(adv.isExplored(w.state, 0, P(5, 17)) && !adv.isExplored(w.state, 0, P(5, 18)));
  // cartographer
  const c = setup('cartographer_sea', {}, {}, { width: 40, height: 40 });
  fillRect(c.state, 30, 0, 39, 39, { t: 'water' });
  c.go();
  assert.deepEqual(kinds(c.state), ['confirm_pay']);
  const g = gold(c);
  answer(c.state, 0);
  assert.equal(gold(c), g - 1000);
  assert.ok(adv.isExplored(c.state, 0, P(35, 35)));
  assert.ok(!adv.isExplored(c.state, 0, P(25, 35)));
  const land = setup('cartographer_land', {}, {}, { width: 40, height: 40, levels: 2 });
  fillRect(land.state, 30, 0, 39, 39, { t: 'water' });
  land.go(); answer(land.state, 0);
  assert.ok(adv.isExplored(land.state, 0, P(25, 35)));
  assert.ok(!adv.isExplored(land.state, 0, P(35, 35)));
  assert.ok(!adv.isExplored(land.state, 0, P(25, 35, 1)));
  const under = setup('cartographer_underground', {}, {}, { width: 40, height: 40, levels: 2 });
  under.go(); answer(under.state, 0);
  assert.ok(adv.isExplored(under.state, 0, P(25, 35, 1)));
  assert.ok(!adv.isExplored(under.state, 0, P(25, 35, 0)));
  // hut of the magi -> eyes of the magi, repeatable
  const hut = setup('hut_of_the_magi', {}, {}, { width: 60, height: 60 });
  adv.addObject(hut.state, 'eye_of_the_magi', P(40, 40));
  adv.addObject(hut.state, 'eye_of_the_magi', P(50, 10));
  hut.go();
  assert.ok(adv.isExplored(hut.state, 0, P(40, 50)) && adv.isExplored(hut.state, 0, P(45, 10)));
  assert.ok(!adv.isExplored(hut.state, 0, P(40, 51)));
  assert.deepEqual(visitResults(hut.again()), ['map_revealed']);
  const chart = setup('star_chart', {}, {}, { width: 60, height: 60 });
  adv.addObject(chart.state, 'obelisk', P(30, 30));
  chart.go();
  assert.ok(adv.isExplored(chart.state, 0, P(30, 33)) && !adv.isExplored(chart.state, 0, P(30, 34)));
});

test('hide_map: cover of darkness shrouds everybody else except what they currently see', () => {
  const t = setup('cover_of_darkness', {}, {}, { width: 60, height: 60 });
  const foe = addHero(t.state, { pos: P(10, 10), owner: 1, id: 'foe' });
  adv.revealWhere(t.state, 1, () => true);
  adv.revealWhere(t.state, 0, () => true);
  const r = t.go();
  assert.ok(adv.isExplored(t.state, 0, P(6, 6)), 'the visitor keeps its map');
  assert.ok(!adv.isExplored(t.state, 1, P(5, 20)));
  assert.ok(!adv.isExplored(t.state, 1, P(20, 5)));
  assert.ok(adv.isExplored(t.state, 1, P(5, 26)), 'outside the radius');
  assert.ok(adv.isExplored(t.state, 1, P(10, 12)), 'still seen by its hero');
  assert.ok(r.events.find((e) => e.result === 'map_hidden').hidden[1] > 300);
  void foe;
  assert.deepEqual(visitResults(t.again()), ['map_hidden'], 'always revisitable');
});

test('obelisk: per player, puzzle pieces = floor(48 * visited / total); see grail tests', () => {
  const t = setup('obelisk');
  adv.addObject(t.state, 'obelisk', P(10, 5));
  adv.addObject(t.state, 'obelisk', P(12, 5));
  const r = t.go();
  assert.deepEqual(visitResults(r), ['obelisk']);
  assert.equal(r.events.find((e) => e.type === 'visit').progress.piecesRemoved, 16);
  assert.deepEqual(visitResults(second(t).go()), ['already_visited']);
  assert.equal(adv.getPuzzleProgress(t.state, 1).piecesRemoved, 0);
});

test('message: signs stay, ocean bottles vanish', () => {
  const t = setup('sign', { data: { text: 'Here be dragons' } });
  const r = t.go();
  assert.deepEqual(r.events.filter((e) => e.type === 'message').map((e) => e.text), ['Here be dragons']);
  assert.ok(t.state.map.objects[t.obj.id]);
  assert.equal(t.again().events[0].text, 'Here be dragons');
  const b = setup('ocean_bottle', { data: { text: 'Help' } });
  const rb = b.go();
  assert.equal(rb.events.find((e) => e.type === 'message').text, 'Help');
  assert.equal(b.state.map.objects[b.obj.id], undefined);
});

test('quest_guard: steps aside (and takes the goods) once its quest is fulfilled', () => {
  const t = setup('quest_guard', { data: { quest: { type: 'bring_resources', resources: { gold: 3000, gems: 2 } } } });
  t.player.resources.gems = 1;
  const r = t.go();
  assert.deepEqual(visitResults(r), ['quest']);
  assert.deepEqual(t.hero.pos, P(5, 6));
  assert.equal(adv.findPath(t.state, t.hero.id, P(5, 4)) !== null, true, 'open field: can walk around');
  t.player.resources.gems = 5;
  t.again();
  assert.deepEqual(kinds(t.state), ['confirm_quest']);
  answer(t.state, 1);
  assert.ok(t.state.map.objects[t.obj.id]);
  t.again();
  const g = gold(t);
  answer(t.state, 0);
  assert.equal(gold(t), g - 3000);
  assert.equal(t.player.resources.gems, 3);
  assert.equal(t.state.map.objects[t.obj.id], undefined);
  assert.deepEqual(t.hero.pos, P(5, 6), 'the hero does not move');
});

test('border_guard / keymaster_tent are covered in transport tests', () => {
  const t = setup('border_guard_white');
  assert.deepEqual(visitResults(t.go()), ['no_key']);
  const k = setup('keymasters_tent_white');
  k.go();
  assert.ok(adv.hasKey(k.state, 0, 'white'));
  const gate = setup('border_gate_white');
  assert.equal(gate.go().error, 'no_path');
});

test('seer_hut: all nine quest types', () => {
  const quests = [
    [{ type: 'reach_level', level: 5 }, (t) => { t.hero.level = 5; }],
    [{ type: 'reach_primary', stats: { attack: 4, power: 2 } }, (t) => { t.hero.primary.attack = 4; t.hero.primary.power = 2; }],
    [{ type: 'kill_hero', heroId: 'villain' }, (t) => { t.player.visited.killed_hero_villain = true; }],
    [{ type: 'kill_monster', objectId: 'o77' }, (t) => { t.player.visited.killed_o77 = true; }],
    [{ type: 'bring_artifacts', artifactIds: ['spyglass', 'speculum'] }, (t) => { t.hero.artifacts.backpack.push('spyglass', 'speculum'); }, (t) => assert.ok(!ownsArtifact(t.hero, 'spyglass') && !ownsArtifact(t.hero, 'speculum'))],
    [{ type: 'bring_creatures', creatures: [{ creatureId: 'pikeman', count: 8 }] }, (t) => { t.hero.army[1] = { creatureId: 'archer', count: 1 }; }, (t) => assert.equal(t.hero.army[0].count, 2)],
    [{ type: 'bring_resources', resources: { wood: 15 } }, (t) => { t.player.resources.wood = 15; }, (t) => assert.equal(t.player.resources.wood, 0)],
    [{ type: 'be_hero', heroDefId: 'orrin' }, (t) => { t.hero.defId = 'orrin'; }],
    [{ type: 'be_player', playerId: 3 }, (t) => { t.hero.owner = 3; t.state.players.push({ ...t.player, id: 3, visited: {}, resources: { ...t.player.resources } }, { id: 9 }); t.state.players[2].id = 3; t.state.currentPlayer = 2; }],
  ];
  assert.equal(quests.length, 9);
  for (const [quest, fulfil, check] of quests) {
    const t = setup('seers_hut', { data: { quest, reward: { exp: 4000 } } }, quest.type === 'bring_resources' ? {} : {}, {});
    if (quest.type === 'bring_resources') t.player.resources.wood = 3;
    if (quest.type === 'bring_creatures') t.hero.army[0].count = 8; // would leave nobody
    const first = t.go();
    assert.deepEqual(visitResults(first), ['quest'], quest.type);
    assert.equal(first.events.find((e) => e.type === 'visit').first, true);
    assert.equal(t.player.visited[t.obj.id], true);
    if (quest.type === 'bring_creatures') t.hero.army[0].count = 10;
    fulfil(t);
    const r = t.again();
    assert.deepEqual(visitResults(r), ['confirm_quest'], `${quest.type}: ${JSON.stringify(r)}`);
    answer(t.state, 0);
    assert.equal(t.hero.exp, 4000, quest.type);
    assert.equal(t.obj.data.completed, true);
    if (check) check(t);
    assert.deepEqual(visitResults(t.again()), ['inert']);
  }
});

test('seer_hut: all ten reward types, decline, deadline', () => {
  const rewards = [
    [{ exp: 2500 }, (t) => assert.equal(t.hero.exp, 2500)],
    [{ mana: 30 }, (t) => assert.equal(t.hero.mana, 40)],
    [{ morale: 2 }, (t) => assert.deepEqual(t.hero.temp, [{ source: 'seers_hut', bonus: { type: 'morale', value: 2 }, until: 'next_battle' }])],
    [{ luck: 1 }, (t) => assert.deepEqual(t.hero.temp[0].bonus, { type: 'luck', value: 1 })],
    [{ resources: { gold: 5000, crystal: 3 } }, (t) => assert.equal(t.player.resources.crystal, 13)],
    [{ primary: { defense: 3 } }, (t) => assert.equal(t.hero.primary.defense, 4)],
    [{ skill: { id: 'tactics', level: 2 } }, (t) => assert.deepEqual(t.hero.skills, [{ id: 'tactics', level: 2 }])],
    [{ artifact: 'boots_of_speed' }, (t) => assert.ok(ownsArtifact(t.hero, 'boots_of_speed'))],
    [{ spell: 'haste' }, (t) => assert.ok(t.hero.spells.includes('haste'))],
    [{ creatures: [{ creatureId: 'archer', count: 12 }] }, (t) => assert.deepEqual(t.hero.army[1], { creatureId: 'archer', count: 12 })],
  ];
  assert.equal(rewards.length, 10);
  for (const [reward, check] of rewards) {
    const t = setup('seers_hut', { data: { quest: { type: 'reach_level', level: 1 }, reward } });
    t.go();
    answer(t.state, 0);
    check(t);
  }
  const d = setup('seers_hut', { data: { quest: { type: 'reach_level', level: 1 }, reward: { exp: 100 } } });
  d.go();
  answer(d.state, 1);
  assert.equal(d.obj.data.completed, false);
  assert.equal(d.hero.exp, 0);
  const late = setup('seers_hut', { data: { quest: { type: 'reach_level', level: 1 }, reward: { exp: 100 }, deadline: 14 } });
  late.state.turn = 15;
  assert.deepEqual(visitResults(late.go()), ['inert']);
});

test('garrison / teleport / boat / town / monster types are exercised (details in their own suites)', () => {
  const g = setup('garrison');
  g.go();
  assert.equal(g.obj.owner, 0);
  const tp = setup('monolith_two_way_green');
  assert.deepEqual(visitResults(tp.go()), ['no_exit']);
  const s = makeState();
  fillRect(s, 5, 0, 15, 11, { t: 'water' });
  const h = addHero(s, { pos: P(4, 5) });
  const boat = adv.addObject(s, 'boat', P(5, 5));
  covered.add('boat');
  adv.moveHero(s, h.id, P(5, 5));
  assert.equal(boat.data.heroId, h.id);
  assert.equal(adv.visitObject(s, h.id, boat.id).ok, true);
  const t = makeState();
  const th = addHero(t, { pos: P(5, 6) });
  t.towns.t1 = { id: 't1', name: 'T', pos: P(5, 5), owner: 0, garrison: new Array(7).fill(null), visitingHero: null, garrisonHero: null, buildings: [] };
  adv.addObject(t, 'town', P(5, 5), { owner: 0, data: { townId: 't1' } });
  covered.add('town');
  adv.moveHero(t, th.id, P(5, 5));
  assert.equal(t.towns.t1.visitingHero, th.id);
  const m = setup('monster', { data: { creatureId: 'imp', count: 3, disposition: 'savage' } });
  m.go();
  assert.equal(m.state.combat.context.kind, 'adv_monster');
});

test('dwelling: flag, weekly stock (resets, does not accumulate), tier 1 free, guarded dwellings, lamp', () => {
  const t = setup('guardhouse');
  t.go();
  assert.equal(t.obj.owner, 0);
  assert.deepEqual(kinds(t.state), ['recruit']);
  const growth = getCreature('pikeman').growth;
  assert.deepEqual(t.state.pending[0].options[0], { id: 'recruit', label: 'Pikeman', creatureId: 'pikeman', available: growth, cost: {} });
  const g = gold(t);
  answer(t.state, 0, { count: 5 });
  assert.equal(gold(t), g, 'tier 1 joins for free');
  assert.equal(t.hero.army[0].count, 15);
  assert.equal(t.obj.data.stock.pikeman, growth - 5);
  answerId(t.state, 'leave');
  assert.deepEqual(adv.getFlaggedDwellings(t.state, 0), [{ objectId: t.obj.id, defId: 'guardhouse', creatures: ['pikeman'], townGrowthBonus: 1 }]);
  assert.deepEqual(adv.getFlaggedDwellings(t.state, 1), []);
  t.state.turn = 8;
  adv.startOfWeekAdventure(t.state);
  assert.equal(t.obj.data.stock.pikeman, growth, 'reset, not accumulated');
  adv.startOfWeekAdventure(t.state);
  assert.equal(t.obj.data.stock.pikeman, growth);
  // paid dwelling
  const a = setup('archers_tower');
  a.go();
  const g2 = gold(a);
  answer(a.state, 0); // everything
  const n = getCreature('archer').growth;
  assert.equal(gold(a), g2 - n * 100);
  assert.deepEqual(visitResults(a.again()), ['sold_out']);
  // no room in the army
  const seven = ['archer', 'griffin', 'swordsman', 'monk', 'cavalier', 'angel', 'imp'].map((creatureId) => ({ creatureId, count: 1 }));
  const nr = setup('guardhouse', {}, { army: seven });
  nr.go();
  assert.equal(answer(nr.state, 0).error, 'no_room');
  // guarded dwelling
  const gf = setup('golem_factory');
  gf.go();
  assert.deepEqual(kinds(gf.state), ['confirm_fight']);
  assert.equal(gf.obj.owner, null);
  answer(gf.state, 0);
  finishCombat(gf.state, 'attacker');
  assert.equal(gf.obj.owner, 0);
  assert.equal(gf.obj.data.cleared, true);
  assert.deepEqual(kinds(gf.state), ['recruit']);
  assert.equal(gf.state.pending[0].options.length, 5, 'four golem types + leave');
  // ancient lamp: fixed stock, removed when empty, no restock
  const lamp = setup('ancient_lamp', { data: { stock: { master_genie: 4 } } });
  lamp.go();
  lamp.player.resources.gold = 99999;
  answer(lamp.state, 0);
  assert.equal(lamp.hero.army[1].count, 4);
  assert.equal(lamp.state.map.objects[lamp.obj.id], undefined);
});

test('all 48 effect types of the closed set were exercised', () => {
  const missing = Object.keys(EFFECT_TYPES).filter((t) => !covered.has(t));
  assert.deepEqual(missing, []);
  assert.equal(Object.keys(EFFECT_TYPES).length, 48);
  for (const type of Object.keys(EFFECT_TYPES)) assert.ok(adv.EFFECTS[type], `handler for ${type}`);
});

test('visits keep the state JSON-serializable', () => {
  for (const id of ['dragon_utopia', 'seers_hut', 'black_market', 'university', 'treasure_chest', 'pandoras_box', 'tavern', 'hill_fort']) {
    const t = setup(id, id === 'seers_hut' ? { data: { quest: { type: 'reach_level', level: 1 }, reward: { exp: 1 } } } : {});
    t.go();
    assertJson(assert, t.state);
  }
});
