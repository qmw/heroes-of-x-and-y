// Map editor dialogs: New map, Random map, Open (library + import), Map settings, Validate, Play.
// All return promises; they never mutate the document themselves except through the engine API
// passed in (docs/mechanics/editor.md §5).
import * as E from '../../../engine/editor/index.js';
import { FACTIONS_DATA } from '../../../data/factions.js';
import { TERRAIN_DATA } from '../../../data/terrain.js';
import { PLAYER_COLORS } from '../../../core/constants.js';
import * as M from './model.js';
import { StackListField } from './pickers.js';

const SIZES = ['S', 'M', 'L', 'XL', 'H', 'XH', 'G'];
const DIFFS = ['Easy', 'Normal', 'Hard', 'Expert', 'Impossible'];

/** New blank map. Resolves `{size, levels, terrain, players, name}` or null. */
export function newMapDialog(ui) {
  const { h } = ui;
  const v = { size: 'M', levels: 1, terrain: 'grass', players: 2, name: 'New map' };
  const content = h('div.ed-form', null,
    ui.Field('Name', ui.TextInput({ value: v.name, maxLength: 60, onInput: (x) => { v.name = x; } })),
    ui.Field('Size', ui.Select({ options: SIZES.map((s) => ({ value: s, label: `${s} (${E.EDITOR_SIZES[s]} x ${E.EDITOR_SIZES[s]})` })), value: v.size, onChange: (x) => { v.size = x; } })),
    ui.Field('Levels', ui.Checkbox({ label: 'Underground level', checked: false, onChange: (x) => { v.levels = x ? 2 : 1; } })),
    ui.Field('Terrain', ui.Select({ options: TERRAIN_DATA.filter((t) => t.surface && t.passable).map((t) => ({ value: t.id, label: t.name })), value: v.terrain, onChange: (x) => { v.terrain = x; } })),
    ui.Field('Players', ui.Select({ options: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) })), value: v.players, onChange: (x) => { v.players = x; } })));
  const d = ui.openDialog({ title: 'New map', content, class: 'ed-dlg', buttons: [
    { label: 'Create', value: true, kind: 'primary', default: true },
    { label: 'Cancel', value: null, cancel: true },
  ] });
  return d.result.then((ok) => (ok ? v : null));
}

/** Random map options for mapgen. Resolves options or null. */
export function randomMapDialog(ui, templates = []) {
  const { h } = ui;
  const v = { size: 'S', players: 2, levels: 1, water: 'none', monsters: 'normal', template: 'default', seed: Math.floor(Math.random() * 99999) + 1 };
  const content = h('div.ed-form', null,
    ui.Field('Size', ui.Select({ options: SIZES.slice(0, 4).map((s) => ({ value: s, label: s })), value: v.size, onChange: (x) => { v.size = x; } })),
    ui.Field('Players', ui.Select({ options: [2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) })), value: v.players, onChange: (x) => { v.players = x; } })),
    ui.Field('Levels', ui.Checkbox({ label: 'Underground level', checked: false, onChange: (x) => { v.levels = x ? 2 : 1; } })),
    ui.Field('Water', ui.Select({ options: ['none', 'normal', 'islands'].map((w) => ({ value: w, label: w })), value: v.water, onChange: (x) => { v.water = x; } })),
    ui.Field('Monsters', ui.Select({ options: ['weak', 'normal', 'strong', 'none'].map((w) => ({ value: w, label: w })), value: v.monsters, onChange: (x) => { v.monsters = x; } })),
    templates.length ? ui.Field('Template', ui.Select({ options: templates.map((t) => ({ value: t.id, label: t.name || t.id })), value: v.template, onChange: (x) => { v.template = x; } })) : null,
    ui.Field('Seed', ui.TextInput({ value: String(v.seed), width: 120, onChange: (x) => { v.seed = Math.abs(parseInt(x, 10)) || 1; } })));
  const d = ui.openDialog({ title: 'Start from a random map', content, class: 'ed-dlg', buttons: [
    { label: 'Generate', value: true, kind: 'primary', default: true },
    { label: 'Cancel', value: null, cancel: true },
  ] });
  return d.result.then((ok) => (ok ? v : null));
}

/**
 * Library browser. Resolves `{action: 'open'|'import', id?, text?, name?}` or null.
 * Delete / export happen inside (through `library` / `onExport`).
 */
export function openMapDialog(ui, library, { onExport } = {}) {
  const { h } = ui;
  let sel = null;
  const detail = h('div.ed-open-detail');
  const fileInput = h('input', { type: 'file', style: { display: 'none' } });
  fileInput.accept = '.json,application/json';
  const list = ui.ScrollList({
    class: 'ed-open-list', items: library.list(), keyOf: (m) => m.id, emptyText: 'No saved maps yet.',
    renderItem: (m) => h('div.ed-open-row', null, h('div.ed-open-name', null, m.name), h('div.ed-open-sub', null, `${m.size}${m.levels > 1 ? ' +U' : ''} - ${m.playerSlots} players`)),
    onSelect: (m) => { sel = m; showDetail(); },
    onActivate: (m) => { sel = m; d.close({ action: 'open', id: m.id }); },
  });
  function showDetail() {
    ui.clear(detail, sel ? [
      h('div.ed-open-title', null, sel.name),
      h('div', null, `${sel.width} x ${sel.height}${sel.levels > 1 ? ', two levels' : ''}, ${sel.playerSlots} players`),
      h('div', null, `Victory: ${sel.victory}; loss: ${sel.loss}`),
      h('div.ed-open-desc', null, sel.description || ''),
      h('div', null, `Saved ${new Date(sel.savedAt || 0).toLocaleString()}`),
    ] : 'Choose a map.');
  }
  showDetail();
  const content = h('div.ed-open', null, list, detail, fileInput);
  const d = ui.openDialog({ title: 'Open map', content, class: 'ed-dlg ed-dlg-wide', width: 720, buttons: [
    { label: 'Open', kind: 'primary', default: true, keep: true, onClick: () => { if (sel) d.close({ action: 'open', id: sel.id }); } },
    { label: 'Delete', kind: 'danger', keep: true, onClick: async () => {
      if (!sel) return;
      if (!(await ui.confirm(`Delete the map "${sel.name}"?`, { danger: true }))) return;
      library.remove(sel.id); sel = null; list.setItems(library.list()); showDetail();
    } },
    { label: 'Export', keep: true, onClick: () => { if (sel && onExport) onExport(sel.id); } },
    { label: 'Import file', keep: true, onClick: () => fileInput.click() },
    { label: 'Cancel', value: null, cancel: true },
  ] });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const text = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsText(file);
    });
    d.close({ action: 'import', text, name: String(file.name || 'imported').replace(/(\.h3m)?\.json$/i, '') });
  });
  return d.result;
}

/**
 * Map settings: name, description, difficulty, size, players (count, human / AI, team, allowed towns),
 * victory / loss. Applies through the engine; resolves true when something was applied.
 */
export function settingsDialog(ui, doc, { onError } = {}) {
  const { h } = ui;
  const bp = doc.bp;
  const v = {
    name: bp.meta.name, description: bp.meta.description || '', difficulty: bp.meta.difficulty ?? 1,
    width: bp.map.width, height: bp.map.height, levels: bp.map.levels, players: bp.meta.playerSlots,
    slots: JSON.parse(JSON.stringify(bp.meta.players)),
    victory: bp.victory && bp.victory !== 'standard' ? JSON.parse(JSON.stringify(bp.victory)) : { type: 'standard' },
    loss: bp.loss && bp.loss !== 'standard' ? JSON.parse(JSON.stringify(bp.loss)) : { type: 'standard' },
  };
  const choices = M.conditionChoices(bp);
  const playersBox = h('div.ed-players');
  const vicBox = h('div.ed-cond');
  const lossBox = h('div.ed-cond');
  let slotSel = 0;

  function renderPlayers() {
    while (v.slots.length < v.players) v.slots.push(E.defaultPlayerMeta(v.slots.length));
    const p = v.slots[Math.min(slotSel, v.players - 1)];
    ui.clear(playersBox,
      h('div.k-row', null,
        ui.Select({ options: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: `${n} player${n > 1 ? 's' : ''}` })), value: v.players, onChange: (x) => { v.players = x; slotSel = Math.min(slotSel, x - 1); renderPlayers(); } }),
        ui.Select({ options: Array.from({ length: v.players }, (_, s) => ({ value: s, label: `Player ${s + 1} (${M.slotName(s)})` })), value: Math.min(slotSel, v.players - 1), onChange: (x) => { slotSel = x; renderPlayers(); } })),
      h('div.k-row', null,
        ui.Checkbox({ label: 'Human', checked: p.human !== false, onChange: (x) => { p.human = x; } }),
        ui.Checkbox({ label: 'Computer', checked: p.ai !== false, onChange: (x) => { p.ai = x; } }),
        ui.Select({ options: [{ value: null, label: 'No team' }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((t) => ({ value: t, label: `Team ${t + 1}` }))], value: p.team ?? null, onChange: (x) => { p.team = x; } })),
      h('div.ed-factions', null, h('div.ed-hint', null, 'Allowed towns (none ticked = all):'),
        FACTIONS_DATA.map((f) => ui.Checkbox({ label: f.name, checked: (p.factions || []).includes(f.id), onChange: (x) => {
          p.factions = (p.factions || []).filter((id) => id !== f.id);
          if (x) p.factions.push(f.id);
        } }))));
  }

  function renderCond(box, key, list) {
    const c = v[key];
    const choice = list.find((x) => x.id === c.type) || list[0];
    ui.clear(box,
      ui.Select({ options: list.map((x) => ({ value: x.id, label: x.label })), value: choice.id, onChange: (x) => { v[key] = { type: x }; renderCond(box, key, list); } }),
      choice.params.map((p) => {
        if (c[p.id] === undefined && p.type === 'select' && p.options.length) c[p.id] = p.options[0].value;
        const ctl = p.type === 'select'
          ? (p.options.length ? ui.Select({ options: p.options, value: c[p.id], onChange: (x) => { c[p.id] = x; } }) : h('span.ed-hint', null, 'Place one on the map first.'))
          : ui.TextInput({ value: c[p.id] != null ? String(c[p.id]) : '', width: 140, onInput: (x) => { c[p.id] = p.type === 'number' ? Number(x) : x; } });
        return ui.Field(p.label, ctl);
      }));
  }

  const content = h('div.ed-form.ed-settings', null,
    h('div.ed-settings-col', null,
      ui.Field('Name', ui.TextInput({ value: v.name, maxLength: 60, onInput: (x) => { v.name = x; } })),
      ui.Field('Description', (() => { const t = h('textarea.k-input.ed-textarea', { value: v.description }); t.value = v.description; t.addEventListener('input', () => { v.description = t.value; }); return t; })()),
      ui.Field('Difficulty', ui.Select({ options: DIFFS.map((label, value) => ({ value, label })), value: v.difficulty, onChange: (x) => { v.difficulty = x; } })),
      ui.Field('Size', h('div.k-row', null,
        ui.TextInput({ value: String(v.width), width: 60, onInput: (x) => { v.width = parseInt(x, 10) || v.width; } }), ' x ',
        ui.TextInput({ value: String(v.height), width: 60, onInput: (x) => { v.height = parseInt(x, 10) || v.height; } }),
        ui.Checkbox({ label: 'Underground', checked: v.levels === 2, onChange: (x) => { v.levels = x ? 2 : 1; } })), 'Shrinking drops what no longer fits.')),
    h('div.ed-settings-col', null,
      h('div.ed-sub', null, 'Players'), playersBox,
      h('div.ed-sub', null, 'Victory'), vicBox,
      h('div.ed-sub', null, 'Loss'), lossBox));
  renderPlayers();
  renderCond(vicBox, 'victory', choices.victory);
  renderCond(lossBox, 'loss', choices.loss);

  const d = ui.openDialog({ title: 'Map settings', content, class: 'ed-dlg ed-dlg-wide', width: 860, buttons: [
    { label: 'Apply', value: true, kind: 'primary', default: true },
    { label: 'Cancel', value: null, cancel: true },
  ] });
  return d.result.then((go) => {
    if (!go) return false;
    E.beginBatch(doc, 'Map settings');
    try {
      const errs = [];
      const chk = (r, what) => { if (!r.ok) errs.push(`${what}: ${M.editorErrorText(r)}`); };
      chk(E.setMapInfo(doc, { name: v.name, description: v.description, difficulty: v.difficulty }), 'Map info');
      if (v.width !== bp.map.width || v.height !== bp.map.height || v.levels !== bp.map.levels) chk(E.resizeMap(doc, { width: v.width, height: v.height, levels: v.levels }), 'Size');
      if (v.players !== doc.bp.meta.playerSlots) chk(E.setPlayerCount(doc, v.players), 'Players');
      for (const p of v.slots.slice(0, v.players)) chk(E.setPlayer(doc, p.slot, { human: p.human !== false, ai: p.ai !== false, team: p.team ?? null, factions: p.factions || [] }), `Player ${p.slot + 1}`);
      chk(E.setVictory(doc, v.victory.type === 'standard' ? 'standard' : v.victory), 'Victory');
      chk(E.setLoss(doc, v.loss.type === 'standard' ? 'standard' : v.loss), 'Loss');
      if (errs.length && onError) onError(errs);
    } finally {
      E.endBatch(doc);
    }
    return true;
  });
}

/** Validation report. Resolves the clicked problem (`{text, pos}`) or null. */
export function validateDialog(ui, result) {
  const { h } = ui;
  let d = null;
  const row = (p, kind) => {
    const el = h(`div.ed-problem.is-${kind}`, { title: p.pos ? 'Click to show it on the map' : '' }, h('span.ed-problem-kind', null, kind === 'error' ? 'Error' : 'Warning'), h('span', null, p.text),
      p.pos ? h('span.ed-problem-pos', null, `${p.pos.x}, ${p.pos.y}${p.pos.z ? ' U' : ''}`) : null);
    if (p.pos) el.addEventListener('click', () => d.close(p));
    return el;
  };
  const content = h('div.ed-validate', null,
    h('div.ed-validate-sum', null, result.ok ? (result.warnings.length ? 'The map is playable, with warnings.' : 'The map is valid and playable.') : `${result.errors.length} error(s) must be fixed before the map can be played.`),
    h('div.ed-validate-list', null, result.errors.map((p) => row(p, 'error')), result.warnings.map((p) => row(p, 'warning'))));
  d = ui.openDialog({ title: 'Validate map', content, class: 'ed-dlg ed-dlg-wide', width: 760, buttons: [{ label: 'Close', value: null, default: true }] });
  return d.result;
}

/** Seats for Play. Resolves `{seats, difficulty}` or null. */
export function playDialog(ui, bp) {
  const { h } = ui;
  const seats = E.defaultSeats(bp);
  let difficulty = 1;
  const rows = seats.map((s) => {
    const p = bp.meta.players.find((x) => x.slot === s.slot) || E.defaultPlayerMeta(s.slot);
    const allowed = p.factions && p.factions.length ? FACTIONS_DATA.filter((f) => p.factions.includes(f.id)) : FACTIONS_DATA;
    const fixed = (bp.towns.find((t) => t.ownerSlot === s.slot && t.faction !== 'random') || {}).faction;
    const typeOpts = [...(p.human !== false ? [{ value: true, label: 'Human' }] : []), ...(p.ai !== false ? [{ value: false, label: 'Computer' }] : [])];
    if (!typeOpts.some((o) => o.value === s.isHuman)) s.isHuman = typeOpts[0].value;
    return h('div.ed-seat', null,
      h('span.ed-seat-color', { style: { background: `var(--pc-${PLAYER_COLORS[s.slot]})` } }),
      h('span.ed-seat-name', null, `Player ${s.slot + 1}`),
      ui.Select({ options: typeOpts, value: s.isHuman, onChange: (x) => { s.isHuman = x; } }),
      fixed ? h('span.ed-hint', null, `${(FACTIONS_DATA.find((f) => f.id === fixed) || {}).name || fixed} (from the map)`)
        : ui.Select({ options: [{ value: 'random', label: 'Random town' }, ...allowed.map((f) => ({ value: f.id, label: f.name }))], value: allowed.length === 1 ? allowed[0].id : 'random', onChange: (x) => { s.faction = x; } }));
  });
  for (const s of seats) {
    const p = bp.meta.players.find((x) => x.slot === s.slot);
    if (s.faction === 'random' && p && p.factions && p.factions.length === 1) s.faction = p.factions[0];
  }
  const content = h('div.ed-form', null, rows,
    ui.Field('Difficulty', ui.Select({ options: DIFFS.map((label, value) => ({ value, label })), value: 1, onChange: (x) => { difficulty = x; } })));
  const d = ui.openDialog({ title: `Play "${bp.meta.name}"`, content, class: 'ed-dlg', buttons: [
    { label: 'Start', value: true, kind: 'primary', default: true },
    { label: 'Cancel', value: null, cancel: true },
  ] });
  return d.result.then((go) => {
    if (!go) return null;
    if (!seats.some((s) => s.isHuman)) seats[0].isHuman = true;
    return { seats, difficulty };
  });
}

/** Edit form of one timed event. Resolves the edited event or null. */
export function timedEventForm(ui, sprite, bp, ev = {}) {
  const { h } = ui;
  const v = { name: ev.name || '', day: ev.day || 1, repeat: ev.repeat || 0, message: ev.message || '', players: (ev.players || []).slice(),
    humanOnly: !!ev.humanOnly, aiOnly: !!ev.aiOnly, resources: { ...(ev.resources || {}) }, creatures: (ev.creatures || []).map((c) => ({ ...c })) };
  const num = (label, key, obj = v, w = 70) => ui.Field(label, ui.TextInput({ value: String(obj[key] || 0), width: w, onInput: (x) => { obj[key] = parseInt(x, 10) || 0; } }));
  const msg = h('textarea.k-input.ed-textarea');
  msg.value = v.message;
  msg.addEventListener('input', () => { v.message = msg.value; });
  const content = h('div.ed-form.ed-settings', null,
    h('div.ed-settings-col', null,
      ui.Field('Name', ui.TextInput({ value: v.name, maxLength: 40, onInput: (x) => { v.name = x; } })),
      num('First day', 'day'), num('Repeat every (days, 0 = once)', 'repeat'),
      ui.Field('Message', msg),
      h('div.ed-sub', null, 'Players (none = everybody)'),
      h('div.ed-factions', null, Array.from({ length: bp.meta.playerSlots }, (_, s) => ui.Checkbox({ label: M.slotName(s), checked: v.players.includes(s), onChange: (x) => { v.players = v.players.filter((p) => p !== s); if (x) v.players.push(s); } }))),
      h('div.k-row', null, ui.Checkbox({ label: 'Humans only', checked: v.humanOnly, onChange: (x) => { v.humanOnly = x; } }), ui.Checkbox({ label: 'Computers only', checked: v.aiOnly, onChange: (x) => { v.aiOnly = x; } }))),
    h('div.ed-settings-col', null,
      h('div.ed-sub', null, 'Resources (negative = taken)'),
      h('div.ed-resgrid', null, ['gold', 'wood', 'ore', 'mercury', 'sulfur', 'crystal', 'gems'].map((r) => num(r, r, v.resources, 80))),
      h('div.ed-sub', null, 'Creatures (join the first hero / town)'),
      StackListField(ui, sprite, { value: v.creatures, onChange: (x) => { v.creatures = x; } })));
  const d = ui.openDialog({ title: ev.name ? `Timed event: ${ev.name}` : 'Timed event', content, class: 'ed-dlg ed-dlg-wide', width: 820, buttons: [
    { label: 'OK', value: true, kind: 'primary', default: true },
    { label: 'Cancel', value: null, cancel: true },
  ] });
  return d.result.then((go) => {
    if (!go) return null;
    const resources = {};
    for (const [k, x] of Object.entries(v.resources)) if (x) resources[k] = x;
    return { name: v.name, day: v.day, repeat: v.repeat, message: v.message, players: v.players.sort(), humanOnly: v.humanOnly, aiOnly: v.aiOnly, resources, creatures: v.creatures };
  });
}

/** Map-wide timed events: list, add, edit, delete (through the engine). Resolves when closed. */
export function timedEventsDialog(ui, sprite, doc, { onError } = {}) {
  const { h } = ui;
  const list = ui.ScrollList({
    class: 'ed-open-list', keyOf: (e) => `${e.i}`, emptyText: 'No timed events. They fire at the start of a day, e.g. a weekly tribute.',
    renderItem: (e) => h('div', null, h('div.ed-open-name', null, e.name || `Event ${e.i + 1}`),
      h('div.ed-open-sub', null, `day ${e.day}${e.repeat ? `, every ${e.repeat} days` : ''}${e.players && e.players.length ? ` - ${e.players.map((s) => M.slotName(s)).join(', ')}` : ' - everybody'}`)),
    onActivate: (e) => edit(e.i),
  });
  const refresh = () => list.setItems((doc.bp.events || []).map((e, i) => ({ ...e, i })));
  refresh();
  const report = (r) => { if (!r.ok && onError) onError(r); };
  async function edit(i) {
    const ev = await timedEventForm(ui, sprite, doc.bp, doc.bp.events[i]);
    if (ev) report(E.setTimedEvent(doc, i, ev));
    refresh();
  }
  const d = ui.openDialog({ title: 'Timed events', content: h('div.ed-open', null, list), class: 'ed-dlg', width: 520, buttons: [
    { label: 'Add', kind: 'primary', keep: true, onClick: async () => { const ev = await timedEventForm(ui, sprite, doc.bp, { day: 1 }); if (ev) report(E.addTimedEvent(doc, ev)); refresh(); } },
    { label: 'Edit', keep: true, onClick: () => { if (list.selectedItem) edit(list.selectedItem.i); } },
    { label: 'Delete', kind: 'danger', keep: true, onClick: () => { if (list.selectedItem) { report(E.removeTimedEvent(doc, list.selectedItem.i)); refresh(); } } },
    { label: 'Close', value: true, default: true },
  ] });
  return d.result;
}
