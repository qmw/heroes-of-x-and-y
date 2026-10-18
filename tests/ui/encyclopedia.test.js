import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, createFakeStorage, fire, tick } from './fakeDom.js';

const dom = installFakeDom();
const { buildEncyclopedia, filterEntries, searchAll, buildTree, effectText, CATEGORIES } = await import('../../src/ui/screens/encyclopediaModel.js');
const { createApp } = await import('../../src/ui/app.js');
const { CREATURES } = await import('../../src/data/creatures.js');
const { ABILITIES } = await import('../../src/data/abilities.js');
const { HEROES } = await import('../../src/data/heroes.js');
const { HERO_CLASSES } = await import('../../src/data/heroClasses.js');
const { SKILLS } = await import('../../src/data/skills.js');
const { SPELLS } = await import('../../src/data/spells.js');
const { ARTIFACTS } = await import('../../src/data/artifacts.js');
const { FACTIONS_DATA } = await import('../../src/data/factions.js');
const { BUILDINGS, buildingsForFaction } = await import('../../src/data/buildings.js');
const { TERRAIN_DATA, MAGIC_TERRAINS, ROADS, RIVERS } = await import('../../src/data/terrain.js');
const { MAP_OBJECTS } = await import('../../src/data/mapObjects.js');

const enc = buildEncyclopedia();

test('there is an entry for every id of every data module', () => {
  const expect = {
    creature: CREATURES, hero: HEROES, class: HERO_CLASSES, skill: SKILLS, spell: SPELLS, artifact: ARTIFACTS,
    faction: FACTIONS_DATA, building: BUILDINGS, object: MAP_OBJECTS,
    terrain: [...TERRAIN_DATA, ...MAGIC_TERRAINS, ...ROADS, ...RIVERS],
    ability: Object.keys(ABILITIES).map((id) => ({ id })),
  };
  let total = 0;
  for (const [cat, list] of Object.entries(expect)) {
    assert.equal(enc.byCat[cat].length, list.length, `${cat} count`);
    for (const item of list) {
      const e = enc.byKey.get(`${cat}:${item.id}`);
      assert.ok(e, `${cat}:${item.id}`);
      assert.ok(e.name && e.icon && e.icon.kind && e.icon.id, `${e.key} has a name and an icon`);
    }
    total += list.length;
  }
  assert.equal(enc.entries.length, total);
  assert.equal(enc.byKey.size, total, 'keys are unique');
  assert.deepEqual(CATEGORIES.map((c) => c.id).sort(), Object.keys(expect).sort());
  assert.equal(buildEncyclopedia(), enc, 'cached');
});

test('every entry builds its detail blocks without throwing, and every cross-link resolves', () => {
  const kinds = new Set(['text', 'title', 'stats', 'cost', 'links', 'table', 'gallery', 'creature', 'tree']);
  let links = 0;
  const check = (key, from) => { links++; assert.ok(enc.byKey.has(key), `${from} links to missing ${key}`); };
  for (const e of enc.entries) {
    const blocks = e.blocks();
    assert.ok(blocks.length > 0, `${e.key} has content`);
    for (const b of blocks) {
      assert.ok(kinds.has(b.t), `${e.key}: unknown block type ${b.t}`);
      if (b.t === 'links') for (const l of b.links) { assert.ok(l.label, `${e.key}: link without label`); check(l.key, e.key); }
      if (b.t === 'gallery') for (const it of b.items) { assert.ok(it.kind && it.id && it.label, `${e.key}: bad gallery item`); if (it.key) check(it.key, e.key); }
      if (b.t === 'table') for (const row of b.rows) { assert.equal(row.length, b.head.length, `${e.key}: ragged table`); for (const c of row) if (c && c.key) check(c.key, e.key); }
      if (b.t === 'tree') for (const col of b.columns) for (const n of col) check(n.key, e.key);
      if (b.t === 'creature') check(`creature:${b.id}`, e.key);
      if (b.t === 'stats') for (const row of b.rows) assert.equal(row.length, 2, `${e.key}: bad stats row`);
      if (b.t === 'text' || b.t === 'title') assert.equal(typeof b.text, 'string', `${e.key}: text block`);
    }
  }
  assert.ok(links > 5000, `the catalog is densely cross-linked (${links} links)`);
});

test('cross-links go both ways for the important relations', () => {
  const linksOf = (key) => enc.byKey.get(key).blocks().flatMap((b) => (b.t === 'links' ? b.links.map((l) => l.key) : b.t === 'gallery' ? b.items.map((i) => i.key) : []));
  assert.ok(linksOf('creature:pikeman').includes('creature:halberdier'));
  assert.ok(linksOf('creature:pikeman').includes('faction:castle'));
  assert.ok(linksOf('creature:pikeman').includes('building:castle_dwelling_1'));
  assert.ok(linksOf('creature:pikeman').includes('object:guardhouse'));
  assert.ok(linksOf('creature:pikeman').includes('ability:charge_immunity'));
  assert.ok(linksOf('ability:charge_immunity').includes('creature:pikeman'));
  assert.ok(linksOf('faction:castle').includes('creature:arch_angel'));
  assert.ok(linksOf('faction:castle').includes('class:knight'));
  assert.ok(linksOf('faction:castle').includes('hero:christian'));
  assert.ok(linksOf('hero:christian').includes('class:knight'));
  assert.ok(linksOf('hero:christian').includes('skill:leadership'));
  assert.ok(linksOf('skill:leadership').includes('hero:christian'));
  assert.ok(linksOf('class:knight').includes('hero:christian'));
  assert.ok(linksOf('artifact:angelic_alliance').includes('artifact:sword_of_judgement'));
  assert.ok(linksOf('artifact:sword_of_judgement').includes('artifact:angelic_alliance'));
  assert.ok(linksOf('building:castle_dwelling_1').includes('creature:pikeman'));
  assert.ok(linksOf('building:fort').some((k) => k.startsWith('building:')), 'fort unlocks other buildings');
});

test('build tree: every building of the town appears once, after its prerequisites', () => {
  for (const f of FACTIONS_DATA) {
    const blds = buildingsForFaction(f.id);
    const cols = buildTree(blds);
    const depth = new Map();
    cols.forEach((col, i) => col.forEach((n) => depth.set(n.key.slice('building:'.length), i)));
    assert.equal(depth.size, blds.length, `${f.id}: all buildings placed`);
    for (const b of blds) {
      for (const r of [...b.requires, ...(b.replaces ? [b.replaces] : [])]) {
        if (depth.has(r)) assert.ok(depth.get(r) < depth.get(b.id), `${f.id}: ${r} comes before ${b.id}`);
      }
    }
    assert.ok(cols[0].length > 0);
  }
});

test('filters and search', () => {
  const castle1 = filterEntries(enc, { cat: 'creature', filters: { faction: 'castle', tier: 1 } });
  assert.deepEqual(castle1.map((e) => e.id).sort(), ['halberdier', 'pikeman']);
  const shooters = filterEntries(enc, { cat: 'creature', filters: { type: 'shooter', faction: 'castle' } });
  assert.ok(shooters.some((e) => e.id === 'archer') && shooters.every((e) => e.f.type.includes('shooter')));
  assert.equal(filterEntries(enc, { cat: 'creature', filters: { faction: '', tier: null } }).length, CREATURES.length, 'empty filter values mean "any"');
  assert.deepEqual(filterEntries(enc, { cat: 'spell', search: 'magic arrow' }).map((e) => e.id), ['magic_arrow']);
  assert.ok(filterEntries(enc, { cat: 'spell', filters: { school: 'air', level: 1 } }).every((e) => e.f.school === 'air' && e.f.level === 1));
  assert.ok(filterEntries(enc, { cat: 'artifact', filters: { class: 'combo' } }).length > 5);
  assert.ok(filterEntries(enc, { cat: 'building', filters: { faction: 'common' } }).some((e) => e.id === 'capitol'));
  assert.equal(filterEntries(enc, { cat: 'creature', search: 'zzzzqq' }).length, 0);
  const hits = searchAll(enc, 'angel');
  assert.equal(hits[0].name.toLowerCase(), 'angel', 'exact name matches first');
  assert.ok(hits.some((e) => e.key === 'creature:arch_angel'));
  assert.ok(new Set(hits.map((e) => e.cat)).size > 1, 'global search crosses categories');
  assert.deepEqual(searchAll(enc, '   '), []);
  // every declared filter option selects at least one entry, and filter ids exist on entries
  for (const [cat, defs] of Object.entries(enc.filters)) {
    for (const f of defs) for (const o of f.options) {
      assert.ok(filterEntries(enc, { cat, filters: { [f.id]: o.value } }).length > 0, `${cat}.${f.id}=${o.value} matches something`);
    }
  }
});

test('effectText renders bonuses readably', () => {
  assert.equal(effectText({ type: 'primary', stat: 'attack', value: 2 }), 'Primary: stat Attack, value 2');
  assert.equal(effectText({ type: 'grail' }), 'Grail');
  assert.match(effectText({ type: 'creature_stat', filter: { tier: 1 }, percent: 10 }), /filter \(tier 1\), percent 10/);
  assert.equal(effectText(null), '');
});

test('the screen mounts, renders every entry and follows links', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = createApp(root, { storageBackend: createFakeStorage(), importer: async () => { throw new Error('none'); }, gfxLoader: async () => { throw new Error('none'); } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await app.start('encyclopedia', { key: 'spell:haste' }), true);
    const screen = app.layers.screen;
    assert.equal(app.layers.error.children.length, 0);
    assert.equal(screen.querySelector('.enc-detail-title').textContent, 'Haste');
    assert.ok(screen.querySelector('[data-cat="spell"]').classList.contains('is-active'));
    assert.equal(screen.querySelectorAll('.enc-cat').length, CATEGORIES.length);

    // switch category through the UI, pick a row, follow a link
    screen.querySelector('[data-cat="creature"]').click();
    assert.equal(screen.querySelectorAll('.enc-list .k-list-row').length, CREATURES.length);
    const row = screen.querySelectorAll('.enc-list .k-list-row').find((r) => /Pikeman/.test(r.textContent));
    row.click();
    assert.equal(screen.querySelector('.enc-detail-title').textContent, 'Pikeman');
    assert.match(screen.querySelector('.enc-detail-body').textContent, /Upgrade line.*Halberdier/);
    screen.querySelector('.enc-detail-body [data-key="faction:castle"]').click();
    assert.equal(screen.querySelector('.enc-detail-title').textContent, 'Castle');
    assert.ok(screen.querySelector('[data-cat="faction"]').classList.contains('is-active'));
    assert.ok(screen.querySelector('.enc-tree'), 'build tree rendered');
    // history: Alt+Left goes back to the pikeman
    fire(dom.window, 'keydown', { key: 'ArrowLeft', altKey: true });
    assert.equal(screen.querySelector('.enc-detail-title').textContent, 'Pikeman');
    fire(dom.window, 'keydown', { key: 'ArrowRight', altKey: true });
    assert.equal(screen.querySelector('.enc-detail-title').textContent, 'Castle');

    // filter + search in the list
    screen.querySelector('[data-cat="creature"]').click();
    const filter = screen.querySelector('.enc-filter');
    filter.value = '2';                               // 0 = any, 1 = Castle, 2 = Rampart
    fire(filter, 'change');
    const rows = screen.querySelectorAll('.enc-list .k-list-row');
    assert.equal(rows.length, 14);
    assert.match(screen.querySelector('.enc-count').textContent, /^14 \/ /);

    // render every single entry through the real view
    const mod = await import('../../src/ui/screens/encyclopedia.js');
    await app.showScreen('mainMenu').catch(() => {});
    const host = document.createElement('div');
    const api = mod.mount(host, app.ctx, {});
    for (const e of enc.entries) {
      api.open(e.key);
      assert.equal(host.querySelector('.enc-detail-title').textContent, e.name, e.key);
      assert.ok(!/could not be built/.test(host.querySelector('.enc-detail-body').textContent), e.key);
    }
    mod.unmount();
  } finally {
    console.warn = warn;
    await app.destroy();
  }
  await tick();
});
