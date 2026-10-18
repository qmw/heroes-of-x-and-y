// Visual polish helpers (pure parts): combat arena fitting and unit scale, adventure minimap
// unexplored colour and town list stock, town 7-tier rows and ambient scenery planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fakeDom.js';

installFakeDom();
const V = await import('../../src/ui/screens/combat/view.js');
const M = await import('../../src/ui/screens/combat/model.js');
const advModel = await import('../../src/ui/screens/adventure/model.js');
const panel = await import('../../src/ui/screens/adventure/panel.js');
const townModel = await import('../../src/ui/screens/town/townModel.js');
const scenery = await import('../../src/ui/screens/town/scenery.js');
const { CREATURES } = await import('../../src/data/creatures.js');
const { FACTIONS_DATA: FACTIONS } = await import('../../src/data/factions.js');

test('combat: arena transform makes every listed floor cover the hex field and the canvas', () => {
  const field = V.fieldRect();
  assert.equal(Math.round(field.x + field.w / 2), M.CANVAS_W / 2, 'the field is centred');
  for (const a of V.ARENA_FLOORS) {
    const t = V.arenaTransform(a.floor, field);
    const [x0, y0, x1, y1] = a.floor;
    const fx0 = t.tx + x0 * 1280 * t.s; const fx1 = t.tx + x1 * 1280 * t.s;
    const fy0 = t.ty + y0 * 720 * t.s; const fy1 = t.ty + y1 * 720 * t.s;
    // floor covers the field (within a few px where the canvas clamp moves it)
    assert.ok(fx1 - fx0 >= field.w - 1 && fy1 - fy0 >= field.h - 1, `${a.match} floor big enough`);
    assert.ok(t.tx <= 0 && t.ty <= 0, `${a.match} no gap top-left`);
    assert.ok(t.tx + 1280 * t.s >= M.CANVAS_W - 0.5 && t.ty + 720 * t.s >= M.CANVAS_H - 0.5, `${a.match} no gap bottom-right`);
  }
});

test('combat: units scale with the hex (1.3-1.9x hex height, 2-hex larger, higher tiers taller)', () => {
  for (const c of CREATURES) {
    const body = V.stackBodyHeight(c.id);
    const ratio = body / V.HEX_H;
    assert.ok(ratio >= 1.25 && ratio <= 2.4, `${c.id} ratio ${ratio}`);
    const o = V.stackSpriteOpts(c.id);
    assert.equal(o.minBody, body);
    assert.ok(o.box.ay * 0.98 >= body, `${c.id} box tall enough`);
  }
  const pike = V.stackBodyHeight('pikeman');
  const angel = V.stackBodyHeight('angel');
  const dragon = V.stackBodyHeight('green_dragon');
  assert.ok(pike < angel && angel < dragon);
  assert.ok(pike / V.HEX_H >= 1.25 && angel / V.HEX_H >= 1.7);
});

test('adventure: unexplored minimap tiles are dark parchment (surface) / slate (underground), deterministic', () => {
  const a = advModel.unexploredRgb(3, 4, 0);
  assert.deepEqual(a, advModel.unexploredRgb(3, 4, 0));
  assert.ok(a[0] > a[2] && a[0] > 40, 'warm parchment, not black');
  const u = advModel.unexploredRgb(3, 4, 1);
  assert.ok(u[2] > u[0], 'cool underground');
});

test('adventure panel: town stock list keeps creatures ready to recruit, by tier', () => {
  const list = panel.townStockList({ stock: { angel: 1, pikeman: 12, archer: 0, nope: 3 } });
  assert.deepEqual(list.map((s) => s.creatureId), ['pikeman', 'angel']);
  assert.deepEqual(panel.townStockList({}), []);
});

test('town: tierRows lists all 7 tiers, built ones carry their growth row', () => {
  for (const f of FACTIONS) {
    const rows = townModel.tierRows({ faction: f.id }, []);
    assert.equal(rows.length, 7, f.id);
    assert.ok(rows.every((r) => r.built === false && r.name));
  }
  const fac = FACTIONS[0];
  const up = fac.creatures[2][1];
  const rows = townModel.tierRows({ faction: fac.id }, [{ creatureId: up, tier: 3, source: 'dwelling', available: 4, growth: 7, name: 'x' }]);
  assert.equal(rows[2].built, true);
  assert.equal(rows[2].available, 4);
  assert.equal(rows.filter((r) => r.built).length, 1);
});

test('town scenery: deterministic plan, props avoid built buildings and stay on the ground', () => {
  const occupied = [{ x: 280, y: 120, w: 240, h: 80 }, { x: 60, y: 220, w: 100, h: 80 }];
  for (const f of FACTIONS) {
    const a = scenery.planScenery(f.id, occupied, 42);
    const b = scenery.planScenery(f.id, occupied, 42);
    assert.deepEqual(a.props, b.props, `${f.id} deterministic`);
    assert.ok(a.props.length >= 8, `${f.id} has scenery`);
    for (const p of a.props) {
      assert.ok(p.y >= scenery.GROUND_Y && p.y <= scenery.SCENE_H, `${f.id} prop on the ground`);
      assert.ok(!occupied.some((o) => p.x > o.x && p.x < o.x + o.w && p.y > o.y && p.y < o.y + o.h), `${f.id} prop clear of buildings`);
    }
  }
  const empty = scenery.planScenery('castle', [], 1).props.length;
  const full = scenery.planScenery('castle', [{ x: 0, y: 190, w: 800, h: 184 }], 1).props.length;
  assert.ok(full < empty, 'a built-up town gets less clutter');
});

test('town scenery: no props in a faction no-props area (fortress pond)', () => {
  const pond = scenery.NO_PROPS.fortress[0];
  for (let seed = 1; seed < 20; seed++) {
    const plan = scenery.planScenery('fortress', [], seed);
    for (const p of plan.props) assert.ok(!(p.x > pond.x && p.x < pond.x + pond.w && p.y > pond.y && p.y < pond.y + pond.h), `prop at ${p.x},${p.y}`);
  }
});
