import * as THREE from 'three';
import type { RendererContextOptions } from './deriveRendererContextOptions';

/** Shadow map size contract keyed by renderer instance (WebGLRenderer has no userData). */
const shadowMapSizeByRenderer = new WeakMap<THREE.WebGLRenderer, number | null>();

export function getRendererShadowMapSize(
  renderer: THREE.WebGLRenderer
): number | null | undefined {
  return shadowMapSizeByRenderer.get(renderer);
}

/**
 * Apply tone mapping, color space, and shadow configuration once at renderer setup.
 * Called from createGameRenderer after the WebGL context is created.
 */
export function applyRendererContextOptions(
  renderer: THREE.WebGLRenderer,
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
