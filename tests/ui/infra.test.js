// Shortcut manager, animator / tween sequencing, canvas maths, stage fitting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, fire } from './fakeDom.js';

installFakeDom();
const ui = await import('../../src/ui/kit/index.js');

const ev = (key, extra = {}) => ({ key, prevented: false, preventDefault() { this.prevented = true; }, target: null, ...extra });

test('normalizeCombo / eventCombos / comboLabel', () => {
  assert.equal(ui.normalizeCombo('Shift+Ctrl+S'), 'ctrl+shift+s');
  assert.equal(ui.normalizeCombo('Esc'), 'escape');
  assert.equal(ui.normalizeCombo(' '), 'space');
  assert.equal(ui.normalizeCombo('cmd+z'), 'ctrl+z');
  assert.equal(ui.normalizeCombo('ctrl++'), 'ctrl++');
  assert.deepEqual(ui.eventCombos({ key: 'S', ctrlKey: true, shiftKey: true }), ['ctrl+shift+s', 'ctrl+s']);
  assert.deepEqual(ui.eventCombos({ key: ' ' }), ['space']);
  assert.deepEqual(ui.eventCombos({ key: 'Shift', shiftKey: true }), []);
  assert.equal(ui.comboLabel('ctrl+arrowleft'), 'Ctrl+Left');
  assert.equal(ui.comboLabel('e'), 'E');
});

test('shortcut manager: screen bindings win over global, are cleared per screen, and report handling', () => {
  const keys = ui.createShortcuts();
  const hits = [];
  keys.bindGlobal('f1', () => hits.push('help'), 'Help');
  keys.bindGlobal('e', () => hits.push('global-e'));
  keys.bind('e', () => hits.push('screen-e'), 'End turn');
  keys.bind(['arrowleft', 'a'], () => hits.push('left'));
  keys.bind('shift+a', () => hits.push('shift-a'));
  const e1 = ev('e');
  assert.equal(keys.handle(e1), true);
  assert.ok(e1.prevented);
  assert.equal(keys.handle(ev('E', { shiftKey: true })), true, 'shift+letter falls back to the plain binding');
  keys.handle(ev('a'));
  keys.handle(ev('A', { shiftKey: true }));
  keys.handle(ev('ArrowLeft'));
  keys.handle(ev('F1'));
  assert.equal(keys.handle(ev('x')), false);
  assert.deepEqual(hits, ['screen-e', 'screen-e', 'left', 'shift-a', 'left', 'help']);
  assert.deepEqual(keys.list().find((b) => b.combo === 'e'), { combo: 'e', description: 'End turn', scope: 'screen' });
  keys.clearScreen();
  keys.handle(ev('e'));
  assert.equal(hits.at(-1), 'global-e');
  assert.equal(keys.handle(ev('a')), false);
});

test('shortcut manager: ignores typing in text fields (except Escape / F-keys), unbind, enabled flag', () => {
  const keys = ui.createShortcuts();
  const hits = [];
  const off = keys.bind('e', () => hits.push('e'));
  keys.bind('escape', () => hits.push('esc'));
  keys.bind('f5', () => hits.push('f5'));
  const input = { tagName: 'INPUT', type: 'text' };
  assert.equal(keys.handle(ev('e', { target: input })), false);
  assert.equal(keys.handle(ev('Escape', { target: input })), true);
  assert.equal(keys.handle(ev('F5', { target: input })), true);
  assert.equal(keys.handle(ev('e', { target: { tagName: 'INPUT', type: 'checkbox' } })), true);
  off();
  assert.equal(keys.handle(ev('e')), false);
  keys.enabled = false;
  assert.equal(keys.handle(ev('Escape')), false);
  // a handler returning false does not prevent the default action
  keys.enabled = true;
  keys.bind('q', () => false);
  const e = ev('q');
  keys.handle(e);
  assert.equal(e.prevented, false);
  assert.deepEqual(hits, ['esc', 'f5', 'e']);
});

test('tween: interpolates with easing and resolves at the end', async () => {
  const anim = ui.createAnimator({ manual: true });
  const seen = [];
  let done = false;
  const p = anim.tween({ from: 0, to: 100, duration: 200, onUpdate: (v) => seen.push(Math.round(v)), onDone: () => { done = true; } });
  assert.deepEqual(seen, [0]);
  anim.advance(50);
  anim.advance(50);
  assert.deepEqual(seen, [0, 25, 50]);
  assert.equal(anim.active, 1);
  anim.advance(100);
  await p;
  assert.deepEqual(seen, [0, 25, 50, 100]);
  assert.ok(done);
  assert.equal(anim.active, 0);
  assert.equal(ui.EASE.outQuad(0.5), 0.75);
  assert.equal(ui.lerp(10, 20, 0.5), 15);
});

test('sequence runs steps in order, parallel together; delay honours speed', async () => {
  const anim = ui.createAnimator({ manual: true, speed: 2 });
  const order = [];
  const seq = ui.sequence([
    () => anim.tween({ duration: 100, onDone: () => order.push('walk') }),
    () => anim.delay(100).then(() => order.push('pause')),
    () => { order.push('sync'); return 42; },
    () => ui.parallel([anim.delay(50).then(() => order.push('p-short')), anim.delay(200).then(() => order.push('p-long'))]),
  ]);
  const pump = async (ms) => { anim.advance(ms); for (let i = 0; i < 5; i++) await Promise.resolve(); };
  await pump(40);
  assert.deepEqual(order, [], 'speed 2: 40ms of real time = 80ms of animation');
  await pump(10);
  assert.deepEqual(order, ['walk']);
  await pump(50);
  assert.deepEqual(order, ['walk', 'pause', 'sync']);
  await pump(25);
  assert.deepEqual(order, ['walk', 'pause', 'sync', 'p-short']);
  await pump(75);
  const out = await seq;
  assert.deepEqual(order, ['walk', 'pause', 'sync', 'p-short', 'p-long']);
  assert.equal(out[2], 42);
});

test('tween: cancel, cancelAll, zero duration, infinite speed, loop', async () => {
  const anim = ui.createAnimator({ manual: true });
  let last = null;
  const a = anim.tween({ from: 0, to: 10, duration: 100, onUpdate: (v) => { last = v; } });
  anim.advance(50);
  a.cancel();
  await a;
  assert.equal(last, 5, 'cancel() stops where it is');
  const b = anim.tween({ from: 0, to: 10, duration: 100, onUpdate: (v) => { last = v; } });
  b.cancel(true);
  await b;
  assert.equal(last, 10, 'cancel(true) jumps to the end');
  const c = anim.tween({ duration: 1000 });
  let ticks = 0;
  const loop = anim.loop(() => { ticks++; });
  anim.advance(16);
  anim.advance(16);
  assert.equal(ticks, 2);
  anim.cancelAll();
  await c;                                  // resolved by cancelAll: awaiting screens never hang
  assert.equal(loop.running, false);
  assert.equal(anim.active, 0);
  let instant = null;
  await anim.tween({ from: 1, to: 9, duration: 0, onUpdate: (v) => { instant = v; } });
  assert.equal(instant, 9);
  anim.setSpeed(Infinity);
  await anim.tween({ from: 1, to: 7, duration: 5000, onUpdate: (v) => { instant = v; } });
  assert.equal(instant, 7, 'infinite speed completes immediately');
  anim.setSpeed(1);
  let n = 0;
  anim.loop(() => { n++; return n < 3; });
  anim.advance(100, 10);
  assert.equal(n, 3, 'a loop stops when its callback returns false');
});

test('playEvents sequences engine events through async handlers and survives handler errors', async () => {
  const anim = ui.createAnimator({ manual: true });
  const log = [];
  const errors = [];
  const p = ui.playEvents(
    [{ type: 'hero_moved', to: 1 }, { type: 'boom' }, { type: 'unknown_thing' }, { type: 'hero_moved', to: 2 }],
    {
      hero_moved: async (e) => { log.push(`start ${e.to}`); await anim.delay(100); log.push(`end ${e.to}`); },
      boom: () => { throw new Error('animation bug'); },
      '*': (e) => log.push(`other ${e.type}`),
    },
    { onError: (err) => errors.push(err.message) });
  const pump = async (ms) => { anim.advance(ms); for (let i = 0; i < 6; i++) await Promise.resolve(); };
  await pump(0);
  assert.deepEqual(log, ['start 1']);
  await pump(100);
  assert.deepEqual(log, ['start 1', 'end 1', 'other unknown_thing', 'start 2']);
  await pump(100);
  await p;
  assert.equal(log.at(-1), 'end 2');
  assert.deepEqual(errors, ['animation bug']);
  await ui.playEvents(null, {});
});

test('real-time animator drives tweens from requestAnimationFrame', async () => {
  const frames = [];
  const anim = ui.createAnimator({ raf: (fn) => { frames.push(fn); return frames.length; }, caf: () => {} });
  let v = 0;
  const p = anim.tween({ from: 0, to: 1, duration: 32, onUpdate: (x) => { v = x; } });
  assert.equal(frames.length, 1);
  frames.shift()(1000);
  assert.equal(v, 0.5, 'first frame assumes 16ms');
  frames.shift()(1016);
  await p;
  assert.equal(v, 1);
  assert.equal(frames.length, 0, 'no frames are requested while idle');
});

test('camera: world/screen mapping, clamping, zoom about a point, visible cells', () => {
  const cam = ui.createCamera({ viewW: 400, viewH: 300, worldW: 1000, worldH: 800 });
  assert.deepEqual(cam.worldToScreen(100, 50), { x: 100, y: 50 });
  cam.panBy(-250, -100);
  assert.deepEqual([cam.x, cam.y], [250, 100]);
  cam.panBy(5000, 5000);
  assert.deepEqual([cam.x, cam.y], [0, 0], 'clamped to the world');
  cam.centerOn(500, 400);
  assert.deepEqual(cam.center(), { x: 500, y: 400 });
  const before = cam.screenToWorld(100, 100);
  cam.zoomAt(2, 100, 100);
  assert.equal(cam.zoom, 2);
  const after = cam.screenToWorld(100, 100);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9, 'the point under the cursor stays put');
  cam.zoomAt(100);
  assert.equal(cam.zoom, 4);
  cam.zoom = 1; cam.x = 64; cam.y = 32; cam.clampToWorld();
  assert.deepEqual(cam.visibleCells(32, 20, 20), { x0: 2, y0: 1, x1: 14, y1: 10 });
  assert.deepEqual(ui.cellAt(cam, 10, 10, 32), { x: 2, y: 1 });
  // a world smaller than the view is centred
  const small = ui.createCamera({ viewW: 400, viewH: 300, worldW: 200, worldH: 100 });
  assert.deepEqual([small.x, small.y], [-100, -100]);
});

test('hit regions and shapes', () => {
  const hits = ui.createHitRegions();
  hits.add({ x: 0, y: 0, w: 100, h: 100 }, 'panel');
  hits.add({ cx: 50, cy: 50, r: 10 }, 'button');
  hits.add({ points: [[200, 0], [300, 0], [250, 100]] }, 'triangle');
  assert.equal(hits.at(50, 50), 'button', 'later regions are on top');
  assert.equal(hits.at(5, 5), 'panel');
  assert.equal(hits.at(250, 40), 'triangle');
  assert.equal(hits.at(205, 90), null);
  assert.deepEqual(hits.all(50, 50), ['button', 'panel']);
  hits.clear();
  assert.equal(hits.at(50, 50), null);
  assert.ok(ui.pointInRect(1, 1, { x: 0, y: 0, w: 2, h: 2 }));
  assert.ok(!ui.pointInRect(2, 1, { x: 0, y: 0, w: 2, h: 2 }));
});

test('hex layout: odd rows are shifted right; pixel -> hex round-trips for the whole battlefield', () => {
  const hex = ui.createHexLayout({ w: 44, rowH: 38, originX: 60, originY: 90 });
  assert.equal(hex.center(0, 1).x - hex.center(0, 0).x, 22);
  assert.equal(hex.center(3, 0).x - hex.center(2, 0).x, 44);
  for (let y = 0; y < 11; y++) {
    for (let x = 0; x < 15; x++) {
      const c = hex.center(x, y);
      assert.deepEqual(hex.at(c.x, c.y), { x, y });
      assert.deepEqual(hex.at(c.x + 9, c.y - 7), { x, y });
      assert.ok(ui.pointInPolygon(c.x, c.y, hex.polygon(x, y)));
    }
  }
});

test('createCanvas is DPR aware; eventPos undoes the CSS scale; pan/zoom wiring', () => {
  const cv = ui.createCanvas(200, 100, { dpr: 2 });
  assert.equal(cv.canvas.width, 400);
  assert.equal(cv.canvas.style.width, '200px');
  cv.resize(300, 150);
  assert.equal(cv.canvas.height, 300);
  // the stage is scaled 2x on screen: the rect is twice the logical size
  cv.canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 600, height: 300 });
  assert.deepEqual(ui.eventPos(cv.canvas, { clientX: 310, clientY: 170 }), { x: 150, y: 75 });

  document.body.appendChild(cv.canvas);      // so mouseup bubbles to window as in a browser
  const cam = ui.createCamera({ viewW: 300, viewH: 150, worldW: 2000, worldH: 2000 });
  const clicks = [];
  let changes = 0;
  const off = ui.enablePanZoom(cv.canvas, cam, { onChange: () => changes++, onClick: (p) => clicks.push(p) });
  fire(cv.canvas, 'mousedown', { button: 0, clientX: 210, clientY: 120 });
  fire(window, 'mousemove', { clientX: 110, clientY: 70 });
  fire(window, 'mouseup', { clientX: 110, clientY: 70 });
  assert.deepEqual([cam.x, cam.y], [50, 25], 'dragging 50 logical px left/up scrolls the world');
  assert.equal(clicks.length, 0, 'a drag is not a click');
  fire(cv.canvas, 'mousedown', { button: 0, clientX: 210, clientY: 120 });
  fire(cv.canvas, 'mouseup', { clientX: 212, clientY: 120 });
  assert.deepEqual(clicks, [{ x: 101, y: 50 }]);
  fire(cv.canvas, 'wheel', { deltaY: -1, clientX: 10, clientY: 20 });
  assert.ok(cam.zoom > 1);
  assert.ok(changes >= 2);
  off();
  const z = cam.zoom;
  fire(cv.canvas, 'wheel', { deltaY: -1 });
  assert.equal(cam.zoom, z);
});

test('stage fitting letterboxes and converts client coordinates', () => {
  assert.deepEqual(ui.fitStage(1280, 720), { scale: 1, left: 0, top: 0 });
  assert.deepEqual(ui.fitStage(2560, 1440), { scale: 2, left: 0, top: 0 });
  const wide = ui.fitStage(1920, 720);
  assert.deepEqual(wide, { scale: 1, left: 320, top: 0 });
  const tall = ui.fitStage(640, 720);
  assert.deepEqual(tall, { scale: 0.5, left: 0, top: 180 });
  assert.equal(ui.fitStage(1280, 720, 0.5).scale, 0.5);
  assert.equal(ui.fitStage(1280, 720, 3).scale, 1, 'UI scale never exceeds the fit');
  assert.deepEqual(ui.clientToStage(10, 20), { x: 10, y: 20 }, 'identity without a stage');
  const el = document.createElement('div');
  ui.placeInStage(el, 1270, 715, { width: 100, height: 50 });
  assert.equal(el.style.left, '1156px');
  assert.equal(el.style.top, '647px');
});
