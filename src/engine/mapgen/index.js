// Map generator public API (DESIGN.md §8 "MapBlueprint"; docs/mechanics/mapgen.md).
//   generateMap(options) -> MapBlueprint | { ok: false, error }
//     options.type === 'scenario': { scenarioId | scenario }  -> handcrafted scenario
//     otherwise random map: { size: 'S'|'M'|'L'|'XL'|'H'|'XH'|'G' (or width/height), levels | underground,
//       water: 'none'|'normal'|'islands', monsters | monsterStrength: 'weak'|'normal'|'strong'|'none',
//       template, players, playerSlots: [{slot, faction, hero}], factions, teams, seed, name }
//   listTemplates(), listScenarios(), validateBlueprint(bp), renderBlueprintAscii(bp)
import { generateRandomMap, normalizeOptions, MAP_SIZES, nativeSurfaceTerrain } from './generator.js';
import { listTemplates, TEMPLATES, getTemplate, expandTemplate } from './templates.js';
import { validateBlueprint, reachableFrom, landReachableFrom } from './validate.js';
import { renderBlueprintAscii } from './ascii.js';
import { listScenarios, buildScenario, SCENARIOS } from './scenarios/index.js';
import { guardStrength, pickGuard } from './treasure.js';

export {
  listTemplates, listScenarios, validateBlueprint, renderBlueprintAscii, reachableFrom, landReachableFrom,
  MAP_SIZES, TEMPLATES, SCENARIOS, getTemplate, expandTemplate, normalizeOptions, guardStrength, pickGuard,
  nativeSurfaceTerrain,
};

/**
 * Build a map blueprint: a handcrafted scenario or a random map.
 * Never throws for bad options - returns `{ ok: false, error }` instead.
 */
export function generateMap(options = {}) {
  try {
    if (options.type === 'scenario') {
      const id = options.scenarioId || options.scenario;
      if (!id) return { ok: false, error: 'no scenario selected' };
      const bp = buildScenario(id, options);
      if (!bp) return { ok: false, error: `unknown scenario: ${id}` };
      return bp;
    }
    return generateRandomMap(options, validateBlueprint);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
