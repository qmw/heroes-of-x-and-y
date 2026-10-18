// Hero movement: step cost, step classification, multi-day path-finding, moveHero, boats.
// Spec: docs/mechanics/adventure-objects.md §1.1, §2.1, §7.2 and docs/mechanics/spells.md §13.6-13.7.
import { getTerrain, stepMoveCost, DIAGONAL_FACTOR } from '../../data/terrain.js';
import { getMapObject } from '../../data/mapObjects.js';
import { getFaction } from '../../data/factions.js';
import { getSpell } from '../../data/spells.js';
import { hasArtifact } from '../artifacts.js';
import { hasPending } from '../pending.js';
import { deps, sumField } from './deps.js';
import { getTile, getBoatOfHero, relocateObject } from './map.js';
import { revealAround } from './fog.js';
import { DIRS, samePos, copyPos, ok, fail, areAllies, getPlayer, nativeTerrainsOfArmy, posKey } from './util.js';
import { teleportTarget, hasKey } from './transport.js';
import { interactWithObject, visitTownTile, meetOrFightHero, triggerGuardAt } from './visit.js';

function factionNative(faction) {
  if (!faction || faction === 'neutral') return null;
  return getFaction(faction).nativeTerrain || null;
}

/** Highest mastery (0..3) of a `fly` / `water_walk` bonus on the hero, or -1. */
function travelMastery(bonuses, type) {
  let best = -1;
  for (const b of bonuses) if (b.type === type) best = Math.max(best, b.mastery ?? 0);
  return best;
}

/** Daily maximum of the hero in the given mode (land / sea), whatever mode it is in now. */
export function maxMovePointsFor(state, hero, sailing) {
  const was = hero.inBoat;
  hero.inBoat = !!sailing;
  const v = deps.getMaxMovePoints(state, hero);
  hero.inBoat = was;
  return v;
}

/**
 * Everything the cost / classification functions need about one hero, plus per-call indexes
 * (hero positions, guarded tiles). Rebuild after the map changes.
 */
export function getMoveContext(state, hero) {
  const bonuses = deps.getHeroBonuses(state, hero);
  const pathfinding = deps.getSkillLevel(hero, 'pathfinding');
  // Pathfinding itself is a flat reduction by mastery; only OTHER sources scale the remaining penalty.
  const reduction = sumField(bonuses.filter((b) => b.source !== 'skill:pathfinding'), 'terrain_penalty_reduction', 'percent');
  const fly = travelMastery(bonuses, 'fly');
  const waterWalk = travelMastery(bonuses, 'water_walk');
  const heroes = {};
  for (const h of Object.values(state.heroes)) if (!h.garrisoned && h.id !== hero.id) heroes[posKey(h.pos)] = h;
  const guarded = {};
  for (const o of Object.values(state.map.objects)) {
    if (o.defId !== 'monster') continue;
    const mt = getTile(state.map, o.pos);
    const water = mt ? getTerrain(mt.t).water : false;
    for (const d of DIRS) {
      const p = { x: o.pos.x + d.dx, y: o.pos.y + d.dy, z: o.pos.z || 0 };
      const t = getTile(state.map, p);
      if (!t || getTerrain(t.t).water !== water) continue;
      guarded[posKey(p)] ??= o.id;
    }
  }
  return {
    hero, pathfinding, reductionPercent: Math.min(100, reduction),
    nativeTerrains: nativeTerrainsOfArmy(hero.army, factionNative),
    fly, waterWalk,
    flyFactor: fly >= 0 ? 1 + getSpell('fly').power[fly] / 100 : 1,
    waterWalkFactor: waterWalk >= 0 ? 1 + getSpell('water_walk').power[waterWalk] / 100 : 1,
    // Admiral's Hat: its `free_boarding` bonus (any source) makes boarding / landing free
    hat: hasArtifact(hero, 'admirals_hat') || bonuses.some((b) => b.type === 'free_boarding'),
    maxLand: maxMovePointsFor(state, hero, false), maxSea: maxMovePointsFor(state, hero, true),
    heroes, guarded,
  };
}

/**
 * Cost of one step. @returns {{cost:number, orth:number}} `orth` = cost of the same step if it
 * were orthogonal (for the last-step rule).
 */
export function getStepCost(state, ctx, from, to, sailing) {
  const tf = getTile(state.map, from);
  const tt = getTile(state.map, to);
  const diagonal = from.x !== to.x && from.y !== to.y;
  let orth;
  if (sailing) {
    orth = stepMoveCost(tf, tt, false, { sailing: true });
  } else {
    const fromWater = getTerrain(tf.t).water;
    const base = fromWater || (ctx.fly >= 0 && tf.blocked)
      ? 100
      : stepMoveCost(tf, tt, false, { pathfinding: ctx.pathfinding, nativeTerrains: ctx.nativeTerrains, reductionPercent: ctx.reductionPercent });
    if (ctx.fly >= 0) orth = Math.floor(base * ctx.flyFactor);
    else if (fromWater) orth = Math.floor(base * ctx.waterWalkFactor);
    else orth = base;
  }
  return { cost: diagonal ? Math.floor(orth * DIAGONAL_FACTOR) : orth, orth };
}

/** Points left after a step under the last-step rule, or -1 when it cannot be afforded. */
export function spendStep(points, cost, orth, diagonal) {
  if (points >= cost) return points - cost;
  if (diagonal && points >= orth && points > 0) return 0;
  return -1;
}

/**
 * What happens when the hero tries to step from `from` onto `to`.
 * kind: 'blocked' | 'move' | 'transit' (flying / water-walking over a tile it cannot stop on) |
 *       'enter' (walk onto an entrance, then visit) | 'adjacent' (interact without moving) |
 *       'hero' | 'town' | 'board' | 'land'.
 * `terminal`: the path cannot continue past this step.
 */
export function classifyStep(state, ctx, from, to, sailing, isDest = true) {
  const hero = ctx.hero;
  const tile = getTile(state.map, to);
  if (!tile) return { kind: 'blocked' };
  const ter = getTerrain(tile.t);
  if (!ter.passable) return { kind: 'blocked' };
  const other = ctx.heroes[posKey(to)] || null;
  const obj = tile.obj ? state.map.objects[tile.obj] : null;
  const def = obj ? getMapObject(obj.defId) : null;
  const flying = ctx.fly >= 0 && !sailing;
  const transit = () => (flying ? { kind: 'transit' } : { kind: 'blocked' });

  if (sailing) {
    if (!ter.water) {
      if (tile.blocked || other || (obj && (def.blocking || def.visitable))) return { kind: 'blocked' };
      const here = getTile(state.map, from);
      if (here && here.obj && state.map.objects[here.obj]?.defId !== 'boat') return { kind: 'blocked' }; // boat cannot be left on an object tile
      return { kind: 'land' };
    }
    if (tile.blocked) return { kind: 'blocked' };
    if (other) return other.inBoat ? heroStep(state, hero, other, obj) : { kind: 'blocked' };
    if (!obj) return { kind: 'move' };
    if (def.effect.type === 'boat') return { kind: 'blocked' };
    return objectStep(state, hero, obj, def, from, to, isDest);
  }

  if (ter.water) {
    if (obj && def.effect.type === 'boat' && !other && !obj.data.heroId) return { kind: 'board', obj };
    if (flying) return { kind: 'transit' };
    if (ctx.waterWalk >= 0 && !tile.blocked && !obj && !other) return { kind: 'transit' };
    return { kind: 'blocked' };
  }
  if (tile.blocked) return transit();
  if (other) {
    if (!isDest) return transit();
    return other.inBoat ? { kind: 'blocked' } : heroStep(state, hero, other, obj);
  }
  if (!obj) return { kind: 'move' };
  if (!isDest && flying && (def.blocking || def.visitable) && def.effect.type !== 'event') return { kind: 'transit' };
  return objectStep(state, hero, obj, def, from, to, isDest);
}

function heroStep(state, hero, other, obj) {
  if (!areAllies(state, hero.owner, other.owner) && obj && obj.defId === 'sanctuary') return { kind: 'blocked' };
  // a hero standing in a town (its visiting hero): attacking the entrance is a siege, meeting an ally
  // is handled by the town visit too (visitTownTile)
  if (obj && getMapObject(obj.defId).effect.type === 'town') return { kind: 'town', obj, terminal: true };
  return { kind: 'hero', other, terminal: true };
}

function objectStep(state, hero, obj, def, from, to, isDest) {
  const fx = def.effect;
  if (def.interact === 'adjacent') return { kind: 'adjacent', obj, terminal: true };
  if (def.interact === 'none') return def.blocking ? { kind: 'blocked' } : { kind: 'move' };
  // 'enter'
  if (def.blocking && def.size[1] >= 2 && from.y < to.y) return { kind: 'blocked' }; // never from above
  if (fx.type === 'town') return { kind: 'town', obj, terminal: true };
  if (fx.type === 'prison') return { kind: 'adjacent', obj, terminal: true }; // the freed hero takes the tile
  if (fx.type === 'event') return { kind: 'move', obj };
  if (!def.blocking) return isDest ? { kind: 'enter', obj, terminal: false } : { kind: 'move' }; // signs: walk over freely
  if (fx.type === 'border_guard' && fx.permanent) {
    if (!hasKey(state, hero.owner, fx.color)) return { kind: 'blocked' };
    return { kind: 'enter', obj, terminal: false, pass: true };
  }
  if (fx.type === 'garrison' && obj.owner != null && areAllies(state, obj.owner, hero.owner)) {
    return { kind: 'enter', obj, terminal: false, pass: true };
  }
  if (fx.type === 'teleport') {
    const target = teleportTarget(state, obj, hero, { deterministicOnly: true });
    return { kind: 'enter', obj, terminal: !target, teleportTo: target ? copyPos(target.pos) : null };
  }
  return { kind: 'enter', obj, terminal: true };
}

// ---- path-finding -------------------------------------------------------------------------------

class Heap {
  constructor() { this.a = []; }
  push(key, v) {
    const a = this.a;
    a.push({ key, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const labelKey = (turn, rem) => turn * 1e7 + (1e6 - rem);

/**
 * Dijkstra over (turn, remaining points). Returns the label table keyed by posKey.
 * @param {{x,y,z}|null} dest stop early when reached; also decides transit-vs-interaction for flyers
 */
function search(state, hero, dest, maxTurns) {
  const ctx = getMoveContext(state, hero);
  const start = copyPos(hero.pos);
  const labels = {};
  const heap = new Heap();
  labels[posKey(start)] = { pos: start, turn: 0, rem: hero.movePoints, sailing: !!hero.inBoat, prev: null, kind: 'start', cost: 0, total: 0 };
  heap.push(labelKey(0, hero.movePoints), posKey(start));
  const destKey = dest ? posKey(dest) : null;
  const consider = (fromKey, toPos, lab) => {
    // Transit tiles (flying / water-walking over a tile one cannot stop on) must be left the same
    // day, so they get one label per day; everywhere else the earlier/richer label dominates.
    const k = lab.mustContinue ? `${posKey(toPos)}@${lab.turn}` : posKey(toPos);
    const old = labels[k];
    if (old && (old.turn < lab.turn || (old.turn === lab.turn && (old.rem > lab.rem || (old.rem === lab.rem && old.total <= lab.total))))) return;
    lab.pos = toPos;
    lab.prev = fromKey;
    labels[k] = lab;
    heap.push(labelKey(lab.turn, lab.rem), k);
  };
  while (heap.size) {
    const { key, v: uk } = heap.pop();
    const u = labels[uk];
    if (labelKey(u.turn, u.rem) !== key) continue; // stale
    if (uk === destKey) break;
    // a guarded entrance (monolith / gate in a monster's zone) means a fight first: the path ends there
    if (u.teleportTo && !u.guardStop && !ctx.heroes[posKey(u.teleportTo)]) {
      consider(uk, copyPos(u.teleportTo), { turn: u.turn, rem: u.rem, sailing: u.sailing, kind: 'teleport', cost: 0, total: u.total });
    }
    // A guarded tile ends the walk - except for attacking a monster from it.
    const guardOnly = u.kind !== 'start' && u.terminal && u.guardStop && u.standing;
    if (u.terminal && u.kind !== 'start' && !guardOnly) continue;
    for (const d of DIRS) {
      const to = { x: u.pos.x + d.dx, y: u.pos.y + d.dy, z: u.pos.z };
      const tk = posKey(to);
      const cls = classifyStep(state, ctx, u.pos, to, u.sailing, dest ? tk === destKey : true);
      if (cls.kind === 'blocked') continue;
      if (guardOnly && !(cls.kind === 'adjacent' && cls.obj.defId === 'monster')) continue;
      const diagonal = d.dx !== 0 && d.dy !== 0;
      const { cost, orth } = getStepCost(state, ctx, u.pos, to, u.sailing);
      const max = u.sailing ? ctx.maxSea : ctx.maxLand;
      let turn = u.turn;
      let before = u.rem;
      const special = (cls.kind === 'board' || cls.kind === 'land');
      const affordable = (pts) => (special && !ctx.hat ? (pts >= 1 ? 0 : -1) : spendStep(pts, cost, orth, diagonal));
      let rem = affordable(before);
      if (rem < 0) {
        if (u.mustContinue) continue; // cannot wait for the next day on a transit tile
        turn += 1;
        before = max;
        rem = affordable(before);
        if (rem < 0) continue;
      }
      if (maxTurns != null && turn > maxTurns) continue;
      let sailing = u.sailing;
      if (special) {
        sailing = cls.kind === 'board';
        if (ctx.hat) rem = Math.floor((rem / Math.max(1, max)) * (sailing ? ctx.maxSea : ctx.maxLand));
      }
      const stands = cls.kind !== 'adjacent' && cls.kind !== 'hero';
      const guardedStop = stands && cls.kind !== 'transit' && ctx.guarded[tk] && !(ctx.fly >= 0 && !sailing && dest && tk !== destKey);
      consider(uk, to, {
        turn, rem, sailing, kind: cls.kind, cost: before - rem, total: u.total + (before - rem),
        terminal: !!cls.terminal || !!guardedStop, guardStop: !!guardedStop, mustContinue: cls.kind === 'transit',
        standing: stands && (cls.kind === 'move' || cls.kind === 'land' || (cls.kind === 'enter' && !!cls.pass)),
        teleportTo: cls.teleportTo || null,
      });
      // Starting a crossing may be better tomorrow with full points (it has to be finished in one day).
      if (cls.kind === 'transit' && !u.mustContinue && turn === u.turn && (maxTurns == null || turn + 1 <= maxTurns)) {
        const fresh = spendStep(max, cost, orth, diagonal);
        if (fresh >= 0) {
          consider(uk, to, { turn: turn + 1, rem: fresh, sailing, kind: 'transit', cost: max - fresh, total: u.total + (max - fresh), terminal: false, mustContinue: true, teleportTo: null });
        }
      }
    }
  }
  return labels;
}

/**
 * Cheapest path for the hero to `dest` (which may be an object / hero / town / boat to interact with).
 * @returns {{path: {x,y,z}[], steps: {x,y,z,cost,turn,kind}[], cost: number, turns: number}|null}
 *   `path` excludes the hero's tile and ends at `dest`; `cost` = movement points spent along it
 *   (points wasted while waiting for a new day are not counted); `turns` = extra days needed (0 = today).
 */
export function findPath(state, heroId, dest) {
  const hero = state.heroes[heroId];
  if (!hero) throw new Error(`Unknown hero: ${heroId}`);
  if (!getTile(state.map, dest) || samePos(hero.pos, dest)) return null;
  const d = copyPos(dest);
  const labels = search(state, hero, d, null);
  let lab = labels[posKey(d)];
  if (!lab || lab.mustContinue) return null;
  const steps = [];
  const turns = lab.turn;
  let cost = 0;
  while (lab && lab.prev) {
    steps.unshift({ ...lab.pos, cost: lab.cost, turn: lab.turn, kind: lab.kind });
    cost += lab.cost;
    lab = labels[lab.prev];
  }
  return { path: steps.map((s) => ({ x: s.x, y: s.y, z: s.z })), steps, cost, turns };
}

/**
 * Every tile the hero can reach / interact with within `maxTurns` extra days (default 0 = today).
 * @returns {{x,y,z,cost,turns,kind}[]} (`cost` = points spent to get there)
 */
export function getReachable(state, heroId, maxTurns = 0) {
  const hero = state.heroes[heroId];
  if (!hero) throw new Error(`Unknown hero: ${heroId}`);
  const labels = search(state, hero, null, maxTurns);
  return Object.values(labels)
    .filter((l) => l.prev && !l.mustContinue)
    .map((l) => ({ ...l.pos, cost: l.total, turns: l.turn, kind: l.kind }));
}

// ---- executing a move ---------------------------------------------------------------------------

/** Put the hero on a tile (no cost): fog, boat follows, leaves the town it was in. */
export function placeHero(state, hero, pos, events, extra = {}) {
  const from = copyPos(hero.pos);
  if (hero.townId) deps.leaveTown(state, hero.id);
  hero.pos = copyPos(pos);
  if (hero.inBoat) {
    const boat = getBoatOfHero(state, hero.id);
    if (boat) relocateObject(state, boat, pos, { mark: false });
  }
  if (events) events.push({ type: 'move', heroId: hero.id, from, to: copyPos(pos), ...extra });
  if (hero.owner != null) revealAround(state, hero.owner, hero.pos, deps.getSightRadius(state, hero));
}

function boardBoat(state, hero, boat, events, ctx, cost) {
  const from = copyPos(hero.pos);
  const oldMax = ctx.maxLand;
  const tile = getTile(state.map, boat.pos);
  if (tile.obj === boat.id) tile.obj = null;
  if (hero.townId) deps.leaveTown(state, hero.id);
  boat.data.heroId = hero.id;
  boat.data.owner = hero.owner;
  hero.inBoat = true;
  hero.pos = copyPos(boat.pos);
  if (ctx.hat) hero.movePoints = Math.floor((Math.max(0, hero.movePoints - cost) / Math.max(1, oldMax)) * ctx.maxSea);
  else hero.movePoints = 0;
  hero.maxMovePoints = ctx.maxSea;
  events.push({ type: 'board', heroId: hero.id, boatId: boat.id, from, to: copyPos(hero.pos) });
  revealAround(state, hero.owner, hero.pos, deps.getSightRadius(state, hero));
}

function landHero(state, hero, pos, events, ctx, cost) {
  const from = copyPos(hero.pos);
  const boat = getBoatOfHero(state, hero.id);
  if (boat) {
    boat.data.heroId = null;
    relocateObject(state, boat, from, { mark: true });
  }
  hero.inBoat = false;
  hero.pos = copyPos(pos);
  if (ctx.hat) hero.movePoints = Math.floor((Math.max(0, hero.movePoints - cost) / Math.max(1, ctx.maxSea)) * ctx.maxLand);
  else hero.movePoints = 0;
  hero.maxMovePoints = ctx.maxLand;
  events.push({ type: 'land', heroId: hero.id, boatId: boat ? boat.id : null, from, to: copyPos(pos) });
  revealAround(state, hero.owner, hero.pos, deps.getSightRadius(state, hero));
}

const busy = (state, hero) => !!state.combat || hasPending(state, hero.owner) || !state.heroes[hero.id];

/** Common "may this hero act now" guard for player actions. */
export function checkCanAct(state, heroId) {
  const hero = state.heroes[heroId];
  if (!hero) return fail('no_such_hero');
  if (state.combat) return fail('in_combat');
  if (hasPending(state, hero.owner)) return fail('pending_choice');
  const current = state.players[state.currentPlayer];
  if (current && current.id !== hero.owner) return fail('not_your_turn');
  if (hero.garrisoned) return fail('hero_garrisoned');
  return null;
}

/**
 * Walk the hero towards `dest` step by step: spends movement points, reveals fog, stops when out
 * of points or at the first interaction (visit / combat / pending). `dest` may be any tile
 * `findPath` accepts. `opts.path` (positions) overrides the path-finder.
 * Result: `{ ok, events, pos, arrived, stopped: reason|null }`.
 */
export function moveHero(state, heroId, dest, opts = {}) {
  const err = checkCanAct(state, heroId);
  if (err) return err;
  const hero = state.heroes[heroId];
  let path = opts.path;
  if (!path) {
    const found = findPath(state, heroId, dest);
    if (!found) return fail('no_path');
    path = found.path;
  }
  if (!path.length) return fail('no_path');
  const events = [];
  let stopped = null;
  let moved = 0;

  // A flying / water-walking hero may only stop where it can stand: find the last such step affordable today.
  let limit = path.length - 1;
  {
    const ctx = getMoveContext(state, hero);
    if (ctx.fly >= 0 || ctx.waterWalk >= 0) {
      let pts = hero.movePoints;
      let pos = copyPos(hero.pos);
      let sailing = !!hero.inBoat;
      let lastStop = -1;
      for (let i = 0; i < path.length; i++) {
        const to = copyPos(path[i]);
        if (samePos(pos, to)) continue;
        const cls = classifyStep(state, ctx, pos, to, sailing, i === path.length - 1);
        if (cls.kind === 'blocked') break;
        const { cost, orth } = getStepCost(state, ctx, pos, to, sailing);
        const left = cls.kind === 'board' || cls.kind === 'land' ? (pts >= 1 ? 0 : -1) : spendStep(pts, cost, orth, pos.x !== to.x && pos.y !== to.y);
        if (left < 0) break;
        pts = left;
        if (cls.kind !== 'transit') lastStop = i;
        if (cls.kind !== 'move' && cls.kind !== 'transit') break;
        pos = to;
      }
      if (lastStop < 0) return fail('cannot_stop_on_path');
      limit = lastStop;
    }
  }

  for (let i = 0; i <= limit; i++) {
    const to = copyPos(path[i]);
    if (samePos(hero.pos, to)) continue; // arrived here by teleport
    if (Math.max(Math.abs(to.x - hero.pos.x), Math.abs(to.y - hero.pos.y)) !== 1 || (to.z || 0) !== (hero.pos.z || 0)) { stopped = 'bad_path'; break; }
    const ctx = getMoveContext(state, hero);
    const isDest = i === path.length - 1;
    const sailing = !!hero.inBoat;
    const cls = classifyStep(state, ctx, hero.pos, to, sailing, isDest);
    if (cls.kind === 'blocked') { stopped = 'blocked'; break; }
    const diagonal = to.x !== hero.pos.x && to.y !== hero.pos.y;
    const { cost, orth } = getStepCost(state, ctx, hero.pos, to, sailing);
    const special = cls.kind === 'board' || cls.kind === 'land';
    const left = special && !ctx.hat ? (hero.movePoints >= 1 ? 0 : -1) : spendStep(hero.movePoints, cost, orth, diagonal);
    if (left < 0) { stopped = 'out_of_movement'; break; }
    const spent = hero.movePoints - left;
    moved++;

    if (cls.kind === 'board') {
      boardBoat(state, hero, cls.obj, events, ctx, cost);
      if (!ctx.hat) { stopped = isDest ? null : 'boarded'; if (!isDest) break; }
      continue;
    }
    if (cls.kind === 'land') {
      landHero(state, hero, to, events, ctx, cost);
      const g = triggerGuardAt(state, hero, events, null);
      if (g) { stopped = 'guard'; break; }
      if (!ctx.hat && !isDest) { stopped = 'landed'; break; }
      continue;
    }
    hero.movePoints = left;
    const mark = events.length;
    // a refused battle against something the hero did not step onto costs no movement
    const refundIfFailed = () => { if (events.slice(mark).some((e) => e.type === 'combat_failed')) hero.movePoints += spent; };
    if (cls.kind === 'adjacent') {
      interactWithObject(state, hero, cls.obj, events);
      refundIfFailed();
      stopped = isDest ? null : 'interaction';
      break;
    }
    if (cls.kind === 'hero') {
      meetOrFightHero(state, hero, cls.other, events);
      refundIfFailed();
      stopped = isDest ? null : 'interaction';
      break;
    }
    if (cls.kind === 'town') {
      visitTownTile(state, hero, cls.obj, events, spent);
      refundIfFailed();
      stopped = isDest ? null : 'interaction';
      break;
    }
    // move / transit / enter
    placeHero(state, hero, to, events, { cost: spent });
    if (cls.kind === 'transit') continue;
    const flyingThrough = ctx.fly >= 0 && !sailing && i !== limit;
    if (cls.kind === 'enter') {
      if (cls.pass && !isDest) {
        if (!flyingThrough && triggerGuardAt(state, hero, events, null)) { stopped = 'guard'; break; }
        continue;
      }
      interactWithObject(state, hero, cls.obj, events);
      if (busy(state, hero)) { stopped = isDest ? null : 'interaction'; break; }
      if (!isDest && samePos(hero.pos, path[i + 1])) continue; // teleported along the planned path
      if (!isDest) stopped = 'interaction';
      break;
    }
    // plain move: guards first, then walk-on triggers (events)
    if (!flyingThrough) {
      if (triggerGuardAt(state, hero, events, cls.obj ? { type: 'visit', objectId: cls.obj.id } : null)) { stopped = 'guard'; break; }
    }
    if (cls.obj && interactWithObject(state, hero, cls.obj, events)) {
      if (!isDest) stopped = 'event';
      break;
    }
    if (busy(state, hero)) { stopped = 'interaction'; break; }
  }
  if (!moved && stopped) return fail(stopped === 'out_of_movement' ? 'no_movement_points' : stopped, { events });
  const alive = state.heroes[heroId];
  if (alive && moved > 0) alive.asleep = false; // moving wakes a sleeping hero
  const failed = events.find((e) => e.type === 'combat_failed');
  if (failed) {
    // the battle could not start (no army, no combat engine, ...): no phantom battle is reported
    return fail('combat_failed', { events, reason: failed.error, pos: alive ? copyPos(alive.pos) : null, stopped: 'combat_failed' });
  }
  return ok(events, { pos: alive ? copyPos(alive.pos) : null, arrived: !stopped, stopped });
}

export { getPlayer };
