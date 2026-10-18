// Town engine: construction, building effects, creature growth & recruitment, mage guild, tavern,
// trade buildings, garrison management, capture, siege info.
// Spec: docs/mechanics/towns.md (rules) and docs/mechanics/game-loop.md (API, state fields, events).

import { RESOURCES, MAX_HEROES_PER_PLAYER, MAX_SECONDARY_SKILLS } from '../core/constants.js';
import { pick, randInt } from '../core/rng.js';
import { getFaction } from '../data/factions.js';
import { getCreature, getBaseCreature, canUpgradeTo, getUpgradeCost } from '../data/creatures.js';
import { HEROES, getHeroDef } from '../data/heroes.js';
import { getArtifact } from '../data/artifacts.js';
import { getSpell, rollGuildLevel, guildSpellPool } from '../data/spells.js';
import { getMapObject } from '../data/mapObjects.js';
import { getTerrain } from '../data/terrain.js';
import { getSkill } from '../data/skills.js';
import {
  getBuilding, getBuildingEffects, buildingsForFaction, isAvailableTo, isBuilt, missingRequirements,
  applyBuild, startingBuildings, dwellingsForFaction, freelancerRate, artifactBuyPrice, artifactSellPrice,
  MAGE_GUILD_SPELL_SLOTS, TAVERN_HERO_COST, TAVERN_POOL_SIZE, BOAT_COST, SKELETON_TRANSFORMER, ARTIFACT_MERCHANT_SLOTS,
} from '../data/buildings.js';
import {
  createArmy, armyAdd, armyCanAdd, armyMove, armyStrength, armyStackCount, armyCanMergeAll, armyMergeAll, armyDismiss,
} from './army.js';
import {
  getArtifactBonuses, ownsArtifact, hasArtifact, removeArtifact, giveArtifact, findArtifact, entryId,
  artifactValue, pickRandomArtifact, isSlotLocked,
} from './artifacts.js';
import { getSkillLevel, SPELL_BOOK_ARTIFACT, WAR_MACHINE_SLOT } from './leveling.js';
import { hasPending } from './pending.js';
import { deps } from './gameDeps.js';
import './gameDepsReal.js'; // binds hero / bonuses / adventure into `deps`
import { canAfford, pay, addResources, costTimes, maxAffordable, countMarketplaces } from './economy.js';
import { absoluteWeek, WEEK_OF_GROWTH_BONUS } from './calendar.js';
import { checkVictory } from './victory.js';

const ok = (events = [], extra = {}) => ({ ok: true, events, ...extra });
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

/** Sight radius of a town without a Lookout Tower. */
export const TOWN_SIGHT_RADIUS = 5;
export const SPELLBOOK_COST = 500;
export const GRAIL_ARTIFACT = 'grail';
/** Weekly growth (percent of each stack, at least +1) of a neutral town's garrison. */
export const NEUTRAL_GARRISON_GROWTH_PERCENT = 10;

// ---------------------------------------------------------------------------------------------
// Small accessors
// ---------------------------------------------------------------------------------------------

export function getTown(state, townId) {
  const town = state.towns[townId];
  if (!town) throw new Error(`Unknown town: ${townId}`);
  return town;
}

/** `[{buildingId, effect}]` of every standing building. */
export function getTownEffects(town, type) {
  const out = [];
  for (const buildingId of town.buildings) {
    for (const effect of getBuildingEffects(buildingId, town.faction)) {
      if (!type || effect.type === type) out.push({ buildingId, effect });
    }
  }
  return out;
}

export function townHasEffect(town, type) {
  return getTownEffects(town, type).length > 0;
}

export function townHasBuilding(town, buildingId) {
  return isBuilt(town.buildings, buildingId);
}

/** Heroes inside the town: visiting first, then the garrison hero. */
export function getHeroesInTown(state, town) {
  return [town.visitingHero, town.garrisonHero].map((id) => id && state.heroes[id]).filter(Boolean);
}

/** The army shown in the garrison row: the garrison hero's army when there is one. */
export function getGarrisonArmy(state, town) {
  const hero = town.garrisonHero && state.heroes[town.garrisonHero];
  return hero ? hero.army : town.garrison;
}

function armyAt(state, town, where) {
  if (where === 'garrison') return getGarrisonArmy(state, town);
  if (where === 'visiting') return town.visitingHero ? state.heroes[town.visitingHero]?.army ?? null : null;
  return null;
}

/** Is the `where` row a hero's army (which may never become empty)? */
function rowIsHero(town, where) {
  return where === 'visiting' ? !!town.visitingHero : !!town.garrisonHero;
}

/** Common precondition of player actions in a town. */
function guard(state, townId) {
  const town = state.towns[townId];
  if (!town) return { error: 'no_such_town' };
  if (town.owner == null) return { error: 'not_owned' };
  // player actions: only the player whose turn it is may use his towns
  if (state.players?.[state.currentPlayer] && town.owner !== state.players[state.currentPlayer].id) return { error: 'not_your_turn' };
  if (hasPending(state, town.owner)) return { error: 'pending' };
  return { town };
}

function builtDwellings(town) {
  return town.buildings.map(getBuilding).filter((b) => b.kind === 'dwelling')
    .sort((a, b) => a.dwelling.tier - b.dwelling.tier || (a.dwelling.alt ? 1 : 0) - (b.dwelling.alt ? 1 : 0));
}

function isAdjacentWaterTile(state, pos) {
  const tile = state.map?.tiles?.[pos.z || 0]?.[pos.y]?.[pos.x];
  return !!tile && getTerrain(tile.t).water;
}

/**
 * Water tiles next to the town, in boat-spawn order: rings at Chebyshev distance 1..3 around the
 * entrance, each walked clockwise starting from the tile straight below the entrance.
 */
export function getTownWaterTiles(state, town) {
  const out = [];
  if (!state.map) return out;
  const z = town.pos.z || 0;
  for (let r = 1; r <= 3; r++) {
    const ring = [];
    for (let x = 0; x >= -r; x--) ring.push([x, r]); // bottom edge, going left (clockwise seen from above)
    for (let y = r - 1; y >= -r; y--) ring.push([-r, y]);
    for (let x = -r + 1; x <= r; x++) ring.push([x, -r]);
    for (let y = -r + 1; y <= r; y++) ring.push([r, y]);
    for (let x = r - 1; x >= 1; x--) ring.push([x, r]);
    for (const [dx, dy] of ring) {
      const pos = { x: town.pos.x + dx, y: town.pos.y + dy, z };
      if (isAdjacentWaterTile(state, pos)) out.push(pos);
    }
  }
  return out;
}

/** Shipyard / Lighthouse precondition. `town.coastal` (boolean) overrides the map check. */
export function townHasWater(state, town) {
  if (typeof town.coastal === 'boolean') return town.coastal;
  return getTownWaterTiles(state, town).length > 0;
}

export function getTownSightRadius(town) {
  let r = TOWN_SIGHT_RADIUS;
  for (const { effect } of getTownEffects(town, 'reveal_map')) if (effect.radius) r = Math.max(r, effect.radius);
  return r;
}

function revealForOwner(state, town) {
  if (town.owner == null || !state.map) return;
  deps.revealAround(state, town.owner, town.pos, getTownSightRadius(town));
  if (getTownEffects(town, 'reveal_map').some(({ effect }) => effect.all)) revealWholeMap(state, town.owner);
}

export function revealWholeMap(state, playerId) {
  if (!state.map) return;
  const { width, height, levels } = state.map;
  const center = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  for (let z = 0; z < (levels || 1); z++) deps.revealAround(state, playerId, { ...center, z }, width + height);
}

// ---------------------------------------------------------------------------------------------
// Mage guild
// ---------------------------------------------------------------------------------------------

export function getMageGuildLevel(town) {
  return Math.max(0, ...town.buildings.map((b) => getBuilding(b).mageGuildLevel || 0));
}

/** Spell slots of a guild level in this town (Library adds its `value`). */
export function getGuildSlots(town, level) {
  const extra = getTownEffects(town, 'library_extra_spell').reduce((n, { effect }) => n + effect.value, 0);
  return MAGE_GUILD_SPELL_SLOTS[level - 1] + extra;
}

/** Roll whatever is missing in the built guild levels (new level, Library, Aurora Borealis). */
function fillMageGuild(state, town) {
  town.mageGuild ??= [[], [], [], [], []];
  const level = getMageGuildLevel(town);
  const all = townHasEffect(town, 'all_spells');
  for (let l = 1; l <= level; l++) {
    const have = town.mageGuild[l - 1];
    if (all) {
      for (const s of guildSpellPool(town.faction, l)) if (!have.includes(s.id)) have.push(s.id);
      continue;
    }
    const missing = getGuildSlots(town, l) - have.length;
    if (missing > 0) have.push(...rollGuildLevel(town.faction, l, state.rng, missing, have));
  }
}

/** A hero inside the town learns every guild spell his Wisdom allows (needs a spellbook). */
function teachGuildSpells(state, town, hero) {
  const events = [];
  const level = getMageGuildLevel(town);
  for (let l = 1; l <= level; l++) {
    for (const spellId of town.mageGuild[l - 1]) {
      if (!deps.canLearnSpell(state, hero, spellId)) continue;
      const r = deps.learnSpell(state, hero.id, spellId);
      if (r === true || r?.ok) events.push({ type: 'spell_learned', heroId: hero.id, spellId, townId: town.id });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------------------------
// Visit / daily hero effects
// ---------------------------------------------------------------------------------------------

/**
 * Effects of being inside the town: one-time visit bonuses, Stables, Mana Vortex, guild spells.
 * Runs on entering, at the start of each day spent inside, and when a building is built.
 */
function applyVisitEffects(state, town, hero) {
  const events = [];
  hero.visited ??= {};
  hero.temp ??= [];
  for (const buildingId of town.buildings) {
    const effects = getBuildingEffects(buildingId, town.faction);
    const visitKey = `${town.id}:${buildingId}`;
    const bonuses = effects.filter((e) => e.type === 'visit_bonus');
    if (bonuses.length && !hero.visited[visitKey]) {
      hero.visited[visitKey] = true;
      for (const e of bonuses) {
        if (e.stat === 'experience') {
          const r = deps.giveExperience(state, hero.id, e.value);
          events.push(...(r?.events || []));
        } else hero.primary[e.stat] += e.value;
        events.push({ type: 'visit_bonus', heroId: hero.id, townId: town.id, buildingId, stat: e.stat, value: e.value });
      }
    }
    for (const e of effects) {
      if (e.type === 'visit_temp_bonus' && !hero.temp.some((t) => t.source === buildingId)) {
        deps.addTempBonus(state, hero.id, buildingId, { ...e.bonus }, e.until);
        if (e.bonus.type === 'movement_land') hero.movePoints += e.bonus.value;
        events.push({ type: 'visit_temp_bonus', heroId: hero.id, townId: town.id, buildingId, bonus: e.bonus });
      }
      if (e.type === 'mana_double') {
        const week = absoluteWeek(state);
        if (town.manaVortexUsedWeek !== week) {
          const target = 2 * deps.getMaxMana(state, hero);
          if (hero.mana < target) {
            town.manaVortexUsedWeek = week;
            hero.mana = target;
            events.push({ type: 'mana_doubled', heroId: hero.id, townId: town.id, buildingId, mana: target });
          }
        }
      }
    }
  }
  events.push(...teachGuildSpells(state, town, hero));
  return events;
}

/** Start-of-day tick of one town: build limit reset, overnight mana, effects for heroes inside. */
export function startOfDayTown(state, townId) {
  const town = getTown(state, townId);
  const events = [];
  town.builtThisTurn = false;
  const restore = townHasEffect(town, 'mana_restore');
  for (const hero of getHeroesInTown(state, town)) {
    if (restore) {
      const max = deps.getMaxMana(state, hero);
      if (hero.mana < max) {
        hero.mana = max;
        events.push({ type: 'mana_restored', heroId: hero.id, townId });
      }
    }
    events.push(...applyVisitEffects(state, town, hero));
  }
  return ok(events);
}

/** Cover of Darkness: re-shroud the surroundings of every such town for all other players. */
export function applyFogCover(state) {
  const events = [];
  if (!state.map) return ok(events);
  for (const town of Object.values(state.towns)) {
    if (town.owner == null) continue;
    for (const { effect } of getTownEffects(town, 'fog_cover')) {
      for (const player of state.players) {
        if (player.id === town.owner || !player.alive) continue;
        const eyes = [];
        for (const hid of player.heroes) {
          const h = state.heroes[hid];
          if (h) eyes.push({ pos: h.pos, r: deps.getSightRadius(state, h) });
        }
        for (const tid of player.towns) eyes.push({ pos: state.towns[tid].pos, r: getTownSightRadius(state.towns[tid]) });
        const z = town.pos.z || 0;
        const keep = (x, y) => eyes.some((e) => (e.pos.z || 0) === z && (e.pos.x - x) ** 2 + (e.pos.y - y) ** 2 <= e.r * e.r + e.r);
        deps.hideAround(state, player.id, town.pos, effect.radius, keep);
        events.push({ type: 'fog_cover', townId: town.id, playerId: player.id, radius: effect.radius });
      }
    }
  }
  return ok(events);
}

// ---------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------

function pickTownName(state, faction) {
  const used = new Set(Object.values(state.towns).map((t) => t.name));
  const free = getFaction(faction).townNames.filter((n) => !used.has(n));
  return free.length ? pick(state.rng, free) : `${getFaction(faction).name} ${Object.keys(state.towns).length + 1}`;
}

/**
 * Create a Town entity (does NOT create the `town` map object - `createGame` does that).
 * @param {{faction: string, owner?: number|null, pos: {x,y,z}, name?: string, buildings?: string[],
 *   role?: 'main'|'other', id?: string}} opts  `buildings` omitted => starting set of `role`
 *   (default role: 'main' for the first town of a player, else 'other').
 */
export function createTown(state, opts) {
  const faction = getFaction(opts.faction).id;
  const owner = opts.owner ?? null;
  const player = owner != null ? state.players[owner] : null;
  if (owner != null && !player) throw new Error(`Unknown player: ${owner}`);
  const role = opts.role || (player && player.towns.length === 0 ? 'main' : 'other');
  let buildings = [];
  for (const b of opts.buildings || startingBuildings(faction, role)) {
    if (!isAvailableTo(getBuilding(b), faction)) throw new Error(`Building ${b} is not available to ${faction}`);
    if (!isBuilt(buildings, b)) buildings = applyBuild(buildings, b);
  }
  if (!isBuilt(buildings, 'village_hall')) buildings = ['village_hall', ...buildings];
  const town = {
    id: opts.id || `t${state.nextId++}`,
    name: opts.name || pickTownName(state, faction),
    faction,
    owner,
    pos: { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z || 0 },
    buildings,
    builtThisTurn: false,
    garrison: createArmy(),
    visitingHero: null,
    garrisonHero: null,
    stock: {},
    mageGuild: [[], [], [], [], []],
    manaVortexUsedWeek: 0,
    portal: null,
    role,
  };
  state.towns[town.id] = town;
  if (player) player.towns.push(town.id);
  fillMageGuild(state, town);
  if (townHasEffect(town, 'sells_artifacts')) ensureMerchantStock(state);
  const growth = getTownGrowth(state, town.id);
  for (const [creatureId, n] of Object.entries(growth)) town.stock[creatureId] = n;
  if (townHasEffect(town, 'portal_of_summoning')) rollPortal(state, town);
  revealForOwner(state, town);
  return town;
}

// ---------------------------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------------------------

function findGrailCarrier(state, town) {
  return getHeroesInTown(state, town).find((h) => ownsArtifact(h, GRAIL_ARTIFACT)) || null;
}

/** @returns {{ok: true} | {ok: false, error: string, missing?: string[]}} (towns.md §2 order) */
export function canBuild(state, townId, buildingId) {
  const town = getTown(state, townId);
  const b = getBuilding(buildingId);
  if (!isAvailableTo(b, town.faction)) return fail('not_available');
  if (isBuilt(town.buildings, buildingId)) return fail('already_built');
  if (town.builtThisTurn && !b.requiresGrail) return fail('built_this_turn');
  const missing = missingRequirements(town.buildings, buildingId);
  if (missing.length) return fail('missing_requirements', { missing });
  if (b.requiresWater && !townHasWater(state, town)) return fail('no_water');
  if (b.uniquePerPlayer && town.owner != null) {
    const other = state.players[town.owner].towns.some((t) => t !== townId && isBuilt(state.towns[t].buildings, buildingId));
    if (other) return fail('capitol_exists');
  }
  if (b.requiresGrail && !findGrailCarrier(state, town)) return fail('no_grail');
  if (town.owner != null && !canAfford(state, town.owner, b.cost)) return fail('not_enough_resources');
  return { ok: true };
}

/** Construct a building: pay, replace the predecessor, run build-time effects. */
export function build(state, townId, buildingId) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const town = g.town;
  const check = canBuild(state, townId, buildingId);
  if (!check.ok) return check;
  const b = getBuilding(buildingId);
  pay(state, town.owner, b.cost);
  if (b.requiresGrail) removeArtifact(findGrailCarrier(state, town), GRAIL_ARTIFACT);
  else town.builtThisTurn = true;
  town.buildings = applyBuild(town.buildings, buildingId);
  const events = [{ type: 'building_built', townId, buildingId, playerId: town.owner }];
  events.push(...onBuilt(state, town, b));
  if (b.requiresGrail) events.push(...checkVictory(state).events);
  return ok(events);
}
export { build as buildInTown };

/** Build-time effects of a freshly constructed building. */
function onBuilt(state, town, b) {
  const events = [];
  if (b.dwelling) {
    const c = getCreature(b.dwelling.creatureId);
    town.stock[c.id] = (town.stock[c.id] || 0) + c.growth;
  }
  const types = new Set(getBuildingEffects(b.id, town.faction).map((e) => e.type));
  if (types.has('mage_guild') || types.has('library_extra_spell') || types.has('all_spells')) fillMageGuild(state, town);
  if (types.has('reveal_map')) revealForOwner(state, town);
  if (types.has('sells_artifacts')) ensureMerchantStock(state);
  if (types.has('portal_of_summoning')) rollPortal(state, town);
  if (types.has('recruit_heroes') && town.owner != null) ensureTavernPool(state, town.owner);
  for (const hero of getHeroesInTown(state, town)) events.push(...applyVisitEffects(state, town, hero));
  return events;
}

/**
 * Every building of the town's faction with its status for the town screen.
 * @returns {{id, name, kind, cost, status: 'built'|'available'|'blocked', error?: string, missing?: string[]}[]}
 */
export function getAvailableBuildings(state, townId) {
  const town = getTown(state, townId);
  return buildingsForFaction(town.faction).map((b) => {
    const base = { id: b.id, name: b.name, kind: b.kind, cost: b.cost };
    if (isBuilt(town.buildings, b.id)) return { ...base, status: 'built' };
    const c = canBuild(state, townId, b.id);
    if (c.ok) return { ...base, status: 'available' };
    return { ...base, status: 'blocked', error: c.error, missing: c.missing || missingRequirements(town.buildings, b.id) };
  });
}

// ---------------------------------------------------------------------------------------------
// Creature growth
// ---------------------------------------------------------------------------------------------

/** Creature ids offered by an external dwelling entry returned by `deps.getFlaggedDwellings`. */
function dwellingCreatureIds(entry) {
  if (!entry) return [];
  if (typeof entry === 'string') return [entry];
  if (entry.creatureId) return [entry.creatureId];
  if (Array.isArray(entry.creatureIds)) return entry.creatureIds;
  if (Array.isArray(entry.creatures)) return entry.creatures.map((c) => (typeof c === 'string' ? c : c.creatureId));
  const data = entry.data || {};
  if (data.creatureId) return [data.creatureId];
  if (Array.isArray(data.creatures)) return data.creatures.map((c) => (typeof c === 'string' ? c : c.creatureId));
  if (entry.defId) {
    const eff = getMapObject(entry.defId).effect;
    if (Array.isArray(eff.creatures)) return eff.creatures.map((c) => (typeof c === 'string' ? c : c.creatureId));
  }
  return [];
}

function flaggedDwellings(state, playerId) {
  if (playerId == null || !state.map) return [];
  return deps.getFlaggedDwellings(state, playerId) || [];
}

/** +percent growth in all towns from an assembled Statue of Legion held by any hero of the player. */
function legionPercent(state, playerId) {
  if (playerId == null) return 0;
  let best = 0;
  for (const heroId of state.players[playerId].heroes) {
    const hero = state.heroes[heroId];
    if (!hero) continue;
    for (const b of getArtifactBonuses(hero)) {
      if (b.type === 'creature_growth' && b.percent && b.scope !== 'town') best = Math.max(best, b.percent);
    }
  }
  return best;
}

/**
 * Weekly growth of every built dwelling with its parts (towns.md §4), in the original's order:
 * base, + fort bonus (citadel 50 % / castle 100 % of base), + Statue of Legion (% of base + fort),
 * + external dwellings, + hordes / Legion pieces; the Grail then adds 50 % of that whole subtotal;
 * Week of the X (+5) and Deity of Fire (+15) are added last. Each part is floored separately.
 * @returns {{dwellingId, creatureId, tier, base, percent, fort, legion, horde, artifacts, external, grail, week, special, total}[]}
 */
export function getTownGrowthBreakdown(state, townId) {
  const town = getTown(state, townId);
  const growthEffects = getTownEffects(town, 'growth_percent').map((x) => x.effect);
  const percent = growthEffects.filter((e) => !e.ofTotal).reduce((n, e) => n + e.percent, 0);
  const totalPercent = growthEffects.filter((e) => e.ofTotal).reduce((n, e) => n + e.percent, 0);
  const legionPct = legionPercent(state, town.owner);
  const hordes = getTownEffects(town, 'creature_growth').map((x) => x.effect);
  const weekly = getTownEffects(town, 'week_of_creature').map((x) => x.effect);
  const heroBonuses = getHeroesInTown(state, town).flatMap((h) => getArtifactBonuses(h))
    .filter((b) => b.type === 'creature_growth' && b.value);
  // dwellings whose definition says `townGrowthBonus: 0` (special / neutral tiers) do not help towns
  const external = flaggedDwellings(state, town.owner)
    .filter((d) => !(d && typeof d === 'object' && d.townGrowthBonus === 0))
    .map(dwellingCreatureIds);
  const out = [];
  for (const b of builtDwellings(town)) {
    const { creatureId, tier, alt } = b.dwelling;
    const creature = getCreature(creatureId);
    const baseId = getBaseCreature(creatureId).id;
    const base = creature.growth;
    const fort = Math.floor(base * percent / 100);
    const legion = Math.floor((base + fort) * legionPct / 100);
    const horde = hordes.filter((e) => (e.creatureIds ? e.creatureIds.includes(creatureId) : e.tier === tier && !alt))
      .reduce((n, e) => n + e.value, 0);
    const artifacts = heroBonuses.filter((x) => (x.creatureId ? x.creatureId === creatureId || x.creatureId === baseId : x.tier === tier))
      .reduce((n, x) => n + x.value, 0);
    const ext = external.filter((ids) => ids.includes(baseId) || ids.includes(creatureId)).length;
    const subtotal = base + fort + legion + horde + artifacts + ext;
    const grail = Math.floor(subtotal * totalPercent / 100);
    const wk = state.weekOf?.kind === 'week_of' && state.weekOf.creatureId
      && getBaseCreature(state.weekOf.creatureId).id === baseId ? WEEK_OF_GROWTH_BONUS : 0;
    const special = weekly.filter((e) => getBaseCreature(e.creatureId).id === baseId).reduce((n, e) => n + e.growthBonus, 0);
    const total = subtotal + grail + wk + special;
    out.push({
      dwellingId: b.id, creatureId, tier, base, percent, fort, legion, horde, artifacts, external: ext, grail,
      week: wk, special, total,
    });
  }
  return out;
}

/** @returns {{[creatureId]: number}} weekly growth per recruitable creature */
export function getTownGrowth(state, townId) {
  const out = {};
  for (const row of getTownGrowthBreakdown(state, townId)) out[row.creatureId] = row.total;
  return out;
}

function rollPortal(state, town) {
  const options = flaggedDwellings(state, town.owner).flatMap(dwellingCreatureIds);
  if (!options.length) {
    town.portal = null;
    return;
  }
  const creatureId = pick(state.rng, options);
  town.portal = { creatureId, count: getCreature(creatureId).growth };
}

/**
 * Day 1 of a week, one town: growth into the stock (or plague halving, "Month of" doubling), Portal
 * of Summoning pick, neutral garrison growth.
 */
export function startOfWeekTown(state, townId) {
  const town = getTown(state, townId);
  const kind = state.weekOf?.kind;
  const events = [];
  if (kind === 'plague') {
    for (const id of Object.keys(town.stock)) town.stock[id] = Math.floor(town.stock[id] / 2);
    events.push({ type: 'plague', townId });
  } else {
    const growth = getTownGrowth(state, townId);
    for (const [id, n] of Object.entries(growth)) town.stock[id] = (town.stock[id] || 0) + n;
    if (kind === 'month_of' && state.weekOf.creatureId) {
      const baseId = getBaseCreature(state.weekOf.creatureId).id;
      for (const b of builtDwellings(town)) {
        if (getBaseCreature(b.dwelling.creatureId).id !== baseId) continue;
        for (const id of Object.keys(town.stock)) {
          if (getBaseCreature(id).id === baseId) town.stock[id] *= 2;
        }
        events.push({ type: 'population_doubled', townId, creatureId: b.dwelling.creatureId });
      }
    }
    events.push({ type: 'town_growth', townId, growth });
  }
  if (townHasEffect(town, 'portal_of_summoning')) rollPortal(state, town);
  if (town.owner == null) {
    for (const s of town.garrison) {
      if (s) s.count += Math.max(1, Math.floor(s.count * NEUTRAL_GARRISON_GROWTH_PERCENT / 100));
    }
  }
  return ok(events);
}

/** Day 1 of a week, one player, before growth and income: Mystic Pond and gold interest. */
export function applyWeeklyTownResources(state, playerId) {
  const player = state.players[playerId];
  const events = [];
  let interest = 0;
  for (const townId of player.towns) {
    const town = state.towns[townId];
    for (const { effect, buildingId } of getTownEffects(town)) {
      if (effect.type === 'gold_interest') interest += effect.percent;
      if (effect.type === 'weekly_resource_random') {
        const resource = pick(state.rng, effect.resources);
        const amount = randInt(state.rng, effect.min, effect.max);
        addResources(state, playerId, { [resource]: amount });
        events.push({ type: 'weekly_resource', playerId, townId, buildingId, resource, amount });
      }
    }
  }
  if (interest > 0) {
    const amount = Math.floor(player.resources.gold * interest / 100);
    if (amount > 0) {
      addResources(state, playerId, { gold: amount });
      events.push({ type: 'gold_interest', playerId, percent: interest, amount });
    }
  }
  return ok(events);
}

/** Day 1 of a month: the (shared) Artifact Merchants stock is restocked once for the whole game. */
export function startOfMonthTown(state, townId) {
  getTown(state, townId);
  if (state.townMerchants && state.townMerchants.rolledOn !== state.turn) rollArtifactMerchants(state);
  return ok([]);
}

// ---------------------------------------------------------------------------------------------
// Recruiting and upgrading
// ---------------------------------------------------------------------------------------------

/** Stock ids a recruit of `creatureId` draws from, or null when the town cannot produce it. */
function stockSources(town, creatureId) {
  for (const b of builtDwellings(town)) {
    if (b.dwelling.creatureId === creatureId) return [creatureId];
    // An upgraded dwelling still sells the base creature (own leftover stock first).
    if (b.dwelling.upgraded && getCreature(b.dwelling.creatureId).upgradeOf === creatureId) {
      return [creatureId, b.dwelling.creatureId];
    }
  }
  return null;
}

function availableToRecruit(town, creatureId) {
  const src = stockSources(town, creatureId);
  let n = src ? src.reduce((sum, id) => sum + (town.stock[id] || 0), 0) : 0;
  if (town.portal && town.portal.creatureId === creatureId) n += town.portal.count;
  return n;
}

/**
 * What can be recruited right now (town screen).
 * @returns {{creatureId, tier, dwellingId, available, growth, cost, affordable, source: 'dwelling'|'portal'}[]}
 */
export function getRecruitInfo(state, townId) {
  const town = getTown(state, townId);
  const growth = getTownGrowth(state, townId);
  const rows = builtDwellings(town).map((b) => {
    const c = getCreature(b.dwelling.creatureId);
    return {
      creatureId: c.id, tier: b.dwelling.tier, dwellingId: b.id, available: town.stock[c.id] || 0,
      growth: growth[c.id] || 0, cost: c.cost, source: 'dwelling',
      affordable: town.owner == null ? 0 : maxAffordable(state, town.owner, c.cost),
    };
  });
  if (town.portal) {
    const c = getCreature(town.portal.creatureId);
    rows.push({
      creatureId: c.id, tier: c.tier, dwellingId: null, available: town.portal.count, growth: 0, cost: c.cost,
      source: 'portal', affordable: town.owner == null ? 0 : maxAffordable(state, town.owner, c.cost),
    });
  }
  return rows;
}

/**
 * Buy `count` creatures into the garrison row or the visiting hero's army.
 * @param {'garrison'|'visiting'} [target='garrison']
 */
export function recruit(state, townId, creatureId, count, target = 'garrison') {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const town = g.town;
  const creature = getCreature(creatureId);
  if (!Number.isInteger(count) || count < 1) return fail('bad_count');
  const sources = stockSources(town, creatureId);
  const fromPortal = town.portal && town.portal.creatureId === creatureId;
  if (!sources && !fromPortal) return fail('no_dwelling');
  if (availableToRecruit(town, creatureId) < count) return fail('not_enough_creatures');
  if (target !== 'garrison' && target !== 'visiting') return fail('bad_target');
  const army = armyAt(state, town, target);
  if (!army) return fail('no_hero');
  if (!armyCanAdd(army, creatureId)) return fail('no_free_slot');
  const cost = costTimes(creature.cost, count);
  if (!pay(state, town.owner, cost)) return fail('not_enough_resources');
  let left = count;
  for (const id of sources || []) {
    const take = Math.min(left, town.stock[id] || 0);
    if (take > 0) town.stock[id] -= take;
    left -= take;
  }
  if (left > 0) {
    town.portal.count -= left;
    if (town.portal.count <= 0) town.portal = null;
  }
  armyAdd(army, creatureId, count);
  return ok([{ type: 'recruited', townId, creatureId, count, target, cost }]);
}

/** Buy as much as possible, strongest creatures first. */
export function recruitAll(state, townId, target = 'garrison') {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const town = g.town;
  const army = armyAt(state, town, target);
  if (!army) return fail('no_hero');
  const events = [];
  for (const b of builtDwellings(town).reverse()) {
    const creatureId = b.dwelling.creatureId;
    const n = Math.min(town.stock[creatureId] || 0, maxAffordable(state, town.owner, getCreature(creatureId).cost));
    if (n < 1 || !armyCanAdd(army, creatureId)) continue;
    events.push(...recruit(state, townId, creatureId, n, target).events);
  }
  return ok(events);
}

/** Creature id a stack can be upgraded to in this town, or null. */
export function getUpgradeTarget(town, creatureId) {
  const hit = builtDwellings(town).find((b) => canUpgradeTo(creatureId, b.dwelling.creatureId));
  return hit ? hit.dwelling.creatureId : null;
}

/** `{to, cost}` of upgrading the whole stack, or null. */
export function getUpgradeInfo(state, { townId, where, slot }) {
  const town = getTown(state, townId);
  const stack = armyAt(state, town, where)?.[slot];
  if (!stack) return null;
  const to = getUpgradeTarget(town, stack.creatureId);
  return to ? { from: stack.creatureId, to, count: stack.count, cost: costTimes(getUpgradeCost(stack.creatureId, to), stack.count) } : null;
}

/** Upgrade a whole stack: cost = price difference x count, needs the upgraded dwelling. */
export function upgradeStack(state, { townId, where, slot }) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const army = armyAt(state, g.town, where);
  if (!army) return fail('no_hero');
  const stack = army[slot];
  if (!stack) return fail('empty_slot');
  const info = getUpgradeInfo(state, { townId, where, slot });
  if (!info) return fail('no_upgrade_available');
  if (!pay(state, g.town.owner, info.cost)) return fail('not_enough_resources');
  stack.creatureId = info.to;
  return ok([{ type: 'stack_upgraded', townId, where, slot, ...info }]);
}

// ---------------------------------------------------------------------------------------------
// Blacksmith, spellbook, Magic University
// ---------------------------------------------------------------------------------------------

function heroForAction(state, town, heroId) {
  const hero = heroId ? state.heroes[heroId] : state.heroes[town.visitingHero] || state.heroes[town.garrisonHero];
  if (!hero || (town.visitingHero !== hero.id && town.garrisonHero !== hero.id)) return null;
  return hero;
}

/** War machines sold here: `[{machineId, cost}]`. */
export function getWarMachinesForSale(state, townId) {
  return getTownEffects(getTown(state, townId), 'sells_war_machine').map(({ effect }) => ({ machineId: effect.machineId, cost: effect.cost }));
}

export function buyWarMachine(state, townId, machineId, heroId) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const offer = getWarMachinesForSale(state, townId).find((o) => o.machineId === machineId);
  if (!offer) return fail('not_sold_here');
  const hero = heroForAction(state, g.town, heroId);
  if (!hero) return fail('no_hero');
  if (hero.artifacts.equipped.war_machine[WAR_MACHINE_SLOT[machineId]] != null) return fail('slot_occupied');
  if (!canAfford(state, g.town.owner, { gold: offer.cost })) return fail('not_enough_resources');
  const r = giveArtifact(hero, machineId);
  if (!r.ok) return r;
  pay(state, g.town.owner, { gold: offer.cost });
  return ok([{ type: 'war_machine_bought', townId, heroId: hero.id, machineId, cost: offer.cost }]);
}

export function buySpellbook(state, townId, heroId) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  if (getMageGuildLevel(g.town) < 1) return fail('no_mage_guild');
  const hero = heroForAction(state, g.town, heroId);
  if (!hero) return fail('no_hero');
  if (hasArtifact(hero, SPELL_BOOK_ARTIFACT)) return fail('already_has_spellbook');
  if (!pay(state, g.town.owner, { gold: SPELLBOOK_COST })) return fail('not_enough_resources');
  giveArtifact(hero, SPELL_BOOK_ARTIFACT);
  const events = [{ type: 'spellbook_bought', townId, heroId: hero.id, cost: SPELLBOOK_COST }];
  events.push(...teachGuildSpells(state, g.town, hero));
  return ok(events);
}

/** Magic University: buy a Basic magic school skill. */
export function learnUniversitySkill(state, townId, skillId, heroId) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const eff = getTownEffects(g.town, 'teach_skill').map((x) => x.effect).find((e) => e.skills.includes(skillId));
  if (!eff) return fail('not_taught_here');
  getSkill(skillId);
  const hero = heroForAction(state, g.town, heroId);
  if (!hero) return fail('no_hero');
  if (getSkillLevel(hero, skillId) > 0) return fail('already_known');
  if (hero.skills.length >= MAX_SECONDARY_SKILLS) return fail('no_skill_slot');
  if (!pay(state, g.town.owner, { gold: eff.cost })) return fail('not_enough_resources');
  hero.skills.push({ id: skillId, level: 1 });
  return ok([{ type: 'skill_learned', townId, heroId: hero.id, skillId, level: 1, cost: eff.cost }]);
}

// ---------------------------------------------------------------------------------------------
// Tavern
// ---------------------------------------------------------------------------------------------

/** Hero definitions nobody uses: not on the map and in no tavern pool. */
export function getFreeHeroDefs(state) {
  const taken = new Set(Object.values(state.heroes).map((h) => h.defId));
  for (const p of state.players) for (const id of p.tavernHeroes || []) if (id) taken.add(id);
  // heroes waiting in prisons on the map (placed by the map generator / scenarios) are not free
  for (const o of Object.values(state.map?.objects || {})) if (o.defId === 'prison' && o.data && o.data.heroDefId) taken.add(o.data.heroDefId);
  return HEROES.filter((d) => !d.special && !taken.has(d.id));
}

function pickTavernHero(state, preferFaction) {
  const free = getFreeHeroDefs(state);
  if (!free.length) return null;
  const preferred = preferFaction ? free.filter((d) => d.faction === preferFaction) : [];
  return pick(state.rng, preferred.length ? preferred : free).id;
}

/** Fill empty tavern slots (slot 0 prefers the player's faction). */
export function ensureTavernPool(state, playerId) {
  const player = state.players[playerId];
  player.tavernHeroes ??= [];
  for (let i = 0; i < TAVERN_POOL_SIZE; i++) {
    if (!player.tavernHeroes[i]) player.tavernHeroes[i] = pickTavernHero(state, i === 0 ? player.faction : null);
  }
  return player.tavernHeroes;
}

/** Weekly refresh: both slots re-rolled. */
export function refreshTavern(state, playerId) {
  const player = state.players[playerId];
  player.tavernHeroes = new Array(TAVERN_POOL_SIZE).fill(null);
  return ensureTavernPool(state, playerId);
}

/**
 * A hero who retreated or surrendered goes back to his owner's tavern (slot 1) keeping level,
 * skills, spells and artifacts; a surrendered hero also keeps his army. Thin wrapper over
 * `removeHero(state, heroId, 'retreated' | 'surrendered')`, which parks him in `state.heroPool`.
 */
export function returnHeroToTavern(state, heroId, opts = {}) {
  if (!state.heroes[heroId]) return fail('no_such_hero');
  const r = deps.removeHero(state, heroId, opts.surrendered ? 'surrendered' : 'retreated');
  return ok(r?.events || []);
}

/** Tavern offer for the UI: `[{defId, name, classId, level, cost} | null x2]`; empty slots are refilled first. */
export function getTavernHeroes(state, playerId) {
  const player = state.players[playerId];
  if (player.alive !== false && (!player.tavernHeroes || player.tavernHeroes.length < TAVERN_POOL_SIZE || player.tavernHeroes.some((d) => !d))) ensureTavernPool(state, playerId);
  return (player.tavernHeroes || []).map((defId) => {
    if (!defId) return null;
    const def = getHeroDef(defId);
    const snap = state.heroPool?.[defId];
    return { defId, name: def.name, classId: def.classId, level: snap ? snap.level : 1, cost: TAVERN_HERO_COST };
  });
}

/** Hire tavern hero `index` (0/1); he appears as the town's visiting hero. */
export function hireHero(state, townId, index) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const town = g.town;
  const eff = getTownEffects(town, 'recruit_heroes')[0]?.effect;
  if (!eff) return fail('no_tavern');
  const player = state.players[town.owner];
  const defId = player.tavernHeroes?.[index];
  if (!defId) return fail('no_hero_offered');
  if (town.visitingHero) return fail('town_occupied');
  if (player.heroes.length >= MAX_HEROES_PER_PLAYER) return fail('too_many_heroes');
  if (!pay(state, town.owner, { gold: eff.cost })) return fail('not_enough_resources');
  // addHero re-uses a hero parked in state.heroPool (retreated / surrendered) with his level and
  // artifacts; a fresh tavern hero comes with only his first stack.
  const hero = deps.addHero(state, defId, town.owner, { ...town.pos }, { tavern: true });
  player.tavernHeroes[index] = null;
  ensureTavernPool(state, town.owner);
  const events = [{ type: 'hero_hired', townId, heroId: hero.id, defId, playerId: town.owner, cost: eff.cost }];
  events.push(...enterTown(state, town, hero));
  return ok(events, { heroId: hero.id });
}

/** Thieves' guild information level: sum of `thieves_guild` values over the player's towns. */
export function getThievesGuildLevel(state, playerId) {
  let level = 0;
  for (const townId of state.players[playerId].towns) {
    for (const { effect } of getTownEffects(state.towns[townId], 'thieves_guild')) level += effect.value;
  }
  return level;
}

export const THIEVES_GUILD_ROWS = [
  { id: 'towns', label: 'Number of Towns', level: 1 },
  { id: 'heroes', label: 'Number of Heroes', level: 1 },
  { id: 'gold', label: 'Gold', level: 2 },
  { id: 'wood_ore', label: 'Wood & Ore', level: 2 },
  { id: 'rare', label: 'Mercury, Sulfur, Crystal & Gems', level: 3 },
  { id: 'best_hero', label: 'Best Hero', level: 3 },
  { id: 'artifacts', label: 'Artifacts', level: 4 },
  { id: 'army', label: 'Kingdom Army Strength', level: 5 },
  { id: 'income', label: 'Income', level: 6 },
];

function thievesStat(state, player, rowId) {
  const r = player.resources;
  const heroes = player.heroes.map((id) => state.heroes[id]).filter(Boolean);
  switch (rowId) {
    case 'towns': return player.towns.length;
    case 'heroes': return heroes.length;
    case 'gold': return r.gold;
    case 'wood_ore': return r.wood + r.ore;
    case 'rare': return r.mercury + r.sulfur + r.crystal + r.gems;
    case 'best_hero': return Math.max(0, ...heroes.map((h) => h.level));
    case 'artifacts': return heroes.reduce((n, h) => n
      + Object.values(h.artifacts.equipped).flat().filter(Boolean).length + h.artifacts.backpack.length, 0);
    case 'army': return heroes.reduce((n, h) => n + armyStrength(h.army), 0)
      + player.towns.reduce((n, t) => n + armyStrength(state.towns[t].garrison), 0);
    case 'income': {
      let gold = 0;
      for (const t of player.towns) for (const { effect } of getTownEffects(state.towns[t], 'resource_income')) if (effect.resource === 'gold') gold += effect.value;
      return gold;
    }
    default: return 0;
  }
}

/**
 * Thieves' guild screen for `playerId`: every row with the ranking of all living players; rows above
 * the player's information level are locked (`ranking: null`).
 * @returns {{level: number, rows: {id, label, unlocked, ranking: number[][]|null}[]}}  `ranking` =
 *   groups of player ids, best first (ties share a group)
 */
export function getThievesGuildInfo(state, playerId) {
  const level = getThievesGuildLevel(state, playerId);
  const alive = state.players.filter((p) => p.alive);
  const rows = THIEVES_GUILD_ROWS.map((row) => {
    if (row.level > level) return { id: row.id, label: row.label, unlocked: false, ranking: null };
    const scored = alive.map((p) => ({ id: p.id, v: thievesStat(state, p, row.id) })).sort((a, b) => b.v - a.v);
    const ranking = [];
    let last = null;
    for (const s of scored) {
      if (last !== null && s.v === last) ranking[ranking.length - 1].push(s.id);
      else ranking.push([s.id]);
      last = s.v;
    }
    return { id: row.id, label: row.label, unlocked: true, ranking };
  });
  return { level, rows };
}

// ---------------------------------------------------------------------------------------------
// Trade buildings: Freelancer's Guild, Artifact Merchants, Grotto, Skeleton Transformer
// ---------------------------------------------------------------------------------------------

function sellableStack(state, town, where, slot, count) {
  const army = armyAt(state, town, where);
  if (!army) return { error: 'no_hero' };
  const stack = army[slot];
  if (!stack) return { error: 'empty_slot' };
  const n = count ?? stack.count;
  if (!Number.isInteger(n) || n < 1 || n > stack.count) return { error: 'bad_count' };
  if (rowIsHero(town, where) && n === stack.count && armyStackCount(army) === 1) return { error: 'last_stack' };
  return { army, stack, n };
}

function removeFromStack(army, slot, n) {
  army[slot].count -= n;
  if (army[slot].count <= 0) army[slot] = null;
}

/**
 * Dismiss a whole stack of the garrison row or the visiting hero (`where: 'garrison'|'visiting'`).
 * A hero's army keeps at least one stack (`last_stack`). Event `stack_dismissed`.
 */
export function dismissTownStack(state, townId, { where = 'garrison', slot }) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const army = armyAt(state, g.town, where);
  if (!army) return fail('no_hero');
  const r = armyDismiss(army, slot, { keepOne: rowIsHero(g.town, where) });
  if (!r.ok) return fail(r.error);
  return ok([{ type: 'stack_dismissed', townId, where, slot, creatureId: r.stack.creatureId, count: r.stack.count }]);
}

/**
 * Freelancer's Guild: sell creatures of a stack for `resource`. Only whole lots are sold
 * (`floor(count / rate.give)` lots); the remainder stays in the army.
 */
export function sellCreatures(state, townId, { where = 'visiting', slot, count, resource = 'gold' }) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  if (!townHasEffect(g.town, 'trade_creatures_for_resources')) return fail('no_freelancers_guild');
  if (!RESOURCES.includes(resource)) return fail('bad_resource');
  const s = sellableStack(state, g.town, where, slot, count);
  if (s.error) return fail(s.error);
  const creature = getCreature(s.stack.creatureId);
  const rate = freelancerRate(creature.cost.gold || 0, resource, Math.max(1, countMarketplaces(state, g.town.owner)));
  const lots = Math.floor(s.n / rate.give);
  if (lots < 1) return fail('not_enough_creatures');
  const sold = lots * rate.give;
  const gained = lots * rate.get;
  removeFromStack(s.army, slot, sold);
  addResources(state, g.town.owner, { [resource]: gained });
  return ok([{ type: 'creatures_sold', townId, creatureId: creature.id, count: sold, resource, amount: gained }]);
}

/**
 * As in the original, all Artifact Merchants of the game share ONE stock (3 treasure, 3 minor,
 * 1 major), rolled when the first Merchants appear and re-rolled on day 1 of every month; a bought
 * slot is empty in every town until then. `state.townMerchants = { stock: (id|null)[7], rolledOn }`.
 */
function rollArtifactMerchants(state) {
  const stock = [];
  for (const cls of ARTIFACT_MERCHANT_SLOTS) stock.push(pickRandomArtifact(state.rng, cls, stock.filter(Boolean)));
  state.townMerchants = { stock, rolledOn: state.turn };
}

function ensureMerchantStock(state) {
  if (!state.townMerchants) rollArtifactMerchants(state);
}

/** The shared Artifact Merchants stock (`(artifactId|null)[]`, empty before any Merchants exist). */
export function getMerchantStock(state) {
  return state.townMerchants?.stock || [];
}

/** Artifact Merchants offer: `[{slot, artifactId, prices: {[resource]: n}} | null]`. */
export function getArtifactMerchantOffers(state, townId) {
  const town = getTown(state, townId);
  if (!townHasEffect(town, 'sells_artifacts')) return [];
  const markets = Math.max(1, countMarketplaces(state, town.owner));
  return getMerchantStock(state).map((artifactId, slot) => {
    if (!artifactId) return null;
    const value = getArtifact(artifactId).cost;
    return { slot, artifactId, prices: Object.fromEntries(RESOURCES.map((r) => [r, artifactBuyPrice(value, r, markets)])) };
  });
}

/** Buy merchant slot `slot` for `resource`; the artifact goes to the visiting hero's backpack. */
export function buyArtifact(state, townId, slot, resource = 'gold') {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const town = g.town;
  if (!townHasEffect(town, 'sells_artifacts')) return fail('no_artifact_merchants');
  if (!RESOURCES.includes(resource)) return fail('bad_resource');
  const artifactId = getMerchantStock(state)[slot];
  if (!artifactId) return fail('sold_out');
  const hero = state.heroes[town.visitingHero];
  if (!hero) return fail('no_hero');
  const price = artifactBuyPrice(getArtifact(artifactId).cost, resource, Math.max(1, countMarketplaces(state, town.owner)));
  if (!canAfford(state, town.owner, { [resource]: price })) return fail('not_enough_resources');
  const r = giveArtifact(hero, artifactId, { toBackpack: true });
  if (!r.ok) return r;
  pay(state, town.owner, { [resource]: price });
  state.townMerchants.stock[slot] = null;
  return ok([{ type: 'artifact_bought', townId, heroId: hero.id, artifactId, resource, price }]);
}

function tradableArtifact(hero, ref) {
  const loc = findArtifact(hero, ref);
  if (!loc) return { error: 'not_found' };
  const def = getArtifact(entryId(loc.entry));
  if (def.noTransfer || def.slot === 'war_machine' || def.slot === 'spellbook') return { error: 'not_tradable' };
  if (loc.where === 'equipped' && isSlotLocked(hero, loc.slot, loc.index)) return { error: 'not_tradable' };
  const spellLevel = typeof loc.entry === 'object' && loc.entry.spellId ? getSpell(loc.entry.spellId).level : undefined;
  return { loc, def, value: artifactValue(loc.entry, spellLevel) };
}

/** Sell an artifact of the visiting hero (`ref`: id / entry / location, see engine/artifacts.js). */
export function sellArtifact(state, townId, ref, resource = 'gold') {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const town = g.town;
  if (!townHasEffect(town, 'sells_artifacts')) return fail('no_artifact_merchants');
  if (!RESOURCES.includes(resource)) return fail('bad_resource');
  const hero = state.heroes[town.visitingHero];
  if (!hero) return fail('no_hero');
  const t = tradableArtifact(hero, ref);
  if (t.error) return fail(t.error);
  const gain = artifactSellPrice(t.value, resource, Math.max(1, countMarketplaces(state, town.owner)));
  const loc = t.loc.where === 'backpack' ? { backpack: t.loc.index } : { slot: t.loc.slot, index: t.loc.index };
  removeArtifact(hero, loc);
  addResources(state, town.owner, { [resource]: gain });
  return ok([{ type: 'artifact_sold', townId, heroId: hero.id, artifactId: t.def.id, resource, amount: gain }]);
}

/** Grotto: sacrifice creatures for `hp x count` experience. */
export function sacrificeCreatures(state, townId, { where = 'visiting', slot, count, heroId }) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const eff = getTownEffects(g.town, 'sacrifice_altar')[0]?.effect;
  if (!eff || !eff.creatures) return fail('no_altar');
  const hero = heroForAction(state, g.town, heroId);
  if (!hero) return fail('no_hero');
  const s = sellableStack(state, g.town, where, slot, count);
  if (s.error) return fail(s.error);
  const exp = getCreature(s.stack.creatureId).hp * s.n;
  const creatureId = s.stack.creatureId;
  removeFromStack(s.army, slot, s.n);
  const r = deps.giveExperience(state, hero.id, exp);
  return ok([{ type: 'sacrificed', townId, heroId: hero.id, creatureId, count: s.n, experience: exp }, ...(r?.events || [])]);
}

/** Grotto: sacrifice an artifact of the visiting hero for `cost / 2` experience. */
export function sacrificeArtifact(state, townId, ref) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const eff = getTownEffects(g.town, 'sacrifice_altar')[0]?.effect;
  if (!eff || !eff.artifacts) return fail('no_altar');
  const hero = state.heroes[g.town.visitingHero];
  if (!hero) return fail('no_hero');
  const t = tradableArtifact(hero, ref);
  if (t.error) return fail(t.error);
  const exp = Math.floor(t.value / 2);
  removeArtifact(hero, t.loc.where === 'backpack' ? { backpack: t.loc.index } : { slot: t.loc.slot, index: t.loc.index });
  const r = deps.giveExperience(state, hero.id, exp);
  return ok([{ type: 'sacrificed', townId, heroId: hero.id, artifactId: t.def.id, experience: exp }, ...(r?.events || [])]);
}

/** What a creature becomes in the Skeleton Transformer, or null when it cannot be transformed. */
export function skeletonTransformResult(creatureId) {
  const c = getCreature(creatureId);
  if (c.warMachine) return null;
  if (['skeleton', 'skeleton_warrior', 'bone_dragon'].includes(creatureId)) return null;
  return SKELETON_TRANSFORMER.dragonIds.includes(creatureId) ? SKELETON_TRANSFORMER.dragons : SKELETON_TRANSFORMER.default;
}

/** Skeleton Transformer: convert one stack (free, 1:1); merges into an existing stack of the result. */
export function transformToSkeletons(state, townId, { where = 'visiting', slot }) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  if (!townHasEffect(g.town, 'skeleton_transform')) return fail('no_skeleton_transformer');
  const army = armyAt(state, g.town, where);
  if (!army) return fail('no_hero');
  const stack = army[slot];
  if (!stack) return fail('empty_slot');
  const to = skeletonTransformResult(stack.creatureId);
  if (!to) return fail('nothing_to_transform');
  const from = stack.creatureId;
  const other = army.findIndex((s, i) => s && i !== slot && s.creatureId === to);
  if (other >= 0) {
    army[other].count += stack.count;
    army[slot] = null;
  } else stack.creatureId = to;
  return ok([{ type: 'transformed', townId, where, slot, from, to, count: stack.count }]);
}

// ---------------------------------------------------------------------------------------------
// Shipyard, Castle Gate
// ---------------------------------------------------------------------------------------------

/** Shipyard: build a boat on the first free adjacent water tile. */
export function buildBoat(state, townId) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const eff = getTownEffects(g.town, 'shipyard')[0]?.effect;
  if (!eff) return fail('no_shipyard');
  const tiles = getTownWaterTiles(state, g.town);
  const tileOf = (p) => state.map.tiles[p.z][p.y][p.x];
  const heroPositions = Object.values(state.heroes).map((h) => `${h.pos.x},${h.pos.y},${h.pos.z || 0}`);
  const free = tiles.find((p) => !tileOf(p).obj && !tileOf(p).blocked && !heroPositions.includes(`${p.x},${p.y},${p.z}`));
  if (!free) {
    const boat = tiles.some((p) => tileOf(p).obj && state.map.objects[tileOf(p).obj]?.defId === 'boat');
    return fail(boat ? 'boat_exists' : 'no_free_water');
  }
  const cost = eff.cost || BOAT_COST;
  if (!pay(state, g.town.owner, cost)) return fail('not_enough_resources');
  const obj = deps.addObject(state, 'boat', free, {});
  return ok([{ type: 'boat_built', townId, pos: free, objectId: obj?.id ?? null, cost }]);
}

/** Towns the visiting hero of `townId` can reach through the Castle Gate. */
export function getCastleGateDestinations(state, townId) {
  const town = getTown(state, townId);
  if (town.owner == null || !townHasEffect(town, 'town_gate')) return [];
  return state.players[town.owner].towns.filter((id) => {
    const t = state.towns[id];
    return id !== townId && townHasEffect(t, 'town_gate') && !t.visitingHero;
  });
}

/** Castle Gate: teleport the visiting hero to another own town with a Castle Gate (free). */
export function useCastleGate(state, townId, destTownId) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const town = g.town;
  if (!townHasEffect(town, 'town_gate')) return fail('no_castle_gate');
  const hero = state.heroes[town.visitingHero];
  if (!hero) return fail('no_hero');
  if (!getCastleGateDestinations(state, townId).includes(destTownId)) return fail('bad_destination');
  const dest = state.towns[destTownId];
  town.visitingHero = null;
  hero.townId = null;
  hero.pos = { ...dest.pos };
  const events = [{ type: 'castle_gate', heroId: hero.id, from: townId, to: destTownId }];
  events.push(...enterTown(state, dest, hero));
  return ok(events);
}

// ---------------------------------------------------------------------------------------------
// Heroes in town: visit, leave, garrison
// ---------------------------------------------------------------------------------------------

function enterTown(state, town, hero) {
  town.visitingHero = hero.id;
  hero.townId = town.id;
  hero.garrisoned = false;
  if (state.map && hero.owner != null) deps.revealAround(state, hero.owner, town.pos, getTownSightRadius(town));
  return [{ type: 'town_visited', heroId: hero.id, townId: town.id }, ...applyVisitEffects(state, town, hero)];
}

/**
 * A hero enters an own town as the visiting hero (the adventure engine has already moved him onto
 * the entrance tile): guild spells, visit bonuses, Stables, Mana Vortex.
 */
export function visitTown(state, heroId, townId) {
  const hero = state.heroes[heroId];
  const town = state.towns[townId];
  if (!hero) return fail('no_such_hero');
  if (!town) return fail('no_such_town');
  if (town.owner !== hero.owner) return fail('not_your_town');
  if (town.visitingHero && town.visitingHero !== heroId) return fail('town_occupied');
  if (hero.townId && hero.townId !== townId) leaveTown(state, heroId);
  return ok(enterTown(state, town, hero));
}

/** The visiting hero steps out of the town (a garrison hero must be swapped out first). */
export function leaveTown(state, heroId) {
  const hero = state.heroes[heroId];
  if (!hero) return fail('no_such_hero');
  const town = hero.townId && state.towns[hero.townId];
  if (!town) return fail('not_in_town');
  if (town.garrisonHero === heroId) return fail('hero_is_garrisoned');
  if (town.visitingHero === heroId) town.visitingHero = null;
  hero.townId = null;
  return ok([{ type: 'town_left', heroId, townId: town.id }]);
}

/**
 * Swap the visiting and the garrison hero (either may be missing). A hero moving into an empty
 * garrison row takes over the garrison troops (all of them must fit into his army).
 */
export function swapTownHeroes(state, townId) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const town = g.town;
  const visiting = state.heroes[town.visitingHero] || null;
  const garrisoned = state.heroes[town.garrisonHero] || null;
  if (!visiting && !garrisoned) return fail('no_hero');
  if (visiting && !garrisoned) {
    if (!armyCanMergeAll(visiting.army, town.garrison)) return fail('army_wont_fit');
    armyMergeAll(visiting.army, town.garrison);
  }
  town.visitingHero = garrisoned ? garrisoned.id : null;
  town.garrisonHero = visiting ? visiting.id : null;
  if (visiting) visiting.garrisoned = true;
  if (garrisoned) garrisoned.garrisoned = false;
  return ok([{ type: 'town_heroes_swapped', townId, visitingHero: town.visitingHero, garrisonHero: town.garrisonHero }]);
}

/**
 * Move / merge / swap / split stacks between and inside the garrison row and the visiting hero.
 * @param {{where: 'garrison'|'visiting', slot: number}} from
 * @param {{where: 'garrison'|'visiting', slot: number}} to
 * @param {number} [count] omitted = whole stack
 */
export function townArmyMove(state, townId, from, to, count) {
  const g = guard(state, townId);
  if (g.error) return fail(g.error);
  const a = armyAt(state, g.town, from.where);
  const b = armyAt(state, g.town, to.where);
  if (!a || !b) return fail('no_hero');
  const r = armyMove(a, from.slot, b, to.slot, count, {
    keepA: rowIsHero(g.town, from.where), keepB: rowIsHero(g.town, to.where),
  });
  if (!r.ok) return r;
  return ok([{ type: 'army_moved', townId, from, to, action: r.action, moved: r.moved }]);
}

// ---------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------

/**
 * Change the owner of a town (after a won siege or when walking into an undefended town).
 * `playerId = null` makes it neutral. `opts.heroId`: the conquering hero becomes the visiting hero.
 * The old garrison is wiped (pass `opts.keepGarrison` to keep it, e.g. scripted hand-overs).
 */
export function captureTown(state, townId, playerId, opts = {}) {
  const town = getTown(state, townId);
  const prev = town.owner;
  if (prev === playerId) return fail('already_owned');
  const events = [];
  if (prev != null) {
    const p = state.players[prev];
    p.towns = p.towns.filter((t) => t !== townId);
  }
  for (const slot of ['visitingHero', 'garrisonHero']) {
    const h = town[slot] && state.heroes[town[slot]];
    if (h && h.owner === playerId && playerId != null) continue;
    if (h) Object.assign(h, { townId: null, garrisoned: false });
    town[slot] = null;
  }
  if (!opts.keepGarrison) town.garrison = createArmy();
  town.owner = playerId;
  if (playerId != null) {
    const player = state.players[playerId];
    if (!player.towns.includes(townId)) player.towns.push(townId);
    player.daysWithoutTown = 0;
    if (town.buildings.includes('capitol') && player.towns.some((t) => t !== townId && state.towns[t].buildings.includes('capitol'))) {
      town.buildings = town.buildings.map((b) => (b === 'capitol' ? 'city_hall' : b));
      events.push({ type: 'capitol_downgraded', townId });
    }
    revealForOwner(state, town);
    if (townHasEffect(town, 'recruit_heroes')) ensureTavernPool(state, playerId);
  }
  if (townHasEffect(town, 'portal_of_summoning')) rollPortal(state, town);
  const obj = Object.values(state.map?.objects || {}).find((o) => o.data?.townId === townId);
  if (obj) obj.owner = playerId;
  events.unshift({ type: 'town_captured', townId, from: prev, to: playerId, playerId });
  const hero = opts.heroId && state.heroes[opts.heroId];
  if (hero && hero.owner === playerId && !town.visitingHero) events.push(...enterTown(state, town, hero));
  events.push(...checkVictory(state).events);
  return ok(events);
}

// ---------------------------------------------------------------------------------------------
// Siege / passive queries for other engines
// ---------------------------------------------------------------------------------------------

/**
 * Bonuses of the defenders when the town is besieged (`garrison_bonus` effects).
 * @returns {{morale: number, luck: number, bonuses: Bonus[], primary: {attack, defense, power, knowledge}}}
 *   `bonuses` (morale / luck) apply to the defending side even without a hero; `primary` is added to
 *   the defending hero's primaries for that combat.
 */
export function getTownGarrisonBonuses(state, townId) {
  const town = getTown(state, townId);
  const sum = { morale: 0, luck: 0, attack: 0, defense: 0, power: 0, knowledge: 0 };
  for (const { effect } of getTownEffects(town, 'garrison_bonus')) sum[effect.stat] += effect.value;
  const bonuses = [];
  if (sum.morale) bonuses.push({ type: 'morale', value: sum.morale, source: `town:${townId}` });
  if (sum.luck) bonuses.push({ type: 'luck', value: sum.luck, source: `town:${townId}` });
  return {
    morale: sum.morale, luck: sum.luck, bonuses,
    primary: { attack: sum.attack, defense: sum.defense, power: sum.power, knowledge: sum.knowledge },
  };
}

/** Arrow tower damage ranges for a town with `n` standing buildings (towns.md §8). */
export function arrowTowerDamage(n) {
  return { keep: { min: 10 + 2 * n, max: 15 + 3 * n }, turret: { min: 6 + n, max: 9 + 2 * n } };
}

/**
 * Everything combat setup needs about a besieged town, or null when it has no fort (ordinary
 * battlefield). `fortLevel`, `faction`, `buildings` are the DESIGN §5 `CombatInput.siege` fields.
 */
export function getSiegeInfo(state, townId) {
  const town = getTown(state, townId);
  const def = getTownEffects(town, 'siege_defense').map((x) => x.effect).sort((a, b) => b.fortLevel - a.fortLevel)[0];
  if (!def) return null;
  const faction = getFaction(town.faction);
  const dmg = arrowTowerDamage(town.buildings.length);
  const escapeTunnel = townHasEffect(town, 'escape_tunnel');
  return {
    townId,
    fortLevel: def.fortLevel,
    faction: town.faction,
    buildings: town.buildings.slice(),
    wallHp: def.wallHp,
    gateHp: def.gateHp,
    keep: def.keep,
    turrets: def.turrets,
    moat: def.moat ? faction.siege.moat : null,
    mines: def.fortLevel >= 2 ? faction.siege.mines : null,
    towers: { attack: 10, keep: def.keep ? dmg.keep : null, turret: def.turrets ? dmg.turret : null },
    garrison: getTownGarrisonBonuses(state, townId),
    escapeTunnel,
    canRetreat: escapeTunnel,
  };
}

/**
 * Bonuses every hero of the player gets from town buildings: `player_hero_bonus` effects
 * (de-duplicated by building id) and `necromancy_bonus` (stacking, as `necromancy_percent`).
 */
export function getPlayerTownBonuses(state, playerId) {
  const out = [];
  const seen = new Set();
  const player = state.players[playerId];
  if (!player) return out;
  for (const townId of player.towns) {
    const town = state.towns[townId];
    for (const { buildingId, effect } of getTownEffects(town)) {
      if (effect.type === 'player_hero_bonus') {
        const key = `${buildingId}:${effect.bonus.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...effect.bonus, source: `building:${buildingId}` });
      } else if (effect.type === 'necromancy_bonus') {
        out.push({ type: 'necromancy_percent', percent: effect.percent, source: `building:${buildingId}:${townId}` });
      }
    }
  }
  return out;
}

/** Lodestar: does every terrain count as native for `faction` creatures of this player? */
export function hasNativeTerrainAll(state, playerId, faction) {
  const player = state.players[playerId];
  if (!player) return false;
  return player.towns.some((t) => getTownEffects(state.towns[t], 'native_terrain_all').some(({ effect }) => effect.faction === faction));
}

/** Does the player own a town with the Grail structure? */
export function playerHasGrailBuilding(state, playerId) {
  const player = state.players[playerId];
  return !!player && player.towns.some((t) => townHasEffect(state.towns[t], 'grail'));
}

/** Starting garrison of a neutral town: tiers 1-3, `weeks` weeks of base growth each. */
export function seedNeutralGarrison(state, townId, multiplier = 1, weeks = 2) {
  const town = getTown(state, townId);
  const dwellings = dwellingsForFaction(town.faction).filter((b) => !b.dwelling.upgraded && !b.dwelling.alt && b.dwelling.tier <= 3);
  dwellings.forEach((b, i) => {
    const c = getCreature(b.dwelling.creatureId);
    town.garrison[i] = { creatureId: c.id, count: Math.max(1, Math.round(c.growth * weeks * multiplier)) };
  });
  return town.garrison;
}
