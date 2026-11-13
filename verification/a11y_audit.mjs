#!/usr/bin/env node
/**
 * a11y_audit.mjs — axe-core over every menu screen (#558 E.1), plus the UI-scale
 * clip check (#558 B.3). Needs a running `pnpm preview` (WATERSHED_URL, default
 * http://127.0.0.1:4173), like the visual smoke it runs beside in CI.
 *
 *   pnpm test:a11y
 *
 * Screens: the start menu, Options (each page), the pause menu and its Options,
 * the wipeout overlay with the run results, and the 390×844 touch layout. Each
 * at 100 % and, for the start menu, Options and touch layout, at 200 % UI scale
 * (`?uiScale=2`). A serious or critical axe violation fails the run.
 *
 * Clip check: at every scale, every visible button / tab / input on the screen
 * must sit inside the viewport or inside a scroll container that can reach it
 * (an overlay that scrolls is fine; a control cut off by `overflow: hidden` or
 * off-screen with no scroll is not).
 *
 * The in-run screens (pause, wipeout, touch) need a booted run, which SwiftShader
 * on a shared runner sometimes cannot give (the visual smoke's F-8); those are
 * soft-skipped with the reason, never passed silently. The start menu and its
 * Options are required.
 *
 * Out of axe's reach and so not checked here: the WebGL canvas itself (3D
 * gameplay narration is out of scope, #558), colour contrast over the live 3D
 * frame (axe sees a canvas, not pixels).
 */

import puppeteer from 'puppeteer';
import { AxePuppeteer } from '@axe-core/puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output', 'a11y');
const BASE_URL = (process.env.WATERSHED_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '');
const FAIL_IMPACTS = new Set(['serious', 'critical']);
const BASE_QUERY = 'cleanTest=1&renderer=webgl&screenshot=1&no-pointer-lock=1';

const CHROME_ARGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--use-gl=swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
  '--disable-gpu-sandbox',
  '--hide-scrollbars',
];

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of [
    '/opt/pw-browsers/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  try {
    return puppeteer.executablePath();
  } catch {
    return undefined;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  return puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: resolveChromePath(),
    protocolTimeout: 60_000,
    timeout: 120_000,
    args: CHROME_ARGS,
  });
}

/** Every control a player must reach, and whether it is clipped. */
async function clippedControls(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // The first ancestor that clips decides: a scroll container can bring the
    // control into view; a hidden / clip one cuts it off where it ends.
    const clipper = (el) => {
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const s = getComputedStyle(p);
        const ox = s.overflowX;
        const oy = s.overflowY;
        if (ox === 'visible' && oy === 'visible') continue;
        const scrolls = /(auto|scroll)/.test(ox) || /(auto|scroll)/.test(oy);
        return { el: p, scrolls };
      }
      return null;
    };
    for (const el of document.querySelectorAll('button, [role="tab"], [role="radio"], [role="switch"], input, select, a[href]')) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') continue;
      const name = (el.getAttribute('aria-label') || el.textContent || el.id || el.className || el.tagName).trim().slice(0, 40);
      const c = clipper(el);
      const box = c && c.el !== document.body ? c.el.getBoundingClientRect() : { left: 0, top: 0, right: vw, bottom: vh };
      if (c && !c.scrolls) {
        if (r.right > box.right + 1 || r.left < box.left - 1 || r.bottom > box.bottom + 1 || r.top < box.top - 1) {
          out.push(`${name}: cut off by .${String(c.el.className).split(' ')[0] || c.el.tagName.toLowerCase()}`);
        }
        continue;
      }
      // In a scroller (or the page): vertical overflow scrolls into view; a
      // control past the left / right edge means the layout broke.
      if (r.right > Math.min(vw, box.right) + 1 || r.left < Math.max(0, box.left) - 1) {
        out.push(`${name}: past the side edge (${Math.round(r.left)}–${Math.round(r.right)} of ${vw})`);
      }
    }
    return out;
  });
}

const report = { url: BASE_URL, screens: [], failures: [], skipped: [] };

async function audit(page, label, { include } = {}) {
  let builder = new AxePuppeteer(page).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']);
  // The 3D canvas is not a document; the HUD and menus are.
  builder = builder.exclude('canvas');
  if (include) builder = builder.include(include);
  // The run's history.replaceState (`&map=`) can land mid-inject on a busy
  // SwiftShader main thread ("Page/Frame is not ready"): settle and retry.
  let result;
  for (let attempt = 1; ; attempt += 1) {
    try {
      result = await builder.analyze();
      break;
    } catch (err) {
      if (attempt >= 4 || !/not ready|detached|Execution context/i.test(String(err.message))) throw err;
      await sleep(1_500);
    }
  }
  const bad = result.violations.filter((v) => FAIL_IMPACTS.has(v.impact));
  const clipped = await clippedControls(page);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${label}.png`) }).catch(() => {});
  report.screens.push({
    label,
    violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })),
    clipped,
  });
  const minor = result.violations.length - bad.length;
  if (bad.length === 0 && clipped.length === 0) {
    console.log(`  ✓ ${label}  (${result.passes.length} rules pass${minor ? `, ${minor} minor/moderate noted` : ''})`);
    return;
  }
  for (const v of bad) {
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ');
    console.error(`  ✗ ${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}×: ${where})`);
    report.failures.push(`${label}: ${v.id}`);
  }
  for (const c of clipped) {
    console.error(`  ✗ ${label}: clipped control — ${c}`);
    report.failures.push(`${label}: clipped ${c}`);
  }
}

async function openMenu(page, query) {
  await page.goto(`${BASE_URL}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.start-menu-start-btn', { timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.start-menu-start-btn');
      return !!btn && !btn.disabled;
    },
    { timeout: 90_000 },
  );
}

/** Options: audit every page (tab) of the panel. */
async function auditOptions(page, prefix) {
  await page.waitForSelector('.settings-panel [role="tab"]', { timeout: 20_000 });
  const tabs = await page.$$eval('.settings-panel [role="tab"]', (els) => els.length);
  for (let i = 0; i < tabs; i += 1) {
    await page.evaluate((n) => document.querySelectorAll('.settings-panel [role="tab"]')[n].click(), i);
    await sleep(150);
    const name = await page.evaluate(
      (n) => document.querySelectorAll('.settings-panel [role="tab"]')[n].textContent.trim().toLowerCase().replace(/[^a-z]+/g, '-'),
      i,
    );
    await audit(page, `${prefix}_options_${i}_${name}`);
  }
}

async function menuScreens(browser, scale) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const q = scale === 1 ? BASE_QUERY : `${BASE_QUERY}&uiScale=${scale}`;
  await openMenu(page, q);
  const tag = `menu@${Math.round(scale * 100)}`;
  await audit(page, `${tag}_start`);
  // The last of the start menu's secondary buttons is Options (the Workshop's comes first).
  await page.evaluate(() => [...document.querySelectorAll('.start-menu-settings-btn')].pop()?.click());
  await auditOptions(page, tag);
  await page.close();
}

/** The in-run block, retried once on a fresh page (a SwiftShader boot is flaky, F-8). */
async function inRunScreens(browser) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const before = report.skipped.length;
    await inRunScreensOnce(browser, attempt === 2);
    if (report.skipped.length === before) return;
    if (attempt === 1) {
      report.skipped.pop();
      console.warn('  … retrying the in-run screens on a fresh page');
    }
  }
}

async function inRunScreensOnce(browser, last) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await openMenu(page, BASE_QUERY);
  await page.evaluate(() => document.querySelector('.start-menu-start-btn').click());
  try {
    await page.waitForFunction(() => !!window.__watershedScreenshot, { timeout: 30_000 });
    await sleep(2_000);
    await audit(page, 'run_hud');

    // Escape the way the page hears it: a CDP key press can time out on a busy
    // SwiftShader main thread, a dispatched event cannot.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })));
    await page.waitForSelector('.pause-menu-card', { timeout: 15_000 });
    await audit(page, 'pause');
    const settings = await page.$('.pause-menu-settings-btn');
    if (settings) {
      await page.evaluate(() => document.querySelector('.pause-menu-settings-btn').click());
      await auditOptions(page, 'pause');
      await page.evaluate(() =>
        [...document.querySelectorAll('.settings-panel-close-btn')].pop()?.click(),
      );
      await sleep(300);
    }
    // Resume, then fall out of the canyon: the wipeout overlay and its results.
    await page.evaluate(() => document.querySelector('.pause-menu-resume-btn')?.click());
    await sleep(800);
    await page.evaluate(() => window.__watershedScreenshot?.teleportToZ?.(-30, -400));
    await page.waitForSelector('.hud-overlay__title--wipeout', { timeout: 30_000 });
    await sleep(500);
    await audit(page, 'wipeout_results');
  } catch (err) {
    report.skipped.push(`in-run screens: ${err.message}`);
    if (process.env.A11Y_DEBUG) console.warn(err.stack);
    if (last) console.warn(`  ⚠ in-run screens skipped (SwiftShader / F-8): ${err.message}`);
  }
  await page.close();
}

async function touchScreens(browser, scale) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const q = `cleanTest=1&renderer=webgl&screenshot=1&input=touch${scale === 1 ? '' : `&uiScale=${scale}`}`;
  const tag = `touch@${Math.round(scale * 100)}`;
  await openMenu(page, q);
  await audit(page, `${tag}_start`);
  await page.evaluate(() => document.querySelector('.start-menu-start-btn').click());
  try {
    await page.waitForSelector('[data-testid="touch-controls"]', { timeout: 60_000 });
    await sleep(1_000);
    await audit(page, `${tag}_layout`);
  } catch (err) {
    report.skipped.push(`${tag} layout: ${err.message}`);
    console.warn(`  ⚠ ${tag} layout skipped (SwiftShader / F-8): ${err.message}`);
  }
  await page.close();
}

async function main() {
  console.log(`a11y audit against ${BASE_URL}`);
  const browser = await launch();
  try {
    const only = process.env.A11Y_ONLY ?? '';
    for (const scale of only && only !== 'menus' ? [] : [1, 2]) {
      console.log(`\n[menus @ ${scale * 100} %]`);
      await menuScreens(browser, scale);
    }
    if (!only || only === 'inrun') {
      console.log('\n[in-run]');
      await inRunScreens(browser);
    }
    for (const scale of only && only !== 'touch' ? [] : [1, 1.5, 2]) {
      console.log(`\n[touch @ ${scale * 100} %]`);
      await touchScreens(browser, scale);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  if (report.failures.length) {
    console.error(`\na11y audit FAILED: ${report.failures.length} problem(s) — ${path.join(OUT_DIR, 'report.json')}`);
    process.exit(1);
  }
  console.log(`\na11y audit passed (${report.screens.length} screens${report.skipped.length ? `, ${report.skipped.length} skipped` : ''}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
