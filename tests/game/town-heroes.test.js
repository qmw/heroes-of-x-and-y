import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_HEROES_PER_PLAYER } from '../../src/core/constants.js';
import { HEROES, getHeroDef } from '../../src/data/heroes.js';
import { getSpell, MAGE_GUILD_BANS, guildSpellPool } from '../../src/data/spells.js';
import { hasArtifact } from '../../src/engine/artifacts.js';
import { deps } from '../../src/engine/gameDeps.js';
import { startNewDay } from '../../src/engine/game.js';
import {
  ensureTavernPool, refreshTavern, getFreeHeroDefs, getTavernHeroes, hireHero, returnHeroToTavern,
  visitTown, leaveTown, swapTownHeroes, townArmyMove, captureTown, buySpellbook, getGarrisonArmy,
  getHeroesInTown, createTown, dismissTownStack, recruit, build,
} from '../../src/engine/town.js';
import { setup, town, hero, setResources, buildAll } from './fixture.js';

// ---- tavern ---------------------------------------------------------------------------------

test('tavern pool: 2 heroes per player, slot 0 of the own faction, no hero offered twice', () => {
  const s = setup({ players: 3, factions: ['castle', 'tower', 'necropolis'] });
  for (const p of s.players) ensureTavernPool(s, p.id);
  const all = s.players.flatMap((p) => p.tavernHeroes);
  assert.equal(all.length, 6);
  assert.equal(new Set(all).size, 6);
  s.players.forEach((p) => {
    assert.equal(getHeroDef(p.tavernHeroes[0]).faction, p.faction);
    assert.ok(p.tavernHeroes.every((id) => !getHeroDef(id).special));
  });
  const before = s.players[0].tavernHeroes.slice();
  assert.deepEqual(ensureTavernPool(s, 0), before, 'filled slots are kept');
  // heroes on the map are never offered
  const onMap = hero(s, 'orrin', 0);
  assert.ok(!getFreeHeroDefs(s).some((d) => d.id === onMap.defId));
  assert.equal(getFreeHeroDefs(s).length, HEROES.filter((d) => !d.special).length - 6 - 1);
  const offer = getTavernHeroes(s, 0);
  assert.deepEqual(offer.map((o) => [o.defId, o.level, o.cost]), before.map((id) => [id, 1, 2500]));
});

test('hireHero: 2500 gold, visiting slot must be free, slot refilled at once, first stack only', () => {
  const s = setup({ poor: true });
  const t = town(s);
  ensureTavernPool(s, 0);
  setResources(s, 0, { gold: 6000 });
  const [first, second] = s.players[0].tavernHeroes;
  assert.equal(hireHero(s, t.id, 2).error, 'no_hero_offered');
  const r = hireHero(s, t.id, 0);
  assert.equal(r.ok, true);
  const h = s.heroes[r.heroId];
  assert.equal(h.defId, first);
  assert.deepEqual([h.owner, h.townId, t.visitingHero], [0, t.id, h.id]);
  assert.deepEqual(h.pos, t.pos);
  assert.ok(s.players[0].heroes.includes(h.id));
  assert.equal(s.players[0].resources.gold, 3500);
  assert.equal(h.army.filter(Boolean).length, 1, 'tavern heroes bring one stack');
  assert.equal(h.army[0].creatureId, getHeroDef(first).startArmy[0].creatureId);
  assert.ok(r.events.some((e) => e.type === 'hero_hired') && r.events.some((e) => e.type === 'town_visited'));
  // refilled immediately with someone new; the other slot is untouched
  const pool = s.players[0].tavernHeroes;
  assert.equal(pool[1], second);
  assert.ok(pool[0] && pool[0] !== first && pool[0] !== second);
  // town occupied
  assert.equal(hireHero(s, t.id, 1).error, 'town_occupied');
  assert.equal(swapTownHeroes(s, t.id).ok, true);
  assert.equal(hireHero(s, t.id, 1).ok, true);
  assert.equal(s.players[0].resources.gold, 1000);
  leaveTown(s, t.visitingHero);
  assert.equal(hireHero(s, t.id, 0).error, 'not_enough_resources');
  assert.equal(s.players[0].heroes.length, 2);
});

test('hireHero: at most 8 heroes per player', () => {
  const s = setup();
  const t = town(s);
  ensureTavernPool(s, 0);
  const ids = ['orrin', 'edric', 'sorsha', 'sylvia', 'valeska', 'tyris', 'christian'];
  for (const id of ids) hero(s, id, 0);
  refreshTavern(s, 0);
  assert.equal(hireHero(s, t.id, 0).ok, true);
  assert.equal(s.players[0].heroes.length, MAX_HEROES_PER_PLAYER);
  leaveTown(s, t.visitingHero);
  assert.equal(hireHero(s, t.id, 1).error, 'too_many_heroes');
});

test('weekly tavern refresh re-rolls both slots', () => {
  const s = setup();
  town(s);
  town(s, { owner: 1, faction: 'rampart', pos: { x: 12, y: 12, z: 0 } });
  for (const p of s.players) ensureTavernPool(s, p.id);
  s.settings.forceWeekEvent = { kind: 'normal' };
  const before = s.players.map((p) => p.tavernHeroes.slice());
  for (let d = 0; d < 6; d++) startNewDay(s);
  assert.deepEqual(s.players.map((p) => p.tavernHeroes), before, 'stable during the week');
  startNewDay(s);
  const after = s.players.map((p) => p.tavernHeroes.slice());
  assert.notDeepEqual(after, before);
  assert.equal(new Set(after.flat()).size, 4);
  for (const p of s.players) assert.equal(getHeroDef(p.tavernHeroes[0]).faction, p.faction);
});

test('retreated / surrendered heroes return to the pool keeping level, skills and artifacts', () => {
  const s = setup();
  const t = town(s);
  ensureTavernPool(s, 0);
  const h = hero(s, 'orrin', 0);
  h.level = 7;
  h.exp = 9000;
  h.primary.attack = 9;
  h.skills.push({ id: 'logistics', level: 2 });
  h.spells.push('haste');
  h.army = [{ creatureId: 'angel', count: 5 }, { creatureId: 'pikeman', count: 50 }, null, null, null, null, null];
  const r = returnHeroToTavern(s, h.id);
  assert.equal(r.ok, true);
  assert.equal(s.heroes[h.id], undefined);
  assert.ok(!s.players[0].heroes.includes(h.id));
  assert.equal(s.players[0].tavernHeroes[1], 'orrin');
  assert.equal(getTavernHeroes(s, 0)[1].level, 7);
  assert.ok(!getFreeHeroDefs(s).some((d) => d.id === 'orrin'));
  const hired = hireHero(s, t.id, 1);
  assert.equal(hired.ok, true);
  const back = s.heroes[hired.heroId];
  assert.deepEqual([back.defId, back.level, back.exp, back.primary.attack], ['orrin', 7, 9000, 9]);
  assert.ok(back.skills.some((x) => x.id === 'logistics' && x.level === 2));
  assert.ok(back.spells.includes('haste'));
  assert.ok(!back.army.some((x) => x && x.creatureId === 'angel'), 'a retreat loses the army');
  assert.equal(back.army.filter(Boolean).length, 1);
  assert.deepEqual([back.owner, back.townId], [0, t.id]);
  assert.equal(s.heroPool.orrin, undefined);
  // surrender keeps the army
  leaveTown(s, back.id);
  back.army = [{ creatureId: 'angel', count: 3 }, null, null, null, null, null, null];
  returnHeroToTavern(s, back.id, { surrendered: true });
  const again = s.heroes[hireHero(s, t.id, 1).heroId];
  assert.deepEqual(again.army[0], { creatureId: 'angel', count: 3 });
  assert.equal(again.level, 7);
  assert.equal(returnHeroToTavern(s, 'nobody').error, 'no_such_hero');
  JSON.stringify(s);
});

// ---- mage guild ---------------------------------------------------------------------------------

test('mage guild: heroes learn what Wisdom allows on entering, needs a spellbook', () => {
  const s = setup();
  const t = town(s, { faction: 'tower', buildings: ['village_hall', 'mage_guild_5'] });
  assert.deepEqual(t.mageGuild.map((l) => l.length), [5, 4, 3, 2, 1]);
  const lvl = (h, l) => t.mageGuild[l - 1].filter((id) => h.spells.includes(id)).length;
  // might hero without a book learns nothing
  const knight = hero(s, 'edric', 0);
  assert.equal(hasArtifact(knight, 'spellbook'), false);
  visitTown(s, knight.id, t.id);
  assert.deepEqual(knight.spells, []);
  // buying the book (500 gold) teaches levels 1-2 at once
  const gold = s.players[0].resources.gold;
  const r = buySpellbook(s, t.id);
  assert.equal(r.ok, true);
  assert.equal(s.players[0].resources.gold, gold - 500);
  assert.equal(hasArtifact(knight, 'spellbook'), true);
  assert.deepEqual([1, 2, 3, 4, 5].map((l) => lvl(knight, l)), [5, 4, 0, 0, 0]);
  assert.equal(r.events.filter((e) => e.type === 'spell_learned').length, 9);
  assert.equal(buySpellbook(s, t.id).error, 'already_has_spellbook');
  leaveTown(s, knight.id);
  assert.equal(buySpellbook(s, t.id).error, 'no_hero');
  // Basic Wisdom: level 3; Advanced: 4; Expert: 5
  const basic = hero(s, 'solmyr', 0, t.id);
  assert.deepEqual([1, 2, 3, 4, 5].map((l) => lvl(basic, l)), [5, 4, 3, 0, 0]);
  leaveTown(s, basic.id);
  const adv = hero(s, 'astral', 0, t.id);
  assert.deepEqual([1, 2, 3, 4, 5].map((l) => lvl(adv, l)), [5, 4, 3, 2, 0]);
  adv.skills.find((x) => x.id === 'wisdom').level = 3;
  startNewDay(s);
  assert.deepEqual([1, 2, 3, 4, 5].map((l) => lvl(adv, l)), [5, 4, 3, 2, 1], 'learned at the start of the next day inside');
  assert.equal(new Set(adv.spells).size, adv.spells.length, 'no duplicates');
});

test('mage guild: a new level teaches the heroes inside; no guild, no spellbook sale', () => {
  const s = setup();
  const t = town(s, { faction: 'rampart' });
  const h = hero(s, 'adelaide', 0, t.id); // wisdom 2
  const known = h.spells.length;
  assert.equal(buySpellbook(s, t.id).error, 'no_mage_guild');
  buildAll(s, t.id, ['mage_guild_1']);
  assert.ok(t.mageGuild[0].every((id) => h.spells.includes(id)));
  assert.ok(h.spells.length >= known + 4);
  buildAll(s, t.id, ['mage_guild_2', 'mage_guild_3', 'mage_guild_4', 'mage_guild_5']);
  for (let l = 1; l <= 4; l++) assert.ok(t.mageGuild[l - 1].every((id) => h.spells.includes(id)), `level ${l}`);
  assert.ok(!h.spells.includes(t.mageGuild[4][0]), 'level 5 needs Expert Wisdom');
});

test('mage guild: faction bans and level caps hold over many rolls', () => {
  for (const faction of ['castle', 'necropolis', 'inferno', 'stronghold', 'tower']) {
    const max = { castle: 4, stronghold: 3 }[faction] || 5;
    for (let seed = 1; seed <= 25; seed++) {
      const s = setup({ seed });
      const t = createTown(s, { faction, owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings: ['village_hall', `mage_guild_${max}`] });
      const all = t.mageGuild.flat();
      assert.equal(all.length, [5, 4, 3, 2, 1].slice(0, max).reduce((a, b) => a + b, 0));
      assert.equal(new Set(all).size, all.length);
      for (const id of all) assert.ok(!MAGE_GUILD_BANS[faction].includes(id), `${id} banned in ${faction}`);
      t.mageGuild.forEach((spells, i) => spells.forEach((id) => assert.equal(getSpell(id).level, i + 1)));
      assert.deepEqual(t.mageGuild.slice(max).flat(), []);
    }
  }
  assert.ok(!guildSpellPool('necropolis', 1).some((x) => x.id === 'bless'));
});

test('mage guild rolls are deterministic for a seed and differ between seeds', () => {
  const roll = (seed) => {
    const s = setup({ seed });
    return createTown(s, { faction: 'dungeon', owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings: ['village_hall', 'mage_guild_3'] }).mageGuild;
  };
  assert.deepEqual(roll(11), roll(11));
  assert.notDeepEqual(roll(11), roll(12));
});

// ---- heroes in town -----------------------------------------------------------------------------

test('visitTown / leaveTown rules', () => {
  const s = setup();
  const t = town(s);
  const enemy = town(s, { owner: 1, pos: { x: 12, y: 12, z: 0 } });
  const a = hero(s, 'orrin', 0);
  const b = hero(s, 'edric', 0);
  assert.equal(visitTown(s, 'ghost', t.id).error, 'no_such_hero');
  assert.equal(visitTown(s, a.id, 'nowhere').error, 'no_such_town');
  assert.equal(visitTown(s, a.id, enemy.id).error, 'not_your_town');
  assert.equal(leaveTown(s, a.id).error, 'not_in_town');
  const r = visitTown(s, a.id, t.id);
  assert.equal(r.events[0].type, 'town_visited');
  assert.deepEqual([t.visitingHero, a.townId], [a.id, t.id]);
  assert.equal(visitTown(s, a.id, t.id).ok, true, 're-entering is harmless');
  assert.equal(visitTown(s, b.id, t.id).error, 'town_occupied');
  assert.deepEqual(getHeroesInTown(s, t).map((h) => h.id), [a.id]);
  assert.equal(leaveTown(s, a.id).ok, true);
  assert.deepEqual([t.visitingHero, a.townId], [null, null]);
  // moving straight from one town into another
  const t2 = town(s, { pos: { x: 9, y: 9, z: 0 } });
  visitTown(s, a.id, t.id);
  visitTown(s, a.id, t2.id);
  assert.deepEqual([t.visitingHero, t2.visitingHero, a.townId], [null, a.id, t2.id]);
});

test('swapTownHeroes: garrison commander takes over the garrison troops', () => {
  const s = setup();
  const t = town(s);
  assert.equal(swapTownHeroes(s, t.id).error, 'no_hero');
  const a = hero(s, 'orrin', 0, t.id);
  a.army = [{ creatureId: 'pikeman', count: 10 }, { creatureId: 'archer', count: 5 }, null, null, null, null, null];
  t.garrison = [{ creatureId: 'pikeman', count: 7 }, { creatureId: 'griffin', count: 2 }, null, null, null, null, null];
  assert.equal(swapTownHeroes(s, t.id).ok, true);
  assert.deepEqual([t.visitingHero, t.garrisonHero, a.garrisoned, a.townId], [null, a.id, true, t.id]);
  assert.deepEqual(a.army.filter(Boolean), [
    { creatureId: 'pikeman', count: 17 }, { creatureId: 'archer', count: 5 }, { creatureId: 'griffin', count: 2 },
  ]);
  assert.equal(getGarrisonArmy(s, t), a.army);
  assert.equal(leaveTown(s, a.id).error, 'hero_is_garrisoned');
  // a second hero arrives: plain swap of roles, armies untouched
  const b = hero(s, 'edric', 0, t.id);
  const armyB = JSON.stringify(b.army);
  assert.equal(swapTownHeroes(s, t.id).ok, true);
  assert.deepEqual([t.visitingHero, t.garrisonHero, a.garrisoned, b.garrisoned], [a.id, b.id, false, true]);
  assert.equal(JSON.stringify(b.army), armyB);
  // garrison hero steps out alone
  leaveTown(s, a.id);
  assert.equal(swapTownHeroes(s, t.id).ok, true);
  assert.deepEqual([t.visitingHero, t.garrisonHero, b.garrisoned], [b.id, null, false]);
  assert.ok(t.garrison.every((x) => x === null));
  // refused when the garrison troops do not fit
  b.army = ['archer', 'griffin', 'swordsman', 'monk', 'cavalier', 'angel', 'zealot'].map((creatureId) => ({ creatureId, count: 1 }));
  t.garrison[0] = { creatureId: 'pikeman', count: 3 };
  assert.equal(swapTownHeroes(s, t.id).error, 'army_wont_fit');
  assert.deepEqual([t.visitingHero, t.garrisonHero], [b.id, null]);
  assert.deepEqual(t.garrison[0], { creatureId: 'pikeman', count: 3 });
});

test('townArmyMove: move, merge, swap, split between garrison and visiting hero', () => {
  const s = setup();
  const t = town(s);
  const G = (slot) => ({ where: 'garrison', slot });
  const V = (slot) => ({ where: 'visiting', slot });
  t.garrison = [{ creatureId: 'pikeman', count: 20 }, { creatureId: 'archer', count: 6 }, null, null, null, null, null];
  assert.equal(townArmyMove(s, t.id, G(0), V(0)).error, 'no_hero');
  const h = hero(s, 'orrin', 0, t.id);
  h.army = [{ creatureId: 'pikeman', count: 10 }, { creatureId: 'griffin', count: 3 }, null, null, null, null, null];
  // merge
  let r = townArmyMove(s, t.id, G(0), V(0));
  assert.deepEqual([r.ok, r.events[0].action, r.events[0].moved], [true, 'merge', 20]);
  assert.deepEqual([h.army[0].count, t.garrison[0]], [30, null]);
  // swap different creatures
  r = townArmyMove(s, t.id, V(1), G(1));
  assert.equal(r.events[0].action, 'swap');
  assert.deepEqual([h.army[1], t.garrison[1]], [{ creatureId: 'archer', count: 6 }, { creatureId: 'griffin', count: 3 }]);
  // split into an empty slot
  r = townArmyMove(s, t.id, V(0), G(4), 12);
  assert.equal(r.events[0].action, 'split');
  assert.deepEqual([h.army[0].count, t.garrison[4]], [18, { creatureId: 'pikeman', count: 12 }]);
  // rearranging inside one army
  r = townArmyMove(s, t.id, G(4), G(6));
  assert.deepEqual([t.garrison[4], t.garrison[6].count], [null, 12]);
  // errors
  assert.equal(townArmyMove(s, t.id, G(3), V(3)).error, 'empty_slot');
  assert.equal(townArmyMove(s, t.id, V(0), G(6), 99).error, 'bad_count');
  assert.equal(townArmyMove(s, t.id, V(0), G(1), 5).error, 'slot_occupied');
  // the hero can never be left without troops
  townArmyMove(s, t.id, V(1), G(0));
  assert.equal(townArmyMove(s, t.id, V(0), G(6)).error, 'last_stack');
  assert.equal(townArmyMove(s, t.id, V(0), G(6), 17).ok, true, 'all but one is fine');
  assert.equal(h.army[0].count, 1);
  // the garrison may be emptied completely
  for (const slot of [0, 1, 6]) assert.equal(townArmyMove(s, t.id, G(slot), V(slot === 6 ? 6 : slot + 2)).ok, true);
  assert.ok(t.garrison.every((x) => x === null));
});

// ---- capture --------------------------------------------------------------------------------------

test('captureTown: ownership, garrison, fog, visiting hero, loss timer, map object', () => {
  const s = setup({ width: 40, height: 40 });
  const t = town(s, { owner: 1, pos: { x: 30, y: 30, z: 0 }, buildings: ['fort', 'tavern', 'mage_guild_1', 'castle_dwelling_1'] });
  const keep = town(s, { owner: 1, pos: { x: 5, y: 30, z: 0 } });
  const obj = deps.addObject(s, 'town', t.pos, { owner: 1, data: { townId: t.id } });
  t.garrison[0] = { creatureId: 'pikeman', count: 30 };
  t.builtThisTurn = true;
  const stock = { ...t.stock };
  const guild = JSON.stringify(t.mageGuild);
  const conqueror = hero(s, 'adelaide', 0);
  conqueror.pos = { ...t.pos };
  s.players[0].daysWithoutTown = 4;
  assert.equal(deps.isExplored(s, 0, { x: 30, y: 33, z: 0 }), false);
  const r = captureTown(s, t.id, 0, { heroId: conqueror.id });
  assert.equal(r.ok, true);
  assert.deepEqual(r.events[0], { type: 'town_captured', townId: t.id, from: 1, to: 0, playerId: 0 });
  assert.equal(t.owner, 0);
  assert.deepEqual([s.players[0].towns, s.players[1].towns], [[t.id], [keep.id]]);
  assert.ok(t.garrison.every((x) => x === null), 'old garrison is gone');
  assert.deepEqual(t.stock, stock, 'creatures for hire stay');
  assert.equal(JSON.stringify(t.mageGuild), guild);
  assert.equal(t.builtThisTurn, true, 'builtThisTurn is kept');
  assert.equal(s.players[0].daysWithoutTown, 0);
  assert.equal(obj.owner, 0);
  assert.equal(deps.isExplored(s, 0, { x: 30, y: 33, z: 0 }), true);
  assert.deepEqual([t.visitingHero, conqueror.townId], [conqueror.id, t.id]);
  assert.ok(t.mageGuild[0].every((id) => conqueror.spells.includes(id)), 'guild spells learned on entering');
  assert.ok(s.players[0].tavernHeroes.filter(Boolean).length === 2, 'tavern pool available');
  assert.equal(captureTown(s, t.id, 0).error, 'already_owned');
  assert.equal(s.players[1].alive, true);
});

test('captureTown: enemy heroes are detached; neutral towns; losing the last town', () => {
  const s = setup();
  const t = town(s, { owner: 1 });
  const defender = hero(s, 'edric', 1, t.id);
  s.currentPlayer = 1;
  swapTownHeroes(s, t.id);
  s.currentPlayer = 0;
  assert.equal(t.garrisonHero, defender.id);
  captureTown(s, t.id, 0);
  assert.deepEqual([t.garrisonHero, t.visitingHero, defender.townId, defender.garrisoned], [null, null, null, false]);
  assert.equal(s.players[1].alive, true, 'still has a hero');
  assert.deepEqual(s.players[1].towns, []);
  // neutral -> player keeps nothing weird; player -> neutral
  const n = town(s, { owner: null, pos: { x: 12, y: 12, z: 0 } });
  n.garrison[0] = { creatureId: 'pikeman', count: 9 };
  captureTown(s, n.id, 1, { keepGarrison: true });
  assert.equal(n.owner, 1);
  assert.equal(n.garrison[0].count, 9);
  captureTown(s, n.id, null);
  assert.equal(n.owner, null);
  assert.deepEqual(s.players[1].towns, []);
});

test('dismissTownStack: garrison and visiting rows, last-stack rule, owner check', () => {
  const s = setup();
  const t = town(s);
  t.garrison[0] = { creatureId: 'pikeman', count: 5 };
  t.garrison[2] = { creatureId: 'archer', count: 3 };
  const h = hero(s, 'orrin', 0, t.id);
  h.army = [{ creatureId: 'griffin', count: 2 }, null, null, null, null, null, null];
  let r = dismissTownStack(s, t.id, { where: 'garrison', slot: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.events[0], { type: 'stack_dismissed', townId: t.id, where: 'garrison', slot: 2, creatureId: 'archer', count: 3 });
  assert.equal(t.garrison[2], null);
  assert.equal(dismissTownStack(s, t.id, { where: 'garrison', slot: 0 }).ok, true, 'a plain garrison may become empty');
  assert.equal(dismissTownStack(s, t.id, { where: 'visiting', slot: 0 }).error, 'last_stack');
  assert.equal(dismissTownStack(s, t.id, { where: 'visiting', slot: 4 }).error, 'empty_slot');
  s.currentPlayer = 1;
  assert.equal(dismissTownStack(s, t.id, { where: 'visiting', slot: 0 }).error, 'not_your_turn');
});

test('town actions are refused when the town belongs to another player than the one to move', () => {
  const s = setup();
  const t = town(s, { owner: 1 });
  assert.equal(build(s, t.id, 'marketplace').error, 'not_your_turn');
  assert.equal(recruit(s, t.id, 'pikeman', 1, 'garrison').error, 'not_your_turn');
  s.currentPlayer = 1;
  assert.equal(build(s, t.id, 'marketplace').ok, true);
});

test('getTavernHeroes fills an empty pool', () => {
  const s = setup();
  s.players[0].tavernHeroes = [];
  const offer = getTavernHeroes(s, 0);
  assert.equal(offer.length, 2);
  assert.ok(offer.every((o) => o && o.defId));
  s.players[0].tavernHeroes[1] = null;
  assert.ok(getTavernHeroes(s, 0)[1]);
});
