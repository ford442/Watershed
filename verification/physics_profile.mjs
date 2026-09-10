/**
 * physics_profile.mjs — headless capture of Rapier physics-step timing
 * (via PhysicsPerfMonitor / physicsPerfMetrics) for the Phase 1 / Priority B
 * plan.md item: "Profile and optimize Rapier physics performance".
 *
 * Boots the app headlessly (same puppeteer/SwiftShader harness as
 * verification/visual_smoke.mjs), starts a run, and reads the
 * `window.__watershedPhysicsPerf` snapshot that PhysicsPerfMonitor writes
 * every 60 physics steps.
 *
 * Caveat: `window.__watershedScreenshot.teleportToSegment(id)` (used to jump
 * the camera for visual-smoke screenshots) only repositions the vehicle and
 * replays bookkeeping side effects — it does NOT force TrackManager/ChunkManager
 * to advance the mounted 7-segment collider pool to that segment index (that
 * only happens via real per-frame camera-distance travel in ChunkManager.update).
 * So each case here measures the physics-step cost of the treadmill's active
 * window near map start, not literally "segment 14" or "segment 21" geometry.
 * That's still representative: TrackManager always holds ~7 active segments
 * and `CANYON_COLLISION_SUBDIVISION_DIVISOR` bounds collider triangle count
 * per segment regardless of biome, so the measured order of magnitude holds
 * across the level script. Treat per-map (not per-biome) as the real axis here.
 *
 * Usage:
 *   npm start (or pnpm build && pnpm preview) in one terminal
 *   WATERSHED_URL=http://127.0.0.1:3000 node verification/physics_profile.mjs
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output', 'physics-profile');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const VERBOSE = process.env.VERBOSE === '1';

const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--use-gl=swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
  '--disable-gpu-sandbox',
  '--window-size=1280,720',
  '--hide-scrollbars',
];

const CASES = [
  { label: 'default_map_early_window', query: 'cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1' },
  { label: 'delta_map_early_window', query: 'map=delta&vehicle=raft&cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1' },
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

async function profileCase(kase) {
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: resolveChromePath(),
    protocolTimeout: 60_000,
    args: CHROME_ARGS,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(e.message || String(e)));
    if (VERBOSE) {
      page.on('console', (msg) => process.stderr.write(`[page:${msg.type()}] ${msg.text()}\n`));
    }

    await page.goto(`${BASE_URL}/?${kase.query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('canvas', { timeout: 45_000 });
    await page.waitForSelector('.start-menu-start-btn', { timeout: 45_000 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.start-menu-start-btn');
        return !!btn && !btn.disabled;
      },
      { timeout: 45_000 },
    );
    await sleep(300);
    await page.evaluate(() => document.querySelector('.start-menu-start-btn')?.click());

    await page.waitForFunction(() => !!window.__watershedScreenshot, { timeout: 20_000 });

    // Poll for the 60-physics-step sample window instead of a blind sleep —
    // headless SwiftShader render rate varies a lot run to run.
    let gotSnapshot = false;
    for (let i = 0; i < 24; i += 1) {
      gotSnapshot = await page.evaluate(() => !!window.__watershedPhysicsPerf);
      if (gotSnapshot) break;
      await sleep(5_000);
    }

    const snapshot = await page.evaluate(() => window.__watershedPhysicsPerf ?? null);
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const crashed = /Maximum update depth|Application Error/i.test(bodyText);

    return { label: kase.label, gotSnapshot, snapshot, crashed, consoleErrors };
  } catch (err) {
    return { label: kase.label, error: String(err.message || err) };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  for (const kase of CASES) {
    process.stderr.write(`[profile] ${kase.label}...\n`);
    const result = await profileCase(kase);
    results.push(result);
    process.stderr.write(`${JSON.stringify(result)}\n`);
  }
  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ url: BASE_URL, capturedAt: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nReport: ${reportPath}`);
}

run();
