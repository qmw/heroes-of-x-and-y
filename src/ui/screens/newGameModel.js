// New-game setup model (pure - no DOM, unit-tested). The view is newGame.js.
import { PLAYER_COLORS, FACTIONS } from '../../core/constants.js';
import { HERO_BY_ID, getFactionHeroes } from '../../data/heroes.js';
import { FACTION_BY_ID } from '../../data/factions.js';

export const DIFFICULTIES = [
  { id: 0, name: 'Easy', percent: 80, note: 'Generous starting resources; the AI plays cautiously.' },
  { id: 1, name: 'Normal', percent: 100, note: 'The standard experience.' },
  { id: 2, name: 'Hard', percent: 130, note: 'Fewer starting resources; stronger AI.' },
  { id: 3, name: 'Expert', percent: 160, note: 'Scarce resources; aggressive AI.' },
  { id: 4, name: 'Impossible', percent: 200, note: 'You start with nothing. Good luck.' },
];

export const MAP_SIZES = [
  { id: 'S', name: 'Small', size: 36, maxPlayers: 4 },
  { id: 'M', name: 'Medium', size: 72, maxPlayers: 6 },
  { id: 'L', name: 'Large', size: 108, maxPlayers: 8 },
  { id: 'XL', name: 'Extra Large', size: 144, maxPlayers: 8 },
];
export const WATER_AMOUNTS = [{ id: 'none', name: 'None' }, { id: 'normal', name: 'Normal' }, { id: 'islands', name: 'Islands' }];
export const MONSTER_STRENGTHS = [{ id: 'weak', name: 'Weak' }, { id: 'normal', name: 'Normal' }, { id: 'strong', name: 'Strong' }];
export const DEFAULT_TEMPLATES = [{ id: 'default', name: 'Balanced', description: 'Every player gets a home zone; treasure zones in between.' }];
export const VICTORY_CONDITIONS = [
  { id: 'standard', name: 'Defeat all enemies' },
  { id: 'capture_all_towns', name: 'Capture every town' },
  { id: 'find_grail', name: 'Build a Grail structure' },
  { id: 'accumulate_gold', name: 'Accumulate 100,000 gold' },
];
export const LOSS_CONDITIONS = [
  { id: 'standard', name: 'Lose all towns and heroes' },
  { id: 'time_3_months', name: 'Time runs out (3 months)' },
  { id: 'time_6_months', name: 'Time runs out (6 months)' },
];
export const STARTING_BONUSES = [
  { id: 'random', name: 'Random' }, { id: 'gold', name: 'Gold' }, { id: 'resources', name: 'Resources' }, { id: 'artifact', name: 'Artifact' },
];
export const SLOT_TYPES = [{ id: 'human', name: 'Human' }, { id: 'ai', name: 'Computer' }, { id: 'closed', name: 'Closed' }];
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;

const colorName = (c) => c[0].toUpperCase() + c.slice(1);

/**
 * @typedef {Object} SetupSlot
 * @property {number} slot 0..7   @property {'human'|'ai'|'closed'} type
 * @property {string} color      @property {string} name
 * @property {string} faction    faction id | 'random'
 * @property {string} hero       hero def id | 'random'
 * @property {string} bonus      'random'|'gold'|'resources'|'artifact'
 */

/** Fresh setup: 1 human vs 1 computer on a medium random map. */
export function createSetup({ seed = 1 } = {}) {
  return {
    mapType: 'random',           // 'random' | 'scenario' | 'custom' (map editor library)
    size: 'M', underground: false, water: 'normal', monsters: 'normal', template: 'default',
    scenarioId: null,
    customMapId: null,
    maxPlayers: MAP_SIZES.find((s) => s.id === 'M').maxPlayers,     // follows the map size / scenario
    difficulty: 1, victory: 'standard', loss: 'standard',
    seed: normalizeSeed(seed),
    players: PLAYER_COLORS.slice(0, MAX_PLAYERS).map((color, i) => ({
      slot: i, type: i === 0 ? 'human' : i === 1 ? 'ai' : 'closed', color,
      name: i === 0 ? 'Player' : `${colorName(color)} player`, faction: 'random', hero: 'random', bonus: 'random',
    })),
  };
}

/** Any input -> positive 32-bit integer seed (strings are hashed). */
export function normalizeSeed(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return (Math.abs(Math.floor(value)) >>> 0) || 1;
  const s = String(value ?? '').trim();
  if (/^\d+$/.test(s)) return (Number(s) >>> 0) || 1;
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0;
  return x || 1;
}

export const openSlots = (setup) => setup.players.filter((p) => p.type !== 'closed');

/** Change a slot's type, respecting the player cap. Returns true if applied. */
// ---- custom maps (map editor): per-slot permissions and allowed towns -----------------------------

const customSlot = (setup, slot) => (setup.mapType === 'custom' && Array.isArray(setup.customSlots) ? setup.customSlots.find((s) => s && s.slot === slot) || null : null);

/** May this seat be human / computer / closed? (custom maps restrict seats; others allow everything) */
export function slotTypeAllowed(setup, slot, type) {
  if (setup.mapType !== 'custom' || type === 'closed') return true;
  if (setup.customPlayerSlots != null && slot >= setup.customPlayerSlots) return false;
  const c = customSlot(setup, slot);
  if (!c) return true;
  return type === 'human' ? c.human !== false : c.ai !== false;
}

/** Faction choices of a seat (the custom map's allowed towns, else all). */
export function allowedFactions(setup, slot) {
  const c = customSlot(setup, slot);
  return c && Array.isArray(c.factions) && c.factions.length ? FACTIONS.filter((f) => c.factions.includes(f)) : FACTIONS.slice();
}

export function setSlotType(setup, slot, type) {
  const p = setup.players[slot];
  if (!p || !SLOT_TYPES.some((t) => t.id === type)) return false;
  if (!slotTypeAllowed(setup, slot, type)) return false;
  if (type !== 'closed' && p.type === 'closed' && openSlots(setup).length >= setup.maxPlayers) return false;
  p.type = type;
  return true;
}

/** Colours stay unique: the slot that had `color` gets this slot's old colour. */
export function setSlotColor(setup, slot, color) {
  const p = setup.players[slot];
  if (!p || !PLAYER_COLORS.includes(color)) return false;
  const other = setup.players.find((x) => x.color === color && x !== p);
  if (other) other.color = p.color;
  p.color = color;
  return true;
}

/** Next free-or-swappable colour after the slot's current one. */
export function cycleSlotColor(setup, slot) {
  const p = setup.players[slot];
  const i = PLAYER_COLORS.indexOf(p.color);
  return setSlotColor(setup, slot, PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length]);
}

/** Set the faction; a starting hero from another faction is reset to random. */
export function setSlotFaction(setup, slot, faction) {
  const p = setup.players[slot];
  if (!p || (faction !== 'random' && !FACTIONS.includes(faction))) return false;
  if (faction !== 'random' && !allowedFactions(setup, slot).includes(faction)) return false;
  p.faction = faction;
  if (p.hero !== 'random' && (faction === 'random' || HERO_BY_ID[p.hero]?.faction !== faction)) p.hero = 'random';
  return true;
}

/** Heroes selectable for a faction ('random' faction => only the random hero). */
export function heroChoices(faction) {
  if (faction === 'random' || !FACTION_BY_ID[faction]) return [];
  return getFactionHeroes(faction);
}

export function setSlotHero(setup, slot, heroId) {
  const p = setup.players[slot];
  if (!p) return false;
  if (heroId !== 'random') {
    const def = HERO_BY_ID[heroId];
    if (!def || def.faction !== p.faction) return false;
    // one hero cannot start for two players
    if (setup.players.some((x) => x !== p && x.type !== 'closed' && x.hero === heroId)) return false;
  }
  p.hero = heroId;
  return true;
}

/** Apply a player cap (map size / scenario): closes surplus slots from the end, keeps >= 2 open. */
export function setMaxPlayers(setup, max) {
  setup.maxPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, max || MAX_PLAYERS));
  const open = openSlots(setup);
  for (let i = open.length - 1; i >= setup.maxPlayers; i--) open[i].type = 'closed';
  return setup;
}

export function setMapSize(setup, sizeId) {
  const s = MAP_SIZES.find((x) => x.id === sizeId);
  if (!s) return false;
  setup.size = sizeId;
  if (setup.mapType === 'random') setMaxPlayers(setup, s.maxPlayers);
  return true;
}

/** Select a scenario from `listScenarios()` meta ({ id, name, playerSlots, ... }) or null. */
export function setScenario(setup, meta) {
  setup.scenarioId = meta ? meta.id : null;
  if (meta && meta.playerSlots) {
    setMaxPlayers(setup, meta.playerSlots);
    // scenarios have a fixed number of seats: open them all
    const closed = setup.players.filter((p) => p.type === 'closed');
    while (openSlots(setup).length < Math.min(meta.playerSlots, MAX_PLAYERS) && closed.length) closed.shift().type = 'ai';
  }
  return setup;
}

/** Select a custom map from the editor library (`mapStorage.js` index entry `{ id, name, playerSlots }`) or null. */
export function setCustomMap(setup, meta) {
  setup.customMapId = meta ? meta.id : null;
  setup.customSlots = meta && Array.isArray(meta.players) ? meta.players : null;
  setup.customPlayerSlots = meta && meta.playerSlots ? meta.playerSlots : null;
  if (meta && meta.playerSlots) {
    // seats = the map's slots in order (slot numbers are kept: map owners are slots)
    setup.players.forEach((p, i) => {
      if (i >= meta.playerSlots) { p.type = 'closed'; return; }
      if (p.type === 'closed') p.type = i === 0 ? 'human' : 'ai';
      if (!slotTypeAllowed(setup, i, p.type)) p.type = p.type === 'human' ? 'ai' : 'human';
      if (!slotTypeAllowed(setup, i, p.type)) p.type = 'closed';
      const allowed = allowedFactions(setup, i);
      if (p.faction !== 'random' && !allowed.includes(p.faction)) setSlotFaction(setup, i, 'random');
      if (allowed.length === 1) setSlotFaction(setup, i, allowed[0]);
    });
    setup.maxPlayers = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, meta.playerSlots));
  }
  return setup;
}

export function setMapType(setup, type) {
  setup.mapType = type === 'scenario' || type === 'custom' ? type : 'random';
  if (setup.mapType === 'random') setMaxPlayers(setup, MAP_SIZES.find((s) => s.id === setup.size).maxPlayers);
  return setup;
}

/** @returns {{ ok: boolean, errors: string[] }} */
export function validateSetup(setup) {
  const errors = [];
  const open = openSlots(setup);
  if (open.length < MIN_PLAYERS) errors.push('At least two players are needed.');
  if (open.length > setup.maxPlayers) errors.push(`This map supports at most ${setup.maxPlayers} players.`);
  if (!open.some((p) => p.type === 'human')) errors.push('At least one player must be human.');
  if (new Set(open.map((p) => p.color)).size !== open.length) errors.push('Every player needs a different colour.');
  if (setup.mapType === 'scenario' && !setup.scenarioId) errors.push('Choose a scenario.');
  if (setup.mapType === 'custom' && !setup.customMapId) errors.push('Choose a custom map.');
  if (setup.mapType === 'custom') {
    for (const p of open) {
      if (!slotTypeAllowed(setup, p.slot, p.type)) errors.push(`${p.name}: this map does not allow a ${p.type === 'human' ? 'human' : 'computer'} player here.`);
      if (p.faction !== 'random' && !allowedFactions(setup, p.slot).includes(p.faction)) errors.push(`${p.name}: this town is not allowed on this map.`);
    }
  }
  if (!DIFFICULTIES.some((d) => d.id === setup.difficulty)) errors.push('Choose a difficulty.');
  for (const p of open) {
    if (p.hero !== 'random' && HERO_BY_ID[p.hero]?.faction !== p.faction) errors.push(`${p.name}: the starting hero does not belong to the chosen town.`);
  }
  return { ok: errors.length === 0, errors };
}

/** New-game victory choice id -> engine victory condition (victory.js VICTORY_TYPES). */
export function victorySetting(id) {
  switch (id) {
    case 'capture_all_towns': return { type: 'capture_all_towns', allowStandard: true };
    case 'find_grail': return { type: 'build_grail', allowStandard: true };
    case 'accumulate_gold': return { type: 'accumulate_resources', resource: 'gold', amount: 100000, allowStandard: true };
    default: return 'standard';
  }
}

/** New-game loss choice id -> engine loss condition (28-day months). */
export function lossSetting(id) {
  switch (id) {
    case 'time_3_months': return { type: 'time_limit', days: 3 * 28 };
    case 'time_6_months': return { type: 'time_limit', days: 6 * 28 };
    default: return 'standard';
  }
}

/**
 * The `settings` argument of `createGame(blueprint, settings)` (DESIGN.md §8).
 * Open slots are renumbered 0..n-1 in order; `slot` matches the blueprint's `ownerSlot`.
 * Extras beyond the contract (ignored by engines that do not know them): `hero`, `bonus`, `difficultyPercent`, `mapName`.
 */
export function buildGameSettings(setup) {
  const diff = DIFFICULTIES.find((d) => d.id === setup.difficulty) || DIFFICULTIES[1];
  return {
    seed: normalizeSeed(setup.seed),
    difficulty: diff.id,
    difficultyPercent: diff.percent,
    players: openSlots(setup).map((p, i) => ({
      // custom maps keep the seat's slot (map owners are slots; unplayed slots become neutral)
      slot: setup.mapType === 'custom' ? p.slot : i, name: p.name || colorName(p.color), isHuman: p.type === 'human', faction: p.faction, color: p.color,
      hero: p.hero, bonus: p.bonus,
      ...(setup.mapType === 'custom' && allowedFactions(setup, p.slot).length < FACTIONS.length ? { allowedFactions: allowedFactions(setup, p.slot) } : {}),
    })),
    victory: victorySetting(setup.victory),
    loss: lossSetting(setup.loss),
  };
}

/** Options for `generateMap(options)` (src/engine/mapgen). */
export function buildMapOptions(setup) {
  const size = MAP_SIZES.find((s) => s.id === setup.size) || MAP_SIZES[1];
  const open = openSlots(setup);
  const base = {
    seed: normalizeSeed(setup.seed),
    players: open.length,
    humanPlayers: open.filter((p) => p.type === 'human').length,
    factions: open.map((p) => p.faction),
    playerSlots: open.map((p, i) => ({ slot: i, faction: p.faction, isHuman: p.type === 'human', hero: p.hero })),
  };
  if (setup.mapType === 'scenario') return { ...base, type: 'scenario', scenario: setup.scenarioId, scenarioId: setup.scenarioId };
  if (setup.mapType === 'custom') return { ...base, type: 'custom', mapId: setup.customMapId };
  return { ...base, type: 'random', size: size.id, width: size.size, height: size.size, levels: setup.underground ? 2 : 1,
    underground: !!setup.underground, water: setup.water, monsters: setup.monsters, monsterStrength: setup.monsters, template: setup.template };
}
