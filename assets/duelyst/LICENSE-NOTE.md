# Duelyst art and audio

Everything in this folder (`units/`, `generals/`, `icons/`, `fx/`, `tiles/`, `maps/`, `ui/`, `sfx/`,
`music/`, `crests/`, `profile_icons/`, `scenes/`) comes from the open-sourced game **Duelyst**:

- Source repository: <https://github.com/open-duelyst/duelyst> (`app/resources/`)
- License: **CC0 1.0 Universal** (public domain dedication). The full text, fetched from
  `https://raw.githubusercontent.com/open-duelyst/duelyst/main/LICENSE`, is in [`LICENSE`](./LICENSE).

The files are unmodified copies. Only the subset H3online actually uses is shipped (1x sheets of the
mapped units/icons, all effects, the mapped portraits, battle maps, UI pieces, sounds and music;
~134 MB of the original ~375 MB); the rest of the release is available upstream. H3online only reads them: `tools/build-duelyst-manifest.mjs` parses
the cocos2d `.plist` atlases into the JSON manifests in `assets/duelyst-manifest/` (generated, also
CC0 as a derivative of the atlas metadata), and `src/gfx/duelyst/` maps the art onto game entities.
See `docs/mechanics/duelyst-assets.md`.

CC0 does not require attribution; this note exists so the origin of the files stays traceable.
