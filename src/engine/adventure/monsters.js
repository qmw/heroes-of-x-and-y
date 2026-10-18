// Wandering monsters: join / flee / fight negotiation, stack splitting, growth.
// Spec: docs/mechanics/adventure-objects.md §5.
import { ARMY_SLOTS } from '../../core/constants.js';
import { randInt } from '../../core/rng.js';
import { getMapObject, monsterSizeLabel } from '../../data/mapObjects.js';
import { getCreature, getUpgrade, getBaseCreature } from '../../data/creatures.js';
import { pushPending, registerPendingHandler } from '../pending.js';
import { deps } from './deps.js';
import { EFFECTS } from './registry.js';
import { removeObject } from './map.js';
import { resolveReward, applyReward } from './rewards.js';
import { fight, onCombatOutcome, attackerWon, defenderSurvivors } from './combat.js';
import { runContinuation } from './visit.js';
import { recordDefeat } from '../victory.js';
import { armyStacks, armyStrength, armyCanAdd, armyAdd, armyTotalCount, emptyArmy, getPlayer, sameLineage } from './util.js';

/** powerFactor of the doc formula. */
export function powerFactor(ratio) {
  if (ratio >= 7) return 11;
  if (ratio >= 1) return Math.floor(2 * (ratio - 1));
  if (ratio >= 0.5) return -1;
  if (ratio >= 0.333) return -2;
  return -3;
}

/**
 * What a monster stack will do when this hero approaches (no randomness, no state change).
 * @returns {{outcome:'fight'|'join'|'join_gold'|'flee', cost:number, ratio:number, charisma:number,
 *            powerFactor:number, sympathy:number, diplomacy:number, canJoin:boolean}}
 */
export function evaluateMonster(state, hero, obj, allowJoin = true) {
  const d = obj.data;
  const creature = getCreature(d.creatureId);
  const prim = deps.getPrimary(state, hero);
  // Diplomat's Cloak: `army_strength_percent` (context 'negotiation') multiplies the hero's strength.
  const negotiation = deps.getHeroBonuses(state, hero).filter((b) => b.type === 'army_strength_percent')
    .reduce((n, b) => n + (b.percent || 0), 0);
  const heroStrength = armyStrength(hero.army) * Math.sqrt((1 + 0.05 * prim.attack) * (1 + 0.05 * prim.defense))
    * (1 + negotiation / 100);
  const monsterStrength = Math.max(1, d.count * creature.aiValue);
  const ratio = heroStrength / monsterStrength;
  const pf = powerFactor(ratio);
  const stacks = armyStacks(hero.army);
  const total = armyTotalCount(hero.army);
  const similar = stacks.filter((s) => sameLineage(s.creatureId, d.creatureId)).reduce((n, s) => n + s.count, 0);
  const sympathy = (similar > 0 ? 1 : 0) + (similar * 2 > total ? 1 : 0);
  const diplomacy = deps.getSkillLevel(hero, 'diplomacy');
  const charisma = pf + diplomacy + sympathy;
  const fx = getMapObject(obj.defId).effect;
  const canJoin = allowJoin && fx.canJoin !== false && !state.settings?.noMonsterJoin && armyCanAdd(hero.army, d.creatureId);
  const canFlee = fx.canFlee !== false && !d.neverFlees;
  const character = d.character;
  let outcome;
  if (charisma < character) outcome = 'fight';
  else if (canJoin && diplomacy + sympathy + 1 >= character) outcome = 'join';
  else if (canJoin && 2 * diplomacy + sympathy + 1 >= character) outcome = 'join_gold';
  else if (charisma > character && canFlee) outcome = 'flee';
  else outcome = 'fight';
  const cost = outcome === 'join_gold' ? d.count * (creature.cost.gold || 0) : 0;
  return { outcome, cost, ratio, charisma, powerFactor: pf, sympathy, diplomacy, canJoin };
}

/** Number of stacks the monster splits into for battle (before the random +-1). */
export function baseStackCount(ratio) {
  if (ratio < 0.5) return 7;
  if (ratio < 0.67) return 6;
  if (ratio < 1) return 5;
  if (ratio < 1.5) return 4;
  if (ratio < 2) return 3;
  return 2;
}

/** Battle army of a monster object against a hero with the given strength ratio. */
export function splitMonster(state, obj, ratio) {
  const d = obj.data;
  const fx = getMapObject(obj.defId).effect;
  let m = baseStackCount(ratio);
  const roll = randInt(state.rng, 1, 100);
  if (roll <= 20) m -= 1;
  else if (roll >= 80) m += 1;
  m = Math.max(1, Math.min(ARMY_SLOTS, d.count, m));
  const army = emptyArmy();
  const base = Math.floor(d.count / m);
  let rem = d.count - base * m;
  for (let i = 0; i < m; i++) {
    army[i] = { creatureId: d.creatureId, count: base + (rem > 0 ? 1 : 0) };
    if (rem > 0) rem--;
  }
  const up = getUpgrade(d.creatureId);
  if (up && randInt(state.rng, 1, 100) <= (fx.upgradedStackChance ?? 50)) army[Math.floor(m / 2)].creatureId = up.id;
  return army;
}

function startFight(state, hero, obj, events, then, ratio) {
  const r = ratio ?? evaluateMonster(state, hero, obj).ratio;
  const army = splitMonster(state, obj, r);
  fight(state, hero, events, { type: 'combat', heroId: hero.id, objectId: obj.id, defId: obj.defId, creatureId: obj.data.creatureId },
    { army }, { kind: 'adv_monster', heroId: hero.id, objectId: obj.id, then: then || null }, { pos: obj.pos });
}

function ask(state, hero, obj, kind, data) {
  pushPending(state, {
    kind, playerId: hero.owner, heroId: hero.id,
    options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    data: { objectId: obj.id, defId: obj.defId, creatureId: obj.data.creatureId, sizeLabel: monsterSizeLabel(obj.data.count).id, ...data },
  });
}

/**
 * The player refused (or cannot pay for) a join offer: as in the original (VCMI `joinDecision`),
 * the stack is re-evaluated without the join options - it flees if it would flee anyway
 * (`charisma > character`), otherwise it attacks ("insulted by your refusal").
 */
function refused(state, hero, obj, events, then) {
  const ev = evaluateMonster(state, hero, obj, false);
  events.push({ type: 'monster_refused', heroId: hero.id, objectId: obj.id, creatureId: obj.data.creatureId, outcome: ev.outcome });
  if (ev.outcome === 'flee') return ask(state, hero, obj, 'monster_flee', { then });
  return startFight(state, hero, obj, events, then, ev.ratio);
}

/** A hero triggers the stack (attacks it or steps into its zone of control). */
function encounter(state, hero, obj, events, then = null) {
  const ev = evaluateMonster(state, hero, obj);
  let outcome = ev.outcome;
  events.push({ type: 'monster_encounter', heroId: hero.id, objectId: obj.id, creatureId: obj.data.creatureId, outcome });
  if (outcome === 'join_gold' && !deps.canAfford(state, hero.owner, { gold: ev.cost })) return refused(state, hero, obj, events, then);
  if (outcome === 'join' || outcome === 'join_gold') return ask(state, hero, obj, 'monster_join', { cost: ev.cost, count: obj.data.count, then });
  if (outcome === 'flee') return ask(state, hero, obj, 'monster_flee', { then });
  return startFight(state, hero, obj, events, then, ev.ratio);
}

function defeated(state, hero, obj) {
  const player = getPlayer(state, hero.owner);
  if (player) { player.visited ??= {}; player.visited[`killed_${obj.id}`] = true; }
  // credit for the `defeat_monster` victory condition (victory.js)
  if (hero.owner != null) recordDefeat(state, { kind: 'monster', id: obj.id, byPlayerId: hero.owner });
}

registerPendingHandler('monster_join', (state, pending, optionIndex) => {
  const events = [];
  const hero = state.heroes[pending.heroId];
  const obj = state.map.objects[pending.data.objectId];
  if (!hero || !obj) return { ok: true, events };
  const { cost, then } = pending.data;
  const accept = optionIndex === 0 && armyCanAdd(hero.army, obj.data.creatureId) && (!cost || deps.pay(state, hero.owner, { gold: cost }));
  if (!accept) { refused(state, hero, obj, events, then); return { ok: true, events }; }
  armyAdd(hero.army, obj.data.creatureId, obj.data.count);
  removeObject(state, obj.id);
  events.push({ type: 'monster_joined', heroId: hero.id, objectId: obj.id, creatureId: obj.data.creatureId, count: obj.data.count, cost: cost || 0 });
  runContinuation(state, hero, then, events);
  return { ok: true, events };
});

registerPendingHandler('monster_flee', (state, pending, optionIndex) => {
  const events = [];
  const hero = state.heroes[pending.heroId];
  const obj = state.map.objects[pending.data.objectId];
  if (!hero || !obj) return { ok: true, events };
  if (optionIndex === 0) { startFight(state, hero, obj, events, pending.data.then); return { ok: true, events }; }
  removeObject(state, obj.id);
  events.push({ type: 'monster_fled', heroId: hero.id, objectId: obj.id, creatureId: obj.data.creatureId });
  runContinuation(state, hero, pending.data.then, events);
  return { ok: true, events };
});

onCombatOutcome('adv_monster', (state, context, result) => {
  const events = [];
  const obj = state.map.objects[context.objectId];
  if (!obj) return { ok: true, events };
  const hero = state.heroes[context.heroId];
  if (attackerWon(result) && hero) {
    defeated(state, hero, obj);
    removeObject(state, obj.id);
    events.push({ type: 'monster_defeated', heroId: hero.id, objectId: obj.id, creatureId: obj.data.creatureId });
    if (obj.data.reward) applyReward(state, hero, resolveReward(state, obj.data.reward), events, obj.defId);
    runContinuation(state, hero, context.then, events);
  } else {
    const known = !!(result && result.defender && result.defender.army);
    const left = armyTotalCount(defenderSurvivors(result));
    if (left > 0) obj.data.count = left;
    else if (known) { removeObject(state, obj.id); events.push({ type: 'monster_defeated', heroId: null, objectId: obj.id, creatureId: obj.data.creatureId }); }
  }
  return { ok: true, events };
});

EFFECTS.monster = {
  visit(ctx) { encounter(ctx.state, ctx.hero, ctx.obj, ctx.events, ctx.then || null); },
  encounter,
};

/**
 * Weekly growth: +10%, as in the original (VCMI `CGCreature::newTurn`): the stack keeps a hidden
 * fixed-point size `data.power` (= count x 1000) that grows by 10% (truncated), and the visible
 * count is `floor(power / 1000)` - small stacks grow only every few weeks, fractions accumulate.
 * No growth once the stack has reached the cap (4000). A count changed by a battle resets `power`.
 */
export function growMonster(obj) {
  const fx = getMapObject(obj.defId).effect;
  const d = obj.data;
  if (d.noGrowth) return;
  const cap = fx.growthCap || 4000;
  if (d.count >= cap) return;
  if (typeof d.power !== 'number' || Math.floor(d.power / 1000) !== d.count) d.power = d.count * 1000;
  d.power = Math.floor((d.power * (100 + (fx.weeklyGrowthPercent || 10))) / 100);
  d.count = Math.min(cap, Math.floor(d.power / 1000));
}

export { getBaseCreature };
