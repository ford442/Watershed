/**
 * diag_classify.mjs — Separate F-8 failure modes from harness flakes.
 * For each boot record: did Start register (menu gone)?, is position populated?,
 * is Y healthy?, were there page errors? Distinguishes a real physics blowup
 * (started + huge Y) from a start-click race (menu still present / position null).
 */
import puppeteer from 'puppeteer';

const BASE = process.env.WATERSHED_URL ?? 'http://localhost:3000';
const TARGET = `${BASE}?renderer=webgl&screenshot=1`;
const N = Number(process.env.TRIALS ?? 10);
const CHROME_ARGS = [
  '--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--disable-software-rasterizer',
  '--window-size=640,480', '--hide-scrollbars',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot() {
  const browser = await puppeteer.launch({
    headless: 'new', ignoreDefaultArgs: true,
    executablePath: '/usr/bin/google-chrome', args: CHROME_ARGS,
    protocolTimeout: 120_000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480 });
  let pageErr = 0;
  page.on('pageerror', () => { pageErr += 1; });
  await page.goto(TARGET, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 40000 });
  await sleep(3000);
  const clicked = await page.evaluate(() => {
    const b = document.querySelector('.start-menu-start-btn');
    if (b) { b.click(); return true; }
    return false;
  });
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    c.requestPointerLock = () => Promise.resolve();
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => c });
    document.dispatchEvent(new Event('pointerlockchange'));
  });
  await page.waitForFunction(() => !!window.__watershedScreenshot, { timeout: 12000 }).catch(() => {});
  await sleep(8000);
  const r = await page.evaluate(() => {
    const d = window.__watershedPhysicsDebug ?? {};
    return {
      menuPresent: !!document.querySelector('.start-menu-start-btn'),
      hasPos: d.position != null,
      y: d.position?.y ?? null,
      seg: d.currentSegmentIndex ?? null,
    };
  });
  await browser.close();
  let mode;
  if (r.menuPresent) mode = 'FLAKE_menu_still_up';
  else if (!r.hasPos) mode = 'init_no_physics_step';
  else if (typeof r.y === 'number' && Number.isFinite(r.y) && Math.abs(r.y) < 100) mode = 'HEALTHY';
  else mode = 'REAL_blowup';
  return { clicked, pageErr, mode, ...r };
}

const tally = {};
for (let i = 1; i <= N; i++) {
  const r = await boot();
  tally[r.mode] = (tally[r.mode] ?? 0) + 1;
  const yStr = typeof r.y === 'number' ? r.y.toExponential(2) : r.y;
  console.log(`boot ${String(i).padStart(2)}: ${r.mode.padEnd(20)} clicked=${r.clicked} menu=${r.menuPresent} pos=${r.hasPos} y=${yStr} seg=${r.seg} pageErr=${r.pageErr}`);
}
console.log('\nTALLY:', JSON.stringify(tally));
