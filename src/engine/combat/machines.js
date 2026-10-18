// War machines: Ballista / Cannon (hero attack scaling, Artillery), First Aid Tent (First Aid),
// Ammo Cart (passive, see stats.hasAmmoCart), Catapult (siege only - delegated to siege.js).
// Rules: docs/mechanics/creatures.md §4.8.
import { rollInt, rollPick, findBonuses } from './state.js';
import { abilityOf, hasAb, controllerOf, isLiving } from './stats.js';
import { ev, healStack } from './effects.js';
import { doShoot, canShoot, isEnemy } from './actions.js';
import { catapultAct, catapultControl } from './siege.js';

/** Does the stack get turns at all? (Ammo Carts never act; the Catapult only in sieges.) */
export function takesTurns(cs, stack) {
  if (!stack.warMachine) return true;
  if (hasAb(stack, 'ammo_supply')) return false;
  if (hasAb(stack, 'catapult')) return !!cs.siege;
  return true;
}

/** 'player' when the owning hero's skill gives control, otherwise 'auto'. */
export function machineControl(cs, stack) {
  if (hasAb(stack, 'hero_attack_scaling')) return findBonuses(cs, stack.side, 'artillery').some((b) => b.control) ? 'player' : 'auto';
  if (hasAb(stack, 'heals')) return findBonuses(cs, stack.side, 'first_aid').some((b) => b.control) ? 'player' : 'auto';
  if (hasAb(stack, 'catapult')) return catapultControl(cs, stack);
  return 'auto';
}

/** Artillery: shots per round and the double damage chance. */
export function artilleryParams(cs, stack) {
  const b = findBonuses(cs, stack.side, 'artillery')[0];
  return { shots: b?.shots ?? 1, doubleDamagePercent: b?.doubleDamagePercent ?? 0 };
}

/** Friendly living stacks whose top creature is wounded. */
export function tentTargets(cs, stack) {
  if (!hasAb(stack, 'heals')) return [];
  return cs.stacks.filter((s) => s.alive && controllerOf(s) === controllerOf(stack) && !s.warMachine && isLiving(s) && s.hp < s.maxHp);
}

/** First Aid Tent heals the top creature of `target` for roll(min..max). */
export function doHeal(cs, stack, target, events) {
  const ab = abilityOf(stack, 'heals');
  if (!ab || !tentTargets(cs, stack).includes(target)) return { ok: false, error: 'bad_target' };
  const b = findBonuses(cs, stack.side, 'first_aid')[0];
  const amount = rollInt(cs, b?.healMin ?? ab.min, b?.healMax ?? ab.max);
  events.push(ev('ability', { stackId: stack.id, ability: 'heals', targetId: target.id }));
  events.push(...healStack(cs, target, amount));
  return { ok: true };
}

/** A machine nobody controls takes its turn. */
export function machineAutoAct(cs, stack, events) {
  if (hasAb(stack, 'catapult')) { catapultAct(cs, stack, events); return; }
  if (hasAb(stack, 'hero_attack_scaling')) {
    if (!canShoot(cs, stack)) return;
    let pool = cs.stacks.filter((s) => s.alive && isEnemy(stack, s) && !s.warMachine);
    if (!pool.length) pool = cs.stacks.filter((s) => s.alive && isEnemy(stack, s));
    if (pool.length) doShoot(cs, stack, rollPick(cs, pool), events, artilleryParams(cs, stack));
    return;
  }
  if (hasAb(stack, 'heals')) {
    const pool = tentTargets(cs, stack);
    if (pool.length) doHeal(cs, stack, rollPick(cs, pool), events);
  }
}
