// App shell: logical stage, screen router, shared context (ctx), error boundary, keyboard routing.
// See docs/mechanics/ui.md for the full contract and a screen template.
import * as kit from './kit/index.js';
import { h, clear, humanize } from './kit/dom.js';
import { setStage, setStageScale, fitStage, STAGE_W, STAGE_H } from './kit/stage.js';
import { createShortcuts } from './kit/shortcuts.js';
import { createAnimator } from './kit/anim.js';
import { handleDialogKey, closeAllDialogs, dialogCount } from './kit/dialog.js';
import { hideTooltips } from './kit/tooltip.js';
import { toast, createLogStore } from './kit/toast.js';
import { Button, Panel, setClickSound } from './kit/button.js';
import { showPending } from './kit/pending.js';
import { sprite, drawSprite, initSprites, hasGfx, getGfx } from './sprites.js';
import { createStorage, createSettings, storageErrorText, AUTOSAVE_SLOT } from './storage.js';
import { createAudio } from './audio.js';

// ---- screen registry ----------------------------------------------------------------------------

/** @type {Map<string, () => (Promise<object> | object)>} */
const registry = new Map();

/**
 * Register a screen. `loader` returns (a promise of) a module exporting `mount(rootEl, ctx, params)`
 * and `unmount()` - either as named exports or as the default export. Use a dynamic import so the
 * screen is only fetched when first shown:
 *     registerScreen('adventure', () => import('./screens/adventure/index.js'));
 */
export function registerScreen(name, loader) {
  registry.set(name, typeof loader === 'function' ? loader : () => loader);
}
export function hasScreen(name) { return registry.has(name); }
export function screenNames() { return [...registry.keys()]; }

// Built-in screens (this file's owner) ...
registerScreen('mainMenu', () => import('./screens/mainMenu.js'));
registerScreen('newGame', () => import('./screens/newGame.js'));
registerScreen('loadGame', () => import('./screens/loadGame.js'));
registerScreen('encyclopedia', () => import('./screens/encyclopedia.js'));
registerScreen('options', () => import('./screens/options.js'));
registerScreen('credits', () => import('./screens/credits.js'));
// ... and the big screens written by other agents. Until those files exist the router shows a
// friendly "not available" panel instead of failing.
registerScreen('adventure', () => import('./screens/adventure/index.js'));
registerScreen('town', () => import('./screens/town/index.js'));
registerScreen('hero', () => import('./screens/hero/index.js'));
registerScreen('combat', () => import('./screens/combat/index.js'));
registerScreen('kingdom', () => import('./screens/kingdom/index.js'));
registerScreen('campaigns', () => import('./screens/campaign/select.js'));
registerScreen('campaignBriefing', () => import('./screens/campaign/briefing.js'));
registerScreen('editor', () => import('./screens/editor/index.js'));

// ---- lazy engine access -------------------------------------------------------------------------

export const ENGINE_MODULES = {
  game: '../engine/game.js',
  town: '../engine/town.js',
  hero: '../engine/hero.js',
  army: '../engine/army.js',
  bonuses: '../engine/bonuses.js',
  economy: '../engine/economy.js',
  pending: '../engine/pending.js',
  artifacts: '../engine/artifacts.js',
  leveling: '../engine/leveling.js',
  adventure: '../engine/adventure/index.js',
  combat: '../engine/combat/index.js',
  mapgen: '../engine/mapgen/index.js',
  ai: '../engine/ai/index.js',
};

/**
 * Lazy engine namespace. `await engine.load('game')` resolves the module or null (missing /
 * broken module - never throws); afterwards it is also available synchronously as `engine.game`.
 */
export function createEngineLoader(importer = (path) => import(path), log = () => {}) {
  const promises = {};
  const engine = {
    errors: {},
    names: Object.keys(ENGINE_MODULES),
    load(name) {
      if (!(name in ENGINE_MODULES)) return Promise.resolve(null);
      promises[name] ||= Promise.resolve()
        .then(() => importer(ENGINE_MODULES[name]))
        .then((mod) => { engine[name] = mod || null; return engine[name]; })
        .catch((err) => {
          engine[name] = null;
          engine.errors[name] = err;
          log(`Engine module '${name}' is not available: ${err && err.message}`, 'warn');
          return null;
        });
      return promises[name];
    },
    /** Load several modules; resolves `{ name: module | null }`. Default: all of them. */
    async loadAll(names = Object.keys(ENGINE_MODULES)) {
      const mods = await Promise.all(names.map((n) => engine.load(n)));
      return Object.fromEntries(names.map((n, i) => [n, mods[i]]));
    },
    available(name) { return !!engine[name]; },
  };
  for (const n of Object.keys(ENGINE_MODULES)) engine[n] = null;
  return engine;
}

// ---- the app ------------------------------------------------------------------------------------

/**
 * Create the application inside `rootEl`.
 * @param {HTMLElement} rootEl
 * @param {object} [opts] test/injection hooks:
 *   screens: { name: loader }   (override / add to the global registry for this app)
 *   importer: (path) => Promise<module>   (engine loader), storageBackend: Storage-like,
 *   window: window-like (default globalThis.window), home: name of the menu screen
 * @returns app { ctx, start(), showScreen, back, showError, destroy, stage, layers }
 */
export function createApp(rootEl, opts = {}) {
  const win = opts.window || (typeof window !== 'undefined' ? window : null);
  const home = opts.home || 'mainMenu';
  const localScreens = new Map(Object.entries(opts.screens || {}).map(([k, v]) => [k, typeof v === 'function' ? v : () => v]));

  // -- DOM skeleton: #app > .stage > layers ------------------------------------------------------
  const layers = {
    screen: h('div.layer.layer-screen'),
    dialogs: h('div.layer.layer-dialogs'),
    toasts: h('div.layer.layer-toasts'),
    tooltips: h('div.layer.layer-tooltips'),
    error: h('div.layer.layer-error'),
  };
  const stage = h('div.stage', { style: { width: STAGE_W, height: STAGE_H } },
    layers.screen, layers.dialogs, layers.toasts, layers.tooltips, layers.error);
  rootEl.classList.add('app-root');
  clear(rootEl, stage);
  setStage(stage, layers);

  // -- services ----------------------------------------------------------------------------------
  const backend = opts.storageBackend || undefined;
  const settings = createSettings(backend);
  const storage = createStorage({ backend });
  const audio = createAudio(settings);
  const logStore = createLogStore();
  const keys = createShortcuts();
  const anim = createAnimator({ speed: () => settings.get('animSpeed') || 1 });
  const log = (text, kind = 'info') => logStore.add(text, kind);
  const engine = createEngineLoader(opts.importer, log);
  setClickSound((name) => audio.play(name));

  let state = null;
  const stateListeners = new Set();     // cleared on every screen change
  const history = [];                   // [{ name, params }]
  let current = null;                   // { name, params, mod, el }
  let navToken = 0;
  let errorOpen = false;
  let resolvingPendings = false;

  function fit() {
    if (!win) return;
    const f = fitStage(win.innerWidth || STAGE_W, win.innerHeight || STAGE_H, settings.get('uiScale'));
    stage.style.transform = `scale(${f.scale})`;
    stage.style.left = `${f.left}px`;
    stage.style.top = `${f.top}px`;
    setStageScale(f.scale);
  }

  // -- context -----------------------------------------------------------------------------------
  const ctx = {
    app: null,
    stage,
    /** Current GameState (plain JSON) or null. */
    get state() { return state; },
    /** Replace the game state (new game / load). Notifies `onState` listeners. */
    setState(next, { silent = false } = {}) {
      state = next || null;
      if (!silent) ctx.notify('set');
      return state;
    },
    /** Tell the UI the state was mutated by an engine call: `ctx.notify('move', result)`. */
    notify(reason = 'change', payload = null) {
      for (const fn of [...stateListeners]) {
        try { fn(state, reason, payload); } catch (err) { showError(err); }
      }
    },
    /** Subscribe to state changes for the lifetime of the current screen. Returns an unsubscribe fn. */
    onState(fn) { stateListeners.add(fn); return () => stateListeners.delete(fn); },
    /**
     * Run an engine action with the standard Result handling:
     *   const res = ctx.act((state) => adventure.moveHero(state, heroId, dest));
     * ok:false => error toast + 'error' blip; ok:true => events are logged via `describeEvent` (if
     * given) and listeners are notified. Exceptions go to the error overlay. Returns the Result.
     */
    act(fn, { silent = false, reason = 'action' } = {}) {
      let res;
      try { res = fn(state); } catch (err) { showError(err); return { ok: false, error: 'exception' }; }
      if (res && res.ok === false) {
        if (!silent) { toast(humanize(res.error || 'not possible'), 'error'); audio.play('error'); }
        return res;
      }
      ctx.notify(reason, res);
      return res || { ok: true, events: [] };
    },
    /**
     * Show dialogs for every pending choice of the current human player, one at a time, and
     * resolve them through the engine (`resolvePending`). Call after any action that may queue
     * choices (after its animations). Safe to call re-entrantly.
     */
    async resolvePendings() {
      if (resolvingPendings || !state) return 0;
      resolvingPendings = true;
      let done = 0;
      try {
        const pendingApi = await engine.load('pending');
        for (let guard = 0; guard < 200; guard++) {
          const s = state;
          if (!s || !Array.isArray(s.pending) || s.pending.length === 0) break;
          const player = (s.players || [])[s.currentPlayer];
          const p = s.pending.find((x) => !player || x.playerId == null || (x.playerId === player.id && player.isHuman !== false));
          if (!p) break;
          const choice = await showPending(p, ctx);
          if (state !== s) break;                       // a load / new game happened meanwhile
          const resolver = (engine.game && engine.game.resolvePending) || (pendingApi && pendingApi.resolvePending);
          if (!resolver) { log('No engine available to resolve a pending choice.', 'warn'); break; }
          const res = resolver(s, p.id, choice.optionIndex, choice.extra);
          if (res && res.ok === false) { toast(humanize(res.error || 'not possible'), 'error'); break; }
          done++;
          ctx.notify('pending', res);
        }
      } catch (err) {
        showError(err);
      } finally {
        resolvingPendings = false;
      }
      return done;
    },

    // graphics
    sprite, drawSprite,
    gfx: { sprite, drawSprite, get available() { return hasGfx(); }, get module() { return getGfx(); } },
    /** The widget kit (src/ui/kit/index.js). */
    ui: kit,

    // navigation
    showScreen,
    back,
    get screen() { return current ? current.name : null; },
    get params() { return current ? current.params : null; },

    // persistence
    storage, settings,
    /** Save the current game: `await ctx.save('slot1', 'My game')` -> { ok, meta } | { ok:false, error } */
    async save(slot, name) {
      await useGameCodec();
      const res = storage.save(slot, state, { name });
      if (!res.ok) log(storageErrorText(res.error), 'error');
      return res;
    },
    /** Load a slot and make it the current state: `await ctx.load('slot1')` -> { ok, state, meta } */
    async load(slot) {
      await useGameCodec();
      const res = storage.load(slot);
      if (res.ok) ctx.setState(res.state);
      else log(storageErrorText(res.error), 'error');
      return res;
    },
    /** Autosave if the option is on (adventure screen: call at the start of each human turn). */
    async autosave() {
      if (!settings.get('autosave') || !state) return { ok: false, error: 'disabled' };
      return ctx.save(AUTOSAVE_SLOT, 'Autosave');
    },

    audio, engine, keys, anim,
    log, logStore,
    toast,
    showError,
  };

  async function useGameCodec() {
    const game = await engine.load('game');
    storage.setCodec(game && game.serialize && game.deserialize ? { serialize: game.serialize, deserialize: game.deserialize } : {});
  }

  // -- router ------------------------------------------------------------------------------------
  async function teardown() {
    const prev = current;
    current = null;
    if (prev && prev.mod && typeof prev.mod.unmount === 'function') {
      try { await prev.mod.unmount(); } catch (err) { console.error(`[app] unmount of '${prev.name}' failed`, err); log(`Screen '${prev.name}' failed to unmount: ${err.message}`, 'error'); }
    }
    keys.clearScreen();
    stateListeners.clear();
    anim.cancelAll();
    hideTooltips();
    closeAllDialogs();
    clear(layers.screen);
  }

  async function loadScreen(name) {
    const loader = localScreens.get(name) || registry.get(name);
    if (!loader) throw new Error(`No screen registered under '${name}'`);
    const mod = await loader();
    const scr = mod && typeof mod.mount === 'function' ? mod : mod && mod.default;
    if (!scr || typeof scr.mount !== 'function') throw new Error(`Screen module '${name}' does not export mount()`);
    return scr;
  }

  function renderUnavailable(el, name, err) {
    const detail = err && err.message ? String(err.message) : '';
    // a module that exists but could not be fetched (flaky connection, server stopped) is not
    // "missing from the build": say so and offer a reload (browsers cache failed module fetches)
    const network = /failed to fetch|importing a module script failed|error loading dynamically imported module|networkerror/i.test(detail);
    const canReload = network && typeof location !== 'undefined' && typeof location.reload === 'function';
    el.appendChild(h('div.screen-unavailable', null,
      Panel({ title: network ? 'Could not load' : 'Not available yet', variant: 'parchment', class: 'unavailable-panel' },
        h('p', null, network
          ? `The "${humanize(name)}" screen could not be downloaded. Check that the game server is running, then reload the page (your game in progress is kept in the autosave).`
          : `The "${humanize(name)}" screen is not part of this build yet.`),
        detail ? h('p.unavailable-detail', null, detail) : null,
        h('div.k-row.k-row-center', null,
          Button('Back', { kind: 'primary', onClick: () => back() }),
          canReload ? Button('Reload', { onClick: () => location.reload() }) : null,
          Button('Main menu', { onClick: () => showScreen(home) })))));
    keys.bind('escape', () => back(), 'Back');
  }

  /**
   * Switch screens. Unmounts the current screen, clears its shortcuts / state listeners /
   * animations / dialogs, then loads and mounts the new one.
   * @param {string} name   registered screen name
   * @param {object} [params] passed to `mount(rootEl, ctx, params)`
   * @param {{ replace?: boolean }} [o] replace: do not add a history entry (ctx.back skips it)
   * @returns {Promise<boolean>} true when the screen mounted
   */
  async function showScreen(name, params = {}, o = {}) {
    const token = ++navToken;
    await teardown();
    if (token !== navToken) return false;
    if (name === home) history.length = 0;
    if (o.replace && history.length) history.pop();
    if (!o.isBack) history.push({ name, params });
    const el = h('div.screen', { class: `screen-${name}`, dataset: { screen: name } });
    current = { name, params, mod: null, el };
    layers.screen.appendChild(el);
    let mod;
    try {
      mod = await loadScreen(name);
    } catch (err) {
      if (token !== navToken) return false;
      log(`Screen '${name}' is not available: ${err && err.message}`, 'warn');
      // An unavailable screen is not a place to come back to: drop it from the history.
      if (!o.isBack) history.pop();
      current.failed = true;
      renderUnavailable(el, name, err);
      return false;
    }
    if (token !== navToken) return false;
    try {
      current.mod = mod;
      await mod.mount(el, ctx, params);
    } catch (err) {
      if (token === navToken) showError(err, { title: `The "${humanize(name)}" screen crashed` });
      return false;
    }
    return token === navToken;
  }

  /** Go to the previous screen in the history (or the main menu). */
  function back(fallback = home) {
    if (!(current && current.failed)) history.pop();   // the current screen (failed ones were never kept)
    const prev = history[history.length - 1];
    if (prev) return showScreen(prev.name, prev.params, { isBack: true });
    return showScreen(fallback);
  }

  // -- error boundary ----------------------------------------------------------------------------
  /** Show the error overlay instead of leaving a dead page. */
  function showError(err, o = {}) {
    const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : (err && err.message) || 'Unknown error');
    try { console.error('[app]', error); } catch { /* ignore */ }
    log(`Error: ${error.message}`, 'error');
    errorOpen = true;
    const dismiss = () => { errorOpen = false; clear(layers.error); };
    clear(layers.error, h('div.error-overlay', null,
      h('div.k-panel.k-panel-dark.error-box', null,
        h('div.k-panel-title', null, o.title || 'Something went wrong'),
        h('div.error-message', null, error.message || String(error)),
        h('pre.error-stack', null, String(error.stack || '(no stack trace)')),
        h('div.k-row.k-row-center', null,
          Button('Back to main menu', { kind: 'primary', onClick: () => { dismiss(); showScreen(home); } }),
          Button('Dismiss', { onClick: dismiss })))));
    return error;
  }

  // -- global events -----------------------------------------------------------------------------
  const offs = [];
  const listen = (target, type, fn, o) => {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, fn, o);
    offs.push(() => target.removeEventListener(type, fn, o));
  };
  listen(win, 'resize', fit);
  listen(win, 'error', (e) => { showError(e.error || e.message || 'Script error'); });
  listen(win, 'unhandledrejection', (e) => { showError(e.reason || 'Unhandled promise rejection'); });
  listen(win, 'keydown', (e) => {
    audio.unlock();
    if (errorOpen) {
      if (String(e.key).toLowerCase() === 'escape') { errorOpen = false; clear(layers.error); }
      return;
    }
    if (handleDialogKey(e)) return;
    keys.handle(e);
  });
  listen(win, 'mousedown', () => audio.unlock());
  // The original uses right-click for info popups: never show the browser menu on the stage.
  listen(stage, 'contextmenu', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && e.preventDefault) e.preventDefault();
  });
  offs.push(settings.subscribe((key) => { if (key === 'uiScale') fit(); }));

  const app = {
    ctx, stage, layers, settings, storage, audio, keys, anim, engine,
    showScreen, back, showError, fit,
    get screen() { return current ? current.name : null; },
    get history() { return history.map((x) => x.name); },
    get dialogCount() { return dialogCount(); },
    /** Load the graphics module (if present) and show the main menu. */
    async start(name = home, params = {}) {
      fit();
      await initSprites(opts.gfxLoader);
      return showScreen(name, params);
    },
    async destroy() {
      navToken++;
      await teardown();
      for (const off of offs.splice(0)) off();
      setClickSound(null);
      setStage(null, {});
      clear(rootEl);
    },
  };
  ctx.app = app;
  fit();
  return app;
}
