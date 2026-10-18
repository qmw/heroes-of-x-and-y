// FROZEN copy of the original baseline combat AI. It is the reference opponent of the A/B
// tournament in tests/combat/ai-tournament.test.js - do not improve it; the real AI is ../ai.js.
import { getCreature } from '../../../data/creatures.js';
import { getSpell } from '../../../data/spells.js';
import { hexIndex, hexFromIndex, stackHexes, stackHexesAt, hexSetDistance, stackDistance } from '../hex.js';
import { getStack } from '../state.js';
import { controllerOf, totalHp, retaliationPercent, hasAb, hasEffect } from '../stats.js';
import { previewDamage } from '../damage.js';
import { reachable, isEnemy } from '../actions.js';
import { getLegalActions } from '../legal.js';
import { getSpellTargets } from '../spells.js';

/** Value of one hit point of the stack (AI value per hp). */
const hpValue = (stack) => getCreature(stack.creatureId).aiValue / Math.max(1, stack.baseHp);
const stackValue = (stack) => getCreature(stack.creatureId).aiValue * stack.count;

function expected(cs, attacker, target, opts) {
  const p = previewDamage(cs, attacker, target, opts);
  return Math.min((p.minDamage + p.maxDamage) / 2, totalHp(target));
}

function bestBy(list, score) {
  let best = null;
  let bestScore = -Infinity;
  for (const item of list) {
    const s = score(item);
    if (s > bestScore) { bestScore = s; best = item; }
  }
  return best;
}

function chooseHeroSpell(cs, legal) {
  const side = legal.side;
  let best = null;
  for (const spellId of legal.spells) {
    const spell = getSpell(spellId);
    const t = getSpellTargets(cs, side, spellId);
    const stacks = t.stackIds.map((id) => getStack(cs, id)).filter(Boolean);
    if (!stacks.length) continue;
    const friendly = (s) => controllerOf(s) === side;
    let target = null;
    let score = spell.aiValue || spell.level * 10;
    if (spell.alignment === 'positive') {
      let pool = stacks.filter((s) => friendly(s) && !hasEffect(s, spellId));
      if (spell.category === 'heal') pool = pool.filter((s) => !s.alive || s.count < s.startCount || s.hp < s.maxHp);
      if (!pool.length) continue;
      target = bestBy(pool, (s) => (s.alive ? stackValue(s) : getCreature(s.creatureId).aiValue * s.startCount));
    } else if (spell.alignment === 'negative') {
      const pool = stacks.filter((s) => !friendly(s) && (spell.category === 'damage' || !hasEffect(s, spellId)));
      if (!pool.length) continue;
      target = bestBy(pool, stackValue);
      // do not burn our own army with area spells / Armageddon
      if (spell.effect.friendlyFire && (t.mode === 'all' || t.mode === 'area')) score *= 0.25;
    } else continue;
    if (!best || score > best.score) {
      const needsStack = ['enemy_stack', 'friendly_stack', 'any_stack', 'dead_friendly_stack'].includes(t.mode);
      best = { score, action: { type: 'cast', spellId, target: needsStack ? target.id : (t.mode === 'area' ? { ...target.pos } : null) } };
    }
  }
  return best ? best.action : null;
}

function chooseAbility(cs, stack, legal, canFight) {
  for (const a of legal.abilities) {
    const targets = a.targets.map((id) => getStack(cs, id));
    if (a.ability === 'spellcaster' && stack.pendingSpell) {
      return { type: 'ability', ability: a.ability, targetId: bestBy(targets, stackValue).id };
    }
    if (a.ability === 'resurrection' || a.ability === 'raise_demons' || a.ability === 'repair') {
      const t = bestBy(targets, (s) => getCreature(s.creatureId).aiValue * (s.startCount - (s.alive ? s.count : 0)) + 1);
      if (a.ability !== 'resurrection' || !t.alive || t.count < t.startCount) return { type: 'ability', ability: a.ability, targetId: t.id };
    }
    if (a.ability === 'devour_corpse' && stack.count < stack.startCount) return { type: 'ability', ability: a.ability, targetId: a.targets[0] };
    if (a.ability === 'spellcaster' && !stack.pendingSpell && !canFight) {
      return { type: 'ability', ability: a.ability, targetId: bestBy(targets, stackValue).id };
    }
  }
  return null;
}

/** Closest attack hex (fewest hexes travelled); jousters prefer the longest run. */
function pickFrom(cs, stack, fromHexes, reach) {
  const joust = hasAb(stack, 'jousting');
  return bestBy(fromHexes, (h) => (joust ? 1 : -1) * reach.get(hexIndex(h)).dist);
}

/**
 * Choose an action for the stack that must act (or for the tactics phase).
 * @returns {Object} an action accepted by performAction (never `{type:'auto'}`)
 */
export function chooseAction(cs) {
  if (cs.phase === 'tactics') return { type: 'tactics_end' };
  const legal = getLegalActions(cs);
  const stack = getStack(cs, legal.stackId);
  if (!stack) return { type: 'defend' };

  if (legal.canCast) {
    const cast = chooseHeroSpell(cs, legal);
    if (cast) return cast;
  }
  if (legal.heals.length) {
    const t = bestBy(legal.heals.map((id) => getStack(cs, id)), (s) => (s.maxHp - s.hp) * hpValue(s));
    return { type: 'heal', targetId: t.id };
  }
  const canFight = legal.shots.length > 0 || legal.attacks.length > 0;
  const ability = chooseAbility(cs, stack, legal, canFight);
  if (ability) return ability;

  if (legal.shots.length) {
    const t = bestBy(legal.shots.map((id) => getStack(cs, id)),
      (s) => expected(cs, stack, s, { ranged: true }) * hpValue(s) * (s.warMachine ? 0.2 : 1));
    return { type: 'shoot', targetId: t.id };
  }
  if (legal.attacks.length) {
    const reach = reachable(cs, stack);
    const scored = legal.attacks.map((a) => {
      const t = getStack(cs, a.targetId);
      const from = pickFrom(cs, stack, a.fromHexes, reach);
      const dealt = expected(cs, stack, t, { hexesTravelled: reach.get(hexIndex(from)).dist });
      let score = dealt * hpValue(t) * (t.warMachine ? 0.2 : 1);
      if (dealt < totalHp(t) && !hasAb(stack, 'no_enemy_retaliation') && retaliationPercent(cs, t) > 0) {
        const left = 1 - dealt / Math.max(1, totalHp(t));
        score -= 0.5 * expected(cs, t, stack, {}) * left * hpValue(stack);
      }
      return { a, from, score };
    });
    const best = bestBy(scored, (x) => x.score);
    return { type: 'attack', targetId: best.a.targetId, from: best.from };
  }
  // Nothing in range: advance on the closest enemy along the real path (walkers route around
  // obstacles), falling back to simply closing the distance.
  const enemies = cs.stacks.filter((s) => s.alive && isEnemy(stack, s));
  if (legal.moves.length && enemies.length) {
    const reach = reachable(cs, stack);
    const far = reachable(cs, stack, 99);
    let goalNode = null;
    for (const [i, node] of far) {
      const hexes = stackHexesAt(stack, hexFromIndex(i));
      const touches = enemies.some((e) => hexSetDistance(hexes, stackHexes(e)) === 1 && !e.warMachine)
        || enemies.every((e) => e.warMachine) && enemies.some((e) => hexSetDistance(hexes, stackHexes(e)) === 1);
      if (touches && (!goalNode || node.dist < goalNode.node.dist)) goalNode = { i, node };
    }
    if (goalNode) {
      let i = goalNode.i;
      while (i !== null && !reach.has(i)) i = far.get(i)?.prev ?? null;
      if (i !== null && i !== hexIndex(stack.pos)) return { type: 'move', to: hexFromIndex(i) };
    }
    const goal = bestBy(enemies, (s) => -stackDistance(stack, s) * 1000 + (s.warMachine ? -500 : 0) + stackValue(s) / 1e6);
    const gHexes = stackHexes(goal);
    const here = hexSetDistance(stackHexes(stack), gHexes);
    const to = bestBy(legal.moves, (h) => -hexSetDistance(stackHexesAt(stack, h), gHexes) * 100 - reach.get(hexIndex(h)).dist);
    if (to && hexSetDistance(stackHexesAt(stack, to), gHexes) < here) return { type: 'move', to };
  }
  return { type: 'defend' };
}
