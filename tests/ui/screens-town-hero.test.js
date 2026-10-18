// Town, hero, kingdom screens and their dialogs (fake DOM, real engines, placeholder sprites).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, createFakeStorage, fire, tick, until } from './fakeDom.js';

installFakeDom();
const { createApp } = await import('../../src/ui/app.js');
const ui = await import('../../src/ui/kit/index.js');
const { createTestState } = await import('../../src/engine/testing.js');
const townEngine = await import('../../src/engine/town.js');
const heroEngine = await import('../../src/engine/hero.js');
const { giveArtifact } = await import('../../src/engine/artifacts.js');
const { FACTIONS } = await import('../../src/core/constants.js');
const { HEROES } = await import('../../src/data/heroes.js');
const { HERO_CLASSES } = await import('../../src/data/heroClasses.js');
const { buildingsForFaction, upgradesOf, isAvailableTo, getBuilding } = await import('../../src/data/buildings.js');
const TM = await import('../../src/ui/screens/town/townModel.js');
const HM = await import('../../src/ui/screens/hero/heroModel.js');
const townScreen = await import('../../src/ui/screens/town/index.js');
const heroScreen = await import('../../src/ui/screens/hero/index.js');
const kingdomScreen = await import('../../src/ui/screens/kingdom/index.js');
const { openHeroTrade, artifactTradeAction } = await import('../../src/ui/screens/dialogs/heroTrade.js');
const { openMarketplace } = await import('../../src/ui/screens/dialogs/marketplace.js');
const { openTavern } = await import('../../src/ui/screens/dialogs/tavern.js');
const { openRecruit } = await import('../../src/ui/screens/dialogs/recruit.js');
const { thievesGuildModel } = await import('../../src/ui/screens/dialogs/thievesGuild.js');
const { openSpellbook } = await import('../../src/ui/screens/dialogs/spellbook.js');
const { openHall } = await import('../../src/ui/screens/town/hall.js');
const { levelUpModel } = await import('../../src/ui/screens/hero/levelUp.js');

let app = null;
let errors = [];
const saved = { error: console.error, warn: console.warn };
function makeApp(state) {
  errors = [];
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };
  console.warn = () => {};
  const root = document.createElement('div');
  document.body.appendChild(root);
  app = createApp(root, { storageBackend: createFakeStorage(), gfxLoader: async () => { throw new Error('no gfx'); } });
  app.ctx.setState(state, { silent: true });
  return app;
}
afterEach(async () => {
  ui.closeAllDialogs();
  if (app) await app.destroy();
  app = null;
  Object.assign(console, saved);
});
const noErrors = (a) => {
  assert.equal(a.layers.error.children.length, 0, `error overlay: ${a.layers.error.textContent}`);
  assert.deepEqual(errors, []);
};
const dialogs = () => app.layers.dialogs.querySelectorAll('.k-dlg');
const topDialog = () => dialogs()[dialogs().length - 1];
const btnIn = (root, label) => root.querySelectorAll('.k-btn').find((b) => b.textContent.includes(label));

/** Every building of a faction, newest step of each chain only. */
function allBuildings(faction) {
  return buildingsForFaction(faction)
    .filter((b) => !upgradesOf(b.id).some((u) => isAvailableTo(getBuilding(u), faction)))
    .map((b) => b.id);
}

function setup({ faction = 'castle', buildings, players = 2, hero = true } = {}) {
  const state = createTestState({ players, seed: 7 });
  const town = townEngine.createTown(state, { faction, owner: 0, pos: { x: 5, y: 5, z: 0 }, buildings });
  let h = null;
  if (hero) {
    const def = HEROES.find((d) => d.faction === faction && !d.special) || HEROES[0];
    h = heroEngine.addHero(state, def.id, 0, { x: 5, y: 5, z: 0 });
    townEngine.visitTown(state, h.id, town.id);
  }
  return { state, town, hero: h };
}

// ---- pure models ---------------------------------------------------------------------------------

test('townModel: building actions, hall cards, layout fallback, helpers', () => {
  assert.equal(TM.buildingAction('village_hall', 'castle'), 'hall');
  assert.equal(TM.buildingAction('castle', 'castle'), 'fort');
  assert.equal(TM.buildingAction('castle_dwelling_1', 'castle'), 'dwelling');
  assert.equal(TM.buildingAction('marketplace', 'castle'), 'marketplace');
  assert.equal(TM.buildingAction('tavern', 'castle'), 'tavern');
  assert.equal(TM.buildingAction('blacksmith', 'castle'), 'blacksmith');
  assert.equal(TM.buildingAction('mage_guild_1', 'castle'), 'mage_guild');
  const { state, town } = setup({ hero: false });
  const rows = townEngine.getAvailableBuildings(state, town.id);
  const cards = TM.hallCards(rows, town.buildings);
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(by.town_hall.status, 'available', 'next hall step is shown, not the built village hall');
  assert.equal(by.village_hall, undefined);
  assert.equal(by.castle_dwelling_4.status, 'missing_requirements');
  assert.equal(by.castle_dwelling_1_up.status, 'available');
  assert.equal(by.castle_dwelling_1, undefined);
  assert.ok(!cards.some((c) => c.id === 'castle'), 'castle hidden until the citadel stands');
  assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
  const lay = TM.layoutTown(town, null);
  assert.equal(lay.length, town.buildings.length);
  for (const b of lay) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= TM.TOWN_VIEW_W && b.y + b.h <= TM.TOWN_VIEW_H, b.id);
  const gfxLay = TM.layoutTown(town, () => ({ fort: { x: 1, y: 2, w: 30, h: 40, z: 3 } }));
  assert.deepEqual(gfxLay.find((b) => b.id === 'fort'), { id: 'fort', x: 1, y: 2, w: 30, h: 40, z: 3 });
  assert.equal(TM.cycle(['a', 'b', 'c'], 'c', 1), 'a');
  assert.equal(TM.cycle(['a', 'b', 'c'], 'a', -1), 'c');
  assert.equal(TM.ordinal(1), '1st');
  assert.equal(TM.ordinal(3), '3rd');
  assert.equal(TM.ordinal(11), '11th');
  assert.equal(TM.affordableCount({ gold: 650 }, { gold: 60 }), 10);
  assert.equal(TM.maxLots(25, { give: 10, get: 1 }), 2);
  const army = [{ creatureId: 'pikeman', count: 3 }, null, null, null, null, null, null];
  assert.equal(TM.dismissStack(army, 0, true).error, 'last_stack');
  assert.ok(TM.dismissStack(army, 0, false).ok);
  assert.equal(army[0], null);
});

test('heroModel: breakdowns, artifact moves inside one hero, source labels, level-up model', () => {
  const { state, hero } = setup();
  giveArtifact(hero, 'centaurs_axe');
  const pb = HM.primaryBreakdown(state, hero);
  assert.equal(pb.attack.total, pb.attack.base + 2);
  assert.ok(pb.attack.items.some((i) => /Centaur/i.test(i.label)));
  assert.match(HM.primaryTooltip('attack', pb.attack), /Base: /);
  assert.equal(HM.sourceLabel('skill:leadership'), 'Leadership (skill)');
  assert.equal(HM.sourceLabel('alignment'), 'Troop alignment');
  assert.match(HM.skillTooltip('leadership', 1), /Basic Leadership[\s\S]*Next:/);
  assert.equal(HM.skillSlots(hero).length, 8);
  // equipped -> backpack -> equipped, rings swap
  assert.ok(HM.moveArtifact(hero, { where: 'equipped', slot: 'right_hand', index: 0 }, { where: 'backpack', index: 0 }).ok);
  assert.equal(hero.artifacts.backpack[0], 'centaurs_axe');
  assert.ok(HM.moveArtifact(hero, { where: 'backpack', index: 0 }, { where: 'equipped', slot: 'right_hand', index: 0 }).ok);
  assert.equal(hero.artifacts.equipped.right_hand[0], 'centaurs_axe');
  assert.equal(HM.moveArtifact(hero, { where: 'equipped', slot: 'right_hand', index: 0 }, { where: 'equipped', slot: 'head', index: 0 }).error, 'wrong_slot');
  giveArtifact(hero, 'quiet_eye_of_the_dragon');
  giveArtifact(hero, 'still_eye_of_the_dragon');
  const [r0, r1] = hero.artifacts.equipped.ring;
  assert.ok(HM.moveArtifact(hero, { where: 'equipped', slot: 'ring', index: 0 }, { where: 'equipped', slot: 'ring', index: 1 }).ok);
  assert.deepEqual(hero.artifacts.equipped.ring, [r1, r0], 'rings swapped');
  assert.equal(hero.artifacts.backpack.length, 0);
  const m = levelUpModel({ heroId: hero.id, options: [{ skillId: 'leadership', level: 1 }, { skillId: 'archery', level: 1 }], data: { level: 2 } }, state);
  assert.equal(m.options.length, 2);
  assert.equal(m.options[0].label, 'Basic Leadership');
  assert.match(m.title, /Level 2/);
});

// ---- town screen ---------------------------------------------------------------------------------

test('town screen mounts and unmounts for every faction (starting and fully built towns); every building opens its window', async () => {
  for (const faction of FACTIONS) {
    for (const full of [false, true]) {
      const { state, town } = setup({ faction, buildings: full ? allBuildings(faction) : undefined });
      const a = makeApp(state);
      assert.equal(await a.showScreen('town', { townId: town.id }), true, `${faction} mounted`);
      const root = a.layers.screen;
      assert.ok(root.querySelector('.town'));
      assert.equal(root.querySelectorAll('.town-bld').length, town.buildings.length, `${faction}: one element per building`);
      assert.ok(root.textContent.includes(town.name));
      for (const id of town.buildings) {
        townScreen.current.openBuilding(id);
        await tick(2);
        assert.ok(ui.dialogCount() > 0, `${faction}/${id} opened a window`);
        ui.closeAllDialogs();
      }
      // hover + click on the view
      const bld = root.querySelector('.town-bld');
      fire(bld, 'mouseenter');
      assert.ok(bld.classList.contains('is-hover'));
      fire(bld, 'click');
      await tick(2);
      assert.ok(ui.dialogCount() > 0);
      ui.closeAllDialogs();
      noErrors(a);
      await a.showScreen('mainMenu');
      assert.equal(townScreen.current, null, 'unmounted');
      await a.destroy();
      app = null;
    }
  }
});

test('hall dialog lists the right states and building goes through the engine', async () => {
  const { state, town } = setup({ hero: false });
  const a = makeApp(state);
  await a.showScreen('town', { townId: town.id });
  const hall = openHall(a.ctx, town.id);
  const card = (id) => topDialog().querySelector(`.town-hall-card[data-building="${id}"]`);
  assert.equal(card('town_hall').dataset.status, 'available');
  assert.equal(card('castle_dwelling_4').dataset.status, 'missing_requirements');
  assert.equal(card('marketplace').dataset.status, 'available');
  fire(card('marketplace'), 'click');
  await tick(2);
  const detail = topDialog();
  assert.match(detail.textContent, /Marketplace/);
  btnIn(detail, 'Build').click();
  assert.equal(await hall, 'marketplace');
  assert.ok(town.buildings.includes('marketplace'));
  assert.equal(state.players[0].resources.gold, 20000 - getBuilding('marketplace').cost.gold);
  assert.ok(a.layers.screen.querySelector('.town-bld[data-building="marketplace"]'), 'the view re-rendered');
  openHall(a.ctx, town.id);
  assert.equal(topDialog().querySelector('.town-hall-card[data-building="town_hall"]').dataset.status, 'built_this_turn');
  // poor player
  ui.closeAllDialogs();
  state.players[0].resources.gold = 0;
  town.builtThisTurn = false;
  a.ctx.notify('test');
  openHall(a.ctx, town.id);
  assert.equal(topDialog().querySelector('.town-hall-card[data-building="town_hall"]').dataset.status, 'not_enough_resources');
  noErrors(a);
});

test('recruiting from the growth panel calls the engine and updates the view', async () => {
  const { state, town } = setup();
  const a = makeApp(state);
  await a.showScreen('town', { townId: town.id });
  const row = a.layers.screen.querySelector('.town-growth-row[data-creature="pikeman"]');
  assert.match(row.textContent, /14 available/);
  fire(row, 'click');
  await tick(2);
  const dlg = topDialog();
  assert.match(dlg.textContent, /Recruit Creatures/);
  assert.ok(dlg.querySelector('.town-recruit-pick[data-creature="pikeman"]'));
  const stepper = dlg.querySelector('.k-stepper-input');
  stepper.value = '5';
  fire(stepper, 'change');
  btnIn(dlg, 'Recruit').click();
  await tick(2);
  assert.equal(ui.dialogCount(), 0, 'closed after buying');
  assert.equal(town.stock.pikeman, 9);
  assert.deepEqual(town.garrison[0], { creatureId: 'pikeman', count: 5 });
  assert.equal(state.players[0].resources.gold, 20000 - 5 * 60);
  assert.match(a.layers.screen.querySelector('.town-growth-row[data-creature="pikeman"]').textContent, /9 available/);
  assert.equal(townScreen.current.rows.garrison.slotEls[0].querySelector('.k-army-count').textContent, '5');
  // into the visiting hero, with the API of the dialog
  const p = openRecruit(a.ctx, town.id, 'pikeman', { target: 'visiting' });
  p.handle.buy(2);
  assert.deepEqual(await p, { creatureId: 'pikeman', count: 2 });
  const heroArmy = state.heroes[town.visitingHero].army;
  assert.equal(heroArmy.find((s) => s && s.creatureId === 'pikeman').count, 10 + 2);
  noErrors(a);
});

test('garrison and visiting rows move stacks through townArmyMove; swap heroes', async () => {
  const { state, town, hero } = setup();
  town.garrison[0] = { creatureId: 'pikeman', count: 4 };
  const a = makeApp(state);
  await a.showScreen('town', { townId: town.id });
  const { garrison, visiting } = townScreen.current.rows;
  fire(garrison.slotEls[0], 'click');
  fire(visiting.slotEls[5], 'click');
  await tick(2);
  assert.equal(town.garrison[0], null);
  assert.deepEqual(hero.army[5], { creatureId: 'pikeman', count: 4 });
  townScreen.current.swapHeroes();
  assert.equal(town.garrisonHero, hero.id);
  assert.equal(town.visitingHero, null);
  assert.ok(a.layers.screen.querySelector('.town-portrait-garrison .k-portrait'));
  noErrors(a);
});

test('marketplace trades at the engine rate', async () => {
  const { state, town } = setup({ buildings: ['village_hall', 'fort', 'tavern', 'marketplace', 'castle_dwelling_1'] });
  const a = makeApp(state);
  await a.showScreen('town', { townId: town.id });
  const p = openMarketplace(a.ctx, { townId: town.id });
  assert.match(topDialog().textContent, /Marketplaces owned: 1/);
  p.handle.trade('wood', 'gold', 2);
  assert.equal(state.players[0].resources.wood, 18);
  assert.equal(state.players[0].resources.gold, 20000 + 2 * 25);
  // through the DOM: pick ore -> gems, Max, Trade
  const dlg = topDialog();
  fire(dlg.querySelectorAll('.town-market-col')[0].querySelector('[data-resource="ore"]'), 'click');
  fire(topDialog().querySelectorAll('.town-market-col')[1].querySelector('[data-resource="gems"]'), 'click');
  btnIn(topDialog(), 'Max').click();
  btnIn(topDialog().querySelector('.town-market-trade'), 'Trade').click();
  assert.equal(state.players[0].resources.ore, 0, '20 ore at 20:1');
  assert.equal(state.players[0].resources.gems, 11);
  noErrors(a);
});

test('tavern hires a hero into the town', async () => {
  const { state, town } = setup({ hero: false });
  townEngine.ensureTavernPool(state, 0);
  const a = makeApp(state);
  await a.showScreen('town', { townId: town.id });
  const p = openTavern(a.ctx, town.id);
  const offers = topDialog().querySelectorAll('.town-tavern-offer');
  assert.equal(offers.length, 2);
  fire(offers[1], 'click');
  assert.ok(topDialog().querySelectorAll('.town-tavern-offer')[1].classList.contains('is-selected'));
  assert.match(topDialog().textContent, /Rumour/);
  btnIn(topDialog(), 'Recruit hero').click();
  const id = await p;
  assert.ok(id && state.heroes[id]);
  assert.equal(town.visitingHero, id);
  assert.equal(state.players[0].resources.gold, 20000 - 2500);
  assert.ok(a.layers.screen.querySelector('.town-portrait-visiting .k-portrait'));
  noErrors(a);
});

test('thieves guild model ranks players and hides locked rows', () => {
  const { state } = setup();
  const m = thievesGuildModel(state, 0);
  assert.equal(m.level, 1, 'one tavern');
  const towns = m.rows.find((r) => r.id === 'towns');
  assert.ok(towns.unlocked);
  assert.equal(towns.places[0], 1);
  assert.equal(m.rows.find((r) => r.id === 'gold').unlocked, false);
});

// ---- hero screen ---------------------------------------------------------------------------------

test('hero screen: artifact moves through the paper doll, skill tooltips, morale breakdown', async () => {
  const { state, hero } = setup();
  giveArtifact(hero, 'centaurs_axe', { toBackpack: true });
  hero.skills = [{ id: 'leadership', level: 2 }, { id: 'wisdom', level: 1 }];
  const a = makeApp(state);
  assert.equal(await a.showScreen('hero', { heroId: hero.id }), true);
  const root = a.layers.screen;
  assert.match(root.textContent, new RegExp(hero.name));
  assert.equal(root.querySelectorAll('.hero-skill').length, 8);
  assert.ok(root.querySelector('.hero-skill[data-skill="leadership"]'));
  assert.match(HM.skillTooltip('leadership', 2), /Advanced Leadership/);
  const ml = root.querySelector('.k-ml-morale');
  const { getArmyMorale } = await import('../../src/engine/bonuses.js');
  assert.equal(ml.dataset.value, String(getArmyMorale(state, { hero })));
  assert.ok(Number(ml.dataset.value) >= 2, 'Advanced Leadership counts');
  const grid = heroScreen.current.arts;
  fire(grid.backpackEls[0], 'click');
  fire(grid.slotEl('right_hand', 0), 'click');
  await tick(2);
  assert.equal(hero.artifacts.equipped.right_hand[0], 'centaurs_axe');
  assert.equal(hero.artifacts.backpack.length, 0);
  assert.equal(root.querySelector('.hero-prim[data-stat="attack"] .hero-prim-value').textContent, String(hero.primary.attack + 2));
  // back to the backpack
  fire(heroScreen.current.arts.slotEl('right_hand', 0), 'click');
  fire(heroScreen.current.arts.backpackEls[0], 'click');
  assert.equal(hero.artifacts.backpack[0], 'centaurs_axe');
  // army split inside the hero
  const row = heroScreen.current.armyRow;
  fire(row.slotEls[0], 'click');
  fire(row.slotEls[4], 'click', { shiftKey: true });
  await tick(2);
  const split = topDialog();
  assert.match(split.textContent, /Split/);
  btnIn(split, 'OK').click();
  await tick(2);
  assert.equal(hero.army[0].count + hero.army[4].count, 10);
  noErrors(a);
});

test('hero screen for a hero of every class, prev / next hero, dismiss', async () => {
  const state = createTestState({ players: 2, seed: 3 });
  const ids = [];
  for (const cls of HERO_CLASSES) {
    const def = HEROES.find((d) => d.classId === cls.id && !d.special);
    if (!def) continue;
    if (state.players[0].heroes.length >= 8) state.players[0].heroes.length = 0;
    const h = heroEngine.addHero(state, def.id, 0, { x: 2, y: 2, z: 0 });
    giveArtifact(h, 'spellbook');
    ids.push(h.id);
  }
  const a = makeApp(state);
  for (const id of ids) {
    assert.equal(await a.showScreen('hero', { heroId: id }), true, id);
    assert.ok(a.layers.screen.querySelector('.hero-prim'));
    noErrors(a);
  }
  // prev/next within the current player's list
  const list = state.players[0].heroes;
  await a.showScreen('hero', { heroId: list[0] });
  heroScreen.current.buttons.next.click();
  await until(() => heroScreen.current && heroScreen.current.heroId === list[1]);
  // dismiss
  const victim = heroScreen.current.heroId;
  const p = heroScreen.current.dismiss();
  await tick(2);
  btnIn(topDialog(), 'Yes').click();
  await p;
  await until(() => !state.heroes[victim]);
  noErrors(a);
});

test('spell book: browse spells, read descriptions', async () => {
  const { state, hero } = setup();
  giveArtifact(hero, 'spellbook');
  heroEngine.learnSpell(state, hero.id, 'magic_arrow', { force: true });
  heroEngine.learnSpell(state, hero.id, 'view_air', { force: true });
  const a = makeApp(state);
  const p = openSpellbook(a.ctx, hero.id, { allowCast: false });
  const cards = topDialog().querySelectorAll('.k-book-spell');
  assert.equal(cards.length, 2);
  fire(cards.find((c) => c.dataset.spell === 'magic_arrow'), 'click');
  await tick(2);
  assert.match(topDialog().querySelector('.hero-book-info').textContent, /Magic Arrow/);
  ui.closeAllDialogs();
  assert.equal(await p, null);
});

test('level-up renderer resolves the pending with the picked skill', async () => {
  const { state, hero } = setup();
  const before = hero.skills.length;
  heroEngine.giveExperience(state, hero.id, 1000);
  const pending = state.pending.find((x) => x.kind === 'level_up');
  assert.ok(pending, 'a level-up choice is pending');
  const a = makeApp(state);
  await a.showScreen('hero', { heroId: hero.id });
  await until(() => a.layers.dialogs.querySelector('.hero-lvl'));
  const dlg = topDialog();
  assert.match(dlg.textContent, /has gained a level/);
  const choices = dlg.querySelectorAll('.hero-lvl-choice');
  assert.equal(choices.length, pending.options.length);
  const ok = btnIn(dlg, 'OK');
  if (choices.length > 1) assert.equal(ok.disabled, true, 'pick first');
  fire(choices[choices.length - 1], 'click');
  ok.click();
  await until(() => !state.pending.some((x) => x.id === pending.id));
  const picked = pending.options[pending.options.length - 1];
  assert.ok(hero.skills.some((s) => s.id === picked.skillId), 'skill learned');
  assert.ok(hero.skills.length >= before);
  noErrors(a);
});

// ---- hero exchange ---------------------------------------------------------------------------------

test('hero exchange: armies and artifacts both ways', async () => {
  const { state, hero } = setup();
  const def2 = HEROES.find((d) => d.faction === 'rampart' && !d.special);
  const other = heroEngine.addHero(state, def2.id, 0, { x: 6, y: 5, z: 0 });
  giveArtifact(hero, 'centaurs_axe');
  const a = makeApp(state);
  const p = openHeroTrade(a.ctx, hero.id, other.id);
  const [left, right] = p.sides;
  // move hero's slot 1 (archers) to other's slot 6
  fire(left.army.slotEls[1], 'click');
  fire(right.army.slotEls[6], 'click');
  await tick(2);
  assert.equal(hero.army[1], null);
  assert.equal(other.army[6].creatureId, 'archer');
  // artifact to the other hero's backpack
  fire(left.arts.slotEl('right_hand', 0), 'click');
  fire(right.arts.backpackEls[0], 'click');
  assert.equal(hero.artifacts.equipped.right_hand[0], null);
  assert.deepEqual(other.artifacts.backpack, ['centaurs_axe']);
  // and back into the first hero's paper doll
  assert.ok(artifactTradeAction({ grid: other.id, where: 'backpack', index: 0 }, { grid: hero.id, where: 'equipped', slot: 'right_hand', index: 0 })(state).ok);
  assert.equal(hero.artifacts.equipped.right_hand[0], 'centaurs_axe');
  btnIn(topDialog(), 'Done').click();
  await p;
  noErrors(a);
});

test('hero_exchange pending opens the exchange window', async () => {
  const { state, hero } = setup();
  const other = heroEngine.addHero(state, HEROES.find((d) => d.faction === 'tower' && !d.special).id, 0, { x: 6, y: 5, z: 0 });
  state.pending.push({ id: 99, kind: 'hero_exchange', playerId: 0, heroId: hero.id, options: [{ id: 'done', label: 'Done' }], data: { otherHeroId: other.id } });
  const { registerPendingHandler } = await import('../../src/engine/pending.js');
  registerPendingHandler('hero_exchange', () => ({ ok: true, events: [] }));
  const a = makeApp(state);
  const done = a.ctx.resolvePendings();
  await until(() => a.layers.dialogs.querySelector('.hero-trade'));
  btnIn(topDialog(), 'Done').click();
  assert.equal(await done, 1);
  assert.equal(state.pending.length, 0);
  noErrors(a);
});

// ---- kingdom ---------------------------------------------------------------------------------------

test('kingdom overview lists heroes, towns and income', async () => {
  const state = createTestState({ players: 2, seed: 5 });
  const t1 = townEngine.createTown(state, { faction: 'castle', owner: 0, pos: { x: 3, y: 3, z: 0 } });
  townEngine.createTown(state, { faction: 'inferno', owner: 0, pos: { x: 12, y: 12, z: 0 }, role: 'other' });
  townEngine.createTown(state, { faction: 'tower', owner: 1, pos: { x: 15, y: 3, z: 0 } });
  const h1 = heroEngine.addHero(state, HEROES.find((d) => d.faction === 'castle').id, 0, { x: 3, y: 3, z: 0 });
  heroEngine.addHero(state, HEROES.find((d) => d.faction === 'dungeon').id, 0, { x: 8, y: 9, z: 0 });
  heroEngine.addHero(state, HEROES.find((d) => d.faction === 'fortress').id, 0, { x: 1, y: 9, z: 0 });
  townEngine.visitTown(state, h1.id, t1.id);
  const a = makeApp(state);
  assert.equal(await a.showScreen('kingdom'), true);
  const root = a.layers.screen;
  assert.equal(root.querySelectorAll('.kng-hero').length, 3);
  assert.match(root.textContent, new RegExp(`In ${t1.name}`));
  kingdomScreen.current.tabs.select('towns');
  assert.equal(root.querySelectorAll('.kng-town').length, 2);
  kingdomScreen.current.tabs.select('income');
  assert.match(root.querySelector('.kng-table').textContent, /Towns/);
  assert.equal(kingdomScreen.current.overview().income.gold, 1000);
  // open a town from the list
  kingdomScreen.current.tabs.select('towns');
  btnIn(root.querySelector(`.kng-town[data-town="${t1.id}"]`), 'Open').click();
  await until(() => a.screen === 'town' && townScreen.current);
  assert.equal(townScreen.current.townId, t1.id);
  // next town from there
  townScreen.current.buttons.next.click();
  await until(() => townScreen.current && townScreen.current.townId !== t1.id);
  noErrors(a);
});

test('with the real gfx module the town view uses getTownLayout and the backdrop sprite', async () => {
  const sprites = await import('../../src/ui/sprites.js');
  let gfx = null;
  try { gfx = await import('../../src/gfx/index.js'); } catch { /* gfx not available in this build */ }
  if (!gfx || typeof gfx.getTownLayout !== 'function') return;
  sprites.setGfx(gfx);
  try {
    for (const faction of ['castle', 'factory', 'cove']) {
      const { state, town } = setup({ faction, buildings: allBuildings(faction) });
      const a = makeApp(state);
      await a.showScreen('town', { townId: town.id });
      const layout = gfx.getTownLayout(faction);
      const fortEl = a.layers.screen.querySelector('.town-bld[data-building="castle"]');
      assert.equal(fortEl.style.left, `${layout.castle.x}px`);
      assert.ok(a.layers.screen.querySelector('.town-backdrop-img'));
      noErrors(a);
      await a.destroy();
      app = null;
    }
  } finally {
    sprites.setGfx(null);
  }
});
