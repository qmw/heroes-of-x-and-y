// Zone placement on the grid: force-directed layout of the zone graph, then a power (weighted
// Voronoi) diagram over domain-warped tile coordinates whose weights are tuned until every zone
// has about its share of the area. Spec: docs/mechanics/mapgen.md §4.1.
import { rand } from '../../core/rng.js';
import { makeNoise } from './builder.js';

/**
 * Force-directed layout in the unit square.
 * @param {{size:number, type:string}[]} zones
 * @param {{ia:number, ib:number}[]} edges zone indices
 * @returns {{x:number, y:number, r:number}[]}
 */
export function forceLayout(rng, zones, edges) {
  const total = zones.reduce((s, z) => s + z.size, 0);
  const nodes = zones.map((z) => ({ x: 0.5, y: 0.5, r: Math.sqrt(z.size / total / Math.PI) }));
  const starts = zones.map((z, i) => (z.type === 'start' ? i : -1)).filter((i) => i >= 0);
  const rot = rand(rng) * Math.PI * 2;
  starts.forEach((i, k) => {
    const a = rot + (k / starts.length) * Math.PI * 2;
    nodes[i].x = 0.5 + Math.cos(a) * 0.36;
    nodes[i].y = 0.5 + Math.sin(a) * 0.36;
    nodes[i].fixed = true;
  });
  // others: average of placed neighbours (BFS order), pulled a little toward the centre
  const placed = new Set(starts);
  const adj = zones.map(() => []);
  for (const e of edges) { adj[e.ia].push(e.ib); adj[e.ib].push(e.ia); }
  for (let pass = 0; pass < zones.length && placed.size < zones.length; pass++) {
    for (let i = 0; i < zones.length; i++) {
      if (placed.has(i)) continue;
      const nb = adj[i].filter((j) => placed.has(j));
      if (!nb.length && pass < zones.length - 1) continue;
      const cx = nb.length ? nb.reduce((s, j) => s + nodes[j].x, 0) / nb.length : 0.5;
      const cy = nb.length ? nb.reduce((s, j) => s + nodes[j].y, 0) / nb.length : 0.5;
      const pull = nb.length === 1 ? 0.75 : 0.85;
      nodes[i].x = 0.5 + (cx - 0.5) * pull + (rand(rng) - 0.5) * 0.08;
      nodes[i].y = 0.5 + (cy - 0.5) * pull + (rand(rng) - 0.5) * 0.08;
      placed.add(i);
    }
  }
  if (!starts.length) for (const n of nodes) { n.x = 0.2 + rand(rng) * 0.6; n.y = 0.2 + rand(rng) * 0.6; }
  // relax
  for (let it = 0; it < 300; it++) {
    const t = 1 - it / 300;
    const fx = nodes.map(() => 0); const fy = nodes.map(() => 0);
    for (const e of edges) {
      const a = nodes[e.ia]; const b = nodes[e.ib];
      const dx = b.x - a.x; const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const want = (a.r + b.r) * 0.8;
      const f = (d - want) * 0.12;
      fx[e.ia] += (dx / d) * f; fy[e.ia] += (dy / d) * f;
      fx[e.ib] -= (dx / d) * f; fy[e.ib] -= (dy / d) * f;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]; const b = nodes[j];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const want = (a.r + b.r) * 1.05;
        if (d >= want) continue;
        const f = (want - d) * 0.12;
        fx[i] -= (dx / d) * f; fy[i] -= (dy / d) * f;
        fx[j] += (dx / d) * f; fy[j] += (dy / d) * f;
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const k = n.fixed ? 0.3 : 1;
      n.x += fx[i] * k * (0.5 + t); n.y += fy[i] * k * (0.5 + t);
      const m = Math.min(0.45, n.r * 0.7);
      n.x = Math.max(m, Math.min(1 - m, n.x)); n.y = Math.max(m, Math.min(1 - m, n.y));
    }
  }
  return nodes;
}

/**
 * Assign every tile to a zone (power diagram with tuned weights over warped coordinates).
 * @returns {Int16Array} zone index per tile (0..zones-1)
 */
export function assignZones(rng, W, H, nodes, sizes, { warp = 0.08 } = {}) {
  const n = nodes.length;
  const N = W * H;
  const total = sizes.reduce((a, b) => a + b, 0);
  const target = sizes.map((s) => (s / total) * N);
  const nx = makeNoise(rng, W, H, Math.max(6, Math.round(W / 7)));
  const ny = makeNoise(rng, W, H, Math.max(6, Math.round(W / 7)));
  const px = new Float32Array(N); const py = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      px[i] = (x + 0.5) / W + (nx[i] - 0.5) * warp * 2;
      py[i] = (y + 0.5) / H + (ny[i] - 0.5) * warp * 2;
    }
  }
  const w = nodes.map((nd) => nd.r * nd.r);
  const out = new Int16Array(N);
  const area = new Float64Array(n);
  for (let iter = 0; iter < 14; iter++) {
    area.fill(0);
    for (let i = 0; i < N; i++) {
      let best = 0; let bd = Infinity;
      for (let k = 0; k < n; k++) {
        const dx = px[i] - nodes[k].x; const dy = py[i] - nodes[k].y;
        const d = dx * dx + dy * dy - w[k];
        if (d < bd) { bd = d; best = k; }
      }
      out[i] = best;
      area[best]++;
    }
    if (iter === 13) break;
    for (let k = 0; k < n; k++) w[k] += ((target[k] - area[k]) / N / Math.PI) * 0.9;
  }
  return cleanupZones(out, W, H, n);
}

/** Keep only the largest 4-connected piece of each zone; orphans join a neighbouring zone. */
export function cleanupZones(zone, W, H, n) {
  const N = W * H;
  const comp = new Int32Array(N).fill(-1);
  const sizes = [];
  const compZone = [];
  for (let i = 0; i < N; i++) {
    if (comp[i] !== -1) continue;
    const id = sizes.length;
    const zn = zone[i];
    let cnt = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const c = stack.pop();
      cnt++;
      const x = c % W; const y = (c - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ax = x + dx; const ay = y + dy;
        if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
        const j = ay * W + ax;
        if (comp[j] === -1 && zone[j] === zn) { comp[j] = id; stack.push(j); }
      }
    }
    sizes.push(cnt);
    compZone.push(zn);
  }
  const best = new Array(n).fill(-1);
  for (let c = 0; c < sizes.length; c++) {
    const zn = compZone[c];
    if (best[zn] === -1 || sizes[c] > sizes[best[zn]]) best[zn] = c;
  }
  // flood orphans into neighbours (repeat until stable)
  let changed = true;
  for (let guard = 0; changed && guard < 50; guard++) {
    changed = false;
    for (let i = 0; i < N; i++) {
      if (best[zone[i]] === comp[i]) continue;
      const x = i % W; const y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ax = x + dx; const ay = y + dy;
        if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
        const j = ay * W + ax;
        if (best[zone[j]] === comp[j]) { zone[i] = zone[j]; comp[i] = comp[j]; changed = true; break; }
      }
    }
  }
  return zone;
}

/** Pairs of zone indices that share a 4-neighbour border, as a Set of 'a|b' (a<b). */
export function zoneAdjacency(zone, W, H) {
  const out = new Set();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = zone[y * W + x];
      if (x + 1 < W) { const b = zone[y * W + x + 1]; if (a !== b) out.add(a < b ? `${a}|${b}` : `${b}|${a}`); }
      if (y + 1 < H) { const b = zone[(y + 1) * W + x]; if (a !== b) out.add(a < b ? `${a}|${b}` : `${b}|${a}`); }
    }
  }
  return out;
}
