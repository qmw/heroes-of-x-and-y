// Defensive abilities, auras and creature casters (creatures.md §4.4-4.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLegalActions, performAction, getStackInfo, applySpellToStack, dealSpellDamage, canSpellAffect, addStatus, applyDamage,
} from '../../src/engine/combat/index.js';
import { heroSpellCost } from '../../src/engine/combat/spells.js';
import { battle, hero, A, D, place, activate, act, melee, shoot, firstDamage, damageTo, has, effectIds } from './helpers.js';

const spellDmg = (creatureId, spellId, amount = 100, opts = {}) => {
  const cs = battle([['pikeman', 1]], [[creatureId, 99]], opts);
  const ev = dealSpellDamage(cs, D(cs), amount, { spellId, casterSide: 'attacker' });
  return damageTo(ev, D(cs))[0]?.amount;
};

test('spell_damage_reduction: golems 50/75/80/85/95, Clockwork Knight 50', () => {
  const rows = [['stone_golem', 50], ['iron_golem', 25], ['steel_golem', 20], ['gold_golem', 15], ['diamond_golem', 5], ['clockwork_knight', 50], ['pikeman', 100]];
  for (const [id, dmg] of rows) assert.equal(spellDmg(id, 'magic_arrow'), dmg, id);
  assert.equal(spellDmg('diamond_golem', 'magic_arrow', 10), 1, 'minimum 1');
  assert.equal(spellDmg('iron_golem', 'magic_arrow', 100, { heroA: hero({ bonuses: [{ type: 'negate_resistance', side: 'both' }] }) }), 100);
});

test('magic_resistance + hero Resistance + resistance_aura (adjacent allies, not cumulative)', () => {
  const resisted = (army, roll, opts = {}, who = 0) => {
    const cs = battle([['pikeman', 1]], army, { chance: { resist: undefined }, forceRolls: [roll], ...opts });
    if (army.length > 1) { place(D(cs, 0), 8, 5); place(D(cs, 1), 9, 5); }
    const ev = applySpellToStack(cs, 'slow', { mastery: 1, power: 3, casterSide: 'attacker' }, D(cs, who));
    return has(ev, 'spell_resisted');
  };
  assert.equal(resisted([['dwarf', 10]], 0.19), true);
  assert.equal(resisted([['dwarf', 10]], 0.2), false);
  assert.equal(resisted([['battle_dwarf', 10]], 0.39), true);
  assert.equal(resisted([['battle_dwarf', 10], ['unicorn', 1]], 0.59), true, 'unicorn aura +20');
  assert.equal(resisted([['battle_dwarf', 10], ['unicorn', 1], ['unicorn', 1]], 0.61), false);
  assert.equal(resisted([['unicorn', 1]], 0.19), true, 'the unicorn itself');
  assert.equal(resisted([['pikeman', 10]], 0.09, { heroD: hero({ bonuses: [{ type: 'magic_resistance', percent: 10 }] }) }), true);
  assert.equal(resisted([['dwarf', 10]], 0.0, { heroA: hero({ bonuses: [{ type: 'negate_resistance', side: 'both' }] }) }), false);
  // friendly spells are never resisted
  const cs = battle([['dwarf', 10]], [['imp', 1]], { chance: { resist: true } });
  assert.ok(!has(applySpellToStack(cs, 'bless', { mastery: 1, power: 3, casterSide: 'attacker' }, A(cs)), 'spell_resisted'));
});

test('spell_level_immunity 3/4/5 (friendly spells too); Orb of Vulnerability lifts it', () => {
  const can = (id, spell, opts) => { const cs = battle([[id, 1]], [['imp', 1]], opts); return canSpellAffect(cs, spell, A(cs), 'attacker'); };
  assert.equal(can('green_dragon', 'bless'), false);
  assert.equal(can('green_dragon', 'lightning_bolt'), false);
  assert.equal(can('green_dragon', 'chain_lightning'), true);
  assert.equal(can('gold_dragon', 'chain_lightning'), false);
  assert.equal(can('gold_dragon', 'implosion'), true);
  assert.equal(can('black_dragon', 'implosion'), false);
  assert.equal(can('magic_elemental', 'magic_arrow'), false);
  assert.equal(can('storm_drake', 'lightning_bolt'), false);
  assert.equal(can('storm_drake', 'frost_ring'), true);
  assert.equal(can('green_dragon', 'slow', { heroD: hero({ bonuses: [{ type: 'negate_resistance', side: 'both' }] }) }), true);
});

test('spell_immunity, school_immunity, spell_vulnerability x2', () => {
  const can = (id, spell) => { const cs = battle([[id, 1]], [['imp', 1]]); return canSpellAffect(cs, spell, A(cs), 'defender'); };
  assert.equal(can('troglodyte', 'blind'), false);
  assert.equal(can('air_elemental', 'meteor_shower'), false);
  assert.equal(can('water_elemental', 'ice_bolt'), false);
  assert.equal(can('earth_elemental', 'lightning_bolt'), false);
  assert.equal(can('efreet', 'fireball'), false);
  assert.equal(can('efreet', 'bloodlust'), false, 'fire school, even friendly');
  assert.equal(can('efreet', 'magic_arrow'), true, "'all' school");
  assert.equal(spellDmg('air_elemental', 'lightning_bolt'), 200);
  assert.equal(spellDmg('water_elemental', 'fireball'), 200);
  assert.equal(spellDmg('fire_elemental', 'ice_bolt'), 200);
  assert.equal(spellDmg('earth_elemental', 'meteor_shower'), 200);
  assert.equal(spellDmg('frost_giant', 'fireball'), 200);
  assert.equal(spellDmg('frost_giant', 'ice_bolt'), undefined);
});

test('fire_shield: melee attackers take 20% of the damage dealt (capped), fire immune excepted', () => {
  const cs = battle([['crusader', 10]], [['efreet_sultan', 2]]);
  const ev = melee(cs, A(cs), D(cs));
  assert.equal(firstDamage(ev, D(cs)), 95); // 100 * 0.95
  assert.equal(damageTo(ev, A(cs), 'spell')[0].amount, 19);
  const cap = battle([['crusader', 10]], [['efreet_sultan', 1]], { heroA: hero({ attack: 30 }) });
  assert.equal(damageTo(melee(cap, A(cap), D(cap)), A(cap), 'spell')[0].amount, 18, '20% of 90 hp');
  const imm = battle([['efreet', 10]], [['efreet_sultan', 5]]);
  assert.equal(damageTo(melee(imm, A(imm), D(imm)), A(imm), 'spell').length, 0);
  const shot = battle([['archer', 10]], [['efreet_sultan', 5]]);
  place(D(shot), 8, 5);
  assert.equal(damageTo(shoot(shot, A(shot), D(shot)), A(shot)).length, 0);
  // the Fire Shield spell works the same way with its own percent
  const sp = battle([['crusader', 10]], [['pikeman', 99]]);
  addStatus(sp, D(sp), 'fire_shield', { mastery: 2, casterSide: 'defender', rounds: 3 });
  assert.equal(damageTo(melee(sp, A(sp), D(sp)), A(sp), 'spell')[0].amount, 33); // 135 * 25%
});

test('magic_mirror: 20% to bounce a hostile single-target spell to the caster side', () => {
  const cs = battle([['pikeman', 10]], [['faerie_dragon', 1]], { chance: { magic_mirror: true } });
  const ev = applySpellToStack(cs, 'curse', { mastery: 1, power: 3, casterSide: 'attacker', allowMirror: true }, D(cs));
  assert.ok(has(ev, 'spell_reflected', (e) => e.toStackId === A(cs).id));
  assert.deepEqual(effectIds(A(cs)), ['curse']);
  assert.deepEqual(effectIds(D(cs)), []);
  const no = battle([['pikeman', 10]], [['faerie_dragon', 1]], { chance: { magic_mirror: false } });
  applySpellToStack(no, 'curse', { mastery: 1, power: 3, casterSide: 'attacker', allowMirror: true }, D(no));
  assert.deepEqual(effectIds(D(no)), ['curse']);
});

test('regeneration (and Elixir of Life): top creature healed at the start of its turn, no resurrection', () => {
  const cs = battle([['troll', 5], ['pikeman', 5]], [['imp', 1]], { heroA: hero({ bonuses: [{ type: 'creature_regeneration', except: [] }] }) });
  A(cs, 0).hp = 3; A(cs, 0).count = 4;
  A(cs, 1).hp = 2;
  while (cs.round < 2) act(cs, { type: 'defend' });
  while (!A(cs, 1).turnStarted) act(cs, { type: 'defend' });
  assert.equal(A(cs, 0).hp, 40);
  assert.equal(A(cs, 0).count, 4);
  assert.equal(A(cs, 1).hp, 10);
});

test('rebirth: 20% of the starting count rise once', () => {
  const cs = battle([['pikeman', 1]], [['phoenix', 10]]);
  const ev = [];
  applyDamage(cs, D(cs), 99999, {}, ev);
  assert.ok(has(ev, 'rebirth', (e) => e.count === 2));
  assert.equal(D(cs).alive, true);
  applyDamage(cs, D(cs), 99999, {}, ev);
  assert.equal(D(cs).alive, false);
  // original: no minimum - 3 phoenixes give 0 + three 20% rolls
  const small = battle([['pikeman', 1]], [['phoenix', 3]], { chance: { rebirth: false } });
  applyDamage(small, D(small), 99999, {}, []);
  assert.equal(D(small).alive, false, 'nobody reborn when every remainder roll fails');
  const lucky = battle([['pikeman', 1]], [['phoenix', 3]], { chance: { rebirth: true } });
  applyDamage(lucky, D(lucky), 99999, {}, []);
  assert.equal(D(lucky).count, 3, 'each of the 3 remainder phoenixes rolled 20% and succeeded');
  // 13 phoenixes: floor(2.6) = 2 sure + 3 remainder rolls (forced: hit, miss, hit)
  const mixed = battle([['pikeman', 1]], [['phoenix', 13]], { chance: { rebirth: undefined }, forceRolls: [0.1, 0.5, 0.19] });
  applyDamage(mixed, D(mixed), 99999, {}, []);
  assert.equal(D(mixed).count, 4);
  assert.deepEqual(mixed.forceRolls, [], 'exactly three remainder rolls');
});

test('invulnerability: Crimson Couatl ignores damage and spells until its next turn, once', () => {
  const cs = battle([['crimson_couatl', 2]], [['pikeman', 99]]);
  place(A(cs), 5, 5); place(D(cs), 6, 5);
  activate(cs, A(cs));
  const ab = getLegalActions(cs).abilities.find((a) => a.ability === 'invulnerability');
  assert.deepEqual(ab.targets, [A(cs).id]);
  act(cs, { type: 'ability', ability: 'invulnerability' });
  assert.equal(A(cs).invulnerable, true);
  assert.equal(canSpellAffect(cs, 'slow', A(cs), 'defender'), false);
  assert.equal(firstDamage(melee(cs, D(cs), A(cs), { keep: true }), A(cs)), 0);
  while (cs.active !== A(cs).id) act(cs, { type: 'defend' });
  assert.equal(A(cs).invulnerable, false);
  assert.ok(!getLegalActions(cs).abilities.some((a) => a.ability === 'invulnerability'));
});

test('explode_on_death: neighbours of both sides take 9 per destroyed automaton', () => {
  const cs = battle([['automaton', 10], ['pikeman', 50], ['automaton', 5]], [['pikeman', 50]]);
  place(A(cs, 0), 5, 5); place(A(cs, 1), 5, 4); place(A(cs, 2), 4, 5); place(D(cs), 6, 5);
  const ev = [];
  applyDamage(cs, A(cs, 0), 90, {}, ev); // 3 automatons
  assert.equal(damageTo(ev, D(cs))[0].amount, 27);
  assert.equal(damageTo(ev, A(cs, 1))[0].amount, 27);
  assert.equal(damageTo(ev, A(cs, 2)).length, 0, 'automatons do not chain');
});

test('auras: hero_spell_cost, enemy_spell_cost; magic_channel; mana_drain', () => {
  const h = hero({ mana: 50, spells: ['magic_arrow'], power: 2 });
  let cs = battle([['mage', 5], ['bog_witch', 5]], [['imp', 1]], { heroA: h });
  assert.equal(heroSpellCost(cs, 'attacker', 'magic_arrow'), 3); // 5 - 2 (largest)
  cs = battle([['pikeman', 5]], [['pegasus', 1]], { heroA: h });
  assert.equal(heroSpellCost(cs, 'attacker', 'magic_arrow'), 7);
  cs = battle([['pikeman', 5]], [['familiar', 5]], { heroA: h, heroD: hero({ mana: 0, maxMana: 20 }) });
  activate(cs, A(cs));
  const ev = act(cs, { type: 'cast', spellId: 'magic_arrow', target: D(cs).id });
  assert.ok(has(ev, 'mana_channel', (e) => e.amount === 1)); // floor(5 * 20%)
  assert.equal(cs.sides.defender.hero.mana, 1);
  cs = battle([['wraith', 5], ['will_o_wisp', 5]], [['imp', 1]], { heroD: hero({ mana: 10 }) });
  while (cs.round < 2) act(cs, { type: 'defend' });
  assert.equal(cs.sides.defender.hero.mana, 6); // round 1: 2 + 1, round 2 has begun with the wisp: 1
});

test('spellcaster: Ogre Mage Bloodlust x3, elemental protections, Leprechaun Fortune, Satyr mass Mirth', () => {
  const cs = battle([['ogre_mage', 5], ['pikeman', 5]], [['imp', 1]]);
  for (let i = 0; i < 3; i++) {
    activate(cs, A(cs, 0));
    act(cs, { type: 'ability', ability: 'spellcaster', targetId: A(cs, 1).id });
    A(cs, 1).effects = [];
  }
  activate(cs, A(cs, 0));
  assert.ok(!getLegalActions(cs).abilities.some((a) => a.ability === 'spellcaster'));
  const cs2 = battle([['storm_elemental', 5], ['pikeman', 5]], [['imp', 1]]);
  activate(cs2, A(cs2, 0));
  const ev = act(cs2, { type: 'ability', ability: 'spellcaster', targetId: A(cs2, 1).id });
  assert.ok(has(ev, 'status_added', (e) => e.spellId === 'protection_from_air' && e.mastery === 2 && e.rounds === 6));
  const cs3 = battle([['leprechaun', 5], ['pikeman', 5]], [['imp', 1]]);
  activate(cs3, A(cs3, 0));
  act(cs3, { type: 'ability', ability: 'spellcaster', targetId: A(cs3, 1).id });
  assert.equal(getStackInfo(cs3, A(cs3, 1).id).luck, 2);
  const cs4 = battle([['satyr', 5], ['pikeman', 5], ['skeleton', 5]], [['imp', 1]]);
  activate(cs4, A(cs4, 0));
  act(cs4, { type: 'ability', ability: 'spellcaster', targetId: A(cs4, 1).id });
  assert.deepEqual([effectIds(A(cs4, 0)), effectIds(A(cs4, 1)), effectIds(A(cs4, 2))], [['mirth'], ['mirth'], []]);
});

test('spellcaster: Master Genie casts a random useful spell; Faerie Dragon rolls a damage spell each turn', () => {
  const cs = battle([['master_genie', 5], ['pikeman', 5]], [['imp', 1]]);
  activate(cs, A(cs, 0));
  act(cs, { type: 'ability', ability: 'spellcaster', targetId: A(cs, 1).id });
  assert.equal(A(cs, 1).effects.length, 1);
  assert.equal(A(cs, 0).castsLeft.spellcaster, 2);
  const fd = battle([['faerie_dragon', 1]], [['pikeman', 999]], { forceRolls: [0] }); // magic_arrow
  assert.equal(A(fd).pendingSpell, 'magic_arrow');
  assert.ok(has(fd.startEvents, 'spell_ready'));
  const ev = act(fd, { type: 'ability', ability: 'spellcaster', targetId: D(fd).id });
  assert.equal(damageTo(ev, D(fd))[0].amount, 70); // advanced 20 + 10 * (5 x 1)
  assert.equal(A(fd).castsLeft.spellcaster, 4);
});

test('mass_caster: the Enchanter casts an expert mass spell in rounds 1, 4, 7...', () => {
  const cs = battle([['enchanter', 5], ['pikeman', 5]], [['imp', 5], ['gog', 5]], { forceRolls: [0] }); // first option: air_shield on allies
  assert.ok(has(cs.startEvents, 'spell', (e) => e.spellId === 'air_shield' && e.mass));
  assert.deepEqual([effectIds(A(cs, 0)), effectIds(A(cs, 1))], [['air_shield'], ['air_shield']]);
  const cs2 = battle([['enchanter', 5]], [['imp', 5], ['gog', 5]], { forceRolls: [0.99] }); // last option: weakness on enemies
  assert.deepEqual([effectIds(D(cs2, 0)), effectIds(D(cs2, 1))], [['weakness'], ['weakness']]);
  let casts = 0;
  for (let r = 0; r < 40 && cs2.round <= 4; r++) casts += performAction(cs2, { type: 'defend' }).events.filter((e) => e.type === 'spell').length;
  assert.equal(casts, 1, 'next cast in round 4');
});

test('resurrection (Archangel), raise_demons (Pit Lord), repair, devour_corpse', () => {
  const cs = battle([['arch_angel', 2], ['pikeman', 50]], [['imp', 1]]);
  A(cs, 1).count = 10;
  activate(cs, A(cs, 0));
  act(cs, { type: 'ability', ability: 'resurrection', targetId: A(cs, 1).id });
  assert.equal(A(cs, 1).count, 30); // 2 x 100 hp
  activate(cs, A(cs, 0));
  assert.ok(!getLegalActions(cs).abilities.some((a) => a.ability === 'resurrection'), 'once per battle');
  const pl = battle([['pit_lord', 10], ['imp', 30]], [['pikeman', 1]]);
  applyDamage(pl, A(pl, 1), 9999, {}, []);
  activate(pl, A(pl, 0));
  const ev = act(pl, { type: 'ability', ability: 'raise_demons', targetId: A(pl, 1).id });
  // 10 pit lords raise 500 hp, but the corpse only held 30 x 4 = 120 hp: floor(120 / 35) = 3
  assert.ok(has(ev, 'summon', (e) => e.creatureId === 'demon' && e.count === 3));
  assert.equal(A(pl, 1).corpseUsed, true);
  const big = battle([['pit_lord', 10], ['pikeman', 80]], [['pikeman', 1]]);
  applyDamage(big, A(big, 1), 99999, {}, []);
  activate(big, A(big, 0));
  const ev2 = act(big, { type: 'ability', ability: 'raise_demons', targetId: A(big, 1).id });
  assert.ok(has(ev2, 'summon', (e) => e.creatureId === 'demon' && e.count === 14)); // floor(min(500, 800) / 35)
  const tiny = battle([['pit_lord', 10], ['imp', 8]], [['pikeman', 1]]);
  applyDamage(tiny, A(tiny, 1), 99999, {}, []);
  activate(tiny, A(tiny, 0));
  assert.ok(!getLegalActions(tiny).abilities.some((a) => a.ability === 'raise_demons'), '8 imps = 32 hp < one demon');
  const rep = battle([['engineer', 5], ['automaton', 10]], [['imp', 1]]);
  place(A(rep, 0), 5, 5); place(A(rep, 1), 6, 5);
  A(rep, 1).count = 5;
  activate(rep, A(rep, 0));
  act(rep, { type: 'ability', ability: 'repair', targetId: A(rep, 1).id });
  assert.equal(A(rep, 1).count, 7); // 50 hp: 30 + 20
  const og = battle([['olgoi_khorkhoi', 10], ['pikeman', 20]], [['imp', 1]]);
  place(A(og, 0), 5, 5); place(A(og, 1), 6, 5);
  applyDamage(og, A(og, 1), 9999, {}, []);
  A(og, 0).count = 5;
  activate(og, A(og, 0));
  act(og, { type: 'ability', ability: 'devour_corpse', targetId: A(og, 1).id });
  assert.equal(A(og, 0).count, 7); // 300 + 100 hp
  assert.equal(A(og, 0).hp, 40);
});

test('undead / non-living tags: mind spells and life effects do not apply', () => {
  const cs = battle([['skeleton', 1], ['stone_golem', 1], ['pikeman', 1]], [['imp', 1]]);
  for (const [i, can] of [[0, false], [1, false], [2, true]]) {
    assert.equal(canSpellAffect(cs, 'blind', A(cs, i), 'defender'), can);
    assert.equal(canSpellAffect(cs, 'poison', A(cs, i), 'defender'), can);
  }
});

test('tag and passive abilities: non_living, mechanical, mind_immune, army_morale, luck_doubling, immobile, hero_attack_scaling, ammo_supply', () => {
  const cs = battle([['stone_golem', 1], ['automaton', 1], ['giant', 1], ['angel', 1], ['leprechaun', 1]], [['imp', 1]], { machinesA: ['ballista', 'ammo_cart'] });
  for (const i of [0, 1, 2]) assert.equal(canSpellAffect(cs, 'blind', A(cs, i), 'defender'), false); // non_living, mechanical, mind_immune
  assert.equal(getStackInfo(cs, A(cs, 4).id).morale, -2 + 1, 'four factions (-2), army_morale +1');
  const ballista = cs.stacks.find((s) => s.creatureId === 'ballista');
  const info = getStackInfo(cs, ballista.id);
  assert.deepEqual([info.speed, info.moveMode, info.machineControl], [0, 'walk', 'auto']); // immobile, hero_attack_scaling
  activate(cs, ballista);
  assert.deepEqual(getLegalActions(cs).moves, []);
  assert.equal(cs.stacks.find((s) => s.creatureId === 'ammo_cart').acted, false, 'ammo_supply carts never take turns');
});
