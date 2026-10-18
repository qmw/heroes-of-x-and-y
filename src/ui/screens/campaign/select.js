// Campaign select screen ('campaigns'): one card per campaign with its hero, description,
// scenario track and progress; Start / Continue / Restart. Model: model.js.
import * as C from '../../../engine/campaign/index.js';
import * as M from './model.js';
import { injectCampaignCss } from './css.js';

export function mount(root, ctx) {
  const { ui } = ctx;
  const { h } = ui;
  injectCampaignCss();
  const grid = h('div.cmp-grid');
  root.appendChild(h('div.cmp', null,
    h('div.cmp-heading', null, 'Campaigns'),
    h('div.cmp-sub', null, 'Story campaigns: your hero keeps experience, skills, spells and the best artifacts from one scenario to the next.'),
    grid,
    h('div.cmp-bottom', null, ui.Button('Back', { hotkey: 'Esc', onClick: () => ctx.showScreen('mainMenu') }))));
  ctx.keys.bind('escape', () => ctx.showScreen('mainMenu'), 'Back');

  function render() {
    ui.clear(grid, C.CAMPAIGNS.map((c) => card(c)));
  }

  function card(c) {
    const progress = M.loadProgress(ctx.storage, c.id);
    const m = M.cardModel(c, progress);
    const bar = ui.ProgressBar({ value: m.ratio * 100, max: 100, label: m.status, color: 'exp' });
    const track = h('div.cmp-track', null, m.scenarios.map((s) => h(`div.cmp-step.is-${s.state}`, { title: s.title },
      h('span.cmp-step-dot', null, s.state === 'done' ? '✓' : s.state === 'next' ? '▶' : ''), h('span', null, s.title))));
    const buttons = [];
    if (!m.started) buttons.push(ui.Button('Start', { kind: 'primary', onClick: () => startNew(c) }));
    else if (!m.complete) {
      buttons.push(ui.Button('Continue', { kind: 'primary', onClick: () => ctx.showScreen('campaignBriefing', { campaignId: c.id }) }));
      buttons.push(ui.Button('Restart', { kind: 'danger', onClick: () => restart(c) }));
    } else buttons.push(ui.Button('Play again', { onClick: () => restart(c) }));
    return h('div.cmp-card', { dataset: { campaign: c.id } },
      h('div.cmp-card-head', null,
        ctx.sprite('portrait', c.heroDefId, { size: 58 }),
        h('div', null, h('div.cmp-card-title', null, m.title), h('div.cmp-card-hero', null, `${m.heroName} - ${m.length} scenarios - ${cap(m.difficulty)}`))),
      h('div.cmp-card-desc', null, m.description),
      track, bar,
      h('div.k-row.cmp-card-buttons', null, buttons));
  }

  async function pickDifficulty(c) {
    const def = C.CAMPAIGN_DIFFICULTIES.find((d) => d.id === (M.defaultDifficulty(c))) || C.CAMPAIGN_DIFFICULTIES[1];
    const v = await ui.choose({
      title: c.title, text: 'Choose the difficulty of this campaign.', cancellable: true, columns: 4,
      options: C.CAMPAIGN_DIFFICULTIES.map((d) => ({ label: `${d.name} (${d.percent}%)`, value: d.id, description: d.id === def.id ? 'Recommended' : '' })),
    });
    return v;
  }

  async function startNew(c) {
    const diff = await pickDifficulty(c);
    if (diff == null) return;
    const progress = C.createCampaignProgress(c.id, { difficulty: diff });
    const res = M.saveProgress(ctx.storage, progress);
    if (!res.ok) ctx.toast('Campaign progress cannot be stored in this browser - it lasts for this session only.', 'warn');
    ctx.showScreen('campaignBriefing', { campaignId: c.id });
  }

  async function restart(c) {
    const ok = await ui.confirm(`Start "${c.title}" from the beginning? The current progress is lost.`, { danger: true });
    if (!ok) return;
    M.clearProgress(ctx.storage, c.id);
    await startNew(c);
    if (ctx.screen === 'campaigns') render();
  }

  render();
  return { render };
}

export function unmount() {}

const cap = (s) => String(s || '').replace(/^\w/, (m) => m.toUpperCase());
