// Public entry point of the procedural graphics module. See docs/mechanics/gfx.md.
//
//   getSprite(kind, id, opts?) -> canvas (cached)      drawSprite(ctx, kind, id, x, y, opts?)
//   preload(list, onProgress?) -> Promise<number>      clearCache()
//   setCanvasFactory(fn)   getPalette()   playerColorHex(color)   listIds(kind)   getSpriteInfo(...)
//
// Every sprite is drawn once by code onto an offscreen canvas (no image assets) and cached by key.

import { createCanvas, setCanvasFactory, hashStr } from './kit.js';
import { getPalette, playerColorHex } from './palette.js';
import { creatureHandler, CREATURE_IDS } from './kindCreature.js';
import { heroHandler, portraitHandler, HERO_IDS, HERO_FIGURE_IDS } from './heroes.js';
import {
  terrainHandler, TERRAIN_SPRITE_IDS, drawTerrainTile, terrainVariantCount, roadMask, TERRAIN_PRIORITY, DIRS8, setTerrainSpriteGetter, setTerrainPackPainter,
} from './terrain.js';
import { objectHandler, OBJECT_IDS, getObjectSpriteInfo } from './objects.js';
import { buildingHandler, townHandler, getTownLayout, BUILDING_IDS, TOWN_IDS, TOWN_VIEW } from './towns.js';
import { artifactHandler, spellHandler, skillHandler, resourceHandler, ARTIFACT_IDS, SPELL_IDS, SKILL_SPRITE_IDS, RESOURCE_SPRITE_IDS } from './icons.js';
import { uiHandler, UI_IDS, NINE_SLICE, drawPanel, drawButton, drawDamageNumber, setUiSpriteGetter } from './ui.js';
import { obstacleHandler, effectHandler, OBSTACLE_IDS, EFFECT_IDS, EFFECT_FRAMES, effectForSpell } from './combatFx.js';
import { STATE_FRAMES, CREATURE_STATES } from './creatures.js';
// Duelyst (CC0) art layer: tried first, procedural drawing is the fallback (docs/mechanics/duelyst-assets.md).
import {
  getDuelystSprite, getDuelystSpriteInfo, getAnimationInfo as getDuelystAnimationInfo,
  initDuelyst, onSpriteReady as onDuelystSpriteReady, isDuelystReady, getBattlefieldBackground, getBattlefieldLayers, getPortraitCanvas,
} from './duelyst/index.js';
// Asset packs (docs/mechanics/asset-packs.md): the project's generated art (docs/mechanics/generated-art.md)
// first, then third-party CC0 / CC-BY packs. Priority per kind:
// terrain/object/building/town/ui/obstacle and the mapped war machines: packs -> (Duelyst) -> procedural;
// artifact/resource/other kinds: Duelyst -> packs -> procedural (hero boats: packs -> procedural).
import {
  getPackSprite, getPackSpriteInfo, getPackAnimationInfo, initPacks, onPackSpriteReady, isPacksReady,
  terrainPackPainter, preloadTerrainTextures,
} from './packs/index.js';
import { skipDuelyst } from './packs/mapping.js';
import { getSfxUrl, getMusicUrl, musicContextFor, meleeSfxForShape } from './duelyst/audioMap.js';

let useDuelyst = true;
/** Turn the Duelyst art layer on/off (procedural graphics only when off). */
export function setUseDuelyst(on) { useDuelyst = !!on; }

let usePacks = true;
const PACKS_FIRST = new Set(['creature', 'terrain', 'object', 'building', 'town', 'ui', 'obstacle']);
/** Turn the asset-pack layer on/off (terrain textures, extra icons, war machines). */
export function setUsePacks(on) {
  usePacks = !!on;
  setTerrainPackPainter(usePacks ? terrainPackPainter : null);
}
setTerrainPackPainter(terrainPackPainter);

/** Subscribe to "async art arrived" from every art layer (Duelyst sheets, pack images). */
export function onSpriteReady(listener) {
  const a = onDuelystSpriteReady(listener);
  const b = onPackSpriteReady(listener);
  return () => { a(); b(); };
}

/** Load the asset-pack manifest and start loading the terrain textures. */
export async function initArtPacks(o) {
  const r = await initPacks(o);
  preloadTerrainTextures();
  return r;
}

// Hero boats are only drawn procedurally. Ids the pack layer lists in packs/mapping.js
// SKIP_DUELYST bypass a weak Duelyst stand-in (pack art when mapped, else procedural).
function duelystEligible(kind, opts, id) {
  if (!useDuelyst || (kind === 'hero' && opts && opts.variant === 'boat')) return false;
  return !(usePacks && skipDuelyst(kind, id));
}

export const SPRITE_KINDS = [
  'creature', 'hero', 'terrain', 'object', 'building', 'artifact', 'spell', 'resource', 'skill', 'town', 'ui',
  'portrait', 'obstacle', 'effect',
];

/**
 * A handler turns (id, opts) into a paint job:
 *   { dw, dh   design-grid size,
 *     unit     how many design units `opts.size` pixels stand for,
 *     size     default pixel size when opts.size is missing,
 *     key      string of the normalised options that influence the picture,
 *     mirror   true when the sprite should be flipped horizontally (facing -1),
 *     paint(g) draws on the design grid }
 */
const HANDLERS = {
  creature: creatureHandler,
  hero: heroHandler,
  portrait: portraitHandler,
  terrain: terrainHandler,
  object: objectHandler,
  building: buildingHandler,
  town: townHandler,
  artifact: artifactHandler,
  spell: spellHandler,
  skill: skillHandler,
  resource: resourceHandler,
  ui: uiHandler,
  obstacle: obstacleHandler,
  effect: effectHandler,
};

const ID_LISTS = {
  creature: () => CREATURE_IDS,
  hero: () => HERO_FIGURE_IDS,
  portrait: () => HERO_IDS,
  terrain: () => TERRAIN_SPRITE_IDS,
  object: () => OBJECT_IDS,
  building: () => BUILDING_IDS,
  town: () => TOWN_IDS,
  artifact: () => ARTIFACT_IDS,
  spell: () => SPELL_IDS,
  skill: () => SKILL_SPRITE_IDS,
  resource: () => RESOURCE_SPRITE_IDS,
  ui: () => UI_IDS,
  obstacle: () => OBSTACLE_IDS,
  effect: () => EFFECT_IDS,
};

/** All ids a kind accepts (unknown ids still render through the generic fallbacks). */
export function listIds(kind) {
  const fn = ID_LISTS[kind];
  if (!fn) throw new Error(`gfx: unknown sprite kind '${kind}'`);
  return [...fn()];
}

const cache = new Map();
let stats = { hits: 0, misses: 0 };

function job(kind, id, opts) {
  const handler = HANDLERS[kind];
  if (!handler) throw new Error(`gfx: unknown sprite kind '${kind}'`);
  const o = opts || {};
  const j = handler(String(id), o);
  const size = Math.max(1, Math.round(Number(o.size) > 0 ? Number(o.size) : j.size));
  const scale = size / j.unit;
  return { ...j, px: size, scale, w: Math.max(1, Math.round(j.dw * scale)), h: Math.max(1, Math.round(j.dh * scale)) };
}

/**
 * Size (in pixels) and anchor a sprite would have, without rendering it.
 * `anchorX/anchorY` is the point that should sit on the logical position (feet for creatures,
 * entrance tile centre-bottom for map objects, top-left = 0,0 for icons/tiles).
 */
export function getSpriteInfo(kind, id, opts) {
  const packsFirst = usePacks && PACKS_FIRST.has(kind);
  if (packsFirst) {
    const pi = getPackSpriteInfo(kind, id, opts);
    if (pi) return pi;
  }
  if (duelystEligible(kind, opts, id)) {
    const di = getDuelystSpriteInfo(kind, id, opts);
    if (di) return di;
  }
  if (usePacks && !packsFirst) {
    const pi = getPackSpriteInfo(kind, id, opts);
    if (pi) return pi;
  }
  const j = job(kind, id, opts);
  return {
    width: j.w, height: j.h, scale: j.scale,
    anchorX: Math.round((j.ax ?? 0) * j.scale), anchorY: Math.round((j.ay ?? 0) * j.scale),
    frames: j.frames || 1,
  };
}

/**
 * Get (and cache) a sprite canvas.
 * @param {string} kind one of SPRITE_KINDS
 * @param {string} id
 * @param {{size?: number, frame?: number, facing?: 1|-1, playerColor?: string|number, variant?: string|number, state?: string}} [opts]
 * @returns {HTMLCanvasElement|OffscreenCanvas}
 */
export function getSprite(kind, id, opts) {
  const packsFirst = usePacks && PACKS_FIRST.has(kind);
  if (packsFirst) {
    const p = getPackSprite(kind, id, opts);
    if (p) return p;
  }
  if (duelystEligible(kind, opts, id)) {
    const d = getDuelystSprite(kind, id, opts);
    if (d) return d;
  }
  if (usePacks && !packsFirst) {
    const p = getPackSprite(kind, id, opts);
    if (p) return p;
  }
  const j = job(kind, id, opts);
  const key = `${kind}|${id}|${j.px}|${j.mirror ? 'm' : ''}|${j.key}`;
  const hit = cache.get(key);
  if (hit) {
    stats.hits++;
    return hit;
  }
  stats.misses++;
  const canvas = createCanvas(j.w, j.h);
  const g = canvas.getContext('2d');
  g.save();
  if (j.mirror) {
    g.translate(j.w, 0);
    g.scale(-1, 1);
  }
  g.scale(j.scale, j.scale);
  j.paint(g);
  g.restore();
  cache.set(key, canvas);
  return canvas;
}

/**
 * Draw a sprite with its top-left corner at (x, y) (use getSpriteInfo for anchors).
 * `opts.w/opts.h` optionally stretch the cached sprite to a destination box.
 */
export function drawSprite(ctx, kind, id, x, y, opts) {
  const c = getSprite(kind, id, opts);
  if (opts && opts.w && opts.h) ctx.drawImage(c, x, y, opts.w, opts.h);
  else ctx.drawImage(c, x, y);
  return c;
}

/**
 * Warm the cache. `list` items are `[kind, id, opts?]` or `{kind, id, opts}`.
 * Yields to the event loop between batches so a loading bar can repaint.
 * @returns {Promise<number>} number of sprites rendered
 */
export async function preload(list, onProgress, batch = 24) {
  const items = list || [];
  let done = 0;
  for (const it of items) {
    const [kind, id, opts] = Array.isArray(it) ? it : [it.kind, it.id, it.opts];
    getSprite(kind, id, opts);
    done++;
    if (onProgress) onProgress(done, items.length);
    if (done % batch === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return done;
}

setTerrainSpriteGetter(getSprite);
setUiSpriteGetter(getSprite);

export function clearCache() {
  cache.clear();
  stats = { hits: 0, misses: 0 };
}

export function cacheStats() {
  return { size: cache.size, ...stats };
}

/** Number of animation frames for (kind, id, state). */
export function getFrameCount(kind, id, state) {
  if (usePacks) {
    const pa = getPackAnimationInfo(kind, id, state);
    if (pa) return pa.frames;
  }
  if (duelystEligible(kind, null, id)) {
    const a = getDuelystAnimationInfo(kind, id, state);
    if (a) return a.frames;
  }
  if (kind === 'creature' || kind === 'hero') return STATE_FRAMES[state || 'idle'] || 1;
  return job(kind, id, { state }).frames || 1;
}

export {
  initDuelyst, isDuelystReady, initPacks, isPacksReady, getPackAnimationInfo, getBattlefieldBackground, getBattlefieldLayers, getPortraitCanvas,
  getDuelystAnimationInfo, getSfxUrl, getMusicUrl, musicContextFor, meleeSfxForShape,
  setCanvasFactory, getPalette, playerColorHex, hashStr,
  drawTerrainTile, terrainVariantCount, roadMask, TERRAIN_PRIORITY, DIRS8,
  getObjectSpriteInfo, getTownLayout, TOWN_VIEW,
  NINE_SLICE, drawPanel, drawButton, drawDamageNumber,
  EFFECT_FRAMES, effectForSpell, STATE_FRAMES, CREATURE_STATES,
};
