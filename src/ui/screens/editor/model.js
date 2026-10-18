// Map editor screen: pure helpers (no DOM). Tools, the object browser catalogue, the preview state
// the adventure map renderer draws, inspector field specs, status texts. docs/mechanics/editor.md §5.
import { PLAYER_COLORS, FACTIONS, RESOURCES, PRIMARY_SKILLS } from '../../../core/constants.js';
import { MAP_OBJECTS, MAP_OBJECT_BY_ID, MONSTER_DISPOSITIONS } from '../../../data/mapObjects.js';
import { TERRAIN_DATA, TERRAIN_BY_ID, ROADS } from '../../../data/terrain.js';
import { FACTIONS_DATA, FACTION_BY_ID } from '../../../data/factions.js';
import { HEROES, HERO_BY_ID } from '../../../data/heroes.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';

export const TOOLS = [
  { id: 'select', key: '1', label: 'Select', hint: 'Click to select, drag to move, Delete to remove' },
  { id: 'terrain', key: '2', label: 'Terrain', hint: 'Paint terrain with the brush' },
  { id: 'fill', key: '3', label: 'Fill', hint: 'Flood-fill a terrain region' },
  { id: 'road', key: '4', label: 'Road', hint: 'Drag to draw a road' },
  { id: 'river', key: '5', label: 'River', hint: 'Drag to draw a river' },
  { id: 'object', key: '6', label: 'Object', hint: 'Place the object chosen in the browser' },
  { id: 'erase', key: '7', label: 'Erase', hint: 'Remove objects (and roads / rivers with the brush)' },
  { id: 'town', key: '8', label: 'Town', hint: 'Place a town' },
  { id: 'hero', key: '9', label: 'Hero', hint: 'Place a starting hero' },
];
export const TOOL_BY_KEY = Object.fromEntries(TOOLS.map((t) => [t.key, t.id]));

export const PAINT_TERRAINS = TERRAIN_DATA.map((t) => t.id);
export const ROAD_TYPES = [{ index: 0, name: 'Erase' }, ...ROADS.map((r) => ({ index: r.index, name: r.name }))];

export const BROWSER_CATEGORIES = [
  { id: 'all', name: 'All' },
  { id: 'town', name: 'Towns & heroes' },
  { id: 'guard', name: 'Monsters & guards' },
  { id: 'resource', name: 'Resources' },
  { id: 'treasure', name: 'Treasure' },
  { id: 'mine', name: 'Mines' },
  { id: 'dwelling', name: 'Dwellings' },
  { id: 'bank', name: 'Creature banks' },
  { id: 'visit', name: 'Visitable' },
  { id: 'transport', name: 'Transport' },
  { id: 'special', name: 'Special' },
  { id: 'decor', name: 'Obstacles' },
];
const CATEGORY_GROUP = {
  resource: 'resource', treasure: 'treasure', mine: 'mine', dwelling: 'dwelling', bank: 'bank', guard: 'guard',
  visit_once: 'visit', visit_weekly: 'visit', visit_per_hero: 'visit', visit_per_player: 'visit',
  transport: 'transport', special: 'special', decor: 'decor', town: 'town',
};

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const slotName = (slot) => (slot == null ? 'Neutral' : cap(PLAYER_COLORS[slot] || `player ${slot + 1}`));

/**
 * Object browser entries: every map object + one town entry per faction + random town + hero.
 * `{key, defId, name, group, props, icon: {kind, id, opts}, size, search}`.
 */
export function buildCatalog() {
  const out = [];
  for (const f of FACTIONS_DATA) {
    out.push({ key: `town:${f.id}`, defId: 'town', name: `${f.name} town`, group: 'town', props: { faction: f.id }, icon: { kind: 'object', id: 'town', opts: { variant: f.id } }, size: [5, 3] });
  }
  out.push({ key: 'random_town', defId: 'random_town', name: 'Random town', group: 'town', props: { faction: 'random' }, icon: { kind: 'object', id: 'random_town' }, size: [5, 3] });
  out.push({ key: 'hero', defId: 'hero', name: 'Hero (starting)', group: 'town', props: { defId: 'random' }, icon: { kind: 'hero', id: HEROES[0].id }, size: [1, 1] });
  for (const def of MAP_OBJECTS) {
    if (def.category === 'town') continue;
    const icon = def.id === 'monster' ? { kind: 'creature', id: 'pikeman' } : { kind: 'object', id: def.id };
    out.push({ key: def.id, defId: def.id, name: def.name, group: CATEGORY_GROUP[def.category] || 'special', props: {}, icon, size: def.size });
  }
  for (const e of out) e.search = `${e.name} ${e.defId} ${e.group}`.toLowerCase();
  return out;
}

/** Filter by browser category and a search text (all words must match). */
export function filterCatalog(catalog, { category = 'all', search = '' } = {}) {
  const words = String(search).toLowerCase().split(/\s+/).filter(Boolean);
  return catalog.filter((e) => (category === 'all' || e.group === category) && words.every((w) => e.search.includes(w)));
}

/** A stand-in hero def for drawing a random hero (first hero of the faction, else the first hero). */
function drawHeroDef(bp, h) {
  if (h.defId && h.defId !== 'random' && HERO_BY_ID[h.defId]) return h.defId;
  const town = bp.towns.find((t) => t.ownerSlot === h.ownerSlot && t.faction !== 'random');
  const def = town && HEROES.find((d) => d.faction === town.faction);
  return (def || HEROES[0]).id;
}

/**
 * The "GameState" the adventure map renderer reads: tiles shared with the blueprint (painting needs
 * no rebuild, only `syncPreview`), towns as town objects, heroes as hero entities, no fog.
 */
export function createPreview(bp) {
  const preview = { map: { width: bp.map.width, height: bp.map.height, levels: bp.map.levels, tiles: bp.map.tiles, objects: {} }, players: [], heroes: {}, towns: {}, turn: 1, editor: true };
  syncPreview(preview, bp);
  return preview;
}

/** Refresh objects / towns / heroes / players of a preview (after any edit). */
export function syncPreview(preview, bp) {
  preview.map.tiles = bp.map.tiles;
  preview.map.width = bp.map.width;
  preview.map.height = bp.map.height;
  preview.map.levels = bp.map.levels;
  const objects = { ...bp.map.objects };
  const towns = {};
  bp.towns.forEach((t, i) => {
    const id = `et${i}`;
    towns[id] = { id, name: t.name || '', faction: t.faction, owner: t.ownerSlot ?? null, pos: t.pos, buildings: t.buildings || [] };
    objects[`__town${i}`] = { id: `__town${i}`, defId: t.faction === 'random' ? 'random_town' : 'town', pos: t.pos, owner: t.ownerSlot ?? null, data: { townId: id } };
  });
  const heroes = {};
  bp.heroes.forEach((h, i) => {
    const id = `eh${i}`;
    heroes[id] = { id, defId: drawHeroDef(bp, h), name: h.defId !== 'random' && HERO_BY_ID[h.defId] ? HERO_BY_ID[h.defId].name : 'Random hero', owner: h.ownerSlot, pos: h.pos };
  });
  preview.map.objects = objects;
  preview.towns = towns;
  preview.heroes = heroes;
  preview.players = Array.from({ length: bp.meta.playerSlots || 0 }, (_, slot) => ({ id: slot, color: PLAYER_COLORS[slot], name: slotName(slot), explored: [] }));
  return preview;
}

/** Status-bar text for a tile. */
export function tileText(bp, pos, ref, describe) {
  const t = bp.map.tiles[pos.z || 0]?.[pos.y]?.[pos.x];
  if (!t) return '';
  const parts = [`${pos.x}, ${pos.y}${bp.map.levels > 1 ? (pos.z ? ' (underground)' : ' (surface)') : ''}`, (TERRAIN_BY_ID[t.t] || {}).name || t.t];
  if (t.road) parts.push((ROADS.find((r) => r.index === t.road) || {}).name || 'road');
  if (t.river) parts.push('river');
  if (ref && describe) {
    const d = describe(ref);
    if (d) parts.push(`${d.name}${d.owner != null ? ` (${slotName(d.owner)})` : ''}`);
  }
  return parts.join(' - ');
}

// ---- inspector ----------------------------------------------------------------------------------

/**
 * Field specs for the inspector of a ref. Each field: `{id, label, type, value, options?, min?, max?}`;
 * `apply(values) -> patch` turns edited values into a `setProps` patch.
 * types: text | textarea | number | select | check | list (comma separated ids)
 */
export function inspectorSpec(bp, ref, entity) {
  const slotOptions = (neutral) => [...(neutral ? [{ value: null, label: 'Neutral' }] : []), ...Array.from({ length: bp.meta.playerSlots }, (_, s) => ({ value: s, label: slotName(s) }))];
  if (ref.kind === 'town') {
    return {
      title: entity.name || `${(FACTION_BY_ID[entity.faction] || { name: 'Random' }).name} town`,
      fields: [
        { id: 'faction', label: 'Town', type: 'select', value: entity.faction, options: [{ value: 'random', label: 'Random' }, ...FACTIONS_DATA.map((f) => ({ value: f.id, label: f.name }))] },
        { id: 'ownerSlot', label: 'Owner', type: 'select', value: entity.ownerSlot ?? null, options: slotOptions(true) },
        { id: 'name', label: 'Name', type: 'text', value: entity.name || '' },
        { id: 'buildings', label: 'Buildings', type: 'list', value: (entity.buildings || []).join(', '), hint: 'Building ids; empty = default start' },
      ],
      apply: (v) => ({ faction: v.faction, ownerSlot: v.ownerSlot, name: v.name || null, buildings: splitList(v.buildings) }),
    };
  }
  if (ref.kind === 'hero') {
    return {
      title: entity.defId !== 'random' && HERO_BY_ID[entity.defId] ? HERO_BY_ID[entity.defId].name : 'Random hero',
      fields: [
        { id: 'defId', label: 'Hero', type: 'hero', allowRandom: true, value: entity.defId },
        { id: 'ownerSlot', label: 'Owner', type: 'select', value: entity.ownerSlot, options: slotOptions(false) },
        { id: 'army', label: 'Army', type: 'stacks', value: entity.army || [], hint: 'empty = the hero\'s usual army' },
        ...PRIMARY_SKILLS.map((p) => ({ id: `pri_${p}`, label: cap(p), type: 'number', value: (entity.primary || {})[p] ?? '', min: 0, max: 99, hint: p === 'attack' ? 'empty = class default' : undefined })),
        { id: 'skills', label: 'Skills', type: 'skills', value: entity.skills || [], hint: 'empty = the hero\'s usual skills' },
        { id: 'spells', label: 'Spells', type: 'spells', value: entity.spells || [] },
        { id: 'artifacts', label: 'Artifacts', type: 'artifacts', value: entity.artifacts || [] },
      ],
      apply: (v) => {
        const primary = {};
        for (const p of PRIMARY_SKILLS) if (v[`pri_${p}`] !== '' && v[`pri_${p}`] != null && Number.isFinite(Number(v[`pri_${p}`]))) primary[p] = Number(v[`pri_${p}`]);
        return { defId: v.defId, ownerSlot: v.ownerSlot, army: stacksOf(v.army), primary: Object.keys(primary).length ? primary : null, skills: v.skills && v.skills.length ? v.skills : null, spells: listOf(v.spells), artifacts: listOf(v.artifacts) };
      },
    };
  }
  const def = MAP_OBJECT_BY_ID[entity.defId];
  const d = entity.data || {};
  const fx = def.effect.type;
  const fields = [];
  let apply = () => ({});
  const ownable = ['mine', 'dwelling', 'lighthouse', 'shipyard', 'garrison'].includes(fx);
  if (ownable) fields.push({ id: 'owner', label: 'Owner', type: 'select', value: entity.owner ?? null, options: slotOptions(true) });
  const withOwner = (patch, v) => (ownable ? { ...patch, owner: v.owner } : patch);
  switch (fx) {
    case 'monster':
      fields.push(
        { id: 'creatureId', label: 'Creature', type: 'creature', value: d.creatureId || '' },
        { id: 'count', label: 'Count', type: 'number', value: d.count || 1, min: 1, max: 100000 },
        { id: 'disposition', label: 'Disposition', type: 'select', value: d.disposition || 'aggressive', options: MONSTER_DISPOSITIONS.map((x) => ({ value: x.id, label: x.name })) },
        { id: 'neverFlees', label: 'Never flees', type: 'check', value: !!d.neverFlees },
        { id: 'noGrowth', label: 'Does not grow', type: 'check', value: !!d.noGrowth },
      );
      apply = (v) => ({ data: { creatureId: v.creatureId, count: v.count, disposition: v.disposition, neverFlees: v.neverFlees, noGrowth: v.noGrowth } });
      break;
    case 'pickup':
      if (def.category === 'resource') {
        const res = Object.keys(((def.effect.table || [])[0] || {}).reward?.resources || {})[0];
        const amount = d.reward && d.reward.resources ? d.reward.resources[res] : null;
        fields.push({ id: 'amount', label: 'Amount', type: 'number', value: amount ?? 0, min: 0, max: 100000, hint: '0 = random (as in the original)' });
        apply = (v) => ({ data: v.amount > 0 ? { amount: v.amount } : { reward: null } });
      }
      break;
    case 'artifact':
      fields.push({ id: 'artifactId', label: 'Artifact', type: 'artifact', value: d.artifactId || '' });
      apply = (v) => ({ data: { artifactId: v.artifactId } });
      break;
    case 'spell_scroll':
      fields.push({ id: 'spellId', label: 'Spell', type: 'spell', value: d.spellId || '' });
      apply = (v) => ({ data: { spellId: v.spellId } });
      break;
    case 'message':
      fields.push({ id: 'text', label: 'Text', type: 'textarea', value: d.text || '' });
      apply = (v) => ({ data: { text: v.text } });
      break;
    case 'prison':
      fields.push({ id: 'heroDefId', label: 'Prisoner', type: 'hero', value: d.heroDefId || HEROES[0].id });
      apply = (v) => ({ data: { heroDefId: v.heroDefId } });
      break;
    case 'pandoras_box': case 'event':
      fields.push(...payloadFields(d));
      if (fx === 'event') {
        fields.push(
          { id: 'players', label: 'Players', type: 'list', value: (d.players || []).map((s) => s + 1).join(', '), hint: 'player numbers; empty = everybody' },
          { id: 'humanOnly', label: 'Humans only', type: 'check', value: !!d.humanOnly },
          { id: 'aiOnly', label: 'Computers only', type: 'check', value: !!d.aiOnly },
          { id: 'once', label: 'Only once', type: 'check', value: d.once !== false },
        );
      }
      apply = (v) => ({ data: { ...payloadPatch(v), ...(fx === 'event' ? { players: splitList(v.players).length ? splitList(v.players).map((s) => Number(s) - 1) : null, humanOnly: v.humanOnly || null, aiOnly: v.aiOnly || null, once: v.once } : {}) } });
      break;
    case 'seer_hut': case 'quest_guard': {
      fields.push(...questFields(d.quest, bp));
      if (fx === 'seer_hut') fields.push(...payloadFields(d.reward || {}, 'reward_'));
      apply = (v) => ({ data: { quest: questFromValues(v), ...(fx === 'seer_hut' ? { reward: rewardOrNull(payloadPatch(v, 'reward_')) } : {}) } });
      break;
    }
    case 'teleport':
      if (def.effect.kind === 'subterranean_gate') fields.push({ id: 'pair', label: 'Paired with', type: 'info', value: d.pair || 'nothing (place a gate on the other level)' });
      break;
    default: break;
  }
  return { title: def.name, fields, apply: (v) => withOwner(apply(v), v) };
}

export function splitList(s) {
  return String(s || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}
/** Id list from a picker value (array) or typed text; null when empty. */
export function listOf(x) {
  const l = Array.isArray(x) ? x.filter(Boolean) : splitList(x);
  return l.length ? l : null;
}
/** Creature stacks from a picker value or "10 pikeman, 2 angel" text; null when empty. */
export function stacksOf(x) {
  let out = [];
  if (Array.isArray(x)) out = x.filter((s) => s && s.creatureId && s.count > 0).map((s) => ({ creatureId: s.creatureId, count: Number(s.count) }));
  else {
    const w = splitList(x);
    for (let i = 0; i + 1 < w.length; i += 2) if (Number(w[i]) > 0) out.push({ creatureId: w[i + 1], count: Number(w[i]) });
  }
  return out.length ? out : null;
}

function payloadFields(d, prefix = '') {
  const res = d.resources || {};
  return [
    ...(prefix ? [] : [{ id: `${prefix}message`, label: 'Message', type: 'textarea', value: d.message || '' }]),
    { id: `${prefix}exp`, label: 'Experience', type: 'number', value: d.exp || 0, min: -1000000, max: 1000000 },
    { id: `${prefix}mana`, label: 'Mana', type: 'number', value: d.mana || 0, min: -999, max: 999 },
    { id: `${prefix}morale`, label: 'Morale', type: 'number', value: d.morale || 0, min: -3, max: 3 },
    { id: `${prefix}luck`, label: 'Luck', type: 'number', value: d.luck || 0, min: -3, max: 3 },
    ...RESOURCES.map((r) => ({ id: `${prefix}res_${r}`, label: cap(r), type: 'number', value: res[r] || 0, min: -1000000, max: 1000000 })),
    ...PRIMARY_SKILLS.map((p) => ({ id: `${prefix}pri_${p}`, label: cap(p), type: 'number', value: (d.primary || {})[p] || 0, min: -99, max: 99 })),
    { id: `${prefix}artifacts`, label: 'Artifacts', type: 'artifacts', value: (d.artifacts || []).filter((a) => typeof a === 'string') },
    { id: `${prefix}spells`, label: 'Spells', type: 'spells', value: Array.isArray(d.spells) ? d.spells : [] },
    { id: `${prefix}creatures`, label: 'Creatures', type: 'stacks', value: d.creatures || [] },
  ];
}

/** Values -> payload / reward fields (empty ones become null so setProps deletes them). */
export function payloadPatch(v, prefix = '') {
  const num = (k) => Number(v[`${prefix}${k}`]) || 0;
  const res = {};
  for (const r of RESOURCES) if (num(`res_${r}`)) res[r] = num(`res_${r}`);
  const pri = {};
  for (const p of PRIMARY_SKILLS) if (num(`pri_${p}`)) pri[p] = num(`pri_${p}`);
  const out = {
    exp: num('exp') || null, mana: num('mana') || null, morale: num('morale') || null, luck: num('luck') || null,
    resources: Object.keys(res).length ? res : null, primary: Object.keys(pri).length ? pri : null,
    artifacts: listOf(v[`${prefix}artifacts`]),
    spells: listOf(v[`${prefix}spells`]),
    creatures: stacksOf(v[`${prefix}creatures`]),
  };
  if (!prefix) out.message = v.message ? String(v.message) : null;
  return out;
}

function rewardOrNull(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) if (v != null) out[k] = v;
  return Object.keys(out).length ? out : null;
}

export const QUEST_LABELS = {
  reach_level: 'Reach experience level', reach_primary: 'Reach primary skills', kill_monster: 'Defeat a monster',
  bring_artifacts: 'Bring artifacts', bring_creatures: 'Bring creatures', bring_resources: 'Bring resources',
  be_hero: 'Be a certain hero', be_player: 'Be a certain player', kill_hero: 'Defeat a hero',
};

function questFields(q, bp) {
  q = q || {};
  const monsters = Object.values(bp.map.objects).filter((o) => o.defId === 'monster')
    .map((o) => ({ value: o.id, label: `${(CREATURE_BY_ID[o.data.creatureId] || {}).name || o.data.creatureId} x${o.data.count} (${o.pos.x}, ${o.pos.y})` }));
  const starting = bp.heroes.map((h, i) => ({ value: `idx:${i}`, label: `Starting hero ${i + 1}: ${h.defId !== 'random' && HERO_BY_ID[h.defId] ? HERO_BY_ID[h.defId].name : 'random'} (${slotName(h.ownerSlot)})` }));
  return [
    { id: 'q_type', label: 'Quest', type: 'select', value: q.type || '', options: [{ value: '', label: 'None' }, ...Object.entries(QUEST_LABELS).map(([value, label]) => ({ value, label }))] },
    { id: 'q_level', label: 'Level', type: 'number', value: q.level || 10, min: 2, max: 75, when: 'reach_level' },
    ...PRIMARY_SKILLS.map((p) => ({ id: `q_pri_${p}`, label: cap(p), type: 'number', value: (q.stats || {})[p] || 0, min: 0, max: 99, when: 'reach_primary' })),
    { id: 'q_objectId', label: 'Monster', type: 'select', value: q.objectId || (monsters[0] || {}).value || '', options: monsters.length ? monsters : [{ value: '', label: 'Place a monster first' }], when: 'kill_monster' },
    { id: 'q_killHero', label: 'Hero', type: 'select', value: q.heroIndex != null ? `idx:${q.heroIndex}` : 'def', options: [...starting, { value: 'def', label: 'A hero by name (below)' }], when: 'kill_hero' },
    { id: 'q_killHeroDef', label: 'By name', type: 'hero', value: q.heroDefId || HEROES[0].id, when: 'kill_hero' },
    { id: 'q_artifacts', label: 'Artifacts', type: 'artifacts', value: q.artifactIds || [], when: 'bring_artifacts' },
    { id: 'q_creatures', label: 'Creatures', type: 'stacks', value: q.creatures || [], when: 'bring_creatures' },
    ...RESOURCES.map((r) => ({ id: `q_res_${r}`, label: cap(r), type: 'number', value: (q.resources || {})[r] || 0, min: 0, max: 1000000, when: 'bring_resources' })),
    { id: 'q_hero', label: 'Hero', type: 'hero', value: q.heroDefId || HEROES[0].id, when: 'be_hero' },
    { id: 'q_player', label: 'Player', type: 'number', value: (q.playerId ?? 0) + 1, min: 1, max: 8, when: 'be_player' },
  ];
}

/** Inspector values -> concrete quest (null = no quest). */
export function questFromValues(v) {
  const type = v.q_type;
  if (!type) return null;
  switch (type) {
    case 'reach_level': return { type, level: Number(v.q_level) || 2 };
    case 'reach_primary': {
      const stats = {};
      for (const p of PRIMARY_SKILLS) if (Number(v[`q_pri_${p}`]) > 0) stats[p] = Number(v[`q_pri_${p}`]);
      return { type, stats };
    }
    case 'kill_monster': return { type, objectId: String(v.q_objectId || '').trim() };
    case 'kill_hero': {
      const sel = String(v.q_killHero || 'def');
      return sel.startsWith('idx:') ? { type, heroIndex: Number(sel.slice(4)) } : { type, heroDefId: v.q_killHeroDef };
    }
    case 'bring_artifacts': return { type, artifactIds: listOf(v.q_artifacts) || [] };
    case 'bring_creatures': return { type, creatures: stacksOf(v.q_creatures) || [] };
    case 'bring_resources': {
      const resources = {};
      for (const r of RESOURCES) if (Number(v[`q_res_${r}`]) > 0) resources[r] = Number(v[`q_res_${r}`]);
      return { type, resources };
    }
    case 'be_hero': return { type, heroDefId: v.q_hero };
    case 'be_player': return { type, playerId: (Number(v.q_player) || 1) - 1 };
    default: return null;
  }
}

/** Friendly text for editor error codes. */
export function editorErrorText(r) {
  const T = {
    out_of_bounds: 'That does not fit on the map.', occupied: 'Something is already there.', wrong_terrain: 'It cannot stand on that terrain.',
    on_river: 'Objects cannot stand on a river.', unknown_object: 'Unknown object.', no_such_object: 'Nothing selected.', bad_owner: 'That object cannot have this owner.',
    hero_taken: 'That hero already starts somewhere else.', bad_terrain_for_level: 'That terrain does not exist on this level.', nothing_here: 'Nothing to remove here.',
    bad_condition: 'The condition does not fit this map.', slot_needs_human_or_ai: 'A player must be playable by a human or the computer.', same_level: 'Gates must be on different levels.',
  };
  const base = T[r && r.error] || `Not possible (${r && r.error}).`;
  return r && r.problems && r.problems.length ? `${base} ${r.problems.join('; ')}` : base;
}

/** Victory / loss choices for the settings dialog: `{id, label, params: [{id, label, type, options?}]}`. */
export function conditionChoices(bp) {
  const towns = bp.towns.map((t, i) => ({ value: i, label: `${t.name || `${(FACTION_BY_ID[t.faction] || { name: 'Random' }).name} town`} (${t.pos.x}, ${t.pos.y})` }));
  const heroes = bp.heroes.map((h, i) => ({ value: i, label: `${h.defId !== 'random' && HERO_BY_ID[h.defId] ? HERO_BY_ID[h.defId].name : 'Random hero'} (${slotName(h.ownerSlot)})` }));
  const monsters = Object.values(bp.map.objects).filter((o) => o.defId === 'monster').map((o) => ({ value: o.id, label: `${(CREATURE_BY_ID[o.data.creatureId] || {}).name || o.data.creatureId} x${o.data.count} (${o.pos.x}, ${o.pos.y})` }));
  return {
    victory: [
      { id: 'standard', label: 'Defeat all enemies', params: [] },
      { id: 'capture_town', label: 'Capture a town', params: [{ id: 'townIndex', label: 'Town', type: 'select', options: towns }] },
      { id: 'capture_all_towns', label: 'Capture every town', params: [] },
      { id: 'defeat_hero', label: 'Defeat a hero', params: [{ id: 'heroIndex', label: 'Hero', type: 'select', options: heroes }] },
      { id: 'defeat_monster', label: 'Defeat a monster', params: [{ id: 'objectId', label: 'Monster', type: 'select', options: monsters }] },
      { id: 'acquire_artifact', label: 'Acquire an artifact', params: [{ id: 'artifactId', label: 'Artifact id', type: 'text' }] },
      { id: 'accumulate_creatures', label: 'Accumulate creatures', params: [{ id: 'creatureId', label: 'Creature id', type: 'text' }, { id: 'count', label: 'Count', type: 'number' }] },
      { id: 'accumulate_resources', label: 'Accumulate resources', params: [{ id: 'resource', label: 'Resource', type: 'select', options: RESOURCES.map((r) => ({ value: r, label: cap(r) })) }, { id: 'amount', label: 'Amount', type: 'number' }] },
      { id: 'build_grail', label: 'Build a Grail structure', params: [] },
      { id: 'survive', label: 'Survive', params: [{ id: 'days', label: 'Days', type: 'number' }] },
    ],
    loss: [
      { id: 'standard', label: 'Lose all towns and heroes', params: [] },
      { id: 'lose_town', label: 'Lose a town', params: [{ id: 'townIndex', label: 'Town', type: 'select', options: towns }] },
      { id: 'lose_hero', label: 'Lose a hero', params: [{ id: 'heroIndex', label: 'Hero', type: 'select', options: heroes }] },
      { id: 'time_limit', label: 'Time limit', params: [{ id: 'days', label: 'Days', type: 'number' }] },
    ],
  };
}

export { FACTIONS, PLAYER_COLORS };
