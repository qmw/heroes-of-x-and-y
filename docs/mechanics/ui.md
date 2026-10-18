# UI shell, kit and conventions (`src/ui`)

The browser front end: an app shell with a screen router, a shared context (`ctx`), a widget kit,
a CSS skin, and the menu/setup/save/encyclopedia/options/credits screens. **Plain DOM + canvas,
no framework, no build step.** Engines and data never touch the DOM. Only the UI calls them.

```
src/main.js                 entry: createApp(#app).start()
src/ui/app.js               createApp, registerScreen, router, ctx, error boundary, keyboard routing
src/ui/sprites.js           crash-proof wrapper around src/gfx (sprite / drawSprite / placeholders)
src/ui/storage.js           save slots, export/import, settings store
src/ui/audio.js             procedural WebAudio sfx
src/ui/style.css            the whole skin (CSS variables + kit + screens)
src/ui/kit/*.js             widget library (namespace = ctx.ui, index.js re-exports everything)
src/ui/screens/*.js         mainMenu, newGame(+Model), loadGame, encyclopedia(+Model), options, credits
src/ui/screens/<big>/       NEXT PHASE: adventure/, town/, hero/, combat/, kingdom/ (index.js each)
tests/ui/*.test.js          Node tests on a fake DOM (tests/ui/fakeDom.js)
```

## 1. Architecture

- **Stage.** `#app` fills the window. Inside it, `.stage` is a fixed **1280×720 logical box**,
  scaled with `transform: scale()` and letterboxed (`fitStage` in `kit/stage.js`). Design every
  screen in 1280×720 pixels. The *UI scale* option shrinks the stage (0.5–1 of the fit).
  Inside the stage there are layers, bottom to top: `screen`, `dialogs`, `toasts`, `tooltips`, `error`.
- **Router.** Screens are modules `{ mount(rootEl, ctx, params), unmount() }`, as named exports or
  as the default export. They are registered with a lazy loader:
  `registerScreen('town', () => import('./screens/town/index.js'))`. `app.js` already registers
  `mainMenu newGame loadGame encyclopedia options credits adventure town hero combat kingdom`.
  If a module is missing or broken, a **"not available yet"** panel with Back / Main menu buttons
  is shown, and that screen is not kept in the history.
- `showScreen(name, params, { replace })` does these steps in order: unmount the old screen, clear its
  **screen-scope shortcuts**, its **`onState` listeners**, all **animations** (`ctx.anim.cancelAll()`.
  Pending tweens resolve, so `await` chains never hang), **tooltips** and **dialogs**, then load and
  mount. If a newer navigation starts while a slow load is still running, the newer one wins.
  `ctx.back()` goes to the previous history entry. Showing `mainMenu` resets the history.
- **Error boundary.** If `mount` throws, or a `window` `error` or `unhandledrejection` fires, an
  overlay appears with the message, the stack, *Back to main menu* and *Dismiss* (Esc). Screens may
  call `ctx.showError(err)` themselves. Any exception inside `ctx.act(fn)` also lands there.
- **Keyboard routing.** `keydown` first goes to an open error overlay (Esc dismisses it). Next it goes to the
  **dialog stack**: while any dialog is open, the key is consumed. Esc cancels the top dialog,
  Enter presses its default button, and digits 1-9 pick in `choose`. Otherwise the key goes to `ctx.keys`
  (screen scope first, then global). Keys typed into text inputs are ignored except Esc and F-keys.
- **Right click.** The stage never shows the browser context menu. Use `attachInfo` for the
  original's right-click-and-hold info popups.

## 2. `ctx` (the object every screen receives)

| member | meaning |
|---|---|
| `state` | current `GameState` (plain JSON) or `null` (getter) |
| `setState(s, {silent})` | replace the state (new game / load), notifies listeners unless silent |
| `notify(reason, payload)` | tell listeners the state was mutated in place |
| `onState(fn(state, reason, payload)) -> off` | subscribe for the life of the current screen |
| `act(fn(state) -> Result, {silent, reason}) -> Result` | run an engine action. `ok:false` → error toast + `error` sound. Success → `notify('action', result)`. Exception → error overlay |
| `resolvePendings() -> Promise<count>` | show a dialog for every `state.pending` entry of the current **human** player, one after another, and call `resolvePending(state, id, optionIndex, extra)` (prefers `engine.game.resolvePending`, falls back to `engine/pending.js`). Re-entrant calls are no-ops |
| `sprite(kind, id, opts)` / `drawSprite(ctx2d, kind, id, x, y, opts)` | graphics via `src/ui/sprites.js` |
| `gfx` | `{ sprite, drawSprite, available, module }` |
| `ui` | the kit namespace (`src/ui/kit/index.js`) |
| `showScreen(name, params, {replace})`, `back()`, `screen`, `params` | navigation |
| `save(slot, name) -> Promise<{ok, meta}>`, `load(slot) -> Promise<{ok, state}>`, `autosave()` | persistence. Uses `game.serialize/deserialize` when the engine exports them, otherwise JSON. `load` also calls `setState`. `autosave()` writes slot `autosave` if the option is on (adventure screen: call it at the start of each human turn) |
| `storage` | the storage API (§5) |
| `settings` | `get(key)`, `set(key, v)`, `all()`, `reset()`, `subscribe(fn(key, v)) -> off` |
| `audio` | `play(name, {pitch, gain})`, `unlock()`, `names` |
| `engine` | lazy engine namespace: `await ctx.engine.load('combat')` → module or `null` (never throws). After that call it is also available as `ctx.engine.combat`. `loadAll(names?)`, `available(name)`, `errors`. Names: `game town hero army bonuses economy pending artifacts leveling adventure combat mapgen ai` |
| `keys` | shortcut manager: `bind(combo, fn, desc)` (screen scope), `bindGlobal`, `unbind`, `list()` |
| `anim` | shared animator (honours the *animation speed* option): `tween`, `delay`, `loop`, `cancelAll` |
| `log(text, kind)` / `logStore` | message log (`info|good|warn|error|combat`), feed for `ui.LogConsole` |
| `toast(text, kind, ms)` | transient notification |
| `showError(err, {title})` | error overlay |
| `app`, `stage` | the app object and the stage element (debug: `window.h3`) |

Screens of the next phase may import engine modules **statically** once those modules exist. That is
simpler, and `ctx.engine` remains for optional modules such as `mapgen` and `ai`.

## 3. Writing a screen (template)

File `src/ui/screens/town/index.js` (already registered as `'town'`):

```js
// Town screen. params: { townId }
let off = [];

export function mount(root, ctx, params) {
  const { ui } = ctx;
  const { h } = ui;
  const town = () => ctx.state.towns[params.townId];

  const garrison = ui.ArmyRow({ id: 'garrison', army: town().garrison, onMove: move });
  const res = ui.ResourceBar({});
  root.appendChild(h('div.town', null,
    ui.Panel({ title: town().name }, garrison),
    h('div.town-bottom', null, res, ui.Button('Leave', { hotkey: 'Esc', onClick: () => ctx.back() }))));

  function render() {
    garrison.update(town().garrison);
    const p = ctx.state.players[ctx.state.currentPlayer];
    res.update({ resources: p.resources, date: ctx.state.date });
  }
  function move(from, to, count, fromRow, toRow) {
    ctx.act((s) => townEngine.townArmyMove(s, params.townId, fromRow, from, toRow, to, count));
  }

  off.push(ctx.onState(render));      // optional: listeners are auto-cleared anyway
  ctx.keys.bind('escape', () => ctx.back(), 'Leave town');
  render();
}

export function unmount() {           // free what the router cannot know about
  off.forEach((f) => f()); off = [];
}
```

Rules:
- Put the screen's DOM **only** under `root`. Dialogs, toasts and tooltips go through the kit.
- Keep module-level state minimal and reset it in `unmount` (screens are module singletons).
- Use `ctx.act` for engine calls. After the animations of the returned events, call
  `await ctx.resolvePendings()`.
- Sequence engine events with `await ui.playEvents(result.events, { hero_moved: async (e) => ..., '*': log })`.
- Canvas screens: `ui.createCanvas(w, h)` (DPR-aware), `ui.createCamera`, `ui.enablePanZoom`,
  `ui.eventPos` (accounts for the stage scale), `ui.createHitRegions`, `ui.createHexLayout`
  (combat field: 15×11, odd rows shifted right), `ctx.anim.loop(fn)` for the render loop. The loop is
  stopped automatically on screen change.
- Per-kind pending dialogs: `ui.registerPendingRenderer('level_up', async (pending, ctx) => ({ optionIndex, extra }))`.
  Call it at module load of the screen that owns the kind.
- File layout for the next agents: `src/ui/screens/adventure/*`, `town/*`, `hero/*`, `combat/*`,
  `kingdom/*`, each with an `index.js` entry. Shared widgets that are useful to several screens go
  in `src/ui/kit/` (add to `kit/index.js`, document here, test in `tests/ui/`).
- CSS: add a section per screen at the end of `style.css`, or (preferred, to avoid edit conflicts)
  a file `src/ui/screens/<name>/<name>.css`. Inject it in `mount` with
  `h('link', { rel: 'stylesheet', href: new URL('./town.css', import.meta.url).href })` added to
  `document.head` once.

## 4. Kit API reference (`ctx.ui`)

Conventions: **PascalCase** = widget factory returning its root `HTMLElement` with a small API
attached directly to it (`row.update(army)`). **camelCase** = helper or promise function. Widgets never
mutate game state: they emit callbacks, and the owner calls the engine and then `.update(...)`.

**DOM / text** (`dom.js`): `h(tag, props?, ...children)` (tag may be `'div.cls#id'`. Props: `class`,
`dataset`, `style` (numbers → px, `--vars`), `attrs`, `on`, `onClick`-style, `text`, any DOM property),
`clear(el, ...children)`, `on(target, type, fn) -> off`, `toNode(stringOrNodeOrFn)`, `setProps`,
`setStyle`, `fmt(12345)` → `12,345`, `fmtShort` → `12.3k`, `humanize('arch_angel')`, `signed`,
`clamp`, `costText`.

**Stage** (`stage.js`): `STAGE_W/H`, `getLayer(name)`, `clientToStage(x, y)`, `fitStage(w, h, uiScale)`,
`placeInStage(el, x, y)`, `getStageScale()`.

**Buttons / panels** (`button.js`):
- `Button(label, { onClick, kind: 'primary'|'default'|'danger'|'ghost', size: 'sm'|'lg', icon: {kind,id}, tooltip, disabled, active, hotkey, sound })` → `.setLabel .setDisabled .setActive`
- `IconButton(icon | glyph | node, { onClick, size, tooltip, kind })`
- `Panel({ title, variant: 'stone'|'parchment'|'dark', footer, class }, ...children)` → `.body .setTitle .setContent`
- `Frame({ inset }, ...children)` (gold frame), `StatLine(label, value, { tooltip })` → `.set(v)`

**Dialogs** (`dialog.js`). All are modal and stacked, with Esc / Enter / digits handled by the stack:
```js
await ui.message('The town is yours.', { title, icon: {kind, id} });
const yes = await ui.confirm('Dismiss this hero?', { danger: true });             // true / false
const v = await ui.choose({ title: 'Treasure Chest', text: 'Take the gold or the experience?',
  options: [{ label: '1500 gold', icon: { kind: 'resource', id: 'gold' }, value: 'gold' },
            { label: '1000 exp', icon: { kind: 'ui', id: 'experience' }, value: 'exp', description: '...' }],
  cancellable: false, confirm: false, columns: 4 });                               // value | index | null
const name = await ui.prompt({ title: 'Save', label: 'Name', value: 'Day 3' });    // string | null
const d = ui.openDialog({ title, content: node, buttons: [{ label, value, kind, default, cancel, keep, onClick }],
  dismissable: true, cancelValue: null, width, class, onKey(key, e) });            // d.result, d.close(v), d.setButtonDisabled(i, b)
ui.dialogCount(); ui.closeTopDialog(); ui.closeAllDialogs(); ui.onDialogStackChange(fn);
```

**Tooltips / info** (`tooltip.js`): `attachTooltip(el, content | () => content, { delay }) -> detach`.
Multi-line strings become lines. `attachInfo(el, (e) => node)` shows a popup while the right button is held.
`showInfoPopup(node, clientX, clientY)` / `hideInfoPopup()` are for canvas screens. `hideTooltips()`.

**Generic widgets** (`widgets.js`):
- `Tabs({ tabs: [{ id, label, icon, content: node | () => node, badge }], active, onChange, vertical })` → `.select(id) .active .refresh()`
- `ScrollList({ items, renderItem(item, i), onSelect(item, i), onActivate (dblclick), keyOf, selected, height, emptyText })` → `.setItems(items, keepKey?) .select(i, silent?) .selectedIndex .selectedItem .rows .scrollToSelected()`
- `Slider({ min, max, value, step, onChange, onCommit })` → `.value .setRange(min, max)`
- `NumberStepper({ min, max, value, step, bigStep, showMinMax, onChange })` → `.value .setRange` (shift-click = big step)
- `ProgressBar({ value, max, label, color: 'mana'|'exp'|'hp'|'move' })` → `.set(value, max, label)`
- `Select({ options: [{value, label, disabled}] | [...], value, onChange })` → `.val` (typed value), `.setOptions(list, value)`
- `Checkbox({ label, checked, onChange })` → `.isChecked .input`, `TextInput({ value, placeholder, maxLength, width, onInput, onChange })`, `Field(label, control, hint)`

**Feedback** (`toast.js`): `toast(text, 'info'|'good'|'warn'|'error', ms)`, `createLogStore(limit)`,
`LogConsole({ store: ctx.logStore, max, height })` → `.destroy()` (call it in unmount).

**Game widgets**
- `ResourceBar({ resources, date, income, onClick(res) })` → `.update({ resources, date, income })`. `CostView(cost, have?, { size })` marks unaffordable parts. `dateText(date)`.
- `ArmyRow({ id, army, selection, onMove(from, to, count|undefined, fromRowId, toRowId), onSelect(slot, stack), onInfo(slot, stack), infoContent, readonly, size, label, askSplit })` → `.update(army) .select(slot) .selected .slotEls`.
  Interaction follows the original. Click selects. Click another slot to swap / merge / move (`count` undefined).
  Shift-click an empty slot or a slot with the same creature to open the split dialog (`count` = chosen amount).
  Click the selected stack again (or double-click) for info. Drag & drop also works. Right-click-hold shows a `CreatureCard`.
  Rows that should trade share `createArmySelection()`. The pure logic is in `armyClickStep(sel, target, {shift})`.
  `splitStack({ creatureId, max, value }) -> Promise<count|null>`.
- `CreatureCard({ creatureId, count, stats: {attack, defense, hp, speed, minDamage, maxDamage, shots}, compact, onLink(kind, id), footer })`. Modified stats are shown green or red. `creatureCardModel`, `abilityText`.
- `HeroPortrait({ defId | hero, size, playerColor, selected, badge, onClick })` → `.setSelected .setBadge`.
  `HeroCard({ hero | defId, primary, maxMana, playerColor, compact, showSkills, onClick })`, `heroCardModel`.
  `PrimaryStats(values, { base, layout, iconSize })` → `.update(values, base)`.
  `MoraleLuckPips({ morale, luck, moraleDetails: [..], luckDetails })` → `.update`.
  `SkillIcon({ id, level, size, showLabel, onClick })`. `moraleLuckText`.
- `ArtifactGrid({ id, artifacts: hero.artifacts, selection, onMove(fromRef, toRef), onPick(ref, entry), onActivate (dblclick), readonly, backpackVisible, slotSize })` → `.update .slotEl(slot, i) .backpackEls`.
  Refs are `{ grid, where: 'equipped', slot, index }` or `{ grid, where: 'backpack', index }` (index may be `backpack.length`, meaning append).
  It is a paper doll built from `ARTIFACT_SLOTS`/`SLOT_COUNTS`, with locked slots (`artifacts.locks`) and a paged backpack.
  Two grids sharing `createArtifactSelection()` let you trade between heroes. `ArtifactSlot`, `ArtifactInfo`, `paperDollSlots`, `artifactEntryName`.
- `SpellbookView({ spells, mana, mastery: {air, earth, fire, water}, kind, lockKind, costOf(spell), canCast(spell) -> true|reason, onSelect(spellId), perPage })` → `.update({ spells, mana, mastery }) .setSchool .setKind`. `spellbookPages(ids, {school, kind, perPage})` is the pure helper.
- `Minimap({ width, height, draw(ctx2d, w, h), onNavigate(fx, fy), viewport: {x, y, w, h} (fractions) })` → `.redraw() .setViewport(rect) .destroy()`.
- `showPending(pending, ctx) -> {optionIndex, extra}` (alias `PendingChoiceDialog`), `registerPendingRenderer(kind, fn)`, `describePending`, `describeOption`.
  Option icons and labels are inferred from `skillId+level`, `creatureId+count`, `artifactId`, `spellId`, `resource+amount`, `stat+value`, `exp`, `gold`, or an explicit `label`, `icon` and `description`.
  An entry without options is an acknowledgement (OK).

**Animation** (`anim.js`): `createAnimator({ manual, speed, raf })` → `tween({ from, to, duration, ease, onUpdate(v, t), onDone, realtime }) -> Promise & {cancel(jump)}`, `delay(ms)`, `loop(fn(dt, t)) -> {stop}`, `advance(ms)` (manual clock), `cancelAll()`, `setSpeed`.
`sequence([fn...])`, `parallel([...])`, `playEvents(events, handlers, {onError})`, `EASE`, `lerp`.

**Canvas** (`canvas.js`): `createCanvas(w, h, {dpr, pixelated})` → `{canvas, ctx, resize, clear}`, `eventPos(canvas, e)`,
`createCamera({viewW, viewH, worldW, worldH, zoom, minZoom, maxZoom})` → `worldToScreen screenToWorld panBy centerOn zoomAt visibleRect visibleCells apply(ctx)`,
`cellAt(cam, sx, sy, cell)`, `enablePanZoom(canvas, cam, {onChange, onClick, button, pan, zoom}) -> off`,
`createHitRegions()` (rect / circle / polygon, topmost wins), `pointInRect`, `pointInPolygon`, `createHexLayout({w, rowH, originX, originY})` → `center polygon at`.

**Shortcuts** (`shortcuts.js`): `createShortcuts()`, `normalizeCombo`, `eventCombos`, `comboLabel`.

**Sprites** (`../sprites.js`): `sprite(kind, id, opts)` always returns a **fresh** canvas (creature icons are cropped to a square
box with the body scaled to ~80% of `size` unless the caller passes `box` or `fit: 'natural'`) (gfx caches
its canvases, so they are copied and never shared in the DOM). CSS width is `opts.size`. On a missing gfx, a
throwing gfx or null output you get a coloured placeholder with initials. `drawSprite(ctx, kind, id, x, y, opts)`
never throws. `initSprites()` is called by `app.start()`.

### DOM subset (keep the kit testable)
The kit only uses: `createElement`, `createTextNode`, `append/appendChild/insertBefore/remove/replaceChildren`,
`classList`, `className`, `dataset`, `style.x = ...`/`style.setProperty`, `setAttribute`, `textContent`,
`addEventListener/removeEventListener/dispatchEvent`, `querySelector(All)` with simple selectors,
`getBoundingClientRect`, `focus`, `canvas.getContext('2d')`, `window` events and `requestAnimationFrame`.
**No `innerHTML`.** That subset is implemented by `tests/ui/fakeDom.js` (`installFakeDom()`, `fire(el, type, init)`,
`tick()`, `until(fn)`, `createFakeStorage(quota)`). Use it to test new widgets in Node.

## 5. Storage & settings (`storage.js`)

- Slot key `h3o.save.<slot>`: `{ format: 'h3online-save', version: 1, meta, data, encoding? }`, where `data` is the
  serialized state string. With `encoding: 'lz16'` the data is LZ-compressed by `src/ui/lz.js`
  (`compressUtf16` / `decompressUtf16`, a zero-dependency LZW variant written for this project), at
  15 bits per UTF-16 char. Browsers count the localStorage quota in UTF-16 code units, so this beats
  gzip + base64, and it stays synchronous. Typical map JSON shrinks more than 10×. A record without `encoding`
  (older saves or hand-made files) is read as plain text. Compression is skipped when it would not shrink
  the data. `createStorage({ compress: false })` turns it off. `meta.size` is the stored size and
  `meta.rawSize` the uncompressed one. The index of metas is under `h3o.saves`. Settings are under `h3o.settings`.
- `createStorage({ backend, serialize, deserialize })` → `list()` (newest first), `meta`, `has`,
  `save(slot, state, {name})`, `load(slot)`, `remove`, `exportSlot(slot) -> text`, `exportState(state, name)`,
  `importJson(text, {slot | store})`, `setCodec({serialize, deserialize})`, `persistent`, and small JSON records that
  are not games under `h3o.data.<name>`: `readData(name) -> value|null`, `writeData(name, value) -> {ok}|{ok:false,
  error}`, `removeData(name)` (campaign progress, docs/mechanics/campaigns.md).
  Error codes: `no_state quota_exceeded storage_failed serialize_failed no_such_save corrupt_save
  not_a_save_file save_from_newer_version` → `storageErrorText(code)`. A bare GameState JSON is
  accepted on import. If localStorage is unavailable, saves live in memory and the screen warns about it.
- Settings (`DEFAULT_SETTINGS`): `volume 0..1`, `muted`, `animSpeed 0.25..8`, `autosave`, `showGrid`,
  `edgeScroll`, `uiScale 0.5..1`, `quickCombat`, `confirmEndTurn`. Values are sanitised. The next screens
  read them with `ctx.settings.get('showGrid')` and can react with `subscribe`.

## 6. Screens implemented here

- **mainMenu**: animated canvas landscape (sky gradient, twinkling stars, sun glow, parallax ridges,
  castle silhouette, clouds, a faction's creatures walking along the road drawn through `drawSprite`).
  Menu entries: Continue / Resume, New Game, Load, Save (with a game in memory), Encyclopedia, Options, Credits
  (+ Campaigns, Map Editor - `docs/mechanics/editor.md`).
- **newGame**: map type random (size S/M/L/XL, underground, water, monsters, template, seed),
  scenario (from `mapgen.listScenarios()`) or custom map (map-editor library, `setCustomMap`; the blueprint is loaded
  from `editor/mapStorage.js` instead of being generated and brings its victory / loss). It has 8 player slots (human / computer / closed, colour swap,
  town or random, hero picker with portraits, starting bonus), 5 difficulties (80/100/130/160/200 %),
  and victory / defeat conditions (mapped to engine types by `victorySetting` / `lossSetting`: capture all towns,
  build a Grail, 100,000 gold, 84 / 168-day time limits; scenarios replace the dropdowns by their own
  `victory` / `loss` texts and conditions). Start runs `mapgen.generateMap(buildMapOptions(setup))`, then
  `game.createGame(blueprint, buildGameSettings(setup))`, then `setState` and `showScreen('adventure', {newGame: true})`.
  A missing generator or engine gives an explanatory dialog. Pure model: `newGameModel.js`.
- **loadGame** (`{mode: 'load'|'save'}`): list with meta, details, load, save as new / overwrite,
  delete, export (download `.json`), import (file picker).
- **encyclopedia** (`{key: 'creature:pikeman'}` deep links): 11 categories (creatures, heroes,
  classes, skills, spells, artifacts, towns with build tree, buildings, map objects, terrain incl.
  magic terrain/roads/rivers, creature abilities). It has per-category filters, local + global search,
  back/forward history and dense cross-links. Pure model: `encyclopediaModel.js`.
- **options**, **credits**.
- **campaigns**, **campaignBriefing** (`src/ui/screens/campaign/*`, main menu entry *Campaigns* / A): see
  docs/mechanics/campaigns.md §4.

## 7. CSS conventions (`style.css`)

- Variables on `:root`: stone `--stone-0..4`, gold `--gold-0..4`, parchment `--parch-0..2`, `--ink`,
  `--text`, `--text-dim`, `--good/--bad/--warn`, `--mana/--exp/--hp/--move`, player colours
  `--pc-red … --pc-pink`, `--font` (Georgia / Palatino serif stack), `--shadow`, `--bevel`,
  textures `--stone-tex`, `--parch-tex`.
- Kit classes are `k-<widget>[-part]`. Modifiers are `k-btn-primary`, `k-panel-parchment` and so on. State classes are
  `is-selected`, `is-active`, `is-disabled`, `is-empty`, `is-locked`, `is-up/is-down`, `is-pos/is-neg`.
- Screen prefixes: `mm-` (menu), `ng-`, `lg-`, `enc-`, `opt-`, `cr-`. **Next agents:** `adv-`,
  `town-`, `hero-`, `cmb-`, `kng-`. Every screen root gets `.screen.screen-<name>` and `data-screen`.
- Helpers: `.k-row`, `.k-row-center`, `.k-col`, `.k-link`, `.k-tag`.

## 8. Keyboard map

| where | keys |
|---|---|
| any dialog | Esc cancel (if dismissable), Enter default button, 1-9 pick option in a choice |
| error overlay | Esc dismiss |
| main menu | C continue/resume, N new, L load, S save, E encyclopedia, O options, R credits, M map editor |
| map editor | 1-9 tools, Ctrl+Z / Ctrl+Y undo / redo, Ctrl+S save, Del remove, G grid, U level, +/- zoom, arrows scroll, Esc deselect / exit |
| new game | Enter start, Esc back |
| load/save | Enter load/overwrite, N save as new, Del delete, Esc back |
| encyclopedia | ↑/↓ entries, Alt+←/→ history, `/` search, Esc back |
| options / credits / unavailable | Esc back |
| reserved for next phase (suggested) | adventure: E end turn, H next hero, T town, S sleep, Space move, Ctrl+S quicksave, arrows scroll. Combat: D defend, W wait, C cast, A auto, R retreat |

## 9. Stubs awaiting other modules

- `src/gfx/index.js`: sprites fall back to placeholders until it loads (`ctx.gfx.available`).
- `src/engine/mapgen/index.js`: `listScenarios()`, `generateMap(options)`, optional `listTemplates()`.
  New Game explains that it is missing. A result shaped `{ ok: false, error }` is shown as an error.
  `generateMap` may return the blueprint directly or `{ blueprint }`. Scenario options pass
  `{ type: 'scenario', scenario, scenarioId }`.
- `src/engine/game.js`: `createGame`, optional `serialize/deserialize` (else JSON), optional
  `resolvePending` (else `engine/pending.js`).
- Screens `adventure`, `town`, `hero`, `combat`, `kingdom` show "not available" until written.

## Checklist

- [x] router: register / lazy mount / unmount order / params / history / race / failure panel — tests/ui/app.test.js
- [x] error boundary (mount crash, window error, unhandled rejection) — tests/ui/app.test.js
- [x] ctx: act / notify / onState / save / load / autosave / resolvePendings / engine loader — tests/ui/app.test.js
- [x] dialogs: message / confirm / choose / prompt / stack / keys — tests/ui/dialog.test.js
- [x] ArmyRow move / split / cross-row / drag & drop — tests/ui/armyRow.test.js
- [x] PendingChoiceDialog default + custom renderers — tests/ui/pending.test.js
- [x] kit widgets, sprites fallback — tests/ui/kit.test.js
- [x] shortcuts, tween sequencing, playEvents, camera, hex, hit-testing, stage fit — tests/ui/infra.test.js
- [x] storage round-trip, quota, import/export, codec, settings, compression — tests/ui/storage.test.js
- [x] LZ codec round-trips / storage-safe output / corrupt input — tests/ui/lz.test.js
- [x] encyclopedia entries for every data id, all links resolve, every entry renders — tests/ui/encyclopedia.test.js
- [x] main menu, new game (model + start flow), load/save, options, credits, audio — tests/ui/screens.test.js
