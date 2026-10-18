// Blueprint extras applied by createGame (map editor maps, docs/mechanics/editor.md §6 "Game hand-off"):
//  - slot -> player remapping of map-object owners, boats, event filters and be_player quests
//    (owners in a blueprint are player SLOTS; unplayed slots become neutral),
//  - kill_hero quests referring to a starting hero (`heroIndex` / `heroDefId`) -> runtime hero id,
//  - starting-hero customisation (army, skills, primary stats, spells, artifacts),
//  - map-wide timed events (`blueprint.events`) stored in `state.timedEvents`, fired at day start.
// Pure engine code: no DOM. Called through one hook in game.js createGame / startNewDay.
import { RESOURCES } from '../core/constants.js';
import { CREATURE_BY_ID } from '../data/creatures.js';
import { ARTIFACT_BY_ID } from '../data/artifacts.js';
import { SPELL_BY_ID } from '../data/spells.js';
import { SKILL_BY_ID } from '../data/skills.js';
import { armyAdd } from './army.js';
import { giveArtifact, hasArtifact } from './artifacts.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const mapSlot = (slotToPlayer, s) => (s == null ? null : slotToPlayer[s] ?? null);

/** Map-object owners and other slot references -> player ids. */
export function remapOwners(state, slotToPlayer) {
  for (const obj of Object.values(state.map.objects || {})) {
    if (obj.data && obj.data.townId) continue; // town objects are created by createGame with player ids
    if (obj.owner != null) obj.owner = mapSlot(slotToPlayer, obj.owner);
    const d = obj.data || {};
    if (obj.defId === 'boat' && d.owner != null) d.owner = mapSlot(slotToPlayer, d.owner);
    if (Array.isArray(d.players)) d.players = d.players.map((s) => mapSlot(slotToPlayer, s)).filter((p) => p != null);
    if (d.quest && d.quest.type === 'be_player') d.quest.playerId = mapSlot(slotToPlayer, d.quest.playerId) ?? -1;
  }
}

/** kill_hero quests with `heroIndex` (blueprint hero) or `heroDefId` -> `heroId` of the game hero. */
export function resolveHeroQuests(state, heroIds) {
  for (const obj of Object.values(state.map.objects || {})) {
    const q = obj.data && obj.data.quest;
    if (!q || q.type !== 'kill_hero' || q.heroId) continue;
    let id = null;
    if (q.heroIndex != null) id = heroIds[q.heroIndex] || null;
    if (!id && q.heroDefId) id = (Object.values(state.heroes).find((h) => h.defId === q.heroDefId) || {}).id || null;
    q.heroId = id || `missing_${q.heroIndex ?? q.heroDefId}`;
  }
}

/** Starting-hero extras of a blueprint hero entry. */
export function customizeHero(hero, bh) {
  if (!hero || !bh) return;
  if (Array.isArray(bh.army) && bh.army.some((s) => s && CREATURE_BY_ID[s.creatureId] && s.count > 0)) {
    const army = [null, null, null, null, null, null, null];
    for (const s of bh.army) if (s && CREATURE_BY_ID[s.creatureId] && s.count > 0) armyAdd(army, s.creatureId, s.count);
    hero.army = army;
  }
  if (bh.primary) for (const [k, v] of Object.entries(bh.primary)) if (k in hero.primary && Number.isFinite(v)) hero.primary[k] = Math.max(k === 'knowledge' || k === 'power' ? 1 : 0, v);
  if (Array.isArray(bh.skills)) {
    hero.skills = bh.skills.filter((s) => s && SKILL_BY_ID[s.id] && s.level >= 1 && s.level <= 3).slice(0, 8).map((s) => ({ id: s.id, level: s.level }));
  }
  const spells = (bh.spells || []).filter((id) => SPELL_BY_ID[id]);
  if (spells.length) {
    if (!hasArtifact(hero, 'spellbook')) giveArtifact(hero, 'spellbook');
    hero.spells = [...new Set([...(hero.spells || []), ...spells])];
  }
  for (const a of bh.artifacts || []) if (ARTIFACT_BY_ID[a] && !ARTIFACT_BY_ID[a].instanced) giveArtifact(hero, a);
  if (bh.primary && bh.primary.knowledge != null) hero.mana = Math.max(hero.mana || 0, hero.primary.knowledge * 10);
}

/** Store the blueprint's timed events with player ids. */
export function setupTimedEvents(state, blueprint, slotToPlayer) {
  state.timedEvents = (blueprint.events || []).map((e, i) => ({
    ...clone(e), id: e.id || `te${i + 1}`,
    players: Array.isArray(e.players) && e.players.length ? e.players.map((s) => mapSlot(slotToPlayer, s)).filter((p) => p != null) : null,
  }));
}

/** Does the event fire on `day`? `day` = first day, `repeat` = every n days after (0 = once). */
export function timedEventDue(e, day) {
  if (!(day >= (e.day || 1))) return false;
  const every = e.repeat || 0;
  return every > 0 ? (day - (e.day || 1)) % every === 0 : day === (e.day || 1);
}

/**
 * Fire the timed events due today for every matching living player: resources (may be negative,
 * never below 0), creatures (first hero with room, else the first town's garrison), message.
 * Events: `timed_event {playerId, eventId, name, message, resources, creatures}`.
 */
export function applyTimedEvents(state) {
  const events = [];
  for (const e of state.timedEvents || []) {
    if (!timedEventDue(e, state.turn)) continue;
    for (const player of state.players) {
      if (!player.alive) continue;
      if (e.players && !e.players.includes(player.id)) continue;
      if (e.humanOnly && !player.isHuman) continue;
      if (e.aiOnly && player.isHuman) continue;
      const res = {};
      for (const r of RESOURCES) {
        const v = (e.resources || {})[r];
        if (!v) continue;
        const before = player.resources[r] || 0;
        player.resources[r] = Math.max(0, before + v);
        res[r] = player.resources[r] - before;
      }
      const given = [];
      for (const c of e.creatures || []) {
        if (!CREATURE_BY_ID[c.creatureId] || !(c.count > 0)) continue;
        const hero = player.heroes.map((id) => state.heroes[id]).find((h) => h && armyAdd(h.army, c.creatureId, c.count));
        if (hero) { given.push({ ...c, heroId: hero.id }); continue; }
        const town = player.towns.map((id) => state.towns[id]).find((t) => t && armyAdd(t.garrison, c.creatureId, c.count));
        if (town) given.push({ ...c, townId: town.id });
      }
      const ev = { type: 'timed_event', playerId: player.id, eventId: e.id, name: e.name || '', message: e.message || '', resources: res, creatures: given };
      events.push(ev);
      (state.log ??= []).push({ turn: state.turn, ...ev });
      if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
    }
  }
  return { ok: true, events };
}

/**
 * The createGame hook: run after towns, heroes and the auto heroes exist.
 * @param {object} ctx { slotToPlayer, heroIds }
 */
export function applyBlueprintExtras(state, blueprint, { slotToPlayer, heroIds }) {
  remapOwners(state, slotToPlayer);
  resolveHeroQuests(state, heroIds);
  (blueprint.heroes || []).forEach((bh, i) => { if (heroIds[i]) customizeHero(state.heroes[heroIds[i]], bh); });
  setupTimedEvents(state, blueprint, slotToPlayer);
  return applyTimedEvents(state); // events of day 1
}
