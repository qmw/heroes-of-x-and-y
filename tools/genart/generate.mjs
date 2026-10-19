#!/usr/bin/env node
// Generation driver for the "generated" art pack (docs/mechanics/generated-art.md).
// Reads tools/genart/prompts.json, skips ids whose raw image already exists, and runs OpenAI Codex
// CLI (`codex exec`, image_generation feature) in parallel work dirs to create the rest. Each raw
// image is verified (PNG signature, IHDR, size) and moved to $GENART_DIR/raw/<kind>/<key>.png.
// Failures are retried (max 2 retries per id). Progress goes to stdout and $GENART_DIR/generate.log.
//
//   GENART_DIR=/path/to/scratch node tools/genart/generate.mjs [--only <regex>] [--parallel 6]
//        [--batch 2] [--limit N] [--force <regex>] [--first <regex>] [--dry] [--salvage]
// (--salvage only moves images left in work dirs by an interrupted run; every run does that first)
//
// The 1254-1536 px originals stay in $GENART_DIR (in the git-ignored .genart/ folder by default); tools/genart/resize.mjs
// downscales them into assets/generated/.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, renameSync, appendFileSync, readdirSync, rmSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);

export const GENART_DIR = resolve(process.env.GENART_DIR || join(HERE, '..', '..', '.genart'));
export const RAW_DIR = join(GENART_DIR, 'raw');
const WORK_DIR = join(GENART_DIR, 'work');
const LOG = join(GENART_DIR, 'generate.log');

export const rawPath = (e) => join(RAW_DIR, e.kind, `${e.key}.png`);

/** Cheap validity check: PNG signature, IHDR, plausible size, file not truncated (IEND present). */
export function validPng(path) {
  try {
    const size = statSync(path).size;
    if (size < 2000) return false;
    const fd = openSync(path, 'r');
    const head = Buffer.alloc(24);
    readSync(fd, head, 0, 24, 0);
    const tail = Buffer.alloc(12);
    readSync(fd, tail, 0, 12, size - 12);
    closeSync(fd);
    if (head.readUInt32BE(0) !== 0x89504e47 || head.toString('latin1', 12, 16) !== 'IHDR') return false;
    const w = head.readUInt32BE(16); const h = head.readUInt32BE(20);
    return w >= 256 && h >= 256 && w <= 4096 && h <= 4096 && tail.toString('latin1', 4, 8) === 'IEND';
  } catch { return false; }
}

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG, `${line}\n`); } catch { /* ignore */ }
}

function batchPrompt(items) {
  const lines = items.map((e, i) => `Image ${i + 1} -> save as file \`${e.kind}__${e.key}.png\`:\n${e.prompt}`);
  return [
    `Generate ${items.length} separate image${items.length > 1 ? 's' : ''} with your image generation tool, one tool call per image, each exactly as described below.`,
    'Do not write code, do not edit, crop, resize or post-process the images, and do not combine them.',
    'Save each generated image as a PNG in the current directory under the exact file name given.',
    'Finally print each file name with its pixel dimensions.',
    '',
    ...lines,
  ].join('\n');
}

function runCodex(dir, prompt, timeoutMs) {
  return new Promise((done) => {
    const child = spawn('codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', dir, prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); });
    child.stderr.on('data', (d) => { out += d; if (out.length > 200000) out = out.slice(-100000); });
    const t = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(t); done({ code, out }); });
    child.on('error', (err) => { clearTimeout(t); done({ code: -1, out: String(err) }); });
  });
}

/** Move valid images left in work dirs (interrupted runs) to the raw dir. Returns the count. */
export function salvage(all) {
  if (!existsSync(WORK_DIR)) return 0;
  const byName = new Map(all.map((e) => [`${e.kind}__${e.key}.png`, e]));
  let n = 0;
  for (const d of readdirSync(WORK_DIR)) {
    const dir = join(WORK_DIR, d);
    let files = [];
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      const e = byName.get(f);
      if (e && validPng(join(dir, f)) && !validPng(rawPath(e))) {
        mkdirSync(join(RAW_DIR, e.kind), { recursive: true });
        renameSync(join(dir, f), rawPath(e));
        log(`salvaged ${e.id}`);
        n++;
      }
    }
  }
  return n;
}

async function main() {
  const all = JSON.parse(readFileSync(join(HERE, 'prompts.json'), 'utf8'));
  salvage(all);
  if (flag('salvage')) return;
  const only = opt('only') ? new RegExp(opt('only')) : null;
  const force = opt('force') ? new RegExp(opt('force')) : null;
  const parallel = Number(opt('parallel', 6));
  const batch = Number(opt('batch', 2));
  const limit = Number(opt('limit', 1e9));
  mkdirSync(WORK_DIR, { recursive: true });
  let todo = all.filter((e) => (!only || only.test(e.id)) && ((force && force.test(e.id)) || !validPng(rawPath(e))));
  if (opt('first')) {
    // ids matching --first go to the front of the queue (e.g. one faction's town for a quick review)
    const first = new RegExp(opt('first'));
    todo = [...todo.filter((e) => first.test(e.id)), ...todo.filter((e) => !first.test(e.id))];
  }
  todo = todo.slice(0, limit);
  log(`${todo.length} to generate (of ${all.length}); parallel ${parallel}, batch ${batch}; raw dir ${RAW_DIR}`);
  if (flag('dry')) { for (const e of todo) console.log(e.id); return; }
  const tries = new Map();
  const queue = [...todo];
  let done = 0; let failed = 0; let seq = 0; let stopped = false;
  const t0 = Date.now();
  async function worker(wi) {
    while (queue.length) {
      // images finished meanwhile (another driver, an interrupted run's orphans) are not redone
      salvage(all);
      const items = [];
      while (queue.length && items.length < batch) {
        const e = queue.shift();
        if (validPng(rawPath(e)) && !(force && force.test(e.id))) { done++; log(`skip ${e.id} (already there)`); continue; }
        items.push(e);
      }
      if (!items.length) continue;
      const dir = join(WORK_DIR, `p${process.pid}_w${wi}_${seq++}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const started = Date.now();
      const r = await runCodex(dir, batchPrompt(items), 6 * 60 * 1000 * items.length);
      if (/usage limit/i.test(r.out)) {
        // the account's Codex quota is used up: stop instead of burning retries (re-run later)
        const when = (r.out.match(/try again at ([^.]*)/) || [])[1] || 'later';
        if (!stopped) log(`STOP: Codex usage limit reached, try again at ${when}`);
        stopped = true;
        queue.length = 0;
      }
      for (const e of items) {
        const f = join(dir, `${e.kind}__${e.key}.png`);
        if (validPng(f)) {
          mkdirSync(join(RAW_DIR, e.kind), { recursive: true });
          renameSync(f, rawPath(e));
          done++;
          log(`ok   ${e.id} (${Math.round((Date.now() - started) / 1000)}s batch) [${done}/${todo.length}, ${failed} failed, ${((Date.now() - t0) / 60000).toFixed(1)} min]`);
        } else {
          const n = (tries.get(e.id) || 0) + 1;
          tries.set(e.id, n);
          const files = existsSync(dir) ? readdirSync(dir).join(',') : '';
          if (stopped) { /* left for the next run */ } else if (n <= 2) { queue.push(e); log(`retry ${e.id} (attempt ${n}; exit ${r.code}; files: ${files || '-'}) ${r.out.slice(-300).replace(/\s+/g, ' ')}`); }
          else { failed++; log(`FAIL ${e.id} after ${n} attempts`); }
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }
  await Promise.all(Array.from({ length: parallel }, (_, i) => worker(i)));
  log(`finished: ${done} generated, ${failed} failed in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
