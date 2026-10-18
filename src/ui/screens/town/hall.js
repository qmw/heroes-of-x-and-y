// Town Hall ("build") window: every building of the faction as a card with its state
// (built / can build / already built today / not enough resources / missing requirements),
// and a detail window with description, effects, requirements, cost and the Build button.
import * as townEngine from '../../../engine/town.js';
import { getBuilding } from '../../../data/buildings.js';
import { liveDialog, act } from './dialogUtil.js';
import {
  hallCards, STATUS_TEXT, buildingName, buildingEffectLines, currentPlayer, canControlTown, factionName,
} from './townModel.js';

/** Open the hall. Resolves with the id of the building built, or null. */
export function openHall(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  let built = null;
  const handle = liveDialog(ctx, {
    title: 'Town Hall',
    cls: 'town-hall',
    width: 1100,
    render: () => {
      const town = ctx.state.towns[townId];
      const rows = townEngine.getAvailableBuildings(ctx.state, townId);
      const cards = hallCards(rows, town.buildings);
      return h('div.town-hall-body', null,
        h('div.town-hall-head', null, `${town.name} - ${factionName(town.faction)}`,
          town.builtThisTurn ? h('span.town-hall-note', null, ' (a building was already constructed today)') : null),
        h('div.town-hall-grid', null, cards.map((c) => {
          const card = h('div.town-hall-card', { class: `is-${c.status.replace(/_/g, '-')}`, dataset: { building: c.id, status: c.status } },
            ctx.sprite('building', c.id, { size: 80, variant: town.faction }),
            h('div.town-hall-name', null, c.name),
            h('div.town-hall-status', null, STATUS_TEXT[c.status] || c.status));
          ui.attachTooltip(card, () => [c.name, STATUS_TEXT[c.status] || c.status,
            c.missing.length ? `Requires: ${c.missing.map(buildingName).join(', ')}` : ''].filter(Boolean).join('\n'));
          ui.attachInfo(card, () => buildingInfo(ctx, c.id, town.faction));
          card.addEventListener('click', async () => {
            const r = await openBuildingDetail(ctx, townId, c.id);
            if (r) { built = r; handle.close(r); }
          });
          return card;
        })));
    },
  });
  const p = handle.result.then(() => built);
  p.handle = handle;
  return p;
}

/** Info node of a building (right-click popups everywhere). */
export function buildingInfo(ctx, buildingId, factionId) {
  const { h } = ctx.ui;
  const b = getBuilding(buildingId);
  const lines = buildingEffectLines(buildingId, factionId);
  return h('div.town-binfo', null,
    h('div.town-binfo-head', null, ctx.sprite('building', buildingId, { size: 64, variant: factionId }), h('b', null, b.name)),
    h('p', null, b.description || ''),
    lines.length ? h('ul', null, lines.map((l) => h('li', null, l))) : null,
    b.dwelling ? h('p', null, `Dwelling of tier ${b.dwelling.tier}`) : null);
}

/**
 * Detail window of one building with the Build button.
 * @returns {Promise<string|null>} the building id when it was built
 */
export function openBuildingDetail(ctx, townId, buildingId) {
  const { ui } = ctx;
  const { h } = ui;
  const town = ctx.state.towns[townId];
  const b = getBuilding(buildingId);
  const row = townEngine.getAvailableBuildings(ctx.state, townId).find((r) => r.id === buildingId);
  const status = row ? (row.status === 'built' ? 'built' : row.status === 'available' ? 'available' : row.error) : 'not_available';
  const player = currentPlayer(ctx.state);
  const canAct = canControlTown(ctx.state, town);
  const missing = row && row.missing ? row.missing : [];
  const content = h('div.town-bdetail', null,
    h('div.town-bdetail-top', null, ctx.sprite('building', buildingId, { size: 110, variant: town.faction }),
      h('div', null,
        h('p', null, b.description || ''),
        h('ul', null, buildingEffectLines(buildingId, town.faction).map((l) => h('li', null, l))))),
    missing.length ? h('div.town-bdetail-req', null, 'Requires: ',
      missing.map((id) => h('span.k-tag', { dataset: { building: id } }, buildingName(id)))) : null,
    h('div.town-bdetail-cost', null, 'Cost: ', ui.CostView(b.cost, player ? player.resources : null)),
    h('div.town-bdetail-status', { class: `is-${String(status).replace(/_/g, '-')}` }, STATUS_TEXT[status] || status));
  const d = ui.openDialog({
    title: b.name,
    class: 'town-dlg town-bdetail-dlg',
    width: 620,
    content,
    buttons: [
      { label: 'Build', kind: 'primary', default: true, disabled: !(canAct && status === 'available'), value: 'build' },
      { label: 'Cancel', value: null, cancel: true },
    ],
  });
  const p = d.result.then((v) => {
    if (v !== 'build') return null;
    const res = act(ctx, (s) => townEngine.build(s, townId, buildingId));
    if (res && res.ok !== false) {
      ctx.audio.play('build');
      ctx.toast(`${b.name} built.`, 'good');
      return buildingId;
    }
    return null;
  });
  p.handle = d;
  return p;
}
