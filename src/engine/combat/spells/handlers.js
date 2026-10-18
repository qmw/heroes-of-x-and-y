// Spell effect types that are not "one spell on one stack" (docs/mechanics/spells.md §4, §6.5,
// §9.4, §10, §11): summon, clone, teleport, obstacle, remove_obstacle, wall_damage (Earthquake)
// and sacrifice. Registered into `EXTRA_HANDLERS` by ../spells.js through `createHandlers()`.
//
// Handler contract (see spells.js):
//   targets(cs, side, spell, ctx, sel) -> { mode, stackIds, anyHex, available, hexes?, obstacleIds?, target2? }
//   cast(cs, side, spell, ctx, target)  -> events | null   (null: illegal target, nothing changed)
//   preview(cs, side, spell, ctx, hex, sel, targets) -> { valid, hexes, stackIds }
// `ctx` = { mastery, power, casterSide, damageMult, extraDuration, adjust(kind, value, target) }.
//
// Only function declarations live at module level so that the import cycle
// spells.js -> handlers.js -> actions.js -> abilities.js -> spells.js is safe in any load order.
import { getCreature } from '../../../data/creatures.js';
import { spellValue, spellDuration } from '../../../data/spells.js';
import { W, H, hexIndex, inBounds, sameHex, stackHexes, stackHexesAt, stackDistance, neighbors } from '../hex.js';
import {
  getStack, occupancy, blockedHexes, canStandAt, edgePos, rollPick, rollInt,
} from '../state.js';
import { controllerOf, isLiving, tagsOf } from '../stats.js';
import {
  ev, canSpellAffect, canResurrect, resurrectStack, summonStack, killStack, placeObstacle, removeObstacle,
  nearestFreePos, releaseBindsOf, refreshBinds,
} from '../effects.js';
import { enterHex } from '../actions.js';
import * as siegeApi from '../siege.js';

/** The handler table (fresh object; spells.js copies it into EXTRA_HANDLERS). */
export function createHandlers() {
  return {
    summon: { targets: summonTargets, cast: summonCast, preview: summonPreview },
    clone: { targets: cloneTargets, cast: cloneCast, preview: stackPreview },
    teleport: { targets: teleportTargets, cast: teleportCast, preview: teleportPreview },
    obstacle: { targets: obstacleTargets, cast: obstacleCast, preview: obstaclePreview },
    remove_obstacle: { targets: removeTargets, cast: removeCast, preview: removePreview },
    wall_damage: { targets: quakeTargets, cast: quakeCast, preview: nonePreview },
    sacrifice: { targets: sacrificeTargets, cast: sacrificeCast, preview: sacrificePreview },
  };
}

// ---- shared helpers -----------------------------------------------------------------------------

function idOf(target, key = 'stackId') {
  if (typeof target === 'number') return target;
  if (target && typeof target === 'object' && typeof target[key] === 'number') return target[key];
  return null;
}

function hexOf(target) {
  if (!target || typeof target !== 'object') return null;
  const h = target.hex ?? target.to ?? (typeof target.x === 'number' ? target : null);
  return h && typeof h.x === 'number' && typeof h.y === 'number' ? { x: h.x, y: h.y } : null;
}

const adjustOf = (ctx) => ctx.adjust ?? ((kind, value) => value);

/** Obstacles the caster can see: everything except the enemy's hidden mines / quicksand. */
function visibleTo(o, side) {
  return !(o.hidden && o.side !== side);
}

function stackPreview(cs, side, spell, ctx, hex, sel, t) {
  const s = hex ? cs.stacks.find((x) => stackHexes(x).some((h) => sameHex(h, hex))) : null;
  if (!s || !t.stackIds.includes(s.id)) return { valid: false, hexes: [], stackIds: [] };
  return { valid: true, hexes: stackHexes(s), stackIds: [s.id] };
}

function nonePreview(cs, side, spell, ctx, hex, sel, t) {
  return { valid: !!t.available, hexes: [], stackIds: [] };
}

// ---- summon (§10) -------------------------------------------------------------------------------

/** First free spot from the side's back column, middle rows first (same scan as summonStack). */
function summonSpot(cs, side, creatureId) {
  const probe = { id: -1, side, size: getCreature(creatureId).size };
  const occ = occupancy(cs);
  const blocked = blockedHexes(cs);
  const rows = [5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10];
  for (let col = 0; col < W; col++) {
    for (const row of rows) {
      const base = edgePos(side, probe.size, row);
      const p = { x: base.x + (side === 'attacker' ? col : -col), y: row };
      if (canStandAt(cs, probe, p, occ, blocked)) return p;
    }
  }
  return null;
}

/** Living spell-summoned stacks of the side. */
const liveSummons = (cs, side) => cs.stacks.filter((s) => s.alive && s.side === side && s.summoned && s.summonSpell);

function summonPlan(cs, side, spell) {
  const creatureId = spell.effect.creatureId;
  const live = liveSummons(cs, side);
  // One elemental kind per side per battle (original rule) - even after that stack has died.
  const kind = cs.sides[side]?.summonedKind;
  if ((kind && kind !== creatureId) || live.some((s) => s.creatureId !== creatureId)) return null;
  const existing = live.find((s) => s.creatureId === creatureId) ?? null;
  const pos = existing ? null : summonSpot(cs, side, creatureId);
  if (!existing && !pos) return null;
  return { creatureId, existing, pos };
}

function summonCount(spell, ctx) {
  const raw = spell.effect.perSpellPower[ctx.mastery] * Math.max(1, ctx.power ?? 1);
  return Math.max(1, Math.floor(adjustOf(ctx)('count', raw, { creatureId: spell.effect.creatureId }) + 1e-9));
}

function summonTargets(cs, side, spell) {
  return { mode: 'none', stackIds: [], anyHex: false, available: !!summonPlan(cs, side, spell) };
}

function summonCast(cs, side, spell, ctx) {
  const plan = summonPlan(cs, side, spell);
  if (!plan) return null;
  const n = summonCount(spell, ctx);
  if (plan.existing) {
    const s = plan.existing;
    s.count += n;
    s.startCount += n;
    return [ev('summon', { stackId: s.id, side, creatureId: s.creatureId, count: n, total: s.count, pos: { ...s.pos }, clone: false, summoned: true, reinforced: true, spellId: spell.id })];
  }
  const { stack, events } = summonStack(cs, side, plan.creatureId, n, plan.pos, { summoned: true });
  if (!stack) return null;
  stack.summonSpell = spell.id;
  cs.sides[side].summonedKind = plan.creatureId;
  for (const e of events) e.spellId = spell.id;
  return events;
}

function summonPreview(cs, side, spell) {
  const plan = summonPlan(cs, side, spell);
  if (!plan) return { valid: false, hexes: [], stackIds: [] };
  if (plan.existing) return { valid: true, hexes: stackHexes(plan.existing), stackIds: [plan.existing.id] };
  return { valid: true, hexes: stackHexesAt({ side, size: getCreature(plan.creatureId).size }, plan.pos), stackIds: [] };
}

// ---- clone (§11) --------------------------------------------------------------------------------

function cloneAllowed(cs, side, spell, ctx, s) {
  if (!s.alive || controllerOf(s) !== side || s.clone || s.warMachine || s.summoned) return false;
  if (!canSpellAffect(cs, spell.id, s, side)) return false;
  const tier = getCreature(s.creatureId).tier;
  if (!(tier >= 1) || tier >= 8) return false;
  const allowance = Math.min(7, Math.floor(adjustOf(ctx)('hp_limit', spell.effect.maxTier[ctx.mastery], s) + 1e-9));
  if (tier > allowance) return false;
  if (cs.stacks.some((c) => c.alive && c.clone && c.cloneOf === s.id)) return false;
  return !!nearestFreePos(cs, { id: -1, side, size: s.size }, s.pos);
}

function cloneTargets(cs, side, spell, ctx) {
  const stackIds = cs.stacks.filter((s) => cloneAllowed(cs, side, spell, ctx, s)).map((s) => s.id);
  return { mode: 'friendly_stack', stackIds, anyHex: false, available: stackIds.length > 0 };
}

function cloneCast(cs, side, spell, ctx, target) {
  const orig = getStack(cs, idOf(target));
  if (!orig || !cloneAllowed(cs, side, spell, ctx, orig)) return null;
  const rounds = spellDuration(spell, ctx.mastery, Math.max(1, ctx.power ?? 1), ctx.extraDuration ?? 0);
  const { stack, events } = summonStack(cs, side, orig.creatureId, orig.count, orig.pos, { clone: true, cloneRoundsLeft: rounds });
  if (!stack) return null;
  stack.cloneOf = orig.id;
  stack.shots = orig.shots;
  for (const e of events) { e.spellId = spell.id; e.cloneOf = orig.id; e.rounds = rounds; }
  return events;
}

// ---- teleport -----------------------------------------------------------------------------------

/**
 * Siege rule for Teleport (crossMoat / crossWalls per mastery). Delegates to the siege module's
 * `siegeTeleportAllowed(cs, stack, to, {crossMoat, crossWalls})`; with the legacy test geometry
 * (`cs.siege.wallColumn` set) or without that export: the wall line is `cs.siege.wallColumn` and
 * the moat is `cs.siege.moat.hexes`.
 */
function siegeAllows(cs, stack, to, spell, m) {
  if (!cs.siege) return true;
  const crossMoat = !!spell.effect.crossMoat[m];
  const crossWalls = !!spell.effect.crossWalls[m];
  if (typeof siegeApi.siegeTeleportAllowed === 'function' && cs.siege.wallColumn == null) {
    return siegeApi.siegeTeleportAllowed(cs, stack, to, { crossMoat, crossWalls });
  }
  const col = cs.siege.wallColumn;
  if (col !== null && col !== undefined && !crossWalls && (stack.pos.x < col) !== (to.x < col)) return false;
  const moat = cs.siege.moat?.hexes ?? [];
  if (!crossMoat && moat.length) {
    const inMoat = (h) => moat.some((x) => sameHex(x, h));
    if (stackHexesAt(stack, to).some(inMoat)) return false;
    // crossing the moat line (the wall side of the moat) is crossing it, too
    const moatCol = Math.min(...moat.map((h) => h.x));
    if ((stack.pos.x < moatCol) !== (to.x < moatCol) && (col === null || col === undefined || crossWalls)) return false;
  }
  return true;
}

function teleportHexes(cs, stack, spell, m, firstOnly = false) {
  const out = [];
  const occ = occupancy(cs, stack.id);
  const blocked = blockedHexes(cs);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pos = { x, y };
      if (sameHex(pos, stack.pos) || !canStandAt(cs, stack, pos, occ, blocked)) continue;
      if (!siegeAllows(cs, stack, pos, spell, m)) continue;
      out.push(pos);
      if (firstOnly) return out;
    }
  }
  return out;
}

function teleportable(cs, side, spell, s) {
  return s.alive && controllerOf(s) === side && !s.warMachine && canSpellAffect(cs, spell.id, s, side);
}

function teleportTargets(cs, side, spell, ctx, sel = {}) {
  if (sel && typeof sel.stackId === 'number') {
    const s = getStack(cs, sel.stackId);
    const hexes = s && teleportable(cs, side, spell, s) ? teleportHexes(cs, s, spell, ctx.mastery) : [];
    return { mode: 'hex', stackIds: [], anyHex: false, hexes, available: hexes.length > 0 };
  }
  const stackIds = cs.stacks.filter((s) => teleportable(cs, side, spell, s) && teleportHexes(cs, s, spell, ctx.mastery, true).length).map((s) => s.id);
  return { mode: 'friendly_stack', stackIds, anyHex: false, available: stackIds.length > 0, target2: 'hex' };
}

/** Default destination when only a stack is given (AI convenience): closest to the nearest enemy. */
function defaultTeleportHex(cs, stack, hexes) {
  const enemies = cs.stacks.filter((s) => s.alive && controllerOf(s) !== controllerOf(stack));
  if (!enemies.length) return hexes[0] ?? null;
  let best = null;
  let bestD = Infinity;
  for (const h of hexes) {
    const d = Math.min(...enemies.map((e) => stackDistance({ ...stack, pos: h }, e)));
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

function teleportCast(cs, side, spell, ctx, target) {
  const stack = getStack(cs, idOf(target));
  if (!stack || !teleportable(cs, side, spell, stack)) return null;
  const hexes = teleportHexes(cs, stack, spell, ctx.mastery);
  let to = hexOf(target);
  if (!to) to = defaultTeleportHex(cs, stack, hexes);
  if (!to || !hexes.some((h) => sameHex(h, to))) return null;
  const events = [];
  const from = { ...stack.pos };
  stack.pos = { x: to.x, y: to.y };
  events.push(ev('move', { stackId: stack.id, from, to: { ...stack.pos }, path: [{ ...stack.pos }], mode: 'teleport', spellId: spell.id }));
  // traps / fire walls / moat on the destination (none on the way)
  enterHex(cs, stack, stack.pos, events);
  events.push(...releaseBindsOf(cs, stack));
  events.push(...refreshBinds(cs));
  return events;
}

function teleportPreview(cs, side, spell, ctx, hex, sel, t) {
  if (!(sel && typeof sel.stackId === 'number')) return stackPreview(cs, side, spell, ctx, hex, sel, t);
  const s = getStack(cs, sel.stackId);
  if (!s || !hex || !t.hexes.some((h) => sameHex(h, hex))) return { valid: false, hexes: [], stackIds: [] };
  return { valid: true, hexes: stackHexesAt(s, hex), stackIds: [s.id] };
}

// ---- obstacles (§6.5) ---------------------------------------------------------------------------

/** `line` placement: the chosen top hex and the hexes straight below it (mutual neighbours). */
export function lineHexes(top, length) {
  const out = [];
  for (let i = 0; i < length; i++) out.push({ x: top.x, y: top.y + i });
  return out;
}

/** Hex indices a line obstacle may not cover: stacks, blocked hexes, obstacles the caster sees. */
function lineBlockers(cs, side) {
  const set = new Set([...occupancy(cs).keys(), ...blockedHexes(cs)]);
  for (const o of cs.obstacles) if (visibleTo(o, side)) for (const h of o.hexes) set.add(hexIndex(h));
  return set;
}

function lineLegal(cs, side, hexes, blockers = lineBlockers(cs, side)) {
  return hexes.every((h) => inBounds(h) && !blockers.has(hexIndex(h)));
}

/** Free hexes for randomly placed traps: no stack, no blocking obstacle, no obstacle at all. */
function trapCandidates(cs) {
  const occ = occupancy(cs);
  const blocked = blockedHexes(cs);
  const used = new Set();
  for (const o of cs.obstacles) for (const h of o.hexes) used.add(hexIndex(h));
  const free = [];
  for (let i = 0; i < W * H; i++) if (!occ.has(i) && !blocked.has(i) && !used.has(i)) free.push({ x: i % W, y: Math.floor(i / W) });
  return free;
}

/** Pre-target damage of an obstacle, frozen at cast time (§3.1 steps 1-5 + fixed specialties). */
function frozenDamage(spell, ctx) {
  const base = spellValue(spell, ctx.mastery, ctx.power ?? 0) * (ctx.damageMult ?? 1);
  return adjustOf(ctx)('damage', base, null);
}

function obstacleTargets(cs, side, spell, ctx) {
  const eff = spell.effect;
  if (spell.target === 'hex') {
    const len = spell.area.length[ctx.mastery];
    const blockers = lineBlockers(cs, side);
    const hexes = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lineLegal(cs, side, lineHexes({ x, y }, len), blockers)) hexes.push({ x, y });
    return { mode: 'hex', stackIds: [], anyHex: false, hexes, available: hexes.length > 0 };
  }
  return { mode: 'none', stackIds: [], anyHex: false, available: !!eff.count && trapCandidates(cs).length > 0 };
}

function obstacleCast(cs, side, spell, ctx, target) {
  const eff = spell.effect;
  const m = ctx.mastery;
  const events = [];
  const damage = eff.element ? frozenDamage(spell, ctx) : 0;
  if (spell.target === 'hex') {
    const top = hexOf(target);
    if (!top) return null;
    const hexes = lineHexes(top, spell.area.length[m]);
    if (!lineLegal(cs, side, hexes)) return null;
    const rounds = spellDuration(spell, m, Math.max(1, ctx.power ?? 1), 0);
    const res = placeObstacle(cs, {
      kind: eff.kind, hexes, side, rounds: rounds === Infinity ? null : rounds, damage, element: eff.element ?? null,
      blocks: !!eff.blocksMovement, hidden: false, spellId: spell.id,
    });
    for (const e of res.events) e.spellId = spell.id;
    return res.events;
  }
  // quicksand / land mines: count[m] random free hexes, preferably not next to any stack
  const free = trapCandidates(cs);
  if (!free.length) return null;
  const nearStack = new Set();
  for (const s of cs.stacks) if (s.alive) for (const h of stackHexes(s)) for (const n of neighbors(h)) nearStack.add(hexIndex(n));
  const preferred = free.filter((h) => !nearStack.has(hexIndex(h)));
  const rest = free.filter((h) => nearStack.has(hexIndex(h)));
  const n = eff.count[m];
  for (let k = 0; k < n && (preferred.length || rest.length); k++) {
    const pool = preferred.length ? preferred : rest;
    const h = pool.splice(rollInt(cs, 0, pool.length - 1), 1)[0];
    const res = placeObstacle(cs, {
      kind: eff.kind, hexes: [h], side, rounds: null, damage, element: eff.element ?? null,
      blocks: false, hidden: !!eff.hiddenFromEnemy, spellId: spell.id,
    });
    for (const e of res.events) e.spellId = spell.id;
    events.push(...res.events);
  }
  return events;
}

function obstaclePreview(cs, side, spell, ctx, hex, sel, t) {
  if (spell.target !== 'hex') return nonePreview(cs, side, spell, ctx, hex, sel, t);
  if (!hex) return { valid: false, hexes: [], stackIds: [] };
  const hexes = lineHexes(hex, spell.area.length[ctx.mastery]).filter(inBounds);
  return { valid: t.hexes.some((h) => sameHex(h, hex)), hexes, stackIds: [] };
}

/** Obstacles shown to a side (enemy hidden traps are left out) - for the UI. */
export function visibleObstacles(cs, side) {
  return cs.obstacles.filter((o) => visibleTo(o, side));
}

// ---- remove obstacle ----------------------------------------------------------------------------

const SIEGE_KINDS = ['wall', 'gate', 'moat', 'tower', 'keep', 'turret', 'drawbridge'];

function removable(o, side, kinds) {
  if (!visibleTo(o, side) || o.siege || SIEGE_KINDS.includes(o.kind)) return false;
  return kinds.includes(o.magical ? o.kind : 'natural');
}

function removeTargets(cs, side, spell, ctx) {
  const kinds = spell.effect.kinds[ctx.mastery];
  const obstacleIds = cs.obstacles.filter((o) => removable(o, side, kinds)).map((o) => o.id);
  return { mode: 'obstacle', stackIds: [], anyHex: false, obstacleIds, available: obstacleIds.length > 0 };
}

function removeCast(cs, side, spell, ctx, target) {
  const id = idOf(target, 'obstacleId');
  const kinds = spell.effect.kinds[ctx.mastery];
  let o = id !== null ? cs.obstacles.find((x) => x.id === id) : null;
  const hex = hexOf(target);
  if (!o && hex) o = cs.obstacles.find((x) => removable(x, side, kinds) && x.hexes.some((h) => sameHex(h, hex)));
  if (!o || !removable(o, side, kinds)) return null;
  const events = removeObstacle(cs, o.id);
  for (const e of events) e.spellId = spell.id;
  return events;
}

function removePreview(cs, side, spell, ctx, hex) {
  const kinds = spell.effect.kinds[ctx.mastery];
  const o = hex ? cs.obstacles.find((x) => visibleTo(x, side) && x.hexes.some((h) => sameHex(h, hex))) : null;
  if (!o) return { valid: false, hexes: [], stackIds: [] };
  return { valid: removable(o, side, kinds), hexes: o.hexes.map((h) => ({ ...h })), stackIds: [] };
}

// ---- earthquake (wall_damage) -------------------------------------------------------------------

/**
 * Wall sections / gate Earthquake can hit: intact `cs.siege.walls` and the gate - never towers
 * (spells.md §4 `wall_damage`).
 */
function quakeCandidates(cs) {
  if (!cs.siege) return [];
  const out = [];
  for (const w of cs.siege.walls ?? []) if ((w.hp ?? 0) > 0 && w.kind !== 'tower') out.push({ targetId: w.id, kind: 'wall' });
  const gate = cs.siege.gate;
  if (gate && (gate.hp ?? 0) > 0) out.push({ targetId: gate.id ?? 'gate', kind: 'gate' });
  return out;
}

function quakeTargets(cs, side) {
  // Original rule: only the besieging hero may cast Earthquake.
  const available = !!cs.siege && side === 'attacker' && quakeCandidates(cs).length > 0;
  return { mode: 'none', stackIds: [], anyHex: false, available };
}

/**
 * One Earthquake hit on a structure: the siege module's `damageWall(cs, targetId, amount, source)`
 * (events `wall_damaged` / `wall_destroyed`); fallback: lower `hp` of the wall / gate record.
 */
function quakeHit(cs, cand, amount, events) {
  if (typeof siegeApi.damageWall === 'function') {
    events.push(...siegeApi.damageWall(cs, cand.targetId, amount, 'earthquake'));
    return;
  }
  const rec = cand.kind === 'gate' ? cs.siege.gate : (cs.siege.walls ?? []).find((w) => w.id === cand.targetId);
  if (!rec) return;
  rec.hp = Math.max(0, (rec.hp ?? 0) - amount);
  events.push(ev('wall_damaged', { targetId: cand.targetId, kind: cand.kind, amount, hp: rec.hp, source: 'earthquake' }));
  if (rec.hp <= 0) events.push(ev('wall_destroyed', { targetId: cand.targetId, kind: cand.kind, source: 'earthquake' }));
}

function quakeCast(cs, side, spell, ctx) {
  if (!quakeTargets(cs, side).available) return null;
  const events = [];
  for (let k = 0; k < spell.effect.hits[ctx.mastery]; k++) {
    const cands = quakeCandidates(cs);
    if (!cands.length) break;
    quakeHit(cs, rollPick(cs, cands), spell.effect.damagePerHit, events);
  }
  return events;
}

// ---- sacrifice (§9.4) ---------------------------------------------------------------------------

function raisable(cs, side, spell, s) {
  return s.side === side && !s.clone && !s.summoned && !s.warMachine && canResurrect(cs, s)
    && canSpellAffect(cs, spell.id, s, side, { allowDead: true });
}

function victimOk(cs, side, spell, s, raisedId) {
  if (!s.alive || s.id === raisedId || s.side !== side || controllerOf(s) !== side) return false;
  if (s.warMachine || s.clone || s.summoned || !isLiving(s)) return false;
  if ((spell.effect.victimImmune ?? []).some((t) => tagsOf(s).includes(t))) return false;
  return canSpellAffect(cs, spell.id, s, side);
}

const victimsFor = (cs, side, spell, raisedId) => cs.stacks.filter((s) => victimOk(cs, side, spell, s, raisedId));

function sacrificeTargets(cs, side, spell, ctx, sel = {}) {
  if (sel && typeof sel.stackId === 'number') {
    const r = getStack(cs, sel.stackId);
    const stackIds = r && raisable(cs, side, spell, r) ? victimsFor(cs, side, spell, r.id).map((s) => s.id) : [];
    return { mode: 'friendly_stack', stackIds, anyHex: false, available: stackIds.length > 0 };
  }
  const stackIds = cs.stacks.filter((s) => raisable(cs, side, spell, s) && victimsFor(cs, side, spell, s.id).length).map((s) => s.id);
  return { mode: 'dead_friendly_stack', stackIds, anyHex: false, available: stackIds.length > 0, target2: 'friendly_stack' };
}

/** Hit points Sacrifice restores: `(SP + victim max hp + power[m]) x victim count` (+ specialty). */
export function sacrificeHp(spell, ctx, victim, raised) {
  const raw = ((ctx.power ?? 0) + victim.maxHp + spell.power[ctx.mastery]) * victim.count;
  return adjustOf(ctx)('heal', raw, raised);
}

function sacrificeCast(cs, side, spell, ctx, target) {
  const raised = getStack(cs, idOf(target));
  if (!raised || !raisable(cs, side, spell, raised)) return null;
  const victims = victimsFor(cs, side, spell, raised.id);
  let victim = null;
  const vid = idOf(target, 'victimId');
  if (vid !== null) victim = victims.find((s) => s.id === vid) ?? null;
  else victim = victims.sort((a, b) => getCreature(a.creatureId).aiValue * a.count - getCreature(b.creatureId).aiValue * b.count || a.id - b.id)[0] ?? null;
  if (!victim) return null;
  const hp = sacrificeHp(spell, ctx, victim, raised);
  const events = [ev('ability', { stackId: victim.id, ability: 'sacrificed', targetId: raised.id, spellId: spell.id })];
  events.push(...killStack(cs, victim, { kind: 'sacrifice', noCorpse: true }));
  const res = resurrectStack(cs, raised, hp, { permanent: !!spell.effect.permanent });
  for (const e of res) { e.spellId = spell.id; e.victimId = victim.id; }
  events.push(...res);
  return events;
}

function sacrificePreview(cs, side, spell, ctx, hex, sel, t) {
  const s = hex ? cs.stacks.find((x) => stackHexes(x).some((h) => sameHex(h, hex)) && t.stackIds.includes(x.id)) : null;
  if (!s) return { valid: false, hexes: [], stackIds: [] };
  return { valid: true, hexes: stackHexes(s), stackIds: [s.id] };
}

