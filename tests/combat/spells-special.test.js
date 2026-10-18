// Non-status spells: summons, clone, teleport, obstacles (lifecycle), remove obstacle,
// earthquake, resurrection / animate dead / sacrifice formulas, cast rules (block_spells,
// anti-magic garrison, magic terrain, once per round), Eagle Eye `spellsCast`, previews,
// creature casters through the same pipeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSpellTargets, getSpellAreaPreview, getCastableSpells, getResult, applyDamage, placeObstacle, getLegalActions,
  performAction, visibleObstacles, getStack, castHeroSpell,
} from '../../src/engine/combat/index.js';
import { endCombat } from '../../src/engine/combat/result.js';
import { tickRoundStart } from '../../src/engine/combat/effects.js';
import { place, has, act, activate } from './helpers.js';
import { arena, cast, castFail, dmgOn, effectOf, A, D, hero, battle } from './spells-helpers.js';

const kill = (cs, stack, hp) => applyDamage(cs, stack, hp, { kind: 'test' }, []);

// ---- summons --------------------------------------------------------------------------------------

test('summon elementals: perSpellPower x SP, back column, one kind per side, reinforcement, vanish after battle', () => {
  for (const [m, n] of [[0, 6], [1, 6], [2, 9], [3, 12]]) {
    const cs = arena(['summon_fire_elemental'], { m, power: 3 });
    const ev = cast(cs, 'summon_fire_elemental');
    const s = cs.stacks.find((x) => x.creatureId === 'fire_elemental');
    assert.equal(s.count, n, `m${m}`);
    assert.deepEqual(s.pos, { x: 0, y: 4 }, 'first free hex: back column, middle rows first');
    assert.equal(s.summoned, true);
    assert.ok(has(ev, 'summon', (e) => e.stackId === s.id && e.spellId === 'summon_fire_elemental'));
  }
  const cs = arena(['summon_fire_elemental', 'summon_water_elemental'], { m: 1, power: 2, bonuses: [{ type: 'spell_power_percent', percent: 50 }] });
  cast(cs, 'summon_fire_elemental');
  const fire = cs.stacks.find((x) => x.creatureId === 'fire_elemental');
  assert.equal(fire.count, 4, 'Sorcery / orbs do not affect summons');
  assert.equal(fire.acted, true, 'acts from the next round');
  cast(cs, 'summon_fire_elemental');
  assert.deepEqual([fire.count, fire.startCount], [8, 8], 'same kind: reinforces the living stack');
  assert.equal(getSpellTargets(cs, 'attacker', 'summon_water_elemental').available, false);
  assert.equal(castFail(cs, 'summon_water_elemental'), 'no_target', 'another kind while one lives');
  kill(cs, fire, 10000);
  assert.equal(castFail(cs, 'summon_water_elemental'), 'no_target', 'one elemental kind per battle, even after it died');
  cast(cs, 'summon_fire_elemental');
  assert.ok(cs.stacks.some((x) => x.alive && x.creatureId === 'fire_elemental'), 'the same kind may be summoned anew');
  endCombat(cs, 'attacker', 'test', []);
  const res = getResult(cs);
  assert.deepEqual(res.attacker.army.filter(Boolean), [{ creatureId: 'pikeman', count: 100 }], 'summons are not survivors');
  assert.deepEqual(res.attacker.losses, {});
  assert.deepEqual(res.attacker.spellsCast, ['summon_fire_elemental', 'summon_fire_elemental', 'summon_fire_elemental']);
});

test('summon: no free hex -> not castable', () => {
  const cs = arena(['summon_air_elemental'], { m: 1 });
  for (let x = 0; x < 15; x++) for (let y = 0; y < 11; y++) placeObstacle(cs, { kind: 'rock', hexes: [{ x, y }], magical: false, blocks: true });
  assert.equal(getSpellTargets(cs, 'attacker', 'summon_air_elemental').available, false);
});

// ---- clone ----------------------------------------------------------------------------------------

test('clone: tier limit 5/5/6/7 (never 8), same count / shots, any damage kills it, lifetime SP rounds, one clone per stack', () => {
  const army = [['genie', 3], ['efreet', 2], ['angel', 1], ['faerie_dragon', 1], ['archer', 10]];
  const legal = (m) => {
    const cs = arena(['clone'], { m, att: army });
    return getSpellTargets(cs, 'attacker', 'clone').stackIds.map((id) => getStack(cs, id).creatureId);
  };
  assert.deepEqual(legal(1), ['genie', 'archer']);
  assert.deepEqual(legal(2), ['genie', 'efreet', 'archer']);
  assert.deepEqual(legal(3), ['genie', 'efreet', 'angel', 'archer']);
  const cs = arena(['clone', 'magic_arrow'], { m: 1, power: 4, att: army, heroD: hero({ power: 1, mana: 99, spells: ['magic_arrow'] }) });
  A(cs, 4).shots = 7;
  const ev = cast(cs, 'clone', A(cs, 4).id);
  const clone = cs.stacks.find((s) => s.clone);
  assert.deepEqual([clone.creatureId, clone.count, clone.shots, clone.hp, clone.cloneRoundsLeft, clone.side], ['archer', 10, 7, 10, 4, 'attacker']);
  assert.ok(has(ev, 'summon', (e) => e.clone && e.cloneOf === A(cs, 4).id));
  assert.equal(getSpellTargets(cs, 'attacker', 'clone').stackIds.includes(A(cs, 4).id), false, 'one living clone per stack');
  assert.equal(getSpellTargets(cs, 'attacker', 'clone').stackIds.includes(clone.id), false, 'clones cannot be cloned');
  const ev2 = cast(cs, 'magic_arrow', clone.id, 'defender');
  assert.equal(clone.alive, false, '10 damage destroys all 10 archers (100 hp)');
  assert.ok(has(ev2, 'death', (e) => e.stackId === clone.id));
  endCombat(cs, 'attacker', 'test', []);
  assert.equal(getResult(cs).attacker.army.filter(Boolean).length, 5);
});

// ---- teleport -------------------------------------------------------------------------------------

test('teleport: two-step targeting, free hexes only, keeps the action, triggers traps on the destination only', () => {
  const cs = arena(['teleport'], { m: 1, att: [['pikeman', 10], ['ballista', 1]], def: [['imp', 10]] });
  const first = getSpellTargets(cs, 'attacker', 'teleport');
  assert.deepEqual([first.mode, first.target2, first.stackIds], ['friendly_stack', 'hex', [A(cs).id]]);
  const second = getSpellTargets(cs, 'attacker', 'teleport', { stackId: A(cs).id });
  assert.equal(second.mode, 'hex');
  assert.equal(second.hexes.some((h) => h.x === D(cs).pos.x && h.y === D(cs).pos.y), false, 'occupied hex');
  placeObstacle(cs, { kind: 'boulder', hexes: [{ x: 7, y: 7 }], magical: false });
  assert.equal(castFail(cs, 'teleport', { stackId: A(cs).id, hex: { x: 7, y: 7 } }), 'bad_target');
  placeObstacle(cs, { kind: 'land_mine', hexes: [{ x: 4, y: 4 }], side: 'defender', hidden: true, damage: 50, element: 'fire', spellId: 'land_mine' });
  placeObstacle(cs, { kind: 'land_mine', hexes: [{ x: 9, y: 9 }], side: 'defender', hidden: true, damage: 50, element: 'fire', spellId: 'land_mine' });
  const ev = cast(cs, 'teleport', { stackId: A(cs).id, hex: { x: 9, y: 9 } });
  assert.deepEqual(A(cs).pos, { x: 9, y: 9 });
  assert.ok(has(ev, 'move', (e) => e.mode === 'teleport' && e.spellId === 'teleport'));
  assert.equal(dmgOn(ev, A(cs)), 50, 'mine on the destination');
  assert.equal(cs.obstacles.filter((o) => o.kind === 'land_mine').length, 1, 'the mine on the way stays');
  assert.equal(cs.active, A(cs).id, 'still its turn');
  // cost 15/12/3/3
  assert.equal(ev[0].cost, 12);
});

test('teleport in a siege: walls need expert, the moat advanced (legacy wall-column geometry and the siege module)', () => {
  const cs = arena(['teleport'], { m: 1, siege: { fortLevel: 1 } });
  cs.sides.attacker.hero.skills.water_magic = 1;
  place(A(cs), 2, 5);
  cs.siege.wallColumn = 8;
  const hexes = (m) => {
    cs.sides.attacker.hero.skills.water_magic = m;
    return getSpellTargets(cs, 'attacker', 'teleport', { stackId: A(cs).id }).hexes;
  };
  assert.equal(hexes(1).some((h) => h.x >= 8), false);
  assert.equal(hexes(3).some((h) => h.x >= 8), true);
  cs.siege.wallColumn = null; // real siege geometry
  const basic = hexes(1).length;
  const expert = hexes(3).length;
  assert.ok(expert > basic, 'expert reaches behind the walls');
});

// ---- obstacles ------------------------------------------------------------------------------------

test('force field: vertical line of 2/2/3/3 free hexes, blocks movement, gone after 2 rounds', () => {
  for (const [m, len] of [[1, 2], [3, 3]]) {
    const cs = arena(['force_field'], { m });
    const ev = cast(cs, 'force_field', { x: 6, y: 3 });
    const o = cs.obstacles.find((x) => x.kind === 'force_field');
    assert.equal(o.hexes.length, len);
    assert.deepEqual(o.hexes[1], { x: 6, y: 4 });
    assert.deepEqual([o.blocks, o.roundsLeft, o.side], [true, 2, 'attacker']);
    assert.ok(has(ev, 'obstacle_added', (e) => e.kind === 'force_field'));
    tickRoundStart(cs);
    assert.ok(cs.obstacles.includes(o));
    const ev2 = tickRoundStart(cs);
    assert.equal(cs.obstacles.includes(o), false);
    assert.ok(has(ev2, 'obstacle_removed', (e) => e.kind === 'force_field'));
  }
  const cs = arena(['force_field'], { m: 3 });
  const t = getSpellTargets(cs, 'attacker', 'force_field');
  assert.equal(t.mode, 'hex');
  assert.equal(t.hexes.some((h) => h.y > 8), false, 'the line must fit on the field');
  assert.equal(t.hexes.some((h) => h.x === 0 && h.y >= 3 && h.y <= 5), false, 'not over a stack');
  assert.equal(castFail(cs, 'force_field', { x: 0, y: 4 }), 'bad_target');
  assert.deepEqual(getSpellAreaPreview(cs, 'attacker', 'force_field', { x: 6, y: 3 }).hexes, [{ x: 6, y: 3 }, { x: 6, y: 4 }, { x: 6, y: 5 }]);
});

test('fire wall: damage frozen at cast (with Sorcery / specialty), on entry and at turn start, fire immune spared', () => {
  // expert SP 2: 50 + 20 = 70; Luna-style +100 % specialty and +10 % Sorcery: 70 * 1.1 * 2 = 154
  const cs = arena(['fire_wall'], { m: 3, power: 2, bonuses: [{ type: 'spell_power_percent', percent: 10 }, { type: 'spell_specialty', spellId: 'fire_wall', mode: 'fixed_percent', percent: 100, heroLevel: 1 }] });
  cast(cs, 'fire_wall', { x: 7, y: 4 });
  const o = cs.obstacles.find((x) => x.kind === 'fire_wall');
  assert.deepEqual([o.hexes.length, o.roundsLeft, o.blocks, o.hidden], [3, 2, false, false]);
  assert.ok(Math.abs(o.damage - 154) < 1e-9);
  cs.sides.attacker.hero.power = 50;
  // the enemy walks through it
  const d = D(cs);
  place(d, 9, 5);
  activate(cs, d);
  const ev = act(cs, { type: 'move', to: { x: 6, y: 5 } });
  assert.equal(dmgOn(ev, d), 154, 'damage frozen at cast time');
  assert.ok(has(ev, 'obstacle_triggered', (e) => e.kind === 'fire_wall'));
});

test('quicksand / land mines: 4/4/6/8 random free hexes, hidden from the enemy, mines hurt enemy walkers and vanish', () => {
  for (const [m, n] of [[0, 4], [1, 4], [2, 6], [3, 8]]) {
    const cs = arena(['quicksand', 'land_mine'], { m, power: 2 });
    cast(cs, 'quicksand');
    cast(cs, 'land_mine');
    assert.equal(cs.obstacles.filter((o) => o.kind === 'quicksand').length, n);
    const mines = cs.obstacles.filter((o) => o.kind === 'land_mine');
    assert.equal(mines.length, n);
    assert.ok(mines.every((o) => o.hidden && o.side === 'attacker' && o.roundsLeft === null));
    assert.equal(mines[0].damage, [25, 25, 50, 100][m] + 20);
    assert.ok(mines.every((o) => !cs.stacks.some((s) => s.alive && s.pos.x === o.hexes[0].x && s.pos.y === o.hexes[0].y)));
    assert.equal(visibleObstacles(cs, 'defender').length, 0, 'the enemy sees none of them');
    assert.equal(visibleObstacles(cs, 'attacker').length, 2 * n);
  }
  // an enemy walking onto a mine: stops, takes the frozen damage, the mine is consumed
  const cs = arena(['land_mine'], { m: 1, power: 2, def: [['pikeman', 100], ['griffin', 10]] });
  placeObstacle(cs, { kind: 'land_mine', hexes: [{ x: 11, y: 2 }], side: 'attacker', hidden: true, damage: 45, element: 'fire', spellId: 'land_mine' });
  const d = D(cs, 0);
  activate(cs, d);
  const ev = act(cs, { type: 'move', to: { x: 10, y: 2 } });
  assert.deepEqual(d.pos, { x: 11, y: 2 });
  assert.equal(dmgOn(ev, d), 45);
  assert.equal(cs.obstacles.length, 0);
});

test('remove obstacle: natural at basic, + fire wall at advanced, + magical at expert; never enemy-hidden ones', () => {
  const setup = (m) => {
    const cs = arena(['remove_obstacle'], { m });
    placeObstacle(cs, { kind: 'boulder', hexes: [{ x: 6, y: 1 }], magical: false });
    placeObstacle(cs, { kind: 'fire_wall', hexes: [{ x: 7, y: 1 }], side: 'defender', rounds: 2 });
    placeObstacle(cs, { kind: 'force_field', hexes: [{ x: 8, y: 1 }], side: 'defender', rounds: 2 });
    placeObstacle(cs, { kind: 'quicksand', hexes: [{ x: 9, y: 1 }], side: 'defender', hidden: true });
    placeObstacle(cs, { kind: 'quicksand', hexes: [{ x: 10, y: 1 }], side: 'attacker', hidden: true });
    return cs;
  };
  const kinds = (m) => {
    const cs = setup(m);
    return getSpellTargets(cs, 'attacker', 'remove_obstacle').obstacleIds.map((id) => cs.obstacles.find((o) => o.id === id).kind);
  };
  assert.deepEqual(kinds(1), ['boulder']);
  assert.deepEqual(kinds(2), ['boulder', 'fire_wall']);
  assert.deepEqual(kinds(3), ['boulder', 'fire_wall', 'force_field', 'quicksand']);
  const cs = setup(1);
  const id = cs.obstacles[0].id;
  assert.equal(castFail(cs, 'remove_obstacle', cs.obstacles[1].id), 'bad_target');
  const ev = cast(cs, 'remove_obstacle', id);
  assert.ok(has(ev, 'obstacle_removed', (e) => e.obstacleId === id));
  assert.equal(getSpellAreaPreview(cs, 'attacker', 'remove_obstacle', { x: 7, y: 1 }).valid, false);
});

// ---- earthquake -----------------------------------------------------------------------------------

test('earthquake: siege only, attacker only, 2/2/3/4 hits on walls / gate (never towers)', () => {
  assert.equal(getSpellTargets(arena(['earthquake'], { m: 3 }), 'attacker', 'earthquake').available, false);
  for (const [m, hits] of [[1, 2], [2, 3], [3, 4]]) {
    const cs = arena(['earthquake'], { m, siege: { fortLevel: 3 } });
    const towers = JSON.stringify(cs.siege.towers);
    const before = cs.siege.walls.reduce((a, w) => a + w.hp, 0) + cs.siege.gate.hp;
    const ev = cast(cs, 'earthquake');
    const after = cs.siege.walls.reduce((a, w) => a + w.hp, 0) + cs.siege.gate.hp;
    assert.equal(before - after, hits);
    assert.equal(JSON.stringify(cs.siege.towers), towers);
    assert.equal(ev.filter((e) => e.type === 'wall_damaged').length, hits);
  }
  // the defending hero cannot shake his own walls
  const cs = arena([], { m: 3, siege: { fortLevel: 1 }, heroD: hero({ mana: 99, spells: ['earthquake'], skills: { earth_magic: 3 } }) });
  assert.equal(getSpellTargets(cs, 'defender', 'earthquake').available, false);
});

test('earthquake fallback without the siege module helpers: plain wall records', async () => {
  const cs = arena(['earthquake'], { m: 1, siege: { fortLevel: 1 } });
  for (const w of cs.siege.walls) w.hp = 0;
  cs.siege.gate.hp = 0;
  assert.equal(getSpellTargets(cs, 'attacker', 'earthquake').available, false, 'nothing left to shake');
});

// ---- raising the dead -----------------------------------------------------------------------------

test('resurrection: 50*SP + 40/40/80/160, temporary at basic, permanent at advanced, capped at the start count', () => {
  let cs = arena(['resurrection'], { m: 1, power: 2, att: [['pikeman', 20]] });
  kill(cs, A(cs), 147); // 53 hp left: 6 pikemen, top 3 hp
  assert.deepEqual([A(cs).count, A(cs).hp], [6, 3]);
  let ev = cast(cs, 'resurrection', A(cs).id); // +140: 193 hp
  assert.deepEqual([A(cs).count, A(cs).hp, A(cs).tempRaised], [20, 3, 14]);
  assert.ok(has(ev, 'resurrect', (e) => e.raised === 14 && e.permanent === false));
  endCombat(cs, 'attacker', 'test', []);
  assert.equal(getResult(cs).attacker.army[0].count, 6, 'temporary creatures vanish');
  cs = arena(['resurrection'], { m: 2, power: 2, att: [['pikeman', 20]] });
  kill(cs, A(cs), 150);
  cast(cs, 'resurrection', A(cs).id); // +180, capped at 200
  assert.deepEqual([A(cs).count, A(cs).hp, A(cs).tempRaised], [20, 10, 0]);
  assert.equal(castFail(cs, 'resurrection', A(cs).id), 'no_target', 'nothing to restore');
  // a fully dead stack whose hexes are free
  cs = arena(['resurrection'], { m: 3, power: 2, att: [['pikeman', 50], ['archer', 5]] });
  kill(cs, A(cs, 0), 10000);
  ev = cast(cs, 'resurrection', A(cs, 0).id); // 160 + 100 = 260
  assert.deepEqual([A(cs, 0).alive, A(cs, 0).count], [true, 26]);
  assert.ok(has(ev, 'resurrect', (e) => e.wasDead));
  // specialty (level 10 vs tier 1: x1.3) and undead immunity
  cs = arena(['resurrection'], { m: 1, power: 2, att: [['pikeman', 50], ['skeleton', 5]], bonuses: [{ type: 'spell_specialty', spellId: 'resurrection', mode: 'level_scaled', percentPerStep: 3, heroLevel: 10 }] });
  kill(cs, A(cs, 0), 300);
  kill(cs, A(cs, 1), 12);
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'resurrection').stackIds, [A(cs, 0).id]);
  cast(cs, 'resurrection', A(cs, 0).id);
  assert.deepEqual([A(cs, 0).count, A(cs, 0).hp], [39, 2], '200 + 182 hp');
});

test('animate dead: undead only, 50*SP + 30/30/60/160, always permanent', () => {
  const cs = arena(['animate_dead'], { m: 1, power: 2, att: [['skeleton', 50], ['pikeman', 10]] });
  kill(cs, A(cs, 0), 240);
  kill(cs, A(cs, 1), 50);
  assert.deepEqual(getSpellTargets(cs, 'attacker', 'animate_dead').stackIds, [A(cs, 0).id]);
  cast(cs, 'animate_dead', A(cs, 0).id); // 60 hp left + 130 = 190: 32 skeletons, top 4 hp
  assert.deepEqual([A(cs, 0).count, A(cs, 0).hp, A(cs, 0).tempRaised], [32, 4, 0]);
});

test('sacrifice: (SP + victim hp + 3/3/6/10) x victim count, victim destroyed for good, living targets only', () => {
  for (const [m, count, hp] of [[1, 15, 10], [3, 19, 5]]) {
    const cs = arena(['sacrifice'], { m, power: 2, att: [['pikeman', 20], ['griffin', 5], ['skeleton', 10]] });
    kill(cs, A(cs, 0), 10000);
    const t = getSpellTargets(cs, 'attacker', 'sacrifice');
    assert.deepEqual([t.mode, t.target2, t.stackIds], ['dead_friendly_stack', 'friendly_stack', [A(cs, 0).id]]);
    assert.deepEqual(getSpellTargets(cs, 'attacker', 'sacrifice', { stackId: A(cs, 0).id }).stackIds, [A(cs, 1).id], 'undead cannot be sacrificed');
    const ev = cast(cs, 'sacrifice', { stackId: A(cs, 0).id, victimId: A(cs, 1).id });
    // basic: (2 + 25 + 3) * 5 = 150 -> 15 pikemen; expert: (2 + 25 + 10) * 5 = 185 -> 18 + 5 hp, capped at 20
    assert.deepEqual([A(cs, 0).count, A(cs, 0).hp, A(cs, 0).tempRaised], [count, hp, 0]);
    assert.equal(A(cs, 1).alive, false);
    assert.equal(A(cs, 1).corpseUsed, true, 'cannot be raised again');
    assert.ok(has(ev, 'death', (e) => e.stackId === A(cs, 1).id));
  }
});

// ---- cast rules -----------------------------------------------------------------------------------

test('cast rules: once per round, own turn only, no tactics phase, mana, unknown spell, spells blocked', () => {
  const cs = arena(['magic_arrow', 'haste'], { m: 1, power: 2, mana: 10 });
  act(cs, { type: 'cast', spellId: 'magic_arrow', target: D(cs).id });
  assert.equal(cs.sides.attacker.hero.mana, 6);
  assert.deepEqual(performAction(cs, { type: 'cast', spellId: 'haste', target: A(cs).id }), { ok: false, error: 'already_cast' });
  cs.sides.attacker.castThisRound = false;
  activate(cs, D(cs));
  assert.equal(castHeroSpell(cs, 'attacker', 'haste', A(cs).id).error, 'not_your_turn');
  activate(cs, A(cs));
  assert.equal(castHeroSpell(cs, 'attacker', 'implosion', D(cs).id).error, 'unknown_spell');
  cs.sides.attacker.hero.mana = 3;
  assert.equal(castHeroSpell(cs, 'attacker', 'haste', A(cs).id).error, 'no_mana');
  // Recanter's Cloak: levels 3-5 for both heroes
  const rc = arena(['haste', 'chain_lightning'], { m: 1, heroD: hero({ bonuses: [{ type: 'block_spells', minLevel: 3, maxLevel: 5, side: 'both' }] }) });
  assert.deepEqual(getCastableSpells(rc, 'attacker'), ['haste']);
  // Orb of Inhibition: nothing at all
  const orb = arena(['haste'], { m: 1, bonuses: [{ type: 'block_spells', minLevel: 1, maxLevel: 5, side: 'both' }] });
  assert.equal(getLegalActions(orb).canCast, false);
  // anti-magic garrison / cursed ground
  const garrison = arena(['haste'], { m: 1, spellLevelCap: 0 });
  assert.equal(castFail(garrison, 'haste', A(garrison).id), 'spells_blocked');
  const cursed = arena(['haste', 'slow', 'prayer'], { m: 1, overlayEffects: [{ type: 'spell_level_cap', maxLevel: 1 }] });
  assert.deepEqual(getCastableSpells(cursed, 'attacker'), ['haste', 'slow']);
  // tactics phase
  const t = battle([['pikeman', 5]], [['imp', 5]], { heroA: hero({ mana: 99, spells: ['haste'], bonuses: [{ type: 'tactics', hexes: 3 }] }), tactics: true });
  assert.equal(t.phase, 'tactics');
  assert.equal(castHeroSpell(t, 'attacker', 'haste', A(t).id).error, 'not_in_battle');
});

test('mastery from magic terrain overlays and spell_school_mastery bonuses; cost per mastery', () => {
  const cs = arena(['slow'], { m: 0, overlayEffects: [{ type: 'spell_mastery', school: 'all', level: 3 }] });
  const ev = cast(cs, 'slow');
  assert.equal(ev[0].mastery, 3);
  assert.equal(ev[0].cost, 5);
  const cs2 = arena(['teleport'], { m: 0, bonuses: [{ type: 'spell_school_mastery', school: 'water', level: 2 }] });
  assert.equal(cast(cs2, 'teleport', { stackId: A(cs2).id, hex: { x: 5, y: 5 } })[0].cost, 3);
});

test('Eagle Eye input: result[side].spellsCast lists every hero cast in order', () => {
  const cs = arena(['magic_arrow', 'haste'], { m: 1, heroD: hero({ mana: 99, spells: ['slow'] }) });
  cast(cs, 'magic_arrow', D(cs).id);
  cast(cs, 'haste', A(cs).id);
  cast(cs, 'magic_arrow', D(cs).id);
  cast(cs, 'slow', A(cs).id, 'defender');
  endCombat(cs, 'attacker', 'test', []);
  const res = getResult(cs);
  assert.deepEqual(res.attacker.spellsCast, ['magic_arrow', 'haste', 'magic_arrow']);
  assert.deepEqual(res.defender.spellsCast, ['slow']);
  assert.ok(JSON.parse(JSON.stringify(res)));
});

// ---- previews ---------------------------------------------------------------------------------------

test('area previews: radius / ring hexes, affected stacks, chain order, single targets, mass', () => {
  const cs = arena(['fireball', 'frost_ring', 'chain_lightning', 'magic_arrow', 'haste', 'armageddon'], { m: 3, power: 2, att: [['pikeman', 10], ['efreet', 1]], def: [['pikeman', 10], ['pikeman', 10]] });
  place(A(cs, 0), 6, 5); place(A(cs, 1), 7, 4); place(D(cs, 0), 7, 5); place(D(cs, 1), 12, 5);
  let p = getSpellAreaPreview(cs, 'attacker', 'fireball', { x: 7, y: 5 });
  assert.equal(p.hexes.length, 7);
  assert.deepEqual(p.stackIds.sort(), [A(cs, 0).id, D(cs, 0).id].sort(), 'efreet is fire immune');
  p = getSpellAreaPreview(cs, 'attacker', 'frost_ring', { x: 7, y: 5 });
  assert.equal(p.hexes.length, 6);
  assert.deepEqual(p.stackIds.sort(), [A(cs, 0).id, A(cs, 1).id].sort(), 'the centre is not hit');
  p = getSpellAreaPreview(cs, 'attacker', 'chain_lightning', { x: 12, y: 5 });
  assert.deepEqual(p.stackIds, [D(cs, 1).id, D(cs, 0).id, A(cs, 0).id, A(cs, 1).id]);
  p = getSpellAreaPreview(cs, 'attacker', 'magic_arrow', { x: 7, y: 5 });
  assert.deepEqual([p.valid, p.stackIds], [true, [D(cs, 0).id]]);
  assert.equal(getSpellAreaPreview(cs, 'attacker', 'magic_arrow', { x: 6, y: 5 }).valid, false);
  p = getSpellAreaPreview(cs, 'attacker', 'haste', null);
  assert.deepEqual(p.stackIds, [A(cs, 0).id, A(cs, 1).id], 'mass haste');
  p = getSpellAreaPreview(cs, 'attacker', 'armageddon', null);
  assert.equal(p.stackIds.length, 3, 'efreet immune to fire');
});

// ---- creature casters -----------------------------------------------------------------------------

test('creature casters use the same pipeline: faerie dragon (SP 5 x count), ogre mage bloodlust, archangel resurrection', () => {
  const cs = battle([['faerie_dragon', 2], ['ogre_mage', 1], ['arch_angel', 2], ['pikeman', 20]], [['pikeman', 1000]], { heroA: hero() });
  const fd = A(cs, 0);
  fd.pendingSpell = 'lightning_bolt';
  activate(cs, fd);
  const ev = act(cs, { type: 'ability', ability: 'spellcaster', targetId: D(cs).id });
  assert.equal(dmgOn(ev, D(cs)), 270, 'advanced: 20 + 25 * (5 * 2)');
  assert.ok(has(ev, 'spell', (e) => e.creature && e.spellId === 'lightning_bolt'));
  const ogre = A(cs, 1);
  activate(cs, ogre);
  act(cs, { type: 'ability', ability: 'spellcaster', targetId: A(cs, 3).id });
  assert.equal(effectOf(A(cs, 3), 'bloodlust').value, 6);
  assert.equal(effectOf(A(cs, 3), 'bloodlust').roundsLeft, 6);
  kill(cs, A(cs, 3), 150);
  activate(cs, A(cs, 2));
  act(cs, { type: 'ability', ability: 'resurrection', targetId: A(cs, 3).id });
  assert.deepEqual([A(cs, 3).count, A(cs, 3).tempRaised], [20, 0]);
  assert.deepEqual(cs.sides.attacker.spellsCast ?? [], [], 'creature casts are not hero casts');
});
