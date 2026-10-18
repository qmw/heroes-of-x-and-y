// Mapping of game ids to the project's own generated art (assets/generated/, made with OpenAI image
// generation via Codex CLI; docs/mechanics/generated-art.md). Pure data + resolvers; the painters
// live in packs/index.js. Files are `generated/<kind>/<key>.png` relative to assets/.
//
// The tables list every picture the pack is meant to have; only files present in the manifest are
// used (assets that are still to be generated keep the procedural art). Sets that must look
// coherent switch on per faction only when complete (`completeFactions`): a town screen (backdrop +
// every building), the 4 map-town levels, the 12 siege pieces.

import { MAP_OBJECTS, MAP_OBJECT_BY_ID } from '../../data/mapObjects.js';
import { BUILDINGS, BUILDING_BY_ID } from '../../data/buildings.js';

export const GENERATED_PACK = 'generated';
export const GENERATED_KINDS = new Set(['object', 'building', 'town', 'artifact', 'unit', 'hero', 'siege']);
export const GEN_FACTIONS = ['castle', 'rampart', 'tower', 'inferno', 'necropolis', 'dungeon', 'stronghold', 'fortress', 'conflux', 'cove', 'factory'];
export const TOWN_LEVELS = ['village', 'fort', 'citadel', 'castle'];
/** Ids whose generated picture was rejected / not produced (they keep the procedural art). */
export const GENERATED_OMIT = new Set([]);

const G = (kind, key) => `${GENERATED_PACK}/${kind}/${key}.png`;

/** Flaggable map objects get the player-colour flag drawn over the picture (same rule as objects.js). */
const FLAG_EFFECTS = ['mine', 'dwelling', 'shipyard', 'lighthouse', 'garrison', 'town'];
export function isFlaggable(def) {
  return Boolean(def) && (['mine', 'dwelling', 'town'].includes(def.category) || FLAG_EFFECTS.includes(def.effect && def.effect.type));
}

/** Footprint fill: small pick-ups sit smaller in their tile than buildings. */
function fillOf(o) {
  const [w, h] = o.size;
  if (w * h === 1 && (o.category === 'resource' || o.category === 'treasure')) return 0.8;
  if (w * h === 1 && o.category === 'decor') return 0.92;
  return 1;
}

/** Map dwelling of a faction -> the town dwelling building (shared art). */
function dwellingBuilding(o) {
  const e = o.effect || {};
  if (!e.faction || e.faction === 'neutral') return null;
  const same = BUILDINGS.find((b) => b.faction === e.faction && b.kind === 'dwelling' && b.name === o.name && !b.dwelling.upgraded);
  if (same) return same.id;
  const byTier = BUILDINGS.find((b) => b.faction === e.faction && b.kind === 'dwelling' && b.dwelling.tier === e.tier && !b.dwelling.upgraded && !b.dwelling.alt);
  return byTier ? byTier.id : null;
}

/** Map objects: id -> { file, fill, flag } (towns are resolved per faction/level instead). */
export const GEN_OBJECTS = (() => {
  const out = {};
  for (const o of MAP_OBJECTS) {
    if (o.id === 'town' || o.id === 'random_town' || o.id === 'event' || /monster/.test(o.id)) continue;
    if (GENERATED_OMIT.has(`object/${o.id}`)) continue;
    const bid = o.category === 'dwelling' ? dwellingBuilding(o) : null;
    const file = bid ? G('building', bid) : G('object', o.id);
    out[o.id] = { file, fill: fillOf(o), flag: isFlaggable(o), shared: Boolean(bid) };
  }
  return out;
})();

export const townObjectFile = (faction, level) => G('object', `town_${faction}_${TOWN_LEVELS.includes(level) ? level : 'village'}`);
export const buildingFile = (buildingId, faction) => {
  const b = BUILDING_BY_ID[buildingId];
  if (!b) return null;
  return !b.faction || b.faction === 'common' ? G('building', `${faction}_${buildingId}`) : G('building', buildingId);
};
export const backdropFile = (faction) => G('town', faction);

/** Artifact icons the other layers lack. */
export const GEN_ARTIFACTS = Object.fromEntries([
  'dragon_wing_tabard', 'spirit_of_oppression', 'hourglass_of_the_evil_hour', 'stoic_watchman',
  'inexhaustible_cart_of_lumber', 'sleepkeeper', 'demons_horseshoe', 'merchants_scales',
].map((id) => [id, { file: G('artifact', id) }]));

/** Still war-machine pictures (side view facing right) used as combat units and artifact icons. */
export const GEN_UNITS = Object.fromEntries(['first_aid_tent', 'ammo_cart', 'arrow_tower'].map((id) => [id, { file: G('unit', id), still: true }]));

/** Hero boat (map figure) per player colour. */
export const BOAT_COLORS = ['red', 'blue', 'tan', 'green', 'orange', 'purple', 'teal', 'pink'];
export const boatFile = (color) => G('hero', `boat_${BOAT_COLORS.includes(color) ? color : 'red'}`);

/** Siege pieces (combat, `obstacle` kind): faction x piece x state; canvas boxes as in combatFx.js. */
export const SIEGE_PIECES = ['wall', 'gate', 'tower', 'keep'];
export const SIEGE_STATES = ['intact', 'damaged', 'destroyed'];
export const SIEGE_BOX = { wall: [48, 96], gate: [64, 96], tower: [56, 110], keep: [90, 120] };
export const siegeFile = (faction, piece, st) => G('siege', `${faction}_${piece}_${SIEGE_STATES.includes(st) ? st : 'intact'}`);

/** Files of the per-faction sets that are only used when complete. */
export function factionSetFiles(set, f) {
  if (set === 'townscreen') {
    const files = [backdropFile(f)];
    for (const b of BUILDINGS) if (!b.faction || b.faction === 'common' || b.faction === f) files.push(buildingFile(b.id, f));
    return files;
  }
  if (set === 'maptown') return TOWN_LEVELS.map((l) => townObjectFile(f, l));
  if (set === 'siege') return SIEGE_PIECES.flatMap((p) => SIEGE_STATES.map((st) => siegeFile(f, p, st)));
  return [];
}

/** Factions whose `set` ('townscreen' | 'maptown' | 'siege') is complete in a file table. */
export function completeFactions(set, files) {
  return new Set(GEN_FACTIONS.filter((f) => factionSetFiles(set, f).every((x) => files[x])));
}

/** The per-faction set a resolved entry belongs to (null = usable on its own). */
export function setOf(kind, ref) {
  if (!ref || !ref.mode) return null;
  if (ref.mode === 'building' || ref.mode === 'backdrop') return 'townscreen';
  if (ref.mode === 'siege') return 'siege';
  if (ref.mode === 'object' && ref.town) return 'maptown';
  return null;
}

/** Every generated file the enabled groups reference. */
export function generatedFiles(kinds = GENERATED_KINDS) {
  const files = new Set();
  if (kinds.has('object')) for (const e of Object.values(GEN_OBJECTS)) if (!e.shared || kinds.has('building')) files.add(e.file);
  if (kinds.has('town')) for (const f of GEN_FACTIONS) {
    for (const l of TOWN_LEVELS) files.add(townObjectFile(f, l));
    files.add(backdropFile(f));
  }
  if (kinds.has('building')) for (const b of BUILDINGS) {
    for (const f of !b.faction || b.faction === 'common' ? GEN_FACTIONS : [b.faction]) files.add(buildingFile(b.id, f));
  }
  if (kinds.has('artifact')) for (const e of Object.values(GEN_ARTIFACTS)) files.add(e.file);
  if (kinds.has('unit')) for (const e of Object.values(GEN_UNITS)) files.add(e.file);
  if (kinds.has('hero')) for (const c of BOAT_COLORS) files.add(boatFile(c));
  if (kinds.has('siege')) for (const f of GEN_FACTIONS) for (const p of SIEGE_PIECES) for (const st of SIEGE_STATES) files.add(siegeFile(f, p, st));
  return [...files].sort();
}

const pcName = (c) => (typeof c === 'number' ? BOAT_COLORS[c] : c);

/**
 * (kind, id, opts) -> generated mapping entry or null.
 * object: { mode: 'object', file, fill, flag, def }   building: { mode: 'building', file, faction }
 * town: { mode: 'backdrop', file }   creature: { mode: 'unit', file }   artifact: { file } (icon)
 * hero (variant 'boat'): { mode: 'boat', file }   obstacle (siege piece): { mode: 'siege', file, box }
 */
export function resolveGenerated(kind, id, opts = {}) {
  const o = opts || {};
  switch (kind) {
    case 'object': {
      if (id === 'town') {
        if (!GENERATED_KINDS.has('town') || !GEN_FACTIONS.includes(o.variant)) return null;
        return { mode: 'object', file: townObjectFile(o.variant, o.state), fill: 1, flag: true, town: true, faction: o.variant, def: MAP_OBJECT_BY_ID.town };
      }
      const e = GENERATED_KINDS.has('object') && GEN_OBJECTS[id];
      if (!e || (e.shared && !GENERATED_KINDS.has('building'))) return null;
      return { mode: 'object', ...e, def: MAP_OBJECT_BY_ID[id] };
    }
    case 'building': {
      if (!GENERATED_KINDS.has('building')) return null;
      const b = BUILDING_BY_ID[id];
      if (!b) return null;
      const f = b.faction && b.faction !== 'common' ? b.faction : GEN_FACTIONS.includes(o.variant) ? o.variant : 'castle';
      return { mode: 'building', file: buildingFile(id, f), faction: f };
    }
    case 'town':
      return GENERATED_KINDS.has('town') && GEN_FACTIONS.includes(id) ? { mode: 'backdrop', file: backdropFile(id), faction: id } : null;
    case 'creature':
      return GENERATED_KINDS.has('unit') && GEN_UNITS[id] ? { mode: 'unit', ...GEN_UNITS[id] } : null;
    case 'artifact':
      if (GENERATED_KINDS.has('artifact') && GEN_ARTIFACTS[id]) return GEN_ARTIFACTS[id];
      if (GENERATED_KINDS.has('unit') && GEN_UNITS[id]) return { file: GEN_UNITS[id].file };
      return null;
    case 'obstacle':
      if (!GENERATED_KINDS.has('siege') || !SIEGE_PIECES.includes(id)) return null;
      {
        const f = GEN_FACTIONS.includes(o.variant) ? o.variant : 'castle';
        return { mode: 'siege', file: siegeFile(f, id, o.state), box: SIEGE_BOX[id], faction: f };
      }
    case 'hero':
      return GENERATED_KINDS.has('hero') && o.variant === 'boat' ? { mode: 'boat', file: boatFile(pcName(o.playerColor)) } : null;
    default:
      return null;
  }
}
