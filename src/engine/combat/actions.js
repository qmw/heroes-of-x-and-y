// Movement, melee attacks, shooting and the legal-action query.
// Order of resolution of an attack: docs/mechanics/creatures.md §3 / docs/mechanics/combat.md §5.
import {
  W, H, hexIndex, hexFromIndex, neighbors, neighbor, hexDistance, directionTo, sameHex, inBounds,
  stackHexes, stackHexesAt, stacksAdjacent, hexSetDistance, hexesInRadius,
} from './hex.js';
import {
  rollChance, occupancy, blockedHexes, canStandAt, stackAt, hasBonus, getStack,
} from './state.js';
import {
  creatureOf, abilityOf, hasAb, isLiving, speedOf, luckOf, controlOf, controllerOf, isDisabled, isImmobile,
  retaliationPercent, hasAmmoCart, totalHp, tagsOf,
} from './stats.js';
import {
  ev, applyDamage, dealSpellDamage, breakOnDamage, refreshBinds, releaseBindsOf, obstaclesAt, removeObstacle,
} from './effects.js';
import { computeAttackDamage } from './damage.js';
import { onHitEffects, acidBreath, lightningStrike, lifeDrain, shieldReturn, heatStroke } from './abilities.js';
import { siegeBlocksGround, siegeOnEnterHex, siegeStopsMove } from './siege.js';

// ---------------------------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------------------------

export function moveMode(stack) {
  if (hasAb(stack, 'teleport')) return 'teleport';
  if (creatureOf(stack).flying) return 'fly';
  if (hasAb(stack, 'burrow')) return 'burrow';
  return 'walk';
}

export const isBound = (stack) => !!controlOf(stack, 'bind');

/**
 * Head positions the stack can end its move on this turn.
 * @returns {Map<number, {dist: number, prev: number|null}>} keyed by hexIndex of the head hex;
 *   always contains the current position with dist 0.
 */
export function reachable(cs, stack, speedOverride = null) {
  const out = new Map();
  const start = hexIndex(stack.pos);
  out.set(start, { dist: 0, prev: null });
  if (isImmobile(stack) || isBound(stack) || !stack.alive) return out;
  const speed = speedOverride ?? speedOf(cs, stack);
  const occ = occupancy(cs, stack.id);
  const blocked = blockedHexes(cs, stack);
  const mode = moveMode(stack);
  if (mode === 'fly' || mode === 'teleport') {
    for (let i = 0; i < W * H; i++) {
      if (i === start) continue;
      const pos = hexFromIndex(i);
      const d = hexDistance(stack.pos, pos);
      if (d <= speed && canStandAt(cs, stack, pos, occ, blocked)) out.set(i, { dist: d, prev: start });
    }
    return out;
  }
  // walk / burrow: breadth-first over head positions
  const groundOk = (pos) => stackHexesAt(stack, pos).every((h) => inBounds(h) && !(cs.siege && siegeBlocksGround(cs, stack, h)));
  const seen = new Map([[start, { dist: 0, prev: null }]]);
  let frontier = [stack.pos];
  for (let d = 1; d <= speed && frontier.length; d++) {
    const next = [];
    for (const cur of frontier) {
      for (const n of neighbors(cur)) {
        const i = hexIndex(n);
        if (seen.has(i) || !groundOk(n)) continue;
        const free = canStandAt(cs, stack, n, occ, blocked);
        if (mode === 'walk' && !free) continue;
        seen.set(i, { dist: d, prev: hexIndex(cur) });
        if (!(mode === 'walk' && cs.siege && siegeStopsMove(cs, stack, n))) next.push(n); // moat ends the move
        if (free) out.set(i, seen.get(i));
      }
    }
    frontier = next;
  }
  return out;
}

/** Hexes walked from the current position to `to` (excluding the start). */
export function pathTo(reach, seenOrReach, to) {
  const path = [];
  let i = hexIndex(to);
  while (i !== null && reach.get(i) && reach.get(i).prev !== null) {
    path.unshift(hexFromIndex(i));
    i = reach.get(i).prev;
  }
  return path;
}

// ---------------------------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------------------------

/** Traps on a hex the stack just walked onto. Returns true when its movement must stop. */
export function enterHex(cs, stack, pos, events) {
  let stop = false;
  const side = controllerOf(stack);
  for (const h of stackHexesAt(stack, pos)) {
    for (const o of obstaclesAt(cs, h)) {
      if (o.kind === 'quicksand' && o.side !== side) {
        o.hidden = false;
        events.push(ev('obstacle_triggered', { obstacleId: o.id, kind: o.kind, stackId: stack.id }));
        stop = true;
      } else if (o.kind === 'land_mine' && o.side !== side) {
        events.push(ev('obstacle_triggered', { obstacleId: o.id, kind: o.kind, stackId: stack.id }));
        events.push(...removeObstacle(cs, o.id));
        events.push(...dealSpellDamage(cs, stack, o.damage, { element: o.element ?? 'fire', spellId: o.spellId ?? undefined, casterSide: o.side }));
        stop = true;
      } else if (o.kind === 'fire_wall' && stack.fireWallRound !== cs.round) {
        stack.fireWallRound = cs.round;
        events.push(ev('obstacle_triggered', { obstacleId: o.id, kind: o.kind, stackId: stack.id }));
        events.push(...dealSpellDamage(cs, stack, o.damage, { element: o.element ?? 'fire', spellId: o.spellId ?? undefined, casterSide: o.side }));
      }
      if (!stack.alive) return true;
    }
    if (cs.siege && siegeOnEnterHex(cs, stack, h, events).stop) stop = true;
    if (!stack.alive) return true;
  }
  return stop;
}

/**
 * Move the stack to head position `to` (must be in `reach`).
 * @returns {{travelled: number, arrived: boolean}}
 */
export function moveStack(cs, stack, to, reach, events, extra = {}) {
  const from = { ...stack.pos };
  if (sameHex(from, to)) return { travelled: 0, arrived: true };
  const mode = moveMode(stack);
  const node = reach.get(hexIndex(to));
  let path = [to];
  let arrived = true;
  if (mode === 'walk') {
    path = pathTo(reach, null, to);
    const walked = [];
    for (const step of path) {
      stack.pos = { x: step.x, y: step.y };
      walked.push(step);
      if (enterHex(cs, stack, step, events) && !sameHex(step, to)) { arrived = false; break; }
      if (!stack.alive) { arrived = false; break; }
    }
    path = walked;
  } else {
    stack.pos = { x: to.x, y: to.y };
    if (mode === 'burrow') enterHex(cs, stack, to, events);
    else if (cs.siege) for (const h of stackHexesAt(stack, to)) siegeOnEnterHex(cs, stack, h, events); // landing: gate, moat
  }
  if (!stack.alive) arrived = false;
  const travelled = mode === 'walk' ? path.length : node.dist;
  events.push(ev('move', { stackId: stack.id, from, to: { ...stack.pos }, path, mode, ...extra }));
  events.push(...releaseBindsOf(cs, stack));
  events.push(...refreshBinds(cs));
  return { travelled, arrived };
}

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

export const isEnemy = (a, b) => controllerOf(a) !== controllerOf(b);

/** Adjacent pair (attacker hex, target hex) used for breath / three-headed geometry. */
function contactHexes(attacker, target) {
  for (const ah of stackHexes(attacker)) {
    for (const th of stackHexes(target)) if (hexDistance(ah, th) === 1) return { ah, th };
  }
  return null;
}

/** All stacks hit by one melee blow: the primary target first. */
export function meleeTargets(cs, attacker, target) {
  const out = [target];
  const add = (s) => { if (s && s.alive && s.id !== attacker.id && !out.includes(s)) out.push(s); };
  if (hasAb(attacker, 'attack_all_adjacent')) {
    for (const s of cs.stacks) if (s.alive && isEnemy(attacker, s) && stacksAdjacent(attacker, s)) add(s);
  }
  const contact = contactHexes(attacker, target);
  if (contact && hasAb(attacker, 'three_headed_attack')) {
    const near = neighbors(contact.ah);
    for (const h of neighbors(contact.th)) {
      if (!near.some((n) => sameHex(n, h))) continue;
      const s = stackAt(cs, h);
      if (s && isEnemy(attacker, s)) add(s);
    }
  }
  if (contact && hasAb(attacker, 'breath_attack')) {
    const behind = neighbor(contact.th, directionTo(contact.ah, contact.th));
    if (inBounds(behind)) add(stackAt(cs, behind)); // friend or foe
  }
  return out;
}

/** Can the stack use its ranged attack right now? */
export function canShoot(cs, stack) {
  if (!stack.alive || creatureOf(stack).shots <= 0 || stack.shots <= 0) return false;
  if (hasAb(stack, 'catapult')) return false;
  const forget = controlOf(stack, 'forget');
  if (forget && forget.value >= 100) return false;
  if (stack.warMachine || hasBonus(cs, stack.side, 'free_shooting')) return true;
  return !cs.stacks.some((s) => s.alive && !s.warMachine && isEnemy(stack, s) && stacksAdjacent(stack, s));
}

function rollLuck(cs, stack, events) {
  const luck = luckOf(cs, stack);
  if (luck > 0) {
    const doubled = cs.stacks.some((s) => s.alive && s.side === stack.side && hasAb(s, 'luck_doubling'));
    if (rollChance(cs, (luck * 100 * (doubled ? 2 : 1)) / 24, 'luck')) {
      events.push(ev('luck', { stackId: stack.id, good: true }));
      return 1;
    }
  } else if (luck < 0 && rollChance(cs, (-luck * 100) / 12, 'bad_luck')) {
    events.push(ev('luck', { stackId: stack.id, good: false }));
    return -1;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Melee
// ---------------------------------------------------------------------------------------------

/**
 * One melee blow (attack or retaliation) with the attacker's multi-target pattern.
 * @returns {{dealt: number, killed: number}} result against the primary target
 */
function strike(cs, ctx, attacker, target, opts) {
  const { events } = ctx;
  const targets = meleeTargets(cs, attacker, target);
  const luck = rollLuck(cs, attacker, events);
  const dd = abilityOf(attacker, 'double_damage_chance');
  const deathBlow = dd ? rollChance(cs, dd.chance, 'double_damage_chance') : false;
  events.push(ev(opts.retaliation ? 'retaliate' : 'attack', {
    stackId: attacker.id, targetId: target.id, targets: targets.map((t) => t.id), lucky: luck, deathBlow,
  }));
  let primary = { dealt: 0, killed: 0 };
  for (const t of targets) {
    if (!t.alive || !attacker.alive) continue;
    const isPrimary = t.id === target.id;
    const { damage } = computeAttackDamage(cs, attacker, t, {
      ranged: false, retaliation: opts.retaliation, luck, retalPercent: opts.retalPercent, deathBlow,
      hexesTravelled: isPrimary ? opts.hexesTravelled ?? 0 : 0, noMeleePenalty: opts.noMeleePenalty,
    });
    // Only a control that was already active is broken by this blow (not one it inflicts itself).
    if (isDisabled(t)) ctx.damaged.add(t.id);
    const res = applyDamage(cs, t, damage, { kind: 'melee', sourceStackId: attacker.id }, events);
    if (isPrimary) primary = res;
    lifeDrain(cs, attacker, t, res.dealt, events);
    shieldReturn(cs, attacker, t, res.dealt, events);
    acidBreath(cs, attacker, t, events);
    if (isPrimary && !opts.retaliation) heatStroke(cs, attacker, t, res.dealt, events);
  }
  onHitEffects(cs, attacker, target, { ranged: false, retaliation: !!opts.retaliation, timing: 'after' }, events);
  return primary;
}

function retaliate(cs, ctx, defender, attacker) {
  const pct = retaliationPercent(cs, defender);
  if (pct <= 0 || !attacker.alive || !stacksAdjacent(defender, attacker) || (!isEnemy(defender, attacker) && !ctx.force)) return false;
  defender.retaliationsUsed += 1;
  onHitEffects(cs, defender, attacker, { ranged: false, retaliation: true, timing: 'before' }, ctx.events);
  strike(cs, ctx, defender, attacker, { retaliation: true, retalPercent: pct });
  return true;
}

function flushBreaks(cs, ctx) {
  for (const id of ctx.damaged) {
    const s = getStack(cs, id);
    if (s) ctx.events.push(...breakOnDamage(cs, s));
  }
  ctx.damaged.clear();
}

/** A stack with `preemptive_shot` fires at the stack that just moved in to melee it. */
function preemptiveShot(cs, ctx, attacker, target) {
  if (!hasAb(target, 'preemptive_shot') || target.preemptiveUsed || target.shots <= 0) return;
  if (isDisabled(target) || hasAb(attacker, 'burrow') || !isEnemy(attacker, target)) return;
  target.preemptiveUsed = true;
  ctx.events.push(ev('ability', { stackId: target.id, ability: 'preemptive_shot', targetId: attacker.id }));
  fireShot(cs, ctx, target, attacker, { noRangePenalty: true, reaction: true });
}

/**
 * Full melee attack of `attacker` on `target` from head position `from`.
 * @returns {{ok: boolean, error?: string}}
 */
export function doAttack(cs, attacker, target, from, events, opts = {}) {
  const reach = reachable(cs, attacker);
  const node = reach.get(hexIndex(from));
  if (!node) return { ok: false, error: 'unreachable' };
  if (hexSetDistance(stackHexesAt(attacker, from), stackHexes(target)) !== 1) return { ok: false, error: 'not_adjacent' };
  const ctx = { events, damaged: new Set(), force: !!opts.force };
  const origin = { ...attacker.pos };
  const moved = moveStack(cs, attacker, from, reach, events);
  if (!moved.arrived || !attacker.alive) return { ok: true };
  if (moved.travelled > 0) {
    preemptiveShot(cs, ctx, attacker, target);
    if (!attacker.alive || !target.alive) { flushBreaks(cs, ctx); return { ok: true }; }
  }
  onHitEffects(cs, attacker, target, { ranged: false, retaliation: false, timing: 'before' }, events);
  const noRetal = hasAb(attacker, 'no_enemy_retaliation');
  let retaliated = false;
  if (hasAb(target, 'first_strike') && !noRetal) {
    retaliated = retaliate(cs, ctx, target, attacker);
    if (!attacker.alive || isDisabled(attacker)) { flushBreaks(cs, ctx); return { ok: true }; }
  }
  const wasDisabled = isDisabled(target);
  const first = strike(cs, ctx, attacker, target, { hexesTravelled: moved.travelled });
  // A target blinded / petrified / paralyzed by this very blow does not answer it.
  const stunned = !wasDisabled && isDisabled(target);
  if (!retaliated && !noRetal && !stunned && target.alive && attacker.alive) retaliate(cs, ctx, target, attacker);
  flushBreaks(cs, ctx);
  if (attacker.alive && target.alive) lightningStrike(cs, attacker, target, events);
  const again = hasAb(attacker, 'double_attack') || (hasAb(attacker, 'ferocity') && first.killed > 0);
  if (again && attacker.alive && target.alive && !isDisabled(attacker) && stacksAdjacent(attacker, target)) {
    strike(cs, ctx, attacker, target, { hexesTravelled: 0 });
    flushBreaks(cs, ctx);
  }
  if (hasAb(attacker, 'strike_and_return') && attacker.alive && !isBound(attacker) && !sameHex(attacker.pos, origin)
      && canStandAt(cs, attacker, origin)) {
    const back = new Map([[hexIndex(origin), { dist: moved.travelled, prev: hexIndex(attacker.pos) }]]);
    moveStack(cs, attacker, origin, back, events, { returning: true });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------------------------

function spendAmmo(cs, stack) {
  if (!hasAmmoCart(cs, stack.side)) stack.shots = Math.max(0, stack.shots - 1);
}

/** One shot with splash, on-hit effects and (unless it is itself a reaction) ranged retaliation. */
function fireShot(cs, ctx, shooter, target, opts = {}) {
  const { events } = ctx;
  onHitEffects(cs, shooter, target, { ranged: true, retaliation: false, timing: 'before' }, events);
  spendAmmo(cs, shooter);
  const luck = rollLuck(cs, shooter, events);
  const area = abilityOf(shooter, 'area_shot');
  const targets = [target];
  if (area) {
    const zone = new Set(hexesInRadius(target.pos, area.radius).map(hexIndex));
    for (const s of cs.stacks) {
      if (!s.alive || s.id === target.id || s.id === shooter.id) continue;
      if (area.affects === 'living' && !isLiving(s)) continue;
      if (stackHexes(s).some((h) => zone.has(hexIndex(h)))) targets.push(s);
    }
  }
  events.push(ev('shoot', { stackId: shooter.id, targetId: target.id, targets: targets.map((t) => t.id), lucky: luck, shotsLeft: shooter.shots }));
  const doubleDamage = !!opts.doubleDamagePercent && rollChance(cs, opts.doubleDamagePercent, 'artillery');
  for (const t of targets) {
    if (!t.alive) continue;
    const { damage } = computeAttackDamage(cs, shooter, t, { ranged: true, luck, doubleDamage, noRangePenalty: opts.noRangePenalty });
    if (isDisabled(t)) ctx.damaged.add(t.id);
    applyDamage(cs, t, damage, { kind: 'ranged', sourceStackId: shooter.id }, events);
    acidBreath(cs, shooter, t, events);
  }
  onHitEffects(cs, shooter, target, { ranged: true, retaliation: false, timing: 'after' }, events);
  if (!opts.reaction && target.alive && shooter.alive && hasAb(target, 'ranged_retaliation') && target.shots > 0
      && !isDisabled(target) && retaliationPercent(cs, target) > 0 && isEnemy(shooter, target)) {
    target.retaliationsUsed += 1;
    events.push(ev('ability', { stackId: target.id, ability: 'ranged_retaliation', targetId: shooter.id }));
    fireShot(cs, ctx, target, shooter, { reaction: true });
  }
}

/**
 * Ranged attack action (with `double_shot` and Artillery's extra shots).
 * @param {{shots?: number, doubleDamagePercent?: number}} [opts] war machine parameters
 */
export function doShoot(cs, shooter, target, events, opts = {}) {
  if (!canShoot(cs, shooter)) return { ok: false, error: 'cannot_shoot' };
  if (!target || !target.alive) return { ok: false, error: 'bad_target' };
  const ctx = { events, damaged: new Set() };
  const shots = opts.shots ?? (hasAb(shooter, 'double_shot') ? 2 : 1);
  for (let i = 0; i < shots; i++) {
    if (!shooter.alive || !target.alive || shooter.shots <= 0 || isDisabled(shooter)) break;
    fireShot(cs, ctx, shooter, target, { doubleDamagePercent: opts.doubleDamagePercent, reaction: i > 0 });
    flushBreaks(cs, ctx);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------------------------

/** Melee options of the stack: `[{ targetId, fromHexes: [head positions] }]`. */
export function attackOptions(cs, stack, reach = reachable(cs, stack)) {
  const out = [];
  if (isImmobile(stack)) return out;
  for (const t of cs.stacks) {
    if (!t.alive || !isEnemy(stack, t) || t.id === stack.id) continue;
    const tHexes = stackHexes(t);
    const fromHexes = [];
    for (const [i, node] of reach) {
      if (node === undefined) continue;
      const pos = hexFromIndex(i);
      if (hexSetDistance(stackHexesAt(stack, pos), tHexes) === 1) fromHexes.push(pos);
    }
    if (fromHexes.length) out.push({ targetId: t.id, fromHexes });
  }
  return out;
}

export function shootOptions(cs, stack) {
  if (!canShoot(cs, stack)) return [];
  return cs.stacks.filter((t) => t.alive && isEnemy(stack, t)).map((t) => t.id);
}

/** Move destinations (head hexes), excluding the current position. */
export function moveOptions(cs, stack, reach = reachable(cs, stack)) {
  const here = hexIndex(stack.pos);
  return [...reach.keys()].filter((i) => i !== here).map(hexFromIndex);
}

export { tagsOf, totalHp };
