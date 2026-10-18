// Handcrafted scenarios. Each module exports a compact description (ASCII terrain layout + object
// lists, see scenarioBuilder.js); listScenarios() gives the UI metadata, buildScenario() the
// MapBlueprint. All content (names, texts, layouts) is original to this project.
import { buildScenarioMap } from './scenarioBuilder.js';
import firstBlood from './firstBlood.js';
import dragonsHoard from './dragonsHoard.js';
import grailHunt from './grailHunt.js';
import sevenKingdoms from './sevenKingdoms.js';
import sapphireArchipelago from './sapphireArchipelago.js';
import undeadRising from './undeadRising.js';
import factoryLines from './factoryLines.js';

export const SCENARIOS = [firstBlood, dragonsHoard, grailHunt, sevenKingdoms, sapphireArchipelago, undeadRising, factoryLines];
const BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

const describe = (c, kind) => {
  if (!c || c === 'standard') return kind === 'victory' ? 'Defeat all enemies' : 'Lose all towns and heroes';
  return c.type;
};

/** Metadata for the new-game screen. */
export function listScenarios() {
  return SCENARIOS.map((s) => {
    const rows = (Array.isArray(s.layout[0]) ? s.layout[0] : s.layout).length;
    const cols = (Array.isArray(s.layout[0]) ? s.layout[0] : s.layout)[0].length;
    return {
      id: s.id, name: s.name, description: s.description, size: s.size,
      width: cols * s.scale, height: rows * s.scale, levels: Array.isArray(s.layout[0]) ? s.layout.length : 1,
      players: s.players, playerSlots: s.players, difficulty: s.difficulty,
      victory: s.victoryText || describe(s.victory, 'victory'), loss: s.lossText || describe(s.loss, 'loss'),
      victoryCondition: s.victory || 'standard', lossCondition: s.loss || 'standard',
      factions: (s.playerInfo || []).map((p) => p.faction),
    };
  });
}

const cache = new Map();

/** Build (and cache) a scenario's blueprint; returns a fresh deep copy. Unknown id -> null. */
export function buildScenario(id) {
  const spec = BY_ID[id];
  if (!spec) return null;
  if (!cache.has(id)) cache.set(id, JSON.stringify(buildScenarioMap(spec)));
  return JSON.parse(cache.get(id));
}
