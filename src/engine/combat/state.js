// CombatState construction and the low-level helpers every combat module shares: dice, hero
// bonus lookups, stack creation, battlefield occupancy. The state is plain JSON.
import { createRng, rand } from '../../core/rng.js';
import { ARMY_SLOTS } from '../../core/constants.js';
import { getCreature, creatureTags } from '../../data/creatures.js';
import { TERRAIN_BY_ID } from '../../data/terrain.js';
import { W, H, hexIndex, inBounds, stackHexesAt, stackHexes, neighbor } from './hex.js';
import { setupSiege, siegeBlocksHex } from './siege.js';

// ---------------------------------------------------------------------------------------------
// Dice. Everything random goes through these so tests can force outcomes:
//   cs.forceRolls = [0.1, 0.9, ...]   raw values consumed before the rng
//   cs.force.chance[tag] = true|false overrides a tagged percentage roll (only when pct > 0)
//   cs.force.damage = 'min'|'max'     replaces attack damage rolls
// ---------------------------------------------------------------------------------------------

/** Float in [0, 1). */
export function roll(cs) {
  if (cs.forceRolls && cs.forceRolls.length) return cs.forceRolls.shift();
  return rand(cs.rng);
}

/** Integer in [min, max]; no roll is consumed when min >= max. */
export function rollInt(cs, min, max) {
  if (max <= min) return min;
  return min + Math.floor(roll(cs) * (max - min + 1));
}

/** True with `pct` percent. `tag` names the roll for `cs.force.chance`. */
export function rollChance(cs, pct, tag) {
  if (!(pct > 0)) return false;
  const forced = cs.force && cs.force.chance ? cs.force.chance[tag] : undefined;
  if (forced !== undefined) return !!forced;
  if (pct >= 100) return true;
  return roll(cs) < pct / 100;
}

export function rollPick(cs, arr) {
  return arr[rollInt(cs, 0, arr.length - 1)];
}

// ---------------------------------------------------------------------------------------------
// Sides and hero bonuses
// ---------------------------------------------------------------------------------------------

export const SIDES = ['attacker', 'defender'];
export const otherSide = (side) => (side === 'attacker' ? 'defender' : 'attacker');

export function bonusesOf(cs, side) {
  const hero = cs.sides[side].hero;
  return hero ? hero.bonuses : [];
}

/** All hero bonuses of `type` on a side (optionally filtered). */
export function findBonuses(cs, side, type, pred) {
  return bonusesOf(cs, side).filter((b) => b.type === type && (!pred || pred(b)));
}

/** Sum of `field` (default: value, falling back to percent) over a side's bonuses of `type`. */
export function sumBonus(cs, side, type, pred, field) {
  let total = 0;
  for (const b of findBonuses(cs, side, type, pred)) total += (field ? b[field] : (b.value ?? b.percent)) ?? 0;
  return total;
}

export const hasBonus = (cs, side, type) => bonusesOf(cs, side).some((b) => b.type === type);
/** True when either hero carries the bonus (the `side: 'both'` artifacts). */
export const anyBonus = (cs, type) => hasBonus(cs, 'attacker', type) || hasBonus(cs, 'defender', type);

// ---------------------------------------------------------------------------------------------
// Stacks
// ---------------------------------------------------------------------------------------------

const TAG_CACHE = new Map();
/** Static creature tags (cached per creature id). */
export function baseTags(creatureId) {
  let tags = TAG_CACHE.get(creatureId);
  if (!tags) {
    tags = creatureTags(getCreature(creatureId));
    TAG_CACHE.set(creatureId, tags);
  }
  return tags;
}

export const getStack = (cs, id) => cs.stacks.find((s) => s.id === id) ?? null;
export const aliveStacks = (cs) => cs.stacks.filter((s) => s.alive);

function matchesFilter(creature, filter) {
  if (!filter) return true;
  for (const [key, want] of Object.entries(filter)) {
    if (key === 'creatureId') { if (creature.id !== want) return false; }
    else if (key === 'creatureIds') { if (!want.includes(creature.id)) return false; }
    else if (key === 'shooter') { if ((creature.shots > 0) !== want) return false; }
    else if (Array.isArray(want)) { if (!want.includes(creature[key])) return false; }
    else if (creature[key] !== want) return false;
  }
  return true;
}

/**
 * Combat stats of a creature under a hero: creature base + `creature_stat` bonuses +
 * `creature_specialty` + native terrain (+1 attack/defense/speed) + hero attack/defense.
 */
export function computeStackStats(cs, side, creature) {
  const hero = cs.sides[side].hero;
  const tags = baseTags(creature.id);
  const flat = { attack: 0, defense: 0, speed: 0, hp: 0, damage: 0, shots: 0 };
  const pct = { attack: 0, defense: 0, speed: 0, hp: 0, damage: 0, shots: 0 };
  let specialty = { attack: 0, defense: 0 };
  // magic terrain (Cracked Ice, Dunes) `creature_stat` effects hit both sides, heroes or not
  const terrainStats = (cs.overlayEffects ?? []).filter((e) => e.type === 'creature_stat');
  for (const b of [...bonusesOf(cs, side), ...terrainStats]) {
    if (b.type === 'creature_stat') {
      if (!(b.stat in flat) || !matchesFilter(creature, b.filter)) continue;
      if (b.except && b.except.some((t) => tags.includes(t))) continue;
      if (b.percent !== undefined) pct[b.stat] += b.percent; else flat[b.stat] += b.value ?? 0;
    } else if (b.type === 'creature_specialty' && b.creatures && b.creatures.includes(creature.id)) {
      const tier = b.tier ?? Math.min(7, Math.max(1, creature.tier));
      const steps = Math.floor((b.heroLevel ?? 1) / tier);
      const per = (b.percentPerStep ?? 5) / 100;
      specialty = {
        attack: specialty.attack + Math.ceil(creature.attack * per * steps - 1e-9),
        defense: specialty.defense + Math.ceil(creature.defense * per * steps - 1e-9),
      };
    }
  }
  const withPct = (base, stat) => base + flat[stat] + Math.floor((base * pct[stat]) / 100);
  const native = !creature.warMachine && (cs.sides[side].nativeTerrainAll
    || hasBonus(cs, side, 'native_terrain_all')
    || (TERRAIN_BY_ID[cs.terrain]?.nativeFactions ?? []).includes(creature.faction)) ? 1 : 0;
  const immobile = creature.abilities.some((a) => a.id === 'immobile');
  return {
    // War machines get the hero's primary skills too (original / VCMI: the machine is part of the
    // hero's army); the Ballista's damage is additionally multiplied by (hero Attack + 1).
    attack: withPct(creature.attack, 'attack') + specialty.attack + native + (hero ? hero.attack : 0),
    defense: withPct(creature.defense, 'defense') + specialty.defense + native + (hero ? hero.defense : 0),
    minDamage: Math.max(0, withPct(creature.minDamage, 'damage')),
    maxDamage: Math.max(0, withPct(creature.maxDamage, 'damage')),
    hp: Math.max(1, Math.floor(((creature.hp + flat.hp) * (100 + pct.hp)) / 100)),
    speed: immobile ? 0 : Math.max(1, withPct(creature.speed, 'speed') + native),
    shots: creature.shots > 0 ? Math.max(0, withPct(creature.shots, 'shots')) : 0,
  };
}

/**
 * Create a stack object (not yet added to `cs.stacks`).
 * @returns {Object} Stack
 */
export function makeStack(cs, side, creatureId, count, pos, opts = {}) {
  const creature = getCreature(creatureId);
  const st = computeStackStats(cs, side, creature);
  const castsLeft = {};
  for (const ab of creature.abilities) if (ab.casts !== undefined) castsLeft[ab.id] = ab.casts;
  return {
    id: cs.nextStackId++,
    side,
    slot: opts.slot ?? null,          // index in the side's original army (null: machines, summons)
    creatureId,
    count,
    startCount: count,                // cap for resurrection; grows only when a summon is reinforced
    baseHp: st.hp,                    // max hp of one creature before aging / poison
    maxHp: st.hp,
    hp: st.hp,                        // hp of the top creature
    attack: st.attack,
    defense: st.defense,
    minDamage: st.minDamage,
    maxDamage: st.maxDamage,
    speed: st.speed,
    shots: st.shots,
    size: creature.size,
    pos: { x: pos.x, y: pos.y },      // head hex
    alive: count > 0,
    warMachine: creature.warMachine,
    summoned: !!opts.summoned,        // vanishes after the battle
    clone: !!opts.clone,
    joinsAfter: !!opts.joinsAfter,    // permanent stack created in battle (demons, raise_on_kill)
    cloneRoundsLeft: opts.cloneRoundsLeft ?? null,
    tempRaised: 0,                    // creatures raised non-permanently (removed after the battle)
    poisonLoss: 0,                    // percent of base hp lost to poison
    acted: false,
    waited: false,
    defending: false,
    moraleUsed: false,
    retaliationsUsed: 0,
    preemptiveUsed: false,
    rebirthUsed: false,
    invulnerable: false,
    inMoat: false,
    corpseUsed: false,
    castsLeft,
    pendingSpell: null,               // Faerie Dragon: spell rolled at turn start
    effects: [],
  };
}

/** Map hexIndex -> stack id for all living stacks (optionally ignoring one stack). */
export function occupancy(cs, exceptId = null) {
  const occ = new Map();
  for (const s of cs.stacks) {
    if (!s.alive || s.id === exceptId) continue;
    for (const h of stackHexes(s)) occ.set(hexIndex(h), s.id);
  }
  return occ;
}

/** Set of hex indices blocked by obstacles (natural + blocking magical) and siege features. */
export function blockedHexes(cs, stack = null) {
  const set = new Set();
  for (const o of cs.obstacles) if (o.blocks) for (const h of o.hexes) set.add(hexIndex(h));
  // `stack`: whose move is checked (the siege gate is open for the defender's creatures)
  if (cs.siege) for (let i = 0; i < W * H; i++) if (siegeBlocksHex(cs, { x: i % W, y: Math.floor(i / W) }, stack)) set.add(i);
  return set;
}

/** True when `stack` could stand with its head on `pos` (in bounds, unblocked, unoccupied). */
export function canStandAt(cs, stack, pos, occ = occupancy(cs, stack.id), blocked = blockedHexes(cs, stack)) {
  for (const h of stackHexesAt(stack, pos)) {
    if (!inBounds(h)) return false;
    const i = hexIndex(h);
    if (blocked.has(i) || occ.has(i)) return false;
  }
  return true;
}

/** Living stack occupying a hex, or null. */
export function stackAt(cs, hex) {
  for (const s of cs.stacks) {
    if (!s.alive) continue;
    for (const h of stackHexes(s)) if (h.x === hex.x && h.y === hex.y) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

/** Original "loose" formation: battlefield rows used by N stacks. */
export const FORMATION_ROWS = {
  1: [5], 2: [2, 8], 3: [2, 5, 8], 4: [0, 4, 6, 10], 5: [0, 2, 5, 8, 10],
  6: [0, 2, 4, 6, 8, 10], 7: [0, 2, 4, 5, 6, 8, 10],
};
/** Rows of the war machines (the original's fixed spots). */
export const MACHINE_ROWS = { ammo_cart: 1, ballista: 3, cannon: 3, catapult: 7, first_aid_tent: 9 };
/** Creature-bank layout: attacker in the middle, defenders around (original hex spots). */
export const BANK_ATTACKER = [{ x: 4, y: 3 }, { x: 9, y: 3 }, { x: 4, y: 5 }, { x: 7, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 7 }, { x: 9, y: 7 }];
export const BANK_DEFENDER = [{ x: 14, y: 0 }, { x: 14, y: 10 }, { x: 1, y: 10 }, { x: 1, y: 0 }, { x: 14, y: 5 }, { x: 1, y: 5 }, { x: 7, y: 0 }];

/** Head hex for a stack of `size` standing in its side's back column on `row`. */
export function edgePos(side, size, row) {
  if (side === 'attacker') return { x: size > 1 ? 1 : 0, y: row };
  return { x: size > 1 ? W - 2 : W - 1, y: row };
}

/** Mixed-army morale of the original: 1 faction +1, 2: 0, 3: -1, ...; undead in the army -1. */
export function armyBaseMorale(army, bonuses = []) {
  const merged = bonuses.filter((b) => b.type === 'no_alignment_penalty').flatMap((b) => b.factions ?? []);
  const factions = new Set();
  let undead = false;
  for (const slot of army) {
    if (!slot) continue;
    const c = getCreature(slot.creatureId);
    factions.add(merged.includes(c.faction) ? '*merged' : c.faction);
    if (baseTags(c.id).includes('undead')) undead = true;
  }
  if (factions.size === 0) return 0;
  return 2 - factions.size + (undead ? -1 : 0);
}

function normalizeHero(hero) {
  if (!hero) return null;
  return {
    id: hero.id ?? null,
    defId: hero.defId ?? null,   // hero definition id (portrait / UI)
    classId: hero.classId ?? null,
    name: hero.name ?? 'Hero',
    level: hero.level ?? 1,
    attack: hero.attack ?? 0,
    defense: hero.defense ?? 0,
    power: Math.max(1, hero.power ?? 1),
    knowledge: Math.max(1, hero.knowledge ?? 1),
    mana: hero.mana ?? 0,
    maxMana: hero.maxMana ?? Math.max(hero.mana ?? 0, (hero.knowledge ?? 1) * 10),
    spells: [...(hero.spells ?? [])],
    spellbook: hero.spellbook !== false, // false: cannot cast at all (scrolls need a book too)
    skills: { ...(hero.skills ?? {}) },
    specialty: hero.specialty ?? null,
    bonuses: (hero.bonuses ?? []).map((b) => ({ ...b })),
  };
}

function normalizeSide(input) {
  const army = [];
  for (let i = 0; i < ARMY_SLOTS; i++) {
    const s = input.army ? input.army[i] : null;
    army.push(s && s.count > 0 ? { creatureId: s.creatureId, count: s.count } : null);
  }
  const hero = normalizeHero(input.hero);
  const bonuses = hero ? hero.bonuses : [];
  const sum = (type) => bonuses.filter((b) => b.type === type).reduce((a, b) => a + (b.value ?? 0), 0);
  return {
    playerId: input.playerId ?? null,
    isHuman: !!input.isHuman,
    hero,
    army,
    warMachines: [...(input.warMachines ?? [])],
    // Base morale/luck: the adapter may pass pre-aggregated numbers; otherwise derived here.
    morale: typeof input.morale === 'number' ? input.morale : armyBaseMorale(army, bonuses) + sum('morale'),
    luck: typeof input.luck === 'number' ? input.luck : sum('luck'),
    nativeTerrainAll: !!input.nativeTerrainAll,
    gold: typeof input.gold === 'number' ? input.gold : null,
    canRetreat: input.canRetreat !== false,
    aiLevel: typeof input.aiLevel === 'number' ? input.aiLevel : null, // combat AI difficulty 0..4 (null = 4)
    castThisRound: false,
    fled: false,
    surrendered: false,
    resurrectFallenUsed: 0,
    summonedKind: null,
  };
}

const OBSTACLE_SHAPES = [
  [[0, 0]], [[0, 0]], [[0, 0], [1, 0]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]],
];

function placeRandomObstacles(cs) {
  const kinds = TERRAIN_BY_ID[cs.terrain]?.obstacles ?? ['boulder'];
  const taken = new Set();
  const n = rollInt(cs, 1, 5);
  for (let k = 0; k < n; k++) {
    const shape = rollPick(cs, OBSTACLE_SHAPES);
    const ax = rollInt(cs, 3, W - 5);
    const ay = rollInt(cs, 0, H - 2);
    const hexes = shape.map(([dx, dy]) => (dy === 0 ? { x: ax + dx, y: ay } : neighbor({ x: ax + dx, y: ay }, 1)));
    const kind = rollPick(cs, kinds);
    // Keep the two columns next to each army free so nobody starts walled in.
    if (hexes.some((h) => !inBounds(h) || h.x < 2 || h.x > W - 3 || taken.has(hexIndex(h)))) continue;
    for (const h of hexes) taken.add(hexIndex(h));
    cs.obstacles.push({ id: cs.nextObstacleId++, kind, hexes, blocks: true, magical: false, side: null, roundsLeft: null });
  }
}

function placeArmy(cs, side, bank) {
  const army = cs.sides[side].army;
  const slots = army.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  const rows = FORMATION_ROWS[slots.length] ?? [];
  slots.forEach((slotIdx, n) => {
    const { creatureId, count } = army[slotIdx];
    const size = getCreature(creatureId).size;
    let pos;
    if (bank) {
      const spot = (side === 'attacker' ? BANK_ATTACKER : BANK_DEFENDER)[n];
      pos = { x: spot.x, y: spot.y };
      // keep both hexes of a wide creature on the field
      if (size > 1 && side === 'attacker' && pos.x < 1) pos.x = 1;
      if (size > 1 && side === 'defender' && pos.x > W - 2) pos.x = W - 2;
    } else {
      pos = edgePos(side, size, rows[n]);
    }
    cs.stacks.push(makeStack(cs, side, creatureId, count, pos, { slot: slotIdx }));
  });
}

function placeMachines(cs, side, bank) {
  const ids = [...cs.sides[side].warMachines];
  if (cs.siege && side === 'attacker' && !ids.includes('catapult')) ids.push('catapult');
  for (const id of ids) {
    if (id === 'catapult' && !(cs.siege && side === 'attacker')) continue;
    if (bank) continue; // no war machines in creature banks (original)
    const row = MACHINE_ROWS[id];
    if (row === undefined) continue;
    const size = getCreature(id).size;
    cs.stacks.push(makeStack(cs, side, id, 1, edgePos(side, size, row)));
  }
}

/**
 * Build the initial CombatState (stacks placed, nothing started yet).
 * @param {Object} input CombatInput (DESIGN.md §5)
 */
export function setupCombat(input) {
  const cs = {
    version: 1,
    rng: createRng(input.seed ?? 1),
    forceRolls: [...(input.forceRolls ?? [])],
    force: { chance: { ...(input.force?.chance ?? {}) }, damage: input.force?.damage ?? null },
    terrain: input.terrain ?? 'grass',
    bank: !!input.bank,
    round: 0,
    phase: 'setup',               // setup | tactics | battle | over
    active: null,                 // id of the stack awaiting an action
    lastSide: 'defender',         // side that acted last (tie-break: the other side goes first)
    sides: { attacker: normalizeSide(input.attacker), defender: normalizeSide(input.defender) },
    stacks: [],
    nextStackId: 1,
    obstacles: [],
    nextObstacleId: 1,
    siege: null,
    tactics: null,
    winner: null,
    endReason: null,
    surrenderCost: 0,
    maxRounds: input.maxRounds ?? null,
    // spells.js: highest castable spell level (anti-magic garrison: 0) and magic-terrain effects
    spellLevelCap: typeof input.spellLevelCap === 'number' ? input.spellLevelCap : null,
    overlayEffects: (input.overlayEffects ?? []).map((e) => ({ ...e })),
  };
  cs.siege = input.siege ? setupSiege(cs, input.siege) : null;
  for (const side of SIDES) placeArmy(cs, side, cs.bank);
  for (const side of SIDES) placeMachines(cs, side, cs.bank);
  if (Array.isArray(input.obstacles)) {
    for (const o of input.obstacles) {
      cs.obstacles.push({ id: cs.nextObstacleId++, kind: o.kind ?? 'boulder', hexes: o.hexes.map((h) => ({ x: h.x, y: h.y })),
        blocks: o.blocks !== false, magical: false, side: null, roundsLeft: null });
    }
  } else if ((input.obstacles ?? 'random') === 'random' && !cs.bank && !cs.siege) {
    placeRandomObstacles(cs);
  }
  return cs;
}

export { H, W };
