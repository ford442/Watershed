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
| **−3** | Glacier Ice Run | `normal` | `glacier` | 24 | 0.2 | -2.0 | Tight ice chute. **Slipperiness: 0.9**. **Particle Count: 80**. **Camera Shake: 0.15**. |
| **−2 to −1** | Alpine Wildflower Stream | `normal` | `summer` | 32 | 0.9 | -0.4 | Gentle meadow stream. **Tree Density: 0.9**. **Particle Count: 150**. **Rock Density: low**. |
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

---

## 🧊 Early Game Segments (Segments −3 to −1)

> **Epic:** Source Expansion — Pre-meander alpine origin
> **Chain trigger:** `GLACIER_START_INDEX` is now **−3**. `Experience.jsx` passes it to
> `TrackManager` by default, so every run begins in the glacier and flows through the
> alpine meadow before reaching the summer meander at segment 0.

### Concept

The run opens with a frigid, high-contrast ice chute — tight, slippery, and fast —
followed by a gentle, sun-drenched alpine meadow stream bursting with wildflowers.
This two-beat introduction teaches velocity control (glacier) and then rewards the
player with a calm, visually rich recovery (alpine) before the main descent.

### Segment Breakdown

| Segment ID | Phase | Width | flowSpeed | Slipperiness | Particle Count | Notes |
|:---|:---|:---|:---|:---|:---|:---|
| **−3** | Glacier Ice Run | 24 | 2.2 | 0.90 | 80 | Tight ice tube, near-frictionless, high contrast |
| **−2 to −1** | Alpine Wildflower Stream | 32 | 0.8 | 0.0 | 150 | Gentle meadow stream, lush vegetation, bright |

### Physics: Slipperiness

`slipperiness` (0–1) is published in the `segment-enter` CustomEvent as `detail.slipperiness`.
`WaterFlowForces.tsx` reads it each frame and:
- Reduces lateral drag by `slipperiness × 80%` — the raft can't fight the current sideways.
- Adds a `0.18 × flowSpeed × slipperiness` slide bias along the downstream tangent each frame.
- Net feel: high speed, minimal control, survive-the-chute tension.

> **TODO:** Wire `slipperiness` into a Rapier `ContactMaterial` friction override so
> wall impacts also feel slippery (friction ≈ `biomeProfile.wallFriction = 0.18`).

### Visual Style

**Glacier Ice Run (−3):**
- **Terrain colours:** Ice-scoured granite (pale grey-blue floor, frost-white rim)
- **Water colour:** Milky `#a8d8ea` (glacial flour suspension) with white-blue foam
- **Wall bands:** Dark blue-black at waterline → frost-white at rim (5-stop gradient)
- **No moss or lichen** — replaced by glacial algae tint (`#4a7888`)
- **Minimal vegetation:** Only dead snags and a few spindly conifers survive

**Alpine Wildflower Stream (−2 to −1):**
- **Terrain colours:** Summer greens with bright grass tints
- **Water colour:** Clear turquoise `#4a90d9` with bright edge foam
- **High wildflower density:** `particleCount: 150` drives a 2.5× wildflower spawn boost
  in `TrackSegment.jsx` for normal segments.
- **Lush vegetation:** `treeDensity: 0.9` (near-maximum), low rock density for unobstructed banks
- **Gentle current:** `flowSpeed: 0.8` gives a calm, scenic drift

### VFX: IceSpray & Wildflowers

- **IceSpray:** `src/components/Environment/IceSpray.jsx` renders up to 20 billboarded crystal sprites
  per active glacier segment. Particles burst from `vehiclePos` when `playerVelocityForParticles > 0`.
  Intensity = `min(1, speed / 8)` — no spray at rest, full burst at 8 m/s+.
- **Wildflower boost:** For normal segments with `particleCount > 0`, `TrackSegment.jsx` multiplies
  wildflower spawn probability by `min(particleCount / 60, 2.5)`. Alpine stream at 150 gives the
  maximum 2.5× boost, creating dense flower banks.

### How to Activate

```tsx
// In Experience.jsx (already wired by default):
import { GLACIER_START_INDEX } from '../maps/meander_to_waterfall';

<TrackManager startIndex={GLACIER_START_INDEX} ... />
```

> **Note:** Player spawn remains at `[0, -4, -10]`; this sits inside the first generated
> glacier segment (starting at `INITIAL_POINTS` last waypoint `[0, -6, 0]`).

### Performance Budget

- IceSpray: 20 particles × 1 draw call = 1 extra `InstancedMesh` per active glacier segment.
- Wildflower boost: additional instanced wildflower meshes within existing draw-call budget.
- Glacier rock density: `'medium'` (~40% between low/high spawn rates).
- Tree density: 0.05 (glacier) vs 0.9 (alpine). Decoration suppressed on glacier: wildflowers, ferns, mushrooms, reeds, driftwood, grass.
- Target: ≥60 FPS on mid-spec hardware (well under waterfall budget).

### QA Test Cases

1. **Slipperiness feel:** At segment −3, single-paddle strokes should barely affect lateral position. The raft should slide downstream naturally.
2. **Transition glacier → alpine (−3 → −2):** water colour shifts from milky blue to clear turquoise; vegetation density jumps dramatically; slipperiness drops to zero.
3. **Transition alpine → meander (−1 → 0):** no visible seam or camera-pop; biome stays `summer` but meanderStrength increases from 0.9 to 1.2.
4. **Wildflower density:** Alpine segments show visibly denser wildflower clusters than segment 0.
5. **Chain continuity:** No visible seam or camera-pop at any early-game boundary.

---

## 🏜️ Slot Canyon (Segments 20–22)

> **Epic:** Movement Polish + Canyon Expansion (Q2 Focus) — Issue #178
> **Related:** Raft Movement & Controls (#176 ✅), Slot Canyon Implementation (#177 ✅)

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

---

## 🚀 Movement Polish (Q2 — Issue #176 ✅)

Enhanced raft movement and controls for superior velocity feel and precise canyon maneuvering.

### Implemented Systems

| System | File(s) | Description |
|--------|---------|-------------|
| Vehicle tuning config | `src/constants/vehicleTuning.ts` | Centralized tunable parameters: baseSpeed 32, flowResponsiveness 14, drift, wall riding, boost |
| Paddle thrust & steering | `src/systems/VehicleSystem.ts` (`RaftVehicle`) | Impulse-based lateral steering, torque on turns, speed cap 20 m/s |
| Wall riding / wall boost | `src/constants/vehicleTuning.ts` | wallRayDistance 3.5, wallBoostImpulse 9.0, friction-based wall interaction |
| Drift mechanics | `src/constants/vehicleTuning.ts` | driftFlowScale 0.18, driftTorqueScale 2.0, driftLateralRetention 0.92 |
| Camera dynamics | `src/constants/game.ts` | Velocity lag 0.15, lean factor 0.3, FOV speed scale 8 (75→90) |
| Collision response | `src/constants/game.ts` | Elastic bounce (force 8), spin on impact (force 3), stun 0.3s |
| Bank angle / slope detection | `src/vehicles/RunnerVehicle.tsx` | castRayAndGetNormal for trimesh normals, BANK_CONFIG for wall assist |

### Success Criteria
- [x] Player can intuitively navigate a narrow slalom of rocks at speed without frustration.
- [x] Movement feels "arcade-satisfying" yet grounded in physics (per grok.md / AGENTS.md).
- [x] No main-thread blocking; all input/physics updates efficient.
- [x] 60fps maintained in canyon test segment.
- [x] Follows AGENTS.md: functional components, hooks, performance-first, object pooling for particles.

### Coordination Notes
- Movement polish was implemented **before** the canyon segment to ensure controls were tuned for tight navigation.
- Canyon segment (#177) serves as the primary testbed for validating movement feel at speed.
- Vehicle tuning values in `src/constants/vehicleTuning.ts` should be iterated on via playtesting in canyon segments 20–22.
