// Service-type map objects: dialogs that stay open (market, black market, recruiting, upgrades,
// university, altar, tavern, war machines), flaggables (lighthouse, shipyard, dwelling), garrisons,
// prison, thieves' guild. Spec: docs/mechanics/adventure-objects.md §3.4-§3.10.
import { RESOURCES, MAX_SECONDARY_SKILLS, MAX_HEROES_PER_PLAYER } from '../../core/constants.js';
import { getCreature, getUpgrade } from '../../data/creatures.js';
import { getArtifact } from '../../data/artifacts.js';
import { getHeroClass } from '../../data/heroClasses.js';
import { getFaction } from '../../data/factions.js';
import { getTerrain } from '../../data/terrain.js';
import { getMapObject } from '../../data/mapObjects.js';
import { marketRate, freelancerRate, TAVERN_HERO_COST } from '../../data/buildings.js';
import { hasArtifact, giveArtifact, removeArtifact, findArtifact, entryId, getEquippedArtifacts } from '../artifacts.js';
import { registerPendingHandler } from '../pending.js';
import { deps } from './deps.js';
import { EFFECTS } from './registry.js';
import { getTile, removeObject, getHeroAt, objectsByEffect } from './map.js';
import { grantSkill, grantCreatures } from './rewards.js';
import { defenderSurvivors } from './combat.js';
import { shipyardLaunchTile, createBoat } from './transport.js';
import {
  note, refuse, askConfirm, askChoice, pendingCtx, fightObject, flagObject, learnAbout,
} from './visit.js';
import {
  DIRS, ok, fail, samePos, areAllies, getPlayer, emptyArmy, armyIsEmpty, armyStacks, armyTotalCount,
  armyStrength, armyAdd, armyCanAdd, scaleCost, costIsZero,
} from './util.js';

const LEAVE = { id: 'leave', label: 'Leave' };

// ---- dialog plumbing ----------------------------------------------------------------------------

/** kind -> effect type -> { build(ctx) -> {options, data}|null, act(ctx, option, extra, pending) -> {error?, close?}|void } */
const DIALOGS = {};

function openDialog(ctx, kind) {
  const d = DIALOGS[kind][ctx.fx.type];
  const built = d.build(ctx);
  if (!built) return false;
  askChoice(ctx, kind, [...built.options, LEAVE], built.data || {});
  return true;
}

function defineDialog(kind, type, impl) {
  if (!DIALOGS[kind]) {
    DIALOGS[kind] = {};
    registerPendingHandler(kind, (state, pending, optionIndex, extra) => {
      const events = [];
      const ctx = pendingCtx(state, pending, events);
      if (!ctx) return { ok: true, events };
      const opt = pending.options[optionIndex];
      if (opt.id === 'leave') return { ok: true, events };
      const d = DIALOGS[kind][ctx.fx.type];
      const res = d.act(ctx, opt, extra || {}, pending) || {};
      if (!res.close && state.map.objects[ctx.obj.id] && state.heroes[ctx.hero.id]) openDialog(ctx, kind);
      return res.error ? { ok: false, error: res.error, events } : { ok: true, events };
    });
  }
  DIALOGS[kind][type] = impl;
}

const multiply = (cost, n) => {
  const out = {};
  for (const r of RESOURCES) if (cost?.[r]) out[r] = cost[r] * n;
  return out;
};

function maxAffordable(state, playerId, cost, cap) {
  if (costIsZero(cost)) return cap;
  const p = getPlayer(state, playerId);
  let n = cap;
  for (const r of RESOURCES) if (cost[r]) n = Math.min(n, Math.floor((p.resources[r] || 0) / cost[r]));
  return Math.max(0, n);
}

// ---- market -------------------------------------------------------------------------------------

EFFECTS.market = {
  visit(ctx) { openDialog(ctx, 'trade'); note(ctx, 'trade'); },
};
defineDialog('trade', 'market', {
  build(ctx) {
    return { options: [{ id: 'trade', label: 'Trade' }], data: { modes: ctx.fx.modes, marketCount: ctx.fx.marketCount } };
  },
  /** extra: {mode:'resource_resource', give, get, amount (lots)} | {mode:'creature_resource', slot, count, get} | {mode:'resource_player', give, amount, toPlayer} */
  act(ctx, opt, extra) {
    const { state, hero, fx, events } = ctx;
    const mode = extra.mode || fx.modes[0];
    if (!fx.modes.includes(mode)) return { error: 'bad_mode' };
    if (mode === 'resource_resource') {
      if (!RESOURCES.includes(extra.give) || !RESOURCES.includes(extra.get) || extra.give === extra.get) return { error: 'bad_resource' };
      const lots = Math.floor(extra.amount || 1);
      if (lots < 1) return { error: 'bad_amount' };
      const rate = marketRate(extra.give, extra.get, fx.marketCount);
      if (!deps.pay(state, hero.owner, { [extra.give]: rate.give * lots })) return { error: 'cannot_afford' };
      deps.addResources(state, hero.owner, { [extra.get]: rate.get * lots });
      events.push({ type: 'trade', playerId: hero.owner, gave: { [extra.give]: rate.give * lots }, got: { [extra.get]: rate.get * lots } });
      return {};
    }
    if (mode === 'creature_resource') {
      const stack = hero.army[extra.slot];
      const get = extra.get || 'gold';
      if (!stack || !RESOURCES.includes(get)) return { error: 'bad_stack' };
      const count = Math.floor(extra.count || stack.count);
      if (count < 1 || count > stack.count) return { error: 'bad_amount' };
      if (armyTotalCount(hero.army) - count < 1) return { error: 'last_creature' };
      const rate = freelancerRate(getCreature(stack.creatureId).cost.gold || 0, get, fx.marketCount);
      const lots = Math.floor(count / rate.give);
      if (lots < 1) return { error: 'bad_amount' };
      stack.count -= lots * rate.give;
      if (stack.count <= 0) hero.army[extra.slot] = null;
      deps.addResources(state, hero.owner, { [get]: lots * rate.get });
      events.push({ type: 'trade', playerId: hero.owner, soldCreatures: { creatureId: stack.creatureId, count: lots * rate.give }, got: { [get]: lots * rate.get } });
      return {};
    }
    // resource_player: a gift to another player
    const target = getPlayer(state, extra.toPlayer);
    const amount = Math.floor(extra.amount || 0);
    if (!target || target.id === hero.owner || !RESOURCES.includes(extra.give) || amount < 1) return { error: 'bad_gift' };
    if (!deps.pay(state, hero.owner, { [extra.give]: amount })) return { error: 'cannot_afford' };
    deps.addResources(state, target.id, { [extra.give]: amount });
    events.push({ type: 'gift', playerId: hero.owner, toPlayer: target.id, resources: { [extra.give]: amount } });
    return {};
  },
});

// ---- black market -------------------------------------------------------------------------------

EFFECTS.black_market = {
  visit(ctx) { openDialog(ctx, 'buy_artifact'); note(ctx, 'buy_artifact', { stock: ctx.obj.data.stock }); },
};
defineDialog('buy_artifact', 'black_market', {
  build(ctx) {
    const options = [];
    ctx.obj.data.stock.forEach((artifactId, slot) => {
      if (artifactId) options.push({ id: 'buy', label: getArtifact(artifactId).name, slot, artifactId, cost: { gold: getArtifact(artifactId).cost } });
    });
    return { options };
  },
  act(ctx, opt) {
    const { state, hero, obj, events } = ctx;
    if (obj.data.stock[opt.slot] !== opt.artifactId) return { error: 'sold_out' };
    if (!deps.canAfford(state, hero.owner, opt.cost)) return { error: 'cannot_afford' };
    const res = giveArtifact(hero, opt.artifactId);
    if (!res.ok) return { error: res.error };
    deps.pay(state, hero.owner, opt.cost);
    obj.data.stock[opt.slot] = null;
    events.push({ type: 'artifact_bought', heroId: hero.id, artifactId: opt.artifactId, cost: opt.cost }, ...res.events);
    return {};
  },
});

// ---- recruiting (refugee camp, dwellings) -------------------------------------------------------

function recruitFrom(ctx, opt, extra, stockOf, costEach) {
  const { state, hero, events } = ctx;
  const available = stockOf(opt.creatureId);
  if (!available) return { error: 'sold_out' };
  if (!armyCanAdd(hero.army, opt.creatureId)) return { error: 'no_room' };
  const cost = costEach(opt.creatureId);
  const want = extra.count == null ? maxAffordable(state, hero.owner, cost, available) : Math.floor(extra.count);
  if (want < 1) return { error: extra.count == null ? 'cannot_afford' : 'bad_amount' };
  if (want > available) return { error: 'bad_amount' };
  const total = multiply(cost, want);
  if (!deps.pay(state, hero.owner, total)) return { error: 'cannot_afford' };
  armyAdd(hero.army, opt.creatureId, want);
  events.push({ type: 'recruited', heroId: hero.id, objectId: ctx.obj.id, creatureId: opt.creatureId, count: want, cost: total });
  return { count: want };
}

EFFECTS.refugee_camp = {
  visit(ctx) {
    if (!ctx.obj.data.count) return note(ctx, 'sold_out', { creatureId: ctx.obj.data.creatureId });
    openDialog(ctx, 'recruit');
    return note(ctx, 'recruit', { creatureId: ctx.obj.data.creatureId, count: ctx.obj.data.count });
  },
};
const campCost = (ctx, creatureId) => scaleCost(getCreature(creatureId).cost, ctx.fx.costMultiplier ?? 1);
defineDialog('recruit', 'refugee_camp', {
  build(ctx) {
    const d = ctx.obj.data;
    if (!d.count) return null;
    return { options: [{ id: 'recruit', label: getCreature(d.creatureId).name, creatureId: d.creatureId, available: d.count, cost: campCost(ctx, d.creatureId) }] };
  },
  act(ctx, opt, extra) {
    const d = ctx.obj.data;
    const res = recruitFrom(ctx, opt, extra, (c) => (c === d.creatureId ? d.count : 0), (c) => campCost(ctx, c));
    if (res.count) d.count -= res.count;
    return res;
  },
});

EFFECTS.dwelling = {
  visit(ctx) {
    const { state, hero, obj } = ctx;
    if (!obj.data.cleared && obj.data.guards && !armyIsEmpty(obj.data.guards)) {
      note(ctx, 'guarded');
      return void askConfirm(ctx, 'confirm_fight', { guards: obj.data.guards, stage: 'guards', then: ctx.then || null });
    }
    if (obj.owner == null || !areAllies(state, obj.owner, hero.owner)) flagObject(ctx);
    if (!openDialog(ctx, 'recruit')) return note(ctx, 'sold_out');
    return note(ctx, 'recruit', { stock: obj.data.stock });
  },
  confirmed(ctx) { fightObject(ctx, ctx.obj.data.guards, 'guards'); },
  afterCombat(ctx, won, result) {
    if (!won) { ctx.obj.data.guards = defenderSurvivors(result); return; }
    ctx.obj.data.guards = null;
    ctx.obj.data.cleared = true;
    EFFECTS.dwelling.visit(ctx);
  },
};
const dwellingCost = (ctx, creatureId) => (ctx.fx.freeFirst ? {} : { ...getCreature(creatureId).cost });
defineDialog('recruit', 'dwelling', {
  build(ctx) {
    const options = [];
    for (const [creatureId, n] of Object.entries(ctx.obj.data.stock || {})) {
      if (n > 0) options.push({ id: 'recruit', label: getCreature(creatureId).name, creatureId, available: n, cost: dwellingCost(ctx, creatureId) });
    }
    return options.length ? { options } : null;
  },
  act(ctx, opt, extra) {
    const { state, obj, fx } = ctx;
    const res = recruitFrom(ctx, opt, extra, (c) => obj.data.stock[c] || 0, (c) => dwellingCost(ctx, c));
    if (res.count) obj.data.stock[opt.creatureId] -= res.count;
    if (fx.removable && Object.values(obj.data.stock).every((n) => n <= 0)) {
      removeObject(state, obj.id);
      ctx.events.push({ type: 'object_removed', objectId: obj.id, defId: obj.defId });
    }
    return res;
  },
});

/** Flagged dwellings of a player: `[{objectId, defId, creatures:[creatureId], townGrowthBonus}]` (town engine: +1 growth). */
export function getFlaggedDwellings(state, playerId) {
  return objectsByEffect(state, 'dwelling').filter((o) => o.owner === playerId).map((o) => {
    const fx = ctxFx(o.defId);
    return { objectId: o.id, defId: o.defId, creatures: fx.creatures.slice(), townGrowthBonus: fx.townGrowthBonus || 0 };
  });
}
function ctxFx(defId) { return getMapObject(defId).effect; }

// ---- hill fort ----------------------------------------------------------------------------------

export function hillFortCost(fx, stack) {
  const from = getCreature(stack.creatureId);
  const to = getUpgrade(stack.creatureId);
  if (!to) return null;
  const pct = fx.costPercentByTier[from.tier] ?? 100;
  const cost = {};
  for (const r of RESOURCES) {
    const diff = Math.max(0, (to.cost[r] || 0) - (from.cost[r] || 0));
    const v = Math.floor((diff * stack.count * pct) / 100);
    if (v > 0) cost[r] = v;
  }
  return cost;
}

EFFECTS.hill_fort = {
  visit(ctx) { openDialog(ctx, 'upgrade_creatures'); note(ctx, 'upgrade_creatures'); },
};
defineDialog('upgrade_creatures', 'hill_fort', {
  build(ctx) {
    const options = [];
    ctx.hero.army.forEach((s, slot) => {
      if (!s) return;
      const to = getUpgrade(s.creatureId);
      if (to) options.push({ id: 'upgrade', label: `${getCreature(s.creatureId).name} -> ${to.name}`, slot, from: s.creatureId, to: to.id, count: s.count, cost: hillFortCost(ctx.fx, s) });
    });
    return { options };
  },
  act(ctx, opt) {
    const { state, hero, events } = ctx;
    const stack = hero.army[opt.slot];
    if (!stack || stack.creatureId !== opt.from) return { error: 'bad_stack' };
    const cost = hillFortCost(ctx.fx, stack);
    if (!deps.pay(state, hero.owner, cost)) return { error: 'cannot_afford' };
    stack.creatureId = opt.to;
    events.push({ type: 'upgraded', heroId: hero.id, slot: opt.slot, from: opt.from, to: opt.to, count: stack.count, cost });
    return {};
  },
});

// ---- university ---------------------------------------------------------------------------------

EFFECTS.university = {
  visit(ctx) { learnAbout(ctx, { skills: ctx.obj.data.skills }); openDialog(ctx, 'university'); note(ctx, 'university', { skills: ctx.obj.data.skills }); },
};
const uniAvailable = (hero, id) => !hero.skills.some((s) => s.id === id) && hero.skills.length < MAX_SECONDARY_SKILLS;
defineDialog('university', 'university', {
  build(ctx) {
    return { options: ctx.obj.data.skills.map((id) => ({ id: 'buy', label: id, skillId: id, cost: ctx.fx.cost, available: uniAvailable(ctx.hero, id) })) };
  },
  act(ctx, opt) {
    const { state, hero, fx } = ctx;
    if (!uniAvailable(hero, opt.skillId)) return { error: 'cannot_learn' };
    if (!deps.pay(state, hero.owner, fx.cost)) return { error: 'cannot_afford' };
    grantSkill(hero, opt.skillId, fx.level || 1);
    note(ctx, 'skill_learned', { skillId: opt.skillId, level: fx.level || 1 });
    return {};
  },
});

// ---- altar of sacrifice -------------------------------------------------------------------------

export function heroAlignment(hero) {
  const faction = getHeroClass(hero.classId).faction;
  return faction && faction !== 'neutral' ? getFaction(faction).alignment : 'neutral';
}
export const creatureSacrificeExp = (fx, creatureId) => Math.floor(getCreature(creatureId).aiValue / fx.creatureExp.divisor) * fx.creatureExp.multiplier;

function canSacrificeArtifact(entry) {
  const a = getArtifact(entryId(entry));
  return !(a.noTransfer || a.noBackpack || a.components || a.slot === 'war_machine' || a.slot === 'spellbook' || a.id === 'grail');
}

EFFECTS.altar_of_sacrifice = {
  visit(ctx) { openDialog(ctx, 'altar'); note(ctx, 'altar'); },
};
defineDialog('altar', 'altar_of_sacrifice', {
  build(ctx) {
    const al = heroAlignment(ctx.hero);
    return {
      options: [{ id: 'sacrifice', label: 'Sacrifice' }],
      data: { canArtifacts: ctx.fx.artifactAlignments.includes(al), canCreatures: ctx.fx.creatureAlignments.includes(al) },
    };
  },
  /** extra: { artifacts?: [ref], creatures?: [{slot, count}] } */
  act(ctx, opt, extra, pending) {
    const { state, hero, fx, events } = ctx;
    const arts = extra.artifacts || [];
    const creatures = extra.creatures || [];
    if (!arts.length && !creatures.length) return { error: 'nothing_offered' };
    if (arts.length && !pending.data.canArtifacts) return { error: 'cannot_sacrifice_artifacts' };
    if (creatures.length && !pending.data.canCreatures) return { error: 'cannot_sacrifice_creatures' };
    // validate everything first
    const located = [];
    for (const ref of arts) {
      const loc = findArtifact(hero, ref);
      if (!loc || !canSacrificeArtifact(loc.entry)) return { error: 'bad_artifact' };
      located.push(loc.entry);
    }
    let removed = 0;
    for (const c of creatures) {
      const s = hero.army[c.slot];
      if (!s || !(c.count >= 1) || c.count > s.count) return { error: 'bad_stack' };
      removed += c.count;
    }
    if (armyTotalCount(hero.army) - removed < 1) return { error: 'last_creature' };
    let exp = 0;
    for (const entry of located) {
      exp += getArtifact(entryId(entry)).cost * (fx.artifactExp.multiplier || 1);
      removeArtifact(hero, entry);
    }
    for (const c of creatures) {
      const s = hero.army[c.slot];
      exp += creatureSacrificeExp(fx, s.creatureId) * c.count;
      s.count -= c.count;
      if (s.count <= 0) hero.army[c.slot] = null;
    }
    note(ctx, 'sacrifice', { exp, artifacts: located, creatures });
    const res = deps.giveExperience(state, hero.id, exp);
    if (res && res.events) events.push(...res.events);
    return {};
  },
});

// ---- tavern, war machines, thieves' guild, prison -----------------------------------------------

function freeAdjacentTile(state, pos) {
  for (const d of DIRS) {
    const p = { x: pos.x + d.dx, y: pos.y + d.dy, z: pos.z || 0 };
    const t = getTile(state.map, p);
    if (!t || t.blocked || t.obj || getHeroAt(state, p)) continue;
    const ter = getTerrain(t.t);
    if (!ter.passable || ter.water) continue;
    return p;
  }
  return null;
}

EFFECTS.tavern = {
  visit(ctx) { openDialog(ctx, 'tavern'); note(ctx, 'tavern'); },
};
defineDialog('tavern', 'tavern', {
  build(ctx) {
    const pool = (ctx.player.tavernHeroes || []).filter(Boolean);
    return { options: pool.map((heroDefId) => ({ id: 'hire', label: heroDefId, heroDefId, cost: { gold: TAVERN_HERO_COST } })) };
  },
  act(ctx, opt) {
    const { state, hero, player, events } = ctx;
    if (player.heroes.length >= MAX_HEROES_PER_PLAYER) return { error: 'too_many_heroes' };
    const pos = freeAdjacentTile(state, hero.pos);
    if (!pos) return { error: 'no_free_tile' };
    if (!deps.pay(state, player.id, { gold: TAVERN_HERO_COST })) return { error: 'cannot_afford' };
    const hired = deps.addHero(state, opt.heroDefId, player.id, pos);
    player.tavernHeroes = (player.tavernHeroes || []).map((d) => (d === opt.heroDefId ? null : d));
    events.push({ type: 'hero_hired', playerId: player.id, heroId: hired.id, heroDefId: opt.heroDefId, pos });
    return {};
  },
});

EFFECTS.war_machine_factory = {
  visit(ctx) { openDialog(ctx, 'buy_war_machine'); note(ctx, 'buy_war_machine'); },
};
defineDialog('buy_war_machine', 'war_machine_factory', {
  build(ctx) {
    return { options: ctx.fx.items.map((it) => ({ id: 'buy', label: getArtifact(it.artifactId).name, artifactId: it.artifactId, cost: it.cost, available: !hasArtifact(ctx.hero, it.artifactId) })) };
  },
  act(ctx, opt) {
    const { state, hero, events } = ctx;
    if (hasArtifact(hero, opt.artifactId)) return { error: 'already_owned' };
    if (!deps.canAfford(state, hero.owner, opt.cost)) return { error: 'cannot_afford' };
    const res = giveArtifact(hero, opt.artifactId);
    if (!res.ok) return { error: res.error };
    deps.pay(state, hero.owner, opt.cost);
    events.push({ type: 'war_machine_bought', heroId: hero.id, artifactId: opt.artifactId, cost: opt.cost });
    return {};
  },
});

/** Full thieves' guild comparison table (one row per living player). */
export function getThievesGuildTable(state) {
  return state.players.filter((p) => p.alive !== false).map((p) => {
    const heroes = p.heroes.map((id) => state.heroes[id]).filter(Boolean);
    const best = heroes.slice().sort((a, b) => b.level - a.level)[0] || null;
    return {
      playerId: p.id, towns: p.towns.length, heroes: heroes.length, gold: p.resources.gold,
      woodOre: p.resources.wood + p.resources.ore,
      rare: p.resources.mercury + p.resources.sulfur + p.resources.crystal + p.resources.gems,
      obelisks: Object.keys(p.visited || {}).filter((k) => state.map.objects[k]?.defId === 'obelisk').length,
      artifacts: heroes.reduce((n, h) => n + getEquippedArtifacts(h).length + (h.artifacts?.backpack?.length || 0), 0),
      armyStrength: heroes.reduce((n, h) => n + armyStrength(h.army), 0),
      bestHero: best ? { id: best.id, name: best.name, level: best.level } : null,
      mines: Object.values(state.map.objects).filter((o) => o.owner === p.id && ctxFx(o.defId).type === 'mine').length,
    };
  });
}

EFFECTS.thieves_guild = {
  visit(ctx) { ctx.events.push({ type: 'thieves_guild', heroId: ctx.hero.id, objectId: ctx.obj.id, table: getThievesGuildTable(ctx.state) }); },
};

EFFECTS.prison = {
  visit(ctx) {
    const { state, hero, player, obj, events } = ctx;
    if (player.heroes.length >= MAX_HEROES_PER_PLAYER) return note(ctx, 'no_room');
    const d = obj.data;
    removeObject(state, obj.id);
    const freed = deps.addHero(state, d.heroDefId, player.id, { ...obj.pos });
    freed.pos = { ...obj.pos };
    if (d.army) freed.army = d.army.map((s) => (s ? { ...s } : null)).concat(new Array(7).fill(null)).slice(0, 7);
    if (d.exp) deps.giveExperience(state, freed.id, d.exp);
    freed.movePoints = 0;
    events.push({ type: 'hero_freed', heroId: hero.id, freedHeroId: freed.id, heroDefId: d.heroDefId, objectId: obj.id, pos: { ...obj.pos } });
    return undefined;
  },
};

// ---- flaggables ---------------------------------------------------------------------------------

EFFECTS.lighthouse = {
  visit(ctx) {
    if (ctx.obj.owner != null && areAllies(ctx.state, ctx.obj.owner, ctx.hero.owner)) return note(ctx, 'already_owned');
    return flagObject(ctx);
  },
};

EFFECTS.shipyard = {
  visit(ctx) {
    const { state, hero, obj, fx } = ctx;
    if (obj.owner == null || !areAllies(state, obj.owner, hero.owner)) flagObject(ctx);
    if (!shipyardLaunchTile(state, obj)) return note(ctx, 'no_water');
    askChoice(ctx, 'build_boat', [{ id: 'yes', label: 'Build' }, { id: 'no', label: 'Leave' }], { cost: fx.cost });
    return note(ctx, 'build_boat', { cost: fx.cost });
  },
};
registerPendingHandler('build_boat', (state, pending, optionIndex) => {
  const events = [];
  const ctx = pendingCtx(state, pending, events);
  if (!ctx || optionIndex !== 0) return { ok: true, events };
  const res = buildBoatAt(state, ctx.hero.owner, shipyardLaunchTile(state, ctx.obj), ctx.fx.cost);
  if (!res.ok) return res;
  events.push(...res.events);
  return { ok: true, events };
});

/** Pay and launch a boat on `pos` (shared with town shipyards). */
export function buildBoatAt(state, playerId, pos, cost) {
  if (!pos) return fail('no_water');
  if (!deps.pay(state, playerId, cost)) return fail('cannot_afford');
  const boat = createBoat(state, pos, playerId);
  return ok([{ type: 'boat_built', playerId, boatId: boat.id, pos: { ...boat.pos } }]);
}

// ---- garrisons ----------------------------------------------------------------------------------

EFFECTS.garrison = {
  visit(ctx) {
    const { state, hero, obj } = ctx;
    const allied = obj.owner != null && areAllies(state, obj.owner, hero.owner);
    if (allied) {
      askChoice(ctx, 'garrison_exchange', [{ id: 'transfer', label: 'Transfer' }, LEAVE], { removableUnits: obj.data.removableUnits !== false });
      return note(ctx, 'garrison_exchange');
    }
    if (!armyIsEmpty(obj.data.army)) {
      note(ctx, 'guarded');
      return void askConfirm(ctx, 'confirm_fight', { guards: obj.data.army, stage: 'garrison', then: ctx.then || null });
    }
    return EFFECTS.garrison.capture(ctx);
  },
  confirmed(ctx) {
    fightObject(ctx, ctx.obj.data.army, 'garrison', ctx.fx.antiMagic ? { spellLevelCap: 0, noOverlay: true } : { noOverlay: true });
  },
  afterCombat(ctx, won, result) {
    if (!won) { ctx.obj.data.army = defenderSurvivors(result); return; }
    EFFECTS.garrison.capture(ctx);
  },
  capture(ctx) {
    ctx.obj.data.army = emptyArmy();
    flagObject(ctx);
  },
};
registerPendingHandler('garrison_exchange', (state, pending, optionIndex, extra) => {
  const opt = pending.options[optionIndex];
  if (opt.id === 'leave') return { ok: true, events: [] };
  const res = garrisonTransfer(state, pending.heroId, pending.data.objectId, extra || {});
  state.pending.push(pending); // the dialog stays open until the player leaves
  return res;
});

/**
 * Move troops between a hero and the garrison army of an allied object (garrison: `data.army`,
 * mine: `data.garrison`). The hero must stand on the object's entrance.
 * @param {{from:'hero'|'garrison', slot:number, count?:number}} op
 */
export function garrisonTransfer(state, heroId, objId, op) {
  const hero = state.heroes[heroId];
  const obj = state.map.objects[objId];
  if (!hero || !obj) return fail('no_such_object');
  const fx = ctxFx(obj.defId);
  if (fx.type !== 'garrison' && fx.type !== 'mine') return fail('not_a_garrison');
  if (obj.owner == null || !areAllies(state, obj.owner, hero.owner)) return fail('not_owner');
  if (!samePos(hero.pos, obj.pos)) return fail('not_in_reach');
  const key = fx.type === 'garrison' ? 'army' : 'garrison';
  obj.data[key] ??= emptyArmy();
  const store = obj.data[key];
  const fromHero = op.from !== 'garrison';
  if (!fromHero && fx.type === 'garrison' && obj.data.removableUnits === false) return fail('units_not_removable');
  const src = fromHero ? hero.army : store;
  const dst = fromHero ? store : hero.army;
  const stack = src[op.slot];
  if (!stack) return fail('bad_stack');
  const count = op.count == null ? stack.count : Math.floor(op.count);
  if (count < 1 || count > stack.count) return fail('bad_amount');
  if (fromHero && armyTotalCount(hero.army) - count < 1) return fail('last_creature');
  if (!armyAdd(dst, stack.creatureId, count)) return fail('no_room');
  stack.count -= count;
  if (stack.count <= 0) src[op.slot] = null;
  return ok([{ type: 'garrison_transfer', heroId, objectId: objId, from: fromHero ? 'hero' : 'garrison', creatureId: stack.creatureId, count }]);
}

export { refuse, grantCreatures, armyStacks };
