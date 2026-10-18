# H3online

A browser remake of the mechanics of *Heroes of Might and Magic III* (Complete + HotA-style extras).
Plain ES modules, no build step, zero runtime dependencies.

## Run

```sh
npm start            # static server on http://localhost:8080 (PORT=xxxx to change)
```

Open the page and pick **New Game** (random map or scenario), **Campaign**, **Map Editor** or
**Encyclopedia** from the main menu.

## Test

```sh
npm test             # unit / integration tests (node:test), Node >= 20
npm run e2e          # browser end-to-end run via headless Chrome (CDP driver in tools/e2e/)
```

Set `PERF=1` to make the AI timing tests strict instead of load-tolerant.

## Content

- 11 factions (the 9 originals plus Cove and Factory), 190 creatures, 82 creature abilities
- 197 heroes in 22 classes, 29 secondary skills, 98 spells, 192 artifacts (including combinations)
- 234 town buildings, 12 terrains, 398 adventure-map object types
- Full combat: spells, siege, war machines, morale/luck, tactics and a combat AI
- Strategic AI opponents, random map generator, hand-made scenarios
- 3 campaigns (10 maps), map editor, save/load (compressed local storage)

## Layout

| path | contents |
|---|---|
| `src/core/` | seeded RNG, shared constants |
| `src/data/` | game content (creatures, heroes, spells, artifacts, buildings, map objects …) |
| `src/engine/` | rules: heroes, towns, economy, combat, adventure map, AI, map generator, campaigns, editor |
| `src/gfx/` | sprite layer: generated art, Duelyst art, free packs, procedural fallback |
| `src/ui/` | screens and UI kit (fixed 1280×720 stage) |
| `tests/` | `node:test` suites per area, plus `tests/e2e` |
| `tools/` | dev server, e2e driver, art-generation scripts (`tools/genart/`) |
| `docs/` | `DESIGN.md` (module contracts), `mechanics/*.md` (rules and checklists), `audit/*.md` |

Art galleries for checking the sprites: `gallery.html`, `gallery-duelyst.html`,
`gallery-packs.html`, `gallery-generated.html`.

## Credits

Graphics and audio come from the Duelyst CC0 release, a few CC0 / CC-BY packs, art generated for
this project, and procedural drawing. See [`assets/CREDITS.md`](assets/CREDITS.md) for full
attributions and licences.
