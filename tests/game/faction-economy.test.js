// Play-level property test (audit, docs/audit/towns-economy.md): 112 days (4 months) of a scripted
// economy for every faction. Player 0 builds one building a day in a sensible order with ample
// resources until the whole build tree (Grail included) stands. Every week the creature growth is
// compared with an independent hand computation, every ordinary day the income, and the state is
// round-tripped through JSON at each month's end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTIONS, RESOURCES } from '../../src/core/constants.js';
import { buildingsForFaction, getBuilding, isBuilt } from '../../src/data/buildings.js';
import { getCreature } from '../../src/data/creatures.js';
import { useFallbackDeps } from '../../src/engine/gameDeps.js';
import { createTestMap } from '../../src/engine/testing.js';
import { getPending } from '../../src/engine/pending.js';
import { giveArtifact } from '../../src/engine/artifacts.js';
import { getIncomeBreakdown } from '../../src/engine/economy.js';
import { createGame, endTurn, serialize, deserialize, resolvePending } from '../../src/engine/game.js';
import { getAvailableBuildings, build, getTownGrowth } from '../../src/engine/town.js';
import { tinyBlueprint } from './fixture.js';
import { assertValidState } from './sim.js';

const DAYS = 112;

// --- original values, pinned independently of the data files -----------------------------------
const HALL_GOLD = { village_hall: 500, town_hall: 1000, city_hall: 2000, capitol: 4000 };
const SILO = {
  castle: ['wood', 'ore'], rampart: ['crystal'], tower: ['gems'], inferno: ['mercury'], necropolis: ['wood', 'ore'],
  dungeon: ['sulfur'], stronghold: ['wood', 'ore'], fortress: ['wood', 'ore'], conflux: ['mercury'],
  cove: ['wood', 'ore'], factory: ['mercury'],
};
/** Horde buildings of the nine SoD towns: building -> [growth bonus, creatures]. */
const SOD_HORDES = {
  castle_griffin_bastion: [3, ['griffin', 'royal_griffin']],
  rampart_miners_guild: [4, ['dwarf', 'battle_dwarf']],
  rampart_dendroid_saplings: [2, ['dendroid_guard', 'dendroid_soldier']],
  tower_sculptors_wings: [4, ['stone_gargoyle', 'obsidian_gargoyle']],
  inferno_birthing_pools: [8, ['imp', 'familiar']],
  inferno_cages: [3, ['hell_hound', 'cerberus']],
  necropolis_unearthed_graves: [6, ['skeleton', 'skeleton_warrior']],
  dungeon_mushroom_rings: [7, ['troglodyte', 'infernal_troglodyte']],
  stronghold_mess_hall: [8, ['goblin', 'hobgoblin']],
  fortress_captains_quarters: [6, ['gnoll', 'gnoll_marauder']],
  conflux_garden_of_life: [10, ['pixie', 'sprite']],
};
const KIND_ORDER = ['hall', 'fort', 'dwelling', 'horde', 'mage_guild', 'tavern', 'market', 'blacksmith', 'silo', 'special', 'shipyard', 'grail'];

/** Horde table: SoD values pinned above, HotA towns from the data. */
function hordeBonus(buildingId) {
  if (SOD_HORDES[buildingId]) return SOD_HORDES[buildingId];
  const e = getBuilding(buildingId).effects.find((x) => x.type === 'creature_growth');
  return e ? [e.value, e.creatureIds] : null;
}

/** Hand computation of a town's weekly growth (SoD order: fort % of base, hordes, then Grail +50 % of all). */
function expectedGrowth(buildings) {
  const has = (id) => buildings.includes(id);
  const fortPct = has('castle') ? 100 : has('citadel') ? 50 : 0;
  const grail = buildings.some((id) => getBuilding(id).kind === 'grail');
  const out = {};
  for (const id of buildings) {
    const d = getBuilding(id).dwelling;
    if (!d) continue;
    const base = getCreature(d.creatureId).growth;
    let sum = base + Math.floor(base * fortPct / 100);
    for (const h of buildings) {
      const hb = getBuilding(h).kind === 'horde' ? hordeBonus(h) : null;
      if (hb && hb[1].includes(d.creatureId)) sum += hb[0];
    }
    if (grail) sum += Math.floor(sum / 2);
    if (has('inferno_grail') && (d.creatureId === 'imp' || d.creatureId === 'familiar')) sum += 15; // Deity of Fire
    out[d.creatureId] = sum;
  }
  return out;
}

function expectedTownIncome(faction, buildings) {
  const inc = Object.fromEntries(RESOURCES.map((r) => [r, 0]));
  for (const id of buildings) if (HALL_GOLD[id]) inc.gold += HALL_GOLD[id];
  if (buildings.includes('resource_silo')) for (const r of SILO[faction]) inc[r] += 1;
  if (buildings.some((id) => getBuilding(id).kind === 'grail')) inc.gold += 5000;
  return inc;
}

function resolveAll(state) {
  for (let i = 0; i < 50; i++) {
    const p = getPending(state, state.currentPlayer)[0];
    if (!p) return;
    assert.equal(resolvePending(state, p.id, 0).ok, true);
  }
}

function newGame(faction) {
  useFallbackDeps();
  const bp = tinyBlueprint(createTestMap);
  bp.towns[0].faction = faction;
  bp.heroes[0].pos = { ...bp.towns[0].pos }; // the hero starts inside (visit effects, Grail delivery)
  const s = createGame(bp, {
    seed: 7,
    difficulty: 1,
    forceWeekEvent: { kind: 'normal' },
    players: [
      { slot: 0, name: 'Builder', isHuman: true, faction },
      { slot: 1, name: 'Idle', isHuman: true, faction: 'tower' },
    ],
  });
  const p = s.players[0];
  for (const r of RESOURCES) p.resources[r] = r === 'gold' ? 1000000 : 5000;
  const town = s.towns[p.towns[0]];
  town.coastal = true; // shipyard / lighthouse are part of the tree
  return s;
}

for (const faction of FACTIONS) {
  test(`112-day economy: ${faction} builds its whole tree, growth and income match hand computation`, () => {
    let s = newGame(faction);
    const townId = s.players[0].towns[0];
    const all = buildingsForFaction(faction).map((b) => b.id);
    let builtCount = 0;
    let weeksChecked = 0;
    let daysChecked = 0;
    for (let day = 1; day <= DAYS; day++) {
      assert.equal(s.turn, day);
      assert.equal(s.currentPlayer, 0);
      const town = s.towns[townId];
      const p = s.players[0];
      // the Grail arrives in month 2
      if (day === 40) {
        const hero = s.heroes[town.visitingHero];
        assert.ok(hero, 'hero still in town');
        assert.equal(giveArtifact(hero, 'grail', { toBackpack: true }).ok, true);
      }
      const options = getAvailableBuildings(s, townId).filter((b) => b.status === 'available')
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.cost.gold || 0) - (b.cost.gold || 0) || a.id.localeCompare(b.id));
      for (const pick of options) {
        const r = build(s, townId, pick.id);
        if (!r.ok) {
          assert.ok(['built_this_turn', 'no_grail'].includes(r.error), `${pick.id}: ${r.error}`);
          continue;
        }
        builtCount++;
        if (getBuilding(pick.id).kind !== 'grail') break; // the Grail does not use up the daily build
      }
      resolveAll(s);
      assertValidState(s);
      // snapshot for the checks after the night
      const before = { stock: { ...town.stock }, buildings: [...town.buildings], res: { ...p.resources } };
      const heroIncome = getIncomeBreakdown(s, 0).heroes;
      assert.equal(endTurn(s).ok, true);
      resolveAll(s);
      assert.equal(endTurn(s).ok, true, `day ${day}: player 1 ends`);
      assert.equal(s.turn, day + 1);
      const t = s.towns[townId];
      if (s.date.day === 1) {
        // weekly growth: accumulated stock + hand-computed growth for every dwelling
        const exp = expectedGrowth(before.buildings);
        assert.deepEqual(getTownGrowth(s, townId), exp, `${faction} week ${s.date.week} growth`);
        for (const [c, n] of Object.entries(t.stock)) {
          assert.equal(n, (before.stock[c] || 0) + (exp[c] || 0), `${faction} day ${s.turn} stock ${c}`);
        }
        weeksChecked++;
      } else {
        // daily income: halls, silo, grail (+ whatever the hero earns), nothing else
        const inc = expectedTownIncome(faction, before.buildings);
        for (const r of RESOURCES) {
          assert.equal(s.players[0].resources[r] - before.res[r], inc[r] + (heroIncome[r] || 0), `${faction} day ${s.turn} ${r}`);
        }
        daysChecked++;
      }
      // JSON round trip at every month end, the game continues on the loaded copy
      if (day % 28 === 0) {
        const loaded = deserialize(serialize(s));
        assert.deepEqual(loaded, s, `${faction} day ${day} round trip`);
        s = loaded;
      }
    }
    const t = s.towns[townId];
    const missing = all.filter((id) => !isBuilt(t.buildings, id));
    assert.deepEqual(missing, [], `${faction}: everything was eventually buildable`);
    assert.equal(builtCount, all.length - 4, 'all but the starting village hall, fort, tavern and tier-1 dwelling');
    assert.equal(weeksChecked, DAYS / 7);
    assert.equal(daysChecked, DAYS - DAYS / 7);
    assert.ok(t.buildings.includes('capitol') && t.buildings.includes('castle'));
    // the whole tree costs less than the starting treasure (sanity of the costs)
    assert.ok(s.players[0].resources.gold > 0);
  });
}

test('112-day economy: worked checkpoint, a Castle town with castle, Griffin Bastion and Grail', () => {
  // independent arithmetic for the classic example: griffins 7 base +7 castle +3 bastion = 17, Grail +8 = 25
  assert.deepEqual(expectedGrowth(['castle', 'castle_dwelling_3', 'castle_griffin_bastion', 'castle_grail']), { griffin: 25 });
  // pikemen at a Castle with Grail: (14 + 14) * 1.5 = 42; imps with Deity of Fire: (15 + 15 + 8) * 1.5 + 15 = 72
  assert.deepEqual(expectedGrowth(['castle', 'castle_dwelling_1', 'castle_grail']), { pikeman: 42 });
  assert.deepEqual(expectedGrowth(['castle', 'inferno_dwelling_1', 'inferno_birthing_pools', 'inferno_grail']), { imp: 72 });
  for (const [id, [value, creatures]] of Object.entries(SOD_HORDES)) {
    const e = getBuilding(id).effects.find((x) => x.type === 'creature_growth');
    assert.deepEqual([e.value, [...e.creatureIds].sort()], [value, [...creatures].sort()], id);
  }
});
