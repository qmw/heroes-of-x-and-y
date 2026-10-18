// Adventure screen: pure helpers (no DOM). Everything here reads the GameState and never mutates it.
// Spec: docs/mechanics/ui-adventure.md.
import { pluralize } from '../../../core/plural.js';
import { MAP_OBJECT_BY_ID, monsterSizeLabel } from '../../../data/mapObjects.js';
import { TERRAIN_BY_ID, ROAD_BY_INDEX, MAGIC_TERRAIN_BY_ID } from '../../../data/terrain.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { HERO_BY_ID } from '../../../data/heroes.js';
import { HERO_CLASS_BY_ID } from '../../../data/heroClasses.js';
import { FACTION_BY_ID } from '../../../data/factions.js';
import { RESOURCES } from '../../../core/constants.js';

export const CHUNK = 16;
export const TILE_SIZES = [32, 48];
/** Neighbour order of every mask (same as gfx DIRS8): N, E, S, W, NE, SE, SW, NW. */
export const DIRS8 = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const humanizeId = (id) => String(id ?? '').split('_').filter(Boolean).map(cap).join(' ');

// ---- names -----------------------------------------------------------------------------------

export function objectDef(defId) {
  return MAP_OBJECT_BY_ID[defId] || { id: defId, name: humanizeId(defId), size: [1, 1], category: 'special', effect: { type: 'none' }, revisit: 'none', interact: 'none', color: '#a09a8a', blocking: true };
}

export function creatureName(id, count = 2) {
  const c = CREATURE_BY_ID[id];
  const name = c ? c.name : humanizeId(id);
  return count === 1 ? name : pluralize(name);
}

export { pluralize };

/** "A pack of Pikemen" style label for a stack shown without its exact count. */
export function sizeLabelText(creatureId, count, { article = true } = {}) {
  const lbl = monsterSizeLabel(Math.max(1, count || 1));
  const words = { few: 'a few', several: 'several', pack: 'a pack of', lots: 'lots of', horde: 'a horde of', throng: 'a throng of', swarm: 'a swarm of', zounds: 'zounds of', legion: 'a legion of' };
  const lead = article ? words[lbl.id] || lbl.name : lbl.name;
  return cap(`${lead} ${creatureName(creatureId, 2)}`);
}

export function playerOf(state, id) {
  return id == null ? null : (state.players || []).find((p) => p.id === id) || null;
}
export function playerName(state, id) {
  const p = playerOf(state, id);
  return p ? cap(p.color || p.name) : 'Neutral';
}
export const currentPlayer = (state) => (state && state.players ? state.players[state.currentPlayer] : null);

export function heroDisplayName(hero) {
  if (!hero) return '';
  return hero.name || (HERO_BY_ID[hero.defId] && HERO_BY_ID[hero.defId].name) || humanizeId(hero.defId);
}
export function heroClassName(hero) {
  const c = hero && HERO_CLASS_BY_ID[hero.classId];
  return c ? c.name : '';
}
export function factionName(id) {
  return (FACTION_BY_ID[id] && FACTION_BY_ID[id].name) || humanizeId(id);
}

export function fortState(town) {
  const b = town.buildings || [];
  if (b.includes('castle')) return 'castle';
  if (b.includes('citadel')) return 'citadel';
  if (b.includes('fort')) return 'fort';
  return 'village';
}

// ---- tiles, fog, objects -----------------------------------------------------------------------

export function tileAt(state, x, y, z = 0) {
  const m = state.map;
  if (z < 0 || z >= m.levels || x < 0 || y < 0 || x >= m.width || y >= m.height) return null;
  return m.tiles[z][y][x];
}

/** Explored for the player (read-only: never creates the arrays). Null player = everything. */
export function explored(state, playerId, x, y, z = 0) {
  if (playerId == null) return true;
  const p = playerOf(state, playerId);
  const arr = p && p.explored && p.explored[z];
  if (!arr) return false;
  return !!arr[y * state.map.width + x];
}

/** Shroud fringe mask of an explored tile: bit i set when DIRS8[i] neighbour is unexplored (in bounds). */
export function fogMask(state, playerId, x, y, z = 0) {
  let m = 0;
  for (let i = 0; i < 8; i++) {
    const nx = x + DIRS8[i][0];
    const ny = y + DIRS8[i][1];
    if (nx < 0 || ny < 0 || nx >= state.map.width || ny >= state.map.height) continue;
    if (!explored(state, playerId, nx, ny, z)) m |= 1 << i;
  }
  return m;
}

/** Road mask (8 neighbours, DIRS8 order) and river mask (4 bits N, E, S, W) of a tile. */
export function roadMask(state, x, y, z) {
  let m = 0;
  for (let i = 0; i < 8; i++) {
    const t = tileAt(state, x + DIRS8[i][0], y + DIRS8[i][1], z);
    if (t && t.road) m |= 1 << i;
  }
  return m;
}
export function riverMask(state, x, y, z) {
  let m = 0;
  for (let i = 0; i < 4; i++) {
    const t = tileAt(state, x + DIRS8[i][0], y + DIRS8[i][1], z);
    if (t && t.river) m |= 1 << i;
  }
  return m;
}
export function neighbourTerrains(state, x, y, z) {
  return DIRS8.map(([dx, dy]) => { const t = tileAt(state, x + dx, y + dy, z); return t ? t.t : null; });
}

/** Footprint tiles of an object (entrance = obj.pos; see adventure-objects.md §2.1). */
export function footprint(obj) {
  const def = objectDef(obj.defId);
  const [w, h] = def.size || [1, 1];
  const x0 = obj.pos.x - Math.floor(w / 2);
  const out = [];
  for (let y = obj.pos.y - h + 1; y <= obj.pos.y; y++) for (let x = x0; x < x0 + w; x++) out.push({ x, y, z: obj.pos.z || 0 });
  return out;
}

/** Objects that are never drawn / clicked: the hidden grail marker, boats carried by a hero. */
export function isHiddenObject(obj) {
  if (obj.defId === 'grail') return true;
  if (obj.defId === 'boat' && obj.data && obj.data.heroId) return true;
  return false;
}

/**
 * Spatial indexes over the map objects, rebuilt after every state change:
 * `at` = "x,y,z" -> objectId for every footprint tile (entrance wins), `chunks` = "z:cx:cy" -> [obj].
 */
export function buildObjectIndex(state) {
  const at = new Map();
  const chunks = new Map();
  for (const obj of Object.values(state.map.objects || {})) {
    if (isHiddenObject(obj)) continue;
    const z = obj.pos.z || 0;
    for (const p of footprint(obj)) {
      const k = `${p.x},${p.y},${z}`;
      if (!at.has(k) || (p.x === obj.pos.x && p.y === obj.pos.y)) at.set(k, obj.id);
    }
    const ck = `${z}:${Math.floor(obj.pos.x / CHUNK)}:${Math.floor(obj.pos.y / CHUNK)}`;
    if (!chunks.has(ck)) chunks.set(ck, []);
    chunks.get(ck).push(obj);
  }
  return { at, chunks };
}

export function heroOnTile(state, x, y, z) {
  for (const h of Object.values(state.heroes || {})) {
    if (!h.garrisoned && h.pos && h.pos.x === x && h.pos.y === y && (h.pos.z || 0) === z) return h;
  }
  return null;
}

export function townOfObject(state, obj) {
  return obj && obj.data && obj.data.townId ? state.towns[obj.data.townId] || null : null;
}

// ---- hover / right-click texts -------------------------------------------------------------------

function visitedFor(state, obj, hero, player) {
  const def = objectDef(obj.defId);
  const week = Math.floor(((state.turn || 1) - 1) / 7) + 1;
  switch (def.revisit) {
    case 'once': return !!(obj.data && obj.data.visited);
    case 'per_hero': return hero ? !!(hero.visited && hero.visited[obj.id]) : null;
    case 'per_hero_daily': return hero ? (hero.visited && hero.visited[obj.id]) === state.turn : null;
    case 'per_hero_weekly': return hero ? (hero.visited && hero.visited[obj.id]) === week : null;
    case 'per_player': return player ? !!(player.visited && player.visited[obj.id]) : null;
    case 'weekly': return (obj.data && obj.data.visitedWeek) === week;
    default: return null;
  }
}

/** Short status-bar text for a tile, e.g. "Gold Mine (owned by Red)". */
export function hoverText(state, viewerId, x, y, z, index = null, heroId = null) {
  const tile = tileAt(state, x, y, z);
  if (!tile) return '';
  if (!explored(state, viewerId, x, y, z)) return 'Unexplored';
  const hero = heroOnTile(state, x, y, z);
  if (hero) {
    const own = hero.owner === viewerId;
    return `${heroDisplayName(hero)}${own ? '' : ` (${playerName(state, hero.owner)})`}`;
  }
  const objId = index ? index.at.get(`${x},${y},${z}`) : tile.obj;
  const obj = objId ? state.map.objects[objId] : null;
  if (obj) return objectTitle(state, obj, viewerId, heroId);
  return terrainTitle(tile);
}

export function terrainTitle(tile) {
  const parts = [(TERRAIN_BY_ID[tile.t] && TERRAIN_BY_ID[tile.t].name) || humanizeId(tile.t)];
  if (tile.road && ROAD_BY_INDEX[tile.road]) parts.push(ROAD_BY_INDEX[tile.road].name);
  if (tile.river) parts.push('River');
  if (tile.overlay && MAGIC_TERRAIN_BY_ID[tile.overlay]) parts.push(MAGIC_TERRAIN_BY_ID[tile.overlay].name);
  return parts.join(', ');
}

export function objectTitle(state, obj, viewerId, heroId = null) {
  const def = objectDef(obj.defId);
  if (obj.defId === 'monster') return sizeLabelText(obj.data.creatureId, obj.data.count);
  const town = townOfObject(state, obj);
  if (town) return `${town.name}${town.owner != null ? ` (${playerName(state, town.owner)})` : ' (neutral)'}`;
  let name = def.name;
  if (def.effect && def.effect.type === 'mine' && obj.data && obj.data.resource && def.id === 'abandoned_mine') name = `${def.name} (${obj.data.resource})`;
  const bits = [];
  if (obj.owner != null) bits.push(`owned by ${playerName(state, obj.owner)}`);
  const hero = heroId ? state.heroes[heroId] : null;
  const v = visitedFor(state, obj, hero, playerOf(state, viewerId));
  if (v === true) bits.push('visited');
  else if (v === false && def.revisit !== 'weekly') bits.push('not visited');
  return bits.length ? `${name} (${bits.join(', ')})` : name;
}

/**
 * Structured right-click info (rendered by dialogs.js `infoNode`).
 * @returns {{kind, title, lines: string[], army?: [{creatureId, count|null, label}], heroId?, townId?, owner?}}
 */
export function describeTile(state, viewerId, x, y, z, { index = null, heroId = null, thievesLevel = 0, displayedArmy, visions = null, primary = null } = {}) {
  const tile = tileAt(state, x, y, z);
  if (!tile) return null;
  if (!explored(state, viewerId, x, y, z)) return { kind: 'unexplored', title: 'Unexplored territory', lines: [] };
  const hero = heroOnTile(state, x, y, z);
  if (hero) return describeHero(state, viewerId, hero, { thievesLevel, displayedArmy, primary });
  const objId = index ? index.at.get(`${x},${y},${z}`) : tile.obj;
  const obj = objId ? state.map.objects[objId] : null;
  if (obj) {
    const town = townOfObject(state, obj);
    if (town) return describeTown(state, viewerId, town);
    return describeObject(state, viewerId, obj, { heroId, visions });
  }
  return { kind: 'terrain', title: terrainTitle(tile), lines: terrainLines(tile) };
}

function terrainLines(tile) {
  const t = TERRAIN_BY_ID[tile.t];
  const out = [];
  if (t) out.push(`Movement cost ${t.moveCost}%${t.water ? ' (water)' : ''}${t.passable ? '' : ' - impassable'}`);
  if (tile.overlay && MAGIC_TERRAIN_BY_ID[tile.overlay]) out.push(MAGIC_TERRAIN_BY_ID[tile.overlay].description || '');
  return out.filter(Boolean);
}

export function describeObject(state, viewerId, obj, { heroId = null, visions = null } = {}) {
  const def = objectDef(obj.defId);
  const lines = [];
  const out = { kind: 'object', title: objectTitle(state, obj, viewerId, heroId), lines, objectId: obj.id, defId: obj.defId, owner: obj.owner ?? null };
  if (obj.defId === 'monster') {
    out.kind = 'monster';
    const v = visions && visions.monsters ? visions.monsters.find((m) => m.objectId === obj.id) : null;
    out.army = [{ creatureId: obj.data.creatureId, count: v ? v.count : null, label: v ? `${v.count} ${creatureName(obj.data.creatureId, v.count)}` : sizeLabelText(obj.data.creatureId, obj.data.count) }];
    if (v) lines.push(v.outcome === 'join' || v.outcome === 'join_gold' ? 'They would join you.' : v.outcome === 'flee' ? 'They would flee.' : 'They will fight.');
    return out;
  }
  if (def.description) lines.push(def.description);
  const player = playerOf(state, viewerId);
  const info = player && player.visited ? player.visited[`info_${obj.id}`] : null;
  if (info && typeof info === 'object') {
    for (const [k, v] of Object.entries(info)) lines.push(`${humanizeId(k)}: ${Array.isArray(v) ? v.map(humanizeId).join(', ') : humanizeId(String(v))}`);
  }
  const guards = obj.data && (obj.data.guards || (def.effect.type === 'garrison' ? obj.data.army : null));
  if (guards && Array.isArray(guards) && guards.some(Boolean) && !(obj.owner != null && obj.owner === viewerId)) {
    out.army = guards.filter(Boolean).map((s) => ({ creatureId: s.creatureId, count: null, label: sizeLabelText(s.creatureId, s.count) }));
    lines.push('Guarded');
  }
  return out;
}

const FORT_NAMES = { village: 'No fort', fort: 'Fort', citadel: 'Citadel', castle: 'Castle' };

export function describeTown(state, viewerId, town) {
  const own = town.owner != null && town.owner === viewerId;
  const lines = [`${factionName(town.faction)} town`, FORT_NAMES[fortState(town)]];
  lines.push(town.owner != null ? `Owned by ${playerName(state, town.owner)}` : 'Neutral');
  const garrison = (town.garrison || []).filter(Boolean);
  const army = garrison.map((s) => ({ creatureId: s.creatureId, count: own ? s.count : null, label: own ? `${s.count} ${creatureName(s.creatureId, s.count)}` : sizeLabelText(s.creatureId, s.count) }));
  return { kind: 'town', title: town.name, lines, army, townId: town.id, owner: town.owner ?? null };
}

/**
 * Hero popup model. Own/allied heroes: everything. Enemy heroes: name, level, class; army as size
 * labels (through `displayedArmy` = getDisplayedArmy for Disguise; `null` = hidden); Thieves' Guild
 * level >= 1 adds primary skills, >= 2 exact counts.
 */
export function describeHero(state, viewerId, hero, { thievesLevel = 0, displayedArmy, primary = null } = {}) {
  const own = hero.owner === viewerId;
  const lines = [`Level ${hero.level} ${heroClassName(hero)}`.trim()];
  if (!own) lines.push(`${playerName(state, hero.owner)} player`);
  const showStats = own || thievesLevel >= 1;
  const exact = own || thievesLevel >= 2;
  const p = primary || hero.primary || {};
  if (showStats) lines.push(`Attack ${p.attack ?? 0}  Defense ${p.defense ?? 0}  Power ${p.power ?? 0}  Knowledge ${p.knowledge ?? 0}`);
  if (own) lines.push(`Movement ${hero.movePoints}/${hero.maxMovePoints}  Mana ${hero.mana}`);
  const src = own ? hero.army : displayedArmy === undefined ? hero.army : displayedArmy;
  const army = src == null ? null : src.filter(Boolean).map((s) => ({
    creatureId: s.creatureId, count: exact ? s.count : null,
    label: exact ? `${s.count} ${creatureName(s.creatureId, s.count)}` : sizeLabelText(s.creatureId, s.count),
  }));
  if (army == null) lines.push('Army: unknown');
  return { kind: 'hero', title: heroDisplayName(hero), lines, army: army || [], heroId: hero.id, owner: hero.owner, own };
}

// ---- path preview ------------------------------------------------------------------------------

/**
 * Path markers for a `findPath` result: one per step with `{x, y, z, today, dayMarker, last, dir}`.
 * `dayMarker` = day number (1 = tomorrow ...) on the first step that needs a new day.
 */
export function pathMarkers(path) {
  if (!path || !path.steps) return [];
  let prevTurn = 0;
  return path.steps.map((s, i) => {
    const turn = s.turn || 0;
    const next = path.steps[i + 1];
    const m = { x: s.x, y: s.y, z: s.z || 0, turn, today: turn === 0, dayMarker: turn > prevTurn ? turn : null, last: i === path.steps.length - 1, kind: s.kind };
    if (next) m.dir = [Math.sign(next.x - s.x), Math.sign(next.y - s.y)];
    prevTurn = turn;
    return m;
  });
}

/** Where a click on (x,y,z) should send the hero: the entrance of an object footprint, else the tile. */
export function clickDestination(state, index, x, y, z) {
  const objId = index.at.get(`${x},${y},${z}`);
  const obj = objId ? state.map.objects[objId] : null;
  if (obj && !(obj.pos.x === x && obj.pos.y === y)) {
    const def = objectDef(obj.defId);
    if (def.interact !== 'none' && def.effect.type !== 'none') return { x: obj.pos.x, y: obj.pos.y, z: obj.pos.z || 0 };
  }
  return { x, y, z };
}

// ---- lists / turn helpers ----------------------------------------------------------------------

export function playerHeroes(state, playerId) {
  const p = playerOf(state, playerId);
  return p ? p.heroes.map((id) => state.heroes[id]).filter(Boolean) : [];
}
export function playerTowns(state, playerId) {
  const p = playerOf(state, playerId);
  return p ? p.towns.map((id) => state.towns[id]).filter(Boolean) : [];
}

/** Heroes that could still move today (not asleep, not garrisoned, some movement left). */
export function heroesWithMovement(state, playerId, minPoints = 1) {
  return playerHeroes(state, playerId).filter((h) => !h.asleep && !h.garrisoned && (h.movePoints || 0) >= minPoints);
}

/** The next hero to select after `currentId` (cycling), skipping sleepers and exhausted heroes. */
export function nextHeroId(state, playerId, currentId) {
  const all = playerHeroes(state, playerId).filter((h) => !h.garrisoned);
  if (!all.length) return null;
  const start = Math.max(-1, all.findIndex((h) => h.id === currentId));
  for (let i = 1; i <= all.length; i++) {
    const h = all[(start + i) % all.length];
    if (!h.asleep && h.movePoints > 0) return h.id;
  }
  return null;
}

export function humanCount(state) {
  return (state.players || []).filter((p) => p.isHuman && p.alive !== false).length;
}

/** Message for a new week / month (from `state.weekOf`), or null. */
export function weekMessage(weekOf, isMonth) {
  if (!weekOf) return null;
  if (weekOf.kind === 'plague') return 'A plague has struck the land! Creature populations are halved this week.';
  const name = weekOf.name || (weekOf.creatureId ? `${isMonth ? 'Month' : 'Week'} of the ${creatureName(weekOf.creatureId, 1)}` : null);
  if (!name) return null;
  let text = `Astrologers proclaim the ${name}.`;
  if (weekOf.kind === 'week_of' && weekOf.creatureId) text += ` All ${creatureName(weekOf.creatureId, 1)} dwellings grow by +5.`;
  if (weekOf.kind === 'month_of' && weekOf.creatureId) text += ` ${creatureName(weekOf.creatureId, 2)} populations double!`;
  if (weekOf.kind === 'normal') text += ' All dwellings see normal growth.';
  return text;
}

export function dateLabel(date) {
  return date ? `Month ${date.month}, Week ${date.week}, Day ${date.day}` : '';
}

// ---- minimap -----------------------------------------------------------------------------------

const PLAYER_RGB = { red: [200, 50, 42], blue: [47, 95, 208], tan: [184, 154, 106], green: [60, 154, 60], orange: [224, 131, 42], purple: [138, 63, 184], teal: [42, 163, 160], pink: [216, 122, 168] };
const NEUTRAL_RGB = [150, 150, 150];

export function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function playerRgb(state, playerId) {
  const p = playerOf(state, playerId);
  return p ? PLAYER_RGB[p.color] || NEUTRAL_RGB : NEUTRAL_RGB;
}

/**
 * Minimap pixels of one level, 1 px per tile: `Uint8ClampedArray(w*h*4)` RGBA. Terrain colour
 * (blocked tiles darker), owned objects / towns / heroes in player colours, unexplored dark
 * parchment (slate underground) with a faint deterministic grain.
 */
/** Minimap colour of an unexplored tile: dark parchment (surface) / slate (underground), grained. */
export function unexploredRgb(x, y, z = 0) {
  const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  const d = (n % 7) - 3;
  return z > 0 ? [38 + d, 34 + d, 50 + d] : [70 + d, 55 + d, 36 + d];
}

export function minimapPixels(state, viewerId, z, index = null) {
  const { width: w, height: h } = state.map;
  const data = new Uint8ClampedArray(w * h * 4);
  const owned = new Map();
  for (const obj of Object.values(state.map.objects || {})) {
    if ((obj.pos.z || 0) !== z || isHiddenObject(obj)) continue;
    const town = townOfObject(state, obj);
    const owner = town ? town.owner : obj.owner;
    const col = owner != null ? playerRgb(state, owner) : town ? NEUTRAL_RGB : null;
    if (!col) continue;
    for (const p of footprint(obj)) owned.set(p.y * w + p.x, col);
  }
  for (const hero of Object.values(state.heroes || {})) {
    if (hero.garrisoned || (hero.pos.z || 0) !== z || hero.owner == null) continue;
    owned.set(hero.pos.y * w + hero.pos.x, playerRgb(state, hero.owner));
  }
  const rows = state.map.tiles[z];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let rgb;
      if (!explored(state, viewerId, x, y, z)) rgb = unexploredRgb(x, y, z);
      else if (owned.has(i)) rgb = owned.get(i);
      else {
        const t = rows[y][x];
        rgb = hexRgb(TERRAIN_BY_ID[t.t] ? TERRAIN_BY_ID[t.t].color : '#808080');
        if (t.blocked) rgb = rgb.map((c) => Math.floor(c * 0.6));
      }
      data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255;
    }
  }
  return data;
}

// ---- puzzle / quests ---------------------------------------------------------------------------

/** Map window shown by the puzzle: `cols*k x rows*k` tiles around the grail (clamped to the map). */
export function puzzleWindow(state, grailPos, cols, rows, tilesPerPiece = 3) {
  const w = Math.min(state.map.width, cols * tilesPerPiece);
  const h = Math.min(state.map.height, rows * tilesPerPiece);
  const cx = grailPos ? grailPos.x : Math.floor(state.map.width / 2);
  const cy = grailPos ? grailPos.y : Math.floor(state.map.height / 2);
  const x0 = Math.max(0, Math.min(state.map.width - w, cx - Math.floor(w / 2)));
  const y0 = Math.max(0, Math.min(state.map.height - h, cy - Math.floor(h / 2)));
  return { x0, y0, w, h, z: grailPos ? grailPos.z || 0 : 0 };
}

export function questText(q) {
  if (!q) return '';
  switch (q.type) {
    case 'reach_level': return `Reach experience level ${q.level}.`;
    case 'reach_primary': return `Reach ${Object.entries(q.stats || {}).map(([k, v]) => `${v} ${humanizeId(k)}`).join(', ')}.`;
    case 'kill_hero': return 'Defeat a certain hero.';
    case 'kill_monster': return 'Defeat a certain monster.';
    case 'bring_artifacts': return `Bring ${(q.artifactIds || []).map(humanizeId).join(', ')}.`;
    case 'bring_creatures': return `Bring ${(q.creatures || []).map((c) => `${c.count} ${creatureName(c.creatureId, c.count)}`).join(', ')}.`;
    case 'bring_resources': return `Bring ${RESOURCES.filter((r) => q.resources && q.resources[r]).map((r) => `${q.resources[r]} ${r}`).join(', ')}.`;
    case 'be_hero': return `Only ${humanizeId(q.heroDefId)} may pass.`;
    case 'be_player': return 'Only a certain player may pass.';
    default: return humanizeId(q.type);
  }
}

/** Quest log entries of a player: visited, unfinished seer huts and explored quest guards. */
export function questLog(state, playerId) {
  const player = playerOf(state, playerId);
  const out = [];
  for (const obj of Object.values(state.map.objects || {})) {
    const type = objectDef(obj.defId).effect.type;
    const d = obj.data || {};
    if (type === 'seer_hut' && player && player.visited && player.visited[obj.id] && !d.completed && d.quest) {
      out.push({ objectId: obj.id, pos: { ...obj.pos }, title: objectDef(obj.defId).name, text: questText(d.quest), deadline: d.deadline ?? null });
    } else if (type === 'quest_guard' && d.quest && explored(state, playerId, obj.pos.x, obj.pos.y, obj.pos.z || 0)) {
      out.push({ objectId: obj.id, pos: { ...obj.pos }, title: objectDef(obj.defId).name, text: questText(d.quest), deadline: null });
    }
  }
  return out;
}

// ---- events -> messages ------------------------------------------------------------------------

function rewardText(reward) {
  if (!reward) return '';
  const parts = [];
  for (const r of RESOURCES) if (reward.resources && reward.resources[r]) parts.push(`${reward.resources[r]} ${r}`);
  if (reward.exp) parts.push(`${reward.exp} experience`);
  if (reward.mana) parts.push(`${reward.mana} mana`);
  for (const a of reward.artifacts || []) parts.push(humanizeId(typeof a === 'string' ? a : a.id || a.artifactId));
  for (const c of reward.creatures || []) if (c.creatureId) parts.push(`${c.count} ${creatureName(c.creatureId, c.count)}`);
  if (reward.primary) for (const [k, v] of Object.entries(reward.primary)) parts.push(`+${v} ${humanizeId(k)}`);
  return parts.join(', ');
}

const VISIT_TEXT = {
  already_visited: 'You have already visited this place.', already_owned: 'You already own this.',
  nothing: 'Nothing happens.', nothing_left: 'There is nothing left here.', not_ready: 'It is not ready yet.',
  cannot_afford: 'You cannot afford it.', backpack_full: 'Your backpack is full.', no_key: 'You need the key to pass.',
  sold_out: 'Nothing is left for sale.', no_room: 'There is no room.', inert: 'Nothing happens.',
};

/**
 * Turn an engine event into a UI message: `{text, kind: 'info'|'good'|'warn', modal}` or null.
 * `viewerId`: only events of that player (or global ones) are reported.
 */
export function eventMessage(state, e, viewerId) {
  switch (e.type) {
    case 'message': case 'map_event': return e.text ? { text: e.text, kind: 'info', modal: true } : null;
    case 'pickup': { const t = rewardText(e.reward); return t ? { text: `You pick up ${t}.`, kind: 'good' } : null; }
    case 'visit': {
      if (e.result === 'quest' && e.quest) return { text: e.text || questText(e.quest), kind: 'info', modal: true };
      if (e.result === 'quest_completed') return { text: e.text || 'Quest completed!', kind: 'good', modal: true };
      const t = VISIT_TEXT[e.result];
      return t ? { text: `${objectDef(e.defId).name}: ${t}`, kind: 'warn' } : null;
    }
    case 'grail_found': return { text: 'You dig up the Grail!', kind: 'good', modal: true };
    case 'dig': return { text: 'You dig a hole, but find nothing.', kind: 'warn', modal: true };
    case 'town_captured': return { text: `${(state.towns[e.townId] || {}).name || 'The town'} is now yours.`, kind: 'good' };
    case 'objective_failed': return { text: 'Your quarry has fallen to another hand — the objective can no longer be completed.', kind: 'bad' };
    case 'monster_refused': return { text: e.outcome === 'flee' ? 'Rebuffed, the creatures try to slip away.' : 'Rebuffed, the creatures attack!', kind: e.outcome === 'flee' ? 'info' : 'bad' };
    case 'monster_joined': return { text: `${e.count} ${creatureName(e.creatureId, e.count)} join your army.`, kind: 'good' };
    case 'monster_fled': return { text: `The ${creatureName(e.creatureId, 2)} flee.`, kind: 'info' };
    case 'hero_freed': return { text: 'You free a hero from the prison!', kind: 'good', modal: true };
    case 'flagged': return null;
    case 'spell_cast': return e.success === false ? { text: 'The spell failed.', kind: 'warn' } : null;
    case 'town_loss_warning': return e.playerId === viewerId ? { text: `You have lost all your towns! Capture a town within ${e.daysLeft} day${e.daysLeft === 1 ? '' : 's'} or be eliminated.`, kind: 'warn', modal: true } : null;
    case 'timed_event': {
      if (e.playerId !== viewerId) return null;
      const parts = [e.message, rewardText({ resources: e.resources, creatures: e.creatures })].filter(Boolean);
      return parts.length ? { text: parts.join('\n'), kind: 'info', modal: true } : null;
    }
    case 'player_eliminated': return { text: `${playerName(state, e.playerId)} player has been eliminated.`, kind: 'warn', modal: e.playerId === viewerId };
    case 'boat_built': return { text: 'A boat has been built.', kind: 'good' };
    case 'hero_hired': return { text: `${humanizeId(e.heroDefId)} joins your cause.`, kind: 'good' };
    default: return null;
  }
}
