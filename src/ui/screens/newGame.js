// New Game setup screen. Model: newGameModel.js. Starts the game through the lazily loaded
// engine: mapgen.generateMap(options) -> game.createGame(blueprint, settings) -> 'adventure'.
import * as M from './newGameModel.js';
import { FACTIONS_DATA, FACTION_BY_ID } from '../../data/factions.js';
import { HERO_BY_ID } from '../../data/heroes.js';
import { HERO_CLASS_BY_ID } from '../../data/heroClasses.js';
import { PLAYER_COLORS } from '../../core/constants.js';
import { createMapLibrary } from './editor/mapStorage.js';

export async function mount(root, ctx) {
  const ui = ctx.ui;
  const { h, clear } = ui;
  const setup = M.createSetup({ seed: (Date.now() % 1000000) + 1 });
  let scenarios = [];
  const customLib = createMapLibrary(ctx.storage);
  const customMaps = customLib.list();
  let templates = M.DEFAULT_TEMPLATES;
  let mapgen = null;
  let starting = false;

  const mapBody = h('div.ng-map-body');
  const playersBody = h('div.ng-players');
  const rulesBody = h('div.ng-rules');
  const problems = h('div.ng-problems');
  const startBtn = ui.Button('Start Game', { kind: 'primary', size: 'lg', hotkey: 'Enter', onClick: () => start() });
  const mapgenNote = h('div.ng-note');

  root.appendChild(h('div.ng', null,
    h('div.ng-heading', null, 'New Game'),
    h('div.ng-cols', null,
      ui.Panel({ title: 'Map', class: 'ng-map' }, mapBody, mapgenNote),
      ui.Panel({ title: 'Players', class: 'ng-players-panel' }, playersBody),
      ui.Panel({ title: 'Rules', class: 'ng-rules-panel' }, rulesBody)),
    h('div.ng-bottom', null, problems,
      h('div.k-row', null, ui.Button('Back', { hotkey: 'Esc', onClick: () => ctx.back() }), startBtn))));

  ctx.keys.bind('escape', () => ctx.back(), 'Back');
  ctx.keys.bind('enter', () => start(), 'Start game');

  // The generator arrives in a later phase: load it lazily and degrade gracefully.
  refresh();
  mapgen = await ctx.engine.load('mapgen');
  if (mapgen) {
    try { scenarios = (mapgen.listScenarios ? mapgen.listScenarios() : []) || []; } catch (err) { ctx.log(`listScenarios failed: ${err.message}`, 'warn'); }
    try { if (mapgen.listTemplates) templates = mapgen.listTemplates() || templates; } catch { /* keep defaults */ }
    if (!templates.length) templates = M.DEFAULT_TEMPLATES;
  } else {
    mapgenNote.textContent = 'The map generator is not available in this build yet - you can set everything up, but the game cannot start.';
    mapgenNote.classList.add('is-warn');
  }
  if (ctx.screen !== 'newGame') return;      // the user left while the module was loading

  function refresh() { renderMap(); renderPlayers(); renderRules(); renderProblems(); }

  function renderProblems() {
    const v = M.validateSetup(setup);
    clear(problems, v.errors.map((e) => h('div.ng-problem', null, e)));
    startBtn.setDisabled(!v.ok);
  }

  function renderMap() {
    const tabLabel = (t) => (t === 'random' ? 'Random map' : t === 'scenario' ? `Scenario (${scenarios.length})` : `Custom maps (${customMaps.length})`);
    const tabs = h('div.k-row', null, ['random', 'scenario', 'custom'].map((t) => ui.Button(tabLabel(t),
      { active: setup.mapType === t, onClick: () => {
        M.setMapType(setup, t);
        if (t === 'scenario' && !setup.scenarioId && scenarios[0]) M.setScenario(setup, scenarios[0]);
        if (t === 'custom' && !setup.customMapId && customMaps[0]) M.setCustomMap(setup, customMaps[0]);
        refresh();
      } })));
    if (setup.mapType === 'random') {
      const size = M.MAP_SIZES.find((s) => s.id === setup.size);
      clear(mapBody, tabs,
        ui.Field('Size', h('div.k-row', null, M.MAP_SIZES.map((s) => ui.Button(s.id, { size: 'sm', active: s.id === setup.size, tooltip: `${s.name}: ${s.size} x ${s.size}, up to ${s.maxPlayers} players`, onClick: () => { M.setMapSize(setup, s.id); refresh(); } }))),
          `${size.name}: ${size.size} x ${size.size} tiles, up to ${size.maxPlayers} players`),
        ui.Field('Levels', ui.Checkbox({ label: 'Underground level', checked: setup.underground, onChange: (v) => { setup.underground = v; } })),
        ui.Field('Water', ui.Select({ options: M.WATER_AMOUNTS.map((w) => ({ value: w.id, label: w.name })), value: setup.water, onChange: (v) => { setup.water = v; } })),
        ui.Field('Monsters', ui.Select({ options: M.MONSTER_STRENGTHS.map((w) => ({ value: w.id, label: w.name })), value: setup.monsters, onChange: (v) => { setup.monsters = v; } })),
        ui.Field('Template', ui.Select({ options: templates.map((t) => ({ value: t.id, label: t.name || t.id })), value: setup.template, onChange: (v) => { setup.template = v; renderMap(); } }),
          (templates.find((t) => t.id === setup.template) || {}).description || ''),
        ui.Field('Seed', h('div.k-row', null,
          ui.TextInput({ value: String(setup.seed), width: 130, maxLength: 24, onChange: (v) => { setup.seed = M.normalizeSeed(v); renderMap(); } }),
          ui.IconButton('?', { size: 30, tooltip: 'Roll a new random seed', onClick: () => { setup.seed = M.normalizeSeed(Math.floor(Math.random() * 4294967295)); renderMap(); } })),
        'The same seed and settings always produce the same map.'));
    } else if (setup.mapType === 'custom') {
      // maps made with the map editor (src/ui/screens/editor/mapStorage.js)
      const current = customMaps.find((m) => m.id === setup.customMapId) || null;
      const list = ui.ScrollList({
        class: 'ng-scenarios', items: customMaps, emptyText: 'No custom maps yet - make one in the Map Editor.',
        renderItem: (m) => h('div', null, h('div.ng-scn-name', null, m.name || m.id), h('div.ng-scn-sub', null, `${m.size || ''}${m.levels > 1 ? ' +U' : ''} - ${m.playerSlots} players`)),
        selected: customMaps.indexOf(current),
        onSelect: (m) => { M.setCustomMap(setup, m); refresh(); },
      });
      clear(mapBody, tabs, list, h('div.ng-scn-desc', null, current ? current.description || '' : ''));
    } else {
      const current = scenarios.find((s) => s.id === setup.scenarioId) || null;
      const list = ui.ScrollList({
        class: 'ng-scenarios', items: scenarios, emptyText: mapgen ? 'No scenarios are available.' : 'Scenarios need the map generator module.',
        renderItem: (s) => h('div', null, h('div.ng-scn-name', null, s.name || s.id), h('div.ng-scn-sub', null, `${s.size || ''} ${s.playerSlots ? `- ${s.playerSlots} players` : ''}`)),
        selected: scenarios.indexOf(current),
        onSelect: (s) => { M.setScenario(setup, s); refresh(); },
      });
      clear(mapBody, tabs, list, h('div.ng-scn-desc', null, current ? current.description || '' : ''));
    }
  }

  function pickHero(p) {
    const heroes = M.heroChoices(p.faction);
    if (!heroes.length) { ctx.toast('Choose a town first to pick its heroes.', 'info'); return; }
    const taken = new Set(setup.players.filter((x) => x !== p && x.type !== 'closed').map((x) => x.hero));
    ui.choose({
      title: `Starting hero - ${FACTION_BY_ID[p.faction].name}`, cancellable: true, columns: 6, width: 900,
      options: [{ label: 'Random', value: 'random', icon: { kind: 'ui', id: 'random', size: 52 } },
        ...heroes.map((d) => ({ label: d.name, value: d.id, description: HERO_CLASS_BY_ID[d.classId]?.name || '', icon: { kind: 'portrait', id: d.id, size: 52 },
          disabled: taken.has(d.id), tooltip: d.specialty?.description }))],
    }).then((v) => { if (v != null) { M.setSlotHero(setup, p.slot, v); refresh(); } });
  }

  function renderPlayers() {
    const open = M.openSlots(setup).length;
    clear(playersBody,
      h('div.ng-prow.ng-prow-head', null, ['', 'Type', 'Name', 'Town', 'Hero', 'Bonus'].map((t) => h('div', null, t))),
      setup.players.map((p) => {
        const closed = p.type === 'closed';
        const swatch = h('button.ng-color', { type: 'button', style: { background: `var(--pc-${p.color})` }, title: `${p.color} - click to change` });
        swatch.addEventListener('click', () => { M.cycleSlotColor(setup, p.slot); refresh(); });
        const typeSel = ui.Select({
          options: M.SLOT_TYPES.map((t) => ({ value: t.id, label: t.name, disabled: (t.id !== 'closed' && closed && open >= setup.maxPlayers) || !M.slotTypeAllowed(setup, p.slot, t.id) })),
          value: p.type, onChange: (v) => { if (!M.setSlotType(setup, p.slot, v)) ctx.toast(`This map supports at most ${setup.maxPlayers} players.`, 'warn'); refresh(); },
        });
        if (closed) return h('div.ng-prow.is-closed', { dataset: { slot: p.slot } }, swatch, typeSel, h('div.ng-closed', null, 'Closed'));
        const hero = HERO_BY_ID[p.hero];
        const heroBtn = h('button.ng-hero', { type: 'button', title: hero ? `${hero.name} - ${hero.specialty?.description || ''}` : 'Random hero - click to choose' },
          p.hero === 'random' ? h('span.ng-hero-random', null, '?') : ctx.sprite('portrait', p.hero, { size: 34 }),
          h('span', null, hero ? hero.name : 'Random'));
        heroBtn.addEventListener('click', () => pickHero(p));
        return h('div.ng-prow', { dataset: { slot: p.slot } }, swatch, typeSel,
          ui.TextInput({ value: p.name, maxLength: 16, width: 120, onChange: (v) => { p.name = v.trim() || p.name; } }),
          ui.Select({ options: [{ value: 'random', label: 'Random' }, ...FACTIONS_DATA.filter((f) => M.allowedFactions(setup, p.slot).includes(f.id)).map((f) => ({ value: f.id, label: f.name }))], value: p.faction,
            onChange: (v) => { M.setSlotFaction(setup, p.slot, v); refresh(); } }),
          heroBtn,
          ui.Select({ options: M.STARTING_BONUSES.map((b) => ({ value: b.id, label: b.name })), value: p.bonus, onChange: (v) => { p.bonus = v; } }));
      }),
      h('div.ng-hint', null, `${open} of up to ${setup.maxPlayers} players. Humans share this computer and take turns (hot seat).`));
  }

  function renderRules() {
    const diff = M.DIFFICULTIES.find((d) => d.id === setup.difficulty);
    clear(rulesBody,
      ui.Field('Difficulty', h('div.ng-diff', null, M.DIFFICULTIES.map((d) => ui.Button(`${d.percent}%`, {
        size: 'sm', active: d.id === setup.difficulty, tooltip: `${d.name}: ${d.note}`, onClick: () => { setup.difficulty = d.id; renderRules(); },
      }))), `${diff.name} - ${diff.note}`),
      // scenarios bring their own conditions: show their texts instead of the (overridden) choices
      ...(setup.mapType === 'custom' ? (() => {
        const m = customMaps.find((x) => x.id === setup.customMapId) || null;
        const txt = (c, std) => (!m || c === 'standard' ? std : String(c).replace(/_/g, ' '));
        return [
          ui.Field('Victory', h('div.ng-scn-cond', null, txt(m && m.victory, 'Defeat all enemies')), 'Set by the map'),
          ui.Field('Defeat', h('div.ng-scn-cond', null, txt(m && m.loss, 'Lose all towns and heroes')), 'Set by the map'),
        ];
      })() : setup.mapType === 'scenario' ? (() => {
        const scn = scenarios.find((s) => s.id === setup.scenarioId) || null;
        return [
          ui.Field('Victory', h('div.ng-scn-cond', null, scn ? scn.victory || 'Defeat all enemies' : '-'), 'Set by the scenario'),
          ui.Field('Defeat', h('div.ng-scn-cond', null, scn ? scn.loss || 'Lose all towns and heroes' : '-'), 'Set by the scenario'),
        ];
      })() : [
        ui.Field('Victory', ui.Select({ options: M.VICTORY_CONDITIONS.map((v) => ({ value: v.id, label: v.name })), value: setup.victory, onChange: (v) => { setup.victory = v; } })),
        ui.Field('Defeat', ui.Select({ options: M.LOSS_CONDITIONS.map((v) => ({ value: v.id, label: v.name })), value: setup.loss, onChange: (v) => { setup.loss = v; } })),
      ]),
      h('div.ng-colors', null, 'Colours: ', PLAYER_COLORS.map((c) => h('span.ng-color-dot', { style: { background: `var(--pc-${c})` }, title: c }))));
  }

  async function start() {
    if (starting) return;
    const v = M.validateSetup(setup);
    if (!v.ok) { ctx.toast(v.errors[0], 'warn'); return; }
    starting = true;
    startBtn.setDisabled(true);
    startBtn.setLabel('Creating the world...');
    try {
      const [gen, game] = await Promise.all([ctx.engine.load('mapgen'), ctx.engine.load('game')]);
      if (!gen || typeof gen.generateMap !== 'function') {
        await ui.message('The map generator is not available in this build yet, so a new game cannot be started.', { title: 'Generator not available' });
        return;
      }
      if (!game || typeof game.createGame !== 'function') {
        await ui.message('The game engine is not available in this build yet, so a new game cannot be started.', { title: 'Engine not available' });
        return;
      }
      const settings = M.buildGameSettings(setup);
      let state;
      try {
        let blueprint;
        if (setup.mapType === 'custom') {
          const loaded = customLib.load(setup.customMapId);
          if (!loaded.ok) throw new Error(`the custom map could not be loaded (${loaded.error})`);
          blueprint = loaded.bp;
        } else blueprint = gen.generateMap(M.buildMapOptions(setup));
        if (!blueprint || blueprint.ok === false) throw new Error((blueprint && blueprint.error) || 'the generator returned no map');
        const bp = blueprint.blueprint || blueprint;
        // scenarios carry their own victory / loss conditions (mapgen blueprint.victory / .loss)
        if (setup.mapType === 'scenario' || setup.mapType === 'custom') {
          if (bp.victory) settings.victory = bp.victory;
          if (bp.loss) settings.loss = bp.loss;
        }
        state = game.createGame(bp, settings);
      } catch (err) {
        ctx.log(`Game creation failed: ${err.stack || err.message}`, 'error');
        await ui.message(`The game could not be created:\n${err.message}`, { title: 'Could not start' });
        return;
      }
      ctx.setState(state, { silent: true });
      ctx.audio.play('daystart');
      await ctx.showScreen('adventure', { newGame: true });
    } finally {
      starting = false;
      if (ctx.screen === 'newGame') { startBtn.setLabel('Start Game'); renderProblems(); }
    }
  }

  refresh();
  return { setup, start, refresh };
}

export function unmount() {}
