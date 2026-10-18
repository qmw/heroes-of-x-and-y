// Per-turn AI context: budgets, difficulty knobs, report, small shared helpers.
// Spec: docs/mechanics/ai.md.
import { rand } from '../../core/rng.js';

export const ACTION_BUDGET = 300;
export const HERO_STEPS = 12;
export const PENDING_BUDGET = 100;
export const SAFETY_MS = 2000;
// Wall-clock safety net per AI turn. Tests disable it (Infinity) so results don't depend on machine load.
let safetyMs = SAFETY_MS;
export function setAiSafetyMs(ms) { safetyMs = ms; }

/** Difficulty knobs (0 Easy .. 4 Impossible). */
const KNOBS = [
  { noise: 0.5, minRatio: 1.2, simulate: false, market: false, spells: false, heroDelta: -1, swaps: 3, econDays: 6, saveDays: 3, hireSpare: 3000, holdDays: 6, knowTowns: false, attackFromDay: 22, attackRatio: 2.0, opportunist: false },
  { noise: 0.2, minRatio: 1.15, simulate: true, sims: 2, market: true, spells: true, heroDelta: 0, swaps: 0, econDays: 10, saveDays: 5, hireSpare: 1500, holdDays: 3, knowTowns: true, attackFromDay: 8, attackRatio: 1.35, opportunist: true },
  { noise: 0, minRatio: 1.15, simulate: true, sims: 3, market: true, spells: true, heroDelta: 0, swaps: 0, econDays: 12, saveDays: 6, hireSpare: 1000, holdDays: 2, knowTowns: true, attackFromDay: 4, attackRatio: 1.3, opportunist: true },
  { noise: 0, minRatio: 1.15, simulate: true, sims: 4, market: true, spells: true, heroDelta: 1, swaps: 0, econDays: 12, saveDays: 6, hireSpare: 1000, holdDays: 2, knowTowns: true, attackFromDay: 1, attackRatio: 1.2, opportunist: true },
  { noise: 0, minRatio: 1.15, simulate: true, sims: 5, market: true, spells: true, heroDelta: 1, swaps: 0, econDays: 12, saveDays: 6, hireSpare: 1000, holdDays: 2, knowTowns: true, attackFromDay: 1, attackRatio: 1.1, opportunist: true },
];

export function createContext(state, playerId) {
  const player = state.players[playerId];
  // per-player override (benchmarks / mixed games), else the game's difficulty
  const difficulty = Math.max(0, Math.min(4, player?.aiDifficulty ?? state.settings?.difficulty ?? 1));
  player.ai ??= {};
  player.ai.targets ??= {};
  return {
    state, playerId, player, difficulty, knobs: KNOBS[difficulty],
    actions: 0, started: Date.now(),
    blacklist: new Set(),
    simCache: new Map(),
    simsLeft: KNOBS[difficulty].sims || 0,
    report: {
      playerId, turn: state.turn, ms: 0, actions: 0, moves: 0, builds: 0, recruits: 0, hires: 0,
      fights: 0, pendings: 0, trades: 0, spells: 0, errors: [], trace: [], planMs: 0, moveMs: 0, simMs: 0,
    },
  };
}

/** Count one engine action; false when the turn budget is used up. */
export function spend(ctx) {
  ctx.actions++;
  ctx.report.actions = ctx.actions;
  return !ctx.state.combat && ctx.actions <= ACTION_BUDGET && Date.now() - ctx.started < safetyMs;
}

/**
 * True when the turn must stop: action budget / safety time used up, or a battle against a human
 * defender is waiting (game.endTurn resumes the turn after it, see `dayMemory`).
 */
export function outOfBudget(ctx) {
  return !!ctx.state.combat || ctx.actions >= ACTION_BUDGET || Date.now() - ctx.started >= safetyMs;
}

/**
 * Per-day memory that must survive an interrupted turn (`player.ai.day`, plain JSON): hired today,
 * boat built today, resumption count. Reset on a new day.
 */
export function dayMemory(ctx) {
  const ai = ctx.player.ai;
  if (!ai.day || ai.day.turn !== ctx.state.turn) ai.day = { turn: ctx.state.turn, hired: false, boat: false, runs: 0 };
  return ai.day;
}

export function note(ctx, what, detail) {
  if (ctx.report.errors.length < 50) ctx.report.errors.push(detail === undefined ? what : `${what}: ${detail}`);
}

/** Multiplicative noise for easy levels (uses state.rng: deterministic). */
export function noise(ctx) {
  const n = ctx.knobs.noise;
  if (!n) return 1;
  return 1 - n + 2 * n * rand(ctx.state.rng);
}

export const posKey = (p) => `${p.x},${p.y},${p.z || 0}`;
export const chebyshev = (a, b) => ((a.z || 0) !== (b.z || 0) ? 1e9 : Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));

export function heroesOf(ctx) {
  return ctx.player.heroes.map((id) => ctx.state.heroes[id]).filter(Boolean);
}

export function townsOf(ctx) {
  return ctx.player.towns.map((id) => ctx.state.towns[id]).filter(Boolean);
}
