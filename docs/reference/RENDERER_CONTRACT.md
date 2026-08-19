# Watershed Renderer ↔ Material Contract

## Current Invariant

**On the default material backend, `createGameRenderer()` always returns `THREE.WebGLRenderer`.**

The `webgpu` renderer preference remains a *deliberate no-op fallback* to `WebGLRenderer`. The production rendering pipeline is 100 % legacy GLSL/WebGL:

- `RiverShader.ts` — `MeshStandardMaterial` with `onBeforeCompile` shader injection.
- `CanyonMaterial.js` — custom `ShaderMaterial`.
- `FlowingWater.tsx` — custom `ShaderMaterial`.
- Post-processing — GLSL passes from `postprocessing` / `@react-three/postprocessing`.

These materials are incompatible with `WebGPURenderer`/`NodeMaterial`/`TSL`. Routing them through a WebGPU backend produces crashes such as:

- `"c is not a constructor"` inside `setupLightsNode`.
- `"Cannot read properties of undefined (reading 'replace')"` during shader compile.

This fallback was established by emergency hot-fixes **PR #252** and **PR #253**.

### The one sanctioned exception: `?material=tsl` (#256 path A)

A node-capable renderer is created **only** when the material backend is `tsl`, i.e. when no legacy GLSL material will be built for the migrated surfaces. Two properties keep this from re-running the #252/#253 failure:

1. **Materials decide the renderer, not the other way round.** `materialBackend: 'tsl'` is what selects `WebGPURenderer`; there is no path where a legacy material meets a node renderer by default.
2. **`forceWebGL: true` unless WebGPU is explicitly requested.** The graphics API stays WebGL2, so only the material pipeline is under test.

Anything not yet migrated (VFX `ShaderMaterial`s, GLSL post-processing) is skipped by three with a non-fatal `NodeMaterial: Material "ShaderMaterial" is not compatible` log on that path. That is the tracking metric for the remaining migration: **the TSL path is finished when that log count reaches zero.**

## Material ↔ Renderer Compatibility Matrix

| Material | Production renderer | Works with `WebGLRenderer` | Works with `WebGPURenderer` | Notes |
|---|---|---|---|---|
| `RiverShader.ts` (`MeshStandardMaterial` + `onBeforeCompile`) | Yes | **Yes** | **No** | Requires classic GLSL injection hooks. |
| `CanyonMaterial.js` (`ShaderMaterial`) | Yes | **Yes** | **No** | Pure GLSL; NodeMaterial cannot consume it. |
| `FlowingWater.tsx` (`ShaderMaterial`) | Yes | **Yes** | **No** | Same constraint as `CanyonMaterial`. |
| Post-processing GLSL passes | Yes | **Yes** | **No** | `postprocessing` v6 is WebGL2-only. |
| `WaterNodeMaterial.ts` (`MeshBasicNodeMaterial`) | Opt-in `?material=tsl` | **No** | **Yes** | Water surface on the TSL backend. |
| `RiverNodeMaterial.ts` (`MeshStandardNodeMaterial`) | Opt-in `?material=tsl` | **No** | **Yes** | Canyon rock / river banks on the TSL backend. |
| `CanyonNodeMaterial.ts` (`MeshBasicNodeMaterial`) | Opt-in `?material=tsl` | **No** | **Yes** | Slot-canyon walls on the TSL backend. |

## Single Rule for the Future WebGPU Migration (#256)

When issue **#256** migrates the pipeline to `WebGPURenderer` / `NodeMaterial` / `TSL`:

> **Do not route legacy GLSL materials through `WebGPURenderer`.**
>
> Either replace every legacy material with its `NodeMaterial`/`TSL` equivalent first, or keep `createGameRenderer()` returning `WebGLRenderer` until the replacement is complete.

The material-host pattern is how that rule is enforced in code rather than by convention: each host (`materials/water/createWaterMaterial.ts`, `materials/river/createRiverSurfaceMaterial.ts`, `materials/canyon/createCanyonSurfaceMaterial.ts`) takes the backend as an argument and can only ever return a material valid for it. Adding a new material to the scene means adding a host, not a branch at the call site.

A partial migration that instantiates `WebGPURenderer` while `RiverShader.ts`, `CanyonMaterial.js`, `FlowingWater.tsx`, or GLSL post-processing are still in use will reintroduce the crashes that PRs #252 and #253 fixed.

> **Note on `HeightmapFlow.ts` and gpu-chores (#369):** Domain flow compute and chores **adopt** the renderer-owned session `GPUDevice` when Three's backend is native WebGPU. They never call `requestAdapter`/`requestDevice`. A WebGL2 session registers no compute device, so a GL context and a WebGPU device cannot both be live for HUD analysis. See [`GPU_CHORES.md`](./GPU_CHORES.md). HeightmapFlow is **not** part of the renderer backend and does not change the GLSL vs TSL contract above.

## Enforcement

The regression guard in `src/rendering/createRenderer.test.ts` locks this contract:

- Asserts `createGameRenderer({ preference: 'webgl' })` returns a `WebGLRenderer`.
- Asserts `createGameRenderer({ preference: 'webgpu' })` returns a `WebGLRenderer`.
- Asserts that omitting `materialBackend` — what production does — is identical to `'glsl'`.
- Constructs `RiverShader`, `CanyonMaterial`, and `RiverNodeMaterial`.
- Verifies the legacy materials can be prepared against the returned renderer without throwing a NodeMaterial-incompatibility error.
- If `createGameRenderer` is reverted to return a `WebGPURenderer` on the default path, the guard fails loudly.

A second block locks the path A contract: `materialBackend: 'tsl'` yields a `WebGPURenderer`, with `backend.isWebGPUBackend === false` unless `?renderer=webgpu` is also set, and the produced material backend is published to renderer diagnostics.

Host-level guards live in `src/materials/water/createWaterMaterial.test.ts` and `src/materials/materialHosts.test.ts`: identical uniform key sets across backends, `.value`-writability of every uniform, and GLSL fallback when the node module is missing or throws.

## References

- `src/rendering/createRenderer.ts` — implementation of the fallback.
- `src/rendering/createRenderer.test.ts` — regression guard.
- Issue **#256** / **#355** — TSL material path A (shipped). Out of scope for the GLSL default contract.
- Issue **#369** — gpu-chores (HUD helpers). Independent of this renderer contract.
