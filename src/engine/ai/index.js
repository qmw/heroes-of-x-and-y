// Strategic (adventure) AI: plays a whole AI turn. Spec: docs/mechanics/ai.md.
import { setAiDriver } from '../game.js';
import { createContext, townsOf, heroesOf, outOfBudget, note, dayMemory } from './context.js';
import { resolveAllPendings } from './pendings.js';
import {
  planBuild, townVisitActions, computeThreats, hireIfUseful, recruitInTown, goldReserve,
} from './towns.js';
import { assignMainHero, playHero, cleanupMemory, releaseGarrisons } from './heroes.js';
import { manageArtifacts } from './artifacts.js';

let lastReport = null;
const reportsByPlayer = {};

/** Stats of the last AI turn (diagnostics; not part of the game state); `playerId` picks that player's last turn. */
export function getLastAiReport(playerId) {
  return playerId == null ? lastReport : reportsByPlayer[playerId] || null;
}

function safely(ctx, what, fn) {
  try {
    return fn();
  } catch (e) {
    note(ctx, `${what}_threw`, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
    return undefined;
  }
}

/**
 * Play the whole turn of AI player `playerId` (game.js `setAiDriver` contract): never calls
 * `endTurn`, never throws.
 * @returns {{ok: true, events: []}}
 */
export function aiDriver(state, playerId) {
  let ctx;
  try {
    ctx = createContext(state, playerId);
  } catch (e) {
    lastReport = { playerId, turn: state?.turn, errors: [String(e)] };
    return { ok: true, events: [] };
  }
  ctx.invalidate = () => {
    ctx.enemies = null;
    ctx.guardedBy = null;
  };
  const player = ctx.player;
  if (!player || !player.alive || state.gameOver || state.combat) return { ok: true, events: [] };
  const day = dayMemory(ctx);
  day.runs += 1; // > 1: resumed after a battle against a human defender
  ctx.report.run = day.runs;
  const finish = () => {
    ctx.report.ms = Date.now() - ctx.started;
    lastReport = ctx.report;
    reportsByPlayer[playerId] = ctx.report;
    return { ok: true, events: [] };
  };

  safely(ctx, 'memory', () => cleanupMemory(ctx));
  safely(ctx, 'pendings', () => resolveAllPendings(ctx));
  safely(ctx, 'threats', () => computeThreats(ctx));
  ctx.threats ??= {};
  safely(ctx, 'main', () => assignMainHero(ctx));
  safely(ctx, 'release', () => releaseGarrisons(ctx));
  for (const h of heroesOf(ctx)) safely(ctx, 'artifacts', () => manageArtifacts(ctx, h));

  // Town phase A (a hero-less player hires before anything else)
  if (!heroesOf(ctx).length) safely(ctx, 'hire', () => { if (hireIfUseful(ctx)) assignMainHero(ctx); });
  for (const town of townsOf(ctx)) {
    if (outOfBudget(ctx)) break;
    // a threatened town without a hero buys troops first, then builds with what is left
    if (ctx.threats[town.id] && !town.visitingHero) safely(ctx, 'recruit', () => recruitInTown(ctx, town, 'garrison', 0));
    safely(ctx, 'build', () => planBuild(ctx, town));
    safely(ctx, 'town_visit', () => townVisitActions(ctx, town));
  }

  // Hero phase (main hero first)
  const played = new Set();
  const playAll = () => {
    const order = heroesOf(ctx).filter((h) => !played.has(h.id) && !h.garrisoned)
      .sort((a, b) => (a.id === player.ai.mainHeroId ? -1 : b.id === player.ai.mainHeroId ? 1 : 0));
    for (const h of order) {
      if (outOfBudget(ctx)) break;
      played.add(h.id);
      safely(ctx, 'hero', () => playHero(ctx, h));
      safely(ctx, 'pendings', () => resolveAllPendings(ctx));
      safely(ctx, 'main', () => assignMainHero(ctx));
    }
  };
  playAll();
  if (state.combat) return finish(); // a human defends: game.endTurn resumes this turn afterwards

  // Town phase B: hire, then leftovers into garrisons
  safely(ctx, 'threats', () => computeThreats(ctx));
  ctx.threats ??= {};
  safely(ctx, 'hire', () => {
    const id = hireIfUseful(ctx);
    if (id) assignMainHero(ctx);
  });
  for (const town of townsOf(ctx)) {
    if (outOfBudget(ctx)) break;
    safely(ctx, 'recruit', () => {
      if (town.visitingHero) townVisitActions(ctx, town);
      else recruitInTown(ctx, town, 'garrison', goldReserve(ctx, town));
    });
  }
  playAll(); // newly hired heroes
  if (!state.combat) safely(ctx, 'pendings', () => resolveAllPendings(ctx));
  return finish();
}

/** Install the AI driver into the game loop (call once when a game starts or is loaded). */
export function installAi() {
  setAiDriver(aiDriver);
}

export function uninstallAi() {
  setAiDriver(null);
}
