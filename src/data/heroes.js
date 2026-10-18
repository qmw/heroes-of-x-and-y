// Hero definitions. Schema: DESIGN.md §3 "HeroDef", extended with:
//   faction (derived from class), biography, special (campaign-only heroes, not offered in taverns),
//   startWarMachine: artifact id of the war machine the hero starts with, or null.
// Specialty types and their exact scaling are specified in docs/mechanics/heroes.md.
//
// CROSS-REFERENCES to other data files (kept greppable):
//   creature ids  -> FACTION_START_ARMY, CR.* lists, `C(...)`/`CB(...)`/`CU(...)` calls
//   spell ids     -> 6th argument of h(...) and `SP(...)` calls
//   artifact ids  -> WAR_MACHINES (`ballista`, `first_aid_tent`, `ammo_cart`, `cannon`)

import { getHeroClass } from './heroClasses.js';

/**
 * @typedef {{type:string, description:string, [k:string]:any}} Specialty
 * @typedef {{id:string, name:string, classId:string, faction:string, gender:'male'|'female',
 *   specialty:Specialty, startSkills:{id:string, level:number}[], startSpell:string|null,
 *   startArmy:{creatureId:string, min:number, max:number}[], startWarMachine:string|null,
 *   biography:string, special:boolean}} HeroDef
 */

/** Closed set of specialty types. */
export const SPECIALTY_TYPES = [
  'creature', 'creature_bonus', 'creature_upgrade', 'skill', 'spell', 'resource', 'speed',
  'war_machine', 'mastery',
];
/** Closed set of `mode` values of a `spell` specialty. */
export const SPELL_SPECIALTY_MODES = ['level_scaled', 'tiered', 'fixed_percent', 'fixed_value'];

export const WAR_MACHINES = ['ballista', 'first_aid_tent', 'ammo_cart', 'cannon'];

/** Starting stacks per faction (tier 1, 2, 3 base creatures; original counts). */
export const FACTION_START_ARMY = {
  castle: [['pikeman', 10, 20], ['archer', 4, 7], ['griffin', 2, 3]],
  rampart: [['centaur', 10, 20], ['dwarf', 3, 5], ['wood_elf', 2, 4]],
  tower: [['gremlin', 30, 40], ['stone_gargoyle', 5, 7], ['stone_golem', 3, 4]],
  inferno: [['imp', 15, 25], ['gog', 4, 7], ['hell_hound', 3, 4]],
  necropolis: [['skeleton', 20, 30], ['walking_dead', 4, 6], ['wight', 3, 4]],
  dungeon: [['troglodyte', 15, 25], ['harpy', 4, 6], ['beholder', 3, 4]],
  stronghold: [['goblin', 15, 25], ['wolf_rider', 5, 7], ['orc', 4, 6]],
  fortress: [['gnoll', 15, 25], ['lizardman', 4, 7], ['serpent_fly', 3, 4]],
  conflux: [['pixie', 15, 25], ['air_elemental', 3, 5], ['water_elemental', 2, 3]],
  cove: [['nymph', 15, 25], ['crew_mate', 5, 7], ['pirate', 3, 4]],
  factory: [['halfling', 15, 25], ['mechanic', 5, 7], ['armadillo', 3, 4]],
};

// Creature families used by specialties (base + upgrades).
const CR = {
  pikemen: ['pikeman', 'halberdier'], archers: ['archer', 'marksman'],
  griffins: ['griffin', 'royal_griffin'], swordsmen: ['swordsman', 'crusader'],
  monks: ['monk', 'zealot'], cavaliers: ['cavalier', 'champion'],
  dwarves: ['dwarf', 'battle_dwarf'], elves: ['wood_elf', 'grand_elf'],
  pegasi: ['pegasus', 'silver_pegasus'], dendroids: ['dendroid_guard', 'dendroid_soldier'],
  unicorns: ['unicorn', 'war_unicorn'],
  gargoyles: ['stone_gargoyle', 'obsidian_gargoyle'], golems: ['stone_golem', 'iron_golem'],
  magi: ['mage', 'arch_mage'], genies: ['genie', 'master_genie'], nagas: ['naga', 'naga_queen'],
  imps: ['imp', 'familiar'], gogs: ['gog', 'magog'], hellHounds: ['hell_hound', 'cerberus'],
  demons: ['demon', 'horned_demon'], pitFiends: ['pit_fiend', 'pit_lord'],
  efreet: ['efreet', 'efreet_sultan'], devils: ['devil', 'arch_devil'],
  skeletons: ['skeleton', 'skeleton_warrior'], walkingDead: ['walking_dead', 'zombie'],
  wights: ['wight', 'wraith'], vampires: ['vampire', 'vampire_lord'], liches: ['lich', 'power_lich'],
  blackKnights: ['black_knight', 'dread_knight'],
  troglodytes: ['troglodyte', 'infernal_troglodyte'], harpies: ['harpy', 'harpy_hag'],
  beholders: ['beholder', 'evil_eye'], minotaurs: ['minotaur', 'minotaur_king'],
  manticores: ['manticore', 'scorpicore'],
  goblins: ['goblin', 'hobgoblin'], wolfRiders: ['wolf_rider', 'wolf_raider'],
  orcs: ['orc', 'orc_chieftain'], ogres: ['ogre', 'ogre_mage'], rocs: ['roc', 'thunderbird'],
  cyclopes: ['cyclops', 'cyclops_king'], behemoths: ['behemoth', 'ancient_behemoth'],
  gnolls: ['gnoll', 'gnoll_marauder'], lizardmen: ['lizardman', 'lizard_warrior'],
  serpentFlies: ['serpent_fly', 'dragon_fly'], basilisks: ['basilisk', 'greater_basilisk'],
  gorgons: ['gorgon', 'mighty_gorgon'], wyverns: ['wyvern', 'wyvern_monarch'],
  psychic: ['psychic_elemental', 'magic_elemental'], earth: ['earth_elemental', 'magma_elemental'],
  fire: ['fire_elemental', 'energy_elemental'], water: ['water_elemental', 'ice_elemental'],
  nymphs: ['nymph', 'oceanid'], crewMates: ['crew_mate', 'seaman'], pirates: ['pirate', 'corsair', 'sea_dog'],
  stormbirds: ['stormbird', 'ayssid'], seaWitches: ['sea_witch', 'sorceress'], nixes: ['nix', 'nix_warrior'],
  halflings: ['halfling', 'halfling_grenadier'], mechanics: ['mechanic', 'engineer'],
  armadillos: ['armadillo', 'bellwether_armadillo'], automatons: ['automaton', 'sentinel_automaton'],
  sandworms: ['sandworm', 'olgoi_khorkhoi'], gunslingers: ['gunslinger', 'bounty_hunter'],
  couatls: ['couatl', 'crimson_couatl'], dreadnoughts: ['dreadnought', 'juggernaut'],
  dragons: ['green_dragon', 'gold_dragon', 'red_dragon', 'black_dragon', 'bone_dragon', 'ghost_dragon',
    'faerie_dragon', 'rust_dragon', 'crystal_dragon', 'azure_dragon'],
};

const title = (id) => id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const list = (ids) => ids.map(title).join(', ');

// ---- specialty constructors -------------------------------------------------------------------
const C = (creatures) => ({ type: 'creature', creatures,
  description: `${list(creatures)}: +1 speed, and +5% attack and defense for every (creature tier) hero levels.` });
const CB = (creatures, b) => ({ type: 'creature_bonus', creatures,
  attack: b.attack || 0, defense: b.defense || 0, damage: b.damage || 0, speed: b.speed || 0,
  description: `${list(creatures)}: ${Object.entries(b).map(([k, v]) => `+${v} ${k}`).join(', ')}.` });
const CU = (upgrades, to) => ({ type: 'creature_upgrade', upgrades: Object.fromEntries(upgrades.map((c) => [c, to])),
  description: `Can upgrade ${list(upgrades)} to ${title(to)}s.` });
const SK = (skillId) => ({ type: 'skill', skillId,
  description: `${title(skillId)}: skill effect +5% per hero level.` });
const TIER_BONUS = [3, 3, 2, 2, 1, 1, 0];
const SP = (spellId, mode = 'level_scaled', value) => {
  const s = { type: 'spell', spellId, mode };
  if (mode === 'level_scaled') {
    s.percentPerStep = 3;
    s.description = `${title(spellId)}: effect +3% for every (target creature tier) hero levels.`;
  } else if (mode === 'tiered') {
    s.tierBonus = value || TIER_BONUS;
    const t = s.tierBonus;
    s.description = value
      ? `${title(spellId)}: extra effect on weaker creatures (${t.map((b, i) => `+${b} tier ${i + 1}`).filter((x) => !x.startsWith('+0')).join(', ')}).`
      : `${title(spellId)}: extra effect on weaker creatures (+3 tier 1-2, +2 tier 3-4, +1 tier 5-6).`;
  } else if (mode === 'fixed_percent') {
    s.percent = value;
    s.description = `${title(spellId)}: effect +${value}%.`;
  } else {
    s.value = value;
    s.description = `${title(spellId)}: effect +${value}.`;
  }
  return s;
};
const R = (resource, amount) => ({ type: 'resource', resource, amount,
  description: `+${amount} ${resource} per day.` });
const SPD = (value) => ({ type: 'speed', value, description: `All creatures +${value} speed.` });
const WM = (machineId) => ({ type: 'war_machine', machineId, tier: 5,
  description: `${title(machineId)}: +5% attack and defense for every 5 hero levels.` });
const MS = (school) => ({ type: 'mastery', school,
  description: `Casts all ${title(school)} school spells at Expert mastery.` });

const GOLD = R('gold', 350);

function parseSkills(str) {
  return str.split(',').map((part) => {
    const [id, level] = part.trim().split(' ');
    return { id, level: Number(level) };
  });
}

/**
 * @param {string} name @param {string} classId @param {'m'|'f'} g @param {Specialty} specialty
 * @param {string} skills e.g. "leadership 1, archery 1" @param {string|null} spell
 * @param {string} biography
 * @param {{id?:string, special?:boolean, machine?:string, army?:Array<[string,number,number]>}} [x]
 * @returns {HeroDef}
 */
function h(name, classId, g, specialty, skills, spell, biography, x = {}) {
  const faction = getHeroClass(classId).faction;
  const machine = x.machine || null;
  let army = x.army || FACTION_START_ARMY[faction];
  if (machine && !x.army) army = army.slice(0, 2); // the war machine takes the third stack's place
  return {
    id: x.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    name, classId, faction,
    gender: g === 'f' ? 'female' : 'male',
    specialty,
    startSkills: parseSkills(skills),
    startSpell: spell,
    startArmy: army.map(([creatureId, min, max]) => ({ creatureId, min, max })),
    startWarMachine: machine,
    biography,
    special: !!x.special,
  };
}

const SPECIAL = { special: true };

/** @type {HeroDef[]} */
export const HEROES = [
  // ================================= CASTLE =================================
  h('Christian', 'knight', 'm', WM('ballista'), 'leadership 1, artillery 1', null, 'A former shipwright who now builds and aims siege engines.', { machine: 'ballista' }),
  h('Edric', 'knight', 'm', C(CR.griffins), 'leadership 1, armorer 1', null, 'A decorated knight who raised griffins from the egg.'),
  h('Orrin', 'knight', 'm', SK('archery'), 'leadership 1, archery 1', null, 'A master bowman whose drills made his archers feared.'),
  h('Sorsha', 'knight', 'f', C(CR.swordsmen), 'leadership 1, offense 1', null, 'A sword-maiden who trains the kingdom\'s finest blades.'),
  h('Sylvia', 'knight', 'f', SK('navigation'), 'leadership 1, navigation 1', null, 'A sea captain\'s daughter, more at home on a deck than in a saddle.'),
  h('Valeska', 'knight', 'f', C(CR.archers), 'leadership 1, archery 1', null, 'She rose from the ranks of the archers she now commands.'),
  h('Tyris', 'knight', 'f', C(CR.cavaliers), 'leadership 1, tactics 1', null, 'A fearless rider who leads every cavalry charge herself.'),
  h('Lord Haart', 'knight', 'm', SK('estates'), 'leadership 1, estates 1', null, 'A wealthy lord whose lands fill the royal coffers.'),
  h('Adela', 'cleric', 'f', SP('bless'), 'wisdom 1, diplomacy 1', 'bless', 'A gentle abbess whose blessings steady every hand.'),
  h('Adelaide', 'cleric', 'f', SP('frost_ring'), 'wisdom 2', 'frost_ring', 'A priestess whose prayers bring frost instead of rain.'),
  h('Caitlin', 'cleric', 'f', GOLD, 'wisdom 1, intelligence 1', 'cure', 'A healer whose temple tithes follow her wherever she goes.'),
  h('Cuthbert', 'cleric', 'm', SP('weakness', 'tiered'), 'wisdom 1, estates 1', 'weakness', 'A stern prior who saps the strength of the wicked.'),
  h('Ingham', 'cleric', 'm', C(CR.monks), 'wisdom 1, mysticism 1', 'curse', 'Abbot of a militant order of monks.'),
  h('Loynis', 'cleric', 'm', SP('prayer', 'tiered'), 'wisdom 1, learning 1', 'prayer', 'A devout scholar whose prayers are always answered.'),
  h('Rion', 'cleric', 'm', SK('first_aid'), 'wisdom 1, first_aid 1', 'stone_skin', 'A battlefield surgeon who has saved more soldiers than any sword.', { machine: 'first_aid_tent' }),
  h('Sanya', 'cleric', 'f', SK('eagle_eye'), 'wisdom 1, eagle_eye 1', 'dispel', 'A watchful priestess who learns from her enemies\' sorcery.'),
  h('Catherine', 'knight', 'f', C(CR.swordsmen), 'leadership 1, offense 1', null, 'A warrior queen who leads her swordsmen from the front rank.', SPECIAL),
  h('Roland', 'knight', 'm', C(CR.swordsmen), 'leadership 1, armorer 1', null, 'A seasoned king who never forgot how to hold a shield.', SPECIAL),
  h('Sir Mullich', 'knight', 'm', SPD(2), 'leadership 2', null, 'A restless, driven knight whose troops never march slowly.', SPECIAL),
  h('Beatrice', 'knight', 'f', SK('scouting'), 'leadership 1, scouting 1', null, 'A royal pathfinder who maps the borders of the realm.', SPECIAL),

  // ================================= RAMPART =================================
  h('Clancy', 'ranger', 'm', C(CR.unicorns), 'resistance 1, pathfinding 1', null, 'A woodsman trusted by the unicorn herds.'),
  h('Ivor', 'ranger', 'm', C(CR.elves), 'archery 1, offense 1', null, 'An elven marksman of legendary patience.'),
  h('Jenova', 'ranger', 'f', GOLD, 'archery 2', null, 'A noblewoman whose family fortune pays for every campaign.'),
  h('Kyrre', 'ranger', 'f', SK('logistics'), 'archery 1, logistics 1', null, 'A tireless scout who knows every forest trail.'),
  h('Mephala', 'ranger', 'f', SK('armorer'), 'leadership 1, armorer 1', null, 'A warden who has never lost a battle she chose to defend.'),
  h('Ryland', 'ranger', 'm', C(CR.dendroids), 'leadership 1, diplomacy 1', null, 'A diplomat who speaks for the trees, and they for him.'),
  h('Thorgrim', 'ranger', 'm', SK('resistance'), 'resistance 2', null, 'A dwarf who simply refuses to be enchanted.'),
  h('Ufretin', 'ranger', 'm', C(CR.dwarves), 'resistance 1, luck 1', null, 'A dwarven chieftain with uncanny good fortune.'),
  h('Aeris', 'druid', 'm', C(CR.pegasi), 'wisdom 1, scouting 1', 'protection_from_air', 'A sky-watcher who rides with the pegasi.'),
  h('Alagar', 'druid', 'm', SP('ice_bolt'), 'wisdom 1, sorcery 1', 'ice_bolt', 'A hermit of the frozen peaks.'),
  h('Coronius', 'druid', 'm', SP('slayer', 'tiered', [4, 3, 2, 1, 0, 0, 0]), 'wisdom 1, scholar 1', 'slayer', 'A hunter of great beasts.'),
  h('Elleshar', 'druid', 'm', SK('intelligence'), 'wisdom 1, intelligence 1', 'curse', 'An elven sage with a bottomless memory.'),
  h('Gem', 'druid', 'f', SK('first_aid'), 'wisdom 1, first_aid 1', 'summon_boat', 'A wandering healer who settled among the forest folk.', { machine: 'first_aid_tent' }),
  h('Malcom', 'druid', 'm', SK('eagle_eye'), 'wisdom 1, eagle_eye 1', 'magic_arrow', 'A curious druid who studies every spell he sees.'),
  h('Melodia', 'druid', 'f', SP('fortune', 'tiered'), 'wisdom 1, luck 1', 'fortune', 'Fortune has smiled on her since birth.'),
  h('Uland', 'druid', 'm', SP('cure'), 'wisdom 2, ballistics 1', 'cure', 'An old healer who has seen every wound.'),
  h('Gelu', 'ranger', 'm', CU(['archer', 'marksman', 'wood_elf', 'grand_elf'], 'sharpshooter'), 'archery 1, leadership 1', null, 'A half-elf marksman who trains bowmen of both bloodlines.', SPECIAL),
  h('Giselle', 'ranger', 'f', SK('interference'), 'interference 2', null, 'A ranger whose presence unravels hostile sorcery.', SPECIAL),

  // ================================= TOWER =================================
  h('Fafner', 'alchemist', 'm', C(CR.nagas), 'scholar 1, resistance 1', 'haste', 'A scholar who earned the trust of the naga queens.'),
  h('Iona', 'alchemist', 'f', C(CR.genies), 'scholar 1, intelligence 1', 'magic_arrow', 'A genie freed from her lamp.'),
  h('Josephine', 'alchemist', 'f', C(CR.golems), 'mysticism 1, sorcery 1', 'haste', 'A golem-maker of rare skill.'),
  h('Neela', 'alchemist', 'f', SK('armorer'), 'scholar 1, armorer 1', 'shield', 'An armorer who alloys steel with magic.'),
  h('Piquedram', 'alchemist', 'm', C(CR.gargoyles), 'mysticism 1, scouting 1', 'shield', 'A sculptor whose statues fly.'),
  h('Rissa', 'alchemist', 'f', R('mercury', 1), 'mysticism 1, offense 1', 'magic_arrow', 'An alchemist who distils quicksilver from thin air.'),
  h('Thane', 'alchemist', 'm', C(CR.genies), 'scholar 2', 'magic_arrow', 'A genie lord of the high towers.'),
  h('Torosar', 'alchemist', 'm', WM('ballista'), 'mysticism 1, tactics 1', 'magic_arrow', 'An engineer who builds ballistae of his own design.', { machine: 'ballista' }),
  h('Aine', 'wizard', 'f', GOLD, 'wisdom 1, scholar 1', 'curse', 'A careful treasurer who counts every coin twice.'),
  h('Astral', 'wizard', 'm', SP('hypnotize'), 'wisdom 2', 'hypnotize', 'A master of the mind who bends others to his will.'),
  h('Cyra', 'wizard', 'f', SP('haste', 'tiered'), 'wisdom 1, diplomacy 1', 'haste', 'A quick-witted enchantress and envoy.'),
  h('Daremyth', 'wizard', 'm', SP('fortune', 'tiered'), 'wisdom 1, intelligence 1', 'fortune', 'A wizard gambler who swears the dice like him.'),
  h('Halon', 'wizard', 'm', SK('mysticism'), 'wisdom 1, mysticism 1', 'stone_skin', 'A mystic who draws power from meditation.'),
  h('Serena', 'wizard', 'f', SK('eagle_eye'), 'wisdom 1, eagle_eye 1', 'dispel', 'An observer who records every spell she witnesses.'),
  h('Solmyr', 'wizard', 'm', SP('chain_lightning'), 'wisdom 1, sorcery 1', 'chain_lightning', 'A storm-caller who speaks to lightning as to an old friend.'),
  h('Theodorus', 'wizard', 'm', C(CR.magi), 'wisdom 1, ballistics 1', 'shield', 'Headmaster of a school of magi.'),
  h('Dracon', 'wizard', 'm', CU(['monk', 'zealot', 'mage', 'arch_mage'], 'enchanter'), 'wisdom 2', 'haste', 'A wizard-scholar who forges apprentices into enchanters.', SPECIAL),

  // ================================= INFERNO =================================
  h('Calh', 'demoniac', 'm', C(CR.gogs), 'archery 1, scouting 1', null, 'A fire-thrower who leads from the back.'),
  h('Fiona', 'demoniac', 'f', C(CR.hellHounds), 'scouting 2', null, 'Houndmistress of the burning kennels.'),
  h('Ignatius', 'demoniac', 'm', C(CR.imps), 'tactics 1, resistance 1', null, 'A cunning master of swarming imps.'),
  h('Marius', 'demoniac', 'm', C(CR.demons), 'armorer 2', null, 'A demon general clad in hell-forged plate.'),
  h('Nymus', 'demoniac', 'f', C(CR.pitFiends), 'offense 2', null, 'A pit lord\'s favoured lieutenant.'),
  h('Octavia', 'demoniac', 'f', GOLD, 'scholar 1, offense 1', null, 'She trades in souls, and business is good.'),
  h('Pyre', 'demoniac', 'f', WM('ballista'), 'logistics 1, artillery 1', null, 'Her ballista bolts burn as they fly.', { machine: 'ballista' }),
  h('Rashka', 'demoniac', 'm', C(CR.efreet), 'scholar 1, wisdom 1', null, 'An efreet lord of the fire plane.'),
  h('Ash', 'heretic', 'f', SP('bloodlust', 'tiered'), 'wisdom 1, eagle_eye 1', 'bloodlust', 'A priestess who whips her troops into a frenzy.'),
  h('Axsis', 'heretic', 'm', SK('mysticism'), 'wisdom 1, mysticism 1', 'protection_from_air', 'A demon mystic of the deep vents.'),
  h('Ayden', 'heretic', 'm', SK('intelligence'), 'wisdom 1, intelligence 1', 'view_earth', 'A defrocked scholar with forbidden knowledge.'),
  h('Calid', 'heretic', 'm', R('sulfur', 1), 'wisdom 1, learning 1', 'haste', 'He smells of brimstone, and always has some to spare.'),
  h('Olema', 'heretic', 'f', SP('weakness', 'tiered'), 'wisdom 1, ballistics 1', 'weakness', 'A hag whose curses wither the strong.'),
  h('Xarfax', 'heretic', 'm', SP('fireball'), 'wisdom 1, leadership 1', 'fireball', 'A pyromancer who loves his work.'),
  h('Xyron', 'heretic', 'm', SP('inferno'), 'wisdom 1, scholar 1', 'inferno', 'A fallen wizard who studied the fires below the world.'),
  h('Zydar', 'heretic', 'm', SK('sorcery'), 'wisdom 1, sorcery 1', 'stone_skin', 'A demon sorcerer of terrible precision.'),
  h('Xeron', 'demoniac', 'm', CB(CR.devils, { attack: 4, defense: 2, speed: 1 }), 'leadership 1, tactics 1', null, 'A devil general with an appetite for doomsday weapons.', SPECIAL),

  // ================================= NECROPOLIS =================================
  h('Charna', 'death_knight', 'f', C(CR.wights), 'necromancy 1, tactics 1', 'magic_arrow', 'A wraith-queen who commands the restless dead.'),
  h('Clavius', 'death_knight', 'm', GOLD, 'necromancy 1, offense 1', 'magic_arrow', 'A dead baron who still collects his rents.'),
  h('Galthran', 'death_knight', 'm', C(CR.skeletons), 'necromancy 1, armorer 1', 'shield', 'His skeleton legions grow after every battle.'),
  h('Isra', 'death_knight', 'f', SK('necromancy'), 'necromancy 2', 'magic_arrow', 'A death knight obsessed with the art of raising the dead.'),
  h('Moandor', 'death_knight', 'm', C(CR.liches), 'necromancy 1, learning 1', 'slow', 'A lich who traded his crown for a sword.'),
  h('Straker', 'death_knight', 'm', C(CR.walkingDead), 'necromancy 1, resistance 1', 'haste', 'A plague-lord followed by shambling hordes.'),
  h('Tamika', 'death_knight', 'f', C(CR.blackKnights), 'necromancy 1, offense 1', 'magic_arrow', 'She rides at the head of the dread knights.'),
  h('Vokial', 'death_knight', 'm', C(CR.vampires), 'necromancy 1, artillery 1', 'stone_skin', 'A vampire lord of ancient lineage.'),
  h('Aislinn', 'necromancer', 'f', SP('meteor_shower'), 'necromancy 1, wisdom 1', 'meteor_shower', 'A star-gazer who learned to pull the stars down.'),
  h('Nagash', 'necromancer', 'm', GOLD, 'necromancy 1, intelligence 1', 'protection_from_air', 'A tomb-robber who robbed one tomb too many.'),
  h('Nimbus', 'necromancer', 'm', SK('eagle_eye'), 'necromancy 1, eagle_eye 1', 'shield', 'A lich who steals the spells of the living.'),
  h('Sandro', 'necromancer', 'm', SK('sorcery'), 'necromancy 1, sorcery 1', 'slow', 'A patient lich who plays every side against the others.'),
  h('Septienna', 'necromancer', 'f', SP('death_ripple'), 'necromancy 1, scholar 1', 'death_ripple', 'She sends waves of death across the field.'),
  h('Thant', 'necromancer', 'm', SP('animate_dead'), 'necromancy 1, mysticism 1', 'animate_dead', 'His dead never stay down for long.'),
  h('Vidomina', 'necromancer', 'f', SK('necromancy'), 'necromancy 2', 'curse', 'A prodigy of the dark arts, expelled from three academies.'),
  h('Xsi', 'necromancer', 'f', SP('stone_skin', 'tiered'), 'necromancy 1, learning 1', 'stone_skin', 'A cold-hearted sorceress with stone-hard minions.'),
  h('Lord Haart', 'death_knight', 'm', CB(CR.blackKnights, { attack: 5, defense: 5, damage: 10 }), 'necromancy 2', 'slow', 'A fallen noble who rides again at the head of dark cavalry.', { id: 'lord_haart_undead', special: true }),
  h('Ranloo', 'death_knight', 'm', WM('ballista'), 'necromancy 1, artillery 1', 'haste', 'A dead siege-master who never misses.', { special: true, machine: 'ballista' }),

  // ================================= DUNGEON =================================
  h('Ajit', 'overlord', 'm', C(CR.beholders), 'leadership 1, resistance 1', null, 'A beholder tyrant who sees everything.'),
  h('Arlach', 'overlord', 'm', WM('ballista'), 'offense 1, artillery 1', null, 'An overlord fond of very large crossbows.', { machine: 'ballista' }),
  h('Dace', 'overlord', 'm', C(CR.minotaurs), 'tactics 1, offense 1', null, 'A minotaur king who has never retreated.'),
  h('Damacon', 'overlord', 'm', GOLD, 'offense 2', null, 'A slaver grown rich on the misery of others.'),
  h('Gunnar', 'overlord', 'm', SK('logistics'), 'tactics 1, logistics 1', null, 'A tunnel-runner who knows every shortcut underground.'),
  h('Lorelei', 'overlord', 'f', C(CR.harpies), 'leadership 1, scouting 1', null, 'Queen of the harpy roosts.'),
  h('Shakti', 'overlord', 'm', C(CR.troglodytes), 'offense 1, tactics 1', null, 'A troglodyte chieftain with endless swarms.'),
  h('Synca', 'overlord', 'f', C(CR.manticores), 'leadership 1, scholar 1', null, 'She tames manticores by hand.'),
  h('Alamar', 'warlock', 'm', SP('resurrection'), 'wisdom 1, scholar 1', 'resurrection', 'A warlock who cheats death for his servants.'),
  h('Darkstorn', 'warlock', 'm', SP('stone_skin', 'tiered'), 'wisdom 1, learning 1', 'stone_skin', 'A patient tunnel-mage.'),
  h('Deemer', 'warlock', 'm', SP('meteor_shower'), 'wisdom 1, scouting 2', 'meteor_shower', 'He collapses caverns on his enemies.'),
  h('Geon', 'warlock', 'm', SK('eagle_eye'), 'wisdom 1, eagle_eye 1', 'slow', 'A many-eyed watcher of other mages.'),
  h('Jaegar', 'warlock', 'm', SK('mysticism'), 'wisdom 1, mysticism 1', 'shield', 'A recluse brimming with stored power.'),
  h('Jeddite', 'warlock', 'm', SP('resurrection'), 'wisdom 2', 'resurrection', 'A prodigy who mastered the highest magics young.'),
  h('Malekith', 'warlock', 'm', SK('sorcery'), 'wisdom 1, sorcery 1', 'bloodlust', 'A sorcerer whose spells strike harder than steel.'),
  h('Sephinroth', 'warlock', 'f', R('crystal', 1), 'wisdom 1, intelligence 1', 'protection_from_air', 'A pirate\'s daughter who grows crystals in the dark.'),
  h('Mutare', 'overlord', 'f', CB(CR.dragons, { attack: 5, defense: 5 }), 'estates 1, tactics 1', 'magic_arrow', 'An overlord who envies the dragons she commands.', SPECIAL),
  h('Mutare Drake', 'overlord', 'f', CB(CR.dragons, { attack: 5, defense: 5 }), 'estates 1, tactics 1', 'magic_arrow', 'An overlord who drank something she should not have, and grew scales.', SPECIAL),

  // ================================= STRONGHOLD =================================
  h('Crag Hack', 'barbarian', 'm', SK('offense'), 'offense 2', null, 'A brawler whose name alone sends tax collectors running.'),
  h('Gretchin', 'barbarian', 'f', C(CR.goblins), 'offense 1, pathfinding 1', null, 'A goblin queen who leads from the front.'),
  h('Gurnisson', 'barbarian', 'm', WM('ballista'), 'offense 1, artillery 1', null, 'An ogre who throws spears the size of trees.', { machine: 'ballista' }),
  h('Jabarkas', 'barbarian', 'm', C(CR.orcs), 'offense 1, archery 1', null, 'An orc chieftain and deadly axe-thrower.'),
  h('Krellion', 'barbarian', 'm', C(CR.ogres), 'offense 1, resistance 1', null, 'An ogre lord too stubborn to bewitch.'),
  h('Shiva', 'barbarian', 'f', C(CR.rocs), 'offense 1, scouting 1', null, 'She hunts from the back of a thunderbird.'),
  h('Tyraxor', 'barbarian', 'm', C(CR.wolfRiders), 'offense 1, tactics 1', null, 'A wolf-lord who raids before dawn.'),
  h('Yog', 'barbarian', 'm', C(CR.cyclopes), 'offense 1, ballistics 1', null, 'A half-genie who chose the axe over the wand.'),
  h('Dessa', 'battle_mage', 'f', SK('logistics'), 'wisdom 1, logistics 1', 'stone_skin', 'A wandering shaman who never rests.'),
  h('Gird', 'battle_mage', 'f', SK('sorcery'), 'wisdom 1, sorcery 1', 'bloodlust', 'A fierce shamaness of the waste tribes.'),
  h('Gundula', 'battle_mage', 'f', SK('offense'), 'wisdom 1, offense 1', 'slow', 'A war-witch as dangerous with a club as with a spell.'),
  h('Oris', 'battle_mage', 'm', SK('eagle_eye'), 'wisdom 1, eagle_eye 1', 'protection_from_air', 'A one-eyed seer who misses nothing.'),
  h('Saurug', 'battle_mage', 'm', R('gems', 1), 'wisdom 1, resistance 1', 'bloodlust', 'A gem-hoarding ogre mage.'),
  h('Terek', 'battle_mage', 'm', SP('haste', 'tiered'), 'wisdom 1, tactics 1', 'haste', 'His raiders strike before the alarm is raised.'),
  h('Vey', 'battle_mage', 'f', C(CR.ogres), 'wisdom 1, leadership 1', 'magic_arrow', 'An ogre mage matriarch.'),
  h('Zubin', 'battle_mage', 'm', SP('precision', 'tiered'), 'wisdom 1, artillery 1', 'precision', 'A shaman who guides every arrow.'),
  h('Kilgor', 'barbarian', 'm', CB(CR.behemoths, { attack: 5, defense: 5, damage: 10 }), 'offense 2', null, 'A hulking warlord who keeps a pack of behemoths as pets.', SPECIAL),
  h('Boragus', 'barbarian', 'm', C(CR.ogres), 'offense 1, tactics 1', null, 'An ogre duke who rules by custom and by club.', SPECIAL),

  // ================================= FORTRESS =================================
  h('Alkin', 'beastmaster', 'm', C(CR.gorgons), 'armorer 1, offense 1', null, 'A herdsman of the deadly gorgons.'),
  h('Broghild', 'beastmaster', 'm', C(CR.wyverns), 'armorer 1, scouting 1', null, 'A wyvern-rider of the high marsh.'),
  h('Bron', 'beastmaster', 'm', C(CR.basilisks), 'armorer 1, resistance 1', null, 'He stares down basilisks for sport.'),
  h('Drakon', 'beastmaster', 'm', C(CR.gnolls), 'armorer 1, leadership 1', null, 'A gnoll warlord of the mudlands.'),
  h('Gerwulf', 'beastmaster', 'm', WM('ballista'), 'armorer 1, artillery 1', null, 'A swamp engineer and crack shot.', { machine: 'ballista' }),
  h('Korbac', 'beastmaster', 'm', C(CR.serpentFlies), 'armorer 1, pathfinding 1', null, 'He breeds serpent flies in the deep fens.'),
  h('Tazar', 'beastmaster', 'm', SK('armorer'), 'armorer 2', null, 'A stubborn defender who has never lost a wall he chose to hold.'),
  h('Wystan', 'beastmaster', 'm', C(CR.lizardmen), 'armorer 1, archery 1', null, 'A lizardman hunter with a perfect aim.'),
  h('Andra', 'witch', 'f', SK('intelligence'), 'wisdom 1, intelligence 1', 'dispel', 'A swamp oracle of deep learning.'),
  h('Merist', 'witch', 'f', SP('stone_skin', 'tiered'), 'wisdom 1, learning 1', 'stone_skin', 'A hedge-witch who hardens hide into rock.'),
  h('Mirlanda', 'witch', 'f', SP('weakness', 'tiered'), 'wisdom 2', 'weakness', 'Her hexes turn warriors into weaklings.'),
  h('Rosic', 'witch', 'f', SK('mysticism'), 'wisdom 1, mysticism 1', 'magic_arrow', 'She draws power from the swamp mists.'),
  h('Styg', 'witch', 'f', SK('sorcery'), 'wisdom 1, sorcery 1', 'shield', 'A bog sorceress of fearsome talent.'),
  h('Tiva', 'witch', 'f', SK('eagle_eye'), 'wisdom 1, eagle_eye 1', 'stone_skin', 'A sharp-eyed collector of spells.'),
  h('Verdish', 'witch', 'f', SK('first_aid'), 'wisdom 1, first_aid 1', 'protection_from_fire', 'A herbalist whose poultices close any wound.', { machine: 'first_aid_tent' }),
  h('Voy', 'witch', 'f', SK('navigation'), 'wisdom 1, navigation 1', 'slow', 'A river-witch who steers by the stars.'),
  h('Adrienne', 'witch', 'f', MS('fire'), 'wisdom 1, fire_magic 3', 'inferno', 'A swamp witch whose flames burn hotter than any forge.', SPECIAL),
  h('Kinkeria', 'witch', 'f', SK('learning'), 'wisdom 1, learning 1', 'slow', 'An ever-curious witch who learns from everything.', SPECIAL),

  // ================================= CONFLUX =================================
  h('Pasis', 'planeswalker', 'f', CB(CR.psychic, { attack: 3, defense: 3 }), 'offense 1, artillery 1', null, 'A mind-walker bound to the psychic elementals.'),
  h('Thunar', 'planeswalker', 'f', CB(CR.earth, { attack: 2, defense: 1, damage: 5 }), 'tactics 1, estates 1', null, 'A daughter of stone.'),
  h('Ignissa', 'planeswalker', 'f', CB(CR.fire, { attack: 1, defense: 2, damage: 2 }), 'offense 1, artillery 1', null, 'A dancer of the flame plane.'),
  h('Lacus', 'planeswalker', 'm', CB(CR.water, { attack: 2 }), 'tactics 2', null, 'A tide-lord who drowns his foes in their own armour.'),
  h('Monere', 'planeswalker', 'm', CB(CR.psychic, { attack: 3, defense: 3 }), 'offense 1, logistics 1', null, 'A wanderer between minds.'),
  h('Erdamon', 'planeswalker', 'm', CB(CR.earth, { attack: 2, defense: 1, damage: 5 }), 'tactics 1, estates 1', null, 'An earth lord of immense patience.'),
  h('Fiur', 'planeswalker', 'm', CB(CR.fire, { attack: 1, defense: 2, damage: 2 }), 'offense 2', null, 'A fire lord quick to anger.'),
  h('Kalt', 'planeswalker', 'm', CB(CR.water, { attack: 2 }), 'tactics 1, learning 1', null, 'A cold, calculating lord of ice.'),
  h('Luna', 'elementalist', 'f', SP('fire_wall', 'fixed_percent', 100), 'wisdom 1, fire_magic 1', 'fire_wall', 'She walls her enemies in flame.'),
  h('Brissa', 'elementalist', 'f', SP('haste', 'tiered'), 'wisdom 1, air_magic 1', 'haste', 'Swift as the wind she commands.'),
  h('Ciele', 'elementalist', 'f', SP('magic_arrow', 'fixed_percent', 50), 'wisdom 1, water_magic 1', 'magic_arrow', 'Her arrows of pure magic never miss.'),
  h('Labetha', 'elementalist', 'f', SP('stone_skin', 'tiered'), 'wisdom 1, earth_magic 1', 'stone_skin', 'A steady-handed shaper of earth.'),
  h('Inteus', 'elementalist', 'm', SP('bloodlust', 'tiered'), 'wisdom 1, fire_magic 1', 'bloodlust', 'He sets his soldiers\' blood on fire.'),
  h('Aenain', 'elementalist', 'm', SP('disrupting_ray', 'fixed_value', 2), 'wisdom 1, air_magic 1', 'disrupting_ray', 'His rays strip away any armour.'),
  h('Gelare', 'elementalist', 'm', GOLD, 'wisdom 1, water_magic 1', 'dispel', 'A water lord who trades in pearls.'),
  h('Grindan', 'elementalist', 'm', GOLD, 'wisdom 1, earth_magic 1', 'slow', 'An earth lord who knows where the gold veins run.'),

  // ================================= COVE (HotA-style) =================================
  h('Corkes', 'captain', 'm', SK('offense'), 'offense 1, pathfinding 1', null, 'A pirate captain who boards first and asks later.'),
  h('Jeremy', 'captain', 'm', WM('cannon'), 'offense 1, artillery 1', null, 'A gunner who never travels without his cannon.', { machine: 'cannon' }),
  h('Illor', 'captain', 'm', C(CR.stormbirds), 'armorer 1, tactics 1', null, 'A beast-tamer who sails under a cloud of stormbirds.'),
  h('Derek', 'captain', 'm', C(CR.crewMates), 'offense 1, leadership 1', null, 'A bosun beloved by his crew.'),
  h('Elmore', 'captain', 'm', SK('navigation'), 'navigation 2', null, 'The finest helmsman of the southern seas.'),
  h('Leena', 'captain', 'f', GOLD, 'pathfinding 1, estates 1', null, 'A smuggler queen with a share in every cargo.'),
  h('Anabel', 'captain', 'f', C(CR.pirates), 'offense 1, archery 1', null, 'A corsair with a pistol in each hand.'),
  h('Cassiopeia', 'captain', 'f', C(CR.nymphs), 'offense 1, tactics 1', null, 'A captain favoured by the spirits of the sea.'),
  h('Miriam', 'captain', 'f', SK('scouting'), 'logistics 1, scouting 1', null, 'A lookout who sees land a day before anyone else.'),
  h('Andal', 'navigator', 'm', R('crystal', 1), 'wisdom 1, pathfinding 1', 'slow', 'A navigator who reads the future in crystals.'),
  h('Astra', 'navigator', 'f', SP('cure'), 'wisdom 1, luck 1', 'cure', 'A ship\'s healer blessed by the tides.'),
  h('Casmetra', 'navigator', 'f', C(CR.seaWitches), 'wisdom 1, water_magic 1', 'dispel', 'High priestess of the sea witches.'),
  h('Dargem', 'navigator', 'm', SP('air_shield', 'fixed_percent', 25), 'wisdom 1, tactics 1', 'air_shield', 'He bends the wind into a wall.'),
  h('Eovacius', 'navigator', 'm', SP('clone', 'level_scaled'), 'wisdom 1, intelligence 1', 'clone', 'A mirror-mage of many faces.'),
  h('Manfred', 'navigator', 'm', SP('fireball'), 'wisdom 1, fire_magic 1', 'fireball', 'A fire-mage banned from every wooden deck.'),
  h('Spint', 'navigator', 'm', SK('sorcery'), 'wisdom 1, sorcery 1', 'bless', 'A weather-worker of the trade routes.'),
  h('Zilare', 'navigator', 'f', SP('forgetfulness', 'level_scaled'), 'wisdom 1, interference 1', 'forgetfulness', 'Her victims forget which end of the bow to hold.'),
  h('Bidley', 'captain', 'm', CB(['sea_dog'], { attack: 5, defense: 5 }), 'offense 2', null, 'A pirate admiral whose sea dogs fear only him.', SPECIAL),
  h('Tark', 'captain', 'm', C(CR.nixes), 'offense 1, armorer 1', null, 'A nix warrior turned captain.', SPECIAL),

  // ================================= FACTORY (HotA-style) =================================
  h('Henrietta', 'mercenary', 'f', C(CR.halflings), 'leadership 1, luck 1', null, 'A halfling sheriff with a mean throwing arm.'),
  h('Sam', 'mercenary', 'm', C(CR.mechanics), 'offense 1, tactics 1', null, 'A foreman who fights alongside his crew.'),
  h('Tancred', 'mercenary', 'm', C(CR.gunslingers), 'archery 2', null, 'A bounty broker who pays his shooters in advance.'),
  h('Melchior', 'mercenary', 'm', SK('diplomacy'), 'leadership 1, diplomacy 1', null, 'A caravan master who can talk his way past any toll gate.'),
  h('Floribert', 'mercenary', 'm', SK('first_aid'), 'armorer 1, first_aid 1', null, 'A field surgeon with a wagon full of bandages.', { machine: 'first_aid_tent' }),
  h('Wynona', 'mercenary', 'f', SK('scouting'), 'archery 1, scouting 1', null, 'A trail-reader who spots dust clouds long before the riders.'),
  h('Dury', 'mercenary', 'm', SK('armorer'), 'offense 1, armorer 1', null, 'A dune-hardened veteran who patches his own plate.'),
  h('Morton', 'mercenary', 'm', WM('ballista'), 'artillery 1, ballistics 1', null, 'A siege foreman who loves anything that hurls bolts.', { machine: 'ballista' }),
  h('Agar', 'artificer', 'm', C(CR.sandworms), 'wisdom 2', 'view_earth', 'A tinkerer who studies how the great worms tunnel.'),
  h('Bertram', 'artificer', 'm', GOLD, 'wisdom 1, scholar 1', 'magic_arrow', 'A patent holder who lives off his royalties.'),
  h('Celestine', 'artificer', 'f', C(CR.armadillos), 'wisdom 1, pathfinding 1', 'haste', 'She raises armoured herds on the edge of the wastes.'),
  h('Eanswythe', 'artificer', 'f', SP('weakness', 'tiered'), 'wisdom 1, estates 1', 'weakness', 'A landholder whose hexes sap the will to fight.'),
  h('Todd', 'artificer', 'm', C(CR.automatons), 'wisdom 1, tactics 1', 'shield', 'A clockmaker whose soldiers never tire.'),
  h('Wrathmont', 'artificer', 'm', SP('frenzy'), 'wisdom 1, intelligence 1', 'frenzy', 'An engineer with a famously short fuse.'),
  h('Ziph', 'artificer', 'm', SP('lightning_bolt'), 'wisdom 1, sorcery 1', 'lightning_bolt', 'A lightning-tamer of the great foundries.'),
  h('Victoria', 'artificer', 'f', SP('land_mine'), 'wisdom 1, learning 1', 'land_mine', 'A sapper who hides surprises under every road.'),
  h('Frederick', 'artificer', 'm', CB(CR.automatons, { attack: 2, defense: 2, speed: 1 }), 'wisdom 2', 'haste', 'The founder of the Factory and father of the automatons.', SPECIAL),
  h('Tavin', 'mercenary', 'm', C(CR.halflings), 'offense 1, leadership 1', null, 'A halfling hero of the wasteland uprising.', SPECIAL),
];

export const HERO_BY_ID = Object.fromEntries(HEROES.map((d) => [d.id, d]));

/** @param {string} id @returns {HeroDef} */
export function getHeroDef(id) {
  const d = HERO_BY_ID[id];
  if (!d) throw new Error(`Unknown hero: ${id}`);
  return d;
}

/**
 * Regular (tavern-recruitable) heroes of a faction.
 * @param {string} faction @param {boolean} [includeSpecial=false]
 */
export function getFactionHeroes(faction, includeSpecial = false) {
  return HEROES.filter((d) => d.faction === faction && (includeSpecial || !d.special));
}
