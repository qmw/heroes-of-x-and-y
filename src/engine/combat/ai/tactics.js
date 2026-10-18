// Creature turn of the combat AI: builds a short list of candidate actions (every attack with
// its best approach hexes, every shot, creature abilities, wall attacks, a handful of
// purposeful moves, defend, wait), plays each one on a private copy of the state and scores the
// resulting board (eval.js boardScore). Damage-dependent actions are simulated with minimum and
// maximum damage and averaged.
import { hexIndex, hexFromIndex, stackHexes, stackHexesAt, hexSetDistance, neighbors, inBounds } from '../hex.js';
import { getStack, otherSide } from '../state.js';
import { hasAb, speedOf } from '../stats.js';
import { reachable, moveStack, doAttack, doShoot } from '../actions.js';
import { performAbility } from '../abilities.js';
import { artilleryParams } from '../machines.js';
import * as siegeMod from '../siege.js';
import {
  boardScore, materialBalance, annihilationWinner, expDamage, hpValue, rawValue, isShooterType, WIN_SCORE,
  THREAT_WEIGHT, OPP_WEIGHT, bestAttackValue, rangedPower, reachCache, sideStrength,
  aiControllerOf as controllerOf, eliminationBonus, aiIsDisabled as isDisabled, aiControlOf as controlOf,
} from './eval.js';
import { simState, simulateBoth } from './sim.js';

const MULTI_HIT = ['attack_all_adjacent', 'breath_attack', 'three_headed_attack'];

/** Weights for this side this round: an attacker grows bolder as the round cap approaches. */
export function weightsFor(cs, side) {
  let threatWeight = THREAT_WEIGHT;
  let oppWeight = OPP_WEIGHT;
  // Closing in matters when the enemy wins a standing ranged exchange, and for an attacker that
  // runs out of time (the round cap is a defender win).
  const ours = rangedPower(cs, side);
  const theirs = rangedPower(cs, otherSide(side));
  let approachWeight = 0.15;
  if (theirs > ours) approachWeight += Math.min(0.6, (theirs - ours) / Math.max(1, theirs));
  if (side === 'attacker' && cs.round > 3) {
    const k = Math.min(0.7, 0.07 * (cs.round - 3));
    threatWeight *= 1 - k;
    oppWeight *= 1 + k;
    approachWeight += k * 1.2;
  }
  // Engage instead of kiting: neutral (heroless) troops fight as in the original, so does a side
  // that is clearly ahead on value; and from round 6 on both sides are pushed together a little
  // more every round, so two cautious armies never dance until the round cap.
  const mine = sideStrength(cs, side);
  const other = sideStrength(cs, otherSide(side));
  let engage = 0;
  if (!cs.sides[side]?.hero) engage = 0.5;
  if (mine >= 1.5 * other) engage = Math.max(engage, Math.min(0.6, 0.3 + 0.1 * (mine / Math.max(1, other) - 1.5)));
  if (cs.round > 5) engage = Math.min(0.8, engage + 0.06 * (cs.round - 5));
  if (engage > 0 && ours <= theirs) {
    threatWeight *= 1 - engage;
    oppWeight *= 1 + engage;
    approachWeight += engage * 1.5;
  }
  return { threatWeight, oppWeight, approachWeight };
}

/**
 * Hexes where enemy melee stacks can hit `me` next turn, weighted by the value they would take:
 * `Map<hexIndex, value>` (cheap danger proxy used to pre-select approach hexes).
 */
function dangerMap(cs, me, side, rc) {
  const map = new Map();
  for (const e of cs.stacks) {
    if (!e.alive || controllerOf(e) === side || isDisabled(e) || controlOf(e, 'berserk') || e.warMachine) continue;
    if (isShooterType(e)) continue; // shooters hit anywhere: position independent
    const v = expDamage(cs, e, me, {}) * hpValue(me);
    const marked = new Set();
    for (const i of rc.base(e).keys()) {
      for (const h of stackHexesAt(e, hexFromIndex(i))) {
        for (const n of neighbors(h)) {
          if (!inBounds(n)) continue;
          const k = hexIndex(n);
          if (!marked.has(k)) { marked.add(k); map.set(k, (map.get(k) ?? 0) + v); }
        }
      }
    }
  }
  return map;
}

const dangerAt = (map, me, pos) => {
  let d = 0;
  for (const h of stackHexesAt(me, pos)) d = Math.max(d, map.get(hexIndex(h)) ?? 0);
  return d;
};

/** Known hazards on a hex for `side` (visible mines / quicksand / fire walls, moat). */
function hazardSet(cs, side) {
  const set = new Set();
  for (const o of cs.obstacles ?? []) {
    if (o.hidden && o.side !== side) continue;
    if (o.kind === 'fire_wall' || ((o.kind === 'land_mine' || o.kind === 'quicksand') && o.side !== side)) {
      for (const h of o.hexes ?? []) set.add(hexIndex(h));
    }
  }
  if (cs.siege?.moat?.hexes && side === 'attacker') for (const h of cs.siege.moat.hexes) set.add(hexIndex(h));
  return set;
}

function pathHazard(reach, me, pos, hazards) {
  if (!hazards.size) return 0;
  let n = 0;
  let i = hexIndex(pos);
  let guard = 0;
  while (i !== null && i !== undefined && guard++ < 40) {
    for (const h of stackHexesAt(me, hexFromIndex(i))) if (hazards.has(hexIndex(h))) n++;
    i = reach.get(i)?.prev ?? null;
  }
  return n;
}

/**
 * Candidate actions of the active creature with their scores (higher = better).
 * @returns {{candidates: {action, score, kind}[], baseline: number}}
 */
export function scoreCreatureActions(cs, legal, side, opts = {}) {
  const me = getStack(cs, legal.stackId);
  const rc = reachCache(cs, me.id);
  const weights = { ...weightsFor(cs, side), actorId: me.id };
  const approxWeights = { ...weights, reachCache: rc };
  const reach = reachable(cs, me);
  const dmap = dangerMap(cs, me, side, rc);
  const hazards = hazardSet(cs, side);
  const myVal = Math.max(1, rawValue(me));
  const candidates = [];
  const behindNow = cs.siege && side === 'defender' && typeof siegeMod.isBehindWalls === 'function' && safe(() => siegeMod.isBehindWalls(cs, me));

  const positional = (c, exact = false) => {
    let s = boardScore(c, side, exact ? weights : approxWeights);
    if (behindNow) {
      const m = getStack(c, me.id);
      if (m && m.alive && !safe(() => siegeMod.isBehindWalls(c, m))) s -= 0.5 * myVal;
    }
    return s;
  };
  // Score of a pair of simulated states (min / max damage): averaged material + positional of the first.
  // Each candidate keeps its simulated state: `adj` + positional(state) is its score; the
  // finalists are re-scored with exact enemy reachability (see the end of this function).
  const scorePair = (pair) => {
    const w = annihilationWinner(pair[0]);
    if (w) return { score: w === side ? WIN_SCORE : -WIN_SCORE, state: null, adj: 0 };
    const mat = (materialBalance(pair[0], side) + materialBalance(pair[1], side)) / 2;
    const adj = mat - materialBalance(pair[0], side) + eliminationBonus(cs, pair[0], side);
    return { score: adj + positional(pair[0]), state: pair[0], adj };
  };
  const scoreOne = (c, adj = 0) => ({ score: adj + positional(c), state: c, adj });

  // ---- melee attacks -------------------------------------------------------------------------
  const multi = MULTI_HIT.some((a) => hasAb(me, a));
  const joust = hasAb(me, 'jousting');
  for (const a of legal.attacks) {
    const t = getStack(cs, a.targetId);
    if (!t) continue;
    const ranked = a.fromHexes.map((h) => {
      const node = reach.get(hexIndex(h));
      const dist = node ? node.dist : 0;
      let h0 = -dangerAt(dmap, me, h) - pathHazard(reach, me, h, hazards) * 0.3 * myVal;
      h0 += joust ? dist * 0.02 * myVal : -dist * 0.001 * myVal;
      return { h, h0 };
    }).sort((x, y) => y.h0 - x.h0 || x.h.y - y.h.y || x.h.x - y.h.x);
    const take = multi ? ranked.slice(0, 6) : ranked.slice(0, joust ? 2 : 1);
    for (const { h } of take) {
      const pair = simulateBoth(cs, side, me.id, (c, m) => {
        const r = doAttack(c, m, getStack(c, t.id), h, []);
        return r.ok;
      });
      if (!pair) continue;
      candidates.push({ action: { type: 'attack', targetId: t.id, from: { x: h.x, y: h.y } }, ...scorePair(pair), kind: 'attack' });
    }
  }

  // ---- shots ---------------------------------------------------------------------------------
  if (legal.shots.length) {
    const params = hasAb(me, 'hero_attack_scaling') ? artilleryParams(cs, me) : {};
    for (const id of legal.shots) {
      const pair = simulateBoth(cs, side, me.id, (c, m) => doShoot(c, m, getStack(c, id), [], params).ok);
      if (!pair) continue;
      candidates.push({ action: { type: 'shoot', targetId: id }, ...scorePair(pair), kind: 'shoot' });
    }
  }

  // ---- creature abilities --------------------------------------------------------------------
  for (const ab of legal.abilities) {
    const targets = ab.targets.map((id) => getStack(cs, id)).filter(Boolean)
      .sort((x, y) => rawValue(y) - rawValue(x) || x.id - y.id).slice(0, 5);
    for (const t of targets) {
      const action = { type: 'ability', ability: ab.ability, targetId: t.id };
      const pair = simulateBoth(cs, side, me.id, (c, m) => performAbility(c, m, action, []).ok);
      if (!pair) continue;
      const r = scorePair(pair);
      if (ab.ability === 'invulnerability') { r.score += 0.1 * myVal; r.adj += 0.1 * myVal; }
      candidates.push({ action, ...r, kind: 'ability' });
    }
  }

  // ---- wall attacks (Cyclops, Cannon, controlled catapult) ----------------------------------
  if (legal.siegeTargets && legal.siegeTargets.length && side === 'attacker') {
    let walkers = 0;
    for (const s of cs.stacks) if (s.alive && s.side === side && !s.warMachine && !isShooterType(s) && !s.creatureId.includes('dragon')) walkers += rawValue(s);
    const st = simState(cs, side);
    for (const t of legal.siegeTargets) {
      const kindW = t.kind === 'gate' ? 1.5 : t.kind === 'wall' ? 1 : 1.2;
      const hit = (t.hitChance ?? 60) / 100;
      const bonus = 0.12 * walkers * kindW * Math.max(0.2, hit) + (t.value ?? 0) * 0.01;
      candidates.push({ action: { type: 'siege_attack', targetId: t.targetId }, ...scoreOne(st, bonus), kind: 'siege' });
    }
  }

  // ---- defend (stay) -------------------------------------------------------------------------
  const defendState = simState(cs, side);
  const dm = getStack(defendState, me.id);
  if (!dm.warMachine) dm.defending = true;
  const defendCand = { action: { type: 'defend' }, ...scoreOne(defendState), kind: 'defend' };
  candidates.push(defendCand);

  // ---- moves ---------------------------------------------------------------------------------
  // A shooter that can shoot from a safe spot does not need to consider walking away.
  const shooterSettled = legal.shots.length > 0 && dangerAt(dmap, me, me.pos) <= 0;
  if (legal.moves.length && !opts.noMoves && !shooterSettled) {
    const cap = legal.attacks.length || legal.shots.length ? 5 : 10;
    for (const pos of moveCandidates(cs, me, side, reach, dmap, legal).slice(0, cap)) {
      const c = simState(cs, side);
      const m = getStack(c, me.id);
      let ok = true;
      try { moveStack(c, m, pos, reach, []); } catch { ok = false; }
      if (!ok) continue;
      candidates.push({ action: { type: 'move', to: { x: pos.x, y: pos.y } }, ...scoreOne(c, -pathHazard(reach, me, pos, hazards) * 0.05 * myVal), kind: 'move' });
    }
  }

  // ---- finalists: exact enemy reachability (body blocking, opened paths) --------------------
  const exactDone = new Set();
  rescore(defendCand);
  for (let k = 0; k < 5; k++) {
    let top = null;
    for (const c of candidates) if (!top || c.score > top.score) top = c;
    if (!top || exactDone.has(top)) break;
    rescore(top);
  }
  function rescore(c) {
    exactDone.add(c);
    if (c.state) c.score = c.adj + positional(c.state, true);
  }
  const defendScore = defendCand.score;

  // ---- wait ----------------------------------------------------------------------------------
  if (legal.canWait) {
    const pending = cs.stacks.some((s) => s.alive && controllerOf(s) !== side && !s.acted && !s.warMachine && !isDisabled(s));
    if (pending) {
      // Acting later this round keeps every option open and lets the enemy come first.
      const best = Math.max(...candidates.map((c) => c.score));
      const margin = 0.12 * myVal;
      const bestActive = candidates.filter((c) => c.kind !== 'defend' && c.kind !== 'move').reduce((m, c) => Math.max(m, c.score), -Infinity);
      // Only worth it when no attack is clearly better than holding still.
      if (bestActive < defendScore + margin) {
        candidates.push({ action: { type: 'wait' }, score: Math.max(defendScore, best - margin) + 0.01 * myVal, kind: 'wait' });
      }
    }
  }
  for (const c of candidates) { delete c.state; delete c.adj; }
  return { candidates, baseline: defendScore };
}

function safe(fn) {
  try { return fn(); } catch { return false; }
}

/**
 * A handful of purposeful destinations: closest approach to every enemy (also the closest one
 * outside the enemy's reach), the safest hex, guard spots next to our shooters, the hex that
 * blocks an enemy shooter.
 */
function moveCandidates(cs, me, side, reach, dmap, legal) {
  const out = new Map();
  const add = (pos) => { if (pos) out.set(hexIndex(pos), pos); };
  const enemies = cs.stacks.filter((s) => s.alive && controllerOf(s) !== side);
  const moves = legal.moves;
  const dist = (pos, t) => hexSetDistance(stackHexesAt(me, pos), stackHexes(t));
  const pathLen = (pos) => reach.get(hexIndex(pos))?.dist ?? 0;
  for (const t of enemies) {
    let best = null;
    let bestSafe = null;
    for (const pos of moves) {
      const d = dist(pos, t);
      const k = d * 100 + pathLen(pos);
      if (!best || k < best.k) best = { pos, k };
      if (dangerAt(dmap, me, pos) <= 0 && (!bestSafe || k < bestSafe.k)) bestSafe = { pos, k };
    }
    add(best?.pos);
    add(bestSafe?.pos);
  }
  // safest hex (fewest enemy blows), then closest to the enemy
  let safest = null;
  for (const pos of moves) {
    const k = dangerAt(dmap, me, pos) * 1000 + Math.min(...enemies.map((t) => dist(pos, t)), 99);
    if (!safest || k < safest.k) safest = { pos, k };
  }
  add(safest?.pos);
  // guard spots next to own shooters (melee only)
  if (!isShooterType(me)) {
    for (const f of cs.stacks) {
      if (!f.alive || f.id === me.id || controllerOf(f) !== side || !isShooterType(f)) continue;
      let best = null;
      for (const pos of moves) {
        if (hexSetDistance(stackHexesAt(me, pos), stackHexes(f)) !== 1) continue;
        const k = Math.min(...enemies.map((t) => dist(pos, t)), 99);
        if (!best || k < best.k) best = { pos, k };
      }
      add(best?.pos);
    }
  }
  // cap the list: keep a deterministic order
  return [...out.values()].slice(0, 12);
}

/** Speed helper re-exported for the retreat logic. */
export { speedOf, bestAttackValue };
