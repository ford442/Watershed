import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
// The pair under test: public/ unless WATERSHED_NATIVE_DIR (repo-relative)
// names another, e.g. the Debug build in emscripten/build-debug/out.
const publicDir = resolve(scriptDir, '..', process.env.WATERSHED_NATIVE_DIR ?? 'public');
const wasmPath = resolve(publicDir, 'watershed_native.wasm');
const jsPath = pathToFileURL(resolve(publicDir, 'watershed_native.js')).href;
const wasmBinary = readFileSync(wasmPath);

if (!WebAssembly.validate(wasmBinary)) {
  throw new Error('watershed_native.wasm failed WebAssembly.validate');
}

// #454: the Rapier worker (and the #455 sim worker) load this same glue, so it
// must be built for ENVIRONMENT='web,worker'. A 'web'-only glue hard-codes the
// worker flag to false; a web,worker glue detects it at runtime (closure keeps
// the `typeof importScripts` probe but renames the variable, so match that).
const glueSource = readFileSync(resolve(publicDir, 'watershed_native.js'), 'utf8');
if (/ENVIRONMENT_IS_WORKER\s*=\s*false/.test(glueSource)
    || !/typeof importScripts/.test(glueSource)) {
  throw new Error("watershed_native.js is not built for ENVIRONMENT='web,worker' (worker detection missing)");
}

const { default: createWatershedNative } = await import(jsPath);

if (typeof createWatershedNative !== 'function') {
  throw new Error('watershed_native.js did not export createWatershedNative()');
}

let raw;
try {
  // The loader passes the fetched bytes as wasmBinary (#467); do the same here.
  raw = await createWatershedNative({ wasmBinary });
} catch (error) {
  const msg = error instanceof Error ? error.stack || error.message : String(error);
  throw new Error(`createWatershedNative() threw (js+wasm pair out of sync?): ${msg}`);
}

// Plain C ABI (#467): every export is Module._ws_<name>. This script stays
// independent of src/systems/water/wasmAbi.ts on purpose — it is the raw
// binary's check — so it binds by name here, and reads the three out-pointer
// results through a scratch block the same way.
if (typeof raw?._ws_getVersion !== 'function' || typeof raw?._ws_calculateWaterForce !== 'function') {
  throw new Error('createWatershedNative() resolved without the _ws_* C exports (getVersion / calculateWaterForce)');
}
const outPtr = raw._ws_allocateGrid(8);
const OUT_READERS = {
  calculateWaterForce: (f, i) => ({
    forceX: f[i], forceY: f[i + 1], forceZ: f[i + 2], buoyancy: f[i + 3],
    drag: f[i + 4], flow: f[i + 5], turbulence: f[i + 6], submergedRatio: f[i + 7],
  }),
  computeFlowForce: (f, i) => ({ x: f[i], y: f[i + 1], z: f[i + 2] }),
  routedEdgeState: (f, i) => ({ eta: f[i], speed: f[i + 1] }),
};
const U32_RESULTS = new Set(['initWaterfallParticles', 'stepWaterfallParticles']);
const wasm = new Proxy(raw, {
  get(target, name) {
    if (typeof name !== 'string' || name.startsWith('HEAP')) return target[name];
    const fn = target[`_ws_${name}`];
    if (typeof fn !== 'function') return undefined;
    if (OUT_READERS[name]) {
      return (...args) => {
        fn(...args, outPtr);
        return OUT_READERS[name](target.HEAPF32, outPtr >>> 2);
      };
    }
    if (U32_RESULTS.has(name)) return (...args) => fn(...args) >>> 0;
    return fn;
  },
});

const buoyancy = wasm.calculateBuoyancyAndDrag(150, 0.4, 0, -3);

if (!Number.isFinite(buoyancy) || buoyancy <= 0) {
  throw new Error(`Unexpected calculateBuoyancyAndDrag(): ${buoyancy}`);
}

const version = wasm.getVersion();
// ABI 12 is the plain C ABI (#467), 13 adds the terrain tile (#487) and 14
// lateral routing inflow + the surge event; the TypeScript binding table
// requires every export, so this floor is what catches a stale committed pair.
if (!Number.isInteger(version) || version < 14) {
  throw new Error(`Unexpected getVersion(): ${version} (need ABI >= 14)`);
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
        // ABI 8 (#397): a pulse carries downstream momentum too.
        w[idx] -= mag * step * wgt * 0.5;
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

  const wNat = heap.subarray(wNatPtr >> 2, (wNatPtr >> 2) + count);
  const wTs = heap.subarray(wTsPtr >> 2, (wTsPtr >> 2) + count);

  let maxCtl = 0;
  let maxNat = 0;
  let maxDiff = 0;
  let maxDownstream = 0;
  let maxDiffW = 0;
  for (let i = 0; i < count; i += 1) {
    maxDownstream = Math.min(maxDownstream, wNat[i]);
    maxDiffW = Math.max(maxDiffW, Math.abs(wNat[i] - wTs[i]));
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
  if (!(maxDownstream < -0.02)) {
    throw new Error(`applySWEEvent pulse carries no downstream momentum: w=${maxDownstream}`);
  }
  if (!(maxDiffW < 1e-5)) {
    throw new Error(`applySWEEvent w diverges from TS twin: maxDiffW=${maxDiffW}`);
  }
}

// --- ABI 9: scrollShallowWater keeps the moving window world-stable ---
// Additive export (MIN_WASM_ABI_VERSION stays 8), so only a version-9 binary is
// held to it. The kernel is pure data movement: it must match a plain JS
// reference exactly, and a splash must stay on its world cell while the window
// travels — including when the solver steps in between.
if (version >= 9) {
  if (typeof wasm.scrollShallowWater !== 'function') {
    throw new Error('ABI 9+ must export scrollShallowWater');
  }

  const alloc = (count) => wasm.allocateGrid(count);
  const view = (ptr, count) => wasm.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + count);

  // Reference: dst[x, z] = src[x - sx, z - sz]; leavers dropped, enterers = fill
  // (bed: nearest edge). Same saturation as the C++.
  function scrollRef(src, width, height, shiftX, shiftZ, fill, clampEdge) {
    const sx0 = Math.max(-width, Math.min(width, shiftX));
    const sz0 = Math.max(-height, Math.min(height, shiftZ));
    const out = new Float32Array(src.length);
    for (let z = 0; z < height; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const sx = x - sx0;
        const sz = z - sz0;
        let v = Math.fround(fill);
        if (sx >= 0 && sx < width && sz >= 0 && sz < height) {
          v = src[sz * width + sx];
        } else if (clampEdge) {
          v = src[Math.min(Math.max(sz, 0), height - 1) * width + Math.min(Math.max(sx, 0), width - 1)];
        }
        out[z * width + x] = v;
      }
    }
    return out;
  }

  // Kernel vs reference, bit for bit, across signs, saturation and inflow.
  {
    const width = 16;
    const height = 12;
    const count = width * height;
    const ptrs = { h: alloc(count), u: alloc(count), w: alloc(count), b: alloc(count) };
    const cases = [
      [3, -2, 0.05, 0.1, -0.2],
      [-5, 4, 0, 0, 0],
      [0, 7, 0.2, 0, 0],
      [width, 0, 0, 0, 0],
      [0, -height - 3, 0.1, 0.3, 0.4],
      [1 << 30, -(1 << 30), 0, 0, 0],
    ];
    for (const [sx, sz, eta, uIn, wIn] of cases) {
      const src = {};
      for (const key of ['h', 'u', 'w', 'b']) {
        const v = view(ptrs[key], count);
        for (let i = 0; i < count; i += 1) v[i] = Math.sin(i * 0.37 + key.charCodeAt(0));
        src[key] = Float32Array.from(v);
      }
      wasm.scrollShallowWater(ptrs.h, ptrs.u, ptrs.w, ptrs.b, width, height, sx, sz, eta, uIn, wIn);
      const want = {
        h: scrollRef(src.h, width, height, sx, sz, eta, false),
        u: scrollRef(src.u, width, height, sx, sz, uIn, false),
        w: scrollRef(src.w, width, height, sx, sz, wIn, false),
        b: scrollRef(src.b, width, height, sx, sz, 0, true),
      };
      for (const key of ['h', 'u', 'w', 'b']) {
        const got = view(ptrs[key], count);
        for (let i = 0; i < count; i += 1) {
          if (got[i] !== want[key][i]) {
            throw new Error(`scrollShallowWater(${sx}, ${sz}) plane ${key}[${i}]: got ${got[i]}, want ${want[key][i]}`);
          }
        }
      }
    }
    // Null bed: scrolls the field, does not touch (or dereference) the bed.
    for (const key of ['h', 'u', 'w']) view(ptrs[key], count).fill(0);
    view(ptrs.h, count)[5 * width + 5] = 0.3;
    const bBefore = Float32Array.from(view(ptrs.b, count));
    wasm.scrollShallowWater(ptrs.h, ptrs.u, ptrs.w, 0, width, height, 2, 1, 0, 0, 0);
    if (view(ptrs.h, count)[6 * width + 7] !== Math.fround(0.3)) {
      throw new Error('scrollShallowWater(+2, +1): the bump did not move to the higher column and row');
    }
    if (view(ptrs.b, count).some((v, i) => v !== bBefore[i])) {
      throw new Error('scrollShallowWater with bPtr=0 modified the bed');
    }
    for (const p of Object.values(ptrs)) wasm.freeGrid(p);
  }

  // A splash stays on its world cell while the window travels, and the moving
  // window tracks a fixed one through real solver steps.
  {
    const width = 32;
    const height = 24;
    const count = width * height;
    const dx = 0.75;
    const g = 9.80665;
    const H = 1;
    const mk = () => ({ h: alloc(count), u: alloc(count), w: alloc(count) });
    const fixed = mk();
    const moving = mk();
    const bump = (p) => {
      const h = view(p.h, count);
      for (let dz = -3; dz <= 3; dz += 1) {
        for (let dxc = -3; dxc <= 3; dxc += 1) {
          h[(12 + dz) * width + 16 + dxc] = 0.3 * Math.exp(-(dxc * dxc + dz * dz) / 3);
        }
      }
    };
    bump(fixed);
    bump(moving);

    let cellX = 0;
    let cellZ = 0;
    for (let step = 0; step < 18; step += 1) {
      if (step > 0 && step % 3 === 0) {
        cellX += 1;
        wasm.scrollShallowWater(moving.h, moving.u, moving.w, 0, width, height, -1, 0, 0, 0, 0);
      }
      if (step > 0 && step % 6 === 0) {
        cellZ -= 1;
        wasm.scrollShallowWater(moving.h, moving.u, moving.w, 0, width, height, 0, 1, 0, 0, 0);
      }
      wasm.stepShallowWater(fixed.h, fixed.u, fixed.w, 0, width, height, 0.01, g, dx, H);
      wasm.stepShallowWater(moving.h, moving.u, moving.w, 0, width, height, 0.01, g, dx, H);
    }
    const hF = view(fixed.h, count);
    const hM = view(moving.h, count);
    const uF = view(fixed.u, count);
    const uM = view(moving.u, count);
    let worst = 0;
    let peak = 0;
    let peakX = -1;
    let peakZ = -1;
    for (let j = 4; j < height - 4; j += 1) {
      for (let i = 4; i < width - 4; i += 1) {
        const fi = i + cellX;
        const fj = j + cellZ;
        if (fi < 4 || fi >= width - 4 || fj < 4 || fj >= height - 4) continue;
        worst = Math.max(worst, Math.abs(hM[j * width + i] - hF[fj * width + fi]), Math.abs(uM[j * width + i] - uF[fj * width + fi]));
        if (hM[j * width + i] > peak) {
          peak = hM[j * width + i];
          peakX = fi;
          peakZ = fj;
        }
      }
    }
    if (!(peak > 0.02)) {
      throw new Error(`scrolled splash vanished: peak=${peak}`);
    }
    if (Math.abs(peakX - 16) > 1 || Math.abs(peakZ - 12) > 1) {
      throw new Error(`scrolled splash drifted in world space: peak at (${peakX}, ${peakZ}), expected (16, 12)`);
    }
    if (!(worst < 1e-5)) {
      throw new Error(`scrolled window diverges from the fixed window: maxDiff=${worst}`);
    }
    for (const p of [fixed, moving]) {
      wasm.freeGrid(p.h);
      wasm.freeGrid(p.u);
      wasm.freeGrid(p.w);
    }
  }
}

// --- ABI 10: channel routing + the routed upstream edge ---------------------
// Same 20-segment chain and goldens as host_smoke.cpp §8, at the #404 1e-4
// relative tolerance. Both builds are IEEE -ffp-contract=off now; bit-for-bit
// host == wasm is nativeDigest.integration.test.ts (native_digest.h).
if (version >= 10) {
  for (const name of ['routeReach', 'routeReachSteady', 'routeReachTravelTime', 'routedEdgeState', 'stepShallowWaterInflow']) {
    if (typeof wasm[name] !== 'function') throw new Error(`ABI 10 must export ${name}`);
  }
  const closeTo = (actual, expected, label) => {
    const tol = Math.max(Math.abs(expected) * 1e-4, 1e-4);
    if (!(Math.abs(actual - expected) <= tol)) {
      throw new Error(`${label}: expected ${expected}, got ${actual}`);
    }
  };
  const view = (ptr, count) => wasm.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + count);
  const SEG = 20;
  const SUB = 4; // ROUTING_SUBREACHES
  const Q0 = 40;
  const RELEASE = 14;
  const DT = 1;
  const Lp = wasm.allocateGrid(SEG);
  const Sp = wasm.allocateGrid(SEG);
  const Bp = wasm.allocateGrid(SEG);
  const storageP = wasm.allocateGrid(SEG * SUB);
  const outP = wasm.allocateGrid(SEG);
  const lagP = wasm.allocateGrid(SEG);
  for (let k = 0; k < SEG; k += 1) {
    view(Lp, SEG)[k] = 95 + 2 * (k % 5);
    view(Sp, SEG)[k] = Math.fround(0.03 + Math.fround(0.005 * (k % 3)));
    view(Bp, SEG)[k] = 10 + (k % 4);
  }
  wasm.routeReachTravelTime(Lp, Sp, Bp, SEG, Q0, lagP);
  const lagFar = view(lagP, SEG)[SEG - 1];
  closeTo(lagFar, 264.890015, 'routing golden: far-segment lag (s)');

  wasm.routeReachSteady(Lp, Sp, Bp, SEG, Q0, storageP, outP);
  const steps = Math.trunc((3 * lagFar) / DT);
  let riseAtHalf = -1;
  let riseAtLag = -1;
  for (let t = 1; t <= steps; t += 1) {
    wasm.routeReach(Lp, Sp, Bp, SEG, Q0 + RELEASE, DT, storageP, outP);
    const rise = (view(outP, SEG)[SEG - 1] - Q0) / RELEASE;
    if (riseAtHalf < 0 && t * DT >= 0.5 * lagFar) riseAtHalf = rise;
    if (riseAtLag < 0 && t * DT >= 1.25 * lagFar) riseAtLag = rise;
  }
  if (!(riseAtHalf < 0.02)) throw new Error(`routing: release arrived before the lag (${riseAtHalf})`);
  closeTo(riseAtLag, 0.999229, 'routing golden: release fraction at 1.25 x lag');

  const rest = wasm.routedEdgeState(Q0, Q0, 1, 9.80665);
  if (rest.eta !== 0 || rest.speed !== 0) throw new Error(`routedEdgeState(Qref) not at rest: ${JSON.stringify(rest)}`);
  const high = wasm.routedEdgeState(Q0 + RELEASE, Q0, 1, 9.80665);
  closeTo(high.eta, 0.197293, 'routing golden: edge stage for +35% discharge');
  for (const p of [Lp, Sp, Bp, storageP, outP, lagP]) wasm.freeGrid(p);

  // Edge at the reference discharge over a bumpy, partly dry bed: η steps like
  // the transmissive solver (no invented slope) and the lake stays at rest.
  const W = 32;
  const Hh = 24;
  const N = W * Hh;
  const alloc = () => ({ h: wasm.allocateGrid(N), u: wasm.allocateGrid(N), w: wasm.allocateGrid(N), b: wasm.allocateGrid(N) });
  const edge = alloc();
  const trans = alloc();
  for (const g of [edge, trans]) {
    for (let z = 0; z < Hh; z += 1) {
      for (let x = 0; x < W; x += 1) {
        let bed = Math.max(0, Math.fround(1.4 - Math.fround(0.15 * Math.fround(Math.hypot(x - 16, z - 22)))));
        if (x < 3) bed = 1.6;
        view(g.b, N)[z * W + x] = bed;
        view(g.h, N)[z * W + x] = bed > 1 ? Math.fround(view(g.b, N)[z * W + x] - 1) : 0;
      }
    }
  }
  for (let t = 0; t < 400; t += 1) {
    wasm.stepShallowWaterInflow(edge.h, edge.u, edge.w, edge.b, W, Hh, 1 / 60, 9.80665, 0.75, 1, rest.eta);
    wasm.stepShallowWater(trans.h, trans.u, trans.w, trans.b, W, Hh, 1 / 60, 9.80665, 0.75, 1);
  }
  let etaDiff = 0;
  let maxVel = 0;
  for (let i = 0; i < N; i += 1) {
    etaDiff = Math.max(etaDiff, Math.abs(view(edge.h, N)[i] - view(trans.h, N)[i]));
    maxVel = Math.max(maxVel, Math.abs(view(edge.u, N)[i]), Math.abs(view(edge.w, N)[i]));
  }
  if (!(etaDiff < 1e-6)) throw new Error(`edge at Qref invents a slope: max |Δη| = ${etaDiff}`);
  if (!(maxVel < 2e-3)) throw new Error(`edge at Qref breaks lake-at-rest: max |v| = ${maxVel}`);

  // A raised edge stage enters from the high-row edge and moves downstream (−Z).
  for (const g of [edge]) {
    view(g.h, N).fill(0);
    view(g.u, N).fill(0);
    view(g.w, N).fill(0);
    view(g.b, N).fill(0);
  }
  for (let t = 0; t < 30; t += 1) {
    wasm.stepShallowWaterInflow(edge.h, edge.u, edge.w, edge.b, W, Hh, 1 / 60, 9.80665, 0.75, 1, high.eta);
  }
  const top = (Hh - 1) * W + W / 2;
  if (!(view(edge.h, N)[top] > 0.5 * high.eta)) throw new Error(`edge stage did not enter: η=${view(edge.h, N)[top]}`);
  if (!(view(edge.w, N)[top] < 0)) throw new Error(`edge inflow not downstream: w=${view(edge.w, N)[top]}`);
  if (!(Math.abs(view(edge.h, N)[W / 2]) < 1e-4)) throw new Error('edge stage reached the far edge too soon');
  for (const g of [edge, trans]) for (const p of [g.h, g.u, g.w, g.b]) wasm.freeGrid(p);
}

// --- ABI 11: pre-sized solver scratch; the heap never grows mid-step (#454) ---
if (version >= 11) {
  if (typeof wasm.reserveShallowWaterScratch !== 'function') {
    throw new Error('ABI 11 must export reserveShallowWaterScratch');
  }
  const INITIAL_MEMORY = 16 * 1024 * 1024;
  const heapBytes = () => wasm.HEAPF32.buffer.byteLength;
  if (heapBytes() !== INITIAL_MEMORY) {
    throw new Error(`INITIAL_MEMORY drifted: heap is ${heapBytes()} B, expected ${INITIAL_MEMORY}`);
  }
  // Largest SWE budget (sweQuality.ts `ultra`: 128 x 80). Step, inflow step and
  // scroll after the reserve must leave the heap byte length untouched.
  const W = 128;
  const Hh = 80;
  const N = W * Hh;
  const planes = [0, 1, 2, 3].map(() => wasm.allocateGrid(N));
  wasm.reserveShallowWaterScratch(W, Hh);
  const before = heapBytes();
  for (let t = 0; t < 4; t += 1) {
    wasm.stepShallowWater(planes[0], planes[1], planes[2], planes[3], W, Hh, 1 / 60, 9.80665, 0.75, 1);
    wasm.stepShallowWaterInflow(planes[0], planes[1], planes[2], planes[3], W, Hh, 1 / 60, 9.80665, 0.75, 1, 0.1);
    wasm.scrollShallowWater(planes[0], planes[1], planes[2], planes[3], W, Hh, 0, 1, 0, 0, 0);
  }
  if (heapBytes() !== before) {
    throw new Error(`heap grew during step/scroll after reserve: ${before} -> ${heapBytes()} B`);
  }
  for (const p of planes) wasm.freeGrid(p);
}

// --- ABI 13: terrain tiles (#487) ---------------------------------------------
// Same fixtures and goldens as emscripten/terrain_goldens.h (host) and
// src/terrain/__tests__/terrainFixtures.ts (TS mirror), here against the WASM build.
{
  const STRIDE = 9;
  const PLANES = 7;
  const fixtures = [
    {
      name: 'summer meander', args: [96, 35, 14, 40, 96, 0, 1, 0, 0, 0],
      channel: [
        7.4, 6.6, 4.9, 0.55, 0.06, -0.4, 1, -1, 0.95,
        7.9, 6.2, 4.9, 0.20, -0.10, 0.3, 1, -1, 1.05,
        6.8, 7.3, 4.9, -0.10, 0.12, 0.8, -1, 1, 1.14,
        6.1, 7.8, 4.9, 0.75, 0.02, -0.7, -1, 1, 0.92,
        7.0, 7.0, 4.9, 0.40, -0.05, -0.1, 1, -1, 0.99,
      ],
      golden: { absX: 35647.5, h: 19824.7554, bank: 2423, probes: [[1988, 0.214000002], [1998, 2.5464499], [2008, 24.8384438]] },
    },
    {
      name: 'slot canyon (collision grid)', args: [110, 24, 8, 10, 27, 1, 0, 0, 0, 0],
      channel: [
        4.6, 3.9, 3.2, 1.10, 0.08, -0.6, 1, -1, 0.93,
        4.1, 4.4, 3.2, 0.30, -0.12, 0.5, -1, 1, 1.09,
        3.9, 4.8, 3.2, 1.40, 0.15, -1.0, -1, 1, 0.88,
        4.4, 4.0, 3.2, -0.20, 0.00, 0.9, 1, -1, 1.16,
      ],
      golden: { absX: 2016.00003, h: 7131.92271, bank: 223, probes: [[148, -1.05444443], [151, 28.1923027], [153, 51.628479]] },
    },
    {
      name: 'glacial ice tube', args: [90, 25, 10, 40, 90, 0, 1, 1, 0.88, 9.5],
      channel: [
        5.2, 4.8, 3.5, 0.60, 0.04, -0.5, 1, -1, 0.94,
        4.6, 5.4, 3.5, 0.10, -0.08, 0.6, -1, 1, 1.11,
        5.0, 5.0, 3.5, 0.35, 0.10, 0.0, 1, -1, 1.00,
      ],
      golden: { absX: 17952.578, h: 18642.1421, bank: 2276, probes: [[1865, -0.105999999], [1848, 9.47856712], [1883, 9.68077946]] },
    },
  ];
  const close = (actual, expected, what) => {
    const tol = Math.max(Math.abs(expected) * 1e-5, 1e-4);
    if (!(Math.abs(actual - expected) <= tol)) throw new Error(`terrain golden ${what}: expected ${expected}, got ${actual}`);
  };
  for (const fx of fixtures) {
    const [, , , sx, sz] = fx.args;
    const n = (sx + 1) * (sz + 1);
    const count = fx.channel.length / STRIDE;
    const chPtr = wasm.allocateGrid(fx.channel.length);
    const outPtr = wasm.allocateGrid(n * PLANES);
    new Float32Array(wasm.HEAPF32.buffer, chPtr, fx.channel.length).set(fx.channel);
    const written = wasm.buildTerrainTile(...fx.args, chPtr, count, outPtr);
    if (written !== n) throw new Error(`buildTerrainTile(${fx.name}) returned ${written}, want ${n}`);
    const planes = new Float32Array(wasm.HEAPF32.buffer, outPtr, n * PLANES);
    let absX = 0;
    let h = 0;
    let bank = 0;
    for (let i = 0; i < n; i += 1) {
      absX += Math.abs(planes[i]);
      h += planes[n + i];
      bank += planes[2 * n + i];
    }
    close(absX, fx.golden.absX, `${fx.name} sum |X|`);
    close(h, fx.golden.h, `${fx.name} sum H`);
    close(bank, fx.golden.bank, `${fx.name} sum bank`);
    for (const [i, want] of fx.golden.probes) close(planes[n + i], want, `${fx.name} H[${i}]`);
    wasm.freeGrid(outPtr);
    wasm.freeGrid(chPtr);
  }
  // A degenerate path is rejected rather than written.
  const guardPtr = wasm.allocateGrid(PLANES * 4);
  if (wasm.buildTerrainTile(0, 30, 10, 1, 1, 0, 0, 0, 0, 0, 0, 0, guardPtr) !== 0) {
    throw new Error('buildTerrainTile accepted a zero-length path');
  }
  wasm.freeGrid(guardPtr);

  const shellPtr = wasm.allocateGrid(25 * 49);
  if (wasm.buildWallShell(96, 52.5, 24, 48, 0, 0, 7, shellPtr) !== 25 * 49) throw new Error('buildWallShell failed');
  const shell = new Float32Array(wasm.HEAPF32.buffer, shellPtr, 25 * 49);
  close(shell.reduce((a, v) => a + v, 0), 23614.6625, 'summer shell sum');
  close(shell[612], 15.238183, 'summer shell probe');
  wasm.freeGrid(shellPtr);
}

// --- ABI 14: lateral routing inflow + the surge event (#464 D) ---------------
// Same contract as host_smoke.cpp §8h / §8i: a zero lateral routes exactly as
// routeReach; runoff joining segment 2 never reaches 0 or 1; a surge band
// raises η and runs the water downstream (−Z) across the whole width.
if (version >= 14) {
  if (typeof wasm.routeReachLateral !== 'function') throw new Error('ABI 14 must export routeReachLateral');
  const SEG = 6;
  const view = (ptr, count) => wasm.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + count);
  const plane = (fill) => {
    const ptr = wasm.allocateGrid(SEG * 4);
    view(ptr, SEG * 4).fill(fill);
    return ptr;
  };
  const L = plane(100);
  const S = plane(0.03);
  const B = plane(10);
  const lateral = plane(0);
  const storeA = plane(0);
  const storeB = plane(0);
  const outA = plane(0);
  const outB = plane(0);
  wasm.routeReachSteady(L, S, B, SEG, 40, storeA, outA);
  wasm.routeReachSteady(L, S, B, SEG, 40, storeB, outB);
  for (let s = 0; s < 30; s += 1) {
    wasm.routeReach(L, S, B, SEG, 40, 1, storeA, outA);
    wasm.routeReachLateral(L, S, B, SEG, 40, lateral, 1, storeB, outB);
  }
  for (let k = 0; k < SEG; k += 1) {
    if (view(outA, SEG)[k] !== view(outB, SEG)[k]) throw new Error(`zero lateral differs from routeReach at ${k}`);
  }
  view(lateral, SEG)[2] = 20;
  for (let s = 0; s < 5; s += 1) wasm.routeReachLateral(L, S, B, SEG, 40, lateral, 1, storeB, outB);
  for (let s = 0; s < 5; s += 1) wasm.routeReach(L, S, B, SEG, 40, 1, storeA, outA);
  const a = view(outA, SEG);
  const b = view(outB, SEG);
  if (a[0] !== b[0] || a[1] !== b[1]) throw new Error('lateral at segment 2 moved the reaches above it');
  if (!(b[2] > a[2] + 0.1)) throw new Error(`lateral at segment 2 did not raise its outflow (${a[2]} → ${b[2]})`);
  for (const ptr of [L, S, B, lateral, storeA, storeB, outA, outB]) wasm.freeGrid(ptr);

  const W = 8;
  const H = 8;
  const hP = wasm.allocateGrid(W * H);
  const uP = wasm.allocateGrid(W * H);
  const wP = wasm.allocateGrid(W * H);
  const bP = wasm.allocateGrid(W * H);
  for (const ptr of [hP, uP, wP, bP]) view(ptr, W * H).fill(0);
  wasm.applySWEEvent(hP, uP, wP, bP, W, H, 1, 0, 0, 1, 4, 0, 3.5, 1, 0.3, 0.5);
  const h = view(hP, W * H);
  const w = view(wP, W * H);
  for (const x of [0, W - 1]) {
    if (!(h[3 * W + x] > 0.1) || !(w[3 * W + x] < 0)) throw new Error(`surge band missing at column ${x}`);
  }
  if (h[0] !== 0 || h[(H - 1) * W] !== 0) throw new Error('surge painted outside its band');
  for (const ptr of [hP, uP, wP, bP]) wasm.freeGrid(ptr);
}

console.log(`watershed_native smoke ok (buoyancy=${buoyancy.toFixed(2)} abi=${version})`);
