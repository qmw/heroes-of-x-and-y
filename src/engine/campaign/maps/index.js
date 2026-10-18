// Handcrafted campaign maps (same compact format as src/engine/mapgen/scenarios/*.js, built by the
// mapgen scenario builder). All names, texts and layouts are original to this project.
import { buildScenarioMap } from '../../mapgen/scenarios/scenarioBuilder.js';
import wreckersShore from './wreckersShore.js';
import pearlTithe from './pearlTithe.js';
import stormSound from './stormSound.js';
import cogValley from './cogValley.js';
import sandsea from './sandsea.js';
import ashrun from './ashrun.js';
import lastFurnace from './lastFurnace.js';
import frostmarch from './frostmarch.js';
import dawnChapel from './dawnChapel.js';
import thaw from './thaw.js';

export const CAMPAIGN_MAPS = [
  wreckersShore, pearlTithe, stormSound,
  cogValley, sandsea, ashrun, lastFurnace,
  frostmarch, dawnChapel, thaw,
];
export const CAMPAIGN_MAP_BY_ID = Object.fromEntries(CAMPAIGN_MAPS.map((m) => [m.id, m]));

const cache = new Map();

/** Build (and cache) a campaign map's MapBlueprint; returns a fresh deep copy. Unknown id -> null. */
export function buildCampaignMap(id) {
  const spec = CAMPAIGN_MAP_BY_ID[id];
  if (!spec) return null;
  if (!cache.has(id)) cache.set(id, JSON.stringify(buildScenarioMap(spec)));
  return JSON.parse(cache.get(id));
}

/** Small metadata block of a map (for briefings / tests). */
export function campaignMapInfo(id) {
  const s = CAMPAIGN_MAP_BY_ID[id];
  if (!s) return null;
  const lay = Array.isArray(s.layout[0]) ? s.layout[0] : s.layout;
  return {
    id: s.id, name: s.name, description: s.description, size: s.size, players: s.players,
    width: lay[0].length * s.scale, height: lay.length * s.scale, levels: Array.isArray(s.layout[0]) ? s.layout.length : 1,
    victoryText: s.victoryText, lossText: s.lossText, victory: s.victory, loss: s.loss,
    factions: (s.playerInfo || []).map((p) => p.faction),
  };
}
