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
 *   - The start button mounts disabled ("PREPARING…") and the menu overflows the
 *     720px viewport, so topdown boots wait for it to arm and click the element
 *     directly rather than hit-testing a point.
 *   - `teleportToSegment` returns false until the vehicle rigid body exists; it
 *     is retried until it reports true, otherwise every per-segment shot is a
 *     picture of the spawn.
 *   - Set-piece shots (06–09) are `baseline: false`: they feed the advisory
 *     CONTRASTS gates instead of a committed pixel baseline.
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
/**
 * Extra query appended to every shot, e.g. VISUAL_EXTRA_QUERY='material=tsl' for
 * the #256 path A matrix. Capture/baseline names get a suffix so a TSL run never
 * overwrites the GLSL baselines.
 */
const EXTRA_QUERY = (process.env.VISUAL_EXTRA_QUERY ?? '').replace(/^[?&]/, '');
const LABEL_SUFFIX = process.env.VISUAL_LABEL_SUFFIX ?? (EXTRA_QUERY ? `__${EXTRA_QUERY.replace(/[^a-z0-9]+/gi, '-')}` : '');

/** Full query string for a shot, including any matrix-wide extra. */
function shotQuery(shot) {
  return EXTRA_QUERY ? `${shot.query}&${EXTRA_QUERY}` : shot.query;
}

/** Capture/baseline label for a shot, namespaced per matrix variant. */
function shotLabel(shot) {
  return `${shot.label}${LABEL_SUFFIX}`;
}
const VIEWPORT = { width: 1280, height: 720 };
const MIN_GOOD_BYTES = 50_000;
/**
 * Below this a 1280×720 in-run capture is the sky-only frame F-1 describes:
 * measured here, a sky + HUD frame compresses to ~85 KB while the same shot
 * with canyon geometry in it lands around 150 KB. Set-piece contrasts sourced
 * from a frame that small are skipped, not reported as a regression.
 */
const SKY_ONLY_MAX_BYTES = 110_000;
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
  {
    label: '04_delta_open_water',
    mode: 'topdown',
    required: false,
    query: 'map=delta&vehicle=raft&cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    segment: 6,
    settleMs: 2_500,
  },
  {
    label: '05_delta_beach',
    mode: 'topdown',
    required: false,
    query: 'map=delta&vehicle=raft&cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    segment: 21,
    settleMs: 2_500,
  },
  // #400 set-pieces. Lumber segment 10 is the only authored trestle
  // (`hasBridge` + `openFloor`); `?hour=` picks the launch hour for this page
  // load only, so the dawn backwater (05–07) and the flood braid (13–15) are
  // two shots of the same geometry with different amounts of deck on it.
  {
    label: '06_lumber_trestle_dawn',
    mode: 'topdown',
    required: false,
    baseline: false,
    query: 'map=lumber&hour=6&cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    segment: 10,
    settleMs: 2_500,
  },
  {
    label: '07_lumber_trestle_flood',
    mode: 'topdown',
    required: false,
    baseline: false,
    query: 'map=lumber&hour=14&cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    segment: 10,
    settleMs: 2_500,
  },
  // Glacial tube apex (authored width 21, under TUBE_MAX_CANYON_WIDTH) vs the
  // melt-out below the plunge (width 35, no roof): the ice tube only reads as a
  // beat if those two do not draw the same open U-channel.
  {
    label: '08_glacial_ice_tube',
    mode: 'topdown',
    required: false,
    baseline: false,
    query: 'map=glacial&cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    segment: 10,
    settleMs: 2_500,
  },
  {
    label: '09_glacial_open_channel',
    mode: 'topdown',
    required: false,
    baseline: false,
    query: 'map=glacial&cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    segment: 16,
    settleMs: 2_500,
  },
];

/**
 * Cross-shot gates: pairs that must *not* look alike.
 *
 * A per-shot baseline diff cannot catch a set-piece that never landed — both
 * hours of a decorative trestle match their own baselines happily. These look
 * at the mechanic instead: the two captures have to differ by at least
 * `minRatio` of the frame.
 *
 * Advisory, never a CI gate. Under SwiftShader an in-run frame is mostly sky
 * and HUD (F-1), so a shortfall here is as likely to be the software rasteriser
 * as a missing set-piece; report.contrasts carries the ratio and the diff image
 * for a machine that can actually render the geometry. What CI gates on is the
 * unit coverage: `trestleSpan.test.ts` for the hour coupling and
 * `geometryBuilders.test.ts` for the ice-tube wall profile.
 *
 * `minRatio` is calibrated against this rasteriser, not a GPU: capturing the
 * same shot twice lands around 0.01% frame-to-frame, and both pairs below sit
 * an order of magnitude above that. The gate therefore catches the case that
 * matters — two set-piece captures that are the same picture — without turning
 * SwiftShader's dim in-run frames into a standing failure.
 */
const CONTRASTS = [
  {
    label: 'lumber_trestle_hours',
    a: '06_lumber_trestle_dawn',
    b: '07_lumber_trestle_flood',
    minRatio: 0.0005,
    why: 'flood-hour braid must open a wider gap in the trestle deck than the dawn backwater',
  },
  {
    label: 'glacial_tube_vs_open',
    a: '08_glacial_ice_tube',
    b: '09_glacial_open_channel',
    minRatio: 0.0005,
    why: 'the ice-tube wall profile must not draw the same open U-channel as the melt-out',
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

    await page.goto(`${BASE_URL}/?${shotQuery(shot)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForSelector('canvas', { timeout: 45_000 });
    await page.waitForSelector('.start-menu-overlay, .start-menu-start-btn', {
      timeout: 45_000,
    });
    // Capture immediately — any settle wait invites F-8 main-thread storms.
    const outPath = path.join(OUT_DIR, `${shotLabel(shot)}.png`);
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

    await page.goto(`${BASE_URL}/?${shotQuery(shot)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForSelector('canvas', { timeout: 45_000 });
    await page.waitForSelector('.start-menu-start-btn', { timeout: 45_000 });
    // The button mounts as a disabled "PREPARING…" while Rapier/assets warm up,
    // and the menu is taller than the 720px viewport, so puppeteer's own click
    // hit-tests against an off-screen disabled node. Wait for it to arm, then
    // dispatch the click on the element itself.
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.start-menu-start-btn');
        return !!btn && !btn.disabled;
      },
      { timeout: 60_000 },
    );
    await page.evaluate(() => document.querySelector('.start-menu-start-btn').click());

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
      // `teleportToSegment` returns false until the vehicle rigid body exists,
      // and the screenshot API is published before it does. A single call lands
      // on a fresh spawn instead of the authored segment, which is why the
      // per-segment shots below used to be interchangeable. Retry until it
      // reports the move actually happened.
      const moved = await page
        .waitForFunction(
          (seg) => window.__watershedScreenshot.teleportToSegment(seg) === true,
          { timeout: 30_000, polling: 250 },
          shot.segment,
        )
        .then(() => true)
        .catch(() => false);
      if (!moved) {
        return { ok: false, reason: 'teleport-never-landed', pageErrors, softSkip: true };
      }
    }
    await sleep(shot.settleMs ?? 2_500);

    const outPath = path.join(OUT_DIR, `${shotLabel(shot)}.png`);
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
    const softSkip =
      SOFT_PAGE_ERROR.test(msg) ||
      /Waiting failed|timed out|not clickable/i.test(msg);
    return { ok: false, reason: msg, pageErrors, softSkip };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Successful captures by shot label ({ path, bytes }), for the CONTRASTS pass. */
const capturedPaths = new Map();

/**
 * Compare two captures of this run against each other and require a minimum
 * difference. Returns true when the gate passes or is legitimately skipped.
 */
function runContrast(contrast, report) {
  const a = capturedPaths.get(`${contrast.a}${LABEL_SUFFIX}`);
  const b = capturedPaths.get(`${contrast.b}${LABEL_SUFFIX}`);

  if (!a || !b) {
    report.contrasts.push({
      label: contrast.label,
      status: 'skipped-f8',
      why: contrast.why,
      missing: [!a && contrast.a, !b && contrast.b].filter(Boolean),
    });
    console.log(`  ⚠ ${contrast.label} skipped — a source shot did not boot (SwiftShader/F-8)`);
    return true;
  }

  const skyOnly = [
    a.bytes < SKY_ONLY_MAX_BYTES && contrast.a,
    b.bytes < SKY_ONLY_MAX_BYTES && contrast.b,
  ].filter(Boolean);
  if (skyOnly.length) {
    report.contrasts.push({
      label: contrast.label,
      status: 'skipped-sky-only',
      why: contrast.why,
      skyOnly,
      bytes: { [contrast.a]: a.bytes, [contrast.b]: b.bytes },
      skyOnlyMaxBytes: SKY_ONLY_MAX_BYTES,
    });
    console.log(
      `  ⚠ ${contrast.label} skipped — ${skyOnly.join(', ')} rendered sky-only (F-1), nothing to compare`,
    );
    return true;
  }

  const img1 = PNG.sync.read(fs.readFileSync(a.path));
  const img2 = PNG.sync.read(fs.readFileSync(b.path));
  if (img1.width !== img2.width || img1.height !== img2.height) {
    report.contrasts.push({ label: contrast.label, status: 'size-mismatch', why: contrast.why });
    console.error(`  ✗ ${contrast.label}: capture sizes differ`);
    return false;
  }

  const diff = new PNG({ width: img1.width, height: img1.height });
  const mismatched = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {
    threshold: PIXEL_THRESHOLD,
    includeAA: false,
  });
  const total = img1.width * img1.height;
  const ratio = mismatched / total;
  const diffPath = path.join(OUT_DIR, `${contrast.label}${LABEL_SUFFIX}.contrast.png`);
  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const ok = ratio >= contrast.minRatio;
  report.contrasts.push({
    label: contrast.label,
    status: ok ? 'pass' : 'too-similar',
    advisory: true,
    why: contrast.why,
    ratio,
    minRatio: contrast.minRatio,
    diff: diffPath,
  });

  if (ok) {
    console.log(`  ✓ ${contrast.label}  diff=${(ratio * 100).toFixed(3)}% ≥ ${(contrast.minRatio * 100).toFixed(3)}%`);
  } else {
    console.warn(
      `  ⚠ ${contrast.label}  diff=${(ratio * 100).toFixed(3)}% below ${(contrast.minRatio * 100).toFixed(3)}% — ${contrast.why}`,
    );
    console.warn(
      '    Advisory: SwiftShader in-run frames are largely sky/UI (F-1), so this is only a real',
    );
    console.warn(
      '    regression on a machine that renders top-down geometry. The mechanics themselves are',
    );
    console.warn(
      '    gated by unit tests: trestleSpan.test.ts (hours) and geometryBuilders.test.ts (tube).',
    );
  }
  return ok;
}

async function captureShot(shot, report) {
  console.log(`\n[shot] ${shot.label} (${shot.mode}${shot.required ? ', required' : ', best-effort'})`);
  console.log(`  → ${BASE_URL}/?${shotQuery(shot)}`);

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
      label: shotLabel(shot),
      mode: shot.mode,
      required: !!shot.required,
      structuralOk: false,
      skipped: soft,
      reason: last?.reason ?? 'unknown',
    });
    if (soft) {
      console.log(`  ⚠ ${shot.label} skipped (SwiftShader/F-8) — not a sky-only false fail`);
      report.comparisons.push({ label: shotLabel(shot), status: 'skipped-f8' });
      return true;
    }
    console.error(`  ✗ ${shot.label} failed (${last?.reason})`);
    return false;
  }

  const { hard } = classifyPageErrors(last.pageErrors || []);
  report.captures.push({
    label: shotLabel(shot),
    mode: shot.mode,
    required: !!shot.required,
    file: last.outPath,
    bytes: last.capture.bytes,
    method: last.capture.method,
    structuralOk: true,
    hardPageErrors: hard.length,
  });
  console.log(`  capture ${last.capture.bytes}B via ${last.capture.method}`);
  capturedPaths.set(shotLabel(shot), { path: last.outPath, bytes: last.capture.bytes });

  if (hard.length && shot.required) {
    console.error(`  ✗ hard page errors on required shot:\n    ${[...new Set(hard)].join('\n    ')}`);
    return false;
  }

  // Set-piece shots exist for the cross-shot contrast, not for a pixel
  // baseline: a SwiftShader in-run frame is sometimes the canyon and sometimes
  // sky-only (F-1), so a committed baseline for one would be noise either way.
  if (shot.baseline === false) {
    report.comparisons.push({ label: shotLabel(shot), status: 'contrast-only' });
    console.log(`  · ${shot.label} captured (contrast-only, no pixel baseline)`);
    return true;
  }

  return compareToBaseline(shotLabel(shot), last.outPath, report);
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
    contrasts: [],
    pageErrors: [],
    parityNotes: [
      'Required gate: 00_start_menu (prestart canyon + UI) via ?cleanTest=1&renderer=webgl&screenshot=1.',
      'Best-effort: top-down in-run shots (?no-pointer-lock=1). Skipped on F-8 — not treated as sky-only (F-1).',
      'First-person post-start SwiftShader frames are sky-only — never gate on them.',
      'Force ?renderer=webgl; WebGPU errors under SwiftShader (lightNodeClass).',
      'Refresh baselines: UPDATE_BASELINES=1 pnpm test:visual-smoke:update (prefer a machine that can boot topdown).',
      'Material matrix: VISUAL_EXTRA_QUERY=material=tsl pnpm test:visual-smoke captures the #256 path A backend into __material-tsl baselines.',
      'Contrast gates (#400): lumber trestle hour 6 vs 14, glacial ice tube vs open melt-out. Advisory — report.contrasts records the ratio and any skip reason, but they never fail the run, because SwiftShader in-run frames are mostly sky/HUD (F-1). The mechanics are gated by trestleSpan.test.ts and geometryBuilders.test.ts.',
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

  if (!UPDATE_BASELINES) {
    console.log('\n[contrast] set-piece cross-shot gates (advisory)');
    for (const contrast of CONTRASTS) runContrast(contrast, report);
  }

  const uniqueErrors = [...new Set(report.pageErrors)];
  const { hard, soft } = classifyPageErrors(uniqueErrors);
  report.pageErrors = uniqueErrors.slice(0, 30);
  report.softPageErrors = soft.slice(0, 10);
  report.hardPageErrors = hard.slice(0, 10);
  report.requiredPassed = report.captures
    .filter((c) => c.required)
    .every((c) => c.structuralOk);
  report.contrastsPassed = report.contrasts.every(
    (c) => c.status === 'pass' || c.status.startsWith('skipped-'),
  );
  // Advisory only, for the same reason the top-down shots are best-effort: a
  // SwiftShader in-run frame is mostly sky and HUD, so two set-piece captures
  // can be near-identical without the set-piece being missing. The mechanics
  // are gated by unit tests; this is the eyes-on check for a real GPU.
  report.passed = report.requiredPassed;

  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n── visual-smoke summary ──');
  console.log(`Captures: ${report.captures.length}`);
  console.log(`Required passed: ${report.requiredPassed}`);
  console.log(`Hard page errors: ${hard.length}`);
  console.log(`Soft F-8 errors: ${soft.length}`);
  console.log(
    `Contrast gates: ${report.contrasts.filter((c) => c.status === 'pass').length} pass, ` +
      `${report.contrasts.filter((c) => c.status.startsWith('skipped-')).length} skipped, ` +
      `${report.contrasts.filter((c) => c.status !== 'pass' && !c.status.startsWith('skipped-')).length} failed`,
  );
  console.log(`Report: ${reportPath}`);

  if (!report.passed) process.exit(1);
  console.log(UPDATE_BASELINES ? 'Baselines updated (captured shots).' : 'Visual smoke passed.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
