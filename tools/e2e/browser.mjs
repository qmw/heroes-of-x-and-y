// Zero-dependency Chrome DevTools Protocol driver for the browser end-to-end checks.
// Node 20: run with `node --experimental-websocket` (Node >= 22 has WebSocket built in).
//
// Works in two setups:
//  - WSL2 + Windows Chrome (default when /mnt/c exists): Chrome's DevTools port listens on the Windows
//    loopback only, so `relay.ps1` (run through powershell.exe) dials both Chrome and a WSL listener and
//    pumps the bytes. Windows reaches the WSL static server through WSL's localhost forwarding.
//  - Native: set CHROME=/path/to/chrome; we connect to its port directly.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WIN_CHROME = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
const WIN_EDGE = '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findLocalChrome() {
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const n of names) { try { const p = execFileSync('which', [n], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch { /* next */ } }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return existsSync(mac) ? mac : null;
}

function isWsl() { return existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') || existsSync('/mnt/c/Windows'); }

function toWinPath(p) { return execFileSync('wslpath', ['-w', p]).toString().trim(); }

/** Listen on a free local port; resolves { server, port }. */
function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** WSL: a listener the Windows relay dials into, bridged to a local port the WebSocket connects to. */
async function startReverseRelay(chromePort) {
  const spare = [];
  const waiting = [];
  const relayIn = await new Promise((resolve, reject) => {
    const s = createServer((sock) => {
      sock.setNoDelay(true);
      sock.on('error', () => {});
      sock.once('close', () => { const i = spare.indexOf(sock); if (i >= 0) spare.splice(i, 1); });
      const w = waiting.shift();
      if (w) w(sock); else spare.push(sock);
    });
    s.on('error', reject);
    s.listen(0, '0.0.0.0', () => resolve(s));
  });
  const wslPort = relayIn.address().port;
  const local = await listen((client) => {
    client.setNoDelay(true);
    const pair = (remote) => {
      remote.write('G'); // tells relay.ps1 to dial Chrome for this standby connection
      client.pipe(remote); remote.pipe(client);
      const end = () => { client.destroy(); remote.destroy(); };
      client.on('close', end); remote.on('close', end); client.on('error', end); remote.on('error', end);
    };
    const s = spare.shift();
    if (s) pair(s); else waiting.push(pair);
  });
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', toWinPath(join(HERE, 'relay.ps1')),
    '-ChromePort', String(chromePort), '-WslPort', String(wslPort)], { stdio: 'ignore' });
  return { port: local.port, wslPort, close() { try { ps.kill(); } catch {} relayIn.close(); local.server.close(); spare.forEach((s) => s.destroy()); } };
}

/** Kill Windows processes (browser + relay) whose command line contains `needle`. */
function killWindows(needle) {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and $_.Name -ne 'WMIC.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
    { stdio: 'ignore', timeout: 30000 });
  } catch { /* best effort */ }
}

/** WSL: remove browsers/relays/profiles left behind by drivers that died (their WSL pid is gone). */
function cleanupStale() {
  let dirs = [];
  try { dirs = readdirSync('/mnt/c/Temp').filter((d) => /^h3e2e-\d+-\d+$/.test(d)); } catch { return; }
  const stale = dirs.filter((d) => { const pid = Number(d.split('-')[1]); try { process.kill(pid, 0); return false; } catch { return true; } });
  if (!stale.length) return;
  for (const d of stale) killWindows(d);
  for (const d of stale) { try { rmSync(join('/mnt/c/Temp', d), { recursive: true, force: true }); } catch {} }
}

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.calls = new Map(); this.handlers = new Set();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (msg.id && this.calls.has(msg.id)) {
        const { resolve, reject, method } = this.calls.get(msg.id); this.calls.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`)); else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  send(method, params = {}, sessionId, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.calls.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.calls.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); }, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
}

const KEYS = {
  Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], Tab: [9, 'Tab'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'],
  Space: [32, 'Space', ' '], ' ': [32, 'Space', ' '],
  ArrowLeft: [37, 'ArrowLeft'], ArrowUp: [38, 'ArrowUp'], ArrowRight: [39, 'ArrowRight'], ArrowDown: [40, 'ArrowDown'],
  Home: [36, 'Home'], End: [35, 'End'], PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'],
  F1: [112, 'F1'], F2: [113, 'F2'], F5: [116, 'F5'],
};

export class Page {
  constructor(cdp, sessionId, opts) {
    this.cdp = cdp; this.sid = sessionId; this.opts = opts;
    this.console = []; this.errors = []; this.shotDir = opts.shotDir; this.shots = [];
    cdp.on((m) => {
      if (m.sessionId !== this.sid) return;
      if (m.method === 'Runtime.consoleAPICalled') {
        const text = m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
        this.console.push({ type: m.params.type, text });
        if (m.params.type === 'error' || m.params.type === 'assert') this.errors.push(`console.${m.params.type}: ${text}`);
        if (opts.verbose) console.log(`  [console.${m.params.type}] ${text}`);
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        const text = `${d.exception?.description || d.text} @${d.url || ''}:${d.lineNumber}`;
        this.errors.push(`exception: ${text}`);
        if (opts.verbose) console.log(`  [exception] ${text}`);
      } else if (m.method === 'Log.entryAdded') {
        const e = m.params.entry;
        if (e.level === 'error') { this.errors.push(`log.${e.source}: ${e.text} ${e.url || ''}`); if (opts.verbose) console.log(`  [log] ${e.text} ${e.url || ''}`); }
      }
    });
  }
  send(method, params, timeout) { return this.cdp.send(method, params, this.sid, timeout); }

  /**
   * Serve every request for `appOrigin` from `target` (a server reachable from THIS process) through
   * CDP Fetch interception. On WSL2 the Windows browser -> WSL TCP path drops requests under load
   * (ERR_NO_BUFFER_SPACE / ERR_CONNECTION_RESET), so the driver relays the bytes itself.
   */
  async enableProxy(appOrigin, target) {
    this.stats = { requests: 0, bytes: 0 };
    this.cdp.on(async (m) => {
      if (m.sessionId !== this.sid || m.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = m.params;
      try {
        if (!request.url.startsWith(appOrigin)) { await this.send('Fetch.continueRequest', { requestId }); return; }
        const res = await fetch(target + request.url.slice(appOrigin.length), { method: request.method, headers: { accept: request.headers.Accept || '*/*' } });
        const body = Buffer.from(await res.arrayBuffer());
        this.stats.requests++; this.stats.bytes += body.length;
        const responseHeaders = [];
        res.headers.forEach((value, name) => { if (!/^(content-length|transfer-encoding|connection|keep-alive)$/i.test(name)) responseHeaders.push({ name, value }); });
        await this.send('Fetch.fulfillRequest', { requestId, responseCode: res.status, responseHeaders, body: body.toString('base64') });
      } catch (err) {
        try { await this.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }); } catch {}
        if (this.opts.verbose) console.log(`  [proxy] ${request.url}: ${err.message}`);
      }
    });
    await this.send('Fetch.enable', { patterns: [{ urlPattern: `${appOrigin}/*`, requestStage: 'Request' }] });
  }

  async init(width, height) {
    await this.send('Runtime.enable'); await this.send('Page.enable'); await this.send('Log.enable');
    if (this.opts.proxyTo) await this.enableProxy(this.opts.appOrigin, this.opts.proxyTo);
    await this.setViewport(width, height);
  }
  async setViewport(width, height, deviceScaleFactor = 1) {
    this.width = width; this.height = height;
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
    await this.eval('window.dispatchEvent(new Event("resize"))').catch(() => {});
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"', 20000);
  }
  /** Evaluate an expression (or `async` body when it contains await) in the page, by value. */
  async eval(expr, timeout = 60000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, timeout);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`eval failed: ${d.exception?.description || d.text}\n  in: ${expr.slice(0, 200)}`);
    }
    return r.result.value;
  }
  async waitFor(expr, timeout = 10000, interval = 100) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) {
      try { last = await this.eval(`(async () => { try { return !!(await (${expr})); } catch { return false; } })()`); } catch { last = false; }
      if (last) return true;
      await sleep(interval);
    }
    throw new Error(`waitFor timed out (${timeout}ms): ${expr}`);
  }
  sleep(ms) { return sleep(ms); }

  // ---- input --------------------------------------------------------------------------------
  async mouse(type, x, y, button = 'left', clickCount = 1) {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount, buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0 });
  }
  async click(x, y, { button = 'left', hold = 0, double = false } = {}) {
    await this.mouse('mouseMoved', x, y, 'none');
    await this.mouse('mousePressed', x, y, button, 1);
    if (hold) await sleep(hold);
    await this.mouse('mouseReleased', x, y, button, 1);
    if (double) { await this.mouse('mousePressed', x, y, button, 2); await this.mouse('mouseReleased', x, y, button, 2); }
  }
  async move(x, y) { await this.mouse('mouseMoved', x, y, 'none'); }
  async wheel(x, y, deltaY) { await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }); }
  /** Bounding box (client px) of the first element matching a CSS selector (optionally containing text). */
  async box(selector, text) {
    return this.eval(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((e) => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && ${text ? `(e.textContent || '').includes(${JSON.stringify(text)})` : 'true'};
      });
      const e = els[els.length - 1]; if (!e) return null;
      const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    })()`);
  }
  /** Real mouse click on the element matching selector (+ text). Uses the LAST visible match (topmost dialog). */
  async clickEl(selector, text, opts) {
    const b = await this.box(selector, text);
    if (!b) throw new Error(`clickEl: no visible element ${selector}${text ? ` containing "${text}"` : ''}`);
    await this.click(b.cx, b.cy, opts);
    return b;
  }
  /** Stage (1280x720 logical) coordinates -> client coordinates. */
  async stageToClient(x, y) {
    return this.eval(`(() => { const r = document.querySelector('.stage').getBoundingClientRect(); const s = r.width / 1280; return { x: r.x + ${x} * s, y: r.y + ${y} * s }; })()`);
  }
  async key(key, { ctrl = false, shift = false, alt = false } = {}) {
    let [code, name, text] = KEYS[key] || [];
    if (!code) {
      const ch = key.length === 1 ? key : key;
      code = ch.toUpperCase().charCodeAt(0); name = /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}` : /[0-9]/.test(ch) ? `Digit${ch}` : ch;
      text = ch;
    }
    const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const k = KEYS[key] ? KEYS[key][1] === 'Space' ? ' ' : KEYS[key][1] : key;
    const base = { key: k, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
    await this.send('Input.dispatchKeyEvent', { type: text && !ctrl && !alt ? 'keyDown' : 'rawKeyDown', ...base, ...(text && !ctrl && !alt ? { text, unmodifiedText: text } : {}) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async type(str) { for (const ch of str) await this.send('Input.insertText', { text: ch }); }

  // ---- output -------------------------------------------------------------------------------
  async screenshot(name, clip) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: clip.scale || 1 }, captureBeyondViewport: true } : {}) }, 30000);
    const file = join(this.shotDir, `${name}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    this.shots.push(file);
    return file;
  }
  takeErrors() { const e = this.errors; this.errors = []; return e; }
}

/**
 * Launch a headless browser and return { page, close }.
 * opts: { width, height, shotDir, verbose, headless, server ('http://127.0.0.1:8080' = where the static
 *   server listens from this process), appOrigin (the URL origin the page uses), proxyTo (null = no proxy) }
 */
export async function launch(opts = {}) {
  const width = opts.width || 1280, height = opts.height || 720;
  const shotDir = opts.shotDir || join(HERE, 'out'); mkdirSync(shotDir, { recursive: true });
  const wsl = !process.env.CHROME && isWsl();
  const chrome = process.env.CHROME || (wsl ? (existsSync(WIN_CHROME) ? WIN_CHROME : WIN_EDGE) : findLocalChrome());
  if (!chrome) throw new Error('no Chrome/Chromium found: set CHROME=/path/to/chrome');
  const profileTag = `h3e2e-${process.pid}-${Date.now()}`;
  let profileArg, profileFs;
  if (wsl) cleanupStale();
  if (wsl) { profileArg = `C:\\Temp\\${profileTag}`; profileFs = `/mnt/c/Temp/${profileTag}`; mkdirSync('/mnt/c/Temp', { recursive: true }); }
  else { profileFs = join(process.env.TMPDIR || '/tmp', profileTag); profileArg = profileFs; }
  const args = [opts.headless === false ? null : '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileArg}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--enable-precise-memory-info', '--js-flags=--expose-gc',
    '--hide-scrollbars', '--mute-audio', `--window-size=${width},${height}`, 'about:blank'].filter(Boolean);
  const proc = spawn(chrome, args, { stdio: 'ignore', detached: false });
  const portFile = join(profileFs, 'DevToolsActivePort');
  let portInfo = null;
  for (let i = 0; i < 150 && !portInfo; i++) {
    await sleep(100);
    if (existsSync(portFile)) { const t = readFileSync(portFile, 'utf8').trim().split(/\r?\n/); if (t.length >= 2) portInfo = { port: Number(t[0]), path: t[1] }; }
  }
  if (!portInfo) throw new Error(`browser did not start (no ${portFile})`);
  let relay = null, port = portInfo.port;
  if (wsl) { relay = await startReverseRelay(portInfo.port); port = relay.port; }
  if (typeof WebSocket === 'undefined') throw new Error('WebSocket missing: run node with --experimental-websocket');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${portInfo.path}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', () => reject(new Error('CDP websocket failed'))); });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  // On WSL the page talks to the static server through the driver (see Page.enableProxy).
  const proxyTo = opts.proxyTo === undefined ? (wsl ? opts.server : null) : opts.proxyTo;
  const page = new Page(cdp, sessionId, { shotDir, verbose: opts.verbose, proxyTo, appOrigin: opts.appOrigin || 'http://localhost:8080' });
  await page.init(width, height);
  async function close() {
    try { await cdp.send('Browser.close', {}, undefined, 5000); } catch {}
    try { ws.close(); } catch {}
    relay?.close();
    try { proc.kill(); } catch {}
    if (wsl) killWindows(profileTag), killWindows(`-WslPort ${relay?.wslPort}`);
    await sleep(500);
    try { rmSync(profileFs, { recursive: true, force: true }); } catch {}
  }
  return { page, cdp, close };
}
