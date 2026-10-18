// Encyclopedia screen: browsable / searchable / filterable catalog of all game data with
// cross-links. Depends only on data + sprites (model: encyclopediaModel.js).
// params: { key?: 'creature:pikeman' }  - open directly on an entry (other screens can deep-link:
//         ctx.showScreen('encyclopedia', { key: 'spell:haste' }) and return with ctx.back()).
import { buildEncyclopedia, filterEntries, searchAll } from './encyclopediaModel.js';

let cleanup = null;

export function mount(root, ctx, params = {}) {
  const ui = ctx.ui;
  const { h, clear } = ui;
  const enc = buildEncyclopedia();
  const view = { cat: 'creature', filters: {}, search: '', key: null, history: [], future: [] };

  const detail = h('div.enc-detail-body');
  const detailTitle = h('div.enc-detail-title', null, 'Encyclopedia');
  const backBtn = ui.IconButton('<', { size: 30, tooltip: 'Previous entry (Alt+Left)', onClick: () => histBack() });
  const fwdBtn = ui.IconButton('>', { size: 30, tooltip: 'Next entry (Alt+Right)', onClick: () => histForward() });
  const filterRow = h('div.enc-filters');
  const countLabel = h('div.enc-count');
  const searchInput = ui.TextInput({ placeholder: 'Search this category...', width: 250, onInput: (v) => { view.search = v; refreshList(); } });
  const globalInput = ui.TextInput({ placeholder: 'Search everything...', width: 260, onInput: (v) => showGlobalResults(v) });

  const list = ui.ScrollList({
    class: 'enc-list',
    keyOf: (e) => e.key,
    emptyText: 'No entries match.',
    renderItem: (e) => h('div.enc-row', null, ctx.sprite(e.icon.kind, e.icon.id, { size: 34 }),
      h('div.enc-row-text', null, h('div.enc-row-name', null, e.name), h('div.enc-row-sub', null, e.sub))),
    onSelect: (e) => open(e.key, { fromList: true }),
  });

  const catButtons = new Map();
  const cats = h('div.enc-cats', null, enc.categories.map((c) => {
    const b = h('button.k-tab.enc-cat', { type: 'button', dataset: { cat: c.id } },
      ctx.sprite(c.icon.kind, c.icon.id, { size: 26 }), h('span.enc-cat-name', null, c.name),
      h('span.k-tab-badge', null, String((enc.byCat[c.id] || []).length)));
    b.addEventListener('click', () => {
      ctx.audio.play('click');
      setCategory(c.id);
      // show the category's first entry instead of a stale page from another category
      const cur = view.key && enc.byKey.get(view.key);
      if ((!cur || cur.cat !== c.id) && list.items[0]) open(list.items[0].key);
    });
    catButtons.set(c.id, b);
    return b;
  }));

  root.appendChild(h('div.enc', null,
    h('div.enc-top', null,
      h('div.enc-heading', null, 'Encyclopedia'),
      h('div.enc-top-right', null, globalInput, ui.Button('Back', { hotkey: 'Esc', onClick: () => ctx.back() }))),
    h('div.enc-main', null,
      ui.Panel({ class: 'enc-cats-panel' }, cats),
      ui.Panel({ class: 'enc-list-panel' }, h('div.enc-list-head', null, searchInput, countLabel), filterRow, list),
      ui.Panel({ class: 'enc-detail-panel', variant: 'parchment' },
        h('div.enc-detail-head', null, backBtn, fwdBtn, detailTitle), detail))));

  function setCategory(cat, keepFilters = false) {
    view.cat = cat;
    if (!keepFilters) { view.filters = {}; view.search = ''; searchInput.value = ''; }
    for (const [id, b] of catButtons) b.classList.toggle('is-active', id === cat);
    clear(filterRow, (enc.filters[cat] || []).map((f) => ui.Select({
      class: 'enc-filter',
      options: [{ value: '', label: `${f.label}: any` }, ...f.options],
      value: view.filters[f.id] ?? '',
      onChange: (v) => { view.filters[f.id] = v; refreshList(); },
    })));
    refreshList();
  }

  function refreshList() {
    const items = filterEntries(enc, { cat: view.cat, search: view.search, filters: view.filters });
    list.setItems(items, view.key);
    countLabel.textContent = `${items.length} / ${(enc.byCat[view.cat] || []).length}`;
  }

  function showGlobalResults(text) {
    if (!text.trim()) { if (view.key) render(enc.byKey.get(view.key)); return; }
    const hits = searchAll(enc, text);
    detailTitle.textContent = `Search: "${text.trim()}"`;
    clear(detail, hits.length
      ? h('div.enc-gallery', null, hits.map((e) => galleryItem({ kind: e.icon.kind, id: e.icon.id, label: e.name, key: e.key, note: enc.categories.find((c) => c.id === e.cat).name })))
      : h('p', null, 'Nothing found.'));
  }

  /** Creature sprites in the entry head play their idle animation (Duelyst sheets); others are static. */
  function liveSprite(kind, id, size) {
    const c = ctx.sprite(kind, id, { size });
    if (kind !== 'creature' || !ctx.anim || typeof c.getContext !== 'function') return c;
    const g = c.getContext('2d');
    let t = 0;
    let last = -1;
    ctx.anim.loop((dt) => {
      if (!c.isConnected && t > 500) return false;          // replaced by another entry / screen left
      t += dt || 16;
      const frame = Math.floor(t / 110);
      if (frame === last || !g) return true;
      last = frame;
      g.clearRect(0, 0, c.width, c.height);
      ctx.drawSprite(g, kind, id, 0, 0, { size: c.height, frame, state: 'idle', box: { w: c.width, h: c.height, ax: c.width / 2, ay: Math.round(c.height * 0.95) }, minBody: Math.round(c.height * 0.8) });
      return true;
    });
    return c;
  }

  /** Navigate to an entry by key. */
  function open(key, o = {}) {
    const e = enc.byKey.get(key);
    if (!e) { ctx.toast(`No encyclopedia entry for ${key}`, 'warn'); return; }
    if (view.key && view.key !== key && !o.isHistory) { view.history.push(view.key); view.future.length = 0; }
    view.key = key;
    if (!o.fromList) {
      if (e.cat !== view.cat) setCategory(e.cat);
      let idx = list.items.indexOf(e);
      if (idx < 0) { view.filters = {}; view.search = ''; searchInput.value = ''; setCategory(e.cat); idx = list.items.indexOf(e); }
      list.select(idx, true);
      list.scrollToSelected();
    }
    if (globalInput.value) globalInput.value = '';
    render(e);
  }
  function histBack() {
    if (!view.history.length) return;
    view.future.push(view.key);
    open(view.history.pop(), { isHistory: true });
  }
  function histForward() {
    if (!view.future.length) return;
    view.history.push(view.key);
    open(view.future.pop(), { isHistory: true });
  }

  const link = (l) => {
    if (!l.key || !enc.byKey.has(l.key)) return h('span', null, l.label);
    const a = h('span.k-link', { dataset: { key: l.key } }, l.label);
    a.addEventListener('click', () => { ctx.audio.play('click'); open(l.key); });
    return a;
  };
  const cell = (c) => {
    if (c != null && typeof c === 'object') {
      if (c.cost) return ui.CostView(c.cost);
      if (c.key) return link(c);
    }
    return String(c ?? '');
  };
  function galleryItem(it) {
    const el = h('div.enc-gitem', { class: it.key && 'is-clickable' },
      ctx.sprite(it.kind, it.id, { size: 48 }), h('div.enc-gitem-label', null, it.label), it.note ? h('div.enc-gitem-note', null, it.note) : null);
    if (it.key && enc.byKey.has(it.key)) el.addEventListener('click', () => { ctx.audio.play('click'); open(it.key); });
    return el;
  }

  function renderBlock(b) {
    switch (b.t) {
      case 'text': return h('p.enc-text', null, b.text);
      case 'title': return h('h3.enc-h', null, b.text);
      case 'stats': return h('div.enc-stats', null, b.rows.map(([l, v]) => ui.StatLine(l, v)));
      case 'cost': return h('div.enc-line', null, h('b', null, `${b.label}: `), ui.CostView(b.cost));
      case 'links': return b.links.length ? h('div.enc-line', null, h('b', null, `${b.label}: `),
        b.links.map((l, i) => [i ? ', ' : null, link(l)])) : null;
      case 'table': return h('table.enc-table', null,
        h('thead', null, h('tr', null, b.head.map((x) => h('th', null, x)))),
        h('tbody', null, b.rows.map((r) => h('tr', null, r.map((c) => h('td', null, cell(c)))))));
      case 'gallery': return b.items.length ? h('div.enc-gblock', { class: b.compact && 'is-compact' },
        b.label ? h('div.enc-glabel', null, b.label) : null, h('div.enc-gallery', null, b.items.map(galleryItem))) : null;
      case 'creature': return ui.CreatureCard({ creatureId: b.id, onLink: (kind, id) => open(`${kind}:${id}`) });
      case 'tree': return h('div.enc-tree', null, b.columns.map((col, i) => h('div.enc-tree-col', null,
        h('div.enc-tree-head', null, i === 0 ? 'No prerequisites' : `Step ${i}`),
        col.map((n) => {
          const node = h('div.enc-tree-node', { class: `enc-tree-${n.kind}` }, h('div.enc-tree-name', null, n.label),
            ui.CostView(n.cost, null, { size: 14 }), n.requires.length ? h('div.enc-tree-req', null, `Needs: ${n.requires.join(', ')}`) : null);
          node.addEventListener('click', () => open(n.key));
          return node;
        }))));
      default: return null;
    }
  }

  function render(e) {
    detailTitle.textContent = e.name;
    backBtn.setDisabled(!view.history.length);
    fwdBtn.setDisabled(!view.future.length);
    let blocks;
    try { blocks = e.blocks(); } catch (err) { blocks = [{ t: 'text', text: `This entry could not be built: ${err.message}` }]; }
    clear(detail,
      h('div.enc-entry-head', null, h('div.k-frame', null, liveSprite(e.icon.kind, e.icon.id, 72)),
        h('div', null, h('div.enc-entry-name', null, e.name), h('div.enc-entry-sub', null, e.sub))),
      blocks.map(renderBlock));
    detail.scrollTop = 0;
  }

  ctx.keys.bind('escape', () => ctx.back(), 'Back');
  ctx.keys.bind('alt+arrowleft', histBack, 'Previous entry');
  ctx.keys.bind('alt+arrowright', histForward, 'Next entry');
  ctx.keys.bind('/', () => { if (searchInput.focus) searchInput.focus(); }, 'Search');
  ctx.keys.bind('arrowdown', () => step(1), 'Next in list');
  ctx.keys.bind('arrowup', () => step(-1), 'Previous in list');
  function step(d) {
    if (!list.items.length) return;
    const i = Math.max(0, Math.min(list.items.length - 1, list.selectedIndex + d));
    list.select(i);
    list.scrollToSelected();
  }

  setCategory('creature');
  if (params.key && enc.byKey.has(params.key)) open(params.key);
  else if (list.items.length) open(list.items[0].key);
  cleanup = () => { view.history.length = 0; };
  return { open, view, list, enc };
}

export function unmount() {
  if (cleanup) cleanup();
  cleanup = null;
}
