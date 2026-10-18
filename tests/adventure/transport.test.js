import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addHero, adv, fillRect, answer, finishCombat, kinds, eventTypes, visitResults } from './fixture.js';

const P = (x, y, z = 0) => ({ x, y, z });

/** Land on the left (x <= 4), sea on the right. */
function coast(opts = {}) {
  const state = makeState(opts);
  fillRect(state, 5, 0, 15, 11, { t: 'water' });
  return state;
}

function sailor(state, pos, o = {}) {
  const hero = addHero(state, { pos, ...o });
  hero.inBoat = true;
  const boat = adv.addObject(state, 'boat', pos, { data: { heroId: hero.id, owner: hero.owner } });
  return { hero, boat };
}

test('a land hero cannot enter water; a boat cannot enter land except by landing', () => {
  const state = coast();
  const hero = addHero(state, { pos: P(3, 5) });
  assert.equal(adv.findPath(state, hero.id, P(6, 5)), null);
  assert.equal(adv.moveHero(state, hero.id, P(6, 5)).error, 'no_path');
});

test('boarding needs 1 point and ends the day; the boat then sails at 100 per tile on sea points', () => {
  const state = coast();
  const hero = addHero(state, { pos: P(3, 5), movePoints: 700 });
  const boat = adv.addObject(state, 'boat', P(5, 5));
  assert.equal(state.map.tiles[0][5][5].obj, boat.id);
  const path = adv.findPath(state, hero.id, P(8, 5));
  assert.deepEqual(path.steps.map((s) => s.kind), ['move', 'board', 'move', 'move', 'move']);
  assert.equal(path.turns, 1, 'sailing on only starts tomorrow');
  const res = adv.moveHero(state, hero.id, P(5, 5));
  assert.ok(res.ok && res.arrived, JSON.stringify(res));
  assert.deepEqual(eventTypes(res), ['move', 'board']);
  assert.equal(hero.inBoat, true);
  assert.deepEqual(hero.pos, P(5, 5));
  assert.equal(hero.movePoints, 0);
  assert.equal(boat.data.heroId, hero.id);
  assert.equal(state.map.tiles[0][5][5].obj, null, 'an occupied boat travels with its hero');
  // next day
  hero.movePoints = 1500;
  const sail = adv.moveHero(state, hero.id, P(9, 7));
  assert.ok(sail.arrived);
  assert.equal(hero.movePoints, 1500 - 2 * 141 - 2 * 100);
  assert.deepEqual(boat.pos, P(9, 7));
  // boarding with 0 points is impossible
  const s2 = coast();
  const h2 = addHero(s2, { pos: P(4, 5), movePoints: 0 });
  adv.addObject(s2, 'boat', P(5, 5));
  assert.equal(adv.moveHero(s2, h2.id, P(5, 5)).error, 'no_movement_points');
});

test('landing ends the day, leaves the boat behind; object tiles are no landing spots', () => {
  const state = coast();
  const { hero, boat } = sailor(state, P(6, 5), { movePoints: 900 });
  adv.addObject(state, 'resource_wood', P(4, 4));
  const stone = adv.addObject(state, 'learning_stone', P(4, 6));
  // land objects cannot be used from the boat: the hero has to land first (which ends the day)
  const toPile = adv.findPath(state, hero.id, P(4, 4));
  assert.ok(toPile.steps.some((s) => s.kind === 'land'));
  assert.equal(toPile.turns, 1);
  const ctx0 = adv.getMoveContext(state, hero);
  assert.equal(adv.classifyStep(state, ctx0, P(5, 5), P(4, 4), true).kind, 'blocked', 'no pickup from the deck');
  assert.equal(adv.classifyStep(state, ctx0, P(5, 5), P(4, 6), true).kind, 'blocked', 'no landing on an entrance');
  void stone;
  const res = adv.moveHero(state, hero.id, P(4, 5));
  assert.ok(res.arrived);
  assert.deepEqual(eventTypes(res), ['move', 'land']);
  assert.equal(hero.inBoat, false);
  assert.equal(hero.movePoints, 0);
  assert.deepEqual(hero.pos, P(4, 5));
  assert.deepEqual(boat.pos, P(5, 5));
  assert.equal(boat.data.heroId, null);
  assert.equal(state.map.tiles[0][5][5].obj, boat.id, 'the empty boat is back on the map');
  // boats block other boats
  const other = sailor(state, P(7, 5), { id: 'h2' });
  const ctx = adv.getMoveContext(state, other.hero);
  assert.equal(adv.classifyStep(state, ctx, P(6, 5), P(5, 5), true).kind, 'blocked');
});

test("Admiral's Hat: boarding and landing cost a normal step and convert the remaining points", () => {
  const state = coast();
  const hero = addHero(state, { pos: P(4, 5), movePoints: 1560, maxMovePoints: 1560 });
  hero.artifacts.equipped.head[0] = 'admirals_hat';
  adv.addObject(state, 'boat', P(5, 5));
  const ctx = adv.getMoveContext(state, hero);
  assert.equal(ctx.maxLand, 1560);
  assert.equal(ctx.maxSea, 3000, '1500 + 500 hat + 1000 necklace');
  const res = adv.moveHero(state, hero.id, P(7, 5));
  assert.ok(res.arrived, JSON.stringify(res));
  // board: (1560 - 100) / 1560 * 3000 = 2807; then two sea steps
  assert.equal(hero.movePoints, Math.floor(1460 / 1560 * 3000) - 200);
  assert.equal(hero.inBoat, true);
});

test('free_boarding bonus from any source (not only the Hat itself) makes boarding a normal step', () => {
  const state = coast();
  const hero = addHero(state, { pos: P(4, 5), movePoints: 1560, maxMovePoints: 1560 });
  hero.temp = [{ source: 'test', bonus: { type: 'free_boarding' }, until: 'end_of_day' }];
  assert.equal(adv.getMoveContext(state, hero).hat, true);
  adv.addObject(state, 'boat', P(5, 5));
  adv.moveHero(state, hero.id, P(5, 5));
  assert.equal(hero.inBoat, true);
  assert.ok(hero.movePoints > 0, 'boarding did not end the day');
});

test('favorable winds: sailing out of the tile costs 66', () => {
  const state = coast();
  const { hero } = sailor(state, P(6, 5));
  state.map.tiles[0][5][6].overlay = 'favorable_winds';
  adv.moveHero(state, hero.id, P(8, 5));
  assert.equal(hero.movePoints, 1500 - 66 - 100);
});

test('sea objects are visited from a boat (enter and adjacent)', () => {
  const state = coast();
  const { hero } = sailor(state, P(6, 5));
  adv.addObject(state, 'buoy', P(8, 5));
  adv.addObject(state, 'sea_chest', P(8, 8));
  let res = adv.moveHero(state, hero.id, P(8, 5));
  assert.deepEqual(hero.pos, P(8, 5));
  assert.deepEqual(visitResults(res), ['temp_bonus']);
  assert.deepEqual(hero.temp.map((t) => [t.source, t.bonus.type, t.bonus.value]), [['buoy', 'morale', 1]]);
  res = adv.moveHero(state, hero.id, P(8, 8));
  assert.deepEqual(hero.pos, P(8, 7));
  assert.ok(eventTypes(res).includes('pickup'));
});

test('shipyard launches a boat on the first free water tile for 1000 gold + 10 wood', () => {
  const state = coast();
  const hero = addHero(state, { pos: P(3, 7) });
  const yard = adv.addObject(state, 'shipyard', P(3, 6)); // footprint x 2..4, y 5..6
  const res = adv.moveHero(state, hero.id, P(3, 6));
  assert.equal(yard.owner, 0);
  assert.deepEqual(kinds(state), ['build_boat']);
  assert.ok(visitResults(res).includes('build_boat'));
  const { gold, wood } = state.players[0].resources;
  const built = answer(state, 0);
  assert.ok(built.ok);
  const boat = Object.values(state.map.objects).find((o) => o.defId === 'boat');
  assert.equal(boat.pos.x, 5);
  assert.equal(boat.data.owner, 0);
  assert.equal(state.players[0].resources.gold, gold - 1000);
  assert.equal(state.players[0].resources.wood, wood - 10);
  // too poor
  state.players[0].resources.wood = 3;
  adv.visitObject(state, hero.id, yard.id);
  assert.deepEqual(answer(state, 0), { ok: false, events: [], error: 'cannot_afford' });
  // no water around -> refused
  const s2 = makeState();
  const h2 = addHero(s2, { pos: P(3, 7) });
  adv.addObject(s2, 'shipyard', P(3, 6));
  const r2 = adv.moveHero(s2, h2.id, P(3, 6));
  assert.ok(visitResults(r2).includes('no_water'));
  assert.deepEqual(kinds(s2), []);
});

test('one-way monolith sends the hero to a random exit of its colour; the hero may go on', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 1) });
  adv.addObject(state, 'monolith_one_way_entrance_blue', P(3, 1));
  const exit = adv.addObject(state, 'monolith_one_way_exit_blue', P(12, 9));
  adv.addObject(state, 'monolith_one_way_exit_pink', P(12, 2));
  const res = adv.moveHero(state, hero.id, P(3, 1));
  assert.ok(res.arrived);
  assert.deepEqual(hero.pos, exit.pos);
  assert.equal(hero.movePoints, 1300, 'only the step onto the entrance costs');
  assert.ok(visitResults(res).includes('teleport'));
  assert.ok(adv.moveHero(state, hero.id, P(13, 9)).ok, 'can walk off the exit');
  const ctx = adv.getMoveContext(state, hero);
  assert.equal(adv.classifyStep(state, ctx, hero.pos, exit.pos, false).kind, 'blocked', 'exits cannot be walked onto');
  // no exit -> nothing happens
  const s2 = makeState();
  const h2 = addHero(s2, { pos: P(1, 1) });
  adv.addObject(s2, 'monolith_one_way_entrance_blue', P(2, 1));
  const r2 = adv.moveHero(s2, h2.id, P(2, 1));
  assert.deepEqual(visitResults(r2), ['no_exit']);
  assert.deepEqual(h2.pos, P(2, 1));
});

test('two-way monoliths: random OTHER monolith; arriving does not re-trigger; friendly hero blocks, enemy is fought', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 1) });
  adv.addObject(state, 'monolith_two_way_green', P(2, 1));
  const b = adv.addObject(state, 'monolith_two_way_green', P(10, 8));
  adv.addObject(state, 'monolith_two_way_brown', P(10, 2));
  adv.moveHero(state, hero.id, P(2, 1));
  assert.deepEqual(hero.pos, b.pos);
  assert.deepEqual(state.pending, []);
  // friendly hero on the only exit
  const s2 = makeState();
  const h2 = addHero(s2, { pos: P(1, 1) });
  adv.addObject(s2, 'monolith_two_way_green', P(2, 1));
  addHero(s2, { pos: P(10, 8), id: 'friend' });
  adv.addObject(s2, 'monolith_two_way_green', P(10, 8));
  assert.deepEqual(visitResults(adv.moveHero(s2, h2.id, P(2, 1))), ['exit_occupied']);
  assert.deepEqual(h2.pos, P(2, 1));
  // enemy on the exit: fight, then arrive
  const s3 = makeState();
  const h3 = addHero(s3, { pos: P(1, 1) });
  adv.addObject(s3, 'monolith_two_way_green', P(2, 1));
  addHero(s3, { pos: P(10, 8), id: 'foe', owner: 1 });
  adv.addObject(s3, 'monolith_two_way_green', P(10, 8));
  adv.moveHero(s3, h3.id, P(2, 1));
  assert.equal(s3.combat.context.kind, 'adv_hero');
  adv.deps.removeHero(s3, 'foe');
  finishCombat(s3, 'attacker');
  assert.deepEqual(h3.pos, P(10, 8));
});

test('subterranean gates: paired travel, path-finding through the gate', () => {
  const state = makeState({ levels: 2 });
  const hero = addHero(state, { pos: P(5, 8) });
  const top = adv.addObject(state, 'subterranean_gate', P(5, 5, 0));
  const bottom = adv.addObject(state, 'subterranean_gate', P(9, 9, 1));
  assert.equal(top.data.pair, bottom.id);
  const path = adv.findPath(state, hero.id, P(12, 10, 1));
  assert.ok(path, 'route through the gate');
  assert.equal(path.turns, 0);
  assert.equal(path.steps.find((s) => s.kind === 'teleport').z, 1);
  const res = adv.moveHero(state, hero.id, P(12, 10, 1));
  assert.ok(res.arrived, JSON.stringify(res.stopped));
  assert.deepEqual(hero.pos, P(12, 10, 1));
  // and back
  hero.movePoints = 1500;
  adv.moveHero(state, hero.id, P(9, 9, 1));
  assert.deepEqual(hero.pos, P(5, 5, 0));
  // an unpaired gate does nothing
  const lone = adv.addObject(state, 'subterranean_gate', P(12, 5, 0));
  assert.equal(lone.data.pair, null);
  hero.movePoints = 1500;
  assert.deepEqual(visitResults(adv.moveHero(state, hero.id, P(12, 5, 0))), ['no_exit']);
});

test('whirlpool: warns, drowns half of the weakest stack, teleports; hat protects; single creature exempt', () => {
  const state = makeState({ terrain: 'water' });
  const { hero } = sailor(state, P(1, 1), { army: [{ creatureId: 'pikeman', count: 21 }, { creatureId: 'angel', count: 2 }] });
  adv.addObject(state, 'whirlpool', P(3, 1));
  const out = adv.addObject(state, 'whirlpool', P(12, 9));
  adv.moveHero(state, hero.id, P(3, 1));
  assert.deepEqual(kinds(state), ['confirm_whirlpool']);
  assert.deepEqual(hero.pos, P(3, 1));
  const res = answer(state, 0);
  assert.deepEqual(hero.pos, out.pos);
  assert.equal(hero.army[0].count, 11, '21 pikemen (1680) are weaker than 2 angels: lose floor(21/2) = 10');
  assert.equal(hero.army[1].count, 2);
  assert.ok(eventTypes(res).includes('whirlpool_loss'));
  assert.deepEqual(adv.getBoatOfHero(state, hero.id).pos, out.pos);
  // declining keeps everything
  hero.movePoints = 1500;
  adv.visitObject(state, hero.id, out.id);
  answer(state, 1);
  assert.deepEqual(hero.pos, out.pos);
  assert.equal(hero.army[0].count, 11);
  // protected by the Sea Captain's Hat: no question, no loss
  hero.artifacts.equipped.head[0] = 'sea_captains_hat';
  adv.visitObject(state, hero.id, out.id);
  assert.deepEqual(state.pending, []);
  assert.deepEqual(hero.pos, P(3, 1));
  assert.equal(hero.army[0].count, 11);
  // a single creature is exempt; minimum loss is 1
  const lone = { army: [{ creatureId: 'angel', count: 1 }, null, null, null, null, null, null] };
  assert.equal(adv.whirlpoolLoss(lone, { percent: 50, min: 1, exemptSingleCreature: true }), null);
  const two = { army: [{ creatureId: 'angel', count: 1 }, { creatureId: 'imp', count: 1 }, null, null, null, null, null] };
  assert.deepEqual(adv.whirlpoolLoss(two, { percent: 50, min: 1, exemptSingleCreature: true }), { slot: 1, creatureId: 'imp', lost: 1 });
  assert.equal(two.army[1], null);
});

test('keymaster tent, border guard (removed with the key) and border gate (permanent, key holders only)', () => {
  const state = makeState({ width: 12, height: 3 });
  fillRect(state, 0, 0, 11, 0, { blocked: true });
  fillRect(state, 0, 2, 11, 2, { blocked: true });
  const hero = addHero(state, { pos: P(1, 1) });
  const guard = adv.addObject(state, 'border_guard_red', P(4, 1));
  const gate = adv.addObject(state, 'border_gate_green', P(7, 1));
  let res = adv.moveHero(state, hero.id, P(4, 1));
  assert.deepEqual(visitResults(res), ['no_key']);
  assert.deepEqual(hero.pos, P(3, 1));
  assert.equal(adv.findPath(state, hero.id, P(5, 1)), null);
  // get the red key
  state.players[0].visited.key_red = true;
  assert.ok(adv.hasKey(state, 0, 'red'));
  res = adv.moveHero(state, hero.id, P(4, 1));
  assert.deepEqual(kinds(state), ['confirm_pass']);
  answer(state, 1);
  assert.ok(state.map.objects[guard.id], 'declined: guard stays');
  adv.moveHero(state, hero.id, P(4, 1));
  answer(state, 0);
  assert.equal(state.map.objects[guard.id], undefined, 'gone for everybody');
  // the gate: blocked without the green key
  assert.equal(adv.findPath(state, hero.id, P(9, 1)), null);
  state.players[0].visited.key_green = true;
  const through = adv.moveHero(state, hero.id, P(9, 1));
  assert.ok(through.arrived);
  assert.deepEqual(hero.pos, P(9, 1));
  assert.ok(state.map.objects[gate.id], 'gates are permanent');
  // the other player still cannot pass
  state.currentPlayer = 1;
  const foe = addHero(state, { pos: P(10, 1), owner: 1, id: 'foe' });
  hero.pos = P(1, 1);
  assert.equal(adv.findPath(state, foe.id, P(5, 1)), null);
});

test('keymaster tent visit gives the key once per player', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(5, 6) });
  adv.addObject(state, 'keymasters_tent_purple', P(5, 5));
  assert.deepEqual(visitResults(adv.moveHero(state, hero.id, P(5, 5))), ['key']);
  assert.equal(state.players[0].visited.key_purple, true);
  assert.ok(!adv.hasKey(state, 1, 'purple'));
  assert.deepEqual(visitResults(adv.visitObject(state, hero.id, 'o1')), ['already_visited']);
});

test('garrison: flag when empty, pass through own, fight an enemy one, exchange troops', () => {
  const state = makeState({ width: 12, height: 5 });
  const hero = addHero(state, { pos: P(5, 4), army: [{ creatureId: 'pikeman', count: 10 }, { creatureId: 'archer', count: 4 }] });
  fillRect(state, 0, 2, 11, 2, { blocked: true });
  state.map.tiles[0][2][5].blocked = false;
  const gar = adv.addObject(state, 'garrison', P(5, 2));
  let res = adv.moveHero(state, hero.id, P(5, 2));
  assert.equal(gar.owner, 0);
  assert.ok(eventTypes(res).includes('flagged'));
  // owner: exchange dialog
  res = adv.visitObject(state, hero.id, gar.id);
  assert.deepEqual(kinds(state), ['garrison_exchange']);
  assert.deepEqual(answer(state, 0, { from: 'hero', slot: 1 }).events[0].count, 4);
  assert.equal(hero.army[1], null);
  assert.deepEqual(gar.data.army[0], { creatureId: 'archer', count: 4 });
  assert.equal(answer(state, 0, { from: 'hero', slot: 0 }).error, 'last_creature');
  assert.ok(answer(state, 0, { from: 'garrison', slot: 0, count: 1 }).ok);
  assert.equal(gar.data.army[0].count, 3);
  assert.deepEqual(kinds(state), ['garrison_exchange'], 'stays open');
  answer(state, 1);
  assert.deepEqual(kinds(state), []);
  // own garrison is walked through without stopping
  hero.pos = P(5, 4);
  hero.movePoints = 1500;
  res = adv.moveHero(state, hero.id, P(5, 0));
  assert.ok(res.arrived);
  assert.deepEqual(hero.pos, P(5, 0));
  assert.deepEqual(state.pending, []);
  // enemy: must fight; losing leaves the survivors, winning flags it empty
  state.currentPlayer = 1;
  const foe = addHero(state, { pos: P(5, 4), owner: 1, id: 'foe' });
  assert.equal(adv.findPath(state, foe.id, P(5, 1)), null, 'no passing through an enemy garrison');
  adv.moveHero(state, foe.id, P(5, 2));
  assert.deepEqual(kinds(state), ['confirm_fight']);
  answer(state, 0);
  assert.equal(state.combat.context.stage, 'garrison');
  finishCombat(state, 'attacker');
  assert.equal(gar.owner, 1);
  assert.ok(gar.data.army.every((s) => s === null));
  // anti-magic garrison forbids spells
  const s2 = makeState();
  let seen = null;
  adv.setDeps({ startCombat: (st, o) => { seen = o; st.combat = { context: o.context }; return { ok: true, events: [] }; } });
  const h2 = addHero(s2, { pos: P(5, 6) });
  adv.addObject(s2, 'anti_magic_garrison', P(5, 5), { owner: 1, data: { army: [{ creatureId: 'imp', count: 9 }] } });
  adv.moveHero(s2, h2.id, P(5, 5));
  answer(s2, 0);
  assert.equal(seen.spellLevelCap, 0);
  assert.deepEqual(seen.defender.army[0], { creatureId: 'imp', count: 9 });
});

test('Fly: crosses obstacles and water but only stops on free land; cost multiplier by mastery', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 5) });
  fillRect(state, 3, 0, 3, 11, { blocked: true });
  fillRect(state, 4, 0, 5, 11, { t: 'water' });
  assert.equal(adv.findPath(state, hero.id, P(7, 5)), null);
  hero.temp.push({ source: 'spell:fly', bonus: { type: 'fly', mastery: 0 }, until: 'end_of_day' });
  const p = adv.findPath(state, hero.id, P(7, 5));
  assert.deepEqual(p.steps.map((s) => s.kind), ['move', 'transit', 'transit', 'transit', 'move', 'move']);
  assert.equal(p.cost, 6 * 140, '+40% at basic/none mastery');
  assert.equal(adv.findPath(state, hero.id, P(4, 5)), null, 'cannot stop on water');
  assert.equal(adv.findPath(state, hero.id, P(3, 5)), null, 'cannot stop on an obstacle');
  hero.temp[0].bonus.mastery = 2;
  assert.equal(adv.findPath(state, hero.id, P(7, 5)).cost, 6 * 120);
  hero.temp[0].bonus.mastery = 3;
  assert.equal(adv.findPath(state, hero.id, P(7, 5)).cost, 600);
  // not enough points to finish the crossing: the hero stops before it
  hero.movePoints = 450;
  const res = adv.moveHero(state, hero.id, P(7, 5));
  assert.ok(res.ok);
  assert.deepEqual(hero.pos, P(2, 5), 'last tile it could stand on');
  assert.equal(hero.movePoints, 350);
  hero.movePoints = 1500;
  assert.ok(adv.moveHero(state, hero.id, P(7, 5)).arrived);
  // Angel Wings grant expert flight; guards are not triggered while passing
  const s2 = makeState();
  const h2 = addHero(s2, { pos: P(1, 5) });
  h2.artifacts.equipped.shoulders[0] = 'angel_wings';
  adv.addObject(s2, 'monster', P(5, 6), { data: { creatureId: 'imp', count: 5, disposition: 'savage' } });
  const r2 = adv.moveHero(s2, h2.id, P(9, 5), { path: [2, 3, 4, 5, 6, 7, 8, 9].map((x) => P(x, 5)) });
  assert.ok(r2.arrived);
  assert.equal(s2.combat, null);
  assert.equal(h2.movePoints, 1500 - 800);
});

test('Water Walk: crosses free water at 100 x factor, never ends on water, not through sea objects', () => {
  const state = makeState();
  const hero = addHero(state, { pos: P(1, 5) });
  fillRect(state, 3, 0, 5, 11, { t: 'water' });
  hero.temp.push({ source: 'spell:water_walk', bonus: { type: 'water_walk', mastery: 1 }, until: 'end_of_day' });
  const p = adv.findPath(state, hero.id, P(7, 5));
  // land step 100, onto water 100 (leaving land), 2 water steps 140 each, leaving water 140, land 100
  assert.equal(p.cost, 100 + 100 + 140 + 140 + 140 + 100);
  assert.equal(adv.findPath(state, hero.id, P(4, 5)), null);
  hero.movePoints = 400;
  assert.deepEqual(adv.moveHero(state, hero.id, P(7, 5)).pos, P(2, 5), 'cannot finish the crossing today: waits on the shore');
  hero.movePoints = 1500;
  assert.ok(adv.moveHero(state, hero.id, P(7, 5)).arrived);
  // Boots of Levitation = expert water walk
  const s2 = makeState({ width: 9, height: 1 });
  fillRect(s2, 2, 0, 4, 0, { t: 'water' });
  const h2 = addHero(s2, { pos: P(0, 0) });
  h2.artifacts.equipped.feet[0] = 'boots_of_levitation';
  assert.equal(adv.findPath(s2, h2.id, P(6, 0)).cost, 600);
  adv.addObject(s2, 'buoy', P(3, 0));
  assert.equal(adv.findPath(s2, h2.id, P(6, 0)), null, 'objects on water block the walk');
});
