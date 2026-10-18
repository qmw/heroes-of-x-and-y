# Towns, factions and buildings

Data: `src/data/factions.js`, `src/data/buildings.js`. Tests: `tests/data/towns.test.js`.
The town engine (`src/engine/town.js`, `src/engine/economy.js`) is implemented from this document; the
checklist at the bottom lists what it has to tick. Tables in section 9 are generated from the data
(the data is authoritative if they ever disagree).

## 1. Factions (`FACTIONS_DATA`, `FACTION_BY_ID`, `getFaction`)

Schema (superset of DESIGN.md section 3):

```js
{ id, name, alignment, nativeTerrain, heroClasses: [mightId, magicId],
  creatures: [[base, upgraded] x7],
  altCreatures: [{ tier, creatures: [base, upgraded], dwellingId }],   // only Factory
  townNames: [>=16], color: '#rrggbb',
  mageGuildMax,            // 3..5
  hasShipyard,             // shipyard is in the build list (still needs adjacent water)
  warMachines: [...],      // sold by the blacksmith
  siloResources: [...],    // +1 each per day from the resource silo
  siege: { moat: {name, damage, width}|null, mines: {damage, count}|null, wallName },
  rules: [{ id, description }] }
```

| faction | align | terrain | classes | mage guild | blacksmith | silo | moat dmg |
|---|---|---|---|---|---|---|---|
| castle | good | grass | knight / cleric | 4 | ballista | wood + ore | 70 |
| rampart | good | grass | ranger / druid | 5 | first_aid_tent | crystal | 70 |
| tower | good | snow | alchemist / wizard | 5 | ammo_cart | gems | none; 6 land mines x 150 |
| inferno | evil | lava | demoniac / heretic | 5 | ammo_cart | mercury | 90 |
| necropolis | evil | dirt | death_knight / necromancer | 5 | first_aid_tent | wood + ore | 70 |
| dungeon | evil | subterranean | overlord / warlock | 5 | ballista | sulfur | 90 |
| stronghold | neutral | rough | barbarian / battle_mage | 3 | ammo_cart (+ballista via Ballista Yard) | wood + ore | 70 |
| fortress | neutral | swamp | beastmaster / witch | 3 | first_aid_tent | wood + ore | 90 |
| conflux | neutral | highlands | planeswalker / elementalist | 5 | ballista | mercury | 70 |
| cove | neutral | swamp | captain / navigator | 4 | cannon | wood + ore | 70 |
| factory | neutral | wasteland | mercenary / artificer | 5 | ballista, ammo_cart, first_aid_tent | mercury | 70 |

**Factory's 8-creature lineup.** HotA's Factory has two tier-7 creatures. It is modelled as the normal
7 tiers (`creatures[6] = [couatl, crimson_couatl]`, dwelling `factory_dwelling_7`) plus
`altCreatures: [{ tier: 7, creatures: [dreadnought, juggernaut], dwellingId: 'factory_dwelling_7_alt' }]`
with buildings `factory_dwelling_7_alt` / `factory_dwelling_7_alt_up` whose `dwelling.alt === true`.
Both tier-7 dwellings may be built in the same town; each grows independently by its own creature's
base growth and both receive the fort/grail percentage. Code that iterates "tiers 1..7" should iterate
`dwellingsForFaction(f)` instead when it needs every recruitable creature.

## 2. Building model

```js
{ id, faction: '<faction>'|'common', name, description, cost, requires: [id...], replaces: id|null, kind,
  dwelling?: { creatureId, tier, upgraded, alt? },
  effects: [Effect...],
  effectsByFaction?: { [factionId]: [Effect...] },   // blacksmith, resource_silo
  factions?: [...],          // common building limited to these factions (shipyard)
  mageGuildLevel?, requiresWater?, requiresGrail?, uniquePerPlayer?, startsBuilt? }
```

Always read effects through `getBuildingEffects(buildingId, town.faction)`; it merges `effectsByFaction`.

### Upgrade chains ("replaces")

`Town.buildings` holds **only the newest building of each chain**: when a building with `replaces` is
built, the replaced id is removed (`applyBuild`). Consequently every upgrade carries its *full* effect,
not a delta (Castle has `growth_percent 100`, not +50 on top of the Citadel; Capitol has income 4000).
Chains: `village_hall > town_hall > city_hall > capitol`, `fort > citadel > castle`,
`mage_guild_1 > ... > mage_guild_5`, `<f>_dwelling_N > <f>_dwelling_N_up`, `tavern > cove_pub`.

A requirement is satisfied when the required building **or anything replacing it** stands
(`isBuilt(town.buildings, id)`), e.g. `mage_guild_3` satisfies `mage_guild_1`, `castle` satisfies `fort`.

### Build rules (`buildInTown(state, townId, buildingId)`)

Reject (`ok:false`) with these errors, in this order:
1. `not_available` - `!isAvailableTo(building, town.faction)` (wrong faction, mage guild above the
   faction cap, shipyard for a faction without one).
2. `already_built` - `isBuilt(town.buildings, id)`.
3. `built_this_turn` - `town.builtThisTurn` (constant `BUILDS_PER_DAY = 1`; reset at the owner's start of
   day). **Exempt:** `requiresGrail` buildings.
4. `missing_requirements` - `missingRequirements(town.buildings, id).length > 0`.
5. `no_water` - `requiresWater` and no water tile adjacent to the town (shipyard, lighthouse).
6. `capitol_exists` - `uniquePerPlayer` and another town of the owner has it
   (`UNIQUE_PER_PLAYER_BUILDINGS = ['capitol']`). If a player captures a second Capitol, the captured one
   is downgraded to `city_hall` at capture time.
7. `no_grail` - `requiresGrail` and the visiting/garrison hero does not carry the Grail artifact (the
   artifact is consumed).
8. `not_enough_resources`.

Then pay the cost, `town.buildings = applyBuild(...)`, set `builtThisTurn`, run `build`-time effects, and
for a dwelling immediately add the creature's **base growth** to `town.stock` (upgraded dwelling: existing
base-creature stock stays and can be recruited/upgraded; future growth goes to the upgraded creature).

`checkBuildable(builtIds, id, factionId)` implements 1, 2 and 4 for UI greying.

### Starting buildings

`startingBuildings(factionId, 'main' | 'other')` from `STARTING_BUILDINGS`:
- `main` (a player's starting town): village_hall, fort, tavern, `<f>_dwelling_1`
- `other` (all other towns): village_hall, fort, `<f>_dwelling_1`

Starting stock: one week of growth for each built dwelling.

## 3. Effect types (closed set, `EFFECT_TYPES`)

`when`: **passive** = queried whenever relevant; **daily** = start of owner's day; **weekly** = day 1 of a
week; **visit** = hero enters town (and at start of day while he stays); **siege** = combat setup;
**action** = enables a town-screen action; **build** = once at construction (also re-applied on capture
where noted).

| type | params | when | resolution |
|---|---|---|---|
| `resource_income` | resource, value | daily | Owner gains `value` of `resource` each day. |
| `growth_percent` | percent | weekly | Adds `percent` of BASE growth to every dwelling of the town (percents add up). |
| `creature_growth` | tier, creatureIds, value | weekly | Horde: flat +`value` weekly growth for the dwelling of `tier` (base or upgraded). |
| `siege_defense` | fortLevel, wallHp, gateHp, keep, turrets, moat | siege | Fortifications present in a siege (CombatInput.siege.fortLevel). |
| `garrison_bonus` | stat, value | siege | Defender of this town in a siege gets +value morale/luck (army) or attack/defense/power/knowledge (hero; needs a defending hero). |
| `visit_bonus` | stat, value | visit | Once per hero per town: permanent +value to a primary stat, or stat "experience". |
| `visit_temp_bonus` | bonus, until | visit | Every visit: hero.temp gets `bonus` until `until` (not stacking with itself). |
| `player_hero_bonus` | bonus | passive | Every hero of the owning player has `bonus` (a DESIGN Bonus) while the building stands. Same building in several towns does not stack. |
| `recruit_heroes` | cost, pool | action | Tavern: hire one of the player's `pool` tavern heroes for `cost` gold. |
| `thieves_guild` | value | action | Adds `value` to the player's thieves-guild information level (sum over all towns). |
| `sells_war_machine` | machineId, cost | action | Visiting hero may buy the war machine if he lacks it. |
| `trade_resources` | - | action | Marketplace: resource<->resource trade and sending resources to other players; counts as one marketplace. |
| `trade_creatures_for_resources` | - | action | Freelancer's Guild: sell army stacks for resources. |
| `sells_artifacts` | slots | action | Artifact Merchants: buy/sell artifacts for resources. |
| `sacrifice_altar` | creatures, artifacts | action | Grotto: sacrifice creatures/artifacts for hero experience. |
| `mage_guild` | level | build | Mage guild of `level`: spells for levels 1..level are rolled when built; visiting heroes learn what Wisdom allows. |
| `mana_restore` | - | daily | A hero who starts the day in this town has mana restored to maximum. |
| `mana_double` | - | visit | Mana Vortex: once per week (per town) a visiting hero gets mana = 2 x maximum. |
| `library_extra_spell` | value | build | Each existing/future mage guild level offers +value spells. |
| `all_spells` | - | build | Aurora Borealis: every built guild level of this town offers every spell of that level. |
| `weekly_resource_random` | min, max, resources | weekly | Mystic Pond: owner gets min..max of one random resource from `resources`. |
| `gold_interest` | percent | weekly | Owner's gold increases by percent% of the amount held at week start. |
| `skeleton_transform` | - | action | Convert army stacks to skeletons (dragons/hydras to bone dragons). |
| `town_gate` | - | action | Castle Gate: visiting hero teleports to another owned town with a Castle Gate and no visiting hero. |
| `shipyard` | cost | action | Build a boat on an adjacent free water tile. |
| `reveal_map` | radius | all | build | Reveals terrain around the town (radius tiles) or the whole map; lookout also adds permanent town sight. |
| `fog_cover` | radius | daily | Cover of Darkness: re-shrouds tiles within radius for all other players each day. |
| `necromancy_bonus` | percent | passive | All heroes of the owner get +percent Necromancy (stacks across towns). |
| `teach_skill` | skills, cost | action | Magic University: visiting hero buys a Basic secondary skill. |
| `portal_of_summoning` | - | weekly | Offers creatures of a random flagged external dwelling for recruitment. |
| `escape_tunnel` | - | siege | Defending hero may retreat/surrender from a siege. |
| `week_of_creature` | creatureId, growthBonus | weekly | Deity of Fire: in this town every week counts as the week of that creature: +growthBonus flat weekly growth for its dwelling. |
| `native_terrain_all` | faction | passive | Lodestar: all terrain counts as native for the owner's creatures of `faction`. |
| `grail` | - | passive | Marker for the Grail structure. |

Details the engine needs beyond the one-liners:

- `resource_income` - gold from halls (only the newest hall exists, so no double counting), silo
  resources, grail +5000. Neutral towns earn nothing.
- `garrison_bonus` - applies only when the town is *defended in a siege* (`CombatInput.siege != null`).
  `morale`/`luck` go into the defending side as `{type:'morale'|'luck', value}` bonuses (work without a
  hero too); `attack/defense/power/knowledge` are added to the defending hero's primaries for that combat
  (ignored when there is no defending hero). Tavern +1 morale; Brotherhood of the Sword adds +1 more
  (total +2, as in the original).
- `visit_bonus` - recorded in `hero.visited['<townId>:<buildingId>']`; granted once per hero per town,
  on entering the town or when the building is built while the hero is inside. `stat:'experience'` goes
  through the normal experience routine (Learning applies, may trigger level-ups).
- `visit_temp_bonus` - Stables: push `{source:'castle_stables', bonus, until:'end_of_week'}` to
  `hero.temp` unless one from the same source exists; also add the value to current `movePoints` at once.
- `player_hero_bonus` - aggregator source "town buildings": collect from all towns of the player,
  de-duplicated by building id (two Lighthouses do not stack; original behaviour for grails is moot as
  there is one Grail).
- `mage_guild` / `library_extra_spell` / `all_spells` - see section 6.
- `mana_restore` - hero that begins the day as visiting or garrison hero: `mana = max(mana, maxMana)`.
- `mana_double` - once per week per town (`town.manaVortexUsedWeek`): the first hero to enter (or the hero
  inside on day 1) gets `mana = 2 * maxMana`.
- `reveal_map` - radius form: reveal on build and on capture, and the town's own sight radius becomes
  `radius`; `all:true`: reveal the entire map (both levels) for the owner on build.
- `fog_cover` - at the start of each *other* player's day, tiles within `radius` of the town become
  unexplored for them unless currently inside the sight radius of one of their heroes/towns.
- `necromancy_bonus` - `{type:'necromancy_percent', percent}` for every hero of the owner; unlike
  `player_hero_bonus` it **stacks** per town (each Amplifier +10, Soul Prison +20).
- `week_of_creature` - Deity of Fire: in this town the tier-1 dwelling gets `+growthBonus` (15) every
  week, independent of the global `weekOf` (simplification of "every week is Week of the Imp").
- `native_terrain_all`, `escape_tunnel` - passed to combat setup (terrain nativity / `canRetreat` in sieges;
  without the tunnel a defending hero in a town with a fort cannot retreat or surrender).
- `thieves_guild` - information level = sum of values over the player's towns (tavern 1, Pub 3); the
  thieves' guild screen unlocks one more row of statistics per level.
- `grail` - marker only; see section 4 for the growth part.

### Bonus types

Buildings emit only existing DESIGN.md Bonus types through `player_hero_bonus` / `visit_temp_bonus`:
`morale`, `luck`, `movement_sea`, `movement_land`, `mana_regen`, and (derived) `necromancy_percent`.
No new Bonus types are introduced. `resource_income` is reused as an *effect* with the same shape.

## 4. Creature growth

Resolved on day 1 of every week (not on game day 1) for every town, including neutral ones.
For each built dwelling (the newest of its chain; the creature is `dwelling.creatureId`):

Order and rounding follow the original (as reverse-engineered by VCMI's `getGrowthInfo`); every
part is floored on its own:

```
base     = creature.growth
fort     = floor(base * P / 100)            // P = growth_percent effects without ofTotal: citadel 50 | castle 100
legion   = floor((base + fort) * L / 100)   // L = 50 if the owner holds the assembled Statue of Legion
                                            //     (artifact bonus creature_growth{percent}, any hero of the owner)
flat     = horde creature_growth effects for dwelling.tier  // only if the horde building stands
           + artifact creature_growth{tier|creatureId, value} of the visiting/garrison hero (Legion parts)
           + 1 per external adventure-map dwelling of this creature (base form) flagged by the owner
subtotal = base + fort + legion + flat
grail    = floor(subtotal * G / 100)        // G = growth_percent with ofTotal (the Grail's 50): +50 % of EVERYTHING above
growth   = subtotal + grail
           + week bonus: +5 if state.weekOf.creatureId is this creature or its other form ("Week of the X")
           + week_of_creature.growthBonus (Deity of Fire, tier 1 only)
```

- No fort (village): `percent = 0`, growth = base + flat. (Dwellings need a fort to be built, but a town
  can be configured without one by a scenario.)
- Unrecruited creatures **accumulate** in `town.stock[creatureId]` without limit.
- After upgrading a dwelling, growth is added to the upgraded creature id; leftover base-creature stock
  stays recruitable.
- "Month of the X" (day 1 of a month): the creature's stock in every town that has its dwelling is
  doubled after growth. "Plague" month: all stocks are halved (round down) instead of growing.
- Neutral towns: growth is added to the stock exactly as above (percent from their fort level);
  additionally the garrison of a neutral town grows by 10% of each stack per week (min +1).
- Unowned **adventure-map dwellings** (map-object agent): hold `growth` creatures, refilled (not
  accumulated) each week for tiers 2+; tier 1 is unlimited once flagged in the original - here it
  accumulates one base growth per week up to 4 weeks' worth.
- Recruiting costs `creature.cost * count`, needs a free or matching army slot in the garrison/visiting
  hero. Upgrading a stack in a town with the `_up` dwelling costs `(upgraded.cost - base.cost) * count`.

Worked example (tested by the engine): Castle with `castle`, Griffin Bastion, grail, griffin growth 7:
`7 + 7 (castle) + 3 (bastion) = 17`, Grail `+ floor(17 / 2) = 8`, total **25**. Statue of Legion with a
castle, archers (9): `9 + 9 + floor(18 / 2) = 27`.

## 5. Income and economy

Daily, at the start of each player's day (including day 1): sum of `resource_income` effects over owned
towns + mines + hero bonuses (Estates, artifacts). Halls: 500 / 1000 / 2000 / 4000 gold. Silo: +1 of each
`faction.siloResources` (wood **and** ore for castle, necropolis, stronghold, fortress, cove). Grail +5000.

Weekly (day 1, before growth): `weekly_resource_random` (Mystic Pond: pick one **rare** resource -
mercury, sulfur, crystal, gems - uniformly, amount uniform 1..4, via state rng; as in the original) and `gold_interest`
(`gold += floor(gold * percent / 100)`; several treasuries add their percents).

A player with no towns loses after 7 days (`daysWithoutTown`), handled by game.js.

## 6. Mage guild

- Costs: level 1 = 2000 gold, 5 wood, 5 ore; levels 2-5 = 1000 gold, 5 wood, 5 ore and 4 / 6 / 8 / 10 of
  each of mercury, sulfur, crystal, gems. (The original varies a few of these per town; one common table
  is used here.)
- Faction cap `mageGuildMax`: Castle 4, Stronghold 3, Fortress 3, Cove 4, others 5.
- Spell slots per level `MAGE_GUILD_SPELL_SLOTS = [5, 4, 3, 2, 1]`; the Tower Library
  (`library_extra_spell`) makes it 6/5/4/3/2 (spells for the extra slots are rolled when the Library is
  built, or with the level if it is built later).
- `Town.mageGuild[level-1]` is rolled when the level is built, with state rng, without duplicates, from
  combat+adventure spells of that level. No spell is guaranteed. If the spell data carries a
  `bannedFactions` list (spell agent's call), spells banned for the town's faction are excluded;
  otherwise there are no bans.
- A hero entering the town (or inside when a level is built) learns every guild spell with
  `spell.level <= 2 + wisdomLevel` (no Wisdom: levels 1-2; Basic 3; Advanced 4; Expert 5), provided he
  has a spellbook. A spellbook can be bought in any mage guild for 500 gold.
- `all_spells` (Aurora Borealis): every built level contains all spells of that level.
- `mana_restore`: see section 3.

## 7. Trade

### Marketplace (`marketRate(from, to, markets)`)

`markets` = number of the player's towns with a `trade_resources` building (plus owned Trading Posts on
the map). Resource values `RESOURCE_VALUE`: gold 1, wood/ore 250, rare 500.

```
eff = min((markets + 1) / 20, 0.5)
r = value[from];  g = value[to] / eff
if r > g:  give 1,                 get ceil(r / g)
else:      give floor(g / r + 0.5), get 1
```

| markets | eff | wood/ore -> gold | rare -> gold | gold -> wood/ore | gold -> rare | wood <-> ore, rare <-> rare | wood/ore -> rare | rare -> wood/ore |
|---|---|---|---|---|---|---|---|---|
| 1 | 10% | 25 | 50 | 2500 | 5000 | 10 : 1 | 20 : 1 | 5 : 1 |
| 2 | 15% | 38 | 75 | 1667 | 3333 | 7 : 1 | 13 : 1 | 3 : 1 |
| 3 | 20% | 50 | 100 | 1250 | 2500 | 5 : 1 | 10 : 1 | 3 : 1 |
| 4 | 25% | 63 | 125 | 1000 | 2000 | 4 : 1 | 8 : 1 | 2 : 1 |
| 5 | 30% | 75 | 150 | 833 | 1667 | 3 : 1 | 7 : 1 | 2 : 1 |
| 6 | 35% | 88 | 175 | 714 | 1429 | 3 : 1 | 6 : 1 | 1 : 1 |
| 7 | 40% | 100 | 200 | 625 | 1250 | 3 : 1 | 5 : 1 | 1 : 1 |
| 8 | 45% | 113 | 225 | 556 | 1111 | 2 : 1 | 4 : 1 | 1 : 1 |
| 9+ | 50% | 125 | 250 | 500 | 1000 | 2 : 1 | 4 : 1 | 1 : 1 |

(Columns "-> gold" are gold received per unit; "gold ->" are gold paid per unit; ratios are give : get.)
A trade of `k` lots gives `k * give` and receives `k * get`. Sending resources to another player is free
and 1:1. Trading is unlimited per day.

### Freelancer's Guild (`freelancerRate(creatureGoldCost, to, markets)`)

Same give/get formula with `r = creature.cost.gold` (per creature), but the efficiency is the original's
**table** `FREELANCER_EFFICIENCY[min(markets, 8)]` = 30 / 45 / 50 / 65 / 70 / 85 / 90 / 100 % for 1..8+
marketplaces (not `(n+1)/20`). E.g. one 3000-gold creature with one market gives 900 gold; 14 Pikemen
(60 gold) buy 1 wood. The adventure-map Freelancer's Guild counts as 5 markets (70 %). The last stack of
a hero's army cannot be sold. `markets` counts marketplaces as above. `ceil` ignores floating-point
noise (`300 gold x 70 % = 210`, not 211).

### Artifact Merchants (`artifactBuyPrice`, `artifactSellPrice`)

```
eff  = min((markets + 3) / 20, 0.6)
buy:  price = max(1, floor((artifact.cost / eff) / r + 0.5)),  r = value[res] (halved for non-gold)
sell: gain  = max(1, floor(artifact.cost * eff / value[res] + 0.5))
```

Stock: `ARTIFACT_MERCHANT_SLOTS` = 3 treasure, 3 minor, 1 major. As in the original **all Artifact
Merchants of the game share one stock** (`state.townMerchants = {stock, rolledOn}`, `getMerchantStock`):
rolled when the first Merchants appear and re-rolled once on day 1 of every month; a bought slot is
empty in every town until the re-roll. Only a visiting hero can buy (goes
to backpack) or sell (any artifact except spellbook, war machines, Grail and combination parts in use).

### Blacksmith

`sells_war_machine {machineId, cost}`: ballista 2500, ammo cart 1000, first aid tent 750, cannon 4000
(`WAR_MACHINE_COST`). A visiting hero can buy one if the matching war-machine slot is empty.

### Tavern

- Each player has a pool of `TAVERN_POOL_SIZE = 2` heroes (`player.tavernHeroes`), shared by all of his
  taverns. Hiring costs `TAVERN_HERO_COST = 2500` gold, requires no visiting hero in the town (the new
  hero appears as visiting hero) and fewer than `MAX_HEROES_PER_PLAYER` heroes.
- Initial pool: one hero of the player's faction (a class of his starting faction) + one random hero.
- Refresh on day 1 of each week: both slots re-rolled from heroes not in play and not in another
  player's pool; slot 0 prefers the player's faction. A hired slot is refilled at once with a random free
  hero (original behaviour).
- A hero who retreated or surrendered goes into his owner's pool slot 1 (keeping level, skills,
  artifacts only when surrendered) and can be re-hired until the next weekly refresh.
- Tavern heroes start with a 1-stack army of their class's tier-1 creature unless they are the
  first-day starting heroes (full `startArmy`).

### Shipyard

`shipyard {cost: BOAT_COST = 1000 gold + 10 wood}`. Places a boat on a free water tile adjacent to the
town (deterministic order: clockwise from the tile below the entrance). Fails with `no_free_water` when
all are occupied, `boat_exists` when a boat already sits on the spawn tile. Available to castle,
necropolis, fortress, conflux, cove, and only if the town is adjacent to water.

### Skeleton Transformer

`SKELETON_TRANSFORMER`: every creature becomes `skeleton` 1:1, except `dragonIds` (creatures of
"dragon nature": green, gold, red, black, bone, ghost, faerie, rust, crystal, azure dragons) which become
`bone_dragon` 1:1. Hydras are not dragons and become skeletons. Skeletons, skeleton warriors and bone dragons themselves cannot be
transformed (no-op rejected with `nothing_to_transform`). War machines are not creatures. Free of charge.

### Portal of Summoning

Each week (day 1) the town picks, with state rng, one external dwelling flagged by the owner on the
adventure map; `town.portal = { creatureId, count }` with `count = creature.growth` (base growth, no
bonuses). The creatures are recruited at normal cost from the town screen. No flagged dwellings: the
portal is empty. The pick is re-rolled on capture of the town.

### Castle Gate

A visiting hero may teleport to another town of the same owner that has `inferno_castle_gate` and no
visiting hero. Costs no movement.

### Magic University

`teach_skill {skills: [air_magic, earth_magic, fire_magic, water_magic], cost: 2000}`: visiting hero
without the skill and with a free skill slot buys it at Basic level.

### Grotto (Cove)

`sacrifice_altar`: creatures give `creature.hp * count` experience, artifacts give `artifact.cost / 2`
(simplified Altar of Sacrifice; both kinds allowed for every alignment).

## 8. Siege features

`CombatInput.siege = { fortLevel, faction, buildings }` is built from the town's `siege_defense` effect
(no fort => `siege: null`, ordinary battlefield) and `faction.siege`.

| level | building | walls | gate | keep (central tower) | side turrets | moat |
|---|---|---|---|---|---|---|
| 1 | fort | 4 sections, 2 hp | 2 hp | - | - | - |
| 2 | citadel | 4 sections, 2 hp | 2 hp | yes | - | yes |
| 3 | castle | 4 sections, 3 hp | 2 hp | yes | 2 | yes |

- Wall section state: hp 3/2 = intact (2 = "damaged" look for castle walls), 1 = damaged, 0 = destroyed
  (passable). Catapult damage per hit is 1 or 2 depending on Ballistics (combat agent). The gate opens for
  the defender; destroyed gate is passable for both.
- **Arrow towers** shoot once per round at the start of the round (keep first), choosing the target as
  the combat AI would (highest threat); no range or wall penalty, unlimited shots. Let
  `n = town.buildings.length` (replaced buildings are not counted):
  - keep: damage `10 + 2n` .. `15 + 3n`
  - each side turret: damage `6 + n` .. `9 + 2n`
  - towers attack with attack skill 10 (+ the defending hero's Attack is *not* added); target defense and
    Armorer / Air Shield apply normally. A tower is destroyed by the catapult (2 hp each).
  (The original formula is of this shape; exact coefficients are our choice.)
- **Moat** (`faction.siege.moat`, level >= 2): the hex column in front of the walls. A stack entering a
  moat hex stops there and takes `damage` (70 or 90); it takes the damage again at the start of each of
  its turns spent in the moat, and has -3 defense while standing in it. Defender's stacks are affected
  too. Flyers passing over are unaffected.
- **Tower**: no moat; at level >= 2, `mines.count` hidden land mines are placed randomly in front of the
  walls, each dealing `mines.damage` fire damage once (invisible to the attacker; defender's stacks do not
  trigger them).
- Defender bonuses: `garrison_bonus` effects (section 3). Without `escape_tunnel` the defending hero
  cannot retreat/surrender when `fortLevel >= 1`.
- Capturing a town: owner changes, the attacker's hero
  becomes visiting hero; a Capitol is downgraded if the captor already owns one; `reveal_map` and
  mage-guild learning apply for the new owner; `builtThisTurn` is kept.

## 9. Build trees (generated from data)

Costs of the nine original towns follow the original where the author could recall them exactly
(all values spot-checked in the test file are exact). Known approximations / inventions:
- Upgraded-dwelling extra prerequisites are simplified (only the best known ones are kept, e.g. Upg. Mage
  Tower needs the Library, Upg. Estate needs the Necromancy Amplifier, Upg. Dragon Cliffs/Cave need Mage
  Guild 3).
- Conflux dwelling costs are approximate.
- Cove: building names follow HotA; all costs, horde values and the Pub/Grotto/Lodestar effects are
  approximations. Cove's blacksmith sells the `cannon`.
- Factory: creature lineup follows HotA; dwelling names, costs, special buildings (Mana Generator, Bank,
  Proving Grounds, Burrows, Stockyard) and the grail (Perpetual Engine) are inventions in the spirit of
  the town. Silo resource (mercury) and blacksmith stock are assumptions.
- Conflux blacksmith (ballista) is from memory and may be First Aid Tent in the original.
- Town names: original-style; only some are verbatim from the original lists.

### Common

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `village_hall` | Village Hall | hall | free | - | - | `resource_income` {resource:gold,value:500} |
| `town_hall` | Town Hall | hall | 2500 gold | `village_hall`, `tavern` | `village_hall` | `resource_income` {resource:gold,value:1000} |
| `city_hall` | City Hall | hall | 5000 gold | `town_hall`, `marketplace`, `blacksmith`, `mage_guild_1` | `town_hall` | `resource_income` {resource:gold,value:2000} |
| `capitol` | Capitol | hall | 10000 gold | `city_hall`, `castle` | `city_hall` | `resource_income` {resource:gold,value:4000} |
| `fort` | Fort | fort | 5000 gold, 20 wood, 20 ore | - | - | `siege_defense` {fortLevel:1,wallHp:2,gateHp:2,keep:false,turrets:0,moat:false} |
| `citadel` | Citadel | fort | 2500 gold, 5 ore | `fort` | `fort` | `siege_defense` {fortLevel:2,wallHp:2,gateHp:2,keep:true,turrets:0,moat:true}; `growth_percent` {percent:50} |
| `castle` | Castle | fort | 5000 gold, 10 wood, 10 ore | `citadel` | `citadel` | `siege_defense` {fortLevel:3,wallHp:3,gateHp:2,keep:true,turrets:2,moat:true}; `growth_percent` {percent:100} |
| `tavern` | Tavern | tavern | 500 gold, 5 wood | - | - | `recruit_heroes` {cost:2500,pool:2}; `thieves_guild` {value:1}; `garrison_bonus` {stat:morale,value:1} |
| `blacksmith` | Blacksmith | blacksmith | 1000 gold, 5 wood | - | - | - |
| `marketplace` | Marketplace | market | 500 gold, 5 wood | - | - | `trade_resources` |
| `resource_silo` | Resource Silo | silo | 5000 gold, 5 ore | `marketplace` | - | - |
| `mage_guild_1` | Mage Guild Level 1 | mage_guild | 2000 gold, 5 wood, 5 ore | - | - | `mage_guild` {level:1}; `mana_restore` |
| `mage_guild_2` | Mage Guild Level 2 | mage_guild | 1000 gold, 5 wood, 5 ore, 4 mercury, 4 sulfur, 4 crystal, 4 gems | `mage_guild_1` | `mage_guild_1` | `mage_guild` {level:2}; `mana_restore` |
| `mage_guild_3` | Mage Guild Level 3 | mage_guild | 1000 gold, 5 wood, 5 ore, 6 mercury, 6 sulfur, 6 crystal, 6 gems | `mage_guild_2` | `mage_guild_2` | `mage_guild` {level:3}; `mana_restore` |
| `mage_guild_4` | Mage Guild Level 4 | mage_guild | 1000 gold, 5 wood, 5 ore, 8 mercury, 8 sulfur, 8 crystal, 8 gems | `mage_guild_3` | `mage_guild_3` | `mage_guild` {level:4}; `mana_restore` |
| `mage_guild_5` | Mage Guild Level 5 | mage_guild | 1000 gold, 5 wood, 5 ore, 10 mercury, 10 sulfur, 10 crystal, 10 gems | `mage_guild_4` | `mage_guild_4` | `mage_guild` {level:5}; `mana_restore` |
| `shipyard` | Shipyard | shipyard | 2000 gold, 20 wood | - | - | `shipyard` {cost:{gold:1000,wood:10}} |

### Castle

Blacksmith: ballista. Silo: +1 wood, +1 ore / day. Mage guild max 4. Shipyard: yes. Total buildings available: 35.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `castle_dwelling_1` | Guardhouse | dwelling | 500 gold, 10 ore | `fort` | - | pikeman |
| `castle_dwelling_1_up` | Upg. Guardhouse | dwelling | 1000 gold, 5 ore | `castle_dwelling_1` | `castle_dwelling_1` | halberdier |
| `castle_dwelling_2` | Archers' Tower | dwelling | 1000 gold, 5 wood, 5 ore | `castle_dwelling_1` | - | archer |
| `castle_dwelling_2_up` | Upg. Archers' Tower | dwelling | 1000 gold, 5 wood, 5 ore | `castle_dwelling_2` | `castle_dwelling_2` | marksman |
| `castle_dwelling_3` | Griffin Tower | dwelling | 1000 gold, 5 ore | `castle_dwelling_4` | - | griffin |
| `castle_dwelling_3_up` | Upg. Griffin Tower | dwelling | 1000 gold, 5 ore | `castle_dwelling_3` | `castle_dwelling_3` | royal_griffin |
| `castle_dwelling_4` | Barracks | dwelling | 2000 gold, 5 ore | `castle_dwelling_1`, `blacksmith` | - | swordsman |
| `castle_dwelling_4_up` | Upg. Barracks | dwelling | 2000 gold, 5 ore, 5 crystal | `castle_dwelling_4` | `castle_dwelling_4` | crusader |
| `castle_dwelling_5` | Monastery | dwelling | 3000 gold, 5 wood, 5 ore, 2 mercury, 2 sulfur, 2 crystal, 2 gems | `castle_dwelling_4`, `mage_guild_1` | - | monk |
| `castle_dwelling_5_up` | Upg. Monastery | dwelling | 1000 gold, 2 wood, 2 ore, 2 mercury, 2 sulfur, 2 crystal, 2 gems | `castle_dwelling_5` | `castle_dwelling_5` | zealot |
| `castle_dwelling_6` | Training Grounds | dwelling | 5000 gold, 20 wood | `castle_stables` | - | cavalier |
| `castle_dwelling_6_up` | Upg. Training Grounds | dwelling | 3000 gold, 10 wood | `castle_dwelling_6` | `castle_dwelling_6` | champion |
| `castle_dwelling_7` | Portal of Glory | dwelling | 20000 gold, 10 mercury, 10 sulfur, 10 crystal, 10 gems | `castle_dwelling_5` | - | angel |
| `castle_dwelling_7_up` | Upg. Portal of Glory | dwelling | 20000 gold, 10 mercury, 10 sulfur, 10 crystal, 10 gems | `castle_dwelling_7` | `castle_dwelling_7` | archangel |
| `castle_lighthouse` | Lighthouse | special | 2000 gold, 10 ore | `shipyard` | - | `player_hero_bonus` {bonus:{type:movement_sea,value:500}} |
| `castle_griffin_bastion` | Griffin Bastion | horde | 1000 gold | `castle_dwelling_3` | - | `creature_growth` {tier:3,creatureIds:[griffin,royal_griffin],value:3} |
| `castle_stables` | Stables | special | 2000 gold, 10 wood | `castle_dwelling_4` | - | `visit_temp_bonus` {bonus:{type:movement_land,value:400},until:end_of_week} |
| `castle_brotherhood_of_the_sword` | Brotherhood of the Sword | special | 500 gold, 5 wood | `tavern` | - | `garrison_bonus` {stat:morale,value:1} |
| `castle_grail` | Colossus | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `player_hero_bonus` {bonus:{type:morale,value:2}} |

### Rampart

Blacksmith: first_aid_tent. Silo: +1 crystal / day. Mage guild max 5. Shipyard: no. Total buildings available: 36.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `rampart_dwelling_1` | Centaur Stables | dwelling | 500 gold, 10 wood | `fort` | - | centaur |
| `rampart_dwelling_1_up` | Upg. Centaur Stables | dwelling | 1000 gold, 5 wood | `rampart_dwelling_1` | `rampart_dwelling_1` | centaur_captain |
| `rampart_dwelling_2` | Dwarf Cottage | dwelling | 1000 gold, 5 wood | `rampart_dwelling_1` | - | dwarf |
| `rampart_dwelling_2_up` | Upg. Dwarf Cottage | dwelling | 1000 gold, 5 wood | `rampart_dwelling_2` | `rampart_dwelling_2` | battle_dwarf |
| `rampart_dwelling_3` | Homestead | dwelling | 1500 gold, 10 wood | `rampart_dwelling_1` | - | wood_elf |
| `rampart_dwelling_3_up` | Upg. Homestead | dwelling | 1500 gold, 10 wood | `rampart_dwelling_3` | `rampart_dwelling_3` | grand_elf |
| `rampart_dwelling_4` | Enchanted Spring | dwelling | 2000 gold, 10 crystal | `rampart_dwelling_3` | - | pegasus |
| `rampart_dwelling_4_up` | Upg. Enchanted Spring | dwelling | 2000 gold, 5 crystal | `rampart_dwelling_4` | `rampart_dwelling_4` | silver_pegasus |
| `rampart_dwelling_5` | Dendroid Arches | dwelling | 2500 gold | `rampart_dwelling_3` | - | dendroid_guard |
| `rampart_dwelling_5_up` | Upg. Dendroid Arches | dwelling | 1500 gold | `rampart_dwelling_5` | `rampart_dwelling_5` | dendroid_soldier |
| `rampart_dwelling_6` | Unicorn Glade | dwelling | 4000 gold, 5 wood, 5 ore, 10 gems | `rampart_dwelling_4`, `rampart_dwelling_5` | - | unicorn |
| `rampart_dwelling_6_up` | Upg. Unicorn Glade | dwelling | 3000 gold, 5 gems | `rampart_dwelling_6` | `rampart_dwelling_6` | war_unicorn |
| `rampart_dwelling_7` | Dragon Cliffs | dwelling | 10000 gold, 30 ore, 20 crystal | `rampart_dwelling_6`, `mage_guild_2` | - | green_dragon |
| `rampart_dwelling_7_up` | Upg. Dragon Cliffs | dwelling | 20000 gold, 30 ore, 20 crystal | `rampart_dwelling_7`, `mage_guild_3` | `rampart_dwelling_7` | gold_dragon |
| `rampart_mystic_pond` | Mystic Pond | special | 2000 gold, 2 wood, 2 ore, 2 mercury, 2 sulfur, 2 crystal, 2 gems | - | - | `weekly_resource_random` {min:1,max:4,resources:[mercury,sulfur,crystal,gems]} |
| `rampart_fountain_of_fortune` | Fountain of Fortune | special | 1500 gold, 10 crystal | `rampart_mystic_pond` | - | `garrison_bonus` {stat:luck,value:2} |
| `rampart_miners_guild` | Miners' Guild | horde | 1000 gold | `rampart_dwelling_2` | - | `creature_growth` {tier:2,creatureIds:[dwarf,battle_dwarf],value:4} |
| `rampart_dwarven_treasury` | Dwarven Treasury | special | 5000 gold, 5 wood | `rampart_miners_guild` | - | `gold_interest` {percent:10} |
| `rampart_dendroid_saplings` | Dendroid Saplings | horde | 2000 gold | `rampart_dwelling_5` | - | `creature_growth` {tier:5,creatureIds:[dendroid_guard,dendroid_soldier],value:2} |
| `rampart_grail` | Spirit Guardian | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `player_hero_bonus` {bonus:{type:luck,value:2}} |

### Tower

Blacksmith: ammo_cart. Silo: +1 gems / day. Mage guild max 5. Shipyard: no. Total buildings available: 36.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `tower_dwelling_1` | Workshop | dwelling | 300 gold, 5 wood, 5 ore | `fort` | - | gremlin |
| `tower_dwelling_1_up` | Upg. Workshop | dwelling | 1000 gold, 5 wood | `tower_dwelling_1` | `tower_dwelling_1` | master_gremlin |
| `tower_dwelling_2` | Parapet | dwelling | 1000 gold, 10 ore | `tower_dwelling_1` | - | stone_gargoyle |
| `tower_dwelling_2_up` | Upg. Parapet | dwelling | 1500 gold, 5 ore | `tower_dwelling_2` | `tower_dwelling_2` | obsidian_gargoyle |
| `tower_dwelling_3` | Golem Factory | dwelling | 2000 gold, 5 wood, 5 ore | `tower_dwelling_1` | - | stone_golem |
| `tower_dwelling_3_up` | Upg. Golem Factory | dwelling | 2000 gold, 5 wood, 5 ore, 5 mercury | `tower_dwelling_3` | `tower_dwelling_3` | iron_golem |
| `tower_dwelling_4` | Mage Tower | dwelling | 2500 gold, 5 wood, 5 ore, 5 mercury, 5 sulfur, 5 crystal, 5 gems | `tower_dwelling_2`, `tower_dwelling_3`, `mage_guild_1` | - | mage |
| `tower_dwelling_4_up` | Upg. Mage Tower | dwelling | 2000 gold, 5 wood | `tower_dwelling_4`, `tower_library` | `tower_dwelling_4` | arch_mage |
| `tower_dwelling_5` | Altar of Wishes | dwelling | 3000 gold, 5 wood, 5 ore, 6 crystal, 6 gems | `tower_dwelling_4` | - | genie |
| `tower_dwelling_5_up` | Upg. Altar of Wishes | dwelling | 2000 gold, 5 wood | `tower_dwelling_5` | `tower_dwelling_5` | master_genie |
| `tower_dwelling_6` | Golden Pavilion | dwelling | 4000 gold, 5 wood, 5 ore, 2 mercury, 2 sulfur, 2 crystal, 2 gems | `tower_dwelling_4` | - | naga |
| `tower_dwelling_6_up` | Upg. Golden Pavilion | dwelling | 3000 gold, 5 wood, 5 ore, 3 mercury, 3 sulfur, 3 crystal, 3 gems | `tower_dwelling_6` | `tower_dwelling_6` | naga_queen |
| `tower_dwelling_7` | Cloud Temple | dwelling | 5000 gold, 10 wood, 10 ore, 10 gems | `tower_dwelling_5`, `tower_dwelling_6` | - | giant |
| `tower_dwelling_7_up` | Upg. Cloud Temple | dwelling | 25000 gold, 5 wood, 5 ore, 30 gems | `tower_dwelling_7` | `tower_dwelling_7` | titan |
| `tower_library` | Library | special | 1500 gold, 5 wood, 5 ore, 5 mercury, 5 sulfur, 5 crystal, 5 gems | `mage_guild_1` | - | `library_extra_spell` {value:1} |
| `tower_lookout_tower` | Lookout Tower | special | 1000 gold, 5 wood | `fort` | - | `reveal_map` {radius:20} |
| `tower_wall_of_knowledge` | Wall of Knowledge | special | 1000 gold, 5 ore | `mage_guild_1` | - | `visit_bonus` {stat:knowledge,value:1} |
| `tower_artifact_merchants` | Artifact Merchants | market | 10000 gold | `marketplace` | - | `sells_artifacts` {slots:[treasure,treasure,treasure,minor,minor,minor,major]} |
| `tower_sculptors_wings` | Sculptor's Wings | horde | 1000 gold | `tower_dwelling_2` | - | `creature_growth` {tier:2,creatureIds:[stone_gargoyle,obsidian_gargoyle],value:4} |
| `tower_grail` | Skyship | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `reveal_map` {all:true}; `garrison_bonus` {stat:knowledge,value:15} |

### Inferno

Blacksmith: ammo_cart. Silo: +1 mercury / day. Mage guild max 5. Shipyard: no. Total buildings available: 36.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `inferno_dwelling_1` | Imp Crucible | dwelling | 300 gold, 5 wood, 5 ore | `fort` | - | imp |
| `inferno_dwelling_1_up` | Upg. Imp Crucible | dwelling | 1000 gold, 5 mercury | `inferno_dwelling_1` | `inferno_dwelling_1` | familiar |
| `inferno_dwelling_2` | Hall of Sins | dwelling | 1000 gold, 5 ore | `inferno_dwelling_1` | - | gog |
| `inferno_dwelling_2_up` | Upg. Hall of Sins | dwelling | 1000 gold, 5 mercury | `inferno_dwelling_2` | `inferno_dwelling_2` | magog |
| `inferno_dwelling_3` | Kennels | dwelling | 1500 gold, 10 wood | `inferno_dwelling_1` | - | hell_hound |
| `inferno_dwelling_3_up` | Upg. Kennels | dwelling | 1500 gold, 5 sulfur | `inferno_dwelling_3` | `inferno_dwelling_3` | cerberus |
| `inferno_dwelling_4` | Demon Gate | dwelling | 2000 gold, 5 wood, 5 ore | `inferno_dwelling_2` | - | demon |
| `inferno_dwelling_4_up` | Upg. Demon Gate | dwelling | 2000 gold, 5 wood, 5 ore | `inferno_dwelling_4` | `inferno_dwelling_4` | horned_demon |
| `inferno_dwelling_5` | Hell Hole | dwelling | 3000 gold | `inferno_dwelling_4` | - | pit_fiend |
| `inferno_dwelling_5_up` | Upg. Hell Hole | dwelling | 3000 gold, 5 mercury, 5 sulfur | `inferno_dwelling_5`, `mage_guild_2` | `inferno_dwelling_5` | pit_lord |
| `inferno_dwelling_6` | Fire Lake | dwelling | 4000 gold, 10 ore, 3 mercury, 3 sulfur, 3 crystal, 3 gems | `inferno_dwelling_4`, `mage_guild_1` | - | efreet |
| `inferno_dwelling_6_up` | Upg. Fire Lake | dwelling | 3000 gold, 5 ore, 3 mercury, 3 sulfur, 3 crystal, 3 gems | `inferno_dwelling_6` | `inferno_dwelling_6` | efreet_sultan |
| `inferno_dwelling_7` | Forsaken Palace | dwelling | 15000 gold, 10 wood, 10 ore, 20 mercury, 20 sulfur | `inferno_dwelling_5`, `inferno_dwelling_6` | - | devil |
| `inferno_dwelling_7_up` | Upg. Forsaken Palace | dwelling | 20000 gold, 5 wood, 5 ore, 20 mercury, 20 sulfur | `inferno_dwelling_7` | `inferno_dwelling_7` | arch_devil |
| `inferno_castle_gate` | Castle Gate | special | 10000 gold, 5 wood, 5 ore | `citadel` | - | `town_gate` |
| `inferno_order_of_fire` | Order of Fire | special | 1000 gold, 5 wood | `mage_guild_1` | - | `visit_bonus` {stat:power,value:1} |
| `inferno_brimstone_stormclouds` | Brimstone Stormclouds | special | 1000 gold, 2 sulfur | `fort` | - | `garrison_bonus` {stat:power,value:2} |
| `inferno_birthing_pools` | Birthing Pools | horde | 1000 gold | `inferno_dwelling_1` | - | `creature_growth` {tier:1,creatureIds:[imp,familiar],value:8} |
| `inferno_cages` | Cages | horde | 1000 gold | `inferno_dwelling_3` | - | `creature_growth` {tier:3,creatureIds:[hell_hound,cerberus],value:3} |
| `inferno_grail` | Deity of Fire | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `week_of_creature` {creatureId:imp,growthBonus:15} |

### Necropolis

Blacksmith: first_aid_tent. Silo: +1 wood, +1 ore / day. Mage guild max 5. Shipyard: yes. Total buildings available: 36.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `necropolis_dwelling_1` | Cursed Temple | dwelling | 400 gold, 5 wood, 5 ore | `fort` | - | skeleton |
| `necropolis_dwelling_1_up` | Upg. Cursed Temple | dwelling | 1000 gold, 5 wood, 5 ore | `necropolis_dwelling_1` | `necropolis_dwelling_1` | skeleton_warrior |
| `necropolis_dwelling_2` | Graveyard | dwelling | 1000 gold, 5 ore | `necropolis_dwelling_1` | - | walking_dead |
| `necropolis_dwelling_2_up` | Upg. Graveyard | dwelling | 1000 gold, 5 wood, 5 ore | `necropolis_dwelling_2` | `necropolis_dwelling_2` | zombie |
| `necropolis_dwelling_3` | Tomb of Souls | dwelling | 1500 gold, 5 wood, 5 ore | `necropolis_dwelling_1` | - | wight |
| `necropolis_dwelling_3_up` | Upg. Tomb of Souls | dwelling | 1500 gold, 5 mercury | `necropolis_dwelling_3` | `necropolis_dwelling_3` | wraith |
| `necropolis_dwelling_4` | Estate | dwelling | 2000 gold, 5 wood, 5 ore | `necropolis_dwelling_2` | - | vampire |
| `necropolis_dwelling_4_up` | Upg. Estate | dwelling | 2000 gold, 5 wood, 10 crystal, 10 gems | `necropolis_dwelling_4`, `necropolis_necromancy_amplifier` | `necropolis_dwelling_4` | vampire_lord |
| `necropolis_dwelling_5` | Mausoleum | dwelling | 2000 gold, 10 ore, 10 sulfur | `necropolis_dwelling_2`, `mage_guild_1` | - | lich |
| `necropolis_dwelling_5_up` | Upg. Mausoleum | dwelling | 2000 gold, 5 ore, 5 sulfur | `necropolis_dwelling_5` | `necropolis_dwelling_5` | power_lich |
| `necropolis_dwelling_6` | Hall of Darkness | dwelling | 6000 gold, 10 wood, 10 ore | `necropolis_dwelling_4`, `necropolis_dwelling_5` | - | black_knight |
| `necropolis_dwelling_6_up` | Upg. Hall of Darkness | dwelling | 3000 gold, 5 wood, 5 ore, 2 mercury, 2 sulfur, 2 crystal, 2 gems | `necropolis_dwelling_6` | `necropolis_dwelling_6` | dread_knight |
| `necropolis_dwelling_7` | Dragon Vault | dwelling | 10000 gold, 5 wood, 5 ore, 5 mercury, 5 sulfur, 5 crystal, 5 gems | `necropolis_dwelling_6` | - | bone_dragon |
| `necropolis_dwelling_7_up` | Upg. Dragon Vault | dwelling | 15000 gold, 5 wood, 5 ore, 20 mercury | `necropolis_dwelling_7` | `necropolis_dwelling_7` | ghost_dragon |
| `necropolis_cover_of_darkness` | Cover of Darkness | special | 1000 gold | `fort` | - | `fog_cover` {radius:20} |
| `necropolis_necromancy_amplifier` | Necromancy Amplifier | special | 1000 gold | `mage_guild_1` | - | `necromancy_bonus` {percent:10} |
| `necropolis_skeleton_transformer` | Skeleton Transformer | special | 1000 gold | `necropolis_dwelling_1` | - | `skeleton_transform` |
| `necropolis_unearthed_graves` | Unearthed Graves | horde | 1000 gold | `necropolis_dwelling_1` | - | `creature_growth` {tier:1,creatureIds:[skeleton,skeleton_warrior],value:6} |
| `necropolis_grail` | Soul Prison | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `necromancy_bonus` {percent:20} |

### Dungeon

Blacksmith: ballista. Silo: +1 sulfur / day. Mage guild max 5. Shipyard: no. Total buildings available: 36.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `dungeon_dwelling_1` | Warren | dwelling | 400 gold, 10 wood | `fort` | - | troglodyte |
| `dungeon_dwelling_1_up` | Upg. Warren | dwelling | 1000 gold, 5 wood | `dungeon_dwelling_1` | `dungeon_dwelling_1` | infernal_troglodyte |
| `dungeon_dwelling_2` | Harpy Loft | dwelling | 1000 gold | `dungeon_dwelling_1` | - | harpy |
| `dungeon_dwelling_2_up` | Upg. Harpy Loft | dwelling | 1000 gold, 2 sulfur, 2 crystal | `dungeon_dwelling_2` | `dungeon_dwelling_2` | harpy_hag |
| `dungeon_dwelling_3` | Pillar of Eyes | dwelling | 1000 gold, 1 wood, 1 ore, 1 mercury, 1 sulfur, 1 crystal, 1 gems | `dungeon_dwelling_1` | - | beholder |
| `dungeon_dwelling_3_up` | Upg. Pillar of Eyes | dwelling | 1000 gold, 1 wood, 1 ore, 1 mercury, 1 sulfur, 1 crystal, 1 gems | `dungeon_dwelling_3` | `dungeon_dwelling_3` | evil_eye |
| `dungeon_dwelling_4` | Chapel of Stilled Voices | dwelling | 2000 gold, 5 wood, 10 ore | `dungeon_dwelling_2`, `dungeon_dwelling_3` | - | medusa |
| `dungeon_dwelling_4_up` | Upg. Chapel of Stilled Voices | dwelling | 1500 gold, 5 wood | `dungeon_dwelling_4` | `dungeon_dwelling_4` | medusa_queen |
| `dungeon_dwelling_5` | Labyrinth | dwelling | 4000 gold, 10 ore, 10 gems | `dungeon_dwelling_4` | - | minotaur |
| `dungeon_dwelling_5_up` | Upg. Labyrinth | dwelling | 3000 gold, 5 ore, 5 gems | `dungeon_dwelling_5` | `dungeon_dwelling_5` | minotaur_king |
| `dungeon_dwelling_6` | Manticore Lair | dwelling | 5000 gold, 5 wood, 5 ore, 5 mercury, 5 sulfur | `dungeon_dwelling_4` | - | manticore |
| `dungeon_dwelling_6_up` | Upg. Manticore Lair | dwelling | 3000 gold, 5 wood, 5 ore, 5 mercury, 5 sulfur | `dungeon_dwelling_6` | `dungeon_dwelling_6` | scorpicore |
| `dungeon_dwelling_7` | Dragon Cave | dwelling | 15000 gold, 15 wood, 15 ore, 20 sulfur | `dungeon_dwelling_5`, `dungeon_dwelling_6`, `mage_guild_2` | - | red_dragon |
| `dungeon_dwelling_7_up` | Upg. Dragon Cave | dwelling | 15000 gold, 15 wood, 15 ore, 20 sulfur | `dungeon_dwelling_7`, `mage_guild_3` | `dungeon_dwelling_7` | black_dragon |
| `dungeon_mana_vortex` | Mana Vortex | special | 1000 gold | `mage_guild_1` | - | `mana_double` |
| `dungeon_portal_of_summoning` | Portal of Summoning | special | 2500 gold, 5 ore | `fort` | - | `portal_of_summoning` |
| `dungeon_battle_scholar_academy` | Battle Scholar Academy | special | 1000 gold, 5 wood, 5 ore | - | - | `visit_bonus` {stat:experience,value:1000} |
| `dungeon_artifact_merchants` | Artifact Merchants | market | 10000 gold | `marketplace` | - | `sells_artifacts` {slots:[treasure,treasure,treasure,minor,minor,minor,major]} |
| `dungeon_mushroom_rings` | Mushroom Rings | horde | 1000 gold | `dungeon_dwelling_1` | - | `creature_growth` {tier:1,creatureIds:[troglodyte,infernal_troglodyte],value:7} |
| `dungeon_grail` | Guardian of Earth | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `garrison_bonus` {stat:power,value:12} |

### Stronghold

Blacksmith: ammo_cart. Silo: +1 wood, +1 ore / day. Mage guild max 3. Shipyard: no. Total buildings available: 34.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `stronghold_dwelling_1` | Goblin Barracks | dwelling | 200 gold, 5 wood, 5 ore | `fort` | - | goblin |
| `stronghold_dwelling_1_up` | Upg. Goblin Barracks | dwelling | 1000 gold, 5 wood, 5 ore | `stronghold_dwelling_1` | `stronghold_dwelling_1` | hobgoblin |
| `stronghold_dwelling_2` | Wolf Pen | dwelling | 1000 gold, 10 wood, 5 ore | `stronghold_dwelling_1` | - | wolf_rider |
| `stronghold_dwelling_2_up` | Upg. Wolf Pen | dwelling | 1000 gold, 5 wood, 5 ore | `stronghold_dwelling_2` | `stronghold_dwelling_2` | wolf_raider |
| `stronghold_dwelling_3` | Orc Tower | dwelling | 1000 gold, 5 wood, 5 ore | `stronghold_dwelling_1` | - | orc |
| `stronghold_dwelling_3_up` | Upg. Orc Tower | dwelling | 1000 gold, 2 wood, 2 ore | `stronghold_dwelling_3`, `blacksmith` | `stronghold_dwelling_3` | orc_chieftain |
| `stronghold_dwelling_4` | Ogre Fort | dwelling | 2000 gold, 20 wood | `stronghold_dwelling_3` | - | ogre |
| `stronghold_dwelling_4_up` | Upg. Ogre Fort | dwelling | 2000 gold, 5 wood, 5 ore, 5 gems | `stronghold_dwelling_4`, `mage_guild_1` | `stronghold_dwelling_4` | ogre_mage |
| `stronghold_dwelling_5` | Cliff Nest | dwelling | 2500 gold, 10 ore | `stronghold_dwelling_2` | - | roc |
| `stronghold_dwelling_5_up` | Upg. Cliff Nest | dwelling | 2000 gold, 5 ore | `stronghold_dwelling_5` | `stronghold_dwelling_5` | thunderbird |
| `stronghold_dwelling_6` | Cyclops Cave | dwelling | 3500 gold, 20 ore, 20 crystal | `stronghold_dwelling_4` | - | cyclops |
| `stronghold_dwelling_6_up` | Upg. Cyclops Cave | dwelling | 3000 gold, 5 ore, 5 crystal | `stronghold_dwelling_6` | `stronghold_dwelling_6` | cyclops_king |
| `stronghold_dwelling_7` | Behemoth Lair | dwelling | 10000 gold, 10 wood, 10 ore, 10 crystal | `stronghold_dwelling_5` | - | behemoth |
| `stronghold_dwelling_7_up` | Upg. Behemoth Lair | dwelling | 15000 gold, 10 wood, 10 ore, 20 crystal | `stronghold_dwelling_7` | `stronghold_dwelling_7` | ancient_behemoth |
| `stronghold_escape_tunnel` | Escape Tunnel | special | 2000 gold, 5 wood, 5 ore | `fort` | - | `escape_tunnel` |
| `stronghold_freelancers_guild` | Freelancer's Guild | market | 1000 gold | `marketplace` | - | `trade_creatures_for_resources` |
| `stronghold_ballista_yard` | Ballista Yard | blacksmith | 1000 gold, 5 wood | `blacksmith` | - | `sells_war_machine` {machineId:ballista,cost:2500} |
| `stronghold_hall_of_valhalla` | Hall of Valhalla | special | 1000 gold | `fort` | - | `visit_bonus` {stat:attack,value:1} |
| `stronghold_mess_hall` | Mess Hall | horde | 1000 gold | `stronghold_dwelling_1` | - | `creature_growth` {tier:1,creatureIds:[goblin,hobgoblin],value:8} |
| `stronghold_grail` | Warlords' Monument | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `garrison_bonus` {stat:attack,value:20} |

### Fortress

Blacksmith: first_aid_tent. Silo: +1 wood, +1 ore / day. Mage guild max 3. Shipyard: yes. Total buildings available: 34.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `fortress_dwelling_1` | Gnoll Hut | dwelling | 400 gold, 10 wood | `fort` | - | gnoll |
| `fortress_dwelling_1_up` | Upg. Gnoll Hut | dwelling | 1000 gold, 10 wood | `fortress_dwelling_1` | `fortress_dwelling_1` | gnoll_marauder |
| `fortress_dwelling_2` | Lizard Den | dwelling | 1000 gold, 5 wood | `fortress_dwelling_1` | - | lizardman |
| `fortress_dwelling_2_up` | Upg. Lizard Den | dwelling | 1000 gold, 5 wood | `fortress_dwelling_2` | `fortress_dwelling_2` | lizard_warrior |
| `fortress_dwelling_3` | Serpent Fly Hive | dwelling | 1000 gold, 5 wood, 2 mercury, 2 sulfur | `fortress_dwelling_1` | - | serpent_fly |
| `fortress_dwelling_3_up` | Upg. Serpent Fly Hive | dwelling | 1000 gold, 2 mercury, 2 sulfur | `fortress_dwelling_3` | `fortress_dwelling_3` | dragon_fly |
| `fortress_dwelling_4` | Basilisk Pit | dwelling | 2000 gold, 5 wood, 10 ore | `fortress_dwelling_3` | - | basilisk |
| `fortress_dwelling_4_up` | Upg. Basilisk Pit | dwelling | 2000 gold, 5 wood, 5 ore | `fortress_dwelling_4` | `fortress_dwelling_4` | greater_basilisk |
| `fortress_dwelling_5` | Gorgon Lair | dwelling | 2500 gold, 10 wood, 5 mercury, 5 sulfur | `fortress_dwelling_2`, `fortress_dwelling_3` | - | gorgon |
| `fortress_dwelling_5_up` | Upg. Gorgon Lair | dwelling | 2000 gold, 5 wood, 5 mercury, 5 sulfur | `fortress_dwelling_5`, `resource_silo` | `fortress_dwelling_5` | mighty_gorgon |
| `fortress_dwelling_6` | Wyvern Nest | dwelling | 3500 gold, 15 wood | `fortress_dwelling_2` | - | wyvern |
| `fortress_dwelling_6_up` | Upg. Wyvern Nest | dwelling | 3000 gold, 10 wood, 10 mercury | `fortress_dwelling_6` | `fortress_dwelling_6` | wyvern_monarch |
| `fortress_dwelling_7` | Hydra Pond | dwelling | 10000 gold, 10 wood, 10 ore, 10 sulfur | `fortress_dwelling_4`, `fortress_dwelling_6` | - | hydra |
| `fortress_dwelling_7_up` | Upg. Hydra Pond | dwelling | 15000 gold, 10 wood, 10 ore, 20 sulfur | `fortress_dwelling_7` | `fortress_dwelling_7` | chaos_hydra |
| `fortress_cage_of_warlords` | Cage of Warlords | special | 1000 gold | `fort` | - | `visit_bonus` {stat:defense,value:1} |
| `fortress_glyphs_of_fear` | Glyphs of Fear | special | 1000 gold | `fort` | - | `garrison_bonus` {stat:defense,value:2} |
| `fortress_blood_obelisk` | Blood Obelisk | special | 1000 gold | `fortress_glyphs_of_fear` | - | `garrison_bonus` {stat:attack,value:2} |
| `fortress_captains_quarters` | Captain's Quarters | horde | 1000 gold | `fortress_dwelling_1` | - | `creature_growth` {tier:1,creatureIds:[gnoll,gnoll_marauder],value:6} |
| `fortress_grail` | Carnivorous Plant | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `garrison_bonus` {stat:attack,value:10}; `garrison_bonus` {stat:defense,value:10} |

### Conflux

Blacksmith: ballista. Silo: +1 mercury / day. Mage guild max 5. Shipyard: yes. Total buildings available: 35.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `conflux_dwelling_1` | Magic Lantern | dwelling | 300 gold, 5 wood, 5 ore | `fort` | - | pixie |
| `conflux_dwelling_1_up` | Upg. Magic Lantern | dwelling | 1000 gold, 5 wood, 5 ore | `conflux_dwelling_1` | `conflux_dwelling_1` | sprite |
| `conflux_dwelling_2` | Altar of Air | dwelling | 1500 gold, 5 ore | `conflux_dwelling_1`, `mage_guild_1` | - | air_elemental |
| `conflux_dwelling_2_up` | Upg. Altar of Air | dwelling | 1500 gold, 2 ore, 2 mercury | `conflux_dwelling_2` | `conflux_dwelling_2` | storm_elemental |
| `conflux_dwelling_3` | Altar of Water | dwelling | 1500 gold, 5 ore | `conflux_dwelling_1`, `mage_guild_1` | - | water_elemental |
| `conflux_dwelling_3_up` | Upg. Altar of Water | dwelling | 2000 gold, 5 ore, 5 mercury | `conflux_dwelling_3` | `conflux_dwelling_3` | ice_elemental |
| `conflux_dwelling_4` | Altar of Fire | dwelling | 2000 gold, 5 wood, 5 ore | `conflux_dwelling_2` | - | fire_elemental |
| `conflux_dwelling_4_up` | Upg. Altar of Fire | dwelling | 2000 gold, 5 wood, 5 ore, 5 sulfur | `conflux_dwelling_4` | `conflux_dwelling_4` | energy_elemental |
| `conflux_dwelling_5` | Altar of Earth | dwelling | 2000 gold, 10 ore | `conflux_dwelling_3` | - | earth_elemental |
| `conflux_dwelling_5_up` | Upg. Altar of Earth | dwelling | 2000 gold, 5 ore, 5 crystal | `conflux_dwelling_5` | `conflux_dwelling_5` | magma_elemental |
| `conflux_dwelling_6` | Altar of Thought | dwelling | 3000 gold, 5 wood, 5 ore, 2 mercury, 2 sulfur, 2 crystal, 2 gems | `conflux_dwelling_4`, `conflux_dwelling_5` | - | psychic_elemental |
| `conflux_dwelling_6_up` | Upg. Altar of Thought | dwelling | 3000 gold, 5 wood, 5 ore, 3 mercury, 3 sulfur, 3 crystal, 3 gems | `conflux_dwelling_6` | `conflux_dwelling_6` | magic_elemental |
| `conflux_dwelling_7` | Pyre | dwelling | 10000 gold, 10 wood, 10 ore, 10 mercury | `conflux_dwelling_6` | - | firebird |
| `conflux_dwelling_7_up` | Upg. Pyre | dwelling | 15000 gold, 10 wood, 10 ore, 20 mercury | `conflux_dwelling_7` | `conflux_dwelling_7` | phoenix |
| `conflux_magic_university` | Magic University | special | 5000 gold, 10 wood, 10 ore | `mage_guild_1` | - | `teach_skill` {skills:[air_magic,earth_magic,fire_magic,water_magic],cost:2000} |
| `conflux_garden_of_life` | Garden of Life | horde | 1000 gold | `conflux_dwelling_1` | - | `creature_growth` {tier:1,creatureIds:[pixie,sprite],value:10} |
| `conflux_artifact_merchants` | Artifact Merchants | market | 10000 gold | `marketplace` | - | `sells_artifacts` {slots:[treasure,treasure,treasure,minor,minor,minor,major]} |
| `conflux_grail` | Aurora Borealis | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `all_spells` |

### Cove

Blacksmith: cannon. Silo: +1 wood, +1 ore / day. Mage guild max 4. Shipyard: yes. Total buildings available: 35.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `cove_dwelling_1` | Nymph Waterfall | dwelling | 400 gold, 10 wood | `fort` | - | nymph |
| `cove_dwelling_1_up` | Upg. Nymph Waterfall | dwelling | 1000 gold, 5 wood | `cove_dwelling_1` | `cove_dwelling_1` | oceanid |
| `cove_dwelling_2` | Shack | dwelling | 1000 gold, 5 wood, 5 ore | `cove_dwelling_1` | - | crew_mate |
| `cove_dwelling_2_up` | Upg. Shack | dwelling | 1000 gold, 5 wood, 5 ore | `cove_dwelling_2` | `cove_dwelling_2` | seaman |
| `cove_dwelling_3` | Frigate | dwelling | 1500 gold, 10 wood | `cove_dwelling_2`, `tavern` | - | pirate |
| `cove_dwelling_3_up` | Upg. Frigate | dwelling | 2000 gold, 5 wood, 5 sulfur | `cove_dwelling_3`, `blacksmith` | `cove_dwelling_3` | corsair |
| `cove_dwelling_4` | Nest | dwelling | 2000 gold, 5 wood, 5 ore, 5 gems | `cove_dwelling_1` | - | stormbird |
| `cove_dwelling_4_up` | Upg. Nest | dwelling | 2000 gold, 5 gems | `cove_dwelling_4` | `cove_dwelling_4` | ayssid |
| `cove_dwelling_5` | Tower of the Seas | dwelling | 3000 gold, 5 wood, 5 ore, 3 mercury, 3 sulfur, 3 crystal, 3 gems | `cove_dwelling_3`, `mage_guild_1` | - | sea_witch |
| `cove_dwelling_5_up` | Upg. Tower of the Seas | dwelling | 2500 gold, 3 mercury, 3 sulfur, 3 crystal, 3 gems | `cove_dwelling_5` | `cove_dwelling_5` | sorceress |
| `cove_dwelling_6` | Nix Fort | dwelling | 5000 gold, 10 wood, 10 ore, 10 crystal | `cove_dwelling_3`, `cove_dwelling_4` | - | nix |
| `cove_dwelling_6_up` | Upg. Nix Fort | dwelling | 3000 gold, 5 wood, 5 ore, 5 crystal | `cove_dwelling_6` | `cove_dwelling_6` | nix_warrior |
| `cove_dwelling_7` | Maelstrom | dwelling | 12000 gold, 10 wood, 10 ore, 15 sulfur | `cove_dwelling_5`, `cove_dwelling_6` | - | sea_serpent |
| `cove_dwelling_7_up` | Upg. Maelstrom | dwelling | 18000 gold, 10 wood, 10 ore, 20 sulfur | `cove_dwelling_7` | `cove_dwelling_7` | haspid |
| `cove_pub` | Pub | tavern | 2000 gold, 5 wood | `tavern` | `tavern` | `recruit_heroes` {cost:2500,pool:2}; `thieves_guild` {value:3}; `garrison_bonus` {stat:morale,value:2} |
| `cove_grotto` | Grotto | special | 3000 gold, 5 wood, 5 ore | `marketplace` | - | `sacrifice_altar` {creatures:true,artifacts:true} |
| `cove_roost` | Roost | horde | 1500 gold, 5 wood | `cove_dwelling_4` | - | `creature_growth` {tier:4,creatureIds:[stormbird,ayssid],value:3} |
| `cove_gunpowder_warehouse` | Gunpowder Warehouse | horde | 1500 gold, 5 sulfur | `cove_dwelling_3`, `blacksmith` | - | `creature_growth` {tier:3,creatureIds:[pirate,corsair],value:4} |
| `cove_grail` | Lodestar | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `native_terrain_all` {faction:cove} |

### Factory

Blacksmith: ballista, ammo_cart, first_aid_tent. Silo: +1 mercury / day. Mage guild max 5. Shipyard: no. Total buildings available: 39.

| id | name | kind | cost | requires | replaces | creature / effects |
|---|---|---|---|---|---|---|
| `factory_dwelling_1` | Watchtower | dwelling | 400 gold, 5 wood, 5 ore | `fort` | - | halfling |
| `factory_dwelling_1_up` | Upg. Watchtower | dwelling | 1000 gold, 5 wood, 2 sulfur | `factory_dwelling_1` | `factory_dwelling_1` | halfling_grenadier |
| `factory_dwelling_2` | Foundry | dwelling | 1000 gold, 10 ore | `factory_dwelling_1` | - | mechanic |
| `factory_dwelling_2_up` | Upg. Foundry | dwelling | 1500 gold, 5 ore, 2 mercury | `factory_dwelling_2`, `blacksmith` | `factory_dwelling_2` | engineer |
| `factory_dwelling_3` | Ranch | dwelling | 1500 gold, 10 wood | `factory_dwelling_1` | - | armadillo |
| `factory_dwelling_3_up` | Upg. Ranch | dwelling | 1500 gold, 5 wood, 5 ore | `factory_dwelling_3` | `factory_dwelling_3` | bellwether_armadillo |
| `factory_dwelling_4` | Manufactory | dwelling | 2000 gold, 10 ore, 5 mercury | `factory_dwelling_2` | - | automaton |
| `factory_dwelling_4_up` | Upg. Manufactory | dwelling | 2500 gold, 5 ore, 5 mercury | `factory_dwelling_4` | `factory_dwelling_4` | sentinel_automaton |
| `factory_dwelling_5` | Wormery | dwelling | 3000 gold, 5 wood, 5 ore, 5 sulfur | `factory_dwelling_3` | - | sandworm |
| `factory_dwelling_5_up` | Upg. Wormery | dwelling | 3000 gold, 5 ore, 5 sulfur | `factory_dwelling_5` | `factory_dwelling_5` | olgoi_khorkhoi |
| `factory_dwelling_6` | Sheriff's Office | dwelling | 5000 gold, 10 wood, 10 ore, 5 sulfur, 5 gems | `factory_dwelling_4`, `tavern` | - | gunslinger |
| `factory_dwelling_6_up` | Upg. Sheriff's Office | dwelling | 3500 gold, 5 wood, 5 ore, 5 sulfur, 5 gems | `factory_dwelling_6` | `factory_dwelling_6` | bounty_hunter |
| `factory_dwelling_7` | Serpentarium | dwelling | 10000 gold, 10 wood, 10 ore, 10 crystal, 10 gems | `factory_dwelling_5`, `factory_dwelling_6`, `mage_guild_1` | - | couatl |
| `factory_dwelling_7_up` | Upg. Serpentarium | dwelling | 15000 gold, 5 wood, 5 ore, 15 crystal, 15 gems | `factory_dwelling_7` | `factory_dwelling_7` | crimson_couatl |
| `factory_dwelling_7_alt` | Gantry | dwelling | 12000 gold, 20 ore, 15 mercury | `factory_dwelling_4`, `factory_dwelling_6` | - | dreadnought |
| `factory_dwelling_7_alt_up` | Upg. Gantry | dwelling | 18000 gold, 20 ore, 20 mercury | `factory_dwelling_7_alt` | `factory_dwelling_7_alt` | juggernaut |
| `factory_mana_generator` | Mana Generator | special | 2000 gold, 5 ore, 5 mercury | `mage_guild_1` | - | `mana_double` |
| `factory_bank` | Bank | special | 4000 gold, 5 wood, 5 ore | `marketplace`, `town_hall` | - | `gold_interest` {percent:5} |
| `factory_artifact_merchants` | Artifact Merchants | market | 10000 gold | `marketplace` | - | `sells_artifacts` {slots:[treasure,treasure,treasure,minor,minor,minor,major]} |
| `factory_proving_grounds` | Proving Grounds | special | 2500 gold, 5 wood, 5 ore | `blacksmith`, `mage_guild_1` | - | `visit_bonus` {stat:attack,value:1}; `visit_bonus` {stat:knowledge,value:1} |
| `factory_burrows` | Burrows | horde | 1000 gold | `factory_dwelling_1` | - | `creature_growth` {tier:1,creatureIds:[halfling,halfling_grenadier],value:8} |
| `factory_stockyard` | Stockyard | horde | 1500 gold, 5 wood | `factory_dwelling_3` | - | `creature_growth` {tier:3,creatureIds:[armadillo,bellwether_armadillo],value:3} |
| `factory_grail` | Perpetual Engine | grail | free | - | - | `grail`; `resource_income` {resource:gold,value:5000}; `growth_percent` {percent:50,ofTotal:true}; `player_hero_bonus` {bonus:{type:mana_regen,value:3}}; `player_hero_bonus` {bonus:{type:morale,value:1}} |


## 10. Engine checklist

Data (done):
- [x] 11 factions with tiers, classes, names, siege data - `tests/data/towns.test.js`
- [x] building ids unique, requirement/replace references valid per faction, no cycles, all reachable - `tests/data/towns.test.js`
- [x] 14 dwellings per faction (+2 alt for Factory) matching faction tiers - `tests/data/towns.test.js`
- [x] hall / fort / mage guild chains, costs, per-faction caps - `tests/data/towns.test.js`
- [x] closed effect set, every type used and well-formed - `tests/data/towns.test.js`
- [x] grails, hordes, special buildings, spot-checked costs - `tests/data/towns.test.js`
- [x] marketplace / freelancer / artifact merchant rate helpers - `tests/data/towns.test.js`
- [x] starting building sets valid, rule constants - `tests/data/towns.test.js`
- [x] original SoD values pinned independently (costs, prerequisites, hordes, grails, trade tables, starting resources) - `tests/data/towns-original.test.js` (audit: `docs/audit/towns-economy.md`)

Engine (`src/engine/town.js` + `economy.js`; API and runtime details in `docs/mechanics/game-loop.md`;
tests in `tests/game/`):
- [x] createTown: starting buildings by role, initial stock, mage guild roll - `town-build.test.js`
- [x] buildInTown: all 8 rejection reasons in order, cost payment, replace handling, once per day - `town-build.test.js`
- [x] full build-tree walk for all 11 factions (legal order, one building per day) - `town-build.test.js`
- [x] capitol unique per player (+ downgrade on capture) - `town-build.test.js`
- [x] grail construction (hero carries Grail, exempt from daily limit) - `town-build.test.js`
- [x] daily income: halls, silo per faction, grail, mines, Estates / artifacts / specialties - `economy.test.js`
- [x] weekly: Mystic Pond, gold interest (Dwarven Treasury / Bank) - `town-effects.test.js`
- [x] weekly growth formula: base, citadel/castle percent, grail, hordes, legion artifacts, external dwellings, week-of, Deity of Fire - `town-growth.test.js`, `town-effects.test.js`
- [x] stock accumulation, month-of doubling, plague - `town-growth.test.js`, `calendar.test.js`
- [x] recruit and upgrade creatures (costs, slots), recruit-all, Factory alt tier-7 dwelling - `town-growth.test.js`
- [x] mage guild: roll per level, bans, Library extra spells, Aurora Borealis, hero learning by Wisdom, spellbook purchase - `town-heroes.test.js`, `town-effects.test.js`
- [x] mana_restore overnight, mana_double weekly - `town-effects.test.js`
- [x] visit_bonus once per hero per town (primary stats, experience), visit_temp_bonus (Stables) - `town-effects.test.js`
- [x] player_hero_bonus aggregation without stacking (Lighthouse, Colossus, Spirit Guardian, Perpetual Engine) - `town-effects.test.js`, `integration.test.js`
- [x] necromancy_bonus stacking (Amplifier, Soul Prison) - `town-effects.test.js`
- [x] garrison_bonus + siege_defense + faction moat/mines exposed by `getSiegeInfo` / `getTownGarrisonBonuses`; escape_tunnel flag - `town-effects.test.js` (applying them in battle: combat adapter)
- [x] arrow tower damage formula from building count - `town-effects.test.js`
- [x] siege battlefield from `getSiegeInfo`: walls / gate per fort level, faction moat / Tower mines, arrow towers, catapult & Ballistics, escape tunnel (combat `siege.js`, combat.md §10a) - `tests/combat/siege*.test.js`
- [x] tavern: pool of 2, 2500 gold, weekly refresh, refill, retreated heroes; thieves_guild level and info rows - `town-heroes.test.js`, `town-effects.test.js`
- [x] blacksmith per faction, Ballista Yard - `town-effects.test.js`
- [x] marketplace trades with rate by market count; resource gifts - `economy.test.js`
- [x] Freelancer's Guild, Artifact Merchants (stock, monthly re-roll, buy/sell) - `town-effects.test.js`
- [x] Skeleton Transformer mapping - `town-effects.test.js`
- [x] Portal of Summoning weekly pick - `town-effects.test.js`
- [x] Castle Gate teleport - `town-effects.test.js`
- [x] Magic University - `town-effects.test.js`
- [x] Grotto sacrifice - `town-effects.test.js`
- [x] shipyard boat placement, requiresWater - `town-effects.test.js`, `town-build.test.js`
- [x] reveal_map (Lookout Tower, Skyship), fog_cover (Cover of Darkness) - `town-effects.test.js`, `integration.test.js`
- [x] native_terrain_all (Lodestar) exposed by `hasNativeTerrainAll` - `town-effects.test.js` (honouring it: combat setup)
- [x] town capture side effects - `town-heroes.test.js`
- [x] garrison / visiting hero management (swap, army moves, garrison commander), neutral garrison growth - `town-heroes.test.js`, `town-growth.test.js`

Engine notes that differ from the text above:
- Income is paid at the start of every day **from day 2 on** (the game starts with exactly the
  difficulty's starting resources, as in the original) - see game-loop.md §3.
- With an upgraded dwelling the base creature can still be recruited (leftover base stock first, then
  from the upgraded creature's pool), as in the original.
- A retreated hero keeps his artifacts (original behaviour); only his army is lost.
- External dwellings whose definition has `townGrowthBonus: 0` do not give the +1.
- Boat spawn order: rings at distance 1, 2, 3 around the entrance, each clockwise from the tile below it.
