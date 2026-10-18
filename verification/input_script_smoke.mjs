/**
 * input_script_smoke.mjs — headless scripted run of the meander, gated on splits (#486 A).
 *
 * Boots `?map=meander&input=script:<fixture>` (the Canvas comes up
 * `frameloop="never"`), clicks start, waits for the scripted source to go
 * live, then drives the sim with `__watershedScreenshot.stepScripted(60)` —
 * one sim second per call, rendering only the last frame of each — and prints
 * the splits and the runner pose + speed after every second.
 *
 * Gates:
 *   - a split for segment SPLIT_SEGMENT exists and its tMs < SIM_SECONDS × 1000
 *   - speed at every split > 0
 *   - RUNS consecutive runs of the same script produce identical split tMs
 *     (the determinism contract a `?replay=` needs; both tables print on failure)
 *
 * The fixture is served from verification/fixtures/ by request interception,
 * so it never ships in build/.
 *
 * Usage:
 *   pnpm build && pnpm preview --host 127.0.0.1 --port 4173
 *   WATERSHED_URL=http://127.0.0.1:4173 pnpm test:input-smoke
 *
 * Env:
 *   WATERSHED_URL              Base URL (default http://127.0.0.1:4173)
 *   INPUT_SCRIPT               Script path under the site root
 *                              (default /verification/fixtures/input/meander_run.json)
 *   INPUT_SMOKE_SECONDS        Sim seconds to run (default 40)
 *   INPUT_SMOKE_SPLIT_SEGMENT  Segment whose split must land (default 3)
 *   INPUT_SMOKE_RUNS           Runs compared for determinism (default 2)
 *   PUPPETEER_EXECUTABLE_PATH  Optional Chrome binary override
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SCRIPT_PATH = process.env.INPUT_SCRIPT ?? '/verification/fixtures/input/meander_run.json';
const SIM_SECONDS = Math.max(1, Number(process.env.INPUT_SMOKE_SECONDS ?? '40'));
const SPLIT_SEGMENT = Number(process.env.INPUT_SMOKE_SPLIT_SEGMENT ?? '3');
const RUNS = Math.max(1, Number(process.env.INPUT_SMOKE_RUNS ?? '2'));
const FRAMES_PER_SECOND = 60;
const QUERY = `map=meander&cleanTest=1&renderer=webgl&screenshot=1&input=script:${SCRIPT_PATH}`;

// SwiftShader is no longer an automatic fallback: ask for it explicitly.
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

/** Serve /verification/fixtures/** from disk; everything else goes to the preview server. */
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

function fmtPos(p) {
  return p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : '(no body)';
}

async function runOnce(runIdx) {
  const pageErrors = [];
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: resolveChromePath(),
    protocolTimeout: 180_000,
    args: CHROME_ARGS,
  });
  const wallStart = Date.now();
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
    await page.waitForSelector('.start-menu-start-btn', { timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.start-menu-start-btn');
        return !!btn && !btn.disabled;
      },
      { timeout: 90_000 },
    );
    await page.evaluate(() => document.querySelector('.start-menu-start-btn').click());
    await page.waitForFunction(() => !!window.__watershedScreenshot?.stepScripted, { timeout: 60_000 });

    // The sim is frozen (frameloop="never") until we step, so waiting here
    // costs wall time only: nothing physics-side moves until the run is live.
    const readyDeadline = Date.now() + 120_000;
    while (!(await page.evaluate(() => window.__watershedScreenshot.isScriptedReady()))) {
      if (Date.now() > readyDeadline) throw new Error('scripted run never went live (script load / vehicle mount)');
      await sleep(250);
    }
    const bootMs = Date.now() - wallStart;
    console.log(`  live after ${(bootMs / 1000).toFixed(1)} s wall`);

    const stepStart = Date.now();
    let telemetry = null;
    let splits = [];
    for (let s = 1; s <= SIM_SECONDS; s += 1) {
      const stepped = await page.evaluate((n) => window.__watershedScreenshot.stepScripted(n), FRAMES_PER_SECOND);
      if (stepped !== FRAMES_PER_SECOND) throw new Error(`stepScripted advanced ${stepped}/${FRAMES_PER_SECOND} frames`);
      ({ telemetry, splits } = await page.evaluate(() => ({
        telemetry: window.__watershedScreenshot.getScriptedTelemetry(),
        splits: window.__watershedScreenshot.getSplits(),
      })));
      const last = splits[splits.length - 1];
      console.log(
        `  t=${String(s).padStart(2)}s  seg=${String(telemetry.segmentIndex).padStart(2)}  pos=${fmtPos(telemetry.pos)}` +
          `  speed=${telemetry.speed.toFixed(2)}  splits=${splits.length}` +
          (last ? `  last=[seg ${last.segmentIndex} @ ${last.tMs} ms]` : ''),
      );
      // Gate reached: both runs stop at the same sim second if they agree.
      if (splits.some((sp) => sp.segmentIndex >= SPLIT_SEGMENT)) break;
    }
    const stepMs = Date.now() - stepStart;
    console.log(
      `  stepped ${telemetry.simTimeSec.toFixed(1)} sim s in ${(stepMs / 1000).toFixed(1)} s wall; ` +
        `hub tick ${(telemetry.hubTickMeanMs * 1000).toFixed(1)} µs/frame over ${telemetry.hubTicks} ticks`,
    );
    return { ok: true, splits, telemetry, pageErrors, bootMs, stepMs };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err), pageErrors };
  } finally {
    await browser.close().catch(() => {});
  }
}

function printSplits(label, splits) {
  console.log(`  ${label}:`);
  for (const s of splits) {
    console.log(`    seg ${String(s.segmentIndex).padStart(3)}  ${String(s.tMs).padStart(6)} ms  speed ${s.speed.toFixed(2)}`);
  }
}

async function main() {
  console.log(`[input-smoke] script=${SCRIPT_PATH} seconds=${SIM_SECONDS} gate=segment ${SPLIT_SEGMENT} runs=${RUNS}`);
  const fixture = path.join(REPO_ROOT, SCRIPT_PATH);
  if (!fs.existsSync(fixture)) {
    console.error(`[input-smoke] fixture not found: ${fixture}`);
    process.exit(1);
  }

  const results = [];
  for (let i = 1; i <= RUNS; i += 1) {
    const r = await runOnce(i);
    if (!r.ok) {
      console.error(`[input-smoke] run ${i} failed: ${r.reason}`);
      for (const e of r.pageErrors.slice(0, 20)) console.error(`  page: ${e}`);
      process.exit(1);
    }
    results.push(r);
  }

  const failures = [];
  const first = results[0];
  const gate = first.splits.find((s) => s.segmentIndex === SPLIT_SEGMENT);
  if (!gate) failures.push(`no split for segment ${SPLIT_SEGMENT}`);
  else if (gate.tMs >= SIM_SECONDS * 1000) failures.push(`segment ${SPLIT_SEGMENT} split ${gate.tMs} ms ≥ ${SIM_SECONDS * 1000} ms`);
  for (const s of first.splits) {
    if (!(s.speed > 0)) failures.push(`non-positive speed ${s.speed} at segment ${s.segmentIndex}`);
  }

  for (let i = 1; i < results.length; i += 1) {
    const a = first.splits.map((s) => `${s.segmentIndex}:${s.tMs}`).join(',');
    const b = results[i].splits.map((s) => `${s.segmentIndex}:${s.tMs}`).join(',');
    if (a !== b) {
      failures.push(`run ${i + 1} split times differ from run 1`);
      printSplits('run 1', first.splits);
      printSplits(`run ${i + 1}`, results[i].splits);
    }
  }

  console.log('\n[input-smoke] splits (run 1):');
  printSplits('run 1', first.splits);
  const meanTickUs = results.reduce((acc, r) => acc + r.telemetry.hubTickMeanMs, 0) / results.length * 1000;
  console.log(`[input-smoke] hub + sources: ${meanTickUs.toFixed(1)} µs/frame (budget 100 µs)`);
  console.log(`[input-smoke] wall: ${results.map((r) => `${((r.bootMs + r.stepMs) / 1000).toFixed(1)} s`).join(', ')}`);

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('[input-smoke] ✓ pass');
}

main().catch((err) => {
  console.error('[input-smoke] fatal:', err);
  process.exit(1);
});
