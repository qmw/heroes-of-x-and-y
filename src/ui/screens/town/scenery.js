// Ambient town scenery: an original procedural layer between the town backdrop and the buildings.
// Paths, trees / rocks / faction props on the free ground (props avoid the *built* buildings, so a
// young town looks lived-in and the clutter gives way as it grows), plus a light animation layer:
// faction banners waving, campfire smoke and drifting motes (fireflies, embers, snow, wisps...).
// Deterministic per town (seeded), no assets. Pure painting helpers + a small controller.

export const SCENE_W = 800;
export const SCENE_H = 374;
/** Ground starts here (backdrop horizon). */
export const GROUND_Y = 196;

/** Per-faction look: path colour, prop kinds, foliage / rock colours, banner, motes. */
export const SCENERY_STYLES = {
  castle:     { path: '#a58a5c', props: ['oak', 'oak', 'bush', 'rock', 'fence', 'hay'], leaf: '#4f7f36', trunk: '#5a3c22', rock: '#8a8a80', banner: '#c83a2a', motes: 'birds' },
  rampart:    { path: '#9a8458', props: ['oak', 'oak', 'oak', 'bush', 'flowers', 'rock'], leaf: '#3c7a34', trunk: '#4e3420', rock: '#7e8478', banner: '#3a8a3a', motes: 'fireflies' },
  tower:      { path: '#c8ccd2', props: ['pine', 'pine', 'rock', 'crystal', 'snowbank'], leaf: '#2e5a4a', trunk: '#4a3a2c', rock: '#9aa4b0', banner: '#3a6ab8', motes: 'snow' },
  inferno:    { path: '#5a2a18', props: ['deadtree', 'spike', 'spike', 'rock', 'lavacrack'], leaf: '#3a1a10', trunk: '#2a120a', rock: '#4a2418', banner: '#d84a1a', motes: 'embers' },
  necropolis: { path: '#6a6250', props: ['deadtree', 'grave', 'grave', 'rock', 'bones'], leaf: '#3a3a2e', trunk: '#3a3226', rock: '#6a665a', banner: '#5a4a7a', motes: 'wisps' },
  dungeon:    { path: '#4a3c4e', props: ['stalagmite', 'stalagmite', 'mushroom', 'mushroom', 'rock'], leaf: '#6a3a8a', trunk: '#3a2a3e', rock: '#4e4456', banner: '#8a3ab8', motes: 'spores' },
  stronghold: { path: '#b48a52', props: ['cactus', 'rock', 'rock', 'bones', 'bush'], leaf: '#6a8a3a', trunk: '#6a4a2a', rock: '#9a7a52', banner: '#b84a1a', motes: 'dust' },
  fortress:   { path: '#6a6a3e', props: ['mangrove', 'reeds', 'reeds', 'bush', 'rock'], leaf: '#3e6a3a', trunk: '#5a4630', rock: '#5e6650', banner: '#4a7a2a', motes: 'fireflies' },
  conflux:    { path: '#9a90c8', props: ['crystal', 'crystal', 'floatrock', 'rock', 'flowers'], leaf: '#7a6ad0', trunk: '#4a3a6a', rock: '#8078b0', banner: '#7a4ad8', motes: 'sparkles' },
  cove:       { path: '#d4bc84', props: ['palm', 'palm', 'barrel', 'rock', 'bush'], leaf: '#3a8a5a', trunk: '#7a5a3a', rock: '#a09070', banner: '#1a7aa8', motes: 'birds' },
  factory:    { path: '#8a7a5a', props: ['crate', 'crate', 'gear', 'pipe', 'rock'], leaf: '#6a7a4a', trunk: '#4a3a2a', rock: '#7a7060', banner: '#c8902a', motes: 'soot' },
};

/**
 * Areas of each faction backdrop where no props / fires / banners go (ponds, the sea shore), in
 * 800x374 view coordinates. Matches the procedural backdrops of src/gfx/towns.js.
 */
export const NO_PROPS = {
  fortress: [{ x: 0, y: 292, w: 300, h: 82 }],
  cove: [{ x: 540, y: 292, w: 260, h: 82 }],
};

/** Seeded 0..1 generator. */
export function sceneRng(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
}
export function hashString(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) >>> 0; } return x; }

const overlaps = (a, b, pad = 0) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

/**
 * Where the scenery goes: paths, prop placements, banners, fires. Pure (tested).
 * @param {string} faction
 * @param {{x,y,w,h}[]} occupied rects of built buildings (800x374 view coords)
 * @param {number} seed
 */
export function planScenery(faction, occupied = [], seed = 1) {
  const style = SCENERY_STYLES[faction] || SCENERY_STYLES.castle;
  const r = sceneRng(seed);
  const props = [];
  const taken = [...occupied, ...(NO_PROPS[faction] || [])].map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }));
  // the main path: from the bottom edge to the fort gate, gently curving
  const gateX = 400 + (r() - 0.5) * 40;
  const path = [{ x: 380 + (r() - 0.5) * 120, y: SCENE_H + 10 }, { x: 330 + r() * 140, y: 300 }, { x: gateX, y: 232 }, { x: gateX, y: GROUND_Y + 4 }];
  const branch = [{ x: path[1].x, y: 300 }, { x: r() < 0.5 ? 120 : 680, y: 270 + r() * 40 }];
  const onPath = (x, y) => [...path, ...branch].some((p) => Math.abs(p.x - x) < 34 && Math.abs(p.y - y) < 30);
  let tries = 0;
  while (props.length < 26 && tries < 400) {
    tries++;
    const kind = style.props[Math.floor(r() * style.props.length)];
    const y = GROUND_Y + 14 + r() * (SCENE_H - GROUND_Y - 18);
    const depth = (y - GROUND_Y) / (SCENE_H - GROUND_Y);           // 0 far .. 1 near
    const s = 0.55 + depth * 0.75;
    const big = ['oak', 'pine', 'deadtree', 'mangrove', 'palm', 'stalagmite', 'crystal', 'cactus'].includes(kind);
    const w = (big ? 34 : 22) * s;
    const h = (big ? 56 : 18) * s;
    const x = 10 + r() * (SCENE_W - 20);
    const box = { x: x - w / 2, y: y - h, w, h };
    if (taken.some((o) => overlaps(o, box, 4)) || onPath(x, y)) continue;
    taken.push(box);
    props.push({ kind, x: Math.round(x), y: Math.round(y), s: +s.toFixed(2), flip: r() < 0.5, v: r() });
  }
  props.sort((a, b) => a.y - b.y);
  const banners = [];
  for (const bx of [path[1].x - 46, path[1].x + 46]) {
    const box = { x: bx - 8, y: 250, w: 16, h: 56 };
    if (!taken.some((o) => overlaps(o, box, 2))) { banners.push({ x: Math.round(bx), y: 304 }); taken.push(box); }
  }
  const fires = [];
  for (let i = 0; i < 12 && fires.length < (style.motes === 'snow' ? 1 : 2); i++) {
    const x = 40 + r() * 720; const y = 250 + r() * 100;
    const box = { x: x - 14, y: y - 12, w: 28, h: 16 };
    if (taken.some((o) => overlaps(o, box, 6)) || onPath(x, y)) continue;
    taken.push(box);
    fires.push({ x: Math.round(x), y: Math.round(y) });
  }
  return { style, path, branch, props, banners, fires };
}

// ---- painting ----------------------------------------------------------------------------------

function shade(hex, amt) {
  const n = parseInt(String(hex).slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function strokePath(g, pts, width, color) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2; const my = (pts[i].y + pts[i + 1].y) / 2;
    g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  g.lineTo(last.x, last.y);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = width; g.strokeStyle = color; g.stroke();
}

function ellipse(g, x, y, rx, ry, fill, stroke) {
  g.beginPath(); g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = 1.2; g.strokeStyle = stroke; g.stroke(); }
}
function poly(g, pts, fill, stroke) {
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.lineWidth = 1.2; g.strokeStyle = stroke; g.stroke(); }
}

const OUTLINE = 'rgba(20, 14, 8, 0.85)';

/** One prop at its foot point (x, y), scale s. All shapes original, outlined like the map objects. */
export function paintProp(g, p, style) {
  const { x, y, s } = p;
  g.save();
  g.translate(x, y);
  if (p.flip) g.scale(-1, 1);
  g.scale(s, s);
  ellipse(g, 0, 0, 14, 4, 'rgba(0,0,0,0.28)');
  const leaf = style.leaf; const trunk = style.trunk; const rock = style.rock;
  switch (p.kind) {
    case 'oak':
      poly(g, [[-3, 0], [-2, -22], [2, -22], [3, 0]], trunk, OUTLINE);
      ellipse(g, 0, -34, 17, 15, shade(leaf, -0.1), OUTLINE);
      ellipse(g, -8, -30, 9, 8, leaf);
      ellipse(g, 6, -40, 9, 7, shade(leaf, 0.18));
      break;
    case 'pine':
      poly(g, [[-2, 0], [-2, -8], [2, -8], [2, 0]], trunk, OUTLINE);
      for (let i = 0; i < 3; i++) poly(g, [[-15 + i * 3, -8 - i * 13], [0, -30 - i * 13], [15 - i * 3, -8 - i * 13]], shade(leaf, i * 0.08), OUTLINE);
      if (style.motes === 'snow') poly(g, [[-5, -44], [0, -52], [5, -44]], '#f2f6fa');
      break;
    case 'deadtree':
      g.lineCap = 'round'; g.strokeStyle = trunk; g.lineWidth = 4;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(1, -26); g.moveTo(1, -16); g.lineTo(-10, -30); g.moveTo(1, -22); g.lineTo(11, -36); g.moveTo(-6, -24); g.lineTo(-8, -38); g.stroke();
      g.lineWidth = 1; g.strokeStyle = OUTLINE; g.stroke();
      break;
    case 'mangrove':
      g.strokeStyle = trunk; g.lineWidth = 2.5;
      g.beginPath(); for (const dx of [-10, -4, 4, 10]) { g.moveTo(0, -14); g.quadraticCurveTo(dx, -8, dx * 1.2, 0); } g.stroke();
      ellipse(g, 0, -26, 16, 12, leaf, OUTLINE);
      ellipse(g, 5, -30, 7, 5, shade(leaf, 0.2));
      break;
    case 'palm':
      g.strokeStyle = trunk; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(5, -18, 2, -38); g.stroke();
      for (const a of [-2.6, -2.0, -1.2, -0.5, 0.2]) { g.save(); g.translate(2, -38); g.rotate(a); poly(g, [[0, -2], [20, 2], [0, 3]], leaf, OUTLINE); g.restore(); }
      break;
    case 'bush':
      ellipse(g, -6, -6, 9, 7, shade(leaf, -0.1), OUTLINE); ellipse(g, 5, -7, 9, 8, leaf, OUTLINE); ellipse(g, 2, -11, 5, 4, shade(leaf, 0.2));
      break;
    case 'flowers':
      ellipse(g, 0, -3, 12, 4, shade(leaf, -0.15));
      for (let i = 0; i < 6; i++) ellipse(g, -9 + i * 3.6, -5 - (i % 2) * 2, 1.8, 1.8, ['#f0d040', '#e05a8a', '#f4f4f4'][i % 3]);
      break;
    case 'rock':
      poly(g, [[-12, 0], [-9, -9], [-1, -13], [8, -9], [12, 0]], rock, OUTLINE);
      poly(g, [[-6, -8], [-1, -12], [5, -9], [0, -6]], shade(rock, 0.25));
      break;
    case 'crystal':
      poly(g, [[-6, 0], [-4, -20], [0, -30], [4, -20], [6, 0]], shade(leaf, 0.1), OUTLINE);
      poly(g, [[4, 0], [8, -12], [11, -16], [12, 0]], shade(leaf, -0.1), OUTLINE);
      poly(g, [[-2, -20], [0, -28], [1, -18]], 'rgba(255,255,255,0.6)');
      break;
    case 'floatrock':
      poly(g, [[-10, -22], [10, -22], [4, -12], [-4, -12]], rock, OUTLINE);
      ellipse(g, 0, -23, 10, 3, shade(rock, 0.25));
      break;
    case 'snowbank':
      ellipse(g, 0, -4, 16, 6, '#eef3f8', 'rgba(90,110,130,0.8)');
      break;
    case 'spike':
      poly(g, [[-7, 0], [-2, -24], [1, -8], [4, -18], [8, 0]], rock, OUTLINE);
      break;
    case 'lavacrack':
      g.strokeStyle = '#ff8a2a'; g.lineWidth = 2; g.beginPath(); g.moveTo(-14, -1); g.lineTo(-4, -3); g.lineTo(2, 0); g.lineTo(13, -2); g.stroke();
      g.strokeStyle = 'rgba(255, 200, 80, 0.6)'; g.lineWidth = 1; g.stroke();
      break;
    case 'grave':
      poly(g, [[-6, 0], [-6, -14], [-3, -18], [3, -18], [6, -14], [6, 0]], '#8a8a84', OUTLINE);
      g.fillStyle = 'rgba(30,30,30,0.6)'; g.fillRect(-1, -14, 2, 8); g.fillRect(-3, -12, 6, 2);
      break;
    case 'bones':
      g.strokeStyle = '#e8e2cc'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(-8, -2); g.lineTo(6, -4); g.moveTo(-4, -6); g.lineTo(4, 0); g.stroke();
      ellipse(g, 8, -5, 3.5, 3, '#e8e2cc', OUTLINE);
      break;
    case 'stalagmite':
      poly(g, [[-8, 0], [-2, -34], [1, -30], [8, 0]], rock, OUTLINE);
      poly(g, [[-2, -30], [0, -34], [1, -22]], shade(rock, 0.3));
      break;
    case 'mushroom':
      poly(g, [[-2, 0], [-2, -9], [2, -9], [2, 0]], '#d8ccb8', OUTLINE);
      ellipse(g, 0, -10, 9, 5, leaf, OUTLINE);
      ellipse(g, -3, -11, 1.5, 1, '#f4e8ff'); ellipse(g, 3, -12, 1.2, 1, '#f4e8ff');
      break;
    case 'cactus':
      g.lineCap = 'round'; g.strokeStyle = leaf; g.lineWidth = 6;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -26); g.moveTo(0, -12); g.lineTo(-7, -14); g.lineTo(-7, -20); g.moveTo(0, -16); g.lineTo(6, -18); g.lineTo(6, -24); g.stroke();
      break;
    case 'reeds':
      g.strokeStyle = shade(leaf, -0.05); g.lineWidth = 1.5; g.beginPath();
      for (let i = -3; i <= 3; i++) { g.moveTo(i * 2.5, 0); g.quadraticCurveTo(i * 3, -10, i * 4, -18 - Math.abs(i)); }
      g.stroke();
      for (const i of [-2, 1, 3]) ellipse(g, i * 4, -18 - Math.abs(i), 1.6, 3.5, '#6a4a2a');
      break;
    case 'fence':
      g.fillStyle = '#7a5a36'; for (const fx of [-12, -4, 4, 12]) g.fillRect(fx - 1.5, -12, 3, 12);
      g.fillRect(-14, -9, 28, 2); g.fillRect(-14, -5, 28, 2);
      break;
    case 'hay':
      ellipse(g, 0, -6, 10, 7, '#d8b85a', OUTLINE); g.strokeStyle = 'rgba(120,90,30,0.6)'; g.beginPath(); g.moveTo(-8, -6); g.lineTo(8, -6); g.stroke();
      break;
    case 'barrel':
      poly(g, [[-6, 0], [-7, -7], [-6, -14], [6, -14], [7, -7], [6, 0]], '#8a5a2e', OUTLINE);
      g.fillStyle = '#3a3a3a'; g.fillRect(-7, -10, 14, 1.5); g.fillRect(-7, -4, 14, 1.5);
      break;
    case 'crate':
      g.fillStyle = '#9a7442'; g.fillRect(-8, -14, 16, 14); g.strokeStyle = OUTLINE; g.lineWidth = 1.2; g.strokeRect(-8, -14, 16, 14);
      g.beginPath(); g.moveTo(-8, -14); g.lineTo(8, 0); g.moveTo(8, -14); g.lineTo(-8, 0); g.strokeStyle = 'rgba(60,40,20,0.7)'; g.stroke();
      break;
    case 'gear':
      g.fillStyle = '#7a7a80';
      for (let i = 0; i < 8; i++) { g.save(); g.translate(0, -10); g.rotate((i * Math.PI) / 4); g.fillRect(-2, -10, 4, 4); g.restore(); }
      ellipse(g, 0, -10, 8, 8, '#8a8a90', OUTLINE); ellipse(g, 0, -10, 3, 3, '#3a3a40');
      break;
    case 'pipe':
      g.fillStyle = '#6a6a70'; g.fillRect(-12, -6, 24, 6); g.fillRect(8, -18, 6, 18);
      g.strokeStyle = OUTLINE; g.lineWidth = 1; g.strokeRect(-12, -6, 24, 6); g.strokeRect(8, -18, 6, 18);
      break;
    default:
      ellipse(g, 0, -6, 8, 6, rock, OUTLINE);
  }
  g.restore();
}

/** Static scenery (paths + props + banner poles + fire pits). */
export function paintScenery(g, plan) {
  const { style } = plan;
  // paths: dark edge, fill, light centre
  for (const pts of [plan.path, plan.branch]) {
    strokePath(g, pts, 34, 'rgba(0,0,0,0.18)');
    strokePath(g, pts, 28, style.path);
    strokePath(g, pts, 12, shade(style.path, 0.15));
  }
  const pr = sceneRng(7);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 40; i++) { const p = plan.path[1 + Math.floor(pr() * 2)]; g.fillRect(p.x + (pr() - 0.5) * 40, p.y + (pr() - 0.5) * 60, 2, 2); }
  for (const f of plan.fires) {
    ellipse(g, f.x, f.y, 11, 4, 'rgba(0,0,0,0.35)');
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ellipse(g, f.x + Math.cos(a) * 9, f.y + Math.sin(a) * 3, 3, 2, '#7a7468', OUTLINE); }
    g.strokeStyle = '#4a2e18'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(f.x - 6, f.y); g.lineTo(f.x + 6, f.y - 3); g.moveTo(f.x + 6, f.y); g.lineTo(f.x - 6, f.y - 3); g.stroke();
  }
  for (const b of plan.banners) {
    ellipse(g, b.x, b.y, 6, 2, 'rgba(0,0,0,0.35)');
    g.fillStyle = '#4a3420'; g.fillRect(b.x - 1.5, b.y - 52, 3, 52);
    ellipse(g, b.x, b.y - 53, 2.5, 2.5, '#d8b050');
  }
  for (const p of plan.props) paintProp(g, p, style);
}

/** Animated overlay at time t (seconds): banners, fire + smoke, motes. */
export function paintAmbience(g, plan, t) {
  const { style } = plan;
  for (const b of plan.banners) {
    const x0 = b.x + 1.5; const y0 = b.y - 50;
    g.beginPath();
    g.moveTo(x0, y0);
    for (let i = 1; i <= 6; i++) { const u = i / 6; g.lineTo(x0 + u * 22, y0 + Math.sin(t * 4 + u * 4 + b.x) * 2.5 * u); }
    for (let i = 6; i >= 0; i--) { const u = i / 6; g.lineTo(x0 + u * 20, y0 + 14 - u * 2 + Math.sin(t * 4 + u * 4 + b.x) * 2.5 * u); }
    g.closePath();
    g.fillStyle = style.banner; g.fill();
    g.lineWidth = 1; g.strokeStyle = OUTLINE; g.stroke();
  }
  for (const f of plan.fires) {
    const fl = 0.75 + 0.25 * Math.sin(t * 13 + f.x);
    poly(g, [[f.x - 5, f.y - 2], [f.x, f.y - 14 * fl], [f.x + 5, f.y - 2]], '#ff9a2a');
    poly(g, [[f.x - 2.5, f.y - 2], [f.x, f.y - 8 * fl], [f.x + 2.5, f.y - 2]], '#ffe27a');
    for (let i = 0; i < 6; i++) {
      const k = ((t * 0.35 + i / 6) % 1);
      const sx = f.x + Math.sin(k * 6 + i) * 6 * k + k * 10;
      const sy = f.y - 16 - k * 70;
      g.globalAlpha = (1 - k) * 0.35;
      ellipse(g, sx, sy, 4 + k * 10, 3 + k * 8, '#c8c4bc');
    }
    g.globalAlpha = 1;
  }
  const kind = style.motes;
  const rr = sceneRng(99);
  const n = kind === 'birds' ? 3 : 18;
  for (let i = 0; i < n; i++) {
    const bx = rr() * SCENE_W; const by = rr() * SCENE_H; const sp = 0.4 + rr();
    let x; let y; let a = 1;
    switch (kind) {
      case 'birds': {
        x = (bx + t * 26 * sp) % (SCENE_W + 60) - 30; y = 30 + by * 0.25 + Math.sin(t + i) * 6;
        const w = Math.sin(t * 8 + i * 2) * 3;
        g.strokeStyle = 'rgba(30,26,22,0.8)'; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(x - 5, y - w); g.lineTo(x, y); g.lineTo(x + 5, y - w); g.stroke();
        continue;
      }
      case 'snow': x = (bx + Math.sin(t + i) * 12) % SCENE_W; y = (by + t * 22 * sp) % SCENE_H; g.fillStyle = 'rgba(255,255,255,0.85)'; break;
      case 'embers': x = bx + Math.sin(t * 2 + i) * 8; y = SCENE_H - ((SCENE_H - by + t * 30 * sp) % SCENE_H); g.fillStyle = 'rgba(255,150,50,0.9)'; a = y / SCENE_H; break;
      case 'soot': x = bx + t * 8 * sp % 40; y = SCENE_H * 0.5 - ((t * 12 * sp + by) % (SCENE_H * 0.5)); g.fillStyle = 'rgba(40,36,30,0.55)'; break;
      case 'dust': x = (bx + t * 30 * sp) % SCENE_W; y = GROUND_Y + (by % (SCENE_H - GROUND_Y)); g.fillStyle = 'rgba(230,200,150,0.5)'; break;
      case 'wisps': x = bx + Math.sin(t * 0.7 + i) * 20; y = GROUND_Y + (by % (SCENE_H - GROUND_Y)) + Math.cos(t + i) * 6; g.fillStyle = 'rgba(170,255,200,0.55)'; a = 0.5 + 0.5 * Math.sin(t * 2 + i); break;
      case 'spores': x = bx + Math.sin(t * 0.5 + i) * 14; y = by - (t * 6 * sp % 60); g.fillStyle = 'rgba(210,150,255,0.7)'; break;
      case 'sparkles': x = bx; y = by; g.fillStyle = 'rgba(255,255,255,0.95)'; a = Math.max(0, Math.sin(t * 3 + i * 1.7)); break;
      default: x = bx + Math.sin(t * 0.8 + i) * 16; y = GROUND_Y + 20 + (by % (SCENE_H - GROUND_Y - 20)) + Math.sin(t * 1.3 + i) * 8; g.fillStyle = 'rgba(230,255,120,0.85)'; a = 0.4 + 0.6 * Math.max(0, Math.sin(t * 2.2 + i * 1.3));
    }
    g.globalAlpha = Math.max(0, Math.min(1, a));
    g.beginPath(); g.arc(x, y, kind === 'snow' ? 1.6 : 1.4, 0, Math.PI * 2); g.fill();
    if (kind === 'fireflies' || kind === 'sparkles' || kind === 'wisps') { g.globalAlpha *= 0.3; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  }
}
