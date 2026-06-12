import puppeteer from 'puppeteer';
import fs from 'fs';

const URL = 'http://localhost:3000?renderer=webgl&no-pointer-lock=1';
const chromeArgs = [
  '--no-sandbox', '--headless=new', '--use-angle=vulkan', '--enable-features=Vulkan',
  '--disable-vulkan-surface', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization', '--enable-zero-copy', '--disable-software-rasterizer',
  '--force-color-profile=srgb',
  '--disable-search-engine-choice-screen', '--ash-no-nudges', '--no-first-run',
  '--disable-features=Translate', '--no-default-browser-check', '--window-size=1280,720',
  '--hide-scrollbars',
];

async function run() {
  const browser = await puppeteer.launch({ headless: 'new', ignoreDefaultArgs: true, executablePath: '/usr/bin/google-chrome', args: chromeArgs });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', err => console.error('Page error:', err.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(el => /start|run/i.test(el.innerText || el.textContent || ''));
    if (candidates.length) candidates[0].click();
  });
  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: '/content/watershed/screenshot_color.png', fullPage: false });
  console.log('Saved screenshot_color.png');
  await browser.close();
}
run().catch(err => { console.error(err); process.exit(1); });
