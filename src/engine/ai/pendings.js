// Resolving the AI player's pending choices (docs/mechanics/ai.md "Pendings").
import { RESOURCES } from '../../core/constants.js';
import { getCreature } from '../../data/creatures.js';
import { getPending } from '../pending.js';
import { resolvePending } from '../game.js';
import { canAfford } from '../economy.js';
import { pickLevelUp, skillValue, heroKind } from './skills.js';
import { judgeNeutralFight, strengthOf } from './strength.js';
import { PENDING_BUDGET, note, spend } from './context.js';
import { waterMap } from './towns.js';

const NEGATIVE_IDS = ['leave', 'no', 'cancel', 'done', 'decline'];

function idx(p, id) {
  return p.options.findIndex((o) => o.id === id);
}

function negative(p) {
  for (const id of NEGATIVE_IDS) {
    const i = idx(p, id);
    if (i >= 0) return i;
  }
  return 0;
}

function gold(ctx) {
  return ctx.player.resources.gold || 0;
}

function costFraction(ctx, cost) {
  if (!cost) return 0;
  let worst = 0;
  for (const r of RESOURCES) {
    const need = cost[r] || 0;
    if (!need) continue;
    const have = ctx.player.resources[r] || 0;
    worst = Math.max(worst, have > 0 ? need / have : Infinity);
  }
  return worst;
}

function toArmy(guards) {
  if (!Array.isArray(guards)) return [];
  return guards.map((s) => (s && s.count > 0 ? { creatureId: s.creatureId, count: s.count } : null));
}

export function roleOf(ctx, hero) {
  return hero && ctx.player.ai.mainHeroId === hero.id ? 'main' : 'secondary';
}

function maxBuy(ctx, cost, cap) {
  let n = cap;
  const reserve = ctx.goldReserve || 0;
  for (const r of RESOURCES) {
    const c = cost?.[r] || 0;
    if (!c) continue;
    const have = (ctx.player.resources[r] || 0) - (r === 'gold' ? reserve : 0);
    n = Math.min(n, Math.floor(Math.max(0, have) / c));
  }
  return Math.max(0, n);
}

/** Decide one pending. @returns {{index:number, extra?:object}} */
function decide(ctx, p) {
  const { state } = ctx;
  const hero = p.heroId ? state.heroes[p.heroId] : null;
  const role = roleOf(ctx, hero);
  const d = p.data || {};
  switch (p.kind) {
    case 'level_up':
      return { index: hero ? pickLevelUp(hero, p.options, role) : 0 };
    case 'chest_choice': {
      const g = p.options[idx(p, 'gold')]?.gold || 0;
      const e = p.options[idx(p, 'exp')]?.exp || 0;
      const rate = role === 'main' ? (hero && hero.level < 10 ? 1.5 : 0.8) : 0.4;
      return { index: e * rate > g ? idx(p, 'exp') : idx(p, 'gold') };
    }
    case 'monster_join': {
      const cost = d.cost || 0;
      const yes = !cost || (cost <= gold(ctx) * 0.6 && canAfford(state, ctx.playerId, { gold: cost }));
      return { index: yes ? idx(p, 'yes') : idx(p, 'no') };
    }
    case 'monster_flee': {
      const obj = state.map.objects[d.objectId];
      if (!hero || !obj) return { index: idx(p, 'no') };
      const c = getCreature(obj.data.creatureId);
      const j = judgeNeutralFight(ctx, hero, [{ creatureId: obj.data.creatureId, count: obj.data.count }], obj.data.count * c.aiValue, `flee:${obj.id}`);
      const pursue = role === 'main' && j.win && j.lossFrac < 0.03;
      return { index: pursue ? idx(p, 'yes') : idx(p, 'no') };
    }
    case 'confirm_fight': {
      if (!hero) return { index: idx(p, 'no') };
      const army = toArmy(d.guards);
      const j = judgeNeutralFight(ctx, hero, army, strengthOf(army), `obj:${d.objectId}:${d.stage}`, { bank: d.stage === 'bank' });
      const ok = j.win && (j.lossFrac < (d.stage === 'bank' ? 0.4 : 0.6));
      return { index: ok ? idx(p, 'yes') : idx(p, 'no') };
    }
    case 'confirm_pay': {
      const ok = canAfford(state, ctx.playerId, d.cost || {}) && costFraction(ctx, d.cost) <= 0.35;
      return { index: ok ? idx(p, 'yes') : idx(p, 'no') };
    }
    case 'confirm_open': {
      const obj = state.map.objects[d.objectId];
      const army = toArmy(obj?.data?.guards);
      if (hero && army.some(Boolean)) {
        const j = judgeNeutralFight(ctx, hero, army, strengthOf(army), `obj:${d.objectId}:guards`);
        if (!(j.win && j.lossFrac < 0.5)) return { index: idx(p, 'no') };
      }
      return { index: idx(p, 'yes') >= 0 ? idx(p, 'yes') : 0 };
    }
    case 'confirm_search':
    case 'confirm_quest':
    case 'confirm_pass':
      return { index: idx(p, 'yes') >= 0 ? idx(p, 'yes') : 0 };
    case 'primary_choice': {
      const want = hero && heroKind(hero) === 'magic' ? ['power', 'knowledge', 'attack', 'defense'] : ['attack', 'defense', 'power', 'knowledge'];
      if (d.cost && !canAfford(state, ctx.playerId, d.cost)) return { index: negative(p) };
      for (const w of want) {
        const i = p.options.findIndex((o) => o.stat === w);
        if (i >= 0) return { index: i };
      }
      return { index: 0 };
    }
    case 'skill_choice': {
      if (!hero || (d.cost && (!canAfford(state, ctx.playerId, d.cost) || costFraction(ctx, d.cost) > 0.4))) return { index: negative(p) };
      let best = -1;
      let bestV = 3; // ignore poor skills
      p.options.forEach((o, i) => {
        if (o.id === 'decline' || o.available === false) return;
        const v = skillValue(hero, o.skillId || o.id, d.level || 1, role);
        if (v > bestV) { bestV = v; best = i; }
      });
      return { index: best >= 0 ? best : negative(p) };
    }
    case 'university': {
      if (!hero || hero.skills.length >= 8) return { index: negative(p) };
      let best = -1;
      let bestV = 5;
      p.options.forEach((o, i) => {
        if (o.id !== 'buy' || o.available === false) return;
        if (!canAfford(state, ctx.playerId, o.cost || {}) || costFraction(ctx, o.cost) > 0.4) return;
        if (hero.skills.some((s) => s.id === o.skillId)) return;
        const v = skillValue(hero, o.skillId, 1, role);
        if (v > bestV) { bestV = v; best = i; }
      });
      return { index: best >= 0 ? best : negative(p) };
    }
    case 'buy_artifact': {
      const i = p.options.findIndex((o) => o.id === 'buy' && o.cost && canAfford(state, ctx.playerId, o.cost) && costFraction(ctx, o.cost) <= 0.2);
      return { index: i >= 0 ? i : negative(p) };
    }
    case 'recruit': {
      const seen = (ctx.dialogSeen[`recruit:${d.objectId}`] ??= new Set());
      let best = -1;
      let bestV = 0;
      let bestN = 0;
      p.options.forEach((o, i) => {
        if (o.id !== 'recruit' || seen.has(o.creatureId)) return;
        const n = maxBuy(ctx, o.cost || {}, o.available || 0);
        if (n < 1) return;
        const v = getCreature(o.creatureId).aiValue * n;
        if (v > bestV) { bestV = v; best = i; bestN = n; }
      });
      if (best < 0) return { index: negative(p) };
      seen.add(p.options[best].creatureId);
      return { index: best, extra: { count: bestN } };
    }
    case 'upgrade_creatures': {
      const seen = (ctx.dialogSeen[`upg:${d.objectId}`] ??= new Set());
      const i = p.options.findIndex((o) => o.id === 'upgrade' && !seen.has(o.slot) && o.cost
        && canAfford(state, ctx.playerId, o.cost) && costFraction(ctx, o.cost) <= 0.3);
      if (i < 0) return { index: negative(p) };
      seen.add(p.options[i].slot);
      return { index: i };
    }
    case 'army_overflow': {
      if (!hero) return { index: negative(p) };
      const incoming = getCreature(d.creatureId).aiValue * (d.count || 0);
      let weakest = -1;
      let weakV = Infinity;
      p.options.forEach((o, i) => {
        if (o.id !== 'dismiss') return;
        const v = getCreature(o.creatureId).aiValue * o.count;
        if (v < weakV) { weakV = v; weakest = i; }
      });
      return { index: weakest >= 0 && weakV < incoming ? weakest : negative(p) };
    }
    case 'town_portal': {
      const want = ctx.portalTownId;
      const i = want ? p.options.findIndex((o) => o.townId === want) : -1;
      return { index: i >= 0 ? i : 0 };
    }
    case 'hero_exchange':
      return { index: 0 };
    case 'build_boat': {
      // flagged shipyard object: build only on a water map when no own / free boat is around
      const hasBoat = Object.values(state.map.objects).some((o) => o.defId === 'boat' && !o.data?.heroId
        && (o.data?.owner == null || o.data.owner === ctx.playerId));
      const ok = !hasBoat && waterMap(ctx) && canAfford(state, ctx.playerId, d.cost || {}) && costFraction(ctx, d.cost) <= 0.4;
      return { index: ok ? idx(p, 'yes') : negative(p) };
    }
    case 'confirm_whirlpool':
    case 'altar':
    case 'trade':
    case 'tavern':
    case 'buy_war_machine':
    case 'garrison_exchange':
    default:
      return { index: negative(p) };
  }
}

/** Resolve every pending choice of the AI player (bounded). */
export function resolveAllPendings(ctx) {
  const { state, playerId } = ctx;
  ctx.dialogSeen ??= {};
  for (let n = 0; n < PENDING_BUDGET; n++) {
    const list = getPending(state, playerId);
    if (!list.length) return;
    const p = list[0];
    let choice;
    try {
      choice = decide(ctx, p);
    } catch (e) {
      note(ctx, 'decide_failed', `${p.kind} ${e.message}`);
      choice = { index: negative(p) };
    }
    if (!(choice.index >= 0 && choice.index < p.options.length)) choice.index = p.options.length ? negative(p) : 0;
    spend(ctx);
    ctx.report.pendings++;
    let r;
    try {
      r = resolvePending(state, p.id, choice.index, choice.extra);
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    if (!r.ok) {
      note(ctx, 'pending_failed', `${p.kind} ${r.error}`);
      // drop it so the loop cannot spin (the default resolver would do the same)
      state.pending = (state.pending || []).filter((x) => x.id !== p.id);
    }
    if (r.events) for (const e of r.events) if (e.type === 'combat_finished') ctx.report.fights++;
  }
  note(ctx, 'pending_budget_exhausted');
}

