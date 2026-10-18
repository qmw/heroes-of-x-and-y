// Map editor pickers: searchable lists with sprites for creatures, artifacts, spells, heroes and skills,
// plus field widgets built on them (single id, id list, creature stacks, skills with levels).
import { CREATURES, CREATURE_BY_ID } from '../../../data/creatures.js';
import { ARTIFACTS, ARTIFACT_BY_ID } from '../../../data/artifacts.js';
import { SPELLS, SPELL_BY_ID } from '../../../data/spells.js';
import { HEROES, HERO_BY_ID } from '../../../data/heroes.js';
import { SKILLS, SKILL_BY_ID } from '../../../data/skills.js';
import { FACTION_BY_ID } from '../../../data/factions.js';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/** Picker entries `{id, name, sub, icon: {kind, id}, search}` of a kind (pure). */
export function pickerItems(kind) {
  let items;
  switch (kind) {
    case 'creature':
      items = CREATURES.filter((c) => !c.warMachine).map((c) => ({ id: c.id, name: c.name, sub: `${cap(c.faction)} - tier ${c.tier}${c.upgraded ? ' (upgraded)' : ''}`, icon: { kind: 'creature', id: c.id } }));
      break;
    case 'artifact':
      items = ARTIFACTS.filter((a) => !a.instanced).map((a) => ({ id: a.id, name: a.name, sub: `${cap(a.class)} - ${a.slot}`, icon: { kind: 'artifact', id: a.id } }));
      break;
    case 'spell':
      items = SPELLS.filter((s) => !s.creatureOnly && !s.special).map((s) => ({ id: s.id, name: s.name, sub: `${cap(s.school)} level ${s.level}`, icon: { kind: 'spell', id: s.id } }));
      break;
    case 'hero':
      items = HEROES.filter((h) => !h.special).map((h) => ({ id: h.id, name: h.name, sub: (FACTION_BY_ID[h.faction] || {}).name || h.faction, icon: { kind: 'portrait', id: h.id } }));
      break;
    case 'skill':
      items = SKILLS.map((s) => ({ id: s.id, name: s.name, sub: '', icon: { kind: 'skill', id: s.id } }));
      break;
    default: items = [];
  }
  for (const e of items) e.search = `${e.name} ${e.id} ${e.sub}`.toLowerCase();
  return items;
}

export function pickerName(kind, id) {
  const by = { creature: CREATURE_BY_ID, artifact: ARTIFACT_BY_ID, spell: SPELL_BY_ID, hero: HERO_BY_ID, skill: SKILL_BY_ID }[kind] || {};
  return (by[id] && by[id].name) || id;
}

export function filterPicker(items, search) {
  const words = String(search || '').toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((e) => words.every((w) => e.search.includes(w)));
}

const ICON_SIZE = 28;

/** Modal picker. Resolves the chosen id or null. */
export function pickDialog(ui, sprite, { kind, title, allowRandom = false } = {}) {
  const { h } = ui;
  const all = [...(allowRandom ? [{ id: 'random', name: 'Random', sub: '', icon: null, search: 'random' }] : []), ...pickerItems(kind)];
  let d = null;
  const list = ui.ScrollList({
    class: 'ed-pick-list', keyOf: (e) => e.id, emptyText: 'Nothing matches.',
    renderItem: (e) => h('div.ed-brow', null, h('span.ed-bthumb', null, e.icon ? sprite(e.icon.kind, e.icon.id, { size: ICON_SIZE }) : '?'),
      h('span.ed-bname', null, e.name), e.sub ? h('span.ed-hint', null, ` ${e.sub}`) : null),
    onActivate: (e) => d.close(e.id),
  });
  const show = (q) => list.setItems(filterPicker(all, q).slice(0, 200));
  const search = ui.TextInput({ placeholder: `Search ${kind}s...`, class: 'ed-search', onInput: show });
  show('');
  d = ui.openDialog({ title: title || `Choose a ${kind}`, content: h('div.ed-pick', null, search, list), class: 'ed-dlg', width: 460, buttons: [
    { label: 'Choose', kind: 'primary', default: true, keep: true, onClick: () => { if (list.selectedItem) d.close(list.selectedItem.id); } },
    { label: 'Cancel', value: null, cancel: true },
  ] });
  if (search.focus) try { search.focus(); } catch { /* fake DOM */ }
  return d.result;
}

/** Field showing one id with its sprite; click to choose. `onChange(id)`. */
export function PickerField(ui, sprite, { kind, value, allowRandom = false, onChange }) {
  const { h } = ui;
  const el = h('div.ed-picker');
  let cur = value;
  const render = () => {
    ui.clear(el,
      cur && cur !== 'random' ? h('span.ed-bthumb', null, sprite(kind === 'hero' ? 'portrait' : kind, cur, { size: 24 })) : null,
      h('span.ed-picker-name', null, cur ? (cur === 'random' ? 'Random' : pickerName(kind, cur)) : 'None'),
      ui.Button('Choose', { size: 'sm', onClick: async () => {
        const id = await pickDialog(ui, sprite, { kind, allowRandom });
        if (id != null) { cur = id; render(); onChange(id); }
      } }));
  };
  render();
  el.dataset.picker = kind;
  return el;
}

/** List of ids (artifacts, spells) with sprites; × removes, "Add" picks. `onChange(ids)`. */
export function PickerListField(ui, sprite, { kind, value, onChange }) {
  const { h } = ui;
  const el = h('div.ed-picker-list');
  let ids = Array.isArray(value) ? value.slice() : [];
  const render = () => {
    ui.clear(el, ids.map((id, i) => h('span.ed-chip', null, h('span.ed-bthumb', null, sprite(kind, id, { size: 20 })), pickerName(kind, id),
      ui.Button('x', { size: 'sm', class: 'ed-chip-x', onClick: () => { ids.splice(i, 1); render(); onChange(ids.slice()); } }))),
    ui.Button('Add', { size: 'sm', onClick: async () => {
      const id = await pickDialog(ui, sprite, { kind });
      if (id != null) { ids.push(id); render(); onChange(ids.slice()); }
    } }));
  };
  render();
  el.dataset.picker = `${kind}s`;
  return el;
}

/** Creature stacks `[{creatureId, count}]` with count inputs. `onChange(stacks)`. */
export function StackListField(ui, sprite, { value, max = 7, onChange }) {
  const { h } = ui;
  const el = h('div.ed-picker-list');
  let stacks = (Array.isArray(value) ? value : []).filter((s) => s && s.creatureId).map((s) => ({ creatureId: s.creatureId, count: s.count || 1 }));
  const render = () => {
    ui.clear(el, stacks.map((s, i) => h('span.ed-chip', null, h('span.ed-bthumb', null, sprite('creature', s.creatureId, { size: 20 })),
      ui.TextInput({ value: String(s.count), width: 52, onInput: (x) => { s.count = Math.max(1, parseInt(x, 10) || 1); onChange(stacks.map((q) => ({ ...q }))); } }),
      pickerName('creature', s.creatureId),
      ui.Button('x', { size: 'sm', class: 'ed-chip-x', onClick: () => { stacks.splice(i, 1); render(); onChange(stacks.map((q) => ({ ...q }))); } }))),
    stacks.length < max ? ui.Button('Add', { size: 'sm', onClick: async () => {
      const id = await pickDialog(ui, sprite, { kind: 'creature' });
      if (id != null) { stacks.push({ creatureId: id, count: 10 }); render(); onChange(stacks.map((q) => ({ ...q }))); }
    } }) : null);
  };
  render();
  el.dataset.picker = 'stacks';
  return el;
}

/** Secondary skills `[{id, level}]` (max 8). `onChange(skills)`. */
export function SkillListField(ui, sprite, { value, onChange }) {
  const { h } = ui;
  const el = h('div.ed-picker-list');
  let skills = (Array.isArray(value) ? value : []).map((s) => ({ id: s.id, level: s.level || 1 }));
  const levels = [{ value: 1, label: 'Basic' }, { value: 2, label: 'Advanced' }, { value: 3, label: 'Expert' }];
  const emit = () => onChange(skills.map((s) => ({ ...s })));
  const render = () => {
    ui.clear(el, skills.map((s, i) => h('span.ed-chip', null, h('span.ed-bthumb', null, sprite('skill', s.id, { size: 20 })), pickerName('skill', s.id),
      ui.Select({ options: levels, value: s.level, onChange: (x) => { s.level = x; emit(); } }),
      ui.Button('x', { size: 'sm', class: 'ed-chip-x', onClick: () => { skills.splice(i, 1); render(); emit(); } }))),
    skills.length < 8 ? ui.Button('Add', { size: 'sm', onClick: async () => {
      const id = await pickDialog(ui, sprite, { kind: 'skill' });
      if (id != null && !skills.some((s) => s.id === id)) { skills.push({ id, level: 1 }); render(); emit(); }
    } }) : null);
  };
  render();
  el.dataset.picker = 'skills';
  return el;
}

/** Inspector control for a picker-typed field spec, or null for other types. */
export function pickerControl(ui, sprite, f, value, onChange) {
  switch (f.type) {
    case 'creature': case 'artifact': case 'spell': case 'hero': return PickerField(ui, sprite, { kind: f.type, value, allowRandom: !!f.allowRandom, onChange });
    case 'artifacts': return PickerListField(ui, sprite, { kind: 'artifact', value, onChange });
    case 'spells': return PickerListField(ui, sprite, { kind: 'spell', value, onChange });
    case 'stacks': return StackListField(ui, sprite, { value, onChange });
    case 'skills': return SkillListField(ui, sprite, { value, onChange });
    default: return null;
  }
}
