# AGENTS.md - Watershed Project Guide

## Project Overview

**Watershed** is a high-fidelity 3D downhill action game that blends kinetic speed with survival simulation mechanics. The player navigates a river canyon from alpine source to valley delta, experiencing different biomes and environmental challenges.

### Core Philosophy: "Shedding"

The title has a double meaning:
1. **Geographical:** Traversing an interconnected water system from source to delta
2. **Kinetic:** Moving with such velocity that the player "sheds" water as they traverse past it

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| UI/Framework | React 19 + TypeScript | Component architecture, state management |
| 3D Rendering | Three.js + React Three Fiber | 3D scene graph, rendering |
| Physics | Rapier (WASM) | Rigid body physics, collisions |
| Build Tool | Vite 7 | Development server, bundling |
| Shaders | WGSL (WebGPU) | High-performance GPU compute |
| Package Manager | pnpm/npm | Dependency management |

### Key Dependencies

```json
{
  "@react-three/fiber": "^9.4.0",
  "@react-three/drei": "^10.7.7",
  "@react-three/rapier": "^2.2.0",
  "three": "^0.182.0",
  "@webgpu/types": "^0.1.64"
}
```

## Directory Structure

```
/workspaces/Watershed/
├── src/                          # React application source
│   ├── components/               # 3D components and game objects
│   │   ├── Player.jsx           # Player physics & first-person controls
│   │   ├── TrackManager.jsx     # Procedural segment generation
│   │   ├── TrackSegment.jsx     # Individual track piece with decorations
│   │   ├── FlowingWater.jsx     # Animated water surface shader
│   │   ├── Environment/         # Biome decorations (trees, rocks, particles)
│   │   ├── Obstacles/           # Collision objects
│   │   ├── VFX/                 # Visual effects
│   │   ├── UI.tsx               # Game UI overlay
│   │   └── Loader.tsx           # Asset loading screen
│   ├── systems/                 # Game systems (planned)
│   ├── utils/                   # Utility functions
│   │   └── RiverShader.js       # Material extensions for wetness/moss/caustics
│   ├── Experience.jsx           # Main scene composition
│   ├── App.tsx                  # Canvas setup
│   ├── index.tsx                # Entry point
│   └── style.css                # Global styles
├── public/                      # Static assets
│   ├── shaders/                 # WGSL shader files
│   │   ├── water.wgsl          # Water surface shader
│   │   ├── sky.wgsl            # Skybox/equirectangular shader
│   │   ├── terrain.wgsl        # Terrain displacement shader
│   │   └── tree.wgsl           # Instanced tree shader with wind
│   ├── Rock031_1K-JPG_*.jpg    # PBR texture set (color, normal, roughness, AO)
│   └── rapier.wasm             # Physics engine WASM
├── assembly/                    # AssemblyScript (future WASM optimizations)
│   └── index.ts                # Placeholder for terrain generation
├── emscripten/                  # C++ Emscripten (future physics migration)
│   ├── main.cpp                # Placeholder for water simulation
│   └── build.sh                # Build script
├── build/                       # Production build output
├── build_and_patch.py          # Build + path patching script
├── deploy.py                   # SFTP deployment script
├── verify_visuals.py           # Visual regression testing
├── verify_visuals_playwright.py # Playwright-based verification
├── vite.config.ts              # Vite configuration
├── tsconfig.json               # TypeScript configuration
└── package.json                # Dependencies and scripts
```

## Build Commands

### Development
```bash
# Start development server (port 3000)
npm start
# or
npm run dev
```

### Production Build
```bash
# Build and patch for relative paths
python3 build_and_patch.py

# This script:
# 1. Runs `pnpm run build` (outputs to build/)
# 2. Patches index.html to use relative paths (src="./" instead of src="/")
# 3. Runs deploy.py if available
```

### Testing
```bash
# Run unit tests (Jest/React Testing Library)
npm test

# Visual regression test (requires dev server running)
python3 verify_visuals_playwright.py

# Alternative visual test
python3 verify_visuals.py
```

### Deployment
```bash
# Deploy build/ directory to server via SFTP
python3 deploy.py

# Configured for: test.1ink.us/watershed
```

## Key Technical Details

### 1. Track System Architecture

The game uses a **chunk-based treadmill system** for infinite procedural generation:

- **TrackManager.jsx**: Orchestrates segments, handles generation/unloading
  - `GENERATION_THRESHOLD = 150`: Distance before generating new segment
  - `MAX_ACTIVE_SEGMENTS = 7`: Pool size for active segments
  - Segments are defined by CatmullRom curves with 4 control points each

- **TrackSegment.jsx**: Renders individual track pieces
  - U-shaped canyon cross-section with water at bottom
  - Procedural decoration placement (rocks, trees, vegetation)
  - Biome-specific configurations

### 2. Player Controls

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

### 3. Shader Systems

**FlowingWater.jsx**: Custom material with shader injection
- Simplex noise for wave displacement
- Flowing foam effect with animated UVs
- Depth-based color gradient (deep vs shallow)
- Edge foam for shoreline interaction

**RiverShader.js**: Material extension utility
- Wetness: Darkens surfaces near water (Y=0.5)
- Moss: Green tint on upward-facing slopes near water
- Caustics: Animated light patterns below water surface

**WGSL Shaders** (in public/shaders/):
- Used for future WebGPU-native rendering
- Currently placeholders for migration path

### 4. Biome System

Segments support different biome types with visual and gameplay variations:

| Biome | Characteristics |
|-------|-----------------|
| summer | Default green, full tree density |
| autumn | Orange/red foliage, reduced density, falling leaves |

### 5. Coordinate System

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

Player Spawn: [0, 2, -10] (center, above water, downstream)
```

## Development Conventions

### Code Style

1. **Components**: Use functional components with hooks
2. **Imports**: Group by external → internal → relative
3. **Physics**: Always use RigidBody with custom colliders (not auto-generated)
4. **Materials**: Extend via `onBeforeCompile` for shader injection
5. **Memory**: Use object pooling for frequently created/destroyed objects

### File Naming

- Components: PascalCase (e.g., `TrackManager.jsx`)
- Utilities: camelCase (e.g., `riverShader.js`)
- Shaders: lowercase with extension (e.g., `water.wgsl`)

### Shader Injection Pattern

```javascript
material.onBeforeCompile = (shader) => {
    // Add uniforms
    shader.uniforms.time = { value: 0 };
    
    // Inject vertex shader
    shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `
        #include <common>
        uniform float time;
        `
    );
    
    // Store for updates
    material.userData.shader = shader;
};

// Update in useFrame
useFrame((state) => {
    if (material.userData.shader) {
        material.userData.shader.uniforms.time.value = state.clock.elapsedTime;
    }
});
```

## Testing Strategy

### Manual Testing Checklist

Before committing changes, verify:
- [ ] Player spawns correctly (not in geometry)
- [ ] Movement controls work (WASD + mouse look)
- [ ] Jump and physics respond correctly
- [ ] Track generates as player moves forward
- [ ] Textures load and display properly
- [ ] Performance stays above 30 FPS
- [ ] No console errors

### Visual Regression

The `verify_visuals_playwright.py` script:
1. Launches headless Chromium
2. Navigates to localhost:3000
3. Waits for assets to load
4. Hides UI overlay
5. Captures screenshot to `verification_visuals.png`

### Performance Targets

- **FPS**: 60 (locked to refresh rate)
- **Frame Time**: <16.67ms
- **Memory**: <300MB after initial load
- **Load Time**: <3 seconds (with caching)

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

## Planned Migrations (Future Work)

### AssemblyScript (assembly/)
- Terrain generation
- Noise functions
- Procedural decoration placement
- LOD calculations

### C++ Emscripten (emscripten/)
- Water simulation (shallow water equations)
- Advanced physics calculations
- Particle systems
- Raycast optimization

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/App.tsx` | Canvas configuration, error boundaries |
| `src/Experience.jsx` | Scene composition, physics wrapper |
| `src/components/Player.jsx` | First-person controls, camera |
| `src/components/TrackManager.jsx` | Procedural generation orchestration |
| `src/components/TrackSegment.jsx` | Canyon geometry, decorations |
| `src/components/FlowingWater.jsx` | Water surface shader material |
| `src/utils/RiverShader.js` | Material extension utilities |
| `src/style.css` | UI styles, loader, crosshair |
| `public/shaders/*.wgsl` | WebGPU shader source |

## Documentation

Additional documentation files in the project:
- `README.md` - High-level project overview
- `PLAN.md` - Development roadmap and phase planning
- `TESTING.md` - Detailed testing procedures
- `CHANGES_SUMMARY.md` - Recent changes log
- `src/LEVEL_DESIGN.md` - Track configuration and level design
