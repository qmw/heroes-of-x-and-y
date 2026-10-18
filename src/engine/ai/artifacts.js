// AI artifact management: equip the best items per slot, assemble combos, hand artifacts to the
// main hero when heroes meet. Spec: docs/mechanics/ai.md "Artifacts".
import { SLOT_COUNTS } from '../../core/constants.js';
import { getArtifact, combosContaining } from '../../data/artifacts.js';
import {
  entryId, equip, assemble, getAssemblableCombos, getEquippedArtifacts, findEquipSlot, isSlotLocked,
} from '../artifacts.js';
import { tradeArtifact } from '../hero.js';
import { spend, note } from './context.js';

function safeDef(entry) {
  try { return getArtifact(entryId(entry)); } catch { return null; }
}

/** Ids the hero owns (equipped + backpack, combo components excluded). */
function ownedIds(hero) {
  const ids = new Set();
  for (const e of getEquippedArtifacts(hero)) ids.add(e.id);
  for (const e of hero.artifacts?.backpack || []) ids.add(entryId(e));
  return ids;
}

/** Value of an artifact for this hero: gold value, + a bonus when it completes an ownable combo. */
export function artifactWorth(hero, entry, owned = ownedIds(hero)) {
  const def = safeDef(entry);
  if (!def) return 0;
  let v = def.cost || 0;
  if (def.id === 'spell_scroll') v = 500;
  for (const c of combosContaining(def.id)) if (c.components.every((id) => owned.has(id))) v += 5000;
  return v;
}

/** Equip backpack items into free / weaker slots; assemble every possible combo. */
export function manageArtifacts(ctx, hero) {
  if (!hero || !hero.artifacts) return;
  for (let pass = 0; pass < 2; pass++) {
    equipBest(ctx, hero);
    for (const comboId of getAssemblableCombos(hero)) {
      const r = assemble(hero, comboId);
      if (!r.ok) note(ctx, 'assemble_failed', `${comboId} ${r.error}`);
    }
  }
}

function equipBest(ctx, hero) {
  for (let guard = 0; guard < 24; guard++) {
    const bp = hero.artifacts.backpack || [];
    const owned = ownedIds(hero);
    // best remaining candidate first
    const order = bp.map((e, i) => ({ i, e, v: artifactWorth(hero, e, owned) })).sort((a, b) => b.v - a.v || a.i - b.i);
    let done = false;
    for (const { i, e, v } of order) {
      const def = safeDef(e);
      if (!def || def.backpackOnly || def.slot == null) continue;
      if (findEquipSlot(hero, e).ok) {
        if (equip(hero, { backpack: i }).ok) { done = true; break; }
        continue;
      }
      // swap with the weakest unlocked occupant of that slot if this one is worth more
      let weakest = -1;
      let weakV = Infinity;
      for (let k = 0; k < (SLOT_COUNTS[def.slot] || 1); k++) {
        const occ = hero.artifacts.equipped?.[def.slot]?.[k];
        if (occ == null || isSlotLocked(hero, def.slot, k)) continue;
        const od = safeDef(occ);
        if (!od || od.noBackpack || od.components) continue;
        const ov = artifactWorth(hero, occ, owned);
        if (ov < weakV) { weakV = ov; weakest = k; }
      }
      if (weakest >= 0 && weakV < v && equip(hero, { backpack: i }, def.slot, weakest).ok) { done = true; break; }
    }
    if (!done) return;
  }
}

/** Give every transferable artifact of `from` to `to` (both must be able to trade), then sort `to`. */
export function handArtifacts(ctx, from, to) {
  const { state } = ctx;
  const refs = [];
  for (const e of getEquippedArtifacts(from)) {
    const def = safeDef(e.entry);
    if (!def || def.noTransfer || def.noBackpack) continue;
    refs.push({ slot: e.slot, index: e.index });
  }
  for (let i = (from.artifacts?.backpack || []).length - 1; i >= 0; i--) refs.push({ backpack: i });
  for (const ref of refs) {
    if (!spend(ctx)) break;
    const r = tradeArtifact(state, from.id, to.id, ref);
    if (!r.ok && r.error !== 'not_transferable' && r.error !== 'no_free_slot') note(ctx, 'artifact_trade_failed', r.error);
  }
  manageArtifacts(ctx, to);
}
