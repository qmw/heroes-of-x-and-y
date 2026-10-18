// Custom dialogs for the adventure pending kinds (docs/mechanics/adventure-engine.md "Pending kinds
// raised", docs/mechanics/ui-adventure.md §6). Each renderer resolves `{optionIndex, extra?}` for
// `resolvePending(state, id, optionIndex, extra)`. Registered by `registerAdventurePendings()`.
import { registerPendingRenderer } from '../../kit/pending.js';
import { h, fmt, humanize, clear } from '../../kit/dom.js';
import { openDialog, choose } from '../../kit/dialog.js';
import { CostView } from '../../kit/resourceBar.js';
import { NumberStepper, Slider, Select, Checkbox } from '../../kit/widgets.js';
import { ArmyRow, createArmySelection } from '../../kit/armyRow.js';
import { sprite } from '../../sprites.js';
import { RESOURCES } from '../../../core/constants.js';
import { CREATURE_BY_ID } from '../../../data/creatures.js';
import { ARTIFACT_BY_ID } from '../../../data/artifacts.js';
import { SKILL_BY_ID } from '../../../data/skills.js';
import { HERO_BY_ID } from '../../../data/heroes.js';
import { marketRate, freelancerRate } from '../../../data/buildings.js';
import { objectDef, creatureName, sizeLabelText, questText, heroDisplayName, playerName } from './model.js';

const LEVELS = ['', 'Basic', 'Advanced', 'Expert'];

export const idx = (pending, id) => pending.options.findIndex((o) => o.id === id);
const leaveIndex = (p) => { const i = idx(p, 'leave'); return i >= 0 ? i : p.options.length - 1; };
const st = (ctx) => (ctx && ctx.state) || null;
const heroOf = (ctx, p) => (st(ctx) && st(ctx).heroes[p.heroId]) || null;
const resourcesOf = (ctx, p) => {
  const s = st(ctx);
  const pl = s && s.players.find((x) => x.id === p.playerId);
  return (pl && pl.resources) || {};
};
const objName = (p) => (p.data && p.data.defId ? objectDef(p.data.defId).name : 'This place');

export function canAffordAll(have, cost, n = 1) {
  return RESOURCES.every((r) => !cost || !cost[r] || (have[r] || 0) >= cost[r] * n);
}
export function maxAffordableCount(have, cost, cap) {
  let n = cap;
  for (const r of RESOURCES) if (cost && cost[r]) n = Math.min(n, Math.floor((have[r] || 0) / cost[r]));
  return Math.max(0, n);
}

function guardRow(army) {
  const stacks = (army || []).filter(Boolean);
  if (!stacks.length) return null;
  return h('div.adv-guards', null, stacks.map((s) => h('div.adv-guard', null,
    sprite('creature', s.creatureId, { size: 48 }), h('div.adv-guard-label', null, sizeLabelText(s.creatureId, s.count)))));
}

function rewardLine(reward) {
  if (!reward) return null;
  const parts = [];
  for (const r of RESOURCES) if (reward.resources && reward.resources[r]) parts.push(`${reward.resources[r]} ${r}`);
  if (reward.exp) parts.push(`${fmt(reward.exp)} experience`);
  if (reward.artifact) parts.push(humanize(reward.artifact));
  if (reward.skill) parts.push(humanize(reward.skill.id || reward.skill));
  if (reward.spell) parts.push(humanize(reward.spell.spellId || reward.spell));
  for (const c of reward.creatures || []) if (c.creatureId) parts.push(`${c.count} ${creatureName(c.creatureId, c.count)}`);
  return parts.length ? h('p.adv-reward', null, `Reward: ${parts.join(', ')}`) : null;
}

/** A list dialog: one row per option (icon, label, cost, button). Leave closes with the leave index. */
function listDialog(ctx, p, { title, text, rows, leaveLabel = 'Leave', width = 560 }) {
  const have = resourcesOf(ctx, p);
  let handle = null;
  const body = h('div.adv-list', null,
    text ? h('p', null, text) : null,
    rows.map((r) => {
      const affordable = !r.cost || canAffordAll(have, r.cost);
      const disabled = r.disabled || !affordable;
      const btn = h('button.k-btn.k-btn-sm', { type: 'button', disabled, class: disabled && 'is-disabled', dataset: { option: String(r.index) } }, r.action || 'Buy');
      btn.addEventListener('click', () => { if (!btn.disabled) handle.close(r.index); });
      return h('div.adv-list-row', { class: disabled && 'is-disabled' },
        r.icon ? h('div.adv-list-icon', null, sprite(r.icon.kind, r.icon.id, { size: 40 })) : null,
        h('div.adv-list-main', null, h('div.adv-list-label', null, r.label), r.note ? h('div.adv-list-note', null, r.note) : null),
        r.cost ? CostView(r.cost, have, { size: 16 }) : null,
        btn);
    }));
  handle = openDialog({ title, content: body, width, class: 'adv-dlg', buttons: [{ label: leaveLabel, value: leaveIndex(p), cancel: true }], cancelValue: leaveIndex(p) });
  return handle;
}

// ---- renderers -----------------------------------------------------------------------------------

const CONFIRM_TEXT = {
  confirm_fight: (p) => `${objName(p)} is guarded. Will you fight the guards?`,
  confirm_pay: () => 'Will you pay the price?',
  confirm_open: (p) => `Will you open the ${objName(p)}?`,
  confirm_search: (p) => `Will you search the ${objName(p)}? Disturbing the dead will lower your morale.`,
  confirm_quest: () => 'You have fulfilled the quest. Will you hand it in?',
  confirm_pass: () => 'Will you pass?',
  confirm_whirlpool: () => 'Enter the whirlpool? It may swallow part of your army.',
};

async function confirmRenderer(p, ctx) {
  const d = p.data || {};
  const text = d.message || (CONFIRM_TEXT[p.kind] || (() => 'Proceed?'))(p);
  const have = resourcesOf(ctx, p);
  const content = h('div.adv-confirm', null,
    h('p', null, text),
    guardRow(d.guards),
    d.cost ? h('div.adv-cost', null, 'Cost: ', CostView(d.cost, have)) : null,
    d.quest ? h('p.adv-quest', null, questText(d.quest)) : null,
    rewardLine(d.reward));
  const yes = idx(p, 'yes') >= 0 ? idx(p, 'yes') : 0;
  const no = idx(p, 'no') >= 0 ? idx(p, 'no') : 1;
  const v = await openDialog({
    title: objName(p), content, class: 'adv-dlg', icon: d.defId ? { kind: 'object', id: d.defId } : null,
    buttons: [{ label: 'Yes', value: yes, default: true, kind: 'primary' }, { label: 'No', value: no, cancel: true }],
    cancelValue: no,
  }).result;
  return { optionIndex: v ?? no };
}

async function chooseRenderer(p, ctx, { title, text, map }) {
  const options = p.options.map((o, i) => ({ value: i, ...map(o, i) }));
  const v = await choose({ title, text, options, cancellable: false });
  return { optionIndex: v ?? 0 };
}

const R = {};
for (const kind of Object.keys(CONFIRM_TEXT)) R[kind] = confirmRenderer;

R.chest_choice = (p, ctx) => chooseRenderer(p, ctx, {
  title: 'Treasure Chest', text: 'You find a treasure chest. Keep the gold or give it to the peasants for experience?',
  map: (o) => (o.id === 'gold'
    ? { label: `${fmt(o.gold)} gold`, icon: { kind: 'resource', id: 'gold' } }
    : { label: `${fmt(o.exp)} experience`, icon: { kind: 'ui', id: 'experience' } }),
});

R.primary_choice = (p, ctx) => chooseRenderer(p, ctx, {
  title: objName(p), text: p.data && p.data.cost ? 'Choose a skill to improve (for a price).' : 'Choose a skill to improve.',
  map: (o) => (o.id === 'decline' ? { label: 'Leave' } : { label: `+${o.value ?? 1} ${humanize(o.stat)}`, icon: { kind: 'ui', id: `stat_${o.stat}` } }),
});

R.skill_choice = (p, ctx) => chooseRenderer(p, ctx, {
  title: objName(p), text: 'Choose a secondary skill to learn.',
  map: (o) => (o.id === 'decline' ? { label: 'Leave' } : {
    label: `${LEVELS[(p.data && p.data.level) || 1]} ${SKILL_BY_ID[o.skillId] ? SKILL_BY_ID[o.skillId].name : humanize(o.skillId)}`,
    icon: { kind: 'skill', id: o.skillId }, disabled: o.available === false,
  }),
});

R.army_overflow = (p, ctx) => chooseRenderer(p, ctx, {
  title: 'No room', text: `${fmt(p.data.count)} ${creatureName(p.data.creatureId, p.data.count)} want to join, but your army is full. Dismiss a stack to make room?`,
  map: (o) => (o.id === 'leave' ? { label: 'Let them go' } : { label: `Dismiss ${fmt(o.count)} ${creatureName(o.creatureId, o.count)}`, icon: { kind: 'creature', id: o.creatureId } }),
});

R.town_portal = (p, ctx) => chooseRenderer(p, ctx, {
  title: 'Town Portal', text: 'Choose the town to travel to.',
  map: (o) => (o.id === 'cancel' ? { label: 'Cancel' } : { label: o.label || (st(ctx) && st(ctx).towns[o.townId] ? st(ctx).towns[o.townId].name : o.townId), icon: st(ctx) && st(ctx).towns[o.townId] ? { kind: 'town', id: st(ctx).towns[o.townId].faction } : null }),
});

R.university = async (p, ctx) => {
  const rows = p.options.map((o, i) => (o.id === 'buy' ? {
    index: i, label: SKILL_BY_ID[o.skillId] ? `Basic ${SKILL_BY_ID[o.skillId].name}` : humanize(o.skillId),
    icon: { kind: 'skill', id: o.skillId }, cost: o.cost, disabled: o.available === false, note: o.available === false ? 'Cannot learn' : '', action: 'Learn',
  } : null)).filter(Boolean);
  const v = await listDialog(ctx, p, { title: 'University', text: 'Learn a secondary skill.', rows }).result;
  return { optionIndex: v ?? leaveIndex(p) };
};

R.buy_artifact = async (p, ctx) => {
  const rows = p.options.map((o, i) => (o.id === 'buy' ? {
    index: i, label: ARTIFACT_BY_ID[o.artifactId] ? ARTIFACT_BY_ID[o.artifactId].name : humanize(o.artifactId),
    icon: { kind: 'artifact', id: o.artifactId }, cost: o.cost,
  } : null)).filter(Boolean);
  const v = await listDialog(ctx, p, { title: objName(p), text: rows.length ? 'Artifacts for sale.' : 'Sold out.', rows }).result;
  return { optionIndex: v ?? leaveIndex(p) };
};

R.upgrade_creatures = async (p, ctx) => {
  const rows = p.options.map((o, i) => (o.id === 'upgrade' ? {
    index: i, label: `${fmt(o.count)} ${creatureName(o.from, o.count)} → ${creatureName(o.to, o.count)}`,
    icon: { kind: 'creature', id: o.to }, cost: o.cost, action: 'Upgrade',
  } : null)).filter(Boolean);
  const v = await listDialog(ctx, p, { title: objName(p), text: rows.length ? 'Upgrade your troops.' : 'Nothing to upgrade.', rows }).result;
  return { optionIndex: v ?? leaveIndex(p) };
};

R.buy_war_machine = async (p, ctx) => {
  const rows = p.options.map((o, i) => (o.id === 'buy' ? {
    index: i, label: ARTIFACT_BY_ID[o.artifactId] ? ARTIFACT_BY_ID[o.artifactId].name : humanize(o.artifactId),
    icon: { kind: 'artifact', id: o.artifactId }, cost: o.cost, disabled: o.available === false, note: o.available === false ? 'Already owned' : '',
  } : null)).filter(Boolean);
  const v = await listDialog(ctx, p, { title: objName(p), text: 'War machines for sale.', rows }).result;
  return { optionIndex: v ?? leaveIndex(p) };
};

R.tavern = async (p, ctx) => {
  const rows = p.options.map((o, i) => (o.id === 'hire' ? {
    index: i, label: HERO_BY_ID[o.heroDefId] ? HERO_BY_ID[o.heroDefId].name : humanize(o.heroDefId),
    icon: { kind: 'portrait', id: o.heroDefId }, cost: o.cost, action: 'Hire',
  } : null)).filter(Boolean);
  const v = await listDialog(ctx, p, { title: 'Tavern', text: rows.length ? 'Heroes for hire.' : 'No heroes for hire.', rows }).result;
  return { optionIndex: v ?? leaveIndex(p) };
};

R.build_boat = async (p, ctx) => {
  const have = resourcesOf(ctx, p);
  const cost = (p.data && p.data.cost) || {};
  const yes = idx(p, 'yes') >= 0 ? idx(p, 'yes') : 0;
  const no = idx(p, 'no') >= 0 ? idx(p, 'no') : 1;
  const v = await openDialog({
    title: 'Shipyard', class: 'adv-dlg',
    content: h('div', null, h('p', null, 'Build a boat?'), CostView(cost, have)),
    buttons: [{ label: 'Build', value: yes, default: true, disabled: !canAffordAll(have, cost) }, { label: 'Leave', value: no, cancel: true }],
    cancelValue: no,
  }).result;
  return { optionIndex: v ?? no };
};

R.monster_join = async (p, ctx) => {
  const d = p.data || {};
  const what = `${fmt(d.count)} ${creatureName(d.creatureId, d.count)}`;
  const text = d.cost ? `The ${what} offer to join your army for ${fmt(d.cost)} gold. Accept?` : `The ${what} would like to join your army. Accept?`;
  const v = await openDialog({
    title: 'Followers', class: 'adv-dlg', icon: { kind: 'creature', id: d.creatureId }, content: text,
    buttons: [{ label: 'Accept', value: 0, default: true }, { label: 'Fight', value: 1, cancel: true }], cancelValue: 1,
  }).result;
  return { optionIndex: v ?? 1 };
};

R.monster_flee = async (p) => {
  const d = p.data || {};
  const v = await openDialog({
    title: 'Fleeing monsters', class: 'adv-dlg', icon: { kind: 'creature', id: d.creatureId },
    content: `The ${creatureName(d.creatureId, 2)} flee before your army. Pursue them?`,
    buttons: [{ label: 'Pursue', value: 0 }, { label: 'Let them go', value: 1, default: true, cancel: true }], cancelValue: 1,
  }).result;
  return { optionIndex: v ?? 1 };
};

// ---- recruit with a count slider ---------------------------------------------------------------

R.recruit = async (p, ctx) => {
  const have = resourcesOf(ctx, p);
  const offers = p.options.map((o, i) => ({ o, i })).filter((x) => x.o.id === 'recruit');
  if (!offers.length) return { optionIndex: leaveIndex(p) };
  let sel = offers[0];
  const maxFor = (o) => maxAffordableCount(have, o.cost, o.available || 0);
  let count = maxFor(sel.o);
  const totalEl = h('div.adv-recruit-total');
  const availEl = h('div.adv-recruit-avail');
  const stepper = NumberStepper({ min: 0, max: maxFor(sel.o), value: count, onChange: (v) => { count = v; slider.value = v; refresh(); } });
  const slider = Slider({ min: 0, max: Math.max(1, maxFor(sel.o)), value: count, onChange: (v) => { count = v; stepper.value = v; refresh(); } });
  let handle = null;
  const cards = offers.map((x) => {
    const card = h('button.adv-recruit-card', { type: 'button', dataset: { option: String(x.i) } },
      sprite('creature', x.o.creatureId, { size: 56 }), h('div', null, creatureName(x.o.creatureId, 2)), h('div.adv-small', null, `Available: ${fmt(x.o.available)}`));
    card.addEventListener('click', () => { sel = x; count = maxFor(x.o); stepper.setRange(0, maxFor(x.o)); slider.setRange(0, Math.max(1, maxFor(x.o))); stepper.value = count; slider.value = count; refresh(); });
    return card;
  });
  function refresh() {
    cards.forEach((c) => c.classList.toggle('is-selected', c.dataset.option === String(sel.i)));
    const total = {};
    for (const r of RESOURCES) if (sel.o.cost && sel.o.cost[r]) total[r] = sel.o.cost[r] * count;
    clear(totalEl, 'Total: ', CostView(total, have));
    availEl.textContent = `Each: ${RESOURCES.filter((r) => sel.o.cost && sel.o.cost[r]).map((r) => `${sel.o.cost[r]} ${r}`).join(', ') || 'free'} — available ${fmt(sel.o.available)}`;
    if (handle) handle.setButtonDisabled(0, count < 1);
  }
  const body = h('div.adv-recruit', null, h('div.adv-recruit-cards', null, cards), availEl, h('div.adv-recruit-count', null, slider, stepper), totalEl);
  handle = openDialog({
    title: `Recruit — ${objName(p)}`, content: body, class: 'adv-dlg', width: 520,
    buttons: [{ label: 'Recruit', value: 'recruit', default: true }, { label: 'Leave', value: 'leave', cancel: true }], cancelValue: 'leave',
  });
  handle.stepper = stepper;
  handle.cards = cards;
  refresh();
  const v = await handle.result;
  if (v !== 'recruit' || count < 1) return { optionIndex: leaveIndex(p) };
  return { optionIndex: sel.i, extra: { count } };
};

// ---- market ------------------------------------------------------------------------------------

R.trade = async (p, ctx) => {
  const d = p.data || {};
  const modes = d.modes && d.modes.length ? d.modes : ['resource_resource'];
  const markets = d.marketCount || 1;
  const have = resourcesOf(ctx, p);
  const hero = heroOf(ctx, p);
  const tradeIdx = idx(p, 'trade') >= 0 ? idx(p, 'trade') : 0;
  let mode = modes[0];
  let give = 'wood';
  let get = 'gold';
  let slot = hero ? hero.army.findIndex(Boolean) : -1;
  let toPlayer = null;
  let handle = null;
  const MODE_LABEL = { resource_resource: 'Resources', creature_resource: 'Sell creatures', resource_player: 'Send to player' };
  const others = (st(ctx) ? st(ctx).players : []).filter((x) => x.id !== p.playerId && x.alive !== false);
  if (others.length) toPlayer = others[0].id;
  const stepper = NumberStepper({ min: 0, max: 0, value: 0, onChange: () => refresh() });
  const info = h('div.adv-trade-info');
  const area = h('div.adv-trade-area');
  const modeSel = modes.length > 1 ? Select({ options: modes.map((m) => ({ value: m, label: MODE_LABEL[m] || humanize(m) })), value: mode, onChange: (v) => { mode = v; build(); } }) : null;

  const resGrid = (sideSel, onPick) => h('div.adv-res-grid', null, RESOURCES.map((r) => {
    const b = h('button.adv-res-btn', { type: 'button', class: sideSel() === r && 'is-selected', dataset: { res: r } }, sprite('resource', r, { size: 28 }), h('span', null, fmt(have[r] || 0)));
    b.addEventListener('click', () => { onPick(r); build(); });
    return b;
  }));
  function rate() {
    if (mode === 'resource_resource') return give === get ? null : marketRate(give, get, markets);
    if (mode === 'creature_resource') {
      const s = hero && hero.army[slot];
      const c = s && CREATURE_BY_ID[s.creatureId];
      return c ? freelancerRate(c.cost.gold || 0, get, markets) : null;
    }
    return { give: 1, get: 1 };
  }
  function maxLots() {
    const rt = rate();
    if (!rt) return 0;
    if (mode === 'resource_resource') return Math.floor((have[give] || 0) / rt.give);
    if (mode === 'creature_resource') {
      const s = hero && hero.army[slot];
      if (!s) return 0;
      const total = hero.army.reduce((n, x) => n + (x ? x.count : 0), 0);
      return Math.floor(Math.min(s.count, total - 1) / rt.give);
    }
    return have[give] || 0;
  }
  function refresh() {
    const rt = rate();
    const n = stepper.value;
    if (!rt) info.textContent = 'Choose two different resources.';
    else if (mode === 'resource_resource') info.textContent = `${rt.give} ${give} for ${rt.get} ${get} — trade ${fmt(n * rt.give)} ${give} for ${fmt(n * rt.get)} ${get}`;
    else if (mode === 'creature_resource') info.textContent = `${rt.give} creature(s) for ${rt.get} ${get} — sell ${fmt(n * rt.give)} for ${fmt(n * rt.get)} ${get}`;
    else info.textContent = `Send ${fmt(n)} ${give} to ${playerName(st(ctx), toPlayer)}`;
    if (handle) handle.setButtonDisabled(0, !(n >= 1));
  }
  function build() {
    const parts = [];
    if (mode === 'resource_resource') {
      parts.push(h('div.adv-trade-cols', null,
        h('div', null, h('div.adv-small', null, 'Kingdom resources (give)'), resGrid(() => give, (r) => { give = r; })),
        h('div', null, h('div.adv-small', null, 'Available for trade (get)'), resGrid(() => get, (r) => { get = r; }))));
    } else if (mode === 'creature_resource') {
      const opts = (hero ? hero.army : []).map((s, i) => (s ? { value: i, label: `${fmt(s.count)} ${creatureName(s.creatureId, s.count)}` } : null)).filter(Boolean);
      parts.push(h('div.adv-trade-cols', null,
        h('div', null, h('div.adv-small', null, 'Stack'), Select({ options: opts, value: slot, onChange: (v) => { slot = v; build(); } })),
        h('div', null, h('div.adv-small', null, 'Receive'), resGrid(() => get, (r) => { get = r; }))));
    } else {
      parts.push(h('div.adv-trade-cols', null,
        h('div', null, h('div.adv-small', null, 'Resource'), resGrid(() => give, (r) => { give = r; })),
        h('div', null, h('div.adv-small', null, 'To player'), Select({ options: others.map((x) => ({ value: x.id, label: playerName(st(ctx), x.id) })), value: toPlayer, onChange: (v) => { toPlayer = v; refresh(); } }))));
    }
    clear(area, parts);
    const max = maxLots();
    stepper.setRange(0, max);
    if (stepper.value === 0 && max > 0) stepper.value = 1;
    refresh();
  }
  const body = h('div.adv-trade', null, modeSel ? h('div.adv-trade-mode', null, modeSel) : null, area, h('div.adv-trade-amount', null, h('span', null, 'Amount: '), stepper), info);
  handle = openDialog({
    title: 'Marketplace', content: body, class: 'adv-dlg', width: 600,
    buttons: [{ label: 'Trade', value: 'trade', default: true }, { label: 'Leave', value: 'leave', cancel: true }], cancelValue: 'leave',
  });
  handle.api = {
    setMode: (m) => { mode = m; build(); }, pickGive: (r) => { give = r; build(); }, pickGet: (r) => { get = r; build(); },
    setAmount: (n) => { stepper.value = n; refresh(); }, setSlot: (s) => { slot = s; build(); }, setPlayer: (id) => { toPlayer = id; refresh(); },
  };
  build();
  const v = await handle.result;
  const amount = stepper.value;
  if (v !== 'trade' || amount < 1) return { optionIndex: leaveIndex(p) };
  if (mode === 'resource_resource') return { optionIndex: tradeIdx, extra: { mode, give, get, amount } };
  if (mode === 'creature_resource') return { optionIndex: tradeIdx, extra: { mode, slot, count: amount * (rate() ? rate().give : 1), get } };
  return { optionIndex: tradeIdx, extra: { mode, give, amount, toPlayer } };
};

// ---- altar of sacrifice ------------------------------------------------------------------------

function sacrificable(id) {
  const a = ARTIFACT_BY_ID[id];
  return !!a && !(a.noTransfer || a.noBackpack || a.components || a.slot === 'war_machine' || a.slot === 'spellbook' || a.id === 'grail');
}

/** Artifact refs a hero could sacrifice: `{ref, id}` with ref `{slot, index}` or `{backpack: i}`. */
export function altarArtifacts(hero) {
  const out = [];
  const eq = (hero && hero.artifacts && hero.artifacts.equipped) || {};
  for (const [slot, list] of Object.entries(eq)) {
    (Array.isArray(list) ? list : [list]).forEach((entry, index) => {
      const id = entry && (typeof entry === 'string' ? entry : entry.id);
      if (id && sacrificable(id)) out.push({ ref: { slot, index }, id });
    });
  }
  ((hero && hero.artifacts && hero.artifacts.backpack) || []).forEach((entry, i) => {
    const id = entry && (typeof entry === 'string' ? entry : entry.id);
    if (id && sacrificable(id)) out.push({ ref: { backpack: i }, id });
  });
  return out;
}

R.altar = async (p, ctx) => {
  const d = p.data || {};
  const hero = heroOf(ctx, p);
  const sacIdx = idx(p, 'sacrifice') >= 0 ? idx(p, 'sacrifice') : 0;
  const arts = d.canArtifacts ? altarArtifacts(hero) : [];
  const chosen = new Set();
  const counts = {};
  const artRows = arts.map((a, i) => Checkbox({ label: ARTIFACT_BY_ID[a.id] ? ARTIFACT_BY_ID[a.id].name : humanize(a.id), onChange: (v) => { if (v) chosen.add(i); else chosen.delete(i); } }));
  const creatureRows = d.canCreatures && hero ? hero.army.map((s, slot) => (s ? h('div.adv-altar-row', null,
    sprite('creature', s.creatureId, { size: 32 }), h('span', null, creatureName(s.creatureId, s.count)),
    NumberStepper({ min: 0, max: s.count, value: 0, onChange: (v) => { counts[slot] = v; } })) : null)).filter(Boolean) : [];
  const body = h('div.adv-altar', null,
    h('p', null, 'Sacrifice artifacts or creatures for experience.'),
    d.canArtifacts ? h('div', null, h('div.adv-small', null, 'Artifacts'), artRows.length ? artRows : h('div.adv-small', null, 'none')) : null,
    d.canCreatures ? h('div', null, h('div.adv-small', null, 'Creatures'), creatureRows) : null,
    !d.canArtifacts && !d.canCreatures ? h('p', null, 'The altar rejects your offerings.') : null);
  const handle = openDialog({
    title: 'Altar of Sacrifice', content: body, class: 'adv-dlg', width: 520,
    buttons: [{ label: 'Sacrifice', value: 'go', default: true }, { label: 'Leave', value: 'leave', cancel: true }], cancelValue: 'leave',
  });
  handle.api = { pickArtifact: (i) => chosen.add(i), setCount: (slot, n) => { counts[slot] = n; } };
  const v = await handle.result;
  const artifacts = [...chosen].sort((a, b) => a - b).map((i) => arts[i].ref);
  const creatures = Object.entries(counts).filter(([, n]) => n > 0).map(([slot, count]) => ({ slot: Number(slot), count }));
  if (v !== 'go' || (!artifacts.length && !creatures.length)) return { optionIndex: leaveIndex(p) };
  return { optionIndex: sacIdx, extra: { artifacts, creatures } };
};

// ---- garrison exchange -------------------------------------------------------------------------

R.garrison_exchange = async (p, ctx) => {
  const s = st(ctx);
  const hero = heroOf(ctx, p);
  const obj = s && s.map.objects[p.data.objectId];
  const store = obj ? (objectDef(obj.defId).effect.type === 'garrison' ? obj.data.army : obj.data.garrison) || [] : [];
  const transfer = idx(p, 'transfer') >= 0 ? idx(p, 'transfer') : 0;
  const selection = createArmySelection();
  let handle = null;
  const onMove = (from, to, count, fromRow, toRow) => {
    if (fromRow === toRow || !handle) return;
    handle.close({ from: fromRow === 'hero' ? 'hero' : 'garrison', slot: from, count });
  };
  const garrisonRow = ArmyRow({ id: 'garrison', army: store, selection, onMove, label: 'Garrison', size: 52 });
  const heroRow = ArmyRow({ id: 'hero', army: hero ? hero.army : [], selection, onMove, label: hero ? heroDisplayName(hero) : 'Hero', size: 52 });
  handle = openDialog({
    title: objName(p), class: 'adv-dlg', width: 520,
    content: h('div.adv-garrison', null, garrisonRow, heroRow, p.data.removableUnits === false ? h('p.adv-small', null, 'Troops placed here cannot be taken back.') : null),
    buttons: [{ label: 'Leave', value: 'leave', default: true, cancel: true }], cancelValue: 'leave',
  });
  handle.rows = { garrisonRow, heroRow };
  const v = await handle.result;
  if (!v || v === 'leave') return { optionIndex: leaveIndex(p) };
  const extra = { from: v.from, slot: v.slot };
  if (v.count != null) extra.count = v.count;
  return { optionIndex: transfer, extra };
};

// ---- hero meeting ------------------------------------------------------------------------------

let tradeLoader = () => import('../dialogs/heroTrade.js');
/** Tests: replace the lazy loader of `openHeroTrade`. */
export function setHeroTradeLoader(fn) { tradeLoader = fn; }

R.hero_exchange = async (p, ctx) => {
  const other = p.data && p.data.otherHeroId;
  let mod = null;
  try { mod = await tradeLoader(); } catch { mod = null; }
  if (mod && typeof mod.openHeroTrade === 'function') {
    const r = mod.openHeroTrade(ctx, p.heroId, other);
    if (r && typeof r.then === 'function') await r;
    else if (r && r.result && typeof r.result.then === 'function') await r.result;
    return { optionIndex: 0 };
  }
  await fallbackTrade(ctx, p.heroId, other);
  return { optionIndex: 0 };
};

async function fallbackTrade(ctx, aId, bId) {
  const s = st(ctx);
  const a = s && s.heroes[aId];
  const b = s && s.heroes[bId];
  if (!a || !b) return;
  let heroApi = null;
  try { heroApi = await import('../../../engine/hero.js'); } catch { heroApi = null; }
  const selection = createArmySelection();
  const rows = {};
  const onMove = (from, to, count, fromRow, toRow) => {
    if (!heroApi) return;
    const ids = { a: aId, b: bId };
    const res = ctx.act((state) => heroApi.tradeArmy(state, ids[fromRow], from, ids[toRow], to, count));
    if (res && res.ok !== false) { rows.a.update(s.heroes[aId].army); rows.b.update(s.heroes[bId].army); }
  };
  rows.a = ArmyRow({ id: 'a', army: a.army, selection, onMove, label: heroDisplayName(a) });
  rows.b = ArmyRow({ id: 'b', army: b.army, selection, onMove, label: heroDisplayName(b) });
  await openDialog({ title: 'Hero meeting', class: 'adv-dlg', width: 560, content: h('div.adv-garrison', null, rows.a, rows.b) }).result;
}

export const ADVENTURE_PENDING_RENDERERS = R;

let registered = false;
/** Register every renderer (idempotent). */
export function registerAdventurePendings() {
  if (registered) return;
  registered = true;
  for (const [kind, fn] of Object.entries(R)) registerPendingRenderer(kind, fn);
}
