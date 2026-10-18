// End of combat: victory check, retreat / surrender rules and the CombatResult (DESIGN.md §5).
import { ARMY_SLOTS } from '../../core/constants.js';
import { getCreature } from '../../data/creatures.js';
import { SIDES, otherSide, anyBonus, hasBonus, sumBonus, baseTags } from './state.js';
import { controllerOf, controlOf } from './stats.js';
import { ev, removeStatus } from './effects.js';
import { siegeAllowsRetreat } from './siege.js';

/** Experience bonus for defeating (or chasing away) an enemy hero. */
export const HERO_DEFEAT_EXP = 500;

/** Stacks that keep a side in the fight: original / permanent troops, no machines, summons, clones. */
export function fightingStacks(cs, side) {
  return cs.stacks.filter((s) => s.alive && s.side === side && !s.warMachine && !s.summoned && !s.clone);
}

export function endCombat(cs, winner, reason, events) {
  if (cs.phase === 'over') return;
  cs.phase = 'over';
  cs.winner = winner;
  cs.endReason = reason;
  cs.active = null;
  events.push(ev('combat_end', { winner, reason, rounds: cs.round }));
}

/** Ends the battle when a side has no troops left. Returns true when the combat is over. */
export function checkBattleEnd(cs, events) {
  if (cs.phase === 'over') return true;
  const left = { attacker: fightingStacks(cs, 'attacker'), defender: fightingStacks(cs, 'defender') };
  for (const side of SIDES) {
    // A side whose only remaining troops are hypnotized gets them back instead of losing.
    if (left[side].length && left[side].every((s) => controllerOf(s) !== side)) {
      for (const s of left[side]) events.push(...removeStatus(cs, s, (e) => !!controlOf({ effects: [e] }, 'hypnotize'), 'expired'));
    }
  }
  const a = left.attacker.length > 0;
  const d = left.defender.length > 0;
  if (a && d) return false;
  endCombat(cs, a ? 'attacker' : d ? 'defender' : 'draw', 'annihilation', events);
  return true;
}

// ---- retreat / surrender ------------------------------------------------------------------------

export function canRetreat(cs, side) {
  const s = cs.sides[side];
  if (cs.phase !== 'battle' || !s.hero || !s.canRetreat) return false;
  if (anyBonus(cs, 'no_retreat')) return false;
  if (fightingStacks(cs, side).length === 0) return false;
  return siegeAllowsRetreat(cs, side) || hasBonus(cs, side, 'always_can_retreat');
}

/**
 * Gold to pay: the full recruit gold cost of the surviving original troops (summons, clones and
 * machines are free), reduced by Diplomacy and artifacts (max -90%), rounded down - as the
 * original (VCMI `battleGetSurrenderCost`).
 */
export function getSurrenderCost(cs, side) {
  let total = 0;
  for (const s of fightingStacks(cs, side)) total += s.count * (getCreature(s.creatureId).cost.gold ?? 0);
  const discount = sumBonus(cs, side, 'diplomacy', null, 'surrenderDiscountPercent')
    - sumBonus(cs, side, 'surrender_cost_percent', null, 'percent');
  const pct = Math.max(0, Math.min(90, discount));
  return Math.floor((total * (100 - pct)) / 100);
}

export function canSurrender(cs, side) {
  if (!canRetreat(cs, side)) return false;
  if (!cs.sides[otherSide(side)].hero && !hasBonus(cs, side, 'always_can_retreat')) return false;
  const gold = cs.sides[side].gold;
  return gold === null || gold >= getSurrenderCost(cs, side);
}

// ---- result -------------------------------------------------------------------------------------

/** Casualties of a side: `[{creatureId, count, hp, living, summoned}]` (clones and machines excluded). */
function casualties(cs, side) {
  const map = new Map();
  for (const s of cs.stacks) {
    if (s.side !== side || s.clone || s.warMachine) continue;
    const lost = Math.max(0, s.startCount - (s.alive ? Math.max(0, s.count - s.tempRaised) : 0));
    if (lost <= 0) continue;
    const key = `${s.creatureId}|${s.summoned ? 1 : 0}`;
    const c = getCreature(s.creatureId);
    const e = map.get(key) ?? { creatureId: s.creatureId, count: 0, hp: c.hp, living: baseTags(c.id).includes('living'), summoned: s.summoned };
    e.count += lost;
    map.set(key, e);
  }
  return [...map.values()];
}

function sideResult(cs, side) {
  const st = cs.sides[side];
  const won = cs.winner === side;
  const keepsArmy = !st.fled && (won || st.surrendered || cs.winner === 'draw');
  const army = new Array(ARMY_SLOTS).fill(null);
  const overflow = [];
  if (keepsArmy) {
    for (const s of cs.stacks) {
      if (s.side !== side || s.slot === null || s.summoned || s.clone) continue;
      const n = s.alive ? Math.max(0, s.count - s.tempRaised) : 0;
      if (n > 0) army[s.slot] = { creatureId: s.creatureId, count: n };
    }
    // Permanent stacks created during the battle (raised demons, Horn of the Abyss...).
    for (const s of cs.stacks) {
      if (s.side !== side || !s.alive || !s.joinsAfter || s.summoned || s.clone || s.slot !== null) continue;
      let i = army.findIndex((a) => a && a.creatureId === s.creatureId);
      if (i < 0) i = army.findIndex((a) => a === null);
      if (i < 0) { overflow.push({ creatureId: s.creatureId, count: s.count }); continue; }
      army[i] = { creatureId: s.creatureId, count: (army[i]?.count ?? 0) + s.count };
    }
  }
  const losses = {};
  st.army.forEach((orig, i) => {
    if (!orig) return;
    const kept = army[i] && army[i].creatureId === orig.creatureId ? army[i].count : 0;
    // creatures gained in battle (merged demons) are not negative losses
    const lost = Math.max(0, orig.count - Math.min(kept, orig.count));
    if (lost > 0) losses[orig.creatureId] = (losses[orig.creatureId] ?? 0) + lost;
  });
  const machines = cs.stacks.filter((s) => s.side === side && s.warMachine && s.creatureId !== 'catapult');
  const warMachinesLost = machines.filter((s) => !s.alive || !keepsArmy).map((s) => s.creatureId);
  const foeCasualties = casualties(cs, otherSide(side));
  const real = foeCasualties.filter((c) => !c.summoned);
  return {
    army, losses, overflow,
    manaLeft: st.hero ? st.hero.mana : 0,
    heroFled: st.fled,
    heroSurrendered: st.surrendered,
    warMachinesLost,
    // Necromancy inputs: what this side killed (the adapter owns the formula).
    killedEnemies: foeCasualties,
    killedHp: real.reduce((a, c) => a + c.count * c.hp, 0),
    killedCount: real.reduce((a, c) => a + c.count, 0),
    // Eagle Eye input: every spell this side's hero cast, in order (spells.js).
    spellsCast: [...(st.spellsCast ?? [])],
  };
}

/**
 * CombatResult of a finished combat (null while it is still running).
 * Experience: the winner gets the total hit points (base creature hp) of all enemy creatures that
 * died (summoned ones included, clones not) plus 500 when the loser had a hero; the loser gets 0.
 */
export function getResult(cs) {
  if (cs.phase !== 'over') return null;
  const result = {
    winner: cs.winner,
    rounds: cs.round,
    reason: cs.endReason,
    attacker: sideResult(cs, 'attacker'),
    defender: sideResult(cs, 'defender'),
    expAttacker: 0,
    expDefender: 0,
    raised: null, // necromancy is applied by the adapter from `killedEnemies`
    capturedArtifacts: false,
    surrenderCost: cs.surrenderCost,
  };
  if (cs.winner === 'attacker' || cs.winner === 'defender') {
    const loser = otherSide(cs.winner);
    const kills = casualties(cs, loser).reduce((a, c) => a + c.count * c.hp, 0);
    const exp = kills + (cs.sides[loser].hero ? HERO_DEFEAT_EXP : 0);
    if (cs.winner === 'attacker') result.expAttacker = exp; else result.expDefender = exp;
    result.capturedArtifacts = !!cs.sides[loser].hero && !cs.sides[loser].fled && !cs.sides[loser].surrendered;
  }
  return result;
}
