# WASM Water Forces

Architecture decision: see [ADR_WASM_RAPIER_WATER_FORCES.md](./ADR_WASM_RAPIER_WATER_FORCES.md).

Watershed's native module lives in `emscripten/` — `common.h` / `forces.h` / `swe.h`
plus `forces.cpp` (water force math), `swe.cpp` (shallow-water solver + heap grids),
`chores.cpp` (optional gpu-chores; not SWE), `particles.cpp` (waterfall / splash SoA),
`routing.cpp` (channel routing),
and `bindings.cpp` (the plain C ABI, `extern "C" ws_*`; ABI `getVersion()` = 16,
`MIN_WASM_ABI_VERSION` = 16). The terrain tile (#487) is TypeScript-only since ABI 16.
It builds to:

- `public/watershed_native.js`
- `public/watershed_native.wasm`

Rebuild them (needs the pinned emcc — `bash scripts/emsdk-pinned.sh` once) with:

```bash
pnpm build:wasm
```

`pnpm build` does **not** rebuild them: the pair is committed and CI verifies it
(`pnpm build:full` runs both).

Threaded WASM remains opt-in because it needs COOP/COEP headers (it builds into
`emscripten/build-threads/out/` and never ships):

```bash
pnpm build:wasm:threads
```

## TypeScript Import

Load with `src/systems/water/wasmLoader.ts`; heap helpers live in `WatershedWasm.ts`:

```ts
import { getWasm } from '../systems/water/wasmLoader';
import { createWaterForceBatch } from '../systems/water/WatershedWasm';

const wasm = await getWasm();
const batch = createWaterForceBatch(wasm, 1);
batch.setSample(0, { position, velocity, flowDirection: { x: 0, z: -1 } });
batch.compute(config);
const force = batch.readResult(0);
batch.dispose();
```

`computeWaterForcesBatch` is the only force export since ABI 15 (the single-body
`calculateWaterForce` / `calculateBuoyancyAndDrag` / `computeBuoyancy` /
`computeDragForce` / `computeFlowForce` exports had no game caller). `GameHUD` banners a
native-init failure as `WASM FAILED` — it does not substitute a TypeScript number.

For a visible force scene, run the app with:

```txt
?wasmWaterTest=1&no-pointer-lock=1
```

This replaces the normal player vehicle with `WasmWaterForceTest`, a simple Rapier raft that receives one-sample `computeWaterForcesBatch` impulses every frame. The browser exposes the latest sample at `window.__watershedWasmWaterTest`.

## C++ Interface

Single raft force sample (forces.cpp, internal since ABI 15 — the batch calls it per sample):

```cpp
WaterForceResult calculateWaterForce(
  float posX, float posY, float posZ,
  float velX, float velY, float velZ,
  float flowDirX, float flowDirZ,
  float flowSpeed,
  float waterLevel,
  float raftMass,
  float raftVolume,
  float dragCoefficient,
  float frontalArea,
  float sideArea,
  float timeSeconds,
  float turbulenceStrength,
  float turbulenceFrequency
);
```

Batch worker ABI:

```cpp
void computeWaterForcesBatch(
  uintptr_t inputPtr,
  uintptr_t outputPtr,
  int sampleCount,
  float flowSpeed,
  float waterLevel,
  float raftMass,
  float raftVolume,
  float dragCoefficient,
  float frontalArea,
  float sideArea,
  float timeSeconds,
  float turbulenceStrength,
  float turbulenceFrequency
);
```

Input stride is 8 floats per sample:

```txt
[posX, posY, posZ, velX, velY, velZ, flowDirX, flowDirZ]
```

`flowDirX/Z` and the tick `flowSpeed` come from [`sampleSWEFlow.ts`](../../src/systems/water/sampleSWEFlow.ts)
(SWE `u,w`, dry speed 0, authored flowSpeed as a cap). The worker does not grow a
second water-force channel. `low` quality keeps authored `(0, −1) * flowSpeed`.

Output stride is 8 floats per sample:

```txt
[forceX, forceY, forceZ, buoyancy, drag, flow, turbulence, submergedRatio]
```

## Rapier Data Exchange

v1 uses postMessage orchestration plus persistent WASM heap buffers:

1. The main thread or Rapier worker lazy-loads `watershed_native.js`.
2. It allocates one input and one output float buffer with `createWaterForceBatch`.
3. Each frame, it writes compact raft samples into the input buffer.
4. C++ fills the output buffer.
5. Rapier receives force impulses as `force * dt`.

This avoids SharedArrayBuffer requirements and works with ordinary Vite preview/static hosting. SharedArrayBuffer plus Atomics is the v2 path only after deployment headers are guaranteed.

## Performance Budget

At 60 fps, keep native water force work under 0.5 ms per frame on mid-range desktop hardware.

Initial target:

- 1 player raft: 4 to 8 hull samples per frame.
- Small scene test: up to 16 floating objects.
- Upper v1 budget: 128 samples per frame before profiling.

The batch ABI is designed for many small samples, not full 3D fluid simulation.

## Biome Math Sketch

Slot canyon flow:

- `flowSpeed`: 4.0 to 7.0 m/s
- `turbulenceStrength`: 0.06 to 0.14
- Narrow cross-current pulses from `sin(time * freq + z * phase)`.
- High drag response so wall corrections and ferry angles matter.

Glacial melt:

- `flowSpeed`: 1.5 to 3.0 m/s
- `turbulenceStrength`: 0.02 to 0.06
- Lower broad momentum, sharper lateral instability can be layered later from ice-rock flow maps.

Both modes currently use:

- Archimedes buoyancy from displaced volume.
- Relative-current drag from flow velocity minus raft velocity.
- Velocity drag opposing raft motion.
- Deterministic turbulence seeded by position and time.

Rapier remains the rigid-body authority. WASM only computes water forces.
