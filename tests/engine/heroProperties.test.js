// Property tests (seeded random operation sequences) for the hero/army/artifact engines:
// conservation laws and structural invariants. Audit: docs/audit/heroes-artifacts.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTIFACT_SLOTS, SLOT_COUNTS, ARMY_SLOTS, MAX_SECONDARY_SKILLS, PRIMARY_SKILLS } from '../../src/core/constants.js';
import { createRng, randInt, pick, chance } from '../../src/core/rng.js';
import { ARTIFACTS, getArtifact, COMBO_ARTIFACTS } from '../../src/data/artifacts.js';
import { CREATURES } from '../../src/data/creatures.js';
import { HEROES } from '../../src/data/heroes.js';
import {
  createEmptyArtifacts, giveArtifact, equip, unequip, moveArtifact, assemble, disassemble,
  transferArtifact, getEquippedArtifacts, getAssemblableCombos, entryId, removeArtifact,
} from '../../src/engine/artifacts.js';
import { createArmy, armyAdd, armyRemove, armyMove, armyTotalCount } from '../../src/engine/army.js';
import { createHero, gainExperience, applySkillChoice, offerSecondarySkills } from '../../src/engine/leveling.js';

const SEEDS = [1, 7, 42, 1234, 99991];

// ---------------------------------------------------------------------------------- artifacts

/** Multiset of base (non-combo) artifact ids a hero holds, combos expanded into components. */
function baseItems(h) {
  const out = {};
  const add = (id) => {
    const def = getArtifact(id);
    if (def.components) def.components.forEach(add);
    else out[id] = (out[id] || 0) + 1;
  };
  for (const e of getEquippedArtifacts(h)) add(e.id);
  for (const e of h.artifacts.backpack) add(entryId(e));
  return out;
}
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v;
  return out;
}

function checkInvariants(h) {
  const arts = h.artifacts;
  for (const slot of ARTIFACT_SLOTS) {
    assert.equal(arts.equipped[slot].length, SLOT_COUNTS[slot], slot);
    arts.equipped[slot].forEach((entry, i) => {
      if (entry == null) return;
      const def = getArtifact(entryId(entry));
      assert.equal(def.slot, slot, `${def.id} in ${slot}`);
      if (def.slotIndex != null) assert.equal(i, def.slotIndex, def.id);
      assert.ok(!def.backpackOnly, def.id);
      assert.equal(arts.locks[`${slot}:${i}`], undefined, `occupied slot ${slot}:${i} is also locked`);
    });
  }
  for (const entry of arts.backpack) assert.ok(!getArtifact(entryId(entry)).noBackpack, entryId(entry));
  // every lock points to an equipped combo, and each combo locks exactly components-1 slots
  const lockCount = {};
  for (const [k, owner] of Object.entries(arts.locks)) {
    const [s, i] = [owner.slice(0, owner.lastIndexOf(':')), Number(owner.slice(owner.lastIndexOf(':') + 1))];
    const holder = arts.equipped[s][i];
    assert.ok(holder != null, `lock ${k} -> empty ${owner}`);
    assert.ok(getArtifact(entryId(holder)).components, `lock ${k} -> non-combo`);
    lockCount[owner] = (lockCount[owner] || 0) + 1;
  }
  for (const e of getEquippedArtifacts(h)) {
    const def = getArtifact(e.id);
    if (def.components) assert.equal(lockCount[`${e.slot}:${e.index}`] || 0, def.components.length - 1, def.id);
  }
}

const POOL = ARTIFACTS.filter((a) => !a.components && !a.instanced && !a.backpackOnly && a.id !== 'spellbook').map((a) => a.id);
const COMPONENTS = [...new Set(COMBO_ARTIFACTS.flatMap((c) => c.components))];

function randomLocation(rng, h) {
  if (chance(rng, 0.5) && h.artifacts.backpack.length) return { backpack: randInt(rng, 0, h.artifacts.backpack.length - 1) };
  const slot = pick(rng, ARTIFACT_SLOTS);
  return { slot, index: randInt(rng, 0, SLOT_COUNTS[slot] - 1) };
}

test('property: artifact operations conserve items and keep slots/locks consistent', () => {
  for (const seed of SEEDS) {
    const rng = createRng(seed);
    const a = { id: 'a', artifacts: createEmptyArtifacts() };
    const b = { id: 'b', artifacts: createEmptyArtifacts() };
    let expected = {};
    for (let step = 0; step < 400; step++) {
      const h = chance(rng, 0.5) ? a : b;
      const other = h === a ? b : a;
      const before = merge(baseItems(a), baseItems(b));
      const op = randInt(rng, 0, 7);
      let r;
      let delta = null;
      if (op === 0) {
        const id = chance(rng, 0.6) ? pick(rng, COMPONENTS) : pick(rng, POOL);
        r = giveArtifact(h, id);
        if (r.ok) delta = id;
      } else if (op === 1 && h.artifacts.backpack.length) {
        const slot = pick(rng, ARTIFACT_SLOTS);
        r = equip(h, randInt(rng, 0, h.artifacts.backpack.length - 1), chance(rng, 0.5) ? undefined : slot,
          chance(rng, 0.5) ? undefined : randInt(rng, 0, SLOT_COUNTS[slot] - 1));
      } else if (op === 2) {
        const slot = pick(rng, ARTIFACT_SLOTS);
        r = unequip(h, slot, randInt(rng, 0, SLOT_COUNTS[slot] - 1));
      } else if (op === 3) {
        r = moveArtifact(h, randomLocation(rng, h), randomLocation(rng, h));
      } else if (op === 4) {
        const combos = getAssemblableCombos(h);
        if (combos.length) r = assemble(h, pick(rng, combos));
      } else if (op === 5) {
        const combos = getEquippedArtifacts(h).filter((e) => getArtifact(e.id).components)
          .concat(h.artifacts.backpack.filter((e) => getArtifact(entryId(e)).components).map((e) => ({ id: entryId(e) })));
        if (combos.length) r = disassemble(h, pick(rng, combos).id);
      } else if (op === 6) {
        const items = [...getEquippedArtifacts(h).map((e) => ({ slot: e.slot, index: e.index })),
          ...h.artifacts.backpack.map((_, i) => ({ backpack: i }))];
        if (items.length) r = transferArtifact(h, other, pick(rng, items), chance(rng, 0.3) ? { backpack: true } : undefined);
      } else if (op === 7 && h.artifacts.backpack.length && chance(rng, 0.3)) {
        const e = h.artifacts.backpack[0];
        r = removeArtifact(h, { backpack: 0 });
        delta = { remove: entryId(e) };
      }
      const after = merge(baseItems(a), baseItems(b));
      if (r && r.ok && delta) {
        if (typeof delta === 'string') expected = merge(before, { [delta]: 1 });
        else {
          const removed = {};
          const add = (id) => { const d = getArtifact(id); if (d.components) d.components.forEach(add); else removed[id] = (removed[id] || 0) - 1; };
          add(delta.remove);
          expected = Object.fromEntries(Object.entries(merge(before, removed)).filter(([, v]) => v !== 0));
        }
      } else expected = before;
      assert.deepEqual(after, expected, `seed ${seed} step ${step} op ${op}`);
      checkInvariants(a);
      checkInvariants(b);
      assert.deepEqual(JSON.parse(JSON.stringify(a.artifacts)), a.artifacts);
    }
  }
});

test('property: assembling then disassembling any combo restores the exact equipment', () => {
  for (const combo of COMBO_ARTIFACTS) {
    const h = { id: 'h', artifacts: createEmptyArtifacts() };
    for (const c of combo.components) assert.equal(giveArtifact(h, c).ok, true, `${combo.id}: ${c}`);
    const snapshot = JSON.stringify(h.artifacts.equipped);
    assert.ok(assemble(h, combo.id).ok, combo.id);
    checkInvariants(h);
    assert.ok(disassemble(h, combo.id).ok, combo.id);
    assert.equal(JSON.stringify(h.artifacts.equipped), snapshot, combo.id);
    assert.deepEqual(h.artifacts.locks, {});
  }
});

// ---------------------------------------------------------------------------------- armies

const NON_MACHINES = CREATURES.filter((c) => !c.warMachine).map((c) => c.id);

function census(...armies) {
  const out = {};
  for (const army of armies) for (const s of army) if (s) out[s.creatureId] = (out[s.creatureId] || 0) + s.count;
  return out;
}

test('property: army moves conserve creatures; slots never hold empty or negative stacks', () => {
  for (const seed of SEEDS) {
    const rng = createRng(seed);
    const a = createArmy();
    const b = createArmy();
    const kinds = Array.from({ length: 5 }, () => pick(rng, NON_MACHINES));
    for (let step = 0; step < 600; step++) {
      const x = chance(rng, 0.5) ? a : b;
      const y = chance(rng, 0.5) ? a : b;
      const before = census(a, b);
      const op = randInt(rng, 0, 9);
      if (op <= 1) {
        const id = pick(rng, kinds);
        const n = randInt(rng, 1, 30);
        if (armyAdd(x, id, n)) before[id] = (before[id] || 0) + n;
      } else if (op === 2) {
        const slot = randInt(rng, 0, ARMY_SLOTS - 1);
        const id = x[slot]?.creatureId;
        const removed = armyRemove(x, slot, chance(rng, 0.5) ? undefined : randInt(rng, 0, 40));
        if (removed) before[id] -= removed;
        if (before[id] === 0) delete before[id];
      } else {
        const i = randInt(rng, 0, ARMY_SLOTS - 1);
        const count = x[i] && chance(rng, 0.5) ? randInt(rng, 1, x[i].count) : undefined;
        const keep = chance(rng, 0.5);
        const totalA = armyTotalCount(x);
        const r = armyMove(x, i, y, randInt(rng, 0, ARMY_SLOTS - 1), count, { keepA: keep });
        if (r.ok && keep && x !== y) assert.ok(armyTotalCount(x) > 0 || totalA === 0, `seed ${seed} step ${step}: emptied a kept army`);
      }
      assert.deepEqual(census(a, b), before, `seed ${seed} step ${step} op ${op}`);
      for (const army of [a, b]) {
        assert.equal(army.length, ARMY_SLOTS);
        for (const s of army) if (s) assert.ok(Number.isInteger(s.count) && s.count > 0, JSON.stringify(s));
      }
    }
  }
});

// ---------------------------------------------------------------------------------- careers

test('property: long careers keep primaries sane, skills capped and level-ups consistent', () => {
  const sample = HEROES.filter((_, i) => i % 9 === 0);
  for (const [n, def] of sample.entries()) {
    const rng = createRng(1000 + n);
    const hero = createHero(rng, def.id);
    const start = { ...hero.primary };
    let gained = 0;
    for (let step = 0; step < 40; step++) {
      const { levelUps } = gainExperience(rng, hero, randInt(rng, 500, 30000));
      for (const [k, lu] of levelUps.entries()) {
        gained++;
        const offers = k === 0 && lu.offers ? lu.offers : (lu.offers ?? offerSecondarySkills(rng, hero));
        assert.ok(offers.length <= 2);
        assert.equal(new Set(offers.map((o) => o.skillId)).size, offers.length);
        if (offers.length) {
          const choice = pick(rng, offers);
          const r = applySkillChoice(hero, choice.skillId);
          assert.ok(r.ok, `${def.id}: ${choice.skillId}`);
          assert.equal(r.level, choice.level);
        }
      }
    }
    assert.ok(hero.skills.length <= MAX_SECONDARY_SKILLS, def.id);
    assert.equal(new Set(hero.skills.map((s) => s.id)).size, hero.skills.length, def.id);
    for (const s of hero.skills) assert.ok(s.level >= 1 && s.level <= 3);
    const total = PRIMARY_SKILLS.reduce((sum, p) => sum + hero.primary[p] - start[p], 0);
    assert.equal(total, gained, `${def.id}: one primary point per level`);
    for (const p of PRIMARY_SKILLS) assert.ok(hero.primary[p] >= start[p]);
    assert.equal(hero.level, 1 + gained);
  }
});
