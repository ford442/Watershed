# Testing Guide for Watershed

## Quick Start Testing

### 1. Install and Run
```bash
npm install
npm start
```

The application will open at `http://localhost:3000`

### 2. Verify Player Spawn Fix

#### Expected Behavior
When the application loads, you should see:

1. **Initial View**: An overhead camera view showing the canyon from above
   - Camera position: [0, 25, 10] (25 units high, 10 units back)
   - You should see the canyon track enclosing the starting corridor

2. **Player Settled**: On load
   - Player capsule should already be nestled in the creek corridor (around Z≈5)
   - Capsule hovers slightly above the water before settling on the floor

3. **Player Ready**: After physics settles
   - Player should be standing on the track surface
   - Camera should be in first-person view
   - Position should be approximately [0, -4 to -5, 5]

#### What to Look For ✅
- [ ] Scene renders with textures visible (rocky canyon walls)
- [ ] Player doesn't start embedded in geometry (no black screen or clipping)
- [ ] Player falls smoothly onto track surface
- [ ] Camera view is clear (not inside walls)
- [ ] Physics responds correctly (player lands, doesn't fall through floor)

#### Common Issues ❌

**Black Screen**
- **Cause**: WebGL not supported or textures not loaded
- **Solution**: Check browser console for errors, ensure WebGL is enabled

**Player Falls Through Floor**
- **Cause**: Physics not initialized before player spawns
- **Solution**: This shouldn't happen with current setup, but if it does, refresh page

**Camera Inside Geometry**
- **Cause**: Player spawn position too low
- **Solution**: Verify RunnerVehicle position is [0, -4.5, 5]

### 3. Test Player Controls

Once the player has landed:

1. **Click on canvas** to enable pointer lock
2. **Move mouse** to look around
   - Should have smooth first-person camera control
   - Pitch limited to prevent over-rotation

3. **Test Movement**:
   - `W` - Move forward (down the track)
   - `S` - Move backward (up the track)
   - `A` - Strafe left
   - `D` - Strafe right
   - `Space` - Jump
   - `ESC` - Release pointer lock

#### Expected Movement Behavior
- [ ] Player moves in direction of camera view
- [ ] Player can jump and land back on surface
- [ ] Movement is smooth and responsive
- [ ] Player stays within canyon bounds (can't walk through walls)

### 4. Performance Testing

#### Frame Rate
- **Target**: 60 FPS
- **Minimum**: 30 FPS

**Check FPS**:
```javascript
// Open browser console and run:
setInterval(() => {
  console.log('FPS:', Math.round(1000 / performance.now()));
}, 1000);
```

#### Memory Usage
- Monitor browser task manager
- Look for memory leaks (continuously growing memory)
- Expected: Stable memory usage after initial load (~150-300MB)

### 5. Visual Quality Testing

#### Textures
- [ ] Rock textures visible on canyon walls
- [ ] Normal maps providing surface detail
- [ ] Ambient occlusion adding depth
- [ ] Roughness variation visible

#### Water
- [ ] Blue water plane visible in canyon bottom
- [ ] Water has transparency/opacity
- [ ] Water reflects light (metalness)

#### Lighting
- [ ] Directional light casting shadows
- [ ] Ambient light providing base illumination
- [ ] Sky providing environmental light

## Automated Testing

### Unit Tests
```bash
CI=true pnpm test --watchAll=false
```

176 tests across 17 suites (components, systems, rendering, validators). See **2026-06 Live Test Gate** below for the full verification matrix.

### Visual Regression Testing

Using the provided `verification/verify_player.py` script:

```bash
# Install dependencies
pip install playwright
playwright install chromium

# Run verification
python verification/verify_player.py
```

This will:
1. Launch headless browser
2. Navigate to localhost:3000
3. Wait for scene to render
4. Take screenshot
5. Save to `verification/player_view.png`

**Note**: Headless browsers have limited WebGL support and may show black screen. This doesn't indicate a problem with the actual application.

## Debugging Tips

### Enable Debug Overlays

Add these components to `Experience.tsx` for debugging:

```jsx
// Show axes helper
<axesHelper args={[10]} />

// Show grid helper
<gridHelper args={[100, 100]} />

// Show player position box
<mesh position={[0, 18, -10]}>
  <boxGeometry args={[1, 1, 1]} />
  <meshBasicMaterial color="red" wireframe />
</mesh>
```

### Console Logging

Add position logging to RunnerVehicle:

```javascript
useFrame(() => {
  if (!rb.current) return;
  const pos = rb.current.translation();
  
  // Log every 60 frames (every ~1 second at 60fps)
  if (Math.random() < 0.016) {
    console.log('Player position:', pos);
  }
  
  // ... rest of useFrame code
});
```

### Physics Debug View

Rapier supports physics debug rendering. Add to Experience.tsx:

```jsx
<Physics debug>
  {/* ... existing content */}
</Physics>
```

This will show wireframe overlays of all physics colliders.

## Browser Compatibility

### Supported Browsers
- ✅ Chrome 90+ (recommended)
- ✅ Firefox 88+
- ✅ Safari 15+
- ✅ Edge 90+

### Required Features
- WebGL 2.0
- Pointer Lock API
- ES6+ JavaScript
- WebAssembly (for Rapier physics)

### Check Browser Support
```javascript
// WebGL
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl2');
console.log('WebGL 2.0:', gl ? 'Supported' : 'Not supported');

// Pointer Lock
console.log('Pointer Lock:', 'pointerLockElement' in document ? 'Supported' : 'Not supported');

// WebAssembly
console.log('WebAssembly:', typeof WebAssembly !== 'undefined' ? 'Supported' : 'Not supported');
```

## Performance Benchmarks

### Target Metrics
- **FPS**: 60 (locked to refresh rate)
- **Frame Time**: <16.67ms
- **Memory**: <300MB
- **Load Time**: <3 seconds (with caching)

### Profiling

#### Chrome DevTools
1. Open DevTools (F12)
2. Go to Performance tab
3. Click Record
4. Interact with game for 10 seconds
5. Stop recording
6. Analyze flame chart for bottlenecks

#### React DevTools
1. Install React DevTools extension
2. Open Components tab
3. Enable "Highlight updates"
4. Look for unnecessary re-renders

## 2026-06 Live Test Gate — “Game Up and Testable”

**Gate date:** 2026-06-15  
**Map:** `meander_to_waterfall` (glacier prelude `startIndex=-3` → segment 38 `journeyComplete`)  
**Verdict:** **Conditional pass** — safe to hand to a human tester on real Chrome + GPU. Full authored traversal, visuals, and journey-complete loop still require manual sign-off (see blockers below).

> ⚠️ **Superseded by the 2026-06-18 re-test below — see blocker F-8.** A scripted re-run on
> `HEAD = 3c66ead` found an intermittent cold-boot corruption that the 2026-06-15 pass did not
> catch (the committed `capture_report.json` was a stale healthy boot). Do **not** treat the
> 2026-06-15 verdict as current.

### 2026-06-18 live re-test (regression found — gate is RED)

**Tester:** scripted (`verification/diag_trials.mjs`, headless Chrome + SwiftShader, `?renderer=webgl&screenshot=1`).
**Verdict:** **FAIL / blocked.** The game boots and renders, the menu and Start work, WebGL2 is
verified, and *when it boots clean* the glacier prelude is stable (seg `-3`, finite Y ≈ −12). But
**~43% of cold boots corrupt within seconds** — independent of player input.

**Measured corruption rate (initial session):** 6 / 14 cold boots CORRUPT (3/6 with `W` held, 3/8 with no input).

**Headless measurement caveat (2026-06-18 re-baseline):** Corruption rate under headless Chrome +
SwiftShader is **load-sensitive**, not a stable signal. On a fresh server with clean code, rates
climbed **40% → 80% → 100%** across a single investigation session as concurrent SwiftShader Chrome
instances accumulated. Each instance is pure-CPU rendering, which starves Rapier physics-worker init
relative to segment generation and loses the startup race far more often than real GPU hardware would.
**Do not use headless corruption % as the sole fix-validation gate** — confirm on real Chrome + GPU.

| Symptom | Evidence |
|---------|----------|
| Rigid-body position blows up | `y = 7.0e+34`, `6.25e+26`, `1.78e+26`, or `null` within ~8 s of start |
| Runaway segment generation | `currentSegmentIndex` jumps to 29 / 38 / 47 (should cap ~7 active) |
| React render storm | `webgl_screenshots.mjs` then throws **"Maximum update depth exceeded"** (setSpawnPoint loop via `Experience.tsx` `handleSegmentSpawn` → `ChunkManager` → `TrackManager`) |
| Healthy boots | seg stays `-3`, Y ≈ −12, no errors — confirms it is a **race**, not a hard break |

**Reproduce:**

```bash
pnpm dev
TRIALS=8 node verification/diag_trials.mjs          # coarse healthy/corrupt tally
TRIALS=10 node verification/diag_classify.mjs         # classify failure modes (see below)
NOKEY=1 TRIALS=8 node verification/diag_trials.mjs   # no input — still corrupts pre-fix
node verification/webgl_screenshots.mjs              # corrupt boot → Maximum update depth
```

**Classify failure modes** (`verification/diag_classify.mjs`):

| Mode | Meaning |
|------|---------|
| `HEALTHY` | Start registered, finite Y within ±100, seg at prelude |
| `REAL_blowup` | Start registered, position populated, but Y huge/NaN/null or seg runaway — real F-8 |
| `FLAKE_menu_still_up` | Start click did not dismiss menu — harness timing flake |
| `init_no_physics_step` | Menu gone but `__watershedPhysicsDebug.position` never populated — init stall |

Run serially (one trial at a time) for the least noisy headless signal. Kill stray Chrome after a
session: `pkill -f 'google-chrome.*swiftshader'`.

**Root cause (analysis):** A non-finite force reaches the Rapier body during the
first physics frames. `RunnerPhysicsStep.updateRunnerPhysics` applies the unconditional per-frame
`flow` impulse (line ~397) and the camera-relative `forwardDir` impulses (line ~404) **before** the
NaN guard at line ~529. The 3c66ead guards only sanitise `camera.position` (and only when the body
is *already* finite) — they do **not** sanitise (a) the camera **orientation** that feeds
`camera.getWorldDirection(forwardDir)`, nor (b) the `flowMultiplier` / slope state feeding the
input-independent flow impulse. Once the body translation is NaN, the guard's `isFinite(pos)` check
is false forever, so it can never recover; segment generation then keeps firing `segment-spawn` →
`setSpawnPoint`, producing the render storm. Suggested fix: clamp every impulse to finite **at the
`applyImpulse` boundary** (skip the frame's forces when `dt`, `flowMultiplier`, or the direction
vectors are non-finite), and bail out of the whole step until the body, camera matrix, and terrain
are warm. Needs confirmation on real Chrome + GPU — the path is CPU-physics (deterministic WASM), so
it is likely not headless-only, but the boot timing window may differ on hardware.

**Fix applied (2026-06-18):** `RunnerPhysicsStep.ts` now (a) resets the camera to spawn when
`matrixWorld` is non-finite, (b) gates **all** `applyImpulse` / `setLinvel` calls behind a
`physicsWarm` check (`dt`, body pos/vel, camera matrix, terrain ground-ray hit, and sane
position/velocity all required), (c) drops non-finite impulses at the boundary, (d) uses a safe
horizontal forward vector `(0,0,-1)` when the camera is not warm, (e) clamps non-finite
`flowMultiplier` to `1.0`, (f) **holds the body kinematic at `PLAYER_SPAWN`** until the first
successful ground raycast, then restores dynamic simulation, (g) snaps back to spawn when position
or speed leaves sane bounds. `TrackManager.tsx` also skips treadmill generation when the camera
transform is non-finite or out of range. Headless re-test after fix is advisory only (see load
caveat above).

**Post-fix headless spot-check (2026-06-18, serial runs, no concurrent Chrome):** `diag_classify.mjs`
6/6 `HEALTHY`; `diag_trials.mjs` (`NOKEY=1`) 6/6 `HEALTHY`, seg `−3`, finite Y ≈ −8…−66. Confirms
the kinematic bootstrap + impulse gate stops the blowup on this VM, but does **not** clear the gate
without real-GPU confirmation.

**What still works (re-confirmed 2026-06-18):** Vite dev server + build deps install; canvas mounts;
Start menu + Start button; WebGL2 context; `__watershedScreenshot` teleport API; HUD; and clean
boots play the glacier prelude without fall-through. The blocker is purely the startup race.

#### Polish nits audit (2026-06-18) — clean-test smoothness pass

Investigated the "quick wins / screenshot-friendly" list. Most were **already implemented**; the
audit confirmed them and surfaced two minor follow-ups. None block the live test independently of F-8.

| Nit | Status | Evidence |
|-----|--------|----------|
| Hide debug overlays for clean runs / screenshots | **Done already** | `?cleanTest=1` / `?clean-test=true` / `?screenshot=1` set clean mode (`utils/cleanTestMode.ts`). `App.tsx` gates `DebugPanel` on `!cleanTest`, disables the **G**/**F** toggles, and offers an in-panel **"Enable clean test"** button + a **"Show debug"** toggle-back. `Experience.tsx` also gates `ForecastHUD` + `AudioDiagnosticsOverlay` on `!cleanTest`. The CLAUDE.md "green debug overlay" no longer exists in `App.tsx`. |
| FlowingWater / `onBeforeCompile` shader-fallback spam | **No spam** | Runtime console capture during a clean boot (`verification/diag_console.mjs`) shows **zero** FlowingWater/shader warnings in normal play. Both fallback warnings use module-level once-guards (`warnedInvalidWaterShader`, `warnedWaterShaderCompile`) and live in `useMemo`, not `useFrame`. |
| 404s for optional sounds stay non-fatal | **Non-fatal** | The "missing" SFX (`jump`, `land_soft`, `footstep_rock`, `collide_rock`) actually **exist** in `public/sounds/` and serve 200 via curl; the in-browser 404s are a dev-server early-init timing artifact (THREE.AudioLoader firing during boot), not missing assets. `AudioManager.loadSound` warns once per name, marks `failedSounds`, returns `null` — graceful, no gameplay block. Revises **F-5** (assets are present). |
| `PLAYER_SPAWN` too high / bad initial penetration | **Already tuned** | `PLAYER_SPAWN.position = [0, -6, -10]` (constants/game.ts) with a comment noting it was lowered to reduce drop. Healthy boots settle smoothly to Y ≈ −12 with no penetration. Left unchanged — spawn-time penetration is more likely a facet of F-8 (the startup NaN race), which is the separate fix track. |
| Journey reset not stuck in end-of-map (audio/weather/biome) | **Code-correct; e2e unverifiable headless** | `resetDefaultMapRun` (`Experience.tsx`) resets biome (`snapBiomeContext` + store `resetGameState`), forecast, score, and **remounts** `<TrackManager key={defaultMapRunKey}>` (resets segment audio + journey detection). **ReactiveAudio/WeatherSystem are only mounted inside `ReachManager` (reach levels), not on the default map**, so they cannot get stuck on the first map; default-map weather is always `fallbackWeather: 'clear'`. End-to-end reset *from delta* couldn't be confirmed headlessly because teleport-to-38 does not raise the Journey Complete overlay or the biome transition in this build (harness limitation, see F-2/F-9) — needs a real-hardware traversal. |

**New minor follow-ups from this audit:**

| ID | Severity | Issue | Notes |
|----|----------|-------|-------|
| F-9 | **Fixed** | `teleportToSegment(38)` does **not** raise Journey Complete or apply the delta biome (overlay absent, HUD stays `CANYON SUMMER`). Root cause was **not** a config-plumbing gap in `MapSystem.ts` — `DefaultMapManager.getChunkConfig()` correctly spreads `journeyComplete: true` from `meander_to_waterfall.ts`. The real cause was an init race: `ChunkManager.synthesizeSegmentEnter()` silently no-ops when `!this.initialized`, and `ChunkManager` is constructed inside a `rockMaterial`-gated `useEffect` in `TrackManager.tsx`. If the screenshot teleport fired before that gate cleared, the entire replay loop (flow, biome, audio, journey-complete) was dropped. Fix: `TrackManager.tsx` now queues `synthesizeSegmentEnter` calls that arrive before initialization and flushes them in order once `ChunkManager.initializePool()` completes. | Repro: `verification/diag_reset.mjs`. |
| F-10 | **Fixed** | HUD shows `CANYON SUMMER` during the glacier prelude (seg −3…−1) and the slot-canyon section instead of distinct labels. Root cause: earlier `BIOME_ID_MAP` collapsed both `slotCanyon` and `glacier`. Fix: distinct palette entries + no collapse. **2026-07 follow-up:** dual track/palette vocabularies unified onto canonical `BiomeId` (`src/configs/biomes.ts`); `normalizeBiomeId` is map-load-only; `glacier` stays distinct from `glacialMelt`. | Screenshot-only cosmetic. |

### Quick commands

```bash
pnpm install
pnpm dev                    # http://localhost:3000
CI=true pnpm test --watchAll=false
pnpm build
node verification/webgl_screenshots.mjs   # headless WebGL captures (CI parity)
```

Use **`?renderer=webgl`** for the supported test path. Add **`?cleanTest=1`** (or use **`?screenshot=1`**, which enables clean mode automatically) to hide the debug panel, Flow Forecast HUD, audio diagnostics, wireframe overlay (G), and physics debug (F) for polished screenshots and live test runs.

### Manual tester script (real Chrome, decent GPU)

1. `pnpm dev` (or `npm start`).
2. Open `http://localhost:3000` — also spot-check `?renderer=webgl`.
3. Click **Start Run** (or `?no-pointer-lock=1` for top-down debug camera only).
4. Engage controls: WASD / right-click forward, mouse look, Space jump, **R** restart prompt, **Esc** pause.
5. Play through the authored sequence:
   - Glacier prelude (segments **-3…-1** via `GLACIER_START_INDEX`)
   - Meander **0–13**, approach, waterfall **14** (camera shake + particles)
   - Splash **15** + biome shift to autumn + pond **16–18**
   - Rapids / slot **19–22** (narrow, high rocks)
   - Later falls **28–29**, delta approach, **journey complete at 38**
6. On **Journey Complete**: press **Enter** (or click) → should loop/teleport to glacier prelude and remount the track treadmill.
7. Capture screenshots at representative points; store under `verification/` (examples: `firstmap-waterfall-webgl.png`, `firstmap-splash-webgl.png`).

#### Success criteria

| Check | Expected |
|-------|----------|
| Boot | No uncaught exceptions; no ErrorBoundary crash |
| Physics | Player does not fall through geometry for a full run |
| Systems | Biome transitions, water flow, camera shake (seg 14), LOD tier changes |
| Ending | Journey Complete overlay at segment 38 |
| Loop | Enter/click restart → fresh run from glacier prelude (`seg ≈ -3`) |
| WebGL visuals | Canyon/water readable — not black or sky-only |
| FPS | Playable (>25–30 FPS) after initial load dip |
| Pause / wipeout | Esc pauses; fall-off-track shows WIPEOUT + respawn |

Also exercise: pause/resume, respawn on wipeout, runner vehicle feel (default).

### Automated verification run (2026-06-15)

| Check | Result | Notes |
|-------|--------|-------|
| `CI=true pnpm test --watchAll=false` | **176/176 pass** | 17 suites |
| `pnpm build` | **Pass** | WASM skipped without Emscripten (expected) |
| WebGL boot `?renderer=webgl` | **Pass** | Canvas mounts, no ErrorBoundary, WebGL2 context |
| WebGPU boot `?renderer=webgpu` | **Boot OK** | Menu renders; GPU-dependent path needs real hardware |
| TrackSegment refactor crash | **Fixed** | No `isSlotCanyon is not defined` on load |
| Glacier spawn | **Pass** | `currentSegmentIndex = -3`, finite Y (~-8 to -10) |
| HUD / score / biome label | **Pass** | Speed, CANYON SUMMER, score increment |
| Wipeout overlay | **Pass** | Store + WIPEOUT DOM when `setIsWipeout(true)` |
| Journey restart plumbing | **Pass** | `setJourneyComplete()` → Enter resets store (`isJourneyComplete=false`, `seg=-3`) |
| Headless WebGL screenshots | **0/7 “good” frames** | SwiftShader renders sky-only (~4 KB PNGs); not a visual gate |
| Full map traversal (automated) | **Not verified** | Mocked pointer lock + W key ≈ zero speed; needs human |
| Journey Complete via gameplay | **Not verified** | Teleport harness does not fire `ChunkManager.onSegmentEnter` |
| Pause (Esc) in headless | **Not detected** | Likely needs real pointer-lock lifecycle |

**Screenshots captured:** `verification/firstmap-*.png` and `verification/webgl/capture_report.json`.

Representative captures with usable canyon content (from longer top-down / timed runs):

- `verification/firstmap-waterfall-webgl.png` (~153 KB)
- `verification/firstmap-splash-webgl.png` (~149 KB)

Most recent first-person SwiftShader captures (`firstmap-glacier-webgl.png`, etc.) are **sky-only** and must not be used as the visual gate.

### Known blockers / follow-ups

| ID | Severity | Issue | Status / fix |
|----|----------|-------|--------------|
| F-1 | **Gate** | Headless WebGL screenshots are sky-only; automated script previously exited 1 on “good frames” | **Accepted limitation.** `webgl_screenshots.mjs` is now telemetry-only (fails only on runtime page errors / missing WebGL); use manual/top-down GPU screenshots for the visual gate. |
| F-2 | **Gate** | Journey Complete not triggerable via `__watershedScreenshot.teleportToSegment(38)` | **Fixed.** `teleportToSegment` replays `segment-enter` for every skipped index via `TrackManager`/`ChunkManager`, so flow/biome/audio state warms incrementally. |
| F-3 | Medium | `firstElem.toArray is not a function` when teleporting far downstream | **Fixed.** `WaterFlowForces`/`WaterForces` coerce plain-object samples to real `THREE.Vector3` before calling `toArray()`; `RunnerPhysicsStep` resets a malformed camera before lerping. |
| F-4 | Medium | `linearRampToValueAtTime` non-finite AudioParam | **Fixed.** `ReactiveAudio`, `useSegmentAudio`, and `useCameraShake` now guard non-finite camera/flow/speed values before they reach the `AudioListener` matrix or Web Audio ramps. |
| F-5 | Low → Info | ~~Missing SFX buffers: `jump`, `land_soft`, `step_rock`, `collide_rock`~~ | **Re-checked 2026-06-18: assets exist in `public/sounds/` and serve 200.** In-browser 404s are a dev-init timing artifact and are handled gracefully (warn-once, `failedSounds`, non-fatal). Not a real missing-asset bug. |
| F-6 | Low | Automated W-key movement ~0 m/s with mocked pointer lock | Use real pointer lock for traversal tests; or expose a debug “autopilot” for CI |
| F-7 | Info | WebGPU default errors under SwiftShader (`lightNodeClass`) | Document `?renderer=webgl` for CI; WebGPU OK on real Chrome 120+ |
| F-8 | **Gate (RED)** | **Intermittent cold-boot corruption: rigid-body Y → NaN/huge/null within seconds, runaway segment generation, then React "Maximum update depth exceeded". Input-independent.** | **Fix landed 2026-06-18** (impulse/camera warmup guards in `RunnerPhysicsStep.ts`). **Gate stays RED until confirmed on real Chrome + GPU** — headless SwiftShader rate is load-noisy (40–100%). Repro/classify: `verification/diag_trials.mjs`, `verification/diag_classify.mjs`. |

### 2026-06-24 execution log (automated + doc)

**Executor:** Cursor agent (CI VM, headless Chrome + SwiftShader advisory).

| Check | Result | Notes |
|-------|--------|-------|
| `CI=true pnpm test --watchAll=false` | **182/182 pass** | 19 suites, post set-piece plumbing |
| `pnpm build` | **Pass** | WASM skipped without Emscripten (expected) |
| `SYSTEMS.md` contract cards | **Done** | `WaterReflection.jsx`, SplashSystem (consolidated water-contact VFX; WaterInteraction removed) |
| Set-piece plumbing (seg 14/22) | **Implemented** | `decorations` wired MapSystem → ChunkManager → TrackSegment; `rockType` override; authored in `meander_to_waterfall.ts` |
| `diag_trials.mjs` (6 trials) | **Partial** | Trial 1 HEALTHY (seg −3, Y ≈ −5.2); trial 2 Chrome protocol timeout — headless load-sensitive per 2026-06-18 caveat |
| `diag_reset.mjs` | *(see run below)* | Journey-complete restart plumbing |
| Human GPU traversal | **Pending** | Required to flip gate GREEN |

**Recommended human URL:** `http://localhost:3000/?renderer=webgl&cleanTest=1`

**Verdict:** **Still RED** for F-8 until real Chrome + GPU sign-off. Code/doc/set-piece tracks landed; human checklist below remains open.

### Sign-off checklist (human tester)

Copy into PR / release notes when complete:

- [ ] WebGL path: full run glacier → segment 38 without fall-through
- [ ] Waterfall 14: shake + particles observed
- [ ] Segment 15: autumn biome transition
- [ ] Slot canyon 19–22: narrow walls, high rock density
- [ ] Journey Complete overlay at 38
- [ ] Enter restart → fresh glacier prelude
- [ ] Esc pause / resume works
- [ ] Wipeout + respawn works
- [ ] FPS ≥ 30 on target hardware after LOD settles
- [ ] Screenshots attached (`verification/firstmap-*.png`)

---

## Regression Testing Checklist

Before merging any changes, verify:

- [ ] Player spawns correctly (not in geometry)
- [ ] Player can move and jump
- [ ] Camera controls work (mouse look + pointer lock)
- [ ] Physics responds correctly (collisions, gravity)
- [ ] Textures load and display
- [ ] Performance is acceptable (30+ FPS)
- [ ] No console errors
- [ ] No memory leaks
- [ ] Works in multiple browsers

## Reporting Issues

When reporting bugs, include:

1. **Browser & Version**: e.g., "Chrome 120.0.6099.109"
2. **Operating System**: e.g., "Windows 11", "macOS 14.0"
3. **Steps to Reproduce**: Clear, numbered steps
4. **Expected Behavior**: What should happen
5. **Actual Behavior**: What actually happens
6. **Screenshots**: If visual issue
7. **Console Errors**: Copy/paste any errors from browser console
8. **Performance**: FPS if performance-related

### Example Bug Report

```markdown
**Bug**: Player falls through floor

**Browser**: Chrome 120.0.6099.109
**OS**: Windows 11

**Steps**:
1. Load application at localhost:3000
2. Wait for player to spawn and fall
3. Player passes through riverbed geometry

**Expected**: Player lands on surface at Y≈1-2
**Actual**: Player falls infinitely (Y becomes large negative number)

**Console Errors**:
```
Warning: Physics not initialized
```

**Screenshot**: [attached]
```

## Next Steps

After verifying the current fix works:

1. Implement respawn system (when player falls off track)
2. Add checkpoint system for progress saving
3. Create debug camera mode (toggle with 'C' key)
4. Add performance monitoring overlay
5. Implement unit tests for critical functions
