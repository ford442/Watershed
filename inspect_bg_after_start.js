import puppeteer from 'puppeteer';
const args=['--no-sandbox','--headless=new','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-gpu-rasterization','--enable-zero-copy','--disable-search-engine-choice-screen','--ash-no-nudges','--no-first-run','--disable-features=Translate','--no-default-browser-check','--window-size=1280,720','--hide-scrollbars'];
const browser=await puppeteer.launch({headless:'new',ignoreDefaultArgs:true,executablePath:'/usr/bin/google-chrome',args});
const page=await browser.newPage();
await page.setViewport({width:1280,height:720});
await page.goto('http://localhost:3000?renderer=webgl&no-pointer-lock=1',{waitUntil:'load',timeout:60000});
await page.waitForFunction(()=>document.body.innerText.length>0,{timeout:30000});
await new Promise(r=>setTimeout(r,3000));
const before=await page.evaluate(()=>{
  return {bodyBg:getComputedStyle(document.body).backgroundColor, htmlBg:getComputedStyle(document.documentElement).backgroundColor};
});
console.log('before click:', before);
await page.evaluate(()=>{
  const candidates=Array.from(document.querySelectorAll('button,[role="button"],a')).filter(el=>/start|play|begin/i.test(el.innerText||el.textContent||''));
  if(candidates.length)candidates[0].click();
});
await new Promise(r=>setTimeout(r,5000));
const after=await page.evaluate(()=>{
  const c=document.querySelector('canvas');
  return {
    bodyBg:getComputedStyle(document.body).backgroundColor,
    htmlBg:getComputedStyle(document.documentElement).backgroundColor,
    canvasBg:c?getComputedStyle(c).backgroundColor:null,
    canvasAlpha:c?c.getContext('webgl2').getContextAttributes().alpha:null,
  };
});
console.log('after click:', after);
await browser.close();
