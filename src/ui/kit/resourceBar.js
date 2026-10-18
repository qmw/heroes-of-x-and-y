// ResourceBar: the 7 resources + the date, as in the bottom bar of the adventure screen.
import { h, fmt, signed } from './dom.js';
import { sprite } from '../sprites.js';
import { attachTooltip } from './tooltip.js';
import { RESOURCES } from '../../core/constants.js';

/** { day, week, month } -> "Month 1, Week 2, Day 3" */
export function dateText(date) {
  if (!date) return '';
  return `Month ${date.month}, Week ${date.week}, Day ${date.day}`;
}

/** { gold: 1000, wood: 2 } -> inline cost element with icons. `have` (Resources) marks unaffordable entries. */
export function CostView(cost, have = null, opts = {}) {
  const entries = RESOURCES.filter((r) => cost && cost[r]);
  const el = h('span.k-cost', { class: opts.class });
  if (!entries.length) el.appendChild(h('span.k-cost-free', null, opts.freeText ?? 'Free'));
  for (const r of entries) {
    const short = have && (have[r] || 0) < cost[r];
    el.appendChild(h('span.k-cost-item', { class: short && 'is-short', title: r },
      sprite('resource', r, { size: opts.size || 18 }), h('span', null, fmt(cost[r]))));
  }
  return el;
}

/**
 * ResourceBar({ resources, date, income?, onClick?(resourceId) })
 * API: .update({ resources?, date?, income? })
 */
export function ResourceBar(opts = {}) {
  const cells = {};
  const dateEl = h('div.k-resbar-date');
  const el = h('div.k-resbar', { class: opts.class });
  let income = opts.income || null;
  for (const r of RESOURCES) {
    const value = h('span.k-resbar-value', null, '0');
    const cell = h('div.k-resbar-cell', { dataset: { resource: r } }, sprite('resource', r, { size: 22 }), value);
    attachTooltip(cell, () => {
      const name = r[0].toUpperCase() + r.slice(1);
      return income && income[r] ? `${name} (${signed(income[r])} per day)` : name;
    });
    if (opts.onClick) cell.addEventListener('click', () => opts.onClick(r));
    cells[r] = value;
    el.appendChild(cell);
  }
  el.appendChild(dateEl);
  el.update = (u = {}) => {
    if (u.income !== undefined) income = u.income;
    if (u.resources) for (const r of RESOURCES) cells[r].textContent = fmt(u.resources[r] || 0);
    if (u.date) dateEl.textContent = dateText(u.date);
  };
  el.update({ resources: opts.resources || {}, date: opts.date });
  return el;
}
