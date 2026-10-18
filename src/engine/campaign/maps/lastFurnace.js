// Campaign "Iron and Steam", scenario 3 - The Last Furnace. Original content.
// The guild (Factory, south-west badlands) against the Dungeon lords of Umbervault (north-west
// cave-mouths on dirt) and the Inferno remnant of Cinderfall (east lava). Six obelisks in the
// central highlands point to the buried Heart of the Forge (the Grail). Cell = 4x4 tiles.
export default {
  id: 'iron_last_furnace',
  name: 'The Last Furnace',
  description: 'Every engine of the guild needs a heart. The Heart of the Forge lies buried somewhere in the Ember '
    + 'Highlands, and the obelisks of the old engineers know where. Dig it up and raise the Last Furnace in a town of '
    + 'your own before the warlocks of Umbervault do.',
  size: 'M', players: 3, difficulty: 'hard', scale: 4, seed: 1204, decor: 0.08,
  victory: { type: 'build_grail', allowStandard: true, appliesToAi: false },
  loss: { type: 'time_limit', days: 168 },
  victoryText: 'Find the Grail and build its structure in one of your towns (or defeat everyone).',
  lossText: 'Six months (168 days) pass, or you lose all towns and heroes.',
  playerInfo: [{ slot: 0, faction: 'factory' }, { slot: 1, faction: 'dungeon' }, { slot: 2, faction: 'inferno' }],
  // in-game story events (map-wide timed events: blueprintExtras.js applyTimedEvents; players = slots)
  events: [
    { day: 1, players: [0], name: 'The six stones', message: 'Six obelisks stand in the Ember Highlands. Visit them to read where the Heart of the Forge is buried.' },
    { day: 14, players: [0], name: 'Guild funding', message: 'The guild council sends funds for the excavation.', resources: {gold: 3000, wood: 5, ore: 5} },
    { day: 42, players: [1], name: 'Umbervault digs', creatures: [{creatureId: 'minotaur', count: 8}] },
    { day: 42, players: [0], name: 'Rival diggers', message: 'Word reaches you that the warlocks of Umbervault have read three of the stones. Hurry.' },
    { day: 84, players: [0], name: 'Last reserves', message: 'The guild empties its reserves for one last push.', resources: {gold: 5000} },
  ],
  layout: [
    'DDDDDDDDHHHHLLLLLL',
    'DdddddDDhhhHLllllL',
    'DdddddddhhhhlllllL',
    'DdddddDHhhhhLllllL',
    'DdddddDHhhhhLllllL',
    'DdddddDHhhhhLllllL',
    'DDDdDDDHhhhhLLlLLL',
    'HhhhhhhhhhhhhhhhhH',
    'HhhhhhHhhhhhHhhhhH',
    'HhhhhhhhhhhhhhhhhH',
    'HhhhhhhhhHhhhhhhhH',
    'XXXxXXXHhhhhhhhhhH',
    'XxxxxxXHhhhhSsssSS',
    'XxxxxxxhhhhhsssssS',
    'XxxxxxXHhhhhSsssSS',
    'XxxxxxXHhhhhSsssSS',
    'XxxxxxXHhhhhSsssSS',
    'XXXXXXXHHHHHSSSSSS',
  ],
  towns: [
    { cell: [3, 14], faction: 'factory', owner: 0, name: 'Gearhold' },
    { cell: [3, 3], faction: 'dungeon', owner: 1, name: 'Umbervault' },
    { cell: [15, 3], faction: 'inferno', owner: 2, name: 'Cinderfall' },
    { cell: [14, 14], faction: 'factory', owner: null, name: 'Brasswick' },
  ],
  heroes: [{ owner: 0, town: 0, defId: 'henrietta' }, { owner: 1, town: 1, defId: 'jaegar' }, { owner: 2, town: 2, defId: 'xarfax' }],
  roads: [
    { points: ['town:0', [3, 11], [3, 9], [9, 9], [13, 9], [14, 11], 'town:3'], type: 3 },
    { points: ['town:1', [3, 6], [3, 7], [3, 9]], type: 2 },
    { points: ['town:2', [14, 6], [14, 8], [13, 9]], type: 2 },
    { points: ['town:1', [7, 2], [9, 2], [12, 2], 'town:2'], type: 1 },
    { points: ['town:0', [7, 13], [9, 13]], type: 1 },
  ],
  objects: [
    { def: 'monster', cell: [3, 11], seal: true, data: { creatureId: 'halfling', count: 30, disposition: 'aggressive' } },
    { def: 'monster', cell: [3, 6], seal: true, data: { creatureId: 'harpy', count: 16, disposition: 'hostile' } },
    { def: 'monster', cell: [14, 6], seal: true, data: { creatureId: 'hell_hound', count: 14, disposition: 'hostile' } },
    { def: 'monster', cell: [14, 11], data: { creatureId: 'sandworm', count: 7, disposition: 'hostile' } },
    { def: 'monster', cell: [7, 2], seal: true, data: { creatureId: 'manticore', count: 6, disposition: 'hostile' } },
    { def: 'monster', cell: [12, 2], seal: true, data: { creatureId: 'efreet', count: 5, disposition: 'hostile' } },
    // obelisks and the Grail
    { def: 'obelisk', cell: [2, 8] }, { def: 'obelisk', cell: [8, 7] }, { def: 'obelisk', cell: [15, 8] },
    { def: 'obelisk', cell: [9, 12] }, { def: 'obelisk', cell: [10, 4] }, { def: 'obelisk', cell: [14, 15] },
    { def: 'grail', cell: [10, 10] },
    // homes
    { def: 'sawmill', cell: [1, 16] }, { def: 'ore_pit', cell: [5, 12] }, { def: 'sulfur_dune', cell: [5, 16], guard: 3000 },
    { def: 'sawmill', cell: [1, 1] }, { def: 'ore_pit', cell: [5, 5] },
    { def: 'sawmill', cell: [16, 1] }, { def: 'ore_pit', cell: [13, 5] },
    // highlands
    { def: 'gold_mine', cell: [6, 8], guard: 6000 }, { def: 'gold_mine', cell: [11, 15], guard: 6000 },
    { def: 'crystal_cavern', cell: [12, 8], guard: 3500 }, { def: 'gem_pond', cell: [8, 15], guard: 3500 },
    { def: 'redwood_observatory', cell: [9, 8] },
    { def: 'library_of_enlightenment', cell: [10, 1], guard: 10000 },
    { def: 'clockwork_hall', cell: [16, 12] },
    { def: 'school_of_magic', cell: [1, 10] },
    { def: 'artifact_relic', cell: [9, 5], guard: 14000 },
  ],
  scatter: [
    { area: [1, 12, 5, 16], band: { min: 500, max: 2500 }, count: 4, guard: false, factions: ['factory'] },
    { area: [1, 1, 5, 5], band: { min: 500, max: 3000 }, count: 3, factions: ['dungeon'] },
    { area: [13, 1, 16, 5], band: { min: 500, max: 3000 }, count: 3, factions: ['inferno'] },
    { area: [1, 7, 16, 16], band: { min: 2500, max: 8000 }, count: 9 },
  ],
};
