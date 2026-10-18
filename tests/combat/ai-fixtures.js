// Shared fixtures for the combat AI tests (not a test file): random mirror battles and a match
// runner where each side is driven by its own `chooseAction`.
import { createRng, randInt, pick, rand } from '../../src/core/rng.js';
import { FACTIONS } from '../../src/core/constants.js';
import { creaturesOfFaction } from '../../src/data/creatures.js';
import { createCombat, performAction, isOver, getResult, getLegalActions } from '../../src/engine/combat/index.js';
import { endCombat } from '../../src/engine/combat/result.js';

const SPELL_POOL = [
  'magic_arrow', 'lightning_bolt', 'ice_bolt', 'implosion', 'chain_lightning', 'fireball', 'meteor_shower', 'inferno',
  'frost_ring', 'death_ripple', 'armageddon', 'haste', 'slow', 'bless', 'curse', 'bloodlust', 'stone_skin', 'shield',
  'air_shield', 'prayer', 'weakness', 'disrupting_ray', 'blind', 'berserk', 'resurrection', 'animate_dead', 'cure',
  'dispel', 'precision', 'frenzy', 'counterstrike', 'forgetfulness', 'hypnotize', 'mirth', 'sorrow', 'fortune',
  'misfortune', 'slayer', 'fire_shield', 'anti_magic', 'magic_mirror', 'protection_from_fire',
];

/** A random but plausible side (one faction, 1-7 stacks, optional hero with spells / machines). */
export function randomMirrorSide(rng) {
  const faction = pick(rng, FACTIONS);
  const pool = creaturesOfFaction(faction);
  const n = randInt(rng, 2, 7);
  const army = [];
  const budget = randInt(rng, 3000, 40000);
  for (let k = 0; k < 7; k++) {
    if (k >= n) { army.push(null); continue; }
    const c = pick(rng, pool);
    army.push({ creatureId: c.id, count: Math.max(1, Math.round((budget / n) * (0.5 + rand(rng)) / c.aiValue)) });
  }
  let hero = null;
  if (rand(rng) < 0.75) {
    const spells = new Set();
    for (let k = randInt(rng, 2, 9); k > 0; k--) spells.add(pick(rng, SPELL_POOL));
    const lvl = randInt(rng, 0, 3);
    const knowledge = randInt(rng, 1, 12);
    hero = {
      id: 'h', name: 'H', attack: randInt(rng, 0, 10), defense: randInt(rng, 0, 10), power: randInt(rng, 1, 12),
      knowledge, mana: knowledge * 10, spells: [...spells],
      skills: { air_magic: lvl, water_magic: randInt(rng, 0, 3), earth_magic: randInt(rng, 0, 3), fire_magic: randInt(rng, 0, 3) },
      bonuses: [],
    };
  }
  const warMachines = ['ballista', 'ammo_cart', 'first_aid_tent'].filter(() => rand(rng) < 0.35);
  return { playerId: 0, isHuman: false, hero, army, warMachines };
}

/** Input of mirror battle `i`: both sides get identical troops, hero and machines. */
export function mirrorInput(i) {
  const rng = createRng(1000 + i * 7919);
  const side = randomMirrorSide(rng);
  const terrain = pick(rng, ['grass', 'dirt', 'rough', 'snow', 'sand']);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  return { seed: 50 + i, terrain, attacker: { ...clone(side), playerId: 0 }, defender: { ...clone(side), playerId: 1 } };
}

/**
 * Play a battle where `choosers[side](cs)` picks the action of that side.
 * @returns {Object} CombatResult (round cap -> defender wins by timeout, as autoResolve does)
 */
export function playMatch(input, choosers, maxRounds = 60) {
  const cs = createCombat(JSON.parse(JSON.stringify(input)));
  for (let guard = 0; guard < 20000 && !isOver(cs); guard++) {
    if (cs.round > maxRounds) break;
    let action;
    if (cs.phase === 'tactics') action = { type: 'tactics_end' };
    else action = choosers[getLegalActions(cs).side](cs);
    const res = performAction(cs, action);
    if (!res.ok) {
      const again = performAction(cs, { type: 'defend' });
      if (!again.ok) break;
    }
  }
  if (!isOver(cs)) endCombat(cs, 'defender', 'timeout', []);
  return getResult(cs);
}
