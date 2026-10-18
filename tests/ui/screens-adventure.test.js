// Adventure map screen (src/ui/screens/adventure/*) on a real createGame state, fake DOM + no-op 2D context.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, createFakeStorage, fire, tick, until } from './fakeDom.js';

const dom = installFakeDom();
const { createApp } = await import('../../src/ui/app.js');
const ui = await import('../../src/ui/kit/index.js');
const adv = await import('../../src/engine/adventure/index.js');
const game = await import('../../src/engine/game.js');
const heroEngine = await import('../../src/engine/hero.js');
const pendingEngine = await import('../../src/engine/pending.js');
const combatEngine = await import('../../src/engine/combat/index.js').catch(() => null); // may be mid-rewrite by its owner
const screen = await import('../../src/ui/screens/adventure/index.js');
const model = await import('../../src/ui/screens/adventure/model.js');
const { ADVENTURE_PENDING_RENDERERS: R, setHeroTradeLoader, altarArtifacts } = await import('../../src/ui/screens/adventure/pendings.js');
const { createMapView } = await import('../../src/ui/screens/adventure/mapView.js');

await heroEngine.engineReady;
/** Stand-in combat engine while the real one is unavailable: the attacker always wins without losses. */
const fakeCombat = {
  createCombat: (input) => ({ phase: 'battle', input: JSON.parse(JSON.stringify(input)) }),
  isOver: (cs) => cs.phase === 'over',
  autoResolve(cs) { cs.phase = 'over'; return fakeCombat.getResult(cs); },
  getResult: (cs) => ({
    winner: 'attacker', rounds: 1,
    attacker: { army: cs.input.attacker.army, losses: {}, manaLeft: cs.input.attacker.hero ? cs.input.attacker.hero.mana : 0, heroFled: false, heroSurrendered: false, warMachinesLost: [] },
    defender: { army: [null, null, null, null, null, null, null], losses: {}, manaLeft: 0, heroFled: false, heroSurrendered: false, warMachinesLost: [] },
    expAttacker: 100, expDefender: 0,
  }),
};
const combatImpl = combatEngine || fakeCombat;
if (!combatEngine) heroEngine.setCombatEngine(fakeCombat);
const MODULES = { game, pending: pendingEngine, combat: combatImpl, hero: heroEngine, adventure: adv };

let app = null;
const quiet = async (fn) => {
  const saved = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};

/** 60x40 grass map with an underground level, two towns, two heroes, a mine and a monster. */
function makeState({ humans = [true, false], width = 60, height = 40 } = {}) {
  game.setAiDriver(null);
  const map = adv.createEmptyMap(width, height, 2, 'grass');
  for (const row of map.tiles[1]) for (const t of row) t.t = 'subterranean';
  for (let x = 0; x < width; x++) map.tiles[0][20][x].t = x > 30 ? 'sand' : 'grass';
  const blueprint = {
    map,
    towns: [{ pos: { x: 6, y: 6, z: 0 }, faction: 'castle', ownerSlot: 0 }, { pos: { x: 50, y: 30, z: 0 }, faction: 'inferno', ownerSlot: 1 }],
    heroes: [{ ownerSlot: 0, pos: { x: 10, y: 10, z: 0 }, defId: 'orrin' }, { ownerSlot: 1, pos: { x: 50, y: 33, z: 0 }, defId: 'random' }],
    meta: { name: 'Test', playerSlots: 2 },
  };
  const state = game.createGame(blueprint, {
    seed: 7, difficulty: 1,
    players: [{ slot: 0, isHuman: humans[0], color: 'red', name: 'Ann' }, { slot: 1, isHuman: humans[1], color: 'blue', name: 'Bob' }],
  });
  const mine = adv.addObject(state, 'gold_mine', { x: 16, y: 10, z: 0 });
  const monster = adv.addObject(state, 'monster', { x: 13, y: 14, z: 0 }, { data: { creatureId: 'pikeman', count: 15, disposition: 'hostile', neverFlees: true } });
  return { state, mine, monster, heroId: state.players[0].heroes[0], enemyId: state.players[1].heroes[0] };
}

function makeApp({ settings = {} } = {}) {
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
    screens: {
      mainMenu: { mount(r) { r.appendChild(ui.h('div.scr-main', null, 'menu')); }, unmount() {} },
      town: { mount(r, c, p) { r.appendChild(ui.h('div.scr-town', null, p.townId)); }, unmount() {} },
      hero: { mount(r, c, p) { r.appendChild(ui.h('div.scr-hero', null, p.heroId)); }, unmount() {} },
      combat: { mount(r) { r.appendChild(ui.h('div.scr-combat', null, 'combat')); }, unmount() {} },
    },
  });
  app.anim.setSpeed(Infinity);
  app.settings.set('autosave', false);
  for (const [k, v] of Object.entries(settings)) app.settings.set(k, v);
  return app;
}

async function mountWith(state, params = { newGame: true }, opts = {}) {
  makeApp(opts);
  app.ctx.setState(state, { silent: true });
  await quiet(() => app.showScreen('adventure', params));
  const ctrl = screen.getController();
  assert.ok(ctrl, 'controller mounted');
  await ctrl.ready;
  return ctrl;
}

const dialogs = () => ui.getLayer('dialogs').querySelectorAll('.k-dlg');
const topDialog = () => { const d = dialogs(); return d[d.length - 1] || null; };
const buttonIn = (el, label) => el.querySelectorAll('button').find((b) => b.textContent.includes(label));
async function clickDialogButton(label) {
  const d = await until(() => topDialog() && buttonIn(topDialog(), label) && topDialog());
  buttonIn(d, label).click();
  await tick();
}

afterEach(async () => {
  ui.closeAllDialogs();
  game.setAiDriver(null);
  if (app) await quiet(() => app.destroy());
  app = null;
});

// ---- mount ----------------------------------------------------------------------------------------

test('mounts on a createGame state: map canvas, panel lists, info box, resource bar, hero selected', async () => {
  const { state, heroId } = makeState();
  const ctrl = await mountWith(state);
  const root = app.layers.screen;
  assert.ok(root.querySelector('.adv-root'));
  assert.ok(root.querySelector('canvas.adv-map-canvas'));
  assert.equal(root.querySelectorAll('.adv-hero-item').length, 1);
  assert.equal(root.querySelectorAll('.adv-town-item').length, 1);
  assert.equal(ctrl.selectedHero, heroId);
  assert.match(root.querySelector('.adv-infobox').textContent, /Orrin/);
  assert.match(root.querySelector('.k-resbar-date').textContent, /Month 1, Week 1, Day 1/);
  assert.equal(root.querySelectorAll('.adv-buttons button').length, 10);
  assert.ok(ctrl.mapView.stats.frames >= 1);
  // panel button to the town list selects the town
  fire(root.querySelector('.adv-town-item'), 'click');
  assert.equal(ctrl.selectedTown, state.players[0].towns[0]);
  assert.equal(ctrl.selectedHero, null);
});

test('without a game the screen shows a placeholder', async () => {
  makeApp();
  await quiet(() => app.showScreen('adventure', {}));
  assert.match(app.layers.screen.textContent, /No game in progress/);
});

// ---- movement ---------------------------------------------------------------------------------------

test('select hero and two-click move: first click previews the path, second click moves the hero', async () => {
  const { state, heroId } = makeState();
  const ctrl = await mountWith(state);
  const hero = state.heroes[heroId];
  const before = hero.movePoints;
  const canvas = ctrl.mapView.canvas;
  const at = (x, y) => { const p = ctrl.mapView.tileToScreen(x, y); return { button: 0, clientX: p.x + 5, clientY: p.y + 5 }; };
  fire(canvas, 'click', at(13, 10));
  await tick();
  assert.ok(ctrl.mapView.path, 'path preview shown');
  assert.equal(ctrl.mapView.markers.length, 3);
  assert.deepEqual(ctrl.destinations.get(heroId), { x: 13, y: 10, z: 0 });
  assert.equal(hero.pos.x, 10, 'not moved yet');
  fire(canvas, 'click', at(13, 10));
  await until(() => !ctrl.busy && hero.pos.x === 13);
  assert.deepEqual([hero.pos.x, hero.pos.y], [13, 10]);
  assert.ok(hero.movePoints < before);
  assert.equal(ctrl.mapView.path, null, 'arrived: preview cleared');
  assert.equal(ctrl.mapView.heroAnim, null);
});

test('clicking an object footprint paths to its entrance; long paths mark later days', async () => {
  const { state, heroId, mine } = makeState();
  const ctrl = await mountWith(state);
  await ctrl.clickTile({ x: 15, y: 9, z: 0 });
  assert.deepEqual(ctrl.destinations.get(heroId), { x: mine.pos.x, y: mine.pos.y, z: 0 });
  await ctrl.clickTile({ x: 40, y: 25, z: 0 });
  const m = ctrl.mapView.markers;
  assert.ok(m.some((x) => x.today) && m.some((x) => !x.today), 'green + red steps');
  assert.ok(m.some((x) => x.dayMarker), 'day marker');
  assert.ok(m[m.length - 1].last);
});

test('moving into a guarded monster with quick combat resolves the battle and shows the result', async () => {
  const { state, heroId, monster } = makeState();
  state.heroes[heroId].army = [{ creatureId: 'arch_angel', count: 20 }, null, null, null, null, null, null];
  state.heroes[heroId].pos = { x: 13, y: 12, z: 0 };
  const ctrl = await mountWith(state, {}, { settings: { quickCombat: true } });
  ctrl.selectHero(heroId);
  ctrl.previewPath({ x: monster.pos.x, y: monster.pos.y, z: 0 });
  const p = ctrl.moveSelected();
  await clickDialogButton('OK');
  await p;
  assert.equal(state.combat, null);
  assert.equal(state.map.objects[monster.id], undefined, 'monster defeated');
});

test('a started battle without quick combat goes to the combat screen', async () => {
  const { state, heroId, monster } = makeState();
  state.heroes[heroId].pos = { x: 13, y: 12, z: 0 };
  const ctrl = await mountWith(state);
  ctrl.previewPath({ x: monster.pos.x, y: monster.pos.y, z: 0 });
  await ctrl.moveSelected();
  await until(() => app.screen === 'combat');
  assert.ok(state.combat, 'combat state kept for the combat screen');
});

test('entering an own town opens the town screen; clicking the selected hero opens the hero screen', async () => {
  const { state, heroId } = makeState();
  const town = state.towns[state.players[0].towns[0]];
  const ctrl = await mountWith(state);
  await ctrl.clickTile({ x: heroId && state.heroes[heroId].pos.x, y: state.heroes[heroId].pos.y, z: 0 });
  await until(() => app.screen === 'hero');
  const ctrl2 = await (async () => { await quiet(() => app.showScreen('adventure', {})); const c = screen.getController(); await c.ready; return c; })();
  ctrl2.selectHero(heroId);
  ctrl2.previewPath({ x: town.pos.x, y: town.pos.y, z: 0 });
  await ctrl2.moveSelected();
  await until(() => app.screen === 'town' && app.layers.screen.querySelector('.scr-town'));
  assert.match(app.layers.screen.textContent, new RegExp(town.id));
});

test('hero meeting opens the trade dialog through openHeroTrade', async () => {
  const { state, heroId } = makeState();
  const other = heroEngine.addHero(state, 'valeska', 0, { x: 12, y: 10, z: 0 });
  const calls = [];
  setHeroTradeLoader(async () => ({ openHeroTrade: (c, a, b) => { calls.push([a, b]); return Promise.resolve(); } }));
  const ctrl = await mountWith(state);
  ctrl.selectHero(heroId);
  ctrl.previewPath({ x: 12, y: 10, z: 0 });
  await ctrl.moveSelected();
  assert.deepEqual(calls, [[heroId, other.id]]);
  assert.equal(state.pending.length, 0);
  setHeroTradeLoader(() => import('../../src/ui/screens/dialogs/heroTrade.js'));
});

// ---- rendering --------------------------------------------------------------------------------------

test('renderer draws only the visible window and caches terrain chunks', async () => {
  const { state } = makeState({ width: 100, height: 80 });
  const ctrl = await mountWith(state);
  const v = ctrl.mapView;
  v.centerOnTile(50, 40);
  v.render(true);
  const r = v.visibleTiles();
  assert.equal(v.stats.tilesDrawn, (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1));
  assert.ok(v.stats.tilesDrawn < 100 * 80 / 4);
  const renders = v.stats.chunkRenders;
  v.render(true);
  assert.equal(v.stats.chunkRenders, renders, 'second frame reuses the chunks');
  assert.equal(v.ts, 48, 'default zoom: 48 px tiles');
  v.zoom(-1);
  assert.equal(v.ts, 32);
  v.render(true);
  assert.ok(v.stats.chunkRenders > renders, 'zoom re-renders chunks at the new size');
  assert.ok(v.chunkCount() <= 48);
  // a recording context sees no draw outside the window: shroud fills stay within the visible rows
  const calls = [];
  const rec = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); }), set: (t, k, val) => { t[k] = val; return true; } });
  v.markDirty();
  v.render(false, rec);
  assert.ok(calls.some((c) => c[0] === 'drawImage'));
});

test('minimap click moves the camera; level switch toggles the underground', async () => {
  const { state } = makeState();
  const ctrl = await mountWith(state);
  const v = ctrl.mapView;
  const mm = app.layers.screen.querySelector('.adv-minimap canvas');
  fire(mm, 'mousedown', { button: 0, clientX: 224 * 0.9, clientY: 224 * 0.9 });
  fire(window, 'mouseup', { button: 0 });
  const c = v.cam.center();
  assert.ok(c.x / v.ts > 40 && c.y / v.ts > 25, `camera moved (${c.x / v.ts}, ${c.y / v.ts})`);
  assert.equal(v.level, 0);
  fire(app.layers.screen.querySelector('[data-btn="level"]'), 'click');
  assert.equal(v.level, 1);
  ctrl.button('level');
  assert.equal(v.level, 0);
  const px = model.minimapPixels(state, 0, 0);
  assert.equal(px.length, 60 * 40 * 4);
});

test('right-click info: terrain, unexplored, mine, monster, town, own and enemy hero', async () => {
  const { state, heroId, enemyId, mine, monster } = makeState();
  const ex = state.players[0].explored[0];
  for (let i = 0; i < ex.length; i++) if (i % 60 < 58) ex[i] = 1;
  const ctrl = await mountWith(state);
  const info = (x, y, z = 0) => ctrl.rightInfo({ x, y, z }, { clientX: 1, clientY: 1 });
  assert.match(info(20, 25).title, /Grass/);
  assert.equal(info(59, 5).kind, 'unexplored');
  const m = info(mine.pos.x - 1, mine.pos.y - 1);
  assert.match(m.title, /Gold Mine/);
  state.map.objects[mine.id].owner = 1;
  assert.match(info(mine.pos.x, mine.pos.y).title, /owned by Blue/);
  const mon = info(monster.pos.x, monster.pos.y);
  assert.equal(mon.kind, 'monster');
  assert.equal(mon.title, 'A pack of Pikemen');
  assert.equal(mon.army[0].count, null, 'exact count hidden');
  const town = info(6, 6);
  assert.equal(town.kind, 'town');
  assert.match(town.lines.join(' '), /Castle town/);
  const own = info(state.heroes[heroId].pos.x, state.heroes[heroId].pos.y);
  assert.equal(own.kind, 'hero');
  assert.ok(own.own);
  assert.ok(own.army.every((s) => typeof s.count === 'number'));
  const e = state.heroes[enemyId];
  const enemy = info(e.pos.x, e.pos.y);
  assert.equal(enemy.own, false);
  assert.ok(enemy.lines.some((l) => /Blue player/.test(l)));
  // the starting castle has a tavern = thieves' guild level 1: primary skills, but no exact numbers
  assert.ok(enemy.lines.some((l) => /Attack/.test(l)), 'thieves guild 1 shows the primary skills');
  assert.ok(enemy.army.every((s) => s.count === null && /^(A|Several|Lots|Zounds)/i.test(s.label)));
  const enemy0 = model.describeHero(state, 0, e, { thievesLevel: 0 });
  assert.ok(!enemy0.lines.some((l) => /Attack/.test(l)), 'no primary skills without a thieves guild');
  assert.ok(ui.isInfoPopupOpen());
  fire(window, 'mouseup', { button: 2 });
  assert.ok(!ui.isInfoPopupOpen());
  // with a thieves' guild level of 2 the enemy's stats and exact numbers show
  const enemy2 = model.describeHero(state, 0, e, { thievesLevel: 2 });
  assert.ok(enemy2.lines.some((l) => /Attack/.test(l)));
  assert.ok(enemy2.army.every((s) => typeof s.count === 'number'));
  // hover text
  assert.match(model.hoverText(state, 0, mine.pos.x, mine.pos.y, 0, ctrl.mapView.index, heroId), /Gold Mine \(owned by Blue\)/);
});

test('rendering, hovering, info popups and minimap leave the JSON state untouched', async () => {
  const { state, heroId } = makeState();
  const ctrl = await mountWith(state);
  const before = JSON.stringify(state);
  const v = ctrl.mapView;
  for (let i = 0; i < 3; i++) { v.markDirty(); ctrl.frame(16); }
  fire(v.canvas, 'mousemove', { clientX: 300, clientY: 200 });
  ctrl.rightInfo({ x: 12, y: 12, z: 0 }, {});
  ctrl.rightInfo({ x: 59, y: 39, z: 1 }, {});
  ctrl.previewPath({ x: 20, y: 20, z: 0 });
  v.zoom(1); v.setLevel(1); v.render(true); v.setLevel(0); v.render(true);
  ctrl.panel.minimap.redraw();
  ctrl.refresh();
  assert.equal(JSON.stringify(state), before);
  assert.ok(heroId);
});

// ---- turn flow --------------------------------------------------------------------------------------

test('end turn: confirmation while heroes can move, AI driver runs, the next day starts', async () => {
  const { state } = makeState();
  const seen = [];
  const ctrl = await mountWith(state);
  game.setAiDriver((s, pid) => { seen.push(pid); return { ok: true, events: [] }; });
  const p = ctrl.endTurn();
  await clickDialogButton('Yes');
  await p;
  assert.deepEqual(seen, [1]);
  assert.equal(state.turn, 2);
  assert.equal(state.currentPlayer, 0);
  assert.equal(ctrl.aiOverlay.style.display, 'none');
  assert.match(app.layers.screen.querySelector('.k-resbar-date').textContent, /Day 2/);
  // declining the confirmation keeps the turn
  const q = ctrl.endTurn();
  await clickDialogButton('No');
  await q;
  assert.equal(state.turn, 2);
});

test('hotseat: a curtain hides the map for the next human player', async () => {
  const { state } = makeState({ humans: [true, true] });
  makeApp();
  app.ctx.setState(state, { silent: true });
  await quiet(() => app.showScreen('adventure', { newGame: true }));
  const ctrl = screen.getController();
  // the first human sees a curtain at the start of a hotseat game
  await until(() => ctrl.curtain.style.display === '');
  assert.match(ctrl.curtain.textContent, /Red player's turn/);
  buttonIn(ctrl.curtain, 'Begin turn').click();
  await ctrl.ready;
  assert.equal(ctrl.curtain.style.display, 'none');
  const p = ctrl.endTurn({ force: true });
  await until(() => ctrl.curtain.style.display === '');
  assert.match(ctrl.curtain.textContent, /Blue player's turn/);
  buttonIn(ctrl.curtain, 'Begin turn').click();
  await p;
  assert.equal(state.currentPlayer, 1);
  assert.equal(ctrl.viewerId(), 1);
  assert.equal(ctrl.selectedHero, state.players[1].heroes[0]);
});

test('week messages: "Astrologers proclaim the Week of ..."', async () => {
  const { state } = makeState();
  const ctrl = await mountWith(state);
  const p = ctrl.beginTurn([{ type: 'week_started', weekOf: { kind: 'normal', name: 'Week of the Squirrel' } }]);
  const d = await until(() => topDialog());
  assert.match(d.textContent, /Astrologers proclaim the Week of the Squirrel/);
  await clickDialogButton('OK');
  await p;
  assert.match(model.weekMessage({ kind: 'month_of', creatureId: 'imp', name: 'Month of the Imp' }, true), /Imps populations double|Imps/);
  assert.match(model.weekMessage({ kind: 'plague' }), /plague/i);
});

test('victory: eliminating the last enemy shows the score dialog, then the main menu', async () => {
  const { state, enemyId } = makeState();
  const ctrl = await mountWith(state);
  heroEngine.removeHero(state, enemyId, 'defeated');
  const t = state.players[1].towns[0];
  state.towns[t].owner = 0;
  state.players[0].towns.push(t);
  state.players[1].towns = [];
  const p = ctrl.endTurn({ force: true });
  const d = await until(() => topDialog());
  assert.match(d.textContent, /Victory|conquered/);
  assert.match(d.textContent, /Score/);
  assert.match(d.textContent, /Rank/);
  await clickDialogButton('Main menu');
  await p;
  await until(() => app.screen === 'mainMenu');
  assert.ok(state.gameOver && state.gameOver.winner === 0);
});

test('a leftover battle on mount offers quick combat', async () => {
  const { state, heroId, monster } = makeState();
  state.heroes[heroId].army = [{ creatureId: 'arch_angel', count: 20 }, null, null, null, null, null, null];
  const r = heroEngine.startCombat(state, { attackerHeroId: heroId, defender: { army: [{ creatureId: 'pikeman', count: 3 }, null, null, null, null, null, null] }, context: { kind: 'adv_monster', heroId, objectId: monster.id } });
  assert.ok(r.ok, r.error);
  makeApp();
  app.ctx.setState(state, { silent: true });
  await quiet(() => app.showScreen('adventure', {}));
  const ctrl = screen.getController();
  const d = await until(() => topDialog());
  assert.match(d.textContent, /Quick combat/);
  d.querySelectorAll('.k-choice').find((c) => /Quick/.test(c.textContent)).click();
  await clickDialogButton('OK');
  await ctrl.ready;
  assert.equal(state.combat, null);
});

// ---- adventure spells / digging / puzzle -------------------------------------------------------

test('dimension door picks a target tile on the map and teleports the hero', async () => {
  const { state, heroId } = makeState();
  const hero = state.heroes[heroId];
  hero.artifacts.equipped.spellbook = ['spellbook'];
  heroEngine.learnSpell(state, heroId, 'dimension_door', { force: true });
  hero.mana = 100;
  hero.skills.push({ id: 'air_magic', level: 3 });
  const ctrl = await mountWith(state);
  ctrl.selectHero(heroId);
  const p = ctrl.castSpell('dimension_door');
  await until(() => ctrl.picking);
  assert.notEqual(ctrl.pickHint.style.display, 'none');
  await ctrl.clickTile({ x: 12, y: 12, z: 0 });
  const res = await p;
  assert.ok(res && res.ok, res && res.error);
  assert.deepEqual([hero.pos.x, hero.pos.y], [12, 12]);
  assert.equal(ctrl.picking, false);
});

test('digging without full movement is refused; puzzle map renders the obelisk progress', async () => {
  const { state, heroId } = makeState();
  const ctrl = await mountWith(state);
  ctrl.selectHero(heroId);
  state.heroes[heroId].movePoints = 10;
  const res = await ctrl.dig();
  assert.equal(res.ok, false);
  const h = ctrl.puzzle();
  assert.ok(h.model.progress.total >= 0);
  assert.match(h.el.textContent, /obelisk/i);
  h.close();
});

// ---- pending renderers ---------------------------------------------------------------------------

function pend(kind, options, data = {}, heroId = null) {
  return { id: 99, kind, playerId: 0, heroId, options, data };
}

test('pending renderers: confirm kinds, chest, primary, skill, overflow, monsters, town portal', async () => {
  const { state, heroId } = makeState();
  makeApp();
  app.ctx.setState(state, { silent: true });
  const ctx = app.ctx;
  const yesNo = [{ id: 'yes' }, { id: 'no' }];
  for (const kind of ['confirm_fight', 'confirm_pay', 'confirm_open', 'confirm_search', 'confirm_quest', 'confirm_pass', 'confirm_whirlpool']) {
    const p = R[kind](pend(kind, yesNo, { defId: 'creature_bank_cyclops' in {} ? 'x' : 'pandoras_box', guards: [{ creatureId: 'pikeman', count: 12 }, null], cost: { gold: 100 }, quest: { type: 'reach_level', level: 5 } }), ctx);
    const d = await until(() => topDialog());
    if (kind === 'confirm_fight') assert.match(d.textContent, /A pack of Pikemen/);
    buttonIn(d, kind === 'confirm_pass' ? 'No' : 'Yes').click();
    assert.deepEqual(await p, { optionIndex: kind === 'confirm_pass' ? 1 : 0 });
  }
  let p = R.chest_choice(pend('chest_choice', [{ id: 'gold', gold: 1500 }, { id: 'exp', exp: 1000 }]), ctx);
  (await until(() => topDialog())).querySelectorAll('.k-choice')[1].click();
  assert.deepEqual(await p, { optionIndex: 1 });
  p = R.primary_choice(pend('primary_choice', [{ id: 'attack', stat: 'attack', value: 1 }, { id: 'defense', stat: 'defense', value: 1 }, { id: 'decline' }], { cost: { gold: 1000 } }), ctx);
  assert.match(topDialog().textContent, /Defense/);
  topDialog().querySelectorAll('.k-choice')[2].click();
  assert.deepEqual(await p, { optionIndex: 2 });
  p = R.skill_choice(pend('skill_choice', [{ id: 'logistics', skillId: 'logistics', available: false }, { id: 'archery', skillId: 'archery', available: true }, { id: 'decline' }], { level: 1 }), ctx);
  const cards = topDialog().querySelectorAll('.k-choice');
  assert.ok(cards[0].disabled, 'unavailable skill disabled');
  cards[1].click();
  assert.deepEqual(await p, { optionIndex: 1 });
  p = R.army_overflow(pend('army_overflow', [{ id: 'dismiss', slot: 0, creatureId: 'pikeman', count: 5 }, { id: 'leave' }], { creatureId: 'imp', count: 10 }), ctx);
  topDialog().querySelectorAll('.k-choice')[0].click();
  assert.deepEqual(await p, { optionIndex: 0 });
  p = R.monster_join(pend('monster_join', yesNo, { creatureId: 'pikeman', count: 20, cost: 400 }), ctx);
  assert.match(topDialog().textContent, /400 gold/);
  buttonIn(topDialog(), 'Fight').click();
  assert.deepEqual(await p, { optionIndex: 1 });
  p = R.monster_flee(pend('monster_flee', yesNo, { creatureId: 'imp', sizeLabel: 'pack' }), ctx);
  buttonIn(topDialog(), 'Pursue').click();
  assert.deepEqual(await p, { optionIndex: 0 });
  const townId = state.players[0].towns[0];
  p = R.town_portal(pend('town_portal', [{ id: townId, townId }, { id: 'cancel' }], { spellId: 'town_portal' }, heroId), ctx);
  topDialog().querySelectorAll('.k-choice')[0].click();
  assert.deepEqual(await p, { optionIndex: 0 });
  p = R.build_boat(pend('build_boat', yesNo, { cost: { gold: 1000, wood: 10 } }), ctx);
  buttonIn(topDialog(), 'Build').click();
  assert.deepEqual(await p, { optionIndex: 0 });
});

test('pending renderers: list dialogs (university, black market, hill fort, war machines, tavern)', async () => {
  const { state } = makeState();
  makeApp();
  app.ctx.setState(state, { silent: true });
  const ctx = app.ctx;
  const leave = { id: 'leave' };
  const cases = [
    ['university', [{ id: 'buy', skillId: 'wisdom', cost: { gold: 2000 }, available: true }, { id: 'buy', skillId: 'logistics', cost: { gold: 2000 }, available: false }, leave], 0],
    ['buy_artifact', [{ id: 'buy', slot: 0, artifactId: 'centaurs_axe', cost: { gold: 2000 } }, leave], 0],
    ['upgrade_creatures', [{ id: 'upgrade', slot: 0, from: 'pikeman', to: 'halberdier', count: 10, cost: { gold: 100 } }, leave], 0],
    ['buy_war_machine', [{ id: 'buy', artifactId: 'ballista', cost: { gold: 2500 }, available: true }, leave], 0],
    ['tavern', [{ id: 'hire', heroDefId: 'valeska', cost: { gold: 2500 } }, leave], 0],
  ];
  for (const [kind, options, pickIdx] of cases) {
    const p = R[kind](pend(kind, options), ctx);
    const d = await until(() => topDialog());
    const btn = d.querySelectorAll('button[data-option]').find((b) => b.dataset.option === String(pickIdx));
    assert.ok(btn, `${kind}: buy button`);
    btn.click();
    assert.deepEqual(await p, { optionIndex: pickIdx }, kind);
  }
  const p = R.university(pend('university', cases[0][1]), ctx);
  const disabled = topDialog().querySelectorAll('button[data-option]').find((b) => b.dataset.option === '1');
  assert.ok(disabled.disabled, 'unavailable skill');
  buttonIn(topDialog(), 'Leave').click();
  assert.deepEqual(await p, { optionIndex: 2 });
});

test('pending renderers with extra payloads: recruit, trade (3 modes), altar, garrison exchange', async () => {
  const { state, heroId } = makeState();
  makeApp();
  app.ctx.setState(state, { silent: true });
  const ctx = app.ctx;
  state.players[0].resources.gold = 1000;
  // recruit: default = max affordable, the stepper changes it
  let p = R.recruit(pend('recruit', [{ id: 'recruit', creatureId: 'pikeman', available: 30, cost: { gold: 60 } }, { id: 'leave' }]), ctx);
  let d = await until(() => topDialog());
  buttonIn(d, 'Recruit').click();
  assert.deepEqual(await p, { optionIndex: 0, extra: { count: 16 } });
  p = R.recruit(pend('recruit', [{ id: 'recruit', creatureId: 'pikeman', available: 30, cost: { gold: 60 } }, { id: 'recruit', creatureId: 'archer', available: 5, cost: { gold: 100 } }, { id: 'leave' }]), ctx);
  d = await until(() => topDialog());
  d.querySelectorAll('.adv-recruit-card')[1].click();
  const input = d.querySelector('.k-stepper-input');
  input.value = '3';
  fire(input, 'change');
  buttonIn(d, 'Recruit').click();
  assert.deepEqual(await p, { optionIndex: 1, extra: { count: 3 } });
  // trade: resource -> resource
  state.players[0].resources.wood = 50;
  p = R.trade(pend('trade', [{ id: 'trade' }, { id: 'leave' }], { modes: ['resource_resource', 'creature_resource', 'resource_player'], marketCount: 1 }, heroId), ctx);
  d = await until(() => topDialog());
  const res = (side, r) => d.querySelectorAll('.adv-res-grid')[side].querySelectorAll('.adv-res-btn').find((b) => b.dataset.res === r);
  res(0, 'wood').click();
  res(1, 'gold').click();
  const step = d.querySelector('.k-stepper-input');
  step.value = '4';
  fire(step, 'change');
  buttonIn(d, 'Trade').click();
  assert.deepEqual(await p, { optionIndex: 0, extra: { mode: 'resource_resource', give: 'wood', get: 'gold', amount: 4 } });
  // trade: creature -> resource
  p = R.trade(pend('trade', [{ id: 'trade' }, { id: 'leave' }], { modes: ['creature_resource'], marketCount: 1 }, heroId), ctx);
  d = await until(() => topDialog());
  buttonIn(d, 'Trade').click();
  const ct = await p;
  assert.equal(ct.extra.mode, 'creature_resource');
  assert.equal(ct.extra.get, 'gold');
  assert.equal(ct.extra.slot, state.heroes[heroId].army.findIndex(Boolean));
  assert.ok(ct.extra.count >= 1);
  // trade: gift to a player
  p = R.trade(pend('trade', [{ id: 'trade' }, { id: 'leave' }], { modes: ['resource_player'], marketCount: 1 }, heroId), ctx);
  d = await until(() => topDialog());
  d.querySelectorAll('.adv-res-btn').find((b) => b.dataset.res === 'gold').click();
  const st2 = d.querySelector('.k-stepper-input');
  st2.value = '250';
  fire(st2, 'change');
  buttonIn(d, 'Trade').click();
  assert.deepEqual(await p, { optionIndex: 0, extra: { mode: 'resource_player', give: 'gold', amount: 250, toPlayer: 1 } });
  // altar
  const hero = state.heroes[heroId];
  hero.artifacts.backpack.push('centaurs_axe');
  const arts = altarArtifacts(hero);
  const axeIdx = arts.findIndex((a) => a.id === 'centaurs_axe');
  assert.ok(axeIdx >= 0);
  p = R.altar(pend('altar', [{ id: 'sacrifice' }, { id: 'leave' }], { canArtifacts: true, canCreatures: true }, heroId), ctx);
  d = await until(() => topDialog());
  const boxes = d.querySelectorAll('input').filter((i) => i.type === 'checkbox');
  boxes[axeIdx].checked = true;
  fire(boxes[axeIdx], 'change');
  const steppers = d.querySelectorAll('.k-stepper-input');
  steppers[0].value = '1';
  fire(steppers[0], 'change');
  buttonIn(d, 'Sacrifice').click();
  const firstSlot = hero.army.findIndex(Boolean);
  assert.deepEqual(await p, { optionIndex: 0, extra: { artifacts: [arts[axeIdx].ref], creatures: [{ slot: firstSlot, count: 1 }] } });
  // garrison exchange: move a stack from the hero row to the garrison row
  const gar = adv.addObject(state, 'garrison', { x: 30, y: 30, z: 0 }, { owner: 0, data: { army: [null, null, null, null, null, null, null] } });
  p = R.garrison_exchange(pend('garrison_exchange', [{ id: 'transfer' }, { id: 'leave' }], { objectId: gar.id, removableUnits: true }, heroId), ctx);
  d = await until(() => topDialog());
  const rows = d.querySelectorAll('.k-army');
  const heroSlots = rows[1].querySelectorAll('.k-army-slot');
  const garSlots = rows[0].querySelectorAll('.k-army-slot');
  heroSlots[firstSlot].click();
  garSlots[3].click();
  assert.deepEqual(await p, { optionIndex: 0, extra: { from: 'hero', slot: firstSlot } });
});

test('end to end: a treasure chest pending is resolved through ctx.resolvePendings', async () => {
  const { state, heroId } = makeState();
  const chest = adv.addObject(state, 'treasure_chest', { x: 11, y: 10, z: 0 });
  pendingEngine.pushPending(state, { kind: 'chest_choice', playerId: 0, heroId, options: [{ id: 'gold', label: 'Gold', gold: 1000 }, { id: 'exp', label: 'Experience', exp: 500 }], data: { objectId: chest.id, defId: chest.defId } });
  const gold = state.players[0].resources.gold;
  makeApp();
  app.ctx.setState(state, { silent: true });
  await quiet(() => app.showScreen('adventure', {}));
  const ctrl = screen.getController();
  const d = await until(() => topDialog() && topDialog().querySelector('.k-choice') && topDialog());
  d.querySelectorAll('.k-choice')[0].click();
  await ctrl.ready;
  assert.equal(state.players[0].resources.gold, gold + 1000);
  assert.equal(state.pending.length, 0);
});

// ---- pure model ---------------------------------------------------------------------------------

test('model helpers: plurals, size labels, fog masks, next hero, quest text, event messages', () => {
  const { state, heroId, enemyId } = makeState();
  assert.equal(model.pluralize('Pikeman'), 'Pikemen');
  assert.equal(model.pluralize('Fairy'), 'Fairies');
  assert.equal(model.sizeLabelText('imp', 3), 'A few Imps');
  assert.equal(model.sizeLabelText('pikeman', 120), 'A throng of Pikemen');
  const ex = state.players[0].explored[0];
  ex.fill(0);
  ex[10 * 60 + 10] = 1;
  assert.equal(model.fogMask(state, 0, 10, 10, 0), 255);
  assert.equal(model.nextHeroId(state, 0, heroId), heroId);
  state.heroes[heroId].asleep = true;
  assert.equal(model.nextHeroId(state, 0, null), null);
  assert.equal(model.heroesWithMovement(state, 0).length, 0);
  assert.match(model.questText({ type: 'bring_resources', resources: { gold: 500 } }), /500 gold/);
  assert.equal(model.eventMessage(state, { type: 'message', text: 'Hi' }, 0).modal, true);
  assert.match(model.eventMessage(state, { type: 'pickup', reward: { resources: { wood: 5 } } }, 0).text, /5 wood/);
  assert.equal(model.eventMessage(state, { type: 'town_loss_warning', playerId: 1, daysLeft: 3 }, 0), null);
  const marks = model.pathMarkers({ steps: [{ x: 1, y: 1, turn: 0 }, { x: 2, y: 1, turn: 1 }, { x: 3, y: 1, turn: 1 }] });
  assert.deepEqual(marks.map((m) => [m.today, m.dayMarker, m.last]), [[true, null, false], [false, 1, false], [false, null, true]]);
  assert.ok(enemyId);
  const v = createMapView;
  assert.equal(typeof v, 'function');
});

test('renders through the real gfx module when it is available (terrain compositor, sprites, shroud)', async (t) => {
  const gfx = await import('../../src/gfx/index.js').catch(() => null);
  if (!gfx) { t.skip('gfx unavailable'); return; }
  const sprites = await import('../../src/ui/sprites.js');
  const { state } = makeState();
  const ctrl = await mountWith(state);
  sprites.setGfx(gfx);
  try {
    const v = ctrl.mapView;
    v.invalidateTerrain();
    v.stats.gfxTiles = 0;
    v.stats.fallbackTiles = 0;
    const before = JSON.stringify(state);
    assert.ok(v.render(true));
    assert.ok(v.stats.chunkRenders > 0 && v.stats.objectsDrawn > 0);
    assert.ok(v.stats.gfxTiles > 0, 'terrain drawn by gfx drawTerrainTile');
    assert.equal(v.stats.fallbackTiles, 0, String(v.lastGfxError && v.lastGfxError.stack));
    v.zoom(1);
    assert.ok(v.render(true));
    assert.equal(JSON.stringify(state), before);
  } finally {
    sprites.setGfx(null);
  }
});

test('with a hero selected, clicking another own hero walks over to meet him (exchange); unreachable selects', async () => {
  const { state, heroId } = makeState();
  const other = heroEngine.addHero(state, 'valeska', 0, { x: 13, y: 10, z: 0 });
  let met = null;
  ui.registerPendingRenderer('hero_exchange', async (p) => { met = p; return { optionIndex: 0 }; });
  const ctrl = await mountWith(state);
  ctrl.selectHero(heroId);
  await ctrl.clickTile({ x: 13, y: 10, z: 0 });
  assert.equal(ctrl.selectedHero, heroId, 'first click previews the path, keeps the selection');
  assert.ok(ctrl.mapView.path, 'path preview to the other hero');
  await quiet(() => ctrl.clickTile({ x: 13, y: 10, z: 0 }));
  await until(() => met);
  assert.equal(met.kind, 'hero_exchange');
  // a hero the selected one cannot reach is simply selected
  const far = heroEngine.addHero(state, 'sorsha', 0, { x: 45, y: 5, z: 1 });
  await ctrl.clickTile({ x: 45, y: 5, z: 1 });
  assert.equal(ctrl.selectedHero, far.id);
  assert.ok(other);
});

test('a computer attack: the defender chooses fight / quick combat even with quick combat on; the computer then finishes its day', async () => {
  const { state, heroId, enemyId } = makeState();
  const me = state.heroes[heroId];
  const ai = state.heroes[enemyId];
  me.army = [{ creatureId: 'arch_angel', count: 20 }, null, null, null, null, null, null];
  ai.pos = { x: me.pos.x + 1, y: me.pos.y, z: 0 };
  ai.army = [{ creatureId: 'peasant', count: 5 }, null, null, null, null, null, null];
  const ctrl = await mountWith(state, {}, { settings: { quickCombat: true, confirmEndTurn: false } });
  let runs = 0;
  game.setAiDriver((s, pid) => {
    runs++;
    const h = s.heroes[enemyId];
    if (runs === 1 && h) adv.moveHero(s, h.id, s.heroes[heroId].pos);
    return { ok: true, events: [] };
  });
  const p = ctrl.endTurn({ force: true });
  const d = await until(() => topDialog() && /under attack/i.test(topDialog().textContent) && topDialog());
  const cards = d.querySelectorAll('.k-choice');
  assert.equal(cards.length, 2, 'fight / quick combat');
  assert.match(cards[0].textContent, /Fight/);
  cards[1].click(); // quick combat
  await tick();
  for (let i = 0; i < 20 && topDialog(); i++) { const b = topDialog().querySelectorAll('button').find((x) => !x.classList.contains('k-choice')); if (b) b.click(); await tick(); }
  await p;
  await until(() => !state.combat && state.currentPlayer === 0 && state.turn === 2);
  assert.equal(runs, 2, 'the computer resumed its turn after the battle');
});
