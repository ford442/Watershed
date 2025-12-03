# Asset Workflow Guide

This document outlines the standardized workflow for managing assets in the Watershed project.

## Directory Structure

### Source Assets
- `assets/concepts/` - Concept art, reference images, and design documentation
- `assets/textures/` - Source texture files (high-resolution, uncompressed)
- `assets/models/` - Source 3D models (.blend, .fbx, etc.)

### Production Assets
- `public/` - Production-ready, optimized assets used at runtime
  - Compressed textures (KTX2/Basis format recommended)
  - Optimized models (Draco-compressed glTF/GLB)
  - Audio files
  - Shaders (WGSL, GLSL)

## Asset Pipeline

### Textures

#### Source → Production
1. **Source Location**: Place original high-resolution textures in `assets/textures/`
   - Keep original formats (PNG, TGA, EXR, etc.)
   - Maintain high resolution for future use

2. **Optimization**: Convert to production formats
   - **Recommended**: KTX2 with Basis Universal compression
   - **Tools**: 
     - [basisu](https://github.com/BinomialLLC/basis_universal) - CLI tool
     - [toktx](https://github.com/KhronosGroup/KTX-Software) - KTX2 creation
   - **Fallback**: Compressed JPEG (for compatibility)

3. **Production Location**: Place optimized textures in `public/`
   - Use consistent naming: `[asset_name]_[map_type].[ext]`
   - Example: `Rock031_Color.ktx2`, `Rock031_Normal.ktx2`

#### Current Texture Assets
- **Rock031**: Canyon rock material
  - Color map (albedo)
  - Normal map (GL format)
  - Roughness map
  - Ambient occlusion map
  - Displacement map

### 3D Models

#### Source → Production
1. **Source Location**: Keep source files in `assets/models/`
   - Blender files (.blend)
   - FBX exports
   - Source animations

2. **Optimization**: Convert to glTF/GLB
   - **Format**: glTF 2.0 or GLB (binary glTF)
   - **Compression**: Apply Draco compression
   - **Tools**:
     - Blender glTF exporter with Draco enabled
     - [gltf-pipeline](https://github.com/CesiumGS/gltf-pipeline) - CLI tool
   - **Settings**:
     - Draco compression level: 10 (balance size/quality)
     - Quantization: Position (14 bits), Normal (10 bits), UV (12 bits)

3. **Production Location**: Place optimized models in `public/models/`

### Shaders

#### Location
- **Source**: `src/shaders/` - WGSL and GLSL shader source code
- **Public**: Shaders can be in `public/shaders/` if loaded dynamically at runtime

#### Current Shaders
- `sky.wgsl` - Sky rendering
- `terrain.wgsl` - Terrain rendering
- `tree.wgsl` - Vegetation rendering  
- `water.wgsl` - Water simulation and rendering

### Audio

#### Source → Production
1. **Source Location**: `assets/audio/` (create if needed)
2. **Optimization**:
   - Format: OGG Vorbis (web-optimized)
   - Sample rate: 44.1 kHz or 48 kHz
   - Bitrate: 128-192 kbps for music, 64-96 kbps for SFX
3. **Production Location**: `public/` or `public/audio/`

## Optimization Guidelines

### Why Optimize?
The streaming "treadmill" system requires fast asset loading:
- **Chunk streaming**: Assets must load before the player reaches them
- **Performance**: Uncompressed assets cause stuttering and slow loads
- **Bandwidth**: Smaller files = faster downloads

### Compression Targets
- **Textures**: 50-75% size reduction (KTX2/Basis)
- **Models**: 70-90% size reduction (Draco glTF)
- **Total bundle**: Keep initial load under 5MB

### Quality vs. Size
- Maintain visual quality at high speeds (player velocity is key)
- Prioritize normal maps and roughness (define material feel)
- Color maps can use higher compression

## Git Workflow

### .gitignore Rules
The following should be tracked:
- ✅ Source assets in `assets/` (concepts, textures, models)
- ✅ Optimized production assets in `public/`
- ✅ Shader source code in `src/shaders/`

The following should NOT be tracked:
- ❌ `node_modules/`
- ❌ `build/` directory
- ❌ Temporary export files (`.tmp`, `.cache`, etc.)

### Asset Updates
When updating an asset:
1. Update source file in `assets/`
2. Re-optimize and export to `public/`
3. Commit both source and production files
4. Document changes in commit message

## Tools Reference

### Recommended Tools
- **Blender**: 3D modeling and glTF export
- **Basis Universal**: Texture compression
- **gltf-pipeline**: glTF optimization
- **Audacity**: Audio editing and export

### Installation
```bash
# Install gltf-pipeline globally
npm install -g gltf-pipeline

# Install basis_universal (build from source or download binaries)
# See: https://github.com/BinomialLLC/basis_universal
```

## Usage in Code

### Loading Textures
```javascript
import { useTexture } from '@react-three/drei';

// Load from public/
const [colorMap, normalMap] = useTexture([
  '/Rock031_Color.jpg',  // or .ktx2
  '/Rock031_Normal.jpg',
]);
```

### Loading Models
```javascript
import { useGLTF } from '@react-three/drei';

// Load from public/models/
const { scene } = useGLTF('/models/raft.glb');
```

### Loading Shaders
```javascript
// Import from src/shaders/
import waterShader from '../shaders/water.wgsl?raw';

// Or load from public/shaders/ at runtime
const response = await fetch('/shaders/water.wgsl');
const shaderCode = await response.text();
```

## AI Agent Guidelines

When adding new assets:
1. ✅ Place source files in appropriate `assets/` subdirectory
2. ✅ Optimize before placing in `public/`
3. ✅ Update this document if adding a new asset type
4. ✅ Run smoke tests to verify asset loads correctly
5. ✅ Check bundle size hasn't increased significantly

When modifying existing assets:
1. ✅ Preserve source file in `assets/`
2. ✅ Re-export optimized version to `public/`
3. ✅ Verify visual quality in-game
4. ✅ Test streaming performance (no stuttering)
