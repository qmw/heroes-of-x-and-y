// Small shared helpers of the adventure engine (pure, no state ownership).
import { ARMY_SLOTS, RESOURCES, DAYS_PER_WEEK, WEEKS_PER_MONTH } from '../../core/constants.js';
import { randInt, pick } from '../../core/rng.js';
import { getCreature, getBaseCreature } from '../../data/creatures.js';

/** 8 neighbours, clockwise from north. */
export const DIRS = [
  { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
  { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 },
];

export const samePos = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && (a.z || 0) === (b.z || 0);
export const posKey = (p) => `${p.x},${p.y},${p.z || 0}`;
export const copyPos = (p) => ({ x: p.x, y: p.y, z: p.z || 0 });
/** Chebyshev distance on one level. */
export const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const isAdjacent = (a, b) => (a.z || 0) === (b.z || 0) && chebyshev(a, b) === 1;
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export const ok = (events = [], extra = {}) => ({ ok: true, events, ...extra });
export const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

/** Absolute week number, 1-based. */
export const weekNumber = (state) => Math.floor(((state.turn || 1) - 1) / DAYS_PER_WEEK) + 1;
export const monthNumber = (state) => Math.floor(((state.turn || 1) - 1) / (DAYS_PER_WEEK * WEEKS_PER_MONTH)) + 1;
export const dayOfWeek = (state) => (state.date?.day) || ((((state.turn || 1) - 1) % DAYS_PER_WEEK) + 1);

/** Resolve `n | [min,max] | [min,max,step]`. */
export function rollRange(rng, v) {
  if (Array.isArray(v)) {
    const [min, max, step = 1] = v;
    return min + step * randInt(rng, 0, Math.floor((max - min) / step));
  }
  return v;
}

/** Roll a `[{chance, ...}]` table (chance in percent, summing to 100). */
export function rollTable(rng, table) {
  const total = table.reduce((s, r) => s + r.chance, 0);
  let roll = randInt(rng, 1, total);
  for (const row of table) {
    roll -= row.chance;
    if (roll <= 0) return row;
  }
  return table[table.length - 1];
}

export function pickDistinct(rng, pool, n) {
  const src = pool.slice();
  const out = [];
  while (out.length < n && src.length) out.push(src.splice(randInt(rng, 0, src.length - 1), 1)[0]);
  return out;
}

export { pick, randInt };

// ---- players ------------------------------------------------------------------------------------

export function getPlayer(state, playerId) {
  return state.players.find((p) => p.id === playerId) || null;
}

/** Same player or same (optional) `player.team`. */
export function areAllies(state, a, b) {
  if (a == null || b == null) return false;
  if (a === b) return true;
  const pa = getPlayer(state, a);
  const pb = getPlayer(state, b);
  return !!pa && !!pb && pa.team != null && pa.team === pb.team;
}

export function nextObjectId(state) {
  state.nextId = (state.nextId || 1);
  let id;
  do { id = `o${state.nextId++}`; } while (state.map.objects[id]);
  return id;
}

// ---- armies (plain [slot|null x7]) --------------------------------------------------------------

export const emptyArmy = () => new Array(ARMY_SLOTS).fill(null);

export function armyFromList(list) {
  const army = emptyArmy();
  (list || []).filter(Boolean).slice(0, ARMY_SLOTS).forEach((s, i) => { army[i] = { creatureId: s.creatureId, count: s.count }; });
  return army;
}

export const armyStacks = (army) => (army || []).filter((s) => s && s.count > 0);
export const armyIsEmpty = (army) => armyStacks(army).length === 0;
export const armyTotalCount = (army) => armyStacks(army).reduce((n, s) => n + s.count, 0);
export const armyStrength = (army) => armyStacks(army).reduce((n, s) => n + s.count * getCreature(s.creatureId).aiValue, 0);
export const armyCount = (army, creatureId) => armyStacks(army).filter((s) => s.creatureId === creatureId).reduce((n, s) => n + s.count, 0);

export function armyCanAdd(army, creatureId) {
  return army.some((s) => !s || s.count <= 0 || s.creatureId === creatureId);
}

/** Add to an existing stack of the type, else the first free slot. @returns {boolean} */
export function armyAdd(army, creatureId, count) {
  if (count <= 0) return true;
  getCreature(creatureId);
  const same = army.find((s) => s && s.creatureId === creatureId);
  if (same) { same.count += count; return true; }
  const free = army.findIndex((s) => !s || s.count <= 0);
  if (free < 0) return false;
  army[free] = { creatureId, count };
  return true;
}

/** Remove up to `count` creatures of a type (across stacks). @returns {number} removed */
export function armyRemoveCreature(army, creatureId, count) {
  let left = count;
  for (let i = 0; i < army.length && left > 0; i++) {
    const s = army[i];
    if (!s || s.creatureId !== creatureId) continue;
    const take = Math.min(s.count, left);
    s.count -= take;
    left -= take;
    if (s.count <= 0) army[i] = null;
  }
  return count - left;
}

/**
 * Guard entries `{creatureId, count, stacks}` -> army of at most 7 stacks, each entry split as
 * evenly as possible (remainder to the first stacks); the smallest stacks are merged if > 7.
 */
export function splitGuards(entries) {
  const stacks = [];
  for (const e of entries) {
    const n = Math.max(1, Math.min(e.stacks || 1, e.count));
    const base = Math.floor(e.count / n);
    let rem = e.count - base * n;
    for (let i = 0; i < n; i++) {
      const c = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      if (c > 0) stacks.push({ creatureId: e.creatureId, count: c });
    }
  }
  while (stacks.length > ARMY_SLOTS) {
    // merge the smallest stack into another stack of the same creature (or drop it into the smallest other)
    let si = 0;
    for (let i = 1; i < stacks.length; i++) if (stacks[i].count < stacks[si].count) si = i;
    const [small] = stacks.splice(si, 1);
    const mate = stacks.find((s) => s.creatureId === small.creatureId);
    if (mate) mate.count += small.count;
  }
  return armyFromList(stacks);
}

/** Faction terrains on which this army pays no terrain penalty (doc 1.1 native terrain rule). */
export function nativeTerrainsOfArmy(army, factionNative) {
  const stacks = armyStacks(army);
  const out = [];
  if (stacks.some((s) => s.creatureId === 'nomad')) out.push('sand');
  if (!stacks.length) return out;
  let common = null;
  for (const s of stacks) {
    const c = getCreature(s.creatureId);
    const nat = factionNative(c.faction);
    if (!nat) return out;
    if (common === null) common = nat;
    else if (common !== nat) return out;
  }
  if (common && !out.includes(common)) out.push(common);
  return out;
}

export const sameLineage = (a, b) => getBaseCreature(a).id === getBaseCreature(b).id;

// ---- resources ----------------------------------------------------------------------------------

export function scaleCost(cost, factor) {
  const out = {};
  for (const r of RESOURCES) if (cost?.[r]) out[r] = Math.floor(cost[r] * factor);
  return out;
}

export const costIsZero = (cost) => !cost || RESOURCES.every((r) => !cost[r]);
