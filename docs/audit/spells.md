# Audit — Magic (spells, mage guilds, spell learning)

Scope: `src/data/spells.js`, `src/engine/combat/spells.js` + `spells/handlers.js`, spell parts of
`src/engine/combat/effects.js`, `src/engine/adventure/spells.js`, mage guild rolling
(`spells.js` helpers + `town.js`), spell learning in `hero.js` (Wisdom, scrolls, tomes, Scholar,
Eagle Eye), `docs/mechanics/spells.md`. Reference: SoD (HotA where the game already follows it).
Spec of the implemented rules: `docs/mechanics/spells.md`.

Legend: **ok** = matches the original and is pinned by a test; **fixed** = was wrong, corrected in
this audit; **open** = uncertain / design choice, see "Open questions".

## Check table

| # | item | status | test |
|---|---|---|---|
| 1 | 70 original spells present; school / level of every one (air 18, earth 17, fire 16, water 17, all 2) | ok | `tests/data/spells.test.js` |
| 2 | Mana cost of all 70 at every mastery incl. school-mastery discount (Teleport 15/12/3/3, Earthquake 20/17, Summon Boat 8/7, Visions/Disguise 4/2 …) | ok (now fully pinned) | `tests/combat/spells-audit.test.js` |
| 3 | Damage spells: base per mastery + per-SP multiplier (Magic Arrow 10/20/30+10·SP … Implosion 100/200/300+75·SP, Armageddon 30/60/120+50·SP) | ok | `tests/data/spells.test.js`, hand-computed through the API in `spells-audit.test.js` |
| 4 | Chain Lightning 4/4/4/5 targets, halving, friend & foe, immune skipped | ok | `spells-damage.test.js` |
| 5 | Area shapes: Fireball/Meteor r1, Inferno r2, Frost Ring ring (not centre), Berserk 0/0/1/2 | ok | `spells-damage.test.js`, `spells-status.test.js` |
| 6 | Death Ripple (not undead/war machines), Destroy Undead (undead only), both sides | ok (golems/elementals: open Q3) | `spells-damage.test.js` |
| 7 | Buff/debuff values (Haste 3/5, Slow 25/50 %, Shield 15/30, Air Shield 25/50, Prot. 30/50, Stone Skin/Bloodlust/Precision/Weakness 3/6, Disrupting Ray 3/4/5 stacking & undispellable, Prayer 2/4, Mirth/Sorrow/Fortune/Misfortune/Counterstrike 1/2, Fire Shield 20/25/30, Magic Mirror 20/30/40, Anti-Magic 3/4/5, Frenzy 100/150/200, Slayer +8 & kinds) | ok | `tests/data/spells.test.js`, `spells-status.test.js` |
| 8 | Mass at expert exactly for the classic 22 mass spells; Dispel friendly/any/all | ok | `tests/data/spells.test.js`, `spells-audit.test.js` |
| 9 | Durations: SP rounds + `spell_duration` (Conjuring ring/collar/cape) for 'power' spells; Frenzy/Berserk until next turn; Force Field/Fire Wall 2 rounds; traps & Disrupting Ray whole battle | ok | `spells-status.test.js`, `spells-audit.test.js` |
| 10 | Dragon level immunities (green/red/azure 1–3, gold 1–4, black & magic elemental all, friendly spells too) | ok | `spells-damage.test.js` |
| 11 | Golem damage reduction 50/75/85/95 % (steel 80 %) | ok | `spells-damage.test.js` |
| 12 | Elemental immunity / vulnerability matrix (air/earth/fire/water + upgrades) | ok | `spells-damage.test.js` |
| 13 | Mind spells (Berserk, Blind, Hypnotize, Forgetfulness, Frenzy, Mirth, Sorrow) vs undead, non-living, giants/titans; troglodytes vs Blind | ok | `tests/data/spells.test.js`, `spells-status.test.js` |
| 14 | Magic resistance: dwarves 20/40, Resistance 5/10/20, unicorn aura 20 (adjacent, no stacking), Orb of Vulnerability; only hostile casts | ok (own friendly fire: open Q4) | `spells-damage.test.js` |
| 15 | Anti-Magic, Orb of Inhibition / Recanter's Cloak (`block_spells`), pendants & Sphere of Permanence | ok | `spells-status.test.js`, `spells-special.test.js` |
| 16 | Sorcery 5/10/15 %, school orbs +50 %, spell specialty 3 % × floor(level / tier) — multiplier order | ok (order: open Q5) | `spells-damage.test.js` |
| 17 | Hypnotize HP limit 25·SP + 10/20/50 (strict) | ok | `spells-status.test.js` |
| 18 | Blind: skip turns, retaliation 50/50/25/0 %, breaks on damage | ok | `spells-status.test.js` |
| 19 | Forgetfulness 50 % → cannot shoot → mass | ok | `spells-status.test.js` |
| 20 | Resurrection 50·SP + 40/80/160 (temporary below advanced), Animate Dead 50·SP + 30/60/160 permanent, Sacrifice (SP + victim HP + 3/6/10) × victims | ok | `spells-special.test.js` |
| 21 | Clone tiers 5/6/7 (never 8), dies to any damage | ok | `spells-special.test.js` |
| 22 | Summon elementals 2/2/3/4 × SP; **only one elemental kind per side per battle** | **fixed** | `spells-special.test.js`, `spells-audit.test.js` |
| 23 | Teleport (walls expert, moat advanced), Force Field, Fire Wall, Quicksand/Land Mine 4/4/6/8 hidden, Remove Obstacle by mastery, Earthquake 2/2/3/4 attacker-only | ok | `spells-special.test.js` |
| 24 | Titan's Lightning Bolt 600, artifact-only, free | ok | `spells-damage.test.js` |
| 7b | Bless advanced/expert max damage +3 %, Curse min damage −20 % (floor, min 1) | **fixed** | `spells-audit.test.js`, `tests/data/spells.test.js` |
| 25 | **No spell book → no casting in combat, not even scroll / artifact-granted spells** | **fixed** | `spells-audit.test.js` |
| 26 | Every hero combat spell castable via `getCastableSpells` / `getSpellTargets` / `castHeroSpell` at every mastery, charges exactly `costByMastery[m]`, does something observable, once per round | ok (new) | `spells-audit.test.js` |
| 27 | 12 extra spells: balanced vs. originals of their level, all castable at all masteries | ok | `tests/data/spells.test.js`, `spells-status.test.js`, `spells-audit.test.js` |
| 28 | Adventure: Summon/Scuttle Boat 50/50/75/100 %, Visions, View Air/Earth by mastery, Disguise, Fly/Water Walk +40/40/20/0 %, Dimension Door 2/2/3/4 uses & 300/300/300/200 MP, Town Portal (nearest unoccupied / choose; 200 MP at expert; occupied nearest town rejected below advanced) | ok (ranges: open Q6) | `tests/adventure/spells.test.js` |
| 29 | Mage guild: 5/4/3/2/1 spells per level (`6 - level`), Library +1 per level, max level per town (Castle 4, Stronghold/Fortress 3) consistent with factions, Aurora Borealis = all spells of built levels | ok | `tests/data/spells.test.js`, `tests/game/town-heroes.test.js`, `tests/game/town-effects.test.js` |
| 30 | Wisdom: levels 1–2 free, 3/4/5 need basic/advanced/expert; spellbook needed; scrolls & tomes ignore Wisdom | ok | `tests/engine/hero.test.js` |
| 31 | Scholar 2/3/4 both directions (receiver needs Wisdom & book), Eagle Eye 40/50/60 % up to level 2/3/4 (needs Wisdom) | ok | `tests/engine/hero.test.js` |

## Fixes

1. **Summon Elemental — one kind per battle.** `summonPlan` only blocked another elemental kind
   while a summoned stack was alive, so after the fire elementals died a hero could summon water
   elementals. Original: only one elemental type per side per combat. The handler now also checks
   `cs.sides[side].summonedKind` (which was already recorded but never read).
   `src/engine/combat/spells/handlers.js`; the existing test was updated.
2. **No spell book → no combat casting.** `buildCombatSide` filtered learned spells by the spell
   book, but `grants_spell` bonuses (spell scrolls, Titan's Thunder, Sea Captain's Hat…) reached the
   combat engine anyway, so a might hero without a book could cast scroll spells. The hero block now
   carries `spellbook` (`hero.js` → `combat/state.js` normalizer), and `knownSpells` returns nothing
   for `spellbook: false`. Inputs that omit the field (tests, old saves) keep the old behaviour.
   DESIGN.md §8 hero-block additions mention the field.

## New tests (`tests/combat/spells-audit.test.js`, 8 tests)
- full mana-cost table of all 70 originals (4 masteries each);
- duration rules incl. Conjuring artifacts, Frenzy/Berserk, fixed obstacles, instants;
- one elemental kind per battle;
- no spell book → no casting (combat level and through `buildCombatSide` with a real scroll);
- table-driven: all 82 hero combat spells × 4 masteries in a realistic battle (shooters, undead,
  small stack, dead & wounded friendly stacks, natural obstacle, siege for Earthquake): castable,
  legal target from `getSpellTargets` only, exact mana, observable effect, once per round, JSON state;
- mass Haste / Slow at expert hit exactly every eligible stack of the side;
- hand-computed damage through the API (Implosion 600, Lightning Bolt 110 → 2 kills + 40 hp,
  Armageddon 260 on every stack of both sides).

## Open questions (kept as implemented; widely documented values unclear)
1. ~~Bless / Curse advanced bonus~~ — **decided & fixed**: SoD values, Bless max damage +3 %, Curse min
   damage −20 % (floor, min 1) at advanced/expert (was +1 / −1 flat). `tests/combat/spells-audit.test.js`.
2. **Bless / Curse on undead**: implemented as undead-immune (as VCMI's spell config, as recalled).
3. **Death Ripple vs non-living** (golems, gargoyles, elementals): we let it hurt them; only undead
   and war machines are immune.
4. **Magic resistance against own friendly-fire spells** (dwarves vs own Armageddon/Fireball):
   implemented as "own stacks never resist"; the original may roll resistance for every stack.
5. **Sorcery × orb × per-spell order**: implemented multiplicatively (generic × school × spell);
   VCMI adds Sorcery and per-spell bonus before multiplying by the school bonus. Differences are a few %.
6. **Dimension Door range** 8/8/10/12 tiles (original: screen-limited) and **Visions radius** 1/1/2/3 × SP.
7. **Summon Boat at expert creates a boat** when none is free — HotA-like; SoD may just fail.
8. **Recasting the same elemental** reinforces the living summoned stack (VCMI creates a new stack).
9. **Slow rounding** (`ceil`, Slow 50 % on speed 5 → 3); the original may round down.
10. **Mage guild probabilities and bans** are a school-affinity approximation of the original
    per-town table; Cove (4) / Factory (5) max guild level as recalled from HotA.
11. **Aurora Borealis** fills only the built guild levels; some sources say it offers all spells
    regardless of guild level.

Concurrent-auditor failures seen at the final run (1130 tests, 1124 pass; not touched, outside the
magic area): `double_damage_chance 20%`, `Artillery: player control…` (combat), `AI hero retreats…
surrenders…` (combat AI / surrender cost), `classes: banned skills`, `heroes: specialties use the closed
set`, `specialtyBonuses: one mapping per specialty type` (heroes). All spell suites pass (192 tests).
