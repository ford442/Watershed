/**
 * spawn_profile.mjs — what a treadmill segment mount costs the main thread (#487 Phase B).
 *
 * The page is opened with `?spawnProfile=1`, which turns on two user-timing
 * measures per segment (src/terrain/spawnTiming.ts):
 *   segment-build  TrackSegment's render (channel profile, placement, geometry;
 *                  detail.geometryMs is the geometry's share)
 *   segment-mount  render start through the subtree's commit and effects
 *                  (Rapier trimesh, decorations)
 * and holds the quality preset (no adaptive ladder), so a Medium run stays Medium.
 *
 * After the boot window has settled, the harness appends segments one at a
 * time through `__watershedScreenshot.advanceTreadmill()` — headless the player
 * cannot drive the treadmill — and waits for each mount to finish before the
 * next. A `longtask` entry is attributed to a mount when the two overlap.
 *
 * The meander map is used for both biomes the issue names: its first ~16
 * segments are canyonSummer and segments 20–22 are slot canyon.
 *
 * It also counts WebGL program links (a patched `linkProgram`) at boot and per
 * append: renderer-independent, and the cost a light-count change used to add
 * to every mount (sceneLightPool.tsx).
 *
 * On SwiftShader the absolute numbers include software rasterisation of every
 * frame that lands in a measure, so they are larger than on a GPU — and most
 * frames are longtasks by themselves, so `over50` mostly says a frame overlapped. `segment-build`
 * is pure JS and comparable before/after on the same box; read the rest as
 * before/after deltas under one harness.
 *
 * Usage:
 *   pnpm preview --port 4181 --strictPort   (or pnpm start)
 *   WATERSHED_URL=http://127.0.0.1:4181 node verification/spawn_profile.mjs
 *
 * Env:
 *   SPAWN_QUALITIES   comma list of med,high (default both)
 *   SPAWN_APPENDS     segments appended after boot (default 26)
 *   SPAWN_SETTLE_MS   idle after boot before the first append (default 6000)
 *   SPAWN_EXTRA_QUERY extra query, e.g. simWorker=0 or material=tsl
 *   SPAWN_GATE=1      exit 1 when a High-run mount overlaps a longtask > SPAWN_MAX_LONGTASK_MS (default 50)
 */
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output', 'spawn-profile');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const QUALITIES = (process.env.SPAWN_QUALITIES ?? 'med,high').split(',').map((q) => q.trim()).filter(Boolean);
const APPENDS = Number(process.env.SPAWN_APPENDS ?? 26);
const SETTLE_MS = Number(process.env.SPAWN_SETTLE_MS ?? 6000);
const EXTRA_QUERY = process.env.SPAWN_EXTRA_QUERY ?? '';
const GATE = process.env.SPAWN_GATE === '1';
const MAX_LONGTASK_MS = Number(process.env.SPAWN_MAX_LONGTASK_MS ?? 50);
/** Per-append wait for its segment-mount measure. */
const MOUNT_TIMEOUT_MS = 30_000;
/** Quiet time after a mount so trailing work (effects, first frame) lands before the next append. */
const POST_MOUNT_IDLE_MS = 800;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
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

const quantile = (values, q) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const round = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);

/** Longtasks overlapping [start, end). */
const overlapping = (tasks, start, end) =>
  tasks.filter((t) => t.startTime < end && t.startTime + t.duration > start);

async function profileQuality(quality) {
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: resolveChromePath(),
    protocolTimeout: 120_000,
    args: CHROME_ARGS,
  });
  const pageErrors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    page.on('pageerror', (e) => pageErrors.push(e.message || String(e)));
    // Which SWE backend the session settled on: the worker tile build needs the sim worker.
    const backendLines = [];
    page.on('console', (m) => {
      const text = m.text();
      if (/^\[SWE\] backend=|\[sim worker\]/.test(text)) backendLines.push(text.slice(0, 160));
    });
    await page.evaluateOnNewDocument((q) => {
      try {
        localStorage.setItem('watershed-settings', JSON.stringify({ state: { quality: q }, version: 1 }));
      } catch {
        /* storage blocked: the preset falls back to the default */
      }
      window.__spawnLongtasks = [];
      // Program links: renderer-independent. A light-count change recompiles every lit program.
      window.__spawnLinks = [];
      try {
        const proto = WebGL2RenderingContext.prototype;
        const link = proto.linkProgram;
        proto.linkProgram = function (program) {
          window.__spawnLinks.push(performance.now());
          return link.call(this, program);
        };
      } catch {
        /* no WebGL2: link counts stay empty */
      }
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            window.__spawnLongtasks.push({ startTime: e.startTime, duration: e.duration });
          }
        }).observe({ type: 'longtask', buffered: true });
      } catch {
        /* no longtask support: attribution is empty */
      }
    }, quality);

    const query = ['map=meander', 'cleanTest=1', 'renderer=webgl', 'screenshot=1', 'no-pointer-lock=1', 'spawnProfile=1', EXTRA_QUERY]
      .filter(Boolean)
      .join('&');
    await page.goto(`${BASE_URL}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.start-menu-start-btn', { timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.start-menu-start-btn');
        return !!btn && !btn.disabled;
      },
      { timeout: 90_000 },
    );
    await page.evaluate(() => document.querySelector('.start-menu-start-btn').click());
    await page.waitForFunction(() => !!window.__watershedScreenshot?.advanceTreadmill, { timeout: 60_000 });
    await sleep(SETTLE_MS);
    const bootCutoff = await page.evaluate(() => performance.now());

    let appended = 0;
    for (let i = 0; i < APPENDS; i += 1) {
      const before = await page.evaluate(() => performance.getEntriesByName('segment-mount').length);
      const ok = await page.evaluate(() => window.__watershedScreenshot.advanceTreadmill());
      if (!ok) break;
      appended += 1;
      await page
        .waitForFunction((n) => performance.getEntriesByName('segment-mount').length > n, {
          timeout: MOUNT_TIMEOUT_MS,
          polling: 100,
        }, before)
        .catch(() => {});
      await sleep(POST_MOUNT_IDLE_MS);
    }

    const raw = await page.evaluate(() => {
      const pick = (name) =>
        performance.getEntriesByName(name).map((e) => ({
          startTime: e.startTime,
          duration: e.duration,
          ...(e.detail ?? {}),
        }));
      return {
        build: pick('segment-build'),
        mount: pick('segment-mount'),
        longtasks: window.__spawnLongtasks ?? [],
        links: window.__spawnLinks ?? [],
      };
    });

    const builds = new Map(raw.build.map((b) => [`${b.segmentId}@${Math.round(b.startTime)}`, b]));
    const mounts = raw.mount.map((m) => {
      const build = builds.get(`${m.segmentId}@${Math.round(m.startTime)}`);
      const tasks = overlapping(raw.longtasks, m.startTime, m.startTime + m.duration);
      return {
        segmentId: m.segmentId,
        biome: m.biome,
        source: m.source,
        phase: m.startTime < bootCutoff ? 'boot' : 'treadmill',
        buildMs: round(build?.duration ?? null),
        geometryMs: round(build?.geometryMs ?? null),
        mountMs: round(m.duration),
        longtasks: tasks.map((t) => round(t.duration)),
        maxLongtaskMs: round(tasks.reduce((max, t) => Math.max(max, t.duration), 0)),
      };
    });

    const treadmillLinks = raw.links.filter((t) => t >= bootCutoff).length;
    return {
      quality,
      appended,
      mounts,
      pageErrors,
      backendLines,
      longtaskCount: raw.longtasks.length,
      bootLinks: raw.links.length - treadmillLinks,
      treadmillLinks,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function summarise(run) {
  const groups = new Map();
  for (const m of run.mounts) {
    if (m.phase !== 'treadmill') continue;
    const key = m.biome;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const rows = [];
  for (const [biome, list] of groups) {
    const builds = list.map((m) => m.buildMs).filter((v) => v !== null);
    const geometry = list.map((m) => m.geometryMs).filter((v) => v !== null);
    const mounts = list.map((m) => m.mountMs);
    const tasks = list.map((m) => m.maxLongtaskMs);
    rows.push({
      quality: run.quality,
      biome,
      n: list.length,
      buildP50: round(quantile(builds, 0.5)),
      buildMax: round(Math.max(...builds)),
      geomP50: round(quantile(geometry, 0.5)),
      mountP50: round(quantile(mounts, 0.5)),
      mountMax: round(Math.max(...mounts)),
      longtaskMax: round(Math.max(...tasks)),
      over50: list.filter((m) => m.maxLongtaskMs > MAX_LONGTASK_MS).length,
    });
  }
  const boot = run.mounts.filter((m) => m.phase === 'boot');
  return { rows, boot: { n: boot.length, buildSum: round(boot.reduce((s, m) => s + (m.buildMs ?? 0), 0)) } };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`spawn-profile → ${BASE_URL}  qualities=${QUALITIES.join(',')} appends=${APPENDS}${EXTRA_QUERY ? ` extra=${EXTRA_QUERY}` : ''}`);
  const report = { url: BASE_URL, extraQuery: EXTRA_QUERY, runs: [] };
  let gateFailed = false;
  for (const quality of QUALITIES) {
    const run = await profileQuality(quality);
    const summary = summarise(run);
    report.runs.push({ ...run, summary });
    console.log(`\n[${quality}] appended ${run.appended}, ${run.mounts.length} mounts measured, ${run.longtaskCount} longtasks, boot mounts ${summary.boot.n} (build Σ ${summary.boot.buildSum} ms)`);
    const sources = {};
    for (const m of run.mounts) sources[`${m.phase}/${m.source}`] = (sources[`${m.phase}/${m.source}`] ?? 0) + 1;
    console.log(`  backend: ${run.backendLines.join(' | ') || '(no [SWE] line)'}; mounts by phase/source: ${JSON.stringify(sources)}`);
    console.log(`  program links: ${run.bootLinks} at boot, ${run.treadmillLinks} over ${run.appended} appends (${(run.treadmillLinks / Math.max(1, run.appended)).toFixed(1)} per append)`);
    console.table(summary.rows);
    if (run.pageErrors.length) console.log(`  page errors: ${run.pageErrors.slice(0, 5).join(' | ')}`);
    if (quality === 'high' && summary.rows.some((r) => r.over50 > 0)) gateFailed = true;
  }
  const label = EXTRA_QUERY ? EXTRA_QUERY.replace(/[^a-z0-9]+/gi, '_') : 'default';
  const outPath = path.join(OUT_DIR, `spawn-profile-${label}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nreport: ${outPath}`);
  if (GATE && gateFailed) {
    console.error(`✗ a High mount overlapped a longtask > ${MAX_LONGTASK_MS} ms`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
