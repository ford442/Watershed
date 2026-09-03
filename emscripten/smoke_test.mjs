import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(scriptDir, '../public');
const wasmPath = resolve(publicDir, 'watershed_native.wasm');
const jsPath = pathToFileURL(resolve(publicDir, 'watershed_native.js')).href;
const wasmBinary = readFileSync(wasmPath);

if (!WebAssembly.validate(wasmBinary)) {
  throw new Error('watershed_native.wasm failed WebAssembly.validate');
}

const { default: createWatershedNative } = await import(jsPath);

if (typeof createWatershedNative !== 'function') {
  throw new Error('watershed_native.js did not export createWatershedNative()');
}

let wasm;
try {
  wasm = await createWatershedNative({
    instantiateWasm: (imports, receiveInstance) => {
      WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) => {
        receiveInstance(instance);
      });
      return {};
    },
  });
} catch (error) {
  const msg = error instanceof Error ? error.stack || error.message : String(error);
  throw new Error(
    `createWatershedNative() threw (js+wasm pair out of sync or Embind failed): ${msg}`,
  );
}

if (typeof wasm?.calculateWaterForce !== 'function' || typeof wasm?.getVersion !== 'function') {
  throw new Error(
    'createWatershedNative() resolved without Embind exports (calculateWaterForce / getVersion)',
  );
}

const buoyancy = wasm.calculateBuoyancyAndDrag(150, 0.4, 0, -3);

if (!Number.isFinite(buoyancy) || buoyancy <= 0) {
  throw new Error(`Unexpected calculateBuoyancyAndDrag(): ${buoyancy}`);
}

const version = wasm.getVersion();
// ABI 6 changed stepShallowWater's arity (bed pointer). A binary older than
// that cannot be driven by the current TypeScript at all, so this floor is what
// catches a stale committed public/watershed_native.wasm.
if (!Number.isInteger(version) || version < 8) {
  throw new Error(`Unexpected getVersion(): ${version} (need ABI >= 8)`);
}

if (typeof wasm.applySWEEvent !== 'function') {
  throw new Error('ABI 8+ must export applySWEEvent');
}

if (version >= 7) {
  if (typeof wasm.allocateParticleSoA !== 'function'
      || typeof wasm.initWaterfallParticles !== 'function'
      || typeof wasm.stepWaterfallParticles !== 'function'
      || typeof wasm.stepSplashParticles !== 'function'
      || typeof wasm.freeParticleSoA !== 'function') {
    throw new Error('ABI 7+ must export particle SoA (allocate/init/step/free)');
  }
  const cap = 32;
  const ptr = wasm.allocateParticleSoA(cap);
  if (!ptr) {
    throw new Error('allocateParticleSoA returned 0');
  }
  let seed = wasm.initWaterfallParticles(ptr, cap, cap, 15, 25, 5, 0, 0xC0FFEE);
  seed = wasm.stepWaterfallParticles(ptr, cap, cap, 1 / 60, 15, 25, 5, seed);
  if (!Number.isFinite(seed) || seed === 0) {
    throw new Error(`Unexpected particle seed: ${seed}`);
  }
  const heap = wasm.HEAPF32;
  const base = ptr >> 2;
  for (let i = 0; i < cap; i += 1) {
    const x = heap[base + i];
    const y = heap[base + cap + i];
    const z = heap[base + 2 * cap + i];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`particle ${i} not finite after step`);
    }
  }
  wasm.freeParticleSoA(ptr);
}

const archimedes = wasm.computeBuoyancy(1, 1000, 9.80665);
if (!Number.isFinite(archimedes) || Math.abs(archimedes - 9806.65) > 0.1) {
  throw new Error(`Unexpected computeBuoyancy(): ${archimedes}`);
}

if (typeof wasm.reduceF32Grid === 'function') {
  const count = 64;
  const srcPtr = wasm.allocateGrid(count);
  const outPtr = wasm.allocateGrid(3);
  const binsPtr = wasm.allocateGrid(256);
  const heap = wasm.HEAPF32;
  const srcBase = srcPtr >> 2;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      heap[srcBase + y * 8 + x] = x * 0.1 + y * 0.01;
    }
  }
  wasm.reduceF32Grid(srcPtr, count, outPtr);
  const min = heap[outPtr >> 2];
  const max = heap[(outPtr >> 2) + 1];
  const mean = heap[(outPtr >> 2) + 2];
  if (Math.abs(min - 0) > 1e-4 || Math.abs(max - 0.77) > 1e-4 || Math.abs(mean - 0.385) > 1e-4) {
    throw new Error(`Unexpected reduceF32Grid(): min=${min} max=${max} mean=${mean}`);
  }
  wasm.histogramF32(srcPtr, count, 0, 0.77, binsPtr);
  let histCount = 0;
  const binsBase = binsPtr >> 2;
  for (let i = 0; i < 256; i += 1) {
    histCount += wasm.HEAP32[binsBase + i] >>> 0;
  }
  if (histCount !== 64) {
    throw new Error(`Unexpected histogramF32 count: ${histCount}`);
  }
  wasm.freeGrid(srcPtr);
  wasm.freeGrid(outPtr);
  wasm.freeGrid(binsPtr);
}

// --- Nonlinear SWE: lake at rest over a bed bump must not generate current ---
// The host goldens (emscripten/host_smoke.cpp) assert this against the native
// build; repeating it here proves the *compiled wasm* behaves identically.
{
  const width = 24;
  const height = 16;
  const count = width * height;
  const H = 1.0;
  const dx = 0.5;

  const hPtr = wasm.allocateGrid(count);
  const uPtr = wasm.allocateGrid(count);
  const wPtr = wasm.allocateGrid(count);
  const bPtr = wasm.allocateGrid(count);
  const heap = wasm.HEAPF32;
  const hBase = hPtr >> 2;
  const uBase = uPtr >> 2;
  const wBase = wPtr >> 2;
  const bBase = bPtr >> 2;

  // Flat free surface (h = 0) over a bed bump.
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const fx = (x - width / 2) / 5;
      const fz = (z - height / 2) / 4;
      heap[bBase + z * width + x] = 0.6 * H * Math.exp(-(fx * fx + fz * fz));
    }
  }

  for (let step = 0; step < 30; step += 1) {
    wasm.stepShallowWater(hPtr, uPtr, wPtr, bPtr, width, height, 0.01, 9.80665, dx, H);
  }

  let maxVel = 0;
  for (let i = 0; i < count; i += 1) {
    const depth = H + heap[hBase + i] - heap[bBase + i];
    if (depth <= 1e-4) continue;  // dry cells are pinned, not at rest
    maxVel = Math.max(maxVel, Math.abs(heap[uBase + i]), Math.abs(heap[wBase + i]));
  }

  wasm.freeGrid(hPtr);
  wasm.freeGrid(uPtr);
  wasm.freeGrid(wPtr);
  wasm.freeGrid(bPtr);

  if (!(maxVel < 1e-5)) {
    throw new Error(`SWE not well-balanced: lake at rest produced |v|=${maxVel}`);
  }
}

// --- ABI 8: applySWEEvent inflow pulse matches the TypeScript twin ---
{
  const HYDRO_KIND_INFLOW = 0;
  const width = 8;
  const height = 8;
  const count = width * height;
  const dx = 1;
  const originX = 0;
  const originZ = 0;
  const stillDepth = 1.2;
  const cx = 3.5;
  const cz = 3.5;
  const radius = 4;
  const strength = 8;
  const dt = 0.05;

  function applySWEEventFallbackTs(h, u, w, b) {
    const r = Math.max(0.5, radius);
    const r2 = r * r;
    const mag = Math.max(0, strength);
    const step = Math.max(0, dt);
    for (let j = 0; j < height; j += 1) {
      const wz = originZ + j * dx;
      const dz = wz - cz;
      for (let i = 0; i < width; i += 1) {
        const wx = originX + i * dx;
        const dxw = wx - cx;
        const d2 = dxw * dxw + dz * dz;
        if (d2 > r2) continue;
        const dist = Math.sqrt(d2);
        const wgt = 1 - dist / r;
        const idx = j * width + i;
        h[idx] += mag * step * wgt;
      }
    }
  }

  const hCtlPtr = wasm.allocateGrid(count);
  const uCtlPtr = wasm.allocateGrid(count);
  const wCtlPtr = wasm.allocateGrid(count);
  const bCtlPtr = wasm.allocateGrid(count);
  const hNatPtr = wasm.allocateGrid(count);
  const uNatPtr = wasm.allocateGrid(count);
  const wNatPtr = wasm.allocateGrid(count);
  const bNatPtr = wasm.allocateGrid(count);
  const hTsPtr = wasm.allocateGrid(count);
  const uTsPtr = wasm.allocateGrid(count);
  const wTsPtr = wasm.allocateGrid(count);
  const bTsPtr = wasm.allocateGrid(count);

  const heap = wasm.HEAPF32;
  const hNat = heap.subarray(hNatPtr >> 2, (hNatPtr >> 2) + count);
  const hTs = heap.subarray(hTsPtr >> 2, (hTsPtr >> 2) + count);
  const hCtl = heap.subarray(hCtlPtr >> 2, (hCtlPtr >> 2) + count);

  wasm.applySWEEvent(
    hNatPtr, uNatPtr, wNatPtr, bNatPtr,
    width, height, dx, originX, originZ, stillDepth,
    HYDRO_KIND_INFLOW, cx, cz, radius, strength, dt,
  );

  applySWEEventFallbackTs(hTs, heap.subarray(uTsPtr >> 2, (uTsPtr >> 2) + count),
    heap.subarray(wTsPtr >> 2, (wTsPtr >> 2) + count),
    heap.subarray(bTsPtr >> 2, (bTsPtr >> 2) + count));

  let maxCtl = 0;
  let maxNat = 0;
  let maxDiff = 0;
  for (let i = 0; i < count; i += 1) {
    maxCtl = Math.max(maxCtl, Math.abs(hCtl[i]));
    maxNat = Math.max(maxNat, hNat[i]);
    maxDiff = Math.max(maxDiff, Math.abs(hNat[i] - hTs[i]));
  }

  wasm.freeGrid(hCtlPtr);
  wasm.freeGrid(uCtlPtr);
  wasm.freeGrid(wCtlPtr);
  wasm.freeGrid(bCtlPtr);
  wasm.freeGrid(hNatPtr);
  wasm.freeGrid(uNatPtr);
  wasm.freeGrid(wNatPtr);
  wasm.freeGrid(bNatPtr);
  wasm.freeGrid(hTsPtr);
  wasm.freeGrid(uTsPtr);
  wasm.freeGrid(wTsPtr);
  wasm.freeGrid(bTsPtr);

  if (!(maxCtl < 1e-6)) {
    throw new Error(`applySWEEvent control eta not at rest: max=${maxCtl}`);
  }
  if (!(maxNat > 0.05)) {
    throw new Error(`applySWEEvent inflow pulse too weak: max=${maxNat}`);
  }
  if (!(maxDiff < 1e-5)) {
    throw new Error(`applySWEEvent diverges from TS twin: maxDiff=${maxDiff}`);
  }
}

console.log(`watershed_native smoke ok (buoyancy=${buoyancy.toFixed(2)} abi=${version})`);
