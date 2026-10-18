// Map editor: validation of object instance data typed into the inspector (docs/mechanics/editor.md §3).
// Every checker returns a list of human-readable problems ([] = fine).
import { RESOURCES, PRIMARY_SKILLS, FACTIONS } from '../../core/constants.js';
import { MONSTER_DISPOSITIONS, QUEST_TYPES } from '../../data/mapObjects.js';
import { CREATURE_BY_ID } from '../../data/creatures.js';
import { ARTIFACT_BY_ID } from '../../data/artifacts.js';
import { SPELL_BY_ID } from '../../data/spells.js';
import { SKILL_BY_ID } from '../../data/skills.js';
import { HERO_BY_ID } from '../../data/heroes.js';
import { BUILDING_BY_ID } from '../../data/buildings.js';

/** Quest types the editor offers (kill_hero by starting-hero index or hero defId, resolved by createGame). */
export const EDITOR_QUEST_TYPES = QUEST_TYPES.slice();
/** Effect types whose instances may have an owner (flaggable). */
export const OWNABLE_EFFECTS = ['mine', 'dwelling', 'lighthouse', 'shipyard', 'garrison'];
export const PAYLOAD_KEYS = ['message', 'exp', 'mana', 'morale', 'luck', 'resources', 'primary', 'skills', 'artifacts', 'spells', 'creatures'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

export function armyProblems(list, what = 'army') {
  if (list == null) return [];
  if (!Array.isArray(list)) return [`${what} must be a list`];
  const out = [];
  for (const s of list) {
    if (s == null) continue;
    if (!CREATURE_BY_ID[s.creatureId]) out.push(`${what}: unknown creature ${s.creatureId}`);
    else if (!(isInt(s.count) && s.count >= 1)) out.push(`${what}: bad count for ${s.creatureId}`);
  }
  return out;
}

export function resourcesProblems(res, what = 'resources') {
  if (res == null) return [];
  if (typeof res !== 'object' || Array.isArray(res)) return [`${what} must be an object`];
  const out = [];
  for (const [k, v] of Object.entries(res)) {
    if (!RESOURCES.includes(k)) out.push(`${what}: unknown resource ${k}`);
    else if (!isNum(v)) out.push(`${what}: ${k} must be a number`);
  }
  return out;
}

/** A Reward / event payload (adventure-objects.md Reward vocabulary, concrete values only). */
export function rewardProblems(r) {
  if (r == null) return [];
  if (typeof r !== 'object' || Array.isArray(r)) return ['reward must be an object'];
  const out = [...resourcesProblems(r.resources)];
  for (const k of ['exp', 'mana', 'morale', 'luck']) if (r[k] != null && !isNum(r[k])) out.push(`${k} must be a number`);
  if (r.primary != null) {
    for (const [k, v] of Object.entries(r.primary)) {
      if (!PRIMARY_SKILLS.includes(k)) out.push(`unknown primary skill ${k}`);
      else if (!isNum(v)) out.push(`${k} must be a number`);
    }
  }
  const arts = [...(r.artifacts || []), ...(r.artifact ? [r.artifact] : [])];
  for (const a of arts) {
    const id = typeof a === 'string' ? a : a && a.id;
    if (!ARTIFACT_BY_ID[id]) out.push(`unknown artifact ${id}`);
    if (id === 'spell_scroll' && typeof a === 'object' && !SPELL_BY_ID[a.spellId]) out.push(`unknown scroll spell ${a.spellId}`);
  }
  for (const s of Array.isArray(r.spells) ? r.spells : []) if (!SPELL_BY_ID[s]) out.push(`unknown spell ${s}`);
  if (r.spell) {
    const id = typeof r.spell === 'string' ? r.spell : r.spell.spellId;
    if (!SPELL_BY_ID[id]) out.push(`unknown spell ${id}`);
  }
  out.push(...armyProblems(r.creatures, 'creatures'));
  for (const s of r.skills || []) if (!SKILL_BY_ID[s && s.id] || !(s.level >= 1 && s.level <= 3)) out.push(`bad skill ${s && s.id}`);
  if (r.skill && (!SKILL_BY_ID[r.skill.id || r.skill] )) out.push(`unknown skill ${r.skill.id || r.skill}`);
  if (r.message != null && typeof r.message !== 'string') out.push('message must be text');
  return out;
}

/** Concrete quest (adventure-engine.md "Quests"). `bp` resolves kill_monster / be_player references. */
export function questProblems(bp, q) {
  if (q == null) return [];
  if (typeof q !== 'object' || !QUEST_TYPES.includes(q.type)) return [`unknown quest type ${q && q.type}`];
  switch (q.type) {
    case 'reach_level': return isInt(q.level) && q.level >= 2 && q.level <= 75 ? [] : ['level must be 2..75'];
    case 'reach_primary': {
      const st = q.stats || {};
      const keys = Object.keys(st);
      if (!keys.length) return ['choose at least one primary skill'];
      return keys.filter((k) => !PRIMARY_SKILLS.includes(k) || !(isInt(st[k]) && st[k] >= 1)).map((k) => `bad primary skill requirement ${k}`);
    }
    case 'kill_hero': {
      if (q.heroId) return [];
      if (q.heroIndex != null) return isInt(q.heroIndex) && bp && bp.heroes && bp.heroes[q.heroIndex] ? [] : ['the hero to defeat does not exist'];
      return HERO_BY_ID[q.heroDefId] ? [] : ['choose the hero to defeat'];
    }
    case 'kill_monster': {
      const o = bp && bp.map.objects[q.objectId];
      return o && o.defId === 'monster' ? [] : ['the monster to kill does not exist'];
    }
    case 'bring_artifacts': {
      const ids = q.artifactIds || [];
      if (!ids.length) return ['choose at least one artifact'];
      return ids.filter((a) => !ARTIFACT_BY_ID[a]).map((a) => `unknown artifact ${a}`);
    }
    case 'bring_creatures': {
      if (!(q.creatures || []).length) return ['choose the creatures'];
      return armyProblems(q.creatures, 'creatures');
    }
    case 'bring_resources': {
      const res = q.resources || {};
      if (!Object.values(res).some((v) => v > 0)) return ['choose an amount'];
      return resourcesProblems(res);
    }
    case 'be_hero': return HERO_BY_ID[q.heroDefId] ? [] : [`unknown hero ${q.heroDefId}`];
    case 'be_player': {
      const n = (bp && bp.meta && bp.meta.playerSlots) || 8;
      return isInt(q.playerId) && q.playerId >= 0 && q.playerId < n ? [] : ['bad player'];
    }
    default: return [];
  }
}

/**
 * Problems of an object's instance data for its definition (only the fields that are present).
 * @param {object} bp blueprint (for references) @param {object} def MapObjectDef @param {object} d data
 */
export function objectDataProblems(bp, def, d) {
  if (!d) return [];
  const out = [];
  const fx = def.effect.type;
  if (d.guards != null) out.push(...armyProblems(d.guards, 'guards'));
  if (d.amount != null && !(isInt(d.amount) && d.amount >= 1)) out.push('amount must be a positive number');
  switch (fx) {
    case 'monster':
      if (d.creatureId != null && (!CREATURE_BY_ID[d.creatureId] || CREATURE_BY_ID[d.creatureId].warMachine)) out.push(`unknown creature ${d.creatureId}`);
      if (d.count != null && !(isInt(d.count) && d.count >= 1 && d.count <= 100000)) out.push('count must be 1..100000');
      if (d.disposition != null && !MONSTER_DISPOSITIONS.some((x) => x.id === d.disposition)) out.push(`unknown disposition ${d.disposition}`);
      break;
    case 'artifact':
      if (d.artifactId != null && !ARTIFACT_BY_ID[d.artifactId]) out.push(`unknown artifact ${d.artifactId}`);
      break;
    case 'spell_scroll':
      if (d.spellId != null && !SPELL_BY_ID[d.spellId]) out.push(`unknown spell ${d.spellId}`);
      break;
    case 'pandoras_box': case 'event': {
      const payload = {};
      for (const k of PAYLOAD_KEYS) if (d[k] != null) payload[k] = d[k];
      out.push(...rewardProblems(payload));
      if (d.players != null) {
        const n = (bp && bp.meta && bp.meta.playerSlots) || 8;
        if (!Array.isArray(d.players) || d.players.some((s) => !(isInt(s) && s >= 0 && s < n))) out.push('bad player list');
      }
      break;
    }
    case 'seer_hut':
      out.push(...questProblems(bp, d.quest), ...rewardProblems(d.reward));
      break;
    case 'quest_guard':
      out.push(...questProblems(bp, d.quest));
      break;
    case 'message':
      if (d.text != null && typeof d.text !== 'string') out.push('text must be text');
      break;
    case 'prison':
      if (d.heroDefId != null && !HERO_BY_ID[d.heroDefId]) out.push(`unknown hero ${d.heroDefId}`);
      break;
    case 'garrison':
      if (d.army != null) out.push(...armyProblems(d.army, 'army'));
      break;
    default: break;
  }
  return out;
}

/** Problems of a town entry patch. */
export function townProblems(bp, t) {
  const out = [];
  if (t.faction != null && t.faction !== 'random' && !FACTIONS.includes(t.faction)) out.push(`unknown faction ${t.faction}`);
  if (t.ownerSlot != null && !(isInt(t.ownerSlot) && t.ownerSlot >= 0 && t.ownerSlot < bp.meta.playerSlots)) out.push('bad owner');
  if (t.buildings != null) {
    if (!Array.isArray(t.buildings)) out.push('buildings must be a list');
    else for (const b of t.buildings) if (!BUILDING_BY_ID[b]) out.push(`unknown building ${b}`);
  }
  if (t.name != null && typeof t.name !== 'string') out.push('name must be text');
  return out;
}

export function heroProblems(bp, h) {
  const out = [];
  if (h.defId != null && h.defId !== 'random' && !HERO_BY_ID[h.defId]) out.push(`unknown hero ${h.defId}`);
  if (h.ownerSlot !== undefined && !(isInt(h.ownerSlot) && h.ownerSlot >= 0 && h.ownerSlot < bp.meta.playerSlots)) out.push('bad owner');
  if (h.army != null) {
    out.push(...armyProblems(h.army, 'army'));
    if (Array.isArray(h.army) && new Set(h.army.filter(Boolean).map((s) => s.creatureId)).size > 7) out.push('army: at most 7 kinds of creatures');
  }
  if (h.primary != null) {
    for (const [k, v] of Object.entries(h.primary)) if (!PRIMARY_SKILLS.includes(k) || !(isInt(v) && v >= 0 && v <= 99)) out.push(`bad primary skill ${k}`);
  }
  if (h.skills != null) {
    if (!Array.isArray(h.skills) || h.skills.length > 8) out.push('at most 8 secondary skills');
    else for (const sk of h.skills) if (!SKILL_BY_ID[sk && sk.id] || !(sk.level >= 1 && sk.level <= 3)) out.push(`bad skill ${sk && sk.id}`);
  }
  for (const sp of h.spells || []) if (!SPELL_BY_ID[sp]) out.push(`unknown spell ${sp}`);
  for (const a of h.artifacts || []) if (!ARTIFACT_BY_ID[a] || ARTIFACT_BY_ID[a].instanced) out.push(`unknown artifact ${a}`);
  return out;
}

/** A map-wide timed event `{name, day, repeat, players: [slot], humanOnly, aiOnly, message, resources, creatures}`. */
export function timedEventProblems(bp, e) {
  const out = [];
  if (!e || typeof e !== 'object') return ['bad event'];
  if (!(isInt(e.day) && e.day >= 1)) out.push('first day must be 1 or later');
  if (e.repeat != null && !(isInt(e.repeat) && e.repeat >= 0)) out.push('repeat must be 0 (once) or a number of days');
  if (e.players != null) {
    const n = (bp && bp.meta && bp.meta.playerSlots) || 8;
    if (!Array.isArray(e.players) || e.players.some((s) => !(isInt(s) && s >= 0 && s < n))) out.push('bad player list');
  }
  if (e.message != null && typeof e.message !== 'string') out.push('message must be text');
  out.push(...resourcesProblems(e.resources), ...armyProblems(e.creatures, 'creatures'));
  return out;
}
