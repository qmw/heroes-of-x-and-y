// Load / Save screen: localStorage slots with metadata, autosave, export to and import from a
// JSON file. params: { mode: 'load' | 'save' }  ('save' needs a game in progress).
import { storageErrorText, slotId, AUTOSAVE_SLOT, QUICKSAVE_SLOT } from '../storage.js';
import { dateText } from '../kit/resourceBar.js';

/** "2026-10-13 17:05" from a timestamp (pure). */
export function stampText(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** One-line summary of a save meta (pure). */
export function metaSummary(meta) {
  const parts = [];
  if (meta.date) parts.push(dateText(meta.date));
  if (meta.mapSize) parts.push(meta.mapSize);
  if (meta.players && meta.players.length) parts.push(`${meta.players.length} players`);
  return parts.join(' - ');
}

/** Trigger a file download in the browser. Returns false when the browser APIs are missing. */
export function downloadText(filename, text) {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

export function mount(root, ctx, params = {}) {
  const ui = ctx.ui;
  const { h, clear } = ui;
  const canSave = !!ctx.state;
  const mode = params.mode === 'save' && canSave ? 'save' : 'load';
  const detail = h('div.lg-detail');
  const buttons = h('div.lg-buttons');
  const fileInput = h('input', { type: 'file', style: { display: 'none' } });
  fileInput.accept = '.json,application/json';

  const list = ui.ScrollList({
    class: 'lg-list', keyOf: (m) => m.slot, emptyText: 'No saved games yet.',
    renderItem: (m) => h('div.lg-row', null,
      h('div.lg-row-name', null, m.name || m.slot, m.slot === AUTOSAVE_SLOT ? h('span.k-tag', null, 'auto') : null, m.slot === QUICKSAVE_SLOT ? h('span.k-tag', null, 'quick') : null),
      h('div.lg-row-sub', null, `${stampText(m.savedAt)}${metaSummary(m) ? ` - ${metaSummary(m)}` : ''}`)),
    onSelect: () => renderDetail(),
    onActivate: () => (mode === 'load' ? doLoad() : doOverwrite()),
  });

  root.appendChild(h('div.lg', null,
    h('div.lg-heading', null, mode === 'save' ? 'Save Game' : 'Load Game'),
    h('div.lg-cols', null,
      ui.Panel({ title: 'Saved games', class: 'lg-list-panel' }, list,
        ctx.storage.persistent ? null : h('div.ng-note.is-warn', null, 'Browser storage is unavailable: saves only last until the page is closed. Use Export to keep them.')),
      ui.Panel({ title: 'Details', class: 'lg-detail-panel', variant: 'parchment' }, detail)),
    buttons, fileInput));

  const sel = () => list.selectedItem;
  const fail = (res, title) => ui.message(storageErrorText(res.error), { title });

  function refresh(keepSlot) {
    list.setItems(ctx.storage.list(), keepSlot);
    if (list.selectedIndex < 0 && list.items.length) list.select(0, true);
    renderDetail();
  }

  function renderDetail() {
    const m = sel();
    if (!m) {
      clear(detail, h('p', null, mode === 'save' ? 'Save the current game into a new slot, or select a slot to overwrite.' : 'Select a saved game, or import one from a file.'));
    } else {
      clear(detail,
        h('div.lg-name', null, m.name || m.slot),
        ui.StatLine('Saved', stampText(m.savedAt)),
        m.date ? ui.StatLine('Game date', dateText(m.date)) : null,
        m.turn != null ? ui.StatLine('Day', m.turn) : null,
        m.mapName ? ui.StatLine('Map', m.mapName) : null,
        m.mapSize ? ui.StatLine('Map size', m.mapSize) : null,
        m.difficulty != null ? ui.StatLine('Difficulty', ['Easy', 'Normal', 'Hard', 'Expert', 'Impossible'][m.difficulty] ?? m.difficulty) : null,
        m.currentPlayer ? ui.StatLine('Current player', m.currentPlayer) : null,
        m.size ? ui.StatLine('Size', `${Math.max(1, Math.round(m.size / 1024))} KB`) : null,
        m.players && m.players.length ? h('div.lg-players', null, m.players.map((p) => h('div.lg-player', { class: !p.alive && 'is-dead' },
          h('span.ng-color-dot', { style: { background: `var(--pc-${p.color}, #888)` } }),
          h('span', null, `${p.name || p.color} (${p.isHuman ? 'human' : 'computer'}${p.faction ? `, ${p.faction}` : ''})`)))) : null);
    }
    renderButtons();
  }

  function renderButtons() {
    const m = sel();
    clear(buttons,
      mode === 'load' ? ui.Button('Load', { kind: 'primary', hotkey: 'Enter', disabled: !m, onClick: doLoad }) : null,
      mode === 'save' ? ui.Button('Save as new...', { kind: 'primary', hotkey: 'N', onClick: doSaveNew }) : null,
      mode === 'save' ? ui.Button('Overwrite', { disabled: !m, onClick: doOverwrite }) : null,
      ui.Button('Delete', { kind: 'danger', hotkey: 'Del', disabled: !m, onClick: doDelete }),
      ui.Button('Export to file', { disabled: !m, onClick: doExport }),
      ui.Button('Import from file', { onClick: () => fileInput.click() }),
      canSave && mode === 'load' ? ui.Button('Save current game...', { onClick: () => ctx.showScreen('loadGame', { mode: 'save' }, { replace: true }) }) : null,
      ui.Button('Back', { hotkey: 'Esc', onClick: () => ctx.back() }));
  }

  async function doLoad() {
    const m = sel();
    if (!m) return;
    if (ctx.state && !(await ui.confirm('Load this game? Unsaved progress in the current game will be lost.', { title: 'Load game' }))) return;
    const res = await ctx.load(m.slot);
    if (!res.ok) { fail(res, 'Load failed'); return; }
    ctx.audio.play('daystart');
    ctx.showScreen('adventure', { loaded: true });
  }

  async function doSaveNew() {
    const name = await ui.prompt({ title: 'Save game', label: 'Name of the save', value: `Day ${ctx.state?.turn ?? 1}` });
    if (name == null) return;
    const slot = slotId(name);
    if (ctx.storage.has(slot) && !(await ui.confirm(`A save called "${name}" already exists. Overwrite it?`, { title: 'Overwrite' }))) return;
    const res = await ctx.save(slot, name.trim() || slot);
    if (!res.ok) { fail(res, 'Save failed'); return; }
    ctx.toast('Game saved.', 'good');
    refresh(slot);
  }

  async function doOverwrite() {
    const m = sel();
    if (!m || mode !== 'save') return;
    if (!(await ui.confirm(`Overwrite "${m.name || m.slot}" with the current game?`, { title: 'Overwrite' }))) return;
    const res = await ctx.save(m.slot, m.name);
    if (!res.ok) { fail(res, 'Save failed'); return; }
    ctx.toast('Game saved.', 'good');
    refresh(m.slot);
  }

  async function doDelete() {
    const m = sel();
    if (!m) return;
    if (!(await ui.confirm(`Delete "${m.name || m.slot}"? This cannot be undone.`, { title: 'Delete save', danger: true }))) return;
    ctx.storage.remove(m.slot);
    refresh();
  }

  function doExport() {
    const m = sel();
    if (!m) return;
    const text = ctx.storage.exportSlot(m.slot);
    if (!text) { ui.message('That save no longer exists.', { title: 'Export failed' }); return; }
    if (downloadText(`h3online-${m.slot}.json`, text)) ctx.toast('Save exported.', 'good');
    else ui.message('This browser cannot download files from the page.', { title: 'Export failed' });
  }

  async function importText(text, filename = 'imported') {
    const base = String(filename).replace(/\.json$/i, '').replace(/^h3online-/, '');
    const res = ctx.storage.importJson(text, { slot: base || 'imported' });
    if (!res.ok) { fail(res, 'Import failed'); return res; }
    ctx.toast(`Imported "${res.meta.name || res.slot}".`, 'good');
    refresh(res.slot);
    return res;
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      const text = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsText(file);
      });
      await importText(text, file.name);
    } catch (err) {
      ui.message(`The file could not be read: ${err.message}`, { title: 'Import failed' });
    }
    fileInput.value = '';
  });

  ctx.keys.bind('escape', () => ctx.back(), 'Back');
  ctx.keys.bind('enter', () => (mode === 'load' ? doLoad() : doOverwrite()), mode === 'load' ? 'Load' : 'Overwrite');
  ctx.keys.bind('delete', doDelete, 'Delete save');
  if (mode === 'save') ctx.keys.bind('n', doSaveNew, 'Save as new');
  refresh();
  return { list, importText, doLoad, doSaveNew, mode };
}

export function unmount() {}
