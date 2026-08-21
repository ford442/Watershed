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

const wasm = await createWatershedNative({
  instantiateWasm: (imports, receiveInstance) => {
    WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) => {
      receiveInstance(instance);
    });
    return {};
  },
});

const buoyancy = wasm.calculateBuoyancyAndDrag(150, 0.4, 0, -3);

if (!Number.isFinite(buoyancy) || buoyancy <= 0) {
  throw new Error(`Unexpected calculateBuoyancyAndDrag(): ${buoyancy}`);
}

const version = wasm.getVersion();
if (!Number.isInteger(version) || version < 4) {
  throw new Error(`Unexpected getVersion(): ${version}`);
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

// Nonlinear SWE (ABI 6+): a flat pool over a bed step must stay put and must
// not produce negative depths. Skipped on older binaries.
if (typeof wasm.stepShallowWaterBed === 'function') {
  const w = 16;
  const h = 12;
  const cells = w * h;
  const hPtr = wasm.allocateGrid(cells);
  const uPtr = wasm.allocateGrid(cells);
  const wPtr = wasm.allocateGrid(cells);
  const bPtr = wasm.allocateGrid(cells);
  const heap = wasm.HEAPF32;
  const surface = 1;
  for (let i = 0; i < cells; i += 1) {
    const bed = (i % w) < w / 2 ? 0 : 0.4;
    heap[(bPtr >> 2) + i] = bed;
    heap[(hPtr >> 2) + i] = surface - bed;
  }
  for (let step = 0; step < 10; step += 1) {
    wasm.stepShallowWaterBed(hPtr, uPtr, wPtr, bPtr, w, h, 1 / 60, 9.80665, 0.5, 1);
  }
  let maxVel = 0;
  let minDepth = Infinity;
  for (let i = 0; i < cells; i += 1) {
    maxVel = Math.max(maxVel, Math.abs(heap[(uPtr >> 2) + i]), Math.abs(heap[(wPtr >> 2) + i]));
    minDepth = Math.min(minDepth, heap[(hPtr >> 2) + i]);
  }
  if (!(maxVel < 1e-2) || !(minDepth >= 0)) {
    throw new Error(`Unexpected stepShallowWaterBed(): maxVel=${maxVel} minDepth=${minDepth}`);
  }
  wasm.freeGrid(hPtr);
  wasm.freeGrid(uPtr);
  wasm.freeGrid(wPtr);
  wasm.freeGrid(bPtr);
}

console.log(`watershed_native smoke ok (buoyancy=${buoyancy.toFixed(2)} abi=${version})`);
