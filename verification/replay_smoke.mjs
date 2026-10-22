/**
 * replay_smoke.mjs — `?replay=<ghost>` reproduces a run: same splits, same water.
 *
 * 1. Record: a scripted meander run (`?input=script:<fixture>`, the
 *    input-smoke fixture) until the gate segment's split lands; the run is
 *    saved as a `.wsghost` through the test API (`getGhostFile()` — the same
 *    file the results panel exports: poses, the v4 input track, launch hour,
 *    seed, vehicle and the day's conditions).
 * 2. Replay that ghost REPLAYS times, each in a fresh browser: `?replay=` boots
 *    straight into the ghost's river (no menu click) and its input track drives
 *    the runner on the fixed scripted clock.
 *
 * Gates (replay vs replay — the determinism contract):
 *   - identical split segments and tMs
 *   - identical SWE state checksums at every split (and non-null: the run uses
 *     `quality=medium` so the field is on; a scripted or replay run always
 *     steps it on the main thread, in frame order — sweBackend `scripted-run`)
 *   - the gate segment's split exists
 * The recorded run's own splits print beside them, advisory: the ghost stores
 * input per 10 Hz window, so a replay of a run need only be close to it, and
 * must be exact to every other replay.
 *
 * Usage:
 *   pnpm build && pnpm preview --host 127.0.0.1 --port 4173
 *   WATERSHED_URL=http://127.0.0.1:4173 pnpm test:replay-smoke
 *
 * Env:
 *   WATERSHED_URL               Base URL (default http://127.0.0.1:4173)
 *   INPUT_SCRIPT                Recording script (default /verification/fixtures/input/meander_run.json)
 *   REPLAY_SMOKE_SECONDS        Sim seconds per run (default 40)
 *   REPLAY_SMOKE_SPLIT_SEGMENT  Segment whose split must land (default 3)
 *   REPLAY_SMOKE_REPLAYS        Replays compared (default 2)
 *   REPLAY_SMOKE_QUALITY        `?quality=` for every run (default medium; SWE is off at low)
 *   PUPPETEER_EXECUTABLE_PATH   Optional Chrome binary override
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'output', 'replay-smoke');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SCRIPT_PATH = process.env.INPUT_SCRIPT ?? '/verification/fixtures/input/meander_run.json';
const SIM_SECONDS = Math.max(1, Number(process.env.REPLAY_SMOKE_SECONDS ?? '40'));
const SPLIT_SEGMENT = Number(process.env.REPLAY_SMOKE_SPLIT_SEGMENT ?? '3');
const REPLAYS = Math.max(2, Number(process.env.REPLAY_SMOKE_REPLAYS ?? '2'));
const QUALITY = process.env.REPLAY_SMOKE_QUALITY ?? 'medium';
const FRAMES_PER_SECOND = 60;
/** Where the page fetches the recorded ghost; served from OUT_DIR by interception. */
const GHOST_URL_PATH = '/__replay_smoke__/recorded.wsghost';
const COMMON = `cleanTest=1&renderer=webgl&screenshot=1&quality=${QUALITY}`;

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    return puppeteer.executablePath();
  } catch {
    return undefined;
  }
}

/** Serve the input fixtures and the recorded ghost from disk; everything else goes to the preview server. */
async function serveLocal(page, ghostJson) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(BASE_URL).origin) {
      req.continue();
      return;
    }
    if (url.pathname === GHOST_URL_PATH) {
      if (ghostJson === null) req.respond({ status: 404, body: 'not found' });
      else req.respond({ status: 200, contentType: 'application/json', body: ghostJson });
      return;
    }
    if (url.pathname.startsWith('/verification/fixtures/')) {
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

async function runOnce(label, query, { clickStart, ghostJson }) {
  const pageErrors = [];
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: resolveChromePath(),
    protocolTimeout: 180_000,
    args: CHROME_ARGS,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`);
    });
    await serveLocal(page, ghostJson);

    console.log(`\n[${label}] ${BASE_URL}/?${query}`);
    await page.goto(`${BASE_URL}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (clickStart) {
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('.start-menu-start-btn');
          return !!btn && !btn.disabled;
        },
        { timeout: 90_000 },
      );
      await page.evaluate(() => document.querySelector('.start-menu-start-btn').click());
    }
    await page.waitForFunction(() => !!window.__watershedScreenshot?.stepScripted, { timeout: 120_000 });
    const readyDeadline = Date.now() + 120_000;
    while (!(await page.evaluate(() => window.__watershedScreenshot.isScriptedReady()))) {
      if (Date.now() > readyDeadline) throw new Error('run never went live (ghost / script load, vehicle mount)');
      await sleep(250);
    }

    let splits = [];
    let checksums = [];
    let telemetry = null;
    for (let s = 1; s <= SIM_SECONDS; s += 1) {
      const stepped = await page.evaluate((n) => window.__watershedScreenshot.stepScripted(n), FRAMES_PER_SECOND);
      if (stepped !== FRAMES_PER_SECOND) throw new Error(`stepScripted advanced ${stepped}/${FRAMES_PER_SECOND} frames`);
      ({ splits, checksums, telemetry } = await page.evaluate(() => ({
        splits: window.__watershedScreenshot.getSplits(),
        checksums: window.__watershedScreenshot.getSplitChecksums(),
        telemetry: window.__watershedScreenshot.getScriptedTelemetry(),
      })));
      if (splits.some((sp) => sp.segmentIndex >= SPLIT_SEGMENT)) break;
    }
    const ghostFile = await page.evaluate(() => window.__watershedScreenshot.getGhostFile());
    console.log(
      `  ${splits.length} splits by sim ${telemetry.simTimeSec.toFixed(1)} s; seg ${telemetry.segmentIndex}; ` +
        `checksums ${checksums.map((c) => c ?? '—').join(' ')}`,
    );
    return { ok: true, splits, checksums, ghostFile, pageErrors };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), pageErrors };
  } finally {
    await browser.close().catch(() => {});
  }
}

function table(splits, checksums) {
  return splits.map((s, i) => `seg ${String(s.segmentIndex).padStart(3)}  ${String(s.tMs).padStart(6)} ms  swe ${checksums[i] ?? '—'}`);
}

async function main() {
  console.log(
    `[replay-smoke] script=${SCRIPT_PATH} seconds=${SIM_SECONDS} gate=segment ${SPLIT_SEGMENT} replays=${REPLAYS} quality=${QUALITY}`,
  );
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const recorded = await runOnce('record', `map=meander&${COMMON}&input=script:${SCRIPT_PATH}`, {
    clickStart: true,
    ghostJson: null,
  });
  if (!recorded.ok || !recorded.ghostFile) {
    console.error(`[replay-smoke] recording failed: ${recorded.reason ?? 'no ghost file'}`);
    for (const e of recorded.pageErrors.slice(0, 20)) console.error(`  page: ${e}`);
    process.exit(1);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'recorded.wsghost'), recorded.ghostFile);

  const replays = [];
  for (let i = 1; i <= REPLAYS; i += 1) {
    const r = await runOnce(`replay ${i}`, `replay=${GHOST_URL_PATH}&${COMMON}`, {
      clickStart: false,
      ghostJson: recorded.ghostFile,
    });
    if (!r.ok) {
      console.error(`[replay-smoke] replay ${i} failed: ${r.reason}`);
      for (const e of r.pageErrors.slice(0, 20)) console.error(`  page: ${e}`);
      process.exit(1);
    }
    replays.push(r);
  }

  const failures = [];
  const first = replays[0];
  if (!first.splits.some((s) => s.segmentIndex === SPLIT_SEGMENT)) failures.push(`no replay split for segment ${SPLIT_SEGMENT}`);
  if (first.checksums.some((c) => c === null)) {
    failures.push('a split has no SWE checksum (the field was off — check ?quality)');
  }
  const key = (r) => r.splits.map((s, i) => `${s.segmentIndex}:${s.tMs}:${r.checksums[i]}`).join(',');
  for (let i = 1; i < replays.length; i += 1) {
    if (key(replays[i]) !== key(first)) failures.push(`replay ${i + 1} differs from replay 1 (splits or SWE state)`);
  }

  console.log('\n[replay-smoke] recorded run (advisory):');
  for (const line of table(recorded.splits, recorded.checksums)) console.log(`  ${line}`);
  for (const [i, r] of replays.entries()) {
    console.log(`[replay-smoke] replay ${i + 1}:`);
    for (const line of table(r.splits, r.checksums)) console.log(`  ${line}`);
  }

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('[replay-smoke] ✓ pass — replays agree split for split, SWE state included');
}

main().catch((err) => {
  console.error('[replay-smoke] fatal:', err);
  process.exit(1);
});
