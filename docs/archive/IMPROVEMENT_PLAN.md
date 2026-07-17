# Watershed Code Improvement Plan

This document outlines potential code improvements for the Watershed project, organized by category and priority.

---

## Table of Contents

1. [Performance Optimizations](#1-performance-optimizations)
2. [Code Quality & Maintainability](#2-code-quality--maintainability)
3. [Type Safety](#3-type-safety)
4. [Architecture Improvements](#4-architecture-improvements)
5. [Developer Experience](#5-developer-experience)
6. [Game Logic & Features](#6-game-logic--features)

---

## 1. Performance Optimizations

### 1.1 Object Pooling for Particles
**Priority:** High | **Effort:** Medium

**Current Issue:** Environment components (Fireflies, Fish, Birds, etc.) create new objects every segment.

**Improvement:** Implement object pooling for frequently spawned/despawned entities.

```typescript
// Create a generic object pool system
class ObjectPool<T> {
  private pool: T[] = [];
  private createFn: () => T;
  private resetFn: (item: T) => void;
  
  constructor(createFn: () => T, resetFn: (item: T) => void, initialSize = 50) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    // Pre-warm pool
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.createFn());
    }
  }
  
  acquire(): T {
    return this.pool.pop() ?? this.createFn();
  }
  
  release(item: T): void {
    this.resetFn(item);
    this.pool.push(item);
  }
}
```

### 1.2 Frustum Culling for Environment Objects
**Priority:** High | **Effort:** Medium

**Current Issue:** All environment objects render regardless of camera visibility.

**Improvement:** Implement frustum culling checks before rendering.

```typescript
// Add to TrackSegment or use useFrame
useFrame(({ camera }) => {
  const frustum = new THREE.Frustum();
  const projScreenMatrix = new THREE.Matrix4();
  projScreenMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  frustum.setFromProjectionMatrix(projScreenMatrix);
  
  // Cull objects outside frustum
  objectsRef.current.forEach(obj => {
    const visible = frustum.intersectsObject(obj);
    obj.visible = visible;
  });
});
```

### 1.3 LOD (Level of Detail) System
**Priority:** Medium | **Effort:** High

**Current Issue:** High-poly objects render at all distances.

**Improvement:** Implement distance-based LOD for vegetation and rocks.

```typescript
// LOD configuration per object type
const LOD_DISTANCES = {
  tree: { near: 0, medium: 50, far: 150 },
  rock: { near: 0, medium: 30, far: 100 },
};

// Switch geometry based on distance
const getLODGeometry = (type: string, distance: number) => {
  if (distance < LOD_DISTANCES[type].medium) return highPolyGeo;
  if (distance < LOD_DISTANCES[type].far) return mediumPolyGeo;
  return lowPolyGeo; // Billboard or simplified mesh
};
```

### 1.4 Texture Compression & Atlasing
**Priority:** Medium | **Effort:** Medium

**Current Issue:** Multiple separate texture files loaded individually.

**Improvement:** 
- Use texture atlases for environment objects
- Implement basis universal compression for textures
- Add mipmapping configuration

### 1.5 InstancedMesh Consolidation
**Priority:** Medium | **Effort:** Medium

**Current Issue:** Multiple InstancedMesh components for similar object types.

**Improvement:** Consolidate vegetation rendering into unified instanced systems.

```typescript
// Single instanced system for all vegetation types
interface VegetationInstance {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  type: 'tree' | 'fern' | 'grass';
  color: THREE.Color;
}

const UnifiedVegetation = ({ instances }: { instances: VegetationInstance[] }) => {
  // Single draw call per vegetation type
};
```

### 1.6 Shader Uniform Updates Optimization
**Priority:** High | **Effort:** Low

**Current Issue:** Multiple `useFrame` hooks updating shader uniforms separately.

**Improvement:** Centralize uniform updates in a single system.

```typescript
// src/systems/ShaderUniformSystem.ts
export const useShaderUniforms = () => {
  const materialsRef = useRef<Set<THREE.Material>>(new Set());
  
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    materialsRef.current.forEach(mat => {
      if (mat.userData.shader?.uniforms?.time) {
        mat.userData.shader.uniforms.time.value = time;
      }
    });
  });
  
  return {
    registerMaterial: (mat: THREE.Material) => materialsRef.current.add(mat),
    unregisterMaterial: (mat: THREE.Material) => materialsRef.current.delete(mat),
  };
};
```

---

## 2. Code Quality & Maintainability

### 2.1 Magic Numbers Extraction
**Priority:** High | **Effort:** Low

**Current Issue:** Hardcoded values scattered throughout code (e.g., water level 0.5, thresholds).

**Improvement:** Create centralized constants file.

```typescript
// src/constants/game.ts
export const GAME_CONSTANTS = {
  WATER_LEVEL: 0.5,
  PLAYER_SPAWN: { x: 0, y: -7, z: -10 },
  GENERATION: {
    THRESHOLD: 150,
    MAX_ACTIVE_SEGMENTS: 7,
    POOL_SIZE: 10,
  },
  PHYSICS: {
    PLAYER_SPEED: 5,
    JUMP_FORCE: 5,
    GRAVITY: -9.81,
  },
  SHADERS: {
    WATER_COLOR: '#1a7b9c',
    FOAM_COLOR: '#e0f7fa',
    MOSS_COLOR: '#2d4c1e',
  },
} as const;
```

### 2.2 Configuration-Driven Level Design
**Priority:** Medium | **Effort:** Medium

**Current Issue:** Segment configurations defined in code (`getSegmentConfig` function).

**Improvement:** Move to JSON/YAML configuration files.

```json
// config/segments.json
{
  "segmentTypes": {
    "meander": {
      "biome": "summer",
      "width": 35,
      "meanderStrength": 1.2,
      "verticalBias": -0.5
    },
    "waterfall": {
      "biome": "summer",
      "verticalBias": -3.0,
      "particleCount": 400,
      "cameraShake": 0.5
    }
  },
  "levelProgression": [
    { "segments": [0, 12], "type": "meander" },
    { "segments": [14, 14], "type": "waterfall" }
  ]
}
```

### 2.3 Remove Debug Console Logs
**Priority:** Low | **Effort:** Low

**Current Issue:** Excessive console logging in production code.

**Improvement:** 
- Replace with proper logging utility that respects environment
- Use `import.meta.env.DEV` for development-only logs

```typescript
// src/utils/logger.ts
const logger = {
  log: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.log(...args);
  },
  warn: (...args: unknown[]) => {
    if (import.meta.env.DEV) console.warn(...args);
  },
  error: (...args: unknown[]) => console.error(...args), // Always log errors
};
```

### 2.4 Shader Code Organization
**Priority:** Medium | **Effort:** Medium

**Current Issue:** Shader code embedded as strings in JavaScript.

**Improvement:** 
- Move shaders to separate `.glsl` files
- Use Vite's raw import: `import shaderCode from './shaders/water.glsl?raw'`
- Or use a shader chunk system for reusability

### 2.5 Extract Reusable Hooks
**Priority:** Medium | **Effort:** Low

**Current Issue:** Similar patterns repeated across components.

**Improvements to extract:**

```typescript
// src/hooks/usePointerLock.ts
export const usePointerLock = (canvasRef: RefObject<HTMLCanvasElement>) => {
  const [isLocked, setIsLocked] = useState(false);
  // ... implementation
};

// src/hooks/useSeededRandom.ts  
export const useSeededRandom = (seed: number) => {
  const rng = useMemo(() => createSeededRNG(seed), [seed]);
  return rng;
};

// src/hooks/useFrustumCulling.ts
export const useFrustumCulling = (objectsRef: RefObject<Object3D[]>) => {
  // ... implementation
};
```

### 2.6 Component Props Interfaces
**Priority:** High | **Effort:** Low

**Current Issue:** Inconsistent prop typing (JSX files, implicit types).

**Improvement:** Define explicit interfaces for all components.

```typescript
// src/components/TrackSegment/types.ts
export interface TrackSegmentProps {
  active: boolean;
  id: number;
  points?: THREE.Vector3[];
  type: SegmentType;
  biome: BiomeType;
  width: number;
  particleCount: number;
  flowSpeed: number;
  treeDensity: number;
  rockDensity: RockDensity;
  rockMaterial: THREE.Material | null;
  rockNormalMap: THREE.Texture | null;
}

export type SegmentType = 'normal' | 'waterfall' | 'splash' | 'pond';
export type BiomeType = 'summer' | 'autumn';
export type RockDensity = 'low' | 'medium' | 'high';
```

---

## 3. Type Safety

### 3.1 Migrate JSX to TypeScript
**Priority:** High | **Effort:** Medium

**Current Issue:** Main game components use `.jsx` extension without type checking.

**Files to migrate:**
- `Player.jsx` → `Player.tsx`
- `TrackManager.jsx` → `TrackManager.tsx`
- `TrackSegment.jsx` → `TrackSegment.tsx`
- `FlowingWater.jsx` → `FlowingWater.tsx`
- All `Environment/*.jsx` files

### 3.2 Strict TypeScript Configuration
**Priority:** Medium | **Effort:** Low

**Current Issue:** `tsconfig.json` may not have strict mode enabled.

**Improvement:** Enable strict TypeScript checks.

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### 3.3 Type Shader Uniforms
**Priority:** Medium | **Effort:** Low

**Current Issue:** Shader uniforms accessed via `any` type.

**Improvement:** Type shader userData properly.

```typescript
interface ShaderUniforms {
  time: { value: number };
  flowSpeed: { value: number };
  foamColor: { value: THREE.Color };
  waterColor: { value: THREE.Color };
}

interface ExtendedMaterial extends THREE.Material {
  userData: {
    shader?: {
      uniforms: ShaderUniforms;
    };
    uniforms?: ShaderUniforms;
  };
}
```

### 3.4 Type Physics References
**Priority:** Medium | **Effort:** Low

**Current Issue:** RigidBody refs typed as `any`.

**Improvement:** Use proper Rapier types.

```typescript
import type { RapierRigidBody } from '@react-three/rapier';

const Player = forwardRef<RapierRigidBody, PlayerProps>((props, ref) => {
  const rb = useRef<RapierRigidBody>(null);
  useImperativeHandle(ref, () => rb.current!);
  // ...
});
```

---

## 4. Architecture Improvements

### 4.1 State Management
**Priority:** Medium | **Effort:** High

**Current Issue:** State scattered across components, prop drilling for biome changes.

**Improvement:** Implement Zustand or Redux Toolkit for global state.

```typescript
// src/store/gameStore.ts
import { create } from 'zustand';

interface GameState {
  currentBiome: BiomeType;
  currentSegment: number;
  playerPosition: THREE.Vector3;
  isPaused: boolean;
  setBiome: (biome: BiomeType) => void;
  setSegment: (segment: number) => void;
  togglePause: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  currentBiome: 'summer',
  currentSegment: 0,
  playerPosition: new THREE.Vector3(),
  isPaused: false,
  setBiome: (biome) => set({ currentBiome: biome }),
  setSegment: (segment) => set({ currentSegment: segment }),
  togglePause: () => set((state) => ({ isPaused: !state.isPaused })),
}));
```

### 4.2 Entity Component System (ECS)
**Priority:** Low | **Effort:** High

**Current Issue:** Component composition is rigid, hard to add new behaviors.

**Improvement:** Consider implementing ECS for game entities.

```typescript
// Lightweight ECS for environment objects
interface Entity {
  id: string;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  components: Component[];
}

type Component = 
  | { type: 'render'; geometry: THREE.BufferGeometry; material: THREE.Material }
  | { type: 'physics'; collider: 'box' | 'sphere' | 'hull' }
  | { type: 'animation'; update: (delta: number) => void };
```

### 4.3 Asset Management System
**Priority:** Medium | **Effort:** Medium

**Current Issue:** Textures loaded in multiple places, no preloading strategy.

**Improvement:** Centralized asset manager with loading states.

```typescript
// src/systems/AssetManager.ts
class AssetManager {
  private textures: Map<string, THREE.Texture> = new Map();
  private geometries: Map<string, THREE.BufferGeometry> = new Map();
  private loadingPromises: Promise<void>[] = [];
  
  async preloadTextures(paths: string[]): Promise<void> {
    const loader = new THREE.TextureLoader();
    const promises = paths.map(path => 
      new Promise<void>((resolve) => {
        loader.load(path, (tex) => {
          this.textures.set(path, tex);
          resolve();
        });
      })
    );
    await Promise.all(promises);
  }
  
  getTexture(path: string): THREE.Texture | undefined {
    return this.textures.get(path);
  }
}

export const assetManager = new AssetManager();
```

### 4.4 Event System
**Priority:** Medium | **Effort:** Medium

**Current Issue:** Biome changes use callback props (onBiomeChange).

**Improvement:** Implement event bus for decoupled communication.

```typescript
// src/systems/EventBus.ts
type GameEvents = {
  biomeChange: { from: BiomeType; to: BiomeType };
  segmentChange: { segment: number };
  playerFall: { position: THREE.Vector3 };
  waterfallApproach: { distance: number };
};

class EventBus {
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();
  
  on<T extends keyof GameEvents>(
    event: T, 
    handler: (data: GameEvents[T]) => void
  ): () => void {
    // ... implementation
  }
  
  emit<T extends keyof GameEvents>(event: T, data: GameEvents[T]): void {
    // ... implementation
  }
}
```

### 4.5 Service Layer for Generation Logic
**Priority:** Medium | **Effort:** Medium

**Current Issue:** Procedural generation logic mixed with React components.

**Improvement:** Extract to pure TypeScript services.

```typescript
// src/services/SegmentGenerator.ts
export class SegmentGenerator {
  constructor(private config: GenerationConfig) {}
  
  generateSegment(previousSegment: Segment, id: number): Segment {
    // Pure logic, no React dependencies
  }
  
  generatePlacementData(segment: Segment): PlacementData {
    // Return placement data for all environment objects
  }
}
```

---

## 5. Developer Experience

### 5.1 ESLint & Prettier Configuration
**Priority:** Medium | **Effort:** Low

**Current Issue:** No explicit linting/formatting configuration visible.

**Improvement:** Add comprehensive ESLint config.

```javascript
// eslint.config.js
export default {
  extends: [
    'eslint:recommended',
    '@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react/recommended',
  ],
  rules: {
    'no-console': ['warn', { allow: ['error', 'warn'] }],
    '@typescript-eslint/explicit-function-return-type': 'warn',
    'react-hooks/exhaustive-deps': 'error',
  },
};
```

### 5.2 Path Aliases
**Priority:** Low | **Effort:** Low

**Current Issue:** Relative imports like `../../utils/RiverShader`.

**Improvement:** Configure path aliases in Vite and TypeScript.

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"],
      "@utils/*": ["src/utils/*"],
      "@hooks/*": ["src/hooks/*"],
      "@constants/*": ["src/constants/*"]
    }
  }
}
```

### 5.3 Development Tools Integration
**Priority:** Low | **Effort:** Low

**Improvements:**
- Add React DevTools configuration
- Add Three.js Inspector support
- Add Redux DevTools (if using Zustand/Redux)

```typescript
// src/utils/devTools.ts
export const enableDevTools = () => {
  if (import.meta.env.DEV) {
    // Enable React Three Fiber inspector
    import('@react-three/fiber').then(({ addEffect }) => {
      addEffect(() => {
        // Stats.js or custom performance panel
      });
    });
  }
};
```

### 5.4 Unit Test Coverage
**Priority:** High | **Effort:** Medium

**Current Issue:** Test files exist but may not cover core game logic.

**Improvements:**
- Test procedural generation logic
- Test shader compilation
- Test physics interactions
- Add visual regression tests

```typescript
// src/services/__tests__/SegmentGenerator.test.ts
import { SegmentGenerator } from '../SegmentGenerator';

describe('SegmentGenerator', () => {
  it('generates valid segments with connected endpoints', () => {
    const generator = new SegmentGenerator(defaultConfig);
    const segment1 = generator.generateSegment(initialSegment, 1);
    const segment2 = generator.generateSegment(segment1, 2);
    
    // Ensure segments connect
    expect(segment1.points[3]).toEqual(segment2.points[0]);
  });
  
  it('respects waterfall constraints', () => {
    // Test specific level design rules
  });
});
```

### 5.5 Documentation
**Priority:** Medium | **Effort:** Medium

**Improvements:**
- Add JSDoc comments to all public functions
- Create architecture decision records (ADRs)
- Document shader injection patterns

---

## 6. Game Logic & Features

### 6.1 Save/Checkpoint System
**Priority:** Medium | **Effort:** Medium

**Current Issue:** No persistence, restart from beginning every time.

**Improvement:** Implement localStorage-based checkpoint system.

```typescript
// src/systems/CheckpointSystem.ts
interface Checkpoint {
  segmentId: number;
  position: { x: number; y: number; z: number };
  timestamp: number;
}

export const saveCheckpoint = (checkpoint: Checkpoint): void => {
  localStorage.setItem('watershed_checkpoint', JSON.stringify(checkpoint));
};

export const loadCheckpoint = (): Checkpoint | null => {
  const saved = localStorage.getItem('watershed_checkpoint');
  return saved ? JSON.parse(saved) : null;
};
```

### 6.2 Input System Refactoring
**Priority:** Medium | **Effort:** Medium

**Current Issue:** Input handling scattered across Player, UI, and Experience.

**Improvement:** Centralized input action system.

```typescript
// src/systems/InputSystem.ts
export const InputActions = {
  MOVE_FORWARD: ['KeyW', 'ArrowUp'],
  MOVE_BACKWARD: ['KeyS', 'ArrowDown'],
  STRAFE_LEFT: ['KeyA', 'ArrowLeft'],
  STRAFE_RIGHT: ['KeyD', 'ArrowRight'],
  JUMP: ['Space'],
  PAUSE: ['Escape'],
} as const;

export const useInputSystem = () => {
  const actions = useRef(new Set<string>());
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      Object.entries(InputActions).forEach(([action, keys]) => {
        if (keys.includes(e.code)) actions.current.add(action);
      });
    };
    // ... keyup handler
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  return {
    isActionActive: (action: keyof typeof InputActions) => 
      actions.current.has(action),
  };
};
```

### 6.3 Audio System
**Priority:** Low | **Effort:** High

**Current Issue:** No audio implementation.

**Improvement:** Add positional audio using Howler.js (already in dependencies).

```typescript
// src/systems/AudioSystem.ts
import { Howl, Howler } from 'howler';

interface AudioConfig {
  waterfall: string;
  riverFlow: string;
  ambience: string;
  footsteps: string;
}

export class AudioSystem {
  private sounds: Map<string, Howl> = new Map();
  private listener: THREE.AudioListener;
  
  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
  }
  
  loadSounds(config: AudioConfig): void {
    Object.entries(config).forEach(([key, path]) => {
      this.sounds.set(key, new Howl({ src: [path], loop: true }));
    });
  }
  
  update(playerPosition: THREE.Vector3): void {
    // Update 3D audio positions based on player location
  }
}
```

### 6.4 Telemetry & Analytics
**Priority:** Low | **Effort:** Low

**Improvement:** Track player progression and performance metrics (opt-in).

```typescript
// src/systems/Telemetry.ts
export const trackEvent = (event: string, data?: Record<string, unknown>): void => {
  if (import.meta.env.PROD && navigator.sendBeacon) {
    navigator.sendBeacon('/analytics', JSON.stringify({ event, data, timestamp: Date.now() }));
  }
};

// Usage
trackEvent('segment_reached', { segmentId: currentSegment, biome });
trackEvent('fall', { position: playerPosition.toArray() });
```

### 6.5 Accessibility Improvements
**Priority:** Medium | **Effort:** Medium

**Current Issue:** Limited accessibility support.

**Improvements:**
- Add reduced motion support (partially done in CSS)
- Add keyboard-only navigation mode
- Add high contrast mode
- Add screen reader announcements for game events

```typescript
// src/components/AccessibilityProvider.tsx
export const AccessibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [highContrast, setHighContrast] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  
  // Apply classes to document
  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast);
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  }, [highContrast, reducedMotion]);
  
  return (
    <AccessibilityContext.Provider value={{ highContrast, setHighContrast, reducedMotion }}>
      {children}
    </AccessibilityContext.Provider>
  );
};
```

---

## Priority Summary

### Immediate (High Priority)
1. Extract magic numbers to constants
2. Add TypeScript types to all components (migrate JSX to TSX)
3. Centralize shader uniform updates
4. Implement object pooling for particles
5. Add frustum culling

### Short Term (Medium Priority)
1. Migrate to configuration-driven level design
2. Implement state management (Zustand)
3. Create asset management system
4. Add path aliases
5. Improve test coverage

### Long Term (Lower Priority)
1. Implement ECS architecture
2. Add full audio system
3. Implement LOD system
4. Add telemetry
5. Comprehensive documentation

---

## Estimated Effort Summary

| Category | Low Effort | Medium Effort | High Effort |
|----------|------------|---------------|-------------|
| Performance | 2 items | 3 items | 1 item |
| Code Quality | 4 items | 2 items | 0 items |
| Type Safety | 3 items | 1 item | 1 item |
| Architecture | 0 items | 3 items | 2 items |
| Developer Exp | 3 items | 2 items | 0 items |
| Game Features | 1 item | 3 items | 1 item |

---

*Document generated: 2026-02-07*
*Review and update quarterly*
