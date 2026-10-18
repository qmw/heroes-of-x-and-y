# Procedural graphics (`src/gfx`)

Every picture in the game can be drawn by code on canvas at runtime; no copyrighted art is used.
Optional art layers are tried first: the CC0 Duelyst art (`docs/mechanics/duelyst-assets.md`),
the project's own generated art (`docs/mechanics/generated-art.md`: map objects, towns, town screens,
siege pieces, war machines, hero boat) and small CC0 / CC-BY asset packs
(`docs/mechanics/asset-packs.md`: terrain textures through `drawTerrainTile`, extra artifact /
resource icons, war machines). This document describes the
procedural fallback, which is always complete. Painters use outlined vector shapes with gradient shading on a small "design
grid" per sprite. Each sprite is rendered once to an offscreen canvas and cached. All variation
is deterministic: per-id string hash + `src/core/rng.js`, never `Math.random`.

Review page: `npm start`, then open <http://localhost:8080/gallery.html>. It has tabs per kind,
size/state/player selectors, animation frames, a composed adventure-map demo and town-screen
demos for all 11 factions.

## Public API (`src/gfx/index.js`)

```js
getSprite(kind, id, opts?) -> HTMLCanvasElement | OffscreenCanvas   // cached; do not mutate
drawSprite(ctx, kind, id, x, y, opts?)       // draws top-left at (x,y); opts.w/opts.h stretch
getSpriteInfo(kind, id, opts?) -> { width, height, scale, anchorX, anchorY, frames }
getFrameCount(kind, id, state?) -> number
preload(list, onProgress?(done,total), batch=24) -> Promise<number>  // list: [kind,id,opts] | {kind,id,opts}
clearCache(); cacheStats() -> { size, hits, misses }
setCanvasFactory((w, h) => canvas | null)    // null = default (OffscreenCanvas, else document.createElement)
getPalette() -> { players, resources, schools, artifactClasses, ui, factions:{[id]:{main,cloth,metal,trim,skin,wall,roof,sky:[a,b],ground}} }
playerColorHex(color) -> '#rrggbb'           // 'red'..'pink', index into PLAYER_COLORS, or a hex passthrough
listIds(kind) -> string[]                    // every id the gallery/tests use for that kind
SPRITE_KINDS, STATE_FRAMES, CREATURE_STATES, EFFECT_FRAMES, DIRS8, TERRAIN_PRIORITY, TOWN_VIEW, NINE_SLICE
drawTerrainTile(ctx, x, y, size, info)       // see Terrain
terrainVariantCount(terrainId) -> 4; roadMask(bool[8]) -> 0..255
getObjectSpriteInfo(objectId, size=32) -> { tilesW, tilesH, width, height, entranceX, entranceY }
getTownLayout(factionId) -> { [buildingId]: { x, y, w, h, z } }   // 800x374 canvas, higher z drawn later
drawPanel(ctx, style, x, y, w, h, scale=1)   // 9-slice; style parchment|stone|gold|dark
drawButton(ctx, x, y, w, h, { state, label, font, color })
drawDamageNumber(ctx, text, x, y, { t: 0..1, kind: 'damage'|'heal'|'info', color, size })
effectForSpell(spellId) -> effect id
```

`opts = { size, frame, facing: 1|-1, playerColor, variant, state }`. Options that do not affect a
kind are ignored and do not split the cache. Unknown `kind` throws. Unknown creature, building or
terrain ids throw. Other kinds fall back to a generic picture.

**Meaning of `size`.** It is pixels per *unit cell*, and the canvas grows for multi-cell sprites:

| kind | `size` means | canvas | default | anchor |
|---|---|---|---|---|
| creature | height | `size` x `size` (1-hex), `2*size` x `size` (2-hex) | 96 | feet at (w/2, 0.92h) |
| hero | height (square) | `size` x `size` | 64 | feet at (w/2, 0.92h) |
| portrait | side | square | 64 | top-left |
| terrain | tile side | square | 32 | top-left |
| object | px per map tile | `w*size` x `h*size` (data `size: [w,h]`) | 32 | entrance tile = bottom row, column `floor(w/2)` (`anchorX` = its centre, `anchorY` = bottom) |
| building | height | layout `w/h` aspect | layout `h` (natural 800x374 scale) | top-left = layout x,y |
| town | height | 800:374 aspect | 374 | top-left |
| artifact / spell / skill / resource | side | square | 44 / 48 / 44 / 24 | top-left |
| ui | height | natural aspect per id | natural | top-left |
| obstacle | height | 64x64; siege pieces wall 48x96, gate 64x96, tower 56x110, keep 90x120, moat 48x24 | 48 / natural | bottom-centre |
| effect | side | square (96 design) | 96 (projectiles 48) | centre |

## Kinds, ids, opts

- **creature**: every id in `src/data/creatures.js` (190). `state`: `idle` (4 frames, bob),
  `move` (4, walk cycle), `attack` (3: wind-up, strike, recover; dragons breathe on the strike
  frame), `shoot` (3: aim, release with muzzle flash / magic burst, follow-through), `hit` (2,
  red flash and recoil), `defend` (1, crouch with shield forward), `dead` (2: falling, lying and
  greyed). `frame` wraps. `facing: -1` mirrors (default faces right / attacker side).
- **hero**: hero id (also accepts a hero class id or faction id). Mounted figure with a
  player-coloured banner and saddle cloth. `state` `idle|move` (4 frames). `variant: 'boat'`
  draws a sailing boat with a player-coloured sail. Uses `playerColor` and `facing`.
- **portrait**: hero id (197 distinct faces). Built from the hero's hash, faction, class kind and
  gender: species (human, elf, dwarf, halfling, orc, ogre, goblin, demon, undead/lich, lizard,
  gnoll, minotaur, troglodyte, genie, nix, fire/water/air/earth elementals), skin, eyes, brows,
  nose, mouth, beard, hair style, headgear, outfit, background and frame.
- **terrain**: the 12 terrain ids. `variant` 0..3 (water and lava animate with `frame` 0..3).
  `variant: 'edge' | 'shore'` with `state` 0..7 (DIRS8 = N,E,S,W,NE,SE,SW,NW) gives a transparent
  fringe of that terrain coming in from that side. `shore` adds foam and is used on water tiles.
  - Road ids `dirt_road|gravel_road|cobblestone_road`: `variant` = 8-bit neighbour mask.
  - River ids `clear_river|icy_river|muddy_river|lava_river`: `variant` = 4-bit mask (N,E,S,W), `frame` 0..3.
  - The 13 magic-terrain overlay ids: `variant` 0..1, `frame` 0..1.
  - `shroud` (unexplored, opaque) and `fog` (explored but not visible, 50%): `variant: 'full'`
    (default) or an 8-bit mask of hidden neighbours. The mask version gives soft gradient edges
    to draw on visible tiles next to hidden ones.
- **drawTerrainTile(ctx, x, y, size, info)**: `info = { terrain, variant?, seed?, frame?,
  neighbors?: (terrainId|null)[8] in DIRS8 order, road?: id|index, roadMask?, river?: id|index,
  riverMask?, overlay? }`. It draws the base tile (variant picked from `seed` or x,y when absent),
  then fringes of neighbours that rank higher in `TERRAIN_PRIORITY`, then river, road and overlay.
  A corner fringe is skipped when one of its sides already brings in the same terrain.
  With the asset-pack layer on (`setTerrainPackPainter`, wired by `index.js`), the base tile and each
  fringe are filled with the terrain's ground texture (the procedural fringe is used as alpha mask);
  water, rivers, roads, overlays and shroud stay procedural.
- **object**: every id in `src/data/mapObjects.js` (398). `frame` 0..3 animates windmills, water
  wheels, sawmills, campfires, portals, whirlpools, flags and buoys. `playerColor` draws an
  ownership flag only on flaggable objects: categories mine, dwelling and town, plus effect types
  `mine|dwelling|shipyard|lighthouse|garrison|town`.
  - `town` / `random_town`: `variant` = faction id gives 11 silhouettes (towers, trees,
    spires/onion domes, spikes, caves, tents, pagodas, crystal domes, ship, smoke-stacks).
    `state` = `village|fort|citadel|castle` adds walls, corner towers and a keep.
  - Dwellings are painted in their faction's style with the creature they recruit standing at
    the door.
- **building**: every id in `src/data/buildings.js` (234). `variant` = faction id, used for common
  buildings (default: the building's own faction, else `castle`). Painted by `kind`:
  - `hall`: 4 growing levels, golden dome for the capitol.
  - `fort`: walls with 2 to 4 towers, plus a keep from citadel up.
  - `dwelling` / `horde`: faction-style house with the creature drawn in front; upgraded ones
    get a pennant.
  - `mage_guild`: 1 to 5 stacked storeys with a glowing orb.
  - `tavern`, `blacksmith`, `market`, `silo` (shows the faction's silo resources), `shipyard`.
  - `special`: chosen by keyword (lighthouse, pond/fountain, library/academy, vortex/portal,
    obelisk, treasury...).
  - `grail`: golden monument per faction.
- **getTownLayout(factionId)**: covers every common and faction building. Upgrade chains share an
  anchor and grow (halls, forts, mage guilds, dwelling and upgraded dwelling). z values are
  unique (`baseline*10 + sub`) and are the draw order. To show a town, draw each *built* building
  (only the highest of a chain) sorted by z at `{x,y}` with `size: h`, on top of `getSprite('town', f)`.
- **town**: faction id → backdrop (sky, sun or moon, far mountains or mesas, ground, faction
  props: lava rivers, graves, mangroves, sea and palms, chimneys, cave ceiling, floating islands).
- **artifact**: every artifact id. Base by slot. Name keywords pick sword, axe, flail, trident,
  staff, shield, helm, crown, hat, skull, armour, rib cage, cloak, wings, boots, ring, glove, eye,
  amulet, teeth necklace, orb, tome, vial, bow, arrows, clover, cards, hourglass, spyglass, sack,
  cart, horn, compass, feather, grail and more. War machines reuse their creature sprite.
  Background tile and pips show the class (treasure, minor, major, relic, combo).
- **spell**: every spell id. School colour tile, one of 27 effect glyphs (bolt, flame, ice, rock,
  skull, arrow, shield, mirror, dispel, ankh, heart, up/down arrow with stat badge, wing, snail,
  eye, spiral, chain, portal, boat, wave, wall, mine, quake, clone, elemental, star), and
  level pips.
- **skill**: the 29 secondary skills plus `attack|defense|power|knowledge`.
  `state` or `variant` = `basic|advanced|expert` or 1..3 sets the bronze/silver/gold border and
  stars; 0 means plain.
- **resource**: the 7 resources plus `movement`, `mana`, `experience`, `gold_pile`, and
  `morale` / `luck` with `variant` -3..+3 (1 to 3 green/red pips, neutral bar for 0).
- **ui**:
  - Panels: `panel_parchment|stone|gold|dark` (48x48, 9-slice border 14).
  - Buttons: `button` (96x32, 9-slice border 10) and `button_round`, with `state`
    `normal|hover|pressed|disabled`.
  - Scrolling and checkbox: `scrollbar_track`, `scrollbar_thumb`, `scroll_up`, `scroll_down`,
    `checkbox` (`state: 'checked'`).
  - Arrows and actions: `arrow_left|right|up|down`, `close`, `ok`, `cancel`.
  - Animated: `hourglass` (4 frames), `flag` (playerColor, 4 frames).
  - Cursors: `cursor_arrow|sword|horse|boot|bow|spell|question|hand|anchor|no|town|trade|hero|attack|wait`.
  - `hex` (44x50), `state`: `grid|move|attack|target|active|hover|shade|blocked`.
  - `path_arrow` (`variant` = DIRS8 direction) and `path_dest` (X), `state`:
    `reachable` (green, default), `unreachable` (red), `next` (yellow, next turn).
  - Map markers: `grid_cursor`, `selection`.
  - `slot_empty` (`variant` = artifact slot silhouette), `divider`.
- **obstacle**: battlefield obstacles from terrain data (`tree, pine, dead_tree, mangrove, stump,
  boulder, bones, log, cactus, dune, shrub, reeds, pool, lava_pool, ice_block, stalagmite,
  mushroom, crystal`). `variant` = terrain id. Spell obstacles: `quicksand, land_mine,
  force_field, fire_wall`. Siege pieces: `wall, gate, tower, keep, moat`, with `variant` =
  faction and `state` = `intact|damaged|destroyed`.
- **effect**: 6-frame sequences (`frame` 0..5): `fire, lightning, ice, earth, magic, buff,
  debuff, heal, summon, control, dispel, resurrect, death, teleport, explosion, hit, block,
  poison, morale_good, morale_bad, luck_good, luck_bad, level_up`. A spell id also works (mapped
  through `effectForSpell`). Projectiles are single-frame and fly right (`facing: -1` mirrors):
  `arrow, bolt, fireball, rock, cannonball, magic_missile, ice_shard, lightning_ray`.
  `drawDamageNumber` gives floating combat numbers.

## Implementation

| file | contents |
|---|---|
| `kit.js` | canvas factory, FNV hash + seeded rng wrapper, colour maths, outlined primitives (poly, blob, limb, taper, gradients, glow, star, flag) |
| `palette.js` | player, resource, school and class colours, per-faction painting palettes |
| `rigHumanoid.js` | parametric humanoid: armour, heads (skull, beast, bull, lizard, fish, golem, cyclops, visor), ~15 hats, 30 weapons, shields, feather/bat/fairy wings, tails, robes, ghost/smoke/flame legs, mounted mode |
| `rigBeasts.js` | quadruped (horse, wolf, boar, lion, bull, behemoth, lizard, eagle heads; riders; centaur torso; multi-head), dragon (bat, bone, ghost, butterfly, crystal), bird, serpent (naga, medusa, hydra, sea serpent, worm, couatl), dragonfly, spider, floating eye, treefolk, elementals, war machines and steam walkers |
| `creatures.js` | per-id spec table for all 190 creatures (upgrades inherit from their base and add trim, crests, halos, horns), pose and animation, death/hit tints |
| `heroes.js` | mounted hero / boat, portraits |
| `terrain.js` | tiles, edges, roads, rivers, overlays, shroud, compositor |
| `structures.js` | shared house, tower, tent, wall, tree, mountain, rock, crystal, cave, pool, temple and hull painters |
| `objects.js` | map-object painters by `shape` with id touches, decor, towns |
| `towns.js` | layouts, building painters, backdrops |
| `icons.js` | artifacts, spells, skills, resources |
| `ui.js` | ui kind and 9-slice / damage-number helpers |
| `combatFx.js` | obstacles, siege pieces, effects, projectiles |

Every creature has a hand-tuned spec. Unknown creature shapes still fall back to a shape-based
default rig. Every map object uses a dedicated shape or decor painter; the generic house fallback
in `objects.js` only applies to ids missing from the data.

## Checklist

- [x] all creatures in all states and frames render; 2-hex are double width - tests/gfx/gfx.test.js
- [x] hero figures (horse and boat) and 197 pairwise-distinct portraits - tests/gfx/gfx.test.js
- [x] terrain variants, edges, roads, rivers, overlays, shroud/fog, drawTerrainTile - tests/gfx/gfx.test.js
- [x] all 398 map objects, towns x 11 factions x 4 fort levels, ownership flags - tests/gfx/gfx.test.js
- [x] all buildings, town backdrops, getTownLayout coverage and unique z - tests/gfx/gfx.test.js
- [x] artifacts, spells, skills at every level, resources, morale/luck pips - tests/gfx/gfx.test.js
- [x] ui pieces in every state, obstacles and siege states, effects and projectiles - tests/gfx/gfx.test.js
- [x] cache identity, determinism after clearCache, distinct signatures, helpers - tests/gfx/gfx.test.js
