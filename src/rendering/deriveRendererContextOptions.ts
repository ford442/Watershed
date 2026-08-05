import * as THREE from 'three';
import type { QualityPreset } from '../systems/GameState';

/** Shadow mode mapped to R3F Canvas `shadows` prop and THREE.ShadowMapType. */
export type ShadowMode = 'off' | 'basic' | 'soft';

export interface RendererContextSettings {
  /** Browser `window.devicePixelRatio`; inject in tests. Defaults to 1. */
  devicePixelRatio?: number;
}

export interface RendererContextOptions {
  /** Upper bound for Canvas DPR — clamp device pixel ratio to [1, dprMax]. */
  dprMax: number;
  antialias: boolean;
  shadowMode: ShadowMode;
  /** Null when shadows are disabled. */
  shadowMapSize: number | null;
  powerPreference: WebGLPowerPreference;
  outputColorSpace: THREE.ColorSpace;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
}

/** Default ACES exposure — matches THREE.WebGLRenderer default of 1.0. */
export const DEFAULT_TONE_MAPPING_EXPOSURE = 1.0;

/**
 * Logarithmic depth is intentionally off for all presets.
 *
 * Evaluated for long canyon Z ranges (#337): the track treadmill keeps only
 * ~7 active segments (~hundreds of units of Z), fog far is typically ≤220, and
 * shadow cameras use far=200. Enabling `logarithmicDepthBuffer` would require
 * log-depth chunks in every custom ShaderMaterial (FlowingWater, CanyonMaterial,
 * RiverShader injections) for modest Z-fighting benefit. Keep the THREE default
 * (false); revisit only if a non-treadmill long-haul camera path ships.
 */
export const LOGARITHMIC_DEPTH_BUFFER_ENABLED = false;

/**
 * Pure quality → WebGL context options. No React or DOM side effects.
 *
 * `high` matches the pre-contract Canvas defaults: antialias on, soft shadows,
 * DPR clamped to [1, 2], high-performance power preference.
 */
export function deriveRendererContextOptions(
  quality: QualityPreset,
  settings: RendererContextSettings = {}
): RendererContextOptions {
  const devicePixelRatio = settings.devicePixelRatio ?? 1;

  const base = {
    powerPreference: 'high-performance' as WebGLPowerPreference,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: DEFAULT_TONE_MAPPING_EXPOSURE,
  };

  switch (quality) {
    case 'low':
      return {
        ...base,
        dprMax: 1.0,
        antialias: false,
        shadowMode: 'off',
        shadowMapSize: null,
      };
    case 'medium':
      return {
        ...base,
        dprMax: 1.25,
        antialias: true,
        shadowMode: 'basic',
        shadowMapSize: 1024,
      };
    case 'high':
      return {
        ...base,
        dprMax: 2,
        antialias: true,
        shadowMode: 'soft',
        shadowMapSize: 2048,
      };
    case 'ultra':
      return {
        ...base,
        dprMax: devicePixelRatio,
        antialias: true,
        shadowMode: 'soft',
        shadowMapSize: devicePixelRatio >= 2 ? 4096 : 2048,
      };
    default: {
      const _exhaustive: never = quality;
      return _exhaustive;
    }
  }
}

/** R3F Canvas `shadows` prop value from derived shadow mode. */
export function shadowModeToCanvasProp(
  mode: ShadowMode
): false | 'basic' | 'soft' {
  if (mode === 'off') return false;
  return mode;
}

/** Resolved Canvas DPR: clamp device pixel ratio to [1, dprMax]. */
export function resolveCanvasDpr(
  dprMax: number,
  devicePixelRatio: number
): number {
  return Math.min(Math.max(1, devicePixelRatio), dprMax);
}
