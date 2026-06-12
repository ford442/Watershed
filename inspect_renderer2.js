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
await new Promise(r=>setTimeout(r,8000));
const info=await page.evaluate(()=>{
  const c=document.querySelector('canvas');
  let r3f=c?c.__r3f:null;
  let state=null;
  if(r3f&&r3f.root&&r3f.root.store){try{state=r3f.root.store.getState();}catch(e){}}
  if(!state && r3f&&r3f.store){try{state=r3f.store.getState();}catch(e){}}
  let scene=state?state.scene:null;
  let renderer=state?state.gl:null;
  let camera=state?state.camera:null;
  return {
    hasR3f:!!r3f,
    hasState:!!state,
    sceneFound:!!scene,
    rendererFound:!!renderer,
    cameraFound:!!camera,
    sceneBg: scene&&scene.background ? (scene.background.isColor?scene.background.getHexString():typeof scene.background) : null,
    sceneFog: scene&&scene.fog ? {type:scene.fog.type||scene.fog.constructor.name,color:scene.fog.color.getHexString()} : null,
    sceneChildren: scene?scene.children.length:null,
    rendererInfo: renderer ? {calls:renderer.info.render.calls,frame:renderer.info.render.frame,programs:renderer.info.programs?.length,triangles:renderer.info.render.triangles} : null,
    rendererSize: renderer ? {w:renderer.domElement.width,h:renderer.domElement.height} : null,
    cameraPos: camera ? {x:camera.position.x,y:camera.position.y,z:camera.position.z} : null,
  };
});
console.log(JSON.stringify(info,null,2));
await browser.close();
