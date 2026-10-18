// Browser end-to-end runner: starts the static server, launches headless Chrome through the CDP
// driver (browser.mjs) and plays the scenarios in scenarios.mjs with real mouse / keyboard input.
//
//   npm run e2e                         all scenarios
//   npm run e2e -- menu combat          only scenarios whose name contains one of the words
//   E2E_OUT=/some/dir npm run e2e       screenshot directory (default tools/e2e/out)
//   E2E_VERBOSE=1                       echo the page console
//
// Exit code 1 when a scenario fails or the page logged errors / uncaught exceptions.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
import { SCENARIOS } from './scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT = process.env.E2E_OUT || join(HERE, 'out');
const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
mkdirSync(OUT, { recursive: true });

function freePort() {
  return new Promise((resolve) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
async function startServer() {
  if (process.env.E2E_SERVER) return { url: process.env.E2E_SERVER, stop() {} };
  const port = await freePort();
  const proc = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => { if (String(d).includes('running')) resolve(); });
    proc.on('exit', (c) => reject(new Error(`server exited ${c}`)));
    setTimeout(resolve, 3000);
  });
  return { url: `http://127.0.0.1:${port}`, port, stop() { proc.kill(); } };
}

const results = [];
const metrics = {};
const server = await startServer();
const appOrigin = `http://localhost:${server.port || 8080}`;
const { page, close } = await launch({ shotDir: OUT, width: 1280, height: 720, server: server.url, appOrigin, verbose: !!process.env.E2E_VERBOSE });
const helpers = readFileSync(join(HERE, 'pageHelpers.js'), 'utf8');

/** Test context handed to each scenario. */
const t = {
  page, metrics, out: OUT,
  async open(path = '/') {
    await page.goto(appOrigin + path);
    await page.waitFor('window.h3 && h3.screen === "mainMenu" && document.querySelector(".mm-menu, .k-btn")', 20000);
    await page.eval(helpers);
  },
  eval: (e, ms) => page.eval(e, ms),
  waitFor: (e, ms) => page.waitFor(e, ms),
  sleep: (ms) => page.sleep(ms),
  async shot(name, clip) { await t.checkDialogFit().catch(() => {}); return page.screenshot(name, clip); },
  key: (k, m) => page.key(k, m),
  click: (x, y, o) => page.click(x, y, o),
  clickEl: (sel, text, o) => page.clickEl(sel, text, o),
  box: (sel, text) => page.box(sel, text),
  /** Click a kit button by its visible label (exact match on the label text). */
  async button(label) {
    const b = await page.eval(`(() => {
      const els = [...document.querySelectorAll('.k-btn')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && !e.disabled && !e.classList.contains('is-disabled'); });
      const lab = (e) => (e.querySelector('.k-btn-label') || e).textContent.replace(/\\s+/g, ' ').trim();
      const e = els.filter((x) => lab(x) === ${JSON.stringify(label)} || lab(x).startsWith(${JSON.stringify(label)} + ' ')).pop();
      if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!b) throw new Error(`no enabled button "${label}"`);
    await page.click(b.x, b.y);
  },
  async tile(x, y) { return page.eval(`e2e.tileClient(${x}, ${y})`); },
  async hex(x, y) { return page.eval(`e2e.hexClient(${x}, ${y})`); },
  screen: () => page.eval('h3.screen'),
  dialogs: () => page.eval('e2e.dialogs()'),
  /** Close every open dialog with Enter (default button), returns their texts. */
  async ackDialogs(max = 10) {
    const seen = [];
    for (let i = 0; i < max; i++) {
      const d = await page.eval('e2e.dialogs()');
      if (!d.length) break;
      seen.push(d[d.length - 1]);
      await t.checkDialogFit();
      // a choice dialog without buttons (e.g. "You are under attack": fight / quick combat) takes its first option
      const choice = await page.eval(`(() => { const ds = [...document.querySelectorAll('.k-dlg')]; const top = ds[ds.length - 1];
        return !!top && !!top.querySelector('.k-choice') && !top.querySelector('.k-dlg-buttons .k-btn, .k-btn:not(.k-choice)'); })()`);
      await page.key(choice ? '1' : 'Enter');
      await page.sleep(350);
    }
    return seen;
  },
  /** Flag dialogs whose content is clipped (needs a scrollbar the player may not notice) or off-stage. */
  async checkDialogFit() {
    const bad = await page.eval(`[...document.querySelectorAll('.k-dlg')].map((d) => {
      const m = d.querySelector('.k-dlg-main'); const r = d.getBoundingClientRect(); const st = document.querySelector('.stage').getBoundingClientRect();
      const clipped = m && m.scrollHeight > m.clientHeight + 4; const off = r.top < st.top - 1 || r.bottom > st.bottom + 1;
      return clipped || off ? (d.querySelector('.k-dlg-title') || d).textContent.trim().slice(0, 40) + (clipped ? ' (content clipped)' : ' (off stage)') : null; }).filter(Boolean)`);
    for (const b of bad) if (!(metrics.clippedDialogs ||= []).includes(b)) { metrics.clippedDialogs.push(b); console.log(`    WARN dialog: ${b}`); }
    return bad;
  },
  check(cond, msg) { if (!cond) throw new Error(`check failed: ${msg}`); },
  log: (...a) => console.log('   ', ...a),
};

for (const sc of SCENARIOS) {
  if (filters.length && !filters.some((f) => sc.name.includes(f))) continue;
  const t0 = Date.now();
  process.stdout.write(`- ${sc.name} ... `);
  page.takeErrors();
  let error = null;
  try { await sc.run(t); } catch (err) { error = err; }
  const pageErrors = page.takeErrors().filter((e) => !/favicon/.test(e));
  if (error) { try { await page.screenshot(`FAIL-${sc.name}`); } catch { /* page may be gone */ } }
  const ok = !error && !pageErrors.length;
  results.push({ name: sc.name, ok, ms: Date.now() - t0, error: error && (error.stack || String(error)), pageErrors });
  console.log(`${ok ? 'ok' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (error) console.log(`    ${String(error.stack || error).split('\n').slice(0, 4).join('\n    ')}`);
  for (const e of pageErrors) console.log(`    page: ${e}`);
}

await close();
server.stop();
const failed = results.filter((r) => !r.ok);
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ results, metrics, shots: page.shots }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} scenarios passed. Screenshots + report.json in ${OUT}`);
if (Object.keys(metrics).length) console.log('metrics:', JSON.stringify(metrics, null, 1));
process.exit(failed.length ? 1 : 0);
