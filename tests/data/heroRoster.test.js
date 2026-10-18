// Pins the hero roster to the original game (audit: docs/audit/heroes-artifacts.md).
// SoD rows were cross-checked against the SoD hero table (class, start skills, start spell,
// specialty); Cove/Factory rows against HotA. Format: id: [classId, 'skill level, ...', startSpell,
// specialty key] where the key is type:main-param (see `key()` below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHeroDef, HEROES } from '../../src/data/heroes.js';

function key(h) {
  const s = h.specialty;
  switch (s.type) {
    case 'creature': return `creature:${s.creatures[0]}`;
    case 'creature_bonus': return `bonus:${s.creatures[0]}:${s.attack}/${s.defense}/${s.damage}/${s.speed}`;
    case 'creature_upgrade': return `upgrade:${Object.values(s.upgrades)[0]}`;
    case 'skill': return `skill:${s.skillId}`;
    case 'spell': return `spell:${s.spellId}:${s.mode}`;
    case 'resource': return `res:${s.resource}:${s.amount}`;
    case 'speed': return `speed:${s.value}`;
    case 'war_machine': return `machine:${s.machineId}`;
    case 'mastery': return `mastery:${s.school}`;
    default: return s.type;
  }
}

const SOD = {
  orrin: ['knight', 'leadership 1, archery 1', null, 'skill:archery'],
  valeska: ['knight', 'leadership 1, archery 1', null, 'creature:archer'],
  edric: ['knight', 'leadership 1, armorer 1', null, 'creature:griffin'],
  sylvia: ['knight', 'leadership 1, navigation 1', null, 'skill:navigation'],
  lord_haart: ['knight', 'leadership 1, estates 1', null, 'skill:estates'],
  sorsha: ['knight', 'leadership 1, offense 1', null, 'creature:swordsman'],
  christian: ['knight', 'leadership 1, artillery 1', null, 'machine:ballista'],
  tyris: ['knight', 'leadership 1, tactics 1', null, 'creature:cavalier'],
  rion: ['cleric', 'wisdom 1, first_aid 1', 'stone_skin', 'skill:first_aid'],
  adela: ['cleric', 'wisdom 1, diplomacy 1', 'bless', 'spell:bless:level_scaled'],
  cuthbert: ['cleric', 'wisdom 1, estates 1', 'weakness', 'spell:weakness:tiered'],
  adelaide: ['cleric', 'wisdom 2', 'frost_ring', 'spell:frost_ring:level_scaled'],
  ingham: ['cleric', 'wisdom 1, mysticism 1', 'curse', 'creature:monk'],
  sanya: ['cleric', 'wisdom 1, eagle_eye 1', 'dispel', 'skill:eagle_eye'],
  loynis: ['cleric', 'wisdom 1, learning 1', 'prayer', 'spell:prayer:tiered'],
  caitlin: ['cleric', 'wisdom 1, intelligence 1', 'cure', 'res:gold:350'],
  pasis: ['planeswalker', 'offense 1, artillery 1', null, 'bonus:psychic_elemental:3/3/0/0'],
  thunar: ['planeswalker', 'tactics 1, estates 1', null, 'bonus:earth_elemental:2/1/5/0'],
  ignissa: ['planeswalker', 'offense 1, artillery 1', null, 'bonus:fire_elemental:1/2/2/0'],
  lacus: ['planeswalker', 'tactics 2', null, 'bonus:water_elemental:2/0/0/0'],
  monere: ['planeswalker', 'offense 1, logistics 1', null, 'bonus:psychic_elemental:3/3/0/0'],
  erdamon: ['planeswalker', 'tactics 1, estates 1', null, 'bonus:earth_elemental:2/1/5/0'],
  fiur: ['planeswalker', 'offense 2', null, 'bonus:fire_elemental:1/2/2/0'],
  kalt: ['planeswalker', 'tactics 1, learning 1', null, 'bonus:water_elemental:2/0/0/0'],
  luna: ['elementalist', 'wisdom 1, fire_magic 1', 'fire_wall', 'spell:fire_wall:fixed_percent'],
  brissa: ['elementalist', 'wisdom 1, air_magic 1', 'haste', 'spell:haste:tiered'],
  ciele: ['elementalist', 'wisdom 1, water_magic 1', 'magic_arrow', 'spell:magic_arrow:fixed_percent'],
  labetha: ['elementalist', 'wisdom 1, earth_magic 1', 'stone_skin', 'spell:stone_skin:tiered'],
  inteus: ['elementalist', 'wisdom 1, fire_magic 1', 'bloodlust', 'spell:bloodlust:tiered'],
  aenain: ['elementalist', 'wisdom 1, air_magic 1', 'disrupting_ray', 'spell:disrupting_ray:fixed_value'],
  gelare: ['elementalist', 'wisdom 1, water_magic 1', 'dispel', 'res:gold:350'],
  grindan: ['elementalist', 'wisdom 1, earth_magic 1', 'slow', 'res:gold:350'],
  lorelei: ['overlord', 'leadership 1, scouting 1', null, 'creature:harpy'],
  arlach: ['overlord', 'offense 1, artillery 1', null, 'machine:ballista'],
  dace: ['overlord', 'tactics 1, offense 1', null, 'creature:minotaur'],
  ajit: ['overlord', 'leadership 1, resistance 1', null, 'creature:beholder'],
  damacon: ['overlord', 'offense 2', null, 'res:gold:350'],
  gunnar: ['overlord', 'tactics 1, logistics 1', null, 'skill:logistics'],
  synca: ['overlord', 'leadership 1, scholar 1', null, 'creature:manticore'],
  shakti: ['overlord', 'offense 1, tactics 1', null, 'creature:troglodyte'],
  alamar: ['warlock', 'wisdom 1, scholar 1', 'resurrection', 'spell:resurrection:level_scaled'],
  jaegar: ['warlock', 'wisdom 1, mysticism 1', 'shield', 'skill:mysticism'],
  malekith: ['warlock', 'wisdom 1, sorcery 1', 'bloodlust', 'skill:sorcery'],
  jeddite: ['warlock', 'wisdom 2', 'resurrection', 'spell:resurrection:level_scaled'],
  geon: ['warlock', 'wisdom 1, eagle_eye 1', 'slow', 'skill:eagle_eye'],
  deemer: ['warlock', 'wisdom 1, scouting 2', 'meteor_shower', 'spell:meteor_shower:level_scaled'],
  sephinroth: ['warlock', 'wisdom 1, intelligence 1', 'protection_from_air', 'res:crystal:1'],
  darkstorn: ['warlock', 'wisdom 1, learning 1', 'stone_skin', 'spell:stone_skin:tiered'],
  bron: ['beastmaster', 'armorer 1, resistance 1', null, 'creature:basilisk'],
  drakon: ['beastmaster', 'armorer 1, leadership 1', null, 'creature:gnoll'],
  wystan: ['beastmaster', 'armorer 1, archery 1', null, 'creature:lizardman'],
  tazar: ['beastmaster', 'armorer 2', null, 'skill:armorer'],
  alkin: ['beastmaster', 'armorer 1, offense 1', null, 'creature:gorgon'],
  korbac: ['beastmaster', 'armorer 1, pathfinding 1', null, 'creature:serpent_fly'],
  gerwulf: ['beastmaster', 'armorer 1, artillery 1', null, 'machine:ballista'],
  broghild: ['beastmaster', 'armorer 1, scouting 1', null, 'creature:wyvern'],
  mirlanda: ['witch', 'wisdom 2', 'weakness', 'spell:weakness:tiered'],
  rosic: ['witch', 'wisdom 1, mysticism 1', 'magic_arrow', 'skill:mysticism'],
  voy: ['witch', 'wisdom 1, navigation 1', 'slow', 'skill:navigation'],
  verdish: ['witch', 'wisdom 1, first_aid 1', 'protection_from_fire', 'skill:first_aid'],
  merist: ['witch', 'wisdom 1, learning 1', 'stone_skin', 'spell:stone_skin:tiered'],
  styg: ['witch', 'wisdom 1, sorcery 1', 'shield', 'skill:sorcery'],
  andra: ['witch', 'wisdom 1, intelligence 1', 'dispel', 'skill:intelligence'],
  tiva: ['witch', 'wisdom 1, eagle_eye 1', 'stone_skin', 'skill:eagle_eye'],
  fiona: ['demoniac', 'scouting 2', null, 'creature:hell_hound'],
  rashka: ['demoniac', 'scholar 1, wisdom 1', null, 'creature:efreet'],
  marius: ['demoniac', 'armorer 2', null, 'creature:demon'],
  ignatius: ['demoniac', 'tactics 1, resistance 1', null, 'creature:imp'],
  octavia: ['demoniac', 'scholar 1, offense 1', null, 'res:gold:350'],
  calh: ['demoniac', 'archery 1, scouting 1', null, 'creature:gog'],
  pyre: ['demoniac', 'logistics 1, artillery 1', null, 'machine:ballista'],
  nymus: ['demoniac', 'offense 2', null, 'creature:pit_fiend'],
  ayden: ['heretic', 'wisdom 1, intelligence 1', 'view_earth', 'skill:intelligence'],
  xyron: ['heretic', 'wisdom 1, scholar 1', 'inferno', 'spell:inferno:level_scaled'],
  axsis: ['heretic', 'wisdom 1, mysticism 1', 'protection_from_air', 'skill:mysticism'],
  olema: ['heretic', 'wisdom 1, ballistics 1', 'weakness', 'spell:weakness:tiered'],
  calid: ['heretic', 'wisdom 1, learning 1', 'haste', 'res:sulfur:1'],
  ash: ['heretic', 'wisdom 1, eagle_eye 1', 'bloodlust', 'spell:bloodlust:tiered'],
  zydar: ['heretic', 'wisdom 1, sorcery 1', 'stone_skin', 'skill:sorcery'],
  xarfax: ['heretic', 'wisdom 1, leadership 1', 'fireball', 'spell:fireball:level_scaled'],
  straker: ['death_knight', 'necromancy 1, resistance 1', 'haste', 'creature:walking_dead'],
  vokial: ['death_knight', 'necromancy 1, artillery 1', 'stone_skin', 'creature:vampire'],
  moandor: ['death_knight', 'necromancy 1, learning 1', 'slow', 'creature:lich'],
  charna: ['death_knight', 'necromancy 1, tactics 1', 'magic_arrow', 'creature:wight'],
  tamika: ['death_knight', 'necromancy 1, offense 1', 'magic_arrow', 'creature:black_knight'],
  isra: ['death_knight', 'necromancy 2', 'magic_arrow', 'skill:necromancy'],
  clavius: ['death_knight', 'necromancy 1, offense 1', 'magic_arrow', 'res:gold:350'],
  galthran: ['death_knight', 'necromancy 1, armorer 1', 'shield', 'creature:skeleton'],
  septienna: ['necromancer', 'necromancy 1, scholar 1', 'death_ripple', 'spell:death_ripple:level_scaled'],
  aislinn: ['necromancer', 'necromancy 1, wisdom 1', 'meteor_shower', 'spell:meteor_shower:level_scaled'],
  sandro: ['necromancer', 'necromancy 1, sorcery 1', 'slow', 'skill:sorcery'],
  nimbus: ['necromancer', 'necromancy 1, eagle_eye 1', 'shield', 'skill:eagle_eye'],
  thant: ['necromancer', 'necromancy 1, mysticism 1', 'animate_dead', 'spell:animate_dead:level_scaled'],
  xsi: ['necromancer', 'necromancy 1, learning 1', 'stone_skin', 'spell:stone_skin:tiered'],
  vidomina: ['necromancer', 'necromancy 2', 'curse', 'skill:necromancy'],
  nagash: ['necromancer', 'necromancy 1, intelligence 1', 'protection_from_air', 'res:gold:350'],
  mephala: ['ranger', 'leadership 1, armorer 1', null, 'skill:armorer'],
  ufretin: ['ranger', 'resistance 1, luck 1', null, 'creature:dwarf'],
  jenova: ['ranger', 'archery 2', null, 'res:gold:350'],
  ryland: ['ranger', 'leadership 1, diplomacy 1', null, 'creature:dendroid_guard'],
  thorgrim: ['ranger', 'resistance 2', null, 'skill:resistance'],
  ivor: ['ranger', 'archery 1, offense 1', null, 'creature:wood_elf'],
  clancy: ['ranger', 'resistance 1, pathfinding 1', null, 'creature:unicorn'],
  kyrre: ['ranger', 'archery 1, logistics 1', null, 'skill:logistics'],
  coronius: ['druid', 'wisdom 1, scholar 1', 'slayer', 'spell:slayer:tiered'],
  uland: ['druid', 'wisdom 2, ballistics 1', 'cure', 'spell:cure:level_scaled'],
  elleshar: ['druid', 'wisdom 1, intelligence 1', 'curse', 'skill:intelligence'],
  gem: ['druid', 'wisdom 1, first_aid 1', 'summon_boat', 'skill:first_aid'],
  malcom: ['druid', 'wisdom 1, eagle_eye 1', 'magic_arrow', 'skill:eagle_eye'],
  melodia: ['druid', 'wisdom 1, luck 1', 'fortune', 'spell:fortune:tiered'],
  alagar: ['druid', 'wisdom 1, sorcery 1', 'ice_bolt', 'spell:ice_bolt:level_scaled'],
  aeris: ['druid', 'wisdom 1, scouting 1', 'protection_from_air', 'creature:pegasus'],
  sir_mullich: ['knight', 'leadership 2', null, 'speed:2'],
  adrienne: ['witch', 'wisdom 1, fire_magic 3', 'inferno', 'mastery:fire'],
  catherine: ['knight', 'leadership 1, offense 1', null, 'creature:swordsman'],
  dracon: ['wizard', 'wisdom 2', 'haste', 'upgrade:enchanter'],
  gelu: ['ranger', 'archery 1, leadership 1', null, 'upgrade:sharpshooter'],
  kilgor: ['barbarian', 'offense 2', null, 'bonus:behemoth:5/5/10/0'],
  lord_haart_undead: ['death_knight', 'necromancy 2', 'slow', 'bonus:black_knight:5/5/10/0'],
  mutare: ['overlord', 'estates 1, tactics 1', 'magic_arrow', 'bonus:green_dragon:5/5/0/0'],
  roland: ['knight', 'leadership 1, armorer 1', null, 'creature:swordsman'],
  mutare_drake: ['overlord', 'estates 1, tactics 1', 'magic_arrow', 'bonus:green_dragon:5/5/0/0'],
  boragus: ['barbarian', 'offense 1, tactics 1', null, 'creature:ogre'],
  xeron: ['demoniac', 'leadership 1, tactics 1', null, 'bonus:devil:4/2/0/1'],
  yog: ['barbarian', 'offense 1, ballistics 1', null, 'creature:cyclops'],
  gurnisson: ['barbarian', 'offense 1, artillery 1', null, 'machine:ballista'],
  jabarkas: ['barbarian', 'offense 1, archery 1', null, 'creature:orc'],
  shiva: ['barbarian', 'offense 1, scouting 1', null, 'creature:roc'],
  gretchin: ['barbarian', 'offense 1, pathfinding 1', null, 'creature:goblin'],
  krellion: ['barbarian', 'offense 1, resistance 1', null, 'creature:ogre'],
  crag_hack: ['barbarian', 'offense 2', null, 'skill:offense'],
  tyraxor: ['barbarian', 'offense 1, tactics 1', null, 'creature:wolf_rider'],
  gird: ['battle_mage', 'wisdom 1, sorcery 1', 'bloodlust', 'skill:sorcery'],
  vey: ['battle_mage', 'wisdom 1, leadership 1', 'magic_arrow', 'creature:ogre'],
  dessa: ['battle_mage', 'wisdom 1, logistics 1', 'stone_skin', 'skill:logistics'],
  terek: ['battle_mage', 'wisdom 1, tactics 1', 'haste', 'spell:haste:tiered'],
  zubin: ['battle_mage', 'wisdom 1, artillery 1', 'precision', 'spell:precision:tiered'],
  gundula: ['battle_mage', 'wisdom 1, offense 1', 'slow', 'skill:offense'],
  oris: ['battle_mage', 'wisdom 1, eagle_eye 1', 'protection_from_air', 'skill:eagle_eye'],
  saurug: ['battle_mage', 'wisdom 1, resistance 1', 'bloodlust', 'res:gems:1'],
  piquedram: ['alchemist', 'mysticism 1, scouting 1', 'shield', 'creature:stone_gargoyle'],
  thane: ['alchemist', 'scholar 2', 'magic_arrow', 'creature:genie'],
  josephine: ['alchemist', 'mysticism 1, sorcery 1', 'haste', 'creature:stone_golem'],
  neela: ['alchemist', 'scholar 1, armorer 1', 'shield', 'skill:armorer'],
  torosar: ['alchemist', 'mysticism 1, tactics 1', 'magic_arrow', 'machine:ballista'],
  fafner: ['alchemist', 'scholar 1, resistance 1', 'haste', 'creature:naga'],
  rissa: ['alchemist', 'mysticism 1, offense 1', 'magic_arrow', 'res:mercury:1'],
  iona: ['alchemist', 'scholar 1, intelligence 1', 'magic_arrow', 'creature:genie'],
  astral: ['wizard', 'wisdom 2', 'hypnotize', 'spell:hypnotize:level_scaled'],
  halon: ['wizard', 'wisdom 1, mysticism 1', 'stone_skin', 'skill:mysticism'],
  serena: ['wizard', 'wisdom 1, eagle_eye 1', 'dispel', 'skill:eagle_eye'],
  daremyth: ['wizard', 'wisdom 1, intelligence 1', 'fortune', 'spell:fortune:tiered'],
  theodorus: ['wizard', 'wisdom 1, ballistics 1', 'shield', 'creature:mage'],
  solmyr: ['wizard', 'wisdom 1, sorcery 1', 'chain_lightning', 'spell:chain_lightning:level_scaled'],
  cyra: ['wizard', 'wisdom 1, diplomacy 1', 'haste', 'spell:haste:tiered'],
  aine: ['wizard', 'wisdom 1, scholar 1', 'curse', 'res:gold:350'],
};

const HOTA = {
  corkes: ['captain', 'offense 1, pathfinding 1', null, 'skill:offense'],
  jeremy: ['captain', 'offense 1, artillery 1', null, 'machine:cannon'],
  illor: ['captain', 'armorer 1, tactics 1', null, 'creature:stormbird'],
  derek: ['captain', 'offense 1, leadership 1', null, 'creature:crew_mate'],
  elmore: ['captain', 'navigation 2', null, 'skill:navigation'],
  leena: ['captain', 'pathfinding 1, estates 1', null, 'res:gold:350'],
  anabel: ['captain', 'offense 1, archery 1', null, 'creature:pirate'],
  cassiopeia: ['captain', 'offense 1, tactics 1', null, 'creature:nymph'],
  miriam: ['captain', 'logistics 1, scouting 1', null, 'skill:scouting'],
  andal: ['navigator', 'wisdom 1, pathfinding 1', 'slow', 'res:crystal:1'],
  astra: ['navigator', 'wisdom 1, luck 1', 'cure', 'spell:cure:level_scaled'],
  casmetra: ['navigator', 'wisdom 1, water_magic 1', 'dispel', 'creature:sea_witch'],
  dargem: ['navigator', 'wisdom 1, tactics 1', 'air_shield', 'spell:air_shield:fixed_percent'],
  eovacius: ['navigator', 'wisdom 1, intelligence 1', 'clone', 'spell:clone:level_scaled'],
  manfred: ['navigator', 'wisdom 1, fire_magic 1', 'fireball', 'spell:fireball:level_scaled'],
  spint: ['navigator', 'wisdom 1, sorcery 1', 'bless', 'skill:sorcery'],
  zilare: ['navigator', 'wisdom 1, interference 1', 'forgetfulness', 'spell:forgetfulness:level_scaled'],
  henrietta: ['mercenary', 'leadership 1, luck 1', null, 'creature:halfling'],
  sam: ['mercenary', 'offense 1, tactics 1', null, 'creature:mechanic'],
  tancred: ['mercenary', 'archery 2', null, 'creature:gunslinger'],
  melchior: ['mercenary', 'leadership 1, diplomacy 1', null, 'skill:diplomacy'],
  floribert: ['mercenary', 'armorer 1, first_aid 1', null, 'skill:first_aid'],
  wynona: ['mercenary', 'archery 1, scouting 1', null, 'skill:scouting'],
  dury: ['mercenary', 'offense 1, armorer 1', null, 'skill:armorer'],
  morton: ['mercenary', 'artillery 1, ballistics 1', null, 'machine:ballista'],
  agar: ['artificer', 'wisdom 2', 'view_earth', 'creature:sandworm'],
  bertram: ['artificer', 'wisdom 1, scholar 1', 'magic_arrow', 'res:gold:350'],
  celestine: ['artificer', 'wisdom 1, pathfinding 1', 'haste', 'creature:armadillo'],
  eanswythe: ['artificer', 'wisdom 1, estates 1', 'weakness', 'spell:weakness:tiered'],
  todd: ['artificer', 'wisdom 1, tactics 1', 'shield', 'creature:automaton'],
  wrathmont: ['artificer', 'wisdom 1, intelligence 1', 'frenzy', 'spell:frenzy:level_scaled'],
  ziph: ['artificer', 'wisdom 1, sorcery 1', 'lightning_bolt', 'spell:lightning_bolt:level_scaled'],
  victoria: ['artificer', 'wisdom 1, learning 1', 'land_mine', 'spell:land_mine:level_scaled'],
};

function check(table) {
  for (const [id, [classId, skills, spell, spec]] of Object.entries(table)) {
    const h = getHeroDef(id);
    assert.equal(h.classId, classId, id);
    assert.equal(h.startSkills.map((s) => `${s.id} ${s.level}`).join(', '), skills, id);
    assert.equal(h.startSpell, spell, id);
    assert.equal(key(h), spec, id);
  }
}

test('roster: every SoD hero has the original class, start skills, spell and specialty', () => {
  assert.equal(Object.keys(SOD).length, 156);
  check(SOD);
});

test('roster: Cove and Factory heroes follow HotA', () => {
  check(HOTA);
});

test('roster: spell specialties of the original use the right scaling family', () => {
  // flat "+N on weaker creatures" spells vs. "+3% per level/tier" spells
  const tiered = ['adela', 'cuthbert', 'loynis', 'brissa', 'cyra', 'terek', 'labetha', 'darkstorn', 'merist', 'xsi',
    'inteus', 'ash', 'olema', 'mirlanda', 'zubin', 'coronius', 'melodia', 'daremyth'];
  for (const id of tiered.filter((x) => x !== 'adela')) assert.equal(getHeroDef(id).specialty.mode, 'tiered', id);
  assert.deepEqual(getHeroDef('coronius').specialty.tierBonus, [4, 3, 2, 1, 0, 0, 0]);
  for (const id of ['adela', 'adelaide', 'alamar', 'jeddite', 'deemer', 'aislinn', 'xyron', 'xarfax', 'solmyr',
    'astral', 'uland', 'alagar', 'thant', 'septienna']) {
    assert.equal(getHeroDef(id).specialty.mode, 'level_scaled', id);
  }
});

test('roster: no biography names places or characters of the original setting', () => {
  const banned = /Erathia|Enroth|AvLee|Bracada|Antagarich|Tatalia|Nighon|Eeofol|Krewlod|Deyja|Kreegan|Ironfist|Gryphonheart/;
  for (const h of HEROES) assert.ok(!banned.test(h.biography), h.id);
});
