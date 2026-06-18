/**
 * diag_trace.mjs — Sample player Y every 250ms through boot, retrying until a
 * corrupt boot is caught, then print the trajectory to classify the F-8 failure
 * mode (sudden write vs gradual fall-through vs exponential feedback).
 */
import puppeteer from 'puppeteer';

const BASE = process.env.WATERSHED_URL ?? 'http://localhost:3000';
const TARGET = `${BASE}?renderer=webgl&screenshot=1`;
const CHROME_ARGS = [
  '--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--disable-software-rasterizer',
  '--window-size=640,480', '--hide-scrollbars',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(i) {
  const browser = await puppeteer.launch({
    headless: 'new', ignoreDefaultArgs: true,
    executablePath: '/usr/bin/google-chrome', args: CHROME_ARGS,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480 });
  await page.goto(TARGET, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 40000 });
  await sleep(3000);
  await page.click('.start-menu-start-btn').catch(() => {});
  await page.evaluate(() => {
    const c = document.querySelector('canvas');
    c.requestPointerLock = () => Promise.resolve();
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => c });
    document.dispatchEvent(new Event('pointerlockchange'));
  });
  await page.waitForFunction(() => !!window.__watershedScreenshot, { timeout: 12000 }).catch(() => {});
  const samples = [];
  for (let t = 0; t < 28; t++) {
    await sleep(250);
    const s = await page.evaluate(() => {
      const d = window.__watershedPhysicsDebug ?? {};
      return { y: d.position?.y, z: d.position?.z, vy: d.linearVelocity?.y, seg: d.currentSegmentIndex };
    });
    samples.push(s);
  }
  await browser.close();
  const lastY = samples.at(-1).y;
  const corrupt = !(typeof lastY === 'number' && Number.isFinite(lastY) && Math.abs(lastY) < 100);
  return { corrupt, samples };
}

for (let i = 1; i <= 8; i++) {
  const r = await run(i);
  console.log(`\n=== boot ${i}: ${r.corrupt ? 'CORRUPT' : 'healthy'} ===`);
  if (r.corrupt || i === 8) {
    r.samples.forEach((s, k) => {
      const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) > 1e5 ? v.toExponential(2) : v.toFixed(2)) : String(v));
      console.log(`  t=${((k + 1) * 0.25).toFixed(2)}s  y=${fmt(s.y)}  vy=${fmt(s.vy)}  z=${fmt(s.z)}  seg=${s.seg}`);
    });
    if (r.corrupt) break;
  }
}
