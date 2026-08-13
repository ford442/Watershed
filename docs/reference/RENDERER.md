# Renderer — WebGL2-only with adaptive quality presets

Watershed's **production** renderer is `THREE.WebGLRenderer`. The `?renderer=webgpu` URL parameter is accepted for compatibility and testing, but on the default material backend it falls back to WebGL2 and does **not** instantiate `WebGPURenderer`.

Since #256 path A there is a second, opt-in path: `?material=tsl` builds NodeMaterial/TSL materials, which require a node-capable renderer. See [Material backends](#material-backends-256-path-a).

Graphics quality presets (`low` / `medium` / `high` / `ultra` from `GameState.settings.quality`, synced via `SettingsSync` → `LODManager`) now drive the most expensive WebGL context knobs: device pixel ratio, antialiasing, shadow mode, shadow map size, tone mapping, and output color space. Changing the preset remounts the Canvas (same pattern as the renderer-preference toggle).

Game state, level data, camera, physics, and entities are shared; the Canvas `key` changes when renderer preference **or** quality preset changes.

## Quality → renderer context matrix

Derived by the pure function `deriveRendererContextOptions()` in `src/rendering/deriveRendererContextOptions.ts` and applied at Canvas creation in `App.tsx` + `createGameRenderer()`.

| Preset | DPR clamp `[1, max]` | Antialias | Shadows | Shadow map size | Notes |
|--------|----------------------|-----------|---------|-----------------|-------|
| `low` | `1.0` | off | off | — | Minimal GPU cost |
| `medium` | `1.25` | on | basic | 1024 | |
| `high` | `2` | on | soft (PCF) | 2048 | **Default look** — matches pre-contract Canvas defaults (`dpr [1,2]`, `shadows="soft"`, `antialias: true`) |
| `ultra` | native `devicePixelRatio` | on | soft (PCF) | 2048 (1×) / 4096 (≥2×) | Uncapped DPR on retina |

All presets set `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, and `toneMappingExposure = 1.0` once at renderer setup via `applyRendererContextOptions()`.

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
| `?material=tsl&renderer=webgpu` | `WebGPURenderer` (WebGPU backend) | Phase 3 preview; only sound once every material is TSL |
| `?screenshot=1` or `?capture=1` | (any) | Enables `preserveDrawingBuffer` for visual-smoke harness only |

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

- **VFX / particle `ShaderMaterial`s and GLSL post-processing are not migrated** (migration priorities 4–5). Under the node renderer, three logs `NodeMaterial: Material "ShaderMaterial" is not compatible` once per such material and skips it. Non-fatal — the scene still renders — but those effects do not draw.
- Worth flagging against the original plan: post-processing **cannot** "stay GLSL longer" once materials require the node renderer. `postprocessing` v6 is WebGL2/`WebGLRenderer`-only, so a TSL scene runs without the post stack until it is ported.

### Visual smoke matrix

```bash
pnpm build && pnpm preview --port 4173
pnpm test:visual-smoke            # default GLSL baselines
pnpm test:visual-smoke:tsl        # ?material=tsl, baselines suffixed __material-tsl
```

`VISUAL_EXTRA_QUERY` appends a query to every shot and namespaces the captures, so a TSL run can never overwrite GLSL baselines.

## Why the default path still has no live WebGPU renderer

The production pipeline uses legacy GLSL materials that crash inside `WebGPURenderer`'s `NodeMaterial` / TSL pipeline:

- `RiverShader.ts` — `MeshStandardMaterial` with `onBeforeCompile` injection.
- `CanyonMaterial.js` — custom `ShaderMaterial`.
- `FlowingWater.tsx` — custom `ShaderMaterial`.
- Post-processing — GLSL passes from `postprocessing` / `@react-three/postprocessing` v6.

Emergency PRs #252 and #253 reverted the live `WebGPURenderer` path. That constraint is unchanged for `?material=glsl`: while legacy materials are in use, `createGameRenderer()` returns `THREE.WebGLRenderer` regardless of renderer preference. The node renderer is reachable *only* by opting into TSL materials, which is precisely the invariant the guard in `createRenderer.test.ts` locks.

## Debug UI

Enable the debug panel with `?debug=1`:

- **Renderer buttons** — switch preference between `webgpu` and `webgl` (remounts the Canvas). Both result in WebGL2 on the default material backend.
- **Material buttons** — switch between `GLSL` and `TSL` (remounts the Canvas). The panel shows the backend actually produced plus why, so a silent fallback to GLSL is visible.
- **Wireframe overlay (G)** — scene-wide geometry wireframe.
- **Physics colliders (F)** — Rapier debug wireframes + HUD snapshot (P to log).

## Architecture

```
App.tsx
  └─ Canvas (key = renderer preference + material backend + quality preset + recovery epoch)
       ├─ dpr / shadows / gl.antialias from deriveRendererContextOptions()
       └─ createGameRenderer()  ← async gl factory
            ├─ material=glsl + webgl  → THREE.WebGLRenderer + applyRendererContextOptions()
            ├─ material=glsl + webgpu → THREE.WebGLRenderer (deliberate fallback)
            └─ material=tsl           → WebGPURenderer (forceWebGL unless ?renderer=webgpu)
                                        + await loadNodeMaterials()
       └─ Experience (shared scene graph)
            ├─ RendererDiagnosticsMonitor → rendererState store
            └─ WireframeDebug / PhysicsDebugOverlay
```

`createGameRenderer()` probes CSP `data:` URL support because a future `WebGPURenderer` path would need it, but even when allowed it still returns `WebGLRenderer` today.

Module-level stores cross the Canvas boundary:

- `src/rendering/rendererState.ts` — active backend name + active material backend (read by DebugPanel)
- `src/debug/perfMetrics.ts` — draw calls, FPS, heap

## Visual notes

- **WebGL2 (`?renderer=webgl`, default)** is the only production path.
- **WebGPU preference (`?renderer=webgpu`)** is an experimental no-op on the default material backend; it falls back to WebGL2.
- **`?material=tsl`** boots and renders through the node renderer on a WebGL2 backend. It is not yet at visual parity — see the gap list above — and is not the production path.
- A separate experimental WebGPU compute path in `src/shaders/HeightmapFlow.ts` may run on a secondary `GPUDevice` when available, but its output is consumed by the WebGL2 `FlowingWater.tsx` shader and is independent of the renderer backend.

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
| `src/rendering/applyRendererContextOptions.ts` | Apply derived options once at renderer setup |
| `src/rendering/createRenderer.ts` | Async renderer factory (WebGL-only today) |
| `src/rendering/rendererConfig.ts` | URL param + localStorage parsing, capture-mode gate |
| `src/rendering/rendererState.ts` | Active backend diagnostics |
| `src/rendering/WireframeDebug.tsx` | Scene wireframe helper |
| `src/experience/SceneLighting.tsx` | Per-light shadows from quality contract |
| `src/systems/LODManager.tsx` | LOD budgets; shadowMapSize aligned with contract |
| `src/components/DebugPanel.tsx` | Debug UI controls |
| `src/App.tsx` | Canvas wiring, quality remount, context-loss recovery |
| `docs/reference/RENDERER_CONTRACT.md` | Contract enforced by the regression guard |
