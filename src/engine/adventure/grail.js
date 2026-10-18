// Grail, obelisks, puzzle map and digging (docs/mechanics/adventure-objects.md §6).
import { getTerrain } from '../../data/terrain.js';
import { randInt } from '../../core/rng.js';
import { giveArtifact } from '../artifacts.js';
import { EFFECTS } from './registry.js';
import { getTile, addObject, removeObject, objectsByEffect, objectsByDef, getHeroAt } from './map.js';
import { ensurePuzzleOrder, PUZZLE_COLS, PUZZLE_ROWS } from './init.js';
import { note, markVisited } from './visit.js';
import { checkCanAct, maxMovePointsFor } from './movement.js';
import { ok, fail, areAllies, samePos, copyPos } from './util.js';

export const PUZZLE_PIECES = PUZZLE_COLS * PUZZLE_ROWS;

/** The hidden grail marker object, or null. */
export function getGrailObject(state) {
  return objectsByDef(state, 'grail')[0] || null;
}

const diggable = (state, pos) => {
  const tile = getTile(state.map, pos);
  if (!tile || tile.blocked || tile.obj || tile.road) return false;
  const ter = getTerrain(tile.t);
  return ter.passable && !ter.water && ter.diggable;
};

/**
 * Hide the grail on a random diggable tile if the map has none yet (called once by createGame).
 * `opts.pos` forces the position. Also fixes the puzzle piece order.
 */
export function setupGrail(state, opts = {}) {
  ensurePuzzleOrder(state);
  if (getGrailObject(state)) return ok([]);
  let pos = opts.pos || null;
  const map = state.map;
  for (let i = 0; !pos && i < 500; i++) {
    const p = { x: randInt(state.rng, 0, map.width - 1), y: randInt(state.rng, 0, map.height - 1), z: 0 };
    if (diggable(state, p) && !getHeroAt(state, p)) pos = p;
  }
  if (!pos) return ok([]);
  addObject(state, 'grail', pos);
  return ok([]);
}

/** Obelisk ids visited by the player or its allies. */
function teamObelisks(state, playerId) {
  const ids = new Set();
  for (const p of state.players) {
    if (!areAllies(state, p.id, playerId)) continue;
    for (const o of objectsByEffect(state, 'obelisk')) if (p.visited && p.visited[o.id]) ids.add(o.id);
  }
  return ids;
}

/** Map tiles per puzzle piece (each side). */
export const PUZZLE_TILES_PER_PIECE = 3;

/**
 * The map area the puzzle shows: `cols × rows` pieces of `PUZZLE_TILES_PER_PIECE` tiles centred on the
 * grail (clamped to the map). @returns {{x0, y0, w, h, z, tilesPerPiece}|null}
 */
function puzzleArea(state, grail) {
  if (!grail) return null;
  const { width, height } = state.map;
  const w = Math.min(width, PUZZLE_COLS * PUZZLE_TILES_PER_PIECE);
  const h = Math.min(height, PUZZLE_ROWS * PUZZLE_TILES_PER_PIECE);
  const x0 = Math.max(0, Math.min(width - w, grail.pos.x - Math.floor(w / 2)));
  const y0 = Math.max(0, Math.min(height - h, grail.pos.y - Math.floor(h / 2)));
  return { x0, y0, w, h, z: grail.pos.z || 0, tilesPerPiece: PUZZLE_TILES_PER_PIECE };
}

/**
 * Puzzle-map progress of a player's team.
 * @returns {{visited:number, total:number, piecesRemoved:number, removed:number[], cols:number, rows:number,
 *            complete:boolean, grailPos:{x,y,z}|null, area:{x0,y0,w,h,z,tilesPerPiece}|null}}
 *   `area` (the map window the puzzle draws) once at least one piece is removed - before that the UI
 *   shows only covered pieces, so nothing about the location leaks; `grailPos` only once every
 *   obelisk was visited
 */
export function getPuzzleProgress(state, playerId) {
  const total = objectsByEffect(state, 'obelisk').length;
  const visited = teamObelisks(state, playerId).size;
  const piecesRemoved = total ? Math.floor((PUZZLE_PIECES * visited) / total) : 0;
  const order = ensurePuzzleOrder(state);
  const complete = total > 0 && visited >= total;
  const grail = getGrailObject(state);
  return {
    visited, total, piecesRemoved, removed: order.slice(0, piecesRemoved), cols: PUZZLE_COLS, rows: PUZZLE_ROWS,
    complete, grailPos: complete && grail ? copyPos(grail.pos) : null,
    area: piecesRemoved > 0 ? puzzleArea(state, grail) : null,
  };
}

EFFECTS.obelisk = {
  visit(ctx) {
    const { state, hero, obj } = ctx;
    const before = teamObelisks(state, hero.owner).has(obj.id);
    markVisited(ctx);
    const progress = getPuzzleProgress(state, hero.owner);
    note(ctx, before ? 'already_visited' : 'obelisk', { progress });
  },
};

/** Can the hero dig on its tile? @returns {string|null} error */
export function digError(state, hero) {
  if (hero.inBoat) return 'in_boat';
  const tile = getTile(state.map, hero.pos);
  if (!tile) return 'bad_tile';
  const ter = getTerrain(tile.t);
  if (ter.water || !ter.passable || !ter.diggable) return 'not_diggable';
  if (tile.obj || tile.road || hero.townId) return 'tile_occupied';
  const max = hero.maxMovePoints || maxMovePointsFor(state, hero, false);
  if (hero.movePoints < max) return 'needs_full_movement';
  return null;
}

/**
 * Dig for the grail on the hero's tile: needs the full daily movement, uses all of it.
 * Finds the grail (artifact `grail`, marker removed, everyone notified) or leaves a `hole`.
 */
export function digForGrail(state, heroId) {
  const err = checkCanAct(state, heroId);
  if (err) return err;
  const hero = state.heroes[heroId];
  const reason = digError(state, hero);
  if (reason) return fail(reason);
  hero.movePoints = 0;
  const grail = getGrailObject(state);
  if (grail && samePos(grail.pos, hero.pos)) {
    removeObject(state, grail.id);
    const res = giveArtifact(hero, 'grail');
    const ev = { type: 'grail_found', heroId, playerId: hero.owner, pos: copyPos(hero.pos) };
    (state.log ??= []).push({ ...ev, turn: state.turn });
    addObject(state, 'hole', hero.pos);
    return ok([ev, ...(res.events || [])], { found: true });
  }
  const hole = addObject(state, 'hole', hero.pos);
  return ok([{ type: 'dig', heroId, pos: copyPos(hero.pos), holeId: hole.id, found: false }], { found: false });
}
