// Game loop: game creation from a MapBlueprint, turn order, day/week/month ticks, AI hook,
// save/load, kingdom overview. Spec: docs/mechanics/game-loop.md.

import { FACTIONS, PLAYER_COLORS, RESOURCES } from '../core/constants.js';
import { createRng, pick, randInt } from '../core/rng.js';
import { getFaction } from '../data/factions.js';
import { getHeroDef } from '../data/heroes.js';
import { getBuilding } from '../data/buildings.js';
import { armyStrength } from './army.js';
import { giveArtifact, pickRandomArtifact } from './artifacts.js';
import { hasPending, getPending, resolvePending as resolvePendingRaw } from './pending.js';
import { deps } from './gameDeps.js';
import './gameDepsReal.js';
import { applyBlueprintExtras, applyTimedEvents } from './blueprintExtras.js';
import {
  startingResources, addResources, applyDailyIncome, getIncomeBreakdown, countMarketplaces,
  getNeutralStrengthMultiplier, getDifficulty,
} from './economy.js';
import { advanceDate, rollWeekEvent } from './calendar.js';
import {
  createTown, visitTown, startOfDayTown, startOfWeekTown, startOfMonthTown, applyWeeklyTownResources,
  applyFogCover, refreshTavern, ensureTavernPool, getFreeHeroDefs, getTownGrowth, getMageGuildLevel,
  getThievesGuildLevel, seedNeutralGarrison, getGarrisonArmy, getAvailableBuildings,
} from './town.js';
import {
  checkVictory, eliminatePlayer, pushLog, normalizeVictory, normalizeLoss, getScoreBreakdown,
  DAYS_WITHOUT_TOWN_LIMIT,
} from './victory.js';

export { checkVictory, eliminatePlayer, calculateScore, getRankTitle, getScoreBreakdown, recordDefeat } from './victory.js';
export { setGameDeps, resetGameDeps, useFallbackDeps } from './gameDeps.js';

export const GAME_VERSION = 1;

const ok = (events = [], extra = {}) => ({ ok: true, events, ...extra });
const fail = (error) => ({ ok: false, error });
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------

/** Starting bonus options of the new-game screen. */
export const STARTING_BONUSES = ['none', 'gold', 'resource', 'artifact', 'random'];

function defaultPlayers(blueprint) {
  const slots = new Set();
  for (const t of blueprint.towns || []) if (t.ownerSlot != null) slots.add(t.ownerSlot);
  for (const h of blueprint.heroes || []) if (h.ownerSlot != null) slots.add(h.ownerSlot);
  return [...slots].sort((a, b) => a - b).map((slot, i) => ({ slot, isHuman: i === 0, faction: 'random' }));
}

/**
 * Team (alliance) of a player slot: `settings.players[i].team`, else the blueprint's
 * `meta.players[k].team` / `meta.teams[slot]` (map generator). Players without a team are alone.
 */
function teamOf(blueprint, cfg) {
  if (cfg.team != null) return cfg.team;
  const meta = blueprint.meta || {};
  const mp = Array.isArray(meta.players) ? meta.players.find((p) => p && p.slot === cfg.slot) : null;
  if (mp && mp.team != null) return mp.team;
  if (Array.isArray(meta.teams) && meta.teams[cfg.slot] != null) return meta.teams[cfg.slot];
  return null;
}

function resolvePlayerFaction(state, blueprint, cfg) {
  if (cfg.faction && cfg.faction !== 'random') return getFaction(cfg.faction).id;
  const fixed = (blueprint.towns || []).find((t) => t.ownerSlot === cfg.slot && t.faction && t.faction !== 'random');
  if (fixed) return getFaction(fixed.faction).id;
  // allowed towns of the slot (map editor): settings, else the blueprint's meta.players[].factions
  const mp = Array.isArray(blueprint.meta?.players) ? blueprint.meta.players.find((p) => p && p.slot === cfg.slot) : null;
  const allowed = (cfg.allowedFactions && cfg.allowedFactions.length ? cfg.allowedFactions : mp?.factions || []).filter((f) => FACTIONS.includes(f));
  return pick(state.rng, allowed.length ? allowed : FACTIONS);
}

function randomHeroDef(state, faction) {
  const free = getFreeHeroDefs(state);
  const own = free.filter((d) => d.faction === faction);
  const pool = own.length ? own : free;
  if (!pool.length) throw new Error('No free hero left');
  return pick(state.rng, pool).id;
}

function placeHero(state, player, defId, pos) {
  const hero = deps.addHero(state, defId, player.id, { x: pos.x, y: pos.y, z: pos.z || 0 }, { starting: true });
  const town = Object.values(state.towns).find((t) => t.owner === player.id && !t.visitingHero
    && t.pos.x === pos.x && t.pos.y === pos.y && (t.pos.z || 0) === (pos.z || 0));
  if (town) visitTown(state, hero.id, town.id);
  if (state.map) deps.revealAround(state, player.id, hero.pos, deps.getSightRadius(state, hero));
  return hero;
}

/** Apply the starting bonus choice (gold 500-1000 / faction resources / a treasure artifact). */
export function applyStartingBonus(state, playerId, bonus) {
  const player = state.players[playerId];
  let kind = bonus || 'none';
  if (kind === 'random') kind = pick(state.rng, ['gold', 'resource', 'artifact']);
  const hero = state.heroes[player.heroes[0]];
  if (kind === 'artifact' && !hero) kind = 'gold';
  if (kind === 'gold') {
    const gold = 500 + 100 * randInt(state.rng, 0, 5);
    addResources(state, playerId, { gold });
    return { kind, gold };
  }
  if (kind === 'resource') {
    const silo = getFaction(player.faction).siloResources;
    const gain = {};
    for (const r of silo) gain[r] = silo.length > 1 ? randInt(state.rng, 5, 10) : randInt(state.rng, 3, 6);
    addResources(state, playerId, gain);
    return { kind, resources: gain };
  }
  if (kind === 'artifact') {
    const artifactId = pickRandomArtifact(state.rng, 'treasure');
    giveArtifact(hero, artifactId);
    return { kind, artifactId, heroId: hero.id };
  }
  return { kind: 'none' };
}

function resolveConditionRefs(cond, townIds, heroIds) {
  const out = { ...cond };
  if (out.townIndex != null && out.townId == null) out.townId = townIds[out.townIndex];
  if (out.heroIndex != null && out.heroId == null) out.heroId = heroIds[out.heroIndex];
  return out;
}

/**
 * Build a GameState from a map blueprint (DESIGN.md §8).
 * @param {{map: object, towns?: object[], heroes?: object[], meta?: object}} blueprint
 *   towns: `{ pos, faction | 'random', ownerSlot | null, name?, buildings? }`,
 *   heroes: `{ ownerSlot, pos, defId | 'random' }`
 * @param {{seed?: number, difficulty?: number, players?: object[], victory?: any, loss?: any}} [settings]
 *   players: `{ slot, name?, isHuman, faction | 'random', color?, bonus? }`; victory / loss may use
 *   `townIndex` / `heroIndex` (blueprint indices) instead of entity ids. Further options:
 *   `autoHeroes` (default true: a player with a town but no blueprint hero gets a random hero of his
 *   faction in the main town), `neutralGarrisons` (default true), `manualAi`, `forceWeekEvent`.
 */
export function createGame(blueprint, settings = {}) {
  const difficulty = settings.difficulty ?? 1;
  getDifficulty(difficulty);
  const playerCfgs = (settings.players && settings.players.length ? settings.players : defaultPlayers(blueprint))
    .slice().sort((a, b) => a.slot - b.slot);
  if (!playerCfgs.length) throw new Error('createGame: no players');
  const state = {
    version: GAME_VERSION,
    rng: createRng(settings.seed ?? 1),
    nextId: 1,
    turn: 1,
    date: { day: 1, week: 1, month: 1 },
    weekOf: { creatureId: null, kind: 'normal', name: 'Week of the Squirrel' },
    currentPlayer: 0,
    players: [],
    heroes: {},
    towns: {},
    map: clone(blueprint.map),
    combat: null,
    pending: [],
    settings: { ...clone(settings), difficulty, players: clone(playerCfgs) },
    log: [],
    winner: null,
    gameOver: null,
    heroPool: {},
    meta: clone(blueprint.meta || {}),
  };
  state.map.objects ??= {};

  // players
  const usedColors = new Set(playerCfgs.map((c) => c.color).filter(Boolean));
  const slotToPlayer = {};
  playerCfgs.forEach((cfg, i) => {
    let color = cfg.color;
    if (!color) {
      color = PLAYER_COLORS.find((c) => !usedColors.has(c)) || PLAYER_COLORS[i % PLAYER_COLORS.length];
      usedColors.add(color);
    }
    const isHuman = cfg.isHuman !== false;
    const team = teamOf(blueprint, cfg);
    state.players.push({
      id: i, slot: cfg.slot, color, name: cfg.name || `Player ${i + 1}`, isHuman,
      faction: resolvePlayerFaction(state, blueprint, cfg), alive: true,
      resources: startingResources(difficulty, isHuman),
      heroes: [], towns: [], explored: [], tavernHeroes: [], daysWithoutTown: 0, ai: {}, visited: {},
      ...(team != null ? { team } : {}),
    });
    slotToPlayer[cfg.slot] = i;
  });

  // towns (+ their map objects)
  const townIds = [];
  for (const bt of blueprint.towns || []) {
    const owner = bt.ownerSlot != null && slotToPlayer[bt.ownerSlot] != null ? slotToPlayer[bt.ownerSlot] : null;
    const faction = bt.faction && bt.faction !== 'random' ? bt.faction
      : owner != null ? state.players[owner].faction : pick(state.rng, FACTIONS);
    const town = createTown(state, { faction, owner, pos: bt.pos, name: bt.name, buildings: bt.buildings, role: bt.role });
    const obj = deps.addObject(state, 'town', town.pos, { owner, data: { townId: town.id } });
    if (obj) {
      obj.data ??= {};
      obj.data.townId = town.id;
      obj.owner = owner;
      town.objectId = obj.id;
    }
    if (owner == null && settings.neutralGarrisons !== false) seedNeutralGarrison(state, town.id, getNeutralStrengthMultiplier(state));
    townIds.push(town.id);
  }

  // heroes
  const heroIds = [];
  const hasHero = new Set();
  for (const bh of blueprint.heroes || []) {
    const pid = slotToPlayer[bh.ownerSlot];
    if (pid == null) {
      heroIds.push(null);
      continue;
    }
    const player = state.players[pid];
    const defId = bh.defId && bh.defId !== 'random' ? getHeroDef(bh.defId).id : randomHeroDef(state, player.faction);
    heroIds.push(placeHero(state, player, defId, bh.pos).id);
    hasHero.add(pid);
  }
  if (settings.autoHeroes !== false) {
    for (const player of state.players) {
      if (hasHero.has(player.id) || !player.towns.length) continue;
      placeHero(state, player, randomHeroDef(state, player.faction), state.towns[player.towns[0]].pos);
    }
  }

  // starting bonus, tavern pools
  state.players.forEach((player, i) => {
    const bonus = applyStartingBonus(state, player.id, playerCfgs[i].bonus);
    if (bonus.kind !== 'none') pushLog(state, { type: 'starting_bonus', playerId: player.id, ...bonus });
  });
  for (const player of state.players) ensureTavernPool(state, player.id);

  // victory / loss
  state.settings.victory = resolveConditionRefs(normalizeVictory(settings.victory), townIds, heroIds);
  state.settings.loss = resolveConditionRefs(normalizeLoss(settings.loss), townIds, heroIds);
  const loss = state.settings.loss;
  if (loss.type === 'lose_hero' && loss.playerId == null) {
    const h = Object.values(state.heroes).find((x) => x.id === loss.heroId || x.defId === loss.heroDefId);
    if (h) loss.playerId = h.owner;
  }
  if (loss.type === 'lose_town' && loss.playerId == null && state.towns[loss.townId]) loss.playerId = state.towns[loss.townId].owner;

  // slot owners -> players, kill_hero quests, starting-hero extras, timed events (blueprintExtras.js)
  applyBlueprintExtras(state, blueprint, { slotToPlayer, heroIds });
  deps.setupGrail(state);
  state.currentPlayer = state.players.findIndex((p) => p.alive);
  return state;
}

// ---------------------------------------------------------------------------------------------
// Turn order
// ---------------------------------------------------------------------------------------------

export function getCurrentPlayer(state) {
  return state.players[state.currentPlayer];
}

/** Pending choices go through the game module (DESIGN.md §4); victory is re-checked afterwards. */
export function resolvePending(state, id, optionIndex, extra) {
  const r = resolvePendingRaw(state, id, optionIndex, extra);
  if (r.ok) r.events = [...(r.events || []), ...checkVictory(state).events];
  return r;
}

let aiDriver = null;

/**
 * Install the AI: `fn(state, playerId)` plays the whole turn of an AI player by calling engine
 * actions (it must NOT call `endTurn`). Pass null for the default driver, which does nothing.
 */
export function setAiDriver(fn) {
  aiDriver = fn || null;
}

/** Option ids an unattended pending falls back to (decline fights / purchases, close dialogs). */
const SAFE_OPTION_IDS = ['leave', 'no', 'decline', 'cancel', 'done'];

/**
 * The option a leftover pending of an AI player is resolved with when the driver left it open:
 * the first "negative" option (`leave` / `no` / `decline` / `cancel` / `done`) so the computer never
 * walks into a guarded fight or spends money by accident; otherwise option 0 (e.g. the first skill of
 * a `level_up`).
 */
export function safePendingOption(pending) {
  const opts = pending.options || [];
  for (const id of SAFE_OPTION_IDS) {
    const i = opts.findIndex((o) => o && o.id === id);
    if (i >= 0) return i;
  }
  return 0;
}

/**
 * Run the current player's AI turn (no-op for humans), then auto-resolve his leftover pendings with
 * `safePendingOption`. Marks `player.lastAiTurn = state.turn` so `endTurn` does not play it twice.
 */
export function runAiTurn(state) {
  const player = getCurrentPlayer(state);
  const events = [];
  if (!player || player.isHuman || !player.alive || state.gameOver) return ok(events);
  if (player.aiResume) {
    if (player.aiResume.turn !== state.turn) delete player.aiResume;
    else player.aiResume.pending = false; // this call is the resumption
  }
  player.lastAiTurn = state.turn;
  if (aiDriver) {
    const r = aiDriver(state, player.id);
    if (r && Array.isArray(r.events)) events.push(...r.events);
  }
  // a battle waiting for a human defender: the rest of the turn (and its pendings) comes on resumption
  if (state.combat) return ok(events);
  resolveAiLeftovers(state, player, events);
  events.push({ type: 'ai_turn', playerId: player.id });
  return ok(events);
}

/** Auto-resolve the pendings an AI player left open (`safePendingOption`). */
function resolveAiLeftovers(state, player, events) {
  for (let guardN = 0; guardN < 200 && hasPending(state, player.id); guardN++) {
    const p = getPending(state, player.id)[0];
    const r = resolvePendingRaw(state, p.id, safePendingOption(p));
    if (!r.ok) state.pending = state.pending.filter((x) => x.id !== p.id);
    else events.push(...r.events);
  }
}

function nextAliveAfter(state, index) {
  for (let i = index + 1; i < state.players.length; i++) if (state.players[i].alive) return i;
  return -1;
}

/** Pass the turn to the next living player; a wrap-around starts a new day. */
function advanceTurn(state, events) {
  let next = nextAliveAfter(state, state.currentPlayer);
  if (next < 0) {
    events.push(...startNewDay(state).events);
    next = nextAliveAfter(state, -1);
  }
  if (next < 0 || state.gameOver) return;
  state.currentPlayer = next;
  events.push({ type: 'turn_started', playerId: next, turn: state.turn });
}

/**
 * True when the current player is a living AI who has not played `state.turn` yet, or whose turn
 * was interrupted by a battle against a human defender that is over now (`player.aiResume`).
 */
function aiToPlay(state) {
  const p = getCurrentPlayer(state);
  if (!p || !p.alive || p.isHuman) return false;
  if (p.lastAiTurn !== state.turn) return true;
  return !state.combat && !!p.aiResume && p.aiResume.turn === state.turn && p.aiResume.pending === true;
}

/** How often one AI turn may be resumed after battles against human defenders. */
export const MAX_AI_RESUMES = 4;

/**
 * End the current player's turn. Refused while he has pending choices or a combat is running.
 * Turn sequence: an AI player whose turn it is but who has not played yet (e.g. the first player of
 * the game is a computer) plays first; then the turn passes on, and every AI player it reaches plays
 * at once (`runAiTurn`) until a human is to move, the game ends, or every player has had one AI turn
 * in this call (all-AI games advance one round per call; the AI left to move plays at the start of the
 * next call). Set `state.settings.manualAi` (or `opts.manualAi`) to stop on AI players and call
 * `runAiTurn` yourself.
 */
export function endTurn(state, opts = {}) {
  if (state.gameOver) return fail('game_over');
  if (state.combat) return fail('in_combat');
  const cur = getCurrentPlayer(state);
  const manual = opts.manualAi ?? state.settings?.manualAi;
  // a computer player's pendings (e.g. a level-up won against a human defender) are its own business
  if (cur && cur.alive && hasPending(state, cur.id) && (cur.isHuman || manual)) return fail('pending');
  const events = [];
  let played = 0;
  // a computer player attacked a human (adventure engine leaves that battle in state.combat): stop
  // here, still on the computer's turn; the human fights, then the next endTurn call carries on
  const waitForHuman = () => {
    if (!state.combat) return false;
    // remember to give the computer the rest of its day once the human has fought the battle
    const p = getCurrentPlayer(state);
    if (p && !p.isHuman) {
      const r = p.aiResume && p.aiResume.turn === state.turn ? p.aiResume : { turn: state.turn, count: 0 };
      r.count += 1;
      r.pending = r.count <= MAX_AI_RESUMES;
      p.aiResume = r;
    }
    events.push({ type: 'combat_waiting', playerId: state.currentPlayer, turn: state.turn });
    return true;
  };
  if (!manual && aiToPlay(state)) {
    events.push(...runAiTurn(state).events);
    played++;
    if (waitForHuman()) return ok(events);
  } else if (cur && cur.alive && !cur.isHuman && !manual) {
    resolveAiLeftovers(state, cur, events); // out of resumptions: close what is left
  }
  events.push({ type: 'turn_ended', playerId: state.currentPlayer, turn: state.turn });
  events.push(...checkVictory(state).events);
  if (!state.gameOver) advanceTurn(state, events);
  while (!manual && played < state.players.length && !state.gameOver && aiToPlay(state)) {
    const p = getCurrentPlayer(state);
    events.push(...runAiTurn(state).events);
    played++;
    if (waitForHuman()) return ok(events);
    events.push(...checkVictory(state).events);
    if (state.gameOver) break;
    events.push({ type: 'turn_ended', playerId: p.id, turn: state.turn });
    advanceTurn(state, events);
  }
  return ok(events);
}

// ---------------------------------------------------------------------------------------------
// New day / week / month
// ---------------------------------------------------------------------------------------------

function collect(events, result) {
  if (result && Array.isArray(result.events)) events.push(...result.events);
}

/**
 * Advance the calendar by one day and run every start-of-day routine, in this order:
 * heroes -> adventure objects -> (day 1 of a week: week event, Mystic Pond / interest, growth, tavern
 * refresh, monthly restock, adventure weekly) -> town daily ticks -> Cover of Darkness -> income ->
 * town-less countdown -> victory check.
 */
export function startNewDay(state) {
  const events = [];
  const { newWeek, newMonth } = advanceDate(state);
  events.push({ type: 'day_started', turn: state.turn, date: { ...state.date } });

  for (const heroId of Object.keys(state.heroes)) collect(events, deps.startOfDayHero(state, heroId));
  collect(events, deps.startOfDayAdventure(state));

  if (newWeek) {
    const weekOf = rollWeekEvent(state, newMonth);
    const ev = { type: newMonth ? 'month_started' : 'week_started', weekOf: { ...weekOf }, date: { ...state.date } };
    events.push(ev);
    pushLog(state, ev);
    for (const player of state.players) {
      if (player.alive) collect(events, applyWeeklyTownResources(state, player.id));
    }
    for (const townId of Object.keys(state.towns)) {
      collect(events, startOfWeekTown(state, townId));
      if (newMonth) collect(events, startOfMonthTown(state, townId));
    }
    for (const player of state.players) if (player.alive) refreshTavern(state, player.id);
    if (weekOf.kind === 'month_of') collect(events, deps.spawnMonthMonsters(state, weekOf.creatureId));
    collect(events, deps.startOfWeekAdventure(state));
  }

  for (const townId of Object.keys(state.towns)) collect(events, startOfDayTown(state, townId));
  collect(events, applyFogCover(state));

  for (const player of state.players) {
    if (!player.alive) continue;
    collect(events, applyDailyIncome(state, player.id));
    if (player.towns.length > 0) {
      player.daysWithoutTown = 0;
      continue;
    }
    player.daysWithoutTown += 1;
    if (player.daysWithoutTown >= DAYS_WITHOUT_TOWN_LIMIT) collect(events, eliminatePlayer(state, player.id, 'no_town'));
    else events.push({ type: 'town_loss_warning', playerId: player.id, daysLeft: DAYS_WITHOUT_TOWN_LIMIT - player.daysWithoutTown });
  }
  collect(events, applyTimedEvents(state)); // map-wide timed events (blueprintExtras.js)
  collect(events, checkVictory(state));
  return ok(events);
}

// ---------------------------------------------------------------------------------------------
// Save / load
// ---------------------------------------------------------------------------------------------

/** @returns {string} JSON save */
export function serialize(state) {
  return JSON.stringify(state);
}

/** @param {string|object} json a save produced by `serialize` @throws on a bad or foreign save */
export function deserialize(json) {
  let state;
  try {
    state = typeof json === 'string' ? JSON.parse(json) : clone(json);
  } catch (e) {
    throw new Error(`Corrupt save: ${e.message}`);
  }
  if (!state || typeof state !== 'object' || !Array.isArray(state.players)) throw new Error('Corrupt save: not a game state');
  if (state.version !== GAME_VERSION) throw new Error(`Unsupported save version: ${state.version} (expected ${GAME_VERSION})`);
  return state;
}

// ---------------------------------------------------------------------------------------------
// Kingdom overview
// ---------------------------------------------------------------------------------------------

function hallLevel(town) {
  return ['village_hall', 'town_hall', 'city_hall', 'capitol'].findIndex((h) => town.buildings.includes(h)) + 1;
}

function fortLevel(town) {
  return ['fort', 'citadel', 'castle'].findIndex((h) => town.buildings.includes(h)) + 1;
}

/** Summary of a player's kingdom for the overview screen (plain JSON). */
export function getKingdomOverview(state, playerId) {
  const player = state.players[playerId];
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  const income = getIncomeBreakdown(state, playerId);
  const towns = player.towns.map((id) => {
    const t = state.towns[id];
    return {
      id, name: t.name, faction: t.faction, pos: { ...t.pos },
      hallLevel: hallLevel(t), fortLevel: fortLevel(t), mageGuildLevel: getMageGuildLevel(t),
      buildings: t.buildings.length, builtThisTurn: t.builtThisTurn,
      canBuild: getAvailableBuildings(state, id).filter((b) => b.status === 'available').map((b) => b.id),
      growth: getTownGrowth(state, id), stock: { ...t.stock },
      garrisonStrength: armyStrength(getGarrisonArmy(state, t)),
      visitingHero: t.visitingHero, garrisonHero: t.garrisonHero,
      hasGrail: t.buildings.some((b) => getBuilding(b).kind === 'grail'),
    };
  });
  const heroes = player.heroes.map((id) => state.heroes[id]).filter(Boolean).map((h) => ({
    id: h.id, defId: h.defId, name: h.name, classId: h.classId, level: h.level, exp: h.exp,
    primary: { ...h.primary }, mana: h.mana, movePoints: h.movePoints, maxMovePoints: h.maxMovePoints,
    pos: { ...h.pos }, townId: h.townId ?? null, garrisoned: !!h.garrisoned,
    armyStrength: armyStrength(h.army), army: clone(h.army),
  }));
  const totalArmy = heroes.reduce((n, h) => n + h.armyStrength, 0) + towns.reduce((n, t) => n + t.garrisonStrength, 0);
  return {
    playerId, name: player.name, color: player.color, faction: player.faction, alive: player.alive,
    isHuman: player.isHuman,
    date: { ...state.date }, turn: state.turn, weekOf: { ...state.weekOf },
    resources: Object.fromEntries(RESOURCES.map((r) => [r, player.resources[r] || 0])),
    income: income.total, incomeBySource: { towns: income.towns, mines: income.mines, heroes: income.heroes },
    towns, heroes,
    marketplaces: countMarketplaces(state, playerId),
    thievesGuildLevel: getThievesGuildLevel(state, playerId),
    tavernHeroes: (player.tavernHeroes || []).slice(),
    armyStrength: totalArmy,
    daysWithoutTown: player.daysWithoutTown,
    daysLeftWithoutTown: player.towns.length ? null : DAYS_WITHOUT_TOWN_LIMIT - player.daysWithoutTown,
    score: getScoreBreakdown(state, playerId),
  };
}
