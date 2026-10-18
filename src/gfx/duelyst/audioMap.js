// Game events / music contexts -> Duelyst (CC0) audio files (assets/duelyst/sfx, assets/duelyst/music).
// Picked by file name (Duelyst names its sfx by unit and action); see docs/mechanics/duelyst-assets.md.
// Pure data + lookup; no DOM. The UI audio module can call getSfxUrl/getMusicUrl and fall back to
// its procedural synth when they return null.
//
//   getSfxUrl(event, { index?, baseUrl? }) -> url | null      SFX_EVENTS: list of event names
//   getMusicUrl(context, { baseUrl? }) -> url | null          MUSIC_CONTEXTS: list of contexts
//   musicContextFor({ screen, terrain, faction }) -> context name

import { PACK_SFX } from '../packs/mapping.js';

const S = (name) => `sfx/${name}.m4a`;
const M = (name) => `music/${name}.m4a`;

/** event -> file or list of files (a list is cycled to avoid repetition). */
export const SFX_MAP = {
  // UI
  click: S('sfx_ui_select'),
  hover: S('sfx_ui_menu_hover'),
  error: S('sfx_ui_error'),
  tab: S('sfx_ui_tab_in'),
  page: S('sfx_ui_nextpage'),
  dialog_open: S('sfx_ui_modalwindow_swoosh_enter'),
  dialog_close: S('sfx_ui_modalwindow_swoosh_exit'),
  panel_open: S('sfx_ui_panel_swoosh_enter'),
  panel_close: S('sfx_ui_panel_swoosh_exit'),
  notification: S('notification'),
  your_turn: [S('sfx_ui_yourturn'), S('sfx_ui_yourturn_1'), S('sfx_ui_yourturn_2')],
  // economy / adventure
  coin: S('sfx_gold_reward_1'),
  purchase: S('sfx_gold_reward_2'),
  treasure: S('sfx_gold_reward_long'),
  chest: S('sfx_loot_crate_reveal'),
  artifact: [S('sfx_artifact_equip'), S('sfx_artifact_equip01'), S('sfx_artifact_equip02'), S('sfx_artifact_equip03')],
  artifact_weapon: S('sfx_artifact_equipweapon'),
  levelup: S('sfx_division_crest_reveal'),
  daystart: S('sfx_ui_yourturn'),
  new_week: S('sfx_season_rewards_text_reveal'),
  build: S('sfx_unit_deploy_3'),
  recruit: [S('sfx_unit_deploy'), S('sfx_unit_deploy_1'), S('sfx_unit_deploy_2')],
  move: [S('sfx_unit_run_charge_1'), S('sfx_unit_run_charge_2'), S('sfx_unit_run_charge_3'), S('sfx_unit_run_charge_4')],
  move_magic: [S('sfx_unit_run_magical_1'), S('sfx_unit_run_magical_2'), S('sfx_unit_run_magical_3'), S('sfx_unit_run_magical_4')],
  victory: S('sfx_victory_match'),
  victory_reward: S('sfx_victory_reward'),
  // combat - melee by weapon type
  sword: S('sfx_f1_general_attack_swing'),
  melee_swing: [S('sfx_f1_general_attack_swing'), S('sfx_f2melee_attack_swing_1'), S('sfx_f2melee_attack_swing_2'), S('sfx_f2melee_attack_swing_3')],
  melee_blade: [S('sfx_f1general_attack_impact'), S('sfx_f2melee_attack_impact_1'), S('sfx_f2melee_attack_impact_2')],
  melee_blunt: [S('sfx_neutral_rockpulverizer_attack_impact'), S('sfx_f1tank_attack_impact'), S('sfx_f5_kolossus_attack_impact')],
  melee_claw: [S('sfx_neutral_beastsaberspinetiger_attack_impact'), S('sfx_neutral_beastphasehound_attack_impact')],
  melee_bite: [S('sfx_f6_ghostwolf_attack_impact'), S('sfx_neutral_komodocharger_attack_impact')],
  melee_magic: S('sfx_f2_mage4winds_impact'),
  melee_heavy: [S('sfx_f4_juggernaut_attack_impact'), S('sfx_f5_unstableleviathan_attack_impact')],
  hit: [S('sfx_unit_physical_1'), S('sfx_unit_physical_2'), S('sfx_unit_physical_3'), S('sfx_unit_physical_4')],
  // combat - ranged
  arrow: S('sfx_neutral_valehunter_attack_swing'),
  arrow_hit: S('sfx_neutral_valehunter_attack_impact'),
  cannon: S('sfx_neutral_cannonmechaz0r_attack_swing'),
  cannon_hit: S('sfx_neutral_cannonmechaz0r_projectile_impact'),
  // combat - spells per school / category
  spell: S('sfx_spell_manavortex'),
  spell_air: S('sfx_spell_ghostlightning'),
  spell_earth: S('sfx_spell_naturalselection'),
  spell_fire: S('sfx_spell_phoenixfire'),
  spell_water: S('sfx_spell_icepillar'),
  spell_all: S('sfx_spell_manavortex'),
  spell_heal: S('sfx_spell_heal'),
  spell_buff: S('sfx_spell_lionheartblessing'),
  spell_debuff: S('sfx_spell_graspofagony'),
  spell_summon: S('sfx_summonlegendary'),
  spell_teleport: S('sfx_spell_voidwalk'),
  spell_resurrect: S('sfx_spell_fountainofyouth'),
  spell_explosion: S('sfx_spell_firefall'),
  // deaths
  death: S('sfx_f1general_death'),
  death_beast: S('sfx_neutral_beastsaberspinetiger_death'),
  death_undead: S('sfx_neutral_crossbones_death'),
  death_large: S('sfx_f5_kolossus_death'),
  death_flyer: S('sfx_neutral_wingsofparadise_death'),
  // misc
  explosion: S('sfx_ui_explosion'),
  screenshake: S('sfx_screenshake'),
};
/** Events without a fitting Duelyst sound (a pack sound from PACK_SFX, else the procedural synth). */
export const SFX_FALLBACK = ['defeat'];

export const MUSIC_MAP = {
  main_menu: M('mainmenu_v2c_looping'),
  new_game: M('music_playmode'),
  credits: M('music_codex'),
  encyclopedia: M('music_collection'),
  adventure: M('music_codex'),
  // adventure by terrain mood
  adventure_grass: M('music_collection'),
  adventure_dirt: M('music_ageofdisjunction'),
  adventure_highlands: M('music_battlemap_risensun2'),
  adventure_sand: M('music_battlemap_vetruv'),
  adventure_snow: M('music_battlemap_vanar'),
  adventure_swamp: M('music_battlemap_morinkhur'),
  adventure_rough: M('music_battlemap_duskfall'),
  adventure_wasteland: M('music_battlemap_duskfall'),
  adventure_lava: M('music_battlemap_abyssian'),
  adventure_subterranean: M('music_battlemap_abyssian'),
  adventure_water: M('music_battlemap_bluemonolith'),
  // towns
  town_castle: M('music_mainmenu_lyonar'),
  town_rampart: M('music_tutorial'),
  town_tower: M('music_battlemap_bluemonolith'),
  town_inferno: M('music_battlemap_firesofvictory'),
  town_necropolis: M('music_battlemap_abyssian'),
  town_dungeon: M('music_battlemap_duskfall'),
  town_stronghold: M('music_battlemap_morinkhur'),
  town_fortress: M('music_battlemap02'),
  town_conflux: M('music_battlemap_vanar'),
  town_cove: M('music_mainmenu_songhai'),
  town_factory: M('music_battlemap_vetruv'),
  // combat
  combat: M('music_battlemap01'),
  combat_alt: M('music_battlemap_songhai'),
  combat_siege: M('music_challengemode'),
  combat_boss: M('music_gauntlet'),
  victory: M('music_battlemap_firesofvictory'),
  defeat: M('music_ageofdisjunction'),
  loot: M('music_boosterpack'),
};

export const SFX_EVENTS = Object.keys(SFX_MAP);
export const MUSIC_CONTEXTS = Object.keys(MUSIC_MAP);
const counters = new Map();
const DEFAULT_BASE = 'assets/duelyst/';

function withBase(path, baseUrl = DEFAULT_BASE) {
  return (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) + path;
}

/** All files a sfx event can play (relative to the Duelyst folder). */
export function sfxFiles(event) {
  const v = SFX_MAP[event];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * URL of a sound for a game event, or null (-> procedural synth).
 * Lists are cycled (or indexed with `opts.index`). Unknown `spell_<school>` / `death_*` events
 * fall back to the generic `spell` / `death`.
 */
export function getSfxUrl(event, opts = {}) {
  let files = sfxFiles(event);
  if (!files.length && /^spell_/.test(event)) files = sfxFiles('spell');
  if (!files.length && /^death_/.test(event)) files = sfxFiles('death');
  if (!files.length && /^melee_/.test(event)) files = sfxFiles('melee_blade');
  if (!files.length) {
    // events Duelyst has no sound for may come from a third-party pack (assets/<pack>/, see
    // docs/mechanics/asset-packs.md); paths there are relative to assets/
    const rel = PACK_SFX[event];
    if (!rel) return null;
    const packBase = opts.packBaseUrl ?? 'assets/';
    return (packBase.endsWith('/') ? packBase : `${packBase}/`) + rel;
  }
  let i;
  if (Number.isInteger(opts.index)) i = ((opts.index % files.length) + files.length) % files.length;
  else { i = counters.get(event) || 0; counters.set(event, (i + 1) % files.length); }
  return withBase(files[i], opts.baseUrl);
}

/** URL of a music track for a context (`town_<faction>`, `adventure_<terrain>`, `combat`...), or null. */
export function getMusicUrl(context, opts = {}) {
  let file = MUSIC_MAP[context];
  if (!file && /^town_/.test(context)) file = MUSIC_MAP.main_menu;
  if (!file && /^adventure_/.test(context)) file = MUSIC_MAP.adventure;
  if (!file && /^combat_/.test(context)) file = MUSIC_MAP.combat;
  return file ? withBase(file, opts.baseUrl) : null;
}

/** Convenience: context name for a screen. */
export function musicContextFor({ screen, terrain, faction } = {}) {
  if (screen === 'town' && faction) return `town_${faction}`;
  if (screen === 'adventure' && terrain) return `adventure_${terrain}`;
  if (screen === 'combat') return 'combat';
  return MUSIC_MAP[screen] ? screen : 'main_menu';
}

/** Weapon-type sound for a melee attacker (by creature shape). */
export function meleeSfxForShape(shape) {
  switch (shape) {
    case 'beast': case 'insect': return 'melee_claw';
    case 'dragon': case 'serpent': return 'melee_bite';
    case 'giant': case 'construct': case 'machine': case 'plant': return 'melee_blunt';
    case 'elemental': case 'caster': return 'melee_magic';
    default: return 'melee_blade';
  }
}
