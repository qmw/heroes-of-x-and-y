# Combat screen (`src/ui/screens/combat/`)

`showScreen('combat', { returnTo: 'adventure' })` plays the battle stored in `state.combat` (created by
hero.js `startCombat`). Optional params: `cs` (play a bare CombatState without a GameState),
`animSpeed: 0` (instant: no tweens, used by tests), `returnParams`, `returnTo: false` (stay),
`onFinish(result, summary)`.

| file | role |
|---|---|
| `index.js` | session: DOM, input, turn loop (human / AI), spell book, options, end flow; `getSession()` for tests |
| `model.js` | pure: layout, hex hit-testing, attack sectors, hover interpretation, preview / log texts, badges, result model |
| `view.js` | view model (pixel positions, displayed counts, anim states) + canvas renderer, background, siege pieces |
| `playback.js` | engine events -> animations (kit `playEvents`), one at a time, each logged |
| `audio.js` | Duelyst sfx / music through `gfx/duelyst/audioMap.js` when `Audio` exists, `ctx.audio` synth otherwise |
| `combat.css` | `cmb-` styles |

## Layout (1280×720)
Canvas 1280×560 (hex grid `w 60, rowH 44, origin (175, 52)`, hero figures at x 92 / 1188), turn queue
strip 56 px, control panel 104 px: Options, Surrender, Retreat, Auto | status line + combat log |
Spells, Wait, Defend + creature abilities / siege targets.

## Behaviour
- Background: Duelyst battlefield layers (`getBattlefieldLayers(terrain)`) when the images load,
  procedural terrain gradient otherwise. The arenas are painted for a much smaller board, so
  `view.js ARENA_FLOORS` records where each arena's floor lies (fraction of the 16:9 frame) and
  `arenaTransform` scales / moves both layers so the floor covers the 15x11 field (`fieldRect`,
  centred), never uncovering the canvas; battlemap5's blue pool gets a green colour wash on grass.
  The fitted arena is pre-rendered once (2x) with a soft darkening outside the field.
  Round arenas (`shape: 'ellipse'`: highlands, dirt, snow, lava) are scaled until the field's corners sit on
  the floor ellipse (8% tolerance) instead of fitting the bounding box.
  Grid lines are two-tone (dark + light) so they read on any floor. Grid (`showGrid`), movement shadow (`combatShadow`), cursor
  shadow (`combatCursorShadow`) and animation speed are in the Options dialog (settings keys).
- Stacks: `creature` sprites facing their side, body height `stackBodyHeight` = hex height x
  (1.3 + 0.08 x (tier - 1)), x1.2 for 2-hex units (Duelyst `minBody`), feet on the hex, contact
  shadow, nearest-neighbour scaling at whole-pixel positions; enlargements of 1.75x and more snap to whole
  pixel factors (2x / 3x max, Duelyst `snap` option) so every art pixel has the same size; count badge 13px on a dark plate at the
  front foot; depth-sorted with obstacles and siege pieces (walls /
  fixed parts / gate / towers / moat, states intact/damaged/destroyed from hp), corpses below, count badge
  coloured normal / buffed / debuffed / mixed (spell alignment). Active stack pulses.
- Hover (`interpretHover`): move (walk / fly cursor, both hexes of a 2-hex destination; a tail-only hex
  moves the head forward), attack (sword pointing along the approach chosen by the mouse sector around
  the hovered hex: the closest legal `fromHexes` footprint hex by angle), shoot (arrow, broken arrow when
  `damageModifiers` reports range / wall penalty), heal (tent), siege structure (catapult / Cyclops),
  cast and ability targeting, tactics placement. Status line: `Attack Pikeman (12-18 damage, 1-2 perish)`
  from `getAttackPreview`.
- Right button: creature card (`getStackInfo`: current stats, top creature hp, morale/luck, shots,
  retaliations, spells with rounds left) or hero box; cancels targeting first.
- Spells: book (`SpellbookView`, costs from `heroSpellCost`, reasons for disabled spells) → untargeted
  modes cast at once, stack modes highlight `getSpellTargets().stackIds`, area modes preview
  `getSpellAreaPreview` if exported, else the spell's radius / ring at the hero's mastery.
- Clicking the own hero opens the book, other heroes show an info box. Heroes are one general sprite
  (no flag) on a stone plinth ringed in the player colour, with a warm backlight and a name plate. Generals are brightened (canvas filter) and the
  hero class pools prefer humanoid generals (`HERO_CLASS_UNITS`, beastmaster / witch / barbarian).
- Turn queue: side-tinted tiles (red attacker / blue defender), cropped creature icons, the active
  stack larger; status line and log in larger, higher-contrast type.
- Keys: D defend, W wait, C cast, A auto, R retreat, Space skip animation / start battle (tactics),
  Esc cancel targeting / skip / options. A click while animating skips too.
- Turn loop: human sides (`cs.sides[side].isHuman`, auto-combat off) wait for input; AI sides (and auto)
  call `chooseAction` + `performAction` after a short delay; a failing action falls back to defend. The
  round cap is the engine's (`cs.maxRounds`, set by `hero.js startCombat` to `COMBAT_MAX_ROUNDS` = 100; a
  battle without one gets that value on mount): reaching it ends the battle as a defender win (`timeout`).
  Repeated AI failures hand the battle to `autoResolve(cs)`.
- Two-step spells (Teleport, Sacrifice: `getSpellTargets(...).target2`): the first click picks the stack
  (`__cast_step2`), the screen asks `getSpellTargets(cs, side, spellId, {stackId})` for the second targets
  (Teleport: destination hexes, highlighted; Sacrifice: victim stacks) and the second click casts with
  `{stackId, hex}` / `{stackId, victimId}`. Right-click / Esc cancels.
- Animations: move (path walk / fly arc / fade for teleport & tactics), attack & retaliation lunge,
  projectiles, damage flash + floating number, death anim / fade (summons), spell fx (`effect` sprite of
  the spell id), status buff/debuff fx, morale / luck, summon / resurrect / rebirth / heal, obstacle fade-in,
  tower shots, catapult shots, wall damage / destruction, round and end banners. Unknown events get a
  generic best-effort animation; handler errors never block.
- End: `finishCombat(state)` through `ctx.act` (when `state.combat.cs` is this battle), then the result
  dialog (casualties with sprites, experience, necromancy, captured artifacts, surrender gold), then
  `ctx.resolvePendings()` (level-ups), then `showScreen(returnTo || 'adventure', …, {replace: true})`; when the
  battle ended the game, the adventure screen shows the victory / defeat dialog with the score on mount. finishCombat runs before the dialog so it can show necromancy
  and captured artifacts (computed by the adapter).

## Gaps
- Two-step spells (Teleport: stack then hex) are not supported by the target UI.
- Hero figure has no separate portrait panel; the original's mini hero window is a text box.
- The hex grid is flat (squashed rows) while some arenas are painted in perspective (ellipses);
  floors are fitted by bounding box, so the field corners may overlap the ring of round arenas.
- Sprite animation frames run at real time while tweens follow the speed option.

## Checklist (tests/ui/screens-combat.test.js)
- [x] hit-testing, attack sectors, approach picking incl. 2-hex attackers
- [x] badge kinds, log texts, previews (attack / shoot / broken arrow / cast)
- [x] mount with a real combat, queue, buttons, info card
- [x] clicks → move / attack (sector) / wait / defend / shoot / cast; area preview; tactics phase
- [x] playback ordering with a manual clock, skip
- [x] auto-combat and AI loop termination; end flow through finishCombat and navigation
- [x] 50 seeded AI battles (incl. sieges) rendered with animation speed 0
- [x] arena floor fitting, unit scale by hex, hero plinth / name plate — tests/ui/visual-polish.test.js
