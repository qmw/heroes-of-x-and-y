# Game loop, economy and the town engine

Code: `src/engine/game.js`, `town.js`, `economy.js`, `calendar.js`, `victory.js`, `gameDeps.js`
(+ `gameDepsReal.js`). Tests: `tests/game/*.test.js`. Town *rules* (build trees, effect types, growth
formula, trade rates) are specified in `docs/mechanics/towns.md`; this document covers the runtime:
state fields, API, order of the daily/weekly ticks, victory, score, and what the UI needs.

## 1. State added to DESIGN §4

| field | meaning |
|---|---|
| `state.weekOf` | `{ kind: 'normal'\|'week_of'\|'month_of'\|'plague', creatureId\|null, name }` |
| `state.gameOver` | `null \| { winner: playerId\|null, reason, turn, score }`; `state.winner` mirrors `winner` |
| `state.heroPool` | `{ [heroDefId]: Hero }` heroes who retreated / surrendered (shared with `hero.js`) |
| `state.defeated` | `{ hero: {id: playerId}, monster: {objId: playerId} }` credit for quest targets (`recordDefeat`) |
| `state.meta` | copy of `blueprint.meta` |
| `state.settings` | `settings` of `createGame` + normalised `victory` / `loss` (see §4) + `players` config |
| `player.slot` | blueprint slot of the player (`player.id` is always the index in `state.players`) |
| `player.team` | optional alliance id (players with the same value are allies) |
| `player.lastAiTurn` | `state.turn` of the AI player's last played turn (`runAiTurn`) |
| `player.eliminatedOn`, `player.eliminationReason` | set by `eliminatePlayer` |
| `town.role` | `'main'\|'other'` (which starting set it got) |
| `town.manaVortexUsedWeek` | absolute week number in which `mana_double` was used |
| `town.portal` | `null \| { creatureId, count }` Portal of Summoning offer |
| `state.townMerchants` | `null \| { stock: (artifactId\|null)[7], rolledOn }` the ONE Artifact Merchants stock shared by all towns |
| `town.objectId` | id of the `town` map object |
| `town.coastal` | optional boolean overriding the water-adjacency check |
| `hero.visited['<townId>:<buildingId>']` | one-time `visit_bonus` taken |

`town.garrison` holds troops only while there is **no garrison hero**: a hero moved into the garrison row
absorbs them into his army (`swapTownHeroes` fails with `army_wont_fit` otherwise) and from then on the
garrison row *is* his army (`getGarrisonArmy(state, town)`).

## 2. Calendar and events (`calendar.js`)

`state.turn` is the absolute day (1-based); `date = { day 1-7, week 1-4, month 1+ }`, 28-day months.

On day 1 of a week `rollWeekEvent` sets `state.weekOf` (one `randInt(0, 99)`):

| when | roll | event |
|---|---|---|
| new week (not week 1 of a month) | `< 25` | `week_of`: random town creature, base or upgraded (tiers 1-7, as in the original), **+5 growth** for the dwelling of either form |
| | else | `normal` ("Week of the Squirrel" ...) |
| new month | `< 40` | `month_of`: random un-upgraded creature of tiers 1-6; after growth its stock **doubles** in every town with its dwelling; `deps.spawnMonthMonsters(state, creatureId)` hook |
| | `40..49` and month > 1 | `plague`: every town stock is **halved** instead of growing |
| | else | `normal` |

The percentages follow the original (25 % / 40 % / 10 %); the creature pools are our choice.
`state.settings.forceWeekEvent` (one `weekOf`-like object, or an array consumed one per week) overrides the
roll for scenarios and tests. Week 1 of the game is always `normal`.

## 3. Turn order and the daily tick (`game.js`)

`endTurn(state)`: refused with `game_over`, `in_combat`, or `pending` (current player has pending choices).
Passes the turn to the next living player; after the last one `startNewDay` runs. AI players
(`isHuman === false`) are then played at once through `runAiTurn` until a human is to move (at most one AI
turn per player per call). If the current player is an AI who has not played `state.turn` yet
(`player.lastAiTurn`, set by `runAiTurn`) - e.g. the first player of the game is a computer, or an all-AI
game hit the per-call cap - `endTurn` plays that turn first; the UI calls `endTurn` on mount when an AI is
to move. `setAiDriver(fn)` installs the AI: `fn(state, playerId)` performs the turn's
actions and must not call `endTurn`; afterwards leftover pendings of that player are auto-resolved with
`safePendingOption` (first `leave`/`no`/`decline`/`cancel`/`done` option, else option 0 - the first skill
of a `level_up`). The default driver does nothing. `settings.manualAi` stops the turn on AI players instead.
**Human defenders:** a computer hero attacking a human's hero or town does not quick-resolve
(`adventure/combat.js humanDefends`); the battle stays in `state.combat`, `endTurn` returns at once with a
`combat_waiting` event while it is still the computer's turn, the UI lets the human fight it (or quick-resolve
it), and the next `endTurn` call **resumes the computer's day**: `waitForHuman` stores
`player.aiResume = {turn, count, pending}` (plain JSON, survives save/load); `aiToPlay` is true again for that
player once the battle is over, `runAiTurn` clears `pending` and calls the driver a second time (the AI keeps
its per-day memory in `player.ai.day`: hires, boat, number of runs), then the turn passes on as usual. At most
`MAX_AI_RESUMES` (4) resumptions per player and day; a run that ends in a waiting battle leaves its pendings for
the resumption, and leftover pendings of a computer player never make `endTurn` fail (they are auto-resolved
with `safePendingOption` when no resumption is left).

`startNewDay` order:

1. `advanceDate`.
2. `startOfDayHero` for every hero (movement, mana regen, temp-bonus expiry) - hero engine.
3. `startOfDayAdventure` - adventure engine.
4. On day 1 of a week: `rollWeekEvent`; per player Mystic Pond + gold interest (`applyWeeklyTownResources`,
   on the gold held before income); per town `startOfWeekTown` (growth / plague / month doubling, Portal of
   Summoning pick, neutral garrison +10 %) and on a new month `startOfMonthTown` (shared Artifact Merchants
   restock); `refreshTavern` per player; month-of hook; `startOfWeekAdventure`.
5. `startOfDayTown` for every town: `builtThisTurn = false`, `mana_restore`, visit effects for heroes
   staying inside (one-time bonuses, Stables, Mana Vortex, guild spells).
6. `applyFogCover` (Cover of Darkness) for all other players.
7. Income per living player (`applyDailyIncome`).
8. Town-less countdown: a player without towns gets `daysWithoutTown += 1`; at 7 he is eliminated
   (`no_town`), before that a `town_loss_warning {daysLeft}` event is emitted. Capturing a town resets it.
9. Map-wide timed events due today (`applyTimedEvents`, `timed_event` events).
10. `checkVictory`.

**Deviation from towns.md §5:** there is no income on day 1 (as in the original the game starts with
exactly the difficulty's starting resources); the first income arrives on day 2.

### Game creation

`createGame(blueprint, settings)`:
players are created in slot order (`player.id` = index). `faction: 'random'` resolves to the faction of a
fixed-faction blueprint town of that slot, else a random faction. Towns: `'random'` = owner's faction (owned)
or random (neutral); the first town of each player gets the `main` starting set, others `other`;
`bt.buildings` overrides. Each town gets a `town` map object (`data.townId`, `owner`). Neutral towns get a
garrison of tiers 1-3 (2 weeks of base growth x `neutralStrength`). Heroes: blueprint heroes (`'random'` =
random free hero of the owner's faction); a player with a town but no blueprint hero gets a random hero of
his faction as visiting hero of his main town (`settings.autoHeroes !== false`). Starting bonus
(`players[i].bonus`): `gold` 500-1000 (steps of 100), `resource` (+5-10 wood and ore for wood/ore factions,
else +3-6 of the faction's silo resource), `artifact` (random treasure to the first hero), `random`, or none.
Then tavern pools, victory/loss normalisation, the map-editor extras (`blueprintExtras.js`: slot -> player owner
remapping, `kill_hero` quests by starting hero, starting-hero army / skills / spells / artifacts, timed events in
`state.timedEvents`, docs/mechanics/editor.md §6) and the `deps.setupGrail(state)` hook. A random player faction is
picked among `settings.players[i].allowedFactions` (else the blueprint's `meta.players[].factions`) when given.

### Difficulty (`economy.js` `DIFFICULTIES`)

| level | rating | human start (gold / wood+ore / rare) | AI start | neutral strength |
|---|---|---|---|---|
| 0 Easy | 80 % | 30000 / 30 / 15 | 5000 / 5 / 2 | 0.8 |
| 1 Normal | 100 % | 20000 / 20 / 10 | 7500 / 10 / 5 | 1.0 |
| 2 Hard | 130 % | 15000 / 15 / 7 | 10000 / 15 / 7 | 1.15 |
| 3 Expert | 160 % | 10000 / 10 / 4 | 10000 / 15 / 7 | 1.3 |
| 4 Impossible | 200 % | 0 / 0 / 0 | 10000 / 15 / 7 | 1.5 |

Starting resources and rating follow the original. `neutralStrength`
(`getNeutralStrengthMultiplier(state)`) is our choice - the original ties neutral stack sizes to a map
setting; it is applied to neutral town garrisons here and exposed for the map generator / adventure engine.
`aiIncomePercent` is 100 at every level (original: no AI income cheat) but is honoured by `getDailyIncome`.

## 4. Elimination, victory, loss (`victory.js`)

A player is eliminated when he has no heroes and no towns (`defeated`), after 7 days without a town
(`no_town`), or by a loss condition. His heroes vanish, towns and flagged objects become neutral.

`settings.victory` (`'standard'` or an object; `allowStandard` (default true) keeps "last player standing"
as an alternative, `appliesToAi` (default true) lets AI players win by it):

| type | params | fulfilled when |
|---|---|---|
| `defeat_all` | - | one living player is left |
| `capture_town` | `townId` or `townIndex` | the player owns that town |
| `capture_all_towns` | - | every town on the map belongs to the player or his allies (at least one to him) |
| `defeat_hero` | `heroId` / `heroIndex` / `heroDefId`, `loseIfFailed?` | the hero is gone and the credited player is this one: `recordDefeat` (written by every hero defeat in combat - `null` when a neutral stack / garrison won, i.e. nobody), the player to move only when nothing was recorded (scripted removal). A target lost uncredited sets `state.objectiveFailed` (event `objective_failed` once); the game goes on (conquest still wins with `allowStandard`), unless `loseIfFailed: true` eliminates the objective's players (humans; everybody with `appliesToAi`) with reason `objective_failed` |
| `defeat_monster` | `objectId` | the map object is gone; credit as above |
| `acquire_artifact` | `artifactId` | a hero of the player owns it (equipped or backpack) |
| `accumulate_creatures` | `creatureId`, `count` | heroes' armies + town garrisons hold that many |
| `accumulate_resources` | `resource`, `amount` | treasury holds that much |
| `build_grail` | `townId?` | the player owns a town with the Grail structure |
| `survive` | `days` | `turn > days`; best score among living players (humans first) |

`settings.loss`: `'standard'`, `{type:'lose_hero', heroId|heroIndex|heroDefId}`, `{type:'lose_town',
townId|townIndex}` (the owner at game start loses when the hero is gone / the town changes hands),
`{type:'time_limit', days}` (everybody loses when `turn > days`; `gameOver.winner = null`).

`checkVictory(state)` is idempotent and is called by `endTurn`, `startNewDay`, `captureTown`, building the
Grail and `resolvePending`; other engines may call it after any action.
Result: `{ ok, events, over, winner }`.

### Score

`score = max(0, floor((200 - floor((days + 10) / (playerTowns + 5)) + 25*allEnemiesDefeated + 25*grail)
* difficulty% / 100))` - the original rating formula (VCMI's reverse-engineered high-score code): `playerTowns` =
towns the player owns, `grail` = Grail structure in an own town **or** the Grail carried by an own hero. `getScoreBreakdown` returns the parts and the rank
title (`RANK_TITLES`, one creature name per 25 points from Peasant to Archangel at 500; the names are our
table).

## 5. Town engine API (`town.js`)

All actions return `Result`. Common errors: `no_such_town`, `not_owned`, `not_your_turn` (the town's
owner is not the player whose turn it is), `pending` (owner has pending choices), `no_hero`,
`not_enough_resources`.

| function | notes / errors |
|---|---|
| `createTown(state, {faction, owner, pos, name?, buildings?, role?})` | entity only (map object by `createGame`); rolls guild levels that are built, stock = one week of growth |
| `canBuild(state, townId, id)` / `build` (alias `buildInTown`) | errors in towns.md §2 order: `not_available, already_built, built_this_turn, missing_requirements (+missing), no_water, capitol_exists, no_grail, not_enough_resources` |
| `getAvailableBuildings(state, townId)` | `[{id, name, kind, cost, status: 'built'\|'available'\|'blocked', error?, missing?}]` |
| `getTownGrowth` / `getTownGrowthBreakdown` | `{[creatureId]: n}` / rows `{dwellingId, creatureId, tier, base, percent, horde, artifacts, external, week, special, total}` |
| `getRecruitInfo(state, townId)` | rows `{creatureId, tier, dwellingId, available, growth, cost, affordable, source}` |
| `recruit(state, townId, creatureId, count, target)` | `bad_count, no_dwelling, not_enough_creatures, bad_target, no_hero, no_free_slot`; with an upgraded dwelling the base creature can still be bought (leftover base stock first, then the upgraded stock); Portal of Summoning creatures are bought the same way |
| `recruitAll(state, townId, target)` | strongest first, as many as affordable |
| `getUpgradeInfo` / `upgradeStack(state, {townId, where, slot})` | whole stack; `empty_slot, no_upgrade_available` |
| `getWarMachinesForSale` / `buyWarMachine(state, townId, machineId, heroId?)` | `not_sold_here, slot_occupied` (ballista and cannon share a slot) |
| `buySpellbook(state, townId, heroId?)` | 500 gold; `no_mage_guild, already_has_spellbook`; guild spells are learned at once |
| `dismissTownStack(state, townId, {where, slot})` | whole stack; `empty_slot, last_stack` (hero rows) |
| `getTavernHeroes` (refills empty slots of a living player) / `hireHero(state, townId, index)` | `no_tavern, no_hero_offered, town_occupied, too_many_heroes`; result carries `heroId` |
| `ensureTavernPool`, `refreshTavern`, `returnHeroToTavern`, `getFreeHeroDefs` | pool handling |
| `getThievesGuildLevel` / `getThievesGuildInfo(state, playerId)` | `{level, rows: [{id, label, unlocked, ranking}]}`; rows unlock at levels 1,1,2,2,3,3,4,5,6 (`THIEVES_GUILD_ROWS`); `ranking` = groups of player ids, best first |
| `visitTown(state, heroId, townId)` / `leaveTown(state, heroId)` | `not_your_town, town_occupied` / `not_in_town, hero_is_garrisoned` |
| `swapTownHeroes(state, townId)` | `army_wont_fit` |
| `townArmyMove(state, townId, {where, slot}, {where, slot}, count?)` | `where: 'garrison'\|'visiting'`; errors of `armyMove` (`last_stack` protects hero armies) |
| `captureTown(state, townId, playerId, {heroId?, keepGarrison?})` | `playerId = null` makes it neutral; owner change, old garrison wiped, capitol downgrade, reveal, portal re-roll, `daysWithoutTown = 0`, victory check |
| `sellCreatures(state, townId, {where, slot, count?, resource})` | Freelancer's Guild; whole lots only; `last_stack` |
| `getMerchantStock`, `getArtifactMerchantOffers`, `buyArtifact(state, townId, slot, resource)`, `sellArtifact(state, townId, ref, resource)` | `sold_out, not_tradable` |
| `sacrificeCreatures`, `sacrificeArtifact` | Grotto |
| `transformToSkeletons(state, townId, {where, slot})` | `nothing_to_transform`; merges into an existing skeleton stack |
| `buildBoat(state, townId)` | `no_shipyard, no_free_water, boat_exists` |
| `getCastleGateDestinations`, `useCastleGate(state, townId, destTownId)` | `bad_destination` |
| `learnUniversitySkill(state, townId, skillId, heroId?)` | `not_taught_here, already_known, no_skill_slot` |
| `getSiegeInfo(state, townId)` | `null` without a fort, else `{townId, fortLevel, faction, buildings, wallHp, gateHp, keep, turrets, moat, mines, towers: {attack, keep: {min,max}\|null, turret: {min,max}\|null}, garrison, escapeTunnel, canRetreat}` |
| `getTownGarrisonBonuses(state, townId)` | `{morale, luck, bonuses: Bonus[], primary: {attack, defense, power, knowledge}}` |
| `getPlayerTownBonuses(state, playerId)` | `player_hero_bonus` (de-duplicated per building) + `necromancy_percent` (stacking) |
| `hasNativeTerrainAll(state, playerId, faction)`, `playerHasGrailBuilding` | Lodestar / grail queries |
| `startOfDayTown`, `startOfWeekTown`, `startOfMonthTown`, `applyWeeklyTownResources`, `applyFogCover` | ticks driven by `game.js` |

Economy (`economy.js`): `canAfford`, `pay`, `addResources`, `maxAffordable`, `costTimes`, `getDailyIncome`,
`getIncomeBreakdown` (`{towns, mines, heroes, total}`), `applyDailyIncome`, `countMarketplaces`,
`getMarketRate`, `marketTrade(state, playerId, give, get, lots, ctx?)` (`lots` = number of lots at
`marketRate`; `ctx.extraMarkets` counts Trading Posts; errors `bad_resource, bad_amount, no_marketplace`),
`sendResources(state, from, to, resource, amount)`, `startingResources`, `DIFFICULTIES`.

Game (`game.js`): `createGame`, `endTurn`, `startNewDay`, `getCurrentPlayer`, `runAiTurn`, `setAiDriver`,
`resolvePending`, `checkVictory`, `eliminatePlayer`, `recordDefeat`, `calculateScore`, `getScoreBreakdown`,
`getRankTitle`, `serialize`, `deserialize` (throws on a corrupt save or another `version`),
`getKingdomOverview(state, playerId)`, `applyStartingBonus`.

### Pending choices

The game / town / economy modules raise **no pending kinds of their own**: every town action is a direct
call with all parameters. Pendings seen during town actions come from the hero engine (`level_up`, e.g.
after a Battle Scholar Academy visit or a Grotto sacrifice).

### Events (for the UI log)

`day_started {turn, date}`, `week_started` / `month_started {weekOf, date}`, `turn_started` / `turn_ended
{playerId, turn}`, `ai_turn`, `income {playerId, income}`, `town_growth {townId, growth}`, `plague`,
`population_doubled`, `weekly_resource`, `gold_interest`, `building_built`, `recruited`, `stack_upgraded`,
`war_machine_bought`, `spellbook_bought`, `spell_learned`, `skill_learned`, `visit_bonus`,
`visit_temp_bonus`, `mana_restored`, `mana_doubled`, `hero_hired`, `town_visited`, `town_left`,
`town_heroes_swapped`, `army_moved`, `town_captured`, `capitol_downgraded`, `market_trade`,
`resources_sent`, `creatures_sold`, `artifact_bought`, `artifact_sold`, `sacrificed`, `transformed`,
`boat_built`, `castle_gate`, `fog_cover`, `town_loss_warning {playerId, daysLeft}`, `player_eliminated
{playerId, reason}`, `game_over {winner, reason}`. Week events, eliminations, starting bonuses and the game
end are also appended to `state.log` (`{turn, type, ...}`, last 300 entries).

## 6. Dependencies (`gameDeps.js`)

`town.js` / `game.js` / `economy.js` reach the hero and adventure engines only through `deps.<fn>`:

| dep | real module | fallback behaviour |
|---|---|---|
| `addHero, removeHero, startOfDayHero, canLearnSpell, learnSpell, addTempBonus, giveExperience` | `hero.js` | minimal versions on `leveling.js` (experience auto-picks the first skill) |
| `getHeroBonuses, sumBonus, getMaxMana, getSightRadius` | `bonuses.js` | skills + artifacts + specialty + temp; sight 5 |
| `createEmptyMap, addObject, removeObject, revealAround, hideAround, isExplored, startOfDayAdventure, startOfWeekAdventure, getMineIncome, getFlaggedDwellings` | `adventure/index.js` | flat 0/1 fog arrays, objects without footprints, no-op ticks |
| `spawnMonthMonsters(state, creatureId)`, `setupGrail(state)` | `adventure/index.js` (optional hooks) | no-op |

`gameDepsReal.js` binds the real modules (lazy lookup per call; a missing export falls back).
Tests use `useFallbackDeps()` for hermetic runs, `setGameDeps({...})` for fakes and `resetGameDeps()`.
`getFlaggedDwellings` may return creature ids, `{creatureId}` / `{creatureIds}` / `{creatures}` records (the
adventure engine returns `{objectId, defId, creatures, townGrowthBonus}`; `townGrowthBonus: 0` = no +1) or
map objects (`data.creatureId`, `data.creatures` or the object definition's `effect.creatures`).
The real `hideAround(state, playerId, pos, radius)` works out the player's vision itself; the fallback takes
a fifth `keep(x, y)` argument. Heroes who retreat / surrender are parked by `removeHero(state, id,
'retreated' | 'surrendered')` in `state.heroPool` and re-used by `addHero` (`opts.tavern` = first stack
only) - `hireHero` and `returnHeroToTavern` rely on exactly that contract.

## 7. Simplifications and known gaps

- `sells_artifacts` uses the price helpers of `data/buildings.js` (not `engine/artifacts.js`'
  `artifactSellPrice`, which has a different efficiency table).
- `fog_cover` is applied once per new day for every other player (days are simultaneous here).
- `native_terrain_all` and `escape_tunnel` are only *exposed* (`hasNativeTerrainAll`, `getSiegeInfo`
  `.escapeTunnel` / `.canRetreat`); the combat setup has to honour them.
- `garrison_bonus`, `siege_defense`, arrow-tower numbers: exposed through `getSiegeInfo` /
  `getTownGarrisonBonuses`; applying them is the combat adapter's job.
- A retreated hero keeps his artifacts (original behaviour).
- Teams: `player.team` (createGame: `settings.players[i].team`, else blueprint `meta.players[k].team` /
  `meta.teams[slot]`). An alliance left standing wins `defeat_all` together (`gameOver.winners`, the
  `game_over` event carries `winners` when there are several); the score's "all enemies defeated" ignores
  allies; `hero.js startCombat` refuses allied fights (`allied`) and the adventure engine meets allied heroes
  / enters allied towns and garrisons instead. Special victory conditions stay per player.

## 8. Checklist

Town mechanics: see the engine checklist in `docs/mechanics/towns.md` §10.

- [x] createGame: players, random factions, towns + map objects, heroes, starting bonus, fog, tavern, condition refs - `tests/game/game.test.js`
- [x] starting resources by difficulty (human / AI), neutral strength multiplier - `tests/game/economy.test.js`
- [x] canAfford / pay / addResources, income sums, market rate table, trades, transfers - `tests/game/economy.test.js`
- [x] turn order, pending / combat guard, dead players skipped, AI driver hook, manual AI, all-AI games - `tests/game/game.test.js`
- [x] calendar rollover, week / month events with forced rolls, month-of hook - `tests/game/calendar.test.js`
- [x] daily tick order, income from day 2, start-of-day resets - `tests/game/game.test.js`
- [x] elimination (no heroes & towns, 7 days without town + warning countdown) - `tests/game/victory.test.js`
- [x] every victory condition (10) and loss condition (4) - `tests/game/victory.test.js`
- [x] score formula and rank titles - `tests/game/victory.test.js`
- [x] serialize / deserialize, version check, identical continuation - `tests/game/game.test.js`
- [x] kingdom overview - `tests/game/game.test.js`
- [x] 60-day scripted simulation stays valid, deterministic and serializable - `tests/game/simulation.test.js`
- [x] 112-day economy per faction: whole build tree (Grail included) buildable, weekly growth and daily income equal a hand computation, JSON round trip each month - `tests/game/faction-economy.test.js`
- [x] the same on the real hero / bonuses / adventure engines through the seam - `tests/game/integration.test.js`
