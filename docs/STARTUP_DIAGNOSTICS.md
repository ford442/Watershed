# Watershed Startup Diagnostics and Solutions

## Issue Summary
The game loads successfully but displays a blank/white 3D scene due to **WebGL shader compilation errors**.

## Root Cause Analysis

### Confirmed Issues from Browser Console

```
THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN
THREE.THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false  
WebGL: INVALID_OPERATION: useProgram: program not valid
```

### Primary Issue: Shader Validation Failures

The custom shader modifications in two files are failing to compile:

1. **src/utils/RiverShader.js** - Material extension for wetness/moss/caustics
2. **src/components/FlowingWater.jsx** - Water surface shader

### Secondary Issue: Geometry Creation with Invalid Values

When path generation fails or returns invalid values, the geometry creation in `TrackSegment.jsx` can produce NaN values in buffer attributes, causing the "Computed radius is NaN" error.

## Detailed Findings

### 1. App Initialization Status
✅ **Working:**
- React app mounts successfully
- Canvas creates with WebGL2  
- Assets load (textures at 100%)
- UI overlay displays correctly
- Physics engine initializes
- Error boundaries in place

❌ **Failing:**
- Shader compilation
- 3D scene rendering (blank screen behind UI)
- Material creation for terrain

### 2. Component Status

| Component | Status | Notes |
|-----------|--------|-------|
| index.tsx | ✅ Working | Entry point loads |
| App.tsx | ✅ Working | Canvas setup complete |
| Experience.jsx | ✅ Working | Scene composition OK |
| Player.jsx | ✅ Working | Physics initialized |
| TrackManager.jsx | ✅ Working | Textures load successfully |
| TrackSegment.jsx | ⚠️ Partial | Geometry creates but shaders fail |
| RiverShader.js | ❌ Failing | Shader validation error |
| FlowingWater.jsx | ❌ Failing | Shader validation error |

### 3. Console Log Analysis

**Successful Steps:**
```
[index.tsx] Starting application...
[App] WebGL context test: SUCCESS
[Canvas] Created successfully
[Canvas] Renderer: WebGLRenderer
[Canvas] WebGL Version: WebGL2
[TrackManager] Textures loaded: {colorMap: true, normalMap: true, ...}
[TrackSegment 0] Rendering - active: true, has rockMaterial: true
```

**Failure Point:**
```
THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN
THREE.THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false
WebGL: INVALID_OPERATION: useProgram: program not valid (repeated 50+ times)
```

## Potential Root Causes

### A. Shader Syntax Issues
The shader injection code uses string replacement to modify GLSL. Potential issues:
- **Missing semicolons or brackets** in injected code
- **Variable name conflicts** between injected and existing shader variables
- **Include order issues** - replacing includes in wrong order
- **Precision qualifiers** missing for some variables
- **Incompatibility with Three.js shader chunks** in newer versions

### B. Geometry/Buffer Issues
- `pathLength` could be 0 or NaN if curve points are invalid
- `Math.floor(pathLength)` on line 674 could result in 0 segments
- Buffer attribute calculations might produce NaN if divisions by zero occur

### C. Material Initialization Timing
- Material `onBeforeCompile` might be called before uniforms are ready
- Race condition between texture loading and material creation

## Recommended Fixes

### Priority 1: Add Defensive Checks to Geometry Creation

**File: src/components/TrackSegment.jsx**

```javascript
// Canyon Geometry - Add validation
const canyonGeometry = useMemo(() => {
    if (!active || !segmentPath) return null;
    
    // DEFENSIVE CHECK: Ensure valid path length
    const len = segmentPath.getLength();
    if (!len || len <= 0 || !isFinite(len)) {
        console.warn(`[TrackSegment ${segmentId}] Invalid pathLength: ${len}`);
        return null;
    }

    const segmentsX = 40;
    const segmentsZ = Math.max(2, Math.floor(len)); // At least 2 segments

    // ... rest of geometry creation
}, [segmentPath, pathLength, canyonWidth, waterWidth, active, segmentId]);
```

### Priority 2: Add Try-Catch to Shader Compilation

**File: src/components/FlowingWater.jsx**

```javascript
mat.onBeforeCompile = (shader) => {
    try {
        shader.uniforms.time = { value: 0 };
        // ... all shader modifications

        mat.userData.shader = shader;
    } catch (error) {
        console.error('[FlowingWater] Shader compilation error:', error);
        console.error('Shader vertex:', shader.vertexShader?.substring(0, 500));
        console.error('Shader fragment:', shader.fragmentShader?.substring(0, 500));
    }
};
```

### Priority 3: Validate Shader Injection Points

Check that all `shader.vertexShader.replace()` and `shader.fragmentShader.replace()` calls actually find their targets:

```javascript
const replaced = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `/* injection here */`
);

if (replaced === shader.fragmentShader) {
    console.warn('[Shader] Failed to find #include <map_fragment>');
}
shader.fragmentShader = replaced;
```

### Priority 4: Add Precision Qualifiers

GLSL ES requires precision qualifiers. Add to fragment shader injections:

```glsl
#ifdef GL_ES
precision mediump float;
#endif
```

## Testing Checklist

After applying fixes:

- [ ] Build completes without errors
- [ ] Dev server starts without warnings
- [ ] Browser console shows no shader errors
- [ ] 3D scene renders (not blank)
- [ ] Player spawns in correct position
- [ ] Track segments generate
- [ ] Water surface displays
- [ ] Materials apply correctly
- [ ] FPS remains above 30

## Prevention Strategies

### 1. Shader Development
- Always wrap `onBeforeCompile` in try-catch
- Log shader source on compilation failure
- Test shaders in isolation before integrating
- Use shader linting tools

### 2. Geometry Creation
- Validate all input parameters before BufferGeometry creation
- Check for NaN/Infinity in position arrays
- Ensure segment counts are >= 1
- Add logging for geometry dimensions

### 3. Error Handling
- Keep ErrorBoundary in place
- Add specific error states for shader failures
- Display helpful error messages to user
- Implement fallback materials for failed shaders

### 4. Development Workflow
- Test in multiple browsers (Chrome, Firefox, Safari)
- Check WebGL1 and WebGL2 compatibility
- Monitor console for warnings
- Use React DevTools to check component state

## Quick Diagnostic Commands

```bash
# Start dev server
npm start

# Build and check for errors
npm run build

# Run visual regression test
python3 verify_visuals_playwright.py

# Check for shader syntax
grep -n "onBeforeCompile" src/**/*.{js,jsx}
```

## Known Working Configuration

- **React**: 19.2.4
- **Three.js**: 0.182.0
- **React Three Fiber**: 9.4.0
- **Rapier Physics**: 0.19.3
- **Vite**: 7.3.1
- **Node**: 24.13.0

## Additional Notes

The application architecture is sound - all components exist, imports are valid, and the overall structure is correct. The issue is purely a runtime shader compilation failure that prevents rendering. Once the shader issues are resolved, the game should run normally.

The UI, loading system, error boundaries, and control systems all work correctly. The problem is isolated to the 3D rendering layer.

---

**Created**: 2026-02-09  
**Status**: Diagnostic Complete - Awaiting Fix Implementation
