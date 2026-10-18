// First Blood - a small, forgiving two-player map: two valleys, a neutral market town between
// them and two guarded mountain passes. Original content.
// Layout cell = 2x2 tiles. Lowercase = open terrain, uppercase = the same terrain under obstacles.
export default {
  id: 'first_blood',
  name: 'First Blood',
  description: 'Two young lords share a quiet border of meadows and badlands. A neutral market town sits in the valley '
    + 'between them and two mountain passes are watched by wolf riders. A gentle first battle.',
  size: 'S', players: 2, difficulty: 'easy', scale: 2, seed: 101, decor: 0.1,
  victory: 'standard', loss: 'standard',
  victoryText: 'Defeat your rival.', lossText: 'Lose all your towns and heroes.',
  playerInfo: [{ slot: 0, faction: 'castle' }, { slot: 1, faction: 'stronghold' }],
  layout: [
    'GGGGGGGDDDDRRRRRRR',
    'GgggggGddddRrrrrrR',
    'GgggggGddddRrrrrrR',
    'GggGggGddddRrRrrrR',
    'GggggggddddrrrrrrR',
    'GgggggGddddRrrrrrR',
    'GgggggGddddRrrrrrR',
    'GgggggGddddRrrrrrR',
    'GgggggGddddRrrrrrR',
    'GgggggGddddRrrrrrR',
    'GgggggGdd~dRrrrrrR',
    'GgggggGd~~dRrrrrrR',
    'GggggGGddddRRrrrrR',
    'GggggggddddrrrrrrR',
    'GgggggGddddRrrrrrR',
    'GggGggGddddRrrRrrR',
    'GgggggGddddRrrrrrR',
    'GGGGGGGDDDDRRRRRRR',
  ],
  towns: [
    { cell: [3, 8], faction: 'castle', owner: 0 },
    { cell: [14, 8], faction: 'stronghold', owner: 1 },
    { cell: [9, 6], faction: 'rampart', owner: null, name: 'Thistledown' },
  ],
  heroes: [{ owner: 0, town: 0 }, { owner: 1, town: 1 }],
  roads: [
    { points: ['town:0', [6, 4], [8, 4], 'town:2'], type: 3 },
    { points: ['town:1', [11, 4], [9, 4], 'town:2'], type: 3 },
    { points: ['town:0', [3, 13], [6, 13], [9, 13], [11, 13], [14, 13], 'town:1'], type: 1 },
  ],
  objects: [
    // wolf riders hold the passes
    { def: 'monster', cell: [6, 4], data: { creatureId: 'wolf_rider', count: 14, disposition: 'hostile' } },
    { def: 'monster', cell: [11, 4], data: { creatureId: 'pikeman', count: 30, disposition: 'hostile' } },
    { def: 'monster', cell: [9, 13], data: { creatureId: 'dire_wolf', count: 18, disposition: 'aggressive' } },
    // home mines
    { def: 'sawmill', cell: [2, 4] }, { def: 'ore_pit', cell: [4, 12] },
    { def: 'sawmill', cell: [15, 4] }, { def: 'ore_pit', cell: [13, 12] },
    { def: 'crystal_cavern', cell: [2, 15], guard: 3500 }, { def: 'sulfur_dune', cell: [15, 15], guard: 3500 },
    // the valley
    { def: 'gold_mine', cell: [8, 15], guard: 7000 },
    { def: 'windmill', cell: [8, 2] },
    { def: 'learning_stone', cell: [2, 10] }, { def: 'learning_stone', cell: [15, 10] },
    { def: 'magic_well', cell: [10, 9] },
    { def: 'treasure_chest', cell: [4, 1] }, { def: 'treasure_chest', cell: [13, 1] },
    { def: 'campfire', cell: [1, 6] }, { def: 'campfire', cell: [16, 6] },
    { def: 'artifact_minor', cell: [9, 11], guard: 5000 },
    { def: 'griffin_conservatory', cell: [5, 15] }, { def: 'wolf_raider_picket', cell: [12, 15] },
  ],
  scatter: [
    { area: [1, 1, 5, 16], band: { min: 500, max: 2000 }, count: 4, guard: false },
    { area: [12, 1, 16, 16], band: { min: 500, max: 2000 }, count: 4, guard: false },
    { area: [7, 1, 10, 16], band: { min: 2000, max: 5000 }, count: 3 },
  ],
};
