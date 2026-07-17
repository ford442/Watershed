# SYSTEMS.md — Watershed Orchestration Layer

Reference for the Reach / Biome / LOD / Splash systems, live-wired water components,
and the WASM acceleration module. Core orchestration lives in `src/systems/`; water
reflection and interaction components live in `src/components/` but are mounted in
`InnerExperience.tsx` (via `WaterStack`).

For narrative context see [`CLAUDE.md`](./CLAUDE.md).

---

## Data-Flow / Dependency Graph

```
GameState (Zustand) ── shared state ──────────────────────────> (all systems read/write)

LODProvider ──quality/config──> BiomeProvider ──biome palette──> scene
                                      │
ReachStreamer ──ReachManifest──> ReachNormalizer ──NormalizedSegment[]──> ReachManager ──wraps──> TrackManager ──> TrackSegment
  (fetch /api/reaches)                                                         │
                                                                               ├──> ReactiveAudio
                                                                               └──> WeatherSystem

Player velocity/contacts ──> SplashSystem ──> ParticlePool ──> VFX (InstancedMesh)
                      └──> WaterInteraction ──> local instanced splash/mist (parallel path)
WaterReflection (LOD high/ultra) ──> WebGLRenderTarget (no live consumer — see card)
```

### Live nesting in `Experience.tsx` / `InnerExperience.tsx`

```jsx
<LODProvider initialQuality="high" enableAdaptive targetFPS={60}>   // LODManager.tsx:110
  <BiomeProvider initialBiome="canyonSummer" enableTimeOfDay={false}> // BiomeSystem.tsx:46
    ...scene...
    <ReachManager … />        // Experience.jsx:471
    <SplashSystem … />        // Experience.jsx:433
    <BiomeTransition/> <BiomeDetector/> <PerformanceMonitor/>
  </BiomeProvider>
</LODProvider>
```

---

## Contract Cards

---

### `src/systems/GameState.ts`

**Purpose:** Global shared state backbone — centralises player position, speed, biome,
segment index, pause/wipeout flags, and graphics settings so all systems can read/write
without prop-drilling.

**Runs in:** Module scope (Zustand store); updated inside `useFrame` via `batchFrameUpdate`.

**Exports:**
- `useGameStore` — Zustand store hook (primary access)
- Selector hooks: `usePlayerPosition`, `usePlayerSpeed`, `usePlayerBiome`,
  `useGamePaused`, `useGameWipeout`, `useGameSettings`, `useQualityPreset`,
  `useGravityMultiplier`
- `batchFrameUpdate(pos, speed, segmentIndex)` — throttled frame writer (updates Zustand every 3rd frame)
- Types: `GameState`, `GameActions`, `GameStore`, `GameSettings`, `QualityPreset`, `SpawnPoint`

**Consumes:** Nothing external — it is the root of the state graph.

**Produces:** Reactive slices consumed by `LODManager` (quality), `BiomeSystem`, `SplashSystem`,
HUD components, and physics callers.

**Boundaries (Do NOT):**
- Do NOT call `useGameStore.setState` at 60 Hz for `playerPosition` — use `batchFrameUpdate`
  instead; it throttles to every 3rd frame to avoid flooding React.
- Do NOT store `THREE.Vector3` objects in the store — `playerPosition` is `{x,y,z}` to keep
  the store serializable for Zustand devtools.
- Do NOT read physics-critical state from this store inside `useFrame`; read the rigid body
  ref directly for low-latency data.

**Known Pain:**
- `currentBiome` string in the store can drift from the `BiomeProvider` context value if
  `setBiome` and `setCurrentBiome` are called independently. There is no automatic sync.

---

### `src/systems/ReachManager.tsx`

**Purpose:** Orchestrates a single Reach lifecycle — streams the manifest, normalizes it
into TrackManager-compatible segments, and watches player position for transition entry.
**It wraps `TrackManager`; it does NOT replace it.**

**Runs in:** React render (component) + `useFrame` (transition detection).

**Exports:**
- `default ReachManager` (React component)

**Consumes:**
- `ReachStreamer.preloadReach(reachId)` — async manifest + asset fetch
- `normalizeReachManifest` / `NormalizedSegment` from `ReachNormalizer`
- `TrackManager` — rendered as a child with optional `reachSegments` prop
- `ReactiveAudio` — rendered alongside TrackManager when not in error state
- `WeatherSystem` — rendered alongside TrackManager when not in error state
- `useFrame` from `@react-three/fiber`

**Props:**
- `playerRef` — Rapier rigid body ref for transition detection
- `reachId?` — reach identifier; if absent, `TrackManager` runs in procedural mode
- `onBiomeChange?`, `onLoadingChange?`, `onError?` — lifted callbacks for `Experience.jsx`
- `forecastSamples?`, `retryKey?`

**Produces:**
- Renders `<TrackManager reachSegments={...} />` (plus `ReactiveAudio`, `WeatherSystem`).
- Logs transition entry/exit to console when player crosses `manifest.transition.segmentIndex`.
- On load error: renders `TrackManager` without segments so procedural generation takes over.

**Boundaries (Do NOT):**
- Do NOT mount `<TrackSegment>` directly from outside `TrackManager` — `ReachManager`
  wraps the treadmill; bypassing it breaks segment lifecycle and biome callbacks.
- Do NOT add loading-spinner or error UI inside this component — overlays are lifted
  to `Experience.jsx`.

**Known Pain:**
- Transition detection uses Z-coordinate bounds only; there is no multi-Reach handoff yet
  (transition entry is logged, not acted upon).

---

### `src/systems/ReachStreamer.ts`

**Purpose:** Background asset streaming for Watershed Reaches — fetches manifests and assets
(textures, GLTFs, audio, shaders, flow maps) from the FastAPI backend and caches them in
module-level Maps to prevent duplicate loads and GPU re-uploads.

**Runs in:** Async (Promise-based); called from `ReachManager` effects, not from `useFrame`.

**Exports:**
- `ReachStreamer` (object with `preloadReach`, `evictReach`, `isReachCached`, `getCachedReach`)
- `AssetCache` (object of Maps: `textures`, `noiseTextures`, `models`, `audioBuffers`, `shaders`, `flowMaps`, `reaches`)
- Interfaces: `AssetRef`, `ReachRequiredAssets`, `ReachTransition`, `ReachManifest`, `StreamResult`
- `default ReachStreamer`

**Consumes:**
- `REACH_API_BASE` (`'/api/reaches'`) from `src/constants/game`
- `validateReach` / `ValidationResult` / `formatValidationErrors` from `src/utils/reachValidator`
- `THREE.TextureLoader`, `GLTFLoader`, `THREE.AudioLoader` (Three.js built-ins)
- **No Howler** — audio is loaded via `THREE.AudioLoader` into `AudioBuffer`.

**Produces:**
- Populated `AssetCache` Maps.
- `StreamResult` (`{ manifest, loaded: {...counts}, errors: string[] }`) returned to caller.
- Recursive GPU disposal via `evictReach`.

**Boundaries (Do NOT):**
- Do NOT call `ReachStreamer.preloadReach` inside `useFrame` — it is async and triggers
  network requests; call it from `useEffect` only.
- Do NOT access `AssetCache` maps directly from render code — use the typed accessor
  `getCachedReach` or the results returned by `preloadReach`.
- Do NOT add Howler imports — audio loading uses Three.js `AudioLoader`.

**Known Pain:**
- `AssetCache` is module-level (singleton); hot-reloading in dev may leave stale entries.
  Call `evictReach` explicitly when unmounting a reach.
- Individual asset errors are collected and returned (not thrown), so a partially-loaded
  reach may silently omit assets.

---

### `src/systems/ReachNormalizer.ts`

**Purpose:** Converts a validated `ReachManifest` into an array of `NormalizedSegment[]`
that `TrackManager` can consume directly, applying biome profiles and Catmull-Rom tangent
continuity from the previous segment.

**Runs in:** Called once per reach load (from `ReachManager`'s `useEffect`), not per-frame.

**Exports:**
- `normalizeReachManifest(manifest, previousSegment?, forecastState?)` — main entry point
- `NormalizedSegment` (interface)
- `default normalizeReachManifest`

**Consumes:**
- `ReachManifest` from `ReachStreamer`
- `getTrackBiomeProfile` / `TrackBiomeProfile` from `src/configs/TrackBiomes`
- `THREE.Vector3`, `THREE.CatmullRomCurve3` (Three.js)

**Produces:**
- `NormalizedSegment[]` — flat array with fields for id, type, biome, points,
  segmentPath (CatmullRomCurve3), width, waterWidth, flowSpeed, particleCount,
  cameraShake, treeDensity, rockDensity, wallProfile, forwardMomentum, meanderStrength,
  verticalBias, and a raw `config` passthrough.

**Boundaries (Do NOT):**
- Do NOT call this function per-frame — it allocates `THREE.Vector3` and spline objects;
  call it once after streaming completes.
- Do NOT mutate `NormalizedSegment.points` after construction — tangent continuity is
  computed once and baked in.

**Known Pain:**
- `forecastState = 'Flooded'` silently overrides `type = 'normal'` → `'pond'`; there is no
  per-segment flood override.

---

### `src/systems/BiomeSystem.tsx`

**Purpose:** Manages biome state and interpolates fog, lighting, and material palettes
across the scene via React context. Provides `BiomeProvider`, `BiomeTransition`,
`BiomeDetector`, `useBiome`, and `useBiomeMaterials`.

**Runs in:** React context provider (`BiomeProvider`) + `useFrame` (`BiomeTransition`) +
`requestAnimationFrame` loop for transition interpolation.

**Exports:**
- `useBiome()` — context hook (throws if outside `BiomeProvider`)
- `BiomeProvider` — context provider (props: `initialBiome`, `enableTimeOfDay`, `timeOfDaySpeed`)
- `BiomeTransition` — scene component; applies palette to lights/fog every frame
- `BiomeDetector` — watches camera Z to detect segment biome changes
- `useBiomeMaterials()` — returns water/canyon/vegetation/effects material configs derived
  from the current interpolated biome palette

**Consumes:**
- `BiomePalette`, `getBiomePalette`, `lerpBiomePalettes`, `applyBiomeToLighting`
  from `src/configs/BiomePalettes`
- `useFrame`, `useThree` from `@react-three/fiber`

**Produces:**
- React context value: `{ currentBiome, targetBiome, transitionProgress, isTransitioning,
  timeOfDay, setBiome, setTimeOfDay }`
- Per-frame mutations: fog color/near/far, ambient/hemi/sun/fill light colors and intensities,
  scene background color.

**Boundaries (Do NOT):**
- Do NOT call `useBiome()` outside a `<BiomeProvider>` — it throws.
- Do NOT directly mutate `scene.fog` or light colors in other components while
  `BiomeTransition` is mounted — it will overwrite your values every frame.
- Do NOT rely on `BiomeProvider` as the sole biome source yet (see Known Pain).

**Known Pain:**
- **Split biome authority:** `BiomeProvider` context is live and wraps the scene, but
  `EnhancedSky.jsx` still accepts a **legacy `biome` string prop**
  (`function EnhancedSky({ biome = 'summer' })`) and does **not** call `useBiome()`.
  Changing biome via `setBiome` does NOT update `EnhancedSky` — you must also update
  the prop passed to it from `Experience.jsx`. This is a known split that has not been
  migrated to context yet.
- `BiomeDetector` uses a fixed `segmentLength = 40` approximation; it does not consult
  actual `NormalizedSegment` bounds.

---

### `src/systems/LODManager.tsx`

**Purpose:** Adaptive quality scaling — measures FPS over a 60-frame window and
automatically steps `quality` up/down (`low` → `medium` → `high` → `ultra`) to hold
the target FPS. Exposes per-quality budgets for particles, shadows, reflections, and
volumetric samples via React context.

**Runs in:** React context provider (`LODProvider`) + `useFrame` (FPS sampling and adaptive
quality logic).

**Exports:**
- `useLOD()` — context hook
- `LODProvider` — context provider (props: `initialQuality`, `enableAdaptive`, `targetFPS`)
- `FrustumCulling` — sets `object.visible` per-frame for a list of `THREE.Object3D`s
- `LODObject` — renders one of three LOD children based on camera distance
- `PerformanceMonitor` — dev-only HUD overlay showing FPS, quality, memory

**Consumes:**
- `useGameStore` from `GameState` — reads/writes `settings.quality` to stay in sync
  with the settings menu
- `Html` from `@react-three/drei` (PerformanceMonitor overlay)
- `useFrame`, `useThree` from `@react-three/fiber`

**Produces:**
- Context value: `{ quality, config: LODConfig, fps, setQuality, enableAdaptive, setEnableAdaptive }`
- `LODConfig` fields per quality level: `particleDensity`, `shadowMapSize`,
  `enableReflections`, `enableCaustics`, `enableGodRays`, `enableMotionBlur`,
  `enableBloom`, `volumetricSamples`, `maxParticles`, `viewDistance`
- Console warnings on sustained <30 FPS or JS heap >300 MB.

**Boundaries (Do NOT):**
- Do NOT set `renderer.setPixelRatio` or `shadowMap.mapSize` from outside `LODManager` —
  it owns those budgets.
- Do NOT hardcode particle counts or shadow sizes in child components; read them from
  `useLOD().config` so the adaptive system can scale them.
- Do NOT fight `LODManager` by calling `setQuality` from multiple places concurrently;
  it syncs with the Zustand store and the adaptive loop simultaneously.

**Known Pain:**
- Adaptive hysteresis thresholds (`downgradeThreshold = targetFPS - 10`,
  `upgradeThreshold = targetFPS + 5`) and the 3-second / 2-second hold timers are
  hardcoded in the provider body — there is no prop to tune them.
- `PerformanceMonitor` uses `import.meta.env.DEV` as default visibility, which means it
  always shows in Vite dev mode.

---

### `src/systems/SplashSystem.tsx`

**Purpose:** Velocity- and contact-driven splash and foam particles spawned when the
player enters/exits water or moves at speed while submerged. All particles are drawn
from pre-allocated `ParticlePool`s to avoid per-frame GC pressure.

**Runs in:** React render (component) + `useFrame` (particle update + instanced mesh write).

**Exports:**
- `SplashSystem` (named React component)
- `default SplashSystem`

**Consumes:**
- `ParticlePool`, `VFXParticle`, `FoamParticle` from `src/systems/ParticlePool`
- `useBiomeMaterials` from `BiomeSystem` (foam/water color)
- `useFrame` from `@react-three/fiber`
- **Does NOT import `SplashParticles.jsx`** — that is a separate legacy component.
- **Does NOT import `useRiverAudio`.**

**Props:**
- `playerRef` — Rapier rigid body ref
- `waterLevel?`, `waterWidth?`, `flowDirection?`, `flowSpeed?`

**Produces:**
- One `<instancedMesh>` (up to 200 instances) driven by active splash + foam particles.
- Splash arc on water entry (intensity 1.0) and exit (0.5).
- Foam trail while moving at speed (>2 m/s) inside water.

**Boundaries (Do NOT):**
- Do NOT allocate `new VFXParticle()` or `new FoamParticle()` per-frame outside the
  pool — this causes GC spikes. Always use `pool.acquireMultiple(n)` and
  `pool.release(p)`.
- Do NOT render this component outside a `<BiomeProvider>` — it calls `useBiomeMaterials`
  which requires the context.

**Known Pain:**
- `MAX_INSTANCES = 200` is hardcoded; at high quality budgets (LODManager allows up to
  2000 particles) the instanced mesh cap becomes the bottleneck.
- Water entry is detected by `playerPos.y < waterLevel`, which does not account for
  non-flat water surfaces.
- **Cross-ref:** `WaterInteraction.jsx` mounts alongside this component (`Experience.jsx`,
  adjacent JSX blocks) with independent splash pools (`0.15³` box geometry) for the same
  water-entry / proximity+speed events — see the `WaterInteraction` card.

---

### `src/components/WaterReflection.jsx`

**Purpose:** Planar reflection pass — renders the full scene from a camera mirrored below
the water plane into an offscreen `WebGLRenderTarget`, clipped to geometry above
`waterLevel`. Intended to feed a water-surface `reflectionTexture` uniform.

**Runs in:** React component inside R3F `<Canvas>` + `useFrame` (returns `null` — no DOM
or mesh output).

**Exports:**
- `WaterReflection` (default React component)
- `useWaterReflection()` — stub hook (always returns `null`)

**Consumes:**
- `useThree()` — `scene`, `camera`, `gl`
- `useFrame` from `@react-three/fiber`
- `THREE.WebGLRenderTarget`, `THREE.PerspectiveCamera`, clip planes
- Parent gate: `lodConfig.enableReflections` from `useLOD()` (`true` only for `high` /
  `ultra` presets in `LODManager.tsx`) and `debug.isStageEnabled('worldSystems')` in
  `Experience.jsx`

**Props:**
- `waterLevel?` — default `0.5`; clip plane and mirror plane Y
- `resolution?` — default `1024`; RT width/height (`Experience.jsx` passes `1024`)
- `updateInterval?` — default `2`; render every N frames (`Experience.jsx` passes `2`)
- `reflectionStrength?` — **dead prop** (destructured in signature, never read in body)

**Produces:**
- Populated `WebGLRenderTarget` held in `renderTargetRef` (1024×1024 RGBA, no depth)
- **Nothing in production reads this texture** — see Known Pain

**Update Cadence:** Throttled — `useFrame` skips unless `frameCount % updateInterval === 0`
(every 2 frames with current wiring).

**Render Footprint:** High — one full `gl.render(scene, reflectCam)` into the RT per tick,
plus GL state save/restore (render target, viewport, scissor, `autoClear`, clip planes).
Cost scales with scene complexity and RT resolution; runs only when LOD quality is `high` or
`ultra`, i.e. players with the most GPU headroom pay for zero visible benefit today.

**Boundaries (Do NOT):**
- Do NOT assume reflections appear on the water surface — `FlowingWater.jsx` (live water
  shader) has no `reflectionTexture` uniform; `EnhancedWaterMaterial.js` defines one but
  is not imported anywhere in `src/`.
- Do NOT call `useWaterReflection()` expecting a texture — it hardcodes `return null`.
- Do NOT mount without the LOD gate — duplicate scene renders are expensive.

**Known Pain:**
- **Primary:** Dead weight in production. The RT is filled every 2 frames but no material
  samples it. `useWaterReflection()` is a stub. Only `createEnhancedWaterMaterial()` knows
  how to consume `reflectionTexture`, and that factory is unused. High/ultra LOD players
  pay the full duplicate-render cost for zero visible pixels.
- `reflectionStrength` prop is accepted but never applied (no fade/strength in shader path).
- Fixing this (wire into `FlowingWater.jsx` or remove the pass) is out of scope for
  documentation — track as a separate engineering decision.

---

### `src/components/WaterInteraction.jsx`

**Purpose:** Secondary water-contact VFX — proximity/speed splash particles, raft bow-wave
mesh deformation, and raft mist spray when submerged. Complements `SplashSystem` with
overlapping splash behaviour using a separate implementation.

**Runs in:** React component inside R3F `<Physics>` + `useFrame` (particle sim + instanced
matrix writes every frame).

**Exports:**
- `WaterInteraction` (default React component)

**Consumes:**
- Rapier rigid body via `target` ref — `translation()`, `linvel()`, `rotation()`
- `useFrame` from `@react-three/fiber`
- Local plain-object particle pools (not `ParticlePool.ts`)
- `THREE.InstancedMesh`, `THREE.BoxGeometry(0.15, 0.15, 0.15)`, `THREE.ShaderMaterial`
  (bow wave)

**Props:**
- `target` — Rapier `RigidBody` ref (same `vehicleRef` as `SplashSystem` in `Experience.jsx`)
- `isRaft?` — enables bow-wave mesh + mist (`vehicleType === 'raft'`)
- `waterLevel?` — default `0.5`
- `maxVelocity?` — default `10` (`Experience.jsx` passes `15`)
- `flowSpeed?` — default `1.0`; scales bow-wave height, mist spawn count, splash count —
  **not passed from `Experience.jsx`**, so production always uses `1.0` unlike
  `SplashSystem`, which receives `biomeMaterials.water.flowSpeed`

**Produces:**
- Up to 50 splash instanced particles (`MAX_SPLASH_PARTICLES`) when near water surface
  and speed > `SPLASH_CONFIG.minSpeed` (1 m/s)
- Up to 30 mist instanced particles (raft only, submerged > 60%, speed > 2 m/s)
- Bow-wave `mesh` with vertex displacement (raft only, visible when speed > 1 m/s)

**Update Cadence:** Every frame when `target.current` is set; early-out hides splashes when
no target.

**Render Footprint:** Medium CPU — per-particle gravity/drag integration and
`setMatrixAt` for up to 80 instances; bow-wave updates all plane vertices when raft is
active. GPU: 1–3 draw calls (splash always; mist + bow wave when raft). No shared pool
with `SplashSystem` — duplicate allocation and update paths.

**Boundaries (Do NOT):**
- Do NOT assume `flowSpeed` tracks biome — wire it from `Experience.jsx` or
  `useBiomeMaterials()` if speed-scaled effects should match river flow.
- Do NOT add a third splash system for the same events — consolidate into
  `SplashSystem`/`ParticlePool.ts` long-term (see Known Pain).
- Raft-only meshes (`mist`, `bowWave`) are skipped when `isRaft` is false (runner mode).

**Known Pain:**
- **Redundant splashes with `SplashSystem.tsx`:** Both mount in `Experience.jsx` against
  the same `vehicleRef`, independently detect water proximity/entry, and spawn near-identical
  `0.15×0.15×0.15` box particles via separate state tracking and pooling. CPU cost doubles
  for the same physical event.
- **`flowSpeed` not wired:** Bow-wave amplitude, mist density, and splash count always use
  the hardcoded default `1.0`; biome flow changes have no effect on this component.
- Mist particle alpha is computed but not applied to per-instance material (instanced mesh
  shares one material).

---

## WASM Module

### `src/systems/WatershedWasm.ts` + `emscripten/`

**Purpose:** Optional C++/WASM acceleration layer for computationally intensive physics:
Archimedes buoyancy, drag force, river-current flow force, and a linearised
Shallow Water Equations (SWE) grid simulator. A pure-TypeScript fallback is provided
for every calculation so the game runs correctly when the WASM binary is absent.

**Lazy-load pattern:**

```ts
import { getWasm } from '../systems/WatershedWasm';

// Call once (e.g., in a useEffect or game-init hook):
const wasm = await getWasm();

// Then use:
const upForce = wasm.computeBuoyancy(submergedVolume, 1000, 9.80665);
```

`getWasm()` returns a `Promise<WatershedNativeModule>`. Subsequent calls return the
same cached promise (singleton pattern via module-level `_modulePromise`). The WASM
glue JS (`/watershed_native.js`) is loaded via a dynamic `import()` that bypasses
bundler resolution — it is served as a static asset from `public/`.

**JS fallbacks (pure TypeScript):**
- `buoyancyFallback(submergedVolume, density?, g?)` — matches C++ formula
- `dragForceFallback(vx, vy, vz, cd, area, density)` — matches C++ formula

These are used in unit tests and in any code path that does not need the SWE grid.

**Exports (key):**
- `getWasm()` → `Promise<WatershedNativeModule>`
- `createSWEGrid(mod, width, height, dx?)` → `SWEGrid` (allocates grid in WASM heap)
- `buoyancyFallback`, `dragForceFallback`
- Interfaces: `Vec3`, `WatershedNativeModule`, `SWEGrid`

**Current integration:** `FloatingObjectManager.ts` (PR #160) calls `getWasm()` on
first use, falls back to the TS implementations when the module is unavailable.

### Build

**Primary path — `build.sh`:**

```bash
npm run build:wasm        # runs emscripten/build.sh
```

Output written to `public/` (served as static assets by Vite):
- `public/watershed_native.js` — Emscripten glue + Embind dispatch
- `public/watershed_native.wasm` — WASM binary
- `public/watershed_native.worker.js` — pthread worker shim (`--threads` mode only)

**Graceful skip:** `build.sh` exits 0 with a warning when `emcc` is not in `PATH` —
the JS/WASM output is simply not regenerated. The TypeScript fallbacks ensure the game
still runs; only the C++ acceleration is skipped.

**Flags:**
| Flag | Effect |
|------|--------|
| _(none)_ | Single-threaded, `-O3`, SIMD |
| `--threads` | Multi-threaded (pthreads); requires COOP/COEP response headers |
| `--debug` | `-O0 -g3`, assertions, safe heap |

**Alternative — CMake:** `emscripten/CMakeLists.txt` provides a CMake build path for
IDE integration, but `build.sh` is the canonical route used by `npm run build:wasm`.

**Emscripten settings of note:**
- `MODULARIZE=1` + `EXPORT_NAME='createWatershedNative'` — module factory pattern
- `ALLOW_MEMORY_GROWTH=1` — heap grows beyond initial 64 MB as needed
- `EXPORT_ES6=1` — ES module output compatible with Vite
