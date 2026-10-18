// Campaign mode (src/engine/campaign): definitions, maps, launch, carry-over, branching, progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/engine/campaign/index.js';
import { validateBlueprint } from '../../src/engine/mapgen/index.js';
import { createGame, setAiDriver, checkVictory, endTurn, serialize, deserialize } from '../../src/engine/game.js';
import { resetGameDeps } from '../../src/engine/gameDeps.js';
import { captureTown } from '../../src/engine/town.js';
import { getArtifact } from '../../src/data/artifacts.js';
import { getHeroDef } from '../../src/data/heroes.js';
import { getCreature } from '../../src/data/creatures.js';
import { hasArtifact, ownsArtifact } from '../../src/engine/artifacts.js';

function launch(progress, bonusIndex = 0, scenarioId) {
  resetGameDeps();
  setAiDriver(null);
  const run = C.startCampaignScenario(progress, bonusIndex, scenarioId);
  const state = createGame(run.blueprint, run.settings);
  const res = C.applyCarryOver(state, run.carry);
  assert.ok(res.ok, res.error);
  return { ...run, state, heroId: res.heroId };
}
const human = (state) => C.campaignPlayer(state);
const winFor = (state) => { state.gameOver = { winner: human(state).id, winners: [human(state).id], reason: 'test', turn: state.turn, score: 123 }; state.winner = human(state).id; };
const at = (progress, ...ids) => ({ ...progress, available: ids });

test('campaign definitions are valid: 3+ campaigns of 3-4 scenarios, ~10 maps, Cove and Factory, varied objectives', () => {
  assert.deepEqual(C.validateCampaigns(), []);
  assert.ok(C.CAMPAIGNS.length >= 3);
  for (const c of C.CAMPAIGNS) {
    assert.ok(c.scenarios.length >= 3 && c.scenarios.length <= 4, c.id);
    assert.ok(c.carryOver.artifacts > 0);
    for (const s of c.scenarios) {
      assert.ok(s.intro.length > 80 && s.outro.length > 40, `${c.id}/${s.id} texts`);
      assert.equal(new Set(s.bonuses.map((b) => b.type)).size, 3, `${s.id}: three different kinds of bonus`);
    }
  }
  const maps = new Set(C.CAMPAIGNS.flatMap((c) => c.scenarios.map((s) => s.map)));
  assert.ok(maps.size >= 10, `${maps.size} maps`);
  assert.equal(maps.size, C.CAMPAIGN_MAPS.length, 'every campaign map is used');
  const factions = new Set(C.CAMPAIGN_MAPS.flatMap((m) => m.playerInfo.map((p) => p.faction)));
  for (const f of ['cove', 'factory', 'castle', 'necropolis', 'inferno']) assert.ok(factions.has(f), f);
  const types = new Set(C.CAMPAIGN_MAPS.map((m) => (typeof m.victory === 'string' ? m.victory : m.victory.type)));
  for (const t of ['capture_town', 'defeat_hero', 'acquire_artifact', 'build_grail', 'survive', 'accumulate_resources']) assert.ok(types.has(t), t);
  assert.ok(C.CAMPAIGNS.some((c) => c.scenarios.some((s) => s.next.length > 1)), 'a branching campaign');
  for (const m of C.CAMPAIGN_MAPS) assert.ok(['S', 'M'].includes(m.size), `${m.id} small / medium`);
  // listing for the select screen
  const list = C.listCampaigns();
  assert.equal(list.length, C.CAMPAIGNS.length);
  assert.equal(list.find((c) => c.id === 'iron_and_steam').length, 3, 'a branch is played once');
});

test('the validator catches broken campaign data', () => {
  const bad = JSON.parse(JSON.stringify(C.CAMPAIGNS[0]));
  bad.scenarios[0].next = ['nowhere'];
  bad.scenarios[1].bonuses = [{ type: 'artifact', artifactId: 'no_such_thing' }];
  bad.heroDefId = 'christian';
  const errors = C.validateCampaigns([bad]);
  assert.ok(errors.some((e) => /unknown next/.test(e)));
  assert.ok(errors.some((e) => /bad bonus|3 bonuses/.test(e)));
  assert.ok(errors.some((e) => /slot 0 must start with christian/.test(e)));
});

test('every campaign map generates, validates and starts a game with its objective resolved', () => {
  for (const c of C.CAMPAIGNS) {
    for (const s of c.scenarios) {
      const where = `${c.id}/${s.id}`;
      const p = at(C.createCampaignProgress(c.id), s.id);
      const { blueprint, state, heroId } = launch(p, 0);
      const v = validateBlueprint(blueprint);
      assert.ok(v.ok, `${where}: ${v.errors.slice(0, 3).join('; ')}`);
      assert.equal(blueprint.meta.campaign.scenarioId, s.id);
      const me = human(state);
      assert.equal(me.id, 0);
      assert.ok(me.isHuman && me.towns.length >= 1);
      assert.equal(me.faction, getHeroDef(c.heroDefId).faction, where);
      assert.equal(state.heroes[heroId].defId, c.heroDefId, `${where}: the main hero leads`);
      assert.ok(state.players.slice(1).every((x) => !x.isHuman && x.heroes.length >= 1 && x.towns.length >= 1), `${where}: AI players`);
      const vic = state.settings.victory;
      switch (vic.type) {
        case 'capture_town': assert.notEqual(state.towns[vic.townId].owner, 0, where); break;
        case 'defeat_hero': assert.ok(state.heroes[vic.heroId] && state.heroes[vic.heroId].owner !== 0, where); break;
        case 'acquire_artifact': assert.ok(Object.values(state.map.objects).some((o) => o.data && o.data.artifactId === vic.artifactId), `${where}: the artifact lies on the map`); break;
        case 'build_grail': assert.ok(Object.values(state.map.objects).some((o) => o.defId === 'grail') || state.grail, `${where}: grail`); break;
        default: break;
      }
      if (vic.type !== 'defeat_all') assert.equal(vic.appliesToAi, false, `${where}: only the player wins by the objective`);
      assert.equal(checkVictory(state).over, false, `${where}: not over at the start`);
      assert.deepEqual(deserialize(serialize(state)), state);
    }
  }
});

test('a week of play with the real AI on every campaign map keeps the game running', async () => {
  const ai = await import('../../src/engine/ai/index.js');
  try {
    for (const c of C.CAMPAIGNS) {
      for (const s of c.scenarios) {
        const { state } = launch(at(C.createCampaignProgress(c.id), s.id), 1);
        ai.installAi();
        for (let d = 0; d < 7 && !state.gameOver; d++) {
          const r = endTurn(state);
          assert.ok(r.ok || r.error === 'game_over', `${s.id}: ${r.error}`);
          // the human just ends turns: clear his pendings
          state.pending = state.pending.filter((x) => x.playerId !== 0);
        }
        assert.ok(state.turn >= 7 || state.gameOver, s.id);
        assert.ok(!state.gameOver || state.gameOver.winner !== 0, `${s.id}: nobody wins by doing nothing`);
      }
    }
  } finally {
    ai.uninstallAi();
    setAiDriver(null);
  }
});

test('story events: every map has day-N messages, gifts and an enemy twist that fire in the game', () => {
  for (const m of C.CAMPAIGN_MAPS) {
    const evs = m.events || [];
    assert.ok(evs.length >= 3, `${m.id}: events`);
    assert.ok(evs.some((e) => e.players?.includes(0) && e.message), `${m.id}: a story message for the player`);
    assert.ok(evs.some((e) => e.players?.includes(0) && (e.creatures || e.resources)), `${m.id}: a gift`);
    assert.ok(evs.some((e) => e.players?.some((p) => p > 0) && e.creatures), `${m.id}: enemy reinforcements (twist)`);
    for (const e of evs) {
      for (const c of e.creatures || []) assert.ok(getCreature(c.creatureId), c.creatureId);
      assert.ok(e.players.every((p) => p >= 0 && p < m.players), `${m.id}: slots`);
    }
  }
  // they fire on their day for their player
  const { state } = launch(C.createCampaignProgress('saltwind_charter'), null);
  assert.equal(state.timedEvents.length, C.CAMPAIGN_MAP_BY_ID.saltwind_wreckers_shore.events.length);
  const gold = state.players[0].resources.gold;
  const fired = [];
  for (let d = 1; d < 15; d++) {
    const r = endTurn(state); // human ends the day, the (driverless) computer too
    assert.ok(r.ok, r.error);
    fired.push(...r.events.filter((e) => e.type === 'timed_event').map((e) => `${state.turn}:${e.playerId}:${e.name}`));
    state.pending = [];
  }
  assert.ok(fired.includes('2:0:The fishing fleet'), fired.join(','));
  assert.ok(fired.includes('9:0:Survivors'));
  assert.ok(fired.includes('15:1:Gnoll war-band') && fired.includes('15:0:Gnolls for hire'));
  assert.ok(!fired.some((f) => f.startsWith('2:1:')), 'the gift is for the player only');
  assert.ok(state.players[0].resources.gold >= gold, 'gold arrived');
  const mire = state.players[1].heroes.map((id) => state.heroes[id]);
  const gar = state.towns[state.players[1].towns[0]]?.garrison || [];
  assert.ok([...mire.flatMap((h) => h.army), ...gar].some((st) => st && st.creatureId === 'gnoll_marauder'), 'the enemy got its war-band');
});

test('starting bonuses: artifact, creatures, resources, spell, experience', () => {
  const c = C.getCampaign('iron_and_steam');
  const p = C.createCampaignProgress(c.id);
  const base = launch(p, null).state;
  const hero0 = Object.values(base.heroes).find((h) => h.defId === 'henrietta');
  const art = launch(p, 1);
  assert.ok(hasArtifact(art.state.heroes[art.heroId], 'equestrians_gloves'));
  const cr = launch(p, 0);
  const mech = (h) => h.army.filter((s) => s && s.creatureId === 'mechanic').reduce((n, s) => n + s.count, 0);
  assert.equal(mech(cr.state.heroes[cr.heroId]), mech(hero0) + 10);
  const res = launch(p, 2);
  assert.equal(human(res.state).resources.gold, human(base).resources.gold + 2000);
  assert.equal(human(res.state).resources.ore, human(base).resources.ore + 10);
  const sp = launch(at(p, 'sandsea'), 2);
  const sh = sp.state.heroes[sp.heroId];
  assert.ok(sh.spells.includes('haste') && hasArtifact(sh, 'spellbook'));
  const xp = launch(at(p, 'last_furnace'), 2);
  assert.ok(xp.state.heroes[xp.heroId].exp >= 3000);
  assert.ok(xp.state.heroes[xp.heroId].level > 1);
  // applying twice is refused
  assert.equal(C.applyCarryOver(art.state, art.carry).ok, false);
});

test('carry-over round trip: level, skills, spells and the best N artifacts and troops survive into the next scenario', () => {
  const c = C.getCampaign('iron_and_steam');
  let progress = C.createCampaignProgress(c.id, { difficulty: 2 });
  const first = launch(progress, 2);
  const hero = first.state.heroes[first.heroId];
  hero.level = 9; hero.exp = 21000;
  hero.primary = { attack: 6, defense: 5, power: 3, knowledge: 4 };
  hero.skills = [{ id: 'offense', level: 3 }, { id: 'logistics', level: 2 }, { id: 'wisdom', level: 1 }];
  hero.spells = ['haste', 'bless'];
  hero.artifacts.equipped.spellbook[0] = 'spellbook';
  const arts = ['centaurs_axe', 'boots_of_speed', 'ring_of_vitality', 'golden_bow', 'cape_of_velocity', 'clover_of_fortune'];
  hero.artifacts.backpack.push(...arts);
  hero.army = [{ creatureId: 'automaton', count: 10 }, { creatureId: 'halfling', count: 40 }, { creatureId: 'mechanic', count: 12 }, null, null, null, null];
  // finish the scenario the real way: capture Brasswick
  captureTown(first.state, first.state.settings.victory.townId, 0);
  checkVictory(first.state);
  assert.equal(first.state.gameOver?.winner, 0);
  progress = C.completeScenario(progress, first.state);
  assert.deepEqual(progress.completed.map((x) => x.scenarioId), ['cog_valley']);
  assert.equal(progress.completed[0].bonusIndex, 2);
  assert.deepEqual(progress.available, ['sandsea', 'ashrun']);
  const carried = progress.hero;
  assert.equal(carried.level, 9);
  assert.equal(carried.artifacts.length, c.carryOver.artifacts);
  const byCost = arts.slice().sort((a, b) => getArtifact(b).cost - getArtifact(a).cost).slice(0, 4);
  assert.deepEqual(carried.artifacts.slice().sort(), byCost.slice().sort(), 'the most valuable artifacts are kept');
  assert.equal(carried.army.length, 2, 'the two strongest stacks');
  // JSON round trip of the progress (storage)
  progress = C.normalizeProgress(JSON.parse(JSON.stringify(progress)));
  assert.ok(progress);

  const next = launch(progress, 0, 'ashrun');
  const h2 = next.state.heroes[next.heroId];
  assert.equal(h2.defId, 'henrietta');
  assert.equal(h2.level, 9);
  assert.equal(h2.exp, 21000);
  assert.deepEqual(h2.primary, { attack: 6, defense: 5, power: 3, knowledge: 4 });
  assert.deepEqual(h2.skills, [{ id: 'offense', level: 3 }, { id: 'logistics', level: 2 }, { id: 'wisdom', level: 1 }]);
  assert.ok(['haste', 'bless'].every((s) => h2.spells.includes(s)) && hasArtifact(h2, 'spellbook'));
  for (const a of byCost) assert.ok(ownsArtifact(h2, a), a);
  assert.ok(hasArtifact(h2, 'shield_of_the_dwarven_lords'), 'plus the new bonus');
  const count = (id) => h2.army.filter((s) => s && s.creatureId === id).reduce((n, s) => n + s.count, 0);
  assert.ok(count('automaton') >= 5, 'half of the strongest stack');
  assert.equal(h2.mana, h2.mana > 0 ? h2.mana : 0);
  assert.ok(h2.movePoints > 0 && h2.movePoints === h2.maxMovePoints);
  assert.equal(next.state.settings.difficulty, 2, 'the campaign difficulty is used');
});

test('carry-over choice: the player picks which artifacts and troops come along (up to the limits)', () => {
  const c = C.getCampaign('iron_and_steam');
  let progress = C.createCampaignProgress(c.id);
  const g = launch(progress, null);
  const hero = g.state.heroes[g.heroId];
  const arts = ['centaurs_axe', 'boots_of_speed', 'ring_of_vitality', 'golden_bow', 'cape_of_velocity', 'clover_of_fortune'];
  hero.artifacts.backpack.push(...arts);
  hero.army = [{ creatureId: 'automaton', count: 10 }, { creatureId: 'halfling', count: 40 }, { creatureId: 'mechanic', count: 12 }, null, null, null, null];
  winFor(g.state);
  progress = C.completeScenario(progress, g.state);
  const o = progress.hero.options;
  assert.equal(o.artifacts.length, 6);
  assert.deepEqual(o.limits, { artifacts: 4, stacks: 2 });
  assert.equal(o.army.length, 3);
  assert.deepEqual(C.carryChoiceIndices(progress), { artifacts: [0, 1, 2, 3], army: [0, 1] }, 'default = the best ones');
  assert.throws(() => C.setCarryChoice(progress, { artifacts: [0, 1, 2, 3, 4] }), /at most 4/);
  assert.throws(() => C.setCarryChoice(progress, { army: [7] }), /bad/);
  const picked = C.setCarryChoice(progress, { artifacts: [5, 4], army: [2] });
  assert.deepEqual(picked.hero.artifacts, [o.artifacts[4], o.artifacts[5]]);
  assert.deepEqual(picked.hero.army, [o.army[2]]);
  assert.equal(progress.hero.artifacts.length, 4, 'input not mutated');
  assert.deepEqual(C.carryChoiceIndices(picked), { artifacts: [4, 5], army: [2] });
  const next = launch(picked, null, 'sandsea');
  const h2 = next.state.heroes[next.heroId];
  for (const a of [o.artifacts[4], o.artifacts[5]]) assert.ok(ownsArtifact(h2, a), a);
  for (const a of o.artifacts.slice(0, 4)) assert.equal(ownsArtifact(h2, a), false, a);
  assert.ok(h2.army.some((st) => st && st.creatureId === o.army[2].creatureId));
});

test('branching: the chosen branch replaces the other one and the campaign ends after the finale', () => {
  let progress = C.createCampaignProgress('iron_and_steam');
  assert.throws(() => C.startCampaignScenario(progress, 0, 'ashrun'), /not available/);
  let g = launch(progress, 0);
  winFor(g.state);
  progress = C.completeScenario(progress, g.state);
  assert.deepEqual(C.getAvailableScenarios(progress).map((s) => s.id), ['sandsea', 'ashrun']);
  g = launch(progress, 1, 'ashrun');
  assert.equal(g.state.meta.campaign.scenarioId, 'ashrun');
  winFor(g.state);
  progress = C.completeScenario(progress, g.state);
  assert.deepEqual(progress.available, ['last_furnace']);
  assert.ok(C.campaignProgressRatio(progress) > 0.6 && C.campaignProgressRatio(progress) < 1);
  g = launch(progress, 0);
  winFor(g.state);
  progress = C.completeScenario(progress, g.state);
  assert.equal(progress.status, 'complete');
  assert.deepEqual(progress.completed.map((x) => x.scenarioId), ['cog_valley', 'ashrun', 'last_furnace']);
  assert.deepEqual(progress.available, []);
  assert.equal(C.campaignProgressRatio(progress), 1);
  assert.throws(() => C.startCampaignScenario(progress, 0), /complete/);
});

test('a lost scenario only counts the attempt; the retry uses another seed and the old hero', () => {
  let progress = C.createCampaignProgress('long_winter');
  const g = launch(progress, 0);
  const before = JSON.stringify(progress);
  g.state.gameOver = { winner: 1, winners: [1], reason: 'defeat_all', turn: 9, score: 0 };
  const after = C.completeScenario(progress, g.state);
  assert.equal(JSON.stringify(progress), before, 'the input is not mutated');
  assert.equal(after.attempts.frostmarch, 1);
  assert.deepEqual(after.available, ['frostmarch']);
  assert.equal(after.completed.length, 0);
  assert.equal(after.lastResult.won, false);
  const a = C.startCampaignScenario(progress, 0).settings.seed;
  const b = C.startCampaignScenario(after, 0).settings.seed;
  assert.notEqual(a, b);
  // a game of another campaign is refused
  assert.throws(() => C.completeScenario(C.createCampaignProgress('saltwind_charter'), g.state), /does not belong/);
  progress = after;
});

test('survive: holding the town for the days wins; losing the hero loses (Long Winter rules)', () => {
  const p = C.createCampaignProgress('long_winter');
  const g = launch(p, 0);
  g.state.turn = 43;
  checkVictory(g.state);
  assert.equal(g.state.gameOver.winner, 0);
  assert.ok(C.isCampaignVictory(g.state));
  const t = launch(at(p, 'thaw'), 0);
  assert.equal(t.state.settings.loss.type, 'lose_hero');
  assert.equal(t.state.settings.loss.playerId, 0);
});

test('progress records: normalize rejects garbage, keeps valid JSON', () => {
  assert.equal(C.normalizeProgress(null), null);
  assert.equal(C.normalizeProgress({ campaignId: 'nope' }), null);
  assert.equal(C.normalizeProgress({ ...C.createCampaignProgress('long_winter'), version: 99 }), null);
  assert.equal(C.normalizeProgress({ ...C.createCampaignProgress('long_winter'), available: ['bogus'] }), null);
  const p = C.createCampaignProgress('saltwind_charter');
  assert.deepEqual(C.normalizeProgress(JSON.parse(JSON.stringify(p))), p);
  assert.equal(p.difficulty, 0, 'the recommended difficulty of an easy campaign');
});
