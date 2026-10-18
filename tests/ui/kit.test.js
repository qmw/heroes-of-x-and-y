import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fire, tick } from './fakeDom.js';

const dom = installFakeDom();
const ui = await import('../../src/ui/kit/index.js');
const sprites = await import('../../src/ui/sprites.js');
const { SPELL_BY_ID } = await import('../../src/data/spells.js');

test('h() builds elements with classes, id, dataset, style, events and nested children', () => {
  let clicks = 0;
  const el = ui.h('div.a.b#main', { dataset: { id: 7 }, style: { width: 40, opacity: 0.5, '--x': 'red' }, title: 'T', onClick: () => clicks++ },
    'text', 5, null, false, [ui.h('span.c', null, 'in'), ['deep']]);
  assert.equal(el.tagName, 'DIV');
  assert.ok(el.classList.contains('a') && el.classList.contains('b'));
  assert.equal(el.id, 'main');
  assert.equal(el.dataset.id, '7');
  assert.equal(el.style.width, '40px');
  assert.equal(el.style.opacity, '0.5');
  assert.equal(el.style['--x'], 'red');
  assert.equal(el.title, 'T');
  assert.equal(el.textContent, 'text5indeep');
  assert.equal(el.querySelector('.c').textContent, 'in');
  fire(el, 'click');
  assert.equal(clicks, 1);
  // children may be passed without props
  assert.equal(ui.h('p', 'hello').textContent, 'hello');
  assert.equal(ui.h('p', ui.h('b', null, 'x')).children.length, 1);
});

test('text helpers', () => {
  assert.equal(ui.fmt(1234567), '1,234,567');
  assert.equal(ui.fmt(-1500), '-1,500');
  assert.equal(ui.fmtShort(999), '999');
  assert.equal(ui.fmtShort(12500), '12.5k');
  assert.equal(ui.fmtShort(2500000), '2.5M');
  assert.equal(ui.humanize('arch_angel'), 'Arch Angel');
  assert.equal(ui.signed(3), '+3');
  assert.equal(ui.costText({ gold: 1000, wood: 5, ore: 0 }), '1,000 gold, 5 wood');
  assert.equal(ui.costText({}), 'free');
});

test('Button: click, disabled, label, active', () => {
  let n = 0;
  const b = ui.Button('Go', { onClick: () => n++, kind: 'primary', hotkey: 'G' });
  assert.ok(b.classList.contains('k-btn-primary'));
  b.click();
  assert.equal(n, 1);
  b.setDisabled(true);
  b.click();
  fire(b, 'click');
  assert.equal(n, 1, 'disabled buttons ignore clicks');
  b.setDisabled(false);
  b.setLabel('Stop');
  assert.match(b.textContent, /Stop/);
  b.setActive(true);
  assert.ok(b.classList.contains('is-active'));
  const ib = ui.IconButton({ kind: 'ui', id: 'end_turn' }, { onClick: () => n++, size: 40 });
  ib.click();
  assert.equal(n, 2);
  assert.equal(ib.querySelector('canvas').dataset.id, 'end_turn');
});

test('Panel / Frame / StatLine', () => {
  const p = ui.Panel({ title: 'Garrison', variant: 'parchment' }, ui.h('span', null, 'body'));
  assert.ok(p.classList.contains('k-panel-parchment'));
  assert.equal(p.querySelector('.k-panel-title').textContent, 'Garrison');
  assert.equal(p.body.textContent, 'body');
  p.setTitle('X');
  p.setContent('new', ui.h('i', null, '!'));
  assert.equal(p.querySelector('.k-panel-title').textContent, 'X');
  assert.equal(p.body.textContent, 'new!');
  assert.equal(ui.Panel(ui.h('b', null, 'only child')).body.textContent, 'only child');
  assert.ok(ui.Frame({}, ui.h('i')).classList.contains('k-frame'));
  const s = ui.StatLine('Attack', 5);
  s.set(9);
  assert.equal(s.textContent, 'Attack9');
});

test('Tabs switch content lazily and report user changes', () => {
  const changes = [];
  let built = 0;
  const tabs = ui.Tabs({
    tabs: [{ id: 'a', label: 'A', content: 'first' }, { id: 'b', label: 'B', content: () => { built++; return ui.h('em', null, 'second'); } }],
    onChange: (id) => changes.push(id),
  });
  assert.equal(tabs.active, 'a');
  assert.equal(tabs.content.textContent, 'first');
  assert.equal(built, 0);
  tabs.querySelector('[data-tab="b"]').click();
  assert.equal(tabs.active, 'b');
  assert.equal(tabs.content.textContent, 'second');
  assert.deepEqual(changes, ['b']);
  tabs.select('a');
  assert.deepEqual(changes, ['b'], 'programmatic select does not fire onChange');
  assert.ok(tabs.querySelector('[data-tab="a"]').classList.contains('is-active'));
});

test('ScrollList: select, activate, setItems keeps the selection by key', () => {
  const picked = [];
  const activated = [];
  const list = ui.ScrollList({ items: [{ id: 1, name: 'one' }, { id: 2, name: 'two' }], keyOf: (x) => x.id,
    onSelect: (it, i) => picked.push([it.id, i]), onActivate: (it) => activated.push(it.id) });
  assert.equal(list.rows.length, 2);
  list.rows[1].click();
  assert.deepEqual(picked, [[2, 1]]);
  assert.equal(list.selectedItem.id, 2);
  fire(list.rows[0], 'dblclick');
  assert.deepEqual(activated, [1]);
  list.setItems([{ id: 3, name: 'three' }, { id: 2, name: 'two' }]);
  assert.equal(list.selectedIndex, 1, 'selection follows the key');
  list.setItems([]);
  assert.equal(list.selectedIndex, -1);
  assert.match(list.textContent, /Nothing here/);
});

test('Slider and NumberStepper clamp and notify', () => {
  const seen = [];
  const s = ui.Slider({ min: 1, max: 20, value: 50, onChange: (v) => seen.push(v) });
  assert.equal(s.value, 20);
  s.input.value = '7';
  fire(s.input, 'input');
  assert.deepEqual(seen, [7]);
  s.value = -5;
  assert.equal(s.value, 1);
  s.setRange(5, 9);
  assert.equal(s.value, 5);

  const got = [];
  const st = ui.NumberStepper({ min: 0, max: 10, value: 9, onChange: (v) => got.push(v) });
  st.querySelector('.k-stepper-inc').click();
  st.querySelector('.k-stepper-inc').click();
  assert.equal(st.value, 10);
  assert.deepEqual(got, [10]);
  fire(st.querySelector('.k-stepper-dec'), 'click', { shiftKey: true });
  assert.equal(st.value, 0);
  st.input.value = '4';
  fire(st.input, 'change');
  assert.equal(st.value, 4);
  st.value = 99;
  assert.equal(st.value, 10);
  assert.deepEqual(got, [10, 0, 4], 'setting .value programmatically is silent');
});

test('ProgressBar, Select, Checkbox, TextInput', () => {
  const p = ui.ProgressBar({ value: 25, max: 50, label: '25/50' });
  assert.equal(p.querySelector('.k-progress-fill').style.width, '50.0%');
  p.set(100, 50);
  assert.equal(p.querySelector('.k-progress-fill').style.width, '100.0%');

  const picked = [];
  const sel = ui.Select({ options: [{ value: 'a', label: 'Alpha' }, { value: 7, label: 'Seven' }], value: 7, onChange: (v) => picked.push(v) });
  assert.equal(sel.val, 7);
  sel.value = '0';
  fire(sel, 'change');
  assert.deepEqual(picked, ['a']);
  sel.val = 7;
  assert.equal(sel.value, '1');
  sel.setOptions(['x', 'y'], 'y');
  assert.equal(sel.val, 'y');

  const flags = [];
  const c = ui.Checkbox({ label: 'Underground', checked: true, onChange: (v) => flags.push(v) });
  assert.equal(c.isChecked, true);
  c.input.checked = false;
  fire(c.input, 'change');
  assert.deepEqual(flags, [false]);

  const typed = [];
  const ti = ui.TextInput({ value: 'a', onInput: (v) => typed.push(v) });
  ti.value = 'ab';
  fire(ti, 'input');
  assert.deepEqual(typed, ['ab']);
});

test('tooltip shows on hover and hides on leave; info popup follows the right mouse button', async () => {
  const el = ui.h('div');
  let calls = 0;
  ui.attachTooltip(el, () => { calls++; return 'Hello\nWorld'; }, { delay: 0 });
  fire(el, 'mouseenter', { clientX: 10, clientY: 10 });
  const tip = document.body.querySelector('.k-tooltip');
  assert.ok(tip);
  assert.equal(tip.textContent, 'HelloWorld');
  assert.equal(calls, 1);
  fire(el, 'mouseleave');
  assert.equal(document.body.querySelector('.k-tooltip'), null);

  const target = ui.h('div');
  ui.attachInfo(target, () => ui.h('div.info', null, 'details'));
  fire(target, 'mousedown', { button: 0 });
  assert.equal(document.body.querySelector('.k-infopopup'), null, 'left button does nothing');
  const down = fire(target, 'mousedown', { button: 2 });
  assert.ok(down.defaultPrevented);
  assert.equal(document.body.querySelector('.k-infopopup').textContent, 'details');
  assert.ok(ui.isInfoPopupOpen());
  fire(dom.window, 'mouseup', { button: 2 });
  assert.equal(document.body.querySelector('.k-infopopup'), null);
  assert.ok(fire(target, 'contextmenu').defaultPrevented);
});

test('toast and log console', () => {
  const t = ui.toast('Not enough gold', 'error', 0);
  assert.ok(t.classList.contains('k-toast-error'));
  assert.ok(t.parentNode);
  t.click();
  assert.equal(t.parentNode, null);

  const store = ui.createLogStore(3);
  const con = ui.LogConsole({ store, max: 2 });
  store.add('one');
  store.add('two', 'good');
  store.add('three', 'error');
  store.add('four');
  assert.equal(store.entries.length, 3);
  assert.equal(con.children.length, 2);
  assert.equal(con.textContent, 'threefour');
  con.destroy();
  store.add('five');
  assert.equal(con.children.length, 2);
});

test('ResourceBar and CostView', () => {
  const bar = ui.ResourceBar({ resources: { gold: 12345, wood: 7 }, date: { day: 3, week: 2, month: 1 } });
  assert.equal(bar.querySelectorAll('.k-resbar-cell').length, 7);
  assert.equal(bar.querySelector('[data-resource="gold"]').textContent, '12,345');
  assert.match(bar.textContent, /Month 1, Week 2, Day 3/);
  bar.update({ resources: { gold: 5 }, date: { day: 1, week: 1, month: 2 } });
  assert.equal(bar.querySelector('[data-resource="gold"]').textContent, '5');
  assert.equal(bar.querySelector('[data-resource="wood"]').textContent, '0');
  const cost = ui.CostView({ gold: 500, gems: 2 }, { gold: 100, gems: 5 });
  const items = cost.querySelectorAll('.k-cost-item');
  assert.equal(items.length, 2);
  assert.ok(items[0].classList.contains('is-short'));
  assert.ok(!items[1].classList.contains('is-short'));
  assert.match(ui.CostView({}).textContent, /Free/);
});

test('CreatureCard model and element', () => {
  const m = ui.creatureCardModel('archer', { count: 12, stats: { attack: 9, speed: 3 } });
  assert.equal(m.name, 'Archer');
  assert.equal(m.rows.find((r) => r.label === 'Attack').changed, 1);
  assert.equal(m.rows.find((r) => r.label === 'Speed').changed, -1);
  assert.ok(m.rows.some((r) => r.label === 'Shots'));
  assert.ok(m.traits.includes('Shooter'));
  assert.equal(ui.creatureCardModel('nope'), null);
  const linked = [];
  const card = ui.CreatureCard({ creatureId: 'archer', count: 12, onLink: (k, id) => linked.push(`${k}:${id}`) });
  assert.match(card.textContent, /12 Archer/);
  card.querySelector('.k-link').click();
  assert.deepEqual(linked, ['creature:marksman']);
  assert.match(ui.CreatureCard({ creatureId: 'nope' }).textContent, /Unknown creature/);
  const a = ui.abilityText({ id: 'hates', targets: ['devil'], percent: 50 });
  assert.equal(a.name, 'Hates');
  assert.match(a.params, /targets: Devil; percent: 50/);
});

test('hero widgets', () => {
  const hero = { defId: 'christian', classId: 'knight', name: 'Sir Test', level: 5, exp: 9000, mana: 12, movePoints: 900, maxMovePoints: 1500,
    primary: { attack: 4, defense: 3, power: 1, knowledge: 2 }, skills: [{ id: 'leadership', level: 2 }] };
  const m = ui.heroCardModel({ hero, primary: { attack: 6, defense: 3, power: 1, knowledge: 2 } });
  assert.equal(m.title, 'Level 5 Knight');
  assert.equal(m.primary.attack, 6);
  const card = ui.HeroCard({ hero, primary: m.primary, maxMana: 20, showSkills: true });
  assert.match(card.textContent, /Sir Test/);
  assert.ok(card.querySelector('[data-stat="attack"]').classList.contains('is-up'));
  assert.equal(card.querySelectorAll('.k-skill').length, 1);
  assert.match(ui.HeroCard({ defId: 'christian' }).textContent, /Christian/);

  let clicked = 0;
  const p = ui.HeroPortrait({ defId: 'christian', badge: 3, onClick: () => clicked++ });
  p.click();
  assert.equal(clicked, 1);
  p.setSelected(true);
  assert.ok(p.classList.contains('is-selected'));
  p.setBadge(null);
  assert.equal(p.querySelector('.k-portrait-badge').style.display, 'none');

  const ml = ui.MoraleLuckPips({ morale: 2, luck: -5 });
  assert.equal(ml.querySelector('.k-ml-morale').querySelectorAll('.is-on').length, 2);
  assert.equal(ml.querySelector('.k-ml-luck').querySelectorAll('.is-on').length, 3);
  assert.ok(ml.querySelector('.k-ml-luck').classList.contains('is-neg'));
  ml.update({ morale: 0 });
  assert.ok(ml.querySelector('.k-ml-morale').classList.contains('is-zero'));
  assert.equal(ui.moraleLuckText('morale', 2), 'Good morale (+2)');
  assert.equal(ui.moraleLuckText('luck', -1), 'Bad luck (-1)');

  const sk = ui.SkillIcon({ id: 'wisdom', level: 3, showLabel: true });
  assert.match(sk.textContent, /Expert/);
  assert.equal(sk.querySelector('.k-skill-level').textContent, 'III');

  const ps = ui.PrimaryStats({ attack: 1, defense: 2, power: 3, knowledge: 4 });
  assert.equal(ps.querySelectorAll('.k-primary-cell').length, 4);
  ps.update({ attack: 5, defense: 2, power: 3, knowledge: 4 }, { attack: 1, defense: 2, power: 3, knowledge: 4 });
  assert.ok(ps.querySelector('[data-stat="attack"]').classList.contains('is-up'));
});

test('ArtifactGrid lays out every slot and emits move requests', () => {
  assert.equal(ui.paperDollSlots().length, 19);
  const moves = [];
  const picks = [];
  const arts = { equipped: { head: ['helm_of_heavenly_enlightenment'], ring: [null, null] }, backpack: ['centaurs_axe', { id: 'spell_scroll', spellId: 'haste' }], locks: { 'torso:0': 'x' } };
  const grid = ui.ArtifactGrid({ artifacts: arts, onMove: (from, to) => moves.push([from, to]), onPick: (ref) => picks.push(ref) });
  assert.equal(grid.querySelectorAll('.k-art-doll .k-art-slot').length, 19);
  assert.ok(grid.slotEl('torso').classList.contains('is-locked'));
  assert.equal(grid.slotEl('head').entry, 'helm_of_heavenly_enlightenment');
  // empty slot first: nothing happens
  grid.slotEl('ring', 1).click();
  assert.equal(moves.length, 0);
  // select the helm, then click the backpack's free cell
  grid.slotEl('head').click();
  assert.ok(grid.slotEl('head').classList.contains('is-selected'));
  assert.equal(picks.length, 1);
  grid.backpackEls[2].click();
  assert.deepEqual(moves, [[{ grid: 'hero', where: 'equipped', slot: 'head', index: 0 }, { grid: 'hero', where: 'backpack', index: 2 }]]);
  assert.ok(!grid.slotEl('head').classList.contains('is-selected'));
  // backpack -> equipped
  grid.backpackEls[0].click();
  grid.slotEl('right_hand').click();
  assert.deepEqual(moves[1], [{ grid: 'hero', where: 'backpack', index: 0 }, { grid: 'hero', where: 'equipped', slot: 'right_hand', index: 0 }]);
  // clicking the selected slot again deselects without a move
  grid.backpackEls[1].click();
  grid.backpackEls[1].click();
  assert.equal(moves.length, 2);
  assert.equal(ui.artifactEntryName({ id: 'spell_scroll', spellId: 'haste' }), 'Spell Scroll: Haste');
  grid.update({ equipped: {}, backpack: [] });
  assert.equal(grid.slotEl('head').entry, null);
  assert.match(ui.ArtifactInfo('angelic_alliance').textContent, /Assembled from/);
});

test('two ArtifactGrids sharing a selection exchange between heroes', () => {
  const selection = ui.createArtifactSelection();
  const moves = [];
  const a = ui.ArtifactGrid({ id: 'A', selection, artifacts: { equipped: {}, backpack: ['centaurs_axe'] }, onMove: (f, t) => moves.push([f.grid, t.grid]) });
  const b = ui.ArtifactGrid({ id: 'B', selection, artifacts: { equipped: {}, backpack: [] }, onMove: (f, t) => moves.push([f.grid, t.grid]) });
  a.backpackEls[0].click();
  b.backpackEls[0].click();
  assert.deepEqual(moves, [['A', 'B']]);
});

test('SpellbookView pages, filters and selection', () => {
  const ids = ['haste', 'magic_arrow', 'slow', 'bless', 'summon_boat', 'town_portal', 'implosion', 'haste'];
  const pages = ui.spellbookPages(ids, { perPage: 3 });
  assert.equal(pages.flat().length, 7, 'duplicates removed');
  assert.equal(pages.length, 3);
  assert.deepEqual(ui.spellbookPages(ids, { kind: 'adventure' }).flat().sort(), ['summon_boat', 'town_portal']);
  assert.ok(ui.spellbookPages(ids, { school: 'air' }).flat().includes('magic_arrow'), 'all-school spells appear in every school');
  assert.deepEqual(ui.spellbookPages([], {}), [[]]);

  const chosen = [];
  const book = ui.SpellbookView({ spells: ids, mana: 6, perPage: 4, onSelect: (id) => chosen.push(id), canCast: (s) => (s.id === 'bless' ? 'Silenced' : true) });
  assert.equal(book.pages.length, 2);
  book.querySelector('[data-spell="haste"]').click();
  assert.deepEqual(chosen, ['haste']);
  assert.ok(book.querySelector('[data-spell="bless"]').classList.contains('is-disabled'));
  book.querySelector('[data-spell="bless"]').click();
  assert.equal(chosen.length, 1, 'disabled spells cannot be selected');
  book.setKind('adventure');
  assert.equal(book.pages[0].length, 2);
  assert.ok(book.querySelector('[data-spell="town_portal"]').classList.contains('is-disabled'), 'not enough mana');
  book.update({ mana: 99 });
  assert.ok(!book.querySelector('[data-spell="town_portal"]').classList.contains('is-disabled'));
  book.setKind('all');
  book.setSchool('fire');
  const fire = book.pages.flat();
  assert.ok(fire.length > 0);
  assert.ok(fire.every((id) => ['fire', 'all'].includes(SPELL_BY_ID[id].school)), 'only fire and all-school spells');
  assert.ok(fire.includes('magic_arrow') && !fire.includes('haste') && !fire.includes('slow') && !fire.includes('bless'));
  assert.equal(book.querySelectorAll('.k-book-spell').length, fire.length);
  book.setSchool('air');
  assert.deepEqual(book.pages.flat(), ['haste', 'magic_arrow'], 'sorted by level then name');
});

test('Minimap calls draw and reports navigation as fractions', () => {
  let draws = 0;
  const nav = [];
  const mm = ui.Minimap({ width: 100, height: 50, draw: () => draws++, onNavigate: (x, y) => nav.push([x, y]) });
  assert.equal(draws, 1);
  mm.setViewport({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  assert.equal(draws, 2);
  mm.canvas.width = 100; mm.canvas.height = 50;      // fake layout: rect == logical size
  fire(mm.canvas, 'mousedown', { button: 0, clientX: 50, clientY: 25 });
  fire(mm.canvas, 'mousemove', { clientX: 100, clientY: 50 });
  fire(dom.window, 'mouseup');
  fire(mm.canvas, 'mousemove', { clientX: 10, clientY: 10 });
  assert.deepEqual(nav, [[0.5, 0.5], [1, 1]]);
  mm.destroy();
});

test('sprite wrapper: placeholders without gfx, fresh copies with gfx, never throws', () => {
  sprites.setGfx(null);
  const ph = sprites.sprite('creature', 'arch_angel', { size: 40 });
  assert.equal(ph.tagName, 'CANVAS');
  assert.equal(ph.style.width, '40px');
  assert.equal(ph.dataset.id, 'arch_angel');
  assert.equal(sprites.initials('arch_angel'), 'AA');
  assert.equal(sprites.initials('pikeman'), 'PI');
  assert.equal(sprites.placeholderColor('creature', 'x'), sprites.placeholderColor('creature', 'x'));

  const shared = document.createElement('canvas');
  shared.width = 64; shared.height = 32;
  const calls = [];
  sprites.setGfx({ getSprite: (kind, id, opts) => { calls.push([kind, id, opts.size]); if (id === 'boom') throw new Error('bad sprite'); return shared; } });
  const a = sprites.sprite('creature', 'pikeman', { size: 50 });
  const b = sprites.sprite('creature', 'pikeman', { size: 50 });
  assert.notEqual(a, shared, 'the cached gfx canvas is never handed out');
  assert.notEqual(a, b);
  assert.equal(a.width, 64);
  assert.equal(a.style.width, '64px', 'creatures keep their rendered pixel size (2-hex stay wide)');
  assert.equal(a.style.height, '32px', 'keeps the aspect ratio');
  const icon = sprites.sprite('artifact', 'x', { size: 50 });
  assert.equal(icon.style.width, '50px');
  assert.equal(icon.style.height, '25px', 'icons scale to size and keep the aspect ratio');
  const warn = console.warn;
  console.warn = () => {};
  try {
    const c = sprites.sprite('creature', 'boom');
    assert.equal(c.tagName, 'CANVAS');
    assert.equal(sprites.drawSprite(document.createElement('canvas').getContext('2d'), 'creature', 'boom', 0, 0), false);
  } finally { console.warn = warn; }
  assert.equal(sprites.drawSprite(document.createElement('canvas').getContext('2d'), 'creature', 'pikeman', 0, 0), true);
  sprites.setGfx(null);
});

test('initSprites tolerates a missing module', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await sprites.initSprites(async () => { throw new Error('404'); }), false);
    assert.equal(await sprites.initSprites(async () => ({})), false);
    assert.equal(await sprites.initSprites(async () => ({ getSprite: () => null })), true);
    assert.ok(sprites.hasGfx());
    assert.equal(sprites.sprite('ui', 'x').tagName, 'CANVAS', 'null from gfx falls back to a placeholder');
  } finally { console.warn = warn; sprites.setGfx(null); }
  await tick();
});
