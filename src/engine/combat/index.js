// Public API of the tactical combat engine (DESIGN.md §5, docs/mechanics/combat.md).
// Combat is self-contained: it never reads GameState. The CombatState is plain JSON.
import { hexIndex, sameHex, stackHexesAt, facing } from './hex.js';
import { setupCombat, getStack, otherSide, canStandAt } from './state.js';
import {
  controllerOf, speedOf, attackOf, defenseOf, moraleOf, luckOf, tagsOf, maxRetaliations, creatureOf, isImmobile,
  magicResistanceOf, hasAb,
} from './stats.js';
import { ev } from './effects.js';
import { damageRange, previewDamage } from './damage.js';
import { reachable, moveStack, doAttack, doShoot, attackOptions, shootOptions, canShoot, isEnemy, moveMode } from './actions.js';
import { performAbility } from './abilities.js';
import { doHeal, artilleryParams, machineControl } from './machines.js';
import { castHeroSpell, getCastableSpells, getSpellTargets } from './spells.js';
import { beginCombat, finishAction, revalidateActive, describeTurnOrder, endTactics, tacticsHexes } from './turn.js';
import { getResult, endCombat, canRetreat, canSurrender, getSurrenderCost } from './result.js';
import { getLegalActions } from './legal.js';
import { chooseAction } from './ai.js';
import { performSiegeAttack } from './siege.js';

/**
 * Create a combat from a CombatInput and run it up to the first decision.
 * The events of the opening (round start, artifact casts, automatic turns) are kept in
 * `cs.startEvents` for the UI.
 * @returns {Object} CombatState (plain JSON)
 */
export function createCombat(input) {
  const cs = setupCombat(input);
  cs.startEvents = beginCombat(cs, input);
  return cs;
}

export const isOver = (cs) => cs.phase === 'over';
export const getActiveStack = (cs) => (cs.phase === 'battle' ? getStack(cs, cs.active) : null);
export { getLegalActions, getResult, describeTurnOrder, chooseAction };

const fail = (error) => ({ ok: false, error });

function tacticsAction(cs, action, events) {
  if (action.type === 'tactics_end' || action.type === 'auto') { endTactics(cs, events); return { ok: true, events }; }
  if (action.type !== 'tactics_move') return fail('tactics_phase');
  const stack = getStack(cs, action.stackId);
  if (!stack || !action.to || !tacticsHexes(cs, stack).some((h) => sameHex(h, action.to))) return fail('bad_tactics_move');
  const from = { ...stack.pos };
  stack.pos = { x: action.to.x, y: action.to.y };
  events.push(ev('move', { stackId: stack.id, from, to: { ...stack.pos }, path: [{ ...stack.pos }], mode: 'tactics' }));
  return { ok: true, events };
}

/**
 * Perform an action for the active stack (or its hero).
 * Actions: move {to} | attack {targetId, from?} | shoot {targetId} | wait | defend |
 * cast {spellId, target} | ability {ability, targetId} | heal {targetId} |
 * siege_attack {targetId} | retreat | surrender | auto | tactics_move {stackId, to} | tactics_end.
 * @returns {{ok: true, events: Object[]} | {ok: false, error: string}}
 */
export function performAction(cs, action) {
  if (cs.phase === 'over') return fail('combat_over');
  if (!action || typeof action.type !== 'string') return fail('bad_action');
  const events = [];
  if (cs.phase === 'tactics') return tacticsAction(cs, action, events);
  if (action.type === 'auto') return performAction(cs, chooseAction(cs));
  const stack = getStack(cs, cs.active);
  if (!stack) return fail('no_active_stack');
  const side = controllerOf(stack);
  const machine = stack.warMachine;

  switch (action.type) {
    case 'move': {
      if (!action.to || isImmobile(stack)) return fail('cannot_move');
      const reach = reachable(cs, stack);
      let to = { x: action.to.x, y: action.to.y };
      // A two-hex creature may be sent to a hex its tail would occupy.
      if (!reach.has(hexIndex(to)) && stack.size > 1) to = { x: to.x + facing(stack.side), y: to.y };
      if (!reach.has(hexIndex(to)) || sameHex(to, stack.pos)) return fail('unreachable');
      moveStack(cs, stack, to, reach, events);
      finishAction(cs, stack, 'move', events);
      return { ok: true, events };
    }
    case 'attack': {
      const target = getStack(cs, action.targetId);
      if (!target || !target.alive || !isEnemy(stack, target)) return fail('bad_target');
      const opt = attackOptions(cs, stack).find((a) => a.targetId === target.id);
      if (!opt) return fail('unreachable');
      let from = action.from;
      if (from) {
        if (!opt.fromHexes.some((h) => sameHex(h, from))) return fail('bad_from_hex');
      } else {
        from = opt.fromHexes.find((h) => sameHex(h, stack.pos)) ?? opt.fromHexes[0];
      }
      const res = doAttack(cs, stack, target, from, events);
      if (!res.ok) return res;
      finishAction(cs, stack, 'attack', events);
      return { ok: true, events };
    }
    case 'shoot': {
      const target = getStack(cs, action.targetId);
      if (!target || !shootOptions(cs, stack).includes(target.id)) return fail('bad_target');
      const res = doShoot(cs, stack, target, events, hasAb(stack, 'hero_attack_scaling') ? artilleryParams(cs, stack) : {});
      if (!res.ok) return res;
      finishAction(cs, stack, 'shoot', events);
      return { ok: true, events };
    }
    case 'wait':
      if (stack.waited || machine) return fail('cannot_wait');
      events.push(ev('wait', { stackId: stack.id }));
      finishAction(cs, stack, 'wait', events);
      return { ok: true, events };
    case 'defend':
      if (!machine) stack.defending = true;
      events.push(ev('defend', { stackId: stack.id }));
      finishAction(cs, stack, 'defend', events);
      return { ok: true, events };
    case 'cast': {
      const res = castHeroSpell(cs, side, action.spellId, action.target ?? null);
      if (!res.ok) return res;
      events.push(...res.events);
      revalidateActive(cs, events);
      return { ok: true, events };
    }
    case 'ability': {
      const res = performAbility(cs, stack, action, events);
      if (!res.ok) return res;
      finishAction(cs, stack, 'ability', events);
      return { ok: true, events };
    }
    case 'heal': {
      const res = doHeal(cs, stack, getStack(cs, action.targetId), events);
      if (!res.ok) return res;
      finishAction(cs, stack, 'heal', events);
      return { ok: true, events };
    }
    case 'siege_attack': {
      const res = performSiegeAttack(cs, stack, action.targetId, events);
      if (!res.ok) return res;
      finishAction(cs, stack, 'siege_attack', events);
      return { ok: true, events };
    }
    case 'retreat':
      if (!canRetreat(cs, side)) return fail('cannot_retreat');
      cs.sides[side].fled = true;
      events.push(ev('retreat', { side }));
      endCombat(cs, otherSide(side), 'retreat', events);
      return { ok: true, events };
    case 'surrender':
      if (!canSurrender(cs, side)) return fail('cannot_surrender');
      cs.surrenderCost = getSurrenderCost(cs, side);
      cs.sides[side].surrendered = true;
      events.push(ev('surrender', { side, cost: cs.surrenderCost }));
      endCombat(cs, otherSide(side), 'surrender', events);
      return { ok: true, events };
    default:
      return fail('unknown_action');
  }
}

/**
 * Let the AI play both sides to the end.
 * @param {{maxRounds?: number}} [opts] hard cap (default 100 rounds); reaching it ends the battle as a
 *        defender win (reason 'timeout'): the attacker failed to take the field in time
 * @returns {Object} CombatResult
 */
export function autoResolve(cs, opts = {}) {
  const maxRounds = opts.maxRounds ?? 100;
  for (let guard = 0; guard < 100000 && cs.phase !== 'over'; guard++) {
    if (cs.round > maxRounds) break;
    const res = performAction(cs, { type: 'auto' });
    if (!res.ok) performAction(cs, { type: 'defend' });
  }
  if (cs.phase !== 'over') endCombat(cs, 'defender', 'timeout', []);
  return getResult(cs);
}

/** Effective, display-ready numbers of a stack (all statuses, auras and hero bonuses applied). */
export function getStackInfo(cs, stackId) {
  const s = getStack(cs, stackId);
  if (!s) return null;
  const c = creatureOf(s);
  const dmg = damageRange(s);
  return {
    id: s.id, side: s.side, controller: controllerOf(s), creatureId: s.creatureId, name: c.name,
    count: s.count, startCount: s.startCount, alive: s.alive, hp: s.hp, maxHp: s.maxHp,
    attack: attackOf(cs, s), defense: defenseOf(cs, s), minDamage: dmg.min, maxDamage: dmg.max,
    speed: speedOf(cs, s), morale: moraleOf(cs, s), luck: luckOf(cs, s),
    shots: s.shots, canShoot: canShoot(cs, s), moveMode: moveMode(s),
    retaliationsLeft: Math.max(0, maxRetaliations(cs, s) - s.retaliationsUsed),
    magicResistance: magicResistanceOf(cs, s),
    pos: { ...s.pos }, hexes: stackHexesAt(s, s.pos), size: s.size,
    acted: s.acted, waited: s.waited, defending: s.defending, summoned: s.summoned, clone: s.clone,
    warMachine: s.warMachine, machineControl: s.warMachine ? machineControl(cs, s) : null,
    tags: tagsOf(s), abilities: c.abilities.map((a) => a.id), castsLeft: { ...s.castsLeft }, pendingSpell: s.pendingSpell,
    effects: s.effects.map((e) => ({ spellId: e.spellId, mastery: e.mastery, value: e.value, roundsLeft: e.roundsLeft, casterSide: e.casterSide })),
    statuses: [s.invulnerable ? 'invulnerable' : null, s.defending ? 'defending' : null].filter(Boolean),
  };
}

/**
 * Damage tooltip for `attackerId` hitting `targetId`.
 * @param {{ranged?: boolean, from?: Hex}} [opts] default: ranged when the attacker can shoot;
 *        `from` = attack hex (for the jousting bonus)
 * @returns {{minDamage, maxDamage, minKills, maxKills, ranged}}
 */
export function getAttackPreview(cs, attackerId, targetId, opts = {}) {
  const a = getStack(cs, attackerId);
  const t = getStack(cs, targetId);
  if (!a || !t || !a.alive || !t.alive) return null;
  const ranged = opts.ranged ?? canShoot(cs, a);
  let hexesTravelled = opts.hexesTravelled ?? 0;
  if (!ranged && opts.from) hexesTravelled = reachable(cs, a).get(hexIndex(opts.from))?.dist ?? 0;
  return { ...previewDamage(cs, a, t, { ranged, hexesTravelled }), ranged };
}

// Building blocks for the spells / siege / AI modules and for tests.
export { getCastableSpells, getSpellTargets, castHeroSpell, canStandAt };
export { getSurrenderCost, canRetreat, canSurrender } from './result.js';
export {
  applySpellToStack, dealSpellDamage, canSpellAffect, healStack, resurrectStack, summonStack, removeStatus, addStatus,
  dispelStack, killStack, placeObstacle, removeObstacle, applyDamage,
} from './effects.js';
export { resolveSpell, getSpellAreaPreview, getCastProblem, knownSpells, heroMastery, heroSpellPower, heroSpellCost } from './spells.js';
export { visibleObstacles } from './spells/handlers.js';
export { getStack } from './state.js';
