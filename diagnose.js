// Diagnostic script to check for runtime errors
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Collect console messages
  const consoleLogs = [];
  page.on('console', msg => {
    const entry = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(entry);
    console.log(entry);
  });
  
  // Collect page errors
  page.on('pageerror', error => {
    console.log(`[PAGE ERROR] ${error.message}`);
  });
  
  // Collect failed requests
  page.on('requestfailed', request => {
    console.log(`[FAILED] ${request.url()} - ${request.failure().errorText}`);
  });
  
  console.log('Loading http://localhost:3000...');
  await page.goto('http://localhost:3000', { 
    waitUntil: 'networkidle2',
    timeout: 30000 
  });
  
  // Wait for React to mount
  await page.waitForTimeout(5000);
  
  // Check if canvas exists
  const canvasExists = await page.evaluate(() => {
    return document.querySelector('canvas') !== null;
  });
  console.log(`\nCanvas exists: ${canvasExists}`);
  
  // Check canvas size
  const canvasSize = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return canvas ? { width: canvas.width, height: canvas.height } : null;
  });
  console.log(`Canvas size: ${JSON.stringify(canvasSize)}`);
  
  // Take screenshot
  await page.screenshot({ path: 'diagnosis.png', fullPage: true });
  console.log('\nScreenshot saved to diagnosis.png');
  
  await browser.close();
  
  console.log('\n=== Summary ===');
  const errors = consoleLogs.filter(l => l.includes('[error]') || l.includes('[PAGE ERROR]'));
  if (errors.length > 0) {
    console.log(`Found ${errors.length} errors:`);
    errors.forEach(e => console.log('  -', e));
  } else {
    console.log('No console errors detected.');
  }
})();
