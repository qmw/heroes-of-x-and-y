# Spells — mechanics spec

Data: `src/data/spells.js`. Tests: `tests/data/spells.test.js`.
The spell **effects engine** (combat: `src/engine/combat/`, adventure: `src/engine/adventure/`) is
implemented from this document. Everything here is normative; values marked **(unsure)** are
best-recollection of the original and listed again in §16.

Notation: `m` = casting mastery `0..3` (none, basic, advanced, expert), `SP` = caster's effective
spell power, `floor` = round down. All per-mastery arrays have 4 entries indexed by `m`.
In the original, *none* and *basic* give the same effect for every spell (only the cost differs);
the data keeps that.

## 1. Spell record

```js
{ id, name, school: 'air'|'earth'|'fire'|'water'|'all', level: 1..5,
  cost,                 // mana at mastery none (== costByMastery[0])
  costByMastery: [4],   // mana per mastery
  kind: 'combat'|'adventure',
  target,               // SPELL_TARGETS; base selection mode
  targetByMastery,      // null | [4] override (Dispel)
  target2,              // null | second selection ('hex' for Teleport, 'friendly_stack' for Sacrifice)
  category,             // damage|buff|debuff|heal|summon|control|utility|adventure
  alignment,            // 'positive'|'negative'|'neutral'  (see §7)
  power: [4], perPower, // value = power[m] + perPower * SP
  duration,             // null | 'power' | 'battle' | 'day' | number of rounds
  durationByMastery,    // null | [4] rounds (overrides a numeric duration)
  massAt,               // null | 3
  area,                 // null | {shape:'radius', r:[4]} | {shape:'ring', r:[4]}
                        //      | {shape:'chain', targets:[4], factor:0.5} | {shape:'line', length:[4]}
  effect,               // { type, ...params }  — closed set, §4
  immune: [tag],        // a stack with ANY of these tags is unaffected
  requires: [tag],      // a stack must have ALL of these tags to be affected
  vulnerable: [tag],    // a stack with ANY of these takes double damage
  resistible,           // magic resistance / Magic Mirror apply
  dispellable,          // Dispel / Cure / dispel_helpful can remove the active effect
  guild,                // can appear in mage guilds, shrines, scrolls, pyramids
  triggerChance,        // creature-only: default % (the creature ability's own params win)
  extra, creatureOnly, special, description: [4], aiValue }
```

Helpers exported by `spells.js` (use them instead of re-deriving): `getSpell`, `spellsOfSchool`,
`spellsOfLevel`, `spellSchools`, `castingMastery`, `spellCost`, `spellValue`, `spellDuration`,
`isMass`, `effectiveTarget`, `spellAffectsTags`, `vulnerabilityMultiplier`, `wisdomRequired`,
`guildWeight`, `spellAllowedInGuild`, `guildSpellPool`, `rollGuildLevel`, `rollMageGuild`, and the
lists `HERO_SPELLS`, `ORIGINAL_SPELLS`, `EXTRA_SPELLS`, `CREATURE_ONLY_SPELLS`, `COMBAT_SPELLS`,
`ADVENTURE_SPELLS` plus every closed vocabulary (`EFFECT_TYPES`, `CONTROL_KINDS`, `OBSTACLE_KINDS`,
`ADVENTURE_ACTIONS`, `AREA_SHAPES`, `DAMAGE_ELEMENTS`, `IMMUNITY_TAGS`, `VULNERABILITY_TAGS`,
`SLAYER_KINDS`, `SPELL_TARGETS`, `SPELL_CATEGORIES`).

Counts: 70 original (air 18, earth 17, fire 16, water 17, all 2) + 12 extra + 16 creature-only = 98.

## 2. Casting rules

### 2.1 Who may cast, how often
- A hero needs a spellbook, must know the spell (`hero.spells`, or a `grants_spell` bonus), and
  have `mana >= cost`.
- Learning a spell (guild, shrine, scholar, pyramid) requires Wisdom `wisdomRequired(level)`:
  levels 1–2 none, level 3 basic, level 4 advanced, level 5 expert. Scrolls / tomes / `grants_spell`
  ignore Wisdom.
- Combat: **one spell per hero per combat round**, only during the turn of one of the hero's own
  stacks (not in the tactics phase). Casting does not consume the active stack's action.
  A side without a hero cannot cast. Combat spells cannot be cast on the adventure map and vice
  versa.
- Adventure: any number per day, limited by mana (Dimension Door additionally by uses/day).
- `special` spells (Titan's Lightning Bolt) are cast only through the granting artifact, cost 0,
  have fixed power and count as the hero's cast for the round.

### 2.2 Mastery
`m = castingMastery(spell, {air, earth, fire, water})` = the hero's best mastery among the spell's
schools (`spell_school_mastery` bonuses; `school: 'all'` spells — Magic Arrow, Visions — use the
best of the four). Magic terrains (magic plains etc.) may force `m = 3` for a school; that is the
map/combat adapter's business: it passes the final mastery map.

### 2.3 Mana cost
`cost = spellCost(spell, m, delta)` = `costByMastery[m] + delta`, minimum 1 (0 stays 0), where
`delta` = sum of applicable `spell_cost` bonuses (`school` omitted or equal to one of the spell's
schools) plus enemy `enemy_spell_cost`-style effects. Mana is spent when the cast is accepted,
even if every target then resists. A cast with **no legal target at all** is rejected
(`ok:false`), costing nothing.

Cost table of the original spells is `costByMastery`; every spell gets cheaper at basic mastery
and stays there, except Teleport (15 / 12 / 3 / 3).

### 2.4 Effective spell power
`SP = hero.power` (primary + all `primary` bonuses, minimum 1) — the adapter supplies the final
number. `SP` is used for value **and** for `'power'` durations.

### 2.5 Duration
`rounds = spellDuration(spell, m, SP, extra)`:

| `duration` | meaning |
|---|---|
| `null` | instant |
| `'power'` | `max(1, SP + extra)` rounds; `extra` = sum of `spell_duration` bonuses |
| number / `durationByMastery[m]` | exactly that many rounds; `spell_duration` bonuses do **not** apply |
| `'battle'` | until the battle ends (helper returns `Infinity`; store `null` rounds in JSON state) |
| `'day'` | adventure: until the start of the caster's next day |

Round accounting: an effect applied in round `R` with `rounds = n` is active through the end of
round `R + n - 1` and is removed at the **start of round `R + n`** (so the round of casting counts
as the first round). Effects with `duration: 1` therefore expire at the start of the next round —
except Frenzy/Berserk/Fear/Thunderclap, which need the stack to still have its turn: for those
(`control` kinds `berserk`, `fear`, `paralyze` with duration 1, and `frenzy`) the effect lasts
until the end of the affected stack's **next own turn** (if the stack already acted this round,
that is its turn next round).

### 2.6 Target selection
`effectiveTarget(spell, m)` gives the selection mode:

| target | player selects | affected |
|---|---|---|
| `none` | nothing | per effect (summon, obstacles, earthquake, adventure) |
| `enemy_stack` / `friendly_stack` / `any_stack` | one living stack of that side | that stack |
| `dead_friendly_stack` | a friendly stack with dead creatures (may be fully dead, if its hexes are free) | that stack |
| `hex` | a hex | per `area` (line obstacles) |
| `area` | a hex (may be empty) | every stack with a hex inside the area |
| `all_enemies` / `all_friendly` / `all` | nothing | every stack of that side / both sides |
| `obstacle` | an obstacle | that obstacle |

- A stack may only be *selected* if it passes the immunity pipeline (§5) steps 1–4; the UI greys
  out invalid targets. Resistance (step 5–6) is rolled after the cast.
- "Friendly" means owned by the caster's side **at cast time** (a hypnotized stack is friendly to
  its controller).
- Mass (`massAt`, §8) turns `friendly_stack → all_friendly`, `enemy_stack → all_enemies`.

### 2.7 Area shapes (hex distances on the 15×11 grid)
- `radius r`: all hexes with hex-distance `<= r` from the chosen hex (`r=0` 1 hex, `r=1` 7,
  `r=2` 19). A two-hex creature is hit **once** if either of its hexes is inside.
- `ring r`: hex-distance exactly `1..r` — excludes the centre (Frost Ring: the 6 neighbours).
- `chain`: see §6.3.
- `line length`: `length[m]` hexes in a vertical line. The chosen hex is the top one; the others
  continue to the lower-right / lower-left alternately (i.e. hexes `(x', y+1)`, `(x'', y+2)` that
  are mutual neighbours, preferring the neighbour with the same pixel column). All hexes must be on
  the field and free of stacks and obstacles (Fire Wall may overlap nothing either).
- Spells with `effect.friendlyFire: true` hit the caster's own stacks too.

## 3. Value formula & multipliers

Base: `value = spellValue(spell, m, SP) = power[m] + perPower * SP`.
`effect.fixed` (Titan's Lightning Bolt) or `perPower == 0` simply makes it SP-independent.

### 3.1 Damage pipeline (types `damage`, `damage_over_time`, obstacle damage, `damage_shield`)
Applied in exactly this order, all multiplications in floating point, a single `floor` at the end,
minimum 1 if the stack is affected at all:

1. `base = power[m] + perPower * SP` (creature-cast: §12).
2. **Sorcery & generic bonuses**: `× (1 + sum(spell_power_percent without school/spellId) / 100)`
   — Sorcery 5/10/15% plus `skill_percent{skillId:'sorcery'}` boosts and generic artifacts.
3. **School orbs / school artifacts**: `× (1 + sum(spell_power_percent with school ∈ spellSchools) / 100)`
   (Orb of the Firmament/Silt/Tempestuous Fire/Driving Rain +50% each). For `school:'all'` spells
   use the single best school sum, not all four.
4. **Spell specialty / per-spell bonuses**: `× (1 + sum(spell_power_percent with spellId == id) / 100)`.
   A hero spell-specialty is expressed by the hero adapter as such a bonus with
   `percent = 3 * floor(heroLevel / targetCreatureTier)` (computed **per target**, tier 8 counts
   as 7); fixed-percent specialties (e.g. +50% Fire Wall style) pass a constant percent.
5. **Enemy reductions on the caster**: `× (1 + sum(enemy_spell_power_percent of the opposing hero) / 100)`
   (negative percents; floor the factor at 0).
6. Per target, in this order:
   a. elemental vulnerability `× 2` (§5.3) — at most once per spell hit;
   b. `damage_reduction{against:'spell_school'}` on the target (Protection from X):
      `× (1 - percent/100)`, school = any of the spell's schools; Magic Arrow (`all`) is reduced by
      the largest applicable protection only;
   c. creature `spell_damage_reduction` ability (golems: stone 50, iron 75, gold 85, diamond 95):
      `× (1 - percent/100)`;
   d. chain factor (§6.3);
   e. control `stone` on the target (`damageTakenPercent`, 50%).
7. `damage = max(1, floor(result))`, applied to the stack as ordinary hit point loss
   (kills `floor(damage / hp)` etc. exactly like attack damage). Spell damage ignores Attack /
   Defense / Armorer / Shield / Air Shield.

Step 6 damage of obstacles (Land Mine, Fire Wall) uses the SP, mastery and steps 2–5 factors
**frozen at cast time** (store the pre-target value in the obstacle).

### 3.2 Healing pipeline (`heal`, `heal_over_time`, `resurrect`)
`hp = power[m] + perPower * SP`, then step 4 (spell specialty, e.g. Resurrection/Animate Dead/Cure
specialists) only. Sorcery and orbs do **not** affect healing. Floor at the end.

### 3.3 Non-damage values
For every other effect the value is the raw `power[m]` (`perPower` is 0), except where a section
below says otherwise (Hypnotize / Thunderclap / Flesh to Stone HP limits use
`power[m] + perPower*SP`; summons use `perSpellPower[m] * SP`). Hero specialties in a buff spell
add their own flat bonus through the hero adapter (e.g. Haste specialist) — not part of spell data.

## 4. Effect types (closed set)

Every `effect` is `{ type, ...params }`. `sign` is `+1` or `-1`; "value" is `power[m]` unless the
sub-effect carries its own `value: [4]`.

| type | params | resolution |
|---|---|---|
| `damage` | `element: null\|fire\|cold\|lightning\|earth`, `friendlyFire?`, `fixed?`, `perAttacker?`, `useAttackDamage?`, `chance?`, `value?` | §3.1. `perAttacker`: multiply base by the acting stack's creature count. `useAttackDamage`: no formula — the triggering attack's rolled damage is applied to every other stack in `area` around the target (each with its own Defense). `chance`: % roll for a `multi` sub-effect. |
| `damage_over_time` | `element`, `tick: 'round_start'`, `immediate` | Active effect. If `immediate`, deal §3.1 damage on cast; then at the start of each following round while active deal the same amount again (re-evaluating step 6 only). With `duration: 3` and `immediate` that is 3 hits total. |
| `heal` | — | Restore up to `hp` (§3.2) to the **top creature only**; never raises the count. |
| `heal_over_time` | `tick`, `immediate` | As `heal`, on cast and at each following round start while active. |
| `resurrect` | `permanent: [4]`, `asCreatureId?`, `self?`, `percentOfStack?`, `perAttacker?`, `maxCountFromCorpses?`, `oncePerBattle?` | §9. |
| `sacrifice` | `permanent`, `victimImmune: [tag]` | §9.4. |
| `summon` | `creatureId`, `perSpellPower: [4]` | §10. |
| `clone` | `maxTier: [4]` | §11. |
| `stat_mod` | `stat: attack\|defense\|morale\|luck`, `sign`, `mode: all\|melee\|ranged`, `stacking?`, `min?` | Adds `sign * value` to the stat while active. `mode` restricts when it applies (`melee`: when the stack attacks/retaliates in melee; `ranged`: when it shoots). Attack/defense never drop below 0 (`min`). Morale/luck are clamped to −3..+3 after all sources. `stacking: true`: every cast adds another instance (Disrupting Ray, Acid Breath); otherwise recasting refreshes (§7.3). |
| `speed_mod` | `op: add\|percent`, `sign` | `add`: speed `+ sign*value`. `percent`: speed `× (1 + sign*value/100)`. Order: flat adds first, then percent; result `ceil`ed (Slow 50% on speed 5 → 3), minimum 1 for a mobile creature. Changes take effect from the next turn-order evaluation (current round's remaining queue is re-sorted). |
| `damage_mode` | `mode: max\|min`, `percent: [4]` | Every creature rolls `maxDamage` (Bless) / `minDamage` (Curse); the stack's base damage is then `× (1 + percent[m]/100)`, floored, minimum 1 — Bless 0/0/+3/+3 %, Curse 0/0/−20/−20 % (SoD). |
| `damage_reduction` | `against: melee\|ranged\|spell_school`, `school?` | Incoming damage of that kind `× (1 - value/100)`. Melee/ranged: multiplied with Armorer etc. in the attack formula. Spell school: §3.1 step 6b. |
| `damage_shield` | `element` | After the target survives or dies from a **melee** attack, the attacker takes `floor(damageDealt * value/100)` damage of `element` (subject to the attacker's elemental immunity, e.g. `fire_immune` attackers ignore Fire Shield). `damageDealt` is capped at the defender's remaining HP before the hit. Not affected by §3.1 steps 2–5. |
| `max_hp_mod` | `op: 'percent'`, `sign`, `perRound`, `floorPercent` | `perRound: false` (Aging): max HP of each creature `× (1 + sign*value/100)` (min 1) while active; current top-creature HP is clamped down; on expiry max HP is restored (current HP is not). `perRound: true` (Poison): on application and at each round start while active, max HP loses `value`% of the **original** max HP, never below `floorPercent`% of original; the loss stays for the rest of the battle (not restored on expiry; removed by Cure). |
| `extra_retaliation` | — | `+value` retaliations per round. |
| `frenzy` | — | While active: `attack += floor(defense * value/100)`, `defense = 0` (defense taken after all other modifiers). |
| `slayer` | `versus: [4][kind]` | `+value` attack when attacking / retaliating against a creature whose slayer kind is in `versus[m]` (§5.5). |
| `spell_immunity` | `maxLevel: [4]`, `removesExisting` | §5 step 3. On application removes all other active spell effects from the stack (positive and negative, `dispellable` or not, except `'battle'` ones). |
| `spell_reflect` | — | §5 step 6. |
| `dispel` | `which: all\|positive\|negative`, `obstacles: [4]` | §7.2. |
| `control` | `kind`, kind params | §6.4. |
| `teleport` | `crossMoat: [4]`, `crossWalls: [4]` | Move the stack to the chosen free hex(es) (both hexes for 2-hex creatures) ignoring obstacles in between. In a siege the destination may not be on the other side of the moat / wall line unless allowed at `m`. Does not trigger mines/quicksand/fire wall on the way; triggers them on the destination. Not a move: the stack keeps its action. |
| `obstacle` | `kind`, `count?: [4]`, `placement?`, `hiddenFromEnemy?`, `stopsMovement?`, `blocksMovement?`, `element?` | §6.5. |
| `remove_obstacle` | `kinds: [4][kind\|'natural']` | Remove the chosen obstacle if its kind is in `kinds[m]`. Siege walls, moat and towers can never be removed. |
| `wall_damage` | `hits: [4]`, `damagePerHit` | Siege only (rejected otherwise). `hits[m]` times: pick a random not-yet-destroyed wall section / gate / (never towers) uniformly and reduce its state by `damagePerHit` step (intact → damaged → destroyed). |
| `instant_kill` | `percentPerAttacker`, `maxKillsPerAttackers` | Death Stare, §12. |
| `life_drain` | `resurrects`, `permanent` | Vampire Lords, §12. |
| `adventure` | `action`, action params | §13. |
| `multi` | `effects: [...]` | Apply every sub-effect to the same target in order; one resistance/immunity check for the whole spell. Sub-effects never nest another `multi`. |

## 5. Who is affected — immunity & resistance pipeline

Run per (spell, target stack) in this order; the first failing step ends it. Steps 1–4 are
deterministic ("immune": the stack cannot even be targeted; in area/mass spells it is silently
skipped). Steps 5–6 are rolls.

1. **Tag check** — `spellAffectsTags(spell, tags)`:
   `requires` ⊆ tags, `immune` ∩ tags = ∅, and a `war_machine` is affected only by effect types
   `damage` and `dispel`.
2. **Creature abilities** (data from `abilities.js`):
   - `spell_level_immunity {maxLevel}`: immune if `spell.level <= maxLevel` — friendly **and**
     hostile spells alike. Green/Red dragon 3, Gold dragon 4, Black dragon / magic elemental /
     other "immune to all magic" 5. `creatureOnly` effects ignore this step **except** those with
     `category: 'damage'|'control'|'debuff'` cast against a `maxLevel: 5` creature, which is immune.
   - `spell_immunity {spells}`: immune if the list contains `spell.id`.
   - `school_immunity {school}`: immune if `school ∈ spellSchools(spell)` — except Magic Arrow /
     `school:'all'` spells, which only a creature immune to all four schools ignores.
   Dispel (`effect.type === 'dispel'`) and Cure's dispel part are exempt from step 2 only for
   *removing effects*: they still work on any stack that has an effect to remove.
3. **Anti-Magic** (active `spell_immunity` effect, `maxLevel[m]` of its cast): immune if
   `spell.level <= maxLevel`, friendly and hostile alike. Dispel **does** remove Anti-Magic only
   at expert Dispel (level 1 ≤ maxLevel 3 otherwise blocks it); `creatureOnly` effects ignore
   Anti-Magic except Thunderbolt and `dispel_helpful` (which cannot remove Anti-Magic).
4. **Artifact immunities** — `spell_immunity` bonuses of either hero:
   `{spellId}` exact spell; `{school}` whole school; `{maxLevel}` all spells up to that level;
   `side: 'own'` protects only the owner's stacks, `'both'` all stacks. (Pendants = one spell,
   `own`; Sphere of Permanence = Dispel, `own`; Orb of Inhibition = `maxLevel: 5, side: 'both'`:
   nobody can cast in that battle at all — `canCast` is false for both sides; Recanter's Cloak =
   levels 3–5 uncastable, modelled by the artifact author; Orb of Vulnerability: see step 5.)
5. **Magic resistance** — only if `spell.resistible` **and** the target is hostile to the caster
   (never on friendly fire to own troops, never on positive spells):
   `chance = creature magic_resistance ability % (dwarf 20, battle dwarf 40, crystal dragon…)
   + defender hero's `magic_resistance` bonus % (Resistance skill 5/10/20, artifacts) + friendly
   `resistance_aura` (unicorns 20, adjacent stacks only)`, capped at 100. Roll once per target per
   spell: `chance(rng, pct/100)` → the spell has no effect on that stack (event `spell_resisted`).
   **Orb of Vulnerability** on either side sets every stack's resistance chance to 0 and disables
   step 2's level immunities of creatures (dragons become targetable); it does not remove
   Anti-Magic nor elemental tag immunities.
6. **Magic Mirror** (`spell_reflect` effect or creature `magic_mirror` ability) — only for
   hostile, `resistible`, **single-stack-target** casts (not mass, not area, not chain jumps):
   roll `value`%. On success the spell is redirected to a uniformly random stack of the caster's
   side that passes steps 1–4 (if none: the spell fizzles); the new target rolls step 5 but cannot
   reflect again.

### 5.1 Creature tags (how the engine derives `tags` for a stack)

| tag | source |
|---|---|
| `undead` | ability `undead` |
| `non_living` | ability `non_living` or `mechanical` (not together with `undead`) |
| `mind_immune` | ability `mind_immune` |
| `war_machine` | `creature.warMachine`, siege towers |
| `sightless` | ability `spell_immunity` listing `blind` (troglodytes) |
| `flying` | `creature.flying` |
| `shooter` | `creature.shots > 0`, shots remaining, not blocked-forever (`requires` only) |
| `fire_immune` | ability `school_immunity {school:'fire'}` |
| `cold_immune` / `lightning_immune` / `earth_immune` | ability `spell_immunity` listing `ice_bolt` / `lightning_bolt` / `meteor_shower` |
| `fire_vulnerable` / `cold_vulnerable` / `lightning_vulnerable` / `earth_vulnerable` | ability `spell_vulnerability` listing `fireball` / `ice_bolt` / `lightning_bolt` / `meteor_shower` |

The tags exist so that **extra** spells (Storm, Fire Bolt, Tidal Wave, Stone Spikes, …) inherit the
elemental rules without creature data having to list them.

### 5.2 Mind spells
Blind, Berserk, Hypnotize, Forgetfulness, Frenzy, Mirth, Sorrow and creature Fear carry
`immune: ['mind_immune','undead','non_living','war_machine']`.

### 5.3 Elementals (original rules, reproduced by tags)

| creature | immune | double damage |
|---|---|---|
| Air / Storm elemental | Meteor Shower (`earth_immune`) | Lightning Bolt, Chain Lightning, Armageddon (`lightning_vulnerable`) |
| Earth / Magma elemental | Lightning Bolt, Chain Lightning, Armageddon (`lightning_immune`) | Meteor Shower (`earth_vulnerable`) |
| Fire / Energy elemental | whole fire school (`fire_immune`) | Ice Bolt, Frost Ring (`cold_vulnerable`) |
| Water / Ice elemental | Ice Bolt, Frost Ring (`cold_immune`) | Fire Wall, Fireball, Inferno, Armageddon (`fire_vulnerable`) |

Vulnerability multiplier is `2` if `vulnerabilityMultiplier(spell, tags) === 2` **or** the
creature's `spell_vulnerability` lists the spell id (then `1 + percent/100`); never both.
All elementals are also `non_living` (mind immunity, no resurrection, no poison/age/disease).

### 5.4 Other fixed immunities in data
- Bless, Curse: `undead` immune **(unsure)**.
- Death Ripple: `undead`, war machines. Destroy Undead: `requires: ['undead']`.
- Resurrection, Sacrifice (the raised stack), Regeneration: `undead`, `non_living`, war machines.
  Animate Dead: `requires: ['undead']`.
- Poison, Disease, Aging, Death Stare, Drain Life: living targets only.
- Quicksand, Land Mine, Entangle, Stone Spikes: `flying` creatures unaffected.
- Whole fire school (every combat spell with `school:'fire'`): `fire_immune` (auto-added by the
  builder — includes friendly fire spells such as Bloodlust, like the original efreet).
- Golems are not immune to damage spells: they take reduced damage (§3.1 step 6c) and are
  `non_living`.

### 5.5 Slayer kinds
`dragon`: every creature with ability `dragon`; `behemoth`: behemoth, ancient_behemoth; `hydra`:
hydra, chaos_hydra; `angel`: angel, arch_angel; `devil`: devil, arch_devil; `titan`: giant, titan.
Basic: dragon+behemoth+hydra; advanced: + angel, devil; expert: + titan. Bonus +8 attack.

## 6. Spell-specific resolution

### 6.1 Single-target & mass damage
Magic Arrow, Ice Bolt, Lightning Bolt, Implosion, Titan's Lightning Bolt (flat 600), Fire Bolt,
Stone Spikes: §3.1 on one enemy stack. Death Ripple (all non-undead stacks of **both** sides),
Destroy Undead (all undead of both sides), Armageddon (every stack of both sides), Tidal Wave
(enemy stacks only): §3.1 for each affected stack independently (independent resistance rolls for
hostile stacks; own stacks cannot resist).

| spell | cost | damage |
|---|---|---|
| Magic Arrow | 5/4 | 10·SP + 10/10/20/30 |
| Ice Bolt | 8/6 | 20·SP + 10/10/20/50 |
| Lightning Bolt | 10/8 | 25·SP + 10/10/20/50 |
| Implosion | 30/25 | 75·SP + 100/100/200/300 |
| Chain Lightning | 24/20 | 40·SP + 25/25/50/100, 4/4/4/5 targets, halving |
| Frost Ring | 12/9 | 10·SP + 15/15/30/60 (ring 1) |
| Fireball | 15/12 | 10·SP + 15/15/30/60 (radius 1) |
| Inferno | 16/12 | 10·SP + 20/20/40/80 (radius 2) |
| Meteor Shower | 16/12 | 25·SP + 25/25/50/100 (radius 1) |
| Death Ripple | 10/8 | 5·SP + 10/10/20/30 |
| Destroy Undead | 15/12 | 10·SP + 10/10/20/50 |
| Armageddon | 24/20 | 50·SP + 30/30/60/120 |
| Land Mine | 18/15 | 10·SP + 25/25/50/100 per mine, 4/4/6/8 mines |
| Fire Wall | 8/6 | 10·SP + 10/10/20/50, 2/2/3/3 hexes, 2 rounds |
| Titan's Lightning Bolt | 0 | 600 |

### 6.2 Area damage
Fireball, Inferno, Meteor Shower, Storm (`radius`), Frost Ring (`ring`): each stack with a hex in
the area is hit once, friend or foe.

### 6.3 Chain Lightning
1. First target = selected enemy stack; takes full damage `D` (§3.1 steps 1–5).
2. Each next target = the nearest (hex distance, ties: lowest stack id) living stack **of either
   side** not yet hit by this cast, that passes §5 steps 1–4; damage is `D × 0.5^k` for the k-th
   jump (factor applied at step 6d, floor at the end): `D, D/2, D/4, D/8 (, D/16)`.
3. `targets[m]` = 4/4/4/5 stacks in total. Stops early if no eligible stack remains.
4. A hostile jump target rolls resistance (§5 step 5); a resisting stack takes no damage but
   **still counts** as a link (the chain continues from it, and the halving proceeds).
   Immune stacks are skipped without consuming a link. Magic Mirror only applies to the first target.

### 6.4 Control (`effect.type: 'control'`)

Common params: `breakOnDamage` (effect ends when the stack takes any damage — after that damage
and its retaliation are resolved), `retaliationPercent[m]` (damage multiplier of the stack's
retaliation against the attack that hits it while controlled; 0 = no retaliation), `hpLimit: true`
(the cast is only legal if the target's total HP `(count-1)*maxHp + topHp < power[m] + perPower*SP`;
checked at cast time only, after §3.2-style specialty bonus if any).

| kind | effect while active |
|---|---|
| `blind` | Stack skips its turns (no move, attack, shoot, wait, defend bonus), cannot retaliate normally. When attacked: effect ends (`breakOnDamage`), and it retaliates once at `retaliationPercent[m]` = 50/50/25/0% damage (0 → no retaliation). Duration `SP`. |
| `paralyze` | As `blind`. Creature Paralyzing Venom: 3 rounds, breaks on damage, retaliation 25%. Thunderclap (extra): until the end of the stack's next turn, HP limit `15·SP + 10/10/20/40`, does **not** break on damage, retaliates normally. |
| `stone` | Stack skips its turns, cannot retaliate, takes `damageTakenPercent` (50)% of all damage (attack and spell); ends on damage (the hit that breaks it is already halved). Stone Gaze: 3 rounds. Flesh to Stone (extra): 2/2/3/3 rounds, HP limit `20·SP + 10/10/20/50`. |
| `berserk` | On its next turn the stack must attack the nearest stack (hex distance; ties broken by lowest stack id) regardless of side — shooters shoot it, others walk as far as needed and melee if reachable this turn, otherwise move towards it. The player has no control. Ends after it attacks, or at the end of that turn (`endsOnAttack`). The attacked stack retaliates normally. Area radius 0/0/1/2 around the selected hex; every non-immune stack in the area (friend or foe) is affected and rolls resistance separately. |
| `hypnotize` | Stack changes side for the duration: controlled by the caster, counts as the caster's for targeting, turn order unchanged. Legal only under the HP limit `25·SP + 10/10/20/50`. If the battle would end because only hypnotized stacks remain on a side, the hypnosis ends first (the original owner still has troops). After the battle the stack returns to its owner. Cannot be recast on an already hypnotized stack. |
| `forget` | `value` = 50/50/100/100: percent of the stack's creatures that cannot shoot. At 50% the ranged damage of the stack is computed with `ceil(count/2)` creatures; at 100% the stack has no ranged attack (melee only, with its usual melee penalty). Expert: mass. |
| `bind` | Stack cannot move (may attack adjacent stacks, shoot, retaliate). `whileAdjacent: true` (Dendroid binding): lasts while the binder is alive and adjacent; ends when the binder moves/dies; cannot be dispelled. Entangle (extra): 2/2/3/3 rounds, dispellable, flyers immune. Teleport still works on a bound stack and ends `whileAdjacent` binds. |
| `fear` | Stack loses its next turn (Azure Dragon, 10% chance checked when the stack's turn starts). |

### 6.5 Obstacles (`effect.type: 'obstacle'`)

| kind | placement | behaviour |
|---|---|---|
| `quicksand` | `count[m]` = 4/4/6/8 random free hexes (not adjacent to any stack at cast time if possible), whole field | Invisible to the enemy until triggered. A **walking** stack entering the hex stops there and loses the rest of its movement for this turn (it may still attack an adjacent enemy from that hex only if that was its destination). Revealed when triggered; stays for the battle. Flyers and the caster's own stacks ignore it. |
| `land_mine` | as quicksand | Invisible to the enemy. A walking **enemy** stack entering the hex stops and takes §3.1 damage (element fire, frozen cast values); the mine is consumed. Caster's stacks and flyers do not trigger it. Creatures native to the battlefield terrain see enemy mines and quicksand (original rule; optional — implement if terrain nativity is available in `CombatInput`). |
| `force_field` | `line` of 2/2/3/3 hexes from the chosen hex | Impassable for everyone (flyers can fly over but not land), blocks nothing for shooters. 2 rounds. |
| `fire_wall` | `line` of 2/2/3/3 hexes | Passable. Any stack (either side) that **enters or passes through** a wall hex, or **starts its turn** on one, takes §3.1 damage (element fire) once per turn. 2 rounds. `fire_immune` stacks take none. |

Obstacle spells are not resistible on cast; mine / fire wall damage ignores magic resistance but
respects immunities (§5 steps 1–4) and Protection from Fire.

### 6.6 Earthquake, Remove Obstacle, Dispel
See the table in §4 and §7.2. Remove Obstacle: basic natural obstacles only; advanced + Fire Wall;
expert + Force Field, Land Mine, Quicksand (only ones visible to the caster).

## 7. Positive / negative, dispelling, stacking

### 7.1 Alignment
- `positive`: cast on own stacks — buffs, heals, summons, Teleport. Never resisted.
- `negative`: cast on enemies — damage, debuffs, control. `resistible` (true for all hero-cast
  negative combat spells).
- `neutral`: obstacles, Dispel, Remove Obstacle, Earthquake, adventure spells.

Positive (hero): Shield, Air Shield, Fire Shield, Protection ×4, Anti-Magic, Magic Mirror, Cure,
Resurrection, Animate Dead, Sacrifice, Bless, Bloodlust, Precision, Stone Skin, Prayer, Mirth,
Fortune, Haste, Slayer, Frenzy, Counterstrike, Teleport, Clone, the four Summon Elemental spells;
extra: Static Charge, Regeneration.
Negative: all damage spells, Curse, Weakness, Disrupting Ray, Sorrow, Misfortune, Slow, Berserk,
Hypnotize, Forgetfulness, Blind; extra: Fog, Melt Armor, Thunderclap, Entangle, Flesh to Stone,
Immolation; creature: Poison, Disease, Aging, Paralyze, Stone Gaze, Bind, Acid Breath, Fear.

### 7.2 Dispel rules
An *active effect* on a stack is `{ spellId, mastery, value(s), roundsLeft|null, casterSide, sourceStackId? }`.

- **Dispel** (`which: 'all'`): removes every active effect whose spell has `dispellable: true`,
  positive and negative. Targets by mastery: none/basic one friendly stack; advanced any stack;
  expert **all stacks on the field** plus (`obstacles[3]`) every magical obstacle (Quicksand,
  Land Mine, Force Field, Fire Wall — both sides'). Dispel on an enemy stack is not resistible
  and ignores level immunities, but is blocked by Anti-Magic below expert and by an artifact
  `spell_immunity {spellId:'dispel'}` protecting that stack.
- **Cure** (`which: 'negative'`): removes active effects with `alignment: 'negative'` and
  `dispellable: true`, **plus** Poison's HP loss (restores max HP), then heals.
- **dispel_helpful** (Serpent/Dragon Fly attack): removes `alignment: 'positive'`, `dispellable`
  effects from the attacked stack; never Anti-Magic.
- Never dispellable: Disrupting Ray, Acid Breath, Bind (creature), Anti-Magic (except expert
  Dispel), Clone (the clone itself is a stack, not an effect), summoned stacks, already-applied
  instant results.
- Anti-Magic application also wipes all removable effects from its target (§4 `spell_immunity`).

### 7.3 Stacking & overrides
- One instance per spell id per stack. Recasting the same spell **replaces** the old instance
  (new mastery/values, new duration) — it never stacks, except `stacking: true` effects
  (Disrupting Ray, Acid Breath), whose instances accumulate without limit (defense floor 0).
- Different spells stack additively (Bless + Bloodlust + Prayer + Stone Skin + Haste all apply).
- **Opposites cancel**: applying a spell removes the active opposite on that stack, then applies
  itself:

  | pair |
  |---|
  | Haste ↔ Slow |
  | Bless ↔ Curse |
  | Mirth ↔ Sorrow |
  | Fortune ↔ Misfortune |
  | Bloodlust ↔ Weakness, Precision ↔ Fog (melee/ranged attack up vs down) — **do not cancel**, they coexist and sum (as in the original) |
  | Stone Skin vs Disrupting Ray / Melt Armor — coexist and sum |

  Prayer's speed bonus coexists with Slow (flat add first, then percent).
- Control precedence: a stack can hold only one of `blind`, `paralyze`, `stone`, `hypnotize`,
  `berserk` at a time; a new one replaces the old. `bind`, `forget`, `fear` coexist with anything.
- Frenzy is computed after every other attack/defense modifier.
- Active effects of a stack persist if the stack is hypnotized; all effects are removed when a
  stack dies completely (a later Resurrection brings it back clean) and at battle end.

## 8. Mass behaviour
`massAt: 3`: at expert the spell needs no target and is applied to **every** stack of the relevant
side that passes §5 steps 1–4 (each hostile stack rolls resistance separately; Magic Mirror does
not apply). Cost is unchanged. Mass originals: Bless, Curse, Bloodlust, Precision, Weakness, Stone
Skin, Prayer, Mirth, Sorrow, Fortune, Misfortune, Haste, Slow, Shield, Air Shield, Protection from
Air/Earth/Fire/Water, Cure, Counterstrike, Forgetfulness. Extra: Fog, Melt Armor.
Dispel uses `targetByMastery` (all stacks of both sides at expert).
Not mass at any level: Fire Shield, Anti-Magic, Magic Mirror, Slayer, Frenzy, Disrupting Ray,
Blind, Hypnotize, Teleport, Clone.
A mass spell with zero eligible stacks is rejected.

## 9. Raising the dead

Per stack the combat state must track `countAtStart` (creatures when the battle began — for summoned
stacks: when summoned), `count`, `topHp`, and `tempRaised` (creatures that vanish after the battle).

### 9.1 Resurrection (earth 4, 20/16 mana)
`hp = 50·SP + 40/40/80/160` (§3.2). Target: a friendly living-type stack (not undead, not
non-living, not war machine) that has lost creatures or HP, including a completely dead one whose
hexes are free.
1. First top up the top creature: `heal = min(hp, maxHp - topHp)` (if the stack is alive).
2. With the rest raise `n = min(floor(rest / maxHp), countAtStart - count)` creatures at full HP;
   if HP remains and still `count < countAtStart`, one more creature is raised with `topHp = remainder`
   (i.e. the stack's total HP pool simply grows by `hp`, capped at `countAtStart * maxHp`).
3. `permanent[m]`: none/basic `false` — the number of raised creatures is added to the stack's
   `tempRaised`. Losses during the battle are taken normally; at battle end
   `survivors = max(0, count - tempRaised)`. Advanced/expert: permanent (`tempRaised` unchanged).
A cast that would restore 0 HP (stack at full strength) is rejected.

### 9.2 Animate Dead (earth 3, 15/12 mana)
Same algorithm, `hp = 50·SP + 30/30/60/160`, only `undead` stacks, always permanent.

### 9.3 Creature resurrection
- Archangel `resurrection {hpPerCreature: 100}`: same algorithm with `hp = 100 × archangels`,
  permanent, once per battle, living targets only.
- Pit Lord `raise_demons`: target a dead friendly living stack; `hp = 50 × pitLords`;
  `n = min(floor(hp / demon.hp), deadCount)` (at least 1 if `hp >= demon.hp`); the corpse is
  replaced by a new permanent stack of `n` demons; once per battle.
- Phoenix `rebirth`: once per battle, when the stack is destroyed, `max(1, floor(countAtStart × 20/100))`
  creatures return at full HP (original adds a fractional chance; we use the deterministic floor, min 1).

### 9.4 Sacrifice (fire 5, 25/20 mana)
Select the stack to raise (`dead_friendly_stack`, living-type) and a victim (`target2`: another
friendly **living, non-undead** stack; not a war machine).
`hp = (SP + victim.maxHp + 3/3/6/10) × victim.count`. The victim is destroyed entirely (counts as
lost; cannot be resurrected afterwards), then `hp` is applied with the §9.1 algorithm, permanent.

### 9.5 Life drain
Vampire Lord: after its melee attack on a **living** stack, `hp = damageDealt` (capped by the
defender's HP before the hit) is applied to the attacker with the §9.1 algorithm (permanent, capped at
`countAtStart` creatures).

## 10. Summoning (Air/Earth/Fire/Water Elemental, 25/20 mana)
`count = perSpellPower[m] × SP` = 2/2/3/4 × SP creatures of `effect.creatureId`.
- A new stack appears on the caster's side in the first free hex scanning from the caster's back
  column (column 0 for attacker, 14 for defender), rows from the middle outwards. Rejected if no
  free hex.
- A side may have only **one kind** of elemental summoned per battle: casting the same summon again
  **adds** `count` creatures to the existing summoned stack if it is alive (or creates it anew if
  it died); casting a different kind is rejected for the rest of the battle once a kind was
  summoned, even if that stack has died (`cs.sides[side].summonedKind`).
- Summoned stacks act from the next turn-order evaluation and vanish after the battle. Killing
  them gives the enemy experience like any other kill (original behaviour).
- If only summoned stacks remain on a side, that side loses.
- Not affected by Sorcery/orbs; spell-specialist heroes use §3.1 step 4 on the count.

## 11. Clone (water 4, 24/20 mana)
- Target: friendly stack with `tier <= maxTier[m]` = 5/5/6/7 (tier 8 never), not a war machine,
  not itself a clone, and not already having a living clone.
- Creates a new stack of the same creature and **same count**, full HP, same remaining shots,
  no copied spell effects, placed on the nearest free hex(es) to the original. Rejected if none.
- The clone is controlled by the caster, acts normally (attacks, shoots, retaliates, special
  abilities), but **cannot cast** creature spells and its attacks do not life-drain/raise.
- Any damage ≥ 1 from any source destroys the whole clone. Its kills are real.
- Lifetime `SP` rounds (§2.5), or until the battle ends; a clone never survives the battle and is
  not a loss. Dispel does not remove it. Killing a clone gives no experience.
- Clones cannot be resurrected, sacrificed or cloned.

## 12. Creature-only effects (`creatureOnly: true`)

Triggered by creature abilities (`abilities.js`); the ability's own params (`chance`, `duration`,
`damagePerCreature`, …) override the spell record's defaults (`triggerChance`, `duration`,
`power`). They cost nothing, are **not resistible** (no magic-resistance roll, no Magic Mirror),
but obey §5 steps 1–4 with the exceptions stated there. They use the same active-effect records,
so Cure/Dispel work on the `dispellable` ones.

| id | ability | trigger & effect |
|---|---|---|
| `poison` | `poison_attack` (Wyvern Monarch) | 30% after a melee hit on a living stack that survives. `max_hp_mod perRound`: −10% of original max HP now and at each of the next 2 round starts (3 ticks), floor 50%. Not removed on expiry; Cure removes. |
| `disease` | `disease_attack` (Zombie) | 20%; −2 attack, −2 defense, 3 rounds. |
| `age` | `aging_attack` (Ghost Dragon) | 20%; max HP −50% for 3 rounds. |
| `paralyze` | `paralyze_attack` (Scorpicore) | 20%; §6.4, 3 rounds. |
| `petrify` | `petrify_attack` (Medusa, Basilisk) | 20% melee (Medusa also via its melee only); §6.4 `stone`, 3 rounds. |
| `bind` | `binding` (Dendroid) | 100% on melee hit; §6.4 `bind whileAdjacent`. |
| `acid_breath` | `acid_breath` (Rust Dragon) | Every attack: defense −3 for the battle (stacking). 30%: extra `25 × attackers` damage (no element, ignores Defense). |
| `thunderbolt` | `lightning_strike` (Thunderbird) | 20% after melee: `10 × attackers` lightning damage (§3.1 steps 6–7 only). |
| `death_cloud` | `area_shot` (Power Lich / Lich) | Shot damage also applied to every **living** (non-undead) stack adjacent to the target, both sides. |
| `fireball_attack` | `area_shot` (Magog) | Shot damage also applied to every stack adjacent to the target, both sides (fire element: `fire_immune` unaffected). |
| `death_stare` | `death_stare` (Mighty Gorgon) | After a melee attack on a living stack: each of the `n` attackers has 10% to kill; `kills = min(binomial(n, 0.10), ceil(n / 10), target.count)` whole creatures removed (top creature first), in addition to normal damage. |
| `fear` | `fear` (Azure Dragon) | At the start of each enemy stack's turn within the battle: 10% it loses the turn (mind-immune stacks unaffected). |
| `dispel_helpful` | `cast_on_hit` (Serpent Fly, Dragon Fly) | 100% before damage: remove positive dispellable effects. |
| `drain_life` | `life_drain` (Vampire Lord) | §9.5. |
| `raise_demons` | `raise_demons` (Pit Lord) | §9.3. |
| `rebirth` | `rebirth` (Phoenix) | §9.3. |

**Creatures casting regular spells** (`cast_on_hit`, `spellcaster`, `mass_caster`, protectors):
use the regular spell record with the ability's `mastery` and `duration` (default: mastery
advanced, duration 3 unless the ability says otherwise); value = `power[mastery]` with
`SP = ability.powerPerCreature × count` when given, otherwise the ability's fixed power or 0.
Such casts are free, never count as the hero's cast, **are** resistible when hostile, and obey
all of §5. (Unicorn Blind 20%, Mummy/Black Knight Curse, Dragon Fly Weakness, Ogre Mage
Bloodlust, Genie random buffs, Enchanter mass spells, Faerie Dragon damage spells.)

## 13. Adventure spells (`kind: 'adventure'`, `effect.type: 'adventure'`)

General: cast from the hero screen/spellbook on the adventure map by the active hero; the hero
needs mana; cost by mastery (§2.3). They are never resisted. Failing a chance roll still costs the
mana. `Result.events` gets `{type:'spell_cast', spellId, heroId, success}`.

### 13.1 Summon Boat (water 1, 8/7)
- Requirements: hero on land, at least one free water tile adjacent (8-neighbourhood) to the hero.
- Success chance `power[m]` = 50/50/75/100%.
- On success: the nearest (by map distance) **unoccupied boat owned by/last used by the player**
  (any boat without a hero if ownership is not tracked) on the same map level is moved to a free
  adjacent water tile. If the player has no such boat: at expert (`createsBoat[3]`) a new boat is
  created there; at lower mastery the spell fails (mana spent, event `no_boat`).

### 13.2 Scuttle Boat (water 2, 8/6)
Destroys one unoccupied boat within `range` 1 tile (adjacent) of the hero, chosen by the player
if several. Success chance 50/50/75/100%.

### 13.3 Visions (all 2, 4/2)
For the rest of the day, within `max(minRange 3, power[m] × SP)` tiles (1/1/2/3 × SP, Chebyshev)
of the hero, right-click/hover info on objects in `shows[m]` is exact:
- `monsters` (all masteries): exact creature count and what they will do when approached
  (join for free / join for gold / flee / fight) according to the current diplomacy evaluation.
- `heroes` (advanced+): enemy hero primary skills, exact army, mana.
- `towns` (expert): enemy town garrison and buildings.
The range multiplier per mastery is **(unsure)**.

### 13.4 View Earth (earth 1, 2/1) / View Air (air 1, 2/1)
Opens the world-map overview with markers on **both explored and unexplored** tiles of all levels:
- View Earth `shows[m]`: basic resources (loose piles); advanced + mines (with owner colour);
  expert + `terrain`: the whole terrain layer is shown (the map is revealed in this view only —
  it does **not** change `player.explored`).
- View Air `shows[m]`: basic artifacts; advanced + heroes (all players); expert + towns.
Instant; no lasting state.

### 13.5 Disguise (air 2, 4/2)
Until the start of the caster's next day, what **enemy players** see when inspecting this hero's
army (`mode[m]`): none/basic `strongest_stack` — every occupied slot is displayed as the hero's
strongest stack (highest `aiValue × count`: same creature and count); advanced `strongest_creature`
— every slot is displayed as the creature with the highest `aiValue` in the army with the largest
count among the hero's stacks; expert `hidden` — no army information at all. AI players' threat
evaluation must use the disguised army. Mode details **(unsure)**.

### 13.6 Fly (air 5, 20/15)
Until the end of the day the hero may move over any tile (obstacles, water, other objects, guarded
zones without triggering guards while passing), but may **end movement / stop** only on a tile he
could normally stand on (free passable land; visiting an object on arrival is allowed). Movement
cost of every step is the normal terrain cost (water and obstacle tiles count as the base cost
100, diagonals ×√2 as usual) `× (1 + power[m]/100)` = +40/40/20/0%. Path-finding must treat the
set of "landable" tiles separately from "passable in flight".

### 13.7 Water Walk (water 4, 12/9)
Until the end of the day the hero on land may walk over water tiles (not onto boats, not through
whirlpools/objects on water) at base cost 100 `× (1 + power[m]/100)` = +40/40/20/0%; land tiles
cost as normal. The hero may not end the day on water: a move is only accepted if the path ends on
land, and the remaining movement points must cover the entire water crossing.

### 13.8 Dimension Door (air 5, 25/20)
- Uses per day `usesPerDay[m]` = 2/2/3/4 (tracked per hero; resets each day).
- Movement cost `moveCost[m]` = 300/300/300/200 points (3/3/3/2 tiles); the hero must have at
  least that many movement points left, which are deducted.
- Range `range[m]` = 8/8/10/12 tiles (Chebyshev distance), same map level. The range is our rule:
  the original allows any tile on the visible screen **(unsure / design choice)**.
- Destination: a tile the hero could stand on — free, passable, no object, no hero. Hero on land →
  land tile; hero in a boat → free water tile (the boat moves along). The tile may be unexplored;
  if it turns out to be illegal the cast is rejected without cost (no information leak beyond
  "cannot teleport there").
- No guards are triggered for the tiles skipped; arriving next to a guard triggers the usual
  zone-of-control fight.

### 13.9 Town Portal (earth 4, 16/12)
- Movement cost 300/300/300/200 points; the hero needs at least that many.
- None/basic: teleports to the **nearest** own town (path-independent map distance, any level; ties:
  lowest town id) that has no visiting hero. If the nearest town is occupied the spell is rejected.
- Advanced/expert (`chooseTown`): the player chooses among own towns without a visiting hero.
- The hero arrives as the town's visiting hero (enters the town). Cannot be cast from a boat.

## 14. Mage guilds & spell availability

- Guild levels and spells per level: `GUILD_SPELLS_PER_LEVEL = [5, 4, 3, 2, 1]`; Tower's Library
  adds one spell per built level (`rollMageGuild(faction, rng, 1)`).
- Max guild level per town type (`MAGE_GUILD_MAX_LEVEL`): Castle 4, Stronghold 3, Fortress 3,
  Cove 4, all others 5. (The buildings data is authoritative for which guild buildings exist; this
  table must agree with it.)
- All five levels are rolled when the town is created (`town.mageGuild`), so the content is known
  to the engine and revealed to the player as levels are built. Rolling: per level, weighted picks
  without replacement from `guildSpellPool(faction, level)` with `guildWeight(spell, faction)`.
- Never in guilds: `special` (Titan's Lightning Bolt) and `creatureOnly` spells (`guild: false`).
- **Bans** (`MAGE_GUILD_BANS`):

  | town | never offers |
  |---|---|
  | Castle | Armageddon, Animate Dead, Death Ripple |
  | Rampart | Armageddon, Animate Dead, Death Ripple |
  | Tower | Animate Dead, Death Ripple |
  | Inferno | Bless, Cure, Prayer, Regeneration |
  | Necropolis | Bless, Cure, Prayer, Destroy Undead, Regeneration |
  | Dungeon | Bless, Prayer |
  | Stronghold | Animate Dead |
  | Fortress | Animate Dead |
  | Conflux | — |
  | Cove | Animate Dead, Armageddon |
  | Factory | Animate Dead, Death Ripple |

- **Weights**: default `MAGE_GUILD_SCHOOL_WEIGHTS[faction][school]` (10 = neutral; `all`-school
  spells 10), overridden per spell by `MAGE_GUILD_SPELL_WEIGHTS[id][faction] ?? [id]['*']`
  (Magic Arrow common 20; Dimension Door / Fly 6, Town Portal / Implosion 8; Armageddon 6 but 12 in
  Inferno/Dungeon; Animate Dead / Death Ripple 4 but 20 in Necropolis; Destroy Undead 6, Castle 12;
  Resurrection 3 in Necropolis; boats common in Cove).
  The original uses a per-spell × per-town probability table; ours is a school-affinity
  approximation with the well-known bans **(unsure: exact original probabilities and the complete
  ban list)**.
- Visiting a town with a guild teaches the hero every spell of the built levels his Wisdom allows
  (needs a spellbook; free). Shrines, scholars, pyramids, scrolls and Pandora's boxes draw from
  `HERO_SPELLS.filter(s => s.guild)` of the right level.

## 15. Extra spells (`extra: true`)

| spell | school / lvl | cost | effect |
|---|---|---|---|
| Fog | water 1 | 5/4 | enemy shooter: −3/−3/−6/−6 ranged attack, SP rounds, mass at expert |
| Thunderclap | air 2 | 10/8 | stun (paralyze) until end of target's next turn; HP limit 15·SP + 10/10/20/40 |
| Entangle | earth 2 | 8/6 | bind a walking enemy 2/2/3/3 rounds |
| Stone Spikes | earth 2 | 7/5 | 15·SP + 10/10/20/40 earth damage, walkers only |
| Fire Bolt | fire 2 | 8/6 | 20·SP + 10/10/20/50 fire damage |
| Melt Armor | fire 2 | 8/6 | −3/−3/−6/−6 defense, SP rounds, mass at expert |
| Regeneration | water 2 | 8/6 | heal 5·SP + 10/10/20/30 now and at the next 2 round starts (top creature) |
| Static Charge | air 3 | 12/9 | damage shield 10/10/15/20% as lightning, SP rounds |
| Immolation | fire 3 | 12/9 | 5·SP + 10/10/20/30 fire damage now and at the next 2 round starts |
| Storm | air 4 | 20/16 | 15·SP + 20/20/40/80 lightning, radius 2, friendly fire |
| Flesh to Stone | earth 4 | 18/15 | petrify 2/2/3/3 rounds; HP limit 20·SP + 10/10/20/50 |
| Tidal Wave | water 5 | 22/18 | 20·SP + 30/30/60/120 cold damage to all enemy stacks |

## 16. Values I was unsure of / design decisions

- Teleport cost 15/12/3/3 (original table as recalled); Summon Boat 8/7; Earthquake 20/17;
  Protection from Air 7/5, Protection from Earth 12/9.
- Blind retaliation 50/50/25/0%; Teleport moat/wall rule per mastery; Disguise modes; Visions range
  multiplier; Bless/Curse undead immunity; Death Ripple hurting non-living (golems/elementals) —
  we let it (only undead and war machines are immune).
- Bless / Curse advanced/expert: SoD values — max damage +3 % / min damage −20 % (floor, min 1) on the base damage.
- Dimension Door range (8/8/10/12) is ours; original is screen-limited.
- Mage guild probabilities and ban list are approximations (§14); `MAGE_GUILD_MAX_LEVEL` for
  Cove/Factory follows HotA as recalled (4 / 5).
- Summons: "one elemental kind per side" and adding to the existing stack follows the original.
- Phoenix rebirth is deterministic (`max(1, floor(20%))`).
- `aiValue` is a hand-tuned relative usefulness (0 for creature-only), not an original number.
- Deviations from DESIGN.md §3 Spell schema (DESIGN.md updated): extra fields `costByMastery`,
  `targetByMastery`, `target2`, `alignment`, `durationByMastery`, `vulnerable`, `requires`,
  `resistible`, `dispellable`, `guild`, `triggerChance`, `extra`, `creatureOnly`, `special`;
  `duration` also accepts `'battle'` and `'day'`; `area.shape` also `'ring'` and `'line'`;
  `massAt` is always `3` or `null`.

## Bonus types (consumed by the spell engine)

No new Bonus types are introduced by spell data. The engine reads these existing ones:
`spell_power_percent {school?, spellId?, percent}` (§3.1 steps 2–4), `enemy_spell_power_percent
{percent}` (step 5, declared by artifacts), `spell_duration {value}` (§2.5), `spell_school_mastery
{school, level}` (§2.2), `spell_cost {school?, value}` (§2.3), `magic_resistance {percent}` (§5
step 5), `spell_immunity {spellId?, school?, maxLevel?, side}` (§5 step 4), `grants_spell
{spellId}`, `learn_spell_level {level}` (§2.1).

## Checklist

Data (this phase):
- [x] 70 original spells with school, level, costs per mastery — `tests/data/spells.test.js`
- [x] damage tables (base per mastery + per-power) — `tests/data/spells.test.js`
- [x] buff/debuff values, mass-at-expert set, target/area shapes — `tests/data/spells.test.js`
- [x] closed vocabularies (effect types, control kinds, obstacle kinds, tags) validated — `tests/data/spells.test.js`
- [x] immunity / requires / vulnerability tags incl. elemental table — `tests/data/spells.test.js`
- [x] alignment / resistible / dispellable flags — `tests/data/spells.test.js`
- [x] adventure spell parameters — `tests/data/spells.test.js`
- [x] 12 extra spells, 16 creature-only effects — `tests/data/spells.test.js`
- [x] helpers: `spellCost`, `spellValue`, `spellDuration`, `effectiveTarget`, `castingMastery`, `spellAffectsTags` — `tests/data/spells.test.js`
- [x] mage guild bans, weights, deterministic rolling — `tests/data/spells.test.js`

Engine (later phase — implement from this spec):
- [x] cast legality, mana, one cast per round (§2) — `tests/combat/spells-special.test.js`
- [x] damage pipeline & multiplier order (§3.1) — `tests/combat/spells-damage.test.js`
- [x] heal / resurrect / animate dead / sacrifice / life drain (§3.2, §9) — `tests/combat/spells-special.test.js`
- [x] immunity & resistance pipeline, Anti-Magic, Magic Mirror, orbs (§5) — `tests/combat/spells-damage.test.js`, `spells-status.test.js`
- [x] area shapes & chain lightning (§2.7, §6.3) — `tests/combat/spells-damage.test.js`
- [x] every `control` kind (§6.4) — `tests/combat/spells-status.test.js`
- [x] obstacles: quicksand, land mine, force field, fire wall; remove obstacle; earthquake (§6.5) — `tests/combat/spells-special.test.js`
- [x] active effects: durations, dispel, opposites, stacking (§2.5, §7) — `tests/combat/spells-status.test.js`
- [x] mass spells (§8) — `tests/combat/spells-status.test.js`
- [x] summon elementals, clone (§10, §11) — `tests/combat/spells-special.test.js`
- [x] creature-only effects & creature casters (§12) — `tests/combat/abilities-*.test.js`, `spells-special.test.js`
- [x] adventure spells: boats, visions, view air/earth, disguise, fly, water walk, dimension door, town portal (§13) — `tests/adventure/spells.test.js`
- [x] mage guild generation & learning with Wisdom (§14) — `tests/data/spells.test.js`, `tests/game/town-heroes.test.js`, `tests/engine/hero.test.js`
- [x] every hero combat spell castable through the UI API at every mastery; full cost table; no casting without a spell book — `tests/combat/spells-audit.test.js` (audit: `docs/audit/spells.md`)
