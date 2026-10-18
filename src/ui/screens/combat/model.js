// Combat screen: pure logic (no DOM). Layout, hex hit-testing, attack-direction sectors, hover
// interpretation (what a click would do + status text + cursor), event log texts, badge colours,
// result summary. Spec: docs/mechanics/ui-combat.md.
import { pluralize } from '../../../core/plural.js';
import * as C from '../../../engine/combat/index.js';
import { hexIndex, sameHex, hexDistance, stackHexesAt, facing, inBounds, hexesInRadius } from '../../../engine/combat/hex.js';
import { controllerOf } from '../../../engine/combat/stats.js';
import { damageModifiers } from '../../../engine/combat/damage.js';
import { heroMastery } from '../../../engine/combat/spells.js';
import { createHexLayout } from '../../kit/canvas.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { SPELL_BY_ID } from '../../../data/spells.js';

// ---- layout ---------------------------------------------------------------------------------------

export const CANVAS_W = 1280;
export const CANVAS_H = 560;
export const FIELD_W = 15;
export const FIELD_H = 11;
export const HEX = { w: 60, rowH: 44, originX: 175, originY: 52 };
export const UNIT_SIZE = 74;          // sprite height of a creature in px
export const HERO_POS = { attacker: { x: 92, y: 200 }, defender: { x: 1188, y: 200 } };
export const HERO_SIZE = 120;

export function makeLayout() {
  return createHexLayout(HEX);
}

/** The battlefield hex under a logical canvas point, or null outside the field. */
export function hexAtPoint(layout, px, py) {
  const hx = layout.at(px, py);
  if (!hx || !inBounds(hx)) return null;
  const c = layout.center(hx.x, hx.y);
  // `at` returns the nearest centre; reject points clearly outside the outer hexes.
  if (Math.abs(px - c.x) > layout.w * 0.55 || Math.abs(py - c.y) > layout.hexH * 0.55) return null;
  return hx;
}

/** Footprint of a stack-like `{size, side}` with its head at `pos`. */
export function footprint(stack, pos = stack.pos) {
  return stackHexesAt({ size: stack.size || 1, side: stack.side }, pos);
}

/** Pixel position of the feet of a stack-like `{size, side}` standing with its head at `pos`. */
export function feetOf(layout, stack, pos = stack.pos) {
  const hexes = footprint(stack, pos);
  let x = 0;
  let y = 0;
  for (const h of hexes) { const c = layout.center(h.x, h.y); x += c.x; y += c.y; }
  return { x: x / hexes.length, y: y / hexes.length + layout.hexH * 0.26 };
}

// ---- angles / attack sectors -----------------------------------------------------------------------

const deg = (rad) => ((rad * 180) / Math.PI + 360) % 360;
export function angleBetween(a, b) { return deg(Math.atan2(b.y - a.y, b.x - a.x)); }
export function angleDiff(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

/**
 * Sector (0..5 = E, SE, SW, W, NW, NE like the engine's directions) of a point around a hex
 * centre, measured against the real neighbour centres of the layout (rows are squashed).
 */
export function sectorOf(layout, hex, px, py) {
  const c = layout.center(hex.x, hex.y);
  const a = deg(Math.atan2(py - c.y, px - c.x));
  const odd = hex.y & 1;
  const nb = [[1, 0], [odd, 1], [odd - 1, 1], [-1, 0], [odd - 1, -1], [odd, -1]];
  let best = 0;
  let bestD = Infinity;
  nb.forEach(([dx, dy], dir) => {
    const n = layout.center(hex.x + dx, hex.y + dy);
    const d = angleDiff(a, deg(Math.atan2(n.y - c.y, n.x - c.x)));
    if (d < bestD) { bestD = d; best = dir; }
  });
  return best;
}

/**
 * Choose the hex to attack from (the original's sword cursor): the mouse position around the
 * hovered target hex picks the closest legal approach.
 * @param {Object} layout hex layout
 * @param {Object} attacker stack (size, side, pos)
 * @param {{targetId, fromHexes: Hex[]}} option legal attack option
 * @param {Hex[]} targetHexes footprint of the target
 * @param {Hex} hover hovered hex (one of the target's)
 * @param {{x, y}} mouse logical canvas position
 * @returns {{from: Hex, angle: number}|null} `angle` = direction the sword points (degrees, 0 = east)
 */
export function pickAttackFrom(layout, attacker, option, targetHexes, hover, mouse) {
  if (!option || !option.fromHexes || !option.fromHexes.length) return null;
  const hc = layout.center(hover.x, hover.y);
  const mouseAngle = deg(Math.atan2(mouse.y - hc.y, mouse.x - hc.x));
  let best = null;
  for (const fh of option.fromHexes) {
    for (const f of footprint(attacker, fh)) {
      // the attacker hex adjacent to the hovered hex scores by angle; one only touching another
      // target hex scores worse (penalty) so a direct sector always wins.
      let ref = null;
      let penalty = 0;
      if (hexDistance(f, hover) === 1) ref = hover;
      else {
        ref = targetHexes.find((t) => hexDistance(f, t) === 1) || null;
        penalty = 90;
      }
      if (!ref) continue;
      const rc = layout.center(ref.x, ref.y);
      const fc = layout.center(f.x, f.y);
      const score = angleDiff(mouseAngle, deg(Math.atan2(fc.y - rc.y, fc.x - rc.x))) + penalty
        + (sameHex(fh, attacker.pos) ? -0.01 : 0);
      if (!best || score < best.score) best = { score, from: { x: fh.x, y: fh.y }, angle: deg(Math.atan2(rc.y - fc.y, rc.x - fc.x)) };
    }
  }
  return best ? { from: best.from, angle: best.angle } : null;
}

// ---- names / texts -----------------------------------------------------------------------------------

export function creatureName(id) {
  const c = CREATURE_BY_ID[id];
  return c ? c.name : String(id || '?').replace(/_/g, ' ');
}
export function spellName(id) {
  const s = SPELL_BY_ID[id];
  return s ? s.name : String(id || '?').replace(/_/g, ' ');
}
export const humanizeId = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const range = (a, b) => (a === b ? `${a}` : `${a}-${b}`);

export function stackLabel(stack) {
  if (!stack) return '?';
  return `${stack.count > 0 ? `${stack.count} ` : ''}${creatureName(stack.creatureId)}`;
}

/** "Attack Pikeman (12-18 damage, 1-2 perish)" */
export function previewText(verb, target, p) {
  if (!p) return `${verb} ${creatureName(target.creatureId)}`;
  return `${verb} ${creatureName(target.creatureId)} (${range(p.minDamage, p.maxDamage)} damage, ${range(p.minKills, p.maxKills)} perish)`;
}

/** True when a shot of `attacker` at `target` is halved (distance / wall): broken-arrow cursor. */
export function shotIsHalved(cs, attacker, target) {
  try {
    const m = damageModifiers(cs, attacker, target, { ranged: true });
    return !!(m.parts.rangePenalty || m.parts.obstaclePenalty);
  } catch {
    return false;
  }
}

// ---- stacks under the cursor --------------------------------------------------------------------------

/** Living stack whose footprint covers `hex` (or a corpse when `dead` is true). */
export function stackAtHex(cs, hex, { dead = false } = {}) {
  if (!hex) return null;
  const hit = (s) => footprint(s).some((h) => sameHex(h, hex));
  const alive = cs.stacks.find((s) => s.alive && hit(s));
  if (alive || !dead) return alive || null;
  for (let i = cs.stacks.length - 1; i >= 0; i--) if (!cs.stacks[i].alive && hit(cs.stacks[i])) return cs.stacks[i];
  return null;
}

const containsHex = (list, hex) => (list || []).some((h) => sameHex(h, hex));

/** Head hex the active stack would move to when the player clicks `hex` (2-hex tail click), or null. */
export function moveTargetFor(stack, legal, hex) {
  if (containsHex(legal.moves, hex)) return { x: hex.x, y: hex.y };
  if (stack && stack.size > 1) {
    const head = { x: hex.x + facing(stack.side), y: hex.y };
    if (containsHex(legal.moves, head)) return head;
  }
  return null;
}

/** Spell area under a hex: engine `getSpellAreaPreview` when exported, else the radius / ring. */
export function spellAreaHexes(cs, side, spellId, hex) {
  if (typeof C.getSpellAreaPreview === 'function') {
    try {
      const p = C.getSpellAreaPreview(cs, side, spellId, hex);
      if (Array.isArray(p)) return p;
      if (p && Array.isArray(p.hexes)) return p.hexes;
    } catch { /* fall back */ }
  }
  const spell = SPELL_BY_ID[spellId];
  if (!spell || !spell.area || !Array.isArray(spell.area.r)) return [hex];
  let mastery = 0;
  try { mastery = heroMastery(cs, side, spell); } catch { /* none */ }
  const r = spell.area.r[mastery] ?? spell.area.r[spell.area.r.length - 1] ?? 0;
  return hexesInRadius(hex, r, spell.area.shape === 'ring' ? 1 : 0);
}

/** Modes that need no target click (cast at once when picked in the book). */
export const UNTARGETED_MODES = ['all_enemies', 'all_friendly', 'all', 'none'];

/**
 * Interpret the hex under the mouse for the current input mode.
 * @param {Object} cs CombatState
 * @param {Object} legal getLegalActions(cs)
 * @param {Hex|null} hex hovered hex
 * @param {{x, y}} mouse logical canvas position
 * @param {Object} mode { kind: 'normal' } | { kind: 'cast', spellId, side, targets, first? }
 *   (`first`: the stack chosen in step 1 of a two-step spell - Teleport: then a hex, Sacrifice: then a victim)
 *   | { kind: 'ability', entry } | { kind: 'tactics', stackId }
 * @param {Object} layout hex layout
 * @returns {{ action: Object|null, text: string, cursor: {type, angle?}, highlight: Hex[], targetId?: number }}
 */
export function interpretHover(cs, legal, hex, mouse, mode, layout) {
  const none = (text = '', type = 'default') => ({ action: null, text, cursor: { type }, highlight: [] });
  if (!hex) return none();
  const m = mode || { kind: 'normal' };

  if (m.kind === 'tactics') {
    const t = legal.tactics;
    if (!t) return none();
    const st = stackAtHex(cs, hex);
    const entry = st ? t.stacks.find((e) => e.stackId === st.id) : null;
    if (entry) return { action: { type: '__select', stackId: st.id }, text: `Select ${stackLabel(st)}`, cursor: { type: 'select' }, highlight: footprint(st), targetId: st.id };
    const sel = t.stacks.find((e) => e.stackId === m.stackId);
    const stack = sel ? C.getStack(cs, sel.stackId) : null;
    if (stack) {
      let to = containsHex(sel.hexes, hex) ? hex : null;
      if (!to && stack.size > 1) {
        const head = { x: hex.x + facing(stack.side), y: hex.y };
        if (containsHex(sel.hexes, head)) to = head;
      }
      if (to) return { action: { type: 'tactics_move', stackId: stack.id, to: { x: to.x, y: to.y } }, text: `Place ${stackLabel(stack)} here`, cursor: { type: 'move' }, highlight: footprint(stack, to) };
    }
    return st ? none(stackLabel(st), 'info') : none('', 'blocked');
  }

  const active = C.getStack(cs, legal.stackId);
  if (!active) return none();
  const side = legal.side || controllerOf(active);

  if (m.kind === 'cast') {
    const spell = spellName(m.spellId);
    const t = m.targets || { mode: 'enemy_stack', stackIds: [] };
    if (m.first != null) {
      // step 2 of Teleport (destination hex) / Sacrifice (victim stack)
      const chosen = C.getStack(cs, m.first);
      if (t.mode === 'hex') {
        const ok = (t.hexes || []).some((x) => sameHex(x, hex));
        if (ok) return { action: { type: 'cast', spellId: m.spellId, target: { stackId: m.first, hex: { x: hex.x, y: hex.y } } }, text: `${spell}: move ${chosen ? stackLabel(chosen) : ''} here`, cursor: { type: 'spell' }, highlight: chosen ? footprint(chosen, hex) : [hex] };
        return none(`${spell}: choose a destination`, 'blocked');
      }
      const victim = stackAtHex(cs, hex);
      if (victim && (t.stackIds || []).includes(victim.id)) {
        return { action: { type: 'cast', spellId: m.spellId, target: { stackId: m.first, victimId: victim.id } }, text: `${spell}: sacrifice ${stackLabel(victim)}`, cursor: { type: 'spell' }, highlight: footprint(victim), targetId: victim.id };
      }
      return none(`${spell}: choose the stack to sacrifice`, 'blocked');
    }
    if (t.target2) {
      // step 1 of a two-step spell: pick the stack, the second target follows
      const st = stackAtHex(cs, hex, { dead: t.mode === 'dead_friendly_stack' });
      if (st && (t.stackIds || []).includes(st.id)) {
        return { action: { type: '__cast_step2', stackId: st.id }, text: `${spell}: ${stackLabel(st)}`, cursor: { type: 'spell' }, highlight: footprint(st), targetId: st.id };
      }
      return none(`Select a target for ${spell}`, 'blocked');
    }
    if (t.mode === 'area' || t.mode === 'hex' || t.anyHex) {
      const area = spellAreaHexes(cs, side, m.spellId, hex);
      return { action: { type: 'cast', spellId: m.spellId, target: { x: hex.x, y: hex.y } }, text: `Cast ${spell}`, cursor: { type: 'spell' }, highlight: area };
    }
    const st = stackAtHex(cs, hex, { dead: t.mode === 'dead_friendly_stack' });
    if (st && (t.stackIds || []).includes(st.id)) {
      return { action: { type: 'cast', spellId: m.spellId, target: st.id }, text: `Cast ${spell} on ${stackLabel(st)}`, cursor: { type: 'spell' }, highlight: footprint(st), targetId: st.id };
    }
    return none(st ? `${spell}: invalid target` : `Select a target for ${spell}`, 'blocked');
  }

  if (m.kind === 'ability') {
    const e = m.entry;
    const st = stackAtHex(cs, hex, { dead: true });
    if (st && e.targets.includes(st.id)) {
      const what = e.spellId ? spellName(e.spellId) : humanizeId(e.ability);
      return { action: { type: 'ability', ability: e.ability, targetId: st.id }, text: `${what} on ${stackLabel(st)}`, cursor: { type: 'spell' }, highlight: footprint(st), targetId: st.id };
    }
    return none(`Select a target for ${humanizeId(e.ability)}`, 'blocked');
  }

  const st = stackAtHex(cs, hex);
  const wallTarget = !st && (legal.siegeTargets || []).find((t) => (t.hexes || []).some((h) => sameHex(h, hex)));
  if (wallTarget) {
    const name = structureOf(cs, wallTarget.targetId)?.name || humanizeId(wallTarget.targetId);
    const pct = typeof wallTarget.hitChance === 'number' ? ` (${Math.round(wallTarget.hitChance)}% to hit)` : '';
    return { action: { type: 'siege_attack', targetId: wallTarget.targetId }, text: `Attack the ${name}${pct}`, cursor: { type: 'attack', angle: 0 }, highlight: wallTarget.hexes || [hex] };
  }
  if (st && st.id !== active.id && controllerOf(st) !== side) {
    if ((legal.shots || []).includes(st.id)) {
      const p = C.getAttackPreview(cs, active.id, st.id, { ranged: true });
      const half = shotIsHalved(cs, active, st);
      return {
        action: { type: 'shoot', targetId: st.id },
        text: `${previewText('Shoot', st, p)}${active.shots ? `, ${active.shots} shot${active.shots === 1 ? '' : 's'} left` : ''}`,
        cursor: { type: half ? 'shoot_half' : 'shoot' }, highlight: footprint(st), targetId: st.id,
      };
    }
    const opt = (legal.attacks || []).find((a) => a.targetId === st.id);
    if (opt) {
      const pick = pickAttackFrom(layout, active, opt, footprint(st), hex, mouse);
      if (pick) {
        const p = C.getAttackPreview(cs, active.id, st.id, { ranged: false, from: pick.from });
        return {
          action: { type: 'attack', targetId: st.id, from: pick.from },
          text: previewText('Attack', st, p),
          cursor: { type: 'attack', angle: pick.angle }, highlight: footprint(active, pick.from), targetId: st.id,
        };
      }
    }
    return none(stackLabel(st), 'info');
  }
  if (st) {
    if (st.id !== active.id && (legal.heals || []).includes(st.id)) {
      return { action: { type: 'heal', targetId: st.id }, text: `Heal ${stackLabel(st)}`, cursor: { type: 'heal' }, highlight: footprint(st), targetId: st.id };
    }
    return none(st.id === active.id ? `${stackLabel(st)} (active)` : stackLabel(st), 'info');
  }
  const to = moveTargetFor(active, legal, hex);
  if (to) {
    const fly = CREATURE_BY_ID[active.creatureId]?.flying;
    return { action: { type: 'move', to }, text: `${fly ? 'Fly' : 'Move'} ${creatureName(active.creatureId)} here`, cursor: { type: fly ? 'fly' : 'move' }, highlight: footprint(active, to) };
  }
  const obstacle = (cs.obstacles || []).find((o) => !o.hidden && (o.hexes || []).some((h) => sameHex(h, hex)));
  return none(obstacle ? humanizeId(obstacle.kind) : '', 'blocked');
}

/** Hexes of the movement shadow: footprints of every legal move destination. */
export function movementShadow(cs, legal) {
  const active = C.getStack(cs, legal.stackId);
  if (!active) return [];
  const seen = new Set();
  const out = [];
  for (const m of legal.moves || []) {
    for (const h of footprint(active, m)) {
      const k = hexIndex(h);
      if (!seen.has(k) && inBounds(h)) { seen.add(k); out.push(h); }
    }
  }
  return out;
}

// ---- siege -------------------------------------------------------------------------------------------

/** A siege structure (wall section, gate, tower) by id. */
export function structureOf(cs, id) {
  const s = cs.siege;
  if (!s) return null;
  return [...(s.walls || []), ...(s.gate ? [s.gate] : []), ...(s.towers || [])].find((t) => t.id === id) || null;
}
/** Hex where a structure is drawn (towers: their anchor `pos`). */
export function structureHex(cs, id) {
  const t = structureOf(cs, id);
  return t ? t.pos || (t.hexes && t.hexes[0]) || null : null;
}

// ---- badges ---------------------------------------------------------------------------------------------

/** 'buffed' | 'debuffed' | 'mixed' | 'normal' from the active spell effects of a stack. */
export function badgeKind(stack) {
  let pos = false;
  let neg = false;
  for (const e of stack.effects || []) {
    const sp = SPELL_BY_ID[e.spellId];
    if (!sp) continue;
    const align = sp.alignment || (sp.category === 'buff' ? 'positive' : sp.category === 'debuff' || sp.category === 'control' ? 'negative' : 'neutral');
    if (align === 'positive') pos = true;
    else if (align === 'negative') neg = true;
  }
  if (pos && neg) return 'mixed';
  if (pos) return 'buffed';
  if (neg) return 'debuffed';
  return 'normal';
}
export const BADGE_COLORS = { normal: '#6a3c8c', buffed: '#2f7d32', debuffed: '#a8322a', mixed: '#a8862a' };

// ---- log -----------------------------------------------------------------------------------------------

const SKIP_REASONS = { disabled: 'cannot act', fear: 'is frozen with fear', morale: 'is too afraid to act (bad morale)' };

/** One combat log line for an engine event (or null when it is not worth a line). */
export function describeEvent(cs, e) {
  const S = (id) => (id == null ? null : C.getStack(cs, id));
  const name = (id) => { const s = S(id); return s ? creatureName(s.creatureId) : 'a creature'; };
  const hero = (side) => cs.sides?.[side]?.hero?.name || (side === 'attacker' ? 'The attacker' : 'The defender');
  switch (e.type) {
    case 'round_start': return `--- Round ${e.round} ---`;
    case 'tactics_start': return `Tactics: ${hero(e.side)} may arrange the army.`;
    case 'turn_skipped': return `${name(e.stackId)} ${SKIP_REASONS[e.reason] || 'skips the turn'}.`;
    case 'morale': return e.good ? `High morale: ${name(e.stackId)} acts again!` : `Low morale: ${name(e.stackId)} freezes.`;
    case 'luck': return e.good ? `Good luck: ${name(e.stackId)} strikes a lucky blow!` : `Bad luck: ${name(e.stackId)} deals half damage.`;
    case 'wait': return `${name(e.stackId)} waits.`;
    case 'defend': return `${name(e.stackId)} defends.`;
    case 'damage': {
      if (e.blocked) return `${name(e.stackId)} is unharmed.`;
      const one = (id) => { const s = S(id); return !!s && s.count === 1; };
      const many = (id) => { const s = S(id); return s ? pluralize(creatureName(s.creatureId)) : 'creatures'; };
      const src = e.sourceStackId != null
        ? (one(e.sourceStackId) ? `${name(e.sourceStackId)} does` : `${many(e.sourceStackId)} do`) + ` ${e.dealt ?? e.amount} damage`
        : `${name(e.stackId)} takes ${e.dealt ?? e.amount} damage`;
      return `${src}${e.killed ? `. ${e.killed} ${e.killed === 1 ? `${name(e.stackId)} perishes` : `${many(e.stackId)} perish`}` : ''}.`;
    }
    case 'death': return `${creatureName(e.creatureId) || name(e.stackId)} stack destroyed.`;
    case 'rebirth': return `${e.count} ${name(e.stackId)} rise from the ashes.`;
    case 'resurrect': return `${e.raised} ${name(e.stackId)} ${e.raised === 1 ? 'is' : 'are'} brought back.`;
    case 'heal': return e.amount > 0 ? `${name(e.stackId)} healed by ${e.amount}.` : null;
    case 'explode': return `${name(e.stackId)} explode${e.killed ? `, killing ${e.killed}` : ''}.`;
    case 'spell': {
      const who = e.creature || e.stackId != null ? name(e.stackId) : hero(e.side);
      const tgt = typeof e.target === 'number' ? ` on ${name(e.target)}` : typeof e.targetId === 'number' ? ` on ${name(e.targetId)}` : '';
      return `${who} casts ${spellName(e.spellId)}${tgt}.`;
    }
    case 'spell_resisted': return `${name(e.stackId)} resists ${spellName(e.spellId)}.`;
    case 'spell_immune': return `${name(e.stackId)} is immune${e.spellId ? ` to ${spellName(e.spellId)}` : ''}.`;
    case 'spell_reflected': return `${name(e.stackId)} reflects ${spellName(e.spellId)}.`;
    case 'status_removed': return e.reason === 'expired' && e.spellId ? `${spellName(e.spellId)} wears off ${name(e.stackId)}.` : null;
    case 'mana_channel': return `${hero(e.side)} channels ${e.amount} mana.`;
    case 'mana_drain': return `${name(e.stackId)} drains the enemy's mana.`;
    case 'ability': return e.ability === 'heals' ? null : `${name(e.stackId)}: ${humanizeId(e.ability)}${e.kills ? ` (${e.kills} killed)` : ''}.`;
    case 'summon': return `${e.count} ${creatureName(e.creatureId)} ${e.clone ? 'cloned' : 'summoned'}.`;
    case 'berserk': return `${name(e.stackId)} goes berserk!`;
    case 'obstacle_added': return e.hidden ? null : `${humanizeId(e.kind)} appears.`;
    case 'obstacle_triggered': return `${name(e.stackId)} triggers ${humanizeId(e.kind)}.`;
    case 'poison_tick': return `${name(e.stackId)} suffers from poison.`;
    case 'retreat': return `${hero(e.side)} retreats.`;
    case 'surrender': return `${hero(e.side)} surrenders${e.cost ? ` for ${e.cost} gold` : ''}.`;
    case 'tower_shot': return `The ${structureOf(cs, e.towerId)?.name || 'tower'} shoots at ${name(e.targetId)}.`;
    case 'catapult_shot': return `${name(e.stackId)} ${e.hit ? 'hits' : 'misses'} the ${structureOf(cs, e.targetId)?.name || humanizeId(e.kind)}.`;
    case 'wall_damaged': return `The ${structureOf(cs, e.targetId)?.name || humanizeId(e.kind)} is damaged.`;
    case 'wall_destroyed': return `The ${structureOf(cs, e.targetId)?.name || humanizeId(e.kind)} is destroyed!`;
    case 'gate_opened': return 'The gate opens.';
    case 'gate_closed': return 'The gate closes.';
    case 'moat_damage': return `${name(e.stackId)} takes ${e.amount} damage in the ${e.moat || 'moat'}.`;
    case 'combat_end': return e.winner === 'draw' ? 'The battle ends in a draw.' : `The ${e.winner} wins the battle.`;
    case 'tactics_end': return 'The battle begins!';
    case 'shoot': case 'attack': case 'retaliate': case 'move': case 'turn_start': case 'status_added': case 'combat_start': case 'spell_ready':
      return null;
    default: return null;
  }
}

// ---- sides / result -------------------------------------------------------------------------------------

/** The side the local player looks from (first human side; attacker when none / both). */
export function viewerSide(cs) {
  const a = cs.sides?.attacker?.isHuman;
  const d = cs.sides?.defender?.isHuman;
  if (d && !a) return 'defender';
  return 'attacker';
}
export const isHumanSide = (cs, side) => !!cs.sides?.[side]?.isHuman;

/** Losses as a sorted list `[{creatureId, count}]`. */
export function lossList(losses) {
  return Object.entries(losses || {}).filter(([, n]) => n > 0).map(([creatureId, count]) => ({ creatureId, count }))
    .sort((a, b) => (CREATURE_BY_ID[b.creatureId]?.tier || 0) - (CREATURE_BY_ID[a.creatureId]?.tier || 0));
}

/**
 * Result dialog model from the engine result and (optional) finishCombat summary + events.
 * @returns {{title, outcome: 'victory'|'defeat'|'draw', lines: string[], ownLosses, enemyLosses, experience, raised, artifacts: string[]}}
 */
export function resultModel(cs, result, summary = null, events = []) {
  const me = viewerSide(cs);
  const foe = me === 'attacker' ? 'defender' : 'attacker';
  const human = isHumanSide(cs, me);
  const outcome = result.winner === 'draw' || !result.winner ? 'draw' : result.winner === me ? 'victory' : 'defeat';
  const lines = [];
  const reason = cs.endReason || result.reason;
  const heroName = (side) => cs.sides[side].hero?.name || (side === 'attacker' ? 'The attacker' : 'The defender');
  if (reason === 'retreat') lines.push(`${heroName(result.winner === 'attacker' ? 'defender' : 'attacker')} has fled the battle.`);
  if (reason === 'surrender') lines.push(`${heroName(result.winner === 'attacker' ? 'defender' : 'attacker')} has surrendered${summary?.surrenderPaid ? ` (${summary.surrenderPaid} gold paid)` : ''}.`);
  const expKey = me === 'attacker' ? 'expAttacker' : 'expDefender';
  const experience = outcome === 'victory' ? (summary?.experience ?? result[expKey] ?? 0) : 0;
  if (experience > 0 && cs.sides[me].hero) lines.push(`${heroName(me)} gains ${experience} experience.`);
  const raised = outcome === 'victory' && summary?.raised ? summary.raised : null;
  if (raised) lines.push(`${raised.count} ${creatureName(raised.creatureId)} rise from the dead to join your army.`);
  const winnerHeroId = summary?.winnerHeroId ?? null;
  const artifacts = (events || []).filter((e) => e.type === 'artifact_transferred' && (!winnerHeroId || e.toHeroId === winnerHeroId))
    .map((e) => { const a = e.artifact; return humanizeId(typeof a === 'string' ? a : a?.id || a?.artifactId || 'artifact'); });
  if (artifacts.length) lines.push(`Captured artifacts: ${artifacts.join(', ')}.`);
  const title = human
    ? (outcome === 'victory' ? 'Victory!' : outcome === 'defeat' ? 'Defeat' : 'Draw')
    : (outcome === 'draw' ? 'Draw' : `${humanizeId(result.winner)} wins`);
  return {
    title, outcome, lines, experience, raised, artifacts, me, foe,
    ownLosses: lossList(result[me]?.losses), enemyLosses: lossList(result[foe]?.losses),
  };
}

/** Projectile sprite id for a shooter. */
export function projectileFor(creatureId) {
  const c = CREATURE_BY_ID[creatureId] || {};
  if (creatureId === 'ballista') return 'bolt';
  if (creatureId === 'cannon') return 'cannonball';
  if (/cyclop/.test(creatureId || '')) return 'rock';
  if (c.shape === 'caster' || c.shape === 'elemental') return 'magic_missile';
  if (/mage|lich|titan|storm|monk|zealot|druid|gog|magog|eye|beholder/.test(creatureId || '')) return 'fireball';
  return 'arrow';
}

/** Spells' visual class: buff/debuff/damage... used for colour of floating texts / sfx. */
export function spellSfx(spellId) {
  const s = SPELL_BY_ID[spellId];
  if (!s) return 'spell';
  if (s.category === 'heal') return /resurrect|animate/.test(s.id) ? 'spell_resurrect' : 'spell_heal';
  if (s.category === 'summon') return 'spell_summon';
  if (s.category === 'buff') return 'spell_buff';
  if (s.category === 'debuff' || s.category === 'control') return 'spell_debuff';
  return `spell_${s.school || 'all'}`;
}
