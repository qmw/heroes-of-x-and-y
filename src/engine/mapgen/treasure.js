// Treasure pool, guard strength formula and guard creature choice for the random map generator.
// Spec: docs/mechanics/mapgen.md §5-6.
import { FACTIONS } from '../../core/constants.js';
import { randInt, rand, weightedPick } from '../../core/rng.js';
import { MAP_OBJECTS, PANDORA_PRESETS, SEER_PRESETS, DWELLING_VALUE_BY_TIER } from '../../data/mapObjects.js';
import { CREATURES } from '../../data/creatures.js';

// ---- guard strength (original RMG formula) -------------------------------------------------------

const V1 = [2500, 1500, 1000, 500, 0];
const V2 = [7500, 7500, 7500, 5000, 5000];
const M1 = [0.5, 0.75, 1, 1.5, 1.5];
const M2 = [0.5, 0.75, 1, 1, 1.5];
const MAP_STRENGTH = { weak: 2, normal: 3, strong: 4 };
const ZONE_STRENGTH = { weak: -1, normal: 0, strong: 1 };
/** Objects whose computed guard strength is below this stay unguarded. */
export const MIN_GUARD_STRENGTH = 2000;

/**
 * Total AI value of the monster guarding something worth `value`.
 * `mapStrength`: weak|normal|strong|none; `zoneStrength` likewise (ignored for zone-connection guards).
 */
export function guardStrength(value, mapStrength = 'normal', zoneStrength = 'normal', zoneGuard = false) {
  if (mapStrength === 'none' || (!zoneGuard && zoneStrength === 'none')) return 0;
  const idx = Math.max(0, Math.min(4, (zoneGuard ? 0 : (ZONE_STRENGTH[zoneStrength] ?? 0)) + (MAP_STRENGTH[mapStrength] ?? 3) - 1));
  const s1 = Math.max(0, (value - V1[idx]) * M1[idx]);
  const s2 = Math.max(0, (value - V2[idx]) * M2[idx]);
  return Math.round(s1 + s2);
}

// ---- guard creature ------------------------------------------------------------------------------

const GUARD_POOL = CREATURES.filter((c) => !c.warMachine && c.tier >= 1 && c.aiValue > 0);

/**
 * Pick a creature and count for a guard of total AI value `strength`.
 * Prefers stacks of 5-60 creatures; zone factions weigh triple.
 * @returns {{creatureId: string, count: number}}
 */
export function pickGuard(rng, strength, factions = []) {
  const fav = new Set(factions);
  const pool = GUARD_POOL.filter((c) => c.tier <= 7 || strength >= 120000);
  let cands = pool.filter((c) => { const n = strength / c.aiValue; return n >= 5 && n <= 60; });
  if (!cands.length) cands = pool.filter((c) => { const n = strength / c.aiValue; return n >= 1 && n <= 250; });
  if (!cands.length) {
    cands = [pool.reduce((a, c) => (Math.abs(Math.log(strength / c.aiValue)) < Math.abs(Math.log(strength / a.aiValue)) ? c : a))];
  }
  const c = weightedPick(rng, cands, cands.map((x) => (fav.has(x.faction) ? 3 : 1) * (x.upgraded ? 0.6 : 1)));
  const count = Math.max(1, Math.round((strength / c.aiValue) * (0.9 + 0.2 * rand(rng))));
  return { creatureId: c.id, count };
}

// ---- treasure pool -------------------------------------------------------------------------------

const EXCLUDED_EFFECTS = new Set(['monster', 'town', 'grail', 'event', 'teleport', 'boat', 'border_guard', 'keymaster_tent',
  'garrison', 'message', 'quest_guard', 'none', 'seer_hut', 'obelisk', 'shipyard', 'lighthouse']);

/**
 * @typedef {Object} PoolEntry
 * @property {string} defId
 * @property {number} value
 * @property {number} weight
 * @property {object} [data]        instance data to pass to addObject
 * @property {string} [faction]     dwellings: faction (weights adjusted per zone)
 * @property {boolean} [ownGuards]  banks / guarded dwellings: no extra monster
 */

function buildPool() {
  const land = [];
  const water = [];
  for (const def of MAP_OBJECTS) {
    if (!def.frequency || def.category === 'decor' || EXCLUDED_EFFECTS.has(def.effect.type)) continue;
    if (def.coastal) continue;
    const isWater = def.terrains.length === 1 && def.terrains[0] === 'water';
    const out = isWater ? water : land;
    const fx = def.effect;
    if (fx.type === 'pandoras_box') {
      for (const p of PANDORA_PRESETS) out.push({ defId: def.id, value: p.value, weight: (def.frequency * p.frequency) / 100 / PANDORA_PRESETS.length * 4, data: { preset: p.id }, pandora: true });
      continue;
    }
    if (fx.type === 'spell_scroll') {
      (def.valueBySpellLevel || [500, 2000, 3000, 4000, 5000]).forEach((v, k) => out.push({ defId: def.id, value: v, weight: def.frequency / 2, spellLevel: k + 1 }));
      continue;
    }
    const entry = { defId: def.id, value: def.value, weight: def.frequency, limit: def.limit || null };
    if (fx.type === 'bank') entry.ownGuards = true;
    if (fx.type === 'dwelling') {
      entry.value = DWELLING_VALUE_BY_TIER[fx.tier] ?? def.value;
      entry.faction = fx.faction;
      if (fx.guards && fx.guards.length) entry.ownGuards = true;
    }
    if (fx.type === 'mine') entry.ownGuards = true; // abandoned mine
    if (!entry.value) continue;
    out.push(entry);
  }
  return { land, water };
}

export const POOL = buildPool();

/** Seer-hut presets usable by the generator (value = budget). */
export const SEER_POOL = SEER_PRESETS.map((p, i) => ({ index: i, ...p }));

/** Weight of a pool entry in a zone (dwellings of the zone's faction are favoured). */
export function entryWeight(e, zoneFactions) {
  if (e.faction) {
    if (e.faction === 'neutral') return e.weight * 0.7;
    return e.weight * (zoneFactions.includes(e.faction) ? 2.5 : 0.25);
  }
  return e.weight;
}

/**
 * Compose a treasure pile worth about [min, max]: one large object, or up to three 1x1 objects.
 * @returns {PoolEntry[]}
 */
export function composePile(rng, band, pool, zoneFactions, counts, sizeOf) {
  const target = randInt(rng, band.min, band.max);
  const floor = Math.min(band.min * 0.4, 2000);
  const usable = (e, budget) => e.value <= budget && e.value >= Math.min(floor, budget) && !(e.limit && (counts[e.defId] || 0) >= e.limit);
  const first = pool.filter((e) => usable(e, target));
  if (!first.length) return [];
  const pile = [weightedPick(rng, first, first.map((e) => entryWeight(e, zoneFactions)))];
  let sum = pile[0].value;
  const small = (e) => { const s = sizeOf(e.defId); return s[0] === 1 && s[1] === 1; };
  if (!small(pile[0]) || pile[0].ownGuards) return pile;
  while (pile.length < 3 && sum < band.min) {
    const rest = pool.filter((e) => small(e) && !e.ownGuards && e.value <= target - sum && e.value >= 300 && !(e.limit && (counts[e.defId] || 0) >= e.limit));
    if (!rest.length) break;
    const e = weightedPick(rng, rest, rest.map((x) => entryWeight(x, zoneFactions)));
    pile.push(e);
    sum += e.value;
  }
  return pile;
}

export const ALL_FACTIONS = FACTIONS;
