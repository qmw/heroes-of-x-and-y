// Siege combat: walls, gate, moat / land mines, arrow towers, catapult, Cyclops / Cannon wall
// attacks, Earthquake support. The combat core calls the hooks below at the right moments
// (docs/mechanics/combat.md "Siege"); rules: docs/mechanics/towns.md §8, heroes.md (Ballistics),
// creatures.md (siege_attack).
//
// Battlefield geometry (15x11, odd rows shifted right). The wall line runs top-right to
// bottom-right, one hex per row (row 5 = the two gate hexes); see SIEGE_LAYOUT. Everything right of
// the line is "inside" the town; the moat is the hex left of the line in every row except the
// drawbridge row 5.
import { getCreature } from '../../data/creatures.js';
import { FACTION_BY_ID } from '../../data/factions.js';
import { H, hexIndex, stackHexes, stackHexesAt, hexDistance, neighbors, inBounds } from './hex.js';
import { roll, rollInt, rollChance, rollPick, findBonuses, sumBonus, getStack } from './state.js';
import {
  controllerOf, defenseOf, partsOfType, controlOf, hasAb, abilityOf, isDisabled, hasAmmoCart, speedOf,
} from './stats.js';
import { ev, applyDamage, breakOnDamage } from './effects.js';
import { canShoot, moveMode } from './actions.js';

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

/** x of the wall-line hex per row (row 5: the outer gate hex). */
const LINE = [12, 11, 11, 10, 10, 9, 10, 10, 11, 11, 12];
const GATE_HEXES = [{ x: 9, y: 5 }, { x: 10, y: 5 }];

/**
 * Static siege geometry (original layout adapted to this grid's parity).
 * - `line[y]`: wall-line x per row; `insideFrom[y]`: first x inside the walls.
 * - `fixed`: permanently impassable hexes (indestructible wall parts + the upper turret base).
 * - `sections`: the four destructible wall sections (1 hex each, passable rubble when destroyed).
 * - `gate`: outer + inner gate hex; `bridge`: the drawbridge hex in front of it (never moat).
 * - `moat`: moat hexes (the hex left of the line in every row but 5).
 * - `towers`: drawing anchors; the keep stands off-board behind the right edge, the lower turret's
 *   anchor hex stays walkable (as in the original), the upper turret's hex is part of `fixed`.
 * - `mineZone`: hexes where the Tower faction's land mines may be placed.
 */
export const SIEGE_LAYOUT = (() => {
  const insideFrom = LINE.map((x, y) => (y === 5 ? 11 : x + 1));
  const moat = [];
  const mineZone = [];
  for (let y = 0; y < H; y++) {
    if (y !== 5) moat.push({ x: LINE[y] - 1, y });
    for (let x = LINE[y] - 3; x <= LINE[y] - 1; x++) if (!(y === 5 && x >= 8)) mineZone.push({ x, y });
  }
  return {
    line: LINE.slice(),
    insideFrom,
    fixed: [{ x: 12, y: 0 }, { x: 11, y: 2 }, { x: 10, y: 3 }, { x: 10, y: 6 }, { x: 11, y: 8 }, { x: 11, y: 9 }],
    sections: [
      { id: 'wall_upper', name: 'Upper wall', hexes: [{ x: 11, y: 1 }] },
      { id: 'wall_upper_mid', name: 'Wall over the gate', hexes: [{ x: 10, y: 4 }] },
      { id: 'wall_lower_mid', name: 'Wall below the gate', hexes: [{ x: 10, y: 7 }] },
      { id: 'wall_lower', name: 'Lower wall', hexes: [{ x: 12, y: 10 }] },
    ],
    gate: GATE_HEXES.map((h) => ({ ...h })),
    bridge: { x: 8, y: 5 },
    moat,
    mineZone,
    towers: {
      keep: { pos: { x: 15, y: 2 }, hexes: [] },
      tower_upper: { pos: { x: 12, y: 0 }, hexes: [{ x: 12, y: 0 }] },
      tower_lower: { pos: { x: 13, y: 10 }, hexes: [] },
    },
  };
})();

const FIXED_SET = new Set(SIEGE_LAYOUT.fixed.map(hexIndex));
const MOAT_SET = new Set(SIEGE_LAYOUT.moat.map(hexIndex));
const isGateHex = (h) => h.y === 5 && (h.x === 9 || h.x === 10);
const lineHex = (h) => inBounds(h) && (h.x === LINE[h.y] || isGateHex(h));

/** Ballistics tables: index 0 = no skill (engine default), 1..3 = Basic / Advanced / Expert. */
export const BALLISTICS = [
  { shots: 1, hitChance: { wall: 50, gate: 25, tower: 10, keep: 5 }, damageChance: [10, 60, 30] },
  { shots: 1, hitChance: { wall: 60, gate: 30, tower: 15, keep: 7 }, damageChance: [0, 50, 50] },
  { shots: 2, hitChance: { wall: 75, gate: 40, tower: 20, keep: 10 }, damageChance: [0, 50, 50] },
  { shots: 2, hitChance: { wall: 75, gate: 50, tower: 25, keep: 15 }, damageChance: [0, 0, 100] },
];

/** Arrow tower damage for a town with `n` buildings (same formula as town.js arrowTowerDamage). */
export function towerDamageRange(n) {
  return { keep: { min: 10 + 2 * n, max: 15 + 3 * n }, turret: { min: 6 + n, max: 9 + 2 * n } };
}

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

/**
 * Build `cs.siege` from `CombatInput.siege` (DESIGN §5 `{fortLevel, faction, buildings}` plus the
 * optional town.js getSiegeInfo fields `wallHp, gateHp, keep, turrets, moat, mines, towers,
 * escapeTunnel`). Called before any stack is placed. Tower land mines go to `cs.obstacles`.
 */
export function setupSiege(cs, input) {
  const buildings = [...(input.buildings ?? [])];
  const fortLevel = input.fortLevel ?? 1;
  const fsiege = FACTION_BY_ID[input.faction]?.siege ?? null;
  const walled = fortLevel >= 1;
  const wallHp = input.wallHp ?? (fortLevel >= 3 ? 3 : 2);
  const gateHp = input.gateHp ?? 2;
  const keep = walled && (input.keep ?? fortLevel >= 2);
  const turrets = walled ? (input.turrets ?? (fortLevel >= 3 ? 2 : 0)) : 0;
  const moatDef = input.moat !== undefined ? input.moat : (fortLevel >= 2 ? fsiege?.moat ?? null : null);
  const minesDef = input.mines !== undefined ? input.mines : (fortLevel >= 2 ? fsiege?.mines ?? null : null);
  const dmg = towerDamageRange(buildings.length);
  const towerDmg = { keep: input.towers?.keep ?? dmg.keep, turret: input.towers?.turret ?? dmg.turret };
  const L = SIEGE_LAYOUT;
  const towers = [];
  if (keep) towers.push({ id: 'keep', kind: 'keep', name: 'Keep', hp: 2, maxHp: 2, ...copyTower(L.towers.keep), damage: { ...towerDmg.keep } });
  if (turrets >= 1) towers.push({ id: 'tower_upper', kind: 'turret', name: 'Upper tower', hp: 2, maxHp: 2, ...copyTower(L.towers.tower_upper), damage: { ...towerDmg.turret } });
  if (turrets >= 2) towers.push({ id: 'tower_lower', kind: 'turret', name: 'Lower tower', hp: 2, maxHp: 2, ...copyTower(L.towers.tower_lower), damage: { ...towerDmg.turret } });
  const siege = {
    fortLevel,
    faction: input.faction ?? null,
    buildings,
    escapeTunnel: !!input.escapeTunnel || buildings.some((b) => String(b).includes('escape_tunnel')),
    walled,
    wallColumn: null, // test override: a plain vertical wall line (legacy placeholder geometry)
    walls: walled ? L.sections.map((s) => ({ id: s.id, kind: 'wall', name: s.name, hexes: s.hexes.map((h) => ({ ...h })), hp: wallHp, maxHp: wallHp })) : [],
    gate: walled ? { id: 'gate', kind: 'gate', name: 'Gate', hexes: L.gate.map((h) => ({ ...h })), hp: gateHp, maxHp: gateHp, open: false } : null,
    fixed: walled ? L.fixed.map((h) => ({ ...h })) : [],
    towers,
    towerAttack: input.towers?.attack ?? 10,
    moat: walled && moatDef ? { name: moatDef.name ?? 'Moat', damage: moatDef.damage ?? 70, hexes: L.moat.map((h) => ({ ...h })) } : null,
    mines: [],
  };
  if (walled && minesDef && minesDef.count > 0) {
    const pool = L.mineZone.slice();
    for (let i = 0; i < minesDef.count && pool.length; i++) {
      const [h] = pool.splice(rollInt(cs, 0, pool.length - 1), 1);
      const id = cs.nextObstacleId++;
      cs.obstacles.push({ id, kind: 'land_mine', hexes: [{ ...h }], blocks: false, magical: true, side: 'defender',
        roundsLeft: null, damage: minesDef.damage ?? 150, element: 'fire', hidden: true, spellId: null, siege: true });
      siege.mines.push(id);
    }
  }
  return siege;
}

function copyTower(t) {
  return { pos: { ...t.pos }, hexes: t.hexes.map((h) => ({ ...h })) };
}

// ---------------------------------------------------------------------------------------------
// Structures & zones
// ---------------------------------------------------------------------------------------------

/** Every structure (walls, gate, towers), destroyed ones included. */
export function getSiegeStructures(cs) {
  const s = cs.siege;
  if (!s || !s.walls) return [];
  return [...s.walls, ...(s.gate ? [s.gate] : []), ...s.towers];
}

export function getStructure(cs, id) {
  return getSiegeStructures(cs).find((t) => t.id === id) ?? null;
}

const intact = (cs) => getSiegeStructures(cs).filter((t) => t.hp > 0);
const hitKind = (t) => (t.kind === 'turret' ? 'tower' : t.kind);

const hasWalls = (cs) => !!(cs.siege && cs.siege.walled && cs.siege.walls);

/**
 * Siege zone of a hex: 'inside' | 'outside' | 'moat' (active moat only) | 'wall' | 'gate', or null
 * when the battle has no walls.
 */
export function siegeZone(cs, hex) {
  if (!hasWalls(cs) || !inBounds(hex)) return null;
  if (isGateHex(hex)) return 'gate';
  if (hex.x === LINE[hex.y]) return 'wall';
  if (hex.x > LINE[hex.y]) return 'inside';
  if (cs.siege.moat && MOAT_SET.has(hexIndex(hex))) return 'moat';
  return 'outside';
}

const insideish = (cs, h) => { const z = siegeZone(cs, h); return z === 'inside' || z === 'gate'; };

/** True when every hex of the stack is inside the walls (gate hexes count as inside). */
export function isBehindWalls(cs, stackOrId) {
  const stack = typeof stackOrId === 'object' ? stackOrId : getStack(cs, stackOrId);
  if (!stack || !hasWalls(cs)) return false;
  return stackHexes(stack).every((h) => insideish(cs, h));
}

/** True when an intact structure (or permanent wall part) stands on this wall-line hex. */
function wallIntactAt(cs, hex) {
  const i = hexIndex(hex);
  if (FIXED_SET.has(i)) return true;
  const s = cs.siege;
  for (const w of s.walls) if (w.hexes.some((h) => hexIndex(h) === i)) return w.hp > 0;
  if (s.gate && isGateHex(hex)) return s.gate.hp > 0;
  return false;
}

/**
 * True when a wall part / closed gate makes the hex impassable.
 * Permanent wall parts and intact wall sections block everybody (flyers fly over them but cannot
 * land). An intact gate blocks: queries without a stack, and attacker-side stacks while it is closed;
 * the defender's own creatures (`stack.side === 'defender'`) may always pass through and stand in it.
 */
export function siegeBlocksHex(cs, hex, stack = null) {
  if (!hasWalls(cs) || !lineHex(hex)) return false; // every blocking siege hex lies on the wall line
  const i = hexIndex(hex);
  if (FIXED_SET.has(i)) return true;
  const s = cs.siege;
  for (const w of s.walls) if (w.hp > 0 && w.hexes.some((h) => hexIndex(h) === i)) return true;
  if (s.gate && s.gate.hp > 0 && isGateHex(hex)) {
    if (!stack) return true;
    if (stack.side === 'defender') return false;
    return !s.gate.open;
  }
  return false;
}

/** Walkers and burrowers: same as siegeBlocksHex (burrowers cannot tunnel under the walls). */
export function siegeBlocksGround(cs, stack, hex) {
  return siegeBlocksHex(cs, hex, stack);
}

/** True when a walker standing (head) on `pos` would be in the active moat: its move ends there. */
export function siegeStopsMove(cs, stack, pos) {
  if (!cs.siege || !cs.siege.moat) return false;
  return stackHexesAt(stack, pos).some((h) => MOAT_SET.has(hexIndex(h)));
}

const inMoatNow = (cs, stack) => !!(cs.siege && cs.siege.moat && stack.alive && siegeStopsMove(cs, stack, stack.pos));

function syncMoatFlags(cs) {
  for (const s of cs.stacks) if (s.alive) s.inMoat = inMoatNow(cs, s);
}

function moatDamage(cs, stack, events) {
  const amount = cs.siege.moat.damage;
  events.push(ev('moat_damage', { stackId: stack.id, amount, moat: cs.siege.moat.name }));
  const was = isDisabled(stack);
  applyDamage(cs, stack, amount, { kind: 'moat' }, events);
  if (was && stack.alive) events.push(...breakOnDamage(cs, stack));
}

/** Close an open, intact gate when nobody stands in it. */
function syncGate(cs, events) {
  const g = cs.siege.gate;
  if (!g || g.hp <= 0 || !g.open) return;
  const occupied = cs.stacks.some((s) => s.alive && stackHexes(s).some(isGateHex));
  if (!occupied) {
    g.open = false;
    events.push(ev('gate_closed', {}));
  }
}

// ---------------------------------------------------------------------------------------------
// Movement hooks
// ---------------------------------------------------------------------------------------------

/**
 * A stack entered `hex` (walkers: every step and every hex of the footprint; flyers / teleporters /
 * burrowers: their landing hexes). Opens the gate for the defender, applies the moat: entering it
 * (the footprint was not in the moat before) deals its damage once and ends the move; `inMoat`
 * gives -3 defense while standing in it.
 */
export function siegeOnEnterHex(cs, stack, hex, events) {
  if (!hasWalls(cs)) return { stop: false };
  const g = cs.siege.gate;
  if (g && g.hp > 0 && !g.open && isGateHex(hex) && stack.side === 'defender') {
    g.open = true;
    events.push(ev('gate_opened', { stackId: stack.id }));
  }
  if (hex.x !== stack.pos.x || hex.y !== stack.pos.y) return { stop: false }; // footprint handled at the head
  const was = !!stack.inMoat;
  const now = inMoatNow(cs, stack);
  stack.inMoat = now;
  if (!now) return { stop: false };
  if (!was) moatDamage(cs, stack, events);
  return { stop: true };
}

/** Start of a stack's turn: gate closes when empty, moat damage while standing in it. */
export function siegeOnTurnStart(cs, stack, events) {
  if (!hasWalls(cs)) return;
  syncGate(cs, events);
  syncMoatFlags(cs);
  if (stack.alive && stack.inMoat) moatDamage(cs, stack, events);
}

// ---------------------------------------------------------------------------------------------
// Arrow towers
// ---------------------------------------------------------------------------------------------

const hpValue = (s) => getCreature(s.creatureId).aiValue / Math.max(1, s.baseHp);

/**
 * Damage of one arrow-tower arrow on `target`: one roll of the tower's range (`mode` 'roll' | 'min' |
 * 'max' | 'avg'), tower Attack (10) vs the target's Defense, Armorer, Air Shield, petrification. No
 * luck, no range / wall penalty, no hero skills of the defender.
 */
export function towerDamage(cs, tower, target, mode = 'roll') {
  const { min, max } = tower.damage;
  const forced = mode === 'roll' ? (cs.force && cs.force.damage) || null : mode;
  let base;
  if (forced === 'min') base = min;
  else if (forced === 'max') base = max;
  else if (forced === 'avg') base = (min + max) / 2;
  else base = rollInt(cs, min, max);
  const A = cs.siege.towerAttack;
  const D = defenseOf(cs, target);
  let factor = 1 + (A > D ? Math.min(300, 5 * (A - D)) / 100 : 0);
  const reductions = [];
  if (D > A) reductions.push(Math.min(70, 2.5 * (D - A)));
  const armorer = sumBonus(cs, target.side, 'damage_reduction_percent', null, 'percent');
  if (armorer > 0) reductions.push(Math.min(100, armorer));
  for (const p of partsOfType(target, 'damage_reduction')) if (p.against === 'ranged') reductions.push(p.value);
  const stone = controlOf(target, 'stone');
  if (stone) reductions.push(100 - (stone.damageTakenPercent ?? 50));
  for (const r of reductions) factor *= (100 - r) / 100;
  return Math.max(1, Math.floor(base * factor + 1e-9));
}

/** Target an arrow tower picks: the attacker stack where the expected arrow is worth most. */
export function towerTarget(cs, tower) {
  const enemies = cs.stacks.filter((s) => s.alive && controllerOf(s) === 'attacker');
  const creatures = enemies.filter((s) => !s.warMachine);
  const pool = creatures.length ? creatures : enemies;
  let best = null;
  let bestScore = -Infinity;
  for (const s of pool) {
    const dmg = Math.min(towerDamage(cs, tower, s, 'avg'), (s.count - 1) * s.maxHp + s.hp);
    const score = dmg * hpValue(s);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

function towerShoot(cs, tower, events) {
  const target = towerTarget(cs, tower);
  if (!target) return;
  const damage = towerDamage(cs, tower, target);
  events.push(ev('tower_shot', { towerId: tower.id, kind: tower.kind, targetId: target.id, damage }));
  const was = isDisabled(target);
  applyDamage(cs, target, damage, { kind: 'tower', towerId: tower.id }, events);
  if (was && target.alive) events.push(...breakOnDamage(cs, target));
}

/** Start of every round (before any stack acts): the gate closes if empty, the towers shoot (keep first). */
export function siegeOnRoundStart(cs, events) {
  if (!hasWalls(cs)) return;
  syncGate(cs, events);
  syncMoatFlags(cs);
  for (const t of cs.siege.towers) {
    if (t.hp > 0) towerShoot(cs, t, events);
  }
}

// ---------------------------------------------------------------------------------------------
// Ranged penalty over the walls
// ---------------------------------------------------------------------------------------------

const center = (h) => ({ x: h.x + ((h.y & 1) ? 0.5 : 0), y: h.y });

/**
 * True when a shot from outside the walls at a stack inside crosses an intact wall part (50% damage
 * unless the shooter / its hero has `no_obstacle_penalty`). Shots through a destroyed section or a
 * destroyed gate, and every shot by a stack standing inside, are not penalised.
 */
export function siegeShotPenalty(cs, shooter, target) {
  const col = cs.siege?.wallColumn;
  if (col !== null && col !== undefined) return (shooter.pos.x < col) !== (target.pos.x < col);
  if (!hasWalls(cs)) return false;
  if (!stackHexes(shooter).every((h) => { const z = siegeZone(cs, h); return z === 'outside' || z === 'moat'; })) return false;
  if (!stackHexes(target).some((h) => insideish(cs, h))) return false;
  const a = center(shooter.pos);
  const b = center(target.pos);
  const steps = 64;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const y = Math.round(a.y + (b.y - a.y) * t);
    const x = Math.round(a.x + (b.x - a.x) * t - ((y & 1) ? 0.5 : 0));
    const h = { x, y };
    if (lineHex(h)) return wallIntactAt(cs, h);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Catapult, Cyclops, Cannon, Earthquake
// ---------------------------------------------------------------------------------------------

/** Ballistics parameters of a side's catapult: the hero's best `ballistics` bonus or the default. */
export function ballisticsParams(cs, side) {
  const list = findBonuses(cs, side, 'ballistics');
  if (!list.length) return { ...BALLISTICS[0], control: false, level: 0 };
  const b = list.reduce((x, y) => ((y.hitChance?.wall ?? 0) > (x.hitChance?.wall ?? 0) ? y : x));
  return {
    shots: b.shots ?? 1,
    hitChance: { ...BALLISTICS[0].hitChance, ...(b.hitChance ?? {}) },
    damageChance: b.damageChance ?? BALLISTICS[0].damageChance,
    control: !!b.control,
    level: b.level ?? 1,
  };
}

/** Parameters of a `siege_attack {level}` creature / Cannon shot (Ballistics of that level). */
function siegeAttackParams(stack) {
  const level = Math.max(1, Math.min(3, abilityOf(stack, 'siege_attack')?.level ?? 1));
  return { ...BALLISTICS[level], control: true, level };
}

function expectedWallDamage(params) {
  const p = params.damageChance;
  return ((p[1] ?? 0) * 1 + (p[2] ?? 0) * 2) / 100;
}

/** Can this stack attack the walls right now? (attacker side only) */
function canSiegeAttack(cs, stack) {
  if (!hasWalls(cs) || !stack.alive || controllerOf(stack) !== 'attacker') return false;
  if (hasAb(stack, 'catapult')) return true;
  if (!hasAb(stack, 'siege_attack') || stack.shots <= 0) return false;
  return stack.warMachine ? true : canShoot(cs, stack);
}

function paramsFor(cs, stack) {
  return hasAb(stack, 'catapult') ? ballisticsParams(cs, stack.side) : siegeAttackParams(stack);
}

/** AI value of hitting structure `t` with `params` (higher = better). */
function targetValue(cs, t, params) {
  const army = cs.stacks.filter((s) => s.alive && s.side === 'attacker' && !s.warMachine);
  const total = army.reduce((a, s) => a + getCreature(s.creatureId).aiValue * s.count, 0) || 1;
  const walkers = army.filter((s) => moveMode(s) === 'walk' || moveMode(s) === 'burrow')
    .reduce((a, s) => a + getCreature(s.creatureId).aiValue * s.count, 0);
  const share = walkers / total;
  let base;
  if (t.kind === 'gate') base = 100 * share + 5;
  else if (t.kind === 'wall') base = 60 * share + 5;
  else base = ((t.damage.min + t.damage.max) / 2) * 1.5;
  const hit = (params.hitChance[hitKind(t)] ?? 0) / 100;
  return Math.round(base * hit * Math.min(1, expectedWallDamage(params) / Math.max(1, t.hp)) * 100) / 100;
}

/**
 * Wall targets for the catapult or a `siege_attack` stack (Cyclops, Cyclops King, Cannon) of the
 * attacker: `[{ targetId, kind: 'wall'|'gate'|'keep'|'turret', hp, maxHp, hexes, hitChance, value }]`
 * (intact structures only). Empty for every other stack.
 */
export function getSiegeTargets(cs, stack) {
  if (!cs.siege || !stack || !canSiegeAttack(cs, stack)) return [];
  const params = paramsFor(cs, stack);
  return intact(cs).map((t) => ({
    targetId: t.id, kind: t.kind, hp: t.hp, maxHp: t.maxHp, hexes: t.hexes.map((h) => ({ ...h })),
    hitChance: params.hitChance[hitKind(t)] ?? 0, value: targetValue(cs, t, params),
  }));
}

/** Best wall target id for the stack (AI), or null. */
export function chooseSiegeTarget(cs, stack) {
  let best = null;
  for (const t of getSiegeTargets(cs, stack)) if (!best || t.value > best.value) best = t;
  return best ? best.targetId : null;
}

/** Wall damage of one hit: 0 / 1 / 2 by `damageChance` (no roll when only one outcome is possible). */
function rollWallDamage(cs, chances) {
  const nonzero = chances.map((p, i) => (p > 0 ? i : -1)).filter((i) => i >= 0);
  if (nonzero.length <= 1) return nonzero[0] ?? 0;
  const r = roll(cs) * 100;
  let acc = 0;
  for (let i = 0; i < chances.length; i++) {
    acc += chances[i];
    if (r < acc) return i;
  }
  return chances.length - 1;
}

/**
 * Damage a wall section, the gate or a tower by `amount` hit points.
 * `source`: 'catapult' | 'siege_attack' | 'earthquake' | any string (copied into the events).
 * Destroyed walls become passable rubble, a destroyed gate is passable for both sides, a destroyed
 * tower stops shooting. Returns events (`wall_damaged`, then `wall_destroyed` when hp reaches 0);
 * an unknown or already destroyed target returns [].
 */
export function damageWall(cs, targetId, amount, source = 'spell') {
  const t = getStructure(cs, targetId);
  if (!t || t.hp <= 0 || !(amount > 0)) return [];
  const dealt = Math.min(t.hp, Math.floor(amount));
  if (dealt <= 0) return [];
  t.hp -= dealt;
  const events = [ev('wall_damaged', { targetId: t.id, kind: t.kind, amount: dealt, hp: t.hp, maxHp: t.maxHp, source })];
  if (t.hp <= 0) {
    if (t.kind === 'gate') t.open = true;
    events.push(ev('wall_destroyed', { targetId: t.id, kind: t.kind, hexes: t.hexes.map((h) => ({ ...h })), source }));
  }
  return events;
}

/**
 * Earthquake: `hits` times a random intact structure (walls, gate, towers) takes `damagePerHit`.
 * Returns events (none when nothing is left standing or there are no walls).
 */
export function earthquake(cs, hits, damagePerHit = 1, source = 'earthquake') {
  const events = [];
  if (!hasWalls(cs)) return events;
  for (let i = 0; i < hits; i++) {
    const pool = intact(cs);
    if (!pool.length) break;
    events.push(...damageWall(cs, rollPick(cs, pool).id, damagePerHit, source));
  }
  return events;
}

function fireAt(cs, stack, firstTargetId, params, source, aimed, events) {
  let targetId = firstTargetId;
  for (let i = 0; i < params.shots; i++) {
    let t = targetId ? getStructure(cs, targetId) : null;
    if (!t || t.hp <= 0) {
      const pool = intact(cs);
      if (!pool.length) return;
      t = aimed ? getStructure(cs, chooseSiegeTarget(cs, stack)) ?? pool[0] : rollPick(cs, pool);
      targetId = t.id;
    }
    const hit = rollChance(cs, params.hitChance[hitKind(t)] ?? 0, 'catapult_hit');
    const damage = hit ? rollWallDamage(cs, params.damageChance) : 0;
    events.push(ev('catapult_shot', { stackId: stack.id, targetId: t.id, kind: t.kind, hit, damage, source }));
    if (damage > 0) events.push(...damageWall(cs, t.id, damage, source));
  }
}

/**
 * The catapult's automatic turn: without Ballistics it picks a random intact structure; a hero with
 * Ballistics whose catapult is not player-controlled (AI side) aims at the most valuable one.
 */
export function catapultAct(cs, stack, events) {
  if (!hasWalls(cs) || controllerOf(stack) !== 'attacker') return;
  const pool = intact(cs);
  if (!pool.length) return;
  const params = ballisticsParams(cs, stack.side);
  const aimed = params.level > 0;
  const first = aimed ? chooseSiegeTarget(cs, stack) : rollPick(cs, pool).id;
  fireAt(cs, stack, first, params, 'catapult', aimed, events);
}

/** Resolve `{type:'siege_attack', targetId}` for the catapult or a siege_attack stack. */
export function performSiegeAttack(cs, stack, targetId, events) {
  if (!cs.siege || !hasWalls(cs)) return { ok: false, error: 'not_a_siege' };
  const targets = getSiegeTargets(cs, stack);
  if (!targets.length) return { ok: false, error: 'cannot_siege_attack' };
  if (!targets.some((t) => t.targetId === targetId)) return { ok: false, error: 'bad_target' };
  if (hasAb(stack, 'catapult')) {
    fireAt(cs, stack, targetId, ballisticsParams(cs, stack.side), 'catapult', true, events);
    return { ok: true };
  }
  if (!hasAmmoCart(cs, stack.side)) stack.shots = Math.max(0, stack.shots - 1);
  events.push(ev('ability', { stackId: stack.id, ability: 'siege_attack', targetId }));
  fireAt(cs, stack, targetId, siegeAttackParams(stack), 'siege_attack', true, events);
  return { ok: true };
}

/** 'player' when a human side's hero has Ballistics (catapult control), else 'auto'. */
export function catapultControl(cs, stack) {
  return cs.sides[stack.side].isHuman && ballisticsParams(cs, stack.side).control ? 'player' : 'auto';
}

// ---------------------------------------------------------------------------------------------
// Helpers for spells and the AI
// ---------------------------------------------------------------------------------------------

/**
 * Teleport rule: may `stack` be teleported to head hex `to`? Crossing the wall line (between
 * outside/moat and inside/gate) needs `crossWalls`; moving between beyond-the-moat and the moat or
 * anything behind it needs `crossMoat` (only when the moat is active). Without walls: always true.
 */
export function siegeTeleportAllowed(cs, stack, to, { crossMoat = false, crossWalls = false } = {}) {
  if (!hasWalls(cs)) return true;
  const inFrom = stackHexes(stack).some((h) => insideish(cs, h));
  const inTo = stackHexesAt(stack, to).some((h) => insideish(cs, h));
  if (inFrom !== inTo && !crossWalls) return false;
  if (cs.siege.moat && !crossMoat) {
    const beyond = (hexes) => hexes.every((h) => h.x < LINE[h.y] - 1 || (h.y === 5 && h.x < 9));
    if (beyond(stackHexes(stack)) !== beyond(stackHexesAt(stack, to))) return false;
  }
  return true;
}

/**
 * Walking cost for AI planning: hex steps from the stack's position to head hex `to`, ignoring other
 * stacks but respecting walls / gate / obstacles; entering the moat costs the rest of a turn
 * (+speed). Flyers and teleporters: plain hex distance. Infinity when walled off.
 */
export function wallPathCost(cs, stack, to) {
  const mode = moveMode(stack);
  if (mode === 'fly' || mode === 'teleport') return hexDistance(stack.pos, to);
  const speed = Math.max(1, speedOf(cs, stack));
  const blocked = new Set();
  for (const o of cs.obstacles) if (o.blocks) for (const h of o.hexes) blocked.add(hexIndex(h));
  const ok = (pos) => stackHexesAt(stack, pos).every((h) => inBounds(h) && !blocked.has(hexIndex(h)) && !siegeBlocksHex(cs, h, stack));
  const goal = hexIndex(to);
  const dist = new Map([[hexIndex(stack.pos), 0]]);
  const queue = [{ pos: stack.pos, d: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.d - b.d);
    const { pos, d } = queue.shift();
    if (hexIndex(pos) === goal) return d;
    if (d > (dist.get(hexIndex(pos)) ?? Infinity)) continue;
    for (const n of neighbors(pos)) {
      if (!ok(n)) continue;
      const nd = d + 1 + (siegeStopsMove(cs, stack, n) ? speed : 0);
      const i = hexIndex(n);
      if (nd < (dist.get(i) ?? Infinity)) { dist.set(i, nd); queue.push({ pos: n, d: nd }); }
    }
  }
  return Infinity;
}

/** Original rule: the defender of a fortified town cannot flee without an Escape Tunnel. */
export function siegeAllowsRetreat(cs, side) {
  if (!cs.siege || side !== 'defender') return true;
  return cs.siege.fortLevel < 1 || cs.siege.escapeTunnel;
}

