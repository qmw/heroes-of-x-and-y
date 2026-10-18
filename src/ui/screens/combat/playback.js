// Combat screen: animation of engine events. `createPlayback(env)` returns `play(events)`, which
// walks the events in order (kit `playEvents`), logging each one and animating it on the view model.
// Every wait goes through `env.tween`, so animation speed / instant mode / skipping apply everywhere.
import { playEvents, lerp } from '../../kit/anim.js';
import { feetOf, describeEvent, projectileFor, spellSfx, creatureName, humanizeId, HERO_POS, structureHex } from './model.js';
import { ensureViewStack, syncView } from './view.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { SPELL_BY_ID } from '../../../data/spells.js';
import { getStack } from '../../../engine/combat/index.js';

const MELEE_SFX = {
  beast: 'melee_claw', insect: 'melee_claw', dragon: 'melee_bite', serpent: 'melee_bite', giant: 'melee_blunt',
  construct: 'melee_blunt', machine: 'melee_blunt', plant: 'melee_blunt', elemental: 'melee_magic', caster: 'melee_magic',
};

/**
 * @param {Object} env {
 *   view, cs, layout,
 *   tween(o) -> Promise       (kit tween honouring speed / instant / skip),
 *   sfx(name), log(text, kind), onEvent?(e) }
 * @returns {{ play(events) -> Promise<void>, handlers }}
 */
export function createPlayback(env) {
  const { view, layout } = env;
  const cs = () => env.cs;
  const wait = (ms) => env.tween({ duration: ms });
  const vstack = (id) => {
    let v = view.stacks.get(id);
    if (!v) { const s = getStack(cs(), id); if (s) v = ensureViewStack(view, cs(), layout, s); }
    return v || null;
  };
  const head = (v) => ({ x: v.x + v.dx, y: v.y + v.dy - 34 });

  function effect(id, x, y, ms = 500, size = 96) {
    const fx = { id, x, y, t: 0, size, alpha: 1 };
    view.effects.push(fx);
    return env.tween({ duration: ms, onUpdate: (v) => { fx.t = v; } }).then(() => {
      const i = view.effects.indexOf(fx);
      if (i >= 0) view.effects.splice(i, 1);
    });
  }
  function floatText(text, x, y, color = '#fff', ms = 800, size = 16) {
    const t = { text, x, y, color, alpha: 1, size };
    view.texts.push(t);
    const y0 = y;
    return env.tween({ duration: ms, onUpdate: (v) => { t.y = y0 - 34 * v; t.alpha = v < 0.6 ? 1 : 1 - (v - 0.6) / 0.4; } }).then(() => {
      const i = view.texts.indexOf(t);
      if (i >= 0) view.texts.splice(i, 1);
    });
  }
  function banner(text, ms = 800) {
    const b = { text, alpha: 0 };
    view.banner = b;
    return env.tween({ duration: ms, onUpdate: (v) => { b.alpha = v < 0.2 ? v / 0.2 : v > 0.8 ? (1 - v) / 0.2 : 1; } }).then(() => {
      if (view.banner === b) view.banner = null;
    });
  }
  function setState(v, state, facing) {
    if (!v) return;
    v.state = state;
    v.t0 = view.time;
    if (facing) v.facing = facing;
  }
  const idle = (v) => { if (v && v.alive) { v.state = 'idle'; v.facing = v.side === 'attacker' ? 1 : -1; } };

  async function moveAlong(v, e) {
    const st = { size: v.size, side: v.side };
    const pts = [e.from, ...(e.path || [])].filter(Boolean).map((p) => feetOf(layout, st, p));
    if (!pts.length) pts.push(feetOf(layout, st, e.to));
    const end = feetOf(layout, st, e.to);
    if (e.mode === 'tactics' || e.mode === 'teleport') {
      await env.tween({ duration: 180, onUpdate: (a) => { v.alpha = 1 - a; } });
      v.x = end.x; v.y = end.y;
      if (e.mode === 'teleport') effect('teleport', end.x, end.y - 30, 400);
      await env.tween({ duration: 180, onUpdate: (a) => { v.alpha = a; } });
      return;
    }
    setState(v, 'move', end.x < v.x ? -1 : end.x > v.x ? 1 : v.facing);
    env.sfx('move');
    if (e.mode === 'fly') {
      const a = { x: v.x, y: v.y };
      const dist = Math.hypot(end.x - a.x, end.y - a.y);
      await env.tween({ duration: 180 + dist * 0.9, ease: 'inOutQuad', onUpdate: (t) => {
        v.x = lerp(a.x, end.x, t); v.y = lerp(a.y, end.y, t); v.dy = -Math.sin(Math.PI * t) * Math.min(80, dist * 0.25);
      } });
      v.dy = 0;
    } else {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (b.x !== a.x) v.facing = b.x < a.x ? -1 : 1;
        await env.tween({ duration: 120, onUpdate: (t) => { v.x = lerp(a.x, b.x, t); v.y = lerp(a.y, b.y, t); } });
      }
    }
    v.x = end.x; v.y = end.y;
    idle(v);
  }

  async function strike(e, kind) {
    const a = vstack(e.stackId);
    const t = vstack(e.targetId);
    if (!a) return;
    const dir = t ? Math.sign(t.x - a.x) || a.facing : a.facing;
    setState(a, 'attack', dir);
    const shape = CREATURE_BY_ID[a.creatureId]?.shape;
    env.sfx(MELEE_SFX[shape] || 'melee_blade');
    if (e.lucky > 0 || e.lucky === true) floatText('Lucky strike!', a.x, a.y - 90, '#7ae07a');
    const dx = t ? Math.max(-16, Math.min(16, (t.x - a.x) * 0.2)) : dir * 12;
    const dy = t ? Math.max(-10, Math.min(10, (t.y - a.y) * 0.2)) : 0;
    await env.tween({ duration: 160, onUpdate: (v) => { a.dx = dx * v; a.dy = dy * v; } });
    if (kind === 'retaliate' && t) floatText('Retaliation', a.x, a.y - 92, '#ffd070', 600, 13);
    await env.tween({ duration: 160, onUpdate: (v) => { a.dx = dx * (1 - v); a.dy = dy * (1 - v); } });
    a.dx = 0; a.dy = 0;
    idle(a);
  }

  async function shot(e) {
    const a = vstack(e.stackId);
    if (!a) return;
    const targets = (e.targets && e.targets.length ? e.targets : [e.targetId]).map((x) => (typeof x === 'object' && x ? x.stackId ?? x.id : x));
    const primary = vstack(e.targetId ?? targets[0]);
    const dir = primary ? Math.sign(primary.x - a.x) || a.facing : a.facing;
    setState(a, 'shoot', dir);
    const pid = projectileFor(a.creatureId);
    env.sfx(pid === 'cannonball' ? 'cannon' : 'arrow');
    await wait(140);
    if (primary) await projectile(pid, head(a), head(primary));
    idle(a);
  }

  async function projectile(id, from, to) {
    const p = { id, x: from.x, y: from.y, angle: Math.atan2(to.y - from.y, to.x - from.x) };
    view.projectiles.push(p);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const arc = id === 'rock' || id === 'cannonball' ? Math.min(90, dist * 0.2) : Math.min(30, dist * 0.06);
    await env.tween({ duration: Math.max(140, Math.min(480, dist * 0.7)), onUpdate: (t) => {
      p.x = lerp(from.x, to.x, t);
      p.y = lerp(from.y, to.y, t) - Math.sin(Math.PI * t) * arc;
      p.angle = Math.atan2(to.y - from.y - Math.cos(Math.PI * t) * arc * Math.PI, to.x - from.x);
    } });
    const i = view.projectiles.indexOf(p);
    if (i >= 0) view.projectiles.splice(i, 1);
  }

  function heroCast(side) {
    const hv = view.heroes[side];
    if (!hv) return;
    hv.state = 'cast';
    hv.t0 = view.time;
    env.tween({ duration: 700 }).then(() => { hv.state = 'idle'; });
  }

  function spellAnchor(e) {
    const t = typeof e.target === 'number' ? e.target : typeof e.targetId === 'number' ? e.targetId : e.target && e.target.stackId;
    if (typeof t === 'number') { const v = vstack(t); if (v) return { x: v.x, y: v.y - 34, size: 110 }; }
    if (e.target && typeof e.target.x === 'number') { const c = layout.center(e.target.x, e.target.y); return { x: c.x, y: c.y, size: 170 }; }
    return null;
  }

  const handlers = {
    round_start: (e) => (e.round > 1 ? banner(`Round ${e.round}`, 700) : null),
    tactics_start: () => banner('Tactics phase', 800),
    tactics_end: () => banner('The battle begins!', 700),
    turn_start: (e) => { view.activeId = e.stackId; },
    turn_skipped: (e) => { const v = vstack(e.stackId); return v ? floatText(e.reason === 'morale' ? 'Freezes!' : e.reason === 'fear' ? 'Afraid!' : 'Skips', v.x, v.y - 80, '#ff9070') : null; },
    morale: (e) => {
      const v = vstack(e.stackId);
      if (!v) return null;
      env.sfx('morale');
      floatText(e.good ? 'Morale!' : 'Low morale', v.x, v.y - 86, e.good ? '#ffe070' : '#ff7060');
      return effect(e.good ? 'morale_good' : 'morale_bad', v.x, v.y - 40, 600);
    },
    luck: (e) => {
      const v = vstack(e.stackId);
      if (!v) return null;
      floatText(e.good ? 'Luck!' : 'Bad luck', v.x, v.y - 86, e.good ? '#7ae07a' : '#ff7060');
      return effect(e.good ? 'luck_good' : 'luck_bad', v.x, v.y - 40, 500);
    },
    move: (e) => { const v = vstack(e.stackId); return v ? moveAlong(v, e) : null; },
    attack: (e) => strike(e, 'attack'),
    retaliate: (e) => strike(e, 'retaliate'),
    berserk: (e) => { const v = vstack(e.stackId); return v ? floatText('Berserk!', v.x, v.y - 86, '#ff6040') : null; },
    shoot: (e) => shot(e),
    damage: async (e) => {
      const v = vstack(e.stackId);
      if (!v) return;
      if (e.blocked) { await effect('block', v.x, v.y - 36, 300, 80); return; }
      setState(v, 'hit');
      env.sfx('hit');
      v.count = typeof e.remaining === 'number' ? e.remaining : v.count;
      const text = `-${e.dealt ?? e.amount}${e.killed ? ` (${e.killed} perish)` : ''}`;
      floatText(text, v.x, v.y - 70, e.kind === 'spell' ? '#c8a0ff' : '#ff5a4a', 900, 15);
      if (e.kind && !['melee', 'ranged', 'tower', 'moat'].includes(e.kind)) effect(e.kind === 'spell' ? 'magic' : 'explosion', v.x, v.y - 34, 400, 80);
      await env.tween({ duration: 260, onUpdate: (t) => { v.flash = 1 - t; } });
      v.flash = 0;
      if (v.alive && v.state === 'hit') v.state = 'idle';
    },
    death: async (e) => {
      const v = vstack(e.stackId);
      if (!v) return;
      v.alive = false;
      v.count = 0;
      setState(v, 'dead');
      const shape = CREATURE_BY_ID[v.creatureId]?.shape;
      env.sfx(shape === 'undead' ? 'death_undead' : shape === 'flyer' ? 'death_flyer' : v.size > 1 ? 'death_large' : 'death');
      if (v.summoned || v.clone) await env.tween({ duration: 400, onUpdate: (t) => { v.alpha = 1 - t; } });
      else await wait(380);
    },
    rebirth: async (e) => {
      const v = vstack(e.stackId);
      if (!v) return;
      const s = getStack(cs(), e.stackId);
      v.alive = true; v.alpha = 1; v.state = 'idle';
      v.count = s ? s.count : e.count;
      floatText(`+${e.count}`, v.x, v.y - 80, '#ffd060');
      await effect('resurrect', v.x, v.y - 36, 600);
    },
    resurrect: async (e) => {
      const v = vstack(e.stackId);
      if (!v) return;
      const s = getStack(cs(), e.stackId);
      if (s && s.alive) { v.alive = true; v.alpha = 1; v.state = 'idle'; }
      v.count = s ? s.count : v.count + (e.raised || 0);
      if (e.raised) floatText(`+${e.raised}`, v.x, v.y - 80, '#ffd060');
      env.sfx('resurrect');
      await effect('resurrect', v.x, v.y - 36, 600);
    },
    heal: async (e) => {
      const v = vstack(e.stackId);
      if (!v || !(e.amount > 0)) return;
      floatText(`+${e.amount}`, v.x, v.y - 80, '#7ae07a');
      await effect('heal', v.x, v.y - 36, 450);
    },
    explode: (e) => { const v = vstack(e.stackId); return v ? effect('explosion', v.x, v.y - 30, 500, 120) : null; },
    poison_tick: (e) => { const v = vstack(e.stackId); return v ? effect('poison', v.x, v.y - 36, 400) : null; },
    spell: async (e) => {
      if (!e.creature && e.stackId == null && e.side) heroCast(e.side);
      else { const c = vstack(e.stackId); if (c) { setState(c, 'cast'); env.tween({ duration: 500 }).then(() => idle(c)); } }
      env.sfx(spellSfx(e.spellId));
      const at = spellAnchor(e);
      if (at) await effect(e.spellId, at.x, at.y, 650, at.size);
      else if (!e.auto) {
        const hp = HERO_POS[e.side] || HERO_POS.attacker;
        await effect(e.spellId, hp.x, hp.y - 60, 450, 110);
      }
    },
    status_added: (e) => {
      const v = vstack(e.stackId);
      if (!v) return null;
      const sp = SPELL_BY_ID[e.spellId];
      const good = sp ? (sp.alignment ? sp.alignment === 'positive' : sp.category === 'buff') : e.status === 'invulnerable';
      effect(good ? 'buff' : 'debuff', v.x, v.y - 36, 420, 80);
      return wait(90);
    },
    spell_immune: (e) => { const v = vstack(e.stackId); return v ? floatText('Immune', v.x, v.y - 80, '#cfe8ff') : null; },
    spell_resisted: (e) => { const v = vstack(e.stackId); return v ? floatText('Resisted', v.x, v.y - 80, '#cfe8ff') : null; },
    spell_reflected: (e) => { const v = vstack(e.stackId); return v ? floatText('Reflected', v.x, v.y - 80, '#cfe8ff') : null; },
    ability: async (e) => {
      const v = vstack(e.stackId);
      if (!v) return;
      if (e.ability === 'heals') { setState(v, 'attack'); env.tween({ duration: 400 }).then(() => idle(v)); return; }
      if (['preemptive_shot', 'ranged_retaliation'].includes(e.ability)) return;
      await floatText(humanizeId(e.ability), v.x, v.y - 88, '#ffe8a0', 600, 13);
    },
    summon: async (e) => {
      const s = getStack(cs(), e.stackId);
      if (!s) return;
      const v = ensureViewStack(view, cs(), layout, s);
      const f = feetOf(layout, s, e.pos || s.pos);
      v.x = f.x; v.y = f.y; v.alive = true; v.count = e.count ?? s.count; v.alpha = 0; v.state = 'idle';
      env.sfx('spell_summon');
      effect(e.clone ? 'magic' : 'summon', f.x, f.y - 36, 600);
      await env.tween({ duration: 450, onUpdate: (t) => { v.alpha = t; } });
      v.alpha = 1;
    },
    wait: (e) => { const v = vstack(e.stackId); return v ? floatText('Wait', v.x, v.y - 80, '#e8e0c8', 500, 13) : null; },
    defend: (e) => { const v = vstack(e.stackId); return v ? effect('block', v.x, v.y - 36, 350, 80) : null; },
    obstacle_added: async (e) => {
      view.obstacleAlpha.set(e.obstacleId, 0);
      await env.tween({ duration: 380, onUpdate: (t) => view.obstacleAlpha.set(e.obstacleId, t) });
      view.obstacleAlpha.set(e.obstacleId, 1);
    },
    obstacle_triggered: (e) => {
      const v = vstack(e.stackId);
      if (!v) return null;
      return effect(e.kind === 'land_mine' ? 'explosion' : e.kind === 'fire_wall' ? 'fire' : 'earth', v.x, v.y - 30, 450);
    },
    retreat: (e) => banner(`${cs().sides[e.side]?.hero?.name || humanizeId(e.side)} retreats`, 900),
    surrender: (e) => banner(`${cs().sides[e.side]?.hero?.name || humanizeId(e.side)} surrenders`, 900),
    combat_end: (e) => {
      env.sfx(e.winner === env.viewer ? 'victory' : 'defeat');
      return banner(e.winner === 'draw' ? 'Draw' : `${humanizeId(e.winner)} wins`, 1000);
    },
    // Siege
    tower_shot: async (e) => {
      const h = structureHex(cs(), e.towerId);
      const t = vstack(e.targetId);
      if (!t) return;
      const c = h ? layout.center(h.x, h.y) : { x: HERO_POS.defender.x - 60, y: 140 };
      env.sfx('arrow');
      await projectile('arrow', { x: c.x, y: c.y - 70 }, head(t));
    },
    catapult_shot: async (e) => {
      const a = vstack(e.stackId);
      const h = structureHex(cs(), e.targetId);
      if (!h) return;
      const c = layout.center(h.x, h.y);
      if (a) setState(a, 'shoot');
      env.sfx('cannon');
      await projectile(a && a.creatureId === 'cannon' ? 'cannonball' : 'rock', a ? head(a) : { x: 60, y: 300 }, { x: c.x, y: c.y - 30 });
      if (a) idle(a);
      if (e.hit) await effect('explosion', c.x, c.y - 30, 420, 100);
      else floatText('Miss', c.x, c.y - 60, '#e8e0c8', 500, 13);
    },
    wall_damaged: (e) => {
      const h = structureHex(cs(), e.targetId);
      if (!h) return null;
      const c = layout.center(h.x, h.y);
      return effect('earth', c.x, c.y - 30, 380, 90);
    },
    wall_destroyed: (e) => {
      const h = (e.hexes && e.hexes[0]) || structureHex(cs(), e.targetId);
      if (!h) return null;
      const c = layout.center(h.x, h.y);
      env.sfx('cannon');
      return effect('explosion', c.x, c.y - 30, 600, 140);
    },
    moat_damage: (e) => { const v = vstack(e.stackId); return v ? effect('poison', v.x, v.y - 20, 300, 70) : null; },
    gate_opened: () => wait(150),
    gate_closed: () => wait(120),
    // Anything newer: best-effort generic animation.
    '*': async (e) => {
      const hexes = e.hexes || (e.hex ? [e.hex] : null);
      if (e.stackId != null && e.targetId != null && /shot|shoot|fire/.test(e.type)) {
        const a = vstack(e.stackId); const t = vstack(e.targetId);
        if (a && t) await projectile('arrow', head(a), head(t));
        return;
      }
      if (/tower/.test(e.type) && e.targetId != null) {
        const t = vstack(e.targetId);
        const side = 'defender';
        if (t) await projectile('arrow', { x: HERO_POS[side].x - 60, y: 120 }, head(t));
        return;
      }
      if (hexes && hexes.length && /wall|gate|catapult|siege|damage|destroy/.test(e.type)) {
        const c = layout.center(hexes[0].x, hexes[0].y);
        env.sfx('cannon');
        await effect('explosion', c.x, c.y - 30, 500, 110);
      }
    },
  };

  async function play(events) {
    view.busy = true;
    try {
      await playEvents(events || [], new Proxy(handlers, {
        get(t, type) {
          if (typeof type !== 'string') return undefined;
          const fn = t[type] || t['*'];
          return async (e, i) => {
            const line = describeEvent(cs(), e) ?? genericLine(e);
            if (line) env.log(line, e.type === 'round_start' ? 'info' : 'combat');
            if (env.onEvent) env.onEvent(e, i);
            await fn(e, i);
          };
        },
      }), { onError: (err, e) => { if (env.onError) env.onError(err, e); } });
    } finally {
      view.busy = false;
    }
  }

  function genericLine(e) {
    if (/wall|gate|tower|catapult|siege|moat/.test(e.type)) return `${humanizeId(e.type)}${e.stackId != null ? ` (${creatureName(getStack(cs(), e.stackId)?.creatureId)})` : ''}.`;
    return null;
  }

  return { play, handlers, resync: () => syncView(view, cs(), layout) };
}
