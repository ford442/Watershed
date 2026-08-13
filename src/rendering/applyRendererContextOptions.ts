import * as THREE from 'three';
import type { RendererContextOptions } from './deriveRendererContextOptions';

/**
 * Structural view of what this module configures. WebGPURenderer is not a
 * THREE.WebGLRenderer but exposes the same four knobs, so the TSL material path
 * (#256 path A) can reuse this without a cast at every call site.
 */
export interface RendererContextTarget {
  outputColorSpace: THREE.ColorSpace;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
}

/** Shadow map size contract keyed by renderer instance (renderers have no userData). */
const shadowMapSizeByRenderer = new WeakMap<object, number | null>();

export function getRendererShadowMapSize(
  renderer: object
): number | null | undefined {
  return shadowMapSizeByRenderer.get(renderer);
}

/**
 * Apply tone mapping, color space, and shadow configuration once at renderer setup.
 * Called from createGameRenderer after the WebGL context is created.
 */
export function applyRendererContextOptions(
  renderer: RendererContextTarget,
  options: RendererContextOptions
): void {
  renderer.outputColorSpace = options.outputColorSpace;
  renderer.toneMapping = options.toneMapping;
  renderer.toneMappingExposure = options.toneMappingExposure;

  if (options.shadowMode === 'off') {
    renderer.shadowMap.enabled = false;
  } else {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type =
      options.shadowMode === 'soft'
        ? THREE.PCFSoftShadowMap
        : THREE.BasicShadowMap;
  }

  // Per-light map sizes are set in SceneLighting from LOD; store the renderer
  // contract size for diagnostics and tests.
  shadowMapSizeByRenderer.set(renderer, options.shadowMapSize);
}
