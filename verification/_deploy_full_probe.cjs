const puppeteer = require('puppeteer');

(async () => {
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailed = [];
  const badResponses = [];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  page.on('console', (msg) => {
    const loc = msg.location();
    const locStr = loc.url
      ? ` @ ${loc.url}:${loc.lineNumber ?? ''}`
      : '';
    consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      location: locStr,
    });
  });

  page.on('pageerror', (err) => {
    pageErrors.push({
      message: err.message,
      stack: err.stack || '',
    });
  });

  page.on('requestfailed', (req) => {
    requestFailed.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText || 'unknown',
    });
  });

  page.on('response', (res) => {
    const status = res.status();
    if (status >= 400) {
      badResponses.push({
        status,
        url: res.url(),
      });
    }
  });

  let navigation = { status: null, error: null };
  try {
    const res = await page.goto('https://test.1ink.us/watershed/index.html', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    navigation.status = res?.status() ?? null;
  } catch (e) {
    navigation.error = String(e);
  }

  await new Promise((r) => setTimeout(r, 15000));

  const dom = await page.evaluate(() => {
    const root = document.getElementById('root');
    const rootHTML = root ? root.innerHTML : null;
    const rootText = root ? (root.innerText || '').trim() : '';
    const bodyText = (document.body?.innerText || '').trim();
    const canvas = document.querySelector('canvas');
    const allText = bodyText.slice(0, 4000);

    const wasmStatus = (() => {
      const hay = allText + rootText;
      if (/WASM\s+FALLBACK/i.test(hay)) return 'WASM FALLBACK';
      if (/WASM\s+READY/i.test(hay)) return 'WASM READY';
      const nodes = Array.from(document.querySelectorAll('*'));
      for (const el of nodes) {
        const t = (el.textContent || '').trim();
        if (/WASM\s+(FALLBACK|READY)/i.test(t)) return t.match(/WASM\s+(FALLBACK|READY)/i)[0];
      }
      return null;
    })();

    const pickHud = (label) => {
      const re = new RegExp(label + '\\s*[:\\-]?\\s*([\\d.,]+|[A-Za-z][A-Za-z0-9 _-]*)', 'i');
      const m = allText.match(re);
      return m ? m[0] : null;
    };

    const hud = {
      speed: pickHud('speed') || pickHud('mph') || pickHud('km/h'),
      distance: pickHud('distance'),
      score: pickHud('score'),
      biome: pickHud('biome'),
    };

    const menuLines = allText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.length < 120)
      .slice(0, 40);

    return {
      title: document.title,
      rootExists: !!root,
      rootChildCount: root ? root.childElementCount : 0,
      rootHTMLLength: rootHTML ? rootHTML.length : 0,
      rootHTMLSample: rootHTML ? rootHTML.slice(0, 1200) : null,
      hasCanvas: !!canvas,
      canvasCount: document.querySelectorAll('canvas').length,
      wasmStatusText: wasmStatus,
      hud,
      menuLines,
      bodyTextSample: allText.slice(0, 2500),
    };
  });

  const report = {
    navigation,
    dom,
    pageErrors,
    requestFailed,
    badResponses,
    consoleMessages,
  };

  console.log('=== WATERSHED_DEPLOY_PROBE_JSON_START ===');
  console.log(JSON.stringify(report, null, 2));
  console.log('=== WATERSHED_DEPLOY_PROBE_JSON_END ===');

  console.log('\n=== CONSOLE_MESSAGES_PLAIN ===');
  for (const m of consoleMessages) {
    console.log(`[${m.type}]${m.location} ${m.text}`);
  }

  await browser.close();
})().catch((e) => {
  console.error('PROBE_FATAL', e);
  process.exit(1);
});
