// Hero-related widgets: HeroPortrait, HeroCard, PrimaryStats, MoraleLuckPips, SkillIcon.
import { h, clear, fmt, humanize, signed } from './dom.js';
import { sprite } from '../sprites.js';
import { attachTooltip } from './tooltip.js';
import { ProgressBar } from './widgets.js';
import { HERO_BY_ID } from '../../data/heroes.js';
import { HERO_CLASS_BY_ID } from '../../data/heroClasses.js';
import { SKILL_BY_ID } from '../../data/skills.js';
import { PRIMARY_SKILLS } from '../../core/constants.js';

export const SKILL_LEVEL_NAMES = ['', 'Basic', 'Advanced', 'Expert'];
export const PRIMARY_LABELS = { attack: 'Attack', defense: 'Defense', power: 'Spell Power', knowledge: 'Knowledge' };

/**
 * HeroPortrait({ defId | hero, size = 58, playerColor?, selected?, badge?: string|number,
 *                onClick?, tooltip? })
 * API: .setSelected(bool), .setBadge(text)
 */
export function HeroPortrait(opts = {}) {
  const defId = opts.defId || (opts.hero && opts.hero.defId) || null;
  const def = HERO_BY_ID[defId];
  const size = opts.size || 58;
  const badge = h('span.k-portrait-badge', null, opts.badge != null ? String(opts.badge) : '');
  const el = h('div.k-portrait', {
    class: [opts.selected && 'is-selected', opts.onClick && 'is-clickable', opts.class],
    dataset: { hero: defId || '' },
    style: { width: size, height: size, '--player-color': opts.playerColor ? `var(--pc-${opts.playerColor}, ${opts.playerColor})` : undefined },
  },
  defId ? sprite('portrait', defId, { size, playerColor: opts.playerColor }) : h('div.k-portrait-empty', null, '?'),
  badge);
  if (opts.badge == null) badge.style.display = 'none';
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  const tip = opts.tooltip ?? (def ? `${opts.hero?.name || def.name}, ${HERO_CLASS_BY_ID[def.classId]?.name || ''}` : null);
  if (tip) attachTooltip(el, tip);
  el.setSelected = (s) => el.classList.toggle('is-selected', !!s);
  el.setBadge = (t) => { badge.textContent = t == null ? '' : String(t); badge.style.display = t == null ? 'none' : ''; };
  return el;
}

/**
 * PrimaryStats({ attack, defense, power, knowledge }, { base?: same shape (to colour bonuses),
 *               layout: 'row' | 'column' | 'grid' })
 * API: .update(values, base?)
 */
export function PrimaryStats(values = {}, opts = {}) {
  const el = h('div.k-primary', { class: [`k-primary-${opts.layout || 'row'}`, opts.class] });
  el.update = (vals = {}, base = opts.base) => {
    clear(el, PRIMARY_SKILLS.map((s) => {
      const v = vals[s] ?? 0;
      const b = base ? base[s] ?? 0 : v;
      const cell = h('div.k-primary-cell', { dataset: { stat: s }, class: v > b ? 'is-up' : v < b ? 'is-down' : '' },
        sprite('ui', `stat_${s}`, { size: opts.iconSize || 26 }), h('span.k-primary-value', null, String(v)));
      attachTooltip(cell, v !== b ? `${PRIMARY_LABELS[s]}: ${v} (${b} ${signed(v - b)})` : `${PRIMARY_LABELS[s]}: ${v}`);
      return cell;
    }));
  };
  el.update(values);
  return el;
}

/** Text describing a morale / luck value (pure). */
export function moraleLuckText(kind, value) {
  const names = kind === 'morale'
    ? { neg: 'Bad morale', zero: 'Neutral morale', pos: 'Good morale' }
    : { neg: 'Bad luck', zero: 'Neutral luck', pos: 'Good luck' };
  const v = Math.max(-3, Math.min(3, value || 0));
  return `${v < 0 ? names.neg : v > 0 ? names.pos : names.zero} (${signed(value || 0)})`;
}

/**
 * MoraleLuckPips({ morale, luck, moraleDetails?: string[], luckDetails?: string[] })
 * Shows up to 3 pips per stat, gold for positive and red for negative.
 * API: .update({ morale, luck, moraleDetails, luckDetails })
 */
export function MoraleLuckPips(opts = {}) {
  const el = h('div.k-ml', { class: opts.class });
  let cur = {};
  el.update = (u = {}) => {
    cur = { ...cur, ...u };
    clear(el, ['morale', 'luck'].map((kind) => {
      const value = cur[kind] || 0;
      const n = Math.min(3, Math.abs(value));
      const cell = h('div.k-ml-cell', { class: [`k-ml-${kind}`, value > 0 ? 'is-pos' : value < 0 ? 'is-neg' : 'is-zero'], dataset: { kind, value } },
        sprite('ui', value < 0 ? `${kind}_bad` : `${kind}_good`, { size: 22 }),
        h('span.k-ml-pips', null, [0, 1, 2].map((i) => h('i.k-pip', { class: i < n && 'is-on' }))));
      const details = cur[`${kind}Details`];
      attachTooltip(cell, [moraleLuckText(kind, value), ...(details || [])].join('\n'));
      return cell;
    }));
  };
  el.update({ morale: opts.morale, luck: opts.luck, moraleDetails: opts.moraleDetails, luckDetails: opts.luckDetails });
  return el;
}

/**
 * SkillIcon({ id, level = 1 (1..3), size = 44, showLabel?: bool, onClick? })
 * Tooltip: the skill's description for that level.
 */
export function SkillIcon(opts = {}) {
  const skill = SKILL_BY_ID[opts.id];
  const level = Math.max(1, Math.min(3, opts.level || 1));
  const size = opts.size || 44;
  const name = skill ? skill.name : humanize(opts.id);
  const el = h('div.k-skill', { class: [opts.showLabel && 'k-skill-labelled', opts.onClick && 'is-clickable', opts.class], dataset: { skill: opts.id, level } },
    h('div.k-skill-icon', { style: { width: size, height: size } },
      sprite('skill', opts.id, { size, variant: level }),
      h('span.k-skill-level', null, 'I'.repeat(level))),
    opts.showLabel ? h('div.k-skill-label', null, h('div.k-skill-rank', null, SKILL_LEVEL_NAMES[level]), h('div.k-skill-name', null, name)) : null);
  attachTooltip(el, () => (skill ? `${SKILL_LEVEL_NAMES[level]} ${name}\n${skill.levels[level - 1].description}` : name));
  if (opts.onClick) el.addEventListener('click', () => opts.onClick(opts.id, level));
  return el;
}

/** Summary view-model of a runtime hero or a hero definition id (pure). */
export function heroCardModel({ hero = null, defId = null, primary = null } = {}) {
  const def = HERO_BY_ID[hero ? hero.defId : defId];
  const cls = HERO_CLASS_BY_ID[hero ? hero.classId || def?.classId : def?.classId];
  if (!def && !hero) return null;
  return {
    defId: def ? def.id : null,
    name: hero?.name || def?.name || '?',
    className: cls ? cls.name : '',
    level: hero ? hero.level || 1 : 1,
    title: hero ? `Level ${hero.level || 1} ${cls ? cls.name : ''}`.trim() : cls ? cls.name : '',
    primary: primary || hero?.primary || cls?.startPrimary || { attack: 0, defense: 0, power: 0, knowledge: 0 },
    basePrimary: hero?.primary || null,
    specialty: def?.specialty?.description || '',
    skills: hero ? hero.skills || [] : def?.startSkills || [],
    mana: hero ? hero.mana : null,
    movePoints: hero ? hero.movePoints : null,
    maxMovePoints: hero ? hero.maxMovePoints : null,
    exp: hero ? hero.exp : null,
  };
}

/**
 * HeroCard({ hero? (runtime Hero), defId? (definition), primary?: computed stats incl. bonuses,
 *            maxMana?, playerColor?, compact?, onClick?, showSkills? })
 * Summary panel: portrait, name, class/level, primary stats, mana + movement bars, skills.
 */
export function HeroCard(opts = {}) {
  const m = heroCardModel(opts);
  if (!m) return h('div.k-hcard', null, 'No hero');
  const el = h('div.k-hcard', { class: [opts.compact && 'k-hcard-compact', opts.onClick && 'is-clickable', opts.class] },
    HeroPortrait({ defId: m.defId, size: opts.compact ? 46 : 64, playerColor: opts.playerColor }),
    h('div.k-hcard-info', null,
      h('div.k-hcard-name', null, m.name),
      h('div.k-hcard-title', null, m.title),
      PrimaryStats(m.primary, { base: m.basePrimary, iconSize: opts.compact ? 18 : 22 }),
      m.mana != null && !opts.compact ? ProgressBar({ value: m.mana, max: opts.maxMana || Math.max(m.mana, 1), color: 'mana', label: `Mana ${m.mana}${opts.maxMana ? ` / ${opts.maxMana}` : ''}` }) : null,
      m.movePoints != null && !opts.compact ? ProgressBar({ value: m.movePoints, max: m.maxMovePoints || Math.max(m.movePoints, 1), color: 'move', label: `Movement ${fmt(m.movePoints)}` }) : null,
      m.specialty && !opts.compact ? h('div.k-hcard-spec', null, m.specialty) : null),
    opts.showSkills && m.skills.length ? h('div.k-hcard-skills', null, m.skills.map((s) => SkillIcon({ id: s.id, level: s.level, size: 30 }))) : null);
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}
