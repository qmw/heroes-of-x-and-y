import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addHero, adv, assertJson } from './fixture.js';

const P = (x, y, z = 0) => ({ x, y, z });

test('digging: full movement, diggable free land; a hole otherwise; the grail when on it', () => {
  const state = makeState();
  const h = addHero(state, { pos: P(3, 3) });
  adv.setupGrail(state, { pos: P(8, 8) });
  assert.equal(adv.getGrailObject(state).pos.x, 8);
  assert.equal(state.map.tiles[0][8][8].obj, null, 'the grail leaves no trace');
  h.movePoints = 1400;
  assert.equal(adv.digForGrail(state, h.id).error, 'needs_full_movement');
  h.movePoints = 1500;
  const miss = adv.digForGrail(state, h.id);
  assert.equal(miss.found, false);
  assert.equal(h.movePoints, 0);
  assert.equal(adv.getObjectAt(state, P(3, 3)).defId, 'hole');
  h.movePoints = 1500;
  assert.equal(adv.digForGrail(state, h.id).error, 'tile_occupied', 'no digging twice');
  state.map.tiles[0][4][4].road = 1; h.pos = P(4, 4);
  assert.equal(adv.digForGrail(state, h.id).error, 'tile_occupied');
  state.map.tiles[0][5][5].t = 'water'; h.pos = P(5, 5);
  assert.equal(adv.digForGrail(state, h.id).error, 'not_diggable');
  h.pos = P(8, 8);
  const hit = adv.digForGrail(state, h.id);
  assert.equal(hit.found, true);
  assert.equal(hit.events[0].type, 'grail_found');
  assert.ok(h.artifacts.backpack.includes('grail'));
  assert.equal(adv.getGrailObject(state), null);
  assert.equal(state.log.at(-1).type, 'grail_found');
  h.inBoat = true; h.movePoints = 1500;
  assert.equal(adv.digForGrail(state, h.id).error, 'in_boat');
});

test('setupGrail picks a diggable tile once', () => {
  const state = makeState();
  adv.setupGrail(state);
  const g = adv.getGrailObject(state);
  assert.ok(g);
  adv.setupGrail(state);
  assert.equal(adv.objectsByDef(state, 'grail').length, 1);
  assert.equal(state.map.puzzleOrder.length, 48);
});

test('obelisks: pieces removed = floor(48 v / T), outer first, shared with allies, grail shown when complete', () => {
  const state = makeState({ players: 3, width: 30 });
  state.players[0].team = 7; state.players[2].team = 7;
  adv.setupGrail(state, { pos: P(20, 8) });
  const obs = [3, 8, 13].map((x) => adv.addObject(state, 'obelisk', P(x, 5)));
  assert.deepEqual(adv.getPuzzleProgress(state, 0).piecesRemoved, 0);
  assert.equal(adv.getPuzzleProgress(state, 0).area, null, 'no area before the first piece is uncovered');
  const h = addHero(state, { pos: P(3, 6) });
  adv.moveHero(state, h.id, P(3, 5));
  let p = adv.getPuzzleProgress(state, 0);
  assert.deepEqual([p.visited, p.total, p.piecesRemoved, p.complete, p.grailPos], [1, 3, 16, false, null]);
  // 24 x 18 tiles centred on the grail (20, 8), clamped to the 30 x 12 map
  assert.deepEqual(p.area, { x0: 6, y0: 0, w: 24, h: 12, z: 0, tilesPerPiece: 3 });
  assert.equal(adv.getPuzzleProgress(state, 2).piecesRemoved, 16, 'ally shares');
  assert.equal(adv.getPuzzleProgress(state, 1).piecesRemoved, 0);
  // outer ring first
  const order = state.map.puzzleOrder;
  const ring = (i) => Math.max(Math.abs((i % 8) - 3.5) / 8, Math.abs(Math.floor(i / 8) - 2.5) / 6);
  for (let i = 1; i < 48; i++) assert.ok(ring(order[i - 1]) >= ring(order[i]));
  state.players[0].visited[obs[1].id] = true;
  state.players[2].visited[obs[2].id] = true;
  p = adv.getPuzzleProgress(state, 0);
  assert.equal(p.piecesRemoved, 48);
  assert.deepEqual(p.grailPos, P(20, 8));
});

test('startOfWeekAdventure: weekly rewards re-rolled, camps and dwellings restocked, banks not refilled', () => {
  const state = makeState({ width: 30 });
  const mill = adv.addObject(state, 'windmill', P(3, 3));
  const camp = adv.addObject(state, 'refugee_camp', P(10, 3), { data: { creatureId: 'imp', count: 0 } });
  const dw = adv.addObject(state, 'guardhouse', P(15, 3), { data: { stock: { pikeman: 0 } } });
  const bank = adv.addObject(state, 'imp_cache', P(20, 3), { data: { cleared: true, guards: null } });
  mill.data.visitedWeek = 1;
  state.turn = 8;
  const res = adv.startOfWeekAdventure(state);
  assert.equal(res.events[0].week, 2);
  assert.equal(mill.data.visitedWeek, null);
  assert.ok(camp.data.count > 0);
  assert.equal(dw.data.stock.pikeman, 14);
  assert.equal(bank.data.cleared, true);
  assertJson(assert, state);
});

test('getMineIncome sums flagged mines; abandoned mines produce their rolled resource', () => {
  const state = makeState({ width: 30 });
  adv.addObject(state, 'gold_mine', P(3, 3), { owner: 0 });
  adv.addObject(state, 'gold_mine', P(8, 3), { owner: 0 });
  adv.addObject(state, 'gem_pond', P(13, 3), { owner: 1 });
  adv.addObject(state, 'abandoned_mine', P(18, 3), { owner: 0, data: { resource: 'mercury', cleared: true, guards: null } });
  assert.deepEqual(adv.getMineIncome(state, 0), { gold: 2000, mercury: 1 });
  assert.deepEqual(adv.getMineIncome(state, 1), { gems: 1 });
  assert.deepEqual(adv.getMineIncome(state, null), {});
});
