// Player elimination, victory / loss conditions and the end-game score.
// Spec: docs/mechanics/game-loop.md §4-§5.

import { getBuildingEffects } from '../data/buildings.js';
import { ownsArtifact } from './artifacts.js';
import { deps } from './gameDeps.js';
import './gameDepsReal.js'; // binds hero / bonuses / adventure into `deps`
import { getDifficulty } from './economy.js';

const ok = (events = [], extra = {}) => ({ ok: true, events, ...extra });
const fail = (error) => ({ ok: false, error });

/** A player without a town is eliminated at the start of the day this counter reaches the limit. */
export const DAYS_WITHOUT_TOWN_LIMIT = 7;

export const VICTORY_TYPES = [
  'defeat_all', 'capture_town', 'capture_all_towns', 'defeat_hero', 'defeat_monster', 'acquire_artifact',
  'accumulate_creatures', 'accumulate_resources', 'build_grail', 'survive',
];
export const LOSS_TYPES = ['standard', 'lose_hero', 'lose_town', 'time_limit'];

/** `'standard'` / undefined / object -> `{ type, allowStandard, appliesToAi, ...params }`. */
export function normalizeVictory(v) {
  if (!v || v === 'standard') return { type: 'defeat_all', allowStandard: true, appliesToAi: true };
  if (typeof v === 'string') return { type: v, allowStandard: true, appliesToAi: true };
  if (!VICTORY_TYPES.includes(v.type)) throw new Error(`Unknown victory condition: ${v.type}`);
  return { allowStandard: true, appliesToAi: true, ...v };
}

export function normalizeLoss(l) {
  if (!l || l === 'standard') return { type: 'standard' };
  if (typeof l === 'string') return { type: l };
  if (!LOSS_TYPES.includes(l.type)) throw new Error(`Unknown loss condition: ${l.type}`);
  return { ...l };
}

// ---------------------------------------------------------------------------------------------
// Elimination
// ---------------------------------------------------------------------------------------------

/**
 * Remove a player from the game: heroes vanish, towns and flagged objects become neutral.
 * @param {string} [reason] 'defeated' | 'no_town' | 'lost_hero' | 'lost_town' | 'time_expired' | 'resigned'
 */
export function eliminatePlayer(state, playerId, reason = 'defeated') {
  const player = state.players[playerId];
  if (!player) return fail('no_such_player');
  if (!player.alive) return fail('already_eliminated');
  player.alive = false;
  player.eliminatedOn = state.turn;
  player.eliminationReason = reason;
  for (const heroId of player.heroes.slice()) {
    if (state.heroes[heroId]) deps.removeHero(state, heroId, 'eliminated');
    for (const town of Object.values(state.towns)) {
      if (town.visitingHero === heroId) town.visitingHero = null;
      if (town.garrisonHero === heroId) town.garrisonHero = null;
    }
    delete state.heroes[heroId];
  }
  player.heroes = [];
  for (const townId of player.towns) {
    const town = state.towns[townId];
    town.owner = null;
  }
  player.towns = [];
  for (const obj of Object.values(state.map?.objects || {})) if (obj.owner === playerId) obj.owner = null;
  player.tavernHeroes = [];
  state.pending = (state.pending || []).filter((p) => p.playerId !== playerId);
  const ev = { type: 'player_eliminated', playerId, reason };
  pushLog(state, ev);
  return ok([ev]);
}

export function pushLog(state, entry) {
  state.log ??= [];
  state.log.push({ turn: state.turn, ...entry });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

/**
 * Tell the victory checker who destroyed a quest target (hero or wandering monster). Optional: when
 * nothing was recorded, the player whose turn it is gets the credit.
 * @param {{kind: 'hero'|'monster', id: string, byPlayerId: number}} info `id`: hero id / hero def
 *   id / map object id
 */
export function recordDefeat(state, { kind, id, byPlayerId }) {
  state.defeated ??= { hero: {}, monster: {} };
  state.defeated[kind][id] = byPlayerId;
}

// ---------------------------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------------------------

function playerHeroes(state, player) {
  return player.heroes.map((id) => state.heroes[id]).filter(Boolean);
}

function countCreatures(state, player, creatureId) {
  let n = 0;
  const add = (army) => { for (const s of army || []) if (s && s.creatureId === creatureId) n += s.count; };
  for (const h of playerHeroes(state, player)) add(h.army);
  for (const t of player.towns) add(state.towns[t].garrison);
  return n;
}

function hasGrail(state, player, townId) {
  return player.towns.some((t) => (!townId || t === townId)
    && state.towns[t].buildings.some((b) => getBuildingEffects(b, state.towns[t].faction).some((e) => e.type === 'grail')));
}

function findHero(state, cond) {
  return Object.values(state.heroes).find((h) => (cond.heroId && h.id === cond.heroId) || (cond.heroDefId && h.defId === cond.heroDefId));
}

/**
 * Who defeated the `defeat_hero` target: the recorded player, `null` when it fell to a non-player
 * (neutral monster / garrison - nobody is credited), or - with no record at all (removed by a script,
 * elimination ...) - the player to move.
 */
export function heroDefeatCredit(state, v) {
  const rec = state.defeated?.hero || {};
  for (const key of [v.heroId, v.heroDefId]) if (key != null && Object.prototype.hasOwnProperty.call(rec, key)) return rec[key];
  return state.currentPlayer;
}

/** Has `player` fulfilled the special victory condition `v`? */
export function meetsVictory(state, player, v) {
  switch (v.type) {
    case 'capture_town': return state.towns[v.townId]?.owner === player.id;
    case 'capture_all_towns': {
      // every town on the map belongs to the player or his allies (at least one to himself)
      const towns = Object.values(state.towns);
      return towns.length > 0 && towns.some((t) => t.owner === player.id)
        && towns.every((t) => t.owner != null && areAllied(state, t.owner, player.id));
    }
    case 'defeat_hero': {
      if (findHero(state, v)) return false;
      return heroDefeatCredit(state, v) === player.id;
    }
    case 'defeat_monster': {
      if (!state.map || state.map.objects[v.objectId]) return false;
      return (state.defeated?.monster?.[v.objectId] ?? state.currentPlayer) === player.id;
    }
    case 'acquire_artifact': return playerHeroes(state, player).some((h) => ownsArtifact(h, v.artifactId));
    case 'accumulate_creatures': return countCreatures(state, player, v.creatureId) >= v.count;
    case 'accumulate_resources': return (player.resources[v.resource] || 0) >= v.amount;
    case 'build_grail': return hasGrail(state, player, v.townId);
    case 'survive': return state.turn > v.days;
    default: return false;
  }
}

/** Same team (`player.team`, set by createGame from settings / the map) or the same player. */
export function areAllied(state, a, b) {
  if (a == null || b == null) return false;
  if (a === b) return true;
  const pa = state.players[a];
  const pb = state.players[b];
  return !!pa && !!pb && pa.team != null && pa.team === pb.team;
}

function finish(state, winner, reason, events) {
  state.winner = winner;
  // the winner's living allies win with him
  const winners = winner == null ? [] : state.players.filter((p) => p.alive && areAllied(state, p.id, winner)).map((p) => p.id);
  state.gameOver = { winner, winners, reason, turn: state.turn, score: winner != null ? calculateScore(state, winner) : 0 };
  const ev = { type: 'game_over', winner, reason, ...(winners.length > 1 ? { winners } : {}) };
  pushLog(state, ev);
  events.push(ev);
}

/**
 * Apply eliminations, loss and victory conditions. Safe to call after any action.
 * @returns {{ok: true, events: object[], over: boolean, winner: number|null}}
 */
export function checkVictory(state) {
  const events = [];
  if (state.gameOver) return ok(events, { over: true, winner: state.winner });
  const v = normalizeVictory(state.settings?.victory);
  const l = normalizeLoss(state.settings?.loss);
  const alive = () => state.players.filter((p) => p.alive);

  // 1. standard elimination: no heroes and no towns
  for (const p of alive()) {
    if (playerHeroes(state, p).length === 0 && p.towns.length === 0) events.push(...eliminatePlayer(state, p.id, 'defeated').events);
  }
  // 2. loss conditions
  if (l.type === 'lose_hero') {
    const hero = findHero(state, l);
    if (l.playerId == null && hero) l.playerId = state.settings.loss.playerId = hero.owner;
    const p = state.players[l.playerId];
    if (p && p.alive && (!hero || hero.owner !== p.id)) events.push(...eliminatePlayer(state, p.id, 'lost_hero').events);
  } else if (l.type === 'lose_town') {
    const town = state.towns[l.townId];
    if (l.playerId == null && town && town.owner != null) l.playerId = state.settings.loss.playerId = town.owner;
    const p = state.players[l.playerId];
    if (p && p.alive && (!town || town.owner !== p.id)) events.push(...eliminatePlayer(state, p.id, 'lost_town').events);
  }
  // 2b. a `defeat_hero` target lost to a non-player: the objective can no longer be won. With
  // `loseIfFailed` the players who play for the objective (humans; everybody if it appliesToAi) lose.
  if (v.type === 'defeat_hero' && !findHero(state, v) && heroDefeatCredit(state, v) == null && !state.objectiveFailed) {
    state.objectiveFailed = { type: v.type, turn: state.turn };
    const ev = { type: 'objective_failed', reason: 'target_lost' };
    pushLog(state, ev);
    events.push(ev);
    if (v.loseIfFailed) {
      for (const p of alive()) if (p.isHuman || v.appliesToAi) events.push(...eliminatePlayer(state, p.id, 'objective_failed').events);
    }
  }
  // 3. special victory (the player to move gets precedence)
  if (v.type !== 'defeat_all') {
    const order = [...alive()].sort((a, b) => (a.id === state.currentPlayer ? -1 : 0) - (b.id === state.currentPlayer ? -1 : 0));
    let candidates = order.filter((p) => (p.isHuman || v.appliesToAi) && meetsVictory(state, p, v));
    if (v.type === 'survive' && candidates.length > 1) {
      const humans = candidates.filter((p) => p.isHuman);
      candidates = (humans.length ? humans : candidates).sort((a, b) => calculateScore(state, b.id) - calculateScore(state, a.id));
    }
    if (candidates.length) {
      finish(state, candidates[0].id, v.type, events);
      return ok(events, { over: true, winner: state.winner });
    }
  }
  // 4. time limit
  if (l.type === 'time_limit' && state.turn > l.days) {
    for (const p of alive()) events.push(...eliminatePlayer(state, p.id, 'time_expired').events);
    finish(state, null, 'time_expired', events);
    return ok(events, { over: true, winner: null });
  }
  // 5. last one standing
  const left = alive();
  if (left.length === 0) {
    finish(state, null, 'all_defeated', events);
  } else if (state.players.length > 1 && (v.type === 'defeat_all' || v.allowStandard)
    && left.every((p) => areAllied(state, p.id, left[0].id))) {
    // one player - or one alliance - left standing
    const lead = left.find((p) => p.id === state.currentPlayer) || left[0];
    finish(state, lead.id, 'defeat_all', events);
  }
  return ok(events, { over: !!state.gameOver, winner: state.winner ?? null });
}

// ---------------------------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------------------------

/** Rank titles by minimum score (creature names, as on the original high-score table). */
export const RANK_TITLES = [
  [0, 'Peasant'], [25, 'Imp'], [50, 'Gremlin'], [75, 'Goblin'], [100, 'Gnoll'], [125, 'Pikeman'],
  [150, 'Centaur'], [175, 'Wolf Rider'], [200, 'Griffin'], [225, 'Swordsman'], [250, 'Ogre'],
  [275, 'Minotaur'], [300, 'Vampire'], [325, 'Naga'], [350, 'Champion'], [375, 'Efreet Sultan'],
  [400, 'Behemoth'], [425, 'Gold Dragon'], [450, 'Titan'], [475, 'Black Dragon'], [500, 'Archangel'],
];

export function getRankTitle(score) {
  let title = RANK_TITLES[0][1];
  for (const [min, name] of RANK_TITLES) if (score >= min) title = name;
  return title;
}

/**
 * End-game rating (original formula, as reverse-engineered by VCMI's high-score code):
 * `(200 - floor((days + 10) / (playerTowns + 5)) + 25 [all enemies defeated]
 * + 25 [grail: built in an own town or carried by an own hero]) * difficulty%`, never below 0.
 * `playerTowns` = towns owned by the player (not all towns on the map).
 */
export function getScoreBreakdown(state, playerId) {
  const player = state.players[playerId];
  const days = state.turn;
  const towns = player.towns.length;
  const base = 200 - Math.floor((days + 10) / (towns + 5));
  const allDefeated = state.players.length > 1 && state.players.every((p) => areAllied(state, p.id, playerId) || !p.alive);
  const grail = hasGrail(state, player)
    || player.heroes.some((id) => state.heroes[id] && ownsArtifact(state.heroes[id], 'grail'));
  const percent = getDifficulty(state.settings?.difficulty ?? 1).ratingPercent;
  const score = Math.max(0, Math.floor((base + (allDefeated ? 25 : 0) + (grail ? 25 : 0)) * percent / 100));
  return { days, towns, base, allDefeated, grail, percent, score, title: getRankTitle(score) };
}

export function calculateScore(state, playerId) {
  return getScoreBreakdown(state, playerId).score;
}
