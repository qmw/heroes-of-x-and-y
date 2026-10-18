// Encyclopedia model (pure - no DOM): turns the data modules into a searchable, cross-linked
// catalog. The view (encyclopedia.js) renders `entry.blocks()`; the unit test walks every entry.
//
// Entry  = { key: 'creature:pikeman', cat, id, name, sub, icon: {kind, id}, f: {filterId: value|value[]},
//            search: string (lower-case haystack), blocks: () => Block[] }
// Block  = { t: 'text', text } | { t: 'title', text } | { t: 'stats', rows: [[label, value]] }
//        | { t: 'cost', label, cost } | { t: 'links', label, links: [{key, label}] }
//        | { t: 'table', head: [..], rows: [[cell..]] }      cell = string | number | {key, label} | {cost}
//        | { t: 'gallery', items: [{kind, id, label, key?, note?}] }
//        | { t: 'creature', id } | { t: 'tree', columns: [[{key, label, cost, requires: [label]}]] }
import { CREATURES, CREATURE_BY_ID } from '../../data/creatures.js';
import { ABILITIES } from '../../data/abilities.js';
import { HEROES } from '../../data/heroes.js';
import { HERO_CLASSES, HERO_CLASS_BY_ID } from '../../data/heroClasses.js';
import { SKILLS, SKILL_BY_ID } from '../../data/skills.js';
import { SPELLS, SPELL_BY_ID } from '../../data/spells.js';
import { ARTIFACTS, ARTIFACT_BY_ID, combosContaining } from '../../data/artifacts.js';
import { FACTIONS_DATA, FACTION_BY_ID } from '../../data/factions.js';
import { BUILDINGS, BUILDING_BY_ID, buildingsForFaction, successorsOf } from '../../data/buildings.js';
import { TERRAIN_DATA, MAGIC_TERRAINS, ROADS, RIVERS } from '../../data/terrain.js';
import { MAP_OBJECTS } from '../../data/mapObjects.js';
import { PRIMARY_SKILLS } from '../../core/constants.js';

const cap = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const num = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MASTERY = ['None', 'Basic', 'Advanced', 'Expert'];
const LEVELS = ['Basic', 'Advanced', 'Expert'];
const PRIMARY = { attack: 'Attack', defense: 'Defense', power: 'Spell Power', knowledge: 'Knowledge' };

/** Generic one-line rendering of a Bonus / Effect object: "Creature Stat: stat attack, value 2". */
export function effectText(e) {
  if (e == null) return '';
  if (typeof e !== 'object') return String(e);
  const { type, ...rest } = e;
  const params = Object.entries(rest).map(([k, v]) => `${cap(k).toLowerCase()} ${valueText(v)}`).join(', ');
  return `${cap(type || 'effect')}${params ? `: ${params}` : ''}`;
}

function valueText(v, depth = 0) {
  if (v == null) return '-';
  if (Array.isArray(v)) {
    if (v.length > 12) return `${v.slice(0, 12).map((x) => valueText(x, depth + 1)).join(', ')}, ...`;
    return v.map((x) => valueText(x, depth + 1)).join(depth ? '/' : ', ');
  }
  if (typeof v === 'object') {
    if (depth > 2) return '{...}';
    return `(${Object.entries(v).map(([k, x]) => `${cap(k).toLowerCase()} ${valueText(x, depth + 1)}`).join(', ')})`;
  }
  if (typeof v === 'string') return cap(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

export const CATEGORIES = [
  { id: 'creature', name: 'Creatures', icon: { kind: 'creature', id: 'griffin' } },
  { id: 'hero', name: 'Heroes', icon: { kind: 'portrait', id: 'christian' } },
  { id: 'class', name: 'Hero Classes', icon: { kind: 'ui', id: 'class' } },
  { id: 'skill', name: 'Skills', icon: { kind: 'skill', id: 'wisdom' } },
  { id: 'spell', name: 'Spells', icon: { kind: 'spell', id: 'magic_arrow' } },
  { id: 'artifact', name: 'Artifacts', icon: { kind: 'artifact', id: 'spellbook' } },
  { id: 'faction', name: 'Towns', icon: { kind: 'town', id: 'castle' } },
  { id: 'building', name: 'Buildings', icon: { kind: 'building', id: 'capitol' } },
  { id: 'object', name: 'Map Objects', icon: { kind: 'object', id: 'treasure_chest' } },
  { id: 'terrain', name: 'Terrain', icon: { kind: 'terrain', id: 'grass' } },
  { id: 'ability', name: 'Abilities', icon: { kind: 'ui', id: 'ability' } },
];

let cached = null;

/**
 * Build (once) the whole catalog.
 * @returns {{ categories, entries: Entry[], byKey: Map<string, Entry>, byCat: {[cat]: Entry[]},
 *             filters: {[cat]: [{id, label, options: [{value, label}]}]} }}
 */
export function buildEncyclopedia() {
  if (cached) return cached;
  const entries = [];
  const add = (cat, id, name, o) => {
    const e = { key: `${cat}:${id}`, cat, id, name, sub: o.sub || '', icon: o.icon, f: o.f || {}, blocks: o.blocks,
      search: `${name} ${o.sub || ''} ${o.words || ''}`.toLowerCase() };
    entries.push(e);
    return e;
  };
  const L = (cat, id, label) => ({ key: `${cat}:${id}`, label: label ?? nameOf(cat, id) });
  const factionName = (id) => (FACTION_BY_ID[id] ? FACTION_BY_ID[id].name : id === 'common' ? 'Common' : 'Neutral');
  const factionOpts = [...FACTIONS_DATA.map((f) => ({ value: f.id, label: f.name })), { value: 'neutral', label: 'Neutral' }];

  // ---- reverse indexes -------------------------------------------------------------------------
  const dwellingOf = {};            // creatureId -> buildingId
  for (const b of BUILDINGS) if (b.dwelling) dwellingOf[b.dwelling.creatureId] ??= b.id;
  const objectsOfCreature = {};     // creatureId -> [objectId]
  for (const o of MAP_OBJECTS) {
    for (const c of (o.effect && Array.isArray(o.effect.creatures) ? o.effect.creatures : [])) {
      if (typeof c === 'string') (objectsOfCreature[c] ||= []).push(o.id);
    }
  }
  const heroesOfCreature = {};
  const heroesOfSkill = {};
  const heroesOfSpell = {};
  for (const hd of HEROES) {
    const sp = hd.specialty || {};
    for (const c of sp.creatures || Object.keys(sp.upgrades || {})) (heroesOfCreature[c] ||= []).push(hd.id);
    if (sp.skillId) (heroesOfSkill[sp.skillId] ||= []).push(hd.id);
    if (sp.spellId) (heroesOfSpell[sp.spellId] ||= []).push(hd.id);
    for (const s of hd.startSkills || []) if (!(heroesOfSkill[s.id] || []).includes(hd.id)) (heroesOfSkill[s.id] ||= []).push(hd.id);
    if (hd.startSpell && !(heroesOfSpell[hd.startSpell] || []).includes(hd.id)) (heroesOfSpell[hd.startSpell] ||= []).push(hd.id);
  }
  const creaturesOfAbility = {};
  for (const c of CREATURES) for (const a of c.abilities) (creaturesOfAbility[a.id] ||= []).push(c.id);
  const artifactsOfSpell = {};
  for (const a of ARTIFACTS) {
    for (const b of a.bonuses || []) {
      for (const s of [b.spellId, ...(Array.isArray(b.spellIds) ? b.spellIds : [])]) {
        if (s && SPELL_BY_ID[s]) (artifactsOfSpell[s] ||= []).push(a.id);
      }
    }
  }

  // ---- creatures -------------------------------------------------------------------------------
  for (const c of CREATURES) {
    add('creature', c.id, c.name, {
      sub: c.warMachine ? 'War machine' : `${factionName(c.faction)} - tier ${c.tier}${c.upgraded ? '+' : ''}`,
      icon: { kind: 'creature', id: c.id },
      f: { faction: c.faction, tier: c.tier, type: [c.shots > 0 && 'shooter', c.flying && 'flyer', c.size === 2 && 'large', c.upgraded && 'upgraded', c.warMachine && 'war_machine'].filter(Boolean) },
      words: c.abilities.map((a) => ABILITIES[a.id]?.name || a.id).join(' '),
      blocks: () => {
        const chain = [];
        for (let x = c; x; x = x.upgradeOf ? CREATURE_BY_ID[x.upgradeOf] : null) chain.unshift(x.id);
        for (let x = c.upgradesTo ? CREATURE_BY_ID[c.upgradesTo] : null; x; x = x.upgradesTo ? CREATURE_BY_ID[x.upgradesTo] : null) chain.push(x.id);
        return [
          { t: 'creature', id: c.id },
          { t: 'stats', rows: [['Fight value', num(c.fightValue)], ['AI value', num(c.aiValue)], ['Weekly growth', c.growth || '-'], ['Size', c.size === 2 ? 'Two hexes' : 'One hex'], ['Body', cap(c.shape)]] },
          FACTION_BY_ID[c.faction] ? { t: 'links', label: 'Town', links: [L('faction', c.faction)] } : null,
          chain.length > 1 ? { t: 'gallery', label: 'Upgrade line', items: chain.map((id) => ({ kind: 'creature', id, label: CREATURE_BY_ID[id].name, key: `creature:${id}` })) } : null,
          dwellingOf[c.id] ? { t: 'links', label: 'Town dwelling', links: [L('building', dwellingOf[c.id])] } : null,
          objectsOfCreature[c.id] ? { t: 'links', label: 'Found on the map at', links: objectsOfCreature[c.id].map((id) => L('object', id)) } : null,
          c.abilities.length ? { t: 'links', label: 'Abilities', links: c.abilities.map((a) => L('ability', a.id)) } : null,
          heroesOfCreature[c.id] ? { t: 'links', label: 'Hero specialists', links: heroesOfCreature[c.id].map((id) => L('hero', id)) } : null,
        ];
      },
    });
  }

  // ---- heroes ----------------------------------------------------------------------------------
  for (const d of HEROES) {
    const cls = HERO_CLASS_BY_ID[d.classId];
    add('hero', d.id, d.name, {
      sub: `${cls ? cls.name : d.classId} - ${factionName(d.faction)}`,
      icon: { kind: 'portrait', id: d.id },
      f: { faction: d.faction, kind: cls ? cls.kind : 'might', special: d.special ? 'campaign' : 'regular' },
      words: `${d.specialty?.description || ''} ${d.startSkills.map((s) => s.id).join(' ')}`,
      blocks: () => [
        { t: 'stats', rows: [['Class', cls ? cls.name : d.classId], ['Gender', cap(d.gender)], ...(d.special ? [['Availability', 'Campaign / special hero']] : []),
          ...PRIMARY_SKILLS.map((p) => [PRIMARY[p], cls ? cls.startPrimary[p] : '-'])] },
        { t: 'title', text: 'Specialty' },
        { t: 'text', text: d.specialty?.description || '-' },
        { t: 'links', label: 'Class and town', links: [L('class', d.classId), ...(FACTION_BY_ID[d.faction] ? [L('faction', d.faction)] : [])] },
        { t: 'gallery', label: 'Starting skills', items: d.startSkills.map((s) => ({ kind: 'skill', id: s.id, label: `${LEVELS[s.level - 1]} ${SKILL_BY_ID[s.id]?.name || s.id}`, key: `skill:${s.id}` })) },
        d.startSpell ? { t: 'links', label: 'Starting spell', links: [L('spell', d.startSpell)] } : null,
        d.startArmy?.length ? { t: 'gallery', label: 'Starting army', items: d.startArmy.map((a) => ({ kind: 'creature', id: a.creatureId, label: `${a.min}-${a.max} ${CREATURE_BY_ID[a.creatureId]?.name || a.creatureId}`, key: `creature:${a.creatureId}` })) } : null,
        d.startWarMachine ? { t: 'links', label: 'Starting war machine', links: [ARTIFACT_BY_ID[d.startWarMachine] ? L('artifact', d.startWarMachine) : L('creature', d.startWarMachine)] } : null,
        linksFromSpecialty(d.specialty),
        { t: 'title', text: 'Biography' },
        { t: 'text', text: d.biography || '-' },
      ],
    });
  }
  function linksFromSpecialty(sp) {
    if (!sp) return null;
    const links = [];
    for (const c of sp.creatures || []) if (CREATURE_BY_ID[c]) links.push(L('creature', c));
    for (const c of Object.values(sp.upgrades || {})) if (CREATURE_BY_ID[c] && !links.some((l) => l.key === `creature:${c}`)) links.push(L('creature', c));
    if (sp.skillId && SKILL_BY_ID[sp.skillId]) links.push(L('skill', sp.skillId));
    if (sp.spellId && SPELL_BY_ID[sp.spellId]) links.push(L('spell', sp.spellId));
    if (sp.machineId && CREATURE_BY_ID[sp.machineId]) links.push(L('creature', sp.machineId));
    return links.length ? { t: 'links', label: 'Specialty relates to', links } : null;
  }

  // ---- hero classes ----------------------------------------------------------------------------
  for (const c of HERO_CLASSES) {
    const members = HEROES.filter((x) => x.classId === c.id);
    add('class', c.id, c.name, {
      sub: `${cap(c.kind)} - ${factionName(c.faction)}`,
      icon: members[0] ? { kind: 'hero', id: members[0].id } : { kind: 'ui', id: 'class' },
      f: { faction: c.faction, kind: c.kind },
      blocks: () => {
        const weights = Object.entries(c.skillWeights || {}).sort((a, b) => b[1] - a[1]);
        const total = weights.reduce((s, [, w]) => s + w, 0) || 1;
        return [
          { t: 'stats', rows: [['Type', cap(c.kind)], ['Heroes', members.length]] },
          FACTION_BY_ID[c.faction] ? { t: 'links', label: 'Town', links: [L('faction', c.faction)] } : null,
          { t: 'title', text: 'Primary skills' },
          { t: 'table', head: ['Skill', 'Start', 'Levels 2-9', 'Level 10+'],
            rows: PRIMARY_SKILLS.map((p) => [PRIMARY[p], c.startPrimary[p], `${c.primaryChancesLow[p]}%`, `${c.primaryChancesHigh[p]}%`]) },
          { t: 'title', text: 'Secondary skill chances' },
          { t: 'table', head: ['Skill', 'Weight', 'Share'],
            rows: weights.map(([id, w]) => [SKILL_BY_ID[id] ? L('skill', id) : cap(id), w, w ? `${(w * 100 / total).toFixed(1)}%` : 'never']) },
          { t: 'gallery', label: 'Heroes of this class', items: members.map((m) => ({ kind: 'portrait', id: m.id, label: m.name, key: `hero:${m.id}` })) },
        ];
      },
    });
  }

  // ---- secondary skills ------------------------------------------------------------------------
  for (const s of SKILLS) {
    add('skill', s.id, s.name, {
      sub: s.description,
      icon: { kind: 'skill', id: s.id },
      f: { group: /_magic$|wisdom|sorcery|intelligence|mysticism|scholar|eagle_eye/.test(s.id) ? 'magic' : /offense|armorer|archery|tactics|artillery|ballistics|first_aid|leadership|luck|resistance|interference/.test(s.id) ? 'combat' : 'adventure' },
      blocks: () => {
        const top = HERO_CLASSES.map((c) => [c, c.skillWeights?.[s.id] || 0]).sort((a, b) => b[1] - a[1]);
        const never = top.filter(([, w]) => w === 0).map(([c]) => c);
        return [
          { t: 'text', text: s.description },
          { t: 'table', head: ['Level', 'Effect'], rows: s.levels.map((lv, i) => [LEVELS[i], lv.description]) },
          { t: 'table', head: ['Level', 'Bonuses (engine data)'], rows: s.levels.map((lv, i) => [LEVELS[i], (lv.effects || []).map(effectText).join('; ') || '-']) },
          { t: 'links', label: 'Most likely for', links: top.slice(0, 6).filter(([, w]) => w > 0).map(([c, w]) => L('class', c.id, `${c.name} (${w})`)) },
          never.length ? { t: 'links', label: 'Never offered to', links: never.map((c) => L('class', c.id)) } : null,
          heroesOfSkill[s.id] ? { t: 'gallery', label: 'Heroes starting with or specialising in it', items: heroesOfSkill[s.id].map((id) => ({ kind: 'portrait', id, label: nameOf('hero', id), key: `hero:${id}` })) } : null,
        ];
      },
    });
  }

  // ---- spells ----------------------------------------------------------------------------------
  for (const s of SPELLS) {
    add('spell', s.id, s.name, {
      sub: `${cap(s.school === 'all' ? 'all schools' : s.school)} - level ${s.level}${s.creatureOnly ? ' - creature ability' : ''}`,
      icon: { kind: 'spell', id: s.id },
      f: { school: s.school, level: s.level, kind: s.creatureOnly ? 'creature' : s.kind, category: s.category },
      words: `${s.category} ${(s.description || [])[0] || ''}`,
      blocks: () => [
        { t: 'stats', rows: [['School', cap(s.school === 'all' ? 'All schools' : s.school)], ['Level', s.level], ['Used', s.creatureOnly ? 'Creature ability only' : s.kind === 'adventure' ? 'Adventure map' : 'Combat'],
          ['Category', cap(s.category)], ['Target', cap(s.target)], ['Duration', s.duration == null ? 'Instant' : s.duration === 'power' ? '1 round per Spell Power' : typeof s.duration === 'number' ? `${s.duration} round(s)` : cap(s.duration)],
          ['Alignment', cap(s.alignment || 'neutral')], ['Mage guild', s.guild === false ? 'Not offered' : 'Yes'],
          ...(s.massAt != null ? [['Mass effect', `at ${MASTERY[s.massAt]} mastery`]] : []),
          ...(s.immune?.length ? [['Immune', s.immune.map(cap).join(', ')]] : []),
          ...(s.vulnerable?.length ? [['Vulnerable', s.vulnerable.map((v) => (typeof v === 'string' ? cap(v) : valueText(v))).join(', ')]] : [])] },
        { t: 'title', text: 'By school mastery' },
        { t: 'table', head: ['Mastery', 'Mana', 'Base value', 'Effect'],
          rows: MASTERY.map((m, i) => [m, (s.costByMastery || [])[i] ?? s.cost,
            `${(s.power || [])[i] ?? '-'}${s.perPower ? ` + ${s.perPower} x Power` : ''}`, (s.description || [])[i] || '']) },
        s.effect ? { t: 'text', text: `Engine effect - ${effectText(s.effect)}` } : null,
        s.area ? { t: 'text', text: `Area - ${areaText(s.area)}` } : null,
        heroesOfSpell[s.id] ? { t: 'gallery', label: 'Heroes starting with or specialising in it', items: heroesOfSpell[s.id].map((id) => ({ kind: 'portrait', id, label: nameOf('hero', id), key: `hero:${id}` })) } : null,
        artifactsOfSpell[s.id] ? { t: 'links', label: 'Artifacts', links: artifactsOfSpell[s.id].map((id) => L('artifact', id)) } : null,
      ],
    });
  }

  // ---- artifacts -------------------------------------------------------------------------------
  for (const a of ARTIFACTS) {
    add('artifact', a.id, a.name, {
      sub: `${cap(a.class)} - ${cap(a.slot)}`,
      icon: { kind: 'artifact', id: a.id },
      f: { class: a.class, slot: a.slot },
      words: a.description || '',
      blocks: () => {
        const combos = combosContaining(a.id);
        return [
          { t: 'stats', rows: [['Class', cap(a.class)], ['Slot', cap(a.slot)], ['Value', `${num(a.cost)} gold`], ...(a.origin ? [['Origin', String(a.origin).toUpperCase()]] : [])] },
          { t: 'text', text: a.description || '' },
          a.bonuses?.length ? { t: 'table', head: ['Bonuses (engine data)'], rows: a.bonuses.map((b) => [effectText(b)]) } : null,
          a.components ? { t: 'gallery', label: 'Assembled from', items: a.components.map((id) => ({ kind: 'artifact', id, label: ARTIFACT_BY_ID[id]?.name || id, key: `artifact:${id}` })) } : null,
          combos.length ? { t: 'links', label: 'Part of', links: combos.map((c) => L('artifact', typeof c === 'string' ? c : c.id)) } : null,
        ];
      },
    });
  }

  // ---- factions --------------------------------------------------------------------------------
  for (const f of FACTIONS_DATA) {
    add('faction', f.id, f.name, {
      sub: `${cap(f.alignment)} - native ${cap(f.nativeTerrain)}`,
      icon: { kind: 'town', id: f.id },
      f: { alignment: f.alignment },
      words: f.townNames.join(' '),
      blocks: () => {
        const blds = buildingsForFaction(f.id);
        return [
          { t: 'stats', rows: [['Alignment', cap(f.alignment)], ['Mage guild', `up to level ${f.mageGuildMax}`], ['Shipyard', f.hasShipyard ? 'Yes' : 'No'],
            ['War machines', (f.warMachines || []).map(cap).join(', ') || '-'], ['Resource silo', (f.siloResources || []).map(cap).join(', ') || '-'],
            ...(f.siege?.moat ? [['Moat', `${f.siege.moat.name} (${f.siege.moat.damage} damage)`]] : [])] },
          { t: 'links', label: 'Native terrain', links: [L('terrain', f.nativeTerrain)] },
          { t: 'links', label: 'Hero classes', links: f.heroClasses.map((id) => L('class', id)) },
          ...f.creatures.map((pair, i) => ({ t: 'gallery', label: i === 0 ? 'Creatures (base / upgraded)' : '', compact: true,
            items: pair.filter(Boolean).map((id) => ({ kind: 'creature', id, label: CREATURE_BY_ID[id]?.name || id, key: `creature:${id}`, note: `Tier ${i + 1}` })) })),
          f.altCreatures?.length ? { t: 'links', label: 'Alternative creatures', links: f.altCreatures.flat().filter((id) => CREATURE_BY_ID[id]).map((id) => L('creature', id)) } : null,
          f.rules?.length ? { t: 'table', head: ['Special rules'], rows: f.rules.map((r) => [r.description]) } : null,
          { t: 'title', text: 'Build tree' },
          { t: 'tree', columns: buildTree(blds) },
          { t: 'gallery', label: 'Heroes', items: HEROES.filter((x) => x.faction === f.id).map((m) => ({ kind: 'portrait', id: m.id, label: m.name, key: `hero:${m.id}` })) },
          { t: 'text', text: `Town names: ${f.townNames.join(', ')}.` },
        ];
      },
    });
  }

  // ---- buildings -------------------------------------------------------------------------------
  for (const b of BUILDINGS) {
    add('building', b.id, b.name, {
      sub: `${factionName(b.faction)} - ${cap(b.kind)}`,
      icon: { kind: 'building', id: b.id },
      f: { faction: b.faction, kind: b.kind },
      words: b.description || '',
      blocks: () => {
        const next = successorsOf(b.id).map((x) => (typeof x === 'string' ? x : x.id)).filter((id) => BUILDING_BY_ID[id]);
        return [
          { t: 'stats', rows: [['Town', factionName(b.faction)], ['Type', cap(b.kind)], ...(b.startsBuilt ? [['Starts built', 'Yes']] : []),
            ...(b.requiresWater ? [['Needs', 'A coastal town']] : []), ...(b.requiresGrail ? [['Needs', 'The Grail']] : [])] },
          { t: 'text', text: b.description || '' },
          { t: 'cost', label: 'Cost', cost: b.cost },
          b.requires?.length ? { t: 'links', label: 'Requires', links: b.requires.filter((id) => BUILDING_BY_ID[id]).map((id) => L('building', id)) } : null,
          b.replaces && BUILDING_BY_ID[b.replaces] ? { t: 'links', label: 'Upgrade of', links: [L('building', b.replaces)] } : null,
          next.length ? { t: 'links', label: 'Unlocks', links: next.map((id) => L('building', id)) } : null,
          b.dwelling && CREATURE_BY_ID[b.dwelling.creatureId] ? { t: 'gallery', label: 'Recruits', items: [{ kind: 'creature', id: b.dwelling.creatureId, label: CREATURE_BY_ID[b.dwelling.creatureId].name, key: `creature:${b.dwelling.creatureId}` }] } : null,
          FACTION_BY_ID[b.faction] ? { t: 'links', label: 'Town', links: [L('faction', b.faction)] } : null,
          b.effects?.length ? { t: 'table', head: ['Effects (engine data)'], rows: b.effects.map((e) => [effectText(e)]) } : null,
        ];
      },
    });
  }

  // ---- map objects -----------------------------------------------------------------------------
  for (const o of MAP_OBJECTS) {
    add('object', o.id, o.name, {
      sub: cap(o.category),
      icon: { kind: 'object', id: o.id },
      f: { category: o.category, extra: o.extra ? 'extra' : 'classic' },
      words: `${o.description || ''} ${o.effect?.type || ''}`,
      blocks: () => {
        const creatures = [...new Set(collectIds(o.effect, CREATURE_BY_ID, ['creatureId', 'creatures']))];
        return [
          { t: 'text', text: o.description || '' },
          { t: 'stats', rows: [['Category', cap(o.category)], ['Size', `${o.size[0]} x ${o.size[1]}`], ['Visit', cap(o.interact || (o.visitable ? 'enter' : 'none'))],
            ['Revisit', cap(o.revisit || '-')], ['Blocks movement', o.blocking ? 'Yes' : 'No'], ['Disappears', o.removable ? 'Yes' : 'No'],
            ['Value', num(o.value || 0)], ['Frequency', o.frequency ?? '-'],
            ['Terrain', !o.terrains || o.terrains.length >= 10 ? 'Any land' : o.terrains.map(cap).join(', ')]] },
          creatures.length ? { t: 'gallery', label: 'Creatures', items: creatures.map((id) => ({ kind: 'creature', id, label: CREATURE_BY_ID[id].name, key: `creature:${id}` })) } : null,
          o.effect?.faction && FACTION_BY_ID[o.effect.faction] ? { t: 'links', label: 'Town', links: [L('faction', o.effect.faction)] } : null,
          { t: 'text', text: `Engine effect - ${effectText(o.effect)}` },
        ];
      },
    });
  }

  // ---- terrain (land, magic overlays, roads, rivers) -------------------------------------------
  for (const t of TERRAIN_DATA) {
    add('terrain', t.id, t.name, {
      sub: t.water ? 'Water' : t.passable ? `Move cost ${t.moveCost}` : 'Impassable',
      icon: { kind: 'terrain', id: t.id },
      f: { type: 'terrain' },
      blocks: () => [
        { t: 'text', text: t.description || '' },
        { t: 'stats', rows: [['Move cost', t.passable ? `${t.moveCost} (100 = one tile)` : 'Impassable'], ['Surface', t.surface ? 'Yes' : 'No'], ['Underground', t.underground ? 'Yes' : 'No'],
          ['Can dig', t.diggable ? 'Yes' : 'No'], ['Battlefield', cap(t.battlefield || '-')]] },
        t.nativeFactions?.length ? { t: 'links', label: 'Native to', links: t.nativeFactions.filter((id) => FACTION_BY_ID[id]).map((id) => L('faction', id)) } : null,
        t.obstacles?.length ? { t: 'text', text: `Battlefield obstacles: ${t.obstacles.map(cap).join(', ')}.` } : null,
      ],
    });
  }
  for (const m of MAGIC_TERRAINS) {
    add('terrain', m.id, m.name, {
      sub: 'Magic terrain', icon: { kind: 'terrain', id: m.id }, f: { type: 'magic' }, words: m.description || '',
      blocks: () => [
        { t: 'text', text: m.description || '' },
        { t: 'links', label: 'Appears on', links: (m.terrains || []).filter((id) => TERRAIN_DATA.some((x) => x.id === id)).map((id) => L('terrain', id)) },
        m.effects?.length ? { t: 'table', head: ['Effects (engine data)'], rows: m.effects.map((e) => [effectText(e)]) } : null,
      ],
    });
  }
  for (const r of ROADS) {
    add('terrain', r.id, r.name, { sub: 'Road', icon: { kind: 'terrain', id: r.id }, f: { type: 'road' },
      blocks: () => [{ t: 'stats', rows: [['Move cost', `${r.moveCost} per tile (ignores the terrain under it)`]] }] });
  }
  for (const r of RIVERS) {
    add('terrain', r.id, r.name, { sub: 'River', icon: { kind: 'terrain', id: r.id }, f: { type: 'river' },
      blocks: () => [{ t: 'text', text: 'Decorative: rivers do not change movement.' },
        r.terrains?.length ? { t: 'links', label: 'Flows through', links: r.terrains.filter((id) => TERRAIN_DATA.some((x) => x.id === id)).map((id) => L('terrain', id)) } : null] });
  }

  // ---- creature abilities ----------------------------------------------------------------------
  for (const [id, a] of Object.entries(ABILITIES)) {
    add('ability', id, a.name, {
      sub: cap(a.kind), icon: { kind: 'ui', id: `ability_${a.kind}` }, f: { kind: a.kind }, words: a.description,
      blocks: () => [
        { t: 'text', text: a.description },
        a.params?.length ? { t: 'text', text: `Parameters: ${a.params.join(', ')}.` } : null,
        creaturesOfAbility[id]
          ? { t: 'gallery', label: 'Creatures', items: creaturesOfAbility[id].map((cid) => ({ kind: 'creature', id: cid, label: CREATURE_BY_ID[cid].name, key: `creature:${cid}` })) }
          : { t: 'text', text: 'No creature currently has this ability.' },
      ],
    });
  }

  // ---- finish ----------------------------------------------------------------------------------
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const byCat = {};
  for (const e of entries) (byCat[e.cat] ||= []).push(e);
  for (const e of entries) {
    const make = e.blocks;
    e.blocks = () => make().flat().filter(Boolean);
  }
  function nameOf(cat, id) {
    const e = byKeyLazy(`${cat}:${id}`);
    return e ? e.name : cap(id);
  }
  function byKeyLazy(key) { return byKey.get(key); }

  const uniq = (cat, field) => [...new Set(byCat[cat].flatMap((e) => e.f[field] ?? []))];
  const opts = (values, label = cap) => values.map((v) => ({ value: v, label: label(v) }));
  const filters = {
    creature: [{ id: 'faction', label: 'Town', options: factionOpts },
      { id: 'tier', label: 'Tier', options: uniq('creature', 'tier').sort((a, b) => a - b).map((t) => ({ value: t, label: t === 0 ? 'War machines' : t === 8 ? 'Tier 8+' : `Tier ${t}` })) },
      { id: 'type', label: 'Type', options: opts(['shooter', 'flyer', 'large', 'upgraded', 'war_machine']) }],
    hero: [{ id: 'faction', label: 'Town', options: factionOpts.filter((o) => o.value !== 'neutral') }, { id: 'kind', label: 'Type', options: opts(['might', 'magic']) },
      { id: 'special', label: 'Availability', options: opts(['regular', 'campaign']) }],
    class: [{ id: 'faction', label: 'Town', options: factionOpts.filter((o) => o.value !== 'neutral') }, { id: 'kind', label: 'Type', options: opts(['might', 'magic']) }],
    skill: [{ id: 'group', label: 'Group', options: opts(['combat', 'magic', 'adventure']) }],
    spell: [{ id: 'school', label: 'School', options: opts(uniq('spell', 'school')) }, { id: 'level', label: 'Level', options: uniq('spell', 'level').sort().map((l) => ({ value: l, label: `Level ${l}` })) },
      { id: 'kind', label: 'Used', options: opts(uniq('spell', 'kind')) }, { id: 'category', label: 'Category', options: opts(uniq('spell', 'category')) }],
    artifact: [{ id: 'class', label: 'Class', options: opts(uniq('artifact', 'class')) }, { id: 'slot', label: 'Slot', options: opts(uniq('artifact', 'slot')) }],
    faction: [{ id: 'alignment', label: 'Alignment', options: opts(uniq('faction', 'alignment')) }],
    building: [{ id: 'faction', label: 'Town', options: [{ value: 'common', label: 'Common' }, ...factionOpts.filter((o) => o.value !== 'neutral')] }, { id: 'kind', label: 'Type', options: opts(uniq('building', 'kind')) }],
    object: [{ id: 'category', label: 'Category', options: opts(uniq('object', 'category')) }, { id: 'extra', label: 'Set', options: opts(['classic', 'extra']) }],
    terrain: [{ id: 'type', label: 'Kind', options: opts(['terrain', 'magic', 'road', 'river']) }],
    ability: [{ id: 'kind', label: 'Kind', options: opts(uniq('ability', 'kind')) }],
  };

  cached = { categories: CATEGORIES, entries, byKey, byCat, filters };
  return cached;
}

function areaText(area) {
  const { shape, ...rest } = area;
  return effectText({ type: shape, ...rest });
}

/** Walk an effect object collecting ids that exist in `lookup` under the given field names. */
function collectIds(node, lookup, fields, out = [], depth = 0) {
  if (node == null || depth > 6) return out;
  if (Array.isArray(node)) { for (const x of node) collectIds(x, lookup, fields, out, depth + 1); return out; }
  if (typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if (fields.includes(k)) {
      for (const id of [].concat(v)) if (typeof id === 'string' && lookup[id]) out.push(id);
    }
    if (v && typeof v === 'object') collectIds(v, lookup, fields, out, depth + 1);
  }
  return out;
}

/**
 * Lay a faction's buildings out in columns by prerequisite depth (pure).
 * @returns {Array<Array<{key, label, cost, requires: string[], kind}>>}
 */
export function buildTree(buildings) {
  const ids = new Set(buildings.map((b) => b.id));
  const depth = {};
  const depthOf = (b, seen = new Set()) => {
    if (depth[b.id] != null) return depth[b.id];
    if (seen.has(b.id)) return 0;
    seen.add(b.id);
    const parents = [...(b.requires || []), ...(b.replaces ? [b.replaces] : [])].filter((id) => ids.has(id));
    const d = parents.length ? 1 + Math.max(...parents.map((id) => depthOf(BUILDING_BY_ID[id], seen))) : 0;
    depth[b.id] = d;
    return d;
  };
  const columns = [];
  for (const b of buildings) {
    const d = depthOf(b);
    (columns[d] ||= []).push({ key: `building:${b.id}`, label: b.name, cost: b.cost, kind: b.kind,
      requires: [...(b.requires || [])].map((id) => BUILDING_BY_ID[id]?.name || id) });
  }
  return Array.from(columns, (c) => c || []);
}

/**
 * Filter the catalog (pure).
 * @param {object} enc  result of buildEncyclopedia()
 * @param {{ cat: string, search?: string, filters?: {[filterId]: any} }} q  (filter value '' / null / undefined = any)
 */
export function filterEntries(enc, { cat, search = '', filters = {} } = {}) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const active = Object.entries(filters).filter(([, v]) => v !== '' && v != null);
  const pool = cat ? enc.byCat[cat] || [] : enc.entries;
  return pool.filter((e) => {
    for (const [fid, want] of active) {
      const have = e.f[fid];
      if (Array.isArray(have) ? !have.includes(want) : have !== want) return false;
    }
    for (const w of words) if (!e.search.includes(w)) return false;
    return true;
  });
}

/** Search across all categories; name matches first. */
export function searchAll(enc, text, limit = 60) {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const hits = filterEntries(enc, { search: q });
  hits.sort((a, b) => rank(a, q) - rank(b, q) || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}
function rank(e, q) {
  const n = e.name.toLowerCase();
  return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3;
}
