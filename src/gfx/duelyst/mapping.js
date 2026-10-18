// Mapping tables: H3online entity ids -> Duelyst (CC0) art.
// Every unit below was picked by looking at the sprite sheets (see docs/mechanics/duelyst-assets.md
// for the rationale per faction and for the list of fallbacks). Pure data + tiny deterministic
// helpers; no DOM. Sheet names are keys of assets/duelyst-manifest/{units,icons,fx}.json.
//
// SpriteRef = { unit?: string,          // units.json sheet
//               icon?: string,          // icons.json sheet
//               fx?: string, anim?: string,   // fx.json sheet (+ animation name inside it)
//               image?: string,         // plain image file relative to assets/duelyst/
//               tint?: string, tintAlpha?: number,   // colour laid over the opaque pixels
//               scale?: number, flip?: boolean, alpha?: number }

import { CREATURES } from '../../data/creatures.js';
import { HEROES } from '../../data/heroes.js';
import { HERO_CLASS_BY_ID } from '../../data/heroClasses.js';
import { ARTIFACTS } from '../../data/artifacts.js';
import { SPELLS } from '../../data/spells.js';

const u = (unit, extra) => ({ unit, ...extra });

// ---------------------------------------------------------------------------------------------
// Creatures (190). Upgrades use a visibly related second unit where Duelyst has one, otherwise the
// same unit with a tint (and usually a slightly larger scale).
// ---------------------------------------------------------------------------------------------
/** @type {Record<string, {unit:string, tint?:string, tintAlpha?:number, scale?:number, flip?:boolean, alpha?:number}>} */
export const CREATURE_SPRITES = {
  // Castle - Lyonar (f1): golden knights, priests, lions
  pikeman: u('f1_radiantdragoon'), halberdier: u('f1_kingsguard'),
  archer: u('f1_backlinearcher'), marksman: u('f1_ranged'),
  griffin: u('f1_gryphinox'), royal_griffin: u('f1_gryphinox', { tint: '#ffc830', tintAlpha: 0.4, scale: 1.1 }),
  swordsman: u('f1_warblade'), crusader: u('f1_solpontiff'),
  monk: u('f1_archdeacon'), zealot: u('f1_solarius'),
  cavalier: u('f1_special'), champion: u('f1_grandmasterzir'),
  angel: u('f1_support', { scale: 1.15 }), arch_angel: u('f1_peacekeeper', { scale: 1.2 }),
  // Rampart - Vanar (f6) nature units: centaur dryad, treants, stag
  centaur: u('f6_icedryad'), centaur_captain: u('f6_icedryad', { tint: '#ffb040', tintAlpha: 0.38, scale: 1.08 }),
  dwarf: u('neutral_goldenhammer'), battle_dwarf: u('neutral_gauntletmaster'),
  wood_elf: u('neutral_arrowwhistler', { tint: '#3fbf5a', tintAlpha: 0.45 }), grand_elf: u('neutral_arrowwhistler', { scale: 1.06 }),
  pegasus: u('neutral_skywing'), silver_pegasus: u('neutral_skywing', { tint: '#6fb8ff', tintAlpha: 0.4, scale: 1.08 }),
  dendroid_guard: u('f6_minitreant', { scale: 1.25 }), dendroid_soldier: u('f6_treant'),
  unicorn: u('f6_voiceofthewind'), war_unicorn: u('neutral_sunsetparagon'),
  green_dragon: u('f5_drogon', { scale: 1.3 }), gold_dragon: u('boss_paragon', { scale: 1.3 }),
  // Tower - Vetruvian (f3) constructs and casters + golems
  gremlin: u('f6_snowchaser'), master_gremlin: u('f6_icy'),
  stone_gargoyle: u('f3_buildcommon'), obsidian_gargoyle: u('f1_sunstonemaiden'),
  stone_golem: u('neutral_golemstone'), iron_golem: u('neutral_golemsteel'),
  mage: u('f3_dunecaster'), arch_mage: u('f3_orbweaver'),
  genie: u('f3_windgiver'), master_genie: u('f3_keeperofages'),
  naga: u('neutral_mercfrostbonenaga'), naga_queen: u('boss_antiswarm', { scale: 1.3 }),
  giant: u('f1_kaisergladiator', { scale: 1.2 }), titan: u('f1_excelsious', { scale: 1.25 }),
  // Inferno - Abyssian (f4) demons + fire casters
  imp: u('neutral_zyx'), familiar: u('f4_nocturn'),
  gog: u('f3_pyromancer'), magog: u('f2_kindling'),
  hell_hound: u('f3_badlandsscout'), cerberus: u('f4_husk'),
  demon: u('f4_creepydemon'), horned_demon: u('f4_creepmangler'),
  pit_fiend: u('f4_daemonvoid'), pit_lord: u('f4_megafiend'),
  efreet: u('neutral_spiritscribe'), efreet_sultan: u('neutral_firestarter', { scale: 1.15 }),
  devil: u('boss_solfist', { scale: 1.15 }), arch_devil: u('f4_demonofeternity', { scale: 1.2 }),
  // Necropolis - skeletal / spectral units
  skeleton: u('neutral_ghoulie'), skeleton_warrior: u('neutral_golem_crossbones'),
  walking_dead: u('f4_fallenaspect'), zombie: u('f4_underworldbrute'),
  wight: u('f3_curseddervish'), wraith: u('boss_wraith'),
  vampire: u('boss_vampire'), vampire_lord: u('boss_malyk'),
  lich: u('neutral_bonereaper'), power_lich: u('boss_legion'),
  black_knight: u('boss_gol'), dread_knight: u('boss_chaosknight'),
  bone_dragon: u('neutral_serpenti', { scale: 1.3 }), ghost_dragon: u('boss_serpenti', { scale: 1.3, tint: '#8ff0d8', tintAlpha: 0.3, alpha: 0.85 }),
  // Dungeon
  troglodyte: u('f5_thraex'), infernal_troglodyte: u('f5_rancour'),
  harpy: u('neutral_silverbeak'), harpy_hag: u('neutral_monsterredsynja'),
  beholder: u('neutral_monsteroculus'), evil_eye: u('neutral_monsterputridmindflayer'),
  medusa: u('neutral_artificereshaper'), medusa_queen: u('neutral_whitewidow'),
  minotaur: u('neutral_contentiousbrute'), minotaur_king: u('neutral_taura'),
  manticore: u('neutral_pennyarcade04'), scorpicore: u('neutral_exun'),
  red_dragon: u('neutral_monsterflamewing', { scale: 1.3 }), black_dragon: u('f2_firewyrm', { scale: 1.35 }),
  // Stronghold - tribal units and brutes
  goblin: u('neutral_tribalmelee1'), hobgoblin: u('neutral_tribalmelee2'),
  wolf_rider: u('neutral_letigress'), wolf_raider: u('neutral_letigress', { tint: '#e04030', tintAlpha: 0.35, scale: 1.08 }),
  orc: u('neutral_tribalranged2'), orc_chieftain: u('neutral_tribalranged2', { tint: '#e0a030', tintAlpha: 0.4, scale: 1.1 }),
  ogre: u('neutral_bloodletter'), ogre_mage: u('neutral_darknemesis'),
  roc: u('f5_pteryx'), thunderbird: u('neutral_trinitywing'),
  cyclops: u('neutral_boulderhurler'), cyclops_king: u('neutral_beastrepulsion', { scale: 1.2 }),
  behemoth: u('f5_juggernaut', { scale: 1.2 }), ancient_behemoth: u('neutral_hollowgrovekeeper', { scale: 1.3 }),
  // Fortress - Magmar (f5) reptiles and beasts
  gnoll: u('neutral_tribalmelee3'), gnoll_marauder: u('neutral_tribalmelee4'),
  lizardman: u('f5_molokihuntress'), lizard_warrior: u('f5_vindicator'),
  serpent_fly: u('f6_icehornet'), dragon_fly: u('neutral_blacklocust'),
  basilisk: u('neutral_beastcavern'), greater_basilisk: u('neutral_komodokin'),
  gorgon: u('neutral_wildtahr'), mighty_gorgon: u('f5_kujata'),
  wyvern: u('neutral_dustwailer'), wyvern_monarch: u('neutral_monsterdragonhawk'),
  hydra: u('neutral_hydrax', { scale: 1.3 }), chaos_hydra: u('f4_abomination', { scale: 1.3 }),
  // Conflux - elementals
  pixie: u('neutral_dreamgazer', { scale: 0.85 }), sprite: u('f6_huldra', { scale: 0.9 }),
  air_elemental: u('f3_zephyr'), storm_elemental: u('f3_grandmasternoshrak'),
  water_elemental: u('f6_waterelemental'), ice_elemental: u('neutral_golemice'),
  fire_elemental: u('f3_incinera'), energy_elemental: u('neutral_sunelemental'),
  earth_elemental: u('neutral_golemrunesand'), magma_elemental: u('neutral_monsterdarkharbinger', { scale: 1.3 }),
  psychic_elemental: u('neutral_chaoselemental'), magic_elemental: u('neutral_astralprime'),
  firebird: u('neutral_wingsofparadise', { tint: '#ff7a20', tintAlpha: 0.35 }), phoenix: u('neutral_zurael', { scale: 1.2 }),
  // Cove - pirates and sea creatures
  nymph: u('neutral_celebrant'), oceanid: u('f6_auroraguardian'),
  crew_mate: u('neutral_mercmelee1'), seaman: u('neutral_mercmelee4'),
  pirate: u('neutral_mercpirate'), corsair: u('neutral_captainhankheart'), sea_dog: u('neutral_hsuku'),
  stormbird: u('f2_orizuru'), ayssid: u('f2_orizuru', { tint: '#3a90ff', tintAlpha: 0.42, scale: 1.1 }),
  sea_witch: u('neutral_mercsongweaver'), sorceress: u('boss_andromeda'),
  nix: u('boss_crystal'), nix_warrior: u('neutral_thegreatprotector'),
  sea_serpent: u('neutral_luxignis', { scale: 1.3 }), haspid: u('boss_soulstealer', { scale: 1.35 }),
  // Factory - gunners, tinkerers, machines, worms
  halfling: u('neutral_mercranged1'), halfling_grenadier: u('neutral_mercgrenadier'),
  mechanic: u('f3_palacetrinketeer'), engineer: u('neutral_artificer'),
  armadillo: u('neutral_khymera'), bellwether_armadillo: u('f5_ankylos'),
  automaton: u('neutral_deceptib0t'), sentinel_automaton: u('neutral_silvermech'),
  sandworm: u('neutral_monsterblacksandburrower', { scale: 1.2 }), olgoi_khorkhoi: u('neutral_monstercoiledcrawler', { scale: 1.3 }),
  gunslinger: u('f2_flareslinger'), bounty_hunter: u('neutral_grimes'),
  couatl: u('neutral_koi', { scale: 1.5 }), crimson_couatl: u('neutral_koi', { scale: 1.6, tint: '#e02030', tintAlpha: 0.45 }),
  dreadnought: u('f3_zodiac', { scale: 1.35 }), juggernaut: u('f3_zodiac02', { scale: 1.45, tint: '#c8281e', tintAlpha: 0.38 }),
  // Neutral
  peasant: u('neutral_mercmelee3'), rogue: u('neutral_mercmelee2'),
  boar: u('f2_special'), leprechaun: u('neutral_mrgoldmclover'),
  nomad: u('f1_special', { tint: '#c88a40', tintAlpha: 0.45 }), mummy: u('f3_dervish'),
  satyr: u('neutral_zenrui'), steel_golem: u('neutral_golemstormmetal'),
  sharpshooter: u('neutral_tribalranged1'), troll: u('f5_buildcommon'),
  gold_golem: u('neutral_sunsteeldefender'), fangarm: u('neutral_calculator'),
  diamond_golem: u('neutral_diamondgolem'), enchanter: u('f3_insightcaster'),
  faerie_dragon: u('boss_treatdrake', { scale: 1.3 }), rust_dragon: u('neutral_veteranflamewing', { scale: 1.35, tint: '#b86a20', tintAlpha: 0.4 }),
  crystal_dragon: u('f6_whitewyvern', { scale: 1.4 }), azure_dragon: u('boss_borealjuggernaut', { scale: 1.45 }),
  will_o_wisp: u('neutral_monstercrystalwisp'), dire_wolf: u('f6_spiritwolf'),
  bog_witch: u('f4_mistressofcommands'), giant_spider: u('f4_daemondeep', { scale: 1.2 }),
  shadow_assassin: u('neutral_silhouettetracer'), clockwork_knight: u('f1_mech'),
  frost_giant: u('f6_draugarlord', { scale: 1.25 }), bone_colossus: u('neutral_golemdragonbone', { scale: 1.3 }),
  storm_drake: u('f6_frostdrake', { scale: 1.3 }),
  // War machines (no real siege engines in Duelyst: mechs, gunners and obelisks stand in)
  ballista: u('neutral_mechaz0rcannon'), cannon: u('neutral_rook'), catapult: u('f3_sister'),
  first_aid_tent: u('f3_aymarahealer'), ammo_cart: u('f2_sister'), arrow_tower: u('f3_endlessobelysk', { scale: 1.2 }),
};

/** Creature ids deliberately left to the procedural renderer (none at the moment). */
export const CREATURE_FALLBACK = [];

// ---------------------------------------------------------------------------------------------
// Heroes (197): battle / adventure-map figure + portrait.
// Figures: each class has a pool of general-like units per gender; a hero takes the least-used
// unit of its pool and, when a unit is reused, a tint from HERO_TINTS (so unit+tint is unique).
// Portraits: painted 200x200 `profile_icons/` per faction mood and gender; reuse gets a mirrored
// and/or colour-washed variant (so image+variant is unique).
// ---------------------------------------------------------------------------------------------
export const HERO_TINTS = [null, '#ffd24a', '#4ac8ff', '#ff5a4a', '#7dff6a', '#d07aff', '#f4f4f4', '#30304c', '#ff9a2a', '#2affc8'];
export const HERO_TINT_ALPHA = 0.3;

/** @type {Record<string, {m: string[], f: string[]}>} */
export const HERO_CLASS_UNITS = {
  knight: { m: ['f1_general', 'f1_3rdgeneral', 'f1_tier2general', 'f1_bromemk2', 'f1_general_skinroguelegacy', 'f1_friendsguard', 'f1_groundbreaker'],
    f: ['f1_altgeneral', 'f1_altgeneraltier2', 'f1_spellbladeadept', 'f1_sunbreaker'] },
  cleric: { m: ['f1_sunstonetemplar', 'f1_rightfulheir', 'f1_leovoyant', 'neutral_mercsunseer'], f: ['f1_scintilla', 'f1_sister', 'neutral_daywatcher', 'neutral_prophetwhitepalm'] },
  ranger: { m: ['f6_kindredhunter', 'f6_freeblade', 'f6_ynuyttracker', 'neutral_partyelf', 'f6_sinergyunit', 'f3_ishtarhunter'], f: ['f6_frostiva', 'f6_general', 'f6_faiefestive', 'f6_sister'] },
  druid: { m: ['f6_tundraguardian', 'f6_justice', 'f6_grandmasterembla', 'neutral_owlshadescholar', 'neutral_singletonmythron'], f: ['f6_perfectreflection', 'f6_mythronquest', 'f6_ilenamk2', 'f6_circulus'] },
  alchemist: { m: ['f3_general', 'f3_tier2general', 'f3_falcius', 'f3_sinergyunit', 'f3_anubis', 'f3_zirixfestive'], f: ['f3_altgeneral', 'f3_altgeneraltier2', 'f3_dreamshaper'] },
  wizard: { m: ['f3_3rdgeneral', 'f3_ciphyronmk2', 'f3_duskweaver', 'f3_allomancer', 'neutral_timekeeper', 'neutral_cryptographer'], f: ['f3_nimbus', 'neutral_mercarcanelimiter', 'f3_rehorah', 'neutral_mirrormancer'] },
  demoniac: { m: ['boss_unhallowed', 'f4_limbodweller', 'f4_deathknell', 'neutral_feralu', 'boss_taskmaster', 'neutral_chakkram'], f: ['boss_cindera', 'f4_furosa', 'neutral_tethermancer'] },
  heretic: { m: ['f4_skullcaster', 'f4_sinergyunit', 'f4_blacksolus', 'neutral_highhand', 'neutral_crimsonmystic', 'boss_wujin'], f: ['f4_sister', 'neutral_chloroara', 'f2_tier2general'] },
  death_knight: { m: ['boss_shadowlord', 'boss_kane', 'boss_valiant', 'f4_phantasm', 'boss_shinkagezendo', 'neutral_capriciouswarrior'], f: ['f4_3rdgeneral', 'f4_maehvmk2', 'f4_klaxon'] },
  necromancer: { m: ['boss_manaman', 'f4_plaguedr', 'neutral_moonlitsorcerer', 'neutral_merccaster1', 'f4_reaperninemoons'], f: ['f4_altgeneral', 'f4_altgeneraltier2', 'f4_bloodbaronette', 'f4_arachne'] },
  overlord: { m: ['f4_abyssiansentinel', 'f4_pitstrider', 'f4_moonrider', 'neutral_jaxtruesight', 'f2_grandmasterzendo', 'neutral_voidhunter'], f: ['f4_general', 'f4_tier2general', 'neutral_unseven'] },
  warlock: { m: ['neutral_abjudicator', 'neutral_blueconjurer', 'f6_ynuytwarlock', 'neutral_shuffler', 'neutral_gambler', 'neutral_mageswarm'], f: ['boss_dissonance', 'neutral_mercmindwarper'] },
  barbarian: { m: ['neutral_beastmaster', 'f2_sekitori', 'boss_treatoni', 'f6_fenrirwarmaster', 'neutral_hatred', 'f2_godpalmblacktiger', 'boss_kron'], f: ['f2_onnabugeisha', 'f6_altgeneraltier2', 'neutral_sai'] },
  battle_mage: { m: ['f5_grandmasterkraigon', 'f5_ragebinder', 'neutral_masteroftheseven', 'f2_eclipseasura', 'neutral_tribalcaster'], f: ['f2_altgeneral', 'f2_altgeneraltier2', 'neutral_mercsightlessfarseer', 'f2_kibeholder'] },
  // readable humanoid generals only (the raptors / mechs read as creatures, not as a hero)
  beastmaster: { m: ['f5_altgeneral', 'f5_altgeneraltier2', 'f5_mandrake', 'f5_general', 'f5_tier2general', 'neutral_tribalcaster'], f: ['f5_3rdgeneral', 'f5_sister'] },
  witch: { m: ['f5_ragebinder'], f: ['neutral_healingmystic', 'neutral_bloodstonealchemist', 'f5_sister', 'f5_ragnoramk2', 'f5_3rdgeneral'] },
  planeswalker: { m: ['f2_general', 'f2_stormkage', 'f2_chakriavatar', 'neutral_loreweaver', 'boss_skyfalltyrant', 'neutral_swordofakrane'], f: ['f2_shidaimk2', 'f6_ghostseraphim', 'f2_3rdgeneral'] },
  elementalist: { m: ['f2_mage4winds', 'f2_caligrapher', 'f2_paperdropper', 'neutral_sapphireseer', 'neutral_azureherald'], f: ['f2_sepukku', 'f6_3rdgeneral', 'f6_tier2general', 'neutral_spelljammer'] },
  captain: { m: ['neutral_syvrel', 'neutral_windstopper', 'neutral_quartermastergauj', 'f2_melee', 'neutral_zukong', 'f2_hammonnladeseeker', 'neutral_mogwai'], f: ['neutral_ladylocke', 'neutral_mercgambitgirl', 'neutral_mercdaggerkiri', 'f2_katara'] },
  navigator: { m: ['neutral_mercshieldoracle', 'neutral_merctwilightmage', 'neutral_jaxi', 'neutral_windrunner'], f: ['f6_motherofdrakes', 'neutral_spellsammermk2', 'neutral_mercarchonspellbinder'] },
  mercenary: { m: ['neutral_mercswornavanger', 'neutral_mercsworndefender', 'neutral_astralcrusader', 'neutral_goldenjusticar', 'neutral_rejuvenator', 'neutral_primusshieldmaster'], f: ['neutral_mercdaggerkiri', 'neutral_sai'] },
  artificer: { m: ['neutral_thescientist', 'neutral_cryptographer', 'neutral_gambler', 'neutral_timekeeper', 'neutral_aethermaster', 'f3_windslicer'], f: ['neutral_mercgambitgirl', 'neutral_tethermancer'] },
};

const P = 'profile_icons/';
/** Portrait pools per faction and gender (files under assets/duelyst/). */
export const HERO_FACTION_PORTRAITS = {
  castle: { m: ['lyonar_argeonhighmayne1.jpg', 'lyonar_brome1.png', 'lyonar_argeonhighmayne2.jpg', 'lyonar_silverguardknight.jpg', 'lyonar_arclytesentinel.jpg', 'lyonar_windbladeadept.jpg', 'indominus.jpg', 'neutral_rook.jpg'],
    f: ['lyonar_ziransunforge1.jpg', 'lyonar_suntidemaiden.jpg', 'lyonar_steropesister.jpg', 'spriggen.jpg', 'neutral_ladylocke.jpg'] },
  rampart: { m: ['aer.jpg', 'neutral_grincher.jpg', 'vanar_wolfraven.jpg', 'neutral_nip.jpg', 'neutral_rok.jpg', 'tournament_dawnofduelysts1.jpg', 'vanar_razorback.jpg', 'vanar_draugarlord.jpg'],
    f: ['vanar_icebladedryad.jpg', 'songhai_shidai1.png', 'vanar_ilena1.png', 'spriggen.jpg', 'vanar_maiasister.jpg', 'vanar_hearthsister.jpg'] },
  tower: { m: ['vetruvian_zirixstarstrider1.jpg', 'vetruvian_ciphyron1.png', 'vetruvian_zirixstarstrider2.jpg', 'vetruvian_miragemaster.jpg', 'vetruvian_pyromancer.jpg', 'canopic.jpg', 'vetruvian_rae.jpg', 'vetruvian_windshrike.jpg', 'neutral_ion.jpg', 'tournament_dawnofduelysts1.jpg'],
    f: ['vetruvian_scionesssajj1.jpg', 'vetruvian_saonsister.jpg', 'vanar_karawinterblade1.jpg', 'neutral_lkiansister.jpg'] },
  inferno: { m: ['sinisterSilhouette.jpg', 'neutral_gnasher.jpg', 'songhai_gorehorn.jpg', 'gibbet.jpg', 'songhai_kaidoassassin.jpg', 'songhai_tuskboar.jpg'],
    f: ['frizzing_mystic.jpg', 'abyssian_maehv1.png', 'songhai_scarletviper.jpg', 'songhai_revaeventide2.jpg', 'songhai_alkyonesister.jpg'] },
  necropolis: { m: ['abyssian_vorpalreaver.jpg', 'abyssian_gloomchaser.jpg', 'abyssian_wraithling.jpg', 'abyssian_abyssalcrawler.jpg', 'veracity.jpg', 'vetruvian_starfirescarab.jpg'],
    f: ['abyssian_cassyvasoulreaper1.jpg', 'abyssian_kelainosister.jpg', 'abyssian_lilithe1.jpg', 'neutral_lkiansister.jpg', 'skullProphet.jpg'] },
  dungeon: { m: ['songhai_grandmasterzendo.jpg', 'songhai_heartseeker.jpg', 'abyssian_gloomchaser.jpg', 'neutral_silverbeak.jpg', 'vanar_arcticdisplacer.jpg', 'songhai_widowmaker.jpg'],
    f: ['abyssian_lilithe2.jpg', 'skullProphet.jpg', 'abyssian_maehv1.png', 'songhai_revaeventide1.jpg', 'abyssian_kelainosister.jpg'] },
  stronghold: { m: ['neutral_beastmaster.jpg', 'neutral_soboro.jpg', 'neutral_zukong.jpg', 'songhai_tuskboar.jpg', 'magmar_makantorwarbeast.jpg', 'lyonar_lightchaser.jpg', 'neutral_rawr.jpg', 'eternityPainter.jpg'],
    f: ['vanar_faiebloodwing1.jpg', 'songhai_alkyonesister.jpg', 'vanar_maiasister.jpg', 'magmar_taygetesister.jpg'] },
  fortress: { m: ['magmar_vaath1.jpg', 'magmar_starhorn1.jpg', 'magmar_silitharelder.jpg', 'magmar_vaath2.jpg', 'magmar_veteransilithar.jpg', 'magmar_phalanxar.jpg', 'magmar_youngsilithar.jpg', 'magmar_elucidator.jpg', 'magmar_dreadnought.jpg', 'neutral_goldenmantella.jpg', 'neutral_hydrax1.jpg'],
    f: ['magmar_taygetesister.jpg', 'magmar_ragnora1.png', 'abyssian_cassyvasoulreaper1.jpg', 'songhai_shidai1.png', 'vanar_ilena1.png', 'skullProphet.jpg', 'magmar_starhorn2.jpg', 'neutral_hydrax2.jpg'] },
  conflux: { m: ['vanar_glacialelemental.jpg', 'veracity.jpg', 'orbo.jpg', 'songhai_kaleosxaan1.jpg', 'neutral_ion.jpg', 'vetruvian_pax.jpg', 'vanar_snowchaser.jpg', 'vetruvian_rae.jpg'],
    f: ['vanar_icebladedryad.jpg', 'vanar_faiebloodwing2.jpg', 'vanar_hearthsister.jpg', 'songhai_revaeventide1.jpg', 'vanar_karawinterblade2.jpg', 'lyonar_suntidemaiden.jpg'] },
  cove: { m: ['neutral_rook.jpg', 'songhai_kaleosxaan1.jpg', 'neutral_soboro.jpg', 'neutral_zukong.jpg', 'vanar_razorback.jpg', 'neutral_nip.jpg', 'lyonar_brome1.png', 'neutral_grincher.jpg', 'neutral_beastmaster.jpg'],
    f: ['neutral_ladylocke.jpg', 'vanar_faiebloodwing_warbird.jpg', 'vanar_maiasister.jpg', 'spriggen.jpg', 'vanar_karawinterblade1.jpg', 'lyonar_suntidemaiden.jpg', 'vanar_faiebloodwing1.jpg'] },
  factory: { m: ['neutral_rook.jpg', 'neutral_z0r.jpg', 'neutral_mechaz0r.jpg', 'neutral_helmofmechaz0r.jpg', 'neutral_chassisofmechaz0r.jpg', 'neutral_swordofmechaz0r.jpg', 'neutral_cannonofmechaz0r.jpg', 'tournament_dawnofduelysts1.jpg', 'indominus.jpg', 'lyonar_brome1.png', 'orbo.jpg'],
    f: ['neutral_ladylocke.jpg', 'spriggen.jpg', 'lyonar_ziransunforge1.jpg', 'vanar_ilena1.png', 'neutral_wingsofmechaz0r.jpg'] },
};
/** Colour washes for reused portraits (variant 0 = untouched, odd variants are also mirrored). */
export const PORTRAIT_WASHES = [null, '#ffb84a', '#4ab8ff', '#ff5a6a', '#6aff8a', '#c87aff', '#ffffff', '#202040'];
export const PORTRAIT_WASH_ALPHA = 0.26;

/** Explicit per-hero overrides: { [heroId]: { unit?, tint?, portrait? } }. */
export const HERO_OVERRIDES = {
  mutare_drake: { unit: 'boss_treatdrake', tint: '#7a30c0' },
  lord_haart_undead: { unit: 'boss_valiant', tint: '#70ffa0' },
  crag_hack: { unit: 'neutral_beastmaster' },
  sandro: { unit: 'boss_manaman' },
  solmyr: { unit: 'f3_windgiver', tint: '#4a7aff' },
  gelu: { unit: 'neutral_arrowwhistler', tint: '#d8f4ff' },
};

function pickLeastUsed(pool, uses) {
  let best = pool[0];
  for (const item of pool) if ((uses.get(item) || 0) < (uses.get(best) || 0)) best = item;
  const n = uses.get(best) || 0;
  uses.set(best, n + 1);
  return [best, n];
}

function buildHeroTables() {
  const sprites = {};
  const portraits = {};
  const unitUses = new Map();
  const portraitUses = new Map();
  const taken = new Set();
  const key = (s) => `${s.unit}|${s.tint || ''}`;
  // Overrides claim their unit+tint first so the pooled heroes route around them.
  for (const h of HEROES) {
    const o = HERO_OVERRIDES[h.id];
    if (o && o.unit) {
      sprites[h.id] = { unit: o.unit, ...(o.tint ? { tint: o.tint, tintAlpha: HERO_TINT_ALPHA } : {}) };
      taken.add(key(sprites[h.id]));
      if (!o.tint) unitUses.set(o.unit, (unitUses.get(o.unit) || 0) + 1);
    }
  }
  for (const h of HEROES) {
    const cls = HERO_CLASS_BY_ID[h.classId];
    const g = h.gender === 'female' || h.gender === 'f' ? 'f' : 'm';
    if (!sprites[h.id]) {
      const pools = HERO_CLASS_UNITS[h.classId];
      if (pools) {
        const pool = pools[g] && pools[g].length ? pools[g] : pools.m;
        let ref = null;
        for (let guard = 0; guard < 64 && !ref; guard++) {
          const [unit, n] = pickLeastUsed(pool, unitUses);
          const tint = HERO_TINTS[n % HERO_TINTS.length];
          const cand = tint ? { unit, tint, tintAlpha: HERO_TINT_ALPHA } : { unit };
          if (!taken.has(key(cand))) ref = cand;
        }
        if (ref) { sprites[h.id] = ref; taken.add(key(ref)); }
      }
    }
    const faction = h.faction || (cls && cls.faction);
    const o = HERO_OVERRIDES[h.id];
    const fp = HERO_FACTION_PORTRAITS[faction];
    if (o && o.portrait) portraits[h.id] = { image: o.portrait, variant: 0 };
    else if (fp) {
      const pool = fp[g] && fp[g].length ? fp[g] : fp.m;
      const [file, n] = pickLeastUsed(pool, portraitUses);
      const wash = PORTRAIT_WASHES[n % PORTRAIT_WASHES.length];
      portraits[h.id] = { image: P + file, variant: n, ...(n % 2 ? { flip: true } : {}), ...(wash ? { tint: wash, tintAlpha: PORTRAIT_WASH_ALPHA } : {}) };
    }
  }
  return { sprites, portraits };
}

const heroTables = buildHeroTables();
/** heroDefId -> { unit, tint?, tintAlpha? } */
export const HERO_SPRITES = heroTables.sprites;
/** heroDefId -> { image, variant, flip?, tint?, tintAlpha? } */
export const HERO_PORTRAITS = heroTables.portraits;

// ---------------------------------------------------------------------------------------------
// Spells: icon + combat effect animation.
// ---------------------------------------------------------------------------------------------
const i = (name) => `icon_${name}`;
/** spellId -> icons.json sheet */
export const SPELL_ICONS = {
  // air
  lightning_bolt: i('f2_kagelightning'), chain_lightning: i('f2_ghost_lightning'), destroy_undead: i('f1_lastingjudgement'),
  air_shield: i('f1_aegisbarrier'), protection_from_air: i('f2_spellsword_wind'), magic_mirror: i('f2_mirrormeld'),
  precision: i('f1_truestrike'), disrupting_ray: i('f1_lucentbeam'), fortune: i('f3_scionsfirstwish'),
  haste: i('f1_chargeintobattle'), titans_lightning_bolt: i('f6_lightningblitz'), counterstrike: i('f2_spiralcounter'),
  hypnotize: i('f6_mesmerize'), summon_air_elemental: i('f3_azuresummoning'), thunderclap: i('f1_tempest'),
  static_charge: i('f1_beamshock'), storm: i('f3_maelstrom'), thunderbolt: 'bossspell_etherealwind',
  disguise: i('f6_conceilingshroud'), view_air: i('f3_glimpse'), fly: i('f1_aerial_rift'), dimension_door: i('f3_astralphasing'),
  // earth
  quicksand: i('f3_sandtrap'), force_field: i('f6_entericedome'), earthquake: i('f5_tremor'), implosion: i('f5_earthsphere'),
  meteor_shower: i('f5_meteorimpact'), death_ripple: i('f4_voidpulse'), shield: i('f1_divinebond'),
  protection_from_earth: i('f2_spellsword_earth'), anti_magic: i('f4_ritualbanishing'), resurrection: i('f1_breathoflife'),
  animate_dead: i('f4_nethersummoning'), stone_skin: i('f5_greaterfortitude'), sorrow: i('f4_curseofagony'),
  slow: i('f3_entropicdecay'), summon_earth_elemental: i('f3_summoningstones'), entangle: i('f4_creepingtendrils'),
  stone_spikes: i('f5_tectonicspikes'), flesh_to_stone: i('f6_icesculpture'), poison: i('f2_cobrastrike'),
  disease: i('f4_deathplague'), age: i('f3_rashascurse'), paralyze: i('f6_hailstoneprison'), petrify: i('f3_stonestospears'),
  bind: i('f4_soulclamp'), acid_breath: i('f5_verdantfulmination'), death_cloud: i('f4_sphereofdarkness'),
  death_stare: i('f5_entropicgaze'), drain_life: i('f4_aphoticdrain'), view_earth: i('f5_naturesconfluence'), town_portal: i('f4_gateofovervault'),
  // fire
  land_mine: i('f5_egggrenade'), fire_wall: i('f2_firestormofagony'), fireball: i('f2_phoenixfire'), inferno: i('f2_hellskitchen'),
  armageddon: i('f3_starsfury'), fire_shield: i('f2_phoenixfire02'), protection_from_fire: i('f1_prismbarrier'),
  sacrifice: i('f4_darkfiresacrifice'), curse: i('f4_curseofshadows'), bloodlust: i('f5_bloodrage'), misfortune: i('f4_doom'),
  slayer: i('f2_killingedge'), frenzy: i('f5_diretidefrenzy'), berserk: i('f4_betrayal'), blind: i('f3_blindscorch'),
  summon_fire_elemental: i('f3_corpsecombustion'), fire_bolt: i('f2_kindle'), melt_armor: i('f5_lavalance'),
  immolation: i('f1_holyimmolation'), fireball_attack: i('f2_phoenixbarrage'), raise_demons: i('f4_daemoniclure'), rebirth: i('f5_flashreincarnation'),
  // all schools
  magic_arrow: i('f2_etherealblades'), fear: i('f4_lurkingfear'), visions: i('f3_psychicconduit'),
  // water
  ice_bolt: i('f6_frostburn'), frost_ring: i('f6_frigidcorona'), protection_from_water: i('f6_bonechillbarrier'),
  dispel: i('f3_syphonenergy'), cure: i('f1_sundropelixir'), bless: i('f1_blessing'), weakness: i('f6_enfeeble'),
  prayer: i('f1_trinityoath'), mirth: i('f1_rally'), forgetfulness: i('f5_mindsteal'), teleport: i('f2_juxtaposition'),
  remove_obstacle: i('f5_smashem'), clone: i('f5_fractalreplication'), summon_water_elemental: i('f6_cryogenesis'),
  fog: i('f2_mistdragonseal'), regeneration: i('f1_circleoflife'), tidal_wave: i('f6_winterwave'), dispel_helpful: i('f6_shatter'),
  summon_boat: i('f3_fountainofyouth'), scuttle_boat: i('f3_sandwave'), water_walk: i('f3_inneroasis'),
};

const fx = (sheet, anim) => (anim ? { fx: sheet, anim } : { fx: sheet });
/** spellId -> { fx, anim? } explicit effect animations. */
export const SPELL_FX = {
  magic_arrow: fx('fx_f1_truestrike'),
  lightning_bolt: fx('fx_beamtesla'), chain_lightning: fx('fx_electricsphere'), titans_lightning_bolt: fx('fx_beamlaser'),
  thunderbolt: fx('fx_beamtesla'), storm: fx('fx_tornadoswirl'), thunderclap: fx('fx_explosionblueelectrical'),
  static_charge: fx('fx_electrical'), destroy_undead: fx('fx_heavenlystrike'), disrupting_ray: fx('fx_f3_blast'),
  ice_bolt: fx('fx_frozen'), frost_ring: fx('fx_f6_chromaticcold'), tidal_wave: fx('f6_fx_winterswake'), fog: fx('fx_fluid_puff'),
  fireball: fx('fx_flamesphere'), inferno: fx('fx_f2_phoenixfire'), armageddon: fx('fx_beamfire'), fire_wall: fx('fx_firefallground'),
  land_mine: fx('fx_explosionorangesmoke'), fire_bolt: fx('fx_fireimpact'), melt_armor: fx('fx_searingchasm'),
  immolation: fx('fx_f1_inmolation'), fireball_attack: fx('fx_bigfirehitspark'), fire_shield: fx('fx_firetornado'),
  implosion: fx('fx_f5_earthsphere'), meteor_shower: fx('fx_bouldersphere'), death_ripple: fx('fx_f4_voidpulse'),
  earthquake: fx('fx_f5_tremor'), stone_spikes: fx('fx_f3_cataclysmicfault'), quicksand: fx('fx_f3_sandportal'),
  force_field: fx('fx_distortion_hex_shield', 'shield'), entangle: fx('fx_roots'), bind: fx('fx_roots'),
  flesh_to_stone: fx('fx_f3_cosmicflesh'), petrify: fx('fx_f3_cosmicflesh'), poison: fx('fx_lightninghitgreen'),
  disease: fx('fx_f4_darkseed'), age: fx('fx_f3_rashascurse'), paralyze: fx('fx_f6_hailstoneprison'),
  acid_breath: fx('fx_impactgreen', 'impactgreenbig'), death_cloud: fx('fx_f4_shadownova'), death_stare: fx('fx_f4_doom'),
  drain_life: fx('fx_f4_soulshatterpact'), sorrow: fx('fx_f4_curseofagony'), slow: fx('fx_f3_drainmorale'),
  curse: fx('fx_f4_curseofagony'), misfortune: fx('fx_f4_doom'), weakness: fx('fx_f6_markofsolitude'),
  bless: fx('fx_f1_lionheartblessing'), prayer: fx('fx_f1_sunbloom'), shield: fx('fx_f1_divinebond'),
  stone_skin: fx('fx_f5_boundedlife'), air_shield: fx('fx_defense', 'forcefield'), haste: fx('fx_f2_spiraltechnique02'),
  bloodlust: fx('fx_f2_killingedge'), frenzy: fx('fx_slashfrenzy'), slayer: fx('fx_f1_decimate'), precision: fx('fx_f1_truestrike'),
  fortune: fx('fx_f3_scionsfirstwish'), mirth: fx('fx_f1_warsurge'), counterstrike: fx('fx_crossslash'),
  cure: fx('fx_heal'), regeneration: fx('fx_f3_fountainofyouth'), resurrection: fx('fx_f1_circlelife'),
  animate_dead: fx('fx_f4_nethersummoning'), sacrifice: fx('fx_f4_darkfiresacrifice'), rebirth: fx('fx_f5_flashreincarnation'),
  clone: fx('fx_f5_fractalreplication'), raise_demons: fx('fx_f4_daemoniclure'),
  summon_air_elemental: fx('fx_teleportyelloworb'), summon_earth_elemental: fx('fx_summonmythron'),
  summon_fire_elemental: fx('fx_teleportorangeorb'), summon_water_elemental: fx('fx_teleportblueorb'),
  hypnotize: fx('fx_f6_mesmerize'), berserk: fx('fx_f3_dominatewill'), blind: fx('fx_f3_blindscorch'),
  forgetfulness: fx('fx_f5_mindsteal'), fear: fx('fx_f4_wraithlingfury', 't'),
  dispel: fx('fx_cleanse', 'ripples'), dispel_helpful: fx('fx_disintegrate'), teleport: fx('fx_f2_teleport'),
  remove_obstacle: fx('fx_collision', 'collisionsparks'), anti_magic: fx('fx_f6_perfectreflection'), magic_mirror: fx('fx_f4_shadowreflection'),
  town_portal: fx('fx_teleportrecallblue'), dimension_door: fx('fx_f2_teleport'),
};
/** Fallback effect by spell category and school. */
export const SPELL_FX_DEFAULTS = {
  damage: { air: fx('fx_electrical'), earth: fx('fx_f5_tremor'), fire: fx('fx_fireimpact'), water: fx('fx_frozen'), all: fx('fx_impact', 'impactorangebig') },
  debuff: { air: fx('fx_electrical'), earth: fx('fx_f3_drainmorale'), fire: fx('fx_f4_curseofagony'), water: fx('fx_f6_markofsolitude'), all: fx('fx_f4_doom') },
  buff: { air: fx('fx_f2_innerfocus'), earth: fx('fx_f5_amplification'), fire: fx('fx_f2_bbs_spellsword'), water: fx('fx_f1_lionheartblessing'), all: fx('fx_buff') },
  heal: { all: fx('fx_heal') },
  summon: { all: fx('fx_summonlegendary') },
  control: { all: fx('fx_f3_dominatewill') },
  utility: { all: fx('fx_ringswirl') },
  adventure: { all: fx('fx_teleportrecall') },
};

/** Effect animation for a spell id (explicit entry, else category/school default, else null). */
export function spellFx(spellId) {
  if (SPELL_FX[spellId]) return SPELL_FX[spellId];
  const s = SPELLS.find((x) => x.id === spellId);
  if (!s) return null;
  const byCat = SPELL_FX_DEFAULTS[s.category];
  return byCat ? byCat[s.school] || byCat.all || null : null;
}

/** Generic combat effects (kind `effect`), usable without a spell. */
export const COMBAT_FX = {
  hit_slash: fx('fx_clawslash'), hit_cross: fx('fx_crossslash'), hit_claw: fx('fx_animalslash'), hit_blunt: fx('fx_impact', 'impactorangemedium'),
  hit_fire: fx('fx_fireslash'), hit_magic: fx('fx_impactblue', 'impactbluebig'), hit_poison: fx('fx_impactgreen', 'impactgreenmedium'),
  hit_arrow: fx('fx_impact2', 'impactbrightwhitemedium'), blood: fx('fx_blood_explosion', 'bloodbig'), explosion: fx('fx_whiteexplosion', 'whitehotbig'),
  smoke: fx('fx_smoke', 'explosiondarkplume'), dust: fx('fx_smoke', 'footstepdust'), buff: fx('fx_buff'), heal: fx('fx_heal'),
  shield: fx('fx_defense', 'floatingshield'), teleport: fx('fx_f2_teleport'), summon: fx('fx_summonlegendary'), frozen: fx('fx_frozen'),
  lightning: fx('fx_beamtesla'), victory: fx('fx_winner'), morale: fx('fx_f1_warsurge'), luck: fx('fx_f3_scionsfirstwish'),
  resurrect: fx('fx_f1_circlelife'), death: fx('fx_explosionpurplesmoke'),
};

// ---------------------------------------------------------------------------------------------
// Artifacts: 57 Duelyst artifact icons (+ a few spell icons) for 192 artifacts, chosen by keyword
// first and by slot second. Reused icons get a tint so icon+tint stays unique.
// ---------------------------------------------------------------------------------------------
const a = (name) => `artifact_${name}`;
const ICONS_BLADES = [a('f3_hexblade'), a('f4_spectralblade'), a('f6_winterblade'), a('f6_whiteasp'), a('f5_twinfang'), a('f1_skywindglaives'), a('f6_frostbiter')];
const ICONS_BLUNT = [a('f5_godhammer'), a('f3_thunderclap'), a('f3_spinecleaver')];
const ICONS_POLE = [a('f2_crescentspear'), a('f6_snowpiercer'), a('f3_staffofykir'), a('f3_sandscepter'), a('f3_repairstaff'), a('f6_scycicle')];
const ICONS_SHIELD = [a('f1_bigshield'), a('f1_shieldofphalanx'), a('f1_dawnseye'), a('f5_irridiumscale')];
const ICONS_HEAD = [a('f2_markgorehorn'), a('f2_cyclonemask'), a('f2_maskofshadows'), a('f2_bloodleechmask')];
const ICONS_TORSO = [a('f1_arclyteregalia'), a('f6_frostplate'), a('boss_frostarmor')];
const ICONS_NECK = [a('f2_unboundedenergyamulet'), a('f4_thereleaser'), a('f3_wildfireankh'), a('f5_eternalheart'), a('f4_heartborrower')];
const ICONS_RING = [a('f4_darkstonering'), a('f2_braceletofblinding'), a('f2_braceletblidingstrike'), a('f1_sunstonebracers')];
const ICONS_GLOVE = [a('f6_iceshatter'), a('f5_adamantineclaws')];
const ICONS_ORB = [a('neutral_f6_goldenhammer'), a('neutral_f5_goldenhammer'), a('neutral_f2_goldenhammer'), a('neutral_f4_goldenhammer'), a('neutral_f1_goldenhammer'), a('neutral_f3_goldenhammer'), a('neutral_neutral_goldenhammer')];

/** Ordered keyword rules: first match wins. `slot` restricts a rule to one equipment slot. */
export const ARTIFACT_RULES = [
  { test: /^grail$|cornucopia|golden_goose/, icons: [a('f5_thegibblecup')] },
  { test: /^spellbook$|^tome_|cards_of|runes_of|wizards_well/, icons: [a('f4_soulgrimwar')] },
  { test: /^spell_scroll$/, icons: ['icon_neutral_riddle'] },
  { test: /^orb_of_the_firmament$/, icons: [a('neutral_f6_goldenhammer')] },
  { test: /^orb_of_silt$/, icons: [a('neutral_f5_goldenhammer')] },
  { test: /^orb_of_tempestuous_fire$/, icons: [a('neutral_f2_goldenhammer')] },
  { test: /orb|sphere|eye_of_the_dragon|speculum|spyglass|monocle|mirror/, icons: ICONS_ORB },
  { test: /sword|blade|gladius|flame_tongue|blackshard|angelic_alliance/, icons: ICONS_BLADES },
  { test: /axe|flail|club|ironfist|titans_thunder/, icons: ICONS_BLUNT },
  { test: /trident|staff/, icons: ICONS_POLE },
  { test: /shield|buckler|targ_|bulwark|aegis/, icons: ICONS_SHIELD },
  { test: /vial|elixir|crucible|mercury/, icons: [a('f1_goldenvitriol')] },
  { test: /banner|badge|crest_of|glyph|medal|emblem|sash/, icons: [a('f1_ironbanner')] },
  { test: /horn_of|warhorn/, icons: [a('f4_hornofforsaken')] },
  { test: /feather|bird_of|angel_wings/, icons: ['icon_neutral_brilliantplume'] },
  { test: /clover|ladybird/, icons: ['boss_christmas_mistletoe'] },
  { test: /sack|bag_|purse|coffer|saddlebags/, icons: ['boss_christmas_present'] },
  { test: /cart_of_ore|heartstone/, icons: ['icon_neutral_precisionboulder'] },
  { test: /charm|talisman|mystic|puppet/, icons: [a('f5_eggsoul'), 'f1_ironcliffeheart'] },
  { test: /hideous_mask/, icons: [a('f2_maskofshadows')] },
  { test: /glove|gauntlet/, icons: ICONS_GLOVE },
  { test: /./, slot: 'right_hand', icons: ICONS_BLADES },
  { test: /./, slot: 'left_hand', icons: ICONS_SHIELD },
  { test: /./, slot: 'head', icons: ICONS_HEAD },
  { test: /./, slot: 'torso', icons: ICONS_TORSO },
  { test: /./, slot: 'neck', icons: ICONS_NECK },
  { test: /./, slot: 'ring', icons: ICONS_RING },
];
/** War machine artifacts use their creature's unit sprite as the icon. */
export const ARTIFACT_UNITS = { ballista: 'ballista', cannon: 'cannon', catapult: 'catapult', first_aid_tent: 'first_aid_tent', ammo_cart: 'ammo_cart' };
export const ARTIFACT_TINTS = [null, '#ffd24a', '#4ac8ff', '#ff5a4a', '#7dff6a', '#d07aff', '#ffffff', '#30304c', '#ff9a2a', '#2affc8', '#ff7ad0', '#a0a0a0'];
export const ARTIFACT_TINT_ALPHA = 0.36;

function buildArtifactTable() {
  const out = {};
  const uses = new Map();
  for (const art of ARTIFACTS) {
    if (ARTIFACT_UNITS[art.id] && CREATURE_SPRITES[ARTIFACT_UNITS[art.id]]) {
      out[art.id] = { ...CREATURE_SPRITES[ARTIFACT_UNITS[art.id]], scale: 1 };
      continue;
    }
    const rule = ARTIFACT_RULES.find((r) => (!r.slot || r.slot === art.slot) && r.test.test(art.id));
    if (!rule) continue; // fallback: procedural icon
    const [icon, n] = pickLeastUsed(rule.icons, uses);
    if (n >= ARTIFACT_TINTS.length) continue; // out of distinct variants -> procedural icon
    const tint = ARTIFACT_TINTS[n];
    out[art.id] = tint ? { icon, tint, tintAlpha: ARTIFACT_TINT_ALPHA } : { icon };
  }
  return out;
}
/** artifactId -> SpriteRef (missing ids fall back to the procedural icon). */
export const ARTIFACT_ICONS = buildArtifactTable();

// ---------------------------------------------------------------------------------------------
// Skills, resources, stats
// ---------------------------------------------------------------------------------------------
export const SKILL_ICONS = {
  pathfinding: i('f5_endurethebeastlands'), archery: i('f1_truestrike'), logistics: i('f1_chargeintobattle'), scouting: i('f3_glimpse'),
  diplomacy: i('f1_standtogether'), navigation: i('f6_winterwave'), leadership: i('f1_rally'), wisdom: 'bossspell_ancientknowledge',
  mysticism: i('f2_mana_vortex'), luck: i('f3_scionsthirdwish'), ballistics: i('f2_bombard'), eagle_eye: 'generalspell_f5_seekingeye',
  necromancy: i('f3_boneswarm'), estates: i('f3_autarchsgift'), fire_magic: 'bossspell_livingflame', air_magic: 'bossspell_etherealwind',
  water_magic: 'bossspell_laceratingfrost', earth_magic: 'bossspell_moldingearth', scholar: i('neutral_riddle'), tactics: i('f2_joseki'),
  artillery: i('f2_phoenixbarrage'), learning: 'f3_thoughtexchange', offense: i('f1_warsurge'), armorer: i('f1_resilience'),
  intelligence: i('f1_celestialconduit'), sorcery: i('f2_ninjutsumagics'), resistance: i('f1_prismbarrier'), first_aid: 'bossspell_restoringlight',
  interference: i('f4_voidsteal'),
};
/** resourceId -> SpriteRef. wood and sulfur have no fitting art (procedural fallback). */
export const RESOURCE_ICONS = {
  gold: { image: 'ui/icon_gold.png' },
  gems: { image: 'ui/icon_mana.png' },
  crystal: { image: 'ui/icon_mana.png', tint: '#ff3040', tintAlpha: 0.6 },
  mercury: { icon: a('f1_goldenvitriol') },
  ore: { icon: 'icon_neutral_precisionboulder' },
};
/** Primary stats, morale, luck and a few generic meters (kind `stat`; also reachable as kind `ui`). */
export const STAT_ICONS = {
  attack: { image: 'ui/icon_atk.png' }, defense: { icon: a('f1_bigshield') }, power: { icon: i('f2_mana_vortex') },
  knowledge: { icon: 'bossspell_ancientknowledge' }, morale: { icon: i('f1_rally') }, luck: { icon: 'boss_christmas_mistletoe' },
  mana: { image: 'ui/icon_mana.png' }, hp: { image: 'ui/icon_hp.png' }, movement: { image: 'ui/mouse_move.png' },
};
// The UI asks for `stat_<primary>` (hero screen, PrimaryStats, level-up) and `<morale|luck>_<good|bad>`
// (MoraleLuckPips): alias them so they do not fall through to the generic procedural star.
for (const k of ['attack', 'defense', 'power', 'knowledge', 'mana', 'hp', 'movement', 'morale', 'luck']) STAT_ICONS[`stat_${k}`] = STAT_ICONS[k];
for (const k of ['morale', 'luck']) { STAT_ICONS[`${k}_good`] = STAT_ICONS[k]; STAT_ICONS[`${k}_bad`] = { ...STAT_ICONS[k], tint: '#c02020', tintAlpha: 0.55 }; }

// ---------------------------------------------------------------------------------------------
// Battlefields (terrain.battlefield ids) and UI pieces
// ---------------------------------------------------------------------------------------------
const bm = (n, bgExt, fg = []) => ({ background: `maps/battlemap${n}_background.${bgExt}`, midground: `maps/battlemap${n}_middleground.png`, foreground: fg });
/** battlefield id -> layered art (URLs relative to assets/duelyst/). `midground` is the arena floor. */
export const BATTLEFIELDS = {
  grass: bm(5, 'jpg', ['maps/battlemap5_foreground_001.png', 'maps/battlemap5_foreground_002.png']),
  highlands: bm(0, 'png', ['maps/battlemap0_foreground_001.png', 'maps/battlemap0_foreground_002.png']),
  swamp: bm(1, 'png'),
  sand: bm(2, 'png', ['maps/battlemap2_foreground_001.png', 'maps/battlemap2_foreground_002.png']),
  rough: bm(3, 'png', ['maps/battlemap3_foreground.png']),
  ship: bm(4, 'png', ['maps/battlemap4_foreground_001.png', 'maps/battlemap4_foreground_002.png']),
  rock: bm(7, 'png', ['maps/battlemap7_foreground.png']),
  subterranean: { background: 'maps/abyssian/background.jpg', midground: 'maps/battlemap6_middleground.png', foreground: [] },
  dirt: { background: 'maps/shimzar/background.jpg', midground: 'maps/shimzar/midground.png', foreground: ['maps/shimzar/foreground.png'] },
  snow: { background: 'maps/vanar/background.jpg', midground: 'maps/vanar/midground.png', foreground: [] },
  lava: { background: 'maps/redrock/background.jpg', midground: 'maps/redrock/midground.png', foreground: ['maps/redrock/foreground.png'] },
  wasteland: { background: 'maps/abyssian/background.jpg', midground: 'maps/abyssian/midground.png', foreground: [] },
};
export const DEFAULT_BATTLEFIELD = 'grass';

/** Optional UI pieces (files relative to assets/duelyst/). Duelyst's UI is neon sci-fi, so only the
 *  neutral-looking parts are listed; the procedural parchment skin stays the default. */
export const UI_ASSETS = {
  cursor_select: 'ui/mouse_select.png', cursor_attack: 'ui/mouse_attack.png', cursor_move: 'ui/mouse_move.png', cursor_disabled: 'ui/mouse_disabled.png',
  unit_shadow: 'ui/unit_shadow.png', target_ring_enemy: 'ui/target_ring_enemy.png', target_ring_friendly: 'ui/target_ring_friendly.png',
  tile_hover: 'tiles/tile_hover.png', tile_glow: 'tiles/tile_glow.png', tile_attack: 'tiles/tile_attack.png',
  portrait_border: 'generals/general_portrait_border.png', portrait_border_highlight: 'generals/general_portrait_border_highlight.png',
  icon_attack: 'ui/icon_atk.png', icon_hp: 'ui/icon_hp.png', icon_mana: 'ui/icon_mana.png', icon_gold: 'ui/icon_gold.png',
  button_primary: 'ui/button_primary.png', button_secondary: 'ui/button_secondary.png', button_confirm: 'ui/button_confirm.png',
  button_cancel: 'ui/button_cancel.png', button_close: 'ui/button_close.png', frame_modal: 'ui/frame_modal.png', vignette: 'ui/vignette.png',
  menu_background: 'scenes/obsidian_woods/obsidian_woods_background.jpg', load_background: 'scenes/load/scene_load_background.jpg',
};
/** Faction crest images (town screens, hero cards). */
export const FACTION_CRESTS = {
  castle: 'crests/crest_f1.png', rampart: 'crests/crest_f6.png', tower: 'crests/crest_f3.png', inferno: 'crests/crest_f4.png',
  necropolis: 'crests/crest_f4.png', dungeon: 'crests/crest_f4.png', stronghold: 'crests/crest_f5.png', fortress: 'crests/crest_f5.png',
  conflux: 'crests/crest_f2.png', cove: 'crests/crest_f2.png', factory: 'crests/crest_f3.png',
};

// ---------------------------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------------------------
const TABLES = {
  creature: CREATURE_SPRITES, hero: HERO_SPRITES, portrait: HERO_PORTRAITS, spell: SPELL_ICONS, artifact: ARTIFACT_ICONS,
  skill: SKILL_ICONS, resource: RESOURCE_ICONS, stat: STAT_ICONS, ui: STAT_ICONS,
};

/**
 * Resolve (kind, id) to a SpriteRef, or null when the id has no Duelyst art.
 * Kind `effect` accepts a spell id, a COMBAT_FX key, or a raw `fx_*` sheet name.
 */
export function resolveSprite(kind, id) {
  if (kind === 'effect') return COMBAT_FX[id] || spellFx(id) || (/^(fx_|f\d_)/.test(String(id)) ? { fx: String(id) } : null);
  const table = TABLES[kind];
  if (!table || !Object.prototype.hasOwnProperty.call(table, id)) return null;
  const ref = table[id];
  return typeof ref === 'string' ? { icon: ref } : ref;
}

/** Ids of a data list that have no mapping for `kind` (procedural fallback). */
export function unmappedIds(kind, ids) {
  return ids.filter((id) => !resolveSprite(kind, id));
}

/** Coverage summary used by the docs, the gallery and the tests. */
export function mappingCoverage() {
  const count = (kind, ids) => ({ total: ids.length, mapped: ids.length - unmappedIds(kind, ids).length, fallback: unmappedIds(kind, ids) });
  return {
    creature: count('creature', CREATURES.map((c) => c.id)),
    hero: count('hero', HEROES.map((h) => h.id)),
    portrait: count('portrait', HEROES.map((h) => h.id)),
    spell: count('spell', SPELLS.map((s) => s.id)),
    effect: count('effect', SPELLS.map((s) => s.id)),
    artifact: count('artifact', ARTIFACTS.map((x) => x.id)),
  };
}
