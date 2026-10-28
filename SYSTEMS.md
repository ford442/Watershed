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
  (fetch /api/reaches)                     │                                    │
                                           │                                    ├──> ReactiveAudio
journeyContinuity / journeyHandoff ────────┴── seamless append / map handoff    └──> WeatherSystem
runSession (journeyMode + mapStack + survival carry)

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
- Selector hooks: `usePlayerPosition`, `usePlayerBiome`,
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

### `src/experience/ReachManager.tsx`

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
- On transition entry: prefetches `transition.nextReachId` (when authored), joins
  waypoints with control-point continuity, appends normalized segments, cross-fades
  biome via `BiomeProvider.setBiome`. Autosaves a journey checkpoint. (The
  `reach-exit` / `reach-enter` / `journey-handoff` window events it used to emit had
  no listener and were removed with the window event bus, #503 C.)
- On load error: renders `TrackManager` without segments so procedural generation takes over.

**Boundaries (Do NOT):**
- Do NOT mount `<TrackSegment>` directly from outside `TrackManager` — `ReachManager`
  wraps the treadmill; bypassing it breaks segment lifecycle and biome callbacks.
- Do NOT add loading-spinner or error UI inside this component — overlays are lifted
  to `ExperienceUI` / `InnerExperience`.
- Do NOT call `ReachStreamer.preloadReach` inside `useFrame` — handoff schedules it
  from the transition act path (async), never as a blocking frame body.

**Residual limits:**
- Transition Z-bounds remain a coarse trigger (not a full multi-axis portal volume).
- Reach HTTP 404 still falls back to procedural; handoff then checkpoints without
  appending remote segments.
- Map-campaign seamless handoff (Journey mode / Continue) is owned by
  `TrackManager.handoffToMap` + `useExperienceWorld.performSeamlessMapHandoff`,
  not by ReachManager alone.

---

### `src/systems/reach/ReachStreamer.ts`

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

### `src/systems/reach/ReachNormalizer.ts`

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

### `src/systems/biome/BiomeSystem.tsx`

**Purpose:** The biome's *look* (#521 B): interpolates fog, lighting, and material palettes across the
scene. Visual only — the flow cap, grip and cold under the player are the segment's `GameplayProfile`
(below), so recolouring a biome never changes the water. Provides `BiomeProvider`, `BiomeTransition`,
`BiomeDetector`, `useBiome`, `useBiomeActions`, `useBiomeStore`, `useBiomeView`, `useBiomeMaterials`.

**Runs in:** React context provider (`BiomeProvider`) + `useFrame` (`BiomeTransition` applies the palette;
the provider advances the cross-fade on the frame's sim delta, `advanceBiomeTransition`).

**Who reads what (so a 2 s cross-fade costs React two renders, not 48):**
- `useBiomeStore()` — the transient store: `getView()` / `getLivePalette()` / `subscribe()`. The cross-fading
  palette is committed to it once per progress step (`BIOME_TRANSITION_STEPS` = 48) and on start / settle /
  snap. Per-frame readers read it inside their own `useFrame`; nothing re-renders.
- `useBiome()` — the memoised context, for the rare re-render: `{ currentBiome, targetBiome,
  transitionProgress, isTransitioning, timeOfDay, setBiome, snapBiome }`. The value changes only when the
  target, transitioning-vs-settled or the coarse time of day changes. `currentBiome` is **one stable
  object updated in place** each step (a private copy — the palette tables are never mutated), so a
  `useFrame` closure over it always reads the current palette; `transitionProgress` is a live getter.
  `TrackSegmentMeshes` and `PostProcessingPipeline` read this and re-render ≤ 3 times across a fade
  (`BiomeSystem.renders.test.tsx`, which also pins what those two files destructure).
- `useBiomeActions()` — `{ setBiome, snapBiome }` in their own context; never re-renders. Scene-root hooks
  (`useInnerExperience`, `useExperienceWorld`, `ReachManager`) use this.
- `useBiomeView()` / `useBiomeMaterials()` — opt in to a re-render per committed step (`SplashSystem`'s
  foam colour and visual flow).

**Produces:**
- Per-frame mutations (`BiomeTransition`): fog color/near/far, ambient/hemi/sun/fill light colors and
  intensities, scene background color.
- `GameState.currentBiome` — mirrored by `setBiome` / `snapBiome` (the sole writers of the biome id).

**Boundaries (Do NOT):**
- Do NOT call `useBiome()` / `useBiomeActions()` outside a `<BiomeProvider>` — they throw.
- Do NOT read a palette (`flowSpeed` or anything else) for a gameplay force, hit, cap or timer — read the
  `GameplayProfile`. The palette is for colour, fog, light and surface shaders.
- Do NOT subscribe a scene-root or per-segment component to `useBiomeView()` / `useBiomeMaterials()`.
- Do NOT mutate `currentBiome` from a consumer; it is shared and updated by the store.
- Do NOT pass biome palette props into `EnhancedSky` — it reads context only.
- Do NOT directly mutate `scene.fog` or light colors in other components while `BiomeTransition` is
  mounted — it will overwrite your values every frame.
- Do NOT introduce a second biome vocabulary — all track, palette, HUD, and map fields use the single
  `BiomeId` union from `src/configs/biomes.ts`.
- Do NOT call `normalizeBiomeId` on hot paths — it is a map-load adapter only.
- Do NOT write `GameState.currentBiome` outside `setBiome` / `snapBiome`.

**Known Pain:**
- `BiomeDetector` uses a fixed `segmentLength = 40` approximation; it does not consult
  actual `NormalizedSegment` bounds.
- `currentBiome.id` on the context reads as the *target* id from the fade's first frame (the palette lerp's
  own id); a render that needs the id the fade started from reads `getView().currentBiome` at the start.

**Canonical IDs (`BiomeId`):** `canyonSummer`, `canyonAutumn`, `slotCanyon`,
`glacialMelt`, `glacier`, `delta`, `alpineSpring`, `cavern`, `midnightMist`,
plus stubs `lumberFlume` / `hydroDam`. Legacy kebab/track aliases
(`summer`→`canyonSummer`, `creek-autumn`→`canyonAutumn`, `canyon-sunset`→`slotCanyon`,
…) resolve only via `normalizeBiomeId` at map/reach load.

---

### `src/systems/map/gameplayProfile.ts` + `gameplayProfileTable.ts` (GameplayProfile, #521 B)

**Purpose:** What a stretch of river *does* to the player, apart from how it looks: `{ flowCap, friction,
cold, wind, blendSec }`. Resolved per segment by MapSystem (`resolveGameplayProfile(biome, slipperiness)`,
`resolveSegmentGameplayProfile(manager, index)`) from a gameplay table that started as a copy of the
palettes' `flowSpeed` (so no authored map's water moved) and is now independent of them.

**Runs in:** SimCore's `gameplay-profile` system (order 60, `createGameplayProfileSimSystem`). The live
profile (`getGameplayProfile()`, one stable object mutated in place) changes when ChunkManager commits a
biome (`biome-change`, after its 0.4 s sim-time debounce — the moment the pinned cap used to change) and,
for a profile with `blendSec > 0`, eases from the old profile on the sim step. Every table row has
`blendSec: 0` (a step), so nothing blends until a map asks.

**Consumers:** `WaterForceSystem` reads `flowCap` per frame for every force path (main thread, sim worker,
Rapier worker) — replacing the pin to the target palette's `flowSpeed`. `friction`, `cold` and `wind` are
resolved and blended but not read yet (surface friction and survival's ambient still use their own
tables; wiring them is the next consumer's job).

**Boundaries (Do NOT):** read a palette for gameplay; write the live profile from a render path; blend on
wall time.

---

### `src/systems/lod/LODManager.tsx`

**Purpose:** Adaptive quality scaling — measures FPS over a 60-frame window and holds
the target FPS with two valves: the **render scale** (a 0.5–1.0 multiplier on the
preset's DPR ceiling, which moves first) and then the **quality preset** itself
(`medium` → `high` → `ultra`; never auto-`low`). Exposes per-quality budgets for
particles, shadows, reflections, and volumetric samples via React context.

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
  with the settings menu, and owns `renderScale` (runtime, not a setting)
- `stepRenderScale` / `frameTimeBudgetMs` from `rendering/renderScale.ts` — pure valve
  math; see the Adaptive render scale section of `docs/reference/RENDERER.md`
- `isVisualCaptureMode` from `rendering/rendererConfig.ts` — the capture harness pins
  the valve open so visual-smoke baselines cannot move with frame time
- `Html` from `@react-three/drei` (PerformanceMonitor overlay)
- `useFrame`, `useThree` from `@react-three/fiber`

**Produces:**
- Context value: `{ quality, config: LODConfig, fps, setQuality, enableAdaptive, setEnableAdaptive, renderScale }`
- `GameState.renderScale` — the valve position, read by `App` (Canvas `dpr` prop) and
  `RendererQualitySync` (`setDpr` on the live renderer)
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
- Do NOT write `GameState.renderScale` from anywhere else. `LODManager` is the only
  writer; everything else reads it (or `deriveRendererContextOptions`, which folds it
  into `dprMax`). Two writers on one valve is an oscillator.
- Do NOT put the render scale into `rendererContextCreationKey()` — it moves several
  times a minute on a struggling machine, and that key is the Canvas remount trigger.

**Known Pain:**
- Adaptive hysteresis thresholds (`downgradeThreshold = targetFPS - 10`,
  `upgradeThreshold = targetFPS + 5`) and the 3-second / 2-second hold timers are
  hardcoded in the provider body — there is no prop to tune them. The render scale's
  own thresholds live in `renderScale.ts` as named constants, expressed as the
  frame-time form of the same two lines.
- The sampling tick is 60 *frames*, not one second, so on a machine running at 20 FPS
  every hold timer is three times longer in wall-clock terms than its name suggests.
  That predates the valve and applies to both stages equally.
- `PerformanceMonitor` uses `import.meta.env.DEV` as default visibility, which means it
  always shows in Vite dev mode.

---

### `src/systems/water/SplashSystem.tsx`

**Purpose:** Sole player/raft water-contact VFX owner — entry/exit splash arcs, rate-limited
cruise splash near the surface, foam trail while submerged at speed, raft mist crown, and
raft bow-wave mesh. All particles draw from pre-allocated `ParticlePool`s. SWE height-field
disturbances inject only on this path via `injectSWEDisturbance`.

**Runs in:** React render (component) + `useFrame` (particle update + instanced mesh write).
Mounted inside Rapier `<Physics>` by `WaterPhysicsEffects` in `src/experience/WaterStack.tsx`.

**Exports:**
- `SplashSystem` (named React component)
- `default SplashSystem`
- Pure helpers in `src/systems/water/splashSpawnMath.ts` (edge detection, cruise/mist counts)

**Consumes:**
- `ParticlePool`, `VFXParticle`, `FoamParticle`, `MistParticle` from `src/systems/pools/ParticlePool`
- `useBiomeMaterials` from `BiomeSystem` (foam/water color, and the visual `flowSpeed` unless a prop pins one)
- `simCore.ctx.rng` — the foam gate's stream (reseeded on every run reset)
- `useLOD` from `LODManager` — `config.maxParticles` (instance cap) and `config.particleDensity`
  (spawn-count scale)
- `injectSWEDisturbance` from `SWEHeightField`
- `useFrame` from `@react-three/fiber`

**Props:**
- `playerRef` — Rapier rigid body ref (`vehicleRef` from `InnerExperience`)
- `waterLevel?`, `waterWidth?`, `flowDirection?`, `flowSpeed?` (visual only; unset = the cross-fading palette's)
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

### `src/components/WaterReflection.tsx`

**Purpose:** Planar reflection pass — renders the scene from a camera mirrored through the
*local water datum* (the sheet under the camera, `sampleWaterSheetY`) into an offscreen
`WebGLRenderTarget`, clipped to geometry above it by the mirror camera's oblique near plane
(`src/rendering/planarMirror.ts` — works on both renderers; the node `Renderer` has no
`clippingPlanes`). Publishes the RT texture via `waterReflectionStore` for `FlowingWater` to
sample under Fresnel at `u' = 1 − u` (the mirror camera's image is flipped left↔right).

**Runs in:** React component inside R3F `<Canvas>` + `useFrame` (returns `null` — no DOM
or mesh output).

**Exports:**
- `WaterReflection` (default React component)
- `useWaterReflection()` — reads `texture` from `useWaterReflectionStore` (null when unmounted)

**Consumes:**
- `useThree()` — `scene`, `camera`, `gl`
- `useFrame` from `@react-three/fiber`
- `THREE.WebGLRenderTarget`, `THREE.PerspectiveCamera`, `updateMirrorCamera` /
  `frustumReachesBelow` (`planarMirror.ts`), `sampleWaterSheetY` (`bathymetrySampler.ts`)
- `useWaterReflectionStore` (`src/systems/water/waterReflectionStore.ts`) — publish/clear texture
- Parent gate: `lodConfig.enableReflections` from `useLOD()` (`true` only for `high` /
  `ultra` presets in `LODManager.tsx`) and `debug.isStageEnabled('worldSystems')` in
  `InnerExperience.tsx` / `WaterStack.tsx`

**Props** (driven by LOD budgets from `WaterReflectionLayer`):
- `waterLevel?` — default `0.5`; the sheet's height above the centreline path (the
  `sampleWaterSheetY` offset) — **not** an absolute Y
- `resolution?` — long-edge cap; the RT is otherwise half the drawing buffer, same aspect
  (`high`: 512, `ultra`: 1024)
- `updateInterval?` — render every N frames (`high`: 3, `ultra`: 2)
- `reflectionStrength?` — Fresnel mix weight published to the store (`high`: 0.45, `ultra`: 0.6)

**Produces:**
- Populated `WebGLRenderTarget` held in `renderTargetRef` (RGBA + depth buffer)
- Store publish: `setTexture(rt.texture)` on mount; `setStrength(reflectionStrength)` while
  the reflection renders and `0` while it is skipped; `clear()` on unmount so disabled LOD
  never leaves a stale sampler
- Live consumer: `FlowingWater.tsx` samples `reflectionTexture` under Fresnel
  (`FLOWING_WATER_SAMPLES_REFLECTION === true`)

**Update Cadence:** Throttled — `useFrame` skips unless `frameCount % updateInterval === 0`,
and skips the render (strength 0) while the camera is below the datum or no frustum corner
reaches below it. Water meshes live on `WATER_SURFACE_LAYER` (`src/rendering/renderLayers.ts`;
FlowingWater enables it on the main camera); the mirror camera's layer mask leaves it out,
so no per-frame traversal. Shadow maps are not re-rendered for the mirror view, and the
render loop allocates nothing.

**Render Footprint:** High when mounted — one full `gl.render(scene, reflectCam)` into the
RT per tick, plus GL state save/restore. Cost scales with scene complexity and RT
resolution; unmounted for `low` / `medium` (no extra scene render).

**Boundaries (Do NOT):**
- Do NOT mount without the LOD gate — duplicate scene renders are expensive.
- Do NOT leave the store populated after unmount — always `clear()` in the dispose path.

**Known Pain:**
- Clip plane / mirrored camera still approximate; no screen-space refraction pass.
- Dynamic shader overrides loaded via `useShaderLoader` must include `reflectionTexture` /
  `vReflectionUv` themselves if they replace the built-in fragment entirely.

---

### `src/systems/audio/AudioSystem.ts` (AudioManager)

The audio bus owner: one `THREE.AudioListener` on the camera, one-shots, ambient beds,
canyon acoustics. Singleton via `initAudio(camera)` / `getAudioManager()`.

**Consumes:**
- `SOUND_DEFS` (`src/systems/audio/soundDefs.ts`) — name → `public/sounds/` file; `aliasOf`
  entries share a payload *and* its decoded buffer (one fetch per file).
- `canyonAcousticParams` (`src/systems/audio/canyonAcoustics.ts`) — wall tightness + surface
  wetness → lowpass, reverb send, early-reflection taps.
- `currentWetnessMuffle` (`src/systems/audio/wetnessMuffle.ts`) — survival wetness → SFX duck.

**Produces:**
- `loadSound` / `playSound` / `setAmbient` (beds marked `loop` are re-seamed after decode —
  `src/systems/audio/loopBuffer.ts`).
- `routeAcoustics(source, 'rapids' | 'bed')` — layers re-routed whenever the walls change;
  only the rapids stem carries early reflections.
- `getSpeedWindBuffer()` — the synthesized fallback loop for `SpeedWindAudio`.

**Driven by:**
- `useCanyonAcoustics` (`src/hooks/useCanyonAcoustics.ts`, mounted in `useExperienceLifecycle`)
  — biome `wallTightness` ≥ 0.35 enables acoustics (glacial / slot enclosed, delta open).
- `SpeedWindAudio` — speed-wind + close-gurgle on the AudioWorklet
  (`src/systems/audio/speedWindDsp.ts`), buffer loop when `addModule` fails.

**Boundaries (Do NOT):**
- Do NOT fetch or decode before the unlock gesture — `loadSound` waits on
  `src/systems/audio/audioUnlock.ts` (Start click / Enter / pointer lock) so boot never
  contends with Rapier + WASM; `playSound` before unlock is a no-op.
- Do NOT point the speed-wind bed at `ambient_wind` (or any asset) — it is synthesized.
- Do NOT give two `SOUND_DEFS` file entries identical bytes — `soundDefs.test.ts` hashes
  `public/sounds/`; use `aliasOf`.
- Do NOT add Howler, a second listener, or audio middleware.

---

## Query flags (#521 E)

### `src/config/queryFlags.ts`

**Purpose:** Every URL flag the game reads at boot, parsed **once** into a frozen object
(`queryFlags`): `debug` (`?debug=1` and `?debug=true` are one flag), `noPointerLock`, `screenshot`,
`safe`, and the raw `map`, `vehicle`, `material`, `renderer`, `input`, `replay`, `simWorker`, `river`,
`level`, `levelUrl`, `reach`, `reachId`, `seed`. Values are raw strings (null = absent); resolving them
stays with their owners (`resolveMaterialBackend`, the map registry, …).

**Runs in:** module load (the page's boot). A flag read from a frame path (the runner's
`RunnerPhysicsStep` used to re-parse the query string every frame) or a module constant is a property
read.

**Boundaries (Do NOT):**
- Do NOT read `location.search` for a flag — ESLint bans it (`no-restricted-syntax`, next to the
  game-event rule in `eslint.config.js`). A new flag is a field on `QueryFlags`.
- Do NOT add a file to the lint allowlist without a reason. The listed per-flag helpers take an explicit
  `search` (their tests drive them with strings), default it to the live URL, and move to `queryFlags`
  as they are next touched.

---

## The sim core (#521)

### `src/sim/core/SimCore.ts` + `experience/SimCoreTick.tsx` + `experience/simSystems.ts`

**Purpose:** The one fixed-step gameplay clock. A plain module (no React, no three objects in its
state): a 1/60 s accumulator and an ordered registry of systems `{ id, order, step(ctx, dt) }`.
Gameplay that used to be advanced by an assorted `useFrame`, a React effect or a component's own
delta is a registered system, so a real frame, a replay and a headless run execute the same code.

**Runs in:** `SimCoreTick` — one `useFrame` at priority **−90**: after `InputHubTick` (−100) has
produced this frame's `InputFrame`, before `SkyClockTick` (−85, sun placement only) and every
default-priority subscriber (vehicles, Rapier, TrackManager). It samples the camera, the vehicle
body, the segment frame and the paused flag into `simCore.ctx`, then `simCore.advance(frameDelta)`.

**The step:** `advance(delta)` turns a frame delta into 0..`SIM_MAX_SUBSTEPS` (5) calls of `step()`;
a backlog past the clamp is dropped, not owed. `step()` is the only place a system runs, with
`dt = SIM_DT` (1/60) — never the frame delta. `stepScripted(n)` (input/scriptedRun.ts) holds the core
in *scripted mode* while it advances n R3F frames: one `advance()` is exactly one step, so n frames are
n steps whatever the deltas' float residue (`SimCore.test.ts` pins the parity).

**`SimContext`:** `rng` (the one `createRng`, seed `SIM_RNG_SEED`; a stable function reseeded on every
`watershed-run-reset`, so a restart draws what the first run drew — the splash foam gate reads it),
`time` (sim seconds), `stepIndex`, `input` (the hub's frame), `segment` / `segmentIndex`, `paused`,
`camera {z, sane}` and `vehicle` (position, velocity, pose quaternion as plain numbers).

**Systems (order bands):** 10 `weather-director` · 20 `sky-clock` · 30 `chunk-biome` (ChunkManager's
biome detection and its 0.4 s sim-time debounce) · 40 `survival` (`stepRunSurvival`) · 50 `pillars`
(crack timers and debris age, `pillarSimClock.ts`) · 60 `gameplay-profile` (below) · 90 `score` (score + the ghost's 10 Hz sample
clock, which splits are read off). The list lives in `experience/simSystems.ts`.

**Boundaries (Do NOT):**
- Do NOT advance gameplay from a `useFrame` delta, a timer or a React effect — register a system.
- Do NOT call a system's `step` directly; `simCore.step()` is the one entry.
- Do NOT put a three object, a React ref or a component in `SimContext`.
- Do NOT call `stepRunSurvival` from anywhere but the `survival` system (`tickRunSurvival`, the
  vehicles' hook, only reads the modifiers back).
- Do NOT tick a second SimCore or read `simCore.ctx.rng` from a render path.

**Known Pain:** the sample is taken before the vehicle's own step, so a system sees the body as the
last step left it (what the vehicle reads at the top of its step). The vehicles themselves are still
priority-0 `useFrame`s; moving them into the registry is the later picture in #521.

---

## The Living River (#464)

One run is one river on one day: a launch hour, a weather script and the day's melt inputs
(`RunConditions` in `runSession.ts`), all of it seeded and all of it stepped on the sim clock,
so a ghost replays the same river. Erosion (the bed remembering) is under SWE bathymetry
below; weather over a reach (lateral inflow, the squall front) under the upstream edge.

---

### `src/systems/weather/weatherDirector.ts` + `WeatherDirectorTick.tsx`

**Purpose:** The one owner of the run's weather. Steps the run's weather script
(`weatherScript.ts`: `[{ atReachFraction, weather, intensity, rampSeconds, overSegment? }]`)
against how far down the map the player is (`reachFraction.ts`), ramping between steps.

**Runs in:** SimCore's `weather-director` system (order 10, `weatherSimSystem.ts`), on the fixed sim
step while unpaused. `WeatherDirectorTick` only keeps the director's ambient weather in step with the
biome. Module state mutated in place; a step allocates nothing.

**Produces:**
- *River weather* (`getDirectorRiverWeather`, `getDirectorOverSegment`) — script only: the
  router's head or lateral discharge, the hull's snow drag, the surface slush.
- *Visual weather* — the river weather when it is not clear, else the ambient one (a reach
  manifest's, or the glacial biomes' snow); published to the store's `weather` slice, which
  `WeatherSystem` renders and everything else subscribes to.

**Boundaries (Do NOT):**
- Do NOT post `weather-update` window events or write the `weather` slice anywhere else —
  the director is its only writer.
- Do NOT step it on wall time; a replay must reach the same step on the same frame.
- Do NOT let ambient weather reach the water: it is visual only.
- Steps only advance: a respawn upstream does not bring an earlier sky back.

---

### `src/systems/sky/skyClock.ts` + `sunPosition.ts` + `SkyClockTick.tsx`

**Purpose:** The time of day. `hour = launchHour + elapsedSimSec × speedup / 3600` (default
1 real minute = 10 game minutes, per map in `maps/atmosphere.ts` with its latitude and day of
year); `sunPosition(hour, latitude, dayOfYear)` is NOAA's approximation (~60 lines, no
dependency). World frame: +X east, +Y up, −Z north.

**Runs in:** SimCore's `sky-clock` system (order 20, `skySimSystem.ts`), fixed step, unpaused only;
`SkyClockTick` (`useFrame` −85) places the sun refs. Reset per run by `runSession`.

**Produces:** `getSkyClock()` per frame — the sun vector and factors (`daylight`, `night`,
`golden`, `elevation01`) that `SceneLighting`, `EnhancedSky` (turbidity / horizon), fog, water
(`sunDirection`, `nightFactor`, deep colour / specular), post and the stars gate all read —
GLSL and TSL from the same uniforms. `subscribeSkyPhase()` for coarse React state (~every 5
game minutes). Night mode follows the clock (`useNightMode`); the `N` key only overrides it
under `?debug=1`.

**Boundaries (Do NOT):** Do NOT read `Date` or wall time for the sky; do NOT keep a second
time-of-day — `BiomeProvider`'s `timeOfDay` follows the clock's phase.

---

### `src/systems/daily/dailyRiver.ts` + `TodaysRiverCard.tsx`

**Purpose:** Today's River — one river per UTC day, the same for every client. `dailySeed`
is FNV-1a of the date; named sub-streams (`forkSeed(seed, 'map' | 'hour' | 'weather' | 'melt')`)
pick the map, a daylight launch hour, a weather pattern (clear, a squall over one reach,
showers, building, fog, flurries) and the melt inputs. No server, no date library.

**Produces:** `dailyRiverFor(dateKey)` → `{ dateKey, seed, mapId, launchHour, pattern,
conditions }`. The StartMenu's lazy card shows it above the map list with the 24 h flow
strip and today's best; RUN TODAY'S RIVER starts it with those conditions. Runs key as
`mapId@YYYY-MM-DD:seed` (`dailyRunKey`), so bests, the PB ghost and the fairness key are the
day's; `pruneDailyRecords` keeps a week.

**Boundaries (Do NOT):** Do NOT draw from a shared stream across the four picks (adding a
weather pattern must not move the day's map); do NOT read the local timezone.

---

### Replay — `?replay=<ghost>` (`src/input/replay.ts`, `sweChecksum.ts`)

**Purpose:** A `.wsghost` is a run: the v4 input track plus launch hour, seed, vehicle and
conditions. `?replay=` (same-origin) skips the menu, starts that river and feeds the input
track to `ScriptedSource` on the fixed 1/60 s scripted clock, holding the recorded look per
10 Hz window.

**Determinism contract:** two replays of one ghost produce identical split times and
identical SWE checksums (`checksumSweState`, FNV-1a over h/u/w bits, stored per split).
What makes it hold: a scripted or replay run steps SWE on the main thread
(`sweBackend` `scripted-run`); the SWE step-rate compare takes a 1e-6 s epsilon; weather, sky,
surge fronts and erosion refreshes all run on the solver / sim clock; adaptive LOD is off;
scripted runs neither load nor save the eroded bed. `pnpm test:replay-smoke` gates it in CI.

---

## Physics Worker (ADR v1)

### `src/physics/rapier.worker.ts` + `RapierWorkerProxy`

**Purpose:** Step the raft's Rapier rigid body off the render thread. **Default on** wherever
the browser exposes `Worker` + `WebAssembly`. Kill switches, in precedence order:
`?physicsWorker=0` (legacy alias `?raftWorker=0`) > capability detection > `?physicsWorker=1` >
Settings → Physics > default on. The decision is made once per vehicle mount by
`resolvePhysicsWorker` (`src/utils/physicsWorkerFlag.ts`); switching mid-session would strand
the Rapier body between two authorities.

**The worker's static world is the level (#465 C2).** There is no authored floor: the old
`INIT` box at an absolute `y = LEVEL − 0.65` did not descend with the centreline, so the raft
floated through walls and rocks. Static colliders register in `src/physics/workerColliderRegistry.ts`
as they mount — track-segment trimesh (`seg:<id>`, `TrackSegmentCollisionMeshes`), rock and pillar
hulls (`Rock.tsx`), canyon boulders (`CanyonDecorations.tsx`), active pooled obstacles, intact
trestle planks — and unregister on unmount/shatter/break. Entries are lazy factories, so nothing is
copied while no worker exists. `raftWorkerSession.ts` waits for the first `seg:` collider, `INIT`s
the worker at the raft's current pose, replays the registry (`attachColliderRegistry`, ACKed), then
hands the proxy to `RaftVehicle`; until then the main-thread path owns the raft. Shapes: `box`,
`trimesh` (world-space), `hull` (`staticColliderBody.ts`); buffers are transferred. The worker
runs commands in arrival order, so an add posted during `INIT` waits for it.
Not mirrored: floating debris (dynamic) and the splash/pond safety box (absolute `y = −8`).
Collision **events** (pillar cracks, trestle breaks, collision particles) still fire on the
main-thread mirror body, which the worker's state overwrites each step.

**Who owns the raft's water force (#455 Phase B):** the **sim worker**. The Rapier worker does
not load `watershed_native` (no `workerWasm.ts` in its module graph —
`rapierWorkerGraph.test.ts`); its old native path resolved `public/` against its own script URL
and never loaded anyway. On the `wasm-worker` SWE backend `RaftVehicle` hands both workers one
end of a `MessageChannel` (`linkPhysicsToSim` → `CONNECT_SIM` / `CONNECT_PHYSICS`), so hull
state and force travel worker-to-worker (`src/sim/hullLinkProtocol.ts`,
`src/physics/hullLinkClient.ts`).

**Tick order (Rapier tick N, linked):**

```txt
1. Take the latest HULL_FORCE (from the state posted after tick N−1, computed on the sim
   worker's live field) — none yet, or older than HULL_FORCE_MAX_AGE (3) ticks → TS fallback
2. Apply water-force impulses (force × dt × 0.001)
3. Apply external impulses (paddle, etc.)
4. world.step()
5. Post HULL (post-step state + authored config) to the sim worker
6. postMessage body snapshot + force diagnostics to render thread
```

So forces computed on sim tick N are applied on Rapier tick N+1 — the state they were computed
for is the one tick N+1 starts from. Before Phase B the force came from a flow sample of the
main-thread *mirror* (already a message old), re-sampled and relayed through `STEP`.

**Data boundary:** hull sample = one `simForces.ts` sample (Float64, 17 values: position,
velocity, authored flow cap, flow scale, authored water level, mass/volume/drag/areas, time,
turbulence); result = the 8-float native output `[forceXYZ, buoyancy, drag, flow, turbulence,
submergedRatio]` + the flow sample used `[dirX, dirZ, speed, surfaceOffset, depth, flags]`.
`STEP`'s `waterForce.simFlow` tells the worker the tick params are authored (sim-sampled).

**Fallback (#467):** the Rapier worker computes no force. With no fresh link force (`wasm-main` /
`wgsl` backends, `?simWorker=0`, failed handshake, the first ticks, a stalled sim worker) it
applies the TS mirror force `RaftVehicle` computed on the main thread for the state that step
starts from (`hullMirrorForce.ts`, sent as `waterForce.mirror`) — the same
`calculateWaterForceFallback` on the same tick params and state that used to run inside the
worker; `waterForceAuthority.ts` `pickHullForce` takes exactly one. Parity of the TS twin with the
C++ path is pinned by `src/physics/__tests__/waterForceParity.test.ts`. Worker init failure or
an explicit off → the main-thread `WaterForceSystem` + Rapier path.

**Two force paths (#467, `waterForceAuthority.ts`):** `'sim-worker'` (forces.cpp in the sim
worker: debris + main-thread vehicle via `FORCES`, the Rapier raft via the hull link) or
`'ts-mirror'` (`calculateWaterForceFallback` on the main thread). `WaterForceSystem` is split into
`sweHost.ts` (the field) and `waterForceBridge.ts` (the forces); the main thread never calls
forces.cpp, even on `wasm-main` (its module only steps the field).

**Phase 2 protocol (collider registration):** `ADD_STATIC_COLLIDER`, `REMOVE_STATIC_COLLIDER`,
`CLEAR_STATIC_COLLIDERS` — segment treadmill meshes can be streamed without a second worker.

**Debug:** DebugPanel (`?debug=1`) has a *Physics worker* section: worker state + the reason
it resolved that way, active force path (`wasm` = from the sim worker / `fallback`), last
force-batch cost in µs, and the live SWE grid. `window.__watershedPhysicsWorker` (dev) exposes
raw `waterForce` diagnostics (with `sampledFlow` when the sim worker computed it), `simLinked`
and the tick order.

## Sim Worker (#455)

### `src/sim/simWorker.ts` + `SimWorkerProxy` + `createWorkerSweSim`

**Purpose:** Run the SWE field — and everything that only feeds or reads it — off the render
thread, in one dedicated worker that owns its own `watershed_native` instance. Phase A: the
SWE step. **Phase B (shipped):** the river router and the water forces. Later: particle SoA +
HUD chores (C) and an opt-in Atomics/SharedArrayBuffer fast path (D). Rapier stays in its own
worker: two workers, one for rigid bodies, one for the field.

**Backend (`sweBackend.ts`, once per session):** `wgsl` on a native-WebGPU boot (stays on the
main thread — it needs the renderer's `GPUDevice`, and the worker must never request a second
one); otherwise `wasm-worker` (default) or `wasm-main` (`?simWorker=0`, no `Worker`, or a
failed handshake → `demoteSweSimBackendToWasmMain`). `wasm-main` and `wgsl` keep the whole
pre-worker path on the main thread (router, forces) unchanged.

**Clock:** the main thread still decides when to step and with what — `WaterForceSystem`
sends the same dt, splashes and hydro events it would hand the main-thread stepper, in the
same order. The worker runs `createWasmSweSim` on that stream, so the field is
**bit-identical** to `wasm-main` (`src/sim/simWorker.integration.test.ts`, real binary). A
decoupled fixed-dt worker loop is deliberately out: it would change the dt sequence and
therefore the field.

**Router (Phase B):** the main thread sends `ROUTER {reach, launchHour, forecast, H, g}` when
the run or its launch hour changes (same trigger as the main-thread rebuild) and the player's
chain index (`routingChainIndex`, pure JS) on every `SCROLL` / `STEP`. The worker keeps the
`RiverRouter` on its module, rates the edge *before* advancing it (the main-thread order),
advances it by the step's dt and steps with that `edgeEta`; entering cells take the same routed
state (`routedEdgeInflow`, shared code). A freshly placed window is filled only when a routed
state exists; the epoch advances either way. The router survives quality changes (grid
rebuilds) and is freed by `DISPOSE_ROUTER` on unmount.

**Forces (Phase B, `simForces.ts`):** after the frame's `STEP`, `WaterForceSystem` posts
`FORCES {seq, gridId, origin, samples}` for the vehicle (unless the Rapier worker owns it) and
every debris body — authored flow cap and water level, flow-independent config. The worker
samples the flow on its live grid (`sampleSWEFlow`, same function), stages the level
(`stagedWaterLevel`) and runs `computeWaterForcesBatch`, one native call per run of samples
whose configs are equal at float32 — the ABI takes one config per call, and each body has its
own sampled speed and stage; one call for all bodies needs a per-sample-config export (ABI
bump). Results come back in the request's buffer and are applied at the top of the next frame,
with the sampling frame's dt, to bodies still registered (`simForceRequests.ts`). Bit-identical
to a one-body-batch-per-body loop on the main thread over the same field (integration test). The
Rapier worker's hull arrives over its `MessagePort` (`HULL` → `HULL_FORCE`, see Physics
Worker); the worker tracks the window origin (`ORIGIN`, and on every `SCROLL`) so a hull lookup
never pairs the new index frame with the old origin.

**Segment meshes (#487 Phase B, `src/terrain/segmentMeshBuild.ts`):** a segment the treadmill
appends ahead of the camera (`SegmentData.buildAhead`, set by `ChunkManager.appendSegment`) asks
the live sim worker for its meshes: `BUILD_TILE {seq, spec}` carries the build context as
structured-clone data (`SegmentMeshSpec` — the path as its control points), the worker runs the
canyon / collision / wall / water builders on the same TypeScript terrain tile as the main
thread (`terrainTile.ts`; the C++ tile was retired at ABI 16) and answers `TILE {seq, meshes}` with every attribute array transferred; `useGeometries` wraps
them in `BufferGeometry` and `TrackSegment` mounts when they land (nothing renders in that slot
until then — the segment is ~150 m ahead). The builders are three-free (`segmentMeshBuild.ts`,
with exact ports of the curve / colour / plane / normals math in `meshMath.ts`, pinned against
three by `meshMath.test.ts`), so the worker chunk carries no three.js and the main thread runs
the very same code; `geometryBuilders.ts` only wraps their buffers. The boot and
restart pools (the ground under the player), sessions without a live sim worker, and a `TILE`
without meshes (the build threw) or a dead worker all build on the main thread, as before.
Worker meshes equal the main-thread build, every float and index (`terrainParity.test.ts`). The collision buffer still reaches the raft's Rapier worker through
the main thread (`useWorkerStaticCollider`): the main world needs it anyway, and it is ~10 KB.

**Main thread on `wasm-worker`, steady state:** no `computeWaterForcesBatch`, `routeReach*`,
`routedEdgeState`, `stepShallowWater*`, `applySWEEvent` or `scrollShallowWater` calls
(`WaterForceSystem.simWorker.test.tsx` spies on every one). Its module still serves gpu-chores
and particles until Phase C. **Instances per session on WebGL2: two** (main + sim worker).

**Protocol (`simWorkerProtocol.ts`):** `INIT` (page-resolved glue/wasm URLs — a worker's own
location is its script, not the page) → `READY {abi}`; `CONFIGURE`, `COMMIT_BED`, `ORIGIN`,
`SCROLL {fill: inflow | routed}`, `STEP {route?}` (queued `addSurface` ops ride along, applied
one by one), `DISPOSE_GRID`; `ROUTER`, `DISPOSE_ROUTER`; `FORCES` ↔ `FORCES` result;
`CONNECT_PHYSICS {port}`; `FRAME {gridId, frameIndex, epoch, computeMicros, inflow, buffer}` ↔
`RETURN_FRAME`; `BUILD_TILE {seq, spec}` ↔ `TILE {seq, meshes, buildMicros}` (#487 B).

**Frames (`SimFrame.ts`):** η | u | w | b in one transferred `ArrayBuffer`. The main thread
copies it into a stable mirror (`workerSweSim.ts` — readers such as gpu-chores hold `h`
across awaits, so the mirror is never a transferable) and returns the buffer; the worker
pools two. The worker copies out of the WASM heap on publish, so no heap view crosses
threads. `b` is filled only when the worker's bed changed in a way the main thread cannot
reproduce — a scroll, or an authored braid carving it (`bed: true`, #467); a bed the main
thread just committed is already in its mirror, so steady-state frames skip both copies. `inflow` is the routed
state the worker last derived; the mirror fills scrolled-in cells with it until the next frame
replaces the whole mirror (cosmetic only).

**Latency / ordering:** a step's field lands one message later (`fieldVersion` bumps then).
`scroll()` and `commitBed()` apply to the mirror at once and bump the epoch; a frame from an
older epoch is discarded, so the mirror never pairs a field with a window or bed it was not
computed on (same rule as the WGSL readback). Force results are world-space and always computed
on a consistent (grid, origin) pair inside the worker, so they are applied, not dropped, across
a scroll. Debris forces trail the field by one frame; the raft's by one Rapier tick.

**Failure:** `Worker` construction throws, the module fails to load in the worker, a worker
script error, or no `READY` within the WASM init deadline + 2 s (`?wasmInitTimeout=`) → the
handshake rejects (memoized — never retried into a second worker) and `WaterForceSystem`
falls back to `wasm-main` with a console warning — forces and router included. A worker that
dies *after* its field has stepped turns SWE off (`fail-open`) and forces fall back to the TS
math on the main thread; the Rapier worker drops the stale hull force after
`HULL_FORCE_MAX_AGE` ticks. No JS stepper or force loop in the worker.

**Worker bundle:** `simWorkerGraph.test.ts` keeps the map registry, React and THREE out
(the reach arrives as data; `SWE_MEAN_DEPTH` and the default forecast live in leaf modules).

### SWE quality budgets — `src/systems/water/sweQuality.ts`

The SWE height field is a visual system and is budgeted by the live quality preset
(`useQualityPreset`, which LODManager may downgrade adaptively):

| Preset | Grid | Cell | Step rate | Displacement |
|--------|------|------|-----------|--------------|
| low | — | — | off | 0 |
| medium | 32×24 | 0.75 m | 30 Hz | 0.14 |
| high | 48×32 | 0.5 m | 60 Hz | 0.22 |
| ultra | 128×80 | 0.5 m | 60 Hz | 0.26 |

`WaterForceSystem` reallocates the grid + upload texture when the budget changes, steps at
most `stepHz` times per second, and publishes `displacementScale` through the height-field
snapshot to `FlowingWater`. `injectSWEDisturbance` no-ops while the budget is disabled, and
the pending queue is capped, so splashes can't accumulate work nobody drains.

**Constraint:** do NOT quality-gate the force math. Buoyancy / drag / flow are
gameplay-affecting and must run identically at every preset.

### SWE bathymetry — `src/systems/water/bathymetrySampler.ts`

The solver's bed field `b` is **sampled from the canyon**, not left at 0 (#374 Phase 2).
Each live `TrackSegment` publishes its **hull grid** (`SegmentBedGrid` — the collision tile's
`h` plane plus the path point of each row, from `buildSegmentMeshBuffers` on the main thread
or the sim worker) once its meshes exist (`useGeometries`), keyed by segment ID so a recycled
treadmill slot replaces its own entry. The sampler interpolates the hull's own triangles,
so the SWE bed and the Rapier trimesh are one surface (#487 C; `terrainBedAgreement.test.ts`
holds them to 1e-4 at 200 random points per segment). `WaterForceSystem.refreshBed()`
rasterizes the registered sources into `grid.b` before stepping — only when the
player-centred window slides a whole cell or the registered set changes, not every frame.
The same whole-cell move first scrolls `h`/`u`/`w`/`b` through the index frame
(`scrollShallowWater`, `sweScroll.ts`), so the field stays fixed in world space and this
rasterize only rewrites the bed of a window that is already in the new frame.

**Upstream edge (ABI 10):** the window's +Z (last-row) edge is not transmissive when routing is
available. `riverRouter.ts` routes the launch hour's `flowRate` (`flowForecast.computeFlowRate`,
× 40 m³/s) from the glacial head down the campaign chain (`routingReach.ts` geometry,
`emscripten/routing.cpp` numerics), and `WaterForceSystem` hands the routed stage at the
player's segment (`useGameStore.currentSegmentIndex`, run-session map) to the step as
`edgeEta`; the scroll fill and a freshly placed window take the same routed state. So the hour
changes η — and therefore the hull through `sampleSWEFlow` — at the boundary, not only through
authored `hydroEvents` disks. `applyForecastToSegmentParams` still reshapes the authored
channel; the edge adds the wave. The routing never runs in TypeScript.

**Weather over a reach (ABI 14, #464 D):** the WeatherDirector's river weather reaches the
router once per step (`setWeather`). Weather with no reach (`overSegment` unset) rains on the
head, as before. A storm the script sits over a segment is **lateral inflow** there:
`routeReachLateral` routes the day's own head hydrograph and adds the weather's runoff
(`weatherFlowRateDelta × 40 m³/s`) at the top of that chain segment — so that reach's edge
rises at once, the reaches below with the routed lag, the reaches above never
(`riverRouter.lateral.test.ts`). A zero lateral routes bit-identically to `routeReach`.

**Squall front:** when the river weather strengthens to a storm ≥ `SQUALL_SURGE_INTENSITY`
while the player is on or below the reach it sits over, `weatherSurge.ts` sends one `surge`
front (stage `0.25 × intensity`) through the window at its bore speed, in world z, entering on
the side it will cross from (a runner outruns a ~3 m/s bore and meets it ahead; a slow raft is
overtaken). One front per squall: the storm must ease below half the trigger to re-arm.

**Datum (#487 C):** one for every segment. The water sheet hangs `WATER_LEVEL` above the path
and the hull floor `floorHeight` above it, so `b = floorHeight − (WATER_LEVEL − H)`
(`BED_DATUM`): a cell dries exactly where the floor rises through the water sheet, and the bed
is continuous across segment joins. This used to be a per-segment re-datum against the
mid-segment thalweg, because the slot profile floated its floor ~4 m above the sheet; the slot
profile is now lowered onto the shared datum (`TERRAIN_SLOT_FLOOR_LIFT`, floor and wall shell
together). Rock noise is excluded (the hull has none). Cells no segment covers
get `BATHYMETRY_DRY_BED` (`H + 2`) — dry land, not open water. Every cell is rewritten on
each refresh, so a previous slot's bed cannot leak into the next window. The strongest
riffle crests reach the sheet and read shallow-to-dry, as the meshes show them.

**Erosion (#487 E):** the river works its bed. Each mounted segment registers its hull grid
as built with `erosionField.ts`, and every solver step `sweHost` hands the field (the h/u/w/b
mirror every backend keeps on the main thread) to `accumulateFieldErosion`: each hull vertex
inside the window integrates `dE/dt = 0.005·max(0, q − 0.12) − deposit(q)` with `q = |u|·d`
(`terrain/erosion.ts`; still water does nothing, slowed water drops what it carries). The floor
every consumer reads is `h − E` clamped to ±0.4 m: the trimesh and the bed take it at their own
vertices, the visual floor interpolates it over the hull's own triangles — the three agree to
1e-4 at every hull vertex (`erosion.test.ts`). A segment re-meshes (floor, trimesh remount,
bathymetry re-register) when its plane has moved 1 cm since its last mesh, at most every 3 s
of solver time — so a replay refreshes on the same step. The plane outlives the mount: it is
saved per `mapId:segmentIndex` (`PersistenceSystem` `erosion`, quantized and run-length
coded, ≤ 200 kB, oldest first out) and the next mount — later today or tomorrow's river —
starts from it. Scripted / replay runs neither load nor save it. After a storm, meander's
second bend has dug its outside flank ~5× a clear day and ~3× its inside
(`erosionBend.test.ts`, committed binary); `safeZones.test.ts` holds every authored envelope
to a body on the deepest pool dug the full 0.4 m.

The result: a slot canyon dries out a couple of metres off-centre, a delta/pond stays wet
across the whole window, at identical grid sizes. `?sweDebug=1` mounts `SWEBedDebugOverlay`
(`src/components/SWEBedDebugOverlay.tsx`), a false-color view of the sampled bed — blue deep,
cyan shallow, tan dry.

**Constraint:** `low` quality allocates no grid, so bathymetry upload is a no-op there.

### Authored hydroEvents — `src/systems/water/hydroEvents.ts`

Maps declare `hydroEvents[]` (launch-hour keyed inflow / vortex / braid / roughness / surge).
After each SWE step, `WaterForceSystem` applies active events onto the same grid
(`applySWEEvent` C++ ABI 8 — `surge` since ABI 14 — or TS fallback). Ghosts hash the live set
(`hydroFairness.ts`). A `surge` is a stage step moving downstream at the bore speed of its
height (`surgeFrontSpeed`): the host places the front on the run's solver clock
(`authoredSurgeFrontZ` — from `SURGE_RUN_IN` m above the segment centre to as far below, then
`SURGE_PAUSE_SECONDS` before the next), and the kernel paints a band across the whole window
that raises η to the stage and carries the water downstream.

**Playability contract (#398).** An authored hour has to be *seen and felt*:

| Kind | Mesh (η / b) | Hull (sampleSWEFlow → calculateWaterForce) |
|------|--------------|--------------------------------------------|
| `inflowPulse` | η rises | stage lifts `waterLevel` (buoyancy) + downstream momentum; stage also raises the speed cap by `SWE_STAGE_SPEED_BOOST` |
| `vortex` | η sink | swirl in `u,w` — **and** `VortexForceSystem` stands down on that segment (`shouldApplyAuthoredVortexImpulse`), one field, one owner |
| `braid` | bed shoal (idempotent max, not an accumulation) | lateral push around the shoal |
| `roughness` | — | `u,w` damped, slower line |
| `surge` | η step crossing the window (only raises) | stage + downstream momentum as the front passes |

`hydroContrast.ts` measures both halves for a pair of hours and
`hydroContrast.test.ts` asserts `glacial` / `hydro` / `delta` clear
`HYDRO_CONTRAST_MARGINS` at 06:00 vs 14:00, as does the storm fixture
(`STORM_SURGE_FIXTURE`, a squall's front) on every backend. The lumber braid is authored only on
hours the forecast actually opens `washedOutGap`. `hydroHud.ts` turns the live set
into the HUD's hour board (`ForecastHUD`). `?hour=14` overrides the launch hour for
one page load (read-only, never written to persistence) so the same map can be
smoke-tested at both scouting hours.

**Constraint:** `h` is the free-surface *perturbation* η (swe.h ABI), zero at rest —
never seed it with the still depth. One sim backend per session, fixed at first use by
`resolveSweSimBackend()` (`sweBackend.ts`): the C++ WASM stepper, or on a native-WebGPU boot
(`?material=tsl&renderer=webgpu`, gate open) its WGSL twin `swe.wgsl` via `WgslSweSim.ts` on the
renderer's own `GPUDevice` — never both. `WaterForceSystem` drives either through `SweSim`
(`sweSim.ts`). On WGSL the field and every writer (splash delta, bed, `applySWEEvent` kernel) live on
the GPU; `h/u/w/b` readers see a mirror refreshed by async readback (one step behind) and
`fieldVersion` gates the height-texture upload. `?swe=wasm` pins the C++ stepper. `pnpm test:wgsl`
holds the two within 1e-5 on the host-smoke fixtures, the hull samples and the hydroContrast margins.
HeightmapFlow was deleted (#413) and must not come back.

---

## WASM Module

### `src/systems/water/{wasmAbi,wasmLoader,WatershedWasm,waterForceFallback}.ts` + `emscripten/`

**Layout:** `emscripten/common.h` (shared constants/types) + `forces.h`/`forces.cpp` (water force
math) + `swe.h`/`swe.cpp` (solver + SIMD grid sweeps) + `simdf32.h` + `chores.h`/`chores.cpp` (optional gpu-chores;
not SWE) + `particles.h`/`particles.cpp` (waterfall / splash SoA) + `routing.h`/`routing.cpp` + `bindings.cpp` (the plain C ABI: `extern "C" ws_*`
exports, the only Emscripten include; `ws_getVersion()` — **14**) + `host_smoke.cpp` (host assert runner). TypeScript: `wasmAbi.ts` (the `WASM_ABI` export table and `bindNativeModule`), `wasmLoader.ts` (fetch once, hash once, instantiate — shared by `getWasm()` and the sim worker), `WatershedWasm.ts` (SWE grid / force batch heap helpers), `waterForceFallback.ts` (TS twin of `forces.cpp`). The loader asserts `getVersion() >= MIN_WASM_ABI_VERSION` (**14** — the C ABI replaced Embind, so nothing older can be bound; every export is required; 14 added `routeReachLateral` and the `surge` event kind). Since #467 the whole `swe.cpp` step is 4-wide (`simdf32.h`): lift + CFL max, a branchless HLL / hydrostatic reconstruction over four adjacent faces, and the per-cell gather with damping fused — bit-identical to the scalar scheme on the host. Every preset's step is held to `SWE_STEP_BUDGET_MS` by `pnpm profile:swe` / `profile:physics`. All compile/link flags live in `CMakeLists.txt`; `build.sh` and `COMPUTE_SOURCES` are the only
places a new compute translation unit must be registered. Host: `cmake -S emscripten -B emscripten/build-host`.

**Purpose:** Optional C++/WASM acceleration layer for computationally intensive physics:
Archimedes buoyancy, drag force, river-current flow force, and a nonlinear
well-balanced Shallow Water Equations (SWE) grid simulator (conservative finite
volume, HLL + hydrostatic reconstruction, wetting/drying). A pure-TypeScript fallback is provided
for every calculation so the game runs correctly when the WASM binary is absent.
SWE is **domain hydrology**, not gpu-chores. HUD reduce/hist/downsample live in
`src/rendering/gpuChores/` and optionally call `chores.cpp`. Independent of `?material=tsl`.

**Lazy-load pattern:**

```ts
import { getWasm } from '../systems/water/WatershedWasm';

// Call once (e.g., in a useEffect or game-init hook):
const wasm = await getWasm();

// Then use (forces go through the batch; ABI 15 has no single-body export):
const batch = createWaterForceBatch(wasm, 1);
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

**Current integration:** debris registers into `WaterForceSystem` (via
`WaterForceRegistry`), not `FloatingObjectManager.tsx` calling `getWasm()` itself —
`WaterForceSystem` owns the lazy `getWasm()` load and falls back to the TS
implementations when the module is unavailable.

### Build

**Primary path — `build.sh`:**

```bash
bash scripts/emsdk-pinned.sh   # once: emcc 3.1.56 into ./emsdk
pnpm build:wasm                # runs emscripten/build.sh
```

Output written to `public/` (served as static assets by Vite):
- `public/watershed_native.js` — Emscripten glue (`_ws_*` C exports; ends with `WATERSHED_WASM_SHA`)
- `public/watershed_native.wasm` — WASM binary
- `--threads` builds go to `emscripten/build-threads/out/` (with the `watershed_native.worker.mjs`
  pthread shim) and never overwrite the shipped `public/` pair or the artifact stamp (#454)

**Toolchain pin (#467):** `pnpm build` no longer runs `build.sh` (the pair is committed;
`pnpm build:full` is the old chain). `build.sh` exits 1 when emcc is missing or differs from
`emscripten/EMCC_VERSION`; `WATERSHED_ALLOW_EMCC_MISMATCH=1` builds aside into
`emscripten/build/out/`, and `--debug` / `--threads` always build aside, so nothing but a
pinned release build ever writes `public/` or the stamp.

**Pairing:** `public/watershed_native.{js,wasm}` are committed and must be rebuilt
from pinned emcc **3.1.56** in one `pnpm build:wasm`. CI instantiates that committed
pair (`createWatershedNative()` / `emscripten/smoke_test.mjs`) and
`git diff --exit-code`s the artifacts after rebuild. The loader rejects a mixed js+wasm pair
by hash before instantiating it (`WATERSHED_WASM_SHA` vs `WASM_BINARY_SHA`).

**Flags:**
| Flag | Effect |
|------|--------|
| _(none)_ | Single-threaded, `-O3`, SIMD |
| `--threads` | Multi-threaded (pthreads); requires COOP/COEP response headers |
| `--debug` | `-O0 -g3`, assertions, safe heap → `emscripten/build-debug/out/` |

**Alternative — CMake:** `emscripten/CMakeLists.txt` provides a CMake build path for
IDE integration, but `build.sh` is the canonical route used by `pnpm build:wasm`.

**Emscripten settings of note:**
- `MODULARIZE=1` + `EXPORT_NAME='createWatershedNative'` — module factory pattern
- `ALLOW_MEMORY_GROWTH=0` — one fixed 16 MiB heap; heap views are made once (see WASM.md, Linear memory budget)
- `EXPORT_ES6=1` — ES module output compatible with Vite
