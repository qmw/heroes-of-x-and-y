// Status-effect system and hero spell casting (minimal spells.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySpellToStack, addStatus, removeStatus, dispelStack, canSpellAffect, dealSpellDamage, healStack, resurrectStack,
  summonStack, killStack, placeObstacle, removeObstacle, getLegalActions, performAction, getStackInfo, applyDamage,
  getCastableSpells, getSpellTargets, castHeroSpell,
} from '../../src/engine/combat/index.js';
import { battle, hero, A, D, place, activate, act, has, damageTo, effectIds } from './helpers.js';

test('durations: an effect cast in round R for n rounds is removed at the start of round R + n', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]]);
  applySpellToStack(cs, 'bless', { mastery: 1, power: 2, casterSide: 'attacker' }, A(cs));
  assert.equal(A(cs).effects[0].roundsLeft, 2);
  while (cs.round < 2) act(cs, { type: 'defend' });
  assert.deepEqual(effectIds(A(cs)), ['bless']);
  const ev = [];
  while (cs.round < 3) ev.push(...act(cs, { type: 'defend' }));
  assert.deepEqual(effectIds(A(cs)), []);
  assert.ok(has(ev, 'status_removed', (e) => e.spellId === 'bless' && e.reason === 'expired'));
});

test('spell_duration bonus extends power-based durations; battle-long effects never expire', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]]);
  applySpellToStack(cs, 'haste', { mastery: 1, power: 2, extraDuration: 3, casterSide: 'attacker' }, A(cs));
  assert.equal(A(cs).effects[0].roundsLeft, 5);
  applySpellToStack(cs, 'disrupting_ray', { mastery: 1, power: 2, casterSide: 'attacker' }, D(cs));
  assert.equal(D(cs).effects[0].roundsLeft, null);
});

test('recasting replaces; opposites cancel; hard controls replace each other; stacking effects accumulate', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]]);
  addStatus(cs, A(cs), 'haste', { mastery: 1, casterSide: 'attacker', rounds: 2 });
  addStatus(cs, A(cs), 'haste', { mastery: 3, casterSide: 'attacker', rounds: 4 });
  assert.equal(A(cs).effects.length, 1);
  assert.equal(getStackInfo(cs, A(cs).id).speed, 9);
  addStatus(cs, A(cs), 'slow', { mastery: 1, casterSide: 'defender', rounds: 2 });
  assert.deepEqual(effectIds(A(cs)), ['slow']);
  assert.equal(getStackInfo(cs, A(cs).id).speed, 3); // ceil(4 * 0.75)
  addStatus(cs, D(cs), 'blind', { mastery: 1, casterSide: 'attacker', rounds: 2 });
  addStatus(cs, D(cs), 'petrify', { casterSide: 'attacker', rounds: 3 });
  addStatus(cs, D(cs), 'bind', { casterSide: 'attacker', rounds: null });
  assert.deepEqual(effectIds(D(cs)), ['petrify', 'bind']);
  addStatus(cs, D(cs), 'disrupting_ray', { mastery: 1, casterSide: 'attacker' });
  addStatus(cs, D(cs), 'disrupting_ray', { mastery: 1, casterSide: 'attacker' });
  assert.equal(effectIds(D(cs)).filter((x) => x === 'disrupting_ray').length, 2);
});

test('Prayer adds attack, defense and speed; Prayer + Slow apply flat then percent', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]]);
  addStatus(cs, A(cs), 'prayer', { mastery: 2, casterSide: 'attacker', rounds: 3 });
  addStatus(cs, A(cs), 'slow', { mastery: 2, casterSide: 'defender', rounds: 3 });
  const info = getStackInfo(cs, A(cs).id);
  assert.deepEqual([info.attack, info.defense, info.speed], [8, 9, 4]); // ceil((4 + 4) * 0.5)
});

test('dispel: all / positive / negative (Cure also lifts poison); Anti-Magic wipes and blocks', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]]);
  for (const id of ['bless', 'haste']) addStatus(cs, A(cs), id, { mastery: 1, casterSide: 'attacker', rounds: 3 });
  addStatus(cs, A(cs), 'weakness', { mastery: 1, casterSide: 'defender', rounds: 3 });
  addStatus(cs, A(cs), 'poison', { value: 10, casterSide: 'defender', rounds: 3 });
  addStatus(cs, A(cs), 'bind', { casterSide: 'defender', rounds: null });
  assert.equal(A(cs).maxHp, 9);
  dispelStack(cs, A(cs), 'negative');
  assert.deepEqual(effectIds(A(cs)), ['bless', 'haste', 'bind']);
  assert.equal(A(cs).maxHp, 10);
  dispelStack(cs, A(cs), 'positive');
  assert.deepEqual(effectIds(A(cs)), ['bind'], 'dendroid bind is not dispellable');
  addStatus(cs, A(cs), 'bless', { mastery: 1, casterSide: 'attacker', rounds: 3 });
  applySpellToStack(cs, 'cure', { mastery: 1, power: 1, casterSide: 'attacker' }, A(cs));
  assert.deepEqual(effectIds(A(cs)), ['bind', 'bless']);
  addStatus(cs, A(cs), 'disrupting_ray', { mastery: 1, casterSide: 'defender' });
  applySpellToStack(cs, 'anti_magic', { mastery: 1, power: 2, casterSide: 'attacker' }, A(cs));
  assert.deepEqual(effectIds(A(cs)), ['bind', 'disrupting_ray', 'anti_magic']);
  assert.equal(canSpellAffect(cs, 'slow', A(cs), 'defender'), false);
  assert.equal(canSpellAffect(cs, 'implosion', A(cs), 'defender'), true);
});

test('artifact spell immunities: own side vs both sides', () => {
  const cs = battle([['pikeman', 5]], [['imp', 5]], { heroA: hero({ bonuses: [{ type: 'spell_immunity', spellId: 'blind', side: 'own' }, { type: 'spell_immunity', maxLevel: 1, side: 'both' }] }) });
  assert.equal(canSpellAffect(cs, 'blind', A(cs), 'defender'), false);
  assert.equal(canSpellAffect(cs, 'blind', D(cs), 'attacker'), true);
  assert.equal(canSpellAffect(cs, 'bless', D(cs), 'defender'), false);
});

test('spell damage: Protection from Fire, petrification, chain factor, immunity events', () => {
  const cs = battle([['pikeman', 99]], [['imp', 99], ['efreet', 2]]);
  addStatus(cs, A(cs), 'protection_from_fire', { mastery: 2, casterSide: 'attacker', rounds: 3 });
  assert.equal(damageTo(dealSpellDamage(cs, A(cs), 100, { spellId: 'fireball', casterSide: 'defender' }), A(cs))[0].amount, 50);
  assert.equal(damageTo(dealSpellDamage(cs, A(cs), 100, { spellId: 'ice_bolt', casterSide: 'defender', factor: 0.25 }), A(cs))[0].amount, 25);
  addStatus(cs, D(cs, 0), 'petrify', { casterSide: 'attacker', rounds: 3 });
  const ev = dealSpellDamage(cs, D(cs, 0), 100, { spellId: 'ice_bolt', casterSide: 'attacker' });
  assert.equal(damageTo(ev, D(cs, 0))[0].amount, 50);
  assert.deepEqual(effectIds(D(cs, 0)), [], 'spell damage breaks the stone');
  assert.ok(has(dealSpellDamage(cs, D(cs, 1), 100, { spellId: 'fireball', casterSide: 'attacker' }), 'spell_immune'));
});

test('control statuses: blind/paralyze/stone skip turns; berserk attacks the nearest stack; hypnotize switches sides; forget stops shooting', () => {
  const cs = battle([['pikeman', 50], ['archer', 10]], [['imp', 50]]);
  addStatus(cs, D(cs), 'blind', { mastery: 1, casterSide: 'attacker', rounds: 3 });
  activate(cs, A(cs, 0));
  const ev = act(cs, { type: 'defend' });
  assert.ok(has(ev, 'turn_skipped', (e) => e.stackId === D(cs).id && e.reason === 'disabled'));
  const b = battle([['pikeman', 50], ['pikeman', 50]], [['imp', 50]]);
  place(A(b, 0), 5, 5); place(A(b, 1), 6, 5); place(D(b), 12, 5);
  addStatus(b, A(b, 0), 'berserk', { mastery: 1, casterSide: 'defender', rounds: 1 });
  activate(b, A(b, 1));
  const ev2 = act(b, { type: 'move', to: { x: 6, y: 6 } });
  for (let i = 0; i < 4 && !has(ev2, 'berserk'); i++) ev2.push(...act(b, { type: 'defend' }));
  assert.ok(has(ev2, 'berserk', (e) => e.stackId === A(b, 0).id && e.targetId === A(b, 1).id));
  assert.ok(damageTo(ev2, A(b, 1)).length > 0);
  assert.ok(has(ev2, 'retaliate'), 'the victim retaliates normally');
  assert.deepEqual(effectIds(A(b, 0)), [], 'berserk ends with that turn');
  const h = battle([['pikeman', 50], ['archer', 10]], [['imp', 50]]);
  addStatus(h, A(h, 0), 'hypnotize', { mastery: 1, casterSide: 'defender', rounds: 3 });
  assert.equal(getStackInfo(h, A(h, 0).id).controller, 'defender');
  activate(h, D(h));
  assert.ok(!getLegalActions(h).attacks.some((a) => a.targetId === A(h, 0).id));
  addStatus(h, A(h, 1), 'forgetfulness', { mastery: 2, casterSide: 'defender', rounds: 3 });
  activate(h, A(h, 1));
  assert.deepEqual(getLegalActions(h).shots, []);
});

test('damage / heal over time tick at round starts', () => {
  const cs = battle([['pikeman', 50]], [['imp', 50]]);
  applySpellToStack(cs, 'immolation', { mastery: 1, power: 2, casterSide: 'defender' }, A(cs)); // 10 + 5*2 = 20
  assert.equal(A(cs).count, 48);
  A(cs).hp = 1; // wounded top creature for the heal test below
  applySpellToStack(cs, 'regeneration', { mastery: 1, power: 2, casterSide: 'attacker' }, D(cs));
  const ev = [];
  while (cs.round < 2) ev.push(...act(cs, { type: 'defend' }));
  assert.ok(has(ev, 'damage', (e) => e.stackId === A(cs).id && e.amount === 20));
});

test('heal, resurrect (temporary / permanent), summon, kill, obstacles', () => {
  const cs = battle([['pikeman', 20]], [['imp', 5]]);
  A(cs).count = 10; A(cs).hp = 3;
  assert.equal(healStack(cs, A(cs), 100)[0].amount, 7);
  assert.equal(A(cs).count, 10);
  resurrectStack(cs, A(cs), 35, { permanent: false });
  assert.deepEqual([A(cs).count, A(cs).hp, A(cs).tempRaised], [14, 5, 4]);
  resurrectStack(cs, A(cs), 9999);
  assert.equal(A(cs).count, 20, 'capped at the starting count');
  assert.deepEqual(resurrectStack(cs, A(cs), 10), []);
  killStack(cs, A(cs));
  assert.equal(A(cs).alive, false);
  resurrectStack(cs, A(cs), 25);
  assert.deepEqual([A(cs).alive, A(cs).count, A(cs).hp], [true, 3, 5]);
  const { stack, events } = summonStack(cs, 'attacker', 'fire_elemental', 6);
  assert.equal(stack.summoned, true);
  assert.deepEqual(stack.pos, { x: 0, y: 4 }, 'back column, middle rows first ((0,5) is taken)');
  assert.ok(has(events, 'summon'));
  const { obstacle } = placeObstacle(cs, { kind: 'force_field', hexes: [{ x: 7, y: 5 }], rounds: 2 });
  assert.equal(obstacle.blocks, true);
  assert.equal(removeObstacle(cs, obstacle.id)[0].type, 'obstacle_removed');
  // clones die from any damage
  const { stack: clone } = summonStack(cs, 'attacker', 'pikeman', 20, { x: 7, y: 7 }, { clone: true });
  const ev = [];
  applyDamage(cs, clone, 1, {}, ev);
  assert.equal(clone.alive, false);
});

test('hero casting: mana, mastery cost, once per round, damage formula, targets', () => {
  const h = hero({ power: 3, mana: 30, spells: ['magic_arrow', 'slow', 'summon_air_elemental', 'fireball'], skills: { earth_magic: 3 },
    bonuses: [{ type: 'spell_power_percent', percent: 10 }] });
  const cs = battle([['pikeman', 50]], [['imp', 99], ['gog', 50]], { heroA: h });
  activate(cs, A(cs));
  assert.deepEqual(getCastableSpells(cs, 'attacker').sort(), ['fireball', 'magic_arrow', 'slow', 'summon_air_elemental']);
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'magic_arrow'), { mode: 'enemy_stack', stackIds: [D(cs, 0).id, D(cs, 1).id], anyHex: false });
  assert.equal(getSpellTargets(cs, 'attacker', 'slow').mode, 'all_enemies');
  assert.deepEqual(castHeroSpell(cs, 'attacker', 'magic_arrow', A(cs).id), { ok: false, error: 'bad_target' });
  const ev = act(cs, { type: 'cast', spellId: 'magic_arrow', target: D(cs, 0).id });
  assert.equal(damageTo(ev, D(cs, 0))[0].amount, 66); // expert via Earth Magic ('all' school): (30 + 30) * 1.1
  assert.equal(cs.sides.attacker.hero.mana, 26);
  assert.equal(cs.active, A(cs).id, 'casting does not use the stack action');
  assert.deepEqual(performAction(cs, { type: 'cast', spellId: 'slow' }), { ok: false, error: 'already_cast' });
  assert.equal(getLegalActions(cs).canCast, false);
  act(cs, { type: 'defend' });
  while (cs.active !== A(cs).id) act(cs, { type: 'defend' });
  const ev2 = act(cs, { type: 'cast', spellId: 'slow' }); // expert earth: mass, cost 6
  assert.deepEqual([effectIds(D(cs, 0)), effectIds(D(cs, 1))], [['slow'], ['slow']]);
  assert.equal(ev2[0].cost, 5);
});

test('hero casting: area spells hit friends too; no mana, no spell, blocked spells', () => {
  const h = hero({ power: 1, mana: 30, spells: ['fireball'] });
  const cs = battle([['pikeman', 50]], [['imp', 99]], { heroA: h });
  place(A(cs), 7, 5); place(D(cs), 8, 5);
  activate(cs, A(cs));
  const ev = act(cs, { type: 'cast', spellId: 'fireball', target: { x: 8, y: 5 } });
  assert.equal(damageTo(ev, D(cs))[0].amount, 25);
  assert.equal(damageTo(ev, A(cs))[0].amount, 25);
  const poor = battle([['pikeman', 5]], [['imp', 5]], { heroA: hero({ mana: 2, spells: ['magic_arrow'] }) });
  assert.deepEqual(getCastableSpells(poor, 'attacker'), []);
  const blocked = battle([['pikeman', 5]], [['imp', 5]], { heroA: hero({ mana: 20, spells: ['magic_arrow'] }), heroD: hero({ bonuses: [{ type: 'block_spells', minLevel: 1, maxLevel: 5, side: 'both' }] }) });
  assert.deepEqual(getCastableSpells(blocked, 'attacker'), []);
  const none = battle([['pikeman', 5]], [['imp', 5]]);
  assert.deepEqual(getCastableSpells(none, 'attacker'), []);
});

test('combat_start_cast: free mass casts before round 1', () => {
  const cs = battle([['pikeman', 5], ['archer', 5]], [['imp', 5]], { heroA: hero({ bonuses: [{ type: 'combat_start_cast', spellId: 'prayer', mastery: 3, power: 4, target: 'all_friendly' }] }) });
  assert.deepEqual([effectIds(A(cs, 0)), effectIds(A(cs, 1)), effectIds(D(cs))], [['prayer'], ['prayer'], []]);
  assert.equal(A(cs, 0).effects[0].roundsLeft, 4);
});
