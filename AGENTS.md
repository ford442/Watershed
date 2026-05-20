<!-- From: /root/watershed/AGENTS.md -->
# AGENTS.md - Watershed Project Guide

## Project Overview

**Watershed** is a high-fidelity 3D downhill action game that blends kinetic speed with survival simulation mechanics. The player navigates a river canyon from alpine source to valley delta, experiencing different biomes and environmental challenges.

The project is packaged as `webgpu-react-app` (v0.1.0) in `package.json`.

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
| Build Tool | Vite 7.3.1 | Development server, bundling, production builds |
| Test Runner | react-scripts 5.0.1 (Jest + React Testing Library) | Unit and component tests |
| Audio | Howler 2.2.4 | Sound effects and ambient audio |
| ML | @xenova/transformers | Client-side ML features |
| Shaders | GLSL (injected) + WGSL (WebGPU future) | GPU effects and compute |
| Package Manager | pnpm (lockfile: `pnpm-lock.yaml`) | Dependency management |
| Validation | ajv + ajv-formats | JSON schema validation for levels and reaches |

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
  "@webgpu/types": "^0.1.64",
  "ajv": "^8.18.0",
  "postprocessing": "^6.38.3"
}
```

### Configuration Files

| File | Purpose |
|------|---------|
| `vite.config.ts` | Primary build config. Dev server on port 3000, `base: './'`, manual chunks for `vendor-three`, `vendor-post`, `vendor-rapier`. Output dir: `build/`. |
| `tsconfig.json` | TypeScript config: `target: es5`, `jsx: react-jsx`, `strict: true`, includes `src/`. |
| `package.json` | Dependencies and npm scripts. Uses pnpm. |
| `webpack.config.js` | **Legacy/unused.** Leftover from earlier toolchain; Vite is the active bundler. |

---

## Directory Structure

```
/root/watershed/
├── src/                          # React application source
│   ├── components/               # 3D components and game objects
│   │   ├── Player.jsx            # Player physics & first-person controls
│   │   ├── Player.tsx            # TypeScript stub/legacy for Player
│   │   ├── TrackManager.jsx      # Procedural segment generation orchestration
│   │   ├── TrackSegment.jsx      # Individual track piece with decorations
│   │   ├── FlowingWater.jsx      # Animated water surface shader material
│   │   ├── FlowingWater.test.tsx # Unit tests for water component
│   │   ├── UI.tsx                # Game UI overlay
│   │   ├── UI.test.tsx           # UI unit tests
│   │   ├── UI_new_features.test.tsx
│   │   ├── UI_shortcuts.test.tsx
│   │   ├── Loader.tsx            # Asset loading screen
│   │   ├── Loader.test.tsx       # Loader unit tests
│   │   ├── ErrorBoundary.tsx     # React error boundary
│   │   ├── GameHUD.tsx           # In-game HUD overlay
│   │   ├── VehicleTuner.tsx      # Vehicle tuning UI
│   │   ├── WeatherSystem.tsx     # Weather state and effects
│   │   ├── FlowForecast.tsx      # River flow forecast logic
│   │   ├── ForecastHUD.tsx       # Forecast display overlay
│   │   ├── PostProcessingEffects.jsx / .tsx # Bloom, vignette, SSAO, speed effects
│   │   ├── EnhancedSky.jsx       # Sky dome with biome coloring
│   │   ├── WaterReflection.jsx   # Planar water reflections
│   │   ├── WaterInteraction.jsx  # Player-water interaction FX
│   │   ├── ShaderBrowserPanel.tsx # In-game shader browser UI
│   │   ├── CanyonDecorations.jsx # Canyon-specific decorations
│   │   ├── CreekCanyon.jsx       # Canyon geometry component
│   │   ├── RiverTrack.jsx        # River track visualization
│   │   ├── TreeSystem.jsx        # Procedural tree placement
│   │   ├── InstancedRiverProps.tsx # Instanced props along river
│   │   ├── LumberProps.tsx       # Lumber/debris props
│   │   ├── CollisionParticles.tsx # Collision particle FX
│   │   ├── VortexVisual.tsx      # Vortex visual effect
│   │   ├── ReactiveAudio.tsx     # Reactive audio visualization
│   │   ├── Raft.jsx              # Legacy raft component stub
│   │   ├── WaterFlowForce.jsx / WaterFlowForces.tsx / WaterForces.jsx # Flow forces
│   │   ├── Environment/          # Biome decorations (25+ components)
│   │   │   ├── Vegetation.jsx    # Trees with wind animation
│   │   │   ├── Grass.jsx         # Grass patches
│   │   │   ├── Birds.jsx         # Bird flocks
│   │   │   ├── Fish.jsx          # Underwater fish
│   │   │   ├── Fireflies.jsx     # Night lighting effects
│   │   │   ├── Mist.jsx          # Atmospheric fog patches
│   │   │   ├── WaterfallParticles.jsx  # Waterfall spray VFX
│   │   │   ├── SunShafts.jsx     # Volumetric sun shafts
│   │   │   ├── Foliage.jsx       # Generic foliage system
│   │   │   ├── Ferns.jsx         # Fern plants
│   │   │   ├── Mushrooms.jsx     # Mushroom clusters
│   │   │   ├── Reeds.jsx         # Reed plants
│   │   │   ├── Wildflowers.jsx   # Wildflower patches
│   │   │   ├── WaterLilies.jsx   # Water lily pads
│   │   │   ├── Driftwood.jsx     # Driftwood debris
│   │   │   ├── FloatingDebris.jsx # Floating trash/debris
│   │   │   ├── Rapids.jsx        # Rapid water FX
│   │   │   ├── RockFoam.jsx      # Foam around rocks
│   │   │   ├── FallingLeaves.jsx # Autumn leaf particles
│   │   │   ├── Dragonflies.jsx   # Dragonfly swarms
│   │   │   ├── Pebbles.jsx       # Scattered pebbles
│   │   │   ├── Pinecone.jsx      # Pinecone debris
│   │   │   ├── TreeAssets.js     # Tree geometry assets
│   │   │   └── DebrisAssets.js   # Debris geometry assets
│   │   ├── Obstacles/            # Collision objects
│   │   │   └── Rock.jsx          # Procedural rock formations
│   │   ├── VFX/                  # Visual effects
│   │   │   └── SplashParticles.jsx  # Player movement splash
│   │   └── LevelEditor/          # In-game level editing tools
│   │       ├── BiomeSelector.tsx
│   │       ├── SegmentInspector.tsx
│   │       ├── LevelEditor.tsx
│   │       ├── PathVisualizer.tsx
│   │       └── ErrorPanel.tsx
│   ├── systems/                  # Core game systems
│   │   ├── AudioSystem.ts        # Sound management and Howler orchestration
│   │   ├── BiomeSystem.tsx       # Biome state, transitions, material switching
│   │   ├── LODManager.tsx        # Level-of-detail optimization
│   │   ├── SplashSystem.tsx      # Splash particle management
│   │   ├── VehicleSystem.ts      # Vehicle state orchestration and switching
│   │   ├── WaterSystem.ts        # Water simulation state
│   │   ├── LevelLoader.tsx       # External level JSON loader
│   │   ├── ReachStreamer.ts      # Reach asset streaming (outside Suspense)
│   │   ├── ReachNormalizer.ts    # Reach manifest → TrackManager data
│   │   ├── ReachManager.tsx      # Reach loading orchestration
│   │   ├── MapSystem.ts          # Map/mini-map data management
│   │   ├── ObjectSystem.ts       # Object pooling and lifecycle
│   │   ├── ParticlePool.ts       # Reusable particle pool
│   │   ├── PostProcessing.tsx    # Post-processing pipeline setup
│   │   ├── index.ts              # Systems barrel export
│   │   ├── __tests__/            # System-level tests
│   │   └── volumetric/           # Volumetric effect systems
│   ├── vehicles/                 # Vehicle implementations
│   │   ├── RunnerVehicle.tsx     # On-foot player vehicle
│   │   └── RaftVehicle.tsx       # Water raft with buoyancy physics
│   ├── hooks/                    # Custom React hooks
│   │   ├── useCameraShake.ts     # Camera shake effect hook
│   │   ├── useLevel.ts           # Level loading state hook
│   │   ├── useRiverAudio.ts      # River ambient audio hook
│   │   ├── useNightMode.ts       # Night/day cycle hook
│   │   ├── useShaderBrowser.ts   # Shader browser state hook
│   │   ├── useShaderLoader.ts    # Dynamic shader loading hook
│   │   ├── useVortexForce.ts     # Vortex physics force hook
│   │   ├── useWaterFlowField.ts  # Water flow field data hook
│   │   └── index.ts              # Hooks barrel export
│   ├── materials/                # Custom shader materials
│   │   ├── CausticsMaterial.js   # Underwater light caustics
│   │   ├── CanyonMaterial.js     # Canyon wall surface shaders
│   │   └── EnhancedWaterMaterial.js # Advanced water rendering
│   ├── utils/                    # Utility functions
│   │   ├── RiverShader.js        # Material extensions for wetness/moss/caustics
│   │   ├── RiverShader.test.ts   # RiverShader unit tests
│   │   ├── levelValidator.ts     # Level JSON schema validation
│   │   ├── levelValidator.test.ts # Level validator unit tests
│   │   ├── reachValidator.ts     # Reach manifest schema validation
│   │   └── segmentSampler.ts     # Segment curve sampling utilities
│   ├── constants/                # Game constants
│   │   ├── game.ts               # Physics, spawn, generation constants
│   │   ├── biomes.ts             # Biome configuration
│   │   ├── nightMode.ts          # Night mode settings
│   │   ├── audioConfig.ts        # Audio configuration
│   │   ├── vehicleTuning.ts      # Vehicle tuning parameters
│   │   ├── waterFlow.ts          # Water flow constants
│   │   └── weather.ts            # Weather state constants
│   ├── configs/                  # Track and biome configs
│   │   ├── BiomePalettes.ts      # Biome color/material palettes
│   │   └── TrackBiomes.ts        # Track-to-biome mappings
│   ├── biomes/                   # Biome components
│   │   └── CanyonBiome.tsx       # Canyon biome renderer
│   ├── formats/                  # Level format definitions
│   │   ├── LevelFormat.md        # Level format documentation
│   │   ├── README.md             # Formats directory readme
│   │   ├── level.schema.json     # Level JSON schema
│   │   └── reach.schema.json     # Reach manifest JSON schema
│   ├── maps/                     # Map data files
│   │   ├── meander_to_waterfall.json
│   │   └── meander_to_waterfall.ts
│   ├── Experience.jsx            # Main scene composition, keyboard controls, lighting
│   ├── App.tsx                   # Canvas setup, error boundaries, progress tracking
│   ├── index.tsx                 # Entry point with Rapier pre-init, global error handlers
│   ├── style.css                 # Global styles, UI, loader, crosshair
│   ├── LEVEL_DESIGN.md           # Level design specifications
│   └── PLAN.md                   # Component-level planning
├── public/                       # Static assets
│   ├── shaders/                  # WGSL shader files (WebGPU migration path)
│   │   ├── water.wgsl            # Water surface shader
│   │   ├── terrain.wgsl          # Terrain displacement shader
│   │   ├── sky.wgsl              # Skybox shader
│   │   └── tree.wgsl             # Instanced tree shader
│   ├── levels/                   # Custom level JSON files
│   │   ├── autumn-rapids.json
│   │   ├── devils-gorge.json
│   │   └── gentle-creek.json
│   ├── Rock031_1K-JPG_*.jpg     # PBR texture set (color, normal, roughness, AO, displacement)
│   ├── Rock031.png               # Rock texture atlas
│   ├── collision.wav             # Collision sound effect
│   ├── rapier.wasm               # Physics engine WASM
│   └── index.html                # HTML entry point
├── build/                        # Production build output (Vite)
├── assembly/                     # AssemblyScript future migration
│   └── index.ts                  # AssemblyScript entry
├── emscripten/                   # C++ Emscripten future migration
│   ├── build.sh                  # Emscripten build script
│   └── main.cpp                  # C++ entry point
├── build_and_patch.py            # Build + relative path patching script
├── deploy.py                     # SFTP deployment script
├── verify_visuals_playwright.py  # Visual regression testing (Playwright)
├── test-browser.js               # Browser test helper
├── diagnose.js                   # Startup diagnostics script
├── vite.config.ts                # Vite configuration
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # Dependencies and scripts
├── pnpm-lock.yaml                # pnpm lockfile
├── webpack.config.js             # Legacy webpack config (unused)
├── plan.md                       # Development roadmap
├── weekly_plan.md                # Weekly planning
├── river_plan.md                 # River system planning
├── plan-dec-25.md                # December 2025 planning
├── TESTING.md                    # Testing procedures and QA
├── CODE_HEALTH_GUIDE.md          # Defensive coding patterns and red flags
├── STARTUP_DIAGNOSTICS.md        # Startup issue diagnostics
├── QUICK_TROUBLESHOOTING.md      # Quick troubleshooting guide
├── INVESTIGATION_SUMMARY.md      # Investigation summaries
├── CHANGES_SUMMARY.md            # Recent changes log
├── VISUAL_ENHANCEMENT_SUMMARY.md # Visual enhancement log
├── LEVEL_AUTHORING_SUMMARY.md    # Level authoring summary
├── IMPROVEMENT_PLAN.md           # Improvement planning
├── DOCUMENTATION_INDEX.md        # Documentation index
├── PHYSICS_CONSTANTS.md          # Physics constants reference
├── CLAUDE.md                     # Claude-specific context
├── AGENTS.md                     # This file
└── README.md                     # Human-facing project overview
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

**Visual Regression Requirements:**
```bash
pip install playwright
playwright install chromium
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

Player spawn: `[0, 10, -10]` (center, above canyon rim, downstream)  
Camera height offset: `0.8`

### 4. Vehicles

The game supports two vehicle types:

- **RunnerVehicle (`src/vehicles/RunnerVehicle.tsx`)**: Default on-foot movement with first-person controls.
- **RaftVehicle (`src/vehicles/RaftVehicle.tsx`)**: Water raft with buoyancy physics, drag, paddle thrust, and tipping mechanics.

Vehicle switching is orchestrated by `src/systems/VehicleSystem.ts`.

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

### 8. River Reach System (Single-Reach v1)

The game is transitioning from pure procedural generation to structured **River Reaches** — authored 8–18 minute river segments loaded from a backend.

**Architecture:**
- `ReachStreamer.ts` — Background asset manager that fetches manifest + assets **outside React Suspense** to prevent frame hitches.
- `ReachNormalizer.ts` — Converts a Reach manifest into `TrackManager`-ready segment data.
- `ReachManager.tsx` — Orchestrates loading and feeds `TrackManager` with manifest-driven segments.

**Backend Contract:**
All manifest and asset requests route through the FastAPI storage manager:
- `GET /api/reaches/{reachId}/manifest` — Reach JSON manifest
- `GET /api/reaches/{reachId}/assets/{filename}` — Individual assets (textures, models, audio, shaders, flow maps)

**Reach Manifest Schema:** `src/formats/reach.schema.json`
Key additions over the legacy level format:
- `requiredAssets.textures[]` — PBR textures
- `requiredAssets.models[]` — GLTF models
- `requiredAssets.audio[]` — Audio stems
- `requiredAssets.shaders[]` — WGSL/GLSL shaders with `category: "generative" | "reactive" | "transition" | "filter"`
- `requiredAssets.flowMaps[]` — Water flow data (`png` | `raw` | `json`)
- `transition` — Defines the bottleneck segment (waterfall / slot canyon / splash) that masks Reach handoffs

**Transition Philosophy:** Waterfall Bottleneck
Each Reach ends in a constrained transition segment. This provides a natural pacing reset and masks asset swaps when multi-Reach campaign mode is enabled later.

**Memory Management:**
`ReachStreamer.evictReach(reachId)` recursively disposes geometries, materials, textures, audio buffers, and shaders to keep GPU/CPU memory bounded.

### 9. Physics Constants

`src/constants/game.ts` defines scientifically-grounded constants:
- `WATER_DENSITY = 1000` (kg/m³)
- `HUMAN_DENSITY = 1038` (kg/m³)
- `AIR_DENSITY = 1.226` (kg/m³)
- `WATER_VISCOSITY = 8.9e-4` (Pa·s)
- `GRAVITY = 9.80665` (m/s²)
- `PHYSICS.GRAVITY = -20` (in-game scaled gravity)
- `PHYSICS.RAFT_BUOYANCY = 2940` (scaled for gameplay)
- `PHYSICS.RAFT_DRAG = 0.47` (turbulent flow around blunt body)

### 10. Audio System

`src/systems/AudioSystem.ts` manages Howler-based audio:
- Ambient river sounds
- Collision SFX (`collision.wav`)
- Reactive audio visualization
- Integration with `src/hooks/useRiverAudio.ts`

### 11. Post-Processing Pipeline

`src/components/PostProcessingEffects.jsx` (and `.tsx`) provides:
- Bloom
- Vignette
- SSAO
- Speed-based effects (motion blur intensity tied to player velocity)
- Quality tiers managed by `src/systems/LODManager.tsx`

---

## Code Style Guidelines

### Component Structure

1. **Functional components with hooks** — No class components
2. **Forward refs for physics objects** — Expose RigidBody API to parents
3. **useMemo for expensive calculations** — Geometry, materials, instance data
4. **useFrame for animations** — Update uniforms, positions, rotations

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

- **Components:** PascalCase with `.jsx` or `.tsx` (e.g., `TrackManager.jsx`, `UI.tsx`)
- **Utilities:** camelCase with `.js` or `.ts` (e.g., `riverShader.js`)
- **Shaders:** lowercase with extension (e.g., `water.wgsl`)
- **Tests:** `ComponentName.test.tsx` alongside source
- **Constants:** camelCase, often grouped in objects with `as const` (e.g., `game.ts`)

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

See `CODE_HEALTH_GUIDE.md` for the full defensive coding standard. Critical rules:
- **Shader injection wrapped in try-catch** to prevent runtime shader compilation crashes.
- **Geometry validation before creation** — check for `NaN`, zero/negative lengths.
- **Staged rendering** — return `null` until all dependencies (textures, paths) are ready.
- **Null-safe material creation** — verify textures exist before creating materials.
- **Safe buffer attribute access** — validate `positions.count` before iterating vertices.

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
- [ ] Player spawns correctly at `[0, 10, -10]` (on canyon rim)
- [ ] Movement controls work (WASD + mouse look)
- [ ] Jump and physics respond correctly
- [ ] Track generates as player moves forward (negative Z)
- [ ] Textures load and display properly (Rock031 PBR set)
- [ ] Performance stays above 30 FPS
- [ ] No console errors
- [ ] `npm run build` succeeds without errors

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
- Check for shader compilation errors in console

### "Track not generating"
- Check TrackManager generation threshold
- Verify camera is moving in -Z direction
- Look for errors in segment generation math

### "Shaders not compiling"
- Ensure THREE.js version compatibility
- Check for syntax errors in shader injection
- Verify uniforms are properly declared
- Wrap shader modifications in try-catch and log errors

### "NaN in buffer geometry"
- Validate path lengths and curve calculations before geometry creation
- Check for division by zero or invalid Math operations
- Use safe fallbacks (e.g., `Math.max(2, Math.floor(pathLen))`)

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
| `src/Experience.jsx` | Scene composition, keyboard controls setup, lighting, biome/LOD providers |
| `src/components/Player.jsx` | First-person controls, camera, physics |
| `src/components/TrackManager.jsx` | Procedural generation orchestration |
| `src/components/TrackSegment.jsx` | Canyon geometry, decorations, segment lifecycle |
| `src/components/FlowingWater.jsx` | Water surface shader material |
| `src/components/UI.tsx` | Game menu, pause screen, controls display |
| `src/components/GameHUD.tsx` | In-game HUD overlay |
| `src/components/PostProcessingEffects.jsx` | Bloom, vignette, SSAO, speed effects |
| `src/components/WeatherSystem.tsx` | Weather state and effects |
| `src/utils/RiverShader.js` | Material extension for wetness/moss/caustics |
| `src/utils/levelValidator.ts` | Level JSON schema validation |
| `src/vehicles/RunnerVehicle.tsx` | On-foot player movement vehicle |
| `src/vehicles/RaftVehicle.tsx` | Raft buoyancy physics vehicle |
| `src/systems/VehicleSystem.ts` | Vehicle switching and state orchestration |
| `src/systems/AudioSystem.ts` | Howler-based audio management |
| `src/systems/BiomeSystem.tsx` | Biome state, transitions, material switching |
| `src/systems/LODManager.tsx` | Level-of-detail optimization, adaptive quality |
| `src/systems/ReachStreamer.ts` | Reach asset streaming (outside Suspense) |
| `src/systems/ReachManager.tsx` | Reach loading orchestration |
| `src/systems/WaterSystem.ts` | Water simulation state |
| `src/systems/LevelLoader.tsx` | External level JSON loading |
| `src/hooks/useCameraShake.ts` | Camera shake effect hook |
| `src/hooks/useLevel.ts` | Level loading state hook |
| `src/hooks/useRiverAudio.ts` | River ambient audio hook |
| `src/constants/game.ts` | Physics constants, spawn positions, generation params |
| `src/constants/vehicleTuning.ts` | Vehicle tuning parameters |
| `src/constants/waterFlow.ts` | Water flow constants |
| `src/constants/weather.ts` | Weather state constants |
| `src/style.css` | UI styles, loader, crosshair, responsive design |
| `vite.config.ts` | Vite build configuration |
| `build_and_patch.py` | Build + relative path patching script |
| `verify_visuals_playwright.py` | Visual regression testing |

---

## Documentation

Additional documentation files in the project:
- `README.md` - High-level project overview
- `plan.md` - Development roadmap and phase planning
- `src/LEVEL_DESIGN.md` - Track configuration and level design specifications
- `TESTING.md` - Detailed testing procedures
- `CODE_HEALTH_GUIDE.md` - Defensive coding patterns, shader/geometry validation, red flags
- `STARTUP_DIAGNOSTICS.md` - Startup issue diagnostics
- `QUICK_TROUBLESHOOTING.md` - Quick troubleshooting guide
- `CHANGES_SUMMARY.md` - Recent changes log
- `VISUAL_ENHANCEMENT_SUMMARY.md` - Visual enhancement log
- `LEVEL_AUTHORING_SUMMARY.md` - Level authoring summary
- `IMPROVEMENT_PLAN.md` - Improvement planning
- `DOCUMENTATION_INDEX.md` - Documentation index
- `PHYSICS_CONSTANTS.md` - Physics constants reference
- `CLAUDE.md` - Claude-specific context

---

## Security Considerations

1. **No sensitive data in client code** — The `deploy.py` script contains hardcoded SFTP credentials. It is **not** bundled into the app, but keep it out of version control if the repo becomes public.
2. **WASM integrity** — Rapier WASM is loaded from a known source (`@dimforge/rapier3d-compat`).
3. **Pointer lock requires user gesture** — Browser security prevents programmatic pointer lock.
4. **CORS for textures** — Ensure textures load from same origin or proper CORS headers.
5. **External level loading** — `?levelUrl=` parameter loads arbitrary URLs; validate origins if deploying in untrusted environments.
