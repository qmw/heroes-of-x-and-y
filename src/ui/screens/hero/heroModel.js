// Pure view-model helpers of the hero screen, the hero exchange window and the level-up dialog.
import { PRIMARY_SKILLS, MAX_SECONDARY_SKILLS } from '../../../core/constants.js';
import { ARTIFACT_BY_ID } from '../../../data/artifacts.js';
import { SKILL_BY_ID } from '../../../data/skills.js';
import { BUILDING_BY_ID } from '../../../data/buildings.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { HERO_BY_ID } from '../../../data/heroes.js';
import { HERO_CLASS_BY_ID } from '../../../data/heroClasses.js';
import { getHeroBonuses, getPrimary } from '../../../engine/bonuses.js';
import { expForLevel, MAX_HERO_LEVEL } from '../../../engine/leveling.js';
import { moveArtifact as engineMoveArtifact, getAssemblableCombos } from '../../../engine/artifacts.js';

export const PRIMARY_NAMES = { attack: 'Attack', defense: 'Defense', power: 'Spell Power', knowledge: 'Knowledge' };
export const SKILL_LEVEL_NAMES = ['', 'Basic', 'Advanced', 'Expert'];

const humanize = (id) => String(id ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Readable name of a bonus / morale item source tag (pure). */
export function sourceLabel(source) {
  if (!source) return 'Other';
  const [kind, id, extra] = String(source).split(':');
  switch (kind) {
    case 'skill': return `${SKILL_BY_ID[id]?.name || humanize(id)} (skill)`;
    case 'artifact': return ARTIFACT_BY_ID[id]?.name || humanize(id);
    case 'specialty': return 'Specialty';
    case 'temp': return humanize(BUILDING_BY_ID[id]?.name || id);
    case 'building': return BUILDING_BY_ID[id]?.name || humanize(id);
    case 'object': return humanize(id);
    case 'town': return 'Town garrison';
    case 'alignment': return 'Troop alignment';
    case 'undead': return 'Undead in the army';
    case 'creature': return id === 'army_morale' ? 'Creature ability' : humanize(id);
    case 'enemy': return `Enemy: ${sourceLabel([id, extra].filter(Boolean).join(':'))}`;
    case 'hero': return 'Hero';
    default: return humanize(source);
  }
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * Primary skills with their breakdown (base + every `primary` bonus with its source).
 * @returns {{[stat]: {base, total, items: {source, label, value}[]}}}
 */
export function primaryBreakdown(state, hero) {
  const total = getPrimary(state, hero);
  const bonuses = getHeroBonuses(state, hero).filter((b) => b.type === 'primary');
  const out = {};
  for (const stat of PRIMARY_SKILLS) {
    const items = bonuses.filter((b) => b.stat === stat && b.value)
      .map((b) => ({ source: b.source, label: sourceLabel(b.source), value: b.value }));
    out[stat] = { base: hero.primary[stat] || 0, total: total[stat], items };
  }
  return out;
}

/** Tooltip text of one primary skill (pure). */
export function primaryTooltip(stat, b) {
  return [`${PRIMARY_NAMES[stat]}: ${b.total}`, `Base: ${b.base}`, ...b.items.map((i) => `${i.label}: ${signed(i.value)}`)].join('\n');
}

/** Lines of a morale / luck breakdown (`getArmyMoraleDetails` / `getArmyLuckDetails`) (pure). */
export function moraleLines(details) {
  if (!details) return [];
  const lines = (details.items || []).filter((i) => i.value).map((i) => `${sourceLabel(i.source)}: ${signed(i.value)}`);
  if (details.applies === false) lines.push('The army does not use this (undead / non-living troops).');
  if (details.blockedPositive) lines.push('Positive values are blocked.');
  if (details.nullified) lines.push('Nullified by the terrain.');
  return lines;
}

/** Experience progress: `{level, exp, from, to, max}` (pure). */
export function expInfo(hero) {
  const level = hero.level || 1;
  const max = level >= MAX_HERO_LEVEL;
  return { level, exp: hero.exp || 0, from: expForLevel(level), to: max ? expForLevel(level) : expForLevel(level + 1), max };
}

/** "Level 5 Knight" */
export function heroTitle(hero) {
  const cls = HERO_CLASS_BY_ID[hero.classId];
  return `Level ${hero.level || 1} ${cls ? cls.name : ''}`.trim();
}

export function specialtyText(hero) {
  const def = HERO_BY_ID[hero.defId];
  return def && def.specialty ? def.specialty.description || humanize(def.specialty.type) : '';
}

/** 8 secondary-skill slots: `[{id, level} | null]` (pure). */
export function skillSlots(hero) {
  const out = [];
  for (let i = 0; i < MAX_SECONDARY_SKILLS; i++) out.push(hero.skills[i] ? { ...hero.skills[i] } : null);
  return out;
}

/** Tooltip of a secondary skill at a level (pure). */
export function skillTooltip(skillId, level) {
  const s = SKILL_BY_ID[skillId];
  if (!s) return humanize(skillId);
  const lines = [`${SKILL_LEVEL_NAMES[level]} ${s.name}`, s.levels[level - 1].description];
  if (level < 3) lines.push(`Next: ${s.levels[level].description}`);
  return lines.join('\n');
}

/** Turn an ArtifactGrid ref into an engine location (pure). */
export function engineRef(ref) {
  return ref.where === 'backpack' ? { backpack: ref.index } : { slot: ref.slot, index: ref.index };
}

/**
 * Move an artifact inside ONE hero (paper doll <-> backpack, ring 1 <-> ring 2, backpack order):
 * the engine's `moveArtifact` with ArtifactGrid refs. Result-shaped; on failure the hero is unchanged.
 */
export function moveArtifact(hero, from, to) {
  return engineMoveArtifact(hero, engineRef(from), engineRef(to));
}

/** Combination artifacts that the hero could assemble and that use `artifactId` (pure). */
export function combosFor(hero, artifactId) {
  return getAssemblableCombos(hero).filter((c) => (ARTIFACT_BY_ID[c].components || []).includes(artifactId) || c === artifactId);
}

/** Army strength / description line of a stack (pure). */
export function stackText(stack) {
  if (!stack) return '';
  const c = CREATURE_BY_ID[stack.creatureId];
  return `${stack.count} ${c ? c.name : stack.creatureId}`;
}

/** Quests the player has seen (seer huts / quest guards he visited), `[{objectId, text, reward}]`. */
export function questLog(state, hero) {
  const player = state.players[hero.owner];
  const out = [];
  for (const obj of Object.values(state.map?.objects || {})) {
    const q = obj.data && obj.data.quest;
    if (!q) continue;
    const seen = (player && player.visited && player.visited[obj.id]) || (hero.visited && hero.visited[obj.id]);
    if (!seen) continue;
    out.push({ objectId: obj.id, defId: obj.defId, pos: obj.pos, text: questText(q), done: !!obj.data.completed });
  }
  return out;
}

/** Text of a quest (adventure-objects.md §3.8 types) (pure). */
export function questText(q) {
  switch (q.type) {
    case 'reach_level': return `Reach experience level ${q.level}.`;
    case 'reach_primary': return `Have at least ${Object.entries(q.stats || {}).map(([s, v]) => `${v} ${PRIMARY_NAMES[s] || s}`).join(', ')}.`;
    case 'kill_hero': return `Defeat the hero ${HERO_BY_ID[q.heroDefId]?.name || q.heroId || ''}.`.replace(' .', '.');
    case 'kill_monster': return 'Defeat a certain monster.';
    case 'bring_artifacts': return `Bring ${(q.artifactIds || []).map((a) => ARTIFACT_BY_ID[a]?.name || a).join(', ')}.`;
    case 'bring_creatures': return `Bring ${(q.creatures || []).map((c) => `${c.count} ${CREATURE_BY_ID[c.creatureId]?.name || c.creatureId}`).join(', ')}.`;
    case 'bring_resources': return `Bring ${Object.entries(q.resources || {}).filter(([, v]) => v).map(([r, v]) => `${v} ${r}`).join(', ')}.`;
    case 'be_hero': return `Only ${HERO_BY_ID[q.heroDefId]?.name || 'a certain hero'} may pass.`;
    case 'be_player': return 'Only a certain player may pass.';
    default: return humanize(q.type);
  }
}

/** Hero ids of the player in order (prev / next hero). */
export function playerHeroIds(state, playerId) {
  const p = state.players[playerId];
  return p ? p.heroes.filter((id) => state.heroes[id]) : [];
}
