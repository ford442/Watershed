# Renderer — WebGL2-only with adaptive quality presets

Watershed's **production** renderer is `THREE.WebGLRenderer`. The `?renderer=webgpu` URL parameter is accepted for compatibility and testing, but on the default material backend it falls back to WebGL2 and does **not** instantiate `WebGPURenderer`.

Since #256 path A there is a second, opt-in path: `?material=tsl` builds NodeMaterial/TSL materials, which require a node-capable renderer. See [Material backends](#material-backends-256-path-a).

Graphics quality presets (`low` / `medium` / `high` / `ultra` from `GameState.settings.quality`, synced via `SettingsSync` → `LODManager`) drive the most expensive WebGL context knobs: device pixel ratio, antialiasing, shadow mode, shadow map size, tone mapping, and output color space.

Most of that now applies **live**. The Canvas `key` carries only what genuinely needs a fresh WebGL context — renderer preference, material backend, the creation-only context attributes, and the context-loss epoch — so `medium` ↔ `high` ↔ `ultra` mid-run keeps Rapier, the 7-segment treadmill, the WASM SWE grids, audio, and the vehicle body alive. See [Live quality apply](#live-quality-apply).

## Quality → renderer context matrix

Derived by the pure function `deriveRendererContextOptions()` in `src/rendering/deriveRendererContextOptions.ts` and applied at Canvas creation in `App.tsx` + `createGameRenderer()`.

| Preset | DPR clamp `[1, max]` | Antialias | Shadows | Shadow map size | Notes |
|--------|----------------------|-----------|---------|-----------------|-------|
| `low` | `1.0` | off | off | — | Minimal GPU cost; `powerPreference: 'default'` |
| `medium` | `1.25` | on | basic | 1024 | |
| `high` | `2` | on | soft (PCF) | 2048 | **Default look** — matches pre-contract Canvas defaults (`dpr [1,2]`, `shadows="soft"`, `antialias: true`) |
| `ultra` | `min(devicePixelRatio, 2.5)` | on | soft (PCF) | 2048 (1×) / 4096 (≥2×) | Native DPR up to the `ULTRA_DPR_CEILING` |

**`ultra` DPR ceiling.** `ULTRA_DPR_CEILING = 2.5` (`deriveRendererContextOptions.ts`). `ultra` renders at the display's native `devicePixelRatio`, which was previously uncapped — on a 3× phone or a 4× external panel that is 9–16× the pixel work of DPR 1, enough to miss the 60 FPS / 16.67 ms budget on hardware that is otherwise comfortably an `ultra` machine. 2.5 keeps the full retina win (DPR 2 is unclamped, 2.5 covers 2.5×-scaled laptop panels) and stops the tail. Raising it is a performance decision, not a tuning nit: move the constant, this row, and the test that pins it together. The shadow-map step still keys off the *raw* `devicePixelRatio`, so a 3× display keeps its 4096 map.

**`low` power preference.** Every preset asks the browser for `high-performance` except `low`, which asks for `'default'` (`LOW_PRESET_POWER_PREFERENCE`). `high-performance` wakes the discrete GPU on a dual-GPU laptop, and `low` is the preset a player picks *because* the machine is struggling — usually thermals or battery. `powerPreference` is a creation attribute and `power:` is already in `rendererContextCreationKey()`, so this is part of `low`'s identity key; it adds no new remount boundary, because `low` already remounts against every other preset on `antialias` alone.

All presets set `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, and `toneMappingExposure = 1.0` at renderer setup via `applyRendererContextOptions()`, and re-apply them on every preset change via `applyRendererQualityUpdate()`.

### Pinned context attributes

These do not vary by preset (`SHARED_CONTEXT_ATTRIBUTES`), but they are pinned rather than left to THREE's defaults so a version bump cannot move them silently:

| Attribute | Value | Why |
|-----------|-------|-----|
| `alpha` | `false` | Opaque game view. **This is a `WebGLBackground` setting, not a drawing-buffer setting** — see [Alpha honesty](#alpha-honesty) below. |
| `premultipliedAlpha` | `true` | Not just compositing: `WebGLState.setBlending` picks premultiplied blend functions from this flag, so every transparent material in the game (splash, water, weather, VFX) is authored against `true`. Flipping it would change how all of them blend. |
| `depth` | `true` | Required by every 3D pass and by SSAO. THREE default. |
| `stencil` | `true` | **Not** THREE's default (off since r163). Enabled for the post stack's mask/outline passes. |
| `failIfMajorPerformanceCaveat` | `true` above `low` | Software GL (SwiftShader, llvmpipe) must not silently boot and read as a shipped GPU. `low` accepts it — `low` is the fallback a weak machine is meant to land on. |
| `logarithmicDepthBuffer` | `false` | See below. |
| `desynchronized` | not set | THREE r168's `WebGLRenderer` never forwards it to `getContext`, so setting it would be decoration. It is also the wrong trade here: it can tear and reorders readback, which `?screenshot=1` depends on. |

#### Alpha honesty

**Decision: `alpha: false` is documented as `WebGLBackground`-only. We do not create the GL context ourselves.**

THREE r168's `WebGLRenderer` builds its own `getContext` attribute object and always requests the context with `alpha: true`, regardless of the `alpha` we pass to the constructor. What our `alpha: false` actually reaches is `WebGLBackground`, which then clears the drawing buffer fully opaque instead of letting the page show through. So the pin is real and load-bearing — the game view is opaque because of it — but it is *not* a claim about the drawing buffer's alpha channel, and reading the table row as one would be wrong.

The alternative is to call `canvas.getContext('webgl2', …)` ourselves and hand the result to `new THREE.WebGLRenderer({ context })`. That was considered and rejected: it moves context creation out of THREE (and out of R3F's `gl` factory contract), it has to duplicate THREE's own attribute and extension negotiation, and it would have to be kept in step with every Three bump — a real boot-path regression risk for a gain that is invisible on an opaque full-page canvas. Revisit only if something genuinely needs to composite the canvas against the page.

**Software-GL opt-out.** Visual smoke and CI run headless Chromium on SwiftShader, which *is* a major performance caveat — with the check on, the context request fails and the harness captures a black canvas. `isSoftwareRendererAllowed()` turns the check off for `?screenshot=1` / `?capture=1` (every visual-smoke shot already carries one) and for an explicit `?softwareGl=1`. Production never sets it.

### Boot fallback on a rejected context

If `new THREE.WebGLRenderer(…)` throws while `failIfMajorPerformanceCaveat` is on, `createGameRendererWithCaveatFallback()` (`src/rendering/bootRendererFallback.ts`) retries **once**, at `low`, and reports the downgrade. Before this the contract said a caveat failure "can be retried at a lower preset" and nothing implemented it, so a weak GPU got an exception out of the async `gl` factory and the player got the error boundary instead of a game.

- **Straight to `low`, not one preset at a time.** `low` is the only preset that relaxes the caveat check; a machine the browser flags as a major performance caveat fails identically at `high` and at `medium`, so stepping down would just be two more failures.
- **No retry when the check was already off.** A failure at `low`, `?softwareGl=1`, or capture mode is a genuine "no WebGL here" and is rethrown so the error boundary still reports it.
- **The retry does not itself remount.** It returns a working renderer for the *current* mount. `App.tsx`'s `onCaveatFallback` writes `low` to the settings store (persistence + Options agreement) and to `GameState` (so the Canvas props agree on this tick without waiting on `SettingsSync`'s effect); the Canvas identity key then changes on antialias and the Canvas remounts once, with DPR, shadows, and props in agreement.
- **The downgrade persists**, via the settings store, and a dismissible toast says so: the caveat is a property of the machine, not of the tab, so the next session should not repeat the failed boot. Options can raise it again.

It writes to the *settings* store rather than `GameState` directly because `SettingsSync` owns that direction — a rehydration landing after the failure would otherwise clobber the downgrade straight back to the persisted preset.

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
| `antialias` | **No** | Context attribute — requires a new context |
| `alpha` / `depth` / `stencil` / `premultipliedAlpha` / `failIfMajorPerformanceCaveat` / `powerPreference` | **No** | Context attributes |

**Consequence:** `medium` ↔ `high` ↔ `ultra` mid-run does **not** remount — no spawn pop, no WASM reload, no lost wipeout/ghost state. `high` → `low` (or back) **does** remount, because `low` turns antialias off and antialias cannot change on a live WebGL context. `low` also relaxes `failIfMajorPerformanceCaveat` and asks for `powerPreference: 'default'`, both context attributes too — so `low`'s identity key differs on three counts, not one.

**Adaptive LOD** (`systems/lod/adaptiveQuality.ts` / `stepAdaptiveQuality`) therefore stays inside the live band (`medium` / `high` / `ultra`) and never auto-selects `low`. Auto-dropping to `low` remounted the Canvas during the start menu, fired `webglcontextlost` without a restore on the new element, and left the UI stuck on “Graphics paused — recovering…”. Choosing `low` remains a deliberate Settings action.

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

The Level Editor Canvas consumes the same contract (`deriveEditorContextOptions()` → `createGameRenderer()`), not a raw `gl={{ antialias: true }}`. It pins the `high` preset — an authoring tool wants the default look, not whatever the player last picked for performance — and allows software GL, because a slow editor beats an editor that will not boot. Any future offscreen or debug Canvas should do the same: one derive function, one apply function, so a change to the contract cannot silently skip a surface.

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
| `src/rendering/applyRendererContextOptions.ts` | Apply derived options at setup + `applyRendererQualityUpdate()` for live changes |
| `src/rendering/RendererQualitySync.tsx` | In-Canvas live quality apply (no remount) |
| `src/rendering/createRenderer.ts` | Async renderer factory |
| `src/rendering/bootRendererFallback.ts` | One-shot retry at `low` when the caveat check rejects the context |
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
