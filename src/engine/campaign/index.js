// Campaign mode: definitions, progress (plain JSON), scenario launch, hero carry-over.
// Spec: docs/mechanics/campaigns.md.
//
//   const progress = createCampaignProgress('iron_and_steam', { difficulty: 1 });
//   const { blueprint, settings, carry } = startCampaignScenario(progress, bonusIndex, scenarioId?);
//   const state = createGame(blueprint, settings);
//   applyCarryOver(state, carry);
//   ... play; on game over ...
//   const next = completeScenario(progress, state);
import { CAMPAIGNS, CAMPAIGN_BY_ID, CAMPAIGN_DIFFICULTIES, DIFFICULTY_BY_LABEL } from './definitions.js';
import { CAMPAIGN_MAPS, CAMPAIGN_MAP_BY_ID, buildCampaignMap, campaignMapInfo } from './maps/index.js';
import { getArtifact } from '../../data/artifacts.js';
import { getCreature } from '../../data/creatures.js';
import { getSpell } from '../../data/spells.js';
import { getHeroDef } from '../../data/heroes.js';
import { ensureArtifacts, giveArtifact, entryId, getEquippedArtifacts } from '../artifacts.js';
import { armyAdd } from '../army.js';
import { getMaxMana } from '../bonuses.js';
import { refreshMovement, giveExperience } from '../hero.js';

export {
  CAMPAIGNS, CAMPAIGN_BY_ID, CAMPAIGN_DIFFICULTIES, DIFFICULTY_BY_LABEL, CAMPAIGN_MAPS, CAMPAIGN_MAP_BY_ID, buildCampaignMap, campaignMapInfo,
};

export const PROGRESS_VERSION = 1;
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const PLAYER_COLORS = ['red', 'blue', 'tan', 'green', 'orange', 'purple', 'teal', 'pink'];

export function getCampaign(id) {
  const c = CAMPAIGN_BY_ID[id];
  if (!c) throw new Error(`Unknown campaign: ${id}`);
  return c;
}

export function getScenario(campaign, scenarioId) {
  const c = typeof campaign === 'string' ? getCampaign(campaign) : campaign;
  const s = c.scenarios.find((x) => x.id === scenarioId);
  if (!s) throw new Error(`Unknown scenario ${scenarioId} in campaign ${c.id}`);
  return s;
}

/** Summary rows for a select screen. */
export function listCampaigns() {
  return CAMPAIGNS.map((c) => ({
    id: c.id, title: c.title, description: c.description, factions: c.factions.slice(), difficulty: c.difficulty,
    heroDefId: c.heroDefId, scenarios: c.scenarios.length, length: campaignLength(c),
  }));
}

/** Number of scenarios a playthrough visits (longest path from the start). */
export function campaignLength(c) {
  const memo = {};
  const walk = (id) => {
    if (memo[id] != null) return memo[id];
    const s = c.scenarios.find((x) => x.id === id);
    memo[id] = 1 + Math.max(0, ...(s.next || []).map(walk));
    return memo[id];
  };
  return walk(c.start);
}

/** Text of a starting bonus. */
export function describeBonus(b) {
  if (b.label) return b.label;
  switch (b.type) {
    case 'artifact': return `Artifact: ${getArtifact(b.artifactId).name}`;
    case 'creatures': { const c = getCreature(b.creatureId); return `${b.count} ${b.count === 1 ? c.name : (c.namePlural || c.name)}`; }
    case 'resources': return Object.entries(b.resources).map(([r, n]) => `${n} ${r}`).join(', ');
    case 'spell': return `Spell: ${getSpell(b.spellId).name}`;
    case 'experience': return `${b.amount} experience`;
    default: return b.type;
  }
}

// ---------------------------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------------------------

/**
 * Fresh progress record (plain JSON).
 * @returns {{version, campaignId, difficulty, status: 'active'|'complete', available: string[], completed:
 *   {scenarioId, bonusIndex, days, score}[], hero: object|null, attempts: {[scenarioId]: number}, lastResult}}
 */
export function createCampaignProgress(campaignId, { difficulty } = {}) {
  const c = getCampaign(campaignId);
  const diff = difficulty ?? DIFFICULTY_BY_LABEL[c.difficulty] ?? 1;
  return {
    version: PROGRESS_VERSION, campaignId: c.id, difficulty: diff, status: 'active',
    available: [c.start], completed: [], hero: null, attempts: {}, lastResult: null,
  };
}

/** Scenarios the player may start next (one, or several for a branch). */
export function getAvailableScenarios(progress) {
  const c = getCampaign(progress.campaignId);
  return progress.status === 'complete' ? [] : progress.available.map((id) => getScenario(c, id));
}

/** 0..1 share of the playthrough done. */
export function campaignProgressRatio(progress) {
  if (!progress) return 0;
  const c = getCampaign(progress.campaignId);
  if (progress.status === 'complete') return 1;
  return Math.min(1, progress.completed.length / campaignLength(c));
}

/** Validate / repair a progress record read from storage. Returns null when unusable. */
export function normalizeProgress(p) {
  if (!p || typeof p !== 'object' || !CAMPAIGN_BY_ID[p.campaignId]) return null;
  if (p.version !== PROGRESS_VERSION) return null;
  const c = CAMPAIGN_BY_ID[p.campaignId];
  const ids = new Set(c.scenarios.map((s) => s.id));
  if (!Array.isArray(p.available) || !p.available.every((id) => ids.has(id))) return null;
  if (!Array.isArray(p.completed)) return null;
  return { attempts: {}, lastResult: null, hero: null, ...p };
}

// ---------------------------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------------------------

/**
 * Everything needed to start a campaign scenario.
 * @param {object} progress
 * @param {number} bonusIndex index into the scenario's `bonuses` (null/-1 = none)
 * @param {string} [scenarioId] required when several scenarios are available (a branch), else the first
 * @returns {{ blueprint, settings, carry, scenario, campaign }}
 */
export function startCampaignScenario(progress, bonusIndex, scenarioId) {
  const c = getCampaign(progress.campaignId);
  if (progress.status === 'complete') throw new Error('campaign already complete');
  const sid = scenarioId || progress.available[0];
  if (!progress.available.includes(sid)) throw new Error(`scenario ${sid} is not available`);
  const scenario = getScenario(c, sid);
  const blueprint = buildCampaignMap(scenario.map);
  if (!blueprint) throw new Error(`campaign map ${scenario.map} is missing`);
  const spec = CAMPAIGN_MAP_BY_ID[scenario.map];
  const bonus = bonusIndex != null && bonusIndex >= 0 ? scenario.bonuses[bonusIndex] || null : null;
  const campaignMeta = { campaignId: c.id, scenarioId: sid, bonusIndex: bonus ? bonusIndex : null, heroDefId: c.heroDefId, title: scenario.title };
  blueprint.meta = { ...blueprint.meta, name: scenario.title, campaign: campaignMeta };
  const diff = CAMPAIGN_DIFFICULTIES.find((d) => d.id === progress.difficulty) || CAMPAIGN_DIFFICULTIES[1];
  const slots = spec.players;
  const factions = (spec.playerInfo || []).map((p) => p.faction);
  const settings = {
    seed: hashSeed(`${c.id}:${sid}:${(progress.attempts && progress.attempts[sid]) || 0}`),
    difficulty: diff.id,
    difficultyPercent: diff.percent,
    mapName: scenario.title,
    players: Array.from({ length: slots }, (_, i) => ({
      slot: i, isHuman: i === 0, color: PLAYER_COLORS[i], faction: factions[i] || 'random',
      name: i === 0 ? getHeroDef(c.heroDefId).name : `${PLAYER_COLORS[i][0].toUpperCase()}${PLAYER_COLORS[i].slice(1)} player`,
      hero: 'random', bonus: 'none',
    })),
    victory: clone(blueprint.victory || 'standard'),
    loss: clone(blueprint.loss || 'standard'),
    campaign: clone(campaignMeta),
  };
  const carry = { heroDefId: c.heroDefId, hero: clone(progress.hero), rules: clone(c.carryOver), bonus: clone(bonus) };
  return { blueprint, settings, carry, scenario, campaign: c };
}

function hashSeed(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619) >>> 0;
  return x || 1;
}

/** The human player of a campaign game (slot 0). */
export function campaignPlayer(state) {
  return state.players.find((p) => p.slot === 0 && p.isHuman) || state.players.find((p) => p.isHuman) || null;
}

/** The campaign's main hero in a game (on the map, else parked in the hero pool), or null. */
export function findMainHero(state, defId) {
  const player = campaignPlayer(state);
  if (!player) return null;
  const own = player.heroes.map((id) => state.heroes[id]).filter(Boolean);
  return own.find((h) => h.defId === defId) || null;
}

/**
 * Apply the carried hero and the chosen starting bonus to a freshly created game (once).
 * @returns {{ok: boolean, events: object[], heroId?: string, error?: string}}
 */
export function applyCarryOver(state, carry) {
  if (!carry) return { ok: true, events: [] };
  if (state.meta?.campaign?.carryApplied) return { ok: false, error: 'already_applied' };
  const player = campaignPlayer(state);
  if (!player) return { ok: false, error: 'no_human_player' };
  let hero = findMainHero(state, carry.heroDefId)
    || player.heroes.map((id) => state.heroes[id]).find(Boolean);
  if (!hero) return { ok: false, error: 'no_hero' };
  const events = [];
  const h = carry.hero;
  if (h && h.defId === hero.defId) {
    hero.level = h.level;
    hero.exp = h.exp;
    hero.primary = { ...h.primary };
    hero.skills = h.skills.map((s) => ({ ...s }));
    hero.skillCounters = { ...(h.skillCounters || hero.skillCounters || { wisdom: 0, school: 0 }) };
    hero.spells = [...new Set([...(hero.spells || []), ...(h.spells || [])])];
    const arts = ensureArtifacts(hero);
    if (hero.spells.length && !arts.equipped.spellbook?.[0]) arts.equipped.spellbook[0] = 'spellbook';
    for (const entry of h.artifacts || []) {
      const res = giveArtifact(hero, entry);
      if (res.ok) events.push(...res.events);
    }
    for (const st of h.army || []) placeCreatures(state, player, hero, st.creatureId, st.count);
    events.push({ type: 'campaign_hero_restored', heroId: hero.id, level: hero.level });
  }
  const b = carry.bonus;
  if (b) {
    switch (b.type) {
      case 'artifact': { const r = giveArtifact(hero, b.artifactId); if (r.ok) events.push(...r.events); break; }
      case 'creatures': placeCreatures(state, player, hero, b.creatureId, b.count); break;
      case 'resources': for (const [r, n] of Object.entries(b.resources)) player.resources[r] = (player.resources[r] || 0) + n; break;
      case 'spell': {
        const arts = ensureArtifacts(hero);
        if (!arts.equipped.spellbook?.[0]) arts.equipped.spellbook[0] = 'spellbook';
        if (!hero.spells.includes(b.spellId)) hero.spells.push(b.spellId);
        break;
      }
      case 'experience': {
        const r = giveExperience(state, hero.id, b.amount, { raw: true });
        if (r && r.events) events.push(...r.events);
        break;
      }
      default: break;
    }
    events.push({ type: 'campaign_bonus', heroId: hero.id, bonus: clone(b) });
  }
  hero.mana = getMaxMana(state, hero);
  refreshMovement(state, hero, true);
  state.meta ??= {};
  state.meta.campaign = { ...(state.meta.campaign || {}), carryApplied: true };
  return { ok: true, events, heroId: hero.id };
}

/** Add creatures to the hero; if his army is full, to the garrison of his town (else they are lost). */
function placeCreatures(state, player, hero, creatureId, count) {
  if (armyAdd(hero.army, creatureId, count)) return true;
  for (const tid of player.towns) {
    const town = state.towns[tid];
    if (town && town.garrison && armyAdd(town.garrison, creatureId, count)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------------------------

const NOT_CARRIED = new Set(['spellbook', 'grail', 'catapult', 'ballista', 'ammo_cart', 'first_aid_tent']);

/**
 * Snapshot of the main hero for the next scenario: level, experience, primary and secondary
 * skills, spells, up to `rules.artifacts` most valuable artifacts, the `rules.creatureStacks`
 * strongest stacks (x `rules.creatureFraction`).
 */
export function captureHero(state, defId, rules = {}) {
  const hero = findMainHero(state, defId) || (state.heroPool && state.heroPool[defId]) || null;
  if (!hero) return null;
  const entries = [];
  for (const e of getEquippedArtifacts(hero)) {
    if (e.slot === 'war_machine' || e.slot === 'spellbook') continue;
    entries.push(e.entry);
  }
  for (const e of hero.artifacts?.backpack || []) entries.push(e);
  // every carryable artifact / stack, best first: the player may change the automatic pick (setCarryChoice)
  const artifactOptions = entries
    .filter((e) => { const id = entryId(e); const a = getArtifact(id); return !NOT_CARRIED.has(id) && a.class !== 'special'; })
    .map((e) => ({ e, cost: getArtifact(entryId(e)).cost || 0 }))
    .sort((a, b) => b.cost - a.cost)
    .map((x) => clone(x.e));
  const fraction = rules.creatureFraction ?? 1;
  const armyOptions = fraction > 0 && (rules.creatureStacks || 0) > 0 ? (hero.army || []).filter(Boolean)
    .map((s) => ({ ...s, value: (getCreature(s.creatureId).aiValue || 1) * s.count }))
    .sort((a, b) => b.value - a.value)
    .map((s) => ({ creatureId: s.creatureId, count: Math.max(1, Math.floor(s.count * fraction)) })) : [];
  const limits = { artifacts: Math.max(0, rules.artifacts ?? 3), stacks: Math.max(0, rules.creatureStacks || 0) };
  return {
    defId: hero.defId, level: hero.level, exp: hero.exp, primary: { ...hero.primary },
    skills: (hero.skills || []).map((s) => ({ id: s.id, level: s.level })),
    spells: (hero.spells || []).slice(), skillCounters: { ...(hero.skillCounters || {}) },
    artifacts: artifactOptions.slice(0, limits.artifacts), army: armyOptions.slice(0, limits.stacks),
    options: { artifacts: artifactOptions, army: armyOptions, limits },
  };
}

/**
 * Pick what the carried hero takes along (indices into `progress.hero.options.artifacts / .army`,
 * at most `options.limits`). Returns a NEW progress; invalid picks -> `{error}` thrown.
 */
export function setCarryChoice(progress, { artifacts = null, army = null } = {}) {
  const h = progress.hero;
  if (!h || !h.options) throw new Error('nothing to choose');
  const pick = (idx, list, max, what) => {
    if (idx == null) return null;
    const uniq = [...new Set(idx)];
    if (uniq.length > max) throw new Error(`at most ${max} ${what}`);
    if (uniq.some((i) => !Number.isInteger(i) || i < 0 || i >= list.length)) throw new Error(`bad ${what} index`);
    return uniq.sort((a, b) => a - b).map((i) => clone(list[i]));
  };
  const out = clone(progress);
  const a = pick(artifacts, h.options.artifacts, h.options.limits.artifacts, 'artifacts');
  const s = pick(army, h.options.army, h.options.limits.stacks, 'stacks');
  if (a) out.hero.artifacts = a;
  if (s) out.hero.army = s;
  return out;
}

/** Indices of the current pick within the options (for the briefing's chooser). */
export function carryChoiceIndices(progress) {
  const h = progress && progress.hero;
  if (!h || !h.options) return { artifacts: [], army: [] };
  const idx = (chosen, list) => {
    const used = new Set();
    return chosen.map((c) => list.findIndex((x, i) => !used.has(i) && JSON.stringify(x) === JSON.stringify(c) && used.add(i))).filter((i) => i >= 0);
  };
  return { artifacts: idx(h.artifacts, h.options.artifacts), army: idx(h.army, h.options.army) };
}

/** Did the campaign player win this game? */
export function isCampaignVictory(state) {
  const p = campaignPlayer(state);
  const over = state.gameOver;
  if (!p || !over) return false;
  return over.winner === p.id || (Array.isArray(over.winners) && over.winners.includes(p.id));
}

/**
 * Record the end of a campaign game. Victory: the scenario is completed, the main hero captured for
 * carry-over and the next scenarios unlocked. Defeat (or a game still running): only the attempt
 * counter changes. Returns a NEW progress object.
 */
export function completeScenario(progress, gameState) {
  const c = getCampaign(progress.campaignId);
  const meta = gameState?.meta?.campaign;
  if (!meta || meta.campaignId !== c.id) throw new Error('this game does not belong to the campaign');
  const sid = meta.scenarioId;
  const scenario = getScenario(c, sid);
  const out = clone(progress);
  out.attempts ??= {};
  out.attempts[sid] = (out.attempts[sid] || 0) + 1;
  if (!gameState.gameOver || !isCampaignVictory(gameState)) {
    out.lastResult = { scenarioId: sid, won: false, day: gameState.turn };
    return out;
  }
  if (!out.available.includes(sid)) return out;          // already recorded
  const p = campaignPlayer(gameState);
  out.completed.push({ scenarioId: sid, bonusIndex: meta.bonusIndex ?? null, days: gameState.turn, score: gameState.gameOver.score ?? null });
  out.hero = captureHero(gameState, c.heroDefId, c.carryOver) || out.hero;
  const done = new Set(out.completed.map((x) => x.scenarioId));
  out.available = (scenario.next || []).filter((id) => !done.has(id));
  if (!out.available.length) out.status = 'complete';
  out.lastResult = { scenarioId: sid, won: true, day: gameState.turn, playerId: p ? p.id : null };
  return out;
}

/** Problems in the campaign data (empty = fine). Used by the tests. */
export function validateCampaigns(list = CAMPAIGNS) {
  const errors = [];
  const ids = new Set();
  for (const c of list) {
    if (ids.has(c.id)) errors.push(`duplicate campaign ${c.id}`);
    ids.add(c.id);
    for (const k of ['title', 'description', 'heroDefId', 'start']) if (!c[k]) errors.push(`${c.id}: missing ${k}`);
    try { getHeroDef(c.heroDefId); } catch { errors.push(`${c.id}: unknown hero ${c.heroDefId}`); }
    const sids = new Set(c.scenarios.map((s) => s.id));
    if (sids.size !== c.scenarios.length) errors.push(`${c.id}: duplicate scenario ids`);
    if (!sids.has(c.start)) errors.push(`${c.id}: bad start`);
    for (const s of c.scenarios) {
      const where = `${c.id}/${s.id}`;
      const map = CAMPAIGN_MAP_BY_ID[s.map];
      if (!map) { errors.push(`${where}: unknown map ${s.map}`); continue; }
      if (!s.title || !s.intro || !s.outro) errors.push(`${where}: texts`);
      for (const n of s.next || []) if (!sids.has(n)) errors.push(`${where}: unknown next ${n}`);
      if (!Array.isArray(s.bonuses) || s.bonuses.length !== 3) errors.push(`${where}: needs 3 bonuses`);
      for (const b of s.bonuses || []) {
        try { describeBonus(b); } catch (e) { errors.push(`${where}: bad bonus ${JSON.stringify(b)} (${e.message})`); }
      }
      const main = (map.heroes || []).find((h) => h.owner === 0);
      if (!main || main.defId !== c.heroDefId) errors.push(`${where}: slot 0 must start with ${c.heroDefId}`);
      const f = getHeroDef(c.heroDefId).faction;
      if (map.playerInfo?.[0]?.faction !== f) errors.push(`${where}: slot 0 faction must be ${f}`);
    }
    // every scenario reachable from the start
    const seen = new Set();
    const st = [c.start];
    while (st.length) { const id = st.pop(); if (seen.has(id)) continue; seen.add(id); st.push(...(c.scenarios.find((x) => x.id === id)?.next || [])); }
    for (const s of c.scenarios) if (!seen.has(s.id)) errors.push(`${c.id}/${s.id}: unreachable`);
  }
  return errors;
}
