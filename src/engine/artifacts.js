// Artifact inventory engine: equip / unequip / backpack / combination artifacts / trading.
// Spec: docs/mechanics/artifacts.md. Operates on the Hero shape of docs/DESIGN.md §4.
//
// hero.artifacts = {
//   equipped: { [slot]: Entry|null [SLOT_COUNTS[slot]] },
//   backpack: Entry[],                       // max BACKPACK_CAP
//   locks:    { 'slot:index': 'slot:index' } // locked slot -> slot of the combo that locks it
// }
// Entry = artifactId string, except spell scrolls which are `{ id: 'spell_scroll', spellId }`.
// A locked slot holds `null` in `equipped`; use isSlotLocked() / findEquipSlot() to test it.
//
// Arguments named `ref` accept: an artifact id, an Entry object, or a location
// `{ slot, index }` / `{ backpack: i }`. Mutating functions follow the engine call convention
// (`{ok:true, events}` / `{ok:false, error}`) and mutate the hero(es) passed in.

import { ARTIFACT_SLOTS, SLOT_COUNTS } from '../core/constants.js';
import { pick } from '../core/rng.js';
import {
  getArtifact, randomArtifactPool, combosContaining, SPELL_SCROLL_ID, SCROLL_COST_BY_LEVEL,
} from '../data/artifacts.js';

export const BACKPACK_CAP = 64;
/** Fraction of an artifact's value paid by an Artifact Merchant, by number of marketplaces owned. */
export const SELL_EFFICIENCY = [0, 0.3, 0.45, 0.5, 0.65, 0.7, 0.85, 0.9, 1, 1];

const fail = (error) => ({ ok: false, error });
const key = (slot, index) => `${slot}:${index}`;
const parseKey = (k) => {
  const i = k.lastIndexOf(':');
  return { slot: k.slice(0, i), index: Number(k.slice(i + 1)) };
};

// ---- entries -----------------------------------------------------------------------------------

export function createEmptyArtifacts() {
  const equipped = {};
  for (const slot of ARTIFACT_SLOTS) equipped[slot] = new Array(SLOT_COUNTS[slot]).fill(null);
  return { equipped, backpack: [], locks: {} };
}

/** Make sure `hero.artifacts` has every slot array, a backpack and a locks map. Returns it. */
export function ensureArtifacts(hero) {
  if (!hero.artifacts) hero.artifacts = createEmptyArtifacts();
  const arts = hero.artifacts;
  if (!arts.equipped) arts.equipped = {};
  for (const slot of ARTIFACT_SLOTS) {
    const arr = arts.equipped[slot] || (arts.equipped[slot] = []);
    while (arr.length < SLOT_COUNTS[slot]) arr.push(null);
  }
  if (!arts.backpack) arts.backpack = [];
  if (!arts.locks) arts.locks = {};
  return arts;
}

/** Artifact id of an entry (string or `{id,...}`), or null. */
export function entryId(entry) {
  if (entry == null) return null;
  return typeof entry === 'string' ? entry : entry.id;
}

/** Build a spell scroll entry. */
export function makeScroll(spellId) {
  return { id: SPELL_SCROLL_ID, spellId };
}

/** Canonical entry: plain id string, or `{id:'spell_scroll', spellId}` for scrolls. */
export function normalizeEntry(entry) {
  const id = entryId(entry);
  getArtifact(id); // throws on unknown id
  if (id === SPELL_SCROLL_ID) {
    return typeof entry === 'object' && entry.spellId ? { id, spellId: entry.spellId } : id;
  }
  return id;
}

function isLocation(ref) {
  return ref != null && typeof ref === 'object' && ref.id === undefined &&
    (ref.slot !== undefined || ref.backpack !== undefined);
}

/** Does stored `entry` match the searched `ref` entry? A bare 'spell_scroll' matches any scroll. */
function matches(entry, ref) {
  if (entry == null || entryId(entry) !== entryId(ref)) return false;
  if (typeof ref === 'object' && ref.spellId !== undefined) {
    return typeof entry === 'object' && entry.spellId === ref.spellId;
  }
  return true;
}

function slotArray(hero, slot) {
  return hero.artifacts?.equipped?.[slot] || [];
}

function at(hero, slot, index) {
  return slotArray(hero, slot)[index] ?? null;
}

/** Key of the combo slot that locks `slot[index]`, or null. */
function lockOwner(hero, slot, index) {
  return hero.artifacts?.locks?.[key(slot, index)] ?? null;
}

export function isSlotLocked(hero, slot, index = 0) {
  return lockOwner(hero, slot, index) != null;
}

/** Id of the combination artifact locking the slot, or null. */
export function slotLockedBy(hero, slot, index = 0) {
  const owner = lockOwner(hero, slot, index);
  if (!owner) return null;
  const o = parseKey(owner);
  return entryId(at(hero, o.slot, o.index));
}

// ---- queries -----------------------------------------------------------------------------------

/** @returns {{slot:string,index:number,id:string,entry:string|object}[]} */
export function getEquippedArtifacts(hero) {
  const out = [];
  for (const slot of ARTIFACT_SLOTS) {
    slotArray(hero, slot).forEach((entry, index) => {
      if (entry != null) out.push({ slot, index, id: entryId(entry), entry });
    });
  }
  return out;
}

/** Equipped only; the components of an equipped (assembled) combo count as present. */
export function hasArtifact(hero, id) {
  for (const e of getEquippedArtifacts(hero)) {
    if (e.id === id) return true;
    const comps = getArtifact(e.id).components;
    if (comps && comps.includes(id)) return true;
  }
  return false;
}

/** Equipped or in the backpack (components of assembled combos included). */
export function ownsArtifact(hero, id) {
  if (hasArtifact(hero, id)) return true;
  for (const entry of hero.artifacts?.backpack || []) {
    const eid = entryId(entry);
    if (eid === id) return true;
    const comps = getArtifact(eid).components;
    if (comps && comps.includes(id)) return true;
  }
  return false;
}

function bonusesOfEntry(entry) {
  const def = getArtifact(entryId(entry));
  const out = [];
  const add = (art) => {
    for (const b of art.bonuses) {
      const copy = { ...b, source: `artifact:${def.id}` };
      if (copy.fromInstance) {
        delete copy.fromInstance;
        copy.spellId = typeof entry === 'object' ? entry.spellId : null;
        if (!copy.spellId) continue;
      }
      out.push(copy);
    }
  };
  add(def);
  for (const c of def.components || []) add(getArtifact(c));
  return out;
}

/**
 * All bonuses granted by equipped artifacts, flattened. An equipped combo contributes its own
 * bonuses plus those of every component. Each bonus is a copy tagged `source: 'artifact:<id>'`.
 */
export function getArtifactBonuses(hero) {
  return getEquippedArtifacts(hero).flatMap((e) => bonusesOfEntry(e.entry));
}

/** War machine creature ids the hero brings to combat (catapult included). */
export function getWarMachines(hero) {
  return slotArray(hero, 'war_machine').filter((e) => e != null)
    .map((e) => getArtifact(entryId(e)).bonuses.find((b) => b.type === 'war_machine')?.creatureId)
    .filter(Boolean);
}

/** Locate an artifact. Equipped slots are searched before the backpack unless a location is given. */
export function findArtifact(hero, ref) {
  if (typeof ref === 'number') ref = { backpack: ref };
  if (isLocation(ref)) {
    if (ref.backpack !== undefined) {
      const entry = hero.artifacts?.backpack?.[ref.backpack];
      return entry == null ? null : { where: 'backpack', index: ref.backpack, entry };
    }
    const index = ref.index ?? 0;
    const entry = at(hero, ref.slot, index);
    return entry == null ? null : { where: 'equipped', slot: ref.slot, index, entry };
  }
  getArtifact(entryId(ref));
  for (const e of getEquippedArtifacts(hero)) {
    if (matches(e.entry, ref)) return { where: 'equipped', slot: e.slot, index: e.index, entry: e.entry };
  }
  const bp = hero.artifacts?.backpack || [];
  const i = bp.findIndex((entry) => matches(entry, ref));
  return i < 0 ? null : { where: 'backpack', index: i, entry: bp[i] };
}

// ---- slot planning -----------------------------------------------------------------------------

/** Slots (other than the main one) that a combo locks, as a list of slot names. */
function comboLockSlots(def) {
  const comps = def.components.map((c) => getArtifact(c).slot);
  const main = comps.indexOf(def.slot);
  if (main < 0) throw new Error(`combo ${def.id}: no component uses its slot ${def.slot}`);
  comps.splice(main, 1);
  return comps;
}

/**
 * Where could `ref` be equipped? With no `index` it needs a free slot; with an explicit `index`
 * the current occupant is allowed (equip() swaps it into the backpack) but a locked slot is not.
 * Combination artifacts additionally need one free slot per other component (they get locked).
 * @returns {{ok:true, slot:string, index:number, locks:{slot:string,index:number}[]} | {ok:false,error:string}}
 */
export function findEquipSlot(hero, ref, slot, index) {
  const def = getArtifact(entryId(ref));
  if (def.backpackOnly) return fail('not_equippable');
  if (slot != null && slot !== def.slot) return fail('wrong_slot');
  const count = SLOT_COUNTS[def.slot];
  if (def.slotIndex != null) {
    if (index != null && index !== def.slotIndex) return fail('wrong_slot');
  }
  if (index != null && (!Number.isInteger(index) || index < 0 || index >= count)) return fail('bad_index');

  const explicit = index != null;
  let target = explicit ? index : def.slotIndex;
  // Slots that would be vacated by swapping out the occupant of an explicit target.
  const vacated = new Set();
  if (explicit && at(hero, def.slot, index) != null) {
    const mine = key(def.slot, index);
    vacated.add(mine);
    for (const [k, owner] of Object.entries(hero.artifacts?.locks || {})) if (owner === mine) vacated.add(k);
  }
  const free = (s, i) => vacated.has(key(s, i)) || (at(hero, s, i) == null && !isSlotLocked(hero, s, i));

  if (target != null) {
    if (isSlotLocked(hero, def.slot, target)) return fail('slot_locked');
    if (!free(def.slot, target)) return fail('slot_occupied');
  } else {
    target = -1;
    for (let i = 0; i < count; i++) if (free(def.slot, i)) { target = i; break; }
    if (target < 0) return fail('no_free_slot');
  }

  const locks = [];
  if (def.components) {
    const taken = new Set([key(def.slot, target)]);
    for (const s of comboLockSlots(def)) {
      let found = -1;
      for (let i = 0; i < SLOT_COUNTS[s]; i++) {
        if (!taken.has(key(s, i)) && free(s, i)) { found = i; break; }
      }
      if (found < 0) return fail('component_slots_occupied');
      taken.add(key(s, found));
      locks.push({ slot: s, index: found });
    }
  }
  return { ok: true, slot: def.slot, index: target, locks };
}

/** Boolean form of findEquipSlot(). */
export function canEquip(hero, ref, slot, index) {
  return findEquipSlot(hero, ref, slot, index).ok;
}

function place(hero, entry, slot, index, locks) {
  const arts = ensureArtifacts(hero);
  arts.equipped[slot][index] = entry;
  for (const l of locks || []) arts.locks[key(l.slot, l.index)] = key(slot, index);
}

/** Remove whatever sits in the slot (releasing a combo's locks). Returns {entry, locks}. */
function lift(hero, slot, index) {
  const arts = ensureArtifacts(hero);
  const entry = arts.equipped[slot][index];
  arts.equipped[slot][index] = null;
  const mine = key(slot, index);
  const locks = [];
  for (const [k, owner] of Object.entries(arts.locks)) {
    if (owner === mine) { locks.push(parseKey(k)); delete arts.locks[k]; }
  }
  return { entry, locks };
}

// ---- equip / unequip ---------------------------------------------------------------------------

/**
 * Move an artifact from the backpack into a slot. `ref` = backpack index, artifact id or entry.
 * If an explicit `index` is occupied, the occupant is swapped into the backpack.
 */
export function equip(hero, ref, slot, index) {
  const arts = ensureArtifacts(hero);
  if (typeof ref === 'number') ref = { backpack: ref };
  let bpIndex;
  if (isLocation(ref)) {
    if (ref.backpack === undefined) return fail('not_in_backpack');
    bpIndex = ref.backpack;
  } else {
    getArtifact(entryId(ref));
    bpIndex = arts.backpack.findIndex((e) => matches(e, ref));
  }
  const entry = arts.backpack[bpIndex];
  if (entry == null) return fail('not_in_backpack');

  const plan = findEquipSlot(hero, entry, slot, index);
  if (!plan.ok) return plan;
  const events = [];
  const occupant = at(hero, plan.slot, plan.index);
  if (occupant != null) {
    if (getArtifact(entryId(occupant)).noBackpack) return fail('slot_occupied');
    lift(hero, plan.slot, plan.index);
    arts.backpack[bpIndex] = occupant;
    events.push({ type: 'artifact_unequipped', heroId: hero.id, artifact: occupant, slot: plan.slot, index: plan.index });
  } else {
    arts.backpack.splice(bpIndex, 1);
  }
  place(hero, entry, plan.slot, plan.index, plan.locks);
  events.push({ type: 'artifact_equipped', heroId: hero.id, artifact: entry, slot: plan.slot, index: plan.index });
  return { ok: true, events };
}

/** Move the artifact in `slot[index]` to the backpack. */
export function unequip(hero, slot, index = 0) {
  const arts = ensureArtifacts(hero);
  if (!ARTIFACT_SLOTS.includes(slot)) return fail('bad_slot');
  const entry = at(hero, slot, index);
  if (entry == null) return fail(isSlotLocked(hero, slot, index) ? 'slot_locked' : 'empty_slot');
  if (getArtifact(entryId(entry)).noBackpack) return fail('not_movable');
  if (arts.backpack.length >= BACKPACK_CAP) return fail('backpack_full');
  lift(hero, slot, index);
  arts.backpack.push(entry);
  return { ok: true, events: [{ type: 'artifact_unequipped', heroId: hero.id, artifact: entry, slot, index }] };
}

/** Unequip by artifact id / entry / location (first equipped match). */
export function moveToBackpack(hero, ref) {
  const loc = findArtifact(hero, ref);
  if (!loc) return fail('not_found');
  if (loc.where === 'backpack') return fail('already_in_backpack');
  return unequip(hero, loc.slot, loc.index);
}

/**
 * Give a new artifact to the hero: auto-equips into a free suitable slot, otherwise it goes to
 * the backpack (cap 64). `opts.toBackpack` skips the auto-equip.
 */
export function giveArtifact(hero, ref, opts = {}) {
  const arts = ensureArtifacts(hero);
  const entry = normalizeEntry(ref);
  const def = getArtifact(entryId(entry));
  if (def.instanced && typeof entry === 'string') return fail('scroll_needs_spell');
  if (!opts.toBackpack) {
    const plan = findEquipSlot(hero, entry);
    if (plan.ok) {
      place(hero, entry, plan.slot, plan.index, plan.locks);
      return { ok: true, events: [{ type: 'artifact_gained', heroId: hero.id, artifact: entry, where: 'equipped', slot: plan.slot, index: plan.index }] };
    }
  }
  if (def.noBackpack) return fail('no_free_slot');
  if (arts.backpack.length >= BACKPACK_CAP) return fail('backpack_full');
  arts.backpack.push(entry);
  return { ok: true, events: [{ type: 'artifact_gained', heroId: hero.id, artifact: entry, where: 'backpack', index: arts.backpack.length - 1 }] };
}

/**
 * Move an artifact inside one hero: backpack reordering, slot -> slot of the same kind (ring 1 <->
 * ring 2, misc slots; an occupant is swapped), slot -> backpack position, backpack -> slot.
 * `from` / `to` are locations `{backpack: i}` | `{slot, index}`. On failure the hero is unchanged.
 */
export function moveArtifact(hero, from, to) {
  const arts = ensureArtifacts(hero);
  if (!isLocation(from) || !isLocation(to)) return fail('bad_location');
  const fromBp = from.backpack !== undefined;
  const toBp = to.backpack !== undefined;
  const moved = (extra) => ({ ok: true, events: [{ type: 'artifact_moved', heroId: hero.id, from, to, ...extra }] });
  if (fromBp && toBp) {
    const entry = arts.backpack[from.backpack];
    if (entry == null) return fail('empty_slot');
    if (!Number.isInteger(to.backpack) || to.backpack < 0) return fail('bad_index');
    if (to.backpack === from.backpack) return { ok: true, events: [] };
    arts.backpack.splice(from.backpack, 1);
    arts.backpack.splice(Math.min(to.backpack, arts.backpack.length), 0, entry);
    return moved();
  }
  if (!fromBp && toBp) {
    const r = unequip(hero, from.slot, from.index ?? 0);
    if (!r.ok) return r;
    const last = arts.backpack.length - 1;
    if (Number.isInteger(to.backpack) && to.backpack >= 0 && to.backpack < last) arts.backpack.splice(to.backpack, 0, arts.backpack.pop());
    return r;
  }
  if (fromBp && !toBp) return equip(hero, { backpack: from.backpack }, to.slot, to.index);
  // equipped -> equipped: same slot kind only
  if (from.slot !== to.slot) return fail('wrong_slot');
  const fi = from.index ?? 0;
  const ti = to.index ?? 0;
  if (fi === ti) return { ok: true, events: [] };
  const snapshot = JSON.stringify(arts);
  const restore = () => { Object.assign(arts, JSON.parse(snapshot)); };
  const r1 = unequip(hero, from.slot, fi);
  if (!r1.ok) return r1;
  const r2 = equip(hero, { backpack: arts.backpack.length - 1 }, to.slot, ti);
  if (!r2.ok) { restore(); return r2; }
  if (r2.events.some((e) => e.type === 'artifact_unequipped')) {
    // the swapped occupant went to the backpack: put it into the vacated slot
    const r3 = equip(hero, { backpack: arts.backpack.length - 1 }, from.slot, fi);
    if (!r3.ok) { restore(); return r3; }
  }
  return moved({ slot: from.slot });
}

/** Destroy one instance (equipped first, then backpack). Works on every artifact incl. war machines. */
export function removeArtifact(hero, ref) {
  ensureArtifacts(hero);
  const loc = findArtifact(hero, ref);
  if (!loc) return fail('not_found');
  if (loc.where === 'equipped') lift(hero, loc.slot, loc.index);
  else hero.artifacts.backpack.splice(loc.index, 1);
  return { ok: true, events: [{ type: 'artifact_lost', heroId: hero.id, artifact: loc.entry, where: loc.where }] };
}

// ---- combination artifacts ---------------------------------------------------------------------

/**
 * @returns {{ok:true, parts:{slot,index,id}[]} | {ok:false,error}} — `parts` are the equipped
 * component locations, in the order of `components`.
 */
export function checkAssemble(hero, comboId) {
  const def = getArtifact(comboId);
  if (!def.components) return fail('not_a_combo');
  const used = new Set();
  const parts = [];
  for (const c of def.components) {
    const hit = getEquippedArtifacts(hero).find((e) => e.id === c && !used.has(key(e.slot, e.index)));
    if (!hit) return fail('missing_components');
    used.add(key(hit.slot, hit.index));
    parts.push({ slot: hit.slot, index: hit.index, id: c });
  }
  return { ok: true, parts };
}

export function canAssemble(hero, comboId) {
  return checkAssemble(hero, comboId).ok;
}

/** Ids of every combination artifact the hero could assemble right now. */
export function getAssemblableCombos(hero) {
  const seen = new Set();
  for (const e of getEquippedArtifacts(hero)) seen.add(e.id);
  const out = [];
  for (const id of seen) {
    for (const c of combosContaining(id)) if (!out.includes(c.id) && canAssemble(hero, c.id)) out.push(c.id);
  }
  return out;
}

/** Fuse the equipped components into the combo: it takes the main slot, the others get locked. */
export function assemble(hero, comboId) {
  ensureArtifacts(hero);
  const chk = checkAssemble(hero, comboId);
  if (!chk.ok) return chk;
  const def = getArtifact(comboId);
  const main = chk.parts.find((p) => p.slot === def.slot);
  if (!main) throw new Error(`combo ${comboId}: no component uses its slot ${def.slot}`);
  for (const p of chk.parts) lift(hero, p.slot, p.index);
  place(hero, comboId, main.slot, main.index, chk.parts.filter((p) => p !== main));
  return { ok: true, events: [{ type: 'artifact_assembled', heroId: hero.id, artifact: comboId, slot: main.slot, index: main.index }] };
}

/**
 * Split a combo back into its components. Equipped: components return to the main slot and the
 * locked slots. In the backpack: components replace it there (needs backpack room).
 */
export function disassemble(hero, ref) {
  const arts = ensureArtifacts(hero);
  const loc = findArtifact(hero, ref);
  if (!loc) return fail('not_found');
  const def = getArtifact(entryId(loc.entry));
  if (!def.components) return fail('not_a_combo');
  if (loc.where === 'backpack') {
    if (arts.backpack.length - 1 + def.components.length > BACKPACK_CAP) return fail('backpack_full');
    arts.backpack.splice(loc.index, 1, ...def.components);
  } else {
    const { locks } = lift(hero, loc.slot, loc.index);
    const freeSlots = [{ slot: loc.slot, index: loc.index }, ...locks];
    for (const c of def.components) {
      const cslot = getArtifact(c).slot;
      const i = freeSlots.findIndex((f) => f.slot === cslot);
      if (i >= 0) {
        const [f] = freeSlots.splice(i, 1);
        place(hero, c, f.slot, f.index);
      } else {
        const res = giveArtifact(hero, c); // only reachable if the lock table was corrupted
        if (!res.ok) arts.backpack.push(c);
      }
    }
  }
  return { ok: true, events: [{ type: 'artifact_disassembled', heroId: hero.id, artifact: def.id, components: [...def.components] }] };
}

// ---- trading -----------------------------------------------------------------------------------

/**
 * Move one artifact between two heroes. `ref` selects it on `fromHero` (id / entry / location).
 * `dest`: omitted = auto (free slot, else backpack) | `{slot, index}` (must be free) | `{backpack:true}`.
 */
export function transferArtifact(fromHero, toHero, ref, dest) {
  if (fromHero === toHero) return fail('same_hero');
  ensureArtifacts(fromHero);
  const toArts = ensureArtifacts(toHero);
  const loc = findArtifact(fromHero, ref);
  if (!loc) return fail('not_found');
  const entry = loc.entry;
  const def = getArtifact(entryId(entry));
  if (def.noTransfer) return fail('not_transferable');

  let plan = null; // null => backpack
  if (dest && dest.slot !== undefined) {
    const index = dest.index ?? def.slotIndex ?? 0;
    if (dest.slot !== def.slot) return fail('wrong_slot');
    if (at(toHero, dest.slot, index) != null) return fail('slot_occupied');
    plan = findEquipSlot(toHero, entry, dest.slot, index);
    if (!plan.ok) return plan;
  } else if (!(dest && dest.backpack)) {
    const auto = findEquipSlot(toHero, entry);
    if (auto.ok) plan = auto;
  }
  if (!plan) {
    if (def.noBackpack) return fail('no_free_slot');
    if (toArts.backpack.length >= BACKPACK_CAP) return fail('backpack_full');
  }

  if (loc.where === 'equipped') lift(fromHero, loc.slot, loc.index);
  else fromHero.artifacts.backpack.splice(loc.index, 1);
  if (plan) place(toHero, entry, plan.slot, plan.index, plan.locks);
  else toArts.backpack.push(entry);
  return {
    ok: true,
    events: [{
      type: 'artifact_transferred', fromHeroId: fromHero.id, toHeroId: toHero.id, artifact: entry,
      where: plan ? 'equipped' : 'backpack', slot: plan ? plan.slot : undefined, index: plan ? plan.index : undefined,
    }],
  };
}

/**
 * After a won battle: the winner takes every transferable artifact of the loser (equipped first,
 * then backpack). War machines and non-transferable items stay; anything that does not fit is lost.
 */
export function captureArtifacts(loser, winner) {
  ensureArtifacts(loser);
  const events = [];
  const take = (ref, entry) => {
    const def = getArtifact(entryId(entry));
    if (def.noTransfer || def.noBackpack) return false;
    const res = transferArtifact(loser, winner, ref);
    if (res.ok) events.push(...res.events);
    else { removeArtifact(loser, ref); events.push({ type: 'artifact_lost', heroId: loser.id, artifact: entry, where: 'capture_overflow' }); }
    return true;
  };
  for (const e of getEquippedArtifacts(loser)) take({ slot: e.slot, index: e.index }, e.entry);
  let i = 0;
  while (i < loser.artifacts.backpack.length) {
    if (!take({ backpack: i }, loser.artifacts.backpack[i])) i++;
  }
  return { ok: true, events };
}

// ---- economy / random --------------------------------------------------------------------------

/** Gold value of an entry. For scrolls pass `spellLevel` (1-5) to get the level-based value. */
export function artifactValue(ref, spellLevel) {
  const def = getArtifact(entryId(ref));
  if (def.id === SPELL_SCROLL_ID && spellLevel != null) return SCROLL_COST_BY_LEVEL[spellLevel] ?? def.cost;
  return def.cost;
}

/**
 * What an Artifact Merchant pays for the artifact.
 * @param {number} marketplaces number of marketplaces the player owns (1..9+)
 * @param {{resource?: string, spellLevel?: number}} [opts] resource to receive (default gold);
 *   wood/ore are worth 250 gold a unit, rare resources 500.
 */
export function artifactSellPrice(ref, marketplaces = 1, opts = {}) {
  const def = getArtifact(entryId(ref));
  if (def.noTransfer) return 0;
  const m = Math.max(0, Math.min(SELL_EFFICIENCY.length - 1, Math.floor(marketplaces)));
  const gold = artifactValue(ref, opts.spellLevel) * SELL_EFFICIENCY[m];
  const resource = opts.resource || 'gold';
  if (resource === 'gold') return Math.floor(gold);
  return Math.floor(gold / (resource === 'wood' || resource === 'ore' ? 250 : 500));
}

/**
 * Random artifact id of the given class (`'treasure'|'minor'|'major'|'relic'`, an array of
 * classes, or null for any of the four). Combos, specials and `noRandom` items are never picked.
 * Returns null when nothing is left after `exclude`.
 */
export function pickRandomArtifact(rng, cls = null, exclude = []) {
  const pool = randomArtifactPool(cls).filter((a) => !exclude.includes(a.id));
  return pool.length ? pick(rng, pool).id : null;
}
