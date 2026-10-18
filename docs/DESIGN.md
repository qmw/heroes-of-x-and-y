# H3online — Design & Contracts

A browser remake of the mechanics of *Heroes of Might and Magic III* (Complete + HotA-style extras),
with graphics from the **Duelyst art release (CC0-1.0**, github.com/open-duelyst/duelyst — see
`assets/duelyst/LICENSE-NOTE.md`, `docs/mechanics/duelyst-assets.md`) layered over **original procedurally
generated graphics** (`src/gfx`, used for everything Duelyst has no art for), plus a few small CC0 / CC-BY
**asset packs** that fill specific gaps (map terrain textures, extra artifact / resource icons, war machines,
the defeat jingle) — `assets/CREDITS.md`, `docs/mechanics/asset-packs.md`. No other third-party assets.
Goal: every mechanic of the original implemented **and unit-tested**, with content at least as rich
as the original (11 towns instead of 9, extra neutrals, artifacts, spells, map objects).

This document is the **contract between modules**. If you need to deviate, update this file's
relevant section (small, surgical edit) and say so in your final report.

## 1. Stack & rules

- Plain **ES modules**, no build step, **zero runtime dependencies**. Runs from `index.html` via
  `npm start` (static server on :8080). Node >= 20.
- Tests: `node --test tests/` (built-in `node:test` + `node:assert/strict`). Test files:
  `tests/<area>/*.test.js`. Every mechanic gets a test. Tests must be deterministic (seeded RNG).
- **Engine and data never touch the DOM** (`src/core`, `src/data`, `src/engine` must import cleanly
  in Node). Only `src/ui` and `src/gfx` use browser APIs.
- **All randomness** goes through `src/core/rng.js` with an rng object stored in state.
- **State is plain JSON** (no classes, Maps, Sets, functions, cycles) so save/load is
  `JSON.stringify`. Reference other entities by id.
- Ids are `snake_case` strings (`pikeman`, `arch_angel`, `magic_arrow`). Display names in `name`.
- Shared constants live in `src/core/constants.js` — import, don't redeclare.
- Numbers (stats, costs, formulas) follow the original game (SoD/HotA values) as faithfully as you
  can recall. Where unsure, pick a sensible value and note it in your mechanics doc.
- Each area documents its mechanics in `docs/mechanics/<area>.md` **before/alongside implementing**:
  the rules, formulas, and a checklist `- [x] mechanic — test file` of what is implemented & tested.
- File ownership: only edit files your task assigns. To change someone else's file, make a minimal
  `Edit` (never rewrite whole files you don't own) and mention it in your report.
- Code style: small pure functions, JSDoc typedefs for shapes, no clever metaprogramming.

## 2. Layout

```
index.html, package.json, tools/serve.mjs
docs/DESIGN.md, docs/mechanics/*.md
src/core/        rng.js, constants.js, (util.js)
src/data/        creatures.js abilities.js factions.js buildings.js heroes.js heroClasses.js
                 skills.js spells.js artifacts.js terrain.js mapObjects.js
src/engine/      bonuses.js hero.js army.js artifacts.js town.js economy.js game.js
                 combat/*  adventure/*  mapgen/*  ai/*  editor/* (map editor, docs/mechanics/editor.md)
src/gfx/         procedural sprites (canvas); art layers src/gfx/duelyst/, src/gfx/packs/
src/ui/          screens, widgets, style.css
src/main.js      browser entry
tests/<area>/*.test.js
```

Every data module exports an **array** and a **by-id lookup**, e.g.
`export const CREATURES = [...]; export const CREATURE_BY_ID = Object.fromEntries(...)`
plus a getter that throws on unknown id (`getCreature(id)`).

## 3. Data schemas

### Resources
`Resources = { gold, wood, ore, mercury, sulfur, crystal, gems }` — costs may omit zero entries.

### Creature (`src/data/creatures.js`)
```js
{ id, name, faction,            // faction id or 'neutral'
  tier,                         // 1..7 (8 = special/above-7 e.g. azure dragon)
  upgraded: false, upgradeOf: null, upgradesTo: 'halberdier',
  attack, defense, minDamage, maxDamage, hp, speed,
  growth,                       // base weekly growth
  aiValue, fightValue,
  cost: { gold: 60 },
  shots: 0,                     // >0 => shooter
  size: 1,                      // 1 or 2 hexes wide
  flying: false,
  abilities: [ { id: 'charge_immunity' }, { id: 'hates', targets: ['devil'], percent: 50 } ],
  warMachine: false,
  shape: 'humanoid' }           // hint for procedural gfx: humanoid|beast|dragon|flyer|undead|
                                //   elemental|construct|serpent|insect|plant|machine|giant|caster|rider
```
Ability ids are declared in `src/data/abilities.js` as a registry
`ABILITIES = { [id]: { name, description, params: [...] } }`. Creatures may only use registered ids.

### Faction / town type (`src/data/factions.js`)
`{ id, name, alignment: 'good'|'evil'|'neutral', nativeTerrain, heroClasses: [mightId, magicId],
   creatures: [[base, upgraded] x7], townNames: [...], color }`

### Building (`src/data/buildings.js`)
```js
{ id, faction: 'castle' | 'common', name, description,
  cost: Resources, requires: [buildingId...], replaces: buildingId|null,   // upgrades replace
  kind: 'hall'|'fort'|'dwelling'|'mage_guild'|'market'|'tavern'|'blacksmith'|'horde'|'special'|'grail'|'shipyard'|'silo',
  dwelling?: { creatureId, tier, upgraded },
  effects: [Bonus|Effect...] }
```
Town-level ids are namespaced when faction specific (`castle_stables`), common ones plain
(`village_hall`, `town_hall`, `city_hall`, `capitol`, `fort`, `citadel`, `castle`, `tavern`,
`blacksmith`, `marketplace`, `resource_silo`, `mage_guild_1..5`, `shipyard`).
Dwellings: `<faction>_dwelling_<tier>` and `<faction>_dwelling_<tier>_up`.

### Hero class / hero (`src/data/heroClasses.js`, `src/data/heroes.js`)
```js
HeroClass = { id, name, faction, kind: 'might'|'magic',
  startPrimary: {attack, defense, power, knowledge},
  primaryChancesLow:  {attack, defense, power, knowledge},  // % per level 2-9
  primaryChancesHigh: {attack, defense, power, knowledge},  // % per level 10+
  skillWeights: { [skillId]: weight } }                     // chance to be offered each secondary skill
HeroDef = { id, name, classId, gender, specialty: { type, ...params, description },
  startSkills: [{id, level}], startSpell: spellId|null, startArmy: [{creatureId, min, max} x2-3],
  faction, biography, special /* campaign-only */, startWarMachine: artifactId|null }
```

### Secondary skill (`src/data/skills.js`)
`{ id, name, description, levels: [ {description, effects:[Bonus...]} x3 ] }` (index 0 = Basic).

### Spell (`src/data/spells.js`)
```js
{ id, name, school: 'air'|'earth'|'fire'|'water'|'all', level: 1..5,
  cost, // mana without school mastery; costByMastery: [..4] is the cost per mastery
  kind: 'combat'|'adventure',
  target: 'none'|'enemy_stack'|'friendly_stack'|'any_stack'|'hex'|'area'|'all_enemies'|'all_friendly'|'all'|'obstacle'|'dead_friendly_stack',
  category: 'damage'|'buff'|'debuff'|'heal'|'summon'|'control'|'utility'|'adventure',
  // numeric parameters per mastery [none, basic, advanced, expert]:
  power: [..4],        // base effect value (flat damage / stat delta / percent ...)
  perPower: 10,        // multiplied by hero spell power and added (damage/heal spells)
  duration: 'power'|'battle'|'day'|number|null,   // rounds; 'power' => rounds = hero spell power
  massAt: 3|null,      // mastery level at which it becomes mass (affects all valid targets)
  area: null|{shape:'radius'|'ring', r:[..4]}|{shape:'chain', targets:[..4], factor}|{shape:'line', length:[..4]},
  effect: { ... },     // structured description of what it does (see docs/mechanics/spells.md)
  immune: [...],       // tags of creatures that are immune (e.g. 'undead','non_living','mind_immune')
  description: [..4], aiValue,
  // also: costByMastery, targetByMastery, target2, alignment, durationByMastery, vulnerable, requires,
  // resistible, dispellable, guild, triggerChance, extra, creatureOnly, special — docs/mechanics/spells.md §1
}
```

### Artifact (`src/data/artifacts.js`)
```js
{ id, name, slot /* ARTIFACT_SLOTS */, class: 'treasure'|'minor'|'major'|'relic'|'combo'|'special',
  cost /* gold value */, bonuses: [Bonus...], description,
  components?: [artifactId...] }   // combination artifacts
```

### Terrain / map objects (`src/data/terrain.js`, `src/data/mapObjects.js`)
```js
Terrain = { id, name, moveCost /* base 100 = 1 tile */, passable, water, color, nativeFactions:[...] }
MapObjectDef = { id, name, category: 'resource'|'mine'|'dwelling'|'visit_once'|'visit_weekly'|
    'visit_per_hero'|'visit_per_player'|'bank'|'transport'|'treasure'|'decor'|'guard'|'town'|'special',
  blocking: true, visitable: true, removable: false,   // removable = disappears after pickup
  size: [w, h], effect: { type, ...params }, description, value /* for map generator & AI */ }
```
Extra MapObjectDef fields (`revisit`, `interact`, `terrains`, `frequency`, `shape`, `color`, `extra`),
the closed effect-type set, the footprint/entrance convention (`obj.pos` = entrance tile) and the
optional tile field `overlay` (magic terrain id) are specified in `docs/mechanics/adventure-objects.md`.

### Bonus (shared modifier vocabulary)
A `Bonus` is `{ type, value?, ...params }`. One aggregator (`src/engine/bonuses.js`) collects
bonuses from secondary skills, artifacts, specialty, town buildings, temporary map-object effects.
Core types (extend when needed — and document every new type in your `docs/mechanics/<area>.md`
under a **"Bonus types"** heading so the aggregator author can implement it):

| type | params | meaning |
|---|---|---|
| `primary` | `stat`, `value` | +attack/defense/power/knowledge |
| `morale` / `luck` | `value` | hero's army morale / luck |
| `enemy_morale` / `enemy_luck` | `value` | applied to the opponent in combat |
| `movement_land` / `movement_sea` | `value` or `percent` | movement points |
| `terrain_penalty_reduction` | `percent` | Pathfinding |
| `sight_radius` | `value` | Scouting etc. |
| `mana_regen` | `value` | per day |
| `mana_max_percent` | `percent` | Intelligence |
| `spell_power_percent` | `school?`, `spellId?`, `percent` | damage/effect multiplier |
| `spell_duration` | `value` | extra rounds |
| `spell_school_mastery` | `school`, `level` | Air/Earth/Fire/Water Magic |
| `spell_cost` | `school?`, `value` | mana cost delta |
| `learn_spell_level` | `level` | Wisdom |
| `grants_spell` | `spellId` | tomes, hats, scroll |
| `resource_income` | `resource`, `value` | per day |
| `creature_growth` | `creatureId?`, `tier?`, `value?`, `percent?` | weekly growth |
| `creature_stat` | `filter?` (`{creatureId|tier|faction|shooter|...}`), `stat` (`attack|defense|speed|hp|damage`), `value` or `percent` | combat stat of army stacks |
| `damage_percent` | `mode: 'melee'|'ranged'`, `percent` | Offense / Archery |
| `damage_reduction_percent` | `percent` | Armorer |
| `magic_resistance` | `percent` | Resistance |
| `spell_immunity` | `spellId?`, `school?`, `maxLevel?`, `side: 'own'|'both'` | orbs, pendants, cloaks |
| `experience_percent` | `percent` | Learning |
| `necromancy_percent` | `percent` | Necromancy |
| `skill_percent` | `skillId`, `percent` | boosts a secondary skill's effect (specialties, artifacts) |
| `diplomacy`, `estates`, `eagle_eye`, `first_aid`, `ballistics`, `artillery`, `tactics`, `navigation`, `logistics`, `mysticism`, `scholar`, `leadership`, `luck_skill`, `sorcery`, `learning`, `interference` | per-skill params | prefer the generic types above when they fit |

`Effect` (for map objects / buildings that *do* something on visit) is `{ type, ...params }` and is
documented by the data author in their mechanics doc; the engine author implements each type.

## 4. Runtime state (`src/engine/game.js`)

```js
GameState = {
  version: 1, rng: {s}, turn /* absolute day, 1-based */,
  date: { day /*1-7*/, week /*1-4*/, month /*1+*/ }, weekOf: { creatureId|null, kind },
  currentPlayer /* index into players */, 
  players: [ Player ], heroes: { [id]: Hero }, towns: { [id]: Town },
  map: GameMap, combat: null | CombatState,
  pending: [ PendingChoice ],          // decisions awaiting the current player (see below)
  settings: { difficulty, victory, loss, ... }, log: [ ... ], winner: null }

Player = { id /*0..7*/, color, name, isHuman, faction, alive: true, resources: Resources,
  heroes: [heroId], towns: [townId], explored: [ /* per level */ string|number[] ],
  tavernHeroes: [heroDefId, heroDefId], daysWithoutTown: 0, ai: {...}, visited: {...} }

Hero = { id, defId, name, classId, owner, pos: {x, y, z},
  primary: {attack, defense, power, knowledge},      // base values (without bonuses)
  level, exp, mana, movePoints, maxMovePoints,
  skills: [ {id, level /*1-3*/} ],                   // max 8
  spells: [spellId], 
  artifacts: { equipped: { head:[id|null], ring:[id|null,id|null], misc:[...5], ... }, backpack: [artifactId] },
  army: [ {creatureId, count} | null  x7 ],
  temp: [ {source, bonus: Bonus, until: 'next_battle'|'end_of_day'|'end_of_week'|turnNumber} ],
  visited: { [objectId]: true|weekNumber }, inBoat: false, townId: null, garrisoned: false, asleep: false,
  skillCounters: { wisdom, school } }               // level-ups since last offered (see mechanics/heroes.md)

Town = { id, name, faction, owner /* player id | null */, pos: {x, y, z},
  buildings: [buildingId], builtThisTurn: false,
  garrison: Army(7), visitingHero: heroId|null, garrisonHero: heroId|null,
  stock: { [creatureId]: count },                    // creatures available to recruit
  mageGuild: [ [spellId...] x5 ], spellResearch... }

GameMap = { width, height, levels /*1|2*/,
  tiles: [ /*z*/ [ /*y*/ [ /*x*/ { t: terrainId, road: 0|1|2|3, river: 0|1, obj: objectId|null, blocked: bool } ] ] ],
  objects: { [id]: { id, defId, pos:{x,y,z}, owner?, data:{...} } } }   // towns & heroes are referenced from data
```

### Engine call convention
Engine functions are `fn(state, ...args) -> Result` and **mutate `state`**:
`Result = { ok: true, events: [ {type, ...} ] } | { ok: false, error: 'reason' }`.
`events` describe what happened (for UI animation/log). Never throw for illegal player actions —
return `ok:false`. Throw only on programmer errors (unknown ids).

### Pending choices
When an action needs player input (level-up skill choice, treasure chest gold-vs-exp, creature join
offer, artifact purchase…), the engine pushes `{ id, playerId, kind, heroId?, options: [...], data }`
onto `state.pending` and the action that caused it returns normally. `resolvePending(state, id,
optionIndex)` (in `game.js`) applies it. While `state.pending` is non-empty for the current player
no other action is accepted. AI resolves automatically; tests can too.

## 5. Combat contract (`src/engine/combat/`)

Combat is **self-contained**: it does not read `GameState`. Adapters in `src/engine/hero.js`
build the input and apply the outcome.

```js
CombatInput = { seed, terrain, 
  attacker: CombatSide, defender: CombatSide,
  siege: null | { fortLevel: 1|2|3, faction, buildings:[...] },
  bank: false,               // creature-bank layout (defender surrounds attacker... simplified)
  obstacles: 'random'|[...] }
CombatSide = { playerId, isHuman,
  hero: null | { id, name, attack, defense, power, knowledge, mana, spells:[...],
                 skills: { [skillId]: level }, specialty, bonuses: [Bonus...] /* already aggregated */ },
  army: [ {creatureId, count} | null x7 ],
  warMachines: ['ballista','ammo_cart','first_aid_tent'] /* catapult is automatic in sieges */ }

CombatResult = { winner: 'attacker'|'defender'|'draw', rounds,
  attacker: { army: [...survivors x7], losses: {creatureId: n}, manaLeft, heroFled, heroSurrendered, warMachinesLost:[...] },
  defender: { ...same },
  expAttacker, expDefender, raised: null|{creatureId,count} /* necromancy */, capturedArtifacts: bool }
```
API (all in `src/engine/combat/index.js`):
`createCombat(input) -> CombatState` (plain JSON), `getActiveStack(cs)`,
`getLegalActions(cs) -> { moves:[hex], attacks:[{targetId, fromHexes:[...]}], shots:[targetId], canWait, canDefend, canCast, spells:[...] , canRetreat, canSurrender }`,
`performAction(cs, action) -> Result` where action is one of
`{type:'move',to}|{type:'attack',targetId,from}|{type:'shoot',targetId}|{type:'wait'}|{type:'defend'}|{type:'cast',spellId,target}|{type:'retreat'}|{type:'surrender'}|{type:'auto'}`,
`isOver(cs)`, `getResult(cs)`; additions (docs/mechanics/combat.md): actions `{type:'ability',ability,targetId}` (creature casters), `{type:'heal',targetId}` (controlled tent), `{type:'siege_attack',targetId}`, `{type:'tactics_move',stackId,to}`/`{type:'tactics_end'}`; `autoResolve(cs)`, `getStackInfo`, `getAttackPreview`, `describeTurnOrder`; `cs.startEvents` holds the events of `createCombat`. Hexes are `{x: 0..14, y: 0..10}` offset coordinates (odd rows
shifted right); attacker starts on the left.

## 6. UI contract (`src/ui`, `src/gfx`)

- `src/gfx/index.js`: `getSprite(kind, id, opts?) -> HTMLCanvasElement` (cached) and
  `drawSprite(ctx2d, kind, id, x, y, opts)`, where `kind` is `creature|hero|portrait|terrain|object|
  building|artifact|spell|resource|skill|town|ui|obstacle|effect`. Art layers first (Duelyst, asset packs;
  priority per kind in `docs/mechanics/asset-packs.md`), else procedural drawing from data
  hints (faction color, `shape`, tier, flags). `opts = { size, frame, facing, playerColor, variant, state }`. Full API, ids, `size` semantics and anchors: `docs/mechanics/gfx.md`.
  The UI never imports gfx directly: it uses `src/ui/sprites.js` (fresh canvas copies, placeholder fallback).
- `src/ui/app.js` owns the screen router: `showScreen(name, params)`; screens are modules exporting
  `{ mount(rootEl, ctx, params), unmount() }`, registered lazily (`registerScreen(name, () => import(...))`).
  `ctx = { state, setState, notify, onState, act, resolvePendings, sprite, drawSprite, gfx, ui /* kit */,
  showScreen, back, save(slot), load(slot), autosave, storage, settings, audio, engine /* lazy modules */,
  keys, anim, log, toast, showError }` - full reference, kit API and screen template in `docs/mechanics/ui.md`.
- Screens: main menu, new-game setup, adventure map, town, hero, combat, kingdom overview,
  marketplace/trade dialogs, spellbook, save/load, help/encyclopedia.
- Look: dark parchment/gold fantasy UI, readable, mouse-driven with keyboard shortcuts.

## 7. Game features checklist (owner fills in)

Hotseat multiplayer (2-8 players, human or AI), difficulty levels, random map generator with
templates/sizes + underground, handcrafted scenarios, save/load (localStorage + file export),
adventure AI and combat AI, quick combat, full siege combat, all adventure & combat spells,
victory/loss conditions, week/month events, grail/obelisk puzzle, creature banks, boats,
subterranean gates, monoliths, artifacts incl. combination sets, tavern, thieves' guild.

## 8. Engine module APIs (phase 2 — modules are written in parallel against these signatures)

Signatures below are the **cross-module contract**. Owners may add helpers freely, but must keep
these names/semantics (or edit this section and report it). All take the `GameState` first and
follow the `Result` convention unless they are obvious pure getters.

Shared infra already written: `src/engine/pending.js` (`pushPending`, `resolvePending`,
`registerPendingHandler(kind, fn)`, `getPending`, `hasPending`), `src/engine/artifacts.js`,
`src/engine/leveling.js`, `src/core/rng.js`. `state.rng` is the game rng; `state.nextId` is a
counter for generating entity ids (`'h' + n`, `'t' + n`, `'o' + n`).

### `src/engine/bonuses.js`, `army.js`, `hero.js` (owner: hero agent)
- bonuses: `getHeroBonuses(state, hero) -> Bonus[]` (skills + artifacts + specialty + `hero.temp`
  + owner-wide town-building `player_hero_bonus`), `sumBonus(bonuses, type, match?) -> number`,
  `getPrimary(state, hero)`, `getSkillLevel(hero, skillId) -> 0..3`, `getMaxMana(state, hero)`,
  `getManaRegen`, `getSightRadius`, `getMaxMovePoints(state, hero) `, `getArmyMorale(state, {hero?, army, townId?, terrain?})`,
  `getArmyLuck(...)`, `getNecromancyInfo(state, hero)`.
- army (pure, on `Army = [slot|null x7]`): `createArmy()`, `armyAdd(army, creatureId, count) -> bool`,
  `armyCanAdd`, `armyRemove(army, slotIdx, count?)`, `armyMove(armyA, i, armyB, j, count?)` (move/merge/swap/split),
  `armyStrength(army)` (sum aiValue×count), `armyIsEmpty`, `armyTotalCount`, `armySlowestSpeed`, `armyCreatureIds`.
- hero: `addHero(state, defId, playerId, pos, opts?) -> Hero`, `removeHero(state, heroId, reason)`,
  `giveExperience(state, heroId, amount) -> Result` (applies Learning; pushes `level_up` pendings),
  `canLearnSpell(state, hero, spellId)`, `learnSpell(state, heroId, spellId)`, `getHeroSpells(state, hero)` (incl. artifact-granted),
  `addTempBonus(state, heroId, source, bonus, until)`, `startOfDayHero(state, heroId)` (move points, mana regen, temp expiry),
  `tradeArmy(state, heroA, i, heroB, j, count?)`, `tradeArtifact(...)`, `meetHeroes(state, heroAId, heroBId)` (Scholar),
  `dismissHero(state, heroId)`,
  **combat adapters**: `buildCombatSide(state, {heroId} | {army, playerId, townId?})`,
  `startCombat(state, {attackerHeroId, defender: {heroId}|{army}|{townId}, terrain?, bank?, context: {kind, ...}}) -> Result`
  (creates `state.combat = { cs: CombatState, context, attackerHeroId, defenderHeroId, townId }`),
  `finishCombat(state) -> Result` (requires `isOver`; applies casualties, experience, necromancy, eagle eye,
  artifact capture, retreat/surrender → hero back to tavern pool, hero removal; then calls the handler
  registered with `registerCombatOutcome(kind, fn(state, context, result))`; clears `state.combat`),
  `quickCombat(state, opts) -> Result` (start + auto-resolve + finish).
- hero-block additions (details: `docs/mechanics/hero-engine.md`): `state.heroPool = { [defId]: Hero }` holds heroes
  that retreated/surrendered (their def id is put in `player.tavernHeroes[1]`; `addHero` re-uses the record) or
  were defeated (level/skills/spells kept, no army; any tavern may offer them again);
  player actions `dismissStack`, `moveHeroArtifact`, `setHeroAsleep`, `getSpecialtyUpgrades` / `specialtyUpgrade`;
  `startCombat` also takes `spellLevelCap`, `maxRounds` (default `COMBAT_MAX_ROUNDS` = 100) and refuses allied fights;
  `sumBonus` adds `value` (or `percent` when a bonus has no `value`) — `sumBonusValue` / `sumBonusPercent` for mixed types;
  `getArmyMorale/Luck` return numbers, `getArmyMoraleDetails/LuckDetails` the breakdown; `setCombatEngine(impl)` /
  `setTownModule(impl)` / `engineReady` are the seams to combat and town; `CombatSide` also carries
  `morale`, `luck` (base values: alignment mix + undead + hero/garrison bonuses, **without** creature auras and enemy
  effects), `stackMorale`, `stackLuck`, `bonuses`, `canRetreat`, `canSurrender`, `surrenderCost`, `gold`,
  `nativeTerrainAll`, `hero.level`, `hero.maxMana`, `hero.spellbook` (false: the hero cannot cast at all); `CombatInput` also `overlay`, `overlayEffects`; an optional
  `CombatResult.<side>.spellsCast: [spellId]` feeds Eagle Eye; the outcome handler's `result` is the CombatResult plus
  `{attackerHeroId, defenderHeroId, townId, defenderKind, winnerHeroId, loserHeroId, experience, raised, surrenderPaid,
  removedHeroes, fates}`.

### `src/engine/adventure/` (owner: adventure agent) — exported from `adventure/index.js`
- map: `createEmptyMap(width, height, levels, terrainId) -> GameMap`, `inBounds`, `getTile(map, pos)`,
  `addObject(state, defId, pos, params?) -> MapObject` (rolls instance data: bank level, monster count, shrine spell…;
  marks footprint tiles), `removeObject(state, objId)`, `getObjectAt(state, pos)`, `getHeroAt(state, pos)`, `getTownAt(state, pos)`.
- movement: `findPath(state, heroId, dest) -> { path:[pos], cost, turns } | null`, `getReachable(state, heroId)`,
  `moveHero(state, heroId, dest) -> Result` (walks step by step spending move points, reveals fog, stops when out of
  points or at an interaction; triggers visits / combats / pendings), `visitObject(state, heroId, objId)`.
- fog: `revealAround(state, playerId, pos, radius)`, `isExplored(state, playerId, pos)`, `isVisible(...)`.
- other: `castAdventureSpell(state, heroId, spellId, target?)`, `digForGrail(state, heroId)`,
  `startOfDayAdventure(state)`, `startOfWeekAdventure(state)` (object refills, monster growth, dwelling stock),
  `getMineIncome(state, playerId) -> Resources` (flagged mines & similar daily income objects).
- Town tiles: a town is a map object `{ defId: 'town', data: { townId } }`; entering it calls `visitTown` / starts a siege.
- Extras (see docs/mechanics/adventure-engine.md): `getFlaggedDwellings`, `hideAround`, `setupGrail`, `spawnMonthMonsters`,
  `getPuzzleProgress` (incl. the puzzle `area`), `evaluateMonster`, `getDisplayedArmy`, `getVisionsInfo`, `garrisonTransfer`,
  `debugRenderMap`, `alreadyVisited`, `fight` (a refused battle gives `combat_failed` and `moveHero` `ok:false`).
  `findPath` also returns `steps`; `turns` = extra days needed (0 = today).

### `src/engine/town.js`, `economy.js`, `game.js` (owner: game agent)
- economy: `canAfford(state, playerId, cost)`, `pay(state, playerId, cost) -> bool`, `addResources(state, playerId, res)`,
  `getDailyIncome(state, playerId) -> Resources`.
- town: `createTown(state, {faction, owner, pos, name?, buildings?}) -> Town`, `canBuild(state, townId, buildingId) -> {ok, error?}`,
  `build(state, townId, buildingId)`, `getAvailableBuildings(state, townId)`, `getTownGrowth(state, townId) -> {[creatureId]: n}`,
  `recruit(state, townId, creatureId, count, target /*'garrison'|'visiting'*/)`, `upgradeStack(state, {townId, where, slot})`,
  `buyWarMachine`, `buySpellbook`, `hireHero(state, townId, index)`, `marketTrade(state, playerId, give, get, amount, ctx)`,
  `visitTown(state, heroId, townId)` (enter: learn guild spells, visit bonuses, mana), `leaveTown`, `swapTownHeroes(state, townId)`,
  `townArmyMove(...)`, `captureTown(state, townId, playerId)`, `getSiegeInfo(state, townId)`, plus every special building action.
- game: `createGame(blueprint, settings) -> GameState`, `endTurn(state) -> Result` (next player; on wrap: new day →
  `startOfDayHero` for all heroes, `startOfDayAdventure`, town ticks, income; new week/month events), `getCurrentPlayer`,
  `checkVictory(state)`, `eliminatePlayer`, `serialize(state)`/`deserialize(json)`.
- Details, extra state fields (`state.gameOver`, `state.heroPool`, `town.portal`, `town.merchants`, ...), the
  full function list, events and the dependency seam (`gameDeps.js`): `docs/mechanics/game-loop.md`.
  Notes: `marketTrade`'s `amount` is the number of *lots* at `marketRate`; `endTurn` plays following AI players
  through `setAiDriver(fn)` / `runAiTurn` (and first the current AI player if he has not played yet);
  town actions require the town's owner to be the current player (`not_your_turn`); `player.team` = alliances; `captureTown` takes an optional 4th `{heroId, keepGarrison}`;
  income is paid from day 2 on; these modules raise no pending kinds of their own.
- `MapBlueprint = { map: GameMap, towns: [{ pos, faction | 'random', ownerSlot | null, name? }],
  heroes: [{ ownerSlot, pos, defId | 'random' }], meta: { name, description, playerSlots, size } }` — produced by the
  map generator / scenarios (phase 3), consumed by `createGame`, which creates Town/Hero entities and the `town` map objects.
  `settings = { seed, difficulty: 0..4, players: [{ slot, name, isHuman, faction | 'random', color }], victory, loss }`.
  Map generator (`src/engine/mapgen/index.js`, details in `docs/mechanics/mapgen.md`): `generateMap(options)`,
  `listTemplates()`, `listScenarios()`, `validateBlueprint(bp)`, `renderBlueprintAscii(bp)`. Blueprints may also carry
  `victory` / `loss` (scenarios; the caller copies them into `settings`) and `meta.{template, seed, width, height, levels,
  water, monsters, players, zones, links, stats}`; map objects in `map.objects` come with rolled instance data.
  Campaign mode (`src/engine/campaign/*`, `docs/mechanics/campaigns.md`): campaign definitions + handcrafted maps,
  `startCampaignScenario(progress, bonusIndex) -> {blueprint, settings, carry}`, `applyCarryOver(state, carry)`,
  `completeScenario(progress, state)`; campaign games carry `state.meta.campaign`.
