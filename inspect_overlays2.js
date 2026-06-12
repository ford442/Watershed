import puppeteer from 'puppeteer';
const args=['--no-sandbox','--headless=new','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-gpu-rasterization','--enable-zero-copy','--disable-search-engine-choice-screen','--ash-no-nudges','--no-first-run','--disable-features=Translate','--no-default-browser-check','--window-size=1280,720','--hide-scrollbars'];
const browser=await puppeteer.launch({headless:'new',ignoreDefaultArgs:true,executablePath:'/usr/bin/google-chrome',args});
const page=await browser.newPage();
await page.setViewport({width:1280,height:720});
await page.goto('http://localhost:3000?renderer=webgl&no-pointer-lock=1',{waitUntil:'load',timeout:60000});
await page.waitForFunction(()=>document.body.innerText.length>0,{timeout:30000});
await new Promise(r=>setTimeout(r,3000));
await page.evaluate(()=>{
  const candidates=Array.from(document.querySelectorAll('button,[role="button"],a')).filter(el=>/start|play|begin/i.test(el.innerText||el.textContent||''));
  if(candidates.length)candidates[0].click();
});
await new Promise(r=>setTimeout(r,5000));
const info=await page.evaluate(()=>{
  const elems=Array.from(document.querySelectorAll('*')).map(el=>{
    const rect=el.getBoundingClientRect();
    const style=getComputedStyle(el);
    return {
      tag:el.tagName,
      id:el.id,
      class:el.className,
      rect:{x:rect.x,y:rect.y,w:rect.width,h:rect.height},
      bg:style.backgroundColor,
      opacity:style.opacity,
      zIndex:style.zIndex,
    };
  }).filter(e=>e.rect.w>100 && e.rect.h>100 && (e.bg.includes('255') || e.bg.includes('rgba(0, 0, 0, 0)')===false));
  return elems;
});
console.log(JSON.stringify(info,null,2));
await browser.close();
