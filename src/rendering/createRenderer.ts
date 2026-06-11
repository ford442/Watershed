import * as THREE from 'three';
import type { RendererPreference } from './types';

export interface GameRendererOptions {
  preference: RendererPreference;
  antialias?: boolean;
  powerPreference?: WebGLPowerPreference;
}

/**
 * Creates the Three.js renderer for the game Canvas.
 *
 * - `webgpu`: WebGPURenderer (lazy-loaded); falls back to WebGL2 internally when WebGPU is unavailable.
 * - `webgl`:  Pure WebGLRenderer for shader/debug parity and visual inspection.
 */
export async function createGameRenderer(
  canvasProps: THREE.WebGLRendererParameters,
  options: GameRendererOptions
): Promise<THREE.WebGLRenderer> {
  const {
    preference,
    antialias = true,
    powerPreference = 'high-performance',
  } = options;

  if (preference === 'webgl') {
    return new THREE.WebGLRenderer({
      ...canvasProps,
      antialias,
      powerPreference,
    });
  }

  const { WebGPURenderer } = await import('three/webgpu');
  const renderer = new WebGPURenderer({
    ...canvasProps,
    antialias,
    forceWebGL: false,
  });
  await renderer.init();
  return renderer as unknown as THREE.WebGLRenderer;
}
