# Source Directory Plan

## Current Structure

```
src/
├── App.tsx           # Root Canvas component
├── Experience.jsx    # Main 3D scene composition
├── components/       # React Three components
├── index.tsx         # Entry point
├── react-app-env.d.ts
└── style.css
```

## Planned Expansion

```
src/
├── App.tsx
├── Experience.jsx
├── index.tsx
│
├── components/           # 3D Components (see components/PLAN.md)
│   ├── GameHUD.tsx       # ✅ Speed, distance, biome, momentum, wipeout (Goal 4)
│   ├── StartMenu.tsx     # ✅ Pre-game title screen (Goal 4)
│   ├── PauseMenu.tsx     # ✅ Pause overlay + settings (Goal 4)
│   ├── RiverTrack.jsx    # ⚠️ Legacy — deprecation warning (Goal 5)
│   ├── CreekCanyon.jsx   # ⚠️ Legacy — deprecation warning (Goal 5)
│   └── ...
│
├── systems/              # Game Systems
│   ├── ChunkManager.ts   # ✅ Dynamic loading/unloading (Goal 1)
│   ├── ObjectPool.ts     # ✅ Reusable object pool (ParticlePool.ts + ObjectSystem.ts)
│   └── GameState.ts      # ✅ Global game state — Zustand (Goal 1)
│
├── physics/              # Physics Utilities
│   ├── WaterForces.ts    # ✅ Water current calculations (Goal 1)
│   └── CollisionLayers.ts # TODO: Future
│
├── shaders/              # WebGPU/WGSL Shaders
│   ├── water.wgsl        # ✅ Water displacement compute shader (Goal 1)
│   └── flowmap.wgsl      # ✅ Flow simulation compute shader (Goal 1)
│
├── hooks/                # Custom React Hooks
│   ├── usePlayerPosition.ts # TODO: Future
│   ├── useChunkLoader.ts  # ✅ Chunk loading state hook (Goal 1)
│   ├── usePlayerControls.ts # ✅ Unified input hook — runner + raft (Goal 2)
│   ├── useSegmentAudio.ts # ✅ Segment-aware ambient audio (Goal 3)
│   └── useGameLoop.ts     # TODO: Future
│
├── utils/                # TODO: Utility Functions
│   ├── splineHelpers.ts  # Spline math utilities
│   └── geometryHelpers.ts
│
├── types/                # TODO: TypeScript Definitions
│   └── game.d.ts
│
└── constants/            # TODO: Game Constants
    ├── physics.ts
    └── biomes.ts
```

## Goal 0: Live Build Issues Resolved

- **Audio paths**: Switched `AudioSystem.ts` to use `import.meta.env.BASE_URL` so sounds load correctly under subdirectory deployments (e.g. `/watershed/`).
- **glBlitFramebuffer fix**: Disabled `enableNormalPass` on `EffectComposer` and restricted `SSAO` to `ultra` quality only. `WaterReflection` now saves/restores full GL state and uses `depthBuffer: false` on its render target.
- **LOD hysteresis**: Added sustained-history gating — downgrade requires 3 consecutive seconds below threshold, upgrade requires 2 consecutive seconds above. Reduced `high` preset cost (`shadowMapSize` 1024, motion blur off, 700 max particles) to improve baseline FPS.

## Migration Notes

- Keep `Experience.jsx` as the main scene orchestrator
- Move complex logic to dedicated `systems/` directory
- Shaders go in `shaders/` with `.wgsl` extension for WebGPU
- Use `hooks/` for shared React Three Fiber patterns
