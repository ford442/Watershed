# WATERSHED Development Plan

## Current Status: Prototype Phase

The project has established a spline-based track system. The immediate focus is on implementing the core gameplay loop.

---

## Phase 1: Core Engine (Current)

### Priority A: Treadmill/Chunking System ✅ In Progress
- [x] Refactor track into reusable `TrackSegment` component
- [x] Create `TrackManager` to orchestrate multiple segments
- [ ] Implement dynamic segment loading based on player position
- [ ] Add segment unloading for segments behind the player
- [ ] Implement object pooling for performance

### Priority B: Physics Optimization
- [ ] Create simplified collision geometry (low-poly walls)
- [ ] Separate visual mesh from physics mesh
- [ ] Profile and optimize Rapier physics performance
- [ ] Consider convex decomposition vs trimesh

### Priority C: Water Flow (WebGPU)
- [ ] Design water flow vertex shader (WGSL)
- [ ] Implement flowmap-based displacement
- [ ] Add normal reconstruction for lighting
- [ ] Apply water forces to player rigid body

---

## Phase 2: Gameplay Systems

### Player Mechanics
- [ ] Implement momentum-based movement
- [ ] Add slide/drift mechanics for turns
- [ ] Create respawn system for out-of-bounds
- [ ] Add velocity-based camera effects

### Track Generation
- [ ] Design procedural spline generation algorithm
- [ ] Create biome-specific track variations
- [ ] Implement difficulty progression system
- [ ] Add obstacle placement system

---

## Phase 3: Polish & Content

### Visual Effects
- [ ] Implement water spray particles
- [ ] Add motion blur for speed sensation
- [ ] Create environmental fog/atmosphere
- [ ] Design lighting for canyon ambiance

### Audio
- [ ] Rushing water ambiance
- [ ] Speed-based wind sounds
- [ ] Collision/impact effects

---

## Technical Debt & Notes

### Known Issues
- Trimesh colliders are expensive for long tracks (solved by chunking)
- Water currently static (needs shader implementation)

### Architecture Decisions
- **Spline-Based Tracks**: Chosen over heightmaps for explicit "beat" design
- **Segment System**: Enables infinite track generation
- **React Three Fiber**: Provides declarative 3D scene management

---

## File Structure Overview

```
src/
├── components/
│   ├── Player.jsx          # Player physics & controls
│   ├── TrackManager.jsx    # Segment orchestration
│   ├── TrackSegment.jsx    # Individual track piece
│   ├── RiverTrack.jsx      # Legacy single-track (deprecated)
│   └── CreekCanyon.jsx     # Legacy heightmap (deprecated)
├── Experience.jsx          # Main scene composition
├── App.tsx                 # Canvas setup
└── index.tsx              # Entry point
```
