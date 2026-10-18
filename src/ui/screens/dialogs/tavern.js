// Tavern: the two heroes for hire (shared kingdom pool), hero details, hire for 2500 gold,
// a rumour of the day and a link to the Thieves' Guild.
import * as townEngine from '../../../engine/town.js';
import { HERO_BY_ID } from '../../../data/heroes.js';
import { HERO_CLASS_BY_ID } from '../../../data/heroClasses.js';
import { liveDialog, act } from '../town/dialogUtil.js';
import { currentPlayer, rumorFor, canControlTown } from '../town/townModel.js';
import { openThievesGuild } from './thievesGuild.js';

/** @returns {Promise<string|null>} id of the hired hero */
export function openTavern(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  let selected = 0;
  let hired = null;
  const handle = liveDialog(ctx, {
    title: 'Tavern',
    cls: 'town-tavern',
    width: 760,
    buttons: [
      { label: 'Recruit hero', kind: 'primary', default: true, keep: true, onClick: () => hire() },
      { label: "Thieves' Guild", keep: true, onClick: () => openThievesGuild(ctx) },
      { label: 'Close', value: null, cancel: true },
    ],
    render: (d) => {
      const town = ctx.state.towns[townId];
      const player = currentPlayer(ctx.state);
      if (!player) return h('p', null, '');
      const offers = town.owner != null ? townEngine.getTavernHeroes(ctx.state, town.owner) : [];
      if (!offers[selected]) selected = offers.findIndex(Boolean);
      const sel = offers[selected] || null;
      const blocked = !canControlTown(ctx.state, town) ? 'This is not your town.'
        : town.visitingHero ? 'A hero is already visiting this town.'
          : player.heroes.length >= 8 ? 'You already have 8 heroes.'
            : (player.resources.gold || 0) < (sel ? sel.cost : 2500) ? 'Not enough gold.' : null;
      d.setButtonDisabled(0, !sel || !!blocked);
      const def = sel ? HERO_BY_ID[sel.defId] : null;
      return h('div.town-tavern-body', null,
        h('div.town-tavern-offers', null, offers.map((o, i) => {
          if (!o) return h('div.town-tavern-offer.is-empty', null, '-');
          const el = h('div.town-tavern-offer', { class: i === selected && 'is-selected', dataset: { index: i, hero: o.defId } },
            ui.HeroPortrait({ defId: o.defId, size: 72 }),
            h('div.town-tavern-name', null, o.name),
            h('div.town-tavern-class', null, `Level ${o.level} ${HERO_CLASS_BY_ID[o.classId]?.name || ''}`));
          el.addEventListener('click', () => { selected = i; d.refresh(); });
          el.addEventListener('dblclick', () => { selected = i; hire(); });
          return el;
        })),
        def ? h('div.town-tavern-detail', null,
          ui.HeroCard({ defId: def.id, showSkills: true }),
          h('p.town-tavern-bio', null, def.biography || ''),
          h('div', null, 'Cost: ', ui.CostView({ gold: sel.cost }, player.resources))) : h('p', null, 'No heroes for hire.'),
        blocked ? h('p.town-tavern-blocked', null, blocked) : null,
        h('div.town-tavern-rumor', null, h('b', null, 'Rumour: '), rumorFor(ctx.state)));
    },
  });

  function hire() {
    const index = selected;
    const res = act(ctx, (s) => townEngine.hireHero(s, townId, index));
    if (res && res.ok !== false) {
      hired = res.heroId || null;
      ctx.audio.play('recruit');
      handle.close(hired);
    }
  }
  handle.hire = (i) => { if (i != null) selected = i; hire(); };
  const p = handle.result.then(() => hired);
  p.handle = handle;
  return p;
}
