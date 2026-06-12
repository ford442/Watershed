import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const URL = 'http://localhost:3000?renderer=webgl&no-pointer-lock=1';
const OUT_DIR = '/content/watershed';

const chromeArgs = [
  '--no-sandbox', '--headless=new', '--use-angle=vulkan', '--enable-features=Vulkan',
  '--disable-vulkan-surface', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization', '--enable-zero-copy', '--disable-software-rasterizer',
  '--disable-search-engine-choice-screen', '--ash-no-nudges', '--no-first-run',
  '--disable-features=Translate', '--no-default-browser-check', '--window-size=1280,720',
  '--hide-scrollbars',
];

async function run() {
  const browser = await puppeteer.launch({ headless: 'new', ignoreDefaultArgs: true, executablePath: '/usr/bin/google-chrome', args: chromeArgs });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', msg => console.log(msg.text()));
  page.on('pageerror', err => console.error('Page error:', err.message));
  page.on('requestfailed', req => console.log('Request failed:', req.url(), req.failure()?.errorText));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));
  const out = (n) => path.join(OUT_DIR, `screenshot_ingame_${n}.png`);
  await page.screenshot({ path: out('menu'), fullPage: false });
  console.log('Saved menu screenshot');

  // Click start
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(el => /start|run/i.test(el.innerText || el.textContent || ''));
    if (candidates.length) candidates[0].click();
  });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: out('start3s'), fullPage: false });
  console.log('Saved start 3s screenshot');

  // Try pressing W for a few seconds
  await page.keyboard.down('w');
  await new Promise(r => setTimeout(r, 3000));
  await page.keyboard.up('w');
  await page.screenshot({ path: out('move3s'), fullPage: false });
  console.log('Saved move 3s screenshot');

  await new Promise(r => setTimeout(r, 4000));
  await page.screenshot({ path: out('move7s'), fullPage: false });
  console.log('Saved move 7s screenshot');

  await browser.close();
}
run().catch(err => { console.error(err); process.exit(1); });
