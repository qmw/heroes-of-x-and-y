// Campaign screens (src/ui/screens/campaign): select, briefing, launch, victory / defeat routing,
// progress through the UI storage API.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, createFakeStorage, tick, until } from './fakeDom.js';

installFakeDom();
const { createApp } = await import('../../src/ui/app.js');
const ui = await import('../../src/ui/kit/index.js');
const game = await import('../../src/engine/game.js');
const M = await import('../../src/ui/screens/campaign/model.js');
const C = await import('../../src/engine/campaign/index.js');
const { createStorage } = await import('../../src/ui/storage.js');

let app = null;
const quiet = async (fn) => {
  const saved = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};
function makeApp() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const seen = { adventure: [] };
  app = createApp(root, {
    storageBackend: createFakeStorage(),
    gfxLoader: async () => { throw new Error('no gfx'); },
    importer: async (path) => {
      if (path.endsWith('/game.js')) return game;
      throw new Error(`Cannot find module ${path}`);
    },
    screens: { adventure: { mount: (r, ctx, p) => { seen.adventure.push(p); }, unmount() {} } },
  });
  app.seen = seen;
  return app;
}
afterEach(async () => { ui.closeAllDialogs(); game.setAiDriver(null); if (app) await quiet(() => app.destroy()); app = null; });
const btn = (root, label) => root.querySelectorAll('.k-btn').find((b) => b.textContent.includes(label));
const dlgButton = (label) => document.body.querySelectorAll('.k-dlg .k-btn').find((b) => b.textContent.includes(label));

test('model: progress persists through the storage data API; cards and briefings', () => {
  const storage = createStorage({ backend: createFakeStorage() });
  assert.equal(M.loadProgress(storage, 'long_winter'), null);
  const p = C.createCampaignProgress('long_winter');
  assert.ok(M.saveProgress(storage, p).ok);
  assert.deepEqual(M.loadProgress(storage, 'long_winter'), p);
  storage.writeData(M.dataKey('long_winter'), { junk: true });
  assert.equal(M.loadProgress(storage, 'long_winter'), null, 'garbage is ignored');
  M.clearProgress(storage, 'long_winter');
  assert.equal(storage.readData(M.dataKey('long_winter')), null);

  const card = M.cardModel(C.getCampaign('iron_and_steam'), null);
  assert.equal(card.status, 'Not started');
  assert.equal(card.length, 3);
  const prog = { ...C.createCampaignProgress('iron_and_steam'), available: ['sandsea', 'ashrun'], completed: [{ scenarioId: 'cog_valley', days: 30 }] };
  const c2 = M.cardModel(C.getCampaign('iron_and_steam'), prog);
  assert.equal(c2.status, 'Scenario 2 of 3');
  assert.deepEqual(c2.scenarios.map((s) => s.state), ['done', 'next', 'next', 'locked']);
  const b = M.briefingModel(prog, 'ashrun');
  assert.equal(b.title, 'The Siege of Ashrun');
  assert.equal(b.index, 2);
  assert.equal(b.bonuses.length, 3);
  assert.match(b.victory, /Nymus/);
  assert.deepEqual(M.carriedHeroLines(prog), []);
  const withHero = { ...prog, hero: { defId: 'henrietta', level: 5, exp: 5000, primary: { attack: 3, defense: 2, power: 1, knowledge: 1 }, skills: [{ id: 'archery', level: 2 }], spells: ['haste'], artifacts: ['boots_of_speed'], army: [{ creatureId: 'automaton', count: 3 }] } };
  const lines = M.carriedHeroLines(withHero).join('\n');
  assert.match(lines, /level 5/);
  assert.match(lines, /Advanced Archery/);
  assert.match(lines, /Haste/);
  assert.match(lines, /Boots of Speed/);
  assert.match(lines, /3 Automaton/);
  // map preview paints without throwing
  const cv = document.createElement('canvas');
  M.drawBlueprintPreview(cv.getContext('2d'), C.buildCampaignMap('iron_ashrun'), 216, 216);
});

test('main menu has a Campaigns entry', async () => {
  const a = makeApp();
  await a.start('mainMenu');
  btn(a.layers.screen, 'Campaigns').click();
  await until(() => a.screen === 'campaigns' && a.layers.screen.querySelector('.cmp-card'));
  assert.equal(a.layers.screen.querySelectorAll('.cmp-card').length, C.CAMPAIGNS.length);
});

test('select -> difficulty -> briefing -> bonus -> Begin starts the adventure with the campaign hero', async () => {
  const a = makeApp();
  await a.start('campaigns');
  const screen = a.layers.screen;
  const cards = screen.querySelectorAll('.cmp-card');
  assert.equal(cards.length, 3);
  assert.match(cards[1].textContent, /Iron and Steam/);
  assert.match(cards[1].textContent, /Not started/);
  btn(cards[1], 'Start').click();
  await tick(1);
  const choices = document.body.querySelectorAll('.k-choice');
  assert.equal(choices.length, C.CAMPAIGN_DIFFICULTIES.length);
  choices.find((c) => /Hard/.test(c.textContent)).click();
  await until(() => a.screen === 'campaignBriefing' && a.layers.screen.querySelector('.cmp-bonus'));
  const brief = a.layers.screen;
  assert.match(brief.textContent, /Cog Valley/);
  assert.match(brief.textContent, /Capture Brasswick/);
  assert.match(brief.textContent, /scenario 1 of 3/);
  assert.ok(brief.querySelector('.cmp-map canvas'), 'map preview');
  const bonuses = brief.querySelectorAll('.cmp-bonus');
  assert.equal(bonuses.length, 3);
  bonuses[1].click();
  assert.ok(a.layers.screen.querySelectorAll('.cmp-bonus')[1].classList.contains('is-selected'));
  const stored = a.ctx.storage.readData('campaign.iron_and_steam');
  assert.equal(stored.difficulty, 2);

  btn(a.layers.screen, 'Begin').click();
  await until(() => a.screen === 'adventure', 4000);
  assert.deepEqual(a.seen.adventure, [{ newGame: true }]);
  const st = a.ctx.state;
  assert.equal(st.meta.campaign.campaignId, 'iron_and_steam');
  assert.equal(st.meta.campaign.scenarioId, 'cog_valley');
  assert.equal(st.settings.difficulty, 2);
  const hero = Object.values(st.heroes).find((h) => h.defId === 'henrietta');
  assert.equal(hero.owner, 0);
  assert.ok(JSON.stringify(hero.artifacts).includes('equestrians_gloves'), 'the chosen bonus');
});

test('victory routes back to the campaign: outro, branch choice, carried hero in the next briefing', async () => {
  const a = makeApp();
  const progress = C.createCampaignProgress('iron_and_steam');
  M.saveProgress(a.ctx.storage, progress);
  const res = await M.launchScenario(a.ctx, progress, 0);
  assert.ok(res.ok, res.error);
  const st = res.state;
  const hero = Object.values(st.heroes).find((h) => h.defId === 'henrietta');
  hero.level = 6;
  st.gameOver = { winner: 0, winners: [0], reason: 'capture_town', turn: 20, score: 150 };
  a.ctx.setState(st, { silent: true });
  await a.start('campaignBriefing', { campaignId: 'iron_and_steam', after: true });
  await until(() => document.body.querySelector('.k-dlg'));
  assert.match(document.body.querySelector('.k-dlg').textContent, /Victory - Cog Valley/);
  assert.match(document.body.querySelector('.k-dlg').textContent, /wheels of Brasswick/);
  ui.closeTopDialog();
  await until(() => a.layers.screen.querySelectorAll('.cmp-choice').length === 2);
  assert.match(a.layers.screen.textContent, /two contracts/);
  const saved = a.ctx.storage.readData('campaign.iron_and_steam');
  assert.deepEqual(saved.available, ['sandsea', 'ashrun']);
  assert.equal(saved.hero.level, 6);
  assert.equal(st.meta.campaign.recorded, true, 'recorded once');
  btn(a.layers.screen, 'Choose The Siege of Ashrun').click();
  await tick(1);
  assert.match(a.layers.screen.textContent, /The Siege of Ashrun/);
  assert.match(a.layers.screen.textContent, /Henrietta, level 6/);
  assert.ok(btn(a.layers.screen, 'Other mission'), 'the branch can be changed');
  // choose what the hero takes along: drop the default pick, keep nothing but one stack
  btn(a.layers.screen, 'Choose items').click();
  await until(() => document.body.querySelector('.cmp-pick'));
  for (const el of document.body.querySelectorAll('.cmp-pick.is-selected')) el.click();
  assert.equal(document.body.querySelectorAll('.cmp-pick.is-selected').length, 0);
  const firstArmy = document.body.querySelectorAll('.cmp-pick').find((e) => e.dataset.kind === 'army');
  if (firstArmy) firstArmy.click();
  dlgButton('OK').click();
  await tick(2);
  const chosen = a.ctx.storage.readData('campaign.iron_and_steam').hero;
  assert.equal(chosen.artifacts.length, 0);
  assert.equal(chosen.army.length, firstArmy ? 1 : 0);
  assert.match(a.layers.screen.textContent, /The Siege of Ashrun/, 'back on the briefing');
  // re-entering the briefing does not record the same game twice
  await a.showScreen('campaignBriefing', { campaignId: 'iron_and_steam', after: true });
  await tick(2);
  assert.equal(a.ctx.storage.readData('campaign.iron_and_steam').completed.length, 1);
});

test('defeat offers Retry (same scenario) or Campaigns; a finished campaign shows its summary', async () => {
  const a = makeApp();
  const progress = C.createCampaignProgress('long_winter');
  M.saveProgress(a.ctx.storage, progress);
  const res = await M.launchScenario(a.ctx, progress, 2);
  res.state.gameOver = { winner: 1, winners: [1], reason: 'lost_town', turn: 12, score: 0 };
  a.ctx.setState(res.state, { silent: true });
  await a.start('campaignBriefing', { campaignId: 'long_winter', after: true });
  await until(() => dlgButton('Retry'));
  assert.match(document.body.querySelector('.k-dlg').textContent, /Defeat - Frostmarch/);
  dlgButton('Retry').click();
  await until(() => a.layers.screen.querySelector('.cmp-bonus'));
  assert.match(a.layers.screen.textContent, /Frostmarch/);
  assert.equal(a.ctx.storage.readData('campaign.long_winter').attempts.frostmarch, 1);

  // a completed campaign
  const done = { ...progress, status: 'complete', available: [], completed: [{ scenarioId: 'frostmarch', days: 40, score: 100 }, { scenarioId: 'dawn_chapel', days: 50, score: 120 }, { scenarioId: 'thaw', days: 70, score: 140 }] };
  M.saveProgress(a.ctx.storage, done);
  await a.showScreen('campaignBriefing', { campaignId: 'long_winter' });
  await until(() => a.layers.screen.querySelector('.cmp-complete'));
  assert.match(a.layers.screen.textContent, /The Thaw/);
  await a.showScreen('campaigns');
  const card = a.layers.screen.querySelectorAll('.cmp-card')[2];
  assert.match(card.textContent, /Completed/);
  assert.ok(btn(card, 'Play again'));
});

test('briefing of an unknown or unstarted campaign degrades gracefully', async () => {
  const a = makeApp();
  await a.start('campaignBriefing', { campaignId: 'nope' });
  assert.match(a.layers.screen.textContent, /Unknown campaign/);
  await a.showScreen('campaignBriefing', { campaignId: 'saltwind_charter' });
  await tick(2);
  assert.match(a.layers.screen.textContent, /not been started/);
});
