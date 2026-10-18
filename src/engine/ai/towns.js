// AI town management: build planner, recruitment, upgrades, garrison hand-over, hiring, market.
// Spec: docs/mechanics/ai.md "Town planner".
import { RESOURCES } from '../../core/constants.js';
import { getBuilding, missingRequirements, isBuilt, buildingsForFaction, RESOURCE_VALUE } from '../../data/buildings.js';
import { getCreature } from '../../data/creatures.js';
import { randInt } from '../../core/rng.js';
import {
  canBuild, build, getRecruitInfo, recruit, getUpgradeInfo, upgradeStack, townArmyMove, hireHero,
  getTavernHeroes, buySpellbook, getMageGuildLevel, getWarMachinesForSale, buyWarMachine, townHasWater,
} from '../town.js';
import { getTerrain } from '../../data/terrain.js';
import { findPath } from '../adventure/index.js';
import { ownsArtifact, getEquippedArtifacts } from '../artifacts.js';
import { getDailyIncome, getMarketRate, marketTrade, canAfford } from '../economy.js';
import { hasSpellbook } from '../hero.js';
import { heroKind } from './skills.js';
import { heroStrength, townDefense } from './strength.js';
import { spend, note, heroesOf, townsOf, chebyshev, dayMemory } from './context.js';

const SKIP_ERRORS = new Set(['not_available', 'no_water', 'capitol_exists', 'no_grail', 'already_built']);

/** Ordered building goals of a town. */
export function goalList(ctx, town) {
  const f = town.faction;
  const D = (t, up = false) => `${f}_dwelling_${t}${up ? '_up' : ''}`;
  const main = ctx.state.heroes[ctx.player.ai.mainHeroId];
  const magic = main && heroKind(main) === 'magic';
  const list = [
    'town_hall', D(1), 'fort', D(2), D(3), waterMap(ctx) && townHasWater(ctx.state, town) ? 'shipyard' : null,
    magic ? 'mage_guild_1' : null, 'citadel', D(4), 'city_hall', D(5),
    'castle', D(6), magic ? 'mage_guild_2' : null, D(7), 'capitol', D(7, true), D(6, true), D(5, true),
    D(4, true), 'mage_guild_2', D(3, true), 'mage_guild_3', D(2, true), D(1, true),
  ];
  const all = buildingsForFaction(f);
  for (const b of all) if (b.kind === 'horde') list.push(b.id);
  list.push('resource_silo', 'mage_guild_4', 'mage_guild_5', 'blacksmith', 'marketplace');
  for (const b of all) if (b.kind === 'special') list.push(b.id);
  const out = [];
  const seen = new Set();
  for (const id of list) {
    if (!id || seen.has(id)) continue;
    let b;
    try { b = getBuilding(id); } catch { continue; }
    if (!b || (b.faction !== 'common' && b.faction !== f)) continue;
    seen.add(id);
    out.push(id);
  }
  // Easy AI: a few random swaps of neighbouring goals.
  for (let i = 0; i < ctx.knobs.swaps && out.length > 2; i++) {
    const a = randInt(ctx.state.rng, 0, out.length - 2);
    [out[a], out[a + 1]] = [out[a + 1], out[a]];
  }
  return out;
}

/** First building to construct on the way to `goal` (prerequisites first), or null. */
export function nextStep(town, goal, depth = 0) {
  if (depth > 8) return null;
  if (isBuilt(town.buildings, goal)) return null;
  const missing = missingRequirements(town.buildings, goal);
  if (!missing.length) return goal;
  for (const m of missing) {
    const s = nextStep(town, m, depth + 1);
    if (s) return s;
  }
  return null;
}

/**
 * Use the marketplace to cover what `cost` lacks, from surplus resources. Trades are planned
 * first and only executed when the whole deficit can be covered. @returns {boolean} affordable now
 */
export function coverDeficit(ctx, cost, keepGold = 0) {
  const { state, playerId, player } = ctx;
  if (canAfford(state, playerId, cost)) return true;
  if (!ctx.knobs.market) return false;
  const res = { ...player.resources };
  const deficit = {};
  for (const r of RESOURCES) {
    const d = (cost[r] || 0) - (res[r] || 0);
    if (d > 0) deficit[r] = d;
  }
  const plan = [];
  for (const get of Object.keys(deficit)) {
    let need = deficit[get];
    const givers = RESOURCES.filter((g) => g !== get && !deficit[g])
      .map((g) => ({ g, surplus: (res[g] || 0) - (cost[g] || 0) - (g === 'gold' ? keepGold : 0) }))
      .filter((x) => x.surplus > 0)
      .sort((a, b) => b.surplus * RESOURCE_VALUE[b.g] - a.surplus * RESOURCE_VALUE[a.g]);
    for (const { g } of givers) {
      if (need <= 0) break;
      const rate = getMarketRate(state, playerId, g, get);
      if (!rate) return false;
      const surplus = (res[g] || 0) - (cost[g] || 0) - (g === 'gold' ? keepGold : 0);
      const lots = Math.min(Math.ceil(need / rate.get), Math.floor(surplus / rate.give));
      if (lots < 1) continue;
      plan.push({ give: g, get, lots });
      res[g] -= lots * rate.give;
      res[get] = (res[get] || 0) + lots * rate.get;
      need -= lots * rate.get;
    }
    if (need > 0) return false;
  }
  for (const t of plan) {
    if (!spend(ctx)) return false;
    const r = marketTrade(state, playerId, t.give, t.get, t.lots);
    if (!r.ok) { note(ctx, 'trade_failed', r.error); return false; }
    ctx.report.trades++;
  }
  return canAfford(state, playerId, cost);
}

/** Can the step be paid without wrecking the economy (market help allowed)? */
function marketCanCover(ctx, cost, keepGold) {
  if (!ctx.knobs.market) return false;
  const res = ctx.player.resources;
  let lack = 0;
  let spare = 0;
  for (const r of RESOURCES) {
    const d = (cost[r] || 0) - (res[r] || 0);
    if (d > 0) lack += d * RESOURCE_VALUE[r];
    else spare += (-d - (r === 'gold' ? keepGold : 0)) * RESOURCE_VALUE[r];
  }
  if (lack === 0) return true;
  // markets are lossy; assume ~1/5 efficiency with one marketplace
  return spare > lack * 5 && (res.gold || 0) - (cost.gold || 0) - keepGold > 0;
}

/** Build one building in the town (if any is worth it). @returns {string|null} built id */
export function planBuild(ctx, town) {
  const { state } = ctx;
  if (town.builtThisTurn) return null;
  // Grail first (does not use the daily build).
  for (const b of buildingsForFaction(town.faction)) {
    if (b.kind === 'grail' && canBuild(state, town.id, b.id).ok) {
      if (spend(ctx) && build(state, town.id, b.id).ok) ctx.report.builds++;
    }
  }
  const goals = goalList(ctx, town);
  let looked = 0;
  let keep = 0;
  for (const goal of goals) {
    const step = nextStep(town, goal);
    if (!step) continue;
    const check = canBuild(state, town.id, step);
    if (!check.ok && SKIP_ERRORS.has(check.error)) continue;
    if (!check.ok && check.error === 'missing_requirements') continue;
    if (!check.ok && check.error === 'built_this_turn') return null;
    const cost = getBuilding(step).cost || {};
    if (!ctx.player.heroes.length && (ctx.player.resources.gold || 0) - (cost.gold || 0) < 2500) return null;
    // a fallback goal must not eat the gold saved for a more important one
    if (keep && (ctx.player.resources.gold || 0) - (cost.gold || 0) < keep) { looked++; if (looked >= 3) break; continue; }
    if (check.ok || (check.error === 'not_enough_resources' && marketCanCover(ctx, cost, 0) && coverDeficit(ctx, cost, 0))) {
      if (!spend(ctx)) return null;
      const r = build(state, town.id, step);
      if (r.ok) {
        ctx.report.builds++;
        resetReserve(ctx);
        return step;
      }
      note(ctx, 'build_failed', `${step} ${r.error}`);
      continue;
    }
    // not affordable: look a little further, then save
    if (!looked && cost.gold && otherResourcesOk(ctx, cost)) {
      const income = Math.max(500, getDailyIncome(state, ctx.playerId).gold || 0);
      const days = ECONOMY.has(step) ? ctx.knobs.econDays : ctx.knobs.saveDays;
      if (cost.gold - (ctx.player.resources.gold || 0) <= days * income) keep = cost.gold;
    }
    looked++;
    if (looked >= 3) break;
  }
  return null;
}

const ECONOMY = new Set(['town_hall', 'city_hall', 'capitol']);

/** Can the non-gold part of `cost` be paid now (or with the market)? */
function otherResourcesOk(ctx, cost) {
  const res = ctx.player.resources;
  let lack = 0;
  let spare = 0;
  for (const r of RESOURCES) {
    if (r === 'gold') continue;
    const d = (cost[r] || 0) - (res[r] || 0);
    if (d > 0) lack += d * RESOURCE_VALUE[r];
    else spare += -d * RESOURCE_VALUE[r];
  }
  return lack === 0 || (ctx.knobs.market && spare > lack * 5);
}

/**
 * The next building the planner wants in this town and can pay except for gold:
 * `{id, cost}` or null (steps blocked by rare resources are not saved for).
 */
export function peekNextBuild(ctx, town) {
  let looked = 0;
  for (const goal of goalList(ctx, town)) {
    const step = nextStep(town, goal);
    if (!step) continue;
    const check = canBuild(ctx.state, town.id, step);
    if (!check.ok && (SKIP_ERRORS.has(check.error) || check.error === 'missing_requirements')) continue;
    const cost = getBuilding(step).cost || {};
    if (otherResourcesOk(ctx, cost)) return { id: step, cost };
    if (++looked >= 3) break;
  }
  return null;
}

/**
 * Gold kept back for planned buildings (all towns): a town hall / city hall / capitol is saved for
 * when it is within `econDays` of gold income, other buildings within `saveDays` (difficulty knobs).
 * Nothing is kept for a threatened town; without heroes 2500 are kept for a hire.
 */
export function goldReserve(ctx, town) {
  const { state } = ctx;
  const gold = ctx.player.resources.gold || 0;
  if (!ctx.player.heroes.length) return Math.min(2500, gold); // a new hero first
  if (town && ctx.threats[town.id]) return 0;
  if (ctx.reserve == null) {
    const income = Math.max(500, getDailyIncome(state, ctx.playerId).gold || 0);
    let total = 0;
    ctx.nextBuild = {};
    for (const t of townsOf(ctx)) {
      if (ctx.threats[t.id]) continue;
      const next = peekNextBuild(ctx, t);
      ctx.nextBuild[t.id] = next;
      if (!next || !next.cost.gold) continue;
      const days = ECONOMY.has(next.id) ? ctx.knobs.econDays : ctx.knobs.saveDays;
      if (next.cost.gold - Math.max(0, gold - total) > days * income) continue;
      total += next.cost.gold;
    }
    ctx.reserve = total;
  }
  return Math.min(ctx.reserve, gold);
}

/** Forget the cached reserve (after something was built). */
export function resetReserve(ctx) {
  ctx.reserve = null;
}

function armyOf(state, town, where) {
  if (where === 'visiting') return town.visitingHero ? state.heroes[town.visitingHero]?.army : null;
  if (town.garrisonHero) return state.heroes[town.garrisonHero]?.army;
  return town.garrison;
}

function canTake(army, creatureId) {
  return army.some((s) => s && s.creatureId === creatureId) || army.some((s) => !s);
}

/** Recruit the best creatures available, keeping `reserve` gold. */
export function recruitInTown(ctx, town, where, reserve = 0) {
  const { state, player } = ctx;
  let rows;
  try { rows = getRecruitInfo(state, town.id); } catch { return; }
  rows = rows.filter((r) => r.available > 0).sort((a, b) => b.tier - a.tier || getCreature(b.creatureId).aiValue - getCreature(a.creatureId).aiValue);
  for (const row of rows) {
    const army = armyOf(state, town, where);
    if (!army || !canTake(army, row.creatureId)) continue;
    let n = row.available;
    for (const r of RESOURCES) {
      const c = row.cost?.[r] || 0;
      if (!c) continue;
      const have = (player.resources[r] || 0) - (r === 'gold' ? reserve : 0);
      n = Math.min(n, Math.floor(Math.max(0, have) / c));
    }
    if (n < 1) continue;
    if (!spend(ctx)) return;
    const r = recruit(state, town.id, row.creatureId, n, where);
    if (r.ok) ctx.report.recruits += n;
    else note(ctx, 'recruit_failed', `${row.creatureId} ${r.error}`);
  }
}

/** Upgrade stacks while cheap. */
export function upgradeCheap(ctx, town, where) {
  const { state, player } = ctx;
  const army = armyOf(state, town, where);
  if (!army) return;
  for (let slot = 0; slot < 7; slot++) {
    if (!army[slot]) continue;
    const info = getUpgradeInfo(state, { townId: town.id, where, slot });
    if (!info) continue;
    if (!canAfford(state, ctx.playerId, info.cost)) continue;
    let frac = 0;
    for (const r of RESOURCES) if (info.cost[r]) frac = Math.max(frac, info.cost[r] / Math.max(1, player.resources[r] || 0));
    if (frac > 0.25) continue;
    if (!spend(ctx)) return;
    const r = upgradeStack(state, { townId: town.id, where, slot });
    if (!r.ok) note(ctx, 'upgrade_failed', r.error);
  }
}

/**
 * Move stacks of army `src` into `dst` (strongest first): merge, free slot, or swap with a weaker
 * stack. `move(i, j, count?)` performs one move and returns a Result.
 */
export function mergeArmies(ctx, src, dst, move, keepOne) {
  const value = (s) => (s ? getCreature(s.creatureId).aiValue * s.count : 0);
  const order = src.map((s, i) => i).filter((i) => src[i]).sort((a, b) => value(src[b]) - value(src[a]));
  for (const i of order) {
    const s = src[i];
    if (!s) continue;
    const left = src.filter(Boolean).length;
    let count;
    if (keepOne && left <= 1) {
      if (s.count <= 1) break;
      count = s.count - 1;
    }
    let j = dst.findIndex((d) => d && d.creatureId === s.creatureId);
    if (j < 0) j = dst.findIndex((d) => !d);
    if (j < 0) {
      if (count) continue; // a partial move cannot swap
      let weakest = -1;
      for (let k = 0; k < 7; k++) if (dst[k] && (weakest < 0 || value(dst[k]) < value(dst[weakest]))) weakest = k;
      if (weakest < 0 || value(dst[weakest]) * 1.2 >= value(s)) continue;
      j = weakest;
    }
    if (!spend(ctx)) return;
    const r = move(i, j, count);
    if (!r || !r.ok) note(ctx, 'army_move_failed', r && r.error);
  }
}

/** Visiting hero takes the garrison troops (main hero; any hero when the town is not threatened and he is the only one). */
export function garrisonToHero(ctx, town) {
  const { state } = ctx;
  const hero = town.visitingHero ? state.heroes[town.visitingHero] : null;
  if (!hero || hero.owner !== ctx.playerId) return;
  const gh = town.garrisonHero ? state.heroes[town.garrisonHero] : null;
  // a secondary hero standing guard in the garrison row hands his troops over too (keeps one stack)
  if (gh && (gh.owner !== ctx.playerId || ctx.player.ai.mainHeroId !== hero.id)) return;
  mergeArmies(ctx, gh ? gh.army : town.garrison, hero.army,
    (i, j, count) => townArmyMove(state, town.id, { where: 'garrison', slot: i }, { where: 'visiting', slot: j }, count), !!gh);
}

/** Town actions with the visiting hero present (called on entering a town and in the town phase). */
export function townVisitActions(ctx, town) {
  const { state } = ctx;
  const hero = town.visitingHero ? state.heroes[town.visitingHero] : null;
  if (!hero || hero.owner !== ctx.playerId) return;
  const main = ctx.player.ai.mainHeroId === hero.id;
  // the Grail structure (needs the carrier inside, does not use the daily build)
  if (ownsArtifact(hero, 'grail')) {
    for (const b of buildingsForFaction(town.faction)) {
      if (b.kind === 'grail' && canBuild(state, town.id, b.id).ok && spend(ctx) && build(state, town.id, b.id).ok) ctx.report.builds++;
    }
  }
  const reserve = goldReserve(ctx, town);
  const gold = () => ctx.player.resources.gold || 0;
  // spellbook: always for the main hero, for others when rich (magic heroes) or very rich
  if (!hasSpellbook(hero) && getMageGuildLevel(town) > 0) {
    const need = main ? 2500 : heroKind(hero) === 'magic' ? 5000 : 12000;
    if (gold() >= 500 + reserve + need && spend(ctx)) buySpellbook(state, town.id, hero.id);
  }
  if (main) {
    // an enemy hero about two days away: the garrison stays (an empty town is lost to anyone) -
    // unless with it the main hero is strong enough to go and beat that enemy
    const near = nearEnemyStrength(ctx, town);
    const gh = town.garrisonHero ? state.heroes[town.garrisonHero] : null;
    const withGarrison = heroStrength(state, hero, [...hero.army, ...(gh ? gh.army : town.garrison)]);
    if (!near || withGarrison >= near * ctx.knobs.attackRatio) garrisonToHero(ctx, town);
    recruitInTown(ctx, town, 'visiting', reserve);
    upgradeCheap(ctx, town, 'visiting');
    buyWarMachines(ctx, town, hero, reserve);
  } else {
    const mainHero = state.heroes[ctx.player.ai.mainHeroId];
    // the main hero is away and the garrison has grown bigger than his army: this hero takes it
    // over (and becomes the main hero, see assignMainHero)
    if (!ctx.threats[town.id] && !enemyNear(ctx, town) && (!mainHero || heroStrength(state, mainHero) < strengthOfArmy(town.garrison))) {
      recruitInTown(ctx, town, 'garrison', reserve);
      garrisonToHero(ctx, town);
    } else {
      recruitInTown(ctx, town, 'garrison', reserve);
    }
  }
}

/** Strongest enemy hero (strength ≥ 1000) within about two days (Chebyshev) of the town, 0 if none. Cached per turn. */
export function nearEnemyStrength(ctx, town) {
  ctx.enemyNear ??= {};
  if (ctx.enemyNear[town.id] === undefined) {
    const { state } = ctx;
    const me = ctx.player.team;
    let worst = 0;
    for (const e of Object.values(state.heroes)) {
      if (e.owner == null || e.owner === ctx.playerId || e.garrisoned || !state.players[e.owner]?.alive) continue;
      if (me != null && state.players[e.owner].team === me) continue;
      if (chebyshev(e.pos, town.pos) > 2 * Math.ceil((e.maxMovePoints || 1500) / 100)) continue;
      const st = heroStrength(state, e);
      if (st >= 1000) worst = Math.max(worst, st);
    }
    ctx.enemyNear[town.id] = worst;
  }
  return ctx.enemyNear[town.id];
}

export function enemyNear(ctx, town) {
  return nearEnemyStrength(ctx, town) > 0;
}

function strengthOfArmy(army) {
  let v = 0;
  for (const s of army || []) if (s && s.count > 0) v += getCreature(s.creatureId).aiValue * s.count;
  return v;
}

const MACHINE_ORDER = ['ballista', 'first_aid_tent', 'ammo_cart', 'cannon'];

/** Blacksmith: war machines for the main hero, only from spare gold (after troops). */
export function buyWarMachines(ctx, town, hero, reserve = 0) {
  const { state } = ctx;
  let offers;
  try { offers = getWarMachinesForSale(state, town.id); } catch { return; }
  offers = offers.slice().sort((a, b) => MACHINE_ORDER.indexOf(a.machineId) - MACHINE_ORDER.indexOf(b.machineId));
  for (const o of offers) {
    if (getEquippedArtifacts(hero).some((e) => e.id === o.machineId)) continue;
    if ((ctx.player.resources.gold || 0) < reserve + o.cost + 3000) continue;
    if (!spend(ctx)) return;
    const r = buyWarMachine(state, town.id, o.machineId, hero.id);
    if (r.ok) ctx.report.machines = (ctx.report.machines || 0) + 1;
    else if (r.error !== 'slot_occupied') note(ctx, 'war_machine_failed', `${o.machineId} ${r.error}`);
  }
}

/** Share of water tiles on the map (cached per turn). */
export function waterMap(ctx) {
  if (ctx.waterShare == null) {
    const { map } = ctx.state;
    let water = 0;
    let all = 0;
    for (const level of map.tiles || []) {
      for (const row of level) {
        for (const t of row) {
          all++;
          try { if (getTerrain(t.t).water) water++; } catch { /* unknown terrain */ }
        }
      }
    }
    ctx.waterShare = all ? water / all : 0;
  }
  return ctx.waterShare > 0.15;
}

/**
 * Threat detection: own towns that a stronger enemy hero can reach within a day (by path: at most
 * one day of full movement, half of it when he sits in his own town). Fills ctx.threats.
 */
export function computeThreats(ctx) {
  const { state } = ctx;
  ctx.threats = {};
  const enemies = Object.values(state.heroes).filter((h) => h.owner != null && h.owner !== ctx.playerId && !h.garrisoned
    && state.players[h.owner]?.alive);
  ctx.threatPathCache ??= new Map();
  for (const town of townsOf(ctx)) {
    let worst = 0;
    const defense = townDefense(state, town, false); // our heroes inside decide separately (hold / swap)
    for (const e of enemies) {
      // a hero sitting in his own town is only a threat when he is very close
      const days = e.townId ? 0.75 : 1.5;
      const maxMove = e.maxMovePoints || 1500;
      if (chebyshev(e.pos, town.pos) > Math.ceil(days * maxMove / 100)) continue;
      const s = heroStrength(state, e);
      if (s <= defense * 0.9) continue;
      const key = `${e.id}|${e.pos.x},${e.pos.y},${e.pos.z || 0}|${town.id}`;
      let cost = ctx.threatPathCache.get(key);
      if (cost === undefined) {
        let found = null;
        try { found = findPath(state, e.id, town.pos); } catch { found = null; }
        cost = found ? found.cost : Infinity;
        ctx.threatPathCache.set(key, cost);
      }
      if (cost > days * maxMove) continue;
      worst = Math.max(worst, s);
    }
    if (worst > 0) ctx.threats[town.id] = worst;
  }
}

export function heroCap(ctx) {
  const w = ctx.state.map?.width || 36;
  let cap = w <= 36 ? 3 : w <= 72 ? 4 : w <= 108 ? 5 : 6;
  cap += ctx.knobs.heroDelta;
  return Math.max(1, Math.min(8, cap));
}

/** Hire at most one hero per day if under the cap. @returns {string|null} new hero id */
export function hireIfUseful(ctx) {
  const { state, player } = ctx;
  if (ctx.hiredToday || dayMemory(ctx).hired) return null;
  const heroes = heroesOf(ctx);
  const cap = heroCap(ctx);
  const noHero = heroes.length === 0;
  if (!noHero && heroes.length >= cap) return null;
  // a second hero early (scouting / collecting pays for itself); later ones only with spare gold
  const need = noHero ? 2500 : 2500 + (heroes.length < 2 ? 500 : ctx.knobs.hireSpare);
  if ((player.resources.gold || 0) < need) return null;
  const offers = getTavernHeroes(state, ctx.playerId);
  let bestIdx = -1;
  let bestV = -1;
  offers.forEach((o, i) => {
    if (!o) return;
    const v = (o.level || 1) * 10 + (o.classId && heroKind({ classId: o.classId }) === 'might' ? 3 : 0);
    if (v > bestV) { bestV = v; bestIdx = i; }
  });
  if (bestIdx < 0) return null;
  // the town under the biggest threat first, else the first free town with a tavern
  const towns = townsOf(ctx).filter((t) => !t.visitingHero).sort((a, b) => (ctx.threats[b.id] || 0) - (ctx.threats[a.id] || 0));
  for (const town of towns) {
    if (!spend(ctx)) return null;
    const r = hireHero(state, town.id, bestIdx);
    if (r.ok) {
      ctx.report.hires++;
      ctx.hiredToday = true;
      dayMemory(ctx).hired = true;
      return r.heroId;
    }
    if (r.error !== 'no_tavern' && r.error !== 'town_occupied') { note(ctx, 'hire_failed', r.error); break; }
  }
  return null;
}

