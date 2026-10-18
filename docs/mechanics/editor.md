# Map editor (`src/engine/editor/*`, `src/ui/screens/editor/*`)

The original shipped a map editor; this is ours. The **engine** is a set of pure-JS operations over a
`MapBlueprint` (DESIGN.md §8, mapgen.md §2) with an undo/redo history; the **UI** is a screen (`editor`)
that paints, places objects, edits their properties, validates, saves / loads and plays the map.
Tests: `tests/editor/*.test.js` (engine + full game), `tests/ui/screens-editor.test.js` (UI on the fake DOM),
e2e scenario `editor` (`tools/e2e/scenarios.mjs`).

## 1. Model

```
EditorDoc = { bp: MapBlueprint, rng: {s}, nextId, undo: [Step], redo: [Step], version, savedVersion }
Step      = { label, entries: [{ key, before, after }] }          // key: 'tile:z,y,x' | 'obj:<id>' | 'towns' | 'heroes' | 'meta' | ...
```

- The blueprint is exactly what `createGame(blueprint, settings)` and `validateBlueprint` take: `map` (tiles,
  `objects` with rolled instance data, `placedArtifacts`, `puzzleOrder`), `towns: [{pos, faction, ownerSlot, name?,
  buildings?}]`, `heroes: [{ownerSlot, pos, defId}]`, `meta`, `victory`, `loss`.
- Towns and starting heroes are **not** map objects (createGame creates them); the editor treats them as placeable
  things with the pseudo object ids `town` / `random_town` (5x3 footprint, faction `random` for the latter) and `hero`.
  They are referred to by `{kind: 'town'|'hero', index}`; map objects by `{kind: 'object', id}`.
- Object instance data is rolled by the real adventure `addObject` on a throw-away "generation state"
  (`{map: bp.map, rng: doc.rng, nextId, players: [], heroes: {}, towns: {}}`, same trick as `mapgen/builder.js`), so a
  placed object is identical to one the generator or the game would create; anything passed in `data` wins over the roll.
- Owners in the editor are **player slots** (`ownerSlot` for towns / heroes, `obj.owner` for flaggable objects, boat
  owners, event `players`, `be_player` quests, timed-event players). `createGame` maps them to player ids through
  `src/engine/blueprintExtras.js`; objects of unplayed slots become neutral.
- `meta`: `name, description, difficulty (0-4, informational), size, width, height, levels, playerSlots,
  players: [{slot, team, human: bool, ai: bool, factions: [id] (allowed; empty = all)}], teams, editor: {version,
  created, modified}`. createGame reads `meta.players[].team`.
- `victory` / `loss`: engine condition objects (game-loop.md §4) or `'standard'`; towns / heroes referenced by
  `townIndex` / `heroIndex` (indices into `bp.towns` / `bp.heroes`, kept in sync when towns / heroes are removed;
  a condition whose target is removed falls back to `standard`), monsters by `objectId`.

## 2. API (`src/engine/editor/index.js`)

All operations mutate `doc.bp`, record one undo step and return `{ok: true, ...}` or `{ok: false, error}` (nothing
changed). Errors are short codes (`out_of_bounds`, `bad_terrain`, `occupied`, `wrong_terrain`, `on_river`,
`unknown_object`, `no_such_object`, `bad_value`, ...).

| function | notes |
|---|---|
| `createBlankBlueprint({size, width, height, levels, terrain, name, players})` | size `S/M/L/XL/H/XH/G` (36..252) or explicit `width/height`; level 1 is subterranean (rock-free cave floor) unless `terrain` says otherwise; 2 player slots by default |
| `createEditor(bp, {seed})` / `newMap(opts)` | wrap a blueprint into an `EditorDoc` (deep copy); `newMap` = blank + wrap |
| `paintTerrain(doc, pos, terrain, {brush: 1\|2\|4})` | square brush (top-left anchored at `pos`); roads / rivers on water or rock are cleared; objects, towns and heroes whose footprint becomes invalid are **removed** (`removed` in the result, all in the same undo step) |
| `fillTerrain(doc, pos, terrain)` | flood fill (4-neighbour) of the contiguous region with the terrain of `pos` |
| `paintRoad(doc, pos, type, {brush})`, `paintRoadLine(doc, from, to, type)` | `type` 1-3 (dirt / gravel / cobblestone), 0 erases; only land; lines are 8-connected (Bresenham) |
| `paintRiver(doc, pos, on, {brush})`, `paintRiverLine(doc, from, to, on)` | `tile.river` 0/1, land only, lines are 4-connected so the river mask joins |
| `roadMask(bp, pos)` / `riverMask(bp, pos)` | auto-connection masks used by the renderer (8 bits N E S W NE SE SW NW / 4 bits N E S W) |
| `canPlace(doc, defId, pos, {ignore})` | `{ok, error}` without changing anything (cursor preview) |
| `placeObject(doc, defId, pos, props)` | any id of `src/data/mapObjects.js` plus `hero`; props: `owner`, `data` (instance data, §3), `faction` / `ownerSlot` / `name` / `buildings` (towns), `defId` / `ownerSlot` (heroes). Returns `{ok, ref}` |
| `removeAt(doc, pos)` / `removeRef(doc, ref)` | topmost thing on a tile: hero, then object, then town |
| `moveRef(doc, ref, pos)` | keeps id and instance data; footprint / overlap checks at the new place |
| `setProps(doc, ref, patch)` | objects: `{owner?, data: {...}}` (merged; `null` deletes a field), validated per effect (§3); towns: `{faction, ownerSlot, name, buildings}`; heroes: `{defId, ownerSlot, army, primary, skills, spells, artifacts}` (null / [] clears an extra) |
| `pairGates(doc, idA, idB)` | manual subterranean-gate pairing (different levels) |
| `refAt(doc, pos)`, `getRef(doc, ref)`, `describeRef(doc, ref)`, `listRefs(doc)` | lookups for the UI |
| `setMapInfo(doc, {name, description, difficulty})` | |
| `resizeMap(doc, {width, height, levels})` | keeps the top-left corner; things outside are dropped; new tiles get the terrain of the old edge / subterranean |
| `setPlayerCount(doc, n)` | 1..8 slots; towns of dropped slots become neutral, their heroes are removed |
| `setPlayer(doc, slot, {team, human, ai, factions})` | |
| `setVictory(doc, cond)`, `setLoss(doc, cond)` | validated against VICTORY_TYPES / LOSS_TYPES and the map (town / hero / monster references, artifact / creature / resource ids) |
| `addTimedEvent`, `setTimedEvent`, `removeTimedEvent` | map-wide timed events (§6) |
| `undo(doc)`, `redo(doc)`, `canUndo`, `canRedo` | history of 200 steps; a new edit clears the redo stack |
| `beginBatch(doc, label)` / `endBatch(doc)` | group several operations (a brush stroke, a road drag, the settings dialog) into one undo step |
| `validateMap(bp)` | `{ok, errors: [{text, pos?}], warnings: [{text, pos?}]}` = mapgen `validateBlueprint` (positions extracted from its messages) + editor warnings (§4) |
| `serializeMap(bp)` / `deserializeMap(text\|object)` | `{format: 'h3online-map', version: 1, savedAt, blueprint}`; a bare blueprint is accepted; `{ok:false, error}` on garbage / newer versions |
| `blueprintFromRandomMap(options)` | `mapgen.generateMap(options)` -> editable blueprint (meta.players filled, `generated` kept for reference) |
| `buildPlaySettings(bp, seats, {seed, difficulty})` | `createGame` settings for seats `[{slot, isHuman, faction, color, name}]`, victory / loss copied from the map |
| `prepareForPlay(bp)` | deep copy for `createGame` (drops editor-only meta) |

## 3. Instance data the inspector edits (adventure-engine.md "Object instance data shapes")

| object | fields |
|---|---|
| town / random town | `faction` (`random` = owner's / random), `ownerSlot` (null = neutral), `name`, `buildings` (ids; empty = default start set) |
| hero | `defId` (`random` allowed), `ownerSlot`; extras applied by createGame: `army: [{creatureId, count}]` (replaces the start army), `primary: {attack, defense, power, knowledge}`, `skills: [{id, level}]` (replace), `spells: [id]` (a spellbook is added), `artifacts: [id]` (equipped when possible) |
| monster | `creatureId`, `count` (>= 1), `disposition` (`MONSTER_DISPOSITIONS`), `neverFlees`, `noGrowth` |
| resource piles (`resource_*`) | `amount` -> stored as `data.reward = {resources: {<res>: amount}}` (the pickup handler uses `data.reward` when present; `resource_random` is replaced by a concrete pile at placement as in the game) |
| artifacts (`artifact_*`) | `artifactId`, optional `guards` |
| spell scroll | `spellId` |
| pandora's box / event | payload `message, exp, mana, morale, luck, resources, primary, artifacts, spells, creatures, guards`; events also `players` (slots), `humanOnly`, `aiOnly`, `once` |
| seer hut / quest guard | `quest` (`reach_level, reach_primary, kill_monster, kill_hero (heroIndex / heroDefId), bring_artifacts, bring_creatures, bring_resources, be_hero, be_player`), seer `reward` (Reward vocabulary: `exp, mana, morale, luck, resources, primary, artifacts, spells, creatures, skills`), `texts` |
| mines, dwellings, lighthouse, shipyard, garrison | `owner` (slot or null); garrison `army` |
| sign / ocean bottle | `text` |
| prison | `heroDefId` |
| subterranean gate | `pair` (automatic: a new gate pairs with the nearest unpaired gate on the other level; `pairGates` overrides) |
| monoliths / whirlpools | none: two-way monoliths link all of one colour, one-way entrances lead to every exit of the same colour |

## 4. Validation messages

Errors come from `validateBlueprint` (mapgen.md §7: bad tiles, unknown ids, overlaps, objects on wrong terrain,
towns on water / blocked tiles, slots without town or hero, unpaired gates, more than one grail, reachability).
The editor adds the position of the offending thing when the message names an object id, a town / hero index or a
tile, so the UI can jump to it. Editor warnings (do not block Play):

- the map has no name; a player slot has no town (eliminated after 7 days without one);
- a two-way monolith colour with a single monolith; a one-way entrance without an exit of its colour (and vice versa);
- a seer hut / quest guard without a quest; a seer hut without a reward; a `kill_monster` quest whose monster is gone;
- a hero whose `defId` is used twice; a hero standing on another player's town;
- a victory / loss condition referring to something that does not exist; a capture-town target that already
  belongs to a player (he would win at once);
- objects on a terrain the object is not designed for (`def.terrains`), e.g. a land dwelling in the swamp is fine,
  but a boat on land is an error already.

## 5. UI (`src/ui/screens/editor/*`)

```
index.js       screen: layout, input, tools, menus, keyboard, render loop
model.js       pure helpers: tools, object browser filtering, preview state for the map renderer, inspector field specs
pickers.js     searchable sprite lists (creature, artifact, spell, hero, skill) + inspector widgets: single id, id list, creature stacks, skills with levels
mapStorage.js  custom-map library in localStorage (index `h3o.maps`, records `h3o.map.<id>`, LZ-compressed)
dialogs.js     New / Open / Map settings (name, description, difficulty, size, players, victory / loss) / Validate / Play
editor.css     styles (prefix `ed-`)
```

- **Layout (1280x720)**: menu bar on top (New, Open, Save, Export, Import, Random, Settings, Validate, Play, Undo,
  Redo, Menu), tool palette on the left, the map in the middle (rendered by the adventure `createMapView` on a
  *preview state* built from the blueprint: towns / heroes become town objects / hero entities, no fog; painting only
  re-renders the touched chunks via `mapView.invalidateTiles`), minimap,
  level / zoom / grid controls and the property inspector on the right, a status line at the bottom.
- **Tools** (keys 1-9): 1 select / move (click selects, drag moves, Delete removes), 2 terrain brush (terrain
  swatches, brush 1/2/4), 3 fill, 4 road (type), 5 river, 6 object placer (searchable object browser filtered by
  category, sprite thumbnails; the cursor shows the footprint in green / red), 7 erase, 8 town, 9 hero.
  Drag paints (roads / rivers connect along the drag). Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z) undo / redo, `G` grid,
  `U` level, `+`/`-` zoom, arrows scroll, right / middle drag pans, wheel zooms.
- **Storage**: maps are saved under a name in the library (`mapStorage.js`); *Open* lists them (open / delete /
  export) and imports `.json` files; *Export* downloads `<name>.h3m.json` (`serializeMap`).
- **Play**: a seat dialog (human / computer per slot, faction among the allowed ones, difficulty), then
  `createGame(prepareForPlay(bp), buildPlaySettings(...))` -> adventure screen.
- **New Game screen**: a third map type *Custom maps* lists the library (`newGameModel.setCustomMap`); starting loads
  the blueprint from storage instead of calling the generator.
- **Main menu**: *Map Editor* (key M).

## 6. Game hand-off (`src/engine/blueprintExtras.js`)

One hook at the end of `createGame` (`applyBlueprintExtras(state, blueprint, {slotToPlayer, heroIds})`) and one in
`startNewDay` (`applyTimedEvents(state)`, before the victory check):

- **Owners**: slot -> player id for object owners, boat owners, event `players`, `be_player` quests; unplayed -> neutral.
- **kill_hero quests**: `{type: 'kill_hero', heroIndex}` (a starting hero of the blueprint) or `{heroDefId}` get the
  game hero's `heroId`. The editor keeps `heroIndex` in sync when starting heroes are removed.
- **Starting heroes**: the extras of §3.
- **Timed events**: `blueprint.events = [{name, day, repeat (days, 0 = once), players: [slot], humanOnly, aiOnly,
  message, resources (may be negative), creatures: [{creatureId, count}]}]` -> `state.timedEvents` (player ids). Due
  when `turn >= day` and `(turn - day) % repeat === 0` (or `turn === day`). Event `timed_event {playerId, eventId,
  name, message, resources, creatures}` (shown by the adventure screen to its viewer). Editor API:
  `addTimedEvent(doc, ev)`, `setTimedEvent(doc, i, patch)`, `removeTimedEvent(doc, i)` (validated by
  `timedEventProblems`), UI: menu *Events*.

## 6b. Deviations / decisions

- Rivers are a single cosmetic layer whose look follows the terrain (terrain.js), so the editor has one river tool.
- Painting terrain removes objects that no longer fit instead of refusing (as the original editor does).
- Difficulty in `meta` is informational; the player picks the game difficulty when starting.
- Per-slot permissions (human / computer) and allowed towns are honoured by the Play dialog and by New Game's custom
  maps (`slotTypeAllowed`, `allowedFactions`; seats keep their slot numbers); a random town picks among the allowed
  ones (`settings.players[].allowedFactions`, else `meta.players[].factions`, in game.js `resolvePlayerFaction`).
- Timed events of day 1 fire when the game is created (logged in `state.log`; the adventure screen shows messages
  of later days).
- Timed-event creatures join the first hero with room, else the first town's garrison; resources never go below 0.

## 7. Checklist

- [x] blank blueprint, sizes, levels, slots - `tests/editor/editor.test.js`
- [x] terrain brush 1/2/4, flood fill, objects removed under invalid terrain - `tests/editor/editor.test.js`
- [x] roads / rivers incl. lines and auto-connect masks, not on water - `tests/editor/editor.test.js`
- [x] placing every object id of mapObjects.js on a fitting terrain; footprint / overlap / river / water checks - `tests/editor/editor.test.js`
- [x] towns (faction / owner), heroes (defId / owner), monsters, resources (amount), artifacts, scrolls, events, pandora, seer huts, quest guards, gates pairing - `tests/editor/editor.test.js`
- [x] move / remove / properties, condition indices kept in sync - `tests/editor/editor.test.js`
- [x] undo / redo of every operation kind - `tests/editor/editor.test.js`
- [x] serialize / deserialize round trip, version check - `tests/editor/editor.test.js`
- [x] validation messages with positions + editor warnings - `tests/editor/editor.test.js`
- [x] start from a random map - `tests/editor/editor.test.js`
- [x] a 2-player map built only through the API validates, starts a game and survives 7 days of `endTurn` - `tests/editor/playthrough.test.js`
- [x] editor screen mounts, tools paint / place / undo, save / open, validate, play hand-off; main menu button; New Game custom maps - `tests/ui/screens-editor.test.js`
- [x] slot -> player owner remapping, kill_hero quests, starting-hero extras, timed events, allowed factions - `tests/editor/extras.test.js`
- [x] New Game custom maps: slot permissions, allowed towns, kept slot numbers; pickers; timed-events dialog; two-column main menu - `tests/ui/screens-editor.test.js`
- [x] e2e `editor`: paint, town + hero for 2 players, timed event, save, play, custom map in New Game, two-column menu - `tools/e2e/scenarios.mjs`
