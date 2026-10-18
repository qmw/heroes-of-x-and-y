# Asset-pack art layer (`src/gfx/packs/`)

Small third-party packs (CC0 or CC-BY only), plus the project's own generated art pack
(`generated`, `docs/mechanics/generated-art.md`, consulted first inside this layer), that fill gaps neither the Duelyst art
(`docs/mechanics/duelyst-assets.md`) nor the procedural painters cover well. Same architecture as the
Duelyst layer: a re-runnable manifest tool, mapping tables from game ids to pack files, and a
synchronous `getX(kind, id, opts) -> canvas | null` that paints when the image arrives and notifies
listeners. Anything not mapped keeps the Duelyst or procedural art.

| file | role |
|---|---|
| `assets/<pack-id>/` | the pack's files (only those the mapping uses) + `LICENSE.txt` (source URL, licence, attribution) |
| `assets/CREDITS.md` | all third-party art and audio with authors, URLs, licences, attributions, rejected candidates |
| `assets/packs-manifest.json` | generated: file sizes, icon opaque bounds, war-machine frame bounds |
| `tools/build-packs-manifest.mjs` | builds the manifest; `--prune` deletes unmapped files from the pack folders |
| `src/gfx/packs/registry.js` | `PACKS`: id, name, author, url, licence, licence file, attribution, use (single source for credits) |
| `src/gfx/packs/mapping.js` | mapping tables (below), `mappedFiles()`, `resolvePackRef(kind, id)`, `SKIP_DUELYST` |
| `src/gfx/packs/index.js` | runtime loader, sprite painters, terrain painter |
| `src/ui/screens/credits.js` | lists the registry (CC-BY attribution lines verbatim) |
| `gallery-packs.html` | review page: pack art next to what the game draws without it (`npm start`, `/gallery-packs.html`) |
| `tests/gfx/packs.test.js` | licences, manifest, mapping ids, loader, terrain painter, gfx priority |

## 1. Packs

| pack id | pack | author | licence | size | used for |
|---|---|---|---|---|---|
| `generated` | H3online generated art (`docs/mechanics/generated-art.md`) | project author, made with OpenAI image generation via Codex CLI | own (LicenseRef-Project-Generated) | see that doc | map objects, towns, town screens, war machines, boat, siege pieces, 8 artifact icons |
| `sbs-tiny-textures` | [Tiny Texture Pack 1/2/3](https://opengameart.org/content/tiny-texture-pack-1) | Screaming Brain Studios | CC0 | 0.45 MB (11 files) | map ground textures |
| `7soul1-rpg-icons` | [496 pixel art icons for medieval/fantasy RPG](https://opengameart.org/content/496-pixel-art-icons-for-medievalfantasy-rpg) | Henrique Lazarini (7Soul1) | CC0 | 70 KB (15) | artifacts: boots, bows, tunic, armour, map, spyglass |
| `idylwild-icons` | [Idylwild's Armory](https://opengameart.org/content/idylwilds-armory) + [Inventory](https://opengameart.org/content/idylwilds-inventory) | Idylwild | CC0 | 60 KB (13) | artifacts: cloaks, hood, greaves, chain, Legion pieces; wood, sulfur |
| `lpc-siege-weapons` | [[LPC] Siege Weapons](https://opengameart.org/content/lpc-siege-weapons) | bluecarrot16 | **CC-BY 4.0** | 155 KB (6) | ballista, catapult, cannon |
| `lrsf-fantasy-sfx` | [Fantasy Sound Effects Library](https://opengameart.org/content/fantasy-sound-effects-library) | Little Robot Sound Factory | **CC-BY 3.0** | 145 KB (1) | `defeat` jingle |

Total ≈ 0.8 MB. Licences were read on each page (2026-10-14); `LICENSE.txt` in every folder records the
URL, licence and (CC-BY) the attribution text, which `assets/CREDITS.md` and the Credits screen repeat.
Rules: CC0 preferred, CC-BY 3.0/4.0 accepted with attribution; no CC-BY-SA / GPL-only, no unclear or
"personal use" licences, nothing ripped from commercial games. Pack files are untrusted data: the tool
only decodes PNG headers/pixels, nothing is executed.

## 2. Priority per kind (`src/gfx/index.js`)

| kind | order |
|---|---|
| `terrain` (base tiles, via `drawTerrainTile`), `object`, `building`, `town`, `ui`, `obstacle` | packs → procedural |
| `creature` | packs (mapped war machines) → Duelyst → procedural |
| `artifact`, `resource`, other kinds | Duelyst → packs → procedural |

`SKIP_DUELYST` (mapping.js) bypasses Duelyst stand-ins that read worse than the alternative: creatures
`first_aid_tent`, `ammo_cart`, `arrow_tower` (a healer, a mech and an obelisk stood in) → procedural;
artifacts `ballista`, `catapult`, `cannon` → pack machine icons, `first_aid_tent`, `ammo_cart` → procedural.
`setUsePacks(false)` turns the layer off (procedural / Duelyst only). `onSpriteReady` (index.js) now
fires for Duelyst sheets and pack images, so the map view re-renders its terrain chunks when textures arrive.

## 3. Mapping (`mapping.js`)

**Terrain** (`TERRAIN_TEXTURES`): seamless 128 px textures; one map tile shows `TEXELS_PER_TILE` = 32
texels, so a texture repeats every 4 tiles and is continuous across tiles (the tile's world x,y come
from `info.seed` = `'x,y,z'`, which the map view passes). Grass `p1_grass_17`, dirt `p2_dirt_09`, sand
`p2_stone_03`, snow `p2_elements_07`, swamp `p3_terrain_15`, rough `p3_stone_04`, subterranean
`p2_stone_11`, lava `p2_elements_05`, rock `p2_stone_13`, highlands `p3_terrain_07`, wasteland
`p3_stone_01`. Optional `tint`/`shade` colour adjustments exist (unused now). **Water stays procedural**
(its texture candidates were neon cyan; the procedural water animates and has surf).

`terrainPackPainter` is injected into `terrain.js` (`setTerrainPackPainter`): `base()` draws the texture
region; `edge()` uses the procedural fringe canvas as an alpha mask and fills it with the neighbour's
texture (on water tiles the procedural surf line is laid over at 50%). Until a texture has loaded it
returns false and the procedural tile is drawn. Rivers, roads, magic overlays, shroud/fog are procedural.
`getSprite('terrain', id, { variant: 0..3 })` returns a texture tile once loaded (null before, never blank).

**Artifacts** (`ARTIFACT_ICONS`, 32 of the 39 Duelyst gaps): boots ×9 (7Soul1 shoes, Idylwild leather
boots / greaves), cloaks ×8 (Idylwild cloak recoloured with `tint`), cowl, surcoat, bows ×4, Legion
pieces ×5 + statue, shackles (chain), cartographer's compass (map), mariner's astrolabe (spyglass).
Still procedural: `dragon_wing_tabard`, `spirit_of_oppression`, `hourglass_of_the_evil_hour`,
`stoic_watchman`, `inexhaustible_cart_of_lumber`, `sleepkeeper`, `demons_horseshoe`, `merchants_scales`
(no fitting icon found). Icons are scaled by their opaque bounds (manifest `b`) to ~86% of the canvas,
integer pixel scale when close, `imageSmoothingEnabled = false`; `tint` = 'color' blend on a separate
layer (`lighten` = extra 'screen' pass), alpha restored from the source.

**Resources** (`RESOURCE_ICONS`): wood = Idylwild log; sulfur = Idylwild gold ore recoloured yellow.

**War machines** (`UNIT_SHEETS`): LPC sheets are 768×1024 = 6 columns (shoot animation) × 8 rows
(directions n, ne, e, se, s, sw, w, nw); rows 2 (e) / 6 (w) are the side views for facing 1 / -1 (real
art for both sides, no mirroring). Layers per machine in the pack's order: ballista = wheels-bg, ballista,
wheels-fg, ballista-arm; catapult = wheels-bg, catapult, wheels-fg; cannon = cannon. States: `idle`/`move`
= frame 0, `attack`/`shoot` = 6 (cannon 5) frames, `dead` = last frame darkened. Geometry follows the
creature contract (height = size, width ×2 for 2-hex, feet at (w/2, 0.92h)); scale fits the row's opaque
bounds (manifest `units[id].rows`) into the box. In artifact slots the machine is drawn in a square box.

**Sound** (`PACK_SFX`): `defeat` → `lrsf-fantasy-sfx/jingle_lose_00.mp3`; `duelyst/audioMap.getSfxUrl`
returns it (base `assets/`, `opts.packBaseUrl` overrides) when Duelyst has no file for the event.

## 4. Runtime API (`src/gfx/packs/index.js`)

```js
initPacks({ baseUrl = 'assets/', manifestUrl?, loadImage?, fetchJson?, createCanvas? }) -> Promise<{files, units}>
// gfx index: initArtPacks(o) = initPacks + start loading the terrain textures (called by src/ui/sprites.js)
configurePacks({ loadImage, fetchJson, createCanvas, maxCache })   resetPacks()   isPacksReady()
getPackSprite(kind, id, opts) -> canvas | null        // artifact | resource | creature | terrain
getPackSpriteInfo(kind, id, opts) -> { width, height, anchorX, anchorY, frames } | null
getPackAnimationInfo('creature', id, state) -> { frames, fps: 10, loop, anim } | null
hasPackSprite(kind, id)   preloadPackSprites([[kind, id], ...])   onPackSpriteReady(fn) -> unsubscribe
terrainPackPainter.{ base, edge, ready }   preloadTerrainTextures()   getPackSfxUrl(event)
iconPlacement(iw, ih, bounds, side, fill)   packUnitLayout(ref, bounds, id, opts)   packFrameIndex(n, state, opts)
```

`opts` as for gfx (`size, frame, frames, time, facing, state, playerColor, box, minBody`). The first call
returns a cached blank canvas and requests the image(s); when they arrive the same canvas is painted and
listeners fire. A failing image marks the sprite broken → `null` → next layer. LRU cache of 2000 canvases.

## 5. Adding a pack

1. Verify the licence on the pack's page (CC0 / CC-BY only). Download over HTTPS into a scratch folder,
   unzip with a non-executing tool, look at the files.
2. Copy only candidate images/audio to `assets/<pack-id>/`; write `assets/<pack-id>/LICENSE.txt` with
   title, author, URL, licence (+ full CC0 text or the CC-BY licence URL) and the attribution line.
3. Add the pack to `PACKS` in `registry.js` and to `assets/CREDITS.md`.
4. Map ids in `mapping.js` (new kinds: extend `resolvePackRef`, `mappedFiles`, the painters in `index.js`
   and, if the kind should precede Duelyst, `PACKS_FIRST` in `src/gfx/index.js`).
5. `node tools/build-packs-manifest.mjs --prune`, check `/gallery-packs.html`, run `node --test tests/`
   and `npm run e2e`; drop mappings that look worse than what they replace.

## 6. Candidates rejected

Kenney (CC0) Medieval RTS / Roguelike RPG / Pirate Pack / Tiny Battle / Tiny Town / UI packs: flat
top-down or modern styles that clash with the map's 3/4 view and the Duelyst pixel art. Duelyst battle-map
backgrounds as town backdrops: wrong subject. LPC terrain and other LPC / OGA siege sets: CC-BY-SA / GPL.
Itch "Medieval Units": no standard licence. RandomMind "Medieval: Defeat Theme" (CC0): 45 s music, not a
sting. No CC0 pack in a fitting style was found for map objects, town views, UI frames or hero map
figures, so those stay procedural (heroes: Duelyst).

## Checklist

- [x] licence file + registry entry for every pack, CREDITS.md and Credits screen list them - tests/gfx/packs.test.js
- [x] manifest = mapped files, all present; folders pruned - tests/gfx/packs.test.js
- [x] mapping ids valid; packs only fill Duelyst gaps - tests/gfx/packs.test.js
- [x] sync canvas + deferred paint, tint layer, broken image → null - tests/gfx/packs.test.js
- [x] war machines: layers, facing rows, geometry, animation info - tests/gfx/packs.test.js
- [x] terrain painter: continuous texture, masked fringes, procedural until loaded - tests/gfx/packs.test.js
- [x] gfx priority wiring, `setUsePacks`, defeat sound - tests/gfx/packs.test.js, tests/gfx/duelyst.test.js
