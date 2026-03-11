# CLAUDE.md — Watershed

**Watershed** is a high-octane, first-person downhill runner set in a river canyon system. The player slides/rafts from an alpine source to a valley delta, with procedurally-generated track segments driving the experience. Think: Sonic-speed meets survival sim, rendered in a web browser.

---

## Quick Start

```bash
npm install
npm start          # dev server on port 3000 (Vite)
npm test           # unit tests (Jest/RTL)
npm run build      # production build → build/
```

> Requires Chrome 90+ for WebGL 2.0. WebGPU paths are placeholders for future migration.

---

## Stack at a Glance

| What | How |
|------|-----|
| Framework | React 19 + TypeScript |
| 3D rendering | Three.js 0.160 + React Three Fiber 9.4 |
| Physics | Rapier 0.19 (WASM) via @react-three/rapier |
| Build | Vite 7 |
| Shaders | GLSL (injected via `onBeforeCompile`) + WGSL stubs for future WebGPU |
| Package manager | pnpm (npm also works) |

---

## Directory Map

```
src/
├── App.tsx                    # Canvas config, error boundaries, loader gate
├── Experience.jsx             # Scene root: lighting, physics world, sky, vehicle
├── index.tsx                  # Entry point
├── style.css                  # UI, loader, crosshair, overlay styles
│
├── components/
│   ├── TrackManager.jsx       # ★ Chunk treadmill orchestrator (generation + biome detection)
│   ├── TrackSegment.jsx       # ★ One canyon chunk: geometry + PBR terrain + 25 env types
│   ├── FlowingWater.jsx       # ★ Animated water surface (ShaderMaterial, GLSL)
│   ├── EnhancedSky.jsx        # Biome-responsive sky (drei Sky + fogExp2)
│   ├── Player.jsx             # First-person capsule controller (Rapier RigidBody)
│   ├── Raft.jsx               # (legacy) raft mesh
│   ├── UI.tsx                 # Pause/start overlay, pointer lock, controls display
│   ├── Loader.tsx             # Asset loading screen
│   ├── ErrorBoundary.tsx
│   │
│   ├── Environment/           # 21 biome decoration components (all instanced/memoised)
│   │   ├── Vegetation.jsx     # Trees with wind shader
│   │   ├── Grass.jsx
│   │   ├── Foliage.jsx
│   │   ├── Reeds.jsx
│   │   ├── Ferns.jsx
│   │   ├── Fish.jsx
│   │   ├── Birds.jsx
│   │   ├── Fireflies.jsx
│   │   ├── Mist.jsx
│   │   ├── WaterfallParticles.jsx
│   │   ├── WaterLilies.jsx
│   │   ├── SunShafts.jsx
│   │   ├── Dragonflies.jsx
│   │   ├── Pebbles.jsx
│   │   ├── Driftwood.jsx
│   │   ├── FallingLeaves.jsx
│   │   ├── Mushrooms.jsx
│   │   ├── Pinecone.jsx
│   │   ├── Rapids.jsx
│   │   ├── RockFoam.jsx
│   │   └── Wildflowers.jsx
│   │
│   ├── Obstacles/Rock.jsx     # Procedural rock formations with Rapier colliders
│   └── VFX/SplashParticles.jsx
│
├── vehicles/
│   ├── RunnerVehicle.tsx      # ★ First-person foot runner (active default)
│   └── RaftVehicle.tsx        # Third-person raft (switch via vehicleType in Experience.jsx)
│
├── systems/
│   ├── MapSystem.ts           # ★ BaseMapChunk interface, SeededRandom, chunk pool (not yet wired to TrackManager)
│   ├── VehicleSystem.ts       # Vehicle base classes
│   ├── WaterSystem.ts         # Water force/flow utilities
│   └── ObjectSystem.ts        # Object lifecycle
│
└── utils/
    └── RiverShader.js         # extendRiverMaterial(): adds wetness, moss, caustics via onBeforeCompile
```

---

## Core Systems

### Track Treadmill (`TrackManager.jsx`)

- 7 active segments max, 10-slot pool (ID % 10 = pool index)
- Generates next segment when camera is within 150 units of the last point
- Each segment is 4 CatmullRom control points (~90–120 units long)
- `getSegmentConfig(id)` maps segment IDs to the scripted level progression

**Level script:**

| Segment | Phase | Notes |
|---------|-------|-------|
| 0–12 | The Meander | Gentle summer river |
| 13 | Approach | Steepens toward waterfall |
| 14 | The Waterfall | verticalBias -3.0, 400 particles, camera shake |
| 15 | Splash Pool | biome → autumn, width 70, 2 s transition |
| 16–18 | The Pond | Wide, foggy, fewer trees |
| 19+ | Autumn Rapids | High rock density, aggressive meander |

### Coordinate System

```
Y (up)
│    Canyon Rim (Y ~+15 rel. to river)
│    Water Level (Y = 0.5)
└──────────────────→ Z (forward / downstream, negative = ahead)
X (left/right)
```

Player spawns at `[0, -4, -10]`. The initial river centerline is around Y = -6 to -22 over the first two segments.

### Vehicle Swap

In `Experience.jsx`, change `vehicleType`:

```jsx
const [vehicleType, setVehicleType] = useState('runner'); // 'runner' | 'raft'
```

### Water Shader (`FlowingWater.jsx`)

Pure `ShaderMaterial`. Two-layer fbm foam, Fresnel highlight, depth gradient, current streaks. Uniforms: `time`, `flowSpeed`, `waterColor`, `deepColor`, `foamColor`, `edgeHighlight`.

### Material Extensions (`RiverShader.js`)

`extendRiverMaterial(mat)` injects: **wetness** (darken surfaces near Y=0.5), **moss** (green on upward slopes), **caustics** (animated light patterns below water).

---

## Controls

| Input | Action |
|-------|--------|
| W / Space | Jump (runner) |
| A / D | Strafe |
| S | Backward |
| Mouse | Look |
| Right-click | Forward |
| ESC | Release pointer lock (pause) |
| Enter | Start / Resume |
| R | Open restart confirmation |

---

## Visual Target

See `concepts/01_kinetic_flume.png` — first-person POV, narrow mossy rock channel, white water rushing. That is the reference for the summer biome. `concepts/03_raft_journey.png` is the scale/mood target for the raft mode on the pond/delta section.

---

## Known Debug Artifacts (Need Cleanup Before Maps)

The following are leftover debug elements that make the game look rough:

1. **`App.tsx:69–88` — Green debug overlay** — Always-visible panel showing "Canvas Ready / Loading Active / Progress / Experience Error". Must be removed for any polished build.
2. **`Player.jsx:126–129` — Yellow wireframe capsule** — A visible debug mesh rendered at the player position. Not needed in final game; remove or hide.
3. **`RaftVehicle.tsx:60–63` — Hotpink debug cube** — A `[0.3, 0.3, 0.3]` pink box at position `[0,1,0]` on the raft. Debug marker only.
4. **`App.tsx:92` — `antialias: false`** — Antialiasing is disabled. Switching to `antialias: true` will immediately improve edge quality at modest cost.
5. **`EnhancedSky.jsx:72` — Stars always rendered** — Stars are visible even at noon. They are subtle but should be conditional on time-of-day or biome.

---

## What Needs to Happen Before Writing Maps

Maps (authored segment sequences) require a stable visual baseline to test against. Here is the ordered path:

### Step 1 — Strip debug artifacts (1–2 hours)
- Remove the green debug panel from `App.tsx`
- Remove the yellow wireframe mesh from `Player.jsx`
- Remove the hotpink box from `RaftVehicle.tsx`
- Enable `antialias: true` in Canvas

### Step 2 — Terrain visual quality (2–4 hours)
The canyon walls currently use a U-shaped extrusion + Rock031 PBR textures. The texture tiling is uniform (4×8 repeat). To get closer to the concept art:
- Add **vertex color variation** to the upper canyon walls (darker, more saturated at the waterline; lighter/tan at the rim)
- Introduce **secondary UV channel** or triplanar projection to break up tiling
- Add **moss/lichen vertex color bands** at the waterline (already supported by `extendRiverMaterial`)
- The `RiverShader.js` moss effect needs the terrain mesh to pass correct world normals — verify this is wired correctly in `TrackSegment.jsx`

### Step 3 — Water visual quality (1–2 hours)
The water shader is solid. Two tweaks to match the concept:
- Increase foam density near canyon walls (bank foam mask already exists — tune `bankFoamMask` threshold at `FlowingWater.jsx:111`)
- Add a very slight camera-height turbulence (wave amplitude scales with camera proximity to water surface)

### Step 4 — Post-processing / atmosphere (2–3 hours)
The biggest single visual upgrade. Add `@react-three/postprocessing`:
- **Bloom** — brightest water highlights, sun shafts (`SunShafts.jsx` exists but needs bloom to read)
- **Vignette** — reinforce canyon tunnel feel
- **ChromaticAberration** (subtle, speed-triggered) — conveys velocity
- **SSAO** (EffectComposer from `@react-three/postprocessing`) — ground truth ambient occlusion in crevices

### Step 5 — Wire MapSystem.ts into TrackManager (3–5 hours)
`MapSystem.ts` defines `BaseMapChunk`, `SeededRandom`, `generateRiverPath`, `calculateSpawns`, `ChunkPool` — but `TrackManager.jsx` duplicates this logic inline. Before authoring maps:
- Replace `TrackManager`'s inline generation with `DefaultMapManager` from `MapSystem.ts`
- Move `getSegmentConfig` into map config JSON (per `IMPROVEMENT_PLAN.md §2.2`)
- This enables authored map files to override procedural generation per-segment

### Step 6 — Author maps
With the above in place:
- A map is a JSON array of segment configs (position override, type, biome, decorations)
- `TrackManager` reads them in sequence then hands off to procedural generation
- Map files live in `src/maps/` (e.g., `meander_to_waterfall.json`)

---

## Performance Targets

| Metric | Target |
|--------|--------|
| FPS | 60 (all biomes) |
| Frame time | < 16.67 ms |
| Memory | < 300 MB post-load |
| Waterfall (400 particles) | ≥ 55 FPS |

---

## Testing

```bash
npm test                          # unit tests
python3 src/verify_visuals.py     # visual regression (needs dev server)
```

Manual checklist before every commit:
- [ ] Player spawns without falling through geometry
- [ ] WASD + mouse look functional after pointer lock
- [ ] Track generates as player moves toward negative Z
- [ ] Rock031 PBR textures visible (not gray fallback)
- [ ] No console errors
- [ ] Debug panel / wireframes are NOT visible

---

## Deployment

```bash
python3 build_and_patch.py    # build + patch relative paths → build/
python3 deploy.py             # SFTP to test.1ink.us/watershed
```

---

## Biome Roadmap (per `plan.md`)

1. **Glacial Melt** (Source) — ice blue, narrow tube, ultra-fast, slush water
2. **Lumber Flume** (Forest) — mossy wood, breakable planks, gap jumps
3. **Hydro-Dam** (Industrial) — concrete, vortex drain mechanic
4. **Slot Canyon** (Current) — red rock, wall riding, summer → autumn
5. **Delta** (End) — wide, calm, sunset raft mode

---

## Key File Quick Reference

| File | What to touch |
|------|--------------|
| `Experience.jsx` | Lighting, vehicle swap, physics gravity |
| `TrackManager.jsx` | Segment generation, biome transitions, rock material |
| `TrackSegment.jsx` | Canyon geometry, decoration placement |
| `FlowingWater.jsx` | Water shader uniforms and GLSL |
| `RiverShader.js` | Wetness/moss/caustics injection |
| `EnhancedSky.jsx` | Sky, fog biome transitions |
| `Player.jsx` | Movement, camera, jump |
| `systems/MapSystem.ts` | Chunk interfaces, seeded RNG, spawn calc |
| `src/style.css` | All UI chrome |
