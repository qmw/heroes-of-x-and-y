// Campaign "The Long Winter", scenario 3 - The Thaw. Original content.
// Castle in the southern meadows, the Necropolis of the Barrowking in the north-west, his Dungeon
// allies of Deepholm in the north-east, and the river town of Riverhold in the middle.
// Cell = 4x4 tiles (72 x 72).
export default {
  id: 'winter_thaw',
  name: 'The Thaw',
  description: 'With the Dawn relic in hand Sorsha can finally march north. The Barrowking waits in Gravemoor and the '
    + 'warlocks of Deepholm have sold him their beasts. End the winter for good - and come home alive.',
  size: 'M', players: 3, difficulty: 'hard', scale: 4, seed: 1303, decor: 0.1,
  victory: 'standard',
  loss: { type: 'lose_hero', heroIndex: 0 },
  victoryText: 'Defeat the Barrowking and the warlocks of Deepholm.',
  lossText: 'Sorsha falls, or you lose all towns and heroes.',
  playerInfo: [{ slot: 0, faction: 'castle' }, { slot: 1, faction: 'necropolis' }, { slot: 2, faction: 'dungeon' }],
  // in-game story events (map-wide timed events: blueprintExtras.js applyTimedEvents; players = slots)
  events: [
    { day: 1, players: [0], name: 'The march north', message: 'The levies follow Sorsha. If she falls, the march ends.' },
    { day: 10, players: [0], name: 'Spring levies', message: 'More levies arrive from the valley farms.', creatures: [{creatureId: 'archer', count: 10}] },
    { day: 28, players: [2], name: 'Deepholm\'s beasts', creatures: [{creatureId: 'manticore', count: 4}] },
    { day: 28, players: [0], name: 'Deepholm\'s beasts', message: 'The warlocks of Deepholm have bred manticores for the Barrowking.' },
    { day: 40, players: [0], name: 'The river breaks', message: 'The ice on the river breaks early; the farms send their first harvest.', resources: {gold: 3000, wood: 10} },
  ],
  layout: [
    'DDDDDDDDRRRRRRRRRR',
    'DdddddDDRrrrrrrrrR',
    'DddddddDRrrrrrrrrR',
    'DdddddddrrrrrrrrrR',
    'DdddddDDRRrrrrrrrR',
    'DDDdDDDDRRRRRrRRRR',
    'GggggggGggggggggGG',
    'GgggggggggggggggGG',
    'GggGggggg~~ggggggG',
    'GggggggggggggggGgG',
    'GggggggggggggGgggG',
    'GGGGGGGGgGGGGGGGGG',
    'GggggggggggggggggG',
    'GgggggGgggggGggggG',
    'GggggggggggggggggG',
    'GggggggggggggggggG',
    'GggggggggggggggggG',
    'GGGGGGGGGGGGGGGGGG',
  ],
  towns: [
    { cell: [9, 14], faction: 'castle', owner: 0, name: 'Brightford' },
    { cell: [3, 2], faction: 'necropolis', owner: 1, name: 'Gravemoor' },
    { cell: [14, 2], faction: 'dungeon', owner: 2, name: 'Deepholm' },
    { cell: [5, 8], faction: 'rampart', owner: null, name: 'Riverhold' },
  ],
  heroes: [{ owner: 0, town: 0, defId: 'sorsha' }, { owner: 1, town: 1, defId: 'isra' }, { owner: 2, town: 2, defId: 'deemer' }],
  roads: [
    { points: ['town:0', [8, 11], [9, 9], [12, 7], [13, 5], 'town:2'], type: 2 },
    { points: ['town:0', [8, 11], [6, 10], 'town:3'], type: 3 },
    { points: ['town:3', [3, 7], [3, 5], 'town:1'], type: 2 },
    { points: ['town:1', [6, 3], [9, 3], 'town:2'], type: 1 },
  ],
  objects: [
    { def: 'monster', cell: [8, 11], seal: true, data: { creatureId: 'griffin', count: 14, disposition: 'aggressive' } },
    { def: 'monster', cell: [3, 5], seal: true, data: { creatureId: 'walking_dead', count: 30, disposition: 'hostile' } },
    { def: 'monster', cell: [13, 5], seal: true, data: { creatureId: 'troglodyte', count: 40, disposition: 'hostile' } },
    { def: 'monster', cell: [7, 3], seal: true, data: { creatureId: 'black_knight', count: 6, disposition: 'hostile' } },
    { def: 'monster', cell: [12, 8], data: { creatureId: 'medusa', count: 10, disposition: 'hostile' } },
    // home
    { def: 'sawmill', cell: [2, 13] }, { def: 'ore_pit', cell: [15, 13] }, { def: 'crystal_cavern', cell: [4, 16], guard: 3000 },
    { def: 'gem_pond', cell: [14, 16], guard: 3000 }, { def: 'griffin_tower', cell: [12, 15] }, { def: 'stables', cell: [6, 13] },
    // the river valley
    { def: 'gold_mine', cell: [15, 9], guard: 6000 }, { def: 'gold_mine', cell: [1, 10], guard: 6000 },
    { def: 'sulfur_dune', cell: [11, 10], guard: 3500 },
    { def: 'arena', cell: [8, 7] }, { def: 'learning_stone', cell: [14, 7] },
    { def: 'dragon_utopia', cell: [12, 6] },
    // the north
    { def: 'sawmill', cell: [1, 1] }, { def: 'ore_pit', cell: [5, 4] },
    { def: 'sawmill', cell: [16, 1] }, { def: 'ore_pit', cell: [10, 4] },
    { def: 'artifact_relic', cell: [9, 1], guard: 15000 },
  ],
  scatter: [
    { area: [1, 12, 16, 16], band: { min: 500, max: 3000 }, count: 6, guard: false, factions: ['castle'] },
    { area: [1, 6, 16, 10], band: { min: 2000, max: 7000 }, count: 7 },
    { area: [1, 1, 6, 4], band: { min: 500, max: 3000 }, count: 3, factions: ['necropolis'] },
    { area: [9, 1, 16, 4], band: { min: 500, max: 3000 }, count: 3, factions: ['dungeon'] },
  ],
};
