# Map generator and scenarios (`src/engine/mapgen/*`)

Random maps in the spirit of the original RMG (template = zone graph, zones get terrain, towns, mines and
treasure by value, connections get guards) plus handcrafted scenarios. Output: a `MapBlueprint`
(DESIGN.md §8) that `createGame(blueprint, settings)` accepts. Tests: `tests/mapgen/*.test.js`.

## 1. Files

| file | content |
|---|---|
| `index.js` | public API |
| `generator.js` | random-map pipeline, option normalisation, `MAP_SIZES` |
| `templates.js` | template data, `expandTemplate`, `BANDS` (treasure value bands) |
| `layout.js` | force-directed zone layout, weighted Voronoi (power diagram) tile assignment |
| `treasure.js` | guard-strength formula, guard creature choice, treasure pool, pile composition |
| `builder.js` | grid bookkeeping shared with scenarios: occupancy, reserved network, placement + connection, towns, decor |
| `validate.js` | `validateBlueprint`, reachability flood (`reachableFrom`, `landReachableFrom`) |
| `ascii.js` | `renderBlueprintAscii` |
| `scenarios/*.js` | scenario descriptions, `scenarioBuilder.js`, `index.js` (`listScenarios`, `buildScenario`) |

## 2. API

- `generateMap(options) -> MapBlueprint | { ok: false, error }` (never throws).
  - `{ type: 'scenario', scenarioId | scenario }` -> the scenario's blueprint (fixed map; a fresh copy each call).
  - otherwise a random map. Options (names used by `newGameModel.buildMapOptions`):
    `size: 'S'|'M'|'L'|'XL'|'H'|'XH'|'G'` (36/72/108/144/180/216/252; or `width`/`height`), `levels` or
    `underground: bool`, `water: 'none'|'normal'|'islands'`, `monsters` / `monsterStrength: 'weak'|'normal'|'strong'|'none'`,
    `template` (id, default `default`), `players` (2..8), `playerSlots: [{slot, faction, hero}]` or `factions: []`,
    `teams` (optional, copied to `meta.teams` / `meta.players[i].team`), `seed`, `name`.
- `listTemplates() -> [{ id, name, description, players: [min, max], sizes, water }]`.
- `listScenarios() -> [{ id, name, description, size, width, height, levels, players, playerSlots, difficulty,
  victory, loss /* texts */, victoryCondition, lossCondition, factions }]`.
- `validateBlueprint(bp, { requireAllReachable = true }) -> { ok, errors, warnings, stats }`.
- `renderBlueprintAscii(bp, { showGrail }) -> string` (one block per level).
- Extras: `reachableFrom(bp, slot)`, `landReachableFrom(bp, slot)`, `guardStrength`, `pickGuard`, `expandTemplate`,
  `normalizeOptions`, `MAP_SIZES`, `TEMPLATES`, `SCENARIOS`.

### Blueprint

`{ map, towns: [{pos, faction, ownerSlot, name?, buildings?}], heroes: [{ownerSlot, pos, defId}], meta, victory?, loss? }`.
`map` is a full `GameMap` (tiles with `t`, `road` 0-3, `river`, `obj`, `blocked`; objects created with the real
adventure `addObject`, so their instance data is rolled exactly like in a game; `placedArtifacts`, `puzzleOrder`).
Towns are **not** map objects yet (createGame adds them) but their 5x3 footprints are kept free. Starting heroes stand
on the main town's entrance (createGame makes them its visiting hero). Random factions are resolved by the generator
(player towns carry the faction that decided the home terrain). `meta`: `name, description, size, width, height,
levels, template, playerSlots, seed, water, monsters, generated, players: [{slot, faction, team}], teams, zones:
[{id, type, level, owner, terrain, area, center, towns, townsPlanned, mines, minesPlanned, treasureValue, factions}],
links: [{a, b, guard, wide, level, via: passage|monolith|corridor|sea, border}], stats: {objects, towns, guards:
[{kind, strength, creatureId, count, objectId, pos}], obelisks, grail, gates, seerHuts, rivers, decor}, attempt`.
Scenarios add `victory` / `loss` at the top level (and in `meta`) - the new-game screen copies them into `settings`.

## 3. Templates

A template is data: `perPlayer` zones (ids `<key>_<player>`), `shared` zones, explicit `zones`, `links`
(`{a, b, guard, wide?, border?, minPlayers?, maxPlayers?}` where a reference is `'key'` = same player, `'key+1'` =
next player around the ring, or a shared zone id), or `random` parameters. Zone fields: `type`
(`start|treasure|junction`), `owner` (start), `size` (relative area), `terrain` (`native` | `random` | id | list),
`monsters` (zone strength), `towns: {neutral}`, `mines: {wood, ore, mercury, sulfur, crystal, gems, gold, rare}`
(`rare` = that many distinct random rare-resource mines), `treasure: [{min, max, density}]`.

| id | players | graph |
|---|---|---|
| `default` (Balanced) | 2-8 | start - treasure - central hub (neutral town, gold mine); treasure zones form a ring |
| `duel` (2SM4d) | 2 | each start has two treasure zones that border the opponent's |
| `crossroads` | 2-4 | rich starts (all mines + neutral town) with a pocket, all linked to a strong central hub (Jebus-like) |
| `ring` | 2-8 | start, treasure, next start ... around a ring |
| `small_ring` | 2-6 | starts linked directly (keymaster border gates for 3+ players) + small treasure pockets |
| `wilderness` | 2-8 | random graph per seed: 1-2 treasure zones per player, junction chain, extra links |
| `archipelago` | 2-8 | forces `water: islands`; every zone an island |
| `grand_melee` (8mm6) | 3-8 | start + two treasure zones each linking neighbours, rich central zone |
| `balance` | 2-8 | mirrored: poor (wide link) and rich satellites, central castle zone |

Absent players' explicit start zones (fixed-zone templates) become treasure zones with a neutral town.

## 4. Pipeline (`generator.js`)

1. **Graph**: expand the template; resolve random factions (unused ones preferred); neutral town factions. With
   two levels every surface zone gets an underground mirror zone (treasure, `under` band, a rare mine, 30% a
   neutral town if big), mirrored links (guard >= 3000) and subterranean-gate pairs for every start zone plus
   about half of the others (at least two).
2. **Layout** (§4.1): six tries of force layout + assignment, keep the one with the most adjacent linked zones.
3. **Water**: `normal` = noisy sea band along the edges + lakes in 35% of treasure zones; `islands` = water
   within ~W/40 of every zone boundary and on the edge; single-tile puddles removed.
4. **Terrain**: one terrain per zone (start: faction native terrain, Dungeon -> dirt on the surface; neutral-town
   zones 70% the town's native terrain; else weighted random, slow terrains less likely; underground:
   subterranean 75% / lava). Underground caves: rock where noise > 0.63 except within 3 tiles of zone boundaries.
5. **Zone cleanup**: largest 8-connected land piece per zone; stray pieces become water / rock / obstacles.
   Borders: land tiles 8-adjacent to another zone's land (both sides on maps >= 72x72, the bigger zone's side
   only on smaller maps). The largest connected non-border piece is the zone interior.
6. **Passages**: for each link a pair of 4-adjacent border tiles (one per zone) near the middle of the shared border,
   both with interior neighbours, >= 4 tiles from other passages; `wide` links open a 3-tile gap. Links whose
   zones do not touch get a two-way monolith pair (4 colours), then a reserved corridor carved through the map.
   Underground border tiles turn into rock.
7. **Towns**: start-zone town as close to the zone centre as fits (5x3 footprint + 1-tile margin + 2 free rows
   below), neutral towns far from it (>= 6-10 tiles); starting hero on the main town (`hero` option or random).
8. **Networks & roads**: every zone joins its seeds (town forecourts, passage tiles, island landing tiles) into one
   reserved tree (Dijkstra with noise), drawn as roads: cobblestone in start zones, gravel in zones with towns,
   dirt elsewhere. Reserved tiles are never covered by objects or obstacles - **this is the connectivity guarantee**:
   every later object joins its access tile (the tile below the entrance) to the network by a reserved path.
9. **Guards on links**: monster in the passage (zone-guard strength, `hostile`), keymaster border guard + tent
   for `border` links, monolith guard, gate guard on the underground side.
10. **Mines**: wood/ore 4-12 tiles from the home town, others >= 9 tiles; guarded by value (§6).
11. **Water extras**: shipyards in start zones with water (islands) / start zones and 30% of others (normal);
    islands: a boat at every start island's landing. Water treasure (~5 piles / 650 water tiles, kept 2 tiles
    off any coast or object), a whirlpool pair on big seas.
12. **Grail** (a diggable free tile of a non-start surface zone) and 2-8 obelisks.
13. **Treasure** (§5), then seer huts (50% of non-start zones): quest/reward from `SEER_PRESETS` within the zone's
    band; `bring_artifacts` quest items are placed (guarded) in another zone; `kill_monster` targets the nearest
    monster.
14. **Obstacles**: border tiles covered with blocking decor of the zone terrain (largest fitting first, 1x1 rocks as
    fallback); interior decor by a noise field (clusters), sparser next to reserved paths; isolated sea rocks.
15. **Rivers**: 35% of surface zones get a cosmetic river between two far free tiles (not on objects).
16. **Validation** (§7); up to 6 attempts with derived seeds, else `{ ok: false, error }`.

### 4.1 Zone layout

Force-directed in the unit square: start zones fixed-ish on a circle (r = 0.36, random rotation), others start at
the average of their placed neighbours; 300 iterations of springs (`want = 0.8 (ri + rj)`) and overlap repulsion
(`ri = sqrt(size / total / pi)`). Tiles go to the zone with the least power distance `|p - c|^2 - w` over
domain-warped coordinates (noise amplitude 0.08) - curved, mostly connected cells; the weights are tuned 14 times
(`w += (target - area) / (N pi) * 0.9`) so areas match the size shares. Orphan pieces join a neighbour.

## 5. Treasure

Pool: every object with `frequency > 0` except decor, monsters, towns, transport, guards, keymasters, signs, events,
seer huts, obelisks, coastal objects. Pandora's boxes expand to their `PANDORA_PRESETS` (value, `data.preset`,
`faction` of the zone), spell scrolls to five entries (value by spell level, `data.spellId` rolled), dwellings use
`DWELLING_VALUE_BY_TIER` and weigh 2.5x for the zone's factions (0.25x other factions, 0.7x neutral). `limit` per
zone is respected. Banks, abandoned mines and guarded dwellings have their own guards.

Per zone and band: `piles = round(area * density / 650 * U(0.85, 1.15))`. A pile targets `T in [min, max]`; the first
object is a weighted pick with `value <= T` (and >= min(0.4 min, 2000)); a 1x1 first object can get up to two more
1x1 objects until the pile reaches `min` - they stand in a row and share one access tile below the middle one, where
the guard stands (a monster guards its 8 neighbours, so all three entrances are guarded). Valuable piles (>= 6000) prefer
spots far from the home town.

Bands (`BANDS`): start 500-3000 x9, 3000-6000 x4, 6000-9000 x1; low 500-3000 x9, 3000-6000 x6, 10000-15000 x1;
mid 3000-6000 x8, 6000-10000 x5, 10000-15000 x2; high 5000-10000 x7, 10000-20000 x4, 20000-30000 x2;
rich 3000-9000 x10, 10000-15000 x4, 15000-25000 x2; junction 500-3000 x6, 3000-6000 x3; under 1000-4000 x8,
4000-9000 x4, 9000-15000 x1.

## 6. Guards

Original RMG formula (`treasure.js guardStrength`): index `i = zoneStrength + mapStrength - 1` with map
weak/normal/strong = 2/3/4 and zone weak/normal/strong = -1/0/+1 (connection guards use zone 0), clamped 0..4;

```
strength = max(0, (value - V1[i]) * M1[i]) + max(0, (value - V2[i]) * M2[i])
V1 = [2500, 1500, 1000, 500, 0]   M1 = [0.5, 0.75, 1, 1.5, 1.5]
V2 = [7500, 7500, 7500, 5000, 5000] M2 = [0.5, 0.75, 1, 1, 1.5]
```

`strength` is the total AI value of the stack. Objects whose strength is below 2000 stay unguarded (wood/ore mines,
cheap piles on normal); connection guards are always placed when their value is > 0. Monster setting `none`
(map or zone) places no guards at all. Creature (`pickGuard`): any non-war-machine creature of tier 1-7 (tier 8
dragons only above 120000) whose count `strength / aiValue` is 5..60 (fallback 1..250, then the closest), zone
factions x3, upgraded x0.6; count = `strength / aiValue * U(0.9, 1.1)`. Disposition `aggressive` (connections `hostile`).

## 7. Validation (`validate.js`)

Errors: dimensions / tiles shape, unknown terrain, roads on water or rock, unknown object ids, objects or footprints
out of bounds, footprint overlaps (objects and town footprints), land objects on water / water objects on land,
unmarked entrance tiles, monster creature / count, unknown artifact / hero / faction ids, bad `ownerSlot`, towns on
water / rock / blocked tiles, heroes on water, slots without town or hero, unpaired or same-level gates, more than one
grail; then **reachability**: a flood from every player's start (hero, else town) over a combined land + sea graph:
8-neighbour steps; `adjacent` objects are crossable when removable (pickups, monsters) or guards that open (border /
quest guards) - fighting through is allowed; `enter` entrances are passable (never from above for objects >= 2 rows,
towns included); `interact: none` obstacles block; teleports link (paired gates, two-way monolith groups, one-way
entrance -> exits of the channel, whirlpools); land -> sea by boarding a boat or from a reached shipyard / the player's
own coastal town of a faction with a shipyard; sea -> land onto free tiles. Every start must reach every other
start, every town and every visitable object must be reached (or touched) from some start.

## 8. Scenarios

A scenario module exports a description; `scenarioBuilder.js` builds it:
`{ id, name, description, size, players, difficulty, scale, seed, decor, victory, loss, victoryText, lossText,
playerInfo, layout, towns, heroes, roads, objects, scatter, rivers? }`.

- `layout`: rows of characters (one level, or an array of levels), each cell = `scale x scale` tiles. Lowercase =
  open terrain (`g` grass, `d` dirt, `s` sand, `n` snow, `w` swamp, `r` rough, `l` lava, `h` highlands, `x`
  wasteland, `u` subterranean, `~` water, `#` rock), uppercase = the same terrain covered with obstacles.
- `towns: [{cell, faction, owner, name?, buildings?}]` (spiral search for room), `heroes: [{owner, town | cell, defId?}]`,
  `roads: [{points: [cell | 'town:i'], type}]`, `objects: [{def, cell: [cx, cy, z?], data?, guard?: value |
  {creatureId, count, disposition?}, name?, pairWith?, radius?, spellLevel?}]` (`monster` stands on the nearest road
  tile, `boat` on water next to a joined shore tile, `grail` on a free diggable tile, `pairWith` pairs gates;
  `seal: true` on a `monster` turns the free, non-road tiles of its layout cell outside its 3x3 guard zone into
  obstacles, so a stack standing in a gap wider than 3 tiles cannot be bypassed - used by the campaign maps),
  `scatter: [{area: [x0, y0, x1, y1] | cells: [[cx, cy]], z?, band, count, factions?, guard?}]`.
- The same reserved-network rule as the generator keeps everything reachable; obstacle cells are walled with decor;
  validation must pass (tested).

| id | size | players | condition | theme |
|---|---|---|---|---|
| `first_blood` | S | 2 | standard | Castle vs Stronghold valleys, neutral market town, guarded passes |
| `dragons_hoard` | M | 3 | acquire Armageddon's Blade | three kingdoms around a sealed volcanic lair (black dragons) |
| `grail_hunt` | M | 4 | build a Grail structure | four realms, cross-shaped desert, eight obelisks |
| `seven_kingdoms` | L | 7 | standard | layout computed from polar sectors around a central throne town |
| `sapphire_archipelago` | M | 4 | accumulate 60,000 gold | islands, boats and shipyards, sea treasure, whirlpools |
| `undead_rising` | M, 2 levels | 3 | defeat the hero Vidomina; lose Lionsgate = loss | catacombs under the map, paired gates |
| `factory_lines` | S | 2 | capture Gearhaven; 112-day limit | Factory vs Cove around a neutral foundry |

All names, texts and layouts are original.

## 9. Timings (Node 20, this machine)

S ~30 ms, M ~100-150 ms, L ~150-250 ms, XL single level ~300 ms, XL two levels 8 players 0.4-1.2 s, G (252) two
levels ~1.5 s (generation incl. validation; occasional retries add a run).

## 10. Deviations / decisions

- Zones are separated by obstacle walls (rock underground) with 1-tile passages, like the original; zones that do not
  touch after layout are joined by two-way monoliths (only 4 colours), then by a reserved corridor.
- Treasure density is per 650 tiles of zone interior (our calibration, not the original's numbers).
- The guard threshold 2000 and the creature-choice heuristic are our picks; the strength formula is the original.
- Underground zones mirror the surface zones; the original distributes template zones over the levels.
- Teams are only recorded in `meta` (createGame does not read them).
- On crowded maps a neutral town or a subterranean-gate pair that does not fit is dropped (a player's home town
  never is: the attempt fails and the next sub-seed is tried). Templates outside their recommended sizes may fail
  with `{ ok: false, error: '... - try a bigger map or fewer players' }` (e.g. `grand_melee` on S with islands).
- Dungeon start zones on the surface use dirt (subterranean is underground-only in `terrain.js`).
- `town.js getFreeHeroDefs` also treats heroes waiting in prisons as taken (minimal edit), so a random starting or
  tavern hero is never the prisoner.

## 11. Checklist

- [x] templates as data (9), expansion for 2-8 players, connected graphs - `tests/mapgen/templates.test.js`
- [x] guard formula (original) and scaling with the monster setting, guard creature choice - `templates.test.js`, `generate.test.js`
- [x] option names of the new-game screen; screen options -> map -> game - `templates.test.js`, `generate.test.js`
- [x] every template generates and validates on S and M, createGame accepts it, state is JSON - `generate.test.js`
- [x] L and XL two-level maps, timings, rock underground, paired gates across levels - `generate.test.js`
- [x] determinism per seed - `generate.test.js`
- [x] reachability between players, of all towns and objects; passage guards - `generate.test.js`
- [x] towns and mines per template (home town, sawmill, ore pit near it; crossroads all mines) - `generate.test.js`
- [x] fixed factions / heroes, native terrain under the home town - `generate.test.js`
- [x] water: none / normal (edge sea, water objects on water) / islands (boats, shipyards, sea-only reach) - `generate.test.js`
- [x] treasure classes, banks, dwellings, obelisks, grail, seer huts with obtainable quests, roads - `generate.test.js`
- [x] validator catches unknown ids, overlaps, bad terrain, walled-in players - `generate.test.js`
- [x] ASCII rendering - `generate.test.js`
- [x] >= 6 scenarios (7): metadata, validation, game start, victory/loss references - `tests/mapgen/scenarios.test.js`
- [x] 7-day simulation with `endTurn` (default AI driver) on generated maps stays valid - `tests/mapgen/simulation.test.js`
- [x] teams applied to players (createGame reads `meta.players[].team` / `meta.teams`) - `tests/game/victory.test.js`
- [ ] scenario-specific timed events / custom texts on objects (signs exist but no event scripting)
