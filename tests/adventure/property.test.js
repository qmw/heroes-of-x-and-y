// Property tests of the adventure map on generated maps: heroes of AI-controlled players (battles are
// quick-resolved) walk to random reachable tiles / objects for several days, every pending choice is
// answered at random. Invariants checked after every action:
//  - no exception, move points never negative, no hero on an impassable / blocked tile or at sea
//    without a boat, no two heroes on one tile;
//  - explored tiles only ever increase (except after a Cover of Darkness);
//  - revisit rules: a per-hero object rewards a hero at most once, a `once` object at most once,
//    a per-player object a player at most once, a weekly object at most once per week, a daily
//    object a hero at most once per day;
//  - the state survives a JSON round-trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMap } from '../../src/engine/mapgen/index.js';
import { createGame, endTurn, setAiDriver, serialize, deserialize } from '../../src/engine/game.js';
import { resetGameDeps } from '../../src/engine/gameDeps.js';
import { resolvePending } from '../../src/engine/pending.js';
import { createRng, randInt, pick, chance } from '../../src/core/rng.js';
import { getTerrain } from '../../src/data/terrain.js';
import { getMapObject } from '../../src/data/mapObjects.js';
import * as adv from '../../src/engine/adventure/index.js';
import * as heroMod from '../../src/engine/hero.js';
import { HEROES } from '../../src/data/heroes.js';

/** Visit results that mean "the object gave its reward" (see visit.js / services.js `note`). */
const GRANTED = new Set(['primary', 'exp', 'primary_all', 'level_up', 'skill_learned', 'skill_upgraded', 'spell_learned',
  'reward', 'bank_cleared', 'map_revealed', 'mana', 'temp_bonus']);

function exploredCount(player) {
  return (player.explored || []).reduce((n, lvl) => n + (lvl ? lvl.reduce((a, b) => a + b, 0) : 0), 0);
}

function checkHeroes(state, label) {
  const seen = new Set();
  for (const h of Object.values(state.heroes)) {
    if (h.garrisoned) continue;
    assert.ok(h.movePoints >= 0, `${label}: ${h.id} movePoints ${h.movePoints}`);
    const t = adv.getTile(state.map, h.pos);
    assert.ok(t, `${label}: ${h.id} off the map`);
    const ter = getTerrain(t.t);
    assert.ok(ter.passable, `${label}: ${h.id} on impassable ${t.t}`);
    assert.ok(!t.blocked, `${label}: ${h.id} on a blocked tile ${JSON.stringify(h.pos)}`);
    assert.equal(ter.water, !!h.inBoat, `${label}: ${h.id} water=${ter.water} inBoat=${h.inBoat}`);
    const k = `${h.pos.x},${h.pos.y},${h.pos.z || 0}`;
    assert.ok(!seen.has(k), `${label}: two heroes on ${k}`);
    seen.add(k);
  }
}

/** Answer every pending choice at random (trying other options when one is refused). */
function drainPendings(state, rng, onEvents) {
  for (let guard = 0; state.pending && state.pending.length && guard < 200; guard++) {
    const p = state.pending[0];
    const n = Math.max(1, p.options.length);
    const start = randInt(rng, 0, n - 1);
    let done = false;
    for (let i = 0; i < n && !done; i++) {
      const idx = (start + i) % n;
      const before = state.pending.length;
      const r = resolvePending(state, p.id, p.options.length ? idx : 0);
      onEvents(r.events || []);
      // a refused answer may re-queue the same pending; try the next option
      done = r.ok || !state.pending.some((q) => q.id === p.id) || state.pending.length !== before;
      if (!r.ok && state.pending.some((q) => q.id === p.id)) done = false;
    }
    if (!done) {
      // no option is acceptable without extra input (e.g. a trade dialog): the last option leaves
      const r = resolvePending(state, p.id, n - 1);
      onEvents(r.events || []);
      if (state.pending[0] && state.pending[0].id === p.id) state.pending.shift();
    }
  }
  assert.equal((state.pending || []).length, 0, 'pendings drained');
}

function simulate({ mapOpts, days, seed }) {
  resetGameDeps();
  adv.resetDeps();
  setAiDriver(null);
  const bp = generateMap(mapOpts);
  assert.notEqual(bp.ok, false, bp.error);
  const n = bp.meta.playerSlots;
  const state = createGame(bp, { seed, difficulty: 1, players: Array.from({ length: n }, (_, i) => ({ slot: i, isHuman: false, faction: 'random' })) });
  const rng = createRng(seed * 7919 + 1);
  // two more heroes per player next to the first one
  const used = new Set(Object.values(state.heroes).map((h) => h.defId));
  for (const p of state.players) {
    const first = state.heroes[p.heroes[0]];
    if (!first) continue;
    let added = 0;
    for (let r = 1; r <= 4 && added < 2; r++) {
      for (let dy = -r; dy <= r && added < 2; dy++) {
        for (let dx = -r; dx <= r && added < 2; dx++) {
          const pos = { x: first.pos.x + dx, y: first.pos.y + dy, z: first.pos.z || 0 };
          const t = adv.getTile(state.map, pos);
          if (!t || t.blocked || t.obj || getTerrain(t.t).water || !getTerrain(t.t).passable || adv.getHeroAt(state, pos)) continue;
          const def = HEROES.find((d) => !d.special && !used.has(d.id));
          used.add(def.id);
          heroMod.addHero(state, def.id, p.id, pos);
          added++;
        }
      }
    }
  }
  // a solid army so that most fights are won and the walk goes on (some heroes still die)
  for (const h of Object.values(state.heroes)) {
    const free = h.army.findIndex((x) => !x);
    if (free >= 0) h.army[free] = { creatureId: 'angel', count: 4 + randInt(rng, 0, 6) };
  }
  const granted = {}; // key -> count
  let hiddenSinceCheck = false;
  const stats = { moves: 0, visits: 0, pickups: 0, fights: 0 };

  const record = (events) => {
    for (const e of events) {
      if (e.type === 'visit' && e.result === 'map_hidden') hiddenSinceCheck = true;
      if (e.type === 'combat') stats.fights++;
      if (e.type === 'pickup') stats.pickups++;
      if (e.type !== 'visit' || !GRANTED.has(e.result) || e.refused) continue;
      stats.visits++;
      const def = getMapObject(e.defId);
      const h = state.heroes[e.heroId];
      const week = Math.floor((state.turn - 1) / 7) + 1;
      const key = {
        per_hero: `h:${e.heroId}:${e.objectId}`,
        once: `o:${e.objectId}`,
        per_player: h ? `p:${h.owner}:${e.objectId}` : null,
        weekly: `w:${week}:${e.objectId}`,
        per_hero_daily: `d:${state.turn}:${e.heroId}:${e.objectId}`,
        per_hero_weekly: `hw:${week}:${e.heroId}:${e.objectId}`,
      }[def.revisit];
      if (!key) continue;
      granted[key] = (granted[key] || 0) + 1;
      assert.equal(granted[key], 1, `revisit rule '${def.revisit}' broken for ${e.defId} (${key}) result ${e.result}`);
    }
  };

  // the AI driver is the random walker: endTurn calls it for every player every day
  const walk = (st, playerId) => {
    const player = st.players.find((p) => p.id === playerId);
    const explored = st.players.map(exploredCount);
    hiddenSinceCheck = false;
    for (const heroId of [...(player.heroes || [])]) {
      for (let step = 0; step < 10; step++) {
        const h = st.heroes[heroId];
        if (!h || h.garrisoned || h.movePoints <= 0) break;
        const reach = adv.getReachable(st, heroId, 0);
        if (!reach.length) break;
        const objects = reach.filter((r) => r.kind !== 'move' && r.kind !== 'transit');
        const target = objects.length && chance(rng, 0.8) ? pick(rng, objects) : pick(rng, reach);
        const before = h.movePoints;
        let res;
        assert.doesNotThrow(() => { res = adv.moveHero(st, heroId, { x: target.x, y: target.y, z: target.z }); }, `move ${heroId}`);
        stats.moves++;
        record(res.events || []);
        drainPendings(st, rng, record);
        const after = st.heroes[heroId];
        if (after && res.ok && !(res.events || []).some((e) => e.type === 'visit' || e.type === 'pickup')) {
          assert.ok(after.movePoints <= before, `walking never adds points (${before} -> ${after.movePoints})`);
        }
        checkHeroes(st, `turn ${st.turn} ${heroId}`);
        // re-visit the object the hero now stands on: revisit rules must hold
        if (after && chance(rng, 0.3)) {
          const t = adv.getTile(st.map, after.pos);
          if (t && t.obj && st.map.objects[t.obj]) {
            const v = adv.visitObject(st, heroId, t.obj);
            record(v.events || []);
            drainPendings(st, rng, record);
            checkHeroes(st, `revisit ${heroId}`);
          }
        }
      }
    }
    if (!hiddenSinceCheck) {
      st.players.forEach((p, i) => assert.ok(exploredCount(p) >= explored[i], `fog of player ${p.id} shrank`));
    }
    return { events: [] };
  };
  setAiDriver(walk);
  try {
    for (let day = 0; day < days && !state.gameOver; day++) {
      const r = endTurn(state);
      assert.ok(r.ok, JSON.stringify(r));
      checkHeroes(state, `after endTurn ${state.turn}`);
      assert.deepEqual(deserialize(serialize(state)), state, 'JSON round-trip');
    }
  } finally {
    setAiDriver(null);
  }
  return { state, stats };
}

for (const [label, mapOpts, seed] of [
  ['S default', { size: 'S', template: 'default', players: 2, seed: 101 }, 1],
  ['S duel two levels', { size: 'S', template: 'duel', players: 2, seed: 202, levels: 2 }, 2],
  ['S wilderness', { size: 'S', template: 'wilderness', players: 2, seed: 303 }, 3],
  ['M archipelago (boats)', { size: 'M', template: 'archipelago', players: 2, seed: 404 }, 4],
]) {
  test(`property: random hero walks on a generated map keep the adventure invariants (${label})`, async () => {
    if (heroMod.engineReady) await heroMod.engineReady;
    const { stats } = simulate({ mapOpts, days: 14, seed });
    if (process.env.ADV_PROP_DEBUG) console.log(label, stats);
    assert.ok(stats.moves > 100, `moves: ${stats.moves}`);
    assert.ok(stats.visits > 0, `object visits: ${stats.visits}`);
  });
}
