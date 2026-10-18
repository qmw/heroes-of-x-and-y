// Visiting map objects: dispatcher, revisit bookkeeping, confirm pendings, combat continuations,
// and the handlers of the "simple" effect types. Service dialogs live in services.js, quests in
// quests.js, wandering monsters in monsters.js (all register themselves in EFFECTS).
// Spec: docs/mechanics/adventure-objects.md §2-§3.
import { PRIMARY_SKILLS, MAX_SECONDARY_SKILLS } from '../../core/constants.js';
import { getTerrain } from '../../data/terrain.js';
import { getMapObject } from '../../data/mapObjects.js';
import { getCreature } from '../../data/creatures.js';
import { getSpell } from '../../data/spells.js';
import { hasArtifact, ownsArtifact } from '../artifacts.js';
import { expForLevel, MAX_HERO_LEVEL } from '../leveling.js';
import { pushPending, registerPendingHandler } from '../pending.js';
import { deps } from './deps.js';
import { getTile, removeObject, objectsByDef, objectsByEffect, getHeroAt } from './map.js';
import { revealAround, revealWhere, hideAround } from './fog.js';
import { resolveReward, applyReward, rewardIsEmpty, canCarryArtifact, grantArtifact, grantSkill } from './rewards.js';
import { fight, onCombatOutcome, attackerWon, defenderSurvivors } from './combat.js';
import { teleportDestinations } from './transport.js';
import {
  DIRS, samePos, isAdjacent, copyPos, ok, fail, weekNumber, dayOfWeek, rollTable, pick, randInt,
  getPlayer, areAllies, armyIsEmpty, armyStacks, armyStrength, costIsZero,
} from './util.js';
import { placeHero, checkCanAct } from './movement.js';
import { EFFECTS } from './registry.js';

export { EFFECTS };

export const CONFIRM_KINDS = [
  'confirm_fight', 'confirm_pay', 'confirm_open', 'confirm_search', 'confirm_quest', 'confirm_pass', 'confirm_whirlpool',
];

function makeCtx(state, hero, obj, events) {
  const def = getMapObject(obj.defId);
  return { state, hero, player: hero ? getPlayer(state, hero.owner) : null, obj, def, fx: def.effect, events };
}

/** Standard visit event. */
export function note(ctx, result, extra = {}) {
  ctx.events.push({ type: 'visit', heroId: ctx.hero ? ctx.hero.id : null, objectId: ctx.obj.id, defId: ctx.obj.defId, result, ...extra });
}
/** Visit that could not happen (not consumed); `visitObject` turns it into `ok:false`. */
export function refuse(ctx, reason, extra = {}) {
  note(ctx, reason, { refused: true, ...extra });
}

// ---- revisit bookkeeping (doc §2.2) -------------------------------------------------------------

export function alreadyVisited(ctx) {
  const { state, hero, player, obj, def } = ctx;
  switch (def.revisit) {
    case 'once': return !!obj.data.visited;
    case 'per_hero': return !!hero.visited?.[obj.id];
    case 'per_player': return !!player?.visited?.[obj.id];
    case 'per_battle': return (hero.temp || []).some((t) => t.source === def.id);
    case 'per_hero_daily': return hero.visited?.[obj.id] === state.turn;
    case 'per_hero_weekly': return hero.visited?.[obj.id] === weekNumber(state);
    case 'weekly': return obj.data.visitedWeek === weekNumber(state);
    default: return false;
  }
}

export function markVisited(ctx) {
  const { state, hero, player, obj, def } = ctx;
  hero.visited ??= {};
  switch (def.revisit) {
    case 'once': obj.data.visited = true; break;
    case 'per_hero': hero.visited[obj.id] = true; break;
    case 'per_player': if (player) { player.visited ??= {}; player.visited[obj.id] = true; } break;
    case 'per_hero_daily': hero.visited[obj.id] = state.turn; break;
    case 'per_hero_weekly': hero.visited[obj.id] = weekNumber(state); break;
    case 'weekly': obj.data.visitedWeek = weekNumber(state); break;
    default: break;
  }
}

/** Remember what the player learned about an object (tooltips). */
export function learnAbout(ctx, info) {
  if (!ctx.player) return;
  ctx.player.visited ??= {};
  ctx.player.visited[`info_${ctx.obj.id}`] = info;
}

// ---- pendings -----------------------------------------------------------------------------------

export function askConfirm(ctx, kind, data = {}) {
  const { state, hero, obj } = ctx;
  return pushPending(state, {
    kind, playerId: hero.owner, heroId: hero.id,
    options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    data: { objectId: obj.id, defId: obj.defId, ...data },
  });
}

/** Push a dialog-style pending for an object. */
export function askChoice(ctx, kind, options, data = {}) {
  const { state, hero, obj } = ctx;
  return pushPending(state, { kind, playerId: hero.owner, heroId: hero.id, options, data: { objectId: obj.id, defId: obj.defId, ...data } });
}

/** Context for a pending handler; null when the hero or object vanished meanwhile. */
export function pendingCtx(state, pending, events) {
  const hero = state.heroes[pending.heroId];
  const obj = state.map.objects[pending.data.objectId];
  if (!hero || !obj) return null;
  const ctx = makeCtx(state, hero, obj, events);
  ctx.then = pending.data.then || null;
  return ctx;
}

function confirmHandler(state, pending, optionIndex) {
  const events = [];
  const ctx = pendingCtx(state, pending, events);
  if (!ctx) return { ok: true, events };
  const h = EFFECTS[ctx.fx.type];
  if (optionIndex === 0) { if (h.confirmed) h.confirmed(ctx, pending); }
  else if (h.declined) h.declined(ctx, pending);
  else note(ctx, 'declined');
  return { ok: true, events };
}
for (const kind of CONFIRM_KINDS) registerPendingHandler(kind, confirmHandler);

// ---- guards & combat ----------------------------------------------------------------------------

/** Wandering monster guarding `pos` (adjacent, same level, same land/water kind), or null. */
export function findGuard(state, pos, excludeId = null) {
  const here = getTile(state.map, pos);
  if (!here) return null;
  const water = getTerrain(here.t).water;
  for (const d of DIRS) {
    const p = { x: pos.x + d.dx, y: pos.y + d.dy, z: pos.z || 0 };
    const t = getTile(state.map, p);
    if (!t || !t.obj || t.obj === excludeId) continue;
    const o = state.map.objects[t.obj];
    if (o && o.defId === 'monster' && getTerrain(t.t).water === water) return o;
  }
  return null;
}

/** If the hero's tile is guarded, start the monster encounter. @returns {boolean} */
export function triggerGuardAt(state, hero, events, then) {
  const guard = findGuard(state, hero.pos);
  if (!guard) return false;
  EFFECTS.monster.encounter(state, hero, guard, events, then);
  return true;
}

/** Fight an object's guard army; the object's `afterCombat` runs when the battle is over. */
export function fightObject(ctx, army, stage, extra = {}) {
  const { state, hero, obj, events } = ctx;
  fight(state, hero, events, { type: 'combat', heroId: hero.id, objectId: obj.id, defId: obj.defId, stage },
    { army: army.map((s) => (s ? { ...s } : null)) },
    { kind: 'adv_object', heroId: hero.id, objectId: obj.id, stage, then: ctx.then || null }, { pos: obj.pos, ...extra });
}

onCombatOutcome('adv_object', (state, context, result) => {
  const events = [];
  const obj = state.map.objects[context.objectId];
  if (!obj) return { ok: true, events };
  const hero = state.heroes[context.heroId] || null;
  const ctx = makeCtx(state, hero, obj, events);
  ctx.then = context.then || null;
  const won = attackerWon(result) && !!hero;
  const h = EFFECTS[ctx.fx.type];
  if (h.afterCombat) h.afterCombat(ctx, won, result, context);
  return { ok: true, events };
});

/** Resume what the hero was doing before a guard fight (`then` = `{type:'visit', objectId}`). */
export function runContinuation(state, hero, then, events) {
  if (!then || !hero || !state.heroes[hero.id]) return;
  if (then.type === 'visit') {
    const obj = state.map.objects[then.objectId];
    if (obj) interactWithObject(state, hero, obj, events);
  }
}

// ---- dispatcher ---------------------------------------------------------------------------------

/** Tile whose guards matter for an interaction with `obj`. */
function interactionTile(hero, obj, def) {
  return def.interact === 'adjacent' || def.effect.type === 'prison' ? obj.pos : hero.pos;
}

/**
 * Hero interacts with an object it can reach (guards first). Appends events.
 * @returns {boolean} true when something happened (false: inert scenery / non-matching event)
 */
export function interactWithObject(state, hero, obj, events) {
  const def = getMapObject(obj.defId);
  if (def.effect.type !== 'monster') {
    const guard = findGuard(state, interactionTile(hero, obj, def), obj.id);
    if (guard && !(def.effect.type === 'event' && !EFFECTS.event.matches(state, hero, obj))) {
      EFFECTS.monster.encounter(state, hero, guard, events, { type: 'visit', objectId: obj.id });
      return true;
    }
  }
  const ctx = makeCtx(state, hero, obj, events);
  const h = EFFECTS[ctx.fx.type];
  if (!h || !h.visit) return false;
  return h.visit(ctx) !== false;
}

/**
 * Player action: (re)visit an object the hero stands on (`enter` objects) or next to (`adjacent`).
 * Costs no movement.
 */
export function visitObject(state, heroId, objId) {
  const err = checkCanAct(state, heroId);
  if (err) return err;
  const hero = state.heroes[heroId];
  const obj = state.map.objects[objId];
  if (!obj) return fail('no_such_object');
  const def = getMapObject(obj.defId);
  if (!def.visitable || def.interact === 'none') return fail('not_visitable');
  const near = def.interact === 'adjacent' || def.effect.type === 'prison' ? isAdjacent(hero.pos, obj.pos) : samePos(hero.pos, obj.pos);
  if (!near) return fail('not_in_reach');
  const events = [];
  if (def.effect.type === 'town') return fail('use_town_screen');
  interactWithObject(state, hero, obj, events);
  const last = events[events.length - 1];
  if (events.length === 1 && last.refused) return fail(last.result, { events });
  return ok(events);
}

// ---- heroes & towns -----------------------------------------------------------------------------

/** Step onto another hero: allies meet (pending `hero_exchange`), enemies fight. */
export function meetOrFightHero(state, hero, other, events) {
  if (areAllies(state, hero.owner, other.owner)) {
    const res = deps.meetHeroes(state, hero.id, other.id);
    events.push({ type: 'hero_meeting', heroId: hero.id, otherHeroId: other.id });
    if (res && res.events) events.push(...res.events);
    pushPending(state, {
      kind: 'hero_exchange', playerId: hero.owner, heroId: hero.id,
      options: [{ id: 'done', label: 'Done' }], data: { otherHeroId: other.id },
    });
    return;
  }
  fight(state, hero, events, { type: 'combat', heroId: hero.id, defenderHeroId: other.id },
    { heroId: other.id }, { kind: 'adv_hero', heroId: hero.id, defenderHeroId: other.id, defenderOwner: other.owner }, { pos: other.pos });
}
registerPendingHandler('hero_exchange', () => ({ ok: true, events: [] }));

onCombatOutcome('adv_hero', (state, context, result) => {
  const events = [];
  const hero = state.heroes[context.heroId];
  if (attackerWon(result) && hero) {
    const player = getPlayer(state, hero.owner);
    if (player) { player.visited ??= {}; player.visited[`killed_hero_${context.defenderHeroId}`] = true; }
    if (context.teleportTo && !getHeroAt(state, context.teleportTo)) placeHero(state, hero, context.teleportTo, events, { teleport: true });
  }
  return { ok: true, events };
});

const townIsDefended = (state, town) => !armyIsEmpty(town.garrison) || !!town.visitingHero || !!town.garrisonHero;

/** Step onto a town entrance: enter an own/allied town, capture an empty one, besiege a defended one. */
export function visitTownTile(state, hero, obj, events) {
  const town = state.towns[obj.data.townId];
  if (!town) return;
  if (town.owner != null && areAllies(state, town.owner, hero.owner)) {
    if (town.visitingHero && town.visitingHero !== hero.id) {
      const other = state.heroes[town.visitingHero];
      if (other) { meetOrFightHero(state, hero, other, events); return; }
    }
    placeHero(state, hero, obj.pos, events);
    const res = deps.visitTown(state, hero.id, town.id);
    events.push({ type: 'town_enter', heroId: hero.id, townId: town.id });
    if (res && res.events) events.push(...res.events);
    return;
  }
  if (townIsDefended(state, town)) {
    fight(state, hero, events, { type: 'combat', heroId: hero.id, townId: town.id, siege: true },
      { townId: town.id }, { kind: 'adv_town', heroId: hero.id, townId: town.id, objectId: obj.id }, { pos: obj.pos, noOverlay: true });
    return;
  }
  takeTown(state, hero, town, obj, events);
}

function takeTown(state, hero, town, obj, events) {
  const res = deps.captureTown(state, town.id, hero.owner);
  obj.owner = hero.owner;
  events.push({ type: 'town_captured', heroId: hero.id, townId: town.id, playerId: hero.owner });
  if (res && res.events) events.push(...res.events);
  placeHero(state, hero, obj.pos, events);
  const v = deps.visitTown(state, hero.id, town.id);
  if (v && v.events) events.push(...v.events);
}

onCombatOutcome('adv_town', (state, context, result) => {
  const events = [];
  const hero = state.heroes[context.heroId];
  const town = state.towns[context.townId];
  const obj = state.map.objects[context.objectId];
  if (attackerWon(result) && hero && town && obj) {
    if (town.visitingHero && state.heroes[town.visitingHero]?.owner !== hero.owner) town.visitingHero = null;
    takeTown(state, hero, town, obj, events);
  }
  return { ok: true, events };
});

EFFECTS.town = { visit() { return false; } };

// ---- pickups ------------------------------------------------------------------------------------

EFFECTS.none = { visit() { return false; } };
EFFECTS.grail = { visit() { return false; } };
EFFECTS.boat = { visit() { return false; } };
EFFECTS.sanctuary = { visit(ctx) { note(ctx, 'sanctuary'); } };

EFFECTS.pickup = {
  visit(ctx) {
    const { state, hero, obj, fx, events } = ctx;
    // `data.reward` (fixed amount set by the map editor / a scenario) wins over the table roll
    const reward = resolveReward(state, obj.data && obj.data.reward ? obj.data.reward : rollTable(state.rng, fx.table).reward);
    removeObject(state, obj.id);
    events.push({ type: 'pickup', heroId: hero.id, objectId: obj.id, defId: obj.defId, reward, empty: rewardIsEmpty(reward) });
    applyReward(state, hero, reward, events, obj.defId);
  },
};

EFFECTS.chest = {
  visit(ctx) {
    const { state, hero, obj, fx, events } = ctx;
    let row = rollTable(state.rng, fx.table);
    if (row.artifact && !canCarryArtifact(hero)) row = fx.table[0];
    if (row.artifact) {
      const reward = resolveReward(state, { artifacts: [row.artifact] });
      removeObject(state, obj.id);
      events.push({ type: 'pickup', heroId: hero.id, objectId: obj.id, defId: obj.defId, reward });
      applyReward(state, hero, reward, events, obj.defId);
      return;
    }
    askChoice(ctx, 'chest_choice', [{ id: 'gold', label: 'Gold', gold: row.gold }, { id: 'exp', label: 'Experience', exp: row.exp }]);
    note(ctx, 'chest_choice', { gold: row.gold, exp: row.exp });
  },
};
registerPendingHandler('chest_choice', (state, pending, optionIndex) => {
  const events = [];
  const ctx = pendingCtx(state, pending, events);
  if (!ctx) return { ok: true, events };
  const opt = pending.options[optionIndex];
  const reward = opt.id === 'gold' ? { resources: { gold: opt.gold } } : { exp: opt.exp };
  removeObject(state, ctx.obj.id);
  events.push({ type: 'pickup', heroId: ctx.hero.id, objectId: ctx.obj.id, defId: ctx.obj.defId, reward });
  applyReward(state, ctx.hero, reward, events, ctx.obj.defId);
  return { ok: true, events };
});

/** Shared by `artifact` and `spell_scroll`. */
const artifactEffect = {
  visit(ctx) {
    const { hero, obj } = ctx;
    if (!canCarryArtifact(hero)) return refuse(ctx, 'backpack_full');
    if (obj.data.guards && !armyIsEmpty(obj.data.guards)) return void askConfirm(ctx, 'confirm_fight', { guards: obj.data.guards, stage: 'guards', then: ctx.then || null });
    if (!costIsZero(obj.data.cost)) {
      if (!deps.canAfford(ctx.state, hero.owner, obj.data.cost)) return refuse(ctx, 'cannot_afford', { cost: obj.data.cost });
      return void askConfirm(ctx, 'confirm_pay', { cost: obj.data.cost });
    }
    return artifactEffect.take(ctx);
  },
  confirmed(ctx, pending) {
    const { state, hero, obj } = ctx;
    if (pending.kind === 'confirm_fight') return fightObject(ctx, obj.data.guards, 'guards');
    if (!deps.pay(state, hero.owner, obj.data.cost)) return refuse(ctx, 'cannot_afford');
    obj.data.cost = null;
    return artifactEffect.take(ctx);
  },
  afterCombat(ctx, won, result) {
    if (!won) { ctx.obj.data.guards = defenderSurvivors(result); return; }
    ctx.obj.data.guards = null;
    artifactEffect.visit(ctx);
  },
  take(ctx) {
    const { state, hero, obj, events } = ctx;
    const entry = obj.defId === 'spell_scroll' || obj.data.artifactId === 'spell_scroll'
      ? { id: 'spell_scroll', spellId: obj.data.spellId } : obj.data.artifactId;
    removeObject(state, obj.id);
    events.push({ type: 'pickup', heroId: hero.id, objectId: obj.id, defId: obj.defId, reward: { artifacts: [entry] } });
    grantArtifact(state, hero, entry, events);
  },
};
EFFECTS.artifact = artifactEffect;
EFFECTS.spell_scroll = artifactEffect;

const PAYLOAD_KEYS = ['exp', 'mana', 'morale', 'luck', 'resources', 'primary', 'skills', 'artifacts', 'spells', 'creatures'];
function payloadOf(data) {
  const out = {};
  for (const k of PAYLOAD_KEYS) if (data[k] != null) out[k] = data[k];
  return out;
}

EFFECTS.pandoras_box = {
  visit(ctx) { askConfirm(ctx, 'confirm_open', { then: ctx.then || null }); note(ctx, 'confirm_open'); },
  confirmed(ctx) {
    const g = ctx.obj.data.guards;
    if (g && !armyIsEmpty(g)) return fightObject(ctx, g, 'guards');
    return EFFECTS.pandoras_box.open(ctx);
  },
  afterCombat(ctx, won, result) {
    if (!won) { ctx.obj.data.guards = defenderSurvivors(result); return; }
    ctx.obj.data.guards = null;
    EFFECTS.pandoras_box.open(ctx);
  },
  open(ctx) {
    const { state, hero, obj, events } = ctx;
    const payload = payloadOf(obj.data);
    removeObject(state, obj.id);
    events.push({ type: 'box_opened', heroId: hero.id, objectId: obj.id, defId: obj.defId, message: obj.data.message || null, payload });
    applyReward(state, hero, payload, events, obj.defId);
  },
};

EFFECTS.event = {
  matches(state, hero, obj) {
    const d = obj.data;
    const player = getPlayer(state, hero.owner);
    if (d.players && !d.players.includes(hero.owner)) return false;
    if (d.humanOnly && player && !player.isHuman) return false;
    if (d.aiOnly && player && player.isHuman) return false;
    return true;
  },
  visit(ctx) {
    if (!EFFECTS.event.matches(ctx.state, ctx.hero, ctx.obj)) return false;
    const g = ctx.obj.data.guards;
    if (g && !armyIsEmpty(g)) return void fightObject(ctx, g, 'guards');
    return EFFECTS.event.fire(ctx);
  },
  afterCombat(ctx, won, result) {
    if (!won) { ctx.obj.data.guards = defenderSurvivors(result); return; }
    ctx.obj.data.guards = null;
    EFFECTS.event.fire(ctx);
  },
  fire(ctx) {
    const { state, hero, obj, events } = ctx;
    const payload = payloadOf(obj.data);
    if (obj.data.once) removeObject(state, obj.id);
    events.push({ type: 'map_event', heroId: hero.id, objectId: obj.id, message: obj.data.message || null, payload });
    applyReward(state, hero, payload, events, obj.defId);
  },
};

// ---- income -------------------------------------------------------------------------------------

export function flagObject(ctx) {
  const { hero, obj, events } = ctx;
  const previous = obj.owner ?? null;
  obj.owner = hero.owner;
  events.push({ type: 'flagged', heroId: hero.id, objectId: obj.id, defId: obj.defId, playerId: hero.owner, previousOwner: previous });
  revealAround(ctx.state, hero.owner, obj.pos, 3);
}

/** Resource and daily amount a mine instance produces. */
export function mineOutput(obj) {
  const fx = getMapObject(obj.defId).effect;
  const resource = fx.resource === 'random' ? obj.data.resource : fx.resource;
  const amount = fx.amountByResource ? (fx.amountByResource[resource] ?? fx.amount) : fx.amount;
  return { resource, amount };
}

EFFECTS.mine = {
  visit(ctx) {
    const { state, hero, obj } = ctx;
    if (obj.data.cleared === false && obj.data.guards && !armyIsEmpty(obj.data.guards)) {
      note(ctx, 'guarded');
      return void askConfirm(ctx, 'confirm_fight', { guards: obj.data.guards, stage: 'guards', then: ctx.then || null });
    }
    if (obj.owner != null && areAllies(state, obj.owner, hero.owner)) return note(ctx, 'already_owned', { garrison: obj.data.garrison || null });
    if (obj.data.garrison && !armyIsEmpty(obj.data.garrison)) {
      note(ctx, 'guarded');
      return void askConfirm(ctx, 'confirm_fight', { guards: obj.data.garrison, stage: 'garrison', then: ctx.then || null });
    }
    return flagObject(ctx);
  },
  confirmed(ctx, pending) {
    const stage = pending.data.stage;
    fightObject(ctx, stage === 'garrison' ? ctx.obj.data.garrison : ctx.obj.data.guards, stage);
  },
  afterCombat(ctx, won, result, context) {
    const key = context.stage === 'garrison' ? 'garrison' : 'guards';
    if (!won) { ctx.obj.data[key] = defenderSurvivors(result); return; }
    ctx.obj.data[key] = null;
    if (key === 'guards') ctx.obj.data.cleared = true;
    flagObject(ctx);
  },
};

EFFECTS.weekly_reward = {
  visit(ctx) {
    const { state, hero, fx } = ctx;
    if (alreadyVisited(ctx)) return note(ctx, 'already_visited');
    if (!costIsZero(fx.cost)) {
      if (!deps.canAfford(state, hero.owner, fx.cost)) return refuse(ctx, 'cannot_afford', { cost: fx.cost });
      return void askConfirm(ctx, 'confirm_pay', { cost: fx.cost });
    }
    return EFFECTS.weekly_reward.take(ctx);
  },
  confirmed(ctx) {
    if (!deps.pay(ctx.state, ctx.hero.owner, ctx.fx.cost)) return refuse(ctx, 'cannot_afford');
    return EFFECTS.weekly_reward.take(ctx);
  },
  take(ctx) {
    const { state, hero, obj, events } = ctx;
    markVisited(ctx);
    note(ctx, rewardIsEmpty(obj.data.reward) ? 'nothing' : 'reward', { reward: obj.data.reward });
    applyReward(state, hero, obj.data.reward, events, obj.defId);
  },
};

function applyPenalty(ctx, list) {
  for (const p of list || []) {
    deps.addTempBonus(ctx.state, ctx.hero.id, ctx.obj.defId, p.bonus, p.until);
    ctx.events.push({ type: 'temp_bonus', heroId: ctx.hero.id, bonus: p.bonus, until: p.until });
  }
}

EFFECTS.reward_once = {
  visit(ctx) {
    if (ctx.fx.confirm) { note(ctx, 'confirm_search'); return void askConfirm(ctx, 'confirm_search', { visited: !!ctx.obj.data.visited }); }
    if (ctx.obj.data.visited) return note(ctx, 'already_visited');
    return EFFECTS.reward_once.take(ctx);
  },
  confirmed(ctx) { EFFECTS.reward_once.take(ctx); },
  take(ctx) {
    const { state, hero, obj, fx, events } = ctx;
    if (obj.data.visited) {
      note(ctx, 'nothing_left');
      if (fx.penaltyWhenEmpty) applyPenalty(ctx, fx.penalty);
      return;
    }
    obj.data.visited = true;
    note(ctx, rewardIsEmpty(obj.data.reward) ? 'nothing' : 'reward', { reward: obj.data.reward });
    applyReward(state, hero, obj.data.reward, events, obj.defId);
    applyPenalty(ctx, fx.penalty);
  },
};

// ---- creature banks -----------------------------------------------------------------------------

EFFECTS.bank = {
  visit(ctx) {
    const { obj, fx } = ctx;
    if (obj.data.cleared) {
      note(ctx, 'nothing_left');
      applyPenalty(ctx, fx.emptyPenalty);
      return;
    }
    note(ctx, 'guarded');
    askConfirm(ctx, 'confirm_fight', { guards: obj.data.guards, stage: 'bank', then: ctx.then || null });
  },
  confirmed(ctx) { fightObject(ctx, ctx.obj.data.guards, 'bank', { bank: true }); },
  afterCombat(ctx, won, result) {
    const { state, hero, obj, events } = ctx;
    if (!won) { obj.data.guards = defenderSurvivors(result); return; }
    obj.data.guards = null;
    obj.data.visited = true;
    obj.data.cleared = true;
    note(ctx, 'bank_cleared', { reward: obj.data.reward });
    applyReward(state, hero, obj.data.reward, events, obj.defId);
  },
};

// ---- permanent boosters -------------------------------------------------------------------------

EFFECTS.primary_boost = {
  visit(ctx) {
    const { state, hero, fx } = ctx;
    if (alreadyVisited(ctx)) return note(ctx, 'already_visited');
    const paid = !costIsZero(fx.cost);
    if (paid && !deps.canAfford(state, hero.owner, fx.cost)) return refuse(ctx, 'cannot_afford', { cost: fx.cost });
    if (fx.options.length === 1 && !paid) return EFFECTS.primary_boost.apply(ctx, fx.options[0]);
    const options = fx.options.map((o) => ({ id: o.stat, label: o.stat, stat: o.stat, value: o.value }));
    if (paid) options.push({ id: 'decline', label: 'Leave' });
    askChoice(ctx, 'primary_choice', options, { cost: fx.cost || null });
    return note(ctx, 'primary_choice');
  },
  apply(ctx, opt) {
    ctx.hero.primary[opt.stat] += opt.value;
    markVisited(ctx);
    note(ctx, 'primary', { stat: opt.stat, value: opt.value });
  },
};
registerPendingHandler('primary_choice', (state, pending, optionIndex) => {
  const events = [];
  const ctx = pendingCtx(state, pending, events);
  if (!ctx) return { ok: true, events };
  const opt = pending.options[optionIndex];
  if (opt.id === 'decline') { note(ctx, 'declined'); return { ok: true, events }; }
  if (!costIsZero(ctx.fx.cost) && !deps.pay(state, ctx.hero.owner, ctx.fx.cost)) return { ok: false, error: 'cannot_afford' };
  EFFECTS.primary_boost.apply(ctx, opt);
  return { ok: true, events };
});

/** Shared "optional price, then effect" flow. */
function paidVisit(cost, apply) {
  return {
    visit(ctx) {
      if (alreadyVisited(ctx)) return note(ctx, 'already_visited');
      const c = cost(ctx);
      if (!costIsZero(c)) {
        if (!deps.canAfford(ctx.state, ctx.hero.owner, c)) return refuse(ctx, 'cannot_afford', { cost: c });
        return void askConfirm(ctx, 'confirm_pay', { cost: c });
      }
      return apply(ctx);
    },
    confirmed(ctx) {
      if (!deps.pay(ctx.state, ctx.hero.owner, cost(ctx))) return refuse(ctx, 'cannot_afford');
      return apply(ctx);
    },
  };
}

function giveExp(ctx, amount) {
  const res = deps.giveExperience(ctx.state, ctx.hero.id, amount);
  ctx.events.push({ type: 'exp', heroId: ctx.hero.id, amount });
  if (res && res.events) ctx.events.push(...res.events);
}

EFFECTS.exp_boost = paidVisit((ctx) => ctx.fx.cost, (ctx) => {
  const amount = (ctx.fx.exp || 0) + (ctx.fx.expPerLevel || 0) * ctx.hero.level;
  markVisited(ctx);
  note(ctx, 'exp', { amount });
  giveExp(ctx, amount);
});

EFFECTS.level_up = paidVisit((ctx) => ctx.obj.data.cost, (ctx) => {
  const { hero } = ctx;
  markVisited(ctx);
  if (hero.level >= MAX_HERO_LEVEL) return note(ctx, 'nothing');
  const amount = Math.max(0, expForLevel(hero.level + 1) - hero.exp);
  note(ctx, 'level_up', { amount });
  return giveExp(ctx, amount);
});

EFFECTS.library = {
  visit(ctx) {
    const { hero, fx } = ctx;
    if (alreadyVisited(ctx)) return note(ctx, 'already_visited');
    const need = fx.minLevel - (fx.diplomacyLevelReduction[deps.getSkillLevel(hero, 'diplomacy')] || 0);
    if (hero.level < need) return note(ctx, 'not_ready', { requiredLevel: need });
    for (const s of PRIMARY_SKILLS) hero.primary[s] += fx.value;
    markVisited(ctx);
    return note(ctx, 'primary_all', { value: fx.value });
  },
};

const canLearnSkill = (hero, id) => !hero.skills.some((s) => s.id === id) && hero.skills.length < MAX_SECONDARY_SKILLS;

EFFECTS.learn_skill = {
  visit(ctx) {
    const { state, hero, obj, fx } = ctx;
    if (alreadyVisited(ctx)) return note(ctx, 'already_visited');
    if (fx.mode === 'upgrade_existing') {
      const pool = hero.skills.filter((s) => s.level < 3);
      if (!pool.length) return note(ctx, 'nothing');
      const s = pick(state.rng, pool);
      s.level += 1;
      markVisited(ctx);
      return note(ctx, 'skill_upgraded', { skillId: s.id, level: s.level });
    }
    const skills = obj.data.skills;
    learnAbout(ctx, { skills });
    const paid = !costIsZero(fx.cost);
    if (skills.length === 1 && !paid) {
      markVisited(ctx);
      if (!canLearnSkill(hero, skills[0])) return note(ctx, 'skill_not_learned', { skillId: skills[0] });
      grantSkill(hero, skills[0], fx.level || 1);
      return note(ctx, 'skill_learned', { skillId: skills[0], level: fx.level || 1 });
    }
    const options = skills.map((id) => ({ id, label: id, skillId: id, available: canLearnSkill(hero, id) }));
    options.push({ id: 'decline', label: 'Leave' });
    askChoice(ctx, 'skill_choice', options, { cost: fx.cost || null, level: fx.level || 1 });
    return note(ctx, 'skill_choice', { skills });
  },
};
registerPendingHandler('skill_choice', (state, pending, optionIndex) => {
  const events = [];
  const ctx = pendingCtx(state, pending, events);
  if (!ctx) return { ok: true, events };
  const opt = pending.options[optionIndex];
  if (opt.id === 'decline') { note(ctx, 'declined'); return { ok: true, events }; }
  const requeue = (error) => { state.pending.push(pending); return { ok: false, error }; };
  if (!canLearnSkill(ctx.hero, opt.skillId)) return requeue('cannot_learn');
  if (!costIsZero(ctx.fx.cost) && !deps.pay(state, ctx.hero.owner, ctx.fx.cost)) return requeue('cannot_afford');
  grantSkill(ctx.hero, opt.skillId, pending.data.level || 1);
  markVisited(ctx);
  note(ctx, 'skill_learned', { skillId: opt.skillId, level: pending.data.level || 1 });
  return { ok: true, events };
});

EFFECTS.scholar = {
  visit(ctx) {
    const { state, hero, obj } = ctx;
    const d = obj.data;
    removeObject(state, obj.id);
    const randomPrimary = () => {
      const stat = pick(state.rng, PRIMARY_SKILLS);
      hero.primary[stat] += 1;
      note(ctx, 'primary', { stat, value: 1, fallback: true });
    };
    if (d.kind === 'primary') {
      hero.primary[d.stat] += 1;
      return note(ctx, 'primary', { stat: d.stat, value: 1 });
    }
    if (d.kind === 'skill') {
      // original (VCMI CGScholar): a known skill below Expert is raised one level; an unknown one is
      // learned at Basic if there is a free slot; otherwise (Expert / no slot) +1 random primary.
      const have = hero.skills.find((s) => s.id === d.skillId);
      if (have && have.level < 3) {
        have.level += 1;
        return note(ctx, 'skill_upgraded', { skillId: d.skillId, level: have.level });
      }
      if (have || !canLearnSkill(hero, d.skillId)) return randomPrimary();
      grantSkill(hero, d.skillId, 1);
      return note(ctx, 'skill_learned', { skillId: d.skillId, level: 1 });
    }
    if (d.spellId && deps.canLearnSpell(state, hero, d.spellId)) {
      const res = deps.learnSpell(state, hero.id, d.spellId);
      if (!res || res.ok !== false) return note(ctx, 'spell_learned', { spellId: d.spellId });
    }
    return randomPrimary();
  },
};

EFFECTS.learn_spell = {
  visit(ctx) {
    const { state, hero, obj } = ctx;
    const spellId = obj.data.spellId;
    learnAbout(ctx, { spellId });
    if (alreadyVisited(ctx) || (hero.spells || []).includes(spellId)) { markVisited(ctx); return note(ctx, 'already_visited', { spellId }); }
    if (!deps.canLearnSpell(state, hero, spellId)) {
      const reason = !hasArtifact(hero, 'spellbook') ? 'no_spellbook' : 'needs_wisdom';
      return note(ctx, 'cannot_learn', { spellId, reason, level: getSpell(spellId).level });
    }
    const res = deps.learnSpell(state, hero.id, spellId);
    if (res && res.ok === false) return note(ctx, 'cannot_learn', { spellId, reason: res.error });
    markVisited(ctx);
    return note(ctx, 'spell_learned', { spellId });
  },
};

// ---- temporary bonuses --------------------------------------------------------------------------

EFFECTS.temp_bonus = paidVisit((ctx) => ctx.fx.cost, (ctx) => {
  const { state, hero, fx, def, events } = ctx;
  const bonuses = [...(fx.bonuses || [])];
  const day = dayOfWeek(state);
  for (const v of fx.variants || []) if (v.days.includes(day)) bonuses.push(...v.bonuses);
  if (fx.random) bonuses.push({ type: fx.random.bonus, value: randInt(state.rng, fx.random.min, fx.random.max) });
  for (const b of bonuses) deps.addTempBonus(state, hero.id, def.id, b, fx.until);
  if (def.revisit === 'per_battle' && !bonuses.length) deps.addTempBonus(state, hero.id, def.id, { type: 'morale', value: 0 }, fx.until);
  if (fx.movement) hero.movePoints += fx.movement;
  if (fx.endMovement) hero.movePoints = 0;
  const upgraded = [];
  for (const u of fx.upgrade || []) {
    for (const s of armyStacks(hero.army)) {
      if (s.creatureId === u.from) { s.creatureId = u.to; upgraded.push({ from: u.from, to: u.to, count: s.count }); }
    }
  }
  markVisited(ctx);
  note(ctx, 'temp_bonus', { bonuses, until: fx.until, movement: fx.movement || 0, endMovement: !!fx.endMovement, upgraded });
  void events;
});

EFFECTS.mana_restore = {
  visit(ctx) {
    const { state, hero, fx } = ctx;
    if (alreadyVisited(ctx)) return note(ctx, 'already_visited');
    const max = deps.getMaxMana(state, hero);
    const before = hero.mana;
    if (fx.mode === 'add') hero.mana += fx.amount;
    else {
      const target = fx.mode === 'double' ? 2 * max : max;
      if (hero.mana >= target) return note(ctx, 'already_full');
      hero.mana = target;
    }
    markVisited(ctx);
    return note(ctx, 'mana', { amount: hero.mana - before, mana: hero.mana });
  },
};

// ---- information --------------------------------------------------------------------------------

function doReveal(ctx) {
  const { state, hero, obj, fx } = ctx;
  let fresh = 0;
  if (fx.mode === 'radius') fresh = revealAround(state, hero.owner, obj.pos, fx.radius);
  else if (fx.mode === 'kind') {
    const pred = {
      water: (tile) => getTerrain(tile.t).water,
      sea: (tile) => getTerrain(tile.t).water,
      surface: (tile, x, y, z) => z === 0 && !getTerrain(tile.t).water,
      underground: (tile, x, y, z) => z === 1,
    }[fx.kind];
    fresh = revealWhere(state, hero.owner, pred);
  } else if (fx.mode === 'objects') {
    for (const o of objectsByDef(state, fx.objectDefId)) fresh += revealAround(state, hero.owner, o.pos, fx.radius);
  }
  markVisited(ctx);
  note(ctx, 'map_revealed', { tiles: fresh, mode: fx.mode });
}
EFFECTS.reveal_map = paidVisit((ctx) => ctx.fx.cost, doReveal);

EFFECTS.hide_map = {
  visit(ctx) {
    const { state, hero, obj, fx } = ctx;
    const hidden = {};
    for (const p of state.players) {
      if (areAllies(state, p.id, hero.owner)) continue;
      hidden[p.id] = hideAround(state, p.id, obj.pos, fx.radius);
    }
    note(ctx, 'map_hidden', { hidden });
  },
};

EFFECTS.message = {
  visit(ctx) {
    const { state, obj, def, events, hero } = ctx;
    events.push({ type: 'message', heroId: hero.id, objectId: obj.id, defId: obj.defId, text: obj.data.text || '' });
    if (def.removable) removeObject(state, obj.id);
  },
};

// ---- keys & border guards -----------------------------------------------------------------------

EFFECTS.keymaster_tent = {
  visit(ctx) {
    const { player, fx } = ctx;
    const had = !!player.visited?.[`key_${fx.color}`];
    player.visited ??= {};
    player.visited[`key_${fx.color}`] = true;
    markVisited(ctx);
    note(ctx, had ? 'already_visited' : 'key', { color: fx.color });
  },
};

EFFECTS.border_guard = {
  visit(ctx) {
    const { state, hero, fx } = ctx;
    const key = state.players.some((p) => areAllies(state, p.id, hero.owner) && p.visited?.[`key_${fx.color}`]);
    if (fx.permanent) return note(ctx, key ? 'gate_open' : 'no_key', { color: fx.color });
    if (!key) return note(ctx, 'no_key', { color: fx.color });
    note(ctx, 'confirm_pass', { color: fx.color });
    return void askConfirm(ctx, 'confirm_pass', { color: fx.color });
  },
  confirmed(ctx) {
    removeObject(ctx.state, ctx.obj.id);
    note(ctx, 'guard_removed', { color: ctx.fx.color });
  },
};

// ---- teleports ----------------------------------------------------------------------------------

/** Whirlpool loss: weakest stack loses max(1, floor(count/2)); exempt for a single creature. */
export function whirlpoolLoss(hero, loss) {
  const stacks = hero.army.map((s, slot) => (s ? { s, slot } : null)).filter(Boolean);
  const total = stacks.reduce((n, e) => n + e.s.count, 0);
  if (loss.exemptSingleCreature && total <= 1) return null;
  let weakest = null;
  for (const e of stacks) {
    const v = e.s.count * getCreature(e.s.creatureId).aiValue;
    if (!weakest || v < weakest.v) weakest = { ...e, v };
  }
  if (!weakest) return null;
  const lost = Math.max(loss.min || 1, Math.floor(weakest.s.count * loss.percent / 100));
  const creatureId = weakest.s.creatureId;
  weakest.s.count -= lost;
  if (weakest.s.count <= 0) hero.army[weakest.slot] = null;
  return { slot: weakest.slot, creatureId, lost };
}

EFFECTS.teleport = {
  visit(ctx) {
    const { hero, fx } = ctx;
    if (fx.kind === 'one_way_exit') return false;
    if (fx.loss) {
      const safe = (fx.loss.protectedBy?.artifactIds || []).some((a) => ownsArtifact(hero, a));
      const total = armyStacks(hero.army).reduce((n, s) => n + s.count, 0);
      if (!safe && !(fx.loss.exemptSingleCreature && total <= 1)) {
        note(ctx, 'confirm_whirlpool');
        return void askConfirm(ctx, 'confirm_whirlpool');
      }
    }
    return EFFECTS.teleport.go(ctx, false);
  },
  confirmed(ctx) { EFFECTS.teleport.go(ctx, true); },
  go(ctx, applyLoss) {
    const { state, hero, obj, fx, events } = ctx;
    const all = teleportDestinations(state, obj);
    if (!all.length) return note(ctx, 'no_exit');
    const usable = all.filter((d) => {
      const h = getHeroAt(state, d.pos);
      return !h || !areAllies(state, h.owner, hero.owner);
    });
    if (!usable.length) return note(ctx, 'exit_occupied');
    const dest = pick(state.rng, usable);
    if (applyLoss && fx.loss) {
      const lost = whirlpoolLoss(hero, fx.loss);
      if (lost) events.push({ type: 'whirlpool_loss', heroId: hero.id, ...lost });
    }
    const enemy = getHeroAt(state, dest.pos);
    if (enemy) {
      fight(state, hero, events, { type: 'combat', heroId: hero.id, defenderHeroId: enemy.id }, { heroId: enemy.id },
        { kind: 'adv_hero', heroId: hero.id, defenderHeroId: enemy.id, defenderOwner: enemy.owner, teleportTo: copyPos(dest.pos) }, { pos: dest.pos });
      return undefined;
    }
    note(ctx, 'teleport', { to: copyPos(dest.pos), exitId: dest.id });
    placeHero(state, hero, dest.pos, events, { teleport: true });
    return undefined;
  },
};

export { objectsByEffect, armyStrength };

// Register the remaining effect types (side-effect imports keep EFFECTS complete for every importer).
import './services.js';
import './quests.js';
import './monsters.js';
