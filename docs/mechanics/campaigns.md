# Campaign mode (`src/engine/campaign/*`, `src/ui/screens/campaign/*`)

Story campaigns in the spirit of the original's: a chain of handcrafted scenarios with briefing texts, a starting
bonus choice per scenario, a main hero who carries his experience into the next map, and branches. **All content is
original** (world, place names, characters' stories, texts); the playable heroes are entries of the game's hero roster.
Tests: `tests/campaign/campaign.test.js` (engine), `tests/ui/campaign.test.js` (screens), e2e scenario `campaign`.

## 1. Files

| file | content |
|---|---|
| `src/engine/campaign/definitions.js` | `CAMPAIGNS` (data), `CAMPAIGN_DIFFICULTIES`, `DIFFICULTY_BY_LABEL` |
| `src/engine/campaign/maps/*.js` | ten handcrafted maps in the mapgen scenario format (`docs/mechanics/mapgen.md` §8) |
| `src/engine/campaign/maps/index.js` | `CAMPAIGN_MAPS`, `buildCampaignMap(id)` (built by the mapgen scenario builder, cached, fresh copy per call), `campaignMapInfo(id)` |
| `src/engine/campaign/index.js` | public API (§3) |
| `src/ui/screens/campaign/model.js` | pure helpers: progress persistence, card / briefing view models, map preview painter, `launchScenario` |
| `src/ui/screens/campaign/select.js` | screen `campaigns` |
| `src/ui/screens/campaign/briefing.js` | screen `campaignBriefing` |
| `src/ui/screens/campaign/campaign.css`, `css.js` | screen styles (prefix `cmp-`) |

## 2. Data

```
Campaign = { id, title, description, factions, difficulty: 'easy'|'normal'|'hard', heroDefId,
             carryOver: { artifacts, creatureStacks, creatureFraction }, start, scenarios: Scenario[] }
Scenario = { id, map, title, intro, outro, next: [scenarioId] /* 0 = finale, 2+ = branch */, choiceText?,
             bonuses: [Bonus x3] }
Bonus    = { type: 'artifact', artifactId } | { type: 'creatures', creatureId, count }
         | { type: 'resources', resources: {gold, wood, ...} } | { type: 'spell', spellId }
         | { type: 'experience', amount }            (optional `label` overrides the generated text)
```

Map rules (checked by `validateCampaigns()` and the tests): slot 0 is the human, starts with the campaign hero
(`heroes[0].defId === heroDefId`) and has that hero's faction; every special victory is
`appliesToAi: false` (only the player wins by the objective; computers win by conquest); every map validates with
`validateBlueprint`. Chokepoint guards use the scenario builder's `seal: true` (mapgen.md §8) so nobody slips past them.

### Campaigns

| campaign | hero | maps | carry-over |
|---|---|---|---|
| **The Saltwind Charter** (easy) | Leena (Cove) | Wreckers' Shore (S, capture Gullhaven) -> The Pearl Tithe (M, 50,000 gold within 112 days, lagoon + boat) -> Storm over Kelmar Sound (M, 3 players, defeat the fire-priest Calid; lose Leena = loss) | 3 artifacts |
| **Iron and Steam** (normal, branching) | Henrietta (Factory) | Cog Valley (S, capture Brasswick) -> **choice**: The Sandsea Expedition (M, acquire the Orb of the Firmament) **or** The Siege of Ashrun (M, defeat Nymus) -> The Last Furnace (M, 3 players, six obelisks, build the Grail within 168 days) | 4 artifacts, 2 strongest stacks at 50 % |
| **The Long Winter** (normal) | Sorsha (Castle) | Frostmarch (S, survive 42 days; lose Whitecairn = loss) -> The Dawn Chapel (M, acquire the Celestial Necklace of Bliss) -> The Thaw (M, 3 players, defeat all; lose Sorsha = loss) | 3 artifacts, strongest stack |

Factions on the maps: Cove, Fortress, Tower, Inferno, Conflux (neutral town), Factory, Stronghold, Dungeon, Castle,
Necropolis, Rampart (neutral town).

## 3. API (`src/engine/campaign/index.js`)

| function | notes |
|---|---|
| `listCampaigns()` | rows for a select screen (`length` = scenarios of one playthrough) |
| `getCampaign(id)`, `getScenario(c, id)`, `campaignLength(c)`, `describeBonus(b)` | throw on unknown ids |
| `createCampaignProgress(id, {difficulty?})` | `{version: 1, campaignId, difficulty, status: 'active'\|'complete', available: [ids], completed: [{scenarioId, bonusIndex, days, score}], hero: CarriedHero\|null, attempts: {id: n}, lastResult}` - plain JSON; difficulty defaults to the campaign's label (easy 0, normal 1, hard 2) |
| `getAvailableScenarios(p)`, `campaignProgressRatio(p)`, `normalizeProgress(p)` | `normalizeProgress` returns null for anything unusable (unknown campaign / scenario ids, other version) |
| `startCampaignScenario(p, bonusIndex, scenarioId?)` | `{blueprint, settings, carry, scenario, campaign}`; `scenarioId` picks a branch (default: first available); throws for unavailable scenarios or a complete campaign. `blueprint.meta.campaign = {campaignId, scenarioId, bonusIndex, heroDefId, title}` (copied to `state.meta` by `createGame`). `settings`: slot 0 human (named after the hero), others computer, the map's factions, victory / loss from the map, a seed derived from campaign + scenario + attempt count |
| `applyCarryOver(state, carry)` | after `createGame`: restores the carried hero onto the campaign hero (level, exp, primary, secondary skills, skill counters, spells - with a spell book - artifacts through `giveArtifact`, troops; overflowing troops go to the town garrison) and applies the bonus (artifact, creatures, resources, spell (+ spell book), experience through `giveExperience` - level-up pendings follow). Recomputes mana and movement. Once per game (`state.meta.campaign.carryApplied`; a second call returns `already_applied`) |
| `captureHero(state, defId, rules)` | `CarriedHero = {defId, level, exp, primary, skills, spells, skillCounters, artifacts: Entry[], army: [{creatureId, count}], options: {artifacts, army, limits: {artifacts, stacks}}}` (`options` = every carryable artifact / stack, best first; the automatic pick is the first `limits`); artifacts: equipped + backpack except war machines, the spell book, the Grail and other `special` items, the `rules.artifacts` most expensive (by `cost`); troops: the `creatureStacks` strongest stacks (`aiValue x count`) x `creatureFraction` (at least 1). A hero who is not on the map (defeated, retreated) is taken from `state.heroPool` |
| `isCampaignVictory(state)` | `gameOver.winner` (or `winners`) is the slot-0 human |
| `completeScenario(p, state)` | NEW progress. Always `attempts[id] += 1`. Victory: `completed += {...}`, `hero = captureHero(...)`, `available = next - completed` (empty -> `status: 'complete'`). Defeat / game still running: only `attempts` and `lastResult`. A game of another campaign throws; a scenario already recorded is not added twice |
| `setCarryChoice(p, {artifacts?: idx[], army?: idx[]})`, `carryChoiceIndices(p)` | the player's own pick (indices into `hero.options`, at most the limits; throws otherwise) -> NEW progress; current pick as indices |
| `validateCampaigns(list?)` | data errors (unknown maps / next ids / hero, bonus texts, slot-0 hero and faction, unreachable scenarios) |

Usage:

```js
const run = startCampaignScenario(progress, bonusIndex, scenarioId);
const state = createGame(run.blueprint, run.settings);
applyCarryOver(state, run.carry);
// ... play ... state.gameOver set
progress = completeScenario(progress, state);
```

## 4. UI

- **Main menu**: `Campaigns` (hotkey A) -> screen `campaigns`.
- **`campaigns`**: one card per campaign (hero portrait, title, hero / length / difficulty, description, scenario
  track with done / next / locked markers, progress bar) and Start (asks for the difficulty, recommended one marked),
  Continue + Restart, or Play again when complete. Esc = main menu.
- **`campaignBriefing`** `{campaignId, scenarioId?, after?}`: title, "scenario n of m", story (parchment), victory and
  defeat texts, a 216 x 216 map preview (terrain colours, darker obstacles, light roads, red monster dots, towns in the
  owner's colour), the carried hero (level, skills, spells, artifacts, troops) and three bonus buttons; Begin (Enter)
  creates the game (`launchScenario`), `setState`, then `adventure {newGame: true}`. Between scenarios *Choose items*
  opens a dialog listing every carryable artifact and troop stack (toggle, capped at the campaign's limits; default =
  the automatic best pick); OK stores the pick (`setCarryChoice`) in the progress. On a branch it first shows the
  choice cards (`choiceText` of the previous scenario); "Other mission" returns to them. A complete campaign shows its
  summary (days and scores per scenario).
- **Hook in the adventure screen** (`gameOverFlow`): after the victory / defeat dialog a game with
  `state.meta.campaign` goes to `campaignBriefing {campaignId, after: true}` instead of the main menu. The briefing
  records the game once (`meta.campaign.recorded`), saves the progress, then: victory -> outro dialog and the next
  briefing (or the summary); defeat -> dialog Retry (same scenario again, new seed, the hero as before) / Campaigns.
- **Storage**: progress is plain JSON under `h3o.data.campaign.<id>` through the storage data API added for it
  (`storage.readData(name)`, `writeData(name, value) -> {ok}|{ok:false, error}`, `removeData(name)`; ui.md §5). A game
  in progress is saved like any other (its `meta.campaign` travels with it), so loading a campaign save and finishing
  it still routes back to the campaign.

### Story events

Every map carries `events` (the map-wide timed events of the map editor, `src/engine/blueprintExtras.js`:
`{day, repeat?, players: [slots], name, message?, resources?, creatures?}`, fired at day start, shown by the adventure
screen as a message for the player concerned). The scenario builder copies `spec.events` into `blueprint.events`.
Each map has an opening / mid-game message, gifts for the player (resources, volunteers, sometimes repeating) and a
twist: on a set day the enemy gets reinforcements (or the player loses some gold) together with a warning message.

## 5. Balance notes

Checked with AI-vs-AI runs (all players on the real AI, objective enabled for slot 0): no map is lost by an idle
human in the first week (test), chokepoints are sealed, home zones have wood / ore near the town and a guarded rare
mine, the objective areas are guarded more heavily than the paths (relic guards 10-16k AI value), neutral towns carry
the usual garrison. Recommended difficulties: Saltwind easy (Easy = 80 %), the others Normal; the player chooses.

## 6. Deviations / decisions

- The original carries "up to N artifacts / creatures / spells / secondary skills" chosen per scenario; here every
  campaign has one fixed rule (`carryOver`) and level, primary and secondary skills and spells always carry.
- Starting bonuses are applied after `createGame` (not through `settings.players[i].bonus`).
- `defeat_hero` credit: a target hero killed by a neutral stack credits nobody (hero.js records `null`), the
  objective is failed (`state.objectiveFailed`) and only conquest (`allowStandard`) can still win; the campaign maps
  keep `allowStandard: true` rather than `loseIfFailed` (game-loop.md §4).
- Retrying a lost scenario re-creates it with a different seed (decor and rolled contents stay fixed - the map is
  handcrafted - only random game rolls change).

## 7. Checklist

- [x] 3 campaigns, 10 maps (S/M), 3 bonuses per scenario, original texts - `tests/campaign/campaign.test.js`
- [x] every map builds, validates, starts a game with its objective resolved, JSON-serializable - same
- [x] a week with the real AI on every map - same
- [x] bonuses (5 kinds), carry-over round trip (level, skills, spells, top-N artifacts, troops), branching, defeat / retry, survive / lose_hero rules, progress normalisation - same
- [x] screens: select, difficulty, briefing, bonus, launch, victory routing + outro + branch choice, defeat retry, summary, storage - `tests/ui/campaign.test.js`
- [x] e2e `campaign`: main menu -> campaign -> briefing -> adventure -> forced victory -> next briefing
- [x] carry-over choices made by the player (which artifacts / troops to keep) - both test files
- [x] in-game story events on every map (messages, gifts, enemy reinforcements as mid-scenario twists) - `campaign.test.js`
