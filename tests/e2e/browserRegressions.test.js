// Regressions found by the browser end-to-end run (tools/e2e). Each test pins one bug that showed up
// only when the real game was played in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/ui/screens/newGameModel.js';
import { generateMap } from '../../src/engine/mapgen/index.js';
import { createGame } from '../../src/engine/game.js';
import * as adv from '../../src/engine/adventure/index.js';
import { engineReady } from '../../src/engine/hero.js';

function smallGame(seed, players) {
  const setup = M.createSetup({ seed });
  M.setMapSize(setup, 'S');
  if (players) players.forEach((t, i) => M.setSlotType(setup, i, t));
  let bp = generateMap(M.buildMapOptions(setup));
  bp = bp.blueprint || bp;
  return createGame(bp, M.buildGameSettings(setup));
}

test('attacking an enemy town whose hero stands in it starts a siege (not a field battle)', async () => {
  await engineReady;
  const state = smallGame(99);
  const me = state.players[state.currentPlayer];
  const hero = state.heroes[me.heroes[0]];
  const enemy = Object.values(state.towns).find((t) => t.owner != null && t.owner !== me.id);
  assert.ok(enemy.visitingHero, 'the enemy starting hero is in its town');
  if (hero.townId) { state.towns[hero.townId].visitingHero = null; hero.townId = null; }
  hero.army = [{ creatureId: 'angel', count: 20 }, null, null, null, null, null, null];
  const e = enemy.pos;
  let placed = false;
  for (let r = 1; r <= 3 && !placed; r++) {
    for (let dy = -r; dy <= r && !placed; dy++) for (let dx = -r; dx <= r && !placed; dx++) {
      const c = { x: e.x + dx, y: e.y + dy, z: e.z };
      const tl = state.map.tiles[c.z]?.[c.y]?.[c.x];
      if (!tl || tl.blocked || tl.obj || adv.getHeroAt(state, c)) continue;
      hero.pos = c; hero.movePoints = hero.maxMovePoints;
      const p = adv.findPath(state, hero.id, e);
      if (p && p.path && p.path.length && p.turns === 0) placed = true;
    }
  }
  assert.ok(placed, 'found an approach tile');
  const res = adv.moveHero(state, hero.id, e);
  assert.ok(res.ok, `${res.error} ${res.reason || ''}`);
  assert.ok(state.combat, 'a battle started');
  assert.ok(state.combat.cs.siege, 'the battle is a siege');
  assert.equal(state.combat.townId ?? state.combat.context?.townId, enemy.id);
});

test('new game setup: the default (medium) map offers its own player limit', () => {
  const s = M.createSetup({ seed: 1 });
  assert.equal(s.size, 'M');
  assert.equal(s.maxPlayers, M.MAP_SIZES.find((x) => x.id === 'M').maxPlayers);
});

test('a computer hero attacking a human hero leaves the battle for the human; endTurn waits, then carries on', async () => {
  await engineReady;
  const game = await import('../../src/engine/game.js');
  const { finishCombat } = await import('../../src/engine/hero.js');
  const C = await import('../../src/engine/combat/index.js');
  const state = smallGame(99, ['human', 'ai']);
  const me = state.heroes[state.players[0].heroes[0]];
  const ai = state.heroes[state.players[1].heroes[0]];
  if (ai.townId) { state.towns[ai.townId].visitingHero = null; ai.townId = null; }
  if (me.townId) { state.towns[me.townId].visitingHero = null; me.townId = null; }
  // our hero out in the open, the computer hero right next to him
  let spot = null;
  for (let y = 2; y < state.map.height - 2 && !spot; y++) for (let x = 2; x < state.map.width - 2 && !spot; x++) {
    const a = { x, y, z: 0 }; const b = { x: x + 1, y, z: 0 };
    const ok = [a, b].every((p) => { const t = state.map.tiles[0][p.y][p.x]; return t && !t.blocked && !t.obj && !adv.getHeroAt(state, p); });
    if (ok) spot = [a, b];
  }
  me.pos = spot[0]; ai.pos = spot[1];
  ai.army = [{ creatureId: 'angel', count: 5 }, null, null, null, null, null, null];
  game.setAiDriver((s) => { adv.moveHero(s, ai.id, me.pos); return { ok: true, events: [] }; });
  try {
    const r = game.endTurn(state);
    assert.ok(r.ok, r.error);
    assert.ok(state.combat, 'the battle waits for the human defender');
    assert.equal(state.currentPlayer, 1, 'still the computer turn');
    assert.ok(r.events.some((e) => e.type === 'combat_waiting'));
    assert.equal(state.combat.cs.sides.defender.isHuman, true);
    C.autoResolve(state.combat.cs);
    assert.ok(finishCombat(state).ok);
    const r2 = game.endTurn(state);
    assert.ok(r2.ok, r2.error);
    assert.equal(state.currentPlayer, 0, 'back to the human');
    assert.equal(state.turn, 2);
  } finally {
    game.setAiDriver(null);
  }
});
