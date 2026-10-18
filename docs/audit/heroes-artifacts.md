# Audit: heroes & artifacts

Scope: `src/data/{heroes,heroClasses,skills,artifacts}.js`, `src/engine/{leveling,hero,bonuses,army,artifacts}.js`
(spell learning excluded), docs `mechanics/{heroes,hero-engine,artifacts}.md`, tests `tests/engine/*`,
`tests/data/{heroes,artifacts}*.test.js`. Reference: SoD (HotA for Cove / Factory and HotA-only items).
Sources: the original HCTRAITS / ARTRAITS tables as published on the Heroes 3 wiki (heroes.thelazy.net),
cross-checked against VCMI's SoD configuration (hero skills / spells / specialties, artifact bonuses,
skill values).

## Check table

| area | item | status |
|---|---|---|
| classes | start primaries, 22 classes | OK (were already original) |
| classes | primary chances lv 2–9 / 10+ | SoD OK; **fixed** Navigator 10+, Mercenary 2–9, Artificer 2–9 |
| classes | secondary skill weights (HCTRAITS) | **fixed**: all 22 rows replaced (old rows were recollections summing to 106–121; now each sums to 112 + HotA Interference) |
| classes | bans | **fixed**: real zeros are Necromancy (non-necro), Leadership/First Aid (necro), Estates (DK), Water (Barbarian, Overlord, Mercenary), Fire (Ranger, Beastmaster), Resistance (Wizard, Warlock, Witch, Elementalist, Artificer), Navigation (Battle Mage). Old data banned Water for Battle Mage/Warlock and Fire for Witch, and allowed Resistance everywhere |
| heroes | 156 SoD heroes: class, start skills, start spell, specialty | **fixed** Neela (Basic Armorer, not Advanced), Adrienne (starts with Inferno), Kilgor and undead Lord Haart (+5 att / +5 def / +10 dmg fixed bonus, not a level-scaled creature specialty), 12 spell specialists switched to the "fixed additive per tier" family (Cuthbert, Olema, Mirlanda, Labetha, Darkstorn, Merist, Xsi, Inteus, Ash, Zubin, Coronius `[4,3,2,1,0,0,0]`); everything else matched |
| heroes | Cove (HotA) | **fixed** Andal (Pathfinding, not Mysticism), Dargem (Tactics, not Air Magic) |
| heroes | Factory (HotA) | **fixed**: 13 of 16 heroes had invented specialties/skills; now Tancred gunslingers, Melchior Diplomacy, Floribert First Aid (+tent), Wynona Scouting, Dury Armorer, Morton Ballista, Agar sandworms (Adv. Wisdom, View Earth), Bertram gold, Celestine armadillos, Eanswythe Weakness, Todd automatons, Wrathmont Frenzy, Ziph Lightning Bolt, Victoria Land Mine; Henrietta/Sam skills |
| heroes | biographies | **rewritten** ~27 lines that referenced the original setting/lore (Solmyr, Gem, Crag Hack, Kilgor, Xeron, Mutare, Catherine, Roland, Gelu, Dracon, …); test bans setting names |
| skills | values of all 28 + Interference | OK (Archery 10/25/50, Offense 10/20/30, Armorer 5/10/15, Resistance 5/10/20, Logistics 10/20/30, Navigation 50/100/150, Estates 125/250/500, Necromancy 10/20/30, Mysticism 2/3/4, Intelligence 25/50/100, Sorcery/Learning 5/10/15, Eagle Eye 40/50/60 up to lv 2/3/4, Scholar 2/3/4, Diplomacy 20/40/60 %, Pathfinding 25/50/75 points, Artillery 50/75/100 %, First Aid 50/75/100) |
| skills | specialty scaling (`specialtyParam`) | **fixed** Diplomacy can now be scaled (HotA Melchior) |
| leveling | exp table, level 13+ ×1.2 steps | OK |
| leveling | offer algorithm | **fixed**: the upgrade offer is a uniform draw among owned Basic/Advanced skills (was class-weighted); new skills stay weighted. Wisdom 6/3 and school 4/3 guarantees, reset on any offer, priority Wisdom > school: OK |
| specialties | every type consumed | `creature`, `creature_bonus`, `speed` → combat `creature_stat`/`creature_specialty`; `creature_upgrade` → hero.js; `skill` → `skill_percent`; `spell` → combat `specialtyAdjust`; `resource` → economy; `mastery` → school mastery; `war_machine` → combat. All consumed |
| bonuses | aggregated but never consumed | **fixed** `army_strength_percent` (Diplomat's Cloak ×3 in monster negotiation, minimal edit in `adventure/monsters.js`). All other artifact/skill bonus types have a consumer |
| movement | speed table 1500…2000, Logistics % on base, artifacts flat after, sea 1500 + Navigation | OK (matches the original order: base × (1+Logistics) + boots/gloves) |
| mana | 10 × Knowledge × (1 + Intelligence), regen 1 + Mysticism, no regen above max | OK |
| morale | 1 town +1, 2 → 0, n → 2−n, undead −1, clamp ±3 | OK; **fixed** Angelic Alliance merges *all* good + neutral towns (Conflux, Cove, Factory were missing) and town-less neutral creatures |
| artifacts | slot / class / value of 164 SoD+HotA items | **fixed** Pendant of Second Sight (major 5000), Boots of Speed (minor), Ring of Suppression (minor), Sleepkeeper (misc relic 50000, mind-spell immunity, banned by default → `noRandom`); all others match |
| artifacts | effects | **fixed** Vial of Dragon Blood matched every `shape:'dragon'` creature (wyverns, storm drakes) — now the ten true dragons. Combo totals (AA +21, PotDF +16, Titan's Thunder 9/9/8/8, Ring of the Magi +56, Cornucopia +5, Golden Goose 7000, Pendant of Reflection 50 %) OK |
| artifacts | rules | spellbook/catapult fixed, war machine slots, combos lock/unlock: OK (property-tested) |

## New tests (21)

- `tests/data/heroRoster.test.js` (4): full SoD roster table (156 heroes), HotA Cove/Factory table,
  spell-specialty families, no setting names in biographies.
- `tests/data/artifactTable.test.js` (4): slot/class/value of all 164 original items, combo totals,
  Armageddon's Blade / Sleepkeeper, Vial of Dragon Blood targets.
- `tests/data/heroes.test.js` (+2, 1 rewritten): HCTRAITS row sums and signature weights, HotA class
  primary chances; ban test now lists the real zeros.
- `tests/engine/heroProperties.test.js` (4): random artifact op sequences on two heroes (items
  conserved, slots/locks consistent, JSON-clean), assemble/disassemble round trip for every combo,
  random army ops conserve creatures, long random careers (≤ 8 skills, one primary per level).
- `tests/engine/heroAudit.test.js` (7): Diplomat's Cloak, Angelic Alliance grouping, morale table,
  Kilgor / Haart, Diplomacy specialty, specialty aggregation, uniform-upgrade / weighted-new offers.

## Open questions

1. **Elementalist leveling**: in SoD the Elementalist uses the *might* Wisdom/school guarantee periods
   (6/4), HotA fixed it to magic (3/3). We use 3/3. Switch for strict SoD?
2. **Fortune specialists** (Melodia, Daremyth): modelled as tiered +3/+2/+1; VCMI implements them as
   "Fortune always gives +3". Unverified.
3. **War machine specialists** (Christian, Pyre, …): +5 % attack/defense per 5 levels (tier 5) is a
   recollection; VCMI treats the ballista as a creature specialty of its own level.
4. **Start armies**: per-town ranges and "every stack always appears" are unverified (the original
   rolls the 2nd/3rd stack with a probability and gives some specialists their creature).
5. **Combat (not mine)**: `combat/state.js` adds the hero's Defense but not Attack to war machines;
   in the original the ballista uses the hero's Attack too. Flagged for the combat auditor.
6. **Necromancy rounding**: `computeNecromancy` raises at least 1 skeleton whenever a living creature
   died; the original may floor to 0 for tiny kills.
7. **Backpack cap 64** is a design choice (the original backpack is unlimited).
8. HotA-only details: Spint's start spell, Dargem's Air Shield (+25 %) and the HotA spell
   specialties' modes (Frenzy, Land Mine, Lightning Bolt, Clone, Forgetfulness) are best guesses;
   HotA's changed values (Boots of Speed +400, necromancy items halved) are deliberately not used.
