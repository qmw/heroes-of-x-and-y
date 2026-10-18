# Duelyst art layer (`src/gfx/duelyst/`)

The open-sourced game **Duelyst** (<https://github.com/open-duelyst/duelyst>, **CC0-1.0**) supplies
pixel-art units, icons, effects, battle maps, portraits and audio. This layer maps that art onto
H3online ids. The procedural sprites in `src/gfx/` stay the fallback for everything Duelyst has no
art for (adventure terrain, map objects, towns/buildings, a few artifacts).

Files:

| file | role |
|---|---|
| `assets/duelyst/` | unmodified CC0 files, only the subset the game uses (134 MB of the original 375 MB, see §1), `LICENSE` (CC0 text), `LICENSE-NOTE.md` |
| `tools/build-duelyst-manifest.mjs` | Node, no deps: parses every `.plist` atlas -> JSON manifests |
| `tools/png-lite.mjs` | minimal PNG decoder (Node `zlib`) used to measure standing bounds |
| `assets/duelyst-manifest/*.json` | generated manifests (committed; fetched by the browser) |
| `src/gfx/duelyst/plist.js` | XML plist parser + cocos2d atlas helpers (pure) |
| `src/gfx/duelyst/mapping.js` | mapping tables (creatures, heroes, spells, artifacts, skills, ...) |
| `src/gfx/duelyst/index.js` | runtime loader: synchronous canvases, lazy sheets |
| `src/gfx/duelyst/audioMap.js` | game events / contexts -> sfx & music URLs |
| `tests/gfx/duelyst.test.js` | tests |
| `gallery-duelyst.html` | human review page (`npm start`, open `/gallery-duelyst.html`) |

## 1. Inventory (shipped subset)

Only files the runtime can reach are shipped (pruned 2026-10-18 from the full 375 MB release to
134 MB, 1774 files). Kept: 1x sheets only (no `@2x`); every unit referenced by `CREATURE_SPRITES`,
every hero-class pool (`HERO_CLASS_UNITS`) and `HERO_OVERRIDES`; every icon in the icon tables and
`ARTIFACT_RULES`; all fx sheets (kind `effect` accepts raw `fx_*` names); every portrait in
`HERO_FACTION_PORTRAITS`; the `BATTLEFIELDS` layers; the `UI_ASSETS` / `FACTION_CRESTS` files; the
`SFX_MAP` / `MUSIC_MAP` audio. Removed: all `@2x` files, unused units/icons, `generals/` splash art,
other `maps/` and `scenes/`, unmapped sfx, and the whole `card_backgrounds/`, `particles/`, `runes/`,
`modifiers/` folders. To map new art (e.g. another unit or sound), copy it from the upstream repo
(`app/resources/`) and re-run the manifest tool.

| folder | content (shipped) | used for |
|---|---|---|
| `units/` | 365 sprite sheets + plist (`f1_` Lyonar ... `f6_` Vanar, `neutral_`, `boss_`); animations `breathing` (idle loop), `idle` (flourish), `run`, `attack`, `hit`, `death`, `cast*`, `projectile` (some use `hurt`/`damage`/`die`/`breathe`/`move`) | creatures, hero figures |
| `icons/` | 175 animated 48x48 icons (`artifact_*`, spell icons `icon_f*`, `bossspell_*`, `generalspell_*`) | spells, artifacts, skills, stats |
| `fx/` | 209 effect sheets (all) | spell / combat effects |
| `maps/` | layers of 8 `battlemapN` + abyssian/redrock/shimzar/vanar battle maps | battlefields |
| `profile_icons/` | painted 200x200 portraits of the portrait pools | hero portraits |
| `sfx/` (82), `music/` (22) | m4a audio | `audioMap.js` |
| `ui/`, `tiles/`, `crests/`, `generals/` (2 portrait borders), `scenes/` (2 backgrounds) | neutral UI pieces, hex tiles, faction crests | listed in `UI_ASSETS` / `FACTION_CRESTS` (optional) |

9 JPEGs are progressive (fine for browsers).

## 2. Manifest format (`node tools/build-duelyst-manifest.mjs`)

Re-run after changing `assets/duelyst/` (≈12 s; it lists whatever is on disk, so adding or removing files only needs a re-run; `--no-bounds` skips the PNG measurement,
`--assets`/`--out` override folders). Output in `assets/duelyst-manifest/`:

- `units.json`, `icons.json`, `fx.json`, `misc-atlases.json` (tiles/runes atlases; empty since the prune, not read at runtime):
  `{ version, kind, sheets: { <name>: { s, w, h, fw, fh, a, b? } } }`
  - `s` sheet path relative to `assets/duelyst/`, `w,h` sheet size, `fw,fh` dominant untrimmed frame size
  - `a`: `{ <anim>: [frame...] }`, frames ordered by index; a frame is `[x, y]` (untrimmed,
    unrotated, size fw x fh) or `[x, y, w, h, ox, oy, rot, sw, sh]` (trimmed: `ox,oy` = top-left
    of the trimmed rect inside the `sw x sh` source; `rot=1` = packed 90° clockwise, sheet region is `h x w`)
  - anim name = frame key minus sheet prefix and index (`f1_general_attack_003.png` -> `attack`; `''` = default strip)
  - `b` (units only): opaque bounding box `[x0,y0,x1,y1]` in source-frame coords, union of the
    `breathing` frames. Used to plant feet (`y1`) on the hex and to scale by real body size.
- `files.json`: lists for `generals, maps, profile_icons, crests, ui, modifiers, scenes,
  card_backgrounds, tiles, runes, particles` (`{f, w, h, x2?}`; `x2` = an `@2x` exists) and
  `sfx`, `music` (paths).
- `summary.json`: counts + skipped files (currently none).

cocos2d `offset` is the centre displacement with +y up; converted to top-left with
`ox = (sw-w)/2 + offX`, `oy = (sh-h)/2 - offY` (or `sourceColorRect` when present).

## 3. Mapping rationale (`mapping.js`)

Units were chosen by viewing contact sheets of every unit's idle frame, then enlarged shortlists.
Duelyst factions are colour-coded (f1 gold, f2 red, f3 sand/cyan, f4 purple, f5 green, f6 ice
blue), which gives each H3 town a coherent palette:

- **Castle** -> Lyonar (f1): lancers (pikeman/halberdier), archers, gryphinox griffin, warblade /
  sun pontiff knights, archdeacon/solarius priests, lion-riders (cavalier/champion), winged
  sun maidens (angel/arch angel).
- **Rampart** -> Vanar nature units: ice-dryad centaur, treants (dendroids), white stag (unicorn),
  neutral dwarves (golden hammer / gauntlet master), flaming-bow elf, winged skywing (pegasus),
  Magmar drogon / gold paragon dragon.
- **Tower** -> Vetruvian casters (dunecaster/orbweaver), genie-on-orb (windgiver), naga merc,
  stone/steel golems, Lyonar giants (kaiser gladiator / excelsious as titan), blue gremlin imps.
- **Inferno** -> Abyssian demons (creepy demon, daemon void/megafiend, demon of eternity), red
  imp, fire mages (gog/magog), fiery hounds, fire spirits (efreet).
- **Necropolis** -> skeleton ghoulie, crossbones skeleton, abyssian brutes (zombies), dervish
  ghost (wight), boss wraith/vampire/legion lich, chaos/gol dark knights, bone serpents (dragons).
- **Dungeon** -> lizard brutes (troglodytes), silverbeak/redsynja harpies, oculus/mindflayer eyes,
  snake-haired reshaper/white widow (medusas), taura minotaur, winged lion (manticore), flamewing
  and fire-wyrm dragons.
- **Stronghold** -> tribal goblins/orcs, tiger-rider (wolf rider), bloodletter / dark nemesis
  ogres, pteryx (roc), trinity wing (thunderbird), boulder hurler (cyclops), Magmar juggernaut
  (behemoth).
- **Fortress** -> Magmar lizard huntress/vindicator, tribal gnolls, cave croc/komodo basilisks,
  bulls (gorgons), dustwailer/dragonhawk wyverns, hydrax / abomination hydras.
- **Conflux** -> elementals (zephyr, waterelemental, ice golem, incinera, sun elemental, rune-sand
  golem, lava harbinger, chaos elemental, astral prime), fairies, zurael phoenix.
- **Cove** -> mercenary pirates, captain hankheart, orizuru crane (stormbird), water spirits
  (nymph/oceanid), crystal lizard + great protector (nix), luxignis / soul-stealer sea serpents.
- **Factory** -> halfling gunner/grenadier, trinketeer/artificer, khymera/ankylos armadillos,
  bots, sand burrower worms, flare slinger, koi (couatl), Vetruvian zodiac constructs (dreadnought /
  juggernaut).
- **Neutrals / war machines**: golems, leprechaun (mr gold mclover), mummy dervish, fangarm
  (tentacled calculator), dragons (treat drake faerie, white wyvern crystal, boreal juggernaut
  azure, frost drake storm drake); war machines use mechs/gunners/obelisk/healer/cart stand-ins.

Upgrades: either a second related unit, or the same unit with `tint` (13 creatures: royal griffin,
centaur captain, wood elf, silver pegasus, ghost dragon, wolf raider, orc chieftain, firebird,
ayssid, crimson couatl, juggernaut, nomad, rust dragon). 2-hex creatures get a double-width canvas
and a 1.2x default scale; big monsters have explicit `scale`. No two creatures/heroes share
unit+tint (tested).

**Heroes**: `HERO_CLASS_UNITS` gives each of the 22 classes male/female pools of general-like
units of the matching Duelyst faction; heroes take the least-used unit of their pool; a reused
unit gets a `HERO_TINTS` colour (22 heroes tinted). `HERO_OVERRIDES` pins a few famous heroes.

**Portraits**: painted `profile_icons/` grouped per town mood and gender
(`HERO_FACTION_PORTRAITS`). Each hero takes the least-used portrait; reuse n>0 gets variant n:
odd variants are mirrored, and every variant > 0 gets a colour wash from `PORTRAIT_WASHES`
(image+variant unique per hero, tested; 102 heroes see an untouched portrait, 95 a variant).
Duelyst has few human male faces, so some heroes get masked/beast portraits.

**Spells**: `SPELL_ICONS` (98/98) by name/school (air = lightning/wind icons, fire = red Songhai
icons, water = Vanar ice, earth = Magmar/Vetruvian sand, curses = Abyssian purple);
`SPELL_FX` + `SPELL_FX_DEFAULTS` (category x school) give every spell an effect animation.
`COMBAT_FX` covers generic hits (slash, claw, blunt, arrow, blood, explosion, heal...).

**Artifacts**: only 57 artifact icons exist, so `ARTIFACT_RULES` (keyword first, slot second)
picks an icon and reuse adds an `ARTIFACT_TINTS` tint (unique icon+tint, tested). War-machine
artifacts reuse the creature unit. Skills (29/29), resources (gold, gems, crystal, mercury, ore)
and stats (attack, defense, power, knowledge, morale, luck, mana, hp, movement) map to icons.

**Battlefields** (`BATTLEFIELDS`, layered background/midground/foreground): grass bm5, highlands
bm0, swamp bm1, sand bm2, rough bm3, ship bm4, rock bm7, subterranean bm6, dirt shimzar, snow
vanar, lava redrock, wasteland abyssian.

### Fallbacks (asset packs, then procedural)

Most gaps below are now filled by the asset-pack layer (`docs/mechanics/asset-packs.md`): 32 of the 39
artifacts, `wood` / `sulfur`, the `defeat` sound, adventure terrain textures, and ballista / catapult /
cannon (whose Duelyst stand-ins are skipped). The list is kept as the record of what Duelyst lacks.

- Artifacts (39): boots/feet (`sandals_of_the_saint`, `dragonbone_greaves`, `dead_mans_boots`,
  `boots_of_*`, `wayfarers_boots`, `trailblazers_boots`, `pathfinders_legacy`), cloaks/shoulders
  (`dragon_wing_tabard`, `vampires_cowl`, `surcoat_of_counterpoise`, `cape_of_*`,
  `recanters_cloak`, `everflowing_crystal_cloak`, `cloak_of_gales`, `cloak_of_the_undead_king`,
  `diplomats_cloak`), bows (`bow_of_elven_cherrywood`, `bowstring_of_the_unicorns_mane`,
  `golden_bow`, `bow_of_the_sharpshooter`), legion parts + `statue_of_legion`,
  `spirit_of_oppression`, `hourglass_of_the_evil_hour`, `stoic_watchman`, `shackles_of_war`,
  `inexhaustible_cart_of_lumber`, `demons_horseshoe`, `cartographers_compass`,
  `mariners_astrolabe`, `merchants_scales`.
- Resources `wood`, `sulfur`; all adventure terrain, map objects, towns, buildings, obstacles.
- Audio: `defeat` sfx (no fitting sound).
- Weak matches worth a human look in the gallery: war machines (no siege engines in Duelyst),
  troglodytes (lizard brutes), satyr (piper zenrui), pegasus (winged white beast), couatl (koi),
  gremlins (blue imps), sea_dog (duelist hsuku). Music contexts were chosen by track name only.

## 4. Runtime API (`src/gfx/duelyst/index.js`)

```js
initDuelyst({ baseUrl = 'assets/duelyst/', manifestUrl = 'assets/duelyst-manifest/', onProgress,
              loadImage?, fetchJson?, createCanvas? }) -> Promise<{units, icons, fx}>   // manifests only
configureDuelyst({ loadImage, fetchJson, createCanvas, maxCache })
getDuelystSprite(kind, id, opts) -> canvas | null      // SYNC
getDuelystSpriteInfo(kind, id, opts) -> { width, height, anchorX, anchorY, frames } | null
getAnimationInfo(kind, id, state) -> { frames, fps, loop, anim } | null
hasDuelystSprite(kind, id) -> boolean
onSpriteReady(listener) -> unsubscribe          // called after each sheet/image finishes loading
preloadSprites([[kind, id], ...]) -> Promise<number>
getBattlefieldBackground(terrainId) -> url       // arena layer; getBattlefieldLayers -> {background, midground, foreground[]}
getPortraitUrl(heroDefId) / getPortraitStyle(heroDefId) / getPortraitCanvas(heroDefId, size, opts)
```

Kinds: `creature`, `hero`, `portrait`, `spell`, `artifact`, `skill`, `resource`, `stat` (also
`ui` with stat ids), `effect` (spell id, `COMBAT_FX` key or raw `fx_*` sheet).

`opts = { size, frame, frames?, time?, facing (1|-1|'left'|'right'), playerColor, state, tint,
tintAlpha, box?, minBody?, snap?, placeholder?, flag?, fit? }`

`minBody` enlarges short sheets to a body height; `snap: true` rounds enlargements of 1.75x+ to whole
pixel factors (max 3x) - used by the combat screen so big units are not unevenly pixelated.

- `state`: `idle` (Duelyst `breathing`), `move`/`walk` (`run`), `attack`/`shoot` (`attack`),
  `cast`, `hit`/`defend` (`hit`/`hurt`/`damage`), `dead` (`death`; no `frame` -> last frame =
  corpse), `flourish` (Duelyst `idle`). Loops for idle/move, clamps for the others.
- `frame` is wrapped/clamped to the animation length; `frames` (the caller's own frame count)
  rescales proportionally; `time` (seconds) picks `floor(time*12)`.
- Geometry matches the procedural creature contract: height = `size`, width = size (2x for 2-hex),
  feet at `(w/2, 0.92h)`; `box = {w,h,ax,ay}` overrides it. Pixel art: `imageSmoothingEnabled =
  false`; Duelyst art faces right, `facing -1` mirrors around the anchor.
- `playerColor`: ellipse ring under units; heroes also get a small flag; portraits a border.
- Lazy loading: the first call returns a cached (blank or `placeholder`) canvas and starts loading
  the sheet; when it arrives the same canvas is repainted and `onSpriteReady` listeners fire. If a
  sheet fails, the id is marked broken: later calls return `null` (-> procedural).
- Cache: LRU of 3000 canvases (configurable).

## 5. Wiring patch for `src/gfx/index.js` (owner: gfx agent)

```js
// imports
import { getDuelystSprite, getDuelystSpriteInfo, getAnimationInfo } from './duelyst/index.js';

// first lines of getSprite(kind, id, opts):
export function getSprite(kind, id, opts) {
  const d = getDuelystSprite(kind, id, opts);
  if (d) return d;
  ...procedural path unchanged...
}

// first lines of getSpriteInfo(kind, id, opts):
  const di = getDuelystSpriteInfo(kind, id, opts);
  if (di) return di;

// first lines of getFrameCount(kind, id, state):
  const a = getAnimationInfo(kind, id, state);
  if (a) return a.frames;
```

and once at startup (e.g. `src/main.js`, before the first screen; failures just keep procedural):

```js
import { initDuelyst, onSpriteReady } from './gfx/duelyst/index.js';
initDuelyst().catch((e) => console.warn('Duelyst art unavailable', e));
onSpriteReady(() => requestRedraw());   // adventure map / combat canvas repaint
```

Optional: pass `placeholder: () => proceduralCanvas` to show the procedural sprite while the sheet
loads. Combat should use `getBattlefieldLayers(terrain)` for the background and
`getSprite('effect', spellId, { state, frame })` for spell animations.
`tools/serve.mjs` has no MIME types for `.jpg`/`.m4a` (`image/jpeg`, `audio/mp4`); browsers sniff
them, but adding the two entries is recommended.

## 6. Audio (`audioMap.js`)

`getSfxUrl(event, { index?, baseUrl? }) -> url | null`, `getMusicUrl(context, { baseUrl? }) ->
url | null`, `musicContextFor({ screen, terrain, faction })`, `meleeSfxForShape(shape)`,
`SFX_EVENTS`, `MUSIC_CONTEXTS`. Event names include the synth names in `src/ui/audio.js`
(`click hover error coin chest sword arrow spell levelup daystart build recruit move victory`;
`defeat` -> null) plus `purchase treasure artifact melee_{swing,blade,blunt,claw,bite,magic,heavy}
hit arrow_hit cannon spell_{air,earth,fire,water,all,heal,buff,debuff,summon,teleport,resurrect}
death death_{beast,undead,large,flyer} dialog_open ...`. Lists cycle to avoid repetition.
Music contexts: `main_menu new_game credits encyclopedia adventure adventure_<terrain>
town_<faction> combat combat_alt combat_siege combat_boss victory defeat loot`.

## 7. Licensing

All files under `assets/duelyst/` are CC0-1.0 (public domain dedication) from
open-duelyst/duelyst (an unmodified subset: only the files the game uses); see `assets/duelyst/LICENSE` and `LICENSE-NOTE.md`. No attribution is
required; the note keeps provenance traceable. The generated manifests are derived data.

## Checklist

- [x] plist parser, rotated/trimmed frame math — tests/gfx/duelyst.test.js
- [x] manifest covers all atlases, frames inside sheets — tests/gfx/duelyst.test.js
- [x] creatures 190/190, unique unit+tint — tests/gfx/duelyst.test.js
- [x] heroes 197/197 figure + distinct portrait variant — tests/gfx/duelyst.test.js
- [x] spells 98/98 icon + effect, artifacts 152/192, skills 29/29 — tests/gfx/duelyst.test.js
- [x] battlefields for every terrain, UI files exist — tests/gfx/duelyst.test.js
- [x] audio map files exist, lookup/fallback — tests/gfx/duelyst.test.js
- [x] sync canvas + deferred paint, tint, placeholder, broken sheet, anim info — tests/gfx/duelyst.test.js
