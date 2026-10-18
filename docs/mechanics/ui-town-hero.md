# Town, hero, kingdom screens and their dialogs (`src/ui/screens/{town,hero,kingdom,dialogs}`)

Front end of the town / hero / economy engines. Follows `docs/mechanics/ui.md` (ctx, kit, class
prefixes `town-` / `hero-` / `kng-`). Every state change is an engine call through
`ctx.act(...)` (wrapped by `act()` in `town/dialogUtil.js`, which also runs `ctx.resolvePendings()`
when the action queued choices); screens and open dialogs re-render from the state on `ctx.onState`.

```
town/index.js        town screen  (showScreen('town', {townId}))
town/townModel.js    pure helpers: building -> window, hall cards, layout, growth rows, recruit options, rumours ...
town/hall.js         Town Hall (build) window + building detail / info nodes
town/special.js      Shipyard, Skeleton Transformer, Castle Gate, building info, stack window (upgrade / dismiss)
town/dialogUtil.js   liveDialog (state-driven dialog), act, serviceHero, CSS injection, townThumb
town/town.css        town screen + all town dialogs
hero/index.js        hero screen  (showScreen('hero', {heroId, allowCast?, onSpell?}))
hero/heroModel.js    pure helpers: bonus breakdowns, morale lines, exp, artifact moves, quest log
hero/levelUp.js      `level_up` pending renderer (registered on import)
hero/hero.css        hero screen, level-up, exchange, spell book
kingdom/index.js     kingdom overview (showScreen('kingdom', {playerId?, tab?}))
dialogs/recruit.js   openRecruit(ctx, townId, creatureId, {target}), openFort(ctx, townId)
dialogs/marketplace.js  openMarketplace(ctx, {townId?, extraMarkets?, tab?})  (trade + send to player)
dialogs/tavern.js    openTavern(ctx, townId) -> heroId | null
dialogs/thievesGuild.js openThievesGuild(ctx, playerId?), thievesGuildModel(state, playerId)
dialogs/mageGuild.js openMageGuild(ctx, townId) (+ buy spell book), spellInfo()
dialogs/blacksmith.js openBlacksmith(ctx, townId)
dialogs/artifactMerchant.js openArtifactMerchant(ctx, townId) (buy / sell for any resource)
dialogs/university.js openUniversity(ctx, townId)
dialogs/altar.js     openAltar(ctx, townId) (Grotto: creatures / artifacts -> experience)
dialogs/trade.js     openFreelancers(ctx, townId) (Freelancer's Guild)
dialogs/heroTrade.js openHeroTrade(ctx, heroAId, heroBId); `hero_exchange` pending renderer
dialogs/spellbook.js openSpellbook(ctx, heroId, {allowCast, kind, onCast}) -> {spellId, result | needsTarget} | null
```

## Town screen (1280x720)

- **View** (top-left, 800x374 logical, scaled x1.25): backdrop = gfx `town` sprite of the faction
  (CSS gradient fallback without gfx); every built building (`town.buildings`, newest of each chain)
  as a `building` sprite (`variant` = faction, size = layout height) placed by
  `gfx.getTownLayout(faction)` (looked up for the building or any predecessor in its chain);
  buildings the layout does not know go to a fallback grid. Between backdrop and buildings an
  ambient layer (`town/scenery.js`, original procedural art, seeded per town): a path to the fort gate
  plus a branch, faction props (trees, pines, palms, mangroves, rocks, graves, stalagmites, mushrooms,
  crystals, cacti, reeds, crates...) on free ground - they avoid *built* buildings only, so young towns
  look lived-in -, faction banners waving, campfires with smoke and drifting motes (fireflies, embers,
  snow, wisps, spores, sparkles, dust, soot, birds) at ~15 fps.
  Per-faction no-prop areas (`NO_PROPS`: the fortress pond, the cove shore) stay clear. Un-built building sites (chain roots of
  the layout not built yet) are invisible boxes that show a dashed outline and "X - not built" on
  hover; a click opens the Town Hall. Hover = gold highlight + name label +
  tooltip (name + effect lines); click opens the building's window (`buildingAction`); right-click
  holds the building info.
- **Side panel**: town name, faction, owner, hall + fort level, daily town income, *creature growth*
  panel (all 7 tiers via `tierRows`; tiers without a dwelling are greyed "dwelling not built"; one row
  per built dwelling and the Portal of Summoning: available / weekly growth; click =
  recruit window, right-click = creature card).
- **Bottom**: garrison row + visiting row (shared `ArmyRow` selection: click / drag to move, swap,
  merge; shift-click = split; click the selected stack or double-click = stack window with
  **Upgrade** (`upgradeStack`) and **Dismiss**), hero portraits (click = hero screen), **Swap**
  (`swapTownHeroes`). Buttons: Build (hall), Fort, Marketplace, Tavern, Mage Guild, Thieves' Guild,
  Hero, < Town / Town > (player's towns, `replace` navigation), Exit (`ctx.back('adventure')`).
  Resource bar with daily income tooltips.
- Towns not owned by the player to move are read-only (building clicks show info only).

### Building -> window (`buildingAction`)

| building | window | engine |
|---|---|---|
| halls | Town Hall: one card per chain frontier (next step), state built / can build / built today / not enough resources / missing requirements (+ names) / no water / capitol exists / no grail; detail with description, effects, cost, **Build** | `getAvailableBuildings`, `build` |
| fort / citadel / castle | Fort: all dwellings, click to recruit, **Recruit all** | `getRecruitInfo`, `recruitAll` |
| dwelling / horde | Recruit: base + upgraded creature (leftover base stock), slider + stepper, Max, total cost, target garrison / visiting | `recruit` |
| mage guild | spells per level; buy spell book for the hero in town | `getMageGuildLevel`, `town.mageGuild`, `buySpellbook` |
| tavern | 2 heroes, details, hire, rumour, link to the Thieves' Guild | `getTavernHeroes`, `hireHero` |
| marketplace | trade with slider of lots at `getMarketRate`, Max; send resources to another player | `marketTrade`, `sendResources` |
| blacksmith | war machines for sale, owned / buy | `getWarMachinesForSale`, `buyWarMachine` |
| shipyard | build a boat | `buildBoat` |
| Artifact Merchants | buy (any resource) / sell visiting hero's artifacts | `getArtifactMerchantOffers`, `buyArtifact`, `sellArtifact` |
| Freelancer's Guild | sell a stack (whole lots) for a resource | `sellCreatures` |
| Grotto (altar) | sacrifice creatures / artifacts for experience | `sacrificeCreatures`, `sacrificeArtifact` |
| Skeleton Transformer | click a stack to transform | `skeletonTransformResult`, `transformToSkeletons` |
| Castle Gate | choose destination town, then the screen switches to it | `getCastleGateDestinations`, `useCastleGate` |
| Magic University | learn a magic school at Basic | `learnUniversitySkill` |
| Portal of Summoning | recruit window of `town.portal` | `recruit` |
| buildings with `thieves_guild` only | Thieves' Guild table | `getThievesGuildInfo` |
| Mana Vortex | info (used this week?) | - |
| everything else | info (description + effect lines) | - |

Keys: Esc / Enter exit, B hall, F fort, M marketplace, T tavern, G mage guild, H hero, S swap heroes,
Left / Right (PageUp / PageDown) previous / next town.

## Hero screen

Portrait, name, "Level N Class", specialty, experience bar (`expForLevel`), the four primary skills
(effective value from `getPrimary`; tooltip = base + every `primary` bonus with its source from
`getHeroBonuses`), morale / luck pips (tooltips = `getArmyMoraleDetails/LuckDetails` items with
readable sources), spell points (with regeneration), movement, 8 secondary-skill slots (tooltip and
right-click: current level description + next level), artifact paper doll + backpack
(`ArtifactGrid`: click-click moves; `moveArtifact` composes `equip` / `unequip` for one hero,
including ring/misc swaps and backpack reordering; double-click = assemble (combos containing the
item) / disassemble; **Assemble** button lists `getAssemblableCombos`), army row (move / merge /
split via `tradeArmy(hero, hero)`; stack window with Dismiss), buttons Spell book (C), Quest log (Q),
Assemble, Dismiss stack (Del), Dismiss hero (`dismissHero`, then next hero or back), < Hero / Hero >
(Left / Right), Close (Esc / Enter).

**Spell book**: `SpellbookView` with school / kind tabs, cost at the hero's mastery
(`getAdventureSpellCost` when the adventure engine is loaded), description at the hero's mastery.
With `allowCast` (hero screen default when the hero belongs to the player to move and a map exists)
clicking an adventure spell calls `adventure.castAdventureSpell(state, heroId, spellId)`;
Dimension Door returns `{spellId, needsTarget: true}` without casting (the adventure screen picks
the tile). The hero screen passes the outcome to `params.onSpell(outcome)` and goes back to the
adventure map when a target is needed. Town Portal at Advanced+ queues the adventure engine's own
`town_portal` pending.

**Quest log**: map objects with `data.quest` that the player (`player.visited[objId]`) or hero
visited, with the quest text.

## Hero exchange

`openHeroTrade(ctx, heroAId, heroBId)`: both heroes (portrait, class, primaries, mana, skills),
paper doll + backpack and army each, sharing one army selection and one artifact selection, so
everything moves both ways: armies with `tradeArmy`, artifacts with `tradeArtifact` (other hero:
`dest = {slot,index}` or `{backpack: true}`) or `moveArtifact` (same hero). The `hero_exchange`
pending (adventure engine, two friendly heroes meet) opens it through `registerPendingRenderer`.

## Level-up dialog

Custom renderer for `level_up` (registered when `hero/levelUp.js` is imported — the town and hero
screens import it; **the adventure screen should `import '../hero/levelUp.js'` and
`'../dialogs/heroTrade.js'`** so the renderers exist before its first `resolvePendings()`).
Portrait, "X has gained a level / is now a level N Class", primary skill gained (only when the
pending carries `data.primary` — see gaps), current primaries, the 1-2 secondary-skill options as
big icons with level names and descriptions; select then OK (digits 1/2 pick, double-click picks
and confirms); not dismissable.

## Kingdom overview

`getKingdomOverview` + `flaggedObjects` (owned map objects of category `mine` / `dwelling`).
Header: player, hero / town / mine / dwelling counts, week. Tabs (1/2/3): **Heroes** (portrait, class,
level, location, mana, movement, effective primaries, army; Open = hero screen, Go to =
`showScreen('adventure', {heroId, focus})`), **Towns** (thumbnail, hall / fort / guild, built
today or how many buildings can be built, stock + weekly growth per creature, garrison; Open = town
screen), **Income & holdings** (daily income by source towns / mines / heroes + total, mines and
dwellings by type, army strength, marketplaces, thieves' guild level, score).
  With few rows (heroes <= 4, towns <= 3) the lists switch to roomy cards (bigger portraits / army,
  hero skills) followed by a kingdom summary strip.

## Engine API gaps found (worked around in the UI)

- No engine action to **dismiss a stack** (hero screen / town rows): the UI uses
  `townModel.dismissStack(army, slot, isHeroArmy)` inside `ctx.act` (keeps the last-stack rule).
- No engine action to **reorder the backpack** or move an artifact between two equipped slots of
  one hero: `heroModel.moveArtifact` composes `equip` / `unequip` (with rollback).
- The `level_up` pending does not record **which primary skill was gained** (`data.primary`); the
  `hero_level_up` event has it. The dialog shows it when `data.primary` exists.
- Town engine actions do not check that the acting player is the **player to move** (only that the
  town has an owner); the UI makes non-owned towns read-only.
- The tavern pool is only filled by `createGame` / weekly refresh (`ensureTavernPool` is not called by
  `getTavernHeroes`); a town created another way shows "No heroes for hire" until then.

## Checklist

- [x] town screen mounts / unmounts for all 11 factions, starting and fully built towns; every built building opens a window — tests/ui/screens-town-hero.test.js
- [x] town view uses gfx `getTownLayout` + backdrop when gfx is present, grid fallback otherwise — tests/ui/screens-town-hero.test.js
- [x] hall: card states (available / built today / missing requirements / not enough resources), build through the engine, view re-renders — tests/ui/screens-town-hero.test.js
- [x] recruit from the growth panel (garrison) and via the dialog API (visiting hero) — tests/ui/screens-town-hero.test.js
- [x] garrison / visiting stack moves, swap heroes — tests/ui/screens-town-hero.test.js
- [x] marketplace trade (API + DOM, Max) — tests/ui/screens-town-hero.test.js
- [x] tavern hire — tests/ui/screens-town-hero.test.js
- [x] thieves' guild model — tests/ui/screens-town-hero.test.js
- [x] hero screen: paper doll moves, primary breakdown, morale value, skills, army split — tests/ui/screens-town-hero.test.js
- [x] hero screen for a hero of every class, next hero, dismiss hero — tests/ui/screens-town-hero.test.js
- [x] spell book browse + description — tests/ui/screens-town-hero.test.js
- [x] level-up renderer resolves the pending with the chosen skill — tests/ui/screens-town-hero.test.js
- [x] hero exchange (armies + artifacts both ways) and the `hero_exchange` pending — tests/ui/screens-town-hero.test.js
- [x] kingdom overview (3 heroes, 2 towns, income), open town, next town — tests/ui/screens-town-hero.test.js
- [ ] visual polish of the windows in a real browser (layout only checked structurally in Node)
- [x] town scenery plan (deterministic, avoids built buildings), 7-tier growth rows — tests/ui/visual-polish.test.js
