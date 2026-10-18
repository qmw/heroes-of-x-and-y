// Campaign definitions (data only). Spec: docs/mechanics/campaigns.md.
// Every story, place and character name here is original to this project; the playable heroes are
// entries of the game's hero roster (src/data/heroes.js).
//
// Campaign = { id, title, description, factions, difficulty, heroDefId, carryOver, start, scenarios }
//   carryOver = { artifacts: max carried artifacts, creatureStacks: strongest stacks carried,
//                 creatureFraction: share of each carried stack (0..1) }
//   scenario  = { id, map (campaign map id), title, intro, outro, next: [scenario ids] (2+ = choice,
//                 [] = last), bonuses: [3 starting bonuses], choiceText? (shown on a branch choice) }
//   bonus     = { type: 'artifact', artifactId } | { type: 'creatures', creatureId, count }
//             | { type: 'resources', resources: {gold, wood, ...} } | { type: 'spell', spellId }
//             | { type: 'experience', amount }   (+ optional `label`)

export const CAMPAIGNS = [
  {
    id: 'saltwind_charter',
    title: 'The Saltwind Charter',
    description: 'A young corsair captain is handed a royal charter and a ruined harbour. Make the free port of '
      + 'Saltwind the master of its coast - against wreckers, magi and a cult of fire.',
    factions: ['cove', 'fortress', 'tower', 'inferno'],
    difficulty: 'easy',
    heroDefId: 'leena',
    carryOver: { artifacts: 3, creatureStacks: 0, creatureFraction: 0 },
    start: 'wreckers_shore',
    scenarios: [
      {
        id: 'wreckers_shore', map: 'saltwind_wreckers_shore', title: "Wreckers' Shore",
        intro: 'The Admiralty has given you a charter, three ships and a harbour full of burnt pilings. Saltwind will '
          + 'not live on fish alone: every merchant on this coast now sails to Gullhaven - when the wreckers of '
          + 'Mirefang let them. Their false beacons burn on the dunes every night.\n\nMake Gullhaven yours, Captain '
          + 'Leena, and the coast will learn whose charter it is.',
        outro: 'Gullhaven\'s harbour master hands you the keys with shaking hands. The beacons on the dunes go dark, '
          + 'and for the first time in years a merchant cog sails into Saltwind at dusk without fear.',
        next: ['pearl_tithe'],
        bonuses: [
          { type: 'creatures', creatureId: 'pirate', count: 12 },
          { type: 'artifact', artifactId: 'necklace_of_ocean_guidance' },
          { type: 'resources', resources: { gold: 2500, wood: 5, ore: 5 } },
        ],
      },
      {
        id: 'pearl_tithe', map: 'saltwind_pearl_tithe', title: 'The Pearl Tithe',
        intro: 'A charter has a price. The Admiralty expects fifty thousand crowns before the autumn storms, and the '
          + 'magi of Frostspire - who sold the old harbour its lamp-oil for a century - would gladly see you fail.\n\n'
          + 'The Lantern Lagoon hides pearl beds and wrecks. Fill the treasury.',
        outro: 'The tithe ships sail under Saltwind\'s own flag. In Frostspire the magi argue late into the night; '
          + 'in Saltwind the taverns stay open until dawn.',
        next: ['storm_sound'],
        bonuses: [
          { type: 'resources', resources: { gold: 5000 } },
          { type: 'artifact', artifactId: 'endless_purse_of_gold' },
          { type: 'spell', spellId: 'summon_boat' },
        ],
      },
      {
        id: 'storm_sound', map: 'saltwind_storm_sound', title: 'Storm over Kelmar Sound',
        intro: 'The wreckers and the tithe were only the opening moves. The fire-priest Calid of Cinderhold bought '
          + 'the mire lords long ago and now marches on the Sound himself. If he holds the Kelmar beacon, no ship '
          + 'will ever reach Saltwind again.\n\nFind Calid and break him. And stay alive - the free port has no '
          + 'other captain.',
        outro: 'Calid\'s banner sinks in the Sound. The Kelmar beacon burns with a clean white light, and the charter '
          + 'of Saltwind is carved into its stones. The coast is free.',
        next: [],
        bonuses: [
          { type: 'creatures', creatureId: 'sea_witch', count: 6 },
          { type: 'artifact', artifactId: 'pendant_of_courage' },
          { type: 'spell', spellId: 'bless' },
        ],
      },
    ],
  },
  {
    id: 'iron_and_steam',
    title: 'Iron and Steam',
    description: 'The Guild of Gears wants furnaces that never go cold. Lead its mercenary engineers through clan '
      + 'raids, desert ruins or a demon citadel, and dig up the heart of the last great forge.',
    factions: ['factory', 'stronghold', 'conflux', 'inferno', 'dungeon'],
    difficulty: 'normal',
    heroDefId: 'henrietta',
    carryOver: { artifacts: 4, creatureStacks: 2, creatureFraction: 0.5 },
    start: 'cog_valley',
    scenarios: [
      {
        id: 'cog_valley', map: 'iron_cog_valley', title: 'Cog Valley',
        intro: 'The Guild of Gears pays well and asks one thing: reopen the water mills of Brasswick so the guild\'s '
          + 'workshops can run again. The Redcrag clans have camped in the valley all winter and they do not like '
          + 'machines.\n\nTake Brasswick, Henrietta.',
        outro: 'The wheels of Brasswick turn again and the guild sends its thanks - and two letters. One speaks of an '
          + 'orb buried in the Sandsea; the other of demons stealing engines near Ashrun. You can answer only one.',
        next: ['sandsea', 'ashrun'],
        choiceText: 'The guild offers two contracts. Which do you take?',
        bonuses: [
          { type: 'creatures', creatureId: 'mechanic', count: 10 },
          { type: 'artifact', artifactId: 'equestrians_gloves' },
          { type: 'resources', resources: { gold: 2000, ore: 10 } },
        ],
      },
      {
        id: 'sandsea', map: 'iron_sandsea', title: 'The Sandsea Expedition',
        intro: 'The first engineers kept a burning orb in an observatory beneath the Sandsea - so say the charts the '
          + 'guild bought at great expense. The spirit-wardens of Verdance say the desert is theirs.\n\nFind the Orb '
          + 'of the Firmament and bring it home.',
        outro: 'The orb hums in its cradle, brighter than any furnace. The guild masters can talk of nothing but the '
          + 'Heart of the Forge now - the engine the orb was made to wake.',
        next: ['last_furnace'],
        bonuses: [
          { type: 'artifact', artifactId: 'boots_of_speed' },
          { type: 'creatures', creatureId: 'armadillo', count: 8 },
          { type: 'spell', spellId: 'haste' },
        ],
      },
      {
        id: 'ashrun', map: 'iron_ashrun', title: 'The Siege of Ashrun',
        intro: 'Demons from the Ashrun rift raid the guild\'s convoys and melt its engines down for their own '
          + 'forges. Their warlord Nymus leads every raid himself, which makes him easy to find - and hard to kill.\n\n'
          + 'End the raids where they begin.',
        outro: 'Nymus is gone and the rift-forges of Ashrun go cold. In the warlord\'s vault the engineers find '
          + 'something they did not expect: a map of the Ember Highlands, and the place where the Heart of the '
          + 'Forge lies buried.',
        next: ['last_furnace'],
        bonuses: [
          { type: 'artifact', artifactId: 'shield_of_the_dwarven_lords' },
          { type: 'creatures', creatureId: 'automaton', count: 5 },
          { type: 'spell', spellId: 'protection_from_fire' },
        ],
      },
      {
        id: 'last_furnace', map: 'iron_last_furnace', title: 'The Last Furnace',
        intro: 'Every engine needs a heart. Six obelisks of the old engineers stand in the Ember Highlands and '
          + 'together they mark where the Heart of the Forge is buried. The warlocks of Umbervault have read the '
          + 'same stones.\n\nDig up the Heart and raise the Last Furnace in a town of your own.',
        outro: 'The Last Furnace roars to life and its glow can be seen from Brasswick to the Sandsea. The guild '
          + 'names Henrietta its first Master of the Forge. The furnaces will never go cold again.',
        next: [],
        bonuses: [
          { type: 'artifact', artifactId: 'cartographers_compass' },
          { type: 'resources', resources: { gold: 5000, wood: 10, ore: 10 } },
          { type: 'experience', amount: 3000 },
        ],
      },
    ],
  },
  {
    id: 'long_winter',
    title: 'The Long Winter',
    description: 'The winter came early and it brought the dead with it. Hold the northern border, recover a relic '
      + 'from a fallen chapel and carry the thaw to the Barrowking\'s door.',
    factions: ['castle', 'necropolis', 'tower', 'dungeon'],
    difficulty: 'normal',
    heroDefId: 'sorsha',
    carryOver: { artifacts: 3, creatureStacks: 1, creatureFraction: 1 },
    start: 'frostmarch',
    scenarios: [
      {
        id: 'frostmarch', map: 'winter_frostmarch', title: 'Frostmarch',
        intro: 'Snow in early autumn, and with it the dead. The barrow-town of Gravemoor has woken and its legions '
          + 'march on the valley farms. Whitecairn is the only fort in their way.\n\nHold Whitecairn for six weeks '
          + 'until the spring levies come north. Do not let it fall.',
        outro: 'The levies arrive in the seventh week, banners frozen stiff. Whitecairn still stands. But the dead do '
          + 'not tire, and the abbess of Brightford sends word of a relic that might stop them for good.',
        next: ['dawn_chapel'],
        bonuses: [
          { type: 'creatures', creatureId: 'archer', count: 12 },
          { type: 'artifact', artifactId: 'helm_of_the_alabaster_unicorn' },
          { type: 'resources', resources: { gold: 3000, wood: 5, ore: 5 } },
        ],
      },
      {
        id: 'dawn_chapel', map: 'winter_dawn_chapel', title: 'The Dawn Chapel',
        intro: 'High on the Pale Ridge stands the ruin of the Dawn Chapel. Its last keepers hid a necklace there, '
          + 'blessed so that no wight can bear its light. The chapel fell years ago and something still guards its '
          + 'crypt.\n\nRecover the Celestial Necklace of Bliss.',
        outro: 'The necklace burns like a small sun in Sorsha\'s hand, and the wights around the chapel crumble to '
          + 'dust. Now the march north can begin.',
        next: ['thaw'],
        bonuses: [
          { type: 'spell', spellId: 'cure' },
          { type: 'creatures', creatureId: 'griffin', count: 6 },
          { type: 'artifact', artifactId: 'badge_of_courage' },
        ],
      },
      {
        id: 'thaw', map: 'winter_thaw', title: 'The Thaw',
        intro: 'The Barrowking waits in Gravemoor, and the warlocks of Deepholm have sold him their beasts. Strike '
          + 'both, and the winter ends.\n\nSorsha must come home alive - the levies follow no one else.',
        outro: 'The ice on the river breaks with a sound like thunder. Gravemoor is silent, Deepholm\'s gates are '
          + 'sealed, and the first green shoots push through the snow of the valley farms. The long winter is over.',
        next: [],
        bonuses: [
          { type: 'artifact', artifactId: 'ring_of_vitality' },
          { type: 'creatures', creatureId: 'monk', count: 6 },
          { type: 'experience', amount: 4000 },
        ],
      },
    ],
  },
];

export const CAMPAIGN_BY_ID = Object.fromEntries(CAMPAIGNS.map((c) => [c.id, c]));

/** Difficulty labels -> createGame difficulty (0..4). The player may override it when starting. */
export const CAMPAIGN_DIFFICULTIES = [
  { id: 0, name: 'Easy', percent: 80 },
  { id: 1, name: 'Normal', percent: 100 },
  { id: 2, name: 'Hard', percent: 130 },
  { id: 3, name: 'Expert', percent: 160 },
];
export const DIFFICULTY_BY_LABEL = { easy: 0, normal: 1, hard: 2, expert: 3 };
