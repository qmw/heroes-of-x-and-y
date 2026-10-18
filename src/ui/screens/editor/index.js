// Map editor screen. params: { mapId?, blueprint?, fresh? }. docs/mechanics/editor.md §5.
// The map is drawn by the adventure renderer (createMapView) on a preview state built from the
// blueprint; every edit goes through src/engine/editor.
import * as E from '../../../engine/editor/index.js';
import { TERRAIN_BY_ID } from '../../../data/terrain.js';
import { MAP_OBJECT_BY_ID } from '../../../data/mapObjects.js';
import { FACTIONS_DATA } from '../../../data/factions.js';
import { createMapView } from '../adventure/mapView.js';
import { minimapPixels } from '../adventure/model.js';
import { downloadText } from '../loadGame.js';
import * as M from './model.js';
import { createMapLibrary } from './mapStorage.js';
import * as D from './dialogs.js';
import { pickerControl, PickerField } from './pickers.js';

export const MAP_W = 810;
export const MAP_H = 664;
const PALETTE_W = 230;

let instance = null;
/** The document survives leaving the screen (play-testing, the encyclopedia...) within a session. */
let session = null;

export function getController() { return instance; }
/** Tests: forget the remembered document. */
export function resetSession() { session = null; }

export async function mount(root, ctx, params = {}) {
  instance = createController(root, ctx, params || {});
  await instance.start();
  return instance;
}

export function unmount() {
  if (instance) instance.destroy();
  instance = null;
}

function injectCss() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.head.querySelector && document.head.querySelector('link[data-ed-css]')) return;
  try {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./editor.css', import.meta.url).href;
    link.setAttribute('data-ed-css', '1');
    document.head.appendChild(link);
  } catch { /* no CSS */ }
}

function createController(root, ctx, params) {
  const { ui } = ctx;
  const { h } = ui;
  const library = createMapLibrary(ctx.storage);
  const catalog = M.buildCatalog();
  const offs = [];
  let destroyed = false;

  if (params.fresh || params.blueprint || params.mapId || !session) session = null;
  let doc = session ? session.doc : E.newMap({ size: 'M', players: 2, name: 'New map' });
  let savedId = session ? session.savedId : null;
  const st = session ? session.ui : { tool: 'terrain', terrain: 'grass', brush: 1, road: 3, river: true, category: 'all', search: '', entry: 'resource_gold', owner: null, townFaction: 'castle', townOwner: 0, heroOwner: 0, heroDef: 'random' };
  let preview = M.createPreview(doc.bp);
  let previewVersion = doc.version;
  let previewMap = doc.bp.map;
  let selection = null;
  let hover = null;
  let stroke = null;   // {tool, last}
  let drag = null;     // pan {x, y}
  let move = null;     // {ref, from, to}
  let minimapDirty = true;
  let minimapSrc = null;
  let minimapLevel = -1;
  let camKey = '';

  const remember = () => { session = { doc, savedId, ui: st }; };
  remember();

  // ---- DOM ---------------------------------------------------------------------------------------
  injectCss();
  const view = createMapView(ctx, { width: MAP_W, height: MAP_H, getState: () => preview, getViewer: () => null });
  view.showGrid = true;
  const title = h('div.ed-title');
  const status = h('div.ed-status');
  const toolBar = h('div.ed-tools');
  const options = h('div.ed-options');
  const inspector = h('div.ed-inspector');
  const levelBtn = ui.Button('Surface', { size: 'sm', onClick: () => setLevel(view.level ? 0 : 1) });
  const gridBtn = ui.Button('Grid', { size: 'sm', active: true, onClick: () => toggleGrid() });
  const undoBtn = ui.Button('Undo', { size: 'sm', tooltip: 'Ctrl+Z', onClick: () => doUndo() });
  const redoBtn = ui.Button('Redo', { size: 'sm', tooltip: 'Ctrl+Y', onClick: () => doRedo() });
  const minimap = ui.Minimap({ width: 224, height: 224, draw: drawMinimap, onNavigate: (fx, fy) => view.centerOnTile(Math.floor(fx * doc.bp.map.width), Math.floor(fy * doc.bp.map.height)) });
  const menu = h('div.ed-menu', null,
    ui.Button('New', { size: 'sm', onClick: () => menuNew() }),
    ui.Button('Random', { size: 'sm', tooltip: 'Start from a random map', onClick: () => menuRandom() }),
    ui.Button('Open', { size: 'sm', onClick: () => menuOpen() }),
    ui.Button('Save', { size: 'sm', tooltip: 'Ctrl+S', onClick: () => menuSave() }),
    ui.Button('Save as', { size: 'sm', onClick: () => menuSave({ as: true }) }),
    ui.Button('Export', { size: 'sm', tooltip: 'Download as .json', onClick: () => menuExport() }),
    ui.Button('Settings', { size: 'sm', onClick: () => menuSettings() }),
    ui.Button('Events', { size: 'sm', tooltip: 'Map-wide timed events', onClick: () => menuEvents() }),
    ui.Button('Validate', { size: 'sm', onClick: () => menuValidate() }),
    ui.Button('Play', { size: 'sm', kind: 'primary', onClick: () => menuPlay() }),
    undoBtn, redoBtn, title,
    ui.Button('Exit', { size: 'sm', onClick: () => menuExit() }));
  const el = h('div.ed-root', null,
    menu,
    h('div.ed-body', null,
      h('div.ed-palette', { style: { width: PALETTE_W } }, toolBar, options),
      h('div.ed-mapwrap', null, view.canvas),
      h('div.ed-side', null, minimap, h('div.k-row.ed-viewbtns', null, levelBtn, gridBtn,
        ui.Button('+', { size: 'sm', tooltip: 'Zoom in', onClick: () => view.zoom(1) }), ui.Button('-', { size: 'sm', tooltip: 'Zoom out', onClick: () => view.zoom(-1) })), inspector)),
    status);
  root.appendChild(el);

  // ---- document plumbing -------------------------------------------------------------------------
  function sync({ terrain = null, all = false } = {}) {
    if (doc.bp.map !== previewMap || all) {
      preview = M.createPreview(doc.bp);
      previewMap = doc.bp.map;
      view.invalidateTerrain();
      view.setLevel(Math.min(view.level, doc.bp.map.levels - 1));
    } else {
      M.syncPreview(preview, doc.bp);
      if (terrain === true) view.invalidateTerrain();
      else if (terrain && terrain.length) (view.invalidateTiles || view.invalidateTerrain)(terrain);
    }
    previewVersion = doc.version;
    view.invalidateObjects();
    minimapDirty = true;
    if (selection && !E.getRef(doc, selection)) selection = null;
    renderTitle();
    renderInspector();
    remember();
  }

  /** Tiles changed by the last history step(s) - for chunk invalidation. */
  function tilesOfKeys(keys) {
    const out = [];
    for (const k of keys || []) {
      if (k === 'map') return true;
      if (!k.startsWith('tile:')) continue;
      const [z, y, x] = k.slice(5).split(',').map(Number);
      out.push({ x, y, z });
    }
    return out;
  }
  const lastStepTiles = () => tilesOfKeys((doc.undo[doc.undo.length - 1] || { entries: [] }).entries.map((e) => e.key));

  function setDoc(next, { id = null } = {}) {
    doc = next;
    savedId = id;
    selection = null;
    sync({ all: true });
    centerOnStart();
  }

  function centerOnStart() {
    const bp = doc.bp;
    const p = (bp.heroes[0] || bp.towns[0] || {}).pos || { x: Math.floor(bp.map.width / 2), y: Math.floor(bp.map.height / 2), z: 0 };
    view.centerOnTile(p.x, p.y, p.z || 0);
    updateLevelBtn();
  }

  function renderTitle() {
    const dirty = doc.version !== doc.savedVersion;
    ui.clear(title, `${doc.bp.meta.name || 'Untitled'}${dirty ? ' *' : ''}`, h('span.ed-title-sub', null, ` ${doc.bp.map.width}x${doc.bp.map.height}${doc.bp.map.levels > 1 ? ' +U' : ''}, ${doc.bp.meta.playerSlots} players`));
    undoBtn.setDisabled(!E.canUndo(doc));
    redoBtn.setDisabled(!E.canRedo(doc));
  }

  function report(r, quiet = false) {
    if (r && r.ok === false && !quiet) { ctx.toast(M.editorErrorText(r), 'warn'); ctx.audio.play('error'); }
    return r;
  }

  // ---- tools & palette ---------------------------------------------------------------------------
  function setTool(id) {
    if (!M.TOOLS.some((t) => t.id === id)) return;
    st.tool = id;
    endStroke();
    renderTools();
    renderOptions();
    view.markDirty();
  }

  function renderTools() {
    ui.clear(toolBar, M.TOOLS.map((t) => ui.Button(`${t.key} ${t.label}`, { size: 'sm', class: 'ed-tool', active: st.tool === t.id, tooltip: t.hint, onClick: () => setTool(t.id) })));
  }

  function ownerSelect(value, onChange, neutral = true) {
    return ui.Select({ options: [...(neutral ? [{ value: null, label: 'Neutral' }] : []), ...Array.from({ length: doc.bp.meta.playerSlots }, (_, s) => ({ value: s, label: M.slotName(s) }))], value, onChange });
  }

  const brushRow = () => ui.Field('Brush', h('div.k-row', null, E.BRUSH_SIZES.map((n) => ui.Button(`${n}x${n}`, { size: 'sm', active: st.brush === n, onClick: () => { st.brush = n; renderOptions(); } }))));

  function renderOptions() {
    const t = st.tool;
    if (t === 'terrain' || t === 'fill') {
      const level = view.level;
      ui.clear(options,
        h('div.ed-swatches', null, M.PAINT_TERRAINS.filter((id) => E.terrainAllowedOnLevel(id, level)).map((id) => {
          const b = h('button.ed-swatch', { type: 'button', class: st.terrain === id ? 'is-active' : '', title: TERRAIN_BY_ID[id].name, style: { background: TERRAIN_BY_ID[id].color }, dataset: { terrain: id } }, h('span', null, TERRAIN_BY_ID[id].name));
          b.addEventListener('click', () => { st.terrain = id; renderOptions(); });
          return b;
        })),
        t === 'terrain' ? brushRow() : h('div.ed-hint', null, 'Click a region to fill it.'));
    } else if (t === 'road') {
      ui.clear(options, h('div.k-col', null, M.ROAD_TYPES.map((r) => ui.Button(r.name, { size: 'sm', active: st.road === r.index, onClick: () => { st.road = r.index; renderOptions(); } }))), brushRow(), h('div.ed-hint', null, 'Drag to draw; roads join automatically.'));
    } else if (t === 'river') {
      ui.clear(options, h('div.k-row', null, ui.Button('Draw', { size: 'sm', active: st.river, onClick: () => { st.river = true; renderOptions(); } }), ui.Button('Erase', { size: 'sm', active: !st.river, onClick: () => { st.river = false; renderOptions(); } })), brushRow(), h('div.ed-hint', null, 'Rivers take the colour of the terrain.'));
    } else if (t === 'object') {
      renderBrowser();
    } else if (t === 'town') {
      ui.clear(options,
        ui.Field('Town', ui.Select({ options: [{ value: 'random', label: 'Random' }, ...FACTIONS_DATA.map((f) => ({ value: f.id, label: f.name }))], value: st.townFaction, onChange: (x) => { st.townFaction = x; view.markDirty(); } })),
        ui.Field('Owner', ownerSelect(st.townOwner, (x) => { st.townOwner = x; })),
        h('div.ed-thumb-big', null, ctx.sprite('object', st.townFaction === 'random' ? 'random_town' : 'town', { size: 40, variant: st.townFaction })),
        h('div.ed-hint', null, 'Click the gate tile (bottom centre of the 5x3 town).'));
    } else if (t === 'hero') {
      ui.clear(options,
        ui.Field('Owner', ownerSelect(st.heroOwner, (x) => { st.heroOwner = x; }, false)),
        ui.Field('Hero', PickerField(ui, ctx.sprite, { kind: 'hero', value: st.heroDef, allowRandom: true, onChange: (x) => { st.heroDef = x; } })),
        h('div.ed-hint', null, 'Heroes start on land; on their town\'s gate they start inside.'));
    } else if (t === 'erase') {
      ui.clear(options, brushRow(), h('div.ed-hint', null, 'Removes heroes, objects and towns; on empty tiles roads and rivers.'));
    } else {
      ui.clear(options, h('div.ed-hint', null, 'Click: select. Drag: move. Delete: remove. Edit the selection on the right.'));
    }
  }

  let browserList = null;
  function renderBrowser() {
    const search = ui.TextInput({ value: st.search, placeholder: 'Search objects...', class: 'ed-search', onInput: (x) => { st.search = x; refreshBrowser(); } });
    const cat = ui.Select({ options: M.BROWSER_CATEGORIES.map((c) => ({ value: c.id, label: c.name })), value: st.category, onChange: (x) => { st.category = x; refreshBrowser(); } });
    browserList = ui.ScrollList({
      class: 'ed-browser', keyOf: (e) => e.key, emptyText: 'Nothing matches.',
      renderItem: (e) => h('div.ed-brow', { title: `${e.name} (${e.size[0]}x${e.size[1]})` }, h('span.ed-bthumb', null, ctx.sprite(e.icon.kind, e.icon.id, { size: 28, ...(e.icon.opts || {}) })), h('span.ed-bname', null, e.name)),
      onSelect: (e) => { st.entry = e.key; view.markDirty(); },
    });
    const ownerRow = ui.Field('Owner', ownerSelect(st.owner, (x) => { st.owner = x; }));
    ui.clear(options, search, cat, browserList, ownerRow);
    refreshBrowser();
  }
  function refreshBrowser() {
    if (!browserList) return;
    const items = M.filterCatalog(catalog, { category: st.category, search: st.search }).slice(0, 150);
    browserList.setItems(items);
    const i = items.findIndex((e) => e.key === st.entry);
    if (i >= 0) browserList.select(i, true);
  }
  const currentEntry = () => catalog.find((e) => e.key === st.entry) || null;

  /** What the placing tools would place: {defId, props}. */
  function placement() {
    if (st.tool === 'town') return { defId: st.townFaction === 'random' ? 'random_town' : 'town', props: { faction: st.townFaction, ownerSlot: st.townOwner } };
    if (st.tool === 'hero') return { defId: E.HERO_ID, props: { ownerSlot: st.heroOwner ?? 0, defId: st.heroDef } };
    if (st.tool === 'object') {
      const e = currentEntry();
      if (!e) return null;
      if (e.defId === 'town' || e.defId === 'random_town') return { defId: e.defId, props: { ...e.props, ownerSlot: st.owner } };
      if (e.defId === E.HERO_ID) return { defId: e.defId, props: { ownerSlot: st.owner ?? 0, defId: 'random' } };
      const def = MAP_OBJECT_BY_ID[e.defId];
      const ownable = def && E.OWNABLE_EFFECTS.includes(def.effect.type);
      return { defId: e.defId, props: ownable && st.owner != null ? { owner: st.owner } : {} };
    }
    return null;
  }

  // ---- inspector ---------------------------------------------------------------------------------
  let inspectorValues = null;
  function renderInspector() {
    if (!selection || !E.getRef(doc, selection)) {
      inspectorValues = null;
      ui.clear(inspector, h('div.ed-sub', null, 'Selection'), h('div.ed-hint', null, 'Nothing selected. Use the Select tool (1) and click a hero, town or object.'));
      return;
    }
    const ent = E.getRef(doc, selection);
    const spec = M.inspectorSpec(doc.bp, selection, ent);
    if (!inspectorValues || inspectorValues.__key !== keyOf(selection)) {
      inspectorValues = { __key: keyOf(selection) };
      for (const f of spec.fields) inspectorValues[f.id] = f.value;
    }
    const v = inspectorValues;
    const qType = v.q_type;
    const fields = spec.fields.filter((f) => !f.when || f.when === qType).map((f) => {
      let ctl = pickerControl(ui, ctx.sprite, f, v[f.id], (x) => { v[f.id] = x; });
      if (ctl) { /* searchable picker with sprites */ } else if (f.type === 'select') ctl = ui.Select({ options: f.options, value: v[f.id], onChange: (x) => { v[f.id] = x; if (f.id === 'q_type') renderInspector(); } });
      else if (f.type === 'check') ctl = ui.Checkbox({ label: '', checked: !!v[f.id], onChange: (x) => { v[f.id] = x; } });
      else if (f.type === 'textarea') { ctl = h('textarea.k-input.ed-textarea'); ctl.value = v[f.id] ?? ''; ctl.addEventListener('input', () => { v[f.id] = ctl.value; }); }
      else if (f.type === 'info') ctl = h('span.ed-hint', null, String(f.value));
      else ctl = ui.TextInput({ value: String(v[f.id] ?? ''), onInput: (x) => { v[f.id] = f.type === 'number' ? Number(x) : x; } });
      if (ctl.dataset) ctl.dataset.field = f.id;
      return ui.Field(f.label, ctl, f.hint);
    });
    const d = E.describeRef(doc, selection);
    ui.clear(inspector,
      h('div.ed-sub', null, spec.title),
      h('div.ed-hint', null, `${selection.kind === 'object' ? `${selection.id} - ` : ''}${d.pos.x}, ${d.pos.y}${d.pos.z ? ' (underground)' : ''}`),
      h('div.ed-fields', null, fields),
      h('div.k-row', null,
        spec.fields.some((f) => f.type !== 'info') ? ui.Button('Apply', { size: 'sm', kind: 'primary', onClick: () => applyInspector() }) : null,
        ui.Button('Delete', { size: 'sm', kind: 'danger', onClick: () => deleteSelection() })));
  }
  const keyOf = (ref) => (ref.kind === 'object' ? `o:${ref.id}` : `${ref.kind}:${ref.index}`);

  function applyInspector() {
    if (!selection || !inspectorValues) return null;
    const ent = E.getRef(doc, selection);
    const spec = M.inspectorSpec(doc.bp, selection, ent);
    const r = report(E.setProps(doc, selection, spec.apply(inspectorValues)));
    if (r.ok) { inspectorValues = null; sync(); ctx.toast('Properties applied.', 'good', 1200); }
    return r;
  }

  function select(ref) {
    selection = ref;
    inspectorValues = null;
    renderInspector();
    view.markDirty();
  }

  function deleteSelection() {
    if (!selection) return;
    const r = report(E.removeRef(doc, selection));
    if (r.ok) { selection = null; sync(); }
  }

  // ---- map input ----------------------------------------------------------------------------------
  const posOf = (e) => ui.eventPos(view.canvas, e, MAP_W, MAP_H);
  const tileOfEvent = (e) => { const p = posOf(e); return view.tileAt(p.x, p.y); };
  const inMap = (t) => t && t.x >= 0 && t.y >= 0 && t.x < doc.bp.map.width && t.y < doc.bp.map.height;

  function beginStroke(t) {
    const tool = st.tool;
    if (!inMap(t)) return;
    if (tool === 'select') {
      const ref = E.refAt(doc, t);
      select(ref);
      if (ref) move = { ref, from: t, to: t };
      return;
    }
    if (tool === 'fill') { const r = report(E.fillTerrain(doc, t, st.terrain)); if (r.ok) sync({ terrain: lastStepTiles() }); return; }
    if (tool === 'object' || tool === 'town' || tool === 'hero') {
      const pl = placement();
      if (!pl) { ctx.toast('Choose an object in the browser first.', 'info'); return; }
      const r = report(E.placeObject(doc, pl.defId, t, pl.props));
      if (r.ok) { sync(); select(r.ref); ctx.audio.play('click'); }
      return;
    }
    E.beginBatch(doc);
    stroke = { tool, last: t };
    paintAt(t, t);
  }

  function paintAt(from, t) {
    let r = null;
    const tool = st.tool;
    // fast mouse moves skip tiles: walk the line from the previous tile
    const pts = from && (from.x !== t.x || from.y !== t.y) ? E.linePoints(from, { ...t, z: from.z }).slice(1) : [t];
    if (tool === 'terrain') for (const q of pts) { r = E.paintTerrain(doc, q, st.terrain, { brush: st.brush }); if (!r.ok) break; }
    else if (tool === 'road') r = st.brush > 1 ? E.paintRoad(doc, t, st.road, { brush: st.brush }) : E.paintRoadLine(doc, from, t, st.road);
    else if (tool === 'river') r = st.brush > 1 ? E.paintRiver(doc, t, st.river, { brush: st.brush }) : E.paintRiverLine(doc, from, t, st.river);
    else if (tool === 'erase') {
      for (const q of pts) {
        const ref = E.refAt(doc, q);
        if (ref) r = E.removeRef(doc, ref);
        else {
          E.paintRoad(doc, q, 0, { brush: st.brush });
          r = E.paintRiver(doc, q, false, { brush: st.brush });
        }
      }
    }
    if (r && r.ok === false && r.error !== 'out_of_bounds') report(r, stroke && stroke.reported);
    if (r && r.ok === false && stroke) stroke.reported = true;
    if (r && r.ok) sync({ terrain: lastStepTiles() });
  }

  function endStroke() {
    if (stroke) { E.endBatch(doc); stroke = null; renderTitle(); }
    if (move) {
      const m = move;
      move = null;
      if (m.to.x !== m.from.x || m.to.y !== m.from.y) {
        const e = E.getRef(doc, m.ref);
        if (e) {
          const dest = { x: e.pos.x + (m.to.x - m.from.x), y: e.pos.y + (m.to.y - m.from.y), z: m.to.z };
          const r = report(E.moveRef(doc, m.ref, dest));
          if (r.ok) sync();
        }
      }
      view.markDirty();
    }
  }

  const canvas = view.canvas;
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); offs.push(() => target.removeEventListener(type, fn, o)); };
  listen(canvas, 'mousedown', (e) => {
    if (e.button === 1 || e.button === 2) { const p = posOf(e); drag = { x: p.x, y: p.y }; if (e.preventDefault) e.preventDefault(); return; }
    if (e.button != null && e.button !== 0) return;
    beginStroke(tileOfEvent(e));
  });
  listen(canvas, 'mousemove', (e) => {
    const t = tileOfEvent(e);
    hover = inMap(t) ? t : null;
    view.setHover(hover);
    setStatus();
    if (stroke && hover && (hover.x !== stroke.last.x || hover.y !== stroke.last.y)) { paintAt(stroke.last, hover); stroke.last = hover; }
    if (move && hover) { move.to = hover; view.markDirty(); }
  });
  listen(canvas, 'mouseleave', () => { hover = null; view.setHover(null); setStatus(); });
  listen(canvas, 'contextmenu', (e) => { if (e.preventDefault) e.preventDefault(); });
  listen(canvas, 'wheel', (e) => { if (e.preventDefault) e.preventDefault(); view.zoom(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  if (typeof window !== 'undefined') {
    listen(window, 'mousemove', (e) => {
      if (!drag) return;
      const p = posOf(e);
      view.panBy(p.x - drag.x, p.y - drag.y);
      drag.x = p.x; drag.y = p.y;
    });
    listen(window, 'mouseup', () => { drag = null; endStroke(); });
  }

  function setStatus() {
    if (!hover) { status.textContent = M.TOOLS.find((t) => t.id === st.tool).hint; return; }
    const ref = E.refAt(doc, hover);
    status.textContent = M.tileText(doc.bp, hover, ref, (r) => E.describeRef(doc, r));
  }

  // ---- overlay: brush / footprint / selection ------------------------------------------------------
  function drawOverlay() {
    const g = view.canvas.getContext && view.canvas.getContext('2d');
    if (!g) return;
    const ts = view.ts;
    const rect = (x, y, w, hh, color, fill) => {
      const p = view.tileToScreen(x, y);
      if (fill) { g.fillStyle = fill; g.fillRect(p.x, p.y, w * ts, hh * ts); }
      g.strokeStyle = color; g.lineWidth = 2; g.strokeRect(p.x + 1, p.y + 1, w * ts - 2, hh * ts - 2);
    };
    const z = view.level;
    if (selection) {
      const ent = E.getRef(doc, selection);
      if (ent && (ent.pos.z || 0) === z) {
        const id = selection.kind === 'object' ? ent.defId : selection.kind === 'town' ? 'town' : E.HERO_ID;
        for (const p of E.footprintOf(id, ent.pos)) rect(p.x, p.y, 1, 1, '#ffe9a6', 'rgba(255,233,166,0.12)');
      }
    }
    if (move && move.to && E.getRef(doc, move.ref)) {
      const ent = E.getRef(doc, move.ref);
      const id = move.ref.kind === 'object' ? ent.defId : move.ref.kind === 'town' ? 'town' : E.HERO_ID;
      const dest = { x: ent.pos.x + (move.to.x - move.from.x), y: ent.pos.y + (move.to.y - move.from.y), z };
      const okk = E.canPlace(doc, id, dest, { ignore: move.ref }).ok;
      for (const p of E.footprintOf(id, dest)) rect(p.x, p.y, 1, 1, okk ? '#58d058' : '#e04838', okk ? 'rgba(88,208,88,0.18)' : 'rgba(224,72,56,0.18)');
    }
    if (!hover || hover.z !== z) return;
    const pl = placement();
    if (pl && ['object', 'town', 'hero'].includes(st.tool)) {
      const c = E.canPlace(doc, pl.defId, hover);
      for (const p of c.tiles) rect(p.x, p.y, 1, 1, c.ok ? '#58d058' : '#e04838', c.ok ? 'rgba(88,208,88,0.22)' : 'rgba(224,72,56,0.22)');
      return;
    }
    if (['terrain', 'erase', 'road', 'river'].includes(st.tool)) {
      const n = st.tool === 'terrain' || st.brush > 1 ? st.brush : 1;
      rect(hover.x, hover.y, n, n, '#ffe9a6');
    }
  }

  // ---- minimap --------------------------------------------------------------------------------------
  function drawMinimap(g, w, hh) {
    const bp = doc.bp;
    const z = view.level;
    if (minimapDirty || minimapLevel !== z || !minimapSrc) {
      minimapSrc = document.createElement('canvas');
      minimapSrc.width = bp.map.width;
      minimapSrc.height = bp.map.height;
      try {
        const sg = minimapSrc.getContext('2d');
        const img = sg.createImageData(bp.map.width, bp.map.height);
        const px = minimapPixels(preview, null, z);
        if (img.data && img.data.set) img.data.set(px);
        sg.putImageData(img, 0, 0);
      } catch { /* fake canvas */ }
      minimapDirty = false;
      minimapLevel = z;
    }
    if (g.imageSmoothingEnabled !== undefined) g.imageSmoothingEnabled = false;
    g.drawImage(minimapSrc, 0, 0, w, hh);
  }

  // ---- view controls ------------------------------------------------------------------------------
  function updateLevelBtn() {
    levelBtn.setLabel(view.level ? 'Underground' : 'Surface');
    levelBtn.setDisabled(doc.bp.map.levels < 2);
  }
  function setLevel(z) {
    view.setLevel(z);
    updateLevelBtn();
    minimapDirty = true;
    minimap.redraw();
    if (st.tool === 'terrain' || st.tool === 'fill') {
      if (!E.terrainAllowedOnLevel(st.terrain, view.level)) st.terrain = view.level ? 'subterranean' : 'grass';
      renderOptions();
    }
  }
  function toggleGrid() {
    view.showGrid = !view.showGrid;
    gridBtn.setActive(view.showGrid);
    view.markDirty();
  }

  // ---- undo / redo ----------------------------------------------------------------------------------
  function doUndo() {
    endStroke();
    const r = E.undo(doc);
    if (r.ok) { sync({ terrain: tilesOfKeys(r.keys) }); ctx.toast(`Undo: ${r.label}`, 'info', 900); }
    return r;
  }
  function doRedo() {
    endStroke();
    const r = E.redo(doc);
    if (r.ok) { sync({ terrain: tilesOfKeys(r.keys) }); ctx.toast(`Redo: ${r.label}`, 'info', 900); }
    return r;
  }

  // ---- menus ----------------------------------------------------------------------------------------
  async function confirmDiscard() {
    if (doc.version === doc.savedVersion || (!E.canUndo(doc) && !savedId)) return true;
    return ui.confirm('Discard the unsaved changes of this map?', { danger: true });
  }

  async function menuNew() {
    if (!(await confirmDiscard())) return null;
    const v = await D.newMapDialog(ui);
    if (!v) return null;
    setDoc(E.newMap(v));
    return doc;
  }

  async function menuRandom() {
    if (!(await confirmDiscard())) return null;
    let templates = [];
    try { const gen = await ctx.engine.load('mapgen'); templates = gen && gen.listTemplates ? gen.listTemplates() : []; } catch { templates = []; }
    const v = await D.randomMapDialog(ui, templates);
    if (!v) return null;
    const r = E.blueprintFromRandomMap(v);
    if (!r.ok) { await ui.message(`The map could not be generated: ${r.error}`, { title: 'Random map' }); return null; }
    setDoc(E.createEditor(r.bp, { seed: v.seed }));
    return doc;
  }

  async function menuOpen() {
    if (!(await confirmDiscard())) return null;
    const res = await D.openMapDialog(ui, library, { onExport: (id) => exportId(id) });
    if (!res) return null;
    if (res.action === 'open') return openId(res.id);
    if (res.action === 'import') return importText(res.text, res.name);
    return null;
  }

  function openId(id) {
    const r = library.load(id);
    if (!r.ok) { ui.message(`The map could not be opened (${r.error}).`, { title: 'Open map' }); return null; }
    const d = E.deserializeMap(r.bp);
    if (!d.ok) { ui.message(`The map is damaged (${d.error}).`, { title: 'Open map' }); return null; }
    setDoc(E.createEditor(d.bp), { id });
    return doc;
  }

  function importText(text, name) {
    const d = E.deserializeMap(text);
    if (!d.ok) { ui.message(`This file is not a map (${d.error}).`, { title: 'Import map' }); return null; }
    if (!d.bp.meta.name || d.bp.meta.name === 'Untitled map') d.bp.meta.name = name || 'Imported map';
    setDoc(E.createEditor(d.bp));
    ctx.toast('Map imported - save it to keep it in the library.', 'good');
    return doc;
  }

  async function menuSave({ as = false } = {}) {
    let id = savedId;
    if (!id || as) {
      const name = await ui.prompt({ title: 'Save map', label: 'Map name', value: doc.bp.meta.name || 'My map' });
      if (name == null || !String(name).trim()) return null;
      if (name !== doc.bp.meta.name) { E.setMapInfo(doc, { name }); sync(); }
      const existing = library.meta(mapIdOf(name));
      if (existing && existing.id !== savedId && !(await ui.confirm(`Overwrite the saved map "${existing.name}"?`))) return null;
      id = mapIdOf(name);
    }
    const r = library.save(doc.bp, { id });
    if (!r.ok) { ui.message(`Saving failed (${r.error}).`, { title: 'Save map' }); return r; }
    savedId = r.id;
    doc.savedVersion = doc.version;
    renderTitle();
    remember();
    ctx.toast(`Map saved: ${doc.bp.meta.name}`, 'good');
    return r;
  }
  const mapIdOf = (name) => String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'map';

  function exportId(id) {
    const r = library.load(id);
    if (!r.ok) return;
    const meta = library.meta(id);
    if (downloadText(`${id}.h3m.json`, E.serializeMap(r.bp))) ctx.toast(`Exported ${meta ? meta.name : id}.`, 'good');
  }
  function menuExport() {
    const text = E.serializeMap(doc.bp);
    if (downloadText(`${mapIdOf(doc.bp.meta.name || 'map')}.h3m.json`, text)) ctx.toast('Map exported.', 'good');
    else ui.message('This browser cannot download files from the page.', { title: 'Export failed' });
    return text;
  }

  async function menuSettings() {
    const applied = await D.settingsDialog(ui, doc, { onError: (errs) => ui.message(errs.join('\n'), { title: 'Some settings were not applied' }) });
    if (applied) { sync({ all: doc.bp.map !== previewMap }); renderOptions(); updateLevelBtn(); }
    return applied;
  }

  async function menuEvents() {
    const r = await D.timedEventsDialog(ui, ctx.sprite, doc, { onError: (x) => report(x) });
    sync();
    return r;
  }

  async function menuValidate() {
    const res = E.validateMap(doc.bp);
    const p = await D.validateDialog(ui, res);
    if (p && p.pos) jumpTo(p.pos);
    return res;
  }

  function jumpTo(pos) {
    setLevel(pos.z || 0);
    view.centerOnTile(pos.x, pos.y, pos.z || 0);
    const ref = E.refAt(doc, pos);
    setTool('select');
    select(ref);
    hover = { x: pos.x, y: pos.y, z: pos.z || 0 };
    view.setHover(hover);
  }

  async function menuPlay() {
    const res = E.validateMap(doc.bp);
    if (!res.ok) {
      const p = await D.validateDialog(ui, res);
      if (p && p.pos) jumpTo(p.pos);
      return null;
    }
    const choice = await D.playDialog(ui, doc.bp);
    if (!choice) return null;
    return startPlay(choice);
  }

  async function startPlay({ seats, difficulty }) {
    const game = await ctx.engine.load('game');
    if (!game || typeof game.createGame !== 'function') { await ui.message('The game engine is not available.', { title: 'Play' }); return null; }
    let state;
    try {
      state = game.createGame(E.prepareForPlay(doc.bp), E.buildPlaySettings(doc.bp, seats, { seed: (Date.now() % 100000) + 1, difficulty }));
    } catch (err) {
      ctx.log(`Game creation failed: ${err.stack || err.message}`, 'error');
      await ui.message(`The game could not be created:\n${err.message}`, { title: 'Could not start' });
      return null;
    }
    remember();
    ctx.setState(state, { silent: true });
    ctx.audio.play('daystart');
    await ctx.showScreen('adventure', { newGame: true });
    return state;
  }

  async function menuExit() {
    if (!(await confirmDiscard())) return false;
    session = null;
    await ctx.showScreen('mainMenu');
    return true;
  }

  // ---- keys -----------------------------------------------------------------------------------------
  for (const t of M.TOOLS) ctx.keys.bind(t.key, () => setTool(t.id), `${t.label} tool`);
  ctx.keys.bind('ctrl+z', () => doUndo(), 'Undo');
  ctx.keys.bind(['ctrl+y', 'ctrl+shift+z'], () => doRedo(), 'Redo');
  ctx.keys.bind('ctrl+s', () => menuSave(), 'Save map');
  ctx.keys.bind(['delete', 'backspace'], () => deleteSelection(), 'Delete selection');
  ctx.keys.bind('g', () => toggleGrid(), 'Grid');
  ctx.keys.bind('u', () => setLevel(view.level ? 0 : 1), 'Surface / underground');
  ctx.keys.bind(['+', '='], () => view.zoom(1), 'Zoom in');
  ctx.keys.bind('-', () => view.zoom(-1), 'Zoom out');
  const pan = (dx, dy) => () => view.panBy(-dx * view.ts * 2, -dy * view.ts * 2);
  ctx.keys.bind('arrowleft', pan(-1, 0), 'Scroll left');
  ctx.keys.bind('arrowright', pan(1, 0), 'Scroll right');
  ctx.keys.bind('arrowup', pan(0, -1), 'Scroll up');
  ctx.keys.bind('arrowdown', pan(0, 1), 'Scroll down');
  ctx.keys.bind('escape', () => { if (selection) select(null); else menuExit(); }, 'Deselect / exit');

  offs.push(view.subscribeSprites());

  function frame() {
    if (destroyed) return false;
    if (doc.version !== previewVersion) sync();
    if (view.dirty) {
      view.render();
      drawOverlay();
      const vf = view.viewportFraction();
      const key = `${vf.x.toFixed(4)},${vf.y.toFixed(4)},${vf.w.toFixed(4)},${view.level},${minimapDirty}`;
      if (key !== camKey) { camKey = key; minimap.setViewport(vf); }
    }
    return true;
  }

  const api = {
    el, view, minimap, library,
    get doc() { return doc; },
    get selection() { return selection; },
    get tool() { return st.tool; },
    get savedId() { return savedId; },
    options: st,
    setTool, select, beginStroke, paintAt, endStroke, applyInspector, deleteSelection, doUndo, doRedo, setLevel, toggleGrid, jumpTo,
    menuNew, menuRandom, menuOpen, menuSave, menuExport, menuSettings, menuEvents, menuValidate, menuPlay, startPlay, menuExit, openId, importText, setDoc,
    frame, sync, placement, get inspectorValues() { return inspectorValues; },
    /** Tool action on a tile (tests / e2e): what a click with the current tool does. */
    clickTile(t) { beginStroke({ x: t.x, y: t.y, z: t.z ?? view.level }); endStroke(); },
    /** Drag with the current tool along tiles. */
    dragTiles(tiles) {
      if (!tiles.length) return;
      beginStroke(tiles[0]);
      for (const t of tiles.slice(1)) {
        if (stroke) { paintAt(stroke.last, t); stroke.last = t; }
        if (move) move.to = t;
      }
      endStroke();
    },
    async start() {
      if (params.blueprint) {
        const d = E.deserializeMap(params.blueprint);
        if (d.ok) setDoc(E.createEditor(d.bp));
      } else if (params.mapId) {
        openId(params.mapId);
      }
      renderTools();
      renderOptions();
      sync({ all: true });
      if (!session || !session.centered) centerOnStart();
      session.centered = true;
      updateLevelBtn();
      setStatus();
      view.render(true);
      drawOverlay();
      minimap.setViewport(view.viewportFraction());
      ctx.anim.loop(frame);
    },
    destroy() {
      destroyed = true;
      endStroke();
      remember();
      for (const off of offs.splice(0)) { try { off(); } catch { /* ignore */ } }
      minimap.destroy();
    },
  };
  return api;
}
