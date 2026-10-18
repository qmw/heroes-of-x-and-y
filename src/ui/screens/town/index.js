// Town screen. params: { townId }
// Composed town view (built buildings, hover highlight + name, click opens the building's window,
// right-click info), town header / income / creature growth panel, garrison + visiting rows
// (drag / swap / split, hero portraits, swap heroes), action buttons and the resource bar.
// Every action goes through ctx.act(engine call); the screen re-renders from state on ctx.onState.
import * as townEngine from '../../../engine/town.js';
import { getTownIncome, getDailyIncome } from '../../../engine/economy.js';
import { getBuilding, getBuildingEffects, isBuilt } from '../../../data/buildings.js';
import { planScenery, paintScenery, paintAmbience, hashString, SCENE_W, SCENE_H } from './scenery.js';
import { absoluteWeek } from '../../../engine/calendar.js';
import '../hero/levelUp.js';
import '../dialogs/heroTrade.js';
import {
  layoutTown, buildingAction, buildingName, buildingEffectLines, currentPlayer, canControlTown,
  factionName, fortName, hallName, growthRows, tierRows, playerTownIds, cycle, TOWN_VIEW_W, TOWN_VIEW_H,
} from './townModel.js';
import { act, ensureDialogCss, townThumb } from './dialogUtil.js';
import { openHall, buildingInfo } from './hall.js';
import {
  openShipyard, openSkeletonTransformer, openCastleGate, openBuildingInfo, openStackInfo,
} from './special.js';
import { openRecruit, openFort } from '../dialogs/recruit.js';
import { openMarketplace } from '../dialogs/marketplace.js';
import { openTavern } from '../dialogs/tavern.js';
import { openThievesGuild } from '../dialogs/thievesGuild.js';
import { openMageGuild } from '../dialogs/mageGuild.js';
import { openBlacksmith } from '../dialogs/blacksmith.js';
import { openArtifactMerchant } from '../dialogs/artifactMerchant.js';
import { openUniversity } from '../dialogs/university.js';
import { openAltar } from '../dialogs/altar.js';
import { openFreelancers } from '../dialogs/trade.js';

let cleanup = [];
/** Exposed for tests / debugging: the live screen API of the last mount. */
export let current = null;

/** Scale of the 800x374 town view inside the 1280x720 stage. */
const VIEW_SCALE = 1.25;

export function mount(root, ctx, params = {}) {
  const { ui } = ctx;
  const { h } = ui;
  ensureDialogCss(ui);
  const state0 = ctx.state;
  const townId = params.townId || (state0 && currentPlayer(state0) && playerTownIds(state0, currentPlayer(state0).id)[0]);
  if (!state0 || !townId || !state0.towns[townId]) {
    root.appendChild(h('div.town-missing', null, ui.Panel({ title: 'Town', variant: 'parchment' },
      h('p', null, ctx.state ? 'There is no such town.' : 'No game in progress.'),
      ui.Button('Back', { kind: 'primary', onClick: () => ctx.back() }))));
    ctx.keys.bind('escape', () => ctx.back(), 'Back');
    return;
  }
  const town = () => ctx.state.towns[townId];
  const gfxModule = ctx.gfx && ctx.gfx.module;
  const getTownLayout = gfxModule && typeof gfxModule.getTownLayout === 'function' ? gfxModule.getTownLayout : null;

  // ---- skeleton --------------------------------------------------------------------------------
  const view = h('div.town-view', { style: { width: TOWN_VIEW_W, height: TOWN_VIEW_H, transform: `scale(${VIEW_SCALE})` } });
  const viewWrap = h('div.town-view-wrap', null, view);
  const sideHead = h('div.town-side-head');
  const growthList = h('div.town-growth');
  const side = h('div.town-side', null, sideHead, h('div.town-growth-title', null, 'Creature growth'), growthList);

  const armySel = ui.createArmySelection();
  const garrisonPortrait = h('div.town-portrait-slot.town-portrait-garrison');
  const visitingPortrait = h('div.town-portrait-slot.town-portrait-visiting');
  const onMove = (from, to, count, fromRow, toRow) => {
    if (!canControlTown(ctx.state, town())) return null;
    return act(ctx, (s) => townEngine.townArmyMove(s, townId, { where: fromRow, slot: from }, { where: toRow, slot: to }, count));
  };
  const garrisonRow = ui.ArmyRow({ id: 'garrison', army: [], selection: armySel, onMove, onInfo: (slot) => openStackInfo(ctx, townId, 'garrison', slot) });
  const visitingRow = ui.ArmyRow({ id: 'visiting', army: [], selection: armySel, onMove, onInfo: (slot) => openStackInfo(ctx, townId, 'visiting', slot) });
  const swapBtn = ui.Button('Swap', { size: 'sm', tooltip: 'Swap the visiting and the garrison hero (S)', onClick: () => swapHeroes() });
  const armies = h('div.town-armies', null,
    h('div.town-army-line', null, garrisonPortrait, h('div.town-army-label', null, 'Garrison'), garrisonRow),
    h('div.town-army-swap', null, swapBtn),
    h('div.town-army-line', null, visitingPortrait, h('div.town-army-label', null, 'Visiting'), visitingRow));

  const btn = {};
  const mk = (key, label, hotkey, onClick, tooltip) => {
    btn[key] = ui.Button(label, { hotkey, onClick, tooltip: tooltip || label, class: `town-btn-${key}` });
    return btn[key];
  };
  const actions = h('div.town-actions', null,
    mk('hall', 'Build', 'B', () => openHall(ctx, townId), 'Town hall: construct buildings (B)'),
    mk('fort', 'Fort', 'F', () => openFort(ctx, townId), 'Recruit creatures of every dwelling (F)'),
    mk('market', 'Marketplace', 'M', () => openMarketplace(ctx, { townId }), 'Trade resources (M)'),
    mk('tavern', 'Tavern', 'T', () => openTavern(ctx, townId), 'Hire heroes (T)'),
    mk('guild', 'Mage Guild', 'G', () => openMageGuild(ctx, townId), 'Spells of the mage guild (G)'),
    mk('thieves', "Thieves' Guild", null, () => openThievesGuild(ctx, town().owner ?? undefined)),
    mk('hero', 'Hero', 'H', () => openHeroScreen(), 'Open the hero in town (H)'),
    mk('prev', '< Town', null, () => switchTown(-1), 'Previous town (Left)'),
    mk('next', 'Town >', null, () => switchTown(1), 'Next town (Right)'),
    mk('exit', 'Exit', 'Esc', () => exit(), 'Leave the town (Esc / Enter)'));

  const resBar = ui.ResourceBar({});
  const bottom = h('div.town-bottom', null, armies, actions);
  const el = h('div.town', { dataset: { town: townId } }, viewWrap, side, bottom, h('div.town-resbar', null, resBar));
  root.appendChild(el);

  // ---- rendering -------------------------------------------------------------------------------
  let viewKey = '';
  function renderView(force = false) {
    const t = town();
    const key = `${t.faction}|${t.buildings.join(',')}|${canControlTown(ctx.state, t)}`;
    if (!force && key === viewKey) return;
    viewKey = key;
    view.style.setProperty('--town-color', `var(--faction-${t.faction}, #3a5a2a)`);
    const backdrop = h('div.town-backdrop', { class: `town-bg-${t.faction}` }, h('div.town-sky'), h('div.town-hills'), h('div.town-ground'));
    if (ctx.gfx && ctx.gfx.available) {
      const bg = ctx.sprite('town', t.faction, { size: TOWN_VIEW_H });
      bg.classList.add('town-backdrop-img');
      bg.style.width = `${TOWN_VIEW_W}px`;
      bg.style.height = `${TOWN_VIEW_H}px`;
      backdrop.appendChild(bg);
    }
    ui.clear(view, backdrop);
    const placed = layoutTown(t, getTownLayout);
    mountScenery(t, placed);
    mountSites(t);
    for (const b of placed) {
      const pic = ctx.sprite('building', b.id, { size: Math.max(16, Math.round(b.h)), variant: t.faction });
      pic.classList.add('town-bld-img');
      const el = h('div.town-bld', {
        dataset: { building: b.id },
        style: { left: b.x, top: b.y, width: b.w, height: b.h, zIndex: 10 + (b.z || 0) },
      }, pic, h('div.town-bld-name', null, buildingName(b.id)));
      ui.attachTooltip(el, () => [buildingName(b.id), ...buildingEffectLines(b.id, t.faction)].join('\n'), { delay: 120 });
      ui.attachInfo(el, () => buildingInfo(ctx, b.id, t.faction));
      el.addEventListener('mouseenter', () => el.classList.add('is-hover'));
      el.addEventListener('mouseleave', () => el.classList.remove('is-hover'));
      el.addEventListener('click', () => { ctx.audio.play('click'); openBuilding(b.id); });
      view.appendChild(el);
    }
  }

  // ---- ambient scenery (paths, props, banners, smoke, motes) ------------------------------------
  let ambience = null;
  function mountScenery(t, placed) {
    if (ambience) { ambience.stop(); ambience = null; }
    let plan;
    try { plan = planScenery(t.faction, placed, hashString(String(t.id) + t.faction)); } catch { return; }
    const still = ui.createCanvas(SCENE_W, SCENE_H, { class: 'town-scenery' });
    const live = ui.createCanvas(SCENE_W, SCENE_H, { class: 'town-scenery town-ambience' });
    if (!still.ctx || !live.ctx || typeof still.ctx.beginPath !== 'function') return;
    try { paintScenery(still.ctx, plan); } catch { return; }
    view.appendChild(still.canvas);
    view.appendChild(live.canvas);
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let last = -1;
    const draw = () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      if (now - last < 66) return;            // ~15 fps is plenty for ambience
      last = now;
      live.clear();
      try { paintAmbience(live.ctx, plan, now / 1000); } catch { /* never break the screen */ }
    };
    draw();
    ambience = ctx.anim && ctx.anim.loop ? ctx.anim.loop(() => { draw(); }) : null;
  }

  // ---- un-built building sites: faint outlines on hover, click opens the hall ---------------------
  function mountSites(t) {
    if (!getTownLayout) return;
    let layout = null;
    try { layout = getTownLayout(t.faction); } catch { layout = null; }
    if (!layout) return;
    const control = canControlTown(ctx.state, t);
    for (const [id, rect] of Object.entries(layout)) {
      let b = null;
      try { b = getBuilding(id); } catch { b = null; }
      if (!b || b.replaces || isBuilt(t.buildings, id)) continue;
      if (b.faction && b.faction !== 'common' && b.faction !== t.faction) continue;
      const site = h('div.town-site', {
        dataset: { site: id },
        style: { left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: 5 },
      }, h('div.town-site-name', null, `${buildingName(id)} - not built${control ? ' (click: Town Hall)' : ''}`));
      if (control) site.addEventListener('click', () => openHall(ctx, townId));
      view.appendChild(site);
    }
  }

  function renderSide() {
    const t = town();
    const income = getTownIncome(t);
    const owner = t.owner != null ? ctx.state.players[t.owner] : null;
    ui.clear(sideHead,
      h('div.town-name-row', null, townThumb(ctx, t.faction, 48),
        h('div', null, h('div.town-name', null, t.name), h('div.town-sub', null, `${factionName(t.faction)}${owner ? ` - ${owner.name}` : ' - neutral'}`))),
      h('div.town-sub', null, `${hallName(t)} - ${fortName(t)}`),
      h('div.town-income', null, 'Income: ', ui.CostView(income, null, { freeText: 'none' }), ' / day'),
      t.builtThisTurn ? h('div.town-sub.town-built-today', null, 'A building was constructed today.') : null);
    const rows = growthRows(townEngine.getRecruitInfo(ctx.state, townId));
    const tiers = tierRows(t, rows);
    ui.clear(growthList, tiers.map((r) => {
      if (!r.built) {
        const row = h('div.town-growth-row.is-unbuilt', { dataset: { creature: r.creatureId, tier: r.tier } },
          h('div.town-growth-pic', null, ctx.sprite('creature', r.creatureId, { size: 38, box: { w: 38, h: 38, ax: 19, ay: 37 }, minBody: 32 })),
          h('div.town-growth-text', null, h('div.town-growth-name', null, r.name),
            h('div.town-growth-num', null, `Tier ${r.tier} - dwelling not built`)));
        ui.attachInfo(row, () => ui.CreatureCard({ creatureId: r.creatureId, compact: true }));
        ui.attachTooltip(row, `${r.name}: build its dwelling to recruit`);
        return row;
      }
      return growthRow(r);
    }).concat(rows.filter((r) => !tiers.some((x) => x.built && x.creatureId === r.creatureId)).map(growthRow)));
  }
  function growthRow(r) {
      const row = h('div.town-growth-row', { dataset: { creature: r.creatureId, tier: r.tier } },
        h('div.town-growth-pic', null, ctx.sprite('creature', r.creatureId, { size: 38, box: { w: 38, h: 38, ax: 19, ay: 37 }, minBody: 32 })),
        h('div.town-growth-text', null, h('div.town-growth-name', null, r.name),
          h('div.town-growth-num', null, r.source === 'portal' ? `Portal: ${r.available}` : `${r.available} available, +${r.growth}/wk`)));
      row.addEventListener('click', () => { if (canControlTown(ctx.state, town())) openRecruit(ctx, townId, r.creatureId); });
      ui.attachInfo(row, () => ui.CreatureCard({ creatureId: r.creatureId, compact: true }));
      ui.attachTooltip(row, `Recruit ${r.name}`);
      return row;
  }

  function portrait(slotEl, heroId, label) {
    const hero = heroId ? ctx.state.heroes[heroId] : null;
    const owner = hero && hero.owner != null ? ctx.state.players[hero.owner] : null;
    ui.clear(slotEl, hero
      ? ui.HeroPortrait({ hero, size: 64, playerColor: owner ? owner.color : undefined, tooltip: `${hero.name} - click to open (${label})`, onClick: () => ctx.showScreen('hero', { heroId: hero.id }) })
      : h('div.town-portrait-empty', { title: label }, label === 'garrison' ? townThumb(ctx, town().faction, 30) : h('span', null, '-')));
  }

  function renderArmies() {
    const t = town();
    const control = canControlTown(ctx.state, t);
    portrait(garrisonPortrait, t.garrisonHero, 'garrison');
    portrait(visitingPortrait, t.visitingHero, 'visiting');
    garrisonRow.classList.toggle('is-readonly', !control);
    visitingRow.classList.toggle('is-readonly', !control || !t.visitingHero);
    garrisonRow.update(townEngine.getGarrisonArmy(ctx.state, t));
    visitingRow.update(t.visitingHero ? ctx.state.heroes[t.visitingHero]?.army || [] : []);
    swapBtn.setDisabled(!control || (!t.visitingHero && !t.garrisonHero));
  }

  function renderButtons() {
    const t = town();
    const control = canControlTown(ctx.state, t);
    const has = (type) => townEngine.townHasEffect(t, type);
    btn.hall.setDisabled(!control);
    btn.fort.setDisabled(!control);
    btn.market.setDisabled(!control || !has('trade_resources'));
    btn.tavern.setDisabled(!control || !has('recruit_heroes'));
    btn.guild.setDisabled(townEngine.getMageGuildLevel(t) < 1);
    btn.thieves.setDisabled(t.owner == null);
    btn.hero.setDisabled(!(t.visitingHero || t.garrisonHero));
    const towns = currentPlayer(ctx.state) ? playerTownIds(ctx.state, currentPlayer(ctx.state).id) : [];
    btn.prev.setDisabled(towns.length < 2 || !towns.includes(townId));
    btn.next.setDisabled(towns.length < 2 || !towns.includes(townId));
  }

  function renderResources() {
    const p = currentPlayer(ctx.state);
    if (!p) return;
    resBar.update({ resources: p.resources, date: ctx.state.date, income: getDailyIncome(ctx.state, p.id) });
  }

  function render() {
    if (!ctx.state || !ctx.state.towns[townId]) return;
    renderView();
    renderSide();
    renderArmies();
    renderButtons();
    renderResources();
  }

  // ---- actions ---------------------------------------------------------------------------------
  function openBuilding(id) {
    const t = town();
    if (!canControlTown(ctx.state, t)) return openBuildingInfo(ctx, townId, id);
    const kind = buildingAction(id, t.faction);
    switch (kind) {
      case 'hall': return openHall(ctx, townId);
      case 'fort': return openFort(ctx, townId);
      case 'dwelling': return openRecruit(ctx, townId, getBuilding(id).dwelling.creatureId);
      case 'horde': {
        const eff = getBuildingEffects(id, t.faction).find((e) => e.type === 'creature_growth');
        const row = townEngine.getRecruitInfo(ctx.state, townId).find((r) => eff && r.tier === eff.tier && r.source === 'dwelling');
        return row ? openRecruit(ctx, townId, row.creatureId) : openBuildingInfo(ctx, townId, id);
      }
      case 'mage_guild': return openMageGuild(ctx, townId);
      case 'tavern': return openTavern(ctx, townId);
      case 'marketplace': return openMarketplace(ctx, { townId });
      case 'blacksmith': return openBlacksmith(ctx, townId);
      case 'shipyard': return openShipyard(ctx, townId);
      case 'artifact_merchant': return openArtifactMerchant(ctx, townId);
      case 'freelancers': return openFreelancers(ctx, townId);
      case 'altar': return openAltar(ctx, townId);
      case 'skeleton_transformer': return openSkeletonTransformer(ctx, townId);
      case 'castle_gate': return openCastleGate(ctx, townId);
      case 'university': return openUniversity(ctx, townId);
      case 'portal':
        if (t.portal) return openRecruit(ctx, townId, t.portal.creatureId);
        return ui.message('No creatures answer the portal this week. Flag external dwellings to summon their creatures.', { title: getBuilding(id).name });
      case 'thieves_guild': return openThievesGuild(ctx, t.owner);
      case 'mana_vortex': {
        const used = t.manaVortexUsedWeek != null && t.manaVortexUsedWeek === absoluteWeek(ctx.state);
        return ui.message(`${buildingInfo(ctx, id, t.faction).textContent} ${used ? 'It has been used this week.' : 'A hero entering the town doubles his spell points (once a week).'}`, { title: getBuilding(id).name });
      }
      default: return openBuildingInfo(ctx, townId, id);
    }
  }

  function swapHeroes() {
    if (act(ctx, (s) => townEngine.swapTownHeroes(s, townId)).ok) ctx.audio.play('move');
  }

  function openHeroScreen() {
    const t = town();
    const id = t.visitingHero || t.garrisonHero;
    if (id) ctx.showScreen('hero', { heroId: id });
  }

  function switchTown(dir) {
    const p = currentPlayer(ctx.state);
    if (!p) return;
    const next = cycle(playerTownIds(ctx.state, p.id), townId, dir);
    if (next && next !== townId) ctx.showScreen('town', { townId: next }, { replace: true });
  }

  function exit() { ctx.back('adventure'); }

  // ---- wiring ----------------------------------------------------------------------------------
  cleanup.push(ctx.onState(() => render()));
  ctx.keys.bind(['escape', 'enter'], () => exit(), 'Leave town');
  ctx.keys.bind('b', () => btn.hall.click(), 'Town hall');
  ctx.keys.bind('f', () => btn.fort.click(), 'Fort');
  ctx.keys.bind('m', () => btn.market.click(), 'Marketplace');
  ctx.keys.bind('t', () => btn.tavern.click(), 'Tavern');
  ctx.keys.bind('g', () => btn.guild.click(), 'Mage guild');
  ctx.keys.bind('h', () => btn.hero.click(), 'Hero');
  ctx.keys.bind('s', () => swapBtn.click(), 'Swap heroes');
  ctx.keys.bind(['arrowleft', 'pageup'], () => btn.prev.click(), 'Previous town');
  ctx.keys.bind(['arrowright', 'pagedown'], () => btn.next.click(), 'Next town');
  cleanup.push(() => { armySel.clear(); garrisonRow.destroy(); visitingRow.destroy(); });

  render();
  current = { townId, el, view, render, openBuilding, rows: { garrison: garrisonRow, visiting: visitingRow }, buttons: btn, growthList, swapHeroes };
  if (ctx.state.pending && ctx.state.pending.length) ctx.resolvePendings();
}

export function unmount() {
  for (const f of cleanup.splice(0)) { try { f(); } catch { /* ignore */ } }
  current = null;
}
