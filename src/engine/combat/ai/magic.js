// Hero spellcasting of the combat AI: every castable spell × a short list of sensible targets is
// cast on a private copy of the state and scored by the change of the board score (material,
// status effects weighted by their remaining rounds, enemy threat). Damage on own troops,
// immunities, resurrection, summons and dispels all fall out of the same evaluation.
import { getSpell } from '../../../data/spells.js';
import { hexIndex, stackHexes, neighbors, inBounds, hexDistance } from '../hex.js';
import { getStack } from '../state.js';
import { controllerOf, magicResistanceOf } from '../stats.js';
import * as spellsMod from '../spells.js';
import { boardScore, rawValue, unitValue, eliminationBonus } from './eval.js';
import { simState } from './sim.js';
import { weightsFor } from './tactics.js';

const STACK_MODES = ['enemy_stack', 'friendly_stack', 'any_stack', 'dead_friendly_stack'];
const MASS_MODES = ['all', 'all_enemies', 'all_friendly', 'none'];

function spellTargetsOf(cs, side, spellId, sel) {
  try {
    return spellsMod.getSpellTargets(cs, side, spellId, sel);
  } catch {
    return null;
  }
}

/** Candidate targets (in the format castHeroSpell accepts) for one spell. */
function targetCandidates(cs, side, spellId) {
  const spell = getSpell(spellId);
  const t = spellTargetsOf(cs, side, spellId);
  if (!t) return [];
  const friendly = (s) => controllerOf(s) === side;
  const stacks = (t.stackIds ?? []).map((id) => getStack(cs, id)).filter(Boolean);
  if (STACK_MODES.includes(t.mode)) {
    let pool = stacks;
    if (t.mode === 'dead_friendly_stack') {
      pool = pool.slice().sort((a, b) => lostValue(b) - lostValue(a) || a.id - b.id);
    } else if (spell.alignment === 'positive') {
      pool = pool.filter(friendly).sort((a, b) => rawValue(b) - rawValue(a) || a.id - b.id);
    } else if (spell.alignment === 'negative') {
      pool = pool.filter((s) => !friendly(s)).sort((a, b) => rawValue(b) - rawValue(a) || a.id - b.id);
    } else {
      // neutral (Dispel...): stacks carrying effects worth removing
      pool = pool.filter((s) => s.effects.length).sort((a, b) => rawValue(b) - rawValue(a) || a.id - b.id);
    }
    return pool.slice(0, 5).map((s) => s.id);
  }
  if (t.mode === 'area') return areaCenters(cs, side, spell, stacks);
  if (MASS_MODES.includes(t.mode)) return [null];
  if (t.mode === 'hex' && Array.isArray(t.hexes) && t.hexes.length) {
    // line obstacles: the legal top hexes closest to the enemy's front
    const enemies = cs.stacks.filter((s) => s.alive && !friendly(s));
    const score = (h) => Math.min(99, ...enemies.map((e) => Math.min(...stackHexes(e).map((x) => hexDistance(x, h)))));
    return t.hexes.slice().sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x).slice(0, 3).map((h) => ({ x: h.x, y: h.y }));
  }
  if (t.target2 === 'hex' || spell.effect.type === 'teleport') {
    // Teleport: our strongest melee stacks next to the most valuable enemies
    const out = [];
    for (const s of stacks.filter(friendly).sort((a, b) => rawValue(b) - rawValue(a)).slice(0, 2)) {
      const t2 = spellTargetsOf(cs, side, spellId, { stackId: s.id });
      const enemies = cs.stacks.filter((e) => e.alive && !friendly(e)).sort((a, b) => rawValue(b) - rawValue(a)).slice(0, 2);
      for (const e of enemies) {
        const near = (t2?.hexes ?? []).filter((h) => stackHexes(e).some((x) => hexDistance(x, h) === 1));
        if (near.length) out.push({ stackId: s.id, hex: { x: near[0].x, y: near[0].y } });
      }
    }
    return out.slice(0, 4);
  }
  return [];
}

function lostValue(s) {
  return unitValue(s) * Math.max(0, s.startCount - (s.alive ? s.count : 0));
}

/** Area centres worth trying: hexes of enemy stacks and their neighbours, ranked by a cheap sum. */
function areaCenters(cs, side, spell, stacks) {
  const r = spell.area?.r ? Math.max(...spell.area.r) : 1;
  const ring = spell.area?.shape === 'ring';
  const candidates = new Map();
  for (const s of stacks) {
    if (controllerOf(s) === side) continue;
    for (const h of stackHexes(s)) {
      candidates.set(hexIndex(h), h);
      for (const n of neighbors(h)) if (inBounds(n)) candidates.set(hexIndex(n), n);
    }
  }
  const ranked = [];
  for (const h of candidates.values()) {
    let v = 0;
    for (const s of stacks) {
      const d = Math.min(...stackHexes(s).map((x) => hexDistance(x, h)));
      const hit = ring ? d >= 1 && d <= r : d <= r;
      if (hit) v += (controllerOf(s) === side ? -1.5 : 1) * rawValue(s);
    }
    ranked.push({ h, v });
  }
  ranked.sort((a, b) => b.v - a.v || a.h.y - b.h.y || a.h.x - b.h.x);
  return ranked.slice(0, 3).filter((x) => x.v > 0).map((x) => ({ x: x.h.x, y: x.h.y }));
}

/** Expected share of the spell that is not resisted (hostile resistible spells). */
function resistFactor(cs, side, spell, target) {
  if (!spell.resistible || spell.alignment !== 'negative') return 1;
  if (typeof target === 'number') {
    const s = getStack(cs, target);
    return s && controllerOf(s) !== side ? 1 - magicResistanceOf(cs, s) / 100 : 1;
  }
  const foes = cs.stacks.filter((s) => s.alive && controllerOf(s) !== side);
  if (!foes.length) return 1;
  let w = 0;
  let tot = 0;
  for (const s of foes) { w += rawValue(s) * (1 - magicResistanceOf(cs, s) / 100); tot += rawValue(s); }
  return tot > 0 ? w / tot : 1;
}

/**
 * Best hero spell for `side` right now, or null when nothing is worth the mana.
 * @param {{level?: number}} opts
 * @returns {{action: Object, score: number} | null}
 */
export function chooseHeroSpell(cs, legal, side, opts = {}) {
  const hero = cs.sides[side].hero;
  if (!hero || !legal.spells.length) return null;
  const weights = weightsFor(cs, side);
  const before = boardScore(cs, side, weights);
  const scale = cs.stacks.reduce((a, s) => a + rawValue(s), 0);
  const options = [];
  for (const spellId of legal.spells) {
    const spell = getSpell(spellId);
    let cost = 0;
    try { cost = spellsMod.heroSpellCost(cs, side, spellId); } catch { cost = spell.cost ?? 0; }
    for (const target of targetCandidates(cs, side, spellId)) {
      const c = simState(cs, side);
      let res;
      try { res = spellsMod.castHeroSpell(c, side, spellId, target); } catch { res = { ok: false }; }
      if (!res || !res.ok) continue;
      const after = boardScore(c, side, weights);
      let gain = after - before + eliminationBonus(cs, c, side);
      if (gain > 0) gain *= resistFactor(cs, side, spell, target);
      options.push({ spellId, target, gain, cost });
    }
  }
  if (!options.length) return null;
  // Mana is worth something: a spell must pay for its cost relative to the best value per mana.
  const bestRatio = Math.max(0, ...options.map((o) => o.gain / Math.max(1, o.cost)));
  const scarce = hero.mana < 3 * Math.max(...options.map((o) => o.cost)) ? 0.35 : 0.15;
  let best = null;
  for (const o of options) {
    o.score = o.gain - o.cost * bestRatio * scarce;
    if (!best || o.score > best.score) best = o;
  }
  const minGain = Math.max(1, 0.004 * scale);
  if (best.gain < minGain) return null;
  return { action: { type: 'cast', spellId: best.spellId, target: best.target }, score: best.score, options };
}
