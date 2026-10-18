// Credits / about.
import { CREATURES } from '../../data/creatures.js';
import { HEROES } from '../../data/heroes.js';
import { SPELLS } from '../../data/spells.js';
import { ARTIFACTS } from '../../data/artifacts.js';
import { FACTIONS_DATA } from '../../data/factions.js';
import { MAP_OBJECTS } from '../../data/mapObjects.js';
import { BUILDINGS } from '../../data/buildings.js';
import { PACKS } from '../../gfx/packs/registry.js';

const LICENSE_LABEL = { 'CC0-1.0': 'CC0', 'CC-BY-3.0': 'CC BY 3.0', 'CC-BY-4.0': 'CC BY 4.0', 'LicenseRef-Project-Generated': 'owned by the project author' };

export function mount(root, ctx) {
  const ui = ctx.ui;
  const { h } = ui;
  const counts = [[FACTIONS_DATA.length, 'towns'], [CREATURES.length, 'creatures'], [HEROES.length, 'heroes'], [SPELLS.length, 'spells'],
    [ARTIFACTS.length, 'artifacts'], [BUILDINGS.length, 'buildings'], [MAP_OBJECTS.length, 'map objects']];
  root.appendChild(h('div.cr', null,
    ui.Panel({ title: 'About H3online', variant: 'parchment', class: 'cr-panel' },
      h('p', null, 'H3online is a non-commercial fan remake of the mechanics of a classic fantasy turn-based strategy game, written from scratch to run in a web browser.'),
      h('p', null, 'It is a remake of rules, not of assets. Creatures, heroes, spell effects, battlefields, music and sound effects come from the art and audio of Duelyst, released into the public domain (CC0 1.0) by its developers (github.com/open-duelyst/duelyst); map objects, towns, town screens and a few icons were generated for this project with OpenAI image generation via Codex CLI (owned by the project author); a few free asset packs (listed below) add map terrain textures, extra artifact icons, war machines and a sound; everything else is original, procedurally generated on a canvas at run time or synthesised on the fly. No artwork, music, sound or text of the original game is included or downloaded.'),
      h('p', null, 'This project is not affiliated with, endorsed by or connected to the owners of the original game or its trademarks. All trademarks belong to their respective owners.'),
      h('h3.enc-h', null, 'Art and sound sources'),
      h('ul.cr-packs', { style: 'margin: 0 0 10px; padding-left: 18px; font-size: 13px; line-height: 1.35;' },
        h('li', null, 'Duelyst art and audio - open-duelyst - CC0 - github.com/open-duelyst/duelyst'),
        PACKS.map((p) => h('li', null, p.attribution
          ? `${p.attribution.replace(/ - https?:\/\/\S+/, '')} - ${p.url.replace(/^https:\/\//, '')}`
          : `${p.name} - ${p.author} - ${LICENSE_LABEL[p.license] || p.license} - ${p.url.replace(/^https:\/\//, '')}`))),
      h('h3.enc-h', null, 'What is inside'),
      h('div.cr-counts', null, counts.map(([n, label]) => h('div.cr-count', null, h('b', null, String(n)), h('span', null, label)))),
      h('h3.enc-h', null, 'How it is built'),
      h('p', null, 'Plain JavaScript modules - no framework, no build step, no dependencies. The rules engine is deterministic, keeps its whole state as plain JSON and is covered by unit tests; the interface is plain DOM and canvas.'),
      h('p', null, 'Hot-seat multiplayer for up to eight players, computer opponents, a random map generator and saves in your browser (with export to a file).'),
      h('div.k-row.k-row-center', null,
        ui.Button('Encyclopedia', { onClick: () => ctx.showScreen('encyclopedia') }),
        ui.Button('Back', { kind: 'primary', hotkey: 'Esc', onClick: () => ctx.back() })))));
  ctx.keys.bind('escape', () => ctx.back(), 'Back');
}

export function unmount() {}
