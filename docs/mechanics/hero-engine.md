# Hero engine: bonuses, armies, hero lifecycle, combat adapters

Files: `src/engine/bonuses.js`, `src/engine/army.js`, `src/engine/hero.js`, `src/engine/testing.js`.
Tests: `tests/engine/bonuses.test.js`, `tests/engine/army.test.js`, `tests/engine/hero.test.js`.
Builds on `leveling.js`, `artifacts.js`, `pending.js` and the data modules. Contract: DESIGN.md §8.

## 1. Bonus aggregation (`bonuses.js`)

`getHeroBonuses(state, hero) -> Bonus[]` returns copies, each tagged with `source`:

| source tag | origin |
|---|---|
| `skill:<id>` | secondary skill effects of the hero's mastery, already scaled by `skill_percent` |
| `artifact:<id>` | `getArtifactBonuses(hero)` (equipped only; combos + their components) |
| `specialty` | `specialtyBonuses(hero.defId, hero.level)` |
| `temp:<source>` | `hero.temp[].bonus` (also carries `until`) |
| `building:<id>` | `player_hero_bonus` of buildings in the owner's towns — **one per building id** however many towns have it; `necromancy_bonus` → `necromancy_percent`, **stacking per town** |
| `object:lighthouse` | flagged adventure lighthouses of the owner (cumulative per lighthouse) |

`skill_percent {skillId, percent}`: percents from all sources add up; the skill's `specialtyParam`
field of `effects[0]` becomes `param × (1 + percent/100)`. `percent` params keep fractions
(Archery 10 % at hero level 1 → 10.5 %); integer params (`value`, `healMax`) are rounded down
(Estates 125 → 131). No effect without the skill or when `specialtyParam` is null.

Helpers: `sumBonus(bonuses, type, match?)` adds `value` (or `percent` for bonuses without a
`value`); `sumBonusValue` / `sumBonusPercent` add only that field (needed for `movement_*`, which
come in both forms); `filterBonuses`, `hasBonus`; `match` is an object of equal fields or a predicate.

### Derived numbers

| function | formula |
|---|---|
| `getPrimary(state, hero, extra?)` | base + `primary` bonuses; minimum 0 attack/defense, 1 power/knowledge |
| `getMaxMana` | `floor(10 × knowledge × (100 + Σ mana_max_percent) / 100)`, knowledge = effective (min 1) |
| `getManaRegen` | `1 + floor(Σ mana_regen)` (Mysticism 2/3/4, mana artifacts, Perpetual Engine) |
| `getSightRadius` | `5 + floor(Σ sight_radius)` |
| `getMaxMovePoints(state, hero, {sea?})` | land: `floor(base × (100 + Σ% movement_land)/100) + Σ value`; sea (`hero.inBoat`): the same with 1500 and `movement_sea` |
| `landMoveBase(army)` | by the **base** speed of the slowest creature: ≤3 → 1500, 4 → 1560, 5 → 1630, 6 → 1700, 7 → 1760, 8 → 1830, 9 → 1900, 10 → 1960, ≥11 → 2000 (empty army: 2000) |
| `getTerrainPenaltyReduction` | `{ points (Pathfinding 25/50/75, scaled), level, percent (artifacts, capped 100) }` |
| `getLearnSpellLevel` | 2, or the highest `learn_spell_level` (Wisdom 3/4/5) |
| `getSchoolMastery` | `{air, earth, fire, water}` = max `spell_school_mastery` per school |
| `getEagleEye` | null without the skill, else `{percent: skill + artifacts (≤100), maxLevel}` |
| `getScholarLevel` | highest `scholar.maxLevel`, 0 without the skill |
| `getExperienceMultiplier` | `1 + Σ experience_percent / 100` |
| `getHeroIncome` | Resources from `resource_income` (Estates, resource specialties, artifacts) |
| `getDiplomacy` | `{level, joinPercent, surrenderDiscountPercent}` |
| `getSurrenderCostMultiplier` | `1 − min(90, Diplomacy discount − Σ surrender_cost_percent) / 100` |
| `getNegotiationStrengthMultiplier` | `1 + Σ army_strength_percent / 100` (Diplomat's Cloak ×3) |
| `getNecromancyInfo` | see §5 |

Logistics/Navigation percentages multiply only the base; artifact, stables and lighthouse points
are added afterwards (original behaviour). Movement is fixed at the start of the day
(`startOfDayHero`); equipping boots later the same day changes nothing until the next morning.

### Morale and luck

`getArmyMorale(state, spec)` / `getArmyLuck(state, spec)` → number in −3..+3;
`getArmyMoraleDetails` / `getArmyLuckDetails` → `{ value, raw, base, items: [{source, value}],
perStack: [n|null ×7], blockedPositive, nullified, applies }`.

`spec = { hero? (object or id), army? (default: the hero's), townId?, siege?, overlay?, terrain?
(ignored), enemy?: { hero?, army? }, bonuses? }`.

Morale terms (all additive):

| term | value |
|---|---|
| town types in the army (`alignmentMorale`) | 1 → +1, 2 → 0, 3 → −1, 4 → −2 … (`2 − n`); neutrals count as one type; `no_alignment_penalty` (Angelic Alliance) merges its listed factions into one |
| undead present | −1 |
| hero `morale` bonuses | Leadership 1/2/3, artifacts, temp (temple, idol, tombs…), Colossus / Perpetual Engine |
| `army_morale` creature aura | +1 (angels); strongest value only, several stacks do not add up |
| town `garrison_bonus` (`townId`, unless `siege: false`) | tavern +1, Brotherhood +1, Pub +2 |
| enemy hero `enemy_morale` bonuses | Hideous Mask −1, Pendant of Downfall −2 … (summed) |
| enemy `enemy_morale` creature aura | bone/ghost dragons −1 (strongest only) |

Luck: hero `luck` bonuses, garrison luck (Fountain of Fortune +2), enemy `enemy_luck` bonuses and
aura (devils −1). There is no base term.

Then: clamp to −3..+3; `block_positive_morale` / `block_positive_luck` on **either** hero caps the
result at 0 (negative values stay); a `nullify_morale_luck` overlay makes everything 0.

Per stack (`perStack`): the raw sum plus the overlay's `morale`/`luck` effects for the creature's
alignment (`good|evil|neutral|all`; neutral creatures and neutral towns are `neutral`), clamped;
`positive_morale` / `positive_luck` creatures never go below +1 (unless blocked/nullified).
**Undead, non-living creatures (golems, gargoyles, elementals, mechanical) and war machines do not
use morale**: their entry is 0, and an army made only of such stacks has `value = 0`,
`applies = false`. Luck applies to everything except war machines.

`base` = `raw` without creature auras and enemy effects. It is what `buildCombatSide` passes as
`CombatSide.morale` / `.luck`: the combat engine adds auras and enemy reductions itself (they
change as stacks die) and applies the per-stack rules.

## 2. Armies (`army.js`)

`Army` = 7 slots of `{creatureId, count} | null`. Pure helpers:
`createArmy`, `armyClone`, `armyAdd` (merge into the first stack of that creature, else first free
slot; false when full), `armyCanAdd`, `armyRemove(army, slot, count?)`, `armyRemoveCreature`,
`armyMove(a, i, b, j, count?, opts?)`, `armyStrength` (Σ aiValue × count), `armyTotalHp`,
`armyIsEmpty`, `armyTotalCount`, `armyStackCount`, `armyCount`, `armyFindSlot`, `armyFreeSlot`,
`armySlowestSpeed` (null when empty), `armyCreatureIds`, `armyCanMergeAll`, `armyMergeAll`.

`armyMove` → `{ok, action: 'none'|'move'|'split'|'merge'|'swap', moved}` or
`{ok:false, error: 'bad_slot'|'empty_slot'|'bad_count'|'slot_occupied'|'last_stack'}`:
empty destination = move/split, same creature = merge, other creature = swap of the two whole
stacks (a partial move onto another creature is `slot_occupied`).
**Last-stack rule** (original): with `opts.keepA: true` the source army may not lose its last
stack to another army (`last_stack`); leaving one creature behind (split) or swapping is allowed.
Hero armies pass the flag, town garrisons do not.

## 3. Hero lifecycle (`hero.js`)

- `addHero(state, defId, playerId, pos, opts?) -> Hero` — `createHero` + id `'h' + state.nextId++`
  (or `opts.id`), registered in `state.heroes` and `player.heroes`; mana = max mana, movement
  computed from the army. `opts.army` replaces the start army, `opts.tavern` keeps only the first
  start stack, `opts.townId`. `playerId` may be null (prison / pool heroes).
  A hero parked in **`state.heroPool[defId]`** (he retreated or surrendered) is re-used with his
  level, skills, spells and artifacts (`opts.fresh` ignores the pool); an empty army gets the first
  start stack. The def id is cleared from every `player.tavernHeroes`.
- `removeHero(state, heroId, reason)` — unregisters (player list, town visiting/garrison refs,
  his `level_up` pendings). Reasons `'retreated'` / `'surrendered'` / `'defeated'` move the record to
  `state.heroPool[defId]` with level, skills and spells (retreat / defeat: army emptied; retreat and
  surrender keep artifacts, as in the original; a defeated hero's artifacts were captured / lost in
  `finishCombat`). Retreat and surrender also put the def id into `player.tavernHeroes[1]`; a defeated
  hero just becomes free again (any tavern may offer him). Event `hero_removed {…, toTavern, toPool}`.
- `dismissHero(state, heroId)` — `removeHero(…, 'dismissed')`; refused during his combat.
- Player actions (refused with `not_your_turn` for another player's hero): `dismissStack(state, heroId,
  slot)` (`army.js armyDismiss`, last-stack rule, event `stack_dismissed`), `moveHeroArtifact(state, heroId,
  from, to)` (`artifacts.js moveArtifact`: backpack order, ring/misc swaps, slot <-> backpack position),
  `setHeroAsleep(state, heroId, bool)` (`hero_asleep` / `hero_awake`; `moveHero` wakes a hero that moves).
- `canAddHero(state, playerId)` — fewer than 8 heroes.

### Experience
`giveExperience(state, heroId, amount, {raw?})`: `gained = floor(amount × (1 + Σ experience_percent/100))`
(`raw` skips Learning). Every level reached rolls its primary skill immediately
(`rollPrimarySkill`). Secondary skills go through pendings, **one at a time**:
`{ kind: 'level_up', playerId, heroId, options: [{id, skillId, level}], data: { level, remaining, primary, primaries } }` (`primary`: the primary skill raised at that level; `primaries`: those of the queued levels behind it).
Resolving applies the chosen skill and calls `offerSecondarySkills` for the next level, so offers
always reflect the previous choice. Levels with nothing to offer are skipped; experience gained
while a choice is pending only raises `data.remaining`. Heroes without an owner pick the first
option automatically. A one-option offer is still presented (as in the original).

### Spells
- `canLearnSpell(state, hero, spellId)` (boolean; `learnSpellError` gives the reason): spellbook
  equipped, not known, not creature-only/artifact-only, `spell.level ≤ getLearnSpellLevel`.
- `learnSpell(state, heroId, spellId, {force?, via?})` — `force` skips the Wisdom check only.
- `getHeroSpells(state, hero)` — learned + granted by artifacts, de-duplicated; **empty without a
  spellbook**. `getGrantedSpells` lists `{spellId, mastery, free, source}` for `grants_spell`
  (scrolls, hats, Titan's Thunder…) and `grants_spells {school?, level?}` (tomes: every non-special
  hero spell of the school incl. all-school spells; Spellbinder's Hat: every level-5 spell).
- `meetHeroes(state, a, b)` — heroes of one player, both with spellbooks: limit = the better
  Scholar (`maxLevel` 2/3/4); each learns every spell the other knew before the meeting that is
  within the limit and that his own Wisdom allows.
- `applyEagleEye(state, hero, spellsCast)` — for each distinct enemy spell with level ≤ the skill's
  `maxLevel` that the hero can learn: learned with `percent` chance (skill × specialty + artifacts).

### Temporary bonuses and the daily tick
`addTempBonus(state, heroId, source, bonus, until, {unique?})`; `until` = `'next_battle'`,
`'end_of_day'`, `'end_of_week'` or a turn number (last day on which it is active).
`expireTempBonuses(state, hero, 'battle' | 'day')`.

`startOfDayHero(state, heroId)` (after the date advanced): drop `end_of_day`, `end_of_week` when
`state.date.day === 1`, turn numbers `< state.turn`; `maxMovePoints` recomputed, `movePoints`
refilled; mana `+getManaRegen` up to the maximum (never reduces an over-charged pool);
`mana_regen_full` (Wizard's Well) refills completely. Mage-guild mana restoration is the town
engine's job.

### Trading
`tradeArmy(state, heroA, i, heroB, j, count?)` and `tradeArtifact(state, from, to, ref, dest?)`:
same owner, and adjacent (Chebyshev distance ≤ 1 on the same level) or in the same town
(`hero.townId`). Errors `not_allied`, `not_adjacent`, plus those of `armyMove` /
`transferArtifact`. Neither hero can be left without troops.

## 4. Combat adapters (`hero.js`)

The combat engine is reached through a seam: `setCombatEngine(impl)` / `setTownModule(impl)`;
by default `src/engine/combat/index.js` and `src/engine/town.js` are imported lazily
(`await engineReady` once at startup). Without an engine `startCombat` returns
`combat_engine_unavailable`.

`buildCombatSide(state, spec, opts?)`, `spec = {heroId, townId?} | {army, playerId?, townId?} | {townId}`:

```js
{ playerId, isHuman,
  hero: null | { id, name, defId, classId, level, attack, defense, power, knowledge,   // effective
                 mana, maxMana, spells /* getHeroSpells */, skills: {id: level}, specialty,
                 bonuses /* getHeroBonuses + garrison bonuses */ },
  army /* copy */, warMachines /* without the catapult */,
  bonuses,        // side-level garrison morale/luck bonuses (present without a hero too)
  morale, luck,   // BASE values (see §1); stackMorale / stackLuck: per-slot start values
  canRetreat, canSurrender, surrenderCost, gold, nativeTerrainAll }
```
- Town defenders (`getTownDefender`): visiting hero (own army) → garrison hero (own army) →
  garrison troops. After a visiting hero falls the outcome handler decides about the next fight.
- `garrison_bonus` effects apply only in a siege (the town has a fort): morale/luck as bonuses,
  attack/defense/power/knowledge added to the defending hero's primaries.
- `canRetreat`: needs a hero; false with `no_retreat` on either hero; false for a defender in a
  fortified town without `escape_tunnel`, unless `always_can_retreat`. `canSurrender` additionally
  needs an enemy hero (or `always_can_retreat`) and enough gold.
- Surrender price (`getSurrenderCost`): half the gold cost of the army × `getSurrenderCostMultiplier`.

`startCombat(state, {attackerHeroId, defender, terrain?, bank?, context, seed?, obstacles?, overlay?, spellLevelCap?, maxRounds?})`
— `defender = {heroId} | {army, playerId?, pos?} | {townId}`. Terrain and magic overlay come from
the defender's tile (overlays never apply to sieges and banks); siege info from
`town.getSiegeInfo` (fallback: `{fortLevel, faction, buildings, escapeTunnel, moat}` from the
buildings; no fort → `null`). Extra `CombatInput` fields: `overlay`, `overlayEffects`, `spellLevelCap`
(anti-magic garrison: 0) and `maxRounds` when given.
Sets `state.combat = { cs, context, attackerHeroId, defenderHeroId, townId, defenderKind }`.

`finishCombat(state)` (engine `isOver`), in this order:
1. survivors → hero armies / `town.garrison`; `warMachinesLost` removed (never the catapult);
   mana = `manaLeft`; `next_battle` temp bonuses of both heroes removed;
2. winner's hero: necromancy computed (§5, from the engine's `killedEnemies` list without summoned
   casualties when present, else from the loser's `losses`), experience = `expAttacker`/`expDefender`
   as reported (the engine already includes +500 for an enemy hero; only when no figure is given
   the adapter uses hp of the loser's losses + 500), through `giveExperience` (Learning); raised creatures added; Eagle Eye on
   `result[loser].spellsCast` (optional field);
3. loser's hero: surrendered → pays `min(result.surrenderCost or the price of the surviving army, gold)` to the winner's
   player, `removeHero(…, 'surrendered')`; fled → `removeHero(…, 'retreated')`; otherwise
   `captureArtifacts(loser, winner)` (if the winner has a hero; else his transferable artifacts are
   lost, `artifact_lost {where:'defeat'}`) and `removeHero(…, 'defeated')` (back to the pool). The
   winning side's player is credited with `recordDefeat(state, {kind:'hero', id: heroId and defId})`
   (`defeat_hero` victory). A draw removes both heroes without capture or experience (artifacts lost).
   A "winner" whose hero has no real troops left (only summoned / temporarily raised creatures stood)
   loses: the result is turned into `winner:'draw', reason:'no_real_troops'` (original rule).
   A round-capped battle (`reason:'timeout'`) is a defender win in the engine and is handled like any
   other defeat of the attacker;
4. `state.combat = null`, then the handler registered with `registerCombatOutcome(kind, fn)` for
   `context.kind` is called as `fn(state, context, result)`; its events are appended.

`result` = the CombatResult plus `{ attackerHeroId, defenderHeroId, townId, defenderKind,
winnerHeroId, loserHeroId, experience, raised, surrenderPaid, removedHeroes, fates: {attacker,
defender} }` with fates `'won'|'defeated'|'retreated'|'surrendered'|'none'`. `raised` is the
adapter's own necromancy result (the engine's `raised` field is ignored).

`quickCombat(state, opts)` = `startCombat` + `engine.autoResolve(cs)` + the same finish.

## 5. Necromancy

`getNecromancyInfo(state, hero) -> { percent, level, creatureId, active }`: percent = Necromancy
10/20/30 (× specialty) + artifact `necromancy_percent` (works without the skill) + Amplifiers /
Soul Prison of the owner (10/20 per town), capped at 100. `creatureId` = `skeleton`, or with
`necromancy_raise` (Cloak of the Undead King) `creatures[necromancy mastery]`
(skeleton / walking dead / wight / lich).

`computeNecromancy(state, hero, killed)`:
`pool = Σ hp × count` over the killed **living** creatures (no undead, non-living, war machines);
`count = floor(pool × percent / 100 / raisedCreature.hp)`, at most the number of living creatures
killed, at least 1. The creature needs a stack of its kind or a free slot. Skeletons that do not
fit become **skeleton warriors at 2/3 of the amount** (min 1) if the hero already leads a stack of
them; otherwise nothing is raised. Nothing is raised when either hero wears `no_resurrection`.

## 6. Test helper (`testing.js`)

`createTestState({players, seed, width, height, levels, terrain, resources, factions, humans})`
→ minimal valid GameState (grass map built inline, rng, `nextId: 1`). `createTestMap`,
`addTestTown(state, {faction, owner, pos, buildings})` (bare Town entity). Core + data imports only.

## Bonus types

Implemented here (non-combat): `primary`, `morale`, `luck`, `enemy_morale`, `enemy_luck`,
`movement_land`, `movement_sea`, `terrain_penalty_reduction` (getter for the pathfinder),
`sight_radius`, `mana_regen`, `mana_regen_full`, `mana_max_percent`, `learn_spell_level`,
`spell_school_mastery` (getter), `grants_spell`, `grants_spells`, `resource_income` (getter),
`experience_percent`, `necromancy_percent`, `necromancy_raise`, `no_resurrection` (necromancy
part), `skill_percent`, `eagle_eye`, `scholar`, `diplomacy` (getter), `surrender_cost_percent`,
`army_strength_percent` (getter), `block_positive_morale`, `block_positive_luck`,
`no_alignment_penalty`, `no_retreat`, `always_can_retreat`, `war_machine`, `spellbook`.

Passed to combat untouched in `hero.bonuses` (the combat engine implements them):
`creature_stat`, `creature_specialty`, `spell_specialty`, `damage_percent`,
`damage_reduction_percent`, `magic_resistance`, `spell_immunity`, `spell_power_percent`,
`spell_duration`, `spell_cost`, `enemy_spell_power_percent`, `interference`, `tactics`,
`ballistics`, `artillery`, `first_aid`, `block_spells`, `negate_resistance`, `no_range_penalty`,
`no_obstacle_penalty`, `free_shooting`, `combat_start_cast`, `creature_regeneration`,
`raise_on_kill`, `resurrect_fallen`, `spell_reflection`.

Applied by their owners: `creature_growth` (town.js growth: Legion pieces of heroes in the town,
Statue of Legion +50 % everywhere), `creature_upgrade` (`getSpecialtyUpgrades(state, hero)` /
`specialtyUpgrade(state, heroId, slot)` here: anywhere, paying the cost difference of the creatures;
hero-screen stack window), `marketplace_count` (economy.js `countMarketplaces`, only once the player owns a
marketplace), `fly`, `water_walk`, `free_boarding` (adventure movement: any source of the bonus),
`grail` (marker).

## Deviations and assumptions

- A defeated hero returns to the global pool (`state.heroPool`) with level, skills and spells but no
  army; a hero beaten by neutrals loses his transferable artifacts.
- The +500 hero-defeat experience is the combat engine's (it grants it even when the hero fled); the adapter adds it only in its fallback.
- Town defence order "visiting hero, then garrison" as two separate sieges.
- A hero re-hired from `state.heroPool` gets a new id.
- Empty armies use the 2000 movement base (a hero normally never has one).
- Necromancy counts living creatures only and ignores `CombatResult.raised`.

## Checklist

- [x] aggregation from skills / artifacts / specialty / temp / town buildings / lighthouses — bonuses.test.js
- [x] `skill_percent` scaling, rounding, several sources — bonuses.test.js
- [x] `player_hero_bonus` de-duplication, `necromancy_bonus` stacking — bonuses.test.js
- [x] effective primaries with minimums, garrison extras — bonuses.test.js
- [x] max mana, mana regen, sight radius — bonuses.test.js
- [x] land movement table, Logistics, artifacts, stables; sea movement, Navigation, lighthouses — bonuses.test.js
- [x] terrain penalty reduction getter — bonuses.test.js
- [x] morale matrix: alignment count, undead, Leadership, artifacts, temp, angels, enemy effects, Spirit of Oppression, Angelic Alliance, garrison, overlays, clamp, per-stack rules — bonuses.test.js
- [x] luck: skill, artifacts, enemy effects, Hourglass, halflings, overlays — bonuses.test.js
- [x] necromancy info, magic getters, Learning, Diplomacy, surrender multiplier — bonuses.test.js
- [x] army helpers incl. last-stack rule — army.test.js
- [x] addHero / removeHero / dismissHero, ids, JSON round trip — hero.test.js
- [x] experience with Learning, level-up pending chain, auto-resolution — hero.test.js
- [x] spell learning rules, artifact-granted spells, Scholar, Eagle Eye — hero.test.js
- [x] temp bonus expiry, start of day (movement, mana, Wizard's Well) — hero.test.js
- [x] hero↔hero army and artifact trade — hero.test.js
- [x] necromancy numbers (cap, warriors, cloak tiers, Ring of Oblivion) — hero.test.js
- [x] buildCombatSide (hero, neutral, town defenders, garrison bonuses, retreat rules) — hero.test.js
- [x] startCombat / finishCombat / quickCombat with a fake engine: casualties, mana, war machines, experience, capture, retreat, surrender, draw, town garrison, outcome handler — hero.test.js
- [x] integration run against the real combat engine (quick combat vs neutrals and vs a hero) — hero.test.js
