# Art and audio credits

H3online's own graphics are drawn procedurally at run time (`src/gfx/`). On top of that it uses the
free third-party assets below. Every pack sits in its own folder under `assets/` next to its licence
file, holds only the files the game uses, and is mapped onto game ids in code (see
`docs/mechanics/duelyst-assets.md` and `docs/mechanics/asset-packs.md`). The same list is shown on
the in-game Credits screen (generated from `src/gfx/packs/registry.js`).

Licences were checked on the source pages on 2026-10-14. Apart from the project's own generated
art (first row, see `assets/generated/LICENSE.txt` and `docs/mechanics/generated-art.md`), only CC0
(public domain) and CC-BY (attribution) assets are used; nothing under share-alike / GPL / "personal use only" terms, and
nothing taken from commercial games.

| pack | author | source | licence | used for | folder |
|---|---|---|---|---|---|
| H3online generated art | the project author, made with OpenAI image generation via Codex CLI | <https://developers.openai.com/codex/cli> (tool; prompts in `tools/genart/`) | LicenseRef-Project-Generated: generated for this project with OpenAI image generation via Codex CLI; owned by the project author | adventure-map objects, towns and dwellings, town screens (backdrops and buildings), artifact icons without other art, war machines, hero boat | `assets/generated/` |
| Duelyst art and audio | Counterplay Games / open-duelyst | <https://github.com/open-duelyst/duelyst> | CC0 1.0 | creatures, hero figures, portraits, spell / artifact / skill icons, effects, battlefields, sound effects, music | `assets/duelyst/` |
| Tiny Texture Pack 1, 2 and 3 | Screaming Brain Studios | <https://opengameart.org/content/tiny-texture-pack-1>, <https://opengameart.org/content/tiny-texture-pack-2>, <https://opengameart.org/content/tiny-texture-pack-3> | CC0 1.0 | adventure-map ground textures (11 terrains; water stays procedural) | `assets/sbs-tiny-textures/` |
| 496 pixel art icons for medieval/fantasy RPG | Henrique Lazarini (7Soul1) | <https://opengameart.org/content/496-pixel-art-icons-for-medievalfantasy-rpg> | CC0 1.0 | artifact icons: boots, bows, tunic, golden armour, map, spyglass | `assets/7soul1-rpg-icons/` |
| Idylwild's Armory, Idylwild's Inventory | Idylwild | <https://opengameart.org/content/idylwilds-armory>, <https://opengameart.org/content/idylwilds-inventory> | CC0 1.0 | artifact icons: cloaks, hood, greaves, chain, Legion armour pieces; wood and sulfur resource icons | `assets/idylwild-icons/` |
| [LPC] Siege Weapons | bluecarrot16 (commissioned by castelonia) | <https://opengameart.org/content/lpc-siege-weapons> | CC-BY-4.0 (the page also offers CC-BY 3.0, OGA-BY 3.0, GPL 2/3; we use CC-BY 4.0) | combat war machines: ballista, catapult, cannon (animated); their artifact-slot icons | `assets/lpc-siege-weapons/` |
| Fantasy Sound Effects Library | Little Robot Sound Factory | <https://opengameart.org/content/fantasy-sound-effects-library> | CC-BY-3.0 | the "defeat" jingle (Jingle_Lose_00) | `assets/lrsf-fantasy-sfx/` |

## Required attributions (CC-BY)

- "[LPC] Siege Weapons" by bluecarrot16 - <https://opengameart.org/content/lpc-siege-weapons> -
  licensed under CC-BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>). Frames are cropped,
  layered and scaled at run time; the files are unmodified.
- Sound by Little Robot Sound Factory - <http://www.littlerobotsoundfactory.com> - "Fantasy Sound
  Effects Library", licensed under CC-BY 3.0 (<https://creativecommons.org/licenses/by/3.0/>). The
  file is unmodified (renamed to `jingle_lose_00.mp3`).

## Considered and not used

- Kenney "Medieval RTS", "Roguelike RPG pack", "Pirate Pack", "Tiny Battle", "Tiny Town",
  "Fantasy UI Borders", "UI Pack RPG Expansion" (all CC0): flat top-down / modern styles that do not
  match the map's 3/4 view or the Duelyst pixel art, so they would have looked worse.
- Duelyst battle-map backgrounds as town backdrops: wrong subject (arenas, sky islands).
- LPC terrain / other LPC art, "German catapult", Herodom's "Siege weapons": CC-BY-SA / GPL only.
- "Medieval Units" (itch.io, Citrus Games): no standard licence stated.
- "Medieval: Defeat Theme" (RandomMind, CC0): a 45 s music piece, too long for the defeat sting.
