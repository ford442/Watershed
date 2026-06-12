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
  const canvas=document.querySelector('canvas');
  const body=document.body;
  const html=document.documentElement;
  const overlays=Array.from(document.querySelectorAll('*')).filter(el=>{
    const rect=el.getBoundingClientRect();
    return rect.width>1000 && rect.height>500 && el!==canvas && el!==body && el!==html;
  }).map(el=>({tag:el.tagName,class:el.className,id:el.id,style:el.getAttribute('style'),rect:el.getBoundingClientRect().toJSON(),zIndex:getComputedStyle(el).zIndex,background:getComputedStyle(el).background}));
  return {
    canvas: canvas?{width:canvas.width,height:canvas.height,style:canvas.getAttribute('style'),rect:canvas.getBoundingClientRect().toJSON(),zIndex:getComputedStyle(canvas).zIndex,background:getComputedStyle(canvas).background}:null,
    bodyBg:getComputedStyle(body).background,
    htmlBg:getComputedStyle(html).background,
    overlays
  };
});
console.log(JSON.stringify(info,null,2));
await page.screenshot({path:'/content/watershed/inspect_ingame_swift.png'});
await browser.close();
