# Systems Directory - Core Game Systems

## Overview
This directory contains the core game systems that manage state, streaming, performance, and gameplay logic separate from visual components.

---

## Systems to Implement

### Priority 1: Essential Systems

#### ChunkManager.ts
**Purpose:** Implement "treadmill" system for infinite track streaming
**Status:** Not started

**Responsibilities:**
- Track player position along the river path
- Load/unload track chunks based on proximity
- Maintain circular buffer of active chunks
- Coordinate with ObjectPool for recycling

**Key Features:**
- [ ] Define chunk size (e.g., 50m segments)
- [ ] Preload chunks ahead of player (2-3 chunks)
- [ ] Unload chunks behind player (keep 1 for backtracking)
- [ ] Smooth transitions between chunks
- [ ] Seed-based generation for reproducibility

**API:**
```typescript
interface Chunk {
  id: string;
  position: Vector3;
  geometry: BufferGeometry;
  collider: RigidBody;
  obstacles: GameObject[];
}

class ChunkManager {
  loadChunk(seed: number, position: Vector3): Chunk;
  unloadChunk(chunkId: string): void;
  getActiveChunks(): Chunk[];
  update(playerPosition: Vector3): void;
}
```

---

#### ObjectPool.ts
**Purpose:** Reusable object pooling to minimize GC pressure
**Status:** Not started

**Responsibilities:**
- Manage pools of frequently spawned objects
- Recycle objects instead of destroying them
- Reduce garbage collection pauses
- Improve frame time consistency

**Object Types to Pool:**
- Rocks (obstacles)
- Water particles (splashes, foam)
- Sound effect instances
- UI elements (damage indicators)

**Key Features:**
- [ ] Generic pooling interface
- [ ] Automatic pool size management
- [ ] Reset callbacks for object reuse
- [ ] Performance tracking (pool hit rate)

**API:**
```typescript
interface IPoolable {
  reset(): void;
  isActive(): boolean;
}

class ObjectPool<T extends IPoolable> {
  constructor(factory: () => T, initialSize: number);
  acquire(): T;
  release(obj: T): void;
  prewarm(count: number): void;
  getStats(): PoolStats;
}
```

---

#### ScoreSystem.ts
**Purpose:** Momentum-based scoring and gameplay feedback
**Status:** Not started

**Responsibilities:**
- Calculate score based on speed and flow
- Track multiplier streaks
- Detect flow state (continuous movement)
- Award points for techniques (jumps, wall-rides)

**Scoring Rules:**
- Base score = distance traveled
- Multiplier increases with sustained high speed
- Multiplier resets when speed drops below threshold
- Bonus points for air time, near-misses with obstacles

**Key Features:**
- [ ] Real-time score calculation
- [ ] Multiplier system (1x to 10x)
- [ ] Combo tracking (consecutive tricks)
- [ ] High score persistence (localStorage)

**API:**
```typescript
interface ScoreState {
  score: number;
  multiplier: number;
  distance: number;
  maxSpeed: number;
  comboCount: number;
}

class ScoreSystem {
  update(playerState: PlayerState, delta: number): void;
  getScore(): ScoreState;
  resetRun(): void;
  addBonus(type: BonusType, value: number): void;
}
```

---

### Priority 2: Performance Systems

#### Physics/PhysicsWorker.ts
**Purpose:** Move Rapier physics to Web Worker
**Status:** Not started

**Responsibilities:**
- Run physics simulation off main thread
- Send state updates to main thread
- Receive input commands from main thread
- Synchronize with render loop

**Benefits:**
- Prevents physics from blocking rendering
- More consistent frame times
- Can run physics at different update rate (60Hz vs 30Hz)

**Key Features:**
- [ ] Worker message protocol
- [ ] State serialization/deserialization
- [ ] Input buffering
- [ ] Interpolation for smooth rendering

**Architecture:**
```
Main Thread (Render)          Web Worker (Physics)
     |                              |
     |-- Player Input ------------->|
     |                              |
     |                       Update Physics (30Hz)
     |                              |
     |<-- Transform Updates --------|
     |                              |
  Interpolate (60fps)               |
     |                              |
   Render                           |
```

---

#### Physics/WaterForces.ts
**Purpose:** Calculate water flow forces affecting player
**Status:** Not started

**Responsibilities:**
- Compute flow direction and velocity
- Apply current force to player rigid body
- Handle drag/resistance in water
- Detect when player enters/exits water

**Physics Model:**
- Flow direction follows river curve tangent
- Flow speed increases on slopes
- Drag proportional to velocity squared
- Buoyancy when submerged

**Key Features:**
- [ ] Flow field generation along river path
- [ ] Smooth force transitions
- [ ] Configurable flow strength
- [ ] Visual debug overlay

**API:**
```typescript
interface WaterForce {
  direction: Vector3;
  strength: number;
  position: Vector3;
}

class WaterForceSystem {
  calculateForce(position: Vector3): WaterForce;
  applyToRigidBody(rb: RigidBody, force: WaterForce): void;
  getFlowVisualization(): Vector3[]; // Debug
}
```

---

### Priority 3: Gameplay Systems

#### InputManager.ts
**Purpose:** Centralized input handling and rebinding
**Status:** Not started

#### GameStateManager.ts
**Purpose:** Global game state and lifecycle management
**Status:** Not started

#### CheckpointSystem.ts
**Purpose:** Save player progress along the track
**Status:** Not started

---

### Priority 4: Advanced Systems

#### AudioManager.ts
**Purpose:** 3D audio system with spatial sound
**Status:** Not started

#### ReplaySystem.ts
**Purpose:** Record and playback player runs
**Status:** Not started

#### PerformanceMonitor.ts
**Purpose:** Real-time performance profiling
**Status:** Not started

---

## Next Steps

1. **Implement ObjectPool** - Needed for chunk streaming
2. **Implement ChunkManager** - Core to gameplay expansion
3. **Create ScoreSystem** - Adds gameplay feedback
4. **Move Physics to Worker** - Performance improvement
5. **Add WaterForces** - Gameplay depth
