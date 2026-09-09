# Renderer — WebGL2-only with adaptive quality presets

Watershed's **production** renderer is `THREE.WebGLRenderer`. The `?renderer=webgpu` URL parameter is accepted for compatibility and testing, but on the default material backend it falls back to WebGL2 and does **not** instantiate `WebGPURenderer`.

Since #256 path A there is a second, opt-in path: `?material=tsl` builds NodeMaterial/TSL materials, which require a node-capable renderer. See [Material backends](#material-backends-256-path-a).

Graphics quality presets (`low` / `medium` / `high` / `ultra` from `GameState.settings.quality`, synced via `SettingsSync` → `LODManager`) drive the most expensive WebGL context knobs: device pixel ratio, antialiasing, shadow mode, shadow map size, tone mapping, and output color space.

Most of that now applies **live**. The Canvas `key` carries only what genuinely needs a fresh WebGL context — renderer preference, material backend, the creation-only context attributes, and the context-loss epoch — so `medium` ↔ `high` ↔ `ultra` mid-run keeps Rapier, the 7-segment treadmill, the WASM SWE grids, audio, and the vehicle body alive. See [Live quality apply](#live-quality-apply).

## Quality → renderer context matrix

Derived by the pure function `deriveRendererContextOptions()` in `src/rendering/deriveRendererContextOptions.ts` and applied at Canvas creation in `App.tsx` + `createGameRenderer()`.

| Preset | DPR clamp `[1, max]` | Shadows | Shadow map size | Notes |
|--------|----------------------|---------|-----------------|-------|
| `low` | `1.0` | off | — | Minimal GPU cost |
| `medium` | `1.25` | basic | 1024 | |
| `high` | `2` | soft (PCF) | 2048 | **Default look** — matches pre-contract Canvas defaults (`dpr [1,2]`, `shadows="soft"`) |
| `ultra` | `min(devicePixelRatio, 2.0)` | soft (PCF) | 2048 (1×) / 4096 (≥2×) | Native DPR up to the `ULTRA_DPR_CEILING` |

Antialias, `powerPreference`, and `failIfMajorPerformanceCaveat` are deliberately **not** in this table. They are creation-time attributes: negotiated once at boot, frozen for the session, identical for every preset — see [Boot-time graphics negotiation](#boot-time-graphics-negotiation).

**`ultra` DPR ceiling.** `ULTRA_DPR_CEILING = 2.0` (`deriveRendererContextOptions.ts`). `ultra` used to render at the display's native `devicePixelRatio`, uncapped — on a 3× phone or a 4× external panel that is 9–16× the pixel work of DPR 1, enough to miss the 60 FPS / 16.67 ms budget on hardware that is otherwise comfortably an `ultra` machine. 2.0 is shipping practice (≤2.0 desktop, 1.5–2.0 mobile): DPR 2 is the full retina win, and 3–4× panels are a fill-rate trap rather than a quality tier. Raising it is a performance decision, not a tuning nit: move the constant, this row, and the test that pins it together. The shadow-map step still keys off the *raw* `devicePixelRatio`, so a 3× display keeps its 4096 map.

**DPR cap ≠ render scale.** Two different knobs, and Watershed only has the first. The **cap** is a static ceiling: the most pixels a preset will ever ask for. A **render scale** is a valve: it moves with measured frame time and trades resolution for headroom while the game runs. Adaptive quality currently steps *presets*, not resolution, so there is no valve; adding one is separate work. Do not raise the cap as a substitute — a machine that is dropping frames needs resolution to come *down* under load, not the ceiling to move up.

All presets set `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, and `toneMappingExposure = 1.0` at renderer setup via `applyRendererContextOptions()`, and re-apply them on every preset change via `applyRendererQualityUpdate()`.

### Pinned context attributes

These do not vary by preset (`SHARED_CONTEXT_ATTRIBUTES`, in `src/rendering/contextAttributes.ts` so the probe and the renderer can share them without an import cycle), but they are pinned rather than left to THREE's defaults so a version bump cannot move them silently:

| Attribute | Value | Why |
|-----------|-------|-----|
| `alpha` | `false` | Opaque game view. THREE r168 always *requests* the GL context with `alpha: true`, so this drives `WebGLBackground` — the drawing buffer is cleared fully opaque instead of letting the page show through. |
| `premultipliedAlpha` | `true` | Not just compositing: `WebGLState.setBlending` picks premultiplied blend functions from this flag, so every transparent material in the game (splash, water, weather, VFX) is authored against `true`. Flipping it would change how all of them blend. |
| `depth` | `true` | Required by every 3D pass and by SSAO. THREE default. |
| `stencil` | `true` | **Not** THREE's default (off since r163). Enabled for the post stack's mask/outline passes. |
| `failIfMajorPerformanceCaveat` | boot-negotiated | Whatever the successful probe attempt asked for, replayed on the real context. `true` on a hardware machine (software GL must not silently boot and read as a shipped GPU), `false` on a degraded one and for the capture harness. Never preset-dependent. |
| `antialias` / `powerPreference` | boot-negotiated | Frozen for the session by the probe — `true` / `high-performance` on hardware, `false` / `default` in safe mode. |
| `logarithmicDepthBuffer` | `false` | See below. |
| `desynchronized` | not set | THREE r168's `WebGLRenderer` never forwards it to `getContext`, so setting it would be decoration. It is also the wrong trade here: it can tear and reorders readback, which `?screenshot=1` depends on. |

**Software-GL opt-out.** Visual smoke and CI run headless Chromium on SwiftShader, which *is* a major performance caveat — with the check on, the context request fails and the harness captures a black canvas. `isSoftwareRendererAllowed()` turns the check off for `?screenshot=1` / `?capture=1` (every visual-smoke shot already carries one) and for an explicit `?softwareGl=1`. Production never sets it.

## Boot-time graphics negotiation

**The context envelope is negotiated once, before R3F and Rapier mount, and frozen for the session.** `negotiateBootGraphics()` (`src/rendering/probeGraphicsCapability.ts`) runs in `App` before `<Canvas>` is rendered and returns a tier, an envelope, and the browser's own `statusMessage` if it gave one.

| Tier | How it is reached | Envelope | What the player sees |
|------|-------------------|----------|----------------------|
| `hardware` | the strict request succeeded (`failIfMajorPerformanceCaveat: true`, `high-performance`) | antialias on, `high-performance`, caveat check on | Nothing — normal boot |
| `degraded` | that failed; the relaxed request (`failIfMajorPerformanceCaveat: false`, `powerPreference: 'default'`) succeeded | antialias off, `default`, caveat check off | Persistent **Safe Graphics Mode** badge |
| `unsupported` | neither produced a context | — | Static DOM screen; **no Canvas, no Rapier, no game** |

**The probe asks exactly what the renderer will ask.** `rendererContextAttributesFor(envelope)` reproduces three r168's own attribute object — `alpha: true` (three hardcodes it), `depth`, `stencil`, `antialias`, `premultipliedAlpha`, `preserveDrawingBuffer`, `powerPreference`, `failIfMajorPerformanceCaveat` — and asks for `webgl2` only. This is load-bearing: a probe that requests *less* than the renderer can pass and then let the real request throw out of the `gl` factory, which is the original bug with extra latency. A test in `createRenderer.test.ts` pins the two attribute sets together.

Each attempt runs on a throwaway `<canvas>` and releases its context immediately with `WEBGL_lose_context` — browsers cap live contexts per origin (8–16) and a leaked probe costs the game a slot for the whole session. The `webglcontextcreationerror` listener is attached before `getContext`, because `statusMessage` is the only real diagnostic the platform hands out.

When both attempts fail, one more bare `getContext('webgl2')` runs purely to classify the failure — the same distinction three draws between *"Error creating WebGL context with your selected attributes."* and *"Error creating WebGL context."*. It changes what the unsupported screen says (`attributes-rejected` vs `no-context`), not what happens next.

### Why not retry-and-remount

The obvious alternative ("catch the constructor throw, retry once at `low`") is rejected:

1. **A retry cannot know why it failed.** THREE wraps context creation in a generic `Error`. Hardware acceleration disabled, a blocklisted driver, a dead GPU process, headless, and the per-origin context limit are indistinguishable from an actual performance caveat, and only one of those is fixed by retrying at `low`.
2. **A retry *is* a remount**, and a remount unmounts `<Physics>` and re-initialises the Rapier WASM world — the exact failure mode live quality apply exists to remove.
3. **Relaxing the caveat check is not a software-rendering fallback on modern Chrome.** Chrome no longer hands out SwiftShader automatically; it is behind `--enable-unsafe-swiftshader` (this repo's own visual-smoke harness passes that flag). The second probe attempt is therefore understood as *"any context at all"*, not *"a software context"*. **Not yet confirmed on a real desktop Chrome with a live GPU** — see the open item in the PR.

### The preset no longer touches the context

`antialias`, `powerPreference`, and `failIfMajorPerformanceCaveat` come from the frozen envelope, so `rendererContextCreationKey()` is **identical for all four presets** and a quality change cannot remount the Canvas. That is pinned by a test. The remount machinery stays for the cases that genuinely need it: a different envelope (capture harness / `?softwareGl=1`), a renderer-class or material-backend change, and the context-loss epoch.

The visible trade: `low` no longer turns MSAA off, because MSAA cannot be toggled on a live context. `low` still drops DPR to 1.0 and shadows to off, which is the larger share of its cost. The honest fix for MSAA cost on a weak machine is a render scale, not a context teardown.

### Capture harness

Visual smoke, `?screenshot=1`, `?capture=1`, and `?softwareGl=1` **skip the probe entirely** and pin `CAPTURE_ENVELOPE`: antialias on, `high-performance`, caveat check off — exactly what the pre-negotiation code produced for those runs. Headless Chromium on SwiftShader would otherwise probe as `degraded`, flip antialias, and move every baseline. `isSoftwareRendererAllowed()` is still the single gate.

### `unsupported` renders a screen, not a game

When every attempt fails, `App` returns `<GraphicsUnsupported>` and never mounts the Canvas. R3F, Rapier's WASM world, the treadmill, and the audio graph all assume a renderer exists; mounting them anyway produced an infinite loader with no explanation. The screen states what failed, quotes `statusMessage`, and lists the two things a player can act on (enable hardware acceleration, update the driver).

### Safe Graphics Mode badge

`degraded` shows a persistent, dismissible badge (`SafeGraphicsBadge`), not a toast — the machine that triggers this is the least able to afford an animated overlay during boot, and a 4-second toast fired during a slow boot is a notification nobody sees. It reuses the `wasm-init-banner` visual language rather than adding a second notification system; the WASM banner's own logic is untouched. The badge is hidden in clean-test and capture runs.

**Acknowledgement persists, the tier does not.** Dismissal is stored in `localStorage` (`watershed:safe-graphics-ack`), so a player who has seen the explanation does not see it every load; the *tier* is re-probed every load, so a one-off driver hiccup does not downgrade anyone permanently.

### Boot-crash guard

`beginBootAttempt()` arms a `sessionStorage` record (`watershed:boot-failure`) before the Canvas mounts; `BootHealthSentinel`, inside the Canvas, clears it on the **first rendered frame**.

One frame, not sixty. A cold boot on a slow-but-healthy machine spends real time in shader compilation, WASM instantiation, and asset decode — gating on a frame *count* would clamp exactly those machines for being slow rather than broken. One drawn frame proves the context exists and the GPU drew, which is the only question this guard asks.

The record carries *why*, and only ever from evidence:

| Reason | Written by |
|--------|-----------|
| `no-frame` | armed at boot; never cleared, so the previous session mounted the Canvas and never drew |
| `context-lost` | `App`'s `webglcontextlost` handler |
| `renderer-throw` | the `gl` factory's catch, around `createGameRenderer` |

A boot that starts with a record present skips the optimistic probe attempt, clamps quality to `low` after settings hydration (earlier and rehydration would put the persisted preset straight back), and the badge names the specific failure. Self-healing is tied to the record, not a timer: the next boot that draws a frame clears it. `sessionStorage`, not `localStorage`, because this is about the tab in front of the player; and no `beforeunload` clear, because a reload during a wedged boot is exactly the case it exists to catch.

## Live quality apply

Changing quality used to remount the Canvas, which tore down Rapier, the track treadmill, WASM SWE grids, audio, and the vehicle body just to flip DPR or shadow filtering. Now the split is by *what the attribute actually is*:

| Knob | Changes live? | Applied by |
|------|---------------|------------|
| DPR (`dprMax`) | Yes | R3F `dpr` Canvas prop + `RendererQualitySync` |
| `shadowMap.enabled` / `.type` | Yes | R3F `shadows` Canvas prop + `applyRendererQualityUpdate()` |
| Per-light `shadow.mapSize` | Yes | `SceneLighting` (disposes the old shadow render target so it reallocates) |
| Tone mapping / exposure / color space | Yes | `applyRendererQualityUpdate()` |
| SWE grid/step budget | Yes | `sweQuality.ts` via `useQualityPreset()` |
| Post-processing intensity | Yes | already quality-gated |
| `antialias` / `powerPreference` / `failIfMajorPerformanceCaveat` | **No** | Context attributes — boot-negotiated once, so no preset can move them |
| `alpha` / `depth` / `stencil` / `premultipliedAlpha` | **No** | Context attributes, pinned |

**Consequence:** **every** quality transition applies live — `low` ↔ `ultra` included. No spawn pop, no WASM reload, no lost wipeout/ghost state, no context teardown. The player's only performance lever no longer costs them their run, which is the whole point.

**Adaptive LOD** (`systems/lod/adaptiveQuality.ts` / `stepAdaptiveQuality`) still stays inside the `medium` / `high` / `ultra` band and never auto-selects `low`, but the reason has changed. It used to be a hard constraint: auto-dropping to `low` remounted the Canvas during the start menu, fired `webglcontextlost` without a restore on the new element, and left the UI stuck on “Graphics paused — recovering…”. That cannot happen any more. What remains is a design call — `low` turns shadows off and drops DPR to 1.0, a visible change of look rather than a tuning step, and the game should not choose it for the player during a rough patch. Widening the band is now a decision, not a repair.

`rendererContextCreationKey()` is the single place that decides this: it serializes exactly the creation-only attributes, and `buildCanvasIdentityKey()` composes the Canvas `key` from that plus renderer preference, material backend, and the context-loss epoch. The quality preset is deliberately absent from the key.

### Why a scene walk on shadow changes

`RendererQualitySync` does more than assign `shadowMap.type`. THREE bakes the `SHADOWMAP_TYPE_*` define into each compiled program, and its `needsProgramChange` check in `setProgram` does **not** include the shadow map type — so flipping `basic` ↔ `soft` keeps rendering the old programs. `shadowMap.needsUpdate` only re-renders the shadow *maps*; it recompiles nothing. `applyRendererQualityUpdate()` therefore walks the scene and marks every material `needsUpdate` when the shadow configuration (or tone mapping) actually changed — and skips the walk when only DPR moved.

Per-light shadow map size has the same class of problem: `light.shadow.mapSize` is inert once the render target exists, because THREE allocates it on the first shadow pass and never reallocates. `SceneLighting` disposes the old map so the next pass rebuilds it at the new size.

Per-light shadow map sizes in `SceneLighting` follow the same contract: `deriveRendererContextOptions(quality)` drives `castShadow` and `shadow-mapSize`, with `LODManager.QUALITY_SETTINGS.shadowMapSize` kept as an aligned static fallback (ultra table stores the 4096 retina max; live path is DPR-aware). The configured size is also stored via `getRendererShadowMapSize()` for diagnostics and tests.

## Logarithmic depth buffer

**Decision: leave `logarithmicDepthBuffer` off** (`LOGARITHMIC_DEPTH_BUFFER_ENABLED = false`).

Evaluated for long canyon Z ranges. The track treadmill keeps ~7 active segments (hundreds of units of Z, not kilometers), fog far is typically ≤220, and the sun shadow camera uses `far = 200`. Turning on logarithmic depth would require log-depth shader chunks in every custom `ShaderMaterial` / `onBeforeCompile` path (`FlowingWater`, `CanyonMaterial`, `RiverShader`) for little practical Z-fighting relief. Revisit only if a non-treadmill long-haul camera path ships.

## Quick Start

| URL param | Actual backend | Use case |
|-----------|----------------|----------|
| `?renderer=webgl` (default) | `WebGLRenderer` | Production path; custom GLSL shaders, post-processing |
| `?renderer=webgpu` | `WebGLRenderer` (fallback) | Experimental/no-op on the default material backend |
| `?material=glsl` (default) | `WebGLRenderer` | Legacy GLSL materials — the production path |
| `?material=tsl` | `WebGPURenderer` (WebGL2 backend) | #256 path A — NodeMaterial pipeline, same graphics API |
| `?material=tsl&renderer=webgpu` | `WebGPURenderer` (WebGL2 backend) | Native WebGPU stays gated (`forceWebGL: true`) until residual GLSL is gone and post is ported |
| `?screenshot=1` or `?capture=1` | (any) | Enables `preserveDrawingBuffer` and allows software GL, for the visual-smoke harness only |
| `?softwareGl=1` | (any) | Allows software GL (SwiftShader) without enabling capture mode |

Examples:

```
http://localhost:3000/?renderer=webgl
http://localhost:3000/?debug=1&renderer=webgl&wireframe=1&physicsDebug=1
http://localhost:3000/?screenshot=1
```

## WebGL context loss recovery

`App.tsx` registers `webglcontextlost` (with `preventDefault`) and `webglcontextrestored` on the Canvas element. On loss, a minimal “Graphics paused — recovering…” toast appears; on restore, the Canvas remounts via an epoch counter in its React `key`.

## Material backends (#256 path A)

The migration to WebGPU is split so the two risks land separately: **materials first, graphics API second.**

| Backend | Materials | Renderer | Graphics API |
|---------|-----------|----------|--------------|
| `glsl` (default) | ShaderMaterial + `onBeforeCompile` | `THREE.WebGLRenderer` | WebGL2 |
| `tsl` | NodeMaterial / TSL graphs | `WebGPURenderer({ forceWebGL: true })` | WebGL2 |
| `tsl` + `?renderer=webgpu` | NodeMaterial / TSL graphs | `WebGPURenderer` | WebGPU |

**TSL materials cannot run on `THREE.WebGLRenderer`** — it has no node pipeline. So `?material=tsl` necessarily changes the renderer *class*; `forceWebGL: true` keeps the *API* at WebGL2, which is what makes this an incremental step rather than the all-or-nothing flip that PRs #252/#253 had to revert.

Resolution order (`src/rendering/materialBackend.ts`): `?material=` → stored debug-panel preference → default `glsl`. A request for `tsl` on a browser with no WebGL2 collapses back to `glsl`.

### Migrated so far

| Surface | Host | TSL implementation |
|---------|------|--------------------|
| Water surface | `materials/water/createWaterMaterial.ts` | `materials/water/WaterNodeMaterial.ts` |
| Canyon rock / river banks | `materials/river/createRiverSurfaceMaterial.ts` | `materials/RiverNodeMaterial.ts` |
| Slot-canyon walls | `materials/canyon/createCanyonSurfaceMaterial.ts` | `materials/CanyonNodeMaterial.ts` |
| Sky (clouds / stars / moon / TSL dome) | `materials/sky/createSkyMaterials.ts` | `materials/sky/SkyNodeMaterial.ts` |
| Weather particles (Reach) | `materials/weather/createWeatherParticleMaterial.ts` | `materials/weather/WeatherNodeMaterial.ts` |
| VFX ShaderMaterials | `materials/vfx/createVfxMaterials.ts` + `vfxDualFactory.ts` | `materials/vfx/VfxNodeMaterials.ts` |
| Tree / rock / vegetation inject | `materials/foliage/createFoliageSurfaceMaterial.ts` | `materials/foliage/FoliageNodeMaterials.ts` |
| Fish / dragonflies | `materials/critters/createCritterMaterials.ts` | `materials/critters/CritterNodeMaterials.ts` |

CI tracks leftover construction sites in [`scripts/glsl-hosts-allowlist.json`](../../scripts/glsl-hosts-allowlist.json) (`pnpm typecheck` runs `scripts/check-glsl-hosts.mjs`). **`dual`** entries are GLSL factories behind a backend switch — their GLSL branches stay forever for the WebGL product path. **`residual`** entries may **only shrink** (new live GLSL hosts fail CI unless listed). Scene-material migration is finished when every live host is `dual` or `dormant`; **`PostProcessingPipeline.tsx` is the intentional last `residual`** until a Three node-post bump (Phase D). Native WebGPU (`forceWebGL: false`) is gated by [`src/rendering/nativeWebgpuGate.ts`](../../src/rendering/nativeWebgpuGate.ts) until residual is empty **and** the post stack is ported (`POST_STACK_PORTED`).

Every host takes the backend as its first argument, never throws, and reports the backend it actually produced — a TSL failure (module not loaded, TSL surface drift) degrades to GLSL instead of taking the Canvas down.

`three/webgpu` (~800 kB) is dynamically imported through `materials/nodeMaterials.ts`, and `createGameRenderer` awaits that load while building the node renderer. The default backend never fetches it.

### Known gaps on `?material=tsl`

Water surface, vs the GLSL original:

- planar reflection texture sample (`reflectionTexture` / `reflectionStrength`)
- canyon god rays (`godRayStrength`)
- flow-map driven flow bias (`USE_FLOWMAP`)
- per-biome dynamic fragment shaders loaded by `useShaderLoader`
- the displacement field is re-evaluated per fragment instead of passed through varyings (extra ALU)

Scene-wide:

- **JSM post-processing stays WebGL-only (Phase D).** Live path is `three/examples/jsm/postprocessing` + `postprocessing@6` on `three@0.168` in `PostProcessingPipeline.tsx` (not `@react-three/postprocessing`, which crashes on R3F v9). `EffectComposer` / `ShaderPass` require `THREE.WebGLRenderer`. On `?material=tsl` the composer is **not mounted**. Native WebGPU waits on a documented Three bump whose node post stack replaces JSM — do not add a second composer or bump `three` in #387. `POST_STACK_PORTED` in `nativeWebgpuGate.ts` stays `false` until that lands.
- Dormant GLSL modules (`CausticsMaterial.ts`, `EnhancedWaterMaterial.ts`) are unused and listed as `dormant` on the allowlist.
- Weather particles are Reach-mounted (`ReachManager`), not the default treadmill.

`?renderer=webgpu` on the **GLSL** backend remains a no-op fallback to `WebGLRenderer`. On **TSL** it still uses `forceWebGL: true` until `canEnableNativeWebgpu()` is true.

### Visual smoke matrix

```bash
pnpm build && pnpm preview --port 4173
pnpm test:visual-smoke            # default GLSL baselines
pnpm test:visual-smoke:tsl        # ?material=tsl, baselines suffixed __material-tsl
```

`VISUAL_EXTRA_QUERY` appends a query to every shot and namespaces the captures, so a TSL run can never overwrite GLSL baselines.

## Why the default path still has no live WebGPU renderer

The production **GLSL** pipeline still uses legacy materials that crash inside `WebGPURenderer`'s `NodeMaterial` / TSL pipeline if they are routed there without a host:

- GLSL factories (`RiverShader.ts` inject, `CanyonMaterial.ts`, `FlowingWater` via `createWaterMaterial`) stay on `THREE.WebGLRenderer`.
- Post-processing — Three r168 JSM `EffectComposer` / `UnrealBloomPass` (WebGLRenderer-only).

Emergency PRs #252 and #253 reverted the live `WebGPURenderer` path. That constraint is unchanged for `?material=glsl`: `createGameRenderer()` returns `THREE.WebGLRenderer` regardless of renderer preference. The node renderer is reachable *only* by opting into TSL materials, and even then the graphics API stays WebGL2 until the residual allowlist is empty and post is ported.

## Non-gameplay Canvases

The Level Editor Canvas consumes the same contract (`deriveEditorContextOptions()` → `createGameRenderer()`), not a raw `gl={{ antialias: true }}`. It pins the `high` preset — an authoring tool wants the default look, not whatever the player last picked for performance — and pins `CAPTURE_ENVELOPE`, which keeps the caveat check off, because a slow editor beats an editor that will not boot. It does not run boot negotiation; it is not the game. Any future offscreen or debug Canvas should do the same: one derive function, one apply function, so a change to the contract cannot silently skip a surface.

## Debug UI

Enable the debug panel with `?debug=1`:

- **Renderer buttons** — switch preference between `webgpu` and `webgl` (remounts the Canvas). Both result in WebGL2 on the default material backend.
- **Material buttons** — switch between `GLSL` and `TSL` (remounts the Canvas). The panel shows the backend actually produced plus why, so a silent fallback to GLSL is visible.
- **Wireframe overlay (G)** — scene-wide geometry wireframe.
- **Physics colliders (F)** — Rapier debug wireframes + HUD snapshot (P to log).

## Architecture

```
App.tsx
  └─ Canvas (key = buildCanvasIdentityKey: renderer preference + material backend
     +          + creation-only context attributes + recovery epoch — NOT quality)
       ├─ dpr / shadows / gl context attributes from deriveRendererContextOptions()
       ├─ RendererQualitySync → applyRendererQualityUpdate() on preset change
       └─ createGameRenderer()  ← async gl factory
            ├─ material=glsl + webgl  → THREE.WebGLRenderer + applyRendererContextOptions()
            ├─ material=glsl + webgpu → THREE.WebGLRenderer (deliberate fallback)
            └─ material=tsl           → WebGPURenderer (forceWebGL: true until nativeWebgpuGate)
                                        + await loadNodeMaterials()
       └─ Experience (shared scene graph)
            ├─ RendererDiagnosticsMonitor → rendererState store
            └─ WireframeDebug / PhysicsDebugOverlay
```

`createGameRenderer()` probes CSP `data:` URL support because a future `WebGPURenderer` path would need it, but even when allowed it still returns `WebGLRenderer` today.

Module-level stores cross the Canvas boundary:

- `src/rendering/rendererState.ts` — active backend name + active material backend (read by DebugPanel)
- `src/debug/perfMetrics.ts` — draw calls, FPS, heap
- `src/rendering/gpuChores/statsStore.ts` — SWE height min/mean/max + chore backend (read by DebugPanel)

## Domain vs chores vs TSL (#369)

These are three separate GPU/compute stories. Do not treat them as one “WebGPU path.”

| Layer | What it is | Device |
|-------|------------|--------|
| **Domain hydrology** | WASM SWE visual heightfield; dormant `heightmap_flow.wgsl` | CPU WASM. Flow compute adopts the session `GPUDevice` if one exists; it never `requestDevice()`s. |
| **TSL path** | NodeMaterial shading (`?material=tsl`) | `WebGPURenderer` with WebGL2 on the wire, or real WebGPU if `?renderer=webgpu`. **Not a sim.** |
| **Chores** | `grid-reduce` / `luma-histogram` / `downsample-2d` / blur for HUD thumbs | Adopt that session device; else WASM → JS. See [`GPU_CHORES.md`](./GPU_CHORES.md). |

One sim backend per heightfield. Missing WebGPU does not change production water (GLSL + WASM SWE). `?no_gpu_compute` closes chores/flow compute only.

## Visual notes

- **WebGL2 (`?renderer=webgl`, default)** is the only production path.
- **WebGPU preference (`?renderer=webgpu`)** is an experimental no-op on the default material backend; it falls back to WebGL2.
- **`?material=tsl`** boots the node renderer with `forceWebGL: true` (WebGL2 on the wire). `?material=tsl&renderer=webgpu` does **not** open native WebGPU until `canEnableNativeWebgpu()`.
- HeightmapFlow is dormant domain compute. It adopts the renderer session device when native WebGPU is active; it does **not** allocate a second `GPUDevice`. Live water displacement is WASM SWE, not this WGSL.

## Keyboard Shortcuts (debug mode)

| Key | Action |
|-----|--------|
| `F` | Toggle physics collider debug |
| `G` | Toggle wireframe geometry overlay |
| `P` | Log physics debug snapshot to console |

## Related Files

| File | Purpose |
|------|---------|
| `src/rendering/deriveRendererContextOptions.ts` | Pure quality → DPR/shadow/tone-mapping matrix |
| `src/rendering/contextAttributes.ts` | Pinned attributes, shared by the probe and the renderer |
| `src/rendering/probeGraphicsCapability.ts` | Boot-time negotiation: tier, frozen envelope, session singleton |
| `src/rendering/bootCrashGuard.ts` | `sessionStorage` record of how the previous boot failed |
| `src/rendering/BootHealthSentinel.tsx` | Clears that record on the first rendered frame |
| `src/components/GraphicsUnsupported.tsx` | Static screen when there is no usable WebGL2 |
| `src/components/SafeGraphicsBadge.tsx` | Persistent degraded-session badge |
| `src/rendering/applyRendererContextOptions.ts` | Apply derived options at setup + `applyRendererQualityUpdate()` for live changes |
| `src/rendering/RendererQualitySync.tsx` | In-Canvas live quality apply (no remount) |
| `src/rendering/createRenderer.ts` | Async renderer factory |
| `src/rendering/nativeWebgpuGate.ts` | Native WebGPU (`forceWebGL: false`) remains closed |
| `scripts/glsl-hosts-allowlist.json` | Residual / dual / dormant GLSL construction sites |
| `src/rendering/rendererConfig.ts` | URL param + localStorage parsing, capture-mode and software-GL gates |
| `src/components/LevelEditor/LevelEditor.tsx` | Editor Canvas on the shared contract |
| `src/rendering/rendererState.ts` | Active backend diagnostics |
| `src/rendering/WireframeDebug.tsx` | Scene wireframe helper |
| `src/experience/SceneLighting.tsx` | Per-light shadows from quality contract |
| `src/systems/lod/LODManager.tsx` | LOD budgets; shadowMapSize aligned with contract |
| `src/components/DebugPanel.tsx` | Debug UI controls |
| `src/App.tsx` | Canvas wiring, context-loss recovery |
| `src/rendering/gpuChores/` | HUD hist/reduce/downsample (#369); not SWE |
| `docs/reference/RENDERER_CONTRACT.md` | Contract enforced by the regression guard |
