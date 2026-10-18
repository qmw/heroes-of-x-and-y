// Campaign "Iron and Steam", scenario 2 (branch B) - The Siege of Ashrun. Original content.
// The guild's foundry town in the western badlands, the Inferno citadel of Ashrun on the eastern
// lava fields, a broken dirt plain between them and a neutral Stronghold camp in the south.
// Cell = 4x4 tiles (72 x 72).
export default {
  id: 'iron_ashrun',
  name: 'The Siege of Ashrun',
  description: 'Demons from the Ashrun rift raid the guild\'s convoys and melt down its engines for their own forges. '
    + 'Their warlord Nymus leads every raid himself. End the raids where they begin.',
  size: 'M', players: 2, difficulty: 'normal', scale: 4, seed: 1203, decor: 0.08,
  victory: { type: 'defeat_hero', heroIndex: 1, allowStandard: true, appliesToAi: false },
  loss: 'standard',
  victoryText: 'Defeat the demon warlord Nymus (or take everything Ashrun holds).',
  lossText: 'Lose all your towns and heroes.',
  playerInfo: [{ slot: 0, faction: 'factory' }, { slot: 1, faction: 'inferno' }],
  // in-game story events (map-wide timed events: blueprintExtras.js applyTimedEvents; players = slots)
  events: [
    { day: 1, players: [0], name: 'The rift-forges', message: 'The glow of Ashrun is visible from Gearhold. Nymus leads every raid himself - find him.' },
    { day: 9, players: [0], name: 'Salvage', message: 'Your engineers salvage the wrecks of the last convoy.', resources: {ore: 8, sulfur: 3} },
    { day: 20, players: [1], name: 'Rift surge', creatures: [{creatureId: 'magog', count: 12}] },
    { day: 20, players: [0], name: 'Rift surge', message: 'The rift flares and magogs crawl out of it to reinforce Ashrun.' },
    { day: 30, players: [0], name: 'Tusk Camp envoys', message: 'The ogres of Tusk Camp hate the demons more than they hate engines. A few join you.', creatures: [{creatureId: 'ogre', count: 5}] },
  ],
  layout: [
    'XXXXXXXDDDDDLLLLLL',
    'XxxxxxXdddddLllllL',
    'XxxxxxXdddddLllllL',
    'XxxxxxxdddddlllllL',
    'XxxxxxXdddDdLllllL',
    'XxxxxxXdddddLllllL',
    'XxxXxxXdddddLLlllL',
    'XxxxxxxdddddddlllL',
    'XxxxxxXdddddLllllL',
    'XXxXXXXDDDdDDLLlLL',
    'RrrrrrrrrrrrrrrrrR',
    'RrrrrrrrrrrrrrrrrR',
    'RrrrrRrrrrrrRrrrrR',
    'RrrrrrrrrrrrrrrrrR',
    'RrrrrrrrrrrrrrrrrR',
    'RrrrrrrrrrrrrrrrrR',
    'RrrrrrrrrrrrrrrrrR',
    'RRRRRRRRRRRRRRRRRR',
  ],
  towns: [
    { cell: [3, 4], faction: 'factory', owner: 0, name: 'Gearhold' },
    { cell: [15, 4], faction: 'inferno', owner: 1, name: 'Ashrun' },
    { cell: [9, 14], faction: 'stronghold', owner: null, name: 'Tusk Camp' },
  ],
  heroes: [{ owner: 0, town: 0, defId: 'henrietta' }, { owner: 1, town: 1, defId: 'nymus' }],
  roads: [
    { points: ['town:0', [6, 3], [9, 3], [12, 3], 'town:1'], type: 2 },
    { points: ['town:0', [6, 7], [9, 7], [13, 7], [15, 7], 'town:1'], type: 1 },
    { points: [[9, 7], [10, 9], [10, 11]], type: 1 },
    { points: ['town:0', [2, 9], [2, 11], [7, 13], 'town:2'], type: 3 },
    { points: ['town:1', [15, 9], [15, 11], [12, 13], 'town:2'], type: 3 },
  ],
  objects: [
    { def: 'monster', cell: [12, 3], seal: true, data: { creatureId: 'pit_fiend', count: 8, disposition: 'hostile' } },
    { def: 'monster', cell: [12, 7], seal: true, data: { creatureId: 'demon', count: 20, disposition: 'hostile' } },
    { def: 'monster', cell: [2, 9], seal: true, data: { creatureId: 'mechanic', count: 20, disposition: 'aggressive' } },
    { def: 'monster', cell: [15, 9], seal: true, data: { creatureId: 'magog', count: 14, disposition: 'hostile' } },
    { def: 'monster', cell: [6, 3], seal: true, data: { creatureId: 'troll', count: 6, disposition: 'aggressive' } },
    // homes
    { def: 'sawmill', cell: [1, 1] }, { def: 'ore_pit', cell: [5, 7] }, { def: 'crystal_cavern', cell: [1, 7], guard: 3000 },
    { def: 'sawmill', cell: [16, 1] }, { def: 'ore_pit', cell: [14, 7] },
    { def: 'manufactory', cell: [4, 1] },
    // the dirt plain
    { def: 'gold_mine', cell: [9, 5], guard: 6000 },
    { def: 'sulfur_dune', cell: [8, 1], guard: 3000 },
    { def: 'war_machine_factory', cell: [11, 5] },
    { def: 'monster', cell: [10, 9], seal: true, data: { creatureId: 'ogre', count: 10, disposition: 'hostile' } },
    { def: 'imp_cache', cell: [11, 1] },
    { def: 'temple', cell: [8, 8] },
    // the southern steppe
    { def: 'gold_mine', cell: [16, 15], guard: 7000 }, { def: 'gem_pond', cell: [1, 15], guard: 3500 },
    { def: 'cyclops_stockpile', cell: [4, 15] },
    { def: 'arena', cell: [12, 11] },
    { def: 'learning_stone', cell: [6, 11] },
    { def: 'tree_of_knowledge', cell: [14, 14] },
    { def: 'artifact_major', cell: [9, 11], guard: 7000 },
    { def: 'prison', cell: [3, 13], guard: { creatureId: 'orc', count: 20, disposition: 'hostile' } },
  ],
  scatter: [
    { area: [1, 1, 5, 8], band: { min: 500, max: 2500 }, count: 4, guard: false, factions: ['factory'] },
    { area: [13, 1, 16, 8], band: { min: 500, max: 3000 }, count: 3, factions: ['inferno'] },
    { area: [7, 1, 11, 8], band: { min: 1500, max: 5000 }, count: 3 },
    { area: [1, 10, 16, 16], band: { min: 2000, max: 7000 }, count: 7, factions: ['stronghold'] },
  ],
};
