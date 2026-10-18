// Campaign "Iron and Steam", scenario 2 (branch A) - The Sandsea Expedition. Original content.
// The guild's caravan town in the south-west badlands, the Conflux spirit-wardens of Verdance in the
// north-east, and between them the Sandsea, a desert with a buried observatory. Cell = 4x4 tiles.
export default {
  id: 'iron_sandsea',
  name: 'The Sandsea Expedition',
  description: 'Old charts speak of an observatory under the Sandsea where the first engineers kept the Orb of the '
    + 'Firmament. Its light would let the guild\'s furnaces burn without coal. The spirit-wardens of Verdance '
    + 'guard the desert jealously.',
  size: 'M', players: 2, difficulty: 'normal', scale: 4, seed: 1202, decor: 0.06,
  victory: { type: 'acquire_artifact', artifactId: 'orb_of_the_firmament', allowStandard: true, appliesToAi: false },
  loss: 'standard',
  victoryText: 'Recover the Orb of the Firmament from the Sandsea (or defeat Verdance).',
  lossText: 'Lose all your towns and heroes.',
  playerInfo: [{ slot: 0, faction: 'factory' }, { slot: 1, faction: 'conflux' }],
  // in-game story events (map-wide timed events: blueprintExtras.js applyTimedEvents; players = slots)
  events: [
    { day: 1, players: [0], name: 'Old charts', message: 'The charts mark the observatory in the north-west of the Sandsea, past the spirit-wardens\' border.' },
    { day: 8, players: [0], name: 'Water caravan', message: 'A water caravan from the guild reaches Dustgate.', resources: {gold: 1000, crystal: 3} },
    { day: 22, players: [0], name: 'Sandstorm', message: 'A great sandstorm buries the eastern roads. Your foragers lose a week of supplies.', resources: {gold: -1500, wood: -5} },
    { day: 22, players: [1], name: 'Wardens awaken', creatures: [{creatureId: 'storm_elemental', count: 10}] },
    { day: 35, players: [0], name: 'The nomads', message: 'Desert nomads who hate the wardens offer their armoured beasts.', creatures: [{creatureId: 'armadillo', count: 10}] },
  ],
  layout: [
    'SSSSSSSSSGGGGGGGGG',
    'SssssssSSGgggggggG',
    'SssssssssggggggggG',
    'SsssSssssGgggggggG',
    'SssssssssGgggggggG',
    'SssssssssGgggggggG',
    'SssssssssGGGGgGGGG',
    'SsssSsssssssssssSS',
    'SssssssssssssssssS',
    'XXXsXXXssssssssssG',
    'XxxxxxXssssssSsssS',
    'XxxxxxXssssssssSSS',
    'XxxxxxXssssssSsssS',
    'XxxxxxxsssssssssSS',
    'XxxxxxXssssssssssS',
    'XxxxxxXSSsssssssSS',
    'XxxxxxxsssssssssSS',
    'XXXXXXXSSSSSSSSSSS',
  ],
  towns: [
    { cell: [3, 14], faction: 'factory', owner: 0, name: 'Dustgate' },
    { cell: [14, 3], faction: 'conflux', owner: 1, name: 'Verdance' },
    { cell: [12, 14], faction: 'factory', owner: null, name: 'Oasis Rest' },
  ],
  heroes: [{ owner: 0, town: 0, defId: 'henrietta' }, { owner: 1, town: 1, defId: 'luna' }],
  roads: [
    { points: ['town:0', [6, 13], [8, 13], 'town:2'], type: 3 },
    { points: ['town:0', [3, 11], [3, 9], [5, 8], [8, 8]], type: 2 },
    { points: ['town:1', [9, 2], [6, 2]], type: 1 },
    { points: ['town:1', [13, 6], [11, 8], [8, 8]], type: 2 },
    { points: ['town:2', [14, 10], [13, 7], [13, 6], 'town:1'], type: 1 },
  ],
  objects: [
    { def: 'monster', cell: [6, 13], seal: true, data: { creatureId: 'sandworm', count: 5, disposition: 'aggressive' } },
    { def: 'monster', cell: [3, 9], seal: true, data: { creatureId: 'armadillo', count: 14, disposition: 'aggressive' } },
    { def: 'monster', cell: [13, 6], seal: true, data: { creatureId: 'air_elemental', count: 16, disposition: 'hostile' } },
    { def: 'monster', cell: [9, 2], seal: true, data: { creatureId: 'earth_elemental', count: 12, disposition: 'hostile' } },
    { def: 'monster', cell: [14, 10], data: { creatureId: 'gunslinger', count: 6, disposition: 'hostile' } },
    // the buried observatory
    { def: 'artifact_major', cell: [7, 4], data: { artifactId: 'orb_of_the_firmament' }, guard: { creatureId: 'storm_elemental', count: 24, disposition: 'savage', neverFlees: true } },
    { def: 'redwood_observatory', cell: [5, 2] },
    { def: 'pyramid', cell: [9, 6] },
    // homes
    { def: 'sawmill', cell: [1, 16] }, { def: 'ore_pit', cell: [5, 11] }, { def: 'sulfur_dune', cell: [1, 10], guard: 3000 },
    { def: 'sawmill', cell: [16, 1] }, { def: 'ore_pit', cell: [11, 2] }, { def: 'crystal_cavern', cell: [16, 6], guard: 3000 },
    { def: 'manufactory', cell: [5, 16] },
    // the desert
    { def: 'gold_mine', cell: [9, 11], guard: 6000 }, { def: 'gold_mine', cell: [2, 5], guard: 6000 },
    { def: 'gem_pond', cell: [15, 12], guard: 3500 }, { def: 'alchemists_lab', cell: [10, 15], guard: 3500 },
    { def: 'oasis', cell: [8, 10] }, { def: 'oasis', cell: [11, 5] },
    { def: 'learning_stone', cell: [3, 7] },
    { def: 'school_of_war', cell: [12, 10] },
    { def: 'treasure_chest', cell: [2, 1] }, { def: 'artifact_minor', cell: [4, 2], guard: 4000 },
  ],
  scatter: [
    { area: [1, 10, 6, 16], band: { min: 500, max: 2500 }, count: 4, guard: false, factions: ['factory'] },
    { area: [10, 1, 16, 5], band: { min: 500, max: 3000 }, count: 4, factions: ['conflux'] },
    { area: [1, 1, 16, 13], band: { min: 2000, max: 7000 }, count: 8 },
  ],
};
