/**
 * lumber_flume_smoke.mjs — Smoke screenshots for Lumber Flume set-pieces.
 * Launches a fresh Chrome per boot attempt (SwiftShader often kills the browser).
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'output');
const BASE = process.env.WATERSHED_URL ?? 'http://localhost:3000';
const TARGET = `${BASE}?map=lumber&renderer=webgl&screenshot=1&no-pointer-lock=1`;
const ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
  '--window-size=1280,720',
  '--hide-scrollbars',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SHOTS = [
  { seg: 5, file: 'lumber_flume.png' },
  { seg: 10, file: 'lumber_gap.png' },
  { seg: 11, file: 'lumber_landing.png' },
];

async function launch() {
  return puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
    args: ARGS,
  });
}

async function bootOnce() {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));

  try {
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await sleep(2500);

    const crashed = await page.evaluate(
      () => /Maximum update depth|Application Error/i.test(document.body.innerText || ''),
    );
    if (crashed) {
      await browser.close();
      return { ok: false, reason: 'update-depth', errors };
    }

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button,[role=button]')).find((el) =>
        /start|play|begin/i.test(el.innerText || ''),
      );
      btn?.click();
    });
    await sleep(1500);

    await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return;
      c.requestPointerLock = () => Promise.resolve();
      try {
        Object.defineProperty(document, 'pointerLockElement', {
          configurable: true,
          get: () => c,
        });
        document.dispatchEvent(new Event('pointerlockchange'));
      } catch (_) {}
    });

    await page.waitForFunction(() => !!window.__watershedScreenshot, { timeout: 20000 });
    await sleep(3000);

    const status = await page.evaluate(() => ({
      hasApi: !!window.__watershedScreenshot,
      crashed: /Maximum update depth|Application Error/i.test(document.body.innerText || ''),
    }));

    if (status.crashed || !status.hasApi) {
      await browser.close();
      return { ok: false, reason: status.crashed ? 'post-start-crash' : 'no-api', errors };
    }

    return { ok: true, browser, page, errors };
  } catch (err) {
    await browser.close().catch(() => {});
    return { ok: false, reason: String(err.message || err), errors };
  }
}

fs.mkdirSync(OUT, { recursive: true });

let session = null;
for (let i = 0; i < 6; i += 1) {
  console.log(`boot attempt ${i + 1}`);
  session = await bootOnce();
  if (session.ok) {
    console.log('boot ok');
    break;
  }
  console.log('boot failed:', session.reason, session.errors?.slice(0, 3));
  await sleep(800);
}

if (!session?.ok) {
  console.error('Could not boot');
  process.exit(1);
}

const { browser, page } = session;

await page.evaluate(() => {
  document
    .querySelectorAll('.ui-overlay,.game-hud,.pause-menu,.start-menu,.debug-panel')
    .forEach((el) => {
      el.style.opacity = '0';
    });
});

const report = { url: TARGET, shots: [] };
for (const shot of SHOTS) {
  console.log(`capture seg ${shot.seg} → ${shot.file}`);
  await page.evaluate((seg) => window.__watershedScreenshot.teleportToSegment(seg), shot.seg);
  await sleep(4000);
  const outPath = path.join(OUT, shot.file);
  await page.screenshot({ path: outPath, type: 'png' });
  const meta = await page.evaluate(() => {
    const d = window.__watershedPhysicsDebug || {};
    return {
      seg: d.currentSegmentIndex ?? null,
      y: d.position?.y ?? null,
      textHit: (document.body.innerText || '').match(/LUMBER|FLUME|CANYON|SUMMER/i)?.[0] ?? null,
    };
  });
  const size = fs.statSync(outPath).size;
  console.log(`  size=${size} meta=${JSON.stringify(meta)}`);
  report.shots.push({ ...shot, outPath, size, meta });
}

fs.writeFileSync(path.join(OUT, 'lumber_smoke_report.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log('done');
