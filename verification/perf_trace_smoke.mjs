/**
 * perf_trace_smoke.mjs — the scripted meander under `?trace=1`, per-span p95s
 * against a committed baseline (#559 E).
 *
 * Boots the same run as input_script_smoke.mjs (`?map=meander&input=script:…`,
 * frameloop "never", `stepScripted(60)` per sim second) with `?trace=1`, which
 * records every thread's spans from boot (src/debug/trace/). After the run it
 * stops the recording through `window.__watershed.trace.stop()`, keeps the spans
 * that start inside the stepped window (boot — shader compiles, the first
 * mounts — is not what a PR changes), and reduces each `<track>/<name>` to
 * n / p50 / p95. The run only reaches a few segments, so it then appends
 * PERF_TRACE_APPENDS more through `__watershedScreenshot.advanceTreadmill()`
 * (as spawn_profile.mjs does), one mount at a time, so segment build / mount
 * have enough samples for a p95.
 *
 * Gate (perfBaseline.mjs, verification/perf-baselines/tolerance.json, suite
 * `meander`): the stable spans — the sim step, segment build and mount, the sim
 * worker's STEP and BUILD_TILE — fail on a calibration-normalised p95 rise past
 * their tolerance. Render and post spans are reported only: SwiftShader numbers
 * are not GPU numbers. Each run also checks that every worker track landed
 * within 1 ms of where the threads' `performance.timeOrigin`s put it (the
 * handshake's offset against an independent one).
 *
 * RUNS runs; each metric keeps its smallest p95 (the run least disturbed by the
 * box), and the calibration likewise.
 *
 * A scripted run steps the SWE field on the main thread (sweBackend.ts: worker
 * replies would land at wall-clock time and break determinism), so it has no
 * worker tracks. A second, live phase records a free-running raft on the same
 * map (`?vehicle=raft&trace=1`, a small viewport so SwiftShader keeps up) for
 * PERF_TRACE_LIVE_MS and gates the timeline itself: main, sim-worker and
 * Rapier-worker tracks present, each worker within 1 ms of where the threads'
 * `performance.timeOrigin`s put it. Its spans are reported, never gated.
 *
 * Usage:
 *   pnpm build && pnpm preview --host 127.0.0.1 --port 4173
 *   WATERSHED_URL=http://127.0.0.1:4173 pnpm test:perf-trace
 *   UPDATE_PERF_BASELINE=1 pnpm test:perf-trace     # rewrite perf-baselines/meander.json
 *
 * Writes verification/output/perf-trace/: run 1's `.trace.json` and `live-raft.trace.json` (open them in
 * ui.perfetto.dev) and `meander.candidate.json` — this box's numbers in the
 * baseline's shape, for refreshing the baseline from a CI artifact.
 *
 * Env:
 *   WATERSHED_URL            Base URL (default http://127.0.0.1:4173)
 *   PERF_TRACE_SECONDS       Sim seconds per run (default 30)
 *   PERF_TRACE_RUNS          Runs (default 3)
 *   PERF_TRACE_APPENDS       Treadmill segments appended after the run (default 32)
 *   PERF_TRACE_LIVE_MS       Wall ms of the live raft phase (default 30000; 0 skips it)
 *   UPDATE_PERF_BASELINE=1   Write the baseline instead of comparing
 *   PUPPETEER_EXECUTABLE_PATH
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CALIBRATE_SOURCE,
  baselinePath,
  compareToBaseline,
  quantile,
  readJson,
  reportComparison,
  round,
  writeBaseline,
  BASELINE_DIR,
} from './perfBaseline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'output', 'perf-trace');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SCRIPT_PATH = '/verification/fixtures/input/meander_run.json';
const SECONDS = Math.max(5, Number(process.env.PERF_TRACE_SECONDS ?? '30'));
const RUNS = Math.max(1, Number(process.env.PERF_TRACE_RUNS ?? '3'));
const UPDATE = process.env.UPDATE_PERF_BASELINE === '1';
const LIVE_MS = Math.max(0, Number(process.env.PERF_TRACE_LIVE_MS ?? '30000'));
const LIVE_QUERY = 'map=meander&cleanTest=1&renderer=webgl&screenshot=1&vehicle=raft&trace=1';
const LIVE_TRACKS = ['main', 'sim worker', 'rapier worker'];
const SUITE = 'meander';
const FRAMES_PER_SECOND = 60;
const MAX_ALIGN_ERROR_MS = 1;
// spawnProfile=1: segment-mount user-timing marks to wait on, and the boot preset held (no adaptive ladder).
const QUERY = `map=meander&cleanTest=1&renderer=webgl&screenshot=1&trace=1&spawnProfile=1&input=script:${SCRIPT_PATH}`;
const APPENDS = Math.max(0, Number(process.env.PERF_TRACE_APPENDS ?? '32'));
const MOUNT_TIMEOUT_MS = 30_000;

const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
  '--disable-gpu-sandbox',
  '--window-size=1280,720',
  '--hide-scrollbars',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    return puppeteer.executablePath();
  } catch {
    return undefined;
  }
}

async function serveFixtures(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE_URL).origin && url.pathname.startsWith('/verification/fixtures/')) {
      const file = path.join(REPO_ROOT, decodeURIComponent(url.pathname));
      if (!file.startsWith(path.join(REPO_ROOT, 'verification', 'fixtures')) || !fs.existsSync(file)) {
        req.respond({ status: 404, body: 'not found' });
        return;
      }
      req.respond({ status: 200, contentType: 'application/json', body: fs.readFileSync(file) });
      return;
    }
    req.continue();
  });
}

/** `<track label>/<span name>` → durations (ms), spans starting at or after `fromUs`. */
export function spanDurations(trace, fromUs = -Infinity) {
  const labels = new Map();
  for (const e of trace.traceEvents) if (e.ph === 'M' && e.name === 'thread_name') labels.set(e.tid, e.args.name);
  const out = new Map();
  for (const e of trace.traceEvents) {
    if (e.ph !== 'X' || e.ts < fromUs) continue;
    const key = `${labels.get(e.tid) ?? e.tid}/${e.name}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(e.dur / 1000);
  }
  return out;
}

export function metricsOf(durations) {
  const metrics = {};
  for (const [key, list] of [...durations].sort(([a], [b]) => a.localeCompare(b))) {
    metrics[key] = { n: list.length, p50: round(quantile(list, 0.5)), p95: round(quantile(list, 0.95)) };
  }
  return metrics;
}

/** Every worker track against the offset its thread's timeOrigin gives; returns failures. */
function checkAlignment(label, trace) {
  const failures = [];
  for (const t of trace.metadata.threads) {
    if (t.thread === 'main') continue;
    const miss = t.originOffsetMs === null ? Infinity : Math.abs(t.offsetMs - t.originOffsetMs);
    console.log(`  ${t.thread}: handshake vs timeOrigin ${round(miss, 3)} ms (bound ±${t.alignErrorMs} ms)`);
    if (!(miss < MAX_ALIGN_ERROR_MS)) {
      failures.push(`${label}: ${t.thread} track misaligned by ${round(miss, 3)} ms (limit ${MAX_ALIGN_ERROR_MS} ms)`);
    }
  }
  return failures;
}

async function launch() {
  return puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: resolveChromePath(),
    protocolTimeout: 300_000,
    args: CHROME_ARGS,
  });
}

async function clickStart(page) {
  await page.waitForFunction(() => window.__watershed?.trace?.recording() === true, { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.start-menu-start-btn');
      return !!btn && !btn.disabled;
    },
    { timeout: 90_000 },
  );
  await page.evaluate(() => document.querySelector('.start-menu-start-btn').click());
}

/** The live phase: a free-running raft, so the sim and Rapier workers both step. */
async function liveRun() {
  const browser = await launch();
  const pageErrors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 480, height: 270 });
    page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));
    console.log(`\n[live] ${BASE_URL}/?${LIVE_QUERY} for ${LIVE_MS / 1000} s`);
    await page.goto(`${BASE_URL}/?${LIVE_QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await clickStart(page);
    await sleep(LIVE_MS);
    const trace = JSON.parse(await page.evaluate(async () => JSON.stringify(await window.__watershed.trace.stop())));
    return { ok: true, trace, pageErrors };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), pageErrors };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runOnce(runIdx) {
  const pageErrors = [];
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`);
    });
    await serveFixtures(page);
    console.log(`\n[run ${runIdx}] ${BASE_URL}/?${QUERY}`);
    await page.goto(`${BASE_URL}/?${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await clickStart(page);
    await page.waitForFunction(() => !!window.__watershedScreenshot?.stepScripted, { timeout: 60_000 });
    const readyDeadline = Date.now() + 120_000;
    while (!(await page.evaluate(() => window.__watershedScreenshot.isScriptedReady()))) {
      if (Date.now() > readyDeadline) throw new Error('scripted run never went live');
      await sleep(250);
    }

    const calibrationMs = await page.evaluate(`(${CALIBRATE_SOURCE})(15).ms`);
    const fromMs = await page.evaluate(() => performance.now());
    for (let s = 1; s <= SECONDS; s += 1) {
      const stepped = await page.evaluate((n) => window.__watershedScreenshot.stepScripted(n), FRAMES_PER_SECOND);
      if (stepped !== FRAMES_PER_SECOND) throw new Error(`stepScripted advanced ${stepped}/${FRAMES_PER_SECOND} frames`);
    }
    const telemetry = await page.evaluate(() => window.__watershedScreenshot.getScriptedTelemetry());
    let appended = 0;
    for (let a = 0; a < APPENDS; a += 1) {
      const before = await page.evaluate(() => performance.getEntriesByName('segment-mount').length);
      if (!(await page.evaluate(() => window.__watershedScreenshot.advanceTreadmill()))) break;
      appended += 1;
      await page
        .waitForFunction((n) => performance.getEntriesByName('segment-mount').length > n, { timeout: MOUNT_TIMEOUT_MS, polling: 50 }, before)
        .catch(() => {});
    }
    const json = await page.evaluate(async () => JSON.stringify(await window.__watershed.trace.stop()));
    const trace = JSON.parse(json);
    console.log(
      `  calibration ${calibrationMs.toFixed(2)} ms; ${SECONDS} sim s to segment ${telemetry.segmentIndex}, ${appended} appends; ` +
        `${trace.traceEvents.length} events; threads ${trace.metadata.threads
          .map((t) => `${t.thread} (${t.events} ev, ${t.dropped} dropped, ±${t.alignErrorMs} ms)`)
          .join(', ')}`,
    );
    return { ok: true, trace, calibrationMs, fromUs: fromMs * 1000, pageErrors };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), pageErrors };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[perf-trace] ${SECONDS} sim s × ${RUNS} runs, suite ${SUITE}${UPDATE ? ' (updating baseline)' : ''}`);
  const failures = [];
  const runs = [];
  for (let i = 1; i <= RUNS; i += 1) {
    const r = await runOnce(i);
    if (!r.ok) {
      console.error(`[perf-trace] run ${i} failed: ${r.reason}`);
      for (const e of r.pageErrors.slice(0, 20)) console.error(`  page: ${e}`);
      process.exit(1);
    }
    runs.push(r);
    if (i === 1) fs.writeFileSync(path.join(OUT_DIR, `${SUITE}-run1.trace.json`), JSON.stringify(r.trace));
    failures.push(...checkAlignment(`run ${i}`, r.trace));
  }

  // Smallest p95 / p50 per metric across runs; the smallest calibration likewise.
  const perRun = runs.map((r) => metricsOf(spanDurations(r.trace, r.fromUs)));
  const metrics = {};
  for (const key of new Set(perRun.flatMap((m) => Object.keys(m)))) {
    const rows = perRun.map((m) => m[key]).filter(Boolean);
    metrics[key] = {
      n: Math.min(...rows.map((r) => r.n)),
      p50: Math.min(...rows.map((r) => r.p50)),
      p95: Math.min(...rows.map((r) => r.p95)),
    };
  }
  const current = { calibrationMs: Math.min(...runs.map((r) => r.calibrationMs)), metrics };
  const note = `scripted meander, ${SECONDS} sim s, min of ${RUNS} runs; SwiftShader (render spans are not GPU numbers)`;
  writeBaseline(SUITE, { ...current, note }, path.join(OUT_DIR, `${SUITE}.candidate.json`));

  if (UPDATE) {
    const file = writeBaseline(SUITE, { ...current, note });
    console.log(`[perf-trace] baseline written: ${path.relative(REPO_ROOT, file)}`);
  } else {
    const baseline = readJson(baselinePath(SUITE));
    const tolerance = readJson(path.join(BASELINE_DIR, 'tolerance.json'));
    const result = compareToBaseline(SUITE, current, baseline, tolerance);
    if (!reportComparison(`perf-trace ${SUITE}`, result, current, baseline)) failures.push('p95 regression past tolerance (above)');
  }

  if (LIVE_MS > 0) {
    const live = await liveRun();
    if (!live.ok) {
      failures.push(`live phase failed: ${live.reason}`);
      for (const e of live.pageErrors.slice(0, 20)) console.error(`  page: ${e}`);
    } else {
      fs.writeFileSync(path.join(OUT_DIR, 'live-raft.trace.json'), JSON.stringify(live.trace));
      const threads = live.trace.metadata.threads.map((t) => t.thread);
      const gpu = live.trace.traceEvents.some((e) => e.ph === 'C' && e.name === 'gpu frame ms');
      console.log(`  tracks: ${threads.join(', ')}; GPU counter ${gpu ? 'present' : 'absent (no timer query on this GPU)'}`);
      for (const want of LIVE_TRACKS) {
        if (!threads.includes(want)) failures.push(`live phase: no ${want} track (raise PERF_TRACE_LIVE_MS on a slow box)`);
      }
      failures.push(...checkAlignment('live', live.trace));
      console.table(
        Object.entries(metricsOf(spanDurations(live.trace)))
          .filter(([key]) => !key.startsWith('main/'))
          .map(([key, m]) => ({ key, ...m })),
      );
    }
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('[perf-trace] ✓ pass');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[perf-trace] fatal:', err);
    process.exit(1);
  });
}
