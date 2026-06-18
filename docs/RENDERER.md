# Renderer Toggle — WebGPU / WebGL2 Fallback

Watershed supports two rendering backends for visual debugging and broader browser coverage. Game state, level data, camera, physics, and entities are shared — only the Three.js renderer changes.

## Quick Start

| URL param | Backend | Use case |
|-----------|---------|----------|
| `?renderer=webgl` (default) | `WebGLRenderer` | Production path; custom GLSL shaders, post-processing |
| `?renderer=webgpu` | `WebGPURenderer` (WebGL2 backend) | Experimental; native WebGPU blocked until NodeMaterial migration |

Examples:

```
http://localhost:3000/?renderer=webgl
http://localhost:3000/?debug=1&renderer=webgl&wireframe=1&physicsDebug=1
```

## Debug UI

Enable the debug panel with `?debug=1`, then use:

- **Renderer buttons** — switch between WebGPU and WebGL2 (remounts the Canvas)
- **Wireframe overlay (G)** — scene-wide geometry wireframe for mesh inspection
- **Physics colliders (F)** — Rapier debug wireframes + HUD snapshot (P to log)

## Architecture

```
App.tsx
  └─ Canvas (key=renderer preference)
       └─ createGameRenderer()  ← async gl factory
            ├─ webgl  → THREE.WebGLRenderer
            └─ webgpu → THREE.WebGPURenderer (lazy import three/webgpu)
       └─ Experience (shared scene graph)
            ├─ RendererDiagnosticsMonitor → rendererState store
            └─ WireframeDebug / PhysicsDebugOverlay
```

Module-level stores cross the Canvas boundary:

- `src/rendering/rendererState.ts` — active backend name (read by DebugPanel)
- `src/debug/perfMetrics.ts` — draw calls, FPS, heap

## Visual Parity Notes

- **WebGL2 (`?renderer=webgl`, default)** is the production path for custom GLSL shaders (`RiverShader.js`, `PostProcessingPipeline`, `FlowingWater.jsx`).
- **WebGPU** (`?renderer=webgpu`) currently forces the WebGL2 backend inside `WebGPURenderer` because legacy materials are incompatible with native WebGPU NodeMaterial. Custom WGSL compute (e.g. `HeightmapFlow.ts`) still runs on a separate WebGPU device when available.
- Post-processing may behave differently under native WebGPU; use `?renderer=webgl` when tuning bloom, vignette, or chromatic aberration.

## Keyboard Shortcuts (debug mode)

| Key | Action |
|-----|--------|
| `F` | Toggle physics collider debug |
| `G` | Toggle wireframe geometry overlay |
| `P` | Log physics debug snapshot to console |

## Related Files

| File | Purpose |
|------|---------|
| `src/rendering/createRenderer.ts` | Async renderer factory |
| `src/rendering/rendererConfig.ts` | URL param + localStorage parsing |
| `src/rendering/WireframeDebug.tsx` | Scene wireframe helper |
| `src/components/DebugPanel.tsx` | Debug UI controls |
| `src/App.tsx` | Canvas wiring + keyboard shortcuts |
