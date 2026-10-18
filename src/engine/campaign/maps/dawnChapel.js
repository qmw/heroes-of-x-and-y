// Campaign "The Long Winter", scenario 2 - The Dawn Chapel. Original content.
// Castle in the western meadows (Brightford), the Necropolis of Gravemoor in the eastern swamp, the
// ruined Dawn Chapel on a snowy ridge in the north and the Tower town of Glassmere in the south.
// Cell = 4x4 tiles (72 x 72).
export default {
  id: 'winter_dawn_chapel',
  name: 'The Dawn Chapel',
  description: 'The spring levies came, but the dead do not tire. The abbess of Brightford remembers a relic kept in '
    + 'the Dawn Chapel on the Pale Ridge - a necklace whose light no wight can bear. The chapel fell years ago; '
    + 'something still guards its crypt.',
  size: 'M', players: 2, difficulty: 'normal', scale: 4, seed: 1302, decor: 0.1,
  victory: { type: 'acquire_artifact', artifactId: 'celestial_necklace_of_bliss', allowStandard: true, appliesToAi: false },
  loss: 'standard',
  victoryText: 'Recover the Celestial Necklace of Bliss from the Dawn Chapel (or destroy Gravemoor).',
  lossText: 'Lose all your towns and heroes.',
  playerInfo: [{ slot: 0, faction: 'castle' }, { slot: 1, faction: 'necropolis' }],
  // in-game story events (map-wide timed events: blueprintExtras.js applyTimedEvents; players = slots)
  events: [
    { day: 1, players: [0], name: 'The abbess', message: '"The chapel is on the Pale Ridge, north of Brightford. What guards the crypt was once a friend." - the abbess' },
    { day: 7, repeat: 14, players: [0], name: 'Pilgrims\' alms', message: 'Pilgrims bring alms to Brightford for the war against the dead.', resources: {gold: 1000} },
    { day: 25, players: [1], name: 'The Barrowking\'s answer', creatures: [{creatureId: 'wraith', count: 10}] },
    { day: 25, players: [0], name: 'A cold wind', message: 'A cold wind blows from Gravemoor: the Barrowking knows what you seek.' },
    { day: 30, players: [0], name: 'Glassmere\'s gift', message: 'The magi of Glassmere send a crate of crystal lenses to fight the dark.', resources: {crystal: 5, mercury: 3} },
  ],
  layout: [
    'NNNNNNNNNNNNNNNNNN',
    'NNNNNnnnnnnnnNNNNN',
    'NNNNnnnnnnnnnnNNNN',
    'GGGGNNNnnnnNNNWWWW',
    'GggGGGGNnNNWWWwwwW',
    'GggggggGnnWwwwwwwW',
    'GggggggggggwwwwwwW',
    'GggggggGgdWwwwwwwW',
    'GgggGggGddWwwWwwwW',
    'GggggggGddWwwwwwwW',
    'GggggggggddwwwwwwW',
    'GggggggGddWwwwwwwW',
    'GGGgGGGGddWWWwWWWW',
    'SssssssssssssssssS',
    'SsssssSsssssSssssS',
    'SssssssssssssssssS',
    'SssssssssssssssssS',
    'SSSSSSSSSSSSSSSSSS',
  ],
  towns: [
    { cell: [3, 8], faction: 'castle', owner: 0, name: 'Brightford' },
    { cell: [14, 8], faction: 'necropolis', owner: 1, name: 'Gravemoor' },
    { cell: [9, 15], faction: 'tower', owner: null, name: 'Glassmere' },
  ],
  heroes: [{ owner: 0, town: 0, defId: 'sorsha' }, { owner: 1, town: 1, defId: 'nagash' }],
  roads: [
    { points: ['town:0', [7, 6], [9, 6], [11, 6], 'town:1'], type: 2 },
    { points: ['town:0', [7, 10], [9, 10], [11, 10], 'town:1'], type: 1 },
    { points: [[9, 6], [8, 4], [9, 2]], type: 1 },
    { points: ['town:0', [3, 12], [3, 14], 'town:2'], type: 3 },
    { points: ['town:1', [13, 12], [13, 14], 'town:2'], type: 3 },
  ],
  objects: [
    { def: 'monster', cell: [8, 4], seal: true, data: { creatureId: 'wraith', count: 18, disposition: 'hostile' } },
    { def: 'monster', cell: [7, 6], seal: true, data: { creatureId: 'zombie', count: 36, disposition: 'aggressive' } },
    { def: 'monster', cell: [10, 6], seal: true, data: { creatureId: 'wight', count: 24, disposition: 'hostile', neverFlees: true } },
    { def: 'monster', cell: [7, 10], seal: true, data: { creatureId: 'skeleton_warrior', count: 40, disposition: 'hostile' } },
    { def: 'monster', cell: [10, 10], seal: true, data: { creatureId: 'vampire', count: 14, disposition: 'hostile', neverFlees: true } },
    { def: 'monster', cell: [3, 12], seal: true, data: { creatureId: 'stone_gargoyle', count: 16, disposition: 'aggressive' } },
    { def: 'monster', cell: [13, 12], seal: true, data: { creatureId: 'iron_golem', count: 8, disposition: 'hostile' } },
    // the chapel
    { def: 'artifact_relic', cell: [9, 1], data: { artifactId: 'celestial_necklace_of_bliss' }, guard: { creatureId: 'vampire_lord', count: 16, disposition: 'savage', neverFlees: true } },
    { def: 'temple', cell: [6, 2] }, { def: 'altar_of_sacrifice', cell: [12, 2] },
    // homes
    { def: 'sawmill', cell: [1, 5] }, { def: 'ore_pit', cell: [5, 11] }, { def: 'crystal_cavern', cell: [2, 11], guard: 3000 },
    { def: 'sawmill', cell: [16, 5] }, { def: 'ore_pit', cell: [12, 11] }, { def: 'crypt', cell: [15, 11] },
    // the middle
    { def: 'gold_mine', cell: [9, 8], guard: 6000 },
    { def: 'monastery', cell: [5, 5] },
    { def: 'learning_stone', cell: [8, 11] },
    // the south
    { def: 'gold_mine', cell: [2, 16], guard: 6000 }, { def: 'gem_pond', cell: [16, 16], guard: 3500 },
    { def: 'mercenary_camp', cell: [6, 15] },
    { def: 'library_of_enlightenment', cell: [12, 16], guard: 9000 },
    { def: 'witch_hut', cell: [15, 14] },
    { def: 'artifact_major', cell: [5, 13], guard: 6000 },
  ],
  scatter: [
    { area: [1, 4, 6, 11], band: { min: 500, max: 2500 }, count: 4, guard: false, factions: ['castle'] },
    { area: [11, 4, 16, 11], band: { min: 500, max: 3000 }, count: 4, factions: ['necropolis'] },
    { area: [5, 1, 12, 3], band: { min: 2000, max: 6000 }, count: 3 },
    { area: [1, 13, 16, 16], band: { min: 2000, max: 7000 }, count: 6 },
  ],
};
