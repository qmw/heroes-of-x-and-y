// Army / hero / town strength and battle outcome estimates for the AI (docs/mechanics/ai.md).
import { getCreature } from '../../data/creatures.js';
import { armyStrength } from '../army.js';
import { getPrimary } from '../bonuses.js';
import { buildCombatSide, getCombatEngine, getHeroSpells } from '../hero.js';
import { getGarrisonArmy } from '../town.js';
import { baseStackCount } from '../adventure/index.js';

/** Gold value of one aiValue point. */
export const GOLD_PER_STRENGTH = 0.7;

export function strengthOf(army) {
  return army ? armyStrength(army) : 0;
}

/** Hero's fighting strength: army × primary skills (+ a little for spells). */
export function heroStrength(state, hero, army = hero.army) {
  if (!hero) return strengthOf(army);
  let prim;
  try {
    prim = getPrimary(state, hero);
  } catch {
    prim = hero.primary || { attack: 0, defense: 0, power: 1, knowledge: 1 };
  }
  let f = Math.sqrt((1 + 0.05 * (prim.attack || 0)) * (1 + 0.05 * (prim.defense || 0)));
  if ((hero.mana || 0) >= 5) {
    let spells = 0;
    try { spells = getHeroSpells(state, hero).length; } catch { spells = 0; }
    if (spells > 0) f *= 1 + Math.min(0.5, 0.025 * (prim.power || 0) + 0.01 * Math.min(spells, 10));
  }
  return strengthOf(army) * f;
}

function fortFactor(town) {
  const b = town.buildings || [];
  if (b.includes('castle')) return 1.6;
  if (b.includes('citadel')) return 1.4;
  if (b.includes('fort')) return 1.25;
  return 1;
}

/** Strength a besieger has to beat (garrison / garrison hero × walls + visiting hero). */
export function townDefense(state, town, withHeroes = true) {
  let total = 0;
  const gh = town.garrisonHero ? state.heroes[town.garrisonHero] : null;
  if (gh) total += withHeroes ? heroStrength(state, gh) : 0;
  else total += strengthOf(getGarrisonArmySafe(state, town));
  total *= fortFactor(town);
  if (!withHeroes) return total;
  const vh = town.visitingHero ? state.heroes[town.visitingHero] : null;
  if (vh && vh.owner === town.owner) total += heroStrength(state, vh) * fortFactor(town);
  return total;
}

function getGarrisonArmySafe(state, town) {
  try { return getGarrisonArmy(state, town); } catch { return town.garrison; }
}

export function monsterStrength(obj) {
  const c = getCreature(obj.data.creatureId);
  return Math.max(1, (obj.data.count || 0) * c.aiValue);
}

/**
 * Quick estimate. @returns {{ratio, win, lossFrac, lossStrength}}
 */
export function estimate(ours, theirs, minRatio) {
  const ratio = theirs <= 0 ? 99 : ours / theirs;
  const win = ratio >= minRatio;
  // calibrated against simulated (auto-resolved) battles of AI heroes vs map monsters: losses ~10-25 % at r 1.2-2
  const lossFrac = theirs <= 0 ? 0 : Math.min(1, 0.55 / (ratio * ratio));
  return { ratio, win, lossFrac, lossStrength: ours * lossFrac, simulated: false };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 0x7ffffffe + 1;
}

/** Split a monster stack the way the adventure engine does (without the random +-1). */
export function monsterArmy(obj, ratio) {
  const count = obj.data.count || 0;
  const m = Math.max(1, Math.min(7, count, baseStackCount(ratio)));
  const army = new Array(7).fill(null);
  const base = Math.floor(count / m);
  let rem = count - base * m;
  for (let i = 0; i < m; i++) {
    army[i] = { creatureId: obj.data.creatureId, count: base + (rem > 0 ? 1 : 0) };
    if (rem > 0) rem--;
  }
  return army;
}

/**
 * Simulate an auto-resolved battle of `hero` against a neutral `army` without touching the state.
 * @returns {{win:boolean, lossStrength:number, lossFrac:number}|null} null without a combat engine
 */
export function simulateBattle(ctx, hero, army, key, opts = {}) {
  const { state } = ctx;
  const enemyHero = !Array.isArray(army) && army && army.heroId ? state.heroes[army.heroId] : null;
  const theirs = enemyHero ? strengthOf(enemyHero.army) : strengthOf(army);
  const cacheKey = `${hero.id}|${Math.round(strengthOf(hero.army))}|${Math.round(theirs)}|${key}`;
  if (ctx.simCache.has(cacheKey)) return ctx.simCache.get(cacheKey);
  const engine = getCombatEngine();
  if (!engine || typeof engine.autoResolve !== 'function') return null;
  // auto-resolving is expensive (tens of ms): a small deterministic budget per turn
  if ((ctx.simsLeft ?? 0) <= 0) return null;
  ctx.simsLeft--;
  const t0 = Date.now();
  let out = null;
  try {
    const defSpec = enemyHero ? { heroId: enemyHero.id } : { army: army.map((s) => (s ? { ...s } : null)), playerId: null };
    const attSpec = { heroId: hero.id };
    const input = {
      seed: hashStr(`${state.turn}|${cacheKey}`),
      terrain: opts.terrain || 'grass',
      attacker: JSON.parse(JSON.stringify(buildCombatSide(state, attSpec, { enemy: defSpec }))),
      defender: JSON.parse(JSON.stringify(buildCombatSide(state, defSpec, { enemy: attSpec }))),
      siege: null, bank: !!opts.bank, obstacles: 'random', overlay: null, overlayEffects: [],
    };
    const cs = engine.createCombat(input);
    let result = engine.autoResolve(cs, { maxRounds: 12 });
    if ((!result || !result.winner) && engine.isOver(cs)) result = engine.getResult(cs);
    if (result) {
      const before = strengthOf(hero.army);
      const after = result.winner === 'attacker' ? strengthOf(result.attacker?.army || []) : 0;
      const lossStrength = Math.max(0, before - after);
      out = { win: result.winner === 'attacker', lossStrength, lossFrac: before > 0 ? lossStrength / before : 1, simulated: true };
    }
  } catch (e) {
    out = null;
  }
  ctx.report.simMs += Date.now() - t0;
  ctx.simCache.set(cacheKey, out);
  return out;
}

/** Share of an army's aiValue held by stacks matching `pred`. */
function share(army, pred) {
  let all = 0;
  let hit = 0;
  for (const s of army || []) {
    if (!s || !(s.count > 0)) continue;
    let c;
    try { c = getCreature(s.creatureId); } catch { continue; }
    const v = c.aiValue * s.count;
    all += v;
    if (pred(c)) hit += v;
  }
  return all > 0 ? hit / all : 0;
}

/**
 * Neutral shooters shred a slow melee army before it gets to them (the quick estimate is blind to
 * that): their strength counts up to 50 % more, less when we shoot / fly / are fast ourselves.
 */
export function shooterFactor(ourArmy, theirArmy) {
  const theirs = share(theirArmy, (c) => (c.shots || 0) > 0);
  if (!theirs) return 1;
  const mobile = share(ourArmy, (c) => (c.shots || 0) > 0 || c.flying || (c.speed || 0) >= 7);
  return 1 + 0.5 * theirs * (1 - mobile);
}

/**
 * Judge a fight of `hero` against a neutral army (monster stack, bank, guards).
 * @returns {{win, ratio, lossStrength, lossFrac, simulated}}
 */
export function judgeNeutralFight(ctx, hero, army, theirStrength, key, opts = {}) {
  const ours = heroStrength(ctx.state, hero);
  const est = estimate(ours, theirStrength * shooterFactor(hero.army, army), ctx.knobs.minRatio);
  if (ctx.knobs.simulate && !ctx.planning && est.ratio >= 0.7 && est.ratio <= 3) {
    const sim = simulateBattle(ctx, hero, army, key, opts);
    if (sim) {
      // Keep a safety margin: a simulated narrow win with heavy losses counts as a loss.
      const win = sim.win && sim.lossFrac < 0.7;
      return { ...est, win, lossStrength: sim.lossStrength * 1.15, lossFrac: Math.min(1, sim.lossFrac * 1.15), simulated: true };
    }
  }
  return est;
}

/**
 * Judge an attack on an enemy hero (estimate with an extra margin; simulated when allowed).
 * @returns {{win, ratio, lossStrength, lossFrac, simulated}}
 */
export function judgeHeroFight(ctx, hero, enemy, enemyStrength) {
  const ours = heroStrength(ctx.state, hero);
  const est = estimate(ours, enemyStrength, ctx.knobs.attackRatio);
  if (ctx.knobs.simulate && !ctx.planning && est.ratio >= 0.8 && est.ratio <= 4) {
    const sim = simulateBattle(ctx, hero, { heroId: enemy.id }, `hero:${enemy.id}`);
    if (sim) return { ...est, win: sim.win && sim.lossFrac < 0.6, lossStrength: sim.lossStrength * 1.2, lossFrac: Math.min(1, sim.lossFrac * 1.2), simulated: true };
  }
  return est;
}
