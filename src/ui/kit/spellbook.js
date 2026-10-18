// SpellbookView: spells paged by school and level, with mana costs; click to select.
import { h, clear } from './dom.js';
import { sprite } from '../sprites.js';
import { attachTooltip } from './tooltip.js';
import { playClick } from './button.js';
import { SPELL_BY_ID, spellCost, castingMastery, spellSchools } from '../../data/spells.js';
import { SPELL_SCHOOLS } from '../../core/constants.js';

export const SCHOOL_NAMES = { all: 'All schools', air: 'Air', earth: 'Earth', fire: 'Fire', water: 'Water' };
export const MASTERY_NAMES = ['None', 'Basic', 'Advanced', 'Expert'];

/**
 * Filter + sort + page a spell list (pure, unit-tested).
 * @param {string[]} spellIds
 * @param {{ school?: 'all'|'air'|'earth'|'fire'|'water', kind?: 'all'|'combat'|'adventure', perPage?: number }} o
 * @returns {string[][]} pages of spell ids, sorted by level then name (always at least one page)
 */
export function spellbookPages(spellIds, { school = 'all', kind = 'all', perPage = 12 } = {}) {
  const list = [...new Set(spellIds || [])].map((id) => SPELL_BY_ID[id]).filter(Boolean)
    .filter((s) => kind === 'all' || s.kind === kind)
    .filter((s) => school === 'all' || spellSchools(s).includes(school))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const pages = [];
  for (let i = 0; i < list.length; i += perPage) pages.push(list.slice(i, i + perPage).map((s) => s.id));
  return pages.length ? pages : [[]];
}

/**
 * SpellbookView({
 *   spells: [spellId], mana?: number,
 *   mastery?: { air, earth, fire, water } (0..3)          // school mastery levels of the caster
 *   kind?: 'all' | 'combat' | 'adventure' (initial filter), lockKind?: bool (hide the kind switch),
 *   costOf?(spell) => number                               // override (engine-computed cost)
 *   canCast?(spell) => true | string                       // string = reason shown in the tooltip
 *   onSelect(spellId), perPage = 12 })
 * API: .update({ spells?, mana?, mastery? }), .setSchool(id), .setKind(kind), .page, .pages
 */
export function SpellbookView(opts = {}) {
  let spells = opts.spells || [];
  let mana = opts.mana ?? null;
  let mastery = opts.mastery || {};
  let school = opts.school || 'all';
  let kind = opts.kind || 'all';
  const perPage = opts.perPage || 12;
  const grid = h('div.k-book-grid');
  const pageLabel = h('span.k-book-page');
  const manaLabel = h('span.k-book-mana');
  const prev = h('button.k-btn.k-book-nav', { type: 'button' }, '<');
  const next = h('button.k-btn.k-book-nav', { type: 'button' }, '>');
  const schoolTabs = h('div.k-book-schools');
  const kindTabs = h('div.k-book-kinds');
  const el = h('div.k-book', { class: opts.class },
    h('div.k-book-side', null, schoolTabs, opts.lockKind ? null : kindTabs),
    h('div.k-book-main', null, grid, h('div.k-book-foot', null, prev, pageLabel, next, manaLabel)));
  el.page = 0;
  el.pages = [[]];

  const costOf = (s) => (opts.costOf ? opts.costOf(s) : spellCost(s, castingMastery(s, mastery)));

  function tab(container, id, label, isActive, onPick, icon) {
    const b = h('button.k-tab', { type: 'button', class: isActive && 'is-active', dataset: { id } }, icon || null, h('span', null, label));
    b.addEventListener('click', () => { playClick('click'); onPick(id); });
    container.appendChild(b);
  }

  function render() {
    clear(schoolTabs);
    for (const s of ['all', ...SPELL_SCHOOLS]) {
      tab(schoolTabs, s, SCHOOL_NAMES[s], s === school, el.setSchool, s === 'all' ? null : sprite('ui', `school_${s}`, { size: 18 }));
    }
    clear(kindTabs);
    for (const k of ['all', 'combat', 'adventure']) tab(kindTabs, k, k[0].toUpperCase() + k.slice(1), k === kind, el.setKind);
    el.pages = spellbookPages(spells, { school, kind, perPage });
    el.page = Math.max(0, Math.min(el.page, el.pages.length - 1));
    const ids = el.pages[el.page];
    clear(grid, ids.length ? ids.map(card) : h('div.k-book-empty', null, spells.length ? 'No spells on this page.' : 'The spell book is empty.'));
    pageLabel.textContent = `Page ${el.page + 1} / ${el.pages.length}`;
    manaLabel.textContent = mana != null ? `Mana: ${mana}` : '';
    prev.disabled = el.page <= 0;
    next.disabled = el.page >= el.pages.length - 1;
  }

  function card(id) {
    const s = SPELL_BY_ID[id];
    const cost = costOf(s);
    const m = castingMastery(s, mastery);
    let ok = opts.canCast ? opts.canCast(s) : true;
    if (ok === true && mana != null && cost > mana) ok = 'Not enough mana';
    const c = h('div.k-book-spell', { class: ok !== true && 'is-disabled', dataset: { spell: id } },
      sprite('spell', id, { size: 52 }),
      h('div.k-book-spell-name', null, s.name),
      h('div.k-book-spell-meta', null, `Lv ${s.level} - ${cost} mana`));
    attachTooltip(c, () => [`${s.name} (${SCHOOL_NAMES[s.school] || s.school}, level ${s.level})`,
      `${MASTERY_NAMES[m]} mastery - ${cost} mana`, s.description[m] || s.description[0] || '',
      ok !== true && typeof ok === 'string' ? `Cannot cast: ${ok}` : ''].filter(Boolean).join('\n'));
    c.addEventListener('click', () => {
      if (ok !== true) return;
      playClick('click');
      if (opts.onSelect) opts.onSelect(id);
    });
    return c;
  }

  prev.addEventListener('click', () => { if (el.page > 0) { el.page--; render(); } });
  next.addEventListener('click', () => { if (el.page < el.pages.length - 1) { el.page++; render(); } });
  el.setSchool = (s) => { school = s; el.page = 0; render(); };
  el.setKind = (k) => { kind = k; el.page = 0; render(); };
  el.update = (u = {}) => {
    if (u.spells) spells = u.spells;
    if (u.mana !== undefined) mana = u.mana;
    if (u.mastery) mastery = u.mastery;
    render();
  };
  render();
  return el;
}
