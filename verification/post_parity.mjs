#!/usr/bin/env node
/**
 * GLSL vs TSL post parity gate (#466 Phase A).
 *
 *   pnpm test:post-parity
 *
 * Starts a Vite dev server, opens verification/post_parity.html in headless
 * Chromium (SwiftShader WebGL2), and renders one deterministic frame through the
 * GLSL EffectComposer driver and the node RenderPipeline (src/debug/postParity.ts).
 * Exits non-zero if any scenario's mean luma differs by POST_PARITY_EPSILON
 * (default 2%) or more. Also prints the GLSL chain's luma with its OutputPass
 * off — the pre-#466 image — so the size of the grade change is on record.
 *
 * Env:
 *   PUPPETEER_EXECUTABLE_PATH  Chrome/Chromium binary override
 *   POST_PARITY_EPSILON        relative mean-luma tolerance (default 0.02)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EPSILON = Number(process.env.POST_PARITY_EPSILON ?? 0.02);

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
const url = `http://127.0.0.1:${address.port}/verification/post_parity.html`;

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
    for (const r of report.results) {
      const ok = r.relativeDelta < EPSILON;
      console.log(
        `${ok ? '✓' : '✗'} ${r.scenario.padEnd(18)} glsl=${r.glslLuma.toFixed(4)} node=${r.nodeLuma.toFixed(4)} ` +
          `Δ=${pct(r.relativeDelta)}  edge glsl/node=${(r.glslEdge * 1000).toFixed(2)}/${(r.nodeEdge * 1000).toFixed(2)}‰` +
          `  (glsl without OutputPass=${r.glslLinearLuma.toFixed(4)})`,
      );
    }
    const failed = report.results.filter((r) => !(r.relativeDelta < EPSILON));
    console.log(failed.length === 0
      ? `Post parity ok (${report.results.length} scenarios, Δ mean luma < ${pct(EPSILON)})`
      : `Post parity FAILED: ${failed.length} of ${report.results.length}`);
    exitCode = failed.length === 0 && report.results.length > 0 ? 0 : 1;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
