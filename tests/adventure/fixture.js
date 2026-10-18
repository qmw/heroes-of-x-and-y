// Shared fixture of the adventure tests: hermetic (fallback deps), deterministic.
import { createTestState, addTestTown } from '../../src/engine/testing.js';
import { resolvePending } from '../../src/engine/pending.js';
import * as adv from '../../src/engine/adventure/index.js';

export { adv, addTestTown };

/** Fresh state on fallback deps (the real hero/town/economy modules are NOT used). */
export function makeState(opts = {}) {
  adv.useFallbackDeps();
  const state = createTestState({ width: 16, height: 12, ...opts });
  state.map = adv.createEmptyMap(opts.width || 16, opts.height || 12, opts.levels || 1, opts.terrain || 'grass');
  return state;
}

/** Add a hero with a predictable army (10 pikemen: speed 4 -> but movePoints fixed to 1500 unless given). */
export function addHero(state, o = {}) {
  const hero = adv.deps.addHero(state, o.defId || 'christian', o.owner ?? 0, o.pos || { x: 1, y: 1, z: 0 }, { id: o.id });
  hero.army = new Array(7).fill(null);
  (o.army || [{ creatureId: 'pikeman', count: 10 }]).forEach((s, i) => { hero.army[i] = { ...s }; });
  hero.skills = o.skills || [];
  hero.spells = o.spells || [];
  hero.primary = { attack: 1, defense: 1, power: 1, knowledge: 1, ...(o.primary || {}) };
  hero.mana = o.mana ?? 10;
  hero.artifacts.equipped.spellbook[0] = o.noBook ? null : 'spellbook';
  hero.movePoints = o.movePoints ?? 1500;
  hero.maxMovePoints = o.maxMovePoints ?? hero.movePoints;
  hero.level = o.level ?? 1;
  return hero;
}

export function setTiles(state, cells, patch) {
  for (const [x, y, z = 0] of cells) Object.assign(state.map.tiles[z][y][x], patch);
}

export function fillRect(state, x0, y0, x1, y1, patch, z = 0) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) Object.assign(state.map.tiles[z][y][x], patch);
}

/** Resolve the oldest pending of the state. */
export function answer(state, optionIndex, extra) {
  const p = state.pending[0];
  if (!p) throw new Error('no pending to answer');
  return resolvePending(state, p.id, optionIndex, extra);
}

/** Resolve the pending by option id. */
export function answerId(state, optionId, extra, match = () => true) {
  const p = state.pending[0];
  if (!p) throw new Error('no pending to answer');
  const idx = p.options.findIndex((o) => o.id === optionId && match(o));
  if (idx < 0) throw new Error(`pending ${p.kind} has no option ${optionId}: ${JSON.stringify(p.options)}`);
  return resolvePending(state, p.id, idx, extra);
}

/** Finish the stubbed battle. `survivors` = defender army left when the attacker loses. */
export function finishCombat(state, winner = 'attacker', survivors = null) {
  const army = survivors ? survivors.concat(new Array(7).fill(null)).slice(0, 7) : new Array(7).fill(null);
  if (winner !== 'attacker' && state.combat) {
    // the losing hero is removed, as the real finishCombat would do
    const id = state.combat.attackerHeroId;
    const res = { winner, attacker: { army: new Array(7).fill(null) }, defender: { army } };
    adv.deps.removeHero(state, id, 'defeated');
    return adv.finishStubCombat(state, res);
  }
  return adv.finishStubCombat(state, { winner, attacker: { army: [] }, defender: { army } });
}

export const kinds = (state) => state.pending.map((p) => p.kind);
export const eventTypes = (res) => (res.events || []).map((e) => e.type);
export const visitResults = (res) => (res.events || []).filter((e) => e.type === 'visit').map((e) => e.result);
export const assertJson = (assert, state) => assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
