/**
 * diag_player_pos.mjs — Sample player physics debug state after start.
 *
 * Usage:
 *   pnpm dev
 *   node verification/diag_player_pos.mjs
 */
import puppeteer from 'puppeteer';

const BASE = process.env.WATERSHED_URL ?? 'http://localhost:3000';
const TARGET = `${BASE}?renderer=webgl&no-pointer-lock=1`;
const CHROME_ARGS = [
  '--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy',
  '--disable-search-engine-choice-screen', '--ash-no-nudges', '--no-first-run',
  '--disable-features=Translate', '--no-default-browser-check',
  '--window-size=1280,720', '--hide-scrollbars',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  ignoreDefaultArgs: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
  args: CHROME_ARGS,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto(TARGET, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => document.body.innerText.length > 0, { timeout: 30000 });
await sleep(3000);
await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('button,[role="button"],a'))
    .filter((el) => /start|play|begin/i.test(el.innerText || el.textContent || ''));
  if (candidates.length) candidates[0].click();
});
for (let i = 0; i < 6; i++) {
  await sleep(2000);
  const info = await page.evaluate(() => {
    const dbg = window.__watershedPhysicsDebug;
    return dbg
      ? {
          pos: dbg.position,
          vel: dbg.linearVelocity,
          speed: dbg.speed,
          grounded: dbg.isGrounded,
          segment: dbg.currentSegmentIndex,
        }
      : null;
  });
  console.log(`t=${(i + 1) * 2}`, info);
}
await browser.close();
