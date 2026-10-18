// Retreat / surrender decision of an AI hero: leave a clearly lost battle when the hero is worth
// saving; buy the army free when that is affordable and the army is worth it.
import { getCreature } from '../../../data/creatures.js';
import { otherSide } from '../state.js';
import { sideStrength } from './eval.js';
import { fightingStacks } from '../result.js';

/** Rough worth of the hero itself (level, artifacts / bonuses, spell book). */
export function heroWorth(hero) {
  if (!hero) return 0;
  return (hero.level ?? 1) * 1 + (hero.bonuses?.length ?? 0) * 1.5 + (hero.spells?.length ?? 0) * 0.3;
}

/**
 * Expected strength ratio own / enemy including the heroes' remaining mana.
 */
export function strengthRatio(cs, side) {
  const own = sideStrength(cs, side);
  const foe = sideStrength(cs, otherSide(side));
  const manaW = (s) => {
    const h = cs.sides[s].hero;
    return h ? h.mana * (h.power ?? 1) * 6 : 0;
  };
  return (own + manaW(side)) / Math.max(1, foe + manaW(otherSide(side)));
}

/**
 * @returns {{type:'retreat'} | {type:'surrender'} | null}
 */
export function chooseRetreat(cs, legal, side) {
  if (!legal.canRetreat) return null;
  const hero = cs.sides[side].hero;
  if (heroWorth(hero) < 4) return null;
  const ratio = strengthRatio(cs, side);
  if (ratio >= 0.12) return null;
  if (legal.canSurrender) {
    let gold = 0;
    for (const s of fightingStacks(cs, side)) gold += s.count * (getCreature(s.creatureId).cost.gold ?? 0);
    // The price is the army's full recruit cost minus Diplomacy (original): buy a valuable army
    // free when that leaves at least half of the treasury.
    const purse = cs.sides[side].gold;
    if (gold >= 1500 && (purse === null || purse >= 2 * legal.surrenderCost)) return { type: 'surrender' };
  }
  return { type: 'retreat' };
}
