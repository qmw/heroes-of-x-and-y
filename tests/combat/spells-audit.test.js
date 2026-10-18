// Magic audit (docs/audit/spells.md): original SoD values pinned from a hand-made table, and a
// table-driven check that EVERY hero combat spell is castable through the UI-facing API
// (getCastableSpells -> getSpellTargets -> castHeroSpell) at every mastery in a realistic battle,
// costs exactly its mastery cost and does something observable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpell, ORIGINAL_SPELLS, COMBAT_SPELLS, spellDuration } from '../../src/data/spells.js';
import { MASTERY } from '../../src/core/constants.js';
import {
  createCombat, getCastableSpells, getSpellTargets, castHeroSpell, getSpellAreaPreview, applyDamage, placeObstacle,
} from '../../src/engine/combat/index.js';
import { addStatus } from '../../src/engine/combat/effects.js';
import { QUIET } from './helpers.js';
import { arena, cast, castFail, D } from './spells-helpers.js';
import { createTestState } from '../../src/engine/testing.js';
import { addHero, buildCombatSide } from '../../src/engine/hero.js';
import { giveArtifact, makeScroll } from '../../src/engine/artifacts.js';

// ---- original mana costs [none, basic, advanced, expert] (SoD spell table) -----------------------

const COSTS = {
  // level 1
  bless: [5, 4], bloodlust: [5, 4], cure: [6, 5], curse: [6, 5], dispel: [5, 4], haste: [6, 5],
  magic_arrow: [5, 4], protection_from_fire: [5, 4], protection_from_water: [5, 4], shield: [5, 4],
  slow: [6, 5], stone_skin: [5, 4], summon_boat: [8, 7], view_air: [2, 1], view_earth: [2, 1],
  // level 2
  blind: [10, 8], death_ripple: [10, 8], disguise: [4, 2], disrupting_ray: [10, 8], fire_wall: [8, 6],
  fortune: [7, 5], ice_bolt: [8, 6], lightning_bolt: [10, 8], precision: [8, 6], protection_from_air: [7, 5],
  quicksand: [8, 6], remove_obstacle: [7, 5], scuttle_boat: [8, 6], visions: [4, 2], weakness: [8, 6],
  // level 3
  air_shield: [12, 9], animate_dead: [15, 12], anti_magic: [15, 12], destroy_undead: [15, 12],
  earthquake: [20, 17], fireball: [15, 12], force_field: [12, 9], forgetfulness: [12, 9], frost_ring: [12, 9],
  hypnotize: [18, 15], land_mine: [18, 15], mirth: [12, 9], misfortune: [12, 9], protection_from_earth: [12, 9],
  teleport: [15, 12, 3, 3],
  // level 4
  armageddon: [24, 20], berserk: [20, 16], chain_lightning: [24, 20], clone: [24, 20], counterstrike: [24, 20],
  fire_shield: [16, 12], frenzy: [16, 12], inferno: [16, 12], meteor_shower: [16, 12], prayer: [16, 12],
  resurrection: [20, 16], slayer: [16, 12], sorrow: [16, 12], town_portal: [16, 12], water_walk: [12, 9],
  // level 5
  dimension_door: [25, 20], fly: [20, 15], implosion: [30, 25], magic_mirror: [25, 20], sacrifice: [25, 20],
  summon_air_elemental: [25, 20], summon_earth_elemental: [25, 20], summon_fire_elemental: [25, 20],
  summon_water_elemental: [25, 20], titans_lightning_bolt: [0, 0],
};
const four = (c) => (c.length === 4 ? c : [c[0], c[1], c[1], c[1]]);

test('audit: mana cost of all 70 original spells at every mastery (school mastery discount)', () => {
  assert.equal(Object.keys(COSTS).length, 70);
  for (const s of ORIGINAL_SPELLS) assert.deepEqual(s.costByMastery, four(COSTS[s.id]), s.id);
});

test('audit: durations - SP rounds for buffs / debuffs, fixed ones for obstacles, Frenzy, Berserk', () => {
  const power = ['shield', 'air_shield', 'fire_shield', 'protection_from_air', 'protection_from_fire',
    'protection_from_water', 'protection_from_earth', 'anti_magic', 'magic_mirror', 'bless', 'curse', 'bloodlust',
    'precision', 'weakness', 'stone_skin', 'prayer', 'mirth', 'sorrow', 'fortune', 'misfortune', 'haste', 'slow',
    'slayer', 'counterstrike', 'hypnotize', 'forgetfulness', 'blind', 'clone'];
  for (const id of power) assert.equal(getSpell(id).duration, 'power', id);
  // SP 5 + Ring of Conjuring (+2) + Collar (+1) + Cape (+3) = 11 rounds
  assert.equal(spellDuration(getSpell('haste'), MASTERY.EXPERT, 5, 6), 11);
  assert.equal(spellDuration(getSpell('frenzy'), MASTERY.EXPERT, 5, 6), 1, 'until its next turn only');
  assert.equal(spellDuration(getSpell('berserk'), MASTERY.EXPERT, 5, 6), 1);
  for (const id of ['force_field', 'fire_wall']) assert.equal(spellDuration(getSpell(id), 1, 9, 6), 2, id);
  for (const id of ['quicksand', 'land_mine', 'disrupting_ray']) assert.equal(getSpell(id).duration, 'battle', id);
  for (const id of ['magic_arrow', 'implosion', 'cure', 'resurrection', 'dispel', 'teleport', 'earthquake']) {
    assert.equal(getSpell(id).duration, null, id);
  }
});

test('audit: summoned elementals - only one kind per side per battle', () => {
  const cs = arena(['summon_air_elemental', 'summon_earth_elemental'], { m: 3, power: 2 });
  cast(cs, 'summon_air_elemental');
  const air = cs.stacks.find((s) => s.creatureId === 'air_elemental');
  assert.equal(air.count, 8, '4 x SP at expert');
  applyDamage(cs, air, 1e6, { kind: 'test' }, []);
  assert.equal(air.alive, false);
  assert.equal(getSpellTargets(cs, 'attacker', 'summon_earth_elemental').available, false);
  assert.equal(castFail(cs, 'summon_earth_elemental'), 'no_target');
  // the other side is independent
  assert.equal(cs.sides.defender.summonedKind, null);
});

test('audit: no spell book, no casting - not even scroll / artifact spells (combat)', () => {
  const grant = { type: 'grants_spell', spellId: 'magic_arrow' };
  const withBook = arena([], { bonuses: [grant] });
  assert.deepEqual(getCastableSpells(withBook, 'attacker'), ['magic_arrow']);
  const cs = arena([], { bonuses: [grant] });
  cs.sides.attacker.hero.spellbook = false;
  assert.deepEqual(getCastableSpells(cs, 'attacker'), []);
  assert.equal(castFail(cs, 'magic_arrow', D(cs).id), 'unknown_spell');
});

test('audit: buildCombatSide passes the spell-book flag; a scroll without a book is not castable', () => {
  const state = createTestState();
  const knight = addHero(state, 'orrin', 0, { x: 2, y: 2, z: 0 }, { army: [{ creatureId: 'pikeman', count: 10 }] });
  giveArtifact(knight, makeScroll('magic_arrow'));
  const side = buildCombatSide(state, { heroId: knight.id });
  assert.equal(side.hero.spellbook, false);
  const cs = createCombat({ seed: 1, terrain: 'grass', attacker: side,
    defender: { playerId: 1, isHuman: false, hero: null, army: [{ creatureId: 'goblin', count: 10 }] },
    force: { chance: QUIET } });
  assert.deepEqual(getCastableSpells(cs, 'attacker'), []);
  giveArtifact(knight, 'spellbook');
  const side2 = buildCombatSide(state, { heroId: knight.id });
  assert.equal(side2.hero.spellbook, true);
});

// ---- every hero combat spell through the UI-facing API -------------------------------------------

const HERO_COMBAT = COMBAT_SPELLS.map((s) => s.id);
const ARMY = (l) => l.map((s) => (s ? { creatureId: s[0], count: s[1] } : null));

/**
 * Realistic battle: shooters, undead, a small stack (HP-limited spells), a dead and a wounded
 * friendly stack, a natural obstacle; a siege for Earthquake. The attacker hero (SP 4) knows every
 * combat spell and wears Titan's Thunder's grant.
 */
function scene(spellId, m) {
  const hero = {
    id: 'h', name: 'H', level: 12, attack: 2, defense: 2, power: 4, knowledge: 10, mana: 500, maxMana: 500,
    spells: HERO_COMBAT.filter((id) => id !== 'titans_lightning_bolt'),
    skills: { air_magic: m, earth_magic: m, fire_magic: m, water_magic: m },
    bonuses: [{ type: 'grants_spell', spellId: 'titans_lightning_bolt', mastery: 3, free: true }],
  };
  const cs = createCombat({
    seed: 7, terrain: 'grass',
    attacker: { playerId: 0, isHuman: true, hero, warMachines: [],
      army: ARMY([['archer', 20], ['pikeman', 30], ['skeleton', 20], ['griffin', 10], ['swordsman', 10], ['zombie', 10], ['monk', 6]]) },
    defender: { playerId: 1, isHuman: false, hero: null, warMachines: [],
      army: ARMY([['wood_elf', 20], ['goblin', 3], ['walking_dead', 20], ['minotaur', 5], ['wolf_rider', 15]]) },
    siege: spellId === 'earthquake' ? { fortLevel: 2 } : null,
    obstacles: [],
    force: { chance: QUIET, damage: 'max' },
  });
  const st = (id) => cs.stacks.find((s) => s.creatureId === id);
  applyDamage(cs, st('swordsman'), 1e6, { kind: 'test' }, []); // fully dead friendly stack
  applyDamage(cs, st('pikeman'), 25, { kind: 'test' }, []); // wounded living
  applyDamage(cs, st('skeleton'), 30, { kind: 'test' }, []); // wounded undead
  addStatus(cs, st('archer'), 'slow', { mastery: 1, rounds: 3, casterSide: 'defender' }); // for Dispel / Cure
  if (!cs.siege) placeObstacle(cs, { kind: 'boulder', hexes: [{ x: 7, y: 10 }], magical: false });
  const a = st('archer');
  a.acted = false;
  cs.active = a.id;
  return cs;
}

const STACK_MODES = ['enemy_stack', 'friendly_stack', 'any_stack', 'dead_friendly_stack'];
/** Pick a legal target from getSpellTargets only (what the UI does). */
function pickTarget(cs, spellId) {
  const t = getSpellTargets(cs, 'attacker', spellId);
  let target = null;
  if (STACK_MODES.includes(t.mode)) target = t.stackIds[0];
  else if (t.mode === 'area') {
    // first hex whose preview affects an enemy (Frost Ring: the ring around an empty hex)
    for (let y = 0; y < 11 && !target; y++) {
      for (let x = 0; x < 15 && !target; x++) {
        const p = getSpellAreaPreview(cs, 'attacker', spellId, { x, y });
        if (p.valid && p.stackIds.some((id) => cs.stacks.find((s) => s.id === id).side === 'defender')) target = { x, y };
      }
    }
  } else if (t.mode === 'hex') target = t.hexes[0];
  else if (t.mode === 'obstacle') target = t.obstacleIds[0];
  if (t.target2 === 'hex') target = { stackId: target, hex: getSpellTargets(cs, 'attacker', spellId, { stackId: target }).hexes[0] };
  if (t.target2 === 'friendly_stack') target = { stackId: target, victimId: getSpellTargets(cs, 'attacker', spellId, { stackId: target }).stackIds[0] };
  return { t, target };
}

const EFFECT_EVENTS = ['damage', 'status_added', 'status_removed', 'heal', 'resurrect', 'summon', 'move',
  'obstacle_added', 'obstacle_removed', 'wall_damaged', 'death'];

test('audit: every hero combat spell is castable via getCastableSpells / getSpellTargets / castHeroSpell at every mastery', () => {
  // HP-limited extras need a stack under 15/20*SP + base: the 3 goblins (15 HP) qualify at every mastery.
  for (let m = 0; m <= 3; m++) {
    const castable = getCastableSpells(scene('magic_arrow', m), 'attacker');
    for (const id of HERO_COMBAT) {
      if (id === 'earthquake') continue; // siege only (checked below)
      assert.ok(castable.includes(id), `${id} castable at mastery ${m}`);
    }
    assert.ok(!castable.includes('earthquake'), 'Earthquake needs a siege');
    for (const id of HERO_COMBAT) {
      const cs = scene(id, m);
      assert.ok(getCastableSpells(cs, 'attacker').includes(id), `${id}/m${m} castable in its scene`);
      const { target } = pickTarget(cs, id);
      const mana = cs.sides.attacker.hero.mana;
      const res = castHeroSpell(cs, 'attacker', id, target);
      assert.equal(res.ok, true, `${id}/m${m}: ${res.error}`);
      const spellEv = res.events[0];
      assert.equal(spellEv.type, 'spell');
      assert.equal(spellEv.mastery, id === 'titans_lightning_bolt' ? 3 : m, `${id} mastery`);
      const cost = id === 'titans_lightning_bolt' ? 0 : getSpell(id).costByMastery[m];
      assert.equal(spellEv.cost, cost, `${id}/m${m} cost`);
      assert.equal(cs.sides.attacker.hero.mana, mana - cost);
      assert.ok(res.events.slice(1).some((e) => EFFECT_EVENTS.includes(e.type)), `${id}/m${m} did something: ${res.events.map((e) => e.type)}`);
      assert.equal(cs.sides.attacker.castThisRound, true);
      assert.equal(castHeroSpell(cs, 'attacker', id, target).error, 'already_cast', 'one cast per round');
      JSON.parse(JSON.stringify(cs)); // state stays plain JSON
    }
  }
});

test('audit: mass spells at expert need no target and hit every eligible stack of the side', () => {
  const cs = scene('haste', 3);
  const t = getSpellTargets(cs, 'attacker', 'haste');
  assert.equal(t.mode, 'all_friendly');
  const res = castHeroSpell(cs, 'attacker', 'haste', null);
  assert.equal(res.ok, true);
  const hasted = res.events.filter((e) => e.type === 'status_added').map((e) => e.stackId).sort();
  const alive = cs.stacks.filter((s) => s.alive && s.side === 'attacker').map((s) => s.id).sort();
  assert.deepEqual(hasted, alive);
  const cs2 = scene('slow', 3);
  const res2 = castHeroSpell(cs2, 'attacker', 'slow', null);
  const slowed = res2.events.filter((e) => e.type === 'status_added').map((e) => e.stackId).sort();
  assert.deepEqual(slowed, cs2.stacks.filter((s) => s.alive && s.side === 'defender').map((s) => s.id).sort());
});

test('audit: hand-computed damage through the API (SP 4): Implosion, Lightning Bolt, Armageddon on undead & living', () => {
  // Implosion expert: 300 + 75*4 = 600 on wood elves (15 hp, 20 of them = 300 hp) -> all die
  let cs = scene('implosion', 3);
  const elves = cs.stacks.find((s) => s.creatureId === 'wood_elf');
  let res = castHeroSpell(cs, 'attacker', 'implosion', elves.id);
  assert.equal(res.events.find((e) => e.type === 'damage').amount, 600);
  // Lightning Bolt basic: 10 + 25*4 = 110 on minotaurs (50 hp) -> 2 die, top creature at 40
  cs = scene('lightning_bolt', 1);
  const mino = cs.stacks.find((s) => s.creatureId === 'minotaur');
  castHeroSpell(cs, 'attacker', 'lightning_bolt', mino.id);
  assert.deepEqual([mino.count, mino.hp], [3, 40]);
  // Armageddon advanced: 60 + 50*4 = 260 to every stack incl. own
  cs = scene('armageddon', 2);
  res = castHeroSpell(cs, 'attacker', 'armageddon', null);
  const amounts = new Set(res.events.filter((e) => e.type === 'damage').map((e) => e.amount));
  assert.deepEqual([...amounts], [260]);
  const hit = new Set(res.events.filter((e) => e.type === 'damage').map((e) => e.stackId));
  assert.equal(hit.size, cs.stacks.filter((s) => s.creatureId !== 'swordsman').length, 'every stack (both sides) once');
});

test('audit: Bless max damage (+3 % at advanced/expert), Curse min damage (-20 %, floor, min 1)', async () => {
  const { rollBaseDamage } = await import('../../src/engine/combat/damage.js');
  const base = (spellId, m, defCount = 100) => {
    const cs = arena([spellId], { m, att: [['pikeman', 100]], def: [['pikeman', defCount]] });
    const target = spellId === 'bless' ? cs.stacks.find((s) => s.side === 'attacker') : D(cs);
    cast(cs, spellId, m === 3 ? null : target.id);
    return rollBaseDamage(cs, target, false); // pikeman 1-3 damage
  };
  assert.deepEqual([0, 1, 2, 3].map((m) => base('bless', m)), [300, 300, 309, 309]);
  assert.deepEqual([0, 1, 2, 3].map((m) => base('curse', m)), [100, 100, 80, 80]);
  assert.equal(base('curse', 2, 1), 1, 'floor, minimum 1');
  assert.equal(base('bless', 2), 309);
});
