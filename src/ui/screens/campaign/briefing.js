// Campaign briefing screen ('campaignBriefing'), params { campaignId, scenarioId?, after? }.
// Shows the next scenario (or the branch choice): story text, victory / loss conditions, a map
// preview, the hero carried over and the starting bonus choice; Begin launches the adventure.
// With `after: true` (set by the adventure screen when a campaign game ends) the finished game in
// ctx.state is recorded first: victory -> outro text and the next briefing, defeat -> Retry / Back.
import * as C from '../../../engine/campaign/index.js';
import * as M from './model.js';
import { injectCampaignCss } from './css.js';

let alive = false;

export function mount(root, ctx, params = {}) {
  const { ui } = ctx;
  const { h } = ui;
  injectCampaignCss();
  alive = true;
  const campaignId = params.campaignId;
  const campaign = C.CAMPAIGN_BY_ID[campaignId];
  const body = h('div.cmp-brief');
  root.appendChild(h('div.cmp', null, body));
  ctx.keys.bind('escape', () => ctx.showScreen('campaigns'), 'Back to the campaigns');
  if (!campaign) {
    ui.clear(body, ui.Panel({ title: 'Unknown campaign' }, h('p', null, `There is no campaign "${campaignId}".`),
      ui.Button('Campaigns', { onClick: () => ctx.showScreen('campaigns') })));
    return { ready: Promise.resolve() };
  }
  let progress = M.loadProgress(ctx.storage, campaignId);
  let selected = params.scenarioId || null;
  let bonusIndex = 0;
  let launching = false;

  const ready = (async () => {
    if (params.after) await recordFinishedGame();
    if (!alive || ctx.screen !== 'campaignBriefing') return;
    render();
  })();

  async function recordFinishedGame() {
    const st = ctx.state;
    const meta = st && st.meta && st.meta.campaign;
    if (!meta || meta.campaignId !== campaignId || meta.recorded) return;
    if (!progress) progress = C.createCampaignProgress(campaignId);
    const scenario = C.getScenario(campaign, meta.scenarioId);
    const won = C.isCampaignVictory(st);
    progress = C.completeScenario(progress, st);
    meta.recorded = true;
    M.saveProgress(ctx.storage, progress);
    if (won) {
      await ui.message(h('div.cmp-outro', null, scenario.outro.split(/\n\n+/).map((p) => h('p', null, p))),
        { title: `Victory - ${scenario.title}` });
      selected = null;
    } else {
      const d = ui.openDialog({
        title: `Defeat - ${scenario.title}`,
        content: h('div.cmp-outro', null, h('p', null, 'The scenario is lost. Your hero returns as before the scenario began.')),
        buttons: [{ label: 'Retry', value: 'retry', kind: 'primary', default: true }, { label: 'Campaigns', value: 'back', cancel: true }],
        cancelValue: 'back', width: 460,
      });
      const v = await d.result;
      if (v === 'back') { ctx.showScreen('campaigns'); alive = false; return; }
      selected = meta.scenarioId;
    }
  }

  function render() {
    if (!progress) {
      ui.clear(body, ui.Panel({ title: campaign.title }, h('p', null, 'This campaign has not been started yet.'),
        h('div.k-row', null, ui.Button('Campaigns', { onClick: () => ctx.showScreen('campaigns') }))));
      return;
    }
    if (progress.status === 'complete') return renderComplete();
    const avail = progress.available;
    if (selected && !avail.includes(selected)) selected = null;
    if (!selected && avail.length === 1) selected = avail[0];
    if (!selected) return renderChoice();
    renderBriefing();
  }

  function renderComplete() {
    ui.clear(body, ui.Panel({ title: `${campaign.title} - complete`, class: 'cmp-complete' },
      h('p', null, 'The campaign is won. These were your victories:'),
      h('table.cmp-table', null, progress.completed.map((x) => h('tr', null,
        h('td', null, C.getScenario(campaign, x.scenarioId).title), h('td', null, `day ${x.days}`), h('td', null, x.score != null ? `score ${x.score}` : '')))),
      M.carriedHeroLines(progress).map((l) => h('div.cmp-hero-line', null, l)),
      h('div.k-row', null, ui.Button('Campaigns', { kind: 'primary', hotkey: 'Enter', onClick: () => ctx.showScreen('campaigns') }))));
    ctx.keys.bind('enter', () => ctx.showScreen('campaigns'), 'Campaigns');
  }

  function renderChoice() {
    const last = progress.completed.length ? C.getScenario(campaign, progress.completed[progress.completed.length - 1].scenarioId) : null;
    const text = (last && last.choiceText) || 'Choose your next mission.';
    ui.clear(body,
      h('div.cmp-heading', null, campaign.title),
      h('div.cmp-sub', null, text),
      h('div.cmp-choices', null, progress.available.map((id) => {
        const s = C.getScenario(campaign, id);
        const info = C.campaignMapInfo(s.map);
        return h('div.cmp-choice', { dataset: { scenario: id } },
          h('div.cmp-card-title', null, s.title),
          h('div.cmp-card-desc', null, s.intro.split(/\n\n+/)[0]),
          h('div.cmp-cond', null, info.victoryText),
          ui.Button(`Choose ${s.title}`, { kind: 'primary', onClick: () => { selected = id; bonusIndex = 0; render(); } }));
      })),
      h('div.cmp-bottom', null, ui.Button('Back', { onClick: () => ctx.showScreen('campaigns') })));
  }

  function renderBriefing() {
    const m = M.briefingModel(progress, selected);
    const preview = ui.createCanvas(216, 216, { class: 'cmp-preview' });
    try {
      const bp = C.buildCampaignMap(m.map);
      M.drawBlueprintPreview(preview.ctx, bp, 216, 216);
    } catch (err) { ctx.log(`Map preview failed: ${err.message}`, 'warn'); }
    const bonusRow = h('div.cmp-bonuses');
    const renderBonuses = () => ui.clear(bonusRow, m.bonuses.map((b) => {
      const el = h(`button.cmp-bonus${b.index === bonusIndex ? '.is-selected' : ''}`, { type: 'button', dataset: { bonus: b.index } },
        ctx.sprite(b.icon.kind, b.icon.id, { size: 40 }), h('span', null, b.text));
      el.addEventListener('click', () => { bonusIndex = b.index; renderBonuses(); });
      return el;
    }));
    renderBonuses();
    const begin = ui.Button('Begin', { kind: 'primary', size: 'lg', hotkey: 'Enter', onClick: () => start() });
    const branch = progress.available.length > 1
      ? ui.Button('Other mission', { onClick: () => { selected = null; render(); } }) : null;
    ui.clear(body,
      h('div.cmp-heading', null, m.title),
      h('div.cmp-sub', null, `${m.campaignTitle} - scenario ${m.index} of ${m.length}`),
      h('div.cmp-cols', null,
        ui.Panel({ title: 'Briefing', variant: 'parchment', class: 'cmp-story' },
          m.intro.map((p) => h('p', null, p)),
          ui.Field('Victory', h('div.cmp-cond', null, m.victory)),
          ui.Field('Defeat', h('div.cmp-cond', null, m.loss))),
        h('div.cmp-side', null,
          ui.Panel({ title: 'Map', class: 'cmp-map' }, preview.canvas,
            h('div.cmp-small', null, `${m.size} - ${m.width} x ${m.height} - ${m.players} players`)),
          ui.Panel({ title: 'Your hero', class: 'cmp-hero' },
            m.carried.length ? m.carried.map((l) => h('div.cmp-hero-line', null, l))
              : h('div.cmp-hero-line', null, `${M.cardModel(campaign, progress).heroName} begins the campaign fresh.`),
            h('div.cmp-small', null, `Carried over: level, skills, spells, up to ${campaign.carryOver.artifacts} artifacts`
              + `${campaign.carryOver.creatureStacks ? `, ${campaign.carryOver.creatureStacks} troop stacks` : ''}.`),
            M.canChooseCarry(progress) ? h('div.k-row.cmp-carry-row', null, ui.Button('Choose items', { size: 'sm', onClick: () => chooseCarry() })) : null))),
      ui.Panel({ title: 'Starting bonus', class: 'cmp-bonus-panel' }, bonusRow),
      h('div.cmp-bottom', null, ui.Button('Back', { onClick: () => ctx.showScreen('campaigns') }), branch, begin));
    ctx.keys.bind('enter', () => start(), 'Begin');
  }

  /** Dialog: which artifacts / troops the hero takes along (up to the campaign's limits). */
  async function chooseCarry() {
    const opts = progress.hero.options;
    const cur = C.carryChoiceIndices(progress);
    const sel = { artifacts: new Set(cur.artifacts), army: new Set(cur.army) };
    const max = { artifacts: opts.limits.artifacts, army: opts.limits.stacks };
    const sections = h('div.cmp-carry');
    const count = h('div.cmp-small');
    const draw = () => {
      ui.clear(sections, ['artifacts', 'army'].map((kind) => {
        const list = opts[kind];
        if (!list.length) return null;
        return h('div.cmp-carry-section', null,
          h('div.cmp-carry-title', null, `${kind === 'artifacts' ? 'Artifacts' : 'Troops'} (${sel[kind].size} / ${max[kind]})`),
          h('div.cmp-carry-list', null, list.map((item, i) => {
            const label = M.carryItemLabel(kind, item);
            const icon = kind === 'artifacts' ? { kind: 'artifact', id: typeof item === 'string' ? item : item.id } : { kind: 'creature', id: item.creatureId };
            const el = h(`button.cmp-pick${sel[kind].has(i) ? '.is-selected' : ''}`, { type: 'button', dataset: { kind, index: i } },
              ctx.sprite(icon.kind, icon.id, { size: 32 }), h('span', null, label));
            el.addEventListener('click', () => {
              if (sel[kind].has(i)) sel[kind].delete(i);
              else if (sel[kind].size < max[kind]) sel[kind].add(i);
              else { ctx.toast(`At most ${max[kind]} ${kind === 'artifacts' ? 'artifacts' : 'troop stacks'}.`, 'warn'); return; }
              draw();
            });
            return el;
          })));
      }));
      count.textContent = 'Click to take or leave an item.';
    };
    draw();
    const d = ui.openDialog({
      title: 'What does the hero take along?', content: h('div', null, sections, count), width: 640, class: 'cmp-carry-dlg',
      buttons: [{ label: 'Cancel', value: false, cancel: true }, { label: 'OK', value: true, kind: 'primary', default: true }],
      cancelValue: false,
    });
    if (!(await d.result)) return;
    progress = C.setCarryChoice(progress, { artifacts: [...sel.artifacts], army: [...sel.army] });
    M.saveProgress(ctx.storage, progress);
    if (alive && ctx.screen === 'campaignBriefing') render();
  }

  async function start() {
    if (launching || !selected) return;
    launching = true;
    try {
      const res = await M.launchScenario(ctx, progress, bonusIndex, selected);
      if (!res.ok) {
        ctx.log(`Campaign launch failed: ${res.error}`, 'error');
        await ui.message(`The scenario could not be started:\n${res.error}`, { title: 'Could not start' });
        return;
      }
      ctx.setState(res.state, { silent: true });
      ctx.audio.play('daystart');
      await ctx.showScreen('adventure', { newGame: true });
    } finally {
      launching = false;
    }
  }

  return { ready, start, get progress() { return progress; } };
}

export function unmount() { alive = false; }
