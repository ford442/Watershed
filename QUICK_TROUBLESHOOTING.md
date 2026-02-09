# Quick Troubleshooting Guide for Watershed

## 🚨 Emergency Fixes

### Blank Screen / No 3D View

**Quick Check:**
```bash
# Open browser console (F12) and look for:
THREE.WebGLProgram: Shader Error
WebGL: INVALID_OPERATION
Computed radius is NaN
```

**Quick Fix:**
```javascript
// In src/components/TrackSegment.jsx, line ~670
const canyonGeometry = useMemo(() => {
    if (!active || !segmentPath) return null;
    
    // ADD THIS CHECK:
    const len = segmentPath.getLength();
    if (!len || len <= 0 || !isFinite(len)) {
        console.warn(`Invalid path length: ${len}`);
        return null;
    }
    
    const segmentsZ = Math.max(2, Math.floor(len)); // Ensure >= 2
    // ... rest of code
}, [dependencies]);
```

### Shader Compilation Errors

**Quick Fix - Add Error Handling:**
```javascript
// In src/components/FlowingWater.jsx, line ~35
mat.onBeforeCompile = (shader) => {
    try {
        // existing shader code
        mat.userData.shader = shader;
    } catch (error) {
        console.error('[FlowingWater] Shader error:', error);
    }
};
```

---

## 📋 Diagnostic Commands

```bash
# 1. Clean install
rm -rf node_modules
npm install

# 2. Start dev server
npm start

# 3. Check build
npm run build

# 4. Visual test (requires Playwright)
python3 verify_visuals_playwright.py
```

---

## 🔍 What to Check First

### Browser Console (F12)

1. **Errors Tab** - Look for:
   - `THREE.WebGLProgram: Shader Error`
   - `WebGL: INVALID_OPERATION`
   - `Computed radius is NaN`

2. **Console Tab** - Check for:
   - `[Canvas] Created successfully` ✅
   - `[TrackManager] Textures loaded` ✅
   - `[TrackSegment] Rendering full segment` ✅

3. **Network Tab** - Verify:
   - All .jpg textures load (200 status)
   - rapier.wasm loads successfully
   - No 404 errors

### Visual Inspection

**What you should see:**
- Loading screen appears
- Progress bar reaches 100%
- "CLICK TO ENGAGE" button enabled
- 3D scene visible behind UI (canyon/water)

**What indicates a problem:**
- White/blank canvas area
- Loading stuck at 0%
- Console full of errors

---

## 🛠️ Common Fixes

### Issue: "Canvas Ready: NO"

**Cause:** Canvas failed to initialize  
**Fix:** Check WebGL support
```javascript
// Add to src/App.tsx
const canvas = document.createElement('canvas');
const gl = canvas.getContext('webgl2');
if (!gl) {
    alert('WebGL2 not supported. Please update your browser.');
}
```

### Issue: "Loading Active: YES" Forever

**Cause:** Textures not loading  
**Fix:** Check texture paths in public/
```bash
ls -la public/Rock031_1K-JPG_*.jpg
# Should show 4 files: Color, Normal, Roughness, AO
```

### Issue: Player Falls Through Floor

**Cause:** Physics not initialized or spawn position wrong  
**Fix:** Check src/components/Player.jsx line 135
```javascript
position={[0, -4, -10]}  // Should be above track (Y=-6)
```

---

## 📊 Status Indicators

### Debug Overlay (Top-Left Corner)

```
Canvas Ready: YES       ← WebGL initialized
Loading Active: NO      ← Assets finished loading
Progress: 100%          ← All textures loaded
Experience Error: None  ← No React errors
```

### Console Log Sequence (Successful Startup)

```
✅ [index.tsx] Starting application...
✅ [index.tsx] React version: 19.2.4
✅ [App] WebGL context test: SUCCESS
✅ [Experience] Rendering...
✅ [Canvas] Created successfully
✅ [TrackManager] Loading textures...
✅ [TrackManager] Textures loaded: {colorMap: true, ...}
✅ [TrackSegment 0] Rendering - active: true
✅ [TrackSegment 0] Rendering full segment
```

---

## 🎯 Known Working State

### Versions
- Node: 24.13.0
- React: 19.2.4
- Three.js: 0.182.0
- Vite: 7.3.1

### Files That Should Exist
```
public/
├── Rock031_1K-JPG_Color.jpg
├── Rock031_1K-JPG_NormalGL.jpg
├── Rock031_1K-JPG_Roughness.jpg
├── Rock031_1K-JPG_AmbientOcclusion.jpg
└── rapier.wasm

src/
├── index.tsx
├── App.tsx
├── Experience.jsx
├── components/
│   ├── Player.jsx
│   ├── TrackManager.jsx
│   ├── TrackSegment.jsx
│   ├── FlowingWater.jsx
│   ├── EnhancedSky.jsx
│   ├── UI.tsx
│   ├── Loader.tsx
│   └── ErrorBoundary.tsx
└── utils/
    └── RiverShader.js
```

---

## 🔗 Related Documentation

- **STARTUP_DIAGNOSTICS.md** - Detailed issue analysis
- **CODE_HEALTH_GUIDE.md** - Best practices and patterns
- **AGENTS.md** - Full project architecture
- **TESTING.md** - Test procedures

---

## 💡 Pro Tips

1. **Always check the browser console first**
2. **Shader errors are the most common issue**
3. **Test after every significant change**
4. **Keep logging statements in place**
5. **Document any new issues you find**

---

## 📞 When All Else Fails

1. Clear browser cache (Ctrl+Shift+Delete)
2. Try different browser (Chrome → Firefox)
3. Check GPU drivers updated
4. Restart dev server
5. Delete node_modules and reinstall

---

*Created: 2026-02-09*  
*For emergencies, start here!*
