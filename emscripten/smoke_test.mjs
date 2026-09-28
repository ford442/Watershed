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
// Same 20-segment chain and goldens as host_smoke.cpp §8. The host build uses
// -ffp-contract=off, this binary -ffast-math: the 1e-4 relative tolerance is
// the #404 rule. If they ever diverge, pin -ffp-contract=off on routing.cpp.
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

console.log(`watershed_native smoke ok (buoyancy=${buoyancy.toFixed(2)} abi=${version})`);
