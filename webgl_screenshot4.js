import puppeteer from 'puppeteer';
for (const angle of ['vulkan','gl','default']) {
  const args=['--no-sandbox','--headless=new','--enable-unsafe-webgpu','--ignore-gpu-blocklist','--enable-gpu-rasterization','--disable-software-rasterizer','--window-size=1280,720'];
  if (angle==='vulkan') { args.push('--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface'); }
  else if (angle==='gl') { args.push('--use-angle=gl'); }
  console.log('=== testing angle:', angle, '===');
  const browser=await puppeteer.launch({headless:'new',ignoreDefaultArgs:true,executablePath:'/usr/bin/google-chrome',args});
  const page=await browser.newPage();
  page.on('console', msg => console.log(angle, msg.type(), msg.text()));
  page.on('pageerror', err => console.log(angle, 'PAGEERROR:', err.message));
  await page.setViewport({width:1280,height:720});
  await page.goto('http://localhost:8090/webgl_test.html',{waitUntil:'networkidle0',timeout:30000});
  await new Promise(r=>setTimeout(r,500));
  await page.screenshot({path:`/tmp/webgl_test_${angle}.png`});
  console.log('saved /tmp/webgl_test_' + angle + '.png');
  await browser.close();
}
