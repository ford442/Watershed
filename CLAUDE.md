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

> Requires Chrome 90+ for WebGL 2.0. The live renderer is WebGL2-only; WebGPU/TSL migration is deferred to issue #256 path A.

---

## Stack at a Glance

| What | How |
|------|-----|
| Framework | React 19 + TypeScript |
| 3D rendering | Three.js 0.168 + React Three Fiber 9.4 |
| Physics | Rapier 0.19 (WASM) via @react-three/rapier |
| Build | Vite 7 |
| Shaders | GLSL (injected via `onBeforeCompile`) — dead WGSL stubs have been removed; dormant TSL/NodeMaterial seeds retained for #256 path A |
| Package manager | pnpm (npm also works) |

---

## Directory Map

Single canonical tree (matches `git ls-files src` layout; star-marked paths are primary touch points).

```
src/
├── App.tsx                      # Canvas, renderer toggle, error boundaries
├── Experience.tsx               # Scene root: LOD/Biome providers, InnerExperience
├── index.tsx                    # Entry: Rapier pre-init, global handlers
├── style.css                    # UI, loader, overlays
│
├── experience/                  # Scene composition split from legacy Experience
│   ├── InnerExperience.tsx      # Track, vehicle, post-processing wiring
│   ├── ExperienceUI.tsx           # HUD / menu shell
│   ├── SceneLighting.tsx
│   ├── VehicleMount.tsx
│   ├── WaterStack.tsx
│   ├── constants.ts
│   └── hooks/                     # useExperienceWorld, lifecycle, inner state
│
├── components/
│   ├── TrackManager.tsx         # ★ Chunk treadmill (map-driven via MapSystem)
│   ├── TrackSegment/            # ★ Canyon chunk geometry + decorations
│   ├── FlowingWater.jsx         # ★ Water surface shader (GLSL)
│   ├── EnhancedSky.jsx          # Biome sky + fog (useBiome)
│   ├── WaterReflection.jsx      # Planar reflection pass
│   ├── WaterInteraction.jsx     # Player–water contact FX
│   ├── ReactiveAudio.tsx        # Biome/speed-reactive audio
│   ├── WeatherSystem.tsx        # Rain/snow/fog particles
│   ├── Player.jsx               # First-person capsule (Rapier)
│   ├── GameHUD.tsx / UI.tsx / PauseMenu.tsx / Loader.tsx
│   ├── Environment/             # Instanced biome decorations (25+ types)
│   ├── Obstacles/               # Rocks, pillar break VFX
│   ├── VFX/                     # Splash particles
│   └── LevelEditor/             # In-game level tools
│
├── vehicles/
│   ├── RunnerVehicle/           # ★ Default first-person runner
│   └── RaftVehicle/             # Third-person raft mode
│
├── systems/                     # Core game systems (see SYSTEMS.md)
│   ├── MapSystem.ts             # ★ JSON maps, chunk config, procedural fallback
│   ├── ChunkManager.ts          # Segment pool / treadmill
│   ├── ReachManager.tsx         # Reach streaming wrapper
│   ├── BiomeSystem.tsx / LODManager.tsx / GameState.ts
│   ├── SplashSystem.tsx / AudioSystem.ts / WatershedWasm.ts
│   └── …
│
├── maps/                        # Authored map JSON + registry.ts
├── configs/                     # BiomePalettes.ts, TrackBiomes.ts
├── constants/                   # game.ts, biomes.ts, weather.ts, …
├── hooks/                       # useWaterFlowField, useShaderLoader, …
├── materials/                   # CanyonMaterial, CausticsMaterial, EnhancedWaterMaterial
├── rendering/                   # createRenderer, WireframeDebug, rendererConfig
├── physics/                     # Rapier worker proxy, WaterForces
├── shaders/                     # HeightmapFlow.ts
├── utils/                       # RiverShader.js, levelValidator, reachValidator
└── formats/                     # level.schema.json, reach.schema.json
```

Full file listing: `git ls-files src`

---

## Core Systems

### Reach / Biome / LOD Systems

Since April 2026, an orchestration layer wraps the track treadmill with streaming reaches,
biome-context transitions, and adaptive LOD. The live wiring runs:
`LODProvider` → `BiomeProvider` → `ReachManager` (wraps `TrackManager`) + `SplashSystem`.
Shared state flows through a Zustand store (`GameState.ts`).

**All details, contract cards, dependency graph, and architectural constraints are in
[`SYSTEMS.md`](./SYSTEMS.md).**

---
Watershed runs a live orchestration stack in `Experience.tsx`: `LODProvider` wraps `BiomeProvider`, which wraps `InnerExperience` (track, vehicle, water stack) plus `SplashSystem`. Contract details live in **[`SYSTEMS.md`](./SYSTEMS.md)**; extended docs in **[`docs/reference/DOCUMENTATION_INDEX.md`](./docs/reference/DOCUMENTATION_INDEX.md)**.

### Track Treadmill (`TrackManager.tsx`)

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

Player spawns at `[0, 10, -10]`. The initial river centerline is around Y = -6 to -22 over the first two segments.

### Vehicle Swap

In `Experience.tsx` / `InnerExperience.tsx`, switch `vehicleType` via props or UI.

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
3. **`RaftVehicle/` — Hotpink debug cube** — A `[0.3, 0.3, 0.3]` pink box at position `[0,1,0]` on the raft. Debug marker only.
4. **`App.tsx:92` — `antialias: false`** — Antialiasing is disabled. Switching to `antialias: true` will immediately improve edge quality at modest cost.
5. **`EnhancedSky.jsx:72` — Stars always rendered** — Stars are visible even at noon. They are subtle but should be conditional on time-of-day or biome.

---

## What Needs to Happen Before Writing Maps

Maps (authored segment sequences) require a stable visual baseline to test against. Here is the ordered path:

### Step 1 — Strip debug artifacts (1–2 hours)
- Remove the green debug panel from `App.tsx`
- Remove the yellow wireframe mesh from `Player.jsx`
- Remove the hotpink box from `RaftVehicle/`
- Enable `antialias: true` in Canvas

### Step 2 — Terrain visual quality (2–4 hours)
The canyon walls currently use a U-shaped extrusion + Rock031 PBR textures. The texture tiling is uniform (4×8 repeat). To get closer to the concept art:
- Add **vertex color variation** to the upper canyon walls (darker, more saturated at the waterline; lighter/tan at the rim)
- Introduce **secondary UV channel** or triplanar projection to break up tiling
- Add **moss/lichen vertex color bands** at the waterline (already supported by `extendRiverMaterial`)
- The `RiverShader.js` moss effect needs the terrain mesh to pass correct world normals — verify this is wired correctly in `TrackSegment/`

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

### Step 5 — Map-driven TrackManager ✅
`MapSystem.ts` + authored JSON in `src/maps/` feed `TrackManager` via `maps/registry.ts`. Change `ACTIVE_MAP_ID` or `?map=glacial` to swap maps without editing TrackManager.

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
python3 build_and_patch.py    # build → build/, then invokes deploy.py
python3 deploy.py             # zips build/ and uploads to storage.noahcohn.com (Contabo)
```

---

## Biome Roadmap (per `docs/reference/plan.md`)

1. **Glacial Melt** (Source) — ice blue, narrow tube, ultra-fast, slush water
2. **Lumber Flume** (Forest) — mossy wood, breakable planks, gap jumps
3. **Hydro-Dam** (Industrial) — concrete, vortex drain mechanic
4. **Slot Canyon** (Current) — red rock, wall riding, summer → autumn
5. **Delta** (End) — wide, calm, sunset raft mode

---

## Key File Quick Reference

| File | What to touch |
|------|--------------|
| `src/Experience.tsx` | Scene providers, InnerExperience mount |
| `src/experience/InnerExperience.tsx` | Track, vehicle, lighting, post-processing |
| `src/components/TrackManager.tsx` | Segment pool, map-driven generation |
| `src/components/TrackSegment/` | Canyon geometry, decoration placement |
| `src/components/FlowingWater.jsx` | Water shader uniforms and GLSL |
| `src/utils/RiverShader.js` | Wetness/moss/caustics injection |
| `src/components/EnhancedSky.jsx` | Sky, fog biome transitions via `useBiome()` |
| `src/components/Player.jsx` | Movement, camera, jump |
| `src/systems/MapSystem.ts` | Chunk interfaces, JSON maps, spawn calc |
| `src/maps/registry.ts` | Active map switch point |
| `src/style.css` | All UI chrome |
