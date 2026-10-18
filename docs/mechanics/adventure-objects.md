# Adventure map: terrain and objects

Data: `src/data/terrain.js`, `src/data/mapObjects.js`. Tests: `tests/data/mapObjects.test.js`.
This file is the **exact spec** the adventure engine (`src/engine/adventure/*`) and the random map
generator (`src/engine/mapgen/*`) are written from. Numbers follow SoD/HotA; anything recalled
approximately or invented is listed under [Deviations and uncertain values](#deviations-and-uncertain-values).

Conventions used below:

- `hero` = the visiting hero, `player` = its owner, `obj` = the map object instance
  (`state.map.objects[id] = { id, defId, pos, owner?, data }`), `def = getMapObject(obj.defId)`,
  `fx = def.effect`.
- "roll" always means `src/core/rng.js` on `state.rng`.
- **Rolled at map start** means: when the map is created (generator or scenario load) the engine
  runs `initObject(state, obj)` once and stores the result in `obj.data`; visits never re-roll it.
- Ranges are `[min, max]` inclusive, optionally `[min, max, step]` (`[500, 1000, 100]` = 500, 600, ... 1000).
- A table is `[{ chance, ... }]` with `chance` in percent summing to 100; roll `1..100` and walk it.

## 1. Terrain

`TERRAIN_DATA` has one entry per id in `TERRAINS`:

| id | moveCost | native factions | notes |
|---|---|---|---|
| dirt | 100 | necropolis | |
| sand | 150 | - | |
| grass | 100 | castle, rampart | |
| snow | 150 | tower | |
| swamp | 175 | fortress, cove | |
| rough | 125 | stronghold | |
| subterranean | 100 | dungeon | underground level only |
| lava | 100 | inferno | surface or underground |
| highlands | 100 | conflux | |
| wasteland | 125 | factory | |
| water | 100 | - | `water: true`; boats only |
| rock | - | - | `passable: false`; fills unused underground |

Other fields: `colors` (`[base, light, dark, accent]`), `battlefield` (combat background id passed
as `CombatInput.terrain`), `obstacles` (battlefield obstacle kinds), `decor` (scenery shapes that
fit), `surface` / `underground` (where the generator may use it), `diggable`, `river` (which river
variant is drawn on it).

Roads (`ROADS`, `tile.road` = `index`): dirt 75, gravel 65, cobblestone 50.
Rivers (`RIVERS`) are cosmetic only; `tile.river` is `0|1` and the variant comes from the terrain.

### 1.1 Movement cost

Reference implementation: `stepMoveCost(from, to, diagonal, opts)` in `terrain.js`.
For one step from tile `from` to an adjacent tile `to`:

1. If `to` is impassable (rock, or blocked by an object footprint) the step is illegal.
2. **Sailing** (hero in a boat, or flying over / water-walking on water): `cost = 100`
   (66 if the tile being left has the `favorable_winds` overlay). Terrain, roads and Pathfinding
   are ignored at sea.
3. **Road**: if **both** `from.road` and `to.road` are non-zero, `cost` = road cost of the **`from`**
   tile (75/65/50). Terrain penalty is ignored completely.
4. **Otherwise** `cost = getTerrain(from.t).moveCost` - the terrain of the tile being **left**
   decides, not the one being entered. If that cost is above 100:
   - **Native terrain rule**: if the army is native to `from.t` the cost is 100. The army's native
     terrains are computed as: every creature in the army has a faction (neutral creatures have
     none, unless the creature has a `native_terrain` style ability); if **all** stacks have a
     faction whose `nativeTerrain` equals `from.t`, the army is native. One non-native stack breaks
     it. Special case kept from the original: any stack of `nomad` makes the army native to `sand`.
     Pass the result as `opts.nativeTerrains`.
   - Else **Pathfinding** subtracts a flat 25 / 50 / 75 (Basic / Advanced / Expert), floor at 100.
     (Rough 125 -> 100/100/100, sand and snow 150 -> 125/100/100, swamp 175 -> 150/125/100.)
   - Any further `terrain_penalty_reduction` bonus (`percent`) from artifacts or specialties scales
     the remaining penalty above 100: `100 + floor((cost - 100) * (100 - percent) / 100)`.
5. **Diagonal** steps cost `floor(cost * sqrt(2))` (`DIAGONAL_FACTOR = Math.SQRT2`, as in the original):
   141, 176, 212, 247; roads 106, 91, 70; favorable winds 93.
6. **Last-step rule**: if the hero has fewer points than a diagonal step costs but at least the
   orthogonal cost of the same step, the diagonal step is allowed and consumes **all** remaining
   points. Otherwise a step needs `movePoints >= cost`.
7. Diagonal steps may not cut corners around water/land boundaries: moving diagonally between two
   land tiles is allowed regardless of the two orthogonal neighbours, but a land hero can never
   enter water (and a boat never enters land) except through boarding / landing (section 7.2).

Daily movement points (computed by the hero engine; listed here because objects modify them):
land base by the **slowest** creature speed in the army: speed <=3: 1500, 4: 1560, 5: 1630, 6: 1700,
7: 1760, 8: 1830, 9: 1900, 10: 1960, >=11: 2000. Sea base is always 1500. Then
`movement_land` / `movement_sea` bonuses: flat `value`s are added first (Stables +400, Boots,
Lighthouse +500 sea each), then `percent`s (Logistics 10/20/30%, Navigation 50/100/150%) multiply.
When a hero boards or lands with the Admiral's Hat the remaining points are converted
proportionally (`remaining / maxOld * maxNew`).

### 1.2 Terrain overlays ("magic terrain")

`MAGIC_TERRAINS`, stored as the optional tile field `tile.overlay = id`. Overlay effect types
(`OVERLAY_EFFECT_TYPES`, closed set):

| type | params | meaning |
|---|---|---|
| `spell_mastery` | `school` (`air|earth|fire|water|all`), `level` | every spell of that school cast by either side (heroes and creatures) uses at least this mastery |
| `spell_level_cap` | `maxLevel` | spells above this level cannot be cast by anyone |
| `nullify_morale_luck` | - | morale and luck of every stack are exactly 0; no morale/luck rolls |
| `morale` | `alignment` (`good|evil|neutral|all`), `value` | added to each stack whose creature's faction has that alignment (neutral creatures count as `neutral`) |
| `luck` | `alignment`, `value` | same for luck |
| `creature_stat` | `stat`, `value`, `filter` (`{ flying: bool }`) | combat stat delta for matching stacks of both sides |
| `move_cost` | `cost` | adventure map: cost of leaving this tile while sailing |

| overlay | effects |
|---|---|
| magic_plains | all spells at Expert |
| cursed_ground | only level 1 spells; morale and luck nullified |
| holy_ground | +1 morale good, -1 morale evil |
| evil_fog | +1 morale evil, -1 morale good |
| clover_field | +2 luck for neutral-aligned creatures |
| lucid_pools / fiery_fields / rocklands / magic_clouds | water / fire / earth / air spells at Expert |
| cracked_ice | non-flying creatures -5 defense |
| dunes | non-flying creatures -1 speed |
| fields_of_glory | +2 luck for everybody |
| favorable_winds | sailing out of the tile costs 66 |

Combat uses the overlay of the tile the **defender** stands on (for a wandering monster or object:
the object's tile). The adapter passes it to combat as bonuses / a field on `CombatInput`.
Overlays never apply inside towns (sieges) or creature banks.

## 2. Map object definitions

`MAP_OBJECTS` (array), `MAP_OBJECT_BY_ID`, `getMapObject(id)` (throws), helpers
`getObjectsByCategory`, `getObjectsByEffect`, `getObjectsForTerrain`, `getDwellingsForFaction`,
`getDecorForTerrain`, and the lists `BANKS`, `DWELLINGS`, `MINE_OBJECTS`, `DECOR`, `EXTRA_OBJECTS`.

Fields of a definition (beyond DESIGN.md's `id, name, category, blocking, visitable, removable,
size, effect, description, value`):

| field | meaning |
|---|---|
| `revisit` | one of `REVISIT`, see 2.2 |
| `interact` | `enter`: the hero walks onto the entrance tile and stays there. `adjacent`: the hero stays on its own tile and the object is triggered from a neighbouring tile (pickups, monsters, guards, scholar). `none`: not visitable |
| `terrains` | terrains the generator may place it on (`['water']` = sea object) |
| `frequency` | RMG rarity weight; `0` = never placed randomly (placed by rules: mines, gates, keys...) |
| `limit` | max copies per RMG zone (optional) |
| `coastal` | must be placed on land next to water (optional) |
| `shape`, `color` | procedural graphics hints (`SHAPES` is the closed list) |
| `extra` | `true` = not in the original game |

### 2.1 Footprint and entrance

`obj.pos` is the **entrance tile**. With `size = [w, h]` the footprint covers
`x in [pos.x - floor(w/2), pos.x - floor(w/2) + w - 1]`, `y in [pos.y - h + 1, pos.y]`, same `z`
(entrance = bottom row, column `floor(w/2)`). If `blocking`, every footprint tile except the
entrance gets `tile.blocked = true`; the entrance tile gets `tile.obj = obj.id` (and, for
`interact: 'adjacent'` objects, is itself not enterable). Non-blocking objects (`sign`, `event`,
`hole`, flowers...) only set `tile.obj` when visitable. `enter` objects are entered from any of the
8 neighbours except from directly **above** footprint rows (i.e. never through the object's own
blocked tiles). Removing an object clears `tile.obj` and `blocked` on its footprint.

A visit to an `enter` object costs the normal movement of the step onto the entrance. A visit to
an `adjacent` object costs the movement of the step that *would* enter the tile (the hero must be
able to afford it) but the hero does not move; if the object is removed by the visit the hero
still does not move.

Fighting a guard first: any tile within `guardRadius` 1 of a wandering monster is guarded. A hero
whose step ends on a guarded tile (or who interacts with an object standing on one) must resolve
the monster first (section 5); if the hero does not win, the original action is cancelled.

### 2.2 Revisit rules

| `revisit` | bookkeeping | who can use it |
|---|---|---|
| `none` | - | nobody |
| `removed` | object deleted after a successful visit | first hero |
| `once` | `obj.data.visited = true` | first hero ever; later visitors see "already visited" (banks, caches) |
| `per_hero` | `hero.visited[obj.id] = true` | every hero once per game |
| `per_player` | `player.visited[obj.id] = true` | every player once per game |
| `per_battle` | a `hero.temp` entry with `source = obj.defId` | a hero who still carries a temp bonus from the **same definition id** (any instance) gets "nothing happens"; the entry is removed after the hero's next battle |
| `per_hero_daily` | `hero.visited[obj.id] = state.turn` | every hero once per day |
| `per_hero_weekly` | `hero.visited[obj.id] = absolute week number` | every hero once per week |
| `weekly` | `obj.data.visitedWeek = absolute week number` | first hero of each week (object-wide) |
| `monthly` | `obj.data.month` | stock refresh on day 1 of each month; any number of visits |
| `always` | - | unlimited |

Absolute week number = `floor((state.turn - 1) / 7) + 1`.
A visit that the hero declines or cannot afford does **not** consume the visit.
`player.visited` also records knowledge for tooltips ("visited" / the learned contents of witch
huts, shrines...) - purely informational.

### 2.3 Reward vocabulary

Many effects carry a `Reward` (or a table of them). All keys optional; an empty object = nothing.

| key | shape | applied as |
|---|---|---|
| `resources` | `{ res: n | [min,max] | [min,max,step] }` | added to `player.resources` |
| `randomResource` | `{ pool: [res...], amount: n | [min,max] }` | one resource picked uniformly from `pool` |
| `exp` | `n` | hero experience (Learning applies; may trigger level-ups -> `level_up` pendings) |
| `mana` | `n` | added to hero mana, may exceed the maximum |
| `artifacts` | `[{ class, count }]` | `count` random artifacts of that class (`treasure|minor|major|relic|any`) from the not-yet-placed pool; into the first fitting free slot, else the backpack |
| `creatures` | `[{ creatureId, count }]` | joins the hero's army (existing stack of the type, else a free slot). No room -> pending `army_overflow` letting the player dismiss/merge; unresolved leftovers are lost |
| `creaturesByValue` | `{ tier, aiValue }` | (Pandora presets) `floor(aiValue / creature.aiValue)` of a base creature of that tier of the zone's faction, chosen at map start |
| `spell` | `{ level, requires? }` | one random spell of that level, rolled at map start; taught only if the hero has a spell book, Wisdom allows the level, and `requires` (`{skillId, level}`) holds |
| `spells` | `{ level?, school?, count }` | (Pandora presets) that many random spells of the filter (`'all'` = every one); each taught if the hero can learn it |
| `primary` | `{ stat|'random': n }` | permanent primary skill gain |
| `bonuses` | `[{ bonus: Bonus, until }]` | pushed to `hero.temp` with `source = obj.defId` |

Rewards rolled from a range are rolled at the moment of the visit, **except** inside banks,
`weekly_reward` and everything marked "rolled at map start".

## 3. Effect types (closed set)

`EFFECT_TYPES` in `mapObjects.js` is the authoritative list; the test suite rejects any other type.
For each type: trigger, revisit, numbers, and the pending choice it raises (if any).
Pending choices use `{ kind, heroId, options, data: { objectId } }`; option index 0 is always the
"accept / first" option and the last option is "decline / leave" where declining is possible.

### 3.1 Pickups

**`none`** - scenery, `hole`, `eye_of_the_magi`. No interaction.

**`pickup`** `{ table: [{ chance, reward }] }` - resources piles, campfire, flotsam, sea chest,
shipwreck survivor, sea barrel, jetsam, vial of mana. Interact `adjacent`; roll the table, apply
the Reward to the hero/player, remove the object. Event `pickup` with the resolved amounts.
An empty reward still removes the object ("you find nothing").
Original values: wood/ore 5-10, mercury/sulfur/crystal/gems 3-6, gold 500-1000 in steps of 100;
campfire 400/500/600 gold + 4/5/6 of one random non-gold resource; flotsam 25% each: nothing,
5 wood, 5 wood + 200 gold, 10 wood + 500 gold; sea chest 20% nothing, 70% 1500 gold, 10% 1000 gold
+ treasure artifact; survivor artifact 55/20/20/5% treasure/minor/major/relic.
`resource_random` is a generator placeholder (`fx.placeholder`), replaced by one of `fx.replaceWith`.

**`chest`** `{ table }` - treasure chest. Rolled at the visit:
32%: 1000 gold or 500 exp; 32%: 1500 gold or 1000 exp; 31%: 2000 gold or 1500 exp;
5%: a treasure artifact (no choice; if the hero cannot carry it (64 backpack items) fall back to
the first row). For gold/exp rows raise pending `chest_choice` with options
`[{ gold }, { exp }]`; the object is removed when the pending is resolved (there is no decline).
AI rule of thumb: exp for the main hero, gold otherwise.

**`artifact`** `{ class }` - an artifact on the ground. `obj.data.artifactId` is rolled at map
start from the class pool (`artifact_random`: any of the four classes). Optional instance fields:
`data.guards: [{creatureId, count}]` (pending `confirm_fight`, then combat; hero must win) and
`data.cost: Resources` (pending `confirm_pay`). Then the artifact is equipped/put in the backpack
and the object removed. A hero with a full backpack cannot pick it up (`ok: false`).

**`spell_scroll`** - as `artifact` with artifact `spell_scroll`; `obj.data.spellId` rolled at map
start from spells of a level in `fx.spellLevel`. The hero receives a scroll instance bound to that
spell (`grants_spell`). `def.valueBySpellLevel` gives the RMG value per spell level.

**`pandoras_box`** - instance payload in `obj.data` (all optional): `guards`, `message`, `exp`,
`mana`, `morale`, `luck` (temp until next battle), `resources`, `primary`, `skills`
(`[{id, level}]`), `artifacts` (ids), `spells` (ids), `creatures`. Values may be **negative**
(resources/exp/mana/primary are clamped at 0; negative creature counts remove units).
Pending `confirm_open` ("open the box?"); on yes: fight `guards` if present (must win), apply
everything, remove the object. `PANDORA_PRESETS` are the generator's choices with their values.

**`event`** - same payload as Pandora plus `data.players` (ids allowed to trigger),
`data.humanOnly`, `data.aiOnly`, `data.once`. Invisible, non-blocking, triggers when a matching
hero **steps on** the tile; no confirmation. Removed after triggering if `once`.

**`grail`** - marker object `grail` (never rendered, not visitable). See section 6.

### 3.2 Income

**`mine`** `{ resource, amount, guards? }` - flaggable (`obj.owner = player.id` on visit by a
non-owner; visits by the owner do nothing). At the start of each of the owner's days:
`+amount resource`. Sawmill and ore pit 2/day, alchemist's lab / sulfur dune / crystal cavern /
gem pond 1/day, gold mine 1000/day. Capturing costs no extra movement. A mine may hold a guard
army (`obj.data.garrison`, 7 slots) left by its owner via the hero-exchange dialog when visiting
his own mine; enemies must beat it (pending `confirm_fight`).
**Abandoned mine**: `fx.resource = 'random'`; at map start roll `data.resource` from `fx.pool`
(never wood) and `data.guards` = troglodytes, count rolled in `[100, 249]`, split into 5 stacks.
Visiting raises `confirm_fight`; after victory it behaves as a normal mine producing
`fx.amountByResource[data.resource]` and shows as that mine.

**`weekly_reward`** `{ table, firstWeekTable?, cost? }` - revisit `weekly`. On day 1 of every week
(and at map start) the object rolls `data.reward` from the table (ranges resolved) and clears
`data.visitedWeek`. The first hero of the week takes it. Windmill: 3-6 of ore/mercury/sulfur/
crystal/gems (never wood or gold). Water wheel: 1000 gold, but `firstWeekTable` (500) during
week 1 of month 1. Mystical garden: 50% 5 gems / 50% 500 gold. Warehouses: fixed amount.
With `cost` (wishing well) raise `confirm_pay` first; paying consumes the weekly visit whatever the roll.

**`reward_once`** `{ table, confirm?, penalty?, penaltyWhenEmpty? }` - revisit `once`. Rolled at
map start into `data.reward`. With `confirm` raise `confirm_search` first (declining consumes
nothing). Apply reward, set `data.visited`. `penalty` (temp bonuses) is applied together with the
reward; with `penaltyWhenEmpty` it is applied again on **every** later (confirmed) visit of an
already-looted object. Lean-to 1-5 random non-gold resource; wagon 10% nothing / 40% treasure or
minor artifact / 50% 2-5 random resource; corpse 20% treasure or minor artifact;
warrior's tomb: artifact 30/50/15/5% treasure/minor/major/relic and -3 morale until next battle.

### 3.3 Creature banks

**`bank`** `{ levels: [{ chance, guards, reward, upgradedStack? }], confirm: true, emptyPenalty? }`.

- At map start roll the level by `chance` (30/30/30/10 for standard banks) and store
  `data.level`; resolve `data.guards` and `data.reward` (artifact ids and spell ids fixed then).
  If the level has `upgradedStack` roll its `chance` (50%): one stack of the first guard entry is
  replaced by the same count of the upgraded creature.
- Guards: each entry `{ creatureId, count, stacks }` is split into `stacks` stacks as evenly as
  possible (remainder to the first stacks); at most 7 stacks total, merge the smallest if exceeded.
- Visit: pending `confirm_fight` (text names the guards by size label). Decline -> nothing.
  Accept -> combat with `CombatInput.bank = true`, no retreat/surrender restriction changes, hero
  is the attacker, terrain = tile terrain, no overlay. Tactics phase is disabled.
- Win: apply `data.reward` (creatures join with the army-overflow rule), set `data.visited = true`
  and `data.cleared = true`. Lose/flee: guards keep their **remaining** numbers (`data.guards`
  updated), the bank stays.
- Visiting a cleared bank: "nothing left"; if `emptyPenalty` (crypt, shipwreck, derelict ship,
  churchyard: -1 morale; pyramid: -2 luck) it is applied as temp bonuses until the next battle.
- Banks do not refill.
- Pyramid: one level, 40 gold golems + 20 diamond golems, reward a level 5 spell that requires
  Expert Wisdom (the fight happens regardless; without the skill the spell is lost).

Original tables (guards -> reward), chances 30/30/30/10:

| bank | level 1 | level 2 | level 3 | level 4 |
|---|---|---|---|---|
| Cyclops Stockpile | 20 cyclopes -> 4 of each of the six non-gold resources | 30 -> 6 each | 40 -> 8 each | 50 -> 10 each |
| Dwarven Treasury | 50 dwarves -> 2500 gold, 2 crystal | 75 -> 4000, 3 | 100 -> 5000, 5 | 150 -> 7500, 10 |
| Griffin Conservatory | 50 griffins -> 1 angel | 100 -> 2 | 150 -> 3 | 200 -> 4 |
| Imp Cache | 100 imps -> 1000 gold, 2 mercury | 150 -> 1500, 3 | 200 -> 2000, 4 | 300 -> 3000, 6 |
| Medusa Stores | 20 medusas -> 2000 gold, 5 sulfur | 30 -> 3000, 6 | 40 -> 4000, 8 | 50 -> 5000, 10 |
| Naga Bank | 10 nagas -> 4000 gold, 8 gems | 15 -> 6000, 12 | 20 -> 8000, 16 | 30 -> 12000, 24 |
| Dragon Fly Hive | 30 dragon flies -> 4 wyverns | 45 -> 6 | 60 -> 8 | 90 -> 12 |
| Dragon Utopia | 8 green, 5 red, 2 gold, 1 black -> 20000 gold + treasure, minor, major, relic | 8/6/3/2 -> 30000 + minor, major, 2 relics | 8/6/4/3 -> 40000 + major, 3 relics | 8/7/6/5 -> 50000 + 4 relics |
| Crypt | 30 skeletons, 20 walking dead -> 1500 gold | 25, 20, 5 wights -> 2000 | 20, 20, 10 wights, 5 vampires -> 2500 + treasure | 20, 20, 10, 10 vampires -> 5000 + treasure |
| Derelict Ship | 20 water elementals -> 3000 gold | 30 -> 3000 + treasure | 40 -> 4000 + treasure | 60 -> 6000 + minor |
| Shipwreck | 10 wights -> 2000 gold | 15 -> 3000 | 25 -> 4000 + treasure | 50 -> 5000 + minor |

HotA banks (Beholders' Sanctuary, Temple of the Sea, Pirate Cavern, Mansion, Spit, Red/Black/Ivory
Tower, Churchyard, Experimental Shop, Wolf Raider Picket, Ruins) and the six new ones
(`extra: true`: Bandit Hideout, Troll Cavern, Sunken Vault, Elemental Forge, Haunted Library,
Crystal Dragon Roost) use the same structure; their tables live in the data file.

### 3.4 Permanent boosters

All `per_hero` unless stated; a hero who already visited gets "already learned" at no cost.

**`primary_boost`** `{ options: [{ stat, value }], cost? }` - one option: applied immediately.
Several options: pending `primary_choice` (options = the stats, no decline when free; with `cost`
there is a decline option and the visit is only consumed on purchase). Not enough resources ->
`ok:false`, visit not consumed. Mercenary camp +1 attack, Marletto tower +1 defense, star axis
+1 power, garden of revelation +1 knowledge, arena +2 attack **or** +2 defense, colosseum of the
magi +2 power or +2 knowledge, school of magic (1000 gold) +1 power or knowledge, school of war
(1000 gold) +1 attack or defense.

**`exp_boost`** `{ exp, expPerLevel?, cost? }` - `exp + expPerLevel * hero.level` experience.
Learning stone +1000. With `cost` pending `confirm_pay`.

**`level_up`** `{ costTable }` - tree of knowledge. At map start roll `data.cost` (34% free,
33% 2000 gold, 33% 10 gems). Visit: if a cost, pending `confirm_pay`; then the hero gains exactly
enough experience to reach the next level (`exp = expForLevel(level + 1)`), with the normal
level-up pending.

**`library`** `{ value, minLevel, diplomacyLevelReduction }` - +2 to all four primary skills if
`hero.level >= minLevel - diplomacyLevelReduction[diplomacyMastery]` (10 / 8 / 6 / 4). Otherwise
"come back when you are wiser" and the visit is **not** consumed.

**`learn_skill`** `{ level, pick, exclude, choices, cost, mode? }` - at map start roll
`data.skills` (`choices` distinct ids not in `exclude`). The hero learns the skill at `level`
(Basic) if he does not have it and has fewer than 8 skills; otherwise nothing, but the visit is
still consumed and the player learns what the hut teaches. `choices > 1` or `cost` -> pending
`skill_choice` with decline. `mode: 'upgrade_existing'` (hermit's shack): no roll at map start;
at the visit pick uniformly among the hero's skills below Expert and raise it one level (nothing
if none; visit not consumed then).

**`scholar`** `{ table }` - rolled at map start: `data.kind` and the concrete primary stat /
skill id / spell id. Visit: primary -> +1. Skill -> raised one level if the hero knows it below
Expert, learned at Basic if he lacks it and has a free slot, else +1 to a random primary (VCMI
`CGScholar`: `changeSecSkill(+1)`). Spell -> learned if the hero has a book and enough
Wisdom, else +1 to a random primary. Object removed.

**`university`** `{ skills: 4, cost, exclude }` - `data.skills` rolled at map start. Pending
`university` listing the 4 skills (unavailable if known or the hero has 8 skills); each purchase
costs 2000 gold and teaches Basic; the dialog stays open until the player leaves. Revisit `always`.

**`learn_spell`** `{ level, school }` - `data.spellId` rolled at map start (level may be a range,
`school` restricts). The hero learns it if he has a spell book and Wisdom permits the level
(levels 1-2 none, 3 Basic, 4 Advanced, 5 Expert). On failure the visit is not consumed but the
player still learns which spell the shrine holds. Shrine of magic incantation / gesture / thought
/ mystery = level 1 / 2 / 3 / 4.

**`altar_of_sacrifice`** - revisit `always`. Pending `altar` (a trade dialog): heroes of a
faction with alignment in `fx.artifactAlignments` may sacrifice artifacts
(`exp = artifact.cost`), heroes with alignment in `fx.creatureAlignments` may sacrifice creatures
(`exp per creature = floor(aiValue / 40) * 5`); neutral-aligned heroes may do both. Learning
applies. The last creature of the army, the spell book, war machines, the Grail and combination
artifacts cannot be sacrificed.

### 3.5 Temporary bonuses

**`temp_bonus`** `{ bonuses, until, movement?, endMovement?, variants?, random?, upgrade?, cost? }`

1. Check the revisit rule (`per_battle`: any `hero.temp` entry with `source === def.id`).
2. Resolve the bonus list: `bonuses`, plus the `variants` entry whose `days` contains
   `state.date.day`, plus for `random` one bonus `{ type: random.bonus, value }` with `value`
   rolled uniformly in `[min, max]` (a roll of 0 still counts as a visit).
3. Push each as `{ source: def.id, bonus, until }` to `hero.temp`.
4. `movement`: add that many points to `hero.movePoints` **now** (may exceed the daily maximum).
   It is not re-applied on later days unless the same amount is also present as a
   `movement_land` bonus with `until: 'end_of_week'` (stables).
5. `endMovement`: set `hero.movePoints = 0`.
6. `upgrade`: every stack of `from` in the army becomes `to` for free.

| object | effect |
|---|---|
| idol of fortune | days 1,3,5: +1 luck; days 2,4,6: +1 morale; day 7: both |
| fountain of fortune | luck -1..+3 |
| fountain of youth | +1 morale, +400 movement |
| faerie ring / mermaids | +1 luck |
| swan pond | +2 luck, movement set to 0 |
| rally flag | +1 morale, +1 luck, +400 movement |
| buoy | +1 morale |
| temple | +1 morale (+2 on day 7) |
| oasis | +1 morale, +800 movement |
| watering hole | +1 morale, +400 movement |
| mineral spring | +1 luck, +600 movement |
| stables | +400 land movement now and at every day start until the end of the week; cavaliers -> champions. `per_hero_weekly` |

`until` values: `next_battle` (removed after the hero's next combat, whatever the outcome),
`end_of_day`, `end_of_week` (removed when day 1 begins).

**`mana_restore`** `{ mode, amount?, allowOvercharge? }` - `full`: mana = max(mana, maxMana)
(magic well, `per_hero_daily`; nothing if already full, visit not consumed). `double`: mana =
max(mana, 2 x maxMana) (magic spring, object-wide `weekly`). `add`: mana += amount (moon well).

### 3.6 Services

**`market`** `{ modes, marketCount }` - revisit `always`; opens the same trade dialog as a town
marketplace (pending `trade`) as if the player owned exactly `marketCount` marketplaces (it does
**not** add to the player's own count). Rates: `eff = min((marketCount + 1) / 20, 0.5)` (0.30 for
the trading post). Resource values `V`: wood/ore 250, rare 500, gold 1. Selling resource A for B:
`r = V[A] * eff`, `g = V[B]`; if `r > g` you get `floor(r / g)` B per 1 A, else you pay
`round(g / r)` A per 1 B. (Trading post: 75 gold per wood, 150 per rare; 833 gold per wood,
1667 per rare; 7 wood per rare.) `creature_resource` (freelancer's guild): a creature sells for
`cost.gold * eff` worth of the chosen resource; the last stack cannot be sold.

**`black_market`** `{ slots, classes, restock }` - `data.stock` = `slots` random artifacts from
`classes`, rolled at map start and re-rolled per `restock` (`monthly`: day 1 of each month).
Pending `buy_artifact`; price in gold = `artifact.cost` (sold slots stay empty until restock).

**`refugee_camp`** `{ maxTier, costMultiplier, stock }` - on day 1 of each week (and map start)
roll `data.creatureId` uniformly among all non-war-machine creatures of tier 1..`maxTier`
(base and upgraded, any faction and neutral) and set `data.count = creature.growth`. Pending
`recruit`; cost = creature cost x `costMultiplier`. Unsold creatures are discarded at the re-roll.

**`tavern`** - pending `tavern`: identical to the town tavern (the player's two `tavernHeroes`,
2500 gold, hero appears on the entrance tile, which must be free - the visiting hero occupies it,
so the new hero is placed on the first free adjacent tile; none free -> not allowed).

**`war_machine_factory`** `{ items }` - pending `buy_war_machine`; ballista 2500, ammo cart 1000,
first aid tent 750; one of each per hero.

**`thieves_guild`** - shows the full thieves' guild table (as with many taverns). No state change.

**`sanctuary`** - a hero standing on the entrance cannot be attacked or targeted by enemy heroes
(enemy steps onto the tile are illegal). Only one hero fits. No other effect.

**`prison`** - `data.heroDefId` (+ optional pre-set level/army). Visit: if the player has fewer
than `MAX_HEROES_PER_PLAYER` heroes the prisoner is created on the prison tile, owned by the
player, with 0 movement points today; object removed. Otherwise "no room" and nothing happens.

**`hill_fort`** `{ costPercentByTier }` - revisit `always`; pending `upgrade_creatures` listing
every stack that has an upgrade. Price per stack = `count * (upgraded.cost - base.cost)` (all
resources) x `costPercentByTier[tier] / 100`, rounded down per resource: tier 1 free, tier 2 25%,
tier 3 50%, tier 4 75%, tiers 5-7 100%. Creatures with several upgrades let the player pick.

**`lighthouse`** - flaggable. Each lighthouse owned gives `movement_sea +500` to every hero of the
owner (aggregated as a player-wide bonus source).

**`shipyard`** `{ cost }` - flaggable. Visit: pending `build_boat` (1000 gold + 10 wood). The boat
appears on the first free water tile adjacent to the shipyard footprint (clockwise from north of
the entrance); if none or a boat already stands there, building is refused. Town shipyards use the
same rule.

### 3.7 Information

**`reveal_map`** `{ mode, radius?, kind?, objectDefId?, cost? }` - `per_player` (hut of the magi:
`always`).
`radius`: reveal all tiles within Euclidean distance `radius` of the object on its level
(observatory, pillar of fire, observation tower 20; watchtower 12).
`kind` (cartographers, 1000 gold, pending `confirm_pay`): reveal every tile that is `water`
(`sea`), every non-water tile of level 0 (`surface`), or every tile of level 1 (`underground`).
`objects`: reveal radius `radius` around every instance of `objectDefId` on the map (hut of the
magi -> eyes of the magi, 10 tiles; star chart -> obelisks, 3 tiles).

**`hide_map`** `{ radius }` - cover of darkness: for every player **other than** the visitor (and
his allies) all tiles within `radius` 20 become unexplored, except tiles currently seen by one of
their heroes/towns. Revisit `always`.

**`obelisk`** - see section 6. **`message`** - event `message` with `obj.data.text`; `sign` stays
(`always`), `ocean_bottle` is removed.

### 3.8 Guards and quests

**`quest_guard`** - `obj.data.quest` (one of `QUEST_TYPES`). Interact `adjacent`. If the quest is
fulfilled by this hero: pending `confirm_quest`; on accept the requested items are taken and the
guard is removed (the hero does not move). Otherwise show `data.quest` text.

**`border_guard`** `{ color, permanent, confirm }` - a player owns key `color` once any of his
heroes visited `keymasters_tent_<color>` (`player.visited['key_' + color] = true`).
Border **guard** (`permanent: false`, `adjacent`): with the key, pending `confirm_pass`; on accept
the guard is removed for everybody. Without the key: message, nothing happens.
Border **gate** (`permanent: true`, `enter`): never removed; the entrance tile is enterable only
by heroes of players holding the key (the pathfinder treats it as blocked otherwise).
**`keymaster_tent`** `{ color }` - sets the key flag for the player (`per_player`).
Eight colours: `KEY_COLORS`.

**`seer_hut`** - `obj.data = { quest, reward, deadline?, texts }`. Revisit `always` until
completed, then inert (`data.completed = true`).
Quest types (`QUEST_TYPES`), each checked against the **visiting hero**:

| type | fulfilled when | consumed on completion |
|---|---|---|
| `reach_level` `{ level }` | hero.level >= level | - |
| `reach_primary` `{ stats }` | each listed primary skill (base value) >= required | - |
| `kill_hero` `{ heroId }` | that hero was defeated by this **player** | - |
| `kill_monster` `{ objectId }` | that monster object was defeated by this player | - |
| `bring_artifacts` `{ artifactIds }` | hero carries all (equipped or backpack) | artifacts removed |
| `bring_creatures` `{ creatures }` | hero's army holds at least the counts and would keep >= 1 creature | creatures removed |
| `bring_resources` `{ resources }` | player can pay | resources removed |
| `be_hero` `{ heroDefId }` | hero.defId matches | - |
| `be_player` `{ playerId }` | hero.owner matches | - |

First visit by a player: the quest text is shown and logged (`player.visited[obj.id]`). When
fulfilled: pending `confirm_quest`; on accept consume and pay the reward - exactly one of
`QUEST_REWARD_TYPES`, expressed with the Reward vocabulary (`exp`, `mana`, `morale` / `luck` as
a temp bonus of +N until the next battle, `resources`, `primary`, `skill`
`{ id, level }`, `artifact`, `spell`, `creatures`). If `deadline` (absolute day) has passed the
hut is inert. `SEER_PRESETS` lists quest/reward pairs with RMG values; for `bring_artifacts`
presets the generator picks a concrete artifact of the class and makes sure it is obtainable.

**`garrison`** `{ antiMagic, removableUnits }` - a 3x1 gate whose entrance is the only passage.
`obj.owner`, `obj.data.army` (7 slots). Unowned and empty: the first visitor flags it. Owner (or
ally): pending `garrison_exchange` - move troops between hero and garrison (if
`data.removableUnits === false` troops can only be added). Enemy: if the army is non-empty,
pending `confirm_fight` then combat (no walls, defender has no hero, `antiMagic` -> nobody can
cast spells, implemented as `spell_level_cap` 0); on victory - or immediately when the army is
empty - the garrison is flagged by the visitor with an empty army. A hero may stand on the
entrance; heroes pass **through** an own/allied garrison freely.

**`monster`** - section 5. **`town`** - placeholder (`town`, `random_town`); `obj.data.townId`
points at `state.towns`; all behaviour is in the town engine.

### 3.9 Transport

**`teleport`** `{ kind, channel, exit, twoWay, loss? }`

- `one_way_entrance`: destination chosen uniformly among all `monolith_one_way_exit_<channel>`
  objects. No exits -> nothing happens.
- `two_way`: destination chosen uniformly among all **other** objects with the same definition
  id. None -> nothing happens.
- `subterranean_gate`: gates are paired once at map start: sort the gates of each level by
  `(y, x)`; repeatedly pair the surface gate with the nearest unpaired underground gate
  (squared distance on x,y; ties -> lower index). `data.pair` holds the partner id; unpaired
  gates do nothing.
- `whirlpool`: as `two_way` among whirlpools, but first apply `loss`: unless the hero carries one
  of `loss.protectedBy.artifactIds`, the **weakest stack** (lowest `count * aiValue`, ties ->
  lowest slot) loses `max(1, floor(count * 0.5))` creatures. Exempt when the whole army is a
  single creature. The player is warned first (pending `confirm_whirlpool`) unless protected.
- Arrival: the hero is placed on the destination's entrance tile; no movement cost beyond the
  step onto the entrance; the hero may continue moving. If an **enemy** hero stands on the
  destination, combat starts (teleporting hero attacks); if a friendly hero stands there the
  teleport is refused. Exits (`one_way_exit`) are not visitable. Stepping onto a two-way monolith
  one arrives at does not re-trigger; the hero must step off and on again (or press "revisit").

**`boat`** - section 7.2.

### 3.10 Dwellings

**`dwelling`** `{ faction, tier, creatures, freeFirst, guards, townGrowthBonus }` - generated from
`DWELLING_TABLE` (one per creature tier per faction, multi-creature ones - golem factory,
elemental conflux - and neutral ones). External dwellings sell **base** creatures only.

- Guards: `fx.guards` (golem factory 9 gold + 6 diamond golems, elemental conflux 12 earth +
  12 fire elementals, neutral dragon dwellings 3 of their own dragons) must be defeated once
  (`confirm_fight`) before the first flagging; `data.cleared = true` afterwards.
- Visit: flag it (`obj.owner`), then pending `recruit` with `data.stock[creatureId]`.
  Cost = normal creature cost. `freeFirst` (tier 1): the creatures join for free.
- Stock: at map start and on day 1 of every week `data.stock[c] = creature.growth` for each
  creature - it **resets**, it does not accumulate.
- Town growth: each flagged dwelling gives its owner `creature_growth { creatureId, value: 1 }`
  in every owned town that has built the dwelling for that creature (`townGrowthBonus`).
- Ancient lamp: one-time stock of 4-6 master genies (`stockFixed`, no restock), removed when empty.

### 3.11 Decor

Category `decor`, effect `none`. Generated from a table as `<base>_<w>x<h>` (or plain `<base>`
when a single size exists); `def.base` groups the sizes. `blocking: false` ones (flowers, moss,
bones, kelp) are purely visual. `terrain.decor` lists the shapes that fit each terrain and
`getDecorForTerrain(id)` returns the definitions.

## 4. Pending kinds raised by map objects

`chest_choice`, `confirm_fight`, `confirm_pay`, `confirm_open`, `confirm_search`,
`confirm_quest`, `confirm_pass`, `confirm_whirlpool`, `primary_choice`, `skill_choice`,
`university`, `altar`, `trade`, `buy_artifact`, `buy_war_machine`, `recruit`,
`upgrade_creatures`, `tavern`, `build_boat`, `garrison_exchange`, `army_overflow`,
`monster_join` (section 5), `monster_flee` (section 5), plus the hero engine's `level_up`.
Confirm kinds have options `['yes', 'no']`.

## 5. Wandering monsters

Object `monster` (`obj.data = { creatureId, count, disposition, character, neverFlees, noGrowth,
reward? }`); `random_monster` / `random_monster_<tier>` are generator placeholders resolved at map
start. `count` defaults to a roll in `MONSTER_COUNT_BY_TIER[tier]`.

**Size labels** (`MONSTER_SIZE_LABELS`, shown instead of numbers): few 1-4, several 5-9, pack
10-19, lots 20-49, horde 50-99, throng 100-249, swarm 250-499, zounds 500-999, legion 1000+.

**Disposition** -> `character`, rolled once at map start (`MONSTER_DISPOSITIONS`):
compliant -4 (always joins), friendly 1-7, aggressive 1-10 (default), hostile 4-10, savage 10.

**Weekly growth**: on day 1 of each week (not week 1 day 1), unless `noGrowth` or the stack already
has `growthCap` (4000) creatures: a hidden fixed-point size `data.power` (= `count * 1000`, reset
whenever `count` no longer matches it, e.g. after a battle) grows by 10% (truncated) and
`count = min(4000, floor(power / 1000))`. Fractions accumulate: 5 -> 5 -> 6, 10 -> 11 -> 12
(original / VCMI `CGCreature::newTurn`).

**Guarding**: the 8 tiles around the monster are guarded (section 2.1). Interacting = attacking.

**Join / flee / fight** (evaluated when a hero triggers the stack):

```
heroStrength   = sum(count * aiValue over the hero's army) * sqrt((1 + 0.05*attack) * (1 + 0.05*defense))
monsterStrength= count * aiValue
ratio          = heroStrength / monsterStrength

powerFactor = 11                         if ratio >= 7
            = floor(2 * (ratio - 1))     if ratio >= 1
            = -1                         if ratio >= 0.5
            = -2                         if ratio >= 0.333
            = -3                         otherwise

similar  = number of creatures in the hero's army that are the same creature as the monster,
           its upgrade, or its base form
sympathy = 0, +1 if similar > 0, +1 more if similar * 2 > total creature count of the army
diplomacy= mastery of Diplomacy (0..3) (plus other `diplomacy` join bonuses)
charisma = powerFactor + diplomacy + sympathy

if charisma < character                              -> FIGHT
else if canJoin and diplomacy + sympathy + 1 >= character      -> JOIN FOR FREE
else if canJoin and 2*diplomacy + sympathy + 1 >= character    -> JOIN FOR GOLD (count * creature.cost.gold)
else if charisma > character and not neverFlees      -> FLEE
else                                                 -> FIGHT
```

`canJoin` is false when the hero has no free slot and no stack of that creature, or the map
setting forbids joining. (attack/defense = hero primary skills including bonuses.)

- JOIN: pending `monster_join` with `data.cost` (0 or gold). Accept -> the whole stack joins,
  object removed, no experience. Decline (or not enough gold) -> the stack is re-evaluated with
  `canJoin = false` (VCMI `joinDecision`): FLEE (pending `monster_flee`) if `charisma > character` and
  it may flee, else FIGHT ("insulted by your refusal"). Event `monster_refused`.
- FLEE: pending `monster_flee` ("they flee in terror - pursue?"). No -> object removed, no
  experience. Yes -> FIGHT.
- FIGHT: combat, hero attacks. Stack splitting: `m` = 7 if ratio < 0.5, 6 if < 0.67, 5 if < 1,
  4 if < 1.5, 3 if < 2, else 2; then roll 1..100: <= 20 -> `m - 1`, >= 80 -> `m + 1`; clamp to
  `1..min(7, count)`. Split `count` evenly over `m` stacks (remainder to the first ones). If the
  creature has an upgrade, with `upgradedStackChance` 50% the middle stack is the upgraded form.
  Win -> object removed, `data.reward` (optional Reward) granted. Lose/retreat -> the monster
  keeps its survivors (`count` updated).

## 6. Grail, obelisks and digging

- A map has at most one `grail` object (hidden, never drawn). The puzzle map has
  `fx.puzzlePieces = 48` pieces covering the area around the grail.
- Visiting an obelisk (`per_player`, shared with allies) increments the team's obelisk count `v`.
  With `T` obelisks on the map the team sees `floor(48 * v / T)` pieces removed (all 48 when
  `v = T`). The removal order is a fixed permutation rolled at map start (`state.map.puzzleOrder`),
  outer pieces first. With `T = 0` the puzzle is never revealed.
- **Digging** (hero action, anywhere): allowed only if the hero is on land, not in a boat, the
  tile has no object and no road, the terrain is `diggable`, and the hero still has its **full**
  daily movement (`movePoints >= maxMovePoints`, i.e. has not moved today). Digging sets
  `movePoints = 0`. If the tile is the grail tile: the hero receives artifact `grail`, the `grail`
  object is deleted and every player is notified. Otherwise a `hole` object is placed on the tile
  ("nothing here"); tiles with a hole cannot be dug again.
- A hero carrying the grail who enters an own town may build that town's grail structure
  (town engine). The grail cannot be traded, sacrificed or dropped.

## 7. Water

### 7.1 Sea objects
Objects with `terrains: ['water']` are visited from a boat with the same `interact` rule (buoy,
mermaids, derelict ship, shipwreck, whirlpool: `enter`; flotsam, sea chest, survivor, barrel,
jetsam, bottle, vial: `adjacent`). `coastal` objects (shipyard, lighthouse, smugglers' den) sit on
land adjacent to water and are visited from land.

### 7.2 Boats
- A `boat` object occupies one water tile and blocks other boats. `obj.data.heroId` is set while
  a hero is aboard (the hero has `inBoat: true` and shares the tile; the boat moves with the hero).
- **Boarding**: a land hero adjacent to an empty boat steps onto it. Requires at least 1
  movement point; afterwards `movePoints = 0` (boarding ends the day's movement).
- **Landing**: a sailing hero adjacent to a free, passable land tile (no blocking object; a
  visitable `enter` object or pickup on that tile is **not** a valid landing tile) steps onto it.
  Requires at least 1 movement point; afterwards `movePoints = 0`. The boat stays behind, empty.
- With an artifact listed in `fx.noPenaltyWith` (Admiral's Hat) boarding and landing cost a normal
  step and remaining points are converted proportionally between the land and sea maxima.
- At sea the hero uses sea movement points (base 1500, Navigation, lighthouses, sea artifacts).
- Combat at sea uses battlefield `ship`. A defeated sailing hero's boat is removed.
- Boats are built at shipyards (object or town, 1000 gold + 10 wood) or summoned by spells.
  A hero cannot board an enemy-occupied boat without combat; attacking a sailing hero from land
  is not possible (and vice versa) - only boat vs boat or via boarding an adjacent tile.

## 8. Bonus types

No new Bonus types are introduced. Map objects only use `morale`, `luck`, `primary`,
`movement_land`, `movement_sea` from DESIGN.md, stored in `hero.temp` (per hero) or derived from
ownership (`lighthouse` -> `movement_sea` for all the owner's heroes; flagged dwelling ->
`creature_growth { creatureId, value: 1 }` in the owner's matching towns; mines -> daily income,
equivalent to `resource_income`).

## 9. Map generator notes

- `value` is the budget value (original RMG scale: resource pile 1400-2000, chest 1500, minor
  artifact 5000, utopia 10000...). `frequency` is a relative weight; `0` means "placed by rule".
- A treasure tile of value `v` should be guarded by a monster stack whose strength grows with `v`
  (generator's business); banks carry their own guards and need no extra monster.
- `limit` caps copies per zone. `terrains` order for dwellings puts the faction's native terrain
  first (`def.nativeTerrain`). `PANDORA_PRESETS` and `SEER_PRESETS` carry their own values.
- Scroll value by spell level: `spell_scroll.valueBySpellLevel`; prison value by the prisoner's
  experience: `prison.effect.valueByHeroExp`; bank per-level values on Dragon Utopia levels.

## Deviations and uncertain values

- HotA overlays **dunes** (-1 speed) and **cracked ice** (-5 defense, ground units) and
  **fields of glory** (+2 luck) are recalled approximately. `favorable_winds` is HotA's sea overlay.
- HotA creature bank tables (Beholders' Sanctuary ... Ruins) are approximations in the spirit of
  the originals, not verified numbers. The SoD bank tables are the original ones.
- Dwelling RMG values use a tier table (`DWELLING_VALUE_BY_TIER`) instead of the original
  per-creature formula. Dwelling guards other than golem factory / elemental conflux are chosen.
- Hut of the magi radius (10), black market pricing (`artifact.cost`, monthly restock; SoD never
  restocks), altar of sacrifice exp formulas, vial of mana / sea barrel / jetsam amounts,
  monster counts by tier and `growthCap` are sensible picks.
- Monoliths: 4 one-way colours and 4 two-way colours (the original has more variants).
- Factory dwelling names and all `extra: true` content are original to this project.
- `tile.overlay` (magic terrain id) and `tile.river` variants are additions to the tile shape in
  DESIGN.md (optional field; absent = none).

## Checklist

Data (this phase):

- [x] terrain table covers every `TERRAINS` id with original move costs - `tests/data/mapObjects.test.js`
- [x] roads 75/65/50, both-ends rule, diagonal x sqrt(2), pathfinding, native terrain - `tests/data/mapObjects.test.js`
- [x] magic terrain overlays with closed effect set - `tests/data/mapObjects.test.js`
- [x] unique ids, closed category / effect / revisit / shape sets, required fields - `tests/data/mapObjects.test.js`
- [x] every chance table sums to 100 (pickups, chest, banks, caches, tree of knowledge, scholar) - `tests/data/mapObjects.test.js`
- [x] bank tables: SoD originals spot-checked (utopia, stockpile, treasury, crypt...) - `tests/data/mapObjects.test.js`
- [x] dwellings cover all 11 factions x 7 tiers; creature ids exist in `creatures.js` - `tests/data/mapObjects.test.js`
- [x] monster size labels / dispositions - `tests/data/mapObjects.test.js`
- [x] keymaster / border guard colours, monolith entrance-exit pairing consistency - `tests/data/mapObjects.test.js`

Engine (implemented: see docs/mechanics/adventure-engine.md, tests in `tests/adventure/`):

- [x] footprint placement, blocking, entrance, `enter` vs `adjacent` interaction
- [x] movement cost: terrain-of-origin, roads, diagonal, last-step rule, pathfinding, native army, sailing, favorable winds
- [x] revisit bookkeeping for all 11 `REVISIT` modes
- [x] Reward application (resources, random resource, exp, mana, artifacts, creatures + overflow, spells, primary, temp bonuses)
- [x] `pickup`, `chest` (+ `chest_choice`), `artifact` (guards / cost), `spell_scroll`
- [x] `pandoras_box`, `event`
- [x] `mine` (flag, daily income, garrison), abandoned mine
- [x] `weekly_reward` (weekly re-roll, first-week table, cost), `reward_once` (confirm, penalty)
- [x] `bank` (level roll, upgraded stack, stack split, bank combat, reward, empty penalty, survivors persist)
- [x] `primary_boost`, `exp_boost`, `level_up`, `library`, `learn_skill`, `scholar`, `university`, `learn_spell`, `altar_of_sacrifice`
- [x] `temp_bonus` (variants by day, random, instant movement, endMovement, upgrade, expiry), `mana_restore`
- [x] `market`, `black_market`, `refugee_camp`, `tavern`, `war_machine_factory`, `thieves_guild`, `sanctuary`, `prison`, `hill_fort`, `lighthouse`, `shipyard`
- [x] `reveal_map` (radius / kind / objects), `hide_map`, `message`
- [x] `obelisk`, puzzle reveal, digging, `grail`, `hole`
- [x] `quest_guard`, `border_guard` (guard and gate), `keymaster_tent`, `seer_hut` (all quest and reward types, deadline)
- [x] `garrison` (flag, exchange, fight, anti-magic)
- [x] `teleport`: monoliths, subterranean gate pairing, whirlpool loss
- [x] `boat`: boarding / landing end movement, Admiral's Hat, sea combat
- [x] `dwelling` (guards, flag, weekly stock reset, free tier 1, town growth bonus)
- [x] `monster`: join / flee / fight formula, stack split, upgraded stack, weekly growth, guard zone
- [x] property walks on generated maps (move points >= 0, legal tiles, fog monotonic, revisit rules, JSON) - `tests/adventure/property.test.js`
- [ ] terrain overlays applied to combat (adventure passes `overlay` to startCombat; applied by hero/combat)
