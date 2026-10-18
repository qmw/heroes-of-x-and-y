import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addHero, adv, assertJson } from './fixture.js';

const P = (x, y, z = 0) => ({ x, y, z });
const count = (state, id, z = 0) => (state.players[id].explored[z] || []).reduce((a, b) => a + b, 0);

test('revealAround marks a Euclidean disc on one level, clipped to the map', () => {
  const state = makeState({ width: 30, height: 30, levels: 2 });
  const fresh = adv.revealAround(state, 0, P(15, 15), 3);
  assert.equal(fresh, 29, 'tiles with dx^2 + dy^2 <= 9');
  assert.equal(count(state, 0), 29);
  assert.ok(adv.isExplored(state, 0, P(18, 15)));
  assert.ok(adv.isExplored(state, 0, P(17, 17)));
  assert.ok(!adv.isExplored(state, 0, P(18, 17)));
  assert.ok(!adv.isExplored(state, 0, P(15, 15, 1)), 'other level untouched');
  assert.ok(!adv.isExplored(state, 1, P(15, 15)), 'other player untouched');
  assert.equal(adv.revealAround(state, 0, P(15, 15), 3), 0, 'nothing new the second time');
  assert.equal(adv.revealAround(state, 0, P(0, 0, 1), 2), 6, 'corner: quarter disc');
  assert.ok(!adv.isExplored(state, 0, P(-1, 0)));
  assert.ok(state.players[0].explored[0].every((v) => v === 0 || v === 1));
  assertJson(assert, state);
});

test('moving reveals the fog with the hero sight radius (5, +Scouting)', () => {
  const state = makeState({ width: 40, height: 40 });
  const hero = addHero(state, { pos: P(10, 20) });
  assert.equal(count(state, 0), 0);
  adv.moveHero(state, hero.id, P(11, 20));
  assert.ok(adv.isExplored(state, 0, P(16, 20)));
  assert.ok(!adv.isExplored(state, 0, P(17, 20)));
  assert.ok(!adv.isExplored(state, 0, P(4, 20)), 'only revealed around tiles actually reached');
  hero.skills.push({ id: 'scouting', level: 3 });
  adv.moveHero(state, hero.id, P(12, 20));
  assert.ok(adv.isExplored(state, 0, P(20, 20)));
  assert.ok(!adv.isExplored(state, 0, P(21, 20)));
  hero.artifacts.equipped.misc[0] = 'spyglass';
  adv.moveHero(state, hero.id, P(13, 20));
  assert.ok(adv.isExplored(state, 0, P(22, 20)));
});

test('current visibility comes from heroes, towns and flagged objects', () => {
  const state = makeState({ width: 40, height: 40 });
  addHero(state, { pos: P(5, 5) });
  state.towns.t1 = { id: 't1', pos: P(30, 30), owner: 0, garrison: new Array(7).fill(null) };
  adv.addObject(state, 'sawmill', P(20, 5), { owner: 0 });
  adv.addObject(state, 'sawmill', P(20, 20), { owner: 1 });
  assert.ok(adv.isVisible(state, 0, P(10, 5)));
  assert.ok(!adv.isVisible(state, 0, P(11, 5)));
  assert.ok(adv.isVisible(state, 0, P(30, 35)), 'town radius 5');
  assert.ok(adv.isVisible(state, 0, P(23, 5)), 'own mine radius 3');
  assert.ok(!adv.isVisible(state, 0, P(24, 5)));
  assert.ok(!adv.isVisible(state, 0, P(20, 20)), "an enemy's mine gives nothing");
  assert.ok(adv.isVisible(state, 1, P(20, 20)));
  assert.ok(!adv.isVisible(state, 0, P(99, 99)));
  const vis = adv.getVisibleTiles(state, 0);
  assert.equal(vis[0][5 * 40 + 5], 1);
  assert.equal(vis[0][20 * 40 + 20], 0);
  assert.equal(adv.getVisionSources(state, 0).length, 3);
  // visibility is not stored; refreshVision turns it into explored tiles
  assert.ok(!adv.isExplored(state, 0, P(30, 30)));
  assert.ok(adv.refreshVision(state, 0) > 0);
  assert.ok(adv.isExplored(state, 0, P(30, 30)));
  adv.startOfDayAdventure(state);
  assert.ok(adv.isExplored(state, 1, P(20, 20)));
});

test('hideAround un-explores a disc except what the player currently sees', () => {
  const state = makeState({ width: 40, height: 40 });
  addHero(state, { pos: P(12, 10), owner: 1, id: 'foe' });
  adv.revealWhere(state, 1, () => true);
  const before = count(state, 1);
  const hidden = adv.hideAround(state, 1, P(10, 10), 6);
  assert.equal(count(state, 1), before - hidden);
  assert.ok(!adv.isExplored(state, 1, P(5, 10)));
  assert.ok(adv.isExplored(state, 1, P(10, 10)), 'within the sight of its hero');
  assert.ok(adv.isExplored(state, 1, P(17, 10)), 'outside the cover radius');
});

test('allies (same team) share exploration', () => {
  const state = makeState({ players: 3, width: 20, height: 20 });
  state.players[0].team = 1;
  state.players[2].team = 1;
  adv.revealAround(state, 0, P(5, 5), 2);
  assert.ok(adv.isExplored(state, 2, P(5, 5)));
  assert.ok(!adv.isExplored(state, 1, P(5, 5)));
  addHero(state, { pos: P(15, 15), owner: 2, id: 'ally' });
  assert.ok(adv.isVisible(state, 0, P(15, 15)));
});

test('revealWhere with a predicate', () => {
  const state = makeState({ width: 10, height: 10 });
  state.map.tiles[0][3][3].t = 'water';
  state.map.tiles[0][4][7].t = 'water';
  assert.equal(adv.revealWhere(state, 0, (tile) => tile.t === 'water'), 2);
  assert.ok(adv.isExplored(state, 0, P(7, 4)));
  assert.equal(count(state, 0), 2);
});
