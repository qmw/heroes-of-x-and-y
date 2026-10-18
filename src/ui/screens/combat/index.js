// Combat screen. params: { returnTo?: 'adventure', returnParams?, cs?: CombatState (debug / custom
// battle without a GameState), animSpeed?: 0 (instant), onFinish?(result, summary) }.
// Reads `ctx.state.combat` (hero.js startCombat), plays the battle (human input, AI turns, event
// animation) and closes it with hero.js finishCombat. Spec: docs/mechanics/ui-combat.md.
import * as C from '../../../engine/combat/index.js';
import { finishCombat, COMBAT_MAX_ROUNDS } from '../../../engine/hero.js';
import { heroSpellCost } from '../../../engine/combat/spells.js';
import { SPELL_BY_ID } from '../../../data/spells.js';
import {
  CANVAS_W, CANVAS_H, makeLayout, hexAtPoint, interpretHover, movementShadow, footprint, stackAtHex,
  stackLabel, creatureName, spellName, humanizeId, viewerSide, isHumanSide, resultModel, UNTARGETED_MODES,
} from './model.js';
import { createView, syncView, createSpriteKit, createBackground, renderBattlefield, heroRect, heroDefId } from './view.js';
import { createPlayback } from './playback.js';
import { createCombatAudio, loadAudioMap } from './audio.js';

const AI_DELAY = 260;
const startPlayed = new WeakSet();
let session = null;
let cssAdded = false;

/** The live session (tests / debugging). */
export function getSession() { return session; }

export async function mount(root, ctx, params = {}) {
  if (session) session.destroy();
  session = createSession(root, ctx, params || {});
  await session.start();
}

export function unmount() {
  if (session) session.destroy();
  session = null;
}

function addCss(ui) {
  if (cssAdded || typeof document === 'undefined' || !document.head) return;
  cssAdded = true;
  try {
    document.head.appendChild(ui.h('link', { rel: 'stylesheet', href: new URL('./combat.css', import.meta.url).href }));
  } catch { /* styling is optional */ }
}

function createSession(root, ctx, params) {
  const { ui } = ctx;
  const { h } = ui;
  const cs = params.cs || (ctx.state && ctx.state.combat && ctx.state.combat.cs) || null;
  // The engine ends a battle at its round cap (defender win, reason 'timeout'); battles created
  // without one (old saves, tests) get the adapter's default so the screen never loops forever.
  if (cs && cs.maxRounds == null && cs.phase !== 'over') cs.maxRounds = COMBAT_MAX_ROUNDS;
  const layout = makeLayout();
  const view = createView();
  const offs = [];
  const running = new Set();
  let disposed = false;
  let skipping = false;
  let autoCombat = false;
  let legal = null;
  let mode = { kind: 'normal' };
  let input = null;               // { resolve } while waiting for the human
  let lastMouse = null;
  let duelyst = null;
  let background = null;
  let loopHandle = null;
  let finished = false;
  const audio = createCombatAudio(ctx);
  const kit = createSpriteKit(ctx, null);
  const logStore = ui.createLogStore(300);
  const S = {};                    // public session object

  const setting = (k, dflt) => { const v = ctx.settings && ctx.settings.get(k); return v === undefined || v === null ? dflt : v; };
  const instant = () => params.animSpeed === 0 || Number(setting('animSpeed', 1)) === 0;

  /** Tween through the shared animator, unless instant / skipping (then it completes at once). */
  function tween(o) {
    if (disposed || skipping || instant() || !ctx.anim) {
      if (o.onUpdate) o.onUpdate(o.to ?? 1, 1);
      if (o.onDone) o.onDone();
      return Promise.resolve();
    }
    const p = ctx.anim.tween(o);
    running.add(p);
    p.then(() => running.delete(p));
    return p;
  }
  function skip() {
    if (!view.busy) return false;
    skipping = true;
    for (const p of [...running]) { try { p.cancel(true); } catch { /* ignore */ } }
    running.clear();
    return true;
  }

  // ---- DOM ---------------------------------------------------------------------------------------
  const cv = ui.createCanvas(CANVAS_W, CANVAS_H, { class: 'cmb-canvas' });
  const g = cv.ctx;
  const status = h('div.cmb-status', null, '');
  const logEl = ui.LogConsole({ store: logStore, max: 120, class: 'cmb-log' });
  const queue = h('div.cmb-queue');
  const abilityBar = h('div.cmb-abilities');
  const btn = {};
  btn.options = ui.Button('Options', { size: 'sm', onClick: () => openOptions(), tooltip: 'Combat options' });
  btn.surrender = ui.Button('Surrender', { size: 'sm', onClick: () => askSurrender(), tooltip: 'Surrender (pay gold, keep the army)' });
  btn.retreat = ui.Button('Retreat', { size: 'sm', hotkey: 'R', onClick: () => askRetreat(), tooltip: 'Retreat (the army is lost)' });
  btn.auto = ui.Button('Auto', { size: 'sm', hotkey: 'A', onClick: () => toggleAuto(), tooltip: 'Auto-combat on/off' });
  btn.book = ui.Button('Spells', { size: 'sm', hotkey: 'C', onClick: () => openSpellbook(), tooltip: 'Cast a spell' });
  btn.wait = ui.Button('Wait', { size: 'sm', hotkey: 'W', onClick: () => submit({ type: 'wait' }), tooltip: 'Act later this round' });
  btn.defend = ui.Button('Defend', { size: 'sm', hotkey: 'D', onClick: () => submit({ type: 'defend' }), tooltip: 'Skip the turn, +defense' });
  btn.start = ui.Button('Start battle', { kind: 'primary', onClick: () => submit({ type: 'tactics_end' }) });
  const tacticsBar = h('div.cmb-tactics', null, h('span.cmb-tactics-text', null, 'Tactics: place your troops in the highlighted zone.'), btn.start);
  const el = h('div.cmb', null,
    h('div.cmb-field', null, cv.canvas, tacticsBar),
    queue,
    h('div.cmb-panel', null,
      h('div.cmb-panel-left', null, btn.options, btn.surrender, btn.retreat, btn.auto),
      h('div.cmb-panel-mid', null, status, logEl),
      h('div.cmb-panel-right', null, h('div.cmb-row', null, btn.book, btn.wait, btn.defend), abilityBar)));

  // ---- rendering -----------------------------------------------------------------------------------
  const colorOf = (side) => {
    const pid = cs.sides[side]?.playerId;
    const p = pid != null && ctx.state && ctx.state.players ? ctx.state.players[pid] : null;
    return p ? p.color : side === 'attacker' ? 'red' : 'blue';
  };
  const playerHex = (c) => { try { const m = ctx.gfx && ctx.gfx.module; return m && m.playerColorHex ? m.playerColorHex(c) : null; } catch { return null; } };
  const heroDefOf = (side) => heroDefId(ctx.state, cs.sides[side]?.hero);
  function render() {
    if (disposed || !g) return;
    try {
      renderBattlefield(g, view, cs, {
        layout, kit, background, viewer: viewerSide(cs), colorOf, heroDefOf, playerHex,
        showGrid: !!setting('showGrid', false), shadow: setting('combatShadow', true) !== false,
        cursorShadow: setting('combatCursorShadow', true) !== false,
      });
    } catch (err) {
      if (!S.renderError) { S.renderError = err; console.error('[combat] render failed', err); }
    }
  }

  // ---- panel state ---------------------------------------------------------------------------------
  const humanTurn = () => !!input && !view.busy;
  function updatePanel() {
    const L = legal || { phase: cs.phase };
    const can = humanTurn() && L.phase === 'battle';
    btn.wait.setDisabled(!(can && L.canWait));
    btn.defend.setDisabled(!(can && L.canDefend));
    btn.book.setDisabled(!(can && L.canCast));
    btn.retreat.setDisabled(!(can && L.canRetreat));
    btn.surrender.setDisabled(!(can && L.canSurrender));
    btn.auto.setActive(autoCombat);
    btn.auto.setDisabled(finished);
    tacticsBar.style.display = humanTurn() && L.phase === 'tactics' ? '' : 'none';
    ui.clear(abilityBar);
    if (can) {
      for (const e of L.abilities || []) {
        const label = e.spellId ? spellName(e.spellId) : humanizeId(e.ability);
        abilityBar.appendChild(ui.Button(label, { size: 'sm', class: 'cmb-ability', onClick: () => useAbility(e),
          tooltip: `${humanizeId(e.ability)}${e.castsLeft != null ? ` (${e.castsLeft} left)` : ''}` }));
      }
      for (const t of L.siegeTargets || []) {
        const id = t.targetId ?? t.id;
        abilityBar.appendChild(ui.Button(`Attack ${humanizeId(t.kind || 'wall')}${t.kind ? '' : ` ${id}`}`, { size: 'sm', class: 'cmb-siege', onClick: () => submit({ type: 'siege_attack', targetId: id }) }));
      }
    }
    updateQueue();
    setStatus();
  }
  function setStatus(text) {
    if (text) { status.textContent = text; return; }
    if (finished || C.isOver(cs)) { status.textContent = 'The battle is over.'; return; }
    if (cs.phase === 'tactics') { status.textContent = 'Tactics phase: arrange your army, then press Start battle.'; return; }
    const a = C.getActiveStack(cs);
    if (!a) { status.textContent = ''; return; }
    const who = stackLabel(a);
    const thinking = !humanTurn() ? ' (please wait)' : '';
    const cast = mode.kind === 'cast' ? ` - casting ${spellName(mode.spellId)} (right-click / Esc to cancel)` : mode.kind === 'ability' ? ` - choose a target (Esc to cancel)` : '';
    status.textContent = `Round ${cs.round}: ${who}${thinking}${cast}`;
  }
  function updateQueue() {
    let order = [];
    try { order = C.describeTurnOrder(cs) || []; } catch { order = []; }
    ui.clear(queue);
    let sep = false;
    for (const r of order.slice(0, 18)) {
      if (r.phase === 'next_round' && !sep) { sep = true; queue.appendChild(h('div.cmb-queue-sep', null, `R${cs.round + 1}`)); }
      const item = h('div.cmb-queue-item', {
        class: [`cmb-side-${r.side}`, r.phase === 'active' && 'is-active', r.phase === 'waited' && 'is-waiting', r.phase === 'next_round' && 'is-next'],
        dataset: { stackId: String(r.stackId), phase: r.phase },
      }, ctx.sprite('creature', r.creatureId, { size: 46, facing: r.side === 'attacker' ? 1 : -1, box: { w: 46, h: 46, ax: 23, ay: 44 }, minBody: 40 }), h('span.cmb-queue-count', null, String(r.count)));
      ui.attachTooltip(item, `${r.count} ${creatureName(r.creatureId)}, speed ${r.speed}${r.phase === 'waited' ? ' (waiting)' : ''}`);
      item.addEventListener('mouseenter', () => { const s = C.getStack(cs, r.stackId); view.targets = s ? footprint(s) : []; });
      item.addEventListener('mouseleave', () => { view.targets = targetHexesFor(mode); });
      queue.appendChild(item);
    }
  }

  // ---- input ---------------------------------------------------------------------------------------
  function waitInput() {
    return new Promise((resolve) => { input = { resolve }; updatePanel(); refreshHover(); render(); });
  }
  /** Hand an action to the turn loop (only while the human is to act). */
  function submit(action) {
    if (!input || view.busy || finished) return false;
    const r = input.resolve;
    input = null;
    r(action);
    return true;
  }
  S.submit = submit;

  function targetHexesFor(m) {
    if (m.kind === 'cast' && m.first != null && m.targets && m.targets.mode === 'hex') return (m.targets.hexes || []).map((x) => ({ x: x.x, y: x.y }));
    if (m.kind === 'cast' && m.targets && m.targets.stackIds) return m.targets.stackIds.flatMap((id) => { const s = C.getStack(cs, id); return s ? footprint(s) : []; });
    if (m.kind === 'ability') return m.entry.targets.flatMap((id) => { const s = C.getStack(cs, id); return s ? footprint(s) : []; });
    if (m.kind === 'normal' && legal && legal.heals && legal.heals.length) return legal.heals.flatMap((id) => { const s = C.getStack(cs, id); return s ? footprint(s) : []; });
    return [];
  }
  function setMode(m) {
    mode = m;
    view.targets = targetHexesFor(m);
    if (m.kind === 'tactics' && legal && legal.tactics) {
      const e = legal.tactics.stacks.find((x) => x.stackId === m.stackId);
      view.zone = e ? e.hexes.flatMap((p) => footprint(C.getStack(cs, e.stackId), p)) : [];
    } else view.zone = [];
    refreshHover();
    setStatus();
  }
  function cancelMode() {
    if (mode.kind === 'cast' || mode.kind === 'ability') { setMode({ kind: 'normal' }); return true; }
    return false;
  }

  /** Hover state for a logical canvas point (also used by clicks and tests). */
  function hoverAt(x, y) {
    lastMouse = { x, y };
    const hex = hexAtPoint(layout, x, y);
    let res = { action: null, text: '', cursor: { type: 'default' }, highlight: [] };
    if (humanTurn() && legal) {
      try { res = interpretHover(cs, legal, hex, { x, y }, mode, layout); } catch (err) { console.error('[combat] hover', err); }
    } else if (hex) {
      const st = stackAtHex(cs, hex);
      if (st) res = { action: null, text: stackLabel(st), cursor: { type: 'info' }, highlight: [] };
    }
    const overHero = ['attacker', 'defender'].find((side) => cs.sides[side]?.hero && inRect(x, y, heroRect(side)));
    if (overHero && !res.action) res = { action: null, text: `${cs.sides[overHero].hero.name}${humanTurn() && isOwnHero(overHero) && legal?.canCast ? ' - click to cast a spell' : ' - click for details'}`, cursor: { type: 'info' }, highlight: [] };
    view.hover = { hex, mouse: { x, y }, highlight: res.highlight, cursor: res.cursor, action: res.action, text: res.text };
    cv.canvas.style.cursor = res.cursor && res.cursor.type !== 'default' ? 'none' : 'default';
    setStatus(res.text || null);
    return view.hover;
  }
  function refreshHover() { if (lastMouse) hoverAt(lastMouse.x, lastMouse.y); else view.hover = null; }
  S.hoverAt = hoverAt;

  /** Left click at a logical canvas point. */
  function clickAt(x, y) {
    if (view.busy) { skip(); return null; }
    const hv = hoverAt(x, y);
    const overHero = ['attacker', 'defender'].find((side) => cs.sides[side]?.hero && inRect(x, y, heroRect(side)));
    if (!hv.action && overHero) { heroClick(overHero); return { type: '__hero', side: overHero }; }
    const a = hv.action;
    if (!a || !humanTurn()) return null;
    if (a.type === '__select') { setMode({ kind: 'tactics', stackId: a.stackId }); return a; }
    if (a.type === '__cast_step2') { castStep2(a.stackId); return a; }
    submit(a);
    return a;
  }
  S.clickAt = clickAt;

  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const isOwnHero = (side) => isHumanSide(cs, side) && legal && legal.side === side;
  const pos = (e) => ui.eventPos(cv.canvas, e, CANVAS_W, CANVAS_H);

  function onMove(e) { const p = pos(e); hoverAt(p.x, p.y); }
  function onLeave() { lastMouse = null; view.hover = null; cv.canvas.style.cursor = 'default'; setStatus(); }
  function onDown(e) {
    if (e.button !== 2) return;
    if (e.preventDefault) e.preventDefault();
    if (cancelMode()) return;
    const p = pos(e);
    const node = infoAt(p.x, p.y);
    if (node) ui.showInfoPopup(node, e.clientX || 0, e.clientY || 0);
  }
  function onUp(e) { if (e.button === 2) ui.hideInfoPopup(); }
  function onClick(e) { if (e.button && e.button !== 0) return; const p = pos(e); clickAt(p.x, p.y); }
  for (const [type, fn] of [['mousemove', onMove], ['mouseleave', onLeave], ['mousedown', onDown], ['mouseup', onUp], ['click', onClick], ['contextmenu', (e) => e.preventDefault && e.preventDefault()]]) {
    offs.push(ui.on(cv.canvas, type, fn));
  }

  /** Right-click info content at a canvas point (stack card or hero box). */
  function infoAt(x, y) {
    const hex = hexAtPoint(layout, x, y);
    const st = hex ? stackAtHex(cs, hex) : null;
    if (st) return stackInfoNode(ctx, cs, st.id);
    const side = ['attacker', 'defender'].find((sd) => cs.sides[sd]?.hero && inRect(x, y, heroRect(sd)));
    if (side) return heroInfoNode(ctx, cs, side);
    return null;
  }
  S.infoAt = infoAt;

  // ---- keyboard --------------------------------------------------------------------------------------
  const bind = (combo, fn, desc) => { if (ctx.keys && ctx.keys.bind) offs.push(ctx.keys.bind(combo, fn, desc) || (() => {})); };
  bind('d', () => submit({ type: 'defend' }), 'Defend');
  bind('w', () => { if (legal && legal.canWait) submit({ type: 'wait' }); }, 'Wait');
  bind('c', () => openSpellbook(), 'Cast a spell');
  bind('a', () => toggleAuto(), 'Auto-combat');
  bind('r', () => askRetreat(), 'Retreat');
  bind('space', () => { if (!skip() && legal && legal.phase === 'tactics') submit({ type: 'tactics_end' }); }, 'Skip animation');
  bind('escape', () => { if (!cancelMode() && !skip()) openOptions(); }, 'Cancel / options');

  // ---- commands ------------------------------------------------------------------------------------
  function toggleAuto() {
    if (finished) return;
    autoCombat = !autoCombat;
    btn.auto.setActive(autoCombat);
    if (autoCombat && input) { const r = input.resolve; input = null; r(null); }
  }
  S.toggleAuto = toggleAuto;

  async function askRetreat() {
    if (!humanTurn() || !legal || !legal.canRetreat) return;
    const yes = await ui.confirm('Retreat from the battle? Your army will be lost, your hero returns to the tavern.', { danger: true, title: 'Retreat' });
    if (yes) submit({ type: 'retreat' });
  }
  async function askSurrender() {
    if (!humanTurn() || !legal || !legal.canSurrender) return;
    const yes = await ui.confirm(`Surrender for ${legal.surrenderCost} gold? Your hero keeps the army and returns to the tavern.`, { title: 'Surrender' });
    if (yes) submit({ type: 'surrender' });
  }

  function useAbility(entry) {
    if (!humanTurn()) return;
    const a = C.getActiveStack(cs);
    if (entry.targets.length === 1 && a && entry.targets[0] === a.id) { submit({ type: 'ability', ability: entry.ability, targetId: a.id }); return; }
    setMode({ kind: 'ability', entry });
  }
  S.useAbility = useAbility;

  /** Pick a spell (no dialog): cast at once for untargeted spells, else enter target selection. */
  function pickSpell(spellId) {
    if (!humanTurn() || !legal || !legal.canCast || !legal.spells.includes(spellId)) return false;
    let targets;
    try { targets = C.getSpellTargets(cs, legal.side, spellId); } catch { targets = { mode: 'none', stackIds: [] }; }
    const stacky = ['enemy_stack', 'friendly_stack', 'any_stack', 'dead_friendly_stack'].includes(targets.mode);
    if (UNTARGETED_MODES.includes(targets.mode) || (!stacky && !targets.anyHex && targets.mode !== 'area' && targets.mode !== 'hex')) {
      submit({ type: 'cast', spellId, target: null });
      return true;
    }
    setMode({ kind: 'cast', spellId, side: legal.side, targets });
    return true;
  }
  S.pickSpell = pickSpell;

  /** Two-step spells (Teleport, Sacrifice): the stack is chosen, ask the engine for the second targets. */
  function castStep2(stackId) {
    if (mode.kind !== 'cast') return false;
    let targets;
    try { targets = C.getSpellTargets(cs, mode.side, mode.spellId, { stackId }); } catch { targets = null; }
    if (!targets || targets.available === false) { ctx.toast && ctx.toast('No valid second target.', 'warn'); return false; }
    setMode({ ...mode, first: stackId, targets });
    return true;
  }
  S.castStep2 = castStep2;

  async function openSpellbook() {
    if (!humanTurn() || !legal || legal.phase !== 'battle') return null;
    const side = legal.side;
    const hero = cs.sides[side]?.hero;
    if (!hero) return null;
    const castable = new Set(legal.spells || []);
    const reason = (s) => {
      if (castable.has(s.id)) return true;
      if (s.kind !== 'combat') return 'Adventure spell';
      if (cs.sides[side].castThisRound) return 'Already cast a spell this round';
      let cost = s.cost;
      try { cost = heroSpellCost(cs, side, s.id); } catch { /* data cost */ }
      if (hero.mana < cost) return 'Not enough mana';
      return 'Cannot be cast now';
    };
    let picked = null;
    const view2 = ui.SpellbookView({
      spells: hero.spells, mana: hero.mana, kind: 'combat',
      costOf: (s) => { try { return heroSpellCost(cs, side, s.id); } catch { return s.cost; } },
      canCast: reason,
      onSelect: (id) => { if (reason(SPELL_BY_ID[id]) === true) { picked = id; d.close(id); } },
    });
    const d = ui.openDialog({
      title: `${hero.name}'s spell book - ${hero.mana} / ${hero.maxMana} mana`, class: 'cmb-book-dlg', width: 900,
      content: view2, buttons: [{ label: 'Close', value: null, cancel: true }],
    });
    S.bookDialog = d;
    await d.result;
    S.bookDialog = null;
    if (picked) pickSpell(picked);
    return picked;
  }
  S.openSpellbook = openSpellbook;

  function heroClick(side) {
    if (humanTurn() && isOwnHero(side) && legal && legal.canCast) { openSpellbook(); return; }
    ui.message(heroInfoNode(ctx, cs, side), { title: cs.sides[side].hero.name });
  }

  function openOptions() {
    const row = (label, key, dflt) => ui.Checkbox({ label, checked: !!setting(key, dflt), onChange: (v) => { ctx.settings && ctx.settings.set(key, v); render(); } });
    const speed = ui.Select({ options: [0.5, 1, 2, 4].map((v) => ({ value: v, label: `${v}x` })), value: Number(setting('animSpeed', 1)),
      onChange: (v) => ctx.settings && ctx.settings.set('animSpeed', v) });
    const content = h('div.cmb-options', null,
      row('Show hex grid', 'showGrid', false), row('Movement shadow', 'combatShadow', true), row('Cursor shadow', 'combatCursorShadow', true),
      ui.Field('Animation speed', speed));
    return ui.openDialog({ title: 'Combat options', content, buttons: [{ label: 'Close', value: null, default: true }] }).result;
  }

  // ---- turn loop -----------------------------------------------------------------------------------
  const playback = createPlayback({
    view, cs, layout, tween, viewer: cs ? viewerSide(cs) : 'attacker',
    sfx: (n) => audio.sfx(n),
    log: (text, kind) => logStore.add(text, kind),
    onError: (err, e) => console.error('[combat] animation of', e && e.type, err),
  });
  S.playback = playback;

  async function perform(action, { ai = false } = {}) {
    skipping = false;
    setMode({ kind: 'normal' });
    view.hover = view.hover ? { ...view.hover, highlight: [], action: null } : null;
    const res = ctx.act ? ctx.act(() => C.performAction(cs, action), { silent: ai, reason: 'combat' }) : C.performAction(cs, action);
    if (!res || res.ok === false) return false;
    S.actions.push(action);
    await playback.play(res.events || []);
    if (disposed) return true;
    playback.resync();
    skipping = false;
    render();
    return true;
  }

  async function runLoop() {
    let failures = 0;
    for (let guard = 0; guard < 50000 && !disposed; guard++) {
      if (C.isOver(cs)) break;
      legal = C.getLegalActions(cs);
      const side = legal.side;
      const human = !!side && isHumanSide(cs, side) && !autoCombat;
      view.shadow = legal.phase === 'battle' && human ? movementShadow(cs, legal) : [];
      if (!human) {
        input = null;
        updatePanel();
        await tween({ duration: AI_DELAY });
        if (disposed) return;
        let action;
        try { action = C.chooseAction(cs); } catch (err) { console.error('[combat] AI failed', err); action = { type: 'defend' }; }
        let ok = await perform(action || { type: 'defend' }, { ai: true });
        if (!ok && !disposed) ok = await perform(legal.phase === 'tactics' ? { type: 'tactics_end' } : { type: 'defend' }, { ai: true });
        failures = ok ? 0 : failures + 1;
        // the AI keeps failing: let the engine finish the battle (its own round cap applies)
        if (failures > 3) { C.autoResolve(cs); break; }
        continue;
      }
      if (legal.phase === 'tactics') {
        const first = legal.tactics && legal.tactics.stacks[0];
        setMode({ kind: 'tactics', stackId: mode.kind === 'tactics' && legal.tactics.stacks.some((x) => x.stackId === mode.stackId) ? mode.stackId : first ? first.stackId : null });
      } else if (mode.kind === 'tactics') setMode({ kind: 'normal' });
      else setMode(mode);
      const action = await waitInput();
      if (disposed) return;
      updatePanel();
      if (!action) continue;
      const ok = await perform(action);
      if (!ok) { refreshHover(); }
    }
    if (!disposed && !C.isOver(cs)) C.autoResolve(cs); // safety net: the engine finishes (its own cap)
    if (!disposed) await endFlow();
  }

  async function endFlow() {
    if (finished) return;
    finished = true;
    input = null;
    view.shadow = [];
    view.zone = [];
    view.targets = [];
    updatePanel();
    const result = C.getResult(cs);
    let summary = null;
    let events = [];
    const fromState = !!(ctx.state && ctx.state.combat && ctx.state.combat.cs === cs);
    if (fromState) {
      const res = ctx.act((st) => finishCombat(st), { reason: 'combat_finished' });
      if (res && res.ok !== false) { summary = res.result || null; events = res.events || []; }
      S.finishResult = res;
    }
    if (params.onFinish) { try { await params.onFinish(result, summary); } catch (err) { ctx.showError && ctx.showError(err); } }
    S.result = result;
    S.summary = summary;
    await showResult(result, summary, events);
    if (disposed) return;
    if (ctx.resolvePendings) await ctx.resolvePendings();
    if (disposed) return;
    await leave();
  }

  function showResult(result, summary, events) {
    const m = resultModel(cs, result, summary, events);
    const lossRow = (title, list) => h('div.cmb-res-col', null, h('div.cmb-res-title', null, title),
      list.length ? h('div.cmb-res-units', null, list.map((l) => h('div.cmb-res-unit', { dataset: { creature: l.creatureId } },
        ctx.sprite('creature', l.creatureId, { size: 48 }), h('span', null, String(l.count)))))
        : h('div.cmb-res-none', null, 'None'));
    const content = h('div.cmb-result', { class: `is-${m.outcome}` },
      h('div.cmb-res-cols', null, lossRow('Your casualties', m.ownLosses), lossRow('Enemy casualties', m.enemyLosses)),
      m.lines.map((l) => h('p.cmb-res-line', null, l)));
    ctx.audio && ctx.audio.play && ctx.audio.play(m.outcome === 'victory' ? 'victory' : m.outcome === 'defeat' ? 'defeat' : 'click');
    const d = ui.openDialog({ title: m.title, content, class: 'cmb-result-dlg', width: 560, buttons: [{ label: 'OK', value: true, default: true }] });
    S.resultDialog = d;
    S.resultModel = m;
    return d.result;
  }

  async function leave() {
    const st = ctx.state;
    if (params.returnTo === false) return;
    if (!st) { ctx.showScreen(params.returnTo || 'mainMenu'); return; }
    // game over: the adventure screen shows the proper victory / defeat dialog with the score on mount
    ctx.showScreen(params.returnTo || 'adventure', params.returnParams || {}, { replace: true });
  }

  // ---- life cycle ----------------------------------------------------------------------------------
  S.actions = [];
  S.start = async () => {
    root.appendChild(el);
    addCss(ui);
    if (!cs) {
      root.appendChild(ui.Panel({ title: 'No battle', variant: 'parchment', class: 'cmb-none' },
        h('p', null, 'There is no battle in progress.'),
        ui.Button('Back', { kind: 'primary', onClick: () => ctx.showScreen(ctx.state ? 'adventure' : 'mainMenu') })));
      el.style.display = 'none';
      S.done = Promise.resolve();
      return;
    }
    try { duelyst = await import('../../../gfx/duelyst/index.js'); } catch { duelyst = null; }
    if (disposed) return;
    Object.assign(kit, createSpriteKit(ctx, duelyst));
    background = createBackground(cs.terrain, duelyst, () => render());
    syncView(view, cs, layout);
    if (ctx.anim && ctx.anim.loop) {
      loopHandle = ctx.anim.loop((dt) => { view.time += dt * (Number(setting('animSpeed', 1)) || 1); render(); });
    }
    loadAudioMap().then(() => { if (!disposed) audio.music(cs.siege ? 'combat_siege' : 'combat'); });
    logStore.add(`Battle${cs.siege ? ' for the town' : ''} on ${humanizeId(cs.terrain)}.`, 'info');
    render();
    updatePanel();
    S.done = (async () => {
      if (!startPlayed.has(cs)) {
        startPlayed.add(cs);
        await playback.play(cs.startEvents || []);
        if (disposed) return;
        playback.resync();
      }
      await runLoop();
    })().catch((err) => { if (!disposed) (ctx.showError ? ctx.showError(err) : console.error(err)); });
  };
  S.destroy = () => {
    if (disposed) return;
    disposed = true;
    if (input) { const r = input.resolve; input = null; r(null); }
    for (const p of [...running]) { try { p.cancel(false); } catch { /* ignore */ } }
    if (loopHandle) loopHandle.stop();
    for (const f of offs) { try { f(); } catch { /* ignore */ } }
    offs.length = 0;
    try { logEl.destroy(); } catch { /* ignore */ }
    audio.stop();
    ui.hideInfoPopup();
  };
  Object.defineProperties(S, {
    cs: { get: () => cs },
    view: { get: () => view },
    legal: { get: () => legal },
    mode: { get: () => mode },
    waiting: { get: () => humanTurn() },
    finished: { get: () => finished },
    autoCombat: { get: () => autoCombat },
    log: { get: () => logStore.entries.map((e) => e.text) },
  });
  S.layout = layout;
  S.render = render;
  S.skip = skip;
  S.el = el;
  S.canvas = cv.canvas;
  S.buttons = btn;
  return S;
}

// ---- info nodes ----------------------------------------------------------------------------------------

/** Creature info card for a stack: current stats, hp of the top creature, active spells. */
export function stackInfoNode(ctx, cs, stackId) {
  const { ui } = ctx;
  const { h } = ui;
  const info = C.getStackInfo(cs, stackId);
  if (!info) return null;
  const effects = (info.effects || []).map((e) => `${spellName(e.spellId)}${e.roundsLeft != null ? ` (${e.roundsLeft} round${e.roundsLeft === 1 ? '' : 's'})` : ''}`);
  const footer = h('div.cmb-info-foot', null,
    h('div', null, `Health left: ${info.hp} / ${info.maxHp}`),
    h('div', null, `Morale ${info.morale >= 0 ? '+' : ''}${info.morale}, Luck ${info.luck >= 0 ? '+' : ''}${info.luck}`),
    info.shots ? h('div', null, `Shots left: ${info.shots}`) : null,
    h('div', null, `Retaliations left: ${info.retaliationsLeft}`),
    effects.length ? h('div.cmb-info-spells', null, `Spells: ${effects.join(', ')}`) : null,
    info.statuses && info.statuses.length ? h('div', null, info.statuses.map(humanizeId).join(', ')) : null);
  return ui.CreatureCard({
    creatureId: info.creatureId, count: info.count, compact: true, footer,
    stats: { attack: info.attack, defense: info.defense, hp: info.maxHp, speed: info.speed, minDamage: info.minDamage, maxDamage: info.maxDamage, shots: info.shots },
  });
}

/** Hero box: primary skills and mana. */
export function heroInfoNode(ctx, cs, side) {
  const { h } = ctx.ui;
  const hero = cs.sides[side]?.hero;
  if (!hero) return null;
  return h('div.cmb-hero-info', null,
    h('div.cmb-hero-name', null, `${hero.name}${hero.level ? `, level ${hero.level}` : ''}`),
    h('div', null, `Attack ${hero.attack} - Defense ${hero.defense} - Power ${hero.power} - Knowledge ${hero.knowledge}`),
    h('div', null, `Spell points: ${hero.mana} / ${hero.maxMana}`),
    h('div', null, `Morale ${cs.sides[side].morale ?? 0}, Luck ${cs.sides[side].luck ?? 0}`));
}
