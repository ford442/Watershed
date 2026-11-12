#!/usr/bin/env node
/**
 * GLSL vs TSL parity gate: the post chain (#466 Phase A) and every dual
 * material host (#555 Phase A.2).
 *
 *   pnpm test:post-parity
 *
 * Starts a Vite dev server, opens verification/post_parity.html in headless
 * Chromium (SwiftShader WebGL2), and renders deterministic frames through both
 * backends:
 *
 *   post  — the GLSL `setEffects` driver vs the node RenderPipeline
 *           (src/debug/postParity.ts). Fails a scenario whose mean luma differs
 *           by POST_PARITY_EPSILON (default 2%) or more. Also prints the GLSL
 *           chain's luma with the grade off — the pre-#466 image.
 *   hosts — one scene per dual host in scripts/glsl-hosts-allowlist.json, built
 *           by the host's own factory with 'glsl' (WebGLRenderer) and 'tsl'
 *           (WebGPURenderer forceWebGL) (src/debug/hostParity.ts). The two
 *           frames are pixelmatched (threshold HOST_PIXEL_THRESHOLD, default
 *           0.15, as the visual smoke); a scene fails when the flagged share
 *           exceeds its own `maxMismatch`, or when the TSL draw fell back to a
 *           GLSL material.
 *
 * Env:
 *   PUPPETEER_EXECUTABLE_PATH  Chrome/Chromium binary override
 *   POST_PARITY_EPSILON        relative mean-luma tolerance for post (default 0.02)
 *   POST_PARITY_ONLY           `post` or `hosts` to run one half
 *   POST_PARITY_SHOTS          directory to write every glsl/node frame (and host diffs) as PNG
 *   HOST_PIXEL_THRESHOLD       pixelmatch per-pixel colour threshold (default 0.15)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EPSILON = Number(process.env.POST_PARITY_EPSILON ?? 0.02);
const SHOTS_DIR = process.env.POST_PARITY_SHOTS;
const ONLY = process.env.POST_PARITY_ONLY ?? '';
const HOST_PIXEL_THRESHOLD = Number(process.env.HOST_PIXEL_THRESHOLD ?? 0.15);

const decodePng = (dataUrl) => PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'));
const slugOf = (name) => name.replace(/[^a-z0-9]+/gi, '_');

/** Pixelmatch one host scene's two frames; writes the diff when SHOTS_DIR is set. */
function compareHost(r) {
  const a = decodePng(r.glslPng);
  const b = decodePng(r.nodePng);
  const diff = new PNG({ width: a.width, height: a.height });
  const flagged = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: HOST_PIXEL_THRESHOLD,
    includeAA: false,
  });
  if (SHOTS_DIR) fs.writeFileSync(path.join(SHOTS_DIR, `host_${slugOf(r.scene)}.diff.png`), PNG.sync.write(diff));
  return flagged / (a.width * a.height);
}

const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
];

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

const server = await createServer({
  root: rootDir,
  // The game builds with a relative asset base; this page lives off the root.
  define: { __WATERSHED_ASSET_BASE__: JSON.stringify('/') },
  logLevel: 'warn',
  server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const address = server.httpServer.address();
const url = `http://127.0.0.1:${address.port}/verification/post_parity.html${ONLY ? `?only=${ONLY}` : ''}`;

let exitCode = 1;
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: resolveChromePath(),
  protocolTimeout: 180_000,
  args: CHROME_ARGS,
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error(`[page] ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[console] ${msg.text()}`);
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => window.__postParity !== undefined, { timeout: 180_000, polling: 250 });
  const report = await page.evaluate(() => window.__postParity);

  if (report.error) {
    console.error(`Post parity could not run:\n${report.error}`);
  } else {
    const pct = (v) => `${(v * 100).toFixed(2)}%`;
    if (SHOTS_DIR) {
      fs.mkdirSync(SHOTS_DIR, { recursive: true });
      const frames = [
        ...report.results.map((r) => [slugOf(r.scenario), r]),
        ...report.hosts.map((r) => [`host_${slugOf(r.scene)}`, r]),
      ];
      for (const [slug, r] of frames) {
        for (const [driver, dataUrl] of [['glsl', r.glslPng], ['node', r.nodePng]]) {
          fs.writeFileSync(path.join(SHOTS_DIR, `${slug}.${driver}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
        }
      }
      console.log(`Frames written to ${SHOTS_DIR}`);
    }
    for (const r of report.results) {
      const ok = r.relativeDelta < EPSILON;
      console.log(
        `${ok ? '✓' : '✗'} ${r.scenario.padEnd(18)} glsl=${r.glslLuma.toFixed(4)} node=${r.nodeLuma.toFixed(4)} ` +
          `Δ=${pct(r.relativeDelta)}  edge glsl/node=${(r.glslEdge * 1000).toFixed(2)}/${(r.nodeEdge * 1000).toFixed(2)}‰` +
          `  (glsl without the grade=${r.glslLinearLuma.toFixed(4)})`,
      );
    }
    const failed = report.results.filter((r) => !(r.relativeDelta < EPSILON));
    // God rays add light on top of the frame; a darker image means the pass
    // dropped the scene underneath (the GLSL pass did, blending onto the
    // composer's stale ping-pong target).
    const grade = report.results.find((r) => r.scenario === 'grade');
    const rays = report.results.find((r) => r.scenario === 'god rays');
    if (grade && rays) {
      const kept = rays.glslLuma >= grade.glslLuma * (1 - EPSILON) && rays.nodeLuma >= grade.nodeLuma * (1 - EPSILON);
      console.log(`${kept ? '✓' : '✗'} scene under god rays: glsl ${grade.glslLuma.toFixed(4)} → ${rays.glslLuma.toFixed(4)}, node ${grade.nodeLuma.toFixed(4)} → ${rays.nodeLuma.toFixed(4)}`);
      if (!kept) failed.push(rays);
    }
    if (report.results.length > 0) {
      console.log(failed.length === 0
        ? `Post parity ok (${report.results.length} scenarios, Δ mean luma < ${pct(EPSILON)})`
        : `Post parity FAILED: ${failed.length} of ${report.results.length}`);
    }

    // Per-host parity (#555 A.2): flagged-pixel share against each scene's budget.
    const hostFailed = [];
    if (report.hosts.length > 0) console.log(`\nHost parity (pixelmatch threshold ${HOST_PIXEL_THRESHOLD}):`);
    for (const r of report.hosts) {
      const mismatch = compareHost(r);
      const fallback = r.tslFallbacks.length > 0;
      const ok = !fallback && mismatch <= r.maxMismatch;
      if (!ok) hostFailed.push(r.scene);
      console.log(
        `${ok ? '✓' : '✗'} ${r.scene.padEnd(12)} mismatch=${pct(mismatch).padStart(7)} budget=${pct(r.maxMismatch).padStart(7)}  ` +
          `luma glsl/node=${r.glslLuma.toFixed(4)}/${r.nodeLuma.toFixed(4)}  ${r.hosts.join(', ')}` +
          (fallback ? `\n    TSL draw fell back to GLSL: ${r.tslFallbacks.join(', ')}` : ''),
      );
    }
    if (report.hosts.length > 0) {
      console.log(hostFailed.length === 0
        ? `Host parity ok (${report.hosts.length} scenes)`
        : `Host parity FAILED: ${hostFailed.join(', ')}`);
    }

    const ran = report.results.length + report.hosts.length;
    exitCode = failed.length === 0 && hostFailed.length === 0 && ran > 0 ? 0 : 1;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
