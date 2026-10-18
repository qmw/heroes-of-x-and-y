// Thieves' Guild: ranking of all living players per statistic; rows above the player's information
// level (taverns +1, Pub +3 ...) stay hidden.
import * as townEngine from '../../../engine/town.js';
import { liveDialog } from '../town/dialogUtil.js';
import { currentPlayer, ordinal } from '../town/townModel.js';

/** Pure: table model `{level, players: [{id, name, color}], rows: [{id, label, unlocked, places: {[playerId]: rank|null}}]}`. */
export function thievesGuildModel(state, playerId) {
  const info = townEngine.getThievesGuildInfo(state, playerId);
  const players = state.players.filter((p) => p.alive).map((p) => ({ id: p.id, name: p.name, color: p.color }));
  const rows = info.rows.map((r) => {
    const places = {};
    for (const p of players) places[p.id] = null;
    if (r.ranking) r.ranking.forEach((group, i) => { for (const id of group) places[id] = i + 1; });
    return { id: r.id, label: r.label, unlocked: r.unlocked, places };
  });
  return { level: info.level, players, rows };
}

export function openThievesGuild(ctx, playerId) {
  const { ui } = ctx;
  const { h } = ui;
  const handle = liveDialog(ctx, {
    title: "Thieves' Guild",
    cls: 'town-thieves',
    width: 900,
    render: () => {
      const pid = playerId ?? currentPlayer(ctx.state)?.id ?? 0;
      const m = thievesGuildModel(ctx.state, pid);
      return h('div.town-thieves-body', null,
        h('p', null, `Information level: ${m.level}${m.level < 1 ? " - build a tavern to hear what the thieves know." : ''}`),
        h('table.town-thieves-table', null,
          h('tr', null, h('th', null, ''), m.players.map((p) => h('th', { class: `town-pc-${p.color}` },
            h('span.town-flag', { style: { background: `var(--pc-${p.color})` } }), p.name))),
          m.rows.map((r) => h('tr', { class: r.unlocked ? '' : 'is-locked', dataset: { row: r.id } },
            h('td.town-thieves-label', null, r.label),
            m.players.map((p) => h('td', null, r.unlocked ? ordinal(r.places[p.id]) : '?'))))));
    },
  });
  return handle.result;
}
