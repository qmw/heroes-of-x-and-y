// AI progress benchmark (docs/mechanics/ai.md "Benchmark"): all-AI games at Normal on generated
// small maps; medians over several seeds must reach sensible milestones by day 28 / 56.
// Before the strategic-AI rework (gold drained into troops, fleeing guards ignored, endless
// mutual "holding", no long-range targets) the same set reached: buildings 12 / 13.5, mines 3.5 /
// 3.5, towns 1 / 1, attacks in 5 / 7 of 22 games, a quarter of all battles lost.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { at, median } from './bench.js';

const CONFIGS = [
  { size: 'S', template: 'default', players: 2, seed: 100 },
  { size: 'S', template: 'duel', players: 2, seed: 101 },
  { size: 'S', template: 'balance', players: 2, seed: 103 },
  { size: 'S', template: 'wilderness', players: 2, seed: 104 },
  { size: 'S', template: 'small_ring', players: 2, seed: 108 },
  { size: 'S', template: 'default', players: 3, seed: 111 },
];

let games = [];

/** One game per worker thread (the games are independent and deterministic). */
function play(config) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./benchWorker.js', import.meta.url), { workerData: config });
    w.once('message', resolve);
    w.once('error', reject);
  });
}

before(async () => {
  const results = await Promise.all(CONFIGS.map((c) => play({ ...c, difficulty: 1, days: 56 })));
  games = results.map((g, i) => ({ c: CONFIGS[i], g })).filter((x) => x.g.ok);
});

const alive = (day) => games.flatMap(({ g }) => at(g, day)).filter((p) => p.alive);
const all = (day) => games.flatMap(({ g }) => at(g, day));
const describe = (day) => alive(day).map((p) => `t${p.towns} h${p.heroes} b${p.buildings} m${p.mines} a${p.army}`).join(' | ');

test('benchmark maps generate', () => {
  assert.ok(games.length >= 5, `${games.length} games`);
});

test('day 28: the economy grows (buildings, mines, heroes)', () => {
  const p = alive(28);
  assert.ok(median(p.map((x) => x.buildings)) >= 15, `buildings: ${describe(28)}`);
  assert.ok(median(p.map((x) => x.mines)) >= 4, `mines: ${describe(28)}`);
  assert.ok(median(p.map((x) => x.heroes)) >= 2, `heroes: ${describe(28)}`);
});

test('day 56: more towns, a developed capital, a growing army', () => {
  const p = alive(56);
  assert.ok(median(p.map((x) => x.buildings)) >= 20, `buildings: ${describe(56)}`);
  assert.ok(median(p.map((x) => x.mines)) >= 4, `mines: ${describe(56)}`);
  assert.ok(median(p.map((x) => x.towns)) >= 1.5, `towns (half of the survivors hold 2+): ${describe(56)}`);
  const a28 = median(alive(28).map((x) => x.army));
  const a56 = median(p.map((x) => x.army));
  assert.ok(a56 >= 2.5 * a28, `army ${a28} -> ${a56}`);
});

test('the AI seeks out its enemies: an attack on another player within 56 days in most games', () => {
  const attacked = games.filter(({ g }) => at(g, 56).some((x) => x.attacks > 0)).length;
  assert.ok(attacked >= Math.ceil(games.length * 0.66), `${attacked} of ${games.length} games`);
});

test('the AI picks its fights: few lost battles, heroes rarely idle', () => {
  const p = all(56);
  const fights = p.reduce((s, x) => s + x.fights, 0);
  const lost = p.reduce((s, x) => s + x.lost, 0);
  assert.ok(fights >= 40, `${fights} battles`);
  assert.ok(lost <= fights * 0.1, `${lost} of ${fights} battles lost`);
  assert.ok(median(p.map((x) => x.idle)) <= 15, `idle hero-days ${p.map((x) => x.idle).join(',')}`);
  assert.equal(p.reduce((s, x) => s + x.errors, 0), 0, 'no exceptions inside the AI');
});
