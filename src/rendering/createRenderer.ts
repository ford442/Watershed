import * as THREE from 'three';
import type { RendererPreference } from './types';
import { isDataUrlConnectAllowed } from './cspProbe';
import { persistRendererPreference } from './rendererConfig';

export interface GameRendererOptions {
  preference: RendererPreference;
  antialias?: boolean;
  powerPreference?: WebGLPowerPreference;
}

/**
 * Creates the Three.js renderer for the game Canvas.
 *
 * - `webgl`:  WebGPURenderer with WebGL2 backend (NodeMaterial + legacy GLSL).
 * - `webgpu`: WebGPURenderer (lazy-loaded). Falls back to WebGLRenderer when
 *   CSP blocks data: WGSL loads or initialization fails.
 *
 * River + Canyon materials are migrated to NodeMaterial/TSL. Native WebGPU is
 * still blocked by remaining legacy materials (EnhancedSky, Fish, Dragonflies,
 * VegetationShader, RockShader, TreeShader, FlowingWater ShaderMaterial,
 * post-processing GLSL).
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

  const createWebGLRenderer = () =>
    new THREE.WebGLRenderer({
      ...canvasProps,
      antialias,
      powerPreference,
    });

  // WebGPURenderer ships WGSL as data:text/wgsl;base64,... internal modules.
  // Strict CSP (connect-src without data:) blocks those fetches and leaves a
  // blank canvas with shader validation errors in the console.
  const dataUrlsAllowed = await isDataUrlConnectAllowed();
  if (!dataUrlsAllowed) {
    console.warn(
      '[Renderer] CSP blocks data: URLs required by WebGPURenderer — using WebGLRenderer. ' +
        'Add data: to connect-src or use ?renderer=webgl.'
    );
    persistRendererPreference('webgl');
    return createWebGLRenderer();
  }

  try {
    const { WebGPURenderer } = await import('three/webgpu');
    // Native WebGPU rejects legacy ShaderMaterial / onBeforeCompile materials.
    // Force WebGL2 backend until the remaining materials migrate to NodeMaterial.
    const renderer = new WebGPURenderer({
      ...canvasProps,
      antialias,
      forceWebGL: true,
    });
    await renderer.init();
    return renderer as unknown as THREE.WebGLRenderer;
  } catch (error) {
    console.warn('[Renderer] WebGPURenderer init failed — using WebGLRenderer:', error);
    persistRendererPreference('webgl');
    return createWebGLRenderer();
  }
}
