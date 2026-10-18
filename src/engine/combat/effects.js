// Status-effect system and every primitive that changes a stack outside the attack formula:
// applying / expiring / dispelling spell effects, spell damage, plain damage with death handling
// (rebirth, explosions, hero "second life" bonuses), healing, resurrection, summoning, obstacles.
//
// An ActiveEffect on `stack.effects` is
//   { spellId, mastery, value, roundsLeft: number|null, turnBased: bool, casterSide,
//     sourceStackId: number|null, state: {...} }
// and is always interpreted through the spell record `getSpell(spellId).effect`
// (docs/mechanics/spells.md §4), so every spell whose effect is a status works without new code.
//
// Convention: functions return the ordered list of events they produced.
import { getCreature } from '../../data/creatures.js';
import { getSpell, spellAffectsTags, spellValue, spellDuration, spellSchools, vulnerabilityMultiplier } from '../../data/spells.js';
import { W, H, hexIndex, hexDistance, stackHexes, stackHexesAt, stacksAdjacent, hexSetDistance } from './hex.js';
import {
  rollChance, rollPick, roll, otherSide, anyBonus, findBonuses, sumBonus, bonusesOf, baseTags, makeStack,
  canStandAt, occupancy, blockedHexes, edgePos, getStack,
} from './state.js';
import {
  abilityOf, hasAb, tagsOf, totalHp, effectParts, partsOfType, controlOf, controllerOf, magicResistanceOf, isLiving,
} from './stats.js';

export const ev = (type, data = {}) => ({ type, ...data });

/** Effect types that live on the stack as an ActiveEffect. */
export const STATUS_TYPES = [
  'stat_mod', 'speed_mod', 'damage_mode', 'damage_reduction', 'damage_shield', 'max_hp_mod', 'extra_retaliation',
  'frenzy', 'slayer', 'spell_immunity', 'spell_reflect', 'control', 'damage_over_time', 'heal_over_time',
];
/** Effect types `applySpellToStack` resolves on its own (statuses + these instant ones). */
export const STACK_EFFECT_TYPES = [...STATUS_TYPES, 'damage', 'heal', 'resurrect', 'dispel', 'multi'];

const HARD_CONTROLS = ['blind', 'paralyze', 'stone', 'hypnotize', 'berserk'];
const OPPOSITES = {
  haste: 'slow', slow: 'haste', bless: 'curse', curse: 'bless', mirth: 'sorrow', sorrow: 'mirth',
  fortune: 'misfortune', misfortune: 'fortune',
};
/** Creature-only effects that respect `spell_level_immunity` by their level (creatures.md §4.3). */
const LEVEL_CHECKED_CREATURE_SPELLS = ['petrify', 'paralyze', 'thunderbolt'];
const ELEMENT_SCHOOL = { fire: 'fire', cold: 'water', lightning: 'air', earth: 'earth' };

const partsOfSpell = (spell) => (spell.effect.type === 'multi' ? spell.effect.effects : [spell.effect]);

// ---------------------------------------------------------------------------------------------
// Max hp bookkeeping (aging, poison)
// ---------------------------------------------------------------------------------------------

/** Recompute `stack.maxHp` from base hp, Aging-like effects and accumulated poison; clamp hp. */
export function recomputeMaxHp(stack) {
  let hp = stack.baseHp;
  for (const p of partsOfType(stack, 'max_hp_mod')) {
    if (!p.perRound) hp = Math.max(1, Math.ceil((hp * (100 + p.sign * p.value)) / 100 - 1e-9));
  }
  if (stack.poisonLoss > 0) hp = Math.max(1, hp - Math.floor((stack.baseHp * stack.poisonLoss) / 100));
  stack.maxHp = hp;
  if (stack.hp > hp) stack.hp = hp;
}

function poisonTick(stack, part) {
  const cap = 100 - (part.floorPercent ?? 50);
  stack.poisonLoss = Math.min(cap, stack.poisonLoss + part.value);
  recomputeMaxHp(stack);
}

// ---------------------------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------------------------

/**
 * Remove active effects. `which` is a spell id or a predicate `(eff) => bool`.
 * @returns {Object[]} `status_removed` events
 */
export function removeStatus(cs, stack, which, reason = 'removed') {
  const pred = typeof which === 'function' ? which : (e) => e.spellId === which;
  const events = [];
  const keep = [];
  for (const eff of stack.effects) {
    if (pred(eff)) events.push(ev('status_removed', { stackId: stack.id, spellId: eff.spellId, reason }));
    else keep.push(eff);
  }
  if (events.length) {
    stack.effects = keep;
    recomputeMaxHp(stack);
  }
  return events;
}

/**
 * Put a spell's status on a stack (no immunity / resistance checks - see applySpellToStack).
 * Handles replace-vs-stack, opposite cancelling, control precedence and Anti-Magic's wipe.
 * @param {{mastery?: number, value?: number, rounds?: number|null, casterSide: string,
 *          sourceStackId?: number|null, state?: Object}} opts  `rounds: null` = whole battle
 */
export function addStatus(cs, target, spellId, opts = {}) {
  const spell = getSpell(spellId);
  const mastery = opts.mastery ?? 0;
  const parts = partsOfSpell(spell);
  const events = [];
  const opposite = OPPOSITES[spellId];
  if (opposite) events.push(...removeStatus(cs, target, opposite, 'cancelled'));
  const control = parts.find((p) => p.type === 'control');
  if (control && HARD_CONTROLS.includes(control.kind)) {
    events.push(...removeStatus(cs, target, (e) => e.spellId !== spellId
      && effectParts(e).some((p) => p.type === 'control' && HARD_CONTROLS.includes(p.kind)), 'replaced'));
  }
  if (parts.some((p) => p.type === 'spell_immunity' && p.removesExisting)) {
    events.push(...removeStatus(cs, target, (e) => e.spellId !== spellId && getSpell(e.spellId).duration !== 'battle', 'dispelled'));
  }
  const stacking = parts.some((p) => p.stacking);
  if (!stacking) target.effects = target.effects.filter((e) => e.spellId !== spellId);
  let rounds = opts.rounds;
  if (rounds === undefined) rounds = spellDuration(spell, mastery, 1);
  if (rounds === Infinity) rounds = null;
  // Effects that must survive until the stack has had its turn (spells.md §2.5).
  const turnBased = parts.some((p) => p.type === 'frenzy'
    || (p.type === 'control' && (p.kind === 'berserk' || p.kind === 'fear' || (p.kind === 'paralyze' && rounds === 1))));
  const eff = {
    spellId, mastery,
    value: opts.value ?? spell.power[mastery],
    roundsLeft: rounds,
    turnBased,
    casterSide: opts.casterSide ?? null,
    sourceStackId: opts.sourceStackId ?? null,
    state: { ...(opts.state ?? {}) },
  };
  target.effects.push(eff);
  const poison = effectParts(eff).find((p) => p.type === 'max_hp_mod' && p.perRound);
  if (poison) {
    eff.state.ticksLeft = (rounds ?? 1) - 1;
    poisonTick(target, poison);
  }
  recomputeMaxHp(target);
  events.push(ev('status_added', { stackId: target.id, spellId, mastery, value: eff.value, rounds, casterSide: eff.casterSide }));
  return events;
}

/** Remove dispellable effects: `which` = 'all' | 'positive' | 'negative'. Cure also clears poison. */
export function dispelStack(cs, stack, which = 'all') {
  const events = removeStatus(cs, stack, (e) => {
    const spell = getSpell(e.spellId);
    return spell.dispellable && (which === 'all' || spell.alignment === which);
  }, 'dispelled');
  if (which !== 'positive' && stack.poisonLoss > 0) {
    stack.poisonLoss = 0;
    recomputeMaxHp(stack);
  }
  return events;
}

/** Drop `whileAdjacent` binds whose binder is dead or no longer next to the bound stack. */
export function refreshBinds(cs) {
  const events = [];
  for (const s of cs.stacks) {
    if (!s.alive || !s.effects.length) continue;
    events.push(...removeStatus(cs, s, (e) => {
      const bind = effectParts(e).find((p) => p.type === 'control' && p.kind === 'bind' && p.whileAdjacent);
      if (!bind) return false;
      const src = getStack(cs, e.sourceStackId);
      return !src || !src.alive || !stacksAdjacent(src, s);
    }, 'bond_broken'));
  }
  return events;
}

/** The binder moved: every bond it holds breaks. */
export function releaseBindsOf(cs, binder) {
  const events = [];
  for (const s of cs.stacks) {
    if (!s.alive) continue;
    events.push(...removeStatus(cs, s, (e) => e.sourceStackId === binder.id
      && effectParts(e).some((p) => p.type === 'control' && p.kind === 'bind' && p.whileAdjacent), 'bond_broken'));
  }
  return events;
}

/** End of the stack's own turn: turn-based effects (Frenzy, Berserk, Thunderclap) end. */
export function endTurnEffects(cs, stack) {
  if (!stack.alive) return [];
  return removeStatus(cs, stack, (e) => e.turnBased, 'expired');
}

/** Effects that end when the stack takes damage (Blind, Paralyze, Stone Gaze). */
export function breakOnDamage(cs, stack) {
  if (!stack.alive) return [];
  return removeStatus(cs, stack, (e) => effectParts(e).some((p) => p.type === 'control' && p.breakOnDamage), 'damaged');
}

/** Start of a round (2+): durations tick down, expired effects go, over-time effects fire. */
export function tickRoundStart(cs) {
  const events = [];
  for (const stack of cs.stacks) {
    if (!stack.alive) continue;
    for (const eff of stack.effects) if (eff.roundsLeft !== null && !eff.turnBased) eff.roundsLeft -= 1;
    events.push(...removeStatus(cs, stack, (e) => e.roundsLeft !== null && !e.turnBased && e.roundsLeft <= 0, 'expired'));
    for (const eff of [...stack.effects]) {
      if (!stack.alive) break;
      for (const p of effectParts(eff)) {
        if (p.type === 'damage_over_time') {
          events.push(...dealSpellDamage(cs, stack, eff.state.damage ?? 0, { spellId: eff.spellId, element: p.element, casterSide: eff.casterSide }));
        } else if (p.type === 'heal_over_time') {
          events.push(...healStack(cs, stack, eff.state.heal ?? 0));
        } else if (p.type === 'max_hp_mod' && p.perRound && eff.state.ticksLeft > 0) {
          eff.state.ticksLeft -= 1;
          poisonTick(stack, p);
          events.push(ev('poison_tick', { stackId: stack.id, maxHp: stack.maxHp }));
        }
      }
    }
  }
  // magical obstacles with a duration
  for (const o of [...cs.obstacles]) {
    if (o.roundsLeft === null || o.roundsLeft === undefined) continue;
    o.roundsLeft -= 1;
    if (o.roundsLeft <= 0) events.push(...removeObstacle(cs, o.id));
  }
  return events;
}

// ---------------------------------------------------------------------------------------------
// Immunity pipeline (spells.md §5 steps 1-4)
// ---------------------------------------------------------------------------------------------

function artifactImmune(cs, spell, target) {
  for (const side of ['attacker', 'defender']) {
    for (const b of findBonuses(cs, side, 'spell_immunity')) {
      if ((b.side ?? 'own') !== 'both' && side !== target.side) continue;
      if (b.spellId !== undefined) { if (b.spellId === spell.id) return true; continue; }
      if (b.school !== undefined) { if (spell.school === b.school) return true; continue; }
      if (b.maxLevel !== undefined && spell.level <= b.maxLevel) return true;
    }
  }
  return false;
}

/**
 * Deterministic part of "can this spell do anything to this stack" (tags, creature immunities,
 * Anti-Magic, artifact immunities, invulnerability). Resistance and Magic Mirror are rolls and
 * happen in applySpellToStack.
 * @param {{allowDead?: boolean, ignoreAntiMagic?: boolean}} [opts]
 */
export function canSpellAffect(cs, spellId, target, casterSide, opts = {}) { // eslint-disable-line no-unused-vars
  const spell = getSpell(spellId);
  if (!target.alive && !opts.allowDead) return false;
  if (target.invulnerable) return false;
  const isDispel = spell.effect.type === 'dispel';
  if (!spellAffectsTags(spell, tagsOf(target))) return false;
  if (target.clone && ['resurrect', 'sacrifice', 'clone'].includes(spell.effect.type)) return false;
  if (!isDispel && !anyBonus(cs, 'negate_resistance')) {
    const lvl = abilityOf(target, 'spell_level_immunity');
    if (lvl) {
      if (!spell.creatureOnly || LEVEL_CHECKED_CREATURE_SPELLS.includes(spell.id)) {
        if (spell.level <= lvl.maxLevel) return false;
      } else if (lvl.maxLevel >= 5 && ['damage', 'control', 'debuff'].includes(spell.category)) return false;
    }
  }
  if (!isDispel) {
    for (const ab of getCreature(target.creatureId).abilities) {
      if (ab.id === 'spell_immunity' && ab.spells.includes(spell.id)) return false;
      if (ab.id === 'school_immunity' && spell.school === ab.school) return false;
    }
  }
  // Anti-Magic
  if (!opts.ignoreAntiMagic && (!spell.creatureOnly || spell.id === 'thunderbolt' || spell.id === 'dispel_helpful')) {
    for (const p of partsOfType(target, 'spell_immunity')) {
      if (spell.level <= p.maxLevel[p.eff.mastery]) return false;
    }
  }
  if (artifactImmune(cs, spell, target)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Damage, death
// ---------------------------------------------------------------------------------------------

function handleDeath(cs, target, info, events) {
  const real = !target.clone && !target.summoned && !target.warMachine;
  if (!info.final) {
    const rebirth = abilityOf(target, 'rebirth');
    let risen = 0;
    if (rebirth && !target.rebirthUsed && !target.clone) {
      // Original: floor(startCount x 20%) phoenixes are reborn, plus each of the remaining
      // `startCount mod 5` with a 20% chance; zero is possible (no minimum). Once per battle.
      target.rebirthUsed = true;
      risen = Math.floor((target.startCount * rebirth.percent) / 100);
      const extra = Math.round(target.startCount - (risen * 100) / rebirth.percent);
      for (let i = 0; i < extra; i++) if (rollChance(cs, rebirth.percent, 'rebirth')) risen += 1;
    }
    if (risen > 0) {
      target.count = risen;
      target.hp = target.maxHp;
      target.effects = [];
      target.poisonLoss = 0;
      recomputeMaxHp(target);
      target.hp = target.maxHp;
      events.push(ev('rebirth', { stackId: target.id, count: risen }));
      return false;
    }
    const fallen = findBonuses(cs, target.side, 'resurrect_fallen')[0];
    if (fallen && real && !anyBonus(cs, 'no_resurrection') && cs.sides[target.side].resurrectFallenUsed < (fallen.uses ?? 1)) {
      cs.sides[target.side].resurrectFallenUsed += 1;
      target.count = Math.max(1, Math.ceil((target.startCount * fallen.percent) / 100));
      target.effects = [];
      target.poisonLoss = 0;
      recomputeMaxHp(target);
      target.hp = target.maxHp;
      events.push(ev('resurrect', { stackId: target.id, raised: target.count, healed: 0, permanent: true, source: 'resurrect_fallen' }));
      return false;
    }
  }
  target.alive = false;
  target.count = 0;
  target.hp = 0;
  target.effects = [];
  target.poisonLoss = 0;
  target.defending = false;
  target.invulnerable = false;
  target.inMoat = false;
  recomputeMaxHp(target);
  if (target.clone || target.summoned) target.corpseUsed = true; // leaves no corpse
  events.push(ev('death', { stackId: target.id, side: target.side, creatureId: target.creatureId }));
  if (cs.active === target.id) cs.active = null;
  events.push(...refreshBinds(cs));
  // Horn of the Abyss style: the killer's hero raises a stack from a destroyed living stack.
  if (real && !info.final && isLiving(target)) {
    const foe = otherSide(target.side);
    const b = findBonuses(cs, foe, 'raise_on_kill')[0];
    if (b && !(b.except ?? []).some((t) => baseTags(target.creatureId).includes(t)) && !anyBonus(cs, 'no_resurrection')) {
      const count = Math.max(1, Math.floor((target.startCount * target.baseHp) / getCreature(b.creatureId).hp));
      events.push(...summonStack(cs, foe, b.creatureId, count, target.pos, { summoned: false, joinsAfter: true }).events);
    }
  }
  return true;
}

/**
 * Take hit points from a stack: kills creatures, handles clones, invulnerability, explosions and
 * death (rebirth etc.). Pushes `damage` / `death` / ... events onto `events`.
 * @param {{kind?: string, sourceStackId?: number|null, spellId?: string, final?: boolean}} info
 * @returns {{dealt: number, killed: number, died: boolean}}
 */
export function applyDamage(cs, target, amount, info = {}, events = []) {
  if (!target.alive || amount <= 0) return { dealt: 0, killed: 0, died: false };
  if (target.invulnerable && !info.final) {
    events.push(ev('damage', { stackId: target.id, amount: 0, dealt: 0, killed: 0, remaining: target.count, blocked: true, kind: info.kind ?? 'attack' }));
    return { dealt: 0, killed: 0, died: false };
  }
  const before = totalHp(target);
  const dealt = target.clone ? before : Math.min(amount, before);
  const left = before - dealt;
  const oldCount = target.count;
  const newCount = Math.ceil(left / target.maxHp);
  const killed = oldCount - newCount;
  target.count = newCount;
  target.hp = newCount > 0 ? left - (newCount - 1) * target.maxHp : 0;
  events.push(ev('damage', {
    stackId: target.id, amount, dealt, killed, remaining: newCount, kind: info.kind ?? 'attack',
    sourceStackId: info.sourceStackId ?? null, spellId: info.spellId ?? null,
  }));
  let died = false;
  if (newCount <= 0) died = handleDeath(cs, target, info, events);
  const boom = abilityOf(target, 'explode_on_death');
  if (boom && killed > 0 && !info.final) {
    const hexes = stackHexes(target);
    const victims = cs.stacks.filter((s) => s.alive && s.id !== target.id && !hasAb(s, 'explode_on_death')
      && hexSetDistance(stackHexes(s), hexes) === 1);
    if (victims.length) events.push(ev('explode', { stackId: target.id, killed }));
    for (const v of victims) applyDamage(cs, v, boom.damagePerCreature * killed, { kind: 'explosion', sourceStackId: target.id }, events);
  }
  return { dealt, killed, died };
}

/** Destroy a stack outright (Sacrifice victim, expired clone): no rebirth, no second life. */
export function killStack(cs, stack, opts = {}) {
  const events = [];
  if (!stack.alive) return events;
  applyDamage(cs, stack, totalHp(stack), { kind: opts.kind ?? 'kill', final: true }, events);
  if (opts.noCorpse) stack.corpseUsed = true;
  return events;
}

/**
 * Spell(-like) damage: immunity, elemental vulnerability x2, Protection from <school>, golem
 * reduction, petrification, optional chain factor; floor, minimum 1. Ignores Attack/Defense.
 * @param {{element?: string|null, spellId?: string, casterSide?: string, sourceStackId?: number,
 *          factor?: number, ignoreImmunity?: boolean}} opts
 */
export function dealSpellDamage(cs, target, amount, opts = {}) {
  const events = [];
  if (!target.alive || amount <= 0) return events;
  const spell = opts.spellId ? getSpell(opts.spellId) : null;
  const tags = tagsOf(target);
  const element = opts.element ?? null;
  if (!opts.ignoreImmunity) {
    const immune = spell ? !canSpellAffect(cs, spell.id, target, opts.casterSide)
      : (target.invulnerable || (element && tags.includes(`${element}_immune`)));
    if (immune) {
      events.push(ev('spell_immune', { stackId: target.id, spellId: opts.spellId ?? null }));
      return events;
    }
  }
  let dmg = amount;
  // a. vulnerability (at most x2 / the ability's percent, never both)
  const vulnAb = spell ? getCreature(target.creatureId).abilities.find((a) => a.id === 'spell_vulnerability' && a.spells.includes(spell.id)) : null;
  if ((spell && vulnerabilityMultiplier(spell, tags) === 2) || (element && tags.includes(`${element}_vulnerable`))) dmg *= 2;
  else if (vulnAb) dmg *= 1 + vulnAb.percent / 100;
  // b. Protection from <school>
  const schools = spell ? spellSchools(spell) : (element ? [ELEMENT_SCHOOL[element]] : []);
  const prots = partsOfType(target, 'damage_reduction').filter((p) => p.against === 'spell_school' && schools.includes(p.school));
  if (prots.length) {
    if (spell && spell.school === 'all') dmg *= 1 - Math.max(...prots.map((p) => p.value)) / 100;
    else for (const p of prots) dmg *= 1 - p.value / 100;
  }
  // c. golems
  const golem = abilityOf(target, 'spell_damage_reduction');
  if (golem && !anyBonus(cs, 'negate_resistance')) dmg *= (100 - golem.percent) / 100;
  // d. chain factor
  if (opts.factor !== undefined) dmg *= opts.factor;
  // e. petrified
  const stone = controlOf(target, 'stone');
  if (stone) dmg *= (stone.damageTakenPercent ?? 50) / 100;
  dmg = Math.max(1, Math.floor(dmg + 1e-9));
  applyDamage(cs, target, dmg, { kind: 'spell', spellId: opts.spellId ?? null, sourceStackId: opts.sourceStackId ?? null }, events);
  events.push(...breakOnDamage(cs, target));
  return events;
}

// ---------------------------------------------------------------------------------------------
// Healing, resurrection, summoning
// ---------------------------------------------------------------------------------------------

/** Heal the top creature only (never raises the count). */
export function healStack(cs, stack, hp) {
  if (!stack.alive || hp <= 0) return [];
  const healed = Math.min(Math.floor(hp), stack.maxHp - stack.hp);
  if (healed <= 0) return [];
  stack.hp += healed;
  return [ev('heal', { stackId: stack.id, amount: healed })];
}

/** True when `resurrectStack` could restore anything to this stack. */
export function canResurrect(cs, stack, maxCount = stack.startCount) {
  if (anyBonus(cs, 'no_resurrection')) return false;
  if (!stack.alive) return !stack.corpseUsed && maxCount > 0 && canStandAt(cs, stack, stack.pos);
  return totalHp(stack) < maxCount * stack.maxHp;
}

/**
 * Add `hp` to the stack's hit point pool: heals the top creature, then raises whole creatures (the
 * last one possibly wounded), never above `maxCount` (default: the starting count). Works on a
 * fully dead stack whose hexes are free.
 * @param {{permanent?: boolean, maxCount?: number}} opts  non-permanent raises vanish after battle
 */
export function resurrectStack(cs, stack, hp, opts = {}) {
  const maxCount = opts.maxCount ?? stack.startCount;
  if (hp <= 0 || !canResurrect(cs, stack, maxCount)) return [];
  const wasDead = !stack.alive;
  if (wasDead) {
    stack.alive = true;
    stack.count = 0;
    stack.hp = 0;
    stack.effects = [];
    recomputeMaxHp(stack);
  }
  const before = wasDead ? 0 : totalHp(stack);
  const oldCount = stack.count;
  const after = Math.min(maxCount * stack.maxHp, before + Math.floor(hp));
  stack.count = Math.ceil(after / stack.maxHp);
  stack.hp = after - (stack.count - 1) * stack.maxHp;
  const raised = stack.count - oldCount;
  if (opts.permanent === false) stack.tempRaised += raised;
  return [ev('resurrect', { stackId: stack.id, raised, healed: after - before, permanent: opts.permanent !== false, wasDead })];
}

/** Closest head position to `near` where the stack fits, or null. */
export function nearestFreePos(cs, stack, near) {
  const occ = occupancy(cs, stack.id);
  const blocked = blockedHexes(cs);
  let best = null;
  let bestD = Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pos = { x, y };
      if (!canStandAt(cs, stack, pos, occ, blocked)) continue;
      const d = hexDistance(pos, near);
      if (d < bestD) { bestD = d; best = pos; }
    }
  }
  return best;
}

/**
 * Create a new stack on the battlefield.
 * Without `hex`: first free spot scanning from the side's back column, middle rows first.
 * @param {{summoned?: boolean, clone?: boolean, joinsAfter?: boolean, cloneRoundsLeft?: number}} opts
 *        default `summoned: true` (vanishes after the battle)
 * @returns {{stack: Object|null, events: Object[]}}
 */
export function summonStack(cs, side, creatureId, count, hex = null, opts = {}) {
  const stack = makeStack(cs, side, creatureId, count, { x: 0, y: 0 }, { summoned: opts.summoned !== false && !opts.clone, ...opts });
  const occ = occupancy(cs);
  const blocked = blockedHexes(cs);
  let pos = null;
  if (hex) {
    pos = canStandAt(cs, stack, hex, occ, blocked) ? { x: hex.x, y: hex.y } : nearestFreePos(cs, stack, hex);
  } else {
    const rows = [5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10];
    outer: for (let col = 0; col < W; col++) {
      for (const row of rows) {
        const base = edgePos(side, stack.size, row);
        const p = { x: base.x + (side === 'attacker' ? col : -col), y: row };
        if (canStandAt(cs, stack, p, occ, blocked)) { pos = p; break outer; }
      }
    }
  }
  if (!pos) {
    cs.nextStackId -= 1;
    return { stack: null, events: [] };
  }
  stack.pos = pos;
  stack.acted = true; // acts from the next round
  cs.stacks.push(stack);
  return { stack, events: [ev('summon', { stackId: stack.id, side, creatureId, count, pos: { ...pos }, clone: stack.clone, summoned: stack.summoned })] };
}

// ---------------------------------------------------------------------------------------------
// Obstacles
// ---------------------------------------------------------------------------------------------

/**
 * Add an obstacle. `def`: { kind, hexes, blocks?, magical?, side?, rounds?, damage?, element?,
 * hidden?, spellId?, mastery? }. Natural obstacles and Force Field block movement; Quicksand,
 * Land Mine and Fire Wall are handled when a walker enters the hex (actions.js).
 * @returns {{obstacle: Object, events: Object[]}}
 */
export function placeObstacle(cs, def) {
  const obstacle = {
    id: cs.nextObstacleId++,
    kind: def.kind,
    hexes: def.hexes.map((h) => ({ x: h.x, y: h.y })),
    blocks: def.blocks ?? !['quicksand', 'land_mine', 'fire_wall'].includes(def.kind),
    magical: def.magical ?? ['quicksand', 'land_mine', 'fire_wall', 'force_field'].includes(def.kind),
    side: def.side ?? null,
    roundsLeft: def.rounds ?? null,
    damage: def.damage ?? 0,
    element: def.element ?? null,
    hidden: !!def.hidden,
    spellId: def.spellId ?? null,
  };
  cs.obstacles.push(obstacle);
  return { obstacle, events: [ev('obstacle_added', { obstacleId: obstacle.id, kind: obstacle.kind, hexes: obstacle.hexes, side: obstacle.side, hidden: obstacle.hidden })] };
}

export function removeObstacle(cs, id) {
  const i = cs.obstacles.findIndex((o) => o.id === id);
  if (i < 0) return [];
  const [o] = cs.obstacles.splice(i, 1);
  return [ev('obstacle_removed', { obstacleId: o.id, kind: o.kind })];
}

export function obstaclesAt(cs, hex) {
  const i = hexIndex(hex);
  return cs.obstacles.filter((o) => o.hexes.some((h) => hexIndex(h) === i));
}

// ---------------------------------------------------------------------------------------------
// One spell on one stack
// ---------------------------------------------------------------------------------------------

function mirrorChance(cs, target) {
  let pct = 0;
  const ab = abilityOf(target, 'magic_mirror');
  if (ab && !anyBonus(cs, 'negate_resistance')) pct = Math.max(pct, ab.chance);
  for (const p of partsOfType(target, 'spell_reflect')) pct = Math.max(pct, p.value);
  pct = Math.max(pct, sumBonus(cs, target.side, 'spell_reflection', null, 'percent'));
  return pct;
}

function applyEffectPart(cs, spell, part, opts, target, events) {
  const m = opts.mastery ?? 0;
  const power = opts.power ?? 0;
  const source = opts.sourceStackId != null ? getStack(cs, opts.sourceStackId) : null;
  switch (part.type) {
    case 'damage': {
      if (part.useAttackDamage && opts.damage === undefined) return;
      if (part.chance !== undefined && !rollChance(cs, part.chance, `spell:${spell.id}`)) return;
      let dmg = opts.damage;
      if (dmg === undefined || part.chance !== undefined) {
        dmg = Array.isArray(part.value) ? part.value[m] : spellValue(spell, m, power);
        if (part.perAttacker && source) dmg *= source.count;
      }
      events.push(...dealSpellDamage(cs, target, dmg, {
        element: part.element, spellId: spell.id, casterSide: opts.casterSide, sourceStackId: opts.sourceStackId,
        factor: opts.factor, ignoreImmunity: true,
      }));
      return;
    }
    case 'heal':
      events.push(...healStack(cs, target, opts.heal ?? spellValue(spell, m, power)));
      return;
    case 'resurrect':
      events.push(...resurrectStack(cs, target, opts.heal ?? spellValue(spell, m, power), { permanent: !!part.permanent[m] }));
      return;
    case 'dispel':
      events.push(...dispelStack(cs, target, part.which));
      return;
    default:
  }
}

/**
 * Resolve one spell against one stack: immunity (steps 1-4), Magic Mirror, magic resistance,
 * then the effect itself (status, damage, heal, resurrect, dispel, or any `multi` of those).
 *
 * @param {Object} cs
 * @param {string} spellId
 * @param {Object} opts
 * @param {number} [opts.mastery] 0..3
 * @param {number} [opts.power] effective spell power (value and 'power' durations)
 * @param {string} opts.casterSide
 * @param {number} [opts.sourceStackId] casting / attacking creature stack
 * @param {number} [opts.duration] rounds override (creature casts)
 * @param {number} [opts.extraDuration] `spell_duration` bonus for 'power' durations
 * @param {number} [opts.value] status value override (ability params)
 * @param {number} [opts.damage] pre-computed damage (hero multipliers already applied)
 * @param {number} [opts.heal] pre-computed heal / resurrection hp
 * @param {number} [opts.factor] chain factor for damage
 * @param {boolean} [opts.resistible] default: spell.resistible && !spell.creatureOnly
 * @param {boolean} [opts.allowMirror] single-target hostile casts only
 * @param {boolean} [opts.ignoreAntiMagic] expert Dispel
 * @param {Object} target stack
 * @returns {Object[]} events (`spell_immune`, `spell_resisted`, `spell_reflected`, `status_added`, ...)
 */
export function applySpellToStack(cs, spellId, opts, target) {
  const spell = getSpell(spellId);
  const events = [];
  const allowDead = spell.target === 'dead_friendly_stack';
  if (!canSpellAffect(cs, spellId, target, opts.casterSide, { allowDead, ignoreAntiMagic: opts.ignoreAntiMagic })) {
    events.push(ev('spell_immune', { stackId: target.id, spellId }));
    return events;
  }
  const hostile = controllerOf(target) !== opts.casterSide;
  const resistible = opts.resistible ?? (spell.resistible && !spell.creatureOnly);
  if (resistible && hostile) {
    if (opts.allowMirror && rollChance(cs, mirrorChance(cs, target), 'magic_mirror')) {
      const pool = cs.stacks.filter((s) => s.alive && controllerOf(s) === opts.casterSide && canSpellAffect(cs, spellId, s, opts.casterSide));
      events.push(ev('spell_reflected', { stackId: target.id, spellId, toStackId: null }));
      if (!pool.length) return events;
      const victim = rollPick(cs, pool);
      events[events.length - 1].toStackId = victim.id;
      // the reflected spell is hostile to its new target: caster side flips for that purpose
      events.push(...applySpellToStack(cs, spellId, { ...opts, casterSide: otherSide(opts.casterSide), allowMirror: false }, victim));
      return events;
    }
    if (rollChance(cs, magicResistanceOf(cs, target), 'resist')) {
      events.push(ev('spell_resisted', { stackId: target.id, spellId }));
      return events;
    }
  }
  const m = opts.mastery ?? 0;
  const parts = partsOfSpell(spell);
  if (!parts.every((p) => STACK_EFFECT_TYPES.includes(p.type))) {
    events.push(ev('spell_unsupported', { stackId: target.id, spellId }));
    return events;
  }
  if (parts.some((p) => STATUS_TYPES.includes(p.type))) {
    let rounds = opts.duration;
    if (!rounds) rounds = spellDuration(spell, m, Math.max(1, opts.power ?? 1), opts.extraDuration ?? 0);
    const state = {};
    const dot = parts.find((p) => p.type === 'damage_over_time');
    const hot = parts.find((p) => p.type === 'heal_over_time');
    if (dot) state.damage = opts.damage ?? spellValue(spell, m, opts.power ?? 0);
    if (hot) state.heal = opts.heal ?? spellValue(spell, m, opts.power ?? 0);
    events.push(...addStatus(cs, target, spellId, {
      mastery: m, value: opts.value, rounds, casterSide: opts.casterSide, sourceStackId: opts.sourceStackId, state,
    }));
    if (dot && dot.immediate) {
      events.push(...dealSpellDamage(cs, target, state.damage, { element: dot.element, spellId, casterSide: opts.casterSide, factor: opts.factor, ignoreImmunity: true }));
    }
    if (hot && hot.immediate) events.push(...healStack(cs, target, state.heal));
  }
  for (const part of parts) applyEffectPart(cs, spell, part, opts, target, events);
  return events;
}

export { roll, bonusesOf, stackHexesAt };
