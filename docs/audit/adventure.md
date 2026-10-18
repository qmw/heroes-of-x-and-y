# Audit: adventure map

Scope: `src/data/{terrain,mapObjects}.js`, `src/engine/adventure/*` (adventure spells excluded),
object placement values in `src/engine/mapgen/*`, docs `docs/mechanics/{adventure-objects,adventure-engine,mapgen}.md`,
tests `tests/adventure/*`, `tests/data/mapObjects.test.js`, `tests/mapgen/*`.
Reference: SoD (HotA for HotA-only objects); where memory was uncertain the VCMI reimplementation
(which reverse-engineered the original) was used as tie-breaker.

## Check table

Legend: OK = matches the original and is pinned by a test; FIXED = was wrong, fixed in this audit;
OPEN = uncertain, kept as is (see open questions).

| Area | Rule / value | Status | Test |
|---|---|---|---|
| Terrain costs | dirt/grass/lava/sub/highlands 100, rough/wasteland 125, sand/snow 150, swamp 175, water 100, rock impassable | OK | data/mapObjects, adventure/movement |
| Terrain of origin | cost of the tile being left | OK | adventure/movement |
| Roads | 75/65/50, both tiles must have a road, cost of the road left, terrain ignored | OK | both |
| Diagonal | `floor(cost * sqrt(2))`: 141/176/212/247, roads 106/91/70 | FIXED (was x1.41: 211/246/105) | both |
| Diagonal exception | diagonal step allowed with >= orthogonal cost, uses all points | OK | adventure/movement |
| Pathfinding | flat -25/-50/-75, floor 100 | OK | both |
| Native terrain | whole army native -> no penalty; nomads -> sand | OK (neutral handling OPEN) | both |
| Sailing | 100/tile, favorable winds 66 | OK | data |
| Boarding / landing | uses all remaining points; Admiral's Hat converts proportionally | OK (minimum points OPEN) | adventure/transport |
| Fog | Euclidean radius, explored only grows except Cover of Darkness (radius 20, not for allies, keeps currently seen tiles) | OK | adventure/fog, adventure/property |
| Resource piles | wood/ore 5-10, rare 3-6, gold 500-1000 step 100 | OK | both |
| Treasure chest | 32/32/31/5%: 1000/1500/2000 gold or 500/1000/1500 exp, 5% treasure artifact | OK | both |
| Campfire | 400-600 gold + 4-6 of one non-gold resource | OK | both |
| Flotsam / sea chest / survivor | 25x4 / 20-70-10 / 55-20-20-5 | OK | data (audit test) |
| Wagon, corpse, lean-to, warrior's tomb | tables as documented; tomb -3 morale, again on every later robbing | OK (wagon/corpse split OPEN) | data, effects |
| Mines | 2 wood/ore, 1 rare, 1000 gold; abandoned mine never wood | OK | data, effects |
| Windmill / water wheel / mystical garden | 3-6 non-wood non-gold; 500 in week 1 then 1000; 5 gems or 500 gold | OK | data, effects |
| Primary boosters | camp/Marletto/star axis/garden +1, arena +2 att/def, schools 1000 gold +1 | OK | data, effects |
| Learning stone / tree of knowledge / library | 1000 exp; free/2000g/10 gems; +2 all at level 10/8/6/4 by Diplomacy | OK | data, effects |
| Witch hut / university | Basic, never Necromancy/Leadership; 4 skills x 2000 gold | OK | data, effects |
| Scholar | primary / skill / spell (lvl 1-5); a known skill below Expert is raised one level | FIXED (known skill gave +1 primary) | adventure/effects |
| Shrines | level 1/2/3 (HotA 4); level 3 needs Basic Wisdom, 4 Advanced, 5 Expert | OK | data, effects |
| Pyramid | 40 gold + 20 diamond golems, level 5 spell (Expert Wisdom), looted -2 luck | OK | data (audit test) |
| Temporary bonuses | idol (odd luck / even morale / day 7 both), fountains, faerie ring, swan pond, rally flag, buoy, mermaids, temple (+2 day 7), oasis +800, watering hole +400, stables +400/week | OK | data, effects |
| Magic well / spring | full mana per hero per day / double mana once a week per object | OK | data, effects |
| Observatory / pillar / cartographers / hut of the magi | radius 20 / 20 / 1000 gold / eyes radius 10 | OK | data, effects |
| Hill fort | upgrade at 0/25/50/75/100/100/100% by tier | OK | data, effects |
| War machine factory | 2500 / 1000 / 750 | OK | data, effects |
| Refugee camp | random creature weekly, one week of growth, normal price | OK | data, effects |
| Creature banks (SoD) | Cyclops, Dwarven, Griffin, Imp, Medusa, Naga, Dragon Fly, Utopia, Crypt, Derelict Ship, Shipwreck: guards, rewards, 30/30/30/10 | OK | data |
| Whirlpool | weakest stack (count x AI value) loses half (min 1), not with Sea Captain's / Admiral's Hat | OK | data, transport |
| Subterranean gates / monoliths | pairing / random exit | OK | transport |
| Grail digging | full daily points, land, no object/road, sets points to 0 | OK | effects |
| Monster join/flee/fight | VCMI/original `takenAction` (power factor, sympathy, Diplomacy) | OK | adventure/monsters |
| Refused join offer | re-evaluate without joining: flee if `charisma > character`, else fight | FIXED (always fought) | adventure/monsters |
| Can't pay for join | treated as a refusal | FIXED (always fought) | adventure/monsters |
| Stack split | 7..2 stacks by ratio, +-1 at 20%/80%, upgraded middle stack 50% | OK | adventure/monsters |
| Weekly growth | +10% with hidden fractions (`power/1000`), cap 4000, not at map start | FIXED (was `ceil`, grew 5 -> 6 -> 7 instead of 5 -> 5 -> 6) | adventure/monsters |
| Size labels | few 1-4 ... legion 1000+ | OK | data |
| Dispositions | compliant (always joins), friendly 1-7, aggressive 1-10, hostile 4-10, savage 10 | OK (compliant value OPEN) | data, monsters |
| Tier-1 external dwellings | creatures join for free | OK | data (audit test), effects |
| RMG values | piles 1400/2000/750, chest 1500, artifacts 2000/5000/10000/20000, scrolls 500-5000, Pandora presets | OK (VCMI RMG scale) | data |

## Fixes

1. **Diagonal movement factor** `DIAGONAL_FACTOR = Math.SQRT2` (was 1.41) - `src/data/terrain.js`. Diagonal
   costs now 141/176/212/247, roads 106/91/70, favorable winds 93.
2. **Wandering monster growth** keeps hidden fractions (`data.power`), as the original - `monsters.js` `growMonster`.
3. **Refused join offer** (or join for gold that cannot be paid) no longer always means a fight: the
   stack re-evaluates without the join options and may flee (pending `monster_flee`, event
   `monster_refused`) - `monsters.js`.
4. **Scholar** raises an already known secondary skill (below Expert) by one level instead of giving a
   random primary point - `visit.js`.
5. Test `market: ... freelancer guild` now derives the expected price from the shared
   `freelancerRate` (the towns auditor replaced the efficiency formula by the original table).

## New tests

- `tests/adventure/property.test.js` (4 tests): random hero walks (3 heroes per player, 14 days,
  random answers to every pending, AI quick combat) on S default / S duel with underground /
  S wilderness / M archipelago maps. Invariants: no exception, move points >= 0, heroes on passable,
  unblocked tiles, at sea only in a boat, never two heroes on one tile, walking never adds points,
  explored tiles monotonic (except after Cover of Darkness), revisit rules per `revisit` mode
  (per hero / once / per player / weekly / daily / per hero weekly), JSON round-trip every day.
- `tests/data/mapObjects.test.js`: 4 audit tests pinning the remaining SoD tables (sea pickups,
  caches, weekly objects, boosters, shrines, scholar, library, witch hut, pyramid, bank artifacts
  and penalties, temp bonuses incl. Idol of Fortune day mapping, mana objects, information
  objects, whirlpool protection, services, free tier-1 dwellings, monster constants).
- Monster tests extended: refusal -> flee / fight, fractional growth; scholar skill upgrade cases;
  diagonal values updated to sqrt(2).

## Open questions

- **Native terrain with neutral stacks**: we treat a neutral stack as breaking the "whole army is
  native" rule. In SoD neutrals are ignored only when they are the top slot (a bug); VCMI ignores
  them always. Kept as is.
- **Boarding / landing with few points**: we allow it with >= 1 point (then 0). VCMI requires the
  normal step cost to be affordable first. Not verified for SoD.
- **Monster counts by tier 5-8** (`MONSTER_COUNT_BY_TIER` 6-12 / 4-8 / 2-4 / 1-2): the original uses
  per-creature `AdvMapLow/High` (CRTRAITS); tiers 1-4 (20-50 / 16-30 / 12-25 / 10-20) match the common
  pattern, higher tiers are recalled approximately. Only used for unspecified `random_monster`
  counts (the RMG sizes guards by value).
- **Compliant disposition**: `-4` makes it always join (as the editor describes it); VCMI uses 0,
  under which a compliant stack fights a much stronger-than-you army.
- **Wagon / corpse**: the split of the artifact chance between treasure and minor is not certain.
- **Bank upgraded-stack chances** per bank (data: 50% for single-creature SoD banks except Dragon Fly
  Hive) and **bank stack counts** are not verified against CREBANKS.TXT.
- **Black market restock** (data: monthly, like VCMI) - the doc's deviation list says SoD never
  restocks; not verified.
- **Whirlpool confirm**: we ask before entering (pending `confirm_whirlpool`); the original just
  applies the loss.
- `docs/mechanics/spells.md` §13.6 still mentions "diagonals x1.41" for Fly / Water Walk (spells
  auditor's file; the code uses the shared `DIAGONAL_FACTOR`, so only the text is stale).
- UI: the new event `monster_refused` has no log text in `src/ui/screens/adventure/model.js` (the
  follow-up `monster_flee` dialog / battle is shown as before).
