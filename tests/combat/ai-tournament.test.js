// Combat AI: A/B tournament against the frozen baseline, difficulty levels, timings,
// determinism and a fuzz run with random difficulty levels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randInt, pick, rand } from '../../src/core/rng.js';
import { CREATURES } from '../../src/data/creatures.js';
import { createCombat, autoResolve, performAction, isOver, getResult } from '../../src/engine/combat/index.js';
import { chooseAction } from '../../src/engine/combat/ai.js';
import { chooseAction as baseline } from '../../src/engine/combat/ai/baseline.js';
import { mirrorInput, playMatch, randomMirrorSide } from './ai-fixtures.js';
import { battle } from './helpers.js';

test('A/B: the AI beats the baseline in 200 seeded mirror battles with swapped sides', () => {
  let wins = 0;
  let games = 0;
  for (let i = 0; i < 100; i++) {
    const input = mirrorInput(i);
    const asAttacker = playMatch(input, { attacker: chooseAction, defender: baseline });
    const asDefender = playMatch(input, { attacker: baseline, defender: chooseAction });
    if (asAttacker.winner === 'attacker') wins++;
    if (asDefender.winner === 'defender') wins++;
    games += 2;
  }
  const pct = (100 * wins) / games;
  // measured: ~84% (2026-10)
  assert.ok(pct > 65, `new AI won only ${pct.toFixed(1)}% of ${games} games`);
});

test('difficulty: level 4 clearly beats level 0; levels are clamped and default to 4', () => {
  const lvl = (level) => (cs) => chooseAction(cs, { level });
  let wins = 0;
  let games = 0;
  for (let i = 200; i < 225; i++) {
    const input = mirrorInput(i);
    if (playMatch(input, { attacker: lvl(4), defender: lvl(0) }).winner === 'attacker') wins++;
    if (playMatch(input, { attacker: lvl(0), defender: lvl(4) }).winner === 'defender') wins++;
    games += 2;
  }
  assert.ok(wins / games > 0.6, `hard AI won ${wins}/${games}`);
  // side.aiLevel is carried into the state
  const input = mirrorInput(3);
  input.attacker.aiLevel = 1;
  const cs = createCombat(input);
  assert.equal(cs.sides.attacker.aiLevel, 1);
  assert.equal(cs.sides.defender.aiLevel, null);
  assert.doesNotThrow(() => chooseAction(cs, { level: 99 }));
});

test('performance: chooseAction is fast and a full battle auto-resolves well under 300 ms', () => {
  autoResolve(createCombat(mirrorInput(1))); // warm up the JIT
  const battleMs = [];
  let calls = 0;
  let callMs = 0;
  for (let i = 0; i < 12; i++) {
    const input = mirrorInput(i);
    const cs = createCombat(input);
    const t0 = performance.now();
    for (let g = 0; g < 5000 && !isOver(cs) && cs.round <= 100; g++) {
      const t = performance.now();
      const a = chooseAction(cs);
      callMs += performance.now() - t;
      calls++;
      if (!performAction(cs, a).ok) performAction(cs, { type: 'defend' });
    }
    battleMs.push(performance.now() - t0);
  }
  battleMs.sort((a, b) => a - b);
  const median = battleMs[Math.floor(battleMs.length / 2)];
  const mean = callMs / calls;
  // measured: ~2 ms per decision, median battle ~70 ms, largest 7v7 battles ~300 ms
  // Wall-clock budgets are strict only with PERF=1; under a loaded parallel test run they get 10x slack.
  const slack = process.env.PERF ? 1 : 10;
  assert.ok(mean < 20 * slack, `chooseAction mean ${mean.toFixed(2)} ms`);
  assert.ok(median < 300 * slack, `median battle ${median.toFixed(0)} ms`);
});

test('determinism: same input -> same battle; chooseAction never consumes the rng', () => {
  const input = mirrorInput(17);
  const a = createCombat(JSON.parse(JSON.stringify(input)));
  const b = createCombat(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(autoResolve(a), autoResolve(b));
  assert.deepEqual(a, b);
  const c = createCombat(JSON.parse(JSON.stringify(input)));
  const rng = JSON.stringify(c.rng);
  for (let k = 0; k < 5; k++) chooseAction(c);
  assert.equal(JSON.stringify(c.rng), rng);
});

test('round cap: an unfinished autoResolve is a defender win by timeout', () => {
  const stuck = battle([['pikeman', 10]], [['imp', 10]], { obstacles: [{ kind: 'boulder', hexes: Array.from({ length: 11 }, (_, y) => ({ x: 7, y })) }] });
  const r = autoResolve(stuck, { maxRounds: 4 });
  assert.equal(r.winner, 'defender');
  assert.equal(r.reason, 'timeout');
  assert.ok(r.expDefender >= 0 && r.defender.army[0].count === 10);
});

test('fuzz: random armies, heroes, sieges and difficulty levels never break the AI', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = createRng(seed * 31337);
    const side = (i) => {
      const s = randomMirrorSide(rng);
      if (rand(rng) < 0.3) {
        s.army = s.army.map((x) => (x && rand(rng) < 0.5 ? { creatureId: pick(rng, CREATURES.filter((c) => !c.warMachine)).id, count: randInt(rng, 1, 30) } : x));
      }
      return { ...s, playerId: i, aiLevel: randInt(rng, 0, 4), gold: rand(rng) < 0.5 ? randInt(rng, 0, 20000) : undefined };
    };
    const input = {
      seed, terrain: pick(rng, ['grass', 'snow', 'lava', 'swamp']), attacker: side(0), defender: side(1),
      siege: seed % 7 === 0 ? { fortLevel: 3, faction: 'castle', buildings: [] } : null, bank: seed % 11 === 0,
    };
    const cs = createCombat(input);
    try {
      for (let g = 0; g < 4000 && !isOver(cs) && cs.round <= 40; g++) {
        const a = chooseAction(cs);
        const res = performAction(cs, a);
        assert.equal(res.ok, true, `${JSON.stringify(a)}: ${res.error}`);
      }
    } catch (err) {
      err.message = `seed ${seed}: ${err.message}`;
      throw err;
    }
    if (isOver(cs)) assert.ok(getResult(cs));
  }
});
