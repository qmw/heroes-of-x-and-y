# Creatures & creature abilities

Data: `src/data/creatures.js` (190 entries), `src/data/abilities.js` (registry).
Tests: `tests/data/creatures.test.js`.

This document is the **spec for the combat engine**: for every ability id it states the trigger,
the formula, and the exceptions. "Count" always means the number of creatures currently alive in
the acting stack at the moment the ability resolves, unless stated otherwise.

## 1. Data model

Schema is exactly DESIGN.md section 3 (`Creature`). Conventions specific to this module:

- `tier`: 1-7 for town creatures; neutrals 1-7; **8** = faerie/rust/crystal/azure dragon;
  **0** = war machines (`warMachine: true`). Helpers such as `creaturesOfTier`, `creaturesOfFaction`
  and `neutralCreatures` never return war machines; use `getWarMachines()`.
- `flying: true` = flies. Teleporters (Devil, Arch Devil, Nymph, Oceanid, Fangarm) have
  `flying: false` plus the `teleport` ability; `creatureTags()` reports `flying` for both.
- Upgrade chains are linked lists (`upgradeOf` / `upgradesTo`). All are length 2 except
  Pirate -> Corsair -> Sea Dog. `upgraded` is true for every non-root member.
- Factory tier 7 has two alternative chains (Couatl / Crimson Couatl and Dreadnought / Juggernaut).
- `halfling` exists once and belongs to `factory` (as in HotA 1.7); it is not a neutral.
- `cost` always contains `gold`; one extra rare resource only at tier >= 7.
- Upgrade price = cost difference per resource (`getUpgradeCost(from, to)`).
- `growth` is the base weekly growth of the *dwelling* (same for base and upgrade).
- `shape` is one of `humanoid|beast|dragon|flyer|undead|elemental|construct|serpent|insect|plant|machine|giant|caster|rider`.

### Helpers exported by `creatures.js`
`CREATURES`, `CREATURE_BY_ID`, `getCreature`, `creaturesOfFaction`, `neutralCreatures`,
`getWarMachines`, `creaturesOfTier(tier, faction?)`, `getUpgrade`, `getBaseCreature`,
`getUpgradeChain`, `canUpgradeTo`, `getUpgradeCost`, `getCreatureAbility(creature, abilityId)`,
`hasAbility`, `isShooter`, `creatureTags`, `hasTag`, `factionLineup(faction)`,
`ORIGINAL_NEUTRAL_IDS`.

### Tags (`creatureTags(creature)`)
Tags are what spells put in their `immune` / `vulnerable` / `requires` lists
(`IMMUNITY_TAGS`, `VULNERABILITY_TAGS` in `src/data/spells.js`). Always go through
`creatureTags` / `hasTag`, never read the raw ability list, because of the derivation rules:

| tag | source |
|---|---|
| `undead` | ability `undead` |
| `non_living` | ability `non_living`, or `mechanical` (implies it) |
| `mechanical` | ability `mechanical` (Factory machines, Clockwork Knight, all war machines) |
| `living` | neither `undead` nor `non_living` |
| `mind_immune` | ability `mind_immune`, or `undead`, or `non_living`, or `spell_level_immunity` with `maxLevel >= 5` |
| `elemental`, `dragon` | abilities of the same name |
| `war_machine` | `warMachine: true` |
| `flying` | `flying: true` or ability `teleport` |
| `shooter` | `shots > 0` (the engine must additionally check remaining ammo) |
| `sightless` | `spell_immunity` listing `blind` (troglodytes) - also immune to `petrify_attack` |
| `fire_immune` | `school_immunity {school:'fire'}` |
| `cold_immune` / `lightning_immune` / `earth_immune` | `spell_immunity` listing `ice_bolt` / `lightning_bolt` / `meteor_shower` |
| `fire_vulnerable` / `cold_vulnerable` / `lightning_vulnerable` / `earth_vulnerable` | `spell_vulnerability` listing `fireball` / `ice_bolt` / `lightning_bolt` / `meteor_shower` |

Consequences of the life tags, to be enforced by the engine:

- `undead`, `non_living`: morale is always 0 (never good or bad morale rolls). Luck works normally.
- Not `living` => immune to: `death_stare`, `accurate_shot` kills, `life_drain` (nothing is
  drained from them), `poison_attack`, `aging_attack`, `disease_attack`, Lich `area_shot`
  (`affects: 'living'`), `resurrection`, `raise_demons` (as corpse), `devour_corpse` (as corpse).
- `war_machine`: no morale, no luck, never retaliates, immune to every on-hit effect in section 4,
  cannot be the target of creature-cast spells.

## 2. Roster

| faction | creatures | notes |
|---|---|---|
| castle, rampart, tower, inferno, necropolis, dungeon, stronghold, fortress, conflux | 14 each | 7 tiers x base+upgrade, SoD values |
| cove | 15 | Pirate has two upgrades |
| factory | 16 | two tier-7 chains |
| neutral | 27 | 18 from H3/HotA + 9 original (section 7) |
| war machines | 6 | ballista, cannon, catapult, first_aid_tent, ammo_cart, arrow_tower |

Conflux tiers: 1 Pixie/Sprite, 2 Air/Storm, 3 Water/Ice, 4 Fire/Energy, 5 Earth/Magma,
6 Psychic/Magic, 7 Firebird/Phoenix (growth 2).

## 3. Order of resolution of one melee attack

The engine must resolve an attack in this order (abilities named where they hook in):

1. Movement to the attack hex (record `hexesTravelled` = length of the path actually walked/flown;
   0 if the stack did not move). `strike_and_return` remembers the origin hex.
2. `cast_on_hit` with `timing: 'before'` (Serpent/Dragon Fly dispel, Dragon Fly weakness,
   Sea Witch weakness / disrupting ray) - applied before damage is computed.
3. `first_strike` on the defender: its retaliation is resolved now instead of at step 7.
4. Compute targets: primary + `attack_all_adjacent` / `three_headed_attack` / `breath_attack`.
5. Damage per target (section 3.1) and apply it. `life_drain`, `fire_shield`, `explode_on_death`
   react to the damage dealt.
6. On-hit effects with `timing: 'after'` on every *surviving primary* target: `death_stare`,
   `petrify_attack`, `paralyze_attack`, `disease_attack`, `aging_attack`, `poison_attack`,
   `cast_on_hit` (after), `lightning_strike`, `binding`, `acid_breath`.
   Roll each ability independently (one rng roll per ability, in the order they appear in the
   creature's `abilities` array).
7. Retaliation, if the defender survives, can retaliate (has retaliations left this round, is not
   blinded/petrified/paralyzed) and the attacker lacks `no_enemy_retaliation`. Retaliation is a
   normal melee attack restricted to the primary target (attacker) plus the retaliator's own
   multi-target pattern; it never triggers a counter-retaliation. On-hit effects apply to
   retaliations too, except `jousting`.
8. `double_attack`: if the attacker is still alive and the target is still alive, repeat steps 4-6
   once (no second retaliation). `ferocity`: if the first strike killed at least one creature and
   the target stack survives, strike once more in the same way (do not stack with `double_attack`).
9. `strike_and_return`: fly back to the origin hex (if still free).

Ranged attack: step 2, then damage, then `area_shot` splash, then after-effects that are not
melee-only, then `ranged_retaliation`; `double_shot` repeats the shot if the target survives and
ammo remains.

### 3.1 Damage formula hooks

Base H3 formula: `dmg = count * roll(minDamage..maxDamage) * (1 + offenseBonuses) * product(1 - reductions)`
with attack/defense difference `d = A - D`: `+5% per point` if `d > 0` (cap +300%),
`-2.5% per point` if `d < 0` (cap -70%). Creature abilities modify it as follows:

| ability | hook |
|---|---|
| `reduce_enemy_defense {percent}` | defender's effective Defense (after hero, spells, terrain) becomes `floor(D * (100 - percent) / 100)` when this stack attacks or retaliates. Behemoth 40, Ancient Behemoth 80, Frost Giant 20. Applies to melee only (none of them shoot). |
| `reduce_enemy_attack {percent}` | attacker's effective Attack becomes `floor(A * (100 - percent) / 100)` when it attacks this stack (melee or ranged). Nix 30, Nix Warrior 60. |
| `hates {targets, percent}` | additive `+percent%` (50) to the offense bonus sum when the *defender's creature id* is in `targets`. Pairs: Angel/Archangel <-> Devil/Arch Devil, Genie/Master Genie <-> Efreet/Efreet Sultan, Titan <-> Black Dragon. Applies to melee and ranged, attack and retaliation. |
| `jousting {percentPerHex}` | additive `+percentPerHex% * hexesTravelled` (5% per hex) to the offense bonus sum. Only on the attack that follows a move in the same action; never on retaliation; not on the second blow of anything. Zero when the defender has `charge_immunity` (Pikeman, Halberdier). |
| `double_damage_chance {chance}` | death blow: with `chance`% (20) add `+100%` to the offense bonus sum (like luck: a lucky death blow is x3 at equal attack/defense, not x4 - original formula). One roll per melee blow (attack and retaliation). Dread Knight, Shadow Assassin. |
| `no_melee_penalty` | shooters normally deal 50% in melee; this removes the penalty. |
| `no_range_penalty` | removes the 50% penalty for targets farther than 10 hexes. |
| `no_obstacle_penalty` | removes the 50% penalty for shooting over town walls. |
| `revenge` | Haspid: final damage is multiplied by `1 + (startCount - count) / startCount` (approaching x2 as the stack is wiped out), where `startCount` is the stack size at the start of battle. Simplified stand-in for HotA's formula. |
| luck / morale | `positive_luck` clamps the stack's luck to >= +1; `positive_morale` clamps morale to >= +1 (Minotaurs). `luck_doubling`: while a Leprechaun stack is alive on a side, every stack of that side rolls good luck with twice the normal probability. |

### 3.2 Retaliation counts

- Default: 1 retaliation per round, refreshed at the start of each round.
- `extra_retaliations {count}`: `1 + count` per round (Griffin: 2).
- `unlimited_retaliations`: every attack (Royal Griffin, Sentinel Automaton, Fangarm).
- `no_enemy_retaliation`: the *attacker* has it => defender does not retaliate and does not spend
  a retaliation (Naga, Vampire, Harpy Hag, Cerberus, Hydra, Sprite, Devil, Psychic/Magic Elemental,
  Corsair, Sea Dog, Shadow Assassin).

## 4. Ability reference

Each entry: **id** `{params}` - users - exact rule.

### 4.1 Movement
- **teleport** - Devil, Arch Devil, Nymph, Oceanid, Fangarm. Reachable hexes = all free hexes
  within `speed` distance (hex distance, not path length); ignores obstacles, walls, moat, other
  stacks. For jousting-like purposes distance travelled = hex distance.
- **burrow** - Sandworm, Olgoi-Khorkhoi. Pathing ignores obstacles and stacks (like flying) but
  not walls/moat; cannot be hit by `preemptive_shot` while moving.
- `flying` field: ignores obstacles and stacks, lands on a free hex; crosses walls and moat.

### 4.2 Attack patterns
- **double_attack** - Crusader, Wolf Raider. Two melee blows (see step 8). Each blow rolls damage,
  luck and on-hit effects separately.
- **double_shot** - Marksman, Grand Elf. Two shots, each consuming 1 ammo; second only if target
  alive and ammo > 0. Not in melee.
- **attack_all_adjacent** - Hydra, Chaos Hydra, Psychic/Magic Elemental. Every *enemy* stack
  adjacent to any hex the attacker occupies takes a separately rolled full attack. Also used
  when retaliating.
- **three_headed_attack** - Cerberus. Hits the target and any enemy stack occupying one of the two
  hexes that are adjacent to both the Cerberus' head hex and the target hex (the hexes
  "left and right" of the target as seen from the attacker). Enemies only.
- **breath_attack** - Green/Gold/Red/Black/Azure/Rust dragon, Firebird, Phoenix, Storm Drake.
  Also damages the stack in the hex directly behind the target hex along the attack direction
  (attacker head hex -> target hex, continued one step). Hits **friend or foe**; damage is
  computed separately against that stack's defense. Fire-school immunity does not block it
  (it is physical damage). No on-hit effects on the secondary target.
- **area_shot {radius, affects}** - Magog (`radius 1, affects 'all'`, fireball), Lich / Power Lich
  (`radius 1, affects 'living'`, death cloud). The shot damages the target and every stack
  (friend or foe) with any hex within `radius` of the target hex; each stack once, damage computed
  per stack. `living`: skips stacks without the `living` tag (including the primary target -
  a Lich shooting undead deals damage to the primary target only). Magog fireball is physical
  ranged damage (not blocked by fire immunity). Only for ranged attacks, not melee.
- **strike_and_return** - Harpy, Harpy Hag. After the attack and retaliation resolve, return to
  the origin hex. If it was bound (`binding`) during the attack it stays.
- **no_enemy_retaliation**, **unlimited_retaliations**, **extra_retaliations {count}** - see 3.2.
- **first_strike** - Bone Colossus. When attacked in melee and able to retaliate, its retaliation
  happens before the attacker's damage; if the attacker dies the attack is cancelled.
  Ignored if the attacker has `no_enemy_retaliation`.
- **ferocity** - Ayssid, Dire Wolf. See step 8.
- **siege_attack {level}** - Cyclops (1), Cyclops King (2), Cannon (1). In a siege the stack may
  target a wall section instead of a creature; resolved exactly like a catapult shot fired with
  Ballistics of that level (basic: 1 shot, advanced: 2 shots for Cyclops King). Consumes 1 ammo.
- **accurate_shot {percentPerCreature}** - Sea Dog (3). After a ranged attack on a `living`
  target: `kills = binomial(count, percentPerCreature/100)`, capped at
  `ceil(count * percentPerCreature / 100)`; removes that many whole creatures (same procedure as
  death stare). *Approximation of HotA.*
- **preemptive_shot** - Gunslinger, Bounty Hunter. Once per round, when an enemy stack ends a
  move adjacent to it in order to melee it, it shoots that stack first (1 ammo, no range penalty,
  no melee penalty). Triggered by walking, flying and teleporting attackers; `burrow` is exempt.
- **ranged_retaliation** - Bounty Hunter. When shot by an enemy and it has ammo and a retaliation
  left, it shoots back (uses the retaliation and 1 ammo).

### 4.3 On-hit effects
Unless noted: triggered by attack and by retaliation, after damage, only if the target stack
survives, never on `war_machine`.

- **death_stare {percentPerCreature: 10}** - Mighty Gorgon. Melee only. Target must be `living`.
  `kills = number of successes in 'count' independent rolls at 10%` (binomial(count, 0.10)),
  capped at `ceil(count / 10)`. Kills remove whole creatures from the stack *after* normal damage:
  remove the (possibly wounded) top creature first, then full ones. Implementation: one rng roll
  per gorgon is acceptable up to the cap; stop once the cap is reached.
- **cast_on_hit {spellId, chance, mastery, duration, timing, mode?}** - casts the spell on the
  target as a creature-cast effect: no mana, spell power irrelevant, fixed `duration` rounds,
  `mastery` 2 = Advanced values. Subject to the target's immunities (level immunity, `immune`
  tags of the spell, `spell_immunity`) and `magic_resistance`; **not** reflected by Magic Mirror.
  `mode: 'melee'` = melee blows only; `mode: 'retaliation'` = only when retaliating.
  | creature | spell | chance | notes |
  |---|---|---|---|
  | Unicorn, War Unicorn | `blind` | 20 | melee, 3 rounds |
  | Black Knight, Dread Knight | `curse` | 20 | 3 rounds |
  | Mummy | `curse` | 50 | 3 rounds |
  | Bog Witch | `curse` | 30 | melee or shot |
  | Serpent Fly, Dragon Fly | `dispel` | 100 | before damage; removes only *beneficial* spells from the target |
  | Dragon Fly | `weakness` | 100 | before damage (so it lowers the retaliation), 3 rounds, Advanced (-6 attack) |
  | Sea Witch, Sorceress | `weakness` | 100 | before damage, ranged or melee |
  | Sorceress | `disrupting_ray` | 100 | before damage; permanent -4 defense per hit (Advanced), stacks |
  | Fangarm | `hypnotize` | 20 | only on retaliation; 3 rounds; target must have total HP <= fangarm count x 25 |
- **petrify_attack {chance: 20, duration: 3}** - Medusa, Medusa Queen, Basilisk, Greater Basilisk.
  Melee only (Medusas do not petrify with shots). Status `petrified`: cannot act, cannot retaliate,
  takes 50% damage from all attacks. Removed after `duration` rounds or after the first time the
  stack is attacked (after that attack's damage). Treated as a level-3 effect. Immune:
  `sightless`, `war_machine`, and stacks with `spell_level_immunity` maxLevel >= 3. Undead and
  non-living stacks *can* be petrified.
- **paralyze_attack {chance: 20, duration: 3}** - Scorpicore. Status `paralyzed`: cannot act and
  cannot retaliate. Treated as a level-3 mind effect. Removed after
  `duration` rounds or when attacked (after damage). Immune: `mind_immune`, `war_machine`,
  `spell_level_immunity` maxLevel >= 3.
- **disease_attack {chance: 20, duration: 3, attack: -2, defense: -2}** - Zombie. `living` only.
  Status modifies attack and defense; re-application refreshes duration (does not stack).
- **aging_attack {chance: 20, duration: 3, hpPercent: 50}** - Ghost Dragon. `living` only.
  Max HP of each creature becomes `ceil(baseHp * 50%)` for the duration; current HP of the top
  creature is clamped to the new maximum. On expiry max HP is restored (current HP is not healed).
- **poison_attack {chance: 30, duration: 3, hpPercentPerRound: 10}** - Wyvern Monarch,
  Sea Serpent, Haspid, Giant Spider. `living` only. Immediately and at the start of each of the
  next rounds (total `duration` applications) max HP is lowered by 10% of the *base* max HP,
  never below 50% of base. Top creature HP clamped. Lasts until end of battle (the reduction is
  not restored); Cure removes it and restores max HP.
- **lightning_strike {chance: 20, damagePerCreature: 10}** - Thunderbird, Storm Drake. Melee
  attack (not retaliation). Deals `10 * count` as a `lightning_bolt` spell: obeys immunity
  (`lightning_immune`, level immunity vs level 2), `lightning_vulnerable` x2,
  `spell_damage_reduction`, `magic_resistance`. Count is taken after the retaliation.
- **binding** - Dendroid Guard/Soldier, Giant Spider. A stack hit in melee (attack or retaliation)
  becomes `bound` to this stack: it cannot move (may still attack adjacent stacks, shoot, defend).
  The bond breaks when the binder dies, moves, or is no longer adjacent. Flying/teleporting
  targets are bound as well. No chance roll (100%).
- **acid_breath {defenseReduction: 3, chance: 30, damagePerCreature: 25}** - Rust Dragon. Every
  attack/retaliation: target Defense -3 for the rest of the battle, cumulative, minimum 0. Then
  with 30%: extra `25 * count` physical damage (ignores attack/defense, not a spell).
  Applies to the breath's secondary target as well.
- **life_drain {percent: 100}** - Vampire Lord. After each melee blow against a `living` stack:
  `heal = min(damageDealt, target's total HP before the blow) * percent / 100`. First heals the
  wounded top creature, then resurrects dead vampires one at a time (a partially paid one is
  resurrected with the remaining HP), never above the stack's count at the start of battle.
  Resurrected creatures are permanent.
- **heat_stroke {radius, percent}** - Dreadnought (50), Juggernaut (100). After a melee attack,
  every *other enemy* stack within `radius` of the target hex takes `percent`% of the damage dealt
  to the primary target as fire spell-like damage (`fire_immune` blocks, `fire_vulnerable` x2,
  golem reduction applies). *Original design standing in for HotA's ability.*
- **fear {chance: 10}** - Azure Dragon. At the start of an enemy stack's turn, while at least one
  enemy stack with `fear` is alive, roll `chance`%: on success the stack skips its turn
  ("frozen in fear"; it does not get to wait/defend, keeps its retaliation). One roll per stack
  turn regardless of the number of Azure stacks. Immune: stacks that have `fear` themselves,
  `undead`, `non_living`, `war_machine`. Morale's extra turn is not checked on a feared turn.

### 4.4 Defensive
- **spell_damage_reduction {percent}** - Stone 50, Iron 75, Steel 80, Gold 85, Diamond 95,
  Clockwork Knight 50. Final damage of any *spell or spell-like* source (hero spells, creature
  spells, `lightning_strike`, `fire_shield`, `heat_stroke`) is multiplied by `(100 - percent)/100`,
  rounded down, min 1 when the unreduced damage was > 0. Does not affect non-damage spells.
- **magic_resistance {percent}** - Dwarf 20, Battle Dwarf 40, Crystal Dragon 20. Any *hostile*
  spell cast on the stack (hero or creature, single or mass/area) fails against this stack with
  `percent`% chance (one roll per stack per cast). Stacks additively with hero Resistance,
  artifacts and `resistance_aura`, capped at 100. Friendly spells are never resisted.
- **resistance_aura {percent: 20}** - Unicorn, War Unicorn. The unicorn itself and every allied
  stack adjacent to it gain +20% magic resistance (not cumulative from several unicorns).
- **spell_level_immunity {maxLevel}** - Green Dragon 3, Red Dragon 3, Azure Dragon 3,
  Storm Drake 2, Gold Dragon 4, Black Dragon 5, Magic Elemental 5. Immune to every spell of level
  <= maxLevel, **friendly ones included** (cannot be blessed, hasted, resurrected...). `maxLevel 5`
  = immune to all magic, which also grants the `mind_immune` tag. Area damage spells simply skip
  the stack. Creature-cast effects that map to a spell (`cast_on_hit`, `lightning_strike`) use the
  spell's level; non-spell statuses use the level stated in 4.3.
- **spell_immunity {spells}** - immune to exactly the listed spell ids (friendly or hostile):
  Troglodytes `blind`; Air/Storm `meteor_shower`; Water/Ice, Nymph/Oceanid, Frost Giant
  `ice_bolt, frost_ring`; Earth/Magma `lightning_bolt, chain_lightning, armageddon`;
  Storm Drake `lightning_bolt, chain_lightning`.
- **school_immunity {school}** - Efreet, Efreet Sultan, Fire/Energy Elemental, Firebird, Phoenix
  (`fire`). Immune to every spell of that school, friendly included, to `fire_shield` return
  damage, to `heat_stroke`, to Fire Wall and to Armageddon/Inferno/Fireball.
- **spell_vulnerability {spells, percent: 100}** - damage from the listed spells is multiplied by
  `(100 + percent)/100` (x2) before `spell_damage_reduction`:
  | creature | immune | double damage |
  |---|---|---|
  | Air / Storm Elemental | Meteor Shower | Lightning Bolt, Chain Lightning, Armageddon |
  | Water / Ice Elemental | Ice Bolt, Frost Ring | Fireball, Fire Wall, Inferno, Armageddon |
  | Fire / Energy Elemental | all fire school | Ice Bolt, Frost Ring |
  | Earth / Magma Elemental | Lightning Bolt, Chain Lightning, Armageddon | Meteor Shower |
  | Frost Giant | Ice Bolt, Frost Ring | Fireball, Fire Wall, Inferno, Armageddon |
  All elementals are `non_living` (=> mind immune, no morale). These lists and the spell-side tags
  (`*_immune`, `*_vulnerable`) describe the same rule; the engine may use either.
- **fire_shield {percent: 20}** - Efreet Sultan. When hit in melee (attack or retaliation) the
  attacker takes `floor(damageDealt * 20 / 100)` fire damage, where `damageDealt` is the damage
  actually inflicted (capped at the sultans' total HP). Counts as the `fire_shield` spell: blocked
  by `fire_immune` and by level-4 immunity, reduced by golem reduction. Not triggered by shots.
- **magic_mirror {chance: 20}** - Faerie Dragon. A hostile single-target spell cast on the stack
  is redirected with 20% to a random valid stack of the caster's side (if none, it fizzles).
- **regeneration** - Wight, Wraith, Troll, Bone Colossus. At the start of the stack's own turn
  the top creature's HP is restored to max. Does not resurrect.
- **rebirth {percent: 20}** - Phoenix. Once per battle per stack: when the last phoenix dies,
  `risen = floor(startCount * percent / 100)`, plus each of the remaining `startCount mod 5`
  phoenixes is reborn with `percent`% (original; zero is possible - no minimum). The stack stays on its hex with `risen` creatures at full HP, all statuses
  removed. `startCount` = size at the start of battle. Not triggered a second time.
- **charge_immunity** - Pikeman, Halberdier. See `jousting`.
- **invulnerability {rounds: 1, casts: 1}** - Crimson Couatl. As its action, once per battle, the
  stack becomes immune to all damage and all spells until the start of its next turn.
- **explode_on_death {damagePerCreature}** - Automaton 9, Sentinel Automaton 12. Whenever one or
  more creatures of the stack are killed, every stack adjacent to it (both sides, except
  automatons) takes `damagePerCreature * killed` physical damage (ignores attack/defense).
  *Approximation of HotA.*

### 4.5 Auras and hero interaction
Active while at least one creature of the stack is alive; multiple stacks of the same creature do
not stack unless stated.

- **army_morale {value: +1}** - Angel, Archangel, Bellwether Armadillo: all allied stacks +1.
- **enemy_morale {value: -1}** - Bone Dragon, Ghost Dragon, Bone Colossus: all enemy stacks -1.
- **enemy_luck {value: -1}** - Devil, Arch Devil: all enemy stacks -1 luck.
- **positive_morale** - Minotaur, Minotaur King: own morale `max(morale, 1)`.
- **positive_luck** - Halfling, Halfling Grenadier: own luck `max(luck, 1)`.
- **luck_doubling** - Leprechaun: see 3.1.
- **hero_spell_cost {value}** - Mage, Arch Mage (2), Bog Witch (1): own hero's combat spells cost
  `max(1, cost - value)`; not cumulative across stacks (take the largest).
- **enemy_spell_cost {value: 2}** - Pegasus, Silver Pegasus: enemy hero's combat spells cost +2.
- **magic_channel {percent: 20}** - Familiar: when the enemy hero casts, own hero gains
  `floor(manaSpent * 20 / 100)` mana, clamped to the hero's maximum mana.
- **mana_drain {value}** - Wraith 2, Will-o'-Wisp 1: at the start of each of the stack's turns the
  enemy hero loses `min(value, mana)` mana (not transferred).

### 4.6 Casters
Casting replaces the stack's action for the turn (it may not move first). Creature spells cost no
mana, ignore the hero's spell schools and use the listed `mastery` (2 = Advanced) with fixed
`duration` rounds. `casts` is per battle per stack.

- **spellcaster {spells, casts, mastery, target, random?, duration?, powerPerCreature?}**
  | creature | spells | casts | details |
  |---|---|---|---|
  | Master Genie | 20 beneficial spells (see data) | 3 | player picks a friendly stack; the spell is chosen at random among those the target is not immune to and does not already have; Advanced, 6 rounds |
  | Ogre Mage | `bloodlust` | 3 | chosen friendly stack, Advanced (+6 attack in melee), 6 rounds |
  | Storm / Ice / Energy / Magma Elemental | `protection_from_air/water/fire/earth` | 3 | chosen friendly stack, Advanced, 6 rounds |
  | Satyr | `mirth` | 1 | Advanced (mass): all allied stacks +2 morale, 6 rounds |
  | Leprechaun | `fortune` | 1 | Advanced: chosen friendly stack +2 luck, 6 rounds |
  | Faerie Dragon | Magic Arrow, Ice Bolt, Lightning Bolt, Chain Lightning, Frost Ring, Fireball, Inferno, Meteor Shower | 5 | the spell is rolled at random at the start of the stack's turn (shown to the player), who then picks the target or attacks normally instead. Damage = spell formula at Advanced with spell power `powerPerCreature (5) * count`. |
- **mass_caster {friendlySpells, enemySpells, mastery: 3, duration: 3, interval: 3}** - Enchanter.
  Automatic and free (does not use the action): at the start of the enchanters' turn in rounds
  1, 4, 7, ... (`(round - 1) % interval == 0`) pick uniformly one spell from
  `friendlySpells + enemySpells` (Air Shield, Bless, Cure, Haste, Slayer, Stone Skin / Curse, Slow,
  Weakness) and cast its Expert **mass** version on all allied / all enemy stacks for `duration`
  rounds. Spells with no valid target are excluded from the pick.
- **resurrection {hpPerCreature: 100, casts: 1}** - Archangel. Target: a friendly stack that has
  lost creatures (alive or fully dead with its corpse hex free), `living` only. Restores
  `100 * count` HP: heals the top creature then revives whole creatures, never above the stack's
  starting count. Permanent (survivors after battle).
- **raise_demons {hpPerCreature: 50, casts: 1, creatureId: 'demon'}** - Pit Lord. Target: the
  corpse of a fully dead **allied** `living` stack (not war machines). Creates a new friendly stack
  of Demons on the corpse hex: `n = floor(min(50 * count, corpseHp) / 35)` where 35 is the Demon's
  hp and `corpseHp = startCount * hp` of the dead stack (original: the raised hit points are capped
  by the corpse's hit points, e.g. 30 dead imps = 120 hp give 3 demons). Requires `n >= 1`. The corpse is
  consumed. The demons are permanent and need a free army slot after battle (they merge with an
  existing Demon stack if present).
- **repair {hpPerCreature, casts}** - Mechanic (5, 1 cast), Engineer (10, 2 casts). Target: an
  adjacent allied `mechanical` stack or war machine. Restores `hpPerCreature * count` HP, reviving
  whole creatures up to the starting count (same procedure as `resurrection`).
- **devour_corpse {hpPercent: 50}** - Olgoi-Khorkhoi. As its action, when adjacent to any `living`
  corpse: remove the corpse and heal/resurrect itself by `hpPercent`% of
  `corpse.deadCount * corpse.hp`, up to its starting count.

### 4.7 Adventure map
- **spying** - Rogue, Shadow Assassin. A hero whose army contains it sees exact counts of
  wandering monsters and of enemy hero/town armies on hover (as Expert Visions radius-less).
- **sandwalker** - Nomad. Hero's army containing it ignores the sand terrain penalty.
- **resource_generation {resource, amount, period, perStack?}** - Peasant: 1 gold per peasant per
  day (HotA "taxpayer") for peasants in hero armies and garrisons. Crystal Dragon:
  `perStack: true`, +3 crystal at the start of each week per stack owned.

### 4.8 War machines
All have `mechanical`, `immobile`, speed 0, size 2 (arrow tower 1), and act once per round in
initiative order after all creatures of equal speed (speed 0 => last).

- **immobile** - cannot move, never retaliates, no morale/luck, can only be targeted by damage
  spells (and by `repair`). Destroyed machines are lost after battle.
- **hero_attack_scaling** - Ballista, Cannon. Damage per shot =
  `roll(minDamage..maxDamage) * (heroAttack + 1)`; a stack count of 1; then the normal
  attack/defense formula. Like every stack of the army the machine also gets the hero's Attack and
  Defense (Ballista Attack = 10 + hero Attack - original / VCMI). Without Artillery the target is
  chosen at random among enemies; Artillery gives control and double-shot/double-damage chances
  (see skills doc). Ballista 24 shots, Cannon 12.
- **heals {min: 1, max: 25}** - First Aid Tent. Each round heals the top creature of one friendly
  `living` wounded stack for `roll(1..25)` (no First Aid) - skill levels raise the max to
  50/75/100 and give control of the target. Does not resurrect.
- **ammo_supply** - Ammo Cart. While alive, friendly shooters do not consume ammunition.
- **catapult** - present automatically for the attacker in sieges; behaviour in the siege doc.
- **arrow_tower** - defender's towers in a siege (1 keep + up to 2 side towers by fort level).
  Uses the entry's 10/10 and 10-15 damage as the *keep* base (side towers: half), never suffers
  range/obstacle penalties, cannot be attacked directly (destroyed only by the catapult).
  Final tower damage scaling by number of town buildings is defined in the siege doc.

## 5. Morale / status interactions summary

| status | acts | retaliates | removed when |
|---|---|---|---|
| blinded (spell) | no | no | duration, or attacked |
| petrified | no | no (takes 50% damage) | duration, or attacked |
| paralyzed | no | no | duration, or attacked |
| bound | yes, cannot move | yes | binder moves/dies |
| feared (one turn) | no | yes | immediately after the skipped turn |

## 6. Values I was unsure about (verify if fidelity matters)

- **Cove** stats/costs/AI values are from memory of HotA and should be close; `fightValue` for all
  HotA creatures (Cove, Factory, Satyr, Fangarm, Leprechaun, Steel Golem) is an estimate
  (~0.8 x AI value).
- **Factory**: all numbers are approximate recollections of HotA 1.7; abilities are simplified
  re-designs (`repair`, `explode_on_death`, `burrow`, `devour_corpse`, `preemptive_shot`,
  `ranged_retaliation`, `invulnerability`, `heat_stroke`; Halfling Grenadier's
  `no_obstacle_penalty`, Bellwether's morale aura are guesses).
- Sea Dog `accurate_shot` 3%/creature, Haspid `revenge` formula, Nix 30/60%: HotA approximations.
- Lizard Warrior damage is 2-5 (SoD; fixed by the combat audit, was 2-3). Firebird cost 1500 gold (SoD; HotA raised it to 2000). Efreet Sultan AI 1848.
- Mummy curse chance 50%; Wyvern Monarch poison chance 30%; Faerie Dragon spell power 5 x count;
  Enchanter cast interval (every 3rd round); Master Genie / Ogre Mage duration 6 rounds.
- Crystal Dragon 20% magic resistance (it has no listed specialty in the original besides the
  weekly crystals).
- Mage / Arch Mage are given `no_obstacle_penalty` (as in the original's hidden flag).
- War machine `aiValue`/`fightValue`, the catapult's cost, the Cannon's shots and all arrow tower
  numbers are placeholders.
- Peasant gold income is a HotA addition.

## 7. Original (non-H3) neutrals

| id | tier | abilities |
|---|---|---|
| `will_o_wisp` | 1 | flying, non-living elemental, drains 1 mana per turn |
| `dire_wolf` | 2 | ferocity, 2 hexes |
| `bog_witch` | 3 | shooter (8), curse 30% on hit, hero spells cost 1 less |
| `giant_spider` | 4 | binding, poison 30% |
| `shadow_assassin` | 4 | no retaliation, 20% double damage, spying |
| `clockwork_knight` | 5 | mechanical, jousting, 50% spell damage reduction |
| `frost_giant` | 6 | mind immune, cold immune, fire vulnerable, ignores 20% defense |
| `bone_colossus` | 6 | undead, first strike, regeneration, -1 enemy morale |
| `storm_drake` | 7 | dragon, breath, lightning strike, immune to level 1-2 and lightning |

## 8. Bonus types

None added by this module. Creature auras (`army_morale`, `enemy_morale`, `enemy_luck`,
`hero_spell_cost`, `enemy_spell_cost`) are resolved inside combat from the stacks present; the
adventure-map morale preview may map them to the existing `morale` / `enemy_morale` /
`enemy_luck` / `spell_cost` bonus types.

## 9. Checklist

Data (done, tested in `tests/data/creatures.test.js`):

- [x] unique ids / names, schema and value ranges - creatures.test.js
- [x] ability registry; every used id registered with required params; no unused ids - creatures.test.js
- [x] upgrade links symmetric, same faction/tier, upgrade strictly better/more expensive - creatures.test.js
- [x] 11 factions x 7 tiers x base+upgrade (Cove triple chain, Factory double tier 7) - creatures.test.js
- [x] neutrals (H3 + HotA + 9 original) and 6 war machines - creatures.test.js
- [x] shooters have shots, shooter-only abilities only on shooters - creatures.test.js
- [x] costs use valid resources - creatures.test.js
- [x] derived tags incl. element tags shared with spells.js - creatures.test.js
- [x] spot checks against original values (stats, costs, growth, shots, AI value, abilities) - creatures.test.js
- [x] referenced spell ids exist in spells.js - creatures.test.js
- [x] full SoD reference table (stats, growth, AI value, cost, shots, size, flying) + SoD ability matrix - creatures-original.test.js

Combat engine (`src/engine/combat/`, see docs/mechanics/combat.md):

- [x] retaliation counts: default / extra_retaliations / unlimited / no_enemy_retaliation - abilities-attack.test.js
- [x] double_attack, double_shot, ferocity - abilities-attack.test.js
- [x] attack_all_adjacent, three_headed_attack, breath_attack (friendly fire), area_shot (all / living) - abilities-attack.test.js
- [x] strike_and_return, teleport, burrow, flying - abilities-attack + movement.test.js
- [x] jousting +5%/hex and charge_immunity - abilities-attack.test.js
- [x] hates +50% (all three pairs, both directions) - abilities-attack.test.js
- [x] double_damage_chance 20% - abilities-attack.test.js
- [x] reduce_enemy_defense 40/80%, reduce_enemy_attack 30/60% - abilities-attack.test.js
- [x] no_melee_penalty, no_range_penalty, no_obstacle_penalty - damage + abilities-attack.test.js
- [x] death_stare binomial with cap ceil(count/10), living only - abilities-onhit.test.js
- [x] cast_on_hit (blind, curse, dispel, weakness, disrupting ray, hypnotize) incl. before/after timing - abilities-onhit.test.js
- [x] petrify, paralyze, disease, aging, poison statuses and their immunities - abilities-onhit.test.js
- [x] lightning_strike 10 x count with immunities/vulnerability - abilities-onhit.test.js
- [x] binding, acid_breath, life_drain (heal + resurrect, capped), fear 10% - abilities-onhit + turn.test.js
- [x] spell_damage_reduction 50/75/80/85/95 - abilities-defense.test.js
- [x] magic_resistance + resistance_aura - abilities-defense.test.js
- [x] spell_level_immunity 3/4/5 (friendly spells too), spell_immunity, school_immunity, spell_vulnerability x2 - abilities-defense.test.js
- [x] fire_shield 20%, magic_mirror 20%, regeneration, rebirth 20% once - abilities-defense.test.js
- [x] morale/luck auras, positive_morale, positive_luck, luck_doubling; undead/non-living neutral morale - turn.test.js
- [x] hero_spell_cost, enemy_spell_cost, magic_channel, mana_drain - abilities-defense.test.js
- [x] spellcaster (genie, ogre mage, elementals, satyr, leprechaun, faerie dragon), mass_caster - abilities-defense.test.js
- [x] resurrection 100 hp/archangel, raise_demons 50 hp/pit lord, repair, devour_corpse - abilities-defense.test.js
- [x] invulnerability, explode_on_death, heat_stroke, accurate_shot, preemptive_shot, ranged_retaliation, revenge, first_strike - abilities-defense + abilities-attack.test.js
- [x] siege_attack (cyclops, cannon), arrow towers, catapult - siege.test.js (combat.md §10a)
- [x] war machines: ballista/cannon scaling, first aid tent, ammo cart - machines-result.test.js
- [ ] adventure: spying, sandwalker, resource_generation - adventure engine (not combat)
