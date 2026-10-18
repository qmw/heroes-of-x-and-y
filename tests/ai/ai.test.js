// Strategic AI (src/engine/ai): behaviour on small handmade maps with the real engines.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { serialize } from '../../src/engine/game.js';
import { getPending } from '../../src/engine/pending.js';
import { giveExperience } from '../../src/engine/hero.js';
import { armyStrength } from '../../src/engine/army.js';
import { aiDriver, getLastAiReport } from '../../src/engine/ai/index.js';
import { ready, makeGame, scatter, playDays, playerArmy, solo, soloDays, P, adv } from './fixture.js';

before(ready);

test('collects nearby resources and flags a mine', () => {
  const { s, hero } = solo();
  const piles = [
    adv.addObject(s, 'resource_wood', P(6, 8)),
    adv.addObject(s, 'resource_gold', P(9, 9)),
    adv.addObject(s, 'resource_ore', P(11, 6)),
  ];
  const mine = adv.addObject(s, 'gold_mine', P(13, 10));
  const gold0 = s.players[0].resources.gold;
  soloDays(s, 3);
  for (const p of piles) assert.equal(s.map.objects[p.id], undefined, `${p.defId} picked up`);
  assert.equal(s.map.objects[mine.id].owner, 0, 'gold mine flagged');
  assert.ok(s.heroes[hero.id], 'hero alive');
  assert.ok(s.players[0].resources.gold + 20000 > gold0); // sanity (spent on buildings is fine)
});

test('builds every day and recruits over a week', () => {
  const { s } = solo({ seed: 2 });
  Object.assign(s.players[0].resources, { gold: 40000, wood: 40, ore: 40, mercury: 15, sulfur: 15, crystal: 15, gems: 15 });
  const town = s.towns[s.players[0].towns[0]];
  const b0 = town.buildings.length;
  const army0 = playerArmy(s, 0);
  soloDays(s, 8);
  assert.ok(town.buildings.length >= b0 + 5, `built ${town.buildings.length - b0}`);
  assert.ok(town.buildings.some((b) => b.startsWith('castle_dwelling_')), 'has dwellings');
  assert.ok(playerArmy(s, 0) > army0 * 2, `army grew ${army0} -> ${playerArmy(s, 0)}`);
});

test('fights a weak monster but leaves an overwhelming one alone', () => {
  const { s, hero } = solo({ seed: 3 });
  hero.army = [{ creatureId: 'pikeman', count: 30 }, { creatureId: 'archer', count: 15 }, null, null, null, null, null];
  const strong = adv.addObject(s, 'monster', P(12, 4), { data: { creatureId: 'black_dragon', count: 30, disposition: 'savage', character: 12, neverFlees: true } });
  const weak = adv.addObject(s, 'monster', P(5, 11), { data: { creatureId: 'peasant', count: 8, disposition: 'savage', character: 12, neverFlees: true } });
  soloDays(s, 3);
  assert.ok(s.heroes[hero.id], 'hero survived');
  assert.ok(s.map.objects[strong.id], 'dragons were not attacked');
  assert.equal(s.map.objects[strong.id].data.count, 30);
  assert.equal(s.map.objects[weak.id], undefined, 'peasants were beaten');
});

test('declines a bank whose guards are far too strong, takes a weak one', () => {
  const { s, hero } = solo({ seed: 4 });
  hero.army = [{ creatureId: 'pikeman', count: 20 }, null, null, null, null, null, null];
  const bank = adv.addObject(s, 'cyclops_stockpile', P(8, 8), {
    data: { guards: [{ creatureId: 'cyclops_king', count: 40 }], reward: { resources: { gold: 5000 } } },
  });
  // walk into it on purpose: the confirm must be declined
  hero.movePoints = 3000;
  const r = adv.moveHero(s, hero.id, bank.pos);
  assert.ok(r.ok, r.error);
  assert.equal(getPending(s, 0)[0]?.kind, 'confirm_fight');
  aiDriver(s, 0);
  assert.equal(getPending(s, 0).length, 0);
  assert.ok(s.heroes[hero.id], 'hero alive (declined)');
  assert.equal(s.map.objects[bank.id].data.cleared, false);
});

test('resolves level-ups with sensible skills', () => {
  const { s, hero } = solo({ seed: 5 });
  giveExperience(s, hero.id, 20000);
  assert.ok(getPending(s, 0).some((p) => p.kind === 'level_up'));
  aiDriver(s, 0);
  assert.equal(getPending(s, 0).length, 0, 'all level-ups resolved');
  assert.ok(hero.level >= 8);
  assert.ok(hero.skills.length >= 3, JSON.stringify(hero.skills));
  const ids = hero.skills.map((x) => x.id);
  const poor = ['first_aid', 'eagle_eye', 'scholar', 'navigation', 'ballistics'];
  assert.ok(ids.filter((id) => poor.includes(id)).length <= 1, `poor picks: ${ids}`);
});

test('the main hero picks up the garrison and recruits when in town', () => {
  const { s, hero } = solo({ seed: 6 });
  const town = s.towns[s.players[0].towns[0]];
  town.garrison[0] = { creatureId: 'griffin', count: 7 };
  town.stock.pikeman = 20;
  assert.equal(town.visitingHero, hero.id);
  const before = armyStrength(hero.army);
  aiDriver(s, 0);
  assert.ok(armyStrength(hero.army) > before + 7 * 300, 'took the griffins and bought troops');
});

test('hires a hero when it has none', () => {
  const { s, hero } = solo({ seed: 7 });
  adv.deps.removeHero(s, hero.id, 'defeated');
  assert.equal(s.players[0].heroes.length, 0);
  s.players[0].resources.gold = 6000;
  aiDriver(s, 0);
  assert.equal(s.players[0].heroes.length, 1);
});

test('never throws: broken targets, unknown pending kinds, no movement', () => {
  const { s, hero } = solo({ seed: 8 });
  hero.movePoints = 0;
  s.pending.push({ id: 999, kind: 'hero_exchange', playerId: 0, heroId: hero.id, options: [{ id: 'done' }], data: {} });
  assert.doesNotThrow(() => aiDriver(s, 0));
  assert.equal(getPending(s, 0).length, 0);
  // a player with nothing at all
  s.players[0].heroes = [];
  s.players[0].towns = [];
  assert.doesNotThrow(() => aiDriver(s, 0));
});

/** Two AI players on a 36x36 map with scattered objects and a neutral town in the middle. */
function duel(seed, size = 36) {
  const s = makeGame({
    size, seed, difficulty: 2,
    towns: [
      { pos: P(5, 5), faction: 'castle', ownerSlot: 0 },
      { pos: P(size - 6, size - 6), faction: 'rampart', ownerSlot: 1 },
      { pos: P(size >> 1, size >> 1), faction: 'tower', ownerSlot: null },
    ],
    players: [{ slot: 0, isHuman: false, faction: 'castle' }, { slot: 1, isHuman: false, faction: 'rampart' }],
  });
  scatter(s, { seed, piles: size, mines: size / 5 | 0, monsters: size / 3 | 0, misc: size / 4 | 0, avoid: [P(5, 5), P(size - 6, size - 6), P(size >> 1, size >> 1)] });
  return s;
}

test('two AI players, 60 days: no exceptions, serializable, armies grow, somebody gets ahead', () => {
  const s = duel(11);
  const start = [playerArmy(s, 0), playerArmy(s, 1)];
  const peak = [0, 0];
  const errors = [];
  playDays(s, 60, (st) => {
    for (const p of st.players) {
      peak[p.id] = Math.max(peak[p.id], playerArmy(st, p.id));
      const rep = getLastAiReport(p.id);
      if (rep) errors.push(...rep.errors.filter((e) => e.includes('_threw')));
    }
    assert.deepEqual(JSON.parse(serialize(st)), JSON.parse(JSON.stringify(st)));
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(JSON.parse(serialize(s)), s, 'state stays plain JSON');
  // the AI attacks when it is ahead: a player may be eliminated early, the survivor(s) must have grown
  for (const id of [0, 1]) if (s.players[id].alive) assert.ok(peak[id] > start[id] * 3, `player ${id} army ${start[id]} -> peak ${peak[id]}`);
  if (!s.gameOver) {
    const score = (id) => playerArmy(s, id) + 5000 * s.players[id].towns.length;
    const [a, b] = [score(0), score(1)];
    assert.ok(Math.max(a, b) >= 1.3 * Math.min(a, b) || s.players.some((p) => p.towns.length >= 2), `scores ${a} / ${b}`);
  }
});

test('deterministic for a seed', () => {
  const a = duel(5, 28);
  const b = duel(5, 28);
  playDays(a, 15);
  playDays(b, 15);
  assert.equal(serialize(a), serialize(b));
});

test('timing: AI turns on a 72x72 map stay within budget', () => {
  const s = duel(3, 72);
  const times = [];
  playDays(s, 15, (st) => {
    for (const p of st.players) {
      const rep = getLastAiReport(p.id);
      if (rep && rep.turn === st.turn - 1) times.push(rep.ms);
    }
  });
  const max = Math.max(...times);
  const avg = times.reduce((x, y) => x + y, 0) / times.length;
  // the target is < 300 ms; generous bounds keep the test stable on a loaded machine
  // Strict wall-clock budgets only with PERF=1; a loaded parallel test run gets 5x slack.
  const slack = process.env.PERF ? 1 : 5;
  assert.ok(avg < 300 * slack, `average ${avg.toFixed(0)} ms`);
  assert.ok(max < 1500 * slack, `max ${max} ms`);
});

test('a threatened town recruits everything into its garrison', () => {
  const { s, hero } = solo({ seed: 9 });
  const town = s.towns[s.players[0].towns[0]];
  // our hero is far away, an enemy hero stronger than the empty garrison stands 4 tiles away
  adv.placeHero(s, hero, P(20, 4), []);
  const enemy = adv.deps.addHero(s, 'mephala', 1, P(8, 6));
  enemy.army = [{ creatureId: 'dwarf', count: 40 }, null, null, null, null, null, null];
  town.stock.pikeman = 30;
  s.players[0].resources.gold = 3000;
  aiDriver(s, 0);
  assert.ok(armyStrength(town.garrison) >= 30 * 80, `garrison ${JSON.stringify(town.garrison)}`);
});

test('a secondary hero hands his troops to the main hero', () => {
  const { s, hero } = solo({ seed: 10 });
  const town = s.towns[s.players[0].towns[0]];
  adv.placeHero(s, hero, P(12, 12), []);
  hero.army = [{ creatureId: 'pikeman', count: 20 }, null, null, null, null, null, null];
  s.players[0].ai.mainHeroId = hero.id;
  const sec = adv.deps.addHero(s, 'edric', 0, P(14, 12));
  sec.army = [{ creatureId: 'griffin', count: 15 }, { creatureId: 'archer', count: 12 }, null, null, null, null, null];
  town.stock = {};
  const before = armyStrength(hero.army);
  aiDriver(s, 0);
  assert.ok(armyStrength(hero.army) > before + 15 * 300, `main ${armyStrength(hero.army)} (was ${before})`);
  assert.ok(armyStrength(sec.army) < 15 * 300, 'secondary kept only a small rest');
});

test('every difficulty level plays without errors', () => {
  for (const difficulty of [0, 1, 3, 4]) {
    const s = makeGame({
      size: 28, seed: 20 + difficulty, difficulty,
      towns: [{ pos: P(5, 5), faction: 'inferno', ownerSlot: 0 }, { pos: P(22, 22), faction: 'necropolis', ownerSlot: 1 }],
      players: [{ slot: 0, isHuman: false, faction: 'inferno' }, { slot: 1, isHuman: false, faction: 'necropolis' }],
    });
    scatter(s, { seed: difficulty, piles: 20, mines: 5, monsters: 8, misc: 6, avoid: [P(5, 5), P(22, 22)] });
    playDays(s, 12, (st) => {
      for (const p of st.players) {
        const rep = getLastAiReport(p.id);
        assert.deepEqual(rep ? rep.errors.filter((e) => e.includes('_threw')) : [], [], `difficulty ${difficulty}`);
      }
    });
    const built = s.players.filter((p) => p.towns.length).map((p) => Math.max(...p.towns.map((t) => s.towns[t].buildings.length)));
    assert.ok(built.length && built.every((n) => n >= 5), `difficulty ${difficulty} builds: ${built}`);
  }
});
