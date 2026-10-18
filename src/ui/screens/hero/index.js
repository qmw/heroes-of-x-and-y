// Hero screen. params: { heroId, allowCast?: boolean (default true), onSpell?: (outcome) => void }
// Portrait, name, class, level / experience, primary skills with bonus breakdowns, morale & luck
// breakdowns, mana, specialty, 8 secondary skills, artifact paper doll + backpack (equip / unequip /
// move / assemble / disassemble), army (split / merge / move / dismiss), spell book, quest log,
// dismiss hero, previous / next hero.
import { dismissHero, tradeArmy, dismissStack, getSpecialtyUpgrades, specialtyUpgrade } from '../../../engine/hero.js';
import { getMaxMana, getArmyMoraleDetails, getArmyLuckDetails, getManaRegen, getMaxMovePoints } from '../../../engine/bonuses.js';
import { assemble, disassemble, hasArtifact, getAssemblableCombos } from '../../../engine/artifacts.js';
import { ARTIFACT_BY_ID } from '../../../data/artifacts.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { PRIMARY_SKILLS } from '../../../core/constants.js';
import './levelUp.js';
import '../dialogs/heroTrade.js';
import {
  primaryBreakdown, primaryTooltip, moraleLines, expInfo, heroTitle, specialtyText, skillSlots, skillTooltip,
  moveArtifact, engineRef, combosFor, questLog, playerHeroIds, PRIMARY_NAMES,
} from './heroModel.js';
import { act, ensureDialogCss } from '../town/dialogUtil.js';
import { cycle, currentPlayer } from '../town/townModel.js';
import { openSpellbook } from '../dialogs/spellbook.js';

let cleanup = [];
export let current = null;

export function mount(root, ctx, params = {}) {
  const { ui } = ctx;
  const { h } = ui;
  ensureDialogCss(ui);
  const heroId = params.heroId || (ctx.state && currentPlayer(ctx.state) && currentPlayer(ctx.state).heroes[0]);
  if (!ctx.state || !heroId || !ctx.state.heroes[heroId]) {
    root.appendChild(h('div.hero-missing', null, ui.Panel({ title: 'Hero', variant: 'parchment' },
      h('p', null, ctx.state ? 'There is no such hero.' : 'No game in progress.'),
      ui.Button('Back', { kind: 'primary', onClick: () => ctx.back() }))));
    ctx.keys.bind('escape', () => ctx.back(), 'Back');
    return;
  }
  const hero = () => ctx.state.heroes[heroId];
  const owned = () => {
    const p = currentPlayer(ctx.state);
    return !!p && hero() && hero().owner === p.id;
  };

  // ---- skeleton --------------------------------------------------------------------------------
  const head = h('div.hero-head');
  const primaryEl = h('div.hero-primary');
  const statsEl = h('div.hero-stats');
  const skillsEl = h('div.hero-skills');
  const artSel = ui.createArtifactSelection();
  const arts = ui.ArtifactGrid({
    id: heroId, artifacts: hero().artifacts, selection: artSel, slotSize: 54, backpackVisible: 8,
    onMove: (from, to) => { if (owned()) act(ctx, () => moveArtifact(hero(), from, to)); },
    onActivate: (ref, entry) => artifactMenu(ref, entry),
  });
  const armySel = ui.createArmySelection();
  const armyRow = ui.ArmyRow({
    id: 'hero', army: hero().army, selection: armySel, size: 88,
    onMove: (from, to, count) => { if (owned()) act(ctx, (s) => tradeArmy(s, heroId, from, heroId, to, count)); },
    onInfo: (slot) => stackWindow(slot),
  });
  const btn = {};
  const mk = (key, label, opts) => (btn[key] = ui.Button(label, { class: `hero-btn-${key}`, ...opts }));
  const buttons = h('div.hero-buttons', null,
    mk('book', 'Spell book', { hotkey: 'C', onClick: () => castOrBrowse(), tooltip: 'Open the spell book (C)' }),
    mk('quests', 'Quest log', { hotkey: 'Q', onClick: () => showQuests(), tooltip: 'Quests you have seen (Q)' }),
    mk('assemble', 'Assemble', { onClick: () => assembleMenu(), tooltip: 'Assemble a combination artifact' }),
    mk('dismissStack', 'Dismiss stack', { onClick: () => dismissSelected(), tooltip: 'Dismiss the selected stack' }),
    mk('dismiss', 'Dismiss hero', { kind: 'danger', onClick: () => dismiss(), tooltip: 'Dismiss this hero for good' }),
    mk('prev', '< Hero', { onClick: () => switchHero(-1), tooltip: 'Previous hero (Left)' }),
    mk('next', 'Hero >', { onClick: () => switchHero(1), tooltip: 'Next hero (Right)' }),
    mk('close', 'Close', { kind: 'primary', hotkey: 'Esc', onClick: () => ctx.back('adventure') }));

  const el = h('div.hero', { dataset: { hero: heroId } },
    h('div.hero-left', null, head, primaryEl, statsEl, h('div.hero-skills-title', null, 'Secondary skills'), skillsEl),
    h('div.hero-right', null, h('div.hero-arts', null, arts), h('div.hero-army', null, h('div.hero-army-title', null, 'Army'), armyRow), buttons));
  root.appendChild(el);

  // ---- rendering -------------------------------------------------------------------------------
  function render() {
    const hr = hero();
    if (!hr) return;
    const s = ctx.state;
    const owner = hr.owner != null ? s.players[hr.owner] : null;
    const xp = expInfo(hr);
    ui.clear(head,
      ui.HeroPortrait({ hero: hr, size: 96, playerColor: owner ? owner.color : undefined }),
      h('div.hero-head-text', null,
        h('div.hero-name', null, hr.name),
        h('div.hero-title', null, heroTitle(hr)),
        h('div.hero-spec', null, h('b', null, 'Specialty: '), specialtyText(hr)),
        ui.ProgressBar({ value: xp.exp - xp.from, max: Math.max(1, xp.to - xp.from), color: 'exp',
          label: xp.max ? `Experience ${hr.exp} (max level)` : `Experience ${hr.exp} / ${xp.to}` })));
    const pb = primaryBreakdown(s, hr);
    ui.clear(primaryEl, PRIMARY_SKILLS.map((stat) => {
      const b = pb[stat];
      const cell = h('div.hero-prim', { dataset: { stat }, class: b.total > b.base ? 'is-up' : b.total < b.base ? 'is-down' : '' },
        h('div.hero-prim-name', null, PRIMARY_NAMES[stat]),
        ctx.sprite('ui', `stat_${stat}`, { size: 44 }),
        h('div.hero-prim-value', null, String(b.total)));
      ui.attachTooltip(cell, () => primaryTooltip(stat, b));
      return cell;
    }));
    const md = getArmyMoraleDetails(s, { hero: hr });
    const ld = getArmyLuckDetails(s, { hero: hr });
    const maxMana = getMaxMana(s, hr);
    const ml = ui.MoraleLuckPips({ morale: md.value, luck: ld.value, moraleDetails: moraleLines(md), luckDetails: moraleLines(ld) });
    const manaBar = ui.ProgressBar({ value: hr.mana, max: Math.max(1, maxMana), color: 'mana', label: `Spell points ${hr.mana} / ${maxMana}` });
    ui.attachTooltip(manaBar, `Spell points: ${hr.mana} / ${maxMana}\nRegeneration: ${getManaRegen(s, hr)} per day`);
    const moveBar = ui.ProgressBar({ value: hr.movePoints, max: Math.max(1, hr.maxMovePoints || getMaxMovePoints(s, hr)), color: 'move', label: `Movement ${hr.movePoints} / ${hr.maxMovePoints}` });
    ui.clear(statsEl, ml, manaBar, moveBar);
    ui.clear(skillsEl, skillSlots(hr).map((sk, i) => {
      if (!sk) return h('div.hero-skill.is-empty', { dataset: { index: i } }, h('span', null, 'Empty'));
      const icon = ui.SkillIcon({ id: sk.id, level: sk.level, size: 48, showLabel: true });
      const cell = h('div.hero-skill', { dataset: { index: i, skill: sk.id } }, icon);
      ui.attachTooltip(cell, () => skillTooltip(sk.id, sk.level));
      ui.attachInfo(cell, () => h('div.hero-skill-info', null, ...skillTooltip(sk.id, sk.level).split('\n').map((l) => h('p', null, l))));
      return cell;
    }));
    arts.update(hr.artifacts);
    armyRow.update(hr.army);
    const mine = owned();
    btn.book.setDisabled(!hasArtifact(hr, 'spellbook'));
    btn.assemble.setDisabled(!mine || getAssemblableCombos(hr).length === 0);
    btn.dismiss.setDisabled(!mine);
    btn.dismissStack.setDisabled(!mine);
    const list = owner ? playerHeroIds(s, owner.id) : [];
    btn.prev.setDisabled(list.length < 2);
    btn.next.setDisabled(list.length < 2);
  }

  // ---- actions ---------------------------------------------------------------------------------
  async function artifactMenu(ref, entry) {
    if (!owned()) return;
    const hr = hero();
    const id = typeof entry === 'string' ? entry : entry && entry.id;
    const def = ARTIFACT_BY_ID[id];
    if (!def) return;
    if (def.components) {
      if (await ui.confirm(`Disassemble ${def.name} into its ${def.components.length} parts?`, { title: def.name })) {
        act(ctx, () => disassemble(hero(), engineRef(ref)));
      }
      return;
    }
    const combos = combosFor(hr, id);
    if (combos.length) {
      const pick = await ui.choose({
        title: 'Assemble', text: `${def.name} is part of a combination you can assemble.`, cancellable: true,
        options: combos.map((c) => ({ label: ARTIFACT_BY_ID[c].name, icon: { kind: 'artifact', id: c }, description: ARTIFACT_BY_ID[c].description, value: c })),
      });
      if (pick) act(ctx, () => assemble(hero(), pick));
      return;
    }
    ui.message(ui.ArtifactInfo(entry), { title: def.name });
  }

  async function assembleMenu() {
    const hr = hero();
    const combos = getAssemblableCombos(hr);
    if (!combos.length) { ui.message('No combination artifact can be assembled.', { title: 'Assemble' }); return; }
    const pick = await ui.choose({
      title: 'Assemble', cancellable: true,
      options: combos.map((c) => ({ label: ARTIFACT_BY_ID[c].name, icon: { kind: 'artifact', id: c }, value: c })),
    });
    if (pick) act(ctx, () => assemble(hero(), pick));
  }

  function stackWindow(slot) {
    const st = hero().army[slot];
    if (!st) return;
    const c = CREATURE_BY_ID[st.creatureId];
    // hero specialty upgrade (Gelu: Sharpshooters, Dracon: Enchanters)
    const spec = getSpecialtyUpgrades(ctx.state, hero()).find((u) => u.slot === slot);
    const d = ui.openDialog({
      title: c ? c.name : st.creatureId,
      class: 'town-dlg',
      width: 560,
      content: h('div', null, ui.CreatureCard({ creatureId: st.creatureId, count: st.count }),
        spec ? h('div.town-stack-up', null, `Specialty upgrade to ${CREATURE_BY_ID[spec.to]?.name || spec.to}: `, ui.CostView(spec.cost, currentPlayer(ctx.state)?.resources || null)) : null),
      buttons: [
        ...(spec ? [{ label: 'Upgrade', kind: 'primary', value: 'upgrade', disabled: !owned() }] : []),
        { label: 'Dismiss', kind: 'danger', value: 'dismiss', disabled: !owned() },
        { label: 'Close', value: null, default: true, cancel: true },
      ],
    });
    d.result.then((v) => {
      if (v === 'dismiss') confirmDismissStack(slot);
      if (v === 'upgrade') act(ctx, (s) => specialtyUpgrade(s, heroId, slot));
    });
  }

  async function confirmDismissStack(slot) {
    const st = hero().army[slot];
    if (!st) return;
    if (await ui.confirm(`Dismiss ${st.count} ${CREATURE_BY_ID[st.creatureId]?.name || st.creatureId}?`, { danger: true })) {
      act(ctx, (s) => dismissStack(s, heroId, slot));
    }
  }

  function dismissSelected() {
    if (armyRow.selected == null) { ctx.toast('Select a stack first.', 'warn'); return; }
    confirmDismissStack(armyRow.selected);
  }

  async function dismiss() {
    const hr = hero();
    if (!await ui.confirm(`Dismiss ${hr.name}? The hero and his army leave you for good.`, { danger: true, title: 'Dismiss hero' })) return;
    const p = currentPlayer(ctx.state);
    const list = p ? playerHeroIds(ctx.state, p.id) : [];
    const next = cycle(list, heroId, 1);
    const res = act(ctx, (s) => dismissHero(s, heroId));
    if (res && res.ok !== false) {
      if (next && next !== heroId && ctx.state.heroes[next]) ctx.showScreen('hero', { heroId: next }, { replace: true });
      else ctx.back('adventure');
    }
  }

  async function castOrBrowse() {
    const allowCast = params.allowCast !== false && owned() && !!ctx.state.map;
    if (allowCast && ctx.engine && !ctx.engine.adventure) await ctx.engine.load('adventure');
    const outcome = await openSpellbook(ctx, heroId, { allowCast });
    if (outcome && params.onSpell) params.onSpell(outcome);
    if (outcome && outcome.needsTarget) ctx.back('adventure');
    return outcome;
  }

  function showQuests() {
    const list = questLog(ctx.state, hero());
    ui.message(list.length
      ? h('ul.hero-quests', null, list.map((q) => h('li', { class: q.done && 'is-done' }, q.text, q.done ? ' (done)' : '')))
      : 'You have no quests.', { title: 'Quest log' });
  }

  function switchHero(dir) {
    const hr = hero();
    const list = hr.owner != null ? playerHeroIds(ctx.state, hr.owner) : [];
    const next = cycle(list, heroId, dir);
    if (next && next !== heroId) ctx.showScreen('hero', { ...params, heroId: next }, { replace: true });
  }

  // ---- wiring ----------------------------------------------------------------------------------
  cleanup.push(ctx.onState(() => render()));
  ctx.keys.bind(['escape', 'enter'], () => ctx.back('adventure'), 'Close');
  ctx.keys.bind('c', () => btn.book.click(), 'Spell book');
  ctx.keys.bind('q', () => btn.quests.click(), 'Quest log');
  ctx.keys.bind(['arrowleft', 'pageup'], () => btn.prev.click(), 'Previous hero');
  ctx.keys.bind(['arrowright', 'pagedown'], () => btn.next.click(), 'Next hero');
  ctx.keys.bind('delete', () => btn.dismissStack.click(), 'Dismiss stack');
  cleanup.push(() => { artSel.clear(); armySel.clear(); arts.destroy(); armyRow.destroy(); });
  render();
  current = { heroId, el, arts, armyRow, render, buttons: btn, primaryEl, skillsEl, statsEl, castOrBrowse, dismiss, artifactMenu };
  if (ctx.state.pending && ctx.state.pending.length) ctx.resolvePendings();
}

export function unmount() {
  for (const f of cleanup.splice(0)) { try { f(); } catch { /* ignore */ } }
  current = null;
}
