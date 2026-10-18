// Campaign "The Saltwind Charter", scenario 2 - The Pearl Tithe. Original content.
// A ring of coast around the Lantern Lagoon: Cove in the south-west marsh, the Tower magi of
// Frostspire in the north-east, the pearl town Coralmere in the south-east and a treasure island
// in the lagoon that only a ship can reach. Cell = 4x4 tiles (72 x 72).
export default {
  id: 'saltwind_pearl_tithe',
  name: 'The Pearl Tithe',
  description: 'The Charter is signed, but the Admiralty wants its tithe: fifty thousand crowns in the Saltwind '
    + 'treasury before the autumn storms. The magi of Frostspire would rather see the free port starve.',
  size: 'M', players: 2, difficulty: 'normal', scale: 4, seed: 1102, decor: 0.1,
  victory: { type: 'accumulate_resources', resource: 'gold', amount: 50000, allowStandard: true, appliesToAi: false },
  loss: { type: 'time_limit', days: 112 },
  victoryText: 'Gather 50,000 gold in your treasury (or defeat Frostspire).',
  lossText: 'The tithe is not paid after four months (112 days), or you lose all towns and heroes.',
  playerInfo: [{ slot: 0, faction: 'cove' }, { slot: 1, faction: 'tower' }],
  // in-game story events (map-wide timed events: blueprintExtras.js applyTimedEvents; players = slots)
  events: [
    { day: 3, players: [0], name: 'The Admiralty writes', message: '"Fifty thousand crowns, Captain. The storms will not wait, and neither will we." - the Admiralty clerk' },
    { day: 7, repeat: 7, players: [0], name: 'Pearl divers', message: 'The pearl divers of the lagoon sell their week\'s haul.', resources: {gold: 750} },
    { day: 36, players: [0], name: 'Frostspire strikes', message: 'The magi of Frostspire have frozen the river mouth and seized the salt pans. Your treasury loses its stock of salt-gold.', resources: {gold: -3000} },
    { day: 36, players: [1], name: 'Frost golems', creatures: [{creatureId: 'iron_golem', count: 6}] },
    { day: 60, players: [0], name: 'Smugglers\' tip', message: 'A smuggler sells you the location of a sunken purse - and his silence.', resources: {gold: 2500, gems: 3} },
  ],
  layout: [
    'WWWWWWWWWNNNNNNNNN',
    'WwwwwwwwwnnnnnnnnN',
    'WwwwwwwwwNnnnnnnnN',
    'Www~~~~~~~~~~~nnnN',
    'Www~~~~~~~~~~~nnnN',
    'Www~~~~~~~~~~~nnnN',
    'Www~~~~sss~~~~NnnN',
    'Www~~~~sss~~~~NnNN',
    'WWw~~~~sss~~~~gggG',
    'Www~~~~~~~~~~~gggG',
    'Www~~~~~~~~~~~gggG',
    'Www~~~~~~~~~~~gggG',
    'WwW~~~~~~~~~~~gggG',
    'Www~~~~~~~~~~~gggG',
    'WwwwwwwwwggggggggG',
    'WwwwwwwwwggggggggG',
    'WwwwwwwwwggggggggG',
    'WWWWWWWWWGGGGGGGGG',
  ],
  towns: [
    { cell: [4, 15], faction: 'cove', owner: 0, name: 'Saltwind' },
    { cell: [15, 4], faction: 'tower', owner: 1, name: 'Frostspire' },
    { cell: [13, 15], faction: 'cove', owner: null, name: 'Coralmere' },
  ],
  heroes: [{ owner: 0, town: 0, defId: 'leena' }, { owner: 1, town: 1, defId: 'serena' }],
  roads: [
    { points: ['town:0', [1, 13], [2, 8], [2, 2], [8, 1], [12, 1], [15, 2], 'town:1'], type: 2 },
    { points: ['town:0', [8, 15], 'town:2'], type: 3 },
    { points: ['town:2', [15, 12], [15, 7], [15, 6], 'town:1'], type: 2 },
  ],
  objects: [
    { def: 'monster', cell: [2, 8], seal: true, data: { creatureId: 'sea_witch', count: 8, disposition: 'hostile' } },
    { def: 'monster', cell: [9, 1], seal: true, data: { creatureId: 'iron_golem', count: 9, disposition: 'hostile' } },
    { def: 'monster', cell: [9, 15], data: { creatureId: 'nix', count: 8, disposition: 'aggressive' } },
    { def: 'monster', cell: [15, 7], seal: true, data: { creatureId: 'stone_gargoyle', count: 20, disposition: 'hostile' } },
    // home
    { def: 'sawmill', cell: [1, 15] }, { def: 'ore_pit', cell: [7, 14] }, { def: 'gem_pond', cell: [1, 11], guard: 3000 },
    { def: 'shipyard', cell: [2, 12] }, { def: 'boat', cell: [3, 12] },
    { def: 'royal_mint', cell: [6, 16], guard: 3000 },
    // the coast ring
    { def: 'gold_mine', cell: [1, 4], guard: 6000 },
    { def: 'warehouse_of_gold', cell: [5, 1], guard: 3500 },
    { def: 'gold_mine', cell: [11, 14], guard: 6000 },
    { def: 'smugglers_den', cell: [15, 13] },
    { def: 'sawmill', cell: [16, 2] }, { def: 'ore_pit', cell: [14, 6] }, { def: 'crystal_cavern', cell: [11, 2], guard: 3000 },
    { def: 'windmill', cell: [16, 10] },
    { def: 'pirate_cavern', cell: [1, 6] },
    // the treasure island
    { def: 'gold_mine', cell: [8, 7], guard: 4000 },
    { def: 'treasure_chest', cell: [7, 6] }, { def: 'treasure_chest', cell: [9, 8] },
    { def: 'artifact_major', cell: [9, 6], guard: 6000 },
    // the lagoon
    { def: 'sea_chest', cell: [5, 4] }, { def: 'sea_chest', cell: [12, 10] }, { def: 'flotsam', cell: [5, 10] },
    { def: 'shipwreck', cell: [11, 5] }, { def: 'mermaids', cell: [6, 12] }, { def: 'sea_barrel', cell: [12, 4] },
  ],
  scatter: [
    { area: [1, 13, 8, 16], band: { min: 500, max: 2500 }, count: 4, guard: false, factions: ['cove'] },
    { area: [1, 1, 8, 12], band: { min: 1000, max: 4000 }, count: 4, factions: ['cove'] },
    { area: [9, 1, 16, 7], band: { min: 500, max: 3000 }, count: 4, factions: ['tower'] },
    { area: [9, 8, 16, 16], band: { min: 1500, max: 5000 }, count: 5 },
  ],
};
