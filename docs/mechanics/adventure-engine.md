# Adventure engine (`src/engine/adventure/*`)

Rules come from `docs/mechanics/adventure-objects.md` (objects, movement, monsters, grail) and
`docs/mechanics/spells.md` §13 (adventure spells). This file documents the **implementation**: API,
pending choices (for the UI), instance data shapes (for the map generator), and deviations.
Tests: `tests/adventure/*.test.js` (hermetic: fallback deps) + `tests/adventure/integration.test.js`
(real hero/bonuses/economy/town/combat modules).

## Files

| file | content |
|---|---|
| `index.js` | public API (re-exports), imports `realDeps.js` |
| `deps.js` | seam to other modules: `deps.<fn>` resolves test override -> real module -> local fallback. `setDeps`, `resetDeps`, `useFallbackDeps`, `finishStubCombat` (tests) |
| `realDeps.js` | registers `bonuses.js`, `hero.js`, `economy.js`, `town.js` namespaces (looked up lazily at call time) |
| `map.js` | map model, footprints, `addObject`/`removeObject`, lookups, gate pairing, `debugRenderMap` |
| `init.js` | `initObject`: instance data rolled at placement |
| `rewards.js` | Reward vocabulary: `resolveReward` (ranges -> concrete), `applyReward`, army overflow |
| `movement.js` | step cost, step classification, multi-day Dijkstra, `moveHero`, boats |
| `visit.js` | dispatcher, revisit rules, confirm pendings, guards, hero/town interaction, simple effects |
| `services.js` | dialog objects (market, recruit, university, altar...), flaggables, garrisons, prison |
| `quests.js`, `monsters.js`, `grail.js`, `spells.js`, `daily.js`, `transport.js`, `fog.js`, `combat.js` | as named |

## Public API (DESIGN §8 + extras)

DESIGN §8 names, unchanged semantics: `createEmptyMap, inBounds, getTile, addObject, removeObject,
getObjectAt, getHeroAt, getTownAt, findPath, getReachable, moveHero, visitObject, revealAround,
isExplored, isVisible, castAdventureSpell, digForGrail, startOfDayAdventure, startOfWeekAdventure,
getMineIncome`.

Extras: `getFlaggedDwellings(state, playerId) -> [{objectId, defId, creatures:[id], townGrowthBonus}]`,
`hideAround(state, playerId, pos, radius)`, `revealWhere`, `refreshVision`, `getVisibleTiles`,
`setupGrail(state, {pos?})`, `getPuzzleProgress(state, playerId)` (`{visited, total, piecesRemoved, removed,
cols, rows, complete, grailPos (only when complete), area: {x0, y0, w, h, z, tilesPerPiece} | null}` - `area` is the
map window the puzzle draws, given once a piece is uncovered, so the UI never reads the grail object), `alreadyVisited(ctx)`, `spawnMonthMonsters(state, creatureId)`,
`evaluateMonster(state, hero, obj)` (join/flee/fight preview for AI/UI), `getVisionsInfo`,
`getDisplayedArmy(state, heroId, viewerPlayerId)` (Disguise), `garrisonTransfer(state, heroId, objId,
{from:'hero'|'garrison', slot, count?})` (garrisons and mine guards), `getThievesGuildTable`,
`buildBoatAt`, `questFulfilled`, `getMoveContext/getStepCost/classifyStep` (cost previews),
`debugRenderMap(state, playerId?)`, `concretizeQuest` (SEER_PRESETS -> concrete quest).

Result shapes:
- `findPath -> {path:[pos], steps:[{x,y,z,cost,turn,kind}], cost, turns} | null`. `turns` = extra days
  needed (0 = reachable today); `cost` = points spent (points wasted waiting are not counted).
  `kind` per step: `move|transit|enter|adjacent|hero|town|board|land|teleport`. `dest` may be an
  object / hero / town / boat tile (the last step is then the interaction).
- `getReachable(state, heroId, maxTurns=0) -> [{x,y,z,cost,turns,kind}]`.
- `moveHero -> {ok, events, pos, arrived, stopped}`; `stopped` in `out_of_movement|guard|interaction|event|boarded|landed|blocked|bad_path`.
- Player actions (`moveHero`, `visitObject`, `castAdventureSpell`, `digForGrail`) fail with
  `not_your_turn | pending_choice | in_combat | no_such_hero` when appropriate.

Events (UI): `move {heroId, from, to, cost, teleport?}`, `board`, `land`, `visit {heroId, objectId,
defId, result, refused?, ...}`, `pickup {reward}`, `resources`, `exp`, `temp_bonus`, `flagged`,
`combat {...}`, `monster_encounter {outcome}`, `monster_joined|monster_fled|monster_defeated`,
`hero_meeting`, `town_enter`, `town_captured`, `message {text}`, `map_event`, `box_opened`,
`thieves_guild {table}`, `spell_cast {spellId, success, ...}`, `grail_found`, `dig`.
`visit.result` values: `already_visited, already_owned, already_full, not_ready, nothing, nothing_left,
reward, guarded, cannot_afford, backpack_full, no_key, gate_open, quest, confirm_*, ...`.

## Movement implementation notes

- Step cost: `stepMoveCost` from `terrain.js` (tile **left**, roads both ends, Pathfinding flat
  25/50/75 from the skill level, `terrain_penalty_reduction` of *other* sources (source !==
  `skill:pathfinding`) scales the rest, native army, ×sqrt(2) diagonal truncated). Last-step rule via
  `spendStep(points, cost, orth, diagonal)`.
- Path-finder: Dijkstra over labels `(turn, remaining points)`, ties -> lower total cost. Waiting
  a day refills to the day maximum of the current mode (land/sea). Boarding/landing set points to 0
  (Admiral's Hat: normal step + proportional conversion). Guarded tiles end a path (except the final
  attack on a monster from there). Entrances of `enter` objects are path ends; own/allied garrisons
  and key-holder border gates are passed through; deterministic teleports (paired subterranean gate,
  single-exit monolith) are traversed (edge cost 0) unless their entrance is guarded (the guard fight
  comes first: the path ends there). Random (multi-exit) monoliths / whirlpools are
  path ends: the hero can walk into them, but routes are never planned through them (the exit is
  rolled on entry).
- Fly / Water Walk: transit tiles (water, obstacles, objects/heroes when not the destination) get
  one label per day and must be left the same day; a crossing may start the next day with full
  points. `moveHero` only stops on standable tiles (computes the last affordable standable step).
  Fly costs ×(1+power/100) on every step; Water Walk only on steps leaving water.
- Guards: a monster guards its 8 neighbours of the same land/water kind. Stepping onto a guarded
  tile (not while flying through) starts the encounter; interacting with an object on a guarded tile
  fights first and continues the visit after a win (`context.then = {type:'visit', objectId}`).
- Sailing heroes interact only with water objects / boats / other sailing heroes; land heroes never
  attack sailing heroes. A boat cannot be left on an object tile (landing refused there).
- Towns: own/allied -> hero placed on the entrance + `deps.visitTown`; allied visiting hero ->
  meeting; enemy/neutral with garrison or heroes -> `startCombat({defender:{townId}})`, on victory
  `captureTown` + enter; empty -> captured immediately. Leaving a town calls `deps.leaveTown`.
- Battles: `beginCombat` calls `deps.quickCombat` for AI attackers (unless a human defends: the battle
  is left in `state.combat` for the defender, whatever `settings.quickCombat` says) and for human
  attackers with `settings.quickCombat`, else `deps.startCombat`. Extra opts passed: `terrain` (battlefield of the tile, `ship` when sailing),
  `bank`, `overlay` (tile `overlay` id; not for banks/towns/garrisons), `spellLevelCap: 0` (anti-magic
  garrison). Outcome kinds registered with hero.js (lazily, `ensureCombatWired`): `adv_monster`,
  `adv_object` (`stage`: guards|bank|garrison), `adv_hero`, `adv_town`. Callers go through
  `fight(state, hero, events, combatEvent, defender, context, extra)`: when the adapter refuses
  (`ok:false`, e.g. `attacker_has_no_army`) no `combat` event is emitted but `combat_failed {heroId,
  error}`; `moveHero` then returns `{ok:false, error:'combat_failed', reason, events, pos}` and refunds
  the step's points when the hero did not move (attacking an adjacent monster / hero / town).

## Fog

`player.explored[z]` = flat `number[]` (0/1), width*height per level. Discs are Euclidean
(`dx²+dy² <= r²`). Allies = players with equal `player.team`. Visibility (not stored) = own/allied
heroes (`getSightRadius`), towns (`town.js getTownSightRadius`), flagged objects (radius 3).
`startOfDayAdventure` explores what each player currently sees.

## Pending kinds raised (UI contract)

All: `{ id, kind, playerId, heroId, options:[{id, label, ...}], data:{ objectId, defId, ... } }`.
Resolve with `resolvePending(state, id, optionIndex, extra?)`. Dialog kinds stay open (re-pushed
with fresh options) after every action until the `leave` option.

| kind | options | data / `extra` |
|---|---|---|
| `confirm_fight`, `confirm_pay`, `confirm_open`, `confirm_search`, `confirm_quest`, `confirm_pass`, `confirm_whirlpool` | `yes`, `no` | `guards` (army), `stage`, `cost`, `quest`, `reward`, `color`, `then` |
| `chest_choice` | `{id:'gold', gold}`, `{id:'exp', exp}` | - |
| `primary_choice` | `{id: stat, stat, value}`... (+`decline` when paid) | `cost` |
| `skill_choice` | `{id: skillId, skillId, available}`..., `decline` | `cost`, `level` |
| `university` | `{id:'buy', skillId, cost, available}`..., `leave` | - |
| `altar` | `sacrifice`, `leave` | `canArtifacts`, `canCreatures`; extra `{artifacts:[ref], creatures:[{slot,count}]}` |
| `trade` | `trade`, `leave` | `modes`, `marketCount`; extra `{mode:'resource_resource', give, get, amount /*lots*/}` / `{mode:'creature_resource', slot, count, get}` / `{mode:'resource_player', give, amount, toPlayer}` |
| `buy_artifact` | `{id:'buy', slot, artifactId, cost}`..., `leave` | - |
| `recruit` | `{id:'recruit', creatureId, available, cost /*each*/}`..., `leave` | extra `{count}` (default: max affordable) |
| `upgrade_creatures` | `{id:'upgrade', slot, from, to, count, cost}`..., `leave` | - |
| `buy_war_machine` | `{id:'buy', artifactId, cost, available}`..., `leave` | - |
| `tavern` | `{id:'hire', heroDefId, cost}`..., `leave` | - |
| `build_boat` | `yes`, `no` | `cost` |
| `garrison_exchange` | `transfer`, `leave` | `removableUnits`; extra `{from:'hero'|'garrison', slot, count?}` |
| `army_overflow` | `{id:'dismiss', slot, creatureId, count}`..., `leave` | `creatureId`, `count` (newcomers) |
| `monster_join` | `yes` (accept), `no` (fight) | `cost` (0 = free), `creatureId`, `count`, `sizeLabel`, `then` |
| `monster_flee` | `yes` (pursue = fight), `no` (let go) | `creatureId`, `sizeLabel`, `then` |
| `hero_exchange` | `done` | `otherHeroId` (trading itself via hero.js `tradeArmy/tradeArtifact`) |
| `town_portal` | `{id: townId, townId}`..., `cancel` | `spellId` |

Plus hero.js's `level_up` (from experience).

## Object instance `data` shapes (map generator contract)

Anything given in `addObject(state, defId, pos, {owner?, id?, data})` wins over the roll. Armies may
be given as 7-slot arrays or as `[{creatureId, count, stacks?}]` lists (split like bank guards).

| effect | `data` |
|---|---|
| `pickup`, `chest` | none (rolled at the visit; a pickup with `reward` (concrete Reward, set by the map editor) grants exactly that); `resource_random` is replaced by a concrete pile at `addObject` |
| `artifact` | `artifactId`, `guards?` (army), `cost?` (Resources) |
| `spell_scroll` | `spellId`, `artifactId: 'spell_scroll'`, `guards?`, `cost?` |
| `pandoras_box` | `preset?` (PANDORA_PRESETS id; `faction?` for creature presets), `guards?`, `message?`, `exp, mana, morale, luck, resources, primary, skills:[{id,level}], artifacts:[id], spells:[id], creatures:[{creatureId,count}]` (negatives allowed) |
| `event` | same as pandora + `players:[id]`, `humanOnly`, `aiOnly`, `once` |
| `grail` | none (`setupGrail` places it) |
| `mine` | `obj.owner`; abandoned: `resource`, `guards`, `cleared`; owner's guard army `garrison` |
| `weekly_reward` | `reward` (concrete), `visitedWeek` |
| `reward_once` | `reward` (concrete), `visited` |
| `bank` | `level` (index), `guards` (army), `reward` (concrete: `resources, artifacts:[id], creatures, spell:{spellId, requires?}`), `visited`, `cleared` |
| `primary_boost`, `exp_boost`, `library`, `temp_bonus`, `mana_restore` | none (`mana_restore double`: `visitedWeek`) |
| `level_up` | `cost` (Resources, `{}` = free) |
| `learn_skill` | `skills:[skillId]` (not for hermit's shack) |
| `scholar` | `kind: 'primary'|'skill'|'spell'`, `stat` / `skillId` / `spellId` |
| `university` | `skills:[4 ids]` |
| `learn_spell` | `spellId` |
| `black_market` | `stock:[artifactId|null]` |
| `refugee_camp` | `creatureId`, `count` |
| `prison` | `heroDefId`, `exp?`, `army?` |
| `lighthouse`, `shipyard` | `obj.owner` |
| `reveal_map`, `hide_map`, `obelisk` | obelisk: `index` |
| `message` | `text` |
| `quest_guard` | `quest` |
| `seer_hut` | `quest`, `reward` (Reward vocabulary incl. `skill`, `artifact`, `spell`), `deadline?` (absolute day), `texts?: {quest, completed}`, `completed` |
| `garrison` | `obj.owner`, `army` (7 slots), `removableUnits` |
| `teleport` | gates: `pair` (computed) |
| `boat` | `heroId`, `owner` |
| `dwelling` | `obj.owner`, `stock:{creatureId:n}`, `guards?`, `cleared` |
| `monster` | `creatureId` (or `tier` for random), `count`, `disposition`, `character`, `neverFlees`, `noGrowth`, `reward?` (Reward) |
| `town` | `townId` |

Quests: `{type:'reach_level', level} | {type:'reach_primary', stats} | {type:'kill_hero', heroId} |
{type:'kill_monster', objectId} | {type:'bring_artifacts', artifactIds} | {type:'bring_creatures',
creatures} | {type:'bring_resources', resources} | {type:'be_hero', heroDefId} | {type:'be_player', playerId}`.
`kill_*` are tracked as `player.visited['killed_hero_<id>']` / `player.visited['killed_<objectId>']`.
Keys: `player.visited['key_<color>']`. Learned object contents: `player.visited['info_<objectId>']`.

## Deviations / decisions

- **Prison** is used from the neighbouring tile (like `adjacent`) so the freed hero can take the prison tile.
- Hero vs hero: the attacker stops next to the defender (no entering the tile).
- `per_battle` objects with an empty roll (Fountain of Fortune 0) store a `{morale 0}` marker bonus.
- Tree of Knowledge grants `expForLevel(level+1) - exp` before Learning (Learning may overshoot a little).
- Summon Boat only fetches boats with `data.owner === player`; boats get their owner when built or boarded.
- Visions range is Chebyshev; View Earth/Air return marker lists in the `spell_cast` event (no fog change).
- Dimension Door uses are tracked in `hero.ddUses = {turn, count}`.
- Month-of monsters: one stack per 300 tiles on random free surface land.
- Tavern object: hired hero placed on a free neighbouring land tile; the pool slot becomes `null`
  (refilled by the town engine's weekly tavern refresh).

## Not (fully) implemented

- Overlay effects in combat are only *passed* (`opts.overlay`); applying them is hero.js/combat's job.
- Path-finding does not route through random (multi-exit) monoliths or whirlpools.
- Hero meeting: `hero_exchange` is only an acknowledgement; Scholar spell trading is `deps.meetHeroes`.
- Mine guard garrisons are edited through `garrisonTransfer` only (no pending dialog at mines).
- Combat-related "next battle" temp bonus expiry is hero.js's job.

## Checklist

- [x] map model, footprints, entrances, blocking - `tests/adventure/map.test.js`
- [x] instance data rolled at placement for every rolled type - `map.test.js`
- [x] movement costs (terrain of origin, roads, diagonal, Pathfinding, native army, artifacts, last step) - `movement.test.js`
- [x] multi-day path-finding, reachability, blocked tiles, entrances, zone of control - `movement.test.js`
- [x] heroes meeting / attacking, sanctuary, towns (enter / capture / siege) - `movement.test.js`
- [x] boats (board, land, Admiral's Hat, favorable winds), shipyard, monoliths, gates, whirlpools, border guards/gates, garrisons, Fly, Water Walk - `transport.test.js`
- [x] fog: discs, sources, allies, cover of darkness, refresh - `fog.test.js`
- [x] all 48 effect types incl. revisit rules - `effects.test.js`
- [x] monsters: formula, outcomes, sympathy, gold, flee, fight, split, growth - `monsters.test.js`
- [x] adventure spells - `spells.test.js`
- [x] grail, obelisks, digging, weekly ticks, mine income - `calendar.test.js`
- [x] real-module integration (quick combat, level-up pending, mine income) - `integration.test.js`
