# WASM Water Forces

Architecture decision: see [ADR_WASM_RAPIER_WATER_FORCES.md](./ADR_WASM_RAPIER_WATER_FORCES.md).

Watershed's first native module lives in `emscripten/main.cpp` and builds to:

- `public/watershed_native.js`
- `public/watershed_native.wasm`

Run:

```bash
npm run build:wasm
```

The normal production build also runs the single-threaded WASM build first:

```bash
npm run build
```

Threaded WASM remains opt-in because it needs COOP/COEP headers:

```bash
npm run build:wasm:threads
```

## TypeScript Import

Use `src/systems/WatershedWasm.ts`:

```ts
import { getWasm, createWaterForceBatch } from '../systems/WatershedWasm';

const wasm = await getWasm();
const smoke = wasm.calculateBuoyancyAndDrag(150, 0.4, 0, -3);
console.info('[Watershed WASM]', smoke);
```

`GameHUD` runs that hello-world call on load and prints the result to the browser console. It also shows a small `WASM READY` or `WASM FALLBACK` HUD line.

For a visible force scene, run the app with:

```txt
?wasmWaterTest=1&no-pointer-lock=1
```

This replaces the normal player vehicle with `WasmWaterForceTest`, a simple Rapier raft that receives `calculateWaterForce(...)` impulses every frame. The browser exposes the latest sample at `window.__watershedWasmWaterTest`.

## C++ Interface

Scalar smoke test:

```cpp
extern "C" float calculateBuoyancyAndDrag(
  float raftMass,
  float submergedVolume,
  float waterVelocityX,
  float waterVelocityZ
);
```

Single raft force sample:

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
