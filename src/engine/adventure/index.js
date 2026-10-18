// Adventure engine public API (DESIGN.md §8). Mechanics: docs/mechanics/adventure-engine.md.
import './realDeps.js';

export {
  createEmptyMap, inBounds, getTile, getFootprint, canPlaceObject, addObject, removeObject, relocateObject,
  getObjectAt, getHeroAt, getTownAt, getBoatAt, getBoatOfHero, objectsByDef, objectsByEffect,
  pairSubterraneanGates, debugRenderMap,
} from './map.js';
export { initObject, concretizeQuest, ensurePuzzleOrder } from './init.js';
export {
  findPath, getReachable, moveHero, getMoveContext, getStepCost, spendStep, classifyStep, placeHero,
  maxMovePointsFor, checkCanAct,
} from './movement.js';
export {
  visitObject, interactWithObject, findGuard, mineOutput, whirlpoolLoss, EFFECTS, CONFIRM_KINDS, alreadyVisited,
} from './visit.js';
export {
  getFlaggedDwellings, garrisonTransfer, hillFortCost, getThievesGuildTable, buildBoatAt, heroAlignment,
  creatureSacrificeExp,
} from './services.js';
export { questFulfilled } from './quests.js';
export { evaluateMonster, powerFactor, baseStackCount, splitMonster, growMonster } from './monsters.js';
export {
  revealAround, revealWhere, hideAround, isExplored, isVisible, getVisibleTiles, getVisionSources,
  refreshVision, ensureExplored, TOWN_SIGHT_RADIUS, OBJECT_SIGHT_RADIUS,
} from './fog.js';
export {
  castAdventureSpell, getSpellMastery, getAdventureSpellCost, getVisionsInfo, getDisplayedArmy,
} from './spells.js';
export { digForGrail, digError, setupGrail, getPuzzleProgress, getGrailObject, PUZZLE_PIECES, PUZZLE_TILES_PER_PIECE } from './grail.js';
export { startOfDayAdventure, startOfWeekAdventure, getMineIncome, spawnMonthMonsters } from './daily.js';
export { resolveReward, applyReward, rollArtifact, rollSpell } from './rewards.js';
export { hasKey, teleportDestinations, findFreeWaterTile, createBoat, shipyardLaunchTile } from './transport.js';
export { beginCombat, fight, onCombatOutcome, ensureCombatWired } from './combat.js';
export { deps, setDeps, resetDeps, useFallbackDeps, registerRealModule, finishStubCombat } from './deps.js';
