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
// Manually set camera via useThree store if accessible, or via scene traversal
const info=await page.evaluate(()=>{
  const c=document.querySelector('canvas');
  let r3f=c?c.__r3f:null;
  let state=null;
  if(r3f&&r3f.root&&r3f.root.store){try{state=r3f.root.store.getState();}catch(e){}}
  if(!state && r3f&&r3f.store){try{state=r3f.store.getState();}catch(e){}}
  let camera=state?state.camera:null;
  if(camera){
    camera.position.set(0, 20, 20);
    camera.lookAt(0, 0, -20);
    camera.updateProjectionMatrix();
  }
  // Also try to access via window stores
  if(!camera && window.__THREE__ && window.__THREE__.cameras && window.__THREE__.cameras.length){
    camera=window.__THREE__.cameras[0];
    camera.position.set(0,20,20);
    camera.lookAt(0,0,-20);
  }
  return {cameraSet:!!camera, pos:camera?{x:camera.position.x,y:camera.position.y,z:camera.position.z}:null};
});
console.log('manual camera:', JSON.stringify(info));
await new Promise(r=>setTimeout(r,2000));
await page.screenshot({path:'/content/watershed/screenshot_manual_cam.png'});
const px=await page.evaluate(()=>{
  const c=document.querySelector('canvas');
  const gl=c.getContext('webgl2');
  const p=new Uint8Array(4); gl.readPixels(640,360,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p); return Array.from(p);
});
console.log('center pixel:', px);
await browser.close();
