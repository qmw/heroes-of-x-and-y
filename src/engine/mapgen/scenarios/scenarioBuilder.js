// Scenario builder: turns a compact handcrafted description (ASCII terrain layout at a cell scale
// + towns, heroes, roads and object lists in cell coordinates) into a MapBlueprint.
// Format: docs/mechanics/mapgen.md §8.
import { createRng, rand, pick, shuffle, weightedPick } from '../../../core/rng.js';
import { getTerrain } from '../../../data/terrain.js';
import { getMapObject } from '../../../data/mapObjects.js';
import { rollSpell } from '../../adventure/index.js';
import {
  createBuilder, idxOf, inside, isLand, isWater, setTerrain, reserve, shortestPath, makeNoise, canPlace, place,
  placeConnected, connect, accessOf, canPlaceTown, placeTown, placeMonster, coverWithDecor, toBlueprint,
  OCC_FREE, OCC_KEEP, NEIGHBOURS8,
} from '../builder.js';
import { guardStrength, pickGuard, POOL, composePile } from '../treasure.js';
import { BANDS } from '../templates.js';

/** Layout characters: lowercase = open terrain, uppercase = the same terrain covered by obstacles. */
export const LAYOUT_TERRAIN = {
  g: 'grass', d: 'dirt', s: 'sand', n: 'snow', w: 'swamp', r: 'rough', l: 'lava', h: 'highlands', x: 'wasteland',
  u: 'subterranean', '~': 'water', '#': 'rock',
};

function cellTerrain(ch) {
  if (LAYOUT_TERRAIN[ch]) return { t: LAYOUT_TERRAIN[ch], obstacle: false };
  const low = ch.toLowerCase();
  if (LAYOUT_TERRAIN[low]) return { t: LAYOUT_TERRAIN[low], obstacle: true };
  throw new Error(`scenario layout: unknown character '${ch}'`);
}

/**
 * @param {object} spec scenario description (see scenarios/*.js)
 * @param {object} [options] generateMap options (seed is ignored: scenarios are fixed, decor uses spec.seed)
 */
export function buildScenarioMap(spec) {
  const layouts = Array.isArray(spec.layout[0]) ? spec.layout : [spec.layout];
  const s = spec.scale;
  const rows = layouts[0].length; const cols = layouts[0][0].length;
  const W = cols * s; const H = rows * s; const L = layouts.length;
  for (const lay of layouts) {
    if (lay.length !== rows || lay.some((r) => r.length !== cols)) throw new Error(`scenario ${spec.id}: ragged layout`);
  }
  const rng = createRng(spec.seed || 1);
  const b = createBuilder({ width: W, height: H, levels: L, rng });
  const obstacle = Array.from({ length: L }, () => new Uint8Array(W * H));
  layouts.forEach((lay, z) => {
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const { t, obstacle: ob } = cellTerrain(lay[cy][cx]);
        for (let y = cy * s; y < cy * s + s; y++) {
          for (let x = cx * s; x < cx * s + s; x++) {
            setTerrain(b, x, y, z, t);
            if (ob) { obstacle[z][y * W + x] = 1; b.border[z][y * W + x] = 1; }
          }
        }
      }
    }
  });
  // regions = connected open land (8-neighbourhood); every water body is one region too
  let next = 0;
  for (let z = 0; z < L; z++) {
    for (let i = 0; i < W * H; i++) {
      if (b.zone[z][i] !== -1) continue;
      const x0 = i % W; const y0 = (i / W) | 0;
      const ter = getTerrain(b.map.tiles[z][y0][x0].t);
      if (!ter.passable) continue;
      const water = ter.water;
      if (!water && obstacle[z][i]) continue;
      const id = next++;
      const st = [i]; b.zone[z][i] = id;
      while (st.length) {
        const c = st.pop(); const x = c % W; const y = (c / W) | 0;
        for (const [dx, dy] of NEIGHBOURS8) {
          const ax = x + dx; const ay = y + dy;
          if (!inside(b, ax, ay)) continue;
          const j = ay * W + ax;
          if (b.zone[z][j] !== -1 || obstacle[z][j]) continue;
          const tj = getTerrain(b.map.tiles[z][ay][ax].t);
          if (!tj.passable || tj.water !== water) continue;
          b.zone[z][j] = id; st.push(j);
        }
      }
    }
  }

  const center = (cell, z = 0) => ({ x: cell[0] * s + Math.floor(s / 2), y: cell[1] * s + Math.floor(s / 2), z: cell[2] ?? z });
  const spiral = (pos, radius, filter = () => true) => {
    const out = [];
    for (let y = pos.y - radius; y <= pos.y + radius; y++) {
      for (let x = pos.x - radius; x <= pos.x + radius; x++) {
        if (!inside(b, x, y)) continue;
        const p = { x, y, z: pos.z };
        if (filter(p)) out.push({ ...p, d: Math.hypot(x - pos.x, y - pos.y) });
      }
    }
    return out.sort((p, q) => p.d - q.d);
  };
  const groups = {}; // region -> [[tile idx...]]
  const addGroup = (z, tiles) => {
    if (!tiles.length) return;
    const key = `${z}:${b.zone[z][tiles[0]]}`;
    (groups[key] ??= []).push(tiles);
  };

  // towns
  const townPos = [];
  for (const t of spec.towns || []) {
    const want = center(t.cell);
    const c = spiral(want, s * 2 + 2).find((p) => canPlaceTown(b, p, b.zone[p.z][idxOf(b, p.x, p.y)]));
    if (!c) throw new Error(`scenario ${spec.id}: no room for town at ${t.cell}`);
    const entry = { faction: t.faction || 'random', ownerSlot: t.owner ?? null };
    if (t.name) entry.name = t.name;
    if (t.buildings) entry.buildings = t.buildings.slice();
    placeTown(b, { x: c.x, y: c.y, z: c.z }, entry);
    townPos.push({ x: c.x, y: c.y, z: c.z });
    const fc = [];
    for (const dx of [-1, 0, 1]) { const j = idxOf(b, c.x + dx, c.y + 1); if (b.resv[c.z][j]) fc.push(j); }
    addGroup(c.z, fc);
  }
  // heroes (stand on their town or on a free tile near the cell)
  for (const h of spec.heroes || []) {
    let pos;
    if (h.town != null) pos = { ...townPos[h.town] };
    else {
      const want = center(h.cell);
      const c = spiral(want, s * 2, (p) => isLand(b, p.x, p.y, p.z) && b.occ[p.z][idxOf(b, p.x, p.y)] === OCC_FREE && !obstacle[p.z][idxOf(b, p.x, p.y)])[0];
      if (!c) throw new Error(`scenario ${spec.id}: no room for hero at ${h.cell}`);
      pos = { x: c.x, y: c.y, z: c.z };
      reserve(b, pos.x, pos.y, pos.z);
      addGroup(pos.z, [idxOf(b, pos.x, pos.y)]);
    }
    b.heroes.push({ ownerSlot: h.owner, pos, defId: h.defId || 'random' });
    if (h.defId) b.gs.heroes[`start_${b.heroes.length}`] = { id: `start_${b.heroes.length}`, defId: h.defId };
  }
  // roads (polylines of cells / 'town:i' waypoints)
  const waypoint = (w) => {
    if (typeof w === 'string' && w.startsWith('town:')) { const p = townPos[Number(w.slice(5))]; return { x: p.x, y: p.y + 1, z: p.z }; }
    return center(w);
  };
  for (const road of spec.roads || []) {
    const pts = road.points.map(waypoint);
    const z = pts[0].z;
    const tiles = [];
    for (let k = 1; k < pts.length; k++) {
      const a = idxOf(b, pts[k - 1].x, pts[k - 1].y); const dst = idxOf(b, pts[k].x, pts[k].y);
      const path = shortestPath(b, [a], {
        pass: (j) => isLand(b, j % W, (j / W) | 0, z) && !obstacle[z][j] && (b.occ[z][j] === OCC_FREE || b.resv[z][j]),
        target: (j) => j === dst,
      });
      if (!path) throw new Error(`scenario ${spec.id}: road ${JSON.stringify(road.points)} is blocked at segment ${k}`);
      tiles.push(...path);
    }
    for (const j of tiles) { reserve(b, j % W, (j / W) | 0, z); b.map.tiles[z][(j / W) | 0][j % W].road = road.type || 2; }
    // a road may cross several regions only if they are connected - split by region
    const byRegion = {};
    for (const j of tiles) (byRegion[b.zone[z][j]] ??= []).push(j);
    for (const g of Object.values(byRegion)) addGroup(z, g);
  }
  // join every region's groups into one network
  for (const [key, list] of Object.entries(groups)) {
    const [z, zn] = key.split(':').map(Number);
    const inTree = new Set(list[0]);
    for (const g of list.slice(1)) {
      if (g.some((j) => inTree.has(j))) { g.forEach((j) => inTree.add(j)); continue; }
      const path = shortestPath(b, g, {
        pass: (j) => b.zone[z][j] === zn && (b.resv[z][j] || b.occ[z][j] === OCC_FREE),
        target: (j) => inTree.has(j),
      });
      if (!path) throw new Error(`scenario ${spec.id}: region ${key} is split`);
      for (const j of path) { reserve(b, j % W, (j / W) | 0, z); inTree.add(j); }
      g.forEach((j) => inTree.add(j));
    }
  }

  // objects
  const named = {};
  const factionsNear = (pos) => {
    const near = (spec.towns || []).map((t, k) => ({ f: t.faction, d: Math.hypot(townPos[k].x - pos.x, townPos[k].y - pos.y) })).filter((t) => t.f && t.f !== 'random');
    near.sort((p, q) => p.d - q.d);
    return near.slice(0, 1).map((t) => t.f);
  };
  const guard = (obj, g) => {
    if (!g || !obj) return;
    const acc = accessOf(obj.pos);
    const data = typeof g === 'number'
      ? pickGuard(rng, Math.max(guardStrength(g, spec.monsters || 'normal', 'normal', false), Math.round(g * 0.4)), factionsNear(obj.pos))
      : { ...g };
    if (typeof g !== 'number' && g.value) Object.assign(data, pickGuard(rng, g.value, g.factions || factionsNear(obj.pos)));
    delete data.value; delete data.factions;
    const m = placeMonster(b, acc, { ...data, ...(g.disposition ? { disposition: g.disposition } : {}) });
    if (!m) throw new Error(`scenario ${spec.id}: cannot guard ${obj.defId} at ${obj.pos.x},${obj.pos.y}`);
  };
  const putObject = (o) => {
    const def = getMapObject(o.def);
    const want = center(o.cell);
    const fx = def.effect.type;
    let data = o.data ? JSON.parse(JSON.stringify(o.data)) : {};
    if (fx === 'spell_scroll' && o.spellLevel && !data.spellId) data.spellId = rollSpell(b.gs, { level: o.spellLevel });
    const params = { data, ...(o.owner !== undefined ? { owner: o.owner } : {}) };
    let obj = null;
    if (fx === 'grail') {
      const c = spiral(want, s * 2, (p) => {
        const i = idxOf(b, p.x, p.y);
        const t = b.map.tiles[p.z][p.y][p.x];
        return isLand(b, p.x, p.y, p.z) && !obstacle[p.z][i] && b.occ[p.z][i] === OCC_FREE && !b.resv[p.z][i] && !t.road && getTerrain(t.t).diggable;
      })[0];
      if (c) obj = place(b, 'grail', c, {}, OCC_KEEP);
    } else if (fx === 'monster') {
      // a stack standing on the network (road block / patrol)
      const c = spiral(want, s * 3, (p) => b.resv[p.z][idxOf(b, p.x, p.y)] && b.occ[p.z][idxOf(b, p.x, p.y)] === OCC_FREE && !b.map.tiles[p.z][p.y][p.x].obj)[0];
      if (c) obj = placeMonster(b, c, data);
      if (obj && o.seal) {
        // seal the pass: free tiles of the monster's layout cell outside its 3x3 guard zone become
        // obstacles, so nobody slips past a stack standing in a gap wider than 3 tiles
        const x0 = Math.floor(c.x / s) * s; const y0 = Math.floor(c.y / s) * s;
        for (let y = y0; y < y0 + s; y++) {
          for (let x = x0; x < x0 + s; x++) {
            if (Math.abs(x - c.x) <= 1 && Math.abs(y - c.y) <= 1) continue;
            const i = idxOf(b, x, y);
            if (!isLand(b, x, y, c.z) || b.occ[c.z][i] !== OCC_FREE || b.resv[c.z][i]) continue;
            obstacle[c.z][i] = 1; b.border[c.z][i] = 1;
          }
        }
      }
    } else if (fx === 'boat') {
      // a boat moored next to a shore tile that is joined to the island's network
      for (const c of spiral(want, s * 3, (p) => canPlace(b, def, p, { needAccess: false, spacing: 0 }))) {
        const shore = NEIGHBOURS8.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy, z: c.z }))
          .filter((p) => isLand(b, p.x, p.y, p.z) && !obstacle[p.z][idxOf(b, p.x, p.y)] && (b.resv[p.z][idxOf(b, p.x, p.y)] || b.occ[p.z][idxOf(b, p.x, p.y)] === OCC_FREE));
        if (shore.some((p) => b.resv[p.z][idxOf(b, p.x, p.y)]) || shore.some((p) => connect(b, p, { zone: b.zone[p.z][idxOf(b, p.x, p.y)], maxCost: 60 }))) {
          obj = place(b, def.id, c, params);
          break;
        }
      }
    } else if (def.terrains.length === 1 && def.terrains[0] === 'water') {
      const c = spiral(want, s * 3, (p) => canPlace(b, def, p, { needAccess: false, spacing: 1 }))[0];
      if (c) obj = place(b, def.id, c, params);
    } else {
      const cands = spiral(want, o.radius ?? s * 3, (p) => {
        if (def.coastal) {
          let wet = false;
          for (let y = p.y - 2; y <= p.y + 1 && !wet; y++) for (let x = p.x - 2; x <= p.x + 2; x++) if (isWater(b, x, y, p.z) && b.occ[p.z][idxOf(b, x, y)] === OCC_FREE) { wet = true; break; }
          if (!wet) return false;
        }
        return true;
      });
      for (const c of cands) {
        obj = placeConnected(b, def.id, c, params, { zone: b.zone[c.z][idxOf(b, c.x, c.y)], maxCost: 200, anyTerrain: true });
        if (obj) break;
      }
    }
    if (!obj) throw new Error(`scenario ${spec.id}: cannot place ${o.def} near cell ${o.cell}`);
    if (o.name) named[o.name] = obj;
    if (o.guard) guard(obj, o.guard);
    return obj;
  };
  for (const o of spec.objects || []) putObject(o);
  // gate pairs: { def:'subterranean_gate', name, pairWith }
  for (const o of spec.objects || []) {
    if (o.pairWith) { named[o.name].data.pair = named[o.pairWith].id; named[o.pairWith].data.pair = named[o.name].id; }
  }
  // scattered treasure in a cell rectangle
  for (const sc of spec.scatter || []) {
    const z = sc.z || 0;
    const rects = sc.cells ? sc.cells.map(([cx, cy]) => [cx, cy, cx, cy]) : [sc.area];
    const tiles = [];
    for (const [x0, y0, x1, y1] of rects) {
      for (let y = y0 * s; y < (y1 + 1) * s; y++) for (let x = x0 * s; x < (x1 + 1) * s; x++) {
        if (!inside(b, x, y)) continue;
        const i = idxOf(b, x, y);
        if (b.zone[z][i] >= 0 && !obstacle[z][i] && isLand(b, x, y, z)) tiles.push(i);
      }
    }
    const band = typeof sc.band === 'string' ? BANDS[sc.band][sc.tier || 0] : sc.band;
    for (let k = 0; k < sc.count; k++) {
      const pile = sc.def ? [{ defId: sc.def, value: getMapObject(sc.def).value }] : composePile(rng, band, POOL.land, sc.factions || [], {}, (id) => getMapObject(id).size).slice(0, 1);
      if (!pile.length) continue;
      const e = pile[0];
      const data = e.data ? JSON.parse(JSON.stringify(e.data)) : {};
      if (e.pandora) data.faction = (sc.factions && sc.factions[0]) || 'castle';
      if (e.spellLevel) data.spellId = rollSpell(b.gs, { level: e.spellLevel });
      let obj = null;
      for (const i of shuffle(rng, tiles.slice()).slice(0, 250)) {
        const p = { x: i % W, y: (i / W) | 0, z };
        const a = accessOf(p);
        if (inside(b, a.x, a.y) && b.resv[z][idxOf(b, a.x, a.y)]) continue; // never guard a road
        obj = placeConnected(b, e.defId, p, { data }, { zone: b.zone[z][i], maxCost: 40 });
        if (obj) break;
      }
      if (!obj) continue;
      if (!e.ownGuards && sc.guard !== false) {
        const st = guardStrength(e.value, spec.monsters || 'normal', sc.monsters || 'normal', false);
        if (st >= 1500) {
          const g = pickGuard(rng, st, sc.factions || []);
          placeMonster(b, accessOf(obj.pos), g);
        }
      }
    }
  }

  // obstacles: cover obstacle cells, light decor elsewhere
  for (let z = 0; z < L; z++) {
    for (let i = 0; i < W * H; i++) {
      if (!obstacle[z][i] || b.occ[z][i] !== OCC_FREE || b.resv[z][i]) continue;
      const x = i % W; const y = (i / W) | 0;
      if (!coverWithDecor(b, x, y, z, (j) => obstacle[z][j] && b.occ[z][j] === OCC_FREE && !b.resv[z][j], rand(rng) < 0.7)) b.map.tiles[z][y][x].blocked = true;
    }
    const noise = makeNoise(rng, W, H, 4);
    const density = spec.decor ?? 0.12;
    for (let i = 0; i < W * H; i++) {
      if (obstacle[z][i] || b.resv[z][i] || b.occ[z][i] !== OCC_FREE || b.zone[z][i] < 0) continue;
      const x = i % W; const y = (i / W) | 0;
      if (!isLand(b, x, y, z)) continue;
      let near = false;
      for (const [dx, dy] of NEIGHBOURS8) if (inside(b, x + dx, y + dy) && b.resv[z][idxOf(b, x + dx, y + dy)]) near = true;
      const p = (noise[i] > 0.62 ? density * 4 : density * 0.4) * (near ? 0.2 : 1);
      if (rand(rng) >= p) continue;
      const zn = b.zone[z][i];
      coverWithDecor(b, x, y, z, (j) => !obstacle[z][j] && b.zone[z][j] === zn && b.occ[z][j] === OCC_FREE && !b.resv[z][j], false);
    }
  }
  for (const r of spec.rivers || []) {
    const pts = r.map((c) => center(c));
    for (let k = 1; k < pts.length; k++) {
      const z = pts[0].z;
      const path = shortestPath(b, [idxOf(b, pts[k - 1].x, pts[k - 1].y)], {
        pass: (j) => isLand(b, j % W, (j / W) | 0, z) && !b.map.tiles[z][(j / W) | 0][j % W].obj && !b.map.tiles[z][(j / W) | 0][j % W].blocked
          && (b.occ[z][j] === OCC_FREE || b.resv[z][j]),
        target: (j) => j === idxOf(b, pts[k].x, pts[k].y),
      });
      if (path) for (const j of path) b.map.tiles[z][(j / W) | 0][j % W].river = 1;
    }
  }

  const meta = {
    name: spec.name, description: spec.description, size: spec.size, width: W, height: H, levels: L,
    playerSlots: spec.players, scenario: spec.id, difficulty: spec.difficulty, seed: spec.seed || 1,
    victory: spec.victory || 'standard', loss: spec.loss || 'standard',
    victoryText: spec.victoryText || null, lossText: spec.lossText || null, players: spec.playerInfo || null,
  };
  // map-wide timed events (blueprintExtras.js applyTimedEvents) travel with the blueprint
  const extra = spec.events ? { events: JSON.parse(JSON.stringify(spec.events)) } : {};
  return toBlueprint(b, meta, { victory: spec.victory || 'standard', loss: spec.loss || 'standard', ...extra });
}

export { pick, weightedPick };
