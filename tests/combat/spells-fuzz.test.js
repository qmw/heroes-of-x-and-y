// Spell fuzz: random heroes knowing random combat spells (every school, mastery, a few spell
// bonuses) fight 200 seeded battles. Half of the decisions of a side with castable spells use a
// random legal cast built only from getSpellTargets (all target modes, incl. Teleport / Sacrifice
// second steps, obstacles and hexes) - every such cast must be accepted. The rest is the baseline
// AI. No exceptions, no NaN, JSON round-trip, deterministic replays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randInt, pick, rand } from '../../src/core/rng.js';
import { CREATURES } from '../../src/data/creatures.js';
import { COMBAT_SPELLS } from '../../src/data/spells.js';
import {
  createCombat, performAction, getResult, getLegalActions, getSpellTargets, getSpellAreaPreview, getStack,
} from '../../src/engine/combat/index.js';
import { endCombat } from '../../src/engine/combat/result.js';

const SPELL_BONUSES = [
  { type: 'spell_power_percent', percent: 10 }, { type: 'spell_power_percent', school: 'fire', percent: 50 },
  { type: 'spell_duration', value: 2 }, { type: 'spell_school_mastery', school: 'water', level: 3 },
  { type: 'magic_resistance', percent: 20 }, { type: 'enemy_spell_power_percent', percent: -25 },
  { type: 'spell_reflection', percent: 20 }, { type: 'negate_resistance', side: 'both' },
  { type: 'spell_specialty', spellId: 'magic_arrow', mode: 'fixed_percent', percent: 50, heroLevel: 5 },
  { type: 'spell_specialty', spellId: 'haste', mode: 'tiered', tierBonus: [3, 3, 2, 2, 1, 1, 0], heroLevel: 5 },
  { type: 'spell_specialty', spellId: 'hypnotize', mode: 'level_scaled', percentPerStep: 3, heroLevel: 12 },
  { type: 'grants_spell', spellId: 'titans_lightning_bolt', mastery: 3, free: true },
  { type: 'block_spells', minLevel: 5, maxLevel: 5, side: 'both' },
];
const HERO_COMBAT = COMBAT_SPELLS.filter((s) => !s.special);

function randomSide(rng, i) {
  const pool = CREATURES.filter((c) => !c.warMachine);
  const army = [];
  const n = randInt(rng, 1, 7);
  for (let k = 0; k < 7; k++) {
    if (k >= n) { army.push(null); continue; }
    const c = pick(rng, pool);
    army.push({ creatureId: c.id, count: Math.max(1, Math.round(randInt(rng, 200, 3000) / c.aiValue)) });
  }
  let hero = null;
  if (rand(rng) < 0.85) {
    const spells = [];
    for (let k = randInt(rng, 3, 14); k > 0; k--) spells.push(pick(rng, HERO_COMBAT).id);
    const bonuses = [];
    for (let k = randInt(rng, 0, 3); k > 0; k--) bonuses.push(pick(rng, SPELL_BONUSES));
    const m = () => randInt(rng, 0, 3);
    hero = { id: `h${i}`, name: 'H', level: randInt(rng, 1, 30), attack: randInt(rng, 0, 10), defense: randInt(rng, 0, 10),
      power: randInt(rng, 1, 12), knowledge: randInt(rng, 1, 10), mana: randInt(rng, 20, 200), spells: [...new Set(spells)],
      skills: { air_magic: m(), water_magic: m(), earth_magic: m(), fire_magic: m() }, bonuses };
  }
  const warMachines = ['ballista', 'first_aid_tent'].filter(() => rand(rng) < 0.3);
  return { playerId: i, isHuman: false, hero, army, warMachines };
}

/** No NaN / Infinity anywhere in the state. */
function assertFinite(value, path = 'cs') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} = ${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
}

function assertSane(cs) {
  assertFinite(cs);
  const json = JSON.stringify(cs);
  assert.deepEqual(JSON.parse(json), cs, 'state must be JSON round-trippable');
  for (const s of cs.stacks) {
    assert.ok(s.count >= 0 && s.hp >= 0 && s.hp <= s.maxHp, `stack ${s.id} ${s.creatureId}: ${s.count} x ${s.hp}/${s.maxHp}`);
    if (s.alive) assert.ok(s.count > 0 && s.hp > 0);
  }
}

/** A random legal cast for `side`, built from getSpellTargets only (null when nothing). */
function randomCast(cs, side, rng) {
  const legal = getLegalActions(cs);
  if (!legal.canCast || legal.side !== side) return null;
  const spellId = pick(rng, legal.spells);
  const t = getSpellTargets(cs, side, spellId);
  let target = null;
  switch (t.mode) {
    case 'enemy_stack': case 'friendly_stack': case 'any_stack': case 'dead_friendly_stack': {
      const stackId = pick(rng, t.stackIds);
      target = stackId;
      if (t.target2 === 'hex') {
        const t2 = getSpellTargets(cs, side, spellId, { stackId });
        target = { stackId, hex: pick(rng, t2.hexes) };
      } else if (t.target2 === 'friendly_stack') {
        const t2 = getSpellTargets(cs, side, spellId, { stackId });
        target = { stackId, victimId: pick(rng, t2.stackIds) };
      }
      break;
    }
    case 'area': {
      const s = getStack(cs, pick(rng, t.stackIds));
      target = rand(rng) < 0.5 ? { ...s.pos } : { x: randInt(rng, 0, 14), y: randInt(rng, 0, 10) };
      break;
    }
    case 'hex': target = pick(rng, t.hexes); break;
    case 'obstacle': target = pick(rng, t.obstacleIds); break;
    default: target = null;
  }
  // the preview must never throw and must agree on validity for hex / stack selections
  const hex = target && typeof target === 'object' && 'x' in target ? target : null;
  getSpellAreaPreview(cs, side, spellId, hex);
  return { type: 'cast', spellId, target };
}

function runBattle(seed) {
  const rng = createRng(seed);
  const cs = createCombat({
    seed, terrain: pick(rng, ['grass', 'dirt', 'snow', 'lava', 'swamp', 'sand']),
    attacker: randomSide(rng, 0), defender: randomSide(rng, 1),
    siege: rand(rng) < 0.15 ? { fortLevel: randInt(rng, 1, 3) } : null,
  });
  const casts = { random: 0, ai: 0 };
  for (let guard = 0; guard < 3000 && cs.phase !== 'over'; guard++) {
    if (cs.round > 15) break;
    const legal = getLegalActions(cs);
    let action = null;
    if (cs.phase === 'battle' && legal.canCast && rand(rng) < 0.5) action = randomCast(cs, legal.side, rng);
    if (action) {
      const res = performAction(cs, action);
      assert.equal(res.ok, true, `seed ${seed}: legal cast rejected ${JSON.stringify(action)}: ${res.error}`);
      casts.random += 1;
      continue;
    }
    const res = performAction(cs, { type: 'auto' });
    if (res.ok && res.events.some((e) => e.type === 'spell' && e.caster === 'hero')) casts.ai += 1;
    if (!res.ok) assert.equal(performAction(cs, { type: 'defend' }).ok, true);
  }
  if (cs.phase !== 'over') endCombat(cs, 'draw', 'timeout', []);
  assertSane(cs);
  const result = getResult(cs);
  assertFinite(result, 'result');
  for (const side of ['attacker', 'defender']) {
    assert.ok(Array.isArray(result[side].spellsCast));
    assert.ok(result[side].army.every((s) => !s || (s.count > 0 && !getStack(cs, -1))));
    // summons and clones never survive
    const summoned = new Set(cs.stacks.filter((s) => s.side === side && (s.summoned || s.clone) && s.slot === null).map((s) => s.creatureId));
    const original = new Set(cs.sides[side].army.filter(Boolean).map((s) => s.creatureId));
    for (const s of result[side].army) if (s && summoned.has(s.creatureId) && !original.has(s.creatureId)) assert.fail(`summon ${s.creatureId} survived`);
  }
  return { cs, result, casts };
}

test('spell fuzz: 200 battles with random spell-casting heroes', () => {
  let random = 0;
  let ai = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { casts } = runBattle(seed * 7919);
    random += casts.random;
    ai += casts.ai;
  }
  assert.ok(random > 200, `random casts: ${random}`);
  assert.ok(ai > 50, `AI casts: ${ai}`);
});

test('spell fuzz: replays are deterministic', () => {
  for (const seed of [11, 4242, 90001]) {
    const a = runBattle(seed);
    const b = runBattle(seed);
    assert.deepEqual(a.result, b.result);
    assert.equal(JSON.stringify(a.cs), JSON.stringify(b.cs));
  }
});
