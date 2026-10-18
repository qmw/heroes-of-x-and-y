// Interactive e2e session: keeps one headless browser open and accepts commands over HTTP so a
// human (or an agent) can poke the running game step by step.
//   node --experimental-websocket tools/e2e/session.mjs [--port 9555] [--out dir] [--url http://localhost:8080/]
//   curl -s localhost:9555/eval -d 'h3.screen'
//   curl -s localhost:9555/shot -d name          -> writes <out>/<name>.png
//   curl -s localhost:9555/click -d '640 360'      (client px)   /sclick -d '640 360' (stage px)
//   curl -s localhost:9555/key -d 'e'  (or 'ctrl+s')  /el -d '.k-btn|Text'  /viewport -d '1600 900'
//   curl -s localhost:9555/errors   /goto -d url   /quit
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { launch } from './browser.mjs';
const helpers = () => readFileSync(new URL('./pageHelpers.js', import.meta.url), 'utf8');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const port = Number(arg('--port', 9555));
const url = arg('--url', 'http://localhost:8080/');
const server = arg('--server', 'http://127.0.0.1:8080');
const { page, close } = await launch({ shotDir: arg('--out', undefined), width: 1280, height: 720, server, appOrigin: new URL(url).origin });
await page.goto(url);
await page.eval(helpers());

const ops = {
  async eval(body) { return page.eval(body); },
  async shot(body) {
    const [name, x, y, width, height, scale] = body.trim().split(/\s+/);
    return page.screenshot(name || `shot-${Date.now()}`, x != null ? { x: +x, y: +y, width: +width, height: +height, scale: +(scale || 1) } : undefined);
  },
  async wheel(body) { const [x, y, d] = body.trim().split(/\s+/).map(Number); await page.wheel(x, y, d); return 'ok'; },
  async click(body) { const [x, y, b] = body.trim().split(/\s+/); await page.click(Number(x), Number(y), { button: b || 'left' }); return 'ok'; },
  async sclick(body) { const [x, y, b] = body.trim().split(/\s+/); const p = await page.stageToClient(Number(x), Number(y)); await page.click(p.x, p.y, { button: b || 'left' }); return p; },
  async move(body) { const [x, y] = body.trim().split(/\s+/).map(Number); await page.move(x, y); return 'ok'; },
  async key(body) {
    const parts = body.trim().split('+'); const k = parts.pop();
    await page.key(k, { ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt') }); return 'ok';
  },
  async el(body) { const [sel, text] = body.split('|'); return page.clickEl(sel.trim(), text); },
  async viewport(body) { const [w, h] = body.trim().split(/\s+/).map(Number); await page.setViewport(w, h); return 'ok'; },
  async cdp(body) { const { method, params } = JSON.parse(body); const r = await page.send(method, params || {}); return r && r.data ? `${r.data.length} bytes` : r; },
  /** Where is the page's JS stuck? Pauses the debugger, returns the call stack, resumes. */
  async pause() {
    const got = new Promise((resolve) => { const off = page.cdp.on((m) => { if (m.sessionId === page.sid && m.method === 'Debugger.paused') { off(); resolve(m.params); } }); });
    await page.send('Debugger.enable', {}, 10000);
    await page.send('Debugger.pause', {}, 10000);
    const p = await Promise.race([got, new Promise((r) => setTimeout(() => r(null), 10000))]);
    const frames = p ? p.callFrames.map((f) => `${f.functionName || '(anon)'} ${f.url.replace(/^.*\/src\//, 'src/')}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`) : ['no pause event'];
    try { await page.send('Debugger.resume', {}, 5000); await page.send('Debugger.disable', {}, 5000); } catch {}
    return frames;
  },
  async ping() { const t0 = Date.now(); const v = await page.cdp.send('Browser.getVersion', {}, undefined, 5000); return `${v.product} ${Date.now() - t0}ms`; },
  async errors() { return page.takeErrors(); },
  async console() { const c = page.console.slice(-50); return c; },
  async goto(body) { await page.goto(body.trim() || url); await page.eval(helpers()); return 'ok'; },
  async helpers() { return page.eval(helpers()); },
  async quit() { setTimeout(() => process.exit(0), 8000); setTimeout(async () => { await close(); process.exit(0); }, 50); return 'bye'; },
};

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const op = ops[req.url.slice(1).split('?')[0]];
    try {
      if (!op) throw new Error(`unknown op ${req.url}; ops: ${Object.keys(ops).join(' ')}`);
      const out = await op(body);
      res.end(`${typeof out === 'string' ? out : JSON.stringify(out, null, 1)}\n`);
    } catch (err) { res.statusCode = 500; res.end(`ERROR ${err.message}\n`); }
  });
}).listen(port, '127.0.0.1', () => console.log(`e2e session on http://127.0.0.1:${port}`));
