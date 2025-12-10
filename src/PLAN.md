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
│   └── ...
│
├── systems/              # TODO: Game Systems
│   ├── ChunkManager.ts   # Dynamic loading/unloading
│   ├── ObjectPool.ts     # Reusable object pool
│   └── GameState.ts      # Global game state
│
├── physics/              # TODO: Physics Utilities
│   ├── WaterForces.ts    # Water current calculations
│   └── CollisionLayers.ts
│
├── shaders/              # TODO: WebGPU/WGSL Shaders
│   ├── water.wgsl        # Water displacement shader
│   └── flowmap.wgsl      # Flow simulation
│
├── hooks/                # TODO: Custom React Hooks
│   ├── usePlayerPosition.ts
│   ├── useChunkLoader.ts
│   └── useGameLoop.ts
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

## Migration Notes

- Keep `Experience.jsx` as the main scene orchestrator
- Move complex logic to dedicated `systems/` directory
- Shaders go in `shaders/` with `.wgsl` extension for WebGPU
- Use `hooks/` for shared React Three Fiber patterns
