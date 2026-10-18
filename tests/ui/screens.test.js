// The screens owned by the shell: main menu, new game, load/save, options, credits (+ audio).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVictory } from '../../src/engine/victory.js';
import { installFakeDom, createFakeStorage, fire, tick, until } from './fakeDom.js';

const dom = installFakeDom();
const { createApp } = await import('../../src/ui/app.js');
const ui = await import('../../src/ui/kit/index.js');
const M = await import('../../src/ui/screens/newGameModel.js');
const { buildScene, makeNoise } = await import('../../src/ui/screens/mainMenu.js');
const { stampText, metaSummary } = await import('../../src/ui/screens/loadGame.js');
const { createAudio, SOUNDS, SOUND_NAMES } = await import('../../src/ui/audio.js');
const { PLAYER_COLORS } = await import('../../src/core/constants.js');

let app = null;
const quiet = async (fn) => {
  const saved = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};
function makeApp(modules = {}, extraScreens = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  app = createApp(root, {
    storageBackend: createFakeStorage(),
    gfxLoader: async () => { throw new Error('no gfx'); },
    importer: async (path) => {
      const name = Object.keys(modules).find((k) => path.endsWith(`/${k}.js`) || path.endsWith(`/${k}/index.js`));
      if (name) return modules[name];
      throw new Error(`Cannot find module ${path}`);
    },
    screens: extraScreens,
  });
  return app;
}
afterEach(async () => { ui.closeAllDialogs(); if (app) await quiet(() => app.destroy()); app = null; });
const btn = (root, label) => root.querySelectorAll('.k-btn').find((b) => b.textContent.includes(label));
const sampleState = () => ({ turn: 3, date: { day: 3, week: 1, month: 1 }, currentPlayer: 0, pending: [],
  players: [{ id: 0, color: 'red', name: 'Ann', isHuman: true, faction: 'castle' }], map: { width: 36, height: 36, levels: 1 }, settings: { difficulty: 1 } });

// ---- new game model -----------------------------------------------------------------------------

test('setup defaults: one human against one computer, unique colours, five difficulties 80..200%', () => {
  const s = M.createSetup({ seed: 42 });
  assert.equal(s.players.length, 8);
  assert.deepEqual(s.players.map((p) => p.type), ['human', 'ai', 'closed', 'closed', 'closed', 'closed', 'closed', 'closed']);
  assert.deepEqual(s.players.map((p) => p.color), PLAYER_COLORS);
  assert.deepEqual(M.DIFFICULTIES.map((d) => d.percent), [80, 100, 130, 160, 200]);
  assert.deepEqual(M.MAP_SIZES.map((m) => m.id), ['S', 'M', 'L', 'XL']);
  assert.ok(M.validateSetup(s).ok);
  assert.equal(s.seed, 42);
});

test('slot rules: player cap, colour swap, faction resets a foreign hero, heroes are unique', () => {
  const s = M.createSetup();
  M.setMapSize(s, 'S');
  assert.equal(s.maxPlayers, 4);
  assert.ok(M.setSlotType(s, 2, 'ai'));
  assert.ok(M.setSlotType(s, 3, 'human'));
  assert.equal(M.setSlotType(s, 4, 'ai'), false, 'small maps hold 4 players');
  assert.equal(M.openSlots(s).length, 4);
  M.setMapSize(s, 'XL');
  assert.ok(M.setSlotType(s, 4, 'ai'));
  M.setMapSize(s, 'S');
  assert.equal(M.openSlots(s).length, 4, 'shrinking the map closes surplus slots');

  M.setSlotColor(s, 0, 'blue');
  assert.equal(s.players[0].color, 'blue');
  assert.equal(s.players[1].color, 'red', 'the previous owner of blue takes the old colour');
  M.cycleSlotColor(s, 0);
  assert.equal(new Set(s.players.map((p) => p.color)).size, 8);
  assert.equal(M.setSlotColor(s, 0, 'chartreuse'), false);

  assert.deepEqual(M.heroChoices('random'), []);
  assert.ok(M.heroChoices('castle').length >= 8);
  assert.ok(M.heroChoices('castle').every((h) => h.faction === 'castle' && !h.special));
  assert.equal(M.setSlotHero(s, 0, 'christian'), false, 'needs the matching town first');
  M.setSlotFaction(s, 0, 'castle');
  assert.ok(M.setSlotHero(s, 0, 'christian'));
  M.setSlotFaction(s, 1, 'castle');
  assert.equal(M.setSlotHero(s, 1, 'christian'), false, 'already taken');
  M.setSlotFaction(s, 0, 'inferno');
  assert.equal(s.players[0].hero, 'random');
  assert.equal(M.setSlotFaction(s, 0, 'atlantis'), false);
});

test('validation catches unplayable setups', () => {
  const s = M.createSetup();
  M.setSlotType(s, 0, 'ai');
  assert.match(M.validateSetup(s).errors.join(' '), /human/);
  M.setSlotType(s, 0, 'closed');
  assert.match(M.validateSetup(s).errors.join(' '), /two players/);
  const t = M.createSetup();
  M.setMapType(t, 'scenario');
  assert.match(M.validateSetup(t).errors.join(' '), /scenario/);
  M.setScenario(t, { id: 'duel', name: 'Duel', playerSlots: 3 });
  assert.ok(M.validateSetup(t).ok);
  assert.equal(M.openSlots(t).length, 3, 'scenario seats are opened');
  assert.equal(t.maxPlayers, 3);
  t.players[0].hero = 'christian';
  assert.match(M.validateSetup(t).errors.join(' '), /starting hero/);
});

test('buildGameSettings follows the createGame contract; buildMapOptions feeds the generator', () => {
  const s = M.createSetup({ seed: 777 });
  M.setSlotType(s, 3, 'human');
  M.setSlotFaction(s, 0, 'tower');
  s.players[0].name = 'Ann';
  s.difficulty = 4;
  s.underground = true;
  s.water = 'islands';
  const g = M.buildGameSettings(s);
  assert.equal(g.seed, 777);
  assert.equal(g.difficulty, 4);
  assert.equal(g.difficultyPercent, 200);
  assert.equal(g.victory, 'standard');
  assert.equal(g.loss, 'standard');
  // the new-game choices map to engine condition types
  const cond = (victory, loss) => { const x = M.buildGameSettings({ ...s, victory, loss }); return [x.victory, x.loss]; };
  assert.deepEqual(cond('capture_all_towns', 'time_3_months'), [{ type: 'capture_all_towns', allowStandard: true }, { type: 'time_limit', days: 84 }]);
  assert.deepEqual(cond('find_grail', 'time_6_months'), [{ type: 'build_grail', allowStandard: true }, { type: 'time_limit', days: 168 }]);
  assert.deepEqual(cond('accumulate_gold', 'standard')[0], { type: 'accumulate_resources', resource: 'gold', amount: 100000, allowStandard: true });
  for (const v of M.VICTORY_CONDITIONS) assert.doesNotThrow(() => normalizeVictory(M.buildGameSettings({ ...s, victory: v.id }).victory));
  assert.deepEqual(g.players.map((p) => [p.slot, p.isHuman, p.faction, p.color]), [[0, true, 'tower', 'red'], [1, false, 'random', 'blue'], [2, true, 'random', 'green']]);
  assert.equal(g.players[0].name, 'Ann');
  const o = M.buildMapOptions(s);
  assert.deepEqual([o.type, o.size, o.width, o.height, o.levels, o.underground, o.water, o.players, o.humanPlayers, o.seed], ['random', 'M', 72, 72, 2, true, 'islands', 3, 2, 777]);
  assert.deepEqual(o.factions, ['tower', 'random', 'random']);
  M.setMapType(s, 'scenario');
  M.setScenario(s, { id: 'duel', playerSlots: 3 });
  assert.equal(M.buildMapOptions(s).scenario, 'duel');
  assert.equal(M.normalizeSeed('12'), 12);
  assert.equal(M.normalizeSeed('dragon'), M.normalizeSeed('dragon'));
  assert.notEqual(M.normalizeSeed('dragon'), M.normalizeSeed('dragons'));
  assert.ok(M.normalizeSeed('') >= 1 && M.normalizeSeed(-5) >= 1 && M.normalizeSeed(0) === 1);
});

// ---- screens through the real router ------------------------------------------------------------

test('main menu mounts, animates and navigates', async () => {
  const a = makeApp();
  assert.equal(await a.start(), true);
  const screen = a.layers.screen;
  assert.equal(a.layers.error.children.length, 0);
  assert.ok(screen.querySelector('canvas.mm-bg'));
  const labels = screen.querySelectorAll('.mm-item').map((b) => b.textContent);
  for (const want of ['New Game', 'Load Game', 'Encyclopedia', 'Options', 'Credits']) assert.ok(labels.some((l) => l.includes(want)), want);
  assert.ok(!labels.some((l) => l.includes('Continue')), 'nothing to continue yet');
  assert.equal(a.anim.active, 1, 'background loop is running');
  dom.flushFrames(3);
  assert.equal(a.anim.active, 1);
  fire(dom.window, 'keydown', { key: 'o' });
  await until(() => a.layers.screen.querySelector('.opt'));
  assert.equal(a.screen, 'options');
  assert.equal(a.anim.active, 0, 'the loop stops when the menu is left');
  fire(dom.window, 'keydown', { key: 'Escape' });
  await until(() => a.layers.screen.querySelector('.mm'));
  assert.equal(a.screen, 'mainMenu');
  btn(a.layers.screen, 'Credits').click();
  await until(() => a.layers.screen.querySelector('.cr'));
  assert.equal(a.screen, 'credits');
  assert.match(a.layers.screen.textContent, /fan remake/);
  assert.match(a.layers.screen.textContent, /procedurally generated/);
});

test('main menu offers Continue when a save exists and resumes into the adventure screen', async () => {
  const shown = [];
  const a = makeApp({}, { adventure: { mount: (r, ctx, p) => { shown.push(ctx.state.turn); }, unmount() {} } });
  a.storage.save('autosave', sampleState(), { name: 'Autosave' });
  await a.start();
  const cont = btn(a.layers.screen, 'Continue');
  assert.ok(cont);
  cont.click();
  await tick();
  assert.equal(a.screen, 'adventure');
  assert.deepEqual(shown, [3]);
  await a.showScreen('mainMenu');
  assert.ok(btn(a.layers.screen, 'Resume Game'), 'with a game in memory the entry becomes Resume');
  assert.ok(btn(a.layers.screen, 'Save Game'));
});

test('scene description is deterministic and uses real creature ids', () => {
  assert.deepEqual(buildScene(5), buildScene(5));
  assert.notDeepEqual(buildScene(5).stars, buildScene(6).stars);
  assert.ok(buildScene(5).walkers.length >= 5);
  const r = makeNoise(1);
  const v = r();
  assert.ok(v >= 0 && v < 1);
});

test('new game: without the generator the screen still works and explains why it cannot start', async () => {
  await quiet(async () => {
    const a = makeApp();
    await a.start('newGame');
    const screen = a.layers.screen;
    assert.equal(a.layers.error.children.length, 0);
    assert.match(screen.querySelector('.ng-note').textContent, /map generator is not available/);
    assert.equal(screen.querySelectorAll('.ng-prow').length, 9, 'header + 8 player slots');
    assert.equal(screen.querySelectorAll('.ng-prow.is-closed').length, 6);
    assert.equal(screen.querySelectorAll('.ng-diff .k-btn').length, 5);
    btn(screen, 'Start Game').click();
    await tick();
    assert.equal(ui.dialogCount(), 1);
    assert.match(document.body.querySelector('.k-dlg').textContent, /Generator not available/);
    ui.closeTopDialog();
    await tick();
    assert.equal(a.screen, 'newGame');
    assert.equal(a.ctx.state, null);
  });
});

test('new game: Start generates a map, creates the game and opens the adventure screen', async () => {
  const seen = {};
  const mapgen = {
    listScenarios: () => [{ id: 'duel', name: 'The Duel', description: 'Two rivals.', playerSlots: 2, size: 'S' }],
    generateMap: (options) => { seen.options = options; return { map: { width: options.width, height: options.height, levels: options.levels }, towns: [], heroes: [], meta: { name: 'Random' } }; },
  };
  const game = { createGame: (blueprint, settings) => { seen.blueprint = blueprint; seen.settings = settings; return { ...sampleState(), map: blueprint.map }; } };
  const a = makeApp({ mapgen, game }, { adventure: { mount: (r, ctx, p) => { seen.adventure = p; }, unmount() {} } });
  await a.start('newGame');
  const screen = a.layers.screen;
  assert.equal(screen.querySelector('.ng-note').textContent, '');
  assert.match(btn(screen, 'Scenario').textContent, /Scenario \(1\)/);

  // open a third slot as human, pick Castle for player 1, choose its hero through the picker
  const rows = () => screen.querySelectorAll('.ng-prow').slice(1);
  let sel = rows()[2].querySelector('select');
  sel.value = '0';                                   // Human
  fire(sel, 'change');
  assert.equal(screen.querySelectorAll('.ng-prow.is-closed').length, 5);
  const faction = rows()[0].querySelectorAll('select')[1];
  faction.value = '1';                               // 0 = Random, 1 = Castle
  fire(faction, 'change');
  rows()[0].querySelector('.ng-hero').click();
  await tick(1);
  const cards = document.body.querySelectorAll('.k-choice');
  assert.ok(cards.length > 8);
  cards.find((c) => /Christian/.test(c.textContent)).click();
  await tick();
  assert.match(rows()[0].querySelector('.ng-hero').textContent, /Christian/);
  // hardest difficulty, XL map
  screen.querySelectorAll('.ng-diff .k-btn')[4].click();
  btn(screen, 'XL').click();

  btn(a.layers.screen, 'Start Game').click();
  await tick(6);
  assert.equal(a.screen, 'adventure');
  assert.deepEqual(seen.adventure, { newGame: true });
  assert.equal(seen.options.width, 144);
  assert.equal(seen.options.players, 3);
  assert.equal(seen.settings.difficulty, 4);
  assert.deepEqual(seen.settings.players.map((p) => [p.slot, p.isHuman, p.faction, p.hero]), [[0, true, 'castle', 'christian'], [1, false, 'random', 'random'], [2, true, 'random', 'random']]);
  assert.equal(a.ctx.state.map.width, 144);
});

test('new game: a generator or engine failure is reported in a dialog, not as a crash', async () => {
  await quiet(async () => {
    const a = makeApp({ mapgen: { generateMap: () => { throw new Error('zone placement failed'); } }, game: { createGame: () => ({}) } });
    await a.start('newGame');
    btn(a.layers.screen, 'Start Game').click();
    await tick(4);
    assert.match(document.body.querySelector('.k-dlg').textContent, /could not be created.*zone placement failed/);
    assert.equal(a.layers.error.children.length, 0);
    ui.closeTopDialog();
    await tick();
    assert.equal(a.screen, 'newGame');
    assert.equal(btn(a.layers.screen, 'Start Game').disabled, false, 'the user can try again');
  });
});

test('new game: scenario list from the generator', async () => {
  const mapgen = { listScenarios: () => [{ id: 'duel', name: 'The Duel', description: 'Two rivals.', playerSlots: 2, victory: 'Slay the rival lord.', loss: 'Lose your capital.' }, { id: 'ffa', name: 'Free for All', description: 'Six lords.', playerSlots: 6 }], generateMap: () => ({}) };
  const a = makeApp({ mapgen });
  await a.start('newGame');
  assert.ok(a.layers.screen.querySelectorAll('.k-select').length >= 2, 'random maps: victory / defeat dropdowns');
  btn(a.layers.screen, 'Scenario').click();
  const screen = a.layers.screen;
  // scenarios: the dropdowns are replaced by the scenario's own condition texts
  const conds = [...screen.querySelectorAll('.ng-scn-cond')].map((e) => e.textContent);
  assert.deepEqual(conds, ['Slay the rival lord.', 'Lose your capital.']);
  assert.equal(screen.querySelectorAll('.ng-scenarios .k-list-row').length, 2);
  assert.match(screen.querySelector('.ng-scn-desc').textContent, /Two rivals/);
  screen.querySelectorAll('.ng-scenarios .k-list-row')[1].click();
  assert.match(a.layers.screen.querySelector('.ng-scn-desc').textContent, /Six lords/);
  assert.equal(a.layers.screen.querySelectorAll('.ng-prow.is-closed').length, 2, 'six seats opened');
});

test('load / save screen: save as new, list, overwrite, delete, load', async () => {
  const shown = [];
  const a = makeApp({}, { adventure: { mount: (r, ctx, p) => { shown.push([ctx.state.turn, p]); }, unmount() {} } });
  a.ctx.setState(sampleState());
  await a.start('loadGame', { mode: 'save' });
  let screen = a.layers.screen;
  assert.match(screen.textContent, /Save Game/);
  assert.match(screen.textContent, /No saved games yet/);
  btn(screen, 'Save as new').click();
  await tick(1);
  document.body.querySelector('.k-prompt input').value = 'First Castle';
  document.body.querySelectorAll('.k-dlg-buttons .k-btn')[0].click();
  await tick(4);
  screen = a.layers.screen;
  assert.equal(screen.querySelectorAll('.lg-list .k-list-row').length, 1);
  assert.match(screen.querySelector('.lg-list').textContent, /First Castle/);
  assert.match(screen.querySelector('.lg-detail').textContent, /Month 1, Week 1, Day 3/);
  assert.match(screen.querySelector('.lg-detail').textContent, /Ann \(human, castle\)/);
  assert.ok(a.storage.has('first_castle'));

  a.ctx.state.turn = 8;
  btn(screen, 'Overwrite').click();
  await tick(1);
  document.body.querySelectorAll('.k-dlg-buttons .k-btn')[0].click();      // Yes
  await tick(4);
  assert.equal(a.storage.meta('first_castle').turn, 8);

  // load it back (asks because a game is in progress)
  a.ctx.state.turn = 50;
  await a.showScreen('loadGame', { mode: 'load' });
  screen = a.layers.screen;
  assert.match(screen.textContent, /Load Game/);
  fire(dom.window, 'keydown', { key: 'Enter' });
  await tick(1);
  assert.match(document.body.querySelector('.k-dlg').textContent, /Unsaved progress/);
  fire(dom.window, 'keydown', { key: 'Enter' });
  await tick(4);
  assert.equal(a.screen, 'adventure');
  assert.deepEqual(shown, [[8, { loaded: true }]]);

  await a.showScreen('loadGame');
  btn(a.layers.screen, 'Delete').click();
  await tick(1);
  document.body.querySelectorAll('.k-dlg-buttons .k-btn')[0].click();
  await tick(2);
  assert.equal(a.storage.list().length, 0);
  assert.equal(btn(a.layers.screen, 'Load').disabled, true);
});

test('load screen: importing an exported file adds a slot; bad files are reported', async () => {
  const source = makeApp();
  source.storage.save('campaign', sampleState(), { name: 'Campaign' });
  const text = source.storage.exportSlot('campaign');
  await source.destroy();

  const a = makeApp();
  const mod = await import('../../src/ui/screens/loadGame.js');
  const host = document.createElement('div');
  const api = mod.mount(host, a.ctx, {});
  assert.equal(api.mode, 'load', 'save mode needs a game in progress');
  const res = await api.importText(text, 'h3online-campaign.json');
  assert.ok(res.ok);
  assert.equal(res.slot, 'campaign');
  assert.equal(host.querySelectorAll('.lg-list .k-list-row').length, 1);
  assert.match(host.querySelector('.lg-detail').textContent, /Campaign/);
  const bad = await api.importText('{"hello":1}', 'x.json');
  assert.equal(bad.ok, false);
  assert.match(document.body.querySelector('.k-dlg').textContent, /not an H3online save/);
  // the hidden file input path
  ui.closeAllDialogs();
  const input = host.querySelector('input[type="file"]');
  input.files = [{ name: 'second.json', text: async () => text }];
  fire(input, 'change');
  await tick(4);
  assert.equal(a.storage.list().length, 2);
  mod.unmount();
  assert.equal(stampText(0), '');
  assert.match(stampText(Date.UTC(2026, 0, 2, 12, 0)), /^2026-01-0\d \d\d:\d\d$/);
  assert.equal(metaSummary({ date: { day: 1, week: 2, month: 3 }, mapSize: '72x72', players: [1, 2] }), 'Month 3, Week 2, Day 1 - 72x72 - 2 players');
});

test('options write straight to the persisted settings', async () => {
  const a = makeApp();
  await a.start('options');
  const screen = a.layers.screen;
  const sliders = screen.querySelectorAll('.k-slider-input');
  assert.equal(sliders.length, 2, 'volume and UI scale');
  sliders[0].value = '0.25';
  fire(sliders[0], 'input');
  assert.equal(a.settings.get('volume'), 0.25);
  assert.match(screen.querySelector('.opt-value').textContent, /25%/);
  const checks = screen.querySelectorAll('.k-check-input');
  assert.equal(checks.length, 6);
  const grid = screen.querySelectorAll('.k-check').find((c) => /grid/.test(c.textContent)).querySelector('input');
  grid.checked = true;
  fire(grid, 'change');
  assert.equal(a.settings.get('showGrid'), true);
  btn(screen, '4x').click();
  assert.equal(a.settings.get('animSpeed'), 4);
  assert.ok(btn(a.layers.screen, '4x').classList.contains('is-active'));
  btn(a.layers.screen, 'Defaults').click();
  await tick(1);
  document.body.querySelectorAll('.k-dlg-buttons .k-btn')[0].click();
  await tick(2);
  assert.equal(a.settings.get('animSpeed'), 1);
  assert.equal(a.settings.get('showGrid'), false);
});

// ---- audio --------------------------------------------------------------------------------------

test('audio: silent no-op without AudioContext; all required effects exist', () => {
  const audio = createAudio(null, {});
  assert.equal(audio.supported, false);
  for (const n of ['click', 'coin', 'sword', 'spell', 'levelup', 'daystart']) {
    assert.ok(SOUND_NAMES.includes(n), n);
    assert.equal(audio.play(n), false);
  }
  audio.unlock();
  for (const voices of Object.values(SOUNDS)) for (const v of voices) assert.ok(v.d > 0 && v.g > 0 && v.f.length === 2);
});

test('audio: schedules voices on a (fake) AudioContext and respects volume / mute', () => {
  const made = { osc: 0, noise: 0, gains: [] };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime(v) { made.gains.push(v); }, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null });
  class FakeAC {
    constructor() { this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; this.state = 'suspended'; this.resumed = 0; }
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { made.osc++; return node(); }
    createGain() { return node(); }
    createBiquadFilter() { return node(); }
    createBufferSource() { made.noise++; return node(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  }
  const values = { volume: 0.5, muted: false };
  const audio = createAudio({ get: (k) => values[k] }, { AudioContext: FakeAC });
  assert.ok(audio.supported);
  assert.equal(audio.play('sword'), true);
  assert.equal(made.osc, 2);
  assert.equal(made.noise, 1);
  assert.ok(made.gains.every((g) => g > 0 && g <= 0.5));
  assert.equal(audio.play('sword'), false, 'identical sounds in the same instant are not stacked');
  assert.equal(audio.play('no_such_sound'), false);
  values.muted = true;
  assert.equal(audio.play('coin'), false);
  values.muted = false;
  values.volume = 0;
  assert.equal(audio.play('coin'), false);
  values.volume = 1;
  assert.equal(audio.play('coin'), true);
  const broken = createAudio(null, { AudioContext: class { constructor() { throw new Error('blocked'); } } });
  assert.equal(broken.play('click'), false);
});
