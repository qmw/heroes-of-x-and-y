// Level-up dialog: custom renderer of the `level_up` pending (hero engine). Layout follows the
// original: portrait, "X is now a level N <class>", the primary skill gained, and the secondary
// skill choices as two big icons (pick one, then OK).
import { registerPendingRenderer } from '../../kit/pending.js';
import { SKILL_BY_ID } from '../../../data/skills.js';
import { getPrimary } from '../../../engine/bonuses.js';
import { heroTitle, PRIMARY_NAMES, SKILL_LEVEL_NAMES } from './heroModel.js';
import { ensureDialogCss } from '../town/dialogUtil.js';

/** Presentation model of a level_up pending (pure). */
export function levelUpModel(pending, state) {
  const hero = state && state.heroes ? state.heroes[pending.heroId] : null;
  const level = (pending.data && pending.data.level) || (hero ? hero.level : null);
  const primary = pending.data && pending.data.primary;
  return {
    heroName: hero ? hero.name : 'Your hero',
    title: hero ? heroTitle({ ...hero, level }) : `Level ${level}`,
    level,
    primary: primary ? { stat: primary, label: `+1 ${PRIMARY_NAMES[primary] || primary}` } : null,
    options: (pending.options || []).map((o) => {
      const s = SKILL_BY_ID[o.skillId];
      const lvl = Math.max(1, Math.min(3, o.level || 1));
      return {
        skillId: o.skillId, level: lvl,
        label: `${SKILL_LEVEL_NAMES[lvl]} ${s ? s.name : o.skillId}`,
        description: s ? s.levels[lvl - 1].description : '',
        upgrade: !!(hero && hero.skills.some((k) => k.id === o.skillId)),
      };
    }),
  };
}

/**
 * Show the dialog; resolves `{ optionIndex }`. `pending` is a `level_up` entry of state.pending.
 * The returned promise carries `.handle` (dialog) and `.pick(i)` for tests.
 */
export function showLevelUp(pending, ctx) {
  const { ui } = ctx;
  const { h } = ui;
  ensureDialogCss(ui);
  const state = ctx.state;
  const hero = state.heroes[pending.heroId];
  const m = levelUpModel(pending, state);
  let selected = m.options.length === 1 ? 0 : -1;
  const cards = m.options.map((o, i) => {
    const card = h('button.hero-lvl-choice', { type: 'button', dataset: { index: i, skill: o.skillId }, class: i === selected && 'is-selected' },
      ui.SkillIcon({ id: o.skillId, level: o.level, size: 72 }),
      h('div.hero-lvl-choice-label', null, o.label),
      h('div.hero-lvl-choice-desc', null, o.description));
    card.addEventListener('click', () => pick(i));
    card.addEventListener('dblclick', () => { pick(i); d.close(i); });
    return card;
  });
  const primary = hero ? getPrimary(state, hero) : null;
  const content = h('div.hero-lvl', null,
    h('div.hero-lvl-top', null,
      hero ? ui.HeroPortrait({ hero, size: 80 }) : null,
      h('div.hero-lvl-text', null,
        h('div.hero-lvl-name', null, `${m.heroName} has gained a level.`),
        h('div', null, `${m.heroName} is now a ${m.title}.`),
        m.primary ? h('div.hero-lvl-primary', null, ctx.sprite('ui', `stat_${m.primary.stat}`, { size: 36 }), m.primary.label) : null,
        primary ? ui.PrimaryStats(primary, { base: hero.primary, iconSize: 22 }) : null)),
    m.options.length ? h('div.hero-lvl-pick', null, m.options.length > 1 ? 'Choose a secondary skill:' : 'You learn a secondary skill:') : null,
    h('div.hero-lvl-choices', null, cards));
  const d = ui.openDialog({
    title: 'Level Up',
    class: 'town-dlg hero-lvl-dlg',
    width: 620,
    content,
    dismissable: false,
    buttons: [{ label: 'OK', kind: 'primary', default: true, disabled: selected < 0 && m.options.length > 0, value: () => Math.max(0, selected) }],
    onKey: (key) => { const n = Number(key); if (n >= 1 && n <= cards.length) pick(n - 1); },
  });
  ctx.audio && ctx.audio.play('levelup');
  function pick(i) {
    selected = i;
    cards.forEach((c, j) => c.classList.toggle('is-selected', j === i));
    d.setButtonDisabled(0, false);
  }
  const p = d.result.then((v) => ({ optionIndex: typeof v === 'number' ? v : Math.max(0, selected) }));
  p.handle = d;
  p.pick = pick;
  return p;
}

registerPendingRenderer('level_up', (pending, ctx) => showLevelUp(pending, ctx));
