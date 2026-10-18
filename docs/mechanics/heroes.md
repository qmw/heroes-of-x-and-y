# Heroes: classes, heroes, secondary skills, specialties, leveling

Files: `src/data/skills.js`, `src/data/heroClasses.js`, `src/data/heroes.js`, `src/engine/leveling.js`.
Tests: `tests/data/heroes.test.js`, `tests/engine/leveling.test.js`.

## 1. Secondary skills (`skills.js`)

29 skills: the 28 of the original plus HotA's **Interference** (here it exists *alongside*
Resistance instead of replacing it). Each has 3 levels (`levels[0]` Basic, `[1]` Advanced,
`[2]` Expert), each level a list of `Bonus` objects (see "Bonus types").

Extra field `specialtyParam`: the numeric field of `levels[n].effects[0]` that a `skill_percent`
bonus multiplies (`null` = the skill cannot be scaled).

| skill | Basic / Advanced / Expert | bonus type | specialtyParam |
|---|---|---|---|
| pathfinding | terrain penalty −25 / −50 / −75 points | `terrain_penalty_reduction` | percent |
| archery | ranged damage +10 / +25 / +50 % | `damage_percent` mode `ranged` | percent |
| logistics | land movement +10 / +20 / +30 % (SoD) | `movement_land` | percent |
| scouting | sight radius +1 / +2 / +3 | `sight_radius` | value |
| diplomacy | join share 25 / 50 / 100 %, surrender cost −20 / −40 / −60 % | `diplomacy` | surrenderDiscountPercent |
| navigation | sea movement +50 / +100 / +150 % | `movement_sea` | percent |
| leadership | morale +1 / +2 / +3 | `morale` | – |
| wisdom | learn spells of level 3 / 4 / 5 | `learn_spell_level` | – |
| mysticism | +2 / +3 / +4 mana per day (SoD; on top of the base 1) | `mana_regen` | value |
| luck | luck +1 / +2 / +3 | `luck` | – |
| ballistics | catapult control; shots 1 / 2 / 2; hit & damage tables below | `ballistics` | – |
| eagle_eye | 40 / 50 / 60 % to learn enemy spells of level ≤ 2 / 3 / 4 | `eagle_eye` | percent |
| necromancy | 10 / 20 / 30 % of slain creatures rise as skeletons | `necromancy_percent` | percent |
| estates | +125 / +250 / +500 gold per day | `resource_income` | value |
| fire/air/water/earth_magic | spells of that school cast at Basic / Advanced / Expert | `spell_school_mastery` | – |
| scholar | trade spells of level ≤ 2 / 3 / 4 between meeting heroes | `scholar` | – |
| tactics | pre-battle placement within 3 / 5 / 7 hex columns | `tactics` | – |
| artillery | ballista control; shots 1 / 2 / 2; double damage 50 / 75 / 100 % | `artillery` | – |
| learning | experience +5 / +10 / +15 % | `experience_percent` | percent |
| offense | melee damage +10 / +20 / +30 % | `damage_percent` mode `melee` | percent |
| armorer | physical damage taken −5 / −10 / −15 % | `damage_reduction_percent` | percent |
| intelligence | max mana +25 / +50 / +100 % | `mana_max_percent` | percent |
| sorcery | spell damage +5 / +10 / +15 % | `spell_power_percent` | percent |
| resistance | 5 / 10 / 20 % chance to resist hostile spells | `magic_resistance` | percent |
| first_aid | tent control; heals 1–50 / 1–75 / 1–100 hp | `first_aid` | healMax |
| interference | enemy hero spell power −10 / −20 / −30 % | `interference` | percent |

Ballistics tables (`hitChance` in % per target, `damageChance` = % to deal [0, 1, 2] wall damage):

| level | shots | wall | gate | tower | keep | damage 0/1/2 |
|---|---|---|---|---|---|---|
| none (engine default) | 1 | 50 | 25 | 10 | 5 | 10/60/30 |
| Basic | 1 | 60 | 30 | 15 | 7 | 0/50/50 |
| Advanced | 2 | 75 | 40 | 20 | 10 | 0/50/50 |
| Expert | 2 | 75 | 50 | 25 | 15 | 0/0/100 |

Approximations: the Ballistics tables and Diplomacy `joinPercent` are recalled, not verified.

## 2. Hero classes (`heroClasses.js`)

Two per faction (`kind: 'might' | 'magic'`):
Knight/Cleric, Ranger/Druid, Alchemist/Wizard, Demoniac/Heretic, Death Knight/Necromancer,
Overlord/Warlock, Barbarian/Battle Mage, Beastmaster/Witch, Planeswalker/Elementalist,
Captain/Navigator, Mercenary/Artificer.

- `startPrimary` — level 1 primary skills (always 5–6 points, power ≥ 1, knowledge ≥ 1).
- `primaryChancesLow` — % per primary skill for reaching levels 2–9; `primaryChancesHigh` for 10+.
  Each sums to 100.
- `skillWeights` — weight of every skill when a *new* skill is drawn. Weight 0 = the class can
  never be offered the skill at level-up (it can still own it as a starting skill or from a
  Witch Hut / University; owned weight-0 skills are upgraded with weight 1).

Bans (weight 0, original HCTRAITS): Necromancy for every non-Necropolis class; Leadership and
First Aid for Death Knight and Necromancer; Estates for Death Knight; Water Magic for Barbarian,
Overlord, Mercenary; Fire Magic for Ranger, Beastmaster; Resistance for Wizard, Warlock, Witch,
Elementalist, Artificer; Navigation for Battle Mage.

Accuracy (audited, docs/audit/heroes-artifacts.md): start stats, primary chances and secondary
skill weights of all 22 classes are the original SoD / HotA tables (each weight row sums to 112
without Interference; the `interference` column is HotA's).

## 3. Heroes (`heroes.js`)

197 heroes: 177 regular (16 per town; Cove has 17) and 20 `special: true` campaign heroes that
must not appear in taverns or random pools (`getFactionHeroes(faction)` excludes them).

`HeroDef` = DESIGN.md schema plus `faction`, `biography`, `special`, and
`startWarMachine` (`'ballista' | 'first_aid_tent' | 'ammo_cart' | 'cannon' | null`).

- Starting skills: two Basic skills or one Advanced (exceptions as in the original: Neela, Deemer,
  Uland with 3 levels; campaign heroes).
- Starting spell: every magic-class hero, every Necropolis hero and all Tower alchemists.
- Starting army: the faction's tier 1/2/3 base creatures with `min`–`max` counts
  (`FACTION_START_ARMY`). Heroes that start with a war machine have only the first two stacks.
  Simplification: the original gives some creature specialists their specialty creature instead,
  and makes the 2nd/3rd stack appear only with some probability; here every stack always appears.
- Special heroes: Catherine, Roland, Sir Mullich, Beatrice, Gelu, Giselle, Dracon, Xeron,
  Lord Haart (undead, id `lord_haart_undead`), Ranloo, Mutare, Mutare Drake, Kilgor, Boragus,
  Adrienne, Kinkeria, Bidley, Tark, Frederick, Tavin. (Gem and Sandro are regular heroes.)

Accuracy (audited): every SoD hero's class, start skills, start spell and specialty are pinned by
`tests/data/heroRoster.test.js`; Cove and Factory follow HotA (start spells of Spint and a few
spell-specialty modes of the HotA heroes are best guesses). Biographies are original H3online
text (no names of the original setting).

## 4. Specialty types

Closed set (`SPECIALTY_TYPES`). Every specialty also carries a `description`.
`specialtyBonuses(defId, heroLevel)` in `leveling.js` converts a specialty to `Bonus` objects; the
aggregator should call it with the hero's current level and treat the result like any other source.

| type | params | exact effect | emitted bonuses |
|---|---|---|---|
| `creature` | `creatures: [id...]` | Listed creatures get **+1 speed**, and attack and defense each `+ceil(base × 5% × floor(heroLevel / creatureTier))` (`creatureSpecialtyStatBonus`). `base` is the creature's unmodified stat. | `creature_stat` (speed) + `creature_specialty` |
| `war_machine` | `machineId`, `tier: 5` | Same attack/defense formula applied to the war machine creature, using the specialty's `tier` (5) instead of the creature's tier; no speed bonus. | `creature_specialty` with `tier` |
| `creature_bonus` | `creatures`, `attack`, `defense`, `damage`, `speed` | Flat, level-independent bonuses to the listed creatures (`damage` adds to both min and max damage). Kilgor (behemoths) and the undead Lord Haart (black knights): +5/+5/+10 damage; Mutare: dragons +5/+5; Xeron: devils +4/+2/+1 speed; Conflux planeswalkers. | one `creature_stat` per non-zero stat |
| `creature_upgrade` | `upgrades: { fromId: toId }` | The hero may upgrade `fromId` stacks in his army to `toId` in any town (or on the hero screen), paying the normal upgrade cost difference. | `creature_upgrade` |
| `skill` | `skillId` | The skill's `specialtyParam` value is multiplied by `(1 + 0.05 × heroLevel)`. No effect while the hero lacks the skill. | `skill_percent` with `percent = 5 × heroLevel` |
| `spell` | `spellId`, `mode`, mode params | See below. | `spell_specialty` |
| `resource` | `resource`, `amount` | `+amount` of the resource to the owner every day (350 gold or 1 rare resource). | `resource_income` |
| `speed` | `value` | All creatures in the hero's army get `+value` speed (Sir Mullich: 2). | `creature_stat` without filter |
| `mastery` | `school` | All spells of the school are cast at Expert mastery (Adrienne). | `spell_school_mastery` level 3 |

Spell specialty modes (`SPELL_SPECIALTY_MODES`):

| mode | params | effect |
|---|---|---|
| `level_scaled` | `percentPerStep: 3` | The spell's effect on a target stack is multiplied by `1 + 0.03 × floor(heroLevel / targetTier)`. "Effect" = damage for damage spells, hit points restored for cure/resurrection/animate dead, the stat delta for buffs/debuffs (bless, stone skin, weakness, bloodlust, precision — round the delta up), the hp threshold for hypnotize, the clone tier allowance/forget chance for the HotA spells. |
| `tiered` | `tierBonus: [3,3,2,2,1,1,0]` (Coronius: `[4,3,2,1,0,0,0]`) | The spell's stat delta (speed for haste, attack for bloodlust/precision/slayer, defense for stone skin, the penalty of weakness, all stats for prayer, luck for fortune) is increased by `tierBonus[targetTier − 1]` (tier ≥ 7 → 0). These are the original "fixed additive" specialists: Cuthbert, Olema, Mirlanda, Eanswythe (weakness), Labetha, Darkstorn, Merist, Xsi (stone skin), Inteus, Ash (bloodlust), Zubin (precision), Loynis (prayer), Brissa, Cyra, Terek (haste), Melodia, Daremyth (fortune), Coronius (slayer). |
| `fixed_percent` | `percent` | Effect × `(1 + percent/100)` regardless of level (Ciele +50 % magic arrow, Luna +100 % fire wall, Dargem +25 % air shield). |
| `fixed_value` | `value` | Stat delta `+value` (Aenain: disrupting ray −2 more defense). |

## 5. Leveling (`leveling.js`)

### Experience table
`expForLevel(level)`: 0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, 12200, 14700, 17500, 20600,
24320 for levels 1–13. Above: `step(n) = floor(step(n−1) × 1.2)` with `step(13) = 3720`, giving
28784, 34140, 40567, 48279, 57533, 68637 … exactly as the original. `MAX_HERO_LEVEL = 74`
(the original overflows 32-bit experience just after). `levelForExp(exp)` is the inverse.

### Level-up
`gainExperience(rng, hero, amount)`:
1. `hero.exp += floor(amount)` — `amount` is final; the **caller** applies `experience_percent`.
2. While `exp ≥ expForLevel(level + 1)` and below the cap: `level++`, roll one primary skill
   (`rollPrimarySkill`: class low table for the new level 2–9, high table for 10+) and add +1.
   Gaining knowledge does not refill mana.
3. Returns `{ levelUps: [{ level, primary, offers }] }`. Choices are **not** resolved.

Because the options of a level-up depend on the choice made at the previous one, only the first
level-up needing a decision has `offers` filled; later ones have `offers: null`. After applying a
choice with `applySkillChoice(hero, skillId)`, the game layer calls `offerSecondarySkills(rng, hero)`
to produce the next pending choice. Level-ups whose offer list is empty need no decision and do not
block the chain. A single-option offer can be auto-applied by the game layer.

### Secondary skill offer — `offerSecondarySkills(rng, hero)` → `[{skillId, level}]` (0–2 options)
Call exactly once per level gained (it advances the guarantee counters in `hero.skillCounters`).

- `upgradable` = owned skills below Expert. `fresh` = unowned skills with class weight > 0, only if
  the hero has fewer than 8 skills.
- If `upgradable` is non-empty: option 1 = an upgrade; option 2 = a new skill from `fresh`, or, when
  `fresh` is empty, a second (different) upgrade.
- If nothing is upgradable: both options come from `fresh`.
- Upgrades are drawn **uniformly** among the upgradable skills; new skills are drawn weighted by the
  class `skillWeights` (original rule). A skill never repeats within one offer.
- **Guarantees**: counters `wisdom` and `school` count level-ups since Wisdom / any magic school was
  last *offered*. When a counter reaches the period — Wisdom: 6 (might) / 3 (magic); magic school:
  4 (might) / 3 (magic) — the draw is forced: Wisdom is taken if it is in the pool being drawn
  from; otherwise, if a school is due and none is in the offer yet, the draw is restricted to the
  schools in the pool. Wisdom has priority over a school when both need the same option. A
  guarantee never overrides bans, the 8-skill cap or the Expert cap; an unmet guarantee stays due.
  The counter resets whenever the skill is offered (forced or by chance).
- `applySkillChoice(hero, skillId)` → `{ok:true, skillId, level}` or
  `{ok:false, error:'skill_already_expert'|'no_free_skill_slot'}`; throws on an unknown skill id.

### Hero creation — `createHero(rng, defId, opts?)`
`opts = { id?, owner?, pos? }`. Level 1, exp 0, class start primaries, `mana = 10 × knowledge`,
copied start skills, `spells = [startSpell]`, 7 army slots with the start stacks rolled in
`[min, max]` in slots 0–2, empty `temp`/`visited`, `movePoints = maxMovePoints = 1500` (placeholder;
the movement engine recomputes). Equipment: every slot array from `SLOT_COUNTS` filled with `null`,
then `catapult` in `war_machine[3]`, the start war machine (`ballista`/`cannon` → index 0,
`ammo_cart` → 1, `first_aid_tent` → 2), and the `spellbook` artifact for magic classes and any hero
with a start spell.

## Bonus types

Core types from DESIGN.md §3 used as specified: `morale`, `luck`, `sight_radius`, `mana_regen`,
`mana_max_percent`, `learn_spell_level`, `spell_school_mastery`, `resource_income`,
`necromancy_percent`, `experience_percent`, `magic_resistance`, `damage_reduction_percent`.
Types whose semantics needed pinning down, and new ones (marked NEW):

| type | params | exact semantics |
|---|---|---|
| `terrain_penalty_reduction` | `percent` | Subtracted (in points, base tile cost 100) from the terrain's move cost, never below 100. E.g. swamp 175 with Basic (25) → 150. |
| `damage_percent` | `mode: 'melee'\|'ranged'`, `percent` | Additive term in the attack damage multiplier for that attack mode. |
| `movement_land` / `movement_sea` | `percent` | Percent of the hero's base daily movement points on land / at sea. |
| `spell_power_percent` | `percent` (no `school`/`spellId` from Sorcery) | Multiplies damage of damaging spells cast by the hero. |
| `skill_percent` | `skillId`, `percent` | Multiplies the `specialtyParam` field of the hero's own bonus from that skill by `(1 + percent/100)`; several sources add their percents. Ignored if the hero lacks the skill or the skill's `specialtyParam` is null. |
| `creature_stat` | `filter?`, `stat`, `value` | As in DESIGN. NEW filter key **`creatureIds: [id...]`** (matches any listed creature). No filter = all stacks. `stat: 'damage'` adds to min and max damage. |
| `diplomacy` | `level`, `joinPercent`, `surrenderDiscountPercent` | `level` shifts the neutral-stack join check in the hero's favour; `joinPercent` = share of a willing stack that joins for free; surrender cost × (1 − discount/100). |
| `eagle_eye` | `percent`, `maxLevel` | After combat, each enemy spell of level ≤ `maxLevel` the hero can learn (Wisdom permitting) is learned with `percent` chance. |
| `scholar` | `maxLevel` | When two allied heroes meet, each teaches the other all spells of level ≤ the higher `maxLevel` that the receiver's Wisdom allows. |
| `tactics` | `hexes` | Tactics phase placement depth in columns; if both sides have it only the difference counts. |
| `ballistics` | `control`, `shots`, `hitChance {wall, gate, tower, keep}`, `damageChance [p0,p1,p2]` | Catapult behaviour during sieges (see §1 table). |
| `artillery` | `control`, `shots`, `doubleDamagePercent` | Player controls the ballista (and arrow towers when defending); shots per round; chance for double damage. |
| `first_aid` | `control`, `healMin`, `healMax` | Player picks the tent's target; heals a random amount in the range (1–25 without the skill). |
| `interference` | `percent` | Enemy hero's effective spell power × (1 − percent/100), rounded up, minimum 1. |
| `creature_specialty` NEW | `creatures`, `percentPerStep`, `heroLevel`, `tier?` | For stacks of a listed creature: attack and defense `+ceil(base × percentPerStep% × floor(heroLevel / tier))`, `tier` = the bonus's `tier` if present, else the creature's tier. Helper: `creatureSpecialtyStatBonus`. |
| `creature_upgrade` NEW | `upgrades: {fromId: toId}` | Enables the extra upgrade path for the hero's army. |
| `spell_specialty` NEW | `spellId`, `mode`, `heroLevel`, `percentPerStep?`, `tierBonus?`, `percent?`, `value?` | Modifies that spell when cast by this hero, per the mode table in §4. |

## Cross-references to other data files

All verified against the current data files by tests (they skip if a module is missing).
- Creatures: start armies (`FACTION_START_ARMY`), the `CR` families in `heroes.js` (base + upgrade of
  most town creatures, e.g. `efreet`/`efreet_sultan`, `walking_dead`/`zombie`, `sea_dog`), the ten
  dragons, `sharpshooter`, `enchanter`, war machine creatures `ballista`, `cannon`.
- Spells: `bless, frost_ring, cure, weakness, curse, prayer, stone_skin, dispel,
  protection_from_air, protection_from_fire, ice_bolt, slayer, summon_boat, magic_arrow, fortune,
  haste, shield, hypnotize, chain_lightning, bloodlust, view_earth, fireball, inferno, slow,
  meteor_shower, death_ripple, animate_dead, resurrection, precision, fire_wall, disrupting_ray,
  air_shield, clone, forgetfulness, lightning_bolt`.
- Artifacts: `spellbook`, `catapult`, `ballista`, `first_aid_tent`, `ammo_cart`, `cannon`.
- Factions: `heroClasses` pairs in `factions.js` equal `getFactionClasses(faction)`.

## Checklist

- [x] 29 skills, 3 levels each, structured effects, exact numbers — `tests/data/heroes.test.js`
- [x] Magic school skills map to `spell_school_mastery` — `tests/data/heroes.test.js`
- [x] 22 classes, might + magic per faction, chances sum to 100 — `tests/data/heroes.test.js`
- [x] Skill weights reference exactly the existing skills; original bans — `tests/data/heroes.test.js`
- [x] Hero roster: unique ids, valid refs, ≥ 16 regular heroes per town, 8 per class — `tests/data/heroes.test.js`
- [x] Special campaign heroes flagged — `tests/data/heroes.test.js`
- [x] Start skills / spell / army / war machine integrity — `tests/data/heroes.test.js`
- [x] Closed specialty type set with well-formed params — `tests/data/heroes.test.js`
- [x] Cross-references to creatures, spells, artifacts, factions — `tests/data/heroes.test.js`
- [x] Experience table and +20 % growth, `levelForExp` — `tests/engine/leveling.test.js`
- [x] Primary skill roll distribution, low/high table switch at level 10 — `tests/engine/leveling.test.js`
- [x] `createHero` shape, spellbook/war machine rules, rolled army, determinism — `tests/engine/leveling.test.js`
- [x] `applySkillChoice` learn/upgrade/Expert cap/8-skill cap — `tests/engine/leveling.test.js`
- [x] Offer rule: upgrade + new, two new, two upgrades, single, none — `tests/engine/leveling.test.js`
- [x] Upgrade offer uniform, new-skill offer class-weighted — `tests/engine/heroAudit.test.js`
- [x] Original class tables (HCTRAITS) and full hero roster pinned — `tests/data/heroes.test.js`, `tests/data/heroRoster.test.js`
- [x] Property tests: careers keep skills capped / one primary point per level — `tests/engine/heroProperties.test.js`
- [x] Banned skills never offered; caps hold through a 40-level career — `tests/engine/leveling.test.js`
- [x] Wisdom and magic school guarantees; guarantees never break bans/caps — `tests/engine/leveling.test.js`
- [x] `gainExperience`: single and multi level-ups, deferred offers, level cap, determinism — `tests/engine/leveling.test.js`
- [x] `specialtyBonuses` mapping for every specialty type; creature specialty formula — `tests/engine/leveling.test.js`
- [ ] Applying the bonuses (aggregator, combat, adventure) — owned by `src/engine/bonuses.js` and the engines
- [ ] Learning applied to experience before `gainExperience` — caller (game layer)
- [ ] Probabilistic 2nd/3rd start stack and specialist-specific start armies of the original — not implemented
