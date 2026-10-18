// Marketplace: resource <-> resource trade at the engine's rates (more marketplaces = better rates),
// with a slider of lots, plus "send resources to another player".
import * as economy from '../../../engine/economy.js';
import { RESOURCES } from '../../../core/constants.js';
import { liveDialog, act } from '../town/dialogUtil.js';
import { currentPlayer, maxLots } from '../town/townModel.js';

const label = (r) => r[0].toUpperCase() + r.slice(1);

/**
 * @param {object} ctx
 * @param {{townId?: string, extraMarkets?: number, tab?: 'trade'|'send'}} [opts]
 *   `extraMarkets` lets the adventure screen reuse the window at a Trading Post.
 */
export function openMarketplace(ctx, opts = {}) {
  const { ui } = ctx;
  const { h } = ui;
  const view = { give: 'wood', get: 'gold', lots: 0, tab: opts.tab || 'trade', to: null, sendRes: 'gold', amount: 0 };
  const tradeCtx = { townId: opts.townId, extraMarkets: opts.extraMarkets || 0 };

  const handle = liveDialog(ctx, {
    title: 'Marketplace',
    cls: 'town-market',
    width: 820,
    render: (d) => {
      const player = currentPlayer(ctx.state);
      if (!player) return h('p', null, 'No player.');
      const markets = economy.countMarketplaces(ctx.state, player.id, tradeCtx.extraMarkets);
      const tabs = ui.Tabs({
        active: view.tab,
        onChange: (id) => { view.tab = id; },
        tabs: [
          { id: 'trade', label: 'Trade resources', content: () => tradeTab(d, player, markets) },
          { id: 'send', label: 'Send to player', content: () => sendTab(d, player, markets) },
        ],
      });
      return h('div.town-market-body', null,
        h('div.town-market-head', null, `Marketplaces owned: ${markets}`), tabs);
    },
  });

  function resourceColumn(title, player, selected, onPick, extra) {
    return h('div.town-market-col', null, h('div.town-market-col-title', null, title),
      h('div.town-market-res', null, RESOURCES.map((r) => {
        const cell = h('div.town-market-cell', { class: r === selected && 'is-selected', dataset: { resource: r } },
          ctx.sprite('resource', r, { size: 40 }), h('div.town-market-amt', null, extra(r)));
        cell.addEventListener('click', () => onPick(r));
        ui.attachTooltip(cell, label(r));
        return cell;
      })));
  }

  function tradeTab(d, player, markets) {
    const rate = view.give !== view.get ? economy.getMarketRate(ctx.state, player.id, view.give, view.get, tradeCtx) : null;
    const max = maxLots(player.resources[view.give], rate);
    if (view.lots > max) view.lots = max;
    const summary = h('div.town-market-summary');
    const tradeBtn = ui.Button('Trade', { kind: 'primary', onClick: () => trade() });
    const sync = () => {
      slider.value = view.lots;
      ui.clear(summary, rate
        ? `Give ${view.lots * rate.give} ${view.give}, receive ${view.lots * rate.get} ${view.get}`
        : markets < 1 ? 'You need a marketplace to trade.' : 'Pick two different resources.');
      tradeBtn.setDisabled(!rate || view.lots < 1);
    };
    const slider = ui.Slider({ min: 0, max: Math.max(0, max), value: view.lots, onChange: (v) => { view.lots = v; sync(); } });
    const node = h('div.town-market-trade', null,
      h('div.town-market-cols', null,
        resourceColumn('Kingdom resources', player, view.give, (r) => { view.give = r; view.lots = 0; d.refresh(); }, (r) => String(player.resources[r] || 0)),
        h('div.town-market-mid', null,
          ctx.sprite('resource', view.give, { size: 56 }), h('div.town-market-arrow', null, '=>'), ctx.sprite('resource', view.get, { size: 56 }),
          h('div.town-market-rate', null, rate ? `${rate.give} : ${rate.get}` : '-')),
        resourceColumn('Available for trade', player, view.get, (r) => { view.get = r; view.lots = 0; d.refresh(); }, (r) => {
          if (r === view.give) return 'n/a';
          const rr = economy.getMarketRate(ctx.state, player.id, view.give, r, tradeCtx);
          return rr ? `${rr.give}:${rr.get}` : '-';
        })),
      slider, summary,
      h('div.k-row', null,
        ui.Button('Max', { onClick: () => { view.lots = max; sync(); } }),
        tradeBtn));
    sync();
    return node;
  }

  function trade() {
    const player = currentPlayer(ctx.state);
    const lots = view.lots;
    if (!player || lots < 1) return;
    const res = act(ctx, (s) => economy.marketTrade(s, player.id, view.give, view.get, lots, tradeCtx));
    if (res && res.ok !== false) { ctx.audio.play('coin'); view.lots = 0; handle.refresh(); }
  }

  function sendTab(d, player, markets) {
    const others = ctx.state.players.filter((p) => p.alive && p.id !== player.id);
    if (!others.length) return h('p', null, 'There is nobody to send resources to.');
    if (view.to == null || !others.some((p) => p.id === view.to)) view.to = others[0].id;
    const have = player.resources[view.sendRes] || 0;
    if (view.amount > have) view.amount = have;
    const sendBtn = ui.Button('Send', {
      kind: 'primary',
      disabled: markets < 1 || view.amount < 1,
      onClick: () => {
        const amount = view.amount;
        const res = act(ctx, (s) => economy.sendResources(s, player.id, view.to, view.sendRes, amount, tradeCtx));
        if (res && res.ok !== false) { view.amount = 0; handle.refresh(); }
      },
    });
    const stepper = ui.NumberStepper({ min: 0, max: have, value: view.amount, bigStep: view.sendRes === 'gold' ? 1000 : 5, showMinMax: true,
      onChange: (v) => { view.amount = v; sendBtn.setDisabled(markets < 1 || v < 1); } });
    return h('div.town-market-send', null,
      ui.Field('Recipient', ui.Select({ options: others.map((p) => ({ value: p.id, label: `${p.name} (${p.color})` })), value: view.to, onChange: (v) => { view.to = v; } })),
      resourceColumn('Resource', player, view.sendRes, (r) => { view.sendRes = r; view.amount = 0; d.refresh(); }, (r) => String(player.resources[r] || 0)),
      ui.Field('Amount', stepper),
      markets < 1 ? h('p', null, 'You need a marketplace to send resources.') : null,
      sendBtn);
  }

  handle.trade = (give, get, lots) => { view.give = give; view.get = get; view.lots = lots; trade(); };
  const p = handle.result;
  p.handle = handle;
  return p;
}
