// Tactical combat AI. `chooseAction(cs, opts?)` returns a legal action for whoever must act now;
// it is what `{type:'auto'}` and `autoResolve` use for both sides. Deterministic (it never
// consumes the combat rng; look-ahead runs on private copies of the state) and fast.
//
// Order of decisions for the side to act:
//   1. tactics phase: shooters to the back, melee forward, then end the phase;
//   2. retreat / surrender when the battle is clearly lost and the hero is worth saving;
//   3. hero spell (ai/magic.js) when its value beats its mana price - cast before the stack acts;
//   4. war machines: First Aid Tent heals the most valuable wound, controlled Ballista shoots;
//   5. creature turn (ai/tactics.js): attacks, shots, abilities, wall attacks, moves, defend, wait
//      are simulated and scored by the board evaluation (ai/eval.js).
// Difficulty: `cs.sides[side].aiLevel` (0..4, default 4) or `opts.level` - lower levels add
// deterministic noise to the scores, skip spells sometimes and never retreat.
// The original baseline is frozen in ai/baseline.js (the A/B tournament opponent).
import { getStack } from './state.js';
import { hexSetDistance, stackHexes, stackHexesAt } from './hex.js';
import { getLegalActions } from './legal.js';
import { hpValue, rawValue, isShooterType, beginDecision, endDecision, sideStrength } from './ai/eval.js';
import { scoreCreatureActions } from './ai/tactics.js';
import { chooseHeroSpell } from './ai/magic.js';
import { chooseRetreat } from './ai/retreat.js';
import { noise } from './ai/sim.js';
import { abilityOf, hasAb } from './stats.js';
import * as siegeMod from './siege.js';

export const AI_LEVELS = { min: 0, max: 4 };
/** Score noise (fraction of the acting stack's value) and blunder chance per difficulty level. */
const NOISE = [0.8, 0.45, 0.2, 0.06, 0];
const BLUNDER = [0.35, 0.18, 0.06, 0, 0];

function levelOf(cs, side, opts) {
  const l = opts.level ?? cs.sides[side]?.aiLevel ?? AI_LEVELS.max;
  return Math.max(AI_LEVELS.min, Math.min(AI_LEVELS.max, Math.round(l)));
}

/** Tactics phase: shooters to the rear column, melee to the front; one move per call. */
function tacticsAction(cs) {
  const legal = getLegalActions(cs);
  const t = legal.tactics;
  if (!t) return { type: 'tactics_end' };
  const attacker = t.side === 'attacker';
  for (const entry of t.stacks) {
    const s = getStack(cs, entry.stackId);
    if (!s || !entry.hexes.length) continue;
    const xs = entry.hexes.map((h) => h.x);
    const front = attacker ? Math.max(...xs) : Math.min(...xs);
    const back = attacker ? Math.min(...xs) : Math.max(...xs);
    const goalX = isShooterType(s) ? back : front;
    if (s.pos.x === goalX) continue;
    const sameRow = entry.hexes.filter((h) => h.x === goalX).sort((a, b) => Math.abs(a.y - s.pos.y) - Math.abs(b.y - s.pos.y) || a.y - b.y);
    if (!sameRow.length || Math.abs(sameRow[0].y - s.pos.y) > 1) continue;
    // shooters already at least as far back as the goal stay
    if (isShooterType(s) && (attacker ? s.pos.x <= goalX : s.pos.x >= goalX)) continue;
    return { type: 'tactics_move', stackId: s.id, to: { x: sameRow[0].x, y: sameRow[0].y } };
  }
  return { type: 'tactics_end' };
}

function chooseHeal(cs, legal) {
  const tent = getStack(cs, legal.stackId);
  const ab = abilityOf(tent, 'heals');
  const avg = ab ? (ab.min + ab.max) / 2 : 50;
  let best = null;
  for (const id of legal.heals) {
    const s = getStack(cs, id);
    const v = Math.min(avg, s.maxHp - s.hp) * hpValue(s);
    if (!best || v > best.v) best = { id, v };
  }
  return best ? { type: 'heal', targetId: best.id } : null;
}

/**
 * Choose an action for the stack that must act (or for the tactics phase).
 * @param {Object} cs CombatState (not modified)
 * @param {{level?: number}} [opts] difficulty override (0 = easiest .. 4 = strongest)
 * @returns {Object} an action accepted by performAction (never `{type:'auto'}`)
 */
export function chooseAction(cs, opts = {}) {
  if (cs.phase === 'tactics') return tacticsAction(cs);
  beginDecision(cs);
  try {
    return decide(cs, opts);
  } finally {
    endDecision();
  }
}

const ENGAGING = new Set(['attack', 'shoot', 'ability', 'siege_attack']);

function distToEnemy(cs, stack, pos) {
  const mine = stackHexesAt(stack, pos);
  let d = Infinity;
  for (const e of cs.stacks) {
    if (!e.alive || e.side === stack.side || e.warMachine) continue;
    d = Math.min(d, hexSetDistance(mine, stackHexes(e)));
  }
  return d;
}

/** Must the side stop manoeuvring and trade blows (see decide)? */
export function mustEngage(cs, side) {
  if (cs.siege && side === 'defender') return false; // the walls are the point; the attacker must come
  if (cs.round >= 12) return true;
  if (!cs.sides[side]?.hero && cs.round >= 3) return true;
  if (cs.round >= 4) {
    const mine = sideStrength(cs, side);
    const other = sideStrength(cs, side === 'attacker' ? 'defender' : 'attacker');
    if (mine >= 2 * other) return true;
  }
  return false;
}

function decide(cs, opts) {
  const legal = getLegalActions(cs);
  const stack = getStack(cs, legal.stackId);
  if (!stack) return { type: 'defend' };
  const side = legal.side;
  const level = levelOf(cs, side, opts);
  const seed = `${cs.rng?.s ?? 0}|${cs.round}|${stack.id}|${cs.sides[side].castThisRound ? 1 : 0}`;

  if (level >= 2) {
    const r = chooseRetreat(cs, legal, side);
    if (r) return r;
  }
  if (legal.canCast && !(level === 0 && noise(seed, 'skipcast') < 0.5)) {
    const cast = chooseHeroSpell(cs, legal, side, { level });
    if (cast) {
      if (level >= 3 || !cast.options || noise(seed, 'cast') >= BLUNDER[level] * 2) return cast.action;
      const o = cast.options[Math.floor(noise(seed, 'pick') * cast.options.length)];
      if (o && o.gain > 0) return { type: 'cast', spellId: o.spellId, target: o.target };
      return cast.action;
    }
  }
  // A controlled catapult: the wall section / gate / tower the siege module rates best.
  if (hasAb(stack, 'catapult')) {
    if (!legal.siegeTargets.length) return { type: 'defend' };
    let id = null;
    try { id = typeof siegeMod.chooseSiegeTarget === 'function' ? siegeMod.chooseSiegeTarget(cs, stack) : null; } catch { id = null; }
    if (id === null) id = legal.siegeTargets.reduce((b, t) => ((t.value ?? 0) > (b.value ?? 0) ? t : b)).targetId;
    return { type: 'siege_attack', targetId: id };
  }
  if (legal.heals.length) {
    const heal = chooseHeal(cs, legal);
    if (heal) return heal;
  }
  let { candidates } = scoreCreatureActions(cs, legal, side);
  if (!candidates.length) return { type: 'defend' };
  // No kiting until the round cap: neutral troops (no hero) engage from round 3, a side clearly
  // ahead from round 4, anybody from round 12 - when the stack can hit something it does.
  if (mustEngage(cs, side)) {
    const blows = candidates.filter((c) => ENGAGING.has(c.action.type));
    if (blows.length) candidates = blows;
    else if (!isShooterType(stack)) {
      // nothing in reach: close in (no waiting / defending in front of a broken wall forever)
      const closer = candidates.filter((c) => c.action.type === 'move' && c.action.to && distToEnemy(cs, stack, c.action.to) < distToEnemy(cs, stack, stack.pos));
      if (closer.length) candidates = closer;
    }
  }
  const scale = Math.max(1, rawValue(stack));
  let best = null;
  candidates.forEach((c, i) => {
    let score = c.score;
    if (NOISE[level] > 0) score += (noise(seed, i, 'n') - 0.5) * 2 * NOISE[level] * scale;
    if (!best || score > best.score) best = { ...c, score };
  });
  if (BLUNDER[level] > 0 && noise(seed, 'blunder') < BLUNDER[level]) {
    const pick = candidates[Math.floor(noise(seed, 'which') * candidates.length)];
    if (pick) return pick.action;
  }
  return best.action;
}
