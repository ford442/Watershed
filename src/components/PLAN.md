# Components Directory - Expansion Plan

## Current Components

### ✓ Player.jsx
**Status:** Core functionality complete, needs polish
**Purpose:** First-person player controller with physics
**Features:**
- FPS camera with pointer lock
- WASD movement + Space jump
- Physics-based rigid body
- Camera follows player capsule

**TODO:**
- [ ] Add player state management (alive, dead, respawning)
- [ ] Implement respawn mechanism
- [ ] Add water interaction (slower movement in water)
- [ ] Add momentum display/feedback
- [ ] Add slide mechanic (shift key to reduce friction)
- [ ] Add wall-ride detection

---

### ✓ RiverTrack.jsx
**Status:** Working prototype, primary track component
**Purpose:** Procedurally generated river canyon using ExtrudeGeometry
**Features:**
- CatmullRom curve path generation
- U-shaped cross-section
- Textured rock walls
- Visual water surface (non-interactive)

**TODO:**
- [ ] Make path generation configurable/seed-based
- [ ] Add more variation to canyon shape (width, depth changes)
- [ ] Implement proper water physics interaction
- [ ] Add edge details (rocks, debris on banks)
- [ ] Optimize collision mesh (use simplified collider)

---

### ✓ CreekCanyon.jsx
**Status:** Alternative implementation, not currently used
**Purpose:** Heightmap-based canyon generation
**Features:**
- PlaneGeometry with vertex manipulation
- Procedural height variation
- More natural terrain shape

**TODO:**
- [ ] Decide if keeping both implementations or merging
- [ ] If keeping: Make it selectable via props
- [ ] If merging: Combine best features into RiverTrack

---

## Components to Create

### Priority 1: Essential Gameplay

#### Obstacles/
**Purpose:** Interactive hazards and challenges

- **Rock.jsx**
  - Instanced mesh for performance
  - Various sizes (small, medium, large)
  - Static physics collider
  - Poolable object

- **FallenLog.jsx**
  - Cylinder mesh with bark texture
  - Blocks part of the track
  - Can be jumped over or navigated around

- **Rapids.jsx**
  - Visual effect component
  - Speed boost zone
  - Increases player velocity
  - White water particle effects

---

### Priority 2: Visual Effects

#### Effects/
**Purpose:** Enhance visual feedback and immersion

- **Splash.jsx**
  - Particle system for water splashes
  - Triggered on player collision with water
  - Short-lived, pooled particles

- **WaterFoam.jsx**
  - Animated texture on water surface
  - Follows flow direction
  - Appears near obstacles and rapids

- **Spray.jsx**
  - Mist/spray particles near waterfalls
  - Persistent effect, alpha-blended

- **SpeedLines.jsx**
  - Motion blur effect when at high velocity
  - Radial lines emanating from camera center
  - Intensity based on player speed

---

### Priority 3: UI & HUD

#### UI/
**Purpose:** Player feedback and game state display

- **HUD.jsx**
  - Speed indicator (large, prominent)
  - Distance traveled
  - Current score/multiplier
  - Minimal, clean design (per AGENTS.md)

- **MainMenu.jsx**
  - Start game button
  - Settings access
  - Credits

- **PauseMenu.jsx**
  - Resume/Restart/Quit options
  - Triggered by ESC key

- **GameOver.jsx**
  - Final score display
  - Run statistics (max speed, distance)
  - Retry/Menu options

- **SettingsPanel.jsx**
  - Graphics quality slider
  - Audio volume controls
  - Key bindings

---

### Priority 4: Advanced Features

#### Cameras/
**Purpose:** Development and cinematic camera views

- **DebugCamera.jsx**
  - Free-fly camera (no physics)
  - Toggle with 'C' key
  - WASD for movement, mouse for rotation
  - Fast movement with Shift
  - Shows player position, track bounds

- **CinematicCamera.jsx**
  - Pre-scripted camera path
  - For intro sequence or replays
  - Smooth interpolation along curve

- **ThirdPersonCamera.jsx**
  - Optional camera mode
  - Follows player from behind
  - Collision detection to prevent clipping

---

#### Powerups/
**Purpose:** Temporary player enhancements (future feature)

- **SpeedBoost.jsx**
  - Collectible item
  - Temporary velocity increase
  - Glowing particle effect

- **Shield.jsx**
  - Collectible item
  - One-time collision protection
  - Visual force field effect

---

### Priority 5: Environmental Details

#### Environment/
**Purpose:** Populate the world with atmosphere

- **Vegetation.jsx**
  - Instanced grass/ferns on banks
  - LOD system for distant detail
  - Wind animation (vertex shader)

- **Mist.jsx**
  - Volumetric fog in canyon
  - Denser near water surface
  - Depth-based opacity

- **SunShafts.jsx**
  - God rays filtering through canyon
  - Post-processing effect or geometry

- **Birds.jsx**
  - Ambient flying birds
  - Simple flocking behavior
  - Adds life to environment

---

## Component Guidelines

### Performance
- Use `React.memo()` for components that don't change often
- Leverage `useMemo()` for expensive geometry calculations
- Implement object pooling for frequently spawned/despawned objects
- Use instanced meshes for repeated geometry (rocks, plants)

### Physics
- Keep physics bodies as simple as possible (box/sphere/capsule > trimesh)
- Static objects should use `type="fixed"` RigidBody
- Consider compound colliders for complex shapes

### Styling
- Follow AGENTS.md aesthetic guidelines (industrial/clean, not cartoony)
- Use realistic materials (PBR workflow)
- Minimal UI, diegetic where possible

### Testing
- Each component should have a standalone test scene
- Verify performance impact before integration
- Test with various player speeds/positions

---

## Component Template

```jsx
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * [ComponentName]
 * 
 * Purpose: [Brief description]
 * Props: [List props and their types]
 */
export default function ComponentName({ 
  position = [0, 0, 0],
  scale = 1,
  ...props 
}) {
  const ref = useRef();

  // Memoize expensive calculations
  const geometry = useMemo(() => {
    // ...
  }, []);

  // Animation loop (if needed)
  useFrame((state, delta) => {
    if (!ref.current) return;
    // ...
  });

  return (
    <mesh ref={ref} position={position} scale={scale} {...props}>
      <primitive object={geometry} />
      <meshStandardMaterial />
    </mesh>
  );
}
```

---

## File Naming Conventions

- Component files: `PascalCase.jsx` (e.g., `Player.jsx`)
- Utility files: `camelCase.js` (e.g., `mathHelpers.js`)
- Folders: `PascalCase/` (e.g., `Obstacles/`)
- Test files: `ComponentName.test.jsx`

---

## Next Steps

1. Create `Obstacles/` folder with basic Rock component
2. Create `UI/` folder with HUD component
3. Create `Cameras/` folder with DebugCamera component
4. Test each component in isolation before integration
5. Document component props and usage in component file
