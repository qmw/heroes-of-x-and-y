// Blacksmith: buy the war machine(s) this town sells for the hero in town.
import * as townEngine from '../../../engine/town.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { WAR_MACHINE_SLOT } from '../../../engine/leveling.js';
import { liveDialog, act, serviceHero } from '../town/dialogUtil.js';
import { currentPlayer } from '../town/townModel.js';

export function openBlacksmith(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  const handle = liveDialog(ctx, {
    title: 'Blacksmith',
    cls: 'town-smith',
    width: 640,
    render: () => {
      const town = ctx.state.towns[townId];
      const hero = serviceHero(ctx.state, town);
      const player = currentPlayer(ctx.state);
      const offers = townEngine.getWarMachinesForSale(ctx.state, townId);
      if (!offers.length) return h('p', null, 'This blacksmith sells nothing.');
      return h('div.town-smith-body', null,
        hero ? h('p', null, `Equipping ${hero.name}.`) : h('p', null, 'A hero must be in the town to buy a war machine.'),
        h('div.town-smith-offers', null, offers.map((o) => {
          const c = CREATURE_BY_ID[o.machineId];
          const has = hero && hero.artifacts.equipped.war_machine[WAR_MACHINE_SLOT[o.machineId]] != null;
          const btn = ui.Button(has ? 'Already owned' : 'Buy', {
            kind: 'primary',
            disabled: !hero || has || (player && (player.resources.gold || 0) < o.cost),
            onClick: () => { if (act(ctx, (s) => townEngine.buyWarMachine(s, townId, o.machineId, hero.id)).ok) ctx.audio.play('coin'); },
          });
          const card = h('div.town-smith-card', { dataset: { machine: o.machineId } },
            ctx.sprite('creature', o.machineId, { size: 96 }),
            h('div.town-smith-name', null, c ? c.name : o.machineId),
            ui.CostView({ gold: o.cost }, player ? player.resources : null), btn);
          ui.attachInfo(card, () => ui.CreatureCard({ creatureId: o.machineId }));
          return card;
        })));
    },
  });
  return handle.result;
}
