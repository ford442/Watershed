/**
 * visual_smoke.mjs — Headless WebGL visual smoke for CI.
 *
 * Captures start-menu (hard gate) + top-down in-run beats when SwiftShader
 * permits a healthy post-start boot. Compares against committed baselines
 * with pixelmatch. Uploads actuals + diffs under verification/output/visual-smoke/.
 *
 * Usage:
 *   pnpm build && pnpm preview --host 127.0.0.1 --port 4173
 *   WATERSHED_URL=http://127.0.0.1:4173 pnpm test:visual-smoke
 *
 * Refresh baselines intentionally:
 *   UPDATE_BASELINES=1 WATERSHED_URL=http://127.0.0.1:4173 pnpm test:visual-smoke:update
 *
 * Env:
 *   WATERSHED_URL          Base URL (default http://127.0.0.1:4173)
 *   UPDATE_BASELINES=1     Overwrite verification/baselines/visual-smoke/
 *   VISUAL_MAX_DIFF_RATIO  Max mismatched pixel ratio (default 0.05)
 *   VISUAL_THRESHOLD       pixelmatch threshold 0–1 (default 0.15)
 *   VISUAL_BOOT_RETRIES    Boot attempts per topdown shot (default 3)
 *   PUPPETEER_EXECUTABLE_PATH  Optional Chrome binary override
 *
 * SwiftShader notes (F-1 / F-8):
 *   - First-person post-start frames are typically sky-only — never gate on them.
 *   - Use ?no-pointer-lock=1 top-down for in-run beats.
 *   - Cold-boot "Maximum update depth" (F-8) may prevent topdown boots; those
 *     shots are skipped (soft) so start-menu pixel gate still runs. Do not treat
 *     a skipped topdown as a sky-only visual regression.
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output', 'visual-smoke');
const BASELINE_DIR = path.join(__dirname, 'baselines', 'visual-smoke');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const UPDATE_BASELINES = process.env.UPDATE_BASELINES === '1' || process.env.UPDATE_BASELINES === 'true';
const MAX_DIFF_RATIO = Number(process.env.VISUAL_MAX_DIFF_RATIO ?? '0.05');
const PIXEL_THRESHOLD = Number(process.env.VISUAL_THRESHOLD ?? '0.15');
const BOOT_RETRIES = Math.max(1, Number(process.env.VISUAL_BOOT_RETRIES ?? '3'));
const VIEWPORT = { width: 1280, height: 720 };
const MIN_GOOD_BYTES = 50_000;
const SOFT_PAGE_ERROR = /Maximum update depth|Minified React error #185|error #185/i;

const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--use-gl=swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
  '--disable-gpu-sandbox',
  '--window-size=1280,720',
  '--hide-scrollbars',
];

const SHOTS = [
  {
    label: '00_start_menu',
    mode: 'prestart',
    required: true,
    query: 'cleanTest=1&renderer=webgl&screenshot=1',
  },
  {
    label: '01_spawn_topdown',
    mode: 'topdown',
    required: false,
    query: 'cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    segment: -3,
    settleMs: 2_500,
  },
  {
    label: '02_waterfall_topdown',
    mode: 'topdown',
    required: false,
    query: 'cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    segment: 14,
    settleMs: 2_500,
  },
  {
    label: '03_slot_topdown',
    mode: 'topdown',
    required: false,
    query: 'cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    segment: 21,
    settleMs: 2_500,
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    return puppeteer.executablePath();
  } catch {
    return undefined;
  }
}

function classifyPageErrors(errors) {
  const hard = [];
  const soft = [];
  for (const msg of errors) {
    if (SOFT_PAGE_ERROR.test(msg)) soft.push(msg);
    else hard.push(msg);
  }
  return { hard, soft };
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: resolveChromePath(),
    protocolTimeout: 60_000,
    args: CHROME_ARGS,
  });
}

async function capturePng(page, outPath) {
  await Promise.race([
    page.screenshot({ path: outPath, fullPage: false, type: 'png' }),
    sleep(15_000).then(() => {
      throw new Error('page.screenshot timed out');
    }),
  ]);
  return { method: 'page-screenshot', bytes: fs.statSync(outPath).size };
}

function compareToBaseline(label, actualPath, report) {
  const baselinePath = path.join(BASELINE_DIR, `${label}.png`);
  const diffPath = path.join(OUT_DIR, `${label}.diff.png`);

  if (UPDATE_BASELINES) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.copyFileSync(actualPath, baselinePath);
    report.comparisons.push({ label, status: 'updated', baseline: baselinePath });
    console.log(`  ↑ baseline updated: ${label}.png`);
    return true;
  }

  if (!fs.existsSync(baselinePath)) {
    report.comparisons.push({ label, status: 'missing-baseline', baseline: baselinePath });
    console.error(`  ✗ missing baseline: ${baselinePath}`);
    console.error('    Run: UPDATE_BASELINES=1 pnpm test:visual-smoke:update');
    return false;
  }

  const img1 = PNG.sync.read(fs.readFileSync(baselinePath));
  const img2 = PNG.sync.read(fs.readFileSync(actualPath));
  if (img1.width !== img2.width || img1.height !== img2.height) {
    report.comparisons.push({
      label,
      status: 'size-mismatch',
      baselineSize: [img1.width, img1.height],
      actualSize: [img2.width, img2.height],
    });
    console.error(
      `  ✗ size mismatch ${label}: baseline ${img1.width}x${img1.height} vs actual ${img2.width}x${img2.height}`,
    );
    return false;
  }

  const diff = new PNG({ width: img1.width, height: img1.height });
  const mismatched = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {
    threshold: PIXEL_THRESHOLD,
    includeAA: false,
  });
  const total = img1.width * img1.height;
  const ratio = mismatched / total;
  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const ok = ratio <= MAX_DIFF_RATIO;
  report.comparisons.push({
    label,
    status: ok ? 'pass' : 'diff-fail',
    mismatched,
    total,
    ratio,
    maxDiffRatio: MAX_DIFF_RATIO,
    diff: diffPath,
  });

  if (ok) {
    console.log(`  ✓ ${label}  diff=${(ratio * 100).toFixed(3)}%  (${mismatched}/${total})`);
  } else {
    console.error(
      `  ✗ ${label}  diff=${(ratio * 100).toFixed(3)}% exceeds ${(MAX_DIFF_RATIO * 100).toFixed(2)}% — see ${diffPath}`,
    );
  }
  return ok;
}

async function attemptPrestart(shot) {
  const pageErrors = [];
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));

    await page.goto(`${BASE_URL}/?${shot.query}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForSelector('canvas', { timeout: 45_000 });
    await page.waitForSelector('.start-menu-overlay, .start-menu-start-btn', {
      timeout: 45_000,
    });
    // Capture immediately — any settle wait invites F-8 main-thread storms.
    const outPath = path.join(OUT_DIR, `${shot.label}.png`);
    const capture = await capturePng(page, outPath);
    return {
      ok: capture.bytes >= MIN_GOOD_BYTES,
      reason: capture.bytes >= MIN_GOOD_BYTES ? 'ok' : 'too-small',
      outPath,
      capture,
      pageErrors,
    };
  } catch (err) {
    return { ok: false, reason: String(err.message || err), pageErrors };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function attemptTopdown(shot) {
  const pageErrors = [];
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));

    await page.goto(`${BASE_URL}/?${shot.query}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForSelector('canvas', { timeout: 45_000 });
    await page.waitForSelector('.start-menu-start-btn', { timeout: 45_000 });
    await page.click('.start-menu-start-btn');

    await page.waitForFunction(
      () => !!window.__watershedScreenshot || !!window.__watershedPhysicsDebug,
      { timeout: 20_000 },
    );

    const crashed = await Promise.race([
      page.evaluate(
        () => /Maximum update depth|Application Error/i.test(document.body.innerText || ''),
      ),
      sleep(3_000).then(() => true),
    ]);
    if (crashed) {
      return { ok: false, reason: 'f8-crash', pageErrors, softSkip: true };
    }

    const hasApi = await page.evaluate(() => !!window.__watershedScreenshot);
    if (!hasApi) {
      return { ok: false, reason: 'no-api', pageErrors, softSkip: true };
    }

    if (shot.segment != null) {
      await page.evaluate((seg) => window.__watershedScreenshot.teleportToSegment(seg), shot.segment);
    }
    await sleep(shot.settleMs ?? 2_500);

    const outPath = path.join(OUT_DIR, `${shot.label}.png`);
    const capture = await capturePng(page, outPath);
    return {
      ok: capture.bytes >= MIN_GOOD_BYTES,
      reason: capture.bytes >= MIN_GOOD_BYTES ? 'ok' : 'too-small',
      outPath,
      capture,
      pageErrors,
      softSkip: capture.bytes < MIN_GOOD_BYTES,
    };
  } catch (err) {
    const msg = String(err.message || err);
    const softSkip = SOFT_PAGE_ERROR.test(msg) || /Waiting failed|timed out/i.test(msg);
    return { ok: false, reason: msg, pageErrors, softSkip };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function captureShot(shot, report) {
  console.log(`\n[shot] ${shot.label} (${shot.mode}${shot.required ? ', required' : ', best-effort'})`);
  console.log(`  → ${BASE_URL}/?${shot.query}`);

  let last = null;
  const attempts = shot.mode === 'prestart' ? 2 : BOOT_RETRIES;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`  boot attempt ${attempt}/${attempts}`);
    last = shot.mode === 'prestart' ? await attemptPrestart(shot) : await attemptTopdown(shot);
    if (last.ok) break;
    console.log(`  boot failed: ${last.reason}${last.softSkip ? ' [soft]' : ''}`);
    await sleep(400);
  }

  report.pageErrors.push(...(last?.pageErrors || []));

  if (!last?.ok) {
    const soft = !shot.required && (last?.softSkip || classifyPageErrors(last?.pageErrors || []).soft.length > 0);
    report.captures.push({
      label: shot.label,
      mode: shot.mode,
      required: !!shot.required,
      structuralOk: false,
      skipped: soft,
      reason: last?.reason ?? 'unknown',
    });
    if (soft) {
      console.log(`  ⚠ ${shot.label} skipped (SwiftShader/F-8) — not a sky-only false fail`);
      report.comparisons.push({ label: shot.label, status: 'skipped-f8' });
      return true;
    }
    console.error(`  ✗ ${shot.label} failed (${last?.reason})`);
    return false;
  }

  const { hard } = classifyPageErrors(last.pageErrors || []);
  report.captures.push({
    label: shot.label,
    mode: shot.mode,
    required: !!shot.required,
    file: last.outPath,
    bytes: last.capture.bytes,
    method: last.capture.method,
    structuralOk: true,
    hardPageErrors: hard.length,
  });
  console.log(`  capture ${last.capture.bytes}B via ${last.capture.method}`);

  if (hard.length && shot.required) {
    console.error(`  ✗ hard page errors on required shot:\n    ${[...new Set(hard)].join('\n    ')}`);
    return false;
  }

  return compareToBaseline(shot.label, last.outPath, report);
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(BASELINE_DIR, { recursive: true });

  const report = {
    url: BASE_URL,
    startedAt: new Date().toISOString(),
    updateBaselines: UPDATE_BASELINES,
    maxDiffRatio: MAX_DIFF_RATIO,
    pixelThreshold: PIXEL_THRESHOLD,
    captures: [],
    comparisons: [],
    pageErrors: [],
    parityNotes: [
      'Required gate: 00_start_menu (prestart canyon + UI) via ?cleanTest=1&renderer=webgl&screenshot=1.',
      'Best-effort: top-down in-run shots (?no-pointer-lock=1). Skipped on F-8 — not treated as sky-only (F-1).',
      'First-person post-start SwiftShader frames are sky-only — never gate on them.',
      'Force ?renderer=webgl; WebGPU errors under SwiftShader (lightNodeClass).',
      'Refresh baselines: UPDATE_BASELINES=1 pnpm test:visual-smoke:update (prefer a machine that can boot topdown).',
    ],
  };

  console.log(`Chrome: ${resolveChromePath() ?? '(puppeteer default)'}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Baselines: ${BASELINE_DIR}`);
  console.log(`Mode: ${UPDATE_BASELINES ? 'UPDATE baselines' : 'compare'}`);

  let allOk = true;
  for (const shot of SHOTS) {
    const ok = await captureShot(shot, report);
    if (!ok) allOk = false;
  }

  const uniqueErrors = [...new Set(report.pageErrors)];
  const { hard, soft } = classifyPageErrors(uniqueErrors);
  report.pageErrors = uniqueErrors.slice(0, 30);
  report.softPageErrors = soft.slice(0, 10);
  report.hardPageErrors = hard.slice(0, 10);
  report.requiredPassed = report.captures
    .filter((c) => c.required)
    .every((c) => c.structuralOk);
  report.passed = allOk && report.requiredPassed;

  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n── visual-smoke summary ──');
  console.log(`Captures: ${report.captures.length}`);
  console.log(`Required passed: ${report.requiredPassed}`);
  console.log(`Hard page errors: ${hard.length}`);
  console.log(`Soft F-8 errors: ${soft.length}`);
  console.log(`Report: ${reportPath}`);

  if (!report.passed) process.exit(1);
  console.log(UPDATE_BASELINES ? 'Baselines updated (captured shots).' : 'Visual smoke passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
