// Right panel of the adventure screen: minimap (+ surface / underground tabs), selected hero / town
// card, hero roster, town roster and the button grid. Layout: docs/mechanics/ui-adventure.md §4.
import { h, clear, fmt } from '../../kit/dom.js';
import { IconButton } from '../../kit/button.js';
import { Minimap } from '../../kit/minimap.js';
import { HeroPortrait, PrimaryStats } from '../../kit/heroWidgets.js';
import { ArmyRow } from '../../kit/armyRow.js';
import { attachTooltip } from '../../kit/tooltip.js';
import { sprite } from '../../sprites.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { heroDisplayName, heroClassName, factionName, fortState, playerHeroes, playerTowns } from './model.js';

/** Buttons of the panel: [id, glyph, tooltip]. */
export const PANEL_BUTTONS = [
  ['kingdom', '♛', 'Kingdom overview (K)'],
  ['level', '⇅', 'Surface / underground (U)'],
  ['quests', '✎', 'Quest log (Q)'],
  ['sleep', 'z', 'Sleep / wake hero (Z)'],
  ['move', '➜', 'Move hero along its path (Space)'],
  ['spell', '✦', 'Cast adventure spell (C)'],
  ['adventure', '⚑', 'Adventure options (A)'],
  ['system', '☰', 'System options (O)'],
  ['next', '»', 'Next hero (H)'],
  ['end', '⌛', 'End turn (E)'],
];

const pct = (v, max) => `${Math.round(100 * Math.max(0, Math.min(1, (v || 0) / Math.max(1, max || 1))))}%`;

/** Horizontal labelled bar (movement / mana) for the hero card. */
function Bar(kind, value, max, label) {
  return h(`div.adv-hbar.adv-hbar-${kind}`, null,
    h('div.adv-hbar-fill', { style: { width: pct(value, max) } }),
    h('span.adv-hbar-text', null, label));
}

/** Creatures ready to recruit in a town: [{creatureId, count}] (from town.stock). */
export function townStockList(town) {
  return Object.entries((town && town.stock) || {})
    .filter(([id, n]) => n > 0 && CREATURE_BY_ID[id])
    .map(([creatureId, count]) => ({ creatureId, count }))
    .sort((a, b) => (CREATURE_BY_ID[a.creatureId].tier || 0) - (CREATURE_BY_ID[b.creatureId].tier || 0));
}

/**
 * opts: { onSelectHero(id), onOpenHero(id), onSelectTown(id), onOpenTown(id), onButton(id),
 *         drawMinimap(ctx2d, w, h), onNavigate(fx, fy), heroStats?(hero) -> { maxMana, primary } }
 */
export function createPanel(ctx, opts) {
  const minimap = Minimap({ width: 224, height: 224, class: 'adv-minimap', draw: opts.drawMinimap, onNavigate: opts.onNavigate });
  const levelTabs = {
    surface: h('button.adv-level-tab', { dataset: { level: '0' } }, 'Surface'),
    under: h('button.adv-level-tab', { dataset: { level: '1' } }, 'Underground'),
  };
  let level = 0;
  for (const [i, b] of [levelTabs.surface, levelTabs.under].entries()) {
    b.addEventListener('click', () => { if (!b.disabled && level !== i) opts.onButton('level'); });
  }
  const levelBar = h('div.adv-levels', null, levelTabs.surface, levelTabs.under);
  attachTooltip(levelBar, 'Switch map level (U)');
  const heroList = h('div.adv-herolist');
  const townList = h('div.adv-townlist');
  const info = h('div.adv-infobox');
  const buttons = {};
  const grid = h('div.adv-buttons', null, PANEL_BUTTONS.map(([id, glyph, tip]) => {
    const b = IconButton(glyph, { size: 42, tooltip: tip, onClick: () => opts.onButton(id) });
    b.dataset.btn = id;
    buttons[id] = b;
    return b;
  }));
  const el = h('div.adv-panel', null,
    h('div.adv-minimap-frame', null, minimap, levelBar),
    info,
    h('div.adv-lists', null,
      h('div.adv-list-head', null, 'Heroes'), heroList,
      h('div.adv-list-head', null, 'Towns'), townList),
    grid);

  const statsOf = (hero) => {
    let s = null;
    try { s = opts.heroStats ? opts.heroStats(hero) : null; } catch { s = null; }
    return {
      maxMana: (s && s.maxMana) || (hero.primary && hero.primary.knowledge ? hero.primary.knowledge * 10 : 10),
      primary: (s && s.primary) || hero.primary || {},
    };
  };

  function heroItem(state, hero, selected) {
    const p = state.players[hero.owner];
    const st = statsOf(hero);
    const move = h('div.adv-bar.adv-bar-move', null, h('div.adv-bar-fill', { style: { height: pct(hero.movePoints, hero.maxMovePoints) } }));
    const mana = h('div.adv-bar.adv-bar-mana', null, h('div.adv-bar-fill', { style: { height: pct(hero.mana, st.maxMana) } }));
    const item = h('div.adv-hero-item', { class: [selected && 'is-selected', hero.asleep && 'is-asleep'], dataset: { hero: hero.id } },
      move, HeroPortrait({ hero, size: 38, playerColor: p && p.color, tooltip: `${heroDisplayName(hero)} — ${hero.movePoints}/${hero.maxMovePoints} movement, ${hero.mana}/${st.maxMana} mana` }), mana,
      hero.asleep ? h('span.adv-zz', null, 'z') : null);
    item.addEventListener('click', () => opts.onSelectHero(hero.id));
    item.addEventListener('dblclick', () => opts.onOpenHero(hero.id));
    return item;
  }

  function townItem(state, town, selected) {
    const stock = townStockList(town);
    const item = h('div.adv-town-item', { class: [selected && 'is-selected', town.builtThisTurn && 'is-built'], dataset: { town: town.id } },
      // the town as drawn on the map (fort level, owner flag): readable at list size
      sprite('object', 'town', { size: 15, variant: town.faction, state: fortState(town), playerColor: state.players[town.owner] ? state.players[town.owner].color : undefined }),
      h('span.adv-town-name', null, town.name),
      town.builtThisTurn ? h('span.adv-built', null, '✓') : null,
      stock.length ? h('span.adv-stock', null, '') : null);
    const lines = [`${town.name} (${factionName(town.faction)}, ${fortState(town)})`];
    if (town.builtThisTurn) lines.push('Built today');
    if (stock.length) lines.push(`Ready to recruit: ${stock.map((s) => `${s.count} ${CREATURE_BY_ID[s.creatureId].name}`).join(', ')}`);
    attachTooltip(item, lines.join('\n'));
    item.addEventListener('click', () => opts.onSelectTown(town.id));
    item.addEventListener('dblclick', () => opts.onOpenTown(town.id));
    return item;
  }

  function heroBox(state, hero) {
    const p = state.players[hero.owner];
    const st = statsOf(hero);
    const portrait = HeroPortrait({ hero, size: 58, playerColor: p && p.color, onClick: () => opts.onOpenHero(hero.id), tooltip: 'Open the hero screen' });
    return h('div.adv-box.adv-box-hero', null,
      h('div.adv-card-top', null, portrait,
        h('div.adv-card-main', null,
          h('div.adv-box-title', null, heroDisplayName(hero)),
          h('div.adv-small', null, `Level ${hero.level} ${heroClassName(hero)}${hero.inBoat ? ' · at sea' : ''}${hero.asleep ? ' · asleep' : ''}`),
          Bar('move', hero.movePoints, hero.maxMovePoints, `Move ${fmt(hero.movePoints)} / ${fmt(hero.maxMovePoints)}`),
          Bar('mana', hero.mana, st.maxMana, `Mana ${fmt(hero.mana)} / ${fmt(st.maxMana)}`))),
      PrimaryStats(st.primary, { layout: 'row', iconSize: 18 }),
      ArmyRow({ id: 'box', army: hero.army, readonly: true, size: 28 }));
  }

  function townBox(state, town) {
    const garrison = town.garrisonHero && state.heroes[town.garrisonHero] ? state.heroes[town.garrisonHero].army : town.garrison;
    const stock = townStockList(town);
    const owner = state.players[town.owner];
    return h('div.adv-box.adv-box-town', null,
      h('div.adv-card-top', null,
        h('div.adv-card-town', { onClick: () => opts.onOpenTown(town.id) },
          sprite('object', 'town', { size: 22, variant: town.faction, state: fortState(town), playerColor: owner ? owner.color : undefined })),
        h('div.adv-card-main', null,
          h('div.adv-box-title', null, town.name),
          h('div.adv-small', null, `${factionName(town.faction)} · ${fortState(town)}`),
          h('div.adv-small', { class: town.builtThisTurn ? 'is-good' : '' }, town.builtThisTurn ? 'Built today' : 'Can build today'),
          town.visitingHero && state.heroes[town.visitingHero] ? h('div.adv-small', null, `Visiting: ${heroDisplayName(state.heroes[town.visitingHero])}`) : null)),
      h('div.adv-small.adv-card-label', null, 'Garrison'),
      ArmyRow({ id: 'box', army: garrison || [], readonly: true, size: 28 }),
      h('div.adv-small.adv-card-label', null, stock.length ? 'Ready to recruit' : 'No creatures to recruit'),
      stock.length ? h('div.adv-stockrow', null, stock.slice(0, 7).map((s) => h('div.adv-stock-cell', { title: CREATURE_BY_ID[s.creatureId].name },
        sprite('creature', s.creatureId, { size: 26 }), h('span', null, String(s.count))))) : null);
  }

  function setLevel(z, hasUnderground) {
    level = z ? 1 : 0;
    levelTabs.surface.classList.toggle('is-active', level === 0);
    levelTabs.under.classList.toggle('is-active', level === 1);
    levelTabs.under.disabled = !hasUnderground;
    levelBar.classList.toggle('is-single', !hasUnderground);
  }

  /** Re-render lists, info box and button states. */
  function update(state, { playerId, heroId, townId, hasUnderground, hasSpells, level: z = level }) {
    clear(heroList, playerHeroes(state, playerId).filter((x) => !x.garrisoned).map((x) => heroItem(state, x, x.id === heroId)));
    if (!heroList.children.length) heroList.appendChild(h('div.adv-list-empty', null, 'No heroes'));
    clear(townList, playerTowns(state, playerId).map((t) => townItem(state, t, t.id === townId)));
    if (!townList.children.length) townList.appendChild(h('div.adv-list-empty', null, 'No towns'));
    const hero = heroId ? state.heroes[heroId] : null;
    const town = !hero && townId ? state.towns[townId] : null;
    clear(info, hero ? heroBox(state, hero) : town ? townBox(state, town) : h('div.adv-small.adv-card-empty', null, 'Select a hero or a town.'));
    buttons.level.setDisabled(!hasUnderground);
    buttons.sleep.setDisabled(!hero);
    buttons.move.setDisabled(!hero);
    buttons.spell.setDisabled(!hero || !hasSpells);
    buttons.sleep.classList.toggle('is-active', !!(hero && hero.asleep));
    setLevel(z, hasUnderground);
  }

  return { el, minimap, buttons, heroList, townList, info, update, setLevel, destroy: () => minimap.destroy() };
}
