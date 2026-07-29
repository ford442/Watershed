# Renderer — WebGL2-only with experimental WebGPU preference

Watershed runs a **single live renderer: `THREE.WebGLRenderer`**. The `?renderer=webgpu` URL parameter is accepted for compatibility and testing, but it currently falls back to WebGL2 and does **not** instantiate `WebGPURenderer`.

Game state, level data, camera, physics, and entities are shared; only the Canvas key changes when the preference is toggled, which remounts the scene.

## Quick Start

| URL param | Actual backend | Use case |
|-----------|----------------|----------|
| `?renderer=webgl` (default) | `WebGLRenderer` | Production path; custom GLSL shaders, post-processing |
| `?renderer=webgpu` | `WebGLRenderer` (fallback) | Experimental/no-op today; reserved for future #256 path A migration |

Examples:

```
http://localhost:3000/?renderer=webgl
http://localhost:3000/?debug=1&renderer=webgl&wireframe=1&physicsDebug=1
```

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
  └─ Canvas (key=renderer preference)
       └─ createGameRenderer()  ← async gl factory
            ├─ webgl  → THREE.WebGLRenderer
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
| `src/rendering/createRenderer.ts` | Async renderer factory (WebGL-only today) |
| `src/rendering/rendererConfig.ts` | URL param + localStorage parsing |
| `src/rendering/rendererState.ts` | Active backend diagnostics |
| `src/rendering/WireframeDebug.tsx` | Scene wireframe helper |
| `src/components/DebugPanel.tsx` | Debug UI controls |
| `src/App.tsx` | Canvas wiring + keyboard shortcuts |
| `docs/reference/RENDERER_CONTRACT.md` | Contract enforced by the regression guard |
