// Kingdom overview. params: { playerId? } (default: the player to move)
// All heroes (stats, army, location - click to open / go), all towns (income, growth, built today,
// garrison - click to open), flagged mines and dwellings, daily income breakdown by source.
import { getKingdomOverview } from '../../../engine/game.js';
import { getGarrisonArmy } from '../../../engine/town.js';
import { getPrimary } from '../../../engine/bonuses.js';
import { RESOURCES } from '../../../core/constants.js';
import { MAP_OBJECT_BY_ID } from '../../../data/mapObjects.js';
import { HERO_CLASS_BY_ID } from '../../../data/heroClasses.js';
import { act, ensureCss, townThumb } from '../town/dialogUtil.js';
import { currentPlayer, factionName, creatureName } from '../town/townModel.js';
import { HALL_LEVELS, FORT_LEVELS, buildingName } from '../town/townModel.js';

let cleanup = [];
export let current = null;

/** Flagged map objects of a player by category: `{mines: {defId: n}, dwellings: {defId: n}, mineCount, dwellingCount}` (pure). */
export function flaggedObjects(state, playerId) {
  const mines = {};
  const dwellings = {};
  for (const obj of Object.values(state.map?.objects || {})) {
    if (obj.owner !== playerId) continue;
    const def = MAP_OBJECT_BY_ID[obj.defId];
    if (!def) continue;
    if (def.category === 'mine') mines[obj.defId] = (mines[obj.defId] || 0) + 1;
    else if (def.category === 'dwelling') dwellings[obj.defId] = (dwellings[obj.defId] || 0) + 1;
  }
  const sum = (o) => Object.values(o).reduce((n, v) => n + v, 0);
  return { mines, dwellings, mineCount: sum(mines), dwellingCount: sum(dwellings) };
}

/** Where a hero is, as text (pure). */
export function heroLocation(state, h) {
  if (h.townId && state.towns[h.townId]) return `${h.garrisoned ? 'Garrison of' : 'In'} ${state.towns[h.townId].name}`;
  return `(${h.pos.x}, ${h.pos.y}${h.pos.z ? ', underground' : ''})`;
}

export function mount(root, ctx, params = {}) {
  const { ui } = ctx;
  const { h } = ui;
  ensureCss(ui, new URL('./kingdom.css', import.meta.url).href);
  const player = ctx.state && (params.playerId != null ? ctx.state.players[params.playerId] : currentPlayer(ctx.state));
  if (!player) {
    root.appendChild(h('div.kng-missing', null, ui.Panel({ title: 'Kingdom', variant: 'parchment' },
      h('p', null, 'No game in progress.'), ui.Button('Back', { kind: 'primary', onClick: () => ctx.back() }))));
    ctx.keys.bind('escape', () => ctx.back(), 'Back');
    return;
  }
  const playerId = player.id;
  const header = h('div.kng-header');
  const body = h('div.kng-body');
  const resBar = ui.ResourceBar({});
  let ov = getKingdomOverview(ctx.state, playerId);
  let tab = params.tab || 'heroes';
  const tabs = ui.Tabs({
    active: tab,
    onChange: (id) => { tab = id; },
    tabs: [
      { id: 'heroes', label: 'Heroes', content: () => heroesTab() },
      { id: 'towns', label: 'Towns', content: () => townsTab() },
      { id: 'income', label: 'Income & holdings', content: () => incomeTab() },
    ],
  });
  root.appendChild(h('div.kng', { dataset: { player: playerId } },
    header, h('div.kng-main', null, tabs),
    h('div.kng-bottom', null, resBar, ui.Button('Close', { kind: 'primary', hotkey: 'Esc', onClick: () => ctx.back('adventure') }))));

  function heroesTab() {
    if (!ov.heroes.length) return h('p.kng-empty', null, 'You have no heroes.');
    // few heroes: roomier cards (bigger portrait / army, skills row) and a kingdom summary below
    const roomy = ov.heroes.length <= 4;
    return h('div.kng-tab', null, h('div.kng-list', { class: roomy && 'is-roomy' }, ov.heroes.map((hr) => {
      const live = ctx.state.heroes[hr.id];
      const prim = live ? getPrimary(ctx.state, live) : hr.primary;
      const row = h('div.kng-row.kng-hero', { dataset: { hero: hr.id } },
        ui.HeroPortrait({ defId: hr.defId, size: roomy ? 84 : 58, playerColor: ov.color, onClick: () => ctx.showScreen('hero', { heroId: hr.id }) }),
        h('div.kng-hero-info', null,
          h('div.kng-name', null, hr.name),
          h('div.kng-sub', null, `Level ${hr.level} ${HERO_CLASS_BY_ID[hr.classId]?.name || ''}`),
          h('div.kng-sub', null, heroLocation(ctx.state, hr)),
          h('div.kng-sub', null, `Mana ${hr.mana} - Move ${hr.movePoints}/${hr.maxMovePoints}`),
          roomy && live && live.skills && live.skills.length ? h('div.kng-skills', null, live.skills.map((sk) => ui.SkillIcon({ id: sk.id, level: sk.level, size: 26 }))) : null),
        ui.PrimaryStats(prim, { base: hr.primary, iconSize: roomy ? 24 : 20 }),
        ui.ArmyRow({ id: `kng-${hr.id}`, army: hr.army, readonly: true, size: roomy ? 52 : 44 }),
        h('div.kng-row-btns', null,
          ui.Button('Open', { size: 'sm', onClick: () => ctx.showScreen('hero', { heroId: hr.id }) }),
          ui.Button('Go to', { size: 'sm', onClick: () => ctx.showScreen('adventure', { heroId: hr.id, focus: hr.pos }) })));
      return row;
    })), roomy ? summary() : null);
  }

  /** Kingdom at a glance (fills the page when there are only a few rows). */
  function summary() {
    const cell = (label, value) => h('div.kng-sum-cell', null, h('div.kng-sum-value', null, value), h('div.kng-sub', null, label));
    return h('div.kng-summary', null,
      cell('Heroes', String(ov.heroes.length)),
      cell('Towns', String(ov.towns.length)),
      cell('Daily income', ui.CostView(ov.income || {}, null, { freeText: 'none' })),
      cell('Army strength', ui.fmt(ov.armyStrength || 0)),
      cell('Marketplaces', String(ov.marketplaces || 0)),
      cell("Thieves' guild level", String(ov.thievesGuildLevel || 0)));
  }

  function townsTab() {
    if (!ov.towns.length) {
      return h('p.kng-empty', null, ov.daysLeftWithoutTown != null ? `You have no towns! ${ov.daysLeftWithoutTown} days left to capture one.` : 'You have no towns.');
    }
    const roomy = ov.towns.length <= 3;
    return h('div.kng-tab', null, h('div.kng-list', { class: roomy && 'is-roomy' }, ov.towns.map((t) => {
      const town = ctx.state.towns[t.id];
      const growth = Object.entries(t.growth).filter(([, n]) => n > 0);
      const row = h('div.kng-row.kng-town', { dataset: { town: t.id } },
        h('div.kng-town-icon', null, townThumb(ctx, t.faction, roomy ? 84 : 52)),
        h('div.kng-town-info', null,
          h('div.kng-name', null, t.name),
          h('div.kng-sub', null, `${factionName(t.faction)} - ${t.hallLevel ? buildingName(HALL_LEVELS[t.hallLevel - 1]) : 'no hall'} - ${t.fortLevel ? buildingName(FORT_LEVELS[t.fortLevel - 1]) : 'no fort'}`),
          h('div.kng-sub', null, t.builtThisTurn ? 'Built today' : `${t.canBuild.length} buildings can be built`),
          h('div.kng-sub', null, `Mage guild ${t.mageGuildLevel || '-'}${t.hasGrail ? ' - Grail' : ''}`)),
        h('div.kng-growth', null, growth.length ? growth.map(([cid, n]) => {
          const g = h('div.kng-growth-cell', { dataset: { creature: cid } }, ctx.sprite('creature', cid, { size: 32 }),
            h('span', null, `${t.stock[cid] || 0} (+${n})`));
          ui.attachTooltip(g, `${creatureName(cid)}: ${t.stock[cid] || 0} available, +${n} per week`);
          return g;
        }) : h('span.kng-sub', null, 'No dwellings')),
        ui.ArmyRow({ id: `kng-${t.id}`, army: town ? getGarrisonArmy(ctx.state, town) : [], readonly: true, size: roomy ? 48 : 40 }),
        h('div.kng-row-btns', null, ui.Button('Open', { size: 'sm', onClick: () => ctx.showScreen('town', { townId: t.id }) })));
      return row;
    })), roomy ? summary() : null);
  }

  function incomeTab() {
    const flags = flaggedObjects(ctx.state, playerId);
    const src = ov.incomeBySource;
    const line = (label, res) => h('tr', null, h('td', null, label), RESOURCES.map((r) => h('td', { dataset: { resource: r } }, String(res[r] || 0))));
    return h('div.kng-income', null,
      h('table.kng-table', null,
        h('tr', null, h('th', null, 'Daily income'), RESOURCES.map((r) => h('th', null, ctx.sprite('resource', r, { size: 22 })))),
        line('Towns', src.towns), line('Mines', src.mines), line('Heroes', src.heroes),
        h('tr.kng-total', null, h('td', null, 'Total'), RESOURCES.map((r) => h('td', null, String(ov.income[r] || 0))))),
      h('div.kng-holdings', null,
        h('div', null, h('b', null, `Mines: ${flags.mineCount}`),
          h('ul', null, Object.entries(flags.mines).map(([id, n]) => h('li', null, `${MAP_OBJECT_BY_ID[id]?.name || id}: ${n}`)))),
        h('div', null, h('b', null, `Creature dwellings: ${flags.dwellingCount}`),
          h('ul', null, Object.entries(flags.dwellings).map(([id, n]) => h('li', null, `${MAP_OBJECT_BY_ID[id]?.name || id}: ${n}`)))),
        h('div', null, h('b', null, 'Kingdom'),
          h('ul', null,
            h('li', null, `Army strength: ${ui.fmt(ov.armyStrength)}`),
            h('li', null, `Marketplaces: ${ov.marketplaces}`),
            h('li', null, `Thieves' guild level: ${ov.thievesGuildLevel}`),
            ov.score ? h('li', null, `Score: ${ov.score.score} (${ov.score.title})`) : null))));
  }

  function render() {
    if (!ctx.state || !ctx.state.players[playerId]) return;
    ov = getKingdomOverview(ctx.state, playerId);
    const flags = flaggedObjects(ctx.state, playerId);
    ui.clear(header,
      h('span.kng-flag', { style: { background: `var(--pc-${ov.color})` } }),
      h('div.kng-title', null, `Kingdom of ${ov.name}`),
      h('div.kng-sub', null, `${ov.heroes.length} heroes - ${ov.towns.length} towns - ${flags.mineCount} mines - ${flags.dwellingCount} dwellings - ${ov.weekOf?.name || ''}`));
    resBar.update({ resources: ov.resources, date: ov.date, income: ov.income });
    tabs.refresh();
  }

  cleanup.push(ctx.onState(() => render()));
  ctx.keys.bind(['escape', 'enter'], () => ctx.back('adventure'), 'Close');
  ctx.keys.bind('1', () => tabs.select('heroes'), 'Heroes');
  ctx.keys.bind('2', () => tabs.select('towns'), 'Towns');
  ctx.keys.bind('3', () => tabs.select('income'), 'Income');
  render();
  current = { playerId, tabs, render, overview: () => ov, act: (fn) => act(ctx, fn) };
}

export function unmount() {
  for (const f of cleanup.splice(0)) { try { f(); } catch { /* ignore */ } }
  current = null;
}
