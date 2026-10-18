# Adventure map screen (`src/ui/screens/adventure/*`)

The main game screen: map view, right panel, status bar, turn flow and the adventure-specific
pending dialogs. Built on the kit (`docs/mechanics/ui.md`) and the adventure / game / hero engines
(`adventure-engine.md`, `game-loop.md`, `hero-engine.md`). Tests: `tests/ui/screens-adventure.test.js`.

```
index.js      screen controller: mount/unmount, input, movement, combat hand-off, turn flow, buttons
mapView.js    canvas renderer: camera, terrain chunk cache, objects, heroes, fog, path, cursor
model.js      pure helpers (no DOM): names/hover text, info models, path markers, fog masks,
              minimap colours, hero/town lists, end-turn checks, event messages, puzzle window
panel.js      right panel: Minimap, hero list, town list, selected hero/town box, button grid
dialogs.js    puzzle map, world view (View Air/Earth markers), cast-spell book, quest log, system
              menu, adventure options, thieves' guild table, victory/defeat, info popups
pendings.js   registerPendingRenderer for every adventure pending kind (see §6)
adventure.css styles (prefix `adv-`), injected once into document.head
```

## 1. Layout (1280×720 stage)

| area | rect | content |
|---|---|---|
| map view | 0,0 1040×684 | canvas; hover status line at its bottom edge |
| status bar | 0,684 1040×36 | `ResourceBar` (7 resources + date) |
| right panel | 1040,0 240×720 | minimap 224×224 + Surface/Underground tabs, selected hero/town card, hero roster, town roster, button grid (2×5) |
| overlays | whole stage | hotseat curtain, "computer players moving", target-picking hint |

## 2. Map rendering (`mapView.js`)

- Tile size 32 or 48 px (zoom levels; mouse wheel / `+` `-`); 48 by default (the e2e run showed heroes and
  monsters as specks at 32 px on the 1280×720 stage). Camera in pixels of the current tile
  size (`ui.createCamera`), clamped to the map. Only the visible window is drawn.
- Layers per frame: cached terrain chunks → path preview (under objects) → objects and heroes
  z-sorted by footprint bottom row (heroes after objects of the same row) → shroud → hover cursor →
  path markers/day numbers/destination cross → pick-mode highlight.
- **Terrain chunks**: 16×16 tiles rendered once to an offscreen canvas (terrain + fringe
  transitions + river + road + magic overlay via gfx `drawTerrainTile`; fallback: flat terrain
  colours with simple road/river strokes). LRU of 48 chunks. Invalidated on state replacement,
  zoom change, `invalidateTerrain()`, `invalidateTiles(tiles)` (only the chunks around those tiles - the map
  editor reuses this renderer on a preview state), and when the gfx layer reports `onSpriteReady`.
- Objects: `object` sprites with `size` = tile px, `playerColor` = owner colour (flag), town
  variant = faction / state = fort level. Monsters are drawn as their creature. Boats carrying a
  hero are drawn under the hero. The hidden grail is never drawn. A per-chunk bucket index of
  objects is rebuilt on every state notification (cheap) so a frame touches only visible chunks.
- Heroes: `hero` sprite, `facing` from the last move direction, player-colour flag. Heroes and
  monsters (pixel art) get a 1px dark ink outline (canvas `filter`) to match the outlined procedural
  objects; monsters also a contact shadow.
  A hero visiting a town is drawn smaller (1.2 tiles) and 0.3 tile lower, in front of the gate, so
  town and hero both stay readable.
- Fog: unexplored tiles are filled with a world-anchored 512px texture (`makeShroudPattern`: dark
  parchment blotches on the surface, cool slate underground; also fills the area beyond the map edge),
  falling back to the `shroud` sprite (`variant: 'full'`) without canvas patterns; explored tiles next to
  unexplored ones get the fringe mask (bit i = DIRS8[i] neighbour unexplored, order N E S W NE SE
  SW NW). Explored = permanent knowledge (`player.explored`); nothing is dimmed afterwards (as in
  the original). Read-only: the renderer never calls `ensureExplored`.
- Path preview: `findPath` steps; dots green for `turn === 0`, red for later days, a day-number
  marker where a new day starts, a cross on the destination (sword icon colour when it ends in an
  interaction).
- Redraw only when dirty (state notifications, camera move, hover, animation); render loop is
  `ctx.anim.loop` (stopped by the router on screen change). Edge scrolling (option `edgeScroll`),
  arrow keys, middle-mouse drag.

## 3. Interaction

| input | effect |
|---|---|
| left click own hero | select it (again → hero screen) |
| left click own town (no hero selected / non-entrance tile) | select it (again → town screen) |
| left click with a hero selected | 1st: path preview to the tile (object footprint → its entrance); 2nd on the same tile: move |
| right button held | info popup for the tile / object / hero / town (released → hides) |
| double click | hero → hero screen, own town → town screen |
| Space / "Move" | continue the stored destination of the selected hero |
| wheel | zoom 32 ↔ 48 |

Movement: `moveHero` runs at once; its `move/board/land` events are animated step by step (hero
drawn at an interpolated position, camera follows), then: `state.combat` → combat hand-off,
`town_enter` of an own town → `showScreen('town', {townId})`, then `ctx.resolvePendings()` (loop
until no pending and no combat), messages for notable events, game-over check. Stored destinations
are UI memory only (not in the state).

### Combat hand-off
`state.combat` set after an action: if the option `quickCombat` is on, the started battle is
auto-resolved (`combat.autoResolve(cs)` + `hero.finishCombat(state)`) and a result dialog is shown;
otherwise `showScreen('combat', { returnTo: 'adventure' })`. On every mount the screen checks for a
leftover `state.combat` (e.g. the combat screen was unavailable) and offers *Quick combat* / *Fight*;
afterwards pendings are resolved and the game-over state checked. **Defending** (a computer hero
attacked us, `combat_waiting`): the map centres on the target and the defender always gets the choice
"You are under attack — Fight the battle / Quick combat", also with the `quickCombat` option on
(retreat / surrender are inside the battle). Afterwards `endTurn` continues: the computer finishes its
day (game-loop.md §3), then the other players move. A computer player's pendings never block it.

### Right-click info texts (`model.describeTile`)
- terrain name (+ road / river / magic overlay), "Unexplored" in the shroud;
- object: name, owner ("owned by Red"), "visited" / "not visited" for this hero (per_hero,
  per_hero_daily/weekly) or player (per_player, once, weekly), learned contents
  (`player.visited['info_<id>']`), mine resource;
- monster: size label + plural creature name ("A pack of Pikemen"), exact count only with an
  active Visions spell (`getVisionsInfo`);
- hero: own/allied → full card (level, class, primary, army); enemy → name, level, army as size
  labels via `getDisplayedArmy` (Disguise); with Thieves' Guild level ≥ 1 also primary skills,
  ≥ 2 exact army counts (our reading of the original: more taverns, more detail);
- town: name, faction, owner, fort level; own → garrison; enemy → garrison size labels.

## 4. Right panel (`panel.js`)
Minimap (terrain colours, owned objects / towns / heroes in player colours, unexplored as dark
parchment - slate underground - `unexploredRgb`, camera rectangle, click/drag jumps) with
Surface / Underground tabs showing the level on screen (second tab dimmed without underground);
the selected hero card (58px portrait - click = hero screen -, name, level/class, labelled
movement and mana bars with `getMaxMana`, effective primaries, 7-slot army row) or town card
(map sprite, faction / fort, built today, garrison, creatures ready to recruit from `town.stock`);
the hero roster (4 per row: portrait with movement/mana bars, asleep marker), the town roster
(map sprite, name, built-today check, gold dot = creatures ready to recruit, tooltip lists them),
and the buttons:
Kingdom (K), Underground (U), Quest log (Q), Sleep/Wake (Z), Move (Space), Cast spell (C),
Adventure options (A: dig, puzzle, view world), System (O / Esc: save, load, options, main menu),
Next hero (H), End turn (E).

## 5. Turn flow
- First mount with `params.newGame`: lazy `installAi()` from `src/engine/ai/index.js` (once per
  page; missing module → AI players simply pass).
- End turn: confirmation when a hero still has movement left (option `confirmEndTurn`); overlay
  "Computer players are moving…" while `game.endTurn` runs (synchronous; one frame is yielded so
  the overlay paints).
- Events after `endTurn`: `week_started` / `month_started` → "Astrologers proclaim the Week of
  the X" (plague / month-of variants), `player_eliminated`, `town_loss_warning` for the human,
  `game_over` → victory / defeat dialog with `getScoreBreakdown` (score + rank) → main menu.
- Computer attacks: when `endTurn` comes back with `state.combat` (a computer hero attacked one of our
  heroes / towns - `combat_waiting`), a "You are under attack" message centres the map on the target, the
  battle opens (or quick combat with that option), and the turn carries on afterwards (`start()` on the
  remount calls `endTurn({force: true})`).
- Hotseat: when the player to move is a different human than the last one shown, a curtain
  ("Blue player's turn") hides the map until clicked. Then `ctx.autosave()` (start of each human
  day), pendings, camera on the first hero / town.

## 6. Pending renderers (`pendings.js`)

| kind | dialog | resolves with |
|---|---|---|
| `confirm_*` | message + guard icons with size labels, cost, quest, reward | 0 yes / 1 no |
| `chest_choice`, `primary_choice`, `skill_choice`, `army_overflow`, `town_portal` | `choose` with icons | option index |
| `university`, `buy_artifact`, `upgrade_creatures`, `buy_war_machine`, `tavern` | list with costs, Buy / Leave | the chosen option index (Leave = its index) |
| `recruit` | creature list + count slider (default max affordable) | `{optionIndex, extra: {count}}` |
| `trade` | resource ↔ resource with rates (+ creature → resource, gifts when the market allows) | `{optionIndex: trade, extra: {mode, give, get, amount}}` / `{mode:'creature_resource', slot, count, get}` / `{mode:'resource_player', give, amount, toPlayer}` |
| `altar` | artifact checkboxes + creature amounts | `{extra: {artifacts: [ref], creatures: [{slot, count}]}}` (`ref` = `{slot, index}` / `{backpack: i}`) |
| `garrison_exchange` | hero row + garrison row; a click-move between rows transfers | `{extra: {from: 'hero'|'garrison', slot, count?}}` |
| `build_boat` | confirm with cost | 0 / 1 |
| `monster_join` / `monster_flee` | message with the creature | 0 yes / 1 no |
| `hero_exchange` | `openHeroTrade(ctx, a, b)` from `../dialogs/heroTrade.js` (lazy), fallback: two army rows using `tradeArmy` | 0 |

Dialog kinds re-open after every action (the engine re-pushes them) until Leave.
On mount the screen lazily imports `../hero/levelUp.js` (`level_up` renderer) and
`../dialogs/heroTrade.js` (which also registers `hero_exchange`), then re-registers its own
`hero_exchange` renderer (same `openHeroTrade`, plus a fallback); missing modules are ignored.

## Deviations / decisions
- No "explored but not visible" dimming (original behaviour); enemy heroes on explored tiles are drawn.
- Thieves' Guild detail levels for enemy hero popups are our reading (see §3).
- Stored hero destinations are UI-only (lost on reload).
- Quest log lists seer huts the player visited (not completed) and explored quest guards.

## Checklist
- [x] mount on a real `createGame` state, panel, lists, status bar — tests/ui/screens-adventure.test.js
- [x] select hero + two-click move calls `moveHero`, hero moves, path preview — screens-adventure.test.js
- [x] only the visible window is drawn; terrain chunk cache — screens-adventure.test.js
- [x] minimap click moves the camera; level switch — screens-adventure.test.js
- [x] right-click texts for terrain, mine, monster, town, own/enemy hero, unexplored — screens-adventure.test.js
- [x] every pending renderer resolves with the documented payload — screens-adventure.test.js
- [x] end turn with a fake AI driver, curtain for hotseat, week message, victory dialog — screens-adventure.test.js
- [x] rendering leaves the JSON state untouched — screens-adventure.test.js
- [x] panel card / rosters / level tabs, unexplored parchment minimap colour, town stock markers — tests/ui/visual-polish.test.js
