// End-to-end scenarios (see README.md). Each scenario drives the real UI with mouse / keyboard
// events; `window.h3` / `window.e2e` (pageHelpers.js) are used for setup shortcuts and assertions.

/** Count non-transparent, non-black pixels of a canvas (rough "did it render" check). */
const CANVAS_INK = (sel) => `(() => { const c = document.querySelector(${JSON.stringify(sel)}); if (!c) return -1;
  const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 4 * 37) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] > 40) n++; return n; })()`;

async function newGameByClicks(t, { size = 'S', seed = 17 } = {}) {
  await t.open();
  await t.button('New Game');
  await t.waitFor('h3.screen === "newGame" && document.querySelector(".ng-prow")');
  await t.sleep(300);
  await t.button(size);
  // type the seed (deterministic map)
  const seedBox = await t.box('.ng-map-body input');
  await t.click(seedBox.cx, seedBox.cy);
  await t.key('a', { ctrl: true });
  await t.page.type(String(seed));
  await t.key('Tab');
  await t.sleep(200);
  await t.button('Start Game');
  await t.waitFor('h3.screen === "adventure" && document.querySelector(".adv-root canvas")', 30000);
  await t.sleep(800);
  await t.ackDialogs();
}

async function endTurn(t, { maxMs = 60000 } = {}) {
  const before = await t.eval('JSON.stringify([e2e.state().turn, e2e.state().currentPlayer])');
  const t0 = Date.now();
  await t.key('e');
  await t.sleep(300);
  const d = await t.dialogs();
  if (d.length && /still move|End your turn/i.test(d[d.length - 1])) await t.key('Enter');
  // back to a human player on a later turn with nothing busy - or something needs the human
  // (a battle where the AI attacks us, a dialog, the end of the game)
  await t.waitFor(`(async () => { if (h3.screen !== 'adventure') return true; const s = e2e.state(); if (!s) return true;
    const k = JSON.stringify([s.turn, s.currentPlayer]); const c = await e2e.adv();
    if (k === ${JSON.stringify(before)}) return false;
    return (s.players[s.currentPlayer].isHuman && c && !c.busy) || e2e.dialogs().length > 0; })()`, maxMs, 50);
  return Date.now() - t0;
}

/**
 * Deterministic readiness of the adventure screen: mounted, its controller's start-up promise
 * (`ready`) settled, not busy, no dialog open - only then do its keyboard shortcuts work.
 */
async function adventureReady(t, maxMs = 30000) {
  await t.waitFor(`(async () => { if (h3.screen !== 'adventure') return false; const c = await e2e.adv(); if (!c) return false;
    if (!c.ready) return false; await c.ready; return !c.busy && e2e.dialogs().length === 0; })()`, maxMs, 50);
}

/** Nearest object of a predicate that the selected hero can path to (returns {id, pos, path}). */
async function findTarget(t, predicateSrc) {
  return t.eval(`(async () => {
    const adv = await import('/src/engine/adventure/index.js');
    const s = e2e.state(); const h = e2e.myHeroes()[0];
    const pred = ${predicateSrc};
    const objs = Object.values(s.map.objects).filter((o) => o.pos.z === h.pos.z && pred(o, s))
      .map((o) => ({ o, d: Math.abs(o.pos.x - h.pos.x) + Math.abs(o.pos.y - h.pos.y) })).sort((a, b) => a.d - b.d);
    for (const { o } of objs.slice(0, 40)) {
      const p = adv.findPath(s, h.id, o.pos);
      if (p && p.path && p.path.length) return { id: o.id, defId: o.defId, pos: o.pos, steps: p.path.length, turns: p.turns };
    }
    return null;
  })()`);
}

/** Two clicks on a map tile with the selected hero: preview, then go. */
async function walkTo(t, pos) {
  const p = await t.tile(pos.x, pos.y);
  await t.click(p.x, p.y);
  await t.sleep(250);
  const p2 = await t.tile(pos.x, pos.y);
  await t.click(p2.x, p2.y);
}

async function giveSpells(t) {
  await t.eval(`(() => { const h = e2e.myHeroes()[0];
    h.artifacts.equipped.spellbook = ['spellbook'];
    for (const sp of ['magic_arrow', 'bless', 'haste', 'lightning_bolt', 'cure', 'slow']) if (!h.spells.includes(sp)) h.spells.push(sp);
    h.mana = 60; h.primary.power = Math.max(h.primary.power, 3); h.primary.knowledge = Math.max(h.primary.knowledge, 6);
    h3.ctx.notify('debug'); return true; })()`);
}

async function waitCombatTurn(t, ms = 30000) {
  await t.waitFor('(async () => { const b = await e2e.battle(); return b && (b.waiting || b.finished); })()', ms, 100);
  return t.eval('e2e.battle()');
}

/** Finish an open battle with auto-combat, acknowledge the result and return to the adventure map. */
async function finishBattle(t) {
  const b = await t.eval('e2e.battle()');
  if (b && !b.finished) await t.key('a');
  await t.waitFor('h3.screen !== "combat" || document.querySelector(".cmb-result-dlg, .k-dlg")', 180000, 200);
  await t.sleep(400);
  await t.shot('combat-result');
  const seen = [];
  // result dialog, level-ups, then the adventure map (or the main menu after a game-ending victory)
  for (let i = 0; i < 20 && !['adventure', 'mainMenu'].includes(await t.screen()); i++) {
    const d = await t.dialogs();
    if (d.length) { seen.push(d[d.length - 1]); if (/won|victory|defeat|lost/i.test(d[d.length - 1]) && !/casualties/i.test(d[d.length - 1])) await t.shot('game-over'); await t.key('Enter'); }
    await t.sleep(400);
  }
  await t.waitFor('["adventure", "mainMenu"].includes(h3.screen)', 30000);
  await t.sleep(300);
  if (await t.screen() === 'adventure') {
    if ((await t.dialogs()).length) await t.shot('after-battle-dialog');
    seen.push(...await t.ackDialogs());
  }
  return seen;
}

export const SCENARIOS = [
  {
    name: 'menu',
    async run(t) {
      await t.open();
      await t.sleep(1200);
      await t.shot('01-main-menu');
      t.check(await t.eval(CANVAS_INK('.mm-bg')) > 100, 'main menu background rendered');
      // encyclopedia
      await t.button('Encyclopedia');
      await t.waitFor('h3.screen === "encyclopedia" && document.querySelector(".enc-row")', 15000);
      await t.sleep(1500);
      await t.shot('02-encyclopedia-creatures');
      const rows = await t.eval('document.querySelectorAll(".enc-list .enc-row").length');
      t.check(rows > 20, `creature list (${rows})`);
      // the detail sprite is animated (idle loop): two samples differ
      const sample = '(() => { const c = document.querySelector(".enc-entry-head canvas"); if (!c) return null; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 11) h = (h * 31 + d[i]) | 0; return h; })()';
      const a = await t.eval(sample); await t.sleep(700); const b = await t.eval(sample);
      t.metrics.encyclopediaSpriteAnimated = a !== b;
      await t.clickEl('.enc-cat', 'Heroes');
      await t.sleep(1200);
      t.check(await t.eval(CANVAS_INK('.enc-entry-head canvas')) > 20, 'hero portrait rendered');
      await t.shot('03-encyclopedia-heroes');
      for (const cat of ['Spells', 'Artifacts', 'Towns', 'Map Objects']) { await t.clickEl('.enc-cat', cat); await t.sleep(500); }
      await t.shot('04-encyclopedia-mapobjects');
      await t.key('Escape');
      await t.waitFor('h3.screen === "mainMenu"');
      // options / credits via shortcuts
      await t.key('o');
      await t.waitFor('h3.screen === "options"');
      await t.shot('05-options');
      await t.key('Escape');
      await t.waitFor('h3.screen === "mainMenu"');
      await t.key('r');
      await t.waitFor('h3.screen === "credits"');
      await t.shot('06-credits');
      await t.key('Escape');
      await t.waitFor('h3.screen === "mainMenu"');
    },
  },
  {
    name: 'adventure',
    async run(t) {
      await t.eval('localStorage.clear(), 1').catch(() => {});
      await newGameByClicks(t, { size: 'S' });
      await t.shot('10-adventure-start');
      t.check(await t.eval(CANVAS_INK('.adv-mapwrap canvas')) > 500, 'map canvas rendered');
      const hero = await t.eval('e2e.myHeroes()[0]');
      t.check(hero, 'human has a hero');
      // pick up the nearest resource / treasure the hero can reach today
      const target = await findTarget(t, `(o, s) => /^resource_|treasure_chest|campfire/.test(o.defId) && !Object.values(s.map.objects).some((m) => m.defId === 'monster' && Math.abs(m.pos.x - o.pos.x) <= 1 && Math.abs(m.pos.y - o.pos.y) <= 1)`);
      t.check(target, 'a reachable resource exists');
      t.check(await t.eval('e2e.state().settings.seed') === 17, 'typed seed used');
      t.log(`target ${target.defId} at ${target.pos.x},${target.pos.y} (${target.steps} steps, +${target.turns} days)`);
      const res0 = await t.eval('JSON.stringify(e2e.me().resources)');
      await walkTo(t, target.pos);
      await t.sleep(200);
      await t.shot('11-adventure-moving');
      await t.waitFor('(async () => !(await e2e.adv()).busy)()', 30000);
      await t.ackDialogs();
      const moved = await t.eval(`(() => { const h = e2e.myHeroes()[0]; return h.pos.x !== ${hero.pos.x} || h.pos.y !== ${hero.pos.y}; })()`);
      t.check(moved, 'hero moved');
      if (target.turns === 0) {
        const gone = await t.eval(`!e2e.state().map.objects[${JSON.stringify(target.id)}]`);
        const res1 = await t.eval('JSON.stringify(e2e.me().resources)');
        t.check(gone || res1 !== res0, 'resource picked up');
      }
      await t.shot('12-adventure-after-move');
      // hero screen
      await t.key('Enter');
      await t.waitFor('h3.screen === "hero"');
      await t.sleep(600);
      await t.shot('13-hero-screen');
      await t.key('Escape');
      await adventureReady(t);
      // town screen: select the town with T, open it with Enter
      await t.key('t');
      await t.sleep(300);
      await t.key('Enter');
      await t.waitFor('h3.screen === "town"');
      await t.sleep(800);
      await t.shot('14-town');
      // build: Town Hall, first buildable card, Build
      await t.key('b');
      await t.waitFor('document.querySelector(".k-dlg")');
      await t.sleep(400);
      await t.shot('15-town-hall');
      const builtBefore = await t.eval('JSON.stringify(e2e.state().towns[e2e.me().towns[0]].buildings)');
      const card = await t.eval(`(() => { const c = [...document.querySelectorAll('.k-dlg [class*="card"]')].find((e) => /Can be built/.test(e.textContent)); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, name: c.textContent }; })()`);
      t.check(card, 'a buildable building in the hall');
      await t.click(card.x, card.y);
      await t.sleep(400);
      await t.button('Build');
      await t.sleep(600);
      const builtAfter = await t.eval('JSON.stringify(e2e.state().towns[e2e.me().towns[0]].buildings)');
      t.check(builtAfter !== builtBefore, `built ${card.name}`);
      await t.ackDialogs();
      // recruit from the first dwelling row of the growth panel
      const row = await t.box('.town-growth-row:not(.is-unbuilt)');
      if (row) {
        await t.click(row.cx, row.cy);
        await t.waitFor('document.querySelector(".k-dlg")');
        await t.sleep(300);
        await t.shot('16-recruit');
        await t.button('Max').catch(() => {});
        await t.button('Recruit');
        await t.sleep(500);
        const garrison = await t.eval('e2e.state().towns[e2e.me().towns[0]].garrison.filter(Boolean).length');
        t.check(garrison > 0, 'recruited into the garrison');
      } else t.log('no growth row found (skipped recruit)');
      await t.shot('17-town-after');
      await t.key('Escape');
      await adventureReady(t);
      // kingdom overview
      await t.key('k');
      await t.waitFor('h3.screen === "kingdom"');
      await t.sleep(500);
      await t.shot('18-kingdom');
      await t.key('Escape');
      await t.waitFor('h3.screen === "adventure"');
      // several days against the AI
      const times = [];
      for (let d = 0; d < 4; d++) { times.push(await endTurn(t)); await t.ackDialogs(); }
      t.metrics.endTurnMsSmall2p = times;
      const ai = await t.eval('(() => { const s = e2e.state(); const p = s.players.find((x) => !x.isHuman); return { heroes: p.heroes.length, moved: p.heroes.some((id) => s.heroes[id].movePoints < s.heroes[id].maxMovePoints || true) }; })()');
      t.check(ai.heroes > 0, 'AI still has heroes');
      await t.shot('19-adventure-day5');
    },
  },
  {
    name: 'combat',
    async run(t) {
      await t.open();
      await t.eval('e2e.newGame({ size: "S", seed: 777 })');
      await t.sleep(600);
      await t.ackDialogs();
      await giveSpells(t);
      // beef up the army so the fight is won and lasts a few rounds
      await t.eval(`(() => { const h = e2e.myHeroes()[0]; h.army.forEach((s) => { if (s) s.count *= 3; }); return true; })()`);
      const mon = await findTarget(t, '(o) => o.defId === "monster"');
      t.check(mon, 'a reachable monster');
      t.log(`monster ${mon.id} at ${mon.pos.x},${mon.pos.y}`);
      await walkTo(t, mon.pos);
      await t.waitFor('h3.screen === "combat" || e2e.dialogs().length > 0', 60000, 100);
      if (await t.screen() !== 'combat') {
        // some monsters ask first (join / flee offers); fight
        await t.shot('20-monster-dialog');
        const d = await t.dialogs();
        t.log(`dialog before combat: ${d[0]}`);
        await t.button('Fight').catch(async () => { await t.key('Enter'); });
        await t.waitFor('h3.screen === "combat"', 30000);
      }
      let b = await waitCombatTurn(t);
      await t.sleep(800);
      await t.shot('21-combat-start');
      const did = [];
      for (let step = 0; step < 14 && !b.finished; step++) {
        const L = b.legal;
        if (L.canCast && !did.includes('cast')) {
          // spell book -> Magic Arrow (or the first castable) -> click an enemy
          await t.key('c');
          await t.waitFor('document.querySelector(".k-dlg")', 5000);
          await t.sleep(400);
          await t.shot('22-spellbook');
          const ok = await t.eval(`(() => { const e = [...document.querySelectorAll('.k-dlg [class*="spell"]')].find((x) => /Magic Arrow|Lightning/.test(x.textContent) && !x.className.includes('disabled')); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
          if (ok) {
            await t.click(ok.x, ok.y);
            await t.sleep(300);
            const sel = await t.dialogs();
            if (sel.length) await t.button('Cast').catch(() => {});
            await t.sleep(300);
            const enemy = await t.eval('(async () => { const S = await e2e.combat(); const s = S.cs.stacks.find((x) => x.side === "defender" && x.count > 0); return s && s.pos; })()');
            const p = await t.hex(enemy.x, enemy.y);
            await t.click(p.x, p.y);
            did.push('cast');
            await t.sleep(1200);
            await t.shot('23-after-cast');
          } else { await t.key('Escape'); did.push('cast-none'); }
        } else if (L.shots.length && !did.includes('shoot')) {
          const tgt = await t.eval(`(async () => { const S = await e2e.combat(); return S.cs.stacks.find((x) => x.id === ${L.shots[0]}).pos; })()`);
          const p = await t.hex(tgt.x, tgt.y);
          await t.click(p.x, p.y); did.push('shoot');
        } else if (L.attacks.length && !did.includes('attack')) {
          const tgt = await t.eval(`(async () => { const S = await e2e.combat(); return S.cs.stacks.find((x) => x.id === ${L.attacks[0]}).pos; })()`);
          const p = await t.hex(tgt.x, tgt.y);
          await t.click(p.x - 18, p.y); did.push('attack');
        } else if (!did.includes('wait')) { await t.key('w'); did.push('wait'); }
        else if (!did.includes('defend')) { await t.key('d'); did.push('defend'); }
        else if (L.moves > 0 && !did.includes('move')) {
          const act = b.active.pos;
          const p = await t.hex(Math.min(14, act.x + 2), act.y);
          await t.click(p.x, p.y); did.push('move');
        } else break;
        await t.sleep(900);
        if (step === 2) await t.shot('24-combat-mid');
        b = await waitCombatTurn(t, 60000);
      }
      t.log(`combat actions: ${did.join(', ')}`);
      t.check(did.includes('wait') || did.includes('defend') || did.includes('attack'), 'some combat actions were taken');
      await finishBattle(t);
      await t.shot('25-after-battle');
      t.check(!(await t.eval('!!e2e.state().combat')), 'battle cleared from state');
    },
  },
  {
    name: 'quickcombat',
    async run(t) {
      await t.open();
      await t.eval('e2e.newGame({ size: "S", seed: 4242 })');
      await t.sleep(600);
      await t.ackDialogs();
      await t.eval('h3.ctx.settings.set("quickCombat", true), 1');
      await t.eval(`(() => { const h = e2e.myHeroes()[0]; h.army.forEach((s) => { if (s) s.count *= 5; }); return 1; })()`);
      const mon = await findTarget(t, '(o) => o.defId === "monster"');
      t.check(mon, 'a reachable monster');
      await walkTo(t, mon.pos);
      await t.waitFor('e2e.dialogs().length > 0', 60000, 100);
      await t.sleep(300);
      await t.shot('26-quick-combat-result');
      t.check(await t.screen() === 'adventure', 'quick combat stays on the adventure map');
      await t.ackDialogs();
      await t.eval('h3.ctx.settings.set("quickCombat", false), 1');
      t.check(!(await t.eval('!!e2e.state().combat')), 'quick battle resolved');
    },
  },
  {
    name: 'siege',
    async run(t) {
      await t.open();
      await t.eval('e2e.newGame({ size: "S", seed: 99 })');
      await t.sleep(600);
      await t.ackDialogs();
      // teleport our hero next to the enemy town with a strong army (setup shortcut), then click the town
      const where = await t.eval(`(async () => {
        const adv = await import('/src/engine/adventure/index.js');
        const s = e2e.state(); const h = e2e.myHeroes()[0];
        const enemy = Object.values(s.towns).find((x) => x.owner != null && x.owner !== e2e.me().id);
        const e = enemy.pos;
        if (h.townId && s.towns[h.townId] && s.towns[h.townId].visitingHero === h.id) s.towns[h.townId].visitingHero = null;
        h.townId = null;
        h.army = [{ creatureId: 'arch_angel', count: 12 }, { creatureId: 'angel', count: 20 }, null, null, null, null, null];
        const cands = [];
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) cands.push({ x: e.x + dx, y: e.y + dy, z: e.z });
        cands.sort((a, b) => (Math.abs(a.x - e.x) + Math.abs(a.y - e.y)) - (Math.abs(b.x - e.x) + Math.abs(b.y - e.y)));
        for (const c of cands) {
          const tl = s.map.tiles[c.z]?.[c.y]?.[c.x];
          if (!tl || tl.blocked || tl.obj || adv.getHeroAt(s, c)) continue;
          h.pos = c; h.movePoints = h.maxMovePoints;
          const p = adv.findPath(s, h.id, e);
          if (p && p.path && p.path.length && p.turns === 0) return { town: enemy.id, pos: e, from: c };
        }
        return null;
      })()`);
      t.check(where, 'found a tile next to an enemy town');
      await t.eval(`(async () => { const h = e2e.myHeroes()[0];
        const c = await e2e.adv(); h3.ctx.notify('debug'); c.mapView.invalidateObjects(); c.selectHero(h.id, { center: true }); return 1; })()`);
      await t.sleep(500);
      await walkTo(t, where.pos);
      await t.waitFor('h3.screen === "combat"', 60000, 100);
      await waitCombatTurn(t, 60000);
      await t.sleep(1500);
      await t.shot('27-siege');
      const siege = await t.eval('(async () => !!(await e2e.combat()).cs.siege)()');
      t.check(siege, 'combat is a siege');
      const seen = await finishBattle(t);
      t.log(`after the siege: ${await t.screen()} | ${seen.map((x) => x.slice(0, 60)).join(' | ')}`);
      const owner = await t.eval(`e2e.state() && e2e.state().towns[${JSON.stringify(where.town)}].owner === e2e.state().players[0].id`);
      t.check(owner, 'town captured');
      await t.shot('28-after-siege');
    },
  },
  {
    name: 'defend',
    // a computer hero attacks our town: the battle is shown to the human (defender), then the turn goes on
    async run(t) {
      await t.open();
      await t.eval('e2e.newGame({ size: "S", seed: 99 })');
      await t.sleep(500);
      await t.ackDialogs();
      const placed = await t.eval(`(async () => { const adv = await import('/src/engine/adventure/index.js'); const s = e2e.state(); const me = e2e.myHeroes()[0];
        const ai = s.heroes[s.players[1].heroes[0]];
        if (ai.townId) { s.towns[ai.townId].visitingHero = null; ai.townId = null; }
        // a second hero far away keeps us in the game whatever the battle's outcome
        const H = await import('/src/engine/hero.js');
        for (let y = 1; y < s.map.height - 1; y++) { const x = s.map.width - 3 - (y % 3); const p = { x, y, z: 0 }; const tl = s.map.tiles[0][y][x];
          if (tl && !tl.blocked && !tl.obj && !adv.getHeroAt(s, p) && Math.abs(x - me.pos.x) + Math.abs(y - me.pos.y) > 12) { H.addHero(s, 'valeska', e2e.me().id, p); break; } }
        for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const c = { x: me.pos.x + dx, y: me.pos.y + dy, z: me.pos.z }; const tl = s.map.tiles[c.z][c.y]?.[c.x];
          if (!tl || tl.blocked || tl.obj || adv.getHeroAt(s, c)) continue;
          // the AI holds back early campaigns on normal difficulty (attackFromDay): play this one at the hardest level
          s.players[1].aiDifficulty = 4;
          ai.pos = c; ai.army = [{ creatureId: 'angel', count: 5 }, null, null, null, null, null, null]; h3.ctx.notify('debug'); return true; }
        return false; })()`);
      t.check(placed, 'computer hero placed next to our town');
      await t.key('e'); await t.sleep(300);
      if ((await t.dialogs()).length) await t.key('Enter');
      await t.waitFor('e2e.dialogs().some((d) => /under attack/i.test(d)) || h3.screen === "combat"', 60000);
      await t.shot('29-under-attack');
      await t.ackDialogs();
      await t.waitFor('h3.screen === "combat"', 20000);
      const b = await waitCombatTurn(t, 60000);
      t.check(b.active && b.active.side === 'defender' || b.waiting === false, 'we control the defender');
      await t.sleep(800);
      await t.shot('29-defending');
      await finishBattle(t);
      await t.waitFor('(async () => { const s = e2e.state(); const c = await e2e.adv(); return s && s.currentPlayer === 0 && s.turn === 2 && c && !c.busy; })()', 60000);
      await t.ackDialogs();
      t.check(await t.eval('!e2e.state().combat && e2e.state().turn === 2'), 'the turn went on after the battle');
    },
  },
  {
    name: 'services',
    // town services, hero meeting, level-up and object choices through their real dialogs
    async run(t) {
      await t.open();
      await t.eval('e2e.newGame({ size: "S", seed: 5 })');
      await t.sleep(500);
      await t.ackDialogs();
      const town = await t.eval('e2e.me().towns[0]');
      // walk the hero out of town so the tavern can be used
      const out = await t.eval(`(async () => { const adv = await import('/src/engine/adventure/index.js'); const s = e2e.state(); const h = e2e.myHeroes()[0];
        for (const [dx, dy] of [[0, 2], [2, 2], [-2, 2], [2, 0], [-2, 0], [0, 3], [3, 3]]) { const p = { x: h.pos.x + dx, y: h.pos.y + dy, z: h.pos.z }; const r = adv.findPath(s, h.id, p); if (r && r.path && r.path.length && r.turns === 0) return p; } return null; })()`);
      t.check(out, 'a tile next to the town');
      await walkTo(t, out);
      await t.waitFor('(async () => !(await e2e.adv()).busy)()', 30000);
      await t.ackDialogs();
      // town -> tavern -> recruit
      await t.key('t'); await t.sleep(300); await t.key('Enter');
      await t.waitFor('h3.screen === "town"');
      await t.sleep(500);
      await t.key('t');
      await t.waitFor('e2e.dialogs().length > 0');
      await t.sleep(300);
      await t.shot('80-tavern');
      await t.button('Recruit hero');
      await t.sleep(600);
      t.check(await t.eval('e2e.myHeroes().length') === 2, 'hired a second hero');
      await t.ackDialogs();
      // marketplace (built through the engine) -> sell all wood
      await t.eval(`(async () => { const T = await import('/src/engine/town.js'); const r = T.build(e2e.state(), ${JSON.stringify(town)}, 'marketplace'); h3.ctx.notify('debug'); return r.ok; })()`);
      await t.sleep(300);
      await t.key('m');
      await t.waitFor('e2e.dialogs().length > 0');
      await t.sleep(300);
      await t.shot('81-marketplace');
      const wood0 = await t.eval('e2e.me().resources.wood');
      await t.button('Max');
      await t.button('Trade');
      await t.sleep(400);
      t.check(await t.eval('e2e.me().resources.wood') < wood0, 'traded wood');
      await t.key('Escape'); await t.sleep(300);
      // mage guild, fort, thieves' guild windows open and close
      await t.eval(`(async () => { const T = await import('/src/engine/town.js'); T.build(e2e.state(), ${JSON.stringify(town)}, 'mage_guild_1'); h3.ctx.notify('debug'); return 1; })()`).catch(() => {});
      for (const k of ['g', 'f']) { await t.key(k); await t.sleep(500); await t.shot(`82-town-${k}`); while ((await t.dialogs()).length) { await t.key('Escape'); await t.sleep(250); } }
      await t.key('Escape');
      await t.waitFor('h3.screen === "adventure"');
      await t.sleep(300);
      // meet: select the hired hero (in town) and click the first hero twice
      const [a, b] = await t.eval('e2e.myHeroes().map((h) => h.id)');
      await t.eval(`(async () => { (await e2e.adv()).selectHero(${JSON.stringify(b)}); return 1; })()`);
      const pos = await t.eval(`e2e.state().heroes[${JSON.stringify(a)}].pos`);
      await walkTo(t, pos);
      await t.waitFor('e2e.dialogs().length > 0', 20000);
      await t.sleep(400);
      await t.shot('83-hero-exchange');
      await t.checkDialogFit();
      await t.button('Done');
      await t.sleep(400);
      // level-up dialog
      const lvl = await t.eval(`(async () => { const H = await import('/src/engine/hero.js'); H.giveExperience(e2e.state(), ${JSON.stringify(a)}, 5000); h3.ctx.resolvePendings(); return e2e.state().pending.length; })()`);
      await t.sleep(600);
      await t.shot('84-level-up');
      t.log(`level-up pendings: ${lvl}`);
      for (let i = 0; i < 12 && (await t.dialogs()).length; i++) { await t.checkDialogFit(); await t.key('1'); await t.sleep(200); if ((await t.dialogs()).length) { await t.key('Enter'); await t.sleep(300); } }
      t.check(await t.eval(`e2e.state().heroes[${JSON.stringify(a)}].level`) > 2, 'hero levelled up');
      t.check(await t.eval('e2e.state().pending.length') === 0, 'all level-ups resolved');
    },
  },
  {
    name: 'scenarios',
    async run(t) {
      await t.open();
      const list = await t.eval('(async () => (await h3.ctx.engine.load("mapgen")).listScenarios().map((s) => ({ id: s.id, name: s.name })))()');
      t.check(list.length >= 1, 'scenario list');
      t.metrics.scenarios = {};
      for (const [i, sc] of list.entries()) {
        const info = await t.eval(`e2e.newGame({ scenarioId: ${JSON.stringify(sc.id)} })`);
        await t.sleep(700);
        await t.ackDialogs();
        await t.shot(`30-scenario-${i + 1}-${sc.id}`);
        const ms = await endTurn(t, { maxMs: 120000 });
        await t.ackDialogs();
        t.metrics.scenarios[sc.id] = { ...info, endTurnMs: ms };
        t.check(await t.screen() === 'adventure', `${sc.id} still on the adventure map`);
      }
    },
  },
  {
    name: 'saveload',
    async run(t) {
      await t.open();
      await t.eval('localStorage.clear(), 1');
      await t.eval('e2e.newGame({ size: "S", seed: 31337 })');
      await t.sleep(500);
      await t.ackDialogs();
      await endTurn(t);
      await t.ackDialogs();
      const day = await t.eval('e2e.state().turn');
      await t.key('s', { ctrl: true });
      await t.sleep(800);
      const saved = await t.eval('h3.storage.list().map((m) => m.slot)');
      t.check(saved.includes('quicksave'), `quicksave written (${saved})`);
      // main menu -> Load Game -> pick quicksave -> Load
      await t.eval('h3.showScreen("mainMenu"), 1');
      await t.waitFor('h3.screen === "mainMenu"');
      await t.eval('h3.ctx.setState(null, { silent: true }), 1').catch(() => {});
      await t.button('Load Game');
      await t.waitFor('h3.screen === "loadGame"');
      await t.sleep(400);
      await t.shot('40-load-screen');
      await t.clickEl('.k-list-item, .lg-row, .k-scroll-row', 'Quick save').catch(async () => { await t.clickEl('[class*="lg-"]', 'Quick'); });
      await t.sleep(200);
      await t.button('Load');
      await t.waitFor('h3.screen === "adventure"', 20000);
      await t.sleep(600);
      await t.ackDialogs();
      t.check(await t.eval('e2e.state().turn') === day, 'loaded the saved day');
      const exported = await t.eval('h3.storage.exportSlot("quicksave").length');
      t.check(exported > 1000, 'export produces a file body');
      // hotseat: two humans, curtain between turns
      await t.eval('e2e.newGame({ size: "S", seed: 5, players: ["human", "human"] })');
      await t.sleep(500);
      await t.ackDialogs();
      await t.key('e'); await t.sleep(300);
      if ((await t.dialogs()).length) await t.key('Enter');
      await t.waitFor('getComputedStyle(document.querySelector(".adv-curtain")).display !== "none"', 20000);
      await t.shot('41-hotseat-curtain');
      const cur = await t.box('.adv-curtain');
      await t.click(cur.cx, cur.cy);
      await t.sleep(600);
      await t.ackDialogs();
      t.check(await t.eval('e2e.state().currentPlayer') === 1, 'second human to move');
      await t.shot('42-hotseat-blue');
    },
  },
  {
    name: 'longgame',
    // 2 players on a small map, the human only ends turns (and wanders): the AI grows, explores and
    // eventually attacks; battles where the human defends are played with auto-combat.
    async run(t) {
      await t.open();
      await t.eval('e2e.newGame({ size: "S", seed: 2718, players: ["human", "ai"] })');
      await t.sleep(500);
      await t.ackDialogs();
      const days = Number(process.env.E2E_DAYS || 28);
      const log = [];
      for (let d = 0; d < days; d++) {
        let scr = await t.screen();
        // walked into our own town (town screen opens) or similar: back to the map
        for (let i = 0; i < 3 && ['town', 'hero', 'kingdom'].includes(scr); i++) { await t.key('Escape'); await t.sleep(400); scr = await t.screen(); }
        if (scr === 'mainMenu') { log.push(`day ${d}: back at the main menu (game over)`); break; }
        if (scr === 'combat') {
          log.push(`day ${d}: battle`);
          await t.shot(`70-longgame-battle-${d}`);
          await finishBattle(t);
          continue;
        }
        // wander: send the first hero towards a random explored tile (path preview + go)
        const dest = await t.eval(`(async () => { const adv = await import('/src/engine/adventure/index.js'); const s = e2e.state(); const h = e2e.myHeroes()[0]; if (!h) return null;
          for (let i = 0; i < 30; i++) { const p = { x: Math.floor(Math.random() * s.map.width), y: Math.floor(Math.random() * s.map.height), z: h.pos.z };
            const r = adv.findPath(s, h.id, p); if (r && r.path && r.path.length && r.turns === 0) return p; } return null; })()`);
        if (dest) {
          const c = await t.eval('(async () => { const c = await e2e.adv(); return (c && c.selectedHero) || null; })()');
          if (c) { await walkTo(t, dest); await t.waitFor('(async () => h3.screen !== "adventure" || !(await e2e.adv()).busy)()', 30000).catch(() => {}); }
          if (await t.screen() === 'combat') { log.push(`day ${d}: our battle`); await finishBattle(t); }
          await t.ackDialogs();
        }
        for (let i = 0; i < 3 && ['town', 'hero', 'kingdom'].includes(await t.screen()); i++) { await t.key('Escape'); await t.sleep(400); }
        if (await t.screen() !== 'adventure') continue;
        try { await endTurn(t, { maxMs: 120000 }); } catch (err) {
          if (['combat', 'mainMenu'].includes(await t.screen())) continue;
          const d2 = await t.dialogs();
          if (d2.length) { log.push(`day ${d}: dialog ${d2[d2.length - 1].slice(0, 80)}`); await t.ackDialogs(); continue; }
          throw err;
        }
        const seen = await t.ackDialogs();
        for (const x of seen) log.push(`day ${d}: ${x.slice(0, 90)}`);
      }
      const s = await t.eval('e2e.state() && { turn: e2e.state().turn, ai: e2e.state().players[1].heroes.length, aiTowns: e2e.state().players[1].towns.length, me: e2e.state().players[0].towns.length }');
      t.log(JSON.stringify(s));
      for (const l of log) t.log(l);
      await t.shot('71-longgame-end');
    },
  },
  {
    name: 'perf',
    async run(t) {
      await t.open();
      const info = await t.eval('e2e.newGame({ size: "XL", underground: true, seed: 2024, players: ["human", "ai", "ai", "ai"] })', 180000);
      t.log(`XL+U: generate ${info.genMs} ms, createGame ${info.createMs} ms (${info.w}x${info.h}x${info.levels})`);
      await t.sleep(1500);
      await t.ackDialogs();
      await t.shot('50-xl-start');
      // scroll: pan the camera every frame for 3 s
      const scroll = await t.eval(`(async () => { const c = await e2e.adv(); return e2e.frames(3000, (i) => c.mapView.panBy(i % 240 < 120 ? -14 : 14, i % 160 < 80 ? -9 : 9)); })()`);
      t.log(`scroll frames: ${JSON.stringify(scroll)}`);
      // and with real arrow keys
      for (let i = 0; i < 10; i++) await t.key('ArrowRight');
      const mem0 = await t.eval('e2e.mem()');
      const times = [];
      for (let d = 0; d < 3; d++) { times.push(await endTurn(t, { maxMs: 300000 })); await t.ackDialogs(); }
      const mem1 = await t.eval('e2e.mem()');
      t.metrics.perfXL = { ...info, scroll, endTurnMs: times, mem0, mem1 };
      t.log(`end turn (3 AI): ${times.join(', ')} ms; heap ${mem0 && mem0.usedMB} -> ${mem1 && mem1.usedMB} MB`);
      await t.shot('51-xl-day4');
      await t.key('u');
      await t.sleep(600);
      await t.shot('52-xl-underground');
    },
  },
  {
    name: 'resize',
    async run(t) {
      await t.open();
      await t.eval('e2e.newGame({ size: "S", seed: 8 })');
      await t.sleep(600);
      await t.ackDialogs();
      for (const [w, h] of [[1920, 1080], [1024, 768], [800, 600], [600, 900], [2560, 1080]]) {
        await t.page.setViewport(w, h);
        await t.sleep(500);
        const fit = await t.eval(`(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }; })()`);
        t.check(fit.x >= 0 && fit.y >= 0 && fit.x + fit.w <= w + 1 && fit.y + fit.h <= h + 1, `stage fits ${w}x${h}: ${JSON.stringify(fit)}`);
        t.check(fit.sw <= w + 1 && fit.sh <= h + 1, `no page scroll at ${w}x${h}`);
        await t.shot(`60-resize-${w}x${h}`);
      }
      await t.page.setViewport(1280, 720);
      await t.sleep(300);
      // keyboard shortcuts on the adventure map
      for (const [k, expect] of [['k', 'kingdom'], ['Escape', 'adventure']]) { await t.key(k); await t.waitFor(`h3.screen === "${expect}"`); await t.sleep(400); }
      for (const k of ['q', 'a', 'o', 'c', 'p']) {
        await t.key(k); await t.sleep(400);
        const n = (await t.dialogs()).length;
        await t.shot(`61-key-${k}`);
        while ((await t.dialogs()).length) { await t.key('Escape'); await t.sleep(250); }
        t.log(`key ${k}: ${n ? 'dialog' : 'no dialog'}`);
      }
      await t.key('+'); await t.sleep(300); await t.shot('62-zoomed'); await t.key('-');
      await t.key('h'); await t.key('z'); await t.key('z');
    },
  },
  {
    name: 'editor',
    async run(t) {
      // Map editor: new map, paint, roads, a town + hero for each of 2 players, a mine, undo / redo,
      // save to the library, validate, play the map, and find it in New Game's custom maps.
      const ED = "(await import('/src/ui/screens/editor/index.js')).getController()";
      const edTile = (x, y) => t.eval(`(async () => { const c = ${ED}; c.view.centerOnTile(${x}, ${y}); c.view.render(true);
        const p = c.view.tileToScreen(${x}, ${y}); const r = c.view.canvas.getBoundingClientRect(); const s = r.width / 810;
        return { x: r.x + (p.x + c.view.ts / 2) * s, y: r.y + (p.y + c.view.ts / 2) * s }; })()`);
      const tileAtClient = (x, y) => t.eval(`(async () => { const c = ${ED}; const p = c.view.tileToScreen(${x}, ${y}); const r = c.view.canvas.getBoundingClientRect(); const s = r.width / 810;
        return { x: r.x + (p.x + c.view.ts / 2) * s, y: r.y + (p.y + c.view.ts / 2) * s }; })()`);
      const clickTile = async (x, y) => { const p = await edTile(x, y); await t.click(p.x, p.y); await t.sleep(120); };
      const dragTiles = async (a, b) => {
        await edTile(Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)); // centre the stroke (both ends visible)
        const p = await tileAtClient(a[0], a[1]);
        const q = await tileAtClient(b[0], b[1]);
        await t.page.mouse('mouseMoved', p.x, p.y, 'none');
        await t.page.mouse('mousePressed', p.x, p.y, 'left');
        for (let i = 1; i <= 8; i++) await t.page.mouse('mouseMoved', p.x + ((q.x - p.x) * i) / 8, p.y + ((q.y - p.y) * i) / 8, 'none');
        await t.page.mouse('mouseReleased', q.x, q.y, 'left');
        await t.sleep(150);
      };
      // pick an option by its label in the n-th <select> matching `sel`
      const setSelect = (sel, n, label) => t.eval(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})][${n}]; const i = [...e.options].findIndex((o) => o.textContent === ${JSON.stringify(label)});
        if (i < 0) throw new Error('no option ' + ${JSON.stringify(label)}); e.selectedIndex = i; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; })()`);
      const docInfo = (expr) => t.eval(`(async () => { const c = ${ED}; const bp = c.doc.bp; return ${expr}; })()`);

      await t.open();
      await t.eval('localStorage.removeItem("h3o.data.maps"); localStorage.removeItem("h3o.data.map.e2e_duel"); true');
      await t.button('Map Editor');
      await t.waitFor('h3.screen === "editor" && document.querySelector(".ed-root canvas")');
      await t.sleep(600);
      // New small map
      await t.button('New');
      await t.waitFor('e2e.dialogs().length > 0');
      await setSelect('.k-dlg select', 0, 'S (36 x 36)');
      await t.button('Create');
      await t.sleep(400);
      t.check(await docInfo('bp.map.width') === 36, 'new 36x36 map');
      await t.key('-'); // 32 px tiles: 25 tiles across
      // terrain: sand stroke
      await t.key('2');
      await t.clickEl('.ed-swatch[data-terrain="sand"]');
      await dragTiles([4, 18], [16, 18]);
      t.check(await docInfo('bp.map.tiles[0][18][10].t') === 'sand', 'sand painted along the drag');
      const undoSteps = await docInfo('c.doc.undo.length');
      // road between the two gates
      await t.key('4');
      await dragTiles([8, 10], [28, 10]);
      await dragTiles([28, 10], [28, 20]);
      t.check(await docInfo('bp.map.tiles[0][10][20].road') === 3, 'road drawn');
      // towns + heroes for two players
      await t.key('8');
      await clickTile(8, 9);
      await setSelect('.ed-options select', 0, 'Inferno');
      await setSelect('.ed-options select', 1, 'Blue');
      await clickTile(28, 26);
      await t.key('9');
      await clickTile(8, 9);
      await setSelect('.ed-options select', 0, 'Blue');
      await clickTile(28, 26);
      t.check(await docInfo('bp.towns.length') === 2 && await docInfo('bp.heroes.length') === 2, 'two towns and two heroes');
      t.check(await docInfo('bp.towns[1].ownerSlot') === 1 && await docInfo('bp.heroes[1].ownerSlot') === 1, 'second town and hero belong to Blue');
      // an object from the browser: search "gold mine"
      await t.key('6');
      await t.clickEl('.ed-search');
      await t.page.type('gold mine');
      await t.sleep(300);
      await t.clickEl('.ed-browser .k-list-row', 'Gold Mine');
      await clickTile(18, 24);
      const mines = () => docInfo("Object.values(bp.map.objects).filter((o) => o.defId === 'gold_mine').length");
      t.check(await mines() === 1, 'gold mine placed');
      await t.shot('80-editor-built');
      await t.key('z', { ctrl: true });
      t.check(await mines() === 0, 'undo removed the mine');
      await t.key('y', { ctrl: true });
      t.check(await mines() === 1, 'redo put it back');
      t.check(await docInfo('c.doc.undo.length') > undoSteps, 'one step per stroke');
      // a timed event through the Events dialog
      await t.button('Events');
      await t.waitFor('e2e.dialogs().length > 0');
      await t.button('Add');
      await t.waitFor('document.querySelector(".k-dlg textarea")');
      await t.clickEl('.k-dlg textarea');
      await t.page.type('Tribute from the villages.');
      await t.shot('80b-editor-timed-event');
      await t.button('OK');
      await t.sleep(300);
      await t.button('Close');
      t.check(await docInfo('bp.events.length') === 1, 'timed event added');
      // select + inspector
      await t.eval('document.activeElement && document.activeElement.blur && document.activeElement.blur(), true');
      await t.key('1');
      await clickTile(18, 24);
      t.check(/Gold Mine/.test(await t.eval('document.querySelector(".ed-inspector").textContent')), 'inspector shows the mine');
      // save into the library
      await t.key('s', { ctrl: true });
      await t.waitFor('document.querySelector(".k-prompt input")');
      await t.clickEl('.k-prompt input');
      await t.key('a', { ctrl: true });
      await t.page.type('E2E Duel');
      await t.key('Enter');
      await t.sleep(500);
      t.check(await t.eval('JSON.parse(localStorage.getItem("h3o.data.maps") || "[]").some((m) => m.id === "e2e_duel")'), 'map saved to the library');
      // validate
      await t.button('Validate');
      await t.waitFor('e2e.dialogs().length > 0');
      const vtext = (await t.dialogs()).pop();
      t.log(`validate: ${vtext.slice(0, 120)}`);
      t.check(/valid and playable|playable, with warnings/.test(vtext), 'map validates');
      await t.shot('81-editor-validate');
      await t.key('Escape');
      await t.sleep(300);
      // play it (right after a toast: toasts never take clicks)
      t.check(await t.eval('[...document.querySelectorAll(".k-toast")].every((x) => getComputedStyle(x).pointerEvents === "none")'), 'toasts do not block clicks');
      await t.button('Play');
      await t.waitFor('e2e.dialogs().length > 0');
      await t.shot('82-editor-play-dialog');
      await t.button('Start');
      await t.waitFor('h3.screen === "adventure" && document.querySelector(".adv-root canvas")', 30000);
      await t.sleep(800);
      await t.ackDialogs();
      const st = await t.eval('({ name: e2e.state().meta.name, players: e2e.state().players.length, towns: Object.keys(e2e.state().towns).length })');
      t.check(st.name === 'E2E Duel' && st.players === 2 && st.towns === 2, `game from the editor map: ${JSON.stringify(st)}`);
      await t.shot('83-editor-playing');
      await endTurn(t);
      await t.ackDialogs();
      // the saved map is offered by New Game
      await t.eval('h3.ctx.showScreen("newGame")');
      await t.waitFor('h3.screen === "newGame" && document.querySelector(".ng-prow")');
      await t.button('Custom maps');
      await t.sleep(300);
      t.check(/E2E Duel/.test(await t.eval('document.querySelector(".ng-scenarios").textContent')), 'custom map listed in New Game');
      await t.shot('84-newgame-custom');
      // with a game in memory the main menu has 9 entries: two columns
      await t.eval('h3.ctx.showScreen("mainMenu")');
      await t.waitFor('h3.screen === "mainMenu" && document.querySelector(".mm-menu")');
      t.check(await t.eval('document.querySelector(".mm-menu").classList.contains("is-two-col")'), 'two-column main menu');
      await t.shot('85-main-menu-two-columns');
    },
  },
  {
    name: 'campaign',
    // Campaigns from the main menu: start "The Saltwind Charter", pick a bonus on the briefing, reach the
    // adventure map with the campaign hero, then force a victory and land on the next briefing.
    async run(t) {
      await t.open();
      await t.eval('localStorage.removeItem("h3o.data.campaign.saltwind_charter"), 1');
      await t.button('Campaigns');
      await t.waitFor('h3.screen === "campaigns" && document.querySelector(".cmp-card")', 15000);
      await t.sleep(400);
      await t.shot('90-campaigns');
      t.check(await t.eval('document.querySelectorAll(".cmp-card").length') >= 3, 'campaign cards');
      await t.clickEl('.cmp-card[data-campaign="saltwind_charter"] .k-btn', 'Start');
      await t.waitFor('document.querySelector(".k-choice")', 10000);
      await t.sleep(300);
      await t.clickEl('.k-choice', 'Normal');
      await t.waitFor('h3.screen === "campaignBriefing" && document.querySelector(".cmp-bonus")', 20000);
      await t.sleep(500);
      t.check(await t.eval(CANVAS_INK('.cmp-map canvas')) > 30, 'map preview rendered');
      await t.clickEl('.cmp-bonus', 'Necklace');
      await t.sleep(200);
      await t.shot('91-campaign-briefing');
      await t.button('Begin');
      await t.waitFor('h3.screen === "adventure" && document.querySelector(".adv-root canvas")', 30000);
      await t.sleep(800);
      await t.ackDialogs();
      await t.shot('92-campaign-adventure');
      const info = await t.eval(`(() => { const s = e2e.state(); const h = Object.values(s.heroes).find((x) => x.defId === 'leena');
        return { scenario: s.meta.campaign && s.meta.campaign.scenarioId, hero: !!h && h.owner === 0, necklace: !!h && JSON.stringify(h.artifacts).includes('necklace_of_ocean_guidance') }; })()`);
      t.metrics.campaign = info;
      t.check(info.scenario === 'wreckers_shore', 'campaign scenario on the adventure map');
      t.check(info.hero && info.necklace, 'campaign hero with the chosen bonus');
      // force the victory (capture Gullhaven) and let the adventure screen route back to the campaign
      await t.eval(`(async () => { const town = await import('/src/engine/town.js'); const g = await import('/src/engine/game.js');
        const s = e2e.state(); town.captureTown(s, s.settings.victory.townId, 0); g.checkVictory(s); h3.showScreen('adventure'); return 1; })()`);
      await t.waitFor('e2e.dialogs().length > 0', 15000);
      await t.shot('93-campaign-victory');
      for (let i = 0; i < 6 && !(await t.eval('h3.screen === "campaignBriefing" && !!document.querySelector(".cmp-bonus")')); i++) {
        if ((await t.dialogs()).length) await t.key('Enter');
        await t.sleep(500);
      }
      await t.waitFor('h3.screen === "campaignBriefing" && document.querySelector(".cmp-bonus")', 15000);
      t.check(/Pearl Tithe/.test(await t.eval('document.querySelector(".cmp-brief").textContent')), 'next briefing: The Pearl Tithe');
      t.check(/level/.test(await t.eval('document.querySelector(".cmp-hero").textContent')), 'carried hero shown');
      await t.shot('94-campaign-next-briefing');
      // carry-over chooser between scenarios
      await t.button('Choose items');
      await t.waitFor('document.querySelector(".cmp-pick")', 10000);
      await t.sleep(300);
      await t.shot('95-campaign-carry-choice');
      await t.button('OK');
      await t.waitFor('e2e.dialogs().length === 0 && document.querySelector(".cmp-bonus")', 10000);
    },
  },
];
