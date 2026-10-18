// Pure view-model helpers of the town screen and its dialogs (no DOM; unit-tested in Node).
// Engine calls stay in the screens; this module only reads state + data.
import { RESOURCES } from '../../../core/constants.js';
import {
  getBuilding, getBuildingEffects, predecessorsOf, BUILDING_BY_ID, RESOURCE_VALUE,
} from '../../../data/buildings.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { FACTION_BY_ID } from '../../../data/factions.js';
import { armyDismiss } from '../../../engine/army.js';

/** Logical size of the composed town view (the gfx module's `getTownLayout` uses the same box). */
export const TOWN_VIEW_W = 800;
export const TOWN_VIEW_H = 374;

export const HALL_LEVELS = ['village_hall', 'town_hall', 'city_hall', 'capitol'];
export const FORT_LEVELS = ['fort', 'citadel', 'castle'];

/** The player whose turn it is (or null). */
export function currentPlayer(state) {
  return state && state.players ? state.players[state.currentPlayer] || null : null;
}

/** Can the current player act in this town? */
export function canControlTown(state, town) {
  const p = currentPlayer(state);
  return !!p && !!town && town.owner === p.id && p.isHuman !== false;
}

export function hallLevel(town) {
  return HALL_LEVELS.findIndex((id) => town.buildings.includes(id)) + 1;
}
export function fortLevel(town) {
  return FORT_LEVELS.findIndex((id) => town.buildings.includes(id)) + 1;
}

/** "Citadel" / "Village" ... (the fort building's name, or "No fort"). */
export function fortName(town) {
  const lvl = fortLevel(town);
  return lvl ? getBuilding(FORT_LEVELS[lvl - 1]).name : 'No fort';
}
export function hallName(town) {
  const lvl = hallLevel(town);
  return lvl ? getBuilding(HALL_LEVELS[lvl - 1]).name : 'No hall';
}

export function factionName(id) {
  return FACTION_BY_ID[id] ? FACTION_BY_ID[id].name : id;
}

export function creatureName(id) {
  return CREATURE_BY_ID[id] ? CREATURE_BY_ID[id].name : id;
}

export function buildingName(id) {
  return BUILDING_BY_ID[id] ? BUILDING_BY_ID[id].name : id;
}

/**
 * What clicking a built building opens. One action per building (first match wins).
 * @returns {string} hall | fort | dwelling | horde | mage_guild | marketplace | tavern | blacksmith |
 *   shipyard | artifact_merchant | freelancers | altar | skeleton_transformer | castle_gate |
 *   university | portal | thieves_guild | mana_vortex | info
 */
export function buildingAction(buildingId, factionId) {
  const b = getBuilding(buildingId);
  const types = new Set(getBuildingEffects(buildingId, factionId).map((e) => e.type));
  if (b.kind === 'hall') return 'hall';
  if (b.kind === 'fort') return 'fort';
  if (b.kind === 'dwelling') return 'dwelling';
  if (b.kind === 'horde') return 'horde';
  if (b.kind === 'mage_guild' || types.has('mage_guild')) return 'mage_guild';
  if (types.has('recruit_heroes')) return 'tavern';
  if (types.has('trade_resources')) return 'marketplace';
  if (types.has('sells_war_machine')) return 'blacksmith';
  if (types.has('shipyard')) return 'shipyard';
  if (types.has('sells_artifacts')) return 'artifact_merchant';
  if (types.has('trade_creatures_for_resources')) return 'freelancers';
  if (types.has('sacrifice_altar')) return 'altar';
  if (types.has('skeleton_transform')) return 'skeleton_transformer';
  if (types.has('town_gate')) return 'castle_gate';
  if (types.has('teach_skill')) return 'university';
  if (types.has('portal_of_summoning')) return 'portal';
  if (types.has('thieves_guild')) return 'thieves_guild';
  if (types.has('mana_double')) return 'mana_vortex';
  return 'info';
}

/** Human-readable effect lines of a building (tooltips, info popups, hall dialog). */
export function buildingEffectLines(buildingId, factionId) {
  const out = [];
  for (const e of getBuildingEffects(buildingId, factionId)) {
    switch (e.type) {
      case 'resource_income': out.push(`+${e.value} ${e.resource} per day`); break;
      case 'growth_percent': out.push(`+${e.percent}% creature growth`); break;
      case 'creature_growth': out.push(`+${e.value} weekly growth of tier ${e.tier}`); break;
      case 'mage_guild': out.push(`Mage guild level ${e.level}`); break;
      case 'garrison_bonus': out.push(`Defenders: +${e.value} ${e.stat} in a siege`); break;
      case 'visit_bonus': out.push(`Visiting heroes: +${e.value} ${e.stat} (once)`); break;
      case 'sells_war_machine': out.push(`Sells ${e.machineId.replace(/_/g, ' ')} (${e.cost} gold)`); break;
      case 'thieves_guild': out.push(`Thieves' guild information +${e.value}`); break;
      case 'player_hero_bonus': out.push(`All your heroes: ${e.bonus.type.replace(/_/g, ' ')} ${e.bonus.value > 0 ? '+' : ''}${e.bonus.value ?? ''}`); break;
      case 'necromancy_bonus': out.push(`+${e.percent}% necromancy for all your heroes`); break;
      case 'gold_interest': out.push(`+${e.percent}% gold interest per week`); break;
      default: break;
    }
  }
  return out;
}

export const STATUS_TEXT = {
  built: 'Already built',
  available: 'Can be built',
  built_this_turn: 'Already built something today',
  not_enough_resources: 'Not enough resources',
  missing_requirements: 'Requires other buildings',
  no_water: 'Needs a coastal town',
  capitol_exists: 'You already have a Capitol',
  no_grail: 'Needs the Grail',
  not_available: 'Not available',
  already_built: 'Already built',
};

/** Status of an entry of `getAvailableBuildings` as a single key (built | available | <error>). */
export function hallStatus(row) {
  if (row.status === 'built') return 'built';
  if (row.status === 'available') return 'available';
  return row.error || 'not_available';
}

const KIND_ORDER = ['hall', 'fort', 'tavern', 'blacksmith', 'market', 'silo', 'mage_guild', 'shipyard', 'special', 'horde', 'grail', 'dwelling'];

/**
 * Group the hall list the way the original's Hall screen does: one card per *chain* (only the next
 * buildable/newest step is shown), dwellings by tier.
 * @param {Array} rows getAvailableBuildings() output
 * @param {string[]} built town.buildings
 * @returns {{id, name, kind, cost, status, key, missing, tier}[]} sorted
 */
export function hallCards(rows, built) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const cards = [];
  for (const r of rows) {
    const b = getBuilding(r.id);
    // Skip chain steps that are not the "frontier" of their chain.
    if (r.status === 'built' && !built.includes(r.id)) continue;                       // replaced
    if (r.status !== 'built' && b.replaces && byId[b.replaces] && byId[b.replaces].status !== 'built') continue; // predecessor not built yet
    if (r.status === 'built' && rows.some((o) => getBuilding(o.id).replaces === r.id && o.status !== 'built')) continue; // show the upgrade instead
    const tier = b.dwelling ? b.dwelling.tier : null;
    cards.push({ id: r.id, name: r.name, kind: r.kind, cost: r.cost, status: hallStatus(r), missing: r.missing || [], tier, alt: !!(b.dwelling && b.dwelling.alt) });
  }
  const order = (c) => (c.kind === 'dwelling' ? 100 + c.tier * 2 + (c.alt ? 1 : 0) : Math.max(0, KIND_ORDER.indexOf(c.kind)));
  return cards.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
}

/** Simple grid layout on the 800x374 view when gfx offers no `getTownLayout` (pure). */
export function fallbackLayout(buildingIds) {
  const out = {};
  const cols = 7;
  const w = 104;
  const h = 96;
  const gapX = (TOWN_VIEW_W - cols * w) / (cols + 1);
  const rows = Math.max(1, Math.ceil(buildingIds.length / cols));
  const gapY = Math.max(6, (TOWN_VIEW_H - 40 - rows * h) / (rows + 1));
  buildingIds.forEach((id, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    out[id] = { x: Math.round(gapX + c * (w + gapX)), y: Math.round(40 + gapY + r * (h + gapY)), w, h, z: r };
  });
  return out;
}

/**
 * Positions of the town's built buildings on the view.
 * Uses gfx `getTownLayout(faction)` when present (looking up the building or any predecessor in its
 * chain); buildings it does not place fall back to a grid.
 * @returns {{id, x, y, w, h, z}[]} sorted by z (back to front)
 */
export function layoutTown(town, getTownLayout = null) {
  let layout = null;
  if (typeof getTownLayout === 'function') {
    try { layout = getTownLayout(town.faction) || null; } catch { layout = null; }
  }
  const placed = [];
  const missing = [];
  for (const id of town.buildings) {
    let rect = null;
    if (layout) for (const key of predecessorsOf(id)) { if (layout[key]) { rect = layout[key]; break; } }
    if (rect) placed.push({ id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, z: rect.z ?? 0 });
    else missing.push(id);
  }
  if (missing.length) {
    const grid = fallbackLayout(missing);
    // When most buildings come from the gfx layout, squeeze the leftovers into a strip at the bottom.
    for (const id of missing) placed.push({ id, ...grid[id], z: (grid[id].z || 0) + (layout ? 100 : 0) });
  }
  return placed.sort((a, b) => a.z - b.z || a.y + a.h - (b.y + b.h));
}

/**
 * Rows of the creature growth panel: one per built dwelling (+ portal), with display names.
 * @param {Array} recruitInfo getRecruitInfo() output
 */
export function growthRows(recruitInfo) {
  return recruitInfo.map((r) => ({ ...r, name: creatureName(r.creatureId) }));
}

/**
 * The 7 creature tiers of the town's faction for the side panel: the built dwelling's growth row
 * (`built: true`) or a placeholder for a dwelling not built yet (`built: false`, base creature).
 * @param {Object} town
 * @param {Array} rows growthRows() output
 */
export function tierRows(town, rows) {
  const fac = FACTION_BY_ID[town.faction];
  if (!fac || !Array.isArray(fac.creatures)) return rows.map((r) => ({ ...r, built: true }));
  return fac.creatures.slice(0, 7).map((pair, i) => {
    const tier = i + 1;
    const ids = Array.isArray(pair) ? pair : [pair];
    const row = rows.find((r) => r.source !== "portal" && ids.includes(r.creatureId));
    if (row) return { ...row, tier: row.tier || tier, built: true };
    return { creatureId: ids[0], tier, name: creatureName(ids[0]), built: false };
  });
}

/**
 * Options of the recruit dialog for one dwelling row: with an upgraded dwelling the base creature is
 * still for sale (leftover base stock first, then the upgraded stock), as in the engine.
 */
export function recruitOptions(town, row) {
  const c = CREATURE_BY_ID[row.creatureId];
  const opts = [{ creatureId: row.creatureId, available: row.available, cost: row.cost }];
  if (row.source === 'dwelling' && c && c.upgradeOf) {
    const base = CREATURE_BY_ID[c.upgradeOf];
    const baseStock = town.stock[base.id] || 0;
    opts.unshift({ creatureId: base.id, available: baseStock + row.available, cost: base.cost });
  }
  return opts;
}

/** How many creatures with `cost` can be bought with `resources` (pure). */
export function affordableCount(resources, cost) {
  let n = Infinity;
  for (const r of RESOURCES) if (cost && cost[r]) n = Math.min(n, Math.floor((resources[r] || 0) / cost[r]));
  return n === Infinity ? 999999 : n;
}

/** Multiply a cost (pure). */
export function costTimes(cost, n) {
  const out = {};
  for (const [r, v] of Object.entries(cost || {})) if (v) out[r] = v * n;
  return out;
}

/** Max lots for a marketplace trade: `have` units of the given resource at `rate` (pure). */
export function maxLots(have, rate) {
  if (!rate || !rate.give) return 0;
  return Math.max(0, Math.floor((have || 0) / rate.give));
}

/** Total resource value (gold-equivalent) - used to rank rows in the kingdom screen. */
export function resourceValue(res) {
  return RESOURCES.reduce((n, r) => n + (res[r] || 0) * RESOURCE_VALUE[r], 0);
}

/**
 * Dismiss a whole stack from a bare army (pure helper over `army.js armyDismiss`; the screens use
 * the engine actions `hero.dismissStack` / `town.dismissTownStack`). Result-shaped.
 */
export function dismissStack(army, slot, isHeroArmy) {
  if (!army) return { ok: false, error: 'empty_slot' };
  const r = armyDismiss(army, slot, { keepOne: !!isHeroArmy });
  if (!r.ok) return r;
  return { ok: true, events: [{ type: 'stack_dismissed', slot, creatureId: r.stack.creatureId, count: r.stack.count }] };
}

/** Ordinal for thieves' guild rankings. */
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Town ids of the player in a stable order (prev / next town). */
export function playerTownIds(state, playerId) {
  const p = state.players[playerId];
  return p ? p.towns.filter((id) => state.towns[id]) : [];
}

/** Neighbour in a cyclic list (prev / next town or hero). */
export function cycle(list, current, dir) {
  if (!list.length) return null;
  const i = list.indexOf(current);
  if (i < 0) return list[0];
  return list[(i + dir + list.length) % list.length];
}

export const RUMORS = [
  'They say a dragon sleeps beneath the eastern hills, guarding a hoard of gold.',
  'A merchant swore he saw an obelisk glowing at midnight. Puzzle pieces, he muttered.',
  'The windmill keeper pays in gems this week - or so the miller claims.',
  'Some say the Grail lies under a tree no woodcutter dares to touch.',
  'Beware the swamp roads: the hydras grow fat on careless travellers.',
  'Old soldiers whisper that morale wins more battles than steel.',
  'A wandering wizard teaches spells to anyone with a book and a sharp mind.',
  'Gold flows to those who build markets, the guild master says.',
  'The angels of the north answer only to those who have earned their trust.',
  'A cartographer sold three maps of the same island, each one different.',
];

/** A rumour for this day (deterministic, does not touch the game rng). */
export function rumorFor(state) {
  const turn = state && state.turn ? state.turn : 1;
  return RUMORS[(turn * 7 + 3) % RUMORS.length];
}
