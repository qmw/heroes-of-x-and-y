// AI progress benchmark CLI (docs/mechanics/ai.md "Benchmark").
//   node tools/ai-bench.mjs [difficulty=1] [days=56] [games=12]
// Plays all-AI games on generated S/M maps (one worker thread per game) and prints per-game lines
// and medians of the surviving players at day 28 / 56.
import { Worker } from 'node:worker_threads';
import { at, median } from '../tests/ai/bench.js';

const difficulty = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 56);
const count = Number(process.argv[4] ?? 12);
const TEMPLATES = ['default', 'duel', 'small_ring', 'balance', 'wilderness', 'ring'];
const configs = Array.from({ length: count }, (_, i) => ({
  size: i % 6 === 5 ? 'M' : 'S', template: TEMPLATES[i % 6], players: i % 4 === 3 ? 3 : 2, seed: 100 + i, difficulty, days,
}));

const play = (c) => new Promise((resolve) => {
  const w = new Worker(new URL('../tests/ai/benchWorker.js', import.meta.url), { workerData: c });
  w.once('message', resolve);
  w.once('error', (e) => resolve({ ok: false, error: e.message }));
});

const games = [];
for (let i = 0; i < configs.length; i += 6) games.push(...await Promise.all(configs.slice(i, i + 6).map(play)));
games.forEach((g, i) => {
  const c = configs[i];
  if (!g.ok) { console.log(`${c.size} ${c.template} ${c.players}p s${c.seed}: ${g.error}`); return; }
  const fmt = (p) => `${p.alive ? '' : 'DEAD '}t${p.towns} h${p.heroes} b${p.buildings} m${p.mines} a${Math.round(p.army / 1000)}k att${p.attacks} lost${p.lost}/${p.fights} idle${p.idle}`;
  console.log(`${c.size} ${c.template} ${c.players}p s${c.seed}${g.gameOver ? ` (over day ${g.gameOver.turn})` : ''}\n  d28 ${at(g, 28).map(fmt).join(' | ')}\n  d${days} ${at(g, days).map(fmt).join(' | ')}`);
});
const ok = games.filter((g) => g.ok);
for (const day of [28, days]) {
  const all = ok.flatMap((g) => at(g, day));
  const alive = all.filter((p) => p.alive);
  const m = (k) => median(alive.map((p) => p[k]));
  const sum = (k) => all.reduce((s, p) => s + p[k], 0);
  console.log(`day ${day}: towns ${m('towns')} heroes ${m('heroes')} buildings ${m('buildings')} mines ${m('mines')} army ${m('army')} gold ${m('gold')} idle ${m('idle')}`
    + ` | battles ${sum('fights')} lost ${sum('lost')} | games with an attack ${ok.filter((g) => at(g, day).some((p) => p.attacks > 0)).length}/${ok.length}`
    + ` | eliminated ${all.length - alive.length}/${all.length}`);
}
