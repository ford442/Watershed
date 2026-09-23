#!/usr/bin/env node
/**
 * WGSL SWE twin vs the C++ stepper — parity gate (#435).
 *
 *   pnpm test:wgsl
 *
 * Starts a Vite dev server, opens verification/swe_wgsl_parity.html in
 * headless Chromium with a SwiftShader WebGPU adapter, and runs
 * src/systems/water/sweParity.ts against the committed watershed_native.wasm.
 * Exits non-zero if any scenario diverges past 1e-5 or a hydroContrast margin
 * fails on either backend.
 *
 * Env:
 *   PUPPETEER_EXECUTABLE_PATH  Chrome/Chromium binary override
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// WebGPU on SwiftShader's Vulkan. Blink's experimental WebGPU features are
// disabled because some Chromium builds carry an older, incompatible
// GPUTextureViewDescriptor.swizzle IDL behind them (see RENDERER.md).
const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--use-angle=swiftshader',
  '--disable-blink-features=WebGPUExperimentalFeatures',
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
  // The game builds with a relative asset base for deploys; getWasm() resolves
  // the binary against it, and this page does not live at the site root.
  define: { __WATERSHED_ASSET_BASE__: JSON.stringify('/') },
  logLevel: 'warn',
  server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const address = server.httpServer.address();
const url = `http://127.0.0.1:${address.port}/verification/swe_wgsl_parity.html`;

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
  await page.waitForFunction(() => window.__sweParity !== undefined, { timeout: 180_000, polling: 250 });
  const report = await page.evaluate(() => window.__sweParity);

  if (report.error) {
    console.error(`SWE WGSL parity could not run:\n${report.error}`);
  } else {
    console.log(`WebGPU adapter: ${report.adapter || '(unnamed)'}`);
    for (const r of report.results) {
      const diff = Number.isFinite(r.maxDiff) ? r.maxDiff.toExponential(2) : 'n/a';
      console.log(`${r.ok ? '✓' : '✗'} ${r.name}  max|Δ|=${diff}  ${r.detail}`);
    }
    const failed = report.results.filter((r) => !r.ok);
    console.log(failed.length === 0
      ? `SWE WGSL parity ok (${report.results.length} checks, tolerance 1e-5)`
      : `SWE WGSL parity FAILED: ${failed.length} of ${report.results.length}`);
    exitCode = failed.length === 0 && report.results.length > 0 ? 0 : 1;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
