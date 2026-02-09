# Watershed Code Health Guide
## Best Practices for Maintaining Startup Reliability

This guide provides recommendations to prevent the startup and rendering issues identified in the codebase.

---

## 🎯 Golden Rules

### 1. **Always Validate Shader Compilation**
Every shader modification MUST be wrapped in try-catch:

```javascript
// ✅ GOOD
material.onBeforeCompile = (shader) => {
    try {
        // Shader modifications here
        material.userData.shader = shader;
    } catch (error) {
        console.error('[ComponentName] Shader error:', error);
    }
};

// ❌ BAD
material.onBeforeCompile = (shader) => {
    // Modifications without error handling
};
```

### 2. **Validate Geometry Inputs**
Never create geometry with invalid dimensions:

```javascript
// ✅ GOOD
const canyonGeometry = useMemo(() => {
    if (!active || !segmentPath) return null;
    
    const pathLen = segmentPath.getLength();
    if (!pathLen || pathLen <= 0 || !isFinite(pathLen)) {
        console.warn('Invalid path length:', pathLen);
        return null;
    }
    
    const segmentsZ = Math.max(2, Math.floor(pathLen));
    // ... create geometry
}, [dependencies]);

// ❌ BAD  
const segmentsZ = Math.floor(pathLength); // Could be 0 or NaN
```

### 3. **Log Component State**
Every major component should log its initialization:

```javascript
console.log(`[ComponentName] Rendering - active: ${active}, data: ${!!data}`);
```

---

## 📋 Pre-Commit Checklist

Before committing changes, verify:

- [ ] No console.error messages in browser
- [ ] No WebGL warnings about invalid operations
- [ ] Canvas renders (not blank)
- [ ] `npm run build` succeeds
- [ ] Dev server starts without warnings
- [ ] All shaders compile successfully

---

## 🛡️ Defensive Coding Patterns

### Pattern 1: Null-Safe Material Creation

```javascript
const material = useMemo(() => {
    if (!texture1 || !texture2) {
        console.warn('[Component] Waiting for textures...');
        return null;
    }
    
    const mat = new THREE.MeshStandardMaterial({
        map: texture1,
        normalMap: texture2
    });
    
    // Only add shader if material created successfully
    if (mat) {
        mat.onBeforeCompile = (shader) => {
            try {
                // Safe modifications
            } catch (e) {
                console.error('Shader failed:', e);
            }
        };
    }
    
    return mat;
}, [texture1, texture2]);
```

### Pattern 2: Safe Buffer Attribute Access

```javascript
const positions = geometry.attributes.position;

// ✅ Validate before iterating
if (!positions || !positions.count) {
    console.error('Invalid position attribute');
    return null;
}

for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    
    // Validate values
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
        console.warn(`Invalid vertex at index ${i}:`, {x, y, z});
        continue;
    }
    
    // Safe to use values
}
```

### Pattern 3: Staged Rendering

Don't render until all dependencies are ready:

```javascript
const Component = ({ data, material, geometry }) => {
    // Check all requirements
    if (!data || !material || !geometry) {
        console.log('[Component] Not ready:', {
            data: !!data,
            material: !!material,
            geometry: !!geometry
        });
        return null;
    }
    
    // Safe to render
    return (
        <mesh geometry={geometry} material={material}>
            {/* content */}
        </mesh>
    );
};
```

---

## 🔍 Common Issues and Solutions

### Issue 1: Blank Screen on Load

**Symptoms:**
- UI displays but no 3D scene
- Console shows WebGL errors
- "program not valid" warnings

**Solution:**
```javascript
// Check shader compilation in browser console
// Look for THREE.WebGLProgram: Shader Error messages

// Add debug logging to onBeforeCompile:
mat.onBeforeCompile = (shader) => {
    console.log('[Material] Compiling shader...');
    try {
        // modifications
        console.log('[Material] Shader compiled successfully');
    } catch (error) {
        console.error('[Material] Compilation failed:', error);
        // Log partial shader source
        console.log('Vertex shader start:', shader.vertexShader.substring(0, 200));
    }
};
```

### Issue 2: NaN in Buffer Geometry

**Symptoms:**
- "Computed radius is NaN" errors
- Objects don't render
- Physics collision issues

**Solution:**
```javascript
// Validate all calculations that affect geometry
const calculateHeight = (distance) => {
    const result = Math.pow(distance, 2.5) * 12;
    
    if (!isFinite(result)) {
        console.error('Invalid height calculation:', {distance, result});
        return 0; // Safe fallback
    }
    
    return result;
};

// Validate before setting positions
positions.setY(i, validateNumber(yHeight, 0));
```

### Issue 3: Shader Injection Fails

**Symptoms:**
- Original material renders instead of custom
- Uniforms not updating
- Visual effects missing

**Solution:**
```javascript
// Verify injection points exist
shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    (match) => {
        console.log('[Shader] Found injection point:', match);
        return `
            ${match}
            // Your custom code
        `;
    }
);

// Check if replacement occurred
if (!shader.fragmentShader.includes('Your custom code')) {
    console.warn('[Shader] Injection point not found!');
}
```

---

## 🧪 Testing Strategies

### Manual Testing Workflow

1. **Clean Start**
   ```bash
   rm -rf node_modules build
   npm install
   npm start
   ```

2. **Visual Inspection**
   - Open http://localhost:3000
   - Check console for errors (F12)
   - Verify 3D scene renders
   - Click to start game
   - Check player movement

3. **Build Test**
   ```bash
   npm run build
   python3 build_and_patch.py
   ```

4. **Visual Regression**
   ```bash
   python3 verify_visuals_playwright.py
   ```

### Automated Tests to Add

```javascript
// src/components/__tests__/MaterialCreation.test.tsx
describe('Material Creation', () => {
    it('should handle missing textures gracefully', () => {
        const material = createRockMaterial(null, null);
        expect(material).toBeNull();
    });
    
    it('should validate shader compilation', () => {
        const consoleSpy = jest.spyOn(console, 'error');
        const material = createBrokenShaderMaterial();
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Shader')
        );
    });
});
```

---

## 📊 Performance Monitoring

### Key Metrics to Track

```javascript
// Add to useFrame in Experience.jsx
useFrame((state) => {
    // Log FPS drops
    if (state.clock.elapsedTime > 5) { // After initial load
        const fps = 1 / state.clock.getDelta();
        if (fps < 30) {
            console.warn('[Performance] Low FPS:', fps.toFixed(1));
        }
    }
});
```

### Memory Monitoring

```javascript
// Check for memory leaks in long sessions
useEffect(() => {
    const interval = setInterval(() => {
        if (performance.memory) {
            const used = performance.memory.usedJSHeapSize / 1048576;
            const limit = performance.memory.jsHeapSizeLimit / 1048576;
            
            console.log(`[Memory] ${used.toFixed(0)}MB / ${limit.toFixed(0)}MB`);
            
            if (used > limit * 0.9) {
                console.error('[Memory] Approaching limit!');
            }
        }
    }, 30000); // Every 30 seconds
    
    return () => clearInterval(interval);
}, []);
```

---

## 🏗️ Architecture Best Practices

### Component Organization

```
src/
├── components/
│   ├── Player.jsx          # Physics & controls
│   ├── TrackManager.jsx    # Procedural generation orchestration
│   ├── TrackSegment.jsx    # Individual track piece
│   ├── FlowingWater.jsx    # Water shader
│   └── Environment/        # Decorations (21 components)
│       ├── Vegetation.jsx
│       └── ...
├── utils/
│   └── RiverShader.js      # Shared material extensions
└── systems/                # (Future: Complex logic)
```

### Dependency Flow

```
App.tsx
  └─ Experience.jsx
      ├─ EnhancedSky
      └─ Physics
          ├─ Player (requires nothing)
          └─ TrackManager
              └─ TrackSegment (requires textures from TrackManager)
                  ├─ FlowingWater (requires geometry from TrackSegment)
                  └─ Environment components
```

**Rule**: Never create circular dependencies. Always pass data down.

---

## 🚨 Red Flags

Watch for these patterns that indicate problems:

### 🚩 Shader Code Smells
```javascript
// BAD: No error handling
mat.onBeforeCompile = (shader) => { /* ... */ };

// BAD: Complex nested string replacement
shader.fragmentShader.replace().replace().replace();

// BAD: No validation of injection success
shader.vertexShader = shader.vertexShader.replace(...);
```

### 🚩 Geometry Code Smells
```javascript
// BAD: No validation
const segments = Math.floor(pathLength);

// BAD: Direct attribute manipulation without checks
positions.setXYZ(i, x, y, z);

// BAD: Assuming buffer exists
const positions = geo.attributes.position;
for (let i = 0; i < positions.count; i++) { /* ... */ }
```

### 🚩 Material Code Smells
```javascript
// BAD: Creating material without checking dependencies
const mat = new THREE.MeshStandardMaterial({
    map: texture // might be undefined
});

// BAD: Returning undefined from useMemo
const material = useMemo(() => {
    const mat = createMat();
    // forgot to return mat!
}, []);
```

---

## 📚 Reference Documentation

### Essential Three.js Docs
- [BufferGeometry](https://threejs.org/docs/#api/en/core/BufferGeometry)
- [Material onBeforeCompile](https://threejs.org/docs/#api/en/materials/Material.onBeforeCompile)
- [Shader Chunks](https://github.com/mrdoob/three.js/tree/dev/src/renderers/shaders/ShaderChunk)

### React Three Fiber
- [API Reference](https://docs.pmnd.rs/react-three-fiber/api/hooks)
- [Performance](https://docs.pmnd.rs/react-three-fiber/advanced/scaling-performance)

### Project-Specific
- [AGENTS.md](./AGENTS.md) - Project architecture overview
- [STARTUP_DIAGNOSTICS.md](./STARTUP_DIAGNOSTICS.md) - Current issues and fixes
- [TESTING.md](./TESTING.md) - Test procedures

---

## 🎓 Key Learnings

### 1. Shader Compilation is Fragile
Custom shaders can break with Three.js updates. Always:
- Wrap in try-catch
- Log compilation status
- Have fallback materials
- Test in multiple browsers

### 2. Geometry Requires Validation
Buffer geometries will crash if given NaN values. Always:
- Check input parameters
- Validate calculations
- Use safe defaults
- Log creation success/failure

### 3. Loading Order Matters
Materials need textures, geometries need valid paths. Always:
- Return null until dependencies ready
- Log readiness state
- Render in stages
- Show loading indicators

---

## 🔄 Update Procedures

### When Updating Three.js
1. Check shader compatibility
2. Test all materials
3. Verify buffer attribute API
4. Check shader chunk changes
5. Update error handling if needed

### When Adding New Effects
1. Start with basic material
2. Add shader incrementally
3. Test after each addition
4. Add error logging
5. Document expected behavior

### When Refactoring
1. Keep error handling intact
2. Maintain logging statements
3. Test in isolation first
4. Verify no regressions
5. Update documentation

---

**Remember**: A working game is better than a perfect game. Prioritize stability over features. When in doubt, log more, validate more, and handle errors gracefully.

---

*Last Updated: 2026-02-09*  
*Maintainer: Development Team*
