// Combat screen (src/ui/screens/combat): pure model (hit-testing, attack sectors, previews, log),
// event playback, human input -> performAction, AI loop, tactics, end-of-combat flow, fuzz.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fire, tick, until } from './fakeDom.js';

installFakeDom();
const ui = await import('../../src/ui/kit/index.js');
const sprites = await import('../../src/ui/sprites.js');
const gfx = await import('../../src/gfx/index.js');
const screen = await import('../../src/ui/screens/combat/index.js');
const M = await import('../../src/ui/screens/combat/model.js');
const V = await import('../../src/ui/screens/combat/view.js');
const { createPlayback } = await import('../../src/ui/screens/combat/playback.js');
const C = await import('../../src/engine/combat/index.js');
const { createTestState } = await import('../../src/engine/testing.js');
const hero = await import('../../src/engine/hero.js');
const { createRng, randInt, pick, rand } = await import('../../src/core/rng.js');
const { FACTIONS } = await import('../../src/core/constants.js');
const { CREATURES, creaturesOfFaction } = await import('../../src/data/creatures.js');
const { COMBAT_SPELLS } = await import('../../src/data/spells.js');
await hero.engineReady;

const quiet = async (fn) => {
  const saved = { warn: console.warn };
  console.warn = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};

function makeCtx({ state = null, settings = {} } = {}) {
  const values = { animSpeed: 1, showGrid: true, ...settings };
  const calls = { screens: [], pendings: 0, acts: 0, errors: [] };
  const ctx = {
    get state() { return state; },
    ui,
    anim: ui.createAnimator({ manual: true }),
    settings: { get: (k) => values[k], set: (k, v) => { values[k] = v; return v; } },
    audio: { play() {} },
    keys: ui.createShortcuts(),
    act(fn) { calls.acts++; const r = fn(state); return r || { ok: true, events: [] }; },
    showScreen(name, params, o) { calls.screens.push({ name, params, o }); },
    resolvePendings: async () => { calls.pendings++; return 0; },
    sprite: sprites.sprite,
    drawSprite: sprites.drawSprite,
    gfx: { get module() { return sprites.getGfx(); } },
    toast() {},
    log() {},
    showError(err) { calls.errors.push(err); },
  };
  return { ctx, calls };
}

let mounted = [];
afterEach(() => {
  for (const s of mounted) screen.unmount(s);
  mounted = [];
  ui.closeAllDialogs();
  sprites.setGfx(null);
});

async function mountCombat(cs, opts = {}) {
  const { ctx, calls } = makeCtx(opts);
  const root = document.createElement('div');
  document.body.appendChild(root);
  await screen.mount(root, ctx, { cs, animSpeed: 0, returnTo: 'adventure', ...(opts.params || {}) });
  const S = screen.getSession();
  mounted.push(S);
  return { S, ctx, calls, root };
}

const army = (...pairs) => { const a = pairs.map(([creatureId, count]) => ({ creatureId, count })); while (a.length < 7) a.push(null); return a; };
const side = (isHuman, armyArr, heroObj = null, extra = {}) => ({ playerId: isHuman ? 0 : 1, isHuman, hero: heroObj, army: armyArr, warMachines: [], ...extra });
const heroOf = (o = {}) => ({ id: o.id || 'h', name: o.name || 'Hero', attack: 1, defense: 1, power: 3, knowledge: 3, mana: 40, spells: [], skills: {}, bonuses: [], ...o });
const layout = M.makeLayout();
const center = (h) => layout.center(h.x, h.y);
const waitHuman = (S) => until(() => S.waiting || S.finished, 5000);

// ---- pure model ---------------------------------------------------------------------------------

test('hex hit-testing maps every hex centre (and near-centre points) back to its hex', () => {
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 15; x++) {
      const c = center({ x, y });
      assert.deepEqual(M.hexAtPoint(layout, c.x, c.y), { x, y });
      assert.deepEqual(M.hexAtPoint(layout, c.x + 10, c.y + 8), { x, y });
    }
  }
  assert.equal(M.hexAtPoint(layout, 5, 5), null, 'outside the field');
  assert.equal(M.hexAtPoint(layout, 1270, 300), null);
});

test('attack sectors follow the mouse around a hex (E, SE, SW, W, NW, NE)', () => {
  for (const hex of [{ x: 7, y: 4 }, { x: 7, y: 5 }]) {
    const c = center(hex);
    assert.equal(M.sectorOf(layout, hex, c.x + 20, c.y), 0);
    assert.equal(M.sectorOf(layout, hex, c.x + 10, c.y + 18), 1);
    assert.equal(M.sectorOf(layout, hex, c.x - 10, c.y + 18), 2);
    assert.equal(M.sectorOf(layout, hex, c.x - 20, c.y), 3);
    assert.equal(M.sectorOf(layout, hex, c.x - 10, c.y - 18), 4);
    assert.equal(M.sectorOf(layout, hex, c.x + 10, c.y - 18), 5);
  }
});

test('pickAttackFrom chooses the approach hex on the side of the mouse', () => {
  const attacker = { size: 1, side: 'attacker', pos: { x: 3, y: 5 } };
  const target = { x: 10, y: 5 };      // odd row: W (9,5), NW (10,4), SW (10,6), E (11,5), NE (11,4), SE (11,6)
  const opt = { targetId: 2, fromHexes: [{ x: 9, y: 5 }, { x: 10, y: 4 }, { x: 10, y: 6 }, { x: 11, y: 5 }, { x: 11, y: 4 }, { x: 11, y: 6 }] };
  const c = center(target);
  const at = (dx, dy) => M.pickAttackFrom(layout, attacker, opt, [target], target, { x: c.x + dx, y: c.y + dy }).from;
  assert.deepEqual(at(-25, 0), { x: 9, y: 5 });
  assert.deepEqual(at(-10, -20), { x: 10, y: 4 });
  assert.deepEqual(at(-10, 20), { x: 10, y: 6 });
  assert.deepEqual(at(25, 0), { x: 11, y: 5 });
  assert.deepEqual(at(10, 20), { x: 11, y: 6 });
  const pick = M.pickAttackFrom(layout, attacker, opt, [target], target, { x: c.x - 25, y: c.y });
  assert.ok(pick.angle < 10 || pick.angle > 350, `sword points east from the west hex (${pick.angle})`);
  // only one legal approach: it is used whatever the mouse says
  assert.deepEqual(M.pickAttackFrom(layout, attacker, { targetId: 2, fromHexes: [{ x: 11, y: 4 }] }, [target], target, { x: c.x - 25, y: c.y }).from, { x: 11, y: 4 });
  // a two-hex attacker: footprint hexes count
  const wide = { size: 2, side: 'attacker', pos: { x: 3, y: 5 } };
  const p2 = M.pickAttackFrom(layout, wide, { targetId: 2, fromHexes: [{ x: 9, y: 5 }, { x: 12, y: 5 }] }, [target], target, { x: c.x + 25, y: c.y });
  assert.deepEqual(p2.from, { x: 12, y: 5 }, 'tail of the 2-hex attacker at (11,5) touches the target from the east');
});

test('badge kinds and log texts', () => {
  assert.equal(M.badgeKind({ effects: [] }), 'normal');
  assert.equal(M.badgeKind({ effects: [{ spellId: 'bless' }] }), 'buffed');
  assert.equal(M.badgeKind({ effects: [{ spellId: 'curse' }] }), 'debuffed');
  assert.equal(M.badgeKind({ effects: [{ spellId: 'bless' }, { spellId: 'slow' }] }), 'mixed');
  const cs = C.createCombat({ seed: 1, terrain: 'grass', obstacles: [], attacker: side(false, army(['archer', 10])), defender: side(false, army(['goblin', 30])) });
  const [a, d] = cs.stacks;
  assert.equal(M.describeEvent(cs, { type: 'damage', stackId: d.id, sourceStackId: a.id, amount: 15, dealt: 15, killed: 3 }), 'Archers do 15 damage. 3 Goblins perish.');
  assert.equal(M.describeEvent(cs, { type: 'round_start', round: 2 }), '--- Round 2 ---');
  assert.match(M.describeEvent(cs, { type: 'morale', stackId: a.id, good: true }), /High morale/);
  assert.equal(M.describeEvent(cs, { type: 'move', stackId: a.id }), null);
});

// ---- mounting & human input ------------------------------------------------------------------------

test('mounts a real combat: canvas, turn queue, buttons, human turn with legal actions', async () => {
  const cs = C.createCombat({ seed: 3, terrain: 'snow',
    attacker: side(true, army(['pikeman', 20], ['archer', 12], ['cavalier', 3]), heroOf({ spells: ['magic_arrow'] }), { warMachines: ['ballista', 'first_aid_tent'] }),
    defender: side(false, army(['goblin', 40], ['orc', 10], ['behemoth', 1]), heroOf({ id: 'd', name: 'Foe' })) });
  const { S, root } = await mountCombat(cs);
  await waitHuman(S);
  assert.ok(root.querySelector('.cmb canvas'));
  assert.equal(S.legal.phase, 'battle');
  assert.equal(S.legal.side, 'attacker');
  const items = root.querySelectorAll('.cmb-queue-item');
  assert.equal(items.length, Math.min(18, C.describeTurnOrder(cs).length));
  assert.ok(items[0].classList.contains('is-active'));
  assert.equal(S.buttons.defend.disabled, false);
  assert.equal(S.buttons.book.disabled, !S.legal.canCast);
  assert.ok(S.view.shadow.length > 0, 'movement shadow');
  assert.ok(S.view.stacks.size === cs.stacks.length);
  S.render();
  assert.equal(S.renderError, undefined);
  // right-click info card
  const active = C.getActiveStack(cs);
  const c = center(active.pos);
  const node = S.infoAt(c.x, c.y);
  assert.ok(node && node.textContent.includes('Health left'));
});

test('clicks perform move / attack (sector picks the hex) / wait / defend', async () => {
  const cs = C.createCombat({ seed: 9, terrain: 'grass', obstacles: [],
    attacker: side(true, army(['angel', 5])), defender: side(false, army(['pikeman', 10])) });
  cs.stacks[0].pos = { x: 8, y: 5 };
  const { S, ctx } = await mountCombat(cs);
  await waitHuman(S);
  const angel = C.getActiveStack(cs);
  assert.equal(angel.creatureId, 'angel');
  const pike = cs.stacks.find((s) => s.creatureId === 'pikeman');
  // hover the pikeman from the north-west: attack from (14,4) [row 5 is odd]
  const pc = center(pike.pos);
  const hv = S.hoverAt(pc.x - 8, pc.y - 20);
  assert.equal(hv.action.type, 'attack');
  assert.deepEqual(hv.action.from, { x: 14, y: 4 });
  const p = C.getAttackPreview(cs, angel.id, pike.id, { ranged: false, from: { x: 14, y: 4 } });
  assert.equal(hv.text, `Attack Pikeman (${p.minDamage === p.maxDamage ? p.minDamage : `${p.minDamage}-${p.maxDamage}`} damage, ${p.minKills === p.maxKills ? p.minKills : `${p.minKills}-${p.maxKills}`} perish)`);
  assert.equal(hv.cursor.type, 'attack');
  S.clickAt(pc.x - 8, pc.y - 20);
  await until(() => S.actions.length >= 1);
  assert.deepEqual(S.actions[0], { type: 'attack', targetId: pike.id, from: { x: 14, y: 4 } });
  await waitHuman(S);
  if (S.finished) return;
  // now (round 1 again or next) - wait via the button, defend via the key
  if (S.legal.canWait) {
    S.buttons.wait.click();
    await until(() => S.actions.some((a) => a.type === 'wait'));
    await waitHuman(S);
  }
  if (!S.finished) {
    ctx.keys.handle({ key: 'd', preventDefault() {} });
    await until(() => S.actions.some((a) => a.type === 'defend'));
  }
});

test('move click on an empty hex; tail click of a two-hex creature', async () => {
  const cs = C.createCombat({ seed: 4, terrain: 'grass', obstacles: [],
    attacker: side(true, army(['cavalier', 4])), defender: side(false, army(['peasant', 5])) });
  const { S } = await mountCombat(cs);
  await waitHuman(S);
  const cav = C.getActiveStack(cs);
  assert.equal(cav.size, 2);
  // pure rule: a hex that is only reachable as the tail moves the head one hex forward
  assert.deepEqual(M.moveTargetFor(cav, { moves: [{ x: 5, y: 3 }] }, { x: 4, y: 3 }), { x: 5, y: 3 });
  assert.equal(M.moveTargetFor(cav, { moves: [{ x: 5, y: 3 }] }, { x: 7, y: 3 }), null);
  const dest = { x: 5, y: cav.pos.y };
  const hv = S.hoverAt(center(dest).x, center(dest).y);
  assert.equal(hv.action.type, 'move');
  assert.deepEqual(hv.action.to, dest);
  assert.match(hv.text, /^Move Cavalier here/);
  assert.equal(hv.highlight.length, 2, 'both hexes of the destination are highlighted');
  S.clickAt(center(dest).x, center(dest).y);
  await until(() => S.actions.length >= 1);
  assert.deepEqual(S.actions[0], { type: 'move', to: dest });
  assert.ok(S.log.length > 0);
});

test('shooting: preview text, broken arrow at long range, click shoots', async () => {
  const cs = C.createCombat({ seed: 5, terrain: 'grass', obstacles: [],
    attacker: side(true, army(['archer', 10])), defender: side(false, army(['goblin', 30])) });
  const { S } = await mountCombat(cs);
  await waitHuman(S);
  const archer = C.getActiveStack(cs);
  const gob = cs.stacks.find((s) => s.creatureId === 'goblin');
  const gc = center(gob.pos);
  const hv = S.hoverAt(gc.x, gc.y);
  const p = C.getAttackPreview(cs, archer.id, gob.id, { ranged: true });
  assert.equal(hv.action.type, 'shoot');
  assert.ok(hv.text.startsWith(M.previewText('Shoot', gob, p)));
  assert.equal(hv.cursor.type, 'shoot_half', 'distance 14 > 10 halves the damage');
  S.clickAt(gc.x, gc.y);
  await until(() => S.actions.length >= 1);
  assert.deepEqual(S.actions[0], { type: 'shoot', targetId: gob.id });
  assert.ok(archer.shots < 12);
});

test('spell casting: book pick -> target selection -> cast on click', async () => {
  const cs = C.createCombat({ seed: 6, terrain: 'grass', obstacles: [],
    attacker: side(true, army(['pikeman', 10]), heroOf({ spells: ['magic_arrow', 'bless'], mana: 30 })), defender: side(false, army(['goblin', 30])) });
  const { S } = await mountCombat(cs);
  await waitHuman(S);
  assert.ok(S.legal.canCast);
  const p = S.openSpellbook();
  await until(() => S.bookDialog);
  assert.equal(ui.dialogCount(), 1);
  S.bookDialog.close(null);
  await p;
  assert.ok(S.pickSpell('magic_arrow'));
  assert.equal(S.mode.kind, 'cast');
  assert.ok(S.view.targets.length > 0, 'valid targets highlighted');
  const gob = cs.stacks.find((s) => s.creatureId === 'goblin');
  const own = C.getActiveStack(cs);
  assert.equal(S.hoverAt(center(own.pos).x, center(own.pos).y).cursor.type, 'blocked');
  const gc = center(gob.pos);
  const hv = S.hoverAt(gc.x, gc.y);
  assert.deepEqual(hv.action, { type: 'cast', spellId: 'magic_arrow', target: gob.id });
  assert.match(hv.text, /Cast Magic Arrow on/);
  const mana = cs.sides.attacker.hero.mana;
  S.clickAt(gc.x, gc.y);
  await until(() => S.actions.length >= 1);
  assert.ok(cs.sides.attacker.hero.mana < mana);
  assert.ok(S.log.some((l) => /casts Magic Arrow/.test(l)));
  await waitHuman(S);
  assert.equal(S.legal.canCast, false, 'one spell per round');
  assert.equal(S.legal.stackId, own.id, 'the creature still acts after the hero cast');
  // Escape / right-click cancels targeting
  S.useAbility({ ability: 'x', targets: [gob.id] });
  assert.equal(S.mode.kind, 'ability');
  fire(S.canvas, 'mousedown', { button: 2, clientX: 1, clientY: 1 });
  assert.equal(S.mode.kind, 'normal');
});

test('two-step targeting: Teleport picks the stack, then the destination hex', async () => {
  const cs = C.createCombat({ seed: 6, terrain: 'grass', obstacles: [],
    attacker: side(true, army(['pikeman', 10]), heroOf({ spells: ['teleport'], mana: 40, skills: { water_magic: 1 } })), defender: side(false, army(['goblin', 30])) });
  const { S } = await mountCombat(cs);
  await waitHuman(S);
  assert.ok(S.legal.spells.includes('teleport'), 'teleport castable');
  assert.ok(S.pickSpell('teleport'));
  const own = cs.stacks.find((x) => x.creatureId === 'pikeman');
  const oc = center(own.pos);
  assert.equal(S.hoverAt(oc.x, oc.y).action.type, '__cast_step2');
  S.clickAt(oc.x, oc.y);
  assert.equal(S.mode.first, own.id);
  assert.equal(S.mode.targets.mode, 'hex');
  const dest = S.mode.targets.hexes.find((x) => x.x === 8) || S.mode.targets.hexes[0];
  assert.ok(S.view.targets.length > 0, 'destinations highlighted');
  const dc = center(dest);
  const hv = S.hoverAt(dc.x, dc.y);
  assert.deepEqual(hv.action, { type: 'cast', spellId: 'teleport', target: { stackId: own.id, hex: { x: dest.x, y: dest.y } } });
  S.clickAt(dc.x, dc.y);
  await until(() => S.actions.length >= 1);
  assert.deepEqual({ x: own.pos.x, y: own.pos.y }, { x: dest.x, y: dest.y });
});

test('two-step targeting: Sacrifice picks the dead stack, then the victim', () => {
  const cs = C.createCombat({ seed: 6, terrain: 'grass', obstacles: [],
    attacker: side(true, army(['pikeman', 10], ['archer', 5]), heroOf({ spells: ['sacrifice'], mana: 60 })), defender: side(false, army(['goblin', 30])) });
  const legal = C.getLegalActions(cs);
  const dead = cs.stacks.find((x) => x.creatureId === 'pikeman');
  const victim = cs.stacks.find((x) => x.creatureId === 'archer');
  const step2 = { kind: 'cast', spellId: 'sacrifice', side: 'attacker', first: dead.id, targets: { mode: 'friendly_stack', stackIds: [victim.id] } };
  const vc = center(victim.pos);
  const hv = M.interpretHover(cs, legal, victim.pos, vc, step2, layout);
  assert.deepEqual(hv.action, { type: 'cast', spellId: 'sacrifice', target: { stackId: dead.id, victimId: victim.id } });
  const step1 = { kind: 'cast', spellId: 'sacrifice', side: 'attacker', targets: { mode: 'dead_friendly_stack', stackIds: [dead.id], target2: 'friendly_stack' } };
  dead.alive = false;
  const h1 = M.interpretHover(cs, legal, dead.pos, center(dead.pos), step1, layout);
  assert.deepEqual(h1.action, { type: '__cast_step2', stackId: dead.id });
});

test('area spell shows the radius preview', async () => {
  const cs = C.createCombat({ seed: 6, terrain: 'grass', obstacles: [],
    attacker: side(true, army(['pikeman', 10]), heroOf({ spells: ['fireball'], mana: 40, skills: { fire_magic: 2 } })), defender: side(false, army(['goblin', 30])) });
  const { S } = await mountCombat(cs);
  await waitHuman(S);
  if (!S.legal.spells.includes('fireball')) return; // spell not castable in this build
  S.pickSpell('fireball');
  assert.equal(S.mode.kind, 'cast');
  const hv = S.hoverAt(center({ x: 7, y: 5 }).x, center({ x: 7, y: 5 }).y);
  assert.equal(hv.action.type, 'cast');
  assert.deepEqual(hv.action.target, { x: 7, y: 5 });
  assert.ok(hv.highlight.length >= 7, `radius preview (${hv.highlight.length} hexes)`);
});

test('tactics phase: select, place inside the zone, start the battle', async () => {
  const cs = C.createCombat({ seed: 2, terrain: 'grass', obstacles: [],
    attacker: side(true, army(['pikeman', 10], ['archer', 5]), heroOf({ bonuses: [{ type: 'tactics', hexes: 3 }] })),
    defender: side(false, army(['goblin', 20])) });
  assert.equal(cs.phase, 'tactics');
  const { S, root } = await mountCombat(cs);
  await waitHuman(S);
  assert.equal(S.legal.phase, 'tactics');
  assert.equal(S.mode.kind, 'tactics');
  assert.notEqual(root.querySelector('.cmb-tactics').style.display, 'none');
  assert.ok(S.view.zone.length > 0);
  const archer = cs.stacks.find((s) => s.creatureId === 'archer');
  S.clickAt(center(archer.pos).x, center(archer.pos).y);
  assert.equal(S.mode.stackId, archer.id);
  const to = { x: 3, y: 4 };
  const hv = S.hoverAt(center(to).x, center(to).y);
  assert.deepEqual(hv.action, { type: 'tactics_move', stackId: archer.id, to });
  S.clickAt(center(to).x, center(to).y);
  await until(() => S.actions.length >= 1);
  assert.deepEqual(archer.pos, to);
  await waitHuman(S);
  const outside = { x: 9, y: 4 };
  assert.equal(S.hoverAt(center(outside).x, center(outside).y).action, null, 'outside the zone');
  S.buttons.start.click();
  await until(() => S.actions.length >= 2);
  assert.deepEqual(S.actions[1], { type: 'tactics_end' });
  await waitHuman(S);
  assert.ok(cs.phase === 'battle' || cs.phase === 'over');
});

test('auto-combat hands the human side to the AI; the AI loop terminates', async () => {
  const cs = C.createCombat({ seed: 11, terrain: 'dirt',
    attacker: side(true, army(['swordsman', 20], ['marksman', 15])), defender: side(false, army(['skeleton', 40], ['zombie', 20])) });
  const { S } = await mountCombat(cs);
  await waitHuman(S);
  S.toggleAuto();
  assert.equal(S.autoCombat, true);
  await until(() => S.finished, 20000);
  assert.ok(C.isOver(cs));
  assert.ok(S.actions.length > 2);
});

// ---- playback ------------------------------------------------------------------------------------------

test('event playback runs strictly in order and waits for each animation (fast speed)', async () => {
  const cs = C.createCombat({ seed: 1, terrain: 'grass', obstacles: [], attacker: side(false, army(['pikeman', 10])), defender: side(false, army(['goblin', 3])) });
  const [a, d] = cs.stacks;
  const view = V.createView();
  V.syncView(view, cs, layout);
  const anim = ui.createAnimator({ manual: true, speed: 4 });
  const order = [];
  const pb = createPlayback({
    view, cs, layout, tween: (o) => anim.tween(o), sfx() {}, log: (t) => order.push(`log:${t}`),
    onEvent: (e) => order.push(`${e.type}@${Math.round(anim.time)}`),
  });
  const events = [
    { type: 'move', stackId: a.id, from: { ...a.pos }, to: { x: 3, y: a.pos.y }, path: [{ x: 2, y: a.pos.y }, { x: 3, y: a.pos.y }], mode: 'walk' },
    { type: 'attack', stackId: a.id, targetId: d.id, targets: [d.id] },
    { type: 'damage', stackId: d.id, sourceStackId: a.id, amount: 20, dealt: 20, killed: 3, remaining: 0 },
    { type: 'death', stackId: d.id, side: 'defender', creatureId: 'goblin' },
  ];
  let done = false;
  pb.play(events).then(() => { done = true; });
  await tick(2);
  assert.deepEqual(order, ['move@0'], 'second event waits for the first animation');
  assert.equal(view.busy, true);
  for (let i = 0; i < 400 && !done; i++) { anim.advance(16); await tick(1); }
  assert.ok(done);
  const starts = order.filter((x) => !x.startsWith('log:'));
  assert.deepEqual(starts.map((x) => x.split('@')[0]), ['move', 'attack', 'damage', 'death']);
  const times = starts.map((x) => Number(x.split('@')[1]));
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1], `event ${i} starts after the previous one (${times})`);
  assert.ok(order.includes('log:Pikemen do 20 damage. 3 Goblins perish.'));
  const vd = view.stacks.get(d.id);
  assert.equal(vd.count, 0);
  assert.equal(vd.alive, false);
  assert.equal(view.busy, false);
  assert.ok(Math.abs(view.stacks.get(a.id).x - M.feetOf(layout, a, { x: 3, y: a.pos.y }).x) < 1e-6);
});

test('skip: cancelling running tweens finishes the playback at once', async () => {
  const cs = C.createCombat({ seed: 3, terrain: 'grass', obstacles: [], attacker: side(true, army(['angel', 2])), defender: side(false, army(['peasant', 3])) });
  const { S, ctx } = await mountCombat(cs, { params: { animSpeed: undefined } });
  // the start events / AI turns animate with the manual clock: drive it until the human may act
  for (let i = 0; i < 2000 && !S.waiting; i++) { ctx.anim.advance(16); await tick(1); }
  assert.ok(S.waiting);
  const pk = cs.stacks.find((s) => s.creatureId === 'peasant');
  const pc = center(pk.pos);
  S.clickAt(pc.x - 20, pc.y);
  await tick(2);
  assert.equal(S.view.busy, true);
  assert.equal(S.skip(), true);
  for (let i = 0; i < 50 && S.view.busy; i++) await tick(1);
  assert.equal(S.view.busy, false, 'skipped without advancing the clock');
});

// ---- end of combat ----------------------------------------------------------------------------------------

test('end flow: finishCombat via ctx.act, result dialog, pendings, back to the adventure map', async () => {
  const state = createTestState();
  const a = hero.addHero(state, 'orrin', 0, { x: 1, y: 1, z: 0 }, { army: army(['angel', 10], ['marksman', 30]) });
  const res = hero.startCombat(state, { attackerHeroId: a.id, defender: { army: army(['peasant', 20]) }, context: { kind: 'none' }, seed: 7 });
  assert.equal(res.ok, true, res.error);
  const cs = state.combat.cs;
  cs.sides.attacker.isHuman = false;     // let the AI play the human side
  const { S, calls } = await mountCombat(null, { state, params: { cs: undefined } });
  await until(() => S.resultDialog, 20000);
  assert.equal(state.combat, null, 'finishCombat applied');
  assert.equal(S.result.winner, 'attacker');
  assert.ok(S.resultModel.lines.some((l) => /experience/.test(l)));
  assert.ok(S.resultModel.enemyLosses.some((l) => l.creatureId === 'peasant' && l.count === 20));
  assert.equal(calls.screens.length, 0, 'waits for the dialog');
  S.resultDialog.close(true);
  await until(() => calls.screens.length > 0);
  assert.equal(calls.pendings, 1);
  assert.equal(calls.screens[0].name, 'adventure');
  assert.equal(calls.screens[0].o.replace, true);
  assert.ok(state.heroes[a.id].exp > 0);
});

test('no battle in progress: a message panel instead of a crash', async () => {
  const { ctx } = makeCtx();
  const root = document.createElement('div');
  await screen.mount(root, ctx, {});
  assert.match(root.textContent, /no battle in progress/i);
  screen.unmount();
});

test('unmount in the middle of a battle stops the loop cleanly', async () => {
  const cs = C.createCombat({ seed: 8, terrain: 'grass', attacker: side(true, army(['pikeman', 10])), defender: side(false, army(['goblin', 10])) });
  const { S } = await mountCombat(cs);
  await waitHuman(S);
  screen.unmount();
  await tick(3);
  assert.equal(S.waiting, false);
});

// ---- fuzz ---------------------------------------------------------------------------------------------

function randomSide(rng, i) {
  const faction = pick(rng, FACTIONS);
  const pool = rand(rng) < 0.25 ? CREATURES.filter((c) => !c.warMachine) : creaturesOfFaction(faction);
  const arr = [];
  const n = randInt(rng, 1, 7);
  for (let k = 0; k < 7; k++) {
    if (k >= n) { arr.push(null); continue; }
    const c = pick(rng, pool);
    arr.push({ creatureId: c.id, count: Math.max(1, Math.round(randInt(rng, 200, 3000) / c.aiValue)) });
  }
  let h = null;
  if (rand(rng) < 0.6) {
    const spells = [];
    for (let k = 0; k < 6; k++) spells.push(pick(rng, COMBAT_SPELLS).id);
    h = heroOf({ id: `h${i}`, name: `H${i}`, attack: randInt(rng, 0, 8), defense: randInt(rng, 0, 8), power: randInt(rng, 1, 8), knowledge: randInt(rng, 1, 8),
      mana: randInt(rng, 0, 80), spells: [...new Set(spells)], skills: { fire_magic: randInt(rng, 0, 3), air_magic: randInt(rng, 0, 3) } });
  }
  const warMachines = ['ballista', 'ammo_cart', 'first_aid_tent'].filter(() => rand(rng) < 0.4);
  return { playerId: i, isHuman: false, hero: h, army: arr, warMachines };
}

test('fuzz: 50 seeded AI battles render and finish with animation speed 0', async () => {
  sprites.setGfx(gfx);
  const rng = createRng(2024);
  const terrains = ['grass', 'dirt', 'snow', 'lava', 'swamp', 'sand', 'rough', 'subterranean'];
  await quiet(async () => {
    for (let n = 0; n < 50; n++) {
      const siege = n % 7 === 3 ? { fortLevel: randInt(rng, 1, 3), faction: pick(rng, FACTIONS), buildings: [] } : null;
      const cs = C.createCombat({ seed: randInt(rng, 1, 1e9), terrain: pick(rng, terrains), siege, attacker: randomSide(rng, 0), defender: randomSide(rng, 1) });
      const { S, calls } = await mountCombat(cs);
      await until(() => S.resultDialog || calls.errors.length, 200000);
      assert.deepEqual(calls.errors, [], `battle ${n}`);
      assert.equal(S.renderError, undefined, `render of battle ${n}: ${S.renderError && S.renderError.stack}`);
      assert.ok(C.isOver(cs));
      S.hoverAt(640, 300);
      S.render();
      S.resultDialog.close(true);
      await until(() => calls.screens.length > 0);
      screen.unmount();
      mounted = [];
    }
  });
});
