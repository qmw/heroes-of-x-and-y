// Spell book window of a hero: browse spells by school / kind, cost at the hero's mastery,
// descriptions; on the adventure map adventure spells can be cast from here.
import { getHeroSpells } from '../../../engine/hero.js';
import { getSchoolMastery, getMaxMana } from '../../../engine/bonuses.js';
import { hasArtifact } from '../../../engine/artifacts.js';
import { SPELL_BY_ID, castingMastery, spellCost } from '../../../data/spells.js';
import { act, ensureDialogCss } from '../town/dialogUtil.js';

/** Spells that need a map target picked by the adventure screen (pure). */
export function spellNeedsTarget(spellId) {
  const s = SPELL_BY_ID[spellId];
  return !!s && s.kind === 'adventure' && s.effect && s.effect.action === 'dimension_door';
}

/**
 * Open the spell book.
 * @param {object} ctx
 * @param {string} heroId
 * @param {{ allowCast?: boolean, kind?: 'all'|'combat'|'adventure', onCast?: (spellId) => any }} [opts]
 *   allowCast: adventure spells are cast through `adventure.castAdventureSpell` (only when the
 *   caller is the adventure map / a hero screen opened from it).
 * @returns {Promise<null | { spellId, result?, needsTarget?: true }>} null when closed without casting.
 *   `needsTarget`: Dimension Door etc. - the caller must pick the target tile and cast itself.
 */
export function openSpellbook(ctx, heroId, opts = {}) {
  const { ui } = ctx;
  const { h } = ui;
  ensureDialogCss(ui);
  const hero = ctx.state.heroes[heroId];
  if (!hero) return Promise.resolve(null);
  if (!hasArtifact(hero, 'spellbook')) {
    return ui.message(`${hero.name} has no spell book.`, { title: 'Spell book' }).then(() => null);
  }
  const adventure = ctx.engine && ctx.engine.adventure;
  const mastery = getSchoolMastery(ctx.state, hero);
  const costOf = (s) => {
    if (adventure && adventure.getAdventureSpellCost && s.kind === 'adventure') {
      try { return adventure.getAdventureSpellCost(ctx.state, hero, s); } catch { /* fall through */ }
    }
    return spellCost(s, castingMastery(s, mastery));
  };
  let outcome = null;
  const info = h('div.hero-book-info', null, 'Pick a spell to read about it.');
  const view = ui.SpellbookView({
    spells: getHeroSpells(ctx.state, hero),
    mana: opts.allowCast ? hero.mana : null,   // browsing: every spell stays clickable for its description
    mastery,
    kind: opts.kind || (opts.allowCast ? 'adventure' : 'all'),
    costOf,
    canCast: (s) => (opts.allowCast && s.kind !== 'adventure' ? 'Combat spells are cast in battle' : true),
    onSelect: (id) => select(id),
  });
  const d = ui.openDialog({
    title: `${hero.name}'s spell book - mana ${hero.mana} / ${getMaxMana(ctx.state, hero)}`,
    class: 'town-dlg hero-book-dlg',
    width: 980,
    content: h('div.hero-book', null, view, info),
    buttons: [{ label: 'Close', value: null, default: true, cancel: true }],
  });

  async function select(id) {
    const s = SPELL_BY_ID[id];
    const m = castingMastery(s, mastery);
    ui.clear(info, h('b', null, s.name), h('div', null, `${s.school} - level ${s.level} - ${costOf(s)} mana`),
      h('p', null, (s.description && (s.description[m] || s.description[0])) || ''));
    if (!opts.allowCast || s.kind !== 'adventure') return;
    if (spellNeedsTarget(id)) { outcome = { spellId: id, needsTarget: true }; d.close(outcome); return; }
    if (opts.onCast) { outcome = { spellId: id, result: await opts.onCast(id) }; d.close(outcome); return; }
    const adv = adventure || (ctx.engine && (await ctx.engine.load('adventure')));
    if (!adv || !adv.castAdventureSpell) { ctx.toast('Adventure spells are not available.', 'warn'); return; }
    const result = act(ctx, (st) => adv.castAdventureSpell(st, heroId, id));
    if (result && result.ok !== false) {
      ctx.audio.play('spell');
      outcome = { spellId: id, result };
      d.close(outcome);
    }
  }
  const p = d.result.then(() => outcome);
  p.handle = d;
  p.view = view;
  p.select = select;
  return p;
}
