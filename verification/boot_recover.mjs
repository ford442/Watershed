import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: 'new', protocolTimeout: 90000,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-dev-shm-usage','--window-size=1280,720'],
});
const page = await browser.newPage();
const errs=[];
page.on('pageerror', e => errs.push(String(e.message).slice(0,400)));
const t0=Date.now();
await page.goto('http://localhost:3000?renderer=webgl&screenshot=1&no-pointer-lock=1',{waitUntil:'domcontentloaded',timeout:30000});

async function softEval(fn, ms=4000) {
  const start=Date.now();
  try {
    const value = await Promise.race([
      page.evaluate(fn),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms)),
    ]);
    return { ok:true, value, ms:Date.now()-start };
  } catch (e) {
    return { ok:false, err:e.message, ms:Date.now()-start };
  }
}

const pre=[];
for (let i=0;i<8;i++){
  const r = await softEval(() => ({
    menu: !!document.querySelector('.start-menu-start-btn'),
    canvas: !!document.querySelector('canvas'),
  }), 2000);
  pre.push({t:Date.now()-t0, ...r});
  if (r.ok && r.value.menu) break;
  await new Promise(r=>setTimeout(r,200));
}

const clickStart = Date.now();
let clickErr=null;
try {
  await page.click('.start-menu-start-btn', { delay: 20 });
} catch (e) { clickErr = e.message; }

// Poll for menu gone + occasional responsiveness
const post=[];
let menuGone=false;
for (let i=0;i<30;i++){
  const r = await softEval(() => ({
    menu: !!document.querySelector('.start-menu-start-btn'),
    canvas: !!document.querySelector('canvas'),
  }), 5000);
  post.push({t:Date.now()-t0, ...r});
  if (r.ok && !r.value.menu) { menuGone=true; break; }
  await new Promise(r=>setTimeout(r,500));
}

console.log(JSON.stringify({
  updateDepth: errs.some(e=>/Maximum update depth/i.test(e)),
  errs: errs.slice(0,8),
  pre,
  clickErr,
  clickMs: Date.now()-clickStart,
  menuGone,
  post: post.slice(0,12),
  total: Date.now()-t0,
}, null, 2));
await browser.close().catch(()=>{});
process.exit(menuGone && !errs.some(e=>/Maximum update depth/i.test(e)) ? 0 : 2);
