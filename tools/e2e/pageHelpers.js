// In-page helpers for the e2e scenarios, installed as `window.e2e` (evaluated in the page).
// Setup/assertion shortcuts only: the scenarios still drive the UI with real input events.
window.e2e = {
  /** Start a game like the New Game screen does. opts: { size, players: ['human','ai',...], seed, underground, scenarioId, faction } */
  async newGame(opts = {}) {
    const ctx = h3.ctx;
    const M = await import('/src/ui/screens/newGameModel.js');
    const gen = await ctx.engine.load('mapgen');
    const game = await ctx.engine.load('game');
    const setup = M.createSetup({ seed: opts.seed || 12345 });
    if (opts.scenarioId) {
      M.setMapType(setup, 'scenario');
      const meta = gen.listScenarios().find((s) => s.id === opts.scenarioId);
      M.setScenario(setup, meta);
    } else {
      M.setMapSize(setup, opts.size || 'S');
      setup.underground = !!opts.underground;
      if (opts.template) setup.template = opts.template;
    }
    if (opts.players) opts.players.forEach((t, i) => M.setSlotType(setup, i, t));
    if (opts.faction) M.setSlotFaction(setup, 0, opts.faction);
    const v = M.validateSetup(setup);
    if (!v.ok) throw new Error(`setup invalid: ${v.errors.join('; ')}`);
    const t0 = performance.now();
    let bp = gen.generateMap(M.buildMapOptions(setup));
    bp = bp.blueprint || bp;
    const t1 = performance.now();
    const settings = M.buildGameSettings(setup);
    if (setup.mapType === 'scenario') { if (bp.victory) settings.victory = bp.victory; if (bp.loss) settings.loss = bp.loss; }
    const state = game.createGame(bp, settings);
    const t2 = performance.now();
    ctx.setState(state, { silent: true });
    await ctx.showScreen('adventure', { newGame: true });
    return { genMs: Math.round(t1 - t0), createMs: Math.round(t2 - t1), w: state.map.width, h: state.map.height, levels: state.map.levels };
  },
  state() { return h3.ctx.state; },
  me() { const s = h3.ctx.state; return s.players[s.currentPlayer]; },
  myHeroes() { const s = h3.ctx.state; return this.me().heroes.map((id) => s.heroes[id]); },
  async adv() { return (await import('/src/ui/screens/adventure/index.js')).getController(); },
  async combat() { const m = await import('/src/ui/screens/combat/index.js'); return m.getSession ? m.getSession() : null; },
  /** Adventure map tile -> client px (centre of the tile), after centring the camera on it if off-screen. */
  async tileClient(x, y, { center = false } = {}) {
    const c = await this.adv();
    if (center || !c.mapView.isTileVisible(x, y)) c.mapView.centerOnTile(x, y);
    const ts = c.mapView.ts ?? 32;
    const p = c.mapView.tileToScreen(x, y);
    const r = c.mapView.canvas.getBoundingClientRect();
    const k = r.width / 1040;
    return { x: r.x + (p.x + ts / 2) * k, y: r.y + (p.y + ts / 2) * k };
  },
  /** Combat hex -> client px of its centre. */
  async hexClient(x, y) {
    const S = await this.combat();
    const c = S.layout.center(x, y);
    const r = S.canvas.getBoundingClientRect();
    const k = r.width / 1280;
    return { x: r.x + c.x * k, y: r.y + c.y * k };
  },
  /** Summary of the live battle: active stack, legal actions, stacks. */
  async battle() {
    const S = await this.combat();
    if (!S) return null;
    const cs = S.cs; const L = S.legal;
    const act = cs.stacks.find((s) => s.id === (cs.active && typeof cs.active === "object" ? cs.active.id : cs.active)) || null;
    return { waiting: S.waiting, finished: S.finished, round: cs.round, phase: cs.phase, over: !!cs.winner || !!cs.over,
      active: act && { id: act.id, side: act.side, c: act.creatureId, n: act.count, pos: act.pos },
      legal: L && { moves: (L.moves || []).length, attacks: (L.attacks || []).map((a) => a.targetId), shots: L.shots || [], canCast: L.canCast, spells: (L.spells || []).map((s) => s.id || s) },
      stacks: cs.stacks.filter((s) => s.count > 0).map((s) => `${s.id}:${s.side[0]}:${s.creatureId}x${s.count}@${s.pos ? s.pos.x + ',' + s.pos.y : '?'}`) };
  },
  dialogs() { return [...document.querySelectorAll('.k-dlg')].map((d) => d.textContent.slice(0, 200)); },
  dialogTitles() { return [...document.querySelectorAll('.k-dlg .k-dlg-title')].map((d) => d.textContent); },
  async waitIdle(ms = 30000) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (!document.querySelector('.adv-overlay.is-busy, .adv-busy')) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  },
  mem() { const m = performance.memory; return m ? { usedMB: Math.round(m.usedJSHeapSize / 1e6), totalMB: Math.round(m.totalJSHeapSize / 1e6) } : null; },
  /** Measure rAF frame times for `ms` while calling step(i) every frame. */
  async frames(ms, step) {
    const times = []; let last = performance.now(); const t0 = last; let i = 0;
    await new Promise((resolve) => {
      const f = (t) => { times.push(t - last); last = t; if (step) step(i++); if (t - t0 < ms) requestAnimationFrame(f); else resolve(); };
      requestAnimationFrame(f);
    });
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { n: times.length, avgMs: +avg.toFixed(1), p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), maxMs: +sorted[sorted.length - 1].toFixed(1) };
  },
};
true;
