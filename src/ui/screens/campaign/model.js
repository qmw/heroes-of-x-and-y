// Campaign screens - pure helpers (no DOM): progress persistence through the UI storage API
// (`storage.readData / writeData`, key `h3o.data.campaign.<id>`), card / briefing view models and
// the launch sequence. Engine: src/engine/campaign/index.js. Doc: docs/mechanics/campaigns.md.
import * as C from '../../../engine/campaign/index.js';
import { getArtifact } from '../../../data/artifacts.js';
import { getSpell } from '../../../data/spells.js';
import { getCreature } from '../../../data/creatures.js';
import { getHeroDef } from '../../../data/heroes.js';
import { getTerrain } from '../../../data/terrain.js';

/** Recommended createGame difficulty of a campaign. */
export const defaultDifficulty = (campaign) => C.DIFFICULTY_BY_LABEL[campaign.difficulty] ?? 1;

export const dataKey = (campaignId) => `campaign.${campaignId}`;

export function loadProgress(storage, campaignId) {
  if (!storage || !storage.readData) return null;
  return C.normalizeProgress(storage.readData(dataKey(campaignId)));
}

export function saveProgress(storage, progress) {
  if (!storage || !storage.writeData) return { ok: false, error: 'storage_failed' };
  return storage.writeData(dataKey(progress.campaignId), progress);
}

export function clearProgress(storage, campaignId) {
  if (storage && storage.removeData) storage.removeData(dataKey(campaignId));
}

/** Card for the select screen. */
export function cardModel(campaign, progress) {
  const length = C.campaignLength(campaign);
  const done = progress ? progress.completed.length : 0;
  const complete = !!progress && progress.status === 'complete';
  const status = !progress ? 'Not started' : complete ? 'Completed' : `Scenario ${done + 1} of ${length}`;
  return {
    id: campaign.id, title: campaign.title, description: campaign.description, heroDefId: campaign.heroDefId,
    heroName: getHeroDef(campaign.heroDefId).name, factions: campaign.factions.slice(), difficulty: campaign.difficulty,
    length, done, complete, started: !!progress, status, ratio: progress ? C.campaignProgressRatio(progress) : 0,
    scenarios: campaign.scenarios.map((s) => ({
      id: s.id, title: s.title,
      state: progress && progress.completed.some((x) => x.scenarioId === s.id) ? 'done'
        : progress && !complete && progress.available.includes(s.id) ? 'next' : 'locked',
    })),
  };
}

/** Lines describing the hero that will be carried into the next scenario (empty for a fresh start). */
export function carriedHeroLines(progress) {
  const h = progress && progress.hero;
  if (!h) return [];
  const lines = [`${getHeroDef(h.defId).name}, level ${h.level} (${h.primary.attack}/${h.primary.defense}/${h.primary.power}/${h.primary.knowledge})`];
  if (h.skills.length) lines.push(`Skills: ${h.skills.map((s) => `${['', 'Basic', 'Advanced', 'Expert'][s.level] || ''} ${humanize(s.id)}`.trim()).join(', ')}`);
  if (h.spells.length) lines.push(`Spells: ${h.spells.map((id) => safe(() => getSpell(id).name, id)).join(', ')}`);
  if (h.artifacts.length) lines.push(`Artifacts: ${h.artifacts.map((e) => safe(() => getArtifact(typeof e === 'string' ? e : e.id).name, String(e))).join(', ')}`);
  if (h.army && h.army.length) lines.push(`Troops: ${h.army.map((s) => `${s.count} ${safe(() => getCreature(s.creatureId).name, s.creatureId)}`).join(', ')}`);
  return lines;
}

/** Is there anything for the player to choose before the next scenario? */
export function canChooseCarry(progress) {
  const o = progress && progress.hero && progress.hero.options;
  return !!o && ((o.limits.artifacts > 0 && o.artifacts.length > 0) || (o.limits.stacks > 0 && o.army.length > 0));
}

/** Label of a carry-over option (artifact entry or {creatureId, count}). */
export function carryItemLabel(kind, item) {
  if (kind === 'artifacts') {
    const id = typeof item === 'string' ? item : item.id;
    const name = safe(() => getArtifact(id).name, id);
    return item && item.spellId ? `${name} (${safe(() => getSpell(item.spellId).name, item.spellId)})` : name;
  }
  return `${item.count} ${safe(() => getCreature(item.creatureId).name, item.creatureId)}`;
}

/** Icon for a bonus option ({kind, id}). */
export function bonusIcon(b) {
  switch (b.type) {
    case 'artifact': return { kind: 'artifact', id: b.artifactId };
    case 'creatures': return { kind: 'creature', id: b.creatureId };
    case 'spell': return { kind: 'spell', id: b.spellId };
    case 'resources': return { kind: 'resource', id: Object.keys(b.resources)[0] || 'gold' };
    default: return { kind: 'ui', id: 'experience' };
  }
}

/** Briefing view model of a scenario. */
export function briefingModel(progress, scenarioId) {
  const c = C.getCampaign(progress.campaignId);
  const s = C.getScenario(c, scenarioId);
  const info = C.campaignMapInfo(s.map);
  const index = progress.completed.length + 1;
  return {
    campaignTitle: c.title, title: s.title, index, length: C.campaignLength(c),
    intro: s.intro.split(/\n\n+/), victory: info.victoryText, loss: info.lossText,
    size: info.size, width: info.width, height: info.height, players: info.players, factions: info.factions,
    bonuses: s.bonuses.map((b, i) => ({ index: i, text: C.describeBonus(b), icon: bonusIcon(b), bonus: b })),
    carried: carriedHeroLines(progress), map: s.map,
  };
}

const PLAYER_HEX = { red: '#c8322a', blue: '#2f5fd0', tan: '#b89a6a', green: '#3c9a3c', orange: '#e0832a', purple: '#8a3fb8', teal: '#2aa3a0', pink: '#d87aa8' };
const SLOT_COLORS = ['red', 'blue', 'tan', 'green', 'orange', 'purple', 'teal', 'pink'];

/**
 * Paint a small overview of a blueprint (level 0) into a 2D context: terrain colours, darker
 * obstacles, light roads, towns in their owner's colour (grey = neutral).
 */
export function drawBlueprintPreview(g, bp, w, h) {
  const map = bp.map;
  const sx = w / map.width; const sy = h / map.height;
  const shade = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${ch(n >> 16)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
  };
  const colors = {};
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[0][y][x];
      const key = `${t.t}:${t.blocked ? 1 : 0}:${t.road ? 1 : 0}`;
      if (!colors[key]) {
        let base = '#808080';
        try { base = getTerrain(t.t).color || base; } catch { /* unknown terrain */ }
        colors[key] = t.road ? shade(base, 1.45) : t.blocked ? shade(base, 0.55) : base;
      }
      g.fillStyle = colors[key];
      g.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
    }
  }
  for (const o of Object.values(map.objects || {})) {
    if (!o.pos || o.pos.z || o.defId !== 'monster') continue;
    g.fillStyle = 'rgba(200, 40, 40, 0.9)';
    g.fillRect(o.pos.x * sx, o.pos.y * sy, Math.max(2, sx), Math.max(2, sy));
  }
  for (const t of bp.towns || []) {
    if (t.pos.z) continue;
    g.fillStyle = t.ownerSlot != null ? PLAYER_HEX[SLOT_COLORS[t.ownerSlot]] : '#d8d8d8';
    g.fillRect((t.pos.x - 2) * sx, (t.pos.y - 2) * sy, 5 * sx, 3 * sy);
    g.strokeStyle = '#000';
    g.lineWidth = 1;
    g.strokeRect((t.pos.x - 2) * sx, (t.pos.y - 2) * sy, 5 * sx, 3 * sy);
  }
}

/**
 * Create the game of a campaign scenario and make it current (no navigation).
 * @returns {Promise<{ok: true, state} | {ok: false, error}>}
 */
export async function launchScenario(ctx, progress, bonusIndex, scenarioId) {
  const game = await ctx.engine.load('game');
  if (!game || typeof game.createGame !== 'function') return { ok: false, error: 'The game engine is not available.' };
  try {
    const { blueprint, settings, carry } = C.startCampaignScenario(progress, bonusIndex, scenarioId);
    const state = game.createGame(blueprint, settings);
    const res = C.applyCarryOver(state, carry);
    if (!res.ok) return { ok: false, error: `carry-over failed: ${res.error}` };
    return { ok: true, state };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function humanize(id) { return String(id).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
