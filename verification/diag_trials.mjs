/**
 * diag_trials.mjs — Run N independent cold boots and record whether each lands
 * healthy (glacier prelude, sane Y) or corrupt (NaN Y / runaway segment / max-depth).
 * Measures the startup-race crash rate behind the 2026-06-18 live-test gate.
 */
import puppeteer from 'puppeteer';

const BASE = process.env.WATERSHED_URL ?? 'http://localhost:3000';
const TARGET = `${BASE}?renderer=webgl&screenshot=1`;
const N = Number(process.env.TRIALS ?? 6);
const CHROME_ARGS = [
  '--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--disable-software-rasterizer',
  '--window-size=800,600', '--hide-scrollbars',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function trial(i) {
  const browser = await puppeteer.launch({
    headless: 'new', ignoreDefaultArgs: true,
    executablePath: '/usr/bin/google-chrome', args: CHROME_ARGS,
    protocolTimeout: 120_000,
  });
  const out = { trial: i, maxDepth: 0, seg: null, y: null, status: 'unknown' };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    page.on('pageerror', (e) => { if (/Maximum update depth/.test(e.message)) out.maxDepth += 1; });
    await page.goto(TARGET, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('canvas', { timeout: 40000 });
    await sleep(3500);
    await page.click('.start-menu-start-btn').catch(() => {});
    await page.evaluate(() => {
      const c = document.querySelector('canvas');
      c.requestPointerLock = () => Promise.resolve();
      Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => c });
      document.dispatchEvent(new Event('pointerlockchange'));
    });
    await page.waitForFunction(() => !!window.__watershedScreenshot, { timeout: 15000 }).catch(() => {});
    if (process.env.NOKEY !== '1') await page.keyboard.down('w');
    await sleep(8000);
    const s = await Promise.race([
      page.evaluate(() => {
        const d = window.__watershedPhysicsDebug ?? {};
        return { seg: d.currentSegmentIndex, y: d.position?.y };
      }),
      sleep(5000).then(() => ({ seg: 'HANG', y: 'HANG' })),
    ]);
    out.seg = s.seg; out.y = s.y;
    const bad = out.maxDepth > 0 || s.seg === 'HANG' ||
      (typeof s.y === 'number' && (!Number.isFinite(s.y) || Math.abs(s.y) > 100)) ||
      (typeof s.seg === 'number' && s.seg > 10);
    out.status = bad ? 'CORRUPT' : 'HEALTHY';
  } catch (e) {
    out.status = 'ERROR'; out.err = e.message;
  } finally {
    await browser.close().catch(() => {});
  }
  return out;
}

let healthy = 0;
for (let i = 1; i <= N; i++) {
  const r = await trial(i);
  const yStr = typeof r.y === 'number' ? r.y.toExponential(2) : r.y;
  console.log(`trial ${i}: ${r.status.padEnd(8)} seg=${r.seg} y=${yStr} maxDepth=${r.maxDepth}${r.err ? ' err=' + r.err : ''}`);
  if (r.status === 'HEALTHY') healthy += 1;
}
console.log(`\nHEALTHY ${healthy}/${N}  (CORRUPT/ERROR ${N - healthy}/${N})`);
