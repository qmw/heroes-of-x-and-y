// Recruit dialog (dwelling / horde / portal / Fort "recruit all"), like the original's recruit window:
// creature portrait, available count, unit cost, slider + stepper, total cost, target army.
import * as townEngine from '../../../engine/town.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { liveDialog, act } from '../town/dialogUtil.js';
import {
  currentPlayer, recruitOptions, affordableCount, costTimes, creatureName, growthRows,
} from '../town/townModel.js';

/**
 * Open the recruit window for one creature row of the town.
 * @param {object} ctx
 * @param {string} townId
 * @param {string} creatureId any creature of the dwelling (base or upgraded) or a portal creature
 * @param {{target?: 'garrison'|'visiting'}} [opts]
 * @returns {Promise<{creatureId, count}|null>} what was bought
 */
export function openRecruit(ctx, townId, creatureId, opts = {}) {
  const { ui } = ctx;
  const { h } = ui;
  const town = () => ctx.state.towns[townId];
  const findRow = () => {
    const rows = townEngine.getRecruitInfo(ctx.state, townId);
    return rows.find((r) => r.creatureId === creatureId)
      || rows.find((r) => CREATURE_BY_ID[r.creatureId]?.upgradeOf === creatureId)
      || null;
  };
  const row0 = findRow();
  if (!row0) {
    ui.message(`${creatureName(creatureId)} cannot be recruited here.`, { title: 'Recruit' });
    return Promise.resolve(null);
  }
  let chosen = creatureId === row0.creatureId || !recruitOptions(town(), row0).some((o) => o.creatureId === creatureId)
    ? row0.creatureId : creatureId;
  let count = null;
  let target = opts.target || (town().visitingHero && !town().garrisonHero && opts.preferVisiting ? 'visiting' : 'garrison');
  let bought = null;
  let stepper = null;
  let slider = null;

  const handle = liveDialog(ctx, {
    title: 'Recruit Creatures',
    cls: 'town-recruit',
    width: 560,
    buttons: [
      { label: 'Recruit', kind: 'primary', default: true, keep: true, onClick: () => buy() },
      { label: 'Max', keep: true, onClick: () => setCount(maxNow()) },
      { label: 'Cancel', value: null, cancel: true },
    ],
    render: (d) => {
      const row = findRow();
      const t = town();
      const player = currentPlayer(ctx.state);
      if (!row || !player) return h('p', null, 'Nothing to recruit.');
      const options = recruitOptions(t, row);
      if (!options.some((o) => o.creatureId === chosen)) chosen = options[options.length - 1].creatureId;
      const opt = options.find((o) => o.creatureId === chosen);
      const max = Math.max(0, Math.min(opt.available, affordableCount(player.resources, opt.cost)));
      if (count == null || count > max) count = Math.min(max, count ?? max);
      const total = costTimes(opt.cost, count);
      slider = ui.Slider({ min: 0, max: Math.max(max, 0), value: count, onChange: (v) => { count = v; sync(); } });
      stepper = ui.NumberStepper({ min: 0, max: Math.max(max, 0), value: count, bigStep: 10, onChange: (v) => { count = v; sync(); } });
      const totalEl = h('div.town-recruit-total');
      const sync = () => {
        slider.value = count;
        stepper.value = count;
        ui.clear(totalEl, h('span', null, `Total (${count}): `), ui.CostView(costTimes(opt.cost, count), player.resources));
        d.setButtonDisabled(0, count < 1);
      };
      const cards = options.map((o) => {
        const card = h('div.town-recruit-pick', { class: o.creatureId === chosen && 'is-selected', dataset: { creature: o.creatureId } },
          ctx.sprite('creature', o.creatureId, { size: 96 }),
          h('div.town-recruit-name', null, creatureName(o.creatureId)),
          h('div.town-recruit-avail', null, `Available: ${o.available}`));
        card.addEventListener('click', () => { chosen = o.creatureId; count = null; d.refresh(); });
        ui.attachInfo(card, () => ui.CreatureCard({ creatureId: o.creatureId }));
        ui.attachTooltip(card, `${creatureName(o.creatureId)} - right-click for details`);
        return card;
      });
      const targets = [{ value: 'garrison', label: t.garrisonHero ? `Garrison hero (${ctx.state.heroes[t.garrisonHero]?.name})` : 'Town garrison' }];
      if (t.visitingHero) targets.push({ value: 'visiting', label: `Visiting hero (${ctx.state.heroes[t.visitingHero]?.name})` });
      if (!targets.some((x) => x.value === target)) target = 'garrison';
      const body = h('div.town-recruit-body', null,
        h('div.town-recruit-picks', null, cards),
        h('div.town-recruit-info', null,
          h('div', null, 'Cost per troop: ', ui.CostView(opt.cost, player.resources)),
          h('div', null, `Available: ${opt.available}  -  you can afford ${Math.min(opt.available, affordableCount(player.resources, opt.cost))}`),
          slider, stepper, totalEl,
          ui.Field('Recruit into', ui.Select({ options: targets, value: target, onChange: (v) => { target = v; } }))));
      sync();
      return body;
    },
  });

  function maxNow() {
    const row = findRow();
    const player = currentPlayer(ctx.state);
    if (!row || !player) return 0;
    const opt = recruitOptions(town(), row).find((o) => o.creatureId === chosen);
    return opt ? Math.max(0, Math.min(opt.available, affordableCount(player.resources, opt.cost))) : 0;
  }
  function setCount(n) { count = n; handle.refresh(); }
  function buy() {
    if (!count || count < 1) return;
    const n = count;
    const id = chosen;
    const res = act(ctx, (s) => townEngine.recruit(s, townId, id, n, target));
    if (res && res.ok !== false) {
      ctx.audio.play('recruit');
      bought = { creatureId: id, count: n };
      handle.close(bought);
    }
  }
  handle.buy = (n) => { if (n != null) count = n; buy(); };
  handle.select = (id) => { chosen = id; count = null; handle.refresh(); };
  const p = handle.result.then(() => bought);
  p.handle = handle;
  return p;
}

/**
 * Fort / Citadel / Castle window: every dwelling of the town with available creatures; click one to
 * recruit, or "Recruit all" (strongest first).
 */
export function openFort(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  const handle = liveDialog(ctx, {
    title: 'Fort - Creature Dwellings',
    cls: 'town-fort',
    width: 900,
    buttons: [
      { label: 'Recruit all', kind: 'primary', keep: true, onClick: () => act(ctx, (s) => townEngine.recruitAll(s, townId, 'garrison')) },
      { label: 'Close', value: null, default: true, cancel: true },
    ],
    render: () => {
      const rows = growthRows(townEngine.getRecruitInfo(ctx.state, townId));
      if (!rows.length) return h('p', null, 'No creature dwellings have been built yet.');
      return h('div.town-fort-grid', null, rows.map((r) => {
        const card = h('div.town-fort-card', { dataset: { creature: r.creatureId } },
          h('div.town-fort-name', null, r.name),
          ctx.sprite('creature', r.creatureId, { size: 84 }),
          h('div.town-fort-line', null, `Available: ${r.available}`),
          h('div.town-fort-line', null, r.source === 'portal' ? 'Portal of Summoning' : `Growth: +${r.growth} / week`),
          ui.CostView(r.cost));
        card.addEventListener('click', () => openRecruit(ctx, townId, r.creatureId));
        ui.attachInfo(card, () => ui.CreatureCard({ creatureId: r.creatureId }));
        return card;
      }));
    },
  });
  return handle.result;
}
