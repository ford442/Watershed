/**
 * webgl_screenshots.mjs — Capture labeled WebGL2 screenshots of Map 1 gameplay.
 *
 * Usage:
 *   pnpm dev
 *   node verification/webgl_screenshots.mjs
 *
 * Output: verification/webgl/*.png + capture_report.json
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'webgl');
const BASE_URL = process.env.WATERSHED_URL ?? 'http://localhost:3000';
const URL = `${BASE_URL}?renderer=webgl&screenshot=1`;

const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--disable-software-rasterizer',
  '--window-size=1280,720',
  '--hide-scrollbars',
];

/** In-game captures: label + optional segment teleport (after start). */
const SHOTS = [
  { label: '01_meander_start', waitMs: 0 },
  { label: '02_meander_glacier', waitMs: 12000 },
  { label: '03_meander_flowing', waitMs: 30000 },
  { label: '04_canyon_run', waitMs: 60000 },
  { label: '05_downstream', segment: 13, settleMs: 6000 },
  { label: '06_slot_canyon', segment: 21, settleMs: 6000 },
  { label: '07_delta', segment: 33, settleMs: 6000 },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readCanvasPixel(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return null;
    const p = new Uint8Array(4);
    gl.readPixels(640, 360, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    return {
      rgba: Array.from(p),
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER),
    };
  });
}

function scoreFrame(pixel, fileSize) {
  const [r = 0, g = 0, b = 0] = pixel?.rgba ?? [];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const isMenu = fileSize > 120000 && luminance > 200;
  const isBlack = luminance < 12 || fileSize < 8000;
  const isSkyOnly = luminance > 175 && r > 140 && b > 140 && Math.abs(r - g) < 40;
  const isGood = !isMenu && !isBlack && !isSkyOnly && fileSize > 15000;
  return { luminance, isMenu, isBlack, isSkyOnly, isGood };
}

async function waitForPlaying(page) {
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('m/s') ||
      document.body.innerText.includes('km') ||
      document.body.innerText.includes('CANYON'),
    { timeout: 30000 }
  );
}

async function capture(page, label, report) {
  const outPath = path.join(OUT_DIR, `${label}.png`);
  await page.screenshot({ path: outPath, fullPage: false });
  const pixel = await readCanvasPixel(page);
  const state = await page.evaluate(() => ({
    segment: window.__watershedPhysicsDebug?.currentSegmentIndex ?? -1,
    position: window.__watershedPhysicsDebug?.position ?? null,
    inMenu: document.body.innerText.includes('START RUN'),
  }));
  const fileSize = fs.statSync(outPath).size;
  const frame = scoreFrame(pixel, fileSize);
  report.captures.push({ file: outPath, label, ...state, ...frame, centerPixel: pixel?.rgba });
  console.log(
    `  ✓ ${label}.png  seg=${state.segment}  ${fileSize}B  lum=${frame.luminance.toFixed(0)}${frame.isMenu ? ' [menu]' : ''}${frame.isGood ? ' [ok]' : ''}`
  );
  return frame.isGood;
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    url: URL,
    startedAt: new Date().toISOString(),
    captures: [],
    parityNotes: [],
  };

  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
    args: CHROME_ARGS,
  });

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.setViewport({ width: 1280, height: 720 });
  console.log(`Navigating to ${URL}`);
  await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
  await page.waitForSelector('canvas', { timeout: 60000 });
  await sleep(5000);

  await page.click('.start-menu-start-btn');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    canvas.requestPointerLock = () => Promise.resolve();
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => canvas });
    document.dispatchEvent(new Event('pointerlockchange'));
  });

  await waitForPlaying(page);
  await page.waitForFunction(() => !!window.__watershedScreenshot, { timeout: 20000 });
  await sleep(2000);

  const gl = await readCanvasPixel(page);
  report.webglVerified = !!gl?.version?.includes('WebGL');
  console.log(`WebGL: ${gl?.version} (${gl?.renderer})`);

  await page.keyboard.down('w');

  let elapsed = 0;
  let good = 0;
  for (const shot of SHOTS) {
    if (shot.segment != null) {
      await page.evaluate((seg) => window.__watershedScreenshot?.teleportToSegment(seg), shot.segment);
      await sleep(shot.settleMs ?? 4000);
    } else if (shot.waitMs > elapsed) {
      await sleep(shot.waitMs - elapsed);
      elapsed = shot.waitMs;
    }

    if (await capture(page, shot.label, report)) good += 1;
  }

  await page.keyboard.up('w');
  await browser.close();

  report.pageErrors = [...new Set(pageErrors)].slice(0, 20);
  if (report.pageErrors.some((e) => e.includes('firstElem.toArray'))) {
    report.parityNotes.push(
      'Teleporting far downstream triggers firstElem.toArray errors in flow/audio code — early-run captures are more stable.'
    );
  }
  report.parityNotes.push(
    'Avoid ?no-pointer-lock for screenshots; it forces top-down camera + HeadlessSkySphere.',
    'Use SwiftShader flags in headless CI; Vulkan ANGLE often fails without GPU.',
    'WebGPU default path may error under SwiftShader — force ?renderer=webgl.',
  );

  const reportPath = path.join(OUT_DIR, 'capture_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\nGood in-game frames: ${good}/${report.captures.length}`);
  console.log(`Report: ${reportPath}`);
  if (good < 4) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
