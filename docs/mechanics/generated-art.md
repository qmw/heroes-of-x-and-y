# Generated art pack (`assets/generated/`, `src/gfx/packs/generated.js`)

The project's own art for everything the Duelyst layer and the third-party packs do not cover:
adventure-map objects, towns on the map, town screens (backdrops and buildings), a few artifact
icons, the procedural-only war machines and the hero boat. Every picture was generated for this
project with **OpenAI image generation via Codex CLI** from original prompts and is owned by the
project author (`assets/generated/LICENSE.txt`, `assets/CREDITS.md`, registry entry `generated` in
`src/gfx/packs/registry.js`). It is an ordinary pack of the asset-pack layer
(`docs/mechanics/asset-packs.md`): same manifest, same sync-canvas / async-paint / `onSpriteReady`
contract, and anything not mapped (or not loaded yet) keeps the procedural picture.

| file | role |
|---|---|
| `tools/genart/build-prompts.mjs` | builds `tools/genart/prompts.json` from the game data: id, kind, prompt (shared style preamble + subject), aspect, max size, recolour variants |
| `tools/genart/generate.mjs` | driver: runs `codex exec` in parallel work dirs, skips ids already generated, verifies PNGs, retries (max 2), logs |
| `tools/genart/resize.mjs` | raw 1024-1536 px images -> `assets/generated/<kind>/<key>.png`: trim, area-average downscale, 256-colour indexed PNG, magenta recolour variants, backdrop crop |
| `tools/genart/imageops.mjs` | zero-dependency pixel ops (trim, resize with premultiplied alpha, quantise, recolour, blit) |
| `tools/genart/contact-sheet.mjs` | review helper: many images on one checker sheet |
| `tools/png-lite.mjs` | PNG decode + encode (RGBA and indexed) with `node:zlib` |
| `src/gfx/packs/generated.js` | mapping of game ids to files, `GENERATED_KINDS`, `resolveGenerated(kind, id, opts)` |
| `src/gfx/packs/index.js` | painters for the generated stills (`genLayout`, `fitBottom`, `paintGenerated`) |
| `gallery-generated.html` | review page: generated art next to the procedural picture |
| `tests/gfx/generated.test.js` | files exist, sizes, ids, licence, painter geometry, gfx priority |

## 1. Workflow

```sh
node tools/genart/build-prompts.mjs                         # prompts.json (re-run after editing tables)
node tools/genart/generate.mjs --only '^object/' --parallel 10 --batch 2
node tools/genart/resize.mjs     # -> assets/generated/
node tools/build-packs-manifest.mjs --prune                 # manifest + drop unmapped files
```

`generate.mjs` asks Codex for `--batch` images per `codex exec` call (each image is one image-tool
call, about 70-100 s), `--parallel` calls at once; raw images go to `$GENART_DIR/raw/<kind>/<key>.png`
(never into the repo). `--force <regex>` regenerates ids (rejected pictures), `--only` limits ids,
`--dry` lists what would run. A raw image is accepted when it is a complete PNG of at least 256 px.

## 2. Prompts and style

Every prompt = a shared preamble + subject (+ faction style for towns). Preambles: original
high-fantasy design, crisp detailed pixel art (clean dark outlines, hand-placed shading, like modern
fantasy pixel-art sprites), light from the top-left, a single isolated subject on a transparent
background, nothing cut off, no ground tile, **no text / letters / logos / UI / frames**, "original
design, not from any existing game". No prompt names a commercial game, franchise or character.

- **Map objects** (`MAP_STYLE`): three-quarter elevated top-down view, entrance at the bottom centre
  for enterable multi-tile objects; aspect from the footprint (landscape >= 1.3:1, portrait <= 0.77:1).
- **Town buildings** (`TOWN_STYLE`): slightly elevated front three-quarter view + the faction theme
  (castle: white stone / blue roofs; rampart: elven woods and dwarven stone; tower: snowy alabaster /
  gold domes; inferno: lava / black iron; necropolis: bone / grey stone / ghost light; dungeon: caverns /
  purple crystals; stronghold: palisades / hides; fortress: swamp / stilts; conflux: floating
  elemental crystals; cove: pirate harbour; factory: brass / steam / gears).
- **Backdrops**: wide panorama, sky and distance in the upper half, empty ground in the lower half.
- **Recolour bases**: keymaster tents, border guards / gates, monoliths and the hero boat are
  generated once with their coloured parts in pure magenta; `resize.mjs` writes one copy per colour
  (hue ~300 deg pixels get the target colour, shading kept).

## 3. Sizes

| kind | stored as | max side | used at run time |
|---|---|---|---|
| `object/<id>` (+ `town_<faction>_<level>`) | trimmed sprite | 256 | contained in the footprint canvas (`w*size` x `h*size`), bottom-centred; 1x1 pick-ups at 80 % |
| `building/<faction>_<common id>`, `building/<faction building id>` | trimmed sprite | 256 (walls 384) | contained in the `getTownLayout` rectangle, bottom-centred |
| `town/<faction>` | 800 x 374 | - | backdrop, scaled to the requested height |
| `artifact/<id>` | trimmed icon | 64 | icon placement by opaque bounds (like the other packs) |
| `unit/<id>` | trimmed sprite | 192 | creature contract: feet at (w/2, 0.92h), mirrored for facing -1 |
| `hero/boat_<colour>` | trimmed sprite | 192 | hero-boat figure, feet at (w/2, 0.92h) |

PNGs are 256-colour indexed (median cut, no dithering) which keeps them about a third of the RGBA size.

## 4. Mapping (`generated.js`)

- **Objects**: every map object except monsters, `event`, `random_town` -> `object/<id>`. Faction
  creature dwellings on the map reuse the town dwelling picture of the same name / tier
  (`building/<faction>_dwelling_<tier>`). `town` uses `object/town_<variant>_<state>`
  (village|fort|citadel|castle). Flaggable objects (mines, dwellings, towns, shipyards, lighthouses,
  garrisons) get the procedural player flag drawn over the picture when `playerColor` is set.
- **Buildings**: common buildings per faction (`<faction>_<id>`; faction = `variant`, else castle),
  faction buildings by id. **Backdrops** per faction.
- **Artifacts**: the 8 icons no other layer had. **Units**: `first_aid_tent`, `ammo_cart`, `arrow_tower`
  (combat, still picture; also the artifact-slot icons of the first two). **Hero boat**: per player colour.
- The tables list every picture the pack should have; only files present in the manifest are used,
  the rest keep the procedural art (`build-packs-manifest.mjs` reports them as "still to make").
  Sets that must look coherent are used per faction only when complete (`completeFactions`): a town
  screen (backdrop + all buildings of that faction), the 4 map-town levels, the 12 siege pieces.
  `GENERATED_OMIT` lists rejected pictures that keep the procedural art.

## Status (2026-10-19, morning)

The Codex quota runs out after a few minutes of generation (last stop 2026-10-19 08:21 CEST, next
reset 13:16). `generate.mjs` now stops by itself when Codex reports the usage limit (log line
`STOP: Codex usage limit reached, try again at ...`) instead of burning retries. Present: 172
map-object files (incl. 8 keymaster-tent colours; map towns of 10 factions, all in use - factory
still procedural), 62 town buildings (halls, forts, citadels and 2 more; no faction's town-screen set
is complete, so town screens stay procedural), 2 artifact icons, ammo cart and first aid tent.
Still to make: ~650 images (other map objects, factory map towns, all backdrops, faction buildings,
6 artifacts, arrow tower, boat, all siege pieces).
Resume (skips what exists, salvages interrupted runs; raw dir defaults to `.genart/`):
`node tools/genart/generate.mjs --parallel 10`, then `node tools/genart/resize.mjs` and
`node tools/build-packs-manifest.mjs --prune`; nothing else needs to change.

## Checklist

- [x] prompt builder, generator, resizer, contact sheets, PNG encoder - tools/genart/, tools/png-lite.mjs
- [x] registry entry, licence file, CREDITS.md, Credits screen - tests/gfx/packs.test.js
- [x] files in the manifest exist, sizes within limits, ids valid, sets gated - tests/gfx/generated.test.js
- [ ] generate the remaining ~690 pictures (Codex usage limit), review town screens / siege in the browser
- [x] painters: footprint / layout / backdrop / unit geometry, flags, priority - tests/gfx/generated.test.js
