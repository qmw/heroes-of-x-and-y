// Map editor screen (src/ui/screens/editor/*) on the fake DOM: mount, tools, undo, inspector, save /
// open, validate, play hand-off, main-menu entry and the New Game "Custom maps" list.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, createFakeStorage, fire, tick, until } from './fakeDom.js';

const dom = installFakeDom();
const { createApp } = await import('../../src/ui/app.js');
const ui = await import('../../src/ui/kit/index.js');
const game = await import('../../src/engine/game.js');
const mapgen = await import('../../src/engine/mapgen/index.js');
const E = await import('../../src/engine/editor/index.js');
const screen = await import('../../src/ui/screens/editor/index.js');
const M = await import('../../src/ui/screens/editor/model.js');
const { createMapLibrary, memoryRecords } = await import('../../src/ui/screens/editor/mapStorage.js');
const NG = await import('../../src/ui/screens/newGameModel.js');

const MODULES = { game, mapgen };
let app = null;
const quiet = async (fn) => {
  const saved = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};
function makeApp(extraScreens = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  app = createApp(root, {
    storageBackend: createFakeStorage(),
    gfxLoader: async () => { throw new Error('no gfx'); },
    importer: async (path) => {
      const name = Object.keys(MODULES).find((k) => path.endsWith(`/${k}.js`) || path.endsWith(`/${k}/index.js`));
      if (name) return MODULES[name];
      throw new Error(`Cannot find module ${path}`);
    },
    screens: extraScreens,
  });
  app.anim.setSpeed(Infinity);
  return app;
}
async function mountEditor(params = { fresh: true }, extra = {}) {
  makeApp(extra);
  await quiet(() => app.showScreen('editor', params));
  const c = screen.getController();
  assert.ok(c, 'controller');
  return c;
}
const dialogs = () => ui.getLayer('dialogs').querySelectorAll('.k-dlg');
const topDialog = () => { const d = dialogs(); return d[d.length - 1] || null; };
const btnIn = (el, label) => el.querySelectorAll('button').find((b) => b.textContent.trim() === label || b.textContent.includes(label));
async function clickDialog(label) {
  const d = await until(() => topDialog() && btnIn(topDialog(), label) && topDialog());
  btnIn(d, label).click();
  await tick(2);
}
const P = (x, y, z = 0) => ({ x, y, z });

afterEach(async () => {
  ui.closeAllDialogs();
  game.setAiDriver(null);
  if (app) await quiet(() => app.destroy());
  app = null;
  screen.resetSession();
});

test('model: catalogue covers every object + towns per faction + hero; search and category filters', () => {
  const cat = M.buildCatalog();
  assert.ok(cat.some((e) => e.key === 'town:castle'));
  assert.ok(cat.some((e) => e.key === 'hero'));
  assert.ok(cat.some((e) => e.defId === 'gold_mine'));
  assert.ok(M.filterCatalog(cat, { category: 'mine' }).every((e) => e.group === 'mine'));
  const gold = M.filterCatalog(cat, { search: 'gold mine' });
  assert.ok(gold.some((e) => e.defId === 'gold_mine'));
  assert.ok(gold.every((e) => /gold/.test(e.search) && /mine/.test(e.search)));
  assert.equal(M.filterCatalog(cat, { search: 'zzzz' }).length, 0);
  // preview state: towns become town objects, heroes hero entities
  const doc = E.newMap({ size: 'S' });
  E.placeObject(doc, 'town', P(5, 5), { faction: 'rampart', ownerSlot: 1 });
  E.placeObject(doc, 'hero', P(5, 5), { ownerSlot: 1 });
  const pv = M.createPreview(doc.bp);
  assert.equal(Object.values(pv.map.objects)[0].defId, 'town');
  assert.equal(pv.towns.et0.faction, 'rampart');
  assert.equal(pv.heroes.eh0.owner, 1);
  assert.equal(pv.players[1].color, 'blue');
  assert.equal(pv.map.tiles, doc.bp.map.tiles, 'tiles are shared');
});

test('model: inspector specs round-trip quests, payloads and monster fields', () => {
  const doc = E.newMap({ size: 'S' });
  const mon = E.placeObject(doc, 'monster', P(5, 5), { data: { creatureId: 'pikeman', count: 9 } });
  const seer = E.placeObject(doc, 'seers_hut', P(10, 10));
  let spec = M.inspectorSpec(doc.bp, seer.ref, E.getRef(doc, seer.ref));
  const v = Object.fromEntries(spec.fields.map((f) => [f.id, f.value]));
  v.q_type = 'kill_monster';
  v.q_objectId = mon.ref.id;
  v.reward_exp = 1500;
  v.reward_res_gold = 2000;
  v.reward_artifacts = 'centaurs_axe';
  assert.ok(E.setProps(doc, seer.ref, spec.apply(v)).ok);
  const d = E.getRef(doc, seer.ref).data;
  assert.deepEqual(d.quest, { type: 'kill_monster', objectId: mon.ref.id });
  assert.deepEqual(d.reward, { exp: 1500, resources: { gold: 2000 }, artifacts: ['centaurs_axe'] });
  spec = M.inspectorSpec(doc.bp, mon.ref, E.getRef(doc, mon.ref));
  const mv = Object.fromEntries(spec.fields.map((f) => [f.id, f.value]));
  assert.equal(mv.count, 9);
  mv.count = 40;
  mv.creatureId = 'griffin';
  assert.ok(E.setProps(doc, mon.ref, spec.apply(mv)).ok);
  assert.equal(E.getRef(doc, mon.ref).data.count, 40);
  assert.deepEqual(M.questFromValues({ q_type: 'bring_creatures', q_creatures: '20 griffin, 3 angel' }), { type: 'bring_creatures', creatures: [{ creatureId: 'griffin', count: 20 }, { creatureId: 'angel', count: 3 }] });
  assert.equal(M.questFromValues({ q_type: '' }), null);
});

test('map library: save, list, load, remove (LZ-compressed records)', () => {
  const lib = createMapLibrary(memoryRecords());
  const doc = E.newMap({ size: 'S', name: 'Lib map' });
  const r = lib.save(doc.bp);
  assert.ok(r.ok);
  assert.equal(r.id, 'lib_map');
  assert.equal(lib.list()[0].name, 'Lib map');
  assert.equal(lib.list()[0].playerSlots, 2);
  const l = lib.load('lib_map');
  assert.ok(l.ok);
  assert.deepEqual(l.bp, doc.bp);
  assert.equal(lib.load('nope').ok, false);
  lib.remove('lib_map');
  assert.equal(lib.list().length, 0);
});

test('editor mounts: palette with 9 tools, map canvas rendered, minimap, status', async () => {
  const c = await mountEditor();
  const root = app.layers.screen;
  assert.ok(root.querySelector('.ed-root'));
  assert.equal(root.querySelectorAll('.ed-tools .k-btn').length, 9);
  assert.ok(root.querySelector('.ed-mapwrap canvas'));
  assert.ok(root.querySelector('.k-minimap'));
  assert.ok(c.view.stats.frames >= 1);
  assert.equal(c.doc.bp.map.width, 72);
  assert.match(root.querySelector('.ed-title').textContent, /New map/);
  assert.equal(app.layers.error.children.length, 0);
});

test('tools: paint, fill, road drag, river, place town / hero / object, erase; keyboard tool switch and undo / redo', async () => {
  const c = await mountEditor();
  c.setTool('terrain');
  c.options.terrain = 'sand';
  c.options.brush = 2;
  c.clickTile(P(3, 3));
  assert.equal(c.doc.bp.map.tiles[0][4][4].t, 'sand');
  // one undo step per stroke
  c.options.terrain = 'snow';
  c.options.brush = 1;
  const before = c.doc.undo.length;
  c.dragTiles([P(10, 10), P(11, 10), P(12, 10), P(13, 10)]);
  assert.equal(c.doc.undo.length, before + 1);
  assert.equal(c.doc.bp.map.tiles[0][10][13].t, 'snow');
  fire(dom.window, 'keydown', { key: 'z', ctrlKey: true });
  assert.equal(c.doc.bp.map.tiles[0][10][13].t, 'grass');
  assert.equal(c.doc.bp.map.tiles[0][10][10].t, 'grass');
  fire(dom.window, 'keydown', { key: 'y', ctrlKey: true });
  assert.equal(c.doc.bp.map.tiles[0][10][11].t, 'snow');
  // keys 1-9 switch tools
  fire(dom.window, 'keydown', { key: '4' });
  assert.equal(c.tool, 'road');
  c.dragTiles([P(20, 20), P(25, 20)]);
  for (let x = 20; x <= 25; x++) assert.equal(c.doc.bp.map.tiles[0][20][x].road, 3);
  fire(dom.window, 'keydown', { key: '5' });
  c.dragTiles([P(20, 30), P(22, 32)]);
  assert.equal(c.doc.bp.map.tiles[0][32][22].river, 1);
  fire(dom.window, 'keydown', { key: '3' });
  c.options.terrain = 'rough';
  c.clickTile(P(60, 60));
  assert.equal(c.doc.bp.map.tiles[0][70][70].t, 'rough');
  // towns, heroes, objects
  fire(dom.window, 'keydown', { key: '8' });
  c.options.townFaction = 'tower';
  c.options.townOwner = 0;
  c.clickTile(P(30, 40));
  assert.deepEqual(c.doc.bp.towns[0], { pos: P(30, 40), faction: 'tower', ownerSlot: 0 });
  assert.deepEqual(c.selection, { kind: 'town', index: 0 });
  fire(dom.window, 'keydown', { key: '9' });
  c.options.heroOwner = 0;
  c.clickTile(P(30, 40));
  assert.equal(c.doc.bp.heroes.length, 1);
  fire(dom.window, 'keydown', { key: '6' });
  c.options.entry = 'gold_mine';
  c.options.owner = 1;
  c.clickTile(P(40, 40));
  const mine = Object.values(c.doc.bp.map.objects).find((o) => o.defId === 'gold_mine');
  assert.equal(mine.owner, 1);
  // placing on top fails with a toast and changes nothing
  const n = Object.keys(c.doc.bp.map.objects).length;
  await quiet(async () => c.clickTile(P(40, 40)));
  assert.equal(Object.keys(c.doc.bp.map.objects).length, n);
  // the object browser lists entries with thumbnails
  assert.ok(app.layers.screen.querySelectorAll('.ed-browser .k-list-row').length > 0);
  // erase
  fire(dom.window, 'keydown', { key: '7' });
  c.clickTile(P(40, 40));
  assert.equal(Object.values(c.doc.bp.map.objects).filter((o) => o.defId === 'gold_mine').length, 0);
  c.clickTile(P(30, 40));
  assert.equal(c.doc.bp.heroes.length, 0, 'erasing the gate tile removes the hero first');
  assert.equal(app.layers.error.children.length, 0);
});

test('select, move by drag, inspector apply, delete key', async () => {
  const c = await mountEditor();
  c.setTool('object');
  c.options.entry = 'monster';
  c.clickTile(P(10, 10));
  const id = Object.keys(c.doc.bp.map.objects)[0];
  c.setTool('select');
  c.clickTile(P(10, 10));
  assert.deepEqual(c.selection, { kind: 'object', id });
  const insp = app.layers.screen.querySelector('.ed-inspector');
  assert.match(insp.textContent, /Monster/);
  // edit count through the input and Apply
  const countInput = insp.querySelectorAll('input').find((i) => i.dataset && i.dataset.field === 'count');
  countInput.value = '77';
  fire(countInput, 'input');
  btnIn(insp, 'Apply').click();
  assert.equal(c.doc.bp.map.objects[id].data.count, 77);
  // drag-move
  c.dragTiles([P(10, 10), P(14, 12)]);
  assert.deepEqual(c.doc.bp.map.objects[id].pos, P(14, 12));
  assert.equal(c.doc.bp.map.objects[id].data.count, 77);
  fire(dom.window, 'keydown', { key: 'Delete' });
  assert.equal(c.doc.bp.map.objects[id], undefined);
  fire(dom.window, 'keydown', { key: 'z', ctrlKey: true });
  assert.ok(c.doc.bp.map.objects[id]);
});

test('save to the library, open it again, export text; validate dialog lists problems and jumps', async () => {
  const c = await mountEditor();
  c.setTool('town');
  c.options.townOwner = 0;
  c.clickTile(P(10, 10));
  const saving = c.menuSave();
  await until(() => document.body.querySelector('.k-prompt input'));
  document.body.querySelector('.k-prompt input').value = 'My Test Map';
  document.body.querySelectorAll('.k-dlg-buttons .k-btn')[0].click();
  const r = await saving;
  assert.ok(r.ok);
  assert.equal(c.savedId, 'my_test_map');
  assert.equal(c.doc.bp.meta.name, 'My Test Map');
  assert.doesNotMatch(app.layers.screen.querySelector('.ed-title').textContent, /\*/);
  assert.equal(c.library.list().length, 1);
  // a second save does not ask again
  assert.ok((await c.menuSave()).ok);
  // new map, then open the saved one through the dialog
  c.setDoc(E.newMap({ size: 'S' }));
  const opening = c.menuOpen();
  await until(() => topDialog() && /Open map/.test(topDialog().textContent));
  topDialog().querySelectorAll('.k-list-row')[0].click();
  await clickDialog('Open');
  await opening;
  assert.equal(c.doc.bp.meta.name, 'My Test Map');
  assert.equal(c.doc.bp.towns.length, 1);
  const text = c.menuExport();
  assert.equal(JSON.parse(text).format, 'h3online-map');
  // import of that text works too
  c.importText(text, 'x');
  assert.equal(c.doc.bp.towns.length, 1);
  // validate: slot 2 has nothing -> error with a jump
  const v = c.menuValidate();
  await until(() => topDialog() && /Validate map/.test(topDialog().textContent));
  assert.match(topDialog().textContent, /error/i);
  assert.match(topDialog().textContent, /player slot 1 has neither town nor hero/);
  const row = topDialog().querySelectorAll('.ed-problem').find((x) => x.textContent.includes('Player 1 has') || x.textContent.includes('unreachable'));
  if (row) row.click(); else await clickDialog('Close');
  await v;
});

test('Play: an invalid map shows the problems; a valid one starts a game in the adventure screen', async () => {
  const shown = [];
  const c = await mountEditor({ fresh: true }, { adventure: { mount: (r, ctx, p) => { shown.push({ state: ctx.state, p }); }, unmount() {} } });
  const playing = c.menuPlay();
  await until(() => topDialog() && /Validate map/.test(topDialog().textContent));
  await clickDialog('Close');
  assert.equal(await playing, null);
  // build a valid 2-player map through the tools
  c.setTool('town');
  c.options.townFaction = 'castle'; c.options.townOwner = 0; c.clickTile(P(10, 10));
  c.options.townFaction = 'inferno'; c.options.townOwner = 1; c.clickTile(P(60, 60));
  c.setTool('hero');
  c.options.heroOwner = 0; c.clickTile(P(10, 10));
  c.options.heroOwner = 1; c.clickTile(P(60, 60));
  assert.ok(E.validateMap(c.doc.bp).ok);
  const p2 = c.menuPlay();
  await until(() => topDialog() && /Play/.test(topDialog().textContent));
  await clickDialog('Start');
  await p2;
  await until(() => app.screen === 'adventure');
  assert.equal(shown.length, 1);
  const st = shown[0].state;
  assert.equal(st.players.length, 2);
  assert.equal(st.players[0].isHuman, true);
  assert.equal(Object.keys(st.towns).length, 2);
  assert.equal(shown[0].p.newGame, true);
  // coming back to the editor keeps the document
  await quiet(() => app.showScreen('editor'));
  assert.equal(screen.getController().doc.bp.towns.length, 2);
});

test('map settings dialog applies name, players and conditions as one undo step', async () => {
  const c = await mountEditor();
  c.setTool('town');
  c.options.townOwner = null;
  c.clickTile(P(10, 10));
  const n = c.doc.undo.length;
  const p = c.menuSettings();
  await until(() => topDialog() && /Map settings/.test(topDialog().textContent));
  const d = topDialog();
  const nameInput = d.querySelectorAll('input').find((i) => i.value === 'New map');
  nameInput.value = 'Settled';
  fire(nameInput, 'input');
  const selects = d.querySelectorAll('select');
  // first select of the players box = player count; pick 3 players
  const countSel = selects.find((s) => s.querySelectorAll('option').some((o) => o.textContent === '3 players'));
  countSel.value = String(2);
  fire(countSel, 'change');
  // victory: capture a town
  const vicSel = topDialog().querySelectorAll('select').find((s) => s.querySelectorAll('option').some((o) => o.textContent === 'Capture a town'));
  vicSel.value = String(1);
  fire(vicSel, 'change');
  await clickDialog('Apply');
  assert.equal(await p, true);
  assert.equal(c.doc.bp.meta.name, 'Settled');
  assert.equal(c.doc.bp.meta.playerSlots, 3);
  assert.deepEqual(c.doc.bp.victory, { type: 'capture_town', townIndex: 0 });
  assert.equal(c.doc.undo.length, n + 1);
});

test('main menu has a Map Editor entry (key M)', async () => {
  makeApp();
  await quiet(() => app.start());
  const labels = app.layers.screen.querySelectorAll('.mm-item').map((b) => b.textContent);
  assert.ok(labels.some((l) => l.includes('Map Editor')));
  fire(dom.window, 'keydown', { key: 'm' });
  await until(() => app.screen === 'editor' && screen.getController());
  assert.ok(app.layers.screen.querySelector('.ed-root'));
});

test('new game: custom maps from the editor library are listed and start a game', async () => {
  const shown = [];
  makeApp({ adventure: { mount: (r, ctx) => { shown.push(ctx.state); }, unmount() {} } });
  const doc = E.newMap({ size: 'S', name: 'Custom duel' });
  E.placeObject(doc, 'town', P(6, 6), { faction: 'castle', ownerSlot: 0 });
  E.placeObject(doc, 'town', P(28, 28), { faction: 'dungeon', ownerSlot: 1 });
  E.setVictory(doc, { type: 'survive', days: 50 });
  assert.ok(createMapLibrary(app.ctx.storage).save(doc.bp).ok);
  // model
  const setup = NG.createSetup();
  NG.setMapType(setup, 'custom');
  assert.equal(NG.validateSetup(setup).ok, false);
  NG.setCustomMap(setup, { id: 'custom_duel', playerSlots: 2 });
  assert.ok(NG.validateSetup(setup).ok);
  assert.deepEqual(NG.buildMapOptions(setup).type, 'custom');
  // screen
  await quiet(() => app.start('newGame'));
  const root = app.layers.screen;
  const tab = root.querySelectorAll('.k-btn').find((b) => b.textContent.includes('Custom maps (1)'));
  assert.ok(tab);
  tab.click();
  await tick();
  assert.match(root.querySelector('.ng-scenarios').textContent, /Custom duel/);
  assert.match(root.querySelector('.ng-rules').textContent, /survive/);
  root.querySelectorAll('.k-btn').find((b) => b.textContent.includes('Start Game')).click();
  await until(() => app.screen === 'adventure', 4000);
  assert.equal(shown[0].meta.name, 'Custom duel');
  assert.equal(shown[0].settings.victory.type, 'survive');
});

test('new game custom maps honour slot permissions, allowed towns and keep slot numbers', () => {
  const doc = E.newMap({ size: 'S', players: 3, name: 'Seats' });
  E.placeObject(doc, 'town', P(6, 6), { faction: 'castle', ownerSlot: 0 });
  E.placeObject(doc, 'random_town', P(28, 6), { ownerSlot: 1 });
  E.placeObject(doc, 'random_town', P(28, 28), { ownerSlot: 2 });
  E.placeObject(doc, 'gold_mine', P(15, 20), { owner: 2 });
  E.setPlayer(doc, 1, { human: false, factions: ['fortress', 'stronghold'] });
  E.setPlayer(doc, 2, { factions: ['inferno'] });
  const lib = createMapLibrary(memoryRecords());
  const meta = lib.save(doc.bp).meta;
  const setup = NG.createSetup();
  NG.setMapType(setup, 'custom');
  NG.setCustomMap(setup, meta);
  assert.deepEqual(setup.players.slice(0, 4).map((p) => p.type), ['human', 'ai', 'ai', 'closed']);
  assert.equal(NG.setSlotType(setup, 1, 'human'), false, 'slot 2 is computer-only');
  assert.equal(NG.setSlotType(setup, 3, 'ai'), false, 'the map has three slots');
  assert.deepEqual(NG.allowedFactions(setup, 1).sort(), ['fortress', 'stronghold']);
  assert.equal(NG.setSlotFaction(setup, 1, 'castle'), false);
  assert.ok(NG.setSlotFaction(setup, 1, 'fortress'));
  assert.equal(setup.players[2].faction, 'inferno', 'single allowed town is preselected');
  // close the middle seat: slots keep their numbers
  assert.ok(NG.setSlotType(setup, 1, 'closed'));
  assert.ok(NG.validateSetup(setup).ok);
  const settings = NG.buildGameSettings(setup);
  assert.deepEqual(settings.players.map((p) => p.slot), [0, 2]);
  const state = game.createGame(lib.load(meta.id).bp, settings);
  assert.equal(state.players[1].faction, 'inferno');
  const mine = Object.values(state.map.objects).find((o) => o.defId === 'gold_mine');
  assert.equal(mine.owner, 1, 'slot 2 owner -> player 1');
  assert.equal(Object.values(state.towns).filter((t) => t.owner == null).length, 1, 'the unplayed slot\'s town is neutral');
  // "Random town" respects the allowed towns
  const s2 = NG.createSetup();
  NG.setMapType(s2, 'custom');
  NG.setCustomMap(s2, meta);
  const st2 = game.createGame(lib.load(meta.id).bp, NG.buildGameSettings(s2));
  assert.ok(['fortress', 'stronghold'].includes(st2.players[1].faction));
});

test('pickers: searchable sprite lists for creature / artifact / spell / hero / skill fields in the inspector', async () => {
  const PK = await import('../../src/ui/screens/editor/pickers.js');
  for (const k of ['creature', 'artifact', 'spell', 'hero', 'skill']) assert.ok(PK.pickerItems(k).length > 10, k);
  assert.ok(PK.filterPicker(PK.pickerItems('creature'), 'arch angel').some((e) => e.id === 'arch_angel'));
  const c = await mountEditor();
  c.setTool('object');
  c.options.entry = 'monster';
  c.clickTile(P(10, 10));
  const id = Object.keys(c.doc.bp.map.objects)[0];
  c.setTool('select');
  c.clickTile(P(10, 10));
  const insp = app.layers.screen.querySelector('.ed-inspector');
  const field = insp.querySelector('[data-picker="creature"]');
  assert.ok(field);
  btnIn(field, 'Choose').click();
  await until(() => topDialog() && topDialog().querySelector('.ed-pick-list'));
  const search = topDialog().querySelector('.ed-search');
  search.value = 'black dragon';
  fire(search, 'input');
  const rows = topDialog().querySelectorAll('.ed-pick-list .k-list-row');
  assert.equal(rows.length, 1);
  rows[0].click();
  await clickDialog('Choose');
  btnIn(app.layers.screen.querySelector('.ed-inspector'), 'Apply').click();
  assert.equal(c.doc.bp.map.objects[id].data.creatureId, 'black_dragon');
  // hero inspector: army / skills / spells / artifacts pickers, applied as starting-hero extras
  c.setTool('hero');
  c.clickTile(P(20, 20));
  c.setTool('select');
  c.clickTile(P(20, 20));
  const hi = app.layers.screen.querySelector('.ed-inspector');
  for (const k of ['hero', 'stacks', 'skills', 'spells', 'artifacts']) assert.ok(hi.querySelector(`[data-picker="${k}"]`), k);
  btnIn(hi.querySelector('[data-picker="stacks"]'), 'Add').click();
  await until(() => topDialog() && topDialog().querySelector('.ed-pick-list'));
  topDialog().querySelectorAll('.ed-pick-list .k-list-row')[0].click();
  await clickDialog('Choose');
  btnIn(app.layers.screen.querySelector('.ed-inspector'), 'Apply').click();
  assert.equal(c.doc.bp.heroes[0].army.length, 1);
  assert.equal(c.doc.bp.heroes[0].army[0].count, 10);
});

test('timed events dialog adds and edits map-wide events', async () => {
  const c = await mountEditor();
  const p = c.menuEvents();
  await until(() => topDialog() && /Timed events/.test(topDialog().textContent));
  await clickDialog('Add');
  await until(() => topDialog() && /Timed event/.test(topDialog().querySelector('.k-dlg-title').textContent) && topDialog().querySelector('textarea'));
  const form = topDialog();
  const name = form.querySelectorAll('input').find((i) => i.maxLength === 40);
  name.value = 'Tribute';
  fire(name, 'input');
  const ta = form.querySelector('textarea');
  ta.value = 'The peasants pay.';
  fire(ta, 'input');
  await clickDialog('OK');
  await until(() => topDialog() && /Timed events/.test(topDialog().textContent) && /Tribute/.test(topDialog().textContent));
  await clickDialog('Close');
  await p;
  assert.deepEqual(c.doc.bp.events, [{ name: 'Tribute', day: 1, repeat: 0, message: 'The peasants pay.' }]);
  fire(dom.window, 'keydown', { key: 'z', ctrlKey: true });
  assert.equal(c.doc.bp.events.length, 0);
});

test('main menu switches to two columns when it has more than 7 entries', async () => {
  makeApp();
  await quiet(() => app.start());
  assert.ok(!app.layers.screen.querySelector('.mm-menu').classList.contains('is-two-col'));
  app.ctx.setState({ turn: 3, date: { day: 3, week: 1, month: 1 }, currentPlayer: 0, pending: [], players: [{ id: 0, color: 'red', name: 'A', isHuman: true }], map: { width: 8, height: 8, levels: 1 }, settings: {} }, { silent: true });
  await quiet(() => app.showScreen('mainMenu'));
  const menu = app.layers.screen.querySelector('.mm-menu');
  assert.equal(menu.querySelectorAll('.mm-item').length, 9);
  assert.ok(menu.classList.contains('is-two-col'));
});

test('day-1 timed events are shown to the concerned human when his first turn starts', async () => {
  const heroEngine = await import('../../src/engine/hero.js');
  await heroEngine.engineReady;
  const doc = E.newMap({ size: 'S', players: 2 });
  E.placeObject(doc, 'town', P(6, 6), { faction: 'castle', ownerSlot: 0 });
  E.placeObject(doc, 'town', P(28, 28), { faction: 'inferno', ownerSlot: 1 });
  E.addTimedEvent(doc, { name: 'Welcome', day: 1, players: [0], message: 'The harvest was rich.', resources: { gold: 700 } });
  E.addTimedEvent(doc, { name: 'Other', day: 1, players: [1], message: 'Not for you.' });
  game.setAiDriver(null);
  const state = game.createGame(E.prepareForPlay(doc.bp), E.buildPlaySettings(doc.bp, E.defaultSeats(doc.bp), { seed: 3 }));
  makeApp();
  app.settings.set('autosave', false);
  app.ctx.setState(state, { silent: true });
  await quiet(() => app.showScreen('adventure', { newGame: true }));
  await until(() => topDialog() && /harvest was rich/.test(topDialog().textContent), 4000);
  assert.match(topDialog().textContent, /700 gold/);
  assert.doesNotMatch(topDialog().textContent, /Not for you/);
  assert.ok(state.log.find((l) => l.type === 'timed_event' && l.playerId === 0).shown);
});
