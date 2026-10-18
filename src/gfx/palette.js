// Shared colour vocabulary for all painters.

import { PLAYER_COLORS } from '../core/constants.js';
import { FACTIONS_DATA } from '../data/factions.js';
import { shade, mix, tweak } from './kit.js';

export const PLAYER_HEX = {
  red: '#d83a2c', blue: '#3564d8', tan: '#c8aa72', green: '#3fa544', orange: '#e8862a',
  purple: '#8e44c8', teal: '#2aa8a0', pink: '#e87ab8', neutral: '#9a9a9a',
};

/** Hex colour for a player colour name (or index into PLAYER_COLORS, or a hex passed through). */
export function playerColorHex(color) {
  if (typeof color === 'number') return PLAYER_HEX[PLAYER_COLORS[color]] || PLAYER_HEX.neutral;
  if (typeof color === 'string' && color[0] === '#') return color;
  return PLAYER_HEX[color] || PLAYER_HEX.neutral;
}

export const RESOURCE_HEX = {
  gold: '#e8c040', wood: '#8a5a2a', ore: '#7a7a82', mercury: '#c0c8d8', sulfur: '#e8d83a',
  crystal: '#d03a4a', gems: '#3ad0a0',
};

export const SCHOOL_HEX = { air: '#5aa8e8', earth: '#7a9a3a', fire: '#e0582a', water: '#3a6ad8', all: '#9a5ad8' };

export const CLASS_HEX = {
  treasure: '#a8703a', minor: '#a8b0b8', major: '#e0b040', relic: '#b060e0', combo: '#3ac0b0', special: '#7a7a82',
};

export const UI_HEX = {
  parchment: '#e2cf9f', parchmentDark: '#b89c66', gold: '#d8ad45', goldLight: '#f6e08a', goldDark: '#7c5a1c',
  stone: '#6a6660', stoneDark: '#3a3834', wood: '#5a3c22', ink: '#1c1512', bg: '#1a1410',
  good: '#4ac04a', bad: '#d04a3a', mana: '#4a7ae8',
};

/**
 * Per-faction painting palette. `main` is the data colour; the rest are hand-picked companions
 * used by creature rigs, portraits, buildings and backdrops.
 */
const FACTION_EXTRA = {
  castle: { cloth: '#3f6fb5', metal: '#b8bcc8', trim: '#e8c860', skin: '#e8b890', wall: '#b8b0a0', roof: '#b0483a', sky: ['#5a9ae0', '#cfe6f8'], ground: '#4c8a2e' },
  rampart: { cloth: '#3c8c3c', metal: '#9aa48a', trim: '#d8c070', skin: '#e0b488', wall: '#8a6a44', roof: '#3c7c34', sky: ['#4a9ad0', '#d8f0d0'], ground: '#3c7c2a' },
  tower: { cloth: '#6a8ad0', metal: '#c8d4e0', trim: '#f0d878', skin: '#e4bc98', wall: '#e0e6ee', roof: '#5a7ac0', sky: ['#7ab0e8', '#f0f6ff'], ground: '#e8eef4' },
  inferno: { cloth: '#a02a22', metal: '#5a3a36', trim: '#f09030', skin: '#c8483a', wall: '#5a3432', roof: '#2e1c1c', sky: ['#3a0c0c', '#d8501c'], ground: '#4a3030' },
  necropolis: { cloth: '#4a3c5c', metal: '#6a6a78', trim: '#9ae0a0', skin: '#d8d4c0', wall: '#5a5660', roof: '#2a2634', sky: ['#14121e', '#4a4660'], ground: '#4a4034' },
  dungeon: { cloth: '#6a3c8a', metal: '#5a5068', trim: '#e0a040', skin: '#b89a8a', wall: '#5a4a52', roof: '#7a4a9a', sky: ['#1a1220', '#40343a'], ground: '#5a4a52' },
  stronghold: { cloth: '#a8683a', metal: '#8a8070', trim: '#e8d0a0', skin: '#7a9a4a', wall: '#a88458', roof: '#8a4a2a', sky: ['#e8a85a', '#f8e4b0'], ground: '#9a7a4e' },
  fortress: { cloth: '#4f7f6a', metal: '#7a7a62', trim: '#d8b860', skin: '#6a9a5a', wall: '#6a6a4a', roof: '#3a5a3a', sky: ['#5a7a72', '#b8ccb0'], ground: '#4a6a4a' },
  conflux: { cloth: '#c050a8', metal: '#b0a8d0', trim: '#f8e080', skin: '#e0c0d8', wall: '#c8b8e0', roof: '#d05fb0', sky: ['#6a4ac0', '#f0b0d8'], ground: '#6f9a4e' },
  cove: { cloth: '#2f8c8c', metal: '#8a9aa0', trim: '#e8c860', skin: '#d8a880', wall: '#9a8060', roof: '#2a6a7a', sky: ['#3a90c8', '#f8e0b0'], ground: '#b8a86a' },
  factory: { cloth: '#a08a4a', metal: '#b0864a', trim: '#e0b050', skin: '#e0b088', wall: '#b08a5a', roof: '#6a5a4a', sky: ['#d8a060', '#f4e0b8'], ground: '#b0733c' },
  neutral: { cloth: '#8a7a5a', metal: '#9a9a9a', trim: '#d8c080', skin: '#e0b088', wall: '#a09a8a', roof: '#6a5a4a', sky: ['#6aa0d8', '#e0eef8'], ground: '#6a8a3a' },
};

const FACTION_PAL = {};
for (const f of FACTIONS_DATA) FACTION_PAL[f.id] = { id: f.id, main: f.color, ...(FACTION_EXTRA[f.id] || FACTION_EXTRA.neutral) };
FACTION_PAL.neutral = { id: 'neutral', main: '#8a7a5a', ...FACTION_EXTRA.neutral };

export function factionPalette(id) {
  return FACTION_PAL[id] || FACTION_PAL.neutral;
}

/** Everything the UI may want to re-use for consistent styling. */
export function getPalette() {
  return {
    players: { ...PLAYER_HEX },
    resources: { ...RESOURCE_HEX },
    schools: { ...SCHOOL_HEX },
    artifactClasses: { ...CLASS_HEX },
    ui: { ...UI_HEX },
    factions: Object.fromEntries(Object.entries(FACTION_PAL).map(([k, v]) => [k, { ...v, sky: [...v.sky] }])),
  };
}

export { shade, mix, tweak };
