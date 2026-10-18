// PendingChoiceDialog: generic renderer for an entry of `state.pending` (DESIGN.md §4).
// The default renderer shows title / description / options with icons and resolves with the
// chosen option index. Screen agents register richer renderers per kind:
//
//   registerPendingRenderer('level_up', async (pending, ctx) => {
//     ... build a custom dialog ...
//     return { optionIndex: 1 };              // or just the number; `extra` is passed to resolvePending
//   });
import { h, humanize, fmt } from './dom.js';
import { choose, message } from './dialog.js';
import { CREATURE_BY_ID } from '../../data/creatures.js';
import { ARTIFACT_BY_ID } from '../../data/artifacts.js';
import { SPELL_BY_ID } from '../../data/spells.js';
import { SKILL_BY_ID } from '../../data/skills.js';
import { RESOURCES, PRIMARY_SKILLS } from '../../core/constants.js';

const renderers = new Map();
const LEVELS = ['', 'Basic', 'Advanced', 'Expert'];

/** Register a custom dialog for a pending kind. `fn(pending, ctx) => Promise<{optionIndex, extra?} | number>` */
export function registerPendingRenderer(kind, fn) { renderers.set(kind, fn); }
export function hasPendingRenderer(kind) { return renderers.has(kind); }

/** Best-effort presentation of one option (pure): { label, description, icon } */
export function describeOption(o, index = 0) {
  if (o == null || typeof o !== 'object') return { label: o == null ? `Option ${index + 1}` : humanize(o), description: '', icon: null };
  let icon = o.icon || null;
  let label = o.label || o.name || null;
  let description = o.description || '';
  if (o.skillId && SKILL_BY_ID[o.skillId]) {
    const s = SKILL_BY_ID[o.skillId];
    const lvl = Math.max(1, Math.min(3, o.level || 1));
    icon ||= { kind: 'skill', id: s.id };
    label ||= `${LEVELS[lvl]} ${s.name}`;
    description ||= s.levels[lvl - 1].description;
  } else if (o.creatureId && CREATURE_BY_ID[o.creatureId]) {
    icon ||= { kind: 'creature', id: o.creatureId };
    label ||= `${o.count != null ? `${fmt(o.count)} ` : ''}${CREATURE_BY_ID[o.creatureId].name}`;
  } else if (o.artifactId && ARTIFACT_BY_ID[o.artifactId]) {
    icon ||= { kind: 'artifact', id: o.artifactId };
    label ||= ARTIFACT_BY_ID[o.artifactId].name;
    description ||= ARTIFACT_BY_ID[o.artifactId].description || '';
  } else if (o.spellId && SPELL_BY_ID[o.spellId]) {
    icon ||= { kind: 'spell', id: o.spellId };
    label ||= SPELL_BY_ID[o.spellId].name;
  } else if (o.resource && RESOURCES.includes(o.resource)) {
    icon ||= { kind: 'resource', id: o.resource };
    label ||= `${o.amount != null ? `${fmt(o.amount)} ` : ''}${humanize(o.resource)}`;
  } else if (o.stat && PRIMARY_SKILLS.includes(o.stat)) {
    icon ||= { kind: 'ui', id: `stat_${o.stat}` };
    label ||= `+${o.value ?? 1} ${humanize(o.stat)}`;
  } else if (o.exp != null) {
    icon ||= { kind: 'ui', id: 'experience' };
    label ||= `${fmt(o.exp)} experience`;
  } else if (o.gold != null) {
    icon ||= { kind: 'resource', id: 'gold' };
    label ||= `${fmt(o.gold)} gold`;
  }
  label ||= o.id != null ? humanize(o.id) : `Option ${index + 1}`;
  return { label, description, icon, disabled: !!o.disabled };
}

/** Presentation model of a pending entry (pure, unit-tested). */
export function describePending(pending) {
  const d = pending.data || {};
  return {
    title: pending.title || d.title || humanize(pending.kind || 'Decision'),
    text: pending.description || pending.text || d.description || d.text || d.message || '',
    icon: pending.icon || d.icon || null,
    options: (pending.options || []).map(describeOption),
  };
}

/**
 * Show the dialog for one pending entry.
 * @returns {Promise<{ optionIndex: number, extra?: any }>}
 */
export async function showPending(pending, ctx = null) {
  const custom = renderers.get(pending.kind);
  if (custom) {
    const res = await custom(pending, ctx);
    if (typeof res === 'number') return { optionIndex: res };
    if (res && typeof res === 'object') return { optionIndex: res.optionIndex ?? 0, extra: res.extra };
    return { optionIndex: 0 };
  }
  const m = describePending(pending);
  if (m.options.length === 0) {
    await message(m.text || m.title, { title: m.title, icon: m.icon });
    return { optionIndex: 0 };
  }
  const index = await choose({
    title: m.title, text: m.text, icon: m.icon, cancellable: false,
    options: m.options.map((o, i) => ({ ...o, value: i })),
  });
  return { optionIndex: index ?? 0 };
}

/** Alias kept for discoverability: the widget name used in the design brief. */
export const PendingChoiceDialog = showPending;

/** Small helper for custom renderers: a titled block of text + nodes. */
export function pendingBody(text, ...nodes) {
  return h('div.k-pending', null, text ? h('p', null, text) : null, nodes);
}
