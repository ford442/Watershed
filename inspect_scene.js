import puppeteer from 'puppeteer';
const args=['--no-sandbox','--headless=new','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-gpu-rasterization','--enable-zero-copy','--disable-search-engine-choice-screen','--ash-no-nudges','--no-first-run','--disable-features=Translate','--no-default-browser-check','--window-size=1280,720','--hide-scrollbars'];
const browser=await puppeteer.launch({headless:'new',ignoreDefaultArgs:true,executablePath:'/usr/bin/google-chrome',args});
const page=await browser.newPage();
page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
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
  const c=document.querySelector('canvas');
  const gl=c.getContext('webgl2');
  // Find Three.js scene by inspecting __r3f or renderer
  let scene=null, renderer=null;
  for (const key in window) {
    const obj=window[key];
    if (obj && obj.isScene) scene=obj;
    if (obj && obj.isWebGLRenderer) renderer=obj;
  }
  // Also try to find via DOM
  let r3f=c.__r3f;
  return {
    canvasSize:{w:c.width,h:c.height},
    glParams: gl ? { vendor:gl.getParameter(gl.VENDOR), renderer:gl.getParameter(gl.RENDERER), version:gl.getParameter(gl.VERSION), alpha:gl.getContextAttributes().alpha } : null,
    sceneFound:!!scene,
    sceneBg: scene && scene.background ? scene.background.getHexString() : null,
    sceneFog: scene && scene.fog ? {color:scene.fog.color.getHexString(), near:scene.fog.near, far:scene.fog.far} : null,
    rendererFound:!!renderer,
    r3f:!!r3f,
    pixel: gl ? (()=>{const p=new Uint8Array(4); gl.readPixels(640,360,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p); return Array.from(p);})() : null,
    glError: gl ? gl.getError() : null,
    children: scene ? scene.children.length : null,
  };
});
console.log(JSON.stringify(info,null,2));
await browser.close();
