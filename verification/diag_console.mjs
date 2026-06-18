/**
 * diag_console.mjs — Capture console output + failed network requests during a
 * clean healthy boot, to check for shader-fallback spam (item 2) and fatal 404s
 * (item 3). Retries until a non-corrupt boot is obtained.
 */
import puppeteer from 'puppeteer';

const BASE = process.env.WATERSHED_URL ?? 'http://localhost:3000';
const TARGET = `${BASE}?renderer=webgl&cleanTest=1`;
const CHROME_ARGS = [
  '--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--disable-software-rasterizer',
  '--window-size=1280,720', '--hide-scrollbars',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot() {
  const browser = await puppeteer.launch({
    headless: 'new', ignoreDefaultArgs: true,
    executablePath: '/usr/bin/google-chrome', args: CHROME_ARGS,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const console_ = [];
  const failed = [];
  page.on('console', (m) => console_.push({ type: m.type(), text: m.text() }));
  page.on('requestfailed', (r) => failed.push({ url: r.url(), err: r.failure()?.errorText }));
  page.on('response', (r) => { if (r.status() === 404) failed.push({ url: r.url(), status: 404 }); });

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
  await sleep(10000);
  const y = await page.evaluate(() => window.__watershedPhysicsDebug?.position?.y);
  const healthy = typeof y === 'number' && Number.isFinite(y) && Math.abs(y) < 100;
  await browser.close();
  return { healthy, y, console_, failed };
}

let r;
for (let i = 0; i < 5; i++) {
  r = await boot();
  console.log(`boot ${i + 1}: ${r.healthy ? 'HEALTHY' : 'corrupt'} (y=${r.y})`);
  if (r.healthy) break;
}

const counts = {};
for (const m of r.console_) counts[m.type] = (counts[m.type] ?? 0) + 1;
console.log('\nConsole message counts by type:', JSON.stringify(counts));

const warnsErrors = r.console_.filter((m) => m.type === 'warning' || m.type === 'error');
// Dedupe + count repeats to surface "spam".
const tally = {};
for (const m of warnsErrors) tally[m.text] = (tally[m.text] ?? 0) + 1;
console.log('\n--- warnings/errors (text × count) ---');
for (const [text, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}×  ${text.slice(0, 160)}`);
}

console.log('\n--- failed requests / 404s ---');
const ftally = {};
for (const f of r.failed) ftally[f.url] = (ftally[f.url] ?? 0) + 1;
const entries = Object.entries(ftally);
if (!entries.length) console.log('  (none)');
for (const [url, n] of entries) console.log(`  ${n}×  ${url.replace(BASE, '')}`);
