#!/usr/bin/env node
// Builds tools/genart/prompts.json: every picture the "generated" art pack asks Codex CLI's image tool
// for (docs/mechanics/generated-art.md). Entries: { id: '<kind>/<key>', kind, key, prompt, aspect,
// max, variants? }. Re-run after editing the tables below; generate.mjs skips ids that already exist.
//   node tools/genart/build-prompts.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAP_OBJECTS } from '../../src/data/mapObjects.js';
import { BUILDINGS } from '../../src/data/buildings.js';
import { CREATURE_BY_ID } from '../../src/data/creatures.js';

const OUT = fileURLToPath(new URL('./prompts.json', import.meta.url));

// ---- shared style preambles ----------------------------------------------------------------------

const NO_TEXT = 'No text, no letters, no numbers, no runes that look like writing, no signature, no watermark, no logos, no user interface, no frame or border.';
const PIXEL = 'crisp, detailed pixel art (visible square pixels, clean dark outlines, rich hand-placed shading, saturated but harmonious colours), in the style of modern high-quality fantasy pixel-art game sprites';
export const MAP_STYLE = `Original high-fantasy strategy-game adventure-map sprite, ${PIXEL}. Seen from a three-quarter elevated top-down view (camera above and in front, looking down at about 45 degrees), light from the top-left. A single isolated object centred on a fully transparent background, nothing cut off at the edges, no ground tile or base plate under it (at most a small soft shadow), no characters unless asked. ${NO_TEXT} Original design, not from any existing game.`;
export const TOWN_STYLE = `Original high-fantasy town-screen building for a strategy game, ${PIXEL}. Seen from a slightly elevated front three-quarter view, light from the top-left. A single isolated building on a fully transparent background, nothing cut off at the edges, only a small patch of ground at its base, no people. ${NO_TEXT} Original design, not from any existing game.`;
export const ICON_STYLE = `Original high-fantasy inventory item icon, ${PIXEL}, a single object centred on a fully transparent background, three-quarter view, light from the top-left. ${NO_TEXT} Original design, not from any existing game.`;
export const UNIT_STYLE = `Original high-fantasy battle sprite, ${PIXEL}, seen from the side (facing right) with a slight elevated angle, light from the top-left. A single isolated object on a fully transparent background, nothing cut off, no ground under it, no people. ${NO_TEXT} Original design, not from any existing game.`;

export const FACTION_THEME = {
  castle: 'noble kingdom: white limestone walls, blue slate roofs, gold trim, heraldic blue and white banners without emblems, knightly',
  rampart: 'woodland realm of elves and dwarves: living trees grown into buildings, mossy dwarven stonework, green and gold accents, leaf ornaments',
  tower: 'snowy wizard city: white alabaster towers, golden domes, glowing blue arcane crystals, snow on the roofs',
  inferno: 'infernal city: black iron and basalt, glowing lava cracks, red and orange fire light, spikes and horns',
  necropolis: 'undead city: bone and grey weathered stone, gothic spires, tattered dark cloth, eerie purple-green ghost light',
  dungeon: 'underground cavern city: dark rock carved into halls, glowing purple crystals, mushrooms, torches',
  stronghold: 'barbarian stronghold: rough wooden palisades, hide tents, bones and tusks, rope and leather, earthy browns and red',
  fortress: 'swamp fortress: reed huts on wooden stilts, mud and moss, murky water, totems, greens and browns',
  conflux: 'elemental city: floating crystal platforms, prismatic glowing crystals in air, water, fire and earth colours, magical light',
  cove: 'pirate harbour town: weathered wooden docks and piers, ship timbers, canvas sails, ropes, barrels, teal sea accents',
  factory: 'steampunk frontier town: brass and copper, riveted iron, gears, pipes and smokestacks with steam, warm lamp light',
};
export const FACTIONS = Object.keys(FACTION_THEME);

// ---- helpers -------------------------------------------------------------------------------------

function aspectOf(w, h) {
  const r = w / h;
  if (r >= 1.3) return 'landscape';
  if (r <= 0.77) return 'portrait';
  return 'square';
}
const ASPECT_TEXT = {
  square: 'Square image, 1024x1024.',
  landscape: 'Wide landscape image, 1536x1024; the object is wider than tall.',
  portrait: 'Tall portrait image, 1024x1536; the object is taller than wide.',
};

const cname = (id) => (CREATURE_BY_ID[id] ? CREATURE_BY_ID[id].name : id.replace(/_/g, ' ')).toLowerCase();

const entries = [];
function add(kind, key, prompt, aspect, max, extra = {}) {
  entries.push({ id: `${kind}/${key}`, kind, key, prompt: `${prompt} ${ASPECT_TEXT[aspect] || ''}`.trim(), aspect, max, ...extra });
}

// ---- map objects ---------------------------------------------------------------------------------

// recolourable bases: the coloured part is painted pure magenta, resize.mjs recolours it per variant
const MAGENTA = 'the coloured parts (cloth, glow) are a flat, pure bright magenta (#ff00ff) so they can be recoloured later';
const KEY_HEX = { light_blue: '#5cc8f0', green: '#3fae4a', red: '#d03a2c', dark_blue: '#2840b0', brown: '#8a5a2a', purple: '#8a3ac8', white: '#f0f0f0', black: '#26262c' };
const MONO_HEX = { blue: '#3a7af0', pink: '#f07ac0', orange: '#f08a2a', yellow: '#f0d83a', green: '#3ad06a', brown: '#9a6a3a', violet: '#9a4ae0', white: '#f4f4ff' };
export const PLAYER_HEX = { red: '#d83a2c', blue: '#3564d8', tan: '#c8aa72', green: '#3fa544', orange: '#e8862a', purple: '#8e44c8', teal: '#2aa8a0', pink: '#e87ab8' };

const RES = {
  wood: 'a neat pile of cut wooden logs',
  ore: 'a heap of grey iron ore rocks with metallic glints',
  mercury: 'a few stoppered glass flasks and a small clay vessel brimming with shiny silver liquid mercury',
  sulfur: 'a heap of bright yellow sulfur crystals and powder',
  crystal: 'a cluster of large glowing red crystals',
  gems: 'a small heap of colourful cut gems (green, blue, purple, red)',
  gold: 'a heap of shiny gold coins with a small open sack',
};

const OBJ = {
  resource_random: 'a small heap of mixed resources: a couple of logs, a grey ore rock, a few gold coins and a coloured gem',
  treasure_chest: 'a closed wooden treasure chest with iron bands and a lock, gold coins peeking out',
  campfire: 'a small campfire with a ring of stones, a cooking pot on a tripod and a few logs',
  flotsam: 'floating wreckage on water: broken planks, a barrel and a crate bobbing on a small patch of sea water',
  sea_chest: 'a barnacle-covered sea chest floating on a small patch of sea water',
  shipwreck_survivor: 'a shipwrecked sailor clinging to a small raft of planks on a small patch of sea water',
  sea_barrel: 'a single wooden barrel floating on a small patch of sea water',
  jetsam: 'a floating crate and sack tied together on a small patch of sea water',
  vial_of_mana: 'a glass potion vial with glowing blue liquid standing on the ground, sparkles',
  artifact_random: 'a mysterious ornate relic on a small stone plinth surrounded by a multicoloured shimmer',
  artifact_treasure: 'an ornate bronze relic (amulet and ring) lying on a small stone plinth with a faint bronze shimmer',
  artifact_minor: 'an ornate silver relic (a jewelled dagger) lying on a small stone plinth with a pale silver shimmer',
  artifact_major: 'an ornate golden relic (a jewelled crown) on a small stone plinth with a golden glow',
  artifact_relic: 'a legendary glowing relic (a radiant orb in a golden cradle) on a small stone plinth with a purple aura',
  spell_scroll: 'a rolled parchment scroll tied with a red ribbon, faintly glowing with magic',
  pandoras_box: 'an ornate mysterious gilded box with a closed lid, faint dark mist leaking from the seams',
  ocean_bottle: 'a corked glass bottle with a rolled message inside, floating on a small patch of sea water',
  grail: 'a small mound of freshly disturbed earth with a faint golden glow, hidden treasure spot',
  hole: 'a freshly dug hole in the ground with a pile of earth beside it',
  university: 'a grand stone university building with columns, a domed roof and a bell tower',
  altar_of_sacrifice: 'a wide ancient stone sacrificial altar with burning braziers on both sides',
  trading_post: 'a market trading post: a timber-framed shop with an awning, crates, barrels and sacks of goods',
  freelancers_guild: 'a rough timber guild hall with weapon racks outside and a recruiting banner without emblem',
  black_market: 'a shady merchant stall with dark purple canopies, chests and covered wares',
  refugee_camp: 'a refugee camp of several patched tents around a small fire',
  tavern: 'a cosy two-storey timber-framed tavern with a hanging sign board (blank), warm lit windows and a chimney',
  war_machine_factory: 'a workshop yard building war machines: a large timber workshop with a half-built ballista and wheels',
  den_of_thieves: 'a crooked shadowy hut with a hood-shaped roof and lanterns, hideout of thieves',
  sanctuary: 'a small white sacred sanctuary chapel with a golden dome and a glowing doorway',
  prison: 'a small stone prison cell with an iron-barred door and a chained iron cage',
  hill_fort: 'a stone hill fort on a rocky mound with a wooden gate and two watch towers',
  lighthouse: 'a tall stone lighthouse with a glowing lantern at the top on a rocky base',
  shipyard: 'a waterfront shipyard: wooden slipway with a half-built ship hull and a timber workshop',
  hut_of_the_magi: 'a small round hut of a mystic with a pointed roof and a large glowing eye symbol painted above the door',
  cover_of_darkness: 'a tall dark obsidian pillar emanating black smoke and shadow',
  sign: 'a wooden signpost with a blank wooden board',
  seers_hut: 'a small round thatched hut of a seer with crystal ball glow in the window and hanging charms',
  smugglers_den: 'a hidden smugglers den dug into a hill with a wooden door, crates and barrels outside',
  beastmaster_camp: 'a beastmaster camp: a hide tent with animal pens, cages and a totem',
  eye_of_the_magi: 'a large stone pedestal holding a giant watchful glowing blue eye orb',
  sawmill: 'a wooden sawmill with a water wheel, a big saw blade and stacked logs and planks',
  ore_pit: 'an open-pit ore quarry with grey stone terraces, wooden scaffolds, a crane and a mine cart full of ore',
  alchemists_lab: 'an alchemist laboratory: a stone tower workshop with glass retorts, bubbling vats and silver mercury pools, coloured smoke',
  sulfur_dune: 'a yellow sulfur mine: a yellow sulfur mound with steaming vents, a timber mine entrance and a cart of yellow sulfur',
  crystal_cavern: 'a crystal mine: a rocky cave entrance with timber supports and huge red crystals growing out of the rocks',
  gem_pond: 'a gem pond: a clear pond with sparkling multicoloured gems in its shallows, a small wooden jetty and sieves',
  gold_mine: 'a gold mine: a rocky hill with gold veins, a timber-framed mine entrance, rails and a mine cart full of gold nuggets, a lantern',
  abandoned_mine: 'an abandoned mine: a ruined timber mine entrance in a rocky hill, broken boards, cobwebs, an overturned cart, bones',
  windmill: 'a stone windmill with a conical roof and four large wooden sails',
  water_wheel: 'a timber watermill with a large wooden water wheel turning in a small stream',
  mystical_garden: 'a small magical walled garden with glowing flowers, a little fountain and sparkling gems among the plants',
  warehouse_of_wood: 'a wooden warehouse barn with big doors and stacks of logs outside',
  warehouse_of_ore: 'a stone warehouse with big doors and heaps of grey ore and mine carts outside',
  warehouse_of_mercury: 'a stone warehouse with big doors and racks of glass flasks of silver mercury outside',
  warehouse_of_sulfur: 'a warehouse with big doors and heaps and sacks of yellow sulfur outside',
  warehouse_of_crystal: 'a warehouse with big doors and crates of glowing red crystals outside',
  warehouse_of_gems: 'a fortified warehouse with big doors and open chests of coloured gems outside',
  warehouse_of_gold: 'a fortified treasury warehouse with big iron doors and chests of gold coins outside',
  magic_spring: 'a small magical spring: a stone basin with glowing blue water bubbling up and sparkles',
  royal_mint: 'a royal mint: a solid stone building with a furnace chimney and stacks of gold coins outside',
  wishing_well: 'a small round stone wishing well with a wooden roof and a bucket, coins glinting',
  lean_to: 'a simple lean-to shelter of branches and hide with a few supplies under it',
  wagon: 'a broken-down covered wagon with a torn canvas cover and a missing wheel',
  corpse: 'the skeleton of a fallen adventurer lying on the ground with a rusty sword and a torn backpack',
  warriors_tomb: 'an ancient warrior tomb: a stone sarcophagus burial mound with a sword and shield carved stele',
  scholar: 'a robed old scholar standing beside a lectern with a big open book',
  ancient_battlefield: 'an ancient battlefield: scattered skeletons, broken shields, spears and a torn banner',
  cyclops_stockpile: 'a huge crude stone storehouse of one-eyed giants built from boulders, with heaps of resources',
  dwarven_treasury: 'a dwarven treasury: a massive carved stone vault door in a rocky hill with gold rune-less ornaments and braziers',
  griffin_conservatory: 'a tall stone griffin aviary tower with large nests and perches on its top',
  imp_cache: 'a small infernal cave with lava glow, iron grate and a pile of gold coins at the entrance',
  medusa_stores: 'a ruined serpent-themed temple with snake-statue columns and petrified statues',
  naga_bank: 'an exotic golden temple vault with serpent ornaments and a pool, guarded treasury',
  dragon_fly_hive: 'a giant insect hive made of mud and resin on a stump, with buzzing dragonflies',
  dragon_utopia: 'a dragon utopia: a mountain peak with dragon lairs, enormous bones and a glittering hoard of gold',
  crypt: 'an old stone crypt with a heavy door, cracked stones and gravestones around it',
  derelict_ship: 'a derelict sailing ship drifting half-sunken in water, torn sails, on a patch of sea water',
  shipwreck: 'a shipwreck broken on rocks with its hull split open, ghostly green light, on a patch of sea water',
  pyramid: 'a stepped sandstone pyramid with a dark entrance at the bottom',
  beholders_sanctuary: 'a dark cave sanctuary with eye-shaped carvings and floating glowing eyeballs',
  temple_of_the_sea: 'a submerged ancient temple of the sea with coral-covered columns rising from water',
  pirate_cavern: 'a pirate cave in a seaside cliff with a wooden dock, barrels and a black flag without symbol',
  mansion: 'a dark gothic mansion with pointed towers, red lit windows and an iron fence',
  spit: 'a rocky spit with a lizard lair: boulders, bones and a sandy den mouth',
  red_tower: 'a tall slender red stone tower glowing with fire magic, flames at the top',
  black_tower: 'a tall slender black obsidian tower with spikes and a dragon perch',
  ivory_tower: 'a tall slender white ivory tower with golden trim and a glowing crystal at the top',
  churchyard: 'an old churchyard: a small ruined stone chapel with gravestones and dead trees inside a low wall',
  experimental_shop: 'an experimental workshop: a stone and brass building with pipes, a big gear and a chimney sparking with lightning',
  wolf_raider_picket: 'a wolf raider camp: a crude wooden palisade picket with hide tents and wolf skulls',
  ruins: 'crumbling ancient stone ruins with broken columns and arches overgrown with vines',
  bandit_hideout: 'a bandit hideout: tents and a lookout platform hidden behind crude wooden barricades',
  troll_cavern: 'a troll cave: a dark cave mouth in a mossy rock hill with bones and a crude club',
  sunken_vault: 'a sunken vault: a flooded stone vault with a rusty gate half underwater, seaweed',
  elemental_forge: 'an elemental forge: a massive stone forge with four glowing elemental fires (red, blue, green, white) and an anvil',
  haunted_library: 'a haunted library: a decrepit stone library building with ghostly green light in the windows and floating books',
  crystal_dragon_roost: 'a crystal dragon roost: a mountain of huge glowing pink and white crystals with a nest of gems',
  mercenary_camp: 'a mercenary camp: two canvas tents with a weapon rack and training dummy',
  marletto_tower: 'a tall stone watch tower with crenellations and a shield rack, defense training tower',
  star_axis: 'a celestial armillary sphere device of brass rings on a stone pedestal, glowing star points',
  garden_of_revelation: 'a small serene garden with a stone archway, flowering bushes and a glowing reading bench',
  arena: 'a round stone arena amphitheatre with tiered seats and banners without emblems',
  colosseum_of_the_magi: 'a round ornate colosseum of mages with blue magical banners and glowing arcane crystals',
  school_of_magic: 'a school of magic: a stone building with a tall pointed blue roof, stars, and a glowing orb',
  school_of_war: 'a school of war: a sturdy stone hall with weapon racks, shields on the walls and a training yard',
  library_of_enlightenment: 'a library of enlightenment: a domed marble library with columns and glowing windows',
  learning_stone: 'a large standing stone with glowing blue engraved patterns (no letters)',
  gazebo: 'a small elegant wooden gazebo with a round roof',
  tree_of_knowledge: 'a tall ancient magical tree with golden glowing fruit and a twisted trunk',
  witch_hut: 'a crooked witch hut with a mossy roof, a cauldron outside and hanging herbs',
  hermits_shack: 'a tiny mossy hermit shack of rough planks with a single smoking chimney',
  shrine_of_magic_incantation: 'a small open stone shrine with a pale blue glowing crystal, one small stone ring',
  shrine_of_magic_gesture: 'a stone shrine with columns and a green glowing crystal on an altar',
  shrine_of_magic_thought: 'an ornate stone shrine with a dome and a golden glowing crystal on an altar',
  shrine_of_magic_mystery: 'an elaborate purple marble shrine with a dome and a radiant violet crystal hovering above an altar',
  idol_of_fortune: 'a golden idol statue of a smiling goddess holding a coin on a stone pedestal',
  fountain_of_fortune: 'a small ornate stone fountain with coins glinting in the water',
  fountain_of_youth: 'a beautiful marble fountain with sparkling clear water and flowers around it',
  faerie_ring: 'a faerie ring: a circle of glowing mushrooms with sparkling fairy lights',
  swan_pond: 'a small pond with two white swans and reeds',
  rally_flag: 'a tall rally flag on a pole with a waving blank banner and a drum at its base',
  buoy: 'a red and white floating sea buoy with a small bell, on a patch of sea water',
  temple: 'a white marble temple with columns and a golden roof',
  mermaids: 'a mermaid sitting on a rock in the sea, on a patch of sea water',
  oasis: 'a desert oasis: a small pool with palm trees and green grass',
  watering_hole: 'a muddy watering hole with reeds and animal tracks',
  mineral_spring: 'a hot mineral spring: a rocky pool with steaming turquoise water and mineral crusts',
  stables: 'a wooden horse stable with a fenced paddock and hay bales',
  magic_well: 'a small stone well with glowing blue water and arcane sparkles',
  sparring_grounds: 'a fenced sparring ground with training dummies and weapon racks',
  stone_circle: 'a ring of ancient standing stones with faint blue glowing patterns',
  veterans_hall: 'a veterans hall: a sturdy timber longhouse decorated with old shields and crossed swords',
  moon_well: 'a pale silver stone well reflecting moonlight with a silvery glow',
  tailwind_totem: 'a tall carved wooden totem pole with feathers and wind ribbons swirling around',
  war_drums: 'a pair of large war drums on a wooden stand with spears planted beside them',
  fortune_teller: 'a fortune teller tent: a small colourful striped tent with a crystal ball glow inside',
  battle_shrine: 'a battle shrine: a stone altar with a crossed sword and axe, flaming braziers',
  air_sanctum: 'a small airy white shrine with swirling wind and floating feathers, pale cyan glow',
  earth_sanctum: 'a small rocky shrine built of boulders with green growing vines and an earthy glow',
  fire_sanctum: 'a small basalt shrine with a burning flame on its altar, orange glow',
  water_sanctum: 'a small shrine with a pool and a fountain of glowing blue water',
  runestone: 'a tall carved runestone menhir with glowing abstract swirl carvings (no letters)',
  redwood_observatory: 'a tall wooden observatory tower built in a giant redwood tree with a telescope platform',
  pillar_of_fire: 'a tall stone pillar with a huge eternal flame burning at its top',
  observation_tower: 'a tall slender stone observation tower with a lookout at the top',
  cartographer_sea: 'a mapmaker hut on a pier with a compass weather vane, ropes and nets',
  cartographer_land: 'a mapmaker cottage with a large rolled map hanging outside and a globe',
  cartographer_underground: 'a mapmaker hut built into a cave entrance with lanterns and rolled maps',
  obelisk: 'a tall dark stone obelisk with a glowing golden capstone',
  keymasters_tent: `a keymaster tent: a pointed tent with a large key emblem shape on the front flap; ${MAGENTA} (the tent canvas is magenta)`,
  star_chart: 'a small stone pedestal with a glowing celestial star chart dome',
  watchtower: 'a wooden watchtower on tall stilts with a lookout platform and a ladder',
  quest_guard: 'a stern armoured guard knight standing with a halberd in front of a small stone archway',
  border_guard: `a border guard: a small stone gatehouse with a closed portcullis; ${MAGENTA} (the banners and gate glow are magenta)`,
  border_gate: `a magical border gate: a stone archway filled with a shimmering energy barrier; ${MAGENTA} (the energy barrier is magenta)`,
  garrison: 'a fortified stone garrison wall with a central gatehouse, crenellations and towers',
  anti_magic_garrison: 'a fortified dark stone garrison wall with a central gatehouse and dull grey anti-magic crystals',
  subterranean_gate: 'a subterranean gate: a large stone archway leading into a dark tunnel going underground, torches on the sides',
  monolith_one_way_entrance: `a one-way teleport monolith: a tall standing stone arch with a swirling portal; ${MAGENTA} (the portal swirl is magenta)`,
  monolith_one_way_exit: `a teleport exit monolith: a tall carved standing stone with a glowing crystal on top; ${MAGENTA} (the crystal glow is magenta)`,
  monolith_two_way: `a two-way teleport monolith: a ring of stones around a swirling portal on the ground; ${MAGENTA} (the portal swirl is magenta)`,
  whirlpool: 'a swirling whirlpool vortex in the sea, on a patch of sea water',
  boat: 'a small wooden sailing boat with one mast and a white sail, floating, seen from the side and above',
  hovel: 'a poor peasant hovel with a thatched roof and a vegetable patch',
  boar_glen: 'a forest glen with a log-and-mud boar den under a fallen tree',
  rogue_cavern: 'a hidden rogue cave behind rocks with a shadowed entrance and a lantern',
  alehouse: 'a small round hillside alehouse with a green round door, kegs and clover',
  nomad_tent: 'a large decorated desert nomad tent with rugs and a camel saddle',
  tomb_of_curses: 'a sandstone desert tomb with a dark doorway and carved jackal statues',
  vineyard: 'a small vineyard with grape vines on trellises and a little stone wine press hut',
  treetop_tower: 'a wooden sniper tower built in the crown of a tall tree with a platform',
  troll_bridge: 'an old stone arch bridge with a dark troll den underneath',
  ziggurat: 'a mossy stepped stone ziggurat in a swamp with water channels',
  enchanters_hollow: 'an enchanter hollow: a hollow giant tree trunk with glowing purple arcane windows',
  ancient_lamp: 'a giant ancient golden oil lamp with magical blue smoke rising from its spout',
  magic_forest: 'a magical forest grove with luminous trees and glowing butterflies',
  sulfurous_lair: 'a sulfurous dragon lair: a rusty-orange rocky cave mouth with yellow sulfur steam',
  crystal_cave: 'a cave mouth filled with large glowing pink crystals',
  frozen_cliffs: 'icy frozen cliffs with a blue ice cave entrance and icicles',
  wisp_hollow: 'a misty hollow with dead trees and floating glowing wisp lights',
  wolf_den: 'a wolf den: a rocky burrow under a cliff with bones and scratches',
  bog_hut: 'a bog witch hut on stilts in a swamp with skulls and lanterns',
  spider_nest: 'a giant spider nest: a dead tree covered in thick webs with egg sacs',
  shadow_guild: 'a dark guild house with hooded windows, purple lanterns and shadows',
  steelworks: 'a steelworks foundry with a glowing furnace, iron chimneys and steel beams',
  clockwork_hall: 'a brass clockwork hall with a big clock face (no numbers), gears and pipes',
  frost_hall: 'a large hall of ice and snow-covered stone with frost banners without emblems',
  ossuary: 'an ossuary: a bone-built crypt with skulls in the walls and a large ribcage arch',
  storm_peak: 'a storm peak: a jagged rocky crag with a nest under swirling storm clouds and lightning',
};

const DECOR_SHAPE = {
  tree: 'leafy green oak trees with round crowns',
  pine: 'dark green pine trees',
  palm: 'tropical palm trees',
  dead_tree: 'bare dead grey trees with twisted branches',
  mangrove: 'swamp mangrove trees with exposed tangled roots',
  mountain: 'rocky grey mountains with snowy peaks',
  volcano: 'a smoking volcano with glowing lava at its crater and lava streams',
  rock: 'grey boulders and rocks',
  lake: 'a calm blue lake with a sandy and grassy shoreline (a ground-level water feature with an irregular natural outline)',
  frozen_lake: 'a frozen icy lake with cracked ice and snowy banks (a ground-level feature with an irregular natural outline)',
  lava_lake: 'a bubbling lava lake with dark crusted rock edges (a ground-level feature with an irregular natural outline)',
  oasis_lake: 'a desert pool of clear water with a few palm fronds and sandy banks (a ground-level feature with an irregular natural outline)',
  lava_flow: 'a glowing river of molten lava flowing over dark rock (a ground-level feature)',
  crater: 'a deep impact crater with a raised rocky rim (a ground-level feature)',
  canyon: 'a deep rocky canyon gorge with layered red rock walls (a ground-level feature)',
  mushroom: 'giant cave mushrooms with spotted caps',
  stalagmite: 'tall cave stalagmites of pale rock',
  crystal: 'a glowing crystal outcrop of purple and blue crystals',
  stump: 'a single old tree stump with roots',
  log: 'a fallen mossy tree log',
  shrub: 'low green bushes and shrubs',
  flowers: 'a patch of colourful wild flowers on the grass (a low ground-level patch)',
  cactus: 'desert cacti',
  dune: 'a wind-shaped golden sand dune',
  reeds: 'tall swamp reeds and cattails',
  moss: 'a low patch of green moss and lichen on the ground',
  ice_block: 'large blocks of blue ice',
  tar_pit: 'a bubbling black tar pit (a ground-level feature)',
  bones: 'scattered bleached skeleton bones and a skull on the ground',
  reef: 'a coral reef just above the sea surface with foam, on a patch of sea water',
  sea_rock: 'jagged rocks sticking out of the sea with foam around them',
  kelp: 'floating kelp and seaweed on a patch of sea water',
};

function decorPrompt(o) {
  const [w, h] = o.size;
  const base = DECOR_SHAPE[o.shape] || o.name.toLowerCase();
  const multi = ['tree', 'pine', 'palm', 'dead_tree', 'mangrove', 'rock', 'mushroom', 'stalagmite', 'crystal', 'shrub', 'cactus', 'reeds', 'ice_block', 'sea_rock'];
  let amount = '';
  if (multi.includes(o.shape)) {
    const n = w * h;
    amount = n === 1 ? 'a small group of one or two ' : n === 2 ? 'a row of two or three ' : n <= 4 ? 'a dense cluster of four or five ' : 'a large, wide dense group of seven to ten ';
  } else if (o.shape === 'mountain') {
    amount = w >= 4 ? 'a long, wide mountain range of several ' : 'a group of two or three ';
  }
  return `${amount}${base}, filling a ${w} by ${h} tile area of the map`;
}

const objectFiles = {}; // object id -> generated key (or building key) used by the mapping
for (const o of MAP_OBJECTS) {
  const [w, h] = o.size;
  const asp = aspectOf(w, h);
  const ent = o.visitable && o.interact === 'enter' && o.category !== 'decor' && w * h > 1 ? ' Its entrance faces the viewer at the bottom centre.' : '';
  if (o.category === 'guard' && /monster/.test(o.id)) continue; // drawn as creatures
  if (o.id === 'event' || o.id === 'town' || o.id === 'random_town') continue;
  if (o.category === 'dwelling' && o.effect.faction && o.effect.faction !== 'neutral') continue; // shares town art
  const m = o.id.match(/^(keymasters_tent|border_guard|border_gate)_(.+)$/) || o.id.match(/^(monolith_one_way_entrance|monolith_one_way_exit|monolith_two_way)_(.+)$/);
  if (m) continue; // recolour variants below
  let desc;
  if (o.category === 'resource' && RES[o.id.replace('resource_', '')]) desc = RES[o.id.replace('resource_', '')];
  else if (o.category === 'decor' && !OBJ[o.id]) desc = decorPrompt(o);
  else desc = OBJ[o.id];
  if (!desc && o.category === 'dwelling') {
    const c = o.effect.creatures && o.effect.creatures[0];
    desc = `${o.name.toLowerCase()}, a dwelling where ${cname(c)}s live`;
  }
  if (!desc) throw new Error(`no prompt for object ${o.id}`);
  add('object', o.id, `${MAP_STYLE} Subject: ${desc}.${ent}`, asp, 256);
}
// recolourable bases (variants written by resize.mjs)
const variantsOf = (prefix, colours, hex) => Object.fromEntries(colours.map((c) => [`${prefix}_${c}`, hex[c]]));
add('object', 'keymasters_tent', `${MAP_STYLE} Subject: ${OBJ.keymasters_tent}.`, 'square', 256,
  { variants: variantsOf('keymasters_tent', Object.keys(KEY_HEX), KEY_HEX) });
add('object', 'border_guard', `${MAP_STYLE} Subject: ${OBJ.border_guard}.`, 'square', 256,
  { variants: variantsOf('border_guard', Object.keys(KEY_HEX), KEY_HEX) });
add('object', 'border_gate', `${MAP_STYLE} Subject: ${OBJ.border_gate}.`, 'square', 256,
  { variants: variantsOf('border_gate', Object.keys(KEY_HEX), KEY_HEX) });
add('object', 'monolith_one_way_entrance', `${MAP_STYLE} Subject: ${OBJ.monolith_one_way_entrance}.`, 'square', 256,
  { variants: variantsOf('monolith_one_way_entrance', ['blue', 'pink', 'orange', 'yellow'], MONO_HEX) });
add('object', 'monolith_one_way_exit', `${MAP_STYLE} Subject: ${OBJ.monolith_one_way_exit}.`, 'square', 256,
  { variants: variantsOf('monolith_one_way_exit', ['blue', 'pink', 'orange', 'yellow'], MONO_HEX) });
add('object', 'monolith_two_way', `${MAP_STYLE} Subject: ${OBJ.monolith_two_way}.`, 'square', 256,
  { variants: variantsOf('monolith_two_way', ['green', 'brown', 'violet', 'white'], MONO_HEX) });

// map towns: faction x fort level
const TOWN_LEVEL = {
  village: 'a small open village of a few houses and a central hall, no walls',
  fort: 'a small walled town: a ring of simple walls with a gate, houses and a hall inside',
  citadel: 'a fortified town: strong walls with towers and a gate, a central keep and houses inside',
  castle: 'a grand fortified city: high walls with many towers, a big gatehouse and a tall central castle keep',
};
for (const f of FACTIONS) {
  for (const [lvl, d] of Object.entries(TOWN_LEVEL)) {
    add('object', `town_${f}_${lvl}`, `${MAP_STYLE} Subject: ${d}, seen as one compact settlement on the adventure map. Style: ${FACTION_THEME[f]}. The main gate faces the viewer at the bottom centre.`, 'landscape', 256);
  }
}

// ---- town buildings ------------------------------------------------------------------------------

const COMMON = {
  village_hall: 'a modest village hall, a single-storey meeting house',
  town_hall: 'a town hall, a two-storey civic building with a small tower',
  city_hall: 'a large city hall with a clock-less tower and wings',
  capitol: 'a magnificent capitol palace with a large golden dome and grand columns',
  fort: 'a long, low fortification: a straight wall of the town with a closed gate in the middle and two small towers at the ends, very wide and low',
  citadel: 'a long fortification: a straight high wall with a big gatehouse in the middle, four towers and a keep behind it, very wide',
  castle: 'a long, mighty fortification: a straight high wall with a huge gatehouse, six tall towers with roofs and a great keep behind, very wide',
  tavern: 'a tavern with a blank hanging sign board, lit windows and a chimney',
  blacksmith: 'a blacksmith forge with an anvil, a glowing furnace and tools',
  marketplace: 'a marketplace: covered market stalls with awnings, crates and sacks of goods',
  resource_silo: 'a resource silo: a tall storehouse with stacked crates and barrels',
  mage_guild_1: 'a mage guild: a small one-storey wizard tower with a glowing orb on top',
  mage_guild_2: 'a mage guild: a two-storey slender wizard tower with a glowing orb on top',
  mage_guild_3: 'a mage guild: a three-storey slender wizard tower with balconies and a glowing orb on top',
  mage_guild_4: 'a mage guild: a tall four-storey slender wizard tower with balconies, crystals and a glowing orb on top',
  mage_guild_5: 'a mage guild: a very tall five-storey slender wizard tower with balconies, floating crystals and a large radiant orb on top',
  shipyard: 'a shipyard on the water: a wooden slipway with a ship hull being built and a crane',
};
const BUILDING_ASPECT = { fort: 'landscape', citadel: 'landscape', castle: 'landscape', marketplace: 'landscape', shipyard: 'landscape', mage_guild_1: 'portrait', mage_guild_2: 'portrait', mage_guild_3: 'portrait', mage_guild_4: 'portrait', mage_guild_5: 'portrait', resource_silo: 'portrait' };

const SPECIAL = {
  castle_lighthouse: 'a tall white stone lighthouse with a blue roof and a bright lantern at the top',
  castle_griffin_bastion: 'a fortified stone griffin bastion tower with large nests on its top',
  castle_stables: 'royal stables with a blue roof and a fenced paddock',
  castle_brotherhood_of_the_sword: 'a knightly order hall with shields and crossed swords decoration (no emblems), a blue roof',
  castle_grail: 'a colossal white marble statue of a knight holding a raised sword on a tall pedestal, monument',
  rampart_mystic_pond: 'a mystic pond: a magical pond with glowing water, lily pads and standing stones',
  rampart_fountain_of_fortune: 'an elven fountain of fortune with sparkling water and golden leaves',
  rampart_miners_guild: 'a dwarven miners guild: a stone hall at the entrance of a mine with carts and picks',
  rampart_dwarven_treasury: 'a dwarven treasury: a squat stone vault with a big golden door',
  rampart_dendroid_saplings: 'a grove of young living tree saplings in a circle of stones',
  rampart_grail: 'a giant radiant spirit guardian tree with glowing golden leaves, monument',
  tower_library: 'a wizard library: a white domed building with tall windows and shelves of books visible',
  tower_lookout_tower: 'a very tall slender white lookout tower with a golden dome',
  tower_wall_of_knowledge: 'a wall of knowledge: a tall white stone wall covered in glowing blue arcane symbols (no letters)',
  tower_artifact_merchants: 'a magical artifact shop with a golden dome and display cases of glowing items',
  tower_sculptors_wings: 'a sculptor workshop with winged stone gargoyle statues on its roof',
  tower_grail: 'a flying skyship: a golden airship floating above a mooring tower, monument',
  inferno_castle_gate: 'an infernal gate: a huge black iron archway with a swirling fiery portal',
  inferno_order_of_fire: 'an order of fire: a dark temple with a huge eternal flame on its roof',
  inferno_brimstone_stormclouds: 'a black iron tower with dark fiery storm clouds and red lightning above it',
  inferno_birthing_pools: 'infernal birthing pools: bubbling lava pools surrounded by black rocks',
  inferno_cages: 'large black iron cages with glowing red bars on a stone platform',
  inferno_grail: 'a towering black statue of a fire deity wreathed in flames, monument',
  necropolis_cover_of_darkness: 'a dark spire emanating thick black shadow mist',
  necropolis_necromancy_amplifier: 'a necromancy amplifier: a bone tower topped with a glowing green skull orb',
  necropolis_skeleton_transformer: 'a skeleton transformer: a grim stone machine with a bone-grinding wheel and green glow',
  necropolis_unearthed_graves: 'unearthed graves: a cluster of open graves and broken tombstones',
  necropolis_grail: 'a soul prison: a tall gothic cage-tower holding swirling green ghostly souls, monument',
  dungeon_mana_vortex: 'a mana vortex: a swirling purple vortex of magic above a rock basin',
  dungeon_portal_of_summoning: 'a summoning portal: a stone ring arch with a glowing purple portal',
  dungeon_battle_scholar_academy: 'an underground academy: a dark stone hall with banners (no emblems) and purple crystals',
  dungeon_artifact_merchants: 'an underground artifact shop with display cases and purple crystal lamps',
  dungeon_mushroom_rings: 'a ring of giant glowing purple mushrooms',
  dungeon_grail: 'a giant earth guardian statue carved from rock with glowing purple crystal eyes, monument',
  stronghold_escape_tunnel: 'an escape tunnel entrance: a wooden hatch and a dug hole in an earth mound',
  stronghold_freelancers_guild: 'a barbarian trading hall: a big hide tent with wares and tusks',
  stronghold_ballista_yard: 'a ballista yard: a wooden workshop with a large ballista outside',
  stronghold_hall_of_valhalla: 'a great barbarian longhouse hall with carved wooden beasts on the roof',
  stronghold_mess_hall: 'a goblin mess hall: a crude wooden hut with a big cooking pot outside',
  stronghold_grail: 'a warlords monument: a giant stone menhir with tusks, skulls and war banners (no emblems), monument',
  fortress_cage_of_warlords: 'a cage of warlords: a large wooden cage on stilts in the swamp',
  fortress_glyphs_of_fear: 'glyphs of fear: tall standing stones with glowing eerie carved glyphs (no letters)',
  fortress_blood_obelisk: 'a blood-red stone obelisk with dripping red glow',
  fortress_captains_quarters: 'a captains quarters: a large reed hut on stilts with a lookout',
  fortress_grail: 'a giant carnivorous plant with toothed jaws rising from the swamp, monument',
  conflux_magic_university: 'a magic university: a floating crystal academy with four elemental spires',
  conflux_garden_of_life: 'a garden of life: floating flower beds and glowing blossoms',
  conflux_artifact_merchants: 'a floating crystal shop with glowing artifacts on display',
  conflux_grail: 'a column of shimmering aurora light rising from a prismatic crystal pedestal, monument',
  cove_pub: 'a seaside pub with a ship figurehead on its front and barrels outside',
  cove_grotto: 'a seaside grotto: a sea cave with a glowing pool and an altar inside',
  cove_roost: 'a large seabird roost on a tall wooden mast platform',
  cove_gunpowder_warehouse: 'a gunpowder warehouse with barrels of powder and a cannon',
  cove_grail: 'a giant lodestar: a golden star-shaped beacon on a stone lighthouse, monument',
  factory_mana_generator: 'a mana generator: a brass machine with tesla coils and glowing blue energy',
  factory_bank: 'a frontier bank: a brick building with a brass vault door and columns',
  factory_artifact_merchants: 'a steampunk curiosity shop with brass display windows',
  factory_proving_grounds: 'a proving ground: a fenced test yard with targets and a steam machine',
  factory_burrows: 'halfling burrows: small round doors in a grassy hill with chimneys',
  factory_stockyard: 'a stockyard: wooden corrals with a brass water pump and a barn',
  factory_grail: 'a perpetual engine: a huge brass machine with spinning gears and glowing core, monument',
};

const DWELLING_HINT = {
  castle: ['guardhouse of pikemen', 'archers tower', 'griffin tower with nests', 'barracks of swordsmen', 'monastery of monks', 'jousting training grounds of cavaliers', 'radiant portal temple of angels'],
  rampart: ['centaur stables', 'dwarf cottage built into a hill', 'elven homestead in a tree', 'enchanted spring of pegasi', 'arches of living tree guardians', 'unicorn glade', 'dragon cliffs with green dragons nests'],
  tower: ['gremlin workshop', 'stone gargoyle parapet', 'golem factory', 'mage tower', 'altar of wishes with a genie lamp', 'golden pavilion of the naga', 'cloud temple of giants on a cloud'],
  inferno: ['imp crucible', 'hall of sins', 'hell hound kennels', 'demon gate', 'pit of fiends (a fiery chasm)', 'fire lake of efreets', 'forsaken palace of arch-devils'],
  necropolis: ['cursed temple of skeletons', 'graveyard of zombies', 'tomb of wights', 'vampire estate', 'lich mausoleum', 'hall of dark knights', 'bone dragon vault'],
  dungeon: ['troglodyte warren', 'harpy loft in a cliff', 'pillar of floating eyes', 'chapel of medusas', 'labyrinth of minotaurs', 'manticore lair', 'red dragon cave'],
  stronghold: ['goblin barracks', 'wolf rider pen', 'orc tower', 'ogre fort', 'cliff nest of giant birds', 'cyclops cave', 'lair of giant beasts in a rock'],
  fortress: ['gnoll hut', 'lizardman den', 'serpent fly hive', 'basilisk pit', 'gorgon lair', 'wyvern nest', 'hydra pond'],
  conflux: ['magic lantern of pixies', 'altar of air', 'altar of water', 'altar of fire', 'altar of earth', 'altar of thought', 'pyre of firebirds'],
  cove: ['nymph waterfall', 'sailors shack', 'pirate frigate at a dock', 'storm bird nest', 'sea witch tower', 'nix fort', 'maelstrom of sea serpents'],
  factory: ['halfling watchtower', 'mechanic foundry', 'armadillo ranch', 'automaton manufactory', 'sandworm wormery', 'gunslinger sheriff office', 'serpentarium of feathered serpents'],
};

for (const b of BUILDINGS) {
  const fac = b.faction && b.faction !== 'common' ? [b.faction] : FACTIONS;
  for (const f of fac) {
    const style = `Style: ${FACTION_THEME[f]}.`;
    let desc; let asp = 'square';
    if (!b.faction || b.faction === 'common') {
      desc = COMMON[b.id];
      asp = BUILDING_ASPECT[b.id] || 'square';
      if (b.id === 'shipyard' && f === 'cove') desc = 'a pirate shipyard on the water with a slipway, a half-built ship and a crane';
    } else if (b.kind === 'dwelling') {
      const d = b.dwelling;
      const hint = DWELLING_HINT[f][d.tier - 1] || `dwelling of ${cname(d.creatureId)}s`;
      const alt = d.alt ? (f === 'factory' ? 'a steel gantry crane dock holding a giant mechanical war machine' : hint) : hint;
      desc = `${alt}, a creature dwelling where ${cname(d.creatureId)}s are recruited`;
      if (d.upgraded) desc = `an upgraded, larger and grander version of ${alt}, richer decoration, a creature dwelling where ${cname(d.creatureId)}s are recruited`;
      asp = d.tier >= 6 ? 'landscape' : 'square';
    } else if (SPECIAL[b.id]) {
      desc = SPECIAL[b.id];
      asp = b.kind === 'grail' ? 'portrait' : 'square';
    } else if (b.kind === 'tavern') desc = COMMON.tavern;
    else if (b.kind === 'market') desc = 'an artifact merchant shop';
    else throw new Error(`no prompt for building ${b.id}`);
    const key = !b.faction || b.faction === 'common' ? `${f}_${b.id}` : b.id;
    const max = ['fort', 'citadel', 'castle'].includes(b.id) ? 384 : 256;
    add('building', key, `${TOWN_STYLE} Subject: ${desc}. ${style}`, asp, max);
  }
}

// ---- town backdrops ------------------------------------------------------------------------------

const BACKDROP = {
  castle: 'green rolling hills, distant blue mountains, a clear blue sky with white clouds, a river',
  rampart: 'an ancient elven forest with huge trees, distant misty green hills, golden sunlight',
  tower: 'snowy mountain peaks, a frozen landscape, a pale blue sky with aurora-like glow',
  inferno: 'volcanic wasteland, erupting volcanoes, rivers of lava, a dark red smoky sky',
  necropolis: 'a bleak grey wasteland with dead trees and distant graves, a dim purple sky with a pale moon',
  dungeon: 'a vast underground cavern with stalactites on the ceiling, glowing purple crystals and dark rock',
  stronghold: 'dry savanna badlands with rocky mesas, an orange evening sky',
  fortress: 'a misty swamp with mangroves and murky water, a hazy green sky',
  conflux: 'a magical sky with floating islands, elemental lights and a prismatic aurora',
  cove: 'a tropical sea bay with palm-covered cliffs, a sunny sky and sailing ships far away',
  factory: 'a desert frontier with distant mesas, smoking factory chimneys on the horizon, a hazy amber sky',
};
for (const f of FACTIONS) {
  add('town', f, `Original wide panoramic background landscape for a fantasy strategy game town screen, ${PIXEL}. Scenery: ${BACKDROP[f]}. The sky and distant scenery fill the upper half; the lower half is open, empty, gently sloping ground (theme-appropriate grass, earth, rock or paving) with nothing on it, no buildings, no characters, so buildings can be placed later. Fully opaque, fills the whole frame edge to edge. ${NO_TEXT} Original design, not from any existing game.`, 'landscape', 800, { backdrop: true });
}

// ---- artifacts, war machines, hero boat --------------------------------------------------------

const ARTIFACTS = {
  dragon_wing_tabard: 'a tabard made from a red dragon wing membrane with golden clasps',
  spirit_of_oppression: 'a dark ghostly mask emitting purple shadow wisps',
  hourglass_of_the_evil_hour: 'a black iron hourglass with glowing red sand and bat-wing ornaments',
  stoic_watchman: 'a small stone statuette of a guard with a spear',
  inexhaustible_cart_of_lumber: 'a small wooden hand cart overloaded with logs',
  sleepkeeper: 'a silver amulet with a crescent moon and a sleeping eye charm',
  demons_horseshoe: 'a glowing red-hot iron horseshoe with small horns',
  merchants_scales: 'golden merchant balance scales with coins on the pans',
};
for (const [k, d] of Object.entries(ARTIFACTS)) add('artifact', k, `${ICON_STYLE} Subject: ${d}.`, 'square', 64);

const UNITS = {
  first_aid_tent: 'a field hospital tent: a white canvas tent with a red cross-free healing herb emblem shape, bandages and a stretcher',
  ammo_cart: 'a wooden ammunition cart on two wheels loaded with bundles of arrows, crossbow bolts and cannonballs',
  arrow_tower: 'a round stone arrow tower of a castle wall with crenellations and arrow slits, tall',
};
for (const [k, d] of Object.entries(UNITS)) add('unit', k, `${UNIT_STYLE} Subject: ${d}.`, k === 'arrow_tower' ? 'portrait' : 'square', 192);
add('hero', 'boat', `${UNIT_STYLE} Subject: a small wooden sailing boat with a single mast and a large square sail, seen from the side and slightly above, facing right; ${MAGENTA} (the sail is magenta).`, 'square', 192,
  { variants: Object.fromEntries(Object.entries(PLAYER_HEX).map(([c, hx]) => [`boat_${c}`, hx])) });

// ---- siege pieces (combat): faction x piece x state -------------------------------------------

const SIEGE_PIECE = {
  wall: 'a single tall straight section of a castle curtain wall with crenellations on top, narrow and tall',
  gate: 'a castle gatehouse section with a heavy closed wooden gate under an arch, crenellations on top',
  tower: 'a single round defensive castle tower with crenellations and arrow slits, tall and narrow',
  keep: 'a massive square castle keep (main tower) with a roof and battlements, tall',
};
const SIEGE_STATE = {
  intact: 'intact and solid',
  damaged: 'battle-damaged: cracked stones, broken crenellations, a few holes and fallen stones at its base',
  destroyed: 'destroyed: collapsed into a low heap of broken stones and rubble with only the stump of its base left standing',
};
const SIEGE_ASPECT = { wall: 'portrait', gate: 'portrait', tower: 'portrait', keep: 'portrait' };
for (const f of FACTIONS) {
  for (const [piece, pd] of Object.entries(SIEGE_PIECE)) {
    for (const [st, sd] of Object.entries(SIEGE_STATE)) {
      add('siege', `${f}_${piece}_${st}`, `${UNIT_STYLE.replace('seen from the side (facing right) with a slight elevated angle', 'seen from the front with a slight elevated angle (as seen by an army attacking from the left)')} Subject: ${pd}, ${sd}. Style: ${FACTION_THEME[f]}.`, SIEGE_ASPECT[piece], piece === 'keep' ? 256 : 192);
    }
  }
}

writeFileSync(OUT, `${JSON.stringify(entries, null, 1)}\n`);
console.log(`prompts.json: ${entries.length} entries`, Object.entries(entries.reduce((a, e) => ((a[e.kind] = (a[e.kind] || 0) + 1), a), {})));
