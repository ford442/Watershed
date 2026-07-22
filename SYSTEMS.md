# SYSTEMS.md — Watershed Orchestration Layer

Reference for the Reach / Biome / LOD / Splash systems, live-wired water components,
and the WASM acceleration module. Core orchestration lives in `src/systems/`; water
reflection lives in `src/components/` and mounts via `WaterStack` in `InnerExperience.tsx`.
Player/raft water-contact VFX is owned solely by `SplashSystem`.

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

Player velocity/contacts ──> SplashSystem ──> ParticlePool ──> splash/foam/mist InstancedMesh + raft bow-wave
                                         └──> injectSWEDisturbance ──> WaterForceSystem / SWEHeightField
WaterReflection (LOD high/ultra) ──> WebGLRenderTarget ──> waterReflectionStore ──> FlowingWater (Fresnel sample)
```

### Live nesting in `Experience.tsx` / `InnerExperience.tsx`

```jsx
<LODProvider initialQuality="high" enableAdaptive targetFPS={60}>   // LODManager.tsx
  <BiomeProvider initialBiome="canyonSummer" enableTimeOfDay={false}> // BiomeSystem.tsx
    <SunPositionProvider>
      <BiomeTransition />
      <InnerExperience>
        {/* visualization */}
        <EnhancedSky />                         // reads useBiome() — no biome props
        <SceneLighting … />
        <WaterReflectionLayer … />              // WaterStack.tsx (outside Physics)

        <Physics>
          <VehicleMount … />                    // RunnerVehicle | RaftVehicle
          <WaterPhysicsEffects … />             // WaterStack.tsx
            <WaterForceSystem … />
            <SplashSystem playerRef={vehicleRef} isRaft={…} flowSpeed={…} />
          <TrackManager | ReachManager | LevelLoader … />
        </Physics>

        <PostProcessingPipeline … />
        <ExperienceUI … />
      </InnerExperience>
      <PerformanceMonitor … />
    </SunPositionProvider>
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
- `onBiomeChange?`, `onLoadingChange?`, `onError?` — lifted callbacks for `InnerExperience` / `ExperienceUI`
- `forecastSamples?`, `retryKey?`

**Produces:**
- Renders `<TrackManager reachSegments={...} />` (plus `ReactiveAudio`, `WeatherSystem`).
- Logs transition entry/exit to console when player crosses `manifest.transition.segmentIndex`.
- On load error: renders `TrackManager` without segments so procedural generation takes over.

**Boundaries (Do NOT):**
- Do NOT mount `<TrackSegment>` directly from outside `TrackManager` — `ReachManager`
  wraps the treadmill; bypassing it breaks segment lifecycle and biome callbacks.
- Do NOT add loading-spinner or error UI inside this component — overlays are lifted
  to `ExperienceUI` / `InnerExperience`.

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
- Per-segment flood overrides now flow through `forecastByIndex` + shared
  `applyForecastToSegmentParams` (same table as ChunkManager). Live forecast
  updates re-apply multipliers without remeshing the spline.

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
- Consumed by `EnhancedSky` via `useBiome()` (no biome props from `InnerExperience`).

**Boundaries (Do NOT):**
- Do NOT call `useBiome()` outside a `<BiomeProvider>` — it throws.
- Do NOT pass biome palette props into `EnhancedSky` — it reads context only.
- Do NOT directly mutate `scene.fog` or light colors in other components while
  `BiomeTransition` is mounted — it will overwrite your values every frame.
- Do NOT introduce a second biome vocabulary — all track, palette, HUD, and map
  fields use the single `BiomeId` union from `src/configs/biomes.ts`.
- Do NOT call `normalizeBiomeId` on hot paths — it is a map-load adapter only.
  `ChunkManager` / `TrackManager` emit canonical IDs after load.
- Do NOT write `GameState.currentBiome` outside `setBiome` / `snapBiome` —
  those are the sole store writers for biome id.

**Known Pain:**
- `BiomeDetector` uses a fixed `segmentLength = 40` approximation; it does not consult
  actual `NormalizedSegment` bounds.

**Canonical IDs (`BiomeId`):** `canyonSummer`, `canyonAutumn`, `slotCanyon`,
`glacialMelt`, `glacier`, `delta`, `alpineSpring`, `cavern`, `midnightMist`,
plus stubs `lumberFlume` / `hydroDam`. Legacy kebab/track aliases
(`summer`→`canyonSummer`, `creek-autumn`→`canyonAutumn`, `canyon-sunset`→`slotCanyon`,
…) resolve only via `normalizeBiomeId` at map/reach load.

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

**Purpose:** Sole player/raft water-contact VFX owner — entry/exit splash arcs, rate-limited
cruise splash near the surface, foam trail while submerged at speed, raft mist crown, and
raft bow-wave mesh. All particles draw from pre-allocated `ParticlePool`s. SWE height-field
disturbances inject only on this path via `injectSWEDisturbance`.

**Runs in:** React render (component) + `useFrame` (particle update + instanced mesh write).
Mounted inside Rapier `<Physics>` by `WaterPhysicsEffects` in `src/experience/WaterStack.tsx`.

**Exports:**
- `SplashSystem` (named React component)
- `default SplashSystem`
- Pure helpers in `src/systems/splashSpawnMath.ts` (edge detection, cruise/mist counts)

**Consumes:**
- `ParticlePool`, `VFXParticle`, `FoamParticle`, `MistParticle` from `src/systems/ParticlePool`
- `useBiomeMaterials` from `BiomeSystem` (foam/water color)
- `useLOD` from `LODManager` — `config.maxParticles` (instance cap) and `config.particleDensity`
  (spawn-count scale)
- `injectSWEDisturbance` from `SWEHeightField`
- `useFrame` from `@react-three/fiber`
- **Does NOT import `SplashParticles.jsx`** — that is a separate unused legacy component.
- **Does NOT import `useRiverAudio`.**

**Props:**
- `playerRef` — Rapier rigid body ref (`vehicleRef` from `InnerExperience`)
- `waterLevel?`, `waterWidth?`, `flowDirection?`, `flowSpeed?` (biome flow from WaterStack)
- `isRaft?` — enables mist crown + bow-wave (`vehicleType === 'raft'`)
- `maxVelocity?` — default `15`; scales cruise intensity and bow-wave height

**Produces:**
- One splash/foam `<instancedMesh>` capped at `useLOD().config.maxParticles` (200 / 500 / 700 / 2000)
- Splash arc on water entry (intensity 1.0) and exit (0.5), with SWE inject
- Rate-limited cruise splash when near water and speed > 1 m/s (suppressed on entry/exit frames)
- Foam trail while submerged at speed > 2 m/s (occasional SWE inject)
- Raft only: mist `InstancedMesh` (scale-fade) + bow-wave plane (CPU + shader deform)

**Boundaries (Do NOT):**
- Do NOT allocate `new VFXParticle()` / `FoamParticle()` / `MistParticle()` per-frame outside
  the pool — always use `pool.acquireMultiple(n)` and `pool.release(p)`.
- Do NOT render outside a `<BiomeProvider>` / `<LODProvider>` — requires those contexts.
- Do NOT mount a second splash/mist system for the same `vehicleRef` contact events.
- Do NOT inject SWE disturbances from a parallel VFX path — keep injects here only.

**Known Pain:**
- Water entry is detected by `playerPos.y < waterLevel` (flat plane), which does not account
  for non-flat water surfaces.
- Raft paddle/shed foam in `raftPhysicsRuntime.ts` remains a separate local pool (paddle-stroke
  events, not contact consolidation).

---

### Water-contact particle path — consolidated

Former parallel water-interaction component was removed. Contact VFX lives solely in
`SplashSystem` (cruise splash, mist crown, bow-wave). Do not reintroduce a second path.

---

### `src/components/WaterReflection.jsx`

**Purpose:** Planar reflection pass — renders the full scene from a camera mirrored below
the water plane into an offscreen `WebGLRenderTarget`, clipped to geometry above
`waterLevel`. Publishes the RT texture via `waterReflectionStore` for `FlowingWater` to
sample under Fresnel.

**Runs in:** React component inside R3F `<Canvas>` + `useFrame` (returns `null` — no DOM
or mesh output).

**Exports:**
- `WaterReflection` (default React component)
- `useWaterReflection()` — reads `texture` from `useWaterReflectionStore` (null when unmounted)

**Consumes:**
- `useThree()` — `scene`, `camera`, `gl`
- `useFrame` from `@react-three/fiber`
- `THREE.WebGLRenderTarget`, `THREE.PerspectiveCamera`, clip planes
- `useWaterReflectionStore` (`src/systems/waterReflectionStore.ts`) — publish/clear texture
- Parent gate: `lodConfig.enableReflections` from `useLOD()` (`true` only for `high` /
  `ultra` presets in `LODManager.tsx`) and `debug.isStageEnabled('worldSystems')` in
  `InnerExperience.tsx` / `WaterStack.tsx`

**Props** (driven by LOD budgets from `WaterReflectionLayer`):
- `waterLevel?` — default `0.5`; clip plane and mirror plane Y
- `resolution?` — RT width/height (`high`: 512, `ultra`: 1024)
- `updateInterval?` — render every N frames (`high`: 3, `ultra`: 2)
- `reflectionStrength?` — Fresnel mix weight published to the store (`high`: 0.45, `ultra`: 0.6)

**Produces:**
- Populated `WebGLRenderTarget` held in `renderTargetRef` (RGBA, no depth)
- Store publish: `setTexture(rt.texture)` + `setStrength(reflectionStrength)` on mount;
  `clear()` on unmount so disabled LOD never leaves a stale sampler
- Live consumer: `FlowingWater.jsx` samples `reflectionTexture` under Fresnel
  (`FLOWING_WATER_SAMPLES_REFLECTION === true`)

**Update Cadence:** Throttled — `useFrame` skips unless `frameCount % updateInterval === 0`.
Water meshes tagged `userData.isWaterSurface` are hidden during the reflection render to
avoid feedback.

**Render Footprint:** High when mounted — one full `gl.render(scene, reflectCam)` into the
RT per tick, plus GL state save/restore. Cost scales with scene complexity and RT
resolution; unmounted for `low` / `medium` (no extra scene render).

**Boundaries (Do NOT):**
- Do NOT mount without the LOD gate — duplicate scene renders are expensive.
- Do NOT assume `EnhancedWaterMaterial.js` is live — it remains an unused legacy sample
  reference; the production consumer is `FlowingWater.jsx`.
- Do NOT leave the store populated after unmount — always `clear()` in the dispose path.

**Known Pain:**
- Clip plane / mirrored camera still approximate; no screen-space refraction pass.
- Dynamic shader overrides loaded via `useShaderLoader` must include `reflectionTexture` /
  `vReflectionUv` themselves if they replace the built-in fragment entirely.

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
