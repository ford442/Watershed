# WATERSHED - Master Development Plan

## Project Vision
A high-octane, photorealistic downhill action game combining kinetic speed with rigorous physics simulation.

## Current Status
**Phase:** Early Prototype - Creek Canyon Biome
**Working:** Basic player movement, river track generation, physics integration
**Issues:** Player spawn positioning (FIXED), camera preview

---

## Development Phases

### Phase 1: Core Mechanics Foundation ✓ (In Progress)
- [x] Basic React Three Fiber setup
- [x] Rapier physics integration
- [x] Player capsule controller with FPS camera
- [x] Procedural river track generation (ExtrudeGeometry)
- [x] Basic texturing (rock materials)
- [x] Keyboard controls (WASD + Space)
- [x] Fix player spawn position
- [ ] Camera preview mode for development
- [ ] Player respawn system
- [ ] Basic collision detection validation

### Phase 2: Creek Canyon Refinement
**Goal:** Polish the initial biome into a complete, playable experience

#### Terrain & Environment
- [ ] Enhance canyon wall detail with proper heightmap displacement
- [ ] Add rock debris and obstacles (pooled instances)
- [ ] Implement water flow visual effects
- [ ] Add vegetation (moss, ferns) using instanced meshes
- [ ] Lighting improvements (god rays, ambient occlusion)
- [ ] Fog and atmospheric effects

#### Water System
- [ ] WebGPU compute shader for water surface deformation
- [ ] Water flow forces affecting player physics
- [ ] Splash particles when player impacts water
- [ ] Water foam and spray effects
- [ ] Normal map animation for water surface

#### Gameplay
- [ ] Momentum-based scoring system
- [ ] Speed boost zones (rapids)
- [ ] Hazards (rocks, fallen logs)
- [ ] Checkpoint system
- [ ] Game over condition (stopping/leaving track)
- [ ] Basic UI overlay (speed, distance, score)

### Phase 3: Performance & Optimization
**Goal:** Achieve 60fps on target hardware

#### Asset Streaming
- [ ] Implement chunk-based "treadmill" system
- [ ] Object pooling for reusable meshes
- [ ] LOD (Level of Detail) for distant geometry
- [ ] Frustum culling optimization
- [ ] Texture streaming and compression

#### Physics Optimization
- [ ] Move Rapier to Web Worker
- [ ] Implement physics prediction/interpolation
- [ ] Optimize collision meshes (simplified convex hulls)
- [ ] Reduce physics update frequency where possible

#### Rendering
- [ ] Instanced rendering for repeated objects
- [ ] Occlusion culling
- [ ] Shadow map optimization
- [ ] Post-processing pipeline (motion blur, bloom)

### Phase 4: Expanded Content
**Goal:** Add variety and replayability

#### New Biomes
- [ ] Alpine Source (mountain springs)
- [ ] Forest Rapids (dense vegetation, waterfalls)
- [ ] Rocky Gorge (narrow, dangerous passages)
- [ ] Valley Delta (wide, meandering channels)

#### Procedural Generation
- [ ] Seed-based track generation
- [ ] Difficulty progression system
- [ ] Random obstacle placement
- [ ] Dynamic weather conditions

#### Player Abilities
- [ ] Slide mechanic (reduce friction)
- [ ] Air control during jumps
- [ ] Wall-ride technique
- [ ] Quick-turn maneuver

### Phase 5: Polish & Release
**Goal:** Ship-ready product

#### Audio
- [ ] Rushing water ambient sound
- [ ] Wind and environmental audio
- [ ] Player movement sounds (splash, slide)
- [ ] Impact and collision effects
- [ ] Dynamic music system

#### UI/UX
- [ ] Main menu
- [ ] Settings panel (graphics, audio, controls)
- [ ] Tutorial/onboarding
- [ ] Leaderboard system
- [ ] Replay system

#### Testing & QA
- [ ] Performance profiling
- [ ] Cross-browser testing
- [ ] Mobile device testing
- [ ] Accessibility improvements
- [ ] User playtesting feedback

---

## Technical Debt & Known Issues

### High Priority
- [ ] Player spawn position needs collision validation
- [ ] Camera can clip through geometry
- [ ] No error handling for texture loading failures
- [ ] Physics performance degrades with complex trimesh

### Medium Priority
- [ ] Need better dev tools (debug view, performance overlay)
- [ ] Texture paths inconsistent (public/ vs ./)
- [ ] No TypeScript in all components (jsx files)
- [ ] Missing unit tests

### Low Priority
- [ ] Code organization could be improved (separate folders for systems)
- [ ] No ESLint configuration
- [ ] Missing git hooks for pre-commit checks

---

## File Organization & Expansion Areas

```
Watershed/
├── src/
│   ├── components/          [EXPAND: More game objects]
│   │   ├── Player.jsx      ✓ Core player controller
│   │   ├── RiverTrack.jsx  ✓ Main track generator
│   │   ├── CreekCanyon.jsx ✓ Alternative track (not used)
│   │   └── [TODO]
│   │       ├── Obstacles/   → Rock, Log, Rapids components
│   │       ├── Effects/     → Particles, Splashes, Foam
│   │       ├── UI/          → HUD, Menu, Overlays
│   │       └── Cameras/     → Debug camera, Cinematic camera
│   │
│   ├── systems/             [CREATE: Game systems]
│   │   ├── ChunkManager.ts  → Treadmill/streaming system
│   │   ├── ObjectPool.ts    → Reusable object pooling
│   │   ├── ScoreSystem.ts   → Momentum-based scoring
│   │   └── Physics/
│   │       ├── PhysicsWorker.ts → Web Worker for Rapier
│   │       └── WaterForces.ts   → Water flow calculations
│   │
│   ├── generators/          [CREATE: Procedural generation]
│   │   ├── TrackGenerator.ts    → Seed-based track creation
│   │   ├── TerrainGenerator.ts  → Heightmap generation
│   │   └── ObstacleSpawner.ts   → Random obstacle placement
│   │
│   ├── shaders/             [CREATE: WebGPU shaders]
│   │   ├── waterSurface.wgsl    → Water deformation compute
│   │   ├── waterFlow.wgsl       → Flow simulation
│   │   └── particleUpdate.wgsl  → Particle system
│   │
│   ├── utils/               [CREATE: Utilities]
│   │   ├── MathHelpers.ts   → Vector math, curves
│   │   ├── TextureLoader.ts → Async texture management
│   │   └── DebugTools.ts    → Performance overlay, debug draw
│   │
│   ├── hooks/               [CREATE: React hooks]
│   │   ├── useChunkStreaming.ts → Chunk management hook
│   │   ├── useObjectPool.ts     → Object pooling hook
│   │   └── useGameState.ts      → Global game state
│   │
│   └── config/              [CREATE: Configuration]
│       ├── gameConfig.ts    → Game constants and settings
│       ├── physicsConfig.ts → Physics parameters
│       └── biomes.ts        → Biome definitions
│
├── assets/
│   ├── concepts/            ✓ Reference images
│   ├── textures/            [EXPAND: More materials]
│   │   └── rock/            → Rock textures (in public/)
│   ├── models/              [CREATE: 3D models]
│   │   ├── obstacles/       → Rocks, logs, etc.
│   │   └── props/           → Environmental details
│   └── audio/               [CREATE: Sound assets]
│       ├── ambient/         → Water, wind sounds
│       ├── effects/         → Splash, impact sounds
│       └── music/           → Dynamic soundtrack
│
└── public/                  ✓ Static assets
    └── Rock031_1K-JPG_*     → Current rock textures

```

---

## Next Immediate Steps (Priority Order)

1. **Test Player Spawn Fix** - Verify player spawns above track and falls correctly
2. **Add Development Camera** - Implement free-fly camera for scene preview (toggle with 'C' key)
3. **Player Respawn System** - Reset player if they fall off or get stuck
4. **Create Basic Obstacles** - Add 3-5 rock obstacles to test collision
5. **Implement Object Pooling** - Prepare for chunk streaming system

---

## Notes for AI Agents

- Always test changes by running `npm start` and visually verifying
- Maintain the "kinetic flow" philosophy - speed and momentum are paramount
- Performance is critical - profile before adding expensive features
- Follow the existing code style (functional React components, hooks)
- Consult AGENTS.md for aesthetic and technical guidelines
- Keep physics on Rapier, rendering on R3F - don't mix paradigms
