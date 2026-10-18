// Mapping tables: H3online ids -> files of the third-party packs in assets/<pack>/.
// Spec: docs/mechanics/asset-packs.md. Anything not listed here keeps the Duelyst or procedural art.
//
// File references are `<pack-id>/<file>` relative to assets/. Every file named here must exist
// (tests/gfx/packs.test.js) and the manifest tool only keeps what is listed.

import { resolveGenerated, generatedFiles } from './generated.js';

const T = (file, extra = {}) => ({ file: `sbs-tiny-textures/${file}`, ...extra });

/**
 * Adventure-map ground textures (seamless, 128 px). One map tile shows `TEXELS_PER_TILE` texture
 * pixels, so a 128 px texture repeats every 4 tiles and stays continuous across tiles.
 * `tint` recolours (canvas 'color' blend, alpha `tintAlpha`) and `shade` darkens/lightens
 * (multiply / screen with `shadeAlpha`) to bring the photographic textures into the map palette.
 * Water stays procedural (animated, with foam on the shores).
 */
export const TEXELS_PER_TILE = 32;
export const TERRAIN_TEXTURES = {
  grass: T('p1_grass_17.png'),
  dirt: T('p2_dirt_09.png'),
  sand: T('p2_stone_03.png'),
  snow: T('p2_elements_07.png'),
  swamp: T('p3_terrain_15.png'),
  rough: T('p3_stone_04.png'),
  subterranean: T('p2_stone_11.png'),
  lava: T('p2_elements_05.png'),
  rock: T('p2_stone_13.png'),
  highlands: T('p3_terrain_07.png'),
  wasteland: T('p3_stone_01.png'),
};

const S7 = (file, extra = {}) => ({ file: `7soul1-rpg-icons/${file}`, ...extra });
const ID = (file, extra = {}) => ({ file: `idylwild-icons/${file}`, ...extra });

/**
 * Pixel-art icons for artifacts Duelyst has no icon for. `tint` = CSS colour applied with the
 * 'color' blend (keeps the shading, changes the hue) so one cloak can serve several artifacts;
 * `lighten` (+ `lightenAlpha`) then brightens with a 'screen' blend.
 */
export const ARTIFACT_ICONS = {
  // feet
  sandals_of_the_saint: S7('A_Shoes03.png'),
  dragonbone_greaves: ID('greaves.png', { tint: '#e8dcc0', tintAlpha: 0.55 }),
  dead_mans_boots: S7('A_Shoes06.png'),
  boots_of_polarity: S7('A_Shoes04.png'),
  boots_of_speed: S7('A_Shoes07.png'),
  boots_of_levitation: S7('A_Shoes05.png'),
  wayfarers_boots: S7('A_Shoes01.png'),
  trailblazers_boots: ID('leather_boots.png'),
  pathfinders_legacy: S7('A_Shoes02.png'),
  // shoulders
  vampires_cowl: ID('cloth_hood.png', { tint: '#7a1020', tintAlpha: 0.7 }),
  surcoat_of_counterpoise: S7('A_Clothing02.png'),
  cape_of_velocity: ID('cloak.png', { tint: '#30b8c8', tintAlpha: 0.75 }),
  cape_of_conjuring: ID('cloak.png', { tint: '#8a40c8', tintAlpha: 0.75 }),
  recanters_cloak: ID('cloak.png', { tint: '#8a8a8a', tintAlpha: 0.85 }),
  everflowing_crystal_cloak: ID('cloak.png'),
  cape_of_silence: ID('cloak.png', { tint: '#303048', tintAlpha: 0.8 }),
  cloak_of_gales: ID('cloak.png', { tint: '#d8e8f0', tintAlpha: 0.7 }),
  cloak_of_the_undead_king: ID('cloak.png', { tint: '#2c7a3a', tintAlpha: 0.8 }),
  diplomats_cloak: ID('cloak.png', { tint: '#d8a830', tintAlpha: 0.8 }),
  // bows
  bow_of_elven_cherrywood: S7('W_Bow08.png'),
  bowstring_of_the_unicorns_mane: S7('W_Bow07.png'),
  golden_bow: S7('W_Gold_Bow.png'),
  bow_of_the_sharpshooter: S7('W_Bow16.png'),
  // Legion statue pieces
  head_of_legion: ID('close_helmet.png'),
  arms_of_legion: ID('gauntlets.png'),
  torso_of_legion: ID('breastplate.png'),
  loins_of_legion: ID('chainmail_pants.png'),
  legs_of_legion: ID('platemail_pants.png'),
  statue_of_legion: S7('A_Armour03.png'),
  // misc
  shackles_of_war: ID('chain.png'),
  cartographers_compass: S7('I_Map.png'),
  mariners_astrolabe: S7('I_Telescope.png'),
};

/** Resource icons Duelyst has no art for. */
export const RESOURCE_ICONS = {
  wood: ID('log.png'),
  sulfur: ID('gold_ore.png', { tint: '#fff000', tintAlpha: 0.9, lighten: '#a08800', lightenAlpha: 0.8 }),
};

/**
 * Animated war machines from "[LPC] Siege Weapons": 128x128 frames, 6 columns (shoot animation),
 * 8 rows = directions n, ne, e, se, s, sw, w, nw. Layers are drawn in order with the same frame.
 * `rows.right` / `rows.left` are the side views used for facing 1 / -1. `frames` lists the columns
 * for each game state (idle shows the loaded machine). `b` (opaque bounds of the used frames,
 * frame-space [x0,y0,x1,y1]) comes from the manifest.
 */
const SIEGE = 'lpc-siege-weapons/';
export const UNIT_SHEETS = {
  ballista: {
    layers: [`${SIEGE}wheels-bg.png`, `${SIEGE}ballista.png`, `${SIEGE}wheels-fg.png`, `${SIEGE}ballista-arm.png`],
    fw: 128, fh: 128, rows: { right: 2, left: 6 },
    anims: { idle: [0], move: [0], attack: [0, 1, 2, 3, 4, 5], shoot: [0, 1, 2, 3, 4, 5], hit: [0], defend: [0], dead: [5] },
    scale: 1,
  },
  catapult: {
    layers: [`${SIEGE}wheels-bg.png`, `${SIEGE}catapult.png`, `${SIEGE}wheels-fg.png`],
    fw: 128, fh: 128, rows: { right: 2, left: 6 },
    anims: { idle: [0], move: [0], attack: [0, 1, 2, 3, 4, 5], shoot: [0, 1, 2, 3, 4, 5], hit: [0], defend: [0], dead: [5] },
    scale: 1,
  },
  cannon: {
    layers: [`${SIEGE}cannon.png`],
    fw: 128, fh: 128, rows: { right: 2, left: 6 },
    anims: { idle: [0], move: [0], attack: [0, 1, 2, 3, 4], shoot: [0, 1, 2, 3, 4], hit: [0], defend: [0], dead: [0] },
    scale: 1,
  },
};

/**
 * Ids whose Duelyst stand-in reads worse than the alternative: with packs on they skip the
 * Duelyst layer, so they get the pack art when mapped (war-machine artifacts below) and the
 * procedural picture otherwise (a healer stood in for the first aid tent, a mech for the ammo
 * cart, an obelisk for the arrow tower; the procedural tent / cart / tower read better).
 */
export const SKIP_DUELYST = {
  creature: ['first_aid_tent', 'ammo_cart', 'arrow_tower'],
  artifact: ['ballista', 'catapult', 'cannon', 'first_aid_tent', 'ammo_cart'],
};
const SKIP_SETS = Object.fromEntries(Object.entries(SKIP_DUELYST).map(([k, v]) => [k, new Set(v)]));
export function skipDuelyst(kind, id) {
  const s = SKIP_SETS[kind];
  return Boolean(s && s.has(id));
}

/** Sound effects for events the Duelyst audio map has no file for. Paths relative to assets/. */
export const PACK_SFX = {
  defeat: 'lrsf-fantasy-sfx/jingle_lose_00.mp3',
};

/** Every file referenced by the mapping tables (manifest tool keeps exactly these). */
export function mappedFiles() {
  const files = new Set();
  for (const t of Object.values(TERRAIN_TEXTURES)) files.add(t.file);
  for (const t of Object.values(ARTIFACT_ICONS)) files.add(t.file);
  for (const t of Object.values(RESOURCE_ICONS)) files.add(t.file);
  for (const u of Object.values(UNIT_SHEETS)) for (const l of u.layers) files.add(l);
  for (const f of Object.values(PACK_SFX)) files.add(f);
  for (const f of generatedFiles()) files.add(f);
  return [...files].sort();
}

/**
 * (kind, id, opts) -> mapping entry or null. The project's generated art (generated.js) comes
 * first, then the third-party packs.
 */
export function resolvePackRef(kind, id, opts) {
  const gen = resolveGenerated(kind, id, opts);
  if (gen) return gen;
  switch (kind) {
    case 'artifact': return ARTIFACT_ICONS[id] || (UNIT_SHEETS[id] ? { ...UNIT_SHEETS[id], unit: id } : null);
    case 'resource': return RESOURCE_ICONS[id] || null;
    case 'creature': return UNIT_SHEETS[id] || null;
    case 'terrain': return TERRAIN_TEXTURES[id] || null;
    default: return null;
  }
}
