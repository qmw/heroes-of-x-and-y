// Map-editor blueprint extras applied by the game: slot -> player owner remapping (unplayed slots
// neutral), kill_hero quests by starting hero, custom starting heroes, timed events, allowed factions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/engine/editor/index.js';
import { createGame, endTurn, setAiDriver, serialize, deserialize } from '../../src/engine/game.js';
import { resetGameDeps } from '../../src/engine/gameDeps.js';
import { timedEventDue } from '../../src/engine/blueprintExtras.js';
import { questFulfilled } from '../../src/engine/adventure/index.js';

const P = (x, y, z = 0) => ({ x, y, z });
const must = (r) => { assert.ok(r.ok, JSON.stringify(r)); return r; };

function threeSlotMap() {
  const doc = E.newMap({ size: 'M', players: 3, name: 'Extras' });
  must(E.placeObject(doc, 'town', P(8, 8), { faction: 'castle', ownerSlot: 0 }));
  must(E.placeObject(doc, 'town', P(36, 8), { faction: 'rampart', ownerSlot: 1 }));
  must(E.placeObject(doc, 'random_town', P(60, 60), { ownerSlot: 2 }));
  must(E.placeObject(doc, 'hero', P(8, 8), { ownerSlot: 0, defId: 'orrin', army: [{ creatureId: 'angel', count: 3 }, { creatureId: 'pikeman', count: 40 }], primary: { attack: 9, knowledge: 4 }, skills: [{ id: 'logistics', level: 3 }], spells: ['haste', 'slow'], artifacts: ['centaurs_axe'] }));
  must(E.placeObject(doc, 'hero', P(36, 8), { ownerSlot: 1 }));
  must(E.placeObject(doc, 'hero', P(60, 60), { ownerSlot: 2, defId: 'sandro' }));
  const m1 = must(E.placeObject(doc, 'gold_mine', P(20, 30), { owner: 1 }));
  const m2 = must(E.placeObject(doc, 'sawmill', P(30, 30), { owner: 2 }));
  const ev = must(E.placeObject(doc, 'event', P(40, 40), { data: { players: [2], resources: { gold: 1 } } }));
  const q1 = must(E.placeObject(doc, 'seers_hut', P(20, 50), { data: { quest: { type: 'kill_hero', heroIndex: 2 }, reward: { exp: 100 } } }));
  const q2 = must(E.placeObject(doc, 'quest_guard', P(30, 50), { data: { quest: { type: 'kill_hero', heroDefId: 'orrin' } } }));
  must(E.setPlayer(doc, 2, { factions: ['necropolis'] }));
  return { doc, m1: m1.ref.id, m2: m2.ref.id, ev: ev.ref.id, q1: q1.ref.id, q2: q2.ref.id };
}

test('owners are slots: remapped to player ids, unplayed slots become neutral', () => {
  resetGameDeps();
  setAiDriver(null);
  const { doc, m1, m2, ev } = threeSlotMap();
  // slots 0 and 2 play, slot 1 stays empty
  const state = createGame(E.prepareForPlay(doc.bp), { seed: 2, players: [{ slot: 0, isHuman: true }, { slot: 2, isHuman: false }] });
  assert.equal(state.players.length, 2);
  assert.equal(state.players[1].slot, 2);
  assert.equal(state.map.objects[m2].owner, 1, 'slot 2 -> player 1');
  assert.equal(state.map.objects[m1].owner, null, 'unplayed slot 1 -> neutral');
  assert.deepEqual(state.map.objects[ev].data.players, [1]);
  const rampart = Object.values(state.towns).find((t) => t.faction === 'rampart');
  assert.equal(rampart.owner, null);
  // allowed factions: the random town of slot 2 became Necropolis
  assert.equal(state.players[1].faction, 'necropolis');
  assert.ok(Object.values(state.towns).some((t) => t.owner === 1 && t.faction === 'necropolis'));
});

test('kill_hero quests by starting-hero index or hero def are resolved to game hero ids', () => {
  resetGameDeps();
  const { doc, q1, q2 } = threeSlotMap();
  assert.ok(E.validateMap(doc.bp).warnings.every((w) => !/quest|hero to defeat/i.test(w.text)), 'quests are valid in the editor');
  const state = createGame(E.prepareForPlay(doc.bp), { seed: 2, players: [0, 1, 2].map((slot) => ({ slot, isHuman: slot === 0 })) });
  const sandro = Object.values(state.heroes).find((h) => h.defId === 'sandro');
  const orrin = Object.values(state.heroes).find((h) => h.defId === 'orrin');
  assert.equal(state.map.objects[q1].data.quest.heroId, sandro.id);
  assert.equal(state.map.objects[q2].data.quest.heroId, orrin.id);
  state.players[0].visited[`killed_hero_${sandro.id}`] = true;
  assert.equal(questFulfilled(state, orrin, state.map.objects[q1].data.quest), true);
  // editor: removing a starting hero keeps the index-based quest pointing at the right hero
  E.removeRef(doc, { kind: 'hero', index: 1 });
  assert.equal(doc.bp.map.objects[q1].data.quest.heroIndex, 1);
  E.undo(doc);
  assert.equal(doc.bp.map.objects[q1].data.quest.heroIndex, 2);
  E.removeRef(doc, { kind: 'hero', index: 2 });
  assert.equal(doc.bp.map.objects[q1].data.quest.heroIndex, undefined);
  assert.ok(E.validateMap(doc.bp).warnings.some((w) => /choose the hero to defeat/.test(w.text)));
});

test('starting heroes get their custom army, primary skills, skills, spells and artifacts', () => {
  resetGameDeps();
  const { doc } = threeSlotMap();
  assert.equal(E.setProps(doc, { kind: 'hero', index: 1 }, { skills: [{ id: 'nope', level: 1 }] }).error, 'bad_value');
  assert.ok(E.setProps(doc, { kind: 'hero', index: 1 }, { army: [{ creatureId: 'wood_elf', count: 12 }] }).ok);
  const state = createGame(E.prepareForPlay(doc.bp), { seed: 2, players: [0, 1, 2].map((slot) => ({ slot, isHuman: slot === 0 })) });
  const orrin = Object.values(state.heroes).find((h) => h.defId === 'orrin');
  assert.deepEqual(orrin.army.filter(Boolean), [{ creatureId: 'angel', count: 3 }, { creatureId: 'pikeman', count: 40 }]);
  assert.equal(orrin.primary.attack, 9);
  assert.equal(orrin.primary.knowledge, 4);
  assert.deepEqual(orrin.skills, [{ id: 'logistics', level: 3 }]);
  assert.ok(orrin.spells.includes('haste') && orrin.spells.includes('slow'));
  assert.ok(JSON.stringify(orrin.artifacts).includes('spellbook'));
  assert.ok(JSON.stringify(orrin.artifacts).includes('centaurs_axe'));
  const p1 = state.heroes[state.players[1].heroes[0]];
  assert.deepEqual(p1.army.filter(Boolean), [{ creatureId: 'wood_elf', count: 12 }]);
  // clearing extras
  assert.ok(E.setProps(doc, { kind: 'hero', index: 0 }, { army: [], spells: null }).ok);
  assert.equal(doc.bp.heroes[0].army, undefined);
  assert.equal(doc.bp.heroes[0].spells, undefined);
});

test('timed events: schedule, players, resources and creatures, fired at day start; editor API with undo', () => {
  resetGameDeps();
  setAiDriver(null);
  assert.equal(timedEventDue({ day: 3, repeat: 2 }, 3), true);
  assert.equal(timedEventDue({ day: 3, repeat: 2 }, 4), false);
  assert.equal(timedEventDue({ day: 3, repeat: 2 }, 5), true);
  assert.equal(timedEventDue({ day: 3, repeat: 0 }, 5), false);
  const { doc } = threeSlotMap();
  must(E.addTimedEvent(doc, { name: 'Tribute', day: 1, players: [0], message: 'Gold!', resources: { gold: 1000 } }));
  must(E.addTimedEvent(doc, { name: 'Recruits', day: 3, repeat: 2, players: [2], creatures: [{ creatureId: 'skeleton', count: 10 }] }));
  must(E.addTimedEvent(doc, { name: 'Tax', day: 2, players: [0, 2], resources: { gold: -500 } }));
  assert.equal(E.addTimedEvent(doc, { day: 0 }).error, 'bad_value');
  assert.equal(E.addTimedEvent(doc, { day: 2, players: [7] }).error, 'bad_value');
  must(E.setTimedEvent(doc, 2, { humanOnly: true }));
  must(E.addTimedEvent(doc, { day: 9 }));
  must(E.removeTimedEvent(doc, 3));
  E.undo(doc);
  assert.equal(doc.bp.events.length, 4);
  E.redo(doc);
  assert.equal(doc.bp.events.length, 3);
  const back = E.deserializeMap(E.serializeMap(doc.bp));
  assert.deepEqual(back.bp.events, doc.bp.events);
  const state = createGame(E.prepareForPlay(doc.bp), { seed: 2, difficulty: 1, players: [{ slot: 0, isHuman: true }, { slot: 2, isHuman: false }] });
  const gold0 = state.players[0].resources.gold;
  const gold1 = state.players[1].resources.gold;
  assert.ok(state.log.some((l) => l.type === 'timed_event' && l.message === 'Gold!' && l.playerId === 0), 'day-1 event fired at creation');
  const sandro = () => state.heroes[state.players[1].heroes[0]];
  const skel = () => (sandro().army.find((s) => s && s.creatureId === 'skeleton') || { count: 0 }).count;
  const s0 = skel();
  const seen = [];
  for (let d = 0; d < 5; d++) {
    const r = endTurn(state);
    assert.ok(r.ok);
    seen.push(...r.events.filter((e) => e.type === 'timed_event').map((e) => `${state.turn}:${e.eventId}:${e.playerId}`));
  }
  assert.deepEqual(seen, ['2:te3:0', '3:te2:1', '5:te2:1']);
  assert.equal(skel(), s0 + 20);
  assert.ok(state.players[0].resources.gold < gold0 + 5000, 'tax applied to the human only');
  assert.ok(state.players[1].resources.gold >= gold1, 'the computer was not taxed (humanOnly)');
  assert.deepEqual(deserialize(serialize(state)), state);
});
