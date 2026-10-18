// Worker thread for tests/ai/progress.test.js: plays one benchmark game, posts its weekly metrics.
import { parentPort, workerData } from 'node:worker_threads';
import { benchReady, runBenchGame } from './bench.js';

await benchReady();
const g = runBenchGame(workerData);
parentPort.postMessage(g.ok ? { ok: true, weeks: g.weeks, ms: g.ms, gameOver: g.gameOver } : { ok: false, error: g.error });
