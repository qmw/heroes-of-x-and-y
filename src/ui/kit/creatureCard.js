// CreatureCard: the full stat panel of a creature (the original's right-click creature window).
import { h, fmt, humanize } from './dom.js';
import { sprite } from '../sprites.js';
import { StatLine } from './button.js';
import { CostView } from './resourceBar.js';
import { CREATURE_BY_ID } from '../../data/creatures.js';
import { ABILITIES } from '../../data/abilities.js';
import { FACTION_BY_ID } from '../../data/factions.js';

/** Human-readable text of one creature ability entry (pure). */
export function abilityText(entry) {
  const def = ABILITIES[entry.id];
  const name = def ? def.name : humanize(entry.id);
  const params = Object.entries(entry).filter(([k]) => k !== 'id').map(([k, v]) => {
    const val = Array.isArray(v) ? v.map(humanize).join(', ') : typeof v === 'object' && v ? JSON.stringify(v) : typeof v === 'string' ? humanize(v) : v;
    return `${humanize(k).toLowerCase()}: ${val}`;
  });
  return { id: entry.id, name, params: params.join('; '), description: def ? def.description : '', kind: def ? def.kind : '' };
}

/** View-model of a creature card (pure, unit-tested). `stats` overrides base values (combat). */
export function creatureCardModel(creatureId, { count = null, stats = {} } = {}) {
  const c = CREATURE_BY_ID[creatureId];
  if (!c) return null;
  const v = (k) => (stats[k] != null ? stats[k] : c[k]);
  const dmg = (stats.minDamage ?? c.minDamage) === (stats.maxDamage ?? c.maxDamage)
    ? String(v('minDamage')) : `${v('minDamage')}-${v('maxDamage')}`;
  const rows = [
    ['Attack', v('attack'), c.attack], ['Defense', v('defense'), c.defense],
    ...(c.shots > 0 ? [['Shots', v('shots'), c.shots]] : []),
    ['Damage', dmg, null], ['Health', v('hp'), c.hp], ['Speed', v('speed'), c.speed],
  ];
  const faction = FACTION_BY_ID[c.faction];
  return {
    id: c.id, name: c.name, count,
    subtitle: `${faction ? faction.name : 'Neutral'}${c.warMachine ? ' war machine' : ` - tier ${c.tier}${c.upgraded ? ' (upgraded)' : ''}`}`,
    rows: rows.map(([label, value, base]) => ({ label, value, base, changed: base != null && value !== base ? Math.sign(value - base) : 0 })),
    extra: [['Growth', c.growth ? `${c.growth} / week` : '-'], ['AI value', fmt(c.aiValue)]],
    traits: [c.flying && 'Flying', c.shots > 0 && 'Shooter', c.size === 2 && 'Two-hex'].filter(Boolean),
    abilities: c.abilities.map(abilityText).filter((a) => a.name),
    cost: c.cost, upgradeOf: c.upgradeOf, upgradesTo: c.upgradesTo,
  };
}

/**
 * CreatureCard({ creatureId, count?, stats?: {attack, defense, hp, speed, minDamage, maxDamage, shots},
 *                compact?: bool, footer?: Node, onLink?(kind, id) })
 * `stats` lets combat/hero screens show modified values (highlighted green/red against base).
 */
export function CreatureCard(opts = {}) {
  const m = creatureCardModel(opts.creatureId, opts);
  if (!m) return h('div.k-ccard', null, `Unknown creature: ${opts.creatureId}`);
  const link = (id) => {
    const c = CREATURE_BY_ID[id];
    const a = h('span.k-link', null, c ? c.name : id);
    if (opts.onLink) a.addEventListener('click', () => opts.onLink('creature', id));
    return a;
  };
  return h('div.k-ccard', { class: [opts.compact && 'k-ccard-compact', opts.class] },
    h('div.k-ccard-head', null,
      h('div.k-ccard-name', null, m.count != null ? `${fmt(m.count)} ${m.name}` : m.name),
      h('div.k-ccard-sub', null, m.subtitle)),
    h('div.k-ccard-main', null,
      h('div.k-frame.k-ccard-art', null, sprite('creature', m.id, { size: opts.compact ? 80 : 120 })),
      h('div.k-ccard-stats', null,
        m.rows.map((r) => StatLine(r.label, r.value, { class: r.changed > 0 ? 'is-up' : r.changed < 0 ? 'is-down' : '' })),
        opts.compact ? null : m.extra.map(([l, v]) => StatLine(l, v, { class: 'k-stat-minor' })))),
    m.traits.length ? h('div.k-ccard-traits', null, m.traits.map((t) => h('span.k-tag', null, t))) : null,
    m.abilities.length ? h('div.k-ccard-abilities', null, m.abilities.map((a) => h('div.k-ccard-ability', null,
      h('b', null, a.name), a.params ? h('i', null, ` (${a.params})`) : null,
      opts.compact || !a.description ? null : h('span', null, ` - ${a.description}`)))) : null,
    opts.compact ? null : h('div.k-ccard-foot', null,
      h('span', null, 'Cost: ', CostView(m.cost)),
      m.upgradeOf ? h('span', null, ' Upgrade of ', link(m.upgradeOf)) : null,
      m.upgradesTo ? h('span', null, ' Upgrades to ', link(m.upgradesTo)) : null),
    opts.footer || null);
}
