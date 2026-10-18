// Map editor engine - public API (docs/mechanics/editor.md). Pure functions over a MapBlueprint
// wrapped in an EditorDoc (undo / redo history); no DOM.
export {
  MAP_FORMAT, MAP_FORMAT_VERSION, EDITOR_SIZES, MIN_MAP_SIZE, MAX_MAP_SIZE, MAX_SLOTS, TOWN_SIZE,
  createBlankBlueprint, normalizeBlueprint, createEditor, newMap, setMapInfo, resizeMap, setPlayerCount, setPlayer,
  setVictory, setLoss, victoryProblems, lossProblems, serializeMap, deserializeMap, blueprintFromRandomMap,
  prepareForPlay, buildPlaySettings, defaultSeats, defaultPlayerMeta, sizeName, rectFootprint,
  addTimedEvent, setTimedEvent, removeTimedEvent, remapHeroQuests,
} from './blueprint.js';
export {
  HERO_ID, TOWN_IDS, BRUSH_SIZES, DIRS8, inBounds, tileOf, footprintOf, occupancy, refAt, getRef, describeRef, listRefs,
  canPlace, brushTiles, terrainAllowedOnLevel, paintTerrain, fillTerrain, linePoints, linePoints4, paintRoad, paintRoadLine,
  paintRiver, paintRiverLine, roadMask, riverMask, placeObject, removeRef, removeAt, moveRef, setProps, pairGates,
} from './ops.js';
export { EDITOR_QUEST_TYPES, OWNABLE_EFFECTS, PAYLOAD_KEYS, objectDataProblems, questProblems, rewardProblems, timedEventProblems, heroProblems } from './data.js';
export { validateMap, editorWarnings, positionOfMessage } from './validate.js';
export { undo, redo, canUndo, canRedo, beginBatch, endBatch, HISTORY_LIMIT } from './history.js';
