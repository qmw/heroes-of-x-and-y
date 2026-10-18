// Combat AI evaluation: stack values (hp- and status-adjusted), expected damage, the threat
// model ("what is the best blow every enemy can deliver next turn") and the board score that
// every candidate action is compared with. Pure: nothing here mutates the state.
import { getCreature } from '../../../data/creatures.js';
import { hexIndex, hexFromIndex, stackHexes, neighbors, inBounds, hexSetDistance, facing } from '../hex.js';
import {
  effectParts, totalHp, retaliationPercent, hasAb, abilityOf, controlOf as coreControlOf, isImmobile, speedOf,
} from '../stats.js';
import { getSpell } from '../../../data/spells.js';
import { hasBonus } from '../state.js';

// Fast paths: the core helpers allocate effect parts on every call; the AI asks these questions
// thousands of times per decision. Same semantics as stats.js controllerOf / isDisabled /
// controlOf (truthiness only).
const CONTROL_KINDS = new Map();
function controlKinds(spellId) {
  let k = CONTROL_KINDS.get(spellId);
  if (!k) {
    const def = getSpell(spellId).effect;
    const parts = def.type === 'multi' ? def.effects : [def];
    k = parts.filter((p) => p.type === 'control').map((p) => p.kind);
    CONTROL_KINDS.set(spellId, k);
  }
  return k;
}
const controlOf = (s, kind) => {
  for (const e of s.effects) if (controlKinds(e.spellId).includes(kind)) return e;
  return null;
};
const controllerOf = (s) => {
  if (!s.effects.length) return s.side;
  const h = controlOf(s, 'hypnotize');
  return h ? h.casterSide : s.side;
};
const isDisabled = (s) => s.effects.length > 0 && !!(controlOf(s, 'blind') || controlOf(s, 'paralyze') || controlOf(s, 'stone'));

/** stats/actions canShoot without allocations. */
function canShoot(cs, s) {
  if (!s.alive || getCreature(s.creatureId).shots <= 0 || s.shots <= 0) return false;
  if (hasAb(s, 'catapult')) return false;
  if (s.effects.length) {
    const f = coreControlOf(s, 'forget');
    if (f && f.value >= 100) return false;
  }
  if (s.warMachine || hasBonus(cs, s.side, 'free_shooting')) return true;
  const side = controllerOf(s);
  const mine = stackHexes(s);
  for (const o of cs.stacks) {
    if (!o.alive || o.warMachine || controllerOf(o) === side) continue;
    if (hexSetDistance(mine, stackHexes(o)) === 1) return false;
  }
  return true;
}
export { controllerOf as aiControllerOf, isDisabled as aiIsDisabled, controlOf as aiControlOf, canShoot as aiCanShoot };

// Per-decision memo of damage previews (cleared by beginDecision; previews only depend on the
// fields in the key while one decision is being made).
let MEMO = null;
// Whether each side has to fear hostile hero magic (protections / Anti-Magic / Mirror are
// worthless otherwise). null = unknown -> assume yes.
let MAGIC_FEAR = null;
export function beginDecision(cs = null) {
  MEMO = new Map();
  MAGIC_FEAR = cs ? { attacker: casterThreat(cs, 'defender'), defender: casterThreat(cs, 'attacker') } : null;
}
export function endDecision() { MEMO = null; MAGIC_FEAR = null; }

function casterThreat(cs, side) {
  const h = cs.sides[side]?.hero;
  if (!h || h.mana < 3) return false;
  return h.spells.some((id) => { try { return getSpell(id).alignment === 'negative'; } catch { return false; } });
}
const effKey = (s) => (s.effects.length ? s.effects.map((e) => `${e.spellId}${e.mastery}${e.value}`).join(',') : '');
import { previewDamage } from '../damage.js';
import { reachable } from '../actions.js';

/** Rounds over which temporary effects are valued (an effect lasting longer counts as permanent). */
export const HORIZON = 3;
/** Weight of the enemy's next-turn threat in the board score. */
export const THREAT_WEIGHT = 0.6;
/** Weight of the acting stack's own next-turn opportunity. */
export const OPP_WEIGHT = 0.3;
/** Score of a battle won / lost outright (dominates every other term). */
export const WIN_SCORE = 1e7;

export const unitValue = (s) => getCreature(s.creatureId).aiValue;
export const hpValue = (s) => unitValue(s) / Math.max(1, s.maxHp);
/** aiValue × creatures, the top creature counted by its remaining hit points. */
export const rawValue = (s) => (s.alive ? unitValue(s) * (s.count - 1 + s.hp / Math.max(1, s.maxHp)) : 0);

const isShooterType = (s) => getCreature(s.creatureId).shots > 0 && s.shots > 0 && !s.warMachine;
const isFighting = (s) => s.alive && !s.warMachine && !s.summoned && !s.clone;

function effWeight(eff) {
  if (eff.turnBased) return 1 / HORIZON;
  if (eff.roundsLeft === null || eff.roundsLeft === undefined) return 1;
  return Math.min(Math.max(eff.roundsLeft, 0), HORIZON) / HORIZON;
}

/**
 * Multiplier (around 1) describing how much the active status effects change the stack's worth
 * in this battle, plus the share of the stack that is hypnotized (fights for the other side).
 * @returns {{factor: number, hypno: number, dot: number}}
 */
export function statusFactor(s) {
  if (!s.effects.length) return { factor: 1, hypno: 0, dot: 0 };
  let off = 1;
  let dur = 1;
  let ctrl = 1;
  let hypno = 0;
  let dot = 0;
  const shooter = isShooterType(s);
  for (const eff of s.effects) {
    const w = effWeight(eff);
    for (const p of effectParts(eff)) {
      const v = Number(p.value) || 0;
      switch (p.type) {
        case 'stat_mod': {
          const d = (p.sign ?? 1) * v;
          if (p.stat === 'attack') {
            const applies = p.mode === 'all' || (p.mode === 'melee' && !shooter) || (p.mode === 'ranged' && shooter);
            if (applies) off *= Math.max(0.2, 1 + w * 0.045 * d);
          } else if (p.stat === 'defense') dur *= Math.max(0.3, 1 + w * 0.04 * d);
          else if (p.stat === 'morale' || p.stat === 'luck') off *= Math.max(0.5, 1 + w * 0.04 * d);
          break;
        }
        case 'speed_mod': {
          const base = Math.max(1, s.speed);
          const now = p.op === 'add' ? base + (p.sign ?? 1) * v : base * (1 + ((p.sign ?? 1) * v) / 100);
          const ratio = Math.max(0.1, now / base);
          off *= 1 + w * (ratio ** (shooter ? 0.15 : 0.5) - 1);
          break;
        }
        case 'damage_mode': {
          const avg = (s.minDamage + s.maxDamage) / 2;
          const pct = Array.isArray(p.percent) ? p.percent[eff.mastery] ?? 0 : 0;
          const now = (p.mode === 'max' ? s.maxDamage : s.minDamage) * (1 + pct / 100);
          off *= Math.max(0.2, 1 + w * (now / Math.max(0.5, avg) - 1));
          break;
        }
        case 'damage_reduction':
          if (p.against === 'melee' || p.against === 'ranged') {
            const share = p.against === 'melee' ? 0.6 : 0.4;
            dur /= Math.max(0.2, 1 - (w * share * Math.min(v, 90)) / 100);
          } else if (!MAGIC_FEAR || MAGIC_FEAR[s.side]) dur *= 1 + w * 0.02;
          break;
        case 'damage_shield': off *= 1 + w * 0.12; break;
        case 'extra_retaliation': off *= 1 + w * 0.05 * Math.max(1, v); break;
        case 'slayer': off *= 1 + w * 0.08; break;
        case 'spell_immunity': if (!MAGIC_FEAR || MAGIC_FEAR[s.side]) dur *= 1 + w * 0.05; break;
        case 'spell_reflect': if (!MAGIC_FEAR || MAGIC_FEAR[s.side]) dur *= 1 + w * 0.03; break;
        case 'frenzy': off *= 1 + w * 0.045 * Math.floor((s.defense * v) / 100); dur *= Math.max(0.4, 1 - w * Math.min(0.6, 0.04 * s.defense)); break;
        case 'control':
          if (p.kind === 'blind' || p.kind === 'paralyze' || p.kind === 'stone') ctrl *= 1 - 0.6 * w;
          else if (p.kind === 'berserk') ctrl *= 1 - 0.7 * w;
          else if (p.kind === 'forget') { if (shooter) off *= 1 - w * (v >= 100 ? 0.8 : 0.4); }
          else if (p.kind === 'bind') { if (!shooter) ctrl *= 1 - 0.3 * w; }
          else if (p.kind === 'fear') ctrl *= 1 - 0.4 * w;
          else if (p.kind === 'hypnotize') hypno = Math.max(hypno, 0.8 * w);
          break;
        case 'damage_over_time':
          dot += (eff.state?.damage ?? 0) * Math.min(eff.roundsLeft ?? HORIZON, HORIZON);
          break;
        case 'heal_over_time':
          dur *= 1 + w * 0.05;
          break;
        default:
      }
    }
  }
  return { factor: Math.sqrt(Math.max(0.01, off) * Math.max(0.01, dur)) * ctrl, hypno, dot };
}

/** Battle worth of a stack for its controller (status effects and pending DoT included). */
export function stackWorth(s) {
  if (!s.alive) return 0;
  const st = statusFactor(s);
  let v = rawValue(s) * st.factor;
  if (st.dot) v -= Math.min(v * 0.9, st.dot * hpValue(s) * 0.7);
  if (s.warMachine) v *= 0.5;
  return v;
}

/** Σ worth of `side`'s troops minus the other side's (hypnosis moves worth across). */
export function materialBalance(cs, side) {
  let total = 0;
  for (const s of cs.stacks) {
    if (!s.alive) continue;
    const st = statusFactor(s);
    let v = rawValue(s) * st.factor;
    if (st.dot) v -= Math.min(v * 0.9, st.dot * hpValue(s) * 0.7);
    if (s.warMachine) v *= 0.5;
    const own = s.side === side ? 1 : -1;
    if (st.hypno > 0) {
      const ctrlSign = controllerOf(s) === side ? 1 : -1;
      total += v * (1 - st.hypno) * own + v * st.hypno * ctrlSign;
    } else total += v * own;
  }
  return total;
}

/**
 * Bonus for enemy stacks wiped out between `before` and `after` (a dead stack never acts or
 * retaliates again) minus the same for own stacks.
 */
export function eliminationBonus(before, after, side) {
  let b = 0;
  for (const s of before.stacks) {
    if (!s.alive) continue;
    const a = after.stacks.find((x) => x.id === s.id);
    if (a && a.alive) continue;
    b += (controllerOf(s) === side ? -0.3 : 0.3) * rawValue(s);
  }
  return b;
}

/** Winner by annihilation right now ('attacker' | 'defender' | 'draw' | null). */
export function annihilationWinner(cs) {
  let a = false;
  let d = false;
  for (const s of cs.stacks) {
    if (!isFighting(s)) continue;
    if (s.side === 'attacker') a = true; else d = true;
  }
  if (a && d) return null;
  return a ? 'attacker' : d ? 'defender' : 'draw';
}

// ---- damage -------------------------------------------------------------------------------------

/** Average damage of one attack action (both blows / shots), capped at the target's hp. */
export function expDamage(cs, a, t, opts = {}) {
  let key = null;
  if (MEMO) {
    key = `${a.id}|${a.count}|${a.startCount}|${a.defending ? 1 : 0}|${effKey(a)}|${t.id}|${t.count}|${t.hp}|${t.defending ? 1 : 0}|${t.inMoat ? 1 : 0}|${effKey(t)}|${opts.ranged ? `r${a.pos.x},${a.pos.y},${t.pos.x},${t.pos.y}` : 'm'}|${opts.retaliation ? 1 : 0}|${opts.retalPercent ?? ''}|${opts.hexesTravelled ?? 0}`;
    const hit = MEMO.get(key);
    if (hit !== undefined) return hit;
  }
  const v = expDamageRaw(cs, a, t, opts);
  if (key) MEMO.set(key, v);
  return v;
}

function expDamageRaw(cs, a, t, opts) {
  const p = previewDamage(cs, a, t, opts);
  let dmg = (p.minDamage + p.maxDamage) / 2;
  const dd = abilityOf(a, 'double_damage_chance');
  if (dd) dmg *= 1 + dd.chance / 100;
  if (!opts.retaliation) {
    if (opts.ranged ? hasAb(a, 'double_shot') : hasAb(a, 'double_attack')) dmg *= 2;
  }
  return Math.min(dmg, totalHp(t));
}

/** Shallow copy of `s` after losing `dmg` hit points (for retaliation estimates). */
export function afterLoss(s, dmg) {
  const rest = totalHp(s) - dmg;
  if (rest <= 0) return null;
  return { ...s, count: Math.ceil(rest / s.maxHp), hp: rest - (Math.ceil(rest / s.maxHp) - 1) * s.maxHp };
}

/** Value of the retaliation `a` would receive from `t` after dealing `dealt` to it. */
export function retaliationValue(cs, a, t, dealt) {
  if (hasAb(a, 'no_enemy_retaliation')) return 0;
  const pct = retaliationPercent(cs, t);
  if (pct <= 0) return 0;
  const rest = afterLoss(t, dealt);
  if (!rest) return 0;
  return expDamage(cs, rest, a, { retaliation: true, retalPercent: pct }) * hpValue(a);
}

// ---- threat model -------------------------------------------------------------------------------

/** Hexes adjacent to (but not inside) the stack. */
function ringOf(s) {
  const own = stackHexes(s);
  const inside = new Set(own.map(hexIndex));
  const ring = [];
  const seen = new Set();
  for (const h of own) {
    for (const n of neighbors(h)) {
      const i = hexIndex(n);
      if (inBounds(n) && !inside.has(i) && !seen.has(i)) { seen.add(i); ring.push(n); }
    }
  }
  return ring;
}

/** Can `e` (head positions `reach`, anything with `has(i)`) stand next to `f`? */
function canReachAdjacent(e, reach, f) {
  const two = e.size > 1;
  const dx = two ? facing(e.side) : 0;
  for (const r of ringOf(f)) {
    if (reach.has(hexIndex(r))) return true;
    if (two) {
      // the tail on r: the head stands one hex further forward
      const head = { x: r.x + dx, y: r.y };
      if (inBounds(head) && reach.has(hexIndex(head))) return true;
    }
  }
  return false;
}

/**
 * Reach maps of every stack computed once on `cs` with the stack `ignoreId` lifted off the
 * board. `forState(c)` adapts them to a candidate state where that stack stands elsewhere
 * (positions overlapping it are dropped). Used to score many candidate positions cheaply; the
 * finalists are re-scored with exact reachability.
 */
export function reachCache(cs, ignoreId) {
  const view = { ...cs, stacks: cs.stacks.map((s) => (s.id === ignoreId ? { ...s, alive: false } : s)) };
  const memo = new Map();
  const base = (e) => {
    let r = memo.get(e.id);
    if (!r) {
      const se = view.stacks.find((x) => x.id === e.id);
      r = se && se.alive ? reachable(view, se) : new Map();
      memo.set(e.id, r);
    }
    return r;
  };
  const best = new Map();
  return {
    cs,
    ignoreId,
    base,
    /** Best blow of `e` on the base board without the lifted stack. */
    bestExcl(e) {
      let v = best.get(e.id);
      if (v === undefined) {
        const se = view.stacks.find((x) => x.id === e.id);
        v = se ? bestAttackValue(view, se, new Map(), base) : 0;
        best.set(e.id, v);
      }
      return v;
    },
    forState(c) {
      const me = c.stacks.find((x) => x.id === ignoreId);
      const mine = new Set(me && me.alive ? stackHexes(me).map(hexIndex) : []);
      return (e) => {
        if (e.id === ignoreId) return null;
        const r = base(e);
        if (!mine.size) return r;
        const two = e.size > 1;
        const dx = facing(e.side);
        return {
          has: (i) => {
            if (!r.has(i) || mine.has(i)) return false;
            if (two) {
              const h = hexFromIndex(i);
              if (mine.has(hexIndex({ x: h.x - dx, y: h.y }))) return false;
            }
            return true;
          },
        };
      };
    },
  };
}

/** Can the stack act on its own next turn (not disabled, not berserk, not an idle machine)? */
function canActNext(s) {
  if (!s.alive || isDisabled(s) || controlOf(s, 'berserk')) return false;
  if (s.warMachine && !hasAb(s, 'hero_attack_scaling')) return false;
  return true;
}

/** Worth of keeping a shooter able to shoot: a fraction of its best shot. */
function shooterWorth(cs, f, foes) {
  if (!isShooterType(f)) return 0;
  let best = 0;
  for (const e of foes) best = Math.max(best, expDamage(cs, f, e, { ranged: true }) * hpValue(e));
  return best;
}

/** Value of one blow of `e` on `f` (`ranged`: a shot), net of retaliation, + blocking a shooter. */
function blowValue(cs, e, f, ranged, side, cache) {
  if (ranged) {
    const v = expDamage(cs, e, f, { ranged: true }) * hpValue(f);
    return f.warMachine ? v * 0.5 : v;
  }
  const dealt = expDamage(cs, e, f, {});
  let v = dealt * hpValue(f) - 0.5 * retaliationValue(cs, e, f, dealt);
  if (f.warMachine) v *= 0.5;
  if (isShooterType(f)) {
    let sw = cache ? cache.get(f.id) : undefined;
    if (sw === undefined) {
      sw = shooterWorth(cs, f, cs.stacks.filter((x) => x.alive && controllerOf(x) === side));
      if (cache) cache.set(f.id, sw);
    }
    v += 0.5 * sw;
  }
  return v;
}

/**
 * Best expected value `e` can take away with its next action (net of the retaliation it
 * receives), given the current board. Shooters shoot; walkers / flyers need a reachable
 * adjacent hex. Blocking an enemy shooter's own shooter counts too.
 * @param {Object} [cache] per-board memo of shooter worth
 * @param {Function} [reachFn] e -> reach map (approximate, see reachCache); default exact
 * @param {Object} [only] consider this single foe only
 */
export function bestAttackValue(cs, e, cache = null, reachFn = null, only = null) {
  if (!canActNext(e)) return 0;
  const side = controllerOf(e);
  const foes = only ? [only] : cs.stacks.filter((f) => f.alive && controllerOf(f) !== side);
  if (!foes.length) return 0;
  let best = 0;
  if (canShoot(cs, e)) {
    for (const f of foes) best = Math.max(best, blowValue(cs, e, f, true, side, cache));
    return e.warMachine ? best * 0.6 : best;
  }
  if (isImmobile(e) || e.warMachine) return 0;
  const reach = (reachFn && reachFn(e)) || reachable(cs, e);
  for (const f of foes) {
    if (!canReachAdjacent(e, reach, f)) continue;
    best = Math.max(best, blowValue(cs, e, f, false, side, cache));
  }
  return best;
}

/** Σ best next-turn blows of every stack hostile to `side`. */
export function threatTo(cs, side, cache = new Map(), reachFn = null) {
  let t = 0;
  for (const e of cs.stacks) {
    if (!e.alive || controllerOf(e) === side) continue;
    t += bestAttackValue(cs, e, cache, reachFn);
  }
  return t;
}

const adjacent = (a, b) => hexSetDistance(stackHexes(a), stackHexes(b)) === 1;
const sameStackState = (a, b) => a.count === b.count && a.hp === b.hp && a.effects.length === b.effects.length
  && a.pos.x === b.pos.x && a.pos.y === b.pos.y && a.shots === b.shots && a.defending === b.defending;

/**
 * Approximate threat for a candidate state `c` that differs from the cached base board only by
 * the acting stack (and whatever it hit): an enemy that is untouched and not next to the actor
 * (before or after) keeps its best blow against everybody else, recomputed only against the
 * actor; the others are recomputed in full with the cached reach maps.
 */
function fastThreat(c, side, rc, cache) {
  const reachFn = rc.forState(c);
  const me = c.stacks.find((x) => x.id === rc.ignoreId);
  const meBase = rc.cs.stacks.find((x) => x.id === rc.ignoreId);
  let t = 0;
  for (const e of c.stacks) {
    if (!e.alive || controllerOf(e) === side) continue;
    const eb = rc.cs.stacks.find((x) => x.id === e.id);
    const fast = eb && eb.alive && sameStackState(e, eb) && !(me && me.alive && adjacent(me, e))
      && !(meBase && meBase.alive && adjacent(meBase, eb)) && controllerOf(eb) === controllerOf(e);
    if (!fast) { t += bestAttackValue(c, e, cache, reachFn); continue; }
    let v = rc.bestExcl(e);
    if (me && me.alive && controllerOf(me) === side) v = Math.max(v, bestAttackValue(c, e, cache, reachFn, me));
    t += v;
  }
  return t;
}

/**
 * Board score from `side`'s point of view: material balance, minus the enemy's next-turn
 * threat, plus the acting stack's own next-turn opportunity (or, out of reach, the discounted
 * value of closing in).
 * @param {{actorId?: number, threatWeight?: number, oppWeight?: number, approachWeight?: number,
 *   reachCache?: Object}} [opts] `reachCache` (see reachCache) = approximate enemy reach
 */
export function boardScore(cs, side, opts = {}) {
  const w = annihilationWinner(cs);
  if (w === side) return WIN_SCORE + materialBalance(cs, side);
  if (w) return -WIN_SCORE + materialBalance(cs, side);
  const cache = new Map();
  const threat = opts.reachCache ? fastThreat(cs, side, opts.reachCache, cache) : threatTo(cs, side, cache);
  let score = materialBalance(cs, side) - (opts.threatWeight ?? THREAT_WEIGHT) * threat;
  if (opts.actorId !== undefined) {
    const me = cs.stacks.find((s) => s.id === opts.actorId);
    if (me && me.alive) {
      let opp = bestAttackValue(cs, me, cache);
      if (opp <= 0 && opts.approachWeight) opp = Math.min(1, opts.approachWeight) * approachValue(cs, me);
      score += (opts.oppWeight ?? OPP_WEIGHT) * opp;
    }
  }
  return score;
}

/**
 * Value of closing in: the best blow `me` could deliver once it reaches an enemy, discounted
 * by the turns it needs to get there (hex distance / speed; walkers are not path-checked).
 */
export function approachValue(cs, me) {
  if (!canActNext(me) || isImmobile(me) || me.warMachine || canShoot(cs, me)) return 0;
  const speed = Math.max(1, speedOf(cs, me));
  const side = controllerOf(me);
  let best = 0;
  for (const t of cs.stacks) {
    if (!t.alive || controllerOf(t) === side) continue;
    const d = hexSetDistance(stackHexes(me), stackHexes(t));
    // not attackable next turn (otherwise bestAttackValue would have found it): two turns at least
    const turns = Math.max(2, Math.ceil((d - 1) / speed));
    let v = expDamage(cs, me, t, {}) * hpValue(t) * 0.6 ** (turns - 1);
    if (t.warMachine) v *= 0.3;
    // a little pull towards the nearest enemy even when it is worthless
    v += 1 / (1 + d);
    if (v > best) best = v;
  }
  return best;
}

/** Σ best shots of the side's shooters (who wins a standing ranged exchange). */
export function rangedPower(cs, side) {
  let p = 0;
  for (const s of cs.stacks) {
    if (!s.alive || controllerOf(s) !== side || !canActNext(s) || !canShoot(cs, s)) continue;
    p += bestAttackValue(cs, s);
  }
  return p;
}

/** Total raw worth of the side's fighting troops (retreat decisions, scaling). */
export function sideStrength(cs, side) {
  let v = 0;
  for (const s of cs.stacks) if (s.alive && s.side === side && !s.warMachine) v += stackWorth(s);
  return v;
}

export { isShooterType, isFighting, ringOf, canReachAdjacent, canActNext };
