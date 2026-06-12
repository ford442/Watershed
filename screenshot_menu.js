import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const URL = 'http://localhost:3000?renderer=webgl&no-pointer-lock=1';
const OUT = '/content/watershed/screenshot_menu.png';

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
  page.on('pageerror', err => console.error('Page error:', err.message, err.stack));
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT, fullPage: false });
  console.log('Screenshot saved to', OUT);
  await browser.close();
}
run().catch(err => { console.error(err); process.exit(1); });
