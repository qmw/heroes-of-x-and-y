// What the active stack (and its hero) may do right now.
import { getStack } from './state.js';
import { controllerOf, isImmobile, hasAb } from './stats.js';
import { reachable, attackOptions, shootOptions, moveOptions } from './actions.js';
import { getAbilityActions } from './abilities.js';
import { tentTargets } from './machines.js';
import { getCastableSpells } from './spells.js';
import { canRetreat, canSurrender, getSurrenderCost } from './result.js';
import { tacticsHexes } from './turn.js';
import { getSiegeTargets } from './siege.js';

const NOTHING = {
  phase: 'over', stackId: null, side: null, moves: [], attacks: [], shots: [], canWait: false, canDefend: false,
  canCast: false, spells: [], canRetreat: false, canSurrender: false, surrenderCost: 0, abilities: [], heals: [],
  siegeTargets: [], tactics: null,
};

/**
 * @returns {{phase, stackId, side, moves: Hex[], attacks: {targetId, fromHexes: Hex[]}[],
 *   shots: number[], canWait, canDefend, canCast, spells: string[], canRetreat, canSurrender,
 *   surrenderCost, abilities: {ability, spellId, targets: number[], castsLeft}[], heals: number[],
 *   siegeTargets: Object[], tactics: null | {side, hexes, stacks: {stackId, hexes: Hex[]}[]}}}
 */
export function getLegalActions(cs) {
  if (cs.phase === 'tactics') {
    const stacks = cs.stacks.filter((s) => s.alive && s.side === cs.tactics.side && !s.warMachine)
      .map((s) => ({ stackId: s.id, hexes: tacticsHexes(cs, s) }));
    return { ...NOTHING, phase: 'tactics', side: cs.tactics.side, tactics: { ...cs.tactics, stacks } };
  }
  const stack = getStack(cs, cs.active);
  if (cs.phase !== 'battle' || !stack) return { ...NOTHING, phase: cs.phase };
  const side = controllerOf(stack);
  const machine = stack.warMachine;
  const reach = reachable(cs, stack);
  const spells = getCastableSpells(cs, side);
  return {
    phase: 'battle',
    stackId: stack.id,
    side,
    moves: isImmobile(stack) ? [] : moveOptions(cs, stack, reach),
    attacks: attackOptions(cs, stack, reach),
    shots: shootOptions(cs, stack),
    canWait: !stack.waited && !machine,
    canDefend: true,
    canCast: spells.length > 0,
    spells,
    canRetreat: canRetreat(cs, side),
    canSurrender: canSurrender(cs, side),
    surrenderCost: getSurrenderCost(cs, side),
    abilities: getAbilityActions(cs, stack),
    heals: tentTargets(cs, stack).map((s) => s.id),
    siegeTargets: cs.siege ? getSiegeTargets(cs, stack) : [], // catapult / siege_attack stacks of the attacker
    tactics: null,
  };
}
