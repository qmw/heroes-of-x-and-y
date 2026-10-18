# Strategic (adventure) AI

Code: `src/engine/ai/*`. Tests: `tests/ai/*.test.js`. Tactical combat AI is **not** here
(`src/engine/combat/ai.js`); battles of AI players are auto-resolved by the adventure engine through
hero.js `quickCombat`.

## Entry points (`src/engine/ai/index.js`)

| export | meaning |
|---|---|
| `aiDriver(state, playerId)` | plays one AI player's whole turn (never calls `endTurn`, never throws) |
| `installAi()` | `game.setAiDriver(aiDriver)`; the UI calls it once when a game starts / is loaded |
| `uninstallAi()` | `setAiDriver(null)` |
| `getLastAiReport(playerId?)` | stats of the last AI turn (of that player), not in the state: `{playerId, turn, run, ms, planMs, moveMs, simMs, actions, moves, builds, recruits, hires, fights, lost, timeouts, attacks, neutralSieges, idle, kinds, interrupted, pendings, trades, spells, errors:[...], trace:[...]}` (`trace`: one line per hero decision and battle; `idle`: heroes without any target at the start of their day; `attacks`: battles against other players' heroes / towns; `kinds`: chosen targets per kind; `run` > 1: resumed after a battle against a human) |

`installAi()` must be called before the first `endTurn` (and the combat engine should be loaded:
`await hero.engineReady`, otherwise AI battles fail with `combat_engine_unavailable` and are skipped).
`game.js` is not changed: importing the AI from there would create an import cycle and change the
"default driver does nothing" contract the game tests rely on.

## Determinism and budgets

- All randomness goes through `state.rng` (only used for difficulty noise). Iteration orders are
  insertion orders of the state objects, so a seed + the same human inputs replays identically.
- Budgets are counted in **actions** (deterministic), not in milliseconds: at most 12 planning
  steps per hero, 300 engine actions per turn, 100 pending resolutions per batch, 2–3 battle
  simulations per turn. A wall-clock guard (2 s) only exists as a last-resort safety net and never
  triggers in normal play.
- Every engine call checks `ok`; failures are recorded in the turn report and the target is
  black-listed for the rest of the turn. A `moveHero` that neither moves the hero nor spends
  points nor removes the target black-lists the target, so a hero loop always terminates.
- AI memory lives in `player.ai` (plain JSON): `mainHeroId`, `targets {heroId: key}`, `skip`
  (refused visits), `avoid {targetKey: {until, strength}}` (a fight lost: no hero weaker than 1.5×
  the loser tries it again for 7 days), `hold {heroId: {townId, last, days}}` (garrison holding),
  `day {turn, hired, boat, runs}` (per-day flags that survive an interrupted turn).
- **Human defenders**: when a move starts a battle against a human (`state.combat` stays set) the
  driver stops at once (`outOfBudget` / `spend` see `state.combat`); game.js resumes the turn after
  the human fought it (game-loop.md §3), the driver then simply plays the rest of the day.
- Per-player level: `player.aiDifficulty` (benchmarks / mixed games) overrides `settings.difficulty`.

## Turn structure

1. Resolve own pendings (see below).
2. **Town phase A**: a player without heroes hires first. For every owned town: one building
   (planner), actions with the visiting hero (main hero: take
   the garrison, recruit into his army, cheap upgrades, spellbook; other heroes: recruit into the
   garrison); a threatened town without a hero first recruits everything into its garrison.
3. **Hero phase**: the main hero first, then the others. Each hero repeatedly picks the best target
   (below; full horizon on the first step of the day, one day afterwards), verifies a chosen fight
   with a simulation (Normal and up), checks where it will stand tonight (never within a day of a
   stronger enemy hero unless retreating into a town), walks there (`moveHero` with the planned
   path), resolves the pendings it raised, and does follow-up actions (town visit → recruit/merge;
   meeting → hand troops to the main hero) until it runs out of movement, has nothing worth doing,
   or the per-hero step budget is used. A hero holds a threatened town when the town (with him)
   can repel the attacker but he cannot beat the attacker in the open.
4. **Town phase B**: hire heroes (the town must be free of visiting heroes), recruit leftovers
   into garrisons (everything when the town is threatened). Newly hired heroes then get a hero
   phase of their own.
5. Resolve leftover pendings.

## Pendings

| kind | decision |
|---|---|
| `level_up` | highest value in the class-kind skill table (might / magic / scout role), upgrades valued slightly below new key skills; Leadership is worthless for an all-undead army |
| `chest_choice` | gold vs experience: experience is worth 1.5 gold for the main hero below level 10 (0.8 later), 0.4 for other heroes |
| `monster_join` | yes when free or the price is ≤ 60 % of the gold; otherwise "no" (= fight; only reached when the fight was judged acceptable) |
| `monster_flee` | pursue only when the estimated loss is negligible (< 3 % of the army), else let it go |
| `confirm_fight` | yes when the battle estimate says "win with acceptable losses" (banks, guards, garrisons) |
| `confirm_pay` / `confirm_open` / `confirm_search` / `confirm_quest` / `confirm_pass` | yes when affordable (pay: ≤ 35 % of the gold / resources) |
| `confirm_whirlpool`, `build_boat`, `altar`, `trade`, `tavern`, `buy_war_machine`, `garrison_exchange` | no / leave |
| `primary_choice` | attack (might) / power (magic), never a paid decline when affordable |
| `skill_choice`, `university` | best skill by the table when affordable and a slot is free, else decline / leave |
| `buy_artifact` | buy when the price ≤ 20 % of the gold |
| `recruit` (external dwellings) | buy each offered creature, as many as affordable keeping the gold reserve |
| `upgrade_creatures` (Hill Fort) | upgrade stacks while the price ≤ 30 % of the gold |
| `army_overflow` | dismiss the weakest stack if the newcomers are stronger, else leave |
| `hero_exchange`, `town_portal` | done / the planned town |
| anything else | an option with id `leave`/`no`/`cancel`/`done`/`decline`, else option 0 |

## Strength and battle estimates (`strength.js`)

- Hero strength = `armyStrength` (Σ aiValue × count) × √((1 + 0.05·attack)(1 + 0.05·defense)) ×
  a small spell-power factor for heroes with a spellbook and mana (the monster formula of the
  adventure engine plus magic).
- Town defence = (garrison or garrison hero) × fort factor (1 / 1.25 / 1.4 / 1.6 for none / fort /
  citadel / castle) + visiting hero.
- Estimate: ratio `r = ours / theirs`; win when `r ≥ minRatio` (neutrals; `attackRatio` against other
  players, see Difficulty); expected loss fraction `min(1, 0.55 / r²)` (calibrated against auto-resolved
  battles: ~13 % at r 1.2–1.6, ~10–20 % at r 2). Neutral **shooters** count up to 50 % stronger
  (`shooterFactor`: × 1 + 0.5 · their shooter share · (1 − our shooter / flyer / speed ≥ 7 share)).
- Close calls (`0.7 ≤ r ≤ 3`; hero vs hero `0.8 ≤ r ≤ 4`), difficulty ≥ 1 (Normal), combat engine loaded:
  planning uses the estimate only; the **chosen** target (and `confirm_fight` / `confirm_open` /
  `monster_flee` decisions) is re-judged with a **simulated** battle on copies of the two combat
  sides (`combat.createCombat` + `autoResolve({maxRounds: 12})`; the game state and `state.rng`
  are untouched, the seed is derived from the turn and target). A simulated win counts only with
  < 70 % losses (hero fights < 60 %); losses are inflated by 15–20 %. Results are cached per turn
  (keyed by both army strengths). Budget per turn: 2 / 3 / 4 / 5 simulations (Normal .. Impossible) —
  an auto-resolved battle costs 30–250 ms with the current combat AI.
- When a battle started by `moveHero` is not resolved (the adventure engine swallows a failed
  `quickCombat`, e.g. no combat engine loaded) the AI stops picking fights for the rest of the turn.
- Gold value of strength: 0.7 gold per aiValue point.

## Targets (`targets.js`)

Per hero, `getReachable(heroId, maxTurns)` (main hero 3 extra days, others 2) gives the arrival
costs of every tile/object. Candidate objects must be on explored tiles and not guarded by a
monster (the guard itself is the target then and carries the guarded objects' value plus its
**road value**: 20 per passable land tile within 5 tiles that the hero cannot reach now, 40 when
unexplored, max 4000, half for secondaries — gateway guards between zones open the map). Town
positions are known from Normal up (`knowTowns`; the original AI ignores the fog for towns).
`score = (value − expected losses in gold) × modifiers / (days + 0.35)` where `days = max(turns,
pointsSpent / maxMovePoints)`; the hero's previous target gets ×1.25 (hysteresis). Danger: an
enemy hero threatens every tile within one day of movement (`maxMovePoints / 100` tiles) with his
*potential* = his strength + garrison and 60 % of the stock of one of his towns within that range
(he may recruit before attacking). Targets in danger stronger than the hero are dropped (only
`defend` / `own_town` / `retreat` stay, ×0.7); danger above 70 % of the hero halves the value.

| target | value |
|---|---|
| resource piles, chests, campfires, flotsam... | `def.value` (RMG value) |
| artifacts / scrolls | `def.value` (artifact 2000–20000) |
| mines (neutral / enemy) | daily output × resource value × 12 (+50 % enemy-owned); guards/garrison fought |
| external dwellings | `def.value` + stock value when unflagged, stock value when ours and stocked |
| weekly / once objects | `def.value` when not visited (per the revisit rule) |
| boosts (primary, exp, skills, level, library, spells) | `def.value`, ×1.5 for the main hero, ×0.4 secondary |
| banks | reward value (resources, artifacts 4000 each, creatures, spell) — main hero only, needs a won battle |
| pandora's box | 5000 (guards judged when the confirm comes) |
| wandering monsters | main hero 700 + exp × 0.5 (others 200 + exp × 0.2; exp = total hp) + guarded objects × 0.8 + road value − losses; join offers: creature value + road; fleeing stacks (they vanish when approached): guarded objects + road value |
| enemy heroes | 4000 + 1500×level + army gold value — needs a won battle |
| enemy / neutral towns | `townValue`: 4000 + 10 × daily gold income + 1000 per dwelling, × 1.3 for another player's town (× 1.2 more for his last one), max 40000 — an empty village is worth little more than a treasure, a developed capital far more; needs a won siege (neutral `minRatio + 0.2`, players `attackRatio`) |
| far towns (main hero, once a day) | the 3 nearest beatable towns outside the reach table: path-found, value × 0.8 / (days + 0.35); without a free road the first monster guarding the straight route there (`routeGuard`, 8-way BFS) becomes a `gate` target worth 60 % of the town when it is in reach and beatable |
| breakout (main hero, nothing else to do) | the beatable monster in reach with the smallest expected losses (300) |
| idle secondaries | second pass with fights at 2 : 1 (instead of 3 : 1); then `feed` (an own town whose garrison is worth ≥ 600 and that no enemy is near: take it to the main hero, a `meet` follows), then the last unexplored corners (≥ 2 tiles), then `guard` |
| `guard` (anyone with nothing else to do) | an own town with an enemy hero about two days away: walk in and stand guard from the garrison row (the visiting slot stays free; the main hero takes the guard's troops, keeping one stack) |
| own town (main hero) | garrison + affordable stock value (×0.9), when ≥ 1500 |
| own town, threatened (`defend`) | 15000 when the hero + town can hold it and the hero gets there within 1.5 days |
| own town, hero in danger (`retreat`) | 10000 when the town + hero can resist ≥ 60 % of the danger |
| main hero (meeting, secondaries) | troops carried, when worth ≥ 15 % of the main army |
| exploration | 25 per unexplored tile within sight of a tile reachable today / tomorrow (anywhere in the reach table when nothing is left nearby) |

Secondary heroes only take collector targets (no banks, sieges or hero attacks unless clearly
won; monsters only at ratio ≥ 3). Attacks on other players (towns, heroes) start on day
`attackFromDay`; before that only targets within today's reach are taken (no early rushes).
Main hero: kept unless another hero standing in a town (he just took a garrison) is more than twice
as strong. A secondary hero visiting a town whose garrison is stronger than the main hero takes the
garrison over (and so becomes the main hero). Neither the main hero nor a secondary empties a garrison
while an enemy hero (strength ≥ 1000) stands within about two days of the town (`enemyNear`).

## Town planner (`town.js` of the AI)

Goal list per town (faction dwellings named `<faction>_dwelling_<tier>[_up]`): Town Hall, tier 1,
Fort, tiers 2–3, Citadel, tier 4, City Hall, tier 5, Castle, tier 6, Mage Guild 2 (magic main
hero), tier 7, Capitol, upgrades 7→1, Mage Guild 3, hordes, Resource Silo, Mage Guild 4/5, the
rest. The Grail building is always tried first. For the first goal not yet built, the first
missing prerequisite is resolved recursively; when it is not affordable, the marketplace is used
to cover the deficit from surplus resources (difficulty ≥ 1), otherwise the planner looks at most
three goals further and then saves. Without any hero a building must leave 2500 gold (hire). Unavailable goals (`not_available`, `no_water`,
`capitol_exists`) are skipped. Easy AI (0) swaps a few goals at random.

Market: trades are planned first (rates of `getMarketRate`, surplus of the other resources,
largest surplus value first) and executed only when they cover the whole deficit.

Recruitment: strongest tiers first, as many as affordable minus a **reserve** (all towns together):
the gold of every town's next planned building whose other resources are at hand (or market-coverable)
and whose missing gold is within `econDays` of income for a Town Hall / City Hall / Capitol, `saveDays`
for anything else (none for a threatened town; 2500 when the player has no hero). A fallback goal
(the first one is not affordable yet) is only built when it leaves the gold saved for the first one.
Before, the AI spent its whole daily income on troops and never reached a City Hall / Capitol.
Upgrades when the price ≤ 25 % of the gold. Heroes: hire up to a cap (map width ≤ 36: 3, ≤ 72: 4,
≤ 108: 5, else 6; −1 on Easy, +1 on Expert+) when gold ≥ 2500 + 500 for the second hero, + `hireSpare`
for more (2500 without any hero); at most one hire per day (`player.ai.day.hired`); the best tavern offer
by level (might class preferred).

## Defence

A town is threatened when an enemy hero stronger than 90 % of its defence can reach it within 1.5
days of full movement **by path** (`findPath` of the enemy hero, cached per turn; 0.75 days when the
enemy sits in his own town). Then: no gold reserve, everything is recruited into the garrison before
building, heroes that can make the difference get a `defend` target, and a hero inside holds the town
(see above) — for at most `holdDays` days in a row: an attacker who keeps standing off is deterred, and
two AIs used to sit in their garrisons facing each other for the rest of the game.

## Adventure spells

- Town Portal: when the chosen target is an own town ≥ 1 day away (or `defend`), cast it first.
- Fly / Water Walk: cast at the start of the hero's turn when known and mana ≥ 2 × cost.
- Dimension Door: objects that are unreachable or ≥ 1 day away but within the spell's range (+1)
  are considered with `days = (moveCost + 100) / maxMove`; the hero teleports to the free,
  unguarded land tile next to the object closest to him, then walks the last step. Needs mana,
  uses left today and `moveCost + 200` movement.
- Summon Boat, Scuttle Boat, Visions, View Earth/Air, Disguise are not used.

## Artifacts (`artifacts.js` of the AI)

At the start of the turn and after every move that left something in the backpack: backpack items
(best first, value = gold cost, scroll 500, +5000 when the hero owns all components of a combo
containing it) go into a free slot, or replace the weakest unlocked occupant of their slot when
worth more (the occupant goes to the backpack; never combos / `noBackpack` items); then every
assemblable combo is assembled (two passes). On a meeting the secondary hero hands every
transferable artifact (equipped and backpack) to the main hero, who then sorts them. Artifacts
(≥ 1500 value) alone justify a `meet` target (value × 0.5).

## Town purchases

- Spellbook: main hero always (gold ≥ 3000 + reserve), magic heroes at ≥ 5500 + reserve, others
  at ≥ 12500 + reserve.
- War machines (blacksmith) for the main hero after recruiting, from spare gold (reserve + price +
  3000): ballista, first aid tent, ammo cart, cannon.
- Grail structure: built as soon as a hero carrying the Grail stands in an own town.

## Boats

On a water map (> 15 % water tiles) coastal towns get a Shipyard after the tier 3 dwelling. A hero
that has nothing to do (no target, or only weak exploration) and no free own/neutral boat within
12 tiles builds a boat in an own shipyard town within 10 tiles (once per turn; gold ≥ 2500, wood
≥ 10). The path-finder then boards / lands by itself (boats count as normal path steps), so the
usual target selection carries the hero across. Flagged shipyard objects answer `build_boat` with
yes on water maps when no free boat exists and the price is ≤ 40 % of the stock.

## Grail

Obelisks are targets (1500, per player). When the puzzle is complete (`getPuzzleProgress(...).grailPos`)
the spot is a `dig` target (25000); a hero standing on it digs as soon as he has his full daily
movement (else he waits there). A hero carrying the Grail gets `grail_home` targets (40000) for
own towns of factions with a grail building not built yet. Partial puzzles are not guessed.

## Seer huts and quest guards

Seer huts: completed / expired / quest-less ones are ignored; an unvisited hut is worth 300 (learn
the quest); when `questFulfilled` holds for this hero the value is the reward value minus what the
quest takes (resources, creatures, 3000 per artifact). Quest guards are worth 1500 minus the price
when fulfilled. Monsters named by a known `kill_monster` quest get the hut's reward (×0.8, 1000 for
quest guards) on top of their value. `confirm_quest` is always accepted.

## Garrison swaps

A hero holding a threatened town (see Defence) takes the garrison troops and moves into the
garrison row (`swapTownHeroes`), so he fights behind the walls with everything. Threats are judged
against the defence *without* own heroes. At the start of a turn a garrison hero of a town that is
no longer threatened is swapped out again (a visiting hero, if any, swaps in).

## Difficulty

| knob | Easy | Normal | Hard | Expert | Impossible |
|---|---|---|---|---|---|
| `minRatio` (neutral fights) | 1.2 + noise 0.5 | 1.15 + noise 0.2 | 1.15 | 1.15 | 1.15 |
| simulations per turn | – | 2 | 3 | 4 | 5 |
| `attackRatio` (players' heroes / towns) | 2.0 | 1.35 | 1.3 | 1.2 | 1.1 |
| `attackFromDay` (campaigns against players) | 22 | 8 | 4 | 1 | 1 |
| `knowTowns` | no (explored only) | yes | yes | yes | yes |
| `holdDays` (garrison holding) | 6 | 3 | 2 | 2 | 2 |
| `econDays` / `saveDays` (gold reserve) | 6 / 3 | 10 / 5 | 12 / 6 | 12 / 6 | 12 / 6 |
| hero cap delta / `hireSpare` | −1 / 3000 | 0 / 1500 | 0 / 1000 | +1 / 1000 | +1 / 1000 |
| same-day attacks on players before `attackFromDay` | no | yes | yes | yes | yes |
| market, adventure spells | no | yes | yes | yes | yes |

Resources: the original gives the computer the same income at every level (economy.js
`aiIncomePercent` = 100); only the starting resources differ (economy.js `DIFFICULTIES`).

## Benchmark (`tests/ai/bench.js`, `tests/ai/progress.test.js`)

`runBenchGame({size, template, players, seed, difficulty, days, difficulties?})` plays an all-AI game
on a generated map and records weekly per-player metrics: towns, heroes, army strength (heroes +
garrisons), buildings (upgrades count their bases), mines, gold, and cumulative report counters
(attacks, neutral sieges, idle hero-days, battles, lost battles, timeouts, first attack day).
`node tools/ai-bench.mjs [difficulty] [days] [games]` prints the same metrics for 12 games (worker
threads, ~15 s). `progress.test.js` runs 6 small maps at Normal in worker threads (~6 s) and asserts medians: day 28 —
buildings ≥ 15, mines ≥ 4, heroes ≥ 2; day 56 — buildings ≥ 20, mines ≥ 4, towns ≥ 1.5, army ≥ 2.5×
day 28; an attack on another player in ≥ 2/3 of the games; ≤ 10 % lost battles.

24 seeded S/M games (6 templates, 2–3 players, 56 days; 22 generate), medians of the surviving players:

| Normal | before | after |
|---|---|---|
| buildings d28 / d56 | 12 / 13.5 | 17 / 23 |
| mines d28 / d56 | 3.5 / 3.5 | 4 / 6 |
| heroes d28 / d56 | 1 / 2 | 3 / 3 |
| army strength d28 / d56 | 30k / 77k | 20k / 91k |
| gold held d28 / d56 | 1130 / 2000 | 4000 / 5040 |
| games with an attack on a player by d28 / d56 | 5 / 7 of 22 | 13 / 17 of 22 |
| battles lost (all players) d28 / d56 | 55 of 284 / 84 of 348 | 6 of 319 / 10 of 415 |
| players eliminated by d28 / d56 | 2 / 4 of 48 | 11 / 15 of 48 |

By level (same set; the game difficulty also scales neutrals and starting resources): first attack
on a player (median over players) Easy day 49.5, Normal 41.5, Hard 21, Expert 19.5, Impossible 19.5;
games with an attack by day 28: 8 / 13 / 18 / 19 / 18 of 22. Mixed duels (12 maps × both sides, same
game difficulty, `player.aiDifficulty` differs): Normal beats Easy 6 : 2, Hard beats Normal 7 : 4,
Impossible beats Easy 9 : 3, Impossible – Hard 4 : 4 (the rest undecided after 56 days).

Round cap and idle heroes (same set, Normal, 56 days): battles at the combat round cap 8 → 0 (the
combat AI no longer kites, combat.md §10b); idle hero-days (no target at the start of the day, all
players) 1130 → 557 (secondaries 816 → 393) with feed / guard / 2 : 1 tasks. The main hero may take a
garrison despite a nearby enemy when the result beats that enemy (`attackRatio`).

## Measurements (Node 20, this machine, all-AI duels on handmade maps, difficulty 2)

- planning itself: 5–50 ms per turn (`getReachable` with 3 extra days ≈ 11 ms on 72×72).
- 36×36, 60 days: average AI turn ≈ 40–50 ms; 72×72: ≈ 115 ms, max ≈ 370 ms. The maxima are
  dominated by the combat engine (one real quick combat 50–250 ms, simulations as above).

## Not implemented / known limits

- Quests that need planning (fetch a specific artifact / creature / kill a hero) are only done
  when they happen to be fulfilled; partial grail puzzles are not guessed; artifact values are
  plain gold costs (no per-hero bonus evaluation, cursed items are not recognised).
- Fog: objects are only targeted when explored; enemy heroes are judged on explored tiles
  (slightly optimistic knowledge, no `getDisplayedArmy` disguise handling).
- No multi-hero coordination beyond "secondaries feed the main hero"; no chain hand-overs.
- Battle estimates ignore terrain, morale/luck, spells of the enemy (except via simulations).

## Checklist (tests: `tests/ai/ai.test.js`)

- [x] collects resource piles and flags a mine
- [x] builds every day and recruits over a week
- [x] fights a weak monster, leaves an overwhelming one alone
- [x] declines a bank with far too strong guards
- [x] resolves level-ups with sensible skills
- [x] main hero takes the garrison and recruits in town
- [x] hires a hero when it has none
- [x] threatened town recruits everything into the garrison
- [x] secondary hero hands its troops to the main hero
- [x] never throws (unknown pendings, no movement, empty player)
- [x] two AI players, 60 days: no exceptions, plain JSON, armies grow, somebody gets ahead
- [x] deterministic by seed
- [x] every difficulty level plays
- [x] timing budget on 72×72
- [x] `tests/ai/resume.test.js`: a turn interrupted by a battle against a human is resumed after it
      (rest of the day played, one hire a day, JSON-serializable and deterministic across save/load,
      at most `MAX_AI_RESUMES` resumptions)
- [x] `tests/ai/progress.test.js`: progress milestones at Normal (see Benchmark)
- [x] `tests/ai/extras.test.js`: better item equipped, combo assembled, artifacts handed to the
      main hero, war machine + spellbook bought, boat built to reach an island, Dimension Door over
      water, obelisk → dig → grail structure, seer hut quest completed, garrison swap and release
