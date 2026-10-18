import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateFromTurn, advanceDate, absoluteWeek, rollWeekEvent, weekCreaturePool, monthCreaturePool,
  WEEK_OF_CREATURE_CHANCE, MONTH_OF_CREATURE_CHANCE, PLAGUE_CHANCE, WEEK_OF_GROWTH_BONUS, DAYS_PER_MONTH,
} from '../../src/engine/calendar.js';
import { getCreature } from '../../src/data/creatures.js';
import { startNewDay, setGameDeps } from '../../src/engine/game.js';
import { setup, town } from './fixture.js';

/** State whose next `randInt(rng, 0, 99)` returns `roll` (searches a seed). */
function stateWithRoll(roll, base = {}) {
  for (let seed = 1; seed < 5000; seed++) {
    const s = setup({ seed });
    const probe = { s: s.rng.s };
    // same arithmetic as core/rng.js randInt(0, 99)
    probe.s = (probe.s + 0x6d2b79f5) >>> 0;
    let t = probe.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const v = Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 100);
    if (v === roll) return Object.assign(s, base);
  }
  throw new Error(`no seed for roll ${roll}`);
}

test('dateFromTurn: 7-day weeks, 4-week months', () => {
  assert.deepEqual(dateFromTurn(1), { day: 1, week: 1, month: 1 });
  assert.deepEqual(dateFromTurn(7), { day: 7, week: 1, month: 1 });
  assert.deepEqual(dateFromTurn(8), { day: 1, week: 2, month: 1 });
  assert.deepEqual(dateFromTurn(28), { day: 7, week: 4, month: 1 });
  assert.deepEqual(dateFromTurn(29), { day: 1, week: 1, month: 2 });
  assert.deepEqual(dateFromTurn(60), { day: 4, week: 1, month: 3 });
  assert.deepEqual(dateFromTurn(365), { day: 1, week: 1, month: 14 });
  assert.equal(DAYS_PER_MONTH, 28);
});

test('advanceDate reports week and month boundaries', () => {
  const s = setup();
  const flags = [];
  for (let i = 0; i < 56; i++) {
    const f = advanceDate(s);
    if (f.newWeek) flags.push([s.turn, f.newMonth]);
    assert.deepEqual(s.date, dateFromTurn(s.turn));
  }
  assert.deepEqual(flags, [[8, false], [15, false], [22, false], [29, true], [36, false], [43, false], [50, false], [57, true]]);
  assert.equal(s.turn, 57);
  assert.equal(absoluteWeek(s), 9);
  s.turn = 7;
  assert.equal(absoluteWeek(s), 1);
});

test('creature pools: weeks any town creature (tiers 1-7, both forms), months un-upgraded tiers 1-6', () => {
  const week = weekCreaturePool();
  const month = monthCreaturePool();
  assert.equal(week.length, 11 * 14 + 2, 'Factory has two tier-7 pairs');
  assert.equal(new Set(week).size, week.length);
  assert.equal(month.length, 66);
  for (const id of month) assert.equal(getCreature(id).upgraded, false);
  assert.ok(week.includes('halberdier') && week.includes('arch_angel') && week.includes('juggernaut'));
  for (const id of week) assert.notEqual(getCreature(id).faction, 'neutral', id);
  assert.ok(week.includes('angel') && !month.includes('angel'));
  assert.ok(month.includes('pikeman') && month.includes('cavalier'));
});

test('new week roll: < 25 -> week of a creature, otherwise a plain week', () => {
  assert.equal(WEEK_OF_CREATURE_CHANCE, 25);
  for (const roll of [0, 24]) {
    const s = stateWithRoll(roll);
    const w = rollWeekEvent(s, false);
    assert.equal(w.kind, 'week_of', `roll ${roll}`);
    assert.ok(weekCreaturePool().includes(w.creatureId));
    assert.equal(w.name, `Week of the ${getCreature(w.creatureId).name}`);
    assert.equal(s.weekOf, w);
  }
  for (const roll of [25, 60, 99]) {
    const w = rollWeekEvent(stateWithRoll(roll), false);
    assert.deepEqual([w.kind, w.creatureId], ['normal', null], `roll ${roll}`);
    assert.match(w.name, /^Week of the \w+/);
  }
});

test('new month roll: < 40 month of a creature, 40-49 plague (not in month 1), else plain', () => {
  assert.deepEqual([MONTH_OF_CREATURE_CHANCE, PLAGUE_CHANCE], [40, 10]);
  const month2 = { date: { day: 1, week: 1, month: 2 } };
  for (const roll of [0, 39]) {
    const w = rollWeekEvent(stateWithRoll(roll, month2), true);
    assert.equal(w.kind, 'month_of');
    assert.ok(monthCreaturePool().includes(w.creatureId));
    assert.equal(w.name, `Month of the ${getCreature(w.creatureId).name}`);
  }
  for (const roll of [40, 49]) {
    const w = rollWeekEvent(stateWithRoll(roll, month2), true);
    assert.deepEqual([w.kind, w.creatureId, w.name], ['plague', null, 'Month of the Plague']);
  }
  for (const roll of [50, 99]) {
    const w = rollWeekEvent(stateWithRoll(roll, month2), true);
    assert.equal(w.kind, 'normal');
    assert.match(w.name, /^Month of the \w+/);
  }
  // no plague in the first month
  const first = rollWeekEvent(stateWithRoll(45, { date: { day: 1, week: 1, month: 1 } }), true);
  assert.equal(first.kind, 'normal');
});

test('forceWeekEvent: single object or a queue consumed week by week', () => {
  const s = setup();
  s.settings.forceWeekEvent = [{ kind: 'week_of', creatureId: 'imp' }, { kind: 'plague' }];
  assert.deepEqual(rollWeekEvent(s, false), { kind: 'week_of', creatureId: 'imp', name: 'Week of the Imp' });
  assert.equal(rollWeekEvent(s, true).kind, 'plague');
  assert.deepEqual(s.settings.forceWeekEvent, []);
  const rngBefore = s.rng.s;
  rollWeekEvent(s, false);
  assert.notEqual(s.rng.s, rngBefore, 'queue empty: back to rolling');
  s.settings.forceWeekEvent = { kind: 'month_of', creatureId: 'gremlin', name: 'Custom' };
  assert.deepEqual(rollWeekEvent(s, true), { kind: 'month_of', creatureId: 'gremlin', name: 'Custom' });
  assert.equal(rollWeekEvent(s, true).kind, 'month_of', 'a single object applies every week');
});

test('game loop: week of the creature gives +5 growth that week only', () => {
  const s = setup();
  s.settings.forceWeekEvent = [{ kind: 'week_of', creatureId: 'pikeman' }, { kind: 'normal' }];
  const t = town(s, { buildings: ['fort', 'castle_dwelling_1', 'castle_dwelling_2'] });
  let events = [];
  for (let d = 0; d < 7; d++) events = startNewDay(s).events;
  assert.equal(WEEK_OF_GROWTH_BONUS, 5);
  assert.deepEqual(t.stock, { pikeman: 14 + 19, archer: 18 });
  const wk = events.find((e) => e.type === 'week_started');
  assert.deepEqual(wk.weekOf, { kind: 'week_of', creatureId: 'pikeman', name: 'Week of the Pikeman' });
  assert.deepEqual(wk.date, { day: 1, week: 2, month: 1 });
  assert.ok(s.log.some((e) => e.type === 'week_started' && e.turn === 8));
  for (let d = 0; d < 7; d++) startNewDay(s);
  assert.deepEqual(t.stock, { pikeman: 14 + 19 + 14, archer: 27 });
});

test('game loop: month of the creature doubles, plague halves, month_started event', () => {
  const s = setup();
  s.settings.forceWeekEvent = [
    { kind: 'normal' }, { kind: 'normal' }, { kind: 'normal' },
    { kind: 'month_of', creatureId: 'archer' }, { kind: 'normal' }, { kind: 'normal' }, { kind: 'normal' },
    { kind: 'plague' },
  ];
  const t = town(s, { buildings: ['fort', 'castle_dwelling_1', 'castle_dwelling_2'] });
  let last = [];
  for (let d = 0; d < 28; d++) last = startNewDay(s).events;
  assert.deepEqual(s.date, { day: 1, week: 1, month: 2 });
  // 5 weeks of growth: pikemen 70; archers (9 * 5) doubled = 90
  assert.deepEqual(t.stock, { pikeman: 70, archer: 90 });
  assert.equal(last.filter((e) => e.type === 'month_started').length, 1);
  assert.ok(last.some((e) => e.type === 'population_doubled' && e.creatureId === 'archer'));
  assert.equal(s.weekOf.name, 'Month of the Archer');
  for (let d = 0; d < 28; d++) last = startNewDay(s).events;
  // 3 more normal weeks, then the plague halves instead of growing
  assert.deepEqual(t.stock, { pikeman: Math.floor((70 + 42) / 2), archer: Math.floor((90 + 27) / 2) });
  assert.ok(last.some((e) => e.type === 'plague'));
});

test('game loop: month-of calls the spawnMonthMonsters hook', () => {
  const s = setup();
  const calls = [];
  setGameDeps({ spawnMonthMonsters: (state, creatureId) => { calls.push([state.turn, creatureId]); return { ok: true, events: [{ type: 'monsters_spawned', creatureId }] }; } });
  s.settings.forceWeekEvent = [{ kind: 'week_of', creatureId: 'imp' }, { kind: 'normal' }, { kind: 'normal' }, { kind: 'month_of', creatureId: 'gog' }];
  let last = [];
  for (let d = 0; d < 28; d++) last = startNewDay(s).events;
  assert.deepEqual(calls, [[29, 'gog']]);
  assert.ok(last.some((e) => e.type === 'monsters_spawned'));
});
