# Watershed Renderer ↔ Material Contract

## Current Invariant

**`createGameRenderer()` always returns `THREE.WebGLRenderer` today.**

There is no live `WebGPURenderer` path. The `webgpu` renderer preference is a *deliberate no-op fallback* to `WebGLRenderer`. The production rendering pipeline is 100 % legacy GLSL/WebGL:

- `RiverShader.js` — `MeshStandardMaterial` with `onBeforeCompile` shader injection.
- `CanyonMaterial.js` — custom `ShaderMaterial`.
- `FlowingWater.jsx` — custom `ShaderMaterial`.
- Post-processing — GLSL passes from `postprocessing` / `@react-three/postprocessing`.

These materials are incompatible with `WebGPURenderer`/`NodeMaterial`/`TSL`. Routing them through a WebGPU backend produces crashes such as:

- `"c is not a constructor"` inside `setupLightsNode`.
- `"Cannot read properties of undefined (reading 'replace')"` during shader compile.

This fallback was established by emergency hot-fixes **PR #252** and **PR #253**.

## Material ↔ Renderer Compatibility Matrix

| Material | Production renderer | Works with `WebGLRenderer` | Works with `WebGPURenderer` | Notes |
|---|---|---|---|---|
| `RiverShader.js` (`MeshStandardMaterial` + `onBeforeCompile`) | Yes | **Yes** | **No** | Requires classic GLSL injection hooks. |
| `CanyonMaterial.js` (`ShaderMaterial`) | Yes | **Yes** | **No** | Pure GLSL; NodeMaterial cannot consume it. |
| `FlowingWater.jsx` (`ShaderMaterial`) | Yes | **Yes** | **No** | Same constraint as `CanyonMaterial`. |
| Post-processing GLSL passes | Yes | **Yes** | **No** | `postprocessing` v6 is WebGL2-only. |
| `RiverNodeMaterial.ts` (`MeshStandardNodeMaterial`) | **No** | Not applicable | Dormant migration seed for **#256** | Not wired into the live renderer; retained as a guard subject. |
| `CanyonNodeMaterial.ts` (`MeshBasicNodeMaterial`) | **No** | Not applicable | Dormant migration seed for **#256** | Not wired into the live renderer; retained as a guard subject. |

## Single Rule for the Future WebGPU Migration (#256)

When issue **#256** migrates the pipeline to `WebGPURenderer` / `NodeMaterial` / `TSL`:

> **Do not route legacy GLSL materials through `WebGPURenderer`.**
>
> Either replace every legacy material with its `NodeMaterial`/`TSL` equivalent first, or keep `createGameRenderer()` returning `WebGLRenderer` until the replacement is complete.

A partial migration that instantiates `WebGPURenderer` while `RiverShader.js`, `CanyonMaterial.js`, `FlowingWater.jsx`, or GLSL post-processing are still in use will reintroduce the crashes that PRs #252 and #253 fixed.

> **Note on `HeightmapFlow.ts`:** This module may use a separate `GPUDevice` for optional compute work, but it is **not** part of the renderer backend and does not change the contract above. Its output is consumed by the WebGL2 `FlowingWater.jsx` shader.

## Enforcement

The regression guard in `src/rendering/createRenderer.test.ts` locks this contract:

- Asserts `createGameRenderer({ preference: 'webgl' })` returns a `WebGLRenderer`.
- Asserts `createGameRenderer({ preference: 'webgpu' })` returns a `WebGLRenderer`.
- Constructs `RiverShader`, `CanyonMaterial`, and `RiverNodeMaterial`.
- Verifies the legacy materials can be prepared against the returned renderer without throwing a NodeMaterial-incompatibility error.
- If `createGameRenderer` is reverted to return a `WebGPURenderer`, the guard fails loudly.

## References

- `src/rendering/createRenderer.ts` — implementation of the fallback.
- `src/rendering/createRenderer.test.ts` — regression guard.
- Issue **#256** — future WebGPU/TSL migration (out of scope for this contract).
