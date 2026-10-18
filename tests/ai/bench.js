// AI progress benchmark harness: all-AI games on generated maps with per-week metrics.
// Used by tests/ai/progress.test.js (via benchWorker.js) and tools/ai-bench.mjs (docs/mechanics/ai.md "Benchmark").
import { generateMap } from '../../src/engine/mapgen/index.js';
import { createGame, endTurn, runAiTurn, resetGameDeps } from '../../src/engine/game.js';
import { engineReady } from '../../src/engine/hero.js';
import * as adv from '../../src/engine/adventure/index.js';
import { installAi, getLastAiReport } from '../../src/engine/ai/index.js';
import { setAiSafetyMs } from '../../src/engine/ai/context.js';
import { armyStrength } from '../../src/engine/army.js';
import { getMapObject } from '../../src/data/mapObjects.js';
import { buildingsForFaction, isBuilt } from '../../src/data/buildings.js';

export async function benchReady() {
  await engineReady;
  resetGameDeps();
  adv.resetDeps();
  installAi();
  setAiSafetyMs(Infinity);
}

function isMine(obj) {
  try { return getMapObject(obj.defId).effect.type === 'mine'; } catch { return false; }
}

/** Snapshot of one player's position. */
export function playerMetrics(state, pid) {
  const p = state.players[pid];
  let army = 0;
  for (const id of p.heroes) if (state.heroes[id]) army += armyStrength(state.heroes[id].army);
  let buildings = 0;
  for (const id of p.towns) {
    const t = state.towns[id];
    if (!t) continue;
    if (!t.garrisonHero) army += armyStrength(t.garrison);
    // upgrades replace their base (fort -> citadel -> castle): count everything that is effectively built
    for (const b of buildingsForFaction(t.faction)) if (isBuilt(t.buildings, b.id)) buildings++;
  }
  let mines = 0;
  for (const o of Object.values(state.map.objects)) if (o.owner === pid && isMine(o)) mines++;
  return { alive: p.alive, towns: p.towns.length, heroes: p.heroes.length, army: Math.round(army), buildings, mines, gold: p.resources.gold || 0 };
}

/**
 * Play one all-AI game. @returns {{ok, weeks: [{day, players: [metrics + cumulative counters]}], ms}}
 * or `{ok: false, error}` when the map could not be generated.
 */
export function runBenchGame({ size = 'S', template = 'default', players = 2, seed = 1, difficulty = 1, days = 56, difficulties = null } = {}) {
  const bp = generateMap({ size, template, players, seed });
  if (!bp || bp.ok === false) return { ok: false, error: bp && bp.error };
  const n = bp.meta.playerSlots;
  const state = createGame(bp, {
    seed, difficulty, players: Array.from({ length: n }, (_, i) => ({ slot: i, isHuman: false, faction: 'random' })),
  });
  // per-player AI level (ai/context.js reads player.aiDifficulty before settings.difficulty)
  if (difficulties) state.players.forEach((p, i) => { if (difficulties[i] != null) p.aiDifficulty = difficulties[i]; });
  const cum = state.players.map(() => ({ attacks: 0, neutralSieges: 0, idle: 0, idleSecondary: 0, fights: 0, builds: 0, hires: 0, recruits: 0, errors: 0, lost: 0, timeouts: 0, firstAttack: null }));
  const weeks = [];
  const t0 = Date.now();
  for (let d = 0; d < days && !state.gameOver; d++) {
    for (let k = 0; k < state.players.length && !state.gameOver; k++) {
      const pid = state.currentPlayer;
      runAiTurn(state);
      const rep = getLastAiReport(pid);
      if (rep && rep.turn === state.turn) {
        const c = cum[pid];
        c.attacks += rep.attacks || 0;
        if ((rep.attacks || 0) && c.firstAttack == null) c.firstAttack = state.turn;
        c.neutralSieges += rep.neutralSieges || 0;
        c.idle += rep.idle || 0;
        c.idleSecondary += rep.idleSecondary || 0;
        c.fights += rep.fights || 0;
        c.lost += rep.lost || 0;
        c.timeouts += rep.timeouts || 0;
        c.builds += rep.builds || 0;
        c.hires += rep.hires || 0;
        c.recruits += rep.recruits || 0;
        c.errors += (rep.errors || []).filter((e) => e.includes('_threw')).length;
      }
      if (state.gameOver) break;
      endTurn(state, { manualAi: true });
    }
    if (state.turn % 7 === 1 || state.gameOver || d === days - 1) {
      weeks.push({ day: state.turn - 1, players: state.players.map((p, i) => ({ ...playerMetrics(state, i), ...cum[i] })) });
    }
  }
  return { ok: true, weeks, ms: Date.now() - t0, players: n, gameOver: state.gameOver, state };
}

export const median = (xs) => {
  const a = xs.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** Metrics of every player at the last snapshot taken on or before `day`. */
export function at(game, day) {
  let best = null;
  for (const w of game.weeks) if (w.day <= day) best = w;
  return best ? best.players : [];
}
