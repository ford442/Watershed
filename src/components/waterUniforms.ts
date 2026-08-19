// Per-frame water uniform updates shared by GLSL and TSL backends.

import * as THREE from 'three';
import { getSWEHeightFieldSnapshot } from '../systems/water/SWEHeightField';
import { useWaterReflectionStore } from '../systems/water/waterReflectionStore';
import { updateRendererDiagnostics } from '../rendering/rendererState';
import type { MaterialBackend } from '../rendering/materialBackend';

/**
 * GPU flow-field handle produced by the heightmap flow system.
 */
export interface HeightmapFlowHandle {
  flowMapTexture?: THREE.Texture | null;
  initWebGPU?: () => Promise<unknown>;
  update?: (delta: number, time: number, options: { flowStrength: number }) => void;
  [key: string]: unknown;
}

/**
 * Either backend's water material, seen through the shared uniform contract.
 * The TSL material is a NodeMaterial, so this is deliberately widened from
 * ShaderMaterial to Material — everything below only touches `uniforms`/`userData`.
 */
export type WaterMaterial = THREE.Material & {
  uniforms: Record<string, THREE.IUniform>;
  userData: {
    waterFlowField?: {
      waterLevel: number;
      flowSpeed: number;
      heightmapFlow?: HeightmapFlowHandle | null;
      sampleAt: (position: THREE.Vector3, time: number) => {
        direction: THREE.Vector3;
        speed: number;
      };
    };
  };
};

let blackReflectionFallback: THREE.DataTexture | null = null;
let warnedInvalidWaterShader = false;
let warnedWaterShaderCompile = false;

export function getBlackReflectionFallback(): THREE.DataTexture {
  if (!blackReflectionFallback) {
    const data = new Uint8Array([0, 0, 0, 255]);
    blackReflectionFallback = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    blackReflectionFallback.needsUpdate = true;
  }
  return blackReflectionFallback;
}

export function isWaterShaderMaterial(
  mat: WaterMaterial | THREE.MeshBasicMaterial | null,
): mat is WaterMaterial {
  return !!mat && 'uniforms' in mat;
}

/** Publish which water backend built so DebugPanel can show it. */
export function publishWaterMaterialBackend(backend: MaterialBackend, fallbackReason?: string): void {
  updateRendererDiagnostics({ materialBackend: backend });
  if (fallbackReason) {
    console.warn('[FlowingWater] TSL water material unavailable:', fallbackReason);
  }
}

export function isUsableFragmentShader(source: string | null | undefined): boolean {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return false;
  }
  return source.includes('void main') && source.includes('gl_FragColor');
}

export function resolveWaterFragmentShader(
  dynamicShaderCode: string | null,
  builtinFragmentShader: string,
): string {
  const candidateShader = dynamicShaderCode || builtinFragmentShader;
  if (isUsableFragmentShader(candidateShader)) {
    return candidateShader;
  }
  if (!warnedInvalidWaterShader) {
    warnedInvalidWaterShader = true;
    console.warn('[FlowingWater] Invalid fragment shader, using built-in fallback');
  }
  return builtinFragmentShader;
}

export function createWaterBasicFallback(color: THREE.ColorRepresentation): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
}

export function warnWaterShaderCompileOnce(error: unknown): void {
  if (!warnedWaterShaderCompile) {
    warnedWaterShaderCompile = true;
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[FlowingWater] Shader compile failed, using basic material:', message);
  }
}

export interface FlowingWaterUniformFrameInput {
  elapsedTime: number;
  delta: number;
  cameraY: number;
  biome: string;
  isNight: boolean;
  flowMap: THREE.Texture | null;
  heightmapFlow: HeightmapFlowHandle | null;
  vehiclePos: THREE.Vector3 | null;
  vehicleVelocity: THREE.Vector3 | null;
  weatherRipple: number;
  wetness: number;
  slushiness: number;
  sunWorldPosition: THREE.Vector3 | null;
  isPond: boolean;
  vortexCenter: THREE.Vector3 | null;
  vortexRadius: number;
  vortexIntensity: number;
}

/** Write all frame-driven water uniforms. No-op for MeshBasicMaterial fallbacks. */
export function updateFlowingWaterUniforms(
  mat: WaterMaterial | THREE.MeshBasicMaterial | null,
  input: FlowingWaterUniformFrameInput,
): void {
  if (!isWaterShaderMaterial(mat) || !mat.uniforms?.time) return;

  const {
    elapsedTime,
    delta,
    cameraY,
    biome,
    isNight,
    flowMap,
    heightmapFlow,
    vehiclePos,
    vehicleVelocity,
    weatherRipple,
    wetness,
    slushiness,
    sunWorldPosition,
    isPond,
    vortexCenter,
    vortexRadius,
    vortexIntensity,
  } = input;

  mat.uniforms.time.value = elapsedTime;

  if (mat.uniforms.vehiclePos && vehiclePos) {
    mat.uniforms.vehiclePos.value.copy(vehiclePos);
  } else if (mat.uniforms.vehiclePos) {
    mat.uniforms.vehiclePos.value.set(99999.0, 99999.0, 99999.0);
  }
  if (mat.uniforms.vehicleVelocity && vehicleVelocity) {
    mat.uniforms.vehicleVelocity.value.copy(vehicleVelocity);
  } else if (mat.uniforms.vehicleVelocity) {
    mat.uniforms.vehicleVelocity.value.set(0.0, 0.0, 0.0);
  }
  if (mat.uniforms.weatherRipple) {
    mat.uniforms.weatherRipple.value = weatherRipple;
  }
  if (mat.uniforms.wetness) {
    mat.uniforms.wetness.value = wetness;
  }
  if (mat.uniforms.slushiness) {
    mat.uniforms.slushiness.value = slushiness;
  }
  if (mat.uniforms.flowMap) {
    mat.uniforms.flowMap.value = heightmapFlow?.flowMapTexture || flowMap || null;
  }

  if (mat.uniforms.bioLuminescence) {
    const isGlacial = biome === 'glacial';
    mat.uniforms.bioLuminescence.value = (isNight && isGlacial) ? 1.0 : 0.0;
  }
  if (mat.uniforms.timeOfDay) {
    mat.uniforms.timeOfDay.value = isNight ? 1.0 : 0.0;
  }
  if (mat.uniforms.cameraHeight) {
    mat.uniforms.cameraHeight.value = cameraY;
  }
  // God rays: slot canyon biome gets shafts; other biomes fade out over ~1s
  if (mat.uniforms.godRayStrength) {
    const targetGodRay = (biome === 'canyon') ? 0.18 : 0.0;
    mat.uniforms.godRayStrength.value += (targetGodRay - mat.uniforms.godRayStrength.value) * Math.min(1, delta * 1.5);
  }
  // Animate sun azimuth slowly for shifting canyon light feel
  if (mat.uniforms.sunDir) {
    const t = elapsedTime * 0.04;
    mat.uniforms.sunDir.value.set(Math.sin(t) * 0.4, 1.0, Math.cos(t) * 0.3 - 0.4).normalize();
  }
  if (mat.uniforms.sunWorldPos && sunWorldPosition) {
    mat.uniforms.sunWorldPos.value.copy(sunWorldPosition);
  }
  if (mat.uniforms.isPond) {
    mat.uniforms.isPond.value = isPond ? 1.0 : 0.0;
  }
  if (mat.uniforms.vortexCenter) {
    if (vortexCenter) {
      mat.uniforms.vortexCenter.value.copy(vortexCenter);
    } else {
      mat.uniforms.vortexCenter.value.set(99999.0, 0.0, 99999.0);
    }
  }
  if (mat.uniforms.vortexRadius) {
    mat.uniforms.vortexRadius.value = vortexRadius || 10;
  }
  if (mat.uniforms.vortexIntensity) {
    mat.uniforms.vortexIntensity.value = vortexIntensity || 0;
  }

  const swe = getSWEHeightFieldSnapshot();
  if (mat.uniforms.sweHeightMap) {
    mat.uniforms.sweHeightMap.value = swe.texture;
  }
  if (mat.uniforms.sweOrigin) {
    mat.uniforms.sweOrigin.value.set(swe.originX, swe.originZ);
  }
  if (mat.uniforms.sweCellSize) {
    mat.uniforms.sweCellSize.value = swe.cellSize;
  }
  if (mat.uniforms.sweGridSize) {
    mat.uniforms.sweGridSize.value.set(swe.width, swe.height);
  }
  if (mat.uniforms.sweEnabled) {
    mat.uniforms.sweEnabled.value = swe.enabled && swe.texture ? 1.0 : 0.0;
  }
  if (mat.uniforms.sweDisplacementScale) {
    // Quality-budgeted amplitude (sweQuality.ts) — 0 on the low preset.
    mat.uniforms.sweDisplacementScale.value = swe.displacementScale;
  }

  // Planar reflection texture published by WaterReflection (null when pass unmounted)
  if (mat.uniforms.reflectionTexture) {
    const { texture, strength } = useWaterReflectionStore.getState();
    mat.uniforms.reflectionTexture.value = texture || getBlackReflectionFallback();
    if (mat.uniforms.reflectionStrength) {
      mat.uniforms.reflectionStrength.value = texture ? strength : 0.0;
    }
  }
}
