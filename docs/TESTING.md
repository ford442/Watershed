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
- **Solution**: Verify Player.jsx position is [0, -4.5, 5]

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

Add these components to `Experience.jsx` for debugging:

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

Add position logging to Player.jsx:

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

Rapier supports physics debug rendering. Add to Experience.jsx:

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

| ID | Severity | Issue | Suggested fix |
|----|----------|-------|---------------|
| F-1 | **Gate** | Headless WebGL screenshots are sky-only; automated script exits 1 on “good frames” | Treat `webgl_screenshots.mjs` as boot/segment telemetry only; manual GPU screenshots for visuals |
| F-2 | **Gate** | Journey Complete not triggerable via `__watershedScreenshot.teleportToSegment(38)` | Teleport moves rigid body only; `onSegmentEnter` must run — add `teleportToSegment` → synthetic segment-enter or manual traversal |
| F-3 | Medium | `firstElem.toArray is not a function` when teleporting far downstream | Flow/audio path assumes curve/array shape — guard in segment sampler or flow forces |
| F-4 | Medium | `linearRampToValueAtTime` non-finite AudioParam | Sanitize speed/flow inputs before Web Audio ramps |
| F-5 | Low | Missing SFX buffers: `jump`, `land_soft`, `step_rock`, `collide_rock` | Add assets or disable stems in dev |
| F-6 | Low | Automated W-key movement ~0 m/s with mocked pointer lock | Use real pointer lock for traversal tests; or expose a debug “autopilot” for CI |
| F-7 | Info | WebGPU default errors under SwiftShader (`lightNodeClass`) | Document `?renderer=webgl` for CI; WebGPU OK on real Chrome 120+ |

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
