# SYSTEMS.md — Reach / Biome / LOD / Splash / State / WASM

```text
GameState (Zustand) ── shared state ──> (all systems read/write)

LODProvider ──quality/config──> BiomeProvider ──biome palette──> scene
                                                     │
                                                     ├─> BiomeTransition / BiomeDetector
                                                     └─> PerformanceMonitor
ReachStreamer ──ReachManifest──> ReachNormalizer ──NormalizedSegment[]──> ReachManager ──wraps──> TrackManager ──> TrackSegment
   (fetch /api/reaches)                                                        │
                                                                               └─> ReactiveAudio, WeatherSystem
Player velocity/contacts ──> SplashSystem ──> ParticlePool ──> VFX
```

## Runtime System Contracts

### `src/systems/ReachManager.tsx`
**Purpose:** Orchestrate Reach loading lifecycle and feed normalized segments into the existing treadmill renderer.  
**Runs in:** React render + effects + `useFrame`.  
**Exports:** `default ReachManager`.  
**Consumes:** `ReachStreamer.preloadReach`, `normalizeReachManifest`, `TrackManager`, `ReactiveAudio`, `WeatherSystem`, `playerRef`, optional callbacks/forecast/retry state.  
**Produces:** `TrackManager` render with optional `reachSegments`, optional `ReactiveAudio` + `WeatherSystem`, loading/error callbacks, transition-entry logging.  
**Boundaries (Do NOT):** Do not bypass this orchestration by mounting `TrackSegment` directly; `ReachManager` wraps `TrackManager` rather than replacing it.  
**Known Pain:** Error path falls back to procedural mode and disables audio/weather side systems for safety; biome mapping is still hardcoded in a local map.

### `src/systems/ReachStreamer.ts`
**Purpose:** Fetch, validate, preload, cache, and evict Reach manifests/assets from the remote Reach API.  
**Runs in:** Async module functions (outside React render loop).  
**Exports:** `AssetCache`, `ReachStreamer`, `default ReachStreamer`, interfaces `AssetRef`, `ReachRequiredAssets`, `ReachTransition`, `ReachManifest`, `StreamResult`.  
**Consumes:** `three`, `GLTFLoader`, `validateReach` (`src/utils/reachValidator.ts`), `REACH_API_BASE` (`src/constants/game.ts`, `/api/reaches`).  
**Produces:** Cached manifests/assets (textures/models/audio/shaders/flowmaps) and preload summaries for orchestration callers.  
**Boundaries (Do NOT):** Do not assume this is local-only content; manifests and assets are fetched remotely and must remain validator-gated before use.  
**Known Pain:** Uses broad `any` manifest fields in several places; resilient partial-failure behavior can mask degraded asset sets if logs are ignored.

### `src/systems/ReachNormalizer.ts`
**Purpose:** Convert Reach manifests into flat `NormalizedSegment[]` consumed by the renderer/treadmill path.  
**Runs in:** Pure data-transform functions.  
**Exports:** `normalizeReachManifest`, `NormalizedSegment`, `default normalizeReachManifest`.  
**Consumes:** `ReachManifest` from `ReachStreamer`, `getTrackBiomeProfile`/`TrackBiomeProfile` from `src/configs/TrackBiomes.ts`, optional prior segment + forecast state.  
**Produces:** `NormalizedSegment[]` with spline path, biome/wall profile, widths, particle/effect values, and passthrough config.  
**Boundaries (Do NOT):** Do not pass raw manifest segment objects directly to runtime renderers; normalize first so wall profiles/tangent continuity/runtime defaults are applied consistently.  
**Known Pain:** Uses heuristic biome mapping and runtime defaults; malformed manifests can still produce “valid enough” segments that are visually inconsistent.

### `src/systems/BiomeSystem.tsx`
**Purpose:** Single authoritative source of biome state. Provides biome context and interpolates palette/light/fog state over time.  
**Runs in:** React context provider + `useFrame` components.  
**Exports:** `useBiome`, `BiomeProvider`, `BiomeTransition`, `BiomeDetector`, `useBiomeMaterials`.  
**Consumes:** `BiomePalette`, `getBiomePalette`, `normalizeBiomeId`, `lerpBiomePalettes`, `applyBiomeToLighting` (`src/configs/BiomePalettes.ts`), `useGameStore` (`src/systems/GameState.ts`), `useThree`, `useFrame`.  
**Produces:** Biome context (`currentBiome`, transitions, time-of-day controls), scene lighting/fog/background updates, derived material settings via `useBiomeMaterials`. On every `setBiome` call the canonical `BiomePalette.id` is mirrored to `useGameStore.currentBiome` so legacy consumers stay in sync.  
**Canonical vocabulary:** `canyonSummer` / `canyonAutumn` / `alpineSpring` / `cavern` / `delta` / `midnightMist` (keys of `BiomePalettes` in `src/configs/BiomePalettes.ts`).  
**Vocabulary normalisation:** `getBiomePalette` and `normalizeBiomeId` in `BiomePalettes.ts` transparently map legacy (`summer`, `autumn`) and JSON-authored (`creek-summer`, `canyon-sunset` …) IDs to the canonical vocabulary; callers do not need to pre-translate.  
**Boundaries (Do NOT):** Do not write `useGameStore.currentBiome` directly from any component other than `BiomeProvider`; that field is a read-only mirror of context state. Do not read `useGameStore.currentBiome` if you need palette-level detail — use `useBiome()` instead.

### `src/systems/LODManager.tsx`
**Purpose:** Manage quality presets/adaptive performance policy and expose runtime LOD config to scene systems.  
**Runs in:** React context provider + `useFrame` + optional debug overlay render.  
**Exports:** `useLOD`, `LODProvider`, `FrustumCulling`, `LODObject`, `PerformanceMonitor`.  
**Consumes:** Zustand `useGameStore` (`src/systems/GameState.ts`), `Html` from drei, `useThree`, `useFrame`, target FPS config.  
**Produces:** Current quality/config/fps context, adaptive up/down quality transitions, frustum-culling visibility updates, and debug perf overlay.  
**Boundaries (Do NOT):** Do not fight this system for quality ownership (pixel ratio, shadow map, particle budgets, and related quality toggles); consume `useLOD()` outputs instead of setting competing global quality knobs ad hoc.  
**Known Pain:** Quality controls are distributed across rendering components, so not every visual budget is yet enforced through one place.

### `src/systems/SplashSystem.tsx`
**Purpose:** Emit and update velocity/contact-driven splash/foam particles when player interacts with water volume.  
**Runs in:** React component + `useFrame`.  
**Exports:** `SplashSystem`, `default SplashSystem`.  
**Consumes:** `ParticlePool` (`VFXParticle`, `FoamParticle`), `useBiomeMaterials`, player rigid-body ref/velocity, water-level and flow params.  
**Produces:** Instanced particle render updates for splash + foam VFX with pool-backed object reuse.  
**Boundaries (Do NOT):** Do not allocate ad-hoc per-frame particle objects outside `ParticlePool`; pooling is the guardrail against GC spikes in the main loop.  
**Known Pain:** Pool sizes and instance caps are currently hardcoded (`MAX_INSTANCES`, constructor limits), which can under/over-shoot for different hardware targets.

### `src/systems/GameState.ts`
**Purpose:** Shared Zustand backbone for player/runtime/settings state used across systems.  
**Runs in:** Zustand store + selector hooks + frame-throttled helper.  
**Exports:** `useGameStore`, selector hooks (`usePlayerPosition`, `usePlayerSpeed`, `usePlayerBiome`, `useGamePaused`, `useGameWipeout`, `useGameSettings`, `useQualityPreset`, `useGravityMultiplier`), `batchFrameUpdate`, store types.  
**Consumes:** Zustand `create`; callers provide physics/player/segment updates.  
**Produces:** Centralized state and selective subscriptions to reduce unnecessary re-renders.  
**Boundaries (Do NOT):** Do not use this store as a per-frame physics source of truth for movement logic; high-frequency code should read rigid-body refs directly and push throttled updates into state.  
**Known Pain:** Naming is mixed between “player” and “current*” fields/hooks; this can create confusion in newer callers.

## WASM Module (`src/systems/WatershedWasm.ts` + `emscripten/`)

- **Purpose:** Optional C++/WASM acceleration path for buoyancy, drag, and shallow-water grid stepping.
- **Lazy-load contract:** `getWasm()` returns a Promise singleton and dynamically imports `/watershed_native.js`.
- **Runtime fallback pattern:** live code uses a module-level nullable (`let wasmModule: WatershedNativeModule | null = null`) and best-effort load, then falls back to JS math when unavailable (see `src/components/Environment/FloatingObjectManager.tsx`).
- **Primary build path:** `npm run build:wasm` (invokes `emscripten/build.sh`).
- **Graceful no-toolchain behavior:** `build.sh` exits cleanly when `emcc` is missing (`[build:wasm] Emscripten not found — skipping WASM compile ...`), so non-Emscripten dev environments still build.
- **Alternative build path:** `emscripten/CMakeLists.txt` supports an `emcmake`/CMake workflow, but `build.sh` is the primary documented route.
