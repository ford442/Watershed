#!/usr/bin/env node
/**
 * quality_drop_trace — frame-time trace and program links across a High → Medium
 * quality drop (#519 C / #534 acceptance: "no synchronous compile during a
 * High → Medium drop").
 *
 *   pnpm build && pnpm preview --host 127.0.0.1 --port 4173
 *   node verification/quality_drop_trace.mjs
 *
 * Boots a live (non-scripted) run, pins `high` through the screenshot harness's
 * `setQuality`, lets it settle, then writes `medium` — what the adaptive ladder
 * writes — and records for TRACE_SECONDS:
 *   - every `linkProgram` call (wrapped on WebGL2RenderingContext before load),
 *   - every rAF interval, so the frame that paid for any link is visible.
 * The page boots at High (persisted settings), so the menu's shader warm-up
 * covers High and the one step down (`warmupShadowModes`).
 * Headless SwiftShader: absolute frame times are not a GPU's; the counts and the
 * worst frame relative to the median are the comparison.
 *
 * Env: WATERSHED_URL (default http://127.0.0.1:4173), MENU_SECONDS (20), SETTLE_SECONDS (8),
 *      TRACE_SECONDS (6), TRACE_WIDTH × TRACE_HEIGHT (480 × 270), TRACE_JSON (write the raw trace to this path).
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const SETTLE_SECONDS = Number(process.env.SETTLE_SECONDS ?? 8);
const TRACE_SECONDS = Number(process.env.TRACE_SECONDS ?? 6);
const MENU_SECONDS = Number(process.env.MENU_SECONDS ?? 20);
// spawnProfile=1 turns the adaptive step-down off (LODManager): the only quality change is the trace's own.
const QUERY = 'map=meander&cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1&spawnProfile=1';
// Small enough that SwiftShader presents real frame intervals; program keys do not depend on size.
const VIEWPORT = { width: Number(process.env.TRACE_WIDTH ?? 480), height: Number(process.env.TRACE_HEIGHT ?? 270) };

const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
];

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const c of ['/opt/pw-browsers/chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  try {
    return puppeteer.executablePath();
  } catch {
    return undefined;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Installed before any page script: counts links, stamps frames. */
function instrument() {
  // Boot at High (the settings store's persisted preset), so the warm-up warms High's ladder.
  try {
    localStorage.setItem('watershed-settings', JSON.stringify({ state: { quality: 'high' }, version: 2 }));
  } catch {
    /* storage blocked: the boot preset is the default */
  }
  const trace = { links: [], names: [], frames: [], parallel: null };
  window.__qualityTrace = trace;
  const link = WebGL2RenderingContext.prototype.linkProgram;
  const describe = (gl, program) => {
    try {
      const fs = gl.getAttachedShaders(program).map((sh) => gl.getShaderSource(sh) || '').find((src) => /gl_FragColor|pc_fragColor|out highp vec4/.test(src)) ?? '';
      const name = /#define SHADER_NAME (\S+)/.exec(fs)?.[1] ?? '?';
      const shadow = /#define (SHADOWMAP_TYPE_\w+)/.exec(fs)?.[1] ?? (fs.includes('USE_SHADOWMAP') ? 'shadowmap' : 'no-shadow');
      return `${name}|${shadow}`;
    } catch {
      return '?';
    }
  };
  WebGL2RenderingContext.prototype.linkProgram = function (program) {
    trace.links.push(performance.now());
    trace.names.push(describe(this, program));
    if (trace.parallel === null) trace.parallel = !!this.getExtension('KHR_parallel_shader_compile');
    return link.call(this, program);
  };
  const tick = (t) => {
    trace.frames.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** "name|shadow" → count, most first. */
function tally(names) {
  const counts = {};
  for (const n of names) counts[n] = (counts[n] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function summarize(trace, from, to) {
  const links = trace.links.filter((t) => t >= from && t < to);
  const frames = trace.frames.filter((t) => t >= from && t < to);
  const dts = frames.slice(1).map((t, i) => t - frames[i]);
  const worst = dts.length ? Math.max(...dts) : 0;
  // A link "lands in" the interval that ends at the first frame after it.
  const linkFrames = new Set(links.map((l) => frames.findIndex((f) => f > l)).filter((i) => i > 0));
  const linkFrameDts = [...linkFrames].map((i) => frames[i] - frames[i - 1]);
  return {
    links: links.length,
    frames: dts.length,
    medianMs: +median(dts).toFixed(1),
    worstMs: +worst.toFixed(1),
    worstLinkFrameMs: linkFrameDts.length ? +Math.max(...linkFrameDts).toFixed(1) : null,
  };
}

const browser = await puppeteer.launch({
  headless: 'new',
  ignoreDefaultArgs: true,
  executablePath: resolveChromePath(),
  protocolTimeout: 180_000,
  args: CHROME_ARGS,
});
try {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));
  if (process.env.TRACE_CONSOLE) page.on('console', (m) => { if (m.text().includes(process.env.TRACE_CONSOLE)) console.log(m.text()); });
  await page.evaluateOnNewDocument(instrument);
  await page.goto(`${BASE_URL}/?${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.start-menu-start-btn');
      return !!btn && !btn.disabled;
    },
    { timeout: 120_000 },
  );
  // Let the menu's shader warm-up (ShaderWarmup.tsx) run, as a player reading the menu would.
  await sleep(MENU_SECONDS * 1000);
  const tStart = await page.evaluate(() => {
    document.querySelector('.start-menu-start-btn').click();
    return performance.now();
  });
  await page.waitForFunction(() => !!window.__watershedScreenshot?.setQuality, { timeout: 120_000 });
  await sleep(SETTLE_SECONDS * 1000);

  // A High window as long as the trace window: streaming content links at its own rate either way.
  const tHigh = await page.evaluate(() => performance.now());
  await sleep(TRACE_SECONDS * 1000);
  const tDrop = await page.evaluate(() => {
    window.__watershedScreenshot.setQuality('medium');
    return performance.now();
  });
  await sleep(TRACE_SECONDS * 1000);
  const tEnd = await page.evaluate(() => performance.now());
  const trace = await page.evaluate(() => window.__qualityTrace);


  const result = {
    steadyHigh: summarize(trace, tHigh, tDrop),
    afterDrop: summarize(trace, tDrop, tEnd),
    firstSecondAfterDrop: summarize(trace, tDrop, tDrop + 1000),
    linksBeforeStart: trace.links.filter((t) => t < tStart).length,
    firstThreeSecondsOfRun: summarize(trace, tStart, tStart + 3000),
    linksStartToDrop: trace.links.filter((t) => t >= tStart && t < tDrop).length,
    parallelShaderCompile: trace.parallel,
    // linkProgram returns at once on ANGLE; the link is paid at first use. One long
    // frame holding all of afterDrop's links is the synchronous compile.
    linkedOnDrop: tally(trace.names.filter((_, i) => trace.links[i] >= tDrop && trace.links[i] < tEnd)),
    pageErrors: [...new Set(pageErrors)].map((e) => `${e} ×${pageErrors.filter((x) => x === e).length}`),
  };
  if (process.env.TRACE_JSON) fs.writeFileSync(process.env.TRACE_JSON, JSON.stringify({ result, trace, tHigh, tDrop, tEnd }));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close().catch(() => {});
}
