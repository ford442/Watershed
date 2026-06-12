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
await new Promise(r=>setTimeout(r,10000));
const info=await page.evaluate(()=>{
  // Find three.js renderer by looking through all objects
  let renderer=null;
  const find=(obj,depth=0)=>{
    if(depth>10)return;
    if(obj && obj.isWebGLRenderer){renderer=obj; return;}
    if(typeof obj!=='object' || !obj)return;
    for(const k of Object.keys(obj)){
      if(k==='parent'||k==='children'&&Array.isArray(obj[k]))continue;
      try{find(obj[k],depth+1);}catch(e){}
      if(renderer)return;
    }
  };
  find(window);
  if(!renderer){
    // Try canvas __r3f
    const c=document.querySelector('canvas');
    if(c&&c.__r3f)find(c.__r3f);
  }
  return {
    rendererFound:!!renderer,
    info: renderer ? {calls:renderer.info.render.calls,frames:renderer.info.render.frame,programs:renderer.info.programs?.length} : null,
    size: renderer ? renderer.getSize(new (window.THREE?.Vector2||Object)({})) : null,
    alpha: renderer ? renderer.getContextAttributes().alpha : null,
    clearColor: renderer ? renderer.getClearColor(new (window.THREE?.Color||Object)({})).getHexString() : null,
  };
});
console.log(JSON.stringify(info,null,2));
await browser.close();
