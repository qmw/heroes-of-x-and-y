// Third-party art/audio packs used by the asset-pack layer (docs/mechanics/asset-packs.md).
// Every pack lives in assets/<id>/ next to its licence file. This table is the single source for
// the manifest tool (tools/build-packs-manifest.mjs), assets/CREDITS.md, the in-game Credits
// screen and the tests. Only files that a mapping in mapping.js uses are kept in the folders.

/**
 * @typedef {Object} AssetPack
 * @property {string} id           folder name under assets/
 * @property {string} name         title of the pack on its page
 * @property {string} author
 * @property {string} url          page where the licence was verified
 * @property {string} license      SPDX-like id: CC0-1.0 | CC-BY-3.0 | CC-BY-4.0 | LicenseRef-Project-Generated
 * @property {string} licenseUrl
 * @property {string} licenseFile  file inside assets/<id>/
 * @property {string|null} attribution  required credit line (CC-BY), null for CC0
 * @property {string} usedFor
 */

/** @type {AssetPack[]} */
export const PACKS = [
  {
    // The project's own art: generated with OpenAI image generation through Codex CLI
    // (tools/genart/, docs/mechanics/generated-art.md). Not third-party: owned by the project author.
    id: 'generated',
    name: 'H3online generated art',
    author: 'the H3online project author (generated with OpenAI image generation via Codex CLI)',
    url: 'https://developers.openai.com/codex/cli',
    license: 'LicenseRef-Project-Generated',
    licenseUrl: 'https://openai.com/policies/terms-of-use',
    licenseFile: 'LICENSE.txt',
    attribution: null,
    note: 'generated for this project with OpenAI image generation via Codex CLI; owned by the project author',
    usedFor: 'adventure-map objects, towns and dwellings, town screens (backdrops and buildings), some artifact icons, war machines, the hero boat',
  },
  {
    id: 'sbs-tiny-textures',
    name: 'Tiny Texture Pack 1, 2 and 3',
    author: 'Screaming Brain Studios',
    url: 'https://opengameart.org/content/tiny-texture-pack-1',
    urls: [
      'https://opengameart.org/content/tiny-texture-pack-1',
      'https://opengameart.org/content/tiny-texture-pack-2',
      'https://opengameart.org/content/tiny-texture-pack-3',
    ],
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    licenseFile: 'LICENSE.txt',
    attribution: null,
    usedFor: 'adventure-map terrain ground textures (base tiles and the inside of terrain transitions)',
  },
  {
    id: '7soul1-rpg-icons',
    name: '496 pixel art icons for medieval/fantasy RPG',
    author: 'Henrique Lazarini (7Soul1)',
    url: 'https://opengameart.org/content/496-pixel-art-icons-for-medievalfantasy-rpg',
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    licenseFile: 'LICENSE.txt',
    attribution: null,
    usedFor: 'artifact icons without Duelyst art (boots, bows, tunic, golden armour, map, spyglass)',
  },
  {
    id: 'idylwild-icons',
    name: "Idylwild's Armory and Idylwild's Inventory",
    author: 'Idylwild',
    url: 'https://opengameart.org/content/idylwilds-armory',
    urls: ['https://opengameart.org/content/idylwilds-armory', 'https://opengameart.org/content/idylwilds-inventory'],
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    licenseFile: 'LICENSE.txt',
    attribution: null,
    usedFor: 'artifact icons (cloaks, hood, greaves, chain, Legion armour pieces) and the wood / sulfur resource icons',
  },
  {
    id: 'lpc-siege-weapons',
    name: '[LPC] Siege Weapons',
    author: 'bluecarrot16 (commissioned by castelonia)',
    url: 'https://opengameart.org/content/lpc-siege-weapons',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    licenseFile: 'LICENSE.txt',
    attribution: '"[LPC] Siege Weapons" by bluecarrot16, CC-BY 4.0 - https://opengameart.org/content/lpc-siege-weapons',
    usedFor: 'combat war machines: ballista, catapult and cannon (animated)',
  },
  {
    id: 'lrsf-fantasy-sfx',
    name: 'Fantasy Sound Effects Library',
    author: 'Little Robot Sound Factory',
    url: 'https://opengameart.org/content/fantasy-sound-effects-library',
    license: 'CC-BY-3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    licenseFile: 'LICENSE.txt',
    attribution: 'Sound by Little Robot Sound Factory (www.littlerobotsoundfactory.com), CC-BY 3.0 - "Fantasy Sound Effects Library"',
    usedFor: "the 'defeat' jingle (Jingle_Lose_00)",
  },
];

export const PACK_BY_ID = Object.fromEntries(PACKS.map((p) => [p.id, p]));

/** Packs whose licence requires a credit line. */
export function attributionLines() {
  return PACKS.filter((p) => p.attribution).map((p) => p.attribution);
}
