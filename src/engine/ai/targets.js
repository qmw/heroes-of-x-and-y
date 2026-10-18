// Target selection for AI heroes (docs/mechanics/ai.md "Targets").
import { getMapObject } from '../../data/mapObjects.js';
import { getCreature } from '../../data/creatures.js';
import { RESOURCES } from '../../core/constants.js';
import {
  getReachable, isExplored, findGuard, evaluateMonster, mineOutput, questFulfilled, getPuzzleProgress,
  getGrailObject, getTile, getHeroAt, getSpellMastery, getAdventureSpellCost, findPath,
} from '../adventure/index.js';
import { getTerrain } from '../../data/terrain.js';
import { getSpell } from '../../data/spells.js';
import { getArtifact } from '../../data/artifacts.js';
import { buildingsForFaction, RESOURCE_VALUE } from '../../data/buildings.js';
import { ownsArtifact, getEquippedArtifacts, entryId } from '../artifacts.js';
import { alreadyVisited } from '../adventure/visit.js';
import { canAfford, getTownIncome } from '../economy.js';
import { hasSpellbook, getHeroSpells } from '../hero.js';
import { getRecruitInfo } from '../town.js';
import {
  heroStrength, townDefense, strengthOf, monsterStrength, judgeNeutralFight, judgeHeroFight, estimate, monsterArmy,
  GOLD_PER_STRENGTH,
} from './strength.js';
import { noise, posKey, chebyshev } from './context.js';
import { enemyNear } from './towns.js';

const COLLECT = new Set([
  'pickup', 'chest', 'artifact', 'spell_scroll', 'pandoras_box', 'mine', 'weekly_reward', 'reward_once',
  'bank', 'primary_boost', 'exp_boost', 'library', 'learn_skill', 'level_up', 'learn_spell', 'scholar',
  'dwelling', 'prison', 'keymaster_tent', 'reveal_map', 'monster', 'obelisk', 'seer_hut', 'quest_guard',
]);
const BOOSTS = new Set(['primary_boost', 'exp_boost', 'library', 'learn_skill', 'level_up', 'learn_spell', 'scholar']);

/** Objects worth looking at this turn (cached per turn). */
export function candidates(ctx) {
  if (ctx.cands) return ctx.cands;
  const out = [];
  for (const obj of Object.values(ctx.state.map.objects || {})) {
    let def;
    try { def = getMapObject(obj.defId); } catch { continue; }
    if (!COLLECT.has(def.effect.type)) continue;
    out.push(obj);
  }
  ctx.cands = out;
  return out;
}

function guardOf(ctx, obj) {
  ctx.guardOf ??= new Map();
  let g = ctx.guardOf.get(obj.id);
  if (g === undefined) {
    const m = findGuard(ctx.state, obj.pos, obj.id);
    g = m ? m.id : null;
    ctx.guardOf.set(obj.id, g);
  }
  return g && ctx.state.map.objects[g] ? g : null;
}

/** Gold value of what a quest takes away (bring_* quests). */
export function questPrice(quest) {
  if (!quest) return 0;
  let v = 0;
  if (quest.type === 'bring_resources') for (const r of RESOURCES) v += (quest.resources?.[r] || 0) * RESOURCE_VALUE[r];
  if (quest.type === 'bring_creatures') for (const c of quest.creatures || []) v += getCreature(c.creatureId).aiValue * (c.count || 0) * GOLD_PER_STRENGTH;
  if (quest.type === 'bring_artifacts') v += (quest.artifactIds || []).length * 3000;
  return v;
}

export function rewardValue(reward) {
  if (!reward) return 0;
  let v = 0;
  if (reward.primary) for (const n of Object.values(reward.primary)) v += (n || 0) * 1500;
  if (reward.skill || reward.skills) v += 1500;
  for (const r of RESOURCES) v += (reward.resources?.[r] || 0) * RESOURCE_VALUE[r];
  v += (reward.artifacts?.length || 0) * 4000;
  if (reward.artifact) v += 4000;
  if (Array.isArray(reward.creatures)) for (const c of reward.creatures) if (c && c.creatureId) v += getCreature(c.creatureId).aiValue * (c.count || 0) * GOLD_PER_STRENGTH;
  if (reward.spell) v += 1500;
  if (reward.exp) v += reward.exp * 0.5;
  return v;
}

function armyFrom(list) {
  if (!Array.isArray(list)) return [];
  return list.map((s) => (s && s.count > 0 ? { creatureId: s.creatureId, count: s.count } : null));
}

/** Fight judgement in gold terms; null when the fight is not acceptable. */
function fightCost(ctx, hero, army, key, role, opts = {}) {
  const theirs = strengthOf(army);
  if (theirs <= 0) return 0;
  if (ctx.noCombat) return null;
  const j = judgeNeutralFight(ctx, hero, army, theirs, key, opts);
  if (!j.win) return null;
  if (role !== 'main' && j.ratio < (ctx.secRatio ?? 3)) return null;
  if (j.lossFrac > (opts.maxLoss ?? 0.5)) return null;
  return j.lossStrength * GOLD_PER_STRENGTH;
}

function stockValue(stock) {
  let v = 0;
  for (const [id, n] of Object.entries(stock || {})) if (n > 0) v += getCreature(id).aiValue * n * GOLD_PER_STRENGTH;
  return v;
}

/** Value (gold equivalent, net of expected losses) of visiting `obj`; null = not worth / impossible. */
export function objectValue(ctx, hero, obj, role) {
  const { state, playerId, player } = ctx;
  const def = getMapObject(obj.defId);
  const fx = def.effect;
  const d = obj.data || {};
  const vctx = { state, hero, player, obj, def };
  switch (fx.type) {
    case 'pickup':
    case 'chest':
      return Math.max(300, def.value || 0);
    case 'artifact':
    case 'spell_scroll': {
      let v = Math.max(500, def.value || 0);
      if (d.cost && !canAfford(state, playerId, d.cost)) return null;
      if (d.guards) {
        const c = fightCost(ctx, hero, armyFrom(d.guards), `obj:${obj.id}:guards`, role);
        if (c == null) return null;
        v -= c;
      }
      return v;
    }
    case 'pandoras_box': {
      let v = 4000;
      if (d.guards) {
        const c = fightCost(ctx, hero, armyFrom(d.guards), `obj:${obj.id}:guards`, role);
        if (c == null) return null;
        v -= c;
      }
      return v;
    }
    case 'mine': {
      if (obj.owner === playerId) return null;
      const out = mineOutput(obj);
      let v = (out.amount || 1) * (RESOURCE_VALUE[out.resource] || 250) * 12;
      if (obj.owner != null) v *= 1.5;
      if (d.cleared === false && d.guards) {
        const c = fightCost(ctx, hero, armyFrom(d.guards), `obj:${obj.id}:guards`, role);
        if (c == null) return null;
        v -= c;
      }
      if (d.garrison) {
        const c = fightCost(ctx, hero, armyFrom(d.garrison), `obj:${obj.id}:garrison`, role);
        if (c == null) return null;
        v -= c;
      }
      return v;
    }
    case 'weekly_reward':
    case 'reward_once':
      if (alreadyVisited(vctx) || (fx.type === 'reward_once' && d.visited)) return null;
      if (fx.cost && !canAfford(state, playerId, fx.cost)) return null;
      return Math.max(200, def.value || 0);
    case 'bank': {
      if (d.cleared || role !== 'main') return null;
      const c = fightCost(ctx, hero, armyFrom(d.guards), `obj:${obj.id}:bank`, role, { bank: true, maxLoss: 0.35 });
      if (c == null) return null;
      return rewardValue(d.reward) - c;
    }
    case 'primary_boost':
    case 'exp_boost':
    case 'library':
    case 'learn_skill':
    case 'level_up':
    case 'learn_spell':
    case 'scholar': {
      if (alreadyVisited(vctx)) return null;
      if (fx.type === 'learn_spell' && !hasSpellbook(hero)) return null;
      if (fx.type === 'learn_skill' && hero.skills.length >= 8) return null;
      const cost = fx.cost || d.cost;
      if (cost && Object.keys(cost).length && !canAfford(state, playerId, cost)) return null;
      return Math.max(300, def.value || 0) * (role === 'main' ? 1.5 : 0.4);
    }
    case 'dwelling': {
      const sv = stockValue(d.stock);
      let v;
      if (obj.owner === playerId) {
        if (sv < 800 || (player.resources.gold || 0) < 1000) return null;
        v = Math.min(sv, (player.resources.gold || 0) * 0.8) * 0.6;
      } else {
        v = (def.value || 500) + sv * 0.4;
      }
      if (!d.cleared && d.guards) {
        const c = fightCost(ctx, hero, armyFrom(d.guards), `obj:${obj.id}:guards`, role);
        if (c == null) return null;
        v -= c;
      }
      return v;
    }
    case 'prison':
      return ctx.player.heroes.length < 8 ? 3000 : null;
    case 'obelisk':
      if (player.visited?.[obj.id]) return null;
      return 1500 * (role === 'main' ? 1 : 1.2);
    case 'seer_hut': {
      if (d.completed || !d.quest || (d.deadline != null && state.turn > d.deadline)) return null;
      let ok = false;
      try { ok = questFulfilled(state, hero, d.quest); } catch { ok = false; }
      if (!ok) return player.visited?.[obj.id] ? null : 300; // learn what it wants
      return Math.max(500, rewardValue(d.reward) - questPrice(d.quest));
    }
    case 'quest_guard': {
      let ok = false;
      try { ok = !!d.quest && questFulfilled(state, hero, d.quest); } catch { ok = false; }
      return ok ? Math.max(300, 1500 - questPrice(d.quest)) : null;
    }
    case 'keymaster_tent':
    case 'reveal_map':
      if (alreadyVisited(vctx)) return null;
      return Math.min(1500, Math.max(200, (def.value || 0) * 0.3));
    default:
      return null;
  }
}

function guardedValue(ctx, hero, monster, role) {
  ctx.guardedBy ??= null;
  if (!ctx.guardedBy) {
    ctx.guardedBy = new Map();
    for (const o of candidates(ctx)) {
      if (o.defId === 'monster' || !ctx.state.map.objects[o.id]) continue;
      const g = guardOf(ctx, o);
      if (!g) continue;
      if (!ctx.guardedBy.has(g)) ctx.guardedBy.set(g, []);
      ctx.guardedBy.get(g).push(o.id);
    }
  }
  let v = 0;
  for (const id of ctx.guardedBy.get(monster.id) || []) {
    const o = ctx.state.map.objects[id];
    if (!o) continue;
    const ov = objectValue(ctx, hero, o, role);
    if (ov && ov > 0) v += ov;
  }
  return v;
}

/** Value of attacking / approaching a wandering monster. */
export function monsterValue(ctx, hero, obj, role) {
  const { state } = ctx;
  const d = obj.data;
  const creature = getCreature(d.creatureId);
  const guarded = guardedValue(ctx, hero, obj, role);
  let ev;
  try { ev = evaluateMonster(state, hero, obj); } catch { return null; }
  const joinValue = creature.aiValue * d.count * GOLD_PER_STRENGTH;
  const road = roadValue(ctx, hero, obj, role);
  if (ev.outcome === 'join') return joinValue + guarded + road;
  if (ev.outcome === 'join_gold' && ev.cost <= (ctx.player.resources.gold || 0) * 0.6) return joinValue - ev.cost + guarded + road;
  // a fleeing stack vanishes when approached: it is worth what it guards and the road it blocks
  if (ev.outcome === 'flee') return guarded + road > 0 ? guarded + road : null;
  if (ctx.noCombat) return null;
  const theirs = monsterStrength(obj);
  const army = monsterArmy(obj, ev.ratio);
  const j = judgeNeutralFight(ctx, hero, army, theirs, `mon:${obj.id}`);
  if (!j.win) return null;
  if (role !== 'main' && j.ratio < (ctx.secRatio ?? 3)) return null;
  if (j.lossFrac > 0.5) return null;
  const exp = creature.hp * d.count;
  const quest = questBonus(ctx)[obj.id] || 0;
  // clearing a stack also opens the roads it guards (base value) and trains the hero
  return (role === 'main' ? 700 + exp * 0.5 : 200 + exp * 0.2) + guarded * 0.8 + road + quest + (d.reward ? 1500 : 0) - j.lossStrength * GOLD_PER_STRENGTH;
}

/**
 * Value of the ground a monster blocks: passable tiles around it that the hero cannot reach now
 * (gateway guards between zones), more when unexplored. Uses the reach table of the current plan.
 */
export function roadValue(ctx, hero, obj, role) {
  const reach = ctx.curReach;
  if (!reach || ctx.curReachHero !== hero.id) return 0;
  ctx.roadCache ??= new Map();
  const ck = `${hero.id}|${obj.id}`;
  if (ctx.roadCache.has(ck)) return ctx.roadCache.get(ck);
  const { state, playerId } = ctx;
  const { width, height } = state.map;
  const z = obj.pos.z || 0;
  const tiles = state.map.tiles[z];
  const explored = state.players[playerId].explored?.[z];
  let v = 0;
  const R = 5;
  for (let dy = -R; dy <= R; dy++) {
    const y = obj.pos.y + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -R; dx <= R; dx++) {
      const x = obj.pos.x + dx;
      if (x < 0 || x >= width || (!dx && !dy)) continue;
      const t = tiles[y][x];
      if (!t || t.blocked || reach.has(`${x},${y},${z}`)) continue;
      let ter;
      try { ter = getTerrain(t.t); } catch { continue; }
      if (!ter.passable || ter.water) continue;
      v += explored && !explored[y * width + x] ? 40 : 20;
    }
  }
  v = Math.min(v, 4000) * (role === 'main' ? 1 : 0.5);
  ctx.roadCache.set(ck, v);
  return v;
}

/** Extra value of monsters that are the target of a known kill_monster seer-hut quest (per turn). */
function questBonus(ctx) {
  if (ctx.questBonus) return ctx.questBonus;
  const out = {};
  for (const o of candidates(ctx)) {
    const q = o.data?.quest;
    if (!q || q.type !== 'kill_monster' || o.data.completed) continue;
    if (!ctx.player.visited?.[o.id] && o.defId !== 'quest_guard') continue;
    out[q.objectId] = (out[q.objectId] || 0) + (o.defId === 'quest_guard' ? 1000 : rewardValue(o.data.reward) * 0.8);
  }
  ctx.questBonus = out;
  return out;
}

/** Dimension Door ability of the hero right now: `{range, moveCost}` or null. */
export function dimensionDoor(ctx, hero) {
  const { state } = ctx;
  if (!ctx.knobs.spells || hero.inBoat) return null;
  try {
    if (!getHeroSpells(state, hero).includes('dimension_door')) return null;
    const spell = getSpell('dimension_door');
    const m = getSpellMastery(state, hero, spell);
    if (hero.mana < getAdventureSpellCost(state, hero, spell)) return null;
    const uses = hero.ddUses && hero.ddUses.turn === state.turn ? hero.ddUses.count : 0;
    if (uses >= spell.effect.usesPerDay[m]) return null;
    const moveCost = spell.effect.moveCost[m];
    if (hero.movePoints < moveCost + 200) return null;
    return { range: spell.effect.range[m], moveCost };
  } catch {
    return null;
  }
}

/** Free land tile next to `obj` within Dimension Door range (closest to the hero), or null. */
function ddDestination(ctx, hero, obj, range) {
  const { state } = ctx;
  let best = null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const p = { x: obj.pos.x + dx, y: obj.pos.y + dy, z: obj.pos.z || 0 };
      const tile = getTile(state.map, p);
      if (!tile || tile.blocked || tile.obj || getHeroAt(state, p)) continue;
      let ter;
      try { ter = getTerrain(tile.t); } catch { continue; }
      if (!ter.passable || ter.water) continue;
      const d = chebyshev(hero.pos, p);
      if (d < 1 || d > range) continue;
      const g = findGuard(state, p);
      if (g && g.id !== obj.id) continue;
      if (!best || d < best.d) best = { p, d };
    }
  }
  return best ? best.p : null;
}

/** Visible enemy heroes with their strength (cached per turn, refreshed after fights). */
export function enemyHeroes(ctx) {
  const { state, playerId } = ctx;
  const out = [];
  for (const h of Object.values(state.heroes)) {
    if (h.owner == null || h.owner === playerId || !state.players[h.owner]?.alive) continue;
    if (h.garrisoned) continue;
    if (!isExplored(state, playerId, h.pos)) continue;
    const reach = Math.ceil((h.maxMovePoints || 1500) / 100);
    const strength = heroStrength(state, h);
    // what he could pick up in a town of his within reach (garrison + stock, weekly growth)
    let extra = 0;
    for (const tid of state.players[h.owner].towns) {
      const t = state.towns[tid];
      if (!t || chebyshev(t.pos, h.pos) > reach) continue;
      let v = t.garrisonHero ? 0 : strengthOf(t.garrison);
      for (const [cid, n] of Object.entries(t.stock || {})) if (n > 0) v += getCreature(cid).aiValue * n * 0.6;
      extra = Math.max(extra, v);
    }
    out.push({ hero: h, strength, potential: strength + extra, reach });
  }
  return out;
}

function unexploredAround(ctx, pos, r) {
  const { state, playerId } = ctx;
  const z = pos.z || 0;
  const arr = state.players[playerId].explored?.[z];
  if (!arr) return 0;
  const { width, height } = state.map;
  let n = 0;
  for (let dy = -r; dy <= r; dy += 2) {
    const y = pos.y + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -r; dx <= r; dx += 2) {
      const x = pos.x + dx;
      if (x < 0 || x >= width) continue;
      if (dx * dx + dy * dy > r * r) continue;
      if (!arr[y * width + x]) n++;
    }
  }
  return n * 4;
}

/**
 * Best target for `hero`: `{key, pos, kind, value, score, days, townId?, otherHeroId?}` or null.
 */
export function chooseTarget(ctx, hero, role, horizon = null) {
  // planning uses quick estimates only; the chosen fight is verified afterwards (verifyTarget)
  ctx.planning = true;
  try {
    let t = chooseTargetInner(ctx, hero, role, horizon);
    if (!t && role !== 'main') {
      // nothing at the safe margin: a secondary hero takes fights at 2:1 rather than stand around
      ctx.secRatio = 2;
      try { t = chooseTargetInner(ctx, hero, role, horizon); } finally { ctx.secRatio = null; }
    }
    return t;
  } finally {
    ctx.planning = false;
  }
}

/**
 * Re-judge the chosen target with battle simulations allowed (close calls only).
 * @returns {boolean} still worth it
 */
export function verifyTarget(ctx, hero, role, target) {
  const { state } = ctx;
  if (target.key.startsWith('obj:')) {
    const obj = state.map.objects[target.key.slice(4)];
    if (!obj) return false;
    if (target.note === 'breakout' || target.gate) {
      let ev;
      try { ev = evaluateMonster(state, hero, obj); } catch { return false; }
      const j = judgeNeutralFight(ctx, hero, monsterArmy(obj, ev.ratio), monsterStrength(obj), `mon:${obj.id}`);
      return j.win && j.lossFrac <= 0.6;
    }
    const v = obj.defId === 'monster' ? monsterValue(ctx, hero, obj, role) : objectValue(ctx, hero, obj, role);
    return v != null && v > 0;
  }
  if (target.kind === 'enemy_hero') {
    const enemy = state.heroes[target.otherHeroId];
    if (!enemy) return false;
    return judgeHeroFight(ctx, hero, enemy, heroStrength(state, enemy)).win;
  }
  return true;
}

function chooseTargetInner(ctx, hero, role, horizon) {
  const { state, playerId, player } = ctx;
  const maxTurns = horizon ?? (role === 'main' && (state.map.width || 0) < 100 ? 3 : 2);
  let reach;
  try { reach = getReachable(state, hero.id, maxTurns); } catch { return null; }
  const byKey = new Map();
  for (const e of reach) byKey.set(posKey(e), e);
  ctx.curReach = byKey;
  ctx.curReachHero = hero.id;
  ctx.roadCache = null;
  const maxMP = Math.max(1000, hero.maxMovePoints || 1500);
  const ours = heroStrength(state, hero);
  const enemies = ctx.enemies || (ctx.enemies = enemyHeroes(ctx));
  const prev = player.ai.targets[hero.id];
  const skip = player.ai.skip || {};
  let best = null;
  const inDanger = dangerAt(enemies, hero.pos) > ours ? dangerAt(enemies, hero.pos) : 0;

  const consider = (key, pos, kind, value, extra = {}) => {
    if (value == null || !(value > 0)) return;
    if (ctx.blacklist.has(`${hero.id}|${key}`)) return;
    if (skip[`${hero.id}|${key}`] && skip[`${hero.id}|${key}`] > state.turn) return;
    if (avoided(ctx, key, ours)) return;
    const e = extra.viaDD ? null : byKey.get(posKey(pos));
    if (!e && !extra.viaDD) return;
    const days = e ? Math.max(e.turns, e.cost / maxMP) : extra.ddDays;
    let v = value;
    if (prev === key) v *= 1.25;
    {
      const danger = dangerAt(enemies, pos, extra.otherHeroId);
      if (danger > ours) {
        // walking into a stronger enemy hero: only a retreat into a town is acceptable
        if (kind !== 'defend' && kind !== 'own_town' && kind !== 'retreat') return;
        v *= 0.7;
      } else if (danger > ours * 0.7) v *= 0.5;
    }
    v *= noise(ctx);
    const score = v / (days + 0.35);
    if (!best || score > best.score) best = { key, pos: { ...pos }, kind, value, score, days, ...extra };
  };

  // map objects (unreachable or far ones may be reached by Dimension Door)
  const dd = dimensionDoor(ctx, hero);
  for (const obj of candidates(ctx)) {
    if (!state.map.objects[obj.id]) continue;
    const entry = byKey.get(posKey(obj.pos));
    let viaDD = null;
    if (dd && (!entry || Math.max(entry.turns, entry.cost / maxMP) >= 1) && chebyshev(hero.pos, obj.pos) <= dd.range + 1) {
      viaDD = ddDestination(ctx, hero, obj, dd.range);
    }
    if (!entry && !viaDD) continue;
    if (!isExplored(state, playerId, obj.pos)) continue;
    let v;
    if (obj.defId === 'monster') {
      v = monsterValue(ctx, hero, obj, role);
    } else {
      if (guardOf(ctx, obj)) continue;
      v = objectValue(ctx, hero, obj, role);
    }
    const kind = obj.defId === 'monster' ? 'monster' : 'object';
    if (viaDD) consider(`obj:${obj.id}`, obj.pos, kind, v, { viaDD, ddDays: (dd.moveCost + 100) / maxMP });
    else consider(`obj:${obj.id}`, obj.pos, kind, v);
  }

  // grail: dig when the puzzle is solved, then carry it home
  const grailInfo = ctx.grailInfo || (ctx.grailInfo = getPuzzleProgress(state, playerId));
  if (grailInfo.grailPos && getGrailObject(state)) {
    consider('dig', grailInfo.grailPos, 'dig', 25000 * (role === 'main' ? 1 : 1.1));
  }
  if (ownsArtifact(hero, 'grail')) {
    for (const town of Object.values(state.towns)) {
      if (town.owner !== playerId || hero.townId === town.id) continue;
      if (!buildingsForFaction(town.faction).some((b) => b.kind === 'grail') || town.buildings.some((b) => b.endsWith('_grail'))) continue;
      consider(`town:${town.id}`, town.pos, 'grail_home', 40000, { townId: town.id });
    }
  }

  // towns
  for (const town of Object.values(state.towns)) {
    const tkey = `town:${town.id}`;
    if (town.owner === playerId) {
      if (hero.townId === town.id) continue;
      if (town.visitingHero && town.visitingHero !== hero.id) {
        // meeting a hero in town: only for secondaries going to the main hero (below)
        continue;
      }
      const threat = ctx.threats[town.id];
      if (threat && ours + townDefense(state, town) >= threat * 0.8) {
        const e = byKey.get(posKey(town.pos));
        if (e && Math.max(e.turns, e.cost / maxMP) <= 1.5) {
          consider(tkey, town.pos, 'defend', 15000, { townId: town.id });
          continue;
        }
      }
      if (inDanger && ours + townDefense(state, town) >= inDanger * 0.6) {
        consider(tkey, town.pos, 'retreat', 10000, { townId: town.id });
        continue;
      }
      if (role === 'main') {
        const gh = town.garrisonHero ? state.heroes[town.garrisonHero] : null;
        let v = strengthOf(gh && gh.owner === playerId ? gh.army : town.garrison) * GOLD_PER_STRENGTH;
        try {
          let gold = player.resources.gold || 0;
          for (const row of getRecruitInfo(state, town.id).sort((a, b) => b.tier - a.tier)) {
            const price = row.cost.gold || 1;
            const n = Math.min(row.available, Math.floor(gold / price), row.affordable);
            if (n > 0) { v += n * getCreature(row.creatureId).aiValue * GOLD_PER_STRENGTH; gold -= n * price; }
          }
        } catch { /* ignore */ }
        if (v >= 1500) consider(tkey, town.pos, 'own_town', v * 0.9, { townId: town.id });
      }
      continue;
    }
    if (!knowsTown(ctx, town)) continue;
    if (isAlly(ctx, town.owner) || (town.owner != null && !mayAttackPlayers(ctx, daysTo(byKey, town.pos, maxMP)))) continue;
    const def = townDefense(state, town);
    if (def > 0 && ctx.noCombat) continue;
    const est = estimate(ours, def, town.owner == null ? ctx.knobs.minRatio + 0.2 : ctx.knobs.attackRatio);
    if (def > 0 && (!est.win || (role !== 'main' && est.ratio < (ctx.secRatio ?? 3)))) continue;
    const base = townValue(ctx, town);
    consider(tkey, town.pos, 'siege', base - est.lossStrength * GOLD_PER_STRENGTH, { townId: town.id });
  }

  // towns beyond the planning horizon: march on a neutral / enemy town the main hero can take
  if (role === 'main' && horizon == null && !ctx.noCombat) farTowns(ctx, hero, ours, byKey, maxMP, (t) => {
    if (!best || t.score > best.score) best = t;
  });

  // enemy heroes
  for (const en of enemies) {
    const h = en.hero;
    if (h.townId || ctx.noCombat || !mayAttackPlayers(ctx, daysTo(byKey, h.pos, maxMP))) continue; // in town: handled as a siege
    const est = judgeHeroFight(ctx, hero, h, en.strength);
    if (!est.win || (role !== 'main' && est.ratio < (ctx.secRatio ?? 3))) continue;
    const v = 4000 + 1500 * (h.level || 1) + strengthOf(h.army) * GOLD_PER_STRENGTH - est.lossStrength * GOLD_PER_STRENGTH;
    consider(`hero:${h.id}`, h.pos, 'enemy_hero', v, { otherHeroId: h.id, kind: 'enemy_hero', note: `${Math.round(ours)} vs ${Math.round(en.strength)}` });
  }

  // secondary -> main hero (hand over troops)
  const main = state.heroes[player.ai.mainHeroId];
  if (role !== 'main' && main && main.id !== hero.id) {
    const give = strengthOf(hero.army) - minStack(hero.army);
    const mainS = strengthOf(main.army);
    const arts = transferableArtifactValue(hero);
    if ((give * GOLD_PER_STRENGTH >= 800 && give >= 0.15 * mainS) || arts >= 1500) {
      const pos = main.townId && state.towns[main.townId] ? state.towns[main.townId].pos : main.pos;
      consider(`meet:${main.id}`, pos, 'meet', give * GOLD_PER_STRENGTH * 0.8 + arts * 0.5, { otherHeroId: main.id });
    }
  }

  // exploration
  if (!best || best.score < 400) {
    const r = 5;
    let bestE = null;
    // near first; when everything within a day is known, anything in the reach table
    for (const maxT of [1, Infinity]) {
      for (const e of reach) {
        if (e.turns > maxT || e.kind !== 'move') continue;
        const n = unexploredAround(ctx, e, r);
        if (n < 6) continue;
        if (findGuard(state, e)) continue;
        const days = Math.max(e.turns, e.cost / maxMP);
        const score = (n * 25) / (days + 0.35);
        if (!bestE || score > bestE.score) bestE = { key: `explore:${posKey(e)}`, pos: { x: e.x, y: e.y, z: e.z || 0 }, kind: 'explore', value: n * 25, score, days };
      }
      if (bestE && !ctx.blacklist.has(`${hero.id}|${bestE.key}`)) break;
      bestE = null;
    }
    if (bestE && (!best || bestE.score > best.score)) best = bestE;
  }
  // nothing to do at all: the main hero breaks out through the cheapest beatable guard; a secondary
  // hero fetches a garrison for the main hero, or explores the last corners
  if (!best && role === 'main' && !ctx.noCombat) best = breakout(ctx, hero, byKey, maxMP);
  if (!best && role === 'main') best = guardTarget(ctx, hero, byKey, maxMP);
  if (!best && role !== 'main') best = feedTarget(ctx, hero, byKey, maxMP) || lastCorners(ctx, hero, reach, maxMP) || guardTarget(ctx, hero, byKey, maxMP);
  return best;
}

/** Nothing else to do and an enemy hero lurks near one of our towns: stand guard inside it. */
function guardTarget(ctx, hero, byKey, maxMP) {
  let best = null;
  for (const town of Object.values(ctx.state.towns)) {
    if (town.owner !== ctx.playerId || town.garrisonHero || !enemyNear(ctx, town)) continue;
    if (town.visitingHero && town.visitingHero !== hero.id) continue;
    const days = hero.townId === town.id ? 0 : daysTo(byKey, town.pos, maxMP);
    if (!Number.isFinite(days)) continue;
    if (!best || days < best.days) best = { key: `town:${town.id}`, pos: { ...town.pos }, kind: 'guard', value: 300, score: 300 / (days + 0.35), days, townId: town.id };
  }
  return best;
}

/** Own town (not the main hero's) whose garrison is worth carrying to the main hero. */
function feedTarget(ctx, hero, byKey, maxMP) {
  const { state, player } = ctx;
  const main = state.heroes[player.ai.mainHeroId];
  if (!main || main.id === hero.id) return null;
  let best = null;
  for (const town of Object.values(state.towns)) {
    if (town.owner !== ctx.playerId || town.garrisonHero || main.townId === town.id) continue;
    if (town.visitingHero && town.visitingHero !== hero.id) continue;
    if (ctx.threats[town.id] || enemyNear(ctx, town)) continue;
    const v = strengthOf(town.garrison) * GOLD_PER_STRENGTH;
    if (v < 600) continue;
    const key = `town:${town.id}`;
    if (ctx.blacklist.has(`${hero.id}|${key}`)) continue;
    const days = hero.townId === town.id ? 0 : daysTo(byKey, town.pos, maxMP);
    if (!Number.isFinite(days)) continue;
    const score = (v * 0.3) / (days + 0.35);
    if (!best || score > best.score) best = { key, pos: { ...town.pos }, kind: 'feed', value: v * 0.3, score, days, townId: town.id };
  }
  return best;
}

/** Any reachable tile next to a little unexplored ground (the regular exploration wants 6+ tiles). */
function lastCorners(ctx, hero, reach, maxMP) {
  let best = null;
  for (const e of reach) {
    if (e.kind !== 'move') continue;
    const n = unexploredAround(ctx, e, 4);
    if (n < 2) continue;
    if (findGuard(ctx.state, e)) continue;
    const key = `explore:${posKey(e)}`;
    if (ctx.blacklist.has(`${hero.id}|${key}`)) continue;
    const days = Math.max(e.turns, e.cost / maxMP);
    const score = (n * 15) / (days + 0.35);
    if (!best || score > best.score) best = { key, pos: { x: e.x, y: e.y, z: e.z || 0 }, kind: 'explore', value: n * 15, score, days };
  }
  return best;
}

function breakout(ctx, hero, byKey, maxMP) {
  const { state, playerId } = ctx;
  let best = null;
  for (const obj of candidates(ctx)) {
    if (obj.defId !== 'monster' || !state.map.objects[obj.id]) continue;
    const e = byKey.get(posKey(obj.pos));
    if (!e || !isExplored(state, playerId, obj.pos)) continue;
    const key = `obj:${obj.id}`;
    if (ctx.blacklist.has(`${hero.id}|${key}`) || avoided(ctx, key, heroStrength(state, hero))) continue;
    let ev;
    try { ev = evaluateMonster(state, hero, obj); } catch { continue; }
    const army = monsterArmy(obj, ev.ratio);
    const j = judgeNeutralFight(ctx, hero, army, monsterStrength(obj), `mon:${obj.id}`);
    if (!j.win || j.lossFrac > 0.5) continue;
    const days = Math.max(e.turns, e.cost / maxMP);
    if (!best || j.lossStrength < best.loss) best = { key, pos: { ...obj.pos }, kind: 'monster', value: 300, score: 300 / (days + 0.35), days, loss: j.lossStrength, note: 'breakout' };
  }
  return best;
}

/** A fight lost recently (`player.ai.avoid`) that this hero is not clearly stronger for. */
function avoided(ctx, key, ours) {
  const lost = ctx.player.ai.avoid?.[key];
  return !!lost && lost.until > ctx.state.turn && ours < lost.strength * 1.5;
}

/**
 * What taking a town is worth: its income for ~2 weeks plus its dwellings (growth), more for an
 * enemy town (he loses it), a little more when it is his last one. An empty village with nothing
 * built is worth little more than a good treasure, a developed capital far more.
 */
export function townValue(ctx, town) {
  let income = 500;
  try { income = getTownIncome(town).gold || 500; } catch { /* default */ }
  const dwellings = (town.buildings || []).filter((b) => b.includes('_dwelling_')).length;
  let v = 4000 + income * 10 + dwellings * 1000;
  if (town.owner != null) {
    v *= 1.3;
    if ((ctx.state.players[town.owner]?.towns || []).length <= 1) v *= 1.2;
  }
  return Math.min(40000, v);
}

/** Town positions are common knowledge from Normal up (the original AI ignores the fog for towns). */
function knowsTown(ctx, town) {
  return ctx.knobs.knowTowns || isExplored(ctx.state, ctx.playerId, town.pos);
}

/**
 * Campaigns against other players' towns and heroes start on day `attackFromDay` (difficulty knob);
 * before that only targets within today's reach are taken (opportunities, no early rushes).
 */
function mayAttackPlayers(ctx, days) {
  return (ctx.state.turn || 1) >= ctx.knobs.attackFromDay || (ctx.knobs.opportunist && days < 1);
}

function daysTo(byKey, pos, maxMP) {
  const e = byKey.get(posKey(pos));
  return e ? Math.max(e.turns, e.cost / maxMP) : Infinity;
}

function isAlly(ctx, owner) {
  if (owner == null || owner === ctx.playerId) return false;
  const me = ctx.player.team;
  return me != null && ctx.state.players[owner]?.team === me;
}

/**
 * Sieges of towns outside the reach table (path-found; at most 3 nearest candidates a day).
 * `push(target)` receives `{key, pos, kind:'siege', value, score, days, townId, far:true}`.
 */
function farTowns(ctx, hero, ours, byKey, maxMP, push) {
  const { state } = ctx;
  const list = [];
  for (const town of Object.values(state.towns)) {
    if (town.owner === ctx.playerId || isAlly(ctx, town.owner) || byKey.has(posKey(town.pos))) continue;
    if (town.owner != null && !mayAttackPlayers(ctx, Infinity)) continue;
    if (!knowsTown(ctx, town) || (town.pos.z || 0) !== (hero.pos.z || 0) && !ctx.knobs.knowTowns) continue;
    const def = townDefense(state, town);
    const est = estimate(ours, def, town.owner == null ? ctx.knobs.minRatio + 0.2 : ctx.knobs.attackRatio);
    if (def > 0 && !est.win) continue;
    list.push({ town, est, d: chebyshev(hero.pos, town.pos) });
  }
  list.sort((a, b) => a.d - b.d);
  for (const { town, est } of list.slice(0, 3)) {
    const key = `town:${town.id}`;
    if (ctx.blacklist.has(`${hero.id}|${key}`)) continue;
    let found = null;
    try { found = findPath(state, hero.id, town.pos); } catch { found = null; }
    if (!found) {
      // no free road: clear the first monster guarding the way there (when it is in reach and beatable)
      const g = routeGuard(ctx, hero, town.pos);
      const e = g && byKey.get(posKey(g.pos));
      if (!e || ctx.blacklist.has(`${hero.id}|obj:${g.id}`) || avoided(ctx, `obj:${g.id}`, ours)) continue;
      let ev;
      try { ev = evaluateMonster(state, hero, g); } catch { continue; }
      const j = ev.outcome === 'flee' || ev.outcome === 'join' ? { win: true, lossFrac: 0, lossStrength: 0 }
        : judgeNeutralFight(ctx, hero, monsterArmy(g, ev.ratio), monsterStrength(g), `mon:${g.id}`);
      if (!j.win || j.lossFrac > 0.5) continue;
      const days = Math.max(e.turns, e.cost / maxMP) + chebyshev(g.pos, town.pos) * 150 / maxMP;
      const value = (townValue(ctx, town) - est.lossStrength * GOLD_PER_STRENGTH) * 0.6 - j.lossStrength * GOLD_PER_STRENGTH;
      if (value <= 0) continue;
      push({ key: `obj:${g.id}`, pos: { ...g.pos }, kind: 'monster', value, score: value * 0.8 * noise(ctx) / (days + 0.35), days, note: 'gate', gate: true });
      continue;
    }
    const days = Math.max(found.turns, found.cost / maxMP);
    const value = townValue(ctx, town) - est.lossStrength * GOLD_PER_STRENGTH;
    if (value <= 0) continue;
    // far marches are less certain (the defence grows meanwhile)
    const score = value * 0.8 * noise(ctx) / (days + 0.35);
    push({ key, pos: { ...town.pos }, kind: 'siege', value, score, days, townId: town.id, far: true });
  }
}

/**
 * First wandering monster guarding a straight walk (8-way BFS over passable land, objects ignored)
 * from the hero to `dest` on the same level, or null.
 */
export function routeGuard(ctx, hero, dest) {
  const { state } = ctx;
  const z = hero.pos.z || 0;
  if ((dest.z || 0) !== z) return null;
  const { width, height } = state.map;
  const tiles = state.map.tiles[z];
  const start = hero.pos.y * width + hero.pos.x;
  const goal = dest.y * width + dest.x;
  const prev = new Int32Array(width * height).fill(-1);
  prev[start] = start;
  const queue = [start];
  const free = (x, y) => {
    const t = tiles[y]?.[x];
    if (!t || t.blocked) return false;
    try { const ter = getTerrain(t.t); return ter.passable && !ter.water; } catch { return false; }
  };
  for (let qi = 0; qi < queue.length && prev[goal] < 0; qi++) {
    const u = queue[qi];
    const ux = u % width;
    const uy = (u - ux) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = ux + dx;
        const y = uy + dy;
        if ((!dx && !dy) || x < 0 || y < 0 || x >= width || y >= height) continue;
        const v = y * width + x;
        if (prev[v] >= 0 || (v !== goal && !free(x, y))) continue;
        prev[v] = u;
        queue.push(v);
      }
    }
  }
  if (prev[goal] < 0) return null;
  const path = [];
  for (let v = goal; v !== start; v = prev[v]) path.push(v);
  path.reverse();
  for (const v of path) {
    const x = v % width;
    const g = findGuard(state, { x, y: (v - x) / width, z });
    if (g) return g;
  }
  return null;
}

/** Strongest enemy hero that can reach `pos` within about a day. */
export function dangerAt(enemies, pos, excludeHeroId = null) {
  let d = 0;
  for (const en of enemies) {
    if (en.hero.id === excludeHeroId) continue;
    if (chebyshev(en.hero.pos, pos) <= en.reach) d = Math.max(d, en.potential ?? en.strength);
  }
  return d;
}

function transferableArtifactValue(hero) {
  let v = 0;
  for (const e of getEquippedArtifacts(hero)) {
    const def = getArtifact(e.id);
    if (!def.noTransfer && !def.noBackpack) v += def.cost || 0;
  }
  for (const e of hero.artifacts?.backpack || []) {
    const def = getArtifact(entryId(e));
    if (!def.noTransfer) v += def.cost || 0;
  }
  return v;
}

function minStack(army) {
  let m = Infinity;
  for (const s of army) if (s) m = Math.min(m, getCreature(s.creatureId).aiValue);
  return m === Infinity ? 0 : m;
}

