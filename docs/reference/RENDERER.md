# Renderer — WebGL2-only with adaptive quality presets

Watershed runs a **single live renderer: `THREE.WebGLRenderer`**. The `?renderer=webgpu` URL parameter is accepted for compatibility and testing, but it currently falls back to WebGL2 and does **not** instantiate `WebGPURenderer`.

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
| `?renderer=webgpu` | `WebGLRenderer` (fallback) | Experimental/no-op today; reserved for future #256 path A migration |
| `?screenshot=1` or `?capture=1` | (any) | Enables `preserveDrawingBuffer` for visual-smoke harness only |

Examples:

```
http://localhost:3000/?renderer=webgl
http://localhost:3000/?debug=1&renderer=webgl&wireframe=1&physicsDebug=1
http://localhost:3000/?screenshot=1
```

## WebGL context loss recovery

`App.tsx` registers `webglcontextlost` (with `preventDefault`) and `webglcontextrestored` on the Canvas element. On loss, a minimal “Graphics paused — recovering…” toast appears; on restore, the Canvas remounts via an epoch counter in its React `key`.

## Why there is no live WebGPU renderer

The production pipeline uses legacy GLSL materials that crash inside `WebGPURenderer`'s `NodeMaterial` / TSL pipeline:

- `RiverShader.js` — `MeshStandardMaterial` with `onBeforeCompile` injection.
- `CanyonMaterial.js` — custom `ShaderMaterial`.
- `FlowingWater.jsx` — custom `ShaderMaterial`.
- Post-processing — GLSL passes from `postprocessing` / `@react-three/postprocessing` v6.

Emergency PRs #252 and #253 reverted the live `WebGPURenderer` path. Issue #256 path A owns the real migration, which must replace every legacy material with a `NodeMaterial` / TSL equivalent before `createGameRenderer()` may return anything other than `THREE.WebGLRenderer`.

## Debug UI

Enable the debug panel with `?debug=1`:

- **Renderer buttons** — switch preference between `webgpu` and `webgl` (remounts the Canvas). Both currently result in WebGL2.
- **Wireframe overlay (G)** — scene-wide geometry wireframe.
- **Physics colliders (F)** — Rapier debug wireframes + HUD snapshot (P to log).

## Architecture

```
App.tsx
  └─ Canvas (key = renderer preference + quality preset + recovery epoch)
       ├─ dpr / shadows / gl.antialias from deriveRendererContextOptions()
       └─ createGameRenderer()  ← async gl factory
            ├─ webgl  → THREE.WebGLRenderer + applyRendererContextOptions()
            └─ webgpu → THREE.WebGLRenderer (deliberate fallback)
       └─ Experience (shared scene graph)
            ├─ RendererDiagnosticsMonitor → rendererState store
            └─ WireframeDebug / PhysicsDebugOverlay
```

`createGameRenderer()` probes CSP `data:` URL support because a future `WebGPURenderer` path would need it, but even when allowed it still returns `WebGLRenderer` today.

Module-level stores cross the Canvas boundary:

- `src/rendering/rendererState.ts` — active backend name (read by DebugPanel)
- `src/debug/perfMetrics.ts` — draw calls, FPS, heap

## Visual notes

- **WebGL2 (`?renderer=webgl`, default)** is the only production path.
- **WebGPU preference (`?renderer=webgpu`)** is an experimental no-op; it falls back to WebGL2.
- A separate experimental WebGPU compute path in `src/shaders/HeightmapFlow.ts` may run on a secondary `GPUDevice` when available, but its output is consumed by the WebGL2 `FlowingWater.jsx` shader and is independent of the renderer backend.

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
