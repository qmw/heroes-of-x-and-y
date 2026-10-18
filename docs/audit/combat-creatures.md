# Audit: tactical combat & creatures

Scope: `src/data/creatures.js`, `src/data/abilities.js`, `src/engine/combat/*` (without `spells*` and `ai*`),
`docs/mechanics/creatures.md`, `docs/mechanics/combat.md`, `tests/combat/*` (without `spells*`).
Reference: SoD (RoE/AB/SoD rules as reproduced by VCMI), HotA for Cove / Factory / HotA neutrals.

## Checks

| item | status | test |
|---|---|---|
| Stats of all 126 SoD town creatures (att, def, dmg, hp, speed, growth, AI value, cost incl. rare resource, shots, size, flying) | fixed (Lizard Warrior 2-3 -> 2-5), rest ok | data/creatures-original.test.js |
| SoD neutrals (peasant ... azure dragon) | ok | data/creatures-original.test.js |
| War machines (Ballista 10/10 2-3 250 hp 24 shots, Catapult 1000 hp, Tent 75 hp 1-25, Ammo Cart 0/5 100 hp) | ok | data/creatures-original.test.js |
| SoD ability matrix: retaliation rules, double attack/shot, multi-target patterns, hates pairs, melee-penalty exemptions, on-hit chances, golem reductions, magic resistance, level immunities, auras, casters | ok | data/creatures-original.test.js |
| Cove / Factory / HotA neutrals numbers | open (from memory, see creatures.md §6) | creatures.test.js (spot checks) |
| Damage: attack/defense differential +5%/pt cap +300%, -2.5%/pt cap -70% | ok | damage.test.js |
| Damage: additive bonuses (Offense/Archery, luck, hates, jousting) and multiplicative reductions (Armorer, Shield, range, obstacle, melee penalty, petrify, bad luck) | ok | damage.test.js |
| Death blow (Dread Knight) is +100% in the additive sum, not x2 of the result | fixed | abilities-attack.test.js |
| Artillery double damage is +100% in the additive sum | fixed | machines-result.test.js |
| Base roll: <=10 creatures roll each, more: 10 dice x count/10 | ok | damage.test.js, invariants.test.js |
| Range penalty > 10 hexes, obstacle (wall) penalty, `no_*_penalty` | ok | damage.test.js, abilities-attack.test.js |
| Bless/Curse min/max | ok (spells auditor owns the spell numbers) | damage.test.js |
| Defend: +20% Defense rounded down, min +1 | fixed (was rounded to nearest) | turn.test.js |
| Native terrain +1 attack / defense / speed | ok | setup.test.js |
| Hero Attack/Defense on war machines | fixed (machines now get hero Attack too; Ballista dmg also x(Attack+1)) | machines-result.test.js, setup.test.js |
| Turn order: speed, equal speed alternates sides (attacker first), slot order; wait phase slowest first, reverse slot | ok | turn.test.js |
| Morale: +m/24 extra action (not after wait/defend), -m/12 freeze; living only; undead in army -1; faction mix +1/0/-1/-2/-3; clamp ±3 | ok | turn.test.js, setup.test.js |
| Luck: +l/24 (x2 Leprechaun), bad luck -l/12 halves (HotA rule), machines none | ok (HotA bad luck kept) | turn.test.js |
| Retaliation: once per round, refreshed every round, Griffin 2, Royal Griffin unlimited, never counter-retaliated, machines never | ok | abilities-attack.test.js, invariants.test.js |
| Every creature ability (creatures.md §4) | ok | abilities-*.test.js |
| Phoenix rebirth: floor(20%) + 20% roll per remaining (count mod 5) phoenix, no minimum, once | fixed (had a minimum of 1) | abilities-defense.test.js |
| Pit Lord raise demons: raised hp = min(50 x pit lords, corpse hp), / 35 | fixed (was capped by corpse creature count) | abilities-defense.test.js, machines-result.test.js |
| Archangel resurrection 100 hp each, permanent, once | ok | abilities-defense.test.js |
| War machines: ballista random target / Artillery control, tent heals top creature (First Aid), ammo cart, catapult | ok | machines-result.test.js, siege.test.js |
| Tactics phase (deeper Tactics wins, difference = columns) | ok (human side only - documented deviation) | turn.test.js |
| Battlefield placement (loose formation by army slots), machine spots, 2-hex placement, bank layout | ok | setup.test.js |
| 2-hex movement / attacks, flying, teleport, burrow | ok | movement.test.js |
| Retreat (army lost; siege defender needs tunnel), surrender | fixed: price is the full recruit cost of the survivors x (1 - Diplomacy/artifacts), rounded down (was half, rounded up) | machines-result.test.js, engine/hero.test.js |
| Experience: hp of killed enemies + 500 for a defeated hero | ok | machines-result.test.js |
| Necromancy hook data (`killedEnemies` with hp / living / summoned) | ok | machines-result.test.js |
| End of battle: temporary raises removed, summons / clones vanish, raised demons join | ok | machines-result.test.js |
| Invariants: no overlapping stacks, none on obstacles, hexes in bounds, 0 < hp <= maxHp <= baseHp, count <= startCount, shots >= 0, one turn per stack per round, dead stacks never act | ok (new) | invariants.test.js |
| Edge: single creature with 1 hp, 9999-12345 creature stacks | ok (new) | invariants.test.js |

## Fixes

1. **Lizard Warrior** damage 2-3 -> **2-5** (SoD value; data + creatures.md §6).
2. **Death blow** (Dread Knight, Shadow Assassin) is an additive +100% bonus like luck (a lucky death blow is
   x3, not x4) - `damage.js` `opts.deathBlow`, `actions.js strike`.
3. **Artillery double damage** additive +100% - `damage.js` `opts.doubleDamage`, `actions.js fireShot`.
4. **Defend** bonus `floor(D/5)` (min 1) instead of `round(D/5)` - `stats.js`.
5. **War machines get the hero's Attack** (not only Defense) - `state.js computeStackStats`.
6. **Surrender price** = full gold cost of the surviving original troops × (1 − discount), floored (was half,
   ceiled) - `result.js`; the adapter's `hero.js getSurrenderCost` was aligned with a minimal edit (+ its tests),
   and the AI's surrender heuristic (`ai/retreat.js`) now compares the price with the side's gold.
7. **Phoenix rebirth**: no minimum of 1; remainder phoenixes roll 20% each - `effects.js handleDeath`.
8. **Raise Demons** capped by the corpse's hit points, not its creature count - `abilities.js raisedDemons`.

## New tests

- `tests/data/creatures-original.test.js` (3 tests): independent SoD reference table for 140 creatures, war machines,
  and the SoD ability matrix.
- `tests/combat/invariants.test.js` (6 tests): 60 stepped battles + 8 huge-stack battles with board / hp / turn /
  retaliation / dead-stack invariants, round reset of retaliations, 1-hp and 9999+ edge cases, last-creature shot.
- Extended: rebirth (3 cases), raise demons (HP cap, too-small corpse), death blow (+ lucky death blow), defend
  rounding (Evil Eye 8 -> 9), Artillery + hero Attack on the Ballista.

## Open questions

- **Bad luck**: kept HotA's working bad luck (`|l|/12`, half damage). In SoD negative luck is generally believed to
  have had no effect; switch off if strict SoD is wanted.
- **Enemy war machines next to a shooter**: our shooters are not blocked by an adjacent enemy war machine; VCMI
  blocks on any adjacent enemy unit. Unverified for the original.
- **Death Stare vs undead / non-living**: we keep "living only" (VCMI-like target condition); some sources say it
  works on everything.
- **Thunderbird lightning on retaliation**: we trigger it only on its own attacks.
- **Morale-bonus turn**: a stack may still Wait during a good-morale extra turn (unverified).
- **Native terrains** (owned by terrain/factions data): Conflux is native to Highlands, Cove to Swamp, Factory to
  Wasteland here; in SoD Conflux was native to Grass. Please confirm with the towns/terrain auditor.
- **HotA values** (Cove, Factory, Satyr, Fangarm, Leprechaun, Steel Golem, Cannon) and HotA-only abilities remain
  recollections / simplifications (creatures.md §6).
- **Siege numbers** (wall hp, moat damage, tower damage) were not re-derived in this audit (siege tests exist).
