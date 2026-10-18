// Economy: player resources, daily income, difficulty tables, marketplace trading.
// Spec: docs/mechanics/towns.md §5/§7 and docs/mechanics/game-loop.md.

import { RESOURCES, emptyResources } from '../core/constants.js';
import { getBuildingEffects, marketRate } from '../data/buildings.js';
import { deps } from './gameDeps.js';
import { getArtifactBonuses } from './artifacts.js';
import './gameDepsReal.js'; // binds hero / bonuses / adventure into `deps`

const ok = (events = [], extra = {}) => ({ ok: true, events, ...extra });
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

// ---------------------------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------------------------

const res = (gold, woodOre, rare) => ({
  gold, wood: woodOre, ore: woodOre, mercury: rare, sulfur: rare, crystal: rare, gems: rare,
});

/**
 * Difficulty levels 0..4 (settings.difficulty). `human` / `ai` = starting resources (original
 * tables), `ratingPercent` = score multiplier, `aiIncomePercent` = multiplier of the AI's daily
 * income (100 in the original at every level), `neutralStrength` = multiplier applied by the map
 * generator / adventure engine to neutral stack sizes and by this module to neutral town garrisons.
 */
export const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', ratingPercent: 80, human: res(30000, 30, 15), ai: res(5000, 5, 2), aiIncomePercent: 100, neutralStrength: 0.8 },
  { id: 'normal', name: 'Normal', ratingPercent: 100, human: res(20000, 20, 10), ai: res(7500, 10, 5), aiIncomePercent: 100, neutralStrength: 1 },
  { id: 'hard', name: 'Hard', ratingPercent: 130, human: res(15000, 15, 7), ai: res(10000, 15, 7), aiIncomePercent: 100, neutralStrength: 1.15 },
  { id: 'expert', name: 'Expert', ratingPercent: 160, human: res(10000, 10, 4), ai: res(10000, 15, 7), aiIncomePercent: 100, neutralStrength: 1.3 },
  { id: 'impossible', name: 'Impossible', ratingPercent: 200, human: res(0, 0, 0), ai: res(10000, 15, 7), aiIncomePercent: 100, neutralStrength: 1.5 },
];

export function getDifficulty(level = 1) {
  const d = DIFFICULTIES[level];
  if (!d) throw new Error(`Unknown difficulty: ${level}`);
  return d;
}

/** Starting resources of a player on a difficulty level (fresh object). */
export function startingResources(difficulty, isHuman = true) {
  const d = getDifficulty(difficulty);
  return { ...(isHuman ? d.human : d.ai) };
}

/** Multiplier for neutral monster stacks / neutral garrisons on the game's difficulty. */
export function getNeutralStrengthMultiplier(state) {
  return getDifficulty(state.settings?.difficulty ?? 1).neutralStrength;
}

// ---------------------------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------------------------

function playerOf(state, playerId) {
  const p = state.players[playerId];
  if (!p) throw new Error(`Unknown player: ${playerId}`);
  return p;
}

/** `cost` multiplied by `n` (zero entries dropped). */
export function costTimes(cost, n) {
  const out = {};
  for (const r of RESOURCES) if (cost?.[r]) out[r] = cost[r] * n;
  return out;
}

export function addCosts(a, b) {
  const out = {};
  for (const r of RESOURCES) {
    const v = (a?.[r] || 0) + (b?.[r] || 0);
    if (v) out[r] = v;
  }
  return out;
}

export function canAfford(state, playerId, cost) {
  const have = playerOf(state, playerId).resources;
  return RESOURCES.every((r) => (cost?.[r] || 0) <= (have[r] || 0));
}

/** How many times the player can pay `cost` (Infinity for a free cost). */
export function maxAffordable(state, playerId, cost) {
  const have = playerOf(state, playerId).resources;
  let n = Infinity;
  for (const r of RESOURCES) if (cost?.[r] > 0) n = Math.min(n, Math.floor((have[r] || 0) / cost[r]));
  return n;
}

/** Deduct `cost`; false (nothing changed) when the player cannot afford it. */
export function pay(state, playerId, cost) {
  if (!canAfford(state, playerId, cost)) return false;
  const have = playerOf(state, playerId).resources;
  for (const r of RESOURCES) if (cost?.[r]) have[r] -= cost[r];
  return true;
}

/** Add resources (negative values allowed, never dropping below zero). */
export function addResources(state, playerId, gain) {
  const have = playerOf(state, playerId).resources;
  for (const r of RESOURCES) if (gain?.[r]) have[r] = Math.max(0, (have[r] || 0) + gain[r]);
  return have;
}

// ---------------------------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------------------------

function addInto(target, resource, value) {
  if (RESOURCES.includes(resource) && value) target[resource] = (target[resource] || 0) + value;
}

/** Daily income of one town (halls, silo, grail): its `resource_income` effects. */
export function getTownIncome(town) {
  const out = emptyResources();
  for (const b of town.buildings) {
    for (const e of getBuildingEffects(b, town.faction)) {
      if (e.type === 'resource_income') addInto(out, e.resource, e.value);
    }
  }
  return out;
}

/**
 * Daily income split by source: `{ towns, mines, heroes, total }` (each a full Resources object).
 * Heroes: every `resource_income` bonus (Estates, artifacts, resource specialties).
 */
export function getIncomeBreakdown(state, playerId) {
  const player = playerOf(state, playerId);
  const towns = emptyResources();
  const mines = emptyResources();
  const heroes = emptyResources();
  for (const townId of player.towns) {
    const t = getTownIncome(state.towns[townId]);
    for (const r of RESOURCES) towns[r] += t[r];
  }
  const m = (state.map && deps.getMineIncome(state, playerId)) || {};
  for (const r of RESOURCES) mines[r] += m[r] || 0;
  for (const heroId of player.heroes) {
    const hero = state.heroes[heroId];
    if (!hero) continue;
    for (const b of deps.getHeroBonuses(state, hero)) {
      if (b.type === 'resource_income') addInto(heroes, b.resource, b.value);
    }
  }
  const total = emptyResources();
  const pct = player.isHuman ? 100 : getDifficulty(state.settings?.difficulty ?? 1).aiIncomePercent;
  for (const r of RESOURCES) total[r] = Math.floor((towns[r] + mines[r] + heroes[r]) * pct / 100);
  return { towns, mines, heroes, total };
}

/** @returns {Resources} what the player receives at the start of each day */
export function getDailyIncome(state, playerId) {
  return getIncomeBreakdown(state, playerId).total;
}

/** Pay out one day of income. */
export function applyDailyIncome(state, playerId) {
  const income = getDailyIncome(state, playerId);
  addResources(state, playerId, income);
  return ok([{ type: 'income', playerId, income }]);
}

// ---------------------------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------------------------

/** Number of the player's towns with a `trade_resources` building (+ `extra`, e.g. Trading Posts). */
export function countMarketplaces(state, playerId, extra = 0) {
  let n = extra;
  const player = playerOf(state, playerId);
  for (const townId of player.towns) {
    const town = state.towns[townId];
    if (town.buildings.some((b) => getBuildingEffects(b, town.faction).some((e) => e.type === 'trade_resources'))) n++;
  }
  // Merchant's Scales (`marketplace_count`) of the player's heroes: "as if you owned one more
  // marketplace" - only improves the rate, it does not open a market by itself
  if (n > 0) {
    for (const heroId of player.heroes || []) {
      const hero = state.heroes?.[heroId];
      if (hero) for (const b of getArtifactBonuses(hero)) if (b.type === 'marketplace_count') n += b.value || 0;
    }
  }
  return n;
}

/** `{give, get}` for the player right now, or null without any marketplace. */
export function getMarketRate(state, playerId, give, get, ctx = {}) {
  const markets = countMarketplaces(state, playerId, ctx.extraMarkets || 0);
  if (markets < 1) return null;
  return marketRate(give, get, markets);
}

/**
 * Trade `lots` lots at the marketplace: pays `lots * rate.give` of `give`, receives
 * `lots * rate.get` of `get`.
 * @param {{townId?: string, extraMarkets?: number}} [ctx] `extraMarkets`: Trading Posts on the map
 *   (a hero visiting one may trade even without a town marketplace).
 */
export function marketTrade(state, playerId, give, get, lots, ctx = {}) {
  if (!RESOURCES.includes(give) || !RESOURCES.includes(get) || give === get) return fail('bad_resource');
  if (!Number.isInteger(lots) || lots < 1) return fail('bad_amount');
  if (ctx.townId) {
    const town = state.towns[ctx.townId];
    if (!town || town.owner !== playerId) return fail('not_your_town');
  }
  const rate = getMarketRate(state, playerId, give, get, ctx);
  if (!rate) return fail('no_marketplace');
  const cost = { [give]: rate.give * lots };
  if (!pay(state, playerId, cost)) return fail('not_enough_resources');
  addResources(state, playerId, { [get]: rate.get * lots });
  return ok([{ type: 'market_trade', playerId, give, gave: rate.give * lots, get, got: rate.get * lots }]);
}

/** Send resources to another player (free, 1:1; needs a marketplace). */
export function sendResources(state, fromPlayerId, toPlayerId, resource, amount, ctx = {}) {
  if (!RESOURCES.includes(resource)) return fail('bad_resource');
  if (!Number.isInteger(amount) || amount < 1) return fail('bad_amount');
  const to = state.players[toPlayerId];
  if (!to || !to.alive || toPlayerId === fromPlayerId) return fail('bad_player');
  if (countMarketplaces(state, fromPlayerId, ctx.extraMarkets || 0) < 1) return fail('no_marketplace');
  if (!pay(state, fromPlayerId, { [resource]: amount })) return fail('not_enough_resources');
  addResources(state, toPlayerId, { [resource]: amount });
  return ok([{ type: 'resources_sent', from: fromPlayerId, to: toPlayerId, resource, amount }]);
}
