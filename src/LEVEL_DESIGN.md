# Level Design: The First Descent

This document outlines the gameplay mechanics, segment configurations, and performance targets for the initial player experience, covering the first 19+ track segments.

## ✅ Acceptance Criteria

-   [x] Player can complete Levels 1-2 (segments 0-19+) without manual segment reloading.
-   [x] Waterfall segment (ID 14) triggers a noticeable gravity shift and associated particle VFX.
-   [x] The atmosphere correctly transitions from 'summer' to 'autumn' over a 2-second duration during segment 15.
-   [x] The splash pool / pond segment width is exactly 70 units. This should be verifiable with a debug overlay.
-   [x] The frame rate must remain above 55 FPS during the waterfall drop, even with 400 particles active.
-   [x] There should be no visible terrain "spikes" or seams between segments 13, 14, and 15.
-   [x] **Audio:** Waterfall sound effects should fade in at segment 13, reach their peak at segment 14, and cleanly transition to ambient pond sounds at segment 15.

## 🔗 Dependencies & Blockers

-   **Dependencies:**
    -   [x] Requires the `EnhancedSky` biome blending system (Issue #123).
    -   [x] Requires the `WaterfallParticles` VFX system (Issue #145).
    -   [x] Requires updated `TrackSegment` wall height clamping to prevent visual artifacts (PR #89).
-   **Blocked by:**
    -   [x] Player death/respawn logic for scripted levels is not yet implemented (Issue #156) — **Resolved in Goal 2**.

---

## 💻 Segment Technical Specifications

The `getSegmentConfig` function in `TrackManager.jsx` should be updated to use these precise values.

| Segment ID(s) | Phase Description | Type | Biome | Width | Meander | Vertical Bias | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **0-12** | The Meander | `normal` | `summer` | 35 | 1.2 | -0.5 | Initial gentle river flow. |
| **13** | Approach | `normal` | `summer` | 35 | 0.2 | -1.2 | Steepens, leading to the waterfall. |
| **14** | The Waterfall | `waterfall` | `summer` | 35 | 0.0 | -3.0 | **Particle Count: 400**, `forwardMomentum: 0.15`, **Camera Shake: 0.5**. |
| **15** | Splash Pool | `splash` | `autumn` | 70 | 0.5 | -0.2 | **Transition Duration: 2000ms**, `flowSpeed: 0.3`. |
| **16-18** | The Pond | `pond` | `autumn` | 70 | 0.3 | -0.02 | Wider, calmer area. **Fog: 0.8**, **Tree Density: 0.3**. |
| **19** | Autumn Rapids | `normal` | `autumn` | 35 | 1.5 | -0.7 | More aggressive rapids. **Rock Density: 'high'**. |
| **20-22** | Slot Canyon | `normal` | `slotCanyon` | 24 | 0.55 | -0.95 | Narrow high-walled canyon. **Rock Density: 'high'**, `waterWidth: 8`, `flowSpeed: 1.3`, **Tree Density: 0.08**. God rays from above, enhanced mist, wall height 26. |
| **23-27** | Downhill Creek Run | `normal` | `summer` | 28 | 0.6 | -1.5 | Fast mossy slot creek. **Rock Density: 'high'**, `flowSpeed: 1.4`. |
| **28** | Drop-off Ledge | `normal` | `summer` | 22 | 0.1 | -2.2 | Pre-waterfall steepening. **Camera Shake: 0.2**. |
| **29** | Second Waterfall | `waterfall` | `summer` | 40 | 0.0 | -3.0 | Wide fanning curtain. **Particle Count: 600**, **Camera Shake: 0.7**. |
| **30** | Plunge Pool | `splash` | `autumn` | 75 | 0.4 | -0.1 | Calm swirl. `flowSpeed: 0.25`, **Tree Density: 0.8**. |
| **31+** | Autumn Rapids | `normal` | `autumn` | 35 | 1.5 | -0.7 | Open-ended. **Rock Density: 'high'**. |

---

## ⚠️ Edge Cases & Failure Handling

-   **Player Death during Waterfall:** If the player dies during the waterfall drop (segment 14), they must respawn at the beginning of segment 13 (top of the falls), not at the game's starting point (segment 0).
-   **Missing Splash Pool:** An invisible "catch" collider should be placed at segment 15 to prevent the player from falling through the world if they somehow miss the splash zone.
-   **Low-End Devices:** A particle LOD system should be implemented. If the FPS drops below a certain threshold, the particle count for the waterfall should be reduced from 400 to 100.
-   **Rapid Segment Skipping:** The `onBiomeChange` callback must be debounced to prevent the atmosphere from flickering if a player manages to traverse through segment 15 very quickly.

## 📊 Performance Budget & Benchmarks

-   **Waterfall Segment (14):**
    -   Max Particles: 400 (scales down to 100 on low quality via LODManager)
    -   Camera Shake Instances: 1
    -   Additional Draw Calls: 0 (particles are instanced)
-   **Pond Segment (16-18):**
    -   Tree Draw Distance: Reduced to 50 units (from the default 100) to compensate for the doubled track width.
-   **Target:** Maintain a frame time of `<8ms` on minimum-spec hardware throughout the entire transition from segment 13 to 16.

## ✅ Implementation Status (Goal 3)

| Feature | Status | File(s) |
|--------|--------|---------|
| Segment configs (0-19+) | ✅ | `src/maps/meander_to_waterfall.ts` |
| Waterfall: 400 particles | ✅ | `src/components/Environment/WaterfallParticles.jsx` |
| Waterfall: camera shake 0.5 | ✅ | `src/maps/meander_to_waterfall.ts` |
| Waterfall: gravity shift | ✅ | `src/Experience.jsx` |
| Waterfall: sound fade | ✅ | `src/hooks/useSegmentAudio.ts` |
| Splash pool: invisible catch collider | ✅ | `src/components/TrackSegment.jsx` |
| Splash pool: flow speed 0.3 | ✅ | `src/maps/meander_to_waterfall.ts` |
| Pond: fog 0.8 | ✅ | `src/components/TrackSegment.jsx` (`PondFog`) |
| Pond: tree density 0.3 | ✅ | `src/maps/meander_to_waterfall.ts` |
| Pond: draw distance 50 | ✅ | `src/components/TrackSegment.jsx` |
| Rapids: high rock density | ✅ | `src/maps/meander_to_waterfall.ts` |
| Biome transition 2000ms | ✅ | `src/systems/BiomeSystem.tsx` |
| Debounced onBiomeChange | ✅ | `src/systems/ChunkManager.ts` |
| Particle LOD (400→100) | ✅ | `src/components/Environment/WaterfallParticles.jsx` |

## 🎨 Required Assets

-   `waterfall_spray.png` (Particle texture, 256x256 with alpha)
-   `ambient_waterfall.ogg` (3D positional audio, loopable)
-   `autumn_fog_gradient.png` (For `EnhancedSky` component)
-   `tree_autumn_red.glb`, `tree_autumn_gold.glb` (Tree model variants)

---

## 🧪 QA Test Cases

1.  **Slow Drift Test:** Enter the waterfall (segment 14) at minimum speed. The player should land near the center of segment 15.
2.  **Maximum Speed Test:** Enter the waterfall at maximum speed. The player should not overshoot the splash pool area of segment 15.
3.  **Pause/Resume Test:** Pause the game during the atmosphere transition on segment 15 and then resume. The transition should continue smoothly without any color snapping or visual glitches.
4.  **Floating Tree Test:** Carefully inspect the banks of the pond segments (16-18) to ensure that no trees are floating above the terrain or clipping into the water.

## 💎 Future Polish (Defer to separate issue)

-   Implement screen-space water caustics on the splash pool for enhanced visual fidelity.
-   Add a dynamic music crossfade that aligns with the biome transition.
-   Introduce fish jumping VFX in the pond segments to make the environment feel more alive.
-   Add a secret cave entrance along the bank of segment 17.

---

## 🏜️ Slot Canyon (Segments 20–22)

### Visual & Atmosphere Targets
- Tall, flowing sandstone walls (height 26) with warm orange/red stratified layers and realistic PBR materials.
- Dramatic god ray light shafts piercing from the narrow opening above, with volumetric mist trapped between walls.
- Fast, churning turquoise water (flowSpeed 1.3) in a narrow channel (waterWidth 8).
- High density rock debris creating natural slaloms and choke points.
- Minimal vegetation (treeDensity 0.08) — sparse desert canyon feel.

### Technical Implementation
| Component | File(s) | Notes |
|-----------|---------|-------|
| Biome profile | `src/configs/TrackBiomes.ts` (`slotCanyon`) | Width 24, wallHeight 26, wallTightness 0.78 |
| Segment progression | `src/maps/meander_to_waterfall.ts` (indices 20–22) | Also in `meander_to_waterfall.json` as `canyon-sunset` |
| Wall geometry | `src/components/TrackSegment.jsx` | `isSlotCanyon` path: higher walls (22+), power 1.8 curve |
| Wall material | `src/materials/CanyonMaterial.js` | Triplanar mapping, geological layering shader |
| Biome mapping | `src/systems/ReachNormalizer.ts` | `canyon-sunset` → `slotCanyon` |
| God rays | `src/systems/volumetric/VolumetricGodRays.tsx` | Screen-space ray marching |
| Sun shafts | `src/components/TrackSegment.jsx` (placement) | Narrow vertical beams from above |
| Mist/spray | `src/components/TrackSegment.jsx` (placement) | Enhanced density, taller mist columns |
| Floating debris | `src/components/Environment/FloatingDebris.jsx` | Physics-enabled driftwood/pinecones |
| Rock decorations | `src/components/CanyonDecorations.jsx` | Instanced boulders with colliders |
| Canyon biome component | `src/biomes/CanyonBiome.tsx` | Procedural canyon floor geometry |

### Performance Budget
- Wall height 26 with LOD: frustum culling via existing treadmill system.
- Rock colliders: convex hull via Rapier `InstancedRigidBodies`.
- Mist particles: bounded per segment via `MAX_PER_SEGMENT` constant.
- Target: >55 FPS on mid-spec hardware with all effects active.

### QA Test Cases
1. **Seamless Transition:** Verify segments 19→20 and 22→23 load without visible seams or popping.
2. **Physics Collision:** Raft collides correctly with canyon walls and scattered boulders (no tunneling).
3. **God Ray Visibility:** Sun shafts are visible from within the narrow canyon looking up.
4. **Mist Density:** Enhanced mist is visible between walls but does not obscure navigation.
5. **Performance:** Maintain >55 FPS with all canyon effects active on mid-spec hardware.
