// Main menu with an animated procedural landscape (canvas; creatures drawn through the sprite
// wrapper so it works with or without the gfx module).
import { CREATURES } from '../../data/creatures.js';
import { FACTIONS_DATA } from '../../data/factions.js';
import { STAGE_W, STAGE_H } from '../kit/stage.js';

let loop = null;

/** Deterministic pseudo-random stream for the scenery (pure). */
export function makeNoise(seed = 7) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build the static description of the scene (pure, unit-testable). */
export function buildScene(seed = 7) {
  const rnd = makeNoise(seed);
  const stars = Array.from({ length: 90 }, () => ({ x: rnd() * STAGE_W, y: rnd() * STAGE_H * 0.5, r: 0.5 + rnd() * 1.3, tw: rnd() * 6.28 }));
  const ridges = [0, 1, 2, 3].map((i) => ({
    base: 330 + i * 78, amp: 70 - i * 12, speed: 4 + i * 9,
    waves: [0, 1, 2].map(() => ({ k: 0.002 + rnd() * 0.006, a: 0.4 + rnd() * 0.6, p: rnd() * 6.28 })),
    color: ['#1d2338', '#1f2a2f', '#1e3024', '#182818'][i],
  }));
  const clouds = Array.from({ length: 7 }, () => ({ x: rnd() * STAGE_W, y: 40 + rnd() * 190, w: 120 + rnd() * 200, speed: 3 + rnd() * 8, a: 0.05 + rnd() * 0.09 }));
  const walkers = [];
  const pool = FACTIONS_DATA.map((f) => f.creatures.map((pair) => pair[0]));
  const faction = pool[Math.floor(rnd() * pool.length)] || [];
  const ids = faction.filter((id) => CREATURES.some((c) => c.id === id));
  for (let i = 0; i < ids.length; i++) {
    walkers.push({ id: ids[i], x: -80 - i * 150 - rnd() * 40, y: 596 + (i % 2) * 22, speed: 22 + rnd() * 6, size: 64 + (i > 4 ? 14 : 0), phase: rnd() * 6.28 });
  }
  const towers = Array.from({ length: 5 }, (_, i) => ({ x: 820 + i * 46 + rnd() * 10, w: 26 + rnd() * 14, hgt: 60 + rnd() * 80 }));
  return { stars, ridges, clouds, walkers, towers };
}

function ridgeY(r, x, t) {
  let y = 0;
  for (const w of r.waves) y += Math.sin((x + t * r.speed) * w.k + w.p) * w.a;
  return r.base - y * r.amp * 0.5;
}

function drawScene(ctx, scene, t, drawSprite) {
  const W = STAGE_W;
  const H = STAGE_H;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0a0d1e');
  sky.addColorStop(0.45, '#2a2140');
  sky.addColorStop(0.7, '#7a4030');
  sky.addColorStop(1, '#d08a3a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  for (const s of scene.stars) {
    ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.8 + s.tw));
    ctx.fillStyle = '#fff4d0';
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  // low sun with a glow
  const sunX = 930;
  const sunY = 372 + Math.sin(t * 0.05) * 6;
  const glow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 260);
  glow.addColorStop(0, 'rgba(255, 226, 150, 0.95)');
  glow.addColorStop(0.15, 'rgba(255, 180, 90, 0.5)');
  glow.addColorStop(1, 'rgba(255, 150, 60, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - 260, sunY - 260, 520, 520);

  for (const c of scene.clouds) {
    const x = ((c.x + t * c.speed) % (W + c.w * 2)) - c.w;
    ctx.fillStyle = `rgba(255, 220, 190, ${c.a})`;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(x + i * c.w * 0.22, c.y + Math.sin(i * 1.7) * 8, c.w * 0.3, 16 + i * 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  scene.ridges.forEach((r, i) => {
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) ctx.lineTo(x, ridgeY(r, x, t));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    if (i === 1) {
      // a distant castle silhouette on the second ridge
      ctx.fillStyle = '#141a22';
      for (const tw of scene.towers) {
        const baseY = ridgeY(r, tw.x, t) + 6;
        ctx.fillRect(tw.x, baseY - tw.hgt, tw.w, tw.hgt);
        ctx.beginPath();
        ctx.moveTo(tw.x - 4, baseY - tw.hgt);
        ctx.lineTo(tw.x + tw.w / 2, baseY - tw.hgt - 26);
        ctx.lineTo(tw.x + tw.w + 4, baseY - tw.hgt);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 200, 110, 0.75)';
        ctx.fillRect(tw.x + tw.w / 2 - 2, baseY - tw.hgt + 14, 4, 7);
        ctx.fillStyle = '#141a22';
      }
    }
  });

  // foreground road
  ctx.fillStyle = '#120f0a';
  ctx.fillRect(0, 648, W, H - 648);
  ctx.fillStyle = 'rgba(210, 160, 90, 0.10)';
  ctx.fillRect(0, 648, W, 3);

  for (const w of scene.walkers) {
    const span = W + 400;
    const x = ((w.x + t * w.speed) % span + span) % span - 200;
    const bob = Math.abs(Math.sin(t * 5 + w.phase)) * 3;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x + w.size / 2, w.y + 50, w.size * 0.32, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    drawSprite(ctx, 'creature', w.id, x, w.y - w.size + 52 - bob, { size: w.size, facing: 'right', frame: Math.floor(t * 6) % 4, state: 'walk' });
  }

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, 300, W / 2, H / 2, 800);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

export function mount(root, ctx) {
  const ui = ctx.ui;
  const { h } = ui;
  const cv = ui.createCanvas(STAGE_W, STAGE_H, { class: 'mm-bg', dpr: 1 });
  const scene = buildScene(((Date.now() / 60000) | 0) % 9973 + 1);
  let t = 0;
  const paint = () => { try { drawScene(cv.ctx, scene, t, ctx.drawSprite); } catch (err) { ctx.log(`Menu background failed: ${err.message}`, 'warn'); return false; } return true; };
  paint();
  loop = ctx.anim.loop((dt) => { t += dt / 1000; return paint(); });

  const saves = ctx.storage.list();
  const hasGame = !!ctx.state;
  const item = (label, hotkey, onClick, opts = {}) => ui.Button(label, { size: 'lg', class: 'mm-item', hotkey, onClick, ...opts });
  const go = (name, params) => () => ctx.showScreen(name, params);
  const resume = async () => {
    if (ctx.state) { ctx.showScreen('adventure'); return; }
    const latest = saves[0];
    if (!latest) return;
    const res = await ctx.load(latest.slot);
    if (res.ok) ctx.showScreen('adventure');
    else ui.message(`The save could not be loaded (${res.error}).`, { title: 'Load failed' });
  };

  let menuEl = null;
  root.appendChild(h('div.mm', null, cv.canvas,
    h('div.mm-title', null,
      h('div.mm-logo', null, 'H3', h('span', null, 'online')),
      h('div.mm-tagline', null, 'Might, magic and eleven towns - in your browser')),
    menuEl = h('div.mm-menu', null,
      hasGame || saves.length ? item(hasGame ? 'Resume Game' : 'Continue', 'C', resume, { kind: 'primary' }) : null,
      item('New Game', 'N', go('newGame'), hasGame || saves.length ? {} : { kind: 'primary' }),
      item('Campaigns', 'A', go('campaigns')),
      item('Load Game', 'L', go('loadGame', { mode: 'load' })),
      item('Map Editor', 'M', go('editor')),
      hasGame ? item('Save Game', 'S', go('loadGame', { mode: 'save' })) : null,
      item('Encyclopedia', 'E', go('encyclopedia')),
      item('Options', 'O', go('options')),
      item('Credits', 'R', go('credits'))),
    h('div.mm-foot', null, `v0.1 - a fan remake of classic mechanics - art & audio: Duelyst (CC0) + original procedural graphics${ctx.gfx.available ? '' : ' - graphics module missing: placeholder art'}`)));

  // more than 7 entries (game in memory + campaigns + editor): two columns, filled top to bottom
  const entries = menuEl.querySelectorAll('.mm-item').length;
  if (entries > 7) {
    menuEl.classList.add('is-two-col');
    menuEl.style.gridTemplateRows = `repeat(${Math.ceil(entries / 2)}, auto)`;
  }
  if (hasGame || saves.length) ctx.keys.bind('c', resume, 'Continue');
  ctx.keys.bind('n', go('newGame'), 'New game');
  ctx.keys.bind('a', go('campaigns'), 'Campaigns');
  ctx.keys.bind('l', go('loadGame', { mode: 'load' }), 'Load game');
  ctx.keys.bind('m', go('editor'), 'Map editor');
  if (hasGame) ctx.keys.bind('s', go('loadGame', { mode: 'save' }), 'Save game');
  ctx.keys.bind('e', go('encyclopedia'), 'Encyclopedia');
  ctx.keys.bind('o', go('options'), 'Options');
  ctx.keys.bind('r', go('credits'), 'Credits');
}

export function unmount() {
  if (loop) loop.stop();
  loop = null;
}
