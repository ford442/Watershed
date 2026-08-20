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
// ABI 6 changed stepShallowWater's arity (bed pointer). A binary older than
// that cannot be driven by the current TypeScript at all, so this floor is what
// catches a stale committed public/watershed_native.wasm.
if (!Number.isInteger(version) || version < 6) {
  throw new Error(`Unexpected getVersion(): ${version} (need ABI >= 6)`);
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

console.log(`watershed_native smoke ok (buoyancy=${buoyancy.toFixed(2)} abi=${version})`);
