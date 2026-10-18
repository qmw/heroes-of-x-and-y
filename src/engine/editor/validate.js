// Map editor validation: mapgen validateBlueprint + editor warnings, every message with a position
// when one can be found (docs/mechanics/editor.md §4).
import { MAP_OBJECT_BY_ID } from '../../data/mapObjects.js';
import { HERO_BY_ID } from '../../data/heroes.js';
import { validateBlueprint } from '../mapgen/validate.js';
import { victoryProblems, lossProblems } from './blueprint.js';
import { questProblems } from './data.js';

const posOf = (p) => (p ? { x: p.x, y: p.y, z: p.z || 0 } : null);

/** Position named by a validator message (object id, town / hero index, tile coordinates). */
export function positionOfMessage(bp, text) {
  let m = /\bobject (o\d+|[\w-]+)\b/.exec(text) || /\bgate (\S+?)[: ]/.exec(text) || /\bmonster (\S+?):/.exec(text);
  if (m && bp.map.objects[m[1]]) return posOf(bp.map.objects[m[1]].pos);
  m = /^(\S+?)\(/.exec(text);
  if (m && bp.map.objects[m[1]]) return posOf(bp.map.objects[m[1]].pos);
  m = /\btown(?: |)(\d+)\b/.exec(text);
  if (m && bp.towns[Number(m[1])]) return posOf(bp.towns[Number(m[1])].pos);
  m = /\bhero (\d+)\b/.exec(text);
  if (m && bp.heroes[Number(m[1])]) return posOf(bp.heroes[Number(m[1])].pos);
  m = /(?:tile|at) (\d+),(\d+),(\d+)/.exec(text);
  if (m) return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
  m = /player (\d+) cannot reach/.exec(text);
  if (m) {
    const slot = Number(m[1]);
    const h = bp.heroes.find((x) => x.ownerSlot === slot) || bp.towns.find((x) => x.ownerSlot === slot);
    if (h) return posOf(h.pos);
  }
  return null;
}

/** Editor-only warnings. */
export function editorWarnings(bp) {
  const out = [];
  const w = (text, pos = null) => out.push({ text, pos: posOf(pos) });
  if (!bp.meta.name || !String(bp.meta.name).trim()) w('The map has no name.');
  for (let s = 0; s < (bp.meta.playerSlots || 0); s++) {
    if (!bp.towns.some((t) => t.ownerSlot === s)) {
      const h = bp.heroes.find((x) => x.ownerSlot === s);
      w(`Player ${s + 1} has no town (eliminated after 7 days without one).`, h && h.pos);
    }
  }
  const objs = Object.values(bp.map.objects);
  const byDef = {};
  for (const o of objs) (byDef[o.defId] ??= []).push(o);
  for (const o of objs) {
    const def = MAP_OBJECT_BY_ID[o.defId];
    if (!def) continue;
    const fx = def.effect;
    if (fx.type === 'teleport' && fx.kind === 'two_way' && byDef[o.defId].length < 2) w(`${def.name} has no partner of its colour.`, o.pos);
    if (fx.type === 'teleport' && (fx.kind === 'one_way_entrance' || fx.kind === 'one_way_exit')) {
      const want = fx.kind === 'one_way_entrance' ? 'one_way_exit' : 'one_way_entrance';
      const has = objs.some((x) => { const d = MAP_OBJECT_BY_ID[x.defId]; return d && d.effect.type === 'teleport' && d.effect.kind === want && d.effect.channel === fx.channel; });
      if (!has) w(`${def.name} has no ${want === 'one_way_exit' ? 'exit' : 'entrance'} of its colour.`, o.pos);
    }
    if (fx.type === 'teleport' && fx.kind === 'whirlpool' && byDef[o.defId].length < 2) w('A single whirlpool leads nowhere.', o.pos);
    if (fx.type === 'seer_hut' || fx.type === 'quest_guard') {
      const d = o.data || {};
      if (!d.quest) w(`${def.name} has no quest.`, o.pos);
      else for (const p of questProblems(bp, d.quest)) w(`${def.name}: ${p}.`, o.pos);
      if (fx.type === 'seer_hut' && (!d.reward || !Object.keys(d.reward).length)) w(`${def.name} has no reward.`, o.pos);
    }
    if (def.category !== 'decor' && def.effect.type !== 'event' && def.effect.type !== 'grail' && def.terrains.length) {
      const t = bp.map.tiles[o.pos.z || 0]?.[o.pos.y]?.[o.pos.x];
      if (t && !def.terrains.includes(t.t)) w(`${def.name} is not usually found on ${t.t}.`, o.pos);
    }
  }
  const seen = new Map();
  bp.heroes.forEach((h, i) => {
    if (h.defId !== 'random') {
      if (seen.has(h.defId)) w(`${(HERO_BY_ID[h.defId] || {}).name || h.defId} starts twice.`, h.pos);
      seen.set(h.defId, i);
    }
    const town = bp.towns.find((t) => t.pos.x === h.pos.x && t.pos.y === h.pos.y && (t.pos.z || 0) === (h.pos.z || 0));
    if (town && town.ownerSlot !== h.ownerSlot) w(`Hero ${i + 1} stands in a town of another player.`, h.pos);
  });
  for (const p of victoryProblems(bp, bp.victory)) w(`Victory condition: ${p}.`);
  const v = bp.victory;
  if (v && v.type === 'capture_town' && bp.towns[v.townIndex] && bp.towns[v.townIndex].ownerSlot != null) {
    w(`Victory condition: the town to capture already belongs to player ${bp.towns[v.townIndex].ownerSlot + 1}, who wins at once.`, bp.towns[v.townIndex].pos);
  }
  for (const p of lossProblems(bp, bp.loss)) w(`Loss condition: ${p}.`);
  return out;
}

/**
 * Full validation for the editor.
 * @returns {{ok: boolean, errors: {text, pos}[], warnings: {text, pos}[], stats: object}}
 */
export function validateMap(bp) {
  let res;
  try { res = validateBlueprint(bp); } catch (err) { res = { ok: false, errors: [`validation crashed: ${err.message}`], warnings: [], stats: {} }; }
  const errors = res.errors.map((text) => ({ text, pos: positionOfMessage(bp, text) }));
  const warnings = [...res.warnings.map((text) => ({ text, pos: positionOfMessage(bp, text) })), ...editorWarnings(bp)];
  return { ok: errors.length === 0, errors, warnings, stats: res.stats || {} };
}
