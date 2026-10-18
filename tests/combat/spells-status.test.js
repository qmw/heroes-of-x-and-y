// Status spells: values per mastery (hand-written tables from spells.md), mass behaviour,
// durations and overrides, dispel / cure / anti-magic / magic mirror, controls, extra spells,
// hero spell specialties on buffs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpellTargets, getStackInfo, addStatus, placeObstacle, getSpellAreaPreview } from '../../src/engine/combat/index.js';
import { tickRoundStart } from '../../src/engine/combat/effects.js';
import { reachable } from '../../src/engine/combat/actions.js';
import { controllerOf, retaliationPercent, attackOf } from '../../src/engine/combat/stats.js';
import { place, has } from './helpers.js';
import { arena, cast, castFail, dmgOn, effectOf, A, D, hero } from './spells-helpers.js';

// [spellId, friendly?, values per mastery none/basic/advanced/expert, mass at expert?]
const STATUS = [
  ['shield', true, [15, 15, 30, 30], true],
  ['air_shield', true, [25, 25, 50, 50], true],
  ['protection_from_air', true, [30, 30, 50, 50], true],
  ['protection_from_earth', true, [30, 30, 50, 50], true],
  ['protection_from_fire', true, [30, 30, 50, 50], true],
  ['protection_from_water', true, [30, 30, 50, 50], true],
  ['bless', true, [0, 0, 1, 1], true],
  ['curse', false, [0, 0, 1, 1], true],
  ['bloodlust', true, [3, 3, 6, 6], true],
  ['precision', true, [3, 3, 6, 6], true],
  ['weakness', false, [3, 3, 6, 6], true],
  ['stone_skin', true, [3, 3, 6, 6], true],
  ['disrupting_ray', false, [3, 3, 4, 5], false],
  ['prayer', true, [2, 2, 4, 4], true],
  ['mirth', true, [1, 1, 2, 2], true],
  ['sorrow', false, [1, 1, 2, 2], true],
  ['fortune', true, [1, 1, 2, 2], true],
  ['misfortune', false, [1, 1, 2, 2], true],
  ['haste', true, [3, 3, 5, 5], true],
  ['slow', false, [25, 25, 50, 50], true],
  ['slayer', true, [8, 8, 8, 8], false],
  ['frenzy', true, [100, 100, 150, 200], false],
  ['counterstrike', true, [1, 1, 2, 2], true],
  ['fire_shield', true, [20, 20, 25, 30], false],
  ['magic_mirror', true, [20, 20, 30, 40], false],
  ['anti_magic', true, [3, 3, 4, 5], false],
  ['forgetfulness', false, [50, 50, 100, 100], true],
  ['blind', false, [50, 50, 25, 0], false],
  ['fog', false, [3, 3, 6, 6], true],
  ['melt_armor', false, [3, 3, 6, 6], true],
  ['static_charge', true, [10, 10, 15, 20], false],
];
const SHOOTER_ONLY = ['precision', 'forgetfulness', 'fog'];

for (const [spellId, friendly, values, mass] of STATUS) {
  test(`status: ${spellId} value per mastery${mass ? ', mass at expert' : ''}`, () => {
    for (let m = 0; m < 4; m++) {
      const unit = SHOOTER_ONLY.includes(spellId) ? 'archer' : 'pikeman';
      const cs = arena([spellId], { m, power: 3, att: [[unit, 10], [unit, 10]], def: [[unit, 10], [unit, 10]] });
      const side = friendly ? A : D;
      const isMass = mass && m === 3;
      cast(cs, spellId, isMass ? null : side(cs, 0).id);
      const eff = effectOf(side(cs, 0), spellId);
      assert.ok(eff, `${spellId} m${m} applied`);
      assert.equal(eff.value, values[m], `${spellId} m${m}`);
      assert.equal(!!effectOf(side(cs, 1), spellId), isMass, `${spellId} m${m} mass`);
      const other = friendly ? D : A;
      assert.equal(!!effectOf(other(cs, 0), spellId), false, 'other side untouched');
      const expected = spellId === 'disrupting_ray' ? null : spellId === 'frenzy' ? 1 : 3;
      assert.equal(eff.roundsLeft, expected, `${spellId} duration`);
    }
  });
}

test('stat effects show in the effective numbers', () => {
  const cs = arena(['haste', 'prayer', 'bloodlust', 'stone_skin', 'weakness', 'slow', 'mirth', 'misfortune', 'counterstrike'], { m: 2, power: 3, def: [['pikeman', 10]] });
  const a = A(cs).id;
  const d = D(cs).id;
  cast(cs, 'haste', a); // +5
  cast(cs, 'prayer', a); // +4 / +4 / +4
  cast(cs, 'bloodlust', a); // +6 melee attack
  cast(cs, 'stone_skin', a); // +6
  cast(cs, 'mirth', a); // +2
  cast(cs, 'counterstrike', a); // +2 retaliations
  const ia = getStackInfo(cs, a);
  assert.deepEqual([ia.speed, ia.attack, ia.defense, ia.morale, ia.retaliationsLeft], [4 + 5 + 4, 4 + 4 + 6, 5 + 4 + 6, 1 + 2, 3]);
  cast(cs, 'slow', d); // 50 %: ceil(4 / 2)
  cast(cs, 'weakness', d);
  cast(cs, 'misfortune', d);
  const id = getStackInfo(cs, d);
  assert.deepEqual([id.speed, id.attack, id.luck], [2, 0, -2]);
});

test('durations: power rounds + spell_duration bonuses (power only), expiry at the start of round R + n', () => {
  const cs = arena(['haste', 'entangle'], { m: 1, power: 2, bonuses: [{ type: 'spell_duration', value: 2 }] });
  cast(cs, 'haste', A(cs).id);
  assert.equal(effectOf(A(cs), 'haste').roundsLeft, 4, 'SP 2 + 2');
  cast(cs, 'entangle', D(cs).id);
  assert.equal(effectOf(D(cs), 'entangle').roundsLeft, 2, 'fixed durations ignore spell_duration');
  tickRoundStart(cs);
  assert.ok(effectOf(D(cs), 'entangle'));
  const ev = tickRoundStart(cs);
  assert.equal(effectOf(D(cs), 'entangle'), null);
  assert.ok(has(ev, 'status_removed', (e) => e.spellId === 'entangle' && e.reason === 'expired'));
});

test('overrides: opposites cancel, recasting replaces, Disrupting Ray stacks (floor 0)', () => {
  const cs = arena(['haste', 'slow', 'bless', 'curse', 'disrupting_ray', 'weakness', 'bloodlust'], { m: 1, power: 2, att: [['pikeman', 10]], heroD: hero({ power: 1, mana: 99, spells: ['slow', 'curse'], skills: { earth_magic: 1, fire_magic: 1 } }) });
  cast(cs, 'haste', A(cs).id);
  const ev = cast(cs, 'slow', A(cs).id, 'defender');
  assert.ok(has(ev, 'status_removed', (e) => e.spellId === 'haste' && e.reason === 'cancelled'));
  assert.deepEqual(A(cs).effects.map((e) => e.spellId), ['slow']);
  cast(cs, 'haste', A(cs).id);
  assert.deepEqual(A(cs).effects.map((e) => e.spellId), ['haste'], 'haste removes slow');
  cast(cs, 'bless', A(cs).id);
  cast(cs, 'curse', A(cs).id, 'defender');
  assert.deepEqual(A(cs).effects.map((e) => e.spellId), ['haste', 'curse']);
  // recast: one instance, new mastery and duration
  cs.sides.attacker.hero.skills.air_magic = 3;
  cs.sides.attacker.hero.power = 5;
  cast(cs, 'haste', A(cs).id);
  const hastes = A(cs).effects.filter((e) => e.spellId === 'haste');
  assert.deepEqual(hastes.map((e) => [e.value, e.roundsLeft]), [[5, 5]]);
  // Disrupting Ray stacks; Bloodlust and Weakness coexist
  for (let i = 0; i < 3; i++) cast(cs, 'disrupting_ray', D(cs).id);
  assert.equal(D(cs).effects.filter((e) => e.spellId === 'disrupting_ray').length, 3);
  assert.equal(getStackInfo(cs, D(cs).id).defense, 0, '5 - 9, floored at 0');
  cast(cs, 'bloodlust', A(cs).id);
  addStatus(cs, A(cs), 'weakness', { mastery: 1, casterSide: 'defender' });
  assert.equal(getStackInfo(cs, A(cs).id).attack, 4 + 3 - 3);
});

test('dispel: friendly at basic, any stack at advanced, everything + magical obstacles at expert', () => {
  const setup = (m) => {
    const cs = arena(['dispel'], { m, power: 2 });
    addStatus(cs, A(cs), 'slow', { mastery: 1, casterSide: 'defender' });
    addStatus(cs, A(cs), 'haste', { mastery: 1, casterSide: 'attacker' });
    addStatus(cs, A(cs), 'disrupting_ray', { mastery: 1, casterSide: 'defender', rounds: null });
    addStatus(cs, D(cs), 'haste', { mastery: 1, casterSide: 'defender' });
    placeObstacle(cs, { kind: 'quicksand', hexes: [{ x: 7, y: 7 }], side: 'defender', hidden: true });
    placeObstacle(cs, { kind: 'force_field', hexes: [{ x: 7, y: 3 }], side: 'attacker', rounds: 2 });
    placeObstacle(cs, { kind: 'boulder', hexes: [{ x: 6, y: 1 }], magical: false });
    return cs;
  };
  let cs = setup(1);
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'dispel'), { mode: 'friendly_stack', stackIds: [A(cs).id], anyHex: false });
  cast(cs, 'dispel', A(cs).id);
  assert.deepEqual(A(cs).effects.map((e) => e.spellId), ['disrupting_ray'], 'positive and negative go, Disrupting Ray stays');
  cs = setup(2);
  assert.equal(getSpellTargets(cs, 'attacker', 'dispel').mode, 'any_stack');
  cast(cs, 'dispel', D(cs).id);
  assert.deepEqual(D(cs).effects, []);
  cs = setup(3);
  cast(cs, 'dispel');
  assert.deepEqual([A(cs).effects.length, D(cs).effects.length], [1, 0]);
  assert.deepEqual(cs.obstacles.map((o) => o.kind), ['boulder']);
});

test('dispel vs Anti-Magic (only expert removes it) and Sphere of Permanence', () => {
  let cs = arena(['dispel'], { m: 2, power: 2 });
  addStatus(cs, A(cs), 'anti_magic', { mastery: 1, casterSide: 'attacker' });
  assert.equal(getSpellTargets(cs, 'attacker', 'dispel').stackIds.includes(A(cs).id), false);
  cs = arena(['dispel'], { m: 3, power: 2 });
  addStatus(cs, A(cs), 'anti_magic', { mastery: 1, casterSide: 'attacker' });
  cast(cs, 'dispel');
  assert.deepEqual(A(cs).effects, []);
  cs = arena(['dispel'], { m: 2, heroD: hero({ bonuses: [{ type: 'spell_immunity', spellId: 'dispel', side: 'own' }] }) });
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'dispel').stackIds, [A(cs).id]);
});

test('cure: removes negative effects and poison, keeps positive ones, heals the top creature', () => {
  const cs = arena(['cure'], { m: 1, power: 2, att: [['griffin', 10]] });
  const g = A(cs);
  addStatus(cs, g, 'slow', { mastery: 1, casterSide: 'defender' });
  addStatus(cs, g, 'haste', { mastery: 1, casterSide: 'attacker' });
  addStatus(cs, g, 'poison', { casterSide: 'defender', rounds: 3, value: 10 });
  g.hp = 1;
  assert.equal(g.maxHp, 23, 'poison: -10 % of 25 (floor)');
  const ev = cast(cs, 'cure', g.id);
  assert.deepEqual(g.effects.map((e) => e.spellId), ['haste']);
  assert.equal(g.maxHp, 25);
  assert.equal(g.hp, 21, 'healed 10 + 5 * 2');
  assert.ok(has(ev, 'heal', (e) => e.amount === 20));
});

test('anti-magic: wipes existing effects, blocks spells up to its level for both sides', () => {
  const cs = arena(['anti_magic', 'haste'], { m: 1, power: 2, heroD: hero({ power: 2, mana: 99, spells: ['magic_arrow', 'implosion'], skills: { earth_magic: 1 } }) });
  addStatus(cs, A(cs), 'slow', { mastery: 1, casterSide: 'defender' });
  cast(cs, 'haste', A(cs).id);
  const ev = cast(cs, 'anti_magic', A(cs).id);
  assert.ok(has(ev, 'status_removed', (e) => e.reason === 'dispelled'));
  assert.deepEqual(A(cs).effects.map((e) => e.spellId), ['anti_magic']);
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'haste').stackIds, [], 'friendly level-1 spell blocked too');
  assert.deepEqual(getSpellTargets(cs, 'defender', 'magic_arrow').stackIds, []);
  assert.deepEqual(getSpellTargets(cs, 'defender', 'implosion').stackIds, [A(cs).id], 'level 5 > 3');
});

test('magic mirror: reflects hostile single-target spells to a random caster stack; never mass spells', () => {
  const cs = arena(['magic_arrow', 'slow'], { m: 1, power: 2, att: [['pikeman', 100], ['archer', 100]], chance: { magic_mirror: true } });
  addStatus(cs, D(cs), 'magic_mirror', { mastery: 3, casterSide: 'defender' });
  cs.forceRolls = [0.99]; // the redirect pick: last candidate
  const ev = cast(cs, 'magic_arrow', D(cs).id);
  const r = ev.find((e) => e.type === 'spell_reflected');
  assert.equal(r.toStackId, A(cs, 1).id);
  assert.equal(dmgOn(ev, A(cs, 1)), 30);
  assert.equal(dmgOn(ev, D(cs)), 0);
  cs.sides.attacker.hero.skills.earth_magic = 3;
  const ev2 = cast(cs, 'slow');
  assert.equal(has(ev2, 'spell_reflected'), false);
  assert.ok(effectOf(D(cs), 'slow'));
  // Mirror of Vanity (hero bonus)
  const cs2 = arena(['magic_arrow'], { m: 1, power: 2, chance: { magic_mirror: true }, heroD: hero({ bonuses: [{ type: 'spell_reflection', percent: 20 }] }) });
  const ev3 = cast(cs2, 'magic_arrow', D(cs2).id);
  assert.equal(dmgOn(ev3, A(cs2)), 30);
});

test('blind: skips turns, retaliation 50/50/25/0 %, breaks on damage', () => {
  for (const [m, pct] of [[1, 50], [2, 25], [3, 0]]) {
    const cs = arena(['blind'], { m, power: 2 });
    cast(cs, 'blind', D(cs).id);
    assert.equal(retaliationPercent(cs, D(cs)), pct);
  }
  const cs = arena(['blind', 'magic_arrow'], { m: 1, power: 2 });
  cast(cs, 'blind', D(cs).id);
  cast(cs, 'magic_arrow', D(cs).id);
  assert.equal(effectOf(D(cs), 'blind'), null);
  const tro = arena(['blind'], { m: 1, def: [['troglodyte', 10]] });
  assert.deepEqual(getSpellTargets(tro, 'attacker', 'blind').stackIds, [], 'sightless');
});

test('berserk: radius 0 / 0 / 1 / 2 around the hex, friend and foe, mind-immune skipped', () => {
  const counts = [];
  for (let m = 0; m < 4; m++) {
    const cs = arena(['berserk'], { m, power: 2, att: [['pikeman', 10], ['pikeman', 10], ['skeleton', 10]], def: [['pikeman', 10], ['pikeman', 10]] });
    place(D(cs, 0), 8, 5); place(A(cs, 0), 7, 5); place(D(cs, 1), 10, 5); place(A(cs, 2), 9, 4); place(A(cs, 1), 0, 0);
    const preview = getSpellAreaPreview(cs, 'attacker', 'berserk', { x: 8, y: 5 });
    cast(cs, 'berserk', { x: 8, y: 5 });
    const hit = cs.stacks.filter((s) => effectOf(s, 'berserk')).map((s) => s.id).sort();
    assert.deepEqual([...preview.stackIds].sort(), hit, 'preview matches the cast');
    counts.push(hit.length);
    assert.equal(!!effectOf(A(cs, 2), 'berserk'), false, 'undead are mind-immune');
  }
  assert.deepEqual(counts, [1, 1, 2, 3]);
});

test('hypnotize: HP limit 25*SP + 10/10/20/50 (strict), control switch, level-scaled specialty raises the cap', () => {
  // basic, SP 2: limit 60; pikemen have 10 hp
  let cs = arena(['hypnotize'], { m: 1, power: 2, def: [['pikeman', 5], ['pikeman', 6]] });
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'hypnotize').stackIds, [D(cs, 0).id]);
  cast(cs, 'hypnotize', D(cs, 0).id);
  assert.equal(controllerOf(D(cs, 0)), 'attacker');
  assert.equal(effectOf(D(cs, 0), 'hypnotize').roundsLeft, 2);
  assert.equal(castFail(cs, 'hypnotize', D(cs, 0).id), 'no_target', 'no recast on a hypnotized stack (now friendly); the other is over the limit');
  // level 10 specialist vs tier 1: limit 60 * 1.3 = 78
  cs = arena(['hypnotize'], { m: 1, power: 2, def: [['pikeman', 7], ['pikeman', 8]], bonuses: [{ type: 'spell_specialty', spellId: 'hypnotize', mode: 'level_scaled', percentPerStep: 3, heroLevel: 10 }] });
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'hypnotize').stackIds, [D(cs, 0).id]);
});

test('forgetfulness: 50 % at basic (half the shooters), cannot shoot at advanced, mass at expert', () => {
  let cs = arena(['forgetfulness'], { m: 1, def: [['archer', 10], ['gog', 10]] });
  cast(cs, 'forgetfulness', D(cs, 0).id);
  assert.equal(getStackInfo(cs, D(cs, 0).id).canShoot, true);
  cs = arena(['forgetfulness'], { m: 2, def: [['archer', 10], ['gog', 10]] });
  cast(cs, 'forgetfulness', D(cs, 0).id);
  assert.equal(getStackInfo(cs, D(cs, 0).id).canShoot, false);
  cs = arena(['forgetfulness'], { m: 3, def: [['archer', 10], ['gog', 10], ['pikeman', 10]] });
  cast(cs, 'forgetfulness');
  assert.deepEqual([0, 1, 2].map((i) => !!effectOf(D(cs, i), 'forgetfulness')), [true, true, false]);
});

test('thunderclap (extra): HP limit, lose the next turn, no break on damage, ends after that turn', () => {
  // basic SP 2: limit 10 + 30 = 40; imps have 4 hp
  const cs = arena(['thunderclap', 'magic_arrow'], { m: 1, power: 2, def: [['imp', 9], ['imp', 10]] });
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'thunderclap').stackIds, [D(cs, 0).id]);
  cast(cs, 'thunderclap', D(cs, 0).id);
  const eff = effectOf(D(cs, 0), 'thunderclap');
  assert.equal(eff.turnBased, true);
  cast(cs, 'magic_arrow', D(cs, 0).id);
  assert.ok(effectOf(D(cs, 0), 'thunderclap'), 'stun survives damage');
  assert.equal(retaliationPercent(cs, D(cs, 0)), 100);
});

test('flesh to stone (extra): HP limit 20*SP + 10/10/20/50, 2/2/3/3 rounds, half damage, breaks on damage', () => {
  const cs = arena(['flesh_to_stone', 'magic_arrow'], { m: 2, power: 2, def: [['pikeman', 5], ['pikeman', 6], ['iron_golem', 1]] });
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'flesh_to_stone').stackIds, [D(cs, 0).id], 'limit 60; golems immune');
  cast(cs, 'flesh_to_stone', D(cs, 0).id);
  assert.equal(effectOf(D(cs, 0), 'flesh_to_stone').roundsLeft, 3);
  assert.equal(retaliationPercent(cs, D(cs, 0)), 0);
  assert.equal(dmgOn(cast(cs, 'magic_arrow', D(cs, 0).id), D(cs, 0)), 20, '40 halved');
  assert.equal(effectOf(D(cs, 0), 'flesh_to_stone'), null);
});

test('entangle (extra): walkers cannot move, flyers immune, 2/2/3/3 rounds', () => {
  const cs = arena(['entangle'], { m: 3, def: [['pikeman', 5], ['griffin', 5]] });
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'entangle').stackIds, [D(cs, 0).id]);
  cast(cs, 'entangle', D(cs, 0).id);
  assert.equal(effectOf(D(cs, 0), 'entangle').roundsLeft, 3);
  assert.equal(reachable(cs, D(cs, 0)).size, 1);
});

test('regeneration (extra) heals now and at the next 2 round starts; immolation ticks', () => {
  const cs = arena(['regeneration', 'immolation'], { m: 1, power: 2, att: [['griffin', 5]], def: [['pikeman', 100]] });
  A(cs).hp = 1;
  cast(cs, 'regeneration', A(cs).id);
  assert.equal(A(cs).hp, 21);
  A(cs).hp = 1;
  cast(cs, 'immolation', D(cs).id);
  const ev = tickRoundStart(cs);
  assert.equal(A(cs).hp, 21);
  assert.equal(dmgOn(ev, D(cs)), 20);
  tickRoundStart(cs);
  tickRoundStart(cs);
  assert.deepEqual([A(cs).effects.length, D(cs).effects.length], [0, 0]);
});

test('slayer: +8 attack vs dragons/behemoths/hydras, + angels/devils at advanced, + titans at expert', () => {
  for (const [m, angel, titan] of [[1, false, false], [2, true, false], [3, true, true]]) {
    const cs = arena(['slayer'], { m, def: [['angel', 1], ['titan', 1], ['green_dragon', 1], ['pikeman', 1]] });
    cast(cs, 'slayer', A(cs).id);
    const base = A(cs).attack;
    const vs = (i) => attackOf(cs, A(cs), { target: D(cs, i) }) - base;
    assert.deepEqual([vs(0), vs(1), vs(2), vs(3)], [angel ? 8 : 0, titan ? 8 : 0, 8, 0], `m${m}`);
  }
});

test('hero spell specialties on buffs: tiered, fixed value, level scaled (rounded up), fixed percent', () => {
  const spec = (spellId, mode, extra = {}) => [{ type: 'spell_specialty', spellId, mode, heroLevel: 10, ...extra }];
  let cs = arena(['haste'], { m: 1, bonuses: spec('haste', 'tiered', { tierBonus: [3, 3, 2, 2, 1, 1, 0] }), att: [['pikeman', 5], ['giant', 1]] });
  cast(cs, 'haste', A(cs, 0).id);
  cast(cs, 'haste', A(cs, 1).id);
  assert.deepEqual([effectOf(A(cs, 0), 'haste').value, effectOf(A(cs, 1), 'haste').value], [6, 3]);
  cs = arena(['slayer'], { m: 1, bonuses: spec('slayer', 'fixed_value', { value: 4 }) });
  cast(cs, 'slayer', A(cs).id);
  assert.equal(effectOf(A(cs), 'slayer').value, 12);
  cs = arena(['disrupting_ray'], { m: 1, bonuses: spec('disrupting_ray', 'fixed_value', { value: 2 }) });
  cast(cs, 'disrupting_ray', D(cs).id);
  assert.equal(effectOf(D(cs), 'disrupting_ray').value, 5);
  cs = arena(['stone_skin'], { m: 1, bonuses: spec('stone_skin', 'level_scaled', { percentPerStep: 3 }) });
  cast(cs, 'stone_skin', A(cs).id);
  assert.equal(effectOf(A(cs), 'stone_skin').value, 4, 'ceil(3 * 1.3)');
  cs = arena(['air_shield'], { m: 1, bonuses: spec('air_shield', 'fixed_percent', { percent: 25 }) });
  cast(cs, 'air_shield', A(cs).id);
  assert.equal(effectOf(A(cs), 'air_shield').value, 31, 'floor(25 * 1.25)');
  cs = arena(['stone_skin'], { m: 3, bonuses: spec('stone_skin', 'level_scaled', { percentPerStep: 3 }), att: [['pikeman', 5], ['giant', 1]] });
  cast(cs, 'stone_skin');
  assert.deepEqual([effectOf(A(cs, 0), 'stone_skin').value, effectOf(A(cs, 1), 'stone_skin').value], [8, 7], 'mass: per target tier (ceil 7.8 / 6.18)');
});
