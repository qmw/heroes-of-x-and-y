// An AI turn interrupted by a battle against a human defender is resumed after the battle
// (game.js endTurn `player.aiResume`, ai/context.js `dayMemory`; docs/mechanics/game-loop.md §3).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { endTurn, serialize, deserialize, MAX_AI_RESUMES, setAiDriver } from '../../src/engine/game.js';
import { finishCombat } from '../../src/engine/hero.js';
import * as combat from '../../src/engine/combat/index.js';
import { getLastAiReport, installAi } from '../../src/engine/ai/index.js';
import { ready, makeGame, P, adv } from './fixture.js';

before(ready);

/** Human (slot 0) hero next to the AI's (slot 1) strong main hero; a second AI hero with work to do. */
function setup() {
  const s = makeGame({
    size: 30, seed: 5, difficulty: 1,
    towns: [{ pos: P(25, 25), faction: 'rampart', ownerSlot: 0 }, { pos: P(4, 4), faction: 'castle', ownerSlot: 1 }],
    players: [{ slot: 0, isHuman: true, faction: 'rampart' }, { slot: 1, isHuman: false, faction: 'castle' }],
  });
  const me = s.heroes[s.players[0].heroes[0]];
  const ai = s.heroes[s.players[1].heroes[0]];
  if (ai.townId) { s.towns[ai.townId].visitingHero = null; ai.townId = null; }
  if (me.townId) { s.towns[me.townId].visitingHero = null; me.townId = null; }
  adv.placeHero(s, me, P(12, 12), []);
  adv.placeHero(s, ai, P(13, 12), []);
  me.army = [{ creatureId: 'centaur', count: 3 }, null, null, null, null, null, null];
  // the human town is out of reach of any siege: the human hero is the target
  s.towns[s.players[0].towns[0]].garrison = [{ creatureId: 'angel', count: 200 }, null, null, null, null, null, null];
  ai.army = [{ creatureId: 'angel', count: 10 }, null, null, null, null, null, null];
  s.players[1].ai = { mainHeroId: ai.id, targets: {} };
  s.players[1].aiDifficulty = 3; // Expert: attacks players from day 1
  const second = adv.deps.addHero(s, 'edric', 1, P(4, 12));
  second.army = [{ creatureId: 'pikeman', count: 10 }, null, null, null, null, null, null];
  const piles = [adv.addObject(s, 'resource_gold', P(6, 13)), adv.addObject(s, 'resource_wood', P(7, 11))];
  return { s, me, ai, second, piles };
}

/** End the human's turn; the AI attacks; returns once the battle waits for the human. */
function untilBattle(s) {
  const r = endTurn(s);
  assert.ok(r.ok, r.error);
  assert.ok(r.events.some((e) => e.type === 'combat_waiting'), 'the battle waits for the human: ' + getLastAiReport(1)?.trace.join(' / '));
  assert.ok(s.combat);
  assert.equal(s.currentPlayer, 1, 'still the computer turn');
  return r;
}

function fightIt(s) {
  combat.autoResolve(s.combat.cs);
  const r = finishCombat(s);
  assert.ok(r.ok, r.error);
}

test('the AI resumes its day after the human fought the battle', () => {
  installAi();
  const { s, second, piles } = setup();
  s.players[1].resources.gold = 50000; // rich enough to hire on every run: only one hire a day
  const heroes0 = s.players[1].heroes.length;
  untilBattle(s);
  assert.equal(s.players[1].aiResume.turn, s.turn);
  assert.equal(s.players[1].aiResume.pending, true);
  assert.equal(second.movePoints, second.maxMovePoints, 'the second hero has not moved yet');
  assert.deepEqual(deserialize(serialize(s)), s, 'the waiting state is plain JSON');
  fightIt(s);
  const turn = s.turn;
  const r = endTurn(s);
  assert.ok(r.ok, r.error);
  const rep = getLastAiReport(1);
  assert.equal(rep.turn, turn);
  assert.equal(rep.run, 2, 'second run of the same day');
  assert.ok(second.movePoints < second.maxMovePoints || piles.some((p) => !s.map.objects[p.id]), 'the second hero acted after the battle');
  assert.equal(s.currentPlayer, 0, 'back to the human');
  assert.equal(s.turn, turn + 1);
  assert.equal(s.players[1].aiResume.pending, false);
  assert.ok(s.players[1].heroes.length <= heroes0 + 1, 'at most one hire on that day');
  assert.equal(s.players[1].ai.day.runs, 2);
});

test('resumption is deterministic and survives a save / load while the battle waits', () => {
  installAi();
  const a = setup().s;
  const b = setup().s;
  untilBattle(a);
  untilBattle(b);
  const b2 = deserialize(serialize(b));
  fightIt(a);
  fightIt(b2);
  assert.ok(endTurn(a).ok);
  assert.ok(endTurn(b2).ok);
  assert.equal(serialize(a), serialize(b2));
});

test('an AI turn is resumed at most MAX_AI_RESUMES times a day', () => {
  const { s, me, ai } = setup();
  let runs = 0;
  // a driver that attacks the human hero on every run (the attacker is revived each time)
  setAiDriver((st) => {
    runs++;
    const h = st.heroes[ai.id];
    if (h && st.heroes[me.id]) adv.moveHero(st, h.id, st.heroes[me.id].pos);
    return { ok: true, events: [] };
  });
  try {
    me.army = [{ creatureId: 'arch_angel', count: 30 }, null, null, null, null, null, null];
    untilBattle(s);
    let waits = 1;
    for (let i = 0; i < 10 && s.combat; i++) {
      fightIt(s); // the human wins: the AI hero is gone
      if (!s.heroes[ai.id]) {
        adv.deps.addHero(s, 'orrin', 1, P(13, 12));
        const nh = s.players[1].heroes[s.players[1].heroes.length - 1];
        s.heroes[nh].army = [{ creatureId: 'peasant', count: 1 }, null, null, null, null, null, null];
        ai.id = nh;
      }
      const r = endTurn(s);
      assert.ok(r.ok, r.error);
      if (s.combat) waits++;
    }
    assert.ok(!s.combat);
    assert.equal(waits, MAX_AI_RESUMES + 1, 'one battle per run, then the turn moves on');
    assert.equal(runs, MAX_AI_RESUMES + 1);
    assert.equal(s.currentPlayer, 0);
  } finally {
    installAi();
  }
});
