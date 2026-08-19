# gpu-chores (#369)

Generic image/grid helpers for HUD stats, minimap thumbs, and debug viz.
**Not** a rewrite of shallow-water, heightmap flow, or TSL water materials.

Watershed is **Tier B** of the cross-app rollout. Chromashift [#132](https://github.com/ford442/Chromashift/issues/132) / PR [#139](https://github.com/ford442/Chromashift/pull/139) is the hist-reference facade (`runJob`, backend order, adopt-device, `?no_gpu_compute`, breadcrumbs).

## Three layers

| Layer | What it is | Device |
|-------|------------|--------|
| **Domain hydrology** | WASM SWE (`WaterForceSystem` → `DataTexture`) and dormant `heightmap_flow.wgsl` | CPU WASM. Flow WGSL runs only if a session `GPUDevice` already exists. |
| **TSL path** | NodeMaterial shading via `?material=tsl` | Three `WebGPURenderer` with WebGL2 on the wire, or real WebGPU if `?renderer=webgpu` too. **Shading, not a sim.** |
| **Chores** | `grid-reduce`, `luma-histogram`, `downsample-2d`, `separable-blur` | Adopt the renderer/flow session device when it is native WebGPU; else WASM → JS. |

One sim backend per heightfield. Do not mount HeightmapFlow next to live SWE/TSL water. Do not port SWE into chores.

## Backend order

```
webgpu  →  wasm  →  ts
```

- **WebGPU** is registered only when Three's backend is real WebGPU (`renderer.backend.isWebGPUBackend`) **and** `?no_gpu_compute` is absent. The kit **never** calls `requestAdapter` / `requestDevice`.
- A default WebGL2 session registers **no** webgpu lane, so a GL context and a compute device cannot both be live for one job.
- **WASM** is optional ABI 5 (`emscripten/chores.cpp`). Missing exports make the lane decline. `MIN_WASM_ABI_VERSION` stays **4** so older binaries still load for water forces.
- **JS** (`src/rendering/gpuChores/cpuMath.ts`) is the terminal lane. Goldens pin it.
- WebGL2 FBO chores are out of scope.

`runJob({ prefer: 'auto' })` walks the order. A pinned `prefer` never slides to another lane (parity tests depend on that). Failures are never silent: `{ ok: false, reason, attempts }`.

## Kill switch and breadcrumbs

| Item | Role |
|------|------|
| `?no_gpu_compute` | Closes the WebGPU **chore / HeightmapFlow-compute** lane only. WASM water and WASM/TS chores keep working. Playing does **not** require this flag. |
| `window.gpuComputeAvailable` / `gpuComputeReason` | Support verdict for the WebGPU lane. |
| `window.gpuComputeDiagnostics` | Adapter vendor/arch/device + compute limits (defensive; never throws in bootstrap). |
| `window.gpuChoreBackend` / `gpuChoreReason` | Which lane served the last job, or why none did. |

Chrome or Edge missing WebGPU → chores WASM (or TS); water stays on its existing TSL/WebGL or WASM fallback.

## Module map

`src/rendering/gpuChores/` — next to the renderer, not under `systems/water/`.

| File | Role |
|------|------|
| `types.ts` / `runtime.ts` / `support.ts` | Kit API, `runJob`, kill switch, breadcrumbs |
| `device.ts` | Session `GPUDevice` adopt/get/reset |
| `webgpuBackend.ts` + `kernels.wgsl.ts` | Adopted-device compute; workgroups `(64)` reduce, `(8,8)` 2D |
| `cpuBackend.ts` / `cpuMath.ts` | WASM + TS lanes |
| `watershedHost.ts` | **Only** file that imports `WatershedWasm` |
| `heightfield.ts` / `statsStore.ts` | SWE `grid.h` consumer + DebugPanel bus |

`HeightmapFlow.ts` adopts `getSessionGpuDevice()` and no longer requests its own device.

## Live consumer

After each SWE step, `WaterForceSystem` calls `runHeightfieldChores(grid.h, …)` on the CPU heap view (no GPU upload just to reduce ~768–2560 floats). DebugPanel (`?debug=1`) shows min/mean/max, chore backend, a downsampled height thumb, and a 256-bin histogram sparkline.

## Tests

- `src/rendering/gpuChores/runtime.test.ts` — fallback order, pinned prefer, no silent skip
- `src/rendering/gpuChores/support.test.ts` — kill switch names itself
- `src/rendering/gpuChores/reduceParity.test.ts` — committed 8×8 reduce/hist goldens; optional `WATERSHED_WASM_INTEGRATION=1` native parity
- `src/shaders/HeightmapFlow.test.ts` — no `requestDevice`

These are **numerical goldens**, not visual-smoke pixelmatch.

## Related

- [`RENDERER.md`](./RENDERER.md) / [`RENDERER_CONTRACT.md`](./RENDERER_CONTRACT.md) — renderer vs TSL vs chores
- [`WASM.md`](../../WASM.md) — optional ABI 5 chore exports
- Issue [#369](https://github.com/ford442/Watershed/issues/369). **#370** (WebGPU-required hard-fail boot) is a separate epic and must not become default boot.
