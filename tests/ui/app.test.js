// App shell: router, lazy screens, ctx, error boundary, keyboard routing, pending choices, save/load.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, createFakeStorage, fire, tick } from './fakeDom.js';

const dom = installFakeDom();
const { createApp, registerScreen, hasScreen, screenNames, createEngineLoader, ENGINE_MODULES } = await import('../../src/ui/app.js');
const ui = await import('../../src/ui/kit/index.js');
const pendingEngine = await import('../../src/engine/pending.js');

const quiet = async (fn) => {
  const saved = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};

let app = null;
function makeApp(screens = {}, opts = {}) {
  const calls = [];
  const simple = (name, extra = {}) => ({
    mount(root, ctx, params) { calls.push(`mount:${name}`); root.appendChild(ui.h('div', { class: `scr-${name}` }, name)); if (extra.mount) return extra.mount(root, ctx, params); return undefined; },
    unmount() { calls.push(`unmount:${name}`); if (extra.unmount) extra.unmount(); },
  });
  const root = document.createElement('div');
  document.body.appendChild(root);
  app = createApp(root, {
    storageBackend: createFakeStorage(),
    importer: opts.importer || (async (path) => { throw new Error(`Cannot find module ${path}`); }),
    gfxLoader: async () => { throw new Error('no gfx'); },
    screens: { mainMenu: simple('mainMenu'), a: simple('a'), b: simple('b'), ...Object.fromEntries(Object.entries(screens).map(([k, v]) => [k, typeof v === 'function' ? v : simple(k, v)])) },
  });
  return { app, ctx: app.ctx, calls, root, simple };
}
afterEach(async () => { ui.closeAllDialogs(); if (app) await quiet(() => app.destroy()); app = null; });

test('the built-in registry knows every screen name of the design', () => {
  for (const n of ['mainMenu', 'newGame', 'loadGame', 'encyclopedia', 'options', 'credits', 'adventure', 'town', 'hero', 'combat', 'kingdom']) assert.ok(hasScreen(n), n);
  assert.ok(screenNames().length >= 11);
});

test('createApp builds the stage with layers and scales it to the window', async () => {
  dom.window.innerWidth = 1920; dom.window.innerHeight = 720;
  const { app: a, root } = makeApp();
  assert.ok(root.classList.contains('app-root'));
  assert.equal(root.children[0], a.stage);
  assert.equal(a.stage.style.width, '1280px');
  assert.equal(a.stage.children.length, 5);
  assert.equal(a.stage.style.transform, 'scale(1)');
  assert.equal(a.stage.style.left, '320px');
  dom.window.innerWidth = 640; dom.window.innerHeight = 720;
  fire(dom.window, 'resize');
  assert.equal(a.stage.style.transform, 'scale(0.5)');
  assert.equal(a.stage.style.top, '180px');
  assert.equal(ui.getStageScale(), 0.5);
  a.settings.set('uiScale', 0.5);
  assert.equal(a.stage.style.transform, 'scale(0.25)', 'the UI scale option refits the stage');
  dom.window.innerWidth = 1280;
});

test('showScreen mounts with (root, ctx, params) and unmounts the previous screen first', async () => {
  let got = null;
  const { app: a, ctx, calls } = makeApp({ a: { mount: (root, c, params) => { got = { root, c, params }; } } });
  assert.equal(await a.start(), true);
  assert.equal(a.screen, 'mainMenu');
  assert.equal(await ctx.showScreen('a', { townId: 't1' }), true);
  assert.deepEqual(calls, ['mount:mainMenu', 'unmount:mainMenu', 'mount:a']);
  assert.equal(got.c, ctx);
  assert.deepEqual(got.params, { townId: 't1' });
  assert.equal(got.root.dataset.screen, 'a');
  assert.ok(got.root.classList.contains('screen-a'));
  assert.equal(ctx.screen, 'a');
  assert.deepEqual(ctx.params, { townId: 't1' });
  assert.equal(a.layers.screen.children.length, 1, 'the old screen DOM is gone');
  assert.equal(a.layers.screen.querySelector('.scr-mainMenu'), null);
});

test('screens load lazily: loader called on first show; default exports and async mounts work', async () => {
  let loads = 0;
  const lazy = async () => { loads++; await tick(1); return { default: { mount: async (root) => { await tick(1); root.textContent = 'lazy ready'; }, unmount() {} } }; };
  const { app: a } = makeApp({ lazy });
  await a.start();
  assert.equal(loads, 0);
  assert.equal(await a.showScreen('lazy'), true);
  assert.equal(loads, 1);
  assert.equal(a.layers.screen.textContent, 'lazy ready');
});

test('a screen that fails to load shows a friendly "not available" panel with a way back', async () => {
  await quiet(async () => {
    const { app: a, ctx } = makeApp({ adventure: async () => { throw new Error('Cannot find module ./screens/adventure/index.js'); }, broken: async () => ({ nothing: true }) });
    await a.start();
    assert.equal(await a.showScreen('adventure'), false);
    const panel = a.layers.screen.querySelector('.screen-unavailable');
    assert.ok(panel);
    assert.match(panel.textContent, /"Adventure" screen is not part of this build yet/);
    assert.match(panel.textContent, /Cannot find module/);
    assert.equal(a.layers.error.children.length, 0, 'not an error overlay');
    assert.ok(ctx.logStore.entries.some((e) => /not available/.test(e.text)));
    panel.querySelectorAll('.k-btn')[0].click();          // Back
    await tick();
    assert.equal(a.screen, 'mainMenu');

    assert.equal(await a.showScreen('broken'), false);
    assert.match(a.layers.screen.textContent, /does not export mount/);
    assert.equal(await a.showScreen('never-registered'), false);
    assert.match(a.layers.screen.textContent, /No screen registered/);
    fire(dom.window, 'keydown', { key: 'Escape' });       // Esc also goes back
    await tick();
    assert.equal(a.screen, 'mainMenu');
  });
});

test('the real registry degrades gracefully for a module that is missing on disk', async () => {
  await quiet(async () => {
    registerScreen('test-missing', () => import('../../src/ui/screens/__does_not_exist__/index.js'));
    const { app: a } = makeApp();
    assert.equal(await a.showScreen('test-missing'), false);
    assert.ok(a.layers.screen.querySelector('.screen-unavailable'));
  });
});

test('a crashing mount shows the error overlay with the stack and a button back to the menu', async () => {
  await quiet(async () => {
    const { app: a } = makeApp({ crash: { mount: () => { throw new Error('kaboom in mount'); } } });
    await a.start();
    assert.equal(await a.showScreen('crash'), false);
    const box = a.layers.error.querySelector('.error-box');
    assert.ok(box);
    assert.match(box.querySelector('.error-message').textContent, /kaboom in mount/);
    assert.match(box.querySelector('.error-stack').textContent, /app\.test\.js/);
    box.querySelectorAll('.k-btn')[0].click();
    await tick();
    assert.equal(a.layers.error.children.length, 0);
    assert.equal(a.screen, 'mainMenu');
  });
});

test('global error boundary: window errors and unhandled rejections open the overlay; Esc dismisses', async () => {
  await quiet(async () => {
    const { app: a } = makeApp();
    await a.start();
    fire(dom.window, 'error', { error: new Error('late failure') });
    assert.match(a.layers.error.textContent, /late failure/);
    fire(dom.window, 'keydown', { key: 'Escape' });
    assert.equal(a.layers.error.children.length, 0);
    fire(dom.window, 'unhandledrejection', { reason: 'promise went wrong' });
    assert.match(a.layers.error.textContent, /promise went wrong/);
    a.layers.error.querySelectorAll('.k-btn')[1].click();   // Dismiss
    assert.equal(a.layers.error.children.length, 0);
    assert.equal(a.screen, 'mainMenu', 'dismiss keeps the current screen');
  });
});

test('a failing unmount does not block navigation', async () => {
  await quiet(async () => {
    const { app: a } = makeApp({ sticky: { unmount: () => { throw new Error('cannot unmount'); } } });
    await a.showScreen('sticky');
    assert.equal(await a.showScreen('a'), true);
    assert.equal(a.screen, 'a');
  });
});

test('history: back() returns to the previous screen with its params; the menu resets it', async () => {
  const seen = [];
  const { app: a, ctx } = makeApp({ a: { mount: (r, c, p) => seen.push(p) } });
  await a.start();
  await ctx.showScreen('a', { n: 1 });
  await ctx.showScreen('b');
  assert.deepEqual(a.history, ['mainMenu', 'a', 'b']);
  await ctx.back();
  assert.equal(a.screen, 'a');
  assert.deepEqual(seen, [{ n: 1 }, { n: 1 }]);
  assert.deepEqual(a.history, ['mainMenu', 'a']);
  await ctx.showScreen('b', {}, { replace: true });
  assert.deepEqual(a.history, ['mainMenu', 'b']);
  await ctx.back();
  await ctx.back();
  assert.equal(a.screen, 'mainMenu');
  assert.deepEqual(a.history, ['mainMenu']);
});

test('a newer navigation wins over a slow one', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { app: a, calls } = makeApp({ slow: async () => { await gate; return { mount() { calls.push('mount:slow'); }, unmount() {} }; } });
  const p1 = a.showScreen('slow');
  await tick(1);
  const p2 = a.showScreen('b');
  release();
  assert.equal(await p1, false);
  assert.equal(await p2, true);
  assert.equal(a.screen, 'b');
  assert.ok(!calls.includes('mount:slow'));
});

test('per-screen resources are released on navigation: shortcuts, state listeners, animations, dialogs', async () => {
  const hits = [];
  let tweenDone = false;
  const { app: a, ctx } = makeApp({ a: { mount: (r, c) => {
    c.keys.bind('e', () => hits.push('end-turn'));
    c.onState((s, reason) => hits.push(`state:${reason}`));
    c.anim.tween({ duration: 100000 }).then(() => { tweenDone = true; });
    c.ui.openDialog({ content: 'still open' });
  } } });
  await a.showScreen('a');
  assert.equal(ui.dialogCount(), 1);
  fire(dom.window, 'keydown', { key: 'e' });
  assert.deepEqual(hits, [], 'screen shortcuts are blocked while a dialog is open');
  fire(dom.window, 'keydown', { key: 'Escape' });
  assert.equal(ui.dialogCount(), 0, 'Esc closes the top dialog');
  fire(dom.window, 'keydown', { key: 'e' });
  ctx.notify('test');
  assert.deepEqual(hits, ['end-turn', 'state:test']);
  ctx.ui.openDialog({ content: 'again' });
  await a.showScreen('b');
  await tick();
  assert.equal(ui.dialogCount(), 0);
  assert.ok(tweenDone, 'pending tweens resolve so awaiting code never hangs');
  fire(dom.window, 'keydown', { key: 'e' });
  ctx.notify('test');
  assert.equal(hits.length, 2);
});

test('ctx shape: everything the screen agents rely on is present', async () => {
  const { ctx } = makeApp();
  for (const k of ['state', 'setState', 'notify', 'onState', 'act', 'resolvePendings', 'sprite', 'drawSprite', 'gfx', 'ui', 'showScreen', 'back',
    'screen', 'params', 'storage', 'settings', 'save', 'load', 'autosave', 'audio', 'engine', 'keys', 'anim', 'log', 'logStore', 'toast', 'showError', 'app', 'stage']) {
    assert.ok(k in ctx, `ctx.${k}`);
  }
  assert.equal(ctx.state, null);
  assert.equal(typeof ctx.ui.Button, 'function');
  assert.equal(typeof ctx.ui.confirm, 'function');
  assert.equal(ctx.sprite('creature', 'pikeman').tagName, 'CANVAS');
  assert.equal(ctx.gfx.available, false);
  assert.equal(ctx.audio.play('click'), false, 'audio is a no-op without AudioContext');
  ctx.log('hello', 'good');
  assert.equal(ctx.logStore.entries.at(-1).text, 'hello');
});

test('ctx.setState / act: results notify listeners, failures toast, exceptions reach the overlay', async () => {
  await quiet(async () => {
    const { app: a, ctx } = makeApp({ a: { mount: () => {} } });
    await a.showScreen('a');
    const seen = [];
    ctx.onState((s, reason, payload) => seen.push([reason, s && s.turn, payload && payload.events && payload.events.length]));
    ctx.setState({ turn: 1, players: [], pending: [] });
    const ok = ctx.act((s) => { s.turn++; return { ok: true, events: [{ type: 'x' }] }; });
    assert.ok(ok.ok);
    const bad = ctx.act(() => ({ ok: false, error: 'not_enough_gold' }));
    assert.equal(bad.ok, false);
    assert.match(a.layers.toasts.textContent, /Not Enough Gold/);
    const thrown = ctx.act(() => { throw new Error('engine bug'); });
    assert.deepEqual(thrown, { ok: false, error: 'exception' });
    assert.match(a.layers.error.textContent, /engine bug/);
    assert.deepEqual(seen, [['set', 1, null], ['action', 2, 1]]);
    ctx.setState({ turn: 50 }, { silent: true });
    assert.equal(seen.length, 2);
    assert.equal(ctx.state.turn, 50);
  });
});

test('engine loader: missing modules resolve to null (once), present ones are cached on the namespace', async () => {
  const requested = [];
  const fakeGame = { createGame: () => ({}) };
  const engine = createEngineLoader(async (path) => { requested.push(path); if (path.endsWith('game.js')) return fakeGame; throw new Error('404'); });
  assert.equal(engine.game, null);
  assert.equal(await engine.load('game'), fakeGame);
  assert.equal(engine.game, fakeGame);
  assert.ok(engine.available('game'));
  assert.equal(await engine.load('mapgen'), null);
  assert.equal(await engine.load('mapgen'), null);
  assert.equal(requested.filter((p) => p.includes('mapgen')).length, 1, 'a failed import is not retried');
  assert.match(engine.errors.mapgen.message, /404/);
  assert.equal(await engine.load('nonsense'), null);
  const all = await engine.loadAll(['game', 'combat']);
  assert.deepEqual(Object.keys(all), ['game', 'combat']);
  assert.equal(all.combat, null);
  assert.deepEqual(engine.names, Object.keys(ENGINE_MODULES));
  assert.equal(ENGINE_MODULES.adventure, '../engine/adventure/index.js');
});

test('the default importer loads real engine modules relative to app.js', async () => {
  const engine = createEngineLoader();
  const pend = await engine.load('pending');
  assert.equal(typeof pend.resolvePending, 'function');
});

test('ctx.save / ctx.load use the game codec when the engine provides one, and autosave honours the option', async () => {
  const game = { serialize: (s) => JSON.stringify({ v: 1, s }), deserialize: (t) => JSON.parse(t).s };
  const { ctx } = makeApp({}, { importer: async (path) => { if (path.endsWith('/game.js')) return game; throw new Error('404'); } });
  assert.equal((await ctx.save('slot1')).error, 'no_state');
  ctx.setState({ turn: 4, players: [{ id: 0, color: 'red', name: 'A', isHuman: true }], currentPlayer: 0, pending: [] });
  const res = await ctx.save('slot1', 'First');
  assert.ok(res.ok);
  assert.equal(res.meta.name, 'First');
  ctx.state.turn = 99;
  const loaded = await ctx.load('slot1');
  assert.ok(loaded.ok);
  assert.equal(ctx.state.turn, 4);
  assert.equal((await ctx.load('nope')).error, 'no_such_save');
  assert.ok((await ctx.autosave()).ok);
  assert.ok(ctx.storage.has('autosave'));
  ctx.settings.set('autosave', false);
  assert.deepEqual(await ctx.autosave(), { ok: false, error: 'disabled' });
});

test('ctx.resolvePendings walks state.pending through dialogs and the engine resolver', async () => {
  const applied = [];
  pendingEngine.registerPendingHandler('test_chest', (state, p, optionIndex) => {
    applied.push([p.id, optionIndex]);
    if (optionIndex === 0) pendingEngine.pushPending(state, { kind: 'test_followup', playerId: p.playerId, options: [{ label: 'Fine' }] });
    return { ok: true, events: [{ type: 'chest' }] };
  });
  pendingEngine.registerPendingHandler('test_followup', (state, p, i) => { applied.push(['followup', i]); return { ok: true }; });
  const { ctx } = makeApp({}, { importer: async (path) => { if (path.endsWith('pending.js')) return pendingEngine; throw new Error('404'); } });
  const state = { currentPlayer: 0, players: [{ id: 0, isHuman: true }, { id: 1, isHuman: false }], pending: [] };
  pendingEngine.pushPending(state, { kind: 'test_chest', playerId: 0, data: { title: 'Treasure Chest', description: 'Gold or wisdom?' }, options: [{ gold: 1500 }, { exp: 1000 }] });
  pendingEngine.pushPending(state, { kind: 'test_chest', playerId: 1, options: [{ gold: 1 }] });   // another player's: left alone
  ctx.setState(state);
  const notes = [];
  ctx.onState((s, reason) => notes.push(reason));
  const done = ctx.resolvePendings();
  await tick();
  assert.equal(ui.dialogCount(), 1);
  assert.equal(document.body.querySelector('.k-dlg-title').textContent, 'Treasure Chest');
  assert.match(document.body.querySelector('.k-dlg').textContent, /Gold or wisdom\?.*1,500 gold.*1,000 experience/);
  assert.equal(await ctx.resolvePendings(), 0, 're-entrant calls do nothing');
  document.body.querySelectorAll('.k-choice')[0].click();
  await tick();
  assert.equal(ui.dialogCount(), 1, 'the follow-up choice is shown next');
  assert.match(document.body.querySelector('.k-dlg').textContent, /Fine/);
  document.body.querySelectorAll('.k-choice')[0].click();
  assert.equal(await done, 2);
  assert.deepEqual(applied, [[1, 0], ['followup', 0]]);
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].playerId, 1);
  assert.deepEqual(notes, ['pending', 'pending']);
});

test('a screen whose module cannot be downloaded says so (network), not "not part of this build"', async () => {
  await quiet(async () => {
    const { app: a } = makeApp({ adventure: async () => { throw new TypeError('Failed to fetch dynamically imported module: http://x/src/ui/screens/adventure/index.js'); } });
    await a.start();
    assert.equal(await a.showScreen('adventure'), false);
    const panel = a.layers.screen.querySelector('.screen-unavailable');
    assert.ok(panel);
    assert.match(panel.textContent, /could not be downloaded/);
    assert.doesNotMatch(panel.textContent, /not part of this build/);
  });
});
