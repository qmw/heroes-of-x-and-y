# Artifacts

Data: `src/data/artifacts.js` · Engine: `src/engine/artifacts.js` ·
Tests: `tests/data/artifacts.test.js`, `tests/engine/artifacts.test.js`

192 artifacts: 141 from the original (SoD), 23 HotA additions, 28 H3online originals
(`extra: true`, incl. 3 new combination sets). Field `origin` is `'sod' | 'hota' | 'extra'`.

## 1. Data shape

```js
{ id, name, slot, class, cost, bonuses: Bonus[], description, origin,
  components?: [artifactId...],  // combination artifact
  slotIndex?,                    // fixed index within the slot (war machines)
  extra?: true,                  // H3online original
  noRandom?: true,               // never picked by pickRandomArtifact (combos, specials, uniques)
  noBackpack?: true,             // lives only in its slot: spellbook, war machines
  backpackOnly?: true,           // can never be equipped: Grail
  noTransfer?: true,             // cannot be traded, captured or sold: spellbook, catapult, Grail
  instanced?: true }             // entries carry parameters: spell_scroll
```

Classes: `treasure` (39), `minor` (39), `major` (57), `relic` (30), `combo` (19), `special` (8:
spellbook, spell scroll, Grail, catapult, ballista, ammo cart, first aid tent, cannon).

**Combo `bonuses` are only the extra effects of the assembled set.** The components' own bonuses
keep applying; `getArtifactBonuses()` returns both. Combo `cost` = sum of component costs.

Exports: `ARTIFACTS`, `ARTIFACT_BY_ID`, `COMBO_ARTIFACTS`, `ARTIFACT_CLASSES`,
`RANDOM_ARTIFACT_CLASSES`, `SPELL_SCROLL_ID`, `SCROLL_COST_BY_LEVEL`, `getArtifact(id)` (throws),
`isArtifact(id)`, `artifactsOfClass(cls)`, `artifactsOfSlot(slot)`, `isCombo(id)`,
`combosContaining(componentId)`, `randomArtifactPool(cls?)`.

## 2. Slot rules

- Slots and their counts come from `SLOT_COUNTS`: one each of head, neck, torso, shoulders,
  right_hand, left_hand, feet, spellbook; 2 rings; 5 misc; 4 war machines.
- An artifact fits only its own `slot`. Rings/misc go to the first free index unless one is given.
- War machines have fixed indices: 0 ballista **or** cannon, 1 ammo cart, 2 first aid tent,
  3 catapult. So a hero can never hold two of the same machine, nor ballista + cannon.
- Spellbook and war machines never enter the backpack (`unequip` → `not_movable`); they can be
  destroyed with `removeArtifact` (war machine lost in combat). War machines except the catapult
  can be handed to another hero that has the slot free.
- The Grail is backpack-only and cannot be transferred.
- Backpack holds at most **64** entries. A swap (equip onto an occupied slot) works even when full.
- Identical artifacts may be worn twice (two rings, several misc); their bonuses stack. (The
  original is inconsistent here; we stack everything.)
- Only **equipped** artifacts give bonuses. Backpack items are inert.

### Entry representation (spell scrolls)

An equipped/backpack entry is a plain **id string**, except spell scrolls which are objects
`{ id: 'spell_scroll', spellId }` (`makeScroll(spellId)`). Every engine function accepts both
forms (and normalises `{id:'x'}` to `'x'` for non-instanced artifacts). Use `entryId(entry)` to get
the id. When searching, a bare `'spell_scroll'` matches any scroll, `{id, spellId}` only that
scroll. `giveArtifact(hero, 'spell_scroll')` without a spell fails with `scroll_needs_spell`.
An equipped scroll yields `{ type: 'grants_spell', spellId }`. Scroll value depends on spell
level: 500 / 2000 / 3000 / 8000 / 10000 (`artifactValue(entry, spellLevel)`).

### Locks

`hero.artifacts.locks` is a map `'slot:index' -> 'slot:index'` (locked slot → slot holding the
combo that locks it). A locked slot contains `null` in `equipped`, so code that only iterates
`equipped` sees nothing there; code that wants to place something must go through
`findEquipSlot` / `canEquip` / `isSlotLocked`. The map is optional (missing = no locks) and is
created lazily by `ensureArtifacts(hero)`.

## 3. Combination artifacts

- `assemble(hero, comboId)` requires **every component equipped** (backpack parts do not count).
  The components vanish, the combo is placed in the slot of the component that shares the combo's
  `slot` (the first such in `components`), and the slots the other components occupied become
  locked.
- `disassemble(hero, ref)` on an equipped combo puts each component back into the main slot /
  the locked slots and removes the locks. On a combo in the backpack it replaces the entry with the
  components in the backpack (fails `backpack_full` if they do not fit).
- Unequipping a combo releases its locks. Equipping a combo (from backpack, `giveArtifact`,
  transfer) needs the main slot **and** one free unlocked slot per other component, which get
  locked; otherwise `component_slots_occupied`.
- `hasArtifact(hero, id)` is true for the components of an equipped combo.
- No component belongs to two sets; combos never nest.

| combo | slot | components | extra effect of the set |
|---|---|---|---|
| Angelic Alliance | right_hand | Sword of Judgement, Armor of Wonder, Sandals of the Saint, Celestial Necklace of Bliss, Lion's Shield of Courage, Helm of Heavenly Enlightenment | (+21 all primaries from parts) `no_alignment_penalty`, auto expert Prayer |
| Cloak of the Undead King | shoulders | Vampire's Cowl, Amulet of the Undertaker, Dead Man's Boots | (+30% necromancy from parts) `necromancy_raise` |
| Elixir of Life | misc | Vial of Lifeblood, Ring of Vitality, Ring of Life | (+4 hp from parts) +25% hp and regeneration for living creatures |
| Armor of the Damned | torso | Rib Cage, Blackshard of the Dead Knight, Shield of the Yawning Dead, Skull Helmet | (+3 atk, +3 def, +2 pow, +2 kno) auto Slow, Curse, Weakness, Misfortune |
| Statue of Legion | misc | Legs, Loins, Torso, Arms, Head of Legion | +50% growth in all towns |
| Power of the Dragon Father | torso | the 9 dragon pieces | +6 all primaries (16 total), immunity to level 1-4 spells |
| Titan's Thunder | right_hand | Titan's Gladius, Sentinel's Shield, Thunder Helmet, Titan's Cuirass | (+9/+9/+8/+8) Titan's Lightning Bolt |
| Admiral's Hat | head | Sea Captain's Hat, Necklace of Ocean Guidance | (+1500 sea movement, 2 spells) `free_boarding` |
| Bow of the Sharpshooter | misc | Bow of Elven Cherrywood, Bowstring of the Unicorn's Mane, Angel Feather Arrows | (+30% ranged) no range/obstacle penalty, `free_shooting` |
| Wizard's Well | misc | Charm, Talisman, Mystic Orb of Mana | `mana_regen_full` |
| Ring of the Magi | ring | Ring, Collar, Cape of Conjuring | +50 duration (56 total) |
| Cornucopia | misc | Everpouring Vial of Mercury, Everflowing Crystal Cloak, Ring of Infinite Gems, Eversmoking Ring of Sulfur | +4 each (5/day total of each rare resource) |
| Ironfist of the Ogre (HotA) | right_hand | Ogre's Club of Havoc, Targ of the Rampaging Ogre, Crown of the Supreme Magi, Tunic of the Cyclops King | auto Haste, Bloodlust, Fire Shield, Counterstrike |
| Golden Goose (HotA) | misc | Endless Sack, Bag, Purse of Gold | +4750 gold (7000/day total) |
| Diplomat's Cloak (HotA) | shoulders | Ambassador's Sash, Statesman's Medal, Diplomat's Ring | `always_can_retreat`, `army_strength_percent` |
| Pendant of Reflection (HotA) | neck | Garniture of Interference, Surcoat of Counterpoise, Boots of Polarity | +20% resistance (50% total) |
| Stormcaller's Regalia (extra) | head | Stormglass Circlet, Gauntlet of Static, Cloak of Gales | expert Air Magic, +25% air damage, Chain Lightning |
| Warlord's Panoply (extra) | torso | Warlord's Cuirass, Greatsword, Bulwark, Banner of the Vanguard | +10% melee, −10% damage taken, +1 speed, +1 morale |
| Pathfinder's Legacy (extra) | feet | Trailblazer's Boots, Cartographer's Compass, Saddlebags of Plenty | +15% land movement, no terrain penalty, +2 sight |

## 4. Engine API (`src/engine/artifacts.js`)

All functions take the `Hero` object (not `GameState`) and mutators mutate it. `ref` = artifact id
| entry | location `{slot, index}` / `{backpack: i}`. Unknown artifact ids throw.

| function | result |
|---|---|
| `createEmptyArtifacts()` | `{ equipped, backpack: [], locks: {} }` |
| `ensureArtifacts(hero)` | fills in missing slot arrays / backpack / locks |
| `findEquipSlot(hero, ref, slot?, index?)` | `{ok, slot, index, locks}` or `{ok:false, error}`. Without `index`: needs a free slot. With `index`: an occupant is allowed (it would be swapped), a lock is not |
| `canEquip(hero, ref, slot?, index?)` | **boolean** form of the above |
| `equip(hero, ref, slot?, index?)` | backpack → slot; `ref` may be a backpack index. Swaps with the occupant of an explicit index |
| `unequip(hero, slot, index = 0)` | slot → backpack |
| `moveToBackpack(hero, ref)` | unequip by id/entry |
| `giveArtifact(hero, ref, {toBackpack?})` | auto-equip to a free suitable slot, else backpack |
| `removeArtifact(hero, ref)` | destroys one instance (equipped first, then backpack) |
| `hasArtifact(hero, id)` | boolean; equipped only, combo components count |
| `ownsArtifact(hero, id)` | boolean; equipped or backpack |
| `findArtifact(hero, ref)` | `{where:'equipped', slot, index, entry}` / `{where:'backpack', index, entry}` / null |
| `getEquippedArtifacts(hero)` | `[{slot, index, id, entry}]` |
| `getArtifactBonuses(hero)` | `Bonus[]`, copies tagged `source: 'artifact:<equipped id>'` |
| `getWarMachines(hero)` | creature ids for `CombatSide.warMachines` (+ `'catapult'`, `'cannon'`) |
| `checkAssemble` / `canAssemble(hero, comboId)` | detailed / boolean |
| `getAssemblableCombos(hero)` | combo ids ready to assemble |
| `assemble(hero, comboId)`, `disassemble(hero, ref)` | §3 |
| `moveArtifact(hero, from, to)` | inside one hero; `from`/`to` = `{backpack: i}` \| `{slot, index}`: backpack reorder, same-kind slot swap (ring 1 <-> 2), slot -> backpack position, backpack -> slot; `wrong_slot, empty_slot, bad_location`; nothing changes on failure |
| `transferArtifact(from, to, ref, dest?)` | `dest`: omitted = auto, `{slot, index?}` (must be free), `{backpack: true}`. Nothing changes on failure |
| `captureArtifacts(loser, winner)` | winner takes all transferable non-war-machine artifacts; overflow is destroyed |
| `artifactValue(ref, spellLevel?)` | gold value |
| `artifactSellPrice(ref, marketplaces = 1, {resource?, spellLevel?})` | `floor(value × eff)`; eff by marketplaces 1..9 = 0.30, 0.45, 0.50, 0.65, 0.70, 0.85, 0.90, 1, 1. Other resources: ÷250 (wood/ore), ÷500 (rare). 0 for non-transferable |
| `pickRandomArtifact(rng, cls?, exclude?)` | id or `null`; `cls` = class, array of classes, or null (any of treasure/minor/major/relic) |
| `isSlotLocked`, `slotLockedBy`, `entryId`, `makeScroll`, `normalizeEntry` | helpers |

Errors: `wrong_slot`, `bad_index`, `bad_slot`, `slot_locked`, `slot_occupied`, `no_free_slot`,
`component_slots_occupied`, `not_equippable`, `not_in_backpack`, `empty_slot`, `not_movable`,
`backpack_full`, `not_found`, `already_in_backpack`, `scroll_needs_spell`, `not_a_combo`,
`missing_components`, `same_hero`, `not_transferable`.

Events: `artifact_gained {heroId, artifact, where, slot?, index}`, `artifact_equipped`,
`artifact_unequipped {heroId, artifact, slot, index}`, `artifact_lost {heroId, artifact, where}`,
`artifact_assembled {heroId, artifact, slot, index}`, `artifact_disassembled {heroId, artifact,
components}`, `artifact_transferred {fromHeroId, toHeroId, artifact, where, slot?, index?}`.

## Bonus types

Every bonus type used by an artifact. Unless stated otherwise, bonuses of the same type **add up**.
`side: 'own'` affects the wearer's army only, `side: 'both'` affects both armies in a battle the
wearer takes part in. `except: [tags]` uses the creature tags of `Spell.immune` (`'undead'`,
`'non_living'`): matching creatures do not get the bonus. `filter` on `creature_stat` is an object
of Creature fields that must all match (`{shape:'dragon'}`, `{tier:1}`, `{shooter:false}` — the
last meaning `shots === 0`).

### From DESIGN.md (unchanged meaning)

| type | params | used by / notes |
|---|---|---|
| `primary` | `stat`, `value` (may be negative) | weapons, shields, helms, armour. The hero's effective primary skill never drops below 0 (attack/defense) or 1 (power/knowledge) |
| `morale`, `luck` | `value` | hero's army |
| `enemy_morale`, `enemy_luck` | `value` (negative) | Hideous Mask, Pendant of Downfall, Ring of Suppression; Runes of Imminency, Demon's Horseshoe, Shaman's Puppet |
| `movement_land`, `movement_sea` | `value` (points, 100 = one tile of plain terrain) or `percent` | added to the daily maximum at the start of the day while equipped. Equestrian's Gloves +300, Boots of Speed +600, Necklace of Ocean Guidance +1000, Sea Captain's Hat +500 |
| `terrain_penalty_reduction` | `percent` | summed and capped at 100. Wayfarer's Boots 100 = every terrain costs like a road-less native tile |
| `sight_radius` | `value` | Speculum, Spyglass +1 |
| `mana_regen` | `value` | spell points per day |
| `mana_max_percent` | `percent` | Ring of the Arch-Magus |
| `spell_power_percent` | `school?`, `percent` | Orbs: +50% to **damage** of that school's spells (additive with Sorcery). Without `school`: all damage spells |
| `spell_duration` | `value` | extra rounds for the hero's timed spells |
| `spell_school_mastery` | `school`, `level` | spells of the school are cast at least at this mastery (Stormcaller's Regalia) |
| `spell_cost` | `school?`, `value` | mana cost delta, minimum cost 1 |
| `grants_spell` | `spellId`, `mastery?`, `free?`, `requiresSpellbook?` | spell is castable while equipped; it is **not** learned (gone when unequipped). `mastery` = cast at least at that mastery; `free` = costs 0 mana. Always needs a spellbook to cast |
| `resource_income` | `resource`, `value` | daily, to the owning player, wherever the hero is |
| `creature_growth` | `tier?`, `value?`, `percent?`, `scope` | see "Legion" below |
| `creature_stat` | `filter?`, `except?`, `stat`, `value` or `percent` | applied to stacks of the hero's army in combat. `percent` on `hp` is applied to base hp after flat additions, rounded down |
| `damage_percent` | `mode`, `percent` | archery items add +5/10/15% ranged damage, additive with the Archery skill bonus (they work without the skill) |
| `damage_reduction_percent` | `percent` | additive with Armorer |
| `magic_resistance` | `percent` | chance for each hostile spell to fail per target stack, additive with Resistance skill |
| `spell_immunity` | `spellId?`, `maxLevel?`, `side` | hero's stacks are immune to the spell / to all spells of level ≤ `maxLevel`, whoever casts them (friendly casts included — Power of the Dragon Father also blocks your own Bless) |
| `experience_percent` | `percent` | Scholar's Monocle |
| `necromancy_percent` | `percent` | added to the Necromancy skill percentage; **applies even without the skill** |
| `eagle_eye` | `percent` | added to Eagle Eye chance; no effect without the skill |

### New types

| type | params | exact semantics |
|---|---|---|
| `block_spells` | `minLevel`, `maxLevel`, `side:'both'` | **Orb of Inhibition** (1-5), **Recanter's Cloak** (3-5), Cape of Silence (1-2): while any hero in the battle wears it, neither hero can cast spells whose level is in the range. Creature spell-casting abilities and `combat_start_cast` are not affected. With Orb of Inhibition `canCast` is false for both sides |
| `negate_resistance` | `immunities: true`, `side:'both'` | **Orb of Vulnerability**: for every stack on both sides, ignore `magic_resistance` (skill, artifacts, creature abilities such as dwarves') and natural creature spell immunities (dragons, golems' damage reduction, level-based immunities). Immunities granted by artifacts (`spell_immunity`) and hard rules (undead vs. mind spells, Resurrection on undead etc.) stay |
| `block_positive_morale` | `side:'both'` | **Spirit of Oppression**: no stack in the battle can get a good-morale extra action; total morale above 0 is treated as 0. Negative morale still works |
| `block_positive_luck` | `side:'both'` | **Hourglass of the Evil Hour**: same for luck (no lucky strikes; bad luck still works) |
| `no_retreat` | `side:'both'` | **Shackles of War**: neither hero can retreat or surrender (`canRetreat`/`canSurrender` false) |
| `always_can_retreat` | — | Diplomat's Cloak: the wearer may retreat/surrender where it is normally forbidden (defending a town without escape tunnel, fights vs. neutrals offer surrender at the usual cost). Loses to an enemy `no_retreat` |
| `surrender_cost_percent` | `percent` (−10) | Statesman's Medal, Diplomat's Ring, Ambassador's Sash: surrender cost multiplier, summed with Diplomacy's reduction; total reduction capped at 90% |
| `army_strength_percent` | `percent`, `context:'negotiation'` | Diplomat's Cloak: hero army strength counts as ×(1 + percent/100) = ×3 when wandering monsters decide to flee or join |
| `enemy_spell_power_percent` | `percent` (negative) | Charm of Eclipse / Seal of Sunset −10, Plate of Dying Light −25: the opposing hero's spell power in this battle is multiplied by (1 + sum/100), rounded down, minimum 1 |
| `no_range_penalty` | — | Golden Bow, Bow of the Sharpshooter: own shooters deal full damage beyond 10 hexes |
| `no_obstacle_penalty` | — | same items: no damage halving when shooting over siege walls |
| `free_shooting` | — | **Bow of the Sharpshooter**: own shooters may shoot while an enemy stands adjacent, at full ranged damage (no melee penalty applies because they shoot) |
| `fly` | `mastery: 3` | Angel Wings: the hero moves as under an expert Fly spell — may pass over any tile, must end on a free land tile; terrain penalties are ignored while flying over obstacles |
| `water_walk` | `mastery: 3` | Boots of Levitation: as an expert Water Walk — may cross water but must end the day's move on land |
| `free_boarding` | — | Admiral's Hat: boarding and leaving a boat does not zero the hero's movement; remaining points are converted proportionally between land and sea maxima |
| `mana_regen_full` | — | **Wizard's Well**: at the start of each day mana is set to the hero's maximum (if lower) |
| `grants_spells` | `school?`, `level?` | Tomes: every spell of the school; Spellbinder's Hat: every level-5 spell. Castable while equipped regardless of Wisdom; not learned; needs a spellbook. Adventure and combat spells both |
| `combat_start_cast` | `spellId`, `mastery`, `power`, `target:'all_friendly'\|'all_enemies'` | cast automatically before the first round, costs no mana and no hero action, at the given mastery, as a mass spell on all valid targets, with duration = `power` rounds (and `power` as spell power for scaling). Subject to target immunity and magic resistance; not stopped by `block_spells`. **Angelic Alliance**: Prayer, expert, power 10. **Armor of the Damned**: Slow, Curse, Weakness, Misfortune, expert, power 50, in this order. Ironfist of the Ogre: Haste, Bloodlust, Fire Shield, Counterstrike, expert, power 50 |
| `no_alignment_penalty` | `factions:[...]` | **Angelic Alliance**: when counting the number of different factions in the army for the mixed-army morale penalty, all listed factions (every good and neutral town — castle, rampart, tower, stronghold, fortress, conflux, cove, factory — plus town-less `neutral` creatures) count together as one. Evil factions still count separately |
| `necromancy_raise` | `creatures:[4]` | **Cloak of the Undead King**: creature raised by necromancy, indexed by the hero's Necromancy level (0 none → `skeleton`, 1 basic → `walking_dead`, 2 advanced → `wight`, 3 expert → `lich`). The raised amount is computed as usual in hit points (`killed hp × necromancy%`, where the percentage includes the +30% from the three parts, so 30% without the skill) and divided by the raised creature's hp; at least 1 if anything was killed; if no army slot is free for that creature, nothing is raised |
| `creature_regeneration` | `except` | **Elixir of Life**: every living stack of the hero restores the top creature to full hp at the start of each of its turns (like trolls/wights). Together with `creature_stat hp +25%` (living only) and the parts' +1 +1 +2 hp (all creatures) |
| `raise_on_kill` | `creatureId`, `except` | Horn of the Abyss: when an enemy stack of living creatures is completely destroyed, a temporary stack of `fangarm` with total hp equal to the destroyed stack's starting hp (rounded down, min 1) appears for the wearer; survivors join the army after the battle if a slot is free |
| `no_resurrection` | `side:'both'` | Ring of Oblivion: Resurrection / Animate Dead / first-aid healing above the current count, necromancy and `resurrect_fallen` have no effect in this battle |
| `resurrect_fallen` | `percent`, `uses` | Phoenix Feather: the first time one of the wearer's stacks is destroyed in a battle it returns with `ceil(start count × percent/100)` creatures on its hex; once per battle |
| `spell_reflection` | `percent` | Mirror of Vanity: each hostile single-target spell of the enemy hero has this chance, per cast, to hit a random valid enemy stack instead |
| `marketplace_count` | `value` | Merchant's Scales: owning player's marketplace count +1 for exchange rates and `artifactSellPrice` |
| `spellbook` | — | marker: the hero can learn and cast spells |
| `war_machine` | `creatureId` | marker: the hero brings this machine to combat (`getWarMachines`) |
| `grail` | — | marker, see below |

### Specific rulings

- **Legion pieces** (`creature_growth`, `scope: 'town'`): Legs +5 tier 2, Loins +4 tier 3, Torso +3
  tier 4, Arms +2 tier 5, Head +1 tier 6. Applied at weekly growth to the town in which the wearer
  is the visiting or garrison hero on day 1; only if the corresponding dwelling is built.
- **Statue of Legion** (`creature_growth percent 50`, `scope: 'all_towns'`): +50% of base growth
  (after castle/citadel modifiers, like the Grail) to all dwellings in every town of the owner,
  wherever the hero stands. The parts' flat bonuses still apply to the town the hero is in. Several
  statues do not stack.
- **Sphere of Permanence**: `spell_immunity` to `dispel`, side own — Dispel from either hero does
  not remove anything from the wearer's stacks (so enemy debuffs on them also stay).
- **Titan's Thunder**: `titans_lightning_bolt` — 600 fixed damage, 0 mana, expert, single enemy
  stack; requires the hero to own a spellbook; counts as the hero's cast for the round.
- **Armageddon's Blade**: Armageddon at expert in the book + own troops immune to it.
- **Sea Captain's Hat**: Summon Boat and Scuttle Boat castable at the hero's own Water mastery.
- **Pendants**: Dispassion → `berserk`, Second Sight → `blind`, Holiness → `curse`, Life →
  `death_ripple`, Death → `destroy_undead`, Free Will → `hypnotize`, Negativity →
  `lightning_bolt` + `chain_lightning`, Total Recall → `forgetfulness`.
- **Grail**: found by digging at the obelisk-puzzle spot; sits in the backpack, cannot be equipped,
  traded, captured or sold. A hero carrying it who enters an owned town with a City Hall may build
  the grail structure (removing the artifact): +5000 gold/day, +50% creature growth in that town,
  plus the faction-specific effect defined by the building data. If the carrier loses a battle the
  Grail stays with the hero record (vanishes with a dismissed hero).
- **War machines**: bought at blacksmiths / war machine factories → `giveArtifact`; destroyed in
  combat (`CombatResult.warMachinesLost`) → `removeArtifact`. Every hero starts with a catapult.
- **Captured artifacts**: when a hero is defeated (not fled/surrendered) by another hero,
  `captureArtifacts(loser, winner)`.

## Uncertain values

Audited (docs/audit/heroes-artifacts.md): slot, class and value of every SoD / HotA artifact are
pinned to the original tables by `tests/data/artifactTable.test.js`. SoD effect values are used
where HotA changed them (Boots of Speed +600, Equestrian's Gloves +300, necromancy items
5/10/15 %). Sleepkeeper (HotA, relic, banned by default → `noRandom`) gives immunity to the
hostile mind spells (sorrow, berserk, hypnotize, forgetfulness, blind, fear). Still unverified:
spell scroll values and the sell-efficiency table.

## Checklist

- [x] catalogue: unique ids, valid slot/class/cost, structured bonuses — tests/data/artifacts.test.js
- [x] all 12 original combos + 4 HotA + 3 extra, components exist, cost = sum — tests/data/artifacts.test.js
- [x] spot values (weapons, Angelic Alliance parts, dragon set, orbs, legion, movement) — tests/data/artifacts.test.js
- [x] random pool excludes combos/specials/uniques — tests/data/artifacts.test.js
- [x] war machine fixed slots, cannon shares ballista slot — both test files
- [x] give: auto-equip, fallback to backpack — tests/engine/artifacts.test.js
- [x] two rings, five misc — tests/engine/artifacts.test.js
- [x] slot conflicts, wrong slot, explicit index, swap — tests/engine/artifacts.test.js
- [x] unequip / moveToBackpack / remove — tests/engine/artifacts.test.js
- [x] backpack cap 64 — tests/engine/artifacts.test.js
- [x] spellbook / war machines never in backpack — tests/engine/artifacts.test.js
- [x] bonus aggregation with source tag, data not mutated — tests/engine/artifacts.test.js
- [x] assemble / disassemble / slot locks / multi-slot combos — tests/engine/artifacts.test.js
- [x] combo unequip releases locks, re-equip needs component slots — tests/engine/artifacts.test.js
- [x] hasArtifact counts combo components; ownsArtifact includes backpack — tests/engine/artifacts.test.js
- [x] spell scroll instances — tests/engine/artifacts.test.js
- [x] transfer between heroes, combos, non-transferables — tests/engine/artifacts.test.js
- [x] capture after battle — tests/engine/artifacts.test.js
- [x] sell price by marketplaces / resource — tests/engine/artifacts.test.js
- [x] deterministic random pick by class with exclusions — tests/engine/artifacts.test.js
- [x] original slot/class/value table, combo set totals — tests/data/artifactTable.test.js
- [x] property tests: random op sequences conserve items, locks stay consistent — tests/engine/heroProperties.test.js
- [x] Diplomat's Cloak ×3 negotiation strength (adventure/monsters.js) — tests/engine/heroAudit.test.js
- [ ] effects of the bonuses themselves (combat, adventure, economy) — implemented by the
      aggregator / combat / adventure owners from the "Bonus types" section
