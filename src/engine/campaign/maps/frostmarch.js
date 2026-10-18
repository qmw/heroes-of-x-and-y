// Campaign "The Long Winter", scenario 1 - Frostmarch. Original content.
// The border fort of Whitecairn on the northern snowfield, the Necropolis barrow-town of Gravemoor in
// the southern dirt hills, a frozen river valley in between. Cell = 2x2 tiles (36 x 36).
export default {
  id: 'winter_frostmarch',
  name: 'Frostmarch',
  description: 'The winter came early and it brought the dead with it. Whitecairn is the last fort before the '
    + 'valley farms. Hold it for six weeks, until the spring levies march north.',
  size: 'S', players: 2, difficulty: 'easy', scale: 2, seed: 1301, decor: 0.1,
  victory: { type: 'survive', days: 42, allowStandard: true, appliesToAi: false },
  loss: { type: 'lose_town', townIndex: 0 },
  victoryText: 'Hold Whitecairn for six weeks (42 days) - or destroy Gravemoor.',
  lossText: 'Whitecairn falls, or you lose all towns and heroes.',
  playerInfo: [{ slot: 0, faction: 'castle' }, { slot: 1, faction: 'necropolis' }],
  // in-game story events (map-wide timed events: blueprintExtras.js applyTimedEvents; players = slots)
  events: [
    { day: 1, players: [0], name: 'The long watch', message: 'Six weeks. Hold Whitecairn for six weeks and the spring levies will come.' },
    { day: 8, repeat: 7, players: [0], name: 'Refugees', message: 'Farmers fleeing the dead take up spears on the walls of Whitecairn.', creatures: [{creatureId: 'pikeman', count: 6}] },
    { day: 22, players: [1], name: 'The barrows open', creatures: [{creatureId: 'zombie', count: 30}] },
    { day: 22, players: [0], name: 'The barrows open', message: 'The old barrows of Gravemoor crack open. A new tide of dead marches north.' },
    { day: 36, players: [0], name: 'First riders', message: 'The vanguard of the levies arrives early: a troop of cavaliers.', creatures: [{creatureId: 'cavalier', count: 2}] },
  ],
  layout: [
    'NNNNNNNNNNNNNNNNNN',
    'NnnnnnnnnnnnnnnnnN',
    'NnnnnnnnnnnnnnnnnN',
    'NnnnnNnnnnnnNnnnnN',
    'NnnnnnnnnnnnnnnnnN',
    'NnnnnnnnnnnnnnnnnN',
    'NNNNnNNNNNNNNNnNNN',
    'NnnnnnnnNNnnnnnnnN',
    'NnnnnnnnnnnnnnnnnN',
    'NNNNNNNnNNNNNNNNNN',
    'DddddddddddddddddD',
    'DddddDddddddDddddD',
    'DddddddddddddddddD',
    'DddddddddddddddddD',
    'DddDdddddddddddddD',
    'DddddddddddddDdddD',
    'DddddddddddddddddD',
    'DDDDDDDDDDDDDDDDDD',
  ],
  towns: [
    { cell: [8, 3], faction: 'castle', owner: 0, name: 'Whitecairn' },
    { cell: [9, 13], faction: 'necropolis', owner: 1, name: 'Gravemoor' },
  ],
  heroes: [{ owner: 0, town: 0, defId: 'sorsha' }, { owner: 1, town: 1, defId: 'isra' }],
  roads: [
    { points: ['town:0', [4, 5], [4, 7], [7, 8], [7, 9], [7, 11], 'town:1'], type: 2 },
    { points: ['town:0', [14, 5], [14, 7]], type: 1 },
  ],
  objects: [
    { def: 'monster', cell: [7, 9], seal: true, data: { creatureId: 'royal_griffin', count: 10, disposition: 'hostile' } },
    { def: 'monster', cell: [4, 6], data: { creatureId: 'wolf_rider', count: 10, disposition: 'aggressive' } },
    { def: 'monster', cell: [14, 6], data: { creatureId: 'stone_golem', count: 10, disposition: 'aggressive' } },
    // the fort
    { def: 'sawmill', cell: [2, 2] }, { def: 'ore_pit', cell: [14, 2] }, { def: 'crystal_cavern', cell: [2, 4], guard: 2000 },
    { def: 'windmill', cell: [15, 4] }, { def: 'temple', cell: [11, 1] },
    // the frozen valley
    { def: 'gold_mine', cell: [15, 8], guard: 5000 }, { def: 'learning_stone', cell: [2, 8] },
    { def: 'griffin_conservatory', cell: [11, 7] },
    { def: 'artifact_minor', cell: [16, 7], guard: 3500 },
    // the barrows
    { def: 'sawmill', cell: [2, 15] }, { def: 'ore_pit', cell: [15, 15] }, { def: 'crypt', cell: [3, 11] },
    { def: 'gold_mine', cell: [15, 11], guard: 5000 },
  ],
  scatter: [
    { area: [1, 1, 16, 5], band: { min: 500, max: 2000 }, count: 5, guard: false, factions: ['castle'] },
    { area: [1, 7, 16, 8], band: { min: 1000, max: 4000 }, count: 3 },
    { area: [1, 10, 16, 16], band: { min: 500, max: 3000 }, count: 5, factions: ['necropolis'] },
  ],
};
