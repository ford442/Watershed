/**
 * headless_trace.mjs — record what the browser does, for the headless pin (#556 B.2).
 *
 * `src/sim/headless/headless.campaign.test.ts` pins a Node run of the campaign
 * harness against the page. This is how the page's side was recorded, and how
 * it is re-recorded (when the page's gameplay legitimately changes, or a quirk
 * the harness reproduces is fixed — the test's header names them):
 *
 *   pnpm build && pnpm preview --host 127.0.0.1 --port 4173
 *   WATERSHED_URL=http://127.0.0.1:4173 node verification/headless_trace.mjs
 *
 * It runs the input smoke's scripted meander (`?input=script:` over the same
 * fixture, `quality=medium`) through `__watershedScreenshot.stepScripted`, and
 * every EVERY frames reads the runner's position (the harness telemetry) and
 * the flow the water gave it (the `waterForce` debug tap: SWE window origin,
 * sampled speed, stage), then the splits and their SWE checksums at the end.
 * Output: verification/fixtures/headless/meander_trace.json (override: OUT).
 *
 * Positions and flow are doubles read straight off the page; the test compares
 * them with `===`. Stepping in batches renders one frame in EVERY, so this
 * takes minutes, not an hour (a render per frame under SwiftShader is ~1 s).
 *
 * Env: WATERSHED_URL (default http://127.0.0.1:4173) · FRAMES (default 1500) ·
 *      EVERY (default 10) · OUT · PUPPETEER_EXECUTABLE_PATH
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SCRIPT_PATH = '/verification/fixtures/input/meander_run.json';
const FRAMES = Math.max(1, Number(process.env.FRAMES ?? '1500'));
const EVERY = Math.max(1, Number(process.env.EVERY ?? '10'));
const OUT = process.env.OUT ?? path.join(__dirname, 'fixtures', 'headless', 'meander_trace.json');
const QUALITY = 'medium';
const QUERY = `map=meander&cleanTest=1&renderer=webgl&screenshot=1&quality=${QUALITY}&input=script:${SCRIPT_PATH}`;

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
  await page.goto(`${BASE_URL}/?${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.start-menu-start-btn', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const btn = document.querySelector('.start-menu-start-btn');
    return !!btn && !btn.disabled;
  }, { timeout: 90_000 });
  await page.evaluate(() => document.querySelector('.start-menu-start-btn').click());
  await page.waitForFunction(() => !!window.__watershedScreenshot?.stepScripted, { timeout: 60_000 });
  const deadline = Date.now() + 120_000;
  while (!(await page.evaluate(() => window.__watershedScreenshot.isScriptedReady()))) {
    if (Date.now() > deadline) throw new Error('scripted run never went live');
    await sleep(250);
  }

  const rows = [];
  for (let frame = EVERY; frame <= FRAMES; frame += EVERY) {
    const stepped = await page.evaluate((n) => window.__watershedScreenshot.stepScripted(n), EVERY);
    if (stepped !== EVERY) throw new Error(`stepScripted advanced ${stepped}/${EVERY} frames`);
    rows.push({
      frame,
      ...(await page.evaluate(() => {
        const t = window.__watershedScreenshot.getScriptedTelemetry();
        const w = window.__watershed?.waterForce;
        return {
          pos: [t.pos.x, t.pos.y, t.pos.z],
          speed: t.speed,
          segment: t.segmentIndex,
          flow: w ? { originX: w.origin.x, originZ: w.origin.z, speed: w.sampledSpeed, stage: w.stage } : null,
        };
      })),
    });
  }
  const { splits, checksums } = await page.evaluate(() => ({
    splits: window.__watershedScreenshot.getSplits().map((s) => ({ segmentIndex: s.segmentIndex, tMs: s.tMs, speed: s.speed })),
    checksums: window.__watershedScreenshot.getSplitChecksums(),
  }));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ script: SCRIPT_PATH, quality: QUALITY, every: EVERY, frames: FRAMES, rows, splits, checksums }, null, 1)}\n`,
  );
  console.log(`[headless-trace] wrote ${path.relative(REPO_ROOT, OUT)}: ${rows.length} rows, splits ${splits.map((s) => `${s.segmentIndex}@${s.tMs}`).join(' ')}, checksums ${checksums.join(' ')}`);
} finally {
  await browser.close().catch(() => {});
}
