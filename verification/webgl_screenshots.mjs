/**
 * webgl_screenshots.mjs — Capture labeled WebGL2 screenshots of Map 1 gameplay.
 *
 * Usage:
 *   pnpm dev
 *   node verification/webgl_screenshots.mjs
 *
 * Output: verification/output/webgl/*.png + capture_report.json
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output', 'webgl');
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
  page.on('pageerror', (e) => {
    console.error('PAGE ERROR:', e.message);
    if (e.stack) console.error(e.stack);
    pageErrors.push(e.message);
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (
      msg.type() === 'error' ||
      text.includes('firstElem') ||
      text.includes('non-finite') ||
      text.includes('NaN') ||
      text.includes('linearRamp') ||
      text.includes('AudioWrap') ||
      text.includes('NaNGuard') ||
      text.includes('Vec3Guard')
    ) {
      console.log(`PAGE CONSOLE [${msg.type()}]:`, text);
    }
  });

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
  await page.evaluate(() => {
    const THREE = window.THREE;
    if (!THREE) return;
    const wrap = (Klass, name) => {
      if (!Klass?.prototype?.updateMatrixWorld) return;
      const orig = Klass.prototype.updateMatrixWorld;
      Klass.prototype.updateMatrixWorld = function (force) {
        try {
          return orig.call(this, force);
        } catch (err) {
          const mw = Array.from(this.matrixWorld?.elements ?? []);
          const up = this.up ? { x: this.up.x, y: this.up.y, z: this.up.z } : null;
          console.error(`[AudioWrap] ${name} error:`, err.message, {
            matrixWorldHasNaN: mw.some((v) => !Number.isFinite(v)),
            up,
            parent: this.parent?.type,
            parentMatrixHasNaN: this.parent?.matrixWorld
              ? Array.from(this.parent.matrixWorld.elements).some((v) => !Number.isFinite(v))
              : 'n/a',
          });
          throw err;
        }
      };
    };
    wrap(THREE.AudioListener, 'AudioListener');
    wrap(THREE.PositionalAudio, 'PositionalAudio');
  });
  await sleep(2000);

  const gl = await readCanvasPixel(page);
  report.webglVerified = !!gl?.version?.includes('WebGL');
  console.log(`WebGL: ${gl?.version} (${gl?.renderer})`);

  await page.keyboard.down('w');

  let elapsed = 0;
  let good = 0;
  for (const shot of SHOTS) {
    console.log(`\n[shot] ${shot.label}`);
    if (shot.segment != null) {
      await page.evaluate((seg) => window.__watershedScreenshot?.teleportToSegment(seg), shot.segment);
      await sleep(1000);
      const diag = await page.evaluate(() => {
        const dbg = window.__watershedPhysicsDebug;
        const cam = window.__r3f?.camera ?? window.__r3f_camera;
        const getCam = () => {
          const canvas = document.querySelector('canvas');
          // Try to reach R3F root state through known internals
          const fiber = canvas?.__r3f;
          return fiber?.camera;
        };
        const c = cam || getCam();
        return {
          segment: dbg?.currentSegmentIndex,
          pos: dbg?.position,
          vel: dbg?.linearVelocity,
          speed: dbg?.speed,
          gravity: window.__watershedGravity,
          flowSpeed: window.__watershedFlowSpeed,
          slipperiness: window.__watershedSlipperiness,
          camDiag: window.__watershedCameraDiag,
          audioWrap: window.__watershedAudioWrapInstalled,
        };
      });
      console.log('  diag after teleport:', JSON.stringify(diag));
      await sleep((shot.settleMs ?? 4000) - 1000);
    } else if (shot.waitMs > elapsed) {
      await sleep(shot.waitMs - elapsed);
      elapsed = shot.waitMs;
    }

    const shotTimeout = setTimeout(() => {
      console.error(`TIMEOUT waiting for shot ${shot.label}; pageErrors so far:`, pageErrors);
    }, 30000);
    const isGood = await capture(page, shot.label, report);
    clearTimeout(shotTimeout);
    if (isGood) good += 1;
  }

  await page.keyboard.up('w');
  await browser.close();

  report.pageErrors = [...new Set(pageErrors)].slice(0, 20);
  report.parityNotes.push(
    'Automated frame scoring is telemetry only under SwiftShader; headless first-person captures are typically sky-only.',
    'Use SwiftShader flags in headless CI; Vulkan ANGLE often fails without GPU.',
    'WebGPU default path may error under SwiftShader — force ?renderer=webgl.',
  );

  const reportPath = path.join(OUT_DIR, 'capture_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\nGood in-game frames: ${good}/${report.captures.length}`);
  console.log(`Page errors: ${report.pageErrors.length}`);
  console.log(`Report: ${reportPath}`);
  // F-1 is a known accepted limitation: headless first-person SwiftShader frames
  // are sky-only, so the visual gate is handled by manual/top-down captures.
  // The automated harness now fails only on runtime page errors or missing WebGL.
  if (report.pageErrors.length > 0 || !report.webglVerified) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
