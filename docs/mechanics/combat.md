# Tactical combat

Code: `src/engine/combat/` (`index.js` is the public API). Tests: `tests/combat/*.test.js`.
Contract: DESIGN.md §5. Creature ability semantics: `docs/mechanics/creatures.md` (main spec);
spell effects: `docs/mechanics/spells.md`.

| file | content |
|---|---|
| `hex.js` | 15×11 offset grid (odd rows shifted right), neighbours, distance, areas, 2-hex footprints |
| `state.js` | `setupCombat`, dice (`roll`, `rollInt`, `rollChance`), hero bonus lookups, stack creation, occupancy |
| `stats.js` | effective attack / defense / speed / morale / luck / resistance, tags, retaliation count |
| `effects.js` | status-effect system, spell damage, damage & death, heal / resurrect / summon / kill, obstacles |
| `damage.js` | attack damage formula, preview |
| `abilities.js` | on-hit abilities, turn-start abilities, activated creature abilities |
| `actions.js` | reachability, movement (traps), melee attack sequence, shooting, legal option lists |
| `machines.js` | ballista / cannon, first aid tent, ammo cart, catapult hook |
| `turn.js` | rounds, initiative, wait, morale, fear, automatic turns, tactics phase |
| `spells.js`, `spells/handlers.js` | hero / artifact / creature casting, targets, previews, `resolveSpell`; summon, clone, teleport, obstacles, remove obstacle, earthquake, sacrifice (§6a) |
| `result.js` | battle end, retreat / surrender, `CombatResult` |
| `legal.js` | `getLegalActions` |
| `ai.js`, `ai/*.js` | tactical AI `chooseAction` (§10b); `ai/baseline.js` = frozen original baseline |
| `siege.js` | siege: walls, gate, moat / mines, arrow towers, catapult, Cyclops / Cannon, Earthquake helper (§10a) |

## 1. State

`CombatState` is plain JSON (`JSON.stringify` round-trips; tested). Main fields: `rng`, `round`,
`phase` (`tactics|battle|over`), `active` (stack id awaiting an action), `lastSide`, `sides.{attacker,defender}`
(`hero` incl. `mana`/`maxMana`/`bonuses`, `army` = original 7 slots, `morale`, `luck`, `castThisRound`,
`fled`, `surrendered`, `gold`), `stacks[]`, `obstacles[]`, `siege`, `tactics`, `winner`, `endReason`,
`startEvents` (events produced by `createCombat`).

Stack: `id, side (owner), slot, creatureId, count, startCount, baseHp, maxHp, hp (top creature), attack,
defense, minDamage, maxDamage, speed, shots, size, pos (head hex), alive, warMachine, summoned, clone,
joinsAfter, tempRaised, poisonLoss, acted, waited, defending, moraleUsed, retaliationsUsed, castsLeft,
pendingSpell, invulnerable, effects[]`. Dead stacks stay in the list (corpses).

Optional extra `CombatInput` / `CombatSide` fields (all optional): `side.morale`, `side.luck` (pre-aggregated
base; otherwise computed: army mix + `morale`/`luck` hero bonuses), `side.gold` (surrender affordability),
`side.canRetreat:false`, `side.nativeTerrainAll`, `hero.level`, `hero.maxMana`, `input.tactics:false`,
`input.maxRounds`, `siege.escapeTunnel`, `input.spellLevelCap` (anti-magic garrison: 0), `input.overlayEffects`
(magic terrain: `spell_mastery {school, level}`, `spell_level_cap {maxLevel}`, `creature_stat {stat, value, filter}`
for both sides' stacks - Cracked Ice / Dunes - and `nullify_morale_luck`, which forces every stack's morale and luck
to 0 - Cursed Ground). `hero.defId` / `hero.classId` are kept for the UI. Test hooks: `input.force = {chance:{tag:bool}, damage:'min'|'max'|'avg'}` (`avg`: unrounded mean base damage, used by the AI look-ahead),
`input.forceRolls = [floats]` (also writable later as `cs.force` / `cs.forceRolls`).

Roll tags: `morale`, `bad_morale`, `luck`, `bad_luck`, `fear`, `resist`, `magic_mirror`, `rebirth`, `artillery`,
`double_damage_chance`, `death_stare`, `accurate_shot`, `petrify_attack`, `paralyze_attack`, `disease_attack`,
`aging_attack`, `poison_attack`, `lightning_strike`, `acid_breath`, `cast_on_hit:<spellId>`, `spell:<spellId>`,
`catapult_hit` (siege: catapult / Cyclops hit roll; wall damage 0/1/2 and random targets use plain rolls).

## 2. Battlefield & setup

- Attacker on the left (column 0), defender on the right (column 14). A 2-hex creature occupies its head
  hex and the hex behind it (attacker: x−1, defender: x+1); orientation never changes.
- Formation rows by number of stacks (original loose formation): 1: 5 · 2: 2,8 · 3: 2,5,8 · 4: 0,4,6,10 ·
  5: 0,2,5,8,10 · 6: 0,2,4,6,8,10 · 7: 0,2,4,5,6,8,10.
- War machines: ammo cart row 1, ballista/cannon row 3, catapult row 7 (attacker, sieges only), first aid
  tent row 9. None in creature banks.
- Creature bank (`bank:true`): attacker at the original middle spots, defenders in the corners/edges; no
  obstacles.
- Random obstacles (`obstacles:'random'`, default outside banks/sieges): 1–5 shapes of 1–3 hexes from the
  terrain's `obstacles` list, seeded, only in columns 2–12.
- Stack stats: creature base + `creature_stat` (filter / except / flat / percent) + `creature_specialty`
  (`ceil(base × pct × floor(level/tier))`) + native terrain (+1 attack, defense, speed) + hero Attack/Defense
  (war machines too: they are part of the hero's army; the Ballista's damage is additionally × (hero Attack + 1)).
- Sieges: no random obstacles; walls / gate / moat / towers per §10a; Tower towns' land mines are hidden
  `land_mine` obstacles of the defender (`siege: true`).

## 3. Rounds and turns

- Round start: per-stack flags reset (retaliations, wait, morale), hero cast flags reset, effect durations
  tick (round 2+), DoT/HoT/poison ticks, obstacle durations, clone lifetimes, `siegeOnRoundStart`.
- Initiative: highest effective speed first. Equal speed: the side that did not act last goes first (attacker
  at battle start), then army order. Waiting stacks act after everybody, slowest first (ties: reverse order).
  Speed changes re-sort the remaining queue immediately. Ammo carts never act; war machines have speed 0.
- Turn start (once per round): defend bonus and invulnerability end, moat/fire-wall damage, regeneration,
  mana drain, Enchanter mass cast, Faerie Dragon spell roll. Then: disabled (blind/paralyze/stone) → skipped;
  fear (10% if an enemy Azure Dragon lives; not undead/non-living/fear holders) → skipped; bad morale
  (`|m|/12`) → skipped; berserk → automatic attack on the nearest stack; uncontrolled war machine → automatic.
- Defend: Defense `+ max(1, floor(D/5))` (20%, rounded down) until the stack's next turn.
- Good morale: after any action except wait/defend, `m/24` chance of one extra action (once per turn).
- Morale = side base + enemy `enemy_morale` bonus + strongest friendly `army_morale` aura + weakest enemy
  `enemy_morale` aura + spell effects, clamped ±3; `positive_morale` ≥ 1; `block_positive_morale` ≤ 0;
  undead / non-living / machines always 0. Luck analogous (`enemy_luck`, `positive_luck`, `block_positive_luck`);
  good luck `l/24` (×2 with a Leprechaun alive), bad luck `|l|/12` (HotA).
- Tactics: if exactly one side's `tactics` bonus is deeper, that side is human and `input.tactics !== false`,
  the battle starts in phase `tactics`: `{type:'tactics_move', stackId, to}` within `hexes` columns of the
  own edge, `{type:'tactics_end'}` (or `auto`). `combat_start_cast` bonuses fire when round 1 starts.

## 4. Damage formula

`base` = Σ per-creature rolls (≤10 creatures) or `floor(Σ 10 rolls × count / 10)`. Bless: every roll = max +
bonus; Curse: max(1, min + bonus). Forgetfulness 50%: ranged uses `ceil(count/2)`. Ballista/Cannon: one roll ×
(hero Attack + 1).

`A` = attack + spell modifiers (mode melee/ranged) + Slayer + Frenzy (`floor(D_self × pct)`), × (1 − Nix%) floored.
`D` = defense + modifiers (min 0) + defend bonus − moat 3; Frenzy → 0; × (1 − Behemoth%) floored (melee).

`damage = floor(base × (1 + ΣI) × Π(1 − R))`, min 1, where
- I: `+5%·(A−D)` (max +300%), Offense/Archery `damage_percent`, lucky strike +100%, `hates` +50%,
  jousting `+5%/hex` (not vs `charge_immunity`, not on retaliation or second blows), death blow
  (`double_damage_chance`) +100%, Artillery double damage +100% (all additive, as in the original);
- R: `2.5%·(D−A)` (max 70%), Armorer `damage_reduction_percent`, Shield / Air Shield, range penalty 50%
  (> 10 hexes; not for `no_range_penalty`, `no_range_penalty` hero bonus, war machines), wall penalty 50%
  (`siegeShotPenalty`; not for `no_obstacle_penalty`), melee penalty 50% for shooters, blinded/paralyzed
  retaliation `100 − retaliationPercent`, petrified target 50%, bad luck 50%;
- then × Haspid `revenge` factor. Death blow: one roll per blow.

Kills: total pool `(count−1)·maxHp + hp` minus damage; `count = ceil(rest / maxHp)`, top hp = remainder.
Roll order inside one blow: luck, death blow, damage dice per target, then on-hit rolls.

## 5. Attack sequence

Melee (`doAttack`): move (traps may stop it) → preemptive shot of the target (if it moved) → `cast_on_hit`
before → `first_strike` retaliation → blow (targets: primary + all-adjacent / three-headed / breath), per target:
damage, life drain, fire shield, acid; heat stroke on the primary → on-hit after (primary) → retaliation
(unless `no_enemy_retaliation`, no retaliations left, or the target was just disabled by this blow) →
controls that existed before the attack break → lightning strike → second blow (`double_attack`, or
`ferocity` after a kill) → strike-and-return. Retaliations are never answered. Blinded/paralyzed stacks
answer at the spell's `retaliationPercent` and wake up; petrified never answer.

Shot (`doShoot`): `cast_on_hit` before → ammo (free with an Ammo Cart) → luck → primary + `area_shot` splash
(`all` or `living`) → acid → on-hit after (ranged-capable ones) → `ranged_retaliation` → second shot for
`double_shot` / Artillery. Shooting is impossible with an adjacent (non-machine) enemy unless `free_shooting`.

## 6. Status effects & spells (API for the spells agent)

ActiveEffect `{ spellId, mastery, value, roundsLeft|null, turnBased, casterSide, sourceStackId, state }`,
interpreted through `getSpell(spellId).effect` (`multi` = several parts). Supported status types:
`stat_mod, speed_mod, damage_mode, damage_reduction, damage_shield, max_hp_mod, extra_retaliation, frenzy,
slayer, spell_immunity, spell_reflect, control (blind/berserk/hypnotize/forget/paralyze/stone/bind/fear),
damage_over_time, heal_over_time`; instant: `damage, heal, resurrect, dispel`. Rules: one instance per spell
(replace) unless `stacking`; opposites cancel (haste/slow, bless/curse, mirth/sorrow, fortune/misfortune); one
hard control (blind/paralyze/stone/hypnotize/berserk) at a time; Anti-Magic wipes non-battle effects;
`turnBased` (frenzy, berserk, fear, 1-round paralyze) ends at the end of the stack's own turn; others are
removed at the start of round `R + n`. Poison loss stays until Cure.

Exports (`index.js` / `effects.js`):
`applySpellToStack(cs, spellId, {mastery, power, casterSide, sourceStackId?, duration?, extraDuration?, value?,
damage?, heal?, factor?, resistible?, allowMirror?, ignoreAntiMagic?}, target) -> events`,
`dealSpellDamage(cs, target, amount, {element, spellId, casterSide, factor?}) -> events`,
`canSpellAffect(cs, spellId, target, casterSide, {allowDead?, ignoreAntiMagic?})`, `addStatus`, `removeStatus`,
`dispelStack(cs, stack, 'all'|'positive'|'negative')`, `healStack`, `resurrectStack(cs, stack, hp, {permanent, maxCount})`,
`summonStack(cs, side, creatureId, count, hex?, {summoned, clone, joinsAfter, cloneRoundsLeft}) -> {stack, events}`,
`killStack`, `applyDamage(cs, stack, amount, info, events) -> {dealt, killed, died}`,
`placeObstacle(cs, {kind, hexes, side, rounds, damage, element, hidden, blocks}) -> {obstacle, events}`,
`removeObstacle`. `spells.js`: `getCastableSpells`, `getSpellTargets`, `castHeroSpell`, `resolveSpell`
(single / mass / all / radius / ring / chain), `heroMastery`, `heroSpellPower`, `heroSpellCost`,
`heroDamageMultiplier`, `applyCombatStartCasts`, and `EXTRA_HANDLERS` (§6a).
Movement triggers `quicksand`, `land_mine` and `fire_wall` obstacles (enemy walkers; fire wall: anyone,
once per turn and at turn start).

## 6a. Hero spells (`spells.js`, `spells/handlers.js`; spec: spells.md)

Every combat spell of `src/data/spells.js` (70 originals, 12 extras, Titan's Lightning Bolt) is castable.
- **Legality** (`getCastProblem` / `getCastableSpells`): phase `battle`, a hero, not yet cast this round, the
  active stack is controlled by the side, the spell is known (`hero.spells` or a `grants_spell` bonus; `special`
  spells only through `grants_spell`), not blocked (`block_spells` of either hero, `cs.spellLevelCap`, overlay
  `spell_level_cap`), mana ≥ cost, at least one legal target. Errors: `not_in_battle`, `no_hero`, `already_cast`,
  `not_your_turn`, `unknown_spell`, `unsupported_spell`, `spells_blocked`, `no_mana`, `no_target`, `bad_target`.
- **Numbers**: mastery = best of school skills, `spell_school_mastery`, `grants_spell.mastery`, overlay
  `spell_mastery`. SP = hero power after enemy Interference and `enemy_spell_power_percent` (min 1). Damage =
  value × Sorcery/generic × best-school orb × per-spell % (`heroDamageMultiplier`) × hero specialty per target,
  then the per-target steps of `dealSpellDamage`; heals: value × per-spell % × specialty (no Sorcery); summons:
  `perSpellPower × SP` × specialty only. `spell_specialty` (`specialtyAdjust`): `level_scaled`
  `×(1 + percentPerStep% × floor(heroLevel / targetTier))` (tier 8 = 7; status deltas rounded up),
  `fixed_percent` (status values floored), `tiered` `+tierBonus[tier-1]`, `fixed_value` `+value`; it scales
  damage, heals, status magnitudes, HP limits (Hypnotize, Thunderclap, Flesh to Stone), the clone tier allowance,
  Forgetfulness (cap 100) and fire wall / mine damage (`fixed_percent` only - frozen at cast).
- **Targets** `getSpellTargets(cs, side, spellId, sel?)` → `{mode, stackIds, anyHex, available?, hexes?,
  obstacleIds?, target2?}`. Cast `target` by mode: stack modes → stack id (or `{stackId}`); `area` → `{x, y}`;
  mass / `all` / `none` → null; `hex` (Force Field, Fire Wall) → top hex `{x, y}` (line = that hex and the hexes
  straight below, all free of stacks, blockers and obstacles the caster sees); `obstacle` → obstacle id;
  Teleport → `{stackId, hex}` (second step: `getSpellTargets(..., {stackId})` → `mode:'hex', hexes`);
  Sacrifice → `{stackId: raised, victimId}` (second step → victims). A bare stack id picks a default second
  target (Teleport: hex nearest the closest enemy; Sacrifice: cheapest victim) - convenience for the AI.
- **Preview** `getSpellAreaPreview(cs, side, spellId, hex, sel?)` → `{mode, valid, hexes, stackIds}`: area
  hexes and the stacks really affected (immunities applied), Chain Lightning jump order, line hexes,
  teleport footprint, obstacle under the cursor, the target stack, every stack of a mass spell.
  `visibleObstacles(cs, side)` hides the enemy's hidden mines / quicksand.
- **Handlers**: `summon` (one elemental kind alive per side; recast reinforces, `startCount` grows; first free
  hex from the back column; `stack.summonSpell`), `clone` (tier ≤ 5/5/6/7, never 8; same count and shots, full
  hp, `cloneOf`, `cloneRoundsLeft = SP (+ spell_duration)`, one living clone per stack), `teleport` (free
  destination, siege rule `siegeTeleportAllowed` / legacy `wallColumn`; traps on the destination only via
  `actions.enterHex`; releases binds), `obstacle` (quicksand / mines: `count[m]` random free hexes preferring
  hexes not next to a stack, hidden, battle-long; mines and fire walls store the damage frozen at cast; force
  field / fire wall: 2 rounds), `remove_obstacle` (`natural` = non-magical, never siege features or enemy-hidden
  traps), `wall_damage` (Earthquake: siege attacker only, `hits[m]` random intact wall sections / gate via
  `siege.damageWall`, never towers), `sacrifice` (`(SP + victim maxHp + power[m]) × victim count`, victim
  destroyed with no corpse, then permanent `resurrectStack`).
- Expert Dispel: every stack (Anti-Magic included) and every magical obstacle except town mines.
- Every hero cast is appended to `cs.sides[side].spellsCast` → `CombatResult[side].spellsCast` (Eagle Eye).

## 7. War machines, retreat, result

- Ballista/Cannon: auto random target unless `artillery.control`; `artillery.shots`, `doubleDamagePercent`.
  No range penalty. First aid tent: heals the top creature of a wounded living ally `roll(min..max)`
  (`first_aid` bonus: control, healMin/Max), never resurrects. Ammo cart: free ammo, no turns. Catapult:
  sieges only, delegated to `siege.catapultAct`. Machines never retaliate, have no morale/luck and are
  only affected by `damage`/`dispel` spells.
- Retreat: needs a hero, not `no_retreat` (either side), not a siege defender without escape tunnel
  (unless `always_can_retreat`). The army is lost. Surrender: also needs an enemy hero (or
  `always_can_retreat`) and `gold ≥ cost`; cost = `floor(Σ gold cost of surviving original troops × (1 − discount))` (full price, original),
  discount = Diplomacy `surrenderDiscountPercent` − `surrender_cost_percent`, capped at 90%. Army kept.
- End: a side without living non-summoned, non-clone, non-machine stacks loses (both → draw); if a side's only
  troops are hypnotized the hypnosis ends instead. `autoResolve(cs, {maxRounds=100})` (and `input.maxRounds`)
  ends as a **defender win** with reason `timeout` at the cap (the attacker failed to take the field);
  `advance` ends a battle where nobody can ever act as `stalemate` (draw).
- `CombatResult` (DESIGN §5) plus: `reason`, `surrenderCost`, per side `overflow` (new permanent stacks
  without a free slot), `killedEnemies` `[{creatureId, count, hp, living, summoned}]`, `killedHp`,
  `killedCount` (non-summoned enemy casualties - necromancy input; the adapter owns the formula).
  Survivors: per original slot `count − tempRaised`; summons and clones vanish; `joinsAfter` stacks
  (raised demons, `raise_on_kill`) merge into a slot of the same creature or the first free slot.
  Losses per creature id. Experience: winner gets Σ base hp of dead enemy creatures (summons included,
  clones not) + 500 if the loser had a hero; loser 0. `capturedArtifacts` when the losing hero neither fled
  nor surrendered. `warMachinesLost`: destroyed machines (all of them for a side that lost its army).

## 8. Hero bonus types used in combat

From the hero/artifact docs: `morale`, `luck`, `enemy_morale`, `enemy_luck`, `creature_stat`,
`creature_specialty`, `damage_percent`, `damage_reduction_percent`, `magic_resistance`, `spell_immunity`,
`negate_resistance`, `block_positive_morale`, `block_positive_luck`, `no_retreat`, `always_can_retreat`,
`surrender_cost_percent`, `diplomacy.surrenderDiscountPercent`, `enemy_spell_power_percent`, `interference`,
`no_range_penalty`, `no_obstacle_penalty`, `free_shooting`, `combat_start_cast`, `creature_regeneration`,
`raise_on_kill`, `no_resurrection`, `resurrect_fallen`, `spell_reflection`, `block_spells`, `artillery`,
`first_aid`, `tactics`, `spell_power_percent`, `spell_duration`, `spell_cost`, `spell_school_mastery`,
`grants_spell` (mastery / free), `no_alignment_penalty`, `native_terrain_all`, `ballistics` (siege: catapult
shots / hit / damage tables, control), `spell_specialty` (§6a).

## 9. Events

Every action returns ordered events: `combat_start`, `tactics_start`, `tactics_end`, `round_start {round}`,
`turn_start {stackId, side, round, resumed?, extra?}`, `turn_skipped {reason: disabled|fear|morale}`,
`morale {good}`, `luck {good}`, `move {from, to, path, mode: walk|fly|teleport|burrow|tactics, returning?}`,
`attack` / `retaliate {stackId, targetId, targets, lucky, deathBlow}`, `shoot {targets, lucky, shotsLeft}`,
`damage {stackId, amount, dealt, killed, remaining, kind: melee|ranged|spell|acid|explosion|death_stare|accurate_shot|kill, blocked?}`,
`death`, `rebirth`, `explode`, `heal`, `resurrect {raised, healed, permanent, wasDead}`, `status_added`,
`status_removed {reason: expired|dispelled|cancelled|replaced|damaged|bond_broken}`, `poison_tick`,
`spell {side, spellId, mastery, cost, power, target, manaLeft, caster: hero|artifact, affected: [stackId]}`
(hero / artifact; creature casts: `{stackId, side, spellId, mastery, creature: true}`), always before the
cast's effects, `spell_ready`, `spell_immune`,
`spell_resisted`, `spell_reflected`, `spell_unsupported`, `mana_channel`, `mana_drain`, `ability {ability}`,
`summon {stackId, side, creatureId, count, pos, clone, summoned, spellId?, reinforced?, total?, cloneOf?, rounds?}`,
`berserk`, `wait`, `defend`, `obstacle_added`, `obstacle_removed`, `obstacle_triggered`,
`retreat`, `surrender`, `combat_end {winner, reason}`.
Siege: `tower_shot {towerId, kind: keep|turret, targetId, damage}` (followed by `damage` kind `tower`),
`catapult_shot {stackId, targetId, kind: wall|gate|keep|turret, hit, damage, source: catapult|siege_attack}`,
`wall_damaged {targetId, kind, amount, hp, maxHp, source}`, `wall_destroyed {targetId, kind, hexes, source}`,
`gate_opened {stackId}`, `gate_closed {}`, `moat_damage {stackId, amount, moat}` (followed by `damage` kind
`moat`), `ability {ability: 'siege_attack', targetId}` (Cyclops / Cannon, before its `catapult_shot`s). A
siege `land_mine` uses the ordinary `obstacle_triggered` / `obstacle_removed` / `damage` events.

## 10. Extension points

- **Spells**: `spells.js` `EXTRA_HANDLERS` (`createHandlers` in `spells/handlers.js`), §6 / §6a.
- **Siege**: `siege.js`, see §10a.
- **AI**: `ai.js` `chooseAction(cs, {level?})`, see §10b.

## 10b. Tactical AI (`ai.js`, `ai/*.js`)

`chooseAction(cs, opts?)` returns a legal action for whoever must act (`{type:'auto'}` and `autoResolve` use
it for both sides). It never mutates the state and never consumes the combat rng: every candidate action is
played on a private copy (`ai/sim.js simState`: morale / luck / fear / resistance / mirror rolls off, base
damage forced to `avg`, obstacles hidden from the side removed so simulations never "discover" mines) and the
resulting board is scored. Deterministic: same state -> same action.

Board score (`ai/eval.js boardScore`, from the acting side's view):
- **material**: Σ own stack worth − Σ enemy worth; worth = `aiValue × (count − 1 + hp/maxHp) × status`, war
  machines ×0.5. `status` = √(offense × durability) × control factor from the active effects, each weighted by
  `min(roundsLeft, 3) / 3`: attack ±4.5%/pt (melee/ranged mode must match the stack), defense ±4%/pt,
  morale/luck ±4%/pt, speed ratio^0.5 (shooters ^0.15), Bless/Curse by max/min vs average damage,
  Shield/Air Shield by the share of melee/ranged damage, Fire Shield, Counterstrike, Slayer, Frenzy;
  blind/paralyze/stone −60%, berserk −70%, fear −40%, bind −30% (melee), Forgetfulness on shooters;
  hypnotized worth moves to the controller; pending DoT damage is subtracted. Protections / Anti-Magic /
  Magic Mirror only count when the enemy hero has mana and a hostile spell.
- **threat** (weight 0.6): Σ over enemy stacks of their best next-turn blow - shooters: best shot; others:
  best target whose adjacent hexes they can reach (real BFS), damage value − ½ retaliation value, + ½ of the
  target's shot value when the target is a shooter (it would be blocked). Disabled/berserk stacks threaten
  nothing. This one term produces: blocking enemy shooters (adjacent → they cannot shoot), protecting own
  shooters (body blocks), keeping out of reach, defending, focus on stacks that have not acted.
- **opportunity** (weight 0.3) of the acting stack: its best blow next turn; out of reach, the best blow
  discounted 0.6 per extra turn of travel × urgency (grows when the enemy wins a standing ranged exchange,
  and for the attacker after round 3 - the round cap is a defender win - when threat weight also drops).
  **No kiting**: an `engage` factor (heroless / neutral side 0.5; a side ≥ 1.5× ahead on value 0.3–0.6;
  +0.06 per round after round 5 for both sides, max 0.8) lowers the threat weight and raises the
  opportunity / approach weights when the side has no ranged advantage; and `mustEngage` (ai.js) restricts
  the creature's choice to attacks / shots / abilities whenever one exists for a neutral side from round 3,
  a side ≥ 2× ahead from round 4 and everybody from round 12 (not for siege defenders). The original has no
  round cap; ours stays as a safety net and is no longer reached in practice (neutral battles 1 % → 0 %,
  hero-vs-hero auto-resolve 6/60 → 0/60; A/B vs the baseline 83.5 % → 80.5 %).
- annihilation = ±10⁷; wiping out a stack adds 30% of its worth (it never acts / retaliates again).

Creature turn (`ai/tactics.js`): candidates = every melee target × best approach hex(es) (danger, path
hazards - visible fire walls / mines / quicksand / moat -, jousting run; multi-hit attackers - all-adjacent,
breath, three-headed - try up to 6 hexes so geometry is exploited), every shot (Ballista with Artillery
params), creature abilities × top targets (resurrection, raise demons, casters...), wall attacks (attacker:
gate > towers > walls, weighted by own walking troops and hit chance), defend, ≤10 purposeful moves (closest
approach per enemy, closest safe approach, safest hex, guard spots next to own shooters; a shooter that can
shoot from a safe hex does not consider moving). Siege defenders lose ½ value when a move leaves the walls.
Retaliation (incl. first strike, fire shield, death stare...) is in the simulated result. **Wait** is added
when no attack/shot beats holding still by 12% of the stack's value and an enemy has yet to act (let them
come, strike first). Two-stage scoring for speed: enemy reach maps are cached on the board without the actor
and threat is recomputed only for enemies the action affects; the top candidates are re-scored exactly.

Hero spells (`ai/magic.js`), checked first on every own turn while `castThisRound` is false (so normally
before the first own stack acts): each castable spell × ≤5 targets (stack modes by worth / lost worth for
resurrection), the 3 best area centres (enemy hexes + neighbours, own stacks −1.5×), mass / none modes,
line obstacles near the enemy front, Teleport next to the top enemies, is cast on a copy (`castHeroSpell`)
and scored as Δ board score + elimination bonus, × the non-resisted share for hostile resistible spells.
This values damage kills, buffs on the strongest stacks by remaining rounds, debuffs on threats (Slow also
cuts their reach), mass spells, resurrection after losses, early summons, Armageddon only when net positive
(immunities and own losses included), Cure/Dispel when the removed effects matter. Mana price: score −
cost × best gain-per-mana × (0.15, or 0.35 when mana is short); cast only when the gain > 0.4% of the total
worth on the field.

Other decisions: tactics phase - shooters to the rearmost legal column, melee to the front (same row), then
`tactics_end`; First Aid Tent heals `min(avg heal, missing hp) × value/hp` best; a controlled catapult uses
`chooseSiegeTarget`. **Retreat / surrender** (`ai/retreat.js`): when own worth (+ mana × power × 6) is below
12% of the enemy's and the hero is worth saving (`level + 1.5 × bonuses + 0.3 × spells ≥ 4`): surrender if
allowed, the army's gold value ≥ 1500 and the price is at most half of the side's gold, else retreat.

Difficulty: `CombatSide.aiLevel` (0..4, stored as `cs.sides[side].aiLevel`, default 4) or
`chooseAction(cs, {level})`. Lower levels add deterministic hash noise (never the combat rng) to candidate
scores (80% / 45% / 20% / 6% of the acting stack's worth for levels 0-3), pick a random candidate with
35% / 18% / 6% chance (levels 0-2), sometimes cast a random useful spell, level 0 skips half its casts;
levels 0-1 never retreat or surrender.

Measured (Node 20, tests/combat/ai-tournament.test.js): vs the frozen baseline in 200 seeded mirror battles
with swapped sides the AI wins ~84%; level 4 beats level 0 clearly; chooseAction ~2 ms on average (spell
turns ≤ ~10 ms); auto-resolving a full battle ~70 ms median, ~300 ms for the largest 7-vs-7 hero battles.

## 10a. Siege (`siege.js`)

Input: `CombatInput.siege = {fortLevel, faction, buildings}` plus the optional `town.getSiegeInfo` fields
`wallHp, gateHp, keep, turrets, moat, mines, towers {attack, keep {min,max}, turret {min,max}},
escapeTunnel` (missing ones are derived: walls 2 hp (3 at fortLevel 3), gate 2, keep from level 2, two
turrets at level 3, moat / mines from `faction.siege` at level ≥ 2, tower damage from `buildings.length`
with towns.md §8's formula). Garrison morale / luck / primaries are applied by the adapter (hero.js) to
the defending side before the combat starts; the engine adds nothing.

`cs.siege = { fortLevel, faction, buildings, escapeTunnel, walled, wallColumn (test override, normally
null), walls: [{id, kind:'wall', name, hexes, hp, maxHp}], gate: {id:'gate', kind:'gate', hexes, hp, maxHp,
open} | null, fixed: Hex[], towers: [{id, kind:'keep'|'turret', name, hp, maxHp, pos, hexes, damage:{min,max}}],
towerAttack, moat: {name, damage, hexes} | null, mines: obstacleId[] }` — plain JSON, nothing persists after
the battle.

Layout (`SIEGE_LAYOUT`, this grid's parity: odd rows shifted right): wall line x per row
`[12,11,11,10,10,9,10,10,11,11,12]`; gate = (9,5) outer + (10,5) inner, drawbridge (8,5); destructible
sections `wall_upper` (11,1), `wall_upper_mid` (10,4), `wall_lower_mid` (10,7), `wall_lower` (12,10);
permanent parts (12,0) (upper turret base), (11,2), (10,3), (10,6), (11,8), (11,9); moat = the hex left of
the line in every row but 5. Towers: `keep` (anchor (15,2), off-board), `tower_upper` (12,0),
`tower_lower` (anchor (13,10), walkable as in the original). Inside = right of the line. Defender
formation, ammo cart, tent and ballista spots are all inside.

Rules:
- Walls: intact sections and permanent parts block everybody (flyers / teleporters cross them but cannot
  land on them); destroyed sections are rubble (passable). Gate: the defender's creatures (`side ===
  'defender'`) always pass and may stand in it; entering it opens it (`gate_opened`), it closes again at the
  next turn / round start when nobody stands in it (`gate_closed`); while open, attackers may pass too. A
  destroyed gate is passable for both.
- Moat (active at level ≥ 2 when the faction has one): a walker's move ends on entering it (`reachable`
  does not expand beyond moat hexes), the stack takes `moat.damage` once on entry (also when a flyer /
  teleporter lands in it; flying over is free), again at the start of each of its turns there, and has
  −3 Defense (`stack.inMoat`). Both sides are affected. Tower: hidden land mines (`mines.count` in the
  three columns before the wall line, defender-owned, triggered by attacker walkers).
- Arrow towers: at every round start (after effect ticks), keep → upper → lower turret, each intact tower
  shoots once at the attacker stack with the highest `expected damage × AI value per hp` (creatures
  before machines). Damage: one roll of `damage` (honours `force.damage`), Attack `towerAttack` (10) vs
  target Defense with the usual ±5% / 2.5% steps, Armorer, Air Shield, petrification; no luck, no
  range / wall penalty, no defending-hero skills. Always automatic (also for a human defender).
- Shots over the walls: an attacker stack standing completely outside (outside / moat) shooting at a
  stack with a hex inside (or in the gate) gets −50% when the straight line crosses an intact wall part
  (permanent part, intact section, intact gate); none through rubble / a destroyed gate. Stacks inside
  never get it. `no_obstacle_penalty` (Mage, Cannon, Golden Bow…) ignores it.
- Catapult (attacker, sieges only, 1000 hp target for towers / spells): Ballistics table of heroes.md
  (`ballisticsParams(cs, side)`: shots, `hitChance {wall, gate, tower, keep}`, `damageChance [p0,p1,p2]`).
  No skill: random intact target. Hero with Ballistics: `machineControl` = `'player'` for a human side
  (legal `siegeTargets`, action `{type:'siege_attack', targetId}`), automatic best-value aim for an AI
  side. Each shot: `catapult_hit` roll, then 0/1/2 damage; extra shots go to the same target or, when it
  fell, a new one. Misses do nothing.
- `siege_attack {level}` (Cyclops 1, Cyclops King 2, Cannon 1): attacker stacks that could shoot (ammo,
  no adjacent enemy unless a machine) may target a structure instead of a creature: one action, 1 ammo
  (free with an Ammo Cart), shots / hit chances / damage of Ballistics level `level`.
- Retreat: the defender needs `escapeTunnel` while `fortLevel ≥ 1` (or `always_can_retreat`).

API (all exported from `siege.js`):
- For spells: `damageWall(cs, targetId, amount, source='spell') -> events` (unknown / destroyed target →
  `[]`; ids `wall_upper|wall_upper_mid|wall_lower_mid|wall_lower|gate|keep|tower_upper|tower_lower`);
  `earthquake(cs, hits, damagePerHit=1, source='earthquake') -> events` (random intact walls / gate /
  towers, plain rolls; a generic helper - the Earthquake *spell* does not use it, see §6a / §11);
  `getSiegeStructures(cs)` / `getStructure(cs, id)`;
  `siegeBlocksHex(cs, hex, stack?)` (see Walls; without a stack an intact gate counts as blocked) — the
  core's `blockedHexes(cs, stack?)` / `canStandAt(cs, stack, pos)` already include it, so a Teleport
  destination check is `canStandAt(...) && siegeTeleportAllowed(cs, stack, to, {crossMoat, crossWalls})`;
  after moving a stack outside `moveStack`, call `siegeOnEnterHex(cs, stack, h, events)` for each hex of its
  new footprint (head first) to apply gate / moat.
- For the AI: `getSiegeTargets(cs, stack)` → `[{targetId, kind, hp, maxHp, hexes, hitChance, value}]`
  (also in `getLegalActions().siegeTargets`), `chooseSiegeTarget(cs, stack) -> id|null`,
  `isBehindWalls(cs, stackOrId)`, `siegeZone(cs, hex)` (`inside|outside|moat|wall|gate|null`),
  `wallPathCost(cs, stack, to)` (steps ignoring stacks, moat entry +speed, Infinity when walled off),
  `towerTarget(cs, tower)`, `towerDamage(cs, tower, target, 'roll'|'min'|'max'|'avg')`. A player-controlled
  catapult (human + Ballistics) under `{type:'auto'}` should return
  `{type:'siege_attack', targetId: chooseSiegeTarget(cs, stack)}` (`ai.js`).
- For the UI: `cs.siege` (above), `SIEGE_LAYOUT`, the events of §9, `getStackInfo().machineControl` for
  the catapult.
- Core hooks: `setupSiege`, `siegeBlocksHex`, `siegeBlocksGround`, `siegeStopsMove`, `siegeOnRoundStart`,
  `siegeOnEnterHex`, `siegeOnTurnStart`, `siegeShotPenalty`, `catapultAct`, `catapultControl`,
  `getSiegeTargets`, `performSiegeAttack`, `siegeAllowsRetreat`.

## 11. Deviations / approximations

- Blinded / paralyzed creatures attacked later retaliate at the spell's `retaliationPercent` (spells.md), a
  stack disabled by the blow itself never answers (creatures.md).
- Preemptive shot fires only from the stack being attacked. Satyr Mirth is cast as the mass version.
  Faerie Dragon Frost Ring is centred next to the chosen target so the target is in the ring.
- Teleporters and flyers use hex distance as range; tactics only for a human side.
- Hidden mines/quicksand are not revealed to native-terrain creatures.
- Spells: `enemy_spell_power_percent` lowers the caster's SP (artifacts.md) rather than multiplying damage
  (spells.md §3.1 step 5) - so it also shortens durations; Earthquake is attacker-only and never hits towers
  (spells.md §4); force field / fire wall lines are the chosen hex plus the hexes straight below (offset
  column); obstacle lines may overlap enemy hidden traps (no information leak); summoned elementals act from
  the next round; Clone level-scaled specialty raises the tier allowance `floor(maxTier × factor)`.
- Adventure-only abilities `spying`, `sandwalker`, `resource_generation` have no combat effect.
- Siege: towers shoot at round start instead of taking turns, and are never player-controlled; catapult
  misses hit nothing; the Earthquake spell hits wall sections and the gate only, never towers or the keep
  (spells.md / `quakeCandidates` in `spells/handlers.js`; the generic `siege.earthquake` helper, unused by the
  spell, may also pick towers); wall sections are one hex each (original
  layout); the keep is off-board; 2-hex creatures entering the moat with any hex stop there.

## 12. Checklist

- [x] hex math, areas, 2-hex footprints - hex.test.js
- [x] formations, war machine spots, bank layout, seeded obstacles, hero / specialty / terrain stats, base morale - setup.test.js
- [x] walker BFS, flyers, teleport, burrow, 2-hex movement, tail click, bind, quicksand / mine / fire wall - movement.test.js
- [x] initiative & ties, wait, defend, morale/luck rolls and sources, fear, round reset, tactics - turn.test.js
- [x] damage formula components with hand-computed values, kills, preview - damage.test.js
- [x] retaliation rules and every attack-pattern / modifier ability - abilities-attack.test.js
- [x] every on-hit ability - abilities-onhit.test.js
- [x] defensive abilities, auras, creature casters, tag abilities - abilities-defense.test.js
- [x] status effects, durations, dispel, immunity pipeline, controls, DoT/HoT, heal/resurrect/summon, hero casting - effects.test.js
- [x] war machines, retreat/surrender, result mapping, round cap = defender win, ability coverage - machines-result.test.js
- [x] AI scenarios (shots, retaliation, blocking, waiting, Implosion, mass Haste/Slow, Armageddon, resurrection,
  cure, retreat/surrender, tent, ballista, tactics, abilities, breath, siege, purity) - ai.test.js; A/B tournament
  vs baseline, difficulty, timings, determinism, fuzz - ai-tournament.test.js
- [x] fuzz 200 battles, determinism, save/reload - fuzz.test.js
- [x] stepped invariants (no overlaps / obstacles, hp & count bounds, one turn per round, retaliation counters,
  dead stacks never act), huge stacks, 1-hp edge cases - invariants.test.js (audit: docs/audit/combat-creatures.md)
- [x] siege walls / gate / moat / mines / towers / catapult / Cyclops wall attacks, wall penalty, retreat - siege*.test.js
- [x] hero spells: every combat spell per mastery, multipliers / specialties, immunity & resistance matrix, mass,
  durations / overrides, dispel / cure / anti-magic / mirror, controls, summon, clone, teleport, obstacles,
  remove obstacle, earthquake, resurrection / animate dead / sacrifice, previews, cast rules, `spellsCast`,
  creature casters, spell fuzz + determinism - spells-*.test.js
