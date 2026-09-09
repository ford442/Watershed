/**
 * provenance_guard_proof.mjs — boots the real built app in Chrome and reports what the
 * glue/binary provenance guard (#402) saw: the installed build identity, the
 * `[Watershed WASM]` log lines, and the HUD banner text if one is showing.
 *
 * Usage (with `pnpm preview` serving build/):
 *   node verification/provenance_guard_proof.mjs http://127.0.0.1:4173
 *
 * To prove the guard bites, swap one half of the pair between runs, e.g.
 *   git show <older-commit>:public/watershed_native.wasm > build/watershed_native.wasm
 * A coherent build prints `ready (abi=8)` and `banner: null`; a mismatched pair prints
 * `provenance-mismatch(...)` and a "Native WASM provenance mismatch — stale deploy" banner.
 * Restore the file afterwards.
 */
import puppeteer from 'puppeteer';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4181';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const page = await browser.newPage();
const lines = [];
page.on('console', (msg) => lines.push(`${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => lines.push(`pageerror: ${err.message}`));

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 12000));

const identity = await page.evaluate(() => globalThis.__WATERSHED_BUILD__ ?? null);
const banner = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="wasm-init-banner"]');
  return el ? el.textContent : null;
});

console.log(JSON.stringify({
  identity,
  banner,
  wasmLines: lines.filter((l) => l.includes('[Watershed WASM]')),
}, null, 2));

await browser.close();
