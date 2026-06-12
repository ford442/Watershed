import puppeteer from 'puppeteer';
import fs from 'fs';
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
// wait longer for swiftshader to render frames
for (let i=0;i<6;i++){
  await new Promise(r=>setTimeout(r,5000));
  const px=await page.evaluate(()=>{
    const c=document.querySelector('canvas'); if(!c)return null;
    const gl=c.getContext('webgl2'); if(!gl)return null;
    const p=new Uint8Array(4); gl.readPixels(640,360,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p); return Array.from(p);
  });
  console.log('after',(i+1)*5,'s center pixel:',px);
  await page.screenshot({path:`/content/watershed/ingame_delay_${(i+1)*5}s.png`});
}
await browser.close();
