import test from 'node:test';
import assert from 'node:assert/strict';
import {
  W, H, neighbor, neighbors, hexDistance, directionTo, hexesInRadius, stackHexesAt, inBounds, hexIndex, hexFromIndex,
  hexSetDistance,
} from '../../src/engine/combat/hex.js';

test('battlefield is 15 x 11', () => {
  assert.equal(W, 15);
  assert.equal(H, 11);
  assert.equal(inBounds({ x: 14, y: 10 }), true);
  assert.equal(inBounds({ x: 15, y: 0 }), false);
  assert.equal(inBounds({ x: 0, y: -1 }), false);
  assert.deepEqual(hexFromIndex(hexIndex({ x: 7, y: 9 })), { x: 7, y: 9 });
});

test('neighbours: even rows lean left, odd rows are shifted right', () => {
  // E, SE, SW, W, NW, NE
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((d) => neighbor({ x: 5, y: 4 }, d)),
    [{ x: 6, y: 4 }, { x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 3 }]);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((d) => neighbor({ x: 5, y: 5 }, d)),
    [{ x: 6, y: 5 }, { x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 5 }, { x: 5, y: 4 }, { x: 6, y: 4 }]);
});

test('neighbour relation is symmetric and every neighbour is at distance 1', () => {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const h = { x, y };
      for (const n of neighbors(h)) {
        assert.equal(hexDistance(h, n), 1);
        assert.ok(neighbors(n).some((b) => b.x === x && b.y === y));
        assert.ok(directionTo(h, n) >= 0);
        assert.equal((directionTo(h, n) + 3) % 6, directionTo(n, h));
      }
    }
  }
  assert.equal(neighbors({ x: 0, y: 0 }).length, 2);
  assert.equal(neighbors({ x: 7, y: 5 }).length, 6);
  assert.equal(directionTo({ x: 0, y: 0 }, { x: 5, y: 5 }), -1);
});

test('hex distance', () => {
  assert.equal(hexDistance({ x: 3, y: 3 }, { x: 3, y: 3 }), 0);
  assert.equal(hexDistance({ x: 0, y: 0 }, { x: 14, y: 0 }), 14);
  assert.equal(hexDistance({ x: 0, y: 0 }, { x: 0, y: 10 }), 10);
  assert.equal(hexDistance({ x: 0, y: 0 }, { x: 14, y: 10 }), 19);
  assert.equal(hexDistance({ x: 0, y: 5 }, { x: 14, y: 5 }), 14);
  assert.equal(hexDistance({ x: 2, y: 2 }, { x: 3, y: 4 }), 2);
  assert.equal(hexDistance({ x: 5, y: 5 }, { x: 2, y: 9 }), hexDistance({ x: 2, y: 9 }, { x: 5, y: 5 }));
});

test('distance equals breadth-first steps on an empty field', () => {
  const start = { x: 6, y: 3 };
  const dist = new Map([[hexIndex(start), 0]]);
  let frontier = [start];
  while (frontier.length) {
    const next = [];
    for (const h of frontier) for (const n of neighbors(h)) if (!dist.has(hexIndex(n))) { dist.set(hexIndex(n), dist.get(hexIndex(h)) + 1); next.push(n); }
    frontier = next;
  }
  for (const [i, d] of dist) assert.equal(hexDistance(start, hexFromIndex(i)), d);
  assert.equal(dist.size, W * H);
});

test('radius and ring areas', () => {
  assert.equal(hexesInRadius({ x: 7, y: 5 }, 0).length, 1);
  assert.equal(hexesInRadius({ x: 7, y: 5 }, 1).length, 7);
  assert.equal(hexesInRadius({ x: 7, y: 5 }, 2).length, 19);
  assert.equal(hexesInRadius({ x: 7, y: 5 }, 1, 1).length, 6);
  assert.equal(hexesInRadius({ x: 0, y: 0 }, 1).length, 3);
});

test('two-hex creatures occupy the head hex and the hex behind it', () => {
  assert.deepEqual(stackHexesAt({ size: 1, side: 'attacker' }, { x: 5, y: 5 }), [{ x: 5, y: 5 }]);
  assert.deepEqual(stackHexesAt({ size: 2, side: 'attacker' }, { x: 5, y: 5 }), [{ x: 5, y: 5 }, { x: 4, y: 5 }]);
  assert.deepEqual(stackHexesAt({ size: 2, side: 'defender' }, { x: 5, y: 5 }), [{ x: 5, y: 5 }, { x: 6, y: 5 }]);
  assert.equal(hexSetDistance([{ x: 5, y: 5 }, { x: 4, y: 5 }], [{ x: 7, y: 5 }, { x: 8, y: 5 }]), 2);
});
