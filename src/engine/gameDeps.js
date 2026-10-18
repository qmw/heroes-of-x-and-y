// Seam between the game/town/economy modules and the hero + adventure engines (DESIGN.md §8).
// town.js / game.js never import hero.js / bonuses.js / adventure/* directly: they call `deps.<fn>`.
//  - `FALLBACK_DEPS` are small self-contained implementations (also used as test fakes).
//  - `REAL_MODULE_SOURCES` lists where each dep comes from in the real engine; `bindRealModules`
//    copies every export that exists over the fallback.
//  - tests: `useFallbackDeps()` / `setGameDeps({...})` / `resetGameDeps()`.
// Spec: docs/mechanics/game-loop.md §"Dependencies".

import { getSkillEffects } from '../data/skills.js';
import { getSpell } from '../data/spells.js';
import { getHeroDef } from '../data/heroes.js';
import { getMapObject } from '../data/mapObjects.js';
import { getArtifactBonuses, hasArtifact } from './artifacts.js';
import {
  createHero, gainExperience, offerSecondarySkills, applySkillChoice, getSkillLevel, specialtyBonuses,
  BASE_MOVE_POINTS, SPELL_BOOK_ARTIFACT,
} from './leveling.js';

// ---------------------------------------------------------------------------------------------
// Fallback hero engine
// ---------------------------------------------------------------------------------------------

function fbGetHeroBonuses(state, hero) {
  const out = [];
  for (const s of hero.skills || []) out.push(...getSkillEffects(s.id, s.level));
  out.push(...getArtifactBonuses(hero));
  if (hero.defId) out.push(...specialtyBonuses(hero.defId, hero.level));
  for (const t of hero.temp || []) out.push(t.bonus);
  return out;
}

function fbSumBonus(bonuses, type, match) {
  let sum = 0;
  for (const b of bonuses) {
    if (b.type !== type) continue;
    if (typeof match === 'function' ? !match(b) : match && Object.entries(match).some(([k, v]) => b[k] !== v)) continue;
    sum += b.value ?? b.percent ?? 0;
  }
  return sum;
}

function fbGetMaxMana(state, hero) {
  const knowledge = hero.primary.knowledge
    + fbSumBonus(getArtifactBonuses(hero), 'primary', { stat: 'knowledge' });
  const pct = fbSumBonus(fbGetHeroBonuses(state, hero), 'mana_max_percent');
  return Math.floor(10 * Math.max(1, knowledge) * (100 + pct) / 100);
}

/** Same contract as hero.js: a hero parked in `state.heroPool` is re-used; `opts.tavern` = first stack only. */
function fbAddHero(state, defId, playerId, pos, opts = {}) {
  const id = opts.id || `h${state.nextId++}`;
  const where = { x: pos?.x ?? 0, y: pos?.y ?? 0, z: pos?.z ?? 0 };
  let hero = state.heroPool?.[defId] || null;
  if (hero) {
    delete state.heroPool[defId];
    Object.assign(hero, { id, owner: playerId, pos: where });
    delete hero.fromPool;
    if (hero.army.every((s) => !s)) {
      const first = getHeroDef(defId).startArmy[0];
      hero.army[0] = { creatureId: first.creatureId, count: first.min };
    }
  } else {
    hero = createHero(state.rng, defId, { id, owner: playerId, pos: where });
    if (opts.tavern) for (let i = 1; i < hero.army.length; i++) hero.army[i] = null;
  }
  state.heroes[id] = hero;
  const player = state.players[playerId];
  if (player && !player.heroes.includes(id)) player.heroes.push(id);
  for (const p of state.players) {
    if (Array.isArray(p.tavernHeroes)) p.tavernHeroes = p.tavernHeroes.map((d) => (d === defId ? null : d));
  }
  return hero;
}

/** 'retreated' / 'surrendered' park the hero in `state.heroPool` and offer him in tavern slot 1. */
function fbRemoveHero(state, heroId, reason = 'removed') {
  const hero = state.heroes[heroId];
  if (!hero) return { ok: false, error: 'no_such_hero' };
  for (const town of Object.values(state.towns)) {
    if (town.visitingHero === heroId) town.visitingHero = null;
    if (town.garrisonHero === heroId) town.garrisonHero = null;
  }
  const owner = hero.owner;
  const player = state.players[owner];
  if (player) player.heroes = player.heroes.filter((h) => h !== heroId);
  delete state.heroes[heroId];
  const toPool = reason === 'retreated' || reason === 'surrendered' || reason === 'defeated';
  const toTavern = reason === 'retreated' || reason === 'surrendered';
  if (toPool) {
    if (reason !== 'surrendered') hero.army = hero.army.map(() => null);
    Object.assign(hero, { temp: [], owner: null, townId: null, garrisoned: false, inBoat: false, fromPool: true });
    state.heroPool ??= {};
    state.heroPool[hero.defId] = hero;
    if (player && toTavern) {
      player.tavernHeroes ??= [];
      while (player.tavernHeroes.length < 1) player.tavernHeroes.push(null);
      player.tavernHeroes[1] = hero.defId;
    }
  }
  return { ok: true, events: [{ type: 'hero_removed', heroId, defId: hero.defId, playerId: owner, reason, toTavern, toPool }] };
}

function fbStartOfDayHero(state, heroId) {
  const hero = state.heroes[heroId];
  if (!hero) return { ok: false, error: 'no_such_hero' };
  const newWeek = state.date?.day === 1;
  hero.temp = (hero.temp || []).filter((t) => {
    if (t.until === 'end_of_day') return false;
    if (t.until === 'end_of_week') return !newWeek;
    if (typeof t.until === 'number') return t.until >= state.turn;
    return true;
  });
  const bonuses = fbGetHeroBonuses(state, hero);
  hero.maxMovePoints = BASE_MOVE_POINTS + fbSumBonus(bonuses, 'movement_land');
  hero.movePoints = hero.maxMovePoints;
  const max = fbGetMaxMana(state, hero);
  if (hero.mana < max) hero.mana = Math.min(max, hero.mana + 1 + fbSumBonus(bonuses, 'mana_regen'));
  return { ok: true, events: [] };
}

function fbCanLearnSpell(state, hero, spellId) {
  const spell = getSpell(spellId);
  if (!hasArtifact(hero, SPELL_BOOK_ARTIFACT)) return false;
  if ((hero.spells || []).includes(spellId)) return false;
  return spell.level <= 2 + getSkillLevel(hero, 'wisdom');
}

function fbLearnSpell(state, heroId, spellId) {
  const hero = state.heroes[heroId];
  if (!hero || !fbCanLearnSpell(state, hero, spellId)) return { ok: false, error: 'cannot_learn' };
  hero.spells.push(spellId);
  return { ok: true, events: [{ type: 'spell_learned', heroId, spellId }] };
}

function fbAddTempBonus(state, heroId, source, bonus, until) {
  const hero = state.heroes[heroId];
  hero.temp ??= [];
  hero.temp.push({ source, bonus, until });
  return { ok: true, events: [] };
}

/** Fallback: applies the experience and auto-picks the first offered skill (no pendings). */
function fbGiveExperience(state, heroId, amount) {
  const hero = state.heroes[heroId];
  if (!hero) return { ok: false, error: 'no_such_hero' };
  const before = hero.level;
  const { levelUps } = gainExperience(state.rng, hero, amount);
  for (const lu of levelUps) {
    const offers = lu.offers ?? offerSecondarySkills(state.rng, hero);
    if (offers.length) applySkillChoice(hero, offers[0].skillId);
  }
  return { ok: true, events: [{ type: 'experience', heroId, amount, levels: hero.level - before }] };
}

// ---------------------------------------------------------------------------------------------
// Fallback adventure engine (fog: player.explored[z] = flat 0/1 array of width*height)
// ---------------------------------------------------------------------------------------------

function fbCreateEmptyMap(width, height, levels = 1, terrainId = 'grass') {
  const tiles = [];
  for (let z = 0; z < levels; z++) {
    const level = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) row.push({ t: terrainId, road: 0, river: 0, obj: null, blocked: false });
      level.push(row);
    }
    tiles.push(level);
  }
  return { width, height, levels, tiles, objects: {} };
}

/** Same params as adventure `addObject`: `{ id?, owner?, data? }`. */
function fbAddObject(state, defId, pos, params = {}) {
  getMapObject(defId);
  const id = params.id || `o${state.nextId++}`;
  const obj = { id, defId, pos: { x: pos.x, y: pos.y, z: pos.z || 0 }, data: { ...(params.data || {}) } };
  if (params.owner !== undefined) obj.owner = params.owner;
  state.map.objects[id] = obj;
  const tile = state.map.tiles[obj.pos.z]?.[obj.pos.y]?.[obj.pos.x];
  if (tile) tile.obj = id;
  return obj;
}

function fbRemoveObject(state, objId) {
  const obj = state.map.objects[objId];
  if (!obj) return { ok: false, error: 'no_such_object' };
  const tile = state.map.tiles[obj.pos.z]?.[obj.pos.y]?.[obj.pos.x];
  if (tile && tile.obj === objId) tile.obj = null;
  delete state.map.objects[objId];
  return { ok: true, events: [] };
}

function fogLevel(state, playerId, z) {
  const player = state.players[playerId];
  const { width, height } = state.map;
  player.explored ??= [];
  if (!Array.isArray(player.explored[z]) || player.explored[z].length !== width * height) {
    player.explored[z] = new Array(width * height).fill(0);
  }
  return player.explored[z];
}

function forDisc(state, pos, radius, fn) {
  const { width, height } = state.map;
  const r = Math.ceil(radius);
  for (let y = Math.max(0, pos.y - r); y <= Math.min(height - 1, pos.y + r); y++) {
    for (let x = Math.max(0, pos.x - r); x <= Math.min(width - 1, pos.x + r); x++) {
      if ((x - pos.x) ** 2 + (y - pos.y) ** 2 <= radius * radius + radius) fn(x, y);
    }
  }
}

function fbRevealAround(state, playerId, pos, radius) {
  if (!state.map || !state.players[playerId]) return;
  const fog = fogLevel(state, playerId, pos.z || 0);
  forDisc(state, pos, radius, (x, y) => { fog[y * state.map.width + x] = 1; });
}

/**
 * Re-shroud a disc. `keep(x, y)` returning true leaves a tile explored (the real adventure
 * `hideAround` takes 4 arguments and works out the player's current vision itself).
 */
function fbHideAround(state, playerId, pos, radius, keep) {
  if (!state.map || !state.players[playerId]) return;
  const fog = fogLevel(state, playerId, pos.z || 0);
  forDisc(state, pos, radius, (x, y) => { if (!keep || !keep(x, y)) fog[y * state.map.width + x] = 0; });
}

function fbIsExplored(state, playerId, pos) {
  const lvl = state.players[playerId]?.explored?.[pos.z || 0];
  return Array.isArray(lvl) ? !!lvl[pos.y * state.map.width + pos.x] : false;
}

function ownedObjects(state, playerId, effectType) {
  return Object.values(state.map?.objects || {})
    .filter((o) => o.owner === playerId && getMapObject(o.defId).effect.type === effectType);
}

function fbGetMineIncome(state, playerId) {
  const out = {};
  for (const o of ownedObjects(state, playerId, 'mine')) {
    const eff = getMapObject(o.defId).effect;
    const resource = o.data?.resource || eff.resource;
    if (!resource || resource === 'random') continue;
    out[resource] = (out[resource] || 0) + (o.data?.amount ?? eff.amount ?? 1);
  }
  return out;
}

function fbGetFlaggedDwellings(state, playerId) {
  return ownedObjects(state, playerId, 'dwelling');
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

export const FALLBACK_DEPS = Object.freeze({
  // hero.js
  addHero: fbAddHero,
  removeHero: fbRemoveHero,
  startOfDayHero: fbStartOfDayHero,
  canLearnSpell: fbCanLearnSpell,
  learnSpell: fbLearnSpell,
  addTempBonus: fbAddTempBonus,
  giveExperience: fbGiveExperience,
  // bonuses.js
  getHeroBonuses: fbGetHeroBonuses,
  sumBonus: fbSumBonus,
  getMaxMana: fbGetMaxMana,
  getSightRadius: () => 5,
  // adventure/index.js
  createEmptyMap: fbCreateEmptyMap,
  addObject: fbAddObject,
  removeObject: fbRemoveObject,
  revealAround: fbRevealAround,
  hideAround: fbHideAround,
  isExplored: fbIsExplored,
  startOfDayAdventure: () => ({ ok: true, events: [] }),
  startOfWeekAdventure: () => ({ ok: true, events: [] }),
  getMineIncome: fbGetMineIncome,
  getFlaggedDwellings: fbGetFlaggedDwellings,
  /** Hook: "Month of the X" spawns wandering stacks of X on the map. */
  spawnMonthMonsters: () => ({ ok: true, events: [] }),
  /** Hook: hide the grail / set up the obelisk puzzle after the map objects exist. */
  setupGrail: () => ({ ok: true, events: [] }),
});

/** dep name -> [module key, export name candidates...] */
export const REAL_MODULE_SOURCES = {
  addHero: ['hero', 'addHero'],
  removeHero: ['hero', 'removeHero'],
  startOfDayHero: ['hero', 'startOfDayHero'],
  canLearnSpell: ['hero', 'canLearnSpell'],
  learnSpell: ['hero', 'learnSpell'],
  addTempBonus: ['hero', 'addTempBonus'],
  giveExperience: ['hero', 'giveExperience'],
  getHeroBonuses: ['bonuses', 'getHeroBonuses'],
  sumBonus: ['bonuses', 'sumBonus'],
  getMaxMana: ['bonuses', 'getMaxMana'],
  getSightRadius: ['bonuses', 'getSightRadius'],
  createEmptyMap: ['adventure', 'createEmptyMap'],
  addObject: ['adventure', 'addObject'],
  removeObject: ['adventure', 'removeObject'],
  revealAround: ['adventure', 'revealAround'],
  hideAround: ['adventure', 'hideAround', 'coverAround', 'shroudAround'],
  isExplored: ['adventure', 'isExplored'],
  startOfDayAdventure: ['adventure', 'startOfDayAdventure'],
  startOfWeekAdventure: ['adventure', 'startOfWeekAdventure'],
  getMineIncome: ['adventure', 'getMineIncome'],
  getFlaggedDwellings: ['adventure', 'getFlaggedDwellings'],
  spawnMonthMonsters: ['adventure', 'spawnMonthMonsters', 'spawnMonthlyMonsters'],
  setupGrail: ['adventure', 'setupGrail', 'setupGrailPuzzle', 'placeGrail'],
};

/** The live dependency table. Always call through it: `deps.addHero(...)`. */
export const deps = { ...FALLBACK_DEPS };
const realDeps = { ...FALLBACK_DEPS };
/** Names of deps currently served by a real engine module (for diagnostics / tests). */
export const boundToReal = [];

/**
 * Bind the real engine modules. `modules = { hero, bonuses, adventure }` (module namespace
 * objects; missing ones are skipped). Called by `gameDepsReal.js`. Exports are looked up lazily at
 * call time, so import cycles between the engine modules are harmless.
 */
export function bindRealModules(modules) {
  for (const [name, [modKey, ...candidates]] of Object.entries(REAL_MODULE_SOURCES)) {
    const mod = modules[modKey];
    if (!mod) continue;
    realDeps[name] = (...args) => {
      const exportName = candidates.find((c) => typeof mod[c] === 'function');
      return exportName ? mod[exportName](...args) : FALLBACK_DEPS[name](...args);
    };
    if (!boundToReal.includes(name)) boundToReal.push(name);
  }
  Object.assign(deps, realDeps);
}

/** Does the bound real module actually export this dep (false = fallback in use)? */
export function isRealDep(name, modules) {
  const [modKey, ...candidates] = REAL_MODULE_SOURCES[name] || [];
  const mod = modules?.[modKey];
  return !!mod && candidates.some((c) => typeof mod[c] === 'function');
}

/** Override some deps (tests). */
export function setGameDeps(overrides) {
  Object.assign(deps, overrides);
}

/** Back to the default table (real modules where bound, fallbacks otherwise). */
export function resetGameDeps() {
  Object.assign(deps, realDeps);
}

/** Use only the built-in fallbacks (deterministic unit tests, independent of other engine areas). */
export function useFallbackDeps() {
  Object.assign(deps, FALLBACK_DEPS);
}
