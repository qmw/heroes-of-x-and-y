// Damage spells: every damage spell at every mastery (hand-computed), the multiplier pipeline
// (spells.md §3.1), immunity / resistance / vulnerability samples, chain lightning, areas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addStatus, getSpellTargets } from '../../src/engine/combat/index.js';
import { place } from './helpers.js';
import { arena, cast, castFail, dmgOn, A, D, hero, allSchools } from './spells-helpers.js';

// SP = 2 everywhere below; value = power[m] + perPower * 2 (spells.md §6.1 table).
const SINGLE = {
  magic_arrow: [30, 30, 40, 50], // 10/10/20/30 + 10 SP
  ice_bolt: [50, 50, 60, 90], // 10/10/20/50 + 20 SP
  lightning_bolt: [60, 60, 70, 100], // 10/10/20/50 + 25 SP
  implosion: [250, 250, 350, 450], // 100/100/200/300 + 75 SP
  fire_bolt: [50, 50, 60, 90], // extra: 10/10/20/50 + 20 SP
  stone_spikes: [40, 40, 50, 70], // extra: 10/10/20/40 + 15 SP
};
const AREA = {
  fireball: [35, 35, 50, 80], // 15/15/30/60 + 10 SP, radius 1
  inferno: [40, 40, 60, 100], // 20/20/40/80 + 10 SP, radius 2
  meteor_shower: [75, 75, 100, 150], // 25/25/50/100 + 25 SP
  storm: [50, 50, 70, 110], // extra: 20/20/40/80 + 15 SP, radius 2
  frost_ring: [35, 35, 50, 80], // 15/15/30/60 + 10 SP, ring 1 (aimed next to the target)
};
const ALL = {
  death_ripple: [20, 20, 30, 40], // 10/10/20/30 + 5 SP
  armageddon: [130, 130, 160, 220], // 30/30/60/120 + 50 SP
  tidal_wave: [70, 70, 100, 160], // extra: 30/30/60/120 + 20 SP, enemies only
  destroy_undead: [30, 30, 40, 70], // 10/10/20/50 + 10 SP, undead only
};

for (const [spellId, values] of Object.entries(SINGLE)) {
  test(`damage: ${spellId} at every mastery`, () => {
    for (let m = 0; m < 4; m++) {
      const cs = arena([spellId], { m, power: 2 });
      const ev = cast(cs, spellId, D(cs).id);
      assert.equal(dmgOn(ev, D(cs)), values[m], `${spellId} m${m}`);
      assert.equal(ev[0].type, 'spell');
      assert.deepEqual(ev[0].affected, [D(cs).id]);
    }
  });
}

for (const [spellId, values] of Object.entries(AREA)) {
  test(`damage: ${spellId} (area) at every mastery`, () => {
    for (let m = 0; m < 4; m++) {
      const cs = arena([spellId], { m, power: 2 });
      const aim = spellId === 'frost_ring' ? { x: 13, y: 5 } : { x: 14, y: 5 };
      const ev = cast(cs, spellId, aim);
      assert.equal(dmgOn(ev, D(cs)), values[m], `${spellId} m${m}`);
      assert.equal(dmgOn(ev, A(cs)), 0, 'own stack far away');
    }
  });
}

for (const [spellId, values] of Object.entries(ALL)) {
  test(`damage: ${spellId} (whole battlefield) at every mastery`, () => {
    for (let m = 0; m < 4; m++) {
      const undead = spellId === 'destroy_undead';
      const cs = arena([spellId], { m, power: 2, def: [[undead ? 'skeleton' : 'pikeman', 1000]] });
      const ev = cast(cs, spellId);
      assert.equal(dmgOn(ev, D(cs)), values[m], `${spellId} m${m}`);
      const friendly = dmgOn(ev, A(cs));
      if (spellId === 'tidal_wave' || undead) assert.equal(friendly, 0);
      else assert.equal(friendly, values[m], 'side-agnostic: own stacks are hit and cannot resist');
    }
  });
}

test('death ripple skips undead and war machines; destroy undead only hits undead', () => {
  const cs = arena(['death_ripple', 'destroy_undead'], { power: 2, att: [['pikeman', 100], ['skeleton', 100]], def: [['zombie', 100], ['imp', 100]], machinesD: ['ballista'] });
  const ev = cast(cs, 'death_ripple');
  assert.deepEqual([dmgOn(ev, A(cs, 0)), dmgOn(ev, A(cs, 1)), dmgOn(ev, D(cs, 0)), dmgOn(ev, D(cs, 1))], [20, 0, 0, 20]);
  assert.equal(ev.filter((e) => e.type === 'damage' && cs.stacks.find((s) => s.id === e.stackId).warMachine).length, 0);
  const ev2 = cast(cs, 'destroy_undead');
  assert.deepEqual([dmgOn(ev2, A(cs, 0)), dmgOn(ev2, A(cs, 1)), dmgOn(ev2, D(cs, 0)), dmgOn(ev2, D(cs, 1))], [0, 30, 30, 0]);
});

test("Titan's Lightning Bolt: only through the artifact, free, flat 600, counts as the round's cast", () => {
  const grant = { type: 'grants_spell', spellId: 'titans_lightning_bolt', mastery: 3, free: true };
  const cs = arena([], { power: 20, mana: 0, bonuses: [grant] });
  const ev = cast(cs, 'titans_lightning_bolt', D(cs).id);
  assert.equal(dmgOn(ev, D(cs)), 600);
  assert.equal(ev[0].cost, 0);
  assert.equal(castFail(arena(['titans_lightning_bolt']), 'titans_lightning_bolt', 2), 'unknown_spell', 'not castable from a spell book alone');
  // earth elementals are lightning-immune, air elementals take double
  const cs2 = arena([], { bonuses: [grant], def: [['earth_elemental', 10], ['air_elemental', 100]] });
  assert.deepEqual(getSpellTargets(cs2, 'attacker', 'titans_lightning_bolt').stackIds, [D(cs2, 1).id]);
  assert.equal(dmgOn(cast(cs2, 'titans_lightning_bolt', D(cs2, 1).id), D(cs2, 1)), 1200);
});

test('multiplier pipeline: Sorcery, best school orb for Magic Arrow, per-spell %, specialty, eclipse, interference', () => {
  // basic Magic Arrow at SP 10: 10 + 100 = 110
  const bonuses = [
    { type: 'spell_power_percent', percent: 10 }, // Sorcery: x1.1
    { type: 'spell_power_percent', school: 'air', percent: 50 }, // orbs: Magic Arrow uses the best single school
    { type: 'spell_power_percent', school: 'fire', percent: 20 },
    { type: 'spell_power_percent', spellId: 'magic_arrow', percent: 20 }, // x1.2
  ];
  let cs = arena(['magic_arrow'], { m: 1, power: 10, bonuses });
  assert.equal(dmgOn(cast(cs, 'magic_arrow', D(cs).id), D(cs)), 217); // floor(110 * 1.1 * 1.5 * 1.2 = 217.8)
  // fire orb only applies to fire spells: Fire Bolt basic SP 10 = 10 + 200 = 210 * 1.1 * 1.2
  cs = arena(['fire_bolt'], { m: 1, power: 10, bonuses });
  assert.equal(dmgOn(cast(cs, 'fire_bolt', D(cs).id), D(cs)), 277); // floor(277.2)
  // Ciele: fixed +50% Magic Arrow
  cs = arena(['magic_arrow'], { m: 1, power: 10, bonuses: [{ type: 'spell_specialty', spellId: 'magic_arrow', mode: 'fixed_percent', percent: 50, heroLevel: 1 }] });
  assert.equal(dmgOn(cast(cs, 'magic_arrow', D(cs).id), D(cs)), 165);
  // level-scaled specialty: x(1 + 3% * floor(level / target tier)); Lightning Bolt basic SP 10 = 260
  const spec = [{ type: 'spell_specialty', spellId: 'lightning_bolt', mode: 'level_scaled', percentPerStep: 3, heroLevel: 10 }];
  cs = arena(['lightning_bolt'], { m: 1, power: 10, bonuses: spec, def: [['pikeman', 1000], ['giant', 100]] });
  assert.equal(dmgOn(cast(cs, 'lightning_bolt', D(cs, 0).id), D(cs, 0)), 338, 'tier 1: x1.30');
  assert.equal(dmgOn(cast(cs, 'lightning_bolt', D(cs, 1).id), D(cs, 1)), 267, 'tier 7: x1.03 (267.8)');
  // enemy Plate of Dying Light style -50%: SP 10 -> 5 => 10 + 50
  cs = arena(['magic_arrow'], { m: 1, power: 10, heroD: hero({ bonuses: [{ type: 'enemy_spell_power_percent', percent: -50 }] }) });
  assert.equal(dmgOn(cast(cs, 'magic_arrow', D(cs).id), D(cs)), 60);
  // Interference 30%: SP ceil(10 * 0.7) = 7 => 80
  cs = arena(['magic_arrow'], { m: 1, power: 10, heroD: hero({ bonuses: [{ type: 'interference', percent: 30 }] }) });
  assert.equal(dmgOn(cast(cs, 'magic_arrow', D(cs).id), D(cs)), 80);
});

test('per-target reductions: Protection from Fire, golems, petrified, Orb of Vulnerability', () => {
  let cs = arena(['fire_bolt'], { m: 1, power: 2, def: [['pikeman', 1000], ['iron_golem', 100]] });
  addStatus(cs, D(cs, 0), 'protection_from_fire', { mastery: 1, casterSide: 'defender' });
  assert.equal(dmgOn(cast(cs, 'fire_bolt', D(cs, 0).id), D(cs, 0)), 35, '50 x (1 - 30%)');
  addStatus(cs, D(cs, 0), 'protection_from_fire', { mastery: 3, casterSide: 'defender' });
  assert.equal(dmgOn(cast(cs, 'fire_bolt', D(cs, 0).id), D(cs, 0)), 25, 'recast replaces: 50%');
  assert.equal(dmgOn(cast(cs, 'fire_bolt', D(cs, 1).id), D(cs, 1)), 12, 'iron golem -75%: 12.5');
  cs = arena(['magic_arrow'], { m: 1, power: 2, def: [['iron_golem', 100]], bonuses: [{ type: 'negate_resistance', immunities: true, side: 'both' }] });
  assert.equal(dmgOn(cast(cs, 'magic_arrow', D(cs).id), D(cs)), 30, 'Orb of Vulnerability ignores golem reduction');
  cs = arena(['implosion'], { m: 1, power: 2 });
  addStatus(cs, D(cs), 'petrify', { casterSide: 'attacker', rounds: 3 });
  assert.equal(dmgOn(cast(cs, 'implosion', D(cs).id), D(cs)), 125, 'stone: half damage');
  assert.equal(D(cs).effects.length, 0, 'damage breaks the petrification');
});

test('elemental immunity / vulnerability matrix (spells.md §5.3)', () => {
  const rows = [
    // [creature, spell, aim, expected damage | 'immune']
    ['fire_elemental', 'fire_bolt', 'stack', 'immune'],
    ['fire_elemental', 'ice_bolt', 'stack', 100],
    ['water_elemental', 'ice_bolt', 'stack', 'immune'],
    ['water_elemental', 'fire_bolt', 'stack', 100],
    ['water_elemental', 'armageddon', null, 260],
    ['earth_elemental', 'lightning_bolt', 'stack', 'immune'],
    ['earth_elemental', 'armageddon', null, 0],
    ['earth_elemental', 'meteor_shower', 'hex', 150],
    ['air_elemental', 'meteor_shower', 'hex', 0],
    ['air_elemental', 'lightning_bolt', 'stack', 120],
    ['air_elemental', 'armageddon', null, 260],
    ['efreet', 'fireball', 'hex', 0],
    ['skeleton', 'death_ripple', null, 0],
  ];
  for (const [creature, spellId, aim, expected] of rows) {
    const cs = arena([spellId], { m: 1, power: 2, def: [[creature, 100]] });
    if (expected === 'immune') {
      assert.equal(getSpellTargets(cs, 'attacker', spellId).stackIds.includes(D(cs).id), false, `${creature} ${spellId}`);
      assert.equal(castFail(cs, spellId, D(cs).id), 'no_target');
      continue;
    }
    const target = aim === 'stack' ? D(cs).id : aim === 'hex' ? { ...D(cs).pos } : null;
    assert.equal(dmgOn(cast(cs, spellId, target), D(cs)), expected, `${creature} ${spellId}`);
  }
});

test('level immunities: green (1-3), gold (1-4), black dragon (all); Orb of Vulnerability lifts them', () => {
  const cs = arena(['magic_arrow', 'lightning_bolt', 'chain_lightning', 'implosion', 'haste'], { m: 1, power: 2, att: [['black_dragon', 1]], def: [['green_dragon', 5], ['gold_dragon', 5], ['black_dragon', 5]] });
  const ids = (spellId) => getSpellTargets(cs, 'attacker', spellId).stackIds;
  assert.deepEqual(ids('magic_arrow'), []);
  assert.deepEqual(ids('chain_lightning'), [D(cs, 0).id]);
  assert.deepEqual(ids('implosion'), [D(cs, 0).id, D(cs, 1).id]);
  assert.deepEqual(ids('haste'), [], 'friendly spells do not affect the black dragon either');
  const orb = arena(['magic_arrow'], { m: 1, def: [['green_dragon', 5], ['black_dragon', 5]], bonuses: [{ type: 'negate_resistance', immunities: true, side: 'both' }] });
  assert.deepEqual(getSpellTargets(orb, 'attacker', 'magic_arrow').stackIds, [D(orb, 0).id, D(orb, 1).id]);
});

test('magic resistance: dwarves 20 %, battle dwarves 40 %, hero Resistance, unicorn aura, Orb of Vulnerability', () => {
  const resisted = (def, roll, opts = {}) => {
    const cs = arena(['magic_arrow'], { m: 1, power: 2, def, ...opts });
    delete cs.force.chance.resist;
    cs.forceRolls = [roll];
    const ev = cast(cs, 'magic_arrow', D(cs).id);
    return ev.some((e) => e.type === 'spell_resisted');
  };
  assert.equal(resisted([['dwarf', 10]], 0.19), true);
  assert.equal(resisted([['dwarf', 10]], 0.21), false);
  assert.equal(resisted([['battle_dwarf', 10]], 0.39), true);
  assert.equal(resisted([['dwarf', 10]], 0.29, { heroD: hero({ bonuses: [{ type: 'magic_resistance', percent: 10 }] }) }), true, '20 + 10');
  assert.equal(resisted([['dwarf', 10]], 0.01, { bonuses: [{ type: 'negate_resistance', immunities: true, side: 'both' }] }), false);
  // unicorn aura: only stacks next to the unicorn
  const cs = arena(['magic_arrow'], { m: 1, power: 2, def: [['pikeman', 100], ['unicorn', 1]] });
  place(D(cs, 0), 10, 5); place(D(cs, 1), 11, 5);
  delete cs.force.chance.resist;
  cs.forceRolls = [0.15];
  assert.ok(cast(cs, 'magic_arrow', D(cs, 0).id).some((e) => e.type === 'spell_resisted'));
  place(D(cs, 1), 12, 9);
  cs.forceRolls = [0.15];
  assert.equal(dmgOn(cast(cs, 'magic_arrow', D(cs, 0).id), D(cs, 0)), 30, 'aura out of reach: no roll at all, the 0.15 is unused');
  // friendly spells are never resisted
  const own = arena(['bless'], { m: 1, att: [['dwarf', 10]] });
  delete own.force.chance.resist;
  own.forceRolls = [0];
  cast(own, 'bless', A(own).id);
  assert.equal(own.forceRolls.length, 1);
});

test('chain lightning: 4 / 5 links, halving, immune stacks skipped, resisting link still counts', () => {
  const def = [['pikeman', 1000], ['pikeman', 1000], ['pikeman', 1000], ['pikeman', 1000]]; // rows 0, 4, 6, 10
  let cs = arena(['chain_lightning'], { m: 3, power: 2, def });
  let ev = cast(cs, 'chain_lightning', D(cs, 0).id);
  assert.deepEqual([0, 1, 2, 3].map((i) => dmgOn(ev, D(cs, i))), [180, 90, 45, 22]);
  assert.equal(dmgOn(ev, A(cs)), 11, 'expert: 5th link jumps to our own stack (180 / 16)');
  cs = arena(['chain_lightning'], { m: 1, power: 2, def });
  ev = cast(cs, 'chain_lightning', D(cs, 0).id);
  assert.deepEqual([0, 1, 2, 3].map((i) => dmgOn(ev, D(cs, i))), [105, 52, 26, 13]);
  assert.equal(dmgOn(ev, A(cs)), 0);
  // earth elemental on row 4 is immune: skipped without using a link
  cs = arena(['chain_lightning'], { m: 1, power: 2, def: [['pikeman', 1000], ['earth_elemental', 10], ['pikeman', 1000], ['pikeman', 1000]] });
  ev = cast(cs, 'chain_lightning', D(cs, 0).id);
  assert.deepEqual([0, 1, 2, 3].map((i) => dmgOn(ev, D(cs, i))), [105, 0, 52, 26]);
  assert.equal(dmgOn(ev, A(cs)), 13);
  // a dwarf that resists keeps the chain going and the halving continues
  cs = arena(['chain_lightning'], { m: 1, power: 2, def: [['pikeman', 1000], ['dwarf', 100], ['pikeman', 1000], ['pikeman', 1000]] });
  delete cs.force.chance.resist;
  cs.forceRolls = [0.0];
  ev = cast(cs, 'chain_lightning', D(cs, 0).id);
  assert.deepEqual([0, 1, 2, 3].map((i) => dmgOn(ev, D(cs, i))), [105, 0, 26, 13]);
  assert.ok(ev.some((e) => e.type === 'spell_resisted' && e.stackId === D(cs, 1).id));
});

test('area spells hit friend and foe once per stack (two-hex creatures once)', () => {
  const cs = arena(['inferno'], { m: 1, power: 2, att: [['pikeman', 100], ['wolf_rider', 100]], def: [['behemoth', 10]] });
  place(A(cs, 0), 6, 5); place(A(cs, 1), 8, 3); place(D(cs), 9, 5);
  const ev = cast(cs, 'inferno', { x: 8, y: 5 });
  assert.deepEqual([dmgOn(ev, A(cs, 0)), dmgOn(ev, A(cs, 1)), dmgOn(ev, D(cs))], [40, 40, 40]);
  assert.equal(ev.filter((e) => e.type === 'damage' && e.stackId === D(cs).id).length, 1);
});

test('Immolation: damage now and at the next 2 round starts; Protection applies on each tick', () => {
  const cs = arena(['immolation'], { m: 3, power: 2 });
  const ev = cast(cs, 'immolation', D(cs).id);
  assert.equal(dmgOn(ev, D(cs)), 40); // 30 + 5 * 2
  assert.equal(D(cs).effects[0].roundsLeft, 3);
});

test('Fire Shield / Static Charge return melee damage as their element', () => {
  for (const [spellId, m, pct] of [['fire_shield', 1, 20], ['fire_shield', 3, 30], ['static_charge', 2, 15]]) {
    const cs = arena([spellId], { m, power: 2, att: [['pikeman', 100]], def: [['pikeman', 10]] });
    cast(cs, spellId, A(cs).id);
    assert.equal(A(cs).effects[0].value, pct);
  }
  // fire-immune attackers ignore Fire Shield
  const cs = arena(['fire_shield'], { m: 1, att: [['pikeman', 100]], def: [['efreet', 1]] });
  cast(cs, 'fire_shield', A(cs).id);
  assert.equal(A(cs).effects[0].spellId, 'fire_shield');
});

test('all-school Magic Arrow mastery: best of the four schools', () => {
  const cs = arena(['magic_arrow'], { power: 2, skills: { fire_magic: 2 } });
  assert.equal(dmgOn(cast(cs, 'magic_arrow', D(cs).id), D(cs)), 40);
  assert.ok(allSchools(1).air_magic === 1);
});
