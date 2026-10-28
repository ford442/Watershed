
var createWatershedNative = (() => {
  var _scriptDir = import.meta.url;
  
  return (
function(moduleArg = {}) {

var c=moduleArg,g,p;c.ready=new Promise((a,b)=>{g=a;p=b});var r=Object.assign({},c),t="object"==typeof window,u="function"==typeof importScripts,v="",y;if(t||u)u?v=self.location.href:"undefined"!=typeof document&&document.currentScript&&(v=document.currentScript.src),_scriptDir&&(v=_scriptDir),v.startsWith("blob:")?v="":v=v.substr(0,v.replace(/[?#].*/,"").lastIndexOf("/")+1),u&&(y=a=>{var b=new XMLHttpRequest;b.open("GET",a,!1);b.responseType="arraybuffer";b.send(null);return new Uint8Array(b.response)});
var z=console.error.bind(console);Object.assign(c,r);r=null;var A;c.wasmBinary&&(A=c.wasmBinary);var B,C=!1,D=[],E=[],F=[],G=0,H=null,I=null;function J(a){a="Aborted("+a+")";z(a);C=!0;a=new WebAssembly.RuntimeError(a+". Build with -sASSERTIONS for more info.");p(a);throw a;}var K=a=>a.startsWith("data:application/octet-stream;base64,"),L;if(c.locateFile){if(L="watershed_native.wasm",!K(L)){var M=L;L=c.locateFile?c.locateFile(M,v):v+M}}else L=(new URL("watershed_native.wasm",import.meta.url)).href;
function N(a){if(a==L&&A)return new Uint8Array(A);if(y)return y(a);throw"both async and sync fetching of the wasm failed";}function O(a){return A||!t&&!u||"function"!=typeof fetch?Promise.resolve().then(()=>N(a)):fetch(a,{credentials:"same-origin"}).then(b=>{if(!b.ok)throw`failed to load wasm binary file at '${a}'`;return b.arrayBuffer()}).catch(()=>N(a))}function P(a,b,d){return O(a).then(e=>WebAssembly.instantiate(e,b)).then(d,e=>{z(`failed to asynchronously prepare wasm: ${e}`);J(e)})}
function Q(a,b){var d=L;return A||"function"!=typeof WebAssembly.instantiateStreaming||K(d)||"function"!=typeof fetch?P(d,a,b):fetch(d,{credentials:"same-origin"}).then(e=>WebAssembly.instantiateStreaming(e,a).then(b,function(f){z(`wasm streaming compile failed: ${f}`);z("falling back to ArrayBuffer instantiation");return P(d,a,b)}))}
var R={a:()=>{J("")},b:()=>!1},S=function(){var a={a:R};G++;Q(a,function(b){S=b.instance.exports;B=S.c;b=B.buffer;new Int8Array(b);new Int16Array(b);c.HEAPU8=new Uint8Array(b);new Uint16Array(b);c.HEAP32=new Int32Array(b);new Uint32Array(b);c.HEAPF32=new Float32Array(b);new Float64Array(b);new BigInt64Array(b);new BigUint64Array(b);E.unshift(S.d);G--;0==G&&(null!==H&&(clearInterval(H),H=null),I&&(b=I,I=null,b()))}).catch(p);return{}}();c._ws_getVersion=()=>(c._ws_getVersion=S.e)();
c._ws_computeWaterForcesBatch=(a,b,d,e,f,h,k,l,m,n,q,w,x)=>(c._ws_computeWaterForcesBatch=S.f)(a,b,d,e,f,h,k,l,m,n,q,w,x);c._ws_stepShallowWater=(a,b,d,e,f,h,k,l,m,n)=>(c._ws_stepShallowWater=S.g)(a,b,d,e,f,h,k,l,m,n);c._ws_stepShallowWaterInflow=(a,b,d,e,f,h,k,l,m,n,q)=>(c._ws_stepShallowWaterInflow=S.h)(a,b,d,e,f,h,k,l,m,n,q);c._ws_applySWEEvent=(a,b,d,e,f,h,k,l,m,n,q,w,x,V,W,X)=>(c._ws_applySWEEvent=S.i)(a,b,d,e,f,h,k,l,m,n,q,w,x,V,W,X);
c._ws_scrollShallowWater=(a,b,d,e,f,h,k,l,m,n,q)=>(c._ws_scrollShallowWater=S.j)(a,b,d,e,f,h,k,l,m,n,q);c._ws_reserveShallowWaterScratch=(a,b)=>(c._ws_reserveShallowWaterScratch=S.k)(a,b);c._ws_allocateGrid=a=>(c._ws_allocateGrid=S.l)(a);c._ws_freeGrid=a=>(c._ws_freeGrid=S.m)(a);c._ws_routeReach=(a,b,d,e,f,h,k,l)=>(c._ws_routeReach=S.n)(a,b,d,e,f,h,k,l);c._ws_routeReachLateral=(a,b,d,e,f,h,k,l,m)=>(c._ws_routeReachLateral=S.o)(a,b,d,e,f,h,k,l,m);
c._ws_routeReachSteady=(a,b,d,e,f,h,k)=>(c._ws_routeReachSteady=S.p)(a,b,d,e,f,h,k);c._ws_routeReachTravelTime=(a,b,d,e,f,h)=>(c._ws_routeReachTravelTime=S.q)(a,b,d,e,f,h);c._ws_routedEdgeState=(a,b,d,e,f)=>(c._ws_routedEdgeState=S.r)(a,b,d,e,f);c._ws_buildTerrainTile=(a,b,d,e,f,h,k,l,m,n,q,w,x)=>(c._ws_buildTerrainTile=S.s)(a,b,d,e,f,h,k,l,m,n,q,w,x);c._ws_buildWallShell=(a,b,d,e,f,h,k,l)=>(c._ws_buildWallShell=S.t)(a,b,d,e,f,h,k,l);c._ws_reduceF32Grid=(a,b,d)=>(c._ws_reduceF32Grid=S.u)(a,b,d);
c._ws_histogramF32=(a,b,d,e,f)=>(c._ws_histogramF32=S.v)(a,b,d,e,f);c._ws_lumaHistogramU8=(a,b,d)=>(c._ws_lumaHistogramU8=S.w)(a,b,d);c._ws_downsampleF32=(a,b,d,e,f,h)=>(c._ws_downsampleF32=S.x)(a,b,d,e,f,h);c._ws_blurSeparableF32=(a,b,d,e)=>(c._ws_blurSeparableF32=S.y)(a,b,d,e);c._ws_allocateParticleSoA=a=>(c._ws_allocateParticleSoA=S.z)(a);c._ws_freeParticleSoA=a=>(c._ws_freeParticleSoA=S.A)(a);c._ws_initWaterfallParticles=(a,b,d,e,f,h,k,l)=>(c._ws_initWaterfallParticles=S.B)(a,b,d,e,f,h,k,l);
c._ws_stepWaterfallParticles=(a,b,d,e,f,h,k,l)=>(c._ws_stepWaterfallParticles=S.C)(a,b,d,e,f,h,k,l);c._ws_stepSplashParticles=(a,b,d,e,f,h)=>(c._ws_stepSplashParticles=S.D)(a,b,d,e,f,h);var T;I=function U(){T||Y();T||(I=U)};function Y(){if(!(0<G)){for(;0<D.length;)D.shift()(c);if(!(0<G||T||(T=!0,c.calledRun=!0,C))){for(;0<E.length;)E.shift()(c);for(g(c);0<F.length;)F.shift()(c)}}}Y();


  return moduleArg.ready
}
);
})();
export default createWatershedNative;
export const WATERSHED_WASM_SHA = "e75f7bbc2255f133";
