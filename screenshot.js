import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const URL = BASE_URL.includes('?')
  ? BASE_URL + '&renderer=webgl&no-pointer-lock=1'
  : BASE_URL + '?renderer=webgl&no-pointer-lock=1';
const OUT = process.argv[3] || '/content/watershed/screenshot.png';

const chromeArgs = [
  '--no-sandbox',
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--enable-zero-copy',
  '--disable-search-engine-choice-screen',
  '--ash-no-nudges',
  '--no-first-run',
  '--disable-features=Translate',
  '--no-default-browser-check',
  '--window-size=1280,720',
  '--hide-scrollbars',
];

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome',
    args: chromeArgs,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[console] ${text}`);
    console.log(text);
  });
  page.on('pageerror', err => {
    const stack = err.stack || '';
    logs.push(`[pageerror] ${err.message}\n${stack}`);
    console.error('Page error:', err.message, stack);
  });
  page.on('requestfailed', req => {
    logs.push(`[requestfailed] ${req.url()}: ${req.failure()?.errorText}`);
  });

  console.log(`Navigating to ${URL} ...`);
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

  // Wait for React to render something.
  await page.waitForFunction(() => document.body.innerText.length > 0, { timeout: 30000 });

  console.log('Page loaded. Waiting for start button...');
  // Try to click the start button if it exists.
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter(el => /start|play|begin/i.test(el.innerText || el.textContent || ''));
    if (candidates.length > 0) {
      candidates[0].click();
      return candidates[0].innerText || candidates[0].textContent;
    }
    return null;
  });
  console.log('Clicked start element:', clicked);

  // Give the 3D scene time to initialize and render a few frames.
  await new Promise(r => setTimeout(r, 8000));

  // Ensure output directory exists.
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  await page.screenshot({ path: OUT, fullPage: false });
  console.log(`Screenshot saved to ${OUT}`);

  // Also save console logs for debugging.
  fs.writeFileSync(OUT.replace(/\.png$/i, '.log.txt'), logs.join('\n'));

  await browser.close();
}

run().catch(err => {
  console.error('Screenshot script failed:', err);
  process.exit(1);
});
