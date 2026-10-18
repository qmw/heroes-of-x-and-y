// Adventure map renderer: camera, cached terrain chunks, z-sorted objects and heroes, shroud,
// hover cursor and path preview. Draws only the visible window and only when dirty.
// Spec: docs/mechanics/ui-adventure.md §2.
import { TERRAIN_BY_ID, ROAD_BY_INDEX } from '../../../data/terrain.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import {
  CHUNK, TILE_SIZES, objectDef, explored, fogMask, roadMask, riverMask, neighbourTerrains,
  buildObjectIndex, townOfObject, fortState, playerOf, pathMarkers,
} from './model.js';

const MAX_CHUNKS = 48;
const PLAYER_HEX = { red: '#c8322a', blue: '#2f5fd0', tan: '#b89a6a', green: '#3c9a3c', orange: '#e0832a', purple: '#8a3fb8', teal: '#2aa3a0', pink: '#d87aa8' };

function makeOffscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * @param ctx   screen ctx (ui, gfx, drawSprite)
 * @param opts  { width, height, getState: () => state, getViewer: () => playerId }
 */
/** Canvas filter giving pixel-art units a 1px dark outline (matches the outlined procedural objects). */
const SPRITE_OUTLINE = 'drop-shadow(1px 0 0 rgba(20,14,8,0.9)) drop-shadow(-1px 0 0 rgba(20,14,8,0.9)) drop-shadow(0 1px 0 rgba(20,14,8,0.9)) drop-shadow(0 -1px 0 rgba(20,14,8,0.9))';

export function createMapView(ctx, opts) {
  const { ui } = ctx;
  const width = opts.width;
  const height = opts.height;
  const cv = ui.createCanvas(width, height, { class: 'adv-map-canvas', pixelated: true });
  const getState = opts.getState;
  const getViewer = opts.getViewer || (() => null);

  const view = {
    canvas: cv.canvas, width, height,
    ts: TILE_SIZES[TILE_SIZES.length - 1], level: 0, dirty: true,   // 48 px: heroes and monsters stay legible on the 1280x720 stage (wheel / - zooms out)
    hover: null, path: null, markers: [], pathHeroId: null, selectedHeroId: null, selectedTownId: null,
    heroAnim: null, facing: {}, pick: null, showGrid: false,
    index: { at: new Map(), chunks: new Map() },
    stats: { frames: 0, tilesDrawn: 0, chunkRenders: 0, chunksDrawn: 0, objectsDrawn: 0, gfxTiles: 0, fallbackTiles: 0 },
  };
  let cam = null;
  let chunkCache = new Map();
  let chunkState = null;
  const infoCache = new Map();

  const gfxModule = () => (ctx.gfx && ctx.gfx.available ? ctx.gfx.module : null);

  // Unexplored land: a world-anchored dark parchment / cloud texture (cool slate underground)
  // instead of flat black tiles; null where canvas patterns are unavailable (Node tests).
  const shroudPatterns = new Map();
  function shroudPattern(g, z) {
    if (shroudPatterns.has(z)) return shroudPatterns.get(z);
    let pat = null;
    try { pat = makeShroudPattern(g, z); } catch { pat = null; }
    shroudPatterns.set(z, pat);
    return pat;
  }

  function mapSize() {
    const s = getState();
    return s ? { w: s.map.width, h: s.map.height, levels: s.map.levels } : { w: 1, h: 1, levels: 1 };
  }

  function resetCamera(keepCenter = true) {
    const { w, h } = mapSize();
    const prev = cam ? cam.center() : null;
    const prevTs = cam ? cam.ts : view.ts;
    cam = ui.createCamera({ viewW: width, viewH: height, worldW: w * view.ts, worldH: h * view.ts });
    cam.ts = view.ts;
    if (keepCenter && prev) cam.centerOn((prev.x / prevTs) * view.ts, (prev.y / prevTs) * view.ts);
    view.cam = cam;
  }
  resetCamera(false);

  // ---- public API --------------------------------------------------------------------------------
  view.markDirty = () => { view.dirty = true; };
  view.invalidateObjects = () => {
    const s = getState();
    view.index = s ? buildObjectIndex(s) : { at: new Map(), chunks: new Map() };
    view.dirty = true;
  };
  view.invalidateTerrain = () => { chunkCache = new Map(); view.dirty = true; };
  /** Drop only the cached chunks containing (or bordering) these tiles (map editor painting). */
  view.invalidateTiles = (tiles) => {
    const drop = new Set();
    for (const t of tiles) {
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) drop.add(`${t.z || 0}:${Math.floor((t.x + dx) / CHUNK)}:${Math.floor((t.y + dy) / CHUNK)}:`);
    }
    for (const key of [...chunkCache.keys()]) if (drop.has(key.slice(0, key.lastIndexOf(':') + 1))) chunkCache.delete(key);
    view.dirty = true;
  };
  view.setLevel = (z) => {
    const { levels } = mapSize();
    const nz = Math.max(0, Math.min(levels - 1, z | 0));
    if (nz !== view.level) { view.level = nz; view.path = null; view.markers = []; view.dirty = true; }
    return view.level;
  };
  view.setTileSize = (ts) => {
    if (!TILE_SIZES.includes(ts) || ts === view.ts) return;
    view.ts = ts;
    chunkCache = new Map();
    resetCamera(true);
    view.dirty = true;
  };
  view.zoom = (dir) => {
    const i = TILE_SIZES.indexOf(view.ts);
    view.setTileSize(TILE_SIZES[Math.max(0, Math.min(TILE_SIZES.length - 1, i + dir))]);
  };
  view.centerOnTile = (x, y, z) => {
    if (z != null) view.setLevel(z);
    cam.centerOn((x + 0.5) * view.ts, (y + 0.5) * view.ts);
    view.dirty = true;
  };
  view.panBy = (dx, dy) => { cam.panBy(dx, dy); view.dirty = true; };
  view.tileAt = (sx, sy) => {
    const w = cam.screenToWorld(sx, sy);
    return { x: Math.floor(w.x / view.ts), y: Math.floor(w.y / view.ts), z: view.level };
  };
  view.tileToScreen = (x, y) => cam.worldToScreen(x * view.ts, y * view.ts);
  view.isTileVisible = (x, y) => {
    const r = view.visibleTiles();
    return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  };
  view.visibleTiles = () => {
    const { w, h } = mapSize();
    return cam.visibleCells(view.ts, w, h);
  };
  /** Camera rectangle as fractions of the map (minimap). */
  view.viewportFraction = () => {
    const { w, h } = mapSize();
    const r = cam.visibleRect();
    return { x: r.x / (w * view.ts), y: r.y / (h * view.ts), w: r.w / (w * view.ts), h: r.h / (h * view.ts) };
  };
  view.setHover = (t) => {
    const same = (a, b) => (a == null && b == null) || (a && b && a.x === b.x && a.y === b.y && a.z === b.z);
    if (!same(view.hover, t)) { view.hover = t; view.dirty = true; }
  };
  view.setPath = (path, heroId = null) => {
    view.path = path || null;
    view.pathHeroId = path ? heroId : null;
    view.markers = pathMarkers(path);
    view.dirty = true;
  };
  view.setSelection = (heroId, townId) => { view.selectedHeroId = heroId || null; view.selectedTownId = townId || null; view.dirty = true; };
  view.setHeroAnim = (a) => { view.heroAnim = a; view.dirty = true; };
  view.setFacing = (heroId, f) => { view.facing[heroId] = f; };
  view.setPick = (p) => { view.pick = p; view.dirty = true; };

  // ---- terrain chunks ----------------------------------------------------------------------------
  function drawTileFallback(g, state, tile, x, y, z, px, py, ts) {
    const ter = TERRAIN_BY_ID[tile.t];
    g.fillStyle = ter ? ter.color : '#555';
    g.fillRect(px, py, ts, ts);
    if (tile.river) {
      g.fillStyle = '#4a8ad0';
      g.fillRect(px + ts * 0.35, py, ts * 0.3, ts);
    }
    if (tile.road) {
      const rd = ROAD_BY_INDEX[tile.road];
      g.fillStyle = rd ? rd.color : '#8a6a3e';
      g.fillRect(px + ts * 0.3, py + ts * 0.3, ts * 0.4, ts * 0.4);
      const m = roadMask(state, x, y, z);
      if (m & 1) g.fillRect(px + ts * 0.3, py, ts * 0.4, ts * 0.35);
      if (m & 2) g.fillRect(px + ts * 0.65, py + ts * 0.3, ts * 0.35, ts * 0.4);
      if (m & 4) g.fillRect(px + ts * 0.3, py + ts * 0.65, ts * 0.4, ts * 0.35);
      if (m & 8) g.fillRect(px, py + ts * 0.3, ts * 0.35, ts * 0.4);
    }
  }

  function renderChunk(state, z, cx, cy) {
    const ts = view.ts;
    const { w, h } = mapSize();
    const c = makeOffscreen(CHUNK * ts, CHUNK * ts);
    const g = c.getContext('2d');
    const mod = gfxModule();
    const draw = mod && typeof mod.drawTerrainTile === 'function' ? mod.drawTerrainTile : null;
    for (let ty = 0; ty < CHUNK; ty++) {
      const y = cy * CHUNK + ty;
      if (y >= h) break;
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = cx * CHUNK + tx;
        if (x >= w) break;
        const tile = state.map.tiles[z][y][x];
        const px = tx * ts;
        const py = ty * ts;
        let done = false;
        if (draw) {
          try {
            const ter = TERRAIN_BY_ID[tile.t];
            draw(g, px, py, ts, {
              terrain: tile.t, seed: `${x},${y},${z}`, neighbors: neighbourTerrains(state, x, y, z),
              road: tile.road || 0, roadMask: tile.road ? roadMask(state, x, y, z) : 0,
              river: tile.river ? (ter && ter.river) || 1 : 0, riverMask: tile.river ? riverMask(state, x, y, z) : 0,
              overlay: tile.overlay || null,
            });
            done = true;
            view.stats.gfxTiles++;
          } catch (err) { done = false; if (!view.lastGfxError) view.lastGfxError = err; }
        }
        if (!done) { drawTileFallback(g, state, tile, x, y, z, px, py, ts); view.stats.fallbackTiles++; }
      }
    }
    view.stats.chunkRenders++;
    return c;
  }

  function getChunk(state, z, cx, cy) {
    if (chunkState !== state) { chunkCache = new Map(); chunkState = state; }
    const key = `${z}:${cx}:${cy}:${view.ts}`;
    let c = chunkCache.get(key);
    if (c) { chunkCache.delete(key); chunkCache.set(key, c); return c; }
    c = renderChunk(state, z, cx, cy);
    chunkCache.set(key, c);
    while (chunkCache.size > MAX_CHUNKS) chunkCache.delete(chunkCache.keys().next().value);
    return c;
  }
  view.chunkCount = () => chunkCache.size;

  // ---- sprites -----------------------------------------------------------------------------------
  function spriteInfo(kind, id, o) {
    const mod = gfxModule();
    if (!mod || typeof mod.getSpriteInfo !== 'function') return null;
    const key = `${kind}|${id}|${o.size}|${o.variant || ''}`;
    if (infoCache.has(key)) return infoCache.get(key);
    let info = null;
    try { info = mod.getSpriteInfo(kind, id, o); } catch { info = null; }
    infoCache.set(key, info);
    return info;
  }

  /** Draw a sprite so that its anchor sits at (ax, ay); false when gfx is missing (caller draws a fallback). */
  function drawAnchored(g, kind, id, ax, ay, o, outline = false) {
    if (!gfxModule()) return false;
    const info = spriteInfo(kind, id, o);
    if (!info) return false;
    if (!outline || !('filter' in g)) return ctx.drawSprite(g, kind, id, Math.round(ax - info.anchorX), Math.round(ay - info.anchorY), o);
    // pixel-art units get the same dark ink outline as the procedural map objects
    g.save();
    g.filter = SPRITE_OUTLINE;
    const ok = ctx.drawSprite(g, kind, id, Math.round(ax - info.anchorX), Math.round(ay - info.anchorY), o);
    g.restore();
    return ok;
  }

  const colorOf = (state, owner) => {
    const p = playerOf(state, owner);
    return p ? p.color : null;
  };

  function drawObject(g, state, obj) {
    const ts = view.ts;
    const def = objectDef(obj.defId);
    const [fw, fh] = def.size || [1, 1];
    const ex = obj.pos.x * ts;
    const ey = obj.pos.y * ts;
    const x0 = (obj.pos.x - Math.floor(fw / 2)) * ts;
    const y0 = (obj.pos.y - fh + 1) * ts;
    view.stats.objectsDrawn++;
    if (obj.defId === 'monster' && obj.data && CREATURE_BY_ID[obj.data.creatureId]) {
      if (gfxModule() && g.ellipse) {
        g.fillStyle = 'rgba(0, 0, 0, 0.28)';
        g.beginPath(); g.ellipse(ex + ts / 2, ey + ts - 4, ts * 0.34, ts * 0.11, 0, 0, Math.PI * 2); g.fill();
      }
      if (drawAnchored(g, 'creature', obj.data.creatureId, ex + ts / 2, ey + ts - 2, { size: Math.round(ts * 1.3), facing: -1 }, true)) return;
      g.fillStyle = '#c03a2a';
      g.beginPath();
      g.arc(ex + ts / 2, ey + ts / 2, ts * 0.36, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff2d0';
      g.font = `bold ${Math.floor(ts * 0.35)}px Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(obj.data.creatureId).slice(0, 2).toUpperCase(), ex + ts / 2, ey + ts / 2);
      return;
    }
    const town = townOfObject(state, obj);
    const owner = town ? town.owner : obj.owner;
    const o = { size: ts, playerColor: owner != null ? colorOf(state, owner) : undefined };
    if (town) { o.variant = town.faction; o.state = fortState(town); }
    if (gfxModule()) {
      if (ctx.drawSprite(g, 'object', obj.defId, x0, y0, o)) return;
    }
    // fallback: footprint block in the definition colour, entrance marked, owner flag
    g.fillStyle = def.color || '#a09a8a';
    g.globalAlpha = def.blocking === false ? 0.6 : 0.95;
    g.fillRect(x0 + 2, y0 + 2, fw * ts - 4, fh * ts - 4);
    g.globalAlpha = 1;
    g.strokeStyle = '#1c1512';
    g.lineWidth = 1;
    g.strokeRect(x0 + 2.5, y0 + 2.5, fw * ts - 5, fh * ts - 5);
    if (def.interact !== 'none') { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(ex + ts * 0.3, ey + ts * 0.45, ts * 0.4, ts * 0.55); }
    if (owner != null) {
      g.fillStyle = PLAYER_HEX[colorOf(state, owner)] || '#999';
      g.fillRect(x0 + 4, y0 + 4, ts * 0.35, ts * 0.25);
    }
  }

  function heroInTown(state, hero) {
    if (hero.townId) return true;
    for (const t of Object.values(state.towns || {})) if (t.visitingHero === hero.id) return true;
    return false;
  }

  function drawHero(g, state, hero, fx, fy) {
    const ts = view.ts;
    const color = colorOf(state, hero.owner);
    const facing = view.facing[hero.id] || 1;
    const cx = fx * ts + ts / 2;
    // a hero visiting a town stands in front of its gate, a little smaller, so both stay readable
    const inTown = !view.heroAnim || view.heroAnim.heroId !== hero.id ? heroInTown(state, hero) : false;
    const foot = fy * ts + ts - 2 + (inTown ? Math.round(ts * 0.3) : 0);
    if (hero.inBoat && !gfxModule()) {
      g.fillStyle = '#8a5a2a';
      g.fillRect(fx * ts + 2, fy * ts + ts * 0.55, ts - 4, ts * 0.4);
    }
    if (view.selectedHeroId === hero.id) {
      g.strokeStyle = '#ffe9a6';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse ? g.ellipse(cx, foot - 2, ts * 0.42, ts * 0.16, 0, 0, Math.PI * 2) : g.arc(cx, foot - 2, ts * 0.4, 0, Math.PI * 2);
      g.stroke();
    }
    const o = { size: Math.round(ts * (inTown ? 1.2 : 1.5)), facing, playerColor: color || undefined, variant: hero.inBoat ? 'boat' : undefined, state: view.heroAnim && view.heroAnim.heroId === hero.id ? 'move' : undefined };
    if (drawAnchored(g, 'hero', hero.defId, cx, foot, o, true)) return;
    g.fillStyle = PLAYER_HEX[color] || '#999';
    g.beginPath();
    g.moveTo(cx, fy * ts + 3);
    g.lineTo(cx + ts * 0.35, foot);
    g.lineTo(cx - ts * 0.35, foot);
    g.closePath();
    g.fill();
    g.strokeStyle = '#1c1512';
    g.stroke();
  }

  // ---- frame -------------------------------------------------------------------------------------
  /**
   * Draw the visible window into `g` (default: the view canvas). Returns false when nothing was drawn.
   */
  view.render = (force = false, g = cv.ctx) => {
    const state = getState();
    if (!g || !state) return false;
    if (!view.dirty && !force) return false;
    view.dirty = false;
    view.stats.frames++;
    const ts = view.ts;
    const z = view.level;
    const viewer = getViewer();
    const { w, h } = mapSize();
    const r = cam.visibleCells(ts, w, h);
    g.save();
    const shroudFill = shroudPattern(g, z);
    g.fillStyle = '#0a0806';
    g.fillRect(0, 0, width, height);
    g.translate(-Math.round(cam.x * cam.zoom), -Math.round(cam.y * cam.zoom));
    if (shroudFill) {
      // beyond the map edge too, so the texture surrounds small maps
      g.fillStyle = shroudFill;
      g.fillRect(Math.round(cam.x * cam.zoom), Math.round(cam.y * cam.zoom), width, height);
    }

    // 1. terrain chunks
    const c0x = Math.floor(r.x0 / CHUNK); const c1x = Math.floor(r.x1 / CHUNK);
    const c0y = Math.floor(r.y0 / CHUNK); const c1y = Math.floor(r.y1 / CHUNK);
    view.stats.chunksDrawn = 0;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        g.drawImage(getChunk(state, z, cx, cy), cx * CHUNK * ts, cy * CHUNK * ts);
        view.stats.chunksDrawn++;
      }
    }
    if (view.showGrid) {
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 1;
      for (let x = r.x0; x <= r.x1 + 1; x++) { g.beginPath(); g.moveTo(x * ts + 0.5, r.y0 * ts); g.lineTo(x * ts + 0.5, (r.y1 + 1) * ts); g.stroke(); }
      for (let y = r.y0; y <= r.y1 + 1; y++) { g.beginPath(); g.moveTo(r.x0 * ts, y * ts + 0.5); g.lineTo((r.x1 + 1) * ts, y * ts + 0.5); g.stroke(); }
    }

    // 2. path dots under the objects
    for (const m of view.markers) {
      if (m.z !== z || m.last) continue;
      g.fillStyle = m.today ? '#58d058' : '#e04838';
      g.strokeStyle = '#102010';
      g.beginPath();
      g.arc(m.x * ts + ts / 2, m.y * ts + ts / 2, Math.max(3, ts * 0.12), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // 3. objects + heroes, z-sorted by footprint bottom row (objects may stick 3 tiles out of a chunk)
    const items = [];
    const pad = 4;
    for (let cy = Math.floor((r.y0 - 1) / CHUNK); cy <= Math.floor((r.y1 + pad) / CHUNK); cy++) {
      for (let cx = Math.floor((r.x0 - pad) / CHUNK); cx <= Math.floor((r.x1 + pad) / CHUNK); cx++) {
        const list = view.index.chunks.get(`${z}:${cx}:${cy}`);
        if (!list) continue;
        for (const obj of list) {
          const [fw, fh] = objectDef(obj.defId).size || [1, 1];
          const x0 = obj.pos.x - Math.floor(fw / 2);
          if (x0 + fw - 1 < r.x0 || x0 > r.x1 || obj.pos.y < r.y0 || obj.pos.y - fh + 1 > r.y1) continue;
          items.push({ y: obj.pos.y, x: obj.pos.x, o: 0, obj });
        }
      }
    }
    for (const hero of Object.values(state.heroes || {})) {
      if (hero.garrisoned || !hero.pos || (hero.pos.z || 0) !== z) continue;
      const a = view.heroAnim && view.heroAnim.heroId === hero.id ? view.heroAnim : null;
      const fx = a ? a.x : hero.pos.x;
      const fy = a ? a.y : hero.pos.y;
      if (fx < r.x0 - 2 || fx > r.x1 + 2 || fy < r.y0 - 2 || fy > r.y1 + 2) continue;
      items.push({ y: fy, x: fx, o: 1, hero, fx, fy });
    }
    items.sort((a, b) => a.y - b.y || a.o - b.o || a.x - b.x);
    view.stats.objectsDrawn = 0;
    for (const it of items) {
      try {
        if (it.hero) drawHero(g, state, it.hero, it.fx, it.fy);
        else drawObject(g, state, it.obj);
      } catch (err) { /* one broken sprite never kills the frame */ }
    }

    // 4. shroud
    let tiles = 0;
    const mod = gfxModule();
    if (shroudFill && viewer != null) {
      g.beginPath();
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) if (!explored(state, viewer, x, y, z)) g.rect(x * ts, y * ts, ts, ts);
      }
      g.fillStyle = shroudFill;
      g.fill();
    }
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        tiles++;
        if (viewer == null) continue;
        const px = x * ts;
        const py = y * ts;
        if (!explored(state, viewer, x, y, z)) {
          if (shroudFill) continue;
          if (!mod || !ctx.drawSprite(g, 'terrain', 'shroud', px, py, { size: ts, variant: 'full' })) { g.fillStyle = '#0a0806'; g.fillRect(px, py, ts, ts); }
          continue;
        }
        const m = fogMask(state, viewer, x, y, z);
        if (!m) continue;
        if (mod && ctx.drawSprite(g, 'terrain', 'shroud', px, py, { size: ts, variant: m })) continue;
        g.fillStyle = 'rgba(10,8,6,0.55)';
        if (m & 1) g.fillRect(px, py, ts, ts * 0.3);
        if (m & 2) g.fillRect(px + ts * 0.7, py, ts * 0.3, ts);
        if (m & 4) g.fillRect(px, py + ts * 0.7, ts, ts * 0.3);
        if (m & 8) g.fillRect(px, py, ts * 0.3, ts);
      }
    }
    view.stats.tilesDrawn = tiles;

    // 5. path markers on top: day numbers, destination cross
    for (const m of view.markers) {
      if (m.z !== z) continue;
      const cx = m.x * ts + ts / 2;
      const cy = m.y * ts + ts / 2;
      if (m.last) {
        g.strokeStyle = m.today ? '#58d058' : '#e04838';
        g.lineWidth = 3;
        const k = ts * 0.25;
        g.beginPath(); g.moveTo(cx - k, cy - k); g.lineTo(cx + k, cy + k); g.moveTo(cx + k, cy - k); g.lineTo(cx - k, cy + k); g.stroke();
      }
      if (m.dayMarker) {
        g.fillStyle = 'rgba(20,14,8,0.85)';
        g.fillRect(cx - ts * 0.22, cy - ts * 0.5, ts * 0.44, ts * 0.32);
        g.fillStyle = '#ffe9a6';
        g.font = `bold ${Math.floor(ts * 0.28)}px Georgia, serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(m.dayMarker + 1), cx, cy - ts * 0.34);
      }
    }

    // 6. hover cursor, selected town, pick highlight
    if (view.selectedTownId && state.towns[view.selectedTownId]) {
      const t = state.towns[view.selectedTownId];
      if ((t.pos.z || 0) === z) { g.strokeStyle = '#ffe9a6'; g.lineWidth = 2; g.strokeRect(t.pos.x * ts + 1, t.pos.y * ts + 1, ts - 2, ts - 2); }
    }
    if (view.hover && view.hover.z === z) {
      g.strokeStyle = view.pick ? (view.pick.valid && view.pick.valid(view.hover) ? '#58d0ff' : '#e04838') : 'rgba(255,233,166,0.8)';
      g.lineWidth = view.pick ? 2 : 1;
      g.strokeRect(view.hover.x * ts + 0.5, view.hover.y * ts + 0.5, ts - 1, ts - 1);
    }
    g.restore();
    return true;
  };

  /** Subscribe to the gfx layer's "sprite ready" notification (Duelyst sheets load async). */
  view.subscribeSprites = () => {
    const mod = ctx.gfx && ctx.gfx.module;
    const sub = mod && (mod.onSpriteReady || (mod.duelyst && mod.duelyst.onSpriteReady));
    if (typeof sub !== 'function') return () => {};
    try { return sub(() => { infoCache.clear(); view.invalidateTerrain(); }) || (() => {}); } catch { return () => {}; }
  };

  view.invalidateObjects();
  return view;
}

/** Seeded 0..1 generator (deterministic texture). */
function texRng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}

/**
 * 256x256 tileable texture for unexplored land: soft dark blotches and speckle over a warm
 * parchment-brown base (surface) or a cool slate base (underground).
 */
export function makeShroudPattern(g, z) {
  if (typeof document === 'undefined' || typeof g.createPattern !== 'function') return null;
  const N = 512;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const t = c.getContext('2d');
  if (!t || typeof t.createRadialGradient !== 'function') return null;
  const under = z > 0;
  const base = under ? '#0f0d15' : '#120d08';
  const light = under ? [40, 34, 56] : [46, 34, 20];
  const dark = under ? [6, 5, 10] : [8, 6, 3];
  t.fillStyle = base;
  t.fillRect(0, 0, N, N);
  const r = texRng(under ? 977 : 311);
  const blot = (x, y, rad, rgb, a) => {
    for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) {
      const cx = x + dx; const cy = y + dy;
      if (cx + rad < 0 || cx - rad > N || cy + rad < 0 || cy - rad > N) continue;
      const gr = t.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`);
      gr.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      t.fillStyle = gr;
      t.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
  };
  for (let i = 0; i < 90; i++) blot(r() * N, r() * N, 30 + r() * 80, light, 0.25 + r() * 0.3);
  for (let i = 0; i < 60; i++) blot(r() * N, r() * N, 25 + r() * 60, dark, 0.2 + r() * 0.25);
  for (let i = 0; i < 3600; i++) {
    const v = r();
    t.fillStyle = v < 0.5 ? `rgba(${light[0] + 30},${light[1] + 24},${light[2] + 16},0.18)` : 'rgba(0,0,0,0.22)';
    t.fillRect(Math.floor(r() * N), Math.floor(r() * N), 1 + (v > 0.9 ? 1 : 0), 1);
  }
  return g.createPattern(c, 'repeat');
}
