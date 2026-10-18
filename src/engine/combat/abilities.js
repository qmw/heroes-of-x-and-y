// Creature abilities that are not part of the plain damage formula: on-hit effects, reactions to
// a blow (life drain, fire shield, heat stroke, acid), turn-start abilities (regeneration, mana
// drain, Enchanter mass casts, Faerie Dragon spell roll, fear) and activated abilities (creature
// spell casters, resurrection, raise demons, repair, devour corpse, invulnerability).
// Spec: docs/mechanics/creatures.md §3-§4.
import { getCreature } from '../../data/creatures.js';
import { getSpell } from '../../data/spells.js';
import { neighbors, stackHexes, hexSetDistance, stacksAdjacent, hexesInRadius, hexIndex } from './hex.js';
import {
  rollChance, rollPick, otherSide, findBonuses, baseTags, canStandAt, getStack,
} from './state.js';
import {
  creatureOf, abilityOf, hasAb, tagsOf, totalHp, controllerOf, hasEffect, isLiving,
} from './stats.js';
import {
  ev, applyDamage, applySpellToStack, canSpellAffect, dealSpellDamage, addStatus, dispelStack, resurrectStack,
  canResurrect, summonStack,
} from './effects.js';
import { partsOfType } from './stats.js';
import { resolveSpell } from './spells.js';

/** Remove `k` whole creatures: the (possibly wounded) top one first, then full ones. */
export function killCreatures(cs, target, k, info, events) {
  if (k <= 0 || !target.alive) return;
  const n = Math.min(k, target.count);
  applyDamage(cs, target, target.hp + (n - 1) * target.maxHp, info, events);
}

/** Binomial(count, pct) successes, stopping at `cap`. Tag lets tests force the outcome. */
function cappedSuccesses(cs, count, pct, cap, tag) {
  let kills = 0;
  for (let i = 0; i < count && kills < cap; i++) if (rollChance(cs, pct, tag)) kills += 1;
  return kills;
}

function creatureCast(cs, attacker, target, spellId, extra = {}) {
  return applySpellToStack(cs, spellId, {
    casterSide: controllerOf(attacker), sourceStackId: attacker.id, power: 0, resistible: false, ...extra,
  }, target);
}

/**
 * On-hit abilities of `attacker` against the primary target, in the order of the creature's
 * ability list. `timing` 'before' runs before damage, 'after' on the surviving target.
 * @param {{ranged: boolean, retaliation: boolean, timing: 'before'|'after'}} ctx
 */
export function onHitEffects(cs, attacker, target, ctx, events) {
  if (!attacker.alive || !target.alive || target.warMachine) return;
  for (const ab of creatureOf(attacker).abilities) {
    if (!target.alive || !attacker.alive) return;
    if (ab.id === 'cast_on_hit') {
      if (ab.timing !== ctx.timing) continue;
      if (ab.mode === 'melee' && ctx.ranged) continue;
      if (ab.mode === 'retaliation' && !ctx.retaliation) continue;
      if (!rollChance(cs, ab.chance, `cast_on_hit:${ab.spellId}`)) continue;
      if (ab.spellId === 'dispel') {
        // Serpent / Dragon Fly: strips beneficial spells only.
        if (canSpellAffect(cs, 'dispel_helpful', target, controllerOf(attacker))) events.push(...dispelStack(cs, target, 'positive'));
        continue;
      }
      if (ab.spellId === 'hypnotize' && totalHp(target) > attacker.count * 25) continue;
      events.push(...creatureCast(cs, attacker, target, ab.spellId, {
        mastery: ab.mastery, duration: ab.duration || undefined, resistible: true,
      }));
      continue;
    }
    if (ctx.timing !== 'after') continue;
    const side = controllerOf(attacker);
    switch (ab.id) {
      case 'death_stare': {
        if (ctx.ranged || !canSpellAffect(cs, 'death_stare', target, side)) break;
        const kills = cappedSuccesses(cs, attacker.count, ab.percentPerCreature, Math.ceil(attacker.count / 10), 'death_stare');
        if (kills > 0) {
          events.push(ev('ability', { stackId: attacker.id, ability: 'death_stare', targetId: target.id, kills: Math.min(kills, target.count) }));
          killCreatures(cs, target, kills, { kind: 'death_stare', sourceStackId: attacker.id }, events);
        }
        break;
      }
      case 'accurate_shot': {
        if (!ctx.ranged || !isLiving(target) || target.invulnerable) break;
        const cap = Math.ceil((attacker.count * ab.percentPerCreature) / 100);
        const kills = cappedSuccesses(cs, attacker.count, ab.percentPerCreature, cap, 'accurate_shot');
        if (kills > 0) {
          events.push(ev('ability', { stackId: attacker.id, ability: 'accurate_shot', targetId: target.id, kills: Math.min(kills, target.count) }));
          killCreatures(cs, target, kills, { kind: 'accurate_shot', sourceStackId: attacker.id }, events);
        }
        break;
      }
      case 'petrify_attack':
        if (!ctx.ranged && rollChance(cs, ab.chance, 'petrify_attack')) events.push(...creatureCast(cs, attacker, target, 'petrify', { duration: ab.duration }));
        break;
      case 'paralyze_attack':
        if (!tagsOf(target).includes('mind_immune') && rollChance(cs, ab.chance, 'paralyze_attack')) events.push(...creatureCast(cs, attacker, target, 'paralyze', { duration: ab.duration }));
        break;
      case 'disease_attack':
        if (rollChance(cs, ab.chance, 'disease_attack')) events.push(...creatureCast(cs, attacker, target, 'disease', { duration: ab.duration, value: Math.abs(ab.attack) }));
        break;
      case 'aging_attack':
        if (rollChance(cs, ab.chance, 'aging_attack')) events.push(...creatureCast(cs, attacker, target, 'age', { duration: ab.duration, value: ab.hpPercent }));
        break;
      case 'poison_attack':
        if (rollChance(cs, ab.chance, 'poison_attack')) events.push(...creatureCast(cs, attacker, target, 'poison', { duration: ab.duration, value: ab.hpPercentPerRound }));
        break;
      case 'binding':
        if (!ctx.ranged && canSpellAffect(cs, 'bind', target, side)) {
          events.push(...addStatus(cs, target, 'bind', { casterSide: side, sourceStackId: attacker.id, rounds: null }));
        }
        break;
      default:
    }
  }
}

/** Rust Dragon: -defense for the battle on every hit (stacking) and a chance of extra damage. */
export function acidBreath(cs, attacker, target, events) {
  const ab = abilityOf(attacker, 'acid_breath');
  if (!ab || !target.alive || target.warMachine || target.invulnerable) return;
  events.push(...addStatus(cs, target, 'acid_breath', {
    casterSide: controllerOf(attacker), sourceStackId: attacker.id, rounds: null, value: ab.defenseReduction,
  }));
  if (rollChance(cs, ab.chance, 'acid_breath')) {
    events.push(ev('ability', { stackId: attacker.id, ability: 'acid_breath', targetId: target.id }));
    applyDamage(cs, target, ab.damagePerCreature * attacker.count, { kind: 'acid', sourceStackId: attacker.id }, events);
  }
}

/** Thunderbird / Storm Drake: chance of a Lightning Bolt for 10 x count after a melee attack. */
export function lightningStrike(cs, attacker, target, events) {
  const ab = abilityOf(attacker, 'lightning_strike');
  if (!ab || !attacker.alive || !target.alive || target.warMachine) return;
  if (!rollChance(cs, ab.chance, 'lightning_strike')) return;
  events.push(ev('ability', { stackId: attacker.id, ability: 'lightning_strike', targetId: target.id }));
  events.push(...creatureCast(cs, attacker, target, 'thunderbolt', { damage: ab.damagePerCreature * attacker.count, resistible: true }));
}

/** Vampire Lord: heal / resurrect from damage dealt to a living stack (never above start count). */
export function lifeDrain(cs, attacker, target, dealt, events) {
  const ab = abilityOf(attacker, 'life_drain');
  if (!ab || attacker.clone || !attacker.alive || dealt <= 0 || !isLiving(target)) return;
  const res = resurrectStack(cs, attacker, Math.floor((dealt * ab.percent) / 100), { permanent: true });
  for (const e of res) e.source = 'life_drain';
  events.push(...res);
}

/** Fire Shield (Efreet Sultan ability or a `damage_shield` status): melee attackers get burnt. */
export function shieldReturn(cs, attacker, target, dealt, events) {
  if (dealt <= 0 || !attacker.alive) return;
  const sources = [];
  const ab = abilityOf(target, 'fire_shield');
  if (ab) sources.push({ percent: ab.percent, spellId: 'fire_shield', element: 'fire' });
  for (const p of partsOfType(target, 'damage_shield')) sources.push({ percent: p.value, spellId: p.eff.spellId, element: p.element });
  for (const s of sources) {
    const amount = Math.floor((dealt * s.percent) / 100);
    if (amount <= 0 || !attacker.alive) continue;
    // "Counts as the spell": the attacker's immunity to that spell / element blocks it.
    const tags = tagsOf(attacker);
    const lvl = abilityOf(attacker, 'spell_level_immunity');
    if (tags.includes(`${s.element}_immune`) || (lvl && getSpell(s.spellId).level <= lvl.maxLevel) || attacker.invulnerable) continue;
    events.push(...dealSpellDamage(cs, attacker, amount, { element: s.element, casterSide: controllerOf(target), sourceStackId: target.id, kind: 'fire_shield' }));
  }
}

/** Dreadnought / Juggernaut: other enemies around the target take a share of the damage as fire. */
export function heatStroke(cs, attacker, target, dealt, events) {
  const ab = abilityOf(attacker, 'heat_stroke');
  if (!ab || dealt <= 0) return;
  const amount = Math.floor((dealt * ab.percent) / 100);
  if (amount <= 0) return;
  const zone = new Set();
  for (const h of stackHexes(target)) for (const z of hexesInRadius(h, ab.radius)) zone.add(hexIndex(z));
  const side = controllerOf(attacker);
  const victims = cs.stacks.filter((s) => s.alive && s.id !== target.id && s.id !== attacker.id && controllerOf(s) !== side
    && stackHexes(s).some((h) => zone.has(hexIndex(h))));
  if (victims.length) events.push(ev('ability', { stackId: attacker.id, ability: 'heat_stroke', targetId: target.id }));
  for (const v of victims) events.push(...dealSpellDamage(cs, v, amount, { element: 'fire', casterSide: side, sourceStackId: attacker.id }));
}

// ---------------------------------------------------------------------------------------------
// Turn start
// ---------------------------------------------------------------------------------------------

const enemiesOf = (cs, stack) => cs.stacks.filter((s) => s.alive && controllerOf(s) !== controllerOf(stack));
const alliesOf = (cs, stack) => cs.stacks.filter((s) => s.alive && controllerOf(s) === controllerOf(stack));

/** Azure Dragon fear: true when the stack is frozen this turn. */
export function fearCheck(cs, stack) {
  const tags = baseTags(stack.creatureId);
  if (hasAb(stack, 'fear') || tags.includes('undead') || tags.includes('non_living') || stack.warMachine) return false;
  let chance = 0;
  for (const s of enemiesOf(cs, stack)) chance = Math.max(chance, abilityOf(s, 'fear')?.chance ?? 0);
  return rollChance(cs, chance, 'fear');
}

function massCast(cs, stack, ab, events) {
  if ((cs.round - 1) % ab.interval !== 0 || stack.lastMassCast === cs.round || stack.clone) return;
  stack.lastMassCast = cs.round;
  const side = controllerOf(stack);
  const options = [];
  for (const spellId of ab.friendlySpells) {
    if (alliesOf(cs, stack).some((s) => canSpellAffect(cs, spellId, s, side))) options.push({ spellId, mode: 'all_friendly' });
  }
  for (const spellId of ab.enemySpells) {
    if (enemiesOf(cs, stack).some((s) => canSpellAffect(cs, spellId, s, side))) options.push({ spellId, mode: 'all_enemies' });
  }
  if (!options.length) return;
  const pick = rollPick(cs, options);
  events.push(ev('spell', { stackId: stack.id, side, spellId: pick.spellId, mastery: ab.mastery, creature: true, mass: true }));
  events.push(...resolveSpell(cs, pick.spellId, {
    mastery: ab.mastery, power: 0, duration: ab.duration, casterSide: side, sourceStackId: stack.id, mode: pick.mode,
  }));
}

/** Passive abilities that fire when the stack's turn begins. */
export function turnStartAbilities(cs, stack, events) {
  const tags = baseTags(stack.creatureId);
  const regen = hasAb(stack, 'regeneration')
    || findBonuses(cs, stack.side, 'creature_regeneration').some((b) => tags.includes('living') && !(b.except ?? []).some((t) => tags.includes(t)));
  if (regen && stack.hp < stack.maxHp) {
    events.push(ev('heal', { stackId: stack.id, amount: stack.maxHp - stack.hp, source: 'regeneration' }));
    stack.hp = stack.maxHp;
  }
  const drain = abilityOf(stack, 'mana_drain');
  const foeHero = cs.sides[otherSide(controllerOf(stack))].hero;
  if (drain && foeHero && foeHero.mana > 0) {
    const amount = Math.min(drain.value, foeHero.mana);
    foeHero.mana -= amount;
    events.push(ev('mana_drain', { stackId: stack.id, side: otherSide(controllerOf(stack)), amount }));
  }
  const mass = abilityOf(stack, 'mass_caster');
  if (mass) massCast(cs, stack, mass, events);
  const caster = abilityOf(stack, 'spellcaster');
  if (caster && caster.random && caster.target === 'enemy' && !stack.clone) {
    stack.pendingSpell = stack.castsLeft.spellcaster > 0 ? rollPick(cs, caster.spells) : null;
    if (stack.pendingSpell) events.push(ev('spell_ready', { stackId: stack.id, spellId: stack.pendingSpell }));
  }
}

// ---------------------------------------------------------------------------------------------
// Activated abilities
// ---------------------------------------------------------------------------------------------

const MASS_CREATURE_SPELLS = ['mirth']; // Satyr casts the mass version (creatures.md §4.6)

function genieSpells(cs, stack, ab, target) {
  const side = controllerOf(stack);
  return ab.spells.filter((id) => !hasEffect(target, id) && canSpellAffect(cs, id, target, side));
}

/**
 * Pit Lords: demons raised from a corpse. The raised hit points are `50 x pit lords`, capped at the
 * hit points of the dead stack (original / VCMI `DemonSummon`), divided by the Demon's hp.
 */
export function raisedDemons(ab, stack, corpse, demon = getCreature(ab.creatureId)) {
  const pool = Math.min(ab.hpPerCreature * stack.count, corpse.startCount * corpse.baseHp);
  return Math.floor(pool / demon.hp);
}

function corpsesNear(cs, stack) {
  return cs.stacks.filter((s) => !s.alive && !s.corpseUsed && !s.warMachine && isLiving(s)
    && hexSetDistance(stackHexes(stack), stackHexes(s)) === 1);
}

/**
 * Activated abilities the stack may use instead of acting:
 * `[{ ability, spellId, targets: [stackId...], castsLeft }]` (`targets` contains the stack's own
 * id for self-abilities; `spellId` is null when the spell is rolled on use).
 */
export function getAbilityActions(cs, stack) {
  const out = [];
  if (stack.clone || !stack.alive) return out;
  const side = controllerOf(stack);
  const allies = alliesOf(cs, stack);
  for (const ab of creatureOf(stack).abilities) {
    const left = stack.castsLeft[ab.id];
    if (left !== undefined && left <= 0) continue;
    let targets = null;
    let spellId = null;
    switch (ab.id) {
      case 'spellcaster':
        if (ab.target === 'friendly') {
          if (ab.random) targets = allies.filter((s) => genieSpells(cs, stack, ab, s).length > 0);
          else {
            spellId = ab.spells[0];
            targets = allies.filter((s) => canSpellAffect(cs, spellId, s, side) && (MASS_CREATURE_SPELLS.includes(spellId) || !hasEffect(s, spellId)));
          }
        } else {
          spellId = stack.pendingSpell;
          targets = spellId ? enemiesOf(cs, stack).filter((s) => canSpellAffect(cs, spellId, s, side)) : [];
        }
        break;
      case 'resurrection':
        targets = cs.stacks.filter((s) => s.side === stack.side && s.id !== stack.id && isLiving(s) && !s.clone && !s.summoned
          && !s.warMachine && canResurrect(cs, s));
        break;
      case 'raise_demons': {
        const demon = getCreature(ab.creatureId);
        targets = cs.stacks.filter((s) => !s.alive && !s.corpseUsed && s.side === stack.side && isLiving(s) && !s.warMachine
          && s.startCount > 0 && raisedDemons(ab, stack, s, demon) >= 1
          && canStandAt(cs, { size: demon.size, side: stack.side, id: -1 }, s.pos));
        break;
      }
      case 'repair':
        targets = allies.filter((s) => s.id !== stack.id && baseTags(s.creatureId).includes('mechanical') && stacksAdjacent(s, stack) && canResurrect(cs, s));
        break;
      case 'devour_corpse':
        targets = canResurrect(cs, stack) && corpsesNear(cs, stack).length ? corpsesNear(cs, stack) : [];
        break;
      case 'invulnerability':
        targets = [stack];
        break;
      default:
        continue;
    }
    if (targets && targets.length) out.push({ ability: ab.id, spellId, targets: targets.map((s) => s.id), castsLeft: left ?? null });
  }
  return out;
}

/**
 * Resolve `{type:'ability', ability, targetId}` for the active stack.
 * @returns {{ok: boolean, error?: string}}
 */
export function performAbility(cs, stack, action, events) {
  const entry = getAbilityActions(cs, stack).find((a) => a.ability === action.ability);
  if (!entry) return { ok: false, error: 'ability_unavailable' };
  const targetId = action.targetId ?? (entry.targets.length === 1 ? entry.targets[0] : null);
  if (!entry.targets.includes(targetId)) return { ok: false, error: 'bad_target' };
  const target = getStack(cs, targetId);
  const ab = abilityOf(stack, action.ability);
  const side = controllerOf(stack);
  if (stack.castsLeft[ab.id] !== undefined) stack.castsLeft[ab.id] -= 1;
  events.push(ev('ability', { stackId: stack.id, ability: ab.id, targetId }));
  switch (ab.id) {
    case 'spellcaster': {
      const base = { mastery: ab.mastery, casterSide: side, sourceStackId: stack.id, duration: ab.duration || undefined };
      if (ab.target === 'friendly') {
        const spellId = ab.random ? rollPick(cs, genieSpells(cs, stack, ab, target)) : ab.spells[0];
        events.push(ev('spell', { stackId: stack.id, side, spellId, mastery: ab.mastery, creature: true, targetId }));
        if (MASS_CREATURE_SPELLS.includes(spellId)) events.push(...resolveSpell(cs, spellId, { ...base, power: 0, mode: 'all_friendly' }));
        else events.push(...applySpellToStack(cs, spellId, { ...base, power: 0 }, target));
      } else {
        const spellId = stack.pendingSpell;
        const spell = getSpell(spellId);
        stack.pendingSpell = null;
        events.push(ev('spell', { stackId: stack.id, side, spellId, mastery: ab.mastery, creature: true, targetId }));
        // Frost Ring excludes its centre: aim it next to the chosen stack so that the stack is hit.
        const aim = spell.area && spell.area.shape === 'ring' ? neighbors(target.pos)[0] : target;
        events.push(...resolveSpell(cs, spellId, { ...base, power: (ab.powerPerCreature ?? 0) * stack.count, resistible: true }, aim));
      }
      break;
    }
    case 'resurrection':
      events.push(...resurrectStack(cs, target, ab.hpPerCreature * stack.count, { permanent: true }));
      break;
    case 'raise_demons': {
      const demon = getCreature(ab.creatureId);
      const n = raisedDemons(ab, stack, target, demon);
      target.corpseUsed = true;
      events.push(...summonStack(cs, stack.side, ab.creatureId, n, target.pos, { summoned: false, joinsAfter: true }).events);
      break;
    }
    case 'repair':
      events.push(...resurrectStack(cs, target, ab.hpPerCreature * stack.count, { permanent: true }));
      break;
    case 'devour_corpse':
      target.corpseUsed = true;
      events.push(...resurrectStack(cs, stack, Math.floor((target.startCount * target.baseHp * ab.hpPercent) / 100), { permanent: true }));
      break;
    case 'invulnerability':
      stack.invulnerable = true;
      events.push(ev('status_added', { stackId: stack.id, spellId: null, status: 'invulnerable', rounds: ab.rounds }));
      break;
    default:
      return { ok: false, error: 'ability_unavailable' };
  }
  return { ok: true };
}
