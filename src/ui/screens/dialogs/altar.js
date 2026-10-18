// Altar of sacrifice (Cove Grotto): sacrifice creatures (hp x count experience) or artifacts
// (half their value) for the hero in town.
import * as townEngine from '../../../engine/town.js';
import { getTownEffects } from '../../../engine/town.js';
import { armyStackCount } from '../../../engine/army.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { liveDialog, act, serviceHero } from '../town/dialogUtil.js';
import { sellableArtifacts } from './artifactMerchant.js';

export function openAltar(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  const counts = {};
  const handle = liveDialog(ctx, {
    title: 'Altar of Sacrifice',
    cls: 'town-altar',
    width: 860,
    render: () => {
      const town = ctx.state.towns[townId];
      const eff = getTownEffects(town, 'sacrifice_altar')[0]?.effect || { creatures: true, artifacts: true };
      const hero = serviceHero(ctx.state, town);
      if (!hero) return h('p', null, 'A hero must be in the town to receive the experience.');
      const where = town.visitingHero === hero.id ? 'visiting' : 'garrison';
      const stacks = hero.army.map((s, slot) => (s ? { ...s, slot } : null)).filter(Boolean);
      const creatures = () => h('div.town-altar-grid', null, stacks.map((s) => {
        const c = CREATURE_BY_ID[s.creatureId];
        const lastStack = armyStackCount(hero.army) <= 1;
        const max = lastStack ? s.count - 1 : s.count;
        counts[s.slot] = Math.min(counts[s.slot] ?? max, max);
        const exp = h('span.town-altar-exp');
        const setExp = () => { exp.textContent = `${(c ? c.hp : 0) * (counts[s.slot] || 0)} exp`; };
        const stepper = ui.NumberStepper({ min: 0, max: Math.max(0, max), value: counts[s.slot], bigStep: 10, onChange: (v) => { counts[s.slot] = v; setExp(); } });
        setExp();
        return h('div.town-altar-card', { dataset: { slot: s.slot } },
          ctx.sprite('creature', s.creatureId, { size: 64 }),
          h('div', null, `${s.count} ${c ? c.name : s.creatureId}`), stepper, exp,
          ui.Button('Sacrifice', { size: 'sm', kind: 'danger', disabled: max < 1, onClick: () => {
            const n = counts[s.slot];
            if (n > 0) act(ctx, (st) => townEngine.sacrificeCreatures(st, townId, { where, slot: s.slot, count: n, heroId: hero.id }));
          } }));
      }));
      const artifacts = () => {
        if (town.visitingHero !== hero.id) return h('p', null, 'Only a visiting hero can sacrifice artifacts.');
        const list = sellableArtifacts(hero);
        if (!list.length) return h('p', null, 'No artifacts to sacrifice.');
        return h('div.town-altar-grid', null, list.map((a) => h('div.town-altar-card', { dataset: { artifact: a.id } },
          ctx.sprite('artifact', a.id, { size: 56 }), h('div', null, ui.artifactEntryName(a.entry)),
          h('div', null, `${Math.floor(a.value / 2)} exp`),
          ui.Button('Sacrifice', { size: 'sm', kind: 'danger', onClick: () => act(ctx, (st) => townEngine.sacrificeArtifact(st, townId, a.ref)) }))));
      };
      const tabs = [];
      if (eff.creatures) tabs.push({ id: 'creatures', label: 'Creatures', content: creatures });
      if (eff.artifacts) tabs.push({ id: 'artifacts', label: 'Artifacts', content: artifacts });
      return h('div.town-altar-body', null, h('p', null, `${hero.name}: level ${hero.level}, ${hero.exp} experience.`), ui.Tabs({ tabs }));
    },
  });
  return handle.result;
}
