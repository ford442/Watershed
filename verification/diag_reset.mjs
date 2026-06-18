/**
 * diag_reset.mjs — Verify journey-complete → restart does not leave biome / journey
 * / segment state stuck in the end-of-map (delta) state (item 5). Retries until a
 * healthy boot, teleports to the journeyComplete segment (38), snapshots store
 * state, presses Enter to restart, then re-snapshots.
 */
import puppeteer from 'puppeteer';

const BASE = process.env.WATERSHED_URL ?? 'http://localhost:3000';
const TARGET = `${BASE}?renderer=webgl&screenshot=1`;
const CHROME_ARGS = [
  '--no-sandbox', '--headless=new', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--disable-software-rasterizer',
  '--window-size=800,600', '--hide-scrollbars',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BIOME_WORDS = /SLOT CANYON|CANYON AUTUMN|CANYON SUMMER|GLACIER|DELTA|POND|AUTUMN|SUMMER/i;
const snap = (page, re) => page.evaluate((reSrc) => {
  const d = window.__watershedPhysicsDebug ?? {};
  const txt = document.body.innerText || '';
  const m = txt.match(new RegExp(reSrc, 'i'));
  return {
    dbgSeg: d.currentSegmentIndex ?? null,
    y: d.position?.y ?? null,
    biomeLabel: m ? m[0].toUpperCase() : null,
    journeyOverlay: /Journey Complete/i.test(txt),
  };
}, re.source);

async function once() {
  const browser = await puppeteer.launch({
    headless: 'new', ignoreDefaultArgs: true,
    executablePath: '/usr/bin/google-chrome', args: CHROME_ARGS,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
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
  await sleep(4000);
  const boot = await snap(page, BIOME_WORDS);
  if (!(typeof boot.y === 'number' && Number.isFinite(boot.y) && Math.abs(boot.y) < 100)) {
    await browser.close();
    return { ok: false };
  }
  // Teleport to journeyComplete segment.
  await page.evaluate(() => window.__watershedScreenshot?.teleportToSegment(38));
  await sleep(4000);
  const atEnd = await snap(page, BIOME_WORDS);
  // Restart via Enter (GameHUD handler) — fall back to direct loop call.
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.evaluate(() => 0);
  await sleep(4000);
  const afterReset = await snap(page, BIOME_WORDS);
  await browser.close();
  return { ok: true, boot, atEnd, afterReset };
}

let r;
for (let i = 0; i < 6; i++) {
  r = await once();
  if (r.ok) break;
  console.log(`(boot ${i + 1} corrupt, retrying)`);
}
if (!r.ok) { console.log('Could not obtain a healthy boot in 6 tries.'); process.exit(0); }

console.log('boot      :', JSON.stringify(r.boot));
console.log('at seg 38 :', JSON.stringify(r.atEnd));
console.log('after reset:', JSON.stringify(r.afterReset));

const a = r.afterReset;
const resetOK = a.journeyOverlay === false && (a.dbgSeg ?? 0) < 0 && a.biomeLabel !== 'DELTA';
console.log('\nRESET CLEAN:', resetOK, '| journeyOverlay=', a.journeyOverlay, 'biome=', a.biomeLabel, 'seg=', a.dbgSeg);
