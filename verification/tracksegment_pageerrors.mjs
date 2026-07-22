/**
 * Minimal headless page-error check for meander map load (TrackSegment TS migration gate).
 */
import puppeteer from 'puppeteer';
import fs from 'fs';

const BASE = process.env.WATERSHED_URL ?? 'http://localhost:3000';
const TARGET = `${BASE}?renderer=webgl&map=meander&screenshot=1&no-pointer-lock=1`;
const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-software-rasterizer',
  '--window-size=1280,720',
  '--hide-scrollbars',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  ignoreDefaultArgs: true,
  executablePath: '/usr/bin/google-chrome',
  args: CHROME_ARGS,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('framenavigated', () => {});

try {
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 40000 });
  await sleep(5000);
} catch (err) {
  pageErrors.push(`boot-failure: ${err.message}`);
}

const preStartErrors = [...pageErrors];

try {
  const btn = await page.$('.start-menu-start-btn');
  if (btn) await btn.click({ delay: 20 });
} catch (err) {
  // Start click may fail if the tab already crashed; keep collecting errors.
  pageErrors.push(`start-click: ${err.message}`);
}

await sleep(6000).catch(() => {});

const trackSegmentErrors = pageErrors.filter((m) =>
  /isSlotCanyon|is not defined|TrackSegment|debris is not defined|ReferenceError/i.test(m)
);

const report = {
  url: TARGET,
  preStartPageErrors: [...new Set(preStartErrors)],
  pageErrors: [...new Set(pageErrors)],
  trackSegmentErrors: [...new Set(trackSegmentErrors)],
  consoleErrorSample: [...new Set(consoleErrors)].slice(0, 15),
};

const outPath = 'verification/output/tracksegment_pageerrors.json';
fs.mkdirSync('verification/output', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close().catch(() => {});

// Gate: no TrackSegment ReferenceErrors and no pre-start page errors
// (full in-game SwiftShader crashes are a known env limitation — see TESTING.md F-8)
if (trackSegmentErrors.length > 0 || preStartErrors.length > 0) {
  process.exit(1);
}
process.exit(0);
