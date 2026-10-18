// Adventure spells (docs/mechanics/spells.md §13): Summon/Scuttle Boat, Visions, View Earth/Air,
// Disguise, Fly, Water Walk, Dimension Door, Town Portal.
import { getTerrain } from '../../data/terrain.js';
import { getMapObject } from '../../data/mapObjects.js';
import { getSpell, castingMastery, spellCost, spellSchools } from '../../data/spells.js';
import { getCreature } from '../../data/creatures.js';
import { hasArtifact } from '../artifacts.js';
import { pushPending, registerPendingHandler } from '../pending.js';
import { deps } from './deps.js';
import { getTile, getHeroAt, removeObject, relocateObject, objectsByDef } from './map.js';
import { findFreeWaterTile, createBoat } from './transport.js';
import { triggerGuardAt } from './visit.js';
import { evaluateMonster } from './monsters.js';
import { placeHero, checkCanAct } from './movement.js';
import { ok, fail, chebyshev, dist2, isAdjacent, copyPos, randInt, areAllies, armyStacks } from './util.js';

/** Mastery (0..3) with which the hero casts the spell. */
export function getSpellMastery(state, hero, spell) {
  const map = {};
  for (const b of deps.getHeroBonuses(state, hero)) {
    if (b.type === 'spell_school_mastery') {
      if (b.school === 'all') for (const s of ['air', 'earth', 'fire', 'water']) map[s] = Math.max(map[s] || 0, b.level || 0);
      else map[b.school] = Math.max(map[b.school] || 0, b.level || 0);
    }
  }
  return castingMastery(spell, map);
}

export function getAdventureSpellCost(state, hero, spell) {
  const schools = spellSchools(spell);
  let delta = 0;
  for (const b of deps.getHeroBonuses(state, hero)) {
    if (b.type === 'spell_cost' && (!b.school || schools.includes(b.school)) && (!b.spellId || b.spellId === spell.id)) delta += b.value || 0;
  }
  return spellCost(spell, getSpellMastery(state, hero, spell), delta);
}

function setDayFlag(state, hero, source, bonus) {
  hero.temp = (hero.temp || []).filter((t) => t.source !== source);
  deps.addTempBonus(state, hero.id, source, bonus, 'end_of_day');
}

function dimensionDoorUses(state, hero) {
  return hero.ddUses && hero.ddUses.turn === state.turn ? hero.ddUses.count : 0;
}

function ownTownsFree(state, hero) {
  return Object.values(state.towns).filter((t) => t.owner === hero.owner && (!t.visitingHero || t.visitingHero === hero.id));
}

function portalTo(state, hero, town, events) {
  placeHero(state, hero, town.pos, events, { teleport: true });
  const res = deps.visitTown(state, hero.id, town.id);
  events.push({ type: 'town_enter', heroId: hero.id, townId: town.id });
  if (res && res.events) events.push(...res.events);
}

/** action -> (c) => {error} | {success, ...event fields}. `c.spend()` must be called once the cast is accepted. */
const ACTIONS = {
  summon_boat(c) {
    const { state, hero, spell, m } = c;
    if (hero.inBoat) return { error: 'in_boat' };
    const water = findFreeWaterTile(state, hero.pos);
    if (!water) return { error: 'no_water' };
    c.spend();
    if (randInt(state.rng, 1, 100) > spell.power[m]) return { success: false, reason: 'failed' };
    const z = hero.pos.z || 0;
    const boats = objectsByDef(state, 'boat').filter((b) => !b.data.heroId && (b.pos.z || 0) === z && b.data.owner === hero.owner && !isAdjacent(b.pos, hero.pos));
    boats.sort((a, b) => dist2(a.pos, hero.pos) - dist2(b.pos, hero.pos) || (a.id < b.id ? -1 : 1));
    if (boats.length) {
      relocateObject(state, boats[0], water);
      return { success: true, boatId: boats[0].id, pos: water, created: false };
    }
    if (!spell.effect.createsBoat[m]) return { success: false, reason: 'no_boat' };
    const boat = createBoat(state, water, hero.owner);
    return { success: true, boatId: boat.id, pos: water, created: true };
  },
  scuttle_boat(c) {
    const { state, hero, spell, m, target } = c;
    const near = objectsByDef(state, 'boat').filter((b) => !b.data.heroId && (b.pos.z || 0) === (hero.pos.z || 0) && chebyshev(b.pos, hero.pos) <= spell.effect.range);
    let boat = null;
    if (target && target.objectId) boat = near.find((b) => b.id === target.objectId) || null;
    else if (target && target.x != null) boat = near.find((b) => b.pos.x === target.x && b.pos.y === target.y) || null;
    else boat = near[0] || null;
    if (!boat) return { error: 'no_boat_in_range' };
    c.spend();
    if (randInt(state.rng, 1, 100) > spell.power[m]) return { success: false, reason: 'failed' };
    removeObject(state, boat.id);
    return { success: true, boatId: boat.id };
  },
  visions(c) {
    const { state, hero, spell, m } = c;
    c.spend();
    const range = Math.max(spell.effect.minRange, spell.power[m] * deps.getPrimary(state, hero).power);
    setDayFlag(state, hero, 'visions', { type: 'visions', range, shows: spell.effect.shows[m] });
    return { success: true, range, info: getVisionsInfo(state, hero.id) };
  },
  view_earth(c) {
    const { state, spell, m } = c;
    c.spend();
    const shows = spell.effect.shows[m];
    const out = { success: true, shows, resources: [], mines: [], terrain: shows.includes('terrain') };
    for (const o of Object.values(state.map.objects)) {
      const def = getMapObject(o.defId);
      if (def.category === 'resource') out.resources.push({ objectId: o.id, defId: o.defId, pos: copyPos(o.pos) });
      if (shows.includes('mines') && def.effect.type === 'mine') out.mines.push({ objectId: o.id, defId: o.defId, pos: copyPos(o.pos), owner: o.owner ?? null });
    }
    return out;
  },
  view_air(c) {
    const { state, spell, m } = c;
    c.spend();
    const shows = spell.effect.shows[m];
    const out = { success: true, shows, artifacts: [], heroes: [], towns: [] };
    for (const o of Object.values(state.map.objects)) {
      const t = getMapObject(o.defId).effect.type;
      if (t === 'artifact' || t === 'spell_scroll') out.artifacts.push({ objectId: o.id, defId: o.defId, pos: copyPos(o.pos) });
    }
    if (shows.includes('heroes')) for (const h of Object.values(state.heroes)) if (!h.garrisoned) out.heroes.push({ heroId: h.id, owner: h.owner, pos: copyPos(h.pos) });
    if (shows.includes('towns')) for (const t of Object.values(state.towns)) out.towns.push({ townId: t.id, owner: t.owner ?? null, pos: copyPos(t.pos) });
    return out;
  },
  disguise(c) {
    const { state, hero, spell, m } = c;
    c.spend();
    setDayFlag(state, hero, 'disguise', { type: 'disguise', mode: spell.effect.mode[m] });
    return { success: true, mode: spell.effect.mode[m] };
  },
  fly(c) {
    if (c.hero.inBoat) return { error: 'in_boat' };
    c.spend();
    setDayFlag(c.state, c.hero, 'spell:fly', { type: 'fly', mastery: c.m });
    return { success: true };
  },
  water_walk(c) {
    if (c.hero.inBoat) return { error: 'in_boat' };
    c.spend();
    setDayFlag(c.state, c.hero, 'spell:water_walk', { type: 'water_walk', mastery: c.m });
    return { success: true };
  },
  dimension_door(c) {
    const { state, hero, spell, m, target, events } = c;
    const fx = spell.effect;
    if (!target || target.x == null) return { error: 'no_target' };
    const uses = dimensionDoorUses(state, hero);
    if (uses >= fx.usesPerDay[m]) return { error: 'no_uses_left' };
    if (hero.movePoints < fx.moveCost[m]) return { error: 'no_movement_points' };
    const dest = { x: target.x, y: target.y, z: hero.pos.z || 0 };
    const tile = getTile(state.map, dest);
    const bad = { error: 'cannot_teleport_there' };
    if (!tile || (target.z != null && target.z !== dest.z)) return bad;
    const d = chebyshev(dest, hero.pos);
    if (d < 1 || d > fx.range[m]) return bad;
    const ter = getTerrain(tile.t);
    if (!ter.passable || tile.blocked || tile.obj || getHeroAt(state, dest) || ter.water !== !!hero.inBoat) return bad;
    c.spend();
    hero.movePoints -= fx.moveCost[m];
    hero.ddUses = { turn: state.turn, count: uses + 1 };
    placeHero(state, hero, dest, events, { teleport: true });
    triggerGuardAt(state, hero, events, null);
    return { success: true, to: dest, usesLeft: fx.usesPerDay[m] - uses - 1 };
  },
  town_portal(c) {
    const { state, hero, spell, m, target, events } = c;
    const fx = spell.effect;
    if (hero.inBoat) return { error: 'in_boat' };
    if (hero.movePoints < fx.moveCost[m]) return { error: 'no_movement_points' };
    const own = Object.values(state.towns).filter((t) => t.owner === hero.owner);
    if (!own.length) return { error: 'no_town' };
    const free = ownTownsFree(state, hero).filter((t) => t.id !== hero.townId);
    let town = null;
    if (fx.chooseTown[m]) {
      if (!free.length) return { error: 'no_free_town' };
      if (target && target.townId) {
        town = free.find((t) => t.id === target.townId) || null;
        if (!town) return { error: 'bad_town' };
      } else {
        pushPending(state, {
          kind: 'town_portal', playerId: hero.owner, heroId: hero.id,
          options: [...free.map((t) => ({ id: t.id, label: t.name, townId: t.id })), { id: 'cancel', label: 'Cancel' }],
          data: { spellId: spell.id },
        });
        return { pending: true };
      }
    } else {
      const sorted = own.filter((t) => t.id !== hero.townId).sort((a, b) => dist2(a.pos, hero.pos) - dist2(b.pos, hero.pos) || (a.id < b.id ? -1 : 1));
      town = sorted[0] || null;
      if (!town) return { error: 'no_town' };
      if (town.visitingHero && town.visitingHero !== hero.id) return { error: 'town_occupied' };
    }
    c.spend();
    hero.movePoints -= fx.moveCost[m];
    portalTo(state, hero, town, events);
    return { success: true, townId: town.id };
  },
};

registerPendingHandler('town_portal', (state, pending, optionIndex) => {
  const opt = pending.options[optionIndex];
  if (opt.id === 'cancel') return { ok: true, events: [] };
  return castAdventureSpell(state, pending.heroId, pending.data.spellId, { townId: opt.townId });
});

/**
 * Cast an adventure spell with the hero.
 * target: Dimension Door `{x, y}`; Town Portal (advanced+) `{townId}` (omitted -> pending `town_portal`);
 * Scuttle Boat `{objectId}` or `{x, y}` (optional).
 * Result events end with `{type:'spell_cast', spellId, heroId, success, ...details}`.
 */
export function castAdventureSpell(state, heroId, spellId, target = null) {
  const err = checkCanAct(state, heroId);
  if (err) return err;
  const hero = state.heroes[heroId];
  const spell = getSpell(spellId);
  if (spell.kind !== 'adventure') return fail('not_an_adventure_spell');
  if (!hasArtifact(hero, 'spellbook')) return fail('no_spellbook');
  if (!deps.getHeroSpells(state, hero).includes(spellId)) return fail('spell_unknown');
  const m = getSpellMastery(state, hero, spell);
  const cost = getAdventureSpellCost(state, hero, spell);
  if (hero.mana < cost) return fail('not_enough_mana');
  const events = [];
  let spent = false;
  const c = { state, hero, spell, m, target, events, spend() { hero.mana -= cost; spent = true; } };
  const res = ACTIONS[spell.effect.action](c);
  if (res.error) return fail(res.error);
  if (res.pending) return ok(events, { pending: true });
  events.push({ type: 'spell_cast', spellId, heroId, mastery: m, cost: spent ? cost : 0, ...res });
  return ok(events, { success: !!res.success });
}

// ---- lasting effects queried by the UI / AI -----------------------------------------------------

function tempBonus(hero, type) {
  const t = (hero.temp || []).find((x) => x.bonus && x.bonus.type === type);
  return t ? t.bonus : null;
}

/**
 * Exact information granted by an active Visions spell: monsters (count + what they will do),
 * enemy heroes (advanced+), enemy towns (expert) within range. Empty when Visions is not active.
 */
export function getVisionsInfo(state, heroId) {
  const hero = state.heroes[heroId];
  const out = { monsters: [], heroes: [], towns: [] };
  const v = hero && tempBonus(hero, 'visions');
  if (!v) return out;
  const inRange = (pos) => (pos.z || 0) === (hero.pos.z || 0) && chebyshev(pos, hero.pos) <= v.range;
  for (const o of objectsByDef(state, 'monster')) {
    if (!inRange(o.pos)) continue;
    const ev = evaluateMonster(state, hero, o);
    out.monsters.push({ objectId: o.id, pos: copyPos(o.pos), creatureId: o.data.creatureId, count: o.data.count, outcome: ev.outcome, cost: ev.cost });
  }
  if (v.shows.includes('heroes')) {
    for (const h of Object.values(state.heroes)) {
      if (h.garrisoned || areAllies(state, h.owner, hero.owner) || !inRange(h.pos)) continue;
      out.heroes.push({ heroId: h.id, owner: h.owner, pos: copyPos(h.pos), primary: deps.getPrimary(state, h), mana: h.mana, army: h.army.map((s) => (s ? { ...s } : null)) });
    }
  }
  if (v.shows.includes('towns')) {
    for (const t of Object.values(state.towns)) {
      if (t.owner == null || areAllies(state, t.owner, hero.owner) || !inRange(t.pos)) continue;
      out.towns.push({ townId: t.id, owner: t.owner, pos: copyPos(t.pos), garrison: t.garrison.map((s) => (s ? { ...s } : null)), buildings: t.buildings.slice() });
    }
  }
  return out;
}

/**
 * The army of a hero as another player sees it (Disguise). Allies always see the truth.
 * `null` slots stay null; mode `hidden` returns null (no information).
 */
export function getDisplayedArmy(state, heroId, viewerPlayerId) {
  const hero = state.heroes[heroId];
  const real = hero.army.map((s) => (s ? { ...s } : null));
  const d = tempBonus(hero, 'disguise');
  if (!d || areAllies(state, hero.owner, viewerPlayerId)) return real;
  if (d.mode === 'hidden') return null;
  const stacks = armyStacks(hero.army);
  if (!stacks.length) return real;
  const value = (s) => getCreature(s.creatureId).aiValue * s.count;
  const strongest = stacks.reduce((a, b) => (value(b) > value(a) ? b : a));
  if (d.mode === 'strongest_stack') return real.map((s) => (s ? { creatureId: strongest.creatureId, count: strongest.count } : null));
  const best = stacks.reduce((a, b) => (getCreature(b.creatureId).aiValue > getCreature(a.creatureId).aiValue ? b : a));
  const most = Math.max(...stacks.map((s) => s.count));
  return real.map((s) => (s ? { creatureId: best.creatureId, count: most } : null));
}
