# Watershed Renderer ↔ Material Contract

## Current Invariant

**On the default material backend, `createGameRenderer()` always returns `THREE.WebGLRenderer`.**

The `webgpu` renderer preference remains a *deliberate no-op fallback* to `WebGLRenderer` on the default (`glsl`) material backend. Residual GLSL construction sites are listed in `scripts/glsl-hosts-allowlist.json`.

Live GLSL-only leftovers:

- Post-processing — Three r168 JSM `EffectComposer` (`PostProcessingPipeline.tsx`). Not `@react-three/postprocessing` (R3F v9 incompatibility). Skipped when `?material=tsl`.

Water / river / canyon / sky / weather / VFX / foliage / critters go through dual-path hosts. GLSL `onBeforeCompile` still exists behind those hosts for the WebGLRenderer product path.

These materials are incompatible with `WebGPURenderer`/`NodeMaterial`/`TSL`. Routing them through a WebGPU backend produces crashes such as:

- `"c is not a constructor"` inside `setupLightsNode`.
- `"Cannot read properties of undefined (reading 'replace')"` during shader compile.

This fallback was established by emergency hot-fixes **PR #252** and **PR #253**.

### The one sanctioned exception: `?material=tsl` (#256 path A)

A node-capable renderer is created **only** when the material backend is `tsl`, i.e. when no legacy GLSL material will be built for the migrated surfaces. Two properties keep this from re-running the #252/#253 failure:

1. **Materials decide the renderer, not the other way round.** `materialBackend: 'tsl'` is what selects `WebGPURenderer`; there is no path where a legacy material meets a node renderer by default.
2. **`forceWebGL: true` until `canEnableNativeWebgpu()`.** Native WebGPU stays closed while residual GLSL hosts remain and JSM post is unported. `?renderer=webgpu` + TSL does **not** flip the graphics API today.

The leftover-GLSL allowlist (`scripts/check-glsl-hosts.mjs`) is the tracking metric: **`residual` only shrinks** (new construction sites fail CI unless listed). **`dual`** GLSL branches remain for the default WebGL path. Scene-material TSL is finished when every live host is `dual` or `dormant` and **`PostProcessingPipeline.tsx` is the sole `residual`**; native WebGPU still waits on a post story after that.

## Material ↔ Renderer Compatibility Matrix

| Material | Production renderer | Works with `WebGLRenderer` | Works with `WebGPURenderer` | Notes |
|---|---|---|---|---|
| GLSL river/canyon/water factories | Yes (`glsl`) | **Yes** | **No** | Selected only when `materialBackend` is `glsl`. |
| Post-processing JSM composer | Yes (`glsl`) | **Yes** | **No** | Skipped on `?material=tsl`. |
| `WaterNodeMaterial` / `RiverNodeMaterial` / `CanyonNodeMaterial` | Opt-in TSL | **No** | **Yes** (WebGL2 backend today) | Path A hosts. |
| Sky / weather / VFX / foliage / critter NodeMaterials | Opt-in TSL | **No** | **Yes** (WebGL2 backend today) | Dual-path hosts; GLSL twins remain. |

## Single Rule for the Future WebGPU Migration (#256)

When issue **#256** migrates the pipeline to `WebGPURenderer` / `NodeMaterial` / `TSL`:

> **Do not route legacy GLSL materials through `WebGPURenderer`.**
>
> Either replace every legacy material with its `NodeMaterial`/`TSL` equivalent first, or keep `createGameRenderer()` returning `WebGLRenderer` until the replacement is complete.

The material-host pattern is how that rule is enforced in code rather than by convention: each host (`materials/water/createWaterMaterial.ts`, `materials/river/createRiverSurfaceMaterial.ts`, `materials/canyon/createCanyonSurfaceMaterial.ts`) takes the backend as an argument and can only ever return a material valid for it. Adding a new material to the scene means adding a host, not a branch at the call site.

A partial migration that instantiates native `WebGPURenderer` while residual GLSL hosts or JSM post-processing are still live will reintroduce the crashes that PRs #252 and #253 fixed.

> **Note on gpu-chores (#369) device sharing:** Chores **adopt** the renderer-owned session `GPUDevice` when Three's backend is native WebGPU. They never call `requestAdapter`/`requestDevice`. A WebGL2 session registers no compute device, so a GL context and a WebGPU device cannot both be live for HUD analysis. See [`GPU_CHORES.md`](./GPU_CHORES.md). gpu-chores are **not** part of the renderer backend and do not change the GLSL vs TSL contract above.

## Context attributes and live quality

`createGameRenderer()` no longer takes only `antialias` + `powerPreference`: when a caller passes `contextOptions`, `toContextAttributes()` supplies the full creation-time attribute set (`antialias`, `alpha`, `premultipliedAlpha`, `depth`, `stencil`, `failIfMajorPerformanceCaveat`, `powerPreference`, `logarithmicDepthBuffer`). Those attributes are spread **after** `canvasProps`, so the contract wins over R3F defaults while the caller's `preserveDrawingBuffer` (capture mode) survives.

Two rules follow, and both are locked by tests:

1. **Creation-time attributes are the only reason to remount the Canvas, and no quality preset can move one.** `rendererContextCreationKey()` serializes exactly that set; `buildCanvasIdentityKey()` composes the Canvas `key` from it plus renderer preference, material backend, and the context-loss epoch. The quality preset is not in the key, and since boot-time negotiation neither are `antialias`, `powerPreference`, or `failIfMajorPerformanceCaveat` — they come from the session's frozen `GraphicsEnvelope`. **Every** quality transition, `low` ↔ `ultra` included, keeps Physics, `TrackManager`, and the vehicle mounted.
2. **Everything else is applied live, including the recompile.** `applyRendererQualityUpdate()` re-applies tone mapping, color space, and shadow configuration on the existing renderer, and marks scene materials `needsUpdate` when the shadow configuration changed — THREE's `needsProgramChange` does not track `shadowMap.type`, so without that the old programs keep drawing. `SceneLighting` disposes the sun's shadow render target so a new `mapSize` takes effect.

`failIfMajorPerformanceCaveat` is decided by the boot probe, not by the preset: on when the strict probe attempt succeeded (a real GPU), off when only the relaxed attempt did. The probe requests the *same* attribute object `THREE.WebGLRenderer` will (`rendererContextAttributesFor()`), so a green probe means a green renderer. Headless CI and the visual-smoke harness run on SwiftShader and skip the probe entirely through `isSoftwareRendererAllowed()` (`?screenshot=1` / `?capture=1` / `?softwareGl=1`), pinning `CAPTURE_ENVELOPE`; production never does. See [`RENDERER.md`](./RENDERER.md#boot-time-graphics-negotiation).

Every Canvas consumes this contract, including the Level Editor (`deriveEditorContextOptions()`). A new Canvas that hand-rolls its `gl` prop is a contract violation, not a shortcut.

## Enforcement

The regression guard in `src/rendering/createRenderer.test.ts` locks this contract:

- Asserts `createGameRenderer({ preference: 'webgl' })` returns a `WebGLRenderer`.
- Asserts `createGameRenderer({ preference: 'webgpu' })` returns a `WebGLRenderer`.
- Asserts that omitting `materialBackend` — what production does — is identical to `'glsl'`.
- Constructs `RiverShader`, `CanyonMaterial`, and `RiverNodeMaterial`.
- Verifies the legacy materials can be prepared against the returned renderer without throwing a NodeMaterial-incompatibility error.
- If `createGameRenderer` is reverted to return a `WebGPURenderer` on the default path, the guard fails loudly.

A third block locks the context-attribute and live-quality contract:

- `createRenderer.test.ts` spies on `getContext` and asserts the derived attributes reach the context request, that the degraded and capture envelopes both request `failIfMajorPerformanceCaveat: false`, that the renderer's request matches `rendererContextAttributesFor()` attribute for attribute, and that `preserveDrawingBuffer` from the caller is not clobbered.
- `probeGraphicsCapability.test.ts` covers the three tiers with a stubbed `getContext`, asserts every probe context is released, and asserts capture mode pins its envelope without probing.
- `App.graphicsBoot.test.tsx` asserts the Canvas and the world mount exactly once across `low` ↔ `ultra`, that an unsupported tier mounts neither, and that the boot-crash guard clamps to `low`.
- `deriveRendererContextOptions.test.ts` asserts the pinned attributes per preset, that `toContextAttributes()` contains no live-applicable property, that the creation attributes are identical for all four presets given an envelope, and that `buildCanvasIdentityKey()` is identical across every preset but differs for a renderer/material change and for the epoch.
- `applyRendererContextOptions.test.ts` asserts materials are invalidated on a shadow-configuration change and left alone when only DPR moves.

A second block locks the path A contract: `materialBackend: 'tsl'` yields a `WebGPURenderer` with `backend.isWebGPUBackend === false` even when `preference: 'webgpu'`, until `canEnableNativeWebgpu()` is true. `createGameRenderer({ preference: 'webgpu', materialBackend: 'glsl' })` still returns `WebGLRenderer`.

Host-level guards live in `src/materials/water/createWaterMaterial.test.ts` and `src/materials/materialHosts.test.ts`: identical uniform key sets across backends, `.value`-writability of every uniform, and GLSL fallback when the node module is missing or throws.

## References

- `src/rendering/createRenderer.ts` — implementation of the fallback.
- `src/rendering/nativeWebgpuGate.ts` — native WebGPU stays closed until residual GLSL hosts are gone and post is ported.
- `scripts/check-glsl-hosts.mjs` — residual GLSL construction budget.
- Issue **#256** / **#355** — TSL material path A (shipped). Out of scope for the GLSL default contract.
- Issue **#369** — gpu-chores (HUD helpers). Independent of this renderer contract.
- `src/rendering/deriveRendererContextOptions.ts` — context attributes, creation key, Canvas identity key.
- `src/rendering/RendererQualitySync.tsx` — live quality apply inside the Canvas.
- `docs/reference/RENDERER.md` — the quality matrix and the live-vs-remount table.

Unchanged by this work: `logarithmicDepthBuffer` stays `false`, and there is still **no WebGPU-required boot** — `?renderer=webgpu` remains the documented no-op fallback on the default material backend ([#370](https://github.com/ford442/Watershed/issues/370) is a separate research probe). The WebGL rescue path is intact.
