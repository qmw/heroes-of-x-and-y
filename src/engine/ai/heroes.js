// AI hero phase: roles, the per-hero plan/move loop, meetings, adventure spells.
import { getSpell } from '../../data/spells.js';
import {
  moveHero, findPath, castAdventureSpell, getAdventureSpellCost, getPuzzleProgress, getGrailObject, digForGrail,
} from '../adventure/index.js';
import { swapTownHeroes, buildBoat } from '../town.js';
import { manageArtifacts, handArtifacts } from './artifacts.js';
import { getHeroSpells, tradeArmy } from '../hero.js';
import { resolveAllPendings } from './pendings.js';
import { chooseTarget, verifyTarget, dangerAt, enemyHeroes } from './targets.js';
import { heroStrength, townDefense } from './strength.js';
import { townVisitActions, mergeArmies, garrisonToHero, waterMap } from './towns.js';
import { HERO_STEPS, spend, note, outOfBudget, heroesOf, townsOf, chebyshev, dayMemory } from './context.js';

const samePos = (a, b) => a.x === b.x && a.y === b.y && (a.z || 0) === (b.z || 0);

/** Keep / pick the main (army) hero. */
export function assignMainHero(ctx) {
  const { state, player } = ctx;
  const cur = state.heroes[player.ai.mainHeroId];
  const rate = (h) => heroStrength(state, h) + (h.level || 1) * 50;
  let best = null;
  let bestS = -1;
  for (const h of heroesOf(ctx)) {
    const s = rate(h);
    if (s > bestS) { bestS = s; best = h; }
  }
  // keep the main hero unless another one has clearly become the army (e.g. a hired hero took the garrison)
  if (cur && cur.owner === ctx.playerId && (!best || !best.townId || rate(cur) * 2 >= bestS)) return cur;
  player.ai.mainHeroId = best ? best.id : null;
  return best;
}

function knows(state, hero, spellId) {
  try { return getHeroSpells(state, hero).includes(spellId); } catch { return false; }
}

function manaCost(state, hero, spellId) {
  try { return getAdventureSpellCost(state, hero, getSpell(spellId)); } catch { return Infinity; }
}

/** Fly / Water Walk at the start of the hero's turn when mana allows. */
function castDailySpells(ctx, hero) {
  const { state } = ctx;
  if (!ctx.knobs.spells || hero.inBoat) return;
  for (const id of ['fly', 'water_walk']) {
    if (!knows(state, hero, id)) continue;
    if ((hero.temp || []).some((t) => t.source === `spell:${id}`)) continue;
    const cost = manaCost(state, hero, id);
    if (hero.mana < 2 * cost) continue;
    if (!spend(ctx)) return;
    const r = castAdventureSpell(state, hero.id, id);
    if (r.ok) { ctx.report.spells++; ctx.invalidate?.(); return; }
  }
}

function tryTownPortal(ctx, hero, target) {
  const { state } = ctx;
  if (!ctx.knobs.spells || !target.townId || target.days < 1) return false;
  if (!knows(state, hero, 'town_portal')) return false;
  if (hero.mana < manaCost(state, hero, 'town_portal')) return false;
  const town = state.towns[target.townId];
  if (!town || (town.visitingHero && town.visitingHero !== hero.id)) return false;
  if (!spend(ctx)) return false;
  ctx.portalTownId = town.id;
  const r = castAdventureSpell(state, hero.id, 'town_portal', { townId: town.id });
  resolveAllPendings(ctx);
  ctx.portalTownId = null;
  if (r.ok && hero.townId === town.id) {
    ctx.report.spells++;
    return true;
  }
  return false;
}

/** Hand the secondary hero's troops to the main hero when they stand next to each other / share a town. */
function handOver(ctx, hero, main) {
  const { state } = ctx;
  if (!main || !state.heroes[hero.id] || !state.heroes[main.id]) return;
  const near = (hero.townId && hero.townId === main.townId) || chebyshev(hero.pos, main.pos) <= 1;
  if (!near) return;
  mergeArmies(ctx, hero.army, main.army, (i, j, count) => tradeArmy(state, hero.id, i, main.id, j, count), true);
  handArtifacts(ctx, hero, main);
}

/** Water map and nothing left to do on this shore: build a boat in a near own shipyard town. */
function tryBuildBoat(ctx, hero) {
  const { state } = ctx;
  if (ctx.boatBuilt || dayMemory(ctx).boat || hero.inBoat || !waterMap(ctx)) return false;
  const free = Object.values(state.map.objects).some((o) => o.defId === 'boat' && !o.data?.heroId
    && (o.data?.owner == null || o.data.owner === ctx.playerId) && chebyshev(o.pos, hero.pos) <= 12);
  if (free) return false;
  const gold = ctx.player.resources.gold || 0;
  if (gold < 1000 + 1500 || (ctx.player.resources.wood || 0) < 10) return false;
  for (const town of townsOf(ctx)) {
    if (chebyshev(town.pos, hero.pos) > 10) continue;
    if (!town.buildings.includes('shipyard') && !town.buildings.some((b) => b.endsWith('_shipyard'))) continue;
    if (!spend(ctx)) return false;
    const r = buildBoat(state, town.id);
    if (r.ok) {
      ctx.boatBuilt = true;
      dayMemory(ctx).boat = true;
      ctx.report.boats = (ctx.report.boats || 0) + 1;
      trace(ctx, `${hero.id} built a boat at ${town.id}`);
      ctx.invalidate();
      return true;
    }
    note(ctx, 'boat_failed', r.error);
  }
  ctx.boatBuilt = true; // tried once this turn
  return false;
}

/** Heroes left in a garrison row step out again once the danger is gone. */
export function releaseGarrisons(ctx) {
  const { state } = ctx;
  for (const town of townsOf(ctx)) {
    const gh = town.garrisonHero ? state.heroes[town.garrisonHero] : null;
    if (!gh || gh.owner !== ctx.playerId) continue;
    // a visiting hero swaps in; a hero that has held long enough steps out despite the threat
    if (ctx.threats[town.id] && !holdExpired(ctx, gh, town)) continue;
    if (!spend(ctx)) return;
    const r = swapTownHeroes(state, town.id);
    if (r.ok) trace(ctx, `${gh.id} leaves the garrison of ${town.id}`);
    else note(ctx, 'unswap_failed', r.error);
  }
}

function holdExpired(ctx, hero, town) {
  const h = ctx.player.ai.hold?.[hero.id];
  return !!h && h.townId === town.id && h.last === ctx.state.turn - 1 && h.days >= ctx.knobs.holdDays;
}

/** Should the hero stay where he is (defending a threatened town)? */
function holding(ctx, hero, role) {
  const { state } = ctx;
  if (!hero.townId) return false;
  const threat = ctx.threats[hero.townId];
  if (!threat) return false;
  const town = state.towns[hero.townId];
  if (!town) return false;
  // townDefense already counts the visiting hero; holding only makes sense when it can repel the attack
  if (!(townDefense(state, town) >= threat * 0.8 && heroStrength(state, hero) < threat * ctx.knobs.minRatio)) return false;
  // an attacker that keeps standing off for a few days is deterred: do not turtle forever
  const mem = ctx.player.ai;
  mem.hold ??= {};
  const h = mem.hold[hero.id];
  const days = h && h.townId === town.id && h.last === state.turn - 1 ? h.days + 1 : (h && h.last === state.turn ? h.days : 1);
  mem.hold[hero.id] = { townId: town.id, last: state.turn, days };
  return days <= ctx.knobs.holdDays;
}

/** Play one hero for the rest of the day. */
export function playHero(ctx, hero) {
  const { state, player } = ctx;
  const heroId = hero.id;
  castDailySpells(ctx, hero);
  for (let step = 0; step < HERO_STEPS; step++) {
    const h = state.heroes[heroId];
    if (!h || h.owner !== ctx.playerId || outOfBudget(ctx)) return;
    if (h.movePoints <= 0) return;
    const role = player.ai.mainHeroId === heroId ? 'main' : 'secondary';
    if (holding(ctx, h, role)) {
      const town = state.towns[h.townId];
      townVisitActions(ctx, town);
      // defend from the garrison row: the hero absorbs the garrison and fights behind the walls
      if (!town.garrisonHero && spend(ctx)) {
        garrisonToHero(ctx, town);
        const r = swapTownHeroes(state, town.id);
        if (r.ok) { ctx.report.swaps = (ctx.report.swaps || 0) + 1; trace(ctx, `${heroId} garrisons ${town.id}`); }
      }
      return;
    }
    // standing on the solved grail spot: dig with a full day of movement, else wait for tomorrow
    const grailInfo = ctx.grailInfo || (ctx.grailInfo = getPuzzleProgress(state, ctx.playerId));
    if (grailInfo.grailPos && getGrailObject(state) && samePos(h.pos, grailInfo.grailPos)) {
      if (h.movePoints >= h.maxMovePoints && spend(ctx)) {
        const r = digForGrail(state, heroId);
        trace(ctx, `${heroId} digs: ${r.ok ? (r.found ? 'grail!' : 'nothing') : r.error}`);
        ctx.grailInfo = null;
        ctx.invalidate();
      }
      return;
    }
    let target;
    try {
      // the full horizon once a day; after the first target was reached a shorter one (speed)
      const t0 = Date.now();
      target = chooseTarget(ctx, h, role, step === 0 ? null : 1);
      ctx.report.planMs += Date.now() - t0;
    } catch (e) {
      note(ctx, 'plan_failed', e.message);
      return;
    }
    if (!target || (target.kind === 'explore' && target.score < 300)) {
      if (tryBuildBoat(ctx, h)) continue;
    }
    if (!target) {
      trace(ctx, `${heroId} idle mp=${h.movePoints}`);
      if (step === 0) {
        ctx.report.idle = (ctx.report.idle || 0) + 1;
        if (role !== 'main') ctx.report.idleSecondary = (ctx.report.idleSecondary || 0) + 1;
      }
      return;
    }
    ctx.report.kinds ??= {};
    ctx.report.kinds[target.kind] = (ctx.report.kinds[target.kind] || 0) + 1;
    trace(ctx, `${heroId}(${role}) -> ${target.key} ${target.kind} v=${Math.round(target.value)} d=${target.days.toFixed(2)}${target.note ? ' ' + target.note : ''}`);
    player.ai.targets[heroId] = target.key;
    if ((target.kind === 'own_town' || target.kind === 'defend') && tryTownPortal(ctx, h, target)) {
      townVisitActions(ctx, state.towns[target.townId]);
      ctx.invalidate();
      continue;
    }
    if (target.kind === 'guard' && h.townId === target.townId) {
      // guard from the garrison row: the visiting slot stays free for the main hero
      const town = state.towns[target.townId];
      if (!town.garrisonHero && spend(ctx)) swapTownHeroes(state, town.id);
      trace(ctx, `${heroId} stands guard in ${target.townId}`);
      return;
    }
    if (target.kind === 'feed' && h.townId === target.townId) {
      // already inside: take the garrison along to the main hero (a `meet` target follows)
      garrisonToHero(ctx, state.towns[target.townId]);
      trace(ctx, `${heroId} takes the garrison of ${target.townId} to the main hero`);
      ctx.blacklist.add(`${heroId}|${target.key}`);
      continue;
    }
    if (target.viaDD) {
      if (!spend(ctx)) return;
      const r = castAdventureSpell(state, heroId, 'dimension_door', target.viaDD);
      resolveAllPendings(ctx);
      ctx.invalidate();
      if (r.ok && state.heroes[heroId] && samePos(state.heroes[heroId].pos, target.viaDD)) {
        ctx.report.spells++;
        trace(ctx, `${heroId} dimension door -> ${target.viaDD.x},${target.viaDD.y}`);
      } else {
        ctx.blacklist.add(`${heroId}|${target.key}`);
      }
      continue;
    }
    if (ctx.knobs.simulate && !verifyTarget(ctx, h, role, target)) {
      trace(ctx, `${heroId} drops ${target.key} (simulation)`);
      ctx.blacklist.add(`${heroId}|${target.key}`);
      continue;
    }
    // where will the hero stand tonight? never next to a stronger enemy hero (unless retreating)
    let found = null;
    try { found = findPath(state, heroId, target.pos); } catch { found = null; }
    if (!found || !found.path.length) {
      ctx.blacklist.add(`${heroId}|${target.key}`);
      continue;
    }
    if (target.kind !== 'retreat' && target.kind !== 'defend' && target.kind !== 'own_town' && target.kind !== 'feed' && target.kind !== 'guard') {
      const today = found.steps.filter((st) => st.turn === 0);
      const stop = today.length ? today[today.length - 1] : h.pos;
      const enemies = ctx.enemies || (ctx.enemies = enemyHeroes(ctx));
      if (dangerAt(enemies, stop, target.kind === 'enemy_hero' ? target.otherHeroId : null) > heroStrength(state, h)) {
        trace(ctx, `${heroId} avoids ${target.key} (danger)`);
        ctx.blacklist.add(`${heroId}|${target.key}`);
        continue;
      }
    }
    const before = { x: h.pos.x, y: h.pos.y, z: h.pos.z || 0, mp: h.movePoints, army: JSON.stringify(h.army), strength: heroStrength(state, h) };
    const ownerBefore = target.townId ? state.towns[target.townId]?.owner ?? null : null;
    const objBefore = target.key.startsWith('obj:') ? !!state.map.objects[target.key.slice(4)] : null;
    if (!spend(ctx)) return;
    let r;
    try {
      const t0 = Date.now();
      r = moveHero(state, heroId, target.pos, { path: found.path });
      ctx.report.moveMs += Date.now() - t0;
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    ctx.report.moves++;
    if (r.events) {
      let started = false;
      let finished = false;
      for (const e of r.events) {
        if (e.type === 'combat') {
          started = true;
          if (e.defenderHeroId != null || e.townId != null) {
            // hero battles are always against another player; sieges: the owner before the battle
            const owner = e.townId != null ? (e.townId === target.townId ? ownerBefore : -1) : -1;
            if (owner == null) ctx.report.neutralSieges = (ctx.report.neutralSieges || 0) + 1;
            else if (owner !== ctx.playerId) ctx.report.attacks = (ctx.report.attacks || 0) + 1;
          }
        }
        if (e.type === 'combat_finished') {
          finished = true;
          ctx.report.fights++;
          if (e.winner !== 'attacker') {
            ctx.report.lost = (ctx.report.lost || 0) + 1;
            // remember: nobody tries that one again for a week unless clearly stronger than this hero was
            if (e.kind === 'adv_monster' || e.kind === 'adv_object') {
              player.ai.avoid ??= {};
              player.ai.avoid[target.key] = { until: state.turn + 7, strength: Math.round(before.strength) };
            }
          }
          trace(ctx, `${heroId} battle (${e.kind}${e.defenderHeroId ? ' ' + e.defenderHeroId : ''}${e.townId ? ' ' + e.townId : ''}): ${e.winner} won in ${e.rounds} rounds`);
          if (e.rounds >= 100) ctx.report.timeouts = (ctx.report.timeouts || 0) + 1;
        }
      }
      // the adventure engine swallows a failed quick combat (e.g. no combat engine loaded):
      // stop picking fights for the rest of the turn
      if (started && !finished && !state.combat) {
        ctx.noCombat = true;
        note(ctx, 'combat_not_resolved', target.key);
      }
    }
    if (state.combat) {
      // a human defends: the battle waits for him, the rest of the turn is resumed afterwards
      trace(ctx, `${heroId} attacks a human player: turn interrupted`);
      ctx.report.interrupted = true;
      return;
    }
    resolveAllPendings(ctx);
    ctx.invalidate();
    const after = state.heroes[heroId];
    if (!r.ok) {
      note(ctx, 'move_failed', `${target.key} ${r.error}`);
      ctx.blacklist.add(`${heroId}|${target.key}`);
      if (r.error === 'no_movement_points') return;
      continue;
    }
    if (!after) return; // died
    if (after.townId && state.towns[after.townId]?.owner === ctx.playerId) {
      townVisitActions(ctx, state.towns[after.townId]);
      if (target.kind === 'feed' && after.townId === target.townId) {
        garrisonToHero(ctx, state.towns[after.townId]);
        trace(ctx, `${heroId} takes the garrison of ${after.townId} to the main hero`);
        ctx.blacklist.add(`${heroId}|${target.key}`);
      }
    }
    if (target.kind === 'meet') handOver(ctx, after, state.heroes[target.otherHeroId]);
    if (state.heroes[heroId] && (after.artifacts?.backpack || []).length) manageArtifacts(ctx, after);
    const objAfter = objBefore != null ? !!state.map.objects[target.key.slice(4)] : null;
    const progressed = after.pos.x !== before.x || after.pos.y !== before.y || (after.pos.z || 0) !== before.z
      || after.movePoints !== before.mp || JSON.stringify(after.army) !== before.army || objBefore !== objAfter;
    if (!progressed) {
      ctx.blacklist.add(`${heroId}|${target.key}`);
      continue;
    }
    if (r.arrived || r.stopped === 'interaction' || r.stopped === 'guard' || r.stopped === 'event') {
      // arrived without consuming the object (refused visit etc.): do not come back for a week
      if (r.arrived && objBefore && objAfter && target.kind === 'object') {
        const cand = state.map.objects[target.key.slice(4)];
        if (cand && cand.pos.x === after.pos.x && cand.pos.y === after.pos.y) markSkip(ctx, heroId, target.key);
        else if (cand && chebyshev(cand.pos, after.pos) <= 1) markSkip(ctx, heroId, target.key);
      }
      if (player.ai.targets[heroId] === target.key) delete player.ai.targets[heroId];
    }
    if (r.stopped === 'out_of_movement') return;
  }
}

function trace(ctx, line) {
  if (ctx.report.trace.length < 200) ctx.report.trace.push(line);
}

function markSkip(ctx, heroId, key) {
  const p = ctx.player.ai;
  p.skip ??= {};
  // revisitable objects (mines we now own, dwellings, weekly ones) are filtered by value anyway;
  // the skip only protects against refused visits repeating every day
  p.skip[`${heroId}|${key}`] = ctx.state.turn + 7;
}

export function cleanupMemory(ctx) {
  const p = ctx.player.ai;
  const { state } = ctx;
  if (p.skip) for (const k of Object.keys(p.skip)) if (p.skip[k] <= state.turn) delete p.skip[k];
  for (const id of Object.keys(p.targets || {})) if (!state.heroes[id]) delete p.targets[id];
  if (p.avoid) for (const k of Object.keys(p.avoid)) if (p.avoid[k].until <= state.turn) delete p.avoid[k];
  if (p.hold) for (const id of Object.keys(p.hold)) if (!state.heroes[id] || p.hold[id].last < state.turn - 1) delete p.hold[id];
}
