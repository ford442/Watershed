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
   - You should see the canyon track extending forward

2. **Player Falling**: Within 1-2 seconds of loading
   - Player capsule should be visible falling from above
   - Falls from Y=18 to Y≈1 (lands on riverbed surface)
   - Fall takes approximately 1.9 seconds

3. **Player Landed**: After falling
   - Player should be standing on the track surface
   - Camera should be in first-person view
   - Position should be approximately [0, 1-2, -10]

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
- **Solution**: Verify Player.jsx position is [0, 18, -10]

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
npm test
```

Currently, no unit tests are implemented. Future tests should cover:
- Player spawn position validation
- Collision detection
- Movement controls
- Camera controls

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
