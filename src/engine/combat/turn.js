// Rounds and turns: initiative order, wait phase, morale, fear, skipped turns, automatic turns
// (berserk, uncontrolled war machines) and the tactics phase. docs/mechanics/combat.md §3.
import { hexIndex, hexFromIndex, stackDistance, stackHexesAt, hexSetDistance, stackHexes, W, inBounds } from './hex.js';
import { rollChance, getStack, findBonuses, sumBonus, canStandAt, SIDES } from './state.js';
import { speedOf, moraleOf, controllerOf, controlOf, isDisabled } from './stats.js';
import { ev, tickRoundStart, endTurnEffects, killStack, obstaclesAt, dealSpellDamage } from './effects.js';
import { turnStartAbilities, fearCheck } from './abilities.js';
import { reachable, moveStack, doAttack, doShoot, canShoot } from './actions.js';
import { takesTurns, machineControl, machineAutoAct } from './machines.js';
import { checkBattleEnd, endCombat } from './result.js';
import { applyCombatStartCasts } from './spells.js';
import { siegeOnRoundStart, siegeOnTurnStart } from './siege.js';

// ---- initiative ---------------------------------------------------------------------------------

function compareTurn(cs, lastSide, waitedPhase) {
  return (a, b) => {
    const sa = speedOf(cs, a);
    const sb = speedOf(cs, b);
    if (sa !== sb) return waitedPhase ? sa - sb : sb - sa;
    // Equal speed: the side that did not act last goes first; then army slot order.
    const pa = controllerOf(a) === lastSide ? 1 : 0;
    const pb = controllerOf(b) === lastSide ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return waitedPhase ? b.id - a.id : a.id - b.id;
  };
}

/** The stack that acts next this round, or null when the round is over. */
export function nextInOrder(cs, pool = null, lastSide = cs.lastSide) {
  const list = (pool ?? cs.stacks).filter((s) => s.alive && !s.acted && takesTurns(cs, s));
  const normal = list.filter((s) => !s.waited);
  if (normal.length) return normal.sort(compareTurn(cs, lastSide, false))[0];
  if (list.length) return list.sort(compareTurn(cs, lastSide, true))[0];
  return null;
}

/**
 * Predicted order for the rest of this round and the whole next round.
 * @returns {Array<{stackId, side, creatureId, count, speed, phase: 'active'|'normal'|'waited'|'next_round'}>}
 */
export function describeTurnOrder(cs) {
  const out = [];
  if (cs.phase !== 'battle') return out;
  const row = (s, phase) => ({ stackId: s.id, side: controllerOf(s), creatureId: s.creatureId, count: s.count, speed: speedOf(cs, s), phase });
  const sim = cs.stacks.filter((s) => s.alive && takesTurns(cs, s)).map((s) => ({ ...s }));
  let last = cs.lastSide;
  const active = sim.find((s) => s.id === cs.active);
  if (active) {
    out.push(row(active, 'active'));
    active.acted = true;
    last = controllerOf(active);
  }
  for (let next = nextInOrder(cs, sim, last); next; next = nextInOrder(cs, sim, last)) {
    out.push(row(next, next.waited ? 'waited' : 'normal'));
    next.acted = true;
    last = controllerOf(next);
  }
  for (const s of sim) { s.acted = false; s.waited = false; }
  for (let next = nextInOrder(cs, sim, last); next; next = nextInOrder(cs, sim, last)) {
    out.push(row(next, 'next_round'));
    next.acted = true;
    last = controllerOf(next);
  }
  return out;
}

// ---- rounds -------------------------------------------------------------------------------------

function startRound(cs, events) {
  cs.round += 1;
  for (const s of cs.stacks) {
    s.acted = false;
    s.waited = false;
    s.moraleUsed = false;
    s.turnStarted = false;
    s.retaliationsUsed = 0;
    s.preemptiveUsed = false;
  }
  for (const side of SIDES) cs.sides[side].castThisRound = false;
  events.push(ev('round_start', { round: cs.round }));
  if (cs.round > 1) {
    events.push(...tickRoundStart(cs));
    for (const s of cs.stacks) {
      if (!s.alive || !s.clone || s.cloneRoundsLeft === null) continue;
      s.cloneRoundsLeft -= 1;
      if (s.cloneRoundsLeft <= 0) events.push(...killStack(cs, s, { kind: 'expired', noCorpse: true }));
    }
  }
  if (cs.siege) siegeOnRoundStart(cs, events);
}

function endTurn(cs, stack, events) {
  stack.acted = true;
  cs.lastSide = controllerOf(stack);
  events.push(...endTurnEffects(cs, stack));
  if (cs.active === stack.id) cs.active = null;
}

/** Berserk: attack the nearest stack of either side (shoot it, melee it, or walk towards it). */
function berserkAct(cs, stack, events) {
  const others = cs.stacks.filter((s) => s.alive && s.id !== stack.id)
    .sort((a, b) => stackDistance(stack, a) - stackDistance(stack, b) || a.id - b.id);
  const target = others[0];
  if (!target) return;
  events.push(ev('berserk', { stackId: stack.id, targetId: target.id }));
  if (canShoot(cs, stack) && stackDistance(stack, target) > 1) { doShoot(cs, stack, target, events); return; }
  const reach = reachable(cs, stack);
  const tHexes = stackHexes(target);
  let best = null;
  for (const [i, node] of reach) {
    const pos = hexFromIndex(i);
    const d = hexSetDistance(stackHexesAt(stack, pos), tHexes);
    if (!best || d < best.d || (d === best.d && node.dist < best.dist)) best = { pos, d, dist: node.dist };
  }
  if (best.d === 1) doAttack(cs, stack, target, best.pos, events, { force: true });
  else if (best.dist > 0) moveStack(cs, stack, best.pos, reach, events);
}

/**
 * Begin the turn of `stack`. Returns true when the engine now waits for an action
 * (`cs.active` is set), false when the turn was resolved automatically / skipped.
 */
function beginTurn(cs, stack, events) {
  const resumed = stack.turnStarted;
  if (!resumed) {
    stack.turnStarted = true;
    stack.defending = false;
    stack.invulnerable = false;
    events.push(ev('turn_start', { stackId: stack.id, side: controllerOf(stack), round: cs.round }));
    if (cs.siege) siegeOnTurnStart(cs, stack, events);
    for (const h of stackHexes(stack)) {
      for (const o of obstaclesAt(cs, h)) {
        if (o.kind !== 'fire_wall' || stack.fireWallRound === cs.round || !stack.alive) continue;
        stack.fireWallRound = cs.round;
        events.push(...dealSpellDamage(cs, stack, o.damage, { element: o.element ?? 'fire', spellId: o.spellId ?? undefined, casterSide: o.side }));
      }
    }
    if (stack.alive) turnStartAbilities(cs, stack, events);
    if (!stack.alive || cs.phase === 'over') return false;
  } else {
    events.push(ev('turn_start', { stackId: stack.id, side: controllerOf(stack), round: cs.round, resumed: true }));
  }
  const skip = (reason) => {
    events.push(ev('turn_skipped', { stackId: stack.id, reason }));
    endTurn(cs, stack, events);
    return false;
  };
  if (isDisabled(stack)) return skip('disabled');
  if (!resumed) {
    if (fearCheck(cs, stack)) return skip('fear');
    const morale = moraleOf(cs, stack);
    if (morale < 0 && rollChance(cs, (-morale * 100) / 12, 'bad_morale')) {
      events.push(ev('morale', { stackId: stack.id, good: false }));
      return skip('morale');
    }
  }
  if (controlOf(stack, 'berserk')) {
    berserkAct(cs, stack, events);
    if (stack.alive) endTurn(cs, stack, events);
    return false;
  }
  if (stack.warMachine && machineControl(cs, stack) === 'auto') {
    machineAutoAct(cs, stack, events);
    if (stack.alive) endTurn(cs, stack, events);
    return false;
  }
  cs.active = stack.id;
  return true;
}

/** Run turns until a stack needs a player / AI decision or the combat ends. */
export function advance(cs, events) {
  let emptyRounds = 0;
  for (;;) {
    if (checkBattleEnd(cs, events)) return;
    const next = nextInOrder(cs);
    if (!next) {
      if (cs.maxRounds && cs.round >= cs.maxRounds) { endCombat(cs, 'defender', 'timeout', events); return; }
      if (++emptyRounds > 3) { endCombat(cs, 'draw', 'stalemate', events); return; }
      startRound(cs, events);
      continue;
    }
    emptyRounds = 0;
    if (beginTurn(cs, next, events)) return;
  }
}

/**
 * The active stack finished an action. `kind`: 'wait' | 'defend' | anything else.
 * Rolls good morale (never after wait / defend), then moves on.
 */
export function finishAction(cs, stack, kind, events) {
  if (checkBattleEnd(cs, events)) return;
  if (kind === 'wait' && stack.alive) {
    stack.waited = true;
    cs.active = null;
    advance(cs, events);
    return;
  }
  if (stack.alive && kind !== 'defend' && !stack.moraleUsed && !isDisabled(stack) && !controlOf(stack, 'berserk')) {
    const morale = moraleOf(cs, stack);
    if (morale > 0 && rollChance(cs, (morale * 100) / 24, 'morale')) {
      stack.moraleUsed = true;
      cs.active = stack.id;
      events.push(...endTurnEffects(cs, stack));
      events.push(ev('morale', { stackId: stack.id, good: true }));
      events.push(ev('turn_start', { stackId: stack.id, side: controllerOf(stack), round: cs.round, extra: true }));
      return;
    }
  }
  if (stack.alive) endTurn(cs, stack, events); else if (cs.active === stack.id) cs.active = null;
  advance(cs, events);
}

/** After something outside the normal action flow (a hero spell) the active stack may be gone. */
export function revalidateActive(cs, events) {
  if (checkBattleEnd(cs, events)) return;
  const stack = getStack(cs, cs.active);
  if (stack && stack.alive && !isDisabled(stack)) return;
  if (stack && stack.alive) endTurn(cs, stack, events);
  cs.active = null;
  advance(cs, events);
}

// ---- tactics phase & start ------------------------------------------------------------------------

/** Round 1: `combat_start_cast` artifacts fire, then the first stack gets its turn. */
function startBattle(cs, events) {
  startRound(cs, events);
  events.push(...applyCombatStartCasts(cs));
  advance(cs, events);
}

/** Head positions a stack may be placed on during the tactics phase. */
export function tacticsHexes(cs, stack) {
  const t = cs.tactics;
  if (!t || stack.side !== t.side || stack.warMachine || !stack.alive) return [];
  const out = [];
  for (let i = 0; i < W * 11; i++) {
    const pos = hexFromIndex(i);
    if (!inBounds(pos) || hexIndex(pos) === hexIndex(stack.pos)) continue;
    const ok = stackHexesAt(stack, pos).every((h) => (t.side === 'attacker' ? h.x <= t.hexes : h.x >= W - 1 - t.hexes));
    if (ok && canStandAt(cs, stack, pos)) out.push(pos);
  }
  return out;
}

export function endTactics(cs, events) {
  if (cs.phase !== 'tactics') return;
  cs.tactics = null;
  cs.phase = 'battle';
  events.push(ev('tactics_end', {}));
  startBattle(cs, events);
}

/**
 * Start a freshly set up combat: optional tactics phase (only for a human side with a Tactics
 * advantage; `input.tactics === false` disables it), then round 1.
 */
export function beginCombat(cs, input = {}) {
  const events = [ev('combat_start', { terrain: cs.terrain, siege: !!cs.siege, bank: cs.bank })];
  const depth = (side) => Math.max(0, ...findBonuses(cs, side, 'tactics').map((b) => b.hexes ?? 0), 0);
  const diff = depth('attacker') - depth('defender');
  const side = diff > 0 ? 'attacker' : 'defender';
  if (diff !== 0 && input.tactics !== false && cs.sides[side].isHuman && !cs.bank) {
    cs.phase = 'tactics';
    cs.tactics = { side, hexes: Math.abs(diff) };
    events.push(ev('tactics_start', { side, hexes: Math.abs(diff) }));
    return events;
  }
  cs.phase = 'battle';
  startBattle(cs, events);
  return events;
}

export { sumBonus };
