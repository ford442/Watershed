/**
 * shader_warmup_report.mjs — the boot shader warm-up, measured on both material
 * backends (#555 Phase A.3).
 *
 * For each backend (`?material=glsl`: WebGLRenderer; `?material=tsl`: the node
 * renderer, WebGL2 on the wire) this boots the scripted meander run with
 * `?warmup=1` — scripted pages skip the warm-up otherwise — waits at the menu
 * for the warm-up to land (the compile, and on GLSL the warm frame), clicks
 * Start, steps 3 s of sim time at the fixed 1/60 s, and reads the
 * `shaderWarmup` debug tap (`src/experience/ShaderWarmup.tsx`):
 *
 *   warm      objects / programs the warm-up compiled, and how long it took
 *   warmFrame programs the GLSL warm frame added (post chain, shadow depth, sky)
 *   firstRun  programs the first 3 s after Start still had to compile — the
 *             number the warm-up exists to drive down
 *
 * Program counts are per backend (`src/rendering/programCount.ts`): linked
 * programs on GLSL, pipelines on the node renderer (one linked program each on
 * WebGL2). Frames are drawn every STEP_BATCH sim frames, so an object that is
 * only in view between two drawn frames is not counted; the batch is the same
 * for both backends.
 *
 * Gate: each backend must report `warm` and `firstRun` (the harness fails if
 * either is not measured). The numbers themselves are a report, printed and
 * written to verification/output/shader-warmup/report.json.
 *
 * Usage:
 *   pnpm build && pnpm preview --host 127.0.0.1 --port 4173
 *   WATERSHED_URL=http://127.0.0.1:4173 pnpm test:warmup-report
 *
 * Env:
 *   WATERSHED_URL              Base URL (default http://127.0.0.1:4173)
 *   WARMUP_BACKENDS            Comma list (default glsl,tsl)
 *   WARMUP_STEP_BATCH          Sim frames per drawn frame (default 6)
 *   PUPPETEER_EXECUTABLE_PATH  Optional Chrome binary override
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'output', 'shader-warmup');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SCRIPT_PATH = '/verification/fixtures/input/meander_run.json';
const BACKENDS = (process.env.WARMUP_BACKENDS ?? 'glsl,tsl').split(',').map((b) => b.trim()).filter(Boolean);
const STEP_BATCH = Math.max(1, Number(process.env.WARMUP_STEP_BATCH ?? '6'));
/** Sim frames stepped before giving up on the 3 s window (it closes at 180). */
const MAX_FRAMES = 240;

// SwiftShader is no longer an automatic fallback: ask for it explicitly.
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

/** Serve /verification/fixtures/** from disk; everything else goes to the preview server. */
async function serveFixtures(page) {
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
}

/** Poll `fn` in the page until it returns truthy; a plain loop (SwiftShader frames starve waitForFunction). */
async function until(page, fn, timeoutMs, what, arg) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

async function measure(backend) {
  const query = `map=meander&cleanTest=1&renderer=webgl&screenshot=1&warmup=1&material=${backend}&input=script:${SCRIPT_PATH}`;
  const pageErrors = [];
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: resolveChromePath(),
    protocolTimeout: 180_000,
    args: CHROME_ARGS,
  });
  const wallStart = Date.now();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') pageErrors.push(`console: ${text}`);
      if (text.startsWith('[ShaderWarmup]')) console.log(`  ${text}`);
    });
    await serveFixtures(page);

    console.log(`\n[${backend}] ${BASE_URL}/?${query}`);
    await page.goto(`${BASE_URL}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.start-menu-start-btn', { timeout: 60_000 });
    await until(
      page,
      () => {
        const btn = document.querySelector('.start-menu-start-btn');
        return !!btn && !btn.disabled;
      },
      120_000,
      'the start button to arm',
    );
    // The warm-up runs at the menu; Start before it lands would measure a cold run.
    // GLSL also draws its warm frame (immediately, under frameloop="never").
    const tap = await until(
      page,
      () => {
        const t = window.__watershed?.shaderWarmup;
        if (!t?.warm) return null;
        if (t.backend === 'glsl' && t.warmFrame === null) return null;
        return JSON.parse(JSON.stringify(t));
      },
      180_000,
      'the warm-up to land',
    );
    if (tap.backend !== backend) throw new Error(`asked for ?material=${backend}, the page built ${tap.backend}`);
    const warmMs = Date.now() - wallStart;

    await page.evaluate(() => document.querySelector('.start-menu-start-btn').click());
    await until(page, () => !!window.__watershedScreenshot?.stepScripted, 60_000, 'the screenshot API');
    await until(page, () => window.__watershedScreenshot.isScriptedReady(), 120_000, 'the scripted run to go live');

    let frames = 0;
    let firstRun = null;
    while (frames < MAX_FRAMES) {
      const stepped = await page.evaluate((n) => window.__watershedScreenshot.stepScripted(n), STEP_BATCH);
      if (stepped !== STEP_BATCH) throw new Error(`stepScripted advanced ${stepped}/${STEP_BATCH} frames`);
      frames += stepped;
      firstRun = await page.evaluate(() => window.__watershed?.shaderWarmup?.firstRun ?? null);
      if (firstRun !== null) break;
    }
    if (firstRun === null) throw new Error(`the first-3-s window never closed in ${frames} sim frames`);
    const final = await page.evaluate(() => JSON.parse(JSON.stringify(window.__watershed.shaderWarmup)));
    return {
      ok: true,
      backend,
      warm: final.warm,
      warmFrame: final.warmFrame,
      firstRun: final.firstRun,
      simFrames: frames,
      warmWallMs: warmMs,
      totalWallMs: Date.now() - wallStart,
      pageErrors,
    };
  } catch (err) {
    return { ok: false, backend, reason: String(err?.message || err), pageErrors };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  console.log(`[warmup-report] backends=${BACKENDS.join(',')} batch=${STEP_BATCH} sim frames per drawn frame`);
  const results = [];
  for (const backend of BACKENDS) results.push(await measure(backend));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify({ stepBatch: STEP_BATCH, results }, null, 2));

  console.log('\n── shader warm-up per backend ──');
  console.log('backend  warm objects  warm programs  warm ms  warm frame  first 3 s');
  for (const r of results) {
    if (!r.ok) {
      console.log(`${r.backend.padEnd(8)} ✗ ${r.reason}`);
      for (const e of r.pageErrors.slice(0, 10)) console.log(`         page: ${e}`);
      continue;
    }
    const n = (v) => (v === null || v === undefined ? '—' : String(v));
    console.log(
      `${r.backend.padEnd(8)} ${n(r.warm.objects).padStart(12)}  ${n(r.warm.programs).padStart(13)}  ` +
        `${String(Math.round(r.warm.ms)).padStart(7)}  ${n(r.warmFrame).padStart(10)}  ${n(r.firstRun).padStart(9)}` +
        (r.warm.failed.length ? `   (recipes skipped: ${r.warm.failed.join(', ')})` : ''),
    );
  }
  console.log(`Report: ${path.join(OUT_DIR, 'report.json')}`);

  const failed = results.filter((r) => !r.ok || r.firstRun === null || r.warm?.programs === null);
  if (failed.length > 0) {
    console.error(`[warmup-report] ✗ not measured on: ${failed.map((r) => r.backend).join(', ')}`);
    process.exit(1);
  }
  console.log('[warmup-report] ✓ measured on every backend');
}

main().catch((err) => {
  console.error('[warmup-report] fatal:', err);
  process.exit(1);
});
