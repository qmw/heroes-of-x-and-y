// Mage Guild: the spells of every built guild level (learning happens automatically when a hero
// with a spell book enters the town), and buying a spell book for the hero in town.
import * as townEngine from '../../../engine/town.js';
import { hasArtifact } from '../../../engine/artifacts.js';
import { SPELL_BY_ID } from '../../../data/spells.js';
import { getFaction } from '../../../data/factions.js';
import { liveDialog, act, serviceHero } from '../town/dialogUtil.js';

export function openMageGuild(ctx, townId) {
  const { ui } = ctx;
  const { h } = ui;
  const handle = liveDialog(ctx, {
    title: 'Mage Guild',
    cls: 'town-guild',
    width: 820,
    render: () => {
      const town = ctx.state.towns[townId];
      const level = townEngine.getMageGuildLevel(town);
      const max = getFaction(town.faction).mageGuildMax;
      const hero = serviceHero(ctx.state, town);
      const needsBook = hero && !hasArtifact(hero, 'spellbook');
      return h('div.town-guild-body', null,
        h('div.town-guild-levels', null, [5, 4, 3, 2, 1].filter((l) => l <= max).map((l) => {
          const spells = l <= level ? (town.mageGuild?.[l - 1] || []) : [];
          return h('div.town-guild-level', { class: l > level && 'is-locked', dataset: { level: l } },
            h('div.town-guild-level-name', null, `Level ${l}`),
            h('div.town-guild-spells', null, l > level ? h('span.town-guild-empty', null, 'Not built')
              : spells.map((id) => {
                const s = SPELL_BY_ID[id];
                const el = h('div.town-guild-spell', { dataset: { spell: id } }, ctx.sprite('spell', id, { size: 48 }),
                  h('div.town-guild-spell-name', null, s ? s.name : id));
                ui.attachTooltip(el, () => (s ? `${s.name} (${s.school}, level ${s.level}, ${s.cost} mana)\n${s.description?.[0] || ''}` : id));
                ui.attachInfo(el, () => spellInfo(ctx, id));
                return el;
              })));
        })),
        h('p.town-guild-note', null, 'Heroes with a spell book learn these spells when they enter the town (as far as their Wisdom allows).'),
        needsBook ? h('div.k-row', null, `${hero.name} has no spell book.`,
          ui.Button('Buy spell book (500 gold)', { kind: 'primary', onClick: () => act(ctx, (s) => townEngine.buySpellbook(s, townId, hero.id)) })) : null);
    },
  });
  return handle.result;
}

/** Spell info popup node. */
export function spellInfo(ctx, spellId, mastery = 0) {
  const { h } = ctx.ui;
  const s = SPELL_BY_ID[spellId];
  if (!s) return h('div', null, spellId);
  return h('div.town-spellinfo', null,
    h('div.town-spellinfo-head', null, ctx.sprite('spell', spellId, { size: 56 }),
      h('div', null, h('b', null, s.name), h('div', null, `${s.school} - level ${s.level} - ${s.kind}`))),
    h('p', null, (s.description && (s.description[mastery] || s.description[0])) || ''));
}
