// Hero meeting / exchange window: two heroes of one player side by side, armies and artifacts
// (paper doll + backpack) can be moved both ways. Opened by the adventure layer when two friendly
// heroes meet (pending kind `hero_exchange`, registered below) or directly with openHeroTrade().
import { tradeArmy, tradeArtifact } from '../../../engine/hero.js';
import { getPrimary, getMaxMana } from '../../../engine/bonuses.js';
import { registerPendingRenderer } from '../../kit/pending.js';
import { act, ensureDialogCss } from '../town/dialogUtil.js';
import { moveArtifact, engineRef, heroTitle } from '../hero/heroModel.js';

/**
 * Engine call for an artifact drag between two exchange grids (grid id = hero id).
 * @returns {(state) => Result}
 */
export function artifactTradeAction(from, to) {
  return (state) => {
    if (from.grid === to.grid) return moveArtifact(state.heroes[from.grid], from, to);
    const dest = to.where === 'backpack' ? { backpack: true } : { slot: to.slot, index: to.index };
    return tradeArtifact(state, from.grid, to.grid, engineRef(from), dest);
  };
}

/**
 * Open the exchange window.
 * @returns {Promise<void>} resolves when the window is closed
 */
export function openHeroTrade(ctx, heroAId, heroBId) {
  const { ui } = ctx;
  const { h } = ui;
  ensureDialogCss(ui);
  const armySel = ui.createArmySelection();
  const artSel = ui.createArtifactSelection();
  const sides = [heroAId, heroBId].map((id) => {
    const hero = ctx.state.heroes[id];
    const header = h('div.hero-trade-head');
    const army = ui.ArmyRow({
      id, army: hero.army, selection: armySel, size: 54,
      onMove: (from, to, count, fromRow, toRow) => act(ctx, (s) => tradeArmy(s, fromRow, from, toRow, to, count)),
    });
    const arts = ui.ArtifactGrid({
      id, artifacts: hero.artifacts, selection: artSel, slotSize: 46, backpackVisible: 6,
      onMove: (from, to) => act(ctx, artifactTradeAction(from, to)),
    });
    return { id, header, army, arts, el: h('div.hero-trade-side', { dataset: { hero: id } }, header, arts, army) };
  });

  function render() {
    for (const s of sides) {
      const hero = ctx.state.heroes[s.id];
      if (!hero) continue;
      const p = getPrimary(ctx.state, hero);
      ui.clear(s.header,
        ui.HeroPortrait({ hero, size: 64 }),
        h('div.hero-trade-title', null, h('b', null, hero.name), h('div', null, heroTitle(hero)),
          ui.PrimaryStats(p, { base: hero.primary, iconSize: 20 }),
          h('div.hero-trade-mana', null, `Mana ${hero.mana} / ${getMaxMana(ctx.state, hero)}`)),
        h('div.hero-trade-skills', null, hero.skills.map((sk) => ui.SkillIcon({ id: sk.id, level: sk.level, size: 30 }))));
      s.army.update(hero.army);
      s.arts.update(hero.artifacts);
    }
  }

  const d = ui.openDialog({
    title: 'Hero Exchange',
    class: 'town-dlg hero-trade-dlg',
    width: 1200,
    content: h('div.hero-trade', null, sides[0].el, sides[1].el),
    buttons: [{ label: 'Done', value: true, default: true, cancel: true }],
    cancelValue: true,
  });
  const off = ctx.onState(() => { if (d.isOpen()) render(); });
  render();
  const p = d.result.then(() => { off(); armySel.clear(); artSel.clear(); });
  p.handle = d;
  p.sides = sides;
  return p;
}

// The adventure engine queues `hero_exchange` when two friendly heroes meet.
registerPendingRenderer('hero_exchange', async (pending, ctx) => {
  const other = pending.data && pending.data.otherHeroId;
  if (ctx && ctx.state && ctx.state.heroes[pending.heroId] && ctx.state.heroes[other]) {
    await openHeroTrade(ctx, pending.heroId, other);
  }
  return { optionIndex: 0 };
});
