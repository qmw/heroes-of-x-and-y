// Freelancer's Guild: sell creatures of the hero in town (or the garrison) for resources, at the
// marketplace rates (only whole lots are sold).
import * as townEngine from '../../../engine/town.js';
import * as economy from '../../../engine/economy.js';
import { getGarrisonArmy } from '../../../engine/town.js';
import { RESOURCES } from '../../../core/constants.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { freelancerRate } from '../../../data/buildings.js';
import { liveDialog, act } from '../town/dialogUtil.js';

export function openFreelancers(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  const view = { where: null, slot: null, resource: 'gold', count: 0 };
  const handle = liveDialog(ctx, {
    title: "Freelancer's Guild",
    cls: 'town-freelance',
    width: 860,
    render: (d) => {
      const town = ctx.state.towns[townId];
      const rows = [];
      if (town.visitingHero) rows.push({ where: 'visiting', label: `${ctx.state.heroes[town.visitingHero].name}'s army`, army: ctx.state.heroes[town.visitingHero].army });
      rows.push({ where: 'garrison', label: 'Garrison', army: getGarrisonArmy(ctx.state, town) });
      if (!view.where) view.where = rows[0].where;
      const row = rows.find((r) => r.where === view.where) || rows[0];
      const stack = view.slot != null ? row.army[view.slot] : null;
      const markets = Math.max(1, economy.countMarketplaces(ctx.state, town.owner ?? 0));
      const rate = stack ? freelancerRate(CREATURE_BY_ID[stack.creatureId].cost.gold || 0, view.resource, markets) : null;
      if (stack && view.count > stack.count) view.count = stack.count;
      const lots = rate ? Math.floor(view.count / rate.give) : 0;
      return h('div.town-freelance-body', null,
        rows.map((r) => h('div.town-freelance-row', null, h('div.town-freelance-label', null, r.label),
          h('div.town-freelance-slots', null, r.army.map((s, slot) => {
            const el = h('div.town-freelance-slot', { class: [!s && 'is-empty', r.where === view.where && slot === view.slot && 'is-selected'], dataset: { slot, where: r.where } },
              s ? ctx.sprite('creature', s.creatureId, { size: 48 }) : null, s ? h('span', null, String(s.count)) : null);
            if (s) el.addEventListener('click', () => { view.where = r.where; view.slot = slot; view.count = s.count; d.refresh(); });
            return el;
          })))),
        h('div.town-freelance-res', null, RESOURCES.map((res) => {
          const el = h('div.town-market-cell', { class: res === view.resource && 'is-selected', dataset: { resource: res } }, ctx.sprite('resource', res, { size: 36 }));
          el.addEventListener('click', () => { view.resource = res; d.refresh(); });
          return el;
        })),
        stack ? h('div.town-freelance-deal', null,
          ui.NumberStepper({ min: 0, max: stack.count, value: view.count, bigStep: 10, showMinMax: true, onChange: (v) => { view.count = v; d.refresh(); } }),
          h('p', null, `${CREATURE_BY_ID[stack.creatureId].name}: ${rate.give} for ${rate.get} ${view.resource}. Selling ${lots * rate.give} gives ${lots * rate.get} ${view.resource}.`),
          ui.Button('Sell', { kind: 'primary', disabled: lots < 1, onClick: () => {
            const res = act(ctx, (s) => townEngine.sellCreatures(s, townId, { where: view.where, slot: view.slot, count: view.count, resource: view.resource }));
            if (res && res.ok !== false) { view.slot = null; view.count = 0; }
          } })) : h('p', null, 'Select a stack to sell.'));
    },
  });
  return handle.result;
}
