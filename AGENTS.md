# AGENTS.md - Watershed Project Guide

## Project Overview

**Watershed** is a high-fidelity 3D downhill action game that blends kinetic speed with survival simulation mechanics. The player navigates a river canyon from alpine source to valley delta, experiencing different biomes and environmental challenges.

### Core Philosophy: "Shedding"

The title has a double meaning:
1. **Geographical:** Traversing an interconnected water system from source to delta
2. **Kinetic:** Moving with such velocity that the player "sheds" water as they traverse past it

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| UI/Framework | React 19.1.1 + TypeScript 4.9.5 | Component architecture, state management |
| 3D Rendering | Three.js 0.168.0 + React Three Fiber 9.4.0 | 3D scene graph, rendering |
| Post-processing | @react-three/postprocessing 3.0.4, postprocessing 6.38.3 | Visual effects pipeline |
| Physics | Rapier 0.19.3 (WASM) via @react-three/rapier 2.2.0 | Rigid body physics, collisions |
| Build Tool | Vite 7.3.1 | Development server, bundling |
| Audio | Howler 2.2.4 | Sound effects and ambient audio |
| ML | @xenova/transformers | Client-side ML features |
| Shaders | GLSL (injected) + WGSL (WebGPU future) | GPU effects and compute |
| Package Manager | npm/pnpm | Dependency management |

### Key Dependencies

```json
{
  "@react-three/fiber": "^9.4.0",
  "@react-three/drei": "^10.7.7",
  "@react-three/rapier": "^2.2.0",
  "@react-three/postprocessing": "^3.0.4",
  "three": "^0.168.0",
  "@dimforge/rapier3d-compat": "^0.19.3",
  "howler": "^2.2.4",
  "@webgpu/types": "^0.1.64"
}
```

---

## Directory Structure

```
/root/watershed/
├── src/                          # React application source
│   ├── components/               # 3D components and game objects
│   │   ├── Player.jsx           # Player physics & first-person controls
│   │   ├── TrackManager.jsx     # Procedural segment generation orchestration
│   │   ├── TrackSegment.jsx     # Individual track piece with decorations
│   │   ├── FlowingWater.jsx     # Animated water surface shader material
│   │   ├── UI.tsx               # Game UI overlay (React + TypeScript)
│   │   ├── Loader.tsx           # Asset loading screen
│   │   ├── ErrorBoundary.tsx    # React error boundary
│   │   ├── Environment/         # Biome decorations (24+ components)
│   │   │   ├── Vegetation.jsx   # Trees with wind animation
│   │   │   ├── Grass.jsx        # Grass patches
│   │   │   ├── Birds.jsx        # Bird flocks
│   │   │   ├── Fish.jsx         # Underwater fish
│   │   │   ├── Fireflies.jsx    # Night lighting effects
│   │   │   ├── Mist.jsx         # Atmospheric fog patches
│   │   │   ├── WaterfallParticles.jsx  # Waterfall spray VFX
│   │   │   └── ... (17 more environment components)
│   │   ├── Obstacles/           # Collision objects
│   │   │   └── Rock.jsx         # Procedural rock formations
│   │   ├── VFX/                 # Visual effects
│   │   │   └── SplashParticles.jsx  # Player movement splash
│   │   └── LevelEditor/         # BiomeSelector, SegmentInspector, LevelEditor, etc.
│   ├── systems/                 # Core game systems
│   │   ├── AudioSystem.ts       # Sound management
│   │   ├── BiomeSystem.ts       # Biome state and transitions
│   │   ├── LODManager.ts        # Level-of-detail optimization
│   │   ├── SplashSystem.ts      # Splash particle management
│   │   ├── VehicleSystem.ts     # Vehicle state orchestration
│   │   └── WaterSystem.ts       # Water simulation state
│   ├── vehicles/                # Vehicle implementations
│   │   ├── RunnerVehicle.tsx    # On-foot player vehicle
│   │   └── RaftVehicle.tsx      # Water raft with buoyancy physics
│   ├── hooks/                   # Custom React hooks
│   │   ├── useCameraShake.ts
│   │   ├── useLevel.ts
│   │   └── useRiverAudio.ts
│   ├── materials/               # Custom shader materials
│   │   ├── CausticsMaterial.js
│   │   ├── CanyonMaterial.js
│   │   └── EnhancedWaterMaterial.js
│   ├── utils/                   # Utility functions
│   │   ├── RiverShader.js       # Material extensions for wetness/moss/caustics
│   │   └── levelValidator.ts    # Level JSON validation
│   ├── constants/               # Game constants
│   │   ├── game.ts              # Physics, spawn, generation constants
│   │   ├── biomes.ts            # Biome configuration
│   │   └── nightMode.ts         # Night mode settings
│   ├── configs/                 # Track and biome configs
│   │   ├── BiomePalettes.ts
│   │   └── TrackBiomes.ts
│   ├── biomes/                  # Biome components
│   │   └── CanyonBiome.tsx
│   ├── formats/                 # Level format definitions
│   ├── Experience.jsx           # Main scene composition, keyboard controls, lighting
│   ├── App.tsx                  # Canvas setup, error boundaries, progress tracking
│   ├── index.tsx                # Entry point with Rapier pre-init, global error handlers
│   └── style.css                # Global styles, UI, loader, crosshair
├── public/                      # Static assets
│   ├── shaders/                 # WGSL shader files (WebGPU migration path)
│   │   ├── water.wgsl          # Water surface shader
│   │   ├── terrain.wgsl        # Terrain displacement shader
│   │   ├── sky.wgsl            # Skybox shader
│   │   └── tree.wgsl           # Instanced tree shader
│   ├── levels/                  # Custom level JSON files
│   ├── Rock031_1K-JPG_*.jpg    # PBR texture set (color, normal, roughness, AO)
│   └── rapier.wasm             # Physics engine WASM
├── build/                       # Production build output (Vite)
├── build_and_patch.py          # Build + relative path patching script
├── deploy.py                   # SFTP deployment script
├── verify_visuals_playwright.py # Visual regression testing
├── vite.config.ts              # Vite configuration
├── tsconfig.json               # TypeScript configuration
├── package.json                # Dependencies and scripts
├── plan.md                     # Development roadmap
├── TESTING.md                  # Testing procedures and QA
└── CHANGES_SUMMARY.md          # Recent changes log
```

---

## Build and Development Commands

### Development

```bash
# Start development server (port 3000)
npm start
# or
npm run dev
# or
pnpm dev
```

### Production Build

```bash
# Build for production (outputs to build/)
npm run build

# Preview production build
npm run preview

# Full build + path patching + optional deploy
python3 build_and_patch.py
```

The `build_and_patch.py` script:
1. Runs `pnpm run build` (outputs to `build/`)
2. Patches `build/index.html` to use relative paths (`src="./"` instead of `src="/"`)
3. Runs `deploy.py` if available

### Testing

```bash
# Run unit tests (Jest/React Testing Library via react-scripts)
npm test

# Visual regression test (requires dev server running)
python3 verify_visuals_playwright.py
```

### Deployment

```bash
# Deploy build/ directory to server via SFTP
python3 deploy.py

# Configured for: test.1ink.us/watershed
```

---

## Key Technical Architecture

### 1. Track System (Chunk-Based Treadmill)

The game uses an infinite procedural generation system:

**TrackManager.jsx:**
- `GENERATION_THRESHOLD = 150`: Distance before generating new segment
- `MAX_ACTIVE_SEGMENTS = 7`: Pool size for active segments
- `POOL_SIZE = 10`: Object pool size for recycling
- `RECYCLE_MARGIN = 70`: Distance behind player to recycle segments
- Segments are defined by CatmullRom curves with 4 control points each

**TrackSegment.jsx:**
- U-shaped canyon cross-section with water at bottom
- Procedural decoration placement (25+ environment types)
- Biome-specific configurations (summer/autumn)

### 2. Level Progression

| Segment ID(s) | Phase | Type | Biome | Key Features |
|--------------|-------|------|-------|--------------|
| 0-12 | The Meander | normal | summer | Gentle river, width 35 |
| 13 | Approach | normal | summer | Steepens toward waterfall |
| 14 | The Waterfall | waterfall | summer | 400 particles, camera shake |
| 15 | Splash Pool | splash | autumn | 70 width, biome transition |
| 16-18 | The Pond | pond | autumn | 70 width, fog, reduced trees |
| 19+ | Autumn Rapids | normal | autumn | High rock density |

### 3. Player Controls

```javascript
// Movement (relative to camera view)
W / ArrowUp / RightClick    = Forward
S / ArrowDown               = Backward
A / ArrowLeft               = Strafe left
D / ArrowRight              = Strafe right
Space / W                   = Jump
ESC                         = Release pointer lock (pause)

// Mouse
Move                        = Look around
Click                       = Engage pointer lock
```

Player spawn: `[0, -4, -10]` (center, above water, downstream)  
Camera height offset: `0.8`

### 4. Vehicles

The game supports two vehicle types:

- **RunnerVehicle (`src/vehicles/RunnerVehicle.tsx`)**: Default on-foot movement with first-person controls.
- **RaftVehicle (`src/vehicles/RaftVehicle.tsx`)**: Water raft with buoyancy physics, drag, paddle thrust, and tipping mechanics.

### 5. Shader Systems

**FlowingWater.jsx:** Custom material with shader injection
- Simplex noise for wave displacement
- Flowing foam effect with animated UVs
- Depth-based color gradient (deep vs shallow)
- Edge foam for shoreline interaction

**RiverShader.js:** Material extension utility
- `extendRiverMaterial(mat)` adds:
  - **Wetness:** Darkens surfaces near water (Y=0.5)
  - **Moss:** Green tint on upward-facing slopes near water
  - **Caustics:** Animated light patterns below water surface

**Custom Materials (`src/materials/`):**
- `CausticsMaterial.js` — Underwater light caustics
- `CanyonMaterial.js` — Canyon wall surface shaders
- `EnhancedWaterMaterial.js` — Advanced water rendering

**WGSL Shaders** (in `public/shaders/`):
- Future WebGPU-native rendering path
- Currently placeholders for migration

### 6. Coordinate System

```
Y (Up)
│
│    ╔═══════════════╗  Canyon Rim (Y=15)
│    ║               ║
│    ║   Riverbed    ║  Water Level (Y=0.5)
│    ║               ║
│    ╚═══════════════╝
│
└──────────────────────→ Z (Forward/downstream)
     │
     ↓ X (Left/Right)
```

Forward gameplay movement is in the **negative Z** direction.

### 7. Custom Levels

`LevelLoader.tsx` supports loading external level JSON files via URL parameters:
- `?level=<filename>` — loads from `public/levels/`
- `?levelUrl=<url>` — loads from an arbitrary URL

Level JSON format definitions are in `src/formats/`.

---

## Code Style Guidelines

### Component Structure

1. **Functional components with hooks** - No class components
2. **Forward refs for physics objects** - Expose RigidBody API to parents
3. **useMemo for expensive calculations** - Geometry, materials, instance data
4. **useFrame for animations** - Update uniforms, positions, rotations

### Import Order

```javascript
// 1. React and external libraries
import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

// 2. React Three Fiber ecosystem
import { useTexture } from '@react-three/drei';
import { RigidBody } from '@react-three/rapier';

// 3. Internal utilities
import { extendRiverMaterial } from '../utils/RiverShader';

// 4. Relative component imports
import FlowingWater from './FlowingWater';
```

### File Naming Conventions

- **Components:** PascalCase (e.g., `TrackManager.jsx`, `UI.tsx`)
- **Utilities:** camelCase (e.g., `riverShader.js`)
- **Shaders:** lowercase with extension (e.g., `water.wgsl`)
- **Tests:** `ComponentName.test.tsx` alongside source

### Shader Injection Pattern

```javascript
const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
        map: colorMap,
        normalMap: normalMap,
        roughnessMap: roughnessMap,
    });

    mat.onBeforeCompile = (shader) => {
        // Add uniforms
        shader.uniforms.time = { value: 0 };
        
        // Inject vertex shader
        shader.vertexShader = `
            uniform float time;
            varying vec3 vWorldPos;
        ` + shader.vertexShader;
        
        // Inject fragment shader
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `
            #include <map_fragment>
            // Custom color logic here
            `
        );
        
        // Store for updates
        mat.userData.shader = shader;
    };
    
    return mat;
}, [colorMap, normalMap]);

// Update in useFrame
useFrame((state) => {
    if (material.userData.shader) {
        material.userData.shader.uniforms.time.value = state.clock.elapsedTime;
    }
});
```

### Code Health Conventions

Enforced by `CODE_HEALTH_GUIDE.md`:
- **Shader injection wrapped in try-catch** to prevent runtime shader compilation crashes.
- **Geometry validation before creation** — check for `NaN`, zero/negative lengths.
- **Staged rendering** — return `null` until all dependencies (textures, paths) are ready.

---

## Testing Strategy

### Unit Tests

Located in `src/components/*.test.tsx` and `src/utils/*.test.ts`:
- `src/components/FlowingWater.test.tsx`
- `src/components/Loader.test.tsx`
- `src/components/UI.test.tsx`
- `src/components/UI_new_features.test.tsx`
- `src/components/UI_shortcuts.test.tsx`
- `src/utils/RiverShader.test.ts`
- `src/utils/levelValidator.test.ts`

Run with: `npm test`

### Manual Testing Checklist

Before committing changes, verify:
- [ ] Player spawns correctly at `[0, -4, -10]` (not in geometry)
- [ ] Movement controls work (WASD + mouse look)
- [ ] Jump and physics respond correctly
- [ ] Track generates as player moves forward (negative Z)
- [ ] Textures load and display properly (Rock031 PBR set)
- [ ] Performance stays above 30 FPS
- [ ] No console errors

### Visual Regression

The `verify_visuals_playwright.py` script:
1. Launches headless Chromium
2. Navigates to `localhost:3000`
3. Waits for assets to load (`.start-button:not([disabled])`)
4. Hides UI overlay
5. Captures screenshot to `verification_visuals.png`

Requirements:
```bash
pip install playwright
playwright install chromium
```

### Performance Targets

| Metric | Target |
|--------|--------|
| FPS | 60 (locked to refresh rate) |
| Frame Time | <16.67ms |
| Memory | <300MB after initial load |
| Load Time | <3 seconds (with caching) |

---

## Common Issues and Solutions

### "Player falls through floor"
- Physics may not be initialized
- Check that RigidBody has proper collider
- Verify player spawn Y position is above geometry

### "Black screen on load"
- Check browser console for WebGL errors
- Verify textures are loading (network tab)
- Try disabling browser extensions

### "Track not generating"
- Check TrackManager generation threshold
- Verify camera is moving in -Z direction
- Look for errors in segment generation math

### "Shaders not compiling"
- Ensure THREE.js version compatibility
- Check for syntax errors in shader injection
- Verify uniforms are properly declared

---

## Browser Requirements

- **Chrome 90+** (recommended)
- **Firefox 88+**
- **Safari 15+**
- **Edge 90+**

Required features:
- WebGL 2.0
- Pointer Lock API
- WebAssembly
- ES6+ JavaScript

---

## Future Migrations

### AssemblyScript (`assembly/`)
Planned for:
- Terrain generation
- Noise functions
- Procedural decoration placement
- LOD calculations

### C++ Emscripten (`emscripten/`)
Planned for:
- Water simulation (shallow water equations)
- Advanced physics calculations
- Particle systems
- Raycast optimization

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/App.tsx` | Canvas configuration, error boundaries, progress tracking |
| `src/Experience.jsx` | Scene composition, keyboard controls setup, lighting |
| `src/components/Player.jsx` | First-person controls, camera, physics |
| `src/components/TrackManager.jsx` | Procedural generation orchestration |
| `src/components/TrackSegment.jsx` | Canyon geometry, decorations, segment lifecycle |
| `src/components/FlowingWater.jsx` | Water surface shader material |
| `src/components/UI.tsx` | Game menu, pause screen, controls display |
| `src/utils/RiverShader.js` | Material extension for wetness/moss/caustics |
| `src/vehicles/RunnerVehicle.tsx` | On-foot player movement vehicle |
| `src/vehicles/RaftVehicle.tsx` | Raft buoyancy physics vehicle |
| `src/systems/VehicleSystem.ts` | Vehicle switching and state orchestration |
| `src/constants/game.ts` | Physics constants, spawn positions, generation params |
| `src/style.css` | UI styles, loader, crosshair, responsive design |

---

## Documentation

Additional documentation files in the project:
- `README.md` - High-level project overview
- `plan.md` - Development roadmap and phase planning
- `src/LEVEL_DESIGN.md` - Track configuration and level design specifications
- `TESTING.md` - Detailed testing procedures
- `CODE_HEALTH_GUIDE.md` - Code quality and health conventions
- `CHANGES_SUMMARY.md` - Recent changes log

---

## Security Considerations

1. **No sensitive data in client code** - The `deploy.py` contains server credentials but is not bundled into the app
2. **WASM integrity** - Rapier WASM is loaded from a known source (`@dimforge/rapier3d-compat`)
3. **Pointer lock requires user gesture** - Browser security prevents programmatic pointer lock
4. **CORS for textures** - Ensure textures load from same origin or proper CORS headers
