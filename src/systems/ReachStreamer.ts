/**
 * ReachStreamer.ts
 *
 * Background asset streaming system for Watershed River Reaches.
 * Operates outside React Suspense to prevent frame hitches during gameplay.
 * Fetches manifests and assets via the FastAPI storage manager backend.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WeatherType } from '../constants/weather';
import { validateReach, ValidationResult, formatValidationErrors } from '../utils/reachValidator';
import { REACH_API_BASE } from '../constants/game';

// =============================================================================
// Types
// =============================================================================

export interface AssetRef {
  id: string;
  url: string;
  type?: string;
  category?: string;
  format?: 'png' | 'raw' | 'json';
}

export interface ReachRequiredAssets {
  textures: AssetRef[];
  models: AssetRef[];
  audio: AssetRef[];
  shaders: AssetRef[];
  flowMaps?: AssetRef[];
  noiseTextures?: AssetRef[];
}

export interface ReachTransition {
  segmentIndex: number;
  type: 'waterfall' | 'slotCanyon' | 'splash';
  durationSeconds: number;
}

export interface ReachManifest {
  reachId: string;
  metadata: {
    name: string;
    author: string;
    description?: string;
    difficulty: 'beginner' | 'intermediate' | 'expert' | 'custom';
    estimatedDuration: number;
    version: string;
    tags?: string[];
  };
  world: any;
  segments: any[];
  spawns: any;
  requiredAssets: ReachRequiredAssets;
  transition: ReachTransition;
  decorationPools?: any;
  weather?: { type: WeatherType; intensity: number };
}

export interface FlowMapData {
  data: Float32Array;
  width: number;
  height: number;
}

export interface StreamResult {
  manifest: ReachManifest;
  loaded: {
    textures: number;
    noiseTextures: number;
    models: number;
    audio: number;
    shaders: number;
    flowMaps: number;
  };
  errors: string[];
}

// =============================================================================
// Global Asset Cache
// =============================================================================

export const AssetCache = {
  textures: new Map<string, THREE.Texture>(),
  noiseTextures: new Map<string, THREE.Texture>(),
  models: new Map<string, THREE.Group>(),
  audioBuffers: new Map<string, AudioBuffer>(),
  shaders: new Map<string, string>(),
  flowMaps: new Map<string, THREE.Texture | THREE.DataTexture>(),
  flowMapData: new Map<string, FlowMapData>(),
  reaches: new Map<string, ReachManifest>(),
};

// =============================================================================
// Three.js Loaders
// =============================================================================

const textureLoader = new THREE.TextureLoader();
textureLoader.crossOrigin = 'anonymous';

const gltfLoader = new GLTFLoader();
gltfLoader.crossOrigin = 'anonymous';

const audioLoader = new THREE.AudioLoader();
audioLoader.crossOrigin = 'anonymous';

// =============================================================================
// Helper: Recursive Disposal
// =============================================================================

function disposeMaterialTextures(material: THREE.Material) {
  const textureKeys: string[] = [
    'map',
    'lightMap',
    'aoMap',
    'emissiveMap',
    'bumpMap',
    'normalMap',
    'displacementMap',
    'roughnessMap',
    'metalnessMap',
    'alphaMap',
    'envMap',
    'clearcoatMap',
    'clearcoatNormalMap',
    'clearcoatRoughnessMap',
    'sheenColorMap',
    'sheenRoughnessMap',
    'specularMap',
    'specularColorMap',
    'specularIntensityMap',
    'transmissionMap',
    'thicknessMap',
    'iridescenceMap',
    'iridescenceThicknessMap',
    'anisotropyMap',
  ];

  for (const key of textureKeys) {
    const tex = (material as any)[key];
    if (tex && tex.isTexture) {
      tex.dispose();
    }
  }
}

function disposeSceneGraph(root: THREE.Object3D) {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      disposeMaterialTextures(mat);
      mat.dispose();
    }
  });
}

// =============================================================================
// Preload Helpers
// =============================================================================

function resolveAssetUrl(reachId: string, assetUrl: string): string {
  // If assetUrl is already absolute, use it as-is
  if (assetUrl.startsWith('http://') || assetUrl.startsWith('https://') || assetUrl.startsWith('/')) {
    return assetUrl;
  }
  return `${REACH_API_BASE}/${reachId}/assets/${assetUrl}`;
}

function preloadTexture(reachId: string, url: string): Promise<THREE.Texture> {
  const fullUrl = resolveAssetUrl(reachId, url);

  return new Promise((resolve, reject) => {
    if (AssetCache.textures.has(fullUrl)) {
      return resolve(AssetCache.textures.get(fullUrl)!);
    }

    textureLoader.load(
      fullUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        AssetCache.textures.set(fullUrl, texture);
        resolve(texture);
      },
      undefined,
      (err) => {
        console.error(`[ReachStreamer] Failed to load texture: ${fullUrl}`, err);
        reject(new Error(`Texture load failed: ${fullUrl}`));
      }
    );
  });
}

function preloadNoiseTexture(reachId: string, url: string): Promise<THREE.Texture> {
  const fullUrl = resolveAssetUrl(reachId, url);

  return new Promise((resolve, reject) => {
    if (AssetCache.noiseTextures.has(fullUrl)) {
      return resolve(AssetCache.noiseTextures.get(fullUrl)!);
    }

    textureLoader.load(
      fullUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        AssetCache.noiseTextures.set(fullUrl, texture);
        resolve(texture);
      },
      undefined,
      (err) => {
        console.error(`[ReachStreamer] Failed to load noise texture: ${fullUrl}`, err);
        reject(new Error(`Noise texture load failed: ${fullUrl}`));
      }
    );
  });
}

function preloadModel(reachId: string, url: string): Promise<THREE.Group> {
  const fullUrl = resolveAssetUrl(reachId, url);

  return new Promise((resolve, reject) => {
    if (AssetCache.models.has(fullUrl)) {
      return resolve(AssetCache.models.get(fullUrl)!);
    }

    gltfLoader.load(
      fullUrl,
      (gltf) => {
        AssetCache.models.set(fullUrl, gltf.scene);
        resolve(gltf.scene);
      },
      undefined,
      (err) => {
        console.error(`[ReachStreamer] Failed to load model: ${fullUrl}`, err);
        reject(new Error(`Model load failed: ${fullUrl}`));
      }
    );
  });
}

function preloadAudio(reachId: string, url: string): Promise<AudioBuffer> {
  const fullUrl = resolveAssetUrl(reachId, url);

  return new Promise((resolve, reject) => {
    if (AssetCache.audioBuffers.has(fullUrl)) {
      return resolve(AssetCache.audioBuffers.get(fullUrl)!);
    }

    audioLoader.load(
      fullUrl,
      (buffer) => {
        AssetCache.audioBuffers.set(fullUrl, buffer);
        resolve(buffer);
      },
      undefined,
      (err) => {
        console.error(`[ReachStreamer] Failed to load audio: ${fullUrl}`, err);
        reject(new Error(`Audio load failed: ${fullUrl}`));
      }
    );
  });
}

async function preloadShader(reachId: string, url: string): Promise<string> {
  const fullUrl = resolveAssetUrl(reachId, url);

  if (AssetCache.shaders.has(fullUrl)) {
    return AssetCache.shaders.get(fullUrl)!;
  }

  const response = await fetch(fullUrl, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`Shader fetch failed: ${fullUrl} (${response.status})`);
  }

  const source = await response.text();
  AssetCache.shaders.set(fullUrl, source);
  return source;
}

function extractPngFlowMapData(texture: THREE.Texture): FlowMapData {
  const image = texture.image as HTMLImageElement;
  const width = image.width || 256;
  const height = image.height || 256;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);

  // Store RG channels as normalized float vectors [-1, 1]
  const data = new Float32Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    const r = imageData.data[i * 4] / 255;
    const g = imageData.data[i * 4 + 1] / 255;
    data[i * 2] = r * 2 - 1;
    data[i * 2 + 1] = g * 2 - 1;
  }

  return { data, width, height };
}

async function preloadFlowMap(reachId: string, asset: AssetRef): Promise<THREE.Texture | THREE.DataTexture> {
  const fullUrl = resolveAssetUrl(reachId, asset.url);

  if (AssetCache.flowMaps.has(fullUrl)) {
    return AssetCache.flowMaps.get(fullUrl)!;
  }

  const format = asset.format || 'png';

  if (format === 'png') {
    return new Promise((resolve, reject) => {
      textureLoader.load(
        fullUrl,
        (texture) => {
          AssetCache.flowMaps.set(fullUrl, texture);
          try {
            const flowData = extractPngFlowMapData(texture);
            AssetCache.flowMapData.set(fullUrl, flowData);
          } catch (err) {
            console.warn(`[ReachStreamer] Failed to extract CPU flowMap data for ${fullUrl}:`, err);
          }
          resolve(texture);
        },
        undefined,
        (err) => {
          console.error(`[ReachStreamer] Failed to load flowMap: ${fullUrl}`, err);
          reject(new Error(`FlowMap load failed: ${fullUrl}`));
        }
      );
    });
  }

  // raw / json formats -> parse into DataTexture
  const response = await fetch(fullUrl, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`FlowMap fetch failed: ${fullUrl} (${response.status})`);
  }

  let data: Float32Array;
  let width = 256;
  let height = 256;

  if (format === 'json') {
    const json = await response.json();
    width = json.width || 256;
    height = json.height || 256;
    data = new Float32Array(json.data);
  } else {
    // raw binary
    const arrayBuffer = await response.arrayBuffer();
    data = new Float32Array(arrayBuffer);
  }

  // For CPU sampling, extract RG from RGBA DataTexture
  const cpuData = new Float32Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    cpuData[i * 2] = data[i * 4];
    cpuData[i * 2 + 1] = data[i * 4 + 1];
  }
  AssetCache.flowMapData.set(fullUrl, { data: cpuData, width, height });

  const dataTexture = new THREE.DataTexture(
    data as unknown as BufferSource,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  dataTexture.needsUpdate = true;
  AssetCache.flowMaps.set(fullUrl, dataTexture);
  return dataTexture;
}

// =============================================================================
// Public API
// =============================================================================

export const ReachStreamer = {
  /**
   * Preload a Reach manifest and all of its required assets.
   * Returns the manifest and a summary of loaded assets.
   */
  async preloadReach(reachId: string): Promise<StreamResult> {
    console.log(`[ReachStreamer] Initiating background stream for Reach: ${reachId}`);

    const manifestUrl = `${REACH_API_BASE}/${reachId}/manifest`;
    const errors: string[] = [];

    try {
      const response = await fetch(manifestUrl, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`Manifest fetch failed: ${response.status} ${response.statusText}`);
      }

      const rawManifest = await response.json();

      // Validate manifest
      const validation: ValidationResult = validateReach(rawManifest);
      if (!validation.valid) {
        throw new Error(`Invalid Reach manifest:\n${formatValidationErrors(validation)}`);
      }

      const manifest = rawManifest as ReachManifest;

      // Parse required assets
      const textures = manifest.requiredAssets?.textures || [];
      const noiseTextures = manifest.requiredAssets?.noiseTextures || [];
      const models = manifest.requiredAssets?.models || [];
      const audio = manifest.requiredAssets?.audio || [];
      const shaders = manifest.requiredAssets?.shaders || [];
      const flowMaps = manifest.requiredAssets?.flowMaps || [];

      // Download everything concurrently, catching individual failures
      const texturePromises = textures.map((asset) =>
        preloadTexture(reachId, asset.url).catch((err) => {
          errors.push(err.message);
          return null;
        })
      );

      const noiseTexturePromises = noiseTextures.map((asset) =>
        preloadNoiseTexture(reachId, asset.url).catch((err) => {
          errors.push(err.message);
          return null;
        })
      );

      const modelPromises = models.map((asset) =>
        preloadModel(reachId, asset.url).catch((err) => {
          errors.push(err.message);
          return null;
        })
      );

      const audioPromises = audio.map((asset) =>
        preloadAudio(reachId, asset.url).catch((err) => {
          errors.push(err.message);
          return null;
        })
      );

      const shaderPromises = shaders.map((asset) =>
        preloadShader(reachId, asset.url).catch((err) => {
          errors.push(err.message);
          return null;
        })
      );

      const flowMapPromises = flowMaps.map((asset) =>
        preloadFlowMap(reachId, asset).catch((err) => {
          errors.push(err.message);
          return null;
        })
      );

      const [textureResults, noiseTextureResults, modelResults, audioResults, shaderResults, flowMapResults] =
        await Promise.all([
          Promise.all(texturePromises),
          Promise.all(noiseTexturePromises),
          Promise.all(modelPromises),
          Promise.all(audioPromises),
          Promise.all(shaderPromises),
          Promise.all(flowMapPromises),
        ]);

      // Cache the manifest
      AssetCache.reaches.set(reachId, manifest);

      const result: StreamResult = {
        manifest,
        loaded: {
          textures: textureResults.filter(Boolean).length,
          noiseTextures: noiseTextureResults.filter(Boolean).length,
          models: modelResults.filter(Boolean).length,
          audio: audioResults.filter(Boolean).length,
          shaders: shaderResults.filter(Boolean).length,
          flowMaps: flowMapResults.filter(Boolean).length,
        },
        errors,
      };

      if (errors.length > 0) {
        console.warn(`[ReachStreamer] Reach ${reachId} preloaded with ${errors.length} asset error(s):`, errors);
      } else {
        console.log(`[ReachStreamer] Reach ${reachId} preloaded successfully.`, result.loaded);
      }

      return result;
    } catch (error) {
      console.error(`[ReachStreamer] Failed to preload Reach ${reachId}:`, error);
      throw error;
    }
  },

  /**
   * Evict a Reach and all of its associated assets from memory.
   * Performs recursive disposal of Three.js objects to free GPU/CPU memory.
   */
  evictReach(reachId: string) {
    console.log(`[ReachStreamer] Evicting Reach: ${reachId}`);

    const manifest = AssetCache.reaches.get(reachId);
    if (!manifest) {
      console.warn(`[ReachStreamer] No cached Reach found for eviction: ${reachId}`);
      return;
    }

    const textures = manifest.requiredAssets?.textures || [];
    const noiseTextures = manifest.requiredAssets?.noiseTextures || [];
    const models = manifest.requiredAssets?.models || [];
    const audio = manifest.requiredAssets?.audio || [];
    const shaders = manifest.requiredAssets?.shaders || [];
    const flowMaps = manifest.requiredAssets?.flowMaps || [];

    // Dispose textures
    for (const asset of textures) {
      const fullUrl = resolveAssetUrl(reachId, asset.url);
      const tex = AssetCache.textures.get(fullUrl);
      if (tex) {
        tex.dispose();
        AssetCache.textures.delete(fullUrl);
      }
    }

    // Dispose noise textures
    for (const asset of noiseTextures) {
      const fullUrl = resolveAssetUrl(reachId, asset.url);
      const tex = AssetCache.noiseTextures.get(fullUrl);
      if (tex) {
        tex.dispose();
        AssetCache.noiseTextures.delete(fullUrl);
      }
    }

    // Dispose models (recursive scene graph disposal)
    for (const asset of models) {
      const fullUrl = resolveAssetUrl(reachId, asset.url);
      const model = AssetCache.models.get(fullUrl);
      if (model) {
        disposeSceneGraph(model);
        AssetCache.models.delete(fullUrl);
      }
    }

    // Remove audio buffers
    for (const asset of audio) {
      const fullUrl = resolveAssetUrl(reachId, asset.url);
      AssetCache.audioBuffers.delete(fullUrl);
    }

    // Remove shaders
    for (const asset of shaders) {
      const fullUrl = resolveAssetUrl(reachId, asset.url);
      AssetCache.shaders.delete(fullUrl);
    }

    // Dispose flow maps
    for (const asset of flowMaps) {
      const fullUrl = resolveAssetUrl(reachId, asset.url);
      const flow = AssetCache.flowMaps.get(fullUrl);
      if (flow) {
        flow.dispose();
        AssetCache.flowMaps.delete(fullUrl);
      }
      AssetCache.flowMapData.delete(fullUrl);
    }

    // Remove manifest
    AssetCache.reaches.delete(reachId);

    console.log(`[ReachStreamer] Reach ${reachId} evicted.`);
  },

  /**
   * Check if a Reach manifest is already cached.
   */
  isReachCached(reachId: string): boolean {
    return AssetCache.reaches.has(reachId);
  },

  /**
   * Get a cached Reach manifest (throws if not cached).
   */
  getCachedReach(reachId: string): ReachManifest {
    const manifest = AssetCache.reaches.get(reachId);
    if (!manifest) {
      throw new Error(`Reach ${reachId} not found in cache`);
    }
    return manifest;
  },
};

export default ReachStreamer;
