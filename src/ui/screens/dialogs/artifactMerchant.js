// Artifact Merchants: buy the stocked artifacts for any resource (to the visiting hero's backpack)
// or sell the visiting hero's artifacts.
import * as townEngine from '../../../engine/town.js';
import * as economy from '../../../engine/economy.js';
import { artifactValue, isSlotLocked } from '../../../engine/artifacts.js';
import { RESOURCES } from '../../../core/constants.js';
import { ARTIFACT_BY_ID } from '../../../data/artifacts.js';
import { SPELL_BY_ID } from '../../../data/spells.js';
import { artifactSellPrice } from '../../../data/buildings.js';
import { liveDialog, act } from '../town/dialogUtil.js';
import { currentPlayer } from '../town/townModel.js';

/** Sellable artifacts of a hero: `[{ref, entry, id, value}]` (pure). */
export function sellableArtifacts(hero) {
  const out = [];
  if (!hero) return out;
  const ok = (id) => {
    const a = ARTIFACT_BY_ID[id];
    return a && !a.noTransfer && a.slot !== 'war_machine' && a.slot !== 'spellbook';
  };
  const idOf = (e) => (typeof e === 'string' ? e : e && e.id);
  const valueOf = (e) => artifactValue(e, typeof e === 'object' && e.spellId ? SPELL_BY_ID[e.spellId]?.level : undefined);
  for (const [slot, list] of Object.entries(hero.artifacts.equipped)) {
    list.forEach((e, index) => {
      if (e && ok(idOf(e)) && !isSlotLocked(hero, slot, index)) out.push({ ref: { slot, index }, entry: e, id: idOf(e), value: valueOf(e) });
    });
  }
  hero.artifacts.backpack.forEach((e, i) => { if (ok(idOf(e))) out.push({ ref: { backpack: i }, entry: e, id: idOf(e), value: valueOf(e) }); });
  return out;
}

export function openArtifactMerchant(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  const view = { resource: 'gold', tab: 'buy' };
  const handle = liveDialog(ctx, {
    title: 'Artifact Merchants',
    cls: 'town-merchant',
    width: 900,
    render: () => {
      const town = ctx.state.towns[townId];
      const player = currentPlayer(ctx.state);
      const hero = town.visitingHero ? ctx.state.heroes[town.visitingHero] : null;
      const markets = Math.max(1, economy.countMarketplaces(ctx.state, town.owner ?? 0));
      const resPick = h('div.town-merchant-res', null, RESOURCES.map((r) => {
        const b = h('div.town-merchant-rescell', { class: r === view.resource && 'is-selected', dataset: { resource: r } },
          ctx.sprite('resource', r, { size: 32 }), h('span', null, String(player?.resources[r] || 0)));
        b.addEventListener('click', () => { view.resource = r; handle.refresh(); });
        return b;
      }));
      const buy = () => h('div.town-merchant-grid', null, townEngine.getArtifactMerchantOffers(ctx.state, townId).map((o, slot) => {
        if (!o) return h('div.town-merchant-card.is-empty', { dataset: { slot } }, 'Sold');
        const price = o.prices[view.resource];
        const card = h('div.town-merchant-card', { dataset: { slot, artifact: o.artifactId } },
          ctx.sprite('artifact', o.artifactId, { size: 56 }),
          h('div.town-merchant-name', null, ARTIFACT_BY_ID[o.artifactId]?.name || o.artifactId),
          ui.CostView({ [view.resource]: price }, player?.resources),
          ui.Button('Buy', { size: 'sm', kind: 'primary', disabled: !hero, onClick: () => act(ctx, (s) => townEngine.buyArtifact(s, townId, slot, view.resource)) }));
        ui.attachInfo(card, () => ui.ArtifactInfo(o.artifactId));
        return card;
      }));
      const sell = () => {
        if (!hero) return h('p', null, 'Only a visiting hero can sell artifacts.');
        const list = sellableArtifacts(hero);
        if (!list.length) return h('p', null, `${hero.name} has nothing to sell.`);
        return h('div.town-merchant-grid', null, list.map((a) => {
          const gain = artifactSellPrice(a.value, view.resource, markets);
          const card = h('div.town-merchant-card', { dataset: { artifact: a.id } },
            ctx.sprite('artifact', a.id, { size: 56 }),
            h('div.town-merchant-name', null, ui.artifactEntryName(a.entry)),
            h('div', null, `+${gain} ${view.resource}`),
            ui.Button('Sell', { size: 'sm', onClick: async () => {
              if (await ui.confirm(`Sell ${ui.artifactEntryName(a.entry)} for ${gain} ${view.resource}?`)) {
                act(ctx, (s) => townEngine.sellArtifact(s, townId, a.ref, view.resource));
              }
            } }));
          ui.attachInfo(card, () => ui.ArtifactInfo(a.entry));
          return card;
        }));
      };
      return h('div.town-merchant-body', null,
        h('div.town-merchant-head', null, 'Pay / receive in: ', resPick),
        hero ? null : h('p', null, 'A visiting hero is needed to buy or sell.'),
        ui.Tabs({ active: view.tab, onChange: (id) => { view.tab = id; }, tabs: [
          { id: 'buy', label: 'Buy', content: buy },
          { id: 'sell', label: 'Sell', content: sell },
        ] }));
    },
  });
  return handle.result;
}
