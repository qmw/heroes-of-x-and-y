// Windows of the special town buildings that have no dialog module of their own:
// Shipyard, Skeleton Transformer, Castle Gate, Mana Vortex / generic info, and the stack window
// (creature info + upgrade + dismiss) used by the garrison rows.
import * as townEngine from '../../../engine/town.js';
import { getGarrisonArmy } from '../../../engine/town.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { BOAT_COST, getBuilding } from '../../../data/buildings.js';
import { liveDialog, act } from './dialogUtil.js';
import { currentPlayer } from './townModel.js';
import { buildingInfo } from './hall.js';

export function openShipyard(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  const player = currentPlayer(ctx.state);
  const d = ui.openDialog({
    title: 'Shipyard',
    class: 'town-dlg',
    width: 460,
    content: h('div.town-ship', null, ctx.sprite('object', 'boat', { size: 96 }),
      h('p', null, 'Build a boat on the water next to the town?'),
      h('div', null, 'Cost: ', ui.CostView(BOAT_COST, player ? player.resources : null))),
    buttons: [{ label: 'Build boat', kind: 'primary', default: true, value: 'build' }, { label: 'Cancel', value: null, cancel: true }],
  });
  return d.result.then((v) => (v === 'build' ? act(ctx, (s) => townEngine.buildBoat(s, townId)) : null));
}

export function openSkeletonTransformer(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  const handle = liveDialog(ctx, {
    title: 'Skeleton Transformer',
    cls: 'town-skel',
    width: 760,
    render: () => {
      const town = ctx.state.towns[townId];
      const rows = [];
      if (town.visitingHero) rows.push({ where: 'visiting', label: ctx.state.heroes[town.visitingHero].name, army: ctx.state.heroes[town.visitingHero].army });
      rows.push({ where: 'garrison', label: 'Garrison', army: getGarrisonArmy(ctx.state, town) });
      return h('div.town-skel-body', null,
        h('p', null, 'Click a stack to turn it into skeletons (dragons and hydras become bone dragons).'),
        rows.map((r) => h('div.town-freelance-row', null, h('div.town-freelance-label', null, r.label),
          h('div.town-freelance-slots', null, r.army.map((s, slot) => {
            const to = s ? townEngine.skeletonTransformResult(s.creatureId) : null;
            const el = h('div.town-freelance-slot', { class: [!s && 'is-empty', s && !to && 'is-disabled'], dataset: { slot, where: r.where } },
              s ? ctx.sprite('creature', s.creatureId, { size: 48 }) : null, s ? h('span', null, String(s.count)) : null);
            if (s) {
              ui.attachTooltip(el, to ? `${s.count} ${CREATURE_BY_ID[s.creatureId].name} -> ${CREATURE_BY_ID[to].name}` : 'Cannot be transformed');
              if (to) el.addEventListener('click', () => act(ctx, (st) => townEngine.transformToSkeletons(st, townId, { where: r.where, slot })));
            }
            return el;
          })))));
    },
  });
  return handle.result;
}

export function openCastleGate(ctx, townId) {
  const { ui } = ctx;
  const town = ctx.state.towns[townId];
  if (!town.visitingHero) return ui.message('A visiting hero is needed to use the Castle Gate.', { title: 'Castle Gate' });
  const dests = townEngine.getCastleGateDestinations(ctx.state, townId);
  if (!dests.length) return ui.message('There is no other town with a Castle Gate that can receive the hero.', { title: 'Castle Gate' });
  return ui.choose({
    title: 'Castle Gate',
    text: `Send ${ctx.state.heroes[town.visitingHero].name} to:`,
    cancellable: true,
    options: dests.map((id) => ({ label: ctx.state.towns[id].name, value: id })),
  }).then((dest) => {
    if (!dest) return null;
    const res = act(ctx, (s) => townEngine.useCastleGate(s, townId, dest));
    if (res && res.ok !== false) ctx.showScreen('town', { townId: dest }, { replace: true });
    return res;
  });
}

export function openBuildingInfo(ctx, townId, buildingId) {
  const town = ctx.state.towns[townId];
  return ctx.ui.message(buildingInfo(ctx, buildingId, town.faction), { title: getBuilding(buildingId).name });
}

/**
 * Stack window of the town's garrison / visiting rows: creature card, Upgrade (if the town has the
 * upgraded dwelling) and Dismiss.
 * @param {'garrison'|'visiting'} where
 */
export function openStackInfo(ctx, townId, where, slot) {
  const { ui } = ctx;
  const { h } = ui;
  const town = ctx.state.towns[townId];
  const army = where === 'garrison' ? getGarrisonArmy(ctx.state, town) : ctx.state.heroes[town.visitingHero]?.army;
  const stack = army && army[slot];
  if (!stack) return Promise.resolve(null);
  const info = townEngine.getUpgradeInfo(ctx.state, { townId, where, slot });
  const player = currentPlayer(ctx.state);
  const d = ui.openDialog({
    title: CREATURE_BY_ID[stack.creatureId]?.name || stack.creatureId,
    class: 'town-dlg town-stack-dlg',
    width: 560,
    content: h('div', null, ui.CreatureCard({ creatureId: stack.creatureId, count: stack.count }),
      info ? h('div.town-stack-up', null, `Upgrade to ${CREATURE_BY_ID[info.to].name}: `, ui.CostView(info.cost, player ? player.resources : null)) : null),
    buttons: [
      ...(info ? [{ label: 'Upgrade', kind: 'primary', value: 'upgrade' }] : []),
      { label: 'Dismiss', kind: 'danger', value: 'dismiss' },
      { label: 'Close', value: null, default: true, cancel: true },
    ],
  });
  return d.result.then(async (v) => {
    if (v === 'upgrade') return act(ctx, (s) => townEngine.upgradeStack(s, { townId, where, slot }));
    if (v === 'dismiss' && await ui.confirm(`Dismiss ${stack.count} ${CREATURE_BY_ID[stack.creatureId]?.name}?`, { danger: true })) {
      return act(ctx, (s) => townEngine.dismissTownStack(s, townId, { where, slot }));
    }
    return null;
  });
}
