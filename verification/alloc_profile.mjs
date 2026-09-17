/**
 * alloc_profile.mjs — headless capture of per-frame JS allocation, GC pause and
 * frame-time distribution, for the Phase 0 baseline of the per-frame-allocation
 * issue.
 *
 * What it measures, and what it does not:
 *   - Bytes allocated per frame: CDP `HeapProfiler` sampling profiler over a
 *     fixed window, divided by the rAF count in the same window. This is the
 *     number the issue actually asks for and it is renderer-independent —
 *     allocation happens on the JS side whether the GPU is real or SwiftShader.
 *     Sampling (not exhaustive) allocation accounting, so treat it as
 *     "order of magnitude + per-function ranking", not an exact byte count.
 *   - GC pause max/mean: from the v8 trace (`MajorGC` / `MinorGC` complete
 *     events). Also renderer-independent.
 *   - Frame time p50/p95/max and heap size: collected, but under headless
 *     SwiftShader the frame rate is dominated by software rasterisation, so
 *     frame-time numbers here are NOT a proxy for the 60 FPS target on real
 *     hardware. They are reported for the record and for before/after deltas
 *     under an identical harness, nothing more.
 *   - Physics step duration: `window.__watershedPhysicsPerf`, same source as
 *     verification/physics_profile.mjs.
 *
 * Same teleport caveat as physics_profile.mjs: `teleportToSegment` repositions
 * the vehicle, it does not force the ChunkManager treadmill to that index, so
 * the "waterfall" case measures the waterfall vehicle/water state over the
 * active segment window near map start.
 *
 * Usage:
 *   npm start (or pnpm preview) in one terminal
 *   WATERSHED_URL=http://127.0.0.1:3000 node verification/alloc_profile.mjs
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output', 'alloc-profile');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const SAMPLE_MS = Number(process.env.ALLOC_SAMPLE_MS ?? 20_000);
const SETTLE_MS = Number(process.env.ALLOC_SETTLE_MS ?? 8_000);
const VERBOSE = process.env.VERBOSE === '1';

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
  '--js-flags=--expose-gc',
];

const CASES = [
  {
    label: 'ordinary_biome_segment_2',
    query: 'cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    teleport: 2,
  },
  {
    label: 'waterfall_segment_14',
    query: 'cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1',
    teleport: 14,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/pw-browsers/chromium',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    return puppeteer.executablePath();
  } catch {
    return undefined;
  }
}

/** Flatten a HeapProfiler sampling profile into {total, byFunction[]}. */
function summariseSamplingProfile(profile) {
  const byFunction = new Map();
  const byUrl = new Map();
  let total = 0;
  const walk = (node) => {
    const self = (node.selfSize ?? 0);
    if (self > 0) {
      const cf = node.callFrame ?? {};
      const url = (cf.url || '').replace(/^https?:\/\/[^/]+/, '');
      const key = `${cf.functionName || '(anonymous)'} @ ${url}:${cf.lineNumber ?? '?'}:${cf.columnNumber ?? '?'}`;
      byFunction.set(key, (byFunction.get(key) ?? 0) + self);
      byUrl.set(url || '(native)', (byUrl.get(url || '(native)') ?? 0) + self);
      total += self;
    }
    for (const child of node.children ?? []) walk(child);
  };
  if (profile?.head) walk(profile.head);
  return {
    totalBytes: total,
    byUrl: [...byUrl.entries()].sort((a, b) => b[1] - a[1]).map(([name, bytes]) => ({ name, bytes })),
    byFunction: [...byFunction.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([name, bytes]) => ({ name, bytes })),
  };
}

/** Pull MajorGC/MinorGC complete events out of a devtools trace buffer. */
function summariseGc(traceBuffer) {
  let events;
  try {
    const parsed = JSON.parse(traceBuffer.toString('utf8'));
    events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  } catch {
    return { parsed: false };
  }
  const gc = events.filter(
    (e) => (e.ph === 'X' || e.ph === 'C') && /^(MajorGC|MinorGC|V8\.GC.*)$/.test(e.name ?? '') && typeof e.dur === 'number',
  );
  const durs = gc.map((e) => e.dur / 1000); // µs -> ms
  const sum = durs.reduce((a, b) => a + b, 0);
  return {
    parsed: true,
    count: durs.length,
    maxMs: durs.length ? Math.max(...durs) : 0,
    meanMs: durs.length ? sum / durs.length : 0,
    totalMs: sum,
    majorCount: gc.filter((e) => e.name === 'MajorGC').length,
    minorCount: gc.filter((e) => e.name === 'MinorGC').length,
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

async function profileCase(kase) {
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: resolveChromePath(),
    protocolTimeout: 180_000,
    args: CHROME_ARGS,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));
    if (VERBOSE) page.on('console', (m) => process.stderr.write(`[page:${m.type()}] ${m.text()}\n`));

    await page.goto(`${BASE_URL}/?${kase.query}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.waitForSelector('canvas', { timeout: 90_000 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.start-menu-start-btn');
        return !!btn && !btn.disabled;
      },
      { timeout: 90_000 },
    );
    await sleep(300);
    await page.evaluate(() => document.querySelector('.start-menu-start-btn')?.click());
    await page.waitForFunction(() => !!window.__watershedScreenshot, { timeout: 30_000 });

    if (typeof kase.teleport === 'number') {
      await page.evaluate((id) => window.__watershedScreenshot?.teleportToSegment?.(id), kase.teleport);
    }
    // Let the scene settle (chunk pool, decoration instancing, water warm-up)
    // before the measured window, so one-time setup is not counted as per-frame.
    await sleep(SETTLE_MS);

    const client = await page.createCDPSession();
    await client.send('HeapProfiler.enable');
    await client.send('Performance.enable');

    // Baseline heap after a forced GC, so the "heap size" row is live data.
    await page.evaluate(() => globalThis.gc?.());
    const heapBefore = await page.evaluate(
      () => performance.memory?.usedJSHeapSize ?? null,
    );

    await page.evaluate(() => {
      window.__allocProbe = { frames: [], last: performance.now(), stop: false };
      const tick = () => {
        const now = performance.now();
        window.__allocProbe.frames.push(now - window.__allocProbe.last);
        window.__allocProbe.last = now;
        if (!window.__allocProbe.stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const tracePath = path.join(OUT_DIR, `${kase.label}.trace.json`);
    await page.tracing.start({
      categories: ['v8', 'v8.gc', 'disabled-by-default-devtools.timeline'],
      path: tracePath,
    });
    await client.send('HeapProfiler.startSampling', { samplingInterval: 4096 });

    await sleep(SAMPLE_MS);

    const { profile } = await client.send('HeapProfiler.stopSampling');
    await page.tracing.stop();
    // Puppeteer returns no buffer when `path` is set — read the file back.
    const traceBuffer = fs.readFileSync(tracePath);
    await page.evaluate(() => {
      window.__allocProbe.stop = true;
    });

    const frames = await page.evaluate(() => window.__allocProbe.frames.slice(1));
    const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    const physics = await page.evaluate(() => window.__watershedPhysicsPerf ?? null);
    const metrics = await client.send('Performance.getMetrics');
    const metricMap = Object.fromEntries(metrics.metrics.map((m) => [m.name, m.value]));

    const alloc = summariseSamplingProfile(profile);
    const sorted = [...frames].sort((a, b) => a - b);
    const frameCount = frames.length;

    return {
      label: kase.label,
      sampleMs: SAMPLE_MS,
      settleMs: SETTLE_MS,
      frameCount,
      fps: frameCount / (SAMPLE_MS / 1000),
      frameTimeMs: {
        p50: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
        max: sorted.at(-1) ?? 0,
      },
      allocation: {
        totalBytes: alloc.totalBytes,
        byUrl: alloc.byUrl,
        bytesPerFrame: frameCount ? alloc.totalBytes / frameCount : null,
        bytesPerSecond: alloc.totalBytes / (SAMPLE_MS / 1000),
        top: alloc.byFunction,
      },
      gc: summariseGc(traceBuffer),
      heap: {
        usedBeforeBytes: heapBefore,
        usedAfterBytes: heapAfter,
        jsHeapUsedSize: metricMap.JSHeapUsedSize ?? null,
        jsHeapTotalSize: metricMap.JSHeapTotalSize ?? null,
      },
      physics,
      pageErrors,
    };
  } catch (err) {
    return { label: kase.label, error: String(err.stack || err.message || err) };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  for (const kase of CASES) {
    process.stderr.write(`[alloc] ${kase.label}...\n`);
    results.push(await profileCase(kase));
  }
  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ url: BASE_URL, capturedAt: new Date().toISOString(), sampleMs: SAMPLE_MS,
      settleMs: SETTLE_MS, results }, null, 2),
  );
  for (const r of results) {
    if (r.error) {
      console.log(`\n### ${r.label}\nERROR: ${r.error}`);
      continue;
    }
    console.log(`\n### ${r.label}`);
    console.log(`  frames=${r.frameCount} (${r.fps.toFixed(1)} fps, SwiftShader — not a hardware FPS)`);
    console.log(`  frame ms p50=${r.frameTimeMs.p50.toFixed(2)} p95=${r.frameTimeMs.p95.toFixed(2)} max=${r.frameTimeMs.max.toFixed(2)}`);
    console.log(`  alloc ${(r.allocation.bytesPerFrame ?? 0).toFixed(0)} B/frame, ${(r.allocation.bytesPerSecond / 1024).toFixed(1)} KiB/s`);
    console.log(`  gc count=${r.gc.count} max=${(r.gc.maxMs ?? 0).toFixed(2)}ms mean=${(r.gc.meanMs ?? 0).toFixed(3)}ms`);
    console.log(`  heap used=${((r.heap.jsHeapUsedSize ?? 0) / 1048576).toFixed(1)} MiB`);
    console.log(`  allocation by bundle:`);
    for (const u of r.allocation.byUrl.slice(0, 8)) {
      const pct = (100 * u.bytes) / (r.allocation.totalBytes || 1);
      console.log(`    ${(u.bytes / 1024).toFixed(1).padStart(9)} KiB (${pct.toFixed(1).padStart(5)}%)  ${u.name}`);
    }
    console.log(`  top allocators:`);
    for (const f of r.allocation.top.slice(0, 10)) {
      console.log(`    ${(f.bytes / 1024).toFixed(1).padStart(9)} KiB  ${f.name}`);
    }
  }
  console.log(`\nReport: ${reportPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
