// Adventure map screen. params: { newGame?, heroId?, townId? }
// Spec: docs/mechanics/ui-adventure.md. Engines: adventure (map/movement/fog/spells), game (turns),
// hero (combat finish), bonuses, town (thieves' guild). Pure helpers in model.js.
import * as adv from '../../../engine/adventure/index.js';
import * as game from '../../../engine/game.js';
import * as heroEngine from '../../../engine/hero.js';
import * as bonuses from '../../../engine/bonuses.js';
import { getThievesGuildLevel } from '../../../engine/town.js';
import { getDailyIncome } from '../../../engine/economy.js';
import { SPELL_BY_ID } from '../../../data/spells.js';
import { createMapView } from './mapView.js';
import { createPanel } from './panel.js';
import { registerAdventurePendings, ADVENTURE_PENDING_RENDERERS } from './pendings.js';
import { registerPendingRenderer } from '../../kit/pending.js';
import {
  currentPlayer, playerOf, playerName, heroOnTile, townOfObject, hoverText, describeTile, clickDestination,
  heroesWithMovement, nextHeroId, humanCount, weekMessage, eventMessage, minimapPixels, playerHeroes,
  playerTowns, questLog,
} from './model.js';
import {
  infoNode, showWorldView, spellMarkers, showPuzzle, pickAdventureSpell, systemMenu, adventureMenu,
  showQuestLog, showThievesGuild, showCombatResult, showGameOver,
} from './dialogs.js';

registerAdventurePendings();

export const MAP_W = 1040;
export const MAP_H = 684;
const STEP_MS = 110;
const EDGE = 14;

let instance = null;
let aiRequested = false;
/** Which player the hotseat curtain was last shown for, per state object. */
const curtainShown = new WeakMap();

/** Test / debug access to the live controller. */
export function getController() { return instance; }

export async function mount(root, ctx, params = {}) {
  instance = createController(root, ctx, params || {});
  await instance.start();
}

export function unmount() {
  if (instance) instance.destroy();
  instance = null;
}

function injectCss() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.head.querySelector && document.head.querySelector('link[data-adv-css]')) return;
  try {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./adventure.css', import.meta.url).href;
    link.setAttribute('data-adv-css', '1');
    document.head.appendChild(link);
  } catch { /* no CSS in exotic environments */ }
}

async function ensureAi(ctx) {
  if (aiRequested) return;
  aiRequested = true;
  const mod = await ctx.engine.load('ai');
  if (mod && typeof mod.installAi === 'function') {
    try { mod.installAi(); } catch (err) { ctx.log(`AI could not be installed: ${err.message}`, 'warn'); }
  } else {
    ctx.log('No AI module: computer players will pass their turns.', 'warn');
  }
}
let companionsLoaded = null;
/**
 * Pending renderers owned by other screens register on import: hero/levelUp.js (`level_up`) and
 * dialogs/heroTrade.js (`hero_exchange`). Load them lazily (missing modules are fine), then put our
 * own `hero_exchange` renderer back (it delegates to the same openHeroTrade, with a fallback).
 */
function loadCompanions() {
  companionsLoaded ||= Promise.all([
    import('../hero/levelUp.js').catch(() => null),
    import('../dialogs/heroTrade.js').catch(() => null),
  ]).then(() => { registerPendingRenderer('hero_exchange', ADVENTURE_PENDING_RENDERERS.hero_exchange); });
  return companionsLoaded;
}

/** Tests: allow `ensureAi` to run again. */
export function resetAiRequest() { aiRequested = false; }

function createController(root, ctx, params) {
  const { ui } = ctx;
  const { h } = ui;
  const st = () => ctx.state;
  const offs = [];
  let destroyed = false;
  let busy = false;
  let selHero = null;
  let selTown = null;
  const destinations = new Map();
  let lastViewer = null;
  let pick = null;
  let mouse = null;
  let drag = null;
  let minimapDirty = true;
  let minimapLevel = -1;
  let minimapSrc = null;
  let camKey = '';
  const pendingMessages = [];

  const viewerId = () => {
    const s = st();
    const p = s && currentPlayer(s);
    if (p && p.isHuman) lastViewer = p.id;
    return lastViewer;
  };

  // ---- DOM -------------------------------------------------------------------------------------
  injectCss();
  const mapView = createMapView(ctx, { width: MAP_W, height: MAP_H, getState: st, getViewer: viewerId });
  mapView.showGrid = !!ctx.settings.get('showGrid');
  const statusLine = h('div.adv-status');
  const pickHint = h('div.adv-pick-hint', { style: { display: 'none' } });
  const curtain = h('div.adv-curtain', { style: { display: 'none' } });
  const aiOverlay = h('div.adv-ai-overlay', { style: { display: 'none' } }, h('div.adv-ai-box', null, 'Computer players are moving…'));
  const resbar = ui.ResourceBar({});
  const panel = createPanel(ctx, {
    onSelectHero: (id) => selectHero(id, { center: true }),
    onOpenHero: (id) => ctx.showScreen('hero', { heroId: id }),
    onSelectTown: (id) => selectTown(id, { center: true }),
    onOpenTown: (id) => ctx.showScreen('town', { townId: id }),
    onButton: (id) => button(id),
    drawMinimap: drawMinimap,
    heroStats: (hero) => {
      const s = st();
      return { maxMana: bonuses.getMaxMana(s, hero), primary: bonuses.getPrimary(s, hero) };
    },
    onNavigate: (fx, fy) => {
      const s = st();
      if (!s) return;
      mapView.centerOnTile(Math.floor(fx * s.map.width), Math.floor(fy * s.map.height));
    },
  });
  const mapWrap = h('div.adv-mapwrap', null, mapView.canvas, statusLine, pickHint);
  const el = h('div.adv-root', null, mapWrap, h('div.adv-bottom', null, resbar), panel.el, aiOverlay, curtain);
  root.appendChild(el);

  // ---- helpers ---------------------------------------------------------------------------------
  function drawMinimap(g, w, hgt) {
    const s = st();
    if (!s) return;
    const z = mapView.level;
    if (minimapDirty || minimapLevel !== z || !minimapSrc) {
      minimapSrc = document.createElement('canvas');
      minimapSrc.width = s.map.width;
      minimapSrc.height = s.map.height;
      try {
        const sg = minimapSrc.getContext('2d');
        const img = sg.createImageData(s.map.width, s.map.height);
        const px = minimapPixels(s, viewerId(), z);
        if (img.data && img.data.set) img.data.set(px);
        sg.putImageData(img, 0, 0);
      } catch { /* fake canvas */ }
      minimapDirty = false;
      minimapLevel = z;
    }
    if (g.imageSmoothingEnabled !== undefined) g.imageSmoothingEnabled = false;
    g.drawImage(minimapSrc, 0, 0, w, hgt);
  }

  function hasUnderground() { const s = st(); return !!(s && s.map.levels > 1); }

  function heroSpells(hero) {
    const s = st();
    try { return heroEngine.getHeroSpells(s, hero).filter((id) => SPELL_BY_ID[id] && SPELL_BY_ID[id].kind === 'adventure'); } catch { return []; }
  }

  function refresh() {
    const s = st();
    if (!s || destroyed) return;
    const pid = viewerId();
    if (selHero && (!s.heroes[selHero] || s.heroes[selHero].owner !== pid || s.heroes[selHero].garrisoned)) selHero = null;
    if (selTown && (!s.towns[selTown] || s.towns[selTown].owner !== pid)) selTown = null;
    mapView.invalidateObjects();
    mapView.setSelection(selHero, selTown);
    minimapDirty = true;
    panel.minimap.redraw();
    const hero = selHero ? s.heroes[selHero] : null;
    panel.update(s, { playerId: pid, heroId: selHero, townId: selTown, hasUnderground: hasUnderground(), hasSpells: !!(hero && heroSpells(hero).length), level: mapView.level });
    const p = playerOf(s, pid);
    let income;
    try { income = pid != null ? getDailyIncome(s, pid) : undefined; } catch { income = undefined; }
    resbar.update({ resources: p ? p.resources : {}, date: s.date, income });
  }

  function setStatus(text) { statusLine.textContent = text || ''; }

  function centerOnHero(hero) {
    if (!hero) return;
    mapView.centerOnTile(hero.pos.x, hero.pos.y, hero.pos.z || 0);
  }

  function selectHero(id, { center = false } = {}) {
    const s = st();
    const hero = s && s.heroes[id];
    if (!hero) return;
    selHero = id;
    selTown = null;
    if (center) centerOnHero(hero);
    else if ((hero.pos.z || 0) !== mapView.level) { mapView.setLevel(hero.pos.z || 0); panel.setLevel(mapView.level, hasUnderground()); }
    const dest = destinations.get(id);
    if (dest) previewPath(dest); else mapView.setPath(null);
    refresh();
  }

  function selectTown(id, { center = false } = {}) {
    const s = st();
    const town = s && s.towns[id];
    if (!town) return;
    selTown = id;
    selHero = null;
    mapView.setPath(null);
    if (center) mapView.centerOnTile(town.pos.x, town.pos.y, town.pos.z || 0);
    refresh();
  }

  function selectDefault() {
    const s = st();
    const pid = viewerId();
    if (pid == null) return;
    if (params.heroId && s.heroes[params.heroId] && s.heroes[params.heroId].owner === pid && !s.heroes[params.heroId].garrisoned) {
      selectHero(params.heroId, { center: true });
      return;
    }
    if (params.townId && s.towns[params.townId] && s.towns[params.townId].owner === pid) {
      selectTown(params.townId, { center: true });
      return;
    }
    const next = nextHeroId(s, pid, null) || (playerHeroes(s, pid).find((x) => !x.garrisoned) || {}).id;
    if (next) { selectHero(next, { center: true }); return; }
    const town = playerTowns(s, pid)[0];
    if (town) selectTown(town.id, { center: true });
  }

  function previewPath(dest) {
    const s = st();
    if (!selHero || !s.heroes[selHero]) return null;
    let path = null;
    try { path = adv.findPath(s, selHero, dest); } catch { path = null; }
    if (!path || !path.steps || !path.steps.length) {
      destinations.delete(selHero);
      mapView.setPath(null);
      return null;
    }
    destinations.set(selHero, { x: dest.x, y: dest.y, z: dest.z || 0 });
    mapView.setPath(path, selHero);
    return path;
  }

  // ---- movement ----------------------------------------------------------------------------------
  async function animateHero(heroId, events) {
    for (const e of events) {
      if (destroyed) return;
      if (!['move', 'board', 'land'].includes(e.type) || e.heroId !== heroId || !e.from || !e.to) continue;
      const dx = e.to.x - e.from.x;
      if (dx) mapView.setFacing(heroId, dx > 0 ? 1 : -1);
      if ((e.to.z || 0) !== mapView.level) { mapView.setLevel(e.to.z || 0); panel.setLevel(mapView.level, hasUnderground()); }
      if (e.teleport || Math.max(Math.abs(dx), Math.abs(e.to.y - e.from.y)) > 1) {
        mapView.setHeroAnim({ heroId, x: e.to.x, y: e.to.y });
        mapView.centerOnTile(e.to.x, e.to.y);
        continue;
      }
      if (!mapView.isTileVisible(e.to.x, e.to.y) || !mapView.isTileVisible(e.to.x + 3, e.to.y + 3) || !mapView.isTileVisible(e.to.x - 3, e.to.y - 3)) mapView.centerOnTile(e.to.x, e.to.y);
      await ctx.anim.tween({
        from: 0, to: 1, duration: STEP_MS,
        onUpdate: (t) => mapView.setHeroAnim({ heroId, x: e.from.x + (e.to.x - e.from.x) * t, y: e.from.y + (e.to.y - e.from.y) * t }),
      });
    }
    mapView.setHeroAnim(null);
  }

  /** Move the selected hero towards its stored destination. */
  async function moveSelected() {
    const s = st();
    if (busy || !selHero || !s.heroes[selHero]) return null;
    const heroId = selHero;
    const dest = destinations.get(heroId);
    if (!dest) return null;
    if ((s.heroes[heroId].movePoints || 0) <= 0) { ctx.toast('This hero has no movement points left today.', 'warn'); return null; }
    busy = true;
    let res;
    try {
      res = ctx.act((state) => adv.moveHero(state, heroId, dest));
      if (!res || res.ok === false) return res;
      await animateHero(heroId, res.events || []);
      if (destroyed) return res;
      if (res.arrived || !st().heroes[heroId]) { destinations.delete(heroId); mapView.setPath(null); }
      else if (selHero === heroId) previewPath(dest);
      refresh();
    } finally {
      busy = false;
    }
    await afterAction(res.events || []);
    return res;
  }

  // ---- after an action: messages, combat, pendings, game over, town entry ----------------------
  async function reportEvents(events, { modal = true } = {}) {
    const s = st();
    const pid = viewerId();
    for (const e of events) {
      if (destroyed) return;
      if (e.type === 'thieves_guild' && e.table && modal) { await showThievesGuild(ctx, s, e.table).result; continue; }
      if (e.type === 'spell_cast' && (e.spellId === 'view_air' || e.spellId === 'view_earth') && e.success !== false && modal) {
        await showWorldView(ctx, s, pid, mapView.level, { title: e.spellId === 'view_air' ? 'View Air' : 'View Earth', markers: spellMarkers(e) }).result;
        continue;
      }
      if (e.type === 'spell_cast' && e.spellId === 'visions' && e.range && modal) { ctx.toast(`Visions: you can see armies within ${e.range} tiles.`, 'good'); continue; }
      const m = eventMessage(s, e, pid);
      if (!m) continue;
      ctx.log(m.text, m.kind === 'warn' ? 'warn' : m.kind === 'good' ? 'good' : 'info');
      if (m.modal && modal) await ui.message(m.text);
      else ctx.toast(m.text, m.kind, 2500);
    }
  }

  async function handleCombat({ ask = false } = {}) {
    const s = st();
    if (!s || !s.combat) return 'none';
    let quick = !!ctx.settings.get('quickCombat');
    // a computer attacked us: the defender always chooses (retreat / surrender are inside the battle)
    const attacker = s.heroes[s.combat.attackerHeroId];
    const defending = !!attacker && s.players[attacker.owner] && s.players[attacker.owner].isHuman === false;
    if ((ask && !quick) || defending) {
      const v = await ui.choose({
        title: defending ? 'You are under attack' : 'Battle',
        text: defending ? attackText(s) : 'A battle is waiting to be fought.', cancellable: false,
        icon: defending ? { kind: 'portrait', id: attacker.defId } : undefined,
        options: [{ label: 'Fight the battle', value: 'fight' }, { label: 'Quick combat', value: 'quick' }],
      });
      quick = v === 'quick';
    }
    if (!quick) {
      ctx.showScreen('combat', { returnTo: 'adventure' });
      return 'left';
    }
    return quickResolve();
  }

  async function quickResolve() {
    const s = st();
    const combat = await ctx.engine.load('combat');
    await heroEngine.engineReady;
    if (!s.combat) return 'none';
    const cs = s.combat.cs;
    const res = ctx.act((state) => {
      if (combat && typeof combat.autoResolve === 'function' && !(combat.isOver && combat.isOver(cs))) combat.autoResolve(cs);
      return heroEngine.finishCombat(state);
    });
    if (!res || res.ok === false) {
      // the combat engine refused: drop the battle so the game can go on
      if (st().combat && !(combat && combat.isOver && combat.isOver(cs))) ctx.log('Quick combat could not resolve the battle.', 'error');
      return 'failed';
    }
    refresh();
    await showCombatResult(ctx, st(), viewerId(), res);
    await reportEvents(res.events || []);
    return 'done';
  }

  async function afterAction(events = []) {
    if (destroyed) return;
    await reportEvents(events);
    const s = st();
    const pid = viewerId();
    const enter = events.find((e) => e.type === 'town_enter' && s.towns[e.townId] && s.towns[e.townId].owner === pid && s.heroes[e.heroId]);
    for (let guard = 0; guard < 60 && !destroyed; guard++) {
      if (st().combat) {
        const r = await handleCombat();
        if (r === 'left' || r === 'failed') return;
        continue;
      }
      const n = await ctx.resolvePendings();
      if (destroyed) return;
      refresh();
      if (pendingMessages.length) { const msgs = pendingMessages.splice(0); await reportEvents(msgs); }
      if (!n && !st().combat) break;
    }
    if (destroyed) return;
    if (st().gameOver) { await gameOverFlow(); return; }
    if (enter && st().heroes[enter.heroId] && st().heroes[enter.heroId].townId === enter.townId) ctx.showScreen('town', { townId: enter.townId });
  }

  async function gameOverFlow() {
    const s = st();
    const over = s.gameOver || {};
    const winner = over.winner != null ? playerOf(s, over.winner) : null;
    const viewer = winner && winner.isHuman ? winner.id : viewerId();
    let breakdown = null;
    try { breakdown = game.getScoreBreakdown(s, viewer != null ? viewer : 0); } catch { breakdown = null; }
    await showGameOver(ctx, s, viewer, breakdown);
    // campaign games continue on the campaign's briefing screen (docs/mechanics/campaigns.md)
    const campaign = s.meta && s.meta.campaign;
    if (!destroyed) ctx.showScreen(campaign ? 'campaignBriefing' : 'mainMenu', campaign ? { campaignId: campaign.campaignId, after: true } : undefined);
  }

  // ---- turn flow ---------------------------------------------------------------------------------
  function showCurtain(player) {
    return new Promise((resolve) => {
      ui.clear(curtain, h('div.adv-curtain-box', null,
        h('div.adv-curtain-title', { style: { color: `var(--pc-${player.color})` } }, `${playerName(st(), player.id)} player's turn`),
        h('div.adv-small', null, player.name && player.name !== `${playerName(st(), player.id)} player` ? player.name : ''),
        ui.Button('Begin turn', { kind: 'primary', size: 'lg', onClick: () => { curtain.style.display = 'none'; resolve(); } })));
      curtain.style.display = '';
    });
  }

  /** Start of a human turn: curtain (hotseat), messages, autosave, selection, pendings. */
  async function beginTurn(events = []) {
    const s = st();
    const p = currentPlayer(s);
    if (!p || !p.isHuman || destroyed) return;
    if (humanCount(s) > 1 && curtainShown.get(s) !== p.id) await showCurtain(p);
    curtainShown.set(s, p.id);
    if (destroyed) return;
    lastViewer = p.id;
    selHero = null;
    selTown = null;
    mapView.setPath(null);
    minimapDirty = true;
    selectDefault();
    refresh();
    const week = [...events].reverse().find((e) => e.type === 'week_started' || e.type === 'month_started');
    if (week) {
      const text = weekMessage(week.weekOf, week.type === 'month_started');
      if (text) await ui.message(text, { title: week.type === 'month_started' ? 'A new month' : 'A new week' });
    }
    // day-1 timed events fire inside createGame: show them (once) when the concerned human's first turn starts
    const day1 = s.turn === 1 ? (s.log || []).filter((l) => l.type === 'timed_event' && l.turn === 1 && l.playerId === p.id && !l.shown) : [];
    for (const l of day1) l.shown = true;
    await reportEvents([...day1, ...events.filter((e) => e.type === 'town_loss_warning' || e.type === 'player_eliminated' || e.type === 'timed_event')]);
    if (destroyed) return;
    await ctx.autosave();
    await afterAction([]);
  }

  function yieldFrame() { return new Promise((r) => setTimeout(r, 0)); }

  async function endTurn({ force = false } = {}) {
    const s = st();
    if (busy || !s || destroyed) return null;
    const p = currentPlayer(s);
    if (!p) return null;
    if (p.isHuman && (s.pending || []).some((x) => x.playerId === p.id)) { await ctx.resolvePendings(); if ((st().pending || []).some((x) => x.playerId === p.id)) return null; }
    if (!force && ctx.settings.get('confirmEndTurn') !== false && heroesWithMovement(s, p.id, 50).length) {
      const yes = await ui.confirm('One or more heroes can still move. End your turn anyway?', { title: 'End turn' });
      if (!yes) return null;
    }
    busy = true;
    let res;
    const ai = s.players.some((x) => x.alive !== false && !x.isHuman);
    try {
      if (ai) { aiOverlay.style.display = ''; await yieldFrame(); }
      res = ctx.act((state) => game.endTurn(state), { reason: 'endTurn' });
    } finally {
      aiOverlay.style.display = 'none';
      busy = false;
    }
    if (!res || res.ok === false || destroyed) return res;
    refresh();
    if (st().gameOver) { await gameOverFlow(); return res; }
    // a computer player attacked one of our heroes / towns: the battle waits for us (game.endTurn
    // stopped inside the computer's turn); after it, endTurn carries on with the other players
    if (st().combat) {
      await announceAttack(st());
      const r = await handleCombat();
      if (r === 'left' || destroyed) return res;      // combat screen; on return start() resumes the turn
      if (st().gameOver) { await gameOverFlow(); return res; }
      return endTurn({ force: true });
    }
    await beginTurn(res.events || []);
    return res;
  }

  function attackText(s) {
    const c = s.combat;
    const attacker = c && s.heroes[c.attackerHeroId];
    if (!attacker) return 'A battle is waiting to be fought.';
    const town = c.townId != null ? s.towns[c.townId] : null;
    const defender = c.defenderHeroId != null ? s.heroes[c.defenderHeroId] : null;
    const target = town ? `your town ${town.name}` : defender ? `your hero ${defender.name}` : 'you';
    return `${attacker.name} (${playerName(s, attacker.owner)}) attacks ${target}!`;
  }

  /** Show where the computer attacks (the defender's choice follows in handleCombat). */
  async function announceAttack(s) {
    const c = s.combat;
    if (!c || !s.heroes[c.attackerHeroId]) return;
    const town = c.townId != null ? s.towns[c.townId] : null;
    const defender = c.defenderHeroId != null ? s.heroes[c.defenderHeroId] : null;
    if (town || defender) {
      const at = town ? town.pos : defender.pos;
      mapView.centerOnTile(at.x, at.y, at.z);
    }
    ctx.audio.play('sword');
  }

  // ---- spells, digging, puzzle ---------------------------------------------------------------------
  function pickTarget(text, valid) {
    return new Promise((resolve) => {
      pick = { valid, resolve: (t) => { pick = null; mapView.setPick(null); pickHint.style.display = 'none'; resolve(t); } };
      mapView.setPick(pick);
      pickHint.textContent = `${text} (right click or Esc to cancel)`;
      pickHint.style.display = '';
    });
  }

  async function castSpell(spellId = null) {
    const s = st();
    const hero = selHero && s.heroes[selHero];
    if (!hero || busy) return null;
    const spells = heroSpells(hero);
    if (!spells.length) { ctx.toast('This hero knows no adventure spells.', 'warn'); return null; }
    let id = spellId;
    if (!id) {
      let mastery = {};
      try { mastery = bonuses.getSchoolMastery(s, hero); } catch { mastery = {}; }
      id = await pickAdventureSpell(ctx, {
        spells, mana: hero.mana, mastery,
        costOf: (sp) => { try { return adv.getAdventureSpellCost(s, hero, sp); } catch { return sp.cost || 0; } },
        canCast: () => true,
      });
    }
    if (!id) return null;
    let target = null;
    if (id === 'dimension_door') {
      const t = await pickTarget('Choose where to teleport', (p) => { const tile = st().map.tiles[p.z][p.y] && st().map.tiles[p.z][p.y][p.x]; return !!tile && !tile.blocked && !tile.obj && !heroOnTile(st(), p.x, p.y, p.z); });
      if (!t) return null;
      target = { x: t.x, y: t.y };
    } else if (id === 'scuttle_boat') {
      const t = await pickTarget('Choose a boat to sink', (p) => !!adv.getBoatAt(st(), p));
      if (!t) return null;
      target = { x: t.x, y: t.y };
    }
    const res = ctx.act((state) => adv.castAdventureSpell(state, hero.id, id, target));
    if (!res || res.ok === false) return res;
    destinations.delete(hero.id);
    mapView.setPath(null);
    await animateHero(hero.id, res.events || []);
    refresh();
    await afterAction(res.events || []);
    return res;
  }

  async function dig() {
    const s = st();
    if (!selHero || !s.heroes[selHero]) { ctx.toast('Select a hero first.', 'warn'); return null; }
    const res = ctx.act((state) => adv.digForGrail(state, selHero));
    if (!res || res.ok === false) return res;
    refresh();
    await afterAction(res.events || []);
    return res;
  }

  function puzzle() {
    const s = st();
    const progress = adv.getPuzzleProgress(s, viewerId());
    return showPuzzle(ctx, s, viewerId(), progress, progress.grailPos);
  }

  // ---- buttons -----------------------------------------------------------------------------------
  async function button(id) {
    if (busy && id !== 'system') return;
    const s = st();
    switch (id) {
      case 'kingdom': ctx.showScreen('kingdom'); break;
      case 'level': if (hasUnderground()) { mapView.setLevel(1 - mapView.level); minimapDirty = true; panel.minimap.redraw(); panel.setLevel(mapView.level, true); } break;
      case 'quests': showQuestLog(ctx, questLog(s, viewerId()), (pos) => mapView.centerOnTile(pos.x, pos.y, pos.z || 0)); break;
      case 'sleep':
        if (selHero) {
          const hid = selHero;
          ctx.act((state) => heroEngine.setHeroAsleep(state, hid, !(state.heroes[hid] && state.heroes[hid].asleep)), { reason: 'sleep' });
        }
        break;
      case 'move': await moveSelected(); break;
      case 'spell': await castSpell(); break;
      case 'adventure': {
        const v = await adventureMenu({ canDig: !!selHero });
        if (v === 'dig') await dig();
        else if (v === 'puzzle') await puzzle().result;
        else if (v === 'world') await showWorldView(ctx, s, viewerId(), mapView.level).result;
        else if (v === 'kingdom') ctx.showScreen('kingdom');
        break;
      }
      case 'system': {
        const v = await systemMenu();
        if (v === 'save') ctx.showScreen('loadGame', { mode: 'save' });
        else if (v === 'load') ctx.showScreen('loadGame', { mode: 'load' });
        else if (v === 'quicksave') { const r = await ctx.save('quicksave', `Quick save — day ${s.turn}`); ctx.toast(r && r.ok ? 'Game saved.' : 'Saving failed.', r && r.ok ? 'good' : 'error'); }
        else if (v === 'options') ctx.showScreen('options');
        else if (v === 'encyclopedia') ctx.showScreen('encyclopedia');
        else if (v === 'menu' && await ui.confirm('Return to the main menu? Unsaved progress stays in memory until you start another game.')) ctx.showScreen('mainMenu');
        break;
      }
      case 'next': {
        const n = nextHeroId(s, viewerId(), selHero);
        if (n) selectHero(n, { center: true }); else ctx.toast('No hero can move.', 'info');
        break;
      }
      case 'end': await endTurn(); break;
      default: break;
    }
  }

  // ---- map input ---------------------------------------------------------------------------------
  const posOf = (e) => ui.eventPos(mapView.canvas, e, MAP_W, MAP_H);

  async function clickTile(t) {
    const s = st();
    if (!s || destroyed) return;
    if (pick) {
      if (!pick.valid || pick.valid(t)) pick.resolve(t);
      else ctx.toast('Not a valid target.', 'warn');
      return;
    }
    if (busy) return;
    if (t.x < 0 || t.y < 0 || t.x >= s.map.width || t.y >= s.map.height) return;
    const pid = viewerId();
    const hero = heroOnTile(s, t.x, t.y, t.z);
    if (hero && hero.owner === pid) {
      if (hero.id === selHero) { ctx.showScreen('hero', { heroId: hero.id }); return; }
      // as in the original: with a hero selected, clicking another own hero walks over to meet him
      // (hero exchange); 1st click previews the path, 2nd goes. Unreachable -> select that hero.
      if (selHero && s.heroes[selHero] && !hero.garrisoned) {
        const prev = destinations.get(selHero);
        if (prev && prev.x === t.x && prev.y === t.y && prev.z === t.z && mapView.path) { await moveSelected(); return; }
        if (previewPath({ x: t.x, y: t.y, z: t.z })) { setStatus(`Click again to meet ${hero.name} (select him in the hero list).`); return; }
      }
      selectHero(hero.id);
      return;
    }
    const objId = mapView.index.at.get(`${t.x},${t.y},${t.z}`);
    const obj = objId ? s.map.objects[objId] : null;
    const town = townOfObject(s, obj);
    if (town && town.owner === pid) {
      const entrance = obj.pos.x === t.x && obj.pos.y === t.y;
      if (!selHero || !entrance) {
        if (selTown === town.id) ctx.showScreen('town', { townId: town.id });
        else selectTown(town.id);
        return;
      }
    }
    if (!selHero) return;
    const dest = clickDestination(s, mapView.index, t.x, t.y, t.z);
    const prev = destinations.get(selHero);
    if (prev && prev.x === dest.x && prev.y === dest.y && prev.z === dest.z && mapView.path) {
      await moveSelected();
      return;
    }
    if (!previewPath(dest)) setStatus('You cannot go there.');
  }

  function rightInfo(t, e) {
    const s = st();
    if (!s || t.x < 0 || t.y < 0 || t.x >= s.map.width || t.y >= s.map.height) return null;
    const pid = viewerId();
    const target = heroOnTile(s, t.x, t.y, t.z);
    let displayedArmy;
    let primary = null;
    let thievesLevel = 0;
    try { thievesLevel = pid != null ? getThievesGuildLevel(s, pid) : 0; } catch { thievesLevel = 0; }
    if (target) {
      try { displayedArmy = target.owner !== pid ? adv.getDisplayedArmy(s, target.id, pid) : undefined; } catch { displayedArmy = undefined; }
      try { primary = bonuses.getPrimary(s, target); } catch { primary = null; }
    }
    let visions = null;
    try { visions = selHero ? adv.getVisionsInfo(s, selHero) : null; } catch { visions = null; }
    const model = describeTile(s, pid, t.x, t.y, t.z, { index: mapView.index, heroId: selHero, thievesLevel, displayedArmy, visions, primary });
    if (!model) return null;
    const node = infoNode(model);
    ui.showInfoPopup(node, (e && e.clientX) || 0, (e && e.clientY) || 0);
    const up = () => { ui.hideInfoPopup(); window.removeEventListener('mouseup', up); };
    window.addEventListener('mouseup', up);
    return model;
  }

  const canvas = mapView.canvas;
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); offs.push(() => target.removeEventListener(type, fn, o)); };
  listen(canvas, 'mousemove', (e) => {
    const p = posOf(e);
    mouse = p;
    const t = mapView.tileAt(p.x, p.y);
    mapView.setHover(t);
    const s = st();
    if (s && !pick) setStatus(hoverText(s, viewerId(), t.x, t.y, t.z, mapView.index, selHero));
  });
  listen(canvas, 'mouseleave', () => { mouse = null; mapView.setHover(null); setStatus(''); });
  listen(canvas, 'mousedown', (e) => {
    if (e.button === 1) { const p = posOf(e); drag = { x: p.x, y: p.y }; if (e.preventDefault) e.preventDefault(); return; }
    if (e.button === 2) {
      if (e.preventDefault) e.preventDefault();
      if (pick) { pick.resolve(null); return; }
      const p = posOf(e);
      rightInfo(mapView.tileAt(p.x, p.y), e);
    }
  });
  listen(canvas, 'contextmenu', (e) => { if (e.preventDefault) e.preventDefault(); });
  listen(canvas, 'click', (e) => {
    if (e.button != null && e.button !== 0) return;
    const p = posOf(e);
    clickTile(mapView.tileAt(p.x, p.y));
  });
  listen(canvas, 'wheel', (e) => { if (e.preventDefault) e.preventDefault(); mapView.zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  if (typeof window !== 'undefined') {
    listen(window, 'mousemove', (e) => {
      if (!drag) return;
      const p = posOf(e);
      mapView.panBy(p.x - drag.x, p.y - drag.y);
      drag.x = p.x;
      drag.y = p.y;
    });
    listen(window, 'mouseup', (e) => { if (e.button === 1 || drag) drag = null; });
  }

  // ---- keys --------------------------------------------------------------------------------------
  const pan = (dx, dy) => () => mapView.panBy(-dx * mapView.ts, -dy * mapView.ts);
  ctx.keys.bind('arrowleft', pan(-1, 0), 'Scroll left');
  ctx.keys.bind('arrowright', pan(1, 0), 'Scroll right');
  ctx.keys.bind('arrowup', pan(0, -1), 'Scroll up');
  ctx.keys.bind('arrowdown', pan(0, 1), 'Scroll down');
  ctx.keys.bind('e', () => button('end'), 'End turn');
  ctx.keys.bind('h', () => button('next'), 'Next hero');
  ctx.keys.bind('space', () => button('move'), 'Move hero');
  ctx.keys.bind('u', () => button('level'), 'Surface / underground');
  ctx.keys.bind('k', () => button('kingdom'), 'Kingdom overview');
  ctx.keys.bind('c', () => button('spell'), 'Cast spell');
  ctx.keys.bind('q', () => button('quests'), 'Quest log');
  ctx.keys.bind('z', () => button('sleep'), 'Sleep / wake');
  ctx.keys.bind('a', () => button('adventure'), 'Adventure options');
  ctx.keys.bind('o', () => button('system'), 'System options');
  ctx.keys.bind('d', () => dig(), 'Dig');
  ctx.keys.bind('p', () => puzzle(), 'Puzzle map');
  ctx.keys.bind('t', () => {
    const s = st();
    const towns = playerTowns(s, viewerId());
    if (!towns.length) return;
    const i = towns.findIndex((t) => t.id === selTown);
    selectTown(towns[(i + 1) % towns.length].id, { center: true });
  }, 'Next town');
  ctx.keys.bind('enter', () => { if (selTown) ctx.showScreen('town', { townId: selTown }); else if (selHero) ctx.showScreen('hero', { heroId: selHero }); }, 'Open selection');
  ctx.keys.bind(['+', '='], () => mapView.zoom(1), 'Zoom in');
  ctx.keys.bind('-', () => mapView.zoom(-1), 'Zoom out');
  ctx.keys.bind('ctrl+s', async () => { const r = await ctx.save('quicksave', `Quick save — day ${st().turn}`); ctx.toast(r && r.ok ? 'Game saved.' : 'Saving failed.', r && r.ok ? 'good' : 'error'); }, 'Quick save');
  ctx.keys.bind('escape', () => { if (pick) pick.resolve(null); else button('system'); }, 'System options / cancel');

  // ---- state + render loop ---------------------------------------------------------------------
  offs.push(ctx.onState((s, reason, payload) => {
    if (reason === 'set') { mapView.invalidateTerrain(); destinations.clear(); }
    if (reason === 'pending' && payload && Array.isArray(payload.events)) pendingMessages.push(...payload.events);
    refresh();
  }));
  offs.push(ctx.settings.subscribe((key, v) => { if (key === 'showGrid') { mapView.showGrid = !!v; mapView.markDirty(); } }));
  offs.push(mapView.subscribeSprites());

  function frame(dt) {
    if (destroyed) return false;
    if (mouse && !drag && ctx.settings.get('edgeScroll') && !busy && ui.dialogCount() === 0) {
      const sp = (dt || 16) * 0.6;
      let dx = 0;
      let dy = 0;
      if (mouse.x < EDGE) dx = sp; else if (mouse.x > MAP_W - EDGE) dx = -sp;
      if (mouse.y < EDGE) dy = sp; else if (mouse.y > MAP_H - EDGE) dy = -sp;
      if (dx || dy) mapView.panBy(dx, dy);
    }
    if (mapView.dirty) {
      mapView.render();
      const vf = mapView.viewportFraction();
      const key = `${vf.x.toFixed(4)},${vf.y.toFixed(4)},${vf.w.toFixed(4)},${mapView.level}`;
      if (key !== camKey) { camKey = key; panel.minimap.setViewport(vf); }
    }
    return true;
  }

  const api = {
    el, mapView, panel, destinations,
    get selectedHero() { return selHero; },
    get selectedTown() { return selTown; },
    get busy() { return busy; },
    get picking() { return !!pick; },
    selectHero, selectTown, previewPath, moveSelected, clickTile, rightInfo, endTurn, beginTurn, castSpell, dig, puzzle, button,
    afterAction, handleCombat, refresh, frame, statusLine, curtain, aiOverlay, pickHint, viewerId,
    async start() {
      const s = st();
      if (!s || !s.map) {
        el.appendChild(h('div.adv-empty', null, 'No game in progress.'));
        ctx.keys.bind('escape', () => ctx.showScreen('mainMenu'));
        return;
      }
      await Promise.all([ensureAi(ctx), loadCompanions()]);
      if (destroyed) return;
      viewerId();
      selectDefault();
      refresh();
      mapView.render(true);
      panel.minimap.setViewport(mapView.viewportFraction());
      ctx.anim.loop(frame);
      const p = currentPlayer(s);
      if (s.gameOver) { gameOverFlow(); return; }
      if (s.combat) { api.ready = (async () => { const r = await handleCombat({ ask: true }); if (r !== 'left') await afterAction([]); })(); return; }
      // the computer moves first (e.g. player 1 is an AI): endTurn plays its pending turn, then hands over
      if (p && !p.isHuman && p.alive !== false && !s.settings?.manualAi) { api.ready = endTurn({ force: true }); return; }
      if (p && p.isHuman && (params.newGame || (humanCount(s) > 1 && curtainShown.get(s) !== p.id))) api.ready = beginTurn([]);
      else api.ready = afterAction([]);
    },
    destroy() {
      destroyed = true;
      if (pick) pick.resolve(null);
      for (const off of offs.splice(0)) { try { off(); } catch { /* ignore */ } }
      panel.destroy();
      ui.hideInfoPopup();
    },
  };
  return api;
}
