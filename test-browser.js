const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,720'
    ]
  });
  
  console.log('Creating new page...');
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  
  // Collect console messages
  const consoleLogs = [];
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(text);
    console.log('CONSOLE:', text);
  });
  
  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
  });
  
  page.on('requestfailed', request => {
    console.log('FAILED REQUEST:', request.url(), request.failure().errorText);
  });
  
  try {
    console.log('\nNavigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    console.log('Page loaded, waiting for React to mount...');
    await new Promise(r => setTimeout(r, 5000));
    
    // Check if canvas exists
    const canvasInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return {
        exists: !!canvas,
        width: canvas?.width,
        height: canvas?.height,
        style: canvas?.getAttribute('style'),
        parent: canvas?.parentElement?.className
      };
    });
    console.log('\nCanvas info:', canvasInfo);
    
    // Check root element
    const rootInfo = await page.evaluate(() => {
      const root = document.getElementById('root');
      return {
        exists: !!root,
        childCount: root?.childElementCount,
        innerHTML: root?.innerHTML?.substring(0, 500)
      };
    });
    console.log('Root element info:', rootInfo);
    
    // Take screenshot
    console.log('\nTaking screenshot...');
    await page.screenshot({ path: 'test-screenshot.png', fullPage: true });
    console.log('Screenshot saved to test-screenshot.png');
    
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  await browser.close();
  
  console.log('\n=== Console Logs Summary ===');
  const errors = consoleLogs.filter(l => l.includes('error') || l.includes('Error'));
  if (errors.length > 0) {
    console.log('Errors found:', errors.length);
    errors.forEach(e => console.log('  ', e));
  } else {
    console.log('No errors in console logs');
  }
})();
