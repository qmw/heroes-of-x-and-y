# Audit: towns, economy and the game loop

Scope: `src/data/{factions,buildings}.js`, `src/engine/{town,economy,game,calendar,victory}.js`,
`docs/mechanics/{towns,game-loop}.md`, `tests/game/*`, `tests/data/towns*.test.js`.
Reference: Heroes III SoD (HotA for Cove / Factory). Where memory was not certain, the value used by
VCMI (whose code reverse-engineers the original) was preferred and the row is marked *(VCMI)*.
Mage-guild spell rolling was left to the spells auditor; siege combat (moat, towers) to the combat auditor.

## Check table

| # | mechanic | original | before audit | status |
|---|---|---|---|---|
| 1 | Common building costs / prerequisites (halls, fort chain, tavern, blacksmith, market, silo, guild 1-5, shipyard) | SoD table | matched | pinned - `tests/data/towns-original.test.js` |
| 2 | Hall incomes 500/1000/2000/4000, Capitol one per player (+ downgrade on capture), Town Hall needs Tavern, City Hall needs MG1 + Market + Blacksmith, Capitol needs Castle | SoD | matched | pinned |
| 3 | Guild caps (Castle 4, Stronghold/Fortress 3), blacksmith machine, silo resources, shipyard per faction | SoD | matched | pinned |
| 4 | Base dwelling costs of the 9 SoD towns, tier-7 upgrade costs, key prerequisites | SoD | matched | pinned |
| 5 | Hordes (+3 griffins, +4 dwarves, +2 dendroids, +4 gargoyles, +8 imps, +3 hounds, +6 skeletons, +7 troglodytes, +8 goblins, +6 gnolls, +10 pixies) | SoD | matched | pinned (`faction-economy.test.js`) |
| 6 | Special buildings: costs and effects (Lighthouse +500 sea, Treasury 10 %, Fountain +2 luck, Valhalla/Cage/Order/WoK +1, Academy +1000 exp, Glyphs/Obelisk/Brimstone +2, University 2000/skill, ...) | SoD | matched | pinned |
| 7 | Grails: +5000 gold, faction effect (Colossus +2 morale, Spirit Guardian +2 luck, Skyship map + 15 K, Deity of Fire +15 imps, Soul Prison +20 %, Guardian of Earth +12 SP, Warlords' +20 A, Carnivorous Plant +10/+10, Aurora all spells) | SoD | matched | pinned |
| 8 | **Grail growth** | +50 % of the *whole* growth (base + fort + legion + hordes + external dwellings) *(VCMI)* | +50 % of base only | **fixed** |
| 9 | **Statue of Legion** | +50 % of (base + fort bonus) in all towns *(VCMI)* | +50 % of base | **fixed** |
| 10 | Growth rounding | every part floored separately *(VCMI)* | one floor over summed percents | **fixed** |
| 11 | Citadel +50 % / Castle +100 % of base, hordes flat, +1 per flagged external dwelling, Legion pieces flat for the town their hero stands in | SoD *(VCMI)* | matched | tested |
| 12 | Growth accumulates without cap; upgraded dwelling keeps base stock; plague halves; month-of doubles | SoD | matched | tested (+ 112-day test) |
| 13 | **Week of X creature pool** | any non-neutral creature, base or upgraded, tiers 1-7 *(VCMI)* | base creatures only | **fixed** |
| 14 | Week/month event chances 25 % / 40 % month-of / 10 % plague, week 1 normal | SoD *(VCMI)* | matched | tested |
| 15 | **Mystic Pond** | 1-4 of a random **rare** resource *(VCMI)* | also wood / ore | **fixed** |
| 16 | **Freelancer's Guild rate** | efficiency table 30/45/50/65/70/85/90/100 % by #markets *(VCMI)* | marketplace formula (10-50 %) | **fixed** (also the adventure Freelancer's Guild, 5 markets = 70 %) |
| 17 | Marketplace table `(n+1)/20` capped 50 %, give/get rounding | SoD *(VCMI)* | matched | pinned at 1/5/9 markets; float-safe `ceil` added |
| 18 | Artifact Merchants price `(n+3)/20` capped 60 %, non-gold halved, stock 3 treasure / 3 minor / 1 major | SoD *(VCMI)* | matched | tested |
| 19 | **Artifact Merchants stock** | one stock shared by every Merchants in the game, re-rolled monthly *(VCMI)* | separate stock per town | **fixed** (`state.townMerchants`, `getMerchantStock`) |
| 20 | **Skeleton Transformer** | dragon-nature creatures -> Bone Dragons, everything else (hydras too) -> Skeletons *(VCMI)* | hydras -> Bone Dragons | **fixed** |
| 21 | **Score** | `200 - (days+10)/(playerTowns+5)` + 25 all enemies + 25 grail (built *or carried*), x 80/100/130/160/200 % *(VCMI)* | used towns on the whole map; carried Grail ignored | **fixed** |
| 22 | Starting resources (human) 30000/30/15, 20000/20/10, 15000/15/7, 10000/10/4, 0 | SoD | matched | pinned |
| 23 | No income on day 1, one build per day (Grail exempt), 7 days without a town | SoD | matched | tested |
| 24 | Tavern: 2 heroes per player, 2500 gold, weekly refresh, slot 0 prefers own faction, refill on hire, no visiting hero | SoD | matched | tested |
| 25 | War machine prices 2500 / 1000 / 750 (cannon 4000), boat 1000 g + 10 wood, Mana Vortex weekly, Castle Gate, Portal of Summoning, Escape Tunnel | SoD | matched | tested |
| 26 | Every faction's whole build tree is buildable; weekly growth and daily income equal hand computation over 112 days; JSON round trip | - | not covered | **new** `tests/game/faction-economy.test.js` |

## Fixes (code)

- `src/engine/town.js` `getTownGrowthBreakdown`: original order base -> fort % -> Statue of Legion % of
  (base + fort) -> flat (hordes, Legion pieces, external dwellings) -> Grail +50 % of that subtotal ->
  Week of X / Deity of Fire. Rows gained `fort`, `legion`, `grail` (`percent` is now only the fort
  percent). Grails' effect is `growth_percent {percent: 50, ofTotal: true}`.
  Classic example: castle + Griffin Bastion + Grail = 25 griffins (was 20).
- `src/data/buildings.js`: Mystic Pond rare resources only; `FREELANCER_EFFICIENCY` /
  `freelancerEfficiency`; hydras removed from `SKELETON_TRANSFORMER_DRAGONS`; float-safe `ceil` in the
  trade formulas (300 gold x 70 % = 210, not 211).
- `src/engine/town.js`: shared Artifact Merchants stock (`state.townMerchants = {stock, rolledOn}`,
  `getMerchantStock`); `town.merchants` removed.
- `src/engine/victory.js`: score uses the player's own town count; a carried Grail counts.
- `src/engine/calendar.js`: Week of X may name any town creature (incl. upgrades, Factory's alt tier 7).

## Tests added / changed

- New `tests/data/towns-original.test.js` (7 tests): SoD costs / prerequisites / effects / tables pinned
  independently of the data.
- New `tests/game/faction-economy.test.js` (12 tests): 112-day scripted economy per faction (11) plus a
  hand-arithmetic checkpoint test.
- Updated expectations in `tests/game/town-growth.test.js`, `town-effects.test.js`, `victory.test.js`,
  `calendar.test.js`, `tests/data/towns.test.js`; one line in `tests/adventure/effects.test.js`
  (adventure Freelancer's Guild now 70 %).

## Open questions (not changed)

- AI starting resources: Normal is 7500 / 10 / **5** here; VCMI's table may have 4 rare. Hard..Impossible
  10000 / 15 / 7 matches.
- Month of X: here the creature's whole town stock doubles after growth; the original may double only the
  week's growth. Week of X / Deity of Fire are added after the Grail bonus (could be before).
- Neutral town garrisons grow 10 % per week here; I do not believe the original grows them.
- Default starting town: the original (VCMI) adds the tier-2 dwelling with 50 % chance; here never.
- Portal of Summoning: re-rolled weekly with one week of base growth; the original may let the creatures
  accumulate while the same dwelling stays selected.
- Upgrade-dwelling extra prerequisites (Upg. Estate needs the Necromancy Amplifier, Upg. Hell Hole needs
  MG2, Upg. Gorgon Lair needs the Resource Silo ...) and some upgrade costs are not verified.
- Stables +400 movement (could be different in SoD), Brimstone Stormclouds / Cover of Darkness costs.
- Grotto (Cove) as an altar of sacrifice, Pub, Gunpowder Warehouse, Roost, Lodestar and all Factory
  specials are approximations of HotA; Conflux blacksmith (ballista vs first aid tent) unverified.
- Rank titles (`RANK_TITLES`) are our own table; the original ranks use a finer creature list.
